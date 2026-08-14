import { useEffect, useMemo, useState } from "react";
import { shiftForDate, toDateInput, type ShiftColor } from "./lib/schedule";
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
  type OvertimeEntry,
  type Override,
  type Profile,
  type PtoEntry,
  type TrackerBundle,
} from "./lib/tracker-api";

type Tab = "dashboard" | "overtime" | "pto" | "employees" | "calendar" | "reports" | "settings" | "companySetup" | "admin";
type ColorMode = "light" | "dark" | "system";
type ImportKind = "employees" | "history";
type OvertimeEditor = { employee: Employee; entry?: OvertimeEntry };

const DASHBOARD_WIDGET_CATALOG: Array<{ id: DashboardWidgetId; label: string; description: string; category: string; defaultSize: DashboardWidgetSize }> = [
  { id: "shift_today", label: "Scheduled shift", description: "Working color and scheduled headcount for the selected date.", category: "Schedule", defaultSize: "wide" },
  { id: "kpi_ot", label: "Monthly overtime", description: "Total overtime hours and entries for the selected month.", category: "Key metrics", defaultSize: "compact" },
  { id: "kpi_pto", label: "Monthly PTO", description: "Total PTO hours and entries for the selected month.", category: "Key metrics", defaultSize: "compact" },
  { id: "kpi_employees", label: "Active employees", description: "Active employee and department counts.", category: "Key metrics", defaultSize: "compact" },
  { id: "kpi_ot_people", label: "Employees with OT", description: "Unique employees receiving overtime this month.", category: "Key metrics", defaultSize: "compact" },
  { id: "ot_trend", label: "Six-month OT trend", description: "Monthly overtime trend across the last six months.", category: "Charts", defaultSize: "wide" },
  { id: "department_ot", label: "OT by department", description: "Overtime distribution across departments this month.", category: "Charts", defaultSize: "standard" },
  { id: "shift_ot", label: "OT by shift", description: "Monthly overtime split between all four crews.", category: "Charts", defaultSize: "standard" },
  { id: "reason_ot", label: "OT by reason", description: "Why overtime was assigned during the month.", category: "Charts", defaultSize: "standard" },
  { id: "cost_code_ot", label: "OT by cost code", description: "Monthly hours summarized by cost code.", category: "Charts", defaultSize: "standard" },
  { id: "pto_type", label: "PTO by type", description: "Monthly PTO hours summarized by PTO type.", category: "Charts", defaultSize: "standard" },
  { id: "staffing_department", label: "Staffing by department", description: "Active headcount across company departments.", category: "Workforce", defaultSize: "standard" },
  { id: "staffing_crew", label: "Staffing by crew", description: "Active headcount across Blue and Yellow day/night crews.", category: "Workforce", defaultSize: "standard" },
  { id: "schedule", label: "Next 14 days", description: "Two-week Blue and Yellow schedule forecast.", category: "Schedule", defaultSize: "wide" },
  { id: "selected_ot", label: "OT on selected date", description: "Employee-level overtime details for the selected date.", category: "Daily details", defaultSize: "standard" },
  { id: "selected_pto", label: "PTO on selected date", description: "Employee-level PTO details for the selected date.", category: "Daily details", defaultSize: "standard" },
];

const NAV: Array<{ id: Tab; code: string; label: string }> = [
  { id: "dashboard", code: "DB", label: "Dashboard" },
  { id: "overtime", code: "OT", label: "Overtime Entry" },
  { id: "pto", code: "PT", label: "PTO Tracking" },
  { id: "employees", code: "EM", label: "Employees" },
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

export default function TrackerApp({ onSignOut }: { onSignOut: () => Promise<unknown> }) {
  const [data, setData] = useState<TrackerBundle | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => toDateInput(new Date()));
  const [overtimeEditor, setOvertimeEditor] = useState<OvertimeEditor | null>(null);
  const [ptoEmployee, setPtoEmployee] = useState<Employee | null>(null);
  const [overrideDate, setOverrideDate] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);
  const [customizingDashboard, setCustomizingDashboard] = useState(false);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterDepartment, setRosterDepartment] = useState("all");
  const [rosterColor, setRosterColor] = useState<"all" | ShiftColor>("all");
  const [rosterPeriod, setRosterPeriod] = useState("all");
  const [assignmentDefaultsApplied, setAssignmentDefaultsApplied] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeDepartment, setEmployeeDepartment] = useState("all");
  const [employeeColor, setEmployeeColor] = useState<"all" | ShiftColor>("all");
  const [employeePeriod, setEmployeePeriod] = useState("all");
  const [employeeStatus, setEmployeeStatus] = useState<"all" | "active" | "inactive">("active");
  const [reportStart, setReportStart] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [reportEnd, setReportEnd] = useState(() => `${new Date().getFullYear()}-12-31`);
  const [reportEmployee, setReportEmployee] = useState("all");
  const [reportDepartment, setReportDepartment] = useState("all");
  const [reportShift, setReportShift] = useState("all");
  const [reportCostCode, setReportCostCode] = useState("all");
  const [reportReason, setReportReason] = useState("all");

  async function load() {
    try {
      setError("");
      setData(await loadBundle());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load tracker data.");
    }
  }

  useEffect(() => {
    let active = true;
    void loadBundle()
      .then((body) => { if (active) setData(body); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load tracker data.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!assignmentDefaultsApplied && data?.session.role === "supervisor") {
      if (data.session.departmentId) setRosterDepartment(data.session.departmentId);
      if (data.session.shiftColor) setRosterColor(data.session.shiftColor);
      if (data.session.shiftPeriod) setRosterPeriod(data.session.shiftPeriod);
      setAssignmentDefaultsApplied(true);
    }
  }, [assignmentDefaultsApplied, data]);

  async function mutate(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await mutateTracker(payload));
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
    const matchesColor = rosterColor === "all" || employee.shiftColor === rosterColor;
    const matchesPeriod = rosterPeriod === "all" || employee.shiftPeriod === rosterPeriod;
    const query = rosterSearch.trim().toLowerCase();
    return matchesDepartment && matchesColor && matchesPeriod && (!query || employee.name.toLowerCase().includes(query));
  });
  const filteredEmployees = data.employees.filter((employee) => {
    const query = employeeSearch.trim().toLowerCase();
    const matchesSearch = !query || employee.name.toLowerCase().includes(query);
    const matchesDepartment = employeeDepartment === "all" || employee.departmentId === employeeDepartment;
    const matchesColor = employeeColor === "all" || employee.shiftColor === employeeColor;
    const matchesPeriod = employeePeriod === "all" || employee.shiftPeriod === employeePeriod;
    const matchesStatus = employeeStatus === "all" || (employeeStatus === "active" ? employee.active : !employee.active);
    return matchesSearch && matchesDepartment && matchesColor && matchesPeriod && matchesStatus;
  });
  const costCodes = Array.from(new Set(data.overtimeEntries.map((entry) => entry.costCode))).sort();
  const reasons = Array.from(new Set(data.overtimeEntries.map((entry) => entry.reason))).sort();
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
    if (reportShift !== "all" && `${employee?.shiftColor} ${employee?.shiftPeriod}` !== reportShift) return false;
    return true;
  });
  function downloadReport() {
    const rows = [
      ["type", "date", "employee_name", "hours", "department", "cost_code_or_pto_type", "reason", "notes", "shift", "entered_by"],
      ...filteredOt.map((entry) => ["OT", entry.workDate, entry.employeeName, entry.hours, entry.departmentName, entry.costCode, entry.reason, entry.notes, entry.shiftName, entry.enteredBy]),
      ...filteredPto.map((entry) => {
        const employee = employeesById.get(entry.employeeId);
        return ["PTO", entry.ptoDate, employee?.name || "Unknown", entry.hours, employee?.department || "", entry.ptoType, "", entry.notes, employee ? `${employee.shiftColor} ${employee.shiftPeriod}` : "", entry.enteredBy];
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

  const emptyEmployee: Employee = {
    id: "",
    name: "",
    shiftColor: "Blue",
    shiftPeriod: "Day",
    departmentId: activeDepartments[0]?.id ?? "",
    department: activeDepartments[0]?.name ?? "",
    active: true,
  };

  return (
    <div className={`app-shell theme-${resolvedColorMode}`}>
      <header className="topbar">
        <div className="brand"><div className="brand-box">OT</div><div><strong>Overtime & PTO</strong><span>Company operations tracker · Supabase</span></div></div>
        <div className="account"><span className="status-dot" /><div><strong>{data.session.fullName}</strong><span>{data.session.role}{data.session.role === "supervisor" ? ` · ${data.departments.find((department) => department.id === data.session.departmentId)?.name ?? "Unassigned"} · ${data.session.shiftColor ?? "Unassigned"} ${data.session.shiftPeriod ?? ""}`.trimEnd() : ""}</span></div><button className="signout-button" onClick={() => void onSignOut()}>Sign out</button></div>
      </header>

      <nav className="main-nav" aria-label="Tracker pages">
        {visibleNav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><span>{item.code}</span>{item.label}</button>)}
      </nav>

      <main className="content">
        {(error || notice) && <div className={`alert ${error ? "error" : "success"}`}><span>{error ? "!" : "✓"}</span>{error || notice}<button onClick={() => { setError(""); setNotice(""); }}>×</button></div>}

        {tab === "dashboard" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Your operations workspace</p><h1>Dashboard</h1><span>{prettyDate(selectedDate)} · {data.dashboardPersistenceReady ? `Saved personally for ${data.session.fullName}` : "Using the company default layout"}</span></div><div className="dashboard-heading-actions"><label className="date-control"><span>View date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label><button className="secondary-button" disabled={!data.dashboardPersistenceReady} title={data.dashboardPersistenceReady ? undefined : "Personal dashboard storage is still being configured."} onClick={() => setCustomizingDashboard(true)}>{data.dashboardPersistenceReady ? "Customize dashboard" : "Default dashboard active"}</button></div></div>
            {!activeEmployees.length && <section className="setup-banner"><div><span className="setup-number">1</span><div><strong>Your tracker is clean and ready</strong><span>Confirm departments, then add employees individually or import the complete roster.</span></div></div><div className="button-row">{isAdmin && <button className="secondary-button" onClick={() => setTab("companySetup")}>Review departments</button>}<button className="primary-button" onClick={() => setTab("employees")}>Add employees</button></div></section>}
            {data.dashboardWidgets.length ? <section className="dashboard-widget-grid">{data.dashboardWidgets.map((widget) => <DashboardWidgetView key={widget.id} widget={widget} data={data} selectedDate={selectedDate} workingColor={workingColor} activeEmployees={activeEmployees} activeDepartments={activeDepartments} monthOt={monthOt} monthPto={monthPto} selectedOt={selectedOt} selectedPto={selectedPto} employeesById={employeesById} onNavigate={setTab} />)}</section> : <section className="panel dashboard-empty"><EmptyState title="Your dashboard is empty" body="Choose Customize dashboard to add the metrics, charts, and daily details you want to see." /><button className="primary-button" onClick={() => setCustomizingDashboard(true)}>Add dashboard widgets</button></section>}
          </>
        )}

        {tab === "overtime" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company-wide supervisor entry</p><h1>Overtime Entry</h1><span>Choose the employee, working department, cost code, reason, and hours.</span></div><label className="date-control"><span>Overtime date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
            <WeekOverview dates={weekDates(selectedDate)} selectedDate={selectedDate} setSelectedDate={setSelectedDate} entries={data.overtimeEntries} overrides={data.scheduleOverrides} />
            <div className="schedule-banner"><div><ShiftBadge color={workingColor} /><strong>{workingColor} is working {prettyDate(selectedDate)}</strong></div><span>Employees on {workingColor} shift show “Working” and cannot be added.</span></div>
            <RosterFilters departments={activeDepartments} department={rosterDepartment} setDepartment={setRosterDepartment} color={rosterColor} setColor={setRosterColor} period={rosterPeriod} setPeriod={setRosterPeriod} search={rosterSearch} setSearch={setRosterSearch} />
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">Available roster</p><h2>Select an employee</h2></div><span className="subtle-count">{rosterEmployees.filter((employee) => employee.shiftColor !== workingColor).length} available · {rosterEmployees.length} shown</span></div>
              {rosterEmployees.length ? <div className="roster-grid">{rosterEmployees.map((employee) => { const scheduled = employee.shiftColor === workingColor; return <article className={`employee-card ${scheduled ? "scheduled" : ""}`} key={employee.id}><div className="employee-main"><span className="avatar large">{initials(employee.name)}</span><div><strong>{employee.name}</strong><span>{employee.department}</span><span><ShiftBadge color={employee.shiftColor} compact /> {employee.shiftPeriod}</span></div></div>{scheduled ? <span className="working-pill">Working</span> : <button className="add-button" disabled={!canWrite} onClick={() => setOvertimeEditor({ employee })} aria-label={`Add overtime for ${employee.name}`}>+</button>}</article>; })}</div> : <EmptyState title="No employees match" body="Clear the search or choose another department." />}
            </section>
            <EntryTable title={`Entries for ${prettyDate(selectedDate)}`} entries={selectedOt.map((entry) => ({ id: entry.id, name: entry.employeeName, detail: `${entry.departmentName} · ${entry.costCode}`, subdetail: entry.reason, hours: entry.hours, notes: entry.notes }))} canChange={Boolean(canWrite)} onEdit={(id) => { const entry = selectedOt.find((item) => item.id === id); const employee = entry && employeesById.get(entry.employeeId); if (entry && employee) setOvertimeEditor({ employee, entry }); }} onDelete={(id) => void mutate({ action: "delete_overtime", id }, "Overtime entry removed.")} />
          </>
        )}

        {tab === "pto" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company time-off log</p><h1>PTO Tracking</h1><span>Record vacation, sick, personal, or other approved time.</span></div><label className="date-control"><span>PTO date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
            <RosterFilters departments={activeDepartments} department={rosterDepartment} setDepartment={setRosterDepartment} color={rosterColor} setColor={setRosterColor} period={rosterPeriod} setPeriod={setRosterPeriod} search={rosterSearch} setSearch={setRosterSearch} />
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">Employee roster</p><h2>Select an employee</h2></div><span className="subtle-count">{rosterEmployees.length} shown</span></div>{rosterEmployees.length ? <div className="roster-grid">{rosterEmployees.map((employee) => <article className="employee-card" key={employee.id}><div className="employee-main"><span className="avatar large">{initials(employee.name)}</span><div><strong>{employee.name}</strong><span>{employee.department}</span><span><ShiftBadge color={employee.shiftColor} compact /> {employee.shiftPeriod}</span></div></div><button className="add-button" disabled={!canWrite} onClick={() => setPtoEmployee(employee)} aria-label={`Add PTO for ${employee.name}`}>+</button></article>)}</div> : <EmptyState title="No employees match" body="Clear the search or choose another department." />}</section>
            <EntryTable title={`PTO for ${prettyDate(selectedDate)}`} entries={selectedPto.map((entry) => ({ id: entry.id, name: employeesById.get(entry.employeeId)?.name || "Unknown", detail: employeesById.get(entry.employeeId)?.department || "No department", subdetail: entry.ptoType, hours: entry.hours, notes: entry.notes }))} canChange={Boolean(canWrite)} onDelete={(id) => void mutate({ action: "delete_pto", id }, "PTO entry removed.")} />
          </>
        )}

        {tab === "employees" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company roster</p><h1>Employees</h1><span>Assign every employee to a configured department and one of the four crews.</span></div>{isAdmin && <div className="heading-actions"><button className="secondary-button" onClick={() => setImportKind("employees")}>Import CSV</button><button className="primary-button" disabled={!activeDepartments.length} onClick={() => setEditingEmployee(emptyEmployee)}>+ Add employee</button></div>}</div>
            {!activeDepartments.length && <div className="alert error"><span>!</span>Add an active department in Company Setup before adding employees.</div>}
            <section className="filter-bar employee-filters">
              <label className="search-field"><span>Find employee</span><input type="search" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Search by name" /></label>
              <label><span>Department</span><select value={employeeDepartment} onChange={(event) => setEmployeeDepartment(event.target.value)}><option value="all">All departments</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
              <label><span>Shift color</span><select value={employeeColor} onChange={(event) => setEmployeeColor(event.target.value as "all" | ShiftColor)}><option value="all">Blue & Yellow</option><option>Blue</option><option>Yellow</option></select></label>
              <label><span>Shift period</span><select value={employeePeriod} onChange={(event) => setEmployeePeriod(event.target.value)}><option value="all">Day & Night</option><option>Day</option><option>Night</option></select></label>
              <label><span>Status</span><select value={employeeStatus} onChange={(event) => setEmployeeStatus(event.target.value as "all" | "active" | "inactive")}><option value="active">Active only</option><option value="inactive">Inactive only</option><option value="all">All statuses</option></select></label>
            </section>
            <section className="panel table-panel"><div className="panel-head padded"><div><p className="eyebrow">Directory results</p><h2>Employee list</h2></div><span className="subtle-count">Showing {filteredEmployees.length} of {data.employees.length} employees</span></div>{data.employees.length ? filteredEmployees.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Shift</th><th>Period</th><th>Status</th>{isAdmin && <th />}</tr></thead><tbody>{filteredEmployees.map((employee) => <tr key={employee.id} className={!employee.active ? "inactive-row" : ""}><td><div className="person-cell"><span className="avatar">{initials(employee.name)}</span><strong>{employee.name}</strong></div></td><td>{employee.department}</td><td><ShiftBadge color={employee.shiftColor} compact /></td><td>{employee.shiftPeriod}</td><td><span className={`status-pill ${employee.active ? "active" : "inactive"}`}>{employee.active ? "Active" : "Inactive"}</span></td>{isAdmin && <td><button className="text-button" onClick={() => setEditingEmployee(employee)}>Edit</button></td>}</tr>)}</tbody></table></div> : <EmptyState title="No employees match" body="Clear or change the directory filters to see more employees." /> : <EmptyState title="No employees added" body="Use Add employee or Import CSV to build the company roster." />}</section>
          </>
        )}

        {tab === "calendar" && <CalendarView monthValue={calendarMonth} setMonthValue={setCalendarMonth} overrides={data.scheduleOverrides} isAdmin={Boolean(isAdmin)} onSelect={setOverrideDate} />}

        {tab === "reports" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company hours and history</p><h1>Reports</h1><span>Filter by employee, department, crew, cost code, or overtime reason.</span></div><div className="heading-actions">{isAdmin && <button className="secondary-button" onClick={() => setImportKind("history")}>Import history</button>}<button className="primary-button" onClick={downloadReport}>Download CSV</button></div></div>
            <section className="filter-bar report-filters">
              <label><span>From</span><input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} /></label>
              <label><span>Through</span><input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} /></label>
              <label><span>Employee</span><select value={reportEmployee} onChange={(event) => setReportEmployee(event.target.value)}><option value="all">All employees</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
              <label><span>Department</span><select value={reportDepartment} onChange={(event) => setReportDepartment(event.target.value)}><option value="all">All departments</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
              <label><span>Shift</span><select value={reportShift} onChange={(event) => setReportShift(event.target.value)}><option value="all">All shifts</option>{["Blue Day", "Blue Night", "Yellow Day", "Yellow Night"].map((shift) => <option key={shift}>{shift}</option>)}</select></label>
              <label><span>Cost code</span><select value={reportCostCode} onChange={(event) => setReportCostCode(event.target.value)}><option value="all">All cost codes</option>{costCodes.map((code) => <option key={code}>{code}</option>)}</select></label>
              <label><span>OT reason</span><select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="all">All reasons</option>{reasons.map((reason) => <option key={reason}>{reason}</option>)}</select></label>
              <div><span>Included</span><strong>{filteredOt.length} OT · {filteredPto.length} PTO</strong></div>
            </section>
            <ReportTable overtime={filteredOt} pto={filteredPto} employeesById={employeesById} />
            <OvertimeDetailTable entries={filteredOt} />
          </>
        )}

        {tab === "settings" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Your workspace</p><h1>Settings</h1><span>Personalize how the tracker looks and behaves for you.</span></div></div>
            <section className="settings-grid">
              <div className="panel settings-panel"><div className="panel-head"><div><p className="eyebrow">Appearance</p><h2>Color mode</h2></div></div><div className="settings-panel-body"><p>Choose the appearance that is easiest on your eyes. This setting is saved on this device.</p><div className="appearance-options" role="radiogroup" aria-label="Color mode">{(["light", "dark", "system"] as ColorMode[]).map((mode) => <button key={mode} type="button" className={colorMode === mode ? "selected" : ""} onClick={() => setColorMode(mode)} role="radio" aria-checked={colorMode === mode}><span className={`appearance-preview ${mode}`}><i /></span><strong>{mode === "system" ? "Use device setting" : `${mode[0].toUpperCase()}${mode.slice(1)} mode`}</strong><small>{mode === "system" ? "Follows your computer or phone" : mode === "dark" ? "Lower-light workspace" : "Bright, clean workspace"}</small></button>)}</div></div></div>
              <div className="panel settings-panel"><div className="panel-head"><div><p className="eyebrow">Dashboard</p><h2>Dashboard preferences</h2></div></div><div className="settings-panel-body"><p>Your dashboard already has its own Customize dashboard button. It is where you choose the cards and charts you want to see and save the layout to your account.</p><div className="settings-note"><span>✓</span><div><strong>Default dashboard is active</strong><small>Use the button at the top of Dashboard to personalize your view whenever dashboard storage is ready.</small></div></div></div></div>
            </section>
          </>
        )}

        {tab === "companySetup" && isAdmin && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Company configuration</p><h1>Departments & Cost Codes</h1><span>These defaults drive employee setup, overtime entry, and reporting.</span></div><button className="primary-button" onClick={() => setEditingDepartment({ id: "", name: "", defaultCostCode: "", active: true })}>+ Add department</button></div>
            <section className="panel table-panel">{data.departments.length ? <div className="table-wrap"><table><thead><tr><th>Department</th><th>Default cost code</th><th>Active employees</th><th>Status</th><th /></tr></thead><tbody>{data.departments.map((department) => { const count = activeEmployees.filter((employee) => employee.departmentId === department.id).length; return <tr key={department.id} className={!department.active ? "inactive-row" : ""}><td><strong>{department.name}</strong></td><td><span className="code-pill">{department.defaultCostCode}</span></td><td>{count}</td><td><span className={`status-pill ${department.active ? "active" : "inactive"}`}>{department.active ? "Active" : "Inactive"}</span></td><td><button className="text-button" onClick={() => setEditingDepartment(department)}>Edit</button></td></tr>; })}</tbody></table></div> : <EmptyState title="No departments configured" body="Add the first company department and its default cost code." />}</section>
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
                        <span className="profile-copy"><strong>{profile.fullName}</strong><small>{profile.email}{profile.role === "supervisor" ? ` · ${data.departments.find((department) => department.id === profile.departmentId)?.name ?? "Unassigned"} · ${profile.shiftColor ?? "Unassigned"} ${profile.shiftPeriod ?? ""}`.trimEnd() : ""}</small></span>
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
            <section className="security-strip"><div className="lock-mark">✓</div><div><strong>Company pilot protections</strong><span>Supabase login, approved roles, forced row-level security, database validation, historical snapshots, and tamper-resistant audit history are enabled.</span></div></section>
          </>
        )}
      </main>

      {overtimeEditor && <Modal title={overtimeEditor.entry ? "Edit overtime" : "Add overtime"} onClose={() => setOvertimeEditor(null)}><OvertimeForm employee={overtimeEditor.employee} entry={overtimeEditor.entry} date={selectedDate} departments={data.departments} busy={busy} onSubmit={async (values) => { const action = overtimeEditor.entry ? "update_overtime" : "add_overtime"; const ok = await mutate({ action, id: overtimeEditor.entry?.id, employeeId: overtimeEditor.employee.id, workDate: selectedDate, ...values }, overtimeEditor.entry ? "Overtime entry updated." : "Overtime entry saved."); if (ok) setOvertimeEditor(null); }} onDelete={overtimeEditor.entry ? async () => { const ok = await mutate({ action: "delete_overtime", id: overtimeEditor.entry?.id }, "Overtime entry removed."); if (ok) setOvertimeEditor(null); } : undefined} /></Modal>}
      {ptoEmployee && <Modal title="Add PTO" onClose={() => setPtoEmployee(null)}><PtoForm employee={ptoEmployee} date={selectedDate} busy={busy} onSubmit={async (values) => { const ok = await mutate({ action: "add_pto", employeeId: ptoEmployee.id, ptoDate: selectedDate, ...values }, "PTO entry saved."); if (ok) setPtoEmployee(null); }} /></Modal>}
      {overrideDate && <Modal title="Correct scheduled shift" onClose={() => setOverrideDate(null)}><OverrideForm date={overrideDate} current={shiftForDate(overrideDate, data.scheduleOverrides)} override={data.scheduleOverrides.find((item) => item.workDate === overrideDate)} busy={busy} onSave={async (values) => { const ok = await mutate({ action: "set_override", workDate: overrideDate, ...values }, "Schedule correction saved."); if (ok) setOverrideDate(null); }} onRemove={async () => { const ok = await mutate({ action: "delete_override", workDate: overrideDate }, "Schedule correction removed."); if (ok) setOverrideDate(null); }} /></Modal>}
      {editingEmployee && <Modal title={editingEmployee.id ? "Edit employee" : "Add employee"} onClose={() => setEditingEmployee(null)}><EmployeeForm employee={editingEmployee} departments={data.departments} busy={busy} onSave={async (values) => { const ok = await mutate({ action: editingEmployee.id ? "update_employee" : "add_employee", id: editingEmployee.id, ...values }, editingEmployee.id ? "Employee updated." : "Employee added."); if (ok) setEditingEmployee(null); }} /></Modal>}
      {editingDepartment && <Modal title={editingDepartment.id ? "Edit department" : "Add department"} onClose={() => setEditingDepartment(null)}><DepartmentForm department={editingDepartment} activeEmployeeCount={activeEmployees.filter((employee) => employee.departmentId === editingDepartment.id).length} busy={busy} onSave={async (values) => { const ok = await mutate({ action: editingDepartment.id ? "update_department" : "add_department", id: editingDepartment.id, ...values }, editingDepartment.id ? "Department updated." : "Department added."); if (ok) setEditingDepartment(null); }} /></Modal>}
      {editingProfile && <Modal title="Update user access" onClose={() => setEditingProfile(null)}><ProfileForm profile={editingProfile} departments={data.departments} busy={busy} currentUserEmail={data.session.email} onSave={async (values) => { const ok = await mutate({ action: "update_profile", originalEmail: editingProfile.email, ...values }, "User access updated."); if (ok) setEditingProfile(null); }} onDelete={async () => { const ok = await mutate({ action: "delete_profile", email: editingProfile.email }, "User access deleted."); if (ok) setEditingProfile(null); }} /></Modal>}
      {addingProfile && <Modal title="Add new person" onClose={() => setAddingProfile(false)}><ProfileForm departments={data.departments} busy={busy} currentUserEmail={data.session.email} onSave={async (values) => { const ok = await mutate({ action: "add_profile", ...values }, "New user access added."); if (ok) setAddingProfile(false); }} /></Modal>}
      {customizingDashboard && <Modal title="Customize your dashboard" wide onClose={() => setCustomizingDashboard(false)}><DashboardCustomizer initial={data.dashboardWidgets} busy={busy} onSave={async (widgets) => { const ok = await mutate({ action: "save_dashboard_layout", widgets }, "Your dashboard layout was saved."); if (ok) setCustomizingDashboard(false); }} /></Modal>}
      {importKind && <Modal title={importKind === "employees" ? "Import employee roster" : "Import overtime & PTO history"} onClose={() => setImportKind(null)}><ImportForm kind={importKind} busy={busy} onImport={async (rows) => { const ok = await mutate({ action: importKind === "employees" ? "import_employees" : "import_history", rows }, importKind === "employees" ? "Employee roster imported." : "Historical records imported."); if (ok) setImportKind(null); }} /></Modal>}
    </div>
  );
}

function RosterFilters({ departments, department, setDepartment, color, setColor, period, setPeriod, search, setSearch }: { departments: Department[]; department: string; setDepartment: (value: string) => void; color: "all" | ShiftColor; setColor: (value: "all" | ShiftColor) => void; period: string; setPeriod: (value: string) => void; search: string; setSearch: (value: string) => void }) {
  return <section className="filter-bar roster-filters"><label><span>Department</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">All departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Shift color</span><select value={color} onChange={(event) => setColor(event.target.value as "all" | ShiftColor)}><option value="all">Blue & Yellow</option><option>Blue</option><option>Yellow</option></select></label><label><span>Shift period</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="all">Day & Night</option><option>Day</option><option>Night</option></select></label><label className="search-field"><span>Find employee</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" /></label></section>;
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

  if (widget.id === "kpi_ot") return <DashboardMetric widget={widget} label="Overtime this month" value={otHours.toFixed(1)} unit="hrs" detail={`${monthOt.length} entries`} />;
  if (widget.id === "kpi_pto") return <DashboardMetric widget={widget} label="PTO this month" value={ptoHours.toFixed(1)} unit="hrs" detail={`${monthPto.length} entries`} />;
  if (widget.id === "kpi_employees") return <DashboardMetric widget={widget} label="Active employees" value={activeEmployees.length} detail={`${activeDepartments.length} active departments`} />;
  if (widget.id === "kpi_ot_people") return <DashboardMetric widget={widget} label="Employees with OT" value={new Set(monthOt.map((entry) => entry.employeeId)).size} detail={`${monthOt.length ? (otHours / monthOt.length).toFixed(1) : "0.0"} average hrs per entry`} />;

  if (widget.id === "shift_today") return <article className={`dashboard-widget dashboard-shift ${workingColor.toLowerCase()} ${widget.size}`}><div><span className="hero-kicker">Scheduled on {prettyDate(selectedDate, true)}</span><h2>{workingColor} Shift</h2><p>Both {workingColor} Day and {workingColor} Night crews are scheduled on the regular 2-2-3 rotation.</p></div><div className="hero-count"><strong>{activeEmployees.filter((employee) => employee.shiftColor === workingColor).length}</strong><span>scheduled employees</span></div>{data.scheduleOverrides.some((item) => item.workDate === selectedDate) && <span className="override-flag">Admin corrected</span>}</article>;

  if (widget.id === "schedule") return <DashboardPanel widget={widget} eyebrow="Looking ahead" title="Next 14 days" action={<button className="text-button" onClick={() => onNavigate("calendar")}>Full calendar →</button>}><div className="forecast-grid">{Array.from({ length: 14 }, (_, index) => addDays(selectedDate, index)).map((date) => { const color = shiftForDate(date, data.scheduleOverrides); return <div className={`forecast-day ${color.toLowerCase()}`} key={date}><span>{dateFromInput(date).toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{dateFromInput(date).getDate()}</strong><ShiftBadge color={color} compact /></div>; })}</div></DashboardPanel>;

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
    staffing_crew: { eyebrow: "Current workforce", title: "Staffing by crew", rows: totalsBy(activeEmployees, (employee) => `${employee.shiftColor} ${employee.shiftPeriod}`, () => 1), unit: "people" },
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

function OvertimeForm({ employee, entry, date, departments, busy, onSubmit, onDelete }: { employee: Employee; entry?: OvertimeEntry; date: string; departments: Department[]; busy: boolean; onSubmit: (values: Record<string, unknown>) => Promise<void>; onDelete?: () => Promise<void> }) {
  const selectable = departments.filter((department) => department.active || department.id === entry?.departmentId);
  const initialDepartment = selectable.find((department) => department.id === entry?.departmentId) ?? selectable.find((department) => department.id === employee.departmentId) ?? selectable[0];
  const [hours, setHours] = useState(entry?.hours ?? 12);
  const [departmentId, setDepartmentId] = useState(initialDepartment?.id ?? "");
  const [costCode, setCostCode] = useState(entry?.costCode ?? initialDepartment?.defaultCostCode ?? "");
  const [reason, setReason] = useState(entry?.reason ?? "Production Needs");
  const historicalReason = entry?.reason && !OT_REASONS.includes(entry.reason as (typeof OT_REASONS)[number]) ? entry.reason : "";

  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSubmit({ hours, departmentId, costCode, reason, notes: form.get("notes") }); }}><div className="form-summary"><span className="avatar large">{initials(employee.name)}</span><div><strong>{employee.name}</strong><span>{prettyDate(date)} · {employee.shiftColor} {employee.shiftPeriod} · Home: {employee.department}</span></div></div><label><span>Quick hours</span><div className="quick-hours">{[2, 4, 8, 12].map((value) => <button type="button" key={value} className={hours === value ? "active" : ""} onClick={() => setHours(value)}>+{value}</button>)}</div></label><div className="form-grid"><label><span>Hours</span><input name="hours" type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(event) => setHours(Number(event.target.value))} required /></label><label><span>Working department</span><select name="departmentId" value={departmentId} onChange={(event) => { const next = selectable.find((department) => department.id === event.target.value); setDepartmentId(event.target.value); if (next) setCostCode(next.defaultCostCode); }} required>{selectable.map((department) => <option key={department.id} value={department.id}>{department.name}{department.active ? "" : " (inactive)"}</option>)}</select></label></div><div className="form-grid"><label><span>Cost code</span><input name="costCode" value={costCode} onChange={(event) => setCostCode(event.target.value.toUpperCase())} placeholder="Example: EXT-100" required /></label><label><span>Reason</span><select name="reason" value={reason} onChange={(event) => setReason(event.target.value)} required>{historicalReason && <option>{historicalReason}</option>}{OT_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label></div><label><span>Notes <em>optional</em></span><textarea name="notes" rows={3} defaultValue={entry?.notes} placeholder="Add any useful context" /></label><div className="button-row">{onDelete && <button type="button" className="danger-button" disabled={busy} onClick={() => void onDelete()}>Remove entry</button>}<button className="primary-button" disabled={busy || !departmentId}>{busy ? "Saving…" : entry ? "Update overtime" : "Save overtime"}</button></div></form>;
}

function PtoForm({ employee, date, busy, onSubmit }: { employee: Employee; date: string; busy: boolean; onSubmit: (values: Record<string, unknown>) => Promise<void> }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSubmit({ hours: form.get("hours"), ptoType: form.get("ptoType"), notes: form.get("notes") }); }}><div className="form-summary"><span className="avatar large">{initials(employee.name)}</span><div><strong>{employee.name}</strong><span>{prettyDate(date)} · {employee.department} · {employee.shiftColor} {employee.shiftPeriod}</span></div></div><div className="form-grid"><label><span>Hours</span><input name="hours" type="number" min="0.25" max="24" step="0.25" defaultValue="12" required /></label><label><span>PTO type</span><select name="ptoType" defaultValue="Vacation"><option>Vacation</option><option>Sick</option><option>Personal</option><option>Bereavement</option><option>Other</option></select></label></div><label><span>Notes <em>optional</em></span><textarea name="notes" rows={3} placeholder="Add any useful context" /></label><button className="primary-button full" disabled={busy}>{busy ? "Saving…" : "Save PTO"}</button></form>;
}

function EmployeeForm({ employee, departments, busy, onSave }: { employee: Employee; departments: Department[]; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const selectable = departments.filter((department) => department.active || department.id === employee.departmentId);
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSave({ name: form.get("name"), departmentId: form.get("departmentId"), shiftColor: form.get("shiftColor"), shiftPeriod: form.get("shiftPeriod"), active: form.get("active") === "on" }); }}><label><span>Employee name</span><input name="name" defaultValue={employee.name} required autoFocus /></label><label><span>Department</span><select name="departmentId" defaultValue={employee.departmentId} required>{selectable.map((department) => <option key={department.id} value={department.id}>{department.name}{department.active ? "" : " (inactive)"}</option>)}</select></label><div className="form-grid"><label><span>Shift color</span><select name="shiftColor" defaultValue={employee.shiftColor}><option>Blue</option><option>Yellow</option></select></label><label><span>Shift period</span><select name="shiftPeriod" defaultValue={employee.shiftPeriod}><option>Day</option><option>Night</option></select></label></div><label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={employee.active} /><span>Active employee</span></label><button className="primary-button full" disabled={busy || !selectable.length}>{busy ? "Saving…" : "Save employee"}</button></form>;
}

function DepartmentForm({ department, activeEmployeeCount, busy, onSave }: { department: Department; activeEmployeeCount: number; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const active = activeEmployeeCount > 0 && department.active ? true : form.get("active") === "on"; void onSave({ name: form.get("name"), defaultCostCode: form.get("defaultCostCode"), active }); }}><p className="modal-copy">The default cost code fills automatically when this department is selected for overtime. Supervisors can still enter a different code when needed.</p><label><span>Department name</span><input name="name" defaultValue={department.name} maxLength={100} required autoFocus /></label><label><span>Default cost code</span><input name="defaultCostCode" defaultValue={department.defaultCostCode} maxLength={50} placeholder="Example: EXT-100" required /></label><label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={department.active} disabled={activeEmployeeCount > 0 && department.active} /><span>Active department{activeEmployeeCount > 0 && department.active ? ` · ${activeEmployeeCount} active employees must be moved or deactivated first` : ""}</span></label><div className="privacy-note"><strong>Historical records are protected</strong><span>Renaming this department updates current employee assignments. Existing overtime keeps its original department snapshot.</span></div><button className="primary-button full" disabled={busy}>{busy ? "Saving…" : "Save department"}</button></form>;
}

function ProfileForm({ profile, departments, busy, currentUserEmail, onSave, onDelete }: { profile?: Profile; departments: Department[]; busy: boolean; currentUserEmail: string; onSave: (values: Record<string, unknown>) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [role, setRole] = useState(profile?.role ?? "supervisor");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selectableDepartments = departments.filter((department) => department.active || department.id === profile?.departmentId);
  const currentUser = profile?.email === currentUserEmail;

  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSave({ fullName: form.get("fullName"), email: form.get("email"), role, departmentId: role === "supervisor" ? form.get("departmentId") : null, shiftColor: role === "supervisor" ? form.get("shiftColor") : null, shiftPeriod: role === "supervisor" ? form.get("shiftPeriod") : null, active: form.get("active") === "on" }); }}>
    <label><span>Full name</span><input name="fullName" defaultValue={profile?.fullName ?? ""} maxLength={100} required autoFocus /></label>
    <label><span>Email</span><input type="email" name="email" defaultValue={profile?.email ?? ""} maxLength={160} required /></label>
    <label><span>Role</span><select name="role" value={role} onChange={(event) => setRole(event.target.value as Profile["role"])}><option value="supervisor">Supervisor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label>
    {role === "supervisor" && <>
      <label><span>Supervisor department</span><select name="departmentId" defaultValue={profile?.departmentId ?? selectableDepartments[0]?.id} required>{selectableDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}{department.active ? "" : " (inactive)"}</option>)}</select></label>
      <div className="form-grid"><label><span>Supervisor shift color</span><select name="shiftColor" defaultValue={profile?.shiftColor ?? "Blue"}><option>Blue</option><option>Yellow</option></select></label><label><span>Supervisor period</span><select name="shiftPeriod" defaultValue={profile?.shiftPeriod ?? "Day"}><option>Day</option><option>Night</option></select></label></div>
      <small className="form-help">Department, shift color, and period are required for supervisors.</small>
    </>}
    <label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={profile?.active ?? true} /><span>Active account</span></label>
    <div className="privacy-note"><strong>{profile ? "Email updates replace this selected record" : "Supabase Authentication is still required"}</strong><span>{profile ? "Changing this email will not create a duplicate tracker profile. The user's Supabase Authentication email must also match before they can sign in." : "Create or invite the matching Supabase Authentication user with this exact email."}</span></div>
    {confirmDelete && <div className="delete-confirm"><strong>Delete tracker access for {profile?.fullName}?</strong><span>This removes the approved tracker profile and records the deletion in Audit history. It does not delete the person's Supabase Authentication account.</span><div className="button-row"><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="danger-button" disabled={busy} onClick={() => void onDelete?.()}>{busy ? "Deleting…" : "Confirm delete"}</button></div></div>}
    {!confirmDelete && <div className="button-row">{profile && onDelete && <button type="button" className="danger-button" disabled={busy || currentUser} title={currentUser ? "You cannot delete the account currently signed in." : undefined} onClick={() => setConfirmDelete(true)}>Delete user access</button>}<button className="primary-button" disabled={busy || (role === "supervisor" && !selectableDepartments.length)}>{busy ? "Saving…" : profile ? "Update user" : "Add person"}</button></div>}
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
    ? "name,shift_color,shift_period,department,active\nEmployee One,Blue,Day,Extrusion,true\nEmployee Two,Yellow,Night,Warehouse,true\n"
    : "type,date,employee_name,hours,department,code_or_type,reason,notes\nOT,2026-06-15,Employee One,12,Extrusion,EXT-100,Production Needs,Weekend coverage\nPTO,2026-07-02,Employee One,12,,Vacation,,Approved vacation\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = kind === "employees" ? "employee-import-template.csv" : "history-import-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function ImportForm({ kind, busy, onImport }: { kind: ImportKind; busy: boolean; onImport: (rows: Array<Record<string, unknown>>) => Promise<void> }) {
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
        ? parsed.map((row) => ({ name: row.name, shiftColor: row.shift_color?.toLowerCase() === "yellow" ? "Yellow" : row.shift_color?.toLowerCase() === "blue" ? "Blue" : row.shift_color, shiftPeriod: row.shift_period?.toLowerCase() === "night" ? "Night" : row.shift_period?.toLowerCase() === "day" ? "Day" : row.shift_period, department: row.department, active: !["false", "no", "0", "inactive"].includes((row.active || "true").toLowerCase()) }))
        : parsed.map((row) => ({ type: row.type?.toUpperCase(), date: normalizeDateValue(row.date || ""), employeeName: row.employee_name, hours: row.hours, department: row.department || "", codeOrType: row.code_or_type, reason: row.reason || "", notes: row.notes || "" }));
      setFileError("");
      await onImport(rows);
    } catch (importError) {
      setFileError(importError instanceof Error ? importError.message : "The CSV could not be read.");
    }
  }

  return <form className="modal-form import-form" onSubmit={(event) => void submit(event)}><p className="modal-copy">{employeeImport ? "Department names must already exist in Company Setup. Existing employees with the same name are updated instead of duplicated." : "Import overtime and PTO after the roster is loaded. Employee and department names must match exactly; duplicate OT is skipped by employee, date, department, and cost code."}</p><div className="template-box"><div><strong>Use the import template</strong><span>{employeeImport ? "Columns: name, shift_color, shift_period, department, active" : "Columns: type, date, employee_name, hours, department, code_or_type, reason, notes"}</span></div><button type="button" className="secondary-button" onClick={() => downloadImportTemplate(kind)}>Download template</button></div><label className="file-picker"><span>Completed CSV file</span><input type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setFileError(""); }} /></label>{fileError && <div className="field-error">{fileError}</div>}<div className="privacy-note"><strong>Company data reminder</strong><span>Only import real employee or PTO information after your company has approved this private pilot.</span></div><button className="primary-button full" disabled={busy || !file}>{busy ? "Importing…" : employeeImport ? "Import employees" : "Import historical records"}</button></form>;
}

function OverrideForm({ date, current, override, busy, onSave, onRemove }: { date: string; current: ShiftColor; override?: Override; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onRemove: () => Promise<void> }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSave({ shiftColor: form.get("shiftColor"), reason: form.get("reason") }); }}><p className="modal-copy">Change the working color for <strong>{prettyDate(date)}</strong>. Overtime availability will update immediately.</p><label><span>Working color</span><select name="shiftColor" defaultValue={current}><option>Blue</option><option>Yellow</option></select></label><label><span>Reason</span><textarea name="reason" rows={3} defaultValue={override?.reason} placeholder="Calendar correction, holiday adjustment, etc." /></label><div className="button-row">{override && <button type="button" className="danger-button" disabled={busy} onClick={() => void onRemove()}>Remove correction</button>}<button className="primary-button" disabled={busy}>Save correction</button></div></form>;
}

function EntryTable({ title, entries, canChange, onEdit, onDelete }: { title: string; entries: Array<{ id: string; name: string; detail: string; subdetail?: string; hours: number; notes: string }>; canChange: boolean; onEdit?: (id: string) => void; onDelete: (id: string) => void }) {
  return <section className="panel table-panel"><div className="panel-head padded"><h2>{title}</h2><span className="subtle-count">{entries.length} entries · {entries.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)} hrs</span></div>{entries.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department / code</th><th>Reason / type</th><th>Hours</th><th>Notes</th>{canChange && <th />}</tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><strong>{entry.name}</strong></td><td>{entry.detail}</td><td>{entry.subdetail || "—"}</td><td>{entry.hours}</td><td className="notes-cell">{entry.notes || "—"}</td>{canChange && <td><div className="row-actions">{onEdit && <button className="text-button" onClick={() => onEdit(entry.id)}>Edit</button>}<button className="delete-link" onClick={() => onDelete(entry.id)}>Remove</button></div></td>}</tr>)}</tbody></table></div> : <EmptyState title="Nothing entered for this date" body="Use the employee roster above to add an entry." />}</section>;
}

function WeekOverview({ dates, selectedDate, setSelectedDate, entries, overrides }: { dates: string[]; selectedDate: string; setSelectedDate: (value: string) => void; entries: OvertimeEntry[]; overrides: Override[] }) {
  return <section className="week-overview" aria-label="Overtime week">{dates.map((date) => { const daily = entries.filter((entry) => entry.workDate === date); const color = shiftForDate(date, overrides); return <button key={date} className={`${date === selectedDate ? "active" : ""} ${color.toLowerCase()}`} onClick={() => setSelectedDate(date)}><span>{dateFromInput(date).toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{dateFromInput(date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong><small>{color} working</small><b>{daily.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)} hrs · {daily.length} entries</b></button>; })}</section>;
}

function CalendarView({ monthValue, setMonthValue, overrides, isAdmin, onSelect }: { monthValue: string; setMonthValue: (value: string) => void; overrides: Override[]; isAdmin: boolean; onSelect: (date: string) => void }) {
  const focus = dateFromInput(monthValue);
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return date; });
  const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  function moveMonth(amount: number) { setMonthValue(toDateInput(new Date(first.getFullYear(), first.getMonth() + amount, 1))); }
  return <><div className="page-heading"><div><p className="eyebrow">Automatic rotation</p><h1>Shift Calendar</h1><span>Verified 2-2-3 Yellow and Blue schedule. Admin corrections are marked.</span></div><div className="month-controls"><button onClick={() => moveMonth(-1)}>‹</button><strong>{title}</strong><button onClick={() => moveMonth(1)}>›</button></div></div><section className="calendar-panel"><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((date) => { const dateValue = toDateInput(date); const color = shiftForDate(dateValue, overrides); const savedOverride = overrides.find((item) => item.workDate === dateValue); const outside = date.getMonth() !== first.getMonth(); return <button key={dateValue} className={`calendar-day ${color.toLowerCase()} ${outside ? "outside" : ""}`} onClick={() => isAdmin && onSelect(dateValue)} disabled={!isAdmin}><span>{date.getDate()}</span><ShiftBadge color={color} compact />{savedOverride && <em title={savedOverride.reason || "Admin correction"}>Corrected</em>}</button>; })}</div></section><div className="calendar-legend"><ShiftBadge color="Blue" /><span>Blue Day & Night working</span><ShiftBadge color="Yellow" /><span>Yellow Day & Night working</span>{isAdmin && <small>Click a date to correct its scheduled color.</small>}</div></>;
}

function ReportTable({ overtime, pto, employeesById }: { overtime: OvertimeEntry[]; pto: PtoEntry[]; employeesById: Map<string, Employee> }) {
  const rows = new Map<string, { id: string; name: string; department: string; shift: string; otHours: number; otCount: number; ptoHours: number; ptoCount: number }>();
  for (const entry of overtime) {
    const current = rows.get(entry.employeeId) ?? { id: entry.employeeId, name: entry.employeeName, department: entry.departmentName, shift: entry.shiftName, otHours: 0, otCount: 0, ptoHours: 0, ptoCount: 0 };
    current.otHours += entry.hours; current.otCount += 1; rows.set(entry.employeeId, current);
  }
  for (const entry of pto) {
    const employee = employeesById.get(entry.employeeId);
    const current = rows.get(entry.employeeId) ?? { id: entry.employeeId, name: employee?.name || "Unknown", department: employee?.department || "Unknown", shift: employee ? `${employee.shiftColor} ${employee.shiftPeriod}` : "Unknown", otHours: 0, otCount: 0, ptoHours: 0, ptoCount: 0 };
    current.ptoHours += entry.hours; current.ptoCount += 1; rows.set(entry.employeeId, current);
  }
  const sorted = Array.from(rows.values()).sort((a, b) => b.otHours - a.otHours || a.name.localeCompare(b.name));
  return <section className="panel table-panel"><div className="panel-head padded"><div><p className="eyebrow">Summary</p><h2>Hours by employee</h2></div></div>{sorted.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Shift</th><th>OT hours</th><th>OT entries</th><th>PTO hours</th><th>PTO entries</th></tr></thead><tbody>{sorted.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.department}</td><td>{row.shift}</td><td><strong>{row.otHours.toFixed(1)}</strong></td><td>{row.otCount}</td><td>{row.ptoHours.toFixed(1)}</td><td>{row.ptoCount}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Totals</td><td>{sorted.reduce((sum, row) => sum + row.otHours, 0).toFixed(1)}</td><td>{sorted.reduce((sum, row) => sum + row.otCount, 0)}</td><td>{sorted.reduce((sum, row) => sum + row.ptoHours, 0).toFixed(1)}</td><td>{sorted.reduce((sum, row) => sum + row.ptoCount, 0)}</td></tr></tfoot></table></div> : <EmptyState title="No records match" body="Adjust the report filters to include more activity." />}</section>;
}

function OvertimeDetailTable({ entries }: { entries: OvertimeEntry[] }) {
  return <section className="panel table-panel"><div className="panel-head padded"><div><p className="eyebrow">Detail</p><h2>Overtime records</h2></div><span className="subtle-count">{entries.length} records</span></div>{entries.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Shift</th><th>Cost code</th><th>Reason</th><th>Hours</th><th>Notes</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{prettyDate(entry.workDate, true)}</td><td><strong>{entry.employeeName}</strong></td><td>{entry.departmentName}</td><td>{entry.shiftName}</td><td>{entry.costCode}</td><td>{entry.reason}</td><td><strong>{entry.hours.toFixed(1)}</strong></td><td className="notes-cell">{entry.notes || "—"}</td></tr>)}</tbody></table></div> : <EmptyState title="No overtime matches" body="Department, cost code, reason, and date filters apply here." />}</section>;
}
