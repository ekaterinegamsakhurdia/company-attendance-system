import { useCallback, useEffect, useRef, useState } from 'react';
import { clockIn, clockOut, fetchAttendanceForDay, fetchMyHistory, startOvertime } from '../services/api';
import { verifyBiometric } from '../lib/biometric';
import { todayInTz } from '../lib/time';
import { useToast } from '../components/Toast';

// The clock-in animation shows for at least this long, so the loop is always seen drawing itself.
const MIN_CLOCK_IN_MS = 2400;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const [celebration, setCelebration] = useState(null); // clock-in animation: null | { phase: 'loading' | 'done' }
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    async (action, perform, successMessage, { biometric = true, animate = false } = {}) => {
      setBusy(true);
      const started = Date.now();
      if (animate) setCelebration({ phase: 'loading' });
      try {
        const verificationId = requireBiometric && biometric ? await verifyBiometric(action) : null;
        await perform(verificationId);
        if (animate) {
          await wait(Math.max(0, MIN_CLOCK_IN_MS - (Date.now() - started)));
          if (mounted.current) setCelebration({ phase: 'done' });
        } else {
          toast.success(successMessage);
        }
      } catch (err) {
        if (animate) setCelebration(null);
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

  const dismissCelebration = useCallback(() => setCelebration(null), []);

  return {
    today,
    history,
    loading,
    busy,
    refresh,
    celebration,
    dismissCelebration,
    onClockIn: (online = false) =>
      run('clock_in', (v) => clockIn(v, online), online ? 'Clocked in. Today is an online work day.' : 'Clocked in.', { animate: true }),
    onClockOut: () => run('clock_out', clockOut, 'Clocked out.'),
    // Starting overtime only needs the company network; the clock-out that ends it needs Face ID as usual.
    onStartOvertime: () => run('overtime', () => startOvertime(), 'Overtime started. Clock out when you finish.', { biometric: false }),
  };
}
