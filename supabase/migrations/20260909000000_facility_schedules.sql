begin;

-- The facility view adds schedule-aware widgets to the existing personal
-- dashboard catalog while keeping each user in control of their own layout.
alter table if exists public.dashboard_preferences drop constraint if exists dashboard_widgets_limit;
alter table if exists public.dashboard_preferences add constraint dashboard_widgets_limit
  check (jsonb_array_length(widgets) <= 24);

-- Department schedules make the tracker usable beyond the original four
-- Blue/Yellow crews. A schedule is a named work group + shift within one
-- department. Effective-dated rules preserve the pattern that applied before
-- an administrator makes a later change.
create table if not exists public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  work_group text not null,
  name text not null,
  legacy_shift_color text check (legacy_shift_color is null or legacy_shift_color in ('Blue', 'Yellow')),
  legacy_shift_period text check (legacy_shift_period is null or legacy_shift_period in ('Day', 'Night')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(work_group)) between 1 and 100),
  check (char_length(trim(name)) between 1 and 100)
);

create unique index if not exists work_schedules_department_name_idx
  on public.work_schedules (department_id, lower(work_group), lower(name));

create table if not exists public.work_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.work_schedules(id) on delete cascade,
  effective_from date not null,
  anchor_date date not null,
  cycle_hours numeric(5, 2)[] not null,
  created_at timestamptz not null default now(),
  unique (schedule_id, effective_from),
  check (cardinality(cycle_hours) in (7, 14))
);

create table if not exists public.work_schedule_overrides (
  schedule_id uuid not null references public.work_schedules(id) on delete cascade,
  work_date date not null,
  hours numeric(5, 2) not null check (hours >= 0 and hours <= 24 and hours * 4 = trunc(hours * 4)),
  reason text not null default '',
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (schedule_id, work_date),
  check (char_length(reason) <= 250),
  check (char_length(updated_by) between 3 and 254)
);

-- Seed the company-wide 12-hour foundation for every existing department,
-- including currently empty departments. Production calls this group Blends;
-- other departments keep their department name as the initial work group.
insert into public.work_schedules (
  department_id, work_group, name, legacy_shift_color, legacy_shift_period
)
select
  d.id,
  case when lower(d.name) = 'production' then 'Blends' else d.name end,
  crew.shift_color || ' ' || crew.shift_period,
  crew.shift_color,
  crew.shift_period
from public.departments d
cross join (values
  ('Blue', 'Day'), ('Blue', 'Night'), ('Yellow', 'Day'), ('Yellow', 'Night')
) crew(shift_color, shift_period)
on conflict (department_id, lower(work_group), lower(name)) do nothing;

insert into public.work_schedule_rules (schedule_id, effective_from, anchor_date, cycle_hours)
select
  s.id,
  date '1900-01-01',
  date '2026-08-10',
  case when s.legacy_shift_color = 'Blue'
    then array[12, 12, 0, 0, 12, 12, 12, 0, 0, 12, 12, 0, 0, 0]::numeric[]
    else array[0, 0, 12, 12, 0, 0, 0, 12, 12, 0, 0, 12, 12, 12]::numeric[]
  end
from public.work_schedules s
where s.legacy_shift_color is not null
on conflict (schedule_id, effective_from) do nothing;

-- Production can use these immediately for the Monday-Friday Repack crews.
insert into public.work_schedules (department_id, work_group, name)
select d.id, 'Repacks', shift_name
from public.departments d
cross join (values ('1st Shift'), ('2nd Shift'), ('3rd Shift')) names(shift_name)
where lower(d.name) = 'production'
on conflict (department_id, lower(work_group), lower(name)) do nothing;

insert into public.work_schedule_rules (schedule_id, effective_from, anchor_date, cycle_hours)
select s.id, date '1900-01-01', date '2026-08-10', array[8, 8, 8, 8, 8, 0, 0]::numeric[]
from public.work_schedules s
join public.departments d on d.id = s.department_id
where lower(d.name) = 'production' and lower(s.work_group) = 'repacks'
on conflict (schedule_id, effective_from) do nothing;

alter table public.employees add column if not exists schedule_id uuid references public.work_schedules(id) on delete restrict;

update public.employees e
set schedule_id = s.id
from public.work_schedules s
where e.schedule_id is null
  and s.department_id = e.department_id
  and s.legacy_shift_color = e.shift_color
  and s.legacy_shift_period = e.shift_period;

alter table public.employees alter column schedule_id set not null;
alter table public.employees alter column shift_color drop not null;
alter table public.employees alter column shift_period drop not null;
create index if not exists employees_schedule_idx on public.employees (schedule_id, active);

alter table public.profiles add column if not exists schedule_id uuid references public.work_schedules(id) on delete restrict;
update public.profiles p
set schedule_id = s.id
from public.work_schedules s
where p.role = 'supervisor'
  and p.schedule_id is null
  and s.department_id = p.department_id
  and s.legacy_shift_color = p.shift_color
  and s.legacy_shift_period = p.shift_period;
create index if not exists profiles_schedule_idx on public.profiles (schedule_id, active);

alter table public.crew_placements add column if not exists schedule_id uuid references public.work_schedules(id) on delete cascade;
update public.crew_placements p
set schedule_id = e.schedule_id
from public.employees e
where e.id = p.employee_id and p.schedule_id is null;
alter table public.crew_placements alter column schedule_id set not null;
alter table public.crew_placements alter column shift_color drop not null;
alter table public.crew_placements alter column shift_period drop not null;
drop index if exists public.crew_placements_position_crew_idx;
create unique index if not exists crew_placements_position_schedule_idx
  on public.crew_placements (position_id, schedule_id);

alter table public.pto_entries add column if not exists schedule_name_snapshot text;
update public.pto_entries p
set schedule_name_snapshot = case
  when lower(s.work_group) = lower(s.name) then s.name
  else s.work_group || ' · ' || s.name
end
from public.employees e
join public.work_schedules s on s.id = e.schedule_id
where p.employee_id = e.id and p.schedule_name_snapshot is null;
update public.pto_entries set schedule_name_snapshot = 'Legacy schedule' where schedule_name_snapshot is null;
alter table public.pto_entries alter column schedule_name_snapshot set not null;
alter table public.pto_entries drop constraint if exists pto_schedule_name_snapshot_check;
alter table public.pto_entries add constraint pto_schedule_name_snapshot_check
  check (char_length(schedule_name_snapshot) between 1 and 205);

alter table public.overtime_entries drop constraint if exists overtime_company_text_check;
alter table public.overtime_entries add constraint overtime_company_text_check check (
  char_length(department_name_snapshot) between 1 and 100
  and char_length(employee_name_snapshot) between 1 and 100
  and char_length(shift_name_snapshot) between 1 and 205
  and char_length(reason) between 1 and 100
);

-- Convert existing one-day Blue/Yellow corrections into per-schedule hours.
insert into public.work_schedule_overrides (schedule_id, work_date, hours, reason, updated_by, updated_at)
select
  s.id,
  o.work_date,
  case when s.legacy_shift_color = o.shift_color then 12 else 0 end,
  o.reason,
  o.updated_by,
  o.updated_at
from public.schedule_overrides o
cross join public.work_schedules s
where s.legacy_shift_color is not null
on conflict (schedule_id, work_date) do nothing;

alter table public.work_schedules enable row level security;
alter table public.work_schedules force row level security;
alter table public.work_schedule_rules enable row level security;
alter table public.work_schedule_rules force row level security;
alter table public.work_schedule_overrides enable row level security;
alter table public.work_schedule_overrides force row level security;

revoke all on table public.work_schedules from anon, authenticated;
revoke all on table public.work_schedule_rules from anon, authenticated;
revoke all on table public.work_schedule_overrides from anon, authenticated;
grant select, insert, update on table public.work_schedules to authenticated;
grant select, insert, update on table public.work_schedule_rules to authenticated;
grant select, insert, update, delete on table public.work_schedule_overrides to authenticated;
grant all on table public.work_schedules to service_role;
grant all on table public.work_schedule_rules to service_role;
grant all on table public.work_schedule_overrides to service_role;

create policy work_schedules_approved_select on public.work_schedules
  for select to authenticated using (private.tracker_is_approved());
create policy work_schedules_admin_insert on public.work_schedules
  for insert to authenticated with check (private.tracker_is_admin());
create policy work_schedules_admin_update on public.work_schedules
  for update to authenticated using (private.tracker_is_admin()) with check (private.tracker_is_admin());
create policy work_schedule_rules_approved_select on public.work_schedule_rules
  for select to authenticated using (private.tracker_is_approved());
create policy work_schedule_rules_admin_insert on public.work_schedule_rules
  for insert to authenticated with check (private.tracker_is_admin());
create policy work_schedule_rules_admin_update on public.work_schedule_rules
  for update to authenticated using (private.tracker_is_admin()) with check (private.tracker_is_admin());
create policy work_schedule_overrides_approved_select on public.work_schedule_overrides
  for select to authenticated using (private.tracker_is_approved());
create policy work_schedule_overrides_admin_insert on public.work_schedule_overrides
  for insert to authenticated with check (private.tracker_is_admin());
create policy work_schedule_overrides_admin_update on public.work_schedule_overrides
  for update to authenticated using (private.tracker_is_admin()) with check (private.tracker_is_admin());
create policy work_schedule_overrides_admin_delete on public.work_schedule_overrides
  for delete to authenticated using (private.tracker_is_admin());

create or replace function private.prepare_work_schedule()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  department_active boolean;
begin
  new.work_group := trim(new.work_group);
  new.name := trim(new.name);
  if char_length(new.work_group) < 1 or char_length(new.name) < 1 then
    raise exception 'Work group and schedule name are required.';
  end if;
  if (new.legacy_shift_color is null) <> (new.legacy_shift_period is null) then
    raise exception 'Blue/Yellow schedules require both a color and Day or Night period.';
  end if;
  select d.active into department_active from public.departments d where d.id = new.department_id;
  if department_active is not true then raise exception 'Schedules require an active department.'; end if;
  if tg_op = 'UPDATE' and new.department_id is distinct from old.department_id then
    raise exception 'A schedule cannot be moved to another department. Add a new schedule instead.';
  end if;
  if tg_op = 'UPDATE' and old.active and not new.active and (
    exists (select 1 from public.employees e where e.schedule_id = old.id and e.active)
    or exists (select 1 from public.profiles p where p.schedule_id = old.id and p.active and p.role = 'supervisor')
  ) then
    raise exception 'Move or deactivate active employees and supervisors before deactivating this schedule.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger work_schedule_guard
before insert or update on public.work_schedules
for each row execute function private.prepare_work_schedule();

create or replace function private.validate_schedule_rule()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  schedule_created_date date;
begin
  if cardinality(new.cycle_hours) not in (7, 14) then
    raise exception 'A schedule cycle must contain 7 or 14 days.';
  end if;
  if exists (select 1 from unnest(new.cycle_hours) value where value < 0 or value > 24 or value * 4 <> trunc(value * 4)) then
    raise exception 'Schedule hours must be 0-24 in quarter-hour increments.';
  end if;
  if not exists (select 1 from unnest(new.cycle_hours) value where value > 0) then
    raise exception 'A work schedule must contain at least one working day.';
  end if;
  if tg_op = 'UPDATE' and (new.schedule_id is distinct from old.schedule_id or new.effective_from is distinct from old.effective_from) then
    raise exception 'Schedule rule identity cannot be changed.';
  end if;
  if tg_op = 'UPDATE' and old.effective_from < current_date then
    raise exception 'Past schedule rules are history and cannot be rewritten. Add a new effective date.';
  end if;
  select s.created_at::date into schedule_created_date from public.work_schedules s where s.id = new.schedule_id;
  if schedule_created_date is null then raise exception 'Select a valid work schedule.'; end if;
  if tg_op = 'INSERT' and schedule_created_date < current_date and new.effective_from < current_date then
    raise exception 'New schedule rules must start today or later so prior scheduling history is preserved.';
  end if;
  return new;
end;
$$;

create trigger work_schedule_rule_guard
before insert or update on public.work_schedule_rules
for each row execute function private.validate_schedule_rule();

create or replace function public.save_work_schedule(
  target_schedule_id uuid,
  target_department_id uuid,
  selected_work_group text,
  selected_name text,
  selected_legacy_shift_color text,
  selected_legacy_shift_period text,
  target_active boolean,
  rule_effective_from date,
  rule_anchor_date date,
  rule_cycle_hours numeric[]
)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  saved_schedule_id uuid;
begin
  if not private.tracker_is_admin() then raise exception 'Administrator access is required.'; end if;
  if target_schedule_id is null then
    insert into public.work_schedules (department_id, work_group, name, legacy_shift_color, legacy_shift_period, active)
    values (target_department_id, selected_work_group, selected_name, selected_legacy_shift_color, selected_legacy_shift_period, true)
    returning id into saved_schedule_id;
  else
    update public.work_schedules
    set work_group = selected_work_group, name = selected_name, legacy_shift_color = selected_legacy_shift_color, legacy_shift_period = selected_legacy_shift_period, active = target_active
    where id = target_schedule_id and department_id = target_department_id
    returning id into saved_schedule_id;
    if saved_schedule_id is null then raise exception 'Select a schedule configured for this department.'; end if;
  end if;

  update public.employees
  set shift_color = selected_legacy_shift_color, shift_period = selected_legacy_shift_period
  where schedule_id = saved_schedule_id;
  update public.profiles
  set shift_color = selected_legacy_shift_color, shift_period = selected_legacy_shift_period
  where schedule_id = saved_schedule_id;
  update public.crew_placements
  set shift_color = selected_legacy_shift_color, shift_period = selected_legacy_shift_period
  where schedule_id = saved_schedule_id;

  insert into public.work_schedule_rules (schedule_id, effective_from, anchor_date, cycle_hours)
  values (saved_schedule_id, rule_effective_from, rule_anchor_date, rule_cycle_hours)
  on conflict (schedule_id, effective_from) do update
    set anchor_date = excluded.anchor_date, cycle_hours = excluded.cycle_hours;
  return saved_schedule_id;
end;
$$;

create or replace function public.save_work_schedule_day(
  target_work_date date,
  selected_reason text,
  selected_changes jsonb
)
returns integer language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  change_item jsonb;
  selected_schedule_id uuid;
  changed_count integer := 0;
begin
  if not private.tracker_is_admin() then raise exception 'Administrator access is required.'; end if;
  if target_work_date is null then raise exception 'Choose a valid work date.'; end if;
  if jsonb_typeof(selected_changes) <> 'array' or jsonb_array_length(selected_changes) not between 1 and 200 then
    raise exception 'Choose between 1 and 200 schedule adjustments.';
  end if;
  if char_length(coalesce(selected_reason, '')) > 250 then raise exception 'Adjustment reason must be 250 characters or fewer.'; end if;

  for change_item in select value from jsonb_array_elements(selected_changes) loop
    selected_schedule_id := (change_item ->> 'scheduleId')::uuid;
    if not exists (select 1 from public.work_schedules s where s.id = selected_schedule_id) then
      raise exception 'A schedule adjustment references an unknown schedule.';
    end if;
    if coalesce((change_item ->> 'reset')::boolean, false) then
      delete from public.work_schedule_overrides where schedule_id = selected_schedule_id and work_date = target_work_date;
    else
      insert into public.work_schedule_overrides (schedule_id, work_date, hours, reason, updated_by, updated_at)
      values (selected_schedule_id, target_work_date, (change_item ->> 'hours')::numeric, coalesce(trim(selected_reason), ''), actor_email, now())
      on conflict (schedule_id, work_date) do update
        set hours = excluded.hours, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    end if;
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end;
$$;

create or replace function private.schedule_hours_for_date(target_schedule_id uuid, target_date date)
returns numeric language plpgsql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  adjusted_hours numeric;
  legacy_schedule_color text;
  overall_shift_color text;
  selected_rule public.work_schedule_rules%rowtype;
  cycle_index integer;
begin
  select o.hours into adjusted_hours
  from public.work_schedule_overrides o
  where o.schedule_id = target_schedule_id and o.work_date = target_date;
  if found then return adjusted_hours; end if;

  select s.legacy_shift_color into legacy_schedule_color
  from public.work_schedules s
  where s.id = target_schedule_id;

  if legacy_schedule_color is not null then
    select o.shift_color into overall_shift_color
    from public.schedule_overrides o
    where o.work_date = target_date;
    if found then
      return case when overall_shift_color = legacy_schedule_color then 12 else 0 end;
    end if;
  end if;

  select * into selected_rule
  from public.work_schedule_rules r
  where r.schedule_id = target_schedule_id and r.effective_from <= target_date
  order by r.effective_from desc
  limit 1;
  if selected_rule.id is null then return 0; end if;

  cycle_index := (
    ((target_date - selected_rule.anchor_date) % cardinality(selected_rule.cycle_hours))
      + cardinality(selected_rule.cycle_hours)
  ) % cardinality(selected_rule.cycle_hours) + 1;
  return coalesce(selected_rule.cycle_hours[cycle_index], 0);
end;
$$;

create or replace function private.employee_scheduled_hours(target_employee_id uuid, target_date date)
returns numeric language sql stable security definer set search_path = pg_catalog, public, private, pg_temp as $$
  select coalesce(private.schedule_hours_for_date(e.schedule_id, target_date), 0)
  from public.employees e
  where e.id = target_employee_id;
$$;

create or replace function private.validate_employee_schedule()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  selected_schedule public.work_schedules%rowtype;
begin
  select * into selected_schedule from public.work_schedules where id = new.schedule_id;
  if selected_schedule.id is null or selected_schedule.department_id <> new.department_id then
    raise exception 'Select a schedule configured for this employee''s department.';
  end if;
  if not selected_schedule.active and (tg_op = 'INSERT' or new.schedule_id is distinct from old.schedule_id) then
    raise exception 'Select an active work schedule.';
  end if;
  new.shift_color := selected_schedule.legacy_shift_color;
  new.shift_period := selected_schedule.legacy_shift_period;
  return new;
end;
$$;

create trigger employees_schedule_guard
before insert or update of schedule_id, department_id on public.employees
for each row execute function private.validate_employee_schedule();

create or replace function public.validate_overtime_schedule()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  employee_name text;
  employee_active boolean;
  planned_hours numeric;
begin
  select e.name, e.active into employee_name, employee_active
  from public.employees e where e.id = new.employee_id;
  if employee_name is null or employee_active is not true then raise exception 'Select an active employee.'; end if;
  planned_hours := private.employee_scheduled_hours(new.employee_id, new.work_date);
  if planned_hours > 0 then
    raise exception '% is already scheduled for % hours on %.', employee_name, planned_hours, new.work_date;
  end if;
  return new;
end;
$$;

create or replace function public.prepare_overtime_company_fields()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  selected_employee public.employees%rowtype;
  selected_department public.departments%rowtype;
  selected_schedule public.work_schedules%rowtype;
begin
  select * into selected_employee from public.employees where id = new.employee_id;
  if selected_employee.id is null or selected_employee.active is not true then raise exception 'Select an active employee.'; end if;
  select * into selected_department from public.departments where id = new.department_id;
  if selected_department.id is null then raise exception 'Select a valid department.'; end if;
  if selected_department.active is not true and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id) then raise exception 'Select an active department.'; end if;
  select * into selected_schedule from public.work_schedules where id = selected_employee.schedule_id;

  new.cost_code := upper(trim(new.cost_code));
  new.reason := trim(new.reason);
  if char_length(new.cost_code) < 1 or char_length(new.reason) < 1 then raise exception 'Department, cost code, and reason are required.'; end if;
  if tg_op = 'INSERT' then
    new.employee_name_snapshot := selected_employee.name;
    new.shift_name_snapshot := case when lower(selected_schedule.work_group) = lower(selected_schedule.name) then selected_schedule.name else selected_schedule.work_group || ' · ' || selected_schedule.name end;
  else
    new.entered_by := old.entered_by;
    new.employee_name_snapshot := old.employee_name_snapshot;
    new.shift_name_snapshot := old.shift_name_snapshot;
  end if;
  new.department_name_snapshot := selected_department.name;

  if exists (
    select 1 from public.overtime_entries existing
    where existing.employee_id = new.employee_id and existing.work_date = new.work_date
      and existing.department_id = new.department_id and lower(existing.cost_code) = lower(new.cost_code)
      and existing.id <> new.id
  ) then raise exception 'An overtime entry already exists for this employee, date, department, and cost code. Edit the existing entry or use a different cost code.'; end if;
  return new;
end;
$$;

create or replace function private.prepare_pto_entry()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  selected_employee public.employees%rowtype;
  selected_schedule public.work_schedules%rowtype;
  planned_hours numeric;
begin
  select * into selected_employee from public.employees where id = new.employee_id;
  if selected_employee.id is null or selected_employee.active is not true then raise exception 'Select an active employee.'; end if;
  planned_hours := private.employee_scheduled_hours(new.employee_id, new.pto_date);
  if planned_hours <= 0 then raise exception '% is not scheduled to work on %; no PTO entry was created.', selected_employee.name, new.pto_date; end if;
  if new.hours <= 0 or new.hours > planned_hours or new.hours * 4 <> trunc(new.hours * 4) then
    raise exception 'PTO hours must be in quarter-hour increments and cannot exceed the % scheduled hours on %.', planned_hours, new.pto_date;
  end if;
  if exists (
    select 1 from public.pto_entries existing
    where existing.employee_id = new.employee_id and existing.pto_date = new.pto_date and existing.id <> new.id
  ) then raise exception 'This employee already has a PTO entry on this date. Edit the existing entry instead.'; end if;
  select * into selected_schedule from public.work_schedules where id = selected_employee.schedule_id;
  if tg_op = 'INSERT' then
    new.schedule_name_snapshot := case when lower(selected_schedule.work_group) = lower(selected_schedule.name) then selected_schedule.name else selected_schedule.work_group || ' · ' || selected_schedule.name end;
  else
    new.entered_by := old.entered_by;
    new.schedule_name_snapshot := old.schedule_name_snapshot;
  end if;
  return new;
end;
$$;

create trigger pto_schedule_guard
before insert or update on public.pto_entries
for each row execute function private.prepare_pto_entry();

create or replace function public.add_scheduled_pto_range(
  target_employee_id uuid,
  start_date date,
  end_date date,
  fixed_hours numeric,
  selected_pto_type text,
  selected_notes text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  employee_name text;
  work_date date;
  planned_hours numeric;
  entry_hours numeric;
  added_count integer := 0;
  off_count integer := 0;
  existing_count integer := 0;
begin
  if not private.tracker_can_write() then raise exception 'Supervisor access is required.'; end if;
  if start_date is null or end_date is null or start_date > end_date or end_date - start_date > 365 then raise exception 'Choose a valid PTO range of 366 days or fewer.'; end if;
  if char_length(trim(selected_pto_type)) < 1 or char_length(trim(selected_pto_type)) > 50 then raise exception 'Select a valid PTO type.'; end if;
  if char_length(coalesce(selected_notes, '')) > 500 then raise exception 'PTO notes must be 500 characters or fewer.'; end if;
  if fixed_hours is not null and (fixed_hours <= 0 or fixed_hours > 24 or fixed_hours * 4 <> trunc(fixed_hours * 4)) then raise exception 'PTO hours must be 0.25-24 in quarter-hour increments.'; end if;
  select e.name into employee_name from public.employees e where e.id = target_employee_id and e.active;
  if employee_name is null then raise exception 'Select an active employee.'; end if;

  for work_date in select generate_series(start_date, end_date, interval '1 day')::date loop
    planned_hours := private.employee_scheduled_hours(target_employee_id, work_date);
    if planned_hours <= 0 then
      off_count := off_count + 1;
    elsif exists (select 1 from public.pto_entries p where p.employee_id = target_employee_id and p.pto_date = work_date) then
      existing_count := existing_count + 1;
    else
      entry_hours := coalesce(fixed_hours, planned_hours);
      insert into public.pto_entries (employee_id, pto_date, hours, pto_type, notes, entered_by)
      values (target_employee_id, work_date, entry_hours, trim(selected_pto_type), coalesce(selected_notes, ''), actor_email);
      added_count := added_count + 1;
    end if;
  end loop;
  if added_count = 0 then raise exception 'No PTO was added. Every date was an off day or already had a PTO entry.'; end if;
  return jsonb_build_object('added', added_count, 'off_days_skipped', off_count, 'existing_dates_skipped', existing_count);
end;
$$;

-- Supervisor scope and crew placement now follow the selected department
-- schedule instead of assuming every employee belongs to Blue/Yellow Day/Night.
create or replace function public.validate_profile_assignment()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  department_active boolean;
  selected_schedule public.work_schedules%rowtype;
begin
  if new.role = 'supervisor' then
    if new.department_id is null or new.schedule_id is null then raise exception 'Supervisors require a department and work-schedule assignment.'; end if;
    select d.active into department_active from public.departments d where d.id = new.department_id;
    select * into selected_schedule from public.work_schedules s where s.id = new.schedule_id;
    if department_active is not true or selected_schedule.id is null or not selected_schedule.active or selected_schedule.department_id <> new.department_id then
      raise exception 'Supervisors must be assigned to an active schedule in their department.';
    end if;
    new.shift_color := selected_schedule.legacy_shift_color;
    new.shift_period := selected_schedule.legacy_shift_period;
  else
    new.department_id := null;
    new.schedule_id := null;
    new.shift_color := null;
    new.shift_period := null;
  end if;
  return new;
end;
$$;

create or replace function private.crew_placement_in_scope(target_employee_id uuid)
returns boolean language sql stable security definer set search_path = public, private, pg_temp as $$
  select private.tracker_is_admin()
  or exists (
    select 1 from public.profiles p join public.employees e on e.id = target_employee_id
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.active and p.role = 'supervisor'
      and p.department_id = e.department_id and p.schedule_id = e.schedule_id
  );
$$;

create or replace function private.validate_crew_placement()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  employee_row public.employees%rowtype;
  position_department_id uuid;
begin
  select * into employee_row from public.employees where id = new.employee_id;
  if employee_row.id is null or not employee_row.active then raise exception 'Crew placements require an active employee.'; end if;
  select s.department_id into position_department_id
  from public.crew_positions p join public.crew_systems s on s.id = p.system_id
  where p.id = new.position_id and p.active and s.active;
  if position_department_id is null or position_department_id <> employee_row.department_id then raise exception 'The employee and position must belong to the same active department.'; end if;
  new.schedule_id := employee_row.schedule_id;
  new.shift_color := employee_row.shift_color;
  new.shift_period := employee_row.shift_period;
  new.updated_by := lower(coalesce(auth.jwt() ->> 'email', new.updated_by, 'system'));
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.clear_changed_employee_placement()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if not new.active or new.department_id is distinct from old.department_id or new.schedule_id is distinct from old.schedule_id then
    delete from public.crew_placements where employee_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.move_crew_employee(target_employee_id uuid, target_position_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public, private, pg_temp as $$
declare
  employee_row public.employees%rowtype;
  target_department_id uuid;
  old_position_id uuid;
  displaced_employee_id uuid;
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not private.crew_placement_in_scope(target_employee_id) then raise exception 'You can only change placements for your assigned department and schedule.'; end if;
  select * into employee_row from public.employees where id = target_employee_id and active = true;
  if employee_row.id is null then raise exception 'Select an active employee.'; end if;
  select s.department_id into target_department_id from public.crew_positions p join public.crew_systems s on s.id = p.system_id
  where p.id = target_position_id and p.active = true and s.active = true;
  if target_department_id is null or target_department_id <> employee_row.department_id then raise exception 'The employee and position must belong to the same department.'; end if;
  select position_id into old_position_id from public.crew_placements where employee_id = target_employee_id;
  if old_position_id = target_position_id then return; end if;
  select employee_id into displaced_employee_id from public.crew_placements
  where position_id = target_position_id and schedule_id = employee_row.schedule_id;
  delete from public.crew_placements where employee_id in (target_employee_id, displaced_employee_id);
  insert into public.crew_placements (employee_id, position_id, schedule_id, shift_color, shift_period, updated_by)
  values (target_employee_id, target_position_id, employee_row.schedule_id, employee_row.shift_color, employee_row.shift_period, actor_email);
  if displaced_employee_id is not null and old_position_id is not null and old_position_id <> target_position_id then
    insert into public.crew_placements (employee_id, position_id, schedule_id, shift_color, shift_period, updated_by)
    values (displaced_employee_id, old_position_id, employee_row.schedule_id, employee_row.shift_color, employee_row.shift_period, actor_email);
  end if;
end;
$$;

drop trigger if exists crew_employee_assignment_cleanup on public.employees;
create trigger crew_employee_assignment_cleanup
after update of department_id, schedule_id, active on public.employees
for each row execute function private.clear_changed_employee_placement();

drop trigger if exists audit_work_schedules_change on public.work_schedules;
create trigger audit_work_schedules_change after insert or update or delete on public.work_schedules
for each row execute function public.log_tracker_change();
drop trigger if exists audit_work_schedule_rules_change on public.work_schedule_rules;
create trigger audit_work_schedule_rules_change after insert or update or delete on public.work_schedule_rules
for each row execute function public.log_tracker_change();
drop trigger if exists audit_work_schedule_overrides_change on public.work_schedule_overrides;
create trigger audit_work_schedule_overrides_change after insert or update or delete on public.work_schedule_overrides
for each row execute function public.log_tracker_change();

revoke all on function private.prepare_work_schedule() from public, anon, authenticated;
revoke all on function private.validate_schedule_rule() from public, anon, authenticated;
revoke all on function public.save_work_schedule(uuid, uuid, text, text, text, text, boolean, date, date, numeric[]) from public, anon;
grant execute on function public.save_work_schedule(uuid, uuid, text, text, text, text, boolean, date, date, numeric[]) to authenticated;
revoke all on function public.save_work_schedule_day(date, text, jsonb) from public, anon;
grant execute on function public.save_work_schedule_day(date, text, jsonb) to authenticated;
revoke all on function private.schedule_hours_for_date(uuid, date) from public, anon, authenticated;
revoke all on function private.employee_scheduled_hours(uuid, date) from public, anon, authenticated;
revoke all on function private.validate_employee_schedule() from public, anon, authenticated;
revoke all on function private.prepare_pto_entry() from public, anon, authenticated;
revoke all on function public.add_scheduled_pto_range(uuid, date, date, numeric, text, text) from public, anon;
grant execute on function public.add_scheduled_pto_range(uuid, date, date, numeric, text, text) to authenticated;

commit;
