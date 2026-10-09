// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import { I18nProvider } from './i18n.js';
import ScheduleEditor from './screens/ScheduleEditor.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const codes = ['U1', 'L1', 'U2'];
const weekly = () => ({ mode: 'weekly', week: { Mon: 'U1', Tue: null, Wed: 'L1', Thu: 'U2', Fri: null, Sat: 'L1', Sun: null } });
let root, host, seeded;
const names = { U1: 'Upper one', L1: 'Lower one', U2: 'Upper two' };
async function mount(schedule = weekly(), variantCodes = codes, onReady, onChange = vi.fn(), extra = {}) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  function Controlled() {
    const [current, setCurrent] = useState(schedule);
    return <ScheduleEditor schedule={current} variantCodes={variantCodes} variantNames={names} onChange={(next) => { onChange(next); setCurrent(next); }} onReady={onReady} {...extra} />;
  }
  await act(async () => root.render(<Controlled />));
  return { onReady, onChange };
}
async function change(selector, value) {
  const field = host.querySelector(selector);
  if (!field) throw new Error(`Missing control ${selector}`);
  await act(async () => {
    const proto = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, value);
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function click(label) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent.trim() === label || item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}
async function pickMode(id) {
  await act(async () => host.querySelector(`#schedule-mode-${id}`).click());
}
const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, bodyweight: [], prs: {}, workouts: [], setsByWorkout: {}, allPeriods: [], exercises: [], variants: [] });
  await useStore.getState().init();
  seeded = await snapshot();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
});

describe('ScheduleEditor', () => {
  it('shows two mode cards with nothing selected, no errors and no jargon on first view', async () => {
    await mount(null, codes, vi.fn());
    const radios = [...host.querySelectorAll('input[type="radio"][name="schedule-mode"]')];
    expect(radios).toHaveLength(2);
    expect(radios.some((radio) => radio.checked)).toBe(false);
    expect(host.querySelector('[role="radiogroup"]')).toBeTruthy();
    expect(host.textContent).toContain('Fixed days of the week');
    expect(host.textContent).toContain('e.g. Monday: A, Wednesday: B, Friday: A');
    expect(host.textContent).toContain('Rotation');
    expect(host.textContent).toContain('whatever the day');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toMatch(/Unavailable mode|invalid_schedule|must be an object|Preview|independent/i);
    expect(host.querySelector('button[aria-label="Use schedule"]').disabled).toBe(true);
    expect(host.textContent).toMatch(/Choose how you train/);
  });

  it('shows seven localized day rows with routine names, defaults to rest and summarizes in plain words', async () => {
    const onChange = vi.fn();
    await mount(null, codes, vi.fn(), onChange);
    await pickMode('weekly');
    expect(onChange.mock.calls[0][0]).toEqual({ mode: 'weekly', week: { Mon: null, Tue: null, Wed: null, Thu: null, Fri: null, Sat: null, Sun: null } });
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) expect(host.textContent).toContain(day);
    expect(host.querySelector('#schedule-week-Mon').value).toBe('slot:rest');
    const labels = [...host.querySelectorAll('#schedule-week-Mon option')].map((option) => option.textContent);
    expect(labels).toEqual(['Rest day', 'U1 · Upper one', 'L1 · Lower one', 'U2 · Upper two']);
    expect(host.textContent).toContain('0 training days, 7 rest days');
    expect(host.querySelector('#schedule-preview-date')).toBeNull();
    expect(host.textContent).not.toMatch(/Preview/);
    await change('#schedule-week-Mon', 'routine:U1');
    await change('#schedule-week-Wed', 'routine:L1');
    await change('#schedule-week-Fri', 'routine:U1');
    expect(host.textContent).toContain('3 training days, 4 rest days');
    expect(host.textContent).not.toMatch(/slot:|routine:/);
  });

  it('shows a missing day as a rest day and returns a valid owned snapshot on Next', async () => {
    const onReady = vi.fn(), onChange = vi.fn();
    const schedule = { mode: 'weekly', week: { Mon: 'U1' } };
    await mount(schedule, codes, onReady, onChange);
    expect(host.querySelector('#schedule-week-Tue').value).toBe('slot:rest');
    await change('#schedule-week-Mon', 'slot:rest');
    expect(onChange.mock.calls[0][0].week.Mon).toBeNull();
    await change('#schedule-week-Mon', 'routine:L1');
    await click('Use schedule');
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady.mock.calls[0][0]).toEqual({ mode: 'weekly', week: { Mon: 'L1' } });
    expect(onReady.mock.calls[0][0]).not.toBe(schedule);
    expect(schedule.week.Mon).toBe('U1');
  });

  it('requires a training day, with a plain message only after attempting Next', async () => {
    const onReady = vi.fn();
    await mount(null, codes, onReady);
    await pickMode('weekly');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await click('Use schedule');
    expect(onReady).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]').textContent).toBe('Pick at least one training day.');
    await change('#schedule-week-Mon', 'routine:U1');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('edits the rotation as an ordered list with distinct add controls and no preview controls', async () => {
    const onChange = vi.fn();
    await mount(null, codes, vi.fn(), onChange);
    await pickMode('independent');
    expect(onChange.mock.calls[0][0]).toEqual({ mode: 'independent', rotation: [] });
    expect(host.textContent).toContain('No routines in the rotation yet.');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await change('#schedule-add-routine', 'U1');
    await click('Add to rotation');
    await change('#schedule-add-routine', 'L1');
    await click('Add to rotation');
    expect(onChange.mock.calls.at(-1)[0].rotation).toEqual(['U1', 'L1']);
    expect([...host.querySelectorAll('#schedule-add-routine option')].map((option) => option.textContent)).toEqual(['Choose a routine', 'U2 · Upper two']);
    expect(host.textContent).toContain('1. U1 · Upper one');
    await click('Move L1 · Lower one up');
    expect(onChange.mock.calls.at(-1)[0].rotation).toEqual(['L1', 'U1']);
    await click('Remove U1 · Upper one');
    expect(onChange.mock.calls.at(-1)[0].rotation).toEqual(['L1']);
    await click('Add all routines in order');
    expect(onChange.mock.calls.at(-1)[0].rotation).toEqual(['L1', 'U1', 'U2']);
    expect(host.textContent).not.toMatch(/Preview|Inspect|Previous|Unavailable/);
    expect(await snapshot()).toEqual(seeded);
  });

  it('asks for a routine in the rotation only after attempting Next', async () => {
    const onReady = vi.fn();
    await mount({ mode: 'independent', rotation: [] }, codes, onReady);
    await click('Use schedule');
    expect(onReady).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]').textContent).toBe('Add at least one routine to the rotation.');
  });

  it('confirms before a mode switch clears assignments and keeps them on cancel', async () => {
    const onChange = vi.fn();
    await mount(weekly(), codes, vi.fn(), onChange);
    await pickMode('independent');
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]').textContent).toContain('Switch schedule type? Your current day assignments will be cleared.');
    await click('Keep my days');
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector('#schedule-week-Mon').value).toBe('routine:U1');
    await pickMode('independent');
    await click('Switch to rotation');
    expect(onChange).toHaveBeenCalledWith({ mode: 'independent', rotation: [] });
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('confirms the other way too, but switching from an empty schedule needs no dialog', async () => {
    const onChange = vi.fn();
    await mount({ mode: 'independent', rotation: ['U1'] }, codes, vi.fn(), onChange);
    await pickMode('weekly');
    expect(host.querySelector('[role="alertdialog"]').textContent).toContain('Your current rotation will be cleared.');
    await click('Switch to fixed days');
    expect(onChange.mock.calls.at(-1)[0].mode).toBe('weekly');
    await pickMode('independent');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onChange.mock.calls.at(-1)[0]).toEqual({ mode: 'independent', rotation: [] });
  });

  it('owns the cycle goal: defaults to 6, accepts 4 to 8 and explains each mode accurately', async () => {
    const onCycleGoalChange = vi.fn();
    await mount(null, codes, vi.fn(), vi.fn(), { cycleGoal: 6, onCycleGoalChange });
    expect(host.textContent).not.toContain('How long is this training block?');
    await pickMode('weekly');
    expect(host.textContent).toContain('How long is this training block?');
    const options = [...host.querySelectorAll('[role="radiogroup"][aria-label="Cycles in this block"] [role="radio"]')];
    expect(options.map((item) => item.textContent)).toEqual(['4', '5', '6', '7', '8']);
    expect(options.find((item) => item.getAttribute('aria-checked') === 'true').textContent).toBe('6');
    expect(host.textContent).toMatch(/one calendar week/);
    expect(host.textContent).toMatch(/does not stop automatically/);
    await act(async () => options[0].click());
    expect(onCycleGoalChange).toHaveBeenCalledWith(4);
    await act(async () => host.querySelector('#schedule-mode-independent').click());
    expect(host.textContent).toMatch(/full pass through your rotation/);
  });

  it('keeps stale routine codes visible and blocks Next with a plain message', async () => {
    const onReady = vi.fn(), onChange = vi.fn();
    await mount({ mode: 'weekly', week: { Mon: 'STALE' } }, ['U1'], onReady, onChange);
    expect(host.querySelector('#schedule-week-Mon').value).toBe('routine:STALE');
    await click('Use schedule');
    expect(onReady).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/no longer exists/);
    expect(host.querySelector('[role="alert"]').textContent).not.toMatch(/unknown_variant|week\./);
  });

  it('keeps frozen schedules immutable and hides Next if callback is missing', async () => {
    const schedule = Object.freeze({ mode: 'weekly', week: Object.freeze({ Mon: 'U1' }) });
    const onChange = vi.fn();
    await mount(schedule, codes, null, onChange);
    await change('#schedule-week-Mon', 'routine:L1');
    expect(onChange).toHaveBeenCalledOnce();
    expect(schedule.week.Mon).toBe('U1');
    expect(host.querySelector('button[aria-label="Use schedule"]')).toBeNull();
    expect(await snapshot()).toEqual(seeded);
  });

  it('is fully Spanish with accents on a Spanish device', async () => {
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    await act(async () => root.render(<I18nProvider locale="es"><ScheduleEditor schedule={null} variantCodes={codes} variantNames={names} onChange={vi.fn()} onReady={vi.fn()} cycleGoal={6} onCycleGoalChange={vi.fn()} /></I18nProvider>));
    expect(host.textContent).toContain('Días fijos de la semana');
    expect(host.textContent).toContain('Rotación');
    await act(async () => root.render(<I18nProvider locale="es"><ScheduleEditor schedule={{ mode: 'weekly', week: {} }} variantCodes={codes} variantNames={names} onChange={vi.fn()} onReady={vi.fn()} cycleGoal={6} onCycleGoalChange={vi.fn()} /></I18nProvider>));
    expect(host.textContent).toContain('Lunes');
    expect(host.textContent).toContain('0 días de entrenamiento, 7 de descanso');
    expect(host.textContent).toContain('¿Cuánto dura este bloque de entrenamiento?');
  });
});
