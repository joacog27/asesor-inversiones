// Tests de la etapa 2: simulador, metas, sincronización, alertas y recordatorios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portfolioStats, simulate, futureValue, requiredMonthly, monthsToTarget, goalStatus } from '../js/simulator.js';
import { mergeRoots, fingerprint, parseFirebaseConfig } from '../js/sync-merge.js';
import { createSyncEngine } from '../js/sync-engine.js';
import { alertTriggered, reminderDue, buildICS } from '../js/notify.js';
import { PROFILES } from '../js/config.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// ---------------- Simulador ----------------
test('estadísticas de cartera: más riesgo → más rendimiento y volatilidad', () => {
  const stats = PROFILES.map((p) => portfolioStats(p.alloc));
  for (let i = 1; i < stats.length; i++) {
    assert.ok(stats[i].mu > stats[i - 1].mu, `mu ${i}`);
    assert.ok(stats[i].sigma > stats[i - 1].sigma, `sigma ${i}`);
  }
  const s = portfolioStats({ rv_global: 100 });
  close(s.mu, 0.06); close(s.sigma, 0.16);
});

test('valor futuro y aporte necesario son inversos', () => {
  const fv = futureValue({ initial: 1000, monthly: 100, years: 10, mu: 0.05 });
  const need = requiredMonthly({ target: fv, initial: 1000, years: 10, mu: 0.05 });
  close(need, 100, 1e-6);
  assert.equal(futureValue({ initial: 0, monthly: 100, years: 1, mu: 0 }), 1200);
  assert.equal(requiredMonthly({ target: 500, initial: 1000, years: 2, mu: 0.05 }), 0);
  assert.equal(monthsToTarget({ target: 1200, initial: 0, monthly: 100, mu: 0 }), 12);
  assert.equal(monthsToTarget({ target: 1e12, initial: 0, monthly: 1, mu: 0 }), null);
});

test('Monte Carlo: sin volatilidad coincide con la fórmula y es determinístico', () => {
  const sim = simulate({ initial: 1000, monthly: 100, years: 5, mu: 0.05, sigma: 0, runs: 50 });
  const fv = futureValue({ initial: 1000, monthly: 100, years: 5, mu: 0.05 });
  close(sim.final.p10, fv, 1e-6);
  close(sim.final.p90, fv, 1e-6);
  assert.equal(sim.points.length, 6);
  assert.equal(sim.contributed, 1000 + 100 * 60);
  const a = simulate({ initial: 1000, monthly: 100, years: 5, mu: 0.05, sigma: 0.2, runs: 300 });
  const b = simulate({ initial: 1000, monthly: 100, years: 5, mu: 0.05, sigma: 0.2, runs: 300 });
  assert.deepEqual(a.final, b.final);
  assert.ok(a.final.p10 < a.final.p50 && a.final.p50 < a.final.p90);
});

test('Monte Carlo: la mediana se acerca al valor esperado', () => {
  const sim = simulate({ initial: 10000, monthly: 0, years: 10, mu: 0.06, sigma: 0.15, runs: 2000 });
  // Mediana lognormal = exp(drift*n) < media; debe quedar dentro de ±15% de la fórmula
  const fv = futureValue({ initial: 10000, years: 10, mu: 0.06 });
  assert.ok(sim.final.p50 > fv * 0.8 && sim.final.p50 < fv * 1.05, `${sim.final.p50} vs ${fv}`);
});

test('meta: progreso, aporte necesario y probabilidad', () => {
  const g = { target: 10000, currency: 'USD', date: '2031-11-15', share: 50 };
  const today = new Date('2026-11-15T12:00:00');
  const st = goalStatus(g, { portfolioUSD: 4000, monthlyUSD: 200, fx: 1500, mu: 0.04, sigma: 0.08, today });
  close(st.currentUSD, 2000);
  close(st.progress, 20);
  close(st.monthlyUSD, 100);
  assert.ok(st.neededMonthlyUSD > 0 && st.neededMonthlyUSD < 150);
  assert.ok(st.prob > 0 && st.prob <= 1);
  // Meta en pesos se convierte con el dólar de hoy
  const ars = goalStatus({ ...g, currency: 'ARS', target: 15_000_000 }, { portfolioUSD: 4000, monthlyUSD: 200, fx: 1500, mu: 0.04, sigma: 0.08, today });
  close(ars.targetUSD, 10000);
  // Meta cumplida
  const done = goalStatus({ ...g, target: 1000 }, { portfolioUSD: 4000, monthlyUSD: 0, fx: 1500, mu: 0.04, sigma: 0.08, today });
  assert.equal(done.state, 'done');
});

// ---------------- Sincronización ----------------
const user = (id, updatedAt, txs = [], extra = {}) => ({ id, name: id, updatedAt, transactions: txs, deletedTx: {}, ...extra });
const tx = (id, updatedAt, qty = 1) => ({ id, updatedAt, qty });

test('fusión: une usuarios y operaciones de dos dispositivos', () => {
  const phone = { users: { a: user('a', 100, [tx('t1', 100)]) }, deleted: {} };
  const pc = { users: { a: user('a', 200, [tx('t2', 200)]), b: user('b', 50) }, deleted: {} };
  const m = mergeRoots(phone, pc);
  assert.deepEqual(Object.keys(m.users).sort(), ['a', 'b']);
  assert.deepEqual(m.users.a.transactions.map((t) => t.id).sort(), ['t1', 't2']);
  assert.equal(m.users.a.updatedAt, 200);
});

test('fusión: gana la edición más reciente de una operación', () => {
  const a = { users: { u: user('u', 100, [tx('t1', 100, 5)]) } };
  const b = { users: { u: user('u', 90, [tx('t1', 300, 9)]) } };
  assert.equal(mergeRoots(a, b).users.u.transactions[0].qty, 9);
});

test('fusión: respeta operaciones y usuarios borrados', () => {
  const a = { users: { u: user('u', 300, [], { deletedTx: { t1: 250 } }) }, deleted: {} };
  const b = { users: { u: user('u', 100, [tx('t1', 100), tx('t2', 100)]), x: user('x', 10) }, deleted: {} };
  const m = mergeRoots(a, b);
  assert.deepEqual(m.users.u.transactions.map((t) => t.id), ['t2']);
  // Borrado en un lado
  const m2 = mergeRoots({ users: {}, deleted: { x: 20 } }, b);
  assert.ok(!m2.users.x);
  // Si el usuario se editó DESPUÉS de borrarlo en otro lado, se conserva
  const m3 = mergeRoots({ users: {}, deleted: { x: 5 } }, b);
  assert.ok(m3.users.x);
});

test('fusión: es idempotente y conmutativa', () => {
  const a = { users: { u: user('u', 100, [tx('t1', 100)]), v: user('v', 5) }, deleted: { z: 1 } };
  const b = { users: { u: user('u', 200, [tx('t2', 200)]) }, deleted: {} };
  const ab = mergeRoots(a, b), ba = mergeRoots(b, a);
  assert.equal(fingerprint(ab), fingerprint(ba));
  assert.equal(fingerprint(mergeRoots(ab, ab)), fingerprint(ab));
});

test('motor de sincronización: dos dispositivos convergen', async () => {
  // "Nube" en memoria compartida
  let cloud = null;
  const subs = new Set();
  const provider = {
    subscribe(cb) { subs.add(cb); setTimeout(() => cb(cloud), 0); return () => subs.delete(cb); },
    async write(p) { cloud = JSON.parse(JSON.stringify(p)); for (const cb of subs) setTimeout(() => cb(cloud), 0); },
  };
  const mkStore = (payload) => {
    let data = payload;
    const ls = new Set();
    return {
      getPayload: () => data,
      apply: (p) => { data = p; ls.forEach((f) => f({ remote: true })); },
      onChange: (f) => { ls.add(f); return () => ls.delete(f); },
      edit: (fn) => { data = fn(JSON.parse(JSON.stringify(data))); ls.forEach((f) => f({})); },
    };
  };
  const phone = mkStore({ users: { a: user('a', 100, [tx('t1', 100)]) }, deleted: {} });
  const pc = mkStore({ users: { b: user('b', 100, [tx('t9', 100)]) }, deleted: {} });
  const e1 = createSyncEngine({ store: phone, provider, debounceMs: 5 });
  const e2 = createSyncEngine({ store: pc, provider, debounceMs: 5 });
  e1.start();
  await new Promise((r) => setTimeout(r, 30));
  e2.start();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fingerprint(phone.getPayload()), fingerprint(pc.getPayload()));
  assert.deepEqual(Object.keys(pc.getPayload().users).sort(), ['a', 'b']);
  // Edición en el celular llega a la compu
  phone.edit((d) => { d.users.a.transactions.push(tx('t2', 500)); d.users.a.updatedAt = 500; return d; });
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(pc.getPayload().users.a.transactions.map((t) => t.id).sort(), ['t1', 't2']);
  e1.stop(); e2.stop();
});

test('lee la configuración de Firebase pegada desde la consola', () => {
  const js = `const firebaseConfig = {
    apiKey: "AIzaFake",
    authDomain: 'mi-app.firebaseapp.com', // comentario
    projectId: "mi-app",
    appId: "1:2:web:3",
  };`;
  assert.deepEqual(parseFirebaseConfig(js), { apiKey: 'AIzaFake', authDomain: 'mi-app.firebaseapp.com', projectId: 'mi-app', appId: '1:2:web:3' });
  assert.equal(parseFirebaseConfig('{"apiKey":"x"}'), null);
  assert.equal(parseFirebaseConfig('hola'), null);
});

// ---------------- Alertas y recordatorios ----------------
test('alertas de precio', () => {
  assert.ok(alertTriggered({ active: true, type: 'above', value: 100 }, { price: 101 }));
  assert.ok(!alertTriggered({ active: true, type: 'above', value: 100 }, { price: 99 }));
  assert.ok(alertTriggered({ active: true, type: 'below', value: 100 }, { price: 99 }));
  assert.ok(alertTriggered({ active: true, type: 'move', value: 5 }, { price: 1, pct: -6 }));
  assert.ok(!alertTriggered({ active: false, type: 'below', value: 100 }, { price: 1 }));
});

test('recordatorio mensual', () => {
  const settings = { reminderOn: true, reminderDay: 10 };
  const d = new Date('2026-11-15T12:00:00');
  assert.ok(reminderDue({ settings, transactions: [], seen: {} }, d));
  assert.ok(!reminderDue({ settings, transactions: [], seen: {} }, new Date('2026-11-05T12:00:00')));
  assert.ok(!reminderDue({ settings, transactions: [{ side: 'buy', date: '2026-11-02' }], seen: {} }, d));
  assert.ok(!reminderDue({ settings, transactions: [], seen: { remindedMonth: '2026-11' } }, d));
  assert.ok(!reminderDue({ settings: { reminderOn: false }, transactions: [], seen: {} }, d));
});

test('archivo de calendario (.ics) con repetición mensual', () => {
  const ics = buildICS({ day: 10, description: 'Aporte: $ 300.000', start: new Date('2026-11-15T12:00:00') });
  assert.match(ics, /RRULE:FREQ=MONTHLY;BYMONTHDAY=10/);
  assert.match(ics, /DTSTART:20261210T100000/);
  assert.match(ics, /Aporte: \$ 300\.000/);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.trim().endsWith('END:VCALENDAR'));
});
