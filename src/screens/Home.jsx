// GymTrack — Home: the at-a-glance dashboard. Three widgets (today's session, a record of
// the day, a progress chart) plus the streak sheet. Everything "random" here is seeded by
// the date + the variant on deck, so a widget stays put all day and rotates tomorrow.
import React, { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { exerciseHistory, pickDaily, streakInfo, trainedDates } from '../metrics.js';
import { fmtDate, isoDate, parseISO, addDays, mondayOf, splitUnit } from '../calc.js';
import { GIcon, RingProgress, LineChart, Sheet, EmptyState } from '../components.jsx';

const shortDate = (iso) => { const d = parseISO(iso); return (d.getMonth() + 1) + '/' + d.getDate(); };

/* Weight split in two so the number can stay big and the unit small (and so a value like
 * "40 kg ×2" never wraps inside a half-width widget). */
function unitLabel(unit, value) {
  const { base, dbl } = splitUnit(unit);
  if (base === 'plates') return value === 1 ? 'plate' : 'plates';
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
    const m = parseISO(week[0]).toLocaleDateString('en-US', { month: 'short' });
    const prev = i > 0 ? parseISO(grid[i - 1][0]).toLocaleDateString('en-US', { month: 'short' }) : null;
    return m === prev ? '' : m;
  });
  const today = isoDate();

  return (
    <Sheet open={open} onClose={onClose} title="Streak">
      <div style={{ display: 'flex', gap: 10 }}>
        {[['Current', info.current, true], ['Best', info.best, false], ['Days', info.total, false]].map(([label, value, hot]) => (
          <div key={label} className="gt-card" style={{ flex: 1, padding: '14px 8px', textAlign: 'center' }}>
            <div className="gt-num" style={{ fontSize: 28, color: hot && value > 0 ? 'var(--accent)' : 'var(--text)' }}>{value}</div>
            <div className="gt-micro" style={{ marginTop: 3 }}>{label.toUpperCase()}</div>
          </div>
        ))}
      </div>
      <div className="gt-sub" style={{ marginTop: 14, lineHeight: 1.5 }}>
        {info.current > 0
          ? (info.trainedToday
            ? `${info.current} ${info.current === 1 ? 'day' : 'days'} in a row — today is already logged.`
            : `${info.current} ${info.current === 1 ? 'day' : 'days'} in a row. Finish a session today to keep it alive.`)
          : (info.lastDate ? `No active streak. Last session: ${fmtDate(info.lastDate)}.` : 'Finish your first session to start a streak.')}
      </div>

      <div className="gt-label" style={{ margin: '20px 0 10px' }}>Last {WEEKS} weeks</div>
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
        A day counts once a session is finished — the auto-finish rule (2+ sets on every exercise) counts too.
      </div>
    </Sheet>
  );
}

/* ---------- Home ---------- */
export default function HomeScreen({ onNavigate }) {
  const store = useStore();
  const { period, variants, workouts, setsByWorkout, exercises, prs } = store;
  const [streakOpen, setStreakOpen] = useState(false);

  const exMap = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises]);
  const dates = useMemo(() => trainedDates(workouts), [workouts]);
  const streak = useMemo(() => streakInfo(dates), [dates]);

  const workout = store.sessionInView();
  const pending = store.currentVariant();
  const activeCode = workout ? workout.variant : pending?.code;
  const variant = activeCode ? store.variantMap()[activeCode] : null;
  const cycle = period?.cycle ?? 1;
  const totalVariants = variants.length || 6;
  const doneCount = store.cycleDone().size;
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
          <EmptyState icon="calendar" title="No active mesocycle" body="Start a mesocycle to see your dashboard." cta="Start" onCta={() => store.archiveAndStartNew()} />
        </div>
      </div>
    );
  }

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      {/* Header: title + settings / streak */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <div className="gt-h1" style={{ fontSize: 30 }}>Workouts</div>
          <div className="gt-sub" style={{ marginTop: 2 }}>{parseISO(isoDate()).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button className="gt-iconbtn" aria-label="open settings" onClick={() => onNavigate('settings')}>
            <GIcon name="gear" size={19} />
          </button>
          <button className="gt-iconbtn" aria-label="open streak" onClick={() => setStreakOpen(true)}
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
        <Widget ariaLabel="open today" onClick={() => onNavigate('today')} style={{ minHeight: 168 }}>
          <RingProgress value={doneCount} max={totalVariants}>
            <span className="gt-num" style={{ fontSize: 26, lineHeight: 1 }}>{sessionNum || '—'}</span>
          </RingProgress>
          <div style={{ minWidth: 0 }}>
            <div className="gt-h2" style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{variant?.name || 'No routine'}</div>
            <div className="gt-micro" style={{ marginTop: 2 }}>{variant ? 'Cycle ' + cycle + ' · ' + doneCount + '/' + totalVariants : 'Pick a variant'}</div>
          </div>
        </Widget>

        <Widget ariaLabel="open records" onClick={() => onNavigate('records')} style={{ minHeight: 168 }}>
          {pr ? (<>
            <div style={{ paddingTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                <span className="gt-num" style={{ fontSize: 34, lineHeight: 1.05 }}>{pr.value}</span>
                <span className="gt-sub" style={{ fontSize: 13 }}>{unitLabel(pr.unit, pr.value)}</span>
              </div>
              <div className="gt-micro" style={{ marginTop: 4 }}>× {pr.reps} reps</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="gt-h2" style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exMap[prId]?.name || prId}</div>
              <div className="gt-micro" style={{ marginTop: 2 }}>PR · {fmtDate(pr.date)}</div>
            </div>
          </>) : (<>
            <div className="gt-num" style={{ fontSize: 34, color: 'var(--text-3)', paddingTop: 6 }}>—</div>
            <div>
              <div className="gt-h2" style={{ fontSize: 15 }}>No records yet</div>
              <div className="gt-micro" style={{ marginTop: 2 }}>Log a set to open your first PR</div>
            </div>
          </>)}
        </Widget>
      </div>

      {/* Row 2 — progress chart of another exercise from today's session */}
      <Widget ariaLabel="open metrics" onClick={() => onNavigate('metrics')} icon="chart" style={{ marginTop: 12, minHeight: 236, gap: 4 }}>
        <div style={{ paddingRight: 26 }}>
          <div className="gt-label" style={{ color: 'var(--accent)' }}>Progress</div>
          <div className="gt-h2" style={{ fontSize: 16, marginTop: 4 }}>{exMap[chartId || chartPlaceholder]?.name || 'Nothing tracked yet'}</div>
          <div className="gt-micro" style={{ marginTop: 2 }}>
            {chartData.length ? 'Top set per session · last ' + chartData.length : 'Log it twice and the trend shows up here'}
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
