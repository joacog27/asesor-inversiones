// =====================================================================
// DATOS DE MERCADO (100% fuentes gratuitas, sin API key)
//  - dolarapi.com ............ cotizaciones del dólar (oficial, MEP, CCL, blue…)
//  - api.argentinadatos.com .. inflación, riesgo país, tasas, FCI, dólar histórico
//  - data912.com ............. acciones, CEDEARs, bonos, letras, ONs (BYMA) e históricos
//  - data-api.binance.vision . cripto en vivo e histórico (respaldo: CoinGecko)
// Cada adaptador normaliza los datos, usa caché y, si la fuente falla,
// devuelve el último valor guardado marcado como "stale".
// =====================================================================
import { KINDS, CRYPTO_LIST, REFRESH } from './config.js';
import { detectCurrency, prettyName } from './symbols.js';
export { lecapMaturity, detectCurrency, prettyName } from './symbols.js';
import { cacheGet, cacheSet } from './storage.js';

const D912 = 'https://data912.com';
const ADATOS = 'https://api.argentinadatos.com/v1';
const DOLARAPI = 'https://dolarapi.com/v1';
const BINANCE = 'https://data-api.binance.vision/api/v3';
const COINGECKO = 'https://api.coingecko.com/api/v3';

// ---------------------------------------------------------------------
// Estado de las fuentes (para el indicador en la UI)
// ---------------------------------------------------------------------
export const SOURCES = {
  dolarapi: { label: 'DolarApi (dólar)', ok: null, last: null, error: null },
  argentinadatos: { label: 'ArgentinaDatos (inflación, tasas, FCI)', ok: null, last: null, error: null },
  data912: { label: 'Data912 (BYMA: acciones, CEDEARs, bonos)', ok: null, last: null, error: null, note: '~20 s de demora' },
  binance: { label: 'Binance (cripto)', ok: null, last: null, error: null },
  coingecko: { label: 'CoinGecko (cripto, respaldo)', ok: null, last: null, error: null },
};
function mark(src, ok, error) {
  const s = SOURCES[src];
  if (!s) return;
  s.ok = ok;
  if (ok) { s.last = Date.now(); s.error = null; } else s.error = error ? String(error.message || error) : 'Error';
  emit('status');
}

// ---------------------------------------------------------------------
// Bus de eventos simple
// ---------------------------------------------------------------------
const bus = new Map();
export function on(evt, fn) {
  if (!bus.has(evt)) bus.set(evt, new Set());
  bus.get(evt).add(fn);
  return () => bus.get(evt).delete(fn);
}
export function emit(evt, payload) {
  (bus.get(evt) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
}

// ---------------------------------------------------------------------
// fetch con caché + timeout + fallback
// ---------------------------------------------------------------------
const inflight = new Map();

async function fetchJSON(url, { key = url, ttl = 60_000, source, timeout = 15_000, transform } = {}) {
  const cached = await cacheGet(key);
  if (cached && Date.now() - cached.t < ttl) return { data: cached.data, t: cached.t, stale: false, cached: true };
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let data = await res.json();
      if (transform) data = transform(data);
      await cacheSet(key, data);
      if (source) mark(source, true);
      return { data, t: Date.now(), stale: false };
    } catch (err) {
      if (source) mark(source, false, err.name === 'AbortError' ? 'Tiempo de espera agotado' : err);
      if (cached) return { data: cached.data, t: cached.t, stale: true };
      throw err;
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// ---------------------------------------------------------------------
// Estado central de mercado (último dato conocido de cada cosa)
// ---------------------------------------------------------------------
export const market = {
  dolares: null, // { casa: {compra, venta, fecha} }
  dolaresT: null,
  panels: {}, // kind -> { list, map, t, stale }
  crypto: null, // { list, map, t, stale }
  indicators: null,
  fci: null, // { list, byKey, t }
};

// ---------------------------------------------------------------------
// Dólar
// ---------------------------------------------------------------------
export async function loadDolares(force = false) {
  const r = await fetchJSON(`${DOLARAPI}/dolares`, { ttl: force ? 0 : REFRESH.dolares - 5000, source: 'dolarapi' });
  const map = {};
  for (const d of r.data) map[d.casa] = { compra: d.compra, venta: d.venta, fecha: d.fechaActualizacion, nombre: d.nombre };
  market.dolares = map;
  market.dolaresT = r.t;
  market.dolaresStale = r.stale;
  emit('market', 'dolares');
  return map;
}

/** ARS por USD según la casa elegida (venta). */
export function fxRate(casa = 'bolsa') {
  const d = market.dolares;
  if (!d) return null;
  return d[casa]?.venta || d.bolsa?.venta || d.oficial?.venta || null;
}

// ---------------------------------------------------------------------
// Paneles BYMA (data912)
// ---------------------------------------------------------------------
function normalizePanel(kind, raw) {
  const set = new Set(raw.map((x) => x.symbol));
  const divisor = KINDS[kind].divisor;
  const list = raw.map((x) => {
    const mid = x.px_bid && x.px_ask ? (x.px_bid + x.px_ask) / 2 : x.px_bid || x.px_ask || 0;
    const price = x.c || mid;
    const currency = detectCurrency(kind, x.symbol, set, price);
    return {
      kind, symbol: x.symbol, name: prettyName(kind, x.symbol),
      price, pct: x.pct_change ?? null, bid: x.px_bid, ask: x.px_ask,
      volume: x.v || 0, trades: x.q_op || 0, currency, divisor,
    };
  }).filter((x) => x.price > 0);
  return { list, map: Object.fromEntries(list.map((x) => [x.symbol, x])) };
}

export async function loadPanel(kind, force = false) {
  const panel = KINDS[kind]?.panel;
  if (!panel || panel === 'crypto' || panel === 'fci') return null;
  const r = await fetchJSON(`${D912}/live/${panel}`, { ttl: force ? 0 : REFRESH.panels - 5000, source: 'data912' });
  const norm = normalizePanel(kind, r.data);
  market.panels[kind] = { ...norm, t: r.t, stale: r.stale };
  emit('market', kind);
  return market.panels[kind];
}

// ---------------------------------------------------------------------
// Cripto (Binance público; respaldo CoinGecko)
// ---------------------------------------------------------------------
function binancePair(sym) {
  const c = CRYPTO_LIST.find((x) => x.symbol === sym);
  return c?.binance || `${sym}USDT`;
}

export async function loadCrypto(symbols, force = false) {
  const syms = [...new Set(symbols)].filter(Boolean);
  const nonStable = syms.filter((s) => s !== 'USDT' && s !== 'USDC');
  let list = [];
  let t = Date.now();
  let stale = false;
  try {
    if (nonStable.length) {
      const pairs = encodeURIComponent(JSON.stringify(nonStable.map(binancePair)));
      const r = await fetchJSON(`${BINANCE}/ticker/24hr?symbols=${pairs}`, {
        key: `binance:${nonStable.sort().join(',')}`, ttl: force ? 0 : REFRESH.crypto - 2000, source: 'binance', timeout: 10_000,
      });
      t = r.t; stale = r.stale;
      list = r.data.map((x) => {
        const sym = nonStable.find((s) => binancePair(s) === x.symbol) || x.symbol.replace(/USDT$/, '');
        return { kind: 'cripto', symbol: sym, name: prettyName('cripto', sym), price: Number(x.lastPrice), pct: Number(x.priceChangePercent), volume: Number(x.quoteVolume), currency: 'USD', divisor: 1 };
      });
    }
  } catch (err) {
    // Respaldo: CoinGecko
    const ids = nonStable.map((s) => CRYPTO_LIST.find((c) => c.symbol === s)?.cg).filter(Boolean);
    if (ids.length) {
      const r = await fetchJSON(`${COINGECKO}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`, {
        key: `cg:${ids.sort().join(',')}`, ttl: force ? 0 : 30_000, source: 'coingecko',
      });
      t = r.t; stale = r.stale;
      list = Object.entries(r.data).map(([id, v]) => {
        const sym = CRYPTO_LIST.find((c) => c.cg === id)?.symbol || id;
        return { kind: 'cripto', symbol: sym, name: prettyName('cripto', sym), price: v.usd, pct: v.usd_24h_change ?? null, currency: 'USD', divisor: 1 };
      });
    } else throw err;
  }
  for (const s of syms.filter((x) => x === 'USDT' || x === 'USDC')) {
    list.push({ kind: 'cripto', symbol: s, name: prettyName('cripto', s), price: 1, pct: 0, currency: 'USD', divisor: 1 });
  }
  const prev = market.crypto?.map || {};
  market.crypto = { list, map: { ...prev, ...Object.fromEntries(list.map((x) => [x.symbol, x])) }, t, stale };
  emit('market', 'cripto');
  return market.crypto;
}

/** Verifica que exista un par en Binance (para agregar cripto que no está en la lista). */
export async function cryptoExists(sym) {
  try {
    const res = await fetch(`${BINANCE}/ticker/price?symbol=${binancePair(sym.toUpperCase())}`);
    return res.ok;
  } catch { return false; }
}

// ---------------------------------------------------------------------
// FCI (ArgentinaDatos)
// ---------------------------------------------------------------------
export const FCI_CATEGORIES = {
  mercadoDinero: { label: 'Money market', cls: 'liquidez' },
  rentaFija: { label: 'Renta fija', cls: 'rf_ars' },
  rentaMixta: { label: 'Renta mixta', cls: 'rf_ars' },
  rentaVariable: { label: 'Renta variable', cls: 'rv_arg' },
};

const fciLoaded = new Set();
/** Carga FCIs por categoría (por defecto solo money market, que es liviano). */
export async function loadFCI(force = false, cats = ['mercadoDinero']) {
  const results = await Promise.allSettled(cats.flatMap((cat) => [
    fetchJSON(`${ADATOS}/finanzas/fci/${cat}/ultimo`, { ttl: force ? 0 : 6 * 3600_000, source: 'argentinadatos', timeout: 25_000 }),
    fetchJSON(`${ADATOS}/finanzas/fci/${cat}/penultimo`, { ttl: force ? 0 : 6 * 3600_000, source: 'argentinadatos', timeout: 25_000 }),
  ]));
  const fresh = [];
  cats.forEach((cat, i) => {
    const last = results[i * 2].status === 'fulfilled' ? results[i * 2].value.data : [];
    const prev = results[i * 2 + 1].status === 'fulfilled' ? results[i * 2 + 1].value.data : [];
    if (last.length) fciLoaded.add(cat);
    const prevMap = new Map(prev.map((f) => [f.fondo, f]));
    for (const f of last) {
      if (!f.vcp) continue;
      const p = prevMap.get(f.fondo);
      let tna = null;
      if (p?.vcp && p.fecha !== f.fecha) {
        const days = Math.max(1, (new Date(f.fecha) - new Date(p.fecha)) / 86400000);
        tna = ((f.vcp / p.vcp) - 1) * 365 / days;
        if (!isFinite(tna) || Math.abs(tna) > 5) tna = null; // datos raros
      }
      const usd = /d[oó]lar|usd|\bus\$/i.test(f.fondo);
      fresh.push({
        kind: 'fci', symbol: `${cat}|${f.fondo}`, name: f.fondo, cat, catLabel: FCI_CATEGORIES[cat].label,
        price: f.vcp, fecha: f.fecha, patrimonio: f.patrimonio || 0, tna, currency: usd ? 'USD' : 'ARS', divisor: 1,
      });
    }
  });
  if (!fresh.length) return market.fci;
  const loadedCats = new Set(fresh.map((f) => f.cat));
  const kept = (market.fci?.list || []).filter((f) => !loadedCats.has(f.cat));
  const list = [...kept, ...fresh];
  market.fci = { list, map: Object.fromEntries(list.map((x) => [x.symbol, x])), t: Date.now() };
  emit('market', 'fci');
  return market.fci;
}
export function fciCategoriesLoaded() { return [...fciLoaded]; }

/** Los money market en pesos más grandes, con su TNA estimada. */
export function topMoneyMarket(n = 5) {
  if (!market.fci) return [];
  return market.fci.list
    .filter((f) => f.cat === 'mercadoDinero' && f.currency === 'ARS' && f.tna != null && f.tna > 0)
    .sort((a, b) => b.patrimonio - a.patrimonio)
    .slice(0, n);
}

// ---------------------------------------------------------------------
// Indicadores macro (ArgentinaDatos)
// ---------------------------------------------------------------------
export async function loadIndicators(force = false) {
  const ttl = force ? 0 : 6 * 3600_000;
  const opt = { ttl, source: 'argentinadatos', timeout: 25_000 };
  const [infl, inflIA, rp, pf, cuentas] = await Promise.allSettled([
    fetchJSON(`${ADATOS}/finanzas/indices/inflacion`, { ...opt, transform: (d) => d.slice(-36) }),
    fetchJSON(`${ADATOS}/finanzas/indices/inflacionInteranual`, { ...opt, transform: (d) => d.slice(-3) }),
    fetchJSON(`${ADATOS}/finanzas/indices/riesgo-pais/ultimo`, opt),
    fetchJSON(`${ADATOS}/finanzas/tasas/plazoFijo`, opt),
    fetchJSON(`${ADATOS}/finanzas/fci/otros/ultimo`, opt),
  ]);
  const val = (r) => (r.status === 'fulfilled' ? r.value.data : null);
  const ind = { t: Date.now() };
  const inflData = val(infl);
  if (inflData?.length) {
    ind.inflacion = inflData;
    ind.inflacionMensual = inflData[inflData.length - 1];
    const last3 = inflData.slice(-3).map((x) => x.valor);
    ind.inflacionPromedio3m = last3.reduce((a, b) => a + b, 0) / last3.length;
  }
  const ia = val(inflIA);
  if (ia?.length) ind.inflacionInteranual = ia[ia.length - 1];
  const rpData = val(rp);
  if (rpData) ind.riesgoPais = rpData;
  const pfData = val(pf);
  if (pfData?.length) {
    const banks = pfData.filter((b) => b.tnaClientes > 0);
    const best = banks.reduce((a, b) => (b.tnaClientes > (a?.tnaClientes || 0) ? b : a), null);
    const bna = banks.find((b) => /NACION/i.test(b.entidad));
    ind.plazoFijo = { mejor: best ? { entidad: best.entidad, tna: best.tnaClientes } : null, bna: bna ? { entidad: 'Banco Nación', tna: bna.tnaClientes } : null };
  }
  const ctas = val(cuentas);
  if (ctas?.length) {
    const sorted = ctas.filter((c) => c.tna > 0).sort((a, b) => b.tna - a.tna);
    ind.cuentas = sorted.slice(0, 5).map((c) => ({ nombre: c.fondo, tna: c.tna, tope: c.tope }));
  }
  market.indicators = { ...(market.indicators || {}), ...ind };
  emit('market', 'indicators');
  return market.indicators;
}

// ---------------------------------------------------------------------
// Históricos → [{ d: 'YYYY-MM-DD', v: number }] ascendente
// ---------------------------------------------------------------------
const HIST_TTL = 12 * 3600_000;
const MAX_POINTS = 1600;

export async function loadHistory(kind, symbol) {
  const k = KINDS[kind];
  try {
    if (kind === 'cripto') {
      if (symbol === 'USDT' || symbol === 'USDC') return null;
      try {
        const r = await fetchJSON(`${BINANCE}/klines?symbol=${binancePair(symbol)}&interval=1d&limit=1000`, {
          key: `hist:cripto:${symbol}`, ttl: 3600_000,
          transform: (d) => d.map((x) => ({ d: new Date(x[0]).toISOString().slice(0, 10), v: Number(x[4]) })),
        });
        return r.data;
      } catch {
        const cg = CRYPTO_LIST.find((c) => c.symbol === symbol)?.cg;
        if (!cg) return null;
        const r = await fetchJSON(`${COINGECKO}/coins/${cg}/market_chart?vs_currency=usd&days=365&interval=daily`, {
          key: `hist:cg:${symbol}`, ttl: 3600_000,
          transform: (d) => d.prices.map(([ts, v]) => ({ d: new Date(ts).toISOString().slice(0, 10), v })),
        });
        return r.data;
      }
    }
    if (kind === 'usa') {
      const r = await fetchJSON(`${D912}/historical/usa_stocks/${encodeURIComponent(symbol)}`, {
        key: `hist:usa:${symbol}`, ttl: HIST_TTL,
        transform: (d) => d.dates.map((date, i) => ({ d: date, v: d.prices[i] })).filter((x) => x.v != null).slice(-MAX_POINTS),
      });
      return r.data;
    }
    if (k?.hist) {
      const r = await fetchJSON(`${D912}/historical/${k.hist}/${encodeURIComponent(symbol)}`, {
        key: `hist:${kind}:${symbol}`, ttl: HIST_TTL,
        transform: (d) => d.map((x) => ({ d: x.date, v: x.c })).filter((x) => x.v != null).slice(-MAX_POINTS),
      });
      return r.data;
    }
  } catch (err) {
    console.warn('Sin histórico para', kind, symbol, err);
  }
  return null;
}

/** Histórico del dólar (casa = bolsa | contadoconliqui | oficial | blue | cripto…) */
export async function loadFxHistory(casa = 'bolsa') {
  try {
    const r = await fetchJSON(`${ADATOS}/cotizaciones/dolares/${casa}`, {
      key: `hist:fx:${casa}`, ttl: HIST_TTL, timeout: 25_000,
      transform: (d) => d.map((x) => ({ d: x.fecha, v: x.venta })).slice(-3000),
    });
    return r.data;
  } catch { return null; }
}

/** Valor de una serie en una fecha (último dato disponible ≤ fecha). */
export function valueAt(series, date) {
  if (!series?.length) return null;
  let lo = 0, hi = series.length - 1;
  if (date < series[0].d) return null;
  if (date >= series[hi].d) return series[hi].v;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid].d <= date) lo = mid; else hi = mid - 1;
  }
  return series[lo].v;
}

// ---------------------------------------------------------------------
// Cotización actual de cualquier activo
// ---------------------------------------------------------------------
export function quote(kind, symbol) {
  if (kind === 'cripto') return market.crypto?.map?.[symbol] || null;
  if (kind === 'fci') return market.fci?.map?.[symbol] || null;
  return market.panels[kind]?.map?.[symbol] || null;
}

// ---------------------------------------------------------------------
// Planificador de actualizaciones (se pausa con la pestaña oculta)
// ---------------------------------------------------------------------
const tasks = new Map();

export function schedule(id, fn, interval) {
  unschedule(id);
  const task = { fn, interval, timer: null };
  const run = async () => {
    if (document.hidden) return;
    try { await fn(); } catch (e) { console.warn(`[${id}]`, e.message); }
  };
  task.run = run;
  task.timer = setInterval(run, interval);
  tasks.set(id, task);
  run();
}
export function unschedule(id) {
  const t = tasks.get(id);
  if (t) { clearInterval(t.timer); tasks.delete(id); }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tasks.forEach((t) => t.run());
});

/** Lista de símbolos disponibles para buscar en un tipo de activo. */
export async function searchList(kind) {
  if (kind === 'cripto') return CRYPTO_LIST.map((c) => ({ kind, symbol: c.symbol, name: c.name, currency: 'USD' }));
  if (kind === 'fci') {
    const missing = Object.keys(FCI_CATEGORIES).filter((c) => !fciLoaded.has(c));
    if (missing.length) await loadFCI(false, missing);
    return [...(market.fci?.list || [])].sort((a, b) => b.patrimonio - a.patrimonio);
  }
  if (!market.panels[kind]) await loadPanel(kind);
  return [...(market.panels[kind]?.list || [])].sort((a, b) => b.volume - a.volume);
}
