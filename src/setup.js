import { ALL_EXERCISES, SEED_VARIANTS, SEED_PROFILE, SEED_PERIOD } from './db.js';

export const SEX_VALUES = ['male', 'female', 'other', 'prefer_not_to_say'];

export function normalizeProfileDraft(input = {}) {
  const draft = input && typeof input === 'object' ? input : {};
  const text = (value) => typeof value === 'string' ? value.trim() : value;
  const number = (value) => value === '' || value == null ? '' : (typeof value === 'string' ? Number(value.trim()) : value);
  return {
    name: text(draft.name), sex: text(draft.sex), age: number(draft.age),
    heightCm: number(draft.heightCm), bodyweightKg: number(draft.bodyweightKg),
  };
}

export function validateProfileDraft(input) {
  const profile = normalizeProfileDraft(input);
  const errors = {};
  if (typeof profile.name !== 'string' || !profile.name.trim()) errors.name = 'Name is required';
  if (!SEX_VALUES.includes(profile.sex)) errors.sex = 'Choose a supported option';
  if (!Number.isInteger(profile.age) || profile.age < 1) errors.age = 'Age must be a positive whole number';
  for (const key of ['heightCm', 'bodyweightKg']) if (!Number.isFinite(profile[key]) || profile[key] <= 0) errors[key] = 'Must be a finite positive measurement';
  return { valid: Object.keys(errors).length === 0, errors, profile };
}

const equal = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index]) && aKeys.every((key) => equal(a[key], b[key]));
};
const preferenceKeys = new Set(['theme', 'accent', 'preferences', 'id', 'setupSkipped', 'setupInvitation', 'setupComplete', 'setupRequired']);
const seedProfileMatches = (profile) => profile && Object.entries(profile).every(([key, value]) =>
  preferenceKeys.has(key) || (Object.hasOwn(SEED_PROFILE, key) && equal(value, SEED_PROFILE[key])));
const seedCollectionMatches = (actual, expected, identity) => {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const expectedById = new Map(expected.map((item) => [item[identity], item]));
  const actualById = new Map();
  for (const item of actual) {
    const id = item?.[identity];
    if (id == null || actualById.has(id) || !expectedById.has(id)) return false;
    actualById.set(id, item);
  }
  return expectedById.size === actualById.size && [...expectedById].every(([id, item]) => equal(actualById.get(id), item));
};

/** Detect meaningful user training/profile data; seed-generated dates and IDs are unstable. */
export function hasRealTrainingData(data = {}) {
  const state = data && typeof data === 'object' ? data : {};
  if (['workouts', 'sets', 'bodyweightLog', 'personalRecords'].some((key) => (state[key] || []).length > 0)) return true;
  if (!Array.isArray(state.periods) || state.periods.length !== 1) return true;
  const [period] = state.periods;
  const { id: _id, startDate: _startDate, ...periodState } = period || {};
  const { id: _seedId, startDate: _seedStartDate, ...seedPeriodState } = SEED_PERIOD;
  if (!equal(periodState, seedPeriodState)) return true;
  if (!seedCollectionMatches(state.routineVariants, SEED_VARIANTS, 'code')) return true;
  if (!seedCollectionMatches(state.exercises, ALL_EXERCISES, 'id')) return true;
  if (!seedProfileMatches(state.profile)) return true;
  return false;
}

export function getSetupStatus({ markers = {}, hasRealData = false } = {}) {
  if (markers.complete === true) return 'complete';
  if (markers.required === true) return 'first-run-required';
  // an explicit skip holds even for seed-only users (skipSetup clears the required marker)
  if (markers.skipped === true) return 'skipped';
  if (markers.invitation === true) return 'invite-existing';
  return hasRealData ? 'invite-existing' : 'first-run-required';
}
