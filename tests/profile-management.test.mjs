import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("profile management uses explicit add, update, and delete actions", async () => {
  const [api, app, migration] = await Promise.all([
    read("src/lib/tracker-api.ts"),
    read("src/TrackerApp.tsx"),
    read("supabase/migrations/20260814060000_profile_admin_management.sql"),
  ]);

  assert.match(api, /action === "add_profile" \|\| action === "update_profile"/);
  assert.match(api, /originalEmail[\s\S]*update\(values\)\.eq\("email", originalEmail\)/);
  assert.match(api, /action === "delete_profile"[\s\S]*delete\(\)\.eq\("email", email\)/);
  assert.doesNotMatch(api, /upsert_profile/, "Email changes must not insert a duplicate profile");
  assert.match(app, /\+ Add new person/);
  assert.match(app, /Delete user access/);
  assert.match(migration, /grant select, insert, update, delete on table public\.profiles to authenticated/i);
  assert.match(migration, /profiles_admin_delete[\s\S]*private\.tracker_is_admin\(\)/i);
});
