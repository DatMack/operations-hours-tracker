import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [client, html, baseMigration, migration, privateHelpersMigration, companyMigration, assignmentMigration, colorMigration, profileManagementMigration, dashboardMigration, crewPlacementMigration, deployWorkflow] = await Promise.all([
  read("src/lib/supabase.ts"),
  read("index.html"),
  read("supabase/migrations/20260814000000_operations_hours_tracker.sql"),
  read("supabase/migrations/20260814010000_github_pages_auth_rls.sql"),
  read("supabase/migrations/20260814020000_private_rls_helpers.sql"),
  read("supabase/migrations/20260814030000_company_departments.sql"),
  read("supabase/migrations/20260814040000_supervisor_assignments.sql"),
  read("supabase/migrations/20260814050000_supervisor_shift_color.sql"),
  read("supabase/migrations/20260814060000_profile_admin_management.sql"),
  read("supabase/migrations/20260814070000_personal_dashboards.sql"),
  read("supabase/migrations/20260814080000_crew_placement.sql"),
  read(".github/workflows/deploy-pages.yml"),
]);

assert.doesNotMatch(client, /sb_secret_|service[_-]role|SUPABASE_SECRET/i, "Browser code must not contain a Supabase secret or service-role key");
assert.match(client, /sb_publishable_/, "Browser code must use only a Supabase publishable key");
assert.match(html, /Content-Security-Policy/, "The page must define a Content Security Policy");
assert.match(html, /object-src 'none'/, "The CSP must block plugin/object content");
assert.match(html, /connect-src[^\"]*ydiinfqmgecemwdpidrb\.supabase\.co/, "The CSP must restrict API connections to the selected Supabase project");

for (const table of ["profiles", "employees", "overtime_entries", "pto_entries", "schedule_overrides", "audit_log", "app_settings"]) {
  assert.match(baseMigration, new RegExp(`create table if not exists public\\.${table}`, "i"), `${table} must be defined by the repository's base migration`);
  assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"), `${table} must force RLS`);
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon`, "i"), `${table} must reject anonymous access`);
}

assert.match(migration, /overtime_schedule_guard/i, "Overtime schedule rules must be enforced in PostgreSQL");
assert.match(migration, /profiles_last_admin_guard/i, "The final active administrator must be protected");
assert.match(migration, /audit_.*_change/i, "Data changes must be audited by database triggers");
assert.match(privateHelpersMigration, /create schema if not exists private/i, "RLS helper functions must live in a non-exposed schema");
for (const helper of ["current_user_email", "current_user_role", "tracker_is_approved", "tracker_can_write", "tracker_is_admin"]) {
  assert.match(privateHelpersMigration, new RegExp(`alter function public\\.${helper}\\(\\) set schema private`, "i"), `${helper} must be removed from the API-exposed public schema`);
  assert.match(privateHelpersMigration, new RegExp(`revoke all on function private\\.${helper}\\(\\) from public, anon`, "i"), `${helper} must reject anonymous execution`);
}
assert.match(companyMigration, /create table if not exists public\.departments/i, "Departments must be stored as protected configuration records");
assert.match(companyMigration, /alter table public\.departments force row level security/i, "Departments must force RLS");
assert.match(companyMigration, /revoke all on table public\.departments from anon, authenticated/i, "Departments must reject anonymous access");
assert.match(companyMigration, /departments_admin_(?:insert|update)/i, "Department changes must require administrator policies");
assert.doesNotMatch(companyMigration, /grant[^;]*delete[^;]*public\.departments[^;]*authenticated/i, "Browser users must not hard-delete departments");
assert.match(companyMigration, /department_name_snapshot/i, "Overtime must preserve historical department names");
assert.match(companyMigration, /employee_name_snapshot/i, "Overtime must preserve historical employee names");
assert.match(companyMigration, /shift_name_snapshot/i, "Overtime must preserve historical shift names");
assert.match(companyMigration, /overtime_writer_update/i, "Supervisors must have an RLS-controlled overtime edit policy");
assert.match(companyMigration, /overtime_company_fields_guard/i, "Database triggers must validate company overtime fields");
assert.match(companyMigration, /already exists for this employee, date, department, and cost code/i, "Duplicate overtime must be blocked in PostgreSQL");
assert.match(companyMigration, /overtime_quarter_hour_check/i, "Quarter-hour increments must be enforced in PostgreSQL");
assert.match(companyMigration, /audit_departments_change/i, "Department changes must be audited");
assert.match(assignmentMigration, /profiles_assignment_guard/i, "Supervisor assignments must be validated in PostgreSQL");
assert.match(assignmentMigration, /department_id uuid references public\.departments/i, "Supervisor departments must use a protected foreign key");
assert.match(assignmentMigration, /Supervisors require a department and Day or Night assignment/i, "Supervisor department and shift assignments must be required");
assert.match(colorMigration, /profiles_shift_color_check/i, "Supervisor shift color must be constrained in PostgreSQL");
assert.match(colorMigration, /set active = false[\s\S]*department_id is null or shift_period is null/i, "Incomplete legacy supervisor assignments must be deactivated");
assert.match(colorMigration, /department, shift color, and Day or Night assignment/i, "Complete supervisor crew assignments must be required");
assert.match(profileManagementMigration, /grant select, insert, update, delete on table public\.profiles to authenticated/i, "Authenticated administrators need RLS-controlled profile deletion permission");
assert.match(profileManagementMigration, /profiles_admin_delete[\s\S]*private\.tracker_is_admin\(\)/i, "Profile deletion must be restricted to administrators by RLS");
assert.match(dashboardMigration, /user_id uuid primary key references auth\.users\(id\) on delete cascade/i, "Dashboard preferences must be tied to the authenticated identity");
assert.match(dashboardMigration, /alter table public\.dashboard_preferences force row level security/i, "Dashboard preferences must force RLS");
assert.match(dashboardMigration, /revoke all on table public\.dashboard_preferences from anon, authenticated/i, "Dashboard preferences must reject anonymous access");
for (const operation of ["select", "insert", "update", "delete"]) {
  assert.match(dashboardMigration, new RegExp(`dashboard_preferences_own_${operation}[\\s\\S]*auth\\.uid\\(\\) = user_id[\\s\\S]*private\\.tracker_is_approved\\(\\)`, "i"), `Dashboard ${operation} must be limited to the signed-in approved user`);
}
for (const table of ["crew_systems", "crew_positions", "crew_placements", "crew_placement_history"]) {
  assert.match(crewPlacementMigration, new RegExp(`alter table public\\.${table} force row level security`, "i"), `${table} must force RLS`);
}
assert.match(crewPlacementMigration, /p\.department_id = e\.department_id[\s\S]*p\.shift_color = e\.shift_color[\s\S]*p\.shift_period = e\.shift_period/i, "Crew placement writes must enforce the supervisor's exact crew assignment");
assert.match(crewPlacementMigration, /create trigger crew_placement_validation_trigger/i, "Crew placement integrity must be enforced in PostgreSQL");
assert.match(crewPlacementMigration, /create trigger crew_placement_history_trigger/i, "Crew movement history must be automatic");
assert.match(deployWorkflow, /contents: read/, "The deployment workflow must use read-only repository access");
assert.match(deployWorkflow, /pages: write/, "The deployment workflow may write only to Pages");

console.log("Security invariants verified.");
