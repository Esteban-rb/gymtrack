// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ProgressBar, Sheet, Stepper, TabBar, UndoToast } from './components.jsx';
import { FinishOverlay } from './screens/Today.jsx';
import HistoryScreen from './screens/History.jsx';
import { useStore } from './store.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = () => null;
const mounted = [];
let storeSnapshot;

async function render(node) {
  const host = document.body.appendChild(document.createElement('div'));
  let root;
  await act(async () => {
    root = createRoot(host);
    root.render(node);
  });
  mounted.push({ host, root });
  return { host, root };
}

afterEach(async () => {
  while (mounted.length) {
    const { host, root } = mounted.pop();
    await act(async () => root.unmount());
    host.remove();
  }
  if (storeSnapshot) {
    useStore.setState(storeSnapshot, true);
    storeSnapshot = undefined;
  }
});

describe('shared component accessibility', () => {
  it('exposes sheets as labelled modals, focuses them, and closes on Escape', async () => {
    const close = vi.fn();
    await render(<Sheet open onClose={close} title="Change variant"><button>Choice</button></Sheet>);

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('close Change variant');

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(close).toHaveBeenCalledOnce();
  });

  it('gives every stepper control a contextual accessible name', async () => {
    await render(<Stepper label="Weight" value={50} onChange={() => {}} />);
    expect(document.querySelector('[aria-label="Weight value"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Decrease Weight"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Increase Weight"]')).toBeTruthy();
  });

  it('keeps focus inside an open sheet when its parent rerenders', async () => {
    const { root } = await render(<Sheet open onClose={() => {}} title="Search"><input aria-label="Exercise search" /></Sheet>);
    const input = document.querySelector('[aria-label="Exercise search"]');
    input.focus();

    await act(async () => root.render(<Sheet open onClose={() => {}} title="Search"><input aria-label="Exercise search" /></Sheet>));

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Exercise search');
  });

  it('announces progress and the active primary destination', async () => {
    await render(<><ProgressBar value={3} max={6} label="Cycle progress" /><TabBar tab="today" onChange={() => {}} /></>);
    const progress = document.querySelector('[role="progressbar"]');
    expect(progress.getAttribute('aria-valuenow')).toBe('3');
    expect(progress.getAttribute('aria-valuemax')).toBe('6');
    expect(document.querySelector('nav[aria-label="Primary"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Today"]').getAttribute('aria-current')).toBe('page');
  });

  it('keeps progress ARIA values within the declared range', async () => {
    await render(<ProgressBar value={7} max={6} label="Cycle progress" />);
    const progress = document.querySelector('[role="progressbar"]');

    expect(progress.getAttribute('aria-valuenow')).toBe('6');
    expect(progress.getAttribute('aria-valuemax')).toBe('6');
  });

  it('announces destructive actions and offers undo', async () => {
    const undo = vi.fn();
    await render(<UndoToast message="Set deleted" onUndo={undo} />);

    expect(document.querySelector('[role="status"]').textContent).toContain('Set deleted');
    await act(async () => document.querySelector('button').click());
    expect(undo).toHaveBeenCalledOnce();
  });

  it('keeps History undo in the sheet focus trap and restores focus on Escape', async () => {
    storeSnapshot = useStore.getState();
    const deleted = { id: 11, workoutId: 7, exerciseId: 'bench', n: 1, value: 60, realKg: 60, reps: 8, unit: 'kg' };
    useStore.setState({
      period: { id: 1, status: 'active', startDate: '2026-01-01', cycle: 1 },
      allPeriods: [{ id: 1, status: 'active', startDate: '2026-01-01', cycle: 1 }],
      variants: [{ code: 'U2', name: 'Upper', exerciseIds: ['bench'] }],
      workouts: [{ id: 7, periodId: 1, cycle: 1, variant: 'U2', block: 'Upper', date: '2026-01-02', finished: true, entries: [{ exerciseId: 'bench' }] }],
      setsByWorkout: { 7: [deleted] },
      exercises: [{ id: 'bench', name: 'Bench press', muscle: 'Chest' }],
      deleteSet: vi.fn().mockResolvedValue(deleted),
      restoreSet: vi.fn().mockResolvedValue(true),
    });
    await render(<HistoryScreen onBack={() => {}} />);

    const opener = document.querySelector('button.gt-card:not([disabled])');
    opener.focus();
    await act(async () => opener.click());
    const dialog = document.querySelector('[role="dialog"]');
    await act(async () => document.querySelector('[aria-label="delete set"]').click());
    const undo = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Undo');

    expect(dialog.contains(undo)).toBe(true);
    const close = document.querySelector('[aria-label^="close Cycle"]');
    close.focus();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(undo);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    expect(document.activeElement).toBe(close);

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('treats workout celebrations as dismissible modal dialogs', async () => {
    const close = vi.fn();
    await render(<FinishOverlay summary={{ auto: false, workoutNum: 1, sets: 2, volume: 1000, prs: [] }} onClose={close} />);

    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Done');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(close).toHaveBeenCalledOnce();
  });
});
