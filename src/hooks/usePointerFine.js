import { useEffect, useState } from 'react';

/** True only for a mouse / trackpad and only when the person has not asked for reduced motion. */
export function usePointerFine() {
  const query = '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return on;
}
