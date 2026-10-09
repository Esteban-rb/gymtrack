import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n.js';
import { SEX_VALUES, validateProfileDraft } from '../setup.js';
import { useStore } from '../store.js';
import InSlot from './wizard-slot.jsx';

const PROFILE_FIELD_ORDER = ['name', 'sex', 'age', 'heightCm', 'bodyweightKg'];
const EMPTY_DRAFT = { name: '', sex: '', age: '', heightCm: '', bodyweightKg: '' };

/**
 * Reusable profile editor. `embedded` (wizard) drops the card, heading and Cancel and renders the
 * primary action into `actionSlot`; `onBusyChange` reports the in-flight save to the host.
 */
export default function SetupProfile({ initialProfile, onSaved, onCancel, embedded = false, actionSlot = null, primaryLabel, onBusyChange }) {
  const { t } = useT();
  const saveSetupProfile = useStore((state) => state.saveSetupProfile);
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.keys(EMPTY_DRAFT).map((key) => [
    key, initialProfile?.[key] == null ? '' : String(initialProfile[key]),
  ])));
  const [attempted, setAttempted] = useState(false);
  const [storeErrors, setStoreErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  useEffect(() => { onBusyChange?.(saving); }, [saving]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onBusyChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rules stay in setup.js; this only decides when to show them and in which words.
  // Errors appear after the first submit attempt and then follow the field live.
  const liveErrors = attempted ? validateProfileDraft(draft).errors : {};
  const errors = { ...storeErrors, ...liveErrors };
  const hasErrors = Object.keys(errors).length > 0;

  const changeField = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setStoreErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setMessage('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    setAttempted(true);
    const firstInvalid = PROFILE_FIELD_ORDER.find((key) => validateProfileDraft(draft).errors[key]);
    if (firstInvalid) {
      document.getElementById(`setup-profile-${firstInvalid}`)?.focus();
      return;
    }
    submitting.current = true;
    setStoreErrors({}); setMessage(''); setMessageIsError(false); setSaving(true);
    let committed;
    try {
      committed = await saveSetupProfile(draft);
    } catch (error) {
      setStoreErrors(error?.errors || {});
      setMessage(error?.errors ? '' : t('profile.saveFailed', { detail: error?.message || t('skip.retry') }));
      setMessageIsError(true);
      submitting.current = false;
      setSaving(false);
      return;
    }
    submitting.current = false;
    setSaving(false);
    try {
      onSaved?.(committed);
    } catch (error) {
      setMessage(t('profile.continueFailed', { detail: error?.message || t('skip.retry') }));
      setMessageIsError(true);
    }
  };

  const field = (key, type = 'text') => {
    const errorId = `setup-profile-${key}-error`;
    const common = {
      id: `setup-profile-${key}`, name: key, value: draft[key], disabled: saving,
      'aria-invalid': errors[key] ? 'true' : undefined,
      'aria-describedby': errors[key] ? errorId : undefined,
      onChange: (event) => changeField(key, event.target.value),
    };
    return (
      <div key={key} style={{ marginBottom: 14 }}>
        <label htmlFor={common.id} className="gt-body" style={{ display: 'block', marginBottom: 6, fontWeight: 700 }}>{t(`profile.${key}`)}</label>
        {key === 'sex' ? (
          <select {...common} className="gt-input">
            <option value="">{t('profile.choose')}</option>
            {SEX_VALUES.map((value) => <option key={value} value={value}>{t(`profile.sex.${value}`)}</option>)}
          </select>
        ) : (
          <input {...common} className="gt-input" type={type} inputMode={type === 'number' ? 'decimal' : undefined} />
        )}
        {errors[key] ? <div id={errorId} className="gt-micro" style={{ color: 'var(--accent)', marginTop: 5 }}>{t(`profile.err.${key}`)}</div> : null}
      </div>
    );
  };

  const submitButton = (
    <button type="submit" form="setup-profile-form" className="gt-btn gt-btn-primary" disabled={saving} aria-busy={saving} style={{ flex: 1 }}>
      {primaryLabel ?? (saving ? t('profile.saving') : t('profile.save'))}
    </button>
  );

  return (
    <form id="setup-profile-form" noValidate onSubmit={submit} aria-label={t('profile.details')} className={embedded ? undefined : 'gt-card'} style={embedded ? undefined : { padding: 18 }}>
      {embedded ? null : <>
        <h2 className="gt-h1" style={{ fontSize: 22, margin: '0 0 6px' }}>{t('title.profile')}</h2>
        <p className="gt-sub" style={{ margin: '0 0 18px' }}>{t('profile.intro')}</p>
      </>}
      {field('name')}
      {field('sex')}
      {field('age', 'number')}
      {field('heightCm', 'number')}
      {field('bodyweightKg', 'number')}
      {hasErrors ? <div role="alert" className="gt-sub" style={{ marginBottom: 12, color: 'var(--accent)' }}>{t('profile.checkFields')}</div> : null}
      {message ? <div role={messageIsError ? 'alert' : 'status'} aria-live="polite" className="gt-sub" style={{ marginBottom: 12 }}>{message}</div> : null}
      {embedded ? <InSlot slot={actionSlot}>{submitButton}</InSlot> : (
        <div style={{ display: 'flex', gap: 10 }}>
          {onCancel ? <button type="button" className="gt-btn gt-btn-ghost" disabled={saving} onClick={onCancel}>{t('profile.cancel')}</button> : null}
          {submitButton}
        </div>
      )}
    </form>
  );
}
