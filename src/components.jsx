// GymTrack — shared UI (icons, medals, charts, tab bar, inputs), ported from the design prototype.
import React, { useEffect, useRef, useState } from 'react';
import { BASE_UNITS, splitUnit, joinUnit, MEDALS, fmtDate } from './calc.js';

/* ============ Icons (24px stroke set) ============ */
export function GIcon({ name, size = 22, stroke = 1.8, style }) {
  const P = (d) => <path d={d} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />;
  const paths = {
    dumbbell: <g>{P('M7 8v8M4.5 9.5v5M17 8v8M19.5 9.5v5M7 12h10')}</g>,
    chart: <g>{P('M4 19h16M7 16v-5M12 16V7M17 16v-8')}</g>,
    medal: <g><circle cx="12" cy="14" r="5" fill="none" stroke="currentColor" strokeWidth={stroke} />{P('M8.5 10 6 4h4l2 4.5L14 4h4l-2.5 6')}</g>,
    clock: <g><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth={stroke} />{P('M12 7.5V12l3 2')}</g>,
    gear: <g><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth={stroke} />{P('M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6')}</g>,
    plus: <g>{P('M12 5.5v13M5.5 12h13')}</g>,
    minus: <g>{P('M5.5 12h13')}</g>,
    check: <g>{P('M5 12.5l4.5 4.5L19 7.5')}</g>,
    chevR: <g>{P('M9 5.5l7 6.5-7 6.5')}</g>,
    chevL: <g>{P('M15 5.5 8 12l7 6.5')}</g>,
    chevD: <g>{P('M5.5 9.5 12 16l6.5-6.5')}</g>,
    chevU: <g>{P('M5.5 14.5 12 8l6.5 6.5')}</g>,
    x: <g>{P('M6 6l12 12M18 6 6 18')}</g>,
    trash: <g>{P('M5 7h14M10 7V5h4v2M8 7l.8 12h6.4L16 7M10.5 10.5v5M13.5 10.5v5')}</g>,
    edit: <g>{P('M5 19h14M14.5 4.5l3 3L9 16l-4 1 1-4z')}</g>,
    flame: <g>{P('M12 4c1 3-3 4.5-3 8a3.9 3.9 0 0 0 3 4c-0.5-2 2-2.5 2-5 2 1.5 3 3 3 5a5 5 0 0 1-10 0c0-5 5-7 5-12z')}</g>,
    swap: <g>{P('M7 9h11l-3-3M17 15H6l3 3')}</g>,
    download: <g>{P('M12 4v10m0 0 4-4m-4 4-4-4M5 19h14')}</g>,
    upload: <g>{P('M12 14V4m0 0 4 4m-4-4L8 8M5 19h14')}</g>,
    calendar: <g><rect x="4" y="6" width="16" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth={stroke} />{P('M4 10.5h16M8.5 4v3.5M15.5 4v3.5')}</g>,
    trophy: <g>{P('M8 5h8v5a4 4 0 0 1-8 0zM8 6H5.5a3 3 0 0 0 3 4M16 6h2.5a3 3 0 0 1-3 4M12 14v3.5M8.5 20h7M12 17.5V20')}</g>,
    target: <g><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth={stroke} /><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth={stroke} /><circle cx="12" cy="12" r="1" fill="currentColor" /></g>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true">{paths[name] || null}</svg>;
}

/* ============ Medal badge — ornate emblem tiers (ring + crown + petals) ============ */
export const MEDAL_COLORS = ['var(--bronze)', 'var(--silver)', 'var(--gold)', 'var(--platinum)', 'var(--diamond)'];
const MEDAL_TINTS = [
  { l: '#EBB585', m: '#CD8A52', d: '#955C30' },   // bronze
  { l: '#EDF2F7', m: '#C2CBD6', d: '#8E99A8' },   // silver
  { l: '#FFE08A', m: '#F5C242', d: '#C8901D' },   // gold
  { l: '#E3FAF4', m: '#AFE6DC', d: '#74BFB1' },   // platinum
  { l: '#CDEDFF', m: '#6FD2FF', d: '#3D9BD6' },   // diamond
];
// Ornamentation grows with tier: Bronze = ring · Silver = +crown · Gold = +wings ·
// Platinum = +2nd petals · Diamond = full lotus + gem.
export function MedalBadge({ level, size = 44, animate = false }) {
  const locked = level < 0;
  const t = locked ? { l: '#8A8F98', m: '#62687260', d: '#3A3E45' } : MEDAL_TINTS[level];
  const gid = 'mg' + (locked ? 'x' : level);
  const stroke = { stroke: locked ? 'var(--text-3)' : t.d, strokeWidth: 0.9, strokeLinejoin: 'round' };
  const petal = (a, key, len = 1) => (
    <path key={key} d={'M32 ' + (10 - (len - 1) * 3) + ' C36 ' + (15 - (len - 1) * 2) + ' 36.5 20 32 24.5 C27.5 20 28 ' + (15 - (len - 1) * 2) + ' 32 ' + (10 - (len - 1) * 3) + ' Z'} transform={'rotate(' + a + ' 32 36)'} fill={'url(#' + gid + ')'} {...stroke} />
  );
  const petals = [];
  if (!locked && level >= 2) petals.push(petal(-64, 'w1'), petal(64, 'w2'));
  if (!locked && level >= 3) petals.push(petal(-98, 'p1', 0.85), petal(98, 'p2', 0.85));
  if (!locked && level >= 4) petals.push(petal(-34, 'l1', 0.8), petal(34, 'l2', 0.8));
  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0, animation: animate ? 'gt-pop 0.5s cubic-bezier(.2,1.4,.4,1)' : undefined }} aria-hidden="true">
      {!locked && <div style={{ position: 'absolute', inset: '-4%', borderRadius: '50%', background: 'radial-gradient(circle, ' + t.m + ' 0%, transparent 68%)', opacity: 0.28 }} />}
      <svg width={size} height={size} viewBox="0 0 64 64" style={{ position: 'relative' }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={t.l} />
            <stop offset="0.55" stopColor={t.m} />
            <stop offset="1" stopColor={t.d} />
          </linearGradient>
        </defs>
        {petals}
        {!locked && level >= 1 && (<g>
          <path d="M25 19.5 26.8 11.5 30.4 16 32 9.5 33.6 16 37.2 11.5 39 19.5 Z" fill={'url(#' + gid + ')'} {...stroke} />
          <circle cx="26.8" cy="10.6" r="1.5" fill={t.l} {...stroke} />
          <circle cx="32" cy="8.4" r="1.6" fill={t.l} {...stroke} />
          <circle cx="37.2" cy="10.6" r="1.5" fill={t.l} {...stroke} />
          {level >= 4 && <path d="M32 12.4 34 14.8 32 17.2 30 14.8 Z" fill="#FFFFFF" opacity="0.95" />}
        </g>)}
        <circle cx="32" cy="36" r="14.5" fill="none" stroke={locked ? 'var(--border-strong)' : 'url(#' + gid + ')'} strokeWidth="6" strokeDasharray={locked ? '3.2 3.2' : 'none'} />
        {!locked && <circle cx="32" cy="36" r="17.4" fill="none" stroke={t.d} strokeWidth="0.9" />}
        {!locked && <circle cx="32" cy="36" r="11.6" fill="none" stroke={t.d} strokeWidth="0.9" />}
        {!locked && <path d="M25.8 48.2 Q32 53.4 38.2 48.2 L36.8 55 Q32 58 27.2 55 Z" fill={'url(#' + gid + ')'} {...stroke} />}
        {!locked && <path d="M23.5 22.5 24.6 26 28 27 24.6 28 23.5 31.5 22.4 28 19 27 22.4 26 Z" fill="#FFFFFF" opacity="0.92" />}
        {locked && <path d="M27.5 34.5 v-2.5 a4.5 4.5 0 0 1 9 0 v2.5 M26 34.5 h12 v8.5 h-12 z" fill="none" stroke="var(--text-3)" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
    </div>
  );
}

/* ============ Progress bar ============ */
export function ProgressBar({ value, max, height = 8, color = 'var(--accent)' }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ height, borderRadius: 999, background: 'var(--input-bg)', overflow: 'hidden' }}>
      <div style={{ width: pct + '%', height: '100%', borderRadius: 999, background: color, transition: 'width 0.5s cubic-bezier(.4,0,.2,1)' }} />
    </div>
  );
}

/* ============ Stepper (+/- buttons; the number itself is a numeric input) ============ */
export function Stepper({ value, onChange, step = 1, min = 0, format, width = 132 }) {
  const [text, setText] = useState(null); // null = not editing; string = live keyboard entry
  const commit = () => {
    if (text == null) return;
    const v = parseFloat(text.replace(',', '.'));
    if (!isNaN(v)) onChange(Math.max(min, +v.toFixed(2)));
    setText(null);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--input-bg)', borderRadius: 14, border: '1px solid var(--border)', height: 48, width }}>
      <button className="gt-iconbtn" style={{ border: 'none', background: 'transparent', width: 42, height: 46 }} onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))} aria-label="decrease"><GIcon name="minus" size={18} /></button>
      <input
        className="gt-num"
        type="text" inputMode="decimal" enterKeyHint="done"
        value={text != null ? text : String(format ? format(value) : value)}
        onFocus={(e) => { setText(String(value)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 19, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', padding: 0 }}
        aria-label="value" />
      <button className="gt-iconbtn" style={{ border: 'none', background: 'transparent', width: 42, height: 46 }} onClick={() => onChange(+(value + step).toFixed(2))} aria-label="increase"><GIcon name="plus" size={18} /></button>
    </div>
  );
}

/* ============ Unit chips: base unit + ×2 modifier (per-side, kg/lb only) ============ */
export function UnitChips({ value, onChange }) {
  const { base, dbl } = splitUnit(value);
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {BASE_UNITS.map((u) => (
        <button key={u} className={'gt-chip' + (base === u ? ' on' : '')} onClick={() => onChange(joinUnit(u, dbl))}>{u}</button>
      ))}
      <button
        className={'gt-chip' + (dbl ? ' on' : '')}
        style={base === 'plates' ? { opacity: 0.35, cursor: 'default' } : undefined}
        onClick={() => base !== 'plates' && onChange(joinUnit(base, !dbl))}
        aria-label="per-side, doubled">×2</button>
    </div>
  );
}

/* ============ Bottom sheet ============ */
export function Sheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', animation: 'gt-fade 0.2s ease' }} />
      <div style={{ position: 'relative', background: 'var(--sheet-bg)', borderRadius: '26px 26px 0 0', border: '1px solid var(--border)', borderBottom: 'none', padding: '12px 20px 34px', animation: 'gt-slide-up 0.28s cubic-bezier(.2,1,.4,1)', maxHeight: '78%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: 40, height: 4.5, borderRadius: 99, background: 'var(--border-strong)', margin: '0 auto 14px' }} />
        {title ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="gt-h2">{title}</div>
            <button className="gt-iconbtn" style={{ width: 36, height: 36, minWidth: 36 }} onClick={onClose} aria-label="close"><GIcon name="x" size={17} /></button>
          </div>
        ) : null}
        <div className="gt-scroll" style={{ flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

/* ============ Charts (SVG) ============ */
export function BarChart({ data, height = 130, accentIndex = -1, labelKey = 'label', valueKey = 'value', fmtVal = (v) => Math.round(v / 100) / 10 + 'k' }) {
  const W = 300, H = height, pad = 4, lblH = 18;
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  const bw = Math.min(34, (W - pad * 2) / Math.max(1, data.length) - 8);
  return (
    <svg viewBox={'0 0 ' + W + ' ' + (H + lblH)} style={{ width: '100%', display: 'block' }}>
      {data.map((d, i) => {
        const x = pad + (i + 0.5) * ((W - pad * 2) / data.length);
        const h = Math.max(3, (d[valueKey] / max) * (H - 24));
        const hot = i === accentIndex;
        return (
          <g key={i}>
            <rect x={x - bw / 2} y={H - h} width={bw} height={h} rx={Math.min(8, bw / 2.6)} fill={hot ? 'var(--accent)' : 'var(--chart-muted)'} />
            {hot ? <text x={x} y={H - h - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)" fontFamily="Oswald">{fmtVal(d[valueKey])}</text> : null}
            <text x={x} y={H + 13} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--text-3)" fontFamily="Manrope">{d[labelKey]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({ data, height = 120, valueKey = 'kg', labelKey = 'week', fmtLabel = (l) => 'W' + l, fmtVal = (v) => v }) {
  const W = 300, H = height, padX = 14, padY = 16, lblH = 16;
  if (!data.length) return null;
  const vals = data.map((d) => d[valueKey]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const x = (i) => padX + (data.length === 1 ? (W - padX * 2) / 2 : i * ((W - padX * 2) / (data.length - 1)));
  const y = (v) => padY + (1 - (v - min) / span) * (H - padY * 2);
  const pts = data.map((d, i) => x(i) + ',' + y(d[valueKey])).join(' ');
  const last = data.length - 1;
  return (
    <svg viewBox={'0 0 ' + W + ' ' + (H + lblH)} style={{ width: '100%', display: 'block' }}>
      {[0.25, 0.5, 0.75].map((t) => <line key={t} x1={padX} x2={W - padX} y1={padY + t * (H - padY * 2)} y2={padY + t * (H - padY * 2)} stroke="var(--chart-grid)" strokeWidth="1" />)}
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d[valueKey])} r={i === last ? 5 : 3.2} fill={i === last ? 'var(--accent)' : 'var(--surface-solid)'} stroke="var(--accent)" strokeWidth="2" />
          <text x={x(i)} y={H + 12} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--text-3)" fontFamily="Manrope">{fmtLabel(d[labelKey])}</text>
        </g>
      ))}
      <text x={x(last)} y={y(vals[last]) - 10} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--text)" fontFamily="Oswald">{fmtVal(vals[last])}</text>
    </svg>
  );
}

export const DONUT_COLORS = ['var(--accent)', '#FF8A5C', '#FFC15C', 'var(--chart-muted)', '#8B93A1', '#5C6470', '#3E444E', '#2C3138'];
export function Donut({ data, size = 130, thickness = 16 }) {
  const total = data.reduce((a, b) => a + b.kg, 0) || 1;
  const R = (size - thickness) / 2, C = size / 2;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size}>
      {data.map((d, i) => {
        const frac = d.kg / total;
        const a0 = acc * 2 * Math.PI - Math.PI / 2; acc += frac;
        const a1 = acc * 2 * Math.PI - Math.PI / 2;
        const large = frac > 0.5 ? 1 : 0;
        const x0 = C + R * Math.cos(a0), y0 = C + R * Math.sin(a0);
        const x1 = C + R * Math.cos(a1), y1 = C + R * Math.sin(a1);
        if (frac >= 0.999) return <circle key={i} cx={C} cy={C} r={R} fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={thickness} />;
        return <path key={i} d={`M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`} fill="none" stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={thickness} strokeLinecap="butt" />;
      })}
    </svg>
  );
}

/* ============ Confetti ============ */
export function Confetti({ run }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!run || !ref.current) return;
    const cv = ref.current, ctx = cv.getContext('2d');
    const w = (cv.width = cv.offsetWidth * 2), h = (cv.height = cv.offsetHeight * 2);
    const colors = ['#FF3B30', '#F5C242', '#6FD2FF', '#32D74B', '#FFFFFF', '#FF8A5C'];
    const parts = Array.from({ length: 130 }, () => ({
      x: Math.random() * w, y: -40 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 3, vy: 3 + Math.random() * 5,
      s: 6 + Math.random() * 9, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    let raf, t = 0;
    const tick = () => {
      t++;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.04;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (t < 360) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [run]);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }} />;
}

/* ============ Mesocycle-complete celebration overlay (counts cycles, not weeks) ============ */
export function PeriodFinishOverlay({ summary, onClose }) {
  const medalTotal = summary.medals.reduce((a, b) => a + b, 0);
  const goal = summary.cycleGoal || 6;
  const done = summary.cyclesDone ?? goal;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'var(--bg)', display: 'flex', flexDirection: 'column', animation: 'gt-fade 0.25s ease', overflow: 'hidden' }}>
      <Confetti run={true} />
      <div className="gt-scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '60px 24px 120px', position: 'relative', zIndex: 6 }}>
        <div style={{ width: 86, height: 86, borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'gt-pop 0.55s cubic-bezier(.2,1.4,.4,1)' }}>
          <GIcon name="trophy" size={42} stroke={2} />
        </div>
        <div className="gt-display" style={{ marginTop: 22, fontSize: 32 }}>MESOCYCLE COMPLETE</div>
        <div className="gt-sub" style={{ marginTop: 8, maxWidth: 280, lineHeight: 1.5 }}>
          {done} Upper/Lower cycles since {fmtDate(summary.startDate)}. Here's what you built.
        </div>

        {/* big cycle count */}
        <div className="gt-card" style={{ width: '100%', maxWidth: 320, marginTop: 24, padding: 20 }}>
          <div className="gt-num" style={{ fontSize: 56, lineHeight: 1, color: 'var(--accent)' }}>{done}<span style={{ fontSize: 22, color: 'var(--text-3)' }}> / {goal}</span></div>
          <div className="gt-label" style={{ marginTop: 6 }}>Cycles completed</div>
          <div style={{ display: 'flex', gap: 5, marginTop: 14 }}>
            {Array.from({ length: goal }, (_, i) => (
              <div key={i} style={{ flex: 1, height: 8, borderRadius: 999, background: i < done ? 'var(--accent)' : 'var(--input-bg)' }} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12, width: '100%', maxWidth: 320 }}>
          {[['Sessions', summary.workouts], ['Sets', summary.sets], ['Tonnage', (summary.volume / 1000).toFixed(1) + 't']].map(([l, v]) => (
            <div key={l} className="gt-card" style={{ flex: 1, padding: '14px 8px' }}>
              <div className="gt-num" style={{ fontSize: 24 }}>{v}</div>
              <div className="gt-micro" style={{ marginTop: 3 }}>{l.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {summary.gains.length > 0 && (
          <div className="gt-card" style={{ marginTop: 12, width: '100%', maxWidth: 320, padding: '14px 16px', textAlign: 'left' }}>
            <div className="gt-label" style={{ color: 'var(--accent)', marginBottom: 8 }}>Top progress</div>
            {summary.gains.map((g) => (
              <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                <div className="gt-body" style={{ fontWeight: 700, flex: 1, minWidth: 0 }}>{g.name}</div>
                <div className="gt-num" style={{ fontSize: 15, color: 'var(--text-2)' }}>{g.from}→{g.to} kg</div>
                <div className="gt-num" style={{ fontSize: 15, color: 'var(--success)', width: 56, textAlign: 'right' }}>+{g.pct}%</div>
              </div>
            ))}
          </div>
        )}

        {medalTotal > 0 && (
          <div className="gt-card" style={{ marginTop: 12, width: '100%', maxWidth: 320, padding: '14px 16px' }}>
            <div className="gt-label" style={{ marginBottom: 10 }}>Medal cabinet</div>
            <div style={{ display: 'flex', justifyContent: 'space-around' }}>
              {summary.medals.map((count, lvl) => count > 0 && (
                <div key={lvl} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <MedalBadge level={lvl} size={40} />
                  <div className="gt-micro">{count}× {MEDALS[lvl].toUpperCase()}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', left: 20, right: 20, bottom: 28, zIndex: 7 }}>
        <button className="gt-btn gt-btn-primary" style={{ width: '100%', minHeight: 54, fontSize: 16 }} onClick={onClose}>Start the next mesocycle</button>
      </div>
    </div>
  );
}

/* ============ Tab bar ============ */
export const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'records', label: 'Records' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];
// Redesigned bottom-bar icons (from the Claude Design handoff).
function TabIcon({ id }) {
  const glyph = {
    today: <path d="M6.5 9.3v5.4M9 7.8v8.4M15 7.8v8.4M17.5 9.3v5.4M9 12h6" />,
    metrics: <g><path d="M4 18.5h15" opacity="0.45" /><path d="M5 14.4l4.3-4.2 3 2.6 5.2-6" /><circle cx="17.5" cy="6.8" r="1.55" fill="currentColor" stroke="none" /></g>,
    records: <g><path d="M9.4 9.7 7.4 3.5M14.6 9.7 16.6 3.5" /><circle cx="12" cy="14.5" r="5.2" /><path d="M12 11.6l1 2 2.2.3-1.6 1.55.38 2.2L12 16.6l-1.98 1.05.38-2.2-1.6-1.55 2.2-.3z" /></g>,
    history: <g><path d="M4.2 11.4a8 8 0 1 0 2.2-5.9" /><path d="M3.4 4.2v3.6h3.6" /><path d="M12 8.4V12l2.8 1.8" /></g>,
    settings: <g><path d="M4 8h8M16.5 8H20" /><circle cx="14.2" cy="8" r="2.2" /><path d="M4 16h3.8M12.3 16H20" /><circle cx="9.8" cy="16" r="2.2" /></g>,
  }[id];
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {glyph}
    </svg>
  );
}
export function TabBar({ tab, onChange }) {
  return (
    <div style={{ position: 'fixed', left: 14, right: 14, bottom: 'calc(14px + env(safe-area-inset-bottom))', zIndex: 40, display: 'flex', gap: 4, padding: 6, borderRadius: 999, background: 'var(--tabbar-bg)', border: '1px solid var(--border)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', boxShadow: '0 10px 30px rgba(0,0,0,0.35)', maxWidth: 520, margin: '0 auto' }}>
      {TABS.map((t) => {
        const on = tab === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} aria-label={t.label} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 0 6px',
            borderRadius: 999, border: 'none', cursor: 'pointer', minHeight: 48,
            background: on ? 'var(--accent)' : 'transparent',
            color: on ? 'var(--on-accent)' : 'var(--text-2)', transition: 'background 0.2s ease, color 0.2s ease',
            WebkitTapHighlightColor: 'transparent',
          }}>
            <TabIcon id={t.id} />
            <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.02em', fontFamily: 'Manrope' }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ============ Section header ============ */
export function SectionHead({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '20px 2px 10px' }}>
      <div className="gt-label">{children}</div>
      {right || null}
    </div>
  );
}

/* ============ Empty state ============ */
export function EmptyState({ icon = 'dumbbell', title, body, cta, onCta }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '44px 28px', gap: 12 }}>
      <div style={{ width: 72, height: 72, borderRadius: 24, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
        <GIcon name={icon} size={32} />
      </div>
      <div className="gt-h2" style={{ marginTop: 4 }}>{title}</div>
      <div className="gt-sub" style={{ maxWidth: 230, lineHeight: 1.5 }}>{body}</div>
      {cta ? <button className="gt-btn gt-btn-primary" style={{ marginTop: 8 }} onClick={onCta}>{cta}</button> : null}
    </div>
  );
}
