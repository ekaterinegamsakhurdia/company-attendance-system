import { useEffect, useState } from 'react';
import { readRoute } from '../lib/route';

/** 'home' | 'login': follows the address, the back button and navigate(). */
export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const sync = () => setRoute(readRoute());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener('looper-route', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('looper-route', sync);
    };
  }, []);
  return route;
}
