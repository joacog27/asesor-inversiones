// =====================================================================
// CÁLCULOS DE CARTERA (funciones puras, sin DOM → testeables con Node)
//
// Operación (transaction):
// { id, kind, symbol, name, cls, side: 'buy'|'sell', date: 'YYYY-MM-DD',
//   qty, price, currency: 'ARS'|'USD', divisor, fx (ARS por USD ese día),
//   fees, note, pf?: { tna, days } }
//
// Los montos se guardan en la moneda original de la operación junto con
// el tipo de cambio del día. Así, el costo en ARS y en USD queda fijo y
// la ganancia refleja tanto el precio del activo como la devaluación.
// =====================================================================

export const DAY = 86400000;

export function assetKey(tx) {
  if (tx.kind === 'pf') return `pf:${tx.pfId || tx.id}`;
  return `${tx.kind}:${tx.symbol}`;
}

/** Convierte un monto entre ARS y USD con fx = ARS por USD. */
export function convert(amount, from, to, fx) {
  if (amount == null || !isFinite(amount)) return null;
  if (from === to) return amount;
  if (!fx) return null;
  return from === 'USD' ? amount * fx : amount / fx;
}

/** Monto bruto de la operación en su moneda (sin comisiones). */
export function grossAmount(tx) {
  return (Number(tx.qty) * Number(tx.price)) / (Number(tx.divisor) || 1);
}

/** Valor de un plazo fijo a una fecha (interés simple, se congela al vencimiento). */
export function plazoFijoValue(tx, dateStr) {
  const capital = Number(tx.price) * Number(tx.qty || 1);
  const tna = Number(tx.pf?.tna) || 0;
  const days = Number(tx.pf?.days) || 30;
  const elapsed = Math.max(0, Math.min(days, (new Date(dateStr) - new Date(tx.date)) / DAY));
  return capital * (1 + tna * elapsed / 365);
}

export function todayStr(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

function sortTx(txs) {
  return [...txs].sort((a, b) => (a.date === b.date ? (a.side === 'buy' ? -1 : 1) : a.date < b.date ? -1 : 1));
}

/**
 * Agrupa operaciones en posiciones (método de costo promedio).
 * opts.priceOf(key, firstTx) → { price, currency, divisor, pct } | null
 * opts.fx: ARS por USD actual; opts.display: 'ARS'|'USD'
 */
export function buildPositions(txs, { priceOf = () => null, fx, display = 'ARS', today = todayStr(), manualPrices = {} } = {}) {
  const groups = new Map();
  for (const tx of sortTx(txs)) {
    const key = assetKey(tx);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }

  const positions = [];
  for (const [key, list] of groups) {
    const first = list[0];
    let qty = 0, costNative = 0, costARS = 0, costUSD = 0, realized = 0;
    for (const tx of list) {
      const fees = Number(tx.fees) || 0;
      const gross = grossAmount(tx);
      const txFx = Number(tx.fx) || fx;
      if (tx.side === 'sell') {
        if (qty <= 0) continue;
        const sellQty = Math.min(Number(tx.qty), qty);
        const frac = sellQty / qty;
        const proceedsNative = (sellQty * Number(tx.price)) / (Number(tx.divisor) || 1) - fees;
        const costOut = { n: costNative * frac, a: costARS * frac, u: costUSD * frac };
        const proceedsDisp = convert(proceedsNative, tx.currency, display, txFx);
        realized += proceedsDisp - (display === 'ARS' ? costOut.a : costOut.u);
        qty -= sellQty; costNative -= costOut.n; costARS -= costOut.a; costUSD -= costOut.u;
      } else {
        const total = gross + fees;
        qty += Number(tx.qty);
        costNative += total;
        costARS += convert(total, tx.currency, 'ARS', txFx);
        costUSD += convert(total, tx.currency, 'USD', txFx);
      }
    }

    const currency = first.currency;
    const divisor = Number(first.divisor) || 1;
    let price = null, pct = null, hasPrice = false, valueNative = null;

    if (first.kind === 'pf') {
      valueNative = qty > 1e-9 ? plazoFijoValue(first, today) : 0;
      price = valueNative; hasPrice = true;
      const end = new Date(new Date(first.date).getTime() + (Number(first.pf?.days) || 30) * DAY);
      first._maturity = todayStr(end);
    } else if (first.kind === 'dolar') {
      price = 1; hasPrice = true; valueNative = qty;
    } else {
      const q = priceOf(key, first);
      if (q && q.price > 0) {
        price = q.price; pct = q.pct ?? null; hasPrice = true;
      } else if (manualPrices[key] > 0) {
        price = manualPrices[key]; hasPrice = true;
      } else {
        // Sin cotización: usamos el último precio operado.
        price = Number(list[list.length - 1].price);
      }
      valueNative = (qty * price) / divisor;
    }

    const value = convert(valueNative, currency, display, fx);
    const cost = display === 'ARS' ? costARS : costUSD;
    const gain = value != null ? value - cost : null;
    const dayChange = pct != null && value != null ? value - value / (1 + pct / 100) : 0;

    positions.push({
      key, kind: first.kind, symbol: first.symbol, name: first.name || first.symbol, cls: first.cls,
      currency, divisor, qty, closed: qty <= 1e-9,
      avgPrice: qty > 0 ? (costNative * divisor) / qty : 0,
      costNative, costARS, costUSD, cost,
      price, pct, hasPrice, valueNative, value, gain,
      gainPct: cost > 0 && gain != null ? (gain / cost) * 100 : null,
      dayChange, realized, txs: list, maturity: first._maturity || null,
    });
  }
  const open = positions.filter((p) => !p.closed);
  const total = open.reduce((a, p) => a + (p.value || 0), 0);
  for (const p of positions) p.weight = total > 0 && !p.closed ? (p.value / total) * 100 : 0;
  return positions.sort((a, b) => (b.value || 0) - (a.value || 0));
}

export function summarize(positions) {
  const open = positions.filter((p) => !p.closed);
  const value = open.reduce((a, p) => a + (p.value || 0), 0);
  const cost = open.reduce((a, p) => a + (p.cost || 0), 0);
  const dayChange = open.reduce((a, p) => a + (p.dayChange || 0), 0);
  const realized = positions.reduce((a, p) => a + (p.realized || 0), 0);
  const byClass = {};
  for (const p of open) byClass[p.cls] = (byClass[p.cls] || 0) + (p.value || 0);
  const gain = value - cost;
  return {
    value, cost, gain, gainPct: cost > 0 ? (gain / cost) * 100 : 0,
    dayChange, dayChangePct: value - dayChange > 0 ? (dayChange / (value - dayChange)) * 100 : 0,
    realized, byClass, count: open.length,
  };
}

/** % por clase de activo. */
export function classWeights(byClass) {
  const total = Object.values(byClass).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [k, v] of Object.entries(byClass)) out[k] = total > 0 ? (v / total) * 100 : 0;
  return out;
}

/**
 * Serie de evolución: valor de la cartera vs total invertido.
 * opts.histOf(key) → [{d, v}] | null (precios en moneda nativa)
 * opts.fxSeries → [{d, v}] (ARS por USD)
 * opts.valueAt(series, d)
 * opts.currentPrice(key) → precio actual (para interpolar activos sin histórico)
 */
export function evolution(txs, { histOf, fxSeries, valueAt, currentPrice, fxNow, display = 'ARS', today = todayStr(), maxPoints = 180 }) {
  if (!txs.length) return [];
  const sorted = sortTx(txs);
  const start = new Date(sorted[0].date);
  const end = new Date(today);
  const totalDays = Math.max(1, Math.round((end - start) / DAY));
  const step = Math.max(1, Math.ceil(totalDays / maxPoints));
  const dates = [];
  for (let t = start.getTime(); t <= end.getTime(); t += step * DAY) dates.push(todayStr(new Date(t)));
  if (dates[dates.length - 1] !== today) dates.push(today);

  const firstPrice = new Map();
  for (const tx of sorted) {
    const k = assetKey(tx);
    if (!firstPrice.has(k)) firstPrice.set(k, { d: tx.date, p: Number(tx.price) });
  }

  const points = [];
  for (const d of dates) {
    const fx = (fxSeries && valueAt(fxSeries, d)) || fxNow;
    const holdings = new Map();
    let invested = 0;
    // Recalcular holdings y costo hasta la fecha d
    const upTo = sorted.filter((tx) => tx.date <= d);
    const state = new Map();
    for (const tx of upTo) {
      const k = assetKey(tx);
      const s = state.get(k) || { qty: 0, cost: 0, tx };
      const txFx = Number(tx.fx) || fx;
      if (tx.side === 'sell') {
        if (s.qty > 0) {
          const frac = Math.min(1, Number(tx.qty) / s.qty);
          s.cost -= s.cost * frac; s.qty -= Math.min(s.qty, Number(tx.qty));
        }
      } else {
        s.qty += Number(tx.qty);
        s.cost += convert(grossAmount(tx) + (Number(tx.fees) || 0), tx.currency, display, txFx);
      }
      state.set(k, s);
    }
    let value = 0;
    for (const [k, s] of state) {
      invested += s.cost;
      if (s.qty <= 1e-9) continue;
      const tx = s.tx;
      let native;
      if (tx.kind === 'pf') native = plazoFijoValue(tx, d);
      else if (tx.kind === 'dolar') native = s.qty;
      else {
        let price = null;
        const hist = histOf(k);
        if (hist) price = valueAt(hist, d);
        if (price == null) {
          // Interpolación lineal entre el primer precio operado y el precio actual
          const fp = firstPrice.get(k);
          const cur = currentPrice(k) ?? fp.p;
          const span = Math.max(1, (end - new Date(fp.d)) / DAY);
          const pos = Math.max(0, (new Date(d) - new Date(fp.d)) / DAY);
          price = fp.p + (cur - fp.p) * Math.min(1, pos / span);
        }
        native = (s.qty * price) / (Number(tx.divisor) || 1);
      }
      value += convert(native, tx.currency, display, fx) || 0;
    }
    holdings.clear();
    points.push({ d, value, invested });
  }
  return points;
}

/** Inflación acumulada (en %) entre dos fechas, a partir de la serie mensual. */
export function accumulatedInflation(monthly, fromDate, toDate = todayStr()) {
  if (!monthly?.length) return null;
  const from = fromDate.slice(0, 7);
  const to = toDate.slice(0, 7);
  let acc = 1;
  for (const m of monthly) {
    const ym = m.fecha.slice(0, 7);
    if (ym >= from && ym <= to) acc *= 1 + m.valor / 100;
  }
  return (acc - 1) * 100;
}
