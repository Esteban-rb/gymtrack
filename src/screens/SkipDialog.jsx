import React from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';

/** Confirmation for skipping the first-run setup. */
export default function SkipDialog({ t, onSkip, onClose }) {
  return (
    <ConfirmDialog
      titleId="skip-dialog-title" question={t('skip.question')} confirmLabel={t('skip.confirm')} cancelLabel={t('skip.cancel')}
      onConfirm={onSkip} onClose={onClose}
      errorMessage={(failure) => t('skip.error', { detail: failure instanceof Error && failure.message ? failure.message : t('skip.retry') })}
    />
  );
}
