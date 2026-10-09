// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import TodayScreen from './screens/Today.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
async function mount(pinnedSession, onReturn) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<TodayScreen pinnedSession={pinnedSession} onReturn={onReturn} />));
}
async function clickText(text) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent.includes(text));
  if (!button) throw new Error(`Missing button text ${text}`);
  await act(async () => button.click());
}
async function initWithWorkoutRows() {
  await useStore.getState().init();
  return useStore.getState().period;
}
const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, period: null, allPeriods: [], exercises: [], variants: [], allVariants: [], workouts: [], setsByWorkout: {}, bodyweight: [], prs: {}, activeVariant: null, scheduleView: null });
  await useStore.getState().init();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
});

async function addPinnedAndCompetingWorkouts() {
  const period = useStore.getState().period;
  const a = { periodId: period.id, date: '2026-05-01', cycle: 1, variant: 'L1', block: 'Saved A block', finished: false, entries: [{ exerciseId: 'hack-squat', name: 'Saved squat name', muscle: 'Legs', unit: 'plates', custom: 'snapshot A' }] };
  a.id = await db.workouts.add(a);
  const aSet = { workoutId: a.id, exerciseId: 'hack-squat', n: 1, reps: 8, value: 2, unit: 'plates', realKg: 80 };
  aSet.id = await db.sets.add(aSet);
  const b = { periodId: period.id, date: '2026-05-02', cycle: 1, variant: 'U1', block: 'Competing current B', finished: true, entries: [{ exerciseId: 'bench', name: 'B saved bench', unit: 'kg' }] };
  b.id = await db.workouts.add(b);
  const bSet = { workoutId: b.id, exerciseId: 'bench', n: 1, reps: 5, value: 60, unit: 'kg', realKg: 60 };
  bSet.id = await db.sets.add(bSet);
  await useStore.getState().init();
  return { period, a, aSet, b, bSet };
}

describe('Today pinned session continuation', () => {
  it('shows exact pinned A instead of current finished B and logs/finishes only A', async () => {
    const { period, a, b, bSet } = await addPinnedAndCompetingWorkouts();
    const beforePeriod = useStore.getState().period;
    await mount({ workoutId: a.id, periodId: period.id });
    expect(host.textContent).toContain('Saved A block');
    expect(host.textContent).toContain('Saved squat name');
    expect(host.textContent).toContain('2 plates');
    expect(host.textContent).not.toContain('Competing current B');
    expect(host.querySelector('button[aria-label="change variant"]')).toBeNull();
    expect(host.querySelector('button[aria-label="swap exercise"]')).toBeTruthy();
    await clickText('Add set'); await clickText('Log set');
    await vi.waitFor(async () => expect(await db.sets.where('workoutId').equals(a.id).count()).toBe(2));
    expect(await db.workouts.get(b.id)).toEqual(b);
    expect(await db.sets.get(bSet.id)).toEqual(bSet);
    expect(useStore.getState().period).toEqual(beforePeriod);
    await clickText('Finish & advance');
    await vi.waitFor(async () => expect((await db.workouts.get(a.id)).finished).toBe(true));
    expect((await db.workouts.get(a.id)).closeReason).toBeUndefined();
    expect(await db.workouts.get(b.id)).toEqual(b);
    expect(await db.sets.get(bSet.id)).toEqual(bSet);
    expect(useStore.getState().period.rotationPos).not.toBe(beforePeriod.rotationPos);
  });

  it.each(['missing', 'period-mismatch', 'finished', 'changed-active-period'])('fails closed for %s pin without workout actions or writes', async (kind) => {
    const period = useStore.getState().period;
    let workoutId = 999;
    let pinnedPeriodId = period.id;
    if (kind !== 'missing') {
      const workout = { periodId: period.id, variant: 'L1', finished: kind === 'finished', entries: [{ exerciseId: 'hack-squat', unit: 'plates' }] };
      workoutId = await db.workouts.add(workout);
      if (kind === 'period-mismatch') pinnedPeriodId = period.id + 100;
      if (kind === 'changed-active-period') useStore.setState({ period: { ...period, id: period.id + 100 } });
    }
    const before = await snapshot();
    const onReturn = kind === 'missing' ? undefined : vi.fn();
    await mount({ workoutId, periodId: pinnedPeriodId }, onReturn);
    expect(host.textContent).toMatch(/unavailable|no longer active|not available/i);
    expect(host.querySelector('button[aria-label="change variant"]')).toBeNull();
    expect(host.querySelector('button[aria-label="swap exercise"]')).toBeNull();
    expect(host.textContent).not.toContain('Log first set');
    expect(host.textContent).not.toContain('Finish & advance');
    if (onReturn) {
      expect(host.querySelector('button[aria-label="Back to review"]')).toBeTruthy();
      await clickText('Back to review');
      expect(onReturn).toHaveBeenCalledOnce();
    } else expect(host.querySelector('button[aria-label="Back to review"]')).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('does not finish a pinned partial session merely because existing sets meet auto-finish thresholds', async () => {
    const period = useStore.getState().period;
    const workout = { periodId: period.id, date: '2026-05-04', variant: 'L1', finished: false, entries: [{ exerciseId: 'hack-squat', unit: 'kg' }] };
    workout.id = await db.workouts.add(workout);
    await db.sets.bulkAdd([
      { workoutId: workout.id, exerciseId: 'hack-squat', n: 1, reps: 8, value: 40, unit: 'kg', realKg: 40 },
      { workoutId: workout.id, exerciseId: 'hack-squat', n: 2, reps: 8, value: 35, unit: 'kg', realKg: 35 },
    ]);
    await useStore.getState().init();
    const before = await snapshot();
    await mount({ workoutId: workout.id, periodId: period.id });
    expect(await db.workouts.get(workout.id)).toEqual(workout);
    expect(await snapshot()).toEqual(before);
    expect(host.textContent).toContain('Finish & advance');
  });

  it('reports a failed auto-finish after the set commits and allows explicit finish retry', async () => {
    const period = useStore.getState().period;
    const workout = { periodId: period.id, date: '2026-05-05', cycle: 1, variant: 'L1', finished: false, entries: [{ exerciseId: 'hack-squat', name: 'Saved squat', unit: 'kg' }] };
    workout.id = await db.workouts.add(workout);
    await db.sets.add({ workoutId: workout.id, exerciseId: 'hack-squat', n: 1, reps: 8, value: 40, unit: 'kg', realKg: 40 });
    await useStore.getState().init();
    const beforePeriod = useStore.getState().period;
    await mount({ workoutId: workout.id, periodId: period.id });
    const originalPut = db.workouts.put.bind(db.workouts);
    let finishAttempts = 0;
    db.workouts.put = async (row, ...rest) => {
      if (row?.id === workout.id && row.finished) { finishAttempts++; throw new Error('injected auto-finish failure'); }
      return originalPut(row, ...rest);
    };
    try {
      await clickText('Add set'); await clickText('Log set');
      await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Set saved, but automatic finish failed'));
      expect(host.textContent).toContain('injected auto-finish failure');
      expect(await db.sets.where('workoutId').equals(workout.id).count()).toBe(2);
      expect(await db.workouts.get(workout.id)).toEqual(workout);
      expect(useStore.getState().period).toEqual(beforePeriod);
      expect(finishAttempts).toBe(1);
      expect(host.textContent).toContain('Finish & advance');
    } finally { db.workouts.put = originalPut; }
    await clickText('Finish & advance');
    await vi.waitFor(async () => expect((await db.workouts.get(workout.id)).finished).toBe(true));
    expect(host.textContent).toContain('Pinned session unavailable');
    expect(finishAttempts).toBe(1);
  });

  it('preserves ordinary unpinned selection of the current finished workout', async () => {
    const { b } = await addPinnedAndCompetingWorkouts();
    await mount(undefined);
    expect(host.textContent).toContain('Competing current B');
    expect(host.textContent).toContain('B saved bench');
    expect(host.querySelector('button[aria-label="change variant"]')).toBeTruthy();
  });
});
