import { useCallback, useEffect, useState } from 'react';
import { fetchNetworkStatus } from '../services/api';

/** Whether the server currently sees this device on the company network. */
export function useNetworkStatus(enabled) {
  const [status, setStatus] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchNetworkStatus());
    } catch {
      setStatus(null); // unknown: the server still enforces the rule on every clock action
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
    };
  }, [enabled, refresh]);

  return { status, refresh };
}
