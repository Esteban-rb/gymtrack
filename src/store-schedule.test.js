// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';

const state = () => useStore.getState();
beforeEach(async () => {
  globalThis.window = {};
  await db.delete(); await db.open();
  useStore.setState({ loaded: false, profile: null, period: null, allPeriods: [], exercises: [], variants: [], allVariants: [], workouts: [], setsByWorkout: {}, bodyweight: [], prs: {}, activeVariant: null });
  await ensureSeeded(); await state().init();
});
async function configure({ mode = 'weekly', startDate = '2026-06-08', week = { Mon: 'U1', Tue: null, Wed: 'L1', Thu: 'U1', Fri: null, Sat: 'L1', Sun: null }, rotation = ['L1', 'U1'] } = {}) {
  const period = { ...state().period, startDate, cycle: 1, rotationPos: 0, routineVariantCodes: ['U1', 'L1'], trainingSchedule: mode === 'weekly' ? { mode, week } : { mode, rotation } };
  await db.periods.put(period); useStore.setState({ period, allPeriods: [period], variants: ['U1', 'L1'].map(c => state().variants.find(v => v.code === c)) });
  return period;
}

describe('store schedule adapter', () => {
  it('selects configured weekly slots by explicit weekday and treats rest as no pending variant', async () => {
    await configure();
    expect(state().currentVariant('2026-06-08')?.code).toBe('U1');
    expect(state().currentVariant('2026-06-09')).toBeNull();
    expect(state().currentVariant('2026-06-10')?.code).toBe('L1');
    expect(state().currentVariant('2026-06-11')?.code).toBe('U1');
    expect(state().currentVariant('2026-06-12')).toBeNull();
    expect(state().currentVariant('2026-06-13')?.code).toBe('L1');
    expect(state().currentVariant('2026-06-14')).toBeNull();
    expect(await state().createWorkout(undefined, '2026-06-09')).toBeNull();
  });

  it('resumes a saved unfinished snapshot on rest/day change without creating another workout', async () => {
    await configure();
    const prior = { id: 91, periodId: state().period.id, date: '2026-06-08', variant: 'U1', finished: false, entries: [{ exerciseId: 'incline-press', unit: 'lb', custom: 'kept' }] };
    await db.workouts.add(prior);
    useStore.setState({ workouts: [prior] });
    const resumed = await state().createWorkout(undefined, '2026-06-09');
    expect(resumed).toEqual(prior);
    expect(state().todayWorkout()).toEqual(prior);
    expect(await db.workouts.count()).toBe(1);
  });

  it('derives weekly cycles by calendar Mondays regardless of missed sessions and midweek start', async () => {
    await configure({ startDate: '2026-06-10' });
    expect(state().effectiveCycle('2026-06-08')).toBe(1);
    expect(state().effectiveCycle('2026-06-14')).toBe(1);
    expect(state().effectiveCycle('2026-06-15')).toBe(2);
    expect(state().effectiveCycle('2026-06-21')).toBe(2);
    expect(state().period.cycle).toBe(1);
    const workout = await state().createWorkout('U1', '2026-06-15');
    expect(workout.cycle).toBe(2);
    expect(workout.week).toBe(2);
    useStore.setState({ loaded: false }); await state().init();
    expect(state().period.trainingSchedule.mode).toBe('weekly');
    expect(state().effectiveCycle('2026-06-15')).toBe(2);
  });

  it('uses configured independent order and advances only on actual active completion', async () => {
    await configure({ mode: 'independent', rotation: ['L1', 'U1'] });
    const historical = { periodId: 999, date: '2026-06-01', variant: 'L1', cycle: 1, finished: false, entries: [] };
    historical.id = await db.workouts.add(historical);
    useStore.setState({ workouts: [historical] });
    await state().finishWorkout(historical.id);
    expect(state().period.rotationPos).toBe(0);
    const workout = await state().createWorkout(undefined, '2026-06-08');
    expect(workout.variant).toBe('L1');
    expect(state().period.rotationPos).toBe(0);
    await state().finishWorkout(workout.id);
    expect(state().period.rotationPos).toBe(1);
    const before = state().period;
    await state().setActiveVariant('U1');
    await state().setActiveCycle(7);
    expect(state().period).toEqual(before);
    await state().finishWorkout(workout.id);
    expect(state().period).toEqual(before);
    const next = await state().createWorkout(undefined, '2026-06-09');
    expect(next.variant).toBe('U1');
    await state().finishWorkout(next.id);
    expect(state().period).toMatchObject({ rotationPos: 0, cycle: 2 });
  });

  it('atomically rolls back completion when the configured period update fails, then retry advances once', async () => {
    const period = await configure({ mode: 'independent', rotation: ['L1', 'U1'] });
    const workout = await state().createWorkout(undefined, '2026-06-08');
    const setId = await db.sets.add({ workoutId: workout.id, exerciseId: 'calf-raise', n: 1, reps: 8, value: 20, unit: 'kg', realKg: 20 });
    const beforeTables = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
    const beforeState = structuredClone({ period: state().period, allPeriods: state().allPeriods, workouts: state().workouts, variants: state().variants, activeVariant: state().activeVariant });
    let sawFinished = false;
    const spy = vi.spyOn(db.periods, 'put').mockImplementation(async (...args) => {
      const persistedWorkout = await db.workouts.get(workout.id);
      const persistedPeriod = await db.periods.get(period.id);
      sawFinished = persistedWorkout.finished && persistedPeriod.rotationPos === 0;
      throw new Error('injected period update failure');
    });
    try {
      await expect(state().finishWorkout(workout.id)).rejects.toThrow('injected period update failure');
    } finally { spy.mockRestore(); }
    expect(sawFinished).toBe(true);
    expect(Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))).toEqual(beforeTables);
    expect(structuredClone({ period: state().period, allPeriods: state().allPeriods, workouts: state().workouts, variants: state().variants, activeVariant: state().activeVariant })).toEqual(beforeState);
    await state().finishWorkout(workout.id);
    expect(state().period).toMatchObject({ rotationPos: 1, cycle: 1 });
    expect(await db.workouts.get(workout.id)).toEqual({ ...workout, finished: true });
    expect(await db.sets.get(setId)).toBeTruthy();
    const completedPeriod = state().period;
    await state().finishWorkout(workout.id);
    expect(state().period).toEqual(completedPeriod);
  });

  it.each(['missing', 'weekly'])('routes from persisted independent config when cached mode is %s', async (cachedMode) => {
    const period = await configure({ mode: 'independent', rotation: ['L1', 'U1'] });
    const workout = await state().createWorkout(undefined, '2026-06-08');
    const stale = { ...period };
    if (cachedMode === 'missing') delete stale.trainingSchedule;
    else stale.trainingSchedule = { mode: 'weekly', week: { Mon: 'U1' } };
    useStore.setState({ period: stale, allPeriods: [stale] });
    const beforeTables = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
    const beforeState = structuredClone({ period: state().period, allPeriods: state().allPeriods, workouts: state().workouts, activeVariant: state().activeVariant });
    let observed = false;
    const spy = vi.spyOn(db.periods, 'put').mockImplementation(async () => {
      observed = (await db.workouts.get(workout.id)).finished && (await db.periods.get(period.id)).trainingSchedule.mode === 'independent';
      throw new Error('injected authoritative mode period failure');
    });
    try { await expect(state().finishWorkout(workout.id)).rejects.toThrow('injected authoritative mode period failure'); }
    finally { spy.mockRestore(); }
    expect(observed).toBe(true);
    expect(Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))).toEqual(beforeTables);
    expect(structuredClone({ period: state().period, allPeriods: state().allPeriods, workouts: state().workouts, activeVariant: state().activeVariant })).toEqual(beforeState);
    await state().finishWorkout(workout.id);
    expect(state().period).toMatchObject({ rotationPos: 1, cycle: 1, trainingSchedule: { mode: 'independent' } });
    const completedPeriod = state().period;
    await state().finishWorkout(workout.id);
    expect(state().period).toEqual(completedPeriod);
  });

  it('uses persisted weekly or legacy mode rather than stale cached independent policy', async () => {
    const weekly = await configure();
    const weeklyWorkout = await state().createWorkout(undefined, '2026-06-08');
    useStore.setState({ period: { ...weekly, trainingSchedule: { mode: 'independent', rotation: ['U1', 'L1'] } } });
    await state().finishWorkout(weeklyWorkout.id);
    expect((await db.periods.get(weekly.id)).trainingSchedule.mode).toBe('weekly');
    expect(state().period.rotationPos).toBe(0);

    const current = state().period;
    const legacy = { ...current }; delete legacy.trainingSchedule;
    await db.periods.put(legacy);
    const legacyWorkout = { periodId: legacy.id, date: '2026-06-09', variant: 'U1', cycle: 1, finished: false, entries: [] };
    legacyWorkout.id = await db.workouts.add(legacyWorkout);
    useStore.setState({ period: { ...legacy, trainingSchedule: { mode: 'independent', rotation: ['L1', 'U1'] } }, workouts: [...state().workouts, legacyWorkout] });
    await state().finishWorkout(legacyWorkout.id);
    expect((await db.periods.get(legacy.id)).trainingSchedule).toBeUndefined();
    expect(state().period).toMatchObject({ rotationPos: 1, cycle: 1 });
  });

  it('rolls back configured completion when post-write transaction hydration fails', async () => {
    const period = await configure({ mode: 'independent', rotation: ['L1', 'U1'] });
    const workout = await state().createWorkout(undefined, '2026-06-08');
    const beforeTables = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
    const beforeState = structuredClone({ period: state().period, allPeriods: state().allPeriods, workouts: state().workouts, activeVariant: state().activeVariant });
    const original = db.periods.toArray.bind(db.periods);
    let reads = 0, observed = false;
    const spy = vi.spyOn(db.periods, 'toArray').mockImplementation(async (...args) => {
      const rows = await original(...args);
      if (++reads > 1) {
        observed = (await db.workouts.get(workout.id)).finished && (await db.periods.get(period.id)).rotationPos === 1;
        throw new Error('injected hydration failure');
      }
      return rows;
    });
    try { await expect(state().finishWorkout(workout.id)).rejects.toThrow('injected hydration failure'); }
    finally { spy.mockRestore(); }
    expect(observed).toBe(true);
    expect(Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))).toEqual(beforeTables);
    expect(structuredClone({ period: state().period, allPeriods: state().allPeriods, workouts: state().workouts, activeVariant: state().activeVariant })).toEqual(beforeState);
  });

  it('applies variant unit override to a new workout snapshot without changing catalog', async () => {
    await configure();
    const variant = { ...state().variants.find(v => v.code === 'U1'), exerciseUnits: { 'incline-press': 'lb' } };
    await db.routineVariants.put(variant);
    useStore.setState({ variants: state().variants.map(v => v.code === 'U1' ? variant : v), allVariants: state().allVariants.map(v => v.code === 'U1' ? variant : v) });
    expect(state().variantMap().U1.exerciseUnits['incline-press']).toBe('lb');
    const catalogUnit = (await db.exercises.get('incline-press')).unit;
    const workout = await state().createWorkout(undefined, '2026-06-08');
    expect(workout.entries.find(e => e.exerciseId === 'incline-press').unit).toBe('lb');
    expect((await db.exercises.get('incline-press')).unit).toBe(catalogUnit);
  });
});
