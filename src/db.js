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

// v2 — Upper/Lower by rotation: routine is 6 ordered variants (U1..L3) instead of
// weekday templates. Measurement unit is the *cycle* (one full pass through the 6
// variants), tracked on the period as { rotationPos, cycle, cycleGoal }. Workouts
// gain { variant, cycle }. Legacy weekday data is backfilled so History/Metrics keep
// working generically (variant = old dayKey, cycle = old week).
db.version(2).stores({
  routineVariants: 'code, order',
}).upgrade(async (tx) => {
  await tx.table('routineVariants').bulkPut(SEED_VARIANTS);
  // add the new exercises the Upper/Lower routine needs, if missing
  const exs = await tx.table('exercises').toArray();
  const have = new Set(exs.map((e) => e.id));
  let order = exs.length;
  const toAdd = NEW_EXERCISES
    .filter((e) => !have.has(e.id))
    .map((e) => ({ isBasic: false, standards: null, active: true, order: order++, ...e }));
  if (toAdd.length) await tx.table('exercises').bulkPut(toAdd);
  // seed rotation state on every period (fresh count from cycle 1)
  const periods = await tx.table('periods').toArray();
  for (const p of periods) {
    const patch = {};
    if (p.rotationPos == null) patch.rotationPos = 0;
    if (p.cycle == null) patch.cycle = 1;
    if (p.cycleGoal == null) patch.cycleGoal = 6;
    if (Object.keys(patch).length) await tx.table('periods').update(p.id, patch);
  }
  // backfill legacy workouts so the cycle/variant grouping has keys to work with
  const ws = await tx.table('workouts').toArray();
  for (const w of ws) {
    if (w.variant == null) await tx.table('workouts').update(w.id, { variant: w.dayKey, cycle: w.week || 1 });
  }
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

/* Extra movements the Upper/Lower routine needs beyond the original catalog.
 * Squat is a basic lift (est-1RM vs bodyweight standards); the rest progress by %. */
const NEW_EXERCISES = [
  { id: 'rear-delt',   name: 'Rear Delt',                     muscle: 'Shoulders',  unit: 'kg' },
  { id: 'incline-curl', name: 'Incline Curl',                 muscle: 'Biceps',     unit: 'kgx2' },
  { id: 'katana',      name: 'Katana Press',                  muscle: 'Triceps',    unit: 'kg' },
  { id: 'sa-tri-ext',  name: 'Single-Arm Triceps Extension',  muscle: 'Triceps',    unit: 'lb' },
  { id: 'squat',       name: 'Squat',                         muscle: 'Quads',      unit: 'kg', isBasic: true, standards: [1.0, 1.4, 1.8, 2.3, 2.75] },
  { id: 'leg-curl',    name: 'Leg Curl',                      muscle: 'Hamstrings', unit: 'kg' },
];

const ALL_EXERCISES = [...SEED_EXERCISES, ...NEW_EXERCISES];

/* The 6 rotation variants (Esteban's Upper/Lower). `code` is the stable id,
 * `order` drives the rotation sequence U1→L1→U2→L2→U3→L3. `name` is the display block. */
const SEED_VARIANTS = [
  { code: 'U1', order: 0, name: 'Upper 1', kind: 'Upper', exerciseIds: ['lat-pulldown', 'gironda', 'incline-press', 'chest-fly', 'hammer', 'tri-ext'] },
  { code: 'L1', order: 1, name: 'Lower 1', kind: 'Lower', exerciseIds: ['calf-raise', 'abductors', 'hack-squat', 'lying-curl', 'leg-ext', 'abs'] },
  { code: 'U2', order: 2, name: 'Upper 2', kind: 'Upper', exerciseIds: ['military', 'inc-seated', 'pull-over', 'rear-delt', 'incline-curl', 'katana'] },
  { code: 'L2', order: 3, name: 'Lower 2', kind: 'Lower', exerciseIds: ['lateral-raise', 'calf-raise', 'abductors', 'rdl', 'leg-press', 'seated-curl', 'leg-ext', 'abs'] },
  { code: 'U3', order: 4, name: 'Upper 3', kind: 'Upper', exerciseIds: ['bench', 'sa-pulldown', 'chest-fly', 'preacher', 'pull-over', 'sa-tri-ext'] },
  { code: 'L3', order: 5, name: 'Lower 3', kind: 'Lower', exerciseIds: ['lateral-raise', 'calf-raise', 'squat', 'hip-thrust', 'leg-curl', 'leg-ext', 'abs'] },
];

export const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs'];

/** Seed catalog, rotation variants, profile and an active period on first run. */
export async function ensureSeeded() {
  const profile = await db.profile.get(1);
  if (profile) return;
  await db.transaction('rw', [db.profile, db.exercises, db.routineVariants, db.periods], async () => {
    await db.profile.put({ id: 1, age: 18, bodyweightKg: 70, theme: 'dark' });
    await db.exercises.bulkPut(ALL_EXERCISES.map((e, i) => ({
      isBasic: false, standards: null, active: true, order: i, ...e,
    })));
    await db.routineVariants.bulkPut(SEED_VARIANTS);
    // A period measured in cycles (one full U1→L3 rotation). Pointer starts at U1, cycle 1.
    await db.periods.add({ startDate: isoDate(mondayOf(new Date())), cycleGoal: 6, status: 'active', rotationPos: 0, cycle: 1 });
  });
}
