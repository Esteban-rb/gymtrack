// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import SetupWizard from './screens/SetupWizard.jsx';
import { I18nProvider, translate } from './i18n.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const es = (key, params) => translate('es', key, params);
let root, host;

// Representative English UI strings that must never show up in the Spanish UI.
const ENGLISH = [
  /\bNext\b/, /\bBack\b/, /\bSkip for now\b/, /\bStep \d/, /\bProfile\b/, /\bRoutine\b/, /\bSchedule\b/, /\bConfirm\b/,
  /\bName\b/, /\bAge\b/, /\bHeight\b/, /\bRest\b/, /\bMonday\b/, /\bcycles\b/, /\bEdit\b/, /\bAdd exercise\b/,
  /\bCreate from scratch\b/, /\bImport a file\b/, /\bFix the\b/, /\bEnter your\b/, /\bChoose\b/, /\bStart this\b/,
  /\bunfinished\b/i, /\bdraft\b/i, /\bhandoff\b/i, /\bparent flow\b/i, /\bvariant\b/i, /\bsnapshot\b/i, /\bUnavailable\b/,
];
// error-code / path leaks such as "code: x", "variants[0].name", UUIDs, raw enums
const CODE_LIKE = [/\b[a-z]+(?:[-_.][a-z]+)+\s*:/, /\b(?:code|path|message|error)\s*[:=]/i, /\w+\[\d+\]/, /[0-9a-f]{8}-[0-9a-f]{4}-/, /\b[a-z]+_[a-z]+(?:_[a-z]+)*\b/];

function expectClean(label) {
  const text = host.textContent;
  for (const pattern of ENGLISH) expect(text, `${label}: English leak ${pattern}`).not.toMatch(pattern);
  for (const pattern of CODE_LIKE) expect(text, `${label}: code-like text ${pattern}`).not.toMatch(pattern);
}
async function mount(props = {}) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<I18nProvider locale="es"><SetupWizard {...props} /></I18nProvider>));
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
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, bodyweight: [], prs: {}, workouts: [], setsByWorkout: {}, allPeriods: [], exercises: [], variants: [], allVariants: [], activeVariant: null, scheduleView: null });
  await useStore.getState().init();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
});

describe('wizard in Spanish', () => {
  it('shows no English strings or error codes on any step, including error and dialog states', async () => {
    await mount();
    expectClean('profile');
    await click(es('wizard.next', { step: es('step.routine') }));
    expectClean('profile errors');
    await setField('#setup-profile-name', 'Ada');
    await setField('#setup-profile-sex', 'prefer_not_to_say');
    await setField('#setup-profile-age', '31');
    await setField('#setup-profile-heightCm', '168');
    await setField('#setup-profile-bodyweightKg', '62');
    await click(es('wizard.next', { step: es('step.routine') }));
    await vi.waitFor(() => expect(host.querySelector(`[aria-label="${es('routine.region')}"]`)).toBeTruthy());
    expectClean('routine start');

    await click(es('routine.importFile'));
    await vi.waitFor(() => expect(host.querySelector('input[type="file"]')).toBeTruthy());
    expectClean('import');
    const input = host.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'bad.json', text: async () => '{broken' }] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).toBeTruthy());
    expectClean('import errors');
    await click(es('wizard.back'));

    await click(es('routine.scratch'));
    await click(es('wizard.next', { step: es('step.schedule') }));
    expectClean('routine errors');
    await setField('#manual-routine-variant-0-name', 'Empuje');
    const picker = host.querySelector('#manual-routine-exercise-0-0-picker');
    await act(async () => { picker.focus(); picker.click(); });
    await act(async () => host.querySelector('[role="option"]').click());
    expectClean('routine filled');
    await click(es('wizard.next', { step: es('step.schedule') }));
    await vi.waitFor(() => expect(host.querySelector(`[aria-label="${es('sched.region')}"]`)).toBeTruthy());
    expectClean('schedule');
    await act(async () => host.querySelector('#schedule-mode-weekly').click());
    await click(es('wizard.next', { step: es('step.confirm') }));
    expectClean('schedule errors');
    await setField('#schedule-week-Mon', 'routine:A');
    await click(es('wizard.next', { step: es('step.confirm') }));
    await vi.waitFor(() => expect(host.querySelector(`[aria-label="${es('review.region')}"]`)).toBeTruthy());
    expectClean('confirm');
    await click(es('wizard.skip'));
    expectClean('skip dialog');
  });
});
