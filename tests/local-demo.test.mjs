import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the login screen offers a no-account interactive demo", async () => {
  const [app, styles] = await Promise.all([read("src/App.tsx"), read("src/styles.css")]);

  assert.match(app, /Try the interactive demo/);
  assert.match(app, /Open demo workspace/);
  assert.match(app, /onStartDemo/);
  assert.match(app, /dataMode="demo"/);
  assert.match(styles, /\.demo-entry/);
});

test("demo data is fake, local, persistent, and resettable without backend writes", async () => {
  const [demo, tracker] = await Promise.all([read("src/lib/demo-store.ts"), read("src/TrackerApp.tsx")]);

  assert.match(demo, /operations-hours-local-demo-v1/);
  assert.match(demo, /localStorage\.setItem\(DEMO_STORAGE_KEY/);
  assert.match(demo, /localStorage\.getItem\(DEMO_STORAGE_KEY/);
  assert.match(demo, /localStorage\.removeItem\(DEMO_STORAGE_KEY/);
  assert.match(demo, /backend: "local-demo"/);
  assert.match(demo, /demo\.admin@example\.com/);
  assert.doesNotMatch(demo, /from "\.\/supabase"|\.from\(|\.rpc\(/, "The public demo store must not call the production backend");
  assert.match(tracker, /mutateData = isDemo \? mutateDemoTracker : mutateTracker/);
  assert.match(tracker, /Reset demo data/);
  assert.match(tracker, /never sent to the live company database/);
});

test("local demo mutations cover every editable tracker workflow", async () => {
  const demo = await read("src/lib/demo-store.ts");
  for (const action of [
    "save_dashboard_layout", "add_crew_system", "update_crew_system", "add_crew_position", "update_crew_position",
    "assign_crew_position", "clear_crew_placement", "add_department", "update_department", "add_employee",
    "update_employee", "import_employees", "add_overtime", "update_overtime", "delete_overtime", "add_pto",
    "set_demo_role", "delete_pto", "import_history", "set_override", "delete_override", "add_profile", "update_profile", "delete_profile",
  ]) assert.match(demo, new RegExp(`action === "${action}"|action === "[^\"]+" \\|\\| action === "${action}"`), `${action} must work in the local demo`);
});
