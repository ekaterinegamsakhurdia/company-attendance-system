import { useCallback, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { useMyAttendance } from '../hooks/useMyAttendance';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { listDevices } from '../services/api';
import { AttendancePanel, HistoryCard } from './AttendancePanel';
import { DevicesCard, RegisterDeviceModal } from './DevicesCard';
import ClockInCelebration from './ClockInCelebration';
import { formatTime } from '../lib/time';

/**
 * The signed-in person's own clock-in/out: network status, biometric devices,
 * today's record and (optionally) their recent history. `between` is shown after the clock-in card and before the history,
 * so a page can put the clock-in first and its own cards next. The clock-in animation lives here too.
 */
export default function MyAttendanceSection({ showHistory = true, historyTitle, between = null }) {
  const { employee, timezone, settings } = useAuth();
  const requireNetwork = settings.require_company_network;
  const requireBiometric = settings.require_biometric;

  const [registering, setRegistering] = useState(false);
  const openRegister = useCallback(() => setRegistering(true), []);

  const mine = useMyAttendance(employee.id, timezone, { requireBiometric, onNeedDevice: openRegister });
  const network = useNetworkStatus(requireNetwork);
  const devices = useLoad(() => listDevices(employee.id), [employee.id], { enabled: true });

  const showDevices = requireBiometric || (devices.data?.length ?? 0) > 0;

  return (
    <>
      <AttendancePanel
        record={mine.today}
        timezone={timezone}
        busy={mine.busy}
        onClockIn={mine.onClockIn}
        onClockOut={mine.onClockOut}
        onStartOvertime={mine.onStartOvertime}
        allowOnline={settings.allow_online_days !== false}
        workEnd={settings.work_end_time}
        requireNetwork={requireNetwork}
        network={network.status}
        onRecheckNetwork={network.refresh}
        requireBiometric={requireBiometric}
      />

      {showDevices && (
        <DevicesCard
          devices={devices.data ?? []}
          loading={devices.loading && !devices.data}
          timezone={timezone}
          onChanged={devices.reload}
          onRegister={openRegister}
        />
      )}

      {between}

      {showHistory && <HistoryCard rows={mine.history} loading={mine.loading} timezone={timezone} title={historyTitle} />}

      <ClockInCelebration
        celebration={mine.celebration}
        name={employee.first_name}
        time={mine.today ? formatTime(mine.today.clock_in, timezone) : null}
        mode={mine.today?.work_mode}
        onClose={mine.dismissCelebration}
      />

      {registering && (
        <RegisterDeviceModal
          onClose={() => setRegistering(false)}
          onRegistered={() => {
            setRegistering(false);
            devices.reload();
          }}
        />
      )}
    </>
  );
}
