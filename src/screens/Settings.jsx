// GymTrack — Settings: mesocycle, profile, rotation editor, medal thresholds, units, backup, theme.
import React, { useRef, useState } from 'react';
import { useStore } from '../store.js';
import { MUSCLES } from '../db.js';
import { MEDALS, fmtDate } from '../calc.js';
import { exportJSON, exportXLSX, importJSON, importXLSX } from '../backup.js';
import { GIcon, Stepper, UnitChips, Sheet, SectionHead } from '../components.jsx';
import HistoryScreen from './History.jsx';

// v2 accent palette (from the Claude Design handoff); first entry = default red
const ACCENTS = ['#FF3B30', '#FF6B35', '#FF9F0A', '#FFD60A', '#A8D91C', '#32D74B', '#1F8A5B', '#2AC0C8', '#0A84FF', '#2A6FDB', '#5E5CE6', '#BF5AF2', '#FF2D92', '#FF375F', '#B08968', '#8E8E93'];

function SettingRow({ label, sub, right, onClick, ariaLabel }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} aria-label={ariaLabel} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 2px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: onClick ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent' }}>
      <div style={{ flex: 1 }}>
        <div className="gt-body" style={{ fontWeight: 700 }}>{label}</div>
        {sub ? <div className="gt-micro" style={{ marginTop: 2 }}>{sub}</div> : null}
      </div>
      {right || null}
    </Tag>
  );
}

export default function SettingsScreen() {
  const store = useStore();
  const { profile, period, variants, exercises } = store;
  const [routineVar, setRoutineVar] = useState(variants[0]?.code || 'U1');
  const [nameDraft, setNameDraft] = useState(null); // editing buffer for the variant's name
  const [editingEx, setEditingEx] = useState(null);   // exercise being edited (draft copy)
  const [addSheet, setAddSheet] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [medalSheet, setMedalSheet] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const fileRef = useRef(null);

  const vmap = Object.fromEntries(variants.map((v) => [v.code, v]));
  const variant = vmap[routineVar] || variants[0] || { code: routineVar, name: '—', exerciseIds: [] };
  const exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));

  const moveExercise = async (idx, dir) => {
    const ids = [...variant.exerciseIds];
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await store.saveVariant({ ...variant, exerciseIds: ids });
  };
  const removeExercise = async (idx) => {
    await store.saveVariant({ ...variant, exerciseIds: variant.exerciseIds.filter((_, i) => i !== idx) });
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isExcel = /\.xlsx?$/i.test(file.name);
    try {
      if (isExcel) {
        setImportMsg('Importing ' + file.name + '…');
        const { counts, affected } = await importXLSX(file);
        await store.init();
        // recompute baselines/PRs/medals for everything the file touched, silently
        for (const id of affected) await store.refreshPR(id);
        store.dismissMedal();
        setImportMsg(`Imported ${counts.sets} sets · ${counts.workouts} sessions · ${counts.exercises} new exercises` + (counts.skipped ? ` · ${counts.skipped} duplicates skipped` : '') + ' ✓ — see History & Records');
      } else {
        if (!window.confirm('Importing a JSON backup replaces ALL current data. Continue?')) return;
        setImportMsg('Importing ' + file.name + '…');
        await importJSON(file);
        await store.init();
        setImportMsg('Backup restored ✓');
      }
    } catch (err) {
      setImportMsg('Import failed: ' + err.message); // stays on screen until the next import attempt
    }
  };

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <div className="gt-h1" style={{ marginBottom: 4 }}>Settings</div>
      <div className="gt-sub">Mesocycle, routine & data</div>

      <SectionHead>Mesocycle</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label="Start date" right={<div className="gt-num" style={{ fontSize: 15 }}>{period ? fmtDate(period.startDate) : '—'}</div>} />
        <SettingRow label="Current cycle" right={<div className="gt-num" style={{ fontSize: 15 }}>{period ? (period.cycle ?? 1) : '—'}</div>} />
        <SettingRow label="Cycle goal" sub="1 cycle = one full pass through the 6 variants" right={
          <div style={{ display: 'flex', gap: 5 }}>
            {[4, 6, 8].map((c) => <button key={c} className={'gt-chip' + ((period?.cycleGoal || 6) === c ? ' on' : '')} onClick={() => store.updatePeriod({ cycleGoal: c })}>{c}</button>)}
          </div>
        } />
        <div style={{ padding: '14px 0' }}>
          {confirmArchive ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div className="gt-sub" style={{ lineHeight: 1.5 }}>Archive the current mesocycle and start a fresh one today? History is kept for comparison.</div>
              <div style={{ display: 'flex', gap: 9 }}>
                <button className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => setConfirmArchive(false)}>Cancel</button>
                <button className="gt-btn gt-btn-primary" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={async () => { await store.archiveAndStartNew(); setConfirmArchive(false); }}>Confirm</button>
              </div>
            </div>
          ) : (
            <button className="gt-btn gt-btn-ghost" style={{ width: '100%', minHeight: 46, fontSize: 13.5 }} onClick={() => setConfirmArchive(true)}>End & archive · start new</button>
          )}
        </div>
      </div>

      <SectionHead>History</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label="Session history" sub="Browse past mesocycles, cycles and sessions" ariaLabel="open history" onClick={() => setShowHistory(true)} right={<div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div>} />
      </div>

      <SectionHead>Profile</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label="Age" right={<Stepper value={profile.age} step={1} min={10} width={120} onChange={(v) => store.updateProfile({ age: v })} />} />
        <SettingRow label="Body weight" sub="Used for strength standards" right={<Stepper value={profile.bodyweightKg} step={0.5} min={30} width={134} onChange={(v) => store.updateProfile({ bodyweightKg: v })} format={(v) => v + ' kg'} />} />
      </div>

      <SectionHead>Appearance</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px 16px' }}>
        <SettingRow label="Theme" right={
          <div style={{ display: 'flex', gap: 5 }}>
            {['dark', 'light'].map((t) => <button key={t} className={'gt-chip' + (profile.theme === t ? ' on' : '')} onClick={() => store.updateProfile({ theme: t })}>{t}</button>)}
          </div>
        } />
        <div className="gt-micro" style={{ margin: '14px 0 10px 2px' }}>ACCENT COLOR</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 9 }}>
          {ACCENTS.map((c) => {
            const on = (profile.accent || ACCENTS[0]).toLowerCase() === c.toLowerCase();
            return <button key={c} title={c} aria-label={'accent ' + c} onClick={() => store.updateProfile({ accent: c })}
              style={{ width: '100%', aspectRatio: '1', borderRadius: 999, cursor: 'pointer', padding: 0, background: c, border: '3px solid ' + (on ? 'var(--text)' : 'transparent'), WebkitTapHighlightColor: 'transparent' }} />;
          })}
        </div>
      </div>

      <SectionHead>Routine · rotation</SectionHead>
      <div className="gt-card" style={{ padding: '14px 16px' }}>
        <div className="gt-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {variants.map((v) => (
            <button key={v.code} className={'gt-chip' + (routineVar === v.code ? ' on' : '')} style={{ flexShrink: 0 }} onClick={() => { setRoutineVar(v.code); setNameDraft(null); }}>{v.code}</button>
          ))}
        </div>
        <div className="gt-micro" style={{ margin: '12px 0 5px 4px' }}>{variant.code} · NAME</div>
        <input
          className="gt-input"
          value={nameDraft != null ? nameDraft : (variant.name || '')}
          placeholder="e.g. Upper 1, Lower 2…"
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={async () => {
            const name = (nameDraft || '').trim();
            if (nameDraft == null || !name || name === variant.name) { setNameDraft(null); return; }
            await store.saveVariant({ ...variant, name });
            setNameDraft(null);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <div style={{ marginTop: 10 }}>
          {variant.exerciseIds.map((id, idx) => {
            const e = exMap[id];
            if (!e) return null;
            return (
              <div key={id + idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className="gt-iconbtn" style={{ width: 26, height: 22, minWidth: 26, borderRadius: 8, color: 'var(--text-3)' }} onClick={() => moveExercise(idx, -1)} aria-label="move up"><GIcon name="chevU" size={12} stroke={2.6} /></button>
                  <button className="gt-iconbtn" style={{ width: 26, height: 22, minWidth: 26, borderRadius: 8, color: 'var(--text-3)' }} onClick={() => moveExercise(idx, 1)} aria-label="move down"><GIcon name="chevD" size={12} stroke={2.6} /></button>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="gt-body" style={{ fontWeight: 700, fontSize: 13.5 }}>{e.name}</div>
                  <div className="gt-micro">{e.muscle}{e.isBasic ? ' · big lift' : ''}</div>
                </div>
                <button className="gt-iconbtn" style={{ width: 34, height: 34, minWidth: 34, color: 'var(--text-2)' }} onClick={() => setEditingEx({ ...e })} aria-label="edit"><GIcon name="edit" size={14} /></button>
                <button className="gt-iconbtn" style={{ width: 34, height: 34, minWidth: 34, color: 'var(--text-3)' }} onClick={() => removeExercise(idx)} aria-label="remove"><GIcon name="x" size={14} /></button>
              </div>
            );
          })}
          <button className="gt-btn gt-btn-ghost" style={{ width: '100%', marginTop: 12, minHeight: 44, fontSize: 13.5 }} onClick={() => { setAddSheet(true); setAddQuery(''); }}><GIcon name="plus" size={16} />Add exercise</button>
        </div>
      </div>

      <SectionHead>Medals</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label="Medal thresholds" sub="Big lifts: est. 1RM as × body weight, Bronze → Diamond" onClick={() => setMedalSheet(true)} right={<div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div>} />
      </div>

      <SectionHead>Data</SectionHead>
      <div className="gt-card" style={{ padding: '14px 16px' }}>
        <div className="gt-sub" style={{ lineHeight: 1.5 }}>Everything lives on this device (IndexedDB). Works fully offline — back up before switching phones. Import accepts a JSON backup (full restore) or an Excel file with your past records (Date, Exercise, Value, Unit, Reps — merged, never deletes).</div>
        <div style={{ display: 'flex', gap: 9, marginTop: 13 }}>
          <button className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => exportJSON()}><GIcon name="download" size={16} />JSON backup</button>
          <button className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => exportXLSX()}><GIcon name="download" size={16} />Excel</button>
          <button className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => fileRef.current?.click()}><GIcon name="upload" size={16} />Import</button>
        </div>
        <input ref={fileRef} type="file" accept=".json,.xlsx,.xls,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} onChange={onImportFile} />
        {importMsg ? <div className="gt-sub" style={{ marginTop: 10, color: importMsg.includes('✓') ? 'var(--success)' : importMsg.includes('…') ? 'var(--text-2)' : 'var(--accent)' }}>{importMsg}</div> : null}
      </div>
      <div className="gt-micro" style={{ textAlign: 'center', marginTop: 18 }}>GymTrack {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}</div>

      {/* History — full-screen sub-page (was its own bottom tab before v2) */}
      {showHistory && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'var(--bg-grad), var(--bg)', animation: 'gt-fade 0.2s ease' }}>
          <div style={{ height: '100%', maxWidth: 520, margin: '0 auto', paddingTop: 'env(safe-area-inset-top)' }}>
            <HistoryScreen onBack={() => setShowHistory(false)} />
          </div>
        </div>
      )}

      {/* Edit exercise */}
      <Sheet open={!!editingEx} onClose={() => setEditingEx(null)} title="Edit exercise">
        {editingEx ? (<>
          <div className="gt-micro" style={{ margin: '0 0 5px 4px' }}>NAME</div>
          <input className="gt-input" value={editingEx.name} onChange={(e) => setEditingEx({ ...editingEx, name: e.target.value })} />
          <div className="gt-micro" style={{ margin: '14px 0 7px 4px' }}>MUSCLE GROUP</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MUSCLES.map((m) => <button key={m} className={'gt-chip' + (editingEx.muscle === m ? ' on' : '')} onClick={() => setEditingEx({ ...editingEx, muscle: m })}>{m}</button>)}
          </div>
          <div className="gt-micro" style={{ margin: '14px 0 7px 4px' }}>DEFAULT UNIT</div>
          <UnitChips value={editingEx.unit} onChange={(u) => setEditingEx({ ...editingEx, unit: u })} />
          <button className="gt-btn gt-btn-primary" style={{ width: '100%', marginTop: 18 }} onClick={async () => {
            if (editingEx.name.trim()) await store.saveExercise({ ...editingEx, name: editingEx.name.trim() });
            setEditingEx(null);
          }}>Save</button>
        </>) : null}
      </Sheet>

      {/* Add exercise to variant */}
      <Sheet open={addSheet} onClose={() => setAddSheet(false)} title={'Add to ' + variant.code}>
        <input className="gt-input" value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="Search or type a new exercise…" />
        <div style={{ marginTop: 10 }}>
          {exercises.filter((e) => e.active !== false && !variant.exerciseIds.includes(e.id) && e.name.toLowerCase().includes(addQuery.toLowerCase())).slice(0, 12).map((e) => (
            <button key={e.id} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              onClick={async () => { await store.saveVariant({ ...variant, exerciseIds: [...variant.exerciseIds, e.id] }); setAddSheet(false); }}>
              <div style={{ flex: 1 }}>
                <div className="gt-body" style={{ fontWeight: 700 }}>{e.name}</div>
                <div className="gt-micro">{e.muscle}</div>
              </div>
              <GIcon name="plus" size={15} style={{ color: 'var(--text-3)' }} />
            </button>
          ))}
        </div>
        {addQuery.trim().length > 1 && (
          <button className="gt-btn gt-btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={async () => {
            const created = await store.addExercise({ name: addQuery.trim(), muscle: 'Other', unit: 'kg' });
            await store.saveVariant({ ...variant, exerciseIds: [...variant.exerciseIds, created.id] });
            setAddSheet(false);
          }}>
            <GIcon name="plus" size={16} />Create “{addQuery.trim()}”
          </button>
        )}
      </Sheet>

      {/* Medal thresholds */}
      <Sheet open={medalSheet} onClose={() => setMedalSheet(false)} title="Medal thresholds">
        <div className="gt-sub" style={{ marginBottom: 14, lineHeight: 1.5 }}>Est. 1RM targets as multiples of your body weight ({profile.bodyweightKg} kg). Adjust to match your standards.</div>
        {exercises.filter((e) => e.isBasic && e.standards).map((e) => (
          <div key={e.id} style={{ marginBottom: 16 }}>
            <div className="gt-body" style={{ fontWeight: 800, marginBottom: 7 }}>{e.name}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {e.standards.map((r, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div className="gt-micro" style={{ textAlign: 'center', marginBottom: 3 }}>{MEDALS[i].slice(0, 4).toUpperCase()}</div>
                  <input className="gt-input" type="number" step="0.05" min="0" value={r}
                    style={{ padding: '9px 4px', textAlign: 'center', fontSize: 13, borderRadius: 10 }}
                    onChange={(ev) => {
                      const v = parseFloat(ev.target.value);
                      if (isNaN(v)) return;
                      const standards = e.standards.map((x, j) => (j === i ? v : x));
                      store.saveExercise({ ...e, standards });
                    }} />
                  <div className="gt-micro" style={{ textAlign: 'center', marginTop: 3 }}>{Math.round(r * profile.bodyweightKg)} kg</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Sheet>
    </div>
  );
}
