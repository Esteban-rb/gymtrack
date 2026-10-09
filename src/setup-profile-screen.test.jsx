// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import SetupProfile from './screens/SetupProfile.jsx';
import { I18nProvider } from './i18n.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fields = { name: 'Ada Lovelace', sex: 'female', age: '31', heightCm: '168', bodyweightKg: '62' };
let root, host, actionBefore;
async function render(props = {}, locale = 'en') {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<I18nProvider locale={locale}><SetupProfile {...props} /></I18nProvider>));
}
async function input(label, value) {
  const field = [...host.querySelectorAll('input,select')].find((element) => element.labels?.[0]?.textContent.includes(label));
  if (!field) throw new Error(`Missing field ${label}`);
  await act(async () => {
    const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await vi.waitFor(() => expect(host.querySelector('button[type="submit"]').disabled).toBe(false));
}
const snapshot = async () => Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
beforeEach(async () => {
  await db.delete(); await db.open(); await ensureSeeded();
  useStore.setState({ loaded: false, profile: null, bodyweight: [], prs: {}, workouts: [], setsByWorkout: {}, allPeriods: [], exercises: [], variants: [] });
  await useStore.getState().init();
  actionBefore = useStore.getState().saveSetupProfile;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
  useStore.setState({ saveSetupProfile: actionBefore });
});

describe('SetupProfile', () => {
  it('starts blank rather than using seed/example profile values', async () => {
    await render();
    for (const label of ['Name', 'Age', 'Height (cm)', 'Body weight (kg)']) {
      const field = [...host.querySelectorAll('input')].find((element) => element.labels?.[0]?.textContent.includes(label));
      expect(field.value).toBe('');
    }
    expect(host.querySelector('select').value).toBe('');
  });

  it('prefills an explicitly supplied saved profile and offers the exact sex choices', async () => {
    await render({ initialProfile: { ...fields, age: 31, heightCm: 168, bodyweightKg: 62 } });
    expect(host.querySelector('#setup-profile-name').value).toBe('Ada Lovelace');
    expect(host.querySelector('#setup-profile-sex').value).toBe('female');
    expect([...host.querySelectorAll('#setup-profile-sex option')].map((option) => option.value)).toEqual(['', 'male', 'female', 'other', 'prefer_not_to_say']);
    expect(host.textContent).toContain('Height (cm)');
    expect(host.textContent).toContain('Body weight (kg)');
  });

  it('shows validator field errors without writes', async () => {
    await render();
    const before = await snapshot();
    await submit();
    for (const id of ['name', 'sex', 'age', 'heightCm', 'bodyweightKg']) {
      const field = host.querySelector(`#setup-profile-${id}`);
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(field.getAttribute('aria-describedby'))?.textContent).toBeTruthy();
    }
    expect(await snapshot()).toEqual(before);
  });

  it('saves normalized values, preserves preferences/obligation, and calls onSaved after commit', async () => {
    await db.profile.update(1, { preferences: { theme: 'dark' }, setupRequired: true, setupComplete: false });
    await useStore.getState().init();
    const onSaved = vi.fn(async (profile) => { expect(await db.profile.get(1)).toEqual(profile); });
    await render({ onSaved });
    for (const [label, value] of Object.entries({ Name: fields.name, Age: fields.age, 'Height (cm)': fields.heightCm, 'Body weight (kg)': fields.bodyweightKg })) await input(label, value);
    await input('Sex', fields.sex);
    await submit();
    expect(await db.profile.get(1)).toMatchObject({ ...fields, age: 31, heightCm: 168, bodyweightKg: 62, preferences: { theme: 'dark' }, setupRequired: true, setupComplete: false });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved.mock.calls[0][0]).toEqual(await db.profile.get(1));
    expect(host.textContent).toMatch(/saved|profile/i);
    expect(host.textContent).not.toMatch(/setup complete|routine complete/i);
  });

  it('keeps entered values and does not call onSaved when the real save rejects', async () => {
    await db.profile.update(1, { bodyweightKg: 80 });
    await useStore.getState().init();
    const onSaved = vi.fn();
    const original = db.personalRecords.bulkPut.bind(db.personalRecords);
    db.personalRecords.bulkPut = async () => { throw new Error('storage unavailable'); };
    try {
      await render({ onSaved });
      for (const [label, value] of Object.entries({ Name: fields.name, Age: fields.age, 'Height (cm)': fields.heightCm, 'Body weight (kg)': fields.bodyweightKg })) await input(label, value);
      await input('Sex', fields.sex);
      const before = await snapshot();
      await submit();
      expect(host.textContent).toContain('storage unavailable');
      expect(host.querySelector('#setup-profile-name').value).toBe(fields.name);
      expect(onSaved).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    } finally { db.personalRecords.bulkPut = original; }
  });

  it('cancels without writes', async () => {
    const onCancel = vi.fn();
    const onSaved = vi.fn();
    await render({ onCancel, onSaved });
    await input('Name', fields.name);
    const before = await snapshot();
    await act(async () => host.querySelector('button[type="button"]')?.click());
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSaved).not.toHaveBeenCalled();
    expect(host.querySelector('#setup-profile-name').value).toBe(fields.name);
    expect(await snapshot()).toEqual(before);
  });

  it('prevents duplicate submissions while saving', async () => {
    let release;
    const save = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    useStore.setState({ saveSetupProfile: save });
    await render();
    for (const [label, value] of Object.entries({ Name: fields.name, Age: fields.age, 'Height (cm)': fields.heightCm, 'Body weight (kg)': fields.bodyweightKg })) await input(label, value);
    await input('Sex', fields.sex);
    const form = host.querySelector('form');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(save).toHaveBeenCalledOnce();
    expect(host.textContent).toMatch(/saving/i);
    await act(async () => release({ ...fields, age: 31, heightCm: 168, bodyweightKg: 62 }));
  });

  it('shows no errors before the first submit attempt, even while typing', async () => {
    await render();
    await input('Name', 'A');
    await input('Age', '0');
    expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('after a failed attempt shows plain per-field messages, a summary, and focuses the first invalid field', async () => {
    await render();
    await submit();
    const text = host.textContent;
    expect(text).toContain('Enter your name');
    expect(text).toContain('Choose an option');
    expect(text).toContain('Enter your age as a whole number');
    expect(text).toContain('Enter your height in cm');
    expect(text).toContain('Enter your weight in kg');
    expect(text).toContain('Fix the highlighted fields to continue.');
    expect(text).not.toMatch(/finite|supported|positive|is required/i);
    expect(document.activeElement).toBe(host.querySelector('#setup-profile-name'));
    const name = host.querySelector('#setup-profile-name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby')).textContent).toBe('Enter your name');
  });

  it('clears an error live only once that field is valid, and focuses the next invalid field on retry', async () => {
    await render();
    await submit();
    await input('Name', 'Ada');
    expect(host.querySelector('#setup-profile-name').getAttribute('aria-invalid')).toBeNull();
    expect(host.querySelector('#setup-profile-age').getAttribute('aria-invalid')).toBe('true');
    await input('Age', '0');
    expect(host.querySelector('#setup-profile-age').getAttribute('aria-invalid')).toBe('true');
    await input('Age', '31');
    expect(host.querySelector('#setup-profile-age').getAttribute('aria-invalid')).toBeNull();
    await submit();
    expect(document.activeElement).toBe(host.querySelector('#setup-profile-sex'));
  });

  it('shows the validation messages in Spanish without English leaks', async () => {
    await render({}, 'es');
    await submit();
    expect(host.textContent).toContain('Escribe tu nombre');
    expect(host.textContent).toContain('Elige una opción');
    expect(host.textContent).toContain('Corrige los campos resaltados para continuar.');
    expect(host.textContent).not.toMatch(/Enter your|Choose an option|Fix the/);
  });
});
