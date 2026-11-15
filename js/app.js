// =====================================================================
// APP: arranque, navegación, encabezado y actualización periódica
// =====================================================================
import * as store from './storage.js';
import * as data from './data.js';
import { REFRESH, KINDS, PICKS } from './config.js';
import { buildPositions, summarize, todayStr } from './portfolio.js';
import { $, $$, esc, openModal, toast, timeAgo, debounce } from './ui.js';
import { renderWelcome, renderQuiz } from './views/onboarding.js';
import * as AdvisorView from './views/advisor.js';
import * as MarketView from './views/market.js';
import * as PortfolioView from './views/portfolio.js';
import * as SettingsView from './views/settings.js';
import * as GoalsView from './views/goals.js';
import { alertTriggered, alertText, reminderDue, showNotification } from './notify.js';
import { initSync, activeConfig, syncState, onSyncStatus } from './sync.js';

const ROUTES = { asesor: AdvisorView, mercado: MarketView, cartera: PortfolioView, metas: GoalsView, ajustes: SettingsView };

let current = null; // vista activa
let pendingRemoteRender = false;
let prevSeen = null;

// ---------------------------------------------------------------------
// Contexto compartido con las vistas
// ---------------------------------------------------------------------
export const app = {
  user: () => store.getActiveUser(),
  display: () => store.getActiveUser()?.settings.currency || 'ARS',
  fxCasa: () => store.getActiveUser()?.settings.fxCasa || 'bolsa',
  fx: () => data.fxRate(app.fxCasa()),
  prevSeen: () => prevSeen,

  /** Cotización actual por clave de activo (kind:symbol). */
  priceOf(key, tx) {
    const kind = tx?.kind || key.split(':')[0];
    const symbol = tx?.symbol || key.slice(kind.length + 1);
    return data.quote(kind, symbol);
  },

  positions(display = app.display()) {
    const u = app.user();
    if (!u) return [];
    return buildPositions(u.transactions, {
      priceOf: app.priceOf, fx: app.fx(), display, manualPrices: u.manualPrices, today: todayStr(),
    });
  },
  summary(display) { return summarize(app.positions(display)); },

  rerender() { route(); },
  go(r) { if (location.hash !== `#/${r}`) location.hash = `#/${r}`; else route(); },

  /** Fuerza la actualización de todo lo que se esté mostrando. */
  async refreshAll() {
    await Promise.allSettled([
      data.loadDolares(true),
      ...neededKinds().map((k) => data.loadPanel(k, true)),
      data.loadCrypto(neededCrypto(), true),
    ]);
    toast('Datos actualizados');
  },
  ensureMarket() { startPolling(); },
};

// ---------------------------------------------------------------------
// Qué datos hacen falta según el usuario
// ---------------------------------------------------------------------
function neededKinds() {
  const u = app.user();
  const set = new Set(['cedear', 'bono', 'letra', 'accion', 'on']); // usados por el asesor
  if (u) {
    for (const tx of u.transactions) if (KINDS[tx.kind]?.panel && !['crypto', 'fci'].includes(KINDS[tx.kind].panel)) set.add(tx.kind);
    for (const s of u.market.sections) if (KINDS[s]?.panel && !['crypto', 'fci'].includes(KINDS[s].panel)) set.add(s);
    for (const a of u.alerts || []) if (a.active && KINDS[a.kind]?.panel && !['crypto', 'fci'].includes(KINDS[a.kind].panel)) set.add(a.kind);
  }
  return [...set];
}
function neededCrypto() {
  const u = app.user();
  const set = new Set(PICKS.cripto.map((p) => p.symbol));
  if (u) {
    (u.market.watch.cripto || []).forEach((s) => set.add(s));
    u.transactions.filter((t) => t.kind === 'cripto').forEach((t) => set.add(t.symbol));
    (u.alerts || []).filter((a) => a.active && a.kind === 'cripto').forEach((a) => set.add(a.symbol));
  }
  return [...set];
}
function neededFciCats() {
  const u = app.user();
  const cats = new Set(['mercadoDinero']);
  u?.transactions.filter((t) => t.kind === 'fci').forEach((t) => cats.add(t.symbol.split('|')[0]));
  return [...cats];
}

let pollingStarted = false;
function startPolling() {
  if (pollingStarted) {
    // Reprogramar con la lista actualizada de necesidades
    data.schedule('panels', () => Promise.allSettled(neededKinds().map((k) => data.loadPanel(k))), REFRESH.panels);
    data.schedule('crypto', () => data.loadCrypto(neededCrypto()), REFRESH.crypto);
    return;
  }
  pollingStarted = true;
  data.schedule('dolares', async () => {
    await data.loadDolares();
    rememberSeen();
  }, REFRESH.dolares);
  data.schedule('panels', () => Promise.allSettled(neededKinds().map((k) => data.loadPanel(k))), REFRESH.panels);
  data.schedule('crypto', () => data.loadCrypto(neededCrypto()), REFRESH.crypto);
  data.schedule('indicators', () => data.loadIndicators(), REFRESH.indicators);
  data.schedule('fci', () => data.loadFCI(false, neededFciCats()), 6 * 3600_000);
}

let seenSaved = false;
function rememberSeen() {
  const u = app.user();
  const fx = app.fx();
  if (!u || !fx || seenSaved) return;
  seenSaved = true;
  // Guardamos el valor actual para comparar en la PRÓXIMA visita.
  setTimeout(() => store.updateUser((uu) => { uu.seen = { fx, t: Date.now() }; }), 5000);
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
function route() {
  const main = $('#main');
  const hash = location.hash.replace(/^#\/?/, '') || 'asesor';
  const [name, ...rest] = hash.split('/');
  const user = app.user();

  current?.destroy?.();
  current = null;

  updateHeader();
  if (!user) {
    setNav(null);
    renderWelcome(main, app);
    return;
  }
  updateHeader();
  if (name === 'test' || (!user.profile && name === 'asesor')) {
    setNav('asesor');
    renderQuiz(main, app, { retake: !!user.profile });
    return;
  }
  const view = ROUTES[name] || AdvisorView;
  setNav(ROUTES[name] ? name : 'asesor');
  current = view;
  view.render(main, app, rest);
  main.focus({ preventScroll: true });
}

function setNav(name) {
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $$('.nav a').forEach((a) => (a.dataset.route === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('.nav').style.display = name === null ? 'none' : '';
}

// ---------------------------------------------------------------------
// Encabezado: usuario, moneda, estado de los datos
// ---------------------------------------------------------------------
function updateHeader() {
  const u = app.user();
  $('.topbar-right').style.visibility = u ? 'visible' : 'hidden';
  if (!u) return;
  $('#user-btn .avatar').textContent = (u.name || '?').trim().charAt(0).toUpperCase();
  $('#user-btn .user-name').textContent = u.name;
  $$('[data-currency]').forEach((b) => b.classList.toggle('on', b.dataset.currency === u.settings.currency));
}

function updateStatus() {
  const used = ['dolarapi', 'data912', 'binance', 'argentinadatos'];
  const st = used.map((k) => data.SOURCES[k]);
  const known = st.filter((s) => s.ok !== null);
  const btn = $('#status-btn');
  btn.classList.remove('ok', 'partial', 'err');
  if (!known.length) { btn.querySelector('.status-text').textContent = 'Conectando…'; return; }
  const bad = known.filter((s) => s.ok === false).length;
  btn.classList.add(bad === 0 ? 'ok' : bad < known.length ? 'partial' : 'err');
  const last = Math.max(...st.map((s) => s.last || 0));
  btn.querySelector('.status-text').textContent = bad === known.length ? 'Sin conexión' : `En vivo · ${timeAgo(last)}`;
}

// ---------------------------------------------------------------------
// Alertas de precio y recordatorio mensual
// ---------------------------------------------------------------------
async function checkAlerts() {
  const u = app.user();
  if (!u?.alerts?.length) return;
  const fired = [];
  for (const a of u.alerts) {
    const q = data.quote(a.kind, a.symbol);
    if (alertTriggered(a, q)) fired.push({ a, q });
  }
  if (!fired.length) return;
  store.updateUser((uu) => {
    for (const { a } of fired) {
      const x = uu.alerts.find((y) => y.id === a.id);
      if (x) { x.active = false; x.triggeredAt = Date.now(); }
    }
  });
  for (const { a, q } of fired) {
    const text = alertText(a, q, (v) => `${a.currency === 'USD' ? 'US$' : '$'} ${v.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`);
    toast(`🔔 ${text}`);
    await showNotification('🔔 Alerta de precio', text, `alert-${a.id}`);
  }
}

async function checkReminder() {
  const u = app.user();
  if (!u || !reminderDue(u)) return;
  const ym = todayStr().slice(0, 7);
  store.updateUser((uu) => { uu.seen = { ...uu.seen, remindedMonth: ym }; });
  const amount = u.settings.monthlyAmount ? ` de ${u.settings.monthlyCurrency === 'USD' ? 'US$' : '$'} ${Number(u.settings.monthlyAmount).toLocaleString('es-AR')}` : '';
  const shown = await showNotification('💰 Hora de invertir', `Todavía no registraste tu aporte${amount} de este mes. Mirá tu plan.`, 'reminder');
  if (!shown) toast(`💰 Recordatorio: todavía no registraste tu aporte${amount} de este mes`);
}

function showSources() {
  const rows = Object.values(data.SOURCES).map((s) => `
    <li>
      <span class="cls-dot" style="background:${s.ok === null ? 'var(--text-3)' : s.ok ? '#0ca30c' : '#d03b3b'}"></span>
      <div style="flex:1;min-width:0"><b>${esc(s.label)}</b>
        <div class="tiny">${s.ok === null ? 'Sin usar todavía' : s.ok ? `OK · ${timeAgo(s.last)}` : `Error: ${esc(s.error)}${s.last ? ` · último dato ${timeAgo(s.last)}` : ''}`}${s.note ? ` · ${esc(s.note)}` : ''}</div>
      </div>
    </li>`).join('');
  openModal({
    title: 'Estado de los datos',
    body: `<ul class="list">${rows}${activeConfig() ? `<li><span class="cls-dot" style="background:${syncState.status === 'synced' ? '#0ca30c' : syncState.status === 'error' ? '#d03b3b' : 'var(--text-3)'}"></span><div style="flex:1"><b>Sincronización (Firebase)</b><div class="tiny">${esc(syncState.email || 'Sin sesión')} · ${esc(syncState.status)}${syncState.error ? ` · ${esc(syncState.error)}` : ''}</div></div></li>` : ''}</ul>
      <p class="tiny mt">Todas las fuentes son gratuitas y públicas. Los precios de BYMA tienen ~20 segundos de demora y la cripto se actualiza cada ${REFRESH.crypto / 1000} s. Si una fuente falla, se muestra el último dato guardado.</p>`,
    actions: '<button class="btn primary" data-refresh>Actualizar ahora</button>',
    onMount: (el, close) => el.querySelector('[data-refresh]').addEventListener('click', async () => { close(); await app.refreshAll(); }),
  });
}

function showUserSwitcher() {
  const users = store.getUsers();
  const active = app.user();
  openModal({
    title: 'Usuarios',
    body: `
      <p class="small muted">Cada usuario tiene su propio perfil, plan y cartera en este dispositivo.</p>
      <ul class="list mt">${users.map((u) => `
        <li><span class="avatar">${esc(u.name.charAt(0).toUpperCase())}</span>
          <div style="flex:1"><b>${esc(u.name)}</b><div class="tiny">${u.profile ? 'Perfil completo' : 'Sin perfil'} · ${u.transactions.length} operaciones</div></div>
          ${u.id === active?.id ? '<span class="badge">Activo</span>' : `<button class="btn sm" data-switch="${u.id}">Usar</button>`}
        </li>`).join('')}</ul>
      <form class="row mt" data-new>
        <input type="text" name="name" placeholder="Nombre del nuevo usuario" maxlength="30" required />
        <button class="btn primary" type="submit">Agregar</button>
      </form>`,
    onMount: (el, close) => {
      el.addEventListener('click', (e) => {
        const id = e.target.closest('[data-switch]')?.dataset.switch;
        if (id) { store.setActiveUser(id); close(); onUserChanged(); toast(`Ahora estás como ${app.user().name}`); }
      });
      el.querySelector('[data-new]').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = new FormData(e.target).get('name').trim();
        if (!name) return;
        store.createUser(name);
        close();
        onUserChanged();
        app.go('test');
      });
    },
  });
}

export function onUserChanged() {
  seenSaved = false;
  prevSeen = app.user()?.seen ? { ...app.user().seen } : null;
  updateHeader();
  startPolling();
  route();
}

function applyTheme() {
  const t = store.getTheme();
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
app.applyTheme = applyTheme;
app.onUserChanged = onUserChanged;

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
function boot() {
  applyTheme();
  prevSeen = app.user()?.seen ? { ...app.user().seen } : null;

  $$('[data-currency]').forEach((b) => b.addEventListener('click', () => {
    store.updateUser((u) => { u.settings.currency = b.dataset.currency; });
    updateHeader();
    route();
  }));
  $('#user-btn').addEventListener('click', showUserSwitcher);
  $('#status-btn').addEventListener('click', showSources);

  window.addEventListener('hashchange', route);
  const onMarket = debounce((what) => current?.update?.(what), 300);
  data.on('market', onMarket);
  data.on('market', debounce(checkAlerts, 500));
  data.on('market', debounce(checkReminder, 2000));
  setInterval(checkReminder, 3600_000);

  // Cambios que llegan de otro dispositivo
  store.onChange((meta = {}) => {
    if (!meta.remote) return;
    if (document.querySelector('.modal-backdrop')) { pendingRemoteRender = true; return; }
    onUserChanged();
    toast('Datos actualizados desde otro dispositivo ☁️');
  });
  setInterval(() => {
    if (pendingRemoteRender && !document.querySelector('.modal-backdrop')) { pendingRemoteRender = false; onUserChanged(); }
  }, 2000);
  if (activeConfig()) initSync();
  onSyncStatus(() => updateStatus());
  data.on('status', updateStatus);
  setInterval(updateStatus, 10_000);

  if (app.user()) startPolling();
  route();

  // Cuando se cargan las Chart.js (defer), repintar si hace falta
  if (!window.Chart) window.addEventListener('load', () => current?.update?.('charts'));

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }
}

boot();
