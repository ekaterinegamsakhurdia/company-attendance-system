import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LOOP_PATH } from './LooperMark';

/**
 * Full-screen moment shown while someone clocks in: the Looper infinity loop draws itself and keeps running
 * while the clock-in is saved, then a message says it worked. `celebration` is null | { phase: 'loading' | 'done' }.
 * Reduced-motion users get the finished loop without the drawing.
 */
export default function ClockInCelebration({ celebration, name, time, mode, onClose }) {
  const done = celebration?.phase === 'done';
  const button = useRef(null);

  useEffect(() => {
    if (!done) return undefined;
    button.current?.focus();
    const timer = setTimeout(onClose, 6500);
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [done, onClose]);

  if (!celebration) return null;

  return createPortal(
    <div className={`la-ci ${done ? 'done' : 'loading'}`} role="dialog" aria-modal="true" aria-label={done ? 'You are clocked in' : 'Clocking you in'} data-testid="clockin-overlay">
      <div className="la-ci-inner">
        <svg className="la-ci-loop" viewBox="0 0 120 60" aria-hidden="true" focusable="false">
          <path className="ghost" d={LOOP_PATH} pathLength="100" />
          <path className="base" d={LOOP_PATH} pathLength="100" />
          <path className="comet" d={LOOP_PATH} pathLength="100" />
        </svg>
        {done ? (
          <div className="la-ci-msg" role="status">
            <h2 className="la-ci-title">You&rsquo;re clocked in for today.</h2>
            <p className="la-ci-sub">Have a great day{name ? `, ${name}` : ''}!</p>
            {time && (
              <p className="la-ci-meta">
                Clocked in at {time}
                {mode === 'online' ? ' · online work day' : ''}
              </p>
            )}
            <button ref={button} type="button" className="la-btn primary la-ci-btn" onClick={onClose}>
              Let&rsquo;s go
            </button>
          </div>
        ) : (
          <p className="la-ci-wait" role="status">
            Clocking you in…
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
