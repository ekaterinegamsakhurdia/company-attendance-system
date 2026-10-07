import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { listDepartments, listEmployees, listJobRoles } from '../services/api';
import { Alert, Hero, Shell, Tabs } from '../components/ui';
import TodayTab from './ceo/TodayTab';
import ReportsTab from './ceo/ReportsTab';
import EmployeesTab from './ceo/EmployeesTab';
import SettingsTab from './ceo/SettingsTab';
import AuditTab from './ceo/AuditTab';

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'reports', label: 'Reports' },
  { id: 'employees', label: 'Employees' },
  { id: 'settings', label: 'Settings' },
  { id: 'audit', label: 'Audit Log' },
];

export default function CeoDashboard() {
  const { employee, signOut } = useAuth();
  const [tab, setTab] = useState('today');

  // Shared by several tabs, so it is loaded once here.
  const employees = useLoad(listEmployees);
  const departments = useLoad(listDepartments);
  const jobRoles = useLoad(listJobRoles);

  const directory = {
    employees: employees.data ?? [],
    departments: departments.data ?? [],
    jobRoles: jobRoles.data ?? [],
    reloadEmployees: employees.reload,
    reloadDepartments: departments.reload,
    reloadJobRoles: jobRoles.reload,
  };
  const loadError = employees.error || departments.error || jobRoles.error;

  return (
    <Shell wide onLogout={signOut}>
      <Hero eyebrow="CEO Dashboard" subtitle={`Welcome, ${employee.first_name}.`} />

      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {loadError && <Alert error>{loadError}</Alert>}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="la-stack" style={{ gap: 24 }}>
        {tab === 'today' && <TodayTab directory={directory} />}
        {tab === 'reports' && <ReportsTab directory={directory} />}
        {tab === 'employees' && <EmployeesTab directory={directory} />}
        {tab === 'settings' && <SettingsTab directory={directory} />}
        {tab === 'audit' && <AuditTab directory={directory} />}
      </div>
    </Shell>
  );
}
