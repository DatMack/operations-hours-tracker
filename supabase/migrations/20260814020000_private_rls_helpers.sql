begin;

-- Keep SECURITY DEFINER helpers out of Supabase's API-exposed public schema.
-- Policies retain their dependency on these functions when PostgreSQL moves them.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.current_user_email() set schema private;
alter function public.current_user_role() set schema private;
alter function public.tracker_is_approved() set schema private;
alter function public.tracker_can_write() set schema private;
alter function public.tracker_is_admin() set schema private;

create or replace function private.current_user_email()
returns text
language sql
stable
security definer
set search_path = pg_catalog, auth, public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = pg_catalog, auth, public
as $$
  select p.role
  from public.profiles p
  where lower(p.email) = private.current_user_email()
    and p.active = true
  limit 1;
$$;

create or replace function private.tracker_is_approved()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, auth, public
as $$
  select private.current_user_role() in ('admin', 'supervisor', 'viewer');
$$;

create or replace function private.tracker_can_write()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, auth, public
as $$
  select private.current_user_role() in ('admin', 'supervisor');
$$;

create or replace function private.tracker_is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, auth, public
as $$
  select private.current_user_role() = 'admin';
$$;

revoke all on function private.current_user_email() from public, anon;
revoke all on function private.current_user_role() from public, anon;
revoke all on function private.tracker_is_approved() from public, anon;
revoke all on function private.tracker_can_write() from public, anon;
revoke all on function private.tracker_is_admin() from public, anon;
grant execute on function private.current_user_email() to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.tracker_is_approved() to authenticated;
grant execute on function private.tracker_can_write() to authenticated;
grant execute on function private.tracker_is_admin() to authenticated;

-- The audit trigger also records the authenticated actor. Keep the trigger in
-- public (it is not API-callable) while pointing it at the private helper.
create or replace function public.log_tracker_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  row_data jsonb;
  record_id text;
  actor text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  record_id := coalesce(row_data ->> 'id', row_data ->> 'email', row_data ->> 'work_date', row_data ->> 'key', 'unknown');
  actor := nullif(private.current_user_email(), '');
  actor := coalesce(actor, row_data ->> 'entered_by', row_data ->> 'updated_by', 'system');

  insert into public.audit_log (id, action, entity_type, entity_id, details, user_email)
  values (gen_random_uuid(), lower(tg_op), tg_table_name, record_id, row_data, actor);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.log_tracker_change() from public, anon, authenticated;

commit;
