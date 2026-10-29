import { useCallback, useEffect, useState } from 'react';
import { applyTheme, currentTheme, otherTheme } from '../lib/theme';

/** { theme, toggle }: the visible theme ('dark' | 'light') and a function that switches it and remembers the choice. */
export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => {
    const onChange = (e) => setTheme(e.detail);
    window.addEventListener('looper-theme', onChange);
    return () => window.removeEventListener('looper-theme', onChange);
  }, []);
  const toggle = useCallback(() => applyTheme(otherTheme(currentTheme()), { save: true }), []);
  return { theme, toggle };
}
