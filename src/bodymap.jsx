// GymTrack — anatomical body map. Two figures (front and back) whose muscles are
// colored by the average medal level of that muscle group's exercises.
// The geometry lives in bodypaths.js; this file only decides what color each
// shape takes and draws the medal legend underneath.
import React from 'react';
import { MEDALS } from './calc.js';
import { MedalBadge } from './components.jsx';
import { FRENTE, ESPALDA, SILUETA_FRENTE, SILUETA_ESPALDA, VIEWBOX_FRENTE, VIEWBOX_ESPALDA } from './bodypaths.js';

// Tier vars, not literal hexes: the shapes carry their opacity in the `opacity`
// attribute, so a theme (e.g. the Mono accent) can restyle the whole map by
// redefining the tokens.
export const MEDAL_HEX = ['var(--bronze)', 'var(--silver)', 'var(--gold)', 'var(--platinum)', 'var(--diamond)'];

function fillFor(group, levels) {
  if (!group || levels[group] == null) return 'var(--chart-muted)';
  return MEDAL_HEX[Math.max(0, Math.min(4, Math.round(levels[group])))];
}

function Figure({ shapes, outline, viewBox, levels, label }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg viewBox={viewBox} style={{ width: '100%', maxWidth: 150, display: 'block' }} aria-label={label + ' muscle map'}>
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
  const trained = MEDALS.map((_, lvl) => lvl).filter((lvl) =>
    Object.values(levels).some((v) => Math.round(v) === lvl));
  return (
    <div>
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
        <Figure shapes={FRENTE} outline={SILUETA_FRENTE} viewBox={VIEWBOX_FRENTE} levels={levels} label="Front" />
        <Figure shapes={ESPALDA} outline={SILUETA_ESPALDA} viewBox={VIEWBOX_ESPALDA} levels={levels} label="Back" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
        {MEDALS.map((name, lvl) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: trained.includes(lvl) ? 1 : 0.35 }}>
            <MedalBadge level={lvl} size={22} />
            <span className="gt-micro">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
