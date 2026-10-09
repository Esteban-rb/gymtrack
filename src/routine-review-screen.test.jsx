// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import ReviewRoutine from './screens/ReviewRoutine.jsx';
import { I18nProvider } from './i18n.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const profile = { name: 'Ada', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 70 };
const routine = (code = 'U1') => ({ schemaVersion: 1, variants: [{ code, order: 0, name: 'Reviewed upper', kind: 'Upper · Push', exercises: [{ ref: { type: 'catalog', id: 'bench' }, name: 'Bench Press', muscle: 'Chest', unit: 'lb', order: 0 }] }] });
const plan = () => ({ mode: 'independent', rotation: ['U1'] });
let root, host;
async function render(props = {}, locale = 'en') {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<I18nProvider locale={locale}><ReviewRoutine draft={routine()} schedule={plan()} cycleGoal={6} {...props} /></I18nProvider>));
}
async function click(label) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent.trim() === label || item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}
async function saveProfile() { return useStore.getState().saveSetupProfile(profile); }
const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, period: null, allPeriods: [], exercises: [], variants: [], allVariants: [], workouts: [], setsByWorkout: {}, bodyweight: [], prs: [], activeVariant: null });
  await useStore.getState().init();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
});

describe('ReviewRoutine', () => {
  it('summarizes saved profile, routine, schedule, and commits real empty-period apply before callback', async () => {
    await saveProfile();
    await db.profile.update(1, { preferences: { theme: 'dark' } });
    await useStore.getState().init();
    const onApplied = vi.fn(async (result) => {
      expect(await db.profile.get(1)).toMatchObject({ setupComplete: true, setupRequired: false, preferences: { theme: 'dark' } });
      expect(await db.routineVariants.where('ownerPeriodId').equals(result.period.id).count()).toBe(1);
    });
    await render({ onApplied });
    expect(host.textContent).toContain('Ada');
    expect(host.textContent).toContain('Bench Press');
    expect(host.textContent).toContain('Reviewed upper');
    expect(host.textContent).toContain('6 cycles');
    await click('Start this routine');
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(onApplied.mock.calls[0][0].status).toBe('applied');
    expect(useStore.getState().setupStatus).toBe('complete');
  });

  it('cancels and blocks invalid draft/schedule without writes or applied callback', async () => {
    const onApplied = vi.fn(), onCancel = vi.fn();
    await saveProfile();
    await render({ draft: { schemaVersion: 9, variants: [] }, schedule: { mode: 'independent', rotation: [] }, onApplied, onCancel });
    const before = await snapshot();
    expect(host.querySelector('button[aria-label="Start this routine"]')?.disabled ?? true).toBe(true);
    await click('Cancel');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApplied).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it('requires explicit restart for one partial session and preserves its IDs, snapshot, and set', async () => {
    await saveProfile();
    const old = useStore.getState().period;
    const workout = { periodId: old.id, date: '2026-01-01', variant: 'U1', finished: false, entries: [{ exerciseId: 'bench', saved: true }], snapshot: { note: 'keep this session' } };
    workout.id = await db.workouts.add(workout);
    const setId = await db.sets.add({ workoutId: workout.id, exerciseId: 'bench', n: 1, reps: 8, value: 50, unit: 'kg', realKg: 50 });
    await useStore.getState().init();
    const onApplied = vi.fn();
    await render({ onApplied });
    expect(host.textContent).toMatch(/unfinished|partial/i);
    expect(host.querySelector('button[aria-label="Start this routine"]')?.disabled ?? true).toBe(true);
    await act(async () => host.querySelector('input[type="radio"][value="close"]').click());
    await click('Start this routine');
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(await db.workouts.get(workout.id)).toEqual({ ...workout, finished: true, closeReason: 'mesocycle-restart' });
    expect(await db.sets.get(setId)).toBeTruthy();
    expect(await db.periods.get(old.id)).toMatchObject({ status: 'archived' });
    expect(onApplied.mock.calls[0][0].period.id).not.toBe(old.id);
  });

  it('requests continuing the pinned old session without applying or mutating its workout', async () => {
    await saveProfile();
    const period = useStore.getState().period;
    const workout = { periodId: period.id, variant: 'U1', finished: false, entries: [{ exerciseId: 'bench' }] };
    workout.id = await db.workouts.add(workout);
    await useStore.getState().init();
    const before = await snapshot();
    const onContinueOldSession = vi.fn(), onApplied = vi.fn();
    await render({ onContinueOldSession, onApplied });
    await act(async () => host.querySelector('input[type="radio"][value="finish"]').click());
    await click('Finish the workout first');
    expect(onContinueOldSession).toHaveBeenCalledWith({ workoutId: workout.id, periodId: period.id });
    expect(onApplied).not.toHaveBeenCalled();
    expect(await db.workouts.get(workout.id)).toEqual(workout);
    expect(await snapshot()).toEqual(before);
  });

  it('retains draft and reports real transaction write failure without applied callback', async () => {
    await saveProfile();
    const onApplied = vi.fn();
    await render({ onApplied });
    const before = await snapshot();
    const original = db.routineVariants.bulkAdd.bind(db.routineVariants);
    let writeReached = false;
    db.routineVariants.bulkAdd = async () => { writeReached = true; throw new Error('injected review write failure'); };
    try {
      const button = [...host.querySelectorAll('button')].find((item) => item.textContent.includes('Start this routine'));
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
      await vi.waitFor(() => expect(host.textContent).toContain('Nothing was changed'));
    } finally { db.routineVariants.bulkAdd = original; }
    expect(writeReached).toBe(true);
    expect(host.textContent).toContain('Reviewed upper');
    expect(onApplied).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it('reports continuation callback failure after commit and prevents reapplying', async () => {
    await saveProfile();
    const onApplied = vi.fn(() => { throw new Error('parent navigation unavailable'); });
    await render({ onApplied });
    await click('Start this routine');
    await vi.waitFor(() => expect(host.textContent).toContain('Your routine was started, but we could not continue'));
    expect(host.textContent).not.toContain('parent navigation unavailable');
    expect(await db.profile.get(1)).toMatchObject({ setupComplete: true, setupRequired: false });
    expect((await db.routineVariants.toArray()).filter((variant) => variant.ownerPeriodId === useStore.getState().period.id)).toHaveLength(1);
    expect(host.querySelector('button[aria-label="Start this routine"]').disabled).toBe(true);
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it('guards same-tick duplicate apply and runs continuation only after applied status', async () => {
    await saveProfile();
    let resolveApply;
    const actual = useStore.getState().applyReviewedRoutine;
    const applyMock = vi.fn(() => new Promise((resolve) => { resolveApply = resolve; }));
    useStore.setState({ applyReviewedRoutine: applyMock });
    const onApplied = vi.fn();
    try {
      await render({ onApplied });
      const button = [...host.querySelectorAll('button')].find((item) => item.textContent.includes('Start this routine'));
      await act(async () => { button.click(); button.click(); });
      expect(applyMock).toHaveBeenCalledOnce();
      expect(onApplied).not.toHaveBeenCalled();
      await act(async () => { resolveApply({ status: 'applied', period: { id: 99 } }); await vi.waitFor(() => expect(onApplied).toHaveBeenCalled()); });
      expect(onApplied).toHaveBeenCalledWith({ status: 'applied', period: { id: 99 } });
      expect(host.textContent).toContain('Your routine is ready');
    } finally { useStore.setState({ applyReviewedRoutine: actual }); }
  });

  it('shows a human summary with localized day names, no raw enums, codes lists or UUIDs', async () => {
    await saveProfile();
    await db.profile.update(1, { sex: 'prefer_not_to_say', name: 'Esteban', age: 30, heightCm: 175, bodyweightKg: 80 });
    await useStore.getState().init();
    const draft = { schemaVersion: 1, variants: [
      { code: 'A', order: 0, name: 'Push day', kind: 'Custom', exercises: [{ ref: { type: 'catalog', id: 'bench' }, name: 'Bench Press', muscle: 'Chest', unit: 'kg', order: 0 }, { ref: { type: 'catalog', id: 'bench' }, name: 'Dips', muscle: 'Chest', unit: 'kg', order: 1 }] },
      { code: 'B', order: 1, name: 'Pull day', kind: 'Custom', exercises: [{ ref: { type: 'catalog', id: 'bench' }, name: 'Rows', muscle: 'Back', unit: 'kg', order: 0 }] },
    ] };
    await render({ draft, schedule: { mode: 'weekly', week: { Mon: 'A', Wed: 'B', Tue: null } }, cycleGoal: 5 });
    const text = host.textContent;
    expect(text).toContain('Esteban · 30 years · 175 cm · 80 kg');
    expect(text).not.toMatch(/prefer_not_to_say|Prefer not to say/);
    expect(text).toContain('A · Push day');
    expect(text).toContain('2 exercises');
    expect(text).toContain('1 exercise');
    expect(text).toContain('Monday: A · Push day');
    expect(text).toContain('Wednesday: B · Pull day');
    expect(text).toMatch(/Rest: Tuesday, Thursday, Friday, Saturday, Sunday/);
    expect(text).toContain('5 cycles (weeks)');
    expect(text).not.toMatch(/Mon: A|Upper · Push|\b[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).toContain('This will be your active plan.');
  });

  it('summarizes a rotation as an arrow chain and full-rotation cycles', async () => {
    await saveProfile();
    await render({ schedule: { mode: 'independent', rotation: ['U1'] }, cycleGoal: 7 });
    expect(host.textContent).toContain('U1 · Reviewed upper');
    expect(host.textContent).toContain('7 cycles (full rotations)');
  });

  it('exposes Edit buttons that jump to the right wizard step', async () => {
    await saveProfile();
    const onEdit = vi.fn();
    await render({ onEdit });
    const edits = [...host.querySelectorAll('button')].filter((item) => item.textContent.trim() === 'Edit');
    expect(edits).toHaveLength(3);
    for (const edit of edits) await act(async () => edit.click());
    expect(onEdit.mock.calls.map((call) => call[0])).toEqual(['profile', 'routine', 'schedule']);
  });

  it('says in one sentence that an occupied block is saved to History and no workouts are lost', async () => {
    await saveProfile();
    const old = useStore.getState().period;
    await db.workouts.add({ periodId: old.id, date: '2026-01-01', variant: 'U1', finished: true, entries: [] });
    await useStore.getState().init();
    await render();
    expect(host.textContent).toContain('Your current training block will be saved to History and a new one will start. No workouts are lost.');
    expect(host.textContent).not.toMatch(/snapshot|workout ID|occupied|archived|period/i);
  });

  it('explains one unfinished workout in plain words without its id and requires a choice first', async () => {
    await saveProfile();
    const old = useStore.getState().period;
    const workout = { periodId: old.id, date: '2026-01-01', variant: 'U1', finished: false, entries: [] };
    workout.id = await db.workouts.add(workout);
    await useStore.getState().init();
    await render({ onContinueOldSession: vi.fn() });
    expect(host.textContent).toMatch(/You have an unfinished workout from .*2026/);
    expect(host.textContent).not.toMatch(/\b[0-9a-f]{8}-|session \d|workout \d/i);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Finish it first');
    expect(host.textContent).toContain('Close it and start the new routine');
    expect(host.querySelector('button[aria-label="Start this routine"]').disabled).toBe(true);
    expect(host.textContent).toContain('Choose what to do with your unfinished workout to continue.');
  });

  async function seedSeveral() {
    await saveProfile();
    const old = useStore.getState().period;
    await useStore.getState().init();
    const code = useStore.getState().allVariants.find((v) => v.ownerPeriodId == null || v.ownerPeriodId === old.id)?.code ?? 'U1';
    await db.workouts.bulkAdd([
      { periodId: old.id, date: '2026-01-01', variant: code, finished: false, entries: [] },
      { periodId: old.id, date: '2026-01-02', variant: code, finished: false, entries: [] },
    ]);
    await useStore.getState().init();
    return old;
  }

  it('lists several unfinished workouts and requires the close-all choice before starting', async () => {
    await seedSeveral();
    await render({ onContinueOldSession: vi.fn() });
    const start = () => host.querySelector('button[aria-label="Start this routine"]');
    expect(host.textContent).toMatch(/2026/);
    expect(host.querySelectorAll('[data-testid="unfinished-item"]')).toHaveLength(2);
    expect(host.textContent).toContain('They stay in History with every set you logged.');
    expect(host.textContent).not.toContain('Finish or close them from the Today screen');
    expect(host.textContent).not.toMatch(/\b[0-9a-f]{8}-|workout \d/i);
    expect(start().disabled).toBe(true);
    expect(host.textContent).toContain('Choose what to do with your unfinished workouts to continue.');
    const radio = host.querySelector('input[type="radio"]');
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(1);
    expect(host.textContent).toContain('Close them all and start the new routine');
    await act(async () => radio.click());
    expect(start().disabled).toBe(false);
  });

  it('applies with resolution restart after choosing to close them all', async () => {
    const old = await seedSeveral();
    const onApplied = vi.fn();
    await render({ onApplied });
    await act(async () => host.querySelector('input[type="radio"]').click());
    await click('Start this routine');
    await vi.waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    const rows = await db.workouts.where('periodId').equals(old.id).toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every((w) => w.finished && w.closeReason === 'mesocycle-restart')).toBe(true);
  });

  it('shows the several-unfinished choice in Spanish', async () => {
    await seedSeveral();
    await render({}, 'es');
    expect(host.textContent).toContain('Cerrarlos todos y empezar la nueva rutina');
    expect(host.textContent).toContain('Se quedan en el Historial con cada serie que registraste.');
    expect(host.textContent).not.toMatch(/Close them all|unfinished/);
  });

  it('renders the review in Spanish with localized days and no English leaks', async () => {
    await saveProfile();
    await render({ schedule: { mode: 'weekly', week: { Mon: 'U1' } }, onEdit: vi.fn() }, 'es');
    const text = host.textContent;
    expect(text).toContain('Lunes: U1 · Reviewed upper');
    expect(text).toContain('Descanso: Martes');
    expect(text).toContain('Editar');
    expect(text).toContain('Ada · Mujer · 30 años');
    expect(text).toContain('Este será tu plan activo.');
    expect(text).not.toMatch(/\bEdit\b|Rest:|cycles|years/);
  });
});
