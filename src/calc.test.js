import { describe, it, expect } from 'vitest';
import { toKg, fmtWeight, est1RM, setTonnage, medalForStandards, medalForProgression, weekOfPeriod, dayKeyOf, mondayOf, parseISO } from './calc.js';
import { dayVolume, weekAvgLoad } from './metrics.js';

describe('unit normalization → realKg', () => {
  it('kg passes through: "100 kg" → 100 kg', () => {
    expect(toKg(100, 'kg')).toBe(100);
  });
  it('lb converts: 60 lb → 27.22 kg', () => {
    expect(toKg(60, 'lb')).toBeCloseTo(27.2155, 3);
  });
  it('x2 doubles per-arm lb: "60 lb x2" → 54.43 kg', () => {
    expect(toKg(60, 'x2')).toBeCloseTo(54.43, 2);
  });
  it('plates: "3 plates" → 120 kg (40 kg per plate)', () => {
    expect(toKg(3, 'plates')).toBe(120);
    expect(toKg(0.5, 'plates')).toBe(20);
  });
  it('handles bad input', () => {
    expect(toKg(null, 'kg')).toBe(0);
    expect(toKg(NaN, 'lb')).toBe(0);
  });
});

describe('display formatting keeps the raw entry', () => {
  it('shows what was typed, not realKg', () => {
    expect(fmtWeight(60, 'x2')).toBe('60 lb ×2');
    expect(fmtWeight(3, 'plates')).toBe('3 plates');
    expect(fmtWeight(1, 'plates')).toBe('1 plate');
    expect(fmtWeight(100, 'kg')).toBe('100 kg');
  });
});

describe('Epley est. 1RM', () => {
  it('100 kg × 8 → 126.7 kg', () => {
    expect(est1RM(100, 8)).toBeCloseTo(126.67, 1);
  });
  it('caps reps at 12', () => {
    expect(est1RM(100, 20)).toBe(est1RM(100, 12));
  });
});

describe('tonnage uses realKg, not the entered value', () => {
  const set = (value, unit, reps) => ({ value, unit, reps, realKg: toKg(value, unit) });
  it('per-set tonnage = reps × realKg', () => {
    expect(setTonnage(set(60, 'x2', 10))).toBeCloseTo(544.31, 1); // not 600
  });
  it('day volume sums realKg tonnage', () => {
    const entry = { exercises: [{ id: 'a', sets: [set(3, 'plates', 10), set(100, 'kg', 5)] }] };
    expect(dayVolume(entry)).toBe(1700); // 3 plates = 120 kg → 1200 + 500
  });
  it('secondary metric = avg(realKg) × avg(reps)', () => {
    const logs = { 1: { Mon: { finished: true, exercises: [{ id: 'a', sets: [set(100, 'kg', 10), set(50, 'kg', 6)] }] } } };
    expect(weekAvgLoad(logs, 1)).toBe(600); // avg 75 kg × avg 8 reps
  });
});

describe('medals', () => {
  it('standards: thresholds are bodyweight multiples of est. 1RM', () => {
    const ratios = [0.65, 0.85, 1.15, 1.5, 1.85]; // bench
    expect(medalForStandards(0, 70, ratios)).toBe(-1);
    expect(medalForStandards(45, 70, ratios)).toBe(-1);  // 45.5 = bronze floor
    expect(medalForStandards(46, 70, ratios)).toBe(0);   // bronze
    expect(medalForStandards(80.5, 70, ratios)).toBe(2); // gold at 1.15×70
    expect(medalForStandards(200, 70, ratios)).toBe(4);  // diamond
  });
  it('progression: % gain over first-ever session', () => {
    expect(medalForProgression(null, 50)).toBe(-1);
    expect(medalForProgression(50, 50)).toBe(0);        // bronze on first log
    expect(medalForProgression(52.5, 50)).toBe(1);      // +5% silver
    expect(medalForProgression(55, 50)).toBe(2);        // +10% gold
    expect(medalForProgression(58.75, 50)).toBe(3);     // +17.5% platinum
    expect(medalForProgression(62.5, 50)).toBe(4);      // +25% diamond
  });
});

describe('period weeks', () => {
  it('computes 1-based week from a Monday start', () => {
    expect(weekOfPeriod('2026-05-18', parseISO('2026-05-18'))).toBe(1);
    expect(weekOfPeriod('2026-05-18', parseISO('2026-05-24'))).toBe(1); // Sunday of W1
    expect(weekOfPeriod('2026-05-18', parseISO('2026-06-11'))).toBe(4); // Thu of W4
  });
  it('day helpers', () => {
    expect(dayKeyOf(parseISO('2026-06-11'))).toBe('Thu');
    expect(mondayOf(parseISO('2026-06-11')).getDate()).toBe(8);
  });
});
