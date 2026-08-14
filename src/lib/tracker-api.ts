import type { SupabaseClient } from "@supabase/supabase-js";
import { baseShiftForDate, type ShiftColor } from "./schedule";
import { supabase } from "./supabase";

export const OT_REASONS = [
  "Call-Off Coverage",
  "Production Needs",
  "Training",
  "Maintenance",
  "Staffing Shortage",
  "Project Work",
  "Other",
] as const;

export type Role = "admin" | "supervisor" | "viewer";
export const DASHBOARD_WIDGET_IDS = [
  "shift_today",
  "kpi_ot",
  "kpi_pto",
  "kpi_employees",
  "kpi_ot_people",
  "ot_trend",
  "department_ot",
  "shift_ot",
  "reason_ot",
  "cost_code_ot",
  "pto_type",
  "staffing_department",
  "staffing_crew",
  "placement_coverage",
  "placement_gaps",
  "schedule",
  "selected_ot",
  "selected_pto",
] as const;
export type DashboardWidgetId = typeof DASHBOARD_WIDGET_IDS[number];
export type DashboardWidgetSize = "compact" | "standard" | "wide";
export type DashboardWidget = { id: DashboardWidgetId; size: DashboardWidgetSize };
export type Profile = { email: string; fullName: string; role: Role; active: boolean; userId?: string; departmentId?: string; shiftColor?: ShiftColor; shiftPeriod?: "Day" | "Night"; createdAt?: string };
export type Department = { id: string; name: string; defaultCostCode: string; active: boolean; createdAt?: string; updatedAt?: string };
export type Employee = {
  id: string;
  name: string;
  shiftColor: ShiftColor;
  shiftPeriod: "Day" | "Night";
  departmentId: string;
  department: string;
  active: boolean;
  createdAt?: string;
};
export type OvertimeEntry = {
  id: string;
  workDate: string;
  employeeId: string;
  departmentId: string;
  departmentName: string;
  employeeName: string;
  shiftName: string;
  hours: number;
  costCode: string;
  reason: string;
  notes: string;
  enteredBy: string;
  createdAt: string;
};
export type PtoEntry = { id: string; ptoDate: string; employeeId: string; hours: number; ptoType: string; notes: string; enteredBy: string; createdAt: string };
export type Override = { workDate: string; shiftColor: ShiftColor; reason: string; updatedBy: string; updatedAt?: string };
export type Audit = { id: string; action: string; entityType: string; details: string; userEmail: string; createdAt: string };
export type CrewSystem = { id: string; departmentId: string; name: string; sortOrder: number; active: boolean; createdAt: string; updatedAt: string };
export type CrewPosition = { id: string; systemId: string; name: string; sortOrder: number; required: boolean; active: boolean; createdAt: string; updatedAt: string };
export type CrewPlacement = { employeeId: string; positionId: string; shiftColor: ShiftColor; shiftPeriod: "Day" | "Night"; updatedBy: string; updatedAt: string };
export type CrewPlacementHistory = { id: string; employeeId: string; previousPositionId?: string; nextPositionId?: string; changedBy: string; changedAt: string };
export type TrackerBundle = {
  backend: "supabase";
  session: Profile;
  departments: Department[];
  employees: Employee[];
  overtimeEntries: OvertimeEntry[];
  ptoEntries: PtoEntry[];
  scheduleOverrides: Override[];
  dashboardWidgets: DashboardWidget[];
  dashboardPersistenceReady: boolean;
  profiles: Profile[];
  auditLog: Audit[];
  crewSystems: CrewSystem[];
  crewPositions: CrewPosition[];
  crewPlacements: CrewPlacement[];
  crewPlacementHistory: CrewPlacementHistory[];
  crewPlacementReady: boolean;
};

type DbError = { message: string; code?: string } | null;
type ProfileRow = { email: string; full_name: string; role: Role; active: boolean; department_id: string | null; shift_color: ShiftColor | null; shift_period: "Day" | "Night" | null; created_at: string };
type DepartmentRow = { id: string; name: string; default_cost_code: string; active: boolean; created_at: string; updated_at: string };
type EmployeeRow = { id: string; name: string; shift_color: ShiftColor; shift_period: "Day" | "Night"; department_id: string; department: string; active: boolean; created_at: string };
type OvertimeRow = {
  id: string;
  work_date: string;
  employee_id: string;
  department_id: string;
  department_name_snapshot: string;
  employee_name_snapshot: string;
  shift_name_snapshot: string;
  hours: number | string;
  cost_code: string;
  reason: string;
  notes: string;
  entered_by: string;
  created_at: string;
};
type PtoRow = { id: string; pto_date: string; employee_id: string; hours: number | string; pto_type: string; notes: string; entered_by: string; created_at: string };
type OverrideRow = { work_date: string; shift_color: ShiftColor; reason: string; updated_by: string; updated_at: string };
type AuditRow = { id: string; action: string; entity_type: string; entity_id: string; details: unknown; user_email: string; created_at: string };
type DashboardPreferenceRow = { widgets: unknown };
type CrewSystemRow = { id: string; department_id: string; name: string; sort_order: number; active: boolean; created_at: string; updated_at: string };
type CrewPositionRow = { id: string; system_id: string; name: string; sort_order: number; required: boolean; active: boolean; created_at: string; updated_at: string };
type CrewPlacementRow = { employee_id: string; position_id: string; shift_color: ShiftColor; shift_period: "Day" | "Night"; updated_by: string; updated_at: string };
type CrewPlacementHistoryRow = { id: string; employee_id: string; previous_position_id: string | null; next_position_id: string | null; changed_by: string; changed_at: string };

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidget[] = [
  { id: "shift_today", size: "wide" },
  { id: "kpi_ot", size: "compact" },
  { id: "kpi_pto", size: "compact" },
  { id: "kpi_employees", size: "compact" },
  { id: "kpi_ot_people", size: "compact" },
  { id: "ot_trend", size: "wide" },
  { id: "department_ot", size: "standard" },
  { id: "shift_ot", size: "standard" },
  { id: "schedule", size: "wide" },
  { id: "selected_ot", size: "standard" },
  { id: "selected_pto", size: "standard" },
];

function check(error: DbError, action: string) {
  if (error) throw new Error(`Supabase could not ${action}: ${error.message}`);
}

function missingDashboardPreferencesTable(error: DbError) {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return error.code === "PGRST205" || error.code === "42P01" || (message.includes("dashboard_preferences") && (message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find")));
}

function missingCrewPlacementTable(error: DbError) {
  if (!error) return false;
  const message = error.message.toLowerCase();
  return error.code === "PGRST205" || error.code === "42P01" || (["crew_systems", "crew_positions", "crew_placements", "crew_placement_history"].some((table) => message.includes(table)) && (message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find")));
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validColor(value: unknown): value is ShiftColor {
  return value === "Blue" || value === "Yellow";
}

function asHours(value: unknown) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error("Hours must be between 0 and 24.");
  if (Math.abs(hours * 4 - Math.round(hours * 4)) > 0.0001) throw new Error("Hours must use quarter-hour increments.");
  return Math.round(hours * 4) / 4;
}

function textValue(value: unknown, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sortOrderValue(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 10000) throw new Error("Sort order must be a whole number between 0 and 10,000.");
  return number;
}

function dashboardWidgets(value: unknown): DashboardWidget[] {
  if (!Array.isArray(value)) throw new Error("Dashboard layout must be a list of approved widgets.");
  if (value.length > DASHBOARD_WIDGET_IDS.length) throw new Error("Dashboard layout contains too many widgets.");
  const allowedIds = new Set<string>(DASHBOARD_WIDGET_IDS);
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Dashboard layout contains an invalid widget.");
    const id = "id" in item ? item.id : undefined;
    const size = "size" in item ? item.size : undefined;
    if (typeof id !== "string" || !allowedIds.has(id) || seen.has(id)) throw new Error("Dashboard layout contains an unknown or duplicate widget.");
    if (size !== "compact" && size !== "standard" && size !== "wide") throw new Error("Dashboard widget size is invalid.");
    seen.add(id);
    return { id: id as DashboardWidgetId, size };
  });
}

function requireWrite(role: Role) {
  if (role !== "admin" && role !== "supervisor") throw new Error("Supervisor access is required.");
}

function requireAdmin(role: Role) {
  if (role !== "admin") throw new Error("Administrator access is required.");
}

function profile(row: ProfileRow): Profile {
  return { email: row.email, fullName: row.full_name, role: row.role, active: row.active, departmentId: row.department_id ?? undefined, shiftColor: row.shift_color ?? undefined, shiftPeriod: row.shift_period ?? undefined, createdAt: row.created_at };
}

function department(row: DepartmentRow): Department {
  return { id: row.id, name: row.name, defaultCostCode: row.default_cost_code, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at };
}

function employee(row: EmployeeRow): Employee {
  return { id: row.id, name: row.name, shiftColor: row.shift_color, shiftPeriod: row.shift_period, departmentId: row.department_id, department: row.department, active: row.active, createdAt: row.created_at };
}

function overtime(row: OvertimeRow): OvertimeEntry {
  return {
    id: row.id,
    workDate: row.work_date,
    employeeId: row.employee_id,
    departmentId: row.department_id,
    departmentName: row.department_name_snapshot,
    employeeName: row.employee_name_snapshot,
    shiftName: row.shift_name_snapshot,
    hours: Number(row.hours),
    costCode: row.cost_code,
    reason: row.reason,
    notes: row.notes,
    enteredBy: row.entered_by,
    createdAt: row.created_at,
  };
}

function pto(row: PtoRow): PtoEntry {
  return { id: row.id, ptoDate: row.pto_date, employeeId: row.employee_id, hours: Number(row.hours), ptoType: row.pto_type, notes: row.notes, enteredBy: row.entered_by, createdAt: row.created_at };
}

function override(row: OverrideRow): Override {
  return { workDate: row.work_date, shiftColor: row.shift_color, reason: row.reason, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

function audit(row: AuditRow): Audit {
  return { id: row.id, action: row.action, entityType: row.entity_type, details: typeof row.details === "string" ? row.details : JSON.stringify(row.details ?? {}), userEmail: row.user_email, createdAt: row.created_at };
}

function crewSystem(row: CrewSystemRow): CrewSystem {
  return { id: row.id, departmentId: row.department_id, name: row.name, sortOrder: row.sort_order, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at };
}

function crewPosition(row: CrewPositionRow): CrewPosition {
  return { id: row.id, systemId: row.system_id, name: row.name, sortOrder: row.sort_order, required: row.required, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at };
}

function crewPlacement(row: CrewPlacementRow): CrewPlacement {
  return { employeeId: row.employee_id, positionId: row.position_id, shiftColor: row.shift_color, shiftPeriod: row.shift_period, updatedBy: row.updated_by, updatedAt: row.updated_at };
}

function crewPlacementHistory(row: CrewPlacementHistoryRow): CrewPlacementHistory {
  return { id: row.id, employeeId: row.employee_id, previousPositionId: row.previous_position_id ?? undefined, nextPositionId: row.next_position_id ?? undefined, changedBy: row.changed_by, changedAt: row.changed_at };
}

async function currentProfile(db: SupabaseClient): Promise<Profile> {
  const userResult = await db.auth.getUser();
  check(userResult.error, "verify the signed-in user");
  const email = userResult.data.user?.email?.trim().toLowerCase();
  if (!email) throw new Error("Your signed-in account does not have an email address.");
  const result = await db.from("profiles").select("*").eq("email", email).maybeSingle();
  check(result.error, "read your approved user profile");
  const row = result.data as unknown as ProfileRow | null;
  if (!row) throw new Error("Your email has not been approved for this tracker. Ask an administrator to add the exact email used to sign in.");
  if (!row.active) throw new Error("Your tracker account is inactive.");
  return { ...profile(row), userId: userResult.data.user?.id };
}

async function departmentRows() {
  const result = await supabase.from("departments").select("*").order("active", { ascending: false }).order("name");
  check(result.error, "load departments");
  return (result.data ?? []) as unknown as DepartmentRow[];
}

async function crewEmployeeInScope(session: Profile, employeeId: string) {
  const result = await supabase.from("employees").select("*").eq("id", employeeId).maybeSingle();
  check(result.error, "find the crew employee");
  const selectedEmployee = result.data as unknown as EmployeeRow | null;
  if (!selectedEmployee?.active) throw new Error("Select an active employee.");
  if (session.role === "supervisor" && (session.departmentId !== selectedEmployee.department_id || session.shiftColor !== selectedEmployee.shift_color || session.shiftPeriod !== selectedEmployee.shift_period)) {
    throw new Error("You can only update your assigned department and crew.");
  }
  return selectedEmployee;
}

async function allEntryRows(table: "overtime_entries" | "pto_entries", dateColumn: "work_date" | "pto_date") {
  const rows: unknown[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const result = await supabase.from(table).select("*").order(dateColumn, { ascending: false }).order("created_at", { ascending: false }).range(start, start + pageSize - 1);
    check(result.error, `load ${table.replaceAll("_", " ")}`);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function selectedDepartment(rows: DepartmentRow[], idValue: unknown, nameValue?: unknown) {
  const id = textValue(idValue, 80);
  const name = textValue(nameValue, 100).toLowerCase();
  const match = rows.find((item) => item.id === id) ?? rows.find((item) => item.name.trim().toLowerCase() === name);
  if (!match) throw new Error("Select a configured department.");
  return match;
}

function validReason(value: unknown, fallback = "") {
  const reason = textValue(value, 100) || fallback;
  const allowed: readonly string[] = [...OT_REASONS, "Historical entry", "Historical import"];
  if (!allowed.includes(reason)) throw new Error("Select a valid overtime reason.");
  return reason;
}

export async function loadBundle(): Promise<TrackerBundle> {
  const session = await currentProfile(supabase);
  if (!session.userId) throw new Error("Your Supabase account is missing a user ID.");
  const [departmentResult, employeeResult, overtimeRows, ptoRows, overrideResult, dashboardResult, profileResult, auditResult, crewSystemResult, crewPositionResult, crewPlacementResult, crewHistoryResult] = await Promise.all([
    supabase.from("departments").select("*").order("active", { ascending: false }).order("name"),
    supabase.from("employees").select("*").order("shift_color").order("shift_period").order("name"),
    allEntryRows("overtime_entries", "work_date"),
    allEntryRows("pto_entries", "pto_date"),
    supabase.from("schedule_overrides").select("*").order("work_date", { ascending: false }),
    supabase.from("dashboard_preferences").select("widgets").eq("user_id", session.userId).maybeSingle(),
    session.role === "admin" ? supabase.from("profiles").select("*").order("full_name") : Promise.resolve({ data: [], error: null }),
    session.role === "admin" ? supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
    supabase.from("crew_systems").select("*").order("sort_order").order("name"),
    supabase.from("crew_positions").select("*").order("sort_order").order("name"),
    supabase.from("crew_placements").select("*").order("updated_at", { ascending: false }),
    supabase.from("crew_placement_history").select("*").order("changed_at", { ascending: false }).limit(250),
  ]);
  check(departmentResult.error, "load departments");
  check(employeeResult.error, "load employees");
  check(overrideResult.error, "load schedule corrections");
  const dashboardPersistenceReady = !dashboardResult.error;
  if (dashboardResult.error && !missingDashboardPreferencesTable(dashboardResult.error)) check(dashboardResult.error, "load your dashboard layout");
  check(profileResult.error, "load approved users");
  check(auditResult.error, "load audit history");
  const crewResults = [crewSystemResult, crewPositionResult, crewPlacementResult, crewHistoryResult];
  const crewPlacementReady = crewResults.every((result) => !result.error);
  for (const result of crewResults) {
    if (result.error && !missingCrewPlacementTable(result.error)) check(result.error, "load crew placement");
  }

  return {
    backend: "supabase",
    session,
    departments: ((departmentResult.data ?? []) as unknown as DepartmentRow[]).map(department),
    employees: ((employeeResult.data ?? []) as unknown as EmployeeRow[]).map(employee),
    overtimeEntries: (overtimeRows as OvertimeRow[]).map(overtime),
    ptoEntries: (ptoRows as PtoRow[]).map(pto),
    scheduleOverrides: ((overrideResult.data ?? []) as unknown as OverrideRow[]).map(override),
    dashboardWidgets: dashboardPersistenceReady && dashboardResult.data ? dashboardWidgets((dashboardResult.data as unknown as DashboardPreferenceRow).widgets) : DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })),
    dashboardPersistenceReady,
    profiles: ((profileResult.data ?? []) as unknown as ProfileRow[]).map(profile),
    auditLog: ((auditResult.data ?? []) as unknown as AuditRow[]).map(audit),
    crewSystems: crewPlacementReady ? ((crewSystemResult.data ?? []) as unknown as CrewSystemRow[]).map(crewSystem) : [],
    crewPositions: crewPlacementReady ? ((crewPositionResult.data ?? []) as unknown as CrewPositionRow[]).map(crewPosition) : [],
    crewPlacements: crewPlacementReady ? ((crewPlacementResult.data ?? []) as unknown as CrewPlacementRow[]).map(crewPlacement) : [],
    crewPlacementHistory: crewPlacementReady ? ((crewHistoryResult.data ?? []) as unknown as CrewPlacementHistoryRow[]).map(crewPlacementHistory) : [],
    crewPlacementReady,
  };
}

export async function mutateTracker(payload: Record<string, unknown>): Promise<TrackerBundle> {
  const action = textValue(payload.action, 50);
  const session = await currentProfile(supabase);

  if (action === "save_dashboard_layout") {
    if (!session.userId) throw new Error("Your Supabase account is missing a user ID.");
    const widgets = dashboardWidgets(payload.widgets);
    const result = await supabase.from("dashboard_preferences").upsert({ user_id: session.userId, widgets, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    check(result.error, "save your dashboard layout");
  } else if (action === "add_crew_system") {
    requireAdmin(session.role);
    const name = textValue(payload.name, 100);
    const selected = selectedDepartment(await departmentRows(), payload.departmentId);
    if (!name || !selected.active) throw new Error("An active department and system name are required.");
    const result = await supabase.from("crew_systems").insert({ id: crypto.randomUUID(), department_id: selected.id, name, sort_order: sortOrderValue(payload.sortOrder ?? 0), active: true });
    check(result.error, "add the crew system");
  } else if (action === "update_crew_system") {
    requireAdmin(session.role);
    const id = textValue(payload.id, 80);
    const name = textValue(payload.name, 100);
    if (!id || !name) throw new Error("Select a crew system and enter its name.");
    if (payload.active === false) {
      const positions = await supabase.from("crew_positions").select("id").eq("system_id", id);
      check(positions.error, "find crew system positions");
      const ids = (positions.data ?? []).map((row) => String(row.id));
      if (ids.length) {
        const clear = await supabase.from("crew_placements").delete().in("position_id", ids);
        check(clear.error, "clear placements from the inactive system");
      }
    }
    const result = await supabase.from("crew_systems").update({ name, sort_order: sortOrderValue(payload.sortOrder ?? 0), active: payload.active !== false, updated_at: new Date().toISOString() }).eq("id", id);
    check(result.error, "update the crew system");
  } else if (action === "add_crew_position") {
    requireAdmin(session.role);
    const systemId = textValue(payload.systemId, 80);
    const name = textValue(payload.name, 100);
    if (!systemId || !name) throw new Error("Select a system and enter a position name.");
    const system = await supabase.from("crew_systems").select("id, active").eq("id", systemId).maybeSingle();
    check(system.error, "find the crew system");
    if (!system.data?.active) throw new Error("Positions can only be added to an active system.");
    const result = await supabase.from("crew_positions").insert({ id: crypto.randomUUID(), system_id: systemId, name, sort_order: sortOrderValue(payload.sortOrder ?? 0), required: payload.required !== false, active: true });
    check(result.error, "add the crew position");
  } else if (action === "update_crew_position") {
    requireAdmin(session.role);
    const id = textValue(payload.id, 80);
    const name = textValue(payload.name, 100);
    if (!id || !name) throw new Error("Select a crew position and enter its name.");
    if (payload.active === false) {
      const clear = await supabase.from("crew_placements").delete().eq("position_id", id);
      check(clear.error, "clear placements from the inactive position");
    }
    const result = await supabase.from("crew_positions").update({ name, sort_order: sortOrderValue(payload.sortOrder ?? 0), required: payload.required !== false, active: payload.active !== false, updated_at: new Date().toISOString() }).eq("id", id);
    check(result.error, "update the crew position");
  } else if (action === "assign_crew_position") {
    requireWrite(session.role);
    const employeeId = textValue(payload.employeeId, 80);
    const positionId = textValue(payload.positionId, 80);
    if (!employeeId || !positionId) throw new Error("Select an employee and a position.");
    await crewEmployeeInScope(session, employeeId);
    const result = await supabase.rpc("move_crew_employee", { target_employee_id: employeeId, target_position_id: positionId });
    check(result.error, "move the crew employee");
  } else if (action === "clear_crew_placement") {
    requireWrite(session.role);
    const employeeId = textValue(payload.employeeId, 80);
    if (!employeeId) throw new Error("Select an employee to unassign.");
    await crewEmployeeInScope(session, employeeId);
    const result = await supabase.from("crew_placements").delete().eq("employee_id", employeeId);
    check(result.error, "clear the crew placement");
  } else if (action === "add_department" || action === "update_department") {
    requireAdmin(session.role);
    const name = textValue(payload.name, 100);
    const defaultCostCode = textValue(payload.defaultCostCode, 50).toUpperCase();
    if (!name || !defaultCostCode) throw new Error("Department name and default cost code are required.");
    if (action === "add_department") {
      const result = await supabase.from("departments").insert({ id: crypto.randomUUID(), name, default_cost_code: defaultCostCode, active: true });
      check(result.error, "add the department");
    } else {
      const id = textValue(payload.id, 80);
      if (!id) throw new Error("Select a department to update.");
      const result = await supabase.from("departments").update({ name, default_cost_code: defaultCostCode, active: payload.active !== false }).eq("id", id);
      check(result.error, "update the department");
    }
  } else if (action === "add_employee") {
    requireAdmin(session.role);
    const name = textValue(payload.name, 100);
    const shiftColor = payload.shiftColor;
    const shiftPeriod = payload.shiftPeriod;
    const selected = selectedDepartment(await departmentRows(), payload.departmentId, payload.department);
    if (!name || !validColor(shiftColor) || (shiftPeriod !== "Day" && shiftPeriod !== "Night")) throw new Error("Name, department, shift color, and shift period are required.");
    if (!selected.active) throw new Error("Select an active department.");
    const result = await supabase.from("employees").insert({ id: crypto.randomUUID(), name, shift_color: shiftColor, shift_period: shiftPeriod, department_id: selected.id, department: selected.name, active: true });
    check(result.error, "add the employee");
  } else if (action === "import_employees") {
    requireAdmin(session.role);
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 1000) : [];
    if (!rows.length) throw new Error("At least one employee row is required.");
    const [currentResult, departments] = await Promise.all([supabase.from("employees").select("*"), departmentRows()]);
    check(currentResult.error, "load employees for import");
    const current = (currentResult.data ?? []) as unknown as EmployeeRow[];
    const byName = new Map(current.map((item) => [item.name.trim().toLowerCase(), item]));
    const normalized = new Map<string, Record<string, unknown>>();
    for (let index = 0; index < rows.length; index += 1) {
      const source = rows[index] as Record<string, unknown>;
      const name = textValue(source.name, 100);
      const shiftColor = source.shiftColor;
      const shiftPeriod = source.shiftPeriod;
      const selected = selectedDepartment(departments, source.departmentId, source.department);
      if (!name || !validColor(shiftColor) || (shiftPeriod !== "Day" && shiftPeriod !== "Night")) throw new Error(`Employee import row ${index + 2} needs a valid name, department, shift color, and shift period.`);
      if (!selected.active) throw new Error(`Employee import row ${index + 2} uses an inactive department.`);
      normalized.set(name.toLowerCase(), { name, shift_color: shiftColor, shift_period: shiftPeriod, department_id: selected.id, department: selected.name, active: source.active !== false });
    }
    const inserts: Array<Record<string, unknown>> = [];
    for (const [nameKey, values] of normalized) {
      const existing = byName.get(nameKey);
      if (existing) {
        const result = await supabase.from("employees").update(values).eq("id", existing.id);
        check(result.error, "update an imported employee");
      } else inserts.push({ id: crypto.randomUUID(), ...values });
    }
    for (let index = 0; index < inserts.length; index += 100) {
      const result = await supabase.from("employees").insert(inserts.slice(index, index + 100));
      check(result.error, "import new employees");
    }
  } else if (action === "update_employee") {
    requireAdmin(session.role);
    const id = textValue(payload.id, 80);
    const name = textValue(payload.name, 100);
    const shiftColor = payload.shiftColor;
    const shiftPeriod = payload.shiftPeriod;
    const selected = selectedDepartment(await departmentRows(), payload.departmentId, payload.department);
    if (!id || !name || !validColor(shiftColor) || (shiftPeriod !== "Day" && shiftPeriod !== "Night")) throw new Error("Valid employee information is required.");
    if (!selected.active) throw new Error("Select an active department.");
    const result = await supabase.from("employees").update({ name, shift_color: shiftColor, shift_period: shiftPeriod, department_id: selected.id, department: selected.name, active: Boolean(payload.active) }).eq("id", id);
    check(result.error, "update the employee");
  } else if (action === "add_overtime") {
    requireWrite(session.role);
    const employeeId = textValue(payload.employeeId, 80);
    const workDate = payload.workDate;
    const costCode = textValue(payload.costCode, 50).toUpperCase();
    const reason = validReason(payload.reason);
    const selected = selectedDepartment(await departmentRows(), payload.departmentId);
    if (!employeeId || !validDate(workDate) || !costCode || !reason) throw new Error("Employee, date, department, cost code, and reason are required.");
    if (!selected.active) throw new Error("Select an active department.");
    const [employeeResult, overrideResult] = await Promise.all([
      supabase.from("employees").select("*").eq("id", employeeId).maybeSingle(),
      supabase.from("schedule_overrides").select("*").eq("work_date", workDate).maybeSingle(),
    ]);
    check(employeeResult.error, "find the employee");
    check(overrideResult.error, "check the work schedule");
    const selectedEmployee = employeeResult.data as unknown as EmployeeRow | null;
    const scheduleOverride = overrideResult.data as unknown as OverrideRow | null;
    if (!selectedEmployee?.active) throw new Error("Select an active employee.");
    const workingColor = scheduleOverride?.shift_color ?? baseShiftForDate(workDate);
    if (selectedEmployee.shift_color === workingColor) throw new Error(`${selectedEmployee.name} is already scheduled to work on ${workDate}.`);
    const result = await supabase.from("overtime_entries").insert({ id: crypto.randomUUID(), employee_id: employeeId, work_date: workDate, department_id: selected.id, hours: asHours(payload.hours), cost_code: costCode, reason, notes: textValue(payload.notes, 500), entered_by: session.email });
    check(result.error, "add overtime");
  } else if (action === "update_overtime") {
    requireWrite(session.role);
    const id = textValue(payload.id, 80);
    const selected = selectedDepartment(await departmentRows(), payload.departmentId);
    const costCode = textValue(payload.costCode, 50).toUpperCase();
    const reason = validReason(payload.reason);
    if (!id || !selected.active || !costCode || !reason) throw new Error("Valid overtime details are required.");
    const result = await supabase.from("overtime_entries").update({ department_id: selected.id, hours: asHours(payload.hours), cost_code: costCode, reason, notes: textValue(payload.notes, 500) }).eq("id", id);
    check(result.error, "update overtime");
  } else if (action === "delete_overtime") {
    requireWrite(session.role);
    const result = await supabase.from("overtime_entries").delete().eq("id", textValue(payload.id, 80));
    check(result.error, "delete overtime");
  } else if (action === "add_pto") {
    requireWrite(session.role);
    const employeeId = textValue(payload.employeeId, 80);
    const ptoDate = payload.ptoDate;
    const ptoType = textValue(payload.ptoType, 50);
    if (!employeeId || !validDate(ptoDate) || !ptoType) throw new Error("Employee, date, and PTO type are required.");
    const result = await supabase.from("pto_entries").insert({ id: crypto.randomUUID(), employee_id: employeeId, pto_date: ptoDate, hours: asHours(payload.hours), pto_type: ptoType, notes: textValue(payload.notes, 500), entered_by: session.email });
    check(result.error, "add PTO");
  } else if (action === "import_history") {
    requireAdmin(session.role);
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 5000) : [];
    if (!rows.length) throw new Error("At least one historical row is required.");
    const [employeeResult, overtimeRows, ptoRows, overrideResult, departments] = await Promise.all([
      supabase.from("employees").select("*"),
      allEntryRows("overtime_entries", "work_date"),
      allEntryRows("pto_entries", "pto_date"),
      supabase.from("schedule_overrides").select("*"),
      departmentRows(),
    ]);
    check(employeeResult.error, "load employees for history import");
    check(overrideResult.error, "load schedule corrections for history import");
    const employees = (employeeResult.data ?? []) as unknown as EmployeeRow[];
    const currentOvertime = overtimeRows as OvertimeRow[];
    const currentPto = ptoRows as PtoRow[];
    const overrideRows = (overrideResult.data ?? []) as unknown as OverrideRow[];
    const employeeByName = new Map(employees.map((item) => [item.name.trim().toLowerCase(), item]));
    const overtimeKeys = new Set(currentOvertime.map((item) => `${item.employee_id}|${item.work_date}|${item.department_id}|${item.cost_code.toLowerCase()}`));
    const ptoKeys = new Set(currentPto.map((item) => `${item.employee_id}|${item.pto_date}|${Number(item.hours)}|${item.pto_type.toLowerCase()}`));
    const overrideByDate = new Map(overrideRows.map((item) => [item.work_date, item.shift_color]));
    const pendingOvertime: Array<Record<string, unknown>> = [];
    const pendingPto: Array<Record<string, unknown>> = [];
    for (let index = 0; index < rows.length; index += 1) {
      const source = rows[index] as Record<string, unknown>;
      const type = textValue(source.type, 10).toUpperCase();
      const entryDate = source.date;
      const employeeName = textValue(source.employeeName, 100);
      const selectedEmployee = employeeByName.get(employeeName.toLowerCase());
      const codeOrType = textValue(source.codeOrType, 50);
      if ((type !== "OT" && type !== "PTO") || !validDate(entryDate) || !selectedEmployee || !codeOrType) throw new Error(`History import row ${index + 2} has an invalid type, date, employee name, or code/type.`);
      const common = { id: crypto.randomUUID(), employee_id: selectedEmployee.id, hours: asHours(source.hours), notes: textValue(source.notes, 500), entered_by: session.email };
      if (type === "OT") {
        const workingColor = overrideByDate.get(entryDate) ?? baseShiftForDate(entryDate);
        if (selectedEmployee.shift_color === workingColor) throw new Error(`History import row ${index + 2}: ${selectedEmployee.name} was already scheduled to work on ${entryDate}.`);
        const requestedDepartment = textValue(source.department, 100);
        const selected = selectedDepartment(departments, requestedDepartment ? "" : source.departmentId ?? selectedEmployee.department_id, requestedDepartment);
        const reason = validReason(source.reason, "Historical import");
        const key = `${selectedEmployee.id}|${entryDate}|${selected.id}|${codeOrType.toLowerCase()}`;
        if (!overtimeKeys.has(key)) {
          overtimeKeys.add(key);
          pendingOvertime.push({ ...common, work_date: entryDate, department_id: selected.id, cost_code: codeOrType.toUpperCase(), reason });
        }
      } else {
        const key = `${selectedEmployee.id}|${entryDate}|${common.hours}|${codeOrType.toLowerCase()}`;
        if (!ptoKeys.has(key)) { ptoKeys.add(key); pendingPto.push({ ...common, pto_date: entryDate, pto_type: codeOrType }); }
      }
    }
    for (let index = 0; index < pendingOvertime.length; index += 50) {
      const result = await supabase.from("overtime_entries").insert(pendingOvertime.slice(index, index + 50));
      check(result.error, "import overtime history");
    }
    for (let index = 0; index < pendingPto.length; index += 50) {
      const result = await supabase.from("pto_entries").insert(pendingPto.slice(index, index + 50));
      check(result.error, "import PTO history");
    }
  } else if (action === "delete_pto") {
    requireWrite(session.role);
    const result = await supabase.from("pto_entries").delete().eq("id", textValue(payload.id, 80));
    check(result.error, "delete PTO");
  } else if (action === "set_override") {
    requireAdmin(session.role);
    const workDate = payload.workDate;
    const shiftColor = payload.shiftColor;
    if (!validDate(workDate) || !validColor(shiftColor)) throw new Error("A valid date and shift color are required.");
    const result = await supabase.from("schedule_overrides").upsert({ work_date: workDate, shift_color: shiftColor, reason: textValue(payload.reason, 250), updated_by: session.email, updated_at: new Date().toISOString() }, { onConflict: "work_date" });
    check(result.error, "save the schedule correction");
  } else if (action === "delete_override") {
    requireAdmin(session.role);
    const workDate = payload.workDate;
    if (!validDate(workDate)) throw new Error("A valid date is required.");
    const result = await supabase.from("schedule_overrides").delete().eq("work_date", workDate);
    check(result.error, "delete the schedule correction");
  } else if (action === "add_profile" || action === "update_profile") {
    requireAdmin(session.role);
    const email = textValue(payload.email, 160).toLowerCase();
    const fullName = textValue(payload.fullName, 100);
    const role = payload.role;
    if (!email.includes("@") || !fullName || (role !== "admin" && role !== "supervisor" && role !== "viewer")) throw new Error("Valid name, email, and role are required.");
    const assignment = role === "supervisor" ? selectedDepartment(await departmentRows(), payload.departmentId) : null;
    const shiftColor = role === "supervisor" ? payload.shiftColor : null;
    const shiftPeriod = role === "supervisor" ? payload.shiftPeriod : null;
    if (role === "supervisor" && (!assignment?.active || !validColor(shiftColor) || (shiftPeriod !== "Day" && shiftPeriod !== "Night"))) throw new Error("Supervisors require an active department, shift color, and Day or Night assignment.");
    const values = { email, full_name: fullName, role, active: payload.active !== false, department_id: assignment?.id ?? null, shift_color: shiftColor, shift_period: shiftPeriod };
    if (action === "add_profile") {
      const result = await supabase.from("profiles").insert(values);
      check(result.error, "add approved user access");
    } else {
      const originalEmail = textValue(payload.originalEmail, 160).toLowerCase();
      if (!originalEmail.includes("@")) throw new Error("Select an approved user to update.");
      if (originalEmail === session.email && email !== originalEmail) throw new Error("The signed-in administrator email cannot be changed from its own session. Use another administrator after updating Supabase Authentication.");
      const result = await supabase.from("profiles").update(values).eq("email", originalEmail).select("email").maybeSingle();
      check(result.error, "update approved user access");
      if (!result.data) throw new Error("The selected approved user no longer exists. Refresh and try again.");
    }
  } else if (action === "delete_profile") {
    requireAdmin(session.role);
    const email = textValue(payload.email, 160).toLowerCase();
    if (!email.includes("@")) throw new Error("Select an approved user to delete.");
    if (email === session.email) throw new Error("You cannot delete the administrator account currently signed in.");
    const result = await supabase.from("profiles").delete().eq("email", email).select("email").maybeSingle();
    check(result.error, "delete approved user access");
    if (!result.data) throw new Error("The selected approved user no longer exists. Refresh and try again.");
  } else {
    throw new Error("Unknown tracker action.");
  }

  return loadBundle();
}
