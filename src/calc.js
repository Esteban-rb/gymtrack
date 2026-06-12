// GymTrack — pure calculation engine: unit normalization, 1RM, medals, dates.
// Everything metric-related uses realKg (true load), never the raw entered value.

export const KG_PER_LB = 0.45359237;
export const KG_PER_PLATE = 40; // 1 plate = 20 kg per side = 40 kg total
export const UNITS = ['kg', 'lb', 'x2', 'plates'];
export const MEDALS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
export const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** Normalize an entered value+unit to real kilograms.
 *  x2 = per-arm in lb, doubled ("60 lb ×2" → 54.43 kg total). */
export function toKg(value, unit) {
  if (value == null || isNaN(value)) return 0;
  switch (unit) {
    case 'kg': return value;
    case 'lb': return value * KG_PER_LB;
    case 'x2': return value * KG_PER_LB * 2;
    case 'plates': return value * KG_PER_PLATE;
    default: return value;
  }
}

/** Display the value exactly as the user entered it. */
export function fmtWeight(value, unit) {
  if (value == null) return '—';
  const n = Number.isInteger(value) ? value : +value.toFixed(2);
  switch (unit) {
    case 'kg': return n + ' kg';
    case 'lb': return n + ' lb';
    case 'x2': return n + ' lb ×2';
    case 'plates': return n + (n === 1 ? ' plate' : ' plates');
    default: return String(n);
  }
}

export function fmtKg(kg) {
  return (Number.isInteger(kg) ? kg : +kg.toFixed(1)) + ' kg';
}

/** Epley estimated 1RM. Reps capped at 12 — beyond that the formula loses meaning. */
export function est1RM(realKg, reps) {
  return realKg * (1 + Math.min(reps, 12) / 30);
}

/** Tonnage of one set. */
export function setTonnage(set) {
  return (set.realKg || 0) * (set.reps || 0);
}

/* ---------------- Medals ---------------- */

// Progression milestones for non-standard exercises: % gain over first-ever record.
export const PROGRESSION_STEPS = [0, 0.05, 0.10, 0.175, 0.25];

/** Medal level for a basic lift: est. 1RM vs bodyweight-multiple thresholds.
 *  ratios = [bronze..diamond] as multiples of bodyweight. Returns -1..4. */
export function medalForStandards(oneRm, bodyweightKg, ratios) {
  if (!oneRm || !bodyweightKg || !ratios) return -1;
  let lvl = -1;
  ratios.forEach((r, i) => { if (oneRm >= r * bodyweightKg) lvl = i; });
  return lvl;
}

/** Medal level for an isolation exercise: % improvement of best realKg over the baseline
 *  (the first set ever logged). Returns -1 if never trained, else 0..4. */
export function medalForProgression(bestKg, baselineKg) {
  if (bestKg == null) return -1;
  if (!baselineKg) return 0;
  const gain = (bestKg - baselineKg) / baselineKg;
  let lvl = 0;
  PROGRESSION_STEPS.forEach((t, i) => { if (gain >= t) lvl = i; });
  return lvl;
}

/* ---------------- Dates / period weeks ---------------- */

export function isoDate(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Monday of the week containing d (local time). */
export function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  x.setDate(x.getDate() - shift);
  return x;
}

/** 1-based week number of `date` within a period starting on `startISO` (a Monday). */
export function weekOfPeriod(startISO, date = new Date()) {
  const start = mondayOf(parseISO(startISO));
  const days = Math.floor((mondayOf(date) - start) / 86400000);
  return Math.floor(days / 7) + 1;
}

/** 'Mon'..'Sun' for a date. */
export function dayKeyOf(date = new Date()) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function fmtDate(iso) {
  return parseISO(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Default overload suggestion: +bump weight or +1 rep over last week's top set. */
export function suggestOverload(topSet) {
  if (!topSet) return null;
  const bump = topSet.unit === 'plates' ? 0.25 : topSet.unit === 'kg' ? 2.5 : 2.5;
  return 'Try ' + fmtWeight(+(topSet.value + bump).toFixed(2), topSet.unit) + ' or +1 rep';
}
