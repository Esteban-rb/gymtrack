import React, { useEffect, useRef, useState } from 'react';

/**
 * In-app confirmation (never window.confirm). Focus starts on the safe "keep" action,
 * Escape and the keep button close it, and a failing async confirm shows an error and stays open.
 */
export default function ConfirmDialog({ question, confirmLabel, cancelLabel, onConfirm, onClose, errorMessage, titleId = 'confirm-dialog-title' }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const keepRef = useRef(null);
  const confirmRef = useRef(null);
  const mounted = useRef(true);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    keepRef.current?.focus();
    return () => { mounted.current = false; };
  }, []);

  const confirm = async () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true); setError('');
    try {
      await onConfirm();
    } catch (failure) {
      if (mounted.current) setError(errorMessage ? errorMessage(failure) : '');
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!saving) onClose();
    } else if (event.key === 'Tab') {
      // keep focus inside the dialog
      const order = [keepRef.current, confirmRef.current].filter((node) => node && !node.disabled);
      if (!order.length) return;
      const index = order.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? order.length - 1 : index - 1) : (index === order.length - 1 ? 0 : index + 1);
      event.preventDefault();
      order[next].focus();
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(0,0,0,0.6)' }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}
        className="gt-card" style={{ maxWidth: 420, width: '100%', padding: 20, background: 'var(--surface-solid)' }}>
        <p id={titleId} className="gt-body" style={{ margin: '0 0 16px', fontWeight: 700 }}>{question}</p>
        {error ? <p role="alert" className="gt-sub" style={{ color: 'var(--accent)' }}>{error}</p> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button ref={keepRef} type="button" className="gt-btn gt-btn-primary" disabled={saving} onClick={onClose}>{cancelLabel}</button>
          <button ref={confirmRef} type="button" className="gt-btn gt-btn-ghost" disabled={saving} aria-busy={saving} onClick={confirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
