// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import ManualRoutineEditor from './screens/ManualRoutineEditor.jsx';
import RoutineImport from './screens/RoutineImport.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const catalog = [{ id: 'squat', name: 'Squat', unit: 'kg', muscle: 'Legs', isBasic: true, standards: [1, 2, 3] }];
const existingDraft = { schemaVersion: 1, variants: [{ code: 'Local', order: 0, name: 'My local routine', kind: 'Custom', exercises: [{ ref: { type: 'catalog', id: 'squat' }, name: 'Squat', order: 0, unit: 'kg', muscle: 'Legs' }] }] };
const importedDraft = { schemaVersion: 1, variants: [{ code: 'Imported', order: 0, name: 'Imported plan', kind: 'Any display kind', exercises: [{ ref: { type: 'catalog', id: 'squat' }, name: 'Squat', order: 0, unit: 'lb', muscle: 'Legs' }] }] };
let root, host, seeded;
async function mount(node) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(node));
}
async function chooseFile(file) {
  const input = host.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function clickButton(name) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent.trim() === name || item.getAttribute('aria-label') === name);
  if (!button) throw new Error(`Missing button: ${name}`);
  await act(async () => button.click());
}
const routineName = () => {
  const label = [...host.querySelectorAll('label')].find((item) => item.textContent.trim() === 'Routine name');
  return host.querySelector(`#${label.htmlFor}`).value;
};
async function waitForText(text) {
  await vi.waitFor(() => expect(host.textContent).toContain(text));
}
const textFile = (name, text) => ({ name, text: async () => text });
const tableSnapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
function ControlledFlow({ onDecoded, catalog: exercises = catalog }) {
  const [draft, setDraft] = useState(existingDraft);
  return <><RoutineImport catalog={exercises} onDecoded={(next) => { onDecoded(next); setDraft(next); }} /><ManualRoutineEditor draft={draft} catalog={exercises} onChange={setDraft} /></>;
}
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, bodyweight: [], prs: {}, workouts: [], setsByWorkout: {}, allPeriods: [], exercises: [], variants: [] });
  await useStore.getState().init();
  seeded = await tableSnapshot();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
});

describe('RoutineImport local handoff', () => {
  it('uses plain copy: file-read hint, no developer jargon, and a preview count', async () => {
    await mount(<RoutineImport catalog={catalog} onDecoded={vi.fn()} />);
    expect(host.textContent).toContain('Import a routine file');
    expect(host.textContent).toContain('Your file is read on this device and nothing is saved until you confirm.');
    expect(host.textContent).not.toMatch(/parent flow|handoff|hand-off|draft/i);
    await chooseFile(textFile('routine.csv', 'Code,Name,Kind,Exercise,Muscle,Unit\nImported,Imported plan,Any display kind,Squat,Legs,lb'));
    await waitForText('1 routine found');
    expect(host.textContent).toContain('Imported plan');
    expect(host.textContent).not.toMatch(/Any display kind|Imported ·|Preview ·/);
    expect(host.textContent).not.toMatch(/handed|handoff|draft/i);
  });

  it('previews actual CSV decode and changes the controlled manual editor only after explicit handoff', async () => {
    const onDecoded = vi.fn();
    await mount(<ControlledFlow onDecoded={onDecoded} />);
    const before = await tableSnapshot();
    await chooseFile(textFile('routine.csv', 'Code,Name,Kind,Exercise,Muscle,Unit\nImported,Imported plan,Any display kind,Squat,Legs,lb'));
    await waitForText('Imported plan');
    expect(routineName()).toBe('My local routine');
    expect(onDecoded).not.toHaveBeenCalled();
    expect(host.textContent).toContain('lb');
    await clickButton('Use this routine');
    expect(onDecoded).toHaveBeenCalledOnce();
    expect(routineName()).toBe('Imported plan');
    expect(await tableSnapshot()).toEqual(before);
    expect(useStore.getState().profile).toEqual(seeded.profile[0]);
  });

  it('shows invalid and unsupported-file errors without replacing the parent draft', async () => {
    const onDecoded = vi.fn();
    await mount(<ControlledFlow onDecoded={onDecoded} />);
    const before = await tableSnapshot();
    await chooseFile(textFile('bad.json', '{bad json'));
    await waitForText('We could not read this file.');
    expect(host.textContent).not.toMatch(/file-decode-error|decode-error|\$\.|rows\[/);
    expect(routineName()).toBe('My local routine');
    await chooseFile(textFile('backup.zip', 'ignored'));
    await waitForText('This file type is not supported. Use CSV, JSON, XLSX or XLS.');
    expect(host.textContent).not.toContain('unsupported-format');
    expect(routineName()).toBe('My local routine');
    expect(onDecoded).not.toHaveBeenCalled();
    expect(await tableSnapshot()).toEqual(before);
  });

  it('requires an exact sheet choice, retries the same workbook, and hands off only after confirmation', async () => {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    for (const name of ['  Día α  ', '二 階']) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Code', 'Name', 'Kind', 'Exercise', 'Muscle', 'Unit'], ['S', name, 'Custom', 'Squat', 'Legs', 'kg']]), name);
    const bytes = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }));
    const selectedCalls = [];
    const sameFile = { name: 'routines.xlsx', arrayBuffer: async () => { selectedCalls.push(sameFile); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
    const onDecoded = vi.fn();
    await mount(<ControlledFlow onDecoded={onDecoded} />);
    await chooseFile(sameFile);
    await waitForText('This file has several sheets. Which one has your routine?');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('  Día α  ');
    expect(host.textContent).toContain('二 階');
    expect(onDecoded).not.toHaveBeenCalled();
    await clickButton('Use sheet   Día α  ');
    await waitForText('Día α');
    expect(selectedCalls).toHaveLength(2);
    expect(selectedCalls[0]).toBe(sameFile);
    expect(selectedCalls[1]).toBe(sameFile);
    expect(routineName()).toBe('My local routine');
    await clickButton('Use this routine');
    expect(onDecoded).toHaveBeenCalledOnce();
    expect(onDecoded.mock.calls[0][0].variants[0].name).toBe('Día α');
  });

  it('ignores a slower older decode after a newer file is selected', async () => {
    let resolveA, resolveB;
    const a = { name: 'a.csv', text: () => new Promise((resolve) => { resolveA = resolve; }) };
    const b = { name: 'b.csv', text: () => new Promise((resolve) => { resolveB = resolve; }) };
    const onDecoded = vi.fn();
    await mount(<RoutineImport catalog={catalog} onDecoded={onDecoded} />);
    await chooseFile(a);
    await chooseFile(b);
    await act(async () => resolveB('Code,Name,Exercise,Muscle\nB,Newer,Squat,Legs'));
    await waitForText('Newer');
    await act(async () => resolveA('Code,Name,Exercise,Muscle\nA,Older,Squat,Legs'));
    expect(host.textContent).toContain('Newer');
    expect(host.textContent).not.toContain('Older');
    await clickButton('Use this routine');
    expect(onDecoded.mock.calls[0][0].variants[0].name).toBe('Newer');
  });

  it('cancels pending import and ignores its late completion without handoff', async () => {
    let resolve;
    const pending = { name: 'pending.csv', text: () => new Promise((done) => { resolve = done; }) };
    const onDecoded = vi.fn(), onCancel = vi.fn();
    await mount(<RoutineImport catalog={catalog} onDecoded={onDecoded} onCancel={onCancel} />);
    const before = await tableSnapshot();
    await chooseFile(pending);
    await clickButton('Cancel');
    await act(async () => resolve('Code,Name,Exercise,Muscle\nA,Late,Squat,Legs'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onDecoded).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Late');
    expect(await tableSnapshot()).toEqual(before);
  });

  it('invalidates a candidate when catalog changes, then retries the retained file against the new catalog', async () => {
    const file = textFile('candidate.json', JSON.stringify(importedDraft));
    const onDecoded = vi.fn();
    await mount(<RoutineImport catalog={catalog} onDecoded={onDecoded} />);
    await chooseFile(file);
    await waitForText('Imported plan');
    await act(async () => root.render(<RoutineImport catalog={[]} onDecoded={onDecoded} />));
    expect([...host.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Use this routine')?.disabled ?? true).toBe(true);
    expect(onDecoded).not.toHaveBeenCalled();
    await clickButton('Check again with the updated list');
    await waitForText('An exercise could not be matched with the exercise list.');
    expect(host.textContent).not.toContain('unknown-reference');
    expect(onDecoded).not.toHaveBeenCalled();
  });

  it('ignores completion after unmount', async () => {
    let resolve;
    const pending = { name: 'unmount.csv', text: () => new Promise((done) => { resolve = done; }) };
    const onDecoded = vi.fn();
    await mount(<RoutineImport catalog={catalog} onDecoded={onDecoded} />);
    await chooseFile(pending);
    await act(async () => root.unmount());
    root = null;
    await act(async () => resolve('Code,Name,Exercise,Muscle\nA,Late,Squat,Legs'));
    expect(onDecoded).not.toHaveBeenCalled();
  });
});
