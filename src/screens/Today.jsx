// GymTrack — Today: rotation-driven session plan, quick set logging, back-off tags, finish celebration.
import React, { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { buildLogs, dayVolume, lastSetsGlobal } from '../metrics.js';
import { fmtWeight, suggestOverload, splitUnit, isoDate } from '../calc.js';
import { GIcon, Stepper, UnitChips, Sheet, Confetti, EmptyState } from '../components.jsx';

const haptic = () => { try { navigator.vibrate && navigator.vibrate(12); } catch { /* unsupported */ } };

/* Effective back-off state of a set: auto = realKg dropped below the exercise's first set,
 * unless the user has pinned it with backoffForce. */
function isBackoff(set, index, firstKg) {
  const auto = index > 0 && set.realKg < firstKg;
  return set.backoffForce == null ? auto : set.backoffForce;
}

/* ---------- One logged set row ---------- */
function LoggedSetRow({ set, index, firstKg, onEdit, onDelete, onToggleBackoff, editing }) {
  const backoff = isBackoff(set, index, firstKg);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px' }}>
      <div style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--success-soft)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <GIcon name="check" size={14} stroke={2.4} />
      </div>
      <div className="gt-num" style={{ fontSize: 17, flex: 1 }}>
        {fmtWeight(set.value, set.unit)} <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>× {set.reps}</span>
      </div>
      {index > 0 && (
        <button
          onClick={onToggleBackoff}
          aria-label="toggle back-off"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, height: 24, padding: '0 9px', borderRadius: 999,
            whiteSpace: 'nowrap', fontFamily: 'Manrope, sans-serif', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
            background: backoff ? 'color-mix(in srgb, var(--warning) 18%, transparent)' : 'transparent',
            color: backoff ? 'var(--warning)' : 'var(--text-3)',
            border: '1px solid ' + (backoff ? 'color-mix(in srgb, var(--warning) 45%, transparent)' : 'var(--border)'),
            opacity: backoff ? 1 : 0.7,
          }}>
          <GIcon name="chevD" size={11} stroke={2.4} />back-off
        </button>
      )}
      <button className="gt-iconbtn" style={{ width: 36, height: 36, minWidth: 36, background: editing ? 'var(--accent-soft)' : 'var(--surface-2)', color: editing ? 'var(--accent)' : 'var(--text-2)' }} onClick={onEdit} aria-label="edit set">
        <GIcon name="edit" size={15} />
      </button>
      <button className="gt-iconbtn" style={{ width: 36, height: 36, minWidth: 36, color: 'var(--text-2)' }} onClick={onDelete} aria-label="delete set">
        <GIcon name="trash" size={15} />
      </button>
    </div>
  );
}

/* ---------- Input row: weight + reps steppers, unit chips, log button ---------- */
function LogRow({ draft, setDraft, onLog, editing }) {
  const step = splitUnit(draft.unit).base === 'plates' ? 0.25 : 2.5;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div className="gt-micro" style={{ margin: '0 0 5px 4px' }}>WEIGHT</div>
          <Stepper value={draft.value} step={step} width={'100%'} onChange={(v) => setDraft({ ...draft, value: v })} format={(v) => v} />
        </div>
        <div style={{ width: 118 }}>
          <div className="gt-micro" style={{ margin: '0 0 5px 4px' }}>REPS</div>
          <Stepper value={draft.reps} step={1} min={1} width={'100%'} onChange={(v) => setDraft({ ...draft, reps: v })} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <UnitChips value={draft.unit} onChange={(u) => setDraft({ ...draft, unit: u })} />
        <button className="gt-btn gt-btn-primary" style={{ minHeight: 44, padding: '0 18px', fontSize: 14 }} onClick={onLog}>
          <GIcon name={editing ? 'check' : 'plus'} size={17} stroke={2.4} />
          {editing ? 'Save' : 'Log set'}
        </button>
      </div>
    </div>
  );
}

/* ---------- Exercise card ---------- */
function ExerciseCard({ exercise, sets, last, onLogSet, onEditSet, onDeleteSet, onToggleBackoff, onSwap, justLogged }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const editingSet = editingId != null ? sets.find((s) => s.id === editingId) : null;
  const topLast = last ? last.sets.reduce((a, b) => (b.realKg > a.realKg ? b : a), last.sets[0]) : null;
  const sugg = suggestOverload(topLast);
  const firstKg = sets.length ? sets[0].realKg : 0;

  const defaultDraft = () => {
    if (editingSet) return { value: editingSet.value, reps: editingSet.reps, unit: editingSet.unit };
    if (sets.length) { const s = sets[sets.length - 1]; return { value: s.value, reps: s.reps, unit: s.unit }; }
    if (topLast) return { value: topLast.value, reps: topLast.reps, unit: topLast.unit };
    return { value: exercise.unit === 'plates' ? 1 : 20, reps: 10, unit: exercise.unit || 'kg' };
  };
  const [draft, setDraft] = useState(defaultDraft);
  // re-prime the inputs when opening or switching the set being edited
  const [primeKey, setPrimeKey] = useState(null);
  const key = open + ':' + editingId + ':' + sets.length;
  if (key !== primeKey) { setPrimeKey(key); setDraft(defaultDraft()); }

  return (
    <div className="gt-card" style={{ padding: '17px 16px', marginBottom: 12, animation: justLogged ? 'gt-check-pulse 0.6s ease' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="gt-h2" style={{ fontSize: 16 }}>{exercise.name}</div>
          <div className="gt-micro" style={{ marginTop: 2 }}>{exercise.muscle}{sets.length ? ' · ' + sets.length + (sets.length === 1 ? ' set' : ' sets') : ''}</div>
        </div>
        <button className="gt-iconbtn" style={{ width: 38, height: 38, minWidth: 38, color: 'var(--text-2)' }} onClick={onSwap} aria-label="swap exercise"><GIcon name="swap" size={17} /></button>
      </div>

      {last ? (
        <div className="gt-sub" style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-3)' }}>Last session:</span>
          <span className="gt-num" style={{ fontSize: 13.5, color: 'var(--text-2)', fontWeight: 500 }}>
            {fmtWeight(last.sets[0].value, last.sets[0].unit)} × {last.sets.map((s) => s.reps).join(', ')}
          </span>
        </div>
      ) : (
        <div className="gt-sub" style={{ marginTop: 9, color: 'var(--text-3)' }}>First time — set your baseline</div>
      )}

      {sets.length > 0 && (
        <div style={{ marginTop: 7 }}>
          {sets.map((s, i) => (
            <LoggedSetRow key={s.id} set={s} index={i} firstKg={firstKg} editing={editingId === s.id}
              onToggleBackoff={() => onToggleBackoff(s)}
              onEdit={() => { setEditingId(editingId === s.id ? null : s.id); setOpen(true); }}
              onDelete={() => { onDeleteSet(s); if (editingId === s.id) setEditingId(null); }} />
          ))}
        </div>
      )}

      {open ? (
        <>
          <LogRow draft={draft} setDraft={setDraft} editing={editingId != null} onLog={() => {
            if (editingId != null) { onEditSet(editingSet, draft); setEditingId(null); }
            else onLogSet(draft);
          }} />
          {sugg ? <div className="gt-micro" style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-3)' }}><GIcon name="target" size={13} />{sugg}</div> : null}
        </>
      ) : (
        <button className="gt-btn gt-btn-ghost" style={{ width: '100%', marginTop: 11, minHeight: 46, fontSize: 14 }} onClick={() => setOpen(true)}>
          <GIcon name="plus" size={17} stroke={2.4} />{sets.length ? 'Add set' : 'Log first set'}
        </button>
      )}
    </div>
  );
}

/* ---------- Finish celebration overlay ---------- */
function FinishOverlay({ summary, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--bg)', display: 'flex', flexDirection: 'column', animation: 'gt-fade 0.25s ease', overflow: 'hidden' }}>
      <Confetti run={true} />
      <div className="gt-scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 28px 120px', position: 'relative', zIndex: 6 }}>
        <div style={{ width: 86, height: 86, borderRadius: 999, background: 'var(--success-soft)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'gt-pop 0.55s cubic-bezier(.2,1.4,.4,1)' }}>
          <GIcon name="check" size={42} stroke={2.6} />
        </div>
        <div className="gt-display" style={{ marginTop: 22, fontSize: 34 }}>WORKOUT CRUSHED</div>
        <div className="gt-sub" style={{ marginTop: 8, maxWidth: 240, lineHeight: 1.5 }}>That's {summary.workoutNum} workouts this mesocycle. Keep stacking wins.</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 28, width: '100%', maxWidth: 320 }}>
          {[['Sets', summary.sets], ['Volume', (summary.volume / 1000).toFixed(1) + 't'], ['New PRs', summary.prs.length]].map(([l, v]) => (
            <div key={l} className="gt-card" style={{ flex: 1, padding: '14px 8px' }}>
              <div className="gt-num" style={{ fontSize: 26, color: l === 'New PRs' && summary.prs.length ? 'var(--accent)' : 'var(--text)' }}>{v}</div>
              <div className="gt-micro" style={{ marginTop: 3 }}>{l.toUpperCase()}</div>
            </div>
          ))}
        </div>
        {summary.prs.length > 0 && (
          <div className="gt-card" style={{ marginTop: 12, width: '100%', maxWidth: 320, padding: '14px 16px', textAlign: 'left' }}>
            <div className="gt-label" style={{ color: 'var(--accent)', marginBottom: 8 }}>Personal records</div>
            {summary.prs.map((pr) => (
              <div key={pr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                <div className="gt-body" style={{ fontWeight: 700 }}>{pr.name}</div>
                <div className="gt-num" style={{ fontSize: 16 }}>{fmtWeight(pr.set.value, pr.set.unit)} × {pr.set.reps}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', left: 20, right: 20, bottom: 28, zIndex: 7 }}>
        <button className="gt-btn gt-btn-primary" style={{ width: '100%', minHeight: 54, fontSize: 16 }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/* ---------- Today screen ---------- */
export default function TodayScreen() {
  const store = useStore();
  const { period, variants, workouts, setsByWorkout, exercises } = store;
  const exMap = useMemo(() => Object.fromEntries(exercises.map((e) => [e.id, e])), [exercises]);

  const [swapIdx, setSwapIdx] = useState(null);
  const [swapQuery, setSwapQuery] = useState('');
  const [variantSheet, setVariantSheet] = useState(false);
  const [celebrate, setCelebrate] = useState(null);
  const [justLogged, setJustLogged] = useState(null);

  const workout = store.todayWorkout();
  const pending = store.currentVariant();
  const activeCode = workout ? workout.variant : pending?.code;
  const variantMap = store.variantMap();
  const variant = activeCode ? variantMap[activeCode] : null;
  const cycle = period?.cycle ?? 1;
  const cycleGoal = period?.cycleGoal || 6;

  const doneSet = store.cycleDone();
  const doneCount = doneSet.size;

  const entries = workout ? workout.entries : (variant ? variant.exerciseIds.map((exerciseId) => ({ exerciseId })) : []);
  const todaySets = workout ? (setsByWorkout[workout.id] || []) : [];
  const logs = useMemo(
    () => (period ? buildLogs(workouts, setsByWorkout, period.id, exMap) : {}),
    [workouts, setsByWorkout, period, exMap]
  );
  const totalSets = todaySets.length;
  const finished = !!workout?.finished;
  const overGoal = period && cycle > cycleGoal;

  const ensureWorkout = async () => workout || (await store.createWorkout(activeCode));

  const logSet = async (i, draft) => {
    const w = await ensureWorkout();
    if (!w) return;
    await store.logSet(w.id, entries[i].exerciseId, draft);
    haptic();
    setJustLogged(i);
    setTimeout(() => setJustLogged(null), 650);
  };

  const finish = async () => {
    const summary = await store.finishWorkout(workout.id);
    if (summary) { setCelebrate(summary); haptic(); }
  };

  if (!period) {
    return (
      <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
        <div className="gt-card" style={{ marginTop: 40 }}>
          <EmptyState icon="calendar" title="No active mesocycle" body="Start a mesocycle to begin logging your sessions." cta="Start" onCta={() => store.archiveAndStartNew()} />
        </div>
      </div>
    );
  }

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="gt-label" style={{ color: 'var(--accent)' }}>Cycle {cycle}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 5 }}>
            <div className="gt-num" style={{ fontSize: 34, lineHeight: 1 }}>{variant?.code || '—'}</div>
            <button onClick={() => setVariantSheet(true)} aria-label="change variant" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 11px', borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--border-strong)', color: 'var(--text-2)', fontFamily: 'Manrope, sans-serif', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              Change<GIcon name="swap" size={13} stroke={1.9} />
            </button>
          </div>
          <div className="gt-sub" style={{ marginTop: 5 }}>{variant?.name || 'No routine'}{entries.length ? ' · ' + entries.length + ' exercises' : ''}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingTop: 2 }}>
          <div className="gt-num" style={{ fontSize: 24 }}>{totalSets}</div>
          <div className="gt-micro">SETS</div>
        </div>
      </div>

      {/* Cycle progress: variants completed x/6 */}
      <div style={{ margin: '18px 0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div className="gt-label" style={{ color: 'var(--text-2)' }}>Cycle progress</div>
          <div className="gt-num" style={{ fontSize: 14, color: 'var(--text-2)' }}>{doneCount}<span style={{ color: 'var(--text-3)' }}> / {variants.length || 6} done</span></div>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {variants.map((v) => {
            const done = doneSet.has(v.code);
            const isActive = v.code === activeCode && !done;
            return <div key={v.code} title={v.code} style={{ flex: 1, height: 7, borderRadius: 999, background: done ? 'var(--accent)' : 'var(--input-bg)', boxShadow: isActive ? 'inset 0 0 0 1.5px var(--accent)' : undefined }} />;
          })}
        </div>
      </div>

      {overGoal && (
        <div className="gt-card" style={{ padding: 16, marginBottom: 12, borderColor: 'var(--warning)' }}>
          <div className="gt-h2" style={{ fontSize: 15 }}>Mesocycle complete 🎉</div>
          <div className="gt-sub" style={{ marginTop: 4, lineHeight: 1.5 }}>You hit your goal of {cycleGoal} cycles. Archive it and start another — history stays available for comparison.</div>
          <button className="gt-btn gt-btn-primary" style={{ width: '100%', marginTop: 12, minHeight: 46 }} onClick={() => store.archiveAndStartNew()}>Archive & start mesocycle</button>
        </div>
      )}

      {finished && (
        <div className="gt-card" style={{ padding: '16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, borderColor: 'var(--success)', background: 'var(--success-soft)' }}>
          <div style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--success)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><GIcon name="check" size={18} stroke={2.6} /></div>
          <div>
            <div className="gt-h2" style={{ fontSize: 15 }}>Workout complete</div>
            <div className="gt-sub">{totalSets} sets · {(dayVolume((logs[workout.cycle ?? cycle] || {})[workout.variant]) / 1000).toFixed(1)} t total. You can still edit sets.</div>
          </div>
        </div>
      )}

      {!variant ? (
        <div className="gt-card" style={{ marginTop: 8 }}>
          <EmptyState icon="calendar" title="No variant" body="Pick a variant from the rotation to start logging." cta="Pick a variant" onCta={() => setVariantSheet(true)} />
        </div>
      ) : (
        entries.map((en, i) => {
          const exercise = exMap[en.exerciseId] || { id: en.exerciseId, name: en.exerciseId, muscle: '—', unit: 'kg' };
          const sets = todaySets.filter((s) => s.exerciseId === en.exerciseId).sort((a, b) => a.n - b.n);
          const last = lastSetsGlobal(workouts, setsByWorkout, en.exerciseId, isoDate());
          return (
            <ExerciseCard key={en.exerciseId + i} exercise={exercise} sets={sets} last={last} justLogged={justLogged === i}
              onLogSet={(d) => logSet(i, d)}
              onEditSet={(s, d) => store.editSet(s.id, s.workoutId, d)}
              onDeleteSet={(s) => store.deleteSet(s.id, s.workoutId)}
              onToggleBackoff={(s) => store.toggleBackoff(s.id, s.workoutId)}
              onSwap={() => { setSwapIdx(i); setSwapQuery(''); }} />
          );
        })
      )}

      {!finished && entries.length > 0 && (
        <button className="gt-btn gt-btn-primary" disabled={totalSets === 0} style={{ width: '100%', minHeight: 56, fontSize: 16, marginTop: 6, opacity: totalSets === 0 ? 0.4 : 1 }} onClick={finish}>
          <GIcon name="flame" size={20} />Finish & advance
        </button>
      )}

      {/* Jump to another variant */}
      <Sheet open={variantSheet} onClose={() => setVariantSheet(false)} title="Jump to another variant">
        <div className="gt-sub" style={{ marginBottom: 14, lineHeight: 1.5 }}>It advances on its own when you finish. Use this if you break the order — sets already logged still count.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {variants.map((v) => {
            const done = doneSet.has(v.code);
            const isActive = v.code === activeCode;
            const status = done ? 'Done' : isActive ? 'In progress' : 'Pending';
            const border = isActive ? 'var(--accent)' : done ? 'color-mix(in srgb, var(--success) 45%, transparent)' : 'var(--border)';
            return (
              <button key={v.code} onClick={async () => { await store.setActiveVariant(v.code); setVariantSheet(false); }}
                style={{ textAlign: 'left', padding: '13px 14px', borderRadius: 16, cursor: 'pointer', background: isActive ? 'var(--accent-soft)' : 'var(--input-bg)', border: '1px solid ' + border, color: 'var(--text)', font: 'inherit' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="gt-num" style={{ fontSize: 20, color: isActive ? 'var(--accent)' : done ? 'var(--success)' : 'var(--text)' }}>{v.code}</div>
                  {(done || isActive) && <div style={{ width: 8, height: 8, borderRadius: 999, background: done ? 'var(--success)' : 'var(--accent)' }} />}
                </div>
                <div className="gt-sub" style={{ marginTop: 3 }}>{v.name}</div>
                <div className="gt-micro" style={{ marginTop: 1 }}>{status}</div>
              </button>
            );
          })}
        </div>
      </Sheet>

      {/* Swap one exercise for this session */}
      <Sheet open={swapIdx != null} onClose={() => setSwapIdx(null)} title="Swap exercise for today">
        <div className="gt-sub" style={{ marginBottom: 12, lineHeight: 1.5 }}>Machine taken or unavailable? Swap it for today only — your routine stays unchanged.</div>
        <input className="gt-input" value={swapQuery} onChange={(e) => setSwapQuery(e.target.value)} placeholder="Search or type a new exercise…" />
        <div style={{ marginTop: 10 }}>
          {exercises.filter((e) => e.active !== false && e.name.toLowerCase().includes(swapQuery.toLowerCase())).slice(0, 12).map((e) => (
            <button key={e.id} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              onClick={async () => {
                const w = await ensureWorkout();
                if (w) await store.swapEntry(w.id, swapIdx, e.id);
                setSwapIdx(null);
              }}>
              <div style={{ flex: 1 }}>
                <div className="gt-body" style={{ fontWeight: 700 }}>{e.name}</div>
                <div className="gt-micro">{e.muscle}</div>
              </div>
              <GIcon name="chevR" size={15} style={{ color: 'var(--text-3)' }} />
            </button>
          ))}
        </div>
        {swapQuery.trim().length > 1 && (
          <button className="gt-btn gt-btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={async () => {
            const created = await store.addExercise({ name: swapQuery.trim(), muscle: 'Other', unit: 'kg' });
            const w = await ensureWorkout();
            if (w) await store.swapEntry(w.id, swapIdx, created.id);
            setSwapIdx(null);
          }}>
            <GIcon name="plus" size={16} />Create “{swapQuery.trim()}”
          </button>
        )}
      </Sheet>

      {celebrate ? <FinishOverlay summary={celebrate} onClose={() => setCelebrate(null)} /> : null}
    </div>
  );
}
