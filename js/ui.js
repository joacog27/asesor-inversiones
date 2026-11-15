// =====================================================================
// HELPERS DE INTERFAZ: formato, modales, toasts, sparklines y gráficos
// =====================================================================
import { CLASSES } from './config.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// Formato numérico (es-AR)
// ---------------------------------------------------------------------
const nf = (min, max) => new Intl.NumberFormat('es-AR', { minimumFractionDigits: min, maximumFractionDigits: max });
const NF0 = nf(0, 0), NF2 = nf(2, 2), NF4 = nf(2, 4), NF8 = nf(2, 8);

export function num(v, dec) {
  if (v == null || !isFinite(v)) return '—';
  if (dec === 0) return NF0.format(v);
  if (dec === 2) return NF2.format(v);
  const a = Math.abs(v);
  if (a >= 1000) return NF0.format(v);
  if (a >= 1) return NF2.format(v);
  if (a >= 0.01) return NF4.format(v);
  return NF8.format(v);
}

export function money(v, cur = 'ARS', { compact = false, sign = false } = {}) {
  if (v == null || !isFinite(v)) return '—';
  const prefix = cur === 'USD' ? 'US$' : '$';
  const s = sign && v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  let body;
  if (compact && a >= 1e9) body = `${nf(0, 1).format(a / 1e9)} mil M`;
  else if (compact && a >= 1e6) body = `${nf(0, 1).format(a / 1e6)} M`;
  else body = a >= 1000 || cur === 'ARS' ? (a >= 100 ? NF0.format(a) : NF2.format(a)) : NF2.format(a);
  return `${s}${prefix} ${body}`;
}

export function pct(v, { sign = true, dec = 1 } = {}) {
  if (v == null || !isFinite(v)) return '—';
  const s = sign && v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${nf(dec, dec).format(Math.abs(v))}%`;
}

/** Badge de variación con ícono (nunca solo color). */
export function delta(v, opts) {
  if (v == null || !isFinite(v)) return '<span class="delta flat">—</span>';
  const cls = v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : 'flat';
  const icon = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '•';
  return `<span class="delta ${cls}"><span aria-hidden="true">${icon}</span> ${pct(v, opts)}</span>`;
}
export function deltaMoney(v, cur) {
  if (v == null || !isFinite(v)) return '<span class="delta flat">—</span>';
  const cls = v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : 'flat';
  return `<span class="delta ${cls}">${money(v, cur, { sign: true })}</span>`;
}

export function timeAgo(t) {
  if (!t) return 'nunca';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'recién';
  if (s < 60) return `hace ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function fmtDate(d) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T12:00:00`) : d;
  return dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------
// Colores (leídos de las variables CSS → respetan modo claro/oscuro)
// ---------------------------------------------------------------------
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export function classColor(cls) {
  return cssVar(`--series-${CLASSES[cls]?.slot || 7}`) || '#888';
}

// ---------------------------------------------------------------------
// Modal accesible
// ---------------------------------------------------------------------
let modalStack = [];
export function openModal({ title, body, actions = '', wide = false, onMount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="Cerrar">✕</button>
      </header>
      <div class="modal-body">${body}</div>
      ${actions ? `<footer class="modal-foot">${actions}</footer>` : ''}
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  const close = () => {
    wrap.remove();
    modalStack = modalStack.filter((m) => m !== close);
    if (!modalStack.length) document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === close) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('[data-close]')) close();
  });
  modalStack.push(close);
  const modal = wrap.querySelector('.modal');
  onMount?.(modal, close);
  setTimeout(() => {
    if (modal.contains(document.activeElement)) return; // el usuario ya está escribiendo
    (modal.querySelector('[autofocus]') || modal.querySelector('input,select'))?.focus();
  }, 30);
  return { el: modal, close };
}

export function confirmDialog(message, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title: 'Confirmar',
      body: `<p>${esc(message)}</p>`,
      actions: `<button class="btn ghost" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>`,
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); close(); }),
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

export function toast(msg, type = 'info') {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// ---------------------------------------------------------------------
// Sparkline SVG (liviano, sin librería)
// ---------------------------------------------------------------------
export function sparkline(values, { w = 120, h = 36 } = {}) {
  const v = (values || []).filter((x) => x != null && isFinite(x));
  if (v.length < 2) return `<svg class="spark empty" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" /></svg>`;
  const min = Math.min(...v), max = Math.max(...v);
  const range = max - min || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 3 - ((y - min) / range) * (h - 6)).toFixed(1)}`);
  const trend = v[v.length - 1] >= v[0] ? 'up' : 'down';
  return `<svg class="spark ${trend}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" /></svg>`;
}

// ---------------------------------------------------------------------
// Chart.js (cargado como script global en index.html)
// ---------------------------------------------------------------------
const charts = new WeakMap();
export function destroyChart(canvas) {
  const c = charts.get(canvas);
  if (c) { c.destroy(); charts.delete(canvas); }
}

function baseOptions() {
  const ink = cssVar('--text-2');
  const grid = cssVar('--grid');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    transitions: { resize: { animation: { duration: 0 } } },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar('--surface-3'), titleColor: cssVar('--text-1'), bodyColor: cssVar('--text-1'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4,
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: cssVar('--axis') }, ticks: { color: ink, maxTicksLimit: 6, maxRotation: 0, autoSkip: true, font: { size: 11 } } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: ink, maxTicksLimit: 5, font: { size: 11 } } },
    },
  };
}

/** Gráfico de líneas. series: [{ label, data:[numbers], color, dashed, fill }] */
export function lineChart(canvas, { labels, series, yFormat = (v) => num(v), tooltipFormat }) {
  destroyChart(canvas);
  if (!window.Chart) return null;
  const opts = baseOptions();
  opts.scales.y.ticks.callback = (v) => yFormat(v);
  opts.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${(tooltipFormat || yFormat)(ctx.parsed.y)}` };
  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.fill ? (s.bg || `${s.color}22`) : s.color,
        borderWidth: s.width ?? 2, pointRadius: 0, pointHoverRadius: s.width === 0 ? 0 : 4, pointHitRadius: 12, tension: 0.15,
        fill: typeof s.fill === 'string' ? s.fill : !!s.fill, borderDash: s.dashed ? [5, 4] : undefined, stepped: s.stepped || false,
      })),
    },
    options: opts,
  });
  charts.set(canvas, chart);
  return chart;
}

/** Dona. items: [{ label, value, color }] */
export function donutChart(canvas, { items, format = (v) => num(v) }) {
  destroyChart(canvas);
  if (!window.Chart) return null;
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const chart = new window.Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: items.map((i) => i.label),
      datasets: [{ data: items.map((i) => i.value), backgroundColor: items.map((i) => i.color), borderColor: cssVar('--surface-1'), borderWidth: 2, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '64%', animation: { duration: 250 }, transitions: { resize: { animation: { duration: 0 } } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cssVar('--surface-3'), titleColor: cssVar('--text-1'), bodyColor: cssVar('--text-1'), borderColor: cssVar('--border'), borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => ` ${ctx.label}: ${format(ctx.parsed)} (${pct((ctx.parsed / total) * 100, { sign: false })})` },
        },
      },
    },
  });
  charts.set(canvas, chart);
  return chart;
}

/** Leyenda HTML para la dona (identidad nunca solo por color). */
export function legendList(items, format) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return `<ul class="legend">${items.map((i) => `
    <li><span class="swatch" style="background:${i.color}"></span><span class="lg-label">${esc(i.label)}</span>
    <span class="lg-val">${format ? format(i.value) : ''}</span><span class="lg-pct">${pct((i.value / total) * 100, { sign: false, dec: 0 })}</span></li>`).join('')}</ul>`;
}

export function riskDots(level) {
  return `<span class="risk" title="Riesgo ${level} de 5" aria-label="Riesgo ${level} de 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</span>`;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
