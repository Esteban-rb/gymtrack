// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';

const state = () => useStore.getState();
const profileDraft = { name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 70 };
const draft = (code = 'U1') => ({ schemaVersion: 1, variants: [{ code, order: 0, name: 'Bench routine', kind: 'Upper', exercises: [{ ref: { type: 'catalog', id: 'bench' }, name: 'Bench Press', muscle: 'Chest', unit: 'lb', order: 0 }] }] });
const schedule = (code = 'U1') => ({ mode: 'independent', rotation: [code] });
const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));

beforeEach(async () => {
  globalThis.window = {};
  await db.delete(); await db.open();
  useStore.setState({ loaded: false, profile: null, period: null, allPeriods: [], exercises: [], variants: [], allVariants: [], workouts: [], setsByWorkout: {}, bodyweight: [], prs: {}, activeVariant: null });
  await ensureSeeded(); await state().init();
});

describe('applyReviewedRoutine empty period', () => {
  async function establishFirstRunObligation() {
    await db.profile.update(1, { ...profileDraft, setupRequired: true, setupComplete: false, setupSkipped: false, preferences: { theme: 'dark', accent: 'blue' } });
    const archivedPeriodId = await db.periods.add({ status: 'archived', startDate: '2024-01-01', cycleGoal: 4 });
    const historyId = await db.workouts.add({ periodId: archivedPeriodId, date: '2024-01-02', finished: true, variant: 'legacy', entries: [{ exerciseId: 'bench' }] });
    await state().init();
    expect(await db.profile.get(1)).toMatchObject({ setupRequired: true, setupComplete: false, preferences: { theme: 'dark', accent: 'blue' } });
    expect(state().profile).toMatchObject({ setupRequired: true, setupComplete: false });
    expect(state().setupStatus).toBe('first-run-required');
    return historyId;
  }

  it('preserves an explicit first-run obligation on cancel and invalid apply without writes', async () => {
    await establishFirstRunObligation();
    const before = await snapshot();
    const stateBefore = { profile: state().profile, setupStatus: state().setupStatus, period: state().period, activeVariant: state().activeVariant, variants: state().variants };
    expect(await state().applyReviewedRoutine(null, null, { resolution: 'cancel' })).toMatchObject({ status: 'cancelled' });
    expect(await snapshot()).toEqual(before);
    expect({ profile: state().profile, setupStatus: state().setupStatus, period: state().period, activeVariant: state().activeVariant, variants: state().variants }).toEqual(stateBefore);
    await expect(state().applyReviewedRoutine({ schemaVersion: 99 }, schedule())).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect({ profile: state().profile, setupStatus: state().setupStatus, period: state().period, activeVariant: state().activeVariant, variants: state().variants }).toEqual(stateBefore);
  });

  it.each(['write', 'hydrate'])('rolls back explicit obligation after observed completion writes on %s failure, then retries', async (failure) => {
    const historyId = await establishFirstRunObligation();
    const before = await snapshot();
    const stateBefore = { profile: state().profile, setupStatus: state().setupStatus, period: state().period, activeVariant: state().activeVariant, variants: state().variants, allVariants: state().allVariants };
    let observedCompletedWrites = false;
    const restore = [];
    try {
      if (failure === 'write') {
        const put = db.profile.put.bind(db.profile);
        db.profile.put = async (...args) => {
          await put(...args);
          const [profile, periods, variants] = await Promise.all([db.profile.get(1), db.periods.toArray(), db.routineVariants.toArray()]);
          observedCompletedWrites = profile.setupRequired === false && profile.setupComplete === true
            && periods.some((period) => period.routineRevision === 1)
            && variants.some((variant) => variant.ownerPeriodId === stateBefore.period.id);
          throw new Error('injected completion write failure');
        };
        restore.push(() => { db.profile.put = put; });
      } else {
        const read = db.periods.toArray.bind(db.periods); let count = 0;
        db.periods.toArray = async (...args) => {
          const rows = await read(...args);
          if (++count === 2) {
            const [profile, variants] = await Promise.all([db.profile.get(1), db.routineVariants.toArray()]);
            observedCompletedWrites = profile.setupRequired === false && profile.setupComplete === true
              && rows.some((period) => period.routineRevision === 1)
              && variants.some((variant) => variant.ownerPeriodId === stateBefore.period.id);
            throw new Error('injected completion hydration failure');
          }
          return rows;
        };
        restore.push(() => { db.periods.toArray = read; });
      }
      await expect(state().applyReviewedRoutine(draft('obligation'), schedule('obligation'))).rejects.toThrow(/injected completion/);
    } finally { restore.reverse().forEach((undo) => undo()); }
    expect(observedCompletedWrites).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(await db.profile.get(1)).toMatchObject({ setupRequired: true, setupComplete: false, preferences: { theme: 'dark', accent: 'blue' } });
    expect(await db.workouts.get(historyId)).toEqual(before.workouts.find((workout) => workout.id === historyId));
    expect({ profile: state().profile, setupStatus: state().setupStatus, period: state().period, activeVariant: state().activeVariant, variants: state().variants, allVariants: state().allVariants }).toEqual(stateBefore);

    const retry = await state().applyReviewedRoutine(draft('obligation'), schedule('obligation'));
    expect(retry.status).toBe('applied');
    expect(await db.profile.get(1)).toMatchObject({ setupRequired: false, setupComplete: true, preferences: { theme: 'dark', accent: 'blue' } });
    expect(state().setupStatus).toBe('complete');
    expect(await db.workouts.get(historyId)).toEqual(before.workouts.find((workout) => workout.id === historyId));
  });

  it('reuses the empty period and completes the already-saved valid profile', async () => {
    await state().saveSetupProfile(profileDraft);
    const prior = state().period;
    const result = await state().applyReviewedRoutine(draft(), schedule(), { cycleGoal: 5 });
    expect(result.period.id).toBe(prior.id);
    expect(result.period).toMatchObject({ startDate: prior.startDate, cycleGoal: 5, cycle: 1, rotationPos: 0, routineRevision: 1 });
    expect(result.period.trainingSchedule.mode).toBe('independent');
    expect((await db.profile.get(1))).toMatchObject({ setupComplete: true, setupRequired: false, setupSkipped: false, name: 'Ada' });
  });

  it('rejects invalid saved profile, draft, schedule, and goal without writes', async () => {
    const valid = await state().saveSetupProfile(profileDraft);
    const before = await snapshot();
    for (const [routine, plan, options] of [
      [draft(), schedule(), { cycleGoal: 3 }],
      [{ ...draft(), schemaVersion: 99 }, schedule(), { cycleGoal: 6 }],
      [draft(), schedule('unknown'), { cycleGoal: 6 }],
    ]) {
      await expect(state().applyReviewedRoutine(routine, plan, options)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    }
    await db.profile.update(1, { name: '' });
    const invalidProfileTables = await snapshot();
    await expect(state().applyReviewedRoutine(draft(), schedule())).rejects.toThrow(/profile/i);
    expect(await snapshot()).toEqual(invalidProfileTables);
    useStore.setState({ profile: valid });
  });

  it('cancels without writes or publishing and refuses unfinished occupancy without explicit restart', async () => {
    const before = await snapshot(), stateBefore = state();
    expect(await state().applyReviewedRoutine(null, null, { resolution: 'cancel' })).toMatchObject({ status: 'cancelled' });
    expect(await snapshot()).toEqual(before); expect(state()).toBe(stateBefore);
    const workoutId = await db.workouts.add({ periodId: state().period.id, finished: false });
    await state().init();
    const occupiedBefore = await snapshot();
    await expect(state().applyReviewedRoutine(draft(), schedule())).rejects.toThrow(/resolution/i);
    expect(await snapshot()).toEqual(occupiedBefore);
    await db.workouts.delete(workoutId);
  });

  it('archives a finished occupied period and applies variants owned by its replacement', async () => {
    await state().saveSetupProfile(profileDraft);
    const oldPeriod = state().period;
    const workout = { periodId: oldPeriod.id, finished: true, variant: 'U1', entries: [{ exerciseId: 'bench' }] };
    workout.id = await db.workouts.add(workout);
    useStore.setState({ workouts: [workout] });
    const result = await state().applyReviewedRoutine(draft('next'), schedule('next'), { cycleGoal: 7 });
    expect(result.period.id).not.toBe(oldPeriod.id);
    expect(result.period).toMatchObject({ status: 'active', cycle: 1, rotationPos: 0, cycleGoal: 7, startDate: expect.any(String) });
    expect((await db.periods.get(oldPeriod.id)).status).toBe('archived');
    expect(await db.workouts.get(workout.id)).toEqual(workout);
    expect(result.variants[0].ownerPeriodId).toBe(result.period.id);
    expect(result.period.routineVariantCodes).toContain(result.variants[0].code);
  });

  it('refuses ambiguous unfinished and stale active-period state without writes', async () => {
    const old = state().period;
    const one = await db.workouts.add({ periodId: old.id, finished: false });
    const two = await db.workouts.add({ periodId: old.id, finished: false });
    await state().init();
    let before = await snapshot();
    await expect(state().applyReviewedRoutine(draft(), schedule())).rejects.toThrow(/multiple unfinished/i);
    expect(await snapshot()).toEqual(before);
    await db.workouts.delete(two); await state().init();
    const callerPeriod = state().period;
    useStore.setState({ period: { ...callerPeriod, cycle: callerPeriod.cycle + 1 } });
    before = await snapshot();
    await expect(state().applyReviewedRoutine(draft(), schedule(), { resolution: 'restart' })).rejects.toThrow(/conflicts/i);
    expect(await snapshot()).toEqual(before);
    useStore.setState({ period: callerPeriod }); await db.workouts.delete(one);
  });

  it('restarts an unfinished partial workout only on explicit restart and preserves its links and sets', async () => {
    await state().saveSetupProfile(profileDraft);
    const oldPeriod = state().period;
    const workout = { periodId: oldPeriod.id, finished: false, variant: 'U1', block: 'Upper', entries: [{ exerciseId: 'bench' }], snapshot: { note: 'keep' } };
    workout.id = await db.workouts.add(workout);
    const setId = await db.sets.add({ workoutId: workout.id, exerciseId: 'bench', n: 1, reps: 8, value: 20, unit: 'kg', realKg: 20 });
    useStore.setState({ workouts: [workout] });
    const result = await state().applyReviewedRoutine(draft('next'), schedule('next'), { resolution: 'restart' });
    expect(await db.workouts.get(workout.id)).toEqual({ ...workout, finished: true, closeReason: 'mesocycle-restart' });
    expect(await db.sets.get(setId)).toBeTruthy();
    expect((await db.workouts.get(workout.id)).periodId).toBe(oldPeriod.id);
    expect(result.period.id).not.toBe(oldPeriod.id);
  });

  it('closes every unfinished workout on explicit restart, preserving sets, ids, snapshots, and period', async () => {
    await state().saveSetupProfile(profileDraft);
    const oldPeriod = state().period;
    const rows = [
      { periodId: oldPeriod.id, date: '2026-01-01', finished: false, variant: 'U1', entries: [{ exerciseId: 'bench' }], snapshot: { n: 1 } },
      { periodId: oldPeriod.id, date: '2026-01-03', finished: false, variant: 'U1', entries: [], snapshot: { n: 2 } },
      { periodId: oldPeriod.id, date: '2026-01-05', finished: false, variant: 'U1', entries: [] },
    ];
    for (const row of rows) row.id = await db.workouts.add(row);
    const done = { periodId: oldPeriod.id, date: '2025-12-30', finished: true, variant: 'U1', entries: [] };
    done.id = await db.workouts.add(done);
    const setIds = [];
    for (const row of rows) setIds.push(await db.sets.add({ workoutId: row.id, exerciseId: 'bench', n: 1, reps: 8, value: 20, unit: 'kg', realKg: 20 }));
    await state().init();
    const setsBefore = await db.sets.toArray();
    await expect(state().applyReviewedRoutine(draft('next'), schedule('next'))).rejects.toThrow(/multiple unfinished/i);
    const result = await state().applyReviewedRoutine(draft('next'), schedule('next'), { resolution: 'restart' });
    for (const row of rows) expect(await db.workouts.get(row.id)).toEqual({ ...row, finished: true, closeReason: 'mesocycle-restart' });
    expect(await db.workouts.get(done.id)).toEqual(done);
    expect(await db.sets.toArray()).toEqual(setsBefore);
    for (const id of setIds) expect(await db.sets.get(id)).toBeTruthy();
    expect((await db.periods.get(oldPeriod.id)).status).toBe('archived');
    expect(result.period.id).not.toBe(oldPeriod.id);
    expect(state().workouts.filter((w) => !w.finished)).toHaveLength(0);
  });

  it('rolls back closing several unfinished workouts when a later write fails', async () => {
    await state().saveSetupProfile(profileDraft);
    const old = state().period;
    for (const date of ['2026-01-01', '2026-01-02']) await db.workouts.add({ periodId: old.id, date, finished: false, variant: 'U1', entries: [] });
    await state().init();
    const before = await snapshot();
    let observed = 0;
    const bulkAdd = db.routineVariants.bulkAdd.bind(db.routineVariants);
    db.routineVariants.bulkAdd = async () => { observed = (await db.workouts.toArray()).filter((w) => w.closeReason === 'mesocycle-restart').length; throw new Error('injected multi close failure'); };
    try {
      await expect(state().applyReviewedRoutine(draft('new'), schedule('new'), { resolution: 'restart' })).rejects.toThrow(/injected multi close/);
    } finally { db.routineVariants.bulkAdd = bulkAdd; }
    expect(observed).toBe(2);
    expect(await snapshot()).toEqual(before);
  });

  it('keeps archived history and catalog standards while minting unique variants and one shared new exercise', async () => {
    await state().saveSetupProfile(profileDraft);
    const oldBench = await db.exercises.get('bench');
    const oldVariant = await db.routineVariants.get('U1');
    await db.periods.add({ status: 'archived', startDate: '2025-01-01', cycleGoal: 4 });
    const archiveId = await db.periods.orderBy('id').last().then(x => x.id);
    const histId = await db.workouts.add({ periodId: archiveId, finished: true, entries: [{ exerciseId: 'bench' }] });
    const multi = { schemaVersion: 1, variants: [
      { code: 'U1', order: 0, name: 'One', kind: 'Upper', exercises: [{ ref: { type: 'new', key: 'rope' }, name: 'Rope Pull', muscle: 'Back', unit: 'kg', order: 0 }] },
      { code: 'U1x', order: 1, name: 'Two', kind: 'Upper', exercises: [{ ref: { type: 'new', key: 'rope' }, name: 'Rope Pull', muscle: 'Back', unit: 'kg', order: 0 }] },
    ] };
    const result = await state().applyReviewedRoutine(multi, { mode: 'independent', rotation: ['U1', 'U1x'] });
    expect(new Set(result.period.routineVariantCodes).size).toBe(2);
    expect(result.period.trainingSchedule.rotation).toEqual(result.period.routineVariantCodes);
    expect(result.allVariants.find(v => v.code === result.period.routineVariantCodes[0]).exerciseIds).toEqual(result.allVariants.find(v => v.code === result.period.routineVariantCodes[1]).exerciseIds);
    expect(result.allVariants.filter(v => v.ownerPeriodId === result.period.id)).toHaveLength(2);
    expect((await db.exercises.get('bench'))).toEqual(oldBench);
    expect(await db.routineVariants.get('U1')).toEqual(oldVariant);
    expect(await db.workouts.get(histId)).toBeTruthy();
    const custom = result.exercises.find(e => e.id === result.allVariants.find(v => v.ownerPeriodId === result.period.id).exerciseIds[0]);
    expect(custom).toMatchObject({ isBasic: false, standards: null });
  });

  it('persists unit overrides and init projects only the configured period variants', async () => {
    await state().saveSetupProfile(profileDraft);
    const result = await state().applyReviewedRoutine(draft('abc'), schedule('abc'));
    const variant = result.variants[0];
    expect(variant.exerciseUnits.bench).toBe('lb');
    expect((await db.exercises.get('bench')).unit).toBe('kg');
    useStore.setState({ loaded: false }); await state().init();
    expect(state().variants.map(v => v.code)).toEqual(result.period.routineVariantCodes);
    expect(state().allVariants.some(v => v.code === 'U1')).toBe(true);
  });

  it.each(['write', 'hydrate'])('rolls back occupied archive/closure after partial %s progress', async (failure) => {
    await state().saveSetupProfile(profileDraft);
    const old = state().period;
    const workout = { periodId: old.id, finished: false, variant: 'U1', entries: [{ exerciseId: 'bench' }], snapshot: { x: 1 } };
    workout.id = await db.workouts.add(workout);
    const setId = await db.sets.add({ workoutId: workout.id, exerciseId: 'bench', n: 1, reps: 6, value: 20, unit: 'kg', realKg: 20 });
    await state().init();
    const before = await snapshot();
    const stateBefore = { profile: state().profile, period: state().period, allPeriods: state().allPeriods, variants: state().variants, allVariants: state().allVariants, workouts: state().workouts, activeVariant: state().activeVariant };
    let observed = false;
    let restore;
    try {
      if (failure === 'write') {
        const bulkAdd = db.routineVariants.bulkAdd.bind(db.routineVariants);
        db.routineVariants.bulkAdd = async (...args) => { const periods = await db.periods.toArray(); const closed = await db.workouts.get(workout.id); observed = periods.some(p => p.id === old.id && p.status === 'archived') && periods.some(p => p.status === 'active' && p.id !== old.id) && closed.finished && closed.closeReason === 'mesocycle-restart'; throw new Error('injected occupied write failure'); };
        restore = () => { db.routineVariants.bulkAdd = bulkAdd; };
      } else {
        const read = db.periods.toArray.bind(db.periods); let count = 0;
        db.periods.toArray = async (...args) => { const rows = await read(...args); if (++count > 1) { const closed = await db.workouts.get(workout.id); observed = rows.some(p => p.id === old.id && p.status === 'archived') && rows.some(p => p.status === 'active' && p.id !== old.id) && closed.finished && (await db.profile.get(1)).setupComplete; throw new Error('injected occupied hydration failure'); } return rows; };
        restore = () => { db.periods.toArray = read; };
      }
      await expect(state().applyReviewedRoutine(draft('new'), schedule('new'), { resolution: 'restart' })).rejects.toThrow(/injected occupied/);
    } finally { restore?.(); }
    expect(observed).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect({ profile: state().profile, period: state().period, allPeriods: state().allPeriods, variants: state().variants, allVariants: state().allVariants, workouts: state().workouts, activeVariant: state().activeVariant }).toEqual(stateBefore);
    expect(await db.sets.get(setId)).toBeTruthy();
  });

  it.each(['write', 'hydrate'])('rolls back after partial %s progress without publishing', async (failure) => {
    await state().saveSetupProfile(profileDraft);
    const before = await snapshot();
    const stateBefore = { profile: state().profile, period: state().period, variants: state().variants, allVariants: state().allVariants, activeVariant: state().activeVariant };
    let observed = false;
    const restore = [];
    try {
      if (failure === 'write') {
        const add = db.routineVariants.bulkAdd.bind(db.routineVariants);
        db.routineVariants.bulkAdd = async (...args) => { observed = (await db.exercises.toArray()).some(e => e.id.includes('unique')) && (await db.periods.get(stateBefore.period.id)).routineRevision == null && (await db.profile.get(1)).setupComplete !== true; throw new Error('injected write failure'); };
        restore.push(() => { db.routineVariants.bulkAdd = add; });
      } else {
        const read = db.periods.toArray.bind(db.periods); let count = 0;
        db.periods.toArray = async (...args) => { const rows = await read(...args); if (++count > 1) { observed = !!(await db.periods.get(stateBefore.period.id)).routineRevision && (await db.profile.get(1)).setupComplete === true; throw new Error('injected hydration failure'); } return rows; };
        restore.push(() => { db.periods.toArray = read; });
      }
      const failDraft = failure === 'write' ? { schemaVersion: 1, variants: [{ code: 'new', order: 0, name: 'New', kind: 'Custom', exercises: [{ ref: { type: 'new', key: 'unique' }, name: 'Unique Move', muscle: 'Back', unit: 'kg', order: 0 }] }] } : draft();
      await expect(state().applyReviewedRoutine(failDraft, schedule(failDraft.variants[0].code))).rejects.toThrow(/injected/);
    } finally { restore.reverse().forEach(fn => fn()); }
    expect(observed).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect({ profile: state().profile, period: state().period, variants: state().variants, allVariants: state().allVariants, activeVariant: state().activeVariant }).toEqual(stateBefore);
  });
});
