// The two pages a signed-out visitor can see: the landing page ("home", address "/") and the sign-in page
// ("login", address "/#login"). A hash is used so the host needs no extra rewrite rules and a refresh stays put.
import { flushSync } from 'react-dom';
import { prefersReducedMotion } from './motion';

export const readRoute = () => (typeof window !== 'undefined' && window.location.hash === '#login' ? 'login' : 'home');

/** Go to 'login' or 'home'. Browsers with View Transitions cross-fade the pages (exit mirrors entrance). */
export function navigate(to) {
  const url = to === 'login' ? '/#login' : '/';
  const run = () => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new Event('looper-route'));
  };
  if (typeof document.startViewTransition === 'function' && !prefersReducedMotion()) {
    document.startViewTransition(() => flushSync(run));
  } else {
    run();
  }
  window.scrollTo(0, 0);
}

/** Change the address without adding a history entry (used right after signing in or out). */
export function replaceRoute(to) {
  window.history.replaceState(null, '', to === 'login' ? '/#login' : '/');
  window.dispatchEvent(new Event('looper-route'));
}
