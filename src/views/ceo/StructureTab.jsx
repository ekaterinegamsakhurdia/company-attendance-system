import { Briefcase, Building2 } from 'lucide-react';
import { SectionCard } from '../../components/ui';
import { Departments, JobRoles } from './SettingsTab';

/** Developer dashboard: departments and the job roles inside them. */
export default function StructureTab({ directory }) {
  return (
    <>
      <SectionCard icon={Building2} eyebrow="Organisation" title="Departments">
        <Departments directory={directory} />
      </SectionCard>

      <SectionCard icon={Briefcase} eyebrow="Organisation" title="Job Roles">
        <JobRoles directory={directory} />
      </SectionCard>
    </>
  );
}
