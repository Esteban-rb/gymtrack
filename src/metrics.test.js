import { describe, expect, it } from 'vitest';
import { buildLogs, dayPRs, dayVolume, entryForWorkout, historySlots, lastSetsBeforeByExercise, workoutsDone } from './metrics.js';

const workout = (id, date) => ({
  id,
  date,
  periodId: 1,
  cycle: 1,
  variant: 'U1',
  block: 'Upper 1',
  finished: true,
  entries: [{ exerciseId: 'bench' }],
});

const set = (id, workoutId, realKg) => ({
  id,
  workoutId,
  exerciseId: 'bench',
  n: 1,
  realKg,
  value: realKg,
  unit: 'kg',
  reps: 10,
});

describe('repeated sessions in one cycle and variant', () => {
  const workouts = [workout(1, '2026-09-01'), workout(2, '2026-09-02')];
  const sets = { 1: [set(1, 1, 50)], 2: [set(2, 2, 60)] };
  const logs = buildLogs(workouts, sets, 1, { bench: { name: 'Bench Press' } });

  it('keeps and counts every workout instead of overwriting the first', () => {
    expect(Object.keys(logs[1])).toHaveLength(2);
    expect(workoutsDone(logs)).toBe(2);
    expect(Object.values(logs[1]).map(dayVolume)).toEqual([500, 600]);
    expect(entryForWorkout(logs, 1, 1)?.workoutId).toBe(1);
    expect(entryForWorkout(logs, 1, 2)?.workoutId).toBe(2);
  });

  it('compares a repeated session PR with the earlier session in the same cycle', () => {
    expect(dayPRs(logs, 1, 'U1', 2)).toEqual([
      expect.objectContaining({ id: 'bench', set: expect.objectContaining({ realKg: 60 }) }),
    ]);
    expect(dayPRs(logs, 1, 'U1', 1)).toHaveLength(1);
  });

  it('shows repeated sessions alongside pending rotation slots in active history', () => {
    const slots = historySlots(logs[1], [
      { code: 'U1', name: 'Upper' },
      { code: 'L1', name: 'Lower' },
    ], true);

    expect(slots.map((slot) => slot.key)).toEqual(['U1', 'L1', 'U1#2']);
  });

  it('does not double-count sets from duplicate exercise entries', () => {
    const duplicated = { ...workout(3, '2026-09-03'), entries: [{ exerciseId: 'bench' }, { exerciseId: 'bench' }] };
    const duplicateLogs = buildLogs([duplicated], { 3: [set(3, 3, 70)] }, 1, { bench: { name: 'Bench Press' } });

    expect(duplicateLogs[1].U1.exercises).toHaveLength(1);
    expect(dayVolume(duplicateLogs[1].U1)).toBe(700);
  });
});

describe('previous-session index', () => {
  it('builds the latest prior sets for every exercise in one pass', () => {
    const workouts = [
      { ...workout(1, '2026-08-01'), entries: [{ exerciseId: 'bench' }] },
      { ...workout(2, '2026-08-03'), entries: [{ exerciseId: 'bench' }] },
      { ...workout(3, '2026-08-02'), entries: [{ exerciseId: 'row' }] },
    ];
    const sets = {
      1: [set(1, 1, 50)],
      2: [set(2, 2, 60)],
      3: [{ ...set(3, 3, 40), exerciseId: 'row' }],
    };

    const index = lastSetsBeforeByExercise(workouts, sets, '2026-08-04');
    expect(index.bench).toMatchObject({ date: '2026-08-03' });
    expect(index.bench.sets[0].realKg).toBe(60);
    expect(index.row).toMatchObject({ date: '2026-08-02' });
  });

  it('uses an earlier workout from the same day as the previous session', () => {
    const workouts = [workout(1, '2026-08-04'), workout(2, '2026-08-04')];
    const sets = { 1: [set(1, 1, 50)], 2: [set(2, 2, 60)] };

    const index = lastSetsBeforeByExercise(workouts, sets, workouts[1]);

    expect(index.bench).toMatchObject({ date: '2026-08-04', workoutId: 1 });
    expect(index.bench.sets[0].realKg).toBe(50);
  });
});
