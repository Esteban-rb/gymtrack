import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { CHANGELOG, shouldShowWhatsNew } from './changelog.js';

describe('release notes', () => {
  it('the current package version has notes in English and Spanish, with the same number of items', () => {
    const entry = CHANGELOG[pkg.version];
    expect(entry, `add an entry for ${pkg.version} to src/changelog.js`).toBeTruthy();
    expect(entry.en.length).toBeGreaterThan(0);
    expect(entry.es.length).toBe(entry.en.length);
    for (const [title, body] of [...entry.en, ...entry.es]) { expect(title).toBeTruthy(); expect(body).toBeTruthy(); }
  });

  it('shows once per version, only to people who already use the app', () => {
    const v = pkg.version;
    expect(shouldShowWhatsNew({ version: v, seen: null, hasData: true })).toBe(true);
    expect(shouldShowWhatsNew({ version: v, seen: '1.8.0', hasData: true })).toBe(true);
    expect(shouldShowWhatsNew({ version: v, seen: v, hasData: true })).toBe(false);        // already seen
    expect(shouldShowWhatsNew({ version: v, seen: null, hasData: false })).toBe(false);    // brand-new install
    expect(shouldShowWhatsNew({ version: '0.0.1', seen: null, hasData: true })).toBe(false); // no notes for that version
    expect(shouldShowWhatsNew({ version: null, seen: null, hasData: true })).toBe(false);
  });
});
