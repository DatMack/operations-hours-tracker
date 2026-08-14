import test from "node:test";
import assert from "node:assert/strict";
import { baseShiftForDate, shiftForDate } from "../src/lib/schedule.ts";

test("2-2-3 schedule follows the verified 14-day rotation", () => {
  const expected = ["Blue", "Blue", "Yellow", "Yellow", "Blue", "Blue", "Blue", "Yellow", "Yellow", "Blue", "Blue", "Yellow", "Yellow", "Yellow"];
  const actual = Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(Date.UTC(2026, 7, 10 + offset)).toISOString().slice(0, 10);
    return baseShiftForDate(date);
  });
  assert.deepEqual(actual, expected);
});

test("rotation repeats before and after the anchor", () => {
  assert.equal(baseShiftForDate("2026-08-10"), baseShiftForDate("2026-08-24"));
  assert.equal(baseShiftForDate("2026-08-09"), baseShiftForDate("2026-08-23"));
});

test("an administrator override wins for one date", () => {
  assert.equal(shiftForDate("2026-08-10", [{ workDate: "2026-08-10", shiftColor: "Yellow" }]), "Yellow");
  assert.equal(shiftForDate("2026-08-11", [{ workDate: "2026-08-10", shiftColor: "Yellow" }]), "Blue");
});
