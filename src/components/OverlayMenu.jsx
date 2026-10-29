import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cssNumber, prefersReducedMotion } from '../lib/motion';

/**
 * Full-screen menu with staggered entries. `items` is [{ id, label, href?, onSelect?, icon?, current?, meta? }]:
 * an item with `href` is a link (it closes the menu first), otherwise a button that calls onSelect.
 * Keyboard: Escape closes, Tab stays inside while it is open, focus goes back to the button that opened it.
 */
export default function OverlayMenu({ open, onClose, items, title = 'Menu', footer }) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Mount immediately on open; on close play the exit (the mirror of the entrance) before unmounting.
  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return undefined;
    }
    if (!mounted) return undefined;
    if (prefersReducedMotion()) {
      setMounted(false);
      return undefined;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, cssNumber('--m-menu', 560) * 0.6);
    return () => clearTimeout(t);
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !mounted) return undefined;
    const previous = document.activeElement;
    const node = ref.current;
    node?.querySelector('[data-menu-first]')?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const focusable = [...node.querySelectorAll('a[href], button:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open, mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className={`la-menu${leaving ? ' leaving' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <div className="la-menu-top">
        <span className="la-menu-title">{title}</span>
        <button type="button" className="la-menu-close" onClick={onClose} aria-label="Close menu">
          <X size={18} aria-hidden="true" />
          <span>Close</span>
        </button>
      </div>
      <nav className="la-menu-nav" aria-label={title}>
        <ul>
          {items.map((it, i) => {
            const Icon = it.icon;
            const inner = (
              <>
                <span className="la-menu-no" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                {Icon && <Icon size={22} aria-hidden="true" className="la-menu-icon" />}
                <span className="la-menu-label">{it.label}</span>
                <span className="la-menu-arrow" aria-hidden="true">→</span>
              </>
            );
            const common = { className: `la-menu-link${it.current ? ' current' : ''}`, style: { '--i': i }, 'data-menu-first': i === 0 ? '' : undefined, 'aria-current': it.current ? 'true' : undefined };
            return (
              <li key={it.id}>
                {it.href ? (
                  <a
                    href={it.href}
                    {...common}
                    onClick={(e) => {
                      onClose();
                      it.onSelect?.(e);
                    }}
                  >
                    {inner}
                  </a>
                ) : (
                  <button
                    type="button"
                    {...common}
                    onClick={() => {
                      onClose();
                      it.onSelect?.();
                    }}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      {footer && <div className="la-menu-foot">{footer}</div>}
    </div>,
    document.body,
  );
}
