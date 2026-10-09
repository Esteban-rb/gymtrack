// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import SetupWizard from './screens/SetupWizard.jsx';
import { I18nProvider } from './i18n.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const profile = { name: 'Ada Lovelace', sex: 'female', age: 31, heightCm: 168, bodyweightKg: 62 };
let root, host, originalSaveProfile, originalApply, originalSkip;
async function mount(props = {}) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<SetupWizard {...props} />));
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
  await setField('#setup-profile-name', profile.name);
  await setField('#setup-profile-sex', profile.sex);
  await setField('#setup-profile-age', String(profile.age));
  await setField('#setup-profile-heightCm', String(profile.heightCm));
  await setField('#setup-profile-bodyweightKg', String(profile.bodyweightKg));
}
async function enterEditor({ fillBlank = false } = {}) {
  if (fillBlank) await fillProfile();
  await click('Next: Routine');
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeTruthy());
}
const routineNameField = (index = 0) => {
  const label = [...host.querySelectorAll('label')].filter((item) => item.textContent.trim() === 'Routine name')[index];
  return label ? `#${label.htmlFor}` : null;
};
async function pickExercise(optionText, routine = 0, index = 0) {
  const input = host.querySelector(`#manual-routine-exercise-${routine}-${index}-picker`);
  await act(async () => { input.focus(); input.click(); });
  const option = [...host.querySelectorAll('[role="option"]')].find((item) => item.textContent.trim() === optionText);
  await act(async () => option.click());
}
async function buildManualRoutine({ name = 'Wizard upper' } = {}) {
  await click('Create from scratch');
  await setField(routineNameField(), name);
  await pickExercise('Bench Press · Chest');
}
async function enterReview(code = 'A') {
  await click('Next: Schedule');
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Schedule editor"]')).toBeTruthy());
  await act(async () => host.querySelector('#schedule-mode-weekly').click());
  await setField('#schedule-week-Mon', `routine:${code}`);
  await click('Next: Confirm');
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Review your plan"]')).toBeTruthy());
}
async function saveRealProfile() {
  await useStore.getState().saveSetupProfile(profile);
}
async function startWizardWithPartial({ onComplete } = {}) {
  await saveRealProfile();
  const period = useStore.getState().period;
  const workout = {
    periodId: period.id, date: '2000-01-01', cycle: 1, variant: 'U1', finished: false,
    block: 'Saved old-session block', entries: [
      { exerciseId: 'bench', name: 'Saved bench snapshot', muscle: 'Chest', unit: 'kg', note: 'keep snapshot' },
      { exerciseId: 'incline-press', name: 'Saved incline snapshot', muscle: 'Chest', unit: 'kg' },
    ], snapshot: { source: 'old-history' },
  };
  workout.id = await db.workouts.add(workout);
  const set = { workoutId: workout.id, exerciseId: 'bench', n: 1, reps: 8, value: 45, unit: 'kg', realKg: 45 };
  set.id = await db.sets.add(set);
  await useStore.getState().init();
  await mount({ onComplete });
  await enterEditor();
  await buildManualRoutine();
  await enterReview();
  return { period, workout, set };
}
async function chooseFile(file) {
  const input = host.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
const textFile = (name, text) => ({ name, text: async () => text });
const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])));
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, bodyweight: [], prs: {}, workouts: [], setsByWorkout: {}, allPeriods: [], exercises: [], variants: [], allVariants: [], activeVariant: null, scheduleView: null });
  await useStore.getState().init();
  originalSaveProfile = useStore.getState().saveSetupProfile;
  originalApply = useStore.getState().applyReviewedRoutine;
  originalSkip = useStore.getState().skipSetup;
});
afterEach(async () => {
  await unmount();
  useStore.setState({ saveSetupProfile: originalSaveProfile, applyReviewedRoutine: originalApply, skipSetup: originalSkip });
});

describe('SetupWizard composition', () => {
  it('omits incomplete seed defaults but preserves a complete real age-18/body-70 profile', async () => {
    await mount();
    expect(host.querySelector('#setup-profile-name').value).toBe('');
    expect(host.querySelector('#setup-profile-sex').value).toBe('');
    expect(host.querySelector('#setup-profile-age').value).toBe('');
    expect(host.querySelector('#setup-profile-heightCm').value).toBe('');
    expect(host.querySelector('#setup-profile-bodyweightKg').value).toBe('');
    await unmount();
    await useStore.getState().saveSetupProfile({ name: 'Real Seed-valued Adult', sex: 'other', age: 18, heightCm: 175, bodyweightKg: 70 });
    await useStore.getState().init();
    await mount();
    expect(host.querySelector('#setup-profile-name').value).toBe('Real Seed-valued Adult');
    expect(host.querySelector('#setup-profile-sex').value).toBe('other');
    expect(host.querySelector('#setup-profile-age').value).toBe('18');
    expect(host.querySelector('#setup-profile-heightCm').value).toBe('175');
    expect(host.querySelector('#setup-profile-bodyweightKg').value).toBe('70');
  });

  it('runs profile → blank manual draft → weekly schedule → real apply and awaits committed onComplete', async () => {
    const onComplete = vi.fn(async (result) => {
      expect(result.status).toBe('applied');
      expect(await db.profile.get(1)).toMatchObject({ setupComplete: true, setupRequired: false });
      expect((await db.routineVariants.toArray()).filter((variant) => variant.ownerPeriodId === result.period.id)).toHaveLength(1);
      expect(result.period.trainingSchedule).toMatchObject({ mode: 'weekly' });
    });
    await mount({ onComplete });
    await enterEditor({ fillBlank: true });
    expect(host.querySelectorAll('[aria-label^="Manual routine editor"] article')).toHaveLength(0);
    expect(host.textContent).not.toContain('Upper 1');
    await buildManualRoutine();
    await enterReview();
    expect(host.textContent).toContain('Wizard upper');
    await click('Start this routine');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(host.textContent).toContain("You're all set");
    expect(useStore.getState().profile).toMatchObject({ setupComplete: true, setupRequired: false });
  });

  it('jumps from Confirm back to a step via Edit with draft and schedule preserved', async () => {
    await saveRealProfile(); await useStore.getState().init(); await mount(); await enterEditor();
    await buildManualRoutine(); await enterReview();
    await click('Edit Schedule');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Schedule editor"]')).toBeTruthy());
    await click('Next: Confirm');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Review your plan"]')).toBeTruthy());
    await click('Edit Routine');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeTruthy());
    expect(host.textContent).toContain('Wizard upper');
    await click('Next: Schedule');
    await click('Next: Confirm');
    await click('Edit Profile');
    await vi.waitFor(() => expect(host.querySelector('#setup-profile-name')).toBeTruthy());
    expect(host.querySelector('#setup-profile-name').value).toBe(profile.name);
  });

  it('shows a plain summary on the complete step', async () => {
    const onClose = vi.fn();
    await saveRealProfile(); await useStore.getState().init(); await mount({ onClose });
    await enterEditor(); await buildManualRoutine(); await enterReview();
    await click('Start this routine');
    await vi.waitFor(() => expect(host.querySelector('h1').textContent).toBe("You're all set"));
    expect(host.querySelector('[role="status"]').textContent).toContain('1 routine');
    expect(host.textContent).toContain('cycles');
  });

  it('preserves manual draft through invalid/cancelled CSV import and replaces it only after confirming', async () => {
    await saveRealProfile(); await useStore.getState().init(); await mount(); await enterEditor();
    await buildManualRoutine({ name: 'Local work in progress' });
    await click('Import a file instead');
    await chooseFile(textFile('bad.json', '{broken'));
    await vi.waitFor(() => expect(host.textContent).toContain('We could not read this file.'));
    expect(host.textContent).not.toContain('file-decode-error');
    const before = await snapshot();
    await click('Back');
    expect(host.querySelector(routineNameField()).value).toBe('Local work in progress');
    expect(await snapshot()).toEqual(before);
    await click('Import a file instead');
    await chooseFile(textFile('routine.csv', 'Code,Name,Kind,Exercise,Muscle,Unit\nImported,Imported plan,Custom,Bench Press,Chest,lb'));
    await vi.waitFor(() => expect(host.textContent).toContain('1 routine found'));
    expect(host.querySelector('[aria-label="Import a routine file"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeNull();
    const importBefore = await snapshot();
    await click('Use this routine');
    const dialog = host.querySelector('[role="alertdialog"]');
    expect(dialog.textContent).toContain('Replace your current routine with the imported one?');
    expect(document.activeElement.textContent).toBe('Keep current');
    await click('Keep current');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelector(routineNameField()).value).toBe('Local work in progress');
    await click('Import a file instead');
    await chooseFile(textFile('routine.csv', 'Code,Name,Kind,Exercise,Muscle,Unit\nImported,Imported plan,Custom,Bench Press,Chest,lb'));
    await vi.waitFor(() => expect(host.textContent).toContain('1 routine found'));
    await click('Use this routine');
    await click('Replace');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelector(routineNameField()).value).toBe('Imported plan');
    await setField(routineNameField(), 'Edited after import');
    expect(host.querySelector(routineNameField()).value).toBe('Edited after import');
    expect(await snapshot()).toEqual(importBefore);
  });

  it('imports into an empty draft without asking for confirmation', async () => {
    await saveRealProfile(); await useStore.getState().init(); await mount(); await enterEditor();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await click('Import a file');
    expect(host.querySelector('h1').textContent).toBe('Import a routine file');
    await chooseFile(textFile('routine.csv', 'Code,Name,Kind,Exercise,Muscle,Unit\nImported,Imported plan,Custom,Bench Press,Chest,lb'));
    await vi.waitFor(() => expect(host.textContent).toContain('1 routine found'));
    await click('Use this routine');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelector(routineNameField()).value).toBe('Imported plan');
  });

  it('shows plain inline errors after Next on an incomplete routine and never moves on', async () => {
    await saveRealProfile(); await useStore.getState().init(); await mount(); await enterEditor();
    await click('Create from scratch');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await click('Next: Schedule');
    expect(host.querySelector('[aria-label="Schedule editor"]')).toBeNull();
    expect(host.querySelector('[role="alert"]').textContent).toBe('Fix the highlighted fields to continue.');
    expect(host.textContent).toContain('Give this routine a name.');
    expect(host.textContent).toContain('Pick an exercise or create a new one.');
    expect(host.textContent).not.toMatch(/variants\[|missing-|unknown-reference/);
  });

  it('keeps the built schedule pointing at the same routines when routines are reordered or removed', async () => {
    await saveRealProfile(); await useStore.getState().init(); await mount(); await enterEditor();
    await buildManualRoutine({ name: 'Upper' });
    await click('Add another routine');
    await setField(routineNameField(1), 'Lower');
    await pickExercise('Hack Squat · Quads', 1, 0);
    await click('Next: Schedule');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Schedule editor"]')).toBeTruthy());
    await act(async () => host.querySelector('#schedule-mode-weekly').click());
    await setField('#schedule-week-Mon', 'routine:A');
    await setField('#schedule-week-Tue', 'routine:B');
    await click('Back');
    await click('Move routine A down');
    await click('Next: Schedule');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Schedule editor"]')).toBeTruthy());
    expect(host.querySelector('#schedule-week-Mon').value).toBe('routine:B');
    expect(host.querySelector('#schedule-week-Tue').value).toBe('routine:A');
    await click('Back');
    await click('Remove routine Lower');
    await click('Next: Schedule');
    expect(host.querySelector('#schedule-week-Mon').value).toBe('routine:A');
    expect(host.querySelector('#schedule-week-Tue').value).toBe('slot:rest');
    expect(host.textContent).not.toContain('Unavailable routine');
  });

  it('finishes the exact old pinned session in Today, returns only on its committed finish, then applies with history intact', async () => {
    const onComplete = vi.fn();
    const { period, workout, set } = await startWizardWithPartial({ onComplete });
    const before = await snapshot();
    await act(async () => host.querySelector('input[type="radio"][value="finish"]').click());
    await click('Finish the workout first');
    expect(host.textContent).toContain('Pinned session · cycle');
    expect(host.textContent).toContain('Saved old-session block');
    expect(host.textContent).toContain('Saved bench snapshot');
    expect(await db.workouts.get(workout.id)).toEqual(workout);
    expect(await db.profile.get(1)).toEqual(before.profile[0]);
    await click('Add set'); await click('Log set');
    expect(await db.sets.where('workoutId').equals(workout.id).count()).toBe(2);
    expect(await db.workouts.get(workout.id)).toMatchObject({ finished: false, snapshot: { source: 'old-history' } });
    expect(host.querySelector('[aria-label="Review your plan"]')).toBeNull();
    await click('Finish & advance');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Review your plan"]')).toBeTruthy());
    expect(onComplete).not.toHaveBeenCalled();
    const finished = await db.workouts.get(workout.id);
    expect(finished).toEqual({ ...workout, finished: true });
    expect(await db.sets.get(set.id)).toEqual(set);
    expect(await db.sets.where('workoutId').equals(workout.id).count()).toBe(2);
    expect(useStore.getState().period.id).toBe(period.id);
    await click('Start this routine');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(await db.workouts.get(workout.id)).toEqual(finished);
    expect(await db.sets.get(set.id)).toEqual(set);
    expect(await db.periods.get(period.id)).toMatchObject({ status: 'archived' });
    expect(onComplete.mock.calls[0][0].period.id).not.toBe(period.id);
  });

  it('keeps continuation after a real database finish failure, then retries and applies with draft intact', async () => {
    const onComplete = vi.fn();
    const { workout } = await startWizardWithPartial({ onComplete });
    await act(async () => host.querySelector('input[type="radio"][value="finish"]').click());
    await click('Finish the workout first');
    const beforeFailure = await snapshot();
    const originalPut = db.workouts.put.bind(db.workouts);
    db.workouts.put = async (row, ...rest) => {
      if (row?.id === workout.id && row.finished) throw new Error('injected actual finish failure');
      return originalPut(row, ...rest);
    };
    try {
      await click('Finish & advance');
      await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not finish session'));
      expect(host.textContent).toContain('Pinned session · cycle');
      expect(host.textContent).toContain('injected actual finish failure');
      expect(onComplete).not.toHaveBeenCalled();
      expect(await db.workouts.get(workout.id)).toMatchObject({ finished: false });
      expect(await snapshot()).toEqual(beforeFailure);
      expect(await db.profile.get(1)).not.toMatchObject({ setupComplete: true });
    } finally { db.workouts.put = originalPut; }
    await click('Finish & advance');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Review your plan"]')).toBeTruthy());
    expect(host.textContent).toContain('Wizard upper');
    expect(host.textContent).toContain('Monday: A');
    expect(host.querySelector('#review-cycle-goal')).toBeNull();
    expect(host.textContent).toContain('6 cycles');
    await click('Start this routine');
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(host.textContent).toContain("You're all set");
  });

  it.each(['missing-row', 'changed-active-period'])('fails closed for %s pin without creating or finishing another workout', async (kind) => {
    const { period, workout } = await startWizardWithPartial();
    await act(async () => host.querySelector('input[type="radio"][value="finish"]').click());
    await click('Finish the workout first');
    if (kind === 'missing-row') await db.workouts.delete(workout.id);
    else {
      await db.periods.update(period.id, { status: 'archived' });
      const { id: _id, ...periodData } = period;
      await db.periods.add({ ...periodData, startDate: '2026-01-05', status: 'active' });
    }
    await useStore.getState().init();
    await vi.waitFor(() => expect(host.textContent).toContain('Pinned session unavailable'));
    expect(host.querySelector('button[aria-label="change variant"]')).toBeNull();
    expect(host.textContent).not.toContain('Finish & advance');
    expect(host.textContent).not.toContain('Log first set');
    const unavailableSnapshot = await snapshot();
    const count = unavailableSnapshot.workouts.length;
    await click('Back to review');
    expect(host.querySelector('[aria-label="Review your plan"]')).toBeTruthy();
    expect((await db.workouts.toArray()).length).toBe(count);
    if (kind === 'changed-active-period') expect(await db.workouts.get(workout.id)).toEqual(workout);
    expect(await db.profile.get(1)).not.toMatchObject({ setupComplete: true });
  });

  it('keeps navigation disabled during a pending real-child save and exposes no external bypass', async () => {
    let release;
    const save = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    useStore.setState({ saveSetupProfile: save });
    const onClose = vi.fn();
    await mount({ onClose }); await fillProfile();
    await click('Next: Routine');
    expect(buttonNamed('Next: Routine').disabled).toBe(true);
    expect(buttonNamed('Close').disabled).toBe(true);
    expect(buttonNamed('Back')).toBeUndefined();
    await act(async () => buttonNamed('Close').click());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => release({ id: 1, ...profile, setupRequired: true }));
    expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Back disabled while the reviewed routine is being applied', async () => {
    let release;
    const apply = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    useStore.setState({ applyReviewedRoutine: apply });
    await saveRealProfile(); await useStore.getState().init(); await mount(); await enterEditor();
    await buildManualRoutine(); await enterReview();
    await click('Start this routine');
    expect(buttonNamed('Back').disabled).toBe(true);
    expect(buttonNamed('Starting…').disabled).toBe(true);
    await act(async () => release({ status: 'cancelled' }));
    expect(buttonNamed('Back').disabled).toBe(false);
  });
});

const buttonNamed = (name) => [...host.querySelectorAll('button')].find((item) => item.textContent.trim() === name);

describe('SetupWizard shell', () => {
  it('shows one h1 per step, a stepper with aria-current, and no duplicate setup title', async () => {
    await mount();
    expect(host.querySelector('h1').textContent).toBe('Your profile');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.textContent).not.toContain('Set up your training');
    expect(host.textContent).not.toMatch(/Setup ·/);
    expect(host.textContent).toContain('Step 1 of 4');
    const items = [...host.querySelectorAll('nav[aria-label="Setup progress"] ol > li')];
    expect(items.map((item) => item.textContent.replace(/\s*\(.*\)$/, '').trim().replace(/^[0-9✓]+/, '').trim())).toEqual(['Profile', 'Routine', 'Schedule', 'Confirm']);
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual(['step', null, null, null]);
    expect(host.textContent).not.toContain('Saving your profile does not complete routine setup');
    expect(host.textContent).not.toContain('Routine setup is a separate step');
    expect(buttonNamed('Back')).toBeUndefined();
  });

  it('lets the schedule step pick the cycle goal and applies it, with no goal selector on Confirm', async () => {
    await saveRealProfile(); await useStore.getState().init(); await mount(); await enterEditor();
    await buildManualRoutine();
    await click('Next: Schedule');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Schedule editor"]')).toBeTruthy());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => host.querySelector('#schedule-mode-weekly').click());
    expect([...host.querySelectorAll('#schedule-week-Mon option')].map((o) => o.textContent)).toContain('A · Wizard upper');
    await setField('#schedule-week-Mon', 'routine:A');
    await click('7');
    await click('Next: Confirm');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Review your plan"]')).toBeTruthy());
    expect(host.querySelector('#review-cycle-goal')).toBeNull();
    expect(host.textContent).toContain('7 cycles');
    await click('Start this routine');
    await vi.waitFor(() => expect(useStore.getState().period.cycleGoal).toBe(7));
  });

  it('walks Profile → Routine → Schedule → Confirm with a consistent bar and Back at every step', async () => {
    await saveRealProfile(); await useStore.getState().init(); await mount();
    await click('Next: Routine');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeTruthy());
    expect(host.querySelector('h1').textContent).toBe('Your routine');
    expect(host.textContent).toContain('Step 2 of 4');
    expect(host.querySelector('nav[aria-label="Setup progress"] li[aria-current="step"]').textContent).toContain('Routine');
    await buildManualRoutine();
    await click('Next: Schedule');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Schedule editor"]')).toBeTruthy());
    expect(host.querySelector('h1').textContent).toBe('When do you train?');
    expect(host.textContent).toContain('Step 3 of 4');
    await click('Back');
    expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeTruthy();
    expect(host.querySelector(routineNameField()).value).toBe('Wizard upper');
    await click('Back');
    expect(host.querySelector('h1').textContent).toBe('Your profile');
    expect(host.querySelector('#setup-profile-name').value).toBe(profile.name);
    await click('Next: Routine');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Manual routine editor"]')).toBeTruthy());
    await click('Next: Schedule');
    await act(async () => host.querySelector('#schedule-mode-weekly').click());
    await setField('#schedule-week-Mon', 'routine:A');
    await click('Next: Confirm');
    await vi.waitFor(() => expect(host.querySelector('[aria-label="Review your plan"]')).toBeTruthy());
    expect(host.querySelector('h1').textContent).toBe('Confirm and start');
    expect(host.textContent).toContain('Step 4 of 4');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(buttonNamed('Cancel review')).toBeUndefined();
    await click('Back');
    expect(host.querySelector('[aria-label="Schedule editor"]')).toBeTruthy();
  });

  it('keeps the profile step blocked when Next is pressed with an invalid profile', async () => {
    await mount();
    await click('Next: Routine');
    expect(host.querySelector('#setup-profile-name')).toBeTruthy();
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('shows no stepper on the complete step and a Done button for optional wizards', async () => {
    const onClose = vi.fn();
    await saveRealProfile(); await useStore.getState().init(); await mount({ onClose });
    await enterEditor(); await buildManualRoutine(); await enterReview();
    await click('Start this routine');
    await vi.waitFor(() => expect(host.textContent).toContain("You're all set"));
    expect(host.querySelector('nav[aria-label="Setup progress"]')).toBeNull();
    expect(host.querySelector('h1').textContent).toBe("You're all set");
    await click('Done');
    expect(onClose).toHaveBeenCalled();
  });

  it('centers content in a 520px container and keeps cards out of the shell', async () => {
    await mount();
    const container = host.querySelector('main > div');
    expect(container.style.maxWidth).toBe('520px');
    expect(host.querySelector('main').className).not.toContain('gt-card');
    expect(host.querySelector('form').className).not.toContain('gt-card');
  });

  it('renders Spanish shell copy when the provider locale is es and sets html lang', async () => {
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    await act(async () => root.render(<I18nProvider locale="es"><SetupWizard /></I18nProvider>));
    expect(host.querySelector('h1').textContent).toBe('Tu perfil');
    expect(host.textContent).toContain('Paso 1 de 4');
    expect(buttonNamed('Siguiente: Rutina')).toBeTruthy();
    expect(buttonNamed('Omitir por ahora')).toBeTruthy();
    expect(host.querySelector('label[for="setup-profile-name"]').textContent).toBe('Nombre');
    expect(document.documentElement.lang).toBe('es');
  });

  it('renders the routine step in Spanish with natural copy', async () => {
    await saveRealProfile(); await useStore.getState().init();
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    await act(async () => root.render(<I18nProvider locale="es"><SetupWizard /></I18nProvider>));
    await click('Siguiente: Rutina');
    await vi.waitFor(() => expect(host.querySelector('h1').textContent).toBe('Tu rutina'));
    expect(host.querySelector('button[aria-label="Crear desde cero"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="Importar un archivo"]')).toBeTruthy();
    await click('Crear desde cero');
    expect(host.querySelector('input[placeholder="Día de empuje"]')).toBeTruthy();
    expect(buttonNamed('Añadir otra rutina')).toBeTruthy();
    expect(host.textContent).toContain('Añadir ejercicio');
  });
});

describe('SetupWizard first-run skip', () => {
  const dialog = () => host.querySelector('[role="alertdialog"]');
  it('offers Skip for now only when the wizard cannot be closed', async () => {
    await mount();
    expect(buttonNamed('Skip for now')).toBeTruthy();
    expect(buttonNamed('Close')).toBeUndefined();
    await unmount();
    await mount({ onClose: vi.fn() });
    expect(buttonNamed('Skip for now')).toBeUndefined();
    expect(buttonNamed('Close')).toBeTruthy();
  });

  it('opens an accessible confirmation, moves focus into it, and Escape or Keep setting up cancels', async () => {
    const skip = vi.fn();
    useStore.setState({ skipSetup: skip });
    await mount();
    await click('Skip for now');
    expect(dialog()).toBeTruthy();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().textContent).toContain('Are you sure you want to continue without setting up your routine?');
    expect(dialog().contains(document.activeElement)).toBe(true);
    await act(async () => dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(dialog()).toBeNull();
    expect(host.querySelector('#setup-profile-name')).toBeTruthy();
    await click('Skip for now');
    await click('Keep setting up');
    expect(dialog()).toBeNull();
    expect(skip).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(buttonNamed('Skip for now'));
  });

  it('confirming persists the skip for a seed-only first-run user', async () => {
    await mount();
    await click('Skip for now');
    await click('Continue without routine');
    await vi.waitFor(() => expect(useStore.getState().setupStatus).toBe('skipped'));
    expect(await db.profile.get(1)).toMatchObject({ setupSkipped: true });
  });

  it('shows an error and stays in the wizard when saving the skip fails', async () => {
    useStore.setState({ skipSetup: vi.fn(async () => { throw new Error('injected skip failure'); }) });
    await mount();
    await click('Skip for now');
    await click('Continue without routine');
    await vi.waitFor(() => expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('injected skip failure'));
    expect(dialog()).toBeTruthy();
    expect(buttonNamed('Continue without routine').disabled).toBe(false);
  });
});
