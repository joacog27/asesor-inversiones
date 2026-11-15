// =====================================================================
// VISTA: ASESOR (perfil, plan del mes, asignación, novedades)
// =====================================================================
import * as store from '../storage.js';
import * as data from '../data.js';
import { CLASSES, CLASS_ORDER, PROFILES, DISCLAIMER, KINDS } from '../config.js';
import { targetAllocation, monthlyPlan, buildPlanDetail, buildNews, capExplanation } from '../advisor.js';
import { classWeights, todayStr } from '../portfolio.js';
import { esc, money, num, pct, delta, classColor, donutChart, legendList, riskDots, fmtDate, debounce } from '../ui.js';
import { registerPlan } from './txform.js';
import { portfolioStats, goalStatus } from '../simulator.js';

let root, appRef, lastPlan = null, fxSeries = null, change30 = {};

export function render(main, app) {
  root = main; appRef = app;
  const u = app.user();
  const prof = PROFILES[u.profile.level];
  const cap = capExplanation(u.profile);
  const s = u.settings;

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Hola, ${esc(u.name)} 👋</h1><p>Tu plan de inversión, actualizado con el mercado de hoy.</p></div>
    </div>

    <section class="card profile-hero">
      <div class="row" style="align-items:flex-start;gap:14px">
        <div class="big-emoji" aria-hidden="true">${prof.emoji}</div>
        <div style="min-width:0">
          <div class="tiny">Tu perfil</div>
          <h2 style="font-size:1.3rem">${esc(prof.name)}</h2>
          <p class="small muted mt">${esc(prof.desc)}</p>
          ${cap ? `<p class="tiny mt">${esc(cap)}</p>` : ''}
        </div>
      </div>
      <div>
        <div class="meter" aria-label="Puntaje ${u.profile.score} de 100"><i style="left:${u.profile.score}%"></i></div>
        <div class="meter-labels"><span>Conservador</span><span>${u.profile.score}/100</span><span>Agresivo</span></div>
        <div class="row mt wrap"><span class="tiny">Test hecho el ${fmtDate(u.profile.takenAt)}</span><span class="spacer"></span><a class="btn sm" href="#/test">Rehacer test</a></div>
      </div>
    </section>

    <section class="card mt" aria-labelledby="kpi-h">
      <div class="card-head"><h2 id="kpi-h">El mercado hoy</h2><a class="btn ghost sm" href="#/mercado">Ver mercado →</a></div>
      <div class="kpis" data-kpis></div>
    </section>

    <section class="card mt" aria-labelledby="plan-h">
      <div class="card-head">
        <div><h2 id="plan-h">Tu plan de este mes</h2><div class="sub">Qué comprar con tu aporte, con precios actuales.</div></div>
      </div>
      <div class="amount-input">
        <label class="field" style="flex:1;min-width:160px"><span>Aporte de este mes</span>
          <input type="number" min="0" step="any" inputmode="decimal" data-amount value="${s.monthlyAmount || ''}" />
        </label>
        <label class="field"><span>Moneda</span>
          <select data-amount-cur><option value="ARS" ${s.monthlyCurrency === 'ARS' ? 'selected' : ''}>ARS</option><option value="USD" ${s.monthlyCurrency === 'USD' ? 'selected' : ''}>USD</option></select>
        </label>
      </div>
      <div data-plan class="mt"></div>
    </section>

    <div class="grid-2 mt">
      <section class="card" aria-labelledby="alloc-h">
        <div class="card-head"><h2 id="alloc-h">Tu distribución objetivo</h2></div>
        <div data-alloc></div>
      </section>
      <section class="card" aria-labelledby="news-h">
        <div class="card-head"><h2 id="news-h">Novedades para vos</h2><span class="sub" data-news-t></span></div>
        <div class="feed" data-news></div>
      </section>
    </div>

    <section class="card mt" aria-labelledby="glos-h">
      <h2 id="glos-h">¿En qué se invierte cada parte?</h2>
      <div class="mt">${CLASS_ORDER.map((c) => `
        <details class="glos">
          <summary><span class="cls-dot" style="background:${classColor(c)}"></span>${esc(CLASSES[c].name)} ${riskDots(CLASSES[c].risk)}</summary>
          <p>${esc(CLASSES[c].desc)}</p>
        </details>`).join('')}
      </div>
    </section>

    <p class="disclaimer">${esc(DISCLAIMER)}</p>`;

  const amountInput = main.querySelector('[data-amount]');
  const curSel = main.querySelector('[data-amount-cur]');
  const saveAmount = debounce(() => {
    store.updateUser((uu) => { uu.settings.monthlyAmount = Number(amountInput.value) || 0; uu.settings.monthlyCurrency = curSel.value; });
    fillPlan();
    fillNews();
  }, 350);
  amountInput.addEventListener('input', saveAmount);
  curSel.addEventListener('change', saveAmount);

  fillAll();
  loadExtras();
}

export function update(what) {
  if (!root?.isConnected) return;
  if (what === 'charts') { fillAlloc(); return; }
  fillKPIs();
  if (what !== 'cripto' || hasCryptoInPlan()) fillPlan();
  fillNews();
  fillAllocBars();
}

function hasCryptoInPlan() { return (lastPlan?.rows || []).some((r) => r.cls === 'cripto'); }

function fillAll() { fillKPIs(); fillPlan(); fillAlloc(); fillNews(); }

async function loadExtras() {
  // Dólar histórico (para "en la semana") y cambios a 30 días de lo que tenés
  fxSeries = await data.loadFxHistory(appRef.fxCasa());
  const positions = appRef.positions().filter((p) => !p.closed && KINDS[p.kind]?.hist);
  await Promise.allSettled(positions.slice(0, 15).map(async (p) => {
    const h = await data.loadHistory(p.kind, p.symbol);
    if (!h?.length) return;
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const old = data.valueAt(h, d30);
    if (old) change30[p.key] = ((h[h.length - 1].v / old) - 1) * 100;
  }));
  if (root?.isConnected) fillNews();
}

// ---------------------------------------------------------------------
function fillKPIs() {
  const box = root.querySelector('[data-kpis]');
  if (!box) return;
  const d = data.market.dolares;
  const ind = data.market.indicators || {};
  const mm = data.topMoneyMarket(1)[0];
  const kpi = (lbl, val, sub = '') => `<div class="kpi"><div class="lbl">${lbl}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const loading = '<span class="skeleton line" style="display:block;width:70%"></span>';
  box.innerHTML = [
    kpi('Dólar MEP', d ? money(d.bolsa?.venta, 'ARS') : loading, d ? `CCL ${money(d.contadoconliqui?.venta, 'ARS')}` : ''),
    kpi('Dólar oficial', d ? money(d.oficial?.venta, 'ARS') : loading, d ? `Blue ${money(d.blue?.venta, 'ARS')}` : ''),
    kpi('Inflación mensual', ind.inflacionMensual ? `${num(ind.inflacionMensual.valor, 2)}%` : loading, ind.inflacionInteranual ? `Interanual ${num(ind.inflacionInteranual.valor, 2)}%` : ''),
    kpi('Riesgo país', ind.riesgoPais ? `${num(ind.riesgoPais.valor, 0)} pb` : loading, ind.riesgoPais ? fmtDate(ind.riesgoPais.fecha) : ''),
    kpi('Money market', mm ? `${pct(mm.tna * 100, { sign: false })} TNA` : ind.plazoFijo?.bna ? `${pct(ind.plazoFijo.bna.tna * 100, { sign: false })}` : loading, mm ? `Plazo fijo BNA ${ind.plazoFijo?.bna ? pct(ind.plazoFijo.bna.tna * 100, { sign: false }) : '—'}` : 'Plazo fijo BNA'),
  ].join('');
}

function planContext(u) {
  return {
    level: u.profile.level,
    list: (kind) => data.market.panels[kind]?.list || [],
    quote: data.quote,
    topMM: data.topMoneyMarket(),
    indicators: data.market.indicators,
    today: todayStr(),
  };
}

function fillPlan() {
  const box = root.querySelector('[data-plan]');
  if (!box) return;
  const u = appRef.user();
  const amount = Number(u.settings.monthlyAmount) || 0;
  const cur = u.settings.monthlyCurrency || 'ARS';
  const fx = appRef.fx();
  if (!(amount > 0)) { box.innerHTML = '<p class="muted small">Ingresá cuánto querés invertir este mes para ver el plan.</p>'; return; }
  if (!fx) { box.innerHTML = '<div class="skeleton line"></div><div class="skeleton line"></div><div class="skeleton line"></div>'; return; }

  const { alloc } = targetAllocation(u.profile);
  const sum = appRef.summary(cur);
  const { byClass, notes } = monthlyPlan({ alloc, currentByClass: sum.byClass, amount, emergency: u.profile.emergency });
  const detail = buildPlanDetail({ byClass, currency: cur, fx, ctx: planContext(u) });
  lastPlan = detail;
  const allNotes = [...notes, ...detail.notes];

  box.innerHTML = `
    ${detail.rows.map((r) => `
      <div class="plan-class">
        <header><span class="cls-dot" style="background:${classColor(r.cls)}"></span><b>${esc(CLASSES[r.cls].name)}</b>
          <span class="num"><b>${money(r.amount, cur)}</b> <span class="tiny">${pct((r.amount / amount) * 100, { sign: false, dec: 0 })}</span></span></header>
        ${r.items.map((it) => `
          <div class="plan-item">
            <div style="min-width:0"><b>${esc(it.name)}</b>
              <div class="tiny">${it.price ? `Precio: ${money(it.price, it.currency)}${it.divisor === 100 ? ' c/100 VN' : ''}${it.qty != null ? ` · ≈ ${it.kind === 'cripto' || it.kind === 'fci' ? num(it.qty) : num(it.qty, 0)} ${it.kind === 'fci' ? 'cuotapartes' : it.divisor === 100 ? 'nominales' : 'unidades'}` : ''}` : 'Cargando precio…'}</div>
            </div>
            <div class="num" style="text-align:right"><b>${money(it.amount, cur)}</b></div>
            <p class="why">${esc(it.why || '')}${it.qty === 0 ? ' <b>El monto no alcanza para 1 unidad: juntalo con el próximo aporte o elegí otra opción.</b>' : ''}</p>
          </div>`).join('')}
      </div>`).join('')}
    ${allNotes.length ? `<ul class="small muted mt" style="padding-left:18px">${allNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <div class="row mt wrap">
      <span class="tiny">Precios con ~20 s de demora (BYMA). Las cantidades son aproximadas.</span>
      <span class="spacer"></span>
      <button class="btn primary" data-register>✓ Ya lo compré</button>
    </div>`;
  box.querySelector('[data-register]').addEventListener('click', () => registerPlan(appRef, detail.rows, cur, () => appRef.rerender()));
}

function fillAlloc() {
  const box = root.querySelector('[data-alloc]');
  if (!box) return;
  const u = appRef.user();
  const { alloc, notes } = targetAllocation(u.profile);
  const items = CLASS_ORDER.filter((c) => alloc[c] > 0).map((c) => ({ label: CLASSES[c].name, value: alloc[c], color: classColor(c), cls: c }));
  box.innerHTML = `
    <div class="donut-wrap">
      <div class="donut-box"><canvas aria-label="Distribución objetivo"></canvas><div class="donut-center"><span><b>${esc(PROFILES[u.profile.level].name)}</b><span class="tiny">objetivo</span></span></div></div>
      ${legendList(items)}
    </div>
    ${notes.map((n) => `<p class="small muted mt">${esc(n)}</p>`).join('')}
    <div data-alloc-bars class="mt-lg"></div>`;
  donutChart(box.querySelector('canvas'), { items, format: (v) => `${num(v, 0)}%` });
  fillAllocBars();
}

function fillAllocBars() {
  const box = root.querySelector('[data-alloc-bars]');
  if (!box) return;
  const u = appRef.user();
  const sum = appRef.summary();
  if (!sum.count) {
    box.innerHTML = '<p class="small muted">Cuando cargues tus inversiones en <a href="#/cartera">Mi cartera</a>, acá vas a ver si tu distribución real coincide con la objetivo.</p>';
    return;
  }
  const { alloc } = targetAllocation(u.profile);
  const real = classWeights(sum.byClass);
  box.innerHTML = `
    <h3>Real vs objetivo</h3>
    <p class="tiny">La barra es tu cartera hoy; la línea vertical, tu objetivo.</p>
    <div class="alloc-bars mt">${CLASS_ORDER.filter((c) => alloc[c] > 0 || real[c] > 0).map((c) => `
      <div class="alloc-row">
        <div class="lbl"><span class="row"><span class="cls-dot" style="background:${classColor(c)}"></span>${esc(CLASSES[c].short)}</span>
          <span class="num"><b>${num(real[c] || 0, 0)}%</b> <span class="tiny">/ ${num(alloc[c] || 0, 0)}%</span></span></div>
        <div class="bar"><span class="fill" style="width:${Math.min(100, real[c] || 0)}%;background:${classColor(c)}"></span><span class="target" style="left:${alloc[c] || 0}%"></span></div>
      </div>`).join('')}
    </div>`;
}

function fillNews() {
  const box = root.querySelector('[data-news]');
  if (!box) return;
  const u = appRef.user();
  const { alloc } = targetAllocation(u.profile);
  const positions = appRef.positions().map((p) => ({ ...p, change30: change30[p.key] ?? null }));
  const sum = appRef.summary();
  const fx = appRef.fx();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const month = todayStr().slice(0, 7);
  const items = buildNews({
    fx, fxWeekAgo: fxSeries ? data.valueAt(fxSeries, weekAgo) : null,
    dolares: data.market.dolares, indicators: data.market.indicators,
    profile: u.profile, alloc, currentWeights: classWeights(sum.byClass), hasPortfolio: sum.count > 0,
    positions, seen: appRef.prevSeen(), topMM: data.topMoneyMarket(),
    monthlyAmount: u.settings.monthlyAmount, monthHasBuy: u.transactions.some((t) => t.side === 'buy' && t.date.startsWith(month)),
    today: todayStr(),
  });
  // Metas en riesgo
  if (u.goals?.length && fx) {
    const { mu, sigma } = portfolioStats(alloc);
    const m = Number(u.settings.monthlyAmount) || 0;
    const monthlyUSD = u.settings.monthlyCurrency === 'USD' ? m : m / fx;
    const valueUSD = appRef.summary('USD').value || 0;
    for (const g of u.goals) {
      const st = goalStatus(g, { portfolioUSD: valueUSD, monthlyUSD, fx, mu, sigma });
      if (st.state === 'risk' || st.state === 'late') {
        const need = appRef.display() === 'ARS' ? money(st.neededMonthlyUSD * fx, 'ARS') : money(st.neededMonthlyUSD, 'USD');
        items.unshift({ level: 'warn', icon: g.emoji || '🎯', title: `Tu meta "${g.name}" está ${st.state === 'late' ? 'vencida' : 'en riesgo'}`, text: st.state === 'late' ? 'Pasó la fecha: editala para ponerle una nueva fecha o monto.' : `Probabilidad estimada ${Math.round(st.prob * 100)}%. Para llegar a tiempo necesitarías aportarle ~${need}/mes, o mover la fecha.` });
      } else if (st.state === 'done') {
        items.unshift({ level: 'good', icon: '🏆', title: `¡Llegaste a tu meta "${g.name}"!`, text: 'Felicitaciones. Podés crear una meta nueva o reasignar ese porcentaje.' });
      }
    }
  }
  box.innerHTML = items.map((n) => `
    <article class="news ${n.level}">
      <div class="ic" aria-hidden="true">${n.icon}</div>
      <div><h4>${esc(n.title)}</h4><p>${esc(n.text)}</p></div>
    </article>`).join('');
  const t = root.querySelector('[data-news-t]');
  if (t) t.textContent = 'Se actualiza solo';
}
