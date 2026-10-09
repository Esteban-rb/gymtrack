// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';

const state = () => useStore.getState();
const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
beforeEach(async () => {
  globalThis.window = {};
  await db.delete(); await db.open();
  useStore.setState({ loaded: false, profile: null, period: null, allPeriods: [], exercises: [], variants: [], allVariants: [], workouts: [], setsByWorkout: {}, bodyweight: [], prs: {}, activeVariant: null, scheduleView: null });
  await ensureSeeded(); await state().init();
});
async function configured(mode = 'independent') {
  const trainingSchedule = mode === 'weekly'
    ? { mode, week: { Mon: 'U1', Tue: null, Wed: 'L1', Thu: 'U1', Fri: null, Sat: 'L1', Sun: null } }
    : { mode, rotation: ['U1', 'L1'] };
  const period = { ...state().period, startDate: '2026-06-03', cycle: 1, rotationPos: 0, routineVariantCodes: ['U1', 'L1'], trainingSchedule };
  await db.periods.put(period);
  useStore.setState({ period, allPeriods: [period], variants: ['U1', 'L1'].map(code => state().allVariants.find(v => v.code === code)) });
  return period;
}

describe('configured schedule view selection', () => {
  it('browses cycle/variant in memory and clears without changing any database or automatic plan state', async () => {
    const period = await configured();
    const before = await snapshot();
    const activeVariantBefore = state().activeVariant;
    await state().setActiveCycle(4);
    await state().setActiveVariant('L1');
    expect(state().scheduleView).toEqual({ periodId: period.id, cycle: 4, variantCode: 'L1' });
    expect(state().trainingView('2026-06-03')).toMatchObject({ cycle: 4, variantCode: 'L1', isManual: true, workout: null });
    expect(state().currentVariant('2026-06-03').code).toBe('U1');
    expect(state().effectiveCycle('2026-06-03')).toBe(1);
    expect(state().period.rotationPos).toBe(0);
    expect(state().activeVariant).toEqual(activeVariantBefore);
    expect(await snapshot()).toEqual(before);
    state().clearScheduleView();
    expect(state().scheduleView).toBeNull();
    expect(state().trainingView('2026-06-03')).toMatchObject({ cycle: 1, variantCode: 'U1', isManual: false });
    expect(await snapshot()).toEqual(before);
  });

  it('rejects invalid configured browsing choices without writes or view changes', async () => {
    await configured();
    const before = await snapshot();
    await state().setActiveCycle(0); await state().setActiveCycle(2.5); await state().setActiveVariant('unknown');
    expect(state().scheduleView).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('gives a saved unfinished snapshot precedence over manual view, rest, and date change', async () => {
    const period = await configured('weekly');
    const workout = { periodId: period.id, date: '2026-06-03', cycle: 1, variant: 'L1', block: 'Saved label', finished: false, entries: [{ exerciseId: 'hack-squat', unit: 'plates', saved: true }] };
    workout.id = await db.workouts.add(workout);
    useStore.setState({ workouts: [workout] });
    await state().setActiveCycle(7); await state().setActiveVariant('U1');
    const before = await snapshot();
    expect(state().trainingView('2026-06-09')).toMatchObject({ cycle: 1, variantCode: 'L1', workout, isManual: false });
    expect(state().trainingView('2026-06-09').workout.entries).toEqual(workout.entries);
    expect(await snapshot()).toEqual(before);
  });

  it('uses derived weekly cycle for automatic views and only same-date finished session lookup', async () => {
    const period = await configured('weekly');
    const older = { periodId: period.id, date: '2026-06-08', cycle: 2, variant: 'U1', finished: true, entries: [{ exerciseId: 'bench', unit: 'lb' }] };
    older.id = await db.workouts.add(older);
    useStore.setState({ workouts: [older] });
    expect(state().period.cycle).toBe(1);
    expect(state().trainingView('2026-06-08')).toMatchObject({ cycle: 2, variantCode: 'U1', workout: older, isManual: false });
    expect(state().trainingView('2026-06-11')).toMatchObject({ cycle: 2, variantCode: 'U1', workout: null, isManual: false });
    await state().setActiveCycle(3); await state().setActiveVariant('U1');
    expect(state().trainingView('2026-06-11')).toMatchObject({ cycle: 3, variantCode: 'U1', workout: null, isManual: true });
  });

  it('shows saved finished-session snapshot for manual history without relabeling', async () => {
    const period = await configured();
    const history = { periodId: period.id, date: '2026-05-01', cycle: 3, variant: 'L1', block: 'Old saved block', finished: true, entries: [{ exerciseId: 'hack-squat', unit: 'plates', label: 'Old entry' }] };
    history.id = await db.workouts.add(history);
    useStore.setState({ workouts: [history] });
    await state().setActiveCycle(3); await state().setActiveVariant('L1');
    const view = state().trainingView('2026-06-03');
    expect(view).toMatchObject({ cycle: 3, variantCode: 'L1', workout: history, isManual: true });
    expect(view.workout.block).toBe('Old saved block');
    expect(view.workout.entries).toEqual(history.entries);
  });

  it('clears a period-scoped manual view on reinit and mesocycle replacement', async () => {
    const period = await configured();
    await state().setActiveVariant('L1');
    expect(state().scheduleView).not.toBeNull();
    useStore.setState({ loaded: false }); await state().init();
    expect(state().scheduleView).toBeNull();
    await state().setActiveVariant('L1');
    await state().startNewMesocycle(5);
    expect(state().scheduleView).toBeNull();
    expect(state().period.id).not.toBe(period.id);
    await state().setActiveVariant('L1');
    await state().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 70 });
    const draft = { schemaVersion: 1, variants: [{ code: 'new', order: 0, name: 'New plan', kind: 'Upper', exercises: [{ ref: { type: 'catalog', id: 'bench' }, name: 'Bench Press', muscle: 'Chest', unit: 'kg', order: 0 }] }] };
    await state().applyReviewedRoutine(draft, { mode: 'independent', rotation: ['new'] });
    expect(state().scheduleView).toBeNull();
  });
});
