// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import ManualRoutineEditor from './screens/ManualRoutineEditor.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const catalog = [
  { id: 'bench', name: 'Bench Press', muscle: 'Chest', unit: 'kg', isBasic: true, standards: [1, 2, 3] },
  { id: 'row', name: 'Row', muscle: 'Back', unit: 'lb', isBasic: false, standards: null },
  { id: 'curl', name: 'Incline Curl', muscle: 'Biceps', unit: 'kgx2', isBasic: false, standards: null },
];
const exercise = (overrides = {}) => ({ ref: { type: 'catalog', id: 'bench' }, name: 'Bench Press', order: 4, unit: 'kg', muscle: 'Chest', ...overrides });
const variant = (overrides = {}) => ({ code: 'A', order: 2, name: 'Upper', kind: 'Push', exercises: [exercise()], ...overrides });
const initialDraft = () => ({ schemaVersion: 1, variants: [variant()] });
const emptyDraft = () => ({ schemaVersion: 1, variants: [] });
const freeze = (value) => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
let root, host, seeded, latest;
async function render(draft = initialDraft(), props = {}) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  function Controlled() {
    const [current, setCurrent] = useState(draft);
    latest = current;
    return <ManualRoutineEditor draft={current} catalog={catalog} onChange={setCurrent} {...props} />;
  }
  await act(async () => root.render(<Controlled />));
}
const buttons = () => [...host.querySelectorAll('button')];
const button = (name) => buttons().find((item) => item.textContent.trim() === name || item.getAttribute('aria-label') === name);
async function click(name) {
  const target = button(name);
  if (!target) throw new Error(`Missing button ${name}`);
  await act(async () => target.click());
}
const field = (label) => {
  const labelled = [...host.querySelectorAll('label')].find((item) => item.textContent.trim() === label);
  return labelled ? host.querySelector(`#${labelled.htmlFor}`) : host.querySelector(`[aria-label="${label}"]`);
};
const fieldsByLabel = (label) => [...host.querySelectorAll('label')].filter((item) => item.textContent.trim() === label).map((item) => host.querySelector(`#${item.htmlFor}`));
async function type(element, value) {
  await act(async () => {
    const proto = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function pick(index, optionText, routine = 0) {
  const input = host.querySelector(`#manual-routine-exercise-${routine}-${index}-picker`);
  await act(async () => { input.focus(); input.click(); });
  const option = [...host.querySelectorAll('[role="option"]')].find((item) => item.textContent.trim() === optionText);
  if (!option) throw new Error(`Missing option ${optionText}`);
  await act(async () => option.click());
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

describe('ManualRoutineEditor start choice', () => {
  it('shows two option cards and no errors for an empty draft', async () => {
    await render(emptyDraft(), { onImport: vi.fn() });
    expect(button('Create from scratch')).toBeTruthy();
    expect(button('Import a file')).toBeTruthy();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(field('Routine name')).toBeFalsy();
    expect(host.textContent).not.toMatch(/issues|variants\[|empty-variants|draft/i);
  });

  it('creates a first routine with code A and one blank exercise from scratch', async () => {
    await render(emptyDraft(), { onImport: vi.fn() });
    await click('Create from scratch');
    expect(latest.variants).toHaveLength(1);
    expect(latest.variants[0]).toMatchObject({ code: 'A', kind: 'Custom', name: '' });
    expect(latest.variants[0].exercises).toHaveLength(1);
    expect(field('Routine name').getAttribute('placeholder')).toBe('Push day');
    expect(host.textContent).toContain('A');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain('Fix the highlighted fields');
  });

  it('routes both the card and the secondary link to the import callback', async () => {
    const onImport = vi.fn();
    await render(emptyDraft(), { onImport });
    await click('Import a file');
    expect(onImport).toHaveBeenCalledTimes(1);
    await click('Create from scratch');
    await click('Import a file instead');
    expect(onImport).toHaveBeenCalledTimes(2);
  });

  it('hides import choices when no import callback exists', async () => {
    await render(emptyDraft());
    expect(button('Import a file')).toBeUndefined();
  });
});

describe('ManualRoutineEditor routines', () => {
  it('shows only a routine name per routine and hides code, kind, order and developer copy', async () => {
    await render(initialDraft());
    expect(fieldsByLabel('Routine name')).toHaveLength(1);
    for (const hidden of ['Kind', 'Order', 'Routine code', 'Exercise order', 'Exercise reference']) expect(field(hidden)).toBeFalsy();
    expect(host.textContent).not.toMatch(/Review draft|Add routine variant|New draft exercise|Catalog ·|parent flow/);
  });

  it('validates and reports a ready snapshot, defaulting a blank kind to Custom', async () => {
    const onReady = vi.fn();
    await render({ schemaVersion: 1, variants: [variant({ kind: '  ' })] }, { onReady, primaryLabel: 'Next: Schedule' });
    await type(field('Routine name'), 'Back day');
    await click('Next: Schedule');
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady.mock.calls[0][0].variants[0]).toMatchObject({ code: 'A', name: 'Back day', kind: 'Custom', exercises: [{ ref: { type: 'catalog', id: 'bench' } }] });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('adds routines with the next letter and renumbers on reorder and removal', async () => {
    await render(initialDraft());
    await click('Add another routine');
    await type(fieldsByLabel('Routine name')[1], 'Lower');
    expect(latest.variants.map((v) => v.code)).toEqual(['A', 'B']);
    await click('Move routine B up');
    expect(latest.variants.map((v) => [v.code, v.name])).toEqual([['A', 'Lower'], ['B', 'Upper']]);
    expect(new Set(latest.variants.map((v) => v.order)).size).toBe(2);
    await click('Remove routine Lower');
    expect(latest.variants.map((v) => [v.code, v.name])).toEqual([['A', 'Upper']]);
  });

  it('keeps imported codes on edit and add, and renumbers only when the user reorders', async () => {
    const draft = { schemaVersion: 1, variants: [variant({ code: 'U1', order: 0, name: 'Upper' }), variant({ code: 'L1', order: 1, name: 'Lower' })] };
    await render(draft);
    await type(fieldsByLabel('Routine name')[0], 'Upper body');
    expect(latest.variants.map((v) => v.code)).toEqual(['U1', 'L1']);
    await click('Add another routine');
    expect(latest.variants.map((v) => v.code)).toEqual(['U1', 'L1', 'A']);
    await click('Move routine A up');
    expect(latest.variants.map((v) => v.code)).toEqual(['A', 'B', 'C']);
  });

  it('disables the edge arrows and labels them with the routine code', async () => {
    await render({ schemaVersion: 1, variants: [variant({ order: 0 }), variant({ code: 'B', order: 1, name: 'Lower' })] });
    expect(button('Move routine A up').disabled).toBe(true);
    expect(button('Move routine B down').disabled).toBe(true);
    expect(button('Move routine A down').disabled).toBe(false);
  });

  it('collapses and expands a routine from its header, expanding the newest by default', async () => {
    await render(initialDraft());
    const header = buttons().find((item) => item.getAttribute('aria-expanded') !== null);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.textContent).toContain('Upper');
    expect(header.textContent).toContain('1 exercise');
    await act(async () => header.click());
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(field('Routine name')).toBeFalsy();
    await click('Add another routine');
    expect(fieldsByLabel('Routine name')).toHaveLength(1);
  });
});

describe('ManualRoutineEditor code map', () => {
  it('reports how codes moved on reorder and removal so schedules can follow', async () => {
    const maps = [];
    const calls = [];
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    function Spy() {
      const [current, setCurrent] = useState({ schemaVersion: 1, variants: [variant({ order: 0 }), variant({ code: 'B', order: 1, name: 'Lower' }), variant({ code: 'C', order: 2, name: 'Legs' })] });
      return <ManualRoutineEditor draft={current} catalog={catalog} onChange={(next, map) => { calls.push(map); maps.push(next); setCurrent(next); }} />;
    }
    await act(async () => root.render(<Spy />));
    await click('Move routine B up');
    expect(calls.at(-1)).toEqual({ A: 'B', B: 'A', C: 'C' });
    await click('Remove routine Legs');
    expect(calls.at(-1)).toEqual({ A: 'A', B: 'B', C: null });
    expect(maps.at(-1).variants.map((v) => v.code)).toEqual(['A', 'B']);
  });
});

describe('ManualRoutineEditor exercises', () => {
  it('searches the catalog in a combobox and shows name and muscle', async () => {
    await render(initialDraft());
    const input = host.querySelector('#manual-routine-exercise-0-0-picker');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.value).toBe('Bench Press · Chest');
    await act(async () => { input.focus(); input.click(); });
    expect([...host.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())).toEqual(['Bench Press · Chest', 'Row · Back', 'Incline Curl · Biceps', '+ Create a new exercise']);
    await type(input, 'bic');
    expect([...host.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())).toEqual(['Incline Curl · Biceps', '+ Create a new exercise']);
    await type(input, 'zzz');
    expect(host.textContent).toContain('No matching exercises');
  });

  it('selects a catalog exercise, taking its unit and muscle', async () => {
    await render(initialDraft());
    await pick(0, 'Row · Back');
    expect(latest.variants[0].exercises[0]).toMatchObject({ ref: { type: 'catalog', id: 'row' }, name: 'Row', muscle: 'Back', unit: 'lb' });
  });

  it('creates a new exercise with name and muscle and a draft-local key', async () => {
    const onReady = vi.fn();
    await render(initialDraft(), { onReady, primaryLabel: 'Go' });
    await pick(0, '+ Create a new exercise');
    expect(field('Exercise name')).toBeTruthy();
    expect(field('Muscle')).toBeTruthy();
    await type(field('Exercise name'), 'New move');
    await type(field('Muscle'), 'Back');
    await click('Go');
    const selected = onReady.mock.calls[0][0].variants[0].exercises[0];
    expect(selected).toMatchObject({ ref: { type: 'new' }, name: 'New move', muscle: 'Back', unit: 'kg' });
    expect(selected.ref.key).toMatch(/^manual-/);
  });

  it('warns plainly when a new exercise name matches the catalog', async () => {
    await render(initialDraft());
    await pick(0, '+ Create a new exercise');
    await type(field('Exercise name'), ' bench press ');
    expect(host.querySelector('[role="note"]').textContent).toBe('This exercise already exists in the list. Pick it instead to keep its history together.');
  });

  it('offers readable unit labels based on how each unit is calculated', async () => {
    await render(initialDraft());
    const unit = field('Unit');
    expect([...unit.options].map((o) => [o.value, o.textContent])).toEqual([
      ['kg', 'kg'], ['lb', 'lb'], ['plates', 'Plates (1 plate = 20 kg per side)'],
      ['kgx2', 'kg × 2 (one dumbbell or side, counted twice)'], ['lbx2', 'lb × 2 (one dumbbell or side, counted twice)'],
    ]);
    await type(unit, 'lbx2');
    expect(latest.variants[0].exercises[0].unit).toBe('lbx2');
  });

  it('keeps the legacy x2 unit selectable and labelled', async () => {
    await render({ schemaVersion: 1, variants: [variant({ exercises: [exercise({ unit: 'x2' })] })] });
    const unit = field('Unit');
    expect(unit.value).toBe('x2');
    expect(unit.selectedOptions[0].textContent).toBe('lb × 2 (one dumbbell or side, counted twice)');
  });

  it('reorders exercises with arrows only and appends with Add exercise', async () => {
    const draft = { schemaVersion: 1, variants: [variant({ order: 0, exercises: [exercise({ order: 3 })] })] };
    await render(draft);
    await click('Add exercise');
    await pick(1, 'Row · Back');
    expect(field('Exercise order')).toBeFalsy();
    expect(latest.variants[0].exercises.map((e) => e.order)).toEqual([3, 4]);
    await click('Move exercise 2 up in routine A');
    expect(latest.variants[0].exercises.map((e) => e.name)).toEqual(['Row', 'Bench Press']);
    expect(button('Move exercise 1 up in routine A').disabled).toBe(true);
    await click('Remove exercise Row');
    expect(latest.variants[0].exercises.map((e) => e.name)).toEqual(['Bench Press']);
  });

  it('preserves imported shared new-reference keys and synchronizes edits to the shared definition', async () => {
    const shared = { ref: { type: 'new', key: 'imported-local-key' }, name: 'Rope Pull', order: 4, unit: 'kg', muscle: 'Back' };
    const draft = { schemaVersion: 1, variants: [variant({ order: 0, exercises: [shared] }), variant({ code: 'B', order: 7, name: 'Other', exercises: [{ ...shared, ref: { ...shared.ref }, order: 10 }] })] };
    await render(draft);
    await act(async () => buttons().filter((item) => item.getAttribute('aria-expanded') === 'false')[0]?.click());
    const names = fieldsByLabel('Exercise name');
    await type(names[0], 'Cable Pull');
    expect(latest.variants[1].exercises[0].name).toBe('Cable Pull');
    expect(latest.variants[1].exercises[0].ref.key).toBe('imported-local-key');
  });
});

describe('ManualRoutineEditor validation', () => {
  it('shows inline plain-language errors only after trying to continue, with no codes or paths', async () => {
    const onReady = vi.fn();
    const draft = { schemaVersion: 1, variants: [variant({ name: '', exercises: [{ ref: null, name: '', order: 0, unit: 'kg', muscle: '' }] })] };
    await render(draft, { onReady, primaryLabel: 'Next: Schedule' });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).not.toContain('Give this routine a name.');
    await click('Next: Schedule');
    expect(onReady).not.toHaveBeenCalled();
    const name = field('Routine name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector(`#${name.getAttribute('aria-describedby')}`).textContent).toBe('Give this routine a name.');
    const picker = host.querySelector('#manual-routine-exercise-0-0-picker');
    expect(host.querySelector(`#${picker.getAttribute('aria-describedby')}`).textContent).toBe('Pick an exercise or create a new one.');
    expect(host.querySelector('[role="alert"]').textContent).toBe('Fix the highlighted fields to continue.');
    expect(host.textContent).not.toMatch(/variants\[|missing-|unknown-reference|\(draft\)|issues/);
  });

  it('expands a collapsed routine that has errors and clears errors once fixed', async () => {
    const draft = { schemaVersion: 1, variants: [variant({ name: '' })] };
    await render(draft, { onReady: vi.fn(), primaryLabel: 'Go' });
    const header = buttons().find((item) => item.getAttribute('aria-expanded') !== null);
    await act(async () => header.click());
    await click('Go');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    await type(field('Routine name'), 'Fixed');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('tells the user to add an exercise to an empty routine', async () => {
    await render({ schemaVersion: 1, variants: [variant({ exercises: [] })] }, { onReady: vi.fn(), primaryLabel: 'Go' });
    await click('Go');
    expect(host.textContent).toContain('Add at least one exercise to this routine.');
  });

  it('explains a duplicated exercise next to the picker', async () => {
    const draft = { schemaVersion: 1, variants: [variant({ order: 0, exercises: [exercise({ order: 0 }), exercise({ order: 1 })] })] };
    await render(draft, { onReady: vi.fn(), primaryLabel: 'Go' });
    await click('Go');
    expect(host.textContent).toContain('This exercise is already in this routine.');
  });

  it('keeps the primary action disabled while there are no routines', async () => {
    await render(emptyDraft(), { primaryLabel: 'Go' });
    expect(button('Go').disabled).toBe(true);
  });
});

describe('ManualRoutineEditor purity', () => {
  it('updates frozen controlled inputs immutably without changing catalog or database state', async () => {
    const draft = freeze(initialDraft());
    const frozenCatalog = freeze(JSON.parse(JSON.stringify(catalog)));
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    const onChange = vi.fn();
    await act(async () => root.render(<ManualRoutineEditor draft={draft} catalog={frozenCatalog} onChange={onChange} />));
    await type(field('Routine name'), 'Changed');
    const next = onChange.mock.calls.at(-1)[0];
    expect(next.variants[0].name).toBe('Changed');
    expect(draft.variants[0].name).toBe('Upper');
    expect(frozenCatalog[0]).toMatchObject({ id: 'bench', isBasic: true, standards: [1, 2, 3] });
    expect(await snapshot()).toEqual(seeded);
  });
});
