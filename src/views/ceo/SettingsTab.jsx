import { useState } from 'react';
import { Briefcase, Building2, Plus, Settings, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { useToast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/Modal';
import { Alert, DataTable, Field, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import { parseNetworkLines } from '../../lib/networks';
import HolidaysCard from './HolidaysCard';
import {
  addMyNetwork,
  addNetwork,
  addNetworks,
  createDepartment,
  createJobRole,
  deleteDepartment,
  deleteJobRole,
  deleteNetwork,
  fetchCompanySettings,
  fetchNetworkStatus,
  listNetworks,
  saveCompanySettings,
  setDepartmentHead,
  updateDepartment,
  updateJobRole,
  updateNetwork,
} from '../../services/api';

const trimSeconds = (t) => (t ? t.slice(0, 5) : '');

function listTimeZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Tbilisi', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York'];
  }
}

/* ------------------------------------------------------------------ */
function CompanyForm({ initial, onSaved }) {
  const toast = useToast();
  const { refreshSettings } = useAuth();
  const [form, setForm] = useState({
    company_name: initial.company_name,
    work_start_time: trimSeconds(initial.work_start_time),
    work_end_time: trimSeconds(initial.work_end_time),
    timezone: initial.timezone,
    leave_vacation_days: String(initial.leave_vacation_days ?? 24),
    leave_unpaid_days: String(initial.leave_unpaid_days ?? 15),
    leave_day_off_days: String(initial.leave_day_off_days ?? 4),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const days = {};
      for (const key of ['leave_vacation_days', 'leave_unpaid_days', 'leave_day_off_days']) {
        const n = Number(form[key]);
        if (form[key].trim() === '' || !Number.isInteger(n) || n < 0 || n > 366) {
          throw new Error('Leave allowances must be whole numbers of days between 0 and 366.');
        }
        days[key] = n;
      }
      await saveCompanySettings({
        company_name: form.company_name.trim(),
        work_start_time: form.work_start_time,
        work_end_time: form.work_end_time,
        timezone: form.timezone.trim(),
        ...days,
      });
      await refreshSettings();
      toast.success('Settings saved.');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="la-field-grid">
        <Field label="Company name" id="set-name">
          <input id="set-name" className="la-input" value={form.company_name} onChange={set('company_name')} maxLength={100} required />
        </Field>
        <Field label="Time zone" id="set-tz" hint="All times in the app are shown in this zone.">
          <input id="set-tz" className="la-input" list="tz-list" value={form.timezone} onChange={set('timezone')} required />
          <datalist id="tz-list">
            {listTimeZones().map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
        <Field label="Work day starts" id="set-start">
          <input id="set-start" type="time" className="la-input" value={form.work_start_time} onChange={set('work_start_time')} required />
        </Field>
        <Field label="Work day ends" id="set-end" hint="Anyone still clocked in is clocked out automatically at this time.">
          <input id="set-end" type="time" className="la-input" value={form.work_end_time} onChange={set('work_end_time')} required />
        </Field>
      </div>
      <h3 className="la-section-title" style={{ margin: '8px 0 12px' }}>Yearly leave allowance per person</h3>
      <div className="la-field-grid">
        <Field label="Vacation days" id="set-vac" hint="Working days a year. Individual allowances can be changed in Analytics.">
          <input id="set-vac" className="la-input" inputMode="numeric" value={form.leave_vacation_days} onChange={set('leave_vacation_days')} required />
        </Field>
        <Field label="Unpaid leave days" id="set-unpaid">
          <input id="set-unpaid" className="la-input" inputMode="numeric" value={form.leave_unpaid_days} onChange={set('leave_unpaid_days')} required />
        </Field>
        <Field label="Days off" id="set-dayoff">
          <input id="set-dayoff" className="la-input" inputMode="numeric" value={form.leave_day_off_days} onChange={set('leave_day_off_days')} required />
        </Field>
      </div>
      {error && <Alert error>{error}</Alert>}
      <button type="submit" className="la-btn primary block" disabled={busy} style={{ marginTop: 12 }}>
        {busy ? 'Saving…' : 'Save Settings'}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
function SecurityCard() {
  const toast = useToast();
  const { settings, refreshSettings } = useAuth();
  const networks = useLoad(listNetworks);
  const detected = useLoad(() => fetchNetworkStatus());

  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [manualLabel, setManualLabel] = useState('');
  const [manualNet, setManualNet] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState('');

  const list = networks.data ?? [];
  const activeCount = list.filter((n) => n.is_active).length;
  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? list.filter((n) => n.label.toLowerCase().includes(needle) || String(n.network).toLowerCase().includes(needle))
    : list;
  const PAGE = 50;
  const visible = showAll || needle ? matching : matching.slice(0, PAGE);

  async function addMany() {
    const items = parseNetworkLines(bulkText);
    if (items.length === 0) {
      setError('Paste at least one network, one per line.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { added, failed } = await addNetworks(items);
      if (added) toast.success(`${added} network${added === 1 ? '' : 's'} added.`);
      if (failed.length) {
        // keep only the lines that failed so they can be fixed and sent again
        const failedLines = new Set(failed.map((f) => f.line));
        setBulkText(items.filter((i) => failedLines.has(i.line)).map((i) => `${i.label}, ${i.network}`).join('\n'));
        const shown = failed.slice(0, 5).map((f) => `line ${f.line} (${f.network}): ${f.message}`);
        setError(`${failed.length} not added. ${shown.join(' · ')}${failed.length > 5 ? ` · and ${failed.length - 5} more` : ''}`);
      } else {
        setBulkText('');
        setShowBulk(false);
      }
      await Promise.all([networks.reload(), refreshSettings()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function run(action, message) {
    setBusy(true);
    setError('');
    try {
      await action();
      if (message) toast.success(message);
      await Promise.all([networks.reload(), refreshSettings()]);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key, value) =>
    run(() => saveCompanySettings({ [key]: value }), value ? 'Turned on.' : 'Turned off.');

  return (
    <>
      <SectionCard icon={ShieldCheck} title="Clock-in Security">
        <p className="la-meta">
          Logging in with email and password always works from anywhere. These rules apply only to clocking in and out.
        </p>

        <label className="la-tile" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.require_company_network}
            disabled={busy}
            onChange={(e) => toggle('require_company_network', e.target.checked)}
          />
          <div className="la-tile-text">
            <strong>Require the company network</strong>
            <div className="la-meta">Clock in/out is refused unless the connection comes from one of the networks below.</div>
          </div>
        </label>

        <label className="la-tile" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.require_biometric}
            disabled={busy}
            onChange={(e) => toggle('require_biometric', e.target.checked)}
          />
          <div className="la-tile-text">
            <strong>Require Face ID / fingerprint</strong>
            <div className="la-meta">
              Each clock-in and clock-out needs a fresh check on a registered phone or laptop. Employees register a
              device with their password the first time.
            </div>
          </div>
        </label>

        {error && <Alert error>{error}</Alert>}
      </SectionCard>

      <SectionCard icon={Wifi} title="Company Networks">
        <div className="la-meta">
          {detected.data?.ip ? (
            <>This connection appears as <strong>{detected.data.ip}</strong>. </>
          ) : (
            <>Your public IP could not be detected from this connection. </>
          )}
          Add as many networks as you need, there is no limit: every office, branch or home connection has its own
          public address. The app recognises a network by that public IP address, not by the wifi name. Offices usually
          have one public IPv4 address; if your wifi also hands out IPv6, add that network too (use "Add my current
          network" while connected over IPv6).
        </div>
        <div className="la-meta" aria-live="polite">
          <strong>{list.length}</strong> network{list.length === 1 ? '' : 's'} · <strong>{activeCount}</strong> active
        </div>

        <div className="la-toolbar">
          <Field label="Label" id="net-label">
            <input id="net-label" className="la-input compact" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Office wifi" maxLength={80} />
          </Field>
          <PillButton
            size="sm"
            icon={Wifi}
            disabled={busy || !label.trim()}
            onClick={() => run(() => addMyNetwork(label), 'Network added.').then((ok) => ok && setLabel(''))}
          >
            Add my current network
          </PillButton>
        </div>

        <form
          className="la-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addNetwork(manualLabel, manualNet), 'Network added.').then((ok) => {
              if (ok) {
                setManualLabel('');
                setManualNet('');
              }
            });
          }}
        >
          <Field label="Or add manually: label" id="net-m-label">
            <input id="net-m-label" className="la-input compact" value={manualLabel} onChange={(e) => setManualLabel(e.target.value)} maxLength={80} />
          </Field>
          <Field label="IP or range (CIDR)" id="net-m-net">
            <input id="net-m-net" className="la-input compact" value={manualNet} onChange={(e) => setManualNet(e.target.value)} placeholder="203.0.113.7 or 203.0.113.0/28" />
          </Field>
          <button type="submit" className="la-btn secondary sm" disabled={busy || !manualLabel.trim() || !manualNet.trim()}>
            <Plus size={16} aria-hidden="true" /> Add
          </button>
        </form>

        <div>
          <PillButton variant="ghost" size="sm" icon={Plus} onClick={() => setShowBulk((v) => !v)} aria-expanded={showBulk}>
            {showBulk ? 'Hide bulk add' : 'Add many at once'}
          </PillButton>
        </div>
        {showBulk && (
          <div className="la-stack" style={{ gap: 8 }}>
            <Field label="One network per line: label, IP or range" id="net-bulk" hint="Example: Main office, 203.0.113.7 (the label is optional).">
              <textarea
                id="net-bulk"
                className="la-input"
                rows={6}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={'Main office, 203.0.113.7\nBranch Batumi, 198.51.100.0/28\n2001:db8:1234:5678::/64'}
              />
            </Field>
            <div>
              <button type="button" className="la-btn secondary sm" disabled={busy || !bulkText.trim()} onClick={addMany}>
                <Plus size={16} aria-hidden="true" /> Add all
              </button>
            </div>
          </div>
        )}

        {list.length > 8 && (
          <Field label="Search networks" id="net-filter">
            <input
              id="net-filter"
              className="la-input compact"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Label or address"
            />
          </Field>
        )}

        {list.length === 0 ? (
          <Message>No networks yet. Add one before turning on the network rule.</Message>
        ) : matching.length === 0 ? (
          <Message>No network matches "{filter}".</Message>
        ) : (
          <>
            <DataTable headers={['Label', 'Network', 'Status', '']}>
              {visible.map((n) => (
                <tr key={n.id}>
                  <td className="la-td">
                    {editingId === n.id ? (
                      <input
                        className="la-input compact"
                        aria-label={`Label for ${n.network}`}
                        value={editLabel}
                        maxLength={80}
                        onChange={(e) => setEditLabel(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      n.label
                    )}
                  </td>
                  <td className="la-td">{n.network}</td>
                  <td className="la-td">{n.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Off</Pill>}</td>
                  <td className="la-td">
                    <div className="la-toolbar">
                      {editingId === n.id ? (
                        <>
                          <PillButton
                            size="sm"
                            disabled={busy || !editLabel.trim()}
                            onClick={() =>
                              run(() => updateNetwork(n.id, { label: editLabel.trim() }), 'Label saved.').then((ok) => ok && setEditingId(null))
                            }
                          >
                            Save
                          </PillButton>
                          <PillButton variant="ghost" size="sm" disabled={busy} onClick={() => setEditingId(null)}>
                            Cancel
                          </PillButton>
                        </>
                      ) : (
                        <>
                          <PillButton
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(n.id);
                              setEditLabel(n.label);
                            }}
                          >
                            Rename
                          </PillButton>
                          <PillButton variant="ghost" size="sm" disabled={busy} onClick={() => run(() => updateNetwork(n.id, { is_active: !n.is_active }))}>
                            {n.is_active ? 'Turn off' : 'Turn on'}
                          </PillButton>
                          <PillButton variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={() => run(() => deleteNetwork(n.id), 'Network removed.')}>
                            Remove
                          </PillButton>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
            {!needle && matching.length > PAGE && (
              <div className="la-meta">
                Showing {visible.length} of {matching.length}.{' '}
                <button type="button" className="la-link" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : 'Show all'}
                </button>
              </div>
            )}
          </>
        )}
        {settings.require_company_network && activeCount === 0 && <Alert error>No active network: nobody can clock in.</Alert>}
      </SectionCard>
    </>
  );
}

/* ------------------------------------------------------------------ */
export function Departments({ directory }) {
  const toast = useToast();
  const { employee: me } = useAuth();
  const isDeveloper = me.role === 'developer';
  const { departments, employees, reloadDepartments, reloadEmployees, reloadJobRoles } = directory;
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(action, message) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await reloadDepartments();
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const d = toDelete;
    const ok = await run(() => deleteDepartment(d.id), `${d.name} was deleted.`);
    setToDelete(null);
    if (ok) {
      reloadJobRoles?.();
      reloadEmployees?.();
    }
  }

  const members = (id) => employees.filter((e) => e.department_id === id && e.is_active);
  const allMembers = (id) => employees.filter((e) => e.department_id === id);

  return (
    <>
      <form
        className="la-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(() => createDepartment(name), 'Department added.').then((ok) => ok && setName(''));
        }}
      >
        <Field label="New department" id="dept-name">
          <input id="dept-name" className="la-input compact" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Design" />
        </Field>
        <button type="submit" className="la-btn primary sm" disabled={busy || !name.trim()}>
          <Plus size={16} aria-hidden="true" /> Add
        </button>
      </form>

      {departments.length === 0 ? (
        <Message>No departments yet.</Message>
      ) : (
        <DataTable headers={['Name', 'Head', 'Employees', 'Status', '']} minWidth={760}>
          {departments.map((d) => (
            <tr key={d.id}>
              <td className="la-td">
                {editingId === d.id ? (
                  <input className="la-input compact" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Department name" maxLength={80} />
                ) : (
                  d.name
                )}
              </td>
              <td className="la-td">
                <select
                  className="la-input compact"
                  aria-label={`Head of ${d.name}`}
                  value={d.head_employee_id ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    run(
                      () => setDepartmentHead(d.id, e.target.value),
                      e.target.value ? 'Department head set.' : 'Department head cleared.',
                    )
                  }
                >
                  <option value="">No head</option>
                  {members(d.id).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.first_name} {e.last_name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="la-td">{members(d.id).length}</td>
              <td className="la-td">{d.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Inactive</Pill>}</td>
              <td className="la-td">
                <div className="la-toolbar">
                  {editingId === d.id ? (
                    <>
                      <PillButton size="sm" disabled={busy || !editName.trim()} onClick={() => run(() => updateDepartment(d.id, { name: editName.trim() }), 'Department renamed.').then((ok) => ok && setEditingId(null))}>
                        Save
                      </PillButton>
                      <PillButton variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</PillButton>
                    </>
                  ) : (
                    <>
                      <PillButton variant="ghost" size="sm" onClick={() => { setEditingId(d.id); setEditName(d.name); }}>Rename</PillButton>
                      <PillButton variant="ghost" size="sm" disabled={busy} onClick={() => run(() => updateDepartment(d.id, { is_active: !d.is_active }), d.is_active ? 'Department deactivated.' : 'Department activated.')}>
                        {d.is_active ? 'Deactivate' : 'Activate'}
                      </PillButton>
                      {isDeveloper && (
                        <PillButton variant="danger" size="sm" icon={Trash2} disabled={busy} aria-label={`Delete ${d.name}`} onClick={() => setToDelete(d)}>
                          Delete
                        </PillButton>
                      )}
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      {toDelete && (
        <ConfirmDialog
          title={`Delete ${toDelete.name}?`}
          danger
          confirmLabel="Delete department"
          confirmDisabled={allMembers(toDelete.id).length > 0}
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          message={
            allMembers(toDelete.id).length > 0
              ? `${allMembers(toDelete.id).length} employee(s) still belong to this department, so it cannot be deleted. Move them to another department first, or deactivate the department instead.`
              : 'This permanently removes the department and its job roles. This cannot be undone.'
          }
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
export function JobRoles({ directory }) {
  const toast = useToast();
  const { employee: me } = useAuth();
  const isDeveloper = me.role === 'developer';
  const { departments, jobRoles, employees, reloadJobRoles, reloadEmployees } = directory;
  const [deptId, setDeptId] = useState('');
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(action, message) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await reloadJobRoles();
      return true;
    } catch (err) {
      toast.error(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const r = toDelete;
    const ok = await run(() => deleteJobRole(r.id), `${r.name} was deleted.`);
    setToDelete(null);
    if (ok) reloadEmployees?.();
  }

  const deptName = (id) => departments.find((d) => d.id === id)?.name ?? '-';
  const holders = (id) => employees.filter((e) => e.job_role_id === id);
  const count = (id) => holders(id).filter((e) => e.is_active).length;

  return (
    <>
      <p className="la-meta">
        Job roles split a department into positions, e.g. Production → Montage, Operator, Motion Designer. Once a
        department has job roles, every employee in it must have one.
      </p>
      <form
        className="la-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createJobRole(deptId, name), 'Job role added.').then((ok) => ok && setName(''));
        }}
      >
        <Field label="Department" id="role-dept">
          <select id="role-dept" className="la-input compact" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            <option value="">Select…</option>
            {departments.filter((d) => d.is_active).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
        <Field label="New job role" id="role-name">
          <input id="role-name" className="la-input compact" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <button type="submit" className="la-btn primary sm" disabled={busy || !deptId || !name.trim()}>
          <Plus size={16} aria-hidden="true" /> Add
        </button>
      </form>

      {jobRoles.length === 0 ? (
        <Message>No job roles yet.</Message>
      ) : (
        <DataTable headers={['Department', 'Job role', 'Employees', 'Status', '']} minWidth={700}>
          {[...jobRoles]
            .sort((a, b) => deptName(a.department_id).localeCompare(deptName(b.department_id)) || a.name.localeCompare(b.name))
            .map((r) => (
              <tr key={r.id}>
                <td className="la-td">{deptName(r.department_id)}</td>
                <td className="la-td">
                  {editingId === r.id ? (
                    <input className="la-input compact" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Job role name" maxLength={80} />
                  ) : (
                    r.name
                  )}
                </td>
                <td className="la-td">{count(r.id)}</td>
                <td className="la-td">{r.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Inactive</Pill>}</td>
                <td className="la-td">
                  <div className="la-toolbar">
                    {editingId === r.id ? (
                      <>
                        <PillButton size="sm" disabled={busy || !editName.trim()} onClick={() => run(() => updateJobRole(r.id, { name: editName.trim() }), 'Job role renamed.').then((ok) => ok && setEditingId(null))}>
                          Save
                        </PillButton>
                        <PillButton variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</PillButton>
                      </>
                    ) : (
                      <>
                        <PillButton variant="ghost" size="sm" onClick={() => { setEditingId(r.id); setEditName(r.name); }}>Rename</PillButton>
                        <PillButton variant="ghost" size="sm" disabled={busy} onClick={() => run(() => updateJobRole(r.id, { is_active: !r.is_active }), r.is_active ? 'Job role deactivated.' : 'Job role activated.')}>
                          {r.is_active ? 'Deactivate' : 'Activate'}
                        </PillButton>
                        {isDeveloper && (
                          <PillButton variant="danger" size="sm" icon={Trash2} disabled={busy} aria-label={`Delete ${r.name} (${deptName(r.department_id)})`} onClick={() => setToDelete(r)}>
                            Delete
                          </PillButton>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
        </DataTable>
      )}

      {toDelete && (
        <ConfirmDialog
          title={`Delete job role ${toDelete.name}?`}
          danger
          confirmLabel="Delete job role"
          confirmDisabled={holders(toDelete.id).length > 0}
          busy={busy}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          message={
            holders(toDelete.id).length > 0
              ? `${holders(toDelete.id).length} employee(s) still hold this job role, so it cannot be deleted. Change their role first, or deactivate it instead.`
              : 'This permanently removes the job role. This cannot be undone.'
          }
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/** `showOrganisation` is false on the developer dashboard, which has a Structure tab for that. */
export default function SettingsTab({ directory, showOrganisation = true }) {
  const settings = useLoad(fetchCompanySettings);

  return (
    <>
      <SectionCard icon={Settings} title="Company Settings">
        {settings.error && <Alert error>{settings.error}</Alert>}
        {settings.data ? (
          <CompanyForm key={settings.data.updated_at} initial={settings.data} onSaved={settings.reload} />
        ) : (
          !settings.error && <Message>Loading…</Message>
        )}
      </SectionCard>

      <HolidaysCard />

      <SecurityCard />

      {showOrganisation && (
        <>
          <SectionCard icon={Building2} title="Departments">
            <Departments directory={directory} />
          </SectionCard>

          <SectionCard icon={Briefcase} title="Job Roles">
            <JobRoles directory={directory} />
          </SectionCard>
        </>
      )}
    </>
  );
}
