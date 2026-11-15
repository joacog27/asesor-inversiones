// =====================================================================
// VISTA: METAS Y PROYECCIÓN
// =====================================================================
import * as store from '../storage.js';
import { PROFILES, CLASSES, CLASS_ORDER, CLASS_RETURNS, GOAL_EMOJIS, ASSUMED_CORRELATION } from '../config.js';
import { targetAllocation } from '../advisor.js';
import { portfolioStats, simulate, goalStatus, yearsUntil } from '../simulator.js';
import { todayStr } from '../portfolio.js';
import { esc, money, num, pct, openModal, toast, confirmDialog, lineChart, cssVar, fmtDate, debounce } from '../ui.js';

let root, appRef;
const sim = { initial: null, monthly: null, years: null, level: null, touched: false };

/** Contexto común en USD reales. */
function baseCtx() {
  const u = appRef.user();
  const fx = appRef.fx();
  const valueUSD = appRef.summary('USD').value || 0;
  const m = Number(u.settings.monthlyAmount) || 0;
  const monthlyUSD = u.settings.monthlyCurrency === 'USD' ? m : fx ? m / fx : 0;
  const { alloc } = targetAllocation(u.profile);
  const { mu, sigma } = portfolioStats(alloc);
  return { u, fx, valueUSD, monthlyUSD, mu, sigma, alloc };
}

/** USD reales → moneda de visualización (pesos de hoy con el dólar actual). */
function show(usd, opts) {
  const cur = appRef.display();
  const fx = appRef.fx();
  if (cur === 'ARS') return fx ? money(usd * fx, 'ARS', opts) : '—';
  return money(usd, 'USD', opts);
}
function fromDisplay(v) {
  const cur = appRef.display();
  return cur === 'ARS' ? v / (appRef.fx() || 1) : v;
}
function toDisplay(usd) {
  return appRef.display() === 'ARS' ? usd * (appRef.fx() || 1) : usd;
}

export function render(main, app) {
  root = main; appRef = app;
  const cur = app.display();
  main.innerHTML = `
    <div class="page-head">
      <div><h1>Metas y proyección</h1><p>¿Para qué invertís y cuánto podrías tener? Valores en <b>${cur === 'ARS' ? 'pesos de hoy' : 'dólares de hoy'}</b> (sin inflación).</p></div>
      <button class="btn primary" data-addgoal>＋ Nueva meta</button>
    </div>
    <section aria-labelledby="goals-h">
      <h2 id="goals-h" class="sr-only">Tus metas</h2>
      <div data-goals class="goal-grid"></div>
    </section>
    <section class="card mt-lg" aria-labelledby="sim-h">
      <div class="card-head"><div><h2 id="sim-h">Simulador: ¿cuánto podrías tener?</h2><div class="sub">1.000 escenarios posibles del mercado según tu perfil.</div></div></div>
      <div class="form-grid sim-inputs">
        <label class="field"><span>Capital inicial (${cur})</span><input type="number" min="0" step="any" inputmode="decimal" data-sim="initial" /></label>
        <label class="field"><span>Aporte mensual (${cur})</span><input type="number" min="0" step="any" inputmode="decimal" data-sim="monthly" /></label>
        <label class="field"><span>Años: <b data-years-lbl></b></span><input type="range" min="1" max="40" step="1" data-sim="years" /></label>
        <label class="field"><span>Perfil</span><select data-sim="level">${PROFILES.map((p, i) => `<option value="${i}">${p.emoji} ${esc(p.name)}</option>`).join('')}</select></label>
      </div>
      <div data-sim-out class="mt"></div>
    </section>
    <section class="card mt" aria-labelledby="cmp-h">
      <h2 id="cmp-h">Comparar perfiles</h2>
      <p class="small muted">Mismo capital, aporte y plazo; resultado en el escenario base (mediana).</p>
      <div data-compare class="mt"></div>
    </section>
    <section class="card mt">
      <details>
        <summary style="cursor:pointer"><b>¿Cómo se calcula?</b></summary>
        <div class="small muted mt stack">
          <p>Simulamos mes a mes 1.000 caminos posibles del mercado. El <b>escenario base</b> es el del medio; el <b>pesimista</b> es peor que 9 de cada 10 caminos y el <b>optimista</b>, mejor que 9 de cada 10.</p>
          <p>Todo está en dólares "de hoy": los rendimientos ya descuentan la inflación y suponemos que tu aporte mantiene su poder de compra. Si elegís ver en pesos, se convierte con el dólar de hoy.</p>
          <p>Supuestos de rendimiento real anual y volatilidad por clase (correlación ${ASSUMED_CORRELATION}), editables en <code>js/config.js</code>:</p>
          <div class="table-wrap"><table><thead><tr><th>Clase</th><th>Rend. real/año</th><th>Volatilidad</th></tr></thead><tbody>
            ${CLASS_ORDER.map((c) => `<tr><td>${esc(CLASSES[c].name)}</td><td>${pct(CLASS_RETURNS[c].mu * 100, { sign: false })}</td><td>${pct(CLASS_RETURNS[c].sigma * 100, { sign: false, dec: 0 })}</td></tr>`).join('')}
          </tbody></table></div>
          <p>Es una estimación educativa: el futuro puede ser mejor o peor que cualquier escenario.</p>
        </div>
      </details>
    </section>`;

  main.querySelector('[data-addgoal]').addEventListener('click', () => openGoalForm());
  main.querySelector('[data-goals]').addEventListener('click', (e) => {
    const id = e.target.closest('[data-edit]')?.dataset.edit;
    if (id) openGoalForm(appRef.user().goals.find((g) => g.id === id));
    if (e.target.closest('[data-addgoal2]')) openGoalForm();
    const simId = e.target.closest('[data-simgoal]')?.dataset.simgoal;
    if (simId) simulateGoal(simId);
  });

  initSimInputs();
  fillGoals();
  runSim();
}

export function update(what) {
  if (!root?.isConnected) return;
  if (what === 'charts') { runSim(); return; }
  fillGoals();
  // Mientras no edites el simulador, sus valores siguen a tu cartera real
  if (!sim.touched) {
    const ctx = baseCtx();
    if (!ctx.fx) return;
    const ini = Math.round(toDisplay(ctx.valueUSD));
    const mon = Math.round(toDisplay(ctx.monthlyUSD));
    const changed = (a, b) => Math.abs(a - b) > Math.max(1, Math.abs(b) * 0.01);
    if (changed(ini, sim.initial || 0) || changed(mon, sim.monthly || 0)) {
      sim.initial = ini; sim.monthly = mon;
      initSimInputs();
      runSim();
    }
  }
}

// ---------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------
const STATE_UI = {
  done: { icon: '✅', label: 'Cumplida', cls: 'good' },
  ok: { icon: '🟢', label: 'En camino', cls: 'good' },
  tight: { icon: '🟡', label: 'Justa', cls: 'warn' },
  risk: { icon: '🔴', label: 'En riesgo', cls: 'bad' },
  late: { icon: '⏰', label: 'Venció la fecha', cls: 'bad' },
};

function fillGoals() {
  const box = root.querySelector('[data-goals]');
  if (!box) return;
  const ctx = baseCtx();
  const goals = ctx.u.goals || [];
  if (!goals.length) {
    box.innerHTML = `
      <div class="card empty" style="grid-column:1/-1">
        <div class="big-emoji">🎯</div>
        <h2>Ponele nombre a tu plata</h2>
        <p class="mt">Una meta (la casa, un viaje, tu retiro) hace más fácil sostener el aporte mes a mes. Te mostramos cuánto llevás, cuánto te falta y si vas a llegar.</p>
        <button class="btn primary mt-lg" data-addgoal2>＋ Crear mi primera meta</button>
      </div>`;
    return;
  }
  if (!ctx.fx) { box.innerHTML = '<div class="skeleton card"></div><div class="skeleton card"></div>'; return; }
  const totalShare = goals.reduce((a, g) => a + (Number(g.share) || 0), 0);
  box.innerHTML = goals.map((g) => {
    const st = goalStatus(g, { portfolioUSD: ctx.valueUSD, monthlyUSD: ctx.monthlyUSD, fx: ctx.fx, mu: ctx.mu, sigma: ctx.sigma });
    const ui = STATE_UI[st.state];
    const targetTxt = money(Number(g.target), g.currency);
    const eta = st.etaMonths == null ? 'más de 100 años' : st.etaMonths === 0 ? 'ya' : st.etaMonths < 12 ? `${st.etaMonths} meses` : `${num(st.etaMonths / 12, 1)} años`;
    const neededTxt = show(st.neededMonthlyUSD);
    return `
      <article class="card goal ${ui.cls}">
        <div class="row" style="align-items:flex-start">
          <div class="goal-emoji" aria-hidden="true">${esc(g.emoji || '🎯')}</div>
          <div style="flex:1;min-width:0">
            <h3>${esc(g.name)}</h3>
            <div class="tiny">${targetTxt} · para ${fmtDate(g.date)} (${st.years < 1 ? `${Math.max(0, Math.round(st.years * 12))} meses` : `${num(st.years, 1)} años`})</div>
          </div>
          <span class="badge goal-state">${ui.icon} ${ui.label}</span>
        </div>
        <div class="goal-bar mt" role="progressbar" aria-valuenow="${Math.round(st.progress)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progreso de ${esc(g.name)}">
          <i style="width:${st.progress}%"></i>
        </div>
        <div class="row small mt"><span><b>${show(st.currentUSD)}</b> de ${show(st.targetUSD)}</span><span class="spacer"></span><b>${num(st.progress, 0)}%</b></div>
        <ul class="goal-facts small">
          <li><span>Asignado a esta meta</span><b>${num(g.share, 0)}% de tu cartera y aporte</b></li>
          <li><span>Aporte que va a esta meta</span><b>${show(st.monthlyUSD)}/mes</b></li>
          ${st.state !== 'done' ? `<li><span>Para llegar a tiempo necesitás</span><b>${neededTxt}/mes</b></li>
          <li><span>Al ritmo actual llegás en</span><b>${eta}</b></li>
          <li><span>Probabilidad estimada de llegar</span><b>${num(st.prob * 100, 0)}%</b></li>` : ''}
        </ul>
        <div class="row mt"><button class="btn sm" data-simgoal="${g.id}">Ver en el simulador</button><span class="spacer"></span><button class="btn ghost sm" data-edit="${g.id}">Editar</button></div>
      </article>`;
  }).join('') + (totalShare > 100 ? `<p class="stale" style="grid-column:1/-1">⚠ Tus metas suman ${num(totalShare, 0)}% de la cartera: ajustalas para que no pasen de 100%.</p>` : '')
    + (totalShare < 100 && totalShare > 0 ? `<p class="tiny" style="grid-column:1/-1">El ${num(100 - totalShare, 0)}% restante de tu cartera no está asignado a ninguna meta.</p>` : '');
}

function openGoalForm(goal = null) {
  const u = appRef.user();
  const others = u.goals.filter((g) => g.id !== goal?.id).reduce((a, g) => a + (Number(g.share) || 0), 0);
  const free = Math.max(0, 100 - others);
  const defDate = new Date(); defDate.setFullYear(defDate.getFullYear() + 5);
  let emoji = goal?.emoji || GOAL_EMOJIS[0];
  openModal({
    title: goal ? 'Editar meta' : 'Nueva meta',
    body: `
      <form class="form-grid" data-gf novalidate>
        <div class="field"><span>Ícono</span>
          <div class="emoji-pick" role="radiogroup" aria-label="Ícono">${GOAL_EMOJIS.map((e) => `<button type="button" role="radio" aria-checked="${e === emoji}" class="${e === emoji ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('')}</div>
        </div>
        <label class="field"><span>Nombre</span><input type="text" name="name" maxlength="40" value="${esc(goal?.name || '')}" placeholder="Ej: Departamento propio" required /></label>
        <div class="form-grid two">
          <label class="field"><span>¿Cuánto necesitás?</span><input type="number" name="target" min="0" step="any" inputmode="decimal" value="${goal?.target || ''}" required /></label>
          <label class="field"><span>Moneda</span><select name="currency"><option value="USD" ${goal?.currency !== 'ARS' ? 'selected' : ''}>Dólares</option><option value="ARS" ${goal?.currency === 'ARS' ? 'selected' : ''}>Pesos de hoy</option></select></label>
        </div>
        <label class="field"><span>¿Para cuándo?</span><input type="date" name="date" min="${todayStr()}" value="${goal?.date || todayStr(defDate)}" required /></label>
        <label class="field"><span>Parte de tu cartera y de tu aporte para esta meta: <b data-share-lbl>${goal?.share ?? free}%</b></span>
          <input type="range" name="share" min="0" max="100" step="5" value="${goal?.share ?? free}" />
          <small>Libre para asignar: ${num(free, 0)}%. Si tenés una sola meta, dejalo en 100%.</small>
        </label>
        <div class="card" style="background:var(--surface-2);box-shadow:none" data-preview></div>
      </form>`,
    actions: `${goal ? '<button class="btn ghost" data-del style="color:var(--down);margin-right:auto">Eliminar</button>' : ''}<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-save>${goal ? 'Guardar' : 'Crear meta'}</button>`,
    onMount: (el, close) => {
      const f = el.querySelector('[data-gf]');
      el.querySelectorAll('[data-emoji]').forEach((b) => b.addEventListener('click', () => {
        emoji = b.dataset.emoji;
        el.querySelectorAll('[data-emoji]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      }));
      const preview = () => {
        const v = Object.fromEntries(new FormData(f));
        el.querySelector('[data-share-lbl]').textContent = `${v.share}%`;
        const box = el.querySelector('[data-preview]');
        if (!(Number(v.target) > 0) || !v.date) { box.innerHTML = '<span class="small muted">Completá monto y fecha para ver si llegás.</span>'; return; }
        const ctx = baseCtx();
        const st = goalStatus({ ...v, target: Number(v.target), share: Number(v.share) }, { portfolioUSD: ctx.valueUSD, monthlyUSD: ctx.monthlyUSD, fx: ctx.fx, mu: ctx.mu, sigma: ctx.sigma });
        box.innerHTML = `<div class="small">Con lo que tenés y tu aporte actual: <b>${STATE_UI[st.state].icon} ${STATE_UI[st.state].label}</b>
          ${st.state !== 'done' ? `<br>Necesitás aportar ~<b>${show(st.neededMonthlyUSD)}/mes</b> a esta meta · probabilidad ${num(st.prob * 100, 0)}%` : ''}</div>`;
      };
      f.addEventListener('input', debounce(preview, 150));
      preview();
      el.querySelector('[data-save]').addEventListener('click', () => {
        const v = Object.fromEntries(new FormData(f));
        if (!v.name.trim()) { toast('Poné un nombre', 'error'); return; }
        if (!(Number(v.target) > 0)) { toast('El monto tiene que ser mayor a 0', 'error'); return; }
        if (!v.date || v.date <= todayStr()) { toast('Elegí una fecha futura', 'error'); return; }
        const rec = { id: goal?.id || store.uid('g'), name: v.name.trim(), emoji, target: Number(v.target), currency: v.currency, date: v.date, share: Number(v.share), createdAt: goal?.createdAt || new Date().toISOString() };
        store.updateUser((uu) => {
          const i = uu.goals.findIndex((g) => g.id === rec.id);
          if (i >= 0) uu.goals[i] = rec; else uu.goals.push(rec);
        });
        close();
        toast(goal ? 'Meta actualizada' : 'Meta creada 🎯');
        fillGoals();
      });
      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmDialog(`¿Eliminar la meta "${goal.name}"? Tus inversiones no se tocan.`, { ok: 'Eliminar', danger: true }))) return;
        store.updateUser((uu) => { uu.goals = uu.goals.filter((g) => g.id !== goal.id); });
        close();
        fillGoals();
      });
    },
  });
}

function simulateGoal(id) {
  const ctx = baseCtx();
  const g = ctx.u.goals.find((x) => x.id === id);
  if (!g) return;
  const share = (Number(g.share) || 0) / 100;
  sim.initial = toDisplay(ctx.valueUSD * share);
  sim.monthly = toDisplay(ctx.monthlyUSD * share);
  sim.years = Math.max(1, Math.round(yearsUntil(g.date)));
  sim.goal = g;
  sim.touched = true;
  initSimInputs();
  runSim();
  root.querySelector('#sim-h').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------
// Simulador
// ---------------------------------------------------------------------
function initSimInputs() {
  const ctx = baseCtx();
  if (sim.initial == null && ctx.fx) sim.initial = Math.round(toDisplay(ctx.valueUSD));
  if (sim.monthly == null && ctx.fx) sim.monthly = Math.round(toDisplay(ctx.monthlyUSD));
  if (sim.years == null) sim.years = Math.min(40, Math.max(1, Math.round(ctx.u.profile?.horizon || 10)));
  if (sim.level == null) sim.level = ctx.u.profile?.level ?? 2;
  const q = (k) => root.querySelector(`[data-sim="${k}"]`);
  q('initial').value = sim.initial == null ? '' : Math.round(sim.initial);
  q('monthly').value = sim.monthly == null ? '' : Math.round(sim.monthly);
  q('years').value = sim.years;
  q('level').value = sim.level;
  root.querySelector('[data-years-lbl]').textContent = sim.years;
  if (!q('initial')._wired) {
    const onIn = debounce(() => {
      sim.initial = Number(q('initial').value) || 0;
      sim.monthly = Number(q('monthly').value) || 0;
      sim.years = Number(q('years').value) || 1;
      sim.level = Number(q('level').value);
      sim.goal = null;
      sim.touched = true;
      root.querySelector('[data-years-lbl]').textContent = sim.years;
      runSim();
    }, 120);
    ['initial', 'monthly', 'years', 'level'].forEach((k) => { q(k).addEventListener('input', onIn); q(k)._wired = true; });
  }
}

function runSim() {
  const out = root.querySelector('[data-sim-out]');
  if (!out) return;
  if (!appRef.fx() || sim.initial == null) { out.innerHTML = '<div class="skeleton card"></div>'; return; }
  const alloc = targetAllocation({ ...appRef.user().profile, level: sim.level }).alloc;
  const { mu, sigma } = portfolioStats(alloc);
  const initialUSD = fromDisplay(sim.initial || 0);
  const monthlyUSD = fromDisplay(sim.monthly || 0);
  const targetUSD = sim.goal ? (sim.goal.currency === 'USD' ? sim.goal.target : sim.goal.target / (appRef.fx() || 1)) : null;
  const r = simulate({ initial: initialUSD, monthly: monthlyUSD, years: sim.years, mu, sigma, target: targetUSD });
  const cur = appRef.display();
  const fmt = (v) => show(v);
  out.innerHTML = `
    ${sim.goal ? `<p class="small"><b>${esc(sim.goal.emoji)} ${esc(sim.goal.name)}</b>: probabilidad de llegar a ${money(sim.goal.target, sim.goal.currency)} → <b>${num((r.probTarget || 0) * 100, 0)}%</b></p>` : ''}
    <div class="stats sim-stats">
      <div class="stat"><div class="lbl">😟 Pesimista</div><div class="val">${fmt(r.final.p10)}</div><div class="sub tiny">9 de cada 10 veces te va mejor</div></div>
      <div class="stat hero"><div class="lbl">🙂 Escenario base</div><div class="val">${fmt(r.final.p50)}</div><div class="sub tiny">el resultado más típico</div></div>
      <div class="stat"><div class="lbl">🤩 Optimista</div><div class="val">${fmt(r.final.p90)}</div><div class="sub tiny">solo 1 de cada 10 veces te va mejor</div></div>
      <div class="stat"><div class="lbl">💰 Lo que ponés vos</div><div class="val">${fmt(r.contributed)}</div><div class="sub tiny">capital + aportes</div></div>
    </div>
    <p class="mt">En <b>${sim.years} años</b>, ${sim.monthly > 0 ? `aportando ${money(sim.monthly, cur)} por mes` : 'sin aportes'}, con un perfil <b>${esc(PROFILES[sim.level].name.toLowerCase())}</b>, lo más probable es que tengas entre <b>${fmt(r.final.p10)}</b> y <b>${fmt(r.final.p90)}</b> (en plata de hoy).
      ${r.final.p50 > r.contributed ? `En el escenario base, el mercado te suma <b>${fmt(r.final.p50 - r.contributed)}</b> sobre lo que pusiste.` : ''}
      Chance de terminar con menos de lo que pusiste: <b>${num(r.probLoss * 100, 0)}%</b>.</p>
    <div class="row small wrap mt" style="gap:14px">
      <span class="row"><span class="cls-dot" style="background:var(--series-1)"></span>Escenario base</span>
      <span class="row"><span class="cls-dot" style="background:color-mix(in srgb, var(--series-1) 25%, transparent)"></span>Rango pesimista–optimista</span>
      <span class="row"><span class="cls-dot" style="background:var(--text-3)"></span>Lo que ponés vos</span>
      ${targetUSD ? '<span class="row"><span class="cls-dot" style="background:var(--series-2)"></span>Meta</span>' : ''}
    </div>
    <div class="chart-box mt"><canvas aria-label="Proyección de la inversión"></canvas></div>
    <p class="tiny mt">Rendimiento real esperado del perfil: ${pct(mu * 100, { sign: false })} anual · volatilidad ${pct(sigma * 100, { sign: false, dec: 0 })}.</p>`;
  const blue = cssVar('--series-1');
  const conv = (v) => toDisplay(v);
  const series = [
    { label: 'Optimista', data: r.points.map((p) => conv(p.p90)), color: blue, width: 0, fill: '+1', bg: `${blue}33` },
    { label: 'Pesimista', data: r.points.map((p) => conv(p.p10)), color: blue, width: 0 },
    { label: 'Base', data: r.points.map((p) => conv(p.p50)), color: blue },
    { label: 'Lo que ponés', data: r.points.map((p) => conv(p.contributed)), color: cssVar('--text-3'), dashed: true },
  ];
  if (targetUSD) series.push({ label: 'Meta', data: r.points.map(() => conv(targetUSD)), color: cssVar('--series-2'), dashed: true });
  lineChart(out.querySelector('canvas'), {
    labels: r.points.map((p) => (p.year === 0 ? 'Hoy' : `Año ${p.year}`)),
    series,
    yFormat: (v) => money(v, cur, { compact: true }),
    tooltipFormat: (v) => money(v, cur),
  });
  fillCompare(initialUSD, monthlyUSD);
}

function fillCompare(initialUSD, monthlyUSD) {
  const box = root.querySelector('[data-compare]');
  if (!box) return;
  const rows = PROFILES.map((p, i) => {
    const alloc = targetAllocation({ ...appRef.user().profile, level: i }).alloc;
    const { mu, sigma } = portfolioStats(alloc);
    const r = simulate({ initial: initialUSD, monthly: monthlyUSD, years: sim.years, mu, sigma, runs: 500 });
    return { p, i, r, mu };
  });
  const max = Math.max(...rows.map((x) => x.r.final.p90)) || 1;
  box.innerHTML = `<div class="compare">${rows.map(({ p, i, r }) => `
    <div class="cmp-row ${i === appRef.user().profile.level ? 'mine' : ''}">
      <div class="cmp-name">${p.emoji} ${esc(p.name)}${i === appRef.user().profile.level ? ' <span class="badge">Tu perfil</span>' : ''}</div>
      <div class="cmp-bar" aria-hidden="true">
        <span class="rng" style="left:${(r.final.p10 / max) * 100}%;width:${((r.final.p90 - r.final.p10) / max) * 100}%"></span>
        <span class="mid" style="left:${(r.final.p50 / max) * 100}%"></span>
      </div>
      <div class="cmp-val num"><b>${show(r.final.p50)}</b><div class="tiny">${show(r.final.p10, { compact: true })} – ${show(r.final.p90, { compact: true })}</div></div>
    </div>`).join('')}</div>
    <p class="tiny mt">La barra muestra el rango pesimista–optimista y la marca, el escenario base. Más riesgo = más potencial, pero también un rango más amplio.</p>`;
}
