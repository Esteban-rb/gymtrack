const UNITS = new Set(['kg', 'lb', 'plates', 'kgx2', 'lbx2', 'x2']);
const HEADERS = {
  code: ['code', 'variant', 'variante'],
  name: ['routinename', 'variant name', 'name', 'nombre', 'nombre de rutina', 'rutina'],
  exercise: ['exercise', 'exercise name', 'ejercicio', 'nombre del ejercicio'],
  exerciseId: ['exerciseid', 'exercise id', 'id ejercicio'],
  unit: ['unit', 'unidad'], muscle: ['muscle', 'musculo', 'músculo'],
  kind: ['kind', 'type', 'tipo'], routineOrder: ['routineorder', 'routine order', 'orden de rutina'],
  exerciseOrder: ['exerciseorder', 'exercise order', 'order', 'orden', 'posición'],
};
const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' ? x.trim().replace(/\s+/gu, ' ') : '';
const importedOrder = value => {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return { present: false };
  if (typeof value === 'number') return { present: true, valid: Number.isSafeInteger(value) && value > 0, value };
  if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
    const n = Number(value.trim());
    return { present: true, valid: Number.isSafeInteger(n) && n > 0, value: n };
  }
  return { present: true, valid: false };
};
const fold = x => text(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('und');
const err = (errors, code, path, message) => errors.push({ code, path, message });
const orderInt = n => Number.isInteger(n) && n >= 0;

function getOrder(item, field) { return field.includes('.') ? field.split('.').reduce((x, k) => x?.[k], item) : item[field]; }
function setOrder(item, field, value) {
  if (field.includes('.')) { const parts = field.split('.'); const target = parts.slice(0, -1).reduce((x, k) => x[k], item); target[parts.at(-1)] = value; }
  else item[field] = value;
}
function checkOrder(items, field, errors, path) {
  const explicit = items.filter(x => getOrder(x, field) != null);
  if (explicit.length && explicit.length !== items.length) err(errors, 'mixed-order', path, 'Either specify every order or none; mixed explicit and implicit order is ambiguous.');
  const seen = new Set();
  for (const item of explicit) {
    const value = getOrder(item, field);
    if (!orderInt(value)) err(errors, 'invalid-order', item.path, 'Order must be a zero-based integer in a draft.');
    else if (seen.has(value)) err(errors, 'duplicate-order', item.path, 'Order values must be unique.');
    seen.add(value);
  }
  if (!explicit.length) items.forEach((x, i) => setOrder(x, field, i));
  return items.sort((a, b) => (getOrder(a, field) ?? 0) - (getOrder(b, field) ?? 0));
}

export function validateRoutineDraft(draft, catalog) {
  const errors = [];
  if (!isObject(draft)) return { valid: false, draft: null, errors: [{ code: 'malformed-draft', path: '', message: 'Draft must be an object.' }] };
  if (!Array.isArray(catalog) || catalog.some(x => !isObject(x) || typeof x.id !== 'string' || typeof x.name !== 'string')) {
    err(errors, 'malformed-catalog', 'catalog', 'Catalog must be an array of exercises with string ids and names.');
    return { valid: false, draft: null, errors };
  }
  if (draft.schemaVersion !== 1) err(errors, 'schema-version', 'schemaVersion', 'Only schemaVersion 1 is supported.');
  if (!Array.isArray(draft.variants)) {
    err(errors, 'malformed-variants', 'variants', 'Variants must be an array.');
    return { valid: false, draft: null, errors };
  }
  if (!draft.variants.length) err(errors, 'empty-variants', 'variants', 'At least one routine variant is required.');
  const byId = new Map(catalog.map(x => [x.id, x]));
  const variants = [];
  const codes = new Set();
  const variantItems = [];
  draft.variants.forEach((v, i) => {
    const p = `variants[${i}]`;
    if (!isObject(v)) { err(errors, 'malformed-variant', p, 'Variant must be an object.'); return; }
    const code = text(v.code), name = text(v.name), kind = text(v.kind);
    if (!code) err(errors, 'missing-code', `${p}.code`, 'Routine code is required.');
    else if (codes.has(code)) err(errors, 'duplicate-code', `${p}.code`, 'Routine codes must be unique.');
    codes.add(code);
    if (!name) err(errors, 'missing-name', `${p}.name`, 'Routine name is required.');
    if (!kind) err(errors, 'missing-kind', `${p}.kind`, 'Routine kind must be a non-empty display string.');
    const ve = { value: { code, order: v.order, name, kind, exercises: [] }, field: 'order', path: `${p}.order` };
    variantItems.push(ve);
    if (!Array.isArray(v.exercises)) { err(errors, 'malformed-exercises', `${p}.exercises`, 'Exercises must be an array.'); return; }
    if (!v.exercises.length) err(errors, 'empty-exercises', `${p}.exercises`, 'A routine must contain at least one exercise.');
    const exerciseItems = [], names = new Set(), refs = new Set();
    v.exercises.forEach((ex, j) => {
      const ep = `${p}.exercises[${j}]`;
      if (!isObject(ex)) { err(errors, 'malformed-exercise', ep, 'Exercise must be an object.'); return; }
      if (ex.isBasic === true || ex.basic === true || ex.basico === true || ex.standards != null) err(errors, 'unsupported-basic-metadata', ep, 'Basic-exercise metadata is not supported in routine drafts.');
      const exerciseName = text(ex.name), muscle = text(ex.muscle), unit = ex.unit;
      if (!exerciseName) err(errors, 'missing-exercise-name', `${ep}.name`, 'Exercise name is required.');
      if (!muscle) err(errors, 'missing-muscle', `${ep}.muscle`, 'Muscle is required.');
      if (!UNITS.has(unit)) err(errors, 'unsupported-unit', `${ep}.unit`, 'Unit is not supported.');
      let ref;
      if (!isObject(ex.ref)) err(errors, 'unknown-reference', `${ep}.ref`, 'Exercise reference must be a catalog or new reference.');
      else if (ex.ref.type === 'catalog' && typeof ex.ref.id === 'string' && byId.has(ex.ref.id)) ref = { type: 'catalog', id: ex.ref.id };
      else if (ex.ref.type === 'new' && typeof ex.ref.key === 'string' && ex.ref.key.trim()) ref = { type: 'new', key: ex.ref.key.trim() };
      else err(errors, 'unknown-reference', `${ep}.ref`, 'Reference does not resolve to an existing catalog exercise or valid draft-local new key.');
      if (ref) {
        const token = ref.type + ':' + (ref.id || ref.key);
        if (refs.has(token)) err(errors, 'duplicate-exercise', `${ep}.ref`, 'An exercise reference may appear only once per routine.');
        refs.add(token);
      }
      const nameKey = fold(exerciseName);
      if (nameKey && names.has(nameKey)) err(errors, 'duplicate-exercise-name', `${ep}.name`, 'Exercise names must be unique within a routine.');
      names.add(nameKey);
      exerciseItems.push({ value: { ref, name: exerciseName, order: ex.order, unit, muscle }, field: 'order', path: `${ep}.order` });
    });
    const sorted = checkOrder(exerciseItems, 'value.order', errors, `${p}.exercises`);
    ve.value.exercises = sorted.map(x => x.value);
    variants.push(ve);
  });
  checkOrder(variantItems, 'value.order', errors, 'variants');
  const cleanVariants = variantItems.sort((a, b) => a.value.order - b.value.order).map(x => x.value);
  // New references must consistently describe one non-basic draft-local exercise.
  const newMeta = new Map();
  cleanVariants.forEach((v, i) => v.exercises.forEach((e, j) => {
    if (e.ref?.type !== 'new') return;
    const key = e.ref.key, meta = `${fold(e.name)}|${e.unit}|${fold(e.muscle)}`;
    if (newMeta.has(key) && newMeta.get(key).meta !== meta) err(errors, 'new-exercise-conflict', `variants[${i}].exercises[${j}]`, 'Shared new reference has conflicting name, unit, or muscle metadata.');
    else newMeta.set(key, { meta, name: fold(e.name) });
    if (catalog.some(c => fold(c.name) === fold(e.name))) err(errors, 'basic-identity', `variants[${i}].exercises[${j}].ref`, 'A catalog-matching name must retain its catalog identity.');
  }));
  const clean = { schemaVersion: 1, variants: cleanVariants };
  return { valid: errors.length === 0, draft: clean, errors };
}

export function normalizeRoutineRows(rows, catalog) {
  const errors = [];
  if (!Array.isArray(rows) || rows.some(r => !isObject(r))) return { valid: false, draft: null, errors: [{ code: 'malformed-rows', path: 'rows', message: 'Rows must be an array of objects.' }] };
  if (!Array.isArray(catalog) || catalog.some(x => !isObject(x) || typeof x.id !== 'string' || typeof x.name !== 'string')) return { valid: false, draft: null, errors: [{ code: 'malformed-catalog', path: 'catalog', message: 'Catalog must contain exercises with string ids and names.' }] };
  const aliases = new Map();
  for (const [key, names] of Object.entries(HEADERS)) for (const n of names) aliases.set(fold(n).replace(/\s/g, ''), key);
  const groups = new Map(), rawVariants = [];
  rows.forEach((row, i) => {
    const values = {};
    for (const [header, value] of Object.entries(row)) {
      const key = aliases.get(fold(header).replace(/\s/g, ''));
      if (!key) continue;
      if (values[key] != null) {
        const previous = values[key];
        const same = key === 'routineOrder' || key === 'exerciseOrder'
          ? (() => { const a = importedOrder(previous), b = importedOrder(value); return a.present === b.present && (!a.present || (a.valid === b.valid && (!a.valid || a.value === b.value))); })()
          : text(previous) === text(value);
        if (!same) err(errors, 'conflicting-header', `rows[${i}].${header}`, `Conflicting columns map to ${key}.`);
      }
      values[key] = value;
    }
    if (row.isBasic === true || row.basic === true || row.basico === true || row.standards != null) err(errors, 'unsupported-basic-metadata', `rows[${i}]`, 'Basic-exercise metadata is not supported in routine rows.');
    const code = text(values.code), p = `rows[${i}]`;
    if (!code) { err(errors, 'missing-code', `${p}.code`, 'Routine code is required.'); return; }
    const exerciseName = text(values.exercise);
    if (!exerciseName) { err(errors, 'missing-exercise-name', `${p}.exercise`, 'Exercise name is required.'); return; }
    let group = groups.get(code);
    if (!group) {
      group = { code, name: text(values.name) || code, kind: text(values.kind) || 'Custom', order: null, exercises: [], path: p };
      groups.set(code, group); rawVariants.push(group);
    } else {
      for (const k of ['name', 'kind']) if (text(values[k]) && text(values[k]) !== group[k]) err(errors, 'variant-conflict', `${p}.${k}`, `Routine ${k} conflicts across rows for ${code}.`);
    }
    const routineOrder = importedOrder(values.routineOrder);
    if (routineOrder.present) {
      if (!routineOrder.valid) err(errors, 'invalid-order', `${p}.routineOrder`, 'Imported orders must be positive one-based integers.');
      else if (group.order != null && group.order !== routineOrder.value - 1) err(errors, 'variant-conflict', `${p}.routineOrder`, 'Routine order conflicts across rows.');
      else group.order = routineOrder.value - 1;
    }
    const item = { name: exerciseName, id: text(values.exerciseId), unit: text(values.unit), muscle: text(values.muscle), order: null, path: p };
    const exerciseOrder = importedOrder(values.exerciseOrder);
    if (exerciseOrder.present) {
      if (!exerciseOrder.valid) err(errors, 'invalid-order', `${p}.exerciseOrder`, 'Imported orders must be positive one-based integers.');
      else item.order = exerciseOrder.value - 1;
    }
    group.exercises.push(item);
  });
  const orderedVariants = rawVariants.map(v => ({ value: v, field: v.order, path: v.path }));
  if (orderedVariants.some(x => x.field != null) && orderedVariants.some(x => x.field == null)) err(errors, 'mixed-order', 'variants', 'Specify routine order for every routine or none.');
  const sortedVariants = checkOrder(orderedVariants, 'field', errors, 'variants').map(x => x.value);
  const newRefs = new Map();
  for (const v of sortedVariants) {
    const es = checkOrder(v.exercises, 'order', errors, `${v.code}.exercises`);
    v.exercises = es.map(e => {
      const matches = catalog.filter(c => fold(c.name) === fold(e.name));
      let found;
      if (e.id) {
        found = catalog.find(c => c.id === e.id);
        if (!found) err(errors, 'unknown-exercise-id', `${e.path}.exerciseId`, 'Explicit exercise id does not exist in the catalog.');
      } else if (matches.length > 1) err(errors, 'ambiguous-exercise', `${e.path}.exercise`, 'Name matches multiple catalog exercises.');
      else found = matches[0];
      if (found) {
        const unit = e.unit || found.unit || 'kg', muscle = e.muscle || found.muscle || 'Other';
        if (!UNITS.has(unit)) err(errors, 'unsupported-unit', `${e.path}.unit`, 'Unit is not supported.');
        return { ref: { type: 'catalog', id: found.id }, name: found.name, order: e.order, unit, muscle };
      }
      const unit = e.unit || 'kg', muscle = e.muscle || 'Other', key = fold(e.name);
      if (!UNITS.has(unit)) err(errors, 'unsupported-unit', `${e.path}.unit`, 'Unit is not supported.');
      let n = newRefs.get(key);
      if (n && (n.unit !== unit || fold(n.muscle) !== fold(muscle))) err(errors, 'new-exercise-conflict', e.path, 'Shared new exercise has conflicting unit or muscle metadata.');
      if (!n) { n = { ref: { type: 'new', key }, name: e.name, unit, muscle }; newRefs.set(key, n); }
      return { ...n, ref: { ...n.ref }, order: e.order };
    });
  }
  const draft = { schemaVersion: 1, variants: sortedVariants.map(v => ({ code: v.code, order: v.order, name: v.name, kind: v.kind, exercises: v.exercises })) };
  const checked = validateRoutineDraft(draft, catalog);
  return { valid: errors.length === 0 && checked.valid, draft: checked.draft || draft, errors: [...errors, ...checked.errors] };
}
