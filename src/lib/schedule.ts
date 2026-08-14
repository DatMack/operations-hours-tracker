export type ShiftColor = "Blue" | "Yellow";

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

export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
