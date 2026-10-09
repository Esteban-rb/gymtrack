// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db.js';
import { exportXLSX, importXLSX } from './backup.js';

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
    const upperId = await db.workouts.add({ date: '2026-06-11', periodId, cycle: 2, variant: 'U1', week: 2, dayKey: 'Thu', templateDay: 'Thu', block: 'Upper 1', finished: true, entries: [{ exerciseId: 'bench' }] });
    const lowerId = await db.workouts.add({ date: '2026-06-11', periodId, cycle: 2, variant: 'L1', week: 2, dayKey: 'Thu', templateDay: 'Thu', block: 'Lower 1', finished: true, entries: [{ exerciseId: 'bench' }] });
    await db.sets.bulkAdd([
      { workoutId: upperId, exerciseId: 'bench', n: 1, reps: 8, value: 80, unit: 'kg', realKg: 80 },
      { workoutId: lowerId, exerciseId: 'bench', n: 1, reps: 10, value: 120, unit: 'kg', realKg: 120 },
    ]);

    const exported = await captureExport();
    const exportedWb = await readWorkbook(exported);
    const exportedRows = (await import('xlsx')).utils.sheet_to_json(exportedWb.Sheets.Sets, { raw: true });
    expect(exportedRows.map((row) => row.WorkoutId)).toEqual([upperId, lowerId]);

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
