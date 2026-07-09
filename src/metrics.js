// GymTrack — derived metrics. All math runs on set.realKg (true load), never the raw value.
import { VARIANT_KEYS, est1RM, setTonnage } from './calc.js';

/** Build a cycle/variant view of a period: logs[cycle][variant] =
 *  { finished, workoutId, block, variant, date, exercises: [{ id, name, sets: [...] }] }.
 *  Legacy weekday workouts fall back to cycle = old week, variant = old dayKey. */
export function buildLogs(workouts, setsByWorkout, periodId, exMap) {
  const logs = {};
  for (const w of workouts) {
    if (w.periodId !== periodId) continue;
    const cycle = w.cycle ?? w.week ?? 1;
    const variant = w.variant ?? w.dayKey ?? '—';
    const sets = setsByWorkout[w.id] || [];
    const exercises = w.entries.map((en) => ({
      id: en.exerciseId,
      name: (exMap[en.exerciseId] || {}).name || en.exerciseId,
      sets: sets.filter((s) => s.exerciseId === en.exerciseId).sort((a, b) => a.n - b.n),
    }));
    // sets logged for exercises no longer in the plan (e.g. after swapping variant) still count
    const inPlan = new Set(w.entries.map((en) => en.exerciseId));
    for (const s of sets) {
      if (inPlan.has(s.exerciseId)) continue;
      inPlan.add(s.exerciseId);
      exercises.push({
        id: s.exerciseId,
        name: (exMap[s.exerciseId] || {}).name || s.exerciseId,
        sets: sets.filter((x) => x.exerciseId === s.exerciseId).sort((a, b) => a.n - b.n),
      });
    }
    logs[cycle] = logs[cycle] || {};
    logs[cycle][variant] = { finished: w.finished, workoutId: w.id, block: w.block, variant, date: w.date, exercises };
  }
  return logs;
}

export function dayVolume(entry) {
  if (!entry) return 0;
  let v = 0;
  for (const ex of entry.exercises) for (const s of ex.sets) v += setTonnage(s);
  return Math.round(v);
}

export function cycleVolume(logs, c) {
  let v = 0;
  const ck = logs[c] || {};
  for (const d of Object.keys(ck)) v += dayVolume(ck[d]);
  return v;
}

/** Secondary volume metric (user formula): avg(realKg) × avg(reps) over the cycle's sets. */
export function cycleAvgLoad(logs, c) {
  let kg = 0, reps = 0, n = 0;
  const ck = logs[c] || {};
  for (const d of Object.keys(ck)) {
    for (const ex of ck[d].exercises) for (const s of ex.sets) { kg += s.realKg; reps += s.reps || 0; n++; }
  }
  return n ? Math.round((kg / n) * (reps / n)) : 0;
}

export function workoutsDone(logs) {
  let n = 0;
  for (const w of Object.keys(logs)) for (const d of Object.keys(logs[w])) if (logs[w][d].finished) n++;
  return n;
}

/** Best (heaviest realKg) set ever for an exercise, optionally up to a cycle. */
export function bestSet(logs, exId, maxCycle) {
  let best = null;
  for (const c of Object.keys(logs)) {
    if (maxCycle && +c > maxCycle) continue;
    for (const d of Object.keys(logs[c])) {
      for (const ex of logs[c][d].exercises) {
        if (ex.id !== exId) continue;
        for (const s of ex.sets) {
          if (!best || s.realKg > best.realKg || (s.realKg === best.realKg && s.reps > best.reps)) {
            best = { ...s, cycle: +c, variant: d };
          }
        }
      }
    }
  }
  return best;
}

/** Most recent previous session with this exercise, across ALL periods (reference + overload
 *  base + prefill). Imported/archived history counts too. */
export function lastSetsGlobal(workouts, setsByWorkout, exId, beforeDate) {
  let best = null;
  for (const w of workouts) {
    if (w.date >= beforeDate) continue;
    const sets = (setsByWorkout[w.id] || []).filter((s) => s.exerciseId === exId).sort((a, b) => a.n - b.n);
    if (!sets.length) continue;
    if (!best || w.date > best.date) best = { date: w.date, sets };
  }
  return best;
}

/** Most recent previous session containing this exercise (reference + overload base). */
export function lastSets(logs, exId, beforeCycle, beforeVariant) {
  const vIdx = (d) => { const i = VARIANT_KEYS.indexOf(d); return i < 0 ? 0 : i; };
  let found = null, foundKey = -1;
  for (const c of Object.keys(logs)) {
    for (const d of Object.keys(logs[c])) {
      const key = +c * 10 + vIdx(d);
      if (+c > beforeCycle || (+c === beforeCycle && vIdx(d) >= vIdx(beforeVariant))) continue;
      const ex = logs[c][d].exercises.find((x) => x.id === exId);
      if (ex && ex.sets.length && key > foundKey) { found = { cycle: +c, sets: ex.sets }; foundKey = key; }
    }
  }
  return found;
}

/** New PRs achieved in a given session vs everything logged before that cycle. */
export function dayPRs(logs, cycle, variant) {
  const entry = (logs[cycle] || {})[variant];
  if (!entry) return [];
  const prs = [];
  for (const ex of entry.exercises) {
    let bestToday = null;
    for (const s of ex.sets) if (!bestToday || s.realKg > bestToday.realKg) bestToday = s;
    if (!bestToday) continue;
    let prior = null;
    for (const c of Object.keys(logs)) {
      if (+c >= cycle) continue;
      for (const d of Object.keys(logs[c])) {
        const x = logs[c][d].exercises.find((q) => q.id === ex.id);
        if (!x) continue;
        for (const s of x.sets) if (prior == null || s.realKg > prior) prior = s.realKg;
      }
    }
    if (prior == null || bestToday.realKg > prior) prs.push({ id: ex.id, name: ex.name, set: bestToday });
  }
  return prs;
}

/** Per-muscle averages for one cycle: sets count, avg realKg, avg reps. */
export function muscleAverages(logs, cycle, exMap) {
  const agg = {};
  const ck = logs[cycle] || {};
  for (const d of Object.keys(ck)) {
    for (const ex of ck[d].exercises) {
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

/** Per-muscle progress for the Metrics accordion cards: one point per cycle of
 *  avg load per rep (Σ realKg·reps / Σ reps), plus the same series per exercise.
 *  Returns { [muscle]: { series: [{cycle, kg}], exercises: [{ id, name, series }] } }. */
export function muscleProgress(logs, exMap) {
  const cycles = Object.keys(logs).map(Number).sort((a, b) => a - b);
  const byMuscle = {};
  for (const c of cycles) {
    const perM = {}, perE = {};
    for (const d of Object.keys(logs[c])) {
      for (const ex of logs[c][d].exercises) {
        const m = (exMap[ex.id] || {}).muscle || 'Other';
        for (const s of ex.sets) {
          const reps = s.reps || 0;
          if (!reps) continue;
          (perM[m] = perM[m] || { kg: 0, reps: 0 });
          perM[m].kg += s.realKg * reps; perM[m].reps += reps;
          (perE[ex.id] = perE[ex.id] || { kg: 0, reps: 0, name: ex.name, muscle: m });
          perE[ex.id].kg += s.realKg * reps; perE[ex.id].reps += reps;
        }
      }
    }
    for (const [m, a] of Object.entries(perM)) {
      (byMuscle[m] = byMuscle[m] || { series: [], exercises: [] }).series.push({ cycle: c, kg: +(a.kg / a.reps).toFixed(1) });
    }
    for (const [id, a] of Object.entries(perE)) {
      const bm = byMuscle[a.muscle];
      let e = bm.exercises.find((x) => x.id === id);
      if (!e) bm.exercises.push((e = { id, name: a.name, series: [] }));
      e.series.push({ cycle: c, kg: +(a.kg / a.reps).toFixed(1) });
    }
  }
  return byMuscle;
}

/** Per-cycle best working weight (realKg) for an exercise. One point per cycle. */
export function exerciseSeries(logs, exId) {
  const out = [];
  const cycles = Object.keys(logs).map(Number).sort((a, b) => a - b);
  for (const c of cycles) {
    let best = null;
    for (const d of Object.keys(logs[c])) {
      const ex = logs[c][d].exercises.find((x) => x.id === exId);
      if (!ex) continue;
      for (const s of ex.sets) if (best == null || s.realKg > best) best = s.realKg;
    }
    if (best != null) out.push({ cycle: c, kg: +best.toFixed(1) });
  }
  return out;
}

/** Per-cycle best est-1RM series for an exercise. */
export function oneRmSeries(logs, exId) {
  const out = [];
  const cycles = Object.keys(logs).map(Number).sort((a, b) => a - b);
  for (const c of cycles) {
    let best = null;
    for (const d of Object.keys(logs[c])) {
      const ex = logs[c][d].exercises.find((x) => x.id === exId);
      if (!ex) continue;
      for (const s of ex.sets) { const rm = est1RM(s.realKg, s.reps); if (best == null || rm > best) best = rm; }
    }
    if (best != null) out.push({ cycle: c, kg: +best.toFixed(1) });
  }
  return out;
}
