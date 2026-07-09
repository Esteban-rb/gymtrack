// GymTrack — History: browse mesocycles → cycles → variants; open any session to view/edit sets.
import React, { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { buildLogs, dayVolume, workoutsDone } from '../metrics.js';
import { fmtWeight, fmtDate } from '../calc.js';
import { GIcon, Sheet, EmptyState } from '../components.jsx';

// Since v2 History lives inside Settings (full-screen sub-page) instead of a bottom tab.
export default function HistoryScreen({ onBack }) {
  const store = useStore();
  const { period, allPeriods, variants, workouts, setsByWorkout, exercises } = store;
  const exMap = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises]);

  const periodsSorted = [...allPeriods].sort((a, b) => b.startDate.localeCompare(a.startDate));
  // default to the active period if it has workouts, else the newest period that does
  const [periodId, setPeriodId] = useState(() => {
    const hasWorkouts = (p) => p && workouts.some((w) => w.periodId === p.id);
    if (hasWorkouts(period)) return period.id;
    return periodsSorted.find(hasWorkouts)?.id ?? period?.id ?? periodsSorted[0]?.id;
  });
  const selPeriod = allPeriods.find((p) => p.id === periodId) || period;

  const logs = useMemo(
    () => (selPeriod ? buildLogs(workouts, setsByWorkout, selPeriod.id, exMap) : {}),
    [workouts, setsByWorkout, selPeriod, exMap]
  );

  const isActive = selPeriod?.status === 'active';
  const cycleKeys = Object.keys(logs).map(Number);
  const maxCycle = cycleKeys.length ? Math.max(...cycleKeys) : 1;
  const cc = selPeriod ? (isActive ? (selPeriod.cycle ?? maxCycle) : maxCycle) : 1;
  const [cy, setCy] = useState(() => (isActive && cc - 1 >= 1 ? cc - 1 : isActive ? cc : 1));
  const [openVar, setOpenVar] = useState(null);

  const cycles = [];
  for (let c = 1; c <= cc; c++) cycles.push(c);
  const cyLogs = logs[cy] || {};
  const entry = openVar ? cyLogs[openVar] : null;
  const hasAny = workoutsDone(logs) > 0 || Object.keys(logs).length > 0;

  // slots to render for the selected cycle: the rotation variants (active period) or
  // whatever keys the cycle actually has (legacy / archived data).
  const slots = isActive && variants.length
    ? variants.map((v) => ({ key: v.code, name: v.name }))
    : Object.keys(cyLogs).map((k) => ({ key: k, name: (cyLogs[k].block || k) }));

  const deleteSet = async (s) => { await store.deleteSet(s.id, s.workoutId); };

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        {onBack ? <button className="gt-iconbtn" style={{ width: 38, height: 38, minWidth: 38 }} onClick={onBack} aria-label="back to settings"><GIcon name="chevL" size={17} /></button> : null}
        <div className="gt-h1">History</div>
      </div>
      <div className="gt-sub">{selPeriod ? (isActive ? 'Current mesocycle · started ' + fmtDate(selPeriod.startDate) : 'Archived · ' + fmtDate(selPeriod.startDate)) : 'No mesocycles yet'}</div>

      {periodsSorted.length > 1 && (
        <div className="gt-scroll" style={{ display: 'flex', gap: 7, margin: '14px -16px 0', padding: '2px 16px 4px', overflowX: 'auto' }}>
          {periodsSorted.map((p) => (
            <button key={p.id} className={'gt-chip' + (periodId === p.id ? ' on' : '')} style={{ flexShrink: 0 }} onClick={() => { setPeriodId(p.id); setCy(1); }}>
              {p.status === 'active' ? 'Current' : fmtDate(p.startDate)}
            </button>
          ))}
        </div>
      )}

      {!hasAny ? (
        <div className="gt-card" style={{ marginTop: 18 }}>
          <EmptyState icon="clock" title="Nothing here yet" body="Your finished sessions will appear here, cycle by cycle." />
        </div>
      ) : (<>
        <div className="gt-scroll" style={{ display: 'flex', gap: 7, margin: '16px -16px 6px', padding: '2px 16px 6px', overflowX: 'auto' }}>
          {cycles.map((c) => (
            <button key={c} className={'gt-chip' + (cy === c ? ' on' : '')} style={{ flexShrink: 0 }} onClick={() => setCy(c)}>
              {isActive && c === cc ? 'This cycle' : isActive && c === cc - 1 ? 'Last cycle' : 'Cycle ' + c}
            </button>
          ))}
        </div>

        {slots.map(({ key, name }) => {
          const e = cyLogs[key];
          const sets = e ? e.exercises.reduce((a, x) => a + x.sets.length, 0) : 0;
          return (
            <button key={key} className="gt-card" disabled={!e} onClick={() => e && setOpenVar(key)} style={{ width: '100%', padding: '14px 16px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 13, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: e ? 'pointer' : 'default', opacity: e ? 1 : 0.45, WebkitTapHighlightColor: 'transparent' }}>
              <div className="gt-num" style={{ fontSize: 15, width: 38, color: 'var(--text-2)' }}>{key}</div>
              <div style={{ flex: 1 }}>
                <div className="gt-body" style={{ fontWeight: 800 }}>{e ? e.block : name}</div>
                <div className="gt-micro" style={{ marginTop: 2 }}>{e ? sets + ' sets · ' + (dayVolume(e) / 1000).toFixed(1) + ' t' : (isActive && cy === cc ? 'Not yet' : 'Skipped')}</div>
              </div>
              {e && e.finished ? <div style={{ color: 'var(--success)' }}><GIcon name="check" size={18} stroke={2.4} /></div> : null}
              {e ? <div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div> : null}
            </button>
          );
        })}
      </>)}

      <Sheet open={!!entry} onClose={() => setOpenVar(null)} title={entry ? 'Cycle ' + cy + ' · ' + openVar + ' · ' + entry.block : ''}>
        {entry && <div className="gt-micro" style={{ marginBottom: 10 }}>{fmtDate(entry.date)} · deleting a set updates all metrics and records</div>}
        {entry && entry.exercises.map((ex, i) => (
          <div key={ex.id + i} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="gt-body" style={{ fontWeight: 800 }}>{ex.name}</div>
              <div className="gt-micro">{(exMap[ex.id] || {}).muscle}</div>
            </div>
            {ex.sets.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="gt-micro" style={{ width: 36 }}>SET {s.n}</div>
                <div className="gt-num" style={{ fontSize: 15, flex: 1 }}>{fmtWeight(s.value, s.unit)} <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>× {s.reps}</span></div>
                <button className="gt-iconbtn" style={{ width: 32, height: 32, minWidth: 32, color: 'var(--text-3)' }} onClick={() => deleteSet(s)} aria-label="delete set"><GIcon name="trash" size={14} /></button>
              </div>
            ))}
          </div>
        ))}
      </Sheet>
    </div>
  );
}
