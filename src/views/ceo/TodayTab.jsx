import MyAttendanceSection from '../../components/MyAttendanceSection';
import TeamOverview from '../../components/TeamOverview';

/** CEOs and developers clock in here like everyone else, above the team overview. */
export default function TodayTab({ directory }) {
  return (
    <TeamOverview directory={directory}>
      <MyAttendanceSection showHistory={false} />
    </TeamOverview>
  );
}
