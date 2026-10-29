import { useEffect } from 'react';
import { prefersReducedMotion } from '../lib/motion';

/**
 * Fades and lifts every [data-reveal] inside `ref` the first time it scrolls into view.
 * It only arms itself when the browser can observe scrolling and motion is welcome, so
 * without it (or without scripts) all content is simply visible. Set --i on an element to stagger it.
 */
export function useReveal(ref) {
  useEffect(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return undefined;
    const items = [...root.querySelectorAll('[data-reveal]')];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    root.classList.add('js-reveal');
    items.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove('js-reveal');
    };
  }, [ref]);
}
