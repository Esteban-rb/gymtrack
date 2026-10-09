// GymTrack — global state (Zustand) hydrated from Dexie; every mutation writes through to IndexedDB.
import { create } from 'zustand';
import { validateProfileDraft, hasRealTrainingData, getSetupStatus } from './setup.js';
import { validateRoutineDraft } from './routine-draft.js';
import { advanceIndependentSchedule, selectScheduledVariant } from './schedule.js';
import { validateSchedule } from './schedule.js';
import { db, ensureSeeded } from './db.js';
import { toKg, est1RM, isoDate, parseISO, mondayOf, weekOfPeriod, dayKeyOf, medalForStandards, medalForProgression } from './calc.js';
import { bestSet, dayPRs, buildLogs, dayVolume, entryForWorkout, workoutsDone, cycleVolume, exerciseSeries, shouldAutoFinish } from './metrics.js';

const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const configuredCode = (period, date) => {
  if (!period?.trainingSchedule) return null;
  return selectScheduledVariant(period.trainingSchedule, { date, rotationPos: period.rotationPos }).variant;
};
const weeklyCycle = (period, date) => {
  if (period?.trainingSchedule?.mode !== 'weekly' || !period.startDate) return period?.cycle ?? 1;
  const mondayOrdinal = (iso) => {
    const [year, month, day] = iso.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
    return Math.floor(value.getTime() / 86400000);
  };
  return Math.max(1, Math.floor((mondayOrdinal(date) - mondayOrdinal(period.startDate)) / 7) + 1);
};
const variantForSchedule = (period, variants, date) => {
  const code = configuredCode(period, date);
  return code == null ? null : variants.find((variant) => variant.code === code) || null;
};

const setMutationQueues = new Map();
const serializeSetMutation = (workoutId, mutation) => {
  const previous = setMutationQueues.get(workoutId) || Promise.resolve();
  const current = previous.catch(() => {}).then(mutation);
  setMutationQueues.set(workoutId, current);
  return current.finally(() => {
    if (setMutationQueues.get(workoutId) === current) setMutationQueues.delete(workoutId);
  });
};

/** Sets per exercise that mark a session as "done" for the auto-finish rule. */
export const AUTO_FINISH_MIN_SETS = 2;

export const useStore = create((set, get) => ({
  loaded: false,
  profile: null,
  period: null,          // active period
  allPeriods: [],
  exercises: [],         // sorted by order, includes inactive
  variants: [],          // active period variants; retained definitions remain in allVariants
  allVariants: [],
  activeVariant: null,
  scheduleView: null, // ephemeral configured-plan browse selection; never persisted
  templates: {},         // legacy day -> { day, block, exerciseIds } (unused by the rotation UI)
  workouts: [],
  setsByWorkout: {},     // workoutId -> set rows
  bodyweight: [],        // sorted by date asc
  prs: {},               // exerciseId -> personalRecords row
  setupStatus: 'first-run-required',
  medalUnlock: null,     // transient: { exercise, level }
  periodCelebration: null, // transient: summary of the period just archived

  /* ---------------- bootstrap ---------------- */
  init: async () => {
    window.__gt_trace = 'init:start';
    await ensureSeeded();
    window.__gt_trace = 'init:seeded';
    const [profile, allPeriods, exercises, variantRows, templateRows, workouts, sets, bodyweight, prRows] = await Promise.all([
      db.profile.get(1),
      db.periods.toArray(),
      db.exercises.toArray(),
      db.routineVariants.toArray(),
      db.dayTemplates.toArray(),
      db.workouts.toArray(),
      db.sets.toArray(),
      db.bodyweightLog.orderBy('date').toArray(),
      db.personalRecords.toArray(),
    ]);
    window.__gt_trace = 'init:loaded-tables';
    const setsByWorkout = {};
    for (const s of sets) (setsByWorkout[s.workoutId] = setsByWorkout[s.workoutId] || []).push(s);
    const setupData = {
      profile, periods: allPeriods, exercises, routineVariants: variantRows,
      workouts, sets, bodyweightLog: bodyweight, personalRecords: prRows,
    };
    const active = allPeriods.find((p) => p.status === 'active') || null;
    const ownedCodes = new Set(allPeriods.filter((p) => p.routineRevision).flatMap((p) => p.routineVariantCodes || []));
    const activeVariants = active?.routineVariantCodes?.length
      ? variantRows.filter((v) => active.routineVariantCodes.includes(v.code))
      : variantRows.filter((v) => !v.ownerPeriodId && !ownedCodes.has(v.code));
    set({
      setupStatus: getSetupStatus({
        markers: { complete: profile?.setupComplete, required: profile?.setupRequired, skipped: profile?.setupSkipped, invitation: profile?.setupInvitation },
        hasRealData: hasRealTrainingData(setupData),
      }),
      loaded: true,
      profile,
      allPeriods,
      period: active,
      exercises: exercises.sort(sortByOrder),
      variants: activeVariants.sort(sortByOrder),
      allVariants: variantRows.sort(sortByOrder),
      activeVariant: active?.trainingSchedule
        ? variantForSchedule(active, activeVariants, isoDate())
        : activeVariants[active?.rotationPos || 0] || null,
      scheduleView: null,
      templates: Object.fromEntries(templateRows.map((t) => [t.day, t])),
      workouts,
      setsByWorkout,
      bodyweight,
      prs: Object.fromEntries(prRows.map((r) => [r.exerciseId, r])),
    });
  },

  exMap: () => Object.fromEntries(get().exercises.map((e) => [e.id, e])),
  variantMap: () => Object.fromEntries(get().variants.map((v) => [v.code, v])),

  /* ---------------- rotation ---------------- */
  /** The variant queued next in the rotation (the one Today shows by default). */
  currentVariant: (date = isoDate()) => {
    const { period, variants } = get();
    if (!variants.length) return null;
    if (period?.trainingSchedule) return variantForSchedule(period, variants, date);
    const pos = ((period?.rotationPos ?? 0) % variants.length + variants.length) % variants.length;
    return variants[pos];
  },

  /** Effective cycle for a calendar date. Weekly plans advance by Mondays, not attendance. */
  effectiveCycle: (date = isoDate()) => weeklyCycle(get().period, date),

  /** Variants finished in a cycle (defaults to the active one, for the x/6 progress ring).
   *  Returns a Set of codes. */
  cycleDone: (cycle) => {
    const { period, workouts } = get();
    const done = new Set();
    if (!period) return done;
    const target = cycle ?? get().effectiveCycle();
    for (const w of workouts) {
      if (w.periodId === period.id && w.finished && (w.cycle ?? 1) === target) done.add(w.variant);
    }
    return done;
  },

  /** Point the rotation at another cycle — the fix for a cycle that ran ahead while
   *  variants were still pending. An unfinished session today follows the pointer
   *  (keeping its variant and sets); a finished one is left where it is. */
  setActiveCycle: async (cycle) => {
    const { period, variants, scheduleView } = get();
    if (!period || !variants.length) return;
    if (period.trainingSchedule) {
      if (!Number.isInteger(cycle) || cycle < 1) return;
      const view = scheduleView?.periodId === period.id ? scheduleView : null;
      const variantCode = variants.some((variant) => variant.code === view?.variantCode)
        ? view.variantCode : get().currentVariant()?.code || period.routineVariantCodes?.[0];
      if (!variants.some((variant) => variant.code === variantCode)) return;
      set({ scheduleView: { periodId: period.id, cycle, variantCode } });
      return;
    }
    if (cycle < 1 || cycle === (period.cycle ?? 1)) return;
    const existing = get().todayWorkout();
    const keep = existing && !existing.finished;   // la sesión en curso conserva su variante
    const patch = { cycle };
    if (!keep) {
      const pending = variants.find((v) => !get().cycleDone(cycle).has(v.code));
      patch.rotationPos = pending ? variants.indexOf(pending) : 0;
    }
    await get().updatePeriod(patch);
    if (keep) {
      const w = { ...existing, cycle };
      await db.workouts.put(w);
      set({ workouts: get().workouts.map((x) => (x.id === w.id ? w : x)) });
    }
  },

  /** Point the rotation at a chosen variant. Navigating to a variant already trained in this
   *  cycle just shows that session (Today renders it) — nothing is created or retargeted.
   *  Otherwise an in-progress session today is retargeted to it, and a finished one stays
   *  untouched while a fresh second session starts for the new variant. */
  setActiveVariant: async (variantCode) => {
    const idx = get().variants.findIndex((v) => v.code === variantCode);
    if (idx < 0) return;
    const { period, scheduleView } = get();
    if (period?.trainingSchedule) {
      if (!(period.routineVariantCodes || []).includes(variantCode)) return;
      const view = scheduleView?.periodId === period.id ? scheduleView : null;
      set({ scheduleView: { periodId: period.id, cycle: view?.cycle || get().effectiveCycle(), variantCode } });
      return;
    }
    await get().updatePeriod({ rotationPos: idx });
    if (get().sessionFor(variantCode)) return;   // ya entrenada: se abre en modo consulta
    const existing = get().todayWorkout();
    if (existing && !existing.finished) {
      const v = get().variantMap()[variantCode];
      const w = { ...existing, variant: v.code, block: v.name, cycle: get().period.cycle ?? 1, entries: v.exerciseIds.map((exerciseId) => ({ exerciseId })) };
      await db.workouts.put(w);
      set({ workouts: get().workouts.map((x) => (x.id === w.id ? w : x)) });
    } else if (existing && existing.finished && (existing.variant !== variantCode || (existing.cycle ?? 1) !== (get().period.cycle ?? 1))) {
      await get().createWorkout(variantCode);
    }
  },

  clearScheduleView: () => set({ scheduleView: null }),

  /* ---------------- profile / theme ---------------- */
  updateProfile: async (patch) => {
    const profile = { ...get().profile, ...patch };
    await db.profile.put(profile);
    set({ profile });
  },

  /** Explicit, validated setup save. Signature: saveSetupProfile(profileDraft) -> profile. */
  saveSetupProfile: async (draft) => {
    const result = validateProfileDraft(draft);
    if (!result.valid) throw Object.assign(new Error('Invalid setup profile'), { errors: result.errors });
    const old = get().profile || { id: 1 };
    const profile = { ...old, ...result.profile, setupSkipped: false };
    const priorWeight = old.bodyweightKg;
    const weightChanged = priorWeight !== profile.bodyweightKg;
    const logRows = await db.bodyweightLog.toArray();
    const today = isoDate();
    const bodyweight = [...logRows.filter((row) => row.date !== today), { ...(logRows.find((row) => row.date === today) || {}), date: today, kg: profile.bodyweightKg }].sort((a, b) => a.date.localeCompare(b.date));
    const workouts = get().workouts;
    const dateByWorkout = new Map(workouts.map((workout) => [workout.id, workout.date]));
    const sets = weightChanged ? await db.sets.toArray() : [];
    const grouped = new Map();
    for (const row of sets) if (dateByWorkout.has(row.workoutId)) {
      const list = grouped.get(row.exerciseId) || []; list.push({ ...row, date: dateByWorkout.get(row.workoutId) }); grouped.set(row.exerciseId, list);
    }
    const prRows = [...grouped].map(([exerciseId, dated]) => {
      dated.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      const firstDate = dated[0].date;
      const baselineKg = Math.max(...dated.filter((row) => row.date === firstDate).map((row) => row.realKg));
      let best = dated[0];
      for (const row of dated) if (row.realKg > best.realKg || (row.realKg === best.realKg && row.reps > best.reps)) best = row;
      return { exerciseId, kg: best.realKg, reps: best.reps, value: best.value, unit: best.unit, date: best.date, oneRm: +est1RM(best.realKg, best.reps).toFixed(1), baselineKg };
    });
    const { committedBodyweight, committedPrRows, committedProfile } = await db.transaction('rw', db.profile, db.periods, db.exercises, db.routineVariants, db.workouts, db.sets, db.bodyweightLog, db.personalRecords, async () => {
      const [currentProfile, periods, exercises, routineVariants, currentWorkouts, currentSets, bodyweightLog, personalRecords] = await Promise.all([
        db.profile.get(1), db.periods.toArray(), db.exercises.toArray(), db.routineVariants.toArray(),
        db.workouts.toArray(), db.sets.toArray(), db.bodyweightLog.toArray(), db.personalRecords.toArray(),
      ]);
      const wasSeedOnly = !hasRealTrainingData({ profile: currentProfile, periods, exercises, routineVariants, workouts: currentWorkouts, sets: currentSets, bodyweightLog, personalRecords });
      // a user who explicitly skipped (or was invited) must not be pushed back into the required first-run gate
      const optedOut = currentProfile?.setupSkipped === true || currentProfile?.setupInvitation === true;
      const nextProfile = optedOut && wasSeedOnly && currentProfile?.setupRequired !== true
        ? { ...profile, setupInvitation: true, setupRequired: false }
        : { ...profile, setupRequired: currentProfile?.setupRequired === true || wasSeedOnly ? true : currentProfile?.setupRequired };
      await db.profile.put(nextProfile);
      const todayRow = logRows.find((row) => row.date === today);
      if (todayRow) await db.bodyweightLog.put({ ...todayRow, kg: profile.bodyweightKg });
      else await db.bodyweightLog.add({ date: today, kg: profile.bodyweightKg });
      if (weightChanged) await db.personalRecords.bulkPut(prRows);
      return {
        committedProfile: await db.profile.get(1),
        committedBodyweight: await db.bodyweightLog.orderBy('date').toArray(),
        committedPrRows: weightChanged ? await db.personalRecords.toArray() : null,
      };
    });
    set((state) => ({ profile: committedProfile, bodyweight: committedBodyweight, prs: weightChanged ? Object.fromEntries(committedPrRows.map((row) => [row.exerciseId, row])) : state.prs }));
    return committedProfile;
  },

  /** Signature: skipSetup() -> status; an explicit skip (first run or invitation) is persisted and clears the required marker. */
  skipSetup: async () => {
    const profile = { ...get().profile, setupSkipped: true, setupInvitation: false, setupRequired: false };
    await db.profile.put(profile);
    set({ profile, setupStatus: 'skipped' });
    return 'skipped';
  },

  /** Signature: reopenSetup() -> status; clears skip/invitation without marking completion. */
  reopenSetup: async () => {
    const wasSkipped = get().profile?.setupSkipped === true;
    const hasRealData = hasRealTrainingData({ profile: get().profile, periods: get().allPeriods, exercises: get().exercises, routineVariants: get().variants, workouts: get().workouts, sets: Object.values(get().setsByWorkout).flat(), bodyweightLog: get().bodyweight, personalRecords: Object.values(get().prs) });
    // a seed-only user who skipped keeps an optional (closable) wizard: persist an invitation instead of re-gating first run
    const invitation = wasSkipped && !hasRealData && get().profile?.setupRequired !== true;
    const profile = { ...get().profile, setupSkipped: false, setupInvitation: invitation };
    await db.profile.put(profile);
    const status = getSetupStatus({ markers: { complete: profile.setupComplete, required: profile.setupRequired, invitation }, hasRealData });
    set({ profile, setupStatus: status });
    return status;
  },

  addBodyweight: async (kg, date = isoDate()) => {
    await db.bodyweightLog.where('date').equals(date).delete(); // re-logging a day replaces it
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
    for (const c of Object.keys(logs)) {
      volume += cycleVolume(logs, +c);
      for (const v of Object.keys(logs[c])) for (const ex of logs[c][v].exercises) sets += ex.sets.length;
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
    // completed cycles = full U1→L3 passes already logged in this period
    const cyclesDone = Math.max(0, (period.cycle ?? 1) - 1);
    return { cycleGoal: period.cycleGoal || 6, cyclesDone, startDate: period.startDate, workouts: workoutsDone(logs), sets, volume, gains: gains.slice(0, 3), medals };
  },

  applyReviewedRoutine: async (draft, schedule, { cycleGoal = get().period?.cycleGoal ?? 6, resolution } = {}) => {
    if (resolution === 'cancel') return { status: 'cancelled', cancelled: true };
    if (!Number.isInteger(cycleGoal) || cycleGoal < 4 || cycleGoal > 8) throw new Error('Mesocycle goal must be an integer from 4 to 8');
    const callerPeriod = get().period;
    const result = await db.transaction('rw', db.profile, db.periods, db.workouts, db.exercises, db.routineVariants, async () => {
      const [profile, periods, workouts, exercises, variants] = await Promise.all([
        db.profile.get(1), db.periods.toArray(), db.workouts.toArray(), db.exercises.toArray(), db.routineVariants.toArray(),
      ]);
      const active = periods.filter((period) => period.status === 'active');
      if (!callerPeriod || active.length !== 1 || active[0].id !== callerPeriod.id || JSON.stringify(active[0]) !== JSON.stringify(callerPeriod)) throw new Error('Active period state conflicts with database');
      const currentWorkouts = workouts.filter((workout) => workout.periodId === callerPeriod.id);
      const unfinished = currentWorkouts.filter((workout) => !workout.finished);
      if (unfinished.length > 1 && resolution !== 'restart') throw new Error('Multiple unfinished workouts in active period');
      if (unfinished.length === 1 && resolution !== 'restart') throw new Error('Unfinished workout requires explicit resolution: restart');
      const checkedProfile = validateProfileDraft(profile);
      if (!checkedProfile.valid) throw Object.assign(new Error('Invalid saved setup profile'), { errors: checkedProfile.errors });
      const checkedDraft = validateRoutineDraft(draft, exercises);
      if (!checkedDraft.valid) throw Object.assign(new Error('Invalid reviewed routine draft'), { errors: checkedDraft.errors });
      const checkedSchedule = validateSchedule(schedule, checkedDraft.draft.variants.map((variant) => variant.code));
      if (!checkedSchedule.valid) throw Object.assign(new Error('Invalid reviewed routine schedule'), { errors: checkedSchedule.errors });

      let targetPeriod = callerPeriod;
      if (currentWorkouts.length) {
        const archived = { ...callerPeriod, status: 'archived', endDate: isoDate() };
        await db.periods.put(archived);
        if (unfinished.length) await db.workouts.bulkPut(unfinished.map((workout) => ({ ...workout, finished: true, closeReason: 'mesocycle-restart' })));
        const fresh = { startDate: isoDate(mondayOf(new Date())), cycleGoal, status: 'active', rotationPos: 0, cycle: 1 };
        fresh.id = await db.periods.add(fresh);
        targetPeriod = fresh;
      }
      const usedCodes = new Set(variants.map((variant) => variant.code));
      const revision = (targetPeriod.routineRevision || 0) + 1;
      const codeMap = new Map();
      for (const variant of checkedDraft.draft.variants) {
        const base = `${variant.code}@p${targetPeriod.id}r${revision}`;
        let code = base, suffix = 1;
        while (usedCodes.has(code)) code = `${base}-${suffix++}`;
        usedCodes.add(code); codeMap.set(variant.code, code);
      }
      const newByKey = new Map();
      let newOrder = exercises.reduce((max, exercise) => Math.max(max, exercise.order ?? -1), -1) + 1;
      for (const variant of checkedDraft.draft.variants) for (const entry of variant.exercises) {
        if (entry.ref.type !== 'new' || newByKey.has(entry.ref.key)) continue;
        const base = `custom-${targetPeriod.id}-${revision}-${entry.ref.key.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'exercise'}`;
        let id = base, suffix = 1;
        while (exercises.some((exercise) => exercise.id === id) || [...newByKey.values()].some((exercise) => exercise.id === id)) id = `${base}-${suffix++}`;
        newByKey.set(entry.ref.key, { id, name: entry.name, muscle: entry.muscle, unit: entry.unit, isBasic: false, standards: null, active: true, order: newOrder++ });
      }
      const createdExercises = [...newByKey.values()];
      const createdVariants = checkedDraft.draft.variants.map((variant) => {
        const exerciseUnits = {};
        const exerciseIds = variant.exercises.map((entry) => {
          const exercise = entry.ref.type === 'catalog'
            ? exercises.find((item) => item.id === entry.ref.id)
            : newByKey.get(entry.ref.key);
          exerciseUnits[exercise.id] = entry.unit;
          return exercise.id;
        });
        return { code: codeMap.get(variant.code), order: variant.order, name: variant.name, kind: variant.kind, exerciseIds, exerciseUnits, ownerPeriodId: targetPeriod.id };
      });
      let mappedSchedule;
      if (schedule.mode === 'independent') mappedSchedule = { ...schedule, rotation: schedule.rotation.map((code) => codeMap.get(code)) };
      else mappedSchedule = { ...schedule, week: Object.fromEntries(Object.entries(schedule.week).map(([day, code]) => [day, code == null ? null : codeMap.get(code)])) };
      const nextProfile = { ...profile, setupComplete: true, setupRequired: false, setupSkipped: false };
      const nextPeriod = { ...targetPeriod, cycleGoal, cycle: 1, rotationPos: 0, routineVariantCodes: createdVariants.map((variant) => variant.code), trainingSchedule: mappedSchedule, routineRevision: revision };
      if (createdExercises.length) await db.exercises.bulkAdd(createdExercises);
      await db.routineVariants.bulkAdd(createdVariants);
      await db.periods.put(nextPeriod);
      await db.profile.put(nextProfile);
      const [committedProfile, committedPeriods, committedExercises, committedVariants, committedWorkouts] = await Promise.all([
        db.profile.get(1), db.periods.toArray(), db.exercises.toArray(), db.routineVariants.toArray(), db.workouts.toArray(),
      ]);
      const committedPeriod = committedPeriods.find((period) => period.id === nextPeriod.id);
      const activeVariants = committedVariants.filter((variant) => committedPeriod.routineVariantCodes.includes(variant.code)).sort(sortByOrder);
      return { profile: committedProfile, period: committedPeriod, allPeriods: committedPeriods, exercises: committedExercises.sort(sortByOrder), allVariants: committedVariants.sort(sortByOrder), variants: activeVariants, workouts: committedWorkouts, setupStatus: 'complete' };
    });
    set((state) => ({ ...result, activeVariant: result.variants[0] || null, scheduleView: null }));
    return { status: 'applied', ...result };
  },

  startNewMesocycle: async (cycleGoal) => {
    if (!Number.isInteger(cycleGoal) || cycleGoal < 4 || cycleGoal > 8) throw new Error('Mesocycle goal must be an integer from 4 to 8');
    const callerPeriod = get().period;
    const result = await db.transaction('rw', db.periods, db.workouts, async () => {
      const periods = await db.periods.toArray();
      const active = periods.filter((p) => p.status === 'active');
      if (!callerPeriod || active.length !== 1 || active[0].id !== callerPeriod.id || JSON.stringify(active[0]) !== JSON.stringify(callerPeriod)) throw new Error('Active period state conflicts with database');
      const old = active[0];
      const workouts = await db.workouts.toArray();
      const unfinished = workouts.filter((w) => w.periodId === old.id && !w.finished);
      if (unfinished.length > 1) throw new Error('Multiple unfinished workouts in active period');
      const now = isoDate();
      await db.periods.put({ ...old, status: 'archived', endDate: now });
      let closed = null;
      if (unfinished.length) {
        closed = { ...unfinished[0], finished: true, closeReason: 'mesocycle-restart' };
        await db.workouts.put(closed);
      }
      const fresh = { startDate: isoDate(mondayOf(new Date())), cycleGoal, status: 'active', rotationPos: 0, cycle: 1, ...(old.routineVariantCodes ? { routineVariantCodes: old.routineVariantCodes } : {}), ...(old.trainingSchedule ? { trainingSchedule: old.trainingSchedule } : {}), ...(old.routineRevision != null ? { routineRevision: old.routineRevision } : {}) };
      fresh.id = await db.periods.add(fresh);
      const committedPeriods = await db.periods.toArray();
      const committedWorkouts = await db.workouts.toArray();
      return { period: committedPeriods.find((p) => p.id === fresh.id), periods: committedPeriods, workouts: committedWorkouts, workout: closed };
    });
    set({ period: result.period, allPeriods: result.periods, workouts: result.workouts, scheduleView: null });
    return result;
  },

  archiveAndStartNew: async () => {
    const summary = get().periodSummary();
    await get().startNewMesocycle(get().period?.cycleGoal || 6);
    set({ periodCelebration: summary && summary.workouts > 0 ? summary : null });
  },

  dismissPeriodCelebration: () => set({ periodCelebration: null }),

  /* ---------------- workouts ---------------- */
  /** Today's workout in the active period. An in-progress session wins over finished ones,
   *  so jumping variants after finishing shows the new session, not the closed one. */
  trainingView: (date = isoDate()) => {
    const { period, workouts, scheduleView, variants } = get();
    if (!period?.trainingSchedule) {
      const variant = get().currentVariant(date);
      return { cycle: period?.cycle ?? 1, variant, variantCode: variant?.code ?? null, workout: get().sessionInView(), isManual: false, isRest: !variant };
    }
    const unfinished = workouts.find((workout) => workout.periodId === period.id && !workout.finished);
    const variantByCode = new Map(variants.map((variant) => [variant.code, variant]));
    if (unfinished) return {
      cycle: unfinished.cycle ?? 1, variantCode: unfinished.variant, variant: variantByCode.get(unfinished.variant) || null,
      workout: unfinished, isManual: false, isRest: false,
    };
    const manual = scheduleView?.periodId === period.id
      && Number.isInteger(scheduleView.cycle) && scheduleView.cycle > 0
      && (period.routineVariantCodes || []).includes(scheduleView.variantCode);
    const cycle = manual ? scheduleView.cycle : get().effectiveCycle(date);
    const variantCode = manual ? scheduleView.variantCode : get().currentVariant(date)?.code || null;
    const variant = variantCode ? variantByCode.get(variantCode) || null : null;
    if (!variantCode || !variant) return { cycle, variant: null, variantCode: null, workout: null, isManual: !!manual, isRest: true };
    const candidates = workouts.filter((workout) => workout.periodId === period.id && workout.variant === variantCode && (workout.cycle ?? 1) === cycle && workout.finished
      && (manual || period.trainingSchedule.mode !== 'weekly' || workout.date === date))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    return { cycle, variant, variantCode, workout: candidates.at(-1) || null, isManual: !!manual, isRest: false };
  },

  todayWorkout: () => {
    const { workouts, period } = get();
    if (period?.trainingSchedule) {
      const unfinished = workouts.find((w) => w.periodId === period.id && !w.finished);
      if (unfinished) return unfinished;
    }
    const today = workouts.filter((w) => w.date === isoDate() && (!period || w.periodId === period.id));
    return today.find((w) => !w.finished) || today[today.length - 1] || null;
  },

  /** The session already logged for a cycle + variant of the active period, whatever day it
   *  was trained (defaults to the queued variant and the current cycle). */
  sessionFor: (variantCode, cycle) => {
    const { period, workouts } = get();
    const code = variantCode || get().currentVariant()?.code;
    if (!period || !code) return null;
    const target = cycle ?? get().effectiveCycle();
    const found = workouts
      .filter((w) => w.periodId === period.id && w.variant === code && (w.cycle ?? 1) === target)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    return found[found.length - 1] || null;
  },

  /** What Today shows: the session of the day if there is one, otherwise the one already
   *  logged for the cycle + variant the rotation points at. Without this, walking back to a
   *  variant trained on another day rendered an empty plan instead of what was lifted. */
  sessionInView: () => {
    const today = get().todayWorkout();
    const code = get().currentVariant()?.code;
    if (today && today.variant === code) return today;
    return get().sessionFor(code) || today;
  },

  /** Create today's workout from a rotation variant (defaults to the queued one). */
  createWorkout: async (variantCode, date = isoDate()) => {
    const { period } = get();
    const code = variantCode || get().currentVariant(date)?.code;
    const v = get().variantMap()[code];
    if (!period || !v) return !variantCode && period?.trainingSchedule ? get().todayWorkout() : null;
    const w = {
      date,
      periodId: period.id,
      cycle: weeklyCycle(period, date),
      variant: v.code,
      week: period.trainingSchedule?.mode === 'weekly' ? weeklyCycle(period, date) : weekOfPeriod(period.startDate, parseISO(date)),
      dayKey: dayKeyOf(parseISO(date)), 
      block: v.name,
      finished: false,
      entries: v.exerciseIds.map((exerciseId) => ({ exerciseId, ...(v.exerciseUnits?.[exerciseId] ? { unit: v.exerciseUnits[exerciseId] } : {}) })), 
    };
    w.id = await db.workouts.add(w);
    set({ workouts: [...get().workouts, w] });
    return w;
  },

  /** Replace an entry's exercise for this workout only (machine taken, etc.). */
  swapEntry: async (workoutId, index, newExerciseId) => {
    const w = get().workouts.find((x) => x.id === workoutId);
    if (!w || index < 0 || index >= w.entries.length) return false;
    if (w.entries.some((entry, i) => i !== index && entry.exerciseId === newExerciseId)) return false;
    const entries = w.entries.map((en, i) => (i === index ? { exerciseId: newExerciseId } : en));
    const next = { ...w, entries };
    await db.workouts.put(next);
    set({ workouts: get().workouts.map((x) => (x.id === workoutId ? next : x)) });
    return true;
  },

  addEntry: async (workoutId, exerciseId) => {
    const w = get().workouts.find((x) => x.id === workoutId);
    if (!w || w.entries.some((en) => en.exerciseId === exerciseId)) return;
    const next = { ...w, entries: [...w.entries, { exerciseId }] };
    await db.workouts.put(next);
    set({ workouts: get().workouts.map((x) => (x.id === workoutId ? next : x)) });
  },

  finishWorkout: async (workoutId) => {
    const committed = await db.transaction('rw', db.workouts, db.periods, async () => {
      const [workout, periods, beforeWorkouts] = await Promise.all([
        db.workouts.get(workoutId), db.periods.toArray(), db.workouts.toArray(),
      ]);
      if (!workout) return { changed: false, workout: null };
      if (workout.finished) return { changed: false, workout, workouts: beforeWorkouts };
      const active = periods.filter((period) => period.status === 'active');
      const activePeriod = active.length === 1 ? active[0] : null;
      const workoutPeriod = periods.find((period) => period.id === workout.periodId);
      const belongsToActive = !!activePeriod && activePeriod.id === workout.periodId;
      const mode = (belongsToActive ? activePeriod : workoutPeriod)?.trainingSchedule?.mode || 'legacy';
      if (!['legacy', 'weekly', 'independent'].includes(mode)) throw new Error('Stored routine schedule mode is invalid');
      const finished = { ...workout, finished: true };
      await db.workouts.put(finished);
      let nextPeriod = null;
      const sameCycle = belongsToActive && (workout.cycle ?? 1) === (activePeriod.cycle ?? 1);
      if (sameCycle && mode === 'independent'
        && activePeriod.trainingSchedule.rotation[activePeriod.rotationPos] === workout.variant) {
        nextPeriod = { ...activePeriod, ...advanceIndependentSchedule(activePeriod.trainingSchedule, {
          rotationPos: activePeriod.rotationPos, cycle: activePeriod.cycle ?? 1, completed: true,
        }) };
        await db.periods.put(nextPeriod);
      } else if (sameCycle && mode === 'legacy' && get().variants.length) {
        // Preserve the legacy six-variant completion heuristic, using authoritative log rows.
        const done = new Set(beforeWorkouts
          .filter((item) => item.periodId === activePeriod.id && item.finished && (item.cycle ?? 1) === (activePeriod.cycle ?? 1))
          .map((item) => item.variant));
        done.add(workout.variant);
        const variants = get().variants;
        const index = variants.findIndex((variant) => variant.code === workout.variant);
        const base = index >= 0 ? index : (activePeriod.rotationPos ?? 0);
        let nextPosition = -1;
        for (let offset = 1; offset <= variants.length; offset++) {
          const candidate = (base + offset) % variants.length;
          if (!done.has(variants[candidate].code)) { nextPosition = candidate; break; }
        }
        nextPeriod = { ...activePeriod, ...(nextPosition >= 0
          ? { rotationPos: nextPosition, cycle: activePeriod.cycle ?? 1 }
          : { rotationPos: 0, cycle: (activePeriod.cycle ?? 1) + 1 }) };
        await db.periods.put(nextPeriod);
      }
      const [workouts, committedPeriods] = await Promise.all([db.workouts.toArray(), db.periods.toArray()]);
      const committedActive = committedPeriods.filter((period) => period.status === 'active');
      return {
        changed: true, workout: finished, workouts, periods: committedPeriods,
        period: nextPeriod && committedActive.length === 1 ? committedActive[0] : null,
      };
    });
    if (!committed.workout) return null;
    if (committed.changed) {
      const period = committed.period;
      const activeVariant = period?.trainingSchedule?.mode === 'independent'
        ? get().variants.find((variant) => variant.code === period.trainingSchedule.rotation[period.rotationPos]) || get().activeVariant
        : period?.trainingSchedule?.mode === 'weekly' ? variantForSchedule(period, get().variants, isoDate()) : get().activeVariant;
      set({ workouts: committed.workouts, ...(period ? { period, allPeriods: committed.periods } : {}), activeVariant });
    }
    const finishedWorkout = committed.workout;
    const logs = buildLogs(committed.workouts || get().workouts, get().setsByWorkout, finishedWorkout.periodId, get().exMap());
    const entry = entryForWorkout(logs, finishedWorkout.cycle ?? 1, finishedWorkout.id);
    return {
      sets: entry ? entry.exercises.reduce((total, exercise) => total + exercise.sets.length, 0) : 0,
      volume: dayVolume(entry),
      prs: dayPRs(logs, finishedWorkout.cycle ?? 1, finishedWorkout.variant, finishedWorkout.id),
      workoutNum: workoutsDone(logs),
    };
  },

  /** Close the session by itself once every exercise of the plan has 2+ sets.
   *  Returns the finish summary (tagged `auto`) so Today can pop the same celebration,
   *  or null when the plan isn't covered yet / the user turned it off in Settings. */
  autoFinishIfComplete: async (workoutId) => {
    if (get().profile?.autoFinish === false) return null;
    const w = get().workouts.find((x) => x.id === workoutId);
    if (!shouldAutoFinish(w, get().setsByWorkout[workoutId], AUTO_FINISH_MIN_SETS)) return null;
    const summary = await get().finishWorkout(workoutId);
    return summary ? { ...summary, auto: true } : null;
  },

  /* ---------------- sets ---------------- */
  logSet: (workoutId, exerciseId, draft) => serializeSetMutation(workoutId, async () => {
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
    set((state) => ({
      setsByWorkout: {
        ...state.setsByWorkout,
        [workoutId]: [...(state.setsByWorkout[workoutId] || []), row],
      },
    }));
    return get().refreshPR(exerciseId);
  }),

  editSet: (setId, workoutId, draft) => serializeSetMutation(workoutId, async () => {
    const rows = get().setsByWorkout[workoutId] || [];
    const old = rows.find((s) => s.id === setId);
    if (!old) return;
    const row = { ...old, reps: draft.reps, value: draft.value, unit: draft.unit, realKg: +toKg(draft.value, draft.unit).toFixed(3) };
    await db.sets.put(row);
    set((state) => ({
      setsByWorkout: { ...state.setsByWorkout, [workoutId]: rows.map((s) => (s.id === setId ? row : s)) },
    }));
    return get().refreshPR(old.exerciseId);
  }),

  deleteSet: (setId, workoutId) => serializeSetMutation(workoutId, async () => {
    const rows = get().setsByWorkout[workoutId] || [];
    const old = rows.find((s) => s.id === setId);
    if (!old) return;
    await db.sets.delete(setId);
    // renumber remaining sets of that exercise
    const remaining = rows.filter((s) => s.id !== setId);
    let n = 0;
    const renumbered = remaining.map((s) => (s.exerciseId === old.exerciseId ? { ...s, n: ++n } : s));
    await db.sets.bulkPut(renumbered.filter((s) => s.exerciseId === old.exerciseId));
    set((state) => ({ setsByWorkout: { ...state.setsByWorkout, [workoutId]: renumbered } }));
    await get().refreshPR(old.exerciseId);
    return old;
  }),

  restoreSet: (deleted) => serializeSetMutation(deleted?.workoutId, async () => {
    if (!deleted?.id || !deleted?.workoutId) return false;
    const rows = get().setsByWorkout[deleted.workoutId] || [];
    if (rows.some((row) => row.id === deleted.id)) return false;
    const shifted = rows.map((row) => (row.exerciseId === deleted.exerciseId && row.n >= deleted.n
      ? { ...row, n: row.n + 1 }
      : row));
    await db.transaction('rw', db.sets, async () => {
      await db.sets.bulkPut([...shifted.filter((row) => row.exerciseId === deleted.exerciseId), deleted]);
    });
    set((state) => ({
      setsByWorkout: { ...state.setsByWorkout, [deleted.workoutId]: [...shifted, deleted] },
    }));
    await get().refreshPR(deleted.exerciseId);
    return true;
  }),

  /** Flip a set's back-off tag. Sets are auto-tagged as back-off when their realKg drops
   *  below the exercise's first set; this stores an explicit override (backoffForce). */
  toggleBackoff: (setId, workoutId) => serializeSetMutation(workoutId, async () => {
    const rows = get().setsByWorkout[workoutId] || [];
    const s = rows.find((x) => x.id === setId);
    if (!s) return;
    const sameEx = rows.filter((r) => r.exerciseId === s.exerciseId).sort((a, b) => a.n - b.n);
    const idx = sameEx.findIndex((r) => r.id === setId);
    const firstKg = sameEx.length ? sameEx[0].realKg : 0;
    const auto = idx > 0 && s.realKg < firstKg;
    const effective = s.backoffForce == null ? auto : s.backoffForce;
    const row = { ...s, backoffForce: !effective };
    await db.sets.put(row);
    set((state) => ({
      setsByWorkout: { ...state.setsByWorkout, [workoutId]: rows.map((r) => (r.id === setId ? row : r)) },
    }));
  }),

  /** Recompute the stored personal record (+medal) for one exercise.
   *  Returns { pr, medalBefore, medalAfter } so the UI can fire the unlock animation. */
  refreshPR: async (exerciseId) => {
    const { workouts, profile } = get();
    const exMap = get().exMap();
    const ex = exMap[exerciseId];
    const dateByWorkout = new Map(workouts.map((workout) => [workout.id, workout.date]));
    const exerciseSets = await db.sets.where('exerciseId').equals(exerciseId).toArray();
    const dated = exerciseSets
      .filter((setRow) => dateByWorkout.has(setRow.workoutId))
      .map((setRow) => ({ ...setRow, date: dateByWorkout.get(setRow.workoutId) }));
    const medalBefore = get().medalLevel(exerciseId);
    if (!dated.length) {
      await db.personalRecords.delete(exerciseId);
      set((state) => {
        const prs = { ...state.prs };
        delete prs[exerciseId];
        return { prs };
      });
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
    set((state) => ({ prs: { ...state.prs, [exerciseId]: pr } }));
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

  /** Persist an edited rotation variant (name / exercise list). */
  saveVariant: async (variant) => {
    await db.routineVariants.put(variant);
    const list = get().variants.some((v) => v.code === variant.code)
      ? get().variants.map((v) => (v.code === variant.code ? variant : v))
      : [...get().variants, variant];
    set({ variants: list.sort(sortByOrder) });
  },
}));
