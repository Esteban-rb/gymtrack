import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, ensureSeeded, SEED_PERIOD, SEED_PROFILE, ALL_EXERCISES, SEED_VARIANTS } from './db.js';
import { getSetupStatus, hasRealTrainingData, normalizeProfileDraft, validateProfileDraft } from './setup.js';

beforeEach(async () => { await db.delete(); await db.open(); });

describe('profile draft helpers', () => {
  it('trims strings and converts numeric strings without mutating input', () => {
    const input = { name: ' Ana ', sex: 'female', age: '30', heightCm: '170', bodyweightKg: '65' };
    expect(normalizeProfileDraft(input)).toEqual({ name: 'Ana', sex: 'female', age: 30, heightCm: 170, bodyweightKg: 65 });
    expect(input.name).toBe(' Ana ');
  });
  it.each(['male', 'female', 'other', 'prefer_not_to_say'])('accepts sex %s', (sex) => {
    expect(validateProfileDraft({ name: 'A', sex, age: 1, heightCm: 1, bodyweightKg: 1 }).valid).toBe(true);
  });
  it.each([{ age: 1.5 }, { age: 0 }, { age: 'nope' }, { heightCm: Infinity }, { bodyweightKg: 0 }])('rejects invalid measurements %#', (change) => {
    expect(validateProfileDraft({ name: 'A', sex: 'other', age: 20, heightCm: 170, bodyweightKg: 60, ...change }).valid).toBe(false);
  });
  it('requires a trimmed name and supported sex', () => {
    expect(validateProfileDraft({ name: ' ', sex: 'unknown', age: 20, heightCm: 170, bodyweightKg: 60 }).errors).toMatchObject({ name: expect.any(String), sex: expect.any(String) });
  });
});

describe('pure setup detection', () => {
  async function seededFixture() {
    await ensureSeeded();
    const fixture = Object.fromEntries(await Promise.all(db.tables.map(async (table) => [table.name, await table.toArray()])));
    fixture.profile = fixture.profile[0];
    return fixture;
  }
  it('recognizes actual ensureSeeded state despite generated period ID and date', async () => {
    expect(hasRealTrainingData(await seededFixture())).toBe(false);
  });
  it('ignores generated period ID/date differences but detects meaningful period edits', async () => {
    const fixture = await seededFixture();
    const [period] = fixture.periods;
    expect(hasRealTrainingData({ ...fixture, periods: [{ ...period, id: period.id + 1, startDate: '2026-02-02' }] })).toBe(false);
    for (const change of [{ cycle: 2 }, { rotationPos: 1 }, { status: 'archived' }, { cycleGoal: 8 }]) {
      expect(hasRealTrainingData({ ...fixture, periods: [{ ...period, ...change }] })).toBe(true);
    }
  });
  it('ignores preferences but detects changed profile fields', async () => {
    const fixture = await seededFixture();
    expect(hasRealTrainingData({ ...fixture, profile: { ...fixture.profile, theme: 'light', accent: 'pink' } })).toBe(false);
    expect(hasRealTrainingData({ ...fixture, profile: { ...fixture.profile, name: 'Ana' } })).toBe(true);
  });
  it.each(['workouts', 'sets', 'bodyweightLog', 'personalRecords'])('detects %s rows', (key) => {
    expect(hasRealTrainingData({ [key]: [{ id: 1 }] })).toBe(true);
  });
  it('ignores outer catalog array order but detects meaningful catalog and routine changes', async () => {
    const fixture = await seededFixture();
    expect(hasRealTrainingData({ ...fixture, exercises: [...fixture.exercises].reverse() })).toBe(false);
    expect(hasRealTrainingData({ ...fixture, routineVariants: [...fixture.routineVariants].reverse() })).toBe(false);

    expect(hasRealTrainingData({ ...fixture, exercises: fixture.exercises.slice(1) })).toBe(true);
    expect(hasRealTrainingData({ ...fixture, exercises: fixture.exercises.map((e, i) => i ? e : { ...e, name: 'Edited' }) })).toBe(true);
    expect(hasRealTrainingData({ ...fixture, routineVariants: fixture.routineVariants.slice(1) })).toBe(true);
    expect(hasRealTrainingData({ ...fixture, routineVariants: fixture.routineVariants.map((v, i) => i ? v : { ...v, order: v.order + 1 }) })).toBe(true);
    expect(hasRealTrainingData({ ...fixture, routineVariants: fixture.routineVariants.map((v, i) => i ? v : { ...v, exerciseIds: [...v.exerciseIds].reverse() }) })).toBe(true);
    expect(hasRealTrainingData({ ...fixture, exercises: [...fixture.exercises, fixture.exercises[0]] })).toBe(true);
    expect(hasRealTrainingData({ ...fixture, routineVariants: [...fixture.routineVariants, fixture.routineVariants[0]] })).toBe(true);
    expect(hasRealTrainingData({})).toBe(true);
    expect(hasRealTrainingData({ exercises: [], routineVariants: [], periods: [] })).toBe(true);
  });
  it('ignores setup lifecycle markers while retaining seeded-data detection', async () => {
    const seeded = await seededFixture();
    seeded.profile.setupSkipped = true;
    seeded.profile.setupRequired = true;
    expect(hasRealTrainingData(seeded)).toBe(false);
    expect(getSetupStatus({ markers: { required: true }, hasRealData: hasRealTrainingData(seeded) })).toBe('first-run-required');
    // an explicit skip holds even without real data (first-run "Skip for now")
    expect(getSetupStatus({ markers: { skipped: true }, hasRealData: false })).toBe('skipped');
    expect(getSetupStatus({ markers: { skipped: false }, hasRealData: false })).toBe('first-run-required');
  });
  it('prioritizes strict unfinished first-run obligation over skip/invitation/data', () => {
    expect(getSetupStatus({ markers: { required: true, skipped: true, invitation: true }, hasRealData: true })).toBe('first-run-required');
    expect(getSetupStatus({ markers: { required: 'true', skipped: true }, hasRealData: true })).toBe('skipped');
    expect(getSetupStatus({ markers: { required: true, complete: true }, hasRealData: true })).toBe('complete');
    expect(hasRealTrainingData({ profile: { setupRequired: true }, periods: [], exercises: [], routineVariants: [] })).toBe(true);
  });
  it('detects advanced/archived periods and status precedence', () => {
    expect(hasRealTrainingData({ periods: [{ ...SEED_PERIOD, startDate: '2024-01-01', id: 1, status: 'archived' }] })).toBe(true);
    expect(getSetupStatus({ markers: { complete: true, skipped: true }, hasRealData: true })).toBe('complete');
    expect(getSetupStatus({ markers: { skipped: true }, hasRealData: true })).toBe('skipped');
    expect(getSetupStatus({ hasRealData: true })).toBe('invite-existing');
    expect(getSetupStatus()).toBe('first-run-required');
  });
});
