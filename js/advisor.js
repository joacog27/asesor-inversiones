// =====================================================================
// MOTOR DE REGLAS DEL ASESOR (funciones puras, sin DOM)
// =====================================================================
import { QUIZ, PROFILES, PROFILE_THRESHOLDS, PICKS, CLASSES, CLASS_ORDER, RULES } from './config.js';
import { LECAP_RE, lecapMaturity, prettyName } from './symbols.js';

// ---------------------------------------------------------------------
// 1) Test de perfil
// ---------------------------------------------------------------------
/** answers: { [questionId]: optionIndex } */
export function scoreQuiz(answers) {
  let pts = 0, max = 0;
  let cap = PROFILES.length - 1;
  const capReasons = [];
  for (const q of QUIZ) {
    const best = Math.max(...q.options.map((o) => o.pts));
    max += best;
    const opt = q.options[answers[q.id]];
    if (!opt) continue;
    pts += opt.pts;
    if (opt.cap != null && opt.cap < cap) {
      cap = opt.cap;
      capReasons.push(q.id);
    }
  }
  const score = Math.round((pts / max) * 100);
  let level = 0;
  PROFILE_THRESHOLDS.forEach((th, i) => { if (score >= th) level = i; });
  const uncapped = level;
  level = Math.min(level, cap);
  const get = (id) => QUIZ.find((q) => q.id === id).options[answers[id]]?.v;
  return {
    answers: { ...answers },
    score, level, uncappedLevel: uncapped, capReasons: uncapped > level ? capReasons : [],
    goal: get('goal'), horizon: get('horizon'), emergency: get('emergency'),
    knowledge: get('knowledge'), takenAt: new Date().toISOString(),
  };
}

export function profileInfo(profile) {
  return PROFILES[profile?.level ?? 2];
}

const CAP_TEXT = {
  goal: 'tu objetivo es de corto plazo o de emergencia',
  horizon: 'vas a necesitar la plata pronto',
  drawdown: 'preferís vender ante una caída fuerte',
};

export function capExplanation(profile) {
  if (!profile?.capReasons?.length) return null;
  const reasons = profile.capReasons.map((r) => CAP_TEXT[r]).filter(Boolean);
  return `Por tu puntaje correspondería un perfil ${PROFILES[profile.uncappedLevel].name.toLowerCase()}, pero lo ajustamos a ${PROFILES[profile.level].name.toLowerCase()} porque ${reasons.join(' y ')}.`;
}

// ---------------------------------------------------------------------
// 2) Asignación objetivo
// ---------------------------------------------------------------------
export function targetAllocation(profile) {
  const p = profileInfo(profile);
  const alloc = { ...p.alloc };
  const notes = [];
  if (profile?.goal === 'dolares' && alloc.rf_ars > 0) {
    const move = Math.max(0, alloc.rf_ars - 5);
    alloc.rf_ars -= move;
    alloc.rf_usd += move;
    notes.push(`Como tu objetivo es ahorrar en dólares, pasamos ${move}% de renta fija en pesos a renta fija en dólares.`);
  }
  if (profile?.goal === 'emergencia') {
    notes.push('Mientras armás tu fondo de emergencia, la prioridad es la liquidez: plata que puedas retirar en el día.');
  }
  return { alloc, notes };
}

// ---------------------------------------------------------------------
// 3) Plan del mes: reparte el aporte priorizando las clases que
//    quedaron por debajo de su objetivo (rebalanceo con aportes).
// ---------------------------------------------------------------------
export function monthlyPlan({ alloc, currentByClass = {}, amount, emergency }) {
  const out = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0]));
  const notes = [];
  if (!(amount > 0)) return { byClass: out, notes };

  let rest = amount;
  const emShare = emergency === 'no' ? RULES.emergencyShareIfNo : emergency === 'parcial' ? RULES.emergencyShareIfPartial : 0;
  if (emShare > 0) {
    const em = (amount * emShare) / 100;
    out.liquidez += em;
    rest -= em;
    notes.push(`Destinamos ${emShare}% del aporte a liquidez para ${emergency === 'no' ? 'empezar' : 'completar'} tu fondo de emergencia (ideal: 3 a 6 meses de gastos).`);
  }

  const currentTotal = CLASS_ORDER.reduce((a, c) => a + (currentByClass[c] || 0), 0);
  const total = currentTotal + rest;
  const need = {};
  let sumNeed = 0;
  for (const c of CLASS_ORDER) {
    need[c] = Math.max(0, ((alloc[c] || 0) / 100) * total - (currentByClass[c] || 0));
    sumNeed += need[c];
  }
  if (currentTotal > 0 && sumNeed > 0) {
    if (sumNeed >= rest) {
      for (const c of CLASS_ORDER) out[c] += (rest * need[c]) / sumNeed;
      notes.push('Este mes el aporte va a las clases que quedaron por debajo de tu objetivo, así rebalanceás sin vender nada.');
    } else {
      const extra = rest - sumNeed;
      for (const c of CLASS_ORDER) out[c] += need[c] + (extra * (alloc[c] || 0)) / 100;
    }
  } else {
    for (const c of CLASS_ORDER) out[c] += (rest * (alloc[c] || 0)) / 100;
  }
  return { byClass: out, notes };
}

// ---------------------------------------------------------------------
// 4) Instrumentos concretos por clase según el mercado
//    ctx = { level, list(kind) → [...], quote(kind, symbol), topMM: [...], indicators, today }
// ---------------------------------------------------------------------
export function pickInstruments(cls, ctx) {
  const notes = [];
  let picks = (PICKS[cls] || []).filter((p) => p.minProfile == null || ctx.level >= p.minProfile).map((p) => ({ ...p }));

  // Ajustes por contexto de mercado
  const ind = ctx.indicators || {};
  if (cls === 'rf_ars' && ind.inflacion?.length >= 4) {
    const arr = ind.inflacion.map((x) => x.valor);
    const last = arr[arr.length - 1];
    const prev3 = arr.slice(-4, -1).reduce((a, b) => a + b, 0) / 3;
    const lecap = picks.find((p) => p.kind === 'letra');
    const cer = picks.find((p) => p.kind === 'bono');
    if (lecap && cer) {
      if (last > prev3 + 0.3) {
        cer.weight = 70; lecap.weight = 30;
        notes.push(`La inflación del último mes (${last.toFixed(1)}%) subió frente al promedio previo (${prev3.toFixed(1)}%): conviene más el bono CER, que ajusta por inflación.`);
      } else if (last < prev3 - 0.3) {
        lecap.weight = 70; cer.weight = 30;
        notes.push(`La inflación viene bajando (${last.toFixed(1)}% vs ${prev3.toFixed(1)}% promedio): una LECAP a tasa fija te deja "trabar" una tasa más alta.`);
      }
    }
  }
  if (cls === 'rf_usd' && ind.riesgoPais?.valor > RULES.riesgoPaisAlto) {
    const on = picks.find((p) => p.kind === 'on');
    const sob = picks.find((p) => p.kind === 'bono');
    if (on && sob) {
      on.weight = 70; sob.weight = 30;
      notes.push(`El riesgo país está alto (${ind.riesgoPais.valor} pb): priorizamos ONs de empresas sobre bonos del Estado.`);
    }
  }

  const resolved = [];
  for (const p of picks) {
    const r = resolvePick(p, ctx);
    if (r) resolved.push(r);
  }
  const sumW = resolved.reduce((a, r) => a + r.weight, 0) || 1;
  for (const r of resolved) r.weight = (r.weight / sumW) * 100;
  return { picks: resolved, notes };
}

function resolvePick(p, ctx) {
  const base = { kind: p.kind, weight: p.weight, why: p.why, label: p.name };
  if (p.kind === 'fci') {
    const mm = ctx.topMM?.[0];
    if (!mm) return { ...base, symbol: null, name: 'FCI Money Market (el de tu banco o broker)', price: null, currency: 'ARS', divisor: 1, generic: true };
    const tnaTxt = mm.tna != null ? ` Hoy rinde aprox. ${(mm.tna * 100).toFixed(1)}% TNA.` : '';
    return { ...base, symbol: mm.symbol, name: mm.name, price: mm.price, currency: mm.currency, divisor: 1, why: p.why + tnaTxt, tna: mm.tna };
  }
  if (p.pick === 'liquid') {
    const list = ctx.list(p.kind) || [];
    let cands = list;
    if (p.filter === 'lecap') {
      const minDate = new Date(new Date(ctx.today || Date.now()).getTime() + 60 * 86400000);
      cands = list.filter((x) => LECAP_RE.test(x.symbol) && lecapMaturity(x.symbol) >= minDate);
    }
    if (p.filter === 'usd') cands = list.filter((x) => x.currency === 'USD' && x.symbol.endsWith('D'));
    const best = [...cands].sort((a, b) => b.volume - a.volume)[0];
    if (!best) return { ...base, symbol: null, name: p.name, price: null, currency: 'ARS', divisor: 100, generic: true };
    return { ...base, symbol: best.symbol, name: `${p.name} · ${best.symbol}`, price: best.price, currency: best.currency, divisor: best.divisor };
  }
  for (const sym of [p.symbol, ...(p.alt || [])]) {
    const q = ctx.quote(p.kind, sym);
    if (q) return { ...base, symbol: sym, name: p.name || prettyName(p.kind, sym), price: q.price, currency: q.currency, divisor: q.divisor || 1 };
  }
  return { ...base, symbol: p.symbol, name: p.name, price: null, currency: p.kind === 'cripto' ? 'USD' : 'ARS', divisor: 1 };
}

/**
 * Plan completo con instrumentos y cantidades aproximadas.
 * amount en `currency`; fx = ARS por USD.
 */
const FRACTIONAL = new Set(['cripto', 'fci']);

function sizeItems(picks, amt, currency, fx) {
  const sumW = picks.reduce((a, p) => a + p.weight, 0) || 1;
  return picks.map((p) => {
    const itemAmt = (amt * p.weight) / sumW;
    let qty = null;
    if (p.price > 0 && fx) {
      const inNative = p.currency === currency ? itemAmt : currency === 'ARS' ? itemAmt / fx : itemAmt * fx;
      qty = (inNative * (p.divisor || 1)) / p.price;
      if (!FRACTIONAL.has(p.kind)) qty = Math.floor(qty);
    }
    return { ...p, amount: itemAmt, qty, weight: (p.weight / sumW) * 100 };
  });
}

export function buildPlanDetail({ byClass, currency, fx, ctx }) {
  const rowsByCls = {};
  const notes = [];
  let carry = 0; // lo que no alcanza para comprar ni 1 unidad → liquidez
  const carried = [];

  for (const cls of CLASS_ORDER.filter((c) => c !== 'liquidez')) {
    const amt = byClass[cls] || 0;
    if (amt <= 0.0001) continue;
    const { picks, notes: n } = pickInstruments(cls, ctx);
    notes.push(...n);
    // Consolidar: si un instrumento no llega a 1 unidad, su parte va a los demás de la clase
    let active = [...picks];
    let items = sizeItems(active, amt, currency, fx);
    while (active.length > 1 && items.some((it) => it.qty === 0)) {
      const tooSmall = items.filter((it) => it.qty === 0).sort((a, b) => b.price / (b.divisor || 1) - a.price / (a.divisor || 1))[0];
      active = active.filter((p) => p.symbol !== tooSmall.symbol || p.kind !== tooSmall.kind);
      items = sizeItems(active, amt, currency, fx);
    }
    if (items.length === 1 && items[0].qty === 0) {
      carry += amt;
      carried.push(CLASSES[cls].short);
      continue;
    }
    rowsByCls[cls] = { cls, amount: amt, items, dropped: picks.length - items.length };
  }

  const liqAmt = (byClass.liquidez || 0) + carry;
  if (liqAmt > 0.0001) {
    const { picks } = pickInstruments('liquidez', ctx);
    rowsByCls.liquidez = { cls: 'liquidez', amount: liqAmt, items: sizeItems(picks, liqAmt, currency, fx), carry };
  }
  if (carried.length) {
    notes.push(`Este mes el aporte no alcanza para comprar ni una unidad de ${carried.join(', ')}: esa parte queda en liquidez (money market) y la usás el mes que viene.`);
  }
  if (Object.values(rowsByCls).some((r) => r.dropped > 0)) {
    notes.push('Para que el plan sea práctico, concentramos cada parte en menos instrumentos cuando el monto no alcanza para comprar todos.');
  }
  const rows = CLASS_ORDER.map((c) => rowsByCls[c]).filter(Boolean);
  return { rows, notes };
}

// ---------------------------------------------------------------------
// 5) Novedades (feed generado por reglas)
// ctx = { fx, fxCasa, fxWeekAgo, dolares, indicators, profile, alloc,
//         currentWeights, hasPortfolio, positions, seen, monthHasBuy, topMM }
// ---------------------------------------------------------------------
export function buildNews(ctx) {
  const items = [];
  const ind = ctx.indicators || {};
  const pct = (a, b) => ((a / b) - 1) * 100;

  if (ctx.fx && ctx.fxWeekAgo) {
    const ch = pct(ctx.fx, ctx.fxWeekAgo);
    if (Math.abs(ch) >= RULES.fxMoveWeekPct) {
      items.push({
        level: ch > 0 ? 'warn' : 'info', icon: '💵',
        title: `El dólar ${ch > 0 ? 'subió' : 'bajó'} ${Math.abs(ch).toFixed(1)}% en la semana`,
        text: ch > 0
          ? 'Tus activos en dólares valen más en pesos. Si estás por comprar dólares, considerá hacerlo en partes (no todo junto).'
          : 'Es un buen momento relativo para sumar activos en dólares (bonos, CEDEARs), si encaja con tu plan.',
      });
    }
  }
  if (ctx.seen?.fx && ctx.fx) {
    const ch = pct(ctx.fx, ctx.seen.fx);
    if (Math.abs(ch) >= 1) {
      items.push({ level: 'info', icon: '🔁', title: `Desde tu última visita el dólar ${ch > 0 ? 'subió' : 'bajó'} ${Math.abs(ch).toFixed(1)}%`, text: `Pasó de $${Math.round(ctx.seen.fx)} a $${Math.round(ctx.fx)}.` });
    }
  }

  const d = ctx.dolares;
  if (d?.contadoconliqui?.venta && d?.oficial?.venta) {
    const brecha = pct(d.contadoconliqui.venta, d.oficial.venta);
    if (brecha >= RULES.brechaAltaPct) {
      items.push({ level: 'warn', icon: '📐', title: `La brecha cambiaria está en ${brecha.toFixed(0)}%`, text: 'Una brecha alta suele indicar tensión cambiaria. Los CEDEARs y bonos en dólares te cubren de una suba del CCL.' });
    }
  }

  if (ind.inflacionMensual) {
    const infl = ind.inflacionMensual.valor;
    const mm = ctx.topMM?.[0]?.tna;
    const pf = ind.plazoFijo?.bna?.tna || ind.plazoFijo?.mejor?.tna;
    const ref = mm || pf;
    if (ref) {
      const mensual = (ref * 100) / 12;
      const gana = mensual > infl;
      items.push({
        level: gana ? 'good' : 'warn', icon: gana ? '📈' : '📉',
        title: `Inflación ${infl.toFixed(1)}% mensual vs ${mm ? 'money market' : 'plazo fijo'} ${mensual.toFixed(1)}% mensual`,
        text: gana
          ? 'Hoy las colocaciones en pesos le ganan (apenas) a la inflación: sirven para la parte líquida.'
          : 'Hoy las tasas en pesos no le ganan a la inflación: no dejes plata quieta en pesos más allá de tu fondo de emergencia.',
      });
    }
  }
  if (ind.riesgoPais?.valor) {
    const rp = ind.riesgoPais.valor;
    if (rp > RULES.riesgoPaisAlto) items.push({ level: 'warn', icon: '🇦🇷', title: `Riesgo país alto: ${rp} pb`, text: 'Los bonos argentinos pagan mucho pero con más riesgo. Diversificá con ONs y CEDEARs.' });
  }

  // Desvío de la cartera vs objetivo
  if (ctx.hasPortfolio && ctx.alloc && ctx.currentWeights) {
    const drifts = CLASS_ORDER
      .map((c) => ({ c, diff: (ctx.currentWeights[c] || 0) - (ctx.alloc[c] || 0) }))
      .filter((x) => Math.abs(x.diff) >= RULES.rebalanceDriftPct)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    if (drifts.length) {
      const over = drifts.filter((x) => x.diff > 0).map((x) => `${CLASSES[x.c].short} (+${x.diff.toFixed(0)} pp)`);
      const under = drifts.filter((x) => x.diff < 0).map((x) => `${CLASSES[x.c].short} (${x.diff.toFixed(0)} pp)`);
      items.push({
        level: 'warn', icon: '⚖️', title: 'Tu cartera se desvió de tu objetivo',
        text: `${over.length ? `Te sobra: ${over.join(', ')}. ` : ''}${under.length ? `Te falta: ${under.join(', ')}. ` : ''}El plan del mes ya dirige tu aporte a lo que falta.`,
      });
    }
  }

  // Movimientos fuertes de activos de la cartera
  for (const p of ctx.positions || []) {
    if (p.closed) continue;
    if (p.pct != null && Math.abs(p.pct) >= 5) {
      items.push({ level: p.pct > 0 ? 'good' : 'warn', icon: p.pct > 0 ? '🟢' : '🔻', title: `${p.symbol} ${p.pct > 0 ? 'sube' : 'cae'} ${Math.abs(p.pct).toFixed(1)}% hoy`, text: p.pct > 0 ? 'Buen día para este activo de tu cartera.' : 'Las caídas de corto plazo son normales. Si tu horizonte es largo, no hace falta hacer nada.' });
    }
    if (p.change30 != null && Math.abs(p.change30) >= RULES.bigMove30dPct) {
      items.push({ level: p.change30 > 0 ? 'good' : 'warn', icon: '🗓️', title: `${p.symbol} ${p.change30 > 0 ? 'subió' : 'cayó'} ${Math.abs(p.change30).toFixed(0)}% en 30 días`, text: p.change30 > 0 ? 'Revisá que no haya quedado sobreponderado respecto de tu objetivo.' : 'Si sigue encajando con tu plan, el aporte mensual te permite promediar a precios más bajos.' });
    }
    if (p.kind === 'pf' && p.maturity && p.maturity <= ctx.today) {
      items.push({ level: 'info', icon: '⏰', title: `Venció tu plazo fijo (${p.name})`, text: 'Registrá la venta/cobro y decidí si lo renovás o lo pasás a otro instrumento.' });
    }
  }

  if (ctx.profile?.emergency === 'no') {
    items.push({ level: 'info', icon: '🛟', title: 'Primero, tu fondo de emergencia', text: 'Antes de arriesgar, tené entre 3 y 6 meses de gastos en algo líquido (money market o cuenta remunerada).' });
  }
  if (ctx.monthlyAmount > 0 && !ctx.monthHasBuy) {
    items.push({ level: 'info', icon: '📅', title: 'Todavía no registraste tu aporte de este mes', text: 'Revisá el plan del mes y, cuando compres, tocá "Ya lo compré" para cargarlo a tu cartera.' });
  }
  if (!items.length) items.push({ level: 'good', icon: '✅', title: 'Sin novedades importantes', text: 'Tu plan sigue en marcha. Volvé a mirar en unos días.' });
  return items;
}
