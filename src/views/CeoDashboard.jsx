import { useState } from 'react';
import { BarChart3, CalendarCheck, CalendarDays, CalendarPlus, Cake, Clock, FileText, Plane, ScrollText, Settings, Users, Palmtree } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { listDepartments, listEmployees, listJobRoles } from '../services/api';
import { Alert, Hero, Shell, TabLabel, Tabs } from '../components/ui';
import { usePendingLeaves } from '../hooks/usePendingLeaves';
import { canDecide } from '../lib/leaves';
import TodayTab from './ceo/TodayTab';
import ReportsTab from './ceo/ReportsTab';
import EmployeesTab from './ceo/EmployeesTab';
import SettingsTab from './ceo/SettingsTab';
import AuditTab from './ceo/AuditTab';
import LeavesTab from './ceo/LeavesTab';
import CelebrationsTab from './ceo/CelebrationsTab';
import AnalyticsTab from './ceo/AnalyticsTab';
import CalendarView from './CalendarView';
import MyLeaves from './MyLeaves';
import BookTimeOff from './BookTimeOff';
import ToApprove from './ToApprove';
import ProfileCardProvider from '../components/ProfileCard';
import MyProfile from '../components/MyProfile';

const TABS = [
  { id: 'today', label: 'Today', icon: Clock },
  { id: 'approve', label: 'To approve', icon: CalendarCheck },
  { id: 'leaves', label: 'Leaves', icon: Palmtree },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'celebrations', label: 'Birthdays & Anniversaries', icon: Cake },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'book', label: 'Book time off', icon: CalendarPlus },
  { id: 'myleaves', label: 'My leaves', icon: Plane },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
];

const longDate = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export default function CeoDashboard() {
  const { employee, myProfile, signOut } = useAuth();
  const [mine, setMine] = useState(false);
  const [tab, setTab] = useState('today');

  // Shared by several tabs, so it is loaded once here.
  const employees = useLoad(listEmployees);
  const departments = useLoad(listDepartments);
  const jobRoles = useLoad(listJobRoles);
  const pending = usePendingLeaves();
  const waiting = (pending.data ?? []).filter((l) => canDecide(l, employee, null)).length;

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
    <ProfileCardProvider directory={directory}>
    <Shell wide onLogout={signOut} user={employee} roleLabel="CEO" avatarPath={myProfile?.avatar_path} onProfile={() => setMine(true)}>
      <Hero eyebrow="CEO Dashboard" title={`Welcome, ${employee.first_name}.`} emphasis={employee.first_name} subtitle={longDate()} />

      <Tabs tabs={TABS.map((t) => (t.id === 'approve' ? { ...t, label: <TabLabel text="To approve" count={waiting} /> } : t))} value={tab} onChange={setTab} />
      {loadError && <Alert error>{loadError}</Alert>}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="la-stack la-panel" key={tab}>
        {tab === 'today' && <TodayTab directory={directory} />}
        {tab === 'approve' && <ToApprove pending={pending} />}
        {tab === 'leaves' && <LeavesTab pending={pending} directory={directory} />}
        {tab === 'calendar' && <CalendarView directory={directory} />}
        {tab === 'celebrations' && <CelebrationsTab directory={directory} />}
        {tab === 'analytics' && <AnalyticsTab directory={directory} />}
        {tab === 'book' && <BookTimeOff onBooked={() => setTab('myleaves')} />}
        {tab === 'myleaves' && <MyLeaves onBook={() => setTab('book')} />}
        {tab === 'reports' && <ReportsTab directory={directory} />}
        {tab === 'employees' && <EmployeesTab directory={directory} />}
        {tab === 'settings' && <SettingsTab directory={directory} />}
        {tab === 'audit' && <AuditTab directory={directory} />}
      </div>
    </Shell>
    {mine && <MyProfile onClose={() => setMine(false)} onSaved={directory.reloadEmployees} />}
    </ProfileCardProvider>
  );
}
