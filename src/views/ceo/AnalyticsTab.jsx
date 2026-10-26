import { useMemo, useState } from 'react';
import { useProfileCard } from '../../hooks/useProfileCard';
import { BarChart3, Download, Pencil } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { Modal } from '../../components/Modal';
import AllowanceForm from '../../components/AllowanceForm';
import PersonLink from '../../components/PersonLink';
import { Alert, DataTable, Field, Message, PillButton, SectionCard, StatTile } from '../../components/ui';
import { fetchAllBalances, listLeaves, listProfiles } from '../../services/api';
import { CATEGORIES, groupBalances } from '../../lib/leaves';
import { averageAge, averageService, teamCount } from '../../lib/celebrations';
import { downloadCsv, toCsv } from '../../lib/csv';
import { parseYmd } from '../../lib/calendar';
import { todayInTz } from '../../lib/time';

const show = (value, suffix = '') => (value === null || value === undefined ? '-' : `${value}${suffix}`);

/** Team numbers and the leave balance of everybody, per type. */
export default function AnalyticsTab({ directory }) {
  const { employee: me, timezone } = useAuth();
  const today = todayInTz(timezone);
  const thisYear = parseYmd(today).y;
  const [year, setYear] = useState(thisYear);
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const card = useProfileCard();
  const profiles = useLoad(listProfiles, [card?.version]);
  const balances = useLoad(() => fetchAllBalances(year), [year]);
  const away = useLoad(() => listLeaves('managed', { from: today, to: today, status: 'approved' }), [today]);

  const { employees, departments } = directory;
  const data = profiles.data ?? [];
  const age = averageAge({ employees, profiles: data, today });
  const service = averageService({ employees, profiles: data, today });
  const team = teamCount({ employees, departments });
  const grouped = useMemo(() => groupBalances(balances.data), [balances.data]);
  const deptName = (id) => departments.find((d) => d.id === id)?.name ?? '-';

  const rows = employees.filter((e) => {
    if (!e.is_active || !grouped.has(e.id)) return false;
    if (departmentId && e.department_id !== departmentId) return false;
    const q = search.trim().toLowerCase();
    return !q || `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) || e.employee_number.toLowerCase().includes(q);
  });

  const canEdit = (e) => me.role === 'developer' || e.role === 'employee' || e.id === me.id;

  function exportCsv() {
    const columns = [
      { label: 'Employee #', get: (e) => e.employee_number },
      { label: 'Name', get: (e) => `${e.first_name} ${e.last_name}` },
      { label: 'Department', get: (e) => deptName(e.department_id) },
      ...CATEGORIES.flatMap((c) => [
        { label: `${c.label} allowance`, get: (e) => grouped.get(e.id)[c.id].allowance },
        { label: `${c.label} used`, get: (e) => grouped.get(e.id)[c.id].used },
        { label: `${c.label} pending`, get: (e) => grouped.get(e.id)[c.id].pending },
        { label: `${c.label} left`, get: (e) => grouped.get(e.id)[c.id].remaining },
      ]),
    ];
    downloadCsv(`leave-balances-${year}.csv`, toCsv(rows, columns));
  }

  return (
    <>
      <SectionCard icon={BarChart3} title="Analytics">
        {profiles.error && <Alert error>{profiles.error}</Alert>}
        <div className="la-grid stats">
          <StatTile value={team.total} label="Team count" />
          <StatTile value={show(age.value, age.value === null ? '' : ' yrs')} label={`Average age${age.counted ? ` (${age.counted} people)` : ''}`} />
          <StatTile value={show(service.value, service.value === null ? '' : ' yrs')} label={`Average length of service${service.counted ? ` (${service.counted} people)` : ''}`} />
          <StatTile value={away.data ? away.data.length : '-'} label="On leave today" />
        </div>
        {(age.counted < team.total || service.counted < team.total) && !profiles.loading && (
          <p className="la-meta">Averages only include people whose birth date and start date are filled in (Birthdays & Anniversaries → Missing dates).</p>
        )}
        {team.byDepartment.length > 0 && (
          <DataTable headers={[{ label: 'Team' }, { label: 'People', className: 'num' }]} minWidth={320}>
            {team.byDepartment.map((d) => (
              <tr key={d.name}>
                <td className="la-td">{d.name}</td>
                <td className="la-td num">{d.count}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <SectionCard
        icon={BarChart3}
       
        title="Used & remaining days"
        action={
          <PillButton variant="secondary" size="sm" icon={Download} onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </PillButton>
        }
      >
        <div className="la-toolbar">
          <Field label="Year" id="an-year">
            <select id="an-year" className="la-input compact" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </Field>
          <Field label="Department" id="an-dept">
            <select id="an-dept" className="la-input compact" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Search" id="an-search">
            <input id="an-search" className="la-input compact" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or number" />
          </Field>
        </div>
        <p className="la-meta">“Used” counts approved leaves; days waiting for approval are shown in brackets and are already taken off “left”.</p>
        {balances.error && <Alert error>{balances.error}</Alert>}
        {balances.loading && !balances.data ? (
          <Message>Loading…</Message>
        ) : rows.length === 0 ? (
          <Message>Nobody matches.</Message>
        ) : (
          <DataTable
            headers={[
              'Employee',
              'Department',
              ...CATEGORIES.flatMap((c) => [{ label: `${c.short} used`, className: 'num' }, { label: `${c.short} left`, className: 'num' }]),
              '',
            ]}
            minWidth={1100}
          >
            {rows.map((e) => {
              const b = grouped.get(e.id);
              return (
                <tr key={e.id}>
                  <td className="la-td"><PersonLink id={e.id}>{e.first_name} {e.last_name}</PersonLink></td>
                  <td className="la-td">{e.department_id ? deptName(e.department_id) : e.role === 'developer' ? 'Developer' : 'CEO'}</td>
                  {CATEGORIES.flatMap((c) => [
                    <td key={`${c.id}-u`} className="la-td num">
                      {b[c.id].used}
                      {b[c.id].pending > 0 && <span className="la-meta"> ({b[c.id].pending})</span>}
                    </td>,
                    <td key={`${c.id}-l`} className="la-td num">
                      <strong>{b[c.id].remaining}</strong>
                      <span className="la-meta"> / {b[c.id].allowance}</span>
                    </td>,
                  ])}
                  <td className="la-td">
                    {canEdit(e) ? (
                      <PillButton variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(e)}>
                        Allowance
                      </PillButton>
                    ) : (
                      <span className="la-protected">Protected</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </SectionCard>

      {editing && (
        <Modal
          title={`Allowance ${year} – ${editing.first_name} ${editing.last_name}`}
          description="Days per year. Use − / + to remove or add days; clear a field to use the company default again."
          onClose={() => setEditing(null)}
        >
          <AllowanceForm
            person={editing}
            balances={grouped.get(editing.id)}
            year={year}
            onCancel={() => setEditing(null)}
            onDone={(changed) => {
              if (changed) balances.reload();
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
