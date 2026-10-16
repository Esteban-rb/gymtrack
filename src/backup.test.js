// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db.js';
import { exportJSON, exportXLSX, importXLSX } from './backup.js';
import { decodeRoutineFile } from './routine-import.js';

const TABLES = ['profile', 'bodyweightLog', 'periods', 'exercises', 'dayTemplates', 'routineVariants', 'workouts', 'sets', 'personalRecords'];

async function resetDb() {
  await db.open();
  await db.transaction('rw', TABLES.map((name) => db.table(name)), async () => {
    for (const name of TABLES) await db.table(name).clear();
  });
}

async function workbookFile(sheets, name = 'history.xlsx') {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return new File([blob], name, { type: blob.type });
}

async function readWorkbook(blob) {
  const XLSX = await import('xlsx');
  return XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
}

async function captureExport() {
  let blob;
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
    blob = value;
    return 'blob:gymtrack-test';
  });
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.fn();
  const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'a') return { click };
    return document.createElement(tag);
  });
  try {
    await exportXLSX();
  } finally {
    createElement.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  }
  expect(click).toHaveBeenCalledTimes(1);
  return blob;
}

beforeEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await resetDb();
});

describe('Excel history roundtrip identity', () => {
  it('exports stable workout identity and re-imports app history without losing cycle or variant', async () => {
    const periodId = await db.periods.add({ startDate: '2026-06-01', cycleGoal: 6, status: 'active', rotationPos: 0, cycle: 3 });
    await db.exercises.put({ id: 'bench', name: 'Bench Press', muscle: 'Chest', unit: 'kg', active: true, order: 0 });
    await db.routineVariants.bulkPut([
      { code: 'U1', order: 0, name: 'Upper 1', kind: 'Upper', exerciseIds: ['bench'] },
      { code: 'L1', order: 1, name: 'Lower 1', kind: 'Lower', exerciseIds: ['bench'] },
    ]);
    const upperId = await db.workouts.add({ date: '2026-06-11', periodId, cycle: 2, variant: 'U1', week: 2, dayKey: 'Thu', templateDay: 'Thu', block: 'Upper 1', finished: true, entries: [{ exerciseId: 'bench' }] });
    const lowerId = await db.workouts.add({ date: '2026-06-11', periodId, cycle: 2, variant: 'L1', week: 2, dayKey: 'Thu', templateDay: 'Thu', block: 'Lower 1', finished: true, entries: [{ exerciseId: 'bench' }] });
    await db.sets.bulkAdd([
      { workoutId: upperId, exerciseId: 'bench', n: 1, reps: 8, value: 80, unit: 'kg', realKg: 80 },
      { workoutId: lowerId, exerciseId: 'bench', n: 1, reps: 10, value: 120, unit: 'kg', realKg: 120 },
    ]);

    const exported = await captureExport();
    const exportedWb = await readWorkbook(exported);
    const exportedRows = (await import('xlsx')).utils.sheet_to_json(exportedWb.Sheets.Sets, { raw: true });
    expect(exportedRows.map((row) => row['Workout ID'])).toEqual([upperId, lowerId]);

    await db.transaction('rw', [db.workouts, db.sets], async () => {
      await db.sets.clear();
      await db.workouts.clear();
    });

    const first = await importXLSX(new File([exported], 'roundtrip.xlsx', { type: exported.type }));
    const second = await importXLSX(new File([exported], 'roundtrip-again.xlsx', { type: exported.type }));
    const workouts = await db.workouts.orderBy('id').toArray();
    const sets = await db.sets.orderBy('id').toArray();

    expect(first.counts).toMatchObject({ workouts: 2, sets: 2, skipped: 0 });
    expect(second.counts).toMatchObject({ workouts: 0, sets: 0, skipped: 2 });
    expect(workouts.map((w) => ({ date: w.date, cycle: w.cycle, variant: w.variant, block: w.block }))).toEqual([
      { date: '2026-06-11', cycle: 2, variant: 'U1', block: 'Upper 1' },
      { date: '2026-06-11', cycle: 2, variant: 'L1', block: 'Lower 1' },
    ]);
    expect(new Set(sets.map((set) => set.workoutId))).toEqual(new Set(workouts.map((w) => w.id)));
  });

  it('keeps same-date sessions separate when imported rows supply workout identity', async () => {
    const periodId = await db.periods.add({ startDate: '2026-06-01', cycleGoal: 6, status: 'active', rotationPos: 0, cycle: 1 });
    const existingWorkoutId = await db.workouts.add({ date: '2026-06-11', periodId, cycle: 1, variant: 'U1', week: 1, dayKey: 'Thu', templateDay: 'Thu', block: 'Upper 1', finished: true, entries: [] });
    await db.exercises.put({ id: 'unrelated', name: 'Unrelated', muscle: 'Back', unit: 'kg', active: true, order: 0 });
    await db.sets.add({ workoutId: existingWorkoutId, exerciseId: 'unrelated', n: 1, reps: 5, value: 40, unit: 'kg', realKg: 40 });
    const file = await workbookFile({
      Sets: [
        { Date: '2026-06-11', WorkoutId: 'app-1', Cycle: 1, Variant: 'U1', Block: 'Upper 1', Exercise: 'Bench Press', Muscle: 'Chest', Set: 1, Value: 80, Unit: 'kg', Reps: 8 },
        { Date: '2026-06-11', WorkoutId: 'app-2', Cycle: 1, Variant: 'L1', Block: 'Lower 1', Exercise: 'Hack Squat', Muscle: 'Quads', Set: 1, Value: 3, Unit: 'plates', Reps: 10 },
      ],
    });

    const result = await importXLSX(file);
    const again = await importXLSX(file);
    const workouts = await db.workouts.orderBy('id').toArray();
    const sets = await db.sets.orderBy('id').toArray();

    expect(result.counts.workouts).toBe(2);
    expect(again.counts).toMatchObject({ workouts: 0, sets: 0, skipped: 2 });
    expect(workouts).toHaveLength(3);
    expect(workouts.find((w) => w.id === existingWorkoutId)).toMatchObject({ date: '2026-06-11', variant: 'U1' });
    expect(workouts.map((w) => [w.date, w.cycle, w.variant, w.block])).toEqual([
      ['2026-06-11', 1, 'U1', 'Upper 1'],
      ['2026-06-11', 1, 'U1', 'Upper 1'],
      ['2026-06-11', 1, 'L1', 'Lower 1'],
    ]);
    expect(sets).toHaveLength(3);
    expect(sets.some((set) => set.workoutId === existingWorkoutId && set.exerciseId === 'unrelated')).toBe(true);
    expect(sets.filter((set) => set.exerciseId === 'unrelated')).toHaveLength(1);
  });
});

describe('Excel bodyweight profile merge', () => {
  it('updates profile from latest chronological valid bodyweight without older imports overriding newer history', async () => {
    await db.profile.put({ id: 1, age: 18, bodyweightKg: 80, theme: 'dark' });
    await db.bodyweightLog.add({ date: '2026-06-10', kg: 81 });
    const file = await workbookFile({
      Sets: [{ Date: '2026-06-09', Exercise: 'Bench Press', Set: 1, Value: 50, Unit: 'kg', Reps: 8 }],
      Bodyweight: [
        { Date: '2026-06-01', Kg: 70 },
        { Date: '2026-06-12', Kg: 82.5 },
        { Date: '2026-06-13', Kg: -5 },
        { Date: 'not-a-date', Kg: 90 },
      ],
    });

    await importXLSX(file);
    const profile = await db.profile.get(1);
    const bodyweight = await db.bodyweightLog.orderBy('date').toArray();

    expect(profile).toMatchObject({ id: 1, age: 18, theme: 'dark', bodyweightKg: 82.5 });
    expect(bodyweight.map(({ date, kg }) => ({ date, kg }))).toEqual([
      { date: '2026-06-01', kg: 70 },
      { date: '2026-06-10', kg: 81 },
      { date: '2026-06-12', kg: 82.5 },
    ]);
  });

  it('rejects impossible calendar dates while preserving valid leap-day weights and existing history', async () => {
    await db.profile.put({ id: 1, age: 18, bodyweightKg: 80, theme: 'dark' });
    await db.bodyweightLog.bulkAdd([
      { date: '2026-06-10', kg: 81 },
      { date: '2024-02-29', kg: 79 },
    ]);
    const file = await workbookFile({
      Sets: [{ Date: '2026-06-09', Exercise: 'Bench Press', Set: 1, Value: 50, Unit: 'kg', Reps: 8 }],
      Bodyweight: [
        { Date: '2026-99-99', Kg: 99 },
        { Date: '2026-02-29', Kg: 98 },
        { Date: '2026-04-31', Kg: 97 },
        { Date: '2024-02-29', Kg: 82 },
        { Date: '6/11/2026', Kg: 83 },
      ],
    });

    await importXLSX(file);
    expect(await db.profile.get(1)).toMatchObject({ id: 1, age: 18, theme: 'dark', bodyweightKg: 83 });
    expect(await db.bodyweightLog.orderBy('date').toArray()).toEqual([
      expect.objectContaining({ date: '2024-02-29', kg: 79 }),
      expect.objectContaining({ date: '2026-06-10', kg: 81 }),
      expect.objectContaining({ date: '2026-06-11', kg: 83 }),
    ]);
  });

  it('ignores invalid bodyweight rows and does not reset profile fields', async () => {
    await db.profile.put({ id: 1, age: 18, bodyweightKg: 80, theme: 'dark' });
    await db.bodyweightLog.add({ date: '2026-06-10', kg: 81 });
    const file = await workbookFile({
      Sets: [{ Date: '2026-06-09', Exercise: 'Bench Press', Set: 1, Value: 50, Unit: 'kg', Reps: 8 }],
      Bodyweight: [
        { Date: '2026-06-12', Kg: 0 },
        { Date: '2026-06-13', Kg: -5 },
        { Date: 'oops', Kg: 82 },
      ],
    });

    await importXLSX(file);
    const profile = await db.profile.get(1);
    const bodyweight = await db.bodyweightLog.orderBy('date').toArray();

    expect(profile).toEqual({ id: 1, age: 18, bodyweightKg: 80, theme: 'dark' });
    expect(bodyweight.map(({ date, kg }) => ({ date, kg }))).toEqual([{ date: '2026-06-10', kg: 81 }]);
  });
});

describe('Excel export layout', () => {
  async function seedWorkout() {
    const periodId = await db.periods.add({ startDate: '2026-06-01', cycleGoal: 6, status: 'active', rotationPos: 0, cycle: 2 });
    await db.exercises.bulkPut([
      { id: 'bench', name: 'Bench Press', muscle: 'Chest', unit: 'kg', active: true, order: 0 },
      { id: 'lat', name: 'Cable Lateral Raises', muscle: 'Shoulders', unit: 'lbx2', active: true, order: 1 },
      { id: 'hack', name: 'Hack Squat', muscle: 'Quads', unit: 'plates', active: true, order: 2 },
    ]);
    await db.routineVariants.bulkPut([
      { code: 'U1', order: 0, name: 'Upper 1', kind: 'Upper', exerciseIds: ['bench', 'lat'] },
      { code: 'L1', order: 1, name: 'Lower 1', kind: 'Lower', exerciseIds: ['hack'], exerciseUnits: { hack: 'plates' } },
    ]);
    const w1 = await db.workouts.add({ date: '2026-06-11', periodId, cycle: 2, variant: 'U1', week: 2, dayKey: 'Thu', templateDay: 'Thu', block: 'Upper 1', finished: true, entries: [{ exerciseId: 'bench' }, { exerciseId: 'lat' }] });
    const w2 = await db.workouts.add({ date: '2026-06-12', periodId, cycle: 2, variant: 'L1', week: 2, dayKey: 'Fri', templateDay: 'Fri', block: 'Lower 1', finished: true, entries: [{ exerciseId: 'hack' }] });
    await db.sets.bulkAdd([
      { workoutId: w1, exerciseId: 'bench', n: 1, reps: 8, value: 82.5, unit: 'kg', realKg: 82.5 },
      { workoutId: w1, exerciseId: 'bench', n: 2, reps: 8, value: 82.5, unit: 'kg', realKg: 82.5 },
      { workoutId: w1, exerciseId: 'lat', n: 1, reps: 12, value: 20, unit: 'lbx2', realKg: 18.14 },
      { workoutId: w2, exerciseId: 'hack', n: 1, reps: 10, value: 3, unit: 'plates', realKg: 90 },
    ]);
    return { w1, w2 };
  }

  it('lays Sets out as Date, Exercise, Set, Reps, Weight, Muscle, Variant, Cycle, Workout ID — no Block, Value, Unit or derived columns', async () => {
    const { w1 } = await seedWorkout();
    const wb = await readWorkbook(await captureExport());
    const XLSX = await import('xlsx');
    expect(wb.SheetNames).toEqual(['Sets', 'Routine', 'Bodyweight', 'Exercises', 'Periods']);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Sets, { raw: true });
    expect(Object.keys(rows[0])).toEqual(['Date', 'Exercise', 'Set', 'Reps', 'Weight', 'Muscle', 'Variant', 'Cycle', 'Workout ID']);
    expect(rows.map((r) => r.Weight)).toEqual(['82.5 kg', '82.5 kg', '20 lb ×2', '3 plates']);
    expect(rows[0]).toMatchObject({ Date: '2026-06-11', Exercise: 'Bench Press', Set: 1, Reps: 8, Muscle: 'Chest', Variant: 'U1', Cycle: 2, 'Workout ID': w1 });
  });

  it('colours the Sets columns in groups', async () => {
    await seedWorkout();
    const wb = (await import('xlsx-js-style')).default.read(new Uint8Array(await (await captureExport()).arrayBuffer()), { type: 'array', cellStyles: true });
    const fill = (addr) => wb.Sheets.Sets[addr].s?.fgColor?.rgb ?? wb.Sheets.Sets[addr].s?.fill?.fgColor?.rgb;
    const header = ['A1', 'B1', 'F1', 'H1'].map(fill);
    expect(new Set(header).size).toBe(4);              // date / training / muscle / identity
    expect(fill('B1')).toBe(fill('E1'));                // Exercise..Weight share a colour
    expect(fill('F1')).toBe(fill('G1'));                // Muscle + Variant
    expect(fill('H1')).toBe(fill('I1'));                // Cycle + Workout ID
  });

  it('adds a Routine sheet the routine importer reads back', async () => {
    await seedWorkout();
    const exported = await captureExport();
    const XLSX = await import('xlsx');
    const rows = XLSX.utils.sheet_to_json((await readWorkbook(exported)).Sheets.Routine, { raw: true });
    expect(rows[0]).toEqual({ Code: 'U1', 'Routine name': 'Upper 1', Kind: 'Upper', 'Routine order': 1, 'Exercise order': 1, Exercise: 'Bench Press', Muscle: 'Chest', Unit: 'kg' });

    const catalog = await db.exercises.toArray();
    const decoded = await decodeRoutineFile(new File([exported], 'gymtrack.xlsx'), catalog);
    expect(decoded.errors).toEqual([]);
    expect(decoded.valid).toBe(true);
    expect(decoded.draft.variants.map((v) => [v.code, v.name, v.exercises.map((e) => [e.ref.id, e.unit])])).toEqual([
      ['U1', 'Upper 1', [['bench', 'kg'], ['lat', 'lbx2']]],
      ['L1', 'Lower 1', [['hack', 'plates']]],
    ]);
  });

  it('re-imports Weight into value + unit and keeps repeated identical sets', async () => {
    const { w1 } = await seedWorkout();
    const exported = await captureExport();
    await db.transaction('rw', [db.workouts, db.sets], async () => { await db.sets.clear(); await db.workouts.clear(); });

    const result = await importXLSX(new File([exported], 'roundtrip.xlsx'));
    expect(result.counts).toMatchObject({ workouts: 2, sets: 4, skipped: 0 });
    expect(result.hasRoutine).toBe(true);
    const sets = (await db.sets.orderBy('id').toArray()).sort((a, b) => a.workoutId - b.workoutId || a.exerciseId.localeCompare(b.exerciseId) || a.n - b.n);
    expect(sets.map((s) => [s.exerciseId, s.n, s.reps, s.value, s.unit])).toEqual([
      ['bench', 1, 8, 82.5, 'kg'], ['bench', 2, 8, 82.5, 'kg'], ['lat', 1, 12, 20, 'lbx2'], ['hack', 1, 10, 3, 'plates'],
    ]);
    const workouts = await db.workouts.orderBy('id').toArray();
    expect(workouts.map((w) => [w.date, w.cycle, w.variant, w.block])).toEqual([
      ['2026-06-11', 2, 'U1', 'Upper 1'], ['2026-06-12', 2, 'L1', 'Lower 1'],
    ]);
    expect(w1).toBeGreaterThan(0);
  });

  it('still imports the older Value + Unit + Block layout', async () => {
    const file = await workbookFile({
      Sets: [{ Date: '2026-06-09', Exercise: 'Bench Press', Block: 'Upper 1', Set: 1, Value: 50, Unit: 'lb', Reps: 8 }],
    });
    await importXLSX(file);
    const [set] = await db.sets.toArray();
    expect(set).toMatchObject({ value: 50, unit: 'lb', reps: 8 });
  });
});

describe('JSON backup routine', () => {
  it('carries the active routine, which the routine importer accepts', async () => {
    await db.periods.add({ startDate: '2026-06-01', cycleGoal: 6, status: 'active', rotationPos: 0, cycle: 1 });
    await db.exercises.bulkPut([
      { id: 'bench', name: 'Bench Press', muscle: 'Chest', unit: 'kg', active: true, order: 0 },
      { id: 'hack', name: 'Hack Squat', muscle: 'Quads', unit: 'plates', active: true, order: 1 },
    ]);
    await db.routineVariants.bulkPut([
      { code: 'U1@p1r1', order: 0, name: 'Upper 1', kind: 'Upper', exerciseIds: ['bench'], exerciseUnits: { bench: 'lb' }, ownerPeriodId: 1 },
      { code: 'L1', order: 1, name: 'Lower 1', kind: 'Lower', exerciseIds: ['hack'] },
    ]);
    let blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => { blob = value; return 'blob:json'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'a' ? { click() {} } : realCreate(tag)));
    await exportJSON();
    vi.restoreAllMocks();

    const dump = JSON.parse(await blob.text());
    expect(dump.routine.variants.map((v) => v.code)).toEqual(['L1']); // the owned U1 is not part of the active period's seed routine
    const decoded = await decodeRoutineFile(new File([blob], 'gymtrack-backup.json'), await db.exercises.toArray());
    expect(decoded.valid).toBe(true);
    expect(decoded.draft.variants[0].exercises[0]).toMatchObject({ name: 'Hack Squat', unit: 'plates' });
  });

  it('rebuilds the routine for older backups that have no routine key', async () => {
    const dump = {
      app: 'gymtrack', schema: 2, periods: [{ id: 1, status: 'active', startDate: '2026-06-01' }],
      exercises: [{ id: 'bench', name: 'Bench Press', muscle: 'Chest', unit: 'kg' }],
      routineVariants: [{ code: 'U1', order: 0, name: 'Upper 1', kind: 'Upper', exerciseIds: ['bench'] }],
      sets: [], workouts: [],
    };
    const decoded = await decodeRoutineFile(new File([JSON.stringify(dump)], 'old.json'), [{ id: 'bench', name: 'Bench Press', muscle: 'Chest', unit: 'kg' }]);
    expect(decoded.valid).toBe(true);
    expect(decoded.draft.variants[0]).toMatchObject({ code: 'U1', name: 'Upper 1' });
  });
});
