// =====================================================================
// VISTA: MI CARTERA
// =====================================================================
import * as store from '../storage.js';
import * as data from '../data.js';
import { CLASSES, CLASS_ORDER, KINDS, RULES } from '../config.js';
import { targetAllocation } from '../advisor.js';
import { evolution, accumulatedInflation, todayStr, assetKey, grossAmount } from '../portfolio.js';
import { esc, money, num, pct, delta, deltaMoney, classColor, donutChart, legendList, lineChart, cssVar, openModal, fmtDate, toast, confirmDialog } from '../ui.js';
import { openTxForm } from './txform.js';

let root, appRef, donutMode = 'class', evoToken = 0;

export function render(main, app) {
  root = main; appRef = app;
  const u = app.user();
  const cur = app.display();

  if (!u.transactions.length) {
    main.innerHTML = `
      <div class="page-head"><div><h1>Mi cartera</h1><p>Acá vas a ver en qué invertiste y cómo evoluciona tu plata.</p></div></div>
      <div class="card empty">
        <div class="big-emoji">💼</div>
        <h2>Todavía no cargaste inversiones</h2>
        <p class="mt">Cargá lo que ya tenés (CEDEARs, bonos, dólares, plazos fijos, cripto…) o seguí el plan del mes y tocá <b>“Ya lo compré”</b>.</p>
        <div class="row mt-lg" style="justify-content:center;flex-wrap:wrap">
          <button class="btn primary" data-add>＋ Agregar mi primera inversión</button>
          <a class="btn" href="#/asesor">Ver el plan del mes</a>
        </div>
      </div>`;
    main.querySelector('[data-add]').addEventListener('click', () => openTxForm(app, { onSaved: () => app.rerender() }));
    return;
  }

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Mi cartera</h1><p>Valores en <b>${cur === 'ARS' ? 'pesos' : 'dólares'}</b> (cambiá arriba a la derecha). Se actualiza sola con el mercado.</p></div>
      <button class="btn primary hide-mobile" data-add>＋ Agregar operación</button>
    </div>
    <div class="stats" data-stats></div>
    <div class="grid-2 mt">
      <section class="card" aria-labelledby="comp-h">
        <div class="card-head"><h2 id="comp-h">¿En qué está invertida?</h2>
          <div class="seg" role="group" aria-label="Agrupar por"><button data-dm="class" class="${donutMode === 'class' ? 'on' : ''}">Por tipo</button><button data-dm="asset" class="${donutMode === 'asset' ? 'on' : ''}">Por activo</button></div>
        </div>
        <div data-donut></div>
      </section>
      <section class="card" aria-labelledby="evo-h">
        <div class="card-head"><h2 id="evo-h">¿Cómo evolucionó?</h2></div>
        <div class="row small wrap" style="gap:14px">
          <span class="row"><span class="cls-dot" style="background:var(--series-1)"></span>Valor de la cartera</span>
          <span class="row"><span class="cls-dot" style="background:var(--text-3)"></span>Lo que pusiste (invertido)</span>
        </div>
        <div class="chart-box mt"><canvas data-evo aria-label="Evolución de la cartera"></canvas><div data-evo-msg class="empty" style="position:absolute;inset:0;display:grid;place-items:center">Calculando…</div></div>
        <p class="tiny mt" data-evo-note></p>
      </section>
    </div>
    <section class="card mt" aria-labelledby="pos-h">
      <div class="card-head"><h2 id="pos-h">Tus inversiones</h2><span class="sub">Tocá una para ver el detalle o editarla</span></div>
      <div data-positions></div>
    </section>
    <section class="card mt" aria-labelledby="reb-h">
      <div class="card-head"><div><h2 id="reb-h">Rebalanceo</h2><div class="sub">¿Tu cartera sigue tu distribución objetivo?</div></div></div>
      <div data-rebal></div>
    </section>
    <section class="card mt" aria-labelledby="hist-h">
      <details>
        <summary style="cursor:pointer"><h2 id="hist-h" style="display:inline">Historial de operaciones</h2> <span class="tiny">(${u.transactions.length})</span></summary>
        <div data-history class="mt"></div>
      </details>
    </section>
    <section class="card mt">
      <h3>¿Cómo leer esto?</h3>
      <ul class="small muted" style="padding-left:18px;margin:8px 0 0">
        <li><b>Invertido</b>: lo que pagaste por lo que tenés hoy, convertido con el dólar del día de cada compra.</li>
        <li><b>Ganancia</b>: cuánto vale hoy menos lo invertido. En pesos incluye la devaluación; en dólares muestra si realmente ganaste "en moneda dura".</li>
        <li><b>Hoy</b>: cuánto se movió tu cartera en el día según la variación de cada activo.</li>
      </ul>
    </section>
    <button class="fab" data-add aria-label="Agregar operación">＋ Agregar</button>`;

  main.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openTxForm(app, { onSaved: () => app.rerender() })));
  main.querySelectorAll('[data-dm]').forEach((b) => b.addEventListener('click', () => {
    donutMode = b.dataset.dm;
    main.querySelectorAll('[data-dm]').forEach((x) => x.classList.toggle('on', x === b));
    fillDonut();
  }));
  main.querySelector('[data-positions]').addEventListener('click', onPositionClick);
  main.querySelector('[data-history]').addEventListener('click', (e) => {
    const id = e.target.closest('[data-tx]')?.dataset.tx;
    if (!id) return;
    const tx = appRef.user().transactions.find((t) => t.id === id);
    if (tx) openTxForm(appRef, { tx, onSaved: () => appRef.rerender() });
  });

  fillStats();
  fillDonut();
  fillPositions();
  fillHistory();
  fillRebalance();
  fillEvolution();
}

export function update(what) {
  if (!root?.isConnected || !appRef.user().transactions.length) return;
  fillStats();
  fillPositions();
  fillRebalance();
  if (what === 'charts') { fillDonut(); fillEvolution(); }
  else if (what !== 'cripto') fillDonut();
}

// ---------------------------------------------------------------------
function fillStats() {
  const box = root.querySelector('[data-stats]');
  if (!box) return;
  const cur = appRef.display();
  const other = cur === 'ARS' ? 'USD' : 'ARS';
  const s = appRef.summary(cur);
  const so = appRef.summary(other);
  const u = appRef.user();
  const firstDate = [...u.transactions].sort((a, b) => (a.date < b.date ? -1 : 1))[0]?.date;
  const infl = cur === 'ARS' && firstDate ? accumulatedInflation(data.market.indicators?.inflacion, firstDate) : null;
  const realGain = infl != null && s.cost > 0 ? (((s.value / s.cost) / (1 + infl / 100)) - 1) * 100 : null;
  box.innerHTML = `
    <div class="stat hero"><div class="lbl">Valor actual</div><div class="val">${money(s.value, cur)}</div><div class="sub tiny">≈ ${money(so.value, other)}</div></div>
    <div class="stat"><div class="lbl">Invertido</div><div class="val">${money(s.cost, cur)}</div><div class="sub tiny">${s.count} activo${s.count === 1 ? '' : 's'}</div></div>
    <div class="stat"><div class="lbl">Ganancia / pérdida</div><div class="val">${deltaMoney(s.gain, cur)}</div><div class="sub">${delta(s.gainPct)}${realGain != null ? ` <span class="tiny">· real ${pct(realGain)}</span>` : ''}</div></div>
    <div class="stat"><div class="lbl">Hoy</div><div class="val">${deltaMoney(s.dayChange, cur)}</div><div class="sub">${delta(s.dayChangePct, { dec: 2 })}</div></div>
    ${s.realized ? `<div class="stat span-2"><div class="lbl">Ganancia ya realizada (ventas)</div><div class="val">${deltaMoney(s.realized, cur)}</div></div>` : ''}
    ${infl != null ? `<p class="tiny span-2" style="grid-column:1/-1">Inflación acumulada desde tu primera compra: <b>${pct(infl, { sign: false })}</b>. La ganancia "real" descuenta la inflación.</p>` : ''}`;
}

function fillDonut() {
  const box = root.querySelector('[data-donut]');
  if (!box) return;
  const cur = appRef.display();
  const pos = appRef.positions(cur).filter((p) => !p.closed && p.value > 0);
  let items;
  if (donutMode === 'class') {
    const by = {};
    pos.forEach((p) => { by[p.cls] = (by[p.cls] || 0) + p.value; });
    items = CLASS_ORDER.filter((c) => by[c] > 0).map((c) => ({ label: CLASSES[c].name, value: by[c], color: classColor(c) }));
  } else {
    // Máximo 7 activos con color propio + "Otros" (gris), nunca colores generados
    const top = pos.slice(0, 7);
    const rest = pos.slice(7).reduce((a, p) => a + p.value, 0);
    items = top.map((p, i) => ({ label: p.symbol.includes('|') ? p.name : p.symbol, value: p.value, color: cssVar(`--series-${i + 1}`) }));
    if (rest > 0) items.push({ label: 'Otros', value: rest, color: cssVar('--text-3') });
  }
  const total = items.reduce((a, b) => a + b.value, 0);
  box.innerHTML = `
    <div class="donut-wrap">
      <div class="donut-box"><canvas aria-label="Composición de la cartera"></canvas><div class="donut-center"><span><b class="num">${money(total, cur, { compact: true })}</b><span class="tiny">total</span></span></div></div>
      ${legendList(items, (v) => money(v, cur, { compact: true }))}
    </div>`;
  donutChart(box.querySelector('canvas'), { items, format: (v) => money(v, cur) });
}

function fillPositions() {
  const box = root.querySelector('[data-positions]');
  if (!box) return;
  const cur = appRef.display();
  const pos = appRef.positions(cur);
  const open = pos.filter((p) => !p.closed);
  const closed = pos.filter((p) => p.closed);
  const unit = (p) => (p.kind === 'fci' ? 'cuotapartes' : p.kind === 'dolar' ? 'US$' : p.divisor === 100 ? 'VN' : p.kind === 'pf' ? '' : 'u.');
  const label = (p) => (p.kind === 'fci' || p.kind === 'pf' || p.kind === 'manual' ? p.name : p.symbol);
  const sub = (p) => (p.kind === 'fci' || p.kind === 'pf' || p.kind === 'manual' || p.kind === 'dolar' ? KINDS[p.kind].label : p.name);

  const mobile = `<div class="pos-list hide-desktop">${open.map((p) => `
    <button class="pos-card" data-key="${esc(p.key)}">
      <div style="min-width:0"><div class="row"><span class="cls-dot" style="background:${classColor(p.cls)}"></span><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label(p))}</b></div>
        <div class="tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sub(p))}${p.kind !== 'pf' ? ` · ${num(p.qty)} ${unit(p)}` : ''}</div></div>
      <div class="r"><b class="num">${money(p.value, cur)}</b><div>${delta(p.gainPct)}</div></div>
      ${!p.hasPrice ? '<div class="tiny" style="grid-column:1/-1">⚠ Sin cotización: usando el último precio cargado</div>' : ''}
    </button>`).join('')}</div>`;

  const table = `<div class="table-wrap hide-mobile"><table>
    <thead><tr><th>Activo</th><th>Cantidad</th><th>Precio prom.</th><th>Precio actual</th><th>Hoy</th><th>Valor (${cur})</th><th>Ganancia</th><th>Peso</th></tr></thead>
    <tbody>${open.map((p) => `
      <tr class="clickable" data-key="${esc(p.key)}" tabindex="0">
        <td><div class="row"><span class="cls-dot" style="background:${classColor(p.cls)}"></span><div style="min-width:0"><b>${esc(label(p))}</b><div class="tiny">${esc(sub(p))}</div></div></div></td>
        <td class="num">${p.kind === 'pf' ? '—' : `${num(p.qty)} <span class="tiny">${unit(p)}</span>`}</td>
        <td class="num">${p.kind === 'pf' || p.kind === 'dolar' ? '—' : money(p.avgPrice, p.currency)}</td>
        <td class="num">${p.kind === 'pf' ? `<span class="tiny">vence ${fmtDate(p.maturity)}</span>` : p.kind === 'dolar' ? '—' : `${money(p.price, p.currency)}${!p.hasPrice ? ' <span title="Sin cotización">⚠</span>' : ''}`}</td>
        <td>${p.pct != null ? delta(p.pct) : '<span class="tiny">—</span>'}</td>
        <td class="num"><b>${money(p.value, cur)}</b></td>
        <td><div>${deltaMoney(p.gain, cur)}</div><div class="tiny">${pct(p.gainPct)}</div></td>
        <td class="num">${num(p.weight, 0)}%</td>
      </tr>`).join('')}</tbody></table></div>`;

  box.innerHTML = `${mobile}${table}
    ${closed.length ? `<p class="tiny mt">Posiciones cerradas (vendidas por completo): ${closed.map((p) => esc(label(p))).join(', ')}. Las ves en el historial.</p>` : ''}`;
  box.querySelectorAll('tr[data-key]').forEach((tr) => tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') tr.click(); }));
}

function fillRebalance() {
  const box = root.querySelector('[data-rebal]');
  if (!box) return;
  const u = appRef.user();
  if (!u.profile) { box.innerHTML = '<p class="small muted">Hacé el test de perfil para tener una distribución objetivo.</p>'; return; }
  const cur = appRef.display();
  const s = appRef.summary(cur);
  if (!(s.value > 0)) { box.innerHTML = ''; return; }
  const { alloc } = targetAllocation(u.profile);
  const rows = CLASS_ORDER.filter((c) => (alloc[c] || 0) > 0 || (s.byClass[c] || 0) > 0).map((c) => {
    const curVal = s.byClass[c] || 0;
    const curPct = (curVal / s.value) * 100;
    const tgtPct = alloc[c] || 0;
    const diff = (tgtPct / 100) * s.value - curVal;
    // Si todavía no tenés fondo de emergencia, la liquidez de más es intencional
    const keep = c === 'liquidez' && diff < 0 && u.profile.emergency !== 'si';
    return { c, curPct, tgtPct, diff, drift: keep ? 0 : curPct - tgtPct, keep };
  });
  const out = rows.filter((r) => Math.abs(r.drift) >= RULES.rebalanceDriftPct);
  const toBuy = rows.filter((r) => r.diff > 0 && Math.abs(r.drift) >= RULES.rebalanceDriftPct).reduce((a, r) => a + r.diff, 0);
  box.innerHTML = `
    ${out.length
      ? `<p class="small">Hay <b>${out.length}</b> ${out.length === 1 ? 'clase desviada' : 'clases desviadas'} más de ${RULES.rebalanceDriftPct} puntos de tu objetivo.</p>`
      : '<p class="small">✅ Tu cartera está balanceada: ninguna clase se desvía más de ' + RULES.rebalanceDriftPct + ' puntos.</p>'}
    <ul class="list rebal mt">${rows.map((r) => {
      const off = Math.abs(r.drift) >= RULES.rebalanceDriftPct;
      return `<li>
        <div><div class="row"><span class="cls-dot" style="background:${classColor(r.c)}"></span><b>${esc(CLASSES[r.c].name)}</b></div>
          <div class="tiny">Hoy ${num(r.curPct, 0)}% · objetivo ${num(r.tgtPct, 0)}%</div></div>
        <div class="act ${off ? (r.diff > 0 ? 'buy' : 'sell') : ''}">${off ? `${r.diff > 0 ? '▲ Comprar' : '▼ Vender'} ${money(Math.abs(r.diff), cur)}` : r.keep ? '<span class="tiny">🛟 tu fondo de emergencia</span>' : '<span class="tiny">✓ en rango</span>'}</div>
      </li>`;
    }).join('')}</ul>
    ${out.length ? `<p class="tiny mt">💡 Mejor que vender: dirigí tus próximos aportes a lo que falta (el plan del mes ya lo hace). Con aportes de ${money(u.settings.monthlyAmount || 0, u.settings.monthlyCurrency)} por mes, completar ${money(toBuy, cur)} te llevaría aprox. ${(() => { const m = u.settings.monthlyCurrency === cur ? u.settings.monthlyAmount : cur === 'ARS' ? u.settings.monthlyAmount * (appRef.fx() || 0) : u.settings.monthlyAmount / (appRef.fx() || 1); return m > 0 ? Math.max(1, Math.ceil(toBuy / m)) + ' mes(es)' : '—'; })()}. Vender puede generar comisiones e impuestos.</p>` : ''}`;
}

function fillHistory() {
  const box = root.querySelector('[data-history]');
  if (!box) return;
  const txs = [...appRef.user().transactions].sort((a, b) => (a.date > b.date ? -1 : 1));
  box.innerHTML = `<ul class="list">${txs.map((t) => `
    <li data-tx="${t.id}" style="cursor:pointer">
      <span class="badge" style="background:${t.side === 'buy' ? 'var(--up-soft)' : 'var(--down-soft)'}">${t.side === 'buy' ? 'Compra' : 'Venta'}</span>
      <div style="flex:1;min-width:0"><b>${esc(t.kind === 'fci' || t.kind === 'pf' || t.kind === 'manual' ? t.name : t.symbol)}</b>
        <div class="tiny">${fmtDate(t.date)} · ${t.kind === 'pf' ? `TNA ${pct(t.pf.tna * 100, { sign: false })} · ${t.pf.days} días` : `${num(t.qty)} × ${money(t.price, t.currency)}`}${t.note ? ` · ${esc(t.note)}` : ''}</div></div>
      <b class="num">${money(grossAmount(t) + (t.side === 'buy' ? (t.fees || 0) : -(t.fees || 0)), t.currency)}</b>
      <span class="tiny" aria-hidden="true">✎</span>
    </li>`).join('')}</ul>`;
}

async function fillEvolution() {
  const canvas = root.querySelector('[data-evo]');
  if (!canvas) return;
  const token = ++evoToken;
  const msg = root.querySelector('[data-evo-msg]');
  const note = root.querySelector('[data-evo-note]');
  const u = appRef.user();
  const cur = appRef.display();
  const keys = [...new Map(u.transactions.map((t) => [assetKey(t), t])).values()];
  const hist = new Map();
  const [fxSeries] = await Promise.all([
    data.loadFxHistory(appRef.fxCasa()),
    ...keys.filter((t) => KINDS[t.kind]?.hist).map(async (t) => {
      const h = await data.loadHistory(t.kind, t.symbol);
      if (h?.length) hist.set(assetKey(t), h);
    }),
  ]);
  if (token !== evoToken || !root.isConnected) return;
  const pts = evolution(u.transactions, {
    histOf: (k) => hist.get(k) || null,
    fxSeries, valueAt: data.valueAt,
    currentPrice: (k) => appRef.priceOf(k)?.price ?? null,
    fxNow: appRef.fx(), display: cur, today: todayStr(),
  });
  if (pts.length < 2) {
    msg.textContent = 'El gráfico aparece cuando tengas al menos un día de historia.';
    note.textContent = '';
    return;
  }
  msg.style.display = 'none';
  const long = (new Date(pts[pts.length - 1].d) - new Date(pts[0].d)) / 86400000 > 300;
  lineChart(canvas, {
    labels: pts.map((p) => new Date(`${p.d}T12:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', ...(long ? { year: '2-digit' } : {}) })),
    series: [
      { label: 'Valor', data: pts.map((p) => p.value), color: cssVar('--series-1'), fill: true },
      { label: 'Invertido', data: pts.map((p) => p.invested), color: cssVar('--text-3'), dashed: true, stepped: true },
    ],
    yFormat: (v) => money(v, cur, { compact: true }), tooltipFormat: (v) => money(v, cur),
  });
  const noHist = keys.filter((t) => !['pf', 'dolar'].includes(t.kind) && !hist.has(assetKey(t)));
  note.textContent = noHist.length
    ? `Para ${noHist.map((t) => (t.kind === 'fci' ? t.name : t.symbol)).slice(0, 4).join(', ')}${noHist.length > 4 ? '…' : ''} no hay histórico diario: se estima una evolución lineal entre tu compra y el precio actual.`
    : 'Calculado con los precios de cierre diarios de cada activo y el dólar de cada día.';
}

// ---------------------------------------------------------------------
function onPositionClick(e) {
  const el = e.target.closest('[data-key]');
  if (!el) return;
  const cur = appRef.display();
  const p = appRef.positions(cur).find((x) => x.key === el.dataset.key);
  if (p) openPosition(p, cur);
}

function openPosition(p, cur) {
  const isManual = p.kind === 'manual' || (!p.hasPrice && !['pf', 'dolar'].includes(p.kind));
  const title = p.kind === 'fci' || p.kind === 'pf' || p.kind === 'manual' ? p.name : `${p.symbol} · ${p.name}`;
  openModal({
    title,
    wide: true,
    body: `
      <div class="row wrap"><span class="badge"><span class="cls-dot" style="background:${classColor(p.cls)}"></span>${esc(CLASSES[p.cls]?.name || '')}</span><span class="badge">${esc(KINDS[p.kind]?.label || '')}</span><span class="badge">Cotiza en ${p.currency}</span></div>
      <div class="kpis mt">
        <div class="kpi"><div class="lbl">Valor hoy</div><div class="val num">${money(p.value, cur)}</div></div>
        <div class="kpi"><div class="lbl">Invertido</div><div class="val num">${money(p.cost, cur)}</div></div>
        <div class="kpi"><div class="lbl">Ganancia</div><div class="val">${deltaMoney(p.gain, cur)}</div><div class="sub">${pct(p.gainPct)}</div></div>
        <div class="kpi"><div class="lbl">${p.kind === 'pf' ? 'Vencimiento' : 'Cantidad'}</div><div class="val num">${p.kind === 'pf' ? fmtDate(p.maturity) : num(p.qty)}</div></div>
        <div class="kpi"><div class="lbl">${p.kind === 'pf' ? 'TNA' : 'Precio actual'}</div><div class="val num">${p.kind === 'pf' ? pct(p.txs[0].pf.tna * 100, { sign: false }) : money(p.price, p.currency)}</div>${p.kind !== 'pf' && p.kind !== 'dolar' ? `<div class="sub">Promedio de compra ${money(p.avgPrice, p.currency)}</div>` : ''}</div>
      </div>
      <p class="small muted mt">${esc(CLASSES[p.cls]?.desc || '')}</p>
      ${isManual && p.kind !== 'dolar' ? `
        <form class="row mt" data-manual>
          <label class="field" style="flex:1"><span>Actualizar precio actual (${p.currency}${p.divisor === 100 ? ', cada 100 VN' : ''})</span>
            <input type="number" step="any" min="0" name="mp" value="${p.price || ''}" /></label>
          <button class="btn" type="submit" style="align-self:end">Guardar precio</button>
        </form>` : ''}
      <h3 class="mt-lg">Operaciones</h3>
      <ul class="list">${p.txs.map((t) => `
        <li data-tx="${t.id}" style="cursor:pointer">
          <span class="badge" style="background:${t.side === 'buy' ? 'var(--up-soft)' : 'var(--down-soft)'}">${t.side === 'buy' ? 'Compra' : 'Venta'}</span>
          <div style="flex:1"><span class="small">${fmtDate(t.date)}</span><div class="tiny">${num(t.qty)} × ${money(t.price, t.currency)} · dólar ${money(t.fx, 'ARS')}</div></div>
          <b class="num">${money(grossAmount(t), t.currency)}</b><span class="btn ghost sm">Editar</span>
        </li>`).join('')}</ul>`,
    actions: `
      <button class="btn ghost" data-delall style="color:var(--down);margin-right:auto">Eliminar todo</button>
      ${p.kind !== 'pf' ? '<button class="btn" data-sell>Vender</button><button class="btn primary" data-buy>Comprar más</button>' : '<button class="btn primary" data-sell>Registrar cobro</button>'}`,
    onMount: (el, close) => {
      const done = () => appRef.rerender();
      const first = p.txs[0];
      el.querySelector('[data-buy]')?.addEventListener('click', () => { close(); openTxForm(appRef, { preset: { kind: p.kind, symbol: p.symbol }, onSaved: done }); });
      el.querySelector('[data-sell]')?.addEventListener('click', () => {
        close();
        if (p.kind === 'pf') {
          // Cobro de plazo fijo: venta por el valor final
          store.upsertTransactions([{ ...first, id: store.uid('tx'), pfId: first.pfId || first.id, side: 'sell', date: todayStr() > p.maturity ? p.maturity : todayStr(), qty: 1, price: p.valueNative, fx: appRef.fx(), fees: 0, note: 'Cobro plazo fijo' }]);
          toast('Plazo fijo cobrado');
          done();
          return;
        }
        openTxForm(appRef, { preset: { kind: p.kind, symbol: p.symbol, side: 'sell' }, onSaved: done });
      });
      el.querySelectorAll('[data-tx]').forEach((li) => li.addEventListener('click', () => {
        const tx = appRef.user().transactions.find((t) => t.id === li.dataset.tx);
        close();
        openTxForm(appRef, { tx, onSaved: done });
      }));
      el.querySelector('[data-manual]')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = Number(new FormData(e.target).get('mp'));
        if (!(v > 0)) return;
        store.updateUser((u) => { u.manualPrices[p.key] = v; });
        close(); toast('Precio actualizado'); done();
      });
      el.querySelector('[data-delall]').addEventListener('click', async () => {
        if (!(await confirmDialog(`¿Eliminar ${title} y todas sus operaciones?`, { ok: 'Eliminar', danger: true }))) return;
        const ids = new Set(p.txs.map((t) => t.id));
        store.removeTransactions([...ids]);
        store.updateUser((u) => { delete u.manualPrices[p.key]; });
        close(); toast('Eliminado'); done();
      });
    },
  });
}
