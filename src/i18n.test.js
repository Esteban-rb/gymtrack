import { describe, expect, it } from 'vitest';
import { detectLocale, translate, dictionaries } from './i18n.js';

describe('detectLocale', () => {
  it.each([[['es-ES']], [['es-419']], [['es']], [['es-MX', 'en-US']]])('returns es for %j', (languages) => {
    expect(detectLocale(languages)).toBe('es');
  });
  it.each([[['en-US']], [['fr']], [[]], [['en', 'es']], [['fr', 'es']], [[undefined, null]]])('returns en for %j', (languages) => {
    expect(detectLocale(languages)).toBe('en');
  });
  it('is guarded when navigator is undefined', () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    try { expect(detectLocale()).toBe('en'); } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: original });
    }
  });
  it('reads navigator.languages by default', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['es-AR'], language: 'en-US' } });
    try { expect(detectLocale()).toBe('es'); } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    }
  });
});

describe('translate', () => {
  it('interpolates {name} params', () => {
    expect(translate('en', 'wizard.stepOf', { n: 2, total: 4 })).toBe('Step 2 of 4');
    expect(translate('es', 'wizard.stepOf', { n: 2, total: 4 })).toBe('Paso 2 de 4');
  });
  it('falls back to English, then to the key', () => {
    dictionaries.en['test.onlyEnglish'] = 'Only {x}';
    try {
      expect(translate('es', 'test.onlyEnglish', { x: 'English' })).toBe('Only English');
    } finally { delete dictionaries.en['test.onlyEnglish']; }
    expect(translate('es', 'does.not.exist')).toBe('does.not.exist');
    expect(translate('xx', 'wizard.back')).toBe('Back');
  });
  it('leaves unknown placeholders intact', () => {
    expect(translate('en', 'wizard.stepOf', { n: 1 })).toBe('Step 1 of {total}');
  });
  it('keeps es and en dictionaries in sync', () => {
    expect(Object.keys(dictionaries.es).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });
});
