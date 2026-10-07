import { useCallback, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import { useMyAttendance } from '../hooks/useMyAttendance';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { listDevices } from '../services/api';
import { AttendancePanel, HistoryCard } from './AttendancePanel';
import { DevicesCard, RegisterDeviceModal } from './DevicesCard';

/**
 * The signed-in person's own clock-in/out: network status, biometric devices,
 * today's record and (optionally) their recent history.
 */
export default function MyAttendanceSection({ showHistory = true, historyTitle }) {
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

      {showHistory && <HistoryCard rows={mine.history} loading={mine.loading} timezone={timezone} title={historyTitle} />}

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
