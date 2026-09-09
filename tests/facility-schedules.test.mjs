import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("OT and PTO submission cards make their dates explicit and editable", async () => {
  const [app, styles] = await Promise.all([read("src/TrackerApp.tsx"), read("src/styles.css")]);
  assert.match(app, /function OvertimeForm[\s\S]*Overtime date[\s\S]*type="date"[\s\S]*I checked the date/);
  assert.match(app, /function PtoForm[\s\S]*PTO date range[\s\S]*Starts[\s\S]*Through[\s\S]*type="date"/);
  assert.match(app, /function PtoForm[\s\S]*scheduled workday[\s\S]*Off days are automatically skipped/);
  assert.match(app, /function PtoForm[\s\S]*existingDates[\s\S]*eligibleDates/);
  assert.match(app, /action = ptoEditor\.entry \? "update_pto" : "add_pto_range"/);
  assert.match(styles, /\.entry-date-card/);
  assert.match(styles, /\.pto-date-preview/);
});

test("admins can configure department work groups with 12-hour and weekday patterns", async () => {
  const [app, api, demo] = await Promise.all([read("src/TrackerApp.tsx"), read("src/lib/tracker-api.ts"), read("src/lib/demo-store.ts")]);
  for (const phrase of ["Work groups & schedules", "Blue 2-2-3 · 12 hrs", "Yellow 2-2-3 · 12 hrs", "Monday–Friday · 8 hrs", "Overall calendar", "Rule effective from"]) assert.match(app, new RegExp(phrase));
  assert.match(app, /function WorkScheduleForm/);
  assert.match(app, /function ScheduleDayForm/);
  assert.match(api, /save_work_schedule/);
  assert.match(api, /save_work_schedule_day/);
  assert.match(demo, /name: "Production"/);
  assert.match(demo, /workGroup: "Repacks"/);
  assert.match(demo, /name: "Spray Dry"/);
});

test("the additive facility migration protects history and enforces smart PTO in PostgreSQL", async () => {
  const [migration, productionMigration] = await Promise.all([
    read("supabase/migrations/20260909000000_facility_schedules.sql"),
    read("supabase/migrations/20260909010000_seed_production_schedules.sql"),
  ]);
  for (const table of ["work_schedules", "work_schedule_rules", "work_schedule_overrides"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon`, "i"));
  }
  assert.match(migration, /cross join \(values[\s\S]*'Blue', 'Day'[\s\S]*'Yellow', 'Night'/i, "All departments must receive the four company 12-hour schedules");
  assert.match(migration, /lower\(d\.name\) = 'production'[\s\S]*'Repacks'/i);
  assert.match(migration, /array\[8, 8, 8, 8, 8, 0, 0\]/i);
  assert.match(migration, /array\[12, 12, 0, 0, 12, 12, 12, 0, 0, 12, 12, 0, 0, 0\]/i);
  assert.match(migration, /create or replace function public\.add_scheduled_pto_range/i);
  assert.match(migration, /schedule_hours_for_date[\s\S]*schedule_overrides[\s\S]*overall_shift_color = legacy_schedule_color/i, "Blue/Yellow calendar corrections must drive the 12-hour schedules");
  assert.match(migration, /planned_hours <= 0[\s\S]*off_count := off_count \+ 1/i);
  assert.match(migration, /already has a PTO entry on this date/i);
  assert.match(migration, /Past schedule rules are history and cannot be rewritten/i);
  assert.match(migration, /schedule_name_snapshot/i);
  assert.match(migration, /shift_name_snapshot/i);
  assert.doesNotMatch(migration, /delete from public\.(?:overtime_entries|pto_entries)/i, "The upgrade must not delete OT or PTO history");
  assert.match(productionMigration, /values \('Production', 'PRD-100'\)/i);
  assert.match(productionMigration, /'Blends'/i);
  assert.match(productionMigration, /'Repacks'/i);
  assert.match(productionMigration, /array\[8, 8, 8, 8, 8, 0, 0\]/i);
  assert.doesNotMatch(productionMigration, /update public\.employees|delete from/i, "Production setup must not move or delete existing employees");
});

test("the dashboard keeps Blue/Yellow primary while facility details and crew placement use schedule IDs", async () => {
  const [app, crew] = await Promise.all([read("src/TrackerApp.tsx"), read("src/CrewPlacement.tsx")]);
  assert.match(app, /employeeScheduledHours/);
  assert.match(app, /weekly-operations-grid/);
  assert.match(app, /Automatic Blue\/Yellow rotation/);
  assert.match(app, /Blue\/Yellow drives the overall calendar/);
  assert.match(app, /<h2>\{workingColor\} Shift<\/h2>/);
  assert.match(app, /calendar-day \$\{color\.toLowerCase\(\)\}/);
  assert.match(app, /Correct Blue\/Yellow shift/);
  assert.match(app, /Adjust department schedules/);
  assert.match(crew, /employee\.scheduleId === scheduleId/);
  assert.match(crew, /placement\.scheduleId === scheduleId/);
  assert.match(crew, /Supervisor work group|work-group schedule|Work group \/ schedule/i);
  assert.doesNotMatch(crew, /aria-label="Shift color"/);
});
