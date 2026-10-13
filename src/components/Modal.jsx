import { useEffect, useRef } from 'react';
import { PillButton } from './ui';

export function Modal({ title, description, onClose, wide, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Runs once per dialog, so re-renders of the parent never steal the focus.
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    // Escape closes only the top-most dialog.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const dialogs = document.querySelectorAll('.la-modal');
      if (dialogs[dialogs.length - 1] === ref.current) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="la-overlay">
      <div className={`la-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {description && <p className="la-meta" style={{ marginBottom: 16 }}>{description}</p>}
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
