import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n.js';
import { SEED_PROFILE } from '../db.js';
import { validateProfileDraft } from '../setup.js';
import { useStore } from '../store.js';
import ManualRoutineEditor from './ManualRoutineEditor.jsx';
import ReviewRoutine from './ReviewRoutine.jsx';
import RoutineImport from './RoutineImport.jsx';
import ScheduleEditor from './ScheduleEditor.jsx';
import SetupProfile from './SetupProfile.jsx';
import Today from './Today.jsx';
import SkipDialog from './SkipDialog.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { isBlankDraft, remapScheduleCodes } from '../routine-codes.js';

const EMPTY_DRAFT = () => ({ schemaVersion: 1, variants: [] });
const PROFILE_FIELDS = ['name', 'sex', 'age', 'heightCm', 'bodyweightKg'];

function initialProfile(profile) {
  const checked = validateProfileDraft(profile);
  if (checked.valid) return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, checked.profile[key]]));
  return Object.fromEntries(PROFILE_FIELDS.map((key) => {
    if (checked.errors[key]) return [key, ''];
    const value = checked.profile[key];
    const seededDefault = (key === 'age' && value === SEED_PROFILE.age)
      || (key === 'bodyweightKg' && value === SEED_PROFILE.bodyweightKg);
    return [key, seededDefault || value == null ? '' : value];
  }));
}

// Internal stages grouped into the four steps the user sees.
const STEP_KEYS = ['profile', 'routine', 'schedule', 'confirm'];
const STAGE_STEP = { profile: 0, editor: 1, import: 1, schedule: 2, review: 3, continuation: 3 };
const BACK_TARGET = { editor: 'profile', import: 'editor', schedule: 'editor', review: 'schedule' };
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

function Stepper({ current, t }) {
  return (
    <nav aria-label={t('wizard.progress')} style={{ marginBottom: 16 }}>
      <p className="gt-label" style={{ color: 'var(--accent)', margin: '0 0 8px' }}>{t('wizard.stepOf', { n: current + 1, total: STEP_KEYS.length })}</p>
      <ol style={{ display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
        {STEP_KEYS.map((key, index) => {
          const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
          return (
            <li key={key} aria-current={state === 'current' ? 'step' : undefined} data-state={state}
              style={{ flex: 1, minWidth: 0, borderTop: `3px solid ${state === 'upcoming' ? 'var(--surface-2)' : 'var(--accent)'}`, paddingTop: 6, opacity: state === 'upcoming' ? 0.6 : 1 }}>
              <span className="gt-micro" style={{ fontWeight: state === 'current' ? 800 : 600, overflowWrap: 'anywhere' }}>
                <span aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>{' '}{t(`step.${key}`)}
              </span>
              {state === 'done' ? <span style={visuallyHidden}> ({t('wizard.stepDone')})</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default function SetupWizard({ onComplete, onClose } = {}) {
  const { t } = useT();
  const skipSetup = useStore((state) => state.skipSetup);
  const profile = useStore((state) => state.profile);
  const period = useStore((state) => state.period);
  const allPeriods = useStore((state) => state.allPeriods);
  const catalog = useStore((state) => state.exercises);
  const workouts = useStore((state) => state.workouts);
  const [stage, setStage] = useState('profile');
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [schedule, setSchedule] = useState(null);
  const [cycleGoal, setCycleGoal] = useState(() => period?.cycleGoal ?? 6);
  const [pinnedSession, setPinnedSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(null);
  const [actionSlot, setActionSlot] = useState(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const headingRef = useRef(null);
  const skipButtonRef = useRef(null);
  const previousStage = useRef(stage);
  const canSkip = !onClose;
  const profileInitial = useMemo(() => initialProfile(profile), [profile]);
  const variantCodes = draft.variants.map((variant) => variant.code);
  const variantNames = Object.fromEntries(draft.variants.map((variant) => [variant.code, variant.name]));

  useEffect(() => {
    if (stage !== 'continuation' || !pinnedSession) return;
    const active = allPeriods.filter((item) => item.status === 'active');
    const exactFinished = workouts.some((item) => item.id === pinnedSession.workoutId
      && item.periodId === pinnedSession.periodId && item.finished === true);
    if (period?.id === pinnedSession.periodId && period.status === 'active'
      && active.length === 1 && active[0].id === pinnedSession.periodId && exactFinished) {
      setPinnedSession(null);
      setStage('review');
    }
  }, [stage, pinnedSession, period, allPeriods, workouts]);

  const continueProfile = () => setStage('editor');
  const acceptImportedDraft = (importedDraft) => {
    // the imported routines have their own codes, so a schedule built for the old draft no longer applies
    setSchedule(null);
    setDraft(importedDraft);
    setPendingImport(null);
    setStage('editor');
  };
  const useImportedDraft = (importedDraft) => {
    if (isBlankDraft(draft)) acceptImportedDraft(importedDraft);
    else setPendingImport(importedDraft);
  };
  const keepCurrentDraft = () => {
    setPendingImport(null);
    setStage('editor');
  };
  // the editor reports how routine codes moved so a schedule already built keeps pointing at the same routines
  const changeDraft = (next, codeMap) => {
    setDraft(next);
    if (codeMap) setSchedule((current) => remapScheduleCodes(current, codeMap));
  };
  const readyDraft = (validatedDraft) => {
    setDraft(validatedDraft);
    setStage('schedule');
  };
  const readySchedule = (validSchedule) => {
    setSchedule(validSchedule);
    setStage('review');
  };
  const applied = async (result) => {
    if (result?.status !== 'applied') return;
    setCompleted({ routines: draft.variants.length, cycles: cycleGoal });
    await onComplete?.(result);
    setStage('complete');
  };
  const continueOldSession = (session) => {
    setPinnedSession({ workoutId: session.workoutId, periodId: session.periodId });
    setStage('continuation');
  };
  const EDIT_STAGE = { profile: 'profile', routine: 'editor', schedule: 'schedule' };
  const editFromReview = (step) => setStage(EDIT_STAGE[step] ?? 'review');
  const returnToReview = () => {
    setPinnedSession(null);
    setStage('review');
  };

  useEffect(() => {
    // after the first render, move focus to the new step heading so keyboard/screen-reader users land on it
    if (previousStage.current !== stage) headingRef.current?.focus();
    previousStage.current = stage;
  }, [stage]);

  const stepIndex = STAGE_STEP[stage];
  const titleKey = stage === 'import' ? 'import' : stage === 'complete' ? 'complete' : stage === 'continuation' ? 'continuation' : STEP_KEYS[stepIndex];
  const subKey = titleKey;
  const nextStepName = stepIndex != null && stepIndex < STEP_KEYS.length - 1 ? t(`step.${STEP_KEYS[stepIndex + 1]}`) : '';
  const primaryLabel = stage === 'review' ? t('wizard.start') : t('wizard.next', { step: nextStepName });
  const backTarget = BACK_TARGET[stage];
  const showBar = stage !== 'continuation' && stage !== 'complete';

  return (
    <main aria-label={t('wizard.region')} className="gt-scroll" style={{ height: '100%', padding: '18px 16px 0' }}>
      <div style={{ maxWidth: 520, width: '100%', margin: '0 auto', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', minHeight: 36, marginBottom: 4 }}>
            {canSkip && stage !== 'complete' ? (
              <button ref={skipButtonRef} type="button" className="gt-btn gt-btn-ghost" disabled={busy} onClick={() => setSkipOpen(true)}>{t('wizard.skip')}</button>
            ) : null}
            {!canSkip && stage !== 'complete' ? (
              <button type="button" className="gt-btn gt-btn-ghost" disabled={busy} onClick={() => onClose()}>{t('wizard.close')}</button>
            ) : null}
          </div>
          {stepIndex != null ? <Stepper current={stepIndex} t={t} /> : null}
          <header style={{ marginBottom: 16 }}>
            <h1 ref={headingRef} tabIndex={-1} className="gt-h1" style={{ fontSize: 26, margin: '0 0 5px', outline: 'none' }}>{t(`title.${titleKey}`)}</h1>
            <p className="gt-sub" style={{ margin: 0 }}>{t(`sub.${subKey}`)}</p>
          </header>

          {stage === 'profile' ? <SetupProfile embedded actionSlot={actionSlot} primaryLabel={primaryLabel} onBusyChange={setBusy} initialProfile={profileInitial} onSaved={continueProfile} /> : null}

          {stage === 'editor' ? <ManualRoutineEditor embedded actionSlot={actionSlot} primaryLabel={primaryLabel} draft={draft} catalog={catalog} onChange={changeDraft} onReady={readyDraft} onImport={() => setStage('import')} /> : null}

          {stage === 'import' ? <RoutineImport embedded catalog={catalog} onDecoded={useImportedDraft} /> : null}

          {stage === 'schedule' ? <ScheduleEditor embedded actionSlot={actionSlot} primaryLabel={primaryLabel} schedule={schedule} variantCodes={variantCodes} variantNames={variantNames} cycleGoal={cycleGoal} onCycleGoalChange={setCycleGoal} onChange={setSchedule} onReady={readySchedule} /> : null}

          {stage === 'review' ? <ReviewRoutine
            embedded actionSlot={actionSlot} primaryLabel={primaryLabel} onBusyChange={setBusy}
            draft={draft} schedule={schedule} cycleGoal={cycleGoal}
            onApplied={applied} onContinueOldSession={continueOldSession} onEdit={editFromReview}
          /> : null}

          {stage === 'continuation' && pinnedSession ? <Today pinnedSession={pinnedSession} onReturn={returnToReview} /> : null}

          {stage === 'complete' ? <section role="status">
            {completed ? <p className="gt-body">{completed.routines === 1 ? t('complete.summaryOne', { cycles: completed.cycles }) : t('complete.summaryMany', { n: completed.routines, cycles: completed.cycles })}</p> : null}
            {onClose ? <button type="button" className="gt-btn gt-btn-primary" onClick={() => onClose()}>{t('wizard.done')}</button> : null}
          </section> : null}
        </div>

        {showBar ? (
          <div role="group" aria-label={t('wizard.nav')} style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 10, padding: '12px 0 calc(12px + env(safe-area-inset-bottom, 0px))', background: 'var(--bg)', marginTop: 16 }}>
            {backTarget ? <button type="button" className="gt-btn gt-btn-ghost" disabled={busy} onClick={() => setStage(backTarget)}>{t('wizard.back')}</button> : null}
            <div ref={setActionSlot} style={{ flex: 1, display: 'flex' }} className="gt-wizard-primary" />
          </div>
        ) : null}
      </div>
      {pendingImport ? (
        <ConfirmDialog titleId="replace-dialog-title" question={t('confirm.replaceQuestion')} confirmLabel={t('confirm.replace')} cancelLabel={t('confirm.keep')}
          onConfirm={() => acceptImportedDraft(pendingImport)} onClose={keepCurrentDraft} />
      ) : null}
      {skipOpen ? <SkipDialog t={t} onSkip={skipSetup} onClose={() => { setSkipOpen(false); skipButtonRef.current?.focus(); }} /> : null}
    </main>
  );
}
