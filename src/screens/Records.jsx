// GymTrack — Records: medal gallery (standards for big lifts, personal progression for the rest).
import React, { useState } from 'react';
import { useStore } from '../store.js';
import { useShallow } from 'zustand/react/shallow';
import { PROGRESSION_STEPS } from '../calc.js';
import { MedalBadge, MEDAL_COLORS, Sheet, SectionHead, EmptyState } from '../components.jsx';
import { useT } from '../i18n.js';

function nextThreshold(ex, pr, lvl, bodyweightKg, t, medal) {
  if (lvl >= 4) return null;
  if (ex.isBasic && ex.standards) {
    const ratio = ex.standards[lvl + 1];
    return { label: medal(lvl + 1), value: t('records.nextStandard', { kg: Math.round(ratio * bodyweightKg), ratio }) };
  }
  if (!pr) return { label: medal(0), value: t('records.nextFirst') };
  const target = pr.baselineKg * (1 + PROGRESSION_STEPS[lvl + 1]);
  return { label: medal(lvl + 1), value: t('records.nextProgress', { pct: Math.round(PROGRESSION_STEPS[lvl + 1] * 100), kg: +target.toFixed(1) }) };
}

function RecordCard({ ex, pr, lvl, onOpen }) {
  const { t, weight, medal } = useT();
  return (
    <button className="gt-card" onClick={onOpen} style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, cursor: 'pointer', font: 'inherit', color: 'inherit', WebkitTapHighlightColor: 'transparent' }}>
      <MedalBadge level={lvl} size={56} />
      <div>
        <div className="gt-body" style={{ fontWeight: 800, fontSize: 13, lineHeight: 1.25 }}>{ex.name}</div>
        <div className="gt-micro" style={{ marginTop: 3, color: lvl >= 0 ? MEDAL_COLORS[lvl] : 'var(--text-3)' }}>{lvl >= 0 ? medal(lvl) : t('medal.locked')}</div>
      </div>
      {pr ? <div className="gt-num" style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 500 }}>{weight(pr.value, pr.unit)} × {pr.reps}</div> : <div className="gt-micro">{t('records.noSets')}</div>}
    </button>
  );
}

export default function RecordsScreen() {
  const { t, date, weight, medal } = useT();
  const store = useStore(useShallow((state) => ({ exercises: state.exercises, prs: state.prs, profile: state.profile, medalLevel: state.medalLevel })));
  const { exercises, prs, profile } = store;
  const [open, setOpen] = useState(null);

  const active = exercises.filter((e) => e.active !== false);
  const compounds = active.filter((e) => e.isBasic && e.standards);
  const others = active.filter((e) => !(e.isBasic && e.standards) && prs[e.id]);
  const lockedOthers = active.filter((e) => !(e.isBasic && e.standards) && !prs[e.id]);
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
          <SectionHead>{t('records.standards')}</SectionHead>
          <div className="gt-micro" style={{ margin: '-4px 2px 10px' }}>{t('records.standardsNote', { age: profile.age, bw: profile.bodyweightKg })}</div>
          {grid(compounds)}
          {others.length > 0 && (<>
            <SectionHead>{t('records.progression')}</SectionHead>
            <div className="gt-micro" style={{ margin: '-4px 2px 10px' }}>{t('records.progressionNote')}</div>
            {grid(others)}
          </>)}
          {lockedOthers.length > 0 && (<>
            <SectionHead>{t('records.notStarted')}</SectionHead>
            {grid(lockedOthers)}
          </>)}
        </>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={sel ? sel.name : ''}>
        {sel && (
          <div style={{ textAlign: 'center', paddingBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
              <MedalBadge level={selLvl} size={110} animate={true} />
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
                <div className="gt-body" style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--diamond)' }}>{t('records.maxed')}</div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
