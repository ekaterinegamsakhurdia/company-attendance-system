import { useState } from 'react';
import { BadgeCheck, Building2, Hash, User } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { listDepartments, listJobRoles } from '../services/api';
import MyAttendanceSection from '../components/MyAttendanceSection';
import { FeatureTile, Hero, PillButton, SectionCard, Shell, Tabs } from '../components/ui';
import HeadTeam from './HeadTeam';

export default function EmployeeDashboard() {
  const { employee, headDepartment, signOut } = useAuth();
  const [tab, setTab] = useState('me');
  const departments = useLoad(listDepartments);
  const jobRoles = useLoad(listJobRoles);

  const department = departments.data?.find((d) => d.id === employee.department_id);
  const jobRole = jobRoles.data?.find((r) => r.id === employee.job_role_id);

  const tabs = headDepartment
    ? [
        { id: 'me', label: 'My attendance' },
        { id: 'team', label: `${headDepartment.name} team` },
      ]
    : null;

  return (
    <Shell wide={Boolean(tabs)} onLogout={signOut}>
      <Hero subtitle="Employee Attendance System" />
      {tabs && <Tabs tabs={tabs} value={tab} onChange={setTab} />}

      {(!tabs || tab === 'me') && (
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

      {tabs && tab === 'team' && <HeadTeam department={headDepartment} />}

      <PillButton variant="secondary" block onClick={signOut}>
        Log Out
      </PillButton>
    </Shell>
  );
}
