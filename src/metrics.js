// GymTrack — derived metrics. All math runs on set.realKg (true load), never the raw value.
import { DAY_KEYS, est1RM, setTonnage } from './calc.js';

/** Build a week/day view of a period: logs[week][dayKey] =
 *  { finished, workoutId, block, exercises: [{ id, name, sets: [...] }] } */
export function buildLogs(workouts, setsByWorkout, periodId, exMap) {
  const logs = {};
  for (const w of workouts) {
    if (w.periodId !== periodId) continue;
    const sets = setsByWorkout[w.id] || [];
    const exercises = w.entries.map((en) => ({
      id: en.exerciseId,
      name: (exMap[en.exerciseId] || {}).name || en.exerciseId,
      sets: sets.filter((s) => s.exerciseId === en.exerciseId).sort((a, b) => a.n - b.n),
    }));
    logs[w.week] = logs[w.week] || {};
    logs[w.week][w.dayKey] = { finished: w.finished, workoutId: w.id, block: w.block, date: w.date, exercises };
  }
  return logs;
}

export function dayVolume(entry) {
  if (!entry) return 0;
  let v = 0;
  for (const ex of entry.exercises) for (const s of ex.sets) v += setTonnage(s);
  return Math.round(v);
}

export function weekVolume(logs, w) {
  let v = 0;
  const wk = logs[w] || {};
  for (const d of Object.keys(wk)) v += dayVolume(wk[d]);
  return v;
}

/** Secondary volume metric (user formula): avg(realKg) × avg(reps) over the week's sets. */
export function weekAvgLoad(logs, w) {
  let kg = 0, reps = 0, n = 0;
  const wk = logs[w] || {};
  for (const d of Object.keys(wk)) {
    for (const ex of wk[d].exercises) for (const s of ex.sets) { kg += s.realKg; reps += s.reps || 0; n++; }
  }
  return n ? Math.round((kg / n) * (reps / n)) : 0;
}

export function workoutsDone(logs) {
  let n = 0;
  for (const w of Object.keys(logs)) for (const d of Object.keys(logs[w])) if (logs[w][d].finished) n++;
  return n;
}

/** Best (heaviest realKg) set ever for an exercise, optionally up to a week. */
export function bestSet(logs, exId, maxWeek) {
  let best = null;
  for (const w of Object.keys(logs)) {
    if (maxWeek && +w > maxWeek) continue;
    for (const d of Object.keys(logs[w])) {
      for (const ex of logs[w][d].exercises) {
        if (ex.id !== exId) continue;
        for (const s of ex.sets) {
          if (!best || s.realKg > best.realKg || (s.realKg === best.realKg && s.reps > best.reps)) {
            best = { ...s, week: +w, day: d };
          }
        }
      }
    }
  }
  return best;
}

/** Most recent previous session containing this exercise (reference + overload base). */
export function lastSets(logs, exId, beforeWeek, beforeDay) {
  const dayIdx = (d) => DAY_KEYS.indexOf(d);
  let found = null, foundKey = -1;
  for (const w of Object.keys(logs)) {
    for (const d of Object.keys(logs[w])) {
      const key = +w * 10 + dayIdx(d);
      if (+w > beforeWeek || (+w === beforeWeek && dayIdx(d) >= dayIdx(beforeDay))) continue;
      const ex = logs[w][d].exercises.find((x) => x.id === exId);
      if (ex && ex.sets.length && key > foundKey) { found = { week: +w, sets: ex.sets }; foundKey = key; }
    }
  }
  return found;
}

/** New PRs achieved in a given day vs everything logged before that week. */
export function dayPRs(logs, week, dayKey) {
  const entry = (logs[week] || {})[dayKey];
  if (!entry) return [];
  const prs = [];
  for (const ex of entry.exercises) {
    let bestToday = null;
    for (const s of ex.sets) if (!bestToday || s.realKg > bestToday.realKg) bestToday = s;
    if (!bestToday) continue;
    let prior = null;
    for (const w of Object.keys(logs)) {
      if (+w >= week) continue;
      for (const d of Object.keys(logs[w])) {
        const x = logs[w][d].exercises.find((q) => q.id === ex.id);
        if (!x) continue;
        for (const s of x.sets) if (prior == null || s.realKg > prior) prior = s.realKg;
      }
    }
    if (prior == null || bestToday.realKg > prior) prs.push({ id: ex.id, name: ex.name, set: bestToday });
  }
  return prs;
}

/** Per-muscle averages for one week: sets count, avg realKg, avg reps. */
export function muscleAverages(logs, week, exMap) {
  const agg = {};
  const wk = logs[week] || {};
  for (const d of Object.keys(wk)) {
    for (const ex of wk[d].exercises) {
      const m = (exMap[ex.id] || {}).muscle || 'Other';
      agg[m] = agg[m] || { sets: 0, kg: 0, reps: 0, n: 0 };
      for (const s of ex.sets) { agg[m].sets++; agg[m].kg += s.realKg; agg[m].reps += s.reps || 0; agg[m].n++; }
    }
  }
  return Object.entries(agg).map(([muscle, a]) => ({
    muscle, sets: a.sets,
    avgKg: a.n ? +(a.kg / a.n).toFixed(1) : 0,
    avgReps: a.n ? +(a.reps / a.n).toFixed(1) : 0,
  }));
}

/** Tonnage split by muscle group over the whole period. */
export function muscleVolumeSplit(logs, exMap) {
  const agg = {};
  for (const w of Object.keys(logs)) {
    for (const d of Object.keys(logs[w])) {
      for (const ex of logs[w][d].exercises) {
        const m = (exMap[ex.id] || {}).muscle || 'Other';
        for (const s of ex.sets) agg[m] = (agg[m] || 0) + setTonnage(s);
      }
    }
  }
  return Object.entries(agg).map(([muscle, kg]) => ({ muscle, kg: Math.round(kg) })).sort((a, b) => b.kg - a.kg);
}

/** Weekly best working weight (realKg) for an exercise. */
export function exerciseSeries(logs, exId) {
  const out = [];
  const weeks = Object.keys(logs).map(Number).sort((a, b) => a - b);
  for (const w of weeks) {
    let best = null;
    for (const d of Object.keys(logs[w])) {
      const ex = logs[w][d].exercises.find((x) => x.id === exId);
      if (!ex) continue;
      for (const s of ex.sets) if (best == null || s.realKg > best) best = s.realKg;
    }
    if (best != null) out.push({ week: w, kg: +best.toFixed(1) });
  }
  return out;
}

/** Weekly best est-1RM series for an exercise. */
export function oneRmSeries(logs, exId) {
  const out = [];
  const weeks = Object.keys(logs).map(Number).sort((a, b) => a - b);
  for (const w of weeks) {
    let best = null;
    for (const d of Object.keys(logs[w])) {
      const ex = logs[w][d].exercises.find((x) => x.id === exId);
      if (!ex) continue;
      for (const s of ex.sets) { const rm = est1RM(s.realKg, s.reps); if (best == null || rm > best) best = rm; }
    }
    if (best != null) out.push({ week: w, kg: +best.toFixed(1) });
  }
  return out;
}
