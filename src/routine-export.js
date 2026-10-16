// GymTrack — routine <-> exportable shapes. Pure functions, no DB: shared by backup.js (export)
// and routine-import.js (so an exported .xlsx/.json can be fed back to the routine importer).

/** Column headers of the "Routine" sheet. All are recognised aliases of routine-draft.js. */
export const ROUTINE_COLUMNS = ['Code', 'Routine name', 'Kind', 'Routine order', 'Exercise order', 'Exercise', 'Muscle', 'Unit'];

/** Routine codes applied by the setup wizard carry a "@p<period>r<revision>" ownership suffix. */
export const baseRoutineCode = (code) => String(code ?? '').replace(/@p\d+r\d+(-\d+)?$/, '');

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/** The routine variants in force for the active period (same rule as the store's init). */
export function activeRoutineVariants({ periods = [], routineVariants = [] }) {
  const active = periods.find((p) => p.status === 'active') || null;
  const ownedCodes = new Set(periods.filter((p) => p.routineRevision).flatMap((p) => p.routineVariantCodes || []));
  const list = active?.routineVariantCodes?.length
    ? routineVariants.filter((v) => active.routineVariantCodes.includes(v.code))
    : routineVariants.filter((v) => !v.ownerPeriodId && !ownedCodes.has(v.code));
  return [...list].sort(byOrder);
}

/** A schemaVersion-1 routine draft (the shape validateRoutineDraft accepts) from stored variants.
 *  Exercises that no longer exist in the catalog are skipped. Returns null when nothing is left. */
export function buildRoutineDraft({ variants = [], exercises = [] }) {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const out = [];
  for (const v of variants) {
    const list = [];
    for (const id of v.exerciseIds || []) {
      const e = byId.get(id);
      if (!e) continue;
      list.push({
        ref: { type: 'catalog', id: e.id },
        name: e.name,
        order: list.length,
        unit: v.exerciseUnits?.[id] || e.unit || 'kg',
        muscle: e.muscle || 'Other',
      });
    }
    if (!list.length) continue;
    out.push({ code: baseRoutineCode(v.code), order: out.length, name: v.name || v.code, kind: v.kind || 'Custom', exercises: list });
  }
  return out.length ? { schemaVersion: 1, variants: out } : null;
}

/** Flat one-row-per-exercise form of a draft: the "Routine" sheet, and the input the routine
 *  importer normalises (it matches exercises by name, so it also works on another device). */
export function routineDraftToRows(draft) {
  const rows = [];
  for (const v of draft?.variants || []) {
    for (const e of v.exercises) {
      rows.push({
        Code: v.code, 'Routine name': v.name, Kind: v.kind,
        'Routine order': v.order + 1, 'Exercise order': e.order + 1,
        Exercise: e.name, Muscle: e.muscle, Unit: e.unit,
      });
    }
  }
  return rows;
}

/** Routine draft carried by a JSON backup: its `routine` key, or (older backups) rebuilt from the tables. */
export function routineDraftFromBackup(dump) {
  if (dump?.routine && Array.isArray(dump.routine.variants)) return dump.routine;
  return buildRoutineDraft({
    variants: activeRoutineVariants({ periods: dump?.periods, routineVariants: dump?.routineVariants }),
    exercises: dump?.exercises,
  });
}
