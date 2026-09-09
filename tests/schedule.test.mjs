import test from "node:test";
import assert from "node:assert/strict";
import { baseShiftForDate, employeeScheduledHours, scheduleHoursForDate, scheduledDatesInRange, shiftForDate } from "../src/lib/schedule.ts";

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

const weekdaySchedule = {
  id: "weekday",
  workGroup: "Repacks",
  name: "1st Shift",
  rules: [{ effectiveFrom: "2026-01-01", anchorDate: "2026-08-10", cycleHours: [8, 8, 8, 8, 8, 0, 0] }],
};

const blueSchedule = {
  id: "blue-day",
  workGroup: "Blends",
  name: "Blue Day",
  legacyShiftColor: "Blue",
  rules: [{ effectiveFrom: "2026-01-01", anchorDate: "2026-08-10", cycleHours: [12, 12, 0, 0, 12, 12, 12, 0, 0, 12, 12, 0, 0, 0] }],
};

const yellowSchedule = {
  ...blueSchedule,
  id: "yellow-day",
  name: "Yellow Day",
  legacyShiftColor: "Yellow",
  rules: [{ effectiveFrom: "2026-01-01", anchorDate: "2026-08-10", cycleHours: [0, 0, 12, 12, 0, 0, 0, 12, 12, 0, 0, 12, 12, 12] }],
};

test("8-hour schedules work Monday through Friday and remain off on weekends", () => {
  const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];
  assert.deepEqual(dates.map((date) => scheduleHoursForDate(weekdaySchedule, date)), [8, 8, 8, 8, 8, 0, 0]);
});

test("effective-dated rules preserve the old pattern and do not apply before they begin", () => {
  const schedule = {
    ...weekdaySchedule,
    rules: [
      { effectiveFrom: "2026-08-10", anchorDate: "2026-08-10", cycleHours: [8, 8, 8, 8, 8, 0, 0] },
      { effectiveFrom: "2026-09-14", anchorDate: "2026-09-14", cycleHours: [10, 10, 10, 10, 0, 0, 0] },
    ],
  };
  assert.equal(scheduleHoursForDate(schedule, "2026-08-12"), 8);
  assert.equal(scheduleHoursForDate(schedule, "2026-09-18"), 0);
  assert.equal(scheduleHoursForDate(schedule, "2025-12-31"), 0);
});

test("per-schedule date adjustments override only the selected schedule", () => {
  const second = { ...weekdaySchedule, id: "second", name: "2nd Shift" };
  const overrides = [{ scheduleId: "weekday", workDate: "2026-08-15", hours: 8 }];
  assert.equal(scheduleHoursForDate(weekdaySchedule, "2026-08-15", overrides), 8);
  assert.equal(scheduleHoursForDate(second, "2026-08-15", overrides), 0);
});

test("an overall Blue/Yellow correction drives 12-hour schedules without changing M-F staff", () => {
  const overallCorrection = [{ workDate: "2026-08-10", shiftColor: "Yellow" }];
  assert.equal(scheduleHoursForDate(blueSchedule, "2026-08-10", [], overallCorrection), 0);
  assert.equal(scheduleHoursForDate(yellowSchedule, "2026-08-10", [], overallCorrection), 12);
  assert.equal(scheduleHoursForDate(weekdaySchedule, "2026-08-10", [], overallCorrection), 8);
  assert.equal(scheduleHoursForDate(blueSchedule, "2026-08-10", [{ scheduleId: "blue-day", workDate: "2026-08-10", hours: 6 }], overallCorrection), 6);
});

test("PTO range planning returns only scheduled workdays with their actual hours", () => {
  const employee = { scheduleId: "weekday" };
  const planned = scheduledDatesInRange(employee, "2026-08-10", "2026-08-16", [weekdaySchedule]);
  assert.deepEqual(planned, [
    { date: "2026-08-10", hours: 8 },
    { date: "2026-08-11", hours: 8 },
    { date: "2026-08-12", hours: 8 },
    { date: "2026-08-13", hours: 8 },
    { date: "2026-08-14", hours: 8 },
  ]);
  assert.equal(employeeScheduledHours(employee, "2026-08-15", [weekdaySchedule]), 0);
});
