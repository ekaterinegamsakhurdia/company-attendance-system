import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { PillButton } from './ui';

/** `bare` hides the standard heading: the content brings its own header (the close button stays). */
export function Modal({ title, description, onClose, wide, bare, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Runs once per dialog, so re-renders of the parent never steal the focus.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const node = ref.current;
    ref.current?.querySelector('input, select, textarea, button:not(.la-modal-x)')?.focus();
    document.body.style.overflow = 'hidden';
    // Escape closes only the top-most dialog.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const dialogs = document.querySelectorAll('.la-modal');
      if (dialogs[dialogs.length - 1] === ref.current) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      if ([...document.querySelectorAll('.la-modal')].every((m) => m === node)) document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="la-overlay">
      <div className={`la-modal${wide ? ' wide' : ''}${bare ? ' bare' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        {bare ? (
          <button type="button" className="la-modal-x floating" aria-label="Close dialog" onClick={() => closeRef.current()}>
            <X size={18} aria-hidden="true" />
          </button>
        ) : (
          <div className="la-modal-head">
            <div>
              <h2>{title}</h2>
              {description && <p className="la-meta">{description}</p>}
            </div>
            <button type="button" className="la-modal-x" aria-label="Close dialog" onClick={() => closeRef.current()}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, busy, confirmDisabled, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={busy ? () => {} : onCancel}>
      <div style={{ whiteSpace: 'pre-line', marginBottom: 20 }}>{message}</div>
      <div className="la-modal-actions">
        <PillButton variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </PillButton>
        <PillButton variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy || confirmDisabled}>
          {busy ? 'Working…' : confirmLabel}
        </PillButton>
      </div>
    </Modal>
  );
}
