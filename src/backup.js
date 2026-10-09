// GymTrack — backup safety net: full-fidelity JSON export/import + Excel export/import.
import { db } from './db.js';
import { isoDate, setTonnage, toKg, splitUnit, joinUnit, parseISO, mondayOf, weekOfPeriod, dayKeyOf, addDays } from './calc.js';

const TABLES = ['profile', 'bodyweightLog', 'periods', 'exercises', 'dayTemplates', 'routineVariants', 'workouts', 'sets', 'personalRecords'];

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
  const dump = { app: 'gymtrack', schema: 2, exportedAt: new Date().toISOString() };
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
      Date: w.date, WorkoutId: w.id, Cycle: w.cycle ?? w.week, Variant: w.variant ?? w.dayKey, Block: w.block,
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
    Start: p.startDate, CycleGoal: p.cycleGoal ?? p.weeks, Cycle: p.cycle ?? '', Status: p.status, End: p.endDate || '',
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
    return Number.isNaN(d.getTime()) ? null : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (us) match = [us[0], us[3].length === 2 ? '20' + us[3] : us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0')];
  }
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

  const present = (...names) => raw.some((row) => get(row, ...names) !== undefined);
  const hasWorkoutIdentity = present('workoutid', 'workout id', 'sessionid', 'session id', 'session');
  const hasStructuredIdentity = hasWorkoutIdentity || present('cycle', 'ciclo') || present('variant', 'variante');

  const rows = [];
  for (const r of raw) {
    const date = normDate(get(r, 'date', 'fecha'));
    const name = String(get(r, 'exercise', 'ejercicio', 'name') || '').trim();
    const reps = parseInt(get(r, 'reps', 'repeticiones'), 10);
    const value = parseFloat(get(r, 'value', 'weight', 'peso'));
    if (!date || !name || isNaN(reps) || isNaN(value)) continue;
    const sourceWorkoutId = get(r, 'workoutid', 'workout id', 'sessionid', 'session id', 'session');
    const cycle = parseInt(get(r, 'cycle', 'ciclo'), 10);
    rows.push({
      date, name, reps, value,
      unit: normUnit(get(r, 'unit', 'unidad')),
      n: parseInt(get(r, 'set', 'serie'), 10) || null,
      muscle: String(get(r, 'muscle', 'musculo') || '').trim(),
      block: String(get(r, 'block', 'bloque') || '').trim(),
      cycle: Number.isFinite(cycle) && cycle > 0 ? cycle : null,
      variant: String(get(r, 'variant', 'variante') || '').trim() || null,
      sourceWorkoutId: sourceWorkoutId == null || sourceWorkoutId === '' ? null : String(sourceWorkoutId).trim(),
    });
  }
  if (!rows.length) throw new Error('No valid rows (need Date, Exercise, Value, Reps)');
  rows.sort((a, b) => a.date.localeCompare(b.date)
    || String(a.sourceWorkoutId || '').localeCompare(String(b.sourceWorkoutId || ''))
    || String(a.variant || '').localeCompare(String(b.variant || ''))
    || (a.n || 0) - (b.n || 0));

  const counts = { sets: 0, workouts: 0, exercises: 0, skipped: 0 };
  const affected = new Set();

  await db.transaction('rw', [db.exercises, db.workouts, db.sets, db.periods], async () => {
    const [exercises, workouts, allSets, periods] = await Promise.all([
      db.exercises.toArray(), db.workouts.toArray(), db.sets.toArray(), db.periods.toArray(),
    ]);
    const exByName = new Map(exercises.map((e) => [e.name.toLowerCase(), e]));
    const fallbackByDate = new Map();
    const bySourceId = new Map();
    const byStructuredIdentity = new Map();
    const workoutIdentityKey = (r) => hasWorkoutIdentity && r.sourceWorkoutId
      ? `source:${r.sourceWorkoutId}`
      : (hasStructuredIdentity ? `structured:${r.date}|${r.cycle ?? ''}|${r.variant ?? ''}|${r.block || ''}` : `date:${r.date}`);
    const existingStructuredKey = (w) => `structured:${w.date}|${w.cycle ?? ''}|${w.variant ?? ''}|${w.block || ''}`;
    for (const w of workouts) {
      if (!fallbackByDate.has(w.date)) fallbackByDate.set(w.date, w);
      if (w.importSourceId != null) bySourceId.set(`source:${String(w.importSourceId)}`, w);
      bySourceId.set(`source:${String(w.id)}`, w);
      if (!byStructuredIdentity.has(existingStructuredKey(w))) byStructuredIdentity.set(existingStructuredKey(w), w);
    }
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

      const key = workoutIdentityKey(r);
      let w = key.startsWith('source:') ? bySourceId.get(key) : byStructuredIdentity.get(key);
      if (!w && !hasStructuredIdentity) w = fallbackByDate.get(r.date);
      if (!w) {
        const p = periodFor(r.date);
        const week = Math.max(1, weekOfPeriod(p.startDate, parseISO(r.date)));
        const dayKey = dayKeyOf(parseISO(r.date));
        w = {
          date: r.date, periodId: p.id, week,
          dayKey, templateDay: dayKey,
          cycle: r.cycle ?? week, variant: r.variant ?? dayKey,
          block: r.block || 'Imported', finished: true, entries: [],
        };
        if (r.sourceWorkoutId) w.importSourceId = r.sourceWorkoutId;
        w.id = await db.workouts.add(w);
        fallbackByDate.set(r.date, w);
        byStructuredIdentity.set(existingStructuredKey(w), w);
        if (r.sourceWorkoutId) bySourceId.set(`source:${r.sourceWorkoutId}`, w);
        bySourceId.set(`source:${String(w.id)}`, w);
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

  // optional Bodyweight sheet (Date / Kg). Merge by date without replacing history,
  // then sync only bodyweightKg from the latest valid row across existing + imported log.
  const bwSheet = wb.Sheets['Bodyweight'];
  if (bwSheet) {
    const bwRows = XLSX.utils.sheet_to_json(bwSheet, { raw: true, defval: '' });
    const bwGet = (row, ...names) => {
      for (const k of Object.keys(row)) {
        if (names.includes(k.toLowerCase().trim())) return row[k];
      }
      return undefined;
    };
    const valid = [];
    for (const r of bwRows) {
      const date = normDate(bwGet(r, 'date', 'fecha'));
      const kg = parseFloat(bwGet(r, 'kg', 'bodyweight', 'bodyweightkg', 'weight', 'peso'));
      if (date && Number.isFinite(kg) && kg > 0) valid.push({ date, kg });
    }
    if (valid.length) {
      await db.transaction('rw', [db.bodyweightLog, db.profile], async () => {
        const existingRows = await db.bodyweightLog.toArray();
        const existing = new Set(existingRows.map((b) => b.date));
        for (const row of valid) {
          if (!existing.has(row.date)) {
            await db.bodyweightLog.add(row);
            existingRows.push(row);
            existing.add(row.date);
          }
        }
        const mergedValid = existingRows
          .filter((b) => normDate(b.date) && Number.isFinite(Number(b.kg)) && Number(b.kg) > 0)
          .sort((a, b) => a.date.localeCompare(b.date));
        const latest = mergedValid[mergedValid.length - 1];
        if (latest) {
          const profile = (await db.profile.get(1)) || { id: 1 };
          await db.profile.put({ ...profile, bodyweightKg: Number(latest.kg) });
        }
      });
    }
  }

  return { counts, affected: [...affected] };
}
