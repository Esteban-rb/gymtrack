// GymTrack — global state (Zustand) hydrated from Dexie; every mutation writes through to IndexedDB.
import { create } from 'zustand';
import { db, ensureSeeded } from './db.js';
import { toKg, est1RM, isoDate, mondayOf, weekOfPeriod, dayKeyOf, medalForStandards, medalForProgression } from './calc.js';
import { bestSet, dayPRs, buildLogs, dayVolume, workoutsDone, weekVolume, exerciseSeries } from './metrics.js';

const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export const useStore = create((set, get) => ({
  loaded: false,
  profile: null,
  period: null,          // active period
  allPeriods: [],
  exercises: [],         // sorted by order, includes inactive
  templates: {},         // day -> { day, block, exerciseIds }
  workouts: [],
  setsByWorkout: {},     // workoutId -> set rows
  bodyweight: [],        // sorted by date asc
  prs: {},               // exerciseId -> personalRecords row
  medalUnlock: null,     // transient: { exercise, level }
  periodCelebration: null, // transient: summary of the period just archived

  /* ---------------- bootstrap ---------------- */
  init: async () => {
    window.__gt_trace = 'init:start';
    await ensureSeeded();
    window.__gt_trace = 'init:seeded';
    const [profile, allPeriods, exercises, templateRows, workouts, sets, bodyweight, prRows] = await Promise.all([
      db.profile.get(1),
      db.periods.toArray(),
      db.exercises.toArray(),
      db.dayTemplates.toArray(),
      db.workouts.toArray(),
      db.sets.toArray(),
      db.bodyweightLog.orderBy('date').toArray(),
      db.personalRecords.toArray(),
    ]);
    window.__gt_trace = 'init:loaded-tables';
    const setsByWorkout = {};
    for (const s of sets) (setsByWorkout[s.workoutId] = setsByWorkout[s.workoutId] || []).push(s);
    set({
      loaded: true,
      profile,
      allPeriods,
      period: allPeriods.find((p) => p.status === 'active') || null,
      exercises: exercises.sort(sortByOrder),
      templates: Object.fromEntries(templateRows.map((t) => [t.day, t])),
      workouts,
      setsByWorkout,
      bodyweight,
      prs: Object.fromEntries(prRows.map((r) => [r.exerciseId, r])),
    });
  },

  exMap: () => Object.fromEntries(get().exercises.map((e) => [e.id, e])),

  /* ---------------- profile / theme ---------------- */
  updateProfile: async (patch) => {
    const profile = { ...get().profile, ...patch };
    await db.profile.put(profile);
    set({ profile });
  },

  addBodyweight: async (kg, date = isoDate()) => {
    const id = await db.bodyweightLog.add({ date, kg });
    const bodyweight = [...get().bodyweight.filter((b) => b.date !== date), { id, date, kg }].sort((a, b) => a.date.localeCompare(b.date));
    set({ bodyweight });
    await get().updateProfile({ bodyweightKg: kg });
  },

  /* ---------------- periods ---------------- */
  updatePeriod: async (patch) => {
    const period = { ...get().period, ...patch };
    await db.periods.put(period);
    set({ period, allPeriods: get().allPeriods.map((p) => (p.id === period.id ? period : p)) });
  },

  /** Everything the closing recap needs, computed from the active period's logs. */
  periodSummary: () => {
    const { period, workouts, setsByWorkout, exercises } = get();
    if (!period) return null;
    const exMap = get().exMap();
    const logs = buildLogs(workouts, setsByWorkout, period.id, exMap);
    let volume = 0, sets = 0;
    for (const w of Object.keys(logs)) {
      volume += weekVolume(logs, +w);
      for (const d of Object.keys(logs[w])) for (const ex of logs[w][d].exercises) sets += ex.sets.length;
    }
    const gains = [];
    for (const e of exercises) {
      const series = exerciseSeries(logs, e.id);
      if (series.length < 2) continue;
      const first = series[0].kg, best = Math.max(...series.map((s) => s.kg));
      if (first > 0 && best > first) gains.push({ id: e.id, name: e.name, from: first, to: best, pct: Math.round(((best - first) / first) * 100) });
    }
    gains.sort((a, b) => b.pct - a.pct);
    const medals = [0, 0, 0, 0, 0];
    for (const e of exercises) {
      const l = get().medalLevel(e.id);
      if (l >= 0) medals[l]++;
    }
    return { weeks: period.weeks, startDate: period.startDate, workouts: workoutsDone(logs), sets, volume, gains: gains.slice(0, 3), medals };
  },

  archiveAndStartNew: async () => {
    const { period } = get();
    const summary = get().periodSummary();
    if (period) await db.periods.update(period.id, { status: 'archived', endDate: isoDate() });
    const fresh = { startDate: isoDate(mondayOf(new Date())), weeks: period?.weeks || 12, status: 'active' };
    fresh.id = await db.periods.add(fresh);
    const allPeriods = await db.periods.toArray();
    // only celebrate if the period actually had training in it
    set({ period: fresh, allPeriods, periodCelebration: summary && summary.workouts > 0 ? summary : null });
  },

  dismissPeriodCelebration: () => set({ periodCelebration: null }),

  /* ---------------- workouts ---------------- */
  /** Today's workout row, or null. */
  todayWorkout: () => get().workouts.find((w) => w.date === isoDate()) || null,

  /** Create today's workout from a day template (used on first set or on override). */
  createWorkout: async (templateDay) => {
    const { period, templates } = get();
    const tpl = templates[templateDay];
    if (!period || !tpl) return null;
    const w = {
      date: isoDate(),
      periodId: period.id,
      week: weekOfPeriod(period.startDate),
      dayKey: dayKeyOf(),
      templateDay,
      block: tpl.block,
      finished: false,
      entries: tpl.exerciseIds.map((exerciseId) => ({ exerciseId })),
    };
    w.id = await db.workouts.add(w);
    set({ workouts: [...get().workouts, w] });
    return w;
  },

  /** Override today's plan with another day's template. Keeps entries that already have sets. */
  overrideToday: async (templateDay) => {
    const { templates } = get();
    const existing = get().todayWorkout();
    if (!existing) return get().createWorkout(templateDay);
    const tpl = templates[templateDay];
    if (!tpl) return existing;
    const sets = get().setsByWorkout[existing.id] || [];
    const withSets = existing.entries.filter((en) => sets.some((s) => s.exerciseId === en.exerciseId));
    const merged = [...withSets];
    for (const exerciseId of tpl.exerciseIds) {
      if (!merged.some((en) => en.exerciseId === exerciseId)) merged.push({ exerciseId });
    }
    const w = { ...existing, templateDay, block: tpl.block, entries: merged };
    await db.workouts.put(w);
    set({ workouts: get().workouts.map((x) => (x.id === w.id ? w : x)) });
    return w;
  },

  /** Replace an entry's exercise for this workout only (machine taken, etc.). */
  swapEntry: async (workoutId, index, newExerciseId) => {
    const w = get().workouts.find((x) => x.id === workoutId);
    if (!w) return;
    const entries = w.entries.map((en, i) => (i === index ? { exerciseId: newExerciseId } : en));
    const next = { ...w, entries };
    await db.workouts.put(next);
    set({ workouts: get().workouts.map((x) => (x.id === workoutId ? next : x)) });
  },

  addEntry: async (workoutId, exerciseId) => {
    const w = get().workouts.find((x) => x.id === workoutId);
    if (!w || w.entries.some((en) => en.exerciseId === exerciseId)) return;
    const next = { ...w, entries: [...w.entries, { exerciseId }] };
    await db.workouts.put(next);
    set({ workouts: get().workouts.map((x) => (x.id === workoutId ? next : x)) });
  },

  finishWorkout: async (workoutId) => {
    const w = get().workouts.find((x) => x.id === workoutId);
    if (!w) return null;
    const next = { ...w, finished: true };
    await db.workouts.put(next);
    const workouts = get().workouts.map((x) => (x.id === workoutId ? next : x));
    set({ workouts });
    const logs = buildLogs(workouts, get().setsByWorkout, w.periodId, get().exMap());
    const entry = (logs[w.week] || {})[w.dayKey];
    return {
      sets: entry ? entry.exercises.reduce((a, x) => a + x.sets.length, 0) : 0,
      volume: dayVolume(entry),
      prs: dayPRs(logs, w.week, w.dayKey),
      workoutNum: workoutsDone(logs),
    };
  },

  /* ---------------- sets ---------------- */
  logSet: async (workoutId, exerciseId, draft) => {
    const { setsByWorkout } = get();
    const existing = (setsByWorkout[workoutId] || []).filter((s) => s.exerciseId === exerciseId);
    const row = {
      workoutId,
      exerciseId,
      n: existing.length + 1,
      reps: draft.reps,
      value: draft.value,
      unit: draft.unit,
      realKg: +toKg(draft.value, draft.unit).toFixed(3),
    };
    row.id = await db.sets.add(row);
    set({ setsByWorkout: { ...setsByWorkout, [workoutId]: [...(setsByWorkout[workoutId] || []), row] } });
    return get().refreshPR(exerciseId);
  },

  editSet: async (setId, workoutId, draft) => {
    const rows = get().setsByWorkout[workoutId] || [];
    const old = rows.find((s) => s.id === setId);
    if (!old) return;
    const row = { ...old, reps: draft.reps, value: draft.value, unit: draft.unit, realKg: +toKg(draft.value, draft.unit).toFixed(3) };
    await db.sets.put(row);
    set({ setsByWorkout: { ...get().setsByWorkout, [workoutId]: rows.map((s) => (s.id === setId ? row : s)) } });
    return get().refreshPR(old.exerciseId);
  },

  deleteSet: async (setId, workoutId) => {
    const rows = get().setsByWorkout[workoutId] || [];
    const old = rows.find((s) => s.id === setId);
    if (!old) return;
    await db.sets.delete(setId);
    // renumber remaining sets of that exercise
    const remaining = rows.filter((s) => s.id !== setId);
    let n = 0;
    const renumbered = remaining.map((s) => (s.exerciseId === old.exerciseId ? { ...s, n: ++n } : s));
    await db.sets.bulkPut(renumbered.filter((s) => s.exerciseId === old.exerciseId));
    set({ setsByWorkout: { ...get().setsByWorkout, [workoutId]: renumbered } });
    return get().refreshPR(old.exerciseId);
  },

  /** Recompute the stored personal record (+medal) for one exercise.
   *  Returns { pr, medalBefore, medalAfter } so the UI can fire the unlock animation. */
  refreshPR: async (exerciseId) => {
    const { workouts, setsByWorkout, profile, prs } = get();
    const exMap = get().exMap();
    const ex = exMap[exerciseId];
    const dated = [];
    for (const w of workouts) {
      for (const s of setsByWorkout[w.id] || []) {
        if (s.exerciseId === exerciseId) dated.push({ ...s, date: w.date });
      }
    }
    const medalBefore = get().medalLevel(exerciseId);
    if (!dated.length) {
      await db.personalRecords.delete(exerciseId);
      const next = { ...prs };
      delete next[exerciseId];
      set({ prs: next });
      return { pr: null, medalBefore, medalAfter: -1 };
    }
    dated.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    // baseline = top set of the first-ever session (anchor for progression medals)
    const firstDate = dated[0].date;
    const baselineKg = Math.max(...dated.filter((s) => s.date === firstDate).map((s) => s.realKg));
    let best = dated[0];
    for (const s of dated) if (s.realKg > best.realKg || (s.realKg === best.realKg && s.reps > best.reps)) best = s;
    const pr = {
      exerciseId,
      kg: best.realKg,
      reps: best.reps,
      value: best.value,
      unit: best.unit,
      date: best.date,
      oneRm: +est1RM(best.realKg, best.reps).toFixed(1),
      baselineKg,
    };
    await db.personalRecords.put(pr);
    set({ prs: { ...prs, [exerciseId]: pr } });
    const medalAfter = ex?.isBasic && ex.standards
      ? medalForStandards(pr.oneRm, profile.bodyweightKg, ex.standards)
      : medalForProgression(pr.kg, pr.baselineKg);
    if (medalAfter > medalBefore && medalAfter >= 0) set({ medalUnlock: { exercise: ex, level: medalAfter } });
    return { pr, medalBefore, medalAfter };
  },

  dismissMedal: () => set({ medalUnlock: null }),

  /** Current medal level for an exercise: -1 (locked) .. 4 (diamond). */
  medalLevel: (exerciseId) => {
    const { prs, profile } = get();
    const ex = get().exMap()[exerciseId];
    const pr = prs[exerciseId];
    if (!ex || !pr) return -1;
    return ex.isBasic && ex.standards
      ? medalForStandards(pr.oneRm, profile.bodyweightKg, ex.standards)
      : medalForProgression(pr.kg, pr.baselineKg);
  },

  /* ---------------- catalog / templates ---------------- */
  saveExercise: async (exercise) => {
    await db.exercises.put(exercise);
    const list = get().exercises.some((e) => e.id === exercise.id)
      ? get().exercises.map((e) => (e.id === exercise.id ? exercise : e))
      : [...get().exercises, exercise];
    set({ exercises: list.sort(sortByOrder) });
  },

  addExercise: async ({ name, muscle, unit }) => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
    const exercise = { id, name, muscle, unit, isBasic: false, standards: null, active: true, order: get().exercises.length };
    await get().saveExercise(exercise);
    return exercise;
  },

  saveTemplate: async (tpl) => {
    await db.dayTemplates.put(tpl);
    set({ templates: { ...get().templates, [tpl.day]: tpl } });
  },
}));
