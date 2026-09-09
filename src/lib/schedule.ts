export type ShiftColor = "Blue" | "Yellow";

export type ScheduleRuleLike = {
  effectiveFrom: string;
  anchorDate: string;
  cycleHours: number[];
};

export type WorkScheduleLike = {
  id: string;
  name: string;
  workGroup: string;
  legacyShiftColor?: ShiftColor;
  rules: ScheduleRuleLike[];
};

export type ScheduleOverrideLike = {
  scheduleId: string;
  workDate: string;
  hours: number;
};

export type ScheduledEmployeeLike = {
  scheduleId?: string;
  shiftColor?: ShiftColor;
};

const MS_PER_DAY = 86_400_000;
const ANCHOR_UTC = Date.UTC(2026, 7, 10);
const BLUE_OFFSETS = new Set([0, 1, 4, 5, 6, 9, 10]);

export function baseShiftForDate(dateValue: string): ShiftColor {
  const [year, month, day] = dateValue.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const elapsed = Math.round((target - ANCHOR_UTC) / MS_PER_DAY);
  const offset = ((elapsed % 14) + 14) % 14;
  return BLUE_OFFSETS.has(offset) ? "Blue" : "Yellow";
}

export function shiftForDate(
  dateValue: string,
  overrides: Array<{ workDate: string; shiftColor: ShiftColor }> = [],
): ShiftColor {
  return overrides.find((item) => item.workDate === dateValue)?.shiftColor ?? baseShiftForDate(dateValue);
}

function utcDayNumber(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function scheduleLabel(schedule: Pick<WorkScheduleLike, "workGroup" | "name">) {
  return schedule.workGroup.trim().toLowerCase() === schedule.name.trim().toLowerCase()
    ? schedule.name
    : `${schedule.workGroup} · ${schedule.name}`;
}

export function scheduleHoursForDate(
  schedule: WorkScheduleLike,
  dateValue: string,
  overrides: ScheduleOverrideLike[] = [],
  legacyOverrides: Array<{ workDate: string; shiftColor: ShiftColor }> = [],
) {
  const override = overrides.find((item) => item.scheduleId === schedule.id && item.workDate === dateValue);
  if (override) return Math.max(0, Number(override.hours) || 0);

  const overallShiftOverride = legacyOverrides.find((item) => item.workDate === dateValue);
  if (schedule.legacyShiftColor && overallShiftOverride) {
    return schedule.legacyShiftColor === overallShiftOverride.shiftColor ? 12 : 0;
  }

  const rules = schedule.rules
    .filter((rule) => rule.effectiveFrom <= dateValue && rule.cycleHours.length > 0)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const rule = rules[0];
  if (!rule) return 0;

  const elapsed = utcDayNumber(dateValue) - utcDayNumber(rule.anchorDate);
  const index = ((elapsed % rule.cycleHours.length) + rule.cycleHours.length) % rule.cycleHours.length;
  return Math.max(0, Number(rule.cycleHours[index]) || 0);
}

export function employeeScheduledHours(
  employee: ScheduledEmployeeLike,
  dateValue: string,
  schedules: WorkScheduleLike[] = [],
  scheduleOverrides: ScheduleOverrideLike[] = [],
  legacyOverrides: Array<{ workDate: string; shiftColor: ShiftColor }> = [],
) {
  const schedule = schedules.find((item) => item.id === employee.scheduleId);
  if (schedule) return scheduleHoursForDate(schedule, dateValue, scheduleOverrides, legacyOverrides);
  if (!employee.shiftColor) return 0;
  return employee.shiftColor === shiftForDate(dateValue, legacyOverrides) ? 12 : 0;
}

export function datesInRange(startDate: string, endDate: string, maximumDays = 366) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) return [];
  const dates: string[] = [];
  for (let value = startDate; value <= endDate && dates.length < maximumDays; value = new Date((utcDayNumber(value) + 1) * MS_PER_DAY).toISOString().slice(0, 10)) {
    dates.push(value);
  }
  return dates;
}

export function scheduledDatesInRange(
  employee: ScheduledEmployeeLike,
  startDate: string,
  endDate: string,
  schedules: WorkScheduleLike[] = [],
  scheduleOverrides: ScheduleOverrideLike[] = [],
  legacyOverrides: Array<{ workDate: string; shiftColor: ShiftColor }> = [],
) {
  return datesInRange(startDate, endDate).map((date) => ({
    date,
    hours: employeeScheduledHours(employee, date, schedules, scheduleOverrides, legacyOverrides),
  })).filter((item) => item.hours > 0);
}

export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
