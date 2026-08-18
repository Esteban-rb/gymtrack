// Unit tests for the Home dashboard helpers: daily picks, per-session history,
// streaks and the auto-finish rule.
import { describe, it, expect } from 'vitest';
import { exerciseHistory, hashSeed, pickDaily, streakInfo, trainedDates, shouldAutoFinish } from './metrics.js';

const W = (id, date, finished, entries) => ({ id, date, finished, periodId: 1, entries: entries.map((e) => ({ exerciseId: e })) });
const S = (exerciseId, realKg) => ({ exerciseId, realKg, reps: 8, n: 1 });

describe('pickDaily', () => {
  it('is stable for the same seed and spreads across the list', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    expect(pickDaily(list, '2026-08-18|U1')).toBe(pickDaily(list, '2026-08-18|U1'));
    const picks = new Set(Array.from({ length: 40 }, (_, i) => pickDaily(list, '2026-08-' + i)));
    expect(picks.size).toBeGreaterThan(1);   // a different day can land on a different exercise
  });

  it('returns null for an empty list and never leaves the list', () => {
    expect(pickDaily([], 'x')).toBe(null);
    expect(pickDaily(null, 'x')).toBe(null);
    const list = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(list).toContain(pickDaily(list, 'seed' + i));
  });

  it('hashes to a non-negative 32-bit integer', () => {
    for (const s of ['', 'a', '2026-08-18|L3|c2']) {
      const h = hashSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('exerciseHistory', () => {
  const workouts = [W(1, '2026-08-01', true, ['bench']), W(2, '2026-08-05', true, ['bench']), W(3, '2026-08-03', true, ['squat'])];
  const sets = { 1: [S('bench', 60), S('bench', 65)], 2: [S('bench', 70)], 3: [S('squat', 100)] };

  it('keeps the top set of each session, sorted by date', () => {
    expect(exerciseHistory(workouts, sets, 'bench')).toEqual([
      { date: '2026-08-01', kg: 65 },
      { date: '2026-08-05', kg: 70 },
    ]);
  });

  it('honours the limit and returns [] for an untrained exercise', () => {
    expect(exerciseHistory(workouts, sets, 'bench', 1)).toEqual([{ date: '2026-08-05', kg: 70 }]);
    expect(exerciseHistory(workouts, sets, 'rdl')).toEqual([]);
  });
});

describe('streakInfo', () => {
  it('counts consecutive days ending today', () => {
    const s = streakInfo(['2026-08-16', '2026-08-17', '2026-08-18'], '2026-08-18');
    expect(s.current).toBe(3);
    expect(s.best).toBe(3);
    expect(s.trainedToday).toBe(true);
  });

  it('keeps the streak alive on a day not trained yet', () => {
    const s = streakInfo(['2026-08-16', '2026-08-17'], '2026-08-18');
    expect(s.current).toBe(2);
    expect(s.trainedToday).toBe(false);
  });

  it('drops to zero after a missed day, but remembers the best run', () => {
    const s = streakInfo(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-15'], '2026-08-18');
    expect(s.current).toBe(0);
    expect(s.best).toBe(3);
    expect(s.total).toBe(4);
    expect(s.lastDate).toBe('2026-08-15');
  });

  it('handles no history and crossing a month boundary', () => {
    expect(streakInfo([], '2026-08-18')).toMatchObject({ current: 0, best: 0, total: 0, lastDate: null });
    expect(streakInfo(['2026-07-31', '2026-08-01'], '2026-08-01').current).toBe(2);
  });

  it('ignores unfinished sessions when collecting days', () => {
    const dates = trainedDates([W(1, '2026-08-17', true, []), W(2, '2026-08-18', false, []), W(3, '2026-08-17', true, [])]);
    expect(dates).toEqual(['2026-08-17']);
  });
});

describe('shouldAutoFinish', () => {
  const w = W(1, '2026-08-18', false, ['bench', 'squat']);
  const two = [S('bench'), S('bench'), S('squat'), S('squat')];

  it('fires only when every exercise of the plan reached the minimum', () => {
    expect(shouldAutoFinish(w, [S('bench'), S('bench'), S('squat')])).toBe(false);
    expect(shouldAutoFinish(w, two)).toBe(true);
  });

  it('never re-fires on a finished session, an empty plan or no workout', () => {
    expect(shouldAutoFinish({ ...w, finished: true }, two)).toBe(false);
    expect(shouldAutoFinish(W(1, '2026-08-18', false, []), two)).toBe(false);
    expect(shouldAutoFinish(null, two)).toBe(false);
    expect(shouldAutoFinish(w, undefined)).toBe(false);
  });

  it('ignores extra sets of exercises outside the plan', () => {
    expect(shouldAutoFinish(w, [S('bench'), S('bench'), S('curl'), S('curl'), S('squat')])).toBe(false);
  });
});
