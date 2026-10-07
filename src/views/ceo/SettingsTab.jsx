import { useState } from 'react';
import { Briefcase, Building2, Plus, Settings, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import { useToast } from '../../components/Toast';
import { Alert, DataTable, Field, Message, Pill, PillButton, SectionCard } from '../../components/ui';
import {
  addMyNetwork,
  addNetwork,
  createDepartment,
  createJobRole,
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
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveCompanySettings({
        company_name: form.company_name.trim(),
        work_start_time: form.work_start_time,
        work_end_time: form.work_end_time,
        timezone: form.timezone.trim(),
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
  const [error, setError] = useState('');

  const list = networks.data ?? [];
  const activeCount = list.filter((n) => n.is_active).length;

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
      <SectionCard icon={ShieldCheck} eyebrow="Clock-in rules" title="Clock-in Security">
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

      <SectionCard icon={Wifi} eyebrow="Clock-in rules" title="Company Networks">
        <div className="la-meta">
          {detected.data?.ip ? (
            <>This connection appears as <strong>{detected.data.ip}</strong>. </>
          ) : (
            <>Your public IP could not be detected from this connection. </>
          )}
          Offices usually have one public IPv4 address; if your wifi also hands out IPv6, add that network too (use
          "Add my current network" while connected over IPv6).
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

        {list.length === 0 ? (
          <Message>No networks yet. Add one before turning on the network rule.</Message>
        ) : (
          <DataTable headers={['Label', 'Network', 'Status', '']}>
            {list.map((n) => (
              <tr key={n.id}>
                <td className="la-td">{n.label}</td>
                <td className="la-td">{n.network}</td>
                <td className="la-td">{n.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Off</Pill>}</td>
                <td className="la-td">
                  <div className="la-toolbar">
                    <PillButton variant="ghost" size="sm" disabled={busy} onClick={() => run(() => updateNetwork(n.id, { is_active: !n.is_active }))}>
                      {n.is_active ? 'Turn off' : 'Turn on'}
                    </PillButton>
                    <PillButton variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={() => run(() => deleteNetwork(n.id), 'Network removed.')}>
                      Remove
                    </PillButton>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
        {settings.require_company_network && activeCount === 0 && <Alert error>No active network: nobody can clock in.</Alert>}
      </SectionCard>
    </>
  );
}

/* ------------------------------------------------------------------ */
function Departments({ directory }) {
  const toast = useToast();
  const { departments, employees, reloadDepartments } = directory;
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
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

  const members = (id) => employees.filter((e) => e.department_id === id && e.is_active);

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
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
function JobRoles({ directory }) {
  const toast = useToast();
  const { departments, jobRoles, employees, reloadJobRoles } = directory;
  const [deptId, setDeptId] = useState('');
  const [name, setName] = useState('');
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

  const deptName = (id) => departments.find((d) => d.id === id)?.name ?? '-';
  const count = (id) => employees.filter((e) => e.job_role_id === id && e.is_active).length;

  return (
    <>
      <p className="la-meta">
        Job roles split a department into positions, e.g. Production → Montage, Operator, Motion Designer. An employee can
        hold one role in their own department.
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
        <DataTable headers={['Department', 'Job role', 'Employees', 'Status', '']}>
          {[...jobRoles]
            .sort((a, b) => deptName(a.department_id).localeCompare(deptName(b.department_id)) || a.name.localeCompare(b.name))
            .map((r) => (
              <tr key={r.id}>
                <td className="la-td">{deptName(r.department_id)}</td>
                <td className="la-td">{r.name}</td>
                <td className="la-td">{count(r.id)}</td>
                <td className="la-td">{r.is_active ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Inactive</Pill>}</td>
                <td className="la-td">
                  <PillButton variant="ghost" size="sm" disabled={busy} onClick={() => run(() => updateJobRole(r.id, { is_active: !r.is_active }), r.is_active ? 'Job role deactivated.' : 'Job role activated.')}>
                    {r.is_active ? 'Deactivate' : 'Activate'}
                  </PillButton>
                </td>
              </tr>
            ))}
        </DataTable>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
export default function SettingsTab({ directory }) {
  const settings = useLoad(fetchCompanySettings);

  return (
    <>
      <SectionCard icon={Settings} eyebrow="Company" title="Company Settings">
        {settings.error && <Alert error>{settings.error}</Alert>}
        {settings.data ? (
          <CompanyForm key={settings.data.updated_at} initial={settings.data} onSaved={settings.reload} />
        ) : (
          !settings.error && <Message>Loading…</Message>
        )}
      </SectionCard>

      <SecurityCard />

      <SectionCard icon={Building2} eyebrow="Organisation" title="Departments">
        <Departments directory={directory} />
      </SectionCard>

      <SectionCard icon={Briefcase} eyebrow="Organisation" title="Job Roles">
        <JobRoles directory={directory} />
      </SectionCard>
    </>
  );
}
