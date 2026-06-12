// GymTrack — Settings: period, profile, routine editor, medal thresholds, units, backup, theme.
import React, { useRef, useState } from 'react';
import { useStore } from '../store.js';
import { MUSCLES } from '../db.js';
import { MEDALS, fmtDate, isoDate, parseISO, addDays, DAY_KEYS } from '../calc.js';
import { exportJSON, exportXLSX, importJSON, importXLSX } from '../backup.js';
import { GIcon, Stepper, UnitChips, Sheet, SectionHead } from '../components.jsx';

function SettingRow({ label, sub, right, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 2px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: onClick ? 'pointer' : 'default', WebkitTapHighlightColor: 'transparent' }}>
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
  const { profile, period, templates, exercises } = store;
  const [routineDay, setRoutineDay] = useState('Mon');
  const [blockDraft, setBlockDraft] = useState(null); // editing buffer for the day's name
  const [editingEx, setEditingEx] = useState(null);   // exercise being edited (draft copy)
  const [addSheet, setAddSheet] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [medalSheet, setMedalSheet] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const fileRef = useRef(null);

  const tpl = templates[routineDay] || { day: routineDay, block: '—', exerciseIds: [] };
  const exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const endDate = period ? isoDate(addDays(parseISO(period.startDate), period.weeks * 7 - 3)) : null;

  const moveExercise = async (idx, dir) => {
    const ids = [...tpl.exerciseIds];
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await store.saveTemplate({ ...tpl, exerciseIds: ids });
  };
  const removeExercise = async (idx) => {
    await store.saveTemplate({ ...tpl, exerciseIds: tpl.exerciseIds.filter((_, i) => i !== idx) });
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isExcel = /\.xlsx?$/i.test(file.name);
    try {
      if (isExcel) {
        const { counts, affected } = await importXLSX(file);
        await store.init();
        // recompute baselines/PRs/medals for everything the file touched, silently
        for (const id of affected) await store.refreshPR(id);
        store.dismissMedal();
        setImportMsg(`Imported ${counts.sets} sets · ${counts.workouts} workouts · ${counts.exercises} new exercises` + (counts.skipped ? ` · ${counts.skipped} duplicates skipped` : '') + ' ✓');
      } else {
        if (!window.confirm('Importing a JSON backup replaces ALL current data. Continue?')) return;
        await importJSON(file);
        await store.init();
        setImportMsg('Backup restored ✓');
      }
    } catch (err) {
      setImportMsg('Import failed: ' + err.message);
    }
    setTimeout(() => setImportMsg(null), 6000);
  };

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <div className="gt-h1" style={{ marginBottom: 4 }}>Settings</div>
      <div className="gt-sub">Period, routine & data</div>

      <SectionHead>Period</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label="Start date" right={<div className="gt-num" style={{ fontSize: 15 }}>{period ? fmtDate(period.startDate) : '—'}</div>} />
        <SettingRow label="Duration" right={
          <div style={{ display: 'flex', gap: 5 }}>
            {[8, 12, 16].map((w) => <button key={w} className={'gt-chip' + (period?.weeks === w ? ' on' : '')} onClick={() => store.updatePeriod({ weeks: w })}>{w} wk</button>)}
          </div>
        } />
        <SettingRow label="Ends" right={<div className="gt-num" style={{ fontSize: 15 }}>{endDate ? fmtDate(endDate) : '—'}</div>} />
        <div style={{ padding: '14px 0' }}>
          {confirmArchive ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div className="gt-sub" style={{ lineHeight: 1.5 }}>Archive the current period and start a fresh one today? History is kept for comparison.</div>
              <div style={{ display: 'flex', gap: 9 }}>
                <button className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => setConfirmArchive(false)}>Cancel</button>
                <button className="gt-btn gt-btn-primary" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={async () => { await store.archiveAndStartNew(); setConfirmArchive(false); }}>Confirm</button>
              </div>
            </div>
          ) : (
            <button className="gt-btn gt-btn-ghost" style={{ width: '100%', minHeight: 46, fontSize: 13.5 }} onClick={() => setConfirmArchive(true)}>End & archive period · start new</button>
          )}
        </div>
      </div>

      <SectionHead>Profile</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label="Age" right={<Stepper value={profile.age} step={1} min={10} width={120} onChange={(v) => store.updateProfile({ age: v })} />} />
        <SettingRow label="Body weight" sub="Used for strength standards" right={<Stepper value={profile.bodyweightKg} step={0.5} min={30} width={134} onChange={(v) => store.updateProfile({ bodyweightKg: v })} format={(v) => v + ' kg'} />} />
        <SettingRow label="Theme" right={
          <div style={{ display: 'flex', gap: 5 }}>
            {['dark', 'light'].map((t) => <button key={t} className={'gt-chip' + (profile.theme === t ? ' on' : '')} onClick={() => store.updateProfile({ theme: t })}>{t}</button>)}
          </div>
        } />
      </div>

      <SectionHead>Routine</SectionHead>
      <div className="gt-card" style={{ padding: '14px 16px' }}>
        <div className="gt-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {DAY_KEYS.map((d) => (
            <button key={d} className={'gt-chip' + (routineDay === d ? ' on' : '')} style={{ flexShrink: 0 }} onClick={() => { setRoutineDay(d); setBlockDraft(null); }}>{d}{templates[d] ? ' · ' + templates[d].block : ''}</button>
          ))}
        </div>
        <div className="gt-micro" style={{ margin: '12px 0 5px 4px' }}>{routineDay.toUpperCase()} · DAY NAME</div>
        <input
          className="gt-input"
          value={blockDraft != null ? blockDraft : (templates[routineDay]?.block || '')}
          placeholder="e.g. Push-Pull, Legs, Upper…"
          onChange={(e) => setBlockDraft(e.target.value)}
          onBlur={async () => {
            const name = (blockDraft || '').trim();
            if (blockDraft == null || !name || name === templates[routineDay]?.block) { setBlockDraft(null); return; }
            await store.saveTemplate({ ...tpl, block: name });
            setBlockDraft(null);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <div style={{ marginTop: 10 }}>
          {tpl.exerciseIds.map((id, idx) => {
            const e = exMap[id];
            if (!e) return null;
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
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
        {importMsg ? <div className="gt-sub" style={{ marginTop: 10, color: importMsg.includes('✓') ? 'var(--success)' : 'var(--accent)' }}>{importMsg}</div> : null}
      </div>

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

      {/* Add exercise to day */}
      <Sheet open={addSheet} onClose={() => setAddSheet(false)} title={'Add to ' + routineDay}>
        <input className="gt-input" value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder="Search or type a new exercise…" />
        <div style={{ marginTop: 10 }}>
          {exercises.filter((e) => e.active !== false && !tpl.exerciseIds.includes(e.id) && e.name.toLowerCase().includes(addQuery.toLowerCase())).slice(0, 12).map((e) => (
            <button key={e.id} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              onClick={async () => { await store.saveTemplate({ ...tpl, exerciseIds: [...tpl.exerciseIds, e.id] }); setAddSheet(false); }}>
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
            await store.saveTemplate({ ...tpl, exerciseIds: [...tpl.exerciseIds, created.id] });
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
