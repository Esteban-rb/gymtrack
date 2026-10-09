import { normalizeRoutineRows, validateRoutineDraft } from './routine-draft.js';

const fail = (code, message, path = '') => ({ valid: false, draft: null, errors: [{ code, path, message }] });
const blank = row => row.every(value => String(value ?? '').trim() === '');

function parseCsv(source) {
  const input = source.replace(/^\uFEFF/, ''), rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (closed && ch !== ',' && ch !== ';' && ch !== '\r' && ch !== '\n' && ch !== ' ' && ch !== '\t') throw Error('Characters after closing quote.');
    else if (!closed && ch === '"' && cell === '') quoted = true;
    else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; closed = false; }
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && input[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; closed = false; }
    else if (!closed) cell += ch;
  }
  if (quoted) throw Error('Unterminated quoted field.');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && blank(rows.at(-1))) rows.pop();
  if (!rows.length) throw Error('CSV is empty.');
  const counts = [',', ';'].map(delim => { let inQuote = false, count = 0; for (let i = 0; i < input.length && input[i] !== '\r' && input[i] !== '\n'; i++) { if (input[i] === '"' && input[i + 1] === '"' && inQuote) i++; else if (input[i] === '"') inQuote = !inQuote; else if (!inQuote && input[i] === delim) count++; } return count; });
  if (counts[0] === counts[1]) throw Error('Could not unambiguously detect comma or semicolon delimiter.');
  const delimiter = counts[0] > counts[1] ? ',' : ';';
  // Parse again with the selected delimiter; delimiters of the other type are ordinary data.
  return parseWithDelimiter(input, delimiter);
}
function parseWithDelimiter(input, delimiter) {
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < input.length; i++) { const ch = input[i];
    if (quoted) { if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') { quoted = false; closed = true; } else cell += ch; }
    else if (closed && ch !== delimiter && ch !== '\r' && ch !== '\n' && ch !== ' ' && ch !== '\t') throw Error('Characters after closing quote.');
    else if (!closed && ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; closed = false; }
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && input[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; closed = false; }
    else if (!closed) cell += ch;
  }
  if (quoted) throw Error('Unterminated quoted field.');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && blank(rows.at(-1))) rows.pop();
  const headers = rows.shift().map(x => x.trim());
  if (headers.some(x => !x)) throw Error('CSV contains an empty header.');
  if (new Set(headers.map(x => x.toLocaleLowerCase('und'))).size !== headers.length) throw Error('CSV contains duplicate headers.');
  if (rows.some(r => r.length !== headers.length)) throw Error('CSV row width does not match the header.');
  return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function matrixRows(matrix) {
  const rows = matrix.map(r => Array.from(r || [], x => x == null ? '' : x));
  while (rows.length && blank(rows.at(-1))) rows.pop();
  if (!rows.length) return [];
  const headers = rows.shift().map(x => String(x).trim());
  if (headers.some(x => !x)) throw Error('Sheet contains an empty header.');
  if (new Set(headers.map(x => x.toLocaleLowerCase('und'))).size !== headers.length) throw Error('Sheet contains duplicate headers.');
  if (rows.some(r => r.length > headers.length || (r.length < headers.length && !blank(r)))) throw Error('Sheet row width does not match the header.');
  return rows.filter(r => !blank(r)).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

export async function decodeRoutineFile(file, catalog, { sheetName } = {}) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (!['csv', 'json', 'xlsx', 'xls'].includes(extension)) return fail('unsupported-format', 'Supported files are CSV, JSON, XLSX, and XLS.');
  try {
    if (extension === 'csv') return normalizeRoutineRows(parseCsv(await file.text()), catalog);
    if (extension === 'json') {
      const value = JSON.parse(await file.text());
      if (Array.isArray(value)) return normalizeRoutineRows(value, catalog);
      if (value && value.schemaVersion === 1 && Array.isArray(value.variants)) return validateRoutineDraft(value, catalog);
      return fail('unsupported-json-shape', 'JSON must be a row array or schemaVersion 1 routine draft.');
    }
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    let selected;
    if (sheetName !== undefined) {
      if (!workbook.SheetNames.includes(sheetName)) return fail('sheet-not-found', `Sheet not found: ${sheetName}`, 'sheetName');
      selected = sheetName;
    } else {
      const nonempty = workbook.SheetNames.filter(n => (workbook.Sheets[n]?.['!ref']));
      const recognized = nonempty.filter(n => ['routine', 'routines', 'rutina', 'rutinas'].includes(n.trim().toLocaleLowerCase('und')));
      if (recognized.length > 1) return { ...fail('ambiguous-sheet', 'Multiple recognized routine sheets; specify sheetName.', 'sheetName'), sheetNames: [...workbook.SheetNames] };
      if (recognized.length === 1) selected = recognized[0];
      else if (nonempty.length === 1) selected = nonempty[0];
      else if (!nonempty.length) return fail('empty-workbook', 'Workbook contains no nonempty sheets.');
      else return { ...fail('ambiguous-sheet', 'Workbook has multiple nonempty sheets; specify sheetName.', 'sheetName'), sheetNames: [...workbook.SheetNames] };
    }
    // SheetJS reads cached formula results as values; formulas are never evaluated.
    return normalizeRoutineRows(matrixRows(XLSX.utils.sheet_to_json(workbook.Sheets[selected], { header: 1, raw: true, defval: '' })), catalog);
  } catch (error) {
    return fail('file-decode-error', error instanceof Error ? error.message : 'Could not read or decode file.');
  }
}
