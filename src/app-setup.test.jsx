// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import App from './App.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const profile = { name: 'Morgan Existing User', sex: 'prefer_not_to_say', age: 18, heightCm: 175, bodyweightKg: 70 };
const draft = { schemaVersion: 1, variants: [{ code: 'Legacy', order: 0, name: 'Existing routine', kind: 'Custom', exercises: [{ ref: { type: 'catalog', id: 'bench' }, name: 'Bench Press', muscle: 'Chest', unit: 'kg', order: 0 }] }] };
const schedule = { mode: 'independent', rotation: ['Legacy'] };
let root, host;
async function mount() {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<App />));
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
}
async function click(label) {
  const buttons = [...host.querySelectorAll('button')];
  const button = buttons.find((item) => item.textContent.trim() === label || item.getAttribute('aria-label') === label)
    ?? buttons.find((item) => item.textContent.trim().includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
async function setField(selector, value) {
  const field = host.querySelector(selector);
  if (!field) throw new Error(`Missing field: ${selector}`);
  await act(async () => {
    const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function fillProfile() {
  await setField('#setup-profile-name', 'Ada Lovelace');
  await setField('#setup-profile-sex', 'female');
  await setField('#setup-profile-age', '31');
  await setField('#setup-profile-heightCm', '168');
  await setField('#setup-profile-bodyweightKg', '62');
}
async function waitFor(predicate) { await vi.waitFor(predicate, { timeout: 4000 }); }
async function prepareExistingUser() {
  await db.profile.update(1, { preferences: { units: 'kg', theme: 'dark' } });
  await useStore.getState().init();
  await useStore.getState().saveSetupProfile(profile);
  await useStore.getState().updateProfile({ setupRequired: false });
  await useStore.getState().init();
}
async function makeCompleteUser() {
  await prepareExistingUser();
  const result = await useStore.getState().applyReviewedRoutine(draft, schedule, { cycleGoal: 6 });
  expect(result.status).toBe('applied');
}
const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])));
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, period: null, allPeriods: [], exercises: [], variants: [], allVariants: [], workouts: [], setsByWorkout: {}, bodyweight: [], prs: {}, setupStatus: null });
  await useStore.getState().init();
  localStorage.removeItem('gymtrack_tab');
});
afterEach(async () => { await unmount(); });

describe('App setup gate and invitation', () => {
  it('keeps first-run gated through profile save and reload, then opens tabs only after mounted real review apply', async () => {
    await db.profile.update(1, { preferences: { units: 'kg', theme: 'dark' } });
    useStore.setState({ loaded: false });
    await mount();
    await waitFor(() => expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeTruthy());
    expect(host.querySelector('button[aria-label="Home"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Cancel"]')).toBeNull();
    expect(host.textContent).not.toMatch(/skip setup|not now/i);
    expect(host.textContent).toContain('Skip for now');
    await fillProfile(); await click('Next: Routine');
    await waitFor(() => expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeTruthy());
    expect(useStore.getState().setupStatus).toBe('first-run-required');
    expect(await db.profile.get(1)).toMatchObject({ setupRequired: true, preferences: { units: 'kg', theme: 'dark' } });
    expect((await db.profile.get(1)).setupComplete).not.toBe(true);
    expect(host.querySelector('button[aria-label="Home"]')).toBeNull();

    await unmount();
    useStore.setState({ loaded: false });
    await mount();
    await waitFor(() => expect(host.querySelector('#setup-profile-name')).toBeTruthy());
    expect(host.querySelector('#setup-profile-name').value).toBe('Ada Lovelace');
    expect(host.querySelector('#setup-profile-age').value).toBe('31');
    expect(host.querySelector('button[aria-label="Home"]')).toBeNull();
    await click('Next: Routine');
    await waitFor(() => expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeTruthy());
    await click('Create from scratch');
    await setField('#manual-routine-variant-0-name', 'Root-gated plan');
    const picker = host.querySelector('#manual-routine-exercise-0-0-picker');
    await act(async () => { picker.focus(); picker.click(); });
    await act(async () => [...host.querySelectorAll('[role="option"]')].find((item) => item.textContent.startsWith('Bench Press')).click());
    await click('Next: Schedule');
    await act(async () => host.querySelector('#schedule-mode-weekly').click());
    await setField('#schedule-week-Mon', 'routine:A');
    await click('Next: Confirm');
    await waitFor(() => expect(host.querySelector('[aria-label="Review your plan"]')).toBeTruthy());
    await click('Start this routine');
    await waitFor(() => expect(host.querySelector('button[aria-label="Home"]')).toBeTruthy());
    expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Your routine is ready');
    await click('Dismiss');
    expect(host.textContent).not.toContain('Your routine is ready');
    expect(useStore.getState().setupStatus).toBe('complete');
    expect(await db.profile.get(1)).toMatchObject({ setupComplete: true, setupRequired: false, setupSkipped: false, preferences: { units: 'kg', theme: 'dark' } });
    expect((await db.routineVariants.toArray()).filter((row) => row.ownerPeriodId === useStore.getState().period.id)).toHaveLength(1);
  });

  it('shows invitation without blocking the app; Not now commits skip and survives reload', async () => {
    await prepareExistingUser();
    expect(useStore.getState().setupStatus).toBe('invite-existing');
    await mount();
    await waitFor(() => expect(host.querySelector('[aria-label="Setup invitation"]')).toBeTruthy());
    expect(host.querySelector('button[aria-label="Home"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Setup wizard"]')).toBeNull();
    const before = await snapshot();
    await click('Not now');
    await waitFor(() => expect(useStore.getState().setupStatus).toBe('skipped'));
    expect(host.querySelector('[aria-label="Setup invitation"]')).toBeNull();
    expect((await db.profile.get(1))).toMatchObject({ setupSkipped: true, preferences: { units: 'kg', theme: 'dark' } });
    const after = await snapshot();
    for (const table of db.tables.map((item) => item.name).filter((name) => name !== 'profile')) expect(after[table]).toEqual(before[table]);
    await unmount(); useStore.setState({ loaded: false }); await mount();
    await waitFor(() => expect(host.querySelector('button[aria-label="Home"]')).toBeTruthy());
    expect(host.querySelector('[aria-label="Setup invitation"]')).toBeNull();
    expect(host.querySelector('[aria-label="Setup wizard"]')).toBeNull();
  });

  it.each(['skipped', 'complete'])('reopens setup from Settings for a %s user and optional close returns to Settings unchanged', async (status) => {
    if (status === 'complete') await makeCompleteUser();
    else { await prepareExistingUser(); await useStore.getState().skipSetup(); }
    localStorage.setItem('gymtrack_tab', 'settings');
    await mount();
    await waitFor(() => expect(host.textContent).toContain('Settings'));
    await click('Set up or change routine');
    await waitFor(() => expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeTruthy());
    expect(host.querySelector('#setup-profile-name').value).toBe(profile.name);
    const beforeCancel = await snapshot();
    await click('Close');
    await waitFor(() => expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeNull());
    expect(host.querySelector('button[aria-label="Settings"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Home"]')).toBeTruthy();
    expect(await snapshot()).toEqual(beforeCancel);
    expect(useStore.getState().setupStatus).toBe(status === 'complete' ? 'complete' : 'invite-existing');
  });

  it('keeps invitation visible with accessible error and retries a failed Not now write', async () => {
    await prepareExistingUser(); await mount();
    await waitFor(() => expect(host.querySelector('[aria-label="Setup invitation"]')).toBeTruthy());
    const before = await snapshot();
    const originalPut = db.profile.put.bind(db.profile);
    db.profile.put = async () => { throw new Error('injected skip write failure'); };
    try {
      await click('Not now');
      await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('injected skip write failure'));
      expect(host.querySelector('[aria-label="Setup invitation"]')).toBeTruthy();
      expect(useStore.getState().setupStatus).toBe('invite-existing');
      expect(await snapshot()).toEqual(before);
    } finally { db.profile.put = originalPut; }
    await click('Not now');
    await waitFor(() => expect(useStore.getState().setupStatus).toBe('skipped'));
    expect(host.querySelector('[aria-label="Setup invitation"]')).toBeNull();
  });

  it('keeps Settings visible with accessible error and retries a failed reopen write', async () => {
    await prepareExistingUser(); await useStore.getState().skipSetup();
    localStorage.setItem('gymtrack_tab', 'settings'); await mount();
    await waitFor(() => expect(host.querySelector('button[aria-label="Settings"]')).toBeTruthy());
    const before = await snapshot();
    const originalPut = db.profile.put.bind(db.profile);
    db.profile.put = async () => { throw new Error('injected reopen write failure'); };
    try {
      await click('Set up or change routine');
      await waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('injected reopen write failure'));
      expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeNull();
      expect(host.querySelector('button[aria-label="Settings"]')).toBeTruthy();
      expect(await snapshot()).toEqual(before);
    } finally { db.profile.put = originalPut; }
    await click('Set up or change routine');
    await waitFor(() => expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeTruthy());
    expect(useStore.getState().setupStatus).toBe('invite-existing');
  });

  describe('first-run skip', () => {
    const dialog = () => host.querySelector('[role="alertdialog"]');
    const mountFirstRun = async () => {
      useStore.setState({ loaded: false });
      await mount();
      await waitFor(() => expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeTruthy());
    };

    it('keeps the user in the wizard when the confirmation is cancelled', async () => {
      await mountFirstRun();
      await click('Skip for now');
      expect(dialog().textContent).toContain('Are you sure you want to continue without setting up your routine?');
      await click('Keep setting up');
      expect(dialog()).toBeNull();
      expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeTruthy();
      expect(host.querySelector('button[aria-label="Home"]')).toBeNull();
      expect(useStore.getState().setupStatus).toBe('first-run-required');
      expect((await db.profile.get(1)).setupSkipped).toBeUndefined();
    });

    it('confirming opens the app shell, survives reload, and the seed routine still renders in Home and Today', async () => {
      await mountFirstRun();
      await click('Skip for now');
      await click('Continue without routine');
      await waitFor(() => expect(host.querySelector('button[aria-label="Home"]')).toBeTruthy());
      expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeNull();
      expect(useStore.getState().setupStatus).toBe('skipped');
      expect(await db.profile.get(1)).toMatchObject({ setupSkipped: true, setupRequired: false });
      expect(host.querySelector('[aria-label="Setup invitation"]')).toBeNull();
      await click('Today');
      await waitFor(() => expect(host.querySelector('button[aria-label="Today"]')).toBeTruthy());
      expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeNull();
      await unmount();
      useStore.setState({ loaded: false });
      await mount();
      await waitFor(() => expect(host.querySelector('button[aria-label="Home"]')).toBeTruthy());
      expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeNull();
    });

    it('lets a skipped seed-only user reopen setup from Settings with a Close button, not Skip', async () => {
      await mountFirstRun();
      await click('Skip for now');
      await click('Continue without routine');
      await waitFor(() => expect(host.querySelector('button[aria-label="Settings"]')).toBeTruthy());
      await click('Settings');
      await waitFor(() => expect(host.textContent).toContain('Set up or change routine'));
      await click('Set up or change routine');
      await waitFor(() => expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeTruthy());
      expect(host.textContent).not.toContain('Skip for now');
      await click('Close');
      await waitFor(() => expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeNull());
      expect(host.querySelector('button[aria-label="Settings"]')).toBeTruthy();
    });

    it('shows an error and stays in the wizard when persisting the skip fails', async () => {
      await mountFirstRun();
      await click('Skip for now');
      const originalPut = db.profile.put.bind(db.profile);
      db.profile.put = async () => { throw new Error('injected skip write failure'); };
      try {
        await click('Continue without routine');
        await waitFor(() => expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain('injected skip write failure'));
        expect(host.querySelector('main[aria-label="Setup wizard"]')).toBeTruthy();
        expect(host.querySelector('button[aria-label="Home"]')).toBeNull();
        expect(useStore.getState().setupStatus).toBe('first-run-required');
      } finally { db.profile.put = originalPut; }
      await click('Continue without routine');
      await waitFor(() => expect(host.querySelector('button[aria-label="Home"]')).toBeTruthy());
    });
  });
});
