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
  it('renders Today after seeding, and every tab opens', async () => {
    await act(async () => {
      createRoot(document.body.appendChild(document.createElement('div'))).render(<App />);
    });
    await waitFor(() => text().includes('SETS'), 'Today screen');
    expect(text()).toContain('Week 1 of 12');

    for (const [tab, marker] of [
      ['Metrics', 'No data yet'],
      ['Records', ''],
      ['History', ''],
      ['Settings', 'Period'],
      ['Today', 'SETS'],
    ]) {
      click(`[aria-label="${tab}"]`);
      await waitFor(() => text().includes(marker), tab + ' screen');
    }
  });

  it('logs a set (×2 unit), finishes the workout, archives the period with a recap', async () => {
    const store = useStore.getState();
    const w = await act(() => store.createWorkout('Mon'));
    expect(w).toBeTruthy();
    await act(() => useStore.getState().logSet(w.id, 'incline-press', { value: 20, reps: 10, unit: 'kgx2' }));
    const sets = useStore.getState().setsByWorkout[w.id];
    expect(sets).toHaveLength(1);
    expect(sets[0].realKg).toBe(40); // 20 kg per side, doubled

    const summary = await act(() => useStore.getState().finishWorkout(w.id));
    expect(summary.sets).toBe(1);

    // Metrics now has data → the muscle medal map renders
    click('[aria-label="Metrics"]');
    await waitFor(() => text().includes('Muscle medal map'), 'body map');
    expect(document.querySelector('svg[aria-label="Front muscle map"]')).toBeTruthy();
    expect(document.querySelector('svg[aria-label="Back muscle map"]')).toBeTruthy();

    // archive → period celebration overlay
    await act(() => useStore.getState().archiveAndStartNew());
    await waitFor(() => text().includes('PERIOD COMPLETE'), 'period recap');
    expect(text()).toContain('Workouts'.toUpperCase());
    await act(() => useStore.getState().dismissPeriodCelebration());
    expect(text()).not.toContain('PERIOD COMPLETE');

    // fresh period with no workouts, but history exists → Metrics keeps the medal map,
    // and History defaults to the archived period that has the data
    click('[aria-label="Metrics"]');
    await waitFor(() => text().includes('Muscle medal map'), 'medal map without active-period data');
    expect(text()).not.toContain('No data yet');
    click('[aria-label="History"]');
    await waitFor(() => text().includes('Archived ·'), 'History opens the period with data');
  });
});
