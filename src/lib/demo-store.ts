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
} from "./tracker-api";
import { baseShiftForDate, toDateInput, type ShiftColor } from "./schedule";

const DEMO_STORAGE_KEY = "operations-hours-local-demo-v1";
const DEMO_VERSION = 1;
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

function fakeEmployees(departments: Department[]): Employee[] {
  const departmentByName = new Map(departments.map((department) => [department.name, department]));
  const rows: Array<[string, string, ShiftColor, "Day" | "Night"]> = [
    ["Avery Stone", "Extrusion", "Blue", "Day"], ["Blake Turner", "Extrusion", "Blue", "Day"],
    ["Cameron Wells", "Extrusion", "Blue", "Day"], ["Devon Reed", "Extrusion", "Blue", "Day"],
    ["Emery Collins", "Extrusion", "Blue", "Day"], ["Finley Brooks", "Extrusion", "Blue", "Night"],
    ["Gray Morgan", "Extrusion", "Blue", "Night"], ["Harper Lane", "Extrusion", "Blue", "Night"],
    ["Indigo Price", "Extrusion", "Blue", "Night"], ["Jordan Hayes", "Extrusion", "Blue", "Night"],
    ["Kai Bennett", "Extrusion", "Yellow", "Day"], ["Logan Parker", "Extrusion", "Yellow", "Day"],
    ["Micah Foster", "Extrusion", "Yellow", "Day"], ["Noel Griffin", "Extrusion", "Yellow", "Day"],
    ["Oakley Shaw", "Extrusion", "Yellow", "Day"], ["Peyton Ellis", "Extrusion", "Yellow", "Night"],
    ["Quinn Bailey", "Extrusion", "Yellow", "Night"], ["Reese Jordan", "Extrusion", "Yellow", "Night"],
    ["Skyler Ward", "Extrusion", "Yellow", "Night"], ["Tatum Blake", "Extrusion", "Yellow", "Night"],
    ["Alexis Monroe", "Spray Dry", "Blue", "Day"], ["Charlie Rowan", "Spray Dry", "Blue", "Night"],
    ["Dakota Quinn", "Spray Dry", "Yellow", "Day"], ["Frankie Sage", "Spray Dry", "Yellow", "Night"],
    ["Jamie Rivers", "Packaging", "Blue", "Day"], ["Kendall Hart", "Packaging", "Blue", "Night"],
    ["Marley Dean", "Packaging", "Yellow", "Day"], ["Nico James", "Packaging", "Yellow", "Night"],
    ["Robin Clarke", "Warehouse", "Blue", "Day"], ["Sasha Flynn", "Warehouse", "Blue", "Night"],
    ["Taylor Knox", "Warehouse", "Yellow", "Day"], ["Winter Lake", "Warehouse", "Yellow", "Night"],
  ];
  return rows.map(([name, departmentName, shiftColor, shiftPeriod], index) => {
    const department = departmentByName.get(departmentName)!;
    return {
      id: `demo-employee-${index + 1}`,
      name,
      shiftColor,
      shiftPeriod,
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
    { id: "demo-dept-extrusion", name: "Extrusion", defaultCostCode: "EXT-100", active: true, createdAt: now, updatedAt: now },
    { id: "demo-dept-spray", name: "Spray Dry", defaultCostCode: "SPD-200", active: true, createdAt: now, updatedAt: now },
    { id: "demo-dept-packaging", name: "Packaging", defaultCostCode: "PKG-300", active: true, createdAt: now, updatedAt: now },
    { id: "demo-dept-warehouse", name: "Warehouse", defaultCostCode: "WHS-400", active: true, createdAt: now, updatedAt: now },
  ];
  const employees = fakeEmployees(departments);
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
    return { employeeId: employee.id, positionId, shiftColor: employee.shiftColor, shiftPeriod: employee.shiftPeriod, updatedBy: DEMO_EMAIL, updatedAt: timestampByOffset(-index, 8) };
  });

  const entryDates = [-1, -3, -8, -12, -18, -25].map(dateByOffset);
  const overtimeEntries = entryDates.map((workDate, index) => {
    const working = baseShiftForDate(workDate);
    const employee = employees.find((item) => item.shiftColor !== working && item.active && item.departmentId === departments[index % departments.length].id)
      ?? employees.find((item) => item.shiftColor !== working)!;
    const department = departments[index % departments.length];
    return {
      id: `demo-ot-${index + 1}`,
      workDate,
      employeeId: employee.id,
      departmentId: department.id,
      departmentName: department.name,
      employeeName: employee.name,
      shiftName: `${employee.shiftColor} ${employee.shiftPeriod}`,
      hours: index === 2 ? 4 : 12,
      costCode: department.defaultCostCode,
      reason: ["Production Needs", "Call-Off Coverage", "Training", "Staffing Shortage"][index % 4],
      notes: ["Covered a planned opening", "Helped cover a call-off", "Cross-training on the line", "Additional staffing for production"][index % 4],
      enteredBy: DEMO_EMAIL,
      createdAt: timestampByOffset(-index, 14),
    };
  });
  const ptoEntries = [-2, -6, -10, 2].map((offset, index) => ({
    id: `demo-pto-${index + 1}`,
    ptoDate: dateByOffset(offset),
    employeeId: employees[20 + index].id,
    hours: index === 3 ? 4 : 12,
    ptoType: ["Vacation", "Sick", "Personal", "Vacation"][index],
    notes: index === 1 ? "Approved sick time" : "Approved request",
    enteredBy: DEMO_EMAIL,
    createdAt: timestampByOffset(offset - 3, 10),
  }));
  const profiles: Profile[] = [
    { email: DEMO_EMAIL, fullName: "Demo Administrator", role: "admin", active: true, userId: "demo-local-user", createdAt: now },
    { email: "supervisor@example.com", fullName: "Demo Supervisor", role: "supervisor", active: true, departmentId: departments[0].id, shiftColor: "Blue", shiftPeriod: "Day", createdAt: now },
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
    const occupied = bundle.crewPlacements.find((item) => item.positionId === position.id && item.shiftColor === employee.shiftColor && item.shiftPeriod === employee.shiftPeriod);
    bundle.crewPlacements = bundle.crewPlacements.filter((item) => item.employeeId !== employee.id && item.employeeId !== occupied?.employeeId);
    if (occupied && previous) bundle.crewPlacements.push({ ...occupied, positionId: previous.positionId, updatedBy: DEMO_EMAIL, updatedAt: now });
    bundle.crewPlacements.push({ employeeId: employee.id, positionId: position.id, shiftColor: employee.shiftColor, shiftPeriod: employee.shiftPeriod, updatedBy: DEMO_EMAIL, updatedAt: now });
    bundle.crewPlacementHistory.unshift({ id: id("demo-history"), employeeId: employee.id, previousPositionId: previous?.positionId, nextPositionId: position.id, changedBy: DEMO_EMAIL, changedAt: now });
    if (occupied) bundle.crewPlacementHistory.unshift({ id: id("demo-history"), employeeId: occupied.employeeId, previousPositionId: occupied.positionId, nextPositionId: previous?.positionId, changedBy: DEMO_EMAIL, changedAt: now });
    addAudit(bundle, "Update crew placement", "crew_placement", `${employee.name} moved to ${system.name} · ${position.name}`);
  } else if (action === "clear_crew_placement") {
    const employee = employeeFor(bundle, payload.employeeId);
    const previous = bundle.crewPlacements.find((item) => item.employeeId === employee.id);
    bundle.crewPlacements = bundle.crewPlacements.filter((item) => item.employeeId !== employee.id);
    if (previous) bundle.crewPlacementHistory.unshift({ id: id("demo-history"), employeeId: employee.id, previousPositionId: previous.positionId, changedBy: DEMO_EMAIL, changedAt: now });
    addAudit(bundle, "Clear crew placement", "crew_placement", `${employee.name} moved to Unassigned`);
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
    if (!name || !department.active || !color(payload.shiftColor) || !period(payload.shiftPeriod)) throw new Error("Name, department, shift color, and shift period are required.");
    if (action === "add_employee") {
      bundle.employees.push({ id: id("demo-employee"), name, departmentId: department.id, department: department.name, shiftColor: payload.shiftColor, shiftPeriod: payload.shiftPeriod, active: true, createdAt: now });
    } else {
      const employee = employeeFor(bundle, payload.id);
      employee.name = name;
      employee.departmentId = department.id;
      employee.department = department.name;
      employee.shiftColor = payload.shiftColor;
      employee.shiftPeriod = payload.shiftPeriod;
      employee.active = Boolean(payload.active);
      bundle.crewPlacements = bundle.crewPlacements.filter((item) => item.employeeId !== employee.id);
    }
    addAudit(bundle, action === "add_employee" ? "Add employee" : "Update employee", "employee", name);
  } else if (action === "import_employees") {
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 1000) : [];
    if (!rows.length) throw new Error("At least one employee row is required.");
    for (const sourceValue of rows) {
      const source = sourceValue as Record<string, unknown>;
      const name = text(source.name, 100);
      const department = departmentFor(bundle, source.departmentId, source.department);
      if (!name || !color(source.shiftColor) || !period(source.shiftPeriod)) throw new Error("Every imported employee needs a valid name, department, shift color, and shift period.");
      const existing = bundle.employees.find((item) => item.name.toLowerCase() === name.toLowerCase());
      const values = { name, departmentId: department.id, department: department.name, shiftColor: source.shiftColor, shiftPeriod: source.shiftPeriod, active: source.active !== false };
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
    const workingColor = bundle.scheduleOverrides.find((item) => item.workDate === workDate)?.shiftColor ?? baseShiftForDate(workDate);
    if (employee.shiftColor === workingColor) throw new Error(`${employee.name} is already scheduled to work on ${workDate}.`);
    bundle.overtimeEntries.unshift({ id: id("demo-ot"), workDate, employeeId: employee.id, departmentId: department.id, departmentName: department.name, employeeName: employee.name, shiftName: `${employee.shiftColor} ${employee.shiftPeriod}`, hours: hours(payload.hours), costCode, reason, notes: text(payload.notes, 500), enteredBy: DEMO_EMAIL, createdAt: now });
    addAudit(bundle, "Add overtime", "overtime_entry", `${employee.name} · ${workDate}`);
  } else if (action === "update_overtime") {
    const entry = bundle.overtimeEntries.find((item) => item.id === text(payload.id, 80));
    const department = departmentFor(bundle, payload.departmentId);
    const reason = text(payload.reason, 100);
    const costCode = text(payload.costCode, 50).toUpperCase();
    if (!entry || !costCode || !OT_REASONS.includes(reason as typeof OT_REASONS[number])) throw new Error("Valid overtime details are required.");
    Object.assign(entry, { departmentId: department.id, departmentName: department.name, hours: hours(payload.hours), costCode, reason, notes: text(payload.notes, 500) });
    addAudit(bundle, "Update overtime", "overtime_entry", entry.employeeName);
  } else if (action === "delete_overtime") {
    bundle.overtimeEntries = bundle.overtimeEntries.filter((item) => item.id !== text(payload.id, 80));
    addAudit(bundle, "Delete overtime", "overtime_entry", "Removed a local demo entry");
  } else if (action === "add_pto") {
    const employee = employeeFor(bundle, payload.employeeId);
    const ptoDate = payload.ptoDate;
    const ptoType = text(payload.ptoType, 50);
    if (!dateValue(ptoDate) || !ptoType) throw new Error("Employee, date, and PTO type are required.");
    bundle.ptoEntries.unshift({ id: id("demo-pto"), ptoDate, employeeId: employee.id, hours: hours(payload.hours), ptoType, notes: text(payload.notes, 500), enteredBy: DEMO_EMAIL, createdAt: now });
    addAudit(bundle, "Add PTO", "pto_entry", `${employee.name} · ${ptoDate}`);
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
        bundle.overtimeEntries.unshift({ id: id("demo-ot"), workDate: entryDate, employeeId: employee.id, departmentId: department.id, departmentName: department.name, employeeName: employee.name, shiftName: `${employee.shiftColor} ${employee.shiftPeriod}`, hours: hours(source.hours), costCode: codeOrType.toUpperCase(), reason: text(source.reason, 100) || "Historical import", notes: text(source.notes, 500), enteredBy: DEMO_EMAIL, createdAt: now });
      } else {
        bundle.ptoEntries.unshift({ id: id("demo-pto"), ptoDate: entryDate, employeeId: employee.id, hours: hours(source.hours), ptoType: codeOrType, notes: text(source.notes, 500), enteredBy: DEMO_EMAIL, createdAt: now });
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
    if (role === "supervisor" && (!color(payload.shiftColor) || !period(payload.shiftPeriod))) throw new Error("Supervisors require a department, shift color, and Day or Night assignment.");
    const values: Profile = { email, fullName, role, active: payload.active !== false, departmentId: assignment?.id, shiftColor: role === "supervisor" ? payload.shiftColor as ShiftColor : undefined, shiftPeriod: role === "supervisor" ? payload.shiftPeriod as "Day" | "Night" : undefined, createdAt: now };
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
