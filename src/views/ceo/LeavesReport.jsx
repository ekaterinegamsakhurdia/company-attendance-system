import { useMemo } from 'react';
import { CalendarCheck, Download } from 'lucide-react';
import PersonLink from '../../components/PersonLink';
import { useLoad } from '../../hooks/useLoad';
import { Alert, DataTable, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import { listLeaves } from '../../services/api';
import { downloadCsv, toCsv } from '../../lib/csv';
import { dateRange } from '../../lib/calendar';
import { CATEGORIES, categoryLabel, statusLabel, statusTone } from '../../lib/leaves';

/** Leave requests that touch the chosen dates, for the people picked in the Reports filters. */
export default function LeavesReport({ people, range, leaveTypes, status }) {
  const { from, to } = range;
  const valid = Boolean(from && to && from <= to);
  const leaves = useLoad(() => listLeaves('managed', { from, to, status: status || null }), [from, to, status], { enabled: valid });

  const rows = useMemo(() => {
    const ids = new Set(people.map((p) => p.id));
    return (leaves.data ?? [])
      .filter((l) => ids.has(l.employee_id) && (leaveTypes.length === 0 || leaveTypes.includes(l.category)))
      .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.employee_name.localeCompare(b.employee_name));
  }, [leaves.data, people, leaveTypes]);

  const totals = useMemo(() => {
    const out = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
    for (const l of rows) if (l.status === 'approved') out[l.category] += l.working_days;
    return out;
  }, [rows]);

  function exportCsv() {
    const columns = [
      { label: 'Employee #', get: (l) => l.employee_number },
      { label: 'Name', get: (l) => l.employee_name },
      { label: 'Type', get: (l) => categoryLabel(l.category) },
      { label: 'Start', get: (l) => l.start_date },
      { label: 'End', get: (l) => l.end_date },
      { label: 'Working days', get: (l) => l.working_days },
      { label: 'Status', get: (l) => statusLabel(l.status) },
      { label: 'Approver', get: (l) => l.approver_name ?? '' },
      { label: 'Decided by', get: (l) => l.decided_by_name ?? '' },
      { label: 'Replacement', get: (l) => l.replacement_name ?? '' },
      { label: 'Note', get: (l) => [l.comment, l.decision_comment].filter(Boolean).join(' · ') },
    ];
    downloadCsv(`leaves_${from}_to_${to}.csv`, toCsv(rows, columns));
  }

  return (
    <SectionCard
      icon={CalendarCheck}
     
      title="Leaves"
      action={
        <PillButton size="sm" icon={Download} onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </PillButton>
      }
    >
      {!valid && <Alert error>Choose a range where &ldquo;From&rdquo; is before &ldquo;To&rdquo;.</Alert>}
      {leaves.error && <Alert error>{leaves.error}</Alert>}
      {valid && (
        <p className="la-meta" data-testid="leaves-summary">
          {rows.length} request{rows.length === 1 ? '' : 's'} · approved working days: {CATEGORIES.map((c) => `${c.short} ${totals[c.id]}`).join(' · ')}
        </p>
      )}
      {valid && (leaves.loading && !leaves.data ? (
        <Message>Loading…</Message>
      ) : rows.length === 0 ? (
        <Message>No leave requests match these filters.</Message>
      ) : (
        <DataTable headers={['Employee', 'Type', 'Dates', 'Days', 'Status', 'Approver', 'Decided by', 'Replacement', 'Note']} minWidth={1100}>
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="la-td"><PersonLink id={l.employee_id}>{l.employee_name}</PersonLink></td>
              <td className="la-td">{categoryLabel(l.category)}</td>
              <td className="la-td">{dateRange(l.start_date, l.end_date)}</td>
              <td className="la-td num">{l.working_days}</td>
              <td className="la-td"><Pill tone={statusTone(l.status)}>{statusLabel(l.status)}</Pill></td>
              <td className="la-td">{l.approver_name ?? '-'}</td>
              <td className="la-td">{l.decided_by_name ?? '-'}</td>
              <td className="la-td">{l.replacement_name ?? '-'}</td>
              <td className="la-td wrap">{[l.comment, l.decision_comment].filter(Boolean).join(' · ') || '-'}</td>
            </tr>
          ))}
        </DataTable>
      ))}
    </SectionCard>
  );
}
