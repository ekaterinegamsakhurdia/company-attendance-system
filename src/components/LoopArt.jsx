import { useEffect, useRef } from 'react';
import { LOOP_PATH } from './LooperMark';
import { cssNumber, hasFinePointer, prefersReducedMotion } from '../lib/motion';

/**
 * The Looper infinity loop as a large piece of artwork: a faint track, the line that draws itself, and a comet
 * that keeps running along it. Props:
 *  - draw      the line draws itself once when the page opens (otherwise it is simply there)
 *  - run       the comet keeps travelling along the loop
 *  - echoes    faint copies around the loop, for depth
 *  - scrub     tie the drawing to scrolling instead: the line is drawn as the artwork travels up the screen
 *  - parallax  shift a little with the pointer (mouse only)
 */
export default function LoopArt({ draw = false, run = false, echoes = false, scrub = false, parallax = false, stroke = 2.4, className = '' }) {
  const ref = useRef(null);

  // Scroll-linked drawing: progress 0 when the artwork enters at the bottom of the screen, 1 when it is in the upper third.
  useEffect(() => {
    const el = ref.current;
    if (!scrub || !el) return undefined;
    if (prefersReducedMotion()) {
      el.style.setProperty('--p', '1');
      return undefined;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = (vh - r.top) / (vh * 0.8 + r.height * 0.4);
      el.style.setProperty('--p', Math.max(0, Math.min(1, p)).toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrub]);

  // Pointer parallax: the loop leans toward the pointer with an easing lag.
  useEffect(() => {
    const el = ref.current;
    if (!parallax || !el || prefersReducedMotion() || !hasFinePointer()) return undefined;
    const reach = cssNumber('--m-parallax', 14);
    const lag = cssNumber('--m-cursor-lag', 0.16) * 0.6;
    let tx = 0, ty = 0, x = 0, y = 0, frame = 0;
    const tick = () => {
      x += (tx - x) * lag;
      y += (ty - y) * lag;
      el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.05 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2 * reach;
      ty = (e.clientY / window.innerHeight - 0.5) * 2 * reach;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [parallax]);

  return (
    <svg
      ref={ref}
      className={`la-art${draw ? ' draws' : ''}${run ? ' runs' : ''} ${className}`}
      viewBox="0 0 120 60"
      aria-hidden="true"
      focusable="false"
      style={{ strokeWidth: stroke }}
    >
      {echoes && (
        <>
          <g className="echo-a" transform="translate(60 30) scale(1.16) translate(-60 -30)">
            <path className="echo" d={LOOP_PATH} />
          </g>
          <g className="echo-b" transform="translate(60 30) scale(.84) translate(-60 -30)">
            <path className="echo" d={LOOP_PATH} />
          </g>
        </>
      )}
      <path className="ghost" d={LOOP_PATH} pathLength="100" />
      <path className="base" d={LOOP_PATH} pathLength="100" />
      <path className="comet" d={LOOP_PATH} pathLength="100" style={{ strokeWidth: stroke * 1.35 }} />
    </svg>
  );
}
