// GymTrack — dev-only demo data. Open http://localhost:5173/?db=demo : a separate IndexedDB ("demo") is
// created and filled once with four finished cycles (24 sessions with progressive loads), a few
// weeks of body weight and one session of the fifth cycle, so Records, Metrics, Home and Settings
// have something to show. ?db= (empty) returns to the real database. Never bundled in production.
// Everything is written in a few bulk transactions (a session-by-session loop took far too long on a
// real, disk-backed browser profile).
import { db, DB_NAME, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import { isoDate, addDays, mondayOf, parseISO, toKg, weekOfPeriod, dayKeyOf } from './calc.js';

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const banner = (text) => {
  const root = document.getElementById('root');
  if (root) root.innerHTML = `<div style="position:fixed;inset:0;display:grid;place-items:center;background:#000;color:#ECE8DF;font:600 15px system-ui">${text}</div>`;
};

export async function maybeSeedDemo() {
  if (DB_NAME !== 'demo') return;
  banner('Preparando datos de prueba…');
  await ensureSeeded();
  const have = await db.workouts.count();
  if (have === 25) return;                                             // already seeded
  if (have > 0) await db.transaction('rw', [db.workouts, db.sets, db.bodyweightLog, db.personalRecords], () =>   // interrupted earlier run: start over
    Promise.all([db.workouts.clear(), db.sets.clear(), db.bodyweightLog.clear(), db.personalRecords.clear()]));

  const monday0 = addDays(mondayOf(new Date()), -28);                 // 4 full weeks ago
  const startDate = isoDate(monday0);
  const period = (await db.periods.where('status').equals('active').toArray())[0];
  const variants = (await db.routineVariants.toArray()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const exMap = Object.fromEntries((await db.exercises.toArray()).map((e) => [e.id, e]));

  // 4 finished cycles (one session a day, Mon→Sat), then the first session of cycle 5 today
  const plan = [];
  for (let c = 0; c < 4; c++) for (let v = 0; v < variants.length; v++) plan.push({ variant: variants[v], date: isoDate(addDays(monday0, c * 7 + v)), cycle: c + 1, idx: c });
  plan.push({ variant: variants[0], date: isoDate(), cycle: 5, idx: 4 });

  await db.transaction('rw', [db.workouts, db.sets, db.periods, db.profile, db.bodyweightLog], async () => {
    const rows = plan.map((p) => ({
      date: p.date, periodId: period.id, cycle: p.cycle, variant: p.variant.code,
      week: weekOfPeriod(startDate, parseISO(p.date)), dayKey: dayKeyOf(parseISO(p.date)),
      block: p.variant.name, finished: true,
      entries: p.variant.exerciseIds.map((exerciseId) => ({ exerciseId })),
    }));
    const ids = await db.workouts.bulkAdd(rows, { allKeys: true });
    const sets = [];
    plan.forEach((p, i) => {
      for (const exerciseId of p.variant.exerciseIds) {
        const ex = exMap[exerciseId];
        const unit = ex.unit;
        const h = hash(ex.id);
        const base = unit.startsWith('plates') ? 2 + (h % 4) : unit.startsWith('lb') ? 25 + (h % 50) : 20 + (h % 70);
        const rate = 0.015 + (h % 6) * 0.025;                          // each exercise progresses at its own pace
        const value = Math.round(base * (1 + rate * p.idx) * 2) / 2;   // progressive overload per cycle
        for (let n = 0; n < 3; n++) sets.push({ workoutId: ids[i], exerciseId, n: n + 1, reps: 10 - n, value, unit, realKg: +toKg(value, unit).toFixed(3) });
      }
    });
    await db.sets.bulkAdd(sets);
    await db.bodyweightLog.bulkAdd([0, 1, 2, 3].map((c) => ({ date: isoDate(addDays(monday0, c * 7)), kg: +(77.5 - c * 0.5).toFixed(1) })));
    await db.periods.update(period.id, { startDate, cycleGoal: 6, cycle: 5, rotationPos: 1 });
    await db.profile.update(1, { name: 'Demo', age: 26, heightCm: 178, bodyweightKg: 76, setupComplete: true, setupRequired: false, setupSkipped: true });
  });

  // personal records / medals come from the same code path the app uses
  const store = () => useStore.getState();
  await store().init();
  for (const id of new Set(plan.flatMap((p) => p.variant.exerciseIds))) await store().refreshPR(id);
  store().dismissMedal();
}
