begin;

-- Company-wide department configuration. Departments are deactivated instead of
-- deleted so employee assignments and historical overtime remain explainable.
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_cost_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists departments_name_unique_idx
  on public.departments (lower(name));

insert into public.departments (name, default_cost_code)
values
  ('Extrusion', 'EXT-100'),
  ('Blend Room', 'BLD-200'),
  ('Warehouse', 'WH-300'),
  ('Pack End', 'PKG-400'),
  ('Maintenance', 'MNT-500'),
  ('Quality', 'QA-600'),
  ('Other', 'OTH-900')
on conflict ((lower(name))) do nothing;

-- Preserve any department names already used during the pilot.
insert into public.departments (name, default_cost_code)
select distinct
  trim(e.department),
  upper(left(regexp_replace(trim(e.department), '[^A-Za-z0-9]+', '', 'g') || 'OTH', 3)) || '-000'
from public.employees e
where trim(e.department) <> ''
  and not exists (
    select 1 from public.departments d
    where lower(d.name) = lower(trim(e.department))
  )
on conflict ((lower(name))) do nothing;

alter table public.employees
  add column if not exists department_id uuid references public.departments(id) on delete restrict;

update public.employees e
set department_id = d.id
from public.departments d
where e.department_id is null
  and lower(d.name) = lower(trim(e.department));

update public.employees e
set department_id = d.id,
    department = d.name
from public.departments d
where e.department_id is null
  and d.name = 'Other';

alter table public.employees alter column department_id set not null;

alter table public.overtime_entries
  add column if not exists department_id uuid references public.departments(id) on delete restrict,
  add column if not exists department_name_snapshot text,
  add column if not exists employee_name_snapshot text,
  add column if not exists shift_name_snapshot text,
  add column if not exists reason text not null default 'Historical entry';

update public.overtime_entries ot
set department_id = e.department_id,
    department_name_snapshot = coalesce(ot.department_name_snapshot, d.name),
    employee_name_snapshot = coalesce(ot.employee_name_snapshot, e.name),
    shift_name_snapshot = coalesce(ot.shift_name_snapshot, e.shift_color || ' ' || e.shift_period),
    reason = coalesce(nullif(trim(ot.reason), ''), 'Historical entry')
from public.employees e
join public.departments d on d.id = e.department_id
where ot.employee_id = e.id;

alter table public.overtime_entries
  alter column department_id set not null,
  alter column department_name_snapshot set not null,
  alter column employee_name_snapshot set not null,
  alter column shift_name_snapshot set not null;

alter table public.overtime_entries drop constraint if exists overtime_quarter_hour_check;
alter table public.overtime_entries
  add constraint overtime_quarter_hour_check check (hours * 4 = trunc(hours * 4));
alter table public.overtime_entries drop constraint if exists overtime_company_text_check;
alter table public.overtime_entries
  add constraint overtime_company_text_check check (
    char_length(department_name_snapshot) between 1 and 100
    and char_length(employee_name_snapshot) between 1 and 100
    and char_length(shift_name_snapshot) between 1 and 30
    and char_length(reason) between 1 and 100
  );
alter table public.overtime_entries drop constraint if exists overtime_reason_check;
alter table public.overtime_entries
  add constraint overtime_reason_check check (reason in (
    'Call-Off Coverage',
    'Production Needs',
    'Training',
    'Maintenance',
    'Staffing Shortage',
    'Project Work',
    'Other',
    'Historical entry',
    'Historical import'
  ));

create index if not exists employees_department_idx on public.employees (department_id, active);
create index if not exists ot_department_date_idx on public.overtime_entries (department_id, work_date);
create index if not exists ot_reason_idx on public.overtime_entries (reason);

alter table public.departments enable row level security;
alter table public.departments force row level security;
revoke all on table public.departments from anon, authenticated;
grant select, insert, update on table public.departments to authenticated;
grant all on table public.departments to service_role;
grant update on table public.overtime_entries to authenticated;

drop policy if exists departments_approved_select on public.departments;
drop policy if exists departments_admin_insert on public.departments;
drop policy if exists departments_admin_update on public.departments;
create policy departments_approved_select on public.departments
  for select to authenticated using (private.tracker_is_approved());
create policy departments_admin_insert on public.departments
  for insert to authenticated with check (private.tracker_is_admin());
create policy departments_admin_update on public.departments
  for update to authenticated
  using (private.tracker_is_admin())
  with check (private.tracker_is_admin());

drop policy if exists overtime_writer_update on public.overtime_entries;
create policy overtime_writer_update on public.overtime_entries
  for update to authenticated
  using (private.tracker_can_write())
  with check (private.tracker_can_write());

create or replace function public.prepare_department()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.name := trim(new.name);
  new.default_cost_code := upper(trim(new.default_cost_code));
  new.updated_at := now();
  if char_length(new.name) < 1 or char_length(new.name) > 100 then
    raise exception 'Department name must be between 1 and 100 characters.';
  end if;
  if char_length(new.default_cost_code) < 1 or char_length(new.default_cost_code) > 50 then
    raise exception 'Default cost code must be between 1 and 50 characters.';
  end if;
  if tg_op = 'UPDATE' and old.active = true and new.active = false then
    if exists (
      select 1 from public.employees e
      where e.department_id = old.id and e.active = true
    ) then
      raise exception 'Move or deactivate active employees before deactivating this department.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists departments_prepare on public.departments;
create trigger departments_prepare
  before insert or update on public.departments
  for each row execute function public.prepare_department();

create or replace function public.sync_employee_department()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  selected_department public.departments%rowtype;
begin
  select * into selected_department
  from public.departments d
  where d.id = new.department_id;

  if selected_department.id is null then
    raise exception 'Select a valid department.';
  end if;
  if selected_department.active is not true and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id) then
    raise exception 'Select an active department.';
  end if;
  new.department := selected_department.name;
  return new;
end;
$$;

drop trigger if exists employees_department_sync on public.employees;
create trigger employees_department_sync
  before insert or update on public.employees
  for each row execute function public.sync_employee_department();

create or replace function public.cascade_department_name()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.name is distinct from old.name then
    update public.employees
    set department = new.name
    where department_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists departments_name_cascade on public.departments;
create trigger departments_name_cascade
  after update of name on public.departments
  for each row execute function public.cascade_department_name();

create or replace function public.prepare_overtime_company_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  selected_employee public.employees%rowtype;
  selected_department public.departments%rowtype;
begin
  select * into selected_employee
  from public.employees e
  where e.id = new.employee_id;
  if selected_employee.id is null or selected_employee.active is not true then
    raise exception 'Select an active employee.';
  end if;

  select * into selected_department
  from public.departments d
  where d.id = new.department_id;
  if selected_department.id is null then
    raise exception 'Select a valid department.';
  end if;
  if selected_department.active is not true and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id) then
    raise exception 'Select an active department.';
  end if;

  new.cost_code := upper(trim(new.cost_code));
  new.reason := trim(new.reason);
  if char_length(new.cost_code) < 1 or char_length(new.reason) < 1 then
    raise exception 'Department, cost code, and reason are required.';
  end if;

  if tg_op = 'INSERT' then
    new.employee_name_snapshot := selected_employee.name;
    new.shift_name_snapshot := selected_employee.shift_color || ' ' || selected_employee.shift_period;
  else
    new.entered_by := old.entered_by;
    new.employee_name_snapshot := old.employee_name_snapshot;
    new.shift_name_snapshot := old.shift_name_snapshot;
  end if;
  new.department_name_snapshot := selected_department.name;

  if exists (
    select 1
    from public.overtime_entries existing
    where existing.employee_id = new.employee_id
      and existing.work_date = new.work_date
      and existing.department_id = new.department_id
      and lower(existing.cost_code) = lower(new.cost_code)
      and existing.id <> new.id
  ) then
    raise exception 'An overtime entry already exists for this employee, date, department, and cost code. Edit the existing entry or use a different cost code.';
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_company_fields_guard on public.overtime_entries;
create trigger overtime_company_fields_guard
  before insert or update on public.overtime_entries
  for each row execute function public.prepare_overtime_company_fields();

drop trigger if exists audit_departments_change on public.departments;
create trigger audit_departments_change
  after insert or update or delete on public.departments
  for each row execute function public.log_tracker_change();

revoke all on function public.prepare_department() from public, anon, authenticated;
revoke all on function public.sync_employee_department() from public, anon, authenticated;
revoke all on function public.cascade_department_name() from public, anon, authenticated;
revoke all on function public.prepare_overtime_company_fields() from public, anon, authenticated;

commit;
