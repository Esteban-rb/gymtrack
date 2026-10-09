import { describe, it, expect } from 'vitest';
import { normalizeRoutineRows, validateRoutineDraft } from './routine-draft.js';

const catalog = [
  { id: 'press-id', name: 'PrÉss   One', unit: 'kg', muscle: 'Chest', isBasic: true, standards: [1, 2] },
  { id: 'row-id', name: 'Row', unit: 'lb', muscle: 'Back' },
];
const row = (x = {}) => ({ code: 'A', exercise: 'Press One', ...x });

describe('routine draft normalization', () => {
  it('maps explicit English/Spanish aliases and groups repeated routine codes', () => {
    const result = normalizeRoutineRows([
      { Variante: 'A', 'Nombre de rutina': 'Día A', Ejercicio: 'Row', 'orden de rutina': '2', 'exercise order': '2', Unidad: 'lb' },
      { variant: 'B', rutina: 'Día B', ejercicio: 'Press One', 'routine order': '1', order: '1' },
    ], catalog);
    expect(result.valid).toBe(true);
    expect(result.draft.variants.map(v => v.code)).toEqual(['B', 'A']);
    expect(result.draft.variants[1].exercises[0].unit).toBe('lb');
  });
  it('uses appearance order when wholly implicit and rejects mixed/tied explicit order', () => {
    expect(normalizeRoutineRows([row({ code: 'B' }), row()], catalog).draft.variants.map(v => v.code)).toEqual(['B', 'A']);
    expect(normalizeRoutineRows([row({ 'routine order': 2 }), row({ code: 'B' })], catalog).errors).toContainEqual(expect.objectContaining({ code: 'mixed-order' }));
    expect(normalizeRoutineRows([row({ 'routine order': 1 }), row({ code: 'B', 'routine order': 1 })], catalog).errors).toContainEqual(expect.objectContaining({ code: 'duplicate-order' }));
  });
  it('accepts numeric and string one-based order equivalently at both levels', () => {
    for (const order of [2, '2']) {
      const result = normalizeRoutineRows([
        row({ 'routine order': order, 'exercise order': order }),
        row({ code: 'B', 'routine order': 1, 'exercise order': 1 }),
      ], catalog);
      expect(result.valid).toBe(true);
      expect(result.draft.variants.map(v => v.code)).toEqual(['B', 'A']);
      expect(result.draft.variants[1].exercises[0].order).toBe(1);
    }
  });
  it('rejects mixed numeric explicit and implicit orders and conflicting numeric aliases', () => {
    expect(normalizeRoutineRows([row({ 'routine order': 2 }), row({ code: 'B' })], catalog).errors).toContainEqual(expect.objectContaining({ code: 'mixed-order' }));
    expect(normalizeRoutineRows([row({ routineOrder: 2, 'routine order': 3 })], catalog).errors).toContainEqual(expect.objectContaining({ code: 'conflicting-header' }));
  });
  it('rejects invalid imported order values including booleans, objects, fractions and non-finite values', () => {
    for (const value of [true, {}, 1.5, Infinity, NaN, '']) {
      const result = normalizeRoutineRows([row({ 'routine order': value })], catalog);
      if (value === '') expect(result.valid).toBe(true);
      else expect(result.errors).toContainEqual(expect.objectContaining({ code: 'invalid-order' }));
    }
  });
  it('preserves catalog identity and defaults while honoring explicit existing id', () => {
    const a = normalizeRoutineRows([row()], catalog).draft.variants[0].exercises[0];
    expect(a).toMatchObject({ ref: { type: 'catalog', id: 'press-id' }, unit: 'kg', muscle: 'Chest' });
    expect(normalizeRoutineRows([row({ 'exercise id': 'row-id' })], catalog).draft.variants[0].exercises[0].ref.id).toBe('row-id');
    expect(normalizeRoutineRows([row({ 'exercise id': 'missing' })], catalog).valid).toBe(false);
  });
  it('rejects ambiguous folded catalog names rather than selecting first', () => {
    const result = normalizeRoutineRows([row()], [...catalog, { ...catalog[0], id: 'other' }]);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'ambiguous-exercise' }));
  });
  it('shares new refs across variants and reports metadata conflicts', () => {
    const input = [row({ exercise: 'Novel', code: 'A' }), row({ exercise: ' novel ', code: 'B', muscle: 'Legs' })];
    const result = normalizeRoutineRows(input, catalog);
    expect(result.draft.variants[0].exercises[0].ref).toEqual(result.draft.variants[1].exercises[0].ref);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'new-exercise-conflict' }));
  });
  it('accepts supported explicit units but rejects unsupported ones; matched basics remain catalog refs', () => {
    expect(normalizeRoutineRows([row({ unit: 'platesx2' })], catalog).valid).toBe(false);
    const result = normalizeRoutineRows([row({ unit: 'lb' })], catalog);
    expect(result.draft.variants[0].exercises[0]).toMatchObject({ ref: { type: 'catalog', id: 'press-id' }, unit: 'lb' });
  });
});

describe('manual draft validation', () => {
  const draft = { schemaVersion: 1, variants: [{ code: 'A', order: 0, name: 'A', kind: 'Upper', exercises: [{ ref: { type: 'catalog', id: 'press-id' }, name: 'Press One', order: 0, unit: 'kg', muscle: 'Chest' }] }] };
  it('accepts canonical zero-based order and rejects unknown references, invalid units, duplicates and schema', () => {
    expect(validateRoutineDraft(draft, catalog).valid).toBe(true);
    expect(validateRoutineDraft({ ...draft, variants: [] }, catalog).errors).toContainEqual(expect.objectContaining({ code: 'empty-variants' }));
    expect(validateRoutineDraft({ ...draft, schemaVersion: 2 }, catalog).valid).toBe(false);
    expect(validateRoutineDraft({ ...draft, variants: [{ ...draft.variants[0], exercises: [{ ...draft.variants[0].exercises[0], ref: { type: 'new', key: 'lost' } }] }] }, catalog).valid).toBe(false);
  });
  it('rejects duplicate manual variant codes, duplicate exercise refs, unknown refs, and invalid units', () => {
    const variant = draft.variants[0];
    expect(validateRoutineDraft({ ...draft, variants: [variant, { ...variant, order: 1 }] }, catalog).errors).toContainEqual(expect.objectContaining({ code: 'duplicate-code' }));
    const ex = variant.exercises[0];
    expect(validateRoutineDraft({ ...draft, variants: [{ ...variant, exercises: [ex, { ...ex, order: 1 }] }] }, catalog).errors).toContainEqual(expect.objectContaining({ code: 'duplicate-exercise' }));
    expect(validateRoutineDraft({ ...draft, variants: [{ ...variant, exercises: [{ ...ex, ref: { type: 'catalog', id: 'missing' } }] }] }, catalog).valid).toBe(false);
    expect(validateRoutineDraft({ ...draft, variants: [{ ...variant, exercises: [{ ...ex, unit: 'stone' }] }] }, catalog).valid).toBe(false);
  });
  it('rejects basic identity claims on new references and unsupported basic metadata on raw rows', () => {
    const basic = { ...draft, variants: [{ ...draft.variants[0], exercises: [{ ...draft.variants[0].exercises[0], ref: { type: 'new', key: 'press' } }] }] };
    expect(validateRoutineDraft(basic, catalog).valid).toBe(false);
    expect(normalizeRoutineRows([row({ isBasic: true })], catalog).valid).toBe(false);
  });
  it('keeps shared new-reference normalization pure', () => {
    const input = [row({ exercise: 'Novel', code: 'A' }), row({ exercise: 'Novel', code: 'B' })];
    const before = JSON.stringify(input);
    normalizeRoutineRows(input, catalog);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('fails closed on malformed structures and preserves deeply frozen inputs', () => {
    const freeze = x => { if (x && typeof x === 'object') { Object.freeze(x); Object.values(x).forEach(freeze); } return x; };
    const frozen = freeze(JSON.parse(JSON.stringify(draft)));
    expect(validateRoutineDraft(frozen, freeze(JSON.parse(JSON.stringify(catalog)))).valid).toBe(true);
    expect(normalizeRoutineRows({}, catalog).valid).toBe(false);
    expect(validateRoutineDraft({ schemaVersion: 1, variants: [null] }, catalog).valid).toBe(false);
  });
});
