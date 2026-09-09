import {
  DASHBOARD_WIDGET_IDS,
  DEFAULT_DASHBOARD_WIDGETS,
  OT_REASONS,
  type CrewPlacement,
  type DashboardWidget,
  type Department,
  type Employee,
  type Profile,
  type TrackerBundle,
  type WorkSchedule,
} from "./tracker-api";
import { employeeScheduledHours, scheduleLabel, scheduledDatesInRange, toDateInput, type ShiftColor } from "./schedule";

const DEMO_STORAGE_KEY = "operations-hours-local-demo-v2";
const DEMO_VERSION = 2;
const DEMO_EMAIL = "demo.admin@example.com";

type StoredDemo = { version: number; bundle: TrackerBundle };

function dateByOffset(offset: number) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return toDateInput(value);
}

function timestampByOffset(offset: number, hour = 9) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  value.setHours(hour, 15, 0, 0);
  return value.toISOString();
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function text(value: unknown, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hours(value: unknown) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0 || result > 24 || Math.abs(result * 4 - Math.round(result * 4)) > 0.0001) {
    throw new Error("Hours must be between 0 and 24 in quarter-hour increments.");
  }
  return Math.round(result * 4) / 4;
}

function hoursOrZero(value: unknown) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 24 || Math.abs(result * 4 - Math.round(result * 4)) > 0.0001) throw new Error("Scheduled hours must be between 0 and 24 in quarter-hour increments.");
  return Math.round(result * 4) / 4;
}

function wholeNumber(value: unknown) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 10000) throw new Error("Order must be a whole number between 0 and 10,000.");
  return result;
}

function color(value: unknown): value is ShiftColor {
  return value === "Blue" || value === "Yellow";
}

function period(value: unknown): value is "Day" | "Night" {
  return value === "Day" || value === "Night";
}

function dateValue(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function cloneBundle(bundle: TrackerBundle): TrackerBundle {
  return JSON.parse(JSON.stringify(bundle)) as TrackerBundle;
}

function departmentFor(bundle: TrackerBundle, departmentId: unknown, departmentName?: unknown) {
  const idValue = text(departmentId, 80);
  const nameValue = text(departmentName, 100).toLowerCase();
  const match = bundle.departments.find((item) => item.id === idValue)
    ?? bundle.departments.find((item) => item.name.toLowerCase() === nameValue);
  if (!match) throw new Error("Select a configured department.");
  return match;
}

function employeeFor(bundle: TrackerBundle, employeeId: unknown) {
  const match = bundle.employees.find((item) => item.id === text(employeeId, 80));
  if (!match) throw new Error("Select a demo employee.");
  return match;
}

function scheduleFor(bundle: TrackerBundle, scheduleId: unknown, departmentId?: string) {
  const match = bundle.workSchedules.find((item) => item.id === text(scheduleId, 100));
  if (!match || (departmentId && match.departmentId !== departmentId)) throw new Error("Select a schedule configured for this department.");
  return match;
}

function cycleHours(value: unknown) {
  if (!Array.isArray(value) || ![7, 14].includes(value.length)) throw new Error("Choose a 7-day weekday schedule or a 14-day rotating schedule.");
  const result = value.map((item) => {
    const result = Number(item);
    if (!Number.isFinite(result) || result < 0 || result > 24 || Math.abs(result * 4 - Math.round(result * 4)) > 0.0001) throw new Error("Schedule hours must be 0–24 in quarter-hour increments.");
    return Math.round(result * 4) / 4;
  });
  if (!result.some((item) => item > 0)) throw new Error("A work schedule must contain at least one working day.");
  return result;
}

function addAudit(bundle: TrackerBundle, action: string, entityType: string, details: string) {
  bundle.auditLog.unshift({
    id: id("audit"),
    action,
    entityType,
    details,
    userEmail: DEMO_EMAIL,
    createdAt: new Date().toISOString(),
  });
  bundle.auditLog = bundle.auditLog.slice(0, 100);
}

function saveDemoBundle(bundle: TrackerBundle) {
  const next = { ...bundle, backend: "local-demo" as const };
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ version: DEMO_VERSION, bundle: next } satisfies StoredDemo));
  return cloneBundle(next);
}

const BLUE_223 = [12, 12, 0, 0, 12, 12, 12, 0, 0, 12, 12, 0, 0, 0];
const YELLOW_223 = [0, 0, 12, 12, 0, 0, 0, 12, 12, 0, 0, 12, 12, 12];
const WEEKDAY_8 = [8, 8, 8, 8, 8, 0, 0];

function fakeWorkSchedules(departments: Department[], now: string): WorkSchedule[] {
  const schedules: WorkSchedule[] = departments.flatMap((department) => {
    const workGroup = department.name === "Production" ? "Blends" : department.name;
    return (["Blue", "Yellow"] as ShiftColor[]).flatMap((shiftColor) => (["Day", "Night"] as const).map((shiftPeriod) => {
      const scheduleId = `${department.id}-${shiftColor.toLowerCase()}-${shiftPeriod.toLowerCase()}`;
      return {
        id: scheduleId,
        departmentId: department.id,
        workGroup,
        name: `${shiftColor} ${shiftPeriod}`,
        active: true,
        legacyShiftColor: shiftColor,
        legacyShiftPeriod: shiftPeriod,
        rules: [{ id: `${scheduleId}-rule`, scheduleId, effectiveFrom: "1900-01-01", anchorDate: "2026-08-10", cycleHours: shiftColor === "Blue" ? [...BLUE_223] : [...YELLOW_223], createdAt: now }],
        createdAt: now,
        updatedAt: now,
      } satisfies WorkSchedule;
    }));
  });
  const production = departments.find((department) => department.name === "Production");
  if (production) {
    for (const [index, name] of ["1st Shift", "2nd Shift", "3rd Shift"].entries()) {
      const scheduleId = `${production.id}-repacks-${index + 1}`;
      schedules.push({ id: scheduleId, departmentId: production.id, workGroup: "Repacks", name, active: true, rules: [{ id: `${scheduleId}-rule`, scheduleId, effectiveFrom: "1900-01-01", anchorDate: "2026-08-10", cycleHours: [...WEEKDAY_8], createdAt: now }], createdAt: now, updatedAt: now });
    }
  }
  return schedules;
}

function fakeEmployees(departments: Department[], schedules: WorkSchedule[]): Employee[] {
  const departmentByName = new Map(departments.map((department) => [department.name, department]));
  const rows: Array<[string, string, string, string]> = [
    ["Avery Stone", "Production", "Blends", "Blue Day"], ["Blake Turner", "Production", "Blends", "Blue Day"],
    ["Cameron Wells", "Production", "Blends", "Blue Day"], ["Devon Reed", "Production", "Blends", "Blue Day"],
    ["Emery Collins", "Production", "Blends", "Blue Day"], ["Finley Brooks", "Production", "Blends", "Blue Night"],
    ["Gray Morgan", "Production", "Blends", "Blue Night"], ["Harper Lane", "Production", "Blends", "Blue Night"],
    ["Indigo Price", "Production", "Blends", "Blue Night"], ["Jordan Hayes", "Production", "Blends", "Blue Night"],
    ["Kai Bennett", "Production", "Blends", "Yellow Day"], ["Logan Parker", "Production", "Blends", "Yellow Day"],
    ["Micah Foster", "Production", "Blends", "Yellow Day"], ["Noel Griffin", "Production", "Blends", "Yellow Day"],
    ["Oakley Shaw", "Production", "Blends", "Yellow Day"], ["Peyton Ellis", "Production", "Blends", "Yellow Night"],
    ["Quinn Bailey", "Production", "Blends", "Yellow Night"], ["Reese Jordan", "Production", "Blends", "Yellow Night"],
    ["Skyler Ward", "Production", "Blends", "Yellow Night"], ["Tatum Blake", "Production", "Blends", "Yellow Night"],
    ["Morgan Cole", "Production", "Repacks", "1st Shift"], ["Riley West", "Production", "Repacks", "1st Shift"],
    ["Casey North", "Production", "Repacks", "2nd Shift"], ["Drew Hart", "Production", "Repacks", "2nd Shift"],
    ["Lee Sutton", "Production", "Repacks", "3rd Shift"], ["Sam Hollis", "Production", "Repacks", "3rd Shift"],
    ["Alexis Monroe", "Spray Dry", "Blue", "Day"], ["Charlie Rowan", "Spray Dry", "Blue", "Night"],
    ["Dakota Quinn", "Spray Dry", "Yellow", "Day"], ["Frankie Sage", "Spray Dry", "Yellow", "Night"],
    ["Jamie Rivers", "Packaging", "Blue", "Day"], ["Kendall Hart", "Packaging", "Blue", "Night"],
    ["Marley Dean", "Packaging", "Yellow", "Day"], ["Nico James", "Packaging", "Yellow", "Night"],
    ["Robin Clarke", "Warehouse", "Blue", "Day"], ["Sasha Flynn", "Warehouse", "Blue", "Night"],
    ["Taylor Knox", "Warehouse", "Yellow", "Day"], ["Winter Lake", "Warehouse", "Yellow", "Night"],
  ];
  return rows.map(([name, departmentName, workGroupOrColor, scheduleNameOrPeriod], index) => {
    const department = departmentByName.get(departmentName)!;
    const workGroup = workGroupOrColor === "Blue" || workGroupOrColor === "Yellow" ? departmentName : workGroupOrColor;
    const scheduleName = workGroupOrColor === "Blue" || workGroupOrColor === "Yellow" ? `${workGroupOrColor} ${scheduleNameOrPeriod}` : scheduleNameOrPeriod;
    const schedule = schedules.find((item) => item.departmentId === department.id && item.workGroup === workGroup && item.name === scheduleName)!;
    return {
      id: `demo-employee-${index + 1}`,
      name,
      shiftColor: schedule.legacyShiftColor,
      shiftPeriod: schedule.legacyShiftPeriod,
      scheduleId: schedule.id,
      scheduleName: scheduleLabel(schedule),
      departmentId: department.id,
      department: department.name,
      active: true,
      createdAt: timestampByOffset(-45 + index),
    };
  });
}

function createDemoBundle(): TrackerBundle {
  const now = new Date().toISOString();
  const departments: Department[] = [
    { id: "demo-dept-production", name: "Production", defaultCostCode: "PRD-100", active: true, createdAt: now, updatedAt: now },
    { id: "demo-dept-spray", name: "Spray Dry", defaultCostCode: "SPD-200", active: true, createdAt: now, updatedAt: now },
    { id: "demo-dept-packaging", name: "Packaging", defaultCostCode: "PKG-300", active: true, createdAt: now, updatedAt: now },
    { id: "demo-dept-warehouse", name: "Warehouse", defaultCostCode: "WHS-400", active: true, createdAt: now, updatedAt: now },
  ];
  const workSchedules = fakeWorkSchedules(departments, now);
  const employees = fakeEmployees(departments, workSchedules);
  const employeeByName = new Map(employees.map((employee) => [employee.name, employee]));
  const crewSystems = [
    { id: "demo-system-line-one", departmentId: departments[0].id, name: "Line One", sortOrder: 0, active: true, createdAt: now, updatedAt: now },
    { id: "demo-system-line-two", departmentId: departments[0].id, name: "Line Two", sortOrder: 1, active: true, createdAt: now, updatedAt: now },
    { id: "demo-system-spray", departmentId: departments[1].id, name: "Spray Dryer", sortOrder: 0, active: true, createdAt: now, updatedAt: now },
    { id: "demo-system-pack", departmentId: departments[2].id, name: "Packing Cell", sortOrder: 0, active: true, createdAt: now, updatedAt: now },
    { id: "demo-system-warehouse", departmentId: departments[3].id, name: "Shipping Floor", sortOrder: 0, active: true, createdAt: now, updatedAt: now },
  ];
  const positionNames: Record<string, string[]> = {
    "demo-system-line-one": ["Team lead", "Backup", "Pack end", "Pack end", "Dumper"],
    "demo-system-line-two": ["Team lead", "Backup", "Pack end", "Pack end", "Dumper"],
    "demo-system-spray": ["Operator", "Assistant", "Bagging", "Material runner"],
    "demo-system-pack": ["Team lead", "Packer", "Packer", "Palletizer"],
    "demo-system-warehouse": ["Coordinator", "Forklift", "Loader"],
  };
  const crewPositions = crewSystems.flatMap((system) => positionNames[system.id].map((name, index) => ({
    id: `${system.id}-position-${index + 1}`,
    systemId: system.id,
    name,
    sortOrder: index,
    required: true,
    active: true,
    createdAt: now,
    updatedAt: now,
  })));
  const placements: Array<[string, string]> = [
    ["Avery Stone", "demo-system-line-one-position-1"],
    ["Blake Turner", "demo-system-line-one-position-2"],
    ["Cameron Wells", "demo-system-line-one-position-3"],
    ["Devon Reed", "demo-system-line-one-position-4"],
    ["Emery Collins", "demo-system-line-two-position-1"],
    ["Kai Bennett", "demo-system-line-one-position-1"],
    ["Logan Parker", "demo-system-line-one-position-2"],
    ["Micah Foster", "demo-system-line-one-position-3"],
  ];
  const crewPlacements: CrewPlacement[] = placements.map(([employeeName, positionId], index) => {
    const employee = employeeByName.get(employeeName)!;
    return { employeeId: employee.id, positionId, scheduleId: employee.scheduleId, shiftColor: employee.shiftColor, shiftPeriod: employee.shiftPeriod, updatedBy: DEMO_EMAIL, updatedAt: timestampByOffset(-index, 8) };
  });

  const entryDates = [-1, -3, -8, -12, -18, -25].map(dateByOffset);
  const overtimeEntries = entryDates.map((workDate, index) => {
    const employee = employees.find((item) => item.active && item.departmentId === departments[index % departments.length].id && employeeScheduledHours(item, workDate, workSchedules) === 0)
      ?? employees.find((item) => employeeScheduledHours(item, workDate, workSchedules) === 0)!;
    const department = departments[index % departments.length];
    return {
      id: `demo-ot-${index + 1}`,
      workDate,
      employeeId: employee.id,
      departmentId: department.id,
      departmentName: department.name,
      employeeName: employee.name,
      shiftName: employee.scheduleName,
      hours: employee.scheduleName.includes("Repacks") ? 8 : index === 2 ? 4 : 12,
      costCode: department.defaultCostCode,
      reason: ["Production Needs", "Call-Off Coverage", "Training", "Staffing Shortage"][index % 4],
      notes: ["Covered a planned opening", "Helped cover a call-off", "Cross-training on the line", "Additional staffing for production"][index % 4],
      enteredBy: DEMO_EMAIL,
      createdAt: timestampByOffset(-index, 14),
    };
  });
  const ptoEntries = [-2, -6, -10, 2].map((offset, index) => {
    const employee = employees[20 + index];
    const planned = scheduledDatesInRange(employee, dateByOffset(offset), dateByOffset(offset + 20), workSchedules)[0];
    return {
      id: `demo-pto-${index + 1}`,
      ptoDate: planned.date,
      employeeId: employee.id,
      hours: index === 3 ? Math.min(4, planned.hours) : planned.hours,
      ptoType: ["Vacation", "Sick", "Personal", "Vacation"][index],
      notes: index === 1 ? "Approved sick time" : "Approved request",
      scheduleName: employee.scheduleName,
      enteredBy: DEMO_EMAIL,
      createdAt: timestampByOffset(offset - 3, 10),
    };
  });
  const profiles: Profile[] = [
    { email: DEMO_EMAIL, fullName: "Demo Administrator", role: "admin", active: true, userId: "demo-local-user", createdAt: now },
    { email: "supervisor@example.com", fullName: "Demo Supervisor", role: "supervisor", active: true, departmentId: departments[0].id, scheduleId: workSchedules.find((schedule) => schedule.departmentId === departments[0].id && schedule.workGroup === "Blends" && schedule.name === "Blue Day")?.id, shiftColor: "Blue", shiftPeriod: "Day", createdAt: now },
    { email: "manager@example.com", fullName: "Demo Viewer", role: "viewer", active: true, createdAt: now },
  ];

  return {
    backend: "local-demo",
    session: profiles[0],
    departments,
    employees,
    overtimeEntries,
    ptoEntries,
    scheduleOverrides: [],
    workSchedules,
    workScheduleOverrides: [],
    scheduleStorageReady: true,
    dashboardWidgets: [
      ...DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })),
      { id: "placement_coverage", size: "compact" },
      { id: "placement_gaps", size: "standard" },
    ],
    dashboardPersistenceReady: true,
    profiles,
    auditLog: [
      { id: "demo-audit-1", action: "Update crew placement", entityType: "crew_placement", details: "Avery Stone moved to Line One · Team lead", userEmail: DEMO_EMAIL, createdAt: timestampByOffset(-1, 8) },
      { id: "demo-audit-2", action: "Add overtime", entityType: "overtime_entry", details: "Sample overtime entry created", userEmail: "supervisor@example.com", createdAt: timestampByOffset(-2, 14) },
    ],
    crewSystems,
    crewPositions,
    crewPlacements,
    crewPlacementHistory: crewPlacements.slice(0, 4).map((placement, index) => ({
      id: `demo-history-${index + 1}`,
      employeeId: placement.employeeId,
      nextPositionId: placement.positionId,
      changedBy: DEMO_EMAIL,
      changedAt: timestampByOffset(-index - 1, 8),
    })),
    crewPlacementReady: true,
  };
}

function isStoredDemo(value: unknown): value is StoredDemo {
  if (!value || typeof value !== "object") return false;
  const stored = value as Partial<StoredDemo>;
  const bundle = stored.bundle as Partial<TrackerBundle> | undefined;
  return stored.version === DEMO_VERSION
    && bundle?.backend === "local-demo"
    && Array.isArray(bundle.departments)
    && Array.isArray(bundle.employees)
    && Array.isArray(bundle.overtimeEntries)
    && Array.isArray(bundle.ptoEntries)
    && Array.isArray(bundle.workSchedules)
    && Array.isArray(bundle.workScheduleOverrides)
    && Array.isArray(bundle.crewPlacements);
}

export async function loadDemoBundle(): Promise<TrackerBundle> {
  try {
    const stored = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) ?? "null") as unknown;
    if (isStoredDemo(stored)) return cloneBundle(stored.bundle);
  } catch {
    // A damaged or manually edited local demo is replaced with the safe sample.
  }
  return saveDemoBundle(createDemoBundle());
}

export async function resetDemoBundle(): Promise<TrackerBundle> {
  localStorage.removeItem(DEMO_STORAGE_KEY);
  return saveDemoBundle(createDemoBundle());
}

export async function mutateDemoTracker(payload: Record<string, unknown>): Promise<TrackerBundle> {
  const bundle = await loadDemoBundle();
  const action = text(payload.action, 50);
  const now = new Date().toISOString();

  if (action === "set_demo_role") {
    const role = payload.role;
    if (role !== "admin" && role !== "supervisor" && role !== "viewer") throw new Error("Choose a valid demo role.");
    const profile = bundle.profiles.find((item) => item.role === role && item.active);
    if (!profile) throw new Error("That demo role is not available.");
    bundle.session = { ...profile, userId: `demo-local-${role}` };
  } else if (action === "save_dashboard_layout") {
    const allowed = new Set<string>(DASHBOARD_WIDGET_IDS);
    const seen = new Set<string>();
    const widgets = Array.isArray(payload.widgets) ? payload.widgets : [];
    bundle.dashboardWidgets = widgets.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Dashboard layout contains an invalid widget.");
      const widget = item as Partial<DashboardWidget>;
      if (!widget.id || !allowed.has(widget.id) || seen.has(widget.id)) throw new Error("Dashboard layout contains an unknown or duplicate widget.");
      if (widget.size !== "compact" && widget.size !== "standard" && widget.size !== "wide") throw new Error("Dashboard widget size is invalid.");
      seen.add(widget.id);
      return { id: widget.id, size: widget.size } as DashboardWidget;
    });
    addAudit(bundle, "Update dashboard", "dashboard_preference", "Saved the local demo dashboard layout");
  } else if (action === "add_crew_system") {
    const department = departmentFor(bundle, payload.departmentId);
    const name = text(payload.name, 100);
    if (!department.active || !name) throw new Error("An active department and system name are required.");
    bundle.crewSystems.push({ id: id("demo-system"), departmentId: department.id, name, sortOrder: wholeNumber(payload.sortOrder ?? 0), active: true, createdAt: now, updatedAt: now });
    addAudit(bundle, "Add crew system", "crew_system", `${department.name} · ${name}`);
  } else if (action === "update_crew_system") {
    const system = bundle.crewSystems.find((item) => item.id === text(payload.id, 80));
    const name = text(payload.name, 100);
    if (!system || !name) throw new Error("Select a crew system and enter its name.");
    system.name = name;
    system.sortOrder = wholeNumber(payload.sortOrder ?? 0);
    system.active = payload.active !== false;
    system.updatedAt = now;
    if (!system.active) {
      const positionIds = new Set(bundle.crewPositions.filter((item) => item.systemId === system.id).map((item) => item.id));
      bundle.crewPlacements = bundle.crewPlacements.filter((item) => !positionIds.has(item.positionId));
    }
    addAudit(bundle, "Update crew system", "crew_system", system.name);
  } else if (action === "add_crew_position") {
    const system = bundle.crewSystems.find((item) => item.id === text(payload.systemId, 80));
    const name = text(payload.name, 100);
    if (!system?.active || !name) throw new Error("Select an active system and enter a position name.");
    bundle.crewPositions.push({ id: id("demo-position"), systemId: system.id, name, sortOrder: wholeNumber(payload.sortOrder ?? 0), required: payload.required !== false, active: true, createdAt: now, updatedAt: now });
    addAudit(bundle, "Add crew position", "crew_position", `${system.name} · ${name}`);
  } else if (action === "update_crew_position") {
    const position = bundle.crewPositions.find((item) => item.id === text(payload.id, 80));
    const name = text(payload.name, 100);
    if (!position || !name) throw new Error("Select a crew position and enter its name.");
    position.name = name;
    position.sortOrder = wholeNumber(payload.sortOrder ?? 0);
    position.required = payload.required !== false;
    position.active = payload.active !== false;
    position.updatedAt = now;
    if (!position.active) bundle.crewPlacements = bundle.crewPlacements.filter((item) => item.positionId !== position.id);
    addAudit(bundle, "Update crew position", "crew_position", position.name);
  } else if (action === "assign_crew_position") {
    const employee = employeeFor(bundle, payload.employeeId);
    const position = bundle.crewPositions.find((item) => item.id === text(payload.positionId, 80) && item.active);
    const system = position && bundle.crewSystems.find((item) => item.id === position.systemId && item.active);
    if (!position || !system || system.departmentId !== employee.departmentId) throw new Error("Choose a position in the employee's department.");
    const previous = bundle.crewPlacements.find((item) => item.employeeId === employee.id);
    const occupied = bundle.crewPlacements.find((item) => item.positionId === position.id && item.scheduleId === employee.scheduleId);
    bundle.crewPlacements = bundle.crewPlacements.filter((item) => item.employeeId !== employee.id && item.employeeId !== occupied?.employeeId);
    if (occupied && previous) bundle.crewPlacements.push({ ...occupied, positionId: previous.positionId, updatedBy: DEMO_EMAIL, updatedAt: now });
    bundle.crewPlacements.push({ employeeId: employee.id, positionId: position.id, scheduleId: employee.scheduleId, shiftColor: employee.shiftColor, shiftPeriod: employee.shiftPeriod, updatedBy: DEMO_EMAIL, updatedAt: now });
    bundle.crewPlacementHistory.unshift({ id: id("demo-history"), employeeId: employee.id, previousPositionId: previous?.positionId, nextPositionId: position.id, changedBy: DEMO_EMAIL, changedAt: now });
    if (occupied) bundle.crewPlacementHistory.unshift({ id: id("demo-history"), employeeId: occupied.employeeId, previousPositionId: occupied.positionId, nextPositionId: previous?.positionId, changedBy: DEMO_EMAIL, changedAt: now });
    addAudit(bundle, "Update crew placement", "crew_placement", `${employee.name} moved to ${system.name} · ${position.name}`);
  } else if (action === "clear_crew_placement") {
    const employee = employeeFor(bundle, payload.employeeId);
    const previous = bundle.crewPlacements.find((item) => item.employeeId === employee.id);
    bundle.crewPlacements = bundle.crewPlacements.filter((item) => item.employeeId !== employee.id);
    if (previous) bundle.crewPlacementHistory.unshift({ id: id("demo-history"), employeeId: employee.id, previousPositionId: previous.positionId, changedBy: DEMO_EMAIL, changedAt: now });
    addAudit(bundle, "Clear crew placement", "crew_placement", `${employee.name} moved to Unassigned`);
  } else if (action === "add_work_schedule" || action === "update_work_schedule") {
    const department = departmentFor(bundle, payload.departmentId);
    const workGroup = text(payload.workGroup, 100);
    const name = text(payload.name, 100);
    const effectiveFrom = payload.effectiveFrom;
    const anchorDate = payload.anchorDate;
    const pattern = cycleHours(payload.cycleHours);
    const legacyShiftColor = payload.legacyShiftColor === "Blue" || payload.legacyShiftColor === "Yellow" ? payload.legacyShiftColor : undefined;
    const legacyShiftPeriod = legacyShiftColor && (payload.legacyShiftPeriod === "Day" || payload.legacyShiftPeriod === "Night") ? payload.legacyShiftPeriod : undefined;
    if (!department.active || !workGroup || !name || !dateValue(effectiveFrom) || !dateValue(anchorDate)) throw new Error("Department, work group, shift name, effective date, anchor date, and schedule hours are required.");
    if (legacyShiftColor && !legacyShiftPeriod) throw new Error("Choose Day or Night for a Blue/Yellow schedule.");
    if (bundle.workSchedules.some((item) => item.departmentId === department.id && item.workGroup.toLowerCase() === workGroup.toLowerCase() && item.name.toLowerCase() === name.toLowerCase() && item.id !== payload.id)) throw new Error("That department already has this work group and schedule name.");
    if (action === "add_work_schedule") {
      const scheduleId = id("demo-schedule");
      bundle.workSchedules.push({ id: scheduleId, departmentId: department.id, workGroup, name, legacyShiftColor, legacyShiftPeriod, active: true, rules: [{ id: id("demo-rule"), scheduleId, effectiveFrom, anchorDate, cycleHours: pattern, createdAt: now }], createdAt: now, updatedAt: now });
      addAudit(bundle, "Add work schedule", "work_schedule", `${department.name} · ${workGroup} · ${name}`);
    } else {
      const schedule = scheduleFor(bundle, payload.id, department.id);
      if (payload.active === false && bundle.employees.some((employee) => employee.active && employee.scheduleId === schedule.id)) throw new Error("Move or deactivate active employees before deactivating this schedule.");
      schedule.workGroup = workGroup;
      schedule.name = name;
      schedule.legacyShiftColor = legacyShiftColor;
      schedule.legacyShiftPeriod = legacyShiftPeriod;
      schedule.active = payload.active !== false;
      schedule.updatedAt = now;
      const existingRule = schedule.rules.find((rule) => rule.effectiveFrom === effectiveFrom);
      if (existingRule) Object.assign(existingRule, { anchorDate, cycleHours: pattern });
      else schedule.rules.push({ id: id("demo-rule"), scheduleId: schedule.id, effectiveFrom, anchorDate, cycleHours: pattern, createdAt: now });
      bundle.employees.filter((employee) => employee.scheduleId === schedule.id).forEach((employee) => { employee.scheduleName = scheduleLabel(schedule); employee.shiftColor = legacyShiftColor; employee.shiftPeriod = legacyShiftPeriod; });
      bundle.profiles.filter((profile) => profile.scheduleId === schedule.id).forEach((profile) => { profile.shiftColor = legacyShiftColor; profile.shiftPeriod = legacyShiftPeriod; });
      bundle.crewPlacements.filter((placement) => placement.scheduleId === schedule.id).forEach((placement) => { placement.shiftColor = legacyShiftColor; placement.shiftPeriod = legacyShiftPeriod; });
      addAudit(bundle, "Update work schedule", "work_schedule", `${department.name} · ${workGroup} · ${name}`);
    }
  } else if (action === "save_schedule_day") {
    const workDate = payload.workDate;
    const changes = Array.isArray(payload.changes) ? payload.changes.slice(0, 200) : [];
    if (!dateValue(workDate) || !changes.length) throw new Error("Choose a date and at least one schedule adjustment.");
    for (const changeValue of changes) {
      const change = changeValue as Record<string, unknown>;
      const schedule = scheduleFor(bundle, change.scheduleId);
      bundle.workScheduleOverrides = bundle.workScheduleOverrides.filter((item) => !(item.scheduleId === schedule.id && item.workDate === workDate));
      if (change.reset !== true) bundle.workScheduleOverrides.push({ scheduleId: schedule.id, workDate, hours: hoursOrZero(change.hours), reason: text(payload.reason, 250), updatedBy: DEMO_EMAIL, updatedAt: now });
    }
    addAudit(bundle, "Update schedule date", "work_schedule_override", `${workDate} · ${changes.length} schedules`);
  } else if (action === "add_department" || action === "update_department") {
    const name = text(payload.name, 100);
    const defaultCostCode = text(payload.defaultCostCode, 50).toUpperCase();
    if (!name || !defaultCostCode) throw new Error("Department name and default cost code are required.");
    if (action === "add_department") {
      bundle.departments.push({ id: id("demo-dept"), name, defaultCostCode, active: true, createdAt: now, updatedAt: now });
      addAudit(bundle, "Add department", "department", name);
    } else {
      const department = departmentFor(bundle, payload.id);
      const oldName = department.name;
      department.name = name;
      department.defaultCostCode = defaultCostCode;
      department.active = payload.active !== false;
      department.updatedAt = now;
      bundle.employees.filter((item) => item.departmentId === department.id).forEach((item) => { item.department = name; });
      addAudit(bundle, "Update department", "department", `${oldName} → ${name}`);
    }
  } else if (action === "add_employee" || action === "update_employee") {
    const name = text(payload.name, 100);
    const department = departmentFor(bundle, payload.departmentId, payload.department);
    const schedule = scheduleFor(bundle, payload.scheduleId, department.id);
    if (!name || !department.active || !schedule.active) throw new Error("Name, department, and an active work schedule are required.");
    if (action === "add_employee") {
      bundle.employees.push({ id: id("demo-employee"), name, departmentId: department.id, department: department.name, scheduleId: schedule.id, scheduleName: scheduleLabel(schedule), shiftColor: schedule.legacyShiftColor, shiftPeriod: schedule.legacyShiftPeriod, active: true, createdAt: now });
    } else {
      const employee = employeeFor(bundle, payload.id);
      employee.name = name;
      employee.departmentId = department.id;
      employee.department = department.name;
      employee.scheduleId = schedule.id;
      employee.scheduleName = scheduleLabel(schedule);
      employee.shiftColor = schedule.legacyShiftColor;
      employee.shiftPeriod = schedule.legacyShiftPeriod;
      employee.active = Boolean(payload.active);
      bundle.crewPlacements = bundle.crewPlacements.filter((item) => item.employeeId !== employee.id);
    }
    addAudit(bundle, action === "add_employee" ? "Add employee" : "Update employee", "employee", name);
  } else if (action === "delete_employee") {
    const employee = employeeFor(bundle, payload.id);
    if (bundle.overtimeEntries.some((entry) => entry.employeeId === employee.id) || bundle.ptoEntries.some((entry) => entry.employeeId === employee.id)) throw new Error("This employee has overtime or PTO history. Mark them inactive instead so those records remain intact.");
    bundle.employees = bundle.employees.filter((item) => item.id !== employee.id);
    bundle.crewPlacements = bundle.crewPlacements.filter((item) => item.employeeId !== employee.id);
    bundle.crewPlacementHistory = bundle.crewPlacementHistory.filter((item) => item.employeeId !== employee.id);
    addAudit(bundle, "Delete employee", "employee", employee.name);
  } else if (action === "import_employees") {
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 1000) : [];
    if (!rows.length) throw new Error("At least one employee row is required.");
    for (const sourceValue of rows) {
      const source = sourceValue as Record<string, unknown>;
      const name = text(source.name, 100);
      const department = departmentFor(bundle, source.departmentId, source.department);
      const requestedSchedule = text(source.schedule, 205).toLowerCase();
      const selectedSchedule = bundle.workSchedules.find((item) => item.departmentId === department.id && (item.id === text(source.scheduleId, 100) || scheduleLabel(item).toLowerCase() === requestedSchedule || item.name.toLowerCase() === requestedSchedule))
        ?? bundle.workSchedules.find((item) => item.departmentId === department.id && item.legacyShiftColor === source.shiftColor && item.legacyShiftPeriod === source.shiftPeriod);
      if (!name || !selectedSchedule?.active) throw new Error("Every imported employee needs a valid name, department, and configured schedule.");
      const existing = bundle.employees.find((item) => item.name.toLowerCase() === name.toLowerCase());
      const values = { name, departmentId: department.id, department: department.name, scheduleId: selectedSchedule.id, scheduleName: scheduleLabel(selectedSchedule), shiftColor: selectedSchedule.legacyShiftColor, shiftPeriod: selectedSchedule.legacyShiftPeriod, active: source.active !== false };
      if (existing) Object.assign(existing, values);
      else bundle.employees.push({ id: id("demo-employee"), ...values, createdAt: now });
    }
    addAudit(bundle, "Import employees", "employee", `${rows.length} local demo rows processed`);
  } else if (action === "add_overtime") {
    const employee = employeeFor(bundle, payload.employeeId);
    const department = departmentFor(bundle, payload.departmentId);
    const workDate = payload.workDate;
    const reason = text(payload.reason, 100);
    const costCode = text(payload.costCode, 50).toUpperCase();
    if (!dateValue(workDate) || !costCode || !OT_REASONS.includes(reason as typeof OT_REASONS[number])) throw new Error("Employee, date, department, cost code, and reason are required.");
    const plannedHours = employeeScheduledHours(employee, workDate, bundle.workSchedules, bundle.workScheduleOverrides, bundle.scheduleOverrides);
    if (plannedHours > 0) throw new Error(`${employee.name} is already scheduled for ${plannedHours} hours on ${workDate}.`);
    bundle.overtimeEntries.unshift({ id: id("demo-ot"), workDate, employeeId: employee.id, departmentId: department.id, departmentName: department.name, employeeName: employee.name, shiftName: employee.scheduleName, hours: hours(payload.hours), costCode, reason, notes: text(payload.notes, 500), enteredBy: DEMO_EMAIL, createdAt: now });
    addAudit(bundle, "Add overtime", "overtime_entry", `${employee.name} · ${workDate}`);
  } else if (action === "update_overtime") {
    const entry = bundle.overtimeEntries.find((item) => item.id === text(payload.id, 80));
    const employee = entry && employeeFor(bundle, entry.employeeId);
    const department = departmentFor(bundle, payload.departmentId);
    const workDate = payload.workDate;
    const reason = text(payload.reason, 100);
    const costCode = text(payload.costCode, 50).toUpperCase();
    if (!entry || !employee || !dateValue(workDate) || !costCode || !OT_REASONS.includes(reason as typeof OT_REASONS[number])) throw new Error("Valid overtime details, including its date, are required.");
    const plannedHours = employeeScheduledHours(employee, workDate, bundle.workSchedules, bundle.workScheduleOverrides, bundle.scheduleOverrides);
    if (plannedHours > 0) throw new Error(`${employee.name} is already scheduled for ${plannedHours} hours on ${workDate}.`);
    Object.assign(entry, { workDate, departmentId: department.id, departmentName: department.name, hours: hours(payload.hours), costCode, reason, notes: text(payload.notes, 500) });
    addAudit(bundle, "Update overtime", "overtime_entry", entry.employeeName);
  } else if (action === "delete_overtime") {
    bundle.overtimeEntries = bundle.overtimeEntries.filter((item) => item.id !== text(payload.id, 80));
    addAudit(bundle, "Delete overtime", "overtime_entry", "Removed a local demo entry");
  } else if (action === "add_pto" || action === "add_pto_range") {
    const employee = employeeFor(bundle, payload.employeeId);
    const startDate = payload.startDate ?? payload.ptoDate;
    const endDate = payload.endDate ?? payload.ptoDate;
    const ptoType = text(payload.ptoType, 50);
    if (!dateValue(startDate) || !dateValue(endDate) || startDate > endDate || !ptoType) throw new Error("Employee, start date, through date, and PTO type are required.");
    const existingDates = new Set(bundle.ptoEntries.filter((entry) => entry.employeeId === employee.id).map((entry) => entry.ptoDate));
    const plannedDates = scheduledDatesInRange(employee, startDate, endDate, bundle.workSchedules, bundle.workScheduleOverrides, bundle.scheduleOverrides).filter((item) => !existingDates.has(item.date));
    if (!plannedDates.length) throw new Error("No PTO was added. Every date was an off day or already had a PTO entry.");
    const fixedHours = payload.useScheduledHours === false ? hours(payload.hours) : undefined;
    bundle.ptoEntries.unshift(...plannedDates.map((item) => ({ id: id("demo-pto"), ptoDate: item.date, employeeId: employee.id, hours: fixedHours ?? item.hours, ptoType, notes: text(payload.notes, 500), scheduleName: employee.scheduleName, enteredBy: DEMO_EMAIL, createdAt: now })));
    addAudit(bundle, "Add PTO range", "pto_entry", `${employee.name} · ${startDate} through ${endDate} · ${plannedDates.length} scheduled days`);
  } else if (action === "update_pto") {
    const entry = bundle.ptoEntries.find((item) => item.id === text(payload.id, 80));
    const ptoDate = payload.ptoDate;
    const ptoType = text(payload.ptoType, 50);
    if (!entry || !dateValue(ptoDate) || !ptoType) throw new Error("PTO date, hours, and type are required.");
    const employee = employeeFor(bundle, entry.employeeId);
    if (employeeScheduledHours(employee, ptoDate, bundle.workSchedules, bundle.workScheduleOverrides, bundle.scheduleOverrides) <= 0) throw new Error(`${employee.name} is not scheduled to work on ${ptoDate}.`);
    if (bundle.ptoEntries.some((item) => item.id !== entry.id && item.employeeId === employee.id && item.ptoDate === ptoDate)) throw new Error("This employee already has PTO on that date.");
    Object.assign(entry, { ptoDate, hours: hours(payload.hours), ptoType, notes: text(payload.notes, 500) });
    addAudit(bundle, "Update PTO", "pto_entry", `${employee.name} · ${ptoDate}`);
  } else if (action === "delete_pto") {
    bundle.ptoEntries = bundle.ptoEntries.filter((item) => item.id !== text(payload.id, 80));
    addAudit(bundle, "Delete PTO", "pto_entry", "Removed a local demo entry");
  } else if (action === "import_history") {
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 5000) : [];
    if (!rows.length) throw new Error("At least one historical row is required.");
    for (const sourceValue of rows) {
      const source = sourceValue as Record<string, unknown>;
      const employee = bundle.employees.find((item) => item.name.toLowerCase() === text(source.employeeName, 100).toLowerCase());
      const entryDate = source.date;
      const type = text(source.type, 10).toUpperCase();
      const codeOrType = text(source.codeOrType, 50);
      if (!employee || !dateValue(entryDate) || !codeOrType || (type !== "OT" && type !== "PTO")) throw new Error("Every history row needs a valid type, date, employee, hours, and code/type.");
      if (type === "OT") {
        const department = departmentFor(bundle, source.departmentId ?? employee.departmentId, source.department);
        if (employeeScheduledHours(employee, entryDate, bundle.workSchedules, bundle.workScheduleOverrides, bundle.scheduleOverrides) > 0) throw new Error(`${employee.name} was already scheduled to work on ${entryDate}.`);
        bundle.overtimeEntries.unshift({ id: id("demo-ot"), workDate: entryDate, employeeId: employee.id, departmentId: department.id, departmentName: department.name, employeeName: employee.name, shiftName: employee.scheduleName, hours: hours(source.hours), costCode: codeOrType.toUpperCase(), reason: text(source.reason, 100) || "Historical import", notes: text(source.notes, 500), enteredBy: DEMO_EMAIL, createdAt: now });
      } else {
        if (employeeScheduledHours(employee, entryDate, bundle.workSchedules, bundle.workScheduleOverrides, bundle.scheduleOverrides) <= 0) throw new Error(`${employee.name} is not scheduled to work on ${entryDate}; no PTO entry was created.`);
        bundle.ptoEntries.unshift({ id: id("demo-pto"), ptoDate: entryDate, employeeId: employee.id, hours: hours(source.hours), ptoType: codeOrType, notes: text(source.notes, 500), scheduleName: employee.scheduleName, enteredBy: DEMO_EMAIL, createdAt: now });
      }
    }
    addAudit(bundle, "Import history", "history", `${rows.length} local demo rows processed`);
  } else if (action === "set_override") {
    if (!dateValue(payload.workDate) || !color(payload.shiftColor)) throw new Error("A valid date and shift color are required.");
    bundle.scheduleOverrides = bundle.scheduleOverrides.filter((item) => item.workDate !== payload.workDate);
    bundle.scheduleOverrides.push({ workDate: payload.workDate, shiftColor: payload.shiftColor, reason: text(payload.reason, 250), updatedBy: DEMO_EMAIL, updatedAt: now });
    addAudit(bundle, "Update schedule", "schedule_override", payload.workDate);
  } else if (action === "delete_override") {
    if (!dateValue(payload.workDate)) throw new Error("A valid date is required.");
    bundle.scheduleOverrides = bundle.scheduleOverrides.filter((item) => item.workDate !== payload.workDate);
    addAudit(bundle, "Delete schedule correction", "schedule_override", payload.workDate);
  } else if (action === "add_profile" || action === "update_profile") {
    const email = text(payload.email, 160).toLowerCase();
    const fullName = text(payload.fullName, 100);
    const role = payload.role;
    if (!email.includes("@") || !fullName || (role !== "admin" && role !== "supervisor" && role !== "viewer")) throw new Error("Valid name, email, and role are required.");
    const assignment = role === "supervisor" ? departmentFor(bundle, payload.departmentId) : undefined;
    const schedule = role === "supervisor" && assignment ? scheduleFor(bundle, payload.scheduleId, assignment.id) : undefined;
    if (role === "supervisor" && (!assignment?.active || !schedule?.active)) throw new Error("Supervisors require an active department and work-schedule assignment.");
    const values: Profile = { email, fullName, role, active: payload.active !== false, departmentId: assignment?.id, scheduleId: schedule?.id, shiftColor: schedule?.legacyShiftColor, shiftPeriod: schedule?.legacyShiftPeriod, createdAt: now };
    if (action === "add_profile") bundle.profiles.push(values);
    else {
      const index = bundle.profiles.findIndex((item) => item.email === text(payload.originalEmail, 160).toLowerCase());
      if (index < 0) throw new Error("Select a demo profile to update.");
      bundle.profiles[index] = { ...bundle.profiles[index], ...values };
    }
    addAudit(bundle, action === "add_profile" ? "Add profile" : "Update profile", "profile", email);
  } else if (action === "delete_profile") {
    const email = text(payload.email, 160).toLowerCase();
    if (email === DEMO_EMAIL) throw new Error("The active demo administrator cannot be removed.");
    bundle.profiles = bundle.profiles.filter((item) => item.email !== email);
    addAudit(bundle, "Delete profile", "profile", email);
  } else {
    throw new Error("This demo action is not available.");
  }

  return saveDemoBundle(bundle);
}
