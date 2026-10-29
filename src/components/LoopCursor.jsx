import { useEffect, useRef } from 'react';
import LooperMark from './LooperMark';
import { usePointerFine } from '../hooks/usePointerFine';
import { cssNumber } from '../lib/motion';

/**
 * A small infinity loop that follows the mouse with a soft lag, grows over links and buttons, and turns once
 * when you click. It sits on top of the normal cursor (the real pointer is never hidden), and it only exists for a
 * mouse or trackpad with motion allowed: touch screens and reduced-motion users never get it.
 */
export default function LoopCursor() {
  const fine = usePointerFine();
  const box = useRef(null);

  useEffect(() => {
    const el = box.current;
    if (!fine || !el) return undefined;
    const lag = cssNumber('--m-cursor-lag', 0.16);
    let tx = 0, ty = 0, x = 0, y = 0, frame = 0, shown = false, spinTimer = 0;

    const tick = () => {
      x += (tx - x) * lag;
      y += (ty - y) * lag;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.2 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e) => {
      tx = e.clientX + 18;
      ty = e.clientY + 18;
      if (!shown) {
        shown = true;
        x = tx;
        y = ty;
        el.classList.add('on');
      }
      el.classList.toggle('link', !!e.target.closest?.('a, button, input, select, textarea, [role="tab"]'));
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const onDown = () => {
      el.classList.remove('spin');
      void el.offsetWidth; // restart the one-off turn
      el.classList.add('spin');
      clearTimeout(spinTimer);
      spinTimer = setTimeout(() => el.classList.remove('spin'), 700);
    };
    const onLeave = () => {
      shown = false;
      el.classList.remove('on');
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      clearTimeout(spinTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fine]);

  if (!fine) return null;
  return (
    <div className="la-cursor" ref={box} aria-hidden="true">
      <span className="la-cursor-in">
        <LooperMark size={12} stroke={11} />
      </span>
    </div>
  );
}
