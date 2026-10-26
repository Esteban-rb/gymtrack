// GymTrack — anatomical body map. Two figures (front and back) whose muscles are
// colored by the average medal level of that muscle group's exercises.
// The geometry lives in bodypaths.js; this file only decides what color each
// shape takes and draws the medal legend underneath.
import React from 'react';
import { MEDALS } from './calc.js';
import { MedalBadge } from './components.jsx';
import { useT } from './i18n.js';
import { FRENTE, ESPALDA, SILUETA_FRENTE, SILUETA_ESPALDA, VIEWBOX_FRENTE, VIEWBOX_ESPALDA } from './bodypaths.js';

// Tier vars, not literal hexes: the shapes carry their opacity in the `opacity`
// attribute, so a theme (e.g. the Mono accent) can restyle the whole map by
// redefining the tokens.
export const MEDAL_HEX = ['var(--bronze)', 'var(--silver)', 'var(--gold)', 'var(--platinum)', 'var(--diamond)', 'var(--obsidian)'];

function fillFor(group, levels) {
  if (!group || levels[group] == null) return 'var(--chart-muted)';
  return MEDAL_HEX[Math.max(0, Math.min(5, Math.round(levels[group])))];
}

function Figure({ shapes, outline, viewBox, levels, label }) {
  const { t } = useT();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg viewBox={viewBox} style={{ width: '100%', maxWidth: 150, display: 'block' }} aria-label={t('bodymap.aria', { label })}>
        {/* the body outline shows through at neck, hands, feet and joints */}
        <path d={outline} fill="var(--input-bg)" stroke="var(--chart-muted)" strokeWidth="2" strokeLinejoin="round" />
        {shapes.map((s, i) => (
          <path key={i} d={s.d} fill={fillFor(s.g, levels)} opacity={s.g && levels[s.g] != null ? 0.95 : 0.5} />
        ))}
      </svg>
      <div className="gt-micro">{label.toUpperCase()}</div>
    </div>
  );
}

/** levels: { [muscleGroup]: averageMedalLevel (0..4 float) } — groups absent = untrained. */
export default function BodyMap({ levels }) {
  const { t, medal } = useT();
  const trained = MEDALS.map((_, lvl) => lvl).filter((lvl) =>
    Object.values(levels).some((v) => Math.round(v) === lvl));
  return (
    <div>
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
        <Figure shapes={FRENTE} outline={SILUETA_FRENTE} viewBox={VIEWBOX_FRENTE} levels={levels} label={t('bodymap.front')} />
        <Figure shapes={ESPALDA} outline={SILUETA_ESPALDA} viewBox={VIEWBOX_ESPALDA} levels={levels} label={t('bodymap.back')} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
        {MEDALS.map((_, lvl) => (
          <div key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: trained.includes(lvl) ? 1 : 0.35 }}>
            <MedalBadge level={lvl} size={22} />
            <span className="gt-micro">{medal(lvl)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Selector: same figures, but muscles are tappable and one can be highlighted ---------- */
function PickFigure({ shapes, outline, viewBox, selected, onSelect, label, maxWidth }) {
  const { t } = useT();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg viewBox={viewBox} style={{ width: '100%', maxWidth, display: 'block' }} aria-label={t('bodymap.aria', { label })}>
        <path d={outline} fill="var(--input-bg)" stroke="var(--chart-muted)" strokeWidth="2" strokeLinejoin="round" />
        {shapes.map((s, i) => {
          const on = s.g && s.g === selected;
          return (
            <path key={i} d={s.d}
              fill={!s.g ? 'var(--chart-muted)' : on ? 'var(--accent)' : 'var(--chart-4)'}
              opacity={!s.g ? 0.35 : on ? 1 : selected ? 0.55 : 0.85}
              style={{ cursor: s.g && onSelect ? 'pointer' : 'default', transition: 'opacity 0.2s ease, fill 0.2s ease' }}
              onClick={s.g && onSelect ? () => onSelect(s.g) : undefined} />
          );
        })}
      </svg>
      <div className="gt-micro">{label.toUpperCase()}</div>
    </div>
  );
}

/** selected: muscle group to highlight · onSelect(group): makes the muscles tappable. */
export function MuscleMap({ selected = null, onSelect, maxWidth = 150 }) {
  const { t } = useT();
  return (
    <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
      <PickFigure shapes={FRENTE} outline={SILUETA_FRENTE} viewBox={VIEWBOX_FRENTE} selected={selected} onSelect={onSelect} label={t('bodymap.front')} maxWidth={maxWidth} />
      <PickFigure shapes={ESPALDA} outline={SILUETA_ESPALDA} viewBox={VIEWBOX_ESPALDA} selected={selected} onSelect={onSelect} label={t('bodymap.back')} maxWidth={maxWidth} />
    </div>
  );
}
