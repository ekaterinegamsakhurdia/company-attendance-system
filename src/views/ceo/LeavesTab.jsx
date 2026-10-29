import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { useToast } from '../../components/Toast';
import { ConfirmDialog, Modal } from '../../components/Modal';
import DevLeaveModal from '../../components/DevLeaveModal';
import DecideModal from '../../components/DecideModal';
import PersonLink from '../../components/PersonLink';
import { Alert, DataTable, Field, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import { cancelLeave, devDeleteLeave, devDeleteLeaves, listLeaves } from '../../services/api';
import { CATEGORIES, canDecide, categoryLabel, statusLabel, statusTone } from '../../lib/leaves';
import { dateRange, parseYmd } from '../../lib/calendar';
import { formatDateTime, todayInTz } from '../../lib/time';

/** A manager cancels someone else's leave: a reason is required and is logged. */
function CancelModal({ leave, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (reason.trim().length < 3) return setError('Please give a reason (at least 3 characters).');
    setBusy(true);
    setError('');
    try {
      await cancelLeave(leave.id, reason);
      toast.success('Leave cancelled.');
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Cancel ${leave.employee_name}'s leave?`}
      description={`${categoryLabel(leave.category)} · ${dateRange(leave.start_date, leave.end_date)}. The days are given back.`}
      onClose={busy ? () => {} : onClose}
    >
      <form onSubmit={submit}>
        <Field label="Reason" id="cancel-reason">
          <input id="cancel-reason" className="la-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
        </Field>
        {error && <Alert error>{error}</Alert>}
        <div className="la-modal-actions">
          <PillButton variant="secondary" onClick={onClose} disabled={busy}>
            Back
          </PillButton>
          <button type="submit" className="la-btn danger" disabled={busy}>
            {busy ? 'Saving…' : 'Cancel leave'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Every leave request (CEOs, developers and department heads): filters, decide, cancel; developers also add, edit and delete.
 * `pending` is the shared "waiting for a decision" list (so the tab badge stays in step).
 * `directory` is only given to CEOs / developers.
 */
export default function LeavesTab({ pending, directory }) {
  const { employee: me, headDepartment, timezone } = useAuth();
  const toast = useToast();
  const isDeveloper = me.role === 'developer';
  const isAdmin = me.role === 'ceo' || isDeveloper;
  const today = todayInTz(timezone);
  const thisYear = parseYmd(today).y;
  const employees = directory?.employees ?? [];

  const [year, setYear] = useState(thisYear);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  const [deciding, setDeciding] = useState(null); // { leave, decision }
  const [cancelling, setCancelling] = useState(null);
  const [editing, setEditing] = useState(null); // leave | {} for a new one
  const [toDelete, setToDelete] = useState(null);
  const [picked, setPicked] = useState(() => new Set()); // developer: ticked leave ids
  const [bulkDelete, setBulkDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const all = useLoad(() => listLeaves('managed', { from: `${year}-01-01`, to: `${year}-12-31` }), [year]);

  const roleOf = (id) => employees.find((e) => e.id === id)?.role;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (all.data ?? []).filter(
      (l) =>
        (!status || l.status === status) &&
        (!category || l.category === category) &&
        (!departmentId || l.department_id === departmentId) &&
        (!q || l.employee_name.toLowerCase().includes(q) || l.employee_number.toLowerCase().includes(q)),
    );
  }, [all.data, status, category, departmentId, search]);

  // Only leaves that are still in the list count as selected (a filter change drops the rest).
  const chosen = useMemo(() => rows.filter((l) => picked.has(l.id)), [rows, picked]);
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const selectAllRef = useRef(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = chosen.length > 0 && !allChosen;
  }, [chosen.length, allChosen]);
  const togglePick = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setPicked(allChosen ? new Set() : new Set(rows.map((l) => l.id)));

  const reload = () => {
    all.reload();
    pending.reload();
  };

  async function confirmDelete() {
    setBusy(true);
    try {
      await devDeleteLeave(toDelete.id);
      toast.success('Leave deleted.');
      setToDelete(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmBulkDelete() {
    setBusy(true);
    try {
      const n = await devDeleteLeaves(chosen.map((l) => l.id));
      toast.success(`${n} ${n === 1 ? 'leave' : 'leaves'} deleted.`);
      setBulkDelete(false);
      setPicked(new Set());
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  // A CEO cannot change a developer's leave (the database says so too).
  const canCancelRow = (l) => (l.status === 'pending' || l.status === 'approved') && (isDeveloper || roleOf(l.employee_id) !== 'developer');

  return (
    <>
      <SectionCard
        icon={ClipboardList}
       
        title="All requests"
        action={
          isDeveloper ? (
            <PillButton size="sm" icon={Plus} onClick={() => setEditing({})}>
              Add leave
            </PillButton>
          ) : null
        }
      >
        <div className="la-toolbar">
          <Field label="Year" id="lv-year">
            <select id="lv-year" className="la-input compact" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </Field>
          <Field label="Status" id="lv-status">
            <select id="lv-status" className="la-input compact" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {['pending', 'approved', 'rejected', 'cancelled'].map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </Field>
          <Field label="Type" id="lv-type">
            <select id="lv-type" className="la-input compact" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </Field>
          {(isAdmin || Boolean(headDepartment?.approves_all_leaves)) && (directory?.departments?.length ?? 0) > 0 && (
            <Field label="Department" id="lv-dept">
              <select id="lv-dept" className="la-input compact" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">All</option>
                {directory.departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Search" id="lv-search">
            <input id="lv-search" className="la-input compact" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or number" />
          </Field>
        </div>

        {isDeveloper && chosen.length > 0 && (
          <div className="la-toolbar la-bulkbar" role="region" aria-label="Selected leaves">
            <span className="la-meta"><strong>{chosen.length}</strong> selected</span>
            <PillButton variant="danger" size="sm" icon={Trash2} onClick={() => setBulkDelete(true)}>
              Delete selected
            </PillButton>
            <PillButton variant="secondary" size="sm" onClick={() => setPicked(new Set())}>
              Clear selection
            </PillButton>
          </div>
        )}

        {all.error && <Alert error>{all.error}</Alert>}
        {all.loading && !all.data ? (
          <Message>Loading…</Message>
        ) : rows.length === 0 ? (
          <Message>No leave requests match.</Message>
        ) : (
          <DataTable
            headers={[
              ...(isDeveloper
                ? [{
                    label: 'Select',
                    className: 'la-th-check',
                    node: (
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        aria-label="Select all shown leaves"
                        checked={allChosen}
                        onChange={toggleAll}
                      />
                    ),
                  }]
                : []),
              'Employee', 'Type', 'Dates', 'Days', 'Status', 'Replacement', 'Decided by', 'Note', 'Actions',
            ]}
            minWidth={isDeveloper ? 1240 : 1180}
          >
            {rows.map((l) => (
              <tr key={l.id} className={picked.has(l.id) ? 'la-row-picked' : undefined}>
                {isDeveloper && (
                  <td className="la-td la-td-check">
                    <input
                      type="checkbox"
                      aria-label={`Select ${l.employee_name}, ${categoryLabel(l.category)} ${dateRange(l.start_date, l.end_date)}`}
                      checked={picked.has(l.id)}
                      onChange={() => togglePick(l.id)}
                    />
                  </td>
                )}
                <td className="la-td"><PersonLink id={l.employee_id}>{l.employee_name}</PersonLink></td>
                <td className="la-td">{categoryLabel(l.category)}</td>
                <td className="la-td">{dateRange(l.start_date, l.end_date)}</td>
                <td className="la-td num">{l.working_days}</td>
                <td className="la-td"><Pill tone={statusTone(l.status)}>{statusLabel(l.status)}</Pill></td>
                <td className="la-td">{l.replacement_name ?? '-'}</td>
                <td className="la-td">
                  {l.decided_by_name ? (
                    <>
                      {l.decided_by_name}
                      <div className="la-meta">{l.decided_at ? formatDateTime(l.decided_at, timezone) : ''}</div>
                    </>
                  ) : (
                    '-'
                  )}
                </td>
                <td className="la-td wrap">{[l.comment, l.decision_comment].filter(Boolean).join(' · ') || '-'}</td>
                <td className="la-td">
                  <div className="la-toolbar">
                    {canDecide(l, me, headDepartment) && (
                      <>
                        <PillButton size="sm" onClick={() => setDeciding({ leave: l, decision: 'approved' })}>
                          Approve
                        </PillButton>
                        <PillButton variant="danger" size="sm" onClick={() => setDeciding({ leave: l, decision: 'rejected' })}>
                          Reject
                        </PillButton>
                      </>
                    )}
                    {canCancelRow(l) && l.employee_id !== me.id && (
                      <PillButton variant="secondary" size="sm" onClick={() => setCancelling(l)}>
                        Cancel
                      </PillButton>
                    )}
                    {isDeveloper && (
                      <>
                        <PillButton variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(l)}>
                          Edit
                        </PillButton>
                        <PillButton variant="danger" size="sm" icon={Trash2} onClick={() => setToDelete(l)}>
                          Delete
                        </PillButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      {deciding && <DecideModal leave={deciding.leave} decision={deciding.decision} onClose={() => setDeciding(null)} onDone={reload} />}
      {cancelling && <CancelModal leave={cancelling} onClose={() => setCancelling(null)} onDone={reload} />}
      {editing && <DevLeaveModal leave={editing.id ? editing : null} employees={employees} onClose={() => setEditing(null)} onSaved={reload} />}
      {bulkDelete && (
        <ConfirmDialog
          title={`Delete ${chosen.length} ${chosen.length === 1 ? 'leave' : 'leaves'}?`}
          danger
          confirmLabel={`Delete ${chosen.length} permanently`}
          busy={busy}
          onCancel={() => setBulkDelete(false)}
          onConfirm={confirmBulkDelete}
          message={`${chosen.slice(0, 5).map((l) => `${l.employee_name}: ${categoryLabel(l.category)} ${dateRange(l.start_date, l.end_date)}`).join('\n')}${chosen.length > 5 ? `\n… and ${chosen.length - 5} more` : ''}\n\nThey disappear from the calendar and the days are given back. Each one is logged.`}
        />
      )}
      {toDelete && (
        <ConfirmDialog
          title={`Delete ${toDelete.employee_name}'s leave?`}
          danger
          confirmLabel="Delete permanently"
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          message={`${categoryLabel(toDelete.category)} · ${dateRange(toDelete.start_date, toDelete.end_date)}\n\nIt disappears from the calendar and the days are given back. This is logged.`}
        />
      )}
    </>
  );
}
