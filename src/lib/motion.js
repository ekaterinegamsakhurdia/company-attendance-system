// Small helpers for the motion system. The values themselves live in src/styles/motion.css (the --m-* variables):
// JS only reads them, so there is one place to tune timings.

/** A number from a CSS variable on the page root, e.g. cssNumber('--m-cursor-lag', 0.16). */
export function cssNumber(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** True when the person asked their device for less motion. */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True for a mouse or trackpad (not a touch screen). */
export const hasFinePointer = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
