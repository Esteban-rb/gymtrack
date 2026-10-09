import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n.js';
import { validateProfileDraft } from '../setup.js';
import { validateRoutineDraft } from '../routine-draft.js';
import { validateSchedule } from '../schedule.js';
import { useStore } from '../store.js';
import InSlot from './wizard-slot.jsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const cardStyle = { padding: 12, margin: '12px 0' };

function formatDate(iso, locale) {
  const match = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  try { return date.toLocaleDateString(locale, { dateStyle: 'medium' }); } catch { return iso; }
}

function Section({ title, onEdit, editLabel, children, t }) {
  return (
    <section aria-label={title} className="gt-card" style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 className="gt-h2" style={{ margin: 0 }}>{title}</h2>
        {onEdit ? <button type="button" className="gt-btn gt-btn-ghost" aria-label={t('review.editSection', { section: title })} onClick={onEdit}>{t('review.edit')}</button> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Confirm step. `embedded` (wizard): no card heading/Cancel; the start action renders into `actionSlot`.
 * `onEdit(step)` jumps back to the 'profile' | 'routine' | 'schedule' step with state preserved.
 */
export default function ReviewRoutine({ draft, schedule, cycleGoal, onApplied, onCancel, onContinueOldSession, onEdit, embedded = false, actionSlot = null, primaryLabel, onBusyChange }) {
  const { t, locale } = useT();
  const profile = useStore((state) => state.profile);
  const period = useStore((state) => state.period);
  const exercises = useStore((state) => state.exercises);
  const workouts = useStore((state) => state.workouts);
  const allVariants = useStore((state) => state.allVariants);
  const loaded = useStore((state) => state.loaded);
  const applyReviewedRoutine = useStore((state) => state.applyReviewedRoutine);
  const [choice, setChoice] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const applyingRef = useRef(false);
  useEffect(() => { onBusyChange?.(applying); }, [applying]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onBusyChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const savedProfileValidation = validateProfileDraft(profile);
  const routineValidation = validateRoutineDraft(draft, exercises);
  const variants = Array.isArray(draft?.variants) ? draft.variants : [];
  const codes = variants.map((variant) => variant?.code);
  const scheduleValidation = validateSchedule(schedule, codes);
  const goal = cycleGoal === undefined ? period?.cycleGoal ?? 6 : cycleGoal;
  const validGoal = Number.isInteger(goal) && goal >= 4 && goal <= 8;
  const unfinished = period ? workouts.filter((workout) => workout.periodId === period.id && !workout.finished) : [];
  const exactlyOnePartial = unfinished.length === 1;
  const several = unfinished.length > 1;
  const restartPartial = (exactlyOnePartial && choice === 'close') || (several && choice === 'closeAll');
  const finishFirst = exactlyOnePartial && choice === 'finish' && !!onContinueOldSession;
  const nameOf = (code) => variants.find((variant) => variant?.code === code)?.name;
  const label = (code) => (nameOf(code) ? `${code} · ${nameOf(code)}` : code);
  const dataValid = !!period && savedProfileValidation.valid && routineValidation.valid && scheduleValidation.valid && validGoal;
  const ready = loaded && dataValid && !(unfinished.length > 0 && !restartPartial) && !applying && !applied;
  const startDisabled = finishFirst ? !loaded || applying || applied : !ready;
  const occupied = !!period && workouts.some((workout) => workout.periodId === period.id);

  const continueOldSession = () => {
    if (applying || unfinished.length !== 1 || !onContinueOldSession) return;
    try {
      onContinueOldSession({ workoutId: unfinished[0].id, periodId: unfinished[0].periodId });
    } catch {
      setError(t('review.sessionOpenFailed'));
    }
  };

  const apply = async () => {
    if (finishFirst) { continueOldSession(); return; }
    if (!ready || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setError(''); setStatus(t('review.statusStarting'));
    try {
      const result = await applyReviewedRoutine(draft, schedule, {
        cycleGoal: goal,
        ...(restartPartial ? { resolution: 'restart' } : {}),
      });
      if (result?.status !== 'applied') {
        setStatus(t('review.statusNotStarted'));
        return;
      }
      setApplied(true);
      setStatus(t('review.statusReady'));
      try {
        await onApplied?.(result);
      } catch {
        setError(t('review.continueFailed'));
      }
    } catch {
      setStatus('');
      setError(t('review.applyFailed'));
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  const baseLabel = primaryLabel ?? t('wizard.start');
  const buttonLabel = finishFirst ? t('review.finishFirst') : applying && !applied ? t('review.starting') : baseLabel;
  const applyButton = <button type="button" className="gt-btn gt-btn-primary" style={embedded ? { flex: 1 } : undefined} aria-label={buttonLabel} disabled={startDisabled} aria-busy={applying} onClick={apply}>{buttonLabel}</button>;
  const edit = (step) => (onEdit && !applying && !applied ? () => onEdit(step) : onEdit ? () => {} : undefined);

  const sexText = profile?.sex && profile.sex !== 'prefer_not_to_say' ? t(`profile.sex.${profile.sex}`) : '';
  const profileLine = profile ? [profile.name, sexText, t('review.years', { n: profile.age }), `${profile.heightCm} cm`, `${profile.bodyweightKg} kg`].filter(Boolean).join(' · ') : '';
  const trainingDays = schedule?.mode === 'weekly' ? WEEKDAYS.filter((day) => schedule.week?.[day] != null) : [];
  const restDays = schedule?.mode === 'weekly' ? WEEKDAYS.filter((day) => schedule.week?.[day] == null) : [];

  const sessionRoutine = exactlyOnePartial
    ? allVariants?.find((variant) => variant.code === unfinished[0].variant && variant.ownerPeriodId === unfinished[0].periodId)?.name
    : '';
  const sessionDate = exactlyOnePartial ? formatDate(unfinished[0].date, locale) : '';
  const sessionText = !sessionDate ? t('review.sessionOneNoDate') : sessionRoutine
    ? t('review.sessionOne', { date: sessionDate, routine: sessionRoutine }) : t('review.sessionOneNoName', { date: sessionDate });

  let hint = '';
  if (loaded && !applying && !applied && !choice) {
    if (exactlyOnePartial) hint = t('review.sessionPick');
    else if (several) hint = t('review.sessionManyPick');
  }

  return (
    <section aria-label={t('review.region')} className={embedded ? undefined : 'gt-card'} style={embedded ? undefined : { padding: 16 }}>
      {embedded ? null : <h2 className="gt-h1" style={{ fontSize: 22 }}>{t('title.confirm')}</h2>}
      {!loaded ? <p role="status">{t('review.loading')}</p> : null}

      <Section title={t('review.profileTitle')} onEdit={edit('profile')} t={t}>
        {profile && savedProfileValidation.valid ? <p className="gt-body">{profileLine}</p> : <p role="alert" className="gt-body">{profile ? t('review.profileInvalid') : t('review.noProfile')}</p>}
      </Section>

      <Section title={t('review.routineTitle')} onEdit={edit('routine')} t={t}>
        {variants.map((variant, index) => {
          const list = Array.isArray(variant?.exercises) ? variant.exercises : [];
          return (
            <article key={`${variant?.code}-${index}`} style={{ marginTop: 8 }}>
              <h3 className="gt-body" style={{ margin: 0, fontWeight: 700 }}>{label(variant?.code)} <span className="gt-sub">— {list.length === 1 ? t('review.exercisesOne') : t('review.exercisesMany', { n: list.length })}</span></h3>
              <ul className="gt-sub" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{list.map((entry, exerciseIndex) => <li key={`${entry?.order}-${exerciseIndex}`}>{entry?.name}</li>)}</ul>
            </article>
          );
        })}
        {!routineValidation.valid ? <p role="alert" className="gt-body">{t('review.routineInvalid')}</p> : null}
      </Section>

      <Section title={t('review.scheduleTitle')} onEdit={edit('schedule')} t={t}>
        {schedule?.mode === 'weekly' ? <>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{trainingDays.map((day) => <li key={day}>{t('review.dayLine', { day: t(`sched.day.${day}`), routine: label(schedule.week[day]) })}</li>)}</ul>
          {restDays.length ? <p className="gt-sub">{t('review.rest', { days: restDays.map((day) => t(`sched.day.${day}`)).join(t('review.daySeparator')) })}</p> : null}
        </> : schedule?.mode === 'independent' ? <p className="gt-body">{(Array.isArray(schedule.rotation) ? schedule.rotation : []).map(label).join(' → ')}</p>
          : <p role="alert" className="gt-body">{t('review.scheduleInvalid')}</p>}
        {schedule && !scheduleValidation.valid ? <p role="alert" className="gt-body">{t('review.scheduleInvalid')}</p> : null}
        <h3 className="gt-label" style={{ margin: '12px 0 2px' }}>{t('review.blockTitle')}</h3>
        {validGoal ? <p className="gt-body" style={{ margin: 0 }}>{t(schedule?.mode === 'independent' ? 'review.blockRotation' : 'review.blockWeekly', { n: goal })}</p> : <p role="alert" className="gt-body">{t('review.blockInvalid')}</p>}
      </Section>

      {several ? (
        <fieldset className="gt-card" style={{ ...cardStyle, border: 'none' }} disabled={applying || applied}>
          <legend className="gt-h2">{t('review.sessionMany', { n: unfinished.length })}</legend>
          <ul className="gt-body" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            {unfinished.map((workout) => {
              const date = formatDate(workout.date, locale);
              const routine = allVariants?.find((variant) => variant.code === workout.variant && variant.ownerPeriodId === workout.periodId)?.name;
              return <li key={workout.id} data-testid="unfinished-item">{date ? (routine ? t('review.sessionManyItem', { date, routine }) : t('review.sessionManyItemNoName', { date })) : t('review.sessionOneNoDate')}</li>;
            })}
          </ul>
          <p className="gt-sub" style={{ margin: '0 0 8px' }}>{t('review.sessionChoice')}</p>
          <label style={{ display: 'block' }}>
            <input type="radio" name="review-session" value="closeAll" checked={choice === 'closeAll'} onChange={() => setChoice('closeAll')} /> <strong>{t('review.sessionManyClose')}</strong>
            <span className="gt-sub" style={{ display: 'block', marginLeft: 22 }}>{t('review.sessionManyCloseHint')}</span>
          </label>
        </fieldset>
      ) : exactlyOnePartial ? (
        <fieldset className="gt-card" style={{ ...cardStyle, border: 'none' }} disabled={applying || applied}>
          <legend className="gt-h2">{sessionText}</legend>
          <p className="gt-sub" style={{ margin: '0 0 8px' }}>{t('review.sessionChoice')}</p>
          {onContinueOldSession ? (
            <label style={{ display: 'block', marginBottom: 8 }}>
              <input type="radio" name="review-session" value="finish" checked={choice === 'finish'} onChange={() => setChoice('finish')} /> <strong>{t('review.sessionFinish')}</strong>
              <span className="gt-sub" style={{ display: 'block', marginLeft: 22 }}>{t('review.sessionFinishHint')}</span>
            </label>
          ) : null}
          <label style={{ display: 'block' }}>
            <input type="radio" name="review-session" value="close" checked={choice === 'close'} onChange={() => setChoice('close')} /> <strong>{t('review.sessionClose')}</strong>
            <span className="gt-sub" style={{ display: 'block', marginLeft: 22 }}>{t('review.sessionCloseHint')}</span>
          </label>
        </fieldset>
      ) : null}
      {occupied && !finishFirst ? <p className="gt-sub">{t('review.periodOccupied')}</p> : period ? <p className="gt-sub">{t('review.periodEmpty')}</p> : null}

      {hint ? <p className="gt-sub" style={{ color: 'var(--accent)' }}>{hint}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status" aria-live="polite">{status}</p> : null}
      {embedded ? <InSlot slot={actionSlot}>{applyButton}</InSlot> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {applyButton}
          {onCancel ? <button type="button" className="gt-btn gt-btn-ghost" disabled={applying || applied} onClick={onCancel}>{t('review.cancel')}</button> : null}
        </div>
      )}
    </section>
  );
}
