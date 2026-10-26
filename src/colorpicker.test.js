import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex } from './colorpicker.jsx';

describe('color picker conversions', () => {
  it('round-trips hex through HSV', () => {
    for (const hex of ['#FF3B30', '#1D6FE8', '#000000', '#FFFFFF', '#8E8E93', '#32D74B']) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
  it('treats an invalid value as white-ish default instead of throwing', () => {
    expect(hexToHsv('nope')).toEqual({ h: 0, s: 0, v: 1 });
  });
});
