// @vitest-environment jsdom
// Rotation pointer rules: the cycle must not roll over while variants are still
// pending (jumping the order with "Change" used to skip a cycle ahead), and
// setActiveCycle must be able to walk back to a cycle that still has work left.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { useStore } from './store.js';
import { db } from './db.js';
import { cycleRange } from './screens/Today.jsx';

const store = () => useStore.getState();

/** Log one set on `code` and finish it, creating today's session if needed. */
async function runSession(code) {
  await store().setActiveVariant(code);
  let w = store().todayWorkout();
  if (!w || w.finished) w = await store().createWorkout(code);
  await store().logSet(w.id, w.entries[0].exerciseId, { value: 20, reps: 10, unit: 'kg' });
  await store().finishWorkout(w.id);
}

const pos = () => store().period.rotationPos;
const cycle = () => store().period.cycle;
const codeAt = (i) => store().variants[i].code;

describe('cycle picker range', () => {
  it('offers exactly the cycles of the goal set in Settings', () => {
    expect(cycleRange(6, 1, [1])).toHaveLength(6);
    expect(cycleRange(4, 1, [1])).toHaveLength(4);
    expect(cycleRange(8, 3, [1, 2, 3])).toHaveLength(8);
  });

  it('does not grow when you land on the last cycle', () => {
    // tocar el último ciclo ya no genera uno nuevo: el rango es el mismo
    expect(cycleRange(6, 6, [1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cycleRange(6, 6, [1, 2, 3, 4, 5, 6])).toEqual(cycleRange(6, 5, [1, 2, 3, 4, 5]));
  });

  it('stretches only for cycles that already exist', () => {
    expect(cycleRange(6, 7, [1, 2, 3, 4, 5, 6])).toHaveLength(7);  // meta cumplida, pendiente de archivar
    expect(cycleRange(4, 1, [1, 2, 3, 4, 5])).toHaveLength(5);     // sesiones más allá de una meta rebajada
  });
});

describe('rotation pointer', () => {
  beforeAll(async () => { await store().init(); });

  it('keeps the cycle while variants are still pending, even after finishing the last variant', async () => {
    expect(cycle()).toBe(1);

    await runSession('U1');
    expect(cycle()).toBe(1);
    expect(codeAt(pos())).toBe('L1');   // sigue el orden natural

    // saltar al final de la rotación: antes esto disparaba el ciclo 2 con 4 variantes sin hacer
    await runSession('L3');
    expect(cycle()).toBe(1);
    expect(codeAt(pos())).toBe('L1');   // apunta a la primera pendiente, no al ciclo siguiente
  });

  it('rolls over only once every variant of the cycle is done', async () => {
    for (const code of ['L1', 'U2', 'L2']) {
      await runSession(code);
      expect(cycle()).toBe(1);
    }
    expect(codeAt(pos())).toBe('U3');   // la única que queda

    await runSession('U3');
    expect(cycle()).toBe(2);            // ciclo completo: ahora sí rueda
    expect(pos()).toBe(0);
  });

  it('setActiveCycle jumps back and points at the first pending variant', async () => {
    await runSession('U1');             // ciclo 2: solo U1 hecha
    expect(cycle()).toBe(2);

    await store().setActiveCycle(1);
    expect(cycle()).toBe(1);
    expect(store().cycleDone(1).size).toBe(6);   // el ciclo 1 quedó completo

    await store().setActiveCycle(2);
    expect(cycle()).toBe(2);
    expect(codeAt(pos())).toBe('L1');            // primera pendiente del ciclo 2
  });

  it('an unfinished session follows the cycle it is moved to, keeping its sets', async () => {
    const w = await store().createWorkout('L1');
    await store().logSet(w.id, w.entries[0].exerciseId, { value: 30, reps: 8, unit: 'kg' });

    await store().setActiveCycle(5);
    const moved = store().workouts.find((x) => x.id === w.id);
    expect(moved.cycle).toBe(5);
    expect(moved.variant).toBe('L1');                        // conserva su variante
    expect(store().setsByWorkout[w.id]).toHaveLength(1);     // y sus series
  });
});

describe('walking back to a session already trained', () => {
  let yesterdayId;

  // período limpio: las sesiones de los tests anteriores quedan en el archivado
  beforeAll(async () => {
    await store().archiveAndStartNew();
    const w = await store().createWorkout('U1');
    await store().logSet(w.id, w.entries[0].exerciseId, { value: 60, reps: 10, unit: 'kg' });
    await store().logSet(w.id, w.entries[0].exerciseId, { value: 55, reps: 12, unit: 'kg' });
    await store().finishWorkout(w.id);
    // moverla a ayer: es el caso que rompía — Today solo miraba sesiones de hoy
    const next = { ...store().workouts.find((x) => x.id === w.id), date: '2020-01-02' };
    await db.workouts.put(next);
    useStore.setState({ workouts: store().workouts.map((x) => (x.id === w.id ? next : x)) });
    yesterdayId = w.id;
  });

  it('shows what was logged instead of an empty plan', async () => {
    await store().setActiveVariant('U1');
    const inView = store().sessionInView();
    expect(inView.id).toBe(yesterdayId);
    expect(store().setsByWorkout[inView.id]).toHaveLength(2);
  });

  it('does not create a second session just by navigating to it', async () => {
    const before = store().workouts.length;
    await store().setActiveVariant('U1');
    await store().setActiveVariant('U1');
    expect(store().workouts).toHaveLength(before);
  });

  it('keeps today\'s in-progress session untouched while showing the older one', async () => {
    const todayW = await store().createWorkout('L1');
    await store().logSet(todayW.id, todayW.entries[0].exerciseId, { value: 40, reps: 10, unit: 'kg' });

    await store().setActiveVariant('U1');                    // navegar a la de ayer
    expect(store().sessionInView().id).toBe(yesterdayId);    // se muestra la de ayer
    const stillL1 = store().workouts.find((x) => x.id === todayW.id);
    expect(stillL1.variant).toBe('L1');                      // la de hoy no se retargetea
    expect(stillL1.finished).toBe(false);

    await store().setActiveVariant('L1');                    // y volver a la de hoy la recupera
    expect(store().sessionInView().id).toBe(todayW.id);
  });
});
