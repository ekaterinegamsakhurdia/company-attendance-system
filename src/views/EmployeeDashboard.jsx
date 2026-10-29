import { useState } from 'react';
import { BadgeCheck, Building2, Pencil, CalendarCheck, CalendarDays, CalendarPlus, Clock, Hash, Palmtree, Plane, User, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { listDepartments, listEmployees, listJobRoles } from '../services/api';
import MyAttendanceSection from '../components/MyAttendanceSection';
import { FeatureTile, Hero, PillButton, SectionCard, Shell, TabLabel, Tabs } from '../components/ui';
import { usePendingLeaves } from '../hooks/usePendingLeaves';
import { canDecide } from '../lib/leaves';
import HeadTeam from './HeadTeam';
import MyLeaves from './MyLeaves';
import CalendarView from './CalendarView';
import OfficeMap from './OfficeMap';
import LeavesTab from './ceo/LeavesTab';
import BookTimeOff from './BookTimeOff';
import ToApprove from './ToApprove';
import MyProfile from '../components/MyProfile';

const longDate = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export default function EmployeeDashboard() {
  const { employee, myProfile, headDepartment, signOut } = useAuth();
  const [tab, setTab] = useState('me');
  const [mine, setMine] = useState(false);
  const departments = useLoad(listDepartments);
  const jobRoles = useLoad(listJobRoles);

  // The head of a department that approves leaves for the whole company sees every employee (the database decides who is returned).
  const approvesAll = Boolean(headDepartment?.approves_all_leaves);
  const people = useLoad(listEmployees, [], { enabled: approvesAll });
  const directory = approvesAll
    ? { employees: people.data ?? [], departments: departments.data ?? [], jobRoles: jobRoles.data ?? [], reloadEmployees: people.reload }
    : undefined;

  const department = departments.data?.find((d) => d.id === employee.department_id);
  const jobRole = jobRoles.data?.find((r) => r.id === employee.job_role_id);

  const pending = usePendingLeaves(Boolean(headDepartment));
  const waiting = (pending.data ?? []).filter((l) => canDecide(l, employee, headDepartment)).length;

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
    <Shell wide={Boolean(headDepartment) || tab === 'calendar' || tab === 'me'} onLogout={signOut} user={employee} roleLabel={headDepartment ? `${headDepartment.name} head` : 'Employee'} avatarPath={myProfile?.avatar_path} onProfile={() => setMine(true)}>
      <Hero eyebrow="Employee Attendance System" title="My workday" emphasis="workday" subtitle={longDate()} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div className="la-stack la-panel" key={tab}>
      {tab === 'me' && (
        <MyAttendanceSection
          between={
            <>
              <OfficeMap />

              <SectionCard
                icon={User}
                eyebrow="Your details"
                title={`Welcome, ${employee.first_name}!`}
                action={
                  <PillButton variant="secondary" size="sm" icon={Pencil} onClick={() => setMine(true)}>
                    Edit profile
                  </PillButton>
                }
              >
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
            </>
          }
        />
      )}

      {headDepartment && tab === 'approve' && <ToApprove pending={pending} />}
      {tab === 'book' && <BookTimeOff onBooked={() => setTab('leaves')} />}
      {tab === 'leaves' && <MyLeaves onBook={() => setTab('book')} />}
      {tab === 'calendar' && <CalendarView directory={directory} />}
      {headDepartment && tab === 'team' && <HeadTeam department={headDepartment} />}
      {headDepartment && tab === 'requests' && <LeavesTab pending={pending} directory={directory} />}
      </div>
      {mine && <MyProfile onClose={() => setMine(false)} />}
    </Shell>
  );
}
