// =====================================================================
// VISTA: MERCADO EN VIVO
// =====================================================================
import * as store from '../storage.js';
import * as data from '../data.js';
import { MARKET_SECTIONS, KINDS, CRYPTO_LIST, FX_CASAS } from '../config.js';
import { esc, money, num, pct, delta, sparkline, openModal, lineChart, cssVar, timeAgo, fmtDate, toast, debounce } from '../ui.js';
import { openTxForm } from './txform.js';
import { openAlertForm } from './alerts.js';

let root, appRef;
const viewMode = {}; // sección -> 'cards' | 'heat'
const histCache = new Map(); // kind:symbol -> serie

const DOLAR_ORDER = ['oficial', 'bolsa', 'contadoconliqui', 'blue', 'cripto', 'tarjeta', 'mayorista'];
const DOLAR_NAMES = { bolsa: 'MEP', contadoconliqui: 'CCL', oficial: 'Oficial', blue: 'Blue', cripto: 'Cripto', tarjeta: 'Tarjeta', mayorista: 'Mayorista' };

export function render(main, app) {
  root = main; appRef = app;
  const u = app.user();
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Mercado en vivo</h1><p>Elegí qué querés seguir. Tocá cualquier activo para ver su gráfico.</p></div>
      <button class="btn sm" data-refresh>↻ Actualizar</button>
    </div>
    <div class="chips" role="group" aria-label="Secciones visibles">
      ${MARKET_SECTIONS.map((s) => `<button class="chip ${u.market.sections.includes(s.id) ? 'on' : ''}" data-sec="${s.id}" aria-pressed="${u.market.sections.includes(s.id)}"><span aria-hidden="true">${s.icon}</span>${esc(s.label)}</button>`).join('')}
    </div>
    <div data-sections class="grid mt"></div>
    <p class="tiny mt-lg">Fuentes gratuitas: BYMA vía data912 (~20 s de demora), Binance (cripto, cada 15 s), DolarApi y ArgentinaDatos. Los precios se muestran en la moneda en que cotiza cada activo.</p>`;

  main.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.sec;
    store.updateUser((uu) => {
      const s = new Set(uu.market.sections);
      s.has(id) ? s.delete(id) : s.add(id);
      uu.market.sections = MARKET_SECTIONS.map((x) => x.id).filter((x) => s.has(x));
    });
    b.classList.toggle('on');
    b.setAttribute('aria-pressed', b.classList.contains('on'));
    drawSections();
    app.ensureMarket();
    ensureData();
  }));
  main.querySelector('[data-refresh]').addEventListener('click', () => app.refreshAll());
  const secs = main.querySelector('[data-sections]');
  secs.addEventListener('click', onSectionClick);
  secs.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open][role=button]')) { e.preventDefault(); e.target.click(); }
  });

  drawSections();
  ensureData();
}

function ensureData() {
  const u = appRef.user();
  for (const s of u.market.sections) {
    if (KINDS[s]?.panel && !['crypto', 'fci'].includes(KINDS[s].panel) && !data.market.panels[s]) data.loadPanel(s).catch(() => {});
  }
  if (u.market.sections.includes('indicadores') && !data.market.indicators) data.loadIndicators().catch(() => {});
}

export function update(what) {
  if (!root?.isConnected) return;
  const u = appRef.user();
  if (what === 'dolares' && u.market.sections.includes('dolares')) fillSection('dolares');
  else if (what === 'indicators' || what === 'fci') fillSection('indicadores');
  else if (what === 'charts') fillSection('indicadores');
  else if (u.market.sections.includes(what)) {
    if (viewMode[what] === 'heat') fillSection(what);
    else patchPrices(what);
  }
}

function drawSections() {
  const u = appRef.user();
  const box = root.querySelector('[data-sections]');
  if (!u.market.sections.length) {
    box.innerHTML = '<div class="card empty"><div class="big-emoji">👆</div><p>Elegí arriba qué querés ver: dólares, CEDEARs, bonos, cripto…</p></div>';
    return;
  }
  box.innerHTML = MARKET_SECTIONS.filter((s) => u.market.sections.includes(s.id)).map((s) => `
    <section class="card" data-section="${s.id}" aria-labelledby="sec-${s.id}">
      <div class="card-head">
        <h2 id="sec-${s.id}"><span aria-hidden="true">${s.icon}</span> ${esc(s.label)}</h2>
        <div class="row">
          <span class="tiny" data-upd></span>
          ${s.kind ? `<div class="seg" role="group" aria-label="Vista"><button data-mode="cards" class="${viewMode[s.id] !== 'heat' ? 'on' : ''}">Mi lista</button><button data-mode="heat" class="${viewMode[s.id] === 'heat' ? 'on' : ''}">Mapa</button></div>` : ''}
        </div>
      </div>
      <div data-body></div>
    </section>`).join('');
  for (const s of u.market.sections) fillSection(s);
}

function sectionEl(id) { return root.querySelector(`[data-section="${id}"]`); }

function sourceInfo(id) {
  if (id === 'dolares') return { t: data.market.dolaresT, stale: data.market.dolaresStale };
  if (id === 'indicadores') return { t: data.market.indicators?.t };
  if (id === 'cripto') return data.market.crypto || {};
  return data.market.panels[id] || {};
}

function fillSection(id) {
  const sec = sectionEl(id);
  if (!sec) return;
  const body = sec.querySelector('[data-body]');
  const info = sourceInfo(id);
  sec.querySelector('[data-upd]').innerHTML = info.t ? `${info.stale ? '<span class="stale">⚠ sin conexión · </span>' : ''}${timeAgo(info.t)}` : '';
  if (id === 'dolares') body.innerHTML = dolaresHTML();
  else if (id === 'indicadores') { body.innerHTML = indicadoresHTML(); drawInflationChart(body); }
  else if (viewMode[id] === 'heat') body.innerHTML = heatHTML(id);
  else { body.innerHTML = cardsHTML(id); loadSparks(id); }
}

// ---------------------------------------------------------------------
function dolaresHTML() {
  const d = data.market.dolares;
  if (!d) return skeletonCards(4);
  const of = d.oficial?.venta;
  const casaSel = appRef.fxCasa();
  return `<div class="quotes">${DOLAR_ORDER.filter((c) => d[c]).map((c) => {
    const brecha = of && c !== 'oficial' && c !== 'mayorista' ? ((d[c].venta / of) - 1) * 100 : null;
    return `
      <div class="quote" style="cursor:default">
        <div class="q-top"><span class="sym">${DOLAR_NAMES[c] || c}</span>${c === casaSel ? '<span class="badge" title="Usado para convertir ARS/USD">Conversión</span>' : ''}</div>
        <div class="px num">${money(d[c].venta, 'ARS')}</div>
        <div class="tiny num">Compra ${money(d[c].compra, 'ARS')}</div>
        <div class="tiny">${brecha != null ? `Brecha ${pct(brecha, { dec: 0 })}` : '&nbsp;'}</div>
      </div>`;
  }).join('')}</div>
  <p class="tiny mt">Para convertir entre pesos y dólares se usa el dólar <b>${esc(FX_CASAS.find((f) => f.id === casaSel)?.label || casaSel)}</b> (cambialo en Ajustes).</p>`;
}

function indicadoresHTML() {
  const ind = data.market.indicators;
  if (!ind) return skeletonCards(3);
  const mm = data.topMoneyMarket(5);
  return `
    <div class="kpis">
      <div class="kpi"><div class="lbl">Inflación mensual</div><div class="val">${ind.inflacionMensual ? `${num(ind.inflacionMensual.valor, 2)}%` : '—'}</div><div class="sub">${ind.inflacionMensual ? fmtDate(ind.inflacionMensual.fecha) : ''}</div></div>
      <div class="kpi"><div class="lbl">Inflación interanual</div><div class="val">${ind.inflacionInteranual ? `${num(ind.inflacionInteranual.valor, 1)}%` : '—'}</div><div class="sub">últimos 12 meses</div></div>
      <div class="kpi"><div class="lbl">Riesgo país</div><div class="val">${ind.riesgoPais ? `${num(ind.riesgoPais.valor, 0)}` : '—'}</div><div class="sub">puntos básicos</div></div>
      <div class="kpi"><div class="lbl">Plazo fijo (BNA)</div><div class="val">${ind.plazoFijo?.bna ? pct(ind.plazoFijo.bna.tna * 100, { sign: false }) : '—'}</div><div class="sub">TNA · mejor: ${ind.plazoFijo?.mejor ? pct(ind.plazoFijo.mejor.tna * 100, { sign: false }) : '—'}</div></div>
      <div class="kpi"><div class="lbl">Cuenta remunerada</div><div class="val">${ind.cuentas?.[0] ? pct(ind.cuentas[0].tna * 100, { sign: false }) : '—'}</div><div class="sub">${esc(ind.cuentas?.[0]?.nombre || '')}</div></div>
    </div>
    <div class="grid-2 mt">
      <div>
        <h3>Inflación mensual (últimos 24 meses)</h3>
        <div class="chart-box sm mt"><canvas data-infl aria-label="Inflación mensual"></canvas></div>
      </div>
      <div>
        <h3>Money market más grandes (TNA estimada)</h3>
        ${mm.length ? `<ul class="list">${mm.map((f) => `<li><span style="flex:1;min-width:0">${esc(f.name)}</span><b class="num">${pct(f.tna * 100, { sign: false })}</b></li>`).join('')}</ul>` : '<p class="small muted mt">Cargando…</p>'}
        <p class="tiny">TNA calculada con la variación de la cuotaparte del último día hábil.</p>
      </div>
    </div>`;
}

function drawInflationChart(body) {
  const c = body.querySelector('[data-infl]');
  const ind = data.market.indicators;
  if (!c || !ind?.inflacion) return;
  const last = ind.inflacion.slice(-24);
  lineChart(c, {
    labels: last.map((x) => new Date(`${x.fecha}T12:00:00`).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })),
    series: [{ label: 'Inflación', data: last.map((x) => x.valor), color: cssVar('--series-2') }],
    yFormat: (v) => `${num(v, 1)}%`,
  });
}

// ---------------------------------------------------------------------
function itemsFor(id) {
  const u = appRef.user();
  const watch = u.market.watch[id] || [];
  if (id === 'cripto') return watch.map((s) => data.market.crypto?.map?.[s] || { kind: 'cripto', symbol: s, name: data.prettyName('cripto', s), price: null, currency: 'USD' });
  const panel = data.market.panels[id];
  return watch.map((s) => panel?.map?.[s] || { kind: id, symbol: s, name: data.prettyName(id, s), price: null, missing: !!panel });
}

function cardsHTML(id) {
  const items = itemsFor(id);
  const loaded = id === 'cripto' ? !!data.market.crypto : !!data.market.panels[id];
  if (!loaded && items.length) return skeletonCards(Math.min(items.length, 6));
  return `<div class="quotes">
    ${items.map((x) => quoteCard(id, x)).join('')}
    <button class="quote add" data-add="${id}">＋ Agregar</button>
  </div>
  ${id === 'letra' || id === 'on' ? '<p class="tiny mt">Bonos, letras y ONs cotizan cada 100 nominales.</p>' : ''}`;
}

function quoteCard(id, x) {
  const k = `${id}:${x.symbol}`;
  const hist = histCache.get(k);
  return `
    <div class="quote" role="button" tabindex="0" data-open="${esc(x.symbol)}" data-kind="${id}" data-key="${esc(k)}">
      <div class="q-top"><span class="sym">${esc(x.symbol)}</span><span data-pct>${x.price ? delta(x.pct) : ''}</span></div>
      <div class="nm">${esc(x.name || '')}${x.currency === 'USD' && id !== 'cripto' && id !== 'usa' ? ' · USD' : ''}</div>
      <div class="px num" data-px>${x.price ? money(x.price, x.currency) : x.missing ? '<span class="tiny">Sin cotización hoy</span>' : '—'}</div>
      <div data-spark>${sparkline(hist ? hist.slice(-30).map((p) => p.v) : null)}</div>
      <button class="icon-btn rm" data-rm="${esc(x.symbol)}" data-kind="${id}" aria-label="Quitar ${esc(x.symbol)} de la lista" title="Quitar">✕</button>
    </div>`;
}

function patchPrices(id) {
  const sec = sectionEl(id);
  if (!sec) return;
  const info = sourceInfo(id);
  sec.querySelector('[data-upd]').innerHTML = info.t ? `${info.stale ? '<span class="stale">⚠ sin conexión · </span>' : ''}${timeAgo(info.t)}` : '';
  if (sec.querySelector('.skeleton')) { fillSection(id); return; }
  for (const x of itemsFor(id)) {
    const card = sec.querySelector(`[data-key="${CSS.escape(`${id}:${x.symbol}`)}"]`);
    if (!card || !x.price) continue;
    const pxEl = card.querySelector('[data-px]');
    const prev = Number(card.dataset.last || 0);
    pxEl.innerHTML = money(x.price, x.currency);
    card.querySelector('[data-pct]').innerHTML = delta(x.pct);
    if (prev && prev !== x.price) {
      card.classList.remove('flash-up', 'flash-down');
      void card.offsetWidth;
      card.classList.add(x.price > prev ? 'flash-up' : 'flash-down');
    }
    card.dataset.last = x.price;
  }
}

async function loadSparks(id) {
  const items = itemsFor(id);
  for (const x of items) {
    const k = `${id}:${x.symbol}`;
    if (histCache.has(k)) continue;
    const h = await data.loadHistory(id, x.symbol);
    histCache.set(k, h || []);
    const card = root?.querySelector(`[data-key="${CSS.escape(k)}"] [data-spark]`);
    if (card && h?.length) card.innerHTML = sparkline(h.slice(-30).map((p) => p.v));
  }
}

function heatHTML(id) {
  let list;
  if (id === 'cripto') list = data.market.crypto?.list || [];
  else list = [...(data.market.panels[id]?.list || [])].sort((a, b) => b.volume - a.volume).slice(0, 48);
  if (!list.length) return skeletonCards(6);
  const up = cssVar('--up'), down = cssVar('--down');
  return `
    <p class="tiny">${id === 'cripto' ? 'Tus criptos' : 'Los 48 más operados del día'}, coloreados por variación diaria (verde sube ▲, rojo baja ▼).</p>
    <div class="heat mt">${list.map((x) => {
      const p = x.pct ?? 0;
      const a = Math.min(1, Math.abs(p) / 5) * 0.75 + 0.08;
      const col = p >= 0 ? up : down;
      return `<button data-open="${esc(x.symbol)}" data-kind="${id}" style="background:color-mix(in srgb, ${col} ${Math.round(a * 100)}%, var(--surface-2))" title="${esc(x.name)}">
        <b>${esc(x.symbol)}</b><span class="num">${p > 0 ? '▲' : p < 0 ? '▼' : '•'} ${pct(p, { sign: false })}</span></button>`;
    }).join('')}</div>`;
}

function skeletonCards(n) {
  return `<div class="quotes">${Array.from({ length: n }, () => '<div class="skeleton" style="height:120px"></div>').join('')}</div>`;
}

// ---------------------------------------------------------------------
function onSectionClick(e) {
  const mode = e.target.closest('[data-mode]');
  if (mode) {
    const sec = mode.closest('[data-section]').dataset.section;
    viewMode[sec] = mode.dataset.mode;
    mode.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === mode));
    fillSection(sec);
    return;
  }
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    e.stopPropagation();
    store.updateUser((u) => { u.market.watch[rm.dataset.kind] = (u.market.watch[rm.dataset.kind] || []).filter((s) => s !== rm.dataset.rm); });
    fillSection(rm.dataset.kind);
    return;
  }
  const add = e.target.closest('[data-add]');
  if (add) { openAddModal(add.dataset.add); return; }
  const open = e.target.closest('[data-open]');
  if (open) openDetail(open.dataset.kind, open.dataset.open);
}

function openAddModal(kind) {
  openModal({
    title: `Agregar a ${MARKET_SECTIONS.find((s) => s.id === kind)?.label}`,
    body: `<input type="search" placeholder="Buscar símbolo o nombre…" data-q autofocus /><div class="search-results" data-res></div>`,
    onMount: async (el, close) => {
      const input = el.querySelector('[data-q]');
      const res = el.querySelector('[data-res]');
      res.innerHTML = '<div class="skeleton line"></div><div class="skeleton line"></div>';
      let list = [];
      try { list = await data.searchList(kind); } catch { res.innerHTML = '<p class="small muted">No se pudo cargar la lista.</p>'; return; }
      const watch = new Set(appRef.user().market.watch[kind] || []);
      const draw = () => {
        const q = input.value.trim().toUpperCase();
        const items = list.filter((x) => !q || x.symbol.toUpperCase().includes(q) || (x.name || '').toUpperCase().includes(q)).slice(0, 60);
        res.innerHTML = items.map((x) => `
          <button data-s="${esc(x.symbol)}" ${watch.has(x.symbol) ? 'disabled' : ''}>
            <span><b>${esc(x.symbol)}</b> <span class="tiny">${esc(x.name !== x.symbol ? x.name : '')}${x.currency === 'USD' && kind !== 'usa' && kind !== 'cripto' ? ' · USD' : ''}</span></span>
            <span class="tiny">${watch.has(x.symbol) ? 'Ya está' : x.price ? money(x.price, x.currency) : ''}</span>
          </button>`).join('') || (kind === 'cripto' && q ? `<button data-free="${esc(q)}"><span>Agregar <b>${esc(q)}</b> (buscar en Binance)</span></button>` : '<p class="small muted" style="padding:8px">Sin resultados.</p>');
      };
      draw();
      input.addEventListener('input', debounce(draw, 100));
      res.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b || b.disabled) return;
        let sym = b.dataset.s;
        if (b.dataset.free) {
          if (!(await data.cryptoExists(b.dataset.free))) { toast(`No encontramos ${b.dataset.free} en Binance`, 'error'); return; }
          sym = b.dataset.free;
        }
        store.updateUser((u) => { u.market.watch[kind] = [...new Set([...(u.market.watch[kind] || []), sym])]; });
        close();
        toast(`${sym} agregado`);
        if (kind === 'cripto') { appRef.ensureMarket(); await data.loadCrypto(appRef.user().market.watch.cripto, true); }
        fillSection(kind);
      });
    },
  });
}

const RANGES = [
  { id: '1S', days: 7 }, { id: '1M', days: 31 }, { id: '3M', days: 92 }, { id: '6M', days: 183 }, { id: '1A', days: 366 }, { id: '5A', days: 1830 },
];

async function openDetail(kind, symbol) {
  const q = data.quote(kind, symbol);
  const name = q?.name || data.prettyName(kind, symbol);
  let range = '3M';
  openModal({
    title: `${symbol} · ${name}`,
    wide: true,
    body: `
      <div class="row wrap" style="align-items:baseline;gap:12px">
        <span style="font-size:1.6rem;font-weight:700" class="num">${q ? money(q.price, q.currency) : '—'}</span>
        ${q ? delta(q.pct) : ''} <span class="tiny">hoy</span>
      </div>
      <p class="tiny">${esc(KINDS[kind]?.label || '')}${q?.currency ? ` · cotiza en ${q.currency}` : ''}${q?.divisor === 100 ? ' · precio cada 100 nominales' : ''}${q?.volume ? ` · volumen ${money(q.volume, 'ARS', { compact: true }).replace('$ ', '')}` : ''}</p>
      <div class="seg mt" role="group" aria-label="Rango" data-ranges>${RANGES.map((r) => `<button data-r="${r.id}" class="${r.id === range ? 'on' : ''}">${r.id}</button>`).join('')}</div>
      <div class="chart-box mt"><canvas aria-label="Gráfico de precio de ${esc(symbol)}"></canvas><div data-chart-msg class="empty" style="position:absolute;inset:0;display:grid;place-items:center">Cargando histórico…</div></div>
      <div class="kpis mt" data-stats></div>`,
    actions: `<button class="btn" data-alert>🔔 Crear alerta</button><button class="btn primary" data-buy>＋ Registrar compra</button>`,
    onMount: async (el, close) => {
      el.querySelector('[data-buy]').addEventListener('click', () => { close(); openTxForm(appRef, { preset: { kind, symbol } }); });
      el.querySelector('[data-alert]').addEventListener('click', () => { close(); openAlertForm(appRef, { kind, symbol, name }); });
      const hist = histCache.get(`${kind}:${symbol}`)?.length ? histCache.get(`${kind}:${symbol}`) : await data.loadHistory(kind, symbol);
      if (hist?.length) histCache.set(`${kind}:${symbol}`, hist);
      const msg = el.querySelector('[data-chart-msg]');
      const canvas = el.querySelector('canvas');
      const draw = () => {
        if (!hist?.length) { msg.textContent = 'No hay histórico disponible para este activo.'; return; }
        msg.style.display = 'none';
        const days = RANGES.find((r) => r.id === range).days;
        const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
        const pts = hist.filter((p) => p.d >= from);
        const series = pts.length > 1 ? pts : hist.slice(-2);
        const first = series[0].v, last = series[series.length - 1].v;
        const color = last >= first ? cssVar('--up') : cssVar('--down');
        const cur = q?.currency || (kind === 'cripto' || kind === 'usa' ? 'USD' : 'ARS');
        lineChart(canvas, {
          labels: series.map((p) => new Date(`${p.d}T12:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', ...(days > 366 ? { year: '2-digit' } : {}) })),
          series: [{ label: symbol, data: series.map((p) => p.v), color, fill: true }],
          yFormat: (v) => num(v), tooltipFormat: (v) => money(v, cur),
        });
        const vals = series.map((p) => p.v);
        el.querySelector('[data-stats]').innerHTML = `
          <div class="kpi"><div class="lbl">Variación ${range}</div><div class="val">${delta(((last / first) - 1) * 100)}</div></div>
          <div class="kpi"><div class="lbl">Máximo ${range}</div><div class="val num">${money(Math.max(...vals), cur)}</div></div>
          <div class="kpi"><div class="lbl">Mínimo ${range}</div><div class="val num">${money(Math.min(...vals), cur)}</div></div>
          <div class="kpi"><div class="lbl">Último cierre</div><div class="val num">${money(last, cur)}</div><div class="sub">${fmtDate(series[series.length - 1].d)}</div></div>`;
      };
      el.querySelector('[data-ranges]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        range = b.dataset.r;
        el.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('on', x === b));
        draw();
      });
      draw();
    },
  });
}
