import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded } from './db.js';
import { isoDate } from './calc.js';
import { useStore } from './store.js';

beforeEach(async () => {
  globalThis.window = {};
  await db.delete(); await db.open();
  useStore.setState({ loaded: false, profile: null, bodyweight: [], prs: {}, workouts: [], setsByWorkout: {}, allPeriods: [], exercises: [], variants: [] });
});

describe('setup store persistence', () => {
  it('hydrates seeded tables and archived periods into store keys', async () => {
    await ensureSeeded();
    await useStore.getState().init();
    expect(useStore.getState().setupStatus).toBe('first-run-required');

    const archived = { ...(await db.periods.toArray())[0], status: 'archived' };
    await db.periods.put(archived);
    useStore.setState({ loaded: false }); await useStore.getState().init();
    expect(useStore.getState().allPeriods).toContainEqual(archived);
    expect(useStore.getState().variants.length).toBeGreaterThan(0);
    expect(useStore.getState().setupStatus).toBe('invite-existing');
  });
  it('validates before writes, persists profile without completion, and reopens across init', async () => {
    await useStore.getState().init();
    await expect(useStore.getState().saveSetupProfile({ name: '', age: 4 })).rejects.toThrow();
    expect(await db.bodyweightLog.count()).toBe(0);
    await useStore.getState().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 60 });
    expect(useStore.getState().profile.name).toBe('Ada');
    expect(useStore.getState().profile.setupComplete).toBeUndefined();
    expect(useStore.getState().profile.setupRequired).toBe(true);
    await useStore.getState().reopenSetup();
    expect(useStore.getState().setupStatus).toBe('first-run-required');
    useStore.setState({ loaded: false }); await useStore.getState().init();
    expect(useStore.getState().profile.name).toBe('Ada');
    expect(useStore.getState().profile.setupComplete).toBeUndefined();
    expect(useStore.getState().setupStatus).toBe('first-run-required');
  });
  it('skips existing users and reopening clears only skip metadata', async () => {
    await ensureSeeded();
    await db.workouts.add({ date: '2025-01-01', periodId: 1, entries: [] });
    await useStore.getState().init();
    await useStore.getState().skipSetup();
    expect(useStore.getState().setupStatus).toBe('skipped');
    await useStore.getState().reopenSetup();
    expect(useStore.getState().setupStatus).toBe('invite-existing');
    expect((await db.profile.get(1)).setupComplete).toBeUndefined();
  });
  it('lets a seed-only first-run user skip explicitly, persists across init, and reopen offers an invitation', async () => {
    await ensureSeeded();
    await useStore.getState().init();
    expect(useStore.getState().setupStatus).toBe('first-run-required');
    await expect(useStore.getState().skipSetup()).resolves.toBe('skipped');
    expect(useStore.getState().setupStatus).toBe('skipped');
    expect(await db.profile.get(1)).toMatchObject({ setupSkipped: true, setupRequired: false });
    useStore.setState({ loaded: false }); await useStore.getState().init();
    expect(useStore.getState().setupStatus).toBe('skipped');
    await useStore.getState().reopenSetup();
    expect(useStore.getState().setupStatus).toBe('invite-existing');
    useStore.setState({ loaded: false }); await useStore.getState().init();
    expect(useStore.getState().setupStatus).toBe('invite-existing');
  });
  it('skip overrides a pending required marker from a saved profile and leaves training tables untouched', async () => {
    await ensureSeeded();
    await useStore.getState().init();
    await useStore.getState().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 60 });
    expect((await db.profile.get(1)).setupRequired).toBe(true);
    const before = { periods: await db.periods.toArray(), variants: await db.routineVariants.toArray(), workouts: await db.workouts.toArray() };
    await useStore.getState().skipSetup();
    expect(await db.profile.get(1)).toMatchObject({ name: 'Ada', setupSkipped: true, setupRequired: false });
    expect({ periods: await db.periods.toArray(), variants: await db.routineVariants.toArray(), workouts: await db.workouts.toArray() }).toEqual(before);
    useStore.setState({ loaded: false }); await useStore.getState().init();
    expect(useStore.getState().setupStatus).toBe('skipped');
  });
  it('does not re-impose the required gate when a skipped seed-only user saves only the profile in a reopened wizard', async () => {
    await ensureSeeded();
    await useStore.getState().init();
    await useStore.getState().skipSetup();
    await useStore.getState().reopenSetup();
    await useStore.getState().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 60 });
    expect((await db.profile.get(1)).setupRequired).not.toBe(true);
    useStore.setState({ loaded: false }); await useStore.getState().init();
    expect(useStore.getState().setupStatus).toBe('invite-existing');
  });
  it('keeps a skipped seed-only user out of the required gate when the profile is saved without reopening', async () => {
    await ensureSeeded();
    await useStore.getState().init();
    await useStore.getState().skipSetup();
    await useStore.getState().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 60 });
    useStore.setState({ loaded: false }); await useStore.getState().init();
    expect(useStore.getState().setupStatus).not.toBe('first-run-required');
  });
  it('does not change the status when the skip write fails', async () => {
    await ensureSeeded();
    await useStore.getState().init();
    const originalPut = db.profile.put.bind(db.profile);
    db.profile.put = async () => { throw new Error('injected'); };
    try { await expect(useStore.getState().skipSetup()).rejects.toThrow('injected'); } finally { db.profile.put = originalPut; }
    expect(useStore.getState().setupStatus).toBe('first-run-required');
    expect((await db.profile.get(1)).setupSkipped).toBeUndefined();
  });
  it('commits generated same-day log IDs and hydrates preserved plus recomputed PR rows', async () => {
    await useStore.getState().init();
    const workout = await db.workouts.add({ date: '2024-01-01' });
    await db.sets.add({ workoutId: workout, exerciseId: 'bench', realKg: 80, value: 80, unit: 'kg', reps: 5 });
    useStore.setState({ workouts: [{ id: workout, date: '2024-01-01' }], profile: { id: 1, bodyweightKg: 70, preferences: { theme: 'dark' } }, setupStatus: 'invite-existing' });
    const historic = { exerciseId: 'orphan', kg: 40, baselineKg: 30, oneRm: 50, date: '2020-01-01' };
    await db.personalRecords.put(historic);
    await useStore.getState().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 60 });
    const logs = await db.bodyweightLog.toArray();
    const rows = await db.personalRecords.toArray();
    expect(useStore.getState().bodyweight).toEqual(logs);
    expect(useStore.getState().bodyweight[0].id).toBeDefined();
    expect(useStore.getState().prs).toEqual(Object.fromEntries(rows.map((row) => [row.exerciseId, row])));
    expect(useStore.getState().prs.orphan).toEqual(historic);
    expect(useStore.getState().profile.preferences).toEqual({ theme: 'dark' });
    expect(useStore.getState().setupStatus).toBe('invite-existing');
    useStore.setState({ loaded: false }); await useStore.getState().init();
    expect(useStore.getState().prs.orphan).toEqual(historic);
  });
  it('preserves existing same-day bodyweight ID and derives basic and accessory medal inputs', async () => {
    await useStore.getState().init();
    const logId = await db.bodyweightLog.add({ date: isoDate(), kg: 70 });
    const w = await db.workouts.add({ date: '2024-01-01' });
    await db.sets.bulkAdd([
      { workoutId: w, exerciseId: 'bench', realKg: 100, value: 100, unit: 'kg', reps: 5 },
      { workoutId: w, exerciseId: 'curl', realKg: 50, value: 50, unit: 'kg', reps: 5 },
    ]);
    useStore.setState({ workouts: [{ id: w, date: '2024-01-01' }], profile: { id: 1, bodyweightKg: 70 } });
    await db.personalRecords.put({ exerciseId: 'curl', kg: 50, baselineKg: 40, oneRm: 58.3 });
    await useStore.getState().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 60 });
    expect(useStore.getState().bodyweight[0].id).toBe(logId);
    expect(useStore.getState().prs.bench.oneRm).toBeGreaterThan(100);
    expect(useStore.getState().prs.curl.baselineKg).toBe(50);
  });
  it('rolls back writes when post-write hydration fails', async () => {
    await useStore.getState().init();
    const w = await db.workouts.add({ date: '2024-01-01' });
    await db.sets.add({ workoutId: w, exerciseId: 'bench', realKg: 80, value: 80, unit: 'kg', reps: 5 });
    useStore.setState({ workouts: [{ id: w, date: '2024-01-01' }], profile: { id: 1, bodyweightKg: 70, name: 'Before' } });
    const profileBefore = await db.profile.get(1);
    const logsBefore = await db.bodyweightLog.toArray();
    const prsBefore = await db.personalRecords.toArray();
    const stateBefore = useStore.getState();
    const orderBy = db.bodyweightLog.orderBy.bind(db.bodyweightLog);
    let sawWrites = false;
    db.bodyweightLog.orderBy = (...args) => {
      const query = orderBy(...args);
      return { ...query, toArray: async () => {
        sawWrites = (await db.profile.get(1)).name === 'Ada' && (await db.bodyweightLog.count()) === logsBefore.length + 1;
        throw new Error('hydration read failure');
      } };
    };
    try {
      await expect(useStore.getState().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 60 })).rejects.toThrow('hydration read failure');
    } finally { db.bodyweightLog.orderBy = orderBy; }
    expect(sawWrites).toBe(true);
    expect(await db.profile.get(1)).toEqual(profileBefore);
    expect((await db.profile.get(1)).setupRequired).not.toBe(true);
    expect(await db.bodyweightLog.toArray()).toEqual(logsBefore);
    expect(await db.personalRecords.toArray()).toEqual(prsBefore);
    expect(useStore.getState().profile).toEqual(stateBefore.profile);
    expect(useStore.getState().bodyweight).toEqual(stateBefore.bodyweight);
    expect(useStore.getState().prs).toEqual(stateBefore.prs);
  });

  it('aborts real transaction after earlier writes without publishing partial state', async () => {
    await useStore.getState().init();
    const w = await db.workouts.add({ date: '2024-01-01' });
    await db.sets.add({ workoutId: w, exerciseId: 'bench', realKg: 80, value: 80, unit: 'kg', reps: 5 });
    useStore.setState({ workouts: [{ id: w, date: '2024-01-01' }], profile: { id: 1, bodyweightKg: 70, name: 'Before' }, setupStatus: 'invite-existing' });
    const stateBefore = useStore.getState();
    const profileBefore = await db.profile.get(1);
    const logsBefore = await db.bodyweightLog.toArray();
    const prsBefore = await db.personalRecords.toArray();
    const bulkPut = db.personalRecords.bulkPut.bind(db.personalRecords);
    let sawPartial = false;
    db.personalRecords.bulkPut = async (...args) => {
      sawPartial = (await db.profile.get(1)).name === 'Ada' && (await db.bodyweightLog.count()) === 1;
      throw new Error('later write failure');
    };
    try {
      await expect(useStore.getState().saveSetupProfile({ name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 60 })).rejects.toThrow('later write failure');
    } finally { db.personalRecords.bulkPut = bulkPut; }
    expect(sawPartial).toBe(true);
    expect(await db.profile.get(1)).toEqual(profileBefore);
    expect((await db.profile.get(1)).setupRequired).not.toBe(true);
    expect(await db.bodyweightLog.toArray()).toEqual(logsBefore);
    expect(await db.personalRecords.toArray()).toEqual(prsBefore);
    expect(useStore.getState().profile).toEqual(stateBefore.profile);
    expect(useStore.getState().bodyweight).toEqual(stateBefore.bodyweight);
    expect(useStore.getState().prs).toEqual(stateBefore.prs);
    expect(useStore.getState().setupStatus).toEqual(stateBefore.setupStatus);
  });
});
