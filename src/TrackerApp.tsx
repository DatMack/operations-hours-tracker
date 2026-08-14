import { useEffect, useMemo, useState } from "react";
import { shiftForDate, toDateInput, type ShiftColor } from "./lib/schedule";
import { loadBundle, mutateTracker } from "./lib/tracker-api";

type Role = "admin" | "supervisor" | "viewer";
type Employee = {
  id: string;
  name: string;
  shiftColor: ShiftColor;
  shiftPeriod: "Day" | "Night";
  department: string;
  active: boolean;
};
type OvertimeEntry = {
  id: string;
  workDate: string;
  employeeId: string;
  hours: number;
  costCode: string;
  notes: string;
  enteredBy: string;
  createdAt: string;
};
type PtoEntry = {
  id: string;
  ptoDate: string;
  employeeId: string;
  hours: number;
  ptoType: string;
  notes: string;
  enteredBy: string;
  createdAt: string;
};
type Override = { workDate: string; shiftColor: ShiftColor; reason: string; updatedBy: string };
type Profile = { email: string; fullName: string; role: Role; active: boolean };
type Audit = { id: string; action: string; entityType: string; details: string; userEmail: string; createdAt: string };
type Bundle = {
  backend: "d1" | "supabase";
  session: Profile;
  employees: Employee[];
  overtimeEntries: OvertimeEntry[];
  ptoEntries: PtoEntry[];
  scheduleOverrides: Override[];
  profiles: Profile[];
  auditLog: Audit[];
};

type Tab = "dashboard" | "overtime" | "pto" | "employees" | "calendar" | "reports" | "admin";
type ImportKind = "employees" | "history";

const NAV: Array<{ id: Tab; code: string; label: string }> = [
  { id: "dashboard", code: "DB", label: "Dashboard" },
  { id: "overtime", code: "OT", label: "Overtime Entry" },
  { id: "pto", code: "PT", label: "PTO Tracking" },
  { id: "employees", code: "EM", label: "Employees" },
  { id: "calendar", code: "SC", label: "Shift Calendar" },
  { id: "reports", code: "RP", label: "Reports" },
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

function currentMonthRange(dateValue: string) {
  const date = dateFromInput(dateValue);
  const year = date.getFullYear();
  const month = date.getMonth();
  return {
    start: toDateInput(new Date(year, month, 1)),
    end: toDateInput(new Date(year, month + 1, 0)),
  };
}

function ShiftBadge({ color, compact = false }: { color: ShiftColor; compact?: boolean }) {
  return <span className={`shift-badge ${color.toLowerCase()} ${compact ? "compact" : ""}`}><i />{color}</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><div className="empty-mark">+</div><strong>{title}</strong><span>{body}</span></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </section>
    </div>
  );
}

export default function TrackerApp({ onSignOut }: { onSignOut: () => Promise<unknown> }) {
  const [data, setData] = useState<Bundle | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => toDateInput(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => toDateInput(new Date()));
  const [otEmployee, setOtEmployee] = useState<Employee | null>(null);
  const [ptoEmployee, setPtoEmployee] = useState<Employee | null>(null);
  const [overrideDate, setOverrideDate] = useState<string | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [reportStart, setReportStart] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [reportEnd, setReportEnd] = useState(() => `${new Date().getFullYear()}-12-31`);

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
  const visibleNav = NAV.filter((item) => item.id !== "admin" || isAdmin);

  if (!data) {
    return (
      <main className="loading-shell">
        <div className="loading-card"><div className="brand-box">OT</div><h1>Operations Hours Tracker</h1><span className="loader" />
          <p>{error || "Opening the secure tracker…"}</p>{error && <div className="button-row"><button className="secondary-button" onClick={() => void onSignOut()}>Sign out</button><button className="primary-button" onClick={() => void load()}>Try again</button></div>}
        </div>
      </main>
    );
  }

  const monthRange = currentMonthRange(selectedDate);
  const monthOt = data.overtimeEntries.filter((entry) => entry.workDate >= monthRange.start && entry.workDate <= monthRange.end);
  const monthPto = data.ptoEntries.filter((entry) => entry.ptoDate >= monthRange.start && entry.ptoDate <= monthRange.end);
  const selectedOt = data.overtimeEntries.filter((entry) => entry.workDate === selectedDate);
  const selectedPto = data.ptoEntries.filter((entry) => entry.ptoDate === selectedDate);

  function downloadReport() {
    const filteredOt = data!.overtimeEntries.filter((entry) => entry.workDate >= reportStart && entry.workDate <= reportEnd);
    const filteredPto = data!.ptoEntries.filter((entry) => entry.ptoDate >= reportStart && entry.ptoDate <= reportEnd);
    const rows = [
      ["type", "date", "employee_name", "hours", "code_or_type", "notes", "shift_color", "shift_period", "entered_by"],
      ...filteredOt.map((entry) => {
        const employee = employeesById.get(entry.employeeId);
        return ["OT", entry.workDate, employee?.name || "Unknown", entry.hours, entry.costCode, entry.notes, employee?.shiftColor || "", employee?.shiftPeriod || "", entry.enteredBy];
      }),
      ...filteredPto.map((entry) => {
        const employee = employeesById.get(entry.employeeId);
        return ["PTO", entry.ptoDate, employee?.name || "Unknown", entry.hours, entry.ptoType, entry.notes, employee?.shiftColor || "", employee?.shiftPeriod || "", entry.enteredBy];
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-box">OT</div><div><strong>Overtime & PTO</strong><span>Operations tracker · {data.backend === "supabase" ? "Supabase" : "Secure DB"}</span></div></div>
        <div className="account"><span className="status-dot" /><div><strong>{data.session.fullName}</strong><span>{data.session.role}</span></div><button className="signout-button" onClick={() => void onSignOut()}>Sign out</button></div>
      </header>

      <nav className="main-nav" aria-label="Tracker pages">
        {visibleNav.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><span>{item.code}</span>{item.label}</button>)}
      </nav>

      <main className="content">
        {(error || notice) && <div className={`alert ${error ? "error" : "success"}`}><span>{error ? "!" : "✓"}</span>{error || notice}<button onClick={() => { setError(""); setNotice(""); }}>×</button></div>}

        {tab === "dashboard" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Operations overview</p><h1>Dashboard</h1><span>{prettyDate(selectedDate)} · Current schedule and monthly activity</span></div><label className="date-control"><span>View date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
            <section className={`shift-hero ${workingColor.toLowerCase()}`}>
              <div><span className="hero-kicker">Scheduled today</span><h2>{workingColor} Shift</h2><p>Both {workingColor} Day and {workingColor} Night crews are on their regular 2-2-3 schedule.</p></div>
              <div className="hero-count"><strong>{activeEmployees.filter((employee) => employee.shiftColor === workingColor).length}</strong><span>scheduled employees</span></div>
              {data.scheduleOverrides.some((item) => item.workDate === selectedDate) && <span className="override-flag">Admin corrected</span>}
            </section>
            {!activeEmployees.length && <section className="setup-banner"><div><span className="setup-number">1</span><div><strong>Your tracker is clean and ready</strong><span>Add employees individually or import the complete roster from a CSV file.</span></div></div><div className="button-row"><button className="secondary-button" onClick={() => setImportKind("employees")}>Import roster</button><button className="primary-button" onClick={() => setTab("employees")}>Add employees</button></div></section>}
            <section className="metric-grid">
              <article><span className="metric-label">Overtime this month</span><strong>{monthOt.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)}<small> hrs</small></strong><em>{monthOt.length} entries</em></article>
              <article><span className="metric-label">PTO this month</span><strong>{monthPto.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)}<small> hrs</small></strong><em>{monthPto.length} entries</em></article>
              <article><span className="metric-label">Active employees</span><strong>{activeEmployees.length}</strong><em>{activeEmployees.filter((employee) => employee.shiftColor === "Blue").length} Blue · {activeEmployees.filter((employee) => employee.shiftColor === "Yellow").length} Yellow</em></article>
              <article><span className="metric-label">Schedule corrections</span><strong>{data.scheduleOverrides.length}</strong><em>saved overrides</em></article>
            </section>
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">Looking ahead</p><h2>Next 14 days</h2></div><button className="text-button" onClick={() => setTab("calendar")}>Full calendar →</button></div>
              <div className="forecast-grid">{Array.from({ length: 14 }, (_, index) => addDays(selectedDate, index)).map((date) => { const color = shiftForDate(date, data.scheduleOverrides); return <div className={`forecast-day ${color.toLowerCase()}`} key={date}><span>{dateFromInput(date).toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{dateFromInput(date).getDate()}</strong><ShiftBadge color={color} compact /></div>; })}</div>
            </section>
            <section className="two-column"><div className="panel"><div className="panel-head"><h2>Overtime on {prettyDate(selectedDate, true)}</h2><button className="text-button" onClick={() => setTab("overtime")}>Manage →</button></div>{selectedOt.length ? <div className="activity-list">{selectedOt.map((entry) => <div key={entry.id}><span className="avatar">{(employeesById.get(entry.employeeId)?.name || "?").slice(0, 2).toUpperCase()}</span><div><strong>{employeesById.get(entry.employeeId)?.name}</strong><small>{entry.costCode}</small></div><b>{entry.hours} hrs</b></div>)}</div> : <EmptyState title="No overtime entered" body="Entries for this date will appear here." />}</div>
              <div className="panel"><div className="panel-head"><h2>PTO on {prettyDate(selectedDate, true)}</h2><button className="text-button" onClick={() => setTab("pto")}>Manage →</button></div>{selectedPto.length ? <div className="activity-list">{selectedPto.map((entry) => <div key={entry.id}><span className="avatar">{(employeesById.get(entry.employeeId)?.name || "?").slice(0, 2).toUpperCase()}</span><div><strong>{employeesById.get(entry.employeeId)?.name}</strong><small>{entry.ptoType}</small></div><b>{entry.hours} hrs</b></div>)}</div> : <EmptyState title="No PTO entered" body="PTO entries for this date will appear here." />}</div>
            </section>
          </>
        )}

        {tab === "overtime" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Supervisor entry</p><h1>Overtime Entry</h1><span>Scheduled employees are automatically blocked.</span></div><label className="date-control"><span>Overtime date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
            <div className="schedule-banner"><div><ShiftBadge color={workingColor} /><strong>{workingColor} is working {prettyDate(selectedDate)}</strong></div><span>Employees on {workingColor} shift show “Working” and cannot be added.</span></div>
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">Available roster</p><h2>Select an employee</h2></div><span className="subtle-count">{activeEmployees.filter((employee) => employee.shiftColor !== workingColor).length} available</span></div>
              {activeEmployees.length ? <div className="roster-grid">{activeEmployees.map((employee) => { const scheduled = employee.shiftColor === workingColor; return <article className={`employee-card ${scheduled ? "scheduled" : ""}`} key={employee.id}><div className="employee-main"><span className="avatar large">{employee.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{employee.name}</strong><span><ShiftBadge color={employee.shiftColor} compact /> {employee.shiftPeriod}</span></div></div>{scheduled ? <span className="working-pill">Working</span> : <button className="add-button" disabled={!canWrite} onClick={() => setOtEmployee(employee)} aria-label={`Add overtime for ${employee.name}`}>+</button>}</article>; })}</div> : <EmptyState title="Add employees first" body="The overtime roster will appear after your employee setup is complete." />}
            </section>
            <EntryTable title={`Entries for ${prettyDate(selectedDate)}`} entries={selectedOt.map((entry) => ({ id: entry.id, name: employeesById.get(entry.employeeId)?.name || "Unknown", detail: entry.costCode, hours: entry.hours, notes: entry.notes }))} canDelete={Boolean(canWrite)} onDelete={(id) => void mutate({ action: "delete_overtime", id }, "Overtime entry removed.")} />
          </>
        )}

        {tab === "pto" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Time-off log</p><h1>PTO Tracking</h1><span>Record vacation, sick, personal, or other approved time.</span></div><label className="date-control"><span>PTO date</span><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label></div>
            <section className="panel"><div className="panel-head"><div><p className="eyebrow">Employee roster</p><h2>Select an employee</h2></div></div>{activeEmployees.length ? <div className="roster-grid">{activeEmployees.map((employee) => <article className="employee-card" key={employee.id}><div className="employee-main"><span className="avatar large">{employee.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{employee.name}</strong><span><ShiftBadge color={employee.shiftColor} compact /> {employee.shiftPeriod}</span></div></div><button className="add-button" disabled={!canWrite} onClick={() => setPtoEmployee(employee)} aria-label={`Add PTO for ${employee.name}`}>+</button></article>)}</div> : <EmptyState title="Add employees first" body="The PTO roster will appear after your employee setup is complete." />}</section>
            <EntryTable title={`PTO for ${prettyDate(selectedDate)}`} entries={selectedPto.map((entry) => ({ id: entry.id, name: employeesById.get(entry.employeeId)?.name || "Unknown", detail: entry.ptoType, hours: entry.hours, notes: entry.notes }))} canDelete={Boolean(canWrite)} onDelete={(id) => void mutate({ action: "delete_pto", id }, "PTO entry removed.")} />
          </>
        )}

        {tab === "employees" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Roster setup</p><h1>Employees</h1><span>Assign each employee to their color and Day or Night period.</span></div>{isAdmin && <div className="heading-actions"><button className="secondary-button" onClick={() => setImportKind("employees")}>Import CSV</button><button className="primary-button" onClick={() => setEditingEmployee({ id: "", name: "", shiftColor: "Blue", shiftPeriod: "Day", department: "Extrusion", active: true })}>+ Add employee</button></div>}</div>
            <section className="panel table-panel">{data.employees.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Shift</th><th>Period</th><th>Status</th>{isAdmin && <th />}</tr></thead><tbody>{data.employees.map((employee) => <tr key={employee.id} className={!employee.active ? "inactive-row" : ""}><td><div className="person-cell"><span className="avatar">{employee.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><strong>{employee.name}</strong></div></td><td>{employee.department}</td><td><ShiftBadge color={employee.shiftColor} compact /></td><td>{employee.shiftPeriod}</td><td><span className={`status-pill ${employee.active ? "active" : "inactive"}`}>{employee.active ? "Active" : "Inactive"}</span></td>{isAdmin && <td><button className="text-button" onClick={() => setEditingEmployee(employee)}>Edit</button></td>}</tr>)}</tbody></table></div> : <EmptyState title="No employees added" body="Use Add employee or Import CSV to build your real roster." />}</section>
          </>
        )}

        {tab === "calendar" && <CalendarView monthValue={calendarMonth} setMonthValue={setCalendarMonth} overrides={data.scheduleOverrides} isAdmin={Boolean(isAdmin)} onSelect={setOverrideDate} />}

        {tab === "reports" && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Hours and history</p><h1>Reports</h1><span>Review totals and download an Excel-ready CSV backup.</span></div><div className="heading-actions">{isAdmin && <button className="secondary-button" onClick={() => setImportKind("history")}>Import history</button>}<button className="primary-button" onClick={downloadReport}>Download CSV</button></div></div>
            <section className="filter-bar"><label><span>From</span><input type="date" value={reportStart} onChange={(event) => setReportStart(event.target.value)} /></label><label><span>Through</span><input type="date" value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} /></label><div><span>Included</span><strong>{data.overtimeEntries.filter((entry) => entry.workDate >= reportStart && entry.workDate <= reportEnd).length} OT · {data.ptoEntries.filter((entry) => entry.ptoDate >= reportStart && entry.ptoDate <= reportEnd).length} PTO</strong></div></section>
            <ReportTable data={data} employeesById={employeesById} start={reportStart} end={reportEnd} />
          </>
        )}

        {tab === "admin" && isAdmin && (
          <>
            <div className="page-heading"><div><p className="eyebrow">Protected settings</p><h1>Administration</h1><span>Approve users, assign roles, and review recent changes.</span></div></div>
            <section className="two-column admin-columns"><div className="panel"><div className="panel-head"><div><p className="eyebrow">User access</p><h2>Approved accounts</h2></div></div><div className="profile-list">{data.profiles.map((profile) => <div key={profile.email}><span className="avatar">{profile.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{profile.fullName}</strong><small>{profile.email}</small></div><span className="role-pill">{profile.role}</span></div>)}</div><details className="add-user"><summary>+ Add or update a user</summary><form onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const ok = await mutate({ action: "upsert_profile", fullName: form.get("fullName"), email: form.get("email"), role: form.get("role"), active: true }, "User access saved."); if (ok) event.currentTarget.reset(); }}><label><span>Full name</span><input name="fullName" required /></label><label><span>Email</span><input type="email" name="email" required /></label><label><span>Role</span><select name="role" defaultValue="supervisor"><option value="supervisor">Supervisor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label><button className="primary-button" disabled={busy}>Save user</button></form></details></div>
              <div className="panel"><div className="panel-head"><div><p className="eyebrow">Audit history</p><h2>Recent changes</h2></div></div><div className="audit-list">{data.auditLog.length ? data.auditLog.slice(0, 15).map((item) => <div key={item.id}><span className="audit-dot" /><div><strong>{item.action} {item.entityType.replace("_", " ")}</strong><small>{item.userEmail} · {timestampDate(item.createdAt).toLocaleString()}</small></div></div>) : <EmptyState title="No changes yet" body="Administrative and entry changes will be recorded here." />}</div></div>
            </section>
            <section className="security-strip"><div className="lock-mark">✓</div><div><strong>Private pilot protections</strong><span>Supabase login, approved user roles, database-enforced shift validation, and a tamper-resistant audit history are enabled.</span></div></section>
          </>
        )}
      </main>

      {otEmployee && <Modal title="Add overtime" onClose={() => setOtEmployee(null)}><EntryForm employee={otEmployee} date={selectedDate} type="ot" busy={busy} onSubmit={async (values) => { const ok = await mutate({ action: "add_overtime", employeeId: otEmployee.id, workDate: selectedDate, ...values }, "Overtime entry saved."); if (ok) setOtEmployee(null); }} /></Modal>}
      {ptoEmployee && <Modal title="Add PTO" onClose={() => setPtoEmployee(null)}><EntryForm employee={ptoEmployee} date={selectedDate} type="pto" busy={busy} onSubmit={async (values) => { const ok = await mutate({ action: "add_pto", employeeId: ptoEmployee.id, ptoDate: selectedDate, ...values }, "PTO entry saved."); if (ok) setPtoEmployee(null); }} /></Modal>}
      {overrideDate && <Modal title="Correct scheduled shift" onClose={() => setOverrideDate(null)}><OverrideForm date={overrideDate} current={shiftForDate(overrideDate, data.scheduleOverrides)} override={data.scheduleOverrides.find((item) => item.workDate === overrideDate)} busy={busy} onSave={async (values) => { const ok = await mutate({ action: "set_override", workDate: overrideDate, ...values }, "Schedule correction saved."); if (ok) setOverrideDate(null); }} onRemove={async () => { const ok = await mutate({ action: "delete_override", workDate: overrideDate }, "Schedule correction removed."); if (ok) setOverrideDate(null); }} /></Modal>}
      {editingEmployee && <Modal title={editingEmployee.id ? "Edit employee" : "Add employee"} onClose={() => setEditingEmployee(null)}><EmployeeForm employee={editingEmployee} busy={busy} onSave={async (values) => { const ok = await mutate({ action: editingEmployee.id ? "update_employee" : "add_employee", id: editingEmployee.id, ...values }, editingEmployee.id ? "Employee updated." : "Employee added."); if (ok) setEditingEmployee(null); }} /></Modal>}
      {importKind && <Modal title={importKind === "employees" ? "Import employee roster" : "Import overtime & PTO history"} onClose={() => setImportKind(null)}><ImportForm kind={importKind} busy={busy} onImport={async (rows) => { const ok = await mutate({ action: importKind === "employees" ? "import_employees" : "import_history", rows }, importKind === "employees" ? "Employee roster imported." : "Historical records imported."); if (ok) setImportKind(null); }} /></Modal>}
    </div>
  );
}

function EntryForm({ employee, date, type, busy, onSubmit }: { employee: Employee; date: string; type: "ot" | "pto"; busy: boolean; onSubmit: (values: Record<string, unknown>) => Promise<void> }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSubmit(type === "ot" ? { hours: form.get("hours"), costCode: form.get("costCode"), notes: form.get("notes") } : { hours: form.get("hours"), ptoType: form.get("ptoType"), notes: form.get("notes") }); }}><div className="form-summary"><span className="avatar large">{employee.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><strong>{employee.name}</strong><span>{prettyDate(date)} · {employee.shiftColor} {employee.shiftPeriod}</span></div></div><div className="form-grid"><label><span>Hours</span><input name="hours" type="number" min="0.25" max="24" step="0.25" defaultValue="12" required /></label>{type === "ot" ? <label><span>Cost code</span><input name="costCode" placeholder="Example: EXTR-OT" required /></label> : <label><span>PTO type</span><select name="ptoType" defaultValue="Vacation"><option>Vacation</option><option>Sick</option><option>Personal</option><option>Bereavement</option><option>Other</option></select></label>}</div><label><span>Notes <em>optional</em></span><textarea name="notes" rows={3} placeholder="Add any useful context" /></label><button className="primary-button full" disabled={busy}>{busy ? "Saving…" : type === "ot" ? "Save overtime" : "Save PTO"}</button></form>;
}

function EmployeeForm({ employee, busy, onSave }: { employee: Employee; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSave({ name: form.get("name"), department: form.get("department"), shiftColor: form.get("shiftColor"), shiftPeriod: form.get("shiftPeriod"), active: form.get("active") === "on" }); }}><label><span>Employee name</span><input name="name" defaultValue={employee.name} required autoFocus /></label><label><span>Department</span><input name="department" defaultValue={employee.department} required /></label><div className="form-grid"><label><span>Shift color</span><select name="shiftColor" defaultValue={employee.shiftColor}><option>Blue</option><option>Yellow</option></select></label><label><span>Shift period</span><select name="shiftPeriod" defaultValue={employee.shiftPeriod}><option>Day</option><option>Night</option></select></label></div><label className="checkbox-label"><input type="checkbox" name="active" defaultChecked={employee.active} /><span>Active employee</span></label><button className="primary-button full" disabled={busy}>{busy ? "Saving…" : "Save employee"}</button></form>;
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
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one data row.");
  const headers = rows[0].map((header) => header.toLowerCase().replaceAll(" ", "_"));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function downloadImportTemplate(kind: ImportKind) {
  const csv = kind === "employees"
    ? "name,shift_color,shift_period,department,active\nEmployee One,Blue,Day,Extrusion,true\nEmployee Two,Yellow,Night,Extrusion,true\n"
    : "type,date,employee_name,hours,code_or_type,notes\nOT,2026-06-15,Employee One,12,EXTR-OT,Weekend coverage\nPTO,2026-07-02,Employee One,12,Vacation,Approved vacation\n";
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
        ? parsed.map((row) => ({
            name: row.name,
            shiftColor: row.shift_color?.toLowerCase() === "yellow" ? "Yellow" : row.shift_color?.toLowerCase() === "blue" ? "Blue" : row.shift_color,
            shiftPeriod: row.shift_period?.toLowerCase() === "night" ? "Night" : row.shift_period?.toLowerCase() === "day" ? "Day" : row.shift_period,
            department: row.department || "Extrusion",
            active: !["false", "no", "0", "inactive"].includes((row.active || "true").toLowerCase()),
          }))
        : parsed.map((row) => ({
            type: row.type?.toUpperCase(),
            date: normalizeDateValue(row.date || ""),
            employeeName: row.employee_name,
            hours: row.hours,
            codeOrType: row.code_or_type,
            notes: row.notes || "",
          }));
      setFileError("");
      await onImport(rows);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "The CSV could not be read.");
    }
  }

  return <form className="modal-form import-form" onSubmit={(event) => void submit(event)}><p className="modal-copy">{employeeImport ? "Start with the employee roster. Existing employees with the same name will be updated instead of duplicated." : "Import overtime and PTO together after the employee roster is loaded. Employee names must match the roster exactly."}</p><div className="template-box"><div><strong>Use the import template</strong><span>{employeeImport ? "Columns: name, shift_color, shift_period, department, active" : "Columns: type, date, employee_name, hours, code_or_type, notes"}</span></div><button type="button" className="secondary-button" onClick={() => downloadImportTemplate(kind)}>Download template</button></div><label className="file-picker"><span>Completed CSV file</span><input type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setFileError(""); }} /></label>{fileError && <div className="field-error">{fileError}</div>}<div className="privacy-note"><strong>Company data reminder</strong><span>Only import real employee or PTO information after your company has approved this private pilot.</span></div><button className="primary-button full" disabled={busy || !file}>{busy ? "Importing…" : employeeImport ? "Import employees" : "Import historical records"}</button></form>;
}

function OverrideForm({ date, current, override, busy, onSave, onRemove }: { date: string; current: ShiftColor; override?: Override; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onRemove: () => Promise<void> }) {
  return <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onSave({ shiftColor: form.get("shiftColor"), reason: form.get("reason") }); }}><p className="modal-copy">Change the working color for <strong>{prettyDate(date)}</strong>. Overtime availability will update immediately.</p><label><span>Working color</span><select name="shiftColor" defaultValue={current}><option>Blue</option><option>Yellow</option></select></label><label><span>Reason</span><textarea name="reason" rows={3} defaultValue={override?.reason} placeholder="Calendar correction, holiday adjustment, etc." /></label><div className="button-row">{override && <button type="button" className="danger-button" disabled={busy} onClick={() => void onRemove()}>Remove correction</button>}<button className="primary-button" disabled={busy}>Save correction</button></div></form>;
}

function EntryTable({ title, entries, canDelete, onDelete }: { title: string; entries: Array<{ id: string; name: string; detail: string; hours: number; notes: string }>; canDelete: boolean; onDelete: (id: string) => void }) {
  return <section className="panel table-panel"><div className="panel-head padded"><h2>{title}</h2><span className="subtle-count">{entries.length} entries</span></div>{entries.length ? <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Type / code</th><th>Hours</th><th>Notes</th>{canDelete && <th />}</tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><strong>{entry.name}</strong></td><td>{entry.detail}</td><td>{entry.hours}</td><td className="notes-cell">{entry.notes || "—"}</td>{canDelete && <td><button className="delete-link" onClick={() => onDelete(entry.id)}>Remove</button></td>}</tr>)}</tbody></table></div> : <EmptyState title="Nothing entered for this date" body="Use the employee roster above to add an entry." />}</section>;
}

function CalendarView({ monthValue, setMonthValue, overrides, isAdmin, onSelect }: { monthValue: string; setMonthValue: (value: string) => void; overrides: Override[]; isAdmin: boolean; onSelect: (date: string) => void }) {
  const focus = dateFromInput(monthValue);
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return date; });
  const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  function moveMonth(amount: number) { setMonthValue(toDateInput(new Date(first.getFullYear(), first.getMonth() + amount, 1))); }
  return <><div className="page-heading"><div><p className="eyebrow">Automatic rotation</p><h1>Shift Calendar</h1><span>Verified 2-2-3 Yellow and Blue schedule. Admin corrections are marked.</span></div><div className="month-controls"><button onClick={() => moveMonth(-1)}>‹</button><strong>{title}</strong><button onClick={() => moveMonth(1)}>›</button></div></div><section className="calendar-panel"><div className="weekday-row">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{days.map((date) => { const dateValue = toDateInput(date); const color = shiftForDate(dateValue, overrides); const override = overrides.find((item) => item.workDate === dateValue); const outside = date.getMonth() !== first.getMonth(); return <button key={dateValue} className={`calendar-day ${color.toLowerCase()} ${outside ? "outside" : ""}`} onClick={() => isAdmin && onSelect(dateValue)} disabled={!isAdmin}><span>{date.getDate()}</span><ShiftBadge color={color} compact />{override && <em title={override.reason || "Admin correction"}>Corrected</em>}</button>; })}</div></section><div className="calendar-legend"><ShiftBadge color="Blue" /><span>Blue Day & Night working</span><ShiftBadge color="Yellow" /><span>Yellow Day & Night working</span>{isAdmin && <small>Click a date to correct its scheduled color.</small>}</div></>;
}

function ReportTable({ data, employeesById, start, end }: { data: Bundle; employeesById: Map<string, Employee>; start: string; end: string }) {
  const rows = data.employees.map((employee) => {
    const ot = data.overtimeEntries.filter((entry) => entry.employeeId === employee.id && entry.workDate >= start && entry.workDate <= end);
    const pto = data.ptoEntries.filter((entry) => entry.employeeId === employee.id && entry.ptoDate >= start && entry.ptoDate <= end);
    return { employee, otHours: ot.reduce((sum, entry) => sum + entry.hours, 0), otCount: ot.length, ptoHours: pto.reduce((sum, entry) => sum + entry.hours, 0), ptoCount: pto.length };
  }).filter((row) => row.otCount || row.ptoCount || row.employee.active).sort((a, b) => b.otHours - a.otHours);
  void employeesById;
  return <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Shift</th><th>OT hours</th><th>OT entries</th><th>PTO hours</th><th>PTO entries</th></tr></thead><tbody>{rows.map((row) => <tr key={row.employee.id}><td><strong>{row.employee.name}</strong></td><td><ShiftBadge color={row.employee.shiftColor} compact /> {row.employee.shiftPeriod}</td><td><strong>{row.otHours.toFixed(1)}</strong></td><td>{row.otCount}</td><td>{row.ptoHours.toFixed(1)}</td><td>{row.ptoCount}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Totals</td><td>{rows.reduce((sum, row) => sum + row.otHours, 0).toFixed(1)}</td><td>{rows.reduce((sum, row) => sum + row.otCount, 0)}</td><td>{rows.reduce((sum, row) => sum + row.ptoHours, 0).toFixed(1)}</td><td>{rows.reduce((sum, row) => sum + row.ptoCount, 0)}</td></tr></tfoot></table></div></section>;
}
