import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("report summary, overtime, and PTO tables have independent live row limits", async () => {
  const app = await read("src/TrackerApp.tsx");

  assert.match(app, /function ReportTable[\s\S]*const \[rowLimit, setRowLimit\] = useState\(10\)/, "Employee summary must default to 10 visible rows");
  assert.match(app, /displayedRows = sorted\.slice\(0, rowLimit\)/, "Employee summary slider must update visible rows immediately");
  assert.match(app, /ariaLabel="Employee summaries shown"/, "Employee summary slider needs a distinct accessible label");
  assert.match(app, /function OvertimeDetailTable[\s\S]*const \[rowLimit, setRowLimit\] = useState\(10\)/, "Overtime detail must default to 10 visible rows");
  assert.match(app, /displayedEntries = entries\.slice\(0, rowLimit\)/, "Overtime detail slider must update visible rows immediately");
  assert.match(app, /ariaLabel="Overtime records shown"/, "Overtime detail slider needs a distinct accessible label");
  assert.match(app, /function PtoDetailTable[\s\S]*const \[rowLimit, setRowLimit\] = useState\(10\)/, "PTO detail must default to 10 visible rows");
  assert.match(app, /function PtoDetailTable[\s\S]*displayedEntries = entries\.slice\(0, rowLimit\)/, "PTO detail slider must update visible rows immediately");
  assert.match(app, /ariaLabel="PTO records shown"/, "PTO detail slider needs a distinct accessible label");
  for (const section of ["report-summary", "report-overtime", "report-pto"]) assert.match(app, new RegExp(`href="#${section}"`), `${section} needs a themed jump link`);
  assert.match(app, /<tfoot>[\s\S]*sorted\.reduce/, "Summary totals must continue using every filtered row");
});
