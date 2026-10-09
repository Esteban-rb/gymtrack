// @vitest-environment jsdom
// Spanish render of the whole app shell: every main tab, its sheets and overlays, in
// empty and populated states. Asserts representative Spanish strings and the absence of
// English UI markers. User/DB data (routine names, exercise names) is deliberately not
// translated, so the English-marker list only contains words that belong to the UI.
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { PeriodFinishOverlay } from './components.jsx';
import TodayScreen from './screens/Today.jsx';
import { db, ensureSeeded } from './db.js';
import { useStore } from './store.js';
import { I18nProvider } from './i18n.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENGLISH = [
  /\bWorkouts\b/, /\bSettings\b/, /\bMetrics\b/, /\bMesocycle\b/i, /\bStreak\b/, /\bTonnage\b/, /\bAdherence\b/,
  /\bBody weight\b/, /\bLoading\b/, /\bRest day\b/, /\bPreview\b/, /\bLog set\b/, /\bAdd set\b/, /\bFinish\b/,
  /\bCancel\b/, /\bConfirm\b/, /\bArchive\b/, /\bImport\b/, /\bCycle\b/, /\bcycles?\b/, /\bsets?\b/i, /\bSETS\b/,
  /\bMedal\b/i, /\bBronze\b/, /\bSilver\b/, /\bGold\b/, /\bPlatinum\b/, /\bDiamond\b/, /\bLocked\b/, /\bToday\b/,
  /\bNext:/, /\bLast session\b/, /\bAppearance\b/, /\bTheme\b/, /\bProfile\b/, /\bHistory\b/, /\bDone\b/,
  /\bUndo\b/, /\bSave\b/, /\bCurrent\b/, /\bBest\b/, /\bDays\b/, /\bFront\b/, /\bBack\b/,
];
let root, host;
const text = () => host.textContent || '';
function expectClean(label) {
  const content = text();
  for (const pattern of ENGLISH) expect(content, `${label}: English leak ${pattern}`).not.toMatch(pattern);
}
const click = (selector) => act(() => {
  const el = document.querySelector(selector);
  if (!el) throw new Error('not found: ' + selector);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
const clickButtonText = (label) => act(() => {
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(label));
  if (!el) throw new Error('no button: ' + label);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
const waitFor = (cond, label) => vi.waitFor(() => { if (!cond()) throw new Error('timeout waiting for ' + label); }, { timeout: 4000 });
const tab = async (label, marker) => { click(`[aria-label="${label}"]`); await waitFor(() => text().includes(marker), label); };

beforeAll(async () => {
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  await db.delete(); await db.open(); await ensureSeeded();
  await db.profile.update(1, {
    name: 'Spanish smoke user', sex: 'prefer_not_to_say', heightCm: 170,
    setupRequired: false, setupSkipped: true, preferences: { units: 'kg' },
  });
  useStore.setState({ loaded: false });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root.render(<I18nProvider locale="es"><App /></I18nProvider>));
});
afterAll(async () => { await act(async () => root.unmount()); host.remove(); });

describe('app in Spanish', () => {
  it('Home and the tab bar are Spanish in the empty state', async () => {
    await waitFor(() => text().includes('Entrenamientos'), 'Home');
    expect(text()).toContain('Aún no hay récords');
    expect(text()).toContain('Ciclo 1');
    expect(text()).toContain('Inicio');
    expect(document.querySelector('nav').getAttribute('aria-label')).toBe('Principal');
    expectClean('home');
  });

  it('Today, Metrics, Records and Settings are Spanish in the empty state', async () => {
    await tab('Hoy', 'SERIES');
    expect(text()).toContain('Progreso del ciclo');
    expect(text()).toContain('Registrar primera serie');
    expectClean('today');
    await tab('Métricas', 'Aún no hay datos');
    expectClean('metrics empty');
    await tab('Récords', 'Las medallas te esperan');
    expect(text()).toContain('Bronce → Diamante');
    expectClean('records empty');
    await tab('Ajustes', 'Fecha de inicio');
    for (const label of ['Meta de ciclos', 'Apariencia', 'Tema', 'COLOR DE ACENTO', 'Auto-finalizar', 'Umbrales de medallas', 'Datos', 'Copia JSON', 'Importar', 'Historial de sesiones']) {
      expect(text(), label).toContain(label);
    }
    expectClean('settings');
  });

  it('Settings confirmations, sheets and import messages are Spanish', async () => {
    await clickButtonText('Terminar y archivar');
    await waitFor(() => text().includes('¿Archivar el bloque'), 'archive confirm');
    expect(text()).toContain('Cancelar');
    expectClean('archive confirm');
    await clickButtonText('Cancelar');
    click('[aria-label="editar Incline Press"]');
    await waitFor(() => text().includes('Editar ejercicio'), 'edit sheet');
    expect(text()).toContain('GRUPO MUSCULAR');
    expect(text()).toContain('Pecho');
    expectClean('edit exercise');
    click('[aria-label="cerrar Editar ejercicio"]');
    await clickButtonText('Umbrales de medallas');
    await waitFor(() => text().includes('Objetivos de 1RM estimado'), 'medal sheet');
    expect(text()).toContain('BRON');
    expectClean('medal sheet');
    click('[aria-label="cerrar Umbrales de medallas"]');

    window.confirm = () => true;
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'bad.json', text: async () => '{broken' }] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await waitFor(() => text().includes('Error al importar:'), 'import failure message');
    expectClean('import failure');
  });

  it('Today logging, finishing and the overlay are Spanish', async () => {
    const store = useStore.getState();
    const w = await act(() => store.createWorkout('U1'));
    await act(() => useStore.getState().logSet(w.id, 'incline-press', { value: 20, reps: 10, unit: 'kgx2' }));
    await tab('Hoy', 'SERIES');
    expect(text()).toContain('1 serie');
    expect(text()).toContain('Primera vez: define tu base');
    expect(text()).toContain('Terminar y avanzar');
    expectClean('today with set');
    await clickButtonText('Cambiar');
    await waitFor(() => text().includes('Cambiar ciclo o rutina'), 'variant sheet');
    expect(text()).toContain('Pendiente');
    expectClean('variant sheet');
    click('[aria-label="cerrar Cambiar ciclo o rutina"]');
    click('[aria-label="cambiar ejercicio"]');
    await waitFor(() => text().includes('Cambiar ejercicio por hoy'), 'swap sheet');
    expectClean('swap sheet');
    click('[aria-label="cerrar Cambiar ejercicio por hoy"]');
    await clickButtonText('Terminar y avanzar');
    await waitFor(() => document.querySelector('[role="dialog"][aria-label="Entrenamiento completado"]'), 'finish overlay');
    expect(text()).toContain('ENTRENAMIENTO COMPLETADO');
    expect(text()).toContain('Récords personales');
    expectClean('finish overlay');
    await clickButtonText('Listo');
    await waitFor(() => text().includes('Entrenamiento completado'), 'finished card');
    expect(text()).toContain('Aún puedes editar las series.');
    expectClean('today finished');
  });

  it('Home, streak, Metrics, Records and History are Spanish with data', async () => {
    await tab('Inicio', 'Entrenamientos');
    expect(text()).toContain('× 10 reps');
    expect(text()).toContain('Récord ·');
    expect(text()).toContain('Progreso');
    expectClean('home data');
    click('[aria-label="abrir racha"]');
    await waitFor(() => text().includes('ACTUAL'), 'streak sheet');
    expect(text()).toContain('Últimas 12 semanas');
    expect(text()).toContain('hoy ya está registrado');
    expectClean('streak');
    click('[aria-label="cerrar Racha"]');
    await tab('Métricas', 'Tonelaje por ciclo');
    for (const label of ['Ciclos completados', 'Adherencia', 'Progreso por músculo', 'Mapa de medallas por músculo', 'Reparto de volumen', 'Peso corporal']) {
      expect(text(), label).toContain(label);
    }
    expectClean('metrics data');
    await clickButtonText('+ Registrar');
    await waitFor(() => text().includes('Registrar peso corporal'), 'body weight sheet');
    expectClean('body weight sheet');
    click('[aria-label="cerrar Registrar peso corporal"]');
    await tab('Récords', 'Estándares de fuerza');
    expectClean('records data');
    await act(async () => document.querySelector('button.gt-card').click());
    await waitFor(() => document.querySelector('[role="dialog"]'), 'record sheet');
    expectClean('record sheet');
    await act(async () => document.querySelector('[role="dialog"] button[aria-label^="cerrar"]').click());
    await tab('Ajustes', 'Fecha de inicio');
    click('[aria-label="abrir historial"]');
    await waitFor(() => text().includes('Bloque actual'), 'history');
    expect(text()).toContain('Bloque actual');
    expectClean('history');
    await act(async () => { document.querySelector('button.gt-card:not([disabled])').click(); });
    await waitFor(() => text().includes('SERIE 1'), 'history sheet');
    expect(text()).toContain('borrar una serie');
    expectClean('history sheet');
  });

  it('medal toast and the block-complete overlay are Spanish', async () => {
    await act(async () => useStore.setState({ medalUnlock: { level: 2, exercise: { name: 'Incline Press' } } }));
    expect(text()).toContain('Oro desbloqueada');
    await act(async () => useStore.setState({ medalUnlock: null }));
    const summary = { startDate: '2026-01-05', cyclesDone: 2, cycleGoal: 6, workouts: 12, sets: 90, volume: 54000, medals: [1, 0, 2, 0, 0], gains: [{ id: 'a', name: 'Incline Press', pct: 12, from: 40, to: 45 }] };
    const local = document.body.appendChild(document.createElement('div'));
    const r = createRoot(local);
    await act(async () => r.render(<I18nProvider locale="es"><PeriodFinishOverlay summary={summary} onClose={() => {}} /></I18nProvider>));
    const content = local.textContent;
    for (const label of ['BLOQUE DE ENTRENAMIENTO COMPLETADO', 'Ciclos completados', 'SESIONES', 'SERIES', 'Mayor progreso', 'Vitrina de medallas', 'Empezar el siguiente bloque']) {
      expect(content, label).toContain(label);
    }
    expect(content).not.toMatch(/\b(Cycles|Sessions|MESOCYCLE|Medal cabinet|Top progress|Start the next)\b/);
    await act(async () => r.unmount());
    local.remove();
  });
});

describe('loading screen in Spanish', () => {
  it('shows the Spanish loading text before the store is ready', async () => {
    const original = useStore.getState().init;
    await act(async () => useStore.setState({ loaded: false, init: async () => {} }));
    expect(text()).toContain('Cargando tus datos de entrenamiento…');
    expect(text()).not.toMatch(/Loading/);
    await act(async () => useStore.setState({ loaded: true, init: original }));
  });
});

describe('Today pinned-session states in Spanish', () => {
  it('explains an unavailable pinned session in Spanish', async () => {
    const local = document.body.appendChild(document.createElement('div'));
    const r = createRoot(local);
    await act(async () => r.render(<I18nProvider locale="es"><TodayScreen pinnedSession={{ workoutId: 99999, periodId: 99999 }} onReturn={() => {}} /></I18nProvider>));
    expect(local.textContent).toContain('Sesión fijada no disponible');
    expect(local.textContent).toContain('Vuelve a la revisión');
    expect(local.textContent).not.toMatch(/\b(pinned|unavailable|Return to review)\b/i);
    await act(async () => r.unmount());
    local.remove();
  });
});
