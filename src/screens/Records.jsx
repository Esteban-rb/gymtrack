// GymTrack — Records: medal gallery (standards for big lifts, personal progression for the rest).
import React, { useState } from 'react';
import { useStore } from '../store.js';
import { MEDALS, PROGRESSION_STEPS, fmtWeight, fmtDate } from '../calc.js';
import { MedalBadge, MEDAL_COLORS, Sheet, SectionHead, EmptyState } from '../components.jsx';

function nextThreshold(ex, pr, lvl, bodyweightKg) {
  if (lvl >= 4) return null;
  if (ex.isBasic && ex.standards) {
    const ratio = ex.standards[lvl + 1];
    return { label: MEDALS[lvl + 1], value: Math.round(ratio * bodyweightKg) + ' kg est. 1RM (' + ratio + '× BW)' };
  }
  if (!pr) return { label: 'Bronze', value: 'Log your first set' };
  const target = pr.baselineKg * (1 + PROGRESSION_STEPS[lvl + 1]);
  return { label: MEDALS[lvl + 1], value: '+' + Math.round(PROGRESSION_STEPS[lvl + 1] * 100) + '% vs first session (' + (+target.toFixed(1)) + ' kg)' };
}

function RecordCard({ ex, pr, lvl, onOpen }) {
  return (
    <button className="gt-card" onClick={onOpen} style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, cursor: 'pointer', font: 'inherit', color: 'inherit', WebkitTapHighlightColor: 'transparent' }}>
      <MedalBadge level={lvl} size={56} />
      <div>
        <div className="gt-body" style={{ fontWeight: 800, fontSize: 13, lineHeight: 1.25 }}>{ex.name}</div>
        <div className="gt-micro" style={{ marginTop: 3, color: lvl >= 0 ? MEDAL_COLORS[lvl] : 'var(--text-3)' }}>{lvl >= 0 ? MEDALS[lvl] : 'Locked'}</div>
      </div>
      {pr ? <div className="gt-num" style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 500 }}>{fmtWeight(pr.value, pr.unit)} × {pr.reps}</div> : <div className="gt-micro">No sets yet</div>}
    </button>
  );
}

export default function RecordsScreen() {
  const store = useStore();
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
  const selNext = sel ? nextThreshold(sel, selPr, selLvl, profile.bodyweightKg) : null;

  const grid = (list) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {list.map((e) => <RecordCard key={e.id} ex={e} pr={prs[e.id]} lvl={store.medalLevel(e.id)} onOpen={() => setOpen(e.id)} />)}
    </div>
  );

  return (
    <div className="gt-scroll" style={{ height: '100%', padding: '18px 16px 150px' }}>
      <div className="gt-h1" style={{ marginBottom: 4 }}>Records</div>
      <div className="gt-sub">Bronze → Diamond. Earn them all.</div>

      {!hasAny ? (
        <div className="gt-card" style={{ marginTop: 18 }}>
          <EmptyState icon="medal" title="Medals await" body="Every exercise has 5 levels. Log your first workout to start earning Bronze." />
        </div>
      ) : (
        <>
          <SectionHead>Strength standards · big lifts</SectionHead>
          <div className="gt-micro" style={{ margin: '-4px 2px 10px' }}>Based on est. 1RM vs body weight ({profile.age} y · {profile.bodyweightKg} kg) — thresholds editable in Settings</div>
          {grid(compounds)}
          {others.length > 0 && (<>
            <SectionHead>Personal progression</SectionHead>
            <div className="gt-micro" style={{ margin: '-4px 2px 10px' }}>Based on your own improvement vs your first session</div>
            {grid(others)}
          </>)}
          {lockedOthers.length > 0 && (<>
            <SectionHead>Not yet started</SectionHead>
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
            <div className="gt-h2" style={{ marginTop: 6, color: selLvl >= 0 ? MEDAL_COLORS[selLvl] : 'var(--text-3)' }}>{selLvl >= 0 ? MEDALS[selLvl] : 'Locked'}</div>
            {selPr ? (
              <div className="gt-sub" style={{ marginTop: 6 }}>
                PR: <span className="gt-num" style={{ fontSize: 15, color: 'var(--text)' }}>{fmtWeight(selPr.value, selPr.unit)} × {selPr.reps}</span> · {fmtDate(selPr.date)}
              </div>
            ) : <div className="gt-sub" style={{ marginTop: 6 }}>No sets logged yet</div>}
            {selPr ? <div className="gt-micro" style={{ marginTop: 5 }}>Est. 1RM {Math.round(selPr.oneRm)} kg · real load {(+selPr.kg.toFixed(1))} kg</div> : null}
            {selNext ? (
              <div className="gt-card" style={{ marginTop: 16, padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}>
                <MedalBadge level={selLvl + 1} size={38} />
                <div>
                  <div className="gt-body" style={{ fontWeight: 800, fontSize: 13.5 }}>Next: {selNext.label}</div>
                  <div className="gt-micro" style={{ marginTop: 2 }}>{selNext.value}</div>
                </div>
              </div>
            ) : (
              <div className="gt-card" style={{ marginTop: 16, padding: '13px 16px' }}>
                <div className="gt-body" style={{ fontWeight: 800, fontSize: 13.5, color: 'var(--diamond)' }}>Maxed out — Diamond achieved 💎</div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
