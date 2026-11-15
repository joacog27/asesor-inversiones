// =====================================================================
// BIENVENIDA + TEST DE PERFIL
// =====================================================================
import * as store from '../storage.js';
import { QUIZ, PROFILES, CLASSES, CLASS_ORDER, DISCLAIMER } from '../config.js';
import { scoreQuiz, targetAllocation, capExplanation } from '../advisor.js';
import { esc, toast, classColor, num, openModal } from '../ui.js';
import { activeConfig, initSync, signIn, onSyncStatus, syncState } from '../sync.js';
import { parseFirebaseConfig } from '../sync-merge.js';

export function renderWelcome(main, app) {
  main.innerHTML = `
    <section class="welcome">
      <div class="big-emoji">🧭</div>
      <h1>Tu asesor de inversiones personal</h1>
      <p class="muted mt">Hacé un test corto, recibí un plan para invertir parte de tu sueldo cada mes, seguí el mercado en vivo y mirá cómo evoluciona tu plata, en pesos o en dólares.</p>
      <form class="card mt-lg stack" id="welcome-form" style="text-align:left">
        <label class="field"><span>¿Cómo te llamás?</span>
          <input type="text" name="name" maxlength="30" placeholder="Ej: Joaco" required autofocus />
          <small>Podés crear otro usuario después (por ejemplo, para tu pareja). Los datos quedan guardados solo en este dispositivo.</small>
        </label>
        <button class="btn primary block" type="submit">Empezar el test (2 minutos)</button>
      </form>
      <div class="card mt" style="text-align:left">
        <p class="small"><b>¿Ya usás la app en otro dispositivo?</b></p>
        <div class="row wrap mt">
          <button class="btn" id="cloud-btn">☁️ Traer mis datos de la nube</button>
          <button class="btn ghost sm" id="import-btn">Importar archivo</button>
        </div>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden />
      <p class="disclaimer" style="text-align:left">${esc(DISCLAIMER)}</p>
    </section>`;

  main.querySelector('#welcome-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    if (!name) return;
    store.createUser(name);
    app.onUserChanged();
    app.go('test');
  });
  main.querySelector('#cloud-btn').addEventListener('click', () => openCloudLogin(app));
  const file = main.querySelector('#import-file');
  main.querySelector('#import-btn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const n = store.importJSON(await f.text(), 'merge');
      toast(`Importado: ${n} usuario(s)`);
      app.onUserChanged();
    } catch (err) {
      toast(`No se pudo importar: ${err.message}`, 'error');
    }
  });
}

export function renderQuiz(main, app, { retake = false } = {}) {
  const user = app.user();
  const answers = { ...(user.profile?.answers || {}) };
  let step = 0;
  const total = QUIZ.length + 1; // + paso de monto mensual

  function draw() {
    if (step < QUIZ.length) drawQuestion();
    else drawAmount();
  }

  function header() {
    return `
      <div class="row">
        ${step > 0 ? '<button class="btn ghost sm" data-back>← Atrás</button>' : retake ? '<a class="btn ghost sm" href="#/asesor">Cancelar</a>' : '<span></span>'}
        <span class="spacer"></span>
        <span class="tiny">Paso ${step + 1} de ${total}</span>
      </div>
      <div class="quiz-progress" aria-hidden="true"><i style="width:${(step / total) * 100}%"></i></div>`;
  }

  function drawQuestion() {
    const q = QUIZ[step];
    main.innerHTML = `
      <section class="quiz">
        ${header()}
        <h1>${esc(q.q)}</h1>
        ${q.help ? `<p class="muted mt small">${esc(q.help)}</p>` : ''}
        <div class="options" role="radiogroup" aria-label="${esc(q.q)}">
          ${q.options.map((o, i) => `<button class="option ${answers[q.id] === i ? 'on' : ''}" role="radio" aria-checked="${answers[q.id] === i}" data-opt="${i}">${esc(o.label)}</button>`).join('')}
        </div>
      </section>`;
    main.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
      answers[q.id] = Number(b.dataset.opt);
      b.classList.add('on');
      setTimeout(() => { step++; draw(); window.scrollTo(0, 0); }, 160);
    }));
    main.querySelector('[data-back]')?.addEventListener('click', () => { step--; draw(); });
    main.querySelector('.option')?.focus();
  }

  function drawAmount() {
    const s = user.settings;
    main.innerHTML = `
      <section class="quiz">
        ${header()}
        <h1>¿Cuánto querés invertir por mes?</h1>
        <p class="muted mt small">Una parte de tu sueldo que no necesites para gastos. Lo podés cambiar cuando quieras.</p>
        <form class="card mt-lg stack" id="amount-form">
          <div class="form-grid two">
            <label class="field"><span>Monto mensual</span>
              <input type="number" name="amount" min="0" step="any" inputmode="decimal" value="${s.monthlyAmount || ''}" placeholder="Ej: 200000" required autofocus />
            </label>
            <label class="field"><span>Moneda</span>
              <select name="currency">
                <option value="ARS" ${s.monthlyCurrency === 'ARS' ? 'selected' : ''}>Pesos (ARS)</option>
                <option value="USD" ${s.monthlyCurrency === 'USD' ? 'selected' : ''}>Dólares (USD)</option>
              </select>
            </label>
          </div>
          <button class="btn primary block" type="submit">Ver mi perfil</button>
        </form>
      </section>`;
    main.querySelector('[data-back]')?.addEventListener('click', () => { step--; draw(); });
    main.querySelector('#amount-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = Number(fd.get('amount'));
      if (!(amount > 0)) { toast('Ingresá un monto mayor a 0', 'error'); return; }
      const profile = scoreQuiz(answers);
      store.updateUser((u) => {
        u.profile = profile;
        u.settings.monthlyAmount = amount;
        u.settings.monthlyCurrency = fd.get('currency');
      });
      drawResult(profile);
    });
  }

  function drawResult(profile) {
    const p = PROFILES[profile.level];
    const { alloc } = targetAllocation(profile);
    const cap = capExplanation(profile);
    main.innerHTML = `
      <section class="quiz">
        <div class="card stack" style="text-align:center">
          <div class="big-emoji" style="margin:0 auto">${p.emoji}</div>
          <p class="muted">Tu perfil de inversor es</p>
          <h1>${esc(p.name)}</h1>
          <p>${esc(p.desc)}</p>
          ${cap ? `<p class="small muted">${esc(cap)}</p>` : ''}
          <div>
            <div class="meter" aria-label="Puntaje ${profile.score} de 100"><i style="left:${profile.score}%"></i></div>
            <div class="meter-labels"><span>Conservador</span><span>Puntaje ${profile.score}/100</span><span>Agresivo</span></div>
          </div>
        </div>
        <div class="card mt">
          <h2>Cómo repartiríamos tu plata</h2>
          <div class="alloc-bars mt">
            ${CLASS_ORDER.filter((c) => alloc[c] > 0).map((c) => `
              <div class="alloc-row">
                <div class="lbl"><span class="row"><span class="cls-dot" style="background:${classColor(c)}"></span>${esc(CLASSES[c].name)}</span><b>${num(alloc[c], 0)}%</b></div>
                <div class="bar"><span class="fill" style="width:${alloc[c]}%;background:${classColor(c)}"></span></div>
              </div>`).join('')}
          </div>
        </div>
        <button class="btn primary block mt-lg" data-go>Ver mi plan de este mes →</button>
      </section>`;
    main.querySelector('[data-go]').addEventListener('click', () => app.go('asesor'));
    window.scrollTo(0, 0);
  }

  draw();
}

/** Iniciar sesión en un dispositivo nuevo para bajar los datos sincronizados. */
function openCloudLogin(app) {
  let off = null;
  openModal({
    title: 'Traer mis datos de la nube',
    body: `
      <div data-cfgwrap ${activeConfig() ? 'hidden' : ''}>
        <p class="small muted">Pegá la configuración de Firebase (la misma que usaste en tu otro dispositivo; la encontrás ahí en Ajustes → Sincronización, o en la consola de Firebase).</p>
        <textarea data-cfg class="mt" placeholder="const firebaseConfig = { ... }"></textarea>
      </div>
      <p class="small mt" data-st>Iniciá sesión con la misma cuenta de Google que en tu otro dispositivo.</p>`,
    actions: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-go>Iniciar sesión con Google</button>',
    onMount: (el, close) => {
      const st = el.querySelector('[data-st]');
      off = onSyncStatus((s) => {
        if (s.error) st.innerHTML = `<span style="color:var(--down)">⚠ ${esc(s.error)}</span>`;
        else if (s.status === 'connecting' || s.status === 'saving') st.textContent = 'Descargando tus datos…';
        if (s.status === 'synced') {
          const n = store.getUsers().length;
          if (n) { close(); toast(`¡Listo! Se sincronizaron ${n} usuario(s) ☁️`); app.onUserChanged(); }
          else st.textContent = 'Tu cuenta todavía no tiene datos guardados. Cerrá esto y creá tu usuario: se va a guardar en la nube.';
        }
      });
      el.querySelector('[data-go]').addEventListener('click', async () => {
        if (!activeConfig()) {
          const cfg = parseFirebaseConfig(el.querySelector('[data-cfg]').value);
          if (!cfg) { toast('No reconozco la configuración: tiene que tener apiKey, authDomain y projectId', 'error'); return; }
          store.setSyncConfig(cfg);
        }
        st.textContent = 'Abriendo Google…';
        try { await initSync(); await signIn(); } catch { /* el estado muestra el error */ }
        if (syncState.status === 'synced' && store.getUsers().length) { close(); app.onUserChanged(); }
      });
    },
    onClose: () => off?.(),
  });
}
