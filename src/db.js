// GymTrack — Dexie (IndexedDB) schema + first-run seed.
import Dexie from 'dexie';
import { isoDate, mondayOf } from './calc.js';

export const db = new Dexie('gymtrack');

db.version(1).stores({
  profile: 'id',
  bodyweightLog: '++id, date',
  periods: '++id, status, startDate',
  exercises: 'id, order',
  dayTemplates: 'day',
  workouts: '++id, date, periodId, [periodId+week]',
  sets: '++id, workoutId, exerciseId',
  personalRecords: 'exerciseId',
});

/* ---------------- Seed data ----------------
 * Exercise catalog from the design handoff. `standards` (basics only) are
 * est-1RM thresholds as multiples of bodyweight, bronze→diamond, editable
 * in Settings. Derived from common strength-standard tables for ~18 y / 70 kg. */
const SEED_EXERCISES = [
  { id: 'incline-press', name: 'Incline Press',        muscle: 'Chest',      unit: 'kg',     isBasic: true,  standards: [0.55, 0.8, 1.05, 1.3, 1.6] },
  { id: 'lat-pulldown',  name: 'Lat Pulldown',         muscle: 'Back',       unit: 'kg' },
  { id: 'seated-press',  name: 'Seated Press',         muscle: 'Chest',      unit: 'kg' },
  { id: 'pull-over',     name: 'Pull Over',            muscle: 'Back',       unit: 'kg' },
  { id: 'chest-fly',     name: 'Chest Fly',            muscle: 'Chest',      unit: 'kg' },
  { id: 'lateral-raise', name: 'Lateral Raises',       muscle: 'Shoulders',  unit: 'x2' },
  { id: 'lying-curl',    name: 'Lying Leg Curl',       muscle: 'Hamstrings', unit: 'kg' },
  { id: 'hack-squat',    name: 'Hack Squat',           muscle: 'Quads',      unit: 'plates', isBasic: true,  standards: [1.0, 1.4, 1.9, 2.5, 3.1] },
  { id: 'calf-raise',    name: 'Standing Calf Raises', muscle: 'Calves',     unit: 'kg' },
  { id: 'hip-thrust',    name: 'Hip Thrust',           muscle: 'Glutes',     unit: 'plates' },
  { id: 'leg-ext',       name: 'Leg Extension',        muscle: 'Quads',      unit: 'kg' },
  { id: 'abductors',     name: 'Abductors',            muscle: 'Glutes',     unit: 'kg' },
  { id: 'abs',           name: 'Cable Crunch',         muscle: 'Abs',        unit: 'kg' },
  { id: 'military',      name: 'Military Press',       muscle: 'Shoulders',  unit: 'kg',     isBasic: true,  standards: [0.45, 0.6, 0.8, 1.05, 1.3] },
  { id: 'preacher',      name: 'Preacher Curl',        muscle: 'Biceps',     unit: 'kg' },
  { id: 'tri-ext',       name: 'Triceps Extension',    muscle: 'Triceps',    unit: 'kg' },
  { id: 'cable-lat',     name: 'Cable Lateral Raises', muscle: 'Shoulders',  unit: 'lb' },
  { id: 'bayesian',      name: 'Bayesian Curl',        muscle: 'Biceps',     unit: 'lb' },
  { id: 'french',        name: 'French Press',         muscle: 'Triceps',    unit: 'kg' },
  { id: 'hammer',        name: 'Hammer Curl',          muscle: 'Biceps',     unit: 'x2' },
  { id: 'bench',         name: 'Bench Press',          muscle: 'Chest',      unit: 'kg',     isBasic: true,  standards: [0.65, 0.85, 1.15, 1.5, 1.85] },
  { id: 'gironda',       name: 'Gironda Row',          muscle: 'Back',       unit: 'kg' },
  { id: 'sa-pullover',   name: 'Single-Arm Pull Over', muscle: 'Back',       unit: 'lb' },
  { id: 'inc-seated',    name: 'Incline Seated Press', muscle: 'Chest',      unit: 'kg' },
  { id: 'sa-pulldown',   name: 'Single-Arm Pulldown',  muscle: 'Back',       unit: 'lb' },
  { id: 'rdl',           name: 'Romanian Deadlift',    muscle: 'Hamstrings', unit: 'kg',     isBasic: true,  standards: [0.85, 1.2, 1.55, 2.0, 2.4] },
  { id: 'seated-calf',   name: 'Seated Calf Raises',   muscle: 'Calves',     unit: 'kg' },
  { id: 'leg-press',     name: 'Leg Press',            muscle: 'Quads',      unit: 'plates', isBasic: true,  standards: [1.3, 1.85, 2.55, 3.35, 4.15] },
  { id: 'seated-curl',   name: 'Seated Leg Curl',      muscle: 'Hamstrings', unit: 'kg' },
];

const SEED_TEMPLATES = [
  { day: 'Mon', block: 'Push-Pull', exerciseIds: ['incline-press', 'lat-pulldown', 'seated-press', 'pull-over', 'chest-fly', 'lateral-raise'] },
  { day: 'Tue', block: 'Legs',      exerciseIds: ['lying-curl', 'hack-squat', 'calf-raise', 'hip-thrust', 'leg-ext', 'abductors', 'abs'] },
  { day: 'Wed', block: 'Arms',      exerciseIds: ['military', 'preacher', 'tri-ext', 'cable-lat', 'bayesian', 'french', 'hammer'] },
  { day: 'Thu', block: 'Push-Pull', exerciseIds: ['bench', 'gironda', 'chest-fly', 'sa-pullover', 'inc-seated', 'sa-pulldown'] },
  { day: 'Fri', block: 'Legs',      exerciseIds: ['rdl', 'seated-calf', 'leg-press', 'seated-curl', 'leg-ext', 'abs'] },
];

export const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs'];

/** Seed catalog, templates, profile and an active 12-week period on first run. */
export async function ensureSeeded() {
  const profile = await db.profile.get(1);
  if (profile) return;
  await db.transaction('rw', [db.profile, db.exercises, db.dayTemplates, db.periods], async () => {
    await db.profile.put({ id: 1, age: 18, bodyweightKg: 70, theme: 'dark' });
    await db.exercises.bulkPut(SEED_EXERCISES.map((e, i) => ({
      isBasic: false, standards: null, active: true, order: i, ...e,
    })));
    await db.dayTemplates.bulkPut(SEED_TEMPLATES);
    // Period starts on the Monday of the current week so week numbers align Mon–Fri.
    await db.periods.add({ startDate: isoDate(mondayOf(new Date())), weeks: 12, status: 'active' });
  });
}
