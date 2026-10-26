import MyAttendanceSection from '../../components/MyAttendanceSection';
import TeamOverview from '../../components/TeamOverview';
import OfficeMap from '../OfficeMap';

/** The office map first, then the team overview; CEOs and developers clock in here like everyone else. */
export default function TodayTab({ directory }) {
  return (
    <>
      <OfficeMap />
      <TeamOverview directory={directory}>
        <MyAttendanceSection showHistory={false} />
      </TeamOverview>
    </>
  );
}
