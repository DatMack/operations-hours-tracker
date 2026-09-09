begin;

-- Some pilot installations predate the Production department. Add it without
-- changing any existing department or employee assignment, then provide the
-- facility defaults requested for Blends and Repacks.
insert into public.departments (name, default_cost_code)
values ('Production', 'PRD-100')
on conflict ((lower(name))) do nothing;

insert into public.work_schedules (
  department_id, work_group, name, legacy_shift_color, legacy_shift_period
)
select
  d.id,
  'Blends',
  crew.shift_color || ' ' || crew.shift_period,
  crew.shift_color,
  crew.shift_period
from public.departments d
cross join (values
  ('Blue', 'Day'), ('Blue', 'Night'), ('Yellow', 'Day'), ('Yellow', 'Night')
) crew(shift_color, shift_period)
where lower(d.name) = 'production' and d.active
on conflict (department_id, lower(work_group), lower(name)) do nothing;

insert into public.work_schedule_rules (schedule_id, effective_from, anchor_date, cycle_hours)
select
  s.id,
  date '1900-01-01',
  date '2026-08-10',
  case when s.legacy_shift_color = 'Blue'
    then array[12, 12, 0, 0, 12, 12, 12, 0, 0, 12, 12, 0, 0, 0]::numeric[]
    else array[0, 0, 12, 12, 0, 0, 0, 12, 12, 0, 0, 12, 12, 12]::numeric[]
  end
from public.work_schedules s
join public.departments d on d.id = s.department_id
where lower(d.name) = 'production'
  and lower(s.work_group) = 'blends'
  and s.legacy_shift_color is not null
  and not exists (
    select 1 from public.work_schedule_rules existing
    where existing.schedule_id = s.id and existing.effective_from = date '1900-01-01'
  );

insert into public.work_schedules (department_id, work_group, name)
select d.id, 'Repacks', shift_name
from public.departments d
cross join (values ('1st Shift'), ('2nd Shift'), ('3rd Shift')) names(shift_name)
where lower(d.name) = 'production' and d.active
on conflict (department_id, lower(work_group), lower(name)) do nothing;

insert into public.work_schedule_rules (schedule_id, effective_from, anchor_date, cycle_hours)
select
  s.id,
  date '1900-01-01',
  date '2026-08-10',
  array[8, 8, 8, 8, 8, 0, 0]::numeric[]
from public.work_schedules s
join public.departments d on d.id = s.department_id
where lower(d.name) = 'production'
  and lower(s.work_group) = 'repacks'
  and not exists (
    select 1 from public.work_schedule_rules existing
    where existing.schedule_id = s.id and existing.effective_from = date '1900-01-01'
  );

commit;
