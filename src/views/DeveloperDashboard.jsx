import { useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { listDepartments, listEmployees, listJobRoles } from '../services/api';
import { Alert, Hero, Shell, Tabs } from '../components/ui';
import TodayTab from './ceo/TodayTab';
import ReportsTab from './ceo/ReportsTab';
import EmployeesTab from './ceo/EmployeesTab';
import StructureTab from './ceo/StructureTab';
import SettingsTab from './ceo/SettingsTab';
import AuditTab from './ceo/AuditTab';

const TABS = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'structure', label: 'Structure' },
  { id: 'settings', label: 'Settings' },
  { id: 'today', label: 'Today' },
  { id: 'reports', label: 'Reports' },
  { id: 'audit', label: 'Audit Log' },
];

/**
 * Developers can do everything a CEO can, plus manage accounts (add / remove CEOs,
 * change account types, edit employee data) and delete departments and job roles.
 * They clock in and out like everyone else (Today tab); their records are visible to developers only.
 */
export default function DeveloperDashboard() {
  const { employee, signOut } = useAuth();
  const [tab, setTab] = useState('accounts');

  const employees = useLoad(listEmployees);
  const departments = useLoad(listDepartments);
  const jobRoles = useLoad(listJobRoles);

  const directory = useMemo(
    () => ({
      employees: employees.data ?? [],
      departments: departments.data ?? [],
      jobRoles: jobRoles.data ?? [],
      reloadEmployees: employees.reload,
      reloadDepartments: departments.reload,
      reloadJobRoles: jobRoles.reload,
    }),
    [employees.data, departments.data, jobRoles.data, employees.reload, departments.reload, jobRoles.reload],
  );
  const loadError = employees.error || departments.error || jobRoles.error;

  return (
    <Shell wide onLogout={signOut}>
      <Hero eyebrow="Developer Dashboard" subtitle={`Welcome, ${employee.first_name}.`} />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {loadError && <Alert error>{loadError}</Alert>}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="la-stack" style={{ gap: 24 }}>
        {tab === 'accounts' && <EmployeesTab directory={directory} />}
        {tab === 'structure' && <StructureTab directory={directory} />}
        {tab === 'settings' && <SettingsTab directory={directory} showOrganisation={false} />}
        {tab === 'today' && <TodayTab directory={directory} />}
        {tab === 'reports' && <ReportsTab directory={directory} />}
        {tab === 'audit' && <AuditTab directory={directory} />}
      </div>
    </Shell>
  );
}
