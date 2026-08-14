begin;

-- Browser clients use Supabase Auth plus this approved-user table. The publishable
-- key may be present in the site bundle; these policies are the real data boundary.
create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where lower(p.email) = public.current_user_email()
    and p.active = true
  limit 1;
$$;

create or replace function public.tracker_is_approved()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_role() in ('admin', 'supervisor', 'viewer');
$$;

create or replace function public.tracker_can_write()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_role() in ('admin', 'supervisor');
$$;

create or replace function public.tracker_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_role() = 'admin';
$$;

revoke all on function public.current_user_email() from public, anon;
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.tracker_is_approved() from public, anon;
revoke all on function public.tracker_can_write() from public, anon;
revoke all on function public.tracker_is_admin() from public, anon;
grant execute on function public.current_user_email() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.tracker_is_approved() to authenticated;
grant execute on function public.tracker_can_write() to authenticated;
grant execute on function public.tracker_is_admin() to authenticated;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.employees from anon, authenticated;
revoke all on table public.overtime_entries from anon, authenticated;
revoke all on table public.pto_entries from anon, authenticated;
revoke all on table public.schedule_overrides from anon, authenticated;
revoke all on table public.audit_log from anon, authenticated;
revoke all on table public.app_settings from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.employees to authenticated;
grant select, insert, delete on table public.overtime_entries to authenticated;
grant select, insert, delete on table public.pto_entries to authenticated;
grant select, insert, update, delete on table public.schedule_overrides to authenticated;
grant select on table public.audit_log to authenticated;
grant select, insert, update, delete on table public.app_settings to authenticated;

drop policy if exists profiles_select_approved on public.profiles;
drop policy if exists profiles_admin_insert on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_select_approved on public.profiles
  for select to authenticated
  using (
    (active = true and lower(email) = public.current_user_email())
    or public.tracker_is_admin()
  );
create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (public.tracker_is_admin());
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.tracker_is_admin())
  with check (public.tracker_is_admin());

drop policy if exists employees_approved_select on public.employees;
drop policy if exists employees_admin_insert on public.employees;
drop policy if exists employees_admin_update on public.employees;
drop policy if exists employees_admin_delete on public.employees;
create policy employees_approved_select on public.employees
  for select to authenticated using (public.tracker_is_approved());
create policy employees_admin_insert on public.employees
  for insert to authenticated with check (public.tracker_is_admin());
create policy employees_admin_update on public.employees
  for update to authenticated using (public.tracker_is_admin()) with check (public.tracker_is_admin());
create policy employees_admin_delete on public.employees
  for delete to authenticated using (public.tracker_is_admin());

drop policy if exists overtime_approved_select on public.overtime_entries;
drop policy if exists overtime_writer_insert on public.overtime_entries;
drop policy if exists overtime_writer_delete on public.overtime_entries;
create policy overtime_approved_select on public.overtime_entries
  for select to authenticated using (public.tracker_is_approved());
create policy overtime_writer_insert on public.overtime_entries
  for insert to authenticated
  with check (public.tracker_can_write() and lower(entered_by) = public.current_user_email());
create policy overtime_writer_delete on public.overtime_entries
  for delete to authenticated using (public.tracker_can_write());

drop policy if exists pto_approved_select on public.pto_entries;
drop policy if exists pto_writer_insert on public.pto_entries;
drop policy if exists pto_writer_delete on public.pto_entries;
create policy pto_approved_select on public.pto_entries
  for select to authenticated using (public.tracker_is_approved());
create policy pto_writer_insert on public.pto_entries
  for insert to authenticated
  with check (public.tracker_can_write() and lower(entered_by) = public.current_user_email());
create policy pto_writer_delete on public.pto_entries
  for delete to authenticated using (public.tracker_can_write());

drop policy if exists overrides_approved_select on public.schedule_overrides;
drop policy if exists overrides_admin_insert on public.schedule_overrides;
drop policy if exists overrides_admin_update on public.schedule_overrides;
drop policy if exists overrides_admin_delete on public.schedule_overrides;
create policy overrides_approved_select on public.schedule_overrides
  for select to authenticated using (public.tracker_is_approved());
create policy overrides_admin_insert on public.schedule_overrides
  for insert to authenticated
  with check (public.tracker_is_admin() and lower(updated_by) = public.current_user_email());
create policy overrides_admin_update on public.schedule_overrides
  for update to authenticated
  using (public.tracker_is_admin())
  with check (public.tracker_is_admin() and lower(updated_by) = public.current_user_email());
create policy overrides_admin_delete on public.schedule_overrides
  for delete to authenticated using (public.tracker_is_admin());

drop policy if exists audit_admin_select on public.audit_log;
create policy audit_admin_select on public.audit_log
  for select to authenticated using (public.tracker_is_admin());

drop policy if exists settings_approved_select on public.app_settings;
drop policy if exists settings_admin_insert on public.app_settings;
drop policy if exists settings_admin_update on public.app_settings;
drop policy if exists settings_admin_delete on public.app_settings;
create policy settings_approved_select on public.app_settings
  for select to authenticated using (public.tracker_is_approved());
create policy settings_admin_insert on public.app_settings
  for insert to authenticated with check (public.tracker_is_admin());
create policy settings_admin_update on public.app_settings
  for update to authenticated using (public.tracker_is_admin()) with check (public.tracker_is_admin());
create policy settings_admin_delete on public.app_settings
  for delete to authenticated using (public.tracker_is_admin());

-- The 2-2-3 rule is duplicated in PostgreSQL so bypassing the UI cannot create
-- overtime for an employee who is already scheduled to work.
create or replace function public.base_shift_for_date(work_date date)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case
    when ((((work_date - date '2026-08-10') % 14) + 14) % 14) in (0, 1, 4, 5, 6, 9, 10) then 'Blue'
    else 'Yellow'
  end;
$$;

create or replace function public.validate_overtime_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  employee_name text;
  employee_color text;
  employee_active boolean;
  working_color text;
begin
  select e.name, e.shift_color, e.active
    into employee_name, employee_color, employee_active
  from public.employees e
  where e.id = new.employee_id;

  if employee_name is null or employee_active is not true then
    raise exception 'Select an active employee.';
  end if;

  select s.shift_color into working_color
  from public.schedule_overrides s
  where s.work_date = new.work_date;
  working_color := coalesce(working_color, public.base_shift_for_date(new.work_date));

  if employee_color = working_color then
    raise exception '% is already scheduled to work on %.', employee_name, new.work_date;
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_schedule_guard on public.overtime_entries;
create trigger overtime_schedule_guard
  before insert or update on public.overtime_entries
  for each row execute function public.validate_overtime_schedule();

-- Audit rows are written by database triggers. Browser users can read them only
-- as administrators and cannot edit or delete them.
create or replace function public.log_tracker_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_data jsonb;
  record_id text;
  actor text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  record_id := coalesce(row_data ->> 'id', row_data ->> 'email', row_data ->> 'work_date', row_data ->> 'key', 'unknown');
  actor := nullif(public.current_user_email(), '');
  actor := coalesce(actor, row_data ->> 'entered_by', row_data ->> 'updated_by', 'system');

  insert into public.audit_log (id, action, entity_type, entity_id, details, user_email)
  values (gen_random_uuid(), lower(tg_op), tg_table_name, record_id, row_data, actor);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.base_shift_for_date(date) from public, anon, authenticated;
revoke all on function public.validate_overtime_schedule() from public, anon, authenticated;
revoke all on function public.log_tracker_change() from public, anon, authenticated;

drop trigger if exists audit_profiles_change on public.profiles;
drop trigger if exists audit_employees_change on public.employees;
drop trigger if exists audit_overtime_change on public.overtime_entries;
drop trigger if exists audit_pto_change on public.pto_entries;
drop trigger if exists audit_overrides_change on public.schedule_overrides;
drop trigger if exists audit_settings_change on public.app_settings;
create trigger audit_profiles_change after insert or update or delete on public.profiles for each row execute function public.log_tracker_change();
create trigger audit_employees_change after insert or update or delete on public.employees for each row execute function public.log_tracker_change();
create trigger audit_overtime_change after insert or update or delete on public.overtime_entries for each row execute function public.log_tracker_change();
create trigger audit_pto_change after insert or update or delete on public.pto_entries for each row execute function public.log_tracker_change();
create trigger audit_overrides_change after insert or update or delete on public.schedule_overrides for each row execute function public.log_tracker_change();
create trigger audit_settings_change after insert or update or delete on public.app_settings for each row execute function public.log_tracker_change();

commit;
