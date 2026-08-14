import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard layouts are personal, validated, and available to every approved role", async () => {
  const [api, app, migration] = await Promise.all([
    read("src/lib/tracker-api.ts"),
    read("src/TrackerApp.tsx"),
    read("supabase/migrations/20260814070000_personal_dashboards.sql"),
  ]);

  assert.match(api, /action === "save_dashboard_layout"/);
  assert.match(api, /dashboardWidgets\(payload\.widgets\)/, "Widget IDs and sizes must be validated before persistence");
  assert.match(api, /user_id: session\.userId/, "Layouts must be saved under the authenticated user ID");
  assert.doesNotMatch(api, /save_dashboard_layout[\s\S]{0,200}requireAdmin/, "Viewers and supervisors must be allowed to save their own layout");
  assert.match(app, /Customize dashboard/);
  assert.match(app, /Save my dashboard/);
  assert.match(app, /Viewer accounts used by management/);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /auth\.uid\(\) = user_id[\s\S]*private\.tracker_is_approved\(\)/i);
});

test("dashboard catalog contains management metrics, charts, workforce, schedule, and daily detail", async () => {
  const app = await read("src/TrackerApp.tsx");
  for (const widget of ["ot_trend", "department_ot", "shift_ot", "reason_ot", "cost_code_ot", "pto_type", "staffing_department", "staffing_crew", "schedule", "selected_ot", "selected_pto"]) {
    assert.match(app, new RegExp(`id: "${widget}"`), `${widget} must be offered in the widget catalog`);
  }
});
