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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crew_positions_system_name_idx
  on public.crew_positions (system_id, lower(name));

create table if not exists public.crew_placements (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  position_id uuid not null unique references public.crew_positions(id) on delete restrict,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

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
  );
$$;

revoke all on function private.crew_placement_in_scope(uuid) from public, anon;
grant execute on function private.crew_placement_in_scope(uuid) to authenticated;

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
  return coalesce(new, old);
end;
$$;

drop trigger if exists crew_placement_history_trigger on public.crew_placements;
create trigger crew_placement_history_trigger
after insert or update of position_id or delete on public.crew_placements
for each row execute function private.log_crew_placement_change();

alter table public.crew_systems enable row level security;
alter table public.crew_positions enable row level security;
alter table public.crew_placements enable row level security;
alter table public.crew_placement_history enable row level security;

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
