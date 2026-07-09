// GymTrack — Metrics dashboard, grouped by rotation cycle (all figures derived from realKg).
// v2 design: area line charts (straight segments, no bars) + per-muscle progress accordions
// with press-and-hold to blow up any exercise's chart.
import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { MUSCLES } from '../db.js';
import * as M from '../metrics.js';
import { GIcon, ProgressBar, Stepper, Sheet, LineChart, Sparkline, Donut, DONUT_COLORS, SectionHead, EmptyState } from '../components.jsx';
import BodyMap from '../bodymap.jsx';

function MetricCard({ children, style }) {
  return <div className="gt-card" style={{ padding: '16px', marginBottom: 12, ...style }}>{children}</div>;
}

const fmtDelta = (d) => (d >= 0 ? '+' : '') + (Math.round(d * 10) / 10) + ' kg';
const deltaColor = (d) => (d >= 0 ? 'var(--success)' : 'var(--accent)');

/* One exercise row inside a muscle card: sparkline + current + delta.
 * Press and hold anywhere on the row to expand the full chart (release to close). */
function ExerciseTrendRow({ ex }) {
  const [held, setHeld] = useState(false);
  const timer = useRef(null);
  const start = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setHeld(true), 280); };
  const end = () => { clearTimeout(timer.current); setHeld(false); };
  const s = ex.series;
  const cur = s[s.length - 1].kg;
  const d = cur - s[0].kg;
  return (
    <div
      onPointerDown={start} onPointerUp={end} onPointerCancel={end} onPointerLeave={end}
      onContextMenu={(e) => e.preventDefault()}
      style={{ borderTop: '1px solid var(--border)', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: held ? 'none' : 'pan-y' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="gt-body" style={{ fontWeight: 800, fontSize: 13 }}>{ex.name}</div>
          <div className="gt-micro" style={{ marginTop: 1 }}>avg kg per rep</div>
        </div>
        <Sparkline data={s} />
        <div style={{ width: 74, textAlign: 'right', flexShrink: 0 }}>
          <div className="gt-num" style={{ fontSize: 15 }}>{cur} kg</div>
          <div className="gt-micro" style={{ fontWeight: 700, color: deltaColor(d) }}>{fmtDelta(d)}</div>
        </div>
      </div>
      {held && (
        <div style={{ paddingBottom: 10, animation: 'gt-pop 0.25s cubic-bezier(.2,1.2,.4,1)', transformOrigin: '50% 0' }}>
          <LineChart data={s} height={110} labelKey="cycle" fmtLabel={(l) => 'C' + l} fmtVal={(v) => v + ' kg'} />
        </div>
      )}
    </div>
  );
}

/* Accordion card: muscle summary row, expands to trend chart + exercise rows. */
function MuscleCard({ muscle, data, open, onToggle }) {
  const s = data.series;
  const cur = s[s.length - 1].kg;
  const d = cur - s[0].kg;
  const nEx = data.exercises.length;
  return (
    <div className="gt-card" style={{ marginBottom: 10, overflow: 'hidden', borderColor: open ? 'var(--accent)' : undefined }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', minHeight: 54, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', WebkitTapHighlightColor: 'transparent' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="gt-body" style={{ fontWeight: 800, fontSize: 15 }}>{muscle}</div>
          <div className="gt-micro" style={{ marginTop: 1 }}>{nEx}{nEx === 1 ? ' exercise' : ' exercises'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="gt-num" style={{ fontSize: 17 }}>{cur} kg</div>
          <div className="gt-micro" style={{ fontWeight: 700, color: deltaColor(d) }}>{fmtDelta(d)}</div>
        </div>
        <GIcon name="chevD" size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text-2)', flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="gt-chip on" style={{ height: 26, padding: '0 10px', fontSize: 10, cursor: 'default' }}>Avg kg / rep</span>
            <span className="gt-chip" style={{ height: 26, padding: '0 10px', fontSize: 10, cursor: 'default' }}>C{s[0].cycle} – C{s[s.length - 1].cycle}</span>
          </div>
          <div className="gt-num" style={{ fontSize: 34, lineHeight: 1, margin: '8px 0 2px' }}>{fmtDelta(d)}</div>
          <LineChart data={s} height={118} labelKey="cycle" fmtLabel={(l) => 'C' + l} fmtVal={(v) => v + ' kg'} />
          <div style={{ marginTop: 6 }}>
            {data.exercises.map((e) => <ExerciseTrendRow key={e.id} ex={e} />)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MetricsScreen() {
  const store = useStore();
  const { period, variants, workouts, setsByWorkout, exercises, bodyweight } = store;
  const exMap = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises]);

  const [volMode, setVolMode] = useState('tonnage');
  const [openMuscle, setOpenMuscle] = useState('__first');
  const [showBwSheet, setShowBwSheet] = useState(false);
  const [bwDraft, setBwDraft] = useState(store.profile?.bodyweightKg || 70);

  const cycle = period?.cycle ?? 1;
  const cycleGoal = period?.cycleGoal || 6;
  const perCycle = variants.length || 6;
  const logs = useMemo(
    () => (period ? M.buildLogs(workouts, setsByWorkout, period.id, exMap) : {}),
    [workouts, setsByWorkout, period, exMap]
  );

  const totalWorkouts = M.workoutsDone(logs);
  const hasData = totalWorkouts > 0;

  const cycleVol = useMemo(() => {
    const out = [];
    for (let c = 1; c <= cycle; c++) {
      const v = volMode === 'tonnage' ? M.cycleVolume(logs, c) : M.cycleAvgLoad(logs, c);
      if (v > 0) out.push({ cycle: c, value: v });
    }
    return out;
  }, [logs, volMode, cycle]);

  const rotationPos = period?.rotationPos ?? 0;
  const progress = useMemo(() => M.muscleProgress(logs, exMap), [logs, exMap]);
  const muscleList = useMemo(() => {
    const order = [...MUSCLES, ...Object.keys(progress).filter((m) => !MUSCLES.includes(m))];
    return order.filter((m) => progress[m]).map((m) => ({ muscle: m, data: progress[m] }));
  }, [progress]);
  const effOpen = openMuscle === '__first' ? muscleList[0]?.muscle : openMuscle;

  const split = useMemo(() => M.muscleVolumeSplit(logs, exMap), [logs, exMap]);
  const cumTonnage = useMemo(() => { let t = 0; for (let c = 1; c <= cycle; c++) t += M.cycleVolume(logs, c); return t; }, [logs, cycle]);

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

  // adherence: finished sessions vs sessions programmed so far in the rotation
  const programmedSoFar = Math.max(1, (cycle - 1) * perCycle + rotationPos);
  const adherence = Math.min(100, Math.round((totalWorkouts / programmedSoFar) * 100));

  const bwSeries = bodyweight.map((b) => ({ label: b.date.slice(5).replace('-', '/'), kg: b.kg }));

  const fmtTon = (v) => (volMode === 'tonnage' ? (v / 1000).toFixed(1) + ' t' : v);
  const lastVol = cycleVol[cycleVol.length - 1];
  const prevVol = cycleVol.length > 1 ? cycleVol[cycleVol.length - 2] : null;

  // medals live across periods — only fully empty when there's no data AND no medals
  if (!hasData && !hasMedals) {
    return (
      <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
        <div className="gt-h1" style={{ marginBottom: 4 }}>Metrics</div>
        <div className="gt-sub">Your training dashboard</div>
        <div className="gt-card" style={{ marginTop: 18 }}>
          <EmptyState icon="chart" title="No data yet" body="Finish your first session and your volume, muscle and progress charts will light up here." />
        </div>
      </div>
    );
  }

  if (!hasData) {
    // no workouts in the active period yet, but there IS history (e.g. imported / archived)
    return (
      <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
        <div className="gt-h1" style={{ marginBottom: 4 }}>Metrics</div>
        <div className="gt-sub">Cycle {cycle} · by cycle</div>
        <SectionHead>Muscle medal map</SectionHead>
        <MetricCard>
          <BodyMap levels={medalByMuscle} />
          <div className="gt-micro" style={{ marginTop: 12, textAlign: 'center' }}>Each muscle takes the average medal of its exercises</div>
        </MetricCard>
        <div className="gt-card" style={{ padding: 16, marginTop: 4 }}>
          <div className="gt-sub" style={{ lineHeight: 1.5 }}>No sessions in this mesocycle yet — volume and progress charts light up as you train. Your full history lives in Settings → History; records and medals in Records.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <div className="gt-h1" style={{ marginBottom: 4 }}>Metrics</div>
      <div className="gt-sub">Cycle {cycle} in progress · by cycle</div>

      {/* Cycles completed + adherence row */}
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <MetricCard style={{ flex: 1.4, marginBottom: 0 }}>
          <div className="gt-label">Cycles complete</div>
          <div className="gt-display" style={{ marginTop: 8 }}>{Math.max(0, cycle - 1)}<span style={{ fontSize: 17, color: 'var(--text-3)', fontWeight: 500 }}> / {cycleGoal}</span></div>
          <div style={{ marginTop: 12 }}><ProgressBar value={Math.max(0, cycle - 1)} max={cycleGoal} /></div>
          <div className="gt-micro" style={{ marginTop: 7 }}>{Math.max(0, cycleGoal - (cycle - 1))} cycles to your goal</div>
        </MetricCard>
        <MetricCard style={{ flex: 1, marginBottom: 0 }}>
          <div className="gt-label">Adherence</div>
          <div className="gt-display" style={{ marginTop: 8, color: adherence >= 90 ? 'var(--success)' : 'var(--text)' }}>{adherence}<span style={{ fontSize: 17, fontWeight: 500 }}>%</span></div>
          <div className="gt-micro" style={{ marginTop: 12 }}>{totalWorkouts} of {programmedSoFar} sessions</div>
        </MetricCard>
      </div>

      <SectionHead>Tonnage per cycle</SectionHead>
      <MetricCard>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button className={'gt-chip' + (volMode === 'tonnage' ? ' on' : '')} onClick={() => setVolMode('tonnage')}>Tonnage</button>
          <button className={'gt-chip' + (volMode === 'avg' ? ' on' : '')} onClick={() => setVolMode('avg')}>Avg kg × avg reps</button>
        </div>
        {lastVol ? (
          <div className="gt-num" style={{ fontSize: 34, lineHeight: 1, marginBottom: 4 }}>
            {fmtTon(lastVol.value)}
            <span className="gt-sub" style={{ fontSize: 13, fontFamily: 'Manrope, sans-serif', fontWeight: 600, marginLeft: 8 }}>
              {lastVol.cycle === cycle ? 'cycle ' + cycle + ' in progress' : 'cycle ' + lastVol.cycle}
              {prevVol ? ' · C' + prevVol.cycle + ' closed at ' + fmtTon(prevVol.value) : ''}
            </span>
          </div>
        ) : null}
        <LineChart data={cycleVol} height={130} valueKey="value" labelKey="cycle" fmtLabel={(l) => 'C' + l} fmtVal={fmtTon} />
        <div className="gt-micro" style={{ marginTop: 8 }}>{volMode === 'tonnage' ? 'Real kg lifted per cycle · 1 point = one full pass through the 6 variants' : 'Average real kg × average reps per set, per cycle'}</div>
      </MetricCard>

      {muscleList.length > 0 && (
        <>
          <SectionHead>Muscle progress · avg kg per rep</SectionHead>
          {muscleList.map(({ muscle, data }) => (
            <MuscleCard key={muscle} muscle={muscle} data={data} open={effOpen === muscle}
              onToggle={() => setOpenMuscle(effOpen === muscle ? null : muscle)} />
          ))}
        </>
      )}

      <SectionHead>Muscle medal map</SectionHead>
      <MetricCard>
        <BodyMap levels={medalByMuscle} />
        <div className="gt-micro" style={{ marginTop: 12, textAlign: 'center' }}>Each muscle takes the average medal of its exercises</div>
      </MetricCard>

      <SectionHead>Volume split · mesocycle</SectionHead>
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
