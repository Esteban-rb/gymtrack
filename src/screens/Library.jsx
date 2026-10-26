// GymTrack — Library: every saved exercise, browsed by muscle. Pick a muscle on the body map
// (or from the list / search), then see, edit and add the exercises that train it.
import React, { useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { MUSCLES } from '../db.js';
import { GIcon, Sheet, UnitChips } from '../components.jsx';
import { MuscleMap } from '../bodymap.jsx';
import { useT } from '../i18n.js';

export default function LibraryScreen({ onBack }) {
  const { t, muscle: muscleName } = useT();
  const store = useStore(useShallow((s) => ({ exercises: s.exercises, saveExercise: s.saveExercise, addExercise: s.addExercise })));
  const { exercises } = store;
  const [selected, setSelected] = useState(null);   // muscle group being browsed
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);     // draft copy of the exercise being edited
  const [adding, setAdding] = useState(null);       // { name, unit } draft of a new exercise

  const muscles = useMemo(() => {
    const extra = [...new Set(exercises.map((e) => e.muscle))].filter((m) => m && !MUSCLES.includes(m));
    return [...MUSCLES, ...extra];
  }, [exercises]);
  const byMuscle = useMemo(() => {
    const out = {};
    for (const e of exercises) (out[e.muscle] = out[e.muscle] || []).push(e);
    return out;
  }, [exercises]);
  const countLabel = (n) => t(n === 1 ? 'library.count1' : 'library.count', { n });

  const q = query.trim().toLowerCase();
  const muscleHits = q ? muscles.filter((m) => muscleName(m).toLowerCase().includes(q)) : [];
  const exerciseHits = q ? exercises.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 30) : [];
  const open = (m) => { setSelected(m); setQuery(''); };

  const list = selected ? (byMuscle[selected] || []) : [];

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button className="gt-iconbtn" style={{ width: 38, height: 38, minWidth: 38 }}
          onClick={selected ? () => setSelected(null) : onBack}
          aria-label={selected ? t('library.backMuscles') : t('library.back')}><GIcon name="chevL" size={17} /></button>
        <div>
          <h1 className="gt-h1" style={{ fontSize: 26 }}>{selected ? muscleName(selected) : t('library.title')}</h1>
          <div className="gt-sub">{selected ? countLabel(list.length) : t('library.sub')}</div>
        </div>
      </div>

      {!selected ? (<>
        <input className="gt-input" type="search" aria-label={t('library.searchAria')} placeholder={t('library.search')}
          value={query} onChange={(e) => setQuery(e.target.value)} />

        {q ? (
          <div style={{ marginTop: 14 }}>
            {muscleHits.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {muscleHits.map((m) => <button key={m} className="gt-chip" onClick={() => open(m)}>{muscleName(m)}</button>)}
              </div>
            )}
            {exerciseHits.map((e) => (
              <button key={e.id} onClick={() => open(e.muscle)} style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <div className="gt-body" style={{ fontWeight: 700 }}>{e.name}</div>
                  <div className="gt-micro">{muscleName(e.muscle)}</div>
                </div>
                <GIcon name="chevR" size={15} style={{ color: 'var(--text-3)' }} />
              </button>
            ))}
            {!muscleHits.length && !exerciseHits.length && <div className="gt-sub" style={{ padding: '18px 2px' }}>{t('library.noResults')}</div>}
          </div>
        ) : (<>
          <div className="gt-card" style={{ marginTop: 14, padding: '16px 12px 12px' }}>
            <MuscleMap onSelect={(g) => open(g)} />
            <div className="gt-micro" style={{ textAlign: 'center', marginTop: 10 }}>{t('library.hint')}</div>
          </div>
          <div className="gt-card" style={{ marginTop: 12, padding: '4px 16px' }}>
            {muscles.map((m) => (
              <button key={m} onClick={() => open(m)} style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <div className="gt-body" style={{ fontWeight: 700 }}>{muscleName(m)}</div>
                  <div className="gt-micro">{countLabel((byMuscle[m] || []).length)}</div>
                </div>
                <GIcon name="chevR" size={15} style={{ color: 'var(--text-3)' }} />
              </button>
            ))}
          </div>
        </>)}
      </>) : (<>
        <div className="gt-card" style={{ padding: '14px 12px 10px' }}>
          <MuscleMap selected={selected} maxWidth={96} />
        </div>
        <div className="gt-card" style={{ marginTop: 12, padding: '4px 16px' }}>
          {list.length === 0 && <div className="gt-sub" style={{ padding: '14px 0' }}>{t('library.empty')}</div>}
          {list.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)', opacity: e.active === false ? 0.55 : 1 }}>
              <div style={{ flex: 1 }}>
                <div className="gt-body" style={{ fontWeight: 700, fontSize: 13.5 }}>{e.name}</div>
                <div className="gt-micro">{e.unit}{e.isBasic ? t('settings.bigLift') : ''}{e.active === false ? ' · ' + t('library.archived') : ''}</div>
              </div>
              <button className="gt-iconbtn" style={{ color: 'var(--text-2)' }} onClick={() => setEditing({ ...e })} aria-label={t('settings.editExercise', { name: e.name })}><GIcon name="edit" size={14} /></button>
            </div>
          ))}
        </div>
        <button className="gt-btn gt-btn-ghost" style={{ width: '100%', marginTop: 12, minHeight: 46 }} onClick={() => setAdding({ name: '', unit: 'kg' })}>
          <GIcon name="plus" size={16} />{t('settings.addExercise')}
        </button>
      </>)}

      {/* Edit exercise */}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={t('settings.editSheet')}>
        {editing ? (<>
          <div className="gt-micro" style={{ margin: '0 0 5px 4px' }}>{t('settings.nameLabel')}</div>
          <input className="gt-input" aria-label={t('settings.exerciseName')} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <div className="gt-micro" style={{ margin: '14px 0 7px 4px' }}>{t('settings.muscleCaps')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {muscles.map((m) => <button key={m} className={'gt-chip' + (editing.muscle === m ? ' on' : '')} aria-pressed={editing.muscle === m} onClick={() => setEditing({ ...editing, muscle: m })}>{muscleName(m)}</button>)}
          </div>
          <div className="gt-micro" style={{ margin: '14px 0 7px 4px' }}>{t('settings.unitCaps')}</div>
          <UnitChips value={editing.unit} onChange={(u) => setEditing({ ...editing, unit: u })} />
          <button className="gt-btn gt-btn-primary" style={{ width: '100%', marginTop: 18 }} onClick={async () => {
            if (editing.name.trim()) await store.saveExercise({ ...editing, name: editing.name.trim() });
            setEditing(null);
          }}>{t('common.save')}</button>
        </>) : null}
      </Sheet>

      {/* New exercise for the open muscle */}
      <Sheet open={!!adding} onClose={() => setAdding(null)} title={t('library.addSheet', { muscle: selected ? muscleName(selected) : '' })}>
        {adding ? (<>
          <div className="gt-micro" style={{ margin: '0 0 5px 4px' }}>{t('settings.nameLabel')}</div>
          <input className="gt-input" aria-label={t('settings.exerciseName')} value={adding.name} autoFocus onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <div className="gt-micro" style={{ margin: '14px 0 7px 4px' }}>{t('settings.unitCaps')}</div>
          <UnitChips value={adding.unit} onChange={(u) => setAdding({ ...adding, unit: u })} />
          <button className="gt-btn gt-btn-primary" style={{ width: '100%', marginTop: 18 }} disabled={!adding.name.trim()} onClick={async () => {
            await store.addExercise({ name: adding.name.trim(), muscle: selected, unit: adding.unit });
            setAdding(null);
          }}>{t('settings.addExercise')}</button>
        </>) : null}
      </Sheet>
    </div>
  );
}

const rowStyle = { width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 2px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' };
