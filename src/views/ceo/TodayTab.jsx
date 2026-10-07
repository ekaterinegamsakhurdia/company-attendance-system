import MyAttendanceSection from '../../components/MyAttendanceSection';
import TeamOverview from '../../components/TeamOverview';

export default function TodayTab({ directory }) {
  return (
    <TeamOverview directory={directory}>
      <MyAttendanceSection showHistory={false} />
    </TeamOverview>
  );
}
