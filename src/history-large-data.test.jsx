// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { fmtDate } from './calc.js';
import { buildLogs, entryForWorkout, historySlots, lastSetsBeforeByExercise } from './metrics.js';
import HistoryScreen from './screens/History.jsx';
import { useStore } from './store.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const profile = { name: 'History fixture user', sex: 'prefer_not_to_say', age: 34, heightCm: 172, bodyweightKg: 68 };
let root, host;
const dateAt = (year, day) => new Date(Date.UTC(year, 0, day)).toISOString().slice(0, 10);
async function mountHistory() {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<HistoryScreen />));
}
async function clickLabel(label) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
  if (!button) throw new Error(`Missing History button: ${label}`);
  await act(async () => button.click());
}
async function selectPeriod(period) {
  await clickLabel(fmtDate(period.startDate));
}
async function fixture() {
  await useStore.getState().saveSetupProfile(profile);
  const initialDraft = { schemaVersion: 1, variants: useStore.getState().variants.map((variant, order) => ({
    code: `T${order + 1}`, order, name: `Fixture routine ${order + 1}`, kind: variant.kind,
    exercises: [{ ref: { type: 'catalog', id: variant.exerciseIds[0] }, name: useStore.getState().exercises.find((item) => item.id === variant.exerciseIds[0]).name,
      muscle: useStore.getState().exercises.find((item) => item.id === variant.exerciseIds[0]).muscle, unit: 'kg', order: 0 }],
  })) };
  const schedule = { mode: 'independent', rotation: initialDraft.variants.map((variant) => variant.code) };
  const applied = await useStore.getState().applyReviewedRoutine(initialDraft, schedule, { cycleGoal: 6 });
  expect(applied.status).toBe('applied');
  const periods = [applied.period];
  periods.push((await useStore.getState().startNewMesocycle(6)).period);
  periods.push((await useStore.getState().startNewMesocycle(6)).period);
  const updatedPeriods = [
    { ...periods[0], status: 'archived', startDate: '2023-01-01', endDate: '2023-10-01' },
    { ...periods[1], status: 'archived', startDate: '2024-01-01', endDate: '2024-10-01' },
    { ...periods[2], status: 'active', startDate: '2025-01-01', cycle: 49 },
  ];
  await db.periods.bulkPut(updatedPeriods);
  const codes = useStore.getState().variants.map((variant) => variant.code);
  const exerciseMap = Object.fromEntries(useStore.getState().exercises.map((exercise) => [exercise.id, exercise]));
  const workouts = [], sets = [], tie = {};
  let serial = 0;
  for (let periodIndex = 0; periodIndex < updatedPeriods.length; periodIndex++) {
    const period = updatedPeriods[periodIndex];
    const year = 2023 + periodIndex;
    const baseCount = periodIndex === 2 ? 284 : 288;
    const addSession = (slot, cycle, variantIndex, day) => {
      const variant = useStore.getState().variants.find((item) => item.code === codes[variantIndex]);
      const tied = periodIndex === 2 && [30, 31, 32].includes(slot);
      const exerciseId = tied ? 'bench' : variant.exerciseIds[0];
      const exercise = exerciseMap[exerciseId];
      const id = 10000 + serial;
      const date = tied ? '2025-02-14' : dateAt(year, day);
      const workout = { id, periodId: period.id, date, cycle, variant: variant.code, block: `Fixture P${period.id} W${id}`,
        finished: true, entries: [{ exerciseId, name: exercise.name, muscle: exercise.muscle, unit: 'kg', fixtureSlot: slot }] };
      workouts.push(workout);
      const rows = [1, 2].map((n) => ({ id: 50000 + serial * 2 + n, workoutId: id, exerciseId, n, reps: 8 + n, value: 35 + variantIndex, unit: 'kg', realKg: 35 + variantIndex }));
      sets.push(...rows);
      if (tied) tie[['prior', 'target', 'future'][slot - 30]] = { workout, sets: rows };
      serial++;
    };
    for (let slot = 0; slot < baseCount; slot++) addSession(slot, Math.floor(slot / 6) + 1, slot % 6, slot + 1);
    const extraCount = 300 - baseCount;
    for (let extra = 0; extra < extraCount; extra++) addSession(baseCount + extra, periodIndex === 2 ? 48 : 1, 0, baseCount + extra + 1);
  }
  await db.workouts.bulkAdd(workouts);
  await db.sets.bulkAdd(sets);
  useStore.setState({ loaded: false });
  await useStore.getState().init();
  return { periods: updatedPeriods, workouts, sets, tie, codes };
}
const rowsById = async (table) => (await table.toArray()).sort((a, b) => a.id - b.id);
const snapshotAll = async () => Object.fromEntries(await Promise.all(db.tables.map(async (table) => [table.name, await rowsById(table)])));
const slotCards = () => [...host.querySelectorAll('button.gt-card')];
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, period: null, allPeriods: [], exercises: [], variants: [], allVariants: [], workouts: [], setsByWorkout: {}, bodyweight: [], prs: {}, setupStatus: null });
  await useStore.getState().init();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
});

describe('large-history integrity', () => {
  it('reloads 900 real indexed sessions and lets mounted History switch archive periods without writes', async () => {
    const data = await fixture();
    expect(data.workouts).toHaveLength(900);
    expect(data.sets).toHaveLength(1800);
    const before = await snapshotAll();
    const cache = useStore.getState();
    expect(cache.workouts).toHaveLength(900);
    expect(cache.workouts.slice().sort((a, b) => a.id - b.id)).toEqual(data.workouts.slice().sort((a, b) => a.id - b.id));
    expect(Object.keys(cache.setsByWorkout)).toHaveLength(900);
    expect(Object.values(cache.setsByWorkout).flat().sort((a, b) => a.id - b.id)).toEqual(data.sets.slice().sort((a, b) => a.id - b.id));
    expect(cache.allPeriods.map((period) => period.id)).toEqual(data.periods.map((period) => period.id));
    expect(await snapshotAll()).toEqual(before);
    await mountHistory();
    expect(host.textContent).toContain(`Current mesocycle · started ${fmtDate(data.periods[2].startDate)}`);
    expect(slotCards()).toHaveLength(22);
    await selectPeriod(data.periods[0]);
    expect(host.textContent).toContain(`Archived · ${fmtDate(data.periods[0].startDate)}`);
    expect(slotCards()).toHaveLength(18);
    expect(slotCards().every((card) => card.textContent.includes(`Fixture P${data.periods[0].id}`))).toBe(true);
    expect(host.textContent).not.toContain(`Fixture P${data.periods[1].id}`);
    await selectPeriod(data.periods[1]);
    expect(host.textContent).toContain(`Archived · ${fmtDate(data.periods[1].startDate)}`);
    expect(slotCards()).toHaveLength(18);
    expect(slotCards().every((card) => card.textContent.includes(`Fixture P${data.periods[1].id}`))).toBe(true);
    expect(await snapshotAll()).toEqual(before);
    expect(useStore.getState().workouts).toBe(cache.workouts);
    expect(useStore.getState().setsByWorkout).toBe(cache.setsByWorkout);
    expect(useStore.getState().allPeriods).toBe(cache.allPeriods);
    expect(useStore.getState().period).toBe(cache.period);
  });

  it('keeps same-cycle repeated variants addressable by stable workout-backed slots after reload', async () => {
    const data = await fixture();
    let state = useStore.getState();
    const getLogs = () => buildLogs(state.workouts, state.setsByWorkout, data.periods[2].id, Object.fromEntries(state.exercises.map((item) => [item.id, item])));
    const expectedIds = data.workouts.filter((workout) => workout.periodId === data.periods[2].id && workout.cycle === 48).map((workout) => workout.id).sort((a, b) => a - b);
    expect(expectedIds).toHaveLength(18);
    let logs = getLogs();
    expect(Object.keys(logs[48])).toHaveLength(18);
    expect(historySlots(logs[48], state.variants, true)).toHaveLength(22);
    for (const id of expectedIds) {
      const entry = entryForWorkout(logs, 48, id);
      expect(entry?.workoutId).toBe(id);
      expect(entry.exercises.reduce((total, exercise) => total + exercise.sets.length, 0)).toBe(2);
    }
    const beforeWorkouts = await rowsById(db.workouts), beforeSets = await rowsById(db.sets);
    useStore.setState({ loaded: false }); await useStore.getState().init();
    state = useStore.getState();
    logs = getLogs();
    expect(expectedIds.map((id) => entryForWorkout(logs, 48, id)?.workoutId)).toEqual(expectedIds);
    expect(await rowsById(db.workouts)).toEqual(beforeWorkouts);
    expect(await rowsById(db.sets)).toEqual(beforeSets);
  });

  it('resolves same-day prior lookup by workout ID and excludes the target and later record', async () => {
    const data = await fixture();
    const state = useStore.getState();
    const { prior, target, future } = data.tie;
    expect(prior.workout.date).toBe(target.workout.date);
    expect(target.workout.date).toBe(future.workout.date);
    expect(prior.workout.id).toBeLessThan(target.workout.id);
    expect(future.workout.id).toBeGreaterThan(target.workout.id);
    const index = lastSetsBeforeByExercise(state.workouts, state.setsByWorkout, target.workout);
    expect(index.bench).toEqual({ date: prior.workout.date, workoutId: prior.workout.id, sets: prior.sets });
    expect(index.bench.workoutId).not.toBe(target.workout.id);
    expect(index.bench.workoutId).not.toBe(future.workout.id);
    useStore.setState({ loaded: false }); await useStore.getState().init();
    const reloadedIndex = lastSetsBeforeByExercise(useStore.getState().workouts, useStore.getState().setsByWorkout, target.workout);
    expect(reloadedIndex.bench).toEqual(index.bench);
  });

  it('shows active planned empty slots plus repeats and archived periods as actual slots only', async () => {
    const data = await fixture();
    const state = useStore.getState();
    const exMap = Object.fromEntries(state.exercises.map((item) => [item.id, item]));
    const activeLogs = buildLogs(state.workouts, state.setsByWorkout, data.periods[2].id, exMap);
    const activeSlots = historySlots(activeLogs[48], state.variants, true);
    expect(activeSlots).toHaveLength(22);
    expect(new Set(activeSlots.map((slot) => slot.key)).size).toBe(22);
    expect(activeSlots.filter((slot) => !activeLogs[48][slot.key]).map((slot) => slot.code)).toEqual(state.variants.slice(2).map((variant) => variant.code));
    const archivedLogs = buildLogs(state.workouts, state.setsByWorkout, data.periods[0].id, exMap);
    const archivedSlots = historySlots(archivedLogs[1], state.variants, false);
    expect(archivedSlots).toHaveLength(18);
    expect(archivedSlots.every((slot) => archivedLogs[1][slot.key])).toBe(true);
    expect(Object.values(archivedLogs).flatMap((cycle) => Object.values(cycle)).every((entry) =>
      data.workouts.find((workout) => workout.id === entry.workoutId)?.periodId === data.periods[0].id)).toBe(true);
  });
});
