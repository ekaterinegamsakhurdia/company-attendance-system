import { useState } from 'react';
import { BadgeCheck, Building2, CalendarCheck, CalendarDays, CalendarPlus, Clock, Hash, Palmtree, Plane, User, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { listDepartments, listJobRoles } from '../services/api';
import MyAttendanceSection from '../components/MyAttendanceSection';
import { FeatureTile, Hero, SectionCard, Shell, TabLabel, Tabs } from '../components/ui';
import { usePendingLeaves } from '../hooks/usePendingLeaves';
import { canDecide } from '../lib/leaves';
import HeadTeam from './HeadTeam';
import MyLeaves from './MyLeaves';
import CalendarView from './CalendarView';
import LeavesTab from './ceo/LeavesTab';
import BookTimeOff from './BookTimeOff';
import ToApprove from './ToApprove';

const longDate = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
    { id: 'me', label: 'My attendance', icon: Clock },
    ...(headDepartment ? [{ id: 'approve', icon: CalendarCheck, label: <TabLabel text="To approve" count={waiting} /> }] : []),
    { id: 'book', label: 'Book time off', icon: CalendarPlus },
    { id: 'leaves', label: 'My leaves', icon: Plane },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    ...(headDepartment
      ? [
          { id: 'team', label: `${headDepartment.name} team`, icon: Users },
          { id: 'requests', label: 'Leaves', icon: Palmtree },
        ]
      : []),
  ];

  return (
    <Shell wide={Boolean(headDepartment) || tab === 'calendar'} onLogout={signOut} user={employee} roleLabel={headDepartment ? `${headDepartment.name} head` : 'Employee'}>
      <Hero eyebrow="Employee Attendance System" title="My workday" subtitle={longDate()} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div className="la-stack la-panel" key={tab}>
      {tab === 'me' && (
        <>
          <SectionCard icon={User} eyebrow="Your details" title={`Welcome, ${employee.first_name}!`}>
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
      </div>
    </Shell>
  );
}
