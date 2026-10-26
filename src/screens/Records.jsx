// GymTrack — Records: medal gallery (standards for big lifts, personal progression for the rest).
import React, { useState } from 'react';
import { useStore } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { PROGRESSION_STEPS } from '../calc.js';
import { MUSCLES } from '../db.js';
import { MedalBadge, MEDAL_COLORS, Sheet, SectionHead, EmptyState } from '../components.jsx';
import { useT } from '../i18n.js';

function nextThreshold(ex, pr, lvl, bodyweightKg, t, medal) {
  if (lvl >= 5) return null;
  if (ex.isBasic && ex.standards) {
    const ratio = ex.standards[lvl + 1];
    return { label: medal(lvl + 1), value: t('records.nextStandard', { kg: Math.round(ratio * bodyweightKg), ratio }) };
  }
  if (!pr) return { label: medal(0), value: t('records.nextFirst') };
  const target = pr.baselineKg * (1 + PROGRESSION_STEPS[lvl + 1]);
  return { label: medal(lvl + 1), value: t('records.nextProgress', { pct: Math.round(PROGRESSION_STEPS[lvl + 1] * 100), kg: +target.toFixed(1) }) };
}

/** Medal level plus the fraction of the way to the next one, so equal medals still rank. */
function progressScore(ex, pr, lvl, bodyweightKg) {
  if (lvl < 0 || !pr) return -1;
  if (lvl >= 5) return 5;
  let frac = 0;
  if (ex.isBasic && ex.standards && bodyweightKg) {
    const cur = ex.standards[lvl] * bodyweightKg, next = ex.standards[lvl + 1] * bodyweightKg;
    frac = (pr.oneRm - cur) / (next - cur);
  } else if (pr.baselineKg) {
    const gain = (pr.kg - pr.baselineKg) / pr.baselineKg;
    frac = (gain - PROGRESSION_STEPS[lvl]) / (PROGRESSION_STEPS[lvl + 1] - PROGRESSION_STEPS[lvl]);
  }
  return lvl + Math.min(0.99, Math.max(0, frac));
}

function Podium({ entries, onOpen }) {
  const { t, medal } = useT();
  // classic podium order: 2nd · 1st · 3rd
  const slots = [entries[1], entries[0], entries[2]].map((e, i) => (e ? { ...e, rank: [2, 1, 3][i] } : null));
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', justifyContent: 'center' }}>
      {slots.map((e, i) => e ? (
        <button key={e.ex.id} className="gt-card" onClick={() => onOpen(e.ex.id)} aria-label={t('records.topAria', { rank: e.rank, name: e.ex.name })}
          style={{ flex: e.rank === 1 ? 1.25 : 1, minWidth: 0, padding: e.rank === 1 ? '12px 4px 14px' : '10px 4px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center', cursor: 'pointer', font: 'inherit', color: 'inherit', WebkitTapHighlightColor: 'transparent', marginBottom: e.rank === 1 ? 0 : 0 }}>
          <div className="gt-num" style={{ fontSize: 13, color: e.rank === 1 ? 'var(--text)' : 'var(--text-3)' }}>#{e.rank}</div>
          <MedalBadge level={e.lvl} size={e.rank === 1 ? 52 : 40} laurel />
          <div className="gt-body" style={{ fontWeight: 800, fontSize: 12, lineHeight: 1.2, padding: '0 4px', overflowWrap: 'anywhere' }}>{e.ex.name}</div>
          <div className="gt-micro" style={{ color: MEDAL_COLORS[e.lvl] }}>{medal(e.lvl)}</div>
        </button>
      ) : <div key={i} style={{ flex: 1 }} />)}
    </div>
  );
}

function RecordCard({ ex, pr, lvl, onOpen }) {
  const { t, weight, medal } = useT();
  return (
    <button className="gt-card" onClick={onOpen} style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, cursor: 'pointer', font: 'inherit', color: 'inherit', WebkitTapHighlightColor: 'transparent' }}>
      <MedalBadge level={lvl} size={52} laurel />
      <div>
        <div className="gt-body" style={{ fontWeight: 800, fontSize: 13, lineHeight: 1.25 }}>{ex.name}</div>
        <div className="gt-micro" style={{ marginTop: 3, color: lvl >= 0 ? MEDAL_COLORS[lvl] : 'var(--text-3)' }}>{lvl >= 0 ? medal(lvl) : t('medal.locked')}</div>
      </div>
      {pr ? <div className="gt-num" style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 500 }}>{weight(pr.value, pr.unit)} × {pr.reps}</div> : <div className="gt-micro">{t('records.noSets')}</div>}
    </button>
  );
}

export default function RecordsScreen() {
  const { t, date, weight, medal, muscle: muscleName } = useT();
  const store = useStore(useShallow((state) => ({ exercises: state.exercises, prs: state.prs, profile: state.profile, medalLevel: state.medalLevel })));
  const { exercises, prs, profile } = store;
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('muscle');   // 'muscle' | 'quality'

  const active = exercises.filter((e) => e.active !== false);
  const levelOf = (e) => store.medalLevel(e.id);
  const top = active.map((e) => ({ ex: e, lvl: levelOf(e), score: progressScore(e, prs[e.id], levelOf(e), profile.bodyweightKg) }))
    .filter((e) => e.lvl >= 0).sort((a, b) => b.score - a.score).slice(0, 3);
  const muscleOrder = [...MUSCLES, ...new Set(active.map((e) => e.muscle).filter((m) => m && !MUSCLES.includes(m)))];
  const hasAny = Object.keys(prs).length > 0;

  const sel = open ? active.find((e) => e.id === open) : null;
  const selPr = sel ? prs[sel.id] : null;
  const selLvl = sel ? store.medalLevel(sel.id) : -1;
  const selNext = sel ? nextThreshold(sel, selPr, selLvl, profile.bodyweightKg, t, medal) : null;

  const grid = (list) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {list.map((e) => <RecordCard key={e.id} ex={e} pr={prs[e.id]} lvl={store.medalLevel(e.id)} onOpen={() => setOpen(e.id)} />)}
    </div>
  );

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <h1 className="gt-h1" style={{ marginBottom: 4 }}>{t('records.title')}</h1>
      <div className="gt-sub">{t('records.sub')}</div>

      {!hasAny ? (
        <div className="gt-card" style={{ marginTop: 18 }}>
          <EmptyState icon="medal" title={t('records.emptyTitle')} body={t('records.emptyBody')} />
        </div>
      ) : (
        <>
          <SectionHead big>{t('records.top3')}</SectionHead>
          <Podium entries={top} onOpen={setOpen} />

          <div style={{ display: 'flex', gap: 8, marginTop: 22 }} role="group" aria-label={t('records.viewAria')}>
            {[['muscle', t('records.viewMuscle')], ['quality', t('records.viewQuality')]].map(([k, label]) => (
              <button key={k} className={'gt-chip' + (view === k ? ' on' : '')} style={{ flex: 1 }} aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
            ))}
          </div>

          {view === 'muscle' ? muscleOrder.map((m) => {
            const list = active.filter((e) => e.muscle === m).sort((a, b) => levelOf(b) - levelOf(a));
            return list.length ? (<React.Fragment key={m}><SectionHead big>{muscleName(m)}</SectionHead>{grid(list)}</React.Fragment>) : null;
          }) : [5, 4, 3, 2, 1, 0, -1].map((l) => {
            const list = active.filter((e) => levelOf(e) === l);
            return list.length ? (<React.Fragment key={l}><SectionHead big>{l >= 0 ? medal(l) : t('records.notStarted')}</SectionHead>{grid(list)}</React.Fragment>) : null;
          })}
          <div className="gt-micro" style={{ margin: '18px 2px 0' }}>{t('records.standardsNote', { age: profile.age, bw: profile.bodyweightKg })}</div>
        </>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={sel ? sel.name : ''}>
        {sel && (
          <div style={{ textAlign: 'center', paddingBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
              <MedalBadge level={selLvl} size={96} animate={true} laurel />
            </div>
            <div className="gt-h2" style={{ marginTop: 6, color: selLvl >= 0 ? MEDAL_COLORS[selLvl] : 'var(--text-3)' }}>{selLvl >= 0 ? medal(selLvl) : t('medal.locked')}</div>
            {selPr ? (
              <div className="gt-sub" style={{ marginTop: 6 }}>
                {t('records.pr')} <span className="gt-num" style={{ fontSize: 15, color: 'var(--text)' }}>{weight(selPr.value, selPr.unit)} × {selPr.reps}</span> · {date(selPr.date)}
              </div>
            ) : <div className="gt-sub" style={{ marginTop: 6 }}>{t('records.noSetsLogged')}</div>}
            {selPr ? <div className="gt-micro" style={{ marginTop: 5 }}>{t('records.est', { oneRm: Math.round(selPr.oneRm), kg: +selPr.kg.toFixed(1) })}</div> : null}
            {selNext ? (
              <div className="gt-card" style={{ marginTop: 16, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
                <MedalBadge level={selLvl + 1} size={38} />
                <div>
                  <div className="gt-body" style={{ fontWeight: 800, fontSize: 13.5 }}>{t('records.next', { label: selNext.label })}</div>
                  <div className="gt-micro" style={{ marginTop: 2 }}>{selNext.value}</div>
                </div>
              </div>
            ) : (
              <div className="gt-card" style={{ marginTop: 16, padding: '13px 16px' }}>
                <div className="gt-body" style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--obsidian)' }}>{t('records.maxed')}</div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
