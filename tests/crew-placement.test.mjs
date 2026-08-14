import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("crew placement data is persistent, crew-specific, audited, and protected by RLS", async () => {
  const migration = await read("supabase/migrations/20260814080000_crew_placement.sql");

  for (const table of ["crew_systems", "crew_positions", "crew_placements", "crew_placement_history"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"));
  }
  assert.match(migration, /unique index if not exists crew_placements_position_crew_idx[\s\S]*position_id, shift_color, shift_period/i, "Each crew needs its own copy of a shared template position");
  assert.match(migration, /create index if not exists crew_positions_system_order_idx[\s\S]*system_id, sort_order, name/i, "Position slots should retain their configured order");
  assert.doesNotMatch(migration, /unique index if not exists crew_positions_system_name_idx/i, "Templates must allow repeated position labels such as two Pack end slots");
  assert.match(migration, /p\.department_id = e\.department_id[\s\S]*p\.shift_color = e\.shift_color[\s\S]*p\.shift_period = e\.shift_period/i, "Supervisors must be restricted to their exact assigned crew");
  assert.match(migration, /create trigger crew_placement_validation_trigger/i, "Database validation must protect placement integrity");
  assert.match(migration, /create trigger crew_placement_history_trigger/i, "Every placement move must be timestamped automatically");
  assert.match(migration, /function public\.move_crew_employee/i, "Atomic drag-and-drop moves must use a protected database function");
  assert.match(migration, /private\.tracker_is_admin\(\)/i, "Only admins may change templates");
});

test("crew placement UI separates focused supervisor editing from company-wide viewing", async () => {
  const [app, crew, api] = await Promise.all([
    read("src/TrackerApp.tsx"),
    read("src/CrewPlacement.tsx"),
    read("src/lib/tracker-api.ts"),
  ]);

  assert.match(app, /id: "crew", code: "CP", label: "Crew Placement"/);
  assert.match(crew, /Your assigned crew/);
  assert.match(crew, /Flip through every crew/);
  assert.match(crew, /draggable=\{editable\}/);
  assert.match(crew, /text\/employee-id/);
  assert.match(crew, /Manage templates/);
  assert.match(crew, /Automatic history/);
  assert.match(api, /action === "assign_crew_position"/);
  assert.match(api, /action === "clear_crew_placement"/);
  assert.match(api, /session\.departmentId !== selectedEmployee\.department_id[\s\S]*session\.shiftColor !== selectedEmployee\.shift_color[\s\S]*session\.shiftPeriod !== selectedEmployee\.shift_period/);
});

test("crew coverage widgets and employee row-limit slider are available but optional", async () => {
  const [app, api] = await Promise.all([read("src/TrackerApp.tsx"), read("src/lib/tracker-api.ts")]);
  for (const widget of ["placement_coverage", "placement_gaps"]) {
    assert.match(app, new RegExp(`id: "${widget}"`));
    assert.match(api, new RegExp(`"${widget}"`));
  }
  assert.match(app, /const \[employeeLimit, setEmployeeLimit\] = useState\(10\)/, "Employee directory must default to 10 rows");
  assert.match(app, /displayedEmployees = filteredEmployees\.slice\(0, employeeLimit\)/, "The row limit must update the visible directory immediately");
  assert.match(app, /<RosterLimitControl total=\{filteredEmployees\.length\} value=\{employeeLimit\}/);
});
