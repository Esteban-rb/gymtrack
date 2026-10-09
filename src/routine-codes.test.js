import { describe, expect, it } from 'vitest';
import { isAutoCoded, letterCode, nextFreeCode, remapScheduleCodes, renumber } from './routine-codes.js';

describe('routine codes', () => {
  it('generates spreadsheet-style letter codes', () => {
    expect([0, 1, 25, 26, 27, 52].map(letterCode)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'BA']);
  });
  it('picks the first unused letter and renumbers by position', () => {
    expect(nextFreeCode([{ code: 'A' }, { code: 'C' }])).toBe('B');
    expect(nextFreeCode([{ code: 'U1' }])).toBe('A');
    expect(renumber([{ code: 'C', n: 1 }, { code: 'A', n: 2 }])).toEqual([{ code: 'A', n: 1 }, { code: 'B', n: 2 }]);
  });
  it('detects drafts whose codes are all auto-assigned letters', () => {
    expect(isAutoCoded([{ code: 'A' }, { code: 'B' }])).toBe(true);
    expect(isAutoCoded([{ code: 'A' }, { code: 'U1' }])).toBe(false);
  });
  it('remaps weekly and rotation schedules, dropping removed routines and swapping in one pass', () => {
    const weekly = { mode: 'weekly', week: { Mon: 'A', Tue: 'B', Wed: null, Thu: 'C' } };
    expect(remapScheduleCodes(weekly, { A: 'B', B: 'A', C: null })).toEqual({ mode: 'weekly', week: { Mon: 'B', Tue: 'A', Wed: null } });
    const rotation = { mode: 'independent', rotation: ['A', 'B', 'C'] };
    expect(remapScheduleCodes(rotation, { A: 'B', B: 'A', C: null })).toEqual({ mode: 'independent', rotation: ['B', 'A'] });
    expect(remapScheduleCodes(null, { A: 'B' })).toBeNull();
    expect(remapScheduleCodes(weekly, {})).toBe(weekly);
  });
});
