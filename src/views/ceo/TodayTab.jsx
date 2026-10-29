import MyAttendanceSection from '../../components/MyAttendanceSection';
import TeamOverview from '../../components/TeamOverview';
import OfficeMap from '../OfficeMap';

/** The clock-in card comes first (CEOs and developers clock in like everyone else), then the office map and the team overview. */
export default function TodayTab({ directory }) {
  return (
    <>
      <MyAttendanceSection showHistory={false} />
      <OfficeMap />
      <TeamOverview directory={directory} />
    </>
  );
}
