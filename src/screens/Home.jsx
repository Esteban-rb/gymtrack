// GymTrack — Home: the at-a-glance dashboard. Three widgets (today's session, a record of
// the day, a progress chart) plus the streak sheet. Everything "random" here is seeded by
// the date + the variant on deck, so a widget stays put all day and rotates tomorrow.
import React, { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { exerciseHistory, pickDaily, streakInfo, trainedDates } from '../metrics.js';
import { isoDate, addDays, mondayOf, splitUnit } from '../calc.js';
import { GIcon, RingProgress, LineChart, Sheet, EmptyState } from '../components.jsx';
import { useT } from '../i18n.js';

/* Weight split in two so the number can stay big and the unit small (and so a value like
 * "40 kg ×2" never wraps inside a half-width widget). */
function unitLabel(unit, value, t) {
  const { base, dbl } = splitUnit(unit);
  if (base === 'plates') return value === 1 ? t('unitWord.plate') : t('unitWord.plates');
  return base + (dbl ? ' ×2' : '');
}

/* ---------- Widget shell: a tappable card with a hint glyph in the corner ---------- */
function Widget({ onClick, ariaLabel, icon = 'chevR', style, children }) {
  return (
    <button className="gt-card" aria-label={ariaLabel} onClick={onClick}
      style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 10, padding: 16, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', ...style }}>
      <div style={{ position: 'absolute', top: 14, right: 14, color: 'var(--text-3)', lineHeight: 0 }}>
        <GIcon name={icon} size={15} />
      </div>
      {children}
    </button>
  );
}

/* ---------- Streak sheet: consecutive training days + a dot calendar ---------- */
function StreakSheet({ open, onClose, dates }) {
  const { t, date, dateParts } = useT();
  const info = useMemo(() => streakInfo(dates), [dates]);
  const set = useMemo(() => new Set(dates), [dates]);
  const WEEKS = 12;
  // columns = weeks (oldest → current), rows = Mon..Sun, like the reference dot grid
  const grid = useMemo(() => {
    const start = addDays(mondayOf(new Date()), -7 * (WEEKS - 1));
    return Array.from({ length: WEEKS }, (_, c) =>
      Array.from({ length: 7 }, (_, r) => isoDate(addDays(start, c * 7 + r))));
  }, [dates]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthLabels = grid.map((week, i) => {
    const m = dateParts(week[0], { month: 'short' });
    const prev = i > 0 ? dateParts(grid[i - 1][0], { month: 'short' }) : null;
    return m === prev ? '' : m;
  });
  const today = isoDate();

  return (
    <Sheet open={open} onClose={onClose} title={t('home.streak.title')}>
      <div style={{ display: 'flex', gap: 10 }}>
        {[[t('home.streak.current'), info.current, true], [t('home.streak.best'), info.best, false], [t('home.streak.days'), info.total, false]].map(([label, value, hot]) => (
          <div key={label} className="gt-card" style={{ flex: 1, padding: '14px 8px', textAlign: 'center' }}>
            <div className="gt-num" style={{ fontSize: 28, color: hot && value > 0 ? 'var(--accent)' : 'var(--text)' }}>{value}</div>
            <div className="gt-micro" style={{ marginTop: 3 }}>{label.toUpperCase()}</div>
          </div>
        ))}
      </div>
      <div className="gt-sub" style={{ marginTop: 14, lineHeight: 1.5 }}>
        {info.current > 0
          ? t(info.trainedToday ? 'home.streak.logged' : 'home.streak.keep', { n: info.current, unit: t(info.current === 1 ? 'home.streak.dayRow' : 'home.streak.daysRow') })
          : (info.lastDate ? t('home.streak.none', { date: date(info.lastDate) }) : t('home.streak.first'))}
      </div>

      <div className="gt-label" style={{ margin: '20px 0 10px' }}>{t('home.streak.lastWeeks', { n: WEEKS })}</div>
      <div className="gt-scroll-x" style={{ paddingBottom: 4 }}>
        <div style={{ minWidth: 260 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {monthLabels.map((m, i) => <div key={i} className="gt-micro" style={{ width: 12, flexShrink: 0, fontSize: 9.5 }}>{m}</div>)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {grid.map((week, c) => (
              <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {week.map((d) => {
                  const on = set.has(d);
                  const future = d > today;
                  return <div key={d} title={d} style={{
                    width: 12, height: 12, borderRadius: 999,
                    background: on ? 'var(--accent)' : 'var(--input-bg)',
                    opacity: future ? 0.35 : 1,
                    outline: d === today ? '1.5px solid var(--border-strong)' : undefined,
                    outlineOffset: 1.5,
                  }} />;
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="gt-micro" style={{ marginTop: 12, lineHeight: 1.5 }}>
        {t('home.streak.note')}
      </div>
    </Sheet>
  );
}

/* ---------- Home ---------- */
export default function HomeScreen({ onNavigate }) {
  const { t, date, dateParts } = useT();
  const shortDate = (iso) => dateParts(iso, { month: 'numeric', day: 'numeric' });
  const store = useStore(useShallow((state) => ({
    period: state.period, variants: state.variants, workouts: state.workouts,
    setsByWorkout: state.setsByWorkout, exercises: state.exercises, prs: state.prs,
    sessionInView: state.sessionInView, currentVariant: state.currentVariant, trainingView: state.trainingView,
    scheduleView: state.scheduleView, variantMap: state.variantMap, cycleDone: state.cycleDone, archiveAndStartNew: state.archiveAndStartNew,
  })));
  const { period, variants, workouts, setsByWorkout, exercises, prs } = store;
  const [streakOpen, setStreakOpen] = useState(false);

  const exMap = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises]);
  const dates = useMemo(() => trainedDates(workouts), [workouts]);
  const streak = useMemo(() => streakInfo(dates), [dates]);

  const configured = !!period?.trainingSchedule;
  const view = configured ? store.trainingView() : null;
  const workout = view ? view.workout : store.sessionInView();
  const pending = store.currentVariant();
  const activeCode = view ? view.variantCode : workout ? workout.variant : pending?.code;
  const variant = view ? view.variant : activeCode ? store.variantMap()[activeCode] : null;
  const cycle = view ? view.cycle : period?.cycle ?? 1;
  const totalVariants = variants.length || 6;
  const doneCount = store.cycleDone(cycle).size;
  // "which session of the cycle is this" — U1 = 1 … L3 = 6. Independent of the ring,
  // which tracks how much of the cycle is already done.
  const sessionNum = variant ? variants.findIndex((v) => v.code === variant.code) + 1 : 0;

  // Deterministic picks among the exercises of today's variant.
  const planIds = variant ? variant.exerciseIds : [];
  const seed = isoDate() + '|' + (variant?.code || '-') + '|c' + cycle;
  const histories = useMemo(() => {
    const m = {};
    for (const id of planIds) m[id] = exerciseHistory(workouts, setsByWorkout, id, 8);
    return m;
  }, [planIds.join(','), workouts, setsByWorkout]); // eslint-disable-line react-hooks/exhaustive-deps

  const prPool = planIds.filter((id) => prs[id]);
  const prId = pickDaily(prPool.length ? prPool : Object.keys(prs), seed + '|pr');
  const pr = prId ? prs[prId] : null;

  // two widgets on the same exercise reads like a bug — each picks around the other's pick
  const otherThanPr = (ids) => (ids.filter((id) => id !== prId).length ? ids.filter((id) => id !== prId) : ids);
  const chartPool = planIds.filter((id) => (histories[id] || []).length >= 2);
  const chartId = pickDaily(otherThanPr(chartPool), seed + '|chart');
  const chartData = chartId ? histories[chartId] : [];
  // nothing charted yet: still name the exercise the widget is waiting on
  const chartPlaceholder = !chartId ? pickDaily(otherThanPr(planIds), seed + '|chart') : null;

  if (!period) {
    return (
      <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
        <div className="gt-card" style={{ marginTop: 40 }}>
          <EmptyState icon="calendar" title={t('common.noMesocycle')} body={t('home.noMesoBody')} cta={t('common.start')} onCta={() => store.archiveAndStartNew()} />
        </div>
      </div>
    );
  }

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      {/* Header: title + settings / streak */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="gt-h1" style={{ fontSize: 30 }}>{t('home.title')}</h1>
          <div className="gt-sub" style={{ marginTop: 2 }}>{dateParts(isoDate(), { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="gt-iconbtn" aria-label={t('home.openSettings')} onClick={() => onNavigate('settings')}>
            <GIcon name="gear" size={19} />
          </button>
          <button className="gt-iconbtn" aria-label={t('home.openStreak')} onClick={() => setStreakOpen(true)}
            style={{ position: 'relative', color: streak.current > 0 ? 'var(--accent)' : 'var(--text)' }}>
            <GIcon name="flame" size={19} />
            {streak.current > 0 && (
              <span className="gt-num" style={{ position: 'absolute', top: -3, right: -3, minWidth: 19, height: 19, padding: '0 4px', borderRadius: 999, background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 11, lineHeight: '19px', textAlign: 'center' }}>{streak.current}</span>
            )}
          </button>
        </div>
      </div>

      {/* Row 1 — today's session · record of the day */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Widget ariaLabel={t('home.openToday')} onClick={() => onNavigate('today')} style={{ minHeight: 168 }}>
          <RingProgress value={doneCount} max={totalVariants}>
            <span className="gt-num" style={{ fontSize: 26, lineHeight: 1 }}>{sessionNum || '—'}</span>
          </RingProgress>
          <div style={{ minWidth: 0 }}>
            <div className="gt-h2" style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workout?.block || variant?.name || (view?.isRest ? t('home.restDay') : t('home.noRoutine'))}</div>
            <div className="gt-micro" style={{ marginTop: 2 }}>{view?.isManual ? t('home.previewCycle', { cycle }) : variant ? t('home.cycleProgress', { cycle, done: doneCount, total: totalVariants }) : t('home.restDay')}</div>
          </div>
        </Widget>

        {/* the PR opens that exercise's own chart in Metrics — Records is a step further away */}
        <Widget ariaLabel={pr ? t('home.openExerciseMetrics') : t('home.openRecords')} icon={pr ? 'chart' : 'chevR'}
          onClick={() => (pr ? onNavigate('metrics', prId) : onNavigate('records'))} style={{ minHeight: 168 }}>
          {pr ? (<>
            <div style={{ paddingTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                <span className="gt-num" style={{ fontSize: 34, lineHeight: 1.05 }}>{pr.value}</span>
                <span className="gt-sub" style={{ fontSize: 13 }}>{unitLabel(pr.unit, pr.value, t)}</span>
              </div>
              <div className="gt-micro" style={{ marginTop: 4 }}>{t('home.reps', { reps: pr.reps })}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="gt-h2" style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exMap[prId]?.name || prId}</div>
              <div className="gt-micro" style={{ marginTop: 2 }}>{t('home.prLine', { date: date(pr.date) })}</div>
            </div>
          </>) : (<>
            <div className="gt-num" style={{ fontSize: 34, color: 'var(--text-3)', paddingTop: 6 }}>—</div>
            <div>
              <div className="gt-h2" style={{ fontSize: 15 }}>{t('home.noRecords')}</div>
              <div className="gt-micro" style={{ marginTop: 2 }}>{t('home.firstPr')}</div>
            </div>
          </>)}
        </Widget>
      </div>

      {/* Row 2 — progress chart of another exercise from today's session */}
      <Widget ariaLabel={t('home.openMetrics')} onClick={() => onNavigate('metrics')} icon="chart" style={{ marginTop: 12, minHeight: 236, gap: 4 }}>
        <div style={{ paddingRight: 26 }}>
          <div className="gt-label" style={{ color: 'var(--accent)' }}>{t('home.progress')}</div>
          <div className="gt-h2" style={{ fontSize: 16, marginTop: 4 }}>{exMap[chartId || chartPlaceholder]?.name || t('home.nothingTracked')}</div>
          <div className="gt-micro" style={{ marginTop: 2 }}>
            {chartData.length ? t('home.topSet', { n: chartData.length }) : t('home.logTwice')}
          </div>
        </div>
        {chartData.length >= 2 ? (
          <div style={{ width: '100%', marginTop: 6 }}>
            <LineChart data={chartData} height={132} valueKey="kg" labelKey="date" fmtLabel={shortDate} fmtVal={(v) => v + ' kg'} />
          </div>
        ) : (
          <div style={{ width: '100%', height: 132, borderRadius: 16, background: 'var(--input-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
            <GIcon name="chart" size={26} />
          </div>
        )}
      </Widget>

      <StreakSheet open={streakOpen} onClose={() => setStreakOpen(false)} dates={dates} />
    </div>
  );
}
