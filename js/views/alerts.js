// =====================================================================
// ALERTAS DE PRECIO (formulario y lista) — compartido
// =====================================================================
import * as store from '../storage.js';
import * as data from '../data.js';
import { esc, money, openModal, toast, pct } from '../ui.js';
import { requestNotifications, notificationPermission } from '../notify.js';

export function openAlertForm(app, { kind, symbol, name }) {
  const q = data.quote(kind, symbol);
  const cur = q?.currency || (kind === 'cripto' || kind === 'usa' ? 'USD' : 'ARS');
  const price = q?.price || 0;
  const round = (v) => (v >= 100 ? Math.round(v) : +v.toFixed(2));
  openModal({
    title: `🔔 Alerta para ${symbol}`,
    body: `
      <form class="form-grid" data-af>
        <p class="small muted">Precio actual: <b>${price ? money(price, cur) : '—'}</b>${q?.divisor === 100 ? ' (cada 100 nominales)' : ''}</p>
        <label class="field"><span>Avisame cuando…</span>
          <select name="type">
            <option value="below">baje de un precio</option>
            <option value="above">suba de un precio</option>
            <option value="move">se mueva mucho en el día (±%)</option>
          </select></label>
        <label class="field"><span data-vlbl>Precio (${cur})</span><input type="number" name="value" step="any" min="0" inputmode="decimal" value="${price ? round(price * 0.95) : ''}" required /></label>
        <p class="tiny">Las alertas se revisan cada vez que se actualizan los precios mientras la app está abierta (en la compu podés dejarla en una pestaña). Si das permiso, te llega una notificación.</p>
      </form>`,
    actions: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Crear alerta</button>',
    onMount: (el, close) => {
      const f = el.querySelector('[data-af]');
      f.elements.type.addEventListener('change', () => {
        const t = f.elements.type.value;
        el.querySelector('[data-vlbl]').textContent = t === 'move' ? 'Variación diaria (%)' : `Precio (${cur})`;
        f.elements.value.value = t === 'move' ? 5 : price ? round(price * (t === 'above' ? 1.05 : 0.95)) : '';
      });
      el.querySelector('[data-ok]').addEventListener('click', async () => {
        const type = f.elements.type.value;
        const value = Number(f.elements.value.value);
        if (!(value > 0)) { toast('Ingresá un valor mayor a 0', 'error'); return; }
        store.updateUser((u) => u.alerts.push({ id: store.uid('al'), kind, symbol, name: name || symbol, currency: cur, type, value, active: true, createdAt: Date.now(), triggeredAt: null }));
        close();
        toast('Alerta creada');
        if (notificationPermission() === 'default') await requestNotifications();
        app.ensureMarket();
      });
    },
  });
}

export function describeAlert(a) {
  if (a.type === 'above') return `sube de ${money(a.value, a.currency)}`;
  if (a.type === 'below') return `baja de ${money(a.value, a.currency)}`;
  return `se mueve ±${pct(a.value, { sign: false })} en el día`;
}
