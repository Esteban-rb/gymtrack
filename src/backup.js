// GymTrack — backup safety net: full-fidelity JSON export/import + Excel export/import.
import { db } from './db.js';
import { isoDate, setTonnage, toKg, splitUnit, joinUnit, parseISO, mondayOf, weekOfPeriod, dayKeyOf, addDays } from './calc.js';

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

/* ---------------- Excel import (merge, never replaces) ---------------- */

/** Accepts '2026-06-11', '6/11/2026' (US order, as the app exports) or an Excel serial. */
function normDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { // Excel serial date (1900 epoch)
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const y = us[3].length === 2 ? '20' + us[3] : us[3];
    return `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  return null;
}

function normUnit(v, fallback = 'kg') {
  const s = String(v || '').toLowerCase().replace(/[\s×]/g, '').replace('lbs', 'lb');
  if (['kg', 'lb', 'plates', 'x2', 'kgx2', 'lbx2'].includes(s)) return s;
  if (s === 'plate') return 'plates';
  return fallback;
}

/** Merge sets from an Excel file (the app's own export format: a 'Sets' sheet with
 *  Date / Exercise / Value / Unit / Reps columns; Set, Muscle and Block are optional).
 *  Creates missing exercises and workouts; dates older than every period get their own
 *  archived "Imported" period. Skips rows already present. Returns counts. */
export async function importXLSX(file) {
  const XLSX = await import('xlsx');
  // Uint8Array, not ArrayBuffer: cross-realm ArrayBuffers fail SheetJS's instanceof check
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheet = wb.Sheets['Sets'] || wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('No sheets in file');
  const raw = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' });
  if (!raw.length) throw new Error('Sheet is empty');

  // case-insensitive header access
  const get = (row, ...names) => {
    for (const k of Object.keys(row)) {
      if (names.includes(k.toLowerCase().trim())) return row[k];
    }
    return undefined;
  };

  const rows = [];
  for (const r of raw) {
    const date = normDate(get(r, 'date', 'fecha'));
    const name = String(get(r, 'exercise', 'ejercicio', 'name') || '').trim();
    const reps = parseInt(get(r, 'reps', 'repeticiones'), 10);
    const value = parseFloat(get(r, 'value', 'weight', 'peso'));
    if (!date || !name || isNaN(reps) || isNaN(value)) continue;
    rows.push({
      date, name, reps, value,
      unit: normUnit(get(r, 'unit', 'unidad')),
      n: parseInt(get(r, 'set', 'serie'), 10) || null,
      muscle: String(get(r, 'muscle', 'musculo') || '').trim(),
      block: String(get(r, 'block', 'bloque') || '').trim(),
    });
  }
  if (!rows.length) throw new Error('No valid rows (need Date, Exercise, Value, Reps)');
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.n || 0) - (b.n || 0));

  const counts = { sets: 0, workouts: 0, exercises: 0, skipped: 0 };
  const affected = new Set();

  await db.transaction('rw', [db.exercises, db.workouts, db.sets, db.periods], async () => {
    const [exercises, workouts, allSets, periods] = await Promise.all([
      db.exercises.toArray(), db.workouts.toArray(), db.sets.toArray(), db.periods.toArray(),
    ]);
    const exByName = new Map(exercises.map((e) => [e.name.toLowerCase(), e]));
    const wByDate = new Map(workouts.map((w) => [w.date, w]));
    const setsByW = new Map();
    for (const s of allSets) {
      if (!setsByW.has(s.workoutId)) setsByW.set(s.workoutId, []);
      setsByW.get(s.workoutId).push(s);
    }

    // a period that covers a date, else null
    const periodFor = (date) => periods.find((p) => {
      if (date < p.startDate) return false;
      const end = p.endDate || isoDate(addDays(parseISO(p.startDate), p.weeks * 7 - 1));
      return p.status === 'active' ? true : date <= end;
    }) || null;

    // dates before every period → one archived "Imported" period that spans them
    const uncovered = rows.map((r) => r.date).filter((d) => !periodFor(d));
    if (uncovered.length) {
      const start = isoDate(mondayOf(parseISO(uncovered[0])));
      const last = uncovered[uncovered.length - 1];
      const weeks = Math.max(1, weekOfPeriod(start, parseISO(last)));
      const p = { startDate: start, weeks, status: 'archived', endDate: last };
      p.id = await db.periods.add(p);
      periods.push(p);
    }

    let order = exercises.length;
    for (const r of rows) {
      let ex = exByName.get(r.name.toLowerCase());
      if (!ex) {
        const id = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36) + counts.exercises;
        ex = { id, name: r.name, muscle: r.muscle || 'Other', unit: splitUnit(r.unit).base === 'plates' ? 'plates' : r.unit, isBasic: false, standards: null, active: true, order: order++ };
        await db.exercises.put(ex);
        exByName.set(r.name.toLowerCase(), ex);
        counts.exercises++;
      }

      let w = wByDate.get(r.date);
      if (!w) {
        const p = periodFor(r.date);
        w = {
          date: r.date, periodId: p.id, week: Math.max(1, weekOfPeriod(p.startDate, parseISO(r.date))),
          dayKey: dayKeyOf(parseISO(r.date)), templateDay: dayKeyOf(parseISO(r.date)),
          block: r.block || 'Imported', finished: true, entries: [],
        };
        w.id = await db.workouts.add(w);
        wByDate.set(r.date, w);
        setsByW.set(w.id, []);
        counts.workouts++;
      }
      if (!w.entries.some((en) => en.exerciseId === ex.id)) {
        w.entries = [...w.entries, { exerciseId: ex.id }];
        await db.workouts.put(w);
      }

      const wSets = setsByW.get(w.id) || [];
      const dup = wSets.some((s) => s.exerciseId === ex.id && s.reps === r.reps && s.value === r.value && joinUnit(splitUnit(s.unit).base, splitUnit(s.unit).dbl) === joinUnit(splitUnit(r.unit).base, splitUnit(r.unit).dbl) && (r.n == null || s.n === r.n));
      if (dup) { counts.skipped++; continue; }
      const row = {
        workoutId: w.id, exerciseId: ex.id,
        n: r.n || wSets.filter((s) => s.exerciseId === ex.id).length + 1,
        reps: r.reps, value: r.value, unit: r.unit,
        realKg: +toKg(r.value, r.unit).toFixed(3),
      };
      row.id = await db.sets.add(row);
      wSets.push(row);
      setsByW.set(w.id, wSets);
      affected.add(ex.id);
      counts.sets++;
    }
  });

  // optional Bodyweight sheet (Date / Kg)
  const bwSheet = wb.Sheets['Bodyweight'];
  if (bwSheet) {
    const existing = new Set((await db.bodyweightLog.toArray()).map((b) => b.date));
    for (const r of XLSX.utils.sheet_to_json(bwSheet, { raw: true, defval: '' })) {
      const date = normDate(r.Date ?? r.date);
      const kg = parseFloat(r.Kg ?? r.kg);
      if (date && !isNaN(kg) && !existing.has(date)) await db.bodyweightLog.add({ date, kg });
    }
  }

  return { counts, affected: [...affected] };
}
