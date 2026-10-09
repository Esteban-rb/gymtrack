/** Routine codes are the stable labels (A, B, C…) that schedules refer to. */
export function letterCode(index) {
  const last = String.fromCharCode(65 + (index % 26));
  return index < 26 ? last : letterCode(Math.floor(index / 26) - 1) + last;
}

const LETTER_CODE = /^[A-Z]+$/;

/** True when every routine already carries an auto-assigned letter code (no imported custom codes). */
export const isAutoCoded = (variants) => variants.every((variant) => LETTER_CODE.test(String(variant.code ?? '')));

/** First letter code not used by any routine yet. */
export function nextFreeCode(variants) {
  const used = new Set(variants.map((variant) => variant.code));
  let index = 0;
  while (used.has(letterCode(index))) index++;
  return letterCode(index);
}

/** Reassign A, B, C… by position. */
export const renumber = (variants) => variants.map((variant, index) => ({ ...variant, code: letterCode(index) }));

/**
 * Apply a `{ oldCode: newCode | null }` map to a schedule so it keeps pointing at the same routines
 * after the editor renumbers or removes them. Removed routines leave their weekday unassigned / the rotation.
 */
export function remapScheduleCodes(schedule, codeMap) {
  if (!schedule || !codeMap || !Object.keys(codeMap).length) return schedule;
  const map = (code) => (Object.hasOwn(codeMap, code) ? codeMap[code] : code);
  if (schedule.mode === 'weekly' && schedule.week && typeof schedule.week === 'object') {
    const week = {};
    for (const [day, code] of Object.entries(schedule.week)) {
      if (code === null) { week[day] = null; continue; }
      const next = map(code);
      if (next != null) week[day] = next;
    }
    return { ...schedule, week };
  }
  if (schedule.mode === 'independent' && Array.isArray(schedule.rotation)) {
    return { ...schedule, rotation: schedule.rotation.map(map).filter((code) => code != null) };
  }
  return schedule;
}

/** True when the draft holds nothing the user typed or picked (no routines, or only untouched blank ones). */
export function isBlankDraft(draft) {
  const variants = Array.isArray(draft?.variants) ? draft.variants : [];
  return variants.every((variant) => !String(variant?.name ?? '').trim()
    && (variant?.exercises ?? []).every((exercise) => !exercise?.ref && !String(exercise?.name ?? '').trim()));
}
