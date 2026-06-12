// GymTrack — Metrics dashboard (all figures derived from realKg).
import React, { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import * as M from '../metrics.js';
import { weekOfPeriod, dayKeyOf, DAY_KEYS } from '../calc.js';
import { GIcon, ProgressBar, Stepper, Sheet, BarChart, LineChart, Donut, DONUT_COLORS, SectionHead, EmptyState } from '../components.jsx';
import BodyMap from '../bodymap.jsx';

function MetricCard({ children, style }) {
  return <div className="gt-card" style={{ padding: '16px', marginBottom: 12, ...style }}>{children}</div>;
}

export default function MetricsScreen() {
  const store = useStore();
  const { period, workouts, setsByWorkout, exercises, bodyweight, templates } = store;
  const exMap = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises]);

  const [volMode, setVolMode] = useState('tonnage');
  const [exSel, setExSel] = useState('');
  const [showBwSheet, setShowBwSheet] = useState(false);
  const [bwDraft, setBwDraft] = useState(store.profile?.bodyweightKg || 70);

  const week = period ? Math.min(weekOfPeriod(period.startDate), period.weeks) : 0;
  const logs = useMemo(
    () => (period ? M.buildLogs(workouts, setsByWorkout, period.id, exMap) : {}),
    [workouts, setsByWorkout, period, exMap]
  );

  const totalWorkouts = M.workoutsDone(logs);
  const trainingDaysPerWeek = DAY_KEYS.filter((d) => templates[d]?.exerciseIds?.length).length || 5;
  const plannedTotal = (period?.weeks || 12) * trainingDaysPerWeek;
  const hasData = totalWorkouts > 0;

  const weeklyVol = useMemo(() => {
    const out = [];
    for (let w = 1; w <= week; w++) {
      const v = volMode === 'tonnage' ? M.weekVolume(logs, w) : M.weekAvgLoad(logs, w);
      if (v > 0) out.push({ label: 'W' + w, value: v });
    }
    return out;
  }, [logs, volMode, week]);

  const dayVol = useMemo(() => DAY_KEYS.map((d) => ({ label: d, value: M.dayVolume((logs[week] || {})[d]) })), [logs, week]);
  const muscles = useMemo(() => M.muscleAverages(logs, week, exMap), [logs, week, exMap]);
  const split = useMemo(() => M.muscleVolumeSplit(logs, exMap), [logs, exMap]);
  const cumTonnage = useMemo(() => { let t = 0; for (let w = 1; w <= week; w++) t += M.weekVolume(logs, w); return t; }, [logs, week]);

  // average medal level per muscle group, for the body map
  const prs = store.prs;
  const medalByMuscle = useMemo(() => {
    const agg = {};
    for (const e of exercises) {
      if (e.active === false) continue;
      const l = store.medalLevel(e.id);
      if (l < 0) continue;
      (agg[e.muscle] = agg[e.muscle] || []).push(l);
    }
    const out = {};
    for (const [m, ls] of Object.entries(agg)) out[m] = ls.reduce((a, b) => a + b, 0) / ls.length;
    return out;
  }, [exercises, prs]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasMedals = Object.keys(medalByMuscle).length > 0;

  const exsWithData = exercises.filter((e) => M.bestSet(logs, e.id));
  const sel = exSel && exsWithData.some((e) => e.id === exSel) ? exSel : (exsWithData[0]?.id || '');
  const series = useMemo(() => (sel ? M.exerciseSeries(logs, sel) : []), [logs, sel]);
  const rmSeries = useMemo(() => (sel ? M.oneRmSeries(logs, sel) : []), [logs, sel]);

  // adherence: finished workouts vs programmed days elapsed so far
  const todayIdx = DAY_KEYS.indexOf(dayKeyOf());
  const programmedSoFar = Math.max(1, (week - 1) * trainingDaysPerWeek + (todayIdx >= 0 ? todayIdx + 1 : trainingDaysPerWeek));
  const adherence = Math.min(100, Math.round((totalWorkouts / programmedSoFar) * 100));

  const bwSeries = bodyweight.map((b) => ({ label: b.date.slice(5).replace('-', '/'), kg: b.kg }));

  // medals live across periods — only fully empty when there's no data AND no medals
  if (!hasData && !hasMedals) {
    return (
      <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
        <div className="gt-h1" style={{ marginBottom: 4 }}>Metrics</div>
        <div className="gt-sub">Your training dashboard</div>
        <div className="gt-card" style={{ marginTop: 18 }}>
          <EmptyState icon="chart" title="No data yet" body="Finish your first workout and your volume, muscle and progress charts will light up here." />
        </div>
      </div>
    );
  }

  if (!hasData) {
    // no workouts in the active period yet, but there IS history (e.g. imported / archived)
    return (
      <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
        <div className="gt-h1" style={{ marginBottom: 4 }}>Metrics</div>
        <div className="gt-sub">Week {week} of {period.weeks}</div>
        <SectionHead>Muscle medal map</SectionHead>
        <MetricCard>
          <BodyMap levels={medalByMuscle} />
          <div className="gt-micro" style={{ marginTop: 12, textAlign: 'center' }}>Each muscle takes the average medal of its exercises</div>
        </MetricCard>
        <div className="gt-card" style={{ padding: 16, marginTop: 4 }}>
          <div className="gt-sub" style={{ lineHeight: 1.5 }}>No workouts in this period yet — volume and progress charts light up as you train. Your full history lives in the History tab; records and medals in Records.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <div className="gt-h1" style={{ marginBottom: 4 }}>Metrics</div>
      <div className="gt-sub">Week {week} of {period.weeks} · live</div>

      {/* Workouts + adherence row */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <MetricCard style={{ flex: 1.4, marginBottom: 0 }}>
          <div className="gt-label">Workouts</div>
          <div className="gt-display" style={{ marginTop: 8 }}>{totalWorkouts}<span style={{ fontSize: 17, color: 'var(--text-3)', fontWeight: 500 }}> / {plannedTotal}</span></div>
          <div style={{ marginTop: 12 }}><ProgressBar value={totalWorkouts} max={plannedTotal} /></div>
          <div className="gt-micro" style={{ marginTop: 7 }}>{Math.max(0, period.weeks - week)} weeks left in period</div>
        </MetricCard>
        <MetricCard style={{ flex: 1, marginBottom: 0 }}>
          <div className="gt-label">Adherence</div>
          <div className="gt-display" style={{ marginTop: 8, color: adherence >= 90 ? 'var(--success)' : 'var(--text)' }}>{adherence}<span style={{ fontSize: 17, fontWeight: 500 }}>%</span></div>
          <div className="gt-micro" style={{ marginTop: 12 }}>{totalWorkouts} of {programmedSoFar} programmed days</div>
        </MetricCard>
      </div>

      <SectionHead>Weekly volume</SectionHead>
      <MetricCard>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button className={'gt-chip' + (volMode === 'tonnage' ? ' on' : '')} onClick={() => setVolMode('tonnage')}>Total tonnage</button>
          <button className={'gt-chip' + (volMode === 'avg' ? ' on' : '')} onClick={() => setVolMode('avg')}>Avg kg × avg reps</button>
        </div>
        <BarChart data={weeklyVol} accentIndex={weeklyVol.length - 1} fmtVal={(v) => (volMode === 'tonnage' ? Math.round(v / 100) / 10 + 'k' : v)} />
        <div className="gt-micro" style={{ marginTop: 8 }}>{volMode === 'tonnage' ? 'Total real kg lifted per week (reps × realKg)' : 'Average real kg × average reps per set, per week'}</div>
      </MetricCard>

      <SectionHead>This week by day</SectionHead>
      <MetricCard>
        <BarChart data={dayVol} accentIndex={todayIdx} height={110} />
      </MetricCard>

      <SectionHead>Muscle averages · this week</SectionHead>
      <MetricCard style={{ padding: '8px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 1fr 0.9fr', gap: 4, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          {['MUSCLE', 'SETS', 'AVG KG', 'AVG REPS'].map((h) => <div key={h} className="gt-micro">{h}</div>)}
        </div>
        {muscles.map((m) => (
          <div key={m.muscle} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 1fr 0.9fr', gap: 4, padding: '9px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <div className="gt-body" style={{ fontWeight: 700, fontSize: 13.5 }}>{m.muscle}</div>
            <div className="gt-num" style={{ fontSize: 15 }}>{m.sets}</div>
            <div className="gt-num" style={{ fontSize: 15 }}>{m.avgKg}</div>
            <div className="gt-num" style={{ fontSize: 15 }}>{m.avgReps}</div>
          </div>
        ))}
      </MetricCard>

      <SectionHead>Muscle medal map</SectionHead>
      <MetricCard>
        <BodyMap levels={medalByMuscle} />
        <div className="gt-micro" style={{ marginTop: 12, textAlign: 'center' }}>Each muscle takes the average medal of its exercises</div>
      </MetricCard>

      {sel && (
        <>
          <SectionHead>Exercise progress</SectionHead>
          <MetricCard>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <select className="gt-input" style={{ appearance: 'none', WebkitAppearance: 'none', paddingRight: 38 }} value={sel} onChange={(e) => setExSel(e.target.value)}>
                {exsWithData.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <div style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-2)', pointerEvents: 'none' }}><GIcon name="chevD" size={16} /></div>
            </div>
            <LineChart data={series} fmtVal={(v) => v + ' kg'} />
            <div className="gt-micro" style={{ marginTop: 6 }}>Best working weight per week (real kg)</div>
            <div className="gt-divider" style={{ margin: '14px 0' }} />
            <div className="gt-label" style={{ marginBottom: 8 }}>Est. 1RM trend (Epley)</div>
            <LineChart data={rmSeries} height={92} fmtVal={(v) => v + ' kg'} />
          </MetricCard>
        </>
      )}

      <SectionHead>Volume split · period</SectionHead>
      <MetricCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Donut data={split.slice(0, 6)} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {split.slice(0, 6).map((s, i) => (
              <div key={s.muscle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 9, height: 9, borderRadius: 3, background: DONUT_COLORS[i], flexShrink: 0 }} />
                <div className="gt-sub" style={{ flex: 1, fontSize: 12 }}>{s.muscle}</div>
                <div className="gt-num" style={{ fontSize: 13 }}>{(s.kg / 1000).toFixed(1)}t</div>
              </div>
            ))}
          </div>
        </div>
        <div className="gt-divider" style={{ margin: '14px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="gt-label">Cumulative tonnage</div>
          <div className="gt-num" style={{ fontSize: 24 }}>{(cumTonnage / 1000).toFixed(1)} t</div>
        </div>
      </MetricCard>

      <SectionHead right={<button className="gt-chip" onClick={() => { setBwDraft(store.profile?.bodyweightKg || 70); setShowBwSheet(true); }}>+ Log</button>}>Body weight</SectionHead>
      <MetricCard>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <div className="gt-display" style={{ fontSize: 32 }}>{bodyweight.length ? bodyweight[bodyweight.length - 1].kg : '—'}<span style={{ fontSize: 15, color: 'var(--text-3)', fontWeight: 500 }}> kg</span></div>
          {bodyweight.length > 1 ? (() => {
            const diff = bodyweight[bodyweight.length - 1].kg - bodyweight[0].kg;
            return <div className="gt-sub" style={{ color: diff >= 0 ? 'var(--success)' : 'var(--accent)' }}>{(diff >= 0 ? '+' : '') + diff.toFixed(1)} kg logged</div>;
          })() : null}
        </div>
        {bodyweight.length > 1
          ? <LineChart data={bwSeries} height={92} valueKey="kg" labelKey="label" fmtLabel={(l) => l} fmtVal={(v) => v} />
          : <div className="gt-sub">Log your weight weekly to see the trend.</div>}
      </MetricCard>

      <Sheet open={showBwSheet} onClose={() => setShowBwSheet(false)} title="Log body weight">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
          <Stepper value={bwDraft} step={0.1} width={200} onChange={setBwDraft} format={(v) => v.toFixed(1) + ' kg'} />
        </div>
        <button className="gt-btn gt-btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={async () => {
          await store.addBodyweight(+bwDraft.toFixed(1));
          setShowBwSheet(false);
        }}>Save</button>
      </Sheet>
    </div>
  );
}
