import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [client, html, migration, deployWorkflow] = await Promise.all([
  read("src/lib/supabase.ts"),
  read("index.html"),
  read("supabase/migrations/20260814010000_github_pages_auth_rls.sql"),
  read(".github/workflows/deploy-pages.yml"),
]);

assert.doesNotMatch(client, /sb_secret_|service[_-]role|SUPABASE_SECRET/i, "Browser code must not contain a Supabase secret or service-role key");
assert.match(client, /sb_publishable_/, "Browser code must use only a Supabase publishable key");
assert.match(html, /Content-Security-Policy/, "The page must define a Content Security Policy");
assert.match(html, /object-src 'none'/, "The CSP must block plugin/object content");
assert.match(html, /connect-src[^\"]*ydiinfqmgecemwdpidrb\.supabase\.co/, "The CSP must restrict API connections to the selected Supabase project");

for (const table of ["profiles", "employees", "overtime_entries", "pto_entries", "schedule_overrides", "audit_log", "app_settings"]) {
  assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"), `${table} must force RLS`);
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon`, "i"), `${table} must reject anonymous access`);
}

assert.match(migration, /overtime_schedule_guard/i, "Overtime schedule rules must be enforced in PostgreSQL");
assert.match(migration, /profiles_last_admin_guard/i, "The final active administrator must be protected");
assert.match(migration, /audit_.*_change/i, "Data changes must be audited by database triggers");
assert.match(deployWorkflow, /contents: read/, "The deployment workflow must use read-only repository access");
assert.match(deployWorkflow, /pages: write/, "The deployment workflow may write only to Pages");

console.log("Security invariants verified.");
