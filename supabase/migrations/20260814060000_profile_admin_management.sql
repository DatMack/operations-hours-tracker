begin;

-- Administrators may remove an approved tracker profile from the browser, but
-- row-level security still prevents every non-admin user from doing so.
revoke all on table public.profiles from anon, authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles
  for delete to authenticated
  using (private.tracker_is_admin());

-- The existing profiles_last_admin_guard trigger remains the final database
-- safeguard against deleting, deactivating, or demoting the last active admin.

commit;
