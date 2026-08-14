begin;

create table if not exists public.dashboard_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  widgets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint dashboard_widgets_array check (jsonb_typeof(widgets) = 'array'),
  constraint dashboard_widgets_limit check (jsonb_array_length(widgets) <= 16)
);

alter table public.dashboard_preferences enable row level security;
alter table public.dashboard_preferences force row level security;

revoke all on table public.dashboard_preferences from anon, authenticated;
grant select, insert, update, delete on table public.dashboard_preferences to authenticated;
grant all on table public.dashboard_preferences to service_role;

drop policy if exists dashboard_preferences_own_select on public.dashboard_preferences;
drop policy if exists dashboard_preferences_own_insert on public.dashboard_preferences;
drop policy if exists dashboard_preferences_own_update on public.dashboard_preferences;
drop policy if exists dashboard_preferences_own_delete on public.dashboard_preferences;

create policy dashboard_preferences_own_select on public.dashboard_preferences
  for select to authenticated
  using (auth.uid() = user_id and private.tracker_is_approved());

create policy dashboard_preferences_own_insert on public.dashboard_preferences
  for insert to authenticated
  with check (auth.uid() = user_id and private.tracker_is_approved());

create policy dashboard_preferences_own_update on public.dashboard_preferences
  for update to authenticated
  using (auth.uid() = user_id and private.tracker_is_approved())
  with check (auth.uid() = user_id and private.tracker_is_approved());

create policy dashboard_preferences_own_delete on public.dashboard_preferences
  for delete to authenticated
  using (auth.uid() = user_id and private.tracker_is_approved());

commit;
