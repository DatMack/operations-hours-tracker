import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import type { CrewPosition, CrewSystem, Employee, TrackerBundle } from "./lib/tracker-api";
import type { ShiftColor } from "./lib/schedule";

type Mutate = (payload: Record<string, unknown>, success: string) => Promise<boolean>;

function initials(name: string) {
  return name.split(" ").filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "?";
}

function changedAt(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ordered<T extends { sortOrder: number; name: string }>(items: T[]) {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function EmptyCrew({ title, body }: { title: string; body: string }) {
  return <div className="crew-empty"><span>+</span><strong>{title}</strong><small>{body}</small></div>;
}

function CrewEmployeeCard({ employee, selected, editable, onSelect, onClear }: { employee: Employee; selected: boolean; editable: boolean; onSelect: () => void; onClear?: () => void }) {
  return <article
    className={`crew-person ${selected ? "selected" : ""} ${editable ? "editable" : ""}`}
    draggable={editable}
    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/employee-id", employee.id); }}
    onClick={editable ? onSelect : undefined}
  >
    <span className="avatar">{initials(employee.name)}</span>
    <span><strong>{employee.name}</strong><small>{employee.department} · {employee.shiftColor} {employee.shiftPeriod}</small></span>
    {onClear && <button type="button" className="crew-clear" onClick={(event) => { event.stopPropagation(); onClear(); }}>Unassign</button>}
  </article>;
}

function TemplateManager({ data, departmentId, busy, onMutate }: { data: TrackerBundle; departmentId: string; busy: boolean; onMutate: Mutate }) {
  const systems = ordered(data.crewSystems.filter((system) => system.departmentId === departmentId));
  const department = data.departments.find((item) => item.id === departmentId);

  function addSystem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void onMutate({ action: "add_crew_system", departmentId, name: form.get("name"), sortOrder: systems.length }, "System added to the template.").then((ok) => { if (ok) formElement.reset(); });
  }

  return <section className="panel crew-template-panel">
    <div className="panel-head"><div><p className="eyebrow">Administrator template</p><h2>{department?.name ?? "Department"} systems & positions</h2></div><span className="subtle-count">Changes apply to all four crews</span></div>
    <div className="crew-template-body">
      <form className="crew-add-system" onSubmit={addSystem}>
        <label><span>New system</span><input name="name" maxLength={100} placeholder="Example: Line One" required /></label>
        <button className="primary-button" disabled={busy || !departmentId}>+ Add system</button>
      </form>
      {systems.length ? <div className="crew-template-list">{systems.map((system) => <SystemEditor key={`${system.id}-${system.updatedAt}`} system={system} positions={ordered(data.crewPositions.filter((position) => position.systemId === system.id))} busy={busy} onMutate={onMutate} />)}</div> : <EmptyCrew title="No systems yet" body="Add the first system, then create its exact line positions." />}
    </div>
  </section>;
}

function SystemEditor({ system, positions, busy, onMutate }: { system: CrewSystem; positions: CrewPosition[]; busy: boolean; onMutate: Mutate }) {
  function saveSystem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onMutate({ action: "update_crew_system", id: system.id, name: form.get("name"), sortOrder: form.get("sortOrder"), active: form.get("active") === "on" }, "System template updated.");
  }

  function addPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    void onMutate({ action: "add_crew_position", systemId: system.id, name: form.get("name"), sortOrder: positions.length, required: true }, "Position added to the system.").then((ok) => { if (ok) formElement.reset(); });
  }

  return <article className={`crew-template-system ${system.active ? "" : "inactive"}`}>
    <form className="crew-system-form" onSubmit={saveSystem}>
      <label><span>System name</span><input name="name" defaultValue={system.name} maxLength={100} required /></label>
      <label className="sort-field"><span>Order</span><input name="sortOrder" type="number" min="0" max="10000" defaultValue={system.sortOrder} required /></label>
      <label className="inline-check"><input name="active" type="checkbox" defaultChecked={system.active} /><span>Active</span></label>
      <button className="secondary-button" disabled={busy}>Save</button>
    </form>
    <div className="crew-position-editor">
      {positions.map((position) => <PositionEditor key={`${position.id}-${position.updatedAt}`} position={position} busy={busy} onMutate={onMutate} />)}
      {system.active && <form className="crew-add-position" onSubmit={addPosition}><input name="name" maxLength={100} placeholder="Add position, such as Team lead" required /><button className="secondary-button" disabled={busy}>+ Add position</button></form>}
    </div>
  </article>;
}

function PositionEditor({ position, busy, onMutate }: { position: CrewPosition; busy: boolean; onMutate: Mutate }) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onMutate({ action: "update_crew_position", id: position.id, name: form.get("name"), sortOrder: form.get("sortOrder"), required: form.get("required") === "on", active: form.get("active") === "on" }, "Position updated.");
  }
  return <form className={`crew-position-form ${position.active ? "" : "inactive"}`} onSubmit={save}>
    <input name="name" aria-label="Position name" defaultValue={position.name} maxLength={100} required />
    <input className="sort-input" name="sortOrder" aria-label="Position order" type="number" min="0" max="10000" defaultValue={position.sortOrder} required />
    <label><input name="required" type="checkbox" defaultChecked={position.required} /><span>Required</span></label>
    <label><input name="active" type="checkbox" defaultChecked={position.active} /><span>Active</span></label>
    <button className="text-button" disabled={busy}>Save</button>
  </form>;
}

export default function CrewPlacement({ data, busy, onMutate }: { data: TrackerBundle; busy: boolean; onMutate: Mutate }) {
  const isSupervisor = data.session.role === "supervisor";
  const isAdmin = data.session.role === "admin";
  const activeDepartments = data.departments.filter((department) => department.active);
  const firstDepartment = data.session.departmentId ?? activeDepartments[0]?.id ?? data.departments[0]?.id ?? "";
  const [departmentId, setDepartmentId] = useState(firstDepartment);
  const [shiftColor, setShiftColor] = useState<ShiftColor>(data.session.shiftColor ?? "Blue");
  const [shiftPeriod, setShiftPeriod] = useState<"Day" | "Night">(data.session.shiftPeriod ?? "Day");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    if (isSupervisor) {
      setDepartmentId(data.session.departmentId ?? "");
      setShiftColor(data.session.shiftColor ?? "Blue");
      setShiftPeriod(data.session.shiftPeriod ?? "Day");
    } else if (!data.departments.some((department) => department.id === departmentId)) {
      setDepartmentId(activeDepartments[0]?.id ?? data.departments[0]?.id ?? "");
    }
  }, [activeDepartments, data.departments, data.session.departmentId, data.session.shiftColor, data.session.shiftPeriod, departmentId, isSupervisor]);

  const department = data.departments.find((item) => item.id === departmentId);
  const crewEmployees = useMemo(() => [...data.employees.filter((employee) => employee.active && employee.departmentId === departmentId && employee.shiftColor === shiftColor && employee.shiftPeriod === shiftPeriod)].sort((a, b) => a.name.localeCompare(b.name)), [data.employees, departmentId, shiftColor, shiftPeriod]);
  const employeeById = useMemo(() => new Map(data.employees.map((employee) => [employee.id, employee])), [data.employees]);
  const systems = ordered(data.crewSystems.filter((system) => system.active && system.departmentId === departmentId));
  const activeSystemIds = new Set(systems.map((system) => system.id));
  const positions = ordered(data.crewPositions.filter((position) => position.active && activeSystemIds.has(position.systemId)));
  const crewEmployeeIds = new Set(crewEmployees.map((employee) => employee.id));
  const placements = data.crewPlacements.filter((placement) => placement.shiftColor === shiftColor && placement.shiftPeriod === shiftPeriod && crewEmployeeIds.has(placement.employeeId));
  const placementByPosition = new Map(placements.map((placement) => [placement.positionId, placement]));
  const placedEmployeeIds = new Set(placements.map((placement) => placement.employeeId));
  const unassigned = crewEmployees.filter((employee) => !placedEmployeeIds.has(employee.id));
  const requiredPositions = positions.filter((position) => position.required);
  const filledRequired = requiredPositions.filter((position) => placementByPosition.has(position.id)).length;
  const canEdit = data.session.role === "admin" || (isSupervisor && data.session.departmentId === departmentId && data.session.shiftColor === shiftColor && data.session.shiftPeriod === shiftPeriod);
  const crewHistory = data.crewPlacementHistory.filter((entry) => crewEmployeeIds.has(entry.employeeId)).slice(0, 20);
  const positionById = new Map(data.crewPositions.map((position) => [position.id, position]));

  function changeDepartment(offset: number) {
    const departments = activeDepartments.length ? activeDepartments : data.departments;
    const current = Math.max(0, departments.findIndex((item) => item.id === departmentId));
    setDepartmentId(departments[(current + offset + departments.length) % departments.length]?.id ?? "");
    setSelectedEmployeeId("");
  }

  function droppedEmployee(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    return event.dataTransfer.getData("text/employee-id");
  }

  async function assign(employeeId: string, positionId: string) {
    if (!canEdit || !employeeId) return;
    const ok = await onMutate({ action: "assign_crew_position", employeeId, positionId }, "Crew placement updated.");
    if (ok) setSelectedEmployeeId("");
  }

  async function clear(employeeId: string) {
    if (!canEdit || !employeeId) return;
    const ok = await onMutate({ action: "clear_crew_placement", employeeId }, "Employee moved to unassigned.");
    if (ok) setSelectedEmployeeId("");
  }

  if (!data.crewPlacementReady) return <>
    <div className="page-heading"><div><p className="eyebrow">Live operations roster</p><h1>Crew Placement</h1><span>Persistent system assignments with a complete movement history.</span></div></div>
    <section className="panel crew-not-ready"><EmptyCrew title="Crew placement storage is not active yet" body={isAdmin ? "Apply the included Crew Placement migration, then refresh this page." : "An administrator is finishing the crew placement setup."} /></section>
  </>;

  return <>
    <div className="page-heading crew-page-heading"><div><p className="eyebrow">Live operations roster</p><h1>Crew Placement</h1><span>{isSupervisor ? "Place your assigned crew and keep the board current until something changes." : "Flip through every crew to see current coverage, gaps, and recent moves."}</span></div>{isAdmin && <button className="secondary-button" onClick={() => setShowTemplates((current) => !current)}>{showTemplates ? "Close template setup" : "Manage templates"}</button>}</div>

    {!departmentId || (isSupervisor && (!data.session.departmentId || !data.session.shiftColor || !data.session.shiftPeriod)) ? <section className="panel"><EmptyCrew title="Crew assignment is incomplete" body="An administrator must assign this supervisor a department, shift color, and Day or Night crew." /></section> : <>
      <section className="crew-selector panel">
        <div><p className="eyebrow">Viewing crew</p><h2>{department?.name ?? "Department"} · {shiftColor} {shiftPeriod}</h2></div>
        {isSupervisor ? <span className="crew-scope-note">Your assigned crew</span> : <div className="crew-selector-controls">
          <button type="button" className="icon-button" onClick={() => changeDepartment(-1)} aria-label="Previous department">‹</button>
          <label><span>Department</span><select value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setSelectedEmployeeId(""); }}>{(activeDepartments.length ? activeDepartments : data.departments).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <button type="button" className="icon-button" onClick={() => changeDepartment(1)} aria-label="Next department">›</button>
          <div className="crew-toggle" aria-label="Shift color">{(["Blue", "Yellow"] as ShiftColor[]).map((color) => <button type="button" className={shiftColor === color ? "active" : ""} key={color} onClick={() => { setShiftColor(color); setSelectedEmployeeId(""); }}>{color}</button>)}</div>
          <div className="crew-toggle" aria-label="Shift period">{(["Day", "Night"] as const).map((period) => <button type="button" className={shiftPeriod === period ? "active" : ""} key={period} onClick={() => { setShiftPeriod(period); setSelectedEmployeeId(""); }}>{period}</button>)}</div>
        </div>}
      </section>

      <section className="crew-summary-grid">
        <article><span>Required spots filled</span><strong>{filledRequired}<small> / {requiredPositions.length}</small></strong></article>
        <article className={requiredPositions.length - filledRequired > 0 ? "attention" : "complete"}><span>Open required spots</span><strong>{Math.max(0, requiredPositions.length - filledRequired)}</strong></article>
        <article><span>Crew employees</span><strong>{crewEmployees.length}</strong></article>
        <article><span>Not placed</span><strong>{unassigned.length}</strong></article>
      </section>

      {showTemplates && isAdmin && <TemplateManager data={data} departmentId={departmentId} busy={busy} onMutate={onMutate} />}

      <div className="crew-board-layout">
        <section className="crew-system-board">
          {systems.length ? systems.map((system) => {
            const systemPositions = positions.filter((position) => position.systemId === system.id);
            const systemFilled = systemPositions.filter((position) => placementByPosition.has(position.id)).length;
            return <article className="panel crew-system-card" key={system.id}>
              <div className="panel-head"><div><p className="eyebrow">System</p><h2>{system.name}</h2></div><span className="coverage-pill">{systemFilled} / {systemPositions.length} placed</span></div>
              <div className="crew-slot-list">{systemPositions.length ? systemPositions.map((position) => {
                const placement = placementByPosition.get(position.id);
                const occupant = placement && employeeById.get(placement.employeeId);
                return <div
                  className={`crew-slot ${occupant ? "filled" : "open"} ${position.required && !occupant ? "required-gap" : ""}`}
                  key={position.id}
                  onDragOver={(event) => { if (canEdit) event.preventDefault(); }}
                  onDrop={(event) => void assign(droppedEmployee(event), position.id)}
                  onClick={() => { if (selectedEmployeeId) void assign(selectedEmployeeId, position.id); }}
                >
                  <div className="crew-slot-label"><strong>{position.name}</strong><span>{position.required ? "Required" : "Optional"}</span></div>
                  {occupant ? <CrewEmployeeCard employee={occupant} selected={selectedEmployeeId === occupant.id} editable={canEdit} onSelect={() => setSelectedEmployeeId((current) => current === occupant.id ? "" : occupant.id)} onClear={canEdit ? () => void clear(occupant.id) : undefined} /> : <div className="crew-open-slot"><strong>Open spot</strong><small>{canEdit ? selectedEmployeeId ? "Click to place selected employee" : "Drag an employee here" : "No employee assigned"}</small></div>}
                </div>;
              }) : <EmptyCrew title="No positions in this system" body={isAdmin ? "Open Manage templates to add positions." : "An administrator has not configured positions yet."} />}</div>
            </article>;
          }) : <section className="panel"><EmptyCrew title="No active systems for this department" body={isAdmin ? "Open Manage templates to build the department roster." : "An administrator has not configured this department yet."} /></section>}
        </section>

        <aside className="crew-side-column">
          <section className="panel crew-pool" onDragOver={(event) => { if (canEdit) event.preventDefault(); }} onDrop={(event) => void clear(droppedEmployee(event))}>
            <div className="panel-head"><div><p className="eyebrow">Crew pool</p><h2>Unassigned</h2></div><span className="subtle-count">{unassigned.length}</span></div>
            {canEdit && <p className="crew-help">Drag a person into a spot, or click a person and then a spot. Drop a placed person here to unassign.</p>}
            <div className="crew-pool-list">{unassigned.length ? unassigned.map((employee) => <CrewEmployeeCard key={employee.id} employee={employee} selected={selectedEmployeeId === employee.id} editable={canEdit} onSelect={() => setSelectedEmployeeId((current) => current === employee.id ? "" : employee.id)} />) : <EmptyCrew title="Everyone is placed" body="There are no unassigned employees in this crew." />}</div>
          </section>
          <section className="panel crew-history">
            <div className="panel-head"><div><p className="eyebrow">Automatic history</p><h2>Recent moves</h2></div></div>
            <div className="crew-history-list">{crewHistory.length ? crewHistory.map((entry) => {
              const employee = employeeById.get(entry.employeeId);
              const previous = entry.previousPositionId ? positionById.get(entry.previousPositionId)?.name ?? "Previous spot" : "Unassigned";
              const next = entry.nextPositionId ? positionById.get(entry.nextPositionId)?.name ?? "New spot" : "Unassigned";
              return <article key={entry.id}><span className="avatar">{initials(employee?.name ?? "Unknown")}</span><span><strong>{employee?.name ?? "Unknown employee"}</strong><small>{previous} → {next}</small><small>{changedAt(entry.changedAt)} · {entry.changedBy}</small></span></article>;
            }) : <EmptyCrew title="No moves recorded" body="Placement changes for this crew will appear here with a timestamp." />}</div>
          </section>
        </aside>
      </div>
    </>}
  </>;
}
