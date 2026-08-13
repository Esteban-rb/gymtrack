/* GymTrack — generador de datos de demo.
 *
 *   node scripts/seed-demo.mjs [--out archivo.json] [--cycles 8] [--archived 3]
 *
 * Escupe un backup JSON con el mismo formato que exportJSON(), listo para
 * Settings → Data → Import. Sirve para ver Metrics/Records/History con
 * historial real en vez de una base vacía.
 *
 * El catálogo de ejercicios y las variantes NO se duplican aquí: se leen del
 * propio db.js corriendo ensureSeeded() sobre fake-indexeddb, así que el demo
 * nunca se desincroniza del schema.
 *
 * Todo es determinista (LCG con semilla fija): dos corridas dan el mismo archivo.
 */
import 'fake-indexeddb/auto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db, ensureSeeded } from '../src/db.js';
import { toKg, est1RM, isoDate, mondayOf, weekOfPeriod, dayKeyOf, splitUnit } from '../src/calc.js';

/* ---------------- args ---------------- */
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const CYCLES_ACTIVE = +arg('cycles', 6);    // ciclos del período en curso
const CYCLES_ARCHIVED = +arg('archived', 3); // ciclos del período ya cerrado (History)
const OUT = resolve(arg('out', 'gymtrack-demo.json'));

/* ---------------- azar determinista ---------------- */
let seed = 20260813;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const jitter = (amp) => (rnd() * 2 - 1) * amp;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

/* ---------------- perfil de cada ejercicio ----------------
 * base = primer peso del ciclo 1 en la unidad propia del ejercicio.
 * rate = ganancia por ciclo (compuesto sobre la base). Deliberadamente dispar
 * para que las medallas queden repartidas y no todo termine en diamante. */
const PROFILES = {
  'incline-press': [40, 0.028], 'lat-pulldown': [50, 0.025], 'seated-press': [35, 0.022],
  'pull-over': [35, 0.020], 'chest-fly': [30, 0.018], 'lateral-raise': [10, 0.015],
  'lying-curl': [30, 0.022], 'hack-squat': [2, 0.030], 'calf-raise': [60, 0.018],
  'hip-thrust': [2, 0.028], 'leg-ext': [40, 0.020], 'abductors': [45, 0.014],
  'abs': [25, 0.016], 'military': [30, 0.024], 'preacher': [20, 0.017],
  'tri-ext': [25, 0.019], 'cable-lat': [15, 0.013], 'bayesian': [20, 0.015],
  'french': [20, 0.018], 'hammer': [20, 0.016], 'bench': [45, 0.026],
  'gironda': [40, 0.021], 'sa-pullover': [25, 0.017], 'inc-seated': [35, 0.023],
  'sa-pulldown': [30, 0.019], 'rdl': [50, 0.027], 'seated-calf': [40, 0.016],
  'leg-press': [3, 0.031], 'seated-curl': [35, 0.021], 'rear-delt': [25, 0.012],
  'incline-curl': [8, 0.020], 'katana': [20, 0.018], 'sa-tri-ext': [15, 0.014],
  'squat': [50, 0.029], 'leg-curl': [30, 0.022],
};

/** Incremento mínimo realista de la máquina/mancuerna, en la unidad del ejercicio. */
function stepFor(unit, base) {
  const { base: u } = splitUnit(unit);
  if (u === 'plates') return 0.25;
  if (u === 'lb') return 5;
  return base < 25 ? 1.25 : 2.5;  // kg
}

const roundTo = (v, step) => +(Math.round(v / step) * step).toFixed(2);

/** Peso tope de un ejercicio en un ciclo global dado (0-based).
 *  Sube compuesto, con meseta ocasional para que la línea no salga perfecta. */
function topWeight(exId, unit, gCycle) {
  const [base, rate] = PROFILES[exId] || [20, 0.018];
  const stall = Math.sin(gCycle * 1.7 + base) < -0.75 ? 1 : 0;   // se atasca un ciclo de vez en cuando
  const grown = base * (1 + rate * Math.max(0, gCycle - stall)) * (1 + jitter(0.012));
  return Math.max(base, roundTo(grown, stepFor(unit, base)));
}

/* ---------------- construcción ---------------- */
await ensureSeeded();
const exercises = (await db.exercises.toArray()).sort((a, b) => a.order - b.order);
const variants = (await db.routineVariants.toArray()).sort((a, b) => a.order - b.order);
const exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));

const TOTAL_SESSIONS = (CYCLES_ARCHIVED + CYCLES_ACTIVE) * variants.length;

// Días hábiles hacia atrás: la última sesión cae hace 2 días para que Today quede libre.
const dates = [];
const cursor = new Date();
cursor.setDate(cursor.getDate() - 2);
while (dates.length < TOTAL_SESSIONS) {
  const dow = cursor.getDay();
  if (dow !== 0 && dow !== 6) dates.push(new Date(cursor));
  cursor.setDate(cursor.getDate() - 1);
}
dates.reverse();

const SPLIT = CYCLES_ARCHIVED * variants.length;  // primera sesión del período activo

// Settings solo ofrece 4/6/8 como meta: elegimos la primera que cubra los ciclos hechos
const goalFor = (n) => [4, 6, 8].find((c) => c >= n) || 8;

const periods = [
  {
    id: 1, startDate: isoDate(mondayOf(dates[0])), cycleGoal: goalFor(CYCLES_ARCHIVED), weeks: 6,
    status: 'archived', endDate: isoDate(dates[SPLIT - 1]), rotationPos: 0, cycle: CYCLES_ARCHIVED + 1,
  },
  {
    id: 2, startDate: isoDate(mondayOf(dates[SPLIT])), cycleGoal: goalFor(CYCLES_ACTIVE + 1), weeks: 12,
    status: 'active', rotationPos: 0, cycle: CYCLES_ACTIVE + 1,
  },
];

const workouts = [];
const sets = [];
let setId = 1;

for (let i = 0; i < TOTAL_SESSIONS; i++) {
  const archived = i < SPLIT;
  const period = archived ? periods[0] : periods[1];
  const v = variants[i % variants.length];
  const gCycle = Math.floor(i / variants.length);                       // ciclo global 0-based
  const cycle = archived ? gCycle + 1 : gCycle - CYCLES_ARCHIVED + 1;   // ciclo dentro del período
  const date = isoDate(dates[i]);

  const w = {
    id: i + 1, date, periodId: period.id, cycle, variant: v.code,
    week: Math.max(1, weekOfPeriod(period.startDate, dates[i])),
    dayKey: dayKeyOf(dates[i]), block: v.name, finished: true,
    entries: v.exerciseIds.map((exerciseId) => ({ exerciseId })),
  };
  workouts.push(w);

  for (const exId of v.exerciseIds) {
    const ex = exMap[exId];
    if (!ex) continue;
    const unit = ex.unit;
    const step = stepFor(unit, (PROFILES[exId] || [20])[0]);
    const top = topWeight(exId, unit, gCycle);
    const nSets = ex.isBasic ? 4 : 3;
    const topReps = ex.isBasic ? pick([6, 7, 8]) : pick([8, 10, 12]);

    for (let n = 1; n <= nSets; n++) {
      // serie 1 = la pesada; las siguientes bajan carga y suben un par de reps
      // (back-off, que la app auto-etiqueta al ser realKg menor que la primera)
      const drop = n === 1 ? 0 : n === 2 ? (rnd() < 0.45 ? 0 : step) : step * (n - 1);
      const value = Math.max(step, roundTo(top - drop, step));
      const reps = n === 1 ? topReps : topReps + Math.min(n - 1, 2) + (rnd() < 0.3 ? 1 : 0);
      sets.push({
        id: setId++, workoutId: w.id, exerciseId: exId, n, reps, value, unit,
        realKg: +toKg(value, unit).toFixed(3),
      });
    }
  }
}

/* ---------------- bodyweight semanal ---------------- */
const bodyweightLog = [];
let bwId = 1, bw = 70.2;
for (let d = mondayOf(dates[0]); d <= dates[dates.length - 1]; d.setDate(d.getDate() + 7)) {
  bodyweightLog.push({ id: bwId++, date: isoDate(d), kg: +(bw + jitter(0.25)).toFixed(1) });
  bw += 0.22;
}
const bodyweightKg = bodyweightLog[bodyweightLog.length - 1].kg;

/* ---------------- PRs (misma lógica que store.refreshPR) ---------------- */
const wById = Object.fromEntries(workouts.map((w) => [w.id, w]));
const personalRecords = [];
for (const ex of exercises) {
  const dated = sets.filter((s) => s.exerciseId === ex.id).map((s) => ({ ...s, date: wById[s.workoutId].date }));
  if (!dated.length) continue;
  dated.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const firstDate = dated[0].date;
  const baselineKg = Math.max(...dated.filter((s) => s.date === firstDate).map((s) => s.realKg));
  let best = dated[0];
  for (const s of dated) if (s.realKg > best.realKg || (s.realKg === best.realKg && s.reps > best.reps)) best = s;
  personalRecords.push({
    exerciseId: ex.id, kg: best.realKg, reps: best.reps, value: best.value, unit: best.unit,
    date: best.date, oneRm: +est1RM(best.realKg, best.reps).toFixed(1), baselineKg,
  });
}

/* ---------------- dump ---------------- */
const dump = {
  app: 'gymtrack', schema: 2, exportedAt: new Date().toISOString(),
  profile: [{ id: 1, age: 18, bodyweightKg, theme: 'dark' }],
  bodyweightLog, periods, exercises, dayTemplates: [], routineVariants: variants,
  workouts, sets, personalRecords,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(dump, null, 1));

const tonnage = sets.reduce((a, s) => a + s.realKg * s.reps, 0);
console.log(`✓ ${OUT}`);
console.log(`  ${workouts.length} sesiones · ${sets.length} series · ${Math.round(tonnage).toLocaleString('es')} kg de tonelaje`);
console.log(`  ${dates[0] && isoDate(dates[0])} → ${isoDate(dates[dates.length - 1])}`);
console.log(`  período archivado: ${CYCLES_ARCHIVED} ciclos · activo: ${CYCLES_ACTIVE} ciclos (meta ${periods[1].cycleGoal})`);
console.log(`  ${personalRecords.length} PRs · peso corporal ${bodyweightLog[0].kg} → ${bodyweightKg} kg`);
process.exit(0);
