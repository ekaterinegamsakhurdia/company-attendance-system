import { useState } from 'react';
import { BadgeCheck, Building2, Hash, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { listDepartments, listJobRoles } from '../services/api';
import MyAttendanceSection from '../components/MyAttendanceSection';
import { FeatureTile, Hero, PillButton, SectionCard, Shell, TabLabel, Tabs } from '../components/ui';
import { usePendingLeaves } from '../hooks/usePendingLeaves';
import { canDecide } from '../lib/leaves';
import HeadTeam from './HeadTeam';
import MyLeaves from './MyLeaves';
import CalendarView from './CalendarView';
import LeavesTab from './ceo/LeavesTab';
import BookTimeOff from './BookTimeOff';
import ToApprove from './ToApprove';

export default function EmployeeDashboard() {
  const { employee, headDepartment, signOut } = useAuth();
  const [tab, setTab] = useState('me');
  const departments = useLoad(listDepartments);
  const jobRoles = useLoad(listJobRoles);

  const department = departments.data?.find((d) => d.id === employee.department_id);
  const jobRole = jobRoles.data?.find((r) => r.id === employee.job_role_id);

  const pending = usePendingLeaves(Boolean(headDepartment));
  const waiting = (pending.data ?? []).filter((l) => canDecide(l, employee, headDepartment?.id)).length;

  const tabs = [
    { id: 'me', label: 'My attendance' },
    ...(headDepartment ? [{ id: 'approve', label: <TabLabel text="To approve" count={waiting} /> }] : []),
    { id: 'book', label: 'Book time off' },
    { id: 'leaves', label: 'My leaves' },
    { id: 'calendar', label: 'Calendar' },
    ...(headDepartment
      ? [
          { id: 'team', label: `${headDepartment.name} team` },
          { id: 'requests', label: 'Leaves' },
        ]
      : []),
  ];

  return (
    <Shell wide={Boolean(headDepartment) || tab === 'calendar'} onLogout={signOut}>
      <Hero subtitle="Employee Attendance System" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'me' && (
        <>
          <SectionCard icon={User} eyebrow="Employee Attendance System" title={`Welcome, ${employee.first_name}!`}>
            <div className="la-grid">
              <FeatureTile icon={User}>
                <strong>Name:</strong> {employee.first_name} {employee.last_name}
              </FeatureTile>
              <FeatureTile icon={Hash}>
                <strong>Employee #:</strong> {employee.employee_number}
              </FeatureTile>
              <FeatureTile icon={BadgeCheck}>
                <strong>Role:</strong> {headDepartment ? 'Department head' : 'Employee'}
              </FeatureTile>
              {department && (
                <FeatureTile icon={Building2}>
                  <strong>Department:</strong> {department.name}
                  {jobRole ? ` · ${jobRole.name}` : ''}
                </FeatureTile>
              )}
            </div>
          </SectionCard>

          <MyAttendanceSection />
        </>
      )}

      {headDepartment && tab === 'approve' && <ToApprove pending={pending} />}
      {tab === 'book' && <BookTimeOff onBooked={() => setTab('leaves')} />}
      {tab === 'leaves' && <MyLeaves onBook={() => setTab('book')} />}
      {tab === 'calendar' && <CalendarView />}
      {headDepartment && tab === 'team' && <HeadTeam department={headDepartment} />}
      {headDepartment && tab === 'requests' && <LeavesTab pending={pending} />}

      <PillButton variant="secondary" block onClick={signOut}>
        Log Out
      </PillButton>
    </Shell>
  );
}
