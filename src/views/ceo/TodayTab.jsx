import { useAuth } from '../../hooks/useAuth';
import MyAttendanceSection from '../../components/MyAttendanceSection';
import TeamOverview from '../../components/TeamOverview';

export default function TodayTab({ directory }) {
  const { employee } = useAuth();
  const isDeveloper = employee.role === 'developer';   // developers do not clock in
  return (
    <TeamOverview directory={directory}>
      {!isDeveloper && <MyAttendanceSection showHistory={false} />}
    </TeamOverview>
  );
}
