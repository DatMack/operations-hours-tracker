import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { crewPositionAtEndOfDay } from "../src/lib/day-snapshot.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("crew placement history reconstructs the position held at the end of a selected day", () => {
  const placements = [{ employeeId: "employee-1", positionId: "position-3", shiftColor: "Blue", shiftPeriod: "Day", updatedBy: "admin", updatedAt: "2026-08-16T12:00:00Z" }];
  const history = [
    { id: "1", employeeId: "employee-1", nextPositionId: "position-1", changedBy: "admin", changedAt: "2026-08-13T12:00:00Z" },
    { id: "2", employeeId: "employee-1", previousPositionId: "position-1", nextPositionId: "position-2", changedBy: "admin", changedAt: "2026-08-15T12:00:00Z" },
    { id: "3", employeeId: "employee-1", previousPositionId: "position-2", nextPositionId: "position-3", changedBy: "admin", changedAt: "2026-08-16T12:00:00Z" },
  ];

  assert.equal(crewPositionAtEndOfDay("employee-1", "2026-08-14", placements, history), "position-1");
  assert.equal(crewPositionAtEndOfDay("employee-1", "2026-08-15", placements, history), "position-2");
  assert.equal(crewPositionAtEndOfDay("employee-1", "2026-08-16", placements, history), "position-3");
});

test("an unassignment remains visible in later historical snapshots", () => {
  const history = [
    { id: "1", employeeId: "employee-1", nextPositionId: "position-1", changedBy: "admin", changedAt: "2026-08-13T12:00:00Z" },
    { id: "2", employeeId: "employee-1", previousPositionId: "position-1", changedBy: "admin", changedAt: "2026-08-15T12:00:00Z" },
  ];

  assert.equal(crewPositionAtEndOfDay("employee-1", "2026-08-14", [], history), "position-1");
  assert.equal(crewPositionAtEndOfDay("employee-1", "2026-08-15", [], history), undefined);
});

test("the shift calendar exposes a complete day snapshot to every approved role", async () => {
  const [app, api, styles] = await Promise.all([
    read("src/TrackerApp.tsx"),
    read("src/lib/tracker-api.ts"),
    read("src/styles.css"),
  ]);

  assert.match(app, /onClick=\{\(\) => onSelect\(dateValue\)\}/, "Calendar days should open for viewers as well as admins");
  assert.doesNotMatch(app, /disabled=\{!isAdmin\}/, "Viewer calendar dates must not be disabled");
  for (const label of ["Scheduled crew", "System / position", "Overtime worked", "PTO recorded"]) assert.match(app, new RegExp(label));
  assert.match(app, /Correct scheduled shift/, "Admins must retain schedule correction access inside the snapshot");
  assert.match(api, /allCrewPlacementHistoryRows/, "Historical day views must load complete placement history instead of only recent moves");
  assert.match(styles, /\.theme-dark \.day-snapshot-banner\.blue/, "The day snapshot must have an explicit dark-mode treatment");
});
