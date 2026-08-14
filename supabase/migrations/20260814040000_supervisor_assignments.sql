begin;

alter table public.profiles
  add column if not exists department_id uuid references public.departments(id) on delete restrict,
  add column if not exists shift_period text;

alter table public.profiles drop constraint if exists profiles_shift_period_check;
alter table public.profiles
  add constraint profiles_shift_period_check check (shift_period is null or shift_period in ('Day', 'Night'));

create index if not exists profiles_department_idx on public.profiles (department_id, active);

create or replace function public.validate_profile_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  department_active boolean;
begin
  if new.role = 'supervisor' then
    if new.department_id is null or new.shift_period is null then
      raise exception 'Supervisors require a department and Day or Night assignment.';
    end if;
    select d.active into department_active from public.departments d where d.id = new.department_id;
    if department_active is not true then
      raise exception 'Supervisors must be assigned to an active department.';
    end if;
  else
    new.department_id := null;
    new.shift_period := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assignment_guard on public.profiles;
create trigger profiles_assignment_guard
  before insert or update on public.profiles
  for each row execute function public.validate_profile_assignment();

create or replace function public.prevent_assigned_department_deactivation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.active = true and new.active = false and exists (
    select 1 from public.profiles p
    where p.department_id = old.id and p.role = 'supervisor' and p.active = true
  ) then
    raise exception 'Reassign or deactivate supervisors before deactivating this department.';
  end if;
  return new;
end;
$$;

drop trigger if exists departments_supervisor_guard on public.departments;
create trigger departments_supervisor_guard
  before update of active on public.departments
  for each row execute function public.prevent_assigned_department_deactivation();

revoke all on function public.validate_profile_assignment() from public, anon, authenticated;
revoke all on function public.prevent_assigned_department_deactivation() from public, anon, authenticated;

commit;
