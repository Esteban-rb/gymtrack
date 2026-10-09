// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { dayKeyOf, isoDate, mondayOf, parseISO } from './calc.js';
import { useStore } from './store.js';
import HomeScreen from './screens/Home.jsx';
import TodayScreen from './screens/Today.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const state = () => useStore.getState();
let root, host;
beforeEach(async () => {
  await db.delete(); await db.open();
  useStore.setState({ loaded: false, profile: null, period: null, allPeriods: [], exercises: [], variants: [], allVariants: [], workouts: [], setsByWorkout: {}, bodyweight: [], prs: {}, activeVariant: null, scheduleView: null });
  await ensureSeeded(); await state().init();
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
async function render(node) { await act(async () => root.render(node)); }
async function unmount() { if (!root) return; await act(async () => root.unmount()); host.remove(); root = null; host = null; }
async function click(selector) {
  const button = host.querySelector(selector);
  if (!button) throw new Error(`missing button: ${selector}`);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
async function clickText(text) {
  const button = [...host.querySelectorAll('button')].find(item => item.textContent.includes(text));
  if (!button) throw new Error(`missing button text: ${text}`);
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
afterEach(async () => { if (root) await unmount(); });
async function configureWeekly({ restToday = false } = {}) {
  const today = isoDate();
  const start = mondayOf(parseISO(today)); start.setDate(start.getDate() - 7);
  const day = dayKeyOf(parseISO(today));
  const week = Object.fromEntries(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(key => [key, restToday && key === day ? null : 'U1']));
  const period = { ...state().period, startDate: isoDate(start), cycle: 1, rotationPos: 0, routineVariantCodes: ['U1', 'L1'], trainingSchedule: { mode: 'weekly', week } };
  await db.periods.put(period);
  useStore.setState({ period, allPeriods: [period], variants: ['U1', 'L1'].map(code => state().allVariants.find(v => v.code === code)) });
  return { period, today };
}
const tableSnapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
function setLocalDate(iso) {
  const OriginalDate = globalThis.Date;
  const [year, month, day] = iso.split('-').map(Number);
  const timestamp = new OriginalDate(year, month - 1, day, 12).getTime();
  globalThis.Date = class ControlledDate extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  };
  return () => { globalThis.Date = OriginalDate; };
}


describe('configured schedule screen consumers', () => {
  it('shows derived weekly cycle two on Home and Today while persisted counter stays one', async () => {
    await configureWeekly();
    await render(<HomeScreen onNavigate={() => {}} />);
    expect(host.textContent).toContain('Cycle 2');
    await unmount();
    host = document.body.appendChild(document.createElement('div')); root = createRoot(host);
    await render(<TodayScreen />);
    expect(host.textContent).toContain('Cycle 2');
    expect(state().period.cycle).toBe(1);
  });

  it('renders rest without starting a workout', async () => {
    const { today } = await configureWeekly({ restToday: true });
    const before = await tableSnapshot();
    await render(<TodayScreen />);
    expect(host.textContent).toContain('Rest day');
    expect(host.querySelector('button.gt-btn-primary')).toBeNull();
    expect(await db.workouts.count()).toBe(0);
    expect(state().currentVariant(today)).toBeNull();
    expect(await tableSnapshot()).toEqual(before);
  });

  it('keeps a saved partial snapshot visible and resumable over today rest', async () => {
    const { period, today } = await configureWeekly({ restToday: true });
    const profile = await db.profile.get(1); await db.profile.put({ ...profile, autoFinish: false });
    useStore.setState({ profile: { ...profile, autoFinish: false } });
    const oldDate = '2026-05-01';
    const workout = { periodId: period.id, date: oldDate, cycle: 4, variant: 'L1', block: 'Saved lower label', finished: false, entries: [{ exerciseId: 'hack-squat', unit: 'plates' }] };
    workout.id = await db.workouts.add(workout);
    const setId = await db.sets.add({ workoutId: workout.id, exerciseId: 'hack-squat', n: 1, reps: 8, value: 2, unit: 'plates', realKg: 80 });
    useStore.setState({ workouts: [workout], setsByWorkout: { [workout.id]: [{ id: setId, workoutId: workout.id, exerciseId: 'hack-squat', n: 1, reps: 8, value: 2, unit: 'plates', realKg: 80 }] } });
    await render(<TodayScreen />);
    expect(host.textContent).toContain('Cycle 4');
    expect(host.textContent).toContain('Saved lower label');
    expect(host.textContent).toContain('2 plates');
    expect(state().todayWorkout().id).toBe(workout.id);
    expect(state().currentVariant(today)).toBeNull();
    await clickText('Add set'); await clickText('Log set');
    await vi.waitFor(async () => expect(await db.sets.where('workoutId').equals(workout.id).count()).toBe(2));
    await vi.waitFor(async () => expect(await db.personalRecords.get('hack-squat')).toBeTruthy());
    expect(state().workouts.find(item => item.id === workout.id).finished).toBe(false);
    expect(state().workouts.find(item => item.id === workout.id).id).toBe(workout.id);
    expect(await db.sets.get(setId)).toBeTruthy();
  });

  it('renders finished manual history from saved labels, units, and sets without edit controls', async () => {
    const { period } = await configureWeekly();
    const history = { periodId: period.id, date: '2026-05-01', cycle: 3, variant: 'L1', block: 'Historical block label', finished: true, entries: [{ exerciseId: 'hack-squat', name: 'Saved squat label', unit: 'plates' }] };
    history.id = await db.workouts.add(history);
    const set = { workoutId: history.id, exerciseId: 'hack-squat', n: 1, reps: 8, value: 2, unit: 'plates', realKg: 80 };
    set.id = await db.sets.add(set);
    useStore.setState({ workouts: [history], setsByWorkout: { [history.id]: [set] } });
    await state().setActiveCycle(3); await state().setActiveVariant('L1');
    const before = await tableSnapshot();
    await render(<TodayScreen />);
    expect(host.textContent).toContain('Historical block label');
    expect(host.textContent).toContain('Saved squat label');
    expect(host.textContent).toContain('2 plates');
    expect(host.querySelector('button[aria-label="edit set"]')).toBeNull();
    expect(host.querySelector('button[aria-label="delete set"]')).toBeNull();
    expect(host.querySelector('button[aria-label="swap exercise"]')).toBeNull();
    expect(host.textContent).not.toContain('Add set');
    expect(await tableSnapshot()).toEqual(before);
  });

  it('starts a new same-code Wednesday workout without replacing Monday history in the same weekly cycle', async () => {
    const restoreDate = setLocalDate('2026-06-08');
    try {
      const period = { ...state().period, startDate: '2026-06-01', cycle: 1, rotationPos: 0 };
      const oldVariant = state().allVariants.find(item => item.code === 'U1');
      const mappedCode = `U1@p${period.id}r1`;
      const mappedVariant = { ...oldVariant, code: mappedCode, ownerPeriodId: period.id, exerciseUnits: { 'incline-press': 'lb' } };
      await db.routineVariants.put(mappedVariant);
      const week = { Mon: mappedCode, Tue: null, Wed: mappedCode, Thu: null, Fri: null, Sat: null, Sun: null };
      const configured = { ...period, routineVariantCodes: [mappedCode], trainingSchedule: { mode: 'weekly', week } };
      await db.periods.put(configured);
      const profile = await db.profile.get(1); await db.profile.put({ ...profile, autoFinish: false });
      const earlier = { periodId: period.id, date: '2026-06-08', cycle: 2, variant: mappedCode, block: 'Monday saved block', finished: true, entries: [{ exerciseId: 'incline-press', name: 'Monday saved entry', unit: 'lb' }] };
      earlier.id = await db.workouts.add(earlier);
      const earlierSet = { workoutId: earlier.id, exerciseId: 'incline-press', n: 1, reps: 8, value: 45, unit: 'lb', realKg: 20.412 };
      earlierSet.id = await db.sets.add(earlierSet);
      useStore.setState({ period: configured, allPeriods: [configured], variants: [mappedVariant], allVariants: [...state().allVariants.filter(item => item.code !== mappedCode), mappedVariant], profile: { ...profile, autoFinish: false }, workouts: [earlier], setsByWorkout: { [earlier.id]: [earlierSet] } });

      restoreDate();
      const restoreWednesday = setLocalDate('2026-06-10');
      try {
        expect(state().effectiveCycle()).toBe(2);
        expect(state().trainingView().workout).toBeNull();
        await render(<TodayScreen />);
        expect(host.textContent).toContain('Cycle 2');
        expect(host.textContent).not.toContain('Monday saved block');
        await clickText('Log first set'); await clickText('Log set');
        await act(async () => { await vi.waitFor(() => expect(state().workouts).toHaveLength(2)); });
        const newer = state().workouts.find(item => item.id !== earlier.id);
        expect(newer).toMatchObject({ periodId: period.id, date: '2026-06-10', cycle: 2, variant: mappedCode, finished: false });
        await act(async () => {
          await vi.waitFor(async () => expect(await db.sets.where('workoutId').equals(newer.id).count()).toBe(1));
          await vi.waitFor(() => expect(host.querySelector('[style*="gt-check-pulse"]')).toBeTruthy());
        });
        expect(await db.workouts.count()).toBe(2);
        expect(await db.workouts.get(earlier.id)).toEqual(earlier);
        expect(await db.sets.get(earlierSet.id)).toEqual(earlierSet);
        const newSet = await db.sets.where('workoutId').equals(newer.id).first();
        expect(newSet.workoutId).toBe(newer.id);
        expect(newer.entries.some(entry => entry.exerciseId === newSet.exerciseId)).toBe(true);
      } finally { restoreWednesday(); }
    } finally { restoreDate(); }
  });

  it('browses view-only and returns to automatic start instead of starting the manual variant', async () => {
    const { period } = await configureWeekly();
    const before = await tableSnapshot();
    await render(<TodayScreen />);
    await click('button[aria-label="change variant"]');
    await click('button[aria-label="go to cycle 3"]');
    await clickText('L1');
    expect(host.textContent).toContain('Preview');
    expect(host.textContent).not.toContain('Finish & advance');
    expect(host.textContent).not.toContain('Log first set');
    expect(host.querySelector('button[aria-label="swap exercise"]')).toBeNull();
    expect(state().scheduleView).toMatchObject({ cycle: 3, variantCode: 'L1' });
    expect(state().period.rotationPos).toBe(period.rotationPos);
    expect(await tableSnapshot()).toEqual(before);
    await click('button[aria-label="back to schedule"]');
    expect(state().scheduleView).toBeNull();
    await clickText('Log first set');
    await clickText('Log set');
    await vi.waitFor(() => expect(state().workouts.at(-1)?.variant).toBe('U1'));
  });
});
