import React, { useState } from 'react';
import { useT } from '../i18n.js';
import { validateSchedule } from '../schedule.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import InSlot from './wizard-slot.jsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GOALS = [4, 5, 6, 7, 8];
const cloneSchedule = (schedule) => schedule?.mode === 'weekly'
  ? { ...schedule, week: { ...(schedule.week || {}) } }
  : schedule?.mode === 'independent'
    ? { ...schedule, rotation: Array.isArray(schedule.rotation) ? [...schedule.rotation] : schedule.rotation }
    : schedule && typeof schedule === 'object' ? { ...schedule } : schedule;

/** A missing weekday behaves exactly like a rest day in selectScheduledVariant, so both read as "Rest". */
const dayCode = (schedule, day) => (typeof schedule?.week?.[day] === 'string' ? schedule.week[day] : null);
const hasAssignments = (schedule) => (schedule?.mode === 'weekly'
  ? WEEKDAYS.some((day) => dayCode(schedule, day) !== null)
  : schedule?.mode === 'independent' && Array.isArray(schedule.rotation) && schedule.rotation.length > 0);

/** Plain-language messages for schedule problems (no codes or paths). */
function scheduleMessages(schedule, validation, t) {
  const messages = [];
  if (schedule?.mode === 'weekly' && !WEEKDAYS.some((day) => dayCode(schedule, day) !== null) && validation.valid) messages.push(t('sched.err.noTrainingDay'));
  for (const error of validation.errors) {
    if (error.code === 'empty_rotation') messages.push(t('sched.err.emptyRotation'));
    else if (error.code === 'unknown_variant') messages.push(t('sched.err.gone'));
    else messages.push(t('sched.err.generic'));
  }
  return [...new Set(messages)];
}

/**
 * `embedded` (wizard): no card/heading; the primary action renders into `actionSlot`.
 * `variantNames` maps routine code -> name; `cycleGoal` + `onCycleGoalChange` show the block-length chooser.
 */
export default function ScheduleEditor({ schedule, variantCodes, variantNames = {}, cycleGoal = 6, onCycleGoalChange, onChange, onReady, embedded = false, actionSlot = null, primaryLabel }) {
  const { t } = useT();
  const validation = validateSchedule(schedule, variantCodes);
  const [addCode, setAddCode] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pendingMode, setPendingMode] = useState(null);
  const safeCodes = Array.isArray(variantCodes) ? variantCodes.filter((code) => typeof code === 'string' && code.length > 0) : [];
  const currentMode = ['weekly', 'independent'].includes(schedule?.mode) ? schedule.mode : null;
  const labelFor = (code) => (variantNames?.[code] ? `${code} · ${variantNames[code]}` : code);
  const send = (next) => onChange?.(next);
  const emptyFor = (mode) => (mode === 'weekly'
    ? { mode: 'weekly', week: Object.fromEntries(WEEKDAYS.map((day) => [day, null])) }
    : { mode: 'independent', rotation: [] });
  const chooseMode = (mode) => {
    if (mode === currentMode) return;
    if (hasAssignments(schedule)) setPendingMode(mode);
    else { send(emptyFor(mode)); setAttempted(false); }
  };
  const confirmSwitch = () => { send(emptyFor(pendingMode)); setPendingMode(null); setAttempted(false); };
  const changeDay = (day, value) => {
    const week = { ...(schedule?.week || {}) };
    week[day] = value.startsWith('routine:') ? value.slice('routine:'.length) : null;
    send({ ...schedule, mode: 'weekly', week });
  };
  const rotation = Array.isArray(schedule?.rotation) ? schedule.rotation : [];
  const changeRotation = (next) => send({ ...schedule, mode: 'independent', rotation: next });
  const addRoutine = () => {
    if (!addCode || !safeCodes.includes(addCode) || rotation.includes(addCode)) return;
    changeRotation([...rotation, addCode]);
    setAddCode('');
  };
  const addAll = () => changeRotation([...rotation, ...safeCodes.filter((code) => !rotation.includes(code))]);
  const moveRoutine = (index, direction) => {
    const next = [...rotation];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    changeRotation(next);
  };
  const removeRoutine = (index) => changeRotation(rotation.filter((_, i) => i !== index));

  const messages = scheduleMessages(schedule, validation, t);
  const ready = () => {
    if (!currentMode || !onReady) return;
    if (messages.length) { setAttempted(true); return; }
    onReady(cloneSchedule(schedule));
  };
  const goal = Number.isInteger(cycleGoal) && cycleGoal >= 4 && cycleGoal <= 8 ? cycleGoal : 6;
  const trainingDays = currentMode === 'weekly' ? WEEKDAYS.filter((day) => dayCode(schedule, day) !== null).length : 0;
  const label = primaryLabel ?? t('sched.use');
  const useButton = <button type="button" className="gt-btn gt-btn-primary" aria-label={label} disabled={!currentMode} onClick={ready}>{label}</button>;
  const modes = [
    { id: 'weekly', title: t('sched.mode.weekly'), hint: t('sched.mode.weeklyHint') },
    { id: 'independent', title: t('sched.mode.rotation'), hint: t('sched.mode.rotationHint') },
  ];

  return (
    <section className={embedded ? undefined : 'gt-card'} aria-label={t('sched.region')} style={embedded ? undefined : { padding: 16 }}>
      {embedded ? null : <h2 className="gt-h1" style={{ fontSize: 22 }}>{t('sched.standaloneTitle')}</h2>}
      <div role="radiogroup" aria-label={t('sched.modeLegend')} style={{ display: 'grid', gap: 10, margin: '8px 0 14px' }}>
        <p className="gt-body" style={{ margin: 0, fontWeight: 700 }}>{t('sched.modeLegend')}</p>
        {modes.map((mode) => (
          <label key={mode.id} htmlFor={`schedule-mode-${mode.id}`} className="gt-card"
            style={{ display: 'flex', gap: 10, padding: 12, cursor: 'pointer', border: `2px solid ${currentMode === mode.id ? 'var(--accent)' : 'transparent'}` }}>
            <input id={`schedule-mode-${mode.id}`} type="radio" name="schedule-mode" value={mode.id} checked={currentMode === mode.id} onChange={() => chooseMode(mode.id)} />
            <span>
              <strong className="gt-body" style={{ display: 'block' }}>{mode.title}</strong>
              <span className="gt-sub" style={{ display: 'block', margin: '2px 0 0' }}>{mode.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {!currentMode ? <p className="gt-sub">{t('sched.pickMode')}</p> : null}

      {currentMode === 'weekly' ? (
        <div style={{ marginTop: 6 }}>
          {WEEKDAYS.map((day) => {
            const code = dayCode(schedule, day);
            const gone = code !== null && !safeCodes.includes(code);
            return (
              <div key={day} style={{ margin: '10px 0' }}>
                <label htmlFor={`schedule-week-${day}`} className="gt-body" style={{ display: 'block', marginBottom: 5 }}>{t(`sched.day.${day}`)}</label>
                <select id={`schedule-week-${day}`} className="gt-input" value={code === null ? 'slot:rest' : `routine:${code}`} onChange={(event) => changeDay(day, event.target.value)}>
                  {gone ? <option value={`routine:${code}`}>{t('sched.gone', { code })}</option> : null}
                  <option value="slot:rest">{t('sched.rest')}</option>
                  {safeCodes.map((value) => <option key={value} value={`routine:${value}`}>{labelFor(value)}</option>)}
                </select>
              </div>
            );
          })}
          <p className="gt-sub" role="status" aria-live="polite">{t(trainingDays === 1 ? 'sched.summaryOne' : 'sched.summary', { train: trainingDays, rest: WEEKDAYS.length - trainingDays })}</p>
        </div>
      ) : null}

      {currentMode === 'independent' ? (
        <div style={{ marginTop: 6 }}>
          {rotation.length === 0 ? <p className="gt-sub">{t('sched.rotationEmpty')}</p> : (
            <ol aria-label={t('sched.rotationList')} style={{ listStyle: 'none', padding: 0, margin: '0 0 10px' }}>
              {rotation.map((code, index) => {
                const name = safeCodes.includes(code) ? labelFor(code) : t('sched.gone', { code });
                return (
                  <li key={`${index}-${code}`} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0' }}>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{index + 1}. {name}</span>
                    <button type="button" className="gt-btn gt-btn-ghost" aria-label={t('sched.moveUp', { name })} disabled={index === 0} onClick={() => moveRoutine(index, -1)}>↑</button>
                    <button type="button" className="gt-btn gt-btn-ghost" aria-label={t('sched.moveDown', { name })} disabled={index === rotation.length - 1} onClick={() => moveRoutine(index, 1)}>↓</button>
                    <button type="button" className="gt-btn gt-btn-ghost" aria-label={t('sched.remove', { name })} onClick={() => removeRoutine(index)}>✕</button>
                  </li>
                );
              })}
            </ol>
          )}
          <label htmlFor="schedule-add-routine" className="gt-body" style={{ display: 'block', margin: '10px 0 5px' }}>{t('sched.addLabel')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select id="schedule-add-routine" className="gt-input" value={addCode} onChange={(event) => setAddCode(event.target.value)}>
              <option value="">{t('sched.addChoose')}</option>
              {safeCodes.filter((code) => !rotation.includes(code)).map((code) => <option key={code} value={code}>{labelFor(code)}</option>)}
            </select>
            <button type="button" className="gt-btn gt-btn-ghost" disabled={!addCode} onClick={addRoutine}>{t('sched.addButton')}</button>
          </div>
          <button type="button" className="gt-btn gt-btn-ghost" style={{ marginTop: 8 }} disabled={safeCodes.every((code) => rotation.includes(code))} onClick={addAll}>{t('sched.addAll')}</button>
        </div>
      ) : null}

      {currentMode ? (
        <section aria-label={t('sched.goalTitle')} style={{ marginTop: 22 }}>
          <h2 className="gt-h2" style={{ margin: '0 0 8px' }}>{t('sched.goalTitle')}</h2>
          <div role="radiogroup" aria-label={t('sched.goalGroup')} style={{ display: 'flex', gap: 6 }}>
            {GOALS.map((value) => (
              <button key={value} type="button" role="radio" aria-checked={goal === value} className={`gt-btn ${goal === value ? 'gt-btn-primary' : 'gt-btn-ghost'}`}
                style={{ flex: 1 }} onClick={() => onCycleGoalChange?.(value)}>{value}</button>
            ))}
          </div>
          <p className="gt-sub">{t(currentMode === 'weekly' ? 'sched.goalWeekly' : 'sched.goalRotation', { n: goal })}</p>
          <p className="gt-sub">{t('sched.goalNote')}</p>
        </section>
      ) : null}

      {attempted && messages.length ? (
        <div role="alert" className="gt-card" style={{ padding: 12, margin: '12px 0' }}>{messages.map((message) => <p key={message} style={{ margin: 0 }}>{message}</p>)}</div>
      ) : null}
      {onReady ? (embedded ? <InSlot slot={actionSlot}>{useButton}</InSlot> : useButton) : null}
      {pendingMode ? (
        <ConfirmDialog titleId="schedule-switch-title"
          question={t(pendingMode === 'independent' ? 'sched.switchQuestionWeekly' : 'sched.switchQuestionRotation')}
          confirmLabel={t(pendingMode === 'independent' ? 'sched.switchToRotation' : 'sched.switchToWeekly')}
          cancelLabel={t(pendingMode === 'independent' ? 'sched.keepDays' : 'sched.keepRotation')}
          onConfirm={confirmSwitch} onClose={() => setPendingMode(null)} />
      ) : null}
    </section>
  );
}
