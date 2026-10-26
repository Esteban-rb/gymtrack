// GymTrack — Settings: mesocycle, profile, rotation editor, medal thresholds, units, backup, theme.
import React, { useEffect, useRef, useState } from 'react';
import { useStore, AUTO_FINISH_MIN_SETS } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { MUSCLES } from '../db.js';
import { exportJSON, exportXLSX, importJSON, importXLSX } from '../backup.js';
import { GIcon, Stepper, UnitChips, Sheet, SectionHead } from '../components.jsx';
import HistoryScreen from './History.jsx';
import LibraryScreen from './Library.jsx';
import Avatar, { randomAvatarSeed, resizePhoto } from '../avatar.jsx';
import ColorPicker from '../colorpicker.jsx';
import { isoDate, addDays, parseISO } from '../calc.js';
import { useT } from '../i18n.js';

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

/** Destructive-style action: one click asks for confirmation inline, a second one runs it. */
function ConfirmButton({ label, confirmText, className, open, setOpen, onConfirm, t, disabled = false }) {
  if (!open) return <button type="button" className={className} disabled={disabled} style={{ width: '100%', minHeight: 46, fontSize: 13.5 }} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div className="gt-sub" style={{ lineHeight: 1.5 }}>{confirmText}</div>
      <div style={{ display: 'flex', gap: 9 }}>
        <button type="button" className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => setOpen(false)}>{t('common.cancel')}</button>
        <button type="button" className={className} style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={async () => { setOpen(false); await onConfirm(); }}>{t('common.confirm')}</button>
      </div>
    </div>
  );
}

export default function SettingsScreen({ onSetup, setupOpening = false } = {}) {
  const { t, date, medal, muscle } = useT();
  const store = useStore(useShallow((state) => ({
    profile: state.profile, period: state.period, variants: state.variants, exercises: state.exercises,
    updatePeriod: state.updatePeriod, archiveAndStartNew: state.archiveAndStartNew,
    updateProfile: state.updateProfile, saveVariant: state.saveVariant, saveExercise: state.saveExercise,
    addExercise: state.addExercise, init: state.init, refreshPR: state.refreshPR, dismissMedal: state.dismissMedal,
  })));
  const { profile, period, variants, exercises } = store;
  const [routineVar, setRoutineVar] = useState(variants[0]?.code || 'U1');
  const [nameDraft, setNameDraft] = useState(null); // editing buffer for the variant's name
  const [editingEx, setEditingEx] = useState(null);   // exercise being edited (draft copy)
  const [addSheet, setAddSheet] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [medalSheet, setMedalSheet] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showRoutine, setShowRoutine] = useState(false);
  const [confirmRoutine, setConfirmRoutine] = useState(false);
  const [colorSheet, setColorSheet] = useState(false);
  const [profileSheet, setProfileSheet] = useState(null);  // { name, age } draft
  const [measure, setMeasure] = useState(null);            // { kind: 'weight' | 'height', text }
  const photoRef = useRef(null);
  const [importMsg, setImportMsg] = useState(null);
  const fileRef = useRef(null);

  const mono = profile.accent === 'mono';
  const special = ['silver', 'gold', 'platinum', 'nebula', 'nebula-fill'].includes(profile.accent) ? profile.accent : null;   // gradient themes
  const autoFinish = profile.autoFinish !== false;   // opt-out, on by default
  const vmap = Object.fromEntries(variants.map((v) => [v.code, v]));
  const variant = vmap[routineVar] || variants[0] || { code: routineVar, name: '—', exerciseIds: [] };
  const exMap = Object.fromEntries(exercises.map((e) => [e.id, e]));

  // an illustration is picked once, at random, and kept until the user adds a photo
  useEffect(() => { if (profile.avatarSeed == null) store.updateProfile({ avatarSeed: randomAvatarSeed() }); }, [profile.avatarSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  // a cycle is one week of the rotation, so the block runs cycleGoal weeks from its start date
  const endISO = period ? isoDate(addDays(parseISO(period.startDate), (period.cycleGoal || 6) * 7 - 1)) : null;
  const daysLeft = endISO ? Math.max(0, Math.round((parseISO(endISO) - parseISO(isoDate())) / 86400000)) : null;
  const accentHex = (profile.accent || ACCENTS[0]).toLowerCase();
  const redAccent = !mono && accentHex === ACCENTS[0].toLowerCase();
  const endBtn = 'gt-btn gt-btn-end' + (redAccent ? ' black' : '');

  const saveMeasure = async () => {
    const v = parseFloat((measure.text || '').replace(',', '.'));
    if (!isNaN(v) && v > 0) await store.updateProfile(measure.kind === 'weight' ? { bodyweightKg: +v.toFixed(1) } : { heightCm: Math.round(v) });
    setMeasure(null);
  };
  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) { try { await store.updateProfile({ photo: await resizePhoto(file) }); } catch { /* unreadable image: keep the current avatar */ } }
  };

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
        setImportMsg(t('settings.importing', { name: file.name }));
        const { counts, affected, hasRoutine } = await importXLSX(file);
        await store.init();
        // recompute baselines/PRs/medals for everything the file touched, silently
        for (const id of affected) await store.refreshPR(id);
        store.dismissMedal();
        setImportMsg(t('settings.importedXlsx', { sets: counts.sets, workouts: counts.workouts, exercises: counts.exercises }) + (counts.skipped ? t('settings.importedSkipped', { n: counts.skipped }) : '') + t('settings.importedTail') + (hasRoutine ? t('settings.importedRoutine') : ''));
      } else {
        if (!window.confirm(t('settings.importJsonConfirm'))) return;
        setImportMsg(t('settings.importing', { name: file.name }));
        await importJSON(file);
        await store.init();
        setImportMsg(t('settings.restored'));
      }
    } catch (err) {
      setImportMsg(t('settings.importFailed', { message: err.message })); // stays on screen until the next import attempt
    }
  };

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <h1 className="gt-h1" style={{ marginBottom: 4 }}>{t('settings.title')}</h1>
      <div className="gt-sub">{t('settings.sub')}</div>

      {/* ---- Profile ---- */}
      <SectionHead big>{t('settings.profile')}</SectionHead>
      <div className="gt-card" style={{ padding: 16 }}>
        <button aria-label={t('settings.editProfile')} onClick={() => setProfileSheet({ name: profile.name || '', age: String(profile.age ?? '') })}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
          <Avatar photo={profile.photo} seed={profile.avatarSeed ?? 0} size={68} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="gt-h1" style={{ fontSize: 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name || t('settings.noName')}</div>
            <div className="gt-micro" style={{ marginTop: 2 }}>{t('settings.tapToEdit')}</div>
          </div>
          <div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div>
        </button>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          {[['weight', t('settings.weight'), profile.bodyweightKg, 'kg'], ['height', t('settings.height'), profile.heightCm, 'cm']].map(([kind, label, value, unit]) => (
            <div key={kind} role="button" tabIndex={0} className="gt-card" aria-label={t('settings.editMeasure', { label })}
              onClick={() => setMeasure({ kind, text: String(value ?? '') })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMeasure({ kind, text: String(value ?? '') }); } }}
              style={{ flex: 1, padding: '11px 14px', borderRadius: 18, textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
              <div className="gt-label" style={{ fontSize: 10.5 }}>{label}</div>
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 5 }}>
                <span className="gt-display" style={{ fontSize: 28, lineHeight: 1 }}>{value ?? '—'}</span>
                <span className="gt-sub">{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Mesocycle ---- */}
      <SectionHead big>{t('settings.mesocycle')}</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px 16px' }}>
        <SettingRow label={t('settings.startDate')} right={<div className="gt-num" style={{ fontSize: 15 }}>{period ? date(period.startDate) : '—'}</div>} />
        <SettingRow label={t('settings.endDate')} right={<div className="gt-num" style={{ fontSize: 15 }}>{endISO ? date(endISO) : '—'}</div>} />
        <div style={{ padding: '13px 2px', borderBottom: '1px solid var(--border)' }}>
          <div className="gt-body" style={{ fontWeight: 700 }}>{t('settings.cycles')}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {[4, 6, 8].map((c) => <button key={c} className={'gt-chip' + ((period?.cycleGoal || 6) === c ? ' on' : '')} style={{ flex: 1 }} aria-pressed={(period?.cycleGoal || 6) === c} onClick={() => store.updatePeriod({ cycleGoal: c })}>{c}</button>)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {[[t('settings.currentCycle'), period ? (period.cycle ?? 1) : '—'], [t('settings.daysLeft'), daysLeft ?? '—']].map(([label, value]) => (
            <div key={label} className="gt-card" style={{ flex: 1, padding: '11px 14px', borderRadius: 18 }}>
              <div className="gt-label" style={{ fontSize: 10.5 }}>{label}</div>
              <div className="gt-display" style={{ fontSize: 28, lineHeight: 1.1, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <ConfirmButton label={t('settings.archiveButton')} confirmText={t('settings.archiveConfirm')} className={endBtn} t={t}
            open={confirmArchive} setOpen={setConfirmArchive} onConfirm={async () => { await store.archiveAndStartNew(); }} />
        </div>
      </div>

      {/* ---- Themes ---- */}
      <SectionHead big>{t('settings.themes')}</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label={t('settings.theme')} right={
          <div style={{ display: 'flex', gap: 5 }}>
            {['dark', 'light'].map((mode) => <button key={mode} className={'gt-chip' + (profile.theme === mode ? ' on' : '')} aria-pressed={profile.theme === mode} onClick={() => store.updateProfile({ theme: mode })}>{t('settings.theme.' + mode)}</button>)}
          </div>
        } />
        <SettingRow label={t('settings.rings')} sub={t('settings.ringsSub')} right={
          <div style={{ display: 'flex', gap: 5 }}>
            {[['on', true], ['off', false]].map(([l, v]) => (
              <button key={l} className={'gt-chip' + ((profile.rings !== false) === v ? ' on' : '')} aria-label={t('settings.ringsAria', { state: t('settings.' + l) })} aria-pressed={(profile.rings !== false) === v}
                onClick={() => store.updateProfile({ rings: v })}>{t('settings.' + l)}</button>
            ))}
          </div>
        } />
        <SettingRow label={t('settings.colors')} sub={mono ? t('settings.mono') : special ? t('settings.special.' + special) : accentHex.toUpperCase()} ariaLabel={t('settings.openColors')} onClick={() => setColorSheet(true)} right={<>
          <span style={{ width: 26, height: 26, borderRadius: 999, background: mono ? 'linear-gradient(135deg, #FFFFFF 0 50%, #101114 50% 100%)' : special ? 'var(--accent-bg)' : accentHex, border: '2px solid var(--border-strong)' }} />
          <div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div>
        </>} />
      </div>

      {/* ---- Training ---- */}
      <SectionHead big>{t('settings.training')}</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label={t('settings.routine')} right={<button className="gt-chip on" onClick={() => setShowRoutine(true)}>{t('settings.editRoutine')}</button>} />
        <SettingRow label={t('settings.autoFinish')} sub={t('settings.autoFinishSub', { n: AUTO_FINISH_MIN_SETS })} right={
          <div style={{ display: 'flex', gap: 5 }}>
            {[['on', true], ['off', false]].map(([l, v]) => (
              <button key={l} className={'gt-chip' + (autoFinish === v ? ' on' : '')} aria-label={t('settings.autoFinishAria', { state: t('settings.' + l) })} aria-pressed={autoFinish === v}
                onClick={() => store.updateProfile({ autoFinish: v })}>{t('settings.' + l)}</button>
            ))}
          </div>
        } />
        <SettingRow label={t('settings.libraryRow')} sub={t('settings.librarySub')} ariaLabel={t('settings.openLibrary')} onClick={() => setShowLibrary(true)} right={<div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div>} />
      </div>

      {/* ---- Data ---- */}
      <SectionHead big>{t('settings.data')}</SectionHead>
      <div className="gt-card" style={{ padding: '4px 16px' }}>
        <SettingRow label={t('settings.sessionHistory')} sub={t('settings.sessionHistorySub')} ariaLabel={t('settings.openHistory')} onClick={() => setShowHistory(true)} right={<div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div>} />
        <SettingRow label={t('settings.medalThresholds')} sub={t('settings.medalThresholdsSub')} onClick={() => setMedalSheet(true)} right={<div style={{ color: 'var(--text-3)' }}><GIcon name="chevR" size={16} /></div>} />
        <div style={{ padding: '14px 0 12px' }}>
          <div style={{ display: 'flex', gap: 9 }}>
            <button className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => exportJSON()}><GIcon name="download" size={16} />{t('settings.jsonBackup')}</button>
            <button className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => exportXLSX()}><GIcon name="download" size={16} />{t('settings.excel')}</button>
            <button className="gt-btn gt-btn-ghost" style={{ flex: 1, minHeight: 46, fontSize: 13.5 }} onClick={() => fileRef.current?.click()}><GIcon name="upload" size={16} />{t('settings.import')}</button>
          </div>
          <input ref={fileRef} type="file" accept=".json,.xlsx,.xls,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }} onChange={onImportFile} />
          {importMsg ? <div className="gt-sub" style={{ marginTop: 10, color: importMsg.includes('✓') ? 'var(--success)' : importMsg.includes('…') ? 'var(--text-2)' : 'var(--accent)' }}>{importMsg}</div> : null}
        </div>
      </div>
      {/* ---- Change routine (last on purpose: it reopens the whole setup) ---- */}
      {onSetup ? (<>
        <SectionHead big>{t('settings.routineGroup')}</SectionHead>
        <div className="gt-card" style={{ padding: 16 }}>
          <ConfirmButton label={setupOpening ? t('settings.setupOpening') : t('settings.changeRoutine')} confirmText={t('settings.changeRoutineConfirm')}
            className={endBtn} t={t} disabled={setupOpening} open={confirmRoutine} setOpen={setConfirmRoutine} onConfirm={async () => { await onSetup(); }} />
        </div>
      </>) : null}

      <div className="gt-micro" style={{ textAlign: 'center', marginTop: 18 }}>GymTrack {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}</div>

      {/* Routine — full-screen sub-page */}
      {showRoutine && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'var(--bg-grad), var(--bg)', animation: 'gt-fade 0.2s ease' }}>
          <div className="gt-scroll" style={{ height: '100%', maxWidth: 520, margin: '0 auto', padding: 'calc(18px + env(safe-area-inset-top)) 16px 60px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <button className="gt-iconbtn" style={{ width: 38, height: 38, minWidth: 38 }} onClick={() => setShowRoutine(false)} aria-label={t('settings.backToSettings')}><GIcon name="chevL" size={17} /></button>
              <h1 className="gt-h1" style={{ fontSize: 26 }}>{t('settings.routine')}</h1>
            </div>
      <div className="gt-card" style={{ padding: '14px 16px' }}>
        <div className="gt-scroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {variants.map((v) => (
            <button key={v.code} className={'gt-chip' + (routineVar === v.code ? ' on' : '')} aria-pressed={routineVar === v.code} style={{ flexShrink: 0 }} onClick={() => { setRoutineVar(v.code); setNameDraft(null); }}>{v.code}</button>
          ))}
        </div>
        <div className="gt-micro" style={{ margin: '12px 0 5px 4px' }}>{t('settings.nameCaps', { code: variant.code })}</div>
        <input
          className="gt-input"
          aria-label={t('settings.variantNameAria', { code: variant.code })}
          value={nameDraft != null ? nameDraft : (variant.name || '')}
          placeholder={t('settings.variantNamePlaceholder')}
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
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className="gt-iconbtn" style={{ borderRadius: 10, color: 'var(--text-3)' }} onClick={() => moveExercise(idx, -1)} aria-label={t('settings.moveUp', { name: e.name })}><GIcon name="chevU" size={12} stroke={2.6} /></button>
                  <button className="gt-iconbtn" style={{ borderRadius: 10, color: 'var(--text-3)' }} onClick={() => moveExercise(idx, 1)} aria-label={t('settings.moveDown', { name: e.name })}><GIcon name="chevD" size={12} stroke={2.6} /></button>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="gt-body" style={{ fontWeight: 700, fontSize: 13.5 }}>{e.name}</div>
                  <div className="gt-micro">{muscle(e.muscle)}{e.isBasic ? t('settings.bigLift') : ''}</div>
                </div>
                <button className="gt-iconbtn" style={{ color: 'var(--text-2)' }} onClick={() => setEditingEx({ ...e })} aria-label={t('settings.editExercise', { name: e.name })}><GIcon name="edit" size={14} /></button>
                <button className="gt-iconbtn" style={{ color: 'var(--text-3)' }} onClick={() => removeExercise(idx)} aria-label={t('settings.removeExercise', { name: e.name })}><GIcon name="x" size={14} /></button>
              </div>
            );
          })}
          <button className="gt-btn gt-btn-ghost" style={{ width: '100%', marginTop: 12, minHeight: 44, fontSize: 13.5 }} onClick={() => { setAddSheet(true); setAddQuery(''); }}><GIcon name="plus" size={16} />{t('settings.addExercise')}</button>
        </div>
      </div>

          </div>
        </div>
      )}

      {/* Profile: photo, name, age */}
      <Sheet open={!!profileSheet} onClose={() => setProfileSheet(null)} title={t('settings.editProfile')}>
        {profileSheet ? (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Avatar photo={profile.photo} seed={profile.avatarSeed ?? 0} size={72} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="gt-chip on" onClick={() => photoRef.current?.click()}>{profile.photo ? t('settings.photoChange') : t('settings.photoAdd')}</button>
              {profile.photo ? <button className="gt-chip" onClick={() => store.updateProfile({ photo: null })}>{t('settings.photoRemove')}</button> : null}
            </div>
            <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPhoto} />
          </div>
          <div className="gt-micro" style={{ margin: '16px 0 5px 4px' }}>{t('settings.nameLabel')}</div>
          <input className="gt-input" aria-label={t('settings.name')} value={profileSheet.name} onChange={(e) => setProfileSheet({ ...profileSheet, name: e.target.value })} />
          <div className="gt-micro" style={{ margin: '14px 0 5px 4px' }}>{t('settings.age').toUpperCase()}</div>
          <input className="gt-input" inputMode="numeric" aria-label={t('settings.age')} value={profileSheet.age} onChange={(e) => setProfileSheet({ ...profileSheet, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
          <button className="gt-btn gt-btn-primary" style={{ width: '100%', marginTop: 18 }} onClick={async () => {
            const patch = {};
            if (profileSheet.name.trim()) patch.name = profileSheet.name.trim();
            const age = parseInt(profileSheet.age, 10);
            if (age >= 10) patch.age = age;
            if (Object.keys(patch).length) await store.updateProfile(patch);
            setProfileSheet(null);
          }}>{t('common.save')}</button>
        </>) : null}
      </Sheet>

      {/* Weight / height */}
      <Sheet open={!!measure} onClose={() => setMeasure(null)} title={measure ? t(measure.kind === 'weight' ? 'settings.weight' : 'settings.height') : ''}>
        {measure ? (<>
          <input className="gt-input" autoFocus inputMode="decimal" aria-label={t(measure.kind === 'weight' ? 'settings.weight' : 'settings.height')}
            value={measure.text} onChange={(e) => setMeasure({ ...measure, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveMeasure(); }} />
          <div className="gt-micro" style={{ margin: '6px 0 0 4px' }}>{measure.kind === 'weight' ? 'kg' : 'cm'}</div>
          <button className="gt-btn gt-btn-primary" style={{ width: '100%', marginTop: 18 }} onClick={saveMeasure}>{t('common.save')}</button>
        </>) : null}
      </Sheet>

      {/* Colors: picker, presets, special themes */}
      <Sheet open={colorSheet} onClose={() => setColorSheet(false)} title={t('settings.colors')}>
        <ColorPicker value={mono || special ? ACCENTS[0] : accentHex} onCommit={(hex) => store.updateProfile({ accent: hex })} hexLabel="HEX" />
        <div className="gt-label" style={{ margin: '20px 2px 10px' }}>{t('settings.defaultColors')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(44px, 1fr))', gap: 9 }}>
          {ACCENTS.map((c) => {
            const on = !mono && !special && accentHex === c.toLowerCase();
            return <button key={c} title={c} aria-label={t('settings.accentAria', { color: c })} aria-pressed={on} onClick={() => store.updateProfile({ accent: c })}
              style={{ width: '100%', aspectRatio: '1', borderRadius: 999, cursor: 'pointer', padding: 0, background: c, border: '3px solid ' + (on ? 'var(--text)' : 'transparent'), WebkitTapHighlightColor: 'transparent' }} />;
          })}
        </div>
        {/* Mono isn't a hue — it repaints the whole app in black & white, so it lives under special colors
            together with any future themes. */}
        <div className="gt-label" style={{ margin: '20px 2px 10px' }}>{t('settings.specialColors')}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[['mono', t('settings.mono'), t('settings.monoAria')], ...['silver', 'gold', 'platinum', 'nebula', 'nebula-fill'].map((k) => [k, t('settings.special.' + k), t('settings.specialAria', { name: t('settings.special.' + k) })])].map(([key, label, aria]) => {
              const on = profile.accent === key;
              return <button key={key} className={'gt-chip' + (on ? ' on' : '')} aria-label={aria} aria-pressed={on} onClick={() => store.updateProfile({ accent: on ? ACCENTS[0] : key })}>{label}</button>;
            })}
          </div>
        </div>
      </Sheet>

      {/* Library — full-screen sub-page: exercises by muscle */}
      {showLibrary && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'var(--bg-grad), var(--bg)', animation: 'gt-fade 0.2s ease' }}>
          <div style={{ height: '100%', maxWidth: 520, margin: '0 auto', paddingTop: 'env(safe-area-inset-top)' }}>
            <LibraryScreen onBack={() => setShowLibrary(false)} />
          </div>
        </div>
      )}

      {/* History — full-screen sub-page (was its own bottom tab before v2) */}
      {showHistory && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'var(--bg-grad), var(--bg)', animation: 'gt-fade 0.2s ease' }}>
          <div style={{ height: '100%', maxWidth: 520, margin: '0 auto', paddingTop: 'env(safe-area-inset-top)' }}>
            <HistoryScreen onBack={() => setShowHistory(false)} />
          </div>
        </div>
      )}

      {/* Edit exercise */}
      <Sheet open={!!editingEx} onClose={() => setEditingEx(null)} title={t('settings.editSheet')}>
        {editingEx ? (<>
          <div className="gt-micro" style={{ margin: '0 0 5px 4px' }}>{t('settings.nameLabel')}</div>
          <input className="gt-input" aria-label={t('settings.exerciseName')} value={editingEx.name} onChange={(e) => setEditingEx({ ...editingEx, name: e.target.value })} />
          <div className="gt-micro" style={{ margin: '14px 0 7px 4px' }}>{t('settings.muscleCaps')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {MUSCLES.map((m) => <button key={m} className={'gt-chip' + (editingEx.muscle === m ? ' on' : '')} aria-pressed={editingEx.muscle === m} onClick={() => setEditingEx({ ...editingEx, muscle: m })}>{muscle(m)}</button>)}
          </div>
          <div className="gt-micro" style={{ margin: '14px 0 7px 4px' }}>{t('settings.unitCaps')}</div>
          <UnitChips value={editingEx.unit} onChange={(u) => setEditingEx({ ...editingEx, unit: u })} />
          <button className="gt-btn gt-btn-primary" style={{ width: '100%', marginTop: 18 }} onClick={async () => {
            if (editingEx.name.trim()) await store.saveExercise({ ...editingEx, name: editingEx.name.trim() });
            setEditingEx(null);
          }}>{t('common.save')}</button>
        </>) : null}
      </Sheet>

      {/* Add exercise to variant */}
      <Sheet open={addSheet} onClose={() => setAddSheet(false)} title={t('settings.addTo', { code: variant.code })}>
        <input className="gt-input" aria-label={t('common.exerciseSearch')} value={addQuery} onChange={(e) => setAddQuery(e.target.value)} placeholder={t('common.exerciseSearchPlaceholder')} />
        <div style={{ marginTop: 10 }}>
          {exercises.filter((e) => e.active !== false && !variant.exerciseIds.includes(e.id) && e.name.toLowerCase().includes(addQuery.toLowerCase())).slice(0, 12).map((e) => (
            <button key={e.id} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              onClick={async () => { await store.saveVariant({ ...variant, exerciseIds: [...variant.exerciseIds, e.id] }); setAddSheet(false); }}>
              <div style={{ flex: 1 }}>
                <div className="gt-body" style={{ fontWeight: 700 }}>{e.name}</div>
                <div className="gt-micro">{muscle(e.muscle)}</div>
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
            <GIcon name="plus" size={16} />{t('common.createExercise', { name: addQuery.trim() })}
          </button>
        )}
      </Sheet>

      {/* Medal thresholds */}
      <Sheet open={medalSheet} onClose={() => setMedalSheet(false)} title={t('settings.medalThresholds')}>
        <div className="gt-sub" style={{ marginBottom: 14, lineHeight: 1.5 }}>{t('settings.medalSheetBody', { bw: profile.bodyweightKg })}</div>
        {exercises.filter((e) => e.isBasic && e.standards).map((e) => (
          <div key={e.id} style={{ marginBottom: 16 }}>
            <div className="gt-body" style={{ fontWeight: 800, marginBottom: 7 }}>{e.name}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {e.standards.map((r, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div className="gt-micro" style={{ textAlign: 'center', marginBottom: 3 }}>{t('medal.short.' + i)}</div>
                  <input className="gt-input" type="number" step="0.05" min="0" value={r}
                    aria-label={t('settings.multiplierAria', { name: e.name, medal: medal(i) })}
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
