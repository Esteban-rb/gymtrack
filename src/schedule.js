const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_BY_UTC = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function errorsFor(schedule, variantCodes) {
  const errors = [];
  const add = (code, path, message) => errors.push({ code, path, message });
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    add('invalid_schedule', '', 'Schedule must be an object.');
    return errors;
  }
  const known = new Set(Array.isArray(variantCodes) ? variantCodes.filter((code) => typeof code === 'string' && code.length > 0) : []);
  if (schedule.mode === 'weekly') {
    if (!schedule.week || typeof schedule.week !== 'object' || Array.isArray(schedule.week)) {
      add('invalid_week', 'week', 'Weekly schedule requires a weekday map.');
      return errors;
    }
    for (const day of Object.keys(schedule.week)) {
      if (!WEEKDAYS.includes(day)) add('unknown_day', `week.${day}`, `Unknown weekday: ${day}.`);
      else if (schedule.week[day] !== null && (typeof schedule.week[day] !== 'string' || !schedule.week[day])) add('invalid_variant', `week.${day}`, 'Variant must be a known code or null rest.');
      else if (typeof schedule.week[day] === 'string' && !known.has(schedule.week[day])) add('unknown_variant', `week.${day}`, `Unknown variant: ${schedule.week[day]}.`);
    }
  } else if (schedule.mode === 'independent') {
    if (!Array.isArray(schedule.rotation) || schedule.rotation.length === 0) add('empty_rotation', 'rotation', 'Independent rotation must be a nonempty array.');
    else {
      const seen = new Set();
      schedule.rotation.forEach((code, index) => {
        if (typeof code !== 'string' || !code) add('invalid_variant', `rotation.${index}`, 'Variant code must be a nonempty string.');
        else if (!known.has(code)) add('unknown_variant', `rotation.${index}`, `Unknown variant: ${code}.`);
        if (seen.has(code)) add('duplicate_variant', `rotation.${index}`, `Duplicate variant: ${code}.`);
        seen.add(code);
      });
    }
  } else add('unknown_mode', 'mode', `Unknown schedule mode: ${String(schedule.mode)}.`);
  return errors;
}

/** Validate a schedule against the caller's available variant codes. */
export function validateSchedule(schedule, variantCodes) {
  const errors = errorsFor(schedule, variantCodes);
  return { valid: errors.length === 0, errors };
}

function validatedISODate(date) {
  if (typeof date !== 'string' || !/^(\d{4})-(\d{2})-(\d{2})$/.test(date)) throw new RangeError('date must be a valid YYYY-MM-DD calendar date');
  const [year, month, day] = date.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]) throw new RangeError('date must be a valid YYYY-MM-DD calendar date');
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year, month - 1, day);
  return DAY_BY_UTC[value.getUTCDay()];
}

function requireIndependent(schedule) {
  if (!schedule || schedule.mode !== 'independent' || !Array.isArray(schedule.rotation) || !schedule.rotation.length || schedule.rotation.some((code) => typeof code !== 'string' || !code) || new Set(schedule.rotation).size !== schedule.rotation.length) throw new TypeError('A valid independent schedule is required.');
}
function requirePosition(position, length) {
  if (!Number.isInteger(position) || position < 0 || position >= length) throw new RangeError('rotationPos must be an integer within the rotation.');
}

/** Select a variant for a Gregorian date or independent rotation position. */
export function selectScheduledVariant(schedule, { date, rotationPos } = {}) {
  if (schedule?.mode === 'weekly') {
    const day = validatedISODate(date);
    const variant = Object.hasOwn(schedule.week || {}, day) ? schedule.week[day] : null;
    return { variant, isRest: variant === null };
  }
  requireIndependent(schedule);
  requirePosition(rotationPos, schedule.rotation.length);
  return { variant: schedule.rotation[rotationPos], isRest: false };
}

/** Advance only an explicitly completed independent session; cycleGoal is intentionally external. */
export function advanceIndependentSchedule(schedule, { rotationPos, cycle, completed } = {}) {
  requireIndependent(schedule);
  requirePosition(rotationPos, schedule.rotation.length);
  if (!Number.isInteger(cycle) || cycle < 1) throw new RangeError('cycle must be a positive integer.');
  if (typeof completed !== 'boolean') throw new TypeError('completed must be a boolean.');
  if (!completed) return { rotationPos, cycle };
  if (rotationPos + 1 < schedule.rotation.length) return { rotationPos: rotationPos + 1, cycle };
  return { rotationPos: 0, cycle: cycle + 1 };
}

/** Adapt legacy ordered variant rows without imposing a second hard-coded order. */
export function legacyScheduleFromVariants(orderedVariantRows) {
  if (!Array.isArray(orderedVariantRows)) throw new TypeError('orderedVariantRows must be an array.');
  const rotation = orderedVariantRows.map((row) => row?.code);
  if (!rotation.length || rotation.some((code) => typeof code !== 'string' || !code) || new Set(rotation).size !== rotation.length) throw new TypeError('Variants must have unique nonempty codes.');
  return { mode: 'independent', rotation };
}
