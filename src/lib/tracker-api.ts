import type { SupabaseClient } from "@supabase/supabase-js";
import { baseShiftForDate, type ShiftColor } from "./schedule";
import { supabase } from "./supabase";

export type Role = "admin" | "supervisor" | "viewer";
export type Profile = { email: string; fullName: string; role: Role; active: boolean; createdAt?: string };
export type Employee = {
  id: string;
  name: string;
  shiftColor: ShiftColor;
  shiftPeriod: "Day" | "Night";
  department: string;
  active: boolean;
  createdAt?: string;
};
export type OvertimeEntry = {
  id: string;
  workDate: string;
  employeeId: string;
  hours: number;
  costCode: string;
  notes: string;
  enteredBy: string;
  createdAt: string;
};
export type PtoEntry = {
  id: string;
  ptoDate: string;
  employeeId: string;
  hours: number;
  ptoType: string;
  notes: string;
  enteredBy: string;
  createdAt: string;
};
export type Override = { workDate: string; shiftColor: ShiftColor; reason: string; updatedBy: string; updatedAt?: string };
export type Audit = { id: string; action: string; entityType: string; details: string; userEmail: string; createdAt: string };
export type TrackerBundle = {
  backend: "supabase";
  session: Profile;
  employees: Employee[];
  overtimeEntries: OvertimeEntry[];
  ptoEntries: PtoEntry[];
  scheduleOverrides: Override[];
  profiles: Profile[];
  auditLog: Audit[];
};

type DbError = { message: string } | null;
type ProfileRow = { email: string; full_name: string; role: Role; active: boolean; created_at: string };
type EmployeeRow = { id: string; name: string; shift_color: ShiftColor; shift_period: "Day" | "Night"; department: string; active: boolean; created_at: string };
type OvertimeRow = { id: string; work_date: string; employee_id: string; hours: number | string; cost_code: string; notes: string; entered_by: string; created_at: string };
type PtoRow = { id: string; pto_date: string; employee_id: string; hours: number | string; pto_type: string; notes: string; entered_by: string; created_at: string };
type OverrideRow = { work_date: string; shift_color: ShiftColor; reason: string; updated_by: string; updated_at: string };
type AuditRow = { id: string; action: string; entity_type: string; entity_id: string; details: unknown; user_email: string; created_at: string };

function check(error: DbError, action: string) {
  if (error) throw new Error(`Supabase could not ${action}: ${error.message}`);
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
  return Math.round(hours * 100) / 100;
}

function textValue(value: unknown, max = 250) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function requireWrite(role: Role) {
  if (role !== "admin" && role !== "supervisor") throw new Error("Supervisor access is required.");
}

function requireAdmin(role: Role) {
  if (role !== "admin") throw new Error("Administrator access is required.");
}

function profile(row: ProfileRow): Profile {
  return { email: row.email, fullName: row.full_name, role: row.role, active: row.active, createdAt: row.created_at };
}

function employee(row: EmployeeRow): Employee {
  return { id: row.id, name: row.name, shiftColor: row.shift_color, shiftPeriod: row.shift_period, department: row.department, active: row.active, createdAt: row.created_at };
}

function overtime(row: OvertimeRow): OvertimeEntry {
  return { id: row.id, workDate: row.work_date, employeeId: row.employee_id, hours: Number(row.hours), costCode: row.cost_code, notes: row.notes, enteredBy: row.entered_by, createdAt: row.created_at };
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
  return profile(row);
}

export async function loadBundle(): Promise<TrackerBundle> {
  const session = await currentProfile(supabase);
  const [employeeResult, overtimeResult, ptoResult, overrideResult, profileResult, auditResult] = await Promise.all([
    supabase.from("employees").select("*").order("shift_color").order("shift_period").order("name"),
    supabase.from("overtime_entries").select("*").order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
    supabase.from("pto_entries").select("*").order("pto_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
    supabase.from("schedule_overrides").select("*").order("work_date", { ascending: false }),
    session.role === "admin" ? supabase.from("profiles").select("*").order("full_name") : Promise.resolve({ data: [], error: null }),
    session.role === "admin" ? supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
  ]);
  check(employeeResult.error, "load employees");
  check(overtimeResult.error, "load overtime");
  check(ptoResult.error, "load PTO");
  check(overrideResult.error, "load schedule corrections");
  check(profileResult.error, "load approved users");
  check(auditResult.error, "load audit history");

  return {
    backend: "supabase",
    session,
    employees: ((employeeResult.data ?? []) as unknown as EmployeeRow[]).map(employee),
    overtimeEntries: ((overtimeResult.data ?? []) as unknown as OvertimeRow[]).map(overtime),
    ptoEntries: ((ptoResult.data ?? []) as unknown as PtoRow[]).map(pto),
    scheduleOverrides: ((overrideResult.data ?? []) as unknown as OverrideRow[]).map(override),
    profiles: ((profileResult.data ?? []) as unknown as ProfileRow[]).map(profile),
    auditLog: ((auditResult.data ?? []) as unknown as AuditRow[]).map(audit),
  };
}

export async function mutateTracker(payload: Record<string, unknown>): Promise<TrackerBundle> {
  const action = textValue(payload.action, 50);
  const session = await currentProfile(supabase);

  if (action === "add_employee") {
    requireAdmin(session.role);
    const name = textValue(payload.name, 100);
    const shiftColor = payload.shiftColor;
    const shiftPeriod = payload.shiftPeriod;
    if (!name || !validColor(shiftColor) || (shiftPeriod !== "Day" && shiftPeriod !== "Night")) throw new Error("Name, shift color, and shift period are required.");
    const result = await supabase.from("employees").insert({
      id: crypto.randomUUID(), name, shift_color: shiftColor, shift_period: shiftPeriod,
      department: textValue(payload.department, 100) || "Extrusion", active: true,
    });
    check(result.error, "add the employee");
  } else if (action === "import_employees") {
    requireAdmin(session.role);
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 250) : [];
    if (!rows.length) throw new Error("At least one employee row is required.");
    const currentResult = await supabase.from("employees").select("*");
    check(currentResult.error, "load employees for import");
    const current = (currentResult.data ?? []) as unknown as EmployeeRow[];
    const byName = new Map(current.map((item) => [item.name.trim().toLowerCase(), item]));
    const normalized = new Map<string, { name: string; shift_color: ShiftColor; shift_period: "Day" | "Night"; department: string; active: boolean }>();
    for (let index = 0; index < rows.length; index += 1) {
      const source = rows[index] as Record<string, unknown>;
      const name = textValue(source.name, 100);
      const shiftColor = source.shiftColor;
      const shiftPeriod = source.shiftPeriod;
      if (!name || !validColor(shiftColor) || (shiftPeriod !== "Day" && shiftPeriod !== "Night")) throw new Error(`Employee import row ${index + 2} needs a valid name, shift color, and shift period.`);
      normalized.set(name.toLowerCase(), { name, shift_color: shiftColor, shift_period: shiftPeriod, department: textValue(source.department, 100) || "Extrusion", active: source.active !== false });
    }
    const inserts: Array<Record<string, unknown>> = [];
    for (const [nameKey, values] of normalized) {
      const existing = byName.get(nameKey);
      if (existing) {
        const result = await supabase.from("employees").update(values).eq("id", existing.id);
        check(result.error, "update an imported employee");
      } else inserts.push({ id: crypto.randomUUID(), ...values });
    }
    if (inserts.length) {
      const result = await supabase.from("employees").insert(inserts);
      check(result.error, "import new employees");
    }
  } else if (action === "update_employee") {
    requireAdmin(session.role);
    const id = textValue(payload.id, 80);
    const name = textValue(payload.name, 100);
    const shiftColor = payload.shiftColor;
    const shiftPeriod = payload.shiftPeriod;
    if (!id || !name || !validColor(shiftColor) || (shiftPeriod !== "Day" && shiftPeriod !== "Night")) throw new Error("Valid employee information is required.");
    const result = await supabase.from("employees").update({ name, shift_color: shiftColor, shift_period: shiftPeriod, department: textValue(payload.department, 100) || "Extrusion", active: Boolean(payload.active) }).eq("id", id);
    check(result.error, "update the employee");
  } else if (action === "add_overtime") {
    requireWrite(session.role);
    const employeeId = textValue(payload.employeeId, 80);
    const workDate = payload.workDate;
    const costCode = textValue(payload.costCode, 50);
    if (!employeeId || !validDate(workDate) || !costCode) throw new Error("Employee, date, and cost code are required.");
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
    const result = await supabase.from("overtime_entries").insert({ id: crypto.randomUUID(), employee_id: employeeId, work_date: workDate, hours: asHours(payload.hours), cost_code: costCode, notes: textValue(payload.notes, 500), entered_by: session.email });
    check(result.error, "add overtime");
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
    const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 2500) : [];
    if (!rows.length) throw new Error("At least one historical row is required.");
    const [employeeResult, overtimeResult, ptoResult, overrideResult] = await Promise.all([
      supabase.from("employees").select("*"), supabase.from("overtime_entries").select("*"),
      supabase.from("pto_entries").select("*"), supabase.from("schedule_overrides").select("*"),
    ]);
    check(employeeResult.error, "load employees for history import");
    check(overtimeResult.error, "load overtime for history import");
    check(ptoResult.error, "load PTO for history import");
    check(overrideResult.error, "load schedule corrections for history import");
    const employees = (employeeResult.data ?? []) as unknown as EmployeeRow[];
    const overtimeRows = (overtimeResult.data ?? []) as unknown as OvertimeRow[];
    const ptoRows = (ptoResult.data ?? []) as unknown as PtoRow[];
    const overrideRows = (overrideResult.data ?? []) as unknown as OverrideRow[];
    const employeeByName = new Map(employees.map((item) => [item.name.trim().toLowerCase(), item]));
    const overtimeKeys = new Set(overtimeRows.map((item) => `${item.employee_id}|${item.work_date}|${Number(item.hours)}|${item.cost_code.toLowerCase()}`));
    const ptoKeys = new Set(ptoRows.map((item) => `${item.employee_id}|${item.pto_date}|${Number(item.hours)}|${item.pto_type.toLowerCase()}`));
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
        const key = `${selectedEmployee.id}|${entryDate}|${common.hours}|${codeOrType.toLowerCase()}`;
        if (!overtimeKeys.has(key)) { overtimeKeys.add(key); pendingOvertime.push({ ...common, work_date: entryDate, cost_code: codeOrType }); }
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
  } else if (action === "upsert_profile") {
    requireAdmin(session.role);
    const email = textValue(payload.email, 160).toLowerCase();
    const fullName = textValue(payload.fullName, 100);
    const role = payload.role;
    if (!email.includes("@") || !fullName || (role !== "admin" && role !== "supervisor" && role !== "viewer")) throw new Error("Valid name, email, and role are required.");
    const result = await supabase.from("profiles").upsert({ email, full_name: fullName, role, active: payload.active !== false }, { onConflict: "email" });
    check(result.error, "save approved user access");
  } else {
    throw new Error("Unknown tracker action.");
  }

  return loadBundle();
}
