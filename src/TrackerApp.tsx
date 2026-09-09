import { useEffect, useMemo, useState } from "react";
import CrewPlacement from "./CrewPlacement";
import { crewPositionAtEndOfDay } from "./lib/day-snapshot";
import { loadDemoBundle, mutateDemoTracker, resetDemoBundle } from "./lib/demo-store";
import { employeeScheduledHours, scheduleHoursForDate, scheduleLabel, scheduledDatesInRange, shiftForDate, toDateInput, type ShiftColor } from "./lib/schedule";
import {
  loadBundle,
  mutateTracker,
  DEFAULT_DASHBOARD_WIDGETS,
  OT_REASONS,
  type Department,
  type DashboardWidget,
  type DashboardWidgetId,
  type DashboardWidgetSize,
  type Employee,
  type CrewPosition,
  type CrewSystem,
  type OvertimeEntry,
  type Override,
  type Profile,
  type PtoEntry,
  type TrackerBundle,
  type WorkSchedule,
  type WorkScheduleOverride,
} from "./lib/tracker-api";

type Tab = "dashboard" | "overtime" | "pto" | "employees" | "crew" | "calendar" | "reports" | "settings" | "companySetup" | "admin";
type ColorMode = "light" | "dark" | "system";
type ImportKind = "employees" | "history";
type OvertimeEditor = { employee: Employee; entry?: OvertimeEntry };
type PtoEditor = { employee: Employee; entry?: PtoEntry };

const DASHBOARD_WIDGET_CATALOG: Array<{ id: DashboardWidgetId; label: string; description: string; category: string; defaultSize: DashboardWidgetSize }> = [
  { id: "weekly_summary", label: "Weekly operations snapshot", description: "Blue/Yellow rotation, scheduled staffing, overtime, and PTO for Monday through Sunday.", category: "Schedule", defaultSize: "wide" },
  { id: "shift_today", label: "Blue/Yellow shift", description: "The overall Blue/Yellow crew working on the selected date, with other scheduled staff kept separate.", category: "Schedule", defaultSize: "wide" },
  { id: "kpi_ot", label: "Monthly overtime", description: "Total overtime hours and entries for the selected month.", category: "Key metrics", defaultSize: "compact" },
  { id: "kpi_pto", label: "Monthly PTO", description: "Total PTO hours and entries for the selected month.", category: "Key metrics", defaultSize: "compact" },
  { id: "kpi_employees", label: "Active employees", description: "Active employee and department counts.", category: "Key metrics", defaultSize: "compact" },
  { id: "kpi_ot_people", label: "Employees with OT", description: "Unique employees receiving overtime this month.", category: "Key metrics", defaultSize: "compact" },
  { id: "ot_trend", label: "Six-month OT trend", description: "Monthly overtime trend across the last six months.", category: "Charts", defaultSize: "wide" },
  { id: "department_ot", label: "OT by department", description: "Overtime distribution across departments this month.", category: "Charts", defaultSize: "standard" },
  { id: "shift_ot", label: "OT by schedule", description: "Monthly overtime split by work group and schedule.", category: "Charts", defaultSize: "standard" },
  { id: "reason_ot", label: "OT by reason", description: "Why overtime was assigned during the month.", category: "Charts", defaultSize: "standard" },
  { id: "cost_code_ot", label: "OT by cost code", description: "Monthly hours summarized by cost code.", category: "Charts", defaultSize: "standard" },
  { id: "pto_type", label: "PTO by type", description: "Monthly PTO hours summarized by PTO type.", category: "Charts", defaultSize: "standard" },
  { id: "staffing_department", label: "Staffing by department", description: "Active headcount across company departments.", category: "Workforce", defaultSize: "standard" },
  { id: "staffing_crew", label: "Staffing by schedule", description: "Active headcount across 12-hour and weekday schedules.", category: "Workforce", defaultSize: "standard" },
  { id: "placement_coverage", label: "Crew placement coverage", description: "Required line positions filled across the crews you can view.", category: "Crew placement", defaultSize: "compact" },
  { id: "placement_gaps", label: "Open crew positions", description: "Required placement gaps summarized by department and crew.", category: "Crew placement", defaultSize: "standard" },
  { id: "schedule", label: "Next 14 days", description: "The overall Blue/Yellow rotation with total scheduled staffing.", category: "Schedule", defaultSize: "wide" },
  { id: "selected_ot", label: "OT on selected date", description: "Employee-level overtime details for the selected date.", category: "Daily details", defaultSize: "standard" },
  { id: "selected_pto", label: "PTO on selected date", description: "Employee-level PTO details for the selected date.", category: "Daily details", defaultSize: "standard" },
];

const NAV: Array<{ id: Tab; code: string; label: string }> = [
  { id: "dashboard", code: "DB", label: "Dashboard" },
  { id: "overtime", code: "OT", label: "Overtime Entry" },
  { id: "pto", code: "PT", label: "PTO Tracking" },
  { id: "employees", code: "EM", label: "Employees" },
  { id: "crew", code: "CP", label: "Crew Placement" },
  { id: "calendar", code: "SC", label: "Shift Calendar" },
  { id: "reports", code: "RP", label: "Reports" },
  { id: "settings", code: "ST", label: "Settings" },
  { id: "companySetup", code: "CS", label: "Company Setup" },
  { id: "admin", code: "AD", label: "Admin" },
];

function dateFromInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function prettyDate(value: string, short = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Choose a date";
  return new Intl.DateTimeFormat("en-US", {
    weekday: short ? undefined : "short",
    month: "short",
    day: "numeric",
    year: short ? undefined : "numeric",
  }).format(dateFromInput(value));
}

function timestampDate(value: string) {
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

function addDays(value: string, amount: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = dateFromInput(value);
  date.setDate(date.getDate() + amount);
  return toDateInput(date);
}

function weekDates(value: string) {
  const date = dateFromInput(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  const monday = addDays(value, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function currentMonthRange(dateValue: string) {
  const date = dateFromInput(dateValue);
  return {
    start: toDateInput(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: toDateInput(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}

function monthKeys(dateValue: string, count = 6) {
  const date = dateFromInput(dateValue);
  return Array.from({ length: count }, (_, index) => {
    const month = new Date(date.getFullYear(), date.getMonth() - (count - index - 1), 1);
    return {
      key: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
      label: month.toLocaleDateString("en-US", { month: "short" }),
    };
  });
}

function totalsBy<T>(items: T[], key: (item: T) => string, value: (item: T) => number) {
  return Array.from(items.reduce((totals, item) => {
    const group = key(item) || "Unassigned";
    totals.set(group, (totals.get(group) ?? 0) + value(item));
    return totals;
  }, new Map<string, number>())).sort((a, b) => b[1] - a[1]);
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
}

function ShiftBadge({ color, compact = false }: { color: ShiftColor; compact?: boolean }) {
  return <span className={`shift-badge ${color.toLowerCase()} ${compact ? "compact" : ""}`}><i />{color}</span>;
}

function ScheduleBadge({ employee, compact = false }: { employee: Employee; compact?: boolean }) {
  return <span className={`schedule-badge ${compact ? "compact" : ""}`}>{employee.scheduleName || (employee.shiftColor && employee.shiftPeriod ? `${employee.shiftColor} ${employee.shiftPeriod}` : "Unassigned")}</span>;
}

function scheduledHours(data: TrackerBundle, employee: Employee, date: string) {
  return employeeScheduledHours(employee, date, data.workSchedules, data.workScheduleOverrides, data.scheduleOverrides);
}

function overallShiftColorForEmployee(data: TrackerBundle, employee: Employee) {
  return data.workSchedules.find((schedule) => schedule.id === employee.scheduleId)?.legacyShiftColor ?? employee.shiftColor;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><div className="empty-mark">+</div><strong>{title}</strong><span>{body}</span></div>;
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </section>
    </div>
  );
}

export default function TrackerApp({ onSignOut, dataMode = "live" }: { onSignOut: () => Promise<unknown>; dataMode?: "live" | "demo" }) {
  const [data, setData] = useState<TrackerBundle | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => toDateInput(new Date()));
  const [overtimeEditor, setOvertimeEditor] = useState<OvertimeEditor | null>(null);
  const [ptoEditor, setPtoEditor] = useState<PtoEditor | null>(null);
  const [overrideDate, setOverrideDate] = useState<string | null>(null);
  const [scheduleAdjustmentDate, setScheduleAdjustmentDate] = useState<string | null>(null);
  const [calendarDetailDate, setCalendarDetailDate] = useState<string | null>(null);
  const [calendarWorkedDate, setCalendarWorkedDate] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<WorkSchedule | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);
  const [customizingDashboard, setCustomizingDashboard] = useState(false);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterDepartment, setRosterDepartment] = useState("all");
  const [rosterSchedule, setRosterSchedule] = useState("all");
  const [rosterLimit, setRosterLimit] = useState(10);
  const [assignmentDefaultsApplied, setAssignmentDefaultsApplied] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeDepartment, setEmployeeDepartment] = useState("all");
  const [employeeSchedule, setEmployeeSchedule] = useState("all");
  const [employeeStatus, setEmployeeStatus] = useState<"all" | "active" | "inactive">("active");
  const [employeeLimit, setEmployeeLimit] = useState(10);
  const [reportStart, setReportStart] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [reportEnd, setReportEnd] = useState(() => `${new Date().getFullYear()}-12-31`);
  const [reportEmployee, setReportEmployee] = useState("all");
  const [reportDepartment, setReportDepartment] = useState("all");
  const [reportShift, setReportShift] = useState("all");
  const [reportCostCode, setReportCostCode] = useState("all");
  const [reportReason, setReportReason] = useState("all");
  const [colorMode, setColorMode] = useState<ColorMode>(() => (localStorage.getItem("operations-hours-color-mode") as ColorMode) || "system");
  const resolvedColorMode = colorMode === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : colorMode;
  const isDemo = dataMode === "demo";
  const loadData = isDemo ? loadDemoBundle : loadBundle;
  const mutateData = isDemo ? mutateDemoTracker : mutateTracker;

  useEffect(() => { localStorage.setItem("operations-hours-color-mode", colorMode); }, [colorMode]);

  async function load() {
    try {
      setError("");
      setData(await loadData());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load tracker data.");
    }
  }

  useEffect(() => {
    let active = true;
    void loadData()
      .then((body) => { if (active) setData(body); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load tracker data.");
      });
    return () => { active = false; };
  }, [dataMode]);

  useEffect(() => {
    if (!assignmentDefaultsApplied && data?.session.role === "supervisor") {
      if (data.session.departmentId) setRosterDepartment(data.session.departmentId);
      if (data.session.scheduleId) setRosterSchedule(data.session.scheduleId);
      setAssignmentDefaultsApplied(true);
    }
  }, [assignmentDefaultsApplied, data]);

  async function mutate(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await mutateData(payload));
      setNotice(success);
      window.setTimeout(() => setNotice(""), 3500);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const employeesById = useMemo(() => new Map(data?.employees.map((employee) => [employee.id, employee])), [data]);
  const activeEmployees = data?.employees.filter((employee) => employee.active) ?? [];
  const workingColor = data ? shiftForDate(selectedDate, data.scheduleOverrides) : "Blue";
  const canWrite = data?.session.role === "admin" || data?.session.role === "supervisor";
  const isAdmin = data?.session.role === "admin";
  const visibleNav = NAV.filter((item) => (item.id !== "admin" && item.id !== "companySetup") || isAdmin);

  async function resetDemo() {
    if (!isDemo || !window.confirm("Reset every local demo change and restore the original fake sample data?")) return;
    setBusy(true);
    setError("");
    try {
      setData(await resetDemoBundle());
      setNotice("Demo data restored to the original sample.");
      setTab("dashboard");
    } finally {
      setBusy(false);
    }
  }

  async function previewDemoRole(role: Profile["role"]) {
    if (!isDemo) return;
    setBusy(true);
    setError("");
    try {
      setData(await mutateDemoTracker({ action: "set_demo_role", role }));
      setTab("dashboard");
      setNotice(`Demo is now showing the ${role} experience.`);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "The demo role could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <main className="loading-shell">
        <div className="loading-card">
          <div className="brand-box">OT</div><h1>Operations Hours Tracker</h1><span className="loader" />
          <p>{error || "Opening the secure tracker…"}</p>
          {error && <div className="button-row"><button className="secondary-button" onClick={() => void onSignOut()}>Sign out</button><button className="primary-button" onClick={() => void load()}>Try again</button></div>}
        </div>
      </main>
    );
  }

  const activeDepartments = data.departments.filter((department) => department.active);
  const monthRange = currentMonthRange(selectedDate);
  const monthOt = data.overtimeEntries.filter((entry) => entry.workDate >= monthRange.start && entry.workDate <= monthRange.end);
  const monthPto = data.ptoEntries.filter((entry) => entry.ptoDate >= monthRange.start && entry.ptoDate <= monthRange.end);
  const selectedOt = data.overtimeEntries.filter((entry) => entry.workDate === selectedDate);
  const selectedPto = data.ptoEntries.filter((entry) => entry.ptoDate === selectedDate);
  const rosterEmployees = activeEmployees.filter((employee) => {
    const matchesDepartment = rosterDepartment === "all" || employee.departmentId === rosterDepartment;
    const matchesSchedule = rosterSchedule === "all" || employee.scheduleId === rosterSchedule;
    const query = rosterSearch.trim().toLowerCase();
    return matchesDepartment && matchesSchedule && (!query || employee.name.toLowerCase().includes(query));
  });
  const displayedRosterEmployees = rosterEmployees.slice(0, rosterLimit);
  const filteredEmployees = data.employees.filter((employee) => {
    const query = employeeSearch.trim().toLowerCase();
    const matchesSearch = !query || employee.name.toLowerCase().includes(query);
    const matchesDepartment = employeeDepartment === "all" || employee.departmentId === employeeDepartment;
    const matchesSchedule = employeeSchedule === "all" || employee.scheduleId === employeeSchedule;
    const matchesStatus = employeeStatus === "all" || (employeeStatus === "active" ? employee.active : !employee.active);
    return matchesSearch && matchesDepartment && matchesSchedule && matchesStatus;
  });
  const displayedEmployees = filteredEmployees.slice(0, employeeLimit);
  const costCodes = Array.from(new Set(data.overtimeEntries.map((entry) => entry.costCode))).sort();
  const reasons = Array.from(new Set(data.overtimeEntries.map((entry) => entry.reason))).sort();
  const reportSchedules = Array.from(new Set([
    ...data.workSchedules.map(scheduleLabel),
    ...data.overtimeEntries.map((entry) => entry.shiftName),
    ...data.ptoEntries.map((entry) => entry.scheduleName).filter(Boolean),
  ])).sort();
  const filteredOt = data.overtimeEntries.filter((entry) => {
    if (entry.workDate < reportStart || entry.workDate > reportEnd) return false;
    if (reportEmployee !== "all" && entry.employeeId !== reportEmployee) return false;
    if (reportDepartment !== "all" && entry.departmentId !== reportDepartment) return false;
    if (reportShift !== "all" && entry.shiftName !== reportShift) return false;
    if (reportCostCode !== "all" && entry.costCode !== reportCostCode) return false;
    if (reportReason !== "all" && entry.reason !== reportReason) return false;
    return true;
  });
  const filteredPto = data.ptoEntries.filter((entry) => {
    if (entry.ptoDate < reportStart || entry.ptoDate > reportEnd) return false;
    const employee = employeesById.get(entry.employeeId);
    if (reportEmployee !== "all" && entry.employeeId !== reportEmployee) return false;
    if (reportDepartment !== "all" && employee?.departmentId !== reportDepartment) return false;
    if (reportShift !== "all" && (entry.scheduleName || employee?.scheduleName) !== reportShift) return false;
    return true;
  });
  function downloadReport() {
    const rows = [
      ["type", "date", "employee_name", "hours", "department", "cost_code_or_pto_type", "reason", "notes", "shift", "entered_by"],
      ...filteredOt.map((entry) => ["OT", entry.workDate, entry.employeeName, entry.hours, entry.departmentName, entry.costCode, entry.reason, entry.notes, entry.shiftName, entry.enteredBy]),
      ...filteredPto.map((entry) => {
        const employee = employeesById.get(entry.employeeId);
        return ["PTO", entry.ptoDate, employee?.name || "Unknown", entry.hours, employee?.department || "", entry.ptoType, "", entry.notes, entry.scheduleName || employee?.scheduleName || "", entry.enteredBy];
      }),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tracker-history-${reportStart}-to-${reportEnd}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const firstEmployeeSchedule = data.workSchedules.find((schedule) => schedule.active && schedule.departmentId === activeDepartments[0]?.id);
  const emptyEmployee: Employee = {
    id: "",
    name: "",
    shiftColor: "Blue",
    shiftPeriod: "Day",
    scheduleId: firstEmployeeSchedule?.id,
    scheduleName: firstEmployeeSchedule ? scheduleLabel(firstEmployeeSchedule) : "Schedule not assigned",
    departmentId: activeDepartments[0]?.id ?? "",
    department: activeDepartments[0]?.name ?? "",
    active: true,
  };

  return (
    <div className={`app-shell theme-${resolvedColorMode}`}>
      <header className="topbar">
        <div className="brand"><div className="brand-box">OT</div><div><strong>Overtime & PTO</strong><span>{isDemo ? "Interactive sample workspace · saved locally" : "Company operations tracker · Supabase"}</span></div></div>
        <div className="account"><span className="status-dot" /><div><strong>{data.session.fullName}</strong><span>{data.session.role}{data.session.role === "supervisor" ? ` · ${data.departments.find((department) => department.id === data.session.departmentId)?.name ?? "Unassigned"} · ${data.workSchedules.find((schedule) => schedule.id === data.session.scheduleId) ? scheduleLabel(data.workSchedules.find((schedule) => schedule.id === data.session.scheduleId)!) : `${data.session.shiftColor ?? "Unassigned"} ${data.session.shiftPeriod ?? ""}`.trimEnd()}` : ""}</span></div><button className="signout-button" onClick={() => void onSignOut()}>{isDemo ? "Exit demo" : "Sign out"}</button></div>
      </header>

      <nav className="main-nav" aria-label="Tracker pages">
        {visibleNav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><span>{item.code}</span>{item.label}</button>)}
      </nav>

      <main className="content">
        {isDemo && <section className="demo-mode-banner"><div><span className="demo-mode-mark">D</span><div><strong>Interactive demo mode</strong><small>Everything here is fake. Changes are saved only in this browser and are never sent to the live company database.</small></div></div><div className="demo-mode-actions"><label><span>Preview as</span><select value={data.session.role} disabled={busy} onChange={(event) => void previewDemoRole(event.target.value as Profile["role"])}><option value="admin">Administrator</option><option value="supervisor">Supervisor</option><option value="viewer">Viewer</option></select></label><button className="secondary-button" disabled={busy} onClick={() => void resetDemo()}>Reset demo data</button></div></section>}
        {(error || notice) && <div className={`alert ${error ? "error" : "success"}`}><span>{error ? "!" : "✓"}</span>{error || notice}<button onClick={() => { setError(""); setNotice(""); }}>×</button></div>}

        {tab === "dashboard" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Your operations workspace</p><h1>Dashboard</h1><span>{prettyDate(selectedDate)} · {data.dashboardPersistenceReady ? isDemo ? `Saved locally for ${data.session.fullName}` : `Saved personally for ${data.session.fullName}` : "Using the company default layout"}</span></div><div className="dashboard-heading-actions"><label className="date-control"><span>View date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label><button className="secondary-button" disabled={!data.dashboardPersistenceReady} title={data.dashboardPersistenceReady ? undefined : "Personal dashboard storage is still being configured."} onClick={() => setCustomizingDashboard(true)}>{data.dashboardPersistenceReady ? "Customize dashboard" : "Default dashboard active"}</button></div></div>
            {!activeEmployees.length && <section className="setup-banner"><div><span className="setup-number">1</span><div><strong>Your tracker is clean and ready</strong><span>Confirm departments, then add employees individually or import the complete roster.</span></div></div><div className="button-row">{isAdmin && <button className="secondary-button" onClick={() => setTab("companySetup")}>Review departments</button>}<button className="primary-button" onClick={() => setTab("employees")}>Add employees</button></div></section>}
            {data.dashboardWidgets.length ? <section className="dashboard-widget-grid">{data.dashboardWidgets.map((widget) => <DashboardWidgetView key={widget.id} widget={widget} data={data} selectedDate={selectedDate} workingColor={workingColor} activeEmployees={activeEmployees} activeDepartments={activeDepartments} monthOt={monthOt} monthPto={monthPto} selectedOt={selectedOt} selectedPto={selectedPto} employeesById={employeesById} onNavigate={setTab} />)}</section> : <section className="panel dashboard-empty"><EmptyState title="Your dashboard is empty" body="Choose Customize dashboard to add the metrics, charts, and daily details you want to see." /><button className="primary-button" onClick={() => setCustomizingDashboard(true)}>Add dashboard widgets</button></section>}
          </>
        )}

        {tab === "overtime" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company-wide supervisor entry</p><h1>Overtime Entry</h1><span>Choose the employee, working department, cost code, reason, and hours.</span></div><label className="date-control"><span>Overtime date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
            <WeekOverview dates={weekDates(selectedDate)} selectedDate={selectedDate} setSelectedDate={setSelectedDate} entries={data.overtimeEntries} data={data} />
            <div className="schedule-banner"><div><strong>{activeEmployees.filter((employee) => scheduledHours(data, employee, selectedDate) > 0).length} employees scheduled for {prettyDate(selectedDate)}</strong></div><span>Anyone scheduled for regular hours shows “Working” and cannot be entered as overtime.</span></div>
            <RosterFilters departments={activeDepartments} schedules={data.workSchedules} department={rosterDepartment} setDepartment={setRosterDepartment} schedule={rosterSchedule} setSchedule={setRosterSchedule} search={rosterSearch} setSearch={setRosterSearch} />
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">Available roster</p><h2>Select an employee</h2></div><RosterLimitControl total={rosterEmployees.length} value={rosterLimit} onChange={setRosterLimit} detail={`${rosterEmployees.filter((employee) => scheduledHours(data, employee, selectedDate) <= 0).length} available`} /></div>
              {rosterEmployees.length ? <><div className="roster-grid">{displayedRosterEmployees.map((employee) => { const plannedHours = scheduledHours(data, employee, selectedDate); return <article className={`employee-card ${plannedHours > 0 ? "scheduled" : ""}`} key={employee.id}><div className="employee-main"><span className="avatar large">{initials(employee.name)}</span><div><strong>{employee.name}</strong><span>{employee.department}</span><ScheduleBadge employee={employee} compact /></div></div>{plannedHours > 0 ? <span className="working-pill">Working · {plannedHours.toFixed(1)} hrs</span> : <button className="add-button" disabled={!canWrite} onClick={() => setOvertimeEditor({ employee })} aria-label={`Add overtime for ${employee.name}`}>+</button>}</article>; })}</div></> : <EmptyState title="No employees match" body="Clear the search or choose another department." />}
            </section>
            <EntryTable title={`Entries for ${prettyDate(selectedDate)}`} entries={selectedOt.map((entry) => ({ id: entry.id, name: entry.employeeName, detail: `${entry.departmentName} · ${entry.costCode}`, subdetail: entry.reason, hours: entry.hours, notes: entry.notes }))} canChange={Boolean(canWrite)} onEdit={(id) => { const entry = selectedOt.find((item) => item.id === id); const employee = entry && employeesById.get(entry.employeeId); if (entry && employee) setOvertimeEditor({ employee, entry }); }} onDelete={(id) => void mutate({ action: "delete_overtime", id }, "Overtime entry removed.")} />
          </>
        )}

        {tab === "pto" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company time-off log</p><h1>PTO Tracking</h1><span>Record vacation, sick, personal, or other approved time.</span></div><label className="date-control"><span>PTO date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
            <RosterFilters departments={activeDepartments} schedules={data.workSchedules} department={rosterDepartment} setDepartment={setRosterDepartment} schedule={rosterSchedule} setSchedule={setRosterSchedule} search={rosterSearch} setSearch={setRosterSearch} />
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">Employee roster</p><h2>Select an employee</h2></div><RosterLimitControl total={rosterEmployees.length} value={rosterLimit} onChange={setRosterLimit} /></div>{rosterEmployees.length ? <><div className="roster-grid">{displayedRosterEmployees.map((employee) => <article className="employee-card" key={employee.id}><div className="employee-main"><span className="avatar large">{initials(employee.name)}</span><div><strong>{employee.name}</strong><span>{employee.department}</span><ScheduleBadge employee={employee} compact /></div></div><button className="add-button" disabled={!canWrite} onClick={() => setPtoEditor({ employee })} aria-label={`Add PTO for ${employee.name}`}>+</button></article>)}</div></> : <EmptyState title="No employees match" body="Clear the search or choose another department." />}</section>
            <EntryTable title={`PTO for ${prettyDate(selectedDate)}`} entries={selectedPto.map((entry) => ({ id: entry.id, name: employeesById.get(entry.employeeId)?.name || "Unknown", detail: employeesById.get(entry.employeeId)?.department || "No department", subdetail: entry.ptoType, hours: entry.hours, notes: entry.notes }))} canChange={Boolean(canWrite)} onEdit={(id) => { const entry = selectedPto.find((item) => item.id === id); const employee = entry && employeesById.get(entry.employeeId); if (entry && employee) setPtoEditor({ employee, entry }); }} onDelete={(id) => void mutate({ action: "delete_pto", id }, "PTO entry removed.")} />
          </>
        )}

        {tab === "employees" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company roster</p><h1>Employees</h1><span>Assign every employee to a department and its actual work-group schedule.</span></div>{isAdmin && <div className="heading-actions"><button className="secondary-button" onClick={() => setImportKind("employees")}>Import CSV</button><button className="primary-button" disabled={!activeDepartments.length || (data.scheduleStorageReady && !data.workSchedules.some((schedule) => schedule.active))} onClick={() => setEditingEmployee(emptyEmployee)}>+ Add employee</button></div>}</div>
            {!activeDepartments.length && <div className="alert error"><span>!</span>Add an active department in Company Setup before adding employees.</div>}
            <section className="filter-bar employee-filters">
              <label className="search-field"><span>Find employee</span><input type="search" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Search by name" /></label>
              <label><span>Department</span><select value={employeeDepartment} onChange={(event) => setEmployeeDepartment(event.target.value)}><option value="all">All departments</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
              <label><span>Work schedule</span><select value={employeeSchedule} onChange={(event) => setEmployeeSchedule(event.target.value)}><option value="all">All schedules</option>{data.workSchedules.filter((schedule) => employeeDepartment === "all" || schedule.departmentId === employeeDepartment).map((schedule) => <option key={schedule.id} value={schedule.id}>{scheduleLabel(schedule)}</option>)}</select></label>
              <label><span>Status</span><select value={employeeStatus} onChange={(event) => setEmployeeStatus(event.target.value as "all" | "active" | "inactive")}><option value="active">Active only</option><option value="inactive">Inactive only</option><option value="all">All statuses</option></select></label>
            </section>
            <section className="panel table-panel"><div className="panel-head padded"><div><p className="eyebrow">Directory results</p><h2>Employee list</h2></div><RosterLimitControl total={filteredEmployees.length} value={employeeLimit} onChange={setEmployeeLimit} detail={`${data.employees.length} total`} /></div>{data.employees.length ? filteredEmployees.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Work group / schedule</th><th>Status</th>{isAdmin && <th />}</tr></thead><tbody>{displayedEmployees.map((employee) => <tr key={employee.id} className={!employee.active ? "inactive-row" : ""}><td><div className="person-cell"><span className="avatar">{initials(employee.name)}</span><strong>{employee.name}</strong></div></td><td>{employee.department}</td><td><ScheduleBadge employee={employee} compact /></td><td><span className={`status-pill ${employee.active ? "active" : "inactive"}`}>{employee.active ? "Active" : "Inactive"}</span></td>{isAdmin && <td><button className="text-button" onClick={() => setEditingEmployee(employee)}>Edit</button></td>}</tr>)}</tbody></table></div> : <EmptyState title="No employees match" body="Clear or change the directory filters to see more employees." /> : <EmptyState title="No employees added" body="Use Add employee or Import CSV to build the company roster." />}</section>
          </>
        )}

        {tab === "crew" && <CrewPlacement data={data} busy={busy} onMutate={mutate} />}

        {tab === "calendar" && <CalendarView monthValue={calendarMonth} setMonthValue={setCalendarMonth} data={data} onSelect={(date) => { setSelectedDate(date); setCalendarDetailDate(date); }} />}

        {tab === "reports" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company hours and history</p><h1>Reports</h1><span>Filter by employee, department, work schedule, cost code, or overtime reason.</span></div><div className="heading-actions">{isAdmin && <button className="secondary-button" onClick={() => setImportKind("history")}>Import history</button>}<button className="primary-button" onClick={downloadReport}>Download CSV</button></div></div>
            <section className="filter-bar report-filters">
              <label><span>From</span><input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} /></label>
              <label><span>Through</span><input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} /></label>
              <label><span>Employee</span><select value={reportEmployee} onChange={(event) => setReportEmployee(event.target.value)}><option value="all">All employees</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
              <label><span>Department</span><select value={reportDepartment} onChange={(event) => setReportDepartment(event.target.value)}><option value="all">All departments</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
              <label><span>Schedule</span><select value={reportShift} onChange={(event) => setReportShift(event.target.value)}><option value="all">All schedules</option>{reportSchedules.map((shift) => <option key={shift}>{shift}</option>)}</select></label>
              <label><span>Cost code</span><select value={reportCostCode} onChange={(event) => setReportCostCode(event.target.value)}><option value="all">All cost codes</option>{costCodes.map((code) => <option key={code}>{code}</option>)}</select></label>
              <label><span>OT reason</span><select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="all">All reasons</option>{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
              <div><span>Included</span><strong>{filteredOt.length} OT · {filteredPto.length} PTO</strong></div>
            </section>
            <div className="report-layout">
              <aside className="report-section-nav" aria-label="Report sections">
                <p className="eyebrow">Jump to</p>
                <a href="#report-summary"><span>01</span><div><strong>Employee summary</strong><small>{new Set([...filteredOt.map((entry) => entry.employeeId), ...filteredPto.map((entry) => entry.employeeId)]).size} employees</small></div></a>
                <a href="#report-overtime"><span>02</span><div><strong>Overtime records</strong><small>{filteredOt.length} entries</small></div></a>
                <a href="#report-pto"><span>03</span><div><strong>PTO records</strong><small>{filteredPto.length} entries</small></div></a>
              </aside>
              <div className="report-sections">
                <div id="report-summary"><ReportTable overtime={filteredOt} pto={filteredPto} employeesById={employeesById} /></div>
                <div id="report-overtime"><OvertimeDetailTable entries={filteredOt} /></div>
                <div id="report-pto"><PtoDetailTable entries={filteredPto} employeesById={employeesById} /></div>
              </div>
            </div>
          </>
        )}

        {tab === "settings" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Your workspace</p><h1>Settings</h1><span>Personalize how the tracker looks and behaves for you.</span></div></div>
            <section className="settings-grid">
              <div className="panel settings-panel"><div className="panel-head"><div><p className="eyebrow">Appearance</p><h2>Color mode</h2></div></div><div className="settings-panel-body"><p>Choose the appearance that is easiest on your eyes. This setting is saved on this device.</p><div className="appearance-options" role="radiogroup" aria-label="Color mode">{(["light", "dark", "system"] as ColorMode[]).map((mode) => <button key={mode} type="button" className={colorMode === mode ? "selected" : ""} onClick={() => setColorMode(mode)} role="radio" aria-checked={colorMode === mode}><span className={`appearance-preview ${mode}`}><i /></span><strong>{mode === "system" ? "Use device setting" : `${mode[0].toUpperCase()}${mode.slice(1)} mode`}</strong><small>{mode === "system" ? "Follows your computer or phone" : mode === "dark" ? "Lower-light workspace" : "Bright, clean workspace"}</small></button>)}</div></div></div>
              <div className="panel settings-panel"><div className="panel-head"><div><p className="eyebrow">Dashboard</p><h2>Dashboard preferences</h2></div></div><div className="settings-panel-body"><p>Your dashboard already has its own Customize dashboard button. It is where you choose the cards and charts you want to see and save the layout {isDemo ? "in this browser" : "to your account"}.</p><div className="settings-note"><span>✓</span><div><strong>{isDemo ? "Local demo dashboard is active" : "Default dashboard is active"}</strong><small>Use the button at the top of Dashboard to personalize your view{isDemo ? "; it remains available on this device until you reset the demo" : " whenever dashboard storage is ready"}.</small></div></div></div></div>
            </section>
          </>
        )}

        {tab === "companySetup" && isAdmin && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company configuration</p><h1>Departments, Schedules & Cost Codes</h1><span>Admins control each department’s work groups, actual shifts, and overtime defaults here.</span></div><button className="primary-button" onClick={() => setEditingDepartment({ id: "", name: "", defaultCostCode: "", active: true })}>+ Add department</button></div>
            <section className="panel table-panel">{data.departments.length ? <div className="table-wrap"><table><thead><tr><th>Department</th><th>Default cost code</th><th>Active employees</th><th>Status</th><th /></tr></thead><tbody>{data.departments.map((department) => { const count = activeEmployees.filter((employee) => employee.departmentId === department.id).length; return <tr key={department.id} className={!department.active ? "inactive-row" : ""}><td><strong>{department.name}</strong></td><td><span className="code-pill">{department.defaultCostCode}</span></td><td>{count}</td><td><span className={`status-pill ${department.active ? "active" : "inactive"}`}>{department.active ? "Active" : "Inactive"}</span></td><td><button className="text-button" onClick={() => setEditingDepartment(department)}>Edit</button></td></tr>; })}</tbody></table></div> : <EmptyState title="No departments configured" body="Add the first company department and its default cost code." />}</section>
            <div className="section-heading"><div><p className="eyebrow">Department work patterns</p><h2>Work groups & schedules</h2><span>Keep 12-hour 2-2-3 crews, add Monday-Friday 8-hour shifts, and adjust any department without rewriting history.</span></div><button className="primary-button" disabled={!data.scheduleStorageReady || !activeDepartments.length} onClick={() => setEditingSchedule({ id: "", departmentId: activeDepartments[0]?.id ?? "", workGroup: "", name: "", active: true, rules: [], createdAt: "", updatedAt: "" })}>+ Add schedule</button></div>
            {!data.scheduleStorageReady && <div className="alert error"><span>!</span>Facility schedule storage is not active yet. Apply the facility-schedules migration before managing schedules.</div>}
            {data.scheduleStorageReady && <section className="department-schedule-grid">{data.departments.map((department) => {
              const schedules = data.workSchedules.filter((schedule) => schedule.departmentId === department.id);
              return <article className="panel department-schedule-card" key={department.id}><div className="panel-head"><div><p className="eyebrow">{department.active ? "Active department" : "Inactive department"}</p><h3>{department.name}</h3></div><span className="subtle-count">{schedules.length} schedules</span></div>{schedules.length ? <div className="schedule-list">{schedules.map((schedule) => { const rule = [...schedule.rules].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]; const workingDays = rule?.cycleHours.filter((hours) => hours > 0).length ?? 0; return <button type="button" key={schedule.id} className={!schedule.active ? "inactive" : ""} onClick={() => setEditingSchedule(schedule)}><span><strong>{scheduleLabel(schedule)}</strong><small>{rule?.cycleHours.length === 14 ? "14-day rotation" : "Monday–Sunday pattern"} · {workingDays} working days · effective {rule ? prettyDate(rule.effectiveFrom, true) : "not set"}</small></span><span className={`status-pill ${schedule.active ? "active" : "inactive"}`}>{schedule.active ? "Active" : "Inactive"}</span></button>; })}</div> : <EmptyState title="No schedules yet" body="Add 12-hour or weekday schedules for this department." />}</article>;
            })}</section>}
            <section className="security-strip"><div className="lock-mark">✓</div><div><strong>History-safe setup</strong><span>Departments are deactivated instead of deleted. Existing overtime keeps the employee, shift, and department values that were true when it was entered.</span></div></section>
          </>
        )}

        {tab === "admin" && isAdmin && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Protected access</p><h1>Administration</h1><span>Approve users, assign roles, and review recent changes.</span></div></div>
            <section className="two-column admin-columns">
              <div className="panel">
                <div className="panel-head"><div><p className="eyebrow">User access</p><h2>Approved accounts</h2></div><span className="subtle-count">Select a person to manage</span></div>
                {data.profiles.length ? (
                  <div className="profile-list">
                    {data.profiles.map((profile) => (
                      <button type="button" className="profile-row" key={profile.email} onClick={() => setEditingProfile(profile)}>
                        <span className="avatar">{initials(profile.fullName)}</span>
                        <span className="profile-copy"><strong>{profile.fullName}</strong><small>{profile.email}{profile.role === "supervisor" ? ` · ${data.departments.find((department) => department.id === profile.departmentId)?.name ?? "Unassigned"} · ${data.workSchedules.find((schedule) => schedule.id === profile.scheduleId) ? scheduleLabel(data.workSchedules.find((schedule) => schedule.id === profile.scheduleId)!) : "Unassigned schedule"}` : ""}</small></span>
                        <span className="role-pill">{profile.role}</span>
                        <span className={`status-pill ${profile.active ? "active" : "inactive"}`}>{profile.active ? "Active" : "Inactive"}</span>
                        <span className="profile-edit-mark">Edit</span>
                      </button>
                    ))}
                  </div>
                ) : <EmptyState title="No approved accounts" body="Add the first approved person below." />}
                <div className="profile-list-footer"><button type="button" className="primary-button full" onClick={() => setAddingProfile(true)}>+ Add new person</button></div>
              </div>
              <div className="panel"><div className="panel-head"><div><p className="eyebrow">Audit history</p><h2>Recent changes</h2></div></div><div className="audit-list">{data.auditLog.length ? data.auditLog.slice(0, 20).map((item) => <div key={item.id}><span className="audit-dot" /><div><strong>{item.action} {item.entityType.replaceAll("_", " ")}</strong><small>{item.userEmail} · {timestampDate(item.createdAt).toLocaleString()}</small></div></div>) : <EmptyState title="No changes yet" body="Administrative and entry changes will be recorded here." />}</div></div>
            </section>
            <section className="security-strip"><div className="lock-mark">✓</div><div><strong>{isDemo ? "Safe local preview" : "Company pilot protections"}</strong><span>{isDemo ? "These fake profiles and audit entries exist only in this browser. Use Preview as above to compare administrator, supervisor, and viewer access." : "Supabase login, approved roles, forced row-level security, database validation, historical snapshots, and tamper-resistant audit history are enabled."}</span></div></section>
          </>
        )}
      </main>

      {overtimeEditor && <Modal title={overtimeEditor.entry ? "Edit overtime" : "Add overtime"} onClose={() => setOvertimeEditor(null)}><OvertimeForm employee={overtimeEditor.employee} entry={overtimeEditor.entry} date={selectedDate} data={data} departments={data.departments} busy={busy} onSubmit={async (values) => { const action = overtimeEditor.entry ? "update_overtime" : "add_overtime"; const workDate = String(values.workDate); const ok = await mutate({ action, id: overtimeEditor.entry?.id, employeeId: overtimeEditor.employee.id, ...values }, overtimeEditor.entry ? "Overtime entry updated." : "Overtime entry saved."); if (ok) { setSelectedDate(workDate); setOvertimeEditor(null); } }} onDelete={overtimeEditor.entry ? async () => { const ok = await mutate({ action: "delete_overtime", id: overtimeEditor.entry?.id }, "Overtime entry removed."); if (ok) setOvertimeEditor(null); } : undefined} /></Modal>}
      {ptoEditor && <Modal title={ptoEditor.entry ? "Edit PTO" : "Add PTO range"} onClose={() => setPtoEditor(null)}><PtoForm employee={ptoEditor.employee} entry={ptoEditor.entry} date={selectedDate} data={data} busy={busy} onSubmit={async (values) => { const action = ptoEditor.entry ? "update_pto" : "add_pto_range"; const focusDate = String(ptoEditor.entry ? values.ptoDate : values.startDate); const ok = await mutate({ action, id: ptoEditor.entry?.id, employeeId: ptoEditor.employee.id, ...values }, ptoEditor.entry ? "PTO entry updated." : `PTO added only to ${Number(values.scheduledDateCount)} scheduled workday${Number(values.scheduledDateCount) === 1 ? "" : "s"}.`); if (ok) { setSelectedDate(focusDate); setPtoEditor(null); } }} /></Modal>}
      {calendarDetailDate && <Modal title={`Day snapshot · ${prettyDate(calendarDetailDate)}`} wide onClose={() => setCalendarDetailDate(null)}><CalendarDaySnapshot date={calendarDetailDate} data={data} isAdmin={Boolean(isAdmin)} onCorrectShift={() => { setCalendarDetailDate(null); setOverrideDate(calendarDetailDate); }} onAdjustSchedules={data.scheduleStorageReady ? () => { setCalendarDetailDate(null); setScheduleAdjustmentDate(calendarDetailDate); } : undefined} onSeeWhoWorked={() => { setCalendarDetailDate(null); setCalendarWorkedDate(calendarDetailDate); }} /></Modal>}
      {calendarWorkedDate && <Modal title={`Who worked · ${prettyDate(calendarWorkedDate)}`} wide onClose={() => setCalendarWorkedDate(null)}><CalendarWorkedSnapshot date={calendarWorkedDate} data={data} onBack={() => { setCalendarWorkedDate(null); setCalendarDetailDate(calendarWorkedDate); }} /></Modal>}
      {overrideDate && <Modal title="Correct Blue/Yellow shift" onClose={() => setOverrideDate(null)}><OverrideForm date={overrideDate} current={shiftForDate(overrideDate, data.scheduleOverrides)} override={data.scheduleOverrides.find((item) => item.workDate === overrideDate)} busy={busy} onSave={async (values) => { const ok = await mutate({ action: "set_override", workDate: overrideDate, ...values }, "Blue/Yellow shift correction saved."); if (ok) setOverrideDate(null); }} onRemove={async () => { const ok = await mutate({ action: "delete_override", workDate: overrideDate }, "Blue/Yellow shift correction removed."); if (ok) setOverrideDate(null); }} /></Modal>}
      {scheduleAdjustmentDate && <Modal title="Adjust department schedules for this date" wide onClose={() => setScheduleAdjustmentDate(null)}><ScheduleDayForm date={scheduleAdjustmentDate} schedules={data.workSchedules} departments={data.departments} overrides={data.workScheduleOverrides} legacyOverrides={data.scheduleOverrides} busy={busy} onSave={async (values) => { const ok = await mutate({ action: "save_schedule_day", workDate: scheduleAdjustmentDate, ...values }, "Department schedule adjustments saved."); if (ok) setScheduleAdjustmentDate(null); }} /></Modal>}
      {editingEmployee && <Modal title={editingEmployee.id ? "Edit employee" : "Add employee"} onClose={() => setEditingEmployee(null)}><EmployeeForm employee={editingEmployee} departments={data.departments} schedules={data.workSchedules} busy={busy} onSave={async (values) => { const ok = await mutate({ action: editingEmployee.id ? "update_employee" : "add_employee", id: editingEmployee.id, ...values }, editingEmployee.id ? "Employee updated." : "Employee added."); if (ok) setEditingEmployee(null); }} onDelete={editingEmployee.id ? async () => { const ok = await mutate({ action: "delete_employee", id: editingEmployee.id }, "Employee deleted."); if (ok) setEditingEmployee(null); } : undefined} /></Modal>}
      {editingDepartment && <Modal title={editingDepartment.id ? "Edit department" : "Add department"} onClose={() => setEditingDepartment(null)}><DepartmentForm department={editingDepartment} activeEmployeeCount={activeEmployees.filter((employee) => employee.departmentId === editingDepartment.id).length} busy={busy} onSave={async (values) => { const ok = await mutate({ action: editingDepartment.id ? "update_department" : "add_department", id: editingDepartment.id, ...values }, editingDepartment.id ? "Department updated." : "Department added."); if (ok) setEditingDepartment(null); }} /></Modal>}
      {editingSchedule && <Modal title={editingSchedule.id ? "Edit department schedule" : "Add department schedule"} wide onClose={() => setEditingSchedule(null)}><WorkScheduleForm schedule={editingSchedule} departments={data.departments} busy={busy} onSave={async (values) => { const ok = await mutate({ action: editingSchedule.id ? "update_work_schedule" : "add_work_schedule", id: editingSchedule.id, ...values }, editingSchedule.id ? "Schedule updated with an effective-dated rule." : "Department schedule added."); if (ok) setEditingSchedule(null); }} /></Modal>}
      {editingProfile && <Modal title="Update user access" onClose={() => setEditingProfile(null)}><ProfileForm profile={editingProfile} departments={data.departments} schedules={data.workSchedules} busy={busy} currentUserEmail={data.session.email} localDemo={isDemo} onSave={async (values) => { const ok = await mutate({ action: "update_profile", originalEmail: editingProfile.email, ...values }, "User access updated."); if (ok) setEditingProfile(null); }} onDelete={async () => { const ok = await mutate({ action: "delete_profile", email: editingProfile.email }, "User access deleted."); if (ok) setEditingProfile(null); }} /></Modal>}
      {addingProfile && <Modal title="Add new person" onClose={() => setAddingProfile(false)}><ProfileForm departments={data.departments} schedules={data.workSchedules} busy={busy} currentUserEmail={data.session.email} localDemo={isDemo} onSave={async (values) => { const ok = await mutate({ action: "add_profile", ...values }, "New user access added."); if (ok) setAddingProfile(false); }} /></Modal>}
      {customizingDashboard && <Modal title="Customize your dashboard" wide onClose={() => setCustomizingDashboard(false)}><DashboardCustomizer initial={data.dashboardWidgets} busy={busy} onSave={async (widgets) => { const ok = await mutate({ action: "save_dashboard_layout", widgets }, "Your dashboard layout was saved."); if (ok) setCustomizingDashboard(false); }} /></Modal>}
      {importKind && <Modal title={importKind === "employees" ? "Import employee roster" : "Import overtime & PTO history"} onClose={() => setImportKind(null)}><ImportForm kind={importKind} busy={busy} localDemo={isDemo} onImport={async (rows) => { const ok = await mutate({ action: importKind === "employees" ? "import_employees" : "import_history", rows }, importKind === "employees" ? "Employee roster imported." : "Historical records imported."); if (ok) setImportKind(null); }} /></Modal>}
    </div>
  );
}

function RosterLimitControl({ total, value, onChange, detail, ariaLabel = "Employees shown" }: { total: number; value: number; onChange: (value: number) => void; detail?: string; ariaLabel?: string }) {
  const shown = Math.min(value, total);
  return <label className="roster-limit-control"><span>{detail ? detail + " · " : ""}Showing <strong>{shown}</strong> of {total}</span><input type="range" min="3" max={Math.max(3, total)} value={Math.min(value, Math.max(3, total))} disabled={total <= 3} onChange={(event) => onChange(Number(event.target.value))} aria-label={ariaLabel} /></label>;
}

function RosterFilters({ departments, schedules, department, setDepartment, schedule, setSchedule, search, setSearch }: { departments: Department[]; schedules: WorkSchedule[]; department: string; setDepartment: (value: string) => void; schedule: string; setSchedule: (value: string) => void; search: string; setSearch: (value: string) => void }) {
  const visibleSchedules = schedules.filter((item) => item.active && (department === "all" || item.departmentId === department));
  return <section className="filter-bar roster-filters"><label><span>Department</span><select value={department} onChange={(event) => { setDepartment(event.target.value); if (event.target.value !== "all" && !schedules.some((item) => item.id === schedule && item.departmentId === event.target.value)) setSchedule("all"); }}><option value="all">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Work group / schedule</span><select value={visibleSchedules.some((item) => item.id === schedule) ? schedule : "all"} onChange={(event) => setSchedule(event.target.value)}><option value="all">All schedules</option>{visibleSchedules.map((item) => <option key={item.id} value={item.id}>{scheduleLabel(item)}</option>)}</select></label><label className="search-field"><span>Find employee</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" /></label></section>;
}

function DashboardMetric({ widget, label, value, unit, detail }: { widget: DashboardWidget; label: string; value: string | number; unit?: string; detail: string }) {
  return <article className={`dashboard-widget dashboard-metric ${widget.size}`}><span className="metric-label">{label}</span><strong>{value}{unit && <small> {unit}</small>}</strong><em>{detail}</em></article>;
}

function DashboardBars({ rows, unit = "hrs" }: { rows: Array<[string, number]>; unit?: string }) {
  const visible = rows.slice(0, 8);
  const maximum = Math.max(...visible.map(([, value]) => value), 0);
  if (!visible.length || maximum === 0) return <EmptyState title="No data yet" body="This chart will fill in as tracker entries are added." />;
  return <div className="dashboard-bars">{visible.map(([label, value]) => <div key={label}><div><strong>{label}</strong><span>{Number.isInteger(value) ? value : value.toFixed(1)} {unit}</span></div><i><b style={{ width: `${Math.max((value / maximum) * 100, 2)}%` }} /></i></div>)}</div>;
}

function DashboardTrend({ selectedDate, entries }: { selectedDate: string; entries: OvertimeEntry[] }) {
  const months = monthKeys(selectedDate);
  const values = months.map((month) => entries.filter((entry) => entry.workDate.startsWith(month.key)).reduce((sum, entry) => sum + entry.hours, 0));
  const maximum = Math.max(...values, 1);
  const width = 640;
  const height = 170;
  const paddingX = 28;
  const paddingY = 22;
  const points = values.map((value, index) => {
    const x = paddingX + (index * (width - paddingX * 2)) / Math.max(values.length - 1, 1);
    const y = height - paddingY - (value / maximum) * (height - paddingY * 2);
    return { x, y, value };
  });
  return <div className="trend-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Overtime trend: ${months.map((month, index) => `${month.label} ${values[index].toFixed(1)} hours`).join(", ")}`}><line x1={paddingX} y1={height - paddingY} x2={width - paddingX} y2={height - paddingY} /><polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} /><g>{points.map((point, index) => <g key={months[index].key}><circle cx={point.x} cy={point.y} r="5" /><text x={point.x} y={Math.max(point.y - 11, 12)} textAnchor="middle">{point.value.toFixed(1)}</text></g>)}</g></svg><div>{months.map((month) => <span key={month.key}>{month.label}</span>)}</div></div>;
}

function DashboardPanel({ widget, eyebrow, title, action, children }: { widget: DashboardWidget; eyebrow?: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <article className={`dashboard-widget panel ${widget.size}`}><div className="panel-head"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action}</div>{children}</article>;
}

function DashboardWidgetView({ widget, data, selectedDate, workingColor, activeEmployees, activeDepartments, monthOt, monthPto, selectedOt, selectedPto, employeesById, onNavigate }: { widget: DashboardWidget; data: TrackerBundle; selectedDate: string; workingColor: ShiftColor; activeEmployees: Employee[]; activeDepartments: Department[]; monthOt: OvertimeEntry[]; monthPto: PtoEntry[]; selectedOt: OvertimeEntry[]; selectedPto: PtoEntry[]; employeesById: Map<string, Employee>; onNavigate: (tab: Tab) => void }) {
  const otHours = monthOt.reduce((sum, entry) => sum + entry.hours, 0);
  const ptoHours = monthPto.reduce((sum, entry) => sum + entry.hours, 0);
  const placementEmployees = data.session.role === "supervisor" ? activeEmployees.filter((employee) => employee.departmentId === data.session.departmentId && employee.scheduleId === data.session.scheduleId) : activeEmployees;
  const crewScopes = Array.from(new Map(placementEmployees.map((employee) => [`${employee.departmentId}|${employee.scheduleId ?? employee.scheduleName}`, { departmentId: employee.departmentId, department: employee.department, scheduleId: employee.scheduleId, scheduleName: employee.scheduleName, color: employee.shiftColor, period: employee.shiftPeriod }])).values());
  const activeCrewSystems = data.crewSystems.filter((system) => system.active);
  const activeCrewPositions = data.crewPositions.filter((position) => position.active && position.required && activeCrewSystems.some((system) => system.id === position.systemId));
  const placementGapRows: Array<[string, number]> = crewScopes.map((scope) => {
    const systemIds = new Set(activeCrewSystems.filter((system) => system.departmentId === scope.departmentId).map((system) => system.id));
    const positionIds = new Set(activeCrewPositions.filter((position) => systemIds.has(position.systemId)).map((position) => position.id));
    const filled = data.crewPlacements.filter((placement) => (scope.scheduleId ? placement.scheduleId === scope.scheduleId : placement.shiftColor === scope.color && placement.shiftPeriod === scope.period) && positionIds.has(placement.positionId)).length;
    return [`${scope.department} · ${scope.scheduleName}`, Math.max(0, positionIds.size - filled)] as [string, number];
  }).filter(([, gaps]) => gaps > 0);
  const totalRequiredPositions = crewScopes.reduce((sum, scope) => {
    const systemIds = new Set(activeCrewSystems.filter((system) => system.departmentId === scope.departmentId).map((system) => system.id));
    return sum + activeCrewPositions.filter((position) => systemIds.has(position.systemId)).length;
  }, 0);
  const totalPlacementGaps = placementGapRows.reduce((sum, [, gaps]) => sum + gaps, 0);
  const totalFilledPositions = Math.max(0, totalRequiredPositions - totalPlacementGaps);

  if (widget.id === "weekly_summary") {
    const dates = weekDates(selectedDate);
    return <DashboardPanel widget={widget} eyebrow="Monday through Sunday" title="Weekly operations snapshot" action={<button className="text-button" onClick={() => onNavigate("calendar")}>Open calendar →</button>}><div className="weekly-operations-grid">{dates.map((date) => { const color = shiftForDate(date, data.scheduleOverrides); const scheduledCount = activeEmployees.filter((employee) => scheduledHours(data, employee, date) > 0).length; const overtime = data.overtimeEntries.filter((entry) => entry.workDate === date).reduce((sum, entry) => sum + entry.hours, 0); const pto = data.ptoEntries.filter((entry) => entry.ptoDate === date).reduce((sum, entry) => sum + entry.hours, 0); return <article className={`${color.toLowerCase()} ${date === selectedDate ? "selected" : ""}`} key={date}><span>{dateFromInput(date).toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{dateFromInput(date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong><ShiftBadge color={color} compact /><small>{scheduledCount} total scheduled</small><div><b>{overtime.toFixed(1)} OT</b><b>{pto.toFixed(1)} PTO</b></div></article>; })}</div></DashboardPanel>;
  }

  if (widget.id === "kpi_ot") return <DashboardMetric widget={widget} label="Overtime this month" value={otHours.toFixed(1)} unit="hrs" detail={`${monthOt.length} entries`} />;
  if (widget.id === "kpi_pto") return <DashboardMetric widget={widget} label="PTO this month" value={ptoHours.toFixed(1)} unit="hrs" detail={`${monthPto.length} entries`} />;
  if (widget.id === "kpi_employees") return <DashboardMetric widget={widget} label="Active employees" value={activeEmployees.length} detail={`${activeDepartments.length} active departments`} />;
  if (widget.id === "kpi_ot_people") return <DashboardMetric widget={widget} label="Employees with OT" value={new Set(monthOt.map((entry) => entry.employeeId)).size} detail={`${monthOt.length ? (otHours / monthOt.length).toFixed(1) : "0.0"} average hrs per entry`} />;
  if (widget.id === "placement_coverage") return <DashboardMetric widget={widget} label="Required positions filled" value={totalFilledPositions} detail={`${totalPlacementGaps} open of ${totalRequiredPositions} configured spots`} />;
  if (widget.id === "placement_gaps") return <DashboardPanel widget={widget} eyebrow="Crew placement" title="Open required positions" action={<button className="text-button" onClick={() => onNavigate("crew")}>Open rosters →</button>}><DashboardBars rows={placementGapRows} unit="open" /></DashboardPanel>;

  if (widget.id === "shift_today") {
    const scheduledEmployees = activeEmployees.filter((employee) => scheduledHours(data, employee, selectedDate) > 0);
    const blueYellowEmployees = scheduledEmployees.filter((employee) => overallShiftColorForEmployee(data, employee) === workingColor);
    const otherScheduledEmployees = scheduledEmployees.filter((employee) => overallShiftColorForEmployee(data, employee) !== workingColor);
    const departmentSchedule = activeDepartments.map((department) => ({
      name: department.name,
      count: blueYellowEmployees.filter((employee) => employee.departmentId === department.id).length,
    })).filter((department) => department.count > 0);
    return <article className={`dashboard-widget dashboard-shift ${workingColor.toLowerCase()} ${widget.size}`}>
      <div className="shift-summary"><span className="hero-kicker">Overall shift · {prettyDate(selectedDate, true)}</span><h2>{workingColor} Shift</h2><p>The Blue/Yellow 12-hour rotation remains the main facility schedule.{otherScheduledEmployees.length ? ` ${otherScheduledEmployees.length} weekday or specially adjusted employee${otherScheduledEmployees.length === 1 ? " is" : "s are"} also scheduled.` : ""}</p></div>
      <div className="department-summary">
        <div className="department-summary-head">
          <span>Department breakdown</span>
          <small>{departmentSchedule.length} {departmentSchedule.length === 1 ? "department" : "departments"}</small>
        </div>
        <div className="department-summary-list" role="list" aria-label="Scheduled employees by department">
          {departmentSchedule.length ? departmentSchedule.map((department) => <div key={department.name} role="listitem" title={`${department.name}: ${department.count} scheduled`}><span>{department.name}</span><strong>{department.count}</strong></div>) : <p>No employees scheduled</p>}
        </div>
      </div>
      <div className="hero-count"><strong>{blueYellowEmployees.length}</strong><span>{workingColor} crew scheduled</span></div>
      {(data.workScheduleOverrides.some((item) => item.workDate === selectedDate) || data.scheduleOverrides.some((item) => item.workDate === selectedDate)) && <span className="override-flag">Admin adjusted</span>}
    </article>;
  }

  if (widget.id === "schedule") return <DashboardPanel widget={widget} eyebrow="Overall Blue/Yellow rotation" title="Next 14 days" action={<button className="text-button" onClick={() => onNavigate("calendar")}>Full calendar →</button>}><div className="forecast-grid">{Array.from({ length: 14 }, (_, index) => addDays(selectedDate, index)).map((date) => { const color = shiftForDate(date, data.scheduleOverrides); const scheduledCount = activeEmployees.filter((employee) => scheduledHours(data, employee, date) > 0).length; return <div className={`forecast-day ${color.toLowerCase()}`} key={date}><span>{dateFromInput(date).toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{dateFromInput(date).getDate()}</strong><ShiftBadge color={color} compact /><small>{scheduledCount} total</small></div>; })}</div></DashboardPanel>;

  if (widget.id === "selected_ot") return <DashboardPanel widget={widget} title={`Overtime on ${prettyDate(selectedDate, true)}`} action={<button className="text-button" onClick={() => onNavigate("overtime")}>Open details →</button>}>{selectedOt.length ? <div className="activity-list">{selectedOt.map((entry) => <div key={entry.id}><span className="avatar">{initials(entry.employeeName)}</span><div><strong>{entry.employeeName}</strong><small>{entry.departmentName} · {entry.costCode} · {entry.reason}</small></div><b>{entry.hours} hrs</b></div>)}</div> : <EmptyState title="No overtime entered" body="Entries for this date will appear here." />}</DashboardPanel>;

  if (widget.id === "selected_pto") return <DashboardPanel widget={widget} title={`PTO on ${prettyDate(selectedDate, true)}`} action={<button className="text-button" onClick={() => onNavigate("pto")}>Open details →</button>}>{selectedPto.length ? <div className="activity-list">{selectedPto.map((entry) => { const employee = employeesById.get(entry.employeeId); return <div key={entry.id}><span className="avatar">{initials(employee?.name || "Unknown")}</span><div><strong>{employee?.name || "Unknown"}</strong><small>{employee?.department || "No department"} · {entry.ptoType}</small></div><b>{entry.hours} hrs</b></div>; })}</div> : <EmptyState title="No PTO entered" body="PTO entries for this date will appear here." />}</DashboardPanel>;

  if (widget.id === "ot_trend") return <DashboardPanel widget={widget} eyebrow="Historical trend" title="Overtime over six months"><DashboardTrend selectedDate={selectedDate} entries={data.overtimeEntries} /></DashboardPanel>;

  const chartConfig: Partial<Record<DashboardWidgetId, { eyebrow: string; title: string; rows: Array<[string, number]>; unit?: string }>> = {
    department_ot: { eyebrow: "Monthly distribution", title: "OT hours by department", rows: totalsBy(monthOt, (entry) => entry.departmentName, (entry) => entry.hours) },
    shift_ot: { eyebrow: "Monthly distribution", title: "OT hours by shift", rows: totalsBy(monthOt, (entry) => entry.shiftName, (entry) => entry.hours) },
    reason_ot: { eyebrow: "Monthly distribution", title: "OT hours by reason", rows: totalsBy(monthOt, (entry) => entry.reason, (entry) => entry.hours) },
    cost_code_ot: { eyebrow: "Monthly distribution", title: "OT hours by cost code", rows: totalsBy(monthOt, (entry) => entry.costCode, (entry) => entry.hours) },
    pto_type: { eyebrow: "Monthly distribution", title: "PTO hours by type", rows: totalsBy(monthPto, (entry) => entry.ptoType, (entry) => entry.hours) },
    staffing_department: { eyebrow: "Current workforce", title: "Staffing by department", rows: totalsBy(activeEmployees, (employee) => employee.department, () => 1), unit: "people" },
    staffing_crew: { eyebrow: "Current workforce", title: "Staffing by work schedule", rows: totalsBy(activeEmployees, (employee) => employee.scheduleName, () => 1), unit: "people" },
  };
  const chart = chartConfig[widget.id];
  if (chart) return <DashboardPanel widget={widget} eyebrow={chart.eyebrow} title={chart.title}><DashboardBars rows={chart.rows} unit={chart.unit} /></DashboardPanel>;
  return null;
}

function DashboardCustomizer({ initial, busy, onSave }: { initial: DashboardWidget[]; busy: boolean; onSave: (widgets: DashboardWidget[]) => Promise<void> }) {
  const [widgets, setWidgets] = useState(() => initial.map((widget) => ({ ...widget })));
  const activeIds = new Set(widgets.map((widget) => widget.id));
  const available = DASHBOARD_WIDGET_CATALOG.filter((item) => !activeIds.has(item.id));
  const catalog = new Map(DASHBOARD_WIDGET_CATALOG.map((item) => [item.id, item]));
  const move = (index: number, offset: number) => setWidgets((current) => {
    const destination = index + offset;
    if (destination < 0 || destination >= current.length) return current;
    const next = [...current];
    [next[index], next[destination]] = [next[destination], next[index]];
    return next;
  });

  return <div className="dashboard-customizer"><p className="modal-copy">Choose exactly what appears on your dashboard. Order and size are saved only for your signed-in account, including Viewer accounts used by management.</p><div className="customizer-columns"><section><div className="customizer-head"><div><p className="eyebrow">Current layout</p><h3>{widgets.length} widgets</h3></div><button type="button" className="text-button" onClick={() => setWidgets(DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })))}>Reset default</button></div>{widgets.length ? <div className="selected-widget-list">{widgets.map((widget, index) => { const item = catalog.get(widget.id); return <div key={widget.id}><div><strong>{item?.label}</strong><small>{item?.category}</small></div><select aria-label={`Size for ${item?.label}`} value={widget.size} onChange={(event) => setWidgets((current) => current.map((currentWidget) => currentWidget.id === widget.id ? { ...currentWidget, size: event.target.value as DashboardWidgetSize } : currentWidget))}><option value="compact">Compact</option><option value="standard">Half width</option><option value="wide">Full width</option></select><div className="widget-order"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${item?.label} up`}>↑</button><button type="button" disabled={index === widgets.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${item?.label} down`}>↓</button></div><button type="button" className="delete-link" onClick={() => setWidgets((current) => current.filter((currentWidget) => currentWidget.id !== widget.id))}>Remove</button></div>; })}</div> : <EmptyState title="No widgets selected" body="Add widgets from the catalog to build your dashboard." />}</section><section><div className="customizer-head"><div><p className="eyebrow">Widget catalog</p><h3>{available.length} available</h3></div>{available.length > 0 && <button type="button" className="text-button" onClick={() => setWidgets((current) => [...current, ...available.map((item) => ({ id: item.id, size: item.defaultSize }))])}>Add all</button>}</div><div className="available-widget-list">{available.length ? available.map((item) => <article key={item.id}><div><span>{item.category}</span><strong>{item.label}</strong><p>{item.description}</p></div><button type="button" className="secondary-button" onClick={() => setWidgets((current) => [...current, { id: item.id, size: item.defaultSize }])}>Add</button></article>) : <EmptyState title="Everything is on your dashboard" body="Remove a widget from the current layout to place it back here." />}</div></section></div><div className="customizer-footer"><span>Your changes are not applied until you save.</span><button className="primary-button" disabled={busy} onClick={() => void onSave(widgets)}>{busy ? "Saving…" : "Save my dashboard"}</button></div></div>;
}

function OvertimeForm({ employee, entry, date, data, departments, busy, onSubmit, onDelete }: { employee: Employee; entry?: OvertimeEntry; date: string; data: TrackerBundle; departments: Department[]; busy: boolean; onSubmit: (values: Record<string, unknown>) => Promise<void>; onDelete?: () => Promise<void> }) {
  const selectable = departments.filter((department) => department.active || department.id === entry?.departmentId);
  const initialDepartment = selectable.find((department) => department.id === entry?.departmentId) ?? selectable.find((department) => department.id === employee.departmentId) ?? selectable[0];
  const employeeSchedule = data.workSchedules.find((schedule) => schedule.id === employee.scheduleId);
  const normalShiftHours = Math.max(0, ...(employeeSchedule?.rules.flatMap((rule) => rule.cycleHours) ?? [12]));
  const [workDate, setWorkDate] = useState(entry?.workDate ?? date);
  const [hours, setHours] = useState(entry?.hours ?? (normalShiftHours || 12));
  const [departmentId, setDepartmentId] = useState(initialDepartment?.id ?? "");
  const [costCode, setCostCode] = useState(entry?.costCode ?? initialDepartment?.defaultCostCode ?? "");
  const [reason, setReason] = useState(entry?.reason ?? "Production Needs");
  const [confirmedDate, setConfirmedDate] = useState(false);
  const historicalReason = entry?.reason && !OT_REASONS.includes(entry.reason as (typeof OT_REASONS)[number]) ? entry.reason : "";
  const plannedHours = scheduledHours(data, employee, workDate);

  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSubmit({ workDate, hours, departmentId, costCode, reason, notes: form.get("notes") }); }}>
    <div className="form-summary"><span className="avatar large">{initials(employee.name)}</span><div><strong>{employee.name}</strong><span>{employee.scheduleName} · Home: {employee.department}</span></div></div>
    <section className="entry-date-card">
      <div><span className="entry-date-kicker">Check this before saving</span><strong>{prettyDate(workDate)}</strong><small>This is the date the overtime will be recorded on.</small></div>
      <label><span>Overtime date</span><input type="date" value={workDate} onChange={(event) => { setWorkDate(event.target.value); setConfirmedDate(false); }} required /></label>
    </section>
    {plannedHours > 0 && <div className="field-error">{employee.name} is scheduled for {plannedHours.toFixed(1)} regular hours on this date. Overtime cannot be added here.</div>}
    <label><span>Quick hours</span><div className="quick-hours">{[2, 4, 8, 12].map((value) => <button type="button" key={value} className={hours === value ? "active" : ""} onClick={() => setHours(value)}>+{value}</button>)}</div></label>
    <div className="form-grid"><label><span>Hours</span><input name="hours" type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(event) => setHours(Number(event.target.value))} required /></label><label><span>Working department</span><select name="departmentId" value={departmentId} onChange={(event) => { const next = selectable.find((department) => department.id === event.target.value); setDepartmentId(event.target.value); if (next) setCostCode(next.defaultCostCode); }} required>{selectable.map((department) => <option key={department.id} value={department.id}>{department.name}{department.active ? "" : " (inactive)"}</option>)}</select></label></div>
    <div className="form-grid"><label><span>Cost code</span><input name="costCode" value={costCode} onChange={(event) => setCostCode(event.target.value.toUpperCase())} placeholder="Example: EXT-100" required /></label><label><span>Reason</span><select name="reason" value={reason} onChange={(event) => setReason(event.target.value)} required>{historicalReason && <option>{historicalReason}</option>}{OT_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <label><span>Notes <em>optional</em></span><textarea name="notes" rows={3} defaultValue={entry?.notes} placeholder="Add any useful context" /></label>
    <label className="date-confirm"><input type="checkbox" checked={confirmedDate} onChange={(event) => setConfirmedDate(event.target.checked)} /><span>I checked the date: <strong>{prettyDate(workDate)}</strong></span></label>
    <div className="button-row">{onDelete && <button type="button" className="danger-button" disabled={busy} onClick={() => void onDelete()}>Remove entry</button>}<button className="primary-button" disabled={busy || !departmentId || plannedHours > 0 || !confirmedDate}>{busy ? "Saving…" : entry ? `Update overtime for ${prettyDate(workDate, true)}` : `Save overtime for ${prettyDate(workDate, true)}`}</button></div>
  </form>;
}

function PtoForm({ employee, entry, date, data, busy, onSubmit }: { employee: Employee; entry?: PtoEntry; date: string; data: TrackerBundle; busy: boolean; onSubmit: (values: Record<string, unknown>) => Promise<void> }) {
  const [startDate, setStartDate] = useState(entry?.ptoDate ?? date);
  const [endDate, setEndDate] = useState(entry?.ptoDate ?? date);
  const [useScheduledHours, setUseScheduledHours] = useState(!entry);
  const [fixedHours, setFixedHours] = useState(entry?.hours ?? 8);
  const [confirmedDates, setConfirmedDates] = useState(false);
  const plannedDates = scheduledDatesInRange(employee, startDate, endDate, data.workSchedules, data.workScheduleOverrides, data.scheduleOverrides);
  const existingDates = new Set(data.ptoEntries.filter((item) => item.employeeId === employee.id && item.id !== entry?.id).map((item) => item.ptoDate));
  const eligibleDates = plannedDates.filter((item) => !existingDates.has(item.date));
  const existingCount = plannedDates.length - eligibleDates.length;
  const start = dateFromInput(startDate);
  const end = dateFromInput(endDate);
  const totalRangeDays = startDate && endDate && startDate <= endDate ? Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1 : 0;
  const offDayCount = Math.max(0, totalRangeDays - plannedDates.length);
  const editingOffDay = Boolean(entry && plannedDates.length === 0);
  const rangeTooLong = totalRangeDays > 366;
  const fixedHoursTooHigh = entry ? fixedHours > (plannedDates[0]?.hours ?? 0) : !useScheduledHours && eligibleDates.some((item) => fixedHours > item.hours);

  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSubmit(entry ? { ptoDate: startDate, hours: fixedHours, ptoType: form.get("ptoType"), notes: form.get("notes") } : { startDate, endDate, useScheduledHours, hours: fixedHours, ptoType: form.get("ptoType"), notes: form.get("notes"), scheduledDateCount: eligibleDates.length }); }}>
    <div className="form-summary"><span className="avatar large">{initials(employee.name)}</span><div><strong>{employee.name}</strong><span>{employee.department} · {employee.scheduleName}</span></div></div>
    <section className="entry-date-card pto-range-card">
      <div><span className="entry-date-kicker">{entry ? "Correct the recorded date" : "PTO date range"}</span><strong>{entry || startDate === endDate ? prettyDate(startDate) : `${prettyDate(startDate, true)} through ${prettyDate(endDate, true)}`}</strong><small>{entry ? "The updated date must be a scheduled workday." : "Off days are automatically skipped—no empty PTO records are created."}</small></div>
      <div className="date-range-inputs"><label><span>{entry ? "PTO date" : "Starts"}</span><input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); if (entry || endDate < event.target.value) setEndDate(event.target.value); setConfirmedDates(false); }} required /></label>{!entry && <label><span>Through</span><input type="date" min={startDate} max={addDays(startDate, 365)} value={endDate} onChange={(event) => { setEndDate(event.target.value); setConfirmedDates(false); }} required /></label>}</div>
    </section>
    {!entry && <section className="pto-date-preview"><div className="preview-summary"><div><strong>{eligibleDates.length}</strong><span>scheduled workday{eligibleDates.length === 1 ? "" : "s"} will receive PTO</span></div><small>{offDayCount} off day{offDayCount === 1 ? "" : "s"} skipped{existingCount ? ` · ${existingCount} date${existingCount === 1 ? "" : "s"} already had PTO` : ""}</small></div>{eligibleDates.length ? <div className="date-chip-list">{eligibleDates.slice(0, 10).map((item) => <span key={item.date}>{prettyDate(item.date, true)} · {useScheduledHours ? item.hours : fixedHours} hrs</span>)}{eligibleDates.length > 10 && <span>+{eligibleDates.length - 10} more</span>}</div> : <div className="field-error">No PTO will be created. Choose a range containing scheduled workdays without existing PTO.</div>}</section>}
    {rangeTooLong && <div className="field-error">Choose a PTO range of 366 days or fewer.</div>}
    {editingOffDay && <div className="field-error">This employee is not scheduled on {prettyDate(startDate)}. Choose one of their scheduled workdays.</div>}
    {fixedHoursTooHigh && <div className="field-error">PTO hours cannot exceed the employee’s scheduled hours on any selected workday.</div>}
    <div className="form-grid">
      <label><span>PTO type</span><select name="ptoType" defaultValue={entry?.ptoType ?? "Vacation"}><option>Vacation</option><option>Sick</option><option>Personal</option><option>Bereavement</option><option>Other</option></select></label>
      {entry ? <label><span>PTO hours</span><input type="number" min="0.25" max="24" step="0.25" value={fixedHours} onChange={(event) => setFixedHours(Number(event.target.value))} required /></label> : <label><span>Hours on each workday</span><select value={useScheduledHours ? "scheduled" : "fixed"} onChange={(event) => setUseScheduledHours(event.target.value === "scheduled")}><option value="scheduled">Use scheduled hours</option><option value="fixed">Use one fixed amount</option></select></label>}
    </div>
    {!entry && !useScheduledHours && <label><span>Fixed PTO hours per scheduled workday</span><input type="number" min="0.25" max="24" step="0.25" value={fixedHours} onChange={(event) => setFixedHours(Number(event.target.value))} required /></label>}
    <label><span>Notes <em>optional</em></span><textarea name="notes" rows={3} defaultValue={entry?.notes} placeholder="Add any useful context" /></label>
    <label className="date-confirm"><input type="checkbox" checked={confirmedDates} onChange={(event) => setConfirmedDates(event.target.checked)} /><span>I reviewed {entry ? "this PTO date" : `all ${eligibleDates.length} scheduled PTO date${eligibleDates.length === 1 ? "" : "s"}`}.</span></label>
    <button className="primary-button full" disabled={busy || !confirmedDates || rangeTooLong || fixedHoursTooHigh || (entry ? editingOffDay : eligibleDates.length === 0)}>{busy ? "Saving…" : entry ? `Update PTO for ${prettyDate(startDate, true)}` : `Add PTO to ${eligibleDates.length} workday${eligibleDates.length === 1 ? "" : "s"}`}</button>
  </form>;
}

function EmployeeForm({ employee, departments, schedules, busy, onSave, onDelete }: { employee: Employee; departments: Department[]; schedules: WorkSchedule[]; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectable = departments.filter((department) => department.active || department.id === employee.departmentId);
  const [departmentId, setDepartmentId] = useState(employee.departmentId || selectable[0]?.id || "");
  const availableSchedules = schedules.filter((schedule) => (schedule.active || schedule.id === employee.scheduleId) && schedule.departmentId === departmentId);
  const [scheduleId, setScheduleId] = useState(employee.scheduleId || availableSchedules[0]?.id || "");
  const selectedScheduleId = availableSchedules.some((schedule) => schedule.id === scheduleId) ? scheduleId : availableSchedules[0]?.id ?? "";
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSave({ name: form.get("name"), departmentId, scheduleId: selectedScheduleId, active: form.get("active") === "on" }); }}>
    <label><span>Employee name</span><input name="name" defaultValue={employee.name} required autoFocus /></label>
    <label><span>Department</span><select name="departmentId" value={departmentId} onChange={(event) => { const nextDepartment = event.target.value; setDepartmentId(nextDepartment); setScheduleId(schedules.find((schedule) => schedule.active && schedule.departmentId === nextDepartment)?.id ?? ""); }} required>{selectable.map((department) => <option key={department.id} value={department.id}>{department.name}{department.active ? "" : " (inactive)"}</option>)}</select></label>
    <label><span>Work group / schedule</span><select name="scheduleId" value={selectedScheduleId} onChange={(event) => setScheduleId(event.target.value)} required><option value="" disabled>Select a configured schedule</option>{availableSchedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{scheduleLabel(schedule)}{schedule.active ? "" : " (inactive)"}</option>)}</select></label>
    {!availableSchedules.length && <div className="field-error">This department has no active work schedule. Add one in Company Setup first.</div>}
    <label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={employee.active} /><span>Active employee</span></label>
    {confirmDelete && <div className="delete-confirm"><strong>Permanently delete {employee.name}?</strong><span>This removes the employee from the roster and crew placement. Employees with overtime or PTO history cannot be deleted; mark them inactive instead so their records remain intact.</span><div className="button-row"><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="danger-button" disabled={busy} onClick={() => void onDelete?.()}>{busy ? "Deleting…" : "Confirm delete"}</button></div></div>}
    {!confirmDelete && <div className="button-row">{onDelete && <button type="button" className="danger-button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete employee</button>}<button className="primary-button" disabled={busy || !selectable.length || !selectedScheduleId}>{busy ? "Saving…" : "Save employee"}</button></div>}
  </form>;
}

function DepartmentForm({ department, activeEmployeeCount, busy, onSave }: { department: Department; activeEmployeeCount: number; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const active = activeEmployeeCount > 0 && department.active ? true : form.get("active") === "on"; void onSave({ name: form.get("name"), defaultCostCode: form.get("defaultCostCode"), active }); }}><p className="modal-copy">The default cost code fills automatically when this department is selected for overtime. Supervisors can still enter a different code when needed.</p><label><span>Department name</span><input name="name" defaultValue={department.name} maxLength={100} required autoFocus /></label><label><span>Default cost code</span><input name="defaultCostCode" defaultValue={department.defaultCostCode} maxLength={50} placeholder="Example: EXT-100" required /></label><label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={department.active} disabled={activeEmployeeCount > 0 && department.active} /><span>Active department{activeEmployeeCount > 0 && department.active ? ` · ${activeEmployeeCount} active employees must be moved or deactivated first` : ""}</span></label><div className="privacy-note"><strong>Historical records are protected</strong><span>Renaming this department updates current employee assignments. Existing overtime keeps its original department snapshot.</span></div><button className="primary-button full" disabled={busy}>{busy ? "Saving…" : "Save department"}</button></form>;
}

const SCHEDULE_ANCHOR = "2026-08-10";
const SCHEDULE_PRESETS = [
  { id: "blue-223", label: "Blue 2-2-3 · 12 hrs", name: "Blue Day", overallColor: "Blue", period: "Day", hours: [12, 12, 0, 0, 12, 12, 12, 0, 0, 12, 12, 0, 0, 0] },
  { id: "yellow-223", label: "Yellow 2-2-3 · 12 hrs", name: "Yellow Day", overallColor: "Yellow", period: "Day", hours: [0, 0, 12, 12, 0, 0, 0, 12, 12, 0, 0, 12, 12, 12] },
  { id: "weekday-8", label: "Monday–Friday · 8 hrs", name: "1st Shift", overallColor: "none", period: "Day", hours: [8, 8, 8, 8, 8, 0, 0] },
] as const;

function WorkScheduleForm({ schedule, departments, busy, onSave }: { schedule: WorkSchedule; departments: Department[]; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const initialRule = [...schedule.rules].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const selectableDepartments = departments.filter((department) => department.active || department.id === schedule.departmentId);
  const [departmentId, setDepartmentId] = useState(schedule.departmentId || selectableDepartments[0]?.id || "");
  const [workGroup, setWorkGroup] = useState(schedule.workGroup);
  const [name, setName] = useState(schedule.name);
  const today = toDateInput(new Date());
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [anchorDate, setAnchorDate] = useState(initialRule?.anchorDate ?? SCHEDULE_ANCHOR);
  const [cycleHours, setCycleHours] = useState<number[]>(initialRule?.cycleHours.length ? [...initialRule.cycleHours] : [...SCHEDULE_PRESETS[0].hours]);
  const [overallColor, setOverallColor] = useState<ShiftColor | "none">(schedule.legacyShiftColor ?? (schedule.id ? "none" : "Blue"));
  const [shiftPeriod, setShiftPeriod] = useState<"Day" | "Night">(schedule.legacyShiftPeriod ?? "Day");

  function applyPreset(preset: typeof SCHEDULE_PRESETS[number]) {
    setCycleHours([...preset.hours]);
    setAnchorDate(SCHEDULE_ANCHOR);
    setOverallColor(preset.overallColor);
    setShiftPeriod(preset.period);
    if (!name.trim() || SCHEDULE_PRESETS.some((item) => item.name === name)) setName(preset.name);
  }

  return <form className="modal-form schedule-form" onSubmit={(event) => { event.preventDefault(); void onSave({ departmentId, workGroup, name, legacyShiftColor: overallColor === "none" ? null : overallColor, legacyShiftPeriod: overallColor === "none" ? null : shiftPeriod, active: event.currentTarget.active.checked, effectiveFrom, anchorDate, cycleHours }); }}>
    <p className="modal-copy">A schedule belongs to one department and work group. Saving a later effective date adds a new rule, so prior overtime and PTO remain tied to the schedule that existed then.</p>
    <div className="form-grid">
      <label><span>Department</span><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} disabled={Boolean(schedule.id)} required>{selectableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}{department.active ? "" : " (inactive)"}</option>)}</select></label>
      <label><span>Work group</span><input value={workGroup} onChange={(event) => setWorkGroup(event.target.value)} maxLength={100} placeholder="Blends or Repacks" required /></label>
    </div>
    <label><span>Schedule name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Blue Day, 1st Shift, etc." required /></label>
    <div className="form-grid">
      <label><span>Overall calendar</span><select value={overallColor} onChange={(event) => setOverallColor(event.target.value as ShiftColor | "none")}><option value="Blue">Blue shift</option><option value="Yellow">Yellow shift</option><option value="none">Not tied to Blue/Yellow</option></select><small className="form-help">Use “Not tied” for Monday–Friday and other independent schedules.</small></label>
      {overallColor !== "none" && <label><span>12-hour crew period</span><select value={shiftPeriod} onChange={(event) => setShiftPeriod(event.target.value as "Day" | "Night")}><option value="Day">Day</option><option value="Night">Night</option></select><small className="form-help">Both periods follow the same Blue or Yellow overall calendar.</small></label>}
    </div>
    <div className="schedule-preset-picker"><span>Start from a company pattern</span><div>{SCHEDULE_PRESETS.map((preset) => <button type="button" className={cycleHours.join(",") === preset.hours.join(",") ? "active" : ""} key={preset.id} onClick={() => applyPreset(preset)}>{preset.label}</button>)}</div></div>
    <div className="form-grid">
      <label><span>Rule effective from</span><input type="date" min={schedule.id ? today : undefined} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required /><small className="form-help">Use today or a future date; earlier rules stay unchanged.</small></label>
      <label><span>Cycle starts on</span><input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} required /><small className="form-help">The first box below applies to this date.</small></label>
    </div>
    <section className="schedule-cycle-editor"><div><strong>{cycleHours.length === 14 ? "14-day 2-2-3 rotation" : "7-day weekly pattern"}</strong><button type="button" className="text-button" onClick={() => setCycleHours(cycleHours.length === 14 ? [8, 8, 8, 8, 8, 0, 0] : [12, 12, 0, 0, 12, 12, 12, 0, 0, 12, 12, 0, 0, 0])}>Switch to {cycleHours.length === 14 ? "7 days" : "14 days"}</button></div><div className="cycle-day-grid">{cycleHours.map((dayHours, index) => { const dayDate = addDays(anchorDate, index); return <label className={dayHours > 0 ? "working" : "off"} key={index}><span>{cycleHours.length === 7 ? dateFromInput(dayDate).toLocaleDateString("en-US", { weekday: "short" }) : `Day ${index + 1}`}</span><input aria-label={`Hours for cycle day ${index + 1}`} type="number" min="0" max="24" step="0.25" value={dayHours} onChange={(event) => setCycleHours((current) => current.map((value, dayIndex) => dayIndex === index ? Number(event.target.value) : value))} /><small>{dayHours > 0 ? "hours" : "off"}</small></label>; })}</div></section>
    <label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={schedule.active} /><span>Active schedule</span></label>
    <div className="privacy-note"><strong>12-hour foundation stays intact</strong><span>Blue/Yellow 2-2-3 remains available for every department. Production can separately assign Blends to 12-hour rotations and Repacks to 8-hour weekday shifts.</span></div>
    <button className="primary-button full" disabled={busy || !departmentId || !workGroup.trim() || !name.trim()}>{busy ? "Saving…" : schedule.id ? "Save schedule and effective rule" : "Add department schedule"}</button>
  </form>;
}

function ScheduleDayForm({ date, schedules, departments, overrides, legacyOverrides, busy, onSave }: { date: string; schedules: WorkSchedule[]; departments: Department[]; overrides: WorkScheduleOverride[]; legacyOverrides: Override[]; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const visibleSchedules = schedules.filter((schedule) => schedule.active);
  const [values, setValues] = useState<Record<string, { hours: number; reset: boolean; changed: boolean }>>(() => Object.fromEntries(visibleSchedules.map((schedule) => [schedule.id, { hours: scheduleHoursForDate(schedule, date, overrides, legacyOverrides), reset: false, changed: false }])));
  const [reason, setReason] = useState("");
  const changes = visibleSchedules.flatMap((schedule) => values[schedule.id]?.changed ? [{ scheduleId: schedule.id, hours: values[schedule.id].hours, reset: values[schedule.id].reset }] : []);
  return <form className="modal-form schedule-day-form" onSubmit={(event) => { event.preventDefault(); void onSave({ reason, changes }); }}>
    <p className="modal-copy">Adjust only the department schedules affected on <strong>{prettyDate(date)}</strong>. Set hours to 0 for an off day, or restore the overall Blue/Yellow or M–F plan.</p>
    <div className="schedule-day-list">{visibleSchedules.map((schedule) => { const baseHours = scheduleHoursForDate(schedule, date, [], legacyOverrides); const current = values[schedule.id] ?? { hours: baseHours, reset: false, changed: false }; const savedOverride = overrides.find((item) => item.scheduleId === schedule.id && item.workDate === date); const department = departments.find((item) => item.id === schedule.departmentId); return <article key={schedule.id} className={current.changed ? "changed" : ""}><div><span>{department?.name ?? "Department"}</span><strong>{scheduleLabel(schedule)}</strong><small>Blue/Yellow plan: {baseHours > 0 ? `${baseHours} hrs` : "Off"}{savedOverride ? " · currently adjusted" : ""}</small></div><label><span>Hours</span><input type="number" min="0" max="24" step="0.25" value={current.hours} onChange={(event) => setValues((previous) => ({ ...previous, [schedule.id]: { hours: Number(event.target.value), reset: false, changed: true } }))} /></label><button type="button" className="text-button" disabled={!savedOverride && !current.changed} onClick={() => setValues((previous) => ({ ...previous, [schedule.id]: { hours: baseHours, reset: true, changed: true } }))}>Use plan</button></article>; })}</div>
    <label><span>Reason for the date adjustment</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={250} placeholder="Holiday shutdown, extra production day, etc." /></label>
    <button className="primary-button full" disabled={busy || changes.length === 0}>{busy ? "Saving…" : `Save ${changes.length} schedule change${changes.length === 1 ? "" : "s"}`}</button>
  </form>;
}

function ProfileForm({ profile, departments, schedules, busy, currentUserEmail, localDemo = false, onSave, onDelete }: { profile?: Profile; departments: Department[]; schedules: WorkSchedule[]; busy: boolean; currentUserEmail: string; localDemo?: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [role, setRole] = useState(profile?.role ?? "supervisor");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectableDepartments = departments.filter((department) => department.active || department.id === profile?.departmentId);
  const [departmentId, setDepartmentId] = useState(profile?.departmentId ?? selectableDepartments[0]?.id ?? "");
  const selectableSchedules = schedules.filter((schedule) => (schedule.active || schedule.id === profile?.scheduleId) && schedule.departmentId === departmentId);
  const [scheduleId, setScheduleId] = useState(profile?.scheduleId ?? selectableSchedules[0]?.id ?? "");
  const selectedScheduleId = selectableSchedules.some((schedule) => schedule.id === scheduleId) ? scheduleId : selectableSchedules[0]?.id ?? "";
  const currentUser = profile?.email === currentUserEmail;

  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSave({ fullName: form.get("fullName"), email: form.get("email"), role, departmentId: role === "supervisor" ? departmentId : null, scheduleId: role === "supervisor" ? selectedScheduleId : null, active: form.get("active") === "on" }); }}>
    <label><span>Full name</span><input name="fullName" defaultValue={profile?.fullName ?? ""} maxLength={100} required autoFocus /></label>
    <label><span>Email</span><input type="email" name="email" defaultValue={profile?.email ?? ""} maxLength={160} required /></label>
    <label><span>Role</span><select name="role" value={role} onChange={(event) => setRole(event.target.value as Profile["role"])}><option value="supervisor">Supervisor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label>
    {role === "supervisor" && <>
      <label><span>Supervisor department</span><select name="departmentId" value={departmentId} onChange={(event) => { const nextDepartment = event.target.value; setDepartmentId(nextDepartment); setScheduleId(schedules.find((schedule) => schedule.active && schedule.departmentId === nextDepartment)?.id ?? ""); }} required>{selectableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}{department.active ? "" : " (inactive)"}</option>)}</select></label>
      <label><span>Supervisor work group / schedule</span><select name="scheduleId" value={selectedScheduleId} onChange={(event) => setScheduleId(event.target.value)} required><option value="" disabled>Select a configured schedule</option>{selectableSchedules.map((schedule) => <option key={schedule.id} value={schedule.id}>{scheduleLabel(schedule)}{schedule.active ? "" : " (inactive)"}</option>)}</select></label>
      <small className="form-help">A supervisor can update only employees in this department and schedule.</small>
    </>}
    <label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={profile?.active ?? true} /><span>Active account</span></label>
    <div className="privacy-note"><strong>{localDemo ? "Fake demo access only" : profile ? "Email updates replace this selected record" : "Supabase Authentication is still required"}</strong><span>{localDemo ? "This sample profile is saved only in this browser and cannot sign in to the live tracker." : profile ? "Changing this email will not create a duplicate tracker profile. The user's Supabase Authentication email must also match before they can sign in." : "Create or invite the matching Supabase Authentication user with this exact email."}</span></div>
    {confirmDelete && <div className="delete-confirm"><strong>Delete tracker access for {profile?.fullName}?</strong><span>This removes the approved tracker profile and records the deletion in Audit history. It does not delete the person's Supabase Authentication account.</span><div className="button-row"><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="danger-button" disabled={busy} onClick={() => void onDelete?.()}>{busy ? "Deleting…" : "Confirm delete"}</button></div></div>}
    {!confirmDelete && <div className="button-row">{profile && onDelete && <button type="button" className="danger-button" disabled={busy || currentUser} title={currentUser ? "You cannot delete the account currently signed in." : undefined} onClick={() => setConfirmDelete(true)}>Delete user access</button>}<button className="primary-button" disabled={busy || (role === "supervisor" && (!selectableDepartments.length || !selectedScheduleId))}>{busy ? "Saving…" : profile ? "Update user" : "Add person"}</button></div>}
    {currentUser && <small className="form-help">Your currently signed-in administrator account cannot be deleted from its own session.</small>}
  </form>;
}

function normalizeDateValue(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return trimmed;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim()); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += character;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
  const headers = rows[0].map((header) => header.toLowerCase().replaceAll(" ", "_"));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function downloadImportTemplate(kind: ImportKind) {
  const csv = kind === "employees"
    ? "name,department,schedule,active\nEmployee One,Production,Blends · Blue Day,true\nEmployee Two,Production,Repacks · 1st Shift,true\n"
    : "type,date,employee_name,hours,department,code_or_type,reason,notes\nOT,2026-06-15,Employee One,12,Production,PRD-100,Production Needs,Weekend coverage\nPTO,2026-07-02,Employee One,12,,Vacation,,Approved vacation\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = kind === "employees" ? "employee-import-template.csv" : "history-import-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function ImportForm({ kind, busy, localDemo = false, onImport }: { kind: ImportKind; busy: boolean; localDemo?: boolean; onImport: (rows: Array<Record<string, unknown>>) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const employeeImport = kind === "employees";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setFileError("Choose a CSV file first."); return; }
    if (file.size > 2_000_000) { setFileError("Keep the CSV under 2 MB."); return; }
    try {
      const parsed = parseCsv(await file.text());
      const rows = employeeImport
        ? parsed.map((row) => ({ name: row.name, schedule: row.schedule, shiftColor: row.shift_color?.toLowerCase() === "yellow" ? "Yellow" : row.shift_color?.toLowerCase() === "blue" ? "Blue" : row.shift_color, shiftPeriod: row.shift_period?.toLowerCase() === "night" ? "Night" : row.shift_period?.toLowerCase() === "day" ? "Day" : row.shift_period, department: row.department, active: !["false", "no", "0", "inactive"].includes((row.active || "true").toLowerCase()) }))
        : parsed.map((row) => ({ type: row.type?.toUpperCase(), date: normalizeDateValue(row.date || ""), employeeName: row.employee_name, hours: row.hours, department: row.department || "", codeOrType: row.code_or_type, reason: row.reason || "", notes: row.notes || "" }));
      setFileError("");
      await onImport(rows);
    } catch (importError) {
      setFileError(importError instanceof Error ? importError.message : "The CSV could not be read.");
    }
  }

  return <form className="modal-form import-form" onSubmit={(event) => void submit(event)}><p className="modal-copy">{employeeImport ? "Department and schedule names must already exist in Company Setup. Existing employees with the same name are updated instead of duplicated." : "Import overtime and PTO after the roster is loaded. Employee and department names must match exactly; schedule rules are checked before importing each date."}</p><div className="template-box"><div><strong>Use the import template</strong><span>{employeeImport ? "Columns: name, department, schedule, active" : "Columns: type, date, employee_name, hours, department, code_or_type, reason, notes"}</span></div><button type="button" className="secondary-button" onClick={() => downloadImportTemplate(kind)}>Download template</button></div><label className="file-picker"><span>Completed CSV file</span><input type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setFileError(""); }} /></label>{fileError && <div className="field-error">{fileError}</div>}<div className="privacy-note"><strong>{localDemo ? "Use fake data in the demo" : "Company data reminder"}</strong><span>{localDemo ? "This import remains in your browser, but sample information is still best for a public preview." : "Only import real employee or PTO information after your company has approved this private pilot."}</span></div><button className="primary-button full" disabled={busy || !file}>{busy ? "Importing…" : employeeImport ? "Import employees" : "Import historical records"}</button></form>;
}

function OverrideForm({ date, current, override, busy, onSave, onRemove }: { date: string; current: ShiftColor; override?: Override; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onRemove: () => Promise<void> }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSave({ shiftColor: form.get("shiftColor"), reason: form.get("reason") }); }}><p className="modal-copy">Change the overall 12-hour working color for <strong>{prettyDate(date)}</strong>. Dashboard, calendar, OT availability, and smart PTO will follow this correction; Monday–Friday schedules stay on their own pattern.</p><label><span>Overall working color</span><select name="shiftColor" defaultValue={current}><option>Blue</option><option>Yellow</option></select></label><label><span>Reason</span><textarea name="reason" rows={3} defaultValue={override?.reason} placeholder="Calendar correction, holiday adjustment, etc." /></label><div className="button-row">{override && <button type="button" className="danger-button" disabled={busy} onClick={() => void onRemove()}>Remove correction</button>}<button className="primary-button" disabled={busy}>Save Blue/Yellow correction</button></div></form>;
}

function EntryTable({ title, entries, canChange, onEdit, onDelete }: { title: string; entries: Array<{ id: string; name: string; detail: string; subdetail?: string; hours: number; notes: string }>; canChange: boolean; onEdit?: (id: string) => void; onDelete: (id: string) => void }) {
  return <section className="panel table-panel"><div className="panel-head padded"><h2>{title}</h2><span className="subtle-count">{entries.length} entries · {entries.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)} hrs</span></div>{entries.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department / code</th><th>Reason / type</th><th>Hours</th><th>Notes</th>{canChange && <th />}</tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><strong>{entry.name}</strong></td><td>{entry.detail}</td><td>{entry.subdetail || "—"}</td><td>{entry.hours}</td><td className="notes-cell">{entry.notes || "—"}</td>{canChange && <td><div className="row-actions">{onEdit && <button className="text-button" onClick={() => onEdit(entry.id)}>Edit</button>}<button className="delete-link" onClick={() => onDelete(entry.id)}>Remove</button></div></td>}</tr>)}</tbody></table></div> : <EmptyState title="Nothing entered for this date" body="Use the employee roster above to add an entry." />}</section>;
}

function WeekOverview({ dates, selectedDate, setSelectedDate, entries, data }: { dates: string[]; selectedDate: string; setSelectedDate: (value: string) => void; entries: OvertimeEntry[]; data: TrackerBundle }) {
  return <section className="week-overview" aria-label="Overtime week">{dates.map((date) => { const daily = entries.filter((entry) => entry.workDate === date); const color = shiftForDate(date, data.scheduleOverrides); const scheduled = data.employees.filter((employee) => employee.active && scheduledHours(data, employee, date) > 0); return <button key={date} className={`${date === selectedDate ? "active" : ""} ${color.toLowerCase()}`} onClick={() => setSelectedDate(date)}><span>{dateFromInput(date).toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{dateFromInput(date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong><small>{color} working · {scheduled.length} total scheduled</small><b>{daily.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)} OT hrs · {daily.length} entries</b></button>; })}</section>;
}

function CalendarView({ monthValue, setMonthValue, data, onSelect }: { monthValue: string; setMonthValue: (value: string) => void; data: TrackerBundle; onSelect: (date: string) => void }) {
  const focus = dateFromInput(monthValue);
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return date; });
  const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const today = toDateInput(new Date());
  const ptoCounts = data.ptoEntries.reduce((counts, entry) => counts.set(entry.ptoDate, (counts.get(entry.ptoDate) ?? 0) + 1), new Map<string, number>());
  function moveMonth(amount: number) { setMonthValue(toDateInput(new Date(first.getFullYear(), first.getMonth() + amount, 1))); }
  return <><div className="page-heading"><div><p className="eyebrow">Automatic Blue/Yellow rotation</p><h1>Shift Calendar</h1><span>Blue/Yellow drives the overall calendar. Each square shows only PTO headcount; open a date for overtime and full day details.</span></div><div className="month-controls"><button onClick={() => moveMonth(-1)}>‹</button><strong>{title}</strong><button onClick={() => moveMonth(1)}>›</button></div></div><section className="calendar-panel"><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((date) => { const dateValue = toDateInput(date); const color = shiftForDate(dateValue, data.scheduleOverrides); const colorOverride = data.scheduleOverrides.find((item) => item.workDate === dateValue); const scheduleAdjusted = data.workScheduleOverrides.some((item) => item.workDate === dateValue); const outside = date.getMonth() !== first.getMonth(); const isToday = dateValue === today; const ptoCount = ptoCounts.get(dateValue) ?? 0; return <button key={dateValue} className={`calendar-day ${color.toLowerCase()} ${outside ? "outside" : ""} ${isToday ? "today" : ""}`} onClick={() => onSelect(dateValue)} aria-label={`Open details for ${prettyDate(dateValue)} · ${color} shift · ${ptoCount} ${ptoCount === 1 ? "person" : "people"} on PTO`} aria-current={isToday ? "date" : undefined}><span>{date.getDate()}</span><ShiftBadge color={color} compact />{ptoCount > 0 && <small className="calendar-pto-count">{ptoCount} on PTO</small>}{(colorOverride || scheduleAdjusted) && <em title={colorOverride?.reason || "Department schedule adjustment"}>{colorOverride ? "Corrected" : "Adjusted"}</em>}</button>; })}</div></section><UpcomingPtoMonth monthValue={monthValue} data={data} /></>;
}

function UpcomingPtoMonth({ monthValue, data }: { monthValue: string; data: TrackerBundle }) {
  const { start, end } = currentMonthRange(monthValue);
  const today = toDateInput(new Date());
  const upcomingStart = start > today ? start : today;
  const employeesById = new Map(data.employees.map((employee) => [employee.id, employee]));
  const entries = data.ptoEntries
    .filter((entry) => entry.ptoDate >= upcomingStart && entry.ptoDate <= end)
    .sort((a, b) => a.ptoDate.localeCompare(b.ptoDate) || (employeesById.get(a.employeeId)?.name ?? "").localeCompare(employeesById.get(b.employeeId)?.name ?? ""));
  const dateGroups = Array.from(entries.reduce((groups, entry) => {
    groups.set(entry.ptoDate, [...(groups.get(entry.ptoDate) ?? []), entry]);
    return groups;
  }, new Map<string, PtoEntry[]>()));
  const peopleCount = new Set(entries.map((entry) => entry.employeeId)).size;
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);
  const monthLabel = dateFromInput(start).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const rangeLabel = end < today ? "Past month · upcoming dates only" : start > today ? "All dates in the selected month" : "Today forward in the selected month";
  const emptyMessage = end < today ? `${monthLabel} has already ended.` : start > today ? `Nothing is scheduled in ${monthLabel}.` : `Nothing is scheduled from today through the end of ${monthLabel}.`;

  return <details className="calendar-upcoming-pto">
    <summary>
      <div><span>Quick glance</span><strong>Upcoming PTO · {monthLabel}</strong><small>{rangeLabel}</small></div>
      <div className="upcoming-pto-totals"><strong>{peopleCount} {peopleCount === 1 ? "person" : "people"}</strong><span>{entries.length} {entries.length === 1 ? "entry" : "entries"} · {totalHours.toFixed(1)} hrs</span></div>
    </summary>
    <div className="upcoming-pto-body">
      {dateGroups.length ? dateGroups.map(([date, dayEntries]) => <section className="upcoming-pto-date" key={date}>
        <header><div><span>{dateFromInput(date).toLocaleDateString("en-US", { weekday: "long" })}</span><strong>{dateFromInput(date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong></div><b>{dayEntries.length} on PTO</b></header>
        <div>{dayEntries.map((entry) => { const employee = employeesById.get(entry.employeeId); return <article key={entry.id}><span className="avatar">{initials(employee?.name ?? "Unknown")}</span><div><strong>{employee?.name ?? "Unknown employee"}</strong><small>{employee?.department ?? "No department"} · {entry.scheduleName || employee?.scheduleName || "Schedule unavailable"}</small></div><span className="pto-type-pill">{entry.ptoType}</span><b>{entry.hours.toFixed(1)} hrs</b></article>; })}</div>
      </section>) : <div className="upcoming-pto-empty"><strong>No upcoming PTO</strong><span>{emptyMessage}</span></div>}
    </div>
  </details>;
}

function CalendarDaySnapshot({ date, data, isAdmin, onCorrectShift, onAdjustSchedules, onSeeWhoWorked }: { date: string; data: TrackerBundle; isAdmin: boolean; onCorrectShift: () => void; onAdjustSchedules?: () => void; onSeeWhoWorked: () => void }) {
  const workingColor = shiftForDate(date, data.scheduleOverrides);
  const dayOvertime = data.overtimeEntries.filter((entry) => entry.workDate === date);
  const dayPto = data.ptoEntries.filter((entry) => entry.ptoDate === date);
  const employeesById = new Map(data.employees.map((employee) => [employee.id, employee]));
  const overtimeHours = dayOvertime.reduce((sum, entry) => sum + entry.hours, 0);
  const ptoHours = dayPto.reduce((sum, entry) => sum + entry.hours, 0);
  const overtimePeople = new Set(dayOvertime.map((entry) => entry.employeeId)).size;
  const scheduleSummaries = data.workSchedules.filter((schedule) => schedule.active).map((schedule) => {
    const people = data.employees.filter((employee) => employee.active && employee.scheduleId === schedule.id && scheduledHours(data, employee, date) > 0);
    return { schedule, people, hours: scheduleHoursForDate(schedule, date, data.workScheduleOverrides, data.scheduleOverrides) };
  }).filter((item) => item.people.length > 0);
  const blueYellowPeople = data.employees.filter((employee) => employee.active && overallShiftColorForEmployee(data, employee) === workingColor && scheduledHours(data, employee, date) > 0).length;

  return <div className="day-snapshot">
    <div className={`day-snapshot-banner ${workingColor.toLowerCase()}`}>
      <div><ShiftBadge color={workingColor} /><div><strong>{workingColor} crews scheduled</strong><span>{blueYellowPeople} 12-hour employees · {prettyDate(date)}</span></div></div>
      <div className="snapshot-actions"><button className="primary-button" onClick={onSeeWhoWorked}>See who worked</button>{isAdmin && <button className="secondary-button" onClick={onCorrectShift}>Correct Blue/Yellow shift</button>}{isAdmin && onAdjustSchedules && <button className="secondary-button" onClick={onAdjustSchedules}>Adjust department schedules</button>}</div>
    </div>
    <section className="day-schedule-summary" aria-label="Scheduled work groups">{scheduleSummaries.length ? scheduleSummaries.map(({ schedule, people, hours }) => <div key={schedule.id}><span>{data.departments.find((department) => department.id === schedule.departmentId)?.name}</span><strong>{scheduleLabel(schedule)}</strong><small>{people.length} people · {hours} hrs each</small></div>) : <EmptyState title="No regular shifts scheduled" body="Only recorded overtime, if any, is expected on this date." />}</section>
    <section className="snapshot-summary activity-only" aria-label="Day totals">
      <div><span>PTO recorded</span><strong>{ptoHours.toFixed(1)} <small>hrs</small></strong><small>{dayPto.length} entries</small></div>
      <div><span>Overtime coverage</span><strong>{overtimeHours.toFixed(1)} <small>hrs</small></strong><small>{overtimePeople} employees</small></div>
    </section>
    <div className="snapshot-activity-grid">
      <section className="snapshot-section">
        <div className="snapshot-section-head"><div><p className="eyebrow">Added coverage</p><h3>Overtime worked</h3></div><span>{dayOvertime.length} entries</span></div>
        {dayOvertime.length ? <div className="day-activity-list">{dayOvertime.map((entry) => <div className="day-activity-row" key={entry.id}><span className="avatar">{initials(entry.employeeName)}</span><div><strong>{entry.employeeName}</strong><small>{entry.departmentName} · {entry.costCode}</small><small>{entry.reason}{entry.notes ? ` · ${entry.notes}` : ""}</small></div><b>{entry.hours.toFixed(1)} hrs</b></div>)}</div> : <EmptyState title="No overtime recorded" body="Overtime coverage for this date will appear here." />}
      </section>
      <section className="snapshot-section">
        <div className="snapshot-section-head"><div><p className="eyebrow">Time away</p><h3>PTO recorded</h3></div><span>{dayPto.length} entries</span></div>
        {dayPto.length ? <div className="day-activity-list">{dayPto.map((entry) => { const employee = employeesById.get(entry.employeeId); return <div className="day-activity-row" key={entry.id}><span className="avatar">{initials(employee?.name ?? "Unknown")}</span><div><strong>{employee?.name ?? "Unknown"}</strong><small>{employee?.department ?? "No department"} · {entry.ptoType}</small><small>{entry.notes || entry.scheduleName || employee?.scheduleName || "No notes"}</small></div><b>{entry.hours.toFixed(1)} hrs</b></div>; })}</div> : <EmptyState title="No PTO recorded" body="PTO for this date will appear here." />}
      </section>
    </div>
  </div>;
}

function CalendarWorkedSnapshot({ date, data, onBack }: { date: string; data: TrackerBundle; onBack: () => void }) {
  const workingColor = shiftForDate(date, data.scheduleOverrides);
  const dayPtoIds = new Set(data.ptoEntries.filter((entry) => entry.ptoDate === date).map((entry) => entry.employeeId));
  const dayOvertime = data.overtimeEntries.filter((entry) => entry.workDate === date);
  const overtimeHours = dayOvertime.reduce((map, entry) => map.set(entry.employeeId, (map.get(entry.employeeId) ?? 0) + entry.hours), new Map<string, number>());
  const employeesById = new Map(data.employees.map((employee) => [employee.id, employee]));
  const working = new Map<string, { employee: Employee; source: "Scheduled" | "Overtime"; hours: number }>();
  data.employees.filter((employee) => employee.active && scheduledHours(data, employee, date) > 0 && !dayPtoIds.has(employee.id)).forEach((employee) => working.set(employee.id, { employee, source: "Scheduled", hours: scheduledHours(data, employee, date) }));
  dayOvertime.forEach((entry) => { const employee = employeesById.get(entry.employeeId); if (employee) working.set(employee.id, { employee, source: "Overtime", hours: overtimeHours.get(employee.id) ?? entry.hours }); });

  const positionsById = new Map<string, CrewPosition>(data.crewPositions.map((position) => [position.id, position]));
  const systemsById = new Map<string, CrewSystem>(data.crewSystems.map((system) => [system.id, system]));
  const departmentsById = new Map(data.departments.map((department) => [department.id, department]));
  const groups = new Map<string, { name: string; department: string; sortOrder: number; people: Array<{ employee: Employee; position: string; source: "Scheduled" | "Overtime"; hours: number; positionOrder: number }> }>();

  for (const item of working.values()) {
    const positionId = crewPositionAtEndOfDay(item.employee.id, date, data.crewPlacements, data.crewPlacementHistory);
    const position = positionId ? positionsById.get(positionId) : undefined;
    const system = position ? systemsById.get(position.systemId) : undefined;
    const groupKey = system?.id ?? `not-placed-${item.employee.departmentId}`;
    const group = groups.get(groupKey) ?? { name: system?.name ?? "Not placed", department: system ? departmentsById.get(system.departmentId)?.name ?? item.employee.department : item.employee.department, sortOrder: system?.sortOrder ?? Number.MAX_SAFE_INTEGER, people: [] };
    group.people.push({ ...item, position: position?.name ?? "No saved position", positionOrder: position?.sortOrder ?? Number.MAX_SAFE_INTEGER });
    groups.set(groupKey, group);
  }

  const orderedGroups = Array.from(groups.values()).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  orderedGroups.forEach((group) => group.people.sort((a, b) => a.positionOrder - b.positionOrder || a.employee.name.localeCompare(b.employee.name)));

  return <div className="worked-snapshot">
    <div className="worked-toolbar"><button className="secondary-button" onClick={onBack}>← Back to daily OT & PTO</button><div><strong>{working.size} people shown · {workingColor} overall shift</strong><span>All scheduled employees with PTO removed, including 8-hour weekday staff, plus recorded overtime.</span></div></div>
    {!data.crewPlacementReady && <div className="snapshot-note">Crew placement storage is not active, so employees cannot be grouped by system.</div>}
    {orderedGroups.length ? <div className="worked-system-grid">{orderedGroups.map((group) => <section className="snapshot-section worked-system" key={`${group.department}-${group.name}`}><div className="snapshot-section-head"><div><p className="eyebrow">{group.department}</p><h3>{group.name}</h3></div><span>{group.people.length} people</span></div><div className="worked-person-list">{group.people.map(({ employee, position, source, hours }) => <div className="worked-person-row" key={employee.id}><div className="day-person"><span className="avatar">{initials(employee.name)}</span><div><strong>{employee.name}</strong><small>{employee.scheduleName}</small></div></div><div className={`day-location ${position === "No saved position" ? "missing" : ""}`}><span>Position</span><strong>{position}</strong></div><span className={`day-status ${source === "Overtime" ? "overtime" : "working"}`}>{source === "Overtime" ? `OT · ${hours.toFixed(1)} hrs` : `Scheduled · ${hours.toFixed(1)} hrs`}</span></div>)}</div></section>)}</div> : <EmptyState title="No one to show" body="No scheduled employees without PTO or recorded overtime were found for this date." />}
  </div>;
}

function ReportTable({ overtime, pto, employeesById }: { overtime: OvertimeEntry[]; pto: PtoEntry[]; employeesById: Map<string, Employee> }) {
  const [rowLimit, setRowLimit] = useState(10);
  const rows = new Map<string, { id: string; name: string; department: string; shift: string; otHours: number; otCount: number; ptoHours: number; ptoCount: number }>();
  for (const entry of overtime) {
    const current = rows.get(entry.employeeId) ?? { id: entry.employeeId, name: entry.employeeName, department: entry.departmentName, shift: entry.shiftName, otHours: 0, otCount: 0, ptoHours: 0, ptoCount: 0 };
    current.otHours += entry.hours; current.otCount += 1; rows.set(entry.employeeId, current);
  }
  for (const entry of pto) {
    const employee = employeesById.get(entry.employeeId);
    const current = rows.get(entry.employeeId) ?? { id: entry.employeeId, name: employee?.name || "Unknown", department: employee?.department || "Unknown", shift: entry.scheduleName || employee?.scheduleName || "Unknown", otHours: 0, otCount: 0, ptoHours: 0, ptoCount: 0 };
    current.ptoHours += entry.hours; current.ptoCount += 1; rows.set(entry.employeeId, current);
  }
  const sorted = Array.from(rows.values()).sort((a, b) => b.otHours - a.otHours || a.name.localeCompare(b.name));
  const displayedRows = sorted.slice(0, rowLimit);
  return <section className="panel table-panel"><div className="panel-head padded"><div><p className="eyebrow">Summary</p><h2>Hours by employee</h2></div><RosterLimitControl total={sorted.length} value={rowLimit} onChange={setRowLimit} ariaLabel="Employee summaries shown" /></div>{sorted.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Shift</th><th>OT hours</th><th>OT entries</th><th>PTO hours</th><th>PTO entries</th></tr></thead><tbody>{displayedRows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.department}</td><td>{row.shift}</td><td><strong>{row.otHours.toFixed(1)}</strong></td><td>{row.otCount}</td><td>{row.ptoHours.toFixed(1)}</td><td>{row.ptoCount}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Totals</td><td>{sorted.reduce((sum, row) => sum + row.otHours, 0).toFixed(1)}</td><td>{sorted.reduce((sum, row) => sum + row.otCount, 0)}</td><td>{sorted.reduce((sum, row) => sum + row.ptoHours, 0).toFixed(1)}</td><td>{sorted.reduce((sum, row) => sum + row.ptoCount, 0)}</td></tr></tfoot></table></div> : <EmptyState title="No records match" body="Adjust the report filters to include more activity." />}</section>;
}

function OvertimeDetailTable({ entries }: { entries: OvertimeEntry[] }) {
  const [rowLimit, setRowLimit] = useState(10);
  const displayedEntries = entries.slice(0, rowLimit);
  return <section className="panel table-panel"><div className="panel-head padded"><div><p className="eyebrow">Detail</p><h2>Overtime records</h2></div><RosterLimitControl total={entries.length} value={rowLimit} onChange={setRowLimit} ariaLabel="Overtime records shown" /></div>{entries.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Shift</th><th>Cost code</th><th>Reason</th><th>Hours</th><th>Notes</th></tr></thead><tbody>{displayedEntries.map((entry) => <tr key={entry.id}><td>{prettyDate(entry.workDate, true)}</td><td><strong>{entry.employeeName}</strong></td><td>{entry.departmentName}</td><td>{entry.shiftName}</td><td>{entry.costCode}</td><td>{entry.reason}</td><td><strong>{entry.hours.toFixed(1)}</strong></td><td className="notes-cell">{entry.notes || "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="No overtime matches" body="Department, cost code, reason, and date filters apply here." />}</section>;
}

function PtoDetailTable({ entries, employeesById }: { entries: PtoEntry[]; employeesById: Map<string, Employee> }) {
  const [rowLimit, setRowLimit] = useState(10);
  const displayedEntries = entries.slice(0, rowLimit);
  return <section className="panel table-panel"><div className="panel-head padded"><div><p className="eyebrow">Detail</p><h2>PTO records</h2></div><RosterLimitControl total={entries.length} value={rowLimit} onChange={setRowLimit} ariaLabel="PTO records shown" /></div>{entries.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Schedule</th><th>PTO type</th><th>Hours</th><th>Notes</th></tr></thead><tbody>{displayedEntries.map((entry) => { const employee = employeesById.get(entry.employeeId); return <tr key={entry.id}><td>{prettyDate(entry.ptoDate, true)}</td><td><strong>{employee?.name || "Unknown"}</strong></td><td>{employee?.department || "No department"}</td><td>{entry.scheduleName || employee?.scheduleName || "Unknown"}</td><td>{entry.ptoType}</td><td><strong>{entry.hours.toFixed(1)}</strong></td><td className="notes-cell">{entry.notes || "—"}</td></tr>; })}</tbody></table></div> : <EmptyState title="No PTO matches" body="Employee, department, schedule, and date filters apply here." />}</section>;
}
