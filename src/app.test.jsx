// @vitest-environment jsdom
// Boot-the-whole-app smoke test: seeds Dexie against fake-indexeddb, renders every tab,
// logs a set, finishes a workout and archives the period. Catches runtime crashes that
// unit tests on calc.js can't see.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { useStore } from './store.js';

// jsdom has no canvas: give Confetti a no-op 2D context
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const text = () => document.body.textContent || '';
const click = (selector) => act(() => {
  const el = document.querySelector(selector);
  if (!el) throw new Error('not found: ' + selector);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
const waitFor = (cond, label) => vi.waitFor(() => {
  if (!cond()) throw new Error('timeout waiting for ' + label);
}, { timeout: 4000 });

describe('app boots and core flows work', () => {
  it('renders Home after seeding, and every tab opens', async () => {
    await act(async () => {
      createRoot(document.body.appendChild(document.createElement('div'))).render(<App />);
    });
    // the dashboard is the landing tab now
    await waitFor(() => text().includes('Workouts'), 'Home screen');
    expect(text()).toContain('Cycle 1');
    expect(text()).toContain('Upper 1');           // widget 1: the variant on deck
    expect(text()).toContain('No records yet');    // widget 2: nothing logged yet

    for (const [tab, marker] of [
      ['Today', 'SETS'],
      ['Metrics', 'No data yet'],
      ['Records', ''],
      ['Settings', 'Mesocycle'],
      ['Home', 'Workouts'],
    ]) {
      click(`[aria-label="${tab}"]`);
      await waitFor(() => text().includes(marker), tab + ' screen');
    }
  });

  it('logs a set (×2 unit), finishes the workout, archives the period with a recap', async () => {
    const store = useStore.getState();
    const w = await act(() => store.createWorkout('U1'));
    expect(w).toBeTruthy();
    await act(() => useStore.getState().logSet(w.id, 'incline-press', { value: 20, reps: 10, unit: 'kgx2' }));
    const sets = useStore.getState().setsByWorkout[w.id];
    expect(sets).toHaveLength(1);
    expect(sets[0].realKg).toBe(40); // 20 kg per side, doubled

    const summary = await act(() => useStore.getState().finishWorkout(w.id));
    expect(summary.sets).toBe(1);

    // jumping to another variant after finishing starts a fresh second session today
    await act(() => useStore.getState().setActiveVariant('U2'));
    const w2 = useStore.getState().todayWorkout();
    expect(w2.variant).toBe('U2');
    expect(w2.finished).toBe(false);
    expect(w2.id).not.toBe(w.id);

    // Metrics now has data → the muscle medal map renders
    click('[aria-label="Metrics"]');
    await waitFor(() => text().includes('Muscle medal map'), 'body map');
    expect(document.querySelector('svg[aria-label="Front muscle map"]')).toBeTruthy();
    expect(document.querySelector('svg[aria-label="Back muscle map"]')).toBeTruthy();

    // archive → mesocycle celebration overlay
    await act(() => useStore.getState().archiveAndStartNew());
    await waitFor(() => text().includes('MESOCYCLE COMPLETE'), 'mesocycle recap');
    expect(text()).toContain('SESSIONS');
    await act(() => useStore.getState().dismissPeriodCelebration());
    expect(text()).not.toContain('MESOCYCLE COMPLETE');

    // fresh period with no workouts, but history exists → Metrics keeps the medal map,
    // and History defaults to the archived period that has the data
    click('[aria-label="Metrics"]');
    await waitFor(() => text().includes('Muscle medal map'), 'medal map without active-period data');
    expect(text()).not.toContain('No data yet');
    // History now lives inside Settings as a full-screen sub-page
    click('[aria-label="Settings"]');
    await waitFor(() => text().includes('Session history'), 'Settings shows the history entry');
    click('[aria-label="open history"]');
    await waitFor(() => text().includes('Archived ·'), 'History opens the period with data');
    click('[aria-label="back to settings"]');
    await waitFor(() => !text().includes('Archived ·'), 'History closes back to Settings');
  });

  it('Home shows the record of the day and opens the streak sheet', async () => {
    click('[aria-label="Home"]');
    await waitFor(() => text().includes('Workouts'), 'Home screen');
    // the PR logged above belongs to U1 — the variant on deck — so its widget picks it up
    expect(text()).toContain('Incline Press');
    expect(text()).toContain('20kg ×2');   // value and unit are separate spans
    expect(text()).toContain('× 10 reps');
    expect(text()).toContain('PR ·');

    click('[aria-label="open streak"]');
    await waitFor(() => text().includes('CURRENT'), 'streak sheet');
    expect(text()).toContain('BEST');
    expect(text()).toContain('Last 12 weeks');
    // one finished session, today → a 1-day streak
    expect(text()).toContain('today is already logged');
    click('[aria-label="close"]');
    await waitFor(() => !text().includes('Last 12 weeks'), 'streak sheet closes');

    // the settings button on the header jumps to the Settings tab
    click('[aria-label="open settings"]');
    await waitFor(() => text().includes('Mesocycle'), 'Settings from Home');
  });

  it('auto-finishes a session once every exercise has 2 sets', async () => {
    const store = useStore.getState();
    const w = await act(() => store.createWorkout('L1'));
    const ids = w.entries.map((en) => en.exerciseId);
    expect(ids.length).toBeGreaterThan(1);

    let auto = null;
    for (let round = 1; round <= 2; round++) {
      for (const id of ids) {
        await act(() => useStore.getState().logSet(w.id, id, { value: 40, reps: 8, unit: 'kg' }));
        auto = await act(() => useStore.getState().autoFinishIfComplete(w.id));
        // only the very last set of the second round covers the whole plan
        const isLast = round === 2 && id === ids[ids.length - 1];
        expect(!!auto).toBe(isLast);
      }
    }
    expect(auto.auto).toBe(true);
    expect(useStore.getState().workouts.find((x) => x.id === w.id).finished).toBe(true);

    // turning it off leaves the next session open
    await act(() => useStore.getState().updateProfile({ autoFinish: false }));
    const w2 = await act(() => useStore.getState().createWorkout('L2'));
    for (const en of w2.entries) {
      for (let i = 0; i < 2; i++) await act(() => useStore.getState().logSet(w2.id, en.exerciseId, { value: 30, reps: 10, unit: 'kg' }));
    }
    expect(await act(() => useStore.getState().autoFinishIfComplete(w2.id))).toBe(null);
    expect(useStore.getState().workouts.find((x) => x.id === w2.id).finished).toBe(false);
    await act(() => useStore.getState().updateProfile({ autoFinish: true }));
  });

  it('the Mono accent repaints the app in black & white', async () => {
    await act(() => useStore.getState().updateProfile({ accent: 'mono' }));
    expect(document.querySelector('.gt-app.mono')).toBeTruthy();
    // 'mono' is not a hex, so no inline --accent override leaks through
    expect(document.querySelector('.gt-app').style.getPropertyValue('--accent')).toBe('');

    await act(() => useStore.getState().updateProfile({ accent: '#0A84FF' }));
    expect(document.querySelector('.gt-app.mono')).toBeNull();
    expect(document.querySelector('.gt-app').style.getPropertyValue('--accent')).toBe('#0A84FF');
  });
});
