import { useMemo, useState } from 'react';
import { useProfileCard } from '../../hooks/useProfileCard';
import { ChevronLeft, ChevronRight, Filter, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import MultiSelect from '../../components/MultiSelect';
import { Field, PillButton } from '../../components/ui';
import { listProfiles } from '../../services/api';
import { monthEnd, shiftRange } from '../../lib/calendar';
import { CATEGORIES, STATUS_LABELS } from '../../lib/leaves';
import { monthStartInTz } from '../../lib/time';
import { NO_TEAM, approverOptions, filterPeople, hasFilters } from '../../lib/reportFilters';
import Timesheet from './Timesheet';
import RecordsReport from './RecordsReport';
import LeavesReport from './LeavesReport';

const VIEWS = [
  { id: 'timesheet', label: 'Timesheet' },
  { id: 'records', label: 'Records' },
  { id: 'leaves', label: 'Leaves' },
];
const EMPTY_PROFILES = new Map();
const fullName = (e) => `${e.first_name} ${e.last_name}`;

/**
 * Reports: a timesheet grid, the raw clock-in / clock-out records and a leave report,
 * all narrowed by the same filters (dates, employees, teams, approvers, leave types).
 * readOnly (department heads): their own department, no Teams / Approvers filters, no editing.
 */
export default function ReportsTab({ directory, readOnly = false }) {
  const { timezone } = useAuth();
  const [view, setView] = useState('timesheet');
  const monthStart = monthStartInTz(timezone);
  const [range, setRange] = useState(() => ({ from: monthStart, to: monthEnd(monthStart) }));
  const [employeeIds, setEmployeeIds] = useState([]);
  const [teamIds, setTeamIds] = useState([]);
  const [approverIds, setApproverIds] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [status, setStatus] = useState('');
  const [showFilters, setShowFilters] = useState(true);

  const card = useProfileCard();
  const profileRows = useLoad(listProfiles, [card?.version], { enabled: !readOnly });
  const profiles = useMemo(
    () => (readOnly ? EMPTY_PROFILES : new Map((profileRows.data ?? []).map((p) => [p.employee_id, p]))),
    [readOnly, profileRows.data],
  );

  const everyone = directory.employees;
  const departments = useMemo(() => directory.departments ?? [], [directory.departments]);
  const active = useMemo(() => everyone.filter((e) => e.is_active), [everyone]);

  const filters = { employeeIds, teamIds: readOnly ? [] : teamIds, approverIds: readOnly ? [] : approverIds };
  const people = useMemo(
    () => filterPeople({ employees: active, profiles, departments, ...filters }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, profiles, departments, employeeIds, teamIds, approverIds, readOnly],
  );
  // Records also covers people who have since been deactivated.
  const recordIds = useMemo(() => {
    if (!hasFilters(filters)) return null;
    return filterPeople({ employees: everyone, profiles, departments, ...filters }).map((e) => e.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyone, profiles, departments, employeeIds, teamIds, approverIds, readOnly]);

  const employeeOptions = useMemo(
    () => everyone.map((e) => ({ value: e.id, label: fullName(e) + (e.is_active ? '' : ' (inactive)') })).sort((a, b) => a.label.localeCompare(b.label)),
    [everyone],
  );
  const teamOptions = useMemo(
    () => [...departments.map((d) => ({ value: d.id, label: d.name })), { value: NO_TEAM, label: 'CEOs and developers (no department)' }],
    [departments],
  );
  const approvers = useMemo(() => approverOptions(everyone, departments), [everyone, departments]);
  const typeOptions = CATEGORIES.map((c) => ({ value: c.id, label: c.label }));

  const activeCount = [employeeIds, readOnly ? [] : teamIds, readOnly ? [] : approverIds, view === 'records' ? [] : leaveTypes].filter((a) => a.length).length + (view === 'leaves' && status ? 1 : 0);

  function reset() {
    setEmployeeIds([]);
    setTeamIds([]);
    setApproverIds([]);
    setLeaveTypes([]);
    setStatus('');
  }

  const step = (direction) => setRange((r) => (r.from && r.to && r.from <= r.to ? shiftRange(r.from, r.to, direction) : r));

  return (
    <>
      <section className="la-card la-report-bar" aria-label="Report filters">
        <div className="la-seg" role="group" aria-label="Report">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>

        <div className="la-toolbar la-range">
          <PillButton variant="secondary" size="sm" icon={ChevronLeft} onClick={() => step(-1)} aria-label="Previous period" />
          <Field label="From" id="rp-from">
            <input id="rp-from" type="date" className="la-input compact" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </Field>
          <Field label="To" id="rp-to">
            <input id="rp-to" type="date" className="la-input compact" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </Field>
          <PillButton variant="secondary" size="sm" icon={ChevronRight} onClick={() => step(1)} aria-label="Next period" />
          <PillButton variant="secondary" size="sm" onClick={() => setRange({ from: monthStart, to: monthEnd(monthStart) })}>
            This month
          </PillButton>
          <PillButton variant="secondary" size="sm" icon={Filter} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            Filter{activeCount ? ` (${activeCount})` : ''}
          </PillButton>
        </div>

        {showFilters && (
          <div className="la-toolbar la-filters">
            <MultiSelect label="Employees" options={employeeOptions} value={employeeIds} onChange={setEmployeeIds} allLabel="All employees" />
            {!readOnly && <MultiSelect label="Teams" options={teamOptions} value={teamIds} onChange={setTeamIds} allLabel="All teams" />}
            {!readOnly && <MultiSelect label="Approvers" options={approvers} value={approverIds} onChange={setApproverIds} allLabel="All approvers" />}
            {view !== 'records' && <MultiSelect label="Leave types" options={typeOptions} value={leaveTypes} onChange={setLeaveTypes} allLabel="All types" />}
            {view === 'leaves' && (
              <Field label="Status" id="rp-status">
                <select id="rp-status" className="la-input compact" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All</option>
                  {Object.entries(STATUS_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </Field>
            )}
            {activeCount > 0 && (
              <PillButton variant="secondary" size="sm" icon={X} onClick={reset}>
                Clear filters
              </PillButton>
            )}
          </div>
        )}
      </section>

      {view === 'timesheet' && <Timesheet people={people} everyone={active.length} range={range} leaveTypes={leaveTypes} profiles={profiles} />}
      {view === 'records' && <RecordsReport directory={directory} readOnly={readOnly} from={range.from} to={range.to} employeeIds={recordIds} />}
      {view === 'leaves' && <LeavesReport people={people} range={range} leaveTypes={leaveTypes} status={status} />}
    </>
  );
}
