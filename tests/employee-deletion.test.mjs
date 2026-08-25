import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("administrators can delete unused employees without destroying time history", async () => {
  const [app, api, demo, migration] = await Promise.all([
    read("src/TrackerApp.tsx"),
    read("src/lib/tracker-api.ts"),
    read("src/lib/demo-store.ts"),
    read("supabase/migrations/20260814010000_github_pages_auth_rls.sql"),
  ]);

  assert.match(app, /Delete employee/);
  assert.match(app, /action: "delete_employee"/);
  assert.match(api, /action === "delete_employee"[\s\S]*requireAdmin\(session\.role\)/, "Only administrators may delete employees");
  assert.match(api, /overtime_entries[\s\S]*pto_entries[\s\S]*Mark them inactive instead/, "The live backend must preserve historical time records");
  assert.match(demo, /action === "delete_employee"[\s\S]*overtimeEntries\.some[\s\S]*ptoEntries\.some/, "The demo must mirror the history safeguard");
  assert.match(migration, /employees_admin_delete[\s\S]*(?:public|private)\.tracker_is_admin\(\)/i, "RLS must restrict employee deletion to administrators");
});
