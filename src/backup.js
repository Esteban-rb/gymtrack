// GymTrack — backup safety net: full-fidelity JSON export/import + Excel export.
import { db } from './db.js';
import { isoDate, setTonnage } from './calc.js';

const TABLES = ['profile', 'bodyweightLog', 'periods', 'exercises', 'dayTemplates', 'workouts', 'sets', 'personalRecords'];

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Complete backup of every table — the file that can be re-imported. */
export async function exportJSON() {
  const dump = { app: 'gymtrack', schema: 1, exportedAt: new Date().toISOString() };
  for (const t of TABLES) dump[t] = await db.table(t).toArray();
  download(new Blob([JSON.stringify(dump, null, 1)], { type: 'application/json' }), `gymtrack-backup-${isoDate()}.json`);
}

/** Restore a JSON backup. Replaces ALL current data. */
export async function importJSON(file) {
  const text = await file.text();
  const dump = JSON.parse(text);
  if (dump.app !== 'gymtrack' || !Array.isArray(dump.sets) || !Array.isArray(dump.workouts)) {
    throw new Error('Not a GymTrack backup file');
  }
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      if (Array.isArray(dump[t]) && dump[t].length) await db.table(t).bulkPut(dump[t]);
    }
  });
}

/** Human-readable Excel export: one row per set, plus bodyweight and catalog sheets. */
export async function exportXLSX() {
  // SheetJS is heavy — load it only when exporting (it still gets precached for offline use)
  const XLSX = await import('xlsx');
  const [workouts, sets, exercises, bodyweight, periods] = await Promise.all([
    db.workouts.toArray(), db.sets.toArray(), db.exercises.toArray(), db.bodyweightLog.toArray(), db.periods.toArray(),
  ]);
  const exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const wMap = Object.fromEntries(workouts.map((w) => [w.id, w]));

  const setRows = sets
    .map((s) => ({ s, w: wMap[s.workoutId] }))
    .filter((r) => r.w)
    .sort((a, b) => a.w.date.localeCompare(b.w.date) || a.s.id - b.s.id)
    .map(({ s, w }) => ({
      Date: w.date, Week: w.week, Day: w.dayKey, Block: w.block,
      Exercise: (exMap[s.exerciseId] || {}).name || s.exerciseId,
      Muscle: (exMap[s.exerciseId] || {}).muscle || '',
      Set: s.n, Value: s.value, Unit: s.unit, Reps: s.reps,
      RealKg: +s.realKg.toFixed(2), TonnageKg: +setTonnage(s).toFixed(1),
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(setRows), 'Sets');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bodyweight.map((b) => ({ Date: b.date, Kg: b.kg }))), 'Bodyweight');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exercises.map((e) => ({
    Name: e.name, Muscle: e.muscle, Unit: e.unit, Basic: e.isBasic ? 'yes' : '', Standards: e.standards ? e.standards.join(' / ') : '',
  }))), 'Exercises');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(periods.map((p) => ({
    Start: p.startDate, Weeks: p.weeks, Status: p.status, End: p.endDate || '',
  }))), 'Periods');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `gymtrack-${isoDate()}.xlsx`);
}
