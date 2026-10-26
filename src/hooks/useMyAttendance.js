import { useCallback, useEffect, useState } from 'react';
import { clockIn, clockOut, fetchAttendanceForDay, fetchMyHistory, startOvertime } from '../services/api';
import { verifyBiometric } from '../lib/biometric';
import { todayInTz } from '../lib/time';
import { useToast } from '../components/Toast';

/**
 * Today's record + recent history for the signed-in employee, and the clock actions.
 * When `requireBiometric` is on, each action first runs the Face ID / fingerprint check.
 * `onNeedDevice` is called when the server says no device has been registered yet.
 */
export function useMyAttendance(employeeId, timezone, { requireBiometric = false, onNeedDevice } = {}) {
  const toast = useToast();
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([
        fetchAttendanceForDay(employeeId, todayInTz(timezone)),
        fetchMyHistory(employeeId, 30),
      ]);
      setToday(t);
      setHistory(h);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [employeeId, timezone, toast]);

  useEffect(() => {
    refresh();
    // Pick up automatic clock-outs / edits when the tab becomes visible again.
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const run = useCallback(
    async (action, perform, successMessage, { biometric = true } = {}) => {
      setBusy(true);
      try {
        const verificationId = requireBiometric && biometric ? await verifyBiometric(action) : null;
        await perform(verificationId);
        toast.success(successMessage);
      } catch (err) {
        if (err.code === 'no_device') {
          onNeedDevice?.();
        } else {
          toast.error(err.message);
        }
      } finally {
        await refresh();
        setBusy(false);
      }
    },
    [refresh, toast, requireBiometric, onNeedDevice],
  );

  return {
    today,
    history,
    loading,
    busy,
    refresh,
    onClockIn: (online = false) =>
      run('clock_in', (v) => clockIn(v, online), online ? 'Clocked in. Today is an online work day.' : 'Clocked in.'),
    onClockOut: () => run('clock_out', clockOut, 'Clocked out.'),
    // Starting overtime only needs the company network; the clock-out that ends it needs Face ID as usual.
    onStartOvertime: () => run('overtime', () => startOvertime(), 'Overtime started. Clock out when you finish.', { biometric: false }),
  };
}
