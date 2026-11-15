// =====================================================================
// SIMULADOR DE PROYECCIÓN Y METAS (funciones puras, sin DOM)
// Todo se calcula en DÓLARES REALES ("plata de hoy"): los aportes se
// suponen constantes en poder de compra y los rendimientos ya descuentan
// la inflación. Así el resultado se entiende sin pensar en devaluación.
// =====================================================================
import { CLASS_RETURNS, ASSUMED_CORRELATION, SIM_RUNS, CLASS_ORDER } from './config.js';

/** Rendimiento y volatilidad anual esperados de una asignación (% por clase). */
export function portfolioStats(alloc, returns = CLASS_RETURNS, rho = ASSUMED_CORRELATION) {
  const w = CLASS_ORDER.map((c) => (alloc[c] || 0) / 100);
  const mu = CLASS_ORDER.reduce((a, c, i) => a + w[i] * (returns[c]?.mu || 0), 0);
  let variance = 0;
  for (let i = 0; i < w.length; i++) {
    for (let j = 0; j < w.length; j++) {
      const si = returns[CLASS_ORDER[i]]?.sigma || 0;
      const sj = returns[CLASS_ORDER[j]]?.sigma || 0;
      variance += w[i] * w[j] * si * sj * (i === j ? 1 : rho);
    }
  }
  return { mu, sigma: Math.sqrt(Math.max(0, variance)) };
}

// Generador pseudoaleatorio con semilla (resultados estables entre recargas)
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Monte Carlo mensual.
 * Devuelve por año: p10, p50, p90 y total aportado; y el detalle final.
 */
export function simulate({ initial = 0, monthly = 0, years = 10, mu, sigma, runs = SIM_RUNS, seed = 42, target = null }) {
  const months = Math.max(1, Math.round(years * 12));
  const sm = sigma / Math.sqrt(12);
  const drift = Math.log(1 + mu) / 12 - (sm * sm) / 2;
  const rand = mulberry32(seed);
  const yearly = Array.from({ length: Math.ceil(months / 12) + 1 }, () => []);
  const finals = new Float64Array(runs);
  for (let r = 0; r < runs; r++) {
    let v = initial;
    yearly[0].push(v);
    for (let m = 1; m <= months; m++) {
      v = v * Math.exp(drift + sm * gaussian(rand)) + monthly;
      if (m % 12 === 0 || m === months) yearly[Math.ceil(m / 12)].push(v);
    }
    finals[r] = v;
  }
  const points = yearly.map((vals, y) => {
    const s = [...vals].sort((a, b) => a - b);
    const m = Math.min(months, y * 12);
    return { year: y, month: m, p10: percentile(s, 0.1), p50: percentile(s, 0.5), p90: percentile(s, 0.9), contributed: initial + monthly * m };
  });
  const sortedFinal = [...finals].sort((a, b) => a - b);
  const result = {
    points,
    final: { p10: percentile(sortedFinal, 0.1), p50: percentile(sortedFinal, 0.5), p90: percentile(sortedFinal, 0.9) },
    contributed: initial + monthly * months,
    probLoss: finals.filter((v) => v < initial + monthly * months).length / runs,
  };
  if (target != null) result.probTarget = finals.filter((v) => v >= target).length / runs;
  return result;
}

/** Valor futuro determinístico (rendimiento constante). */
export function futureValue({ initial = 0, monthly = 0, years, mu }) {
  const n = Math.round(years * 12);
  const r = Math.pow(1 + mu, 1 / 12) - 1;
  if (Math.abs(r) < 1e-12) return initial + monthly * n;
  const g = Math.pow(1 + r, n);
  return initial * g + monthly * ((g - 1) / r);
}

/** Aporte mensual necesario para llegar a `target` en `years` con rendimiento `mu`. */
export function requiredMonthly({ target, initial = 0, years, mu }) {
  const n = Math.max(1, Math.round(years * 12));
  const r = Math.pow(1 + mu, 1 / 12) - 1;
  const g = Math.pow(1 + r, n);
  const remaining = target - initial * g;
  if (remaining <= 0) return 0;
  if (Math.abs(r) < 1e-12) return remaining / n;
  return (remaining * r) / (g - 1);
}

/** Meses estimados para llegar a `target` (null si no llega en 100 años). */
export function monthsToTarget({ target, initial = 0, monthly = 0, mu }) {
  if (initial >= target) return 0;
  const r = Math.pow(1 + mu, 1 / 12) - 1;
  let v = initial;
  for (let m = 1; m <= 1200; m++) {
    v = v * (1 + r) + monthly;
    if (v >= target) return m;
  }
  return null;
}

/** Años (decimales) entre hoy y una fecha 'YYYY-MM-DD'. */
export function yearsUntil(dateStr, today = new Date()) {
  const d = new Date(`${dateStr}T12:00:00`);
  return Math.max(0, (d - today) / (365.25 * 86400000));
}

/**
 * Estado de una meta.
 * goal: { target, currency, date, share }  (share = % de la cartera y de los aportes)
 * ctx:  { portfolioUSD, monthlyUSD, fx, mu, sigma }
 */
export function goalStatus(goal, ctx) {
  const share = (Number(goal.share) || 0) / 100;
  const targetUSD = goal.currency === 'USD' ? Number(goal.target) : Number(goal.target) / (ctx.fx || 1);
  const currentUSD = ctx.portfolioUSD * share;
  const monthlyUSD = ctx.monthlyUSD * share;
  const years = yearsUntil(goal.date, ctx.today);
  const progress = targetUSD > 0 ? Math.min(100, (currentUSD / targetUSD) * 100) : 0;
  const needed = requiredMonthly({ target: targetUSD, initial: currentUSD, years, mu: ctx.mu });
  const eta = monthsToTarget({ target: targetUSD, initial: currentUSD, monthly: monthlyUSD, mu: ctx.mu });
  const sim = years > 0
    ? simulate({ initial: currentUSD, monthly: monthlyUSD, years, mu: ctx.mu, sigma: ctx.sigma, runs: 400, seed: 7, target: targetUSD })
    : null;
  const prob = currentUSD >= targetUSD ? 1 : sim ? sim.probTarget : 0;
  let state = 'ok';
  if (progress >= 100) state = 'done';
  else if (years <= 0) state = 'late';
  else if (prob < 0.5) state = 'risk';
  else if (prob < 0.75) state = 'tight';
  return { targetUSD, currentUSD, monthlyUSD, years, progress, neededMonthlyUSD: needed, etaMonths: eta, prob, state };
}
