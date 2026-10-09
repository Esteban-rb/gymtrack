import { describe, it, expect } from 'vitest';
import { validateSchedule, selectScheduledVariant, advanceIndependentSchedule, legacyScheduleFromVariants } from './schedule.js';

const codes = ['U1', 'L1', 'U2', 'L2', 'U3', 'L3'];

describe('pure scheduler', () => {
  it('validates weekly mappings, defaults missing weekdays to rest, and selects all weekdays including weekends', () => {
    const schedule = { mode: 'weekly', week: { Mon: 'U1', Wed: 'L1', Sun: 'U2' } };
    expect(validateSchedule(schedule, codes)).toEqual({ valid: true, errors: [] });
    expect(selectScheduledVariant(schedule, { date: '2024-02-26' })).toMatchObject({ variant: 'U1', isRest: false });
    expect(selectScheduledVariant(schedule, { date: '2024-03-02' })).toMatchObject({ variant: null, isRest: true });
    expect(selectScheduledVariant(schedule, { date: '2024-03-03' })).toMatchObject({ variant: 'U2', isRest: false });
  });

  it('keeps explicit rest and missed dates from shifting the weekly map', () => {
    const schedule = { mode: 'weekly', week: { Mon: null, Tue: 'L1' } };
    expect(selectScheduledVariant(schedule, { date: '2024-01-01' })).toMatchObject({ variant: null, isRest: true });
    expect(selectScheduledVariant(schedule, { date: '2024-01-09' })).toMatchObject({ variant: 'L1', isRest: false });
  });

  it('advances arbitrary ordered independent rotations only on explicit completion and wraps cycle', () => {
    const schedule = { mode: 'independent', rotation: ['L3', 'U1', 'L1', 'U2', 'L2', 'U3'] };
    expect(selectScheduledVariant(schedule, { rotationPos: 0 })).toMatchObject({ variant: 'L3', isRest: false });
    expect(advanceIndependentSchedule(schedule, { rotationPos: 5, cycle: 4, completed: false })).toEqual({ rotationPos: 5, cycle: 4 });
    expect(advanceIndependentSchedule(schedule, { rotationPos: 5, cycle: 4, completed: true })).toEqual({ rotationPos: 0, cycle: 5 });
  });

  it('accepts small rotations and preserves caller order in the legacy adapter', () => {
    expect(validateSchedule({ mode: 'independent', rotation: ['L1'] }, codes).valid).toBe(true);
    expect(legacyScheduleFromVariants([{ code: 'L3' }, { code: 'U1' }])).toEqual({ mode: 'independent', rotation: ['L3', 'U1'] });
  });

  it.each([
    [{ mode: 'weekly', week: { Mon: 'BAD' } }, 'unknown_variant'],
    [{ mode: 'weekly', week: { Mno: 'U1' } }, 'unknown_day'],
    [{ mode: 'typo', week: {} }, 'unknown_mode'],
    [{ mode: 'independent', rotation: ['U1', 'U1'] }, 'duplicate_variant'],
    [{ mode: 'independent', rotation: [] }, 'empty_rotation'],
  ])('reports structured validation errors for invalid schedule %j', (schedule, code) => {
    expect(validateSchedule(schedule, codes).errors.map((error) => error.code)).toContain(code);
  });

  it.each(['2023-02-29', '2024-02-30', '2024-2-01', '2024-13-01'])('rejects invalid calendar date %s', (date) => {
    expect(() => selectScheduledVariant({ mode: 'weekly', week: {} }, { date })).toThrow();
  });

  it('rejects invalid progress without wrapping or mutating caller values', () => {
    const schedule = { mode: 'independent', rotation: ['U1', 'L1'] };
    const before = structuredClone(schedule);
    expect(() => selectScheduledVariant(schedule, { rotationPos: -1 })).toThrow();
    expect(() => advanceIndependentSchedule(schedule, { rotationPos: 2, cycle: 1, completed: true })).toThrow();
    expect(() => advanceIndependentSchedule(schedule, { rotationPos: 0, cycle: 0, completed: true })).toThrow();
    expect(schedule).toEqual(before);
  });
});
