// Utilidades puras de símbolos (sin DOM).
import { CRYPTO_LIST, NAMES } from './config.js';

// ---------------------------------------------------------------------
// Utilidades de símbolos
// ---------------------------------------------------------------------
export const LECAP_RE = /^S(\d{2})([EFMAYJLGSOND])(\d)$/;
const MONTHS = { E: 0, F: 1, M: 2, A: 3, Y: 4, J: 5, L: 6, G: 7, S: 8, O: 9, N: 10, D: 11 };

/** Fecha de vencimiento de una LECAP a partir del ticker (ej: S30J7 → 30/06/2027). */
export function lecapMaturity(symbol) {
  const m = LECAP_RE.exec(symbol);
  if (!m) return null;
  return new Date(2020 + Number(m[3]) + (Number(m[3]) < 5 ? 10 : 0), MONTHS[m[2]], Number(m[1]));
}

/** Moneda nativa en la que cotiza un símbolo. */
export function detectCurrency(kind, symbol, symbolSet, price) {
  if (kind === 'usa' || kind === 'cripto' || kind === 'dolar') return 'USD';
  if (kind === 'pf') return 'ARS';
  if (symbol.endsWith('.D')) return 'USD';
  const last = symbol.slice(-1);
  if (kind === 'on') return last === 'D' || last === 'C' ? 'USD' : 'ARS';
  if (last === 'D' || last === 'C') {
    const base = symbol.slice(0, -1);
    if (symbolSet && symbolSet.has(base)) return 'USD';
    if (kind === 'bono' && price && price < 1000) return 'USD';
  }
  return 'ARS';
}

export function prettyName(kind, symbol) {
  if (NAMES[symbol]) return NAMES[symbol];
  if (kind === 'cripto') return CRYPTO_LIST.find((c) => c.symbol === symbol)?.name || symbol;
  if (kind === 'letra') {
    const d = lecapMaturity(symbol);
    if (d) return `LECAP vto. ${d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  }
  return symbol;
}

