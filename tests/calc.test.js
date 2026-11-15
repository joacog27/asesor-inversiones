// Tests de los cálculos clave. Ejecutar con:  node --test tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, buildPositions, summarize, classWeights, plazoFijoValue, evolution, accumulatedInflation, assetKey } from '../js/portfolio.js';
import { scoreQuiz, monthlyPlan, targetAllocation, pickInstruments, buildNews, buildPlanDetail } from '../js/advisor.js';
import { detectCurrency, lecapMaturity } from '../js/symbols.js';
import { QUIZ, PROFILES } from '../js/config.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('conversión ARS ↔ USD', () => {
  assert.equal(convert(1500, 'ARS', 'USD', 1500), 1);
  assert.equal(convert(2, 'USD', 'ARS', 1500), 3000);
  assert.equal(convert(100, 'ARS', 'ARS', null), 100);
  assert.equal(convert(100, 'ARS', 'USD', null), null);
});

test('posición con compras en distintas fechas y dólar distinto', () => {
  const txs = [
    { id: 'a', kind: 'cedear', symbol: 'SPY', cls: 'rv_global', side: 'buy', date: '2026-01-10', qty: 10, price: 20000, currency: 'ARS', divisor: 1, fx: 1000 },
    { id: 'b', kind: 'cedear', symbol: 'SPY', cls: 'rv_global', side: 'buy', date: '2026-06-10', qty: 10, price: 30000, currency: 'ARS', divisor: 1, fx: 1500 },
  ];
  const priceOf = () => ({ price: 40000, pct: 1 });
  const [p] = buildPositions(txs, { priceOf, fx: 2000, display: 'ARS' });
  assert.equal(p.qty, 20);
  assert.equal(p.costARS, 500000);
  close(p.costUSD, 200 + 200); // 200000/1000 + 300000/1500
  assert.equal(p.value, 800000);
  assert.equal(p.gain, 300000);
  close(p.gainPct, 60);
  assert.equal(p.avgPrice, 25000);
  // En USD: vale 800000/2000 = 400 USD y costó 400 USD → ganancia 0
  const [pu] = buildPositions(txs, { priceOf, fx: 2000, display: 'USD' });
  close(pu.value, 400);
  close(pu.gain, 0);
});

test('bonos cotizan cada 100 nominales', () => {
  const txs = [{ id: 'x', kind: 'bono', symbol: 'GD30D', cls: 'rf_usd', side: 'buy', date: '2026-01-01', qty: 1000, price: 60, currency: 'USD', divisor: 100, fx: 1200 }];
  const [p] = buildPositions(txs, { priceOf: () => ({ price: 66 }), fx: 1500, display: 'USD' });
  assert.equal(p.cost, 600);
  assert.equal(p.value, 660);
  close(p.gainPct, 10);
});

test('venta parcial: costo promedio y ganancia realizada', () => {
  const txs = [
    { id: '1', kind: 'cripto', symbol: 'BTC', cls: 'cripto', side: 'buy', date: '2026-01-01', qty: 1, price: 50000, currency: 'USD', divisor: 1, fx: 1000 },
    { id: '2', kind: 'cripto', symbol: 'BTC', cls: 'cripto', side: 'sell', date: '2026-02-01', qty: 0.5, price: 60000, currency: 'USD', divisor: 1, fx: 1000 },
  ];
  const [p] = buildPositions(txs, { priceOf: () => ({ price: 70000 }), fx: 1000, display: 'USD' });
  close(p.qty, 0.5);
  close(p.cost, 25000);
  close(p.realized, 5000);
  close(p.value, 35000);
});

test('plazo fijo: interés simple y se congela al vencer', () => {
  const tx = { id: 'pf', kind: 'pf', side: 'buy', date: '2026-01-01', qty: 1, price: 100000, currency: 'ARS', pf: { tna: 0.365, days: 30 } };
  close(plazoFijoValue(tx, '2026-01-11'), 101000);
  close(plazoFijoValue(tx, '2026-01-31'), 103000);
  close(plazoFijoValue(tx, '2026-06-01'), 103000);
  // Cobro: mismo pfId → posición cerrada
  const sell = { ...tx, id: 'pf2', pfId: 'pf', side: 'sell', date: '2026-01-31', price: 103000 };
  assert.equal(assetKey(sell), assetKey(tx));
  const [p] = buildPositions([tx, sell], { fx: 1000, display: 'ARS', today: '2026-02-05' });
  assert.ok(p.closed);
  close(p.realized, 3000);
  assert.equal(summarize([p]).value, 0);
});

test('resumen y pesos por clase', () => {
  const txs = [
    { id: '1', kind: 'dolar', symbol: 'USD', cls: 'liquidez', side: 'buy', date: '2026-01-01', qty: 100, price: 1, currency: 'USD', divisor: 1, fx: 1000 },
    { id: '2', kind: 'cedear', symbol: 'SPY', cls: 'rv_global', side: 'buy', date: '2026-01-01', qty: 3, price: 100000, currency: 'ARS', divisor: 1, fx: 1000 },
  ];
  const pos = buildPositions(txs, { priceOf: () => ({ price: 100000, pct: 0 }), fx: 1000, display: 'ARS' });
  const s = summarize(pos);
  assert.equal(s.value, 400000);
  const w = classWeights(s.byClass);
  close(w.liquidez, 25);
  close(w.rv_global, 75);
});

test('test de perfil: puntajes y topes', () => {
  // Respuestas más agresivas
  const max = Object.fromEntries(QUIZ.map((q) => [q.id, q.options.reduce((bi, o, i, arr) => (o.pts > arr[bi].pts ? i : bi), 0)]));
  const r = scoreQuiz(max);
  assert.equal(r.score, 100);
  assert.equal(r.level, PROFILES.length - 1);
  // Mismo perfil pero vende todo ante una caída → tope conservador
  const panic = { ...max, drawdown: 0 };
  const r2 = scoreQuiz(panic);
  assert.ok(r2.level <= 1);
  assert.ok(r2.capReasons.includes('drawdown'));
  // Todo mínimo
  const min = Object.fromEntries(QUIZ.map((q) => [q.id, q.options.reduce((bi, o, i, arr) => (o.pts < arr[bi].pts ? i : bi), 0)]));
  assert.equal(scoreQuiz(min).level, 0);
});

test('asignaciones de perfiles suman 100', () => {
  for (const p of PROFILES) assert.equal(Object.values(p.alloc).reduce((a, b) => a + b, 0), 100, p.id);
  const t = targetAllocation({ level: 2, goal: 'dolares' });
  assert.equal(Object.values(t.alloc).reduce((a, b) => a + b, 0), 100);
});

test('plan mensual: cartera vacía reparte por objetivo', () => {
  const alloc = { liquidez: 10, rf_ars: 15, rf_usd: 30, rv_global: 30, rv_arg: 10, cripto: 5 };
  const { byClass } = monthlyPlan({ alloc, amount: 100000, emergency: 'si' });
  close(byClass.rv_global, 30000);
  close(Object.values(byClass).reduce((a, b) => a + b, 0), 100000);
});

test('plan mensual: rebalancea con el aporte', () => {
  const alloc = { liquidez: 0, rf_ars: 0, rf_usd: 50, rv_global: 50, rv_arg: 0, cripto: 0 };
  // Tiene todo en global → el aporte va a renta fija USD
  const { byClass } = monthlyPlan({ alloc, currentByClass: { rv_global: 100000 }, amount: 50000, emergency: 'si' });
  close(byClass.rf_usd, 50000);
  close(byClass.rv_global, 0);
  close(Object.values(byClass).reduce((a, b) => a + b, 0), 50000);
});

test('plan mensual: sin fondo de emergencia prioriza liquidez', () => {
  const alloc = { liquidez: 10, rf_ars: 15, rf_usd: 30, rv_global: 30, rv_arg: 10, cripto: 5 };
  const { byClass } = monthlyPlan({ alloc, amount: 100000, emergency: 'no' });
  close(byClass.liquidez, 70000 + 3000);
  close(Object.values(byClass).reduce((a, b) => a + b, 0), 100000);
});

test('elección de instrumentos según mercado', () => {
  const ctx = {
    level: 2,
    list: (k) => (k === 'letra' ? [
      { symbol: 'S30N6', volume: 9e10, price: 128, currency: 'ARS', divisor: 100 },
      { symbol: 'S29E7', volume: 6e10, price: 106, currency: 'ARS', divisor: 100 },
    ] : []),
    quote: (k, s) => (s === 'TZX27' ? { price: 300, currency: 'ARS', divisor: 100 } : null),
    topMM: [],
    indicators: { inflacion: [{ valor: 2 }, { valor: 2 }, { valor: 2 }, { valor: 3 }] },
    today: '2026-11-15',
  };
  const { picks, notes } = pickInstruments('rf_ars', ctx);
  // S30N6 vence en 15 días → se descarta, se elige S29E7
  assert.equal(picks.find((p) => p.kind === 'letra').symbol, 'S29E7');
  // Inflación subiendo → más CER
  close(picks.find((p) => p.kind === 'bono').weight, 70);
  assert.ok(notes.length);
});

test('moneda nativa de símbolos', () => {
  const set = new Set(['AL30', 'AL30D', 'GGAL', 'GGALD', 'YPFD', 'YPFDD']);
  assert.equal(detectCurrency('bono', 'AL30D', set, 70), 'USD');
  assert.equal(detectCurrency('bono', 'AL30', set, 90000), 'ARS');
  assert.equal(detectCurrency('accion', 'YPFD', set, 50000), 'ARS');
  assert.equal(detectCurrency('accion', 'YPFDD', set, 30), 'USD');
  assert.equal(detectCurrency('on', 'YMCXD', null, 100), 'USD');
  assert.equal(detectCurrency('on', 'YMCXO', null, 150000), 'ARS');
  assert.equal(lecapMaturity('S29E7').toISOString().slice(0, 10), '2027-01-29');
});

test('evolución: valor vs invertido', () => {
  const txs = [{ id: '1', kind: 'cedear', symbol: 'SPY', cls: 'rv_global', side: 'buy', date: '2026-01-01', qty: 10, price: 100, currency: 'ARS', divisor: 1, fx: 1000 }];
  const hist = [{ d: '2026-01-01', v: 100 }, { d: '2026-01-02', v: 110 }, { d: '2026-01-03', v: 120 }];
  const valueAt = (s, d) => { let v = null; for (const p of s) if (p.d <= d) v = p.v; return v; };
  const pts = evolution(txs, { histOf: () => hist, fxSeries: null, valueAt, currentPrice: () => 120, fxNow: 1000, display: 'ARS', today: '2026-01-03' });
  assert.deepEqual(pts.map((p) => p.value), [1000, 1100, 1200]);
  assert.deepEqual(pts.map((p) => p.invested), [1000, 1000, 1000]);
});

test('inflación acumulada', () => {
  const m = [{ fecha: '2026-01-31', valor: 10 }, { fecha: '2026-02-28', valor: 10 }];
  close(accumulatedInflation(m, '2026-01-15', '2026-02-20'), 21);
});

test('novedades: avisa desvío y aporte pendiente', () => {
  const items = buildNews({
    alloc: { rv_global: 50, rf_usd: 50 }, currentWeights: { rv_global: 90, rf_usd: 10 }, hasPortfolio: true,
    monthlyAmount: 1000, monthHasBuy: false, positions: [], profile: { emergency: 'si' }, today: '2026-11-15',
  });
  assert.ok(items.some((i) => i.title.includes('desvió')));
  assert.ok(items.some((i) => i.title.includes('aporte')));
});

test('plan detallado: consolida instrumentos y pasa a liquidez lo que no alcanza', () => {
  const prices = { SPY: 21000, QQQ: 56000, GGAL: 5000, YPFD: 6300, PAMP: 4400 };
  const ctx = {
    level: 3, list: () => [], topMM: [{ symbol: 'mercadoDinero|MM', name: 'MM', price: 100, currency: 'ARS', tna: 0.2 }],
    quote: (k, s) => (prices[s] ? { price: prices[s], currency: 'ARS', divisor: 1 } : null), indicators: {}, today: '2026-11-15',
  };
  const { rows, notes } = buildPlanDetail({ byClass: { rv_global: 30000, rv_arg: 9000, liquidez: 1000, cripto: 0 }, currency: 'ARS', fx: 1500, ctx });
  const glob = rows.find((r) => r.cls === 'rv_global');
  assert.equal(glob.items.length, 1);
  assert.equal(glob.items[0].symbol, 'SPY');
  assert.equal(glob.items[0].qty, 1);
  const arg = rows.find((r) => r.cls === 'rv_arg');
  assert.ok(arg.items.every((it) => it.qty >= 1));
  // Si ni siquiera alcanza para 1 unidad del más barato, va a liquidez
  const r2 = buildPlanDetail({ byClass: { rv_global: 5000, liquidez: 1000 }, currency: 'ARS', fx: 1500, ctx });
  assert.equal(r2.rows.length, 1);
  assert.equal(r2.rows[0].cls, 'liquidez');
  close(r2.rows[0].amount, 6000);
  assert.ok(r2.notes.some((n) => n.includes('liquidez')));
  assert.ok(notes.length);
});
