import { describe, expect, it } from 'vitest';
import { decodeRoutineFile } from './routine-import.js';

const catalog = [{ id: 'squat', name: 'Squat', unit: 'kg', muscle: 'Legs' }];
const file = (name, body) => ({ name, text: async () => body });

describe('decodeRoutineFile', () => {
  it('decodes header-based CSV including quoted delimiters and newlines', async () => {
    const result = await decodeRoutineFile(file('routines.csv', 'Code,Name,Exercise,Muscle\r\nA,"Push, day","Squat\nvariant",Legs'), catalog);
    expect(result.valid).toBe(true);
    expect(result.draft.variants[0]).toMatchObject({ code: 'A', name: 'Push, day' });
    expect(result.draft.variants[0].exercises[0].name).toBe('Squat variant');
  });
  it('rejects malformed CSV widths and duplicate headers', async () => {
    for (const input of ['Code,Exercise\nA,Squat,Extra', 'Code,code,Exercise\nA,A,Squat']) {
      const result = await decodeRoutineFile(file('bad.csv', input), catalog);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
  it('decodes normalized JSON and rejects full backup JSON', async () => {
    const draft = { schemaVersion: 1, variants: [{ code: 'A', name: 'A', kind: 'Custom', exercises: [{ ref: { type: 'catalog', id: 'squat' }, name: 'Squat', unit: 'kg', muscle: 'Legs' }] }] };
    expect((await decodeRoutineFile(file('draft.json', JSON.stringify(draft)), catalog)).valid).toBe(true);
    expect((await decodeRoutineFile(file('backup.json', JSON.stringify({ workouts: [] })), catalog)).valid).toBe(false);
  });
  it('handles semicolon CSV and rejects malformed quoting', async () => {
    const good = await decodeRoutineFile(file('data.csv', '\uFEFFCode;Exercise\r\nA;Squat\r\n'), catalog);
    expect(good.valid).toBe(true);
    const bad = await decodeRoutineFile(file('data.csv', 'Code,Exercise\\nA,"Squat'), catalog);
    expect(bad.valid).toBe(false);
    expect(bad.errors[0].code).toBe('file-decode-error');
  });
  it('selects workbook sheets explicitly and reports ambiguity', async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const name of ['Routine', 'Routines']) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Code', 'Exercise', 'ExerciseOrder'], ['A', 'Squat', 2]]), name);
    const bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
    const xfile = { name: 'routines.xlsx', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    const catalogBefore = structuredClone(catalog);
    const ambiguous = await decodeRoutineFile(xfile, catalog);
    expect(ambiguous).toEqual({
      valid: false, draft: null,
      errors: [{ code: 'ambiguous-sheet', path: 'sheetName', message: 'Multiple recognized routine sheets; specify sheetName.' }],
      sheetNames: ['Routine', 'Routines'],
    });
    ambiguous.sheetNames.reverse();
    const repeated = await decodeRoutineFile(xfile, catalog);
    expect(repeated).toEqual({
      valid: false, draft: null,
      errors: [{ code: 'ambiguous-sheet', path: 'sheetName', message: 'Multiple recognized routine sheets; specify sheetName.' }],
      sheetNames: ['Routine', 'Routines'],
    });
    for (const sheetName of ['Routine', 'Routines']) {
      const selected = await decodeRoutineFile(xfile, catalog, { sheetName });
      expect(selected.valid).toBe(true);
      expect(selected.draft.variants[0].exercises[0].order).toBe(1);
    }
    const missing = await decodeRoutineFile(xfile, catalog, { sheetName: 'unknown' });
    expect(missing).toMatchObject({ valid: false, draft: null, errors: [{ code: 'sheet-not-found', path: 'sheetName', message: 'Sheet not found: unknown' }] });
    expect(missing).not.toHaveProperty('sheetNames');
    expect(catalog).toEqual(catalogBefore);
  });
  it('returns exact workbook sheet names only for ambiguity and retries exact names', async () => {
    const XLSX = await import('xlsx');
    const names = ['  Día α  ', '二 階 routine'];
    const wb = XLSX.utils.book_new();
    for (const name of names) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Code', 'Exercise'], ['A', 'Squat']]), name);
    expect(wb.SheetNames).toEqual(names);
    const bytes = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
    const xfile = { name: 'ambiguous.xlsx', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    const catalogBefore = structuredClone(catalog);
    const ambiguous = await decodeRoutineFile(xfile, catalog);
    expect(ambiguous).toMatchObject({ valid: false, draft: null, errors: [{ code: 'ambiguous-sheet', path: 'sheetName', message: 'Workbook has multiple nonempty sheets; specify sheetName.' }], sheetNames: names });
    ambiguous.sheetNames[0] = 'caller mutation';
    expect((await decodeRoutineFile(xfile, catalog)).sheetNames).toEqual(names);
    for (const sheetName of names) expect((await decodeRoutineFile(xfile, catalog, { sheetName })).valid).toBe(true);
    const missing = await decodeRoutineFile(xfile, catalog, { sheetName: 'unknown' });
    expect(missing).toMatchObject({ valid: false, draft: null, errors: [{ code: 'sheet-not-found', path: 'sheetName' }] });
    expect(missing).not.toHaveProperty('sheetNames');
    expect(catalog).toEqual(catalogBefore);
  });

  it('structures file-read errors and does not mutate catalog', async () => {
    const before = structuredClone(catalog);
    const result = await decodeRoutineFile({ name: 'bad.json', text: async () => { throw new Error('read failed'); } }, catalog);
    expect(result.errors[0].code).toBe('file-decode-error');
    expect(result.draft).toBeNull();
    expect(catalog).toEqual(before);
  });
  it('rejects unknown extensions without reading the file', async () => {
    let reads = 0;
    const result = await decodeRoutineFile({ name: 'data.zip', text: async () => { reads++; } }, catalog);
    expect(result.valid).toBe(false);
    expect(reads).toBe(0);
  });
});
