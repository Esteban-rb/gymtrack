// GymTrack — app shell: bootstrap, theme + accent, tab navigation, medal-unlock toast.
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from './store.js';
import { MEDALS } from './calc.js';
import { TabBar, TABS, MedalBadge, MEDAL_COLORS, PeriodFinishOverlay } from './components.jsx';
import TodayScreen from './screens/Today.jsx';
import MetricsScreen from './screens/Metrics.jsx';
import RecordsScreen from './screens/Records.jsx';
import SettingsScreen from './screens/Settings.jsx';

function MedalToast() {
  const { medalUnlock, dismissMedal } = useStore();
  useEffect(() => {
    if (!medalUnlock) return;
    try { navigator.vibrate && navigator.vibrate([14, 60, 20]); } catch { /* unsupported */ }
    const t = setTimeout(dismissMedal, 4000);
    return () => clearTimeout(t);
  }, [medalUnlock, dismissMedal]);
  if (!medalUnlock) return null;
  return (
    <div onClick={dismissMedal} style={{ position: 'fixed', left: 16, right: 16, top: 'calc(16px + env(safe-area-inset-top))', zIndex: 80, display: 'flex', justifyContent: 'center', animation: 'gt-slide-up 0.35s cubic-bezier(.2,1.2,.4,1)' }}>
      <div className="gt-card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', maxWidth: 420, width: '100%' }}>
        <MedalBadge level={medalUnlock.level} size={52} animate={true} />
        <div>
          <div className="gt-label" style={{ color: MEDAL_COLORS[medalUnlock.level] }}>{MEDALS[medalUnlock.level]} unlocked</div>
          <div className="gt-body" style={{ fontWeight: 800, marginTop: 2 }}>{medalUnlock.exercise?.name}</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const store = useStore();
  const [tab, setTab] = useState(() => {
    // fall back to 'today' if the stored tab no longer exists (e.g. the removed History tab)
    try {
      const t = localStorage.getItem('gymtrack_tab');
      return TABS.some((x) => x.id === t) ? t : 'today';
    } catch { return 'today'; }
  });
  useEffect(() => { store.init(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('gymtrack_tab', tab); } catch { /* private mode */ } }, [tab]);

  const dark = store.profile?.theme !== 'light';
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0B0C0E' : '#F1F2F5');
    // keep the browser's own rendering in sync with the in-app theme: native controls
    // (select popups, keyboard), overscroll areas, and Android Chrome's auto-dark heuristic
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.style.background = dark ? '#0B0C0E' : '#F1F2F5';
    document.body.style.background = dark ? '#0B0C0E' : '#F1F2F5';
  }, [dark]);

  // custom accent (Settings → Appearance) overrides the theme's default red;
  // bright accents flip the on-accent text to dark so buttons stay readable
  const accent = store.profile?.accent;
  const accentVars = useMemo(() => {
    if (!/^#[0-9a-fA-F]{6}$/.test(accent || '')) return undefined;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return {
      '--accent': accent,
      '--accent-press': `color-mix(in srgb, ${accent} 82%, #000)`,
      '--accent-soft': `rgba(${r},${g},${b},0.16)`,
      '--on-accent': lum > 0.62 ? '#14161A' : '#FFFFFF',
    };
  }, [accent]);

  if (!store.loaded) {
    return <div className="gt-app" style={{ position: 'fixed', inset: 0 }} />;
  }

  return (
    <div className={'gt-app' + (dark ? '' : ' light')} style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...accentVars }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', maxWidth: 520, width: '100%', margin: '0 auto', paddingTop: 'env(safe-area-inset-top)' }}>
        {tab === 'today' && <TodayScreen />}
        {tab === 'metrics' && <MetricsScreen />}
        {tab === 'records' && <RecordsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </div>
      <TabBar tab={tab} onChange={setTab} />
      <MedalToast />
      {store.periodCelebration ? <PeriodFinishOverlay summary={store.periodCelebration} onClose={store.dismissPeriodCelebration} /> : null}
    </div>
  );
}
