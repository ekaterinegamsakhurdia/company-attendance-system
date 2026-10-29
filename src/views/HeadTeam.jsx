import { useLoad } from '../hooks/useLoad';
import { listDepartments, listEmployees, listJobRoles } from '../services/api';
import { Alert } from '../components/ui';
import TeamOverview from '../components/TeamOverview';
import ReportsTab from './ceo/ReportsTab';

/** Read-only view of the department a head leads (only that department's people, even for a head who can see everybody's leaves). */
export default function HeadTeam({ department }) {
  const employees = useLoad(listEmployees);
  const departments = useLoad(listDepartments);
  const jobRoles = useLoad(listJobRoles);

  const directory = {
    employees: (employees.data ?? []).filter((e) => e.department_id === department.id),
    departments: departments.data ?? [],
    jobRoles: jobRoles.data ?? [],
    reloadEmployees: employees.reload,
  };
  const error = employees.error || departments.error || jobRoles.error;

  return (
    <>
      {error && <Alert error>{error}</Alert>}
      <TeamOverview directory={directory} title={`${department.name} – Today`} />
      <ReportsTab directory={directory} readOnly />
    </>
  );
}
