import type { CrewPlacement, CrewPlacementHistory } from "./tracker-api";

function timestamp(value: string) {
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
}

function localDate(value: string) {
  const date = timestamp(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function crewPositionAtEndOfDay(
  employeeId: string,
  date: string,
  placements: CrewPlacement[],
  history: CrewPlacementHistory[],
) {
  const latestChange = history
    .filter((item) => item.employeeId === employeeId && localDate(item.changedAt) <= date)
    .sort((a, b) => timestamp(b.changedAt).getTime() - timestamp(a.changedAt).getTime())[0];

  if (latestChange) return latestChange.nextPositionId;

  const current = placements.find((item) => item.employeeId === employeeId);
  return current && localDate(current.updatedAt) <= date ? current.positionId : undefined;
}
