// GymTrack — anatomical body map. Two mirrored half-figures (front/back) in the style of
// the user's reference image: a neutral silhouette with each muscle as a separate shape,
// colored by the average medal level of that muscle group's exercises.
import React from 'react';
import { MEDALS } from './calc.js';
import { MedalBadge } from './components.jsx';

// Solid hexes (not CSS vars) so shapes can carry their own opacity reliably.
export const MEDAL_HEX = ['#CD8A52', '#C2CBD6', '#F5C242', '#AFE6DC', '#6FD2FF'];

/* Every shape below is the LEFT half of a symmetric figure on a 160×345 canvas
 * (center line x=80); the component renders each twice, mirrored. */

// Whole-body half silhouette (head → arm → hand → torso → leg → foot → center line).
const SILHOUETTE =
  'M80 4 C70 4 64 12 64 23 C64 31 67 38 71 43 L71 50 ' +
  'C62 53 50 55 45 60 C37 66 34 75 33 84 C30 96 27 112 24 130 C22 142 21 152 21 158 ' +
  'C18 166 19 174 22 176 C26 178 30 172 31 164 L33 156 ' +
  'C35 144 39 122 44 104 L48 96 ' +
  'C50 108 52 120 54 130 C55 140 56 148 58 156 ' +
  'C54 168 52 186 52 204 C52 226 55 244 60 258 ' +
  'C60 268 58 282 58 296 C58 308 60 318 62 324 ' +
  'C60 330 58 334 60 338 L72 338 C73 332 72 326 71 322 ' +
  'C73 310 74 296 73 284 C72 272 72 264 73 258 ' +
  'C76 246 78 232 79 218 C80 204 80 188 79 176 L80 170 L80 4 Z';

// ---- FRONT view muscles (g = muscle group key, null = always neutral) ----
const FRONT = [
  // upper traps visible from the front
  { g: 'Back', d: 'M71 45 C66 49 56 53 48 56 C56 54 66 52 73 51 C72 49 71 47 71 45 Z' },
  // neck strap
  { g: null, d: 'M74 40 C74 45 73 49 76 52 L79 52 L79 41 C77 41 75 41 74 40 Z' },
  // deltoid
  { g: 'Shoulders', d: 'M47 58 C40 61 36 68 35 78 C35 82 37 84 40 84 C45 80 49 72 51 63 C50 60 49 58 47 58 Z' },
  // pectoral
  { g: 'Chest', d: 'M78 54 C68 55 59 59 56 65 C54 73 60 81 69 83 C73 84 77 83 78 81 L78 54 Z' },
  // biceps
  { g: 'Biceps', d: 'M41 86 C38 93 36 100 38 108 C42 110 46 105 48 97 C49 91 48 87 46 84 C44 84 42 84 41 86 Z' },
  // forearm (no group in the catalog → neutral)
  { g: null, d: 'M36 112 C32 124 29 136 28 148 L33 150 C37 138 41 124 43 112 C41 109 38 109 36 112 Z' },
  // rectus abdominis: 4 stacked blocks
  { g: 'Abs', d: 'M71 88 C68 88 67 89 67 91 L67 99 C67 101 68 102 71 102 L78 102 L78 88 Z' },
  { g: 'Abs', d: 'M71 105 C68 105 67 106 67 108 L67 115 C67 117 68 118 71 118 L78 118 L78 105 Z' },
  { g: 'Abs', d: 'M71 121 C68 121 67 122 67 124 L67 130 C67 132 68 133 71 133 L78 133 L78 121 Z' },
  { g: 'Abs', d: 'M71 136 C68 136 67 137 67 140 L68 152 C70 158 74 162 78 163 L78 136 Z' },
  // obliques
  { g: 'Abs', d: 'M63 90 C60 102 59 116 61 128 C62 136 64 144 66 149 L65 134 L64 112 L64 92 Z' },
  // quads: outer sweep, rectus femoris, inner teardrop
  { g: 'Quads', d: 'M58 164 C53 182 51 206 54 228 C56 240 59 248 62 252 C64 244 65 230 64 213 C63 195 61 177 61 165 C60 164 59 163 58 164 Z' },
  { g: 'Quads', d: 'M66 165 C63 185 63 211 65 232 C66 242 68 248 70 250 C73 244 74 231 74 213 C74 192 71 175 69 165 C68 164 67 164 66 165 Z' },
  { g: 'Quads', d: 'M77 214 C74 226 74 238 76 247 C78 251 81 248 81 238 C81 228 80 219 79 215 Z' },
  // inner thigh / adductor strip (counts toward quads day)
  { g: 'Quads', d: 'M76 166 C74 178 73 192 75 204 C76 209 78 208 78 199 L78 167 Z' },
  // tibialis + inner calf edge seen from the front
  { g: 'Calves', d: 'M61 264 C59 280 59 296 62 310 C64 314 66 311 67 303 C68 289 67 275 65 263 C63 262 62 262 61 264 Z' },
  { g: 'Calves', d: 'M71 263 C69 275 69 288 71 298 C73 302 75 298 75 288 C75 277 74 268 73 262 Z' },
];

// ---- BACK view muscles ----
const BACK = [
  // trapezius kite
  { g: 'Back', d: 'M79 44 L62 57 C70 60 76 70 78 88 L79 88 L79 44 Z' },
  // rear deltoid
  { g: 'Shoulders', d: 'M47 58 C40 61 36 68 35 78 C35 82 37 84 40 84 C45 80 49 72 51 63 C50 60 49 58 47 58 Z' },
  // scapular muscles (infraspinatus/teres)
  { g: 'Back', d: 'M58 62 C54 68 53 76 56 84 C62 84 70 80 74 72 C72 66 66 62 58 62 Z' },
  // lats
  { g: 'Back', d: 'M56 88 C54 100 56 112 62 124 C68 132 74 136 78 137 L78 96 C70 94 62 92 56 88 Z' },
  // erector columns
  { g: 'Back', d: 'M72 126 C70 126 69 127 69 130 L69 152 C69 156 71 158 74 159 L78 160 L78 126 Z' },
  // triceps
  { g: 'Triceps', d: 'M41 86 C38 93 36 100 38 108 C42 110 46 105 48 97 C49 91 48 87 46 84 C44 84 42 84 41 86 Z' },
  // forearm
  { g: null, d: 'M36 112 C32 124 29 136 28 148 L33 150 C37 138 41 124 43 112 C41 109 38 109 36 112 Z' },
  // glutes
  { g: 'Glutes', d: 'M62 160 C56 167 54 177 56 187 C60 195 70 197 78 193 C79 184 79 170 78 163 C73 159 66 158 62 160 Z' },
  // hamstrings: outer + inner strips
  { g: 'Hamstrings', d: 'M58 200 C55 216 55 233 58 248 C61 254 64 251 66 243 C67 229 66 211 64 200 C62 198 60 198 58 200 Z' },
  { g: 'Hamstrings', d: 'M70 200 C68 216 68 234 70 248 C73 254 76 249 77 239 C78 224 76 208 74 199 C72 197 71 198 70 200 Z' },
  // gastrocnemius twin heads
  { g: 'Calves', d: 'M60 262 C57 276 58 292 62 304 C65 308 68 303 69 293 C70 279 68 267 66 261 C64 259 61 259 60 262 Z' },
  { g: 'Calves', d: 'M72 262 C70 274 70 288 73 300 C76 304 78 297 78 287 C78 274 76 264 75 260 Z' },
];

function fillFor(group, levels) {
  if (!group || levels[group] == null) return 'var(--chart-muted)';
  return MEDAL_HEX[Math.max(0, Math.min(4, Math.round(levels[group])))];
}

function Figure({ shapes, levels, label }) {
  const half = (mirror) => (
    <g transform={mirror ? 'translate(160,0) scale(-1,1)' : undefined}>
      <path d={SILHOUETTE} fill="var(--input-bg)" />
      {shapes.map((s, i) => (
        <path key={i} d={s.d} fill={fillFor(s.g, levels)} opacity={s.g && levels[s.g] != null ? 0.95 : 0.5}
          stroke="var(--bg)" strokeWidth="1.4" strokeLinejoin="round" />
      ))}
    </g>
  );
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg viewBox="0 0 160 345" style={{ width: '100%', maxWidth: 150, display: 'block' }} aria-label={label + ' muscle map'}>
        {half(false)}
        {half(true)}
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
        <Figure shapes={FRONT} levels={levels} label="Front" />
        <Figure shapes={BACK} levels={levels} label="Back" />
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
