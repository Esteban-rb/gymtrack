// GymTrack — History: browse periods → weeks → days; open any day to view/edit sets.
import React, { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { buildLogs, dayVolume, workoutsDone } from '../metrics.js';
import { fmtWeight, fmtDate, weekOfPeriod, DAY_KEYS } from '../calc.js';
import { GIcon, Sheet, EmptyState } from '../components.jsx';

export default function HistoryScreen() {
  const store = useStore();
  const { period, allPeriods, workouts, setsByWorkout, exercises } = store;
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
  const cw = selPeriod ? (isActive ? Math.min(weekOfPeriod(selPeriod.startDate), selPeriod.weeks) : selPeriod.weeks) : 1;
  const [wk, setWk] = useState(() => (isActive && cw - 1 >= 1 ? cw - 1 : isActive ? cw : 1));
  const [openDay, setOpenDay] = useState(null);

  const weeks = [];
  for (let w = 1; w <= cw; w++) weeks.push(w);
  const wkLogs = logs[wk] || {};
  const entry = openDay ? wkLogs[openDay] : null;
  const hasAny = workoutsDone(logs) > 0 || Object.keys(logs).length > 0;

  const deleteSet = async (s) => { await store.deleteSet(s.id, s.workoutId); };

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <div className="gt-h1" style={{ marginBottom: 4 }}>History</div>
      <div className="gt-sub">{selPeriod ? (isActive ? 'Current period · started ' + fmtDate(selPeriod.startDate) : 'Archived · ' + fmtDate(selPeriod.startDate)) : 'No periods yet'}</div>

      {periodsSorted.length > 1 && (
        <div className="gt-scroll" style={{ display: 'flex', gap: 7, margin: '14px -16px 0', padding: '2px 16px 4px', overflowX: 'auto' }}>
          {periodsSorted.map((p) => (
            <button key={p.id} className={'gt-chip' + (periodId === p.id ? ' on' : '')} style={{ flexShrink: 0 }} onClick={() => { setPeriodId(p.id); setWk(1); }}>
              {p.status === 'active' ? 'Current' : fmtDate(p.startDate)}
            </button>
          ))}
        </div>
      )}

      {!hasAny ? (
        <div className="gt-card" style={{ marginTop: 18 }}>
          <EmptyState icon="clock" title="Nothing here yet" body="Your finished workouts will appear here, week by week." />
        </div>
      ) : (<>
        <div className="gt-scroll" style={{ display: 'flex', gap: 7, margin: '16px -16px 6px', padding: '2px 16px 6px', overflowX: 'auto' }}>
          {weeks.map((w) => (
            <button key={w} className={'gt-chip' + (wk === w ? ' on' : '')} style={{ flexShrink: 0 }} onClick={() => setWk(w)}>
              {isActive && w === cw ? 'This week' : isActive && w === cw - 1 ? 'Last week' : 'Week ' + w}
            </button>
          ))}
        </div>

        {DAY_KEYS.map((d) => {
          const e = wkLogs[d];
          const sets = e ? e.exercises.reduce((a, x) => a + x.sets.length, 0) : 0;
          return (
            <button key={d} className="gt-card" disabled={!e} onClick={() => e && setOpenDay(d)} style={{ width: '100%', padding: '14px 16px', marginBottom: 9, display: 'flex', alignItems: 'center', gap: 13, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: e ? 'pointer' : 'default', opacity: e ? 1 : 0.45, WebkitTapHighlightColor: 'transparent' }}>
              <div className="gt-num" style={{ fontSize: 15, width: 38, color: 'var(--text-2)' }}>{d}</div>
              <div style={{ flex: 1 }}>
                <div className="gt-body" style={{ fontWeight: 800 }}>{e ? e.block : (store.templates[d]?.block || '—')}</div>
                <div className="gt-micro" style={{ marginTop: 2 }}>{e ? sets + ' sets · ' + (dayVolume(e) / 1000).toFixed(1) + ' t' : (isActive && wk === cw ? 'Not yet' : 'Skipped')}</div>
              </div>
              {e && e.finished ? <div style={{ color: 'var(--success)' }}><GIcon name="check" size={18} stroke={2.4} /></div> : null}
              {e ? <div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div> : null}
            </button>
          );
        })}
      </>)}

      <Sheet open={!!entry} onClose={() => setOpenDay(null)} title={entry ? 'Week ' + wk + ' · ' + openDay + ' · ' + entry.block : ''}>
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
