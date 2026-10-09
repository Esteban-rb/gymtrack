import React, { useState } from 'react';
import { validateRoutineDraft } from '../routine-draft.js';
import { friendlyList } from '../routine-messages.js';
import { isAutoCoded, letterCode, nextFreeCode, renumber } from '../routine-codes.js';
import { useT } from '../i18n.js';
import InSlot from './wizard-slot.jsx';
import ExercisePicker, { optionLabel } from './ExercisePicker.jsx';

const UNITS = ['kg', 'lb', 'plates', 'kgx2', 'lbx2'];
const DEFAULT_KIND = 'Custom';
let localKeySequence = 0;
const newLocalKey = () => `manual-${Date.now().toString(36)}-${++localKeySequence}`;
const maxOrder = (items) => items.reduce((max, item) => Number.isInteger(item?.order) ? Math.max(max, item.order) : max, -1);
const stableKey = (item, index) => Number.isInteger(item?.order) ? `order-${item.order}` : `index-${index}`;
const blankExercise = (order) => ({ ref: null, name: '', order, unit: 'kg', muscle: '' });
const blankRoutine = (code, order) => ({ code, order, name: '', kind: DEFAULT_KIND, exercises: [blankExercise(0)] });
const foldName = (value) => String(value || '').trim().toLocaleLowerCase('und');

// "Kind" is not shown in the editor: a blank one falls back to the default instead of becoming a hidden error.
const withDefaultKind = (draft) => Array.isArray(draft?.variants)
  ? { ...draft, variants: draft.variants.map((variant) => variant && typeof variant === 'object' && !String(variant.kind ?? '').trim() ? { ...variant, kind: DEFAULT_KIND } : variant) }
  : draft;

const pathOf = (error) => String(error.path || '');

/** Controlled local routine editor. It never writes to the store or database. */
/** `embedded` (wizard): no card/heading; the primary action renders into `actionSlot`. */
export default function ManualRoutineEditor({ draft, catalog, onChange, onReady, onImport, embedded = false, actionSlot = null, primaryLabel }) {
  const { t } = useT();
  const [attempted, setAttempted] = useState(false);
  const [open, setOpen] = useState({});
  const validation = validateRoutineDraft(withDefaultKind(draft), catalog);
  const variants = Array.isArray(draft?.variants) ? draft.variants : [];
  const isOpen = (index) => open[index] ?? index === variants.length - 1;
  const showErrors = attempted && !validation.valid;

  const replaceVariant = (index, update) => onChange({ ...draft, variants: variants.map((variant, i) => i === index ? update(variant) : variant) });
  const replaceExercise = (variantIndex, exerciseIndex, update) => replaceVariant(variantIndex, (variant) => ({
    ...variant,
    exercises: variant.exercises.map((exercise, i) => i === exerciseIndex ? update(exercise) : exercise),
  }));
  const changeExercise = (variantIndex, exerciseIndex, field, value) => {
    const current = variants[variantIndex]?.exercises?.[exerciseIndex];
    if (!current) return;
    if (current.ref?.type === 'new' && ['name', 'muscle', 'unit'].includes(field)) {
      const key = current.ref.key;
      onChange({
        ...draft,
        variants: variants.map((variant) => ({
          ...variant,
          exercises: variant.exercises.map((exercise) => exercise.ref?.type === 'new' && exercise.ref.key === key
            ? { ...exercise, [field]: value }
            : exercise),
        })),
      });
      return;
    }
    replaceExercise(variantIndex, exerciseIndex, (exercise) => ({ ...exercise, [field]: value }));
  };
  const pickCatalog = (variantIndex, exerciseIndex, item) => replaceExercise(variantIndex, exerciseIndex, (exercise) => ({
    ...exercise,
    ref: { type: 'catalog', id: item.id }, name: item.name, muscle: item.muscle || '', unit: exercise.ref?.type === 'catalog' && exercise.ref.id === item.id ? exercise.unit || item.unit || 'kg' : item.unit || 'kg',
  }));
  const pickNew = (variantIndex, exerciseIndex) => replaceExercise(variantIndex, exerciseIndex, (exercise) => (
    exercise.ref?.type === 'new' ? exercise : { ...exercise, ref: { type: 'new', key: newLocalKey() }, name: '', muscle: '', unit: 'kg' }
  ));
  const swapOrders = (items, index, target) => {
    const next = items.map((item) => ({ ...item }));
    const order = next[index].order;
    next[index].order = next[target].order;
    next[target].order = order;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };
  const moveVariant = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= variants.length) return;
    const flags = variants.map((_, i) => isOpen(i));
    [flags[index], flags[target]] = [flags[target], flags[index]];
    setOpen(Object.fromEntries(flags.map((flag, i) => [i, flag])));
    // the user reordered: letters follow the new positions; report the moves so a built schedule can follow
    const permuted = swapOrders(variants, index, target);
    onChange({ ...draft, variants: renumber(permuted) }, Object.fromEntries(permuted.map((item, position) => [item.code, letterCode(position)])));
  };
  const moveExercise = (variantIndex, exerciseIndex, direction) => {
    const target = exerciseIndex + direction;
    const list = variants[variantIndex].exercises;
    if (target < 0 || target >= list.length) return;
    replaceVariant(variantIndex, (variant) => ({ ...variant, exercises: swapOrders(list, exerciseIndex, target) }));
  };
  const startFromScratch = () => {
    setOpen({ 0: true });
    onChange({ ...draft, variants: [blankRoutine('A', 0)] });
  };
  const addVariant = () => {
    const flags = Object.fromEntries(variants.map((_, i) => [i, isOpen(i)]));
    setOpen({ ...flags, [variants.length]: true });
    onChange({ ...draft, variants: [...variants, blankRoutine(nextFreeCode(variants), maxOrder(variants) + 1)] });
  };
  const addExercise = (variantIndex) => replaceVariant(variantIndex, (variant) => ({
    ...variant, exercises: [...variant.exercises, blankExercise(maxOrder(variant.exercises) + 1)],
  }));
  const removeVariant = (index) => {
    const kept = variants.filter((_, i) => i !== index);
    setOpen(Object.fromEntries(variants.map((_, i) => isOpen(i)).filter((_, i) => i !== index).map((flag, i) => [i, flag])));
    const renumbered = isAutoCoded(kept);
    const codeMap = renumbered ? Object.fromEntries(kept.map((item, position) => [item.code, letterCode(position)])) : {};
    codeMap[variants[index].code] = null;
    onChange({ ...draft, variants: renumbered ? renumber(kept) : kept }, codeMap);
  };
  const removeExercise = (variantIndex, exerciseIndex) => replaceVariant(variantIndex, (variant) => ({
    ...variant, exercises: variant.exercises.filter((_, i) => i !== exerciseIndex),
  }));

  const attempt = () => {
    if (validation.valid) { onReady?.(validation.draft); return; }
    setAttempted(true);
    const flags = Object.fromEntries(variants.map((_, i) => [i, isOpen(i) || validation.errors.some((error) => pathOf(error).startsWith(`variants[${i}]`))]));
    setOpen(flags);
  };

  const errorsMatching = (test) => showErrors ? validation.errors.filter((error) => test(pathOf(error), error)) : [];
  const inlineError = (id, errors) => {
    const messages = friendlyList(errors, t, 'editor');
    return messages.length ? <div id={id} className="gt-micro" style={{ color: 'var(--accent)', marginTop: 4 }}>{messages.join(' ')}</div> : null;
  };
  const field = (id, label, control, errors) => {
    const errorId = errors.length ? `${id}-error` : undefined;
    return (
      <div style={{ margin: '8px 0' }}>
        <label htmlFor={id} className="gt-micro" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
        {control(errorId)}
        {inlineError(errorId, errors)}
      </div>
    );
  };

  const hasRoutines = variants.length > 0;
  const label = primaryLabel ?? t('routine.continue');
  const actionButton = <button type="button" className="gt-btn gt-btn-primary" disabled={!hasRoutines} onClick={attempt}>{label}</button>;
  const countLabel = (n) => n === 1 ? t('routine.exerciseCountOne') : t('routine.exerciseCount', { n });

  const importButton = onImport ? <button type="button" className="gt-btn gt-btn-ghost" onClick={onImport}>{t('routine.importInstead')}</button> : null;

  return (
    <section aria-label={t('routine.region')} className={embedded ? undefined : 'gt-card'} style={embedded ? undefined : { padding: 16 }}>
      {embedded ? null : <h2 className="gt-h1" style={{ fontSize: 22 }}>{t('step.routine')}</h2>}
      {!hasRoutines ? <p className="gt-sub" style={{ margin: '4px 0 0' }}>{t('routine.pickStart')}</p> : null}
      {!hasRoutines ? (
        <div role="group" aria-label={t('routine.start')} style={{ display: 'grid', gap: 12, margin: '8px 0' }}>
          <button type="button" className="gt-card" aria-label={t('routine.scratch')} aria-describedby="routine-scratch-hint" onClick={startFromScratch} style={{ textAlign: 'left', padding: 16, cursor: 'pointer', color: 'inherit' }}>
            <strong className="gt-body" style={{ display: 'block' }}>{t('routine.scratch')}</strong>
            <span id="routine-scratch-hint" className="gt-sub">{t('routine.scratchHint')}</span>
          </button>
          {onImport ? (
            <button type="button" className="gt-card" aria-label={t('routine.importFile')} aria-describedby="routine-import-hint" onClick={onImport} style={{ textAlign: 'left', padding: 16, cursor: 'pointer', color: 'inherit' }}>
              <strong className="gt-body" style={{ display: 'block' }}>{t('routine.importFile')}</strong>
              <span id="routine-import-hint" className="gt-sub">{t('routine.importHint')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {variants.map((variant, variantIndex) => {
        const variantPath = `variants[${variantIndex}]`;
        const expanded = isOpen(variantIndex);
        const bodyId = `manual-routine-variant-${variantIndex}-body`;
        const nameId = `manual-routine-variant-${variantIndex}-name`;
        const exercises = Array.isArray(variant.exercises) ? variant.exercises : [];
        const nameErrors = errorsMatching((path) => path === `${variantPath}.name`);
        const listErrors = errorsMatching((path) => path === `${variantPath}.exercises`);
        const otherErrors = errorsMatching((path) => path.startsWith(variantPath) && !path.startsWith(`${variantPath}.exercises[`) && path !== `${variantPath}.name` && path !== `${variantPath}.exercises`);
        const title = String(variant.name || '').trim() || t('routine.untitled');
        return (
          <article key={stableKey(variant, variantIndex)} className="gt-card" style={{ padding: 14, margin: '14px 0' }}>
            <h2 className="gt-h2" style={{ margin: 0 }}>
              <button type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setOpen({ ...Object.fromEntries(variants.map((_, i) => [i, isOpen(i)])), [variantIndex]: !expanded })}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <span aria-hidden="true" className="gt-label" style={{ minWidth: 28, height: 28, borderRadius: 14, display: 'inline-grid', placeItems: 'center', background: 'var(--accent)', color: 'var(--bg)', padding: '0 6px', boxSizing: 'border-box' }}>{variant.code}</span>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t('routine.badge', { code: variant.code })}: </span>
                  {title}
                  <span className="gt-micro" style={{ display: 'block', fontWeight: 400 }}>{countLabel(exercises.length)}</span>
                </span>
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
              </button>
            </h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 0' }}>
              <button type="button" className="gt-btn gt-btn-ghost" aria-label={t('routine.moveUp', { code: variant.code })} disabled={variantIndex === 0} onClick={() => moveVariant(variantIndex, -1)}>↑</button>
              <button type="button" className="gt-btn gt-btn-ghost" aria-label={t('routine.moveDown', { code: variant.code })} disabled={variantIndex === variants.length - 1} onClick={() => moveVariant(variantIndex, 1)}>↓</button>
              <button type="button" className="gt-btn gt-btn-ghost" onClick={() => removeVariant(variantIndex)}>{t('routine.remove', { name: String(variant.name || '').trim() || variant.code })}</button>
            </div>
            {expanded ? (
              <div id={bodyId}>
                {field(nameId, t('routine.name'), (errorId) => (
                  <input id={nameId} type="text" className="gt-input" value={variant.name ?? ''} placeholder={t('routine.namePlaceholder')}
                    onChange={(event) => replaceVariant(variantIndex, (current) => ({ ...current, name: event.target.value }))}
                    aria-invalid={nameErrors.length ? 'true' : undefined} aria-describedby={errorId} />
                ), nameErrors)}
                {inlineError(`${bodyId}-other`, otherErrors)}
                <h3 className="gt-body">{t('routine.exercises')}</h3>
                {exercises.map((exercise, exerciseIndex) => {
                  const exercisePath = `${variantPath}.exercises[${exerciseIndex}]`;
                  const base = `manual-routine-exercise-${variantIndex}-${exerciseIndex}`;
                  const isNew = exercise.ref?.type === 'new';
                  const isCatalog = exercise.ref?.type === 'catalog';
                  const nameMatchesCatalog = isNew && catalog.some((item) => foldName(item.name) === foldName(exercise.name));
                  const forPicker = errorsMatching((path, error) => path === `${exercisePath}.ref` && !(isNew && error.code === 'basic-identity') || (isCatalog && path === `${exercisePath}.name`));
                  const forName = errorsMatching((path, error) => isNew && (path === `${exercisePath}.name` || (path === `${exercisePath}.ref` && error.code === 'basic-identity')));
                  const forMuscle = errorsMatching((path) => isNew && path === `${exercisePath}.muscle`);
                  const forUnit = errorsMatching((path) => path === `${exercisePath}.unit`);
                  const pickerErrorId = forPicker.length ? `${base}-picker-error` : undefined;
                  const selectedLabel = isCatalog ? optionLabel({ name: exercise.name, muscle: exercise.muscle }) : isNew ? t('exercise.create') : '';
                  const unitChoices = exercise.unit === 'x2' ? [...UNITS, 'x2'] : UNITS;
                  const exerciseName = String(exercise.name || '').trim() || t('exercise.unnamed', { n: exerciseIndex + 1 });
                  return (
                    <div key={stableKey(exercise, exerciseIndex)} className="gt-card" style={{ padding: 12, margin: '10px 0' }}>
                      <label htmlFor={`${base}-picker`} className="gt-micro" style={{ display: 'block', marginBottom: 4 }}>{t('exercise.label', { n: exerciseIndex + 1 })}</label>
                      <ExercisePicker id={`${base}-picker`} t={t} catalog={catalog} selectedLabel={selectedLabel}
                        invalid={forPicker.length > 0} describedBy={pickerErrorId}
                        onPickCatalog={(item) => pickCatalog(variantIndex, exerciseIndex, item)} onCreate={() => pickNew(variantIndex, exerciseIndex)} />
                      {inlineError(pickerErrorId, forPicker)}
                      {isNew ? (
                        <>
                          {field(`${base}-name`, t('exercise.name'), (errorId) => (
                            <input id={`${base}-name`} type="text" className="gt-input" value={exercise.name ?? ''} onChange={(event) => changeExercise(variantIndex, exerciseIndex, 'name', event.target.value)}
                              aria-invalid={forName.length ? 'true' : undefined} aria-describedby={errorId} />
                          ), forName)}
                          {nameMatchesCatalog ? <p className="gt-micro" role="note">{t('exercise.exists')}</p> : null}
                          {field(`${base}-muscle`, t('exercise.muscle'), (errorId) => (
                            <input id={`${base}-muscle`} type="text" className="gt-input" value={exercise.muscle ?? ''} onChange={(event) => changeExercise(variantIndex, exerciseIndex, 'muscle', event.target.value)}
                              aria-invalid={forMuscle.length ? 'true' : undefined} aria-describedby={errorId} />
                          ), forMuscle)}
                        </>
                      ) : null}
                      {isNew || isCatalog ? field(`${base}-unit`, t('exercise.unit'), (errorId) => (
                        <select id={`${base}-unit`} className="gt-input" value={exercise.unit ?? ''} onChange={(event) => changeExercise(variantIndex, exerciseIndex, 'unit', event.target.value)}
                          aria-invalid={forUnit.length ? 'true' : undefined} aria-describedby={errorId}>
                          {exercise.unit != null && !unitChoices.includes(exercise.unit) ? <option value={exercise.unit}>{t('unit.unsupported', { unit: String(exercise.unit) })}</option> : null}
                          {unitChoices.map((unit) => <option key={unit} value={unit}>{t(`unit.${unit}`)}</option>)}
                        </select>
                      ), forUnit) : null}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                        <button type="button" className="gt-btn gt-btn-ghost" aria-label={t('exercise.moveUp', { n: exerciseIndex + 1, code: variant.code })} disabled={exerciseIndex === 0} onClick={() => moveExercise(variantIndex, exerciseIndex, -1)}>↑</button>
                        <button type="button" className="gt-btn gt-btn-ghost" aria-label={t('exercise.moveDown', { n: exerciseIndex + 1, code: variant.code })} disabled={exerciseIndex === exercises.length - 1} onClick={() => moveExercise(variantIndex, exerciseIndex, 1)}>↓</button>
                        <button type="button" className="gt-btn gt-btn-ghost" onClick={() => removeExercise(variantIndex, exerciseIndex)}>{t('exercise.remove', { name: exerciseName })}</button>
                      </div>
                    </div>
                  );
                })}
                {inlineError(`${bodyId}-list`, listErrors)}
                <button type="button" className="gt-btn gt-btn-ghost" onClick={() => addExercise(variantIndex)}>{t('routine.addExercise')}</button>
              </div>
            ) : null}
          </article>
        );
      })}
      {showErrors ? <p role="alert" className="gt-sub" style={{ color: 'var(--accent)' }}>{t('routine.fixSummary')}</p> : null}
      {hasRoutines ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <button type="button" className="gt-btn gt-btn-ghost" onClick={addVariant}>{t('routine.add')}</button>
          {importButton}
        </div>
      ) : null}
      <div style={{ marginTop: 14 }}>{embedded ? <InSlot slot={actionSlot}>{actionButton}</InSlot> : actionButton}</div>
    </section>
  );
}
