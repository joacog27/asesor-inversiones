// =====================================================================
// FORMULARIO DE OPERACIONES (alta / edición) — compartido
// =====================================================================
import * as store from '../storage.js';
import * as data from '../data.js';
import { KINDS, CLASSES, CLASS_ORDER } from '../config.js';
import { todayStr, grossAmount } from '../portfolio.js';
import { esc, openModal, toast, money, num, debounce, confirmDialog } from '../ui.js';

const KIND_ORDER = ['cedear', 'accion', 'bono', 'letra', 'on', 'cripto', 'fci', 'dolar', 'pf', 'usa', 'manual'];

function defaultClass(kind, currency, extra = {}) {
  if (kind === 'fci') return data.FCI_CATEGORIES[extra.cat]?.cls || 'liquidez';
  if (KINDS[kind]?.cls) return KINDS[kind].cls;
  if (kind === 'bono' || kind === 'on') return currency === 'USD' ? 'rf_usd' : 'rf_ars';
  return 'rv_global';
}

/**
 * Abre el formulario.
 * opts.tx: operación existente (editar)
 * opts.preset: { kind, symbol, side }
 */
export function openTxForm(app, { tx = null, preset = {}, onSaved } = {}) {
  const editing = !!tx;
  const fxNow = app.fx();
  const st = {
    kind: tx?.kind || preset.kind || 'cedear',
    side: tx?.side || preset.side || 'buy',
    symbol: tx?.symbol || preset.symbol || '',
    name: tx?.name || '',
    currency: tx?.currency || 'ARS',
    divisor: tx?.divisor || 1,
    cls: tx?.cls || null,
    clsTouched: !!tx,
    cat: tx?.symbol?.split('|')[0],
  };

  const body = `
    <form id="txf" class="form-grid" novalidate>
      <div class="seg" role="group" aria-label="Tipo de operación" style="justify-self:start">
        <button type="button" data-side="buy">Compra</button>
        <button type="button" data-side="sell">Venta</button>
      </div>
      <label class="field"><span>Tipo de activo</span>
        <select name="kind" ${editing ? 'disabled' : ''}>
          ${KIND_ORDER.map((k) => `<option value="${k}" ${k === st.kind ? 'selected' : ''}>${esc(KINDS[k].label)}</option>`).join('')}
        </select>
      </label>
      <div data-asset></div>
      <div class="form-grid two" data-qtyprice></div>
      <div class="form-grid two">
        <label class="field"><span>Fecha</span><input type="date" name="date" max="${todayStr()}" value="${tx?.date || todayStr()}" required /></label>
        <label class="field"><span>Tipo de cambio (ARS por USD)</span>
          <input type="number" name="fx" step="any" min="0" inputmode="decimal" value="${tx?.fx || (fxNow ? Math.round(fxNow * 100) / 100 : '')}" />
          <small data-fxhint>Se usa para ver tu costo en ${'ARS y USD'}.</small>
        </label>
      </div>
      <div class="form-grid two">
        <label class="field"><span>Comisión (opcional)</span><input type="number" name="fees" step="any" min="0" inputmode="decimal" value="${tx?.fees || ''}" placeholder="0" /></label>
        <label class="field"><span>Clase de activo</span>
          <select name="cls">${CLASS_ORDER.map((c) => `<option value="${c}">${esc(CLASSES[c].name)}</option>`).join('')}</select>
        </label>
      </div>
      <label class="field"><span>Nota (opcional)</span><input type="text" name="note" maxlength="120" value="${esc(tx?.note || '')}" placeholder="Ej: aporte de noviembre" /></label>
      <div class="card" style="background:var(--surface-2);box-shadow:none" data-total></div>
    </form>`;

  const actions = `
    ${editing ? '<button class="btn ghost" data-del style="color:var(--down);margin-right:auto">Eliminar</button>' : ''}
    <button class="btn ghost" data-close>Cancelar</button>
    <button class="btn primary" data-save>${editing ? 'Guardar cambios' : 'Agregar'}</button>`;

  openModal({
    title: editing ? 'Editar operación' : 'Nueva operación',
    body, actions,
    onMount: (el, close) => {
      const f = el.querySelector('#txf');
      const $f = (n) => f.elements[n];

      const setSide = (s) => { st.side = s; el.querySelectorAll('[data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === s)); updateTotal(); };
      el.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => setSide(b.dataset.side)));
      setSide(st.side);

      function renderAsset() {
        const box = el.querySelector('[data-asset]');
        const qp = el.querySelector('[data-qtyprice]');
        const k = st.kind;
        if (k === 'dolar') {
          st.symbol = 'USD'; st.name = 'Dólares'; st.currency = 'USD'; st.divisor = 1;
          box.innerHTML = '<p class="small muted">Registrá dólares que compraste (MEP, oficial, cripto…) y guardás como ahorro. El tipo de cambio de abajo es el precio al que los compraste.</p>';
          qp.innerHTML = `<label class="field"><span>Cantidad de dólares (US$)</span><input type="number" name="qty" step="any" min="0" inputmode="decimal" value="${tx?.qty || ''}" required /></label><input type="hidden" name="price" value="1" />`;
        } else if (k === 'pf') {
          st.currency = 'ARS'; st.divisor = 1;
          box.innerHTML = `<label class="field"><span>Banco</span><input type="text" name="entity" maxlength="40" value="${esc(tx?.symbol || '')}" placeholder="Ej: Banco Nación" required /></label>`;
          qp.innerHTML = `
            <label class="field"><span>Capital (ARS)</span><input type="number" name="price" step="any" min="0" inputmode="decimal" value="${tx?.price || ''}" required /></label>
            <div class="form-grid two">
              <label class="field"><span>TNA %</span><input type="number" name="tna" step="any" min="0" inputmode="decimal" value="${tx?.pf ? +(tx.pf.tna * 100).toFixed(2) : ''}" placeholder="Ej: 30" required /></label>
              <label class="field"><span>Días</span><input type="number" name="days" step="1" min="1" inputmode="numeric" value="${tx?.pf?.days || 30}" required /></label>
            </div>
            <input type="hidden" name="qty" value="1" />`;
        } else if (k === 'manual') {
          box.innerHTML = `
            <div class="form-grid two">
              <label class="field"><span>Nombre del activo</span><input type="text" name="mname" maxlength="40" value="${esc(tx?.name || '')}" placeholder="Ej: Departamento, cuenta en el exterior…" required /></label>
              <label class="field"><span>Moneda</span><select name="mcur"><option value="ARS">ARS</option><option value="USD" ${st.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
            </div>
            <small class="tiny">Su valor actual lo actualizás a mano desde la cartera.</small>`;
          qp.innerHTML = qtyPriceHTML();
          box.querySelector('[name=mcur]').addEventListener('change', (e) => { st.currency = e.target.value; updateTotal(); });
        } else {
          box.innerHTML = `
            <label class="field" style="position:relative"><span>Activo</span>
              <input type="search" name="search" autocomplete="off" placeholder="Buscá por símbolo o nombre (ej: ${k === 'cripto' ? 'BTC' : k === 'fci' ? 'Money Market' : k === 'bono' ? 'AL30D' : 'SPY'})" value="${esc(st.symbol ? (k === 'fci' ? st.name : st.symbol) : '')}" />
              <small data-asset-info></small>
              <div class="search-results card" data-results hidden style="position:absolute;top:100%;left:0;right:0;z-index:5;padding:4px"></div>
            </label>`;
          qp.innerHTML = qtyPriceHTML();
          wireSearch(box);
          if (st.symbol) showAssetInfo();
        }
        wireQty();
        if (!st.clsTouched) $f('cls').value = st.cls || defaultClass(k, st.currency, { cat: st.cat });
        else $f('cls').value = st.cls;
        updateTotal();
      }

      function qtyPriceHTML() {
        const per100 = st.divisor === 100;
        return `
          <label class="field"><span>${per100 ? 'Cantidad (valor nominal)' : 'Cantidad'}</span>
            <input type="number" name="qty" step="any" min="0" inputmode="decimal" value="${tx?.qty ?? ''}" required />
            <small><button type="button" class="btn ghost sm" data-byamount style="padding:0;min-height:0">Calcular por monto invertido</button></small>
          </label>
          <label class="field"><span data-pricelbl>Precio ${per100 ? 'cada 100 nominales' : 'por unidad'} (${st.currency})</span>
            <input type="number" name="price" step="any" min="0" inputmode="decimal" value="${tx?.price ?? ''}" required />
            <small data-pricehint></small>
          </label>`;
      }

      function wireQty() {
        el.querySelector('[data-byamount]')?.addEventListener('click', async () => {
          const price = Number($f('price').value);
          if (!(price > 0)) { toast('Primero completá el precio', 'error'); return; }
          openModal({
            title: 'Calcular cantidad',
            body: `<label class="field"><span>¿Cuánto invertiste? (${st.currency})</span><input type="number" name="amt" step="any" min="0" inputmode="decimal" autofocus /></label>`,
            actions: '<button class="btn primary" data-ok>Calcular</button>',
            onMount: (m, closeM) => {
              const go = () => {
                const amt = Number(m.querySelector('[name=amt]').value);
                if (amt > 0) {
                  let q = (amt * st.divisor) / price;
                  q = st.kind === 'cripto' || st.kind === 'fci' ? +q.toFixed(8) : Math.floor(q * 100) / 100;
                  $f('qty').value = q;
                  updateTotal();
                }
                closeM();
              };
              m.querySelector('[data-ok]').addEventListener('click', go);
              m.querySelector('[name=amt]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
            },
          });
        });
      }

      function showAssetInfo() {
        const info = el.querySelector('[data-asset-info]');
        if (!info) return;
        const q = data.quote(st.kind, st.symbol);
        info.innerHTML = q
          ? `${esc(st.name || st.symbol)} · cotiza en ${st.currency} · último: <b>${money(q.price, st.currency)}</b>${st.divisor === 100 ? ' c/100 VN' : ''}`
          : st.symbol ? `${esc(st.name || st.symbol)} · ${st.currency}` : '';
      }

      function selectAsset(item) {
        st.symbol = item.symbol;
        st.name = item.name || item.symbol;
        st.currency = item.currency || 'ARS';
        st.divisor = item.divisor || KINDS[st.kind].divisor || 1;
        st.cat = item.cat;
        if (!st.clsTouched) st.cls = defaultClass(st.kind, st.currency, { cat: item.cat });
        el.querySelector('[data-qtyprice]').innerHTML = qtyPriceHTML();
        wireQty();
        const q = data.quote(st.kind, st.symbol);
        if (q?.price && !editing) $f('price').value = +q.price.toFixed(st.kind === 'cripto' ? 2 : 4);
        $f('search').value = st.kind === 'fci' ? st.name : st.symbol;
        if (!st.clsTouched) $f('cls').value = st.cls;
        showAssetInfo();
        updateTotal();
      }

      function wireSearch(box) {
        const input = box.querySelector('[name=search]');
        const results = box.querySelector('[data-results]');
        let list = [];
        const load = async () => {
          results.hidden = false;
          results.innerHTML = '<div class="skeleton line"></div><div class="skeleton line"></div>';
          try { list = await data.searchList(st.kind); } catch { list = []; }
          filter();
        };
        const filter = () => {
          const qv = input.value.trim().toUpperCase();
          const items = list.filter((x) => !qv || x.symbol.toUpperCase().includes(qv) || (x.name || '').toUpperCase().includes(qv)).slice(0, 40);
          if (!items.length) {
            results.innerHTML = st.kind === 'cripto' && qv
              ? `<button type="button" data-free="${esc(qv)}"><span>Usar <b>${esc(qv)}</b> (buscar en Binance)</span></button>`
              : '<p class="small muted" style="padding:8px">Sin resultados. Probá con otro símbolo.</p>';
          } else {
            results.innerHTML = items.map((x, i) => `
              <button type="button" data-i="${i}">
                <span><b>${esc(st.kind === 'fci' ? x.name : x.symbol)}</b> <span class="tiny">${esc(st.kind === 'fci' ? `${x.catLabel}${x.currency === 'USD' ? ' · USD' : ''}` : x.name !== x.symbol ? x.name : '')}</span></span>
                <span class="tiny num">${x.price ? money(x.price, x.currency) : ''}</span>
              </button>`).join('');
          }
          results._items = items;
        };
        input.addEventListener('focus', () => (list.length ? (results.hidden = false, filter()) : load()));
        input.addEventListener('input', debounce(() => { if (!list.length) load(); else { results.hidden = false; filter(); } }, 120));
        results.addEventListener('mousedown', (e) => e.preventDefault());
        results.addEventListener('click', async (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.free) {
            const sym = b.dataset.free;
            if (await data.cryptoExists(sym)) {
              await data.loadCrypto([sym]);
              selectAsset({ symbol: sym, name: sym, currency: 'USD', divisor: 1 });
            } else toast(`No encontramos ${sym} en Binance`, 'error');
          } else selectAsset(results._items[Number(b.dataset.i)]);
          results.hidden = true;
        });
        input.addEventListener('blur', () => setTimeout(() => (results.hidden = true), 150));
      }

      function readForm() {
        const qty = Number($f('qty')?.value);
        const price = Number($f('price')?.value);
        return { qty, price, fees: Number($f('fees').value) || 0, fx: Number($f('fx').value) || null };
      }

      function updateTotal() {
        const box = el.querySelector('[data-total]');
        if (!box) return;
        const { qty, price, fees, fx } = readForm();
        if (!(qty > 0) || !(price > 0)) { box.innerHTML = '<span class="small muted">Completá cantidad y precio para ver el total.</span>'; return; }
        const gross = grossAmount({ qty, price, divisor: st.divisor });
        const total = st.side === 'buy' ? gross + fees : gross - fees;
        const other = st.currency === 'ARS' ? (fx ? total / fx : null) : fx ? total * fx : null;
        box.innerHTML = `<div class="row wrap"><span class="muted small">${st.side === 'buy' ? 'Total invertido' : 'Total cobrado'}</span><span class="spacer"></span>
          <b class="num">${money(total, st.currency)}</b>${other != null ? `<span class="tiny num">≈ ${money(other, st.currency === 'ARS' ? 'USD' : 'ARS')}</span>` : ''}</div>`;
      }

      f.addEventListener('input', (e) => { if (e.target.name !== 'search') updateTotal(); });
      $f('cls').addEventListener('change', () => { st.clsTouched = true; st.cls = $f('cls').value; });
      $f('kind').addEventListener('change', () => {
        st.kind = $f('kind').value; st.symbol = ''; st.name = ''; st.currency = 'ARS';
        st.divisor = KINDS[st.kind].divisor || 1; st.clsTouched = false; st.cls = null;
        if (st.kind === 'cripto' || st.kind === 'usa') st.currency = 'USD';
        renderAsset();
      });

      // Tipo de cambio histórico al cambiar la fecha
      $f('date').addEventListener('change', async () => {
        const d = $f('date').value;
        const hint = el.querySelector('[data-fxhint]');
        if (!d || d === todayStr()) { if (fxNow) $f('fx').value = Math.round(fxNow * 100) / 100; return; }
        hint.textContent = 'Buscando el dólar de esa fecha…';
        const series = await data.loadFxHistory(app.fxCasa());
        const v = series ? data.valueAt(series, d) : null;
        if (v) { $f('fx').value = v; hint.textContent = `Dólar ${app.fxCasa() === 'bolsa' ? 'MEP' : app.fxCasa()} del ${d}. Podés corregirlo.`; }
        else hint.textContent = 'No encontramos el dato: completalo a mano.';
        updateTotal();
      });

      renderAsset();

      el.querySelector('[data-save]').addEventListener('click', () => {
        const { qty, price, fees, fx } = readForm();
        const date = $f('date').value;
        let errors = [];
        let symbol = st.symbol, name = st.name, currency = st.currency, pf;
        if (st.kind === 'pf') {
          symbol = ($f('entity').value || '').trim();
          name = `Plazo fijo ${symbol}`;
          const tna = Number($f('tna').value) / 100;
          const days = Number($f('days').value);
          if (!symbol) errors.push('Completá el banco.');
          if (!(tna > 0)) errors.push('Completá la TNA.');
          if (!(days > 0)) errors.push('Completá los días.');
          pf = { tna, days };
        }
        if (st.kind === 'manual') {
          name = ($f('mname').value || '').trim();
          symbol = name.toUpperCase().replace(/\s+/g, '_').slice(0, 24);
          currency = $f('mcur').value;
          if (!name) errors.push('Completá el nombre del activo.');
        }
        if (!symbol) errors.push('Elegí un activo de la lista.');
        if (!(qty > 0)) errors.push('La cantidad tiene que ser mayor a 0.');
        if (!(price > 0)) errors.push('El precio tiene que ser mayor a 0.');
        if (!date) errors.push('Completá la fecha.');
        if (!fx) errors.push('Completá el tipo de cambio.');
        if (st.side === 'sell' && !editing) {
          const pos = app.positions().find((p) => p.kind === st.kind && p.symbol === symbol && !p.closed);
          if (!pos) errors.push('No tenés este activo en tu cartera para vender.');
          else if (qty > pos.qty + 1e-9) errors.push(`Solo tenés ${num(pos.qty)} para vender.`);
        }
        if (errors.length) { toast(errors[0], 'error'); return; }

        const record = {
          id: tx?.id || store.uid('tx'),
          kind: st.kind, symbol, name: name || symbol, cls: $f('cls').value,
          side: st.side, date, qty, price, currency, divisor: st.divisor, fx, fees,
          note: $f('note').value.trim(),
          ...(pf ? { pf } : {}),
        };
        store.upsertTransactions([record]);
        close();
        toast(editing ? 'Operación actualizada' : 'Operación agregada');
        app.ensureMarket();
        onSaved?.(record);
      });

      el.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmDialog('¿Eliminar esta operación? No se puede deshacer.', { ok: 'Eliminar', danger: true }))) return;
        store.removeTransactions([tx.id]);
        close();
        toast('Operación eliminada');
        onSaved?.(null);
      });
    },
  });
}

/** Registra en la cartera las compras del plan del mes (a precio actual). */
export function registerPlan(app, rows, currency, onSaved) {
  const fx = app.fx();
  const items = rows.flatMap((r) => r.items.map((it) => ({ ...it, cls: r.cls }))).filter((it) => it.symbol && it.price > 0 && it.amount > 0);
  if (!items.length) { toast('Todavía no hay precios para registrar el plan', 'error'); return; }
  const rowsHTML = items.map((it, i) => {
    const nativeAmt = it.currency === currency ? it.amount : currency === 'ARS' ? it.amount / fx : it.amount * fx;
    let qty = (nativeAmt * (it.divisor || 1)) / it.price;
    qty = it.kind === 'cripto' || it.kind === 'fci' ? +qty.toFixed(6) : Math.max(0, Math.floor(qty));
    it._qty = qty;
    return `<li>
      <input type="checkbox" data-i="${i}" ${qty > 0 ? 'checked' : 'disabled'} aria-label="Incluir ${esc(it.name)}" />
      <div style="flex:1;min-width:0"><b>${esc(it.symbol.includes('|') ? it.name : it.symbol)}</b> <span class="tiny">${esc(it.label || '')}</span>
        <div class="tiny">${qty > 0 ? `${num(qty)} × ${money(it.price, it.currency)}${it.divisor === 100 ? ' c/100' : ''}` : 'El monto no alcanza para 1 unidad'}</div></div>
      <input type="number" step="any" min="0" value="${qty}" data-q="${i}" style="width:110px" aria-label="Cantidad de ${esc(it.symbol)}" />
    </li>`;
  }).join('');
  openModal({
    title: 'Registrar compras del mes',
    body: `<p class="small muted">Revisá las cantidades que efectivamente compraste (podés cambiarlas). Se cargan con el precio actual y fecha de hoy; después las podés editar.</p><ul class="list mt">${rowsHTML}</ul>`,
    actions: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" data-ok>Agregar a mi cartera</button>',
    onMount: (el, close) => {
      el.querySelector('[data-ok]').addEventListener('click', () => {
        const today = todayStr();
        const txs = [];
        items.forEach((it, i) => {
          const chk = el.querySelector(`[data-i="${i}"]`);
          const q = Number(el.querySelector(`[data-q="${i}"]`).value);
          if (!chk?.checked || !(q > 0)) return;
          txs.push({
            id: store.uid('tx'), kind: it.kind, symbol: it.symbol, name: it.name, cls: it.cls,
            side: 'buy', date: today, qty: q, price: it.price, currency: it.currency, divisor: it.divisor || 1, fx, fees: 0, note: 'Plan del mes',
          });
        });
        if (!txs.length) { toast('No seleccionaste ninguna compra', 'error'); return; }
        store.upsertTransactions(txs);
        close();
        toast(`${txs.length} compra(s) agregadas a tu cartera`);
        app.ensureMarket();
        onSaved?.();
      });
    },
  });
}
