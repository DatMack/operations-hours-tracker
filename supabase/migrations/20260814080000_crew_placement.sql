begin;

create table if not exists public.crew_systems (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 100),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crew_systems_department_name_idx
  on public.crew_systems (department_id, lower(name));

create table if not exists public.crew_positions (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.crew_systems(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  sort_order integer not null default 0,
  required boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crew_positions_system_name_idx
  on public.crew_positions (system_id, lower(name));

create table if not exists public.crew_placements (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  position_id uuid not null references public.crew_positions(id) on delete restrict,
  shift_color text not null check (shift_color in ('Blue', 'Yellow')),
  shift_period text not null check (shift_period in ('Day', 'Night')),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists crew_placements_position_crew_idx
  on public.crew_placements (position_id, shift_color, shift_period);

create table if not exists public.crew_placement_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  previous_position_id uuid references public.crew_positions(id) on delete set null,
  next_position_id uuid references public.crew_positions(id) on delete set null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create index if not exists crew_placement_history_employee_idx
  on public.crew_placement_history (employee_id, changed_at desc);

create or replace function private.crew_placement_in_scope(target_employee_id uuid)
returns boolean language sql stable security definer set search_path = public, private, pg_temp as $$
  select private.tracker_is_admin()
  or exists (
    select 1 from public.profiles p
    join public.employees e on e.id = target_employee_id
    where lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and p.active and p.role = 'supervisor'
      and p.department_id = e.department_id
      and p.shift_color = e.shift_color
      and p.shift_period = e.shift_period
  );
$$;

revoke all on function private.crew_placement_in_scope(uuid) from public, anon;
grant execute on function private.crew_placement_in_scope(uuid) to authenticated;

create or replace function private.validate_crew_placement()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
declare
  employee_row public.employees%rowtype;
  position_department_id uuid;
begin
  select * into employee_row from public.employees where id = new.employee_id;
  if employee_row.id is null or not employee_row.active then
    raise exception 'Crew placements require an active employee.';
  end if;

  select s.department_id into position_department_id
  from public.crew_positions p
  join public.crew_systems s on s.id = p.system_id
  where p.id = new.position_id and p.active and s.active;
  if position_department_id is null or position_department_id <> employee_row.department_id then
    raise exception 'The employee and position must belong to the same active department.';
  end if;

  new.shift_color := employee_row.shift_color;
  new.shift_period := employee_row.shift_period;
  new.updated_by := lower(coalesce(auth.jwt() ->> 'email', new.updated_by, 'system'));
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.log_crew_placement_change()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  insert into public.crew_placement_history (employee_id, previous_position_id, next_position_id, changed_by)
  values (
    coalesce(new.employee_id, old.employee_id),
    case when tg_op = 'INSERT' then null else old.position_id end,
    case when tg_op = 'DELETE' then null else new.position_id end,
    lower(coalesce(auth.jwt() ->> 'email', 'system'))
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.clear_changed_employee_placement()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if not new.active
    or new.department_id is distinct from old.department_id
    or new.shift_color is distinct from old.shift_color
    or new.shift_period is distinct from old.shift_period then
    delete from public.crew_placements where employee_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function private.clear_inactive_position_placements()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if old.active and not new.active then
    delete from public.crew_placements where position_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function private.clear_inactive_system_placements()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if old.active and not new.active then
    delete from public.crew_placements
    where position_id in (select id from public.crew_positions where system_id = new.id);
  end if;
  return new;
end;
$$;

create or replace function public.move_crew_employee(target_employee_id uuid, target_position_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  employee_row public.employees%rowtype;
  target_department_id uuid;
  old_position_id uuid;
  displaced_employee_id uuid;
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not private.crew_placement_in_scope(target_employee_id) then
    raise exception 'You can only change placements for your assigned department.';
  end if;

  select * into employee_row from public.employees where id = target_employee_id and active = true;
  if employee_row.id is null then raise exception 'Select an active employee.'; end if;

  select s.department_id into target_department_id
  from public.crew_positions p join public.crew_systems s on s.id = p.system_id
  where p.id = target_position_id and p.active = true and s.active = true;
  if target_department_id is null or target_department_id <> employee_row.department_id then
    raise exception 'The employee and position must belong to the same department.';
  end if;

  select position_id into old_position_id from public.crew_placements where employee_id = target_employee_id;
  if old_position_id = target_position_id then return; end if;
  select employee_id into displaced_employee_id
  from public.crew_placements
  where position_id = target_position_id
    and shift_color = employee_row.shift_color
    and shift_period = employee_row.shift_period;

  delete from public.crew_placements
  where employee_id in (target_employee_id, displaced_employee_id);

  insert into public.crew_placements (employee_id, position_id, shift_color, shift_period, updated_by)
  values (target_employee_id, target_position_id, employee_row.shift_color, employee_row.shift_period, actor_email);

  if displaced_employee_id is not null and old_position_id is not null and old_position_id <> target_position_id then
    insert into public.crew_placements (employee_id, position_id, shift_color, shift_period, updated_by)
    values (displaced_employee_id, old_position_id, employee_row.shift_color, employee_row.shift_period, actor_email);
  end if;
end;
$$;

revoke all on function public.move_crew_employee(uuid, uuid) from public, anon;
grant execute on function public.move_crew_employee(uuid, uuid) to authenticated;

drop trigger if exists crew_placement_history_trigger on public.crew_placements;
drop trigger if exists crew_placement_validation_trigger on public.crew_placements;
create trigger crew_placement_validation_trigger
before insert or update on public.crew_placements
for each row execute function private.validate_crew_placement();

create trigger crew_placement_history_trigger
after insert or update of position_id or delete on public.crew_placements
for each row execute function private.log_crew_placement_change();

drop trigger if exists crew_employee_assignment_cleanup on public.employees;
create trigger crew_employee_assignment_cleanup
after update of department_id, shift_color, shift_period, active on public.employees
for each row execute function private.clear_changed_employee_placement();

drop trigger if exists crew_position_assignment_cleanup on public.crew_positions;
create trigger crew_position_assignment_cleanup
after update of active on public.crew_positions
for each row execute function private.clear_inactive_position_placements();

drop trigger if exists crew_system_assignment_cleanup on public.crew_systems;
create trigger crew_system_assignment_cleanup
after update of active on public.crew_systems
for each row execute function private.clear_inactive_system_placements();

drop trigger if exists audit_crew_systems_change on public.crew_systems;
create trigger audit_crew_systems_change
after insert or update or delete on public.crew_systems
for each row execute function public.log_tracker_change();

drop trigger if exists audit_crew_positions_change on public.crew_positions;
create trigger audit_crew_positions_change
after insert or update or delete on public.crew_positions
for each row execute function public.log_tracker_change();

revoke all on function private.validate_crew_placement() from public, anon, authenticated;
revoke all on function private.log_crew_placement_change() from public, anon, authenticated;
revoke all on function private.clear_changed_employee_placement() from public, anon, authenticated;
revoke all on function private.clear_inactive_position_placements() from public, anon, authenticated;
revoke all on function private.clear_inactive_system_placements() from public, anon, authenticated;

alter table public.crew_systems enable row level security;
alter table public.crew_positions enable row level security;
alter table public.crew_placements enable row level security;
alter table public.crew_placement_history enable row level security;
alter table public.crew_systems force row level security;
alter table public.crew_positions force row level security;
alter table public.crew_placements force row level security;
alter table public.crew_placement_history force row level security;

revoke all on public.crew_systems, public.crew_positions, public.crew_placements, public.crew_placement_history from anon, authenticated;
grant select, insert, update, delete on public.crew_systems, public.crew_positions to authenticated;
grant select, insert, update, delete on public.crew_placements to authenticated;
grant select on public.crew_placement_history to authenticated;

drop policy if exists crew_systems_read on public.crew_systems;
drop policy if exists crew_systems_admin_write on public.crew_systems;
create policy crew_systems_read on public.crew_systems for select to authenticated using (private.tracker_is_approved());
create policy crew_systems_admin_write on public.crew_systems for all to authenticated using (private.tracker_is_admin()) with check (private.tracker_is_admin());

drop policy if exists crew_positions_read on public.crew_positions;
drop policy if exists crew_positions_admin_write on public.crew_positions;
create policy crew_positions_read on public.crew_positions for select to authenticated using (private.tracker_is_approved());
create policy crew_positions_admin_write on public.crew_positions for all to authenticated using (private.tracker_is_admin()) with check (private.tracker_is_admin());

drop policy if exists crew_placements_read on public.crew_placements;
drop policy if exists crew_placements_write on public.crew_placements;
create policy crew_placements_read on public.crew_placements for select to authenticated using (private.tracker_is_approved());
create policy crew_placements_write on public.crew_placements for all to authenticated
  using (private.crew_placement_in_scope(employee_id))
  with check (private.crew_placement_in_scope(employee_id));

drop policy if exists crew_placement_history_read on public.crew_placement_history;
create policy crew_placement_history_read on public.crew_placement_history for select to authenticated using (private.tracker_is_approved());

commit;
