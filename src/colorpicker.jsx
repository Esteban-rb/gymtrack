// GymTrack — color picker: saturation/brightness canvas + hue slider + HEX field.
import React, { useEffect, useRef, useState } from 'react';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function hexToHsv(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { h: 0, s: 0, v: 1 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Drag area helper: reports 0..1 coordinates inside the element. */
function useDrag(onMove, onEnd) {
  const ref = useRef(null);
  const handler = (ev) => {
    const r = ref.current.getBoundingClientRect();
    onMove(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
  };
  return {
    ref,
    onPointerDown: (ev) => { ev.currentTarget.setPointerCapture?.(ev.pointerId); handler(ev); },
    onPointerMove: (ev) => { if (ev.buttons || ev.pressure > 0) handler(ev); },
    onPointerUp: () => onEnd?.(),
    style: { touchAction: 'none' },
  };
}

/** value: '#RRGGBB' · onChange(hex) fires live while dragging; onCommit(hex) when the gesture ends. */
export default function ColorPicker({ value, onChange, onCommit, hexLabel = 'HEX' }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [draft, setDraft] = useState(null);
  const latest = useRef(hsv);
  useEffect(() => { // follow outside changes (e.g. tapping a preset) without losing hue on greys
    const next = hexToHsv(value);
    if (hsvToHex(latest.current) !== (value || '').toUpperCase()) { latest.current = next; setHsv(next); }
  }, [value]);
  const apply = (next) => { latest.current = next; setHsv(next); onChange?.(hsvToHex(next)); };
  const end = () => onCommit?.(hsvToHex(latest.current));
  const sv = useDrag((x, y) => apply({ ...latest.current, s: x, v: 1 - y }), end);
  const hue = useDrag((x) => apply({ ...latest.current, h: x * 360 }), end);
  const hex = hsvToHex(hsv);

  return (
    <div style={{ background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 22, overflow: 'hidden', maxWidth: 340, margin: '0 auto' }}>
      <div {...sv} role="slider" aria-label="saturation and brightness" aria-valuetext={hex}
        style={{ ...sv.style, position: 'relative', height: 190, cursor: 'crosshair',
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))` }}>
        <div style={{ position: 'absolute', left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: '50%', border: '3px solid #fff', background: hex, boxShadow: '0 0 0 1.5px rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 14px 6px' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: hex, flexShrink: 0, border: '1px solid var(--border-strong)' }} />
        <div {...hue} role="slider" aria-label="hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)}
          style={{ ...hue.style, position: 'relative', flex: 1, height: 10, borderRadius: 99, cursor: 'pointer',
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}>
          <div style={{ position: 'absolute', left: `${(hsv.h / 360) * 100}%`, top: '50%', width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: '50%', border: '3px solid #fff', background: `hsl(${hsv.h}, 100%, 50%)`, boxShadow: '0 0 0 1.5px rgba(0,0,0,0.45)', pointerEvents: 'none' }} />
        </div>
      </div>
      <div style={{ padding: '8px 14px 12px', textAlign: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: '0 14px', height: 46 }}>
          <span className="gt-sub">#</span>
          <input className="gt-num" aria-label={hexLabel} value={draft ?? hex.slice(1)} maxLength={6} spellCheck={false} autoCapitalize="characters"
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase();
              setDraft(v);
              if (v.length === 6) { const next = hexToHsv(v); latest.current = next; setHsv(next); onChange?.('#' + v); onCommit?.('#' + v); }
            }}
            onBlur={() => setDraft(null)}
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 18, letterSpacing: '0.08em' }} />
        </label>
        <div className="gt-micro" style={{ marginTop: 8, letterSpacing: '0.12em' }}>{hexLabel}</div>
      </div>
    </div>
  );
}
