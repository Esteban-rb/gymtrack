// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db.js';
import { useStore } from './store.js';

const store = () => useStore.getState();

describe('atomic mesocycle restart', () => {
  beforeAll(async () => { await store().init(); });
  beforeEach(async () => {
    const rows = await db.workouts.toArray();
    for (const row of rows.filter((item) => !item.finished)) await db.workouts.update(row.id, { finished: true });
    useStore.setState({ workouts: (await db.workouts.toArray()) });
  });

  it.each([4, 5, 6, 7, 8])('starts a fresh cycle-one period with goal %i', async (cycleGoal) => {
    const old = store().period;
    const result = await store().startNewMesocycle(cycleGoal);
    expect(result.period).toMatchObject({ status: 'active', cycle: 1, rotationPos: 0, cycleGoal });
    expect(result.period.id).not.toBe(old.id);
    expect(store().period).toEqual(result.period);
    expect((await db.periods.get(old.id)).status).toBe('archived');
  });

  it.each([0, 3, 9, 4.5, '6', null, undefined])('rejects invalid goal %s without writes', async (goal) => {
    const periods = await db.periods.toArray();
    await expect(store().startNewMesocycle(goal)).rejects.toThrow();
    expect(await db.periods.toArray()).toEqual(periods);
  });

  it('refuses multiple unfinished active workouts without writes', async () => {
    const a = await store().createWorkout('U1');
    const b = await store().createWorkout('L1');
    const before = await db.periods.toArray();
    await expect(store().startNewMesocycle(6)).rejects.toThrow(/multiple unfinished/i);
    expect(await db.periods.toArray()).toEqual(before);
    expect((await db.workouts.get(a.id)).finished).toBe(false);
    expect((await db.workouts.get(b.id)).finished).toBe(false);
    await db.workouts.update(a.id, { finished: true });
    await db.workouts.update(b.id, { finished: true });
    useStore.setState({ workouts: store().workouts.map((item) => item.id === a.id || item.id === b.id ? { ...item, finished: true } : item) });
  });

  const tableSnapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])));
  const affectedState = () => {
    const { period, allPeriods, workouts, variants } = store();
    return structuredClone({ period, allPeriods, workouts, variants });
  };

  it('rolls back archive and closure if creating the new period fails', async () => {
    const w = await store().createWorkout('U1');
    const beforeTables = await tableSnapshot();
    const beforeState = affectedState();
    let observedPartialWrites = false;
    const add = vi.spyOn(db.periods, 'add').mockImplementationOnce(async () => {
      const archived = await db.periods.get(beforeState.period.id);
      const closed = await db.workouts.get(w.id);
      observedPartialWrites = archived.status === 'archived' && closed.finished && closed.closeReason === 'mesocycle-restart';
      throw new Error('injected add failure');
    });
    try {
      await expect(store().startNewMesocycle(7)).rejects.toThrow('injected add failure');
    } finally {
      add.mockRestore();
    }
    expect(observedPartialWrites).toBe(true);
    expect(await tableSnapshot()).toEqual(beforeTables);
    expect(affectedState()).toEqual(beforeState);
  });

  it('rolls back archive and closure if authoritative period readback fails', async () => {
    const w = await store().createWorkout('U1');
    const beforeTables = await tableSnapshot();
    const beforeState = affectedState();
    let periodReads = 0;
    let observedPartialWrites = false;
    const originalToArray = db.periods.toArray.bind(db.periods);
    const toArray = vi.spyOn(db.periods, 'toArray').mockImplementation(async function (...args) {
      const rows = await originalToArray(...args);
      periodReads++;
      if (periodReads > 1) {
        const fresh = rows.find((p) => p.status === 'active' && p.id !== beforeState.period.id);
        const archived = await db.periods.get(beforeState.period.id);
        const closed = await db.workouts.get(w.id);
        observedPartialWrites = !!fresh && archived.status === 'archived' && closed.finished && closed.closeReason === 'mesocycle-restart';
        throw new Error('injected period readback failure');
      }
      return rows;
    });
    try {
      await expect(store().startNewMesocycle(7)).rejects.toThrow('injected period readback failure');
    } finally {
      toArray.mockRestore();
    }
    expect(observedPartialWrites).toBe(true);
    expect(await tableSnapshot()).toEqual(beforeTables);
    expect(affectedState()).toEqual(beforeState);
  });

  it('refuses zero database-active periods without writes', async () => {
    const beforeTables = await tableSnapshot();
    const beforeState = affectedState();
    await db.periods.update(beforeState.period.id, { status: 'archived' });
    const alteredTables = await tableSnapshot();
    try {
      await expect(store().startNewMesocycle(6)).rejects.toThrow(/conflicts/i);
      expect(await tableSnapshot()).toEqual(alteredTables);
      expect(affectedState()).toEqual(beforeState);
    } finally {
      await db.periods.bulkPut(beforeTables.periods);
    }
  });

  it('refuses two database-active periods without writes', async () => {
    const beforeTables = await tableSnapshot();
    const beforeState = affectedState();
    const duplicateId = await db.periods.add({ ...beforeState.period, id: undefined });
    const alteredTables = await tableSnapshot();
    try {
      await expect(store().startNewMesocycle(6)).rejects.toThrow(/conflicts/i);
      expect(await tableSnapshot()).toEqual(alteredTables);
      expect(affectedState()).toEqual(beforeState);
    } finally {
      await db.periods.bulkPut(beforeTables.periods);
      await db.periods.delete(duplicateId);
    }
  });

  it('rejects stale caller period state before writes', async () => {
    const active = store().period;
    useStore.setState({ period: { ...active, cycle: (active.cycle || 1) + 1 } });
    const before = await db.periods.toArray();
    await expect(store().startNewMesocycle(5)).rejects.toThrow(/conflicts/i);
    expect(await db.periods.toArray()).toEqual(before);
    useStore.setState({ period: active });
  });

  it('does not advance the fresh period when an old workout is finished later', async () => {
    const old = store().period;
    const w = await store().createWorkout('U1');
    await store().startNewMesocycle(4);
    await store().finishWorkout(w.id);
    expect(store().period).toMatchObject({ cycle: 1, rotationPos: 0 });
    expect(store().workouts.find((item) => item.id === w.id).periodId).toBe(old.id);
  });

  it('closes an unfinished current workout as a preserved partial history record', async () => {
    const w = await store().createWorkout('U1');
    await store().logSet(w.id, w.entries[0].exerciseId, { value: 25, reps: 8, unit: 'kg' });
    const priorSets = await db.sets.where('workoutId').equals(w.id).toArray();
    const result = await store().startNewMesocycle(5);
    expect(result.workout).toMatchObject({ id: w.id, periodId: w.periodId, finished: true, closeReason: 'mesocycle-restart' });
    expect(result.workout.entries).toEqual(w.entries);
    expect(await db.sets.where('workoutId').equals(w.id).toArray()).toEqual(priorSets);
    expect(store().period.cycle).toBe(1);
  });

  it('carries configured routine references across restart without rewriting variant history', async () => {
    const oldPeriod = store().period;
    const ownedVariant = { code: 'owned-history@old-period', order: 0, name: 'Owned old plan', kind: 'Custom', exerciseIds: ['bench'], ownerPeriodId: oldPeriod.id };
    await db.routineVariants.put(ownedVariant);
    const configured = { ...oldPeriod, routineVariantCodes: [ownedVariant.code], trainingSchedule: { mode: 'independent', rotation: [ownedVariant.code] }, routineRevision: 2 };
    await db.periods.put(configured);
    useStore.setState({ period: configured, allPeriods: store().allPeriods.map(p => p.id === configured.id ? configured : p) });
    const variantBefore = await db.routineVariants.toArray();
    const result = await store().startNewMesocycle(5);
    expect(result.period).toMatchObject({ routineVariantCodes: [ownedVariant.code], trainingSchedule: configured.trainingSchedule, routineRevision: 2 });
    expect(await db.routineVariants.toArray()).toEqual(variantBefore);
    useStore.setState({ loaded: false }); await store().init();
    expect(store().variants.map(v => v.code)).toEqual([ownedVariant.code]);
    expect(store().variants[0].ownerPeriodId).toBe(oldPeriod.id);
  });
});
