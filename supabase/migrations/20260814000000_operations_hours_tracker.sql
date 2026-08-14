begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  email text primary key,
  full_name text not null,
  role text not null check (role in ('admin', 'supervisor', 'viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shift_color text not null check (shift_color in ('Blue', 'Yellow')),
  shift_period text not null check (shift_period in ('Day', 'Night')),
  department text not null default 'Extrusion',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  work_date date not null,
  employee_id uuid not null references public.employees(id) on delete restrict,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  cost_code text not null,
  notes text not null default '',
  entered_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pto_entries (
  id uuid primary key default gen_random_uuid(),
  pto_date date not null,
  employee_id uuid not null references public.employees(id) on delete restrict,
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  pto_type text not null,
  notes text not null default '',
  entered_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_overrides (
  work_date date primary key,
  shift_color text not null check (shift_color in ('Blue', 'Yellow')),
  reason text not null default '',
  updated_by text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  user_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists employees_shift_idx on public.employees (shift_color, shift_period);
create index if not exists ot_date_idx on public.overtime_entries (work_date);
create index if not exists ot_employee_idx on public.overtime_entries (employee_id);
create index if not exists pto_date_idx on public.pto_entries (pto_date);
create index if not exists pto_employee_idx on public.pto_entries (employee_id);
create index if not exists audit_created_idx on public.audit_log (created_at desc);

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.overtime_entries enable row level security;
alter table public.pto_entries enable row level security;
alter table public.schedule_overrides enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_settings enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.employees from anon, authenticated;
revoke all on table public.overtime_entries from anon, authenticated;
revoke all on table public.pto_entries from anon, authenticated;
revoke all on table public.schedule_overrides from anon, authenticated;
revoke all on table public.audit_log from anon, authenticated;
revoke all on table public.app_settings from anon, authenticated;

grant all on table public.profiles to service_role;
grant all on table public.employees to service_role;
grant all on table public.overtime_entries to service_role;
grant all on table public.pto_entries to service_role;
grant all on table public.schedule_overrides to service_role;
grant all on table public.audit_log to service_role;
grant all on table public.app_settings to service_role;

insert into public.app_settings (key, value)
values ('production_ready_reset_2026_08_14', 'ready')
on conflict (key) do update set value = excluded.value, updated_at = now();

commit;
