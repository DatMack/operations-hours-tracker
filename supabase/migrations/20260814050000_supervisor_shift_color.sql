begin;

alter table public.profiles add column if not exists shift_color text;
alter table public.profiles drop constraint if exists profiles_shift_color_check;
alter table public.profiles
  add constraint profiles_shift_color_check check (shift_color is null or shift_color in ('Blue', 'Yellow'));

-- Profiles created before supervisor assignments existed may be incomplete. Pause
-- only the assignment guard while those legacy accounts are made safe.
alter table public.profiles disable trigger profiles_assignment_guard;

update public.profiles
set active = false
where role = 'supervisor'
  and active = true
  and (department_id is null or shift_period is null);

update public.profiles
set shift_color = 'Blue'
where role = 'supervisor'
  and shift_color is null
  and department_id is not null
  and shift_period in ('Day', 'Night');

alter table public.profiles enable trigger profiles_assignment_guard;

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
    if new.department_id is null or new.shift_period is null or new.shift_color is null then
      raise exception 'Supervisors require a department, shift color, and Day or Night assignment.';
    end if;
    if new.shift_period not in ('Day', 'Night') or new.shift_color not in ('Blue', 'Yellow') then
      raise exception 'Select a valid supervisor shift.';
    end if;
    select d.active into department_active from public.departments d where d.id = new.department_id;
    if department_active is not true then
      raise exception 'Supervisors must be assigned to an active department.';
    end if;
  else
    new.department_id := null;
    new.shift_period := null;
    new.shift_color := null;
  end if;
  return new;
end;
$$;

revoke all on function public.validate_profile_assignment() from public, anon, authenticated;

commit;
