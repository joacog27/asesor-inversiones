// =====================================================================
// VISTA: AJUSTES
// =====================================================================
import * as store from '../storage.js';
import * as data from '../data.js';
import { FX_CASAS, APP_VERSION, DISCLAIMER, PROFILES, FIREBASE_CONFIG } from '../config.js';
import { esc, toast, confirmDialog, money, timeAgo, fmtDate } from '../ui.js';
import { requestNotifications, notificationPermission, notificationsSupported, showNotification, buildICS, downloadFile } from '../notify.js';
import { syncState, onSyncStatus, initSync, signIn, signOutSync, syncNow, disconnect, activeConfig } from '../sync.js';
import { parseFirebaseConfig } from '../sync-merge.js';
import { describeAlert } from './alerts.js';

let offSync = null;

export function render(main, app) {
  const u = app.user();
  const s = u.settings;
  const theme = store.getTheme();
  main.innerHTML = `
    <div class="page-head"><div><h1>Ajustes</h1><p>Usuarios, moneda, tema y tus datos.</p></div></div>
    <div class="grid-2">
      <section class="card stack">
        <h2>Usuarios en este dispositivo</h2>
        <ul class="list">${store.getUsers().map((x) => `
          <li><span class="avatar">${esc(x.name.charAt(0).toUpperCase())}</span>
            <div style="flex:1;min-width:0"><b>${esc(x.name)}</b>${x.id === u.id ? ' <span class="badge">Activo</span>' : ''}
              <div class="tiny">${x.profile ? PROFILES[x.profile.level].name : 'Sin perfil'} · ${x.transactions.length} operaciones</div></div>
            ${x.id !== u.id ? `<button class="btn sm" data-use="${x.id}">Usar</button>` : ''}
            <button class="icon-btn" data-rename="${x.id}" aria-label="Renombrar ${esc(x.name)}" title="Renombrar">✎</button>
            <button class="icon-btn" data-deluser="${x.id}" aria-label="Eliminar ${esc(x.name)}" title="Eliminar">🗑</button>
          </li>`).join('')}</ul>
        <form class="row" data-newuser><input type="text" name="name" placeholder="Nombre (ej: tu pareja)" maxlength="30" required /><button class="btn primary">Agregar</button></form>
      </section>

      <section class="card stack">
        <h2>Moneda y tipo de cambio</h2>
        <label class="field"><span>Ver valores en</span>
          <select data-set="currency"><option value="ARS" ${s.currency === 'ARS' ? 'selected' : ''}>Pesos (ARS)</option><option value="USD" ${s.currency === 'USD' ? 'selected' : ''}>Dólares (USD)</option></select></label>
        <label class="field"><span>Dólar para convertir ARS ↔ USD</span>
          <select data-set="fxCasa">${FX_CASAS.map((f) => `<option value="${f.id}" ${s.fxCasa === f.id ? 'selected' : ''}>${esc(f.label)}${data.market.dolares?.[f.id] ? ` — ${money(data.market.dolares[f.id].venta, 'ARS')}` : ''}</option>`).join('')}</select>
          <small>Recomendado: MEP, que es el dólar al que podés comprar legalmente en el mercado de capitales.</small></label>
        <h2 class="mt">Apariencia</h2>
        <div class="seg" role="group" aria-label="Tema">
          ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button data-theme-set="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('')}
        </div>
      </section>

      <section class="card stack span-2" aria-labelledby="sync-h">
        <h2 id="sync-h">☁️ Sincronización entre dispositivos</h2>
        <div data-sync></div>
      </section>

      <section class="card stack" aria-labelledby="rem-h">
        <h2 id="rem-h">📅 Recordatorio del aporte</h2>
        <label class="switch"><input type="checkbox" data-rem-on ${s.reminderOn ? 'checked' : ''} /> <span>Recordarme invertir cada mes</span></label>
        <label class="field"><span>Día del mes (ej: el día después de cobrar)</span>
          <input type="number" min="1" max="28" step="1" data-rem-day value="${s.reminderDay}" /></label>
        <p class="tiny" data-notif-state></p>
        <div class="row wrap">
          <button class="btn sm" data-notif-perm>Activar notificaciones</button>
          <button class="btn sm" data-notif-test>Probar notificación</button>
        </div>
        <div class="sync-box">
          <p class="small"><b>Para no olvidarte nunca:</b> agregá el recordatorio a tu calendario (Google, iPhone, Outlook). Funciona aunque la app esté cerrada.</p>
          <button class="btn sm mt" data-ics>⬇ Agregar a mi calendario (.ics)</button>
        </div>
      </section>

      <section class="card stack" aria-labelledby="al-h">
        <h2 id="al-h">🔔 Alertas de precio</h2>
        <div data-alerts></div>
        <p class="tiny">Creá alertas desde <a href="#/mercado">Mercado</a> tocando un activo → "Crear alerta".</p>
      </section>

      <section class="card stack">
        <h2>Pasar tus datos a otro dispositivo</h2>
        <p class="small muted">Si no usás la sincronización, podés pasar los datos a mano: exportá un archivo acá e importalo en el otro dispositivo. También sirve como copia de seguridad.</p>
        <div class="row wrap">
          <button class="btn primary" data-export>⬇ Exportar mis datos</button>
          <button class="btn" data-import>⬆ Importar archivo</button>
          <input type="file" accept="application/json,.json" hidden data-file />
        </div>
        <label class="row small"><input type="checkbox" data-replace /> Al importar, reemplazar todo lo que hay en este dispositivo</label>
      </section>

      <section class="card stack">
        <h2>Fuentes de datos</h2>
        <ul class="list">${Object.values(data.SOURCES).map((x) => `
          <li><span class="cls-dot" style="background:${x.ok === null ? 'var(--text-3)' : x.ok ? '#0ca30c' : '#d03b3b'}"></span>
            <div style="flex:1"><b class="small">${esc(x.label)}</b><div class="tiny">${x.ok === null ? 'Sin usar todavía' : x.ok ? `OK · ${timeAgo(x.last)}` : `Error: ${esc(x.error)}`}</div></div></li>`).join('')}</ul>
        <p class="tiny">Todas gratuitas, sin registro ni API key.</p>
      </section>

      <section class="card stack span-2">
        <h2>Zona peligrosa</h2>
        <div class="row wrap">
          <button class="btn" data-cache>Borrar caché de precios</button>
          <button class="btn danger" data-wipe>Borrar todos los datos de este dispositivo</button>
        </div>
        <p class="disclaimer">${esc(DISCLAIMER)}</p>
        <p class="tiny">Versión ${APP_VERSION}</p>
      </section>
    </div>`;

  main.querySelectorAll('[data-set]').forEach((sel) => sel.addEventListener('change', () => {
    store.updateUser((uu) => { uu.settings[sel.dataset.set] = sel.value; });
    toast('Guardado');
    app.rerender();
  }));
  main.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
    store.setTheme(b.dataset.themeSet);
    app.applyTheme();
    app.rerender();
  }));
  main.querySelector('.grid-2').addEventListener('click', async (e) => {
    const use = e.target.closest('[data-use]')?.dataset.use;
    if (use) { store.setActiveUser(use); app.onUserChanged(); app.go('ajustes'); return; }
    const ren = e.target.closest('[data-rename]')?.dataset.rename;
    if (ren) {
      const usr = store.getRoot().users[ren];
      const name = prompt('Nuevo nombre', usr.name);
      if (name?.trim()) { store.renameUser(ren, name.trim().slice(0, 30)); app.onUserChanged(); }
      return;
    }
    const del = e.target.closest('[data-deluser]')?.dataset.deluser;
    if (del) {
      const usr = store.getRoot().users[del];
      if (await confirmDialog(`¿Eliminar a ${usr.name} con su perfil y cartera? Te recomendamos exportar antes.`, { ok: 'Eliminar', danger: true })) {
        store.deleteUser(del);
        app.onUserChanged();
      }
    }
  });
  main.querySelector('[data-newuser]').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (!name) return;
    store.createUser(name);
    app.onUserChanged();
    app.go('test');
  });
  main.querySelector('[data-export]').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `asesor-inversiones-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Archivo descargado');
  });
  const file = main.querySelector('[data-file]');
  main.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    const replace = main.querySelector('[data-replace]').checked;
    if (replace && !(await confirmDialog('Se va a reemplazar todo lo que hay en este dispositivo. ¿Seguir?', { ok: 'Reemplazar', danger: true }))) return;
    try {
      const n = store.importJSON(await f.text(), replace ? 'replace' : 'merge');
      toast(`Importado: ${n} usuario(s)`);
      app.applyTheme();
      app.onUserChanged();
    } catch (err) {
      toast(`No se pudo importar: ${err.message}`, 'error');
    }
    file.value = '';
  });
  main.querySelector('[data-cache]').addEventListener('click', async () => {
    await store.cacheClear();
    toast('Caché borrada');
    app.refreshAll();
  });
  main.querySelector('[data-wipe]').addEventListener('click', async () => {
    if (!(await confirmDialog('Se borran TODOS los usuarios, perfiles y carteras de este dispositivo. No se puede deshacer.', { ok: 'Borrar todo', danger: true }))) return;
    store.wipeAll();
    location.hash = '';
    app.onUserChanged();
  });

  // ---------------- Recordatorio ----------------
  const remOn = main.querySelector('[data-rem-on]');
  const remDay = main.querySelector('[data-rem-day]');
  const saveRem = async () => {
    const day = Math.min(28, Math.max(1, Number(remDay.value) || 1));
    store.updateUser((uu) => { uu.settings.reminderOn = remOn.checked; uu.settings.reminderDay = day; });
    if (remOn.checked && notificationPermission() === 'default') { await requestNotifications(); paintNotif(); }
    toast(remOn.checked ? `Te recordamos el día ${day} de cada mes` : 'Recordatorio desactivado');
  };
  remOn.addEventListener('change', saveRem);
  remDay.addEventListener('change', saveRem);
  const paintNotif = () => {
    const st = notificationPermission();
    main.querySelector('[data-notif-state]').textContent = !notificationsSupported() ? 'Este navegador no soporta notificaciones (en iPhone: instalá la app en la pantalla de inicio, iOS 16.4+).'
      : st === 'granted' ? '✅ Notificaciones activadas en este dispositivo. Se muestran mientras la app está abierta o en segundo plano.'
      : st === 'denied' ? '🚫 Bloqueaste las notificaciones: habilitalas en la configuración del navegador.'
      : 'Las notificaciones están desactivadas en este dispositivo.';
    main.querySelector('[data-notif-perm]').hidden = st !== 'default';
  };
  paintNotif();
  main.querySelector('[data-notif-perm]').addEventListener('click', async () => { await requestNotifications(); paintNotif(); });
  main.querySelector('[data-notif-test]').addEventListener('click', async () => {
    const ok = await showNotification('Mi Asesor', '¡Así te van a llegar los avisos! 🎉', 'test');
    if (!ok) toast('No hay permiso para notificaciones en este dispositivo', 'error');
  });
  main.querySelector('[data-ics]').addEventListener('click', () => {
    const uu = app.user();
    const amount = uu.settings.monthlyAmount ? money(uu.settings.monthlyAmount, uu.settings.monthlyCurrency) : '';
    const url = location.href.split('#')[0] + '#/asesor';
    const ics = buildICS({ day: Number(remDay.value) || 5, title: '💰 Invertir mi aporte del mes', description: `Abrí Mi Asesor y seguí tu plan del mes${amount ? ` (${amount})` : ''}.\n${url}`, url });
    downloadFile('recordatorio-inversion.ics', ics, 'text/calendar');
    toast('Abrí el archivo descargado para agregarlo a tu calendario');
  });

  // ---------------- Alertas ----------------
  const paintAlerts = () => {
    const box = main.querySelector('[data-alerts]');
    const alerts = app.user().alerts || [];
    box.innerHTML = alerts.length ? `<ul class="list">${alerts.map((a) => `
      <li>
        <div style="flex:1;min-width:0"><b>${esc(a.symbol)}</b> <span class="small">${esc(describeAlert(a))}</span>
          <div class="tiny">${a.active ? 'Activa' : a.triggeredAt ? `Se disparó el ${fmtDate(new Date(a.triggeredAt))}` : 'Pausada'}</div></div>
        <label class="switch" title="${a.active ? 'Pausar' : 'Reactivar'}"><input type="checkbox" data-al-toggle="${a.id}" ${a.active ? 'checked' : ''} aria-label="Alerta activa" /></label>
        <button class="icon-btn" data-al-del="${a.id}" aria-label="Eliminar alerta">🗑</button>
      </li>`).join('')}</ul>` : '<p class="small muted">No tenés alertas.</p>';
  };
  paintAlerts();
  main.querySelector('[data-alerts]').addEventListener('change', (e) => {
    const id = e.target.dataset.alToggle;
    if (!id) return;
    store.updateUser((uu) => { const a = uu.alerts.find((x) => x.id === id); if (a) { a.active = e.target.checked; if (a.active) a.triggeredAt = null; } });
    paintAlerts();
  });
  main.querySelector('[data-alerts]').addEventListener('click', (e) => {
    const id = e.target.closest('[data-al-del]')?.dataset.alDel;
    if (!id) return;
    store.updateUser((uu) => { uu.alerts = uu.alerts.filter((x) => x.id !== id); });
    paintAlerts();
  });

  // ---------------- Sincronización ----------------
  const syncBox = main.querySelector('[data-sync]');
  const paintSync = () => {
    if (!syncBox.isConnected) return;
    const cfg = activeConfig();
    const st = syncState;
    if (!cfg) {
      syncBox.innerHTML = `
        <p class="small">Usá la app en tu celular y en tu compu con los mismos datos, gratis, con tu cuenta de Google. Necesita un proyecto de <b>Firebase</b> (plan gratuito, sin tarjeta) que se configura <b>una sola vez</b> (~10 minutos, guía paso a paso en el README).</p>
        <ol class="steps mt">
          <li>Creá el proyecto en <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a>.</li>
          <li>Activá <b>Authentication → Google</b> y <b>Firestore</b> con las reglas del README.</li>
          <li>Agregá una app web y copiá su <code>firebaseConfig</code>.</li>
          <li>Pegalo acá abajo (o en <code>js/config.js</code> para que todos tus dispositivos lo tengan).</li>
        </ol>
        <label class="field mt"><span>Configuración de Firebase</span>
          <textarea data-cfg placeholder='const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "....firebaseapp.com",\n  projectId: "...",\n  appId: "..."\n};'></textarea></label>
        <button class="btn primary mt" data-cfg-save>Guardar y conectar</button>`;
      syncBox.querySelector('[data-cfg-save]').addEventListener('click', async () => {
        const parsed = parseFirebaseConfig(syncBox.querySelector('[data-cfg]').value);
        if (!parsed) { toast('No reconozco la configuración: tiene que tener apiKey, authDomain y projectId', 'error'); return; }
        store.setSyncConfig(parsed);
        await initSync();
        paintSync();
      });
      return;
    }
    const labels = { off: 'Desactivada', loading: 'Cargando…', 'signed-out': 'Sin sesión', connecting: 'Conectando…', saving: 'Guardando…', synced: 'Sincronizado ✅', error: 'Error' };
    const signedIn = !!st.email;
    syncBox.innerHTML = `
      <div class="sync-box">
        <div class="row wrap"><b>Estado:</b> <span>${labels[st.status] || st.status}</span>
          ${st.lastSync ? `<span class="tiny">· última sincronización ${timeAgo(st.lastSync)}</span>` : ''}</div>
        ${signedIn ? `<p class="small mt">Conectado como <b>${esc(st.email)}</b>. Todo lo que cargues (todos los usuarios de este dispositivo) se guarda en tu cuenta y aparece en tus otros dispositivos.</p>` : '<p class="small mt">Iniciá sesión con Google para sincronizar. Usá la misma cuenta en el celular y en la compu.</p>'}
        ${st.error ? `<p class="small mt" style="color:var(--down)">⚠ ${esc(st.error)}</p>` : ''}
      </div>
      <div class="row wrap mt">
        ${signedIn
          ? '<button class="btn sm" data-sync-now>↻ Sincronizar ahora</button><button class="btn sm" data-sync-out>Cerrar sesión</button>'
          : '<button class="btn primary" data-sync-in>Iniciar sesión con Google</button>'}
        ${!FIREBASE_CONFIG ? '<button class="btn ghost sm" data-sync-forget>Quitar configuración</button>' : ''}
      </div>
      <p class="tiny mt">💑 Para compartir con tu pareja: si usan <b>la misma cuenta de Google</b>, los dos ven ambos perfiles en todos los dispositivos. Si cada uno usa la suya, cada cuenta guarda solo lo suyo.</p>`;
    syncBox.querySelector('[data-sync-in]')?.addEventListener('click', async () => {
      try { await signIn(); } catch (err) { /* el estado ya muestra el error */ }
    });
    syncBox.querySelector('[data-sync-out]')?.addEventListener('click', async () => { await signOutSync(); toast('Sesión cerrada (tus datos quedan en este dispositivo)'); });
    syncBox.querySelector('[data-sync-now]')?.addEventListener('click', async () => { try { await syncNow(); toast('Sincronizado'); } catch (e) { toast(e.message, 'error'); } });
    syncBox.querySelector('[data-sync-forget]')?.addEventListener('click', async () => {
      if (await confirmDialog('¿Quitar la configuración de Firebase de este dispositivo? Tus datos locales no se borran.', { ok: 'Quitar' })) { await disconnect(); paintSync(); }
    });
  };
  offSync?.();
  offSync = onSyncStatus(paintSync);
  if (activeConfig() && syncState.status === 'off') initSync().then(paintSync);
  paintSync();
}
