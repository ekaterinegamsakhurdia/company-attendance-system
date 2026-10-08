import { useEffect, useRef } from 'react';
import { PillButton } from './ui';

export function Modal({ title, description, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="la-overlay">
      <div className="la-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
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
