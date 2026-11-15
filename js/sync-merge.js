// =====================================================================
// FUSIÓN DE DATOS ENTRE DISPOSITIVOS (pura, sin DOM)
//
// Reglas:
// - Usuarios: se unen por id. Si un usuario existe en ambos lados, su
//   perfil/ajustes/metas/alertas salen del lado modificado más recientemente.
// - Operaciones: se unen por id (gana la versión editada más recientemente)
//   y se respetan las borradas en cualquiera de los dos lados.
// - Usuarios borrados: se respetan si se borraron después de su última edición.
// =====================================================================

export const SYNC_FIELDS = ['users', 'deleted'];

/** Parte de los datos que se sincroniza (el tema y el usuario activo son de cada dispositivo). */
export function syncPayload(root) {
  return { users: root.users || {}, deleted: root.deleted || {} };
}

function maxMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] || 0, v || 0);
  return out;
}

export function mergeUser(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a;
  const deletedTx = maxMap(a.deletedTx, b.deletedTx);
  const txs = new Map();
  for (const tx of [...(a.transactions || []), ...(b.transactions || [])]) {
    const prev = txs.get(tx.id);
    if (!prev || (tx.updatedAt || 0) > (prev.updatedAt || 0)) txs.set(tx.id, tx);
  }
  const transactions = [...txs.values()].filter((tx) => !(deletedTx[tx.id] && deletedTx[tx.id] >= (tx.updatedAt || 0)));
  return {
    ...newer,
    transactions,
    deletedTx,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
  };
}

/** Fusiona la parte sincronizable de dos raíces. Devuelve { users, deleted }. */
export function mergeRoots(local, remote) {
  const deleted = maxMap(local?.deleted, remote?.deleted);
  const ids = new Set([...Object.keys(local?.users || {}), ...Object.keys(remote?.users || {})]);
  const users = {};
  for (const id of ids) {
    const u = mergeUser(local?.users?.[id], remote?.users?.[id]);
    if (deleted[id] && deleted[id] >= (u.updatedAt || 0)) continue;
    users[id] = u;
  }
  return { users, deleted };
}

/** Comparación estable (independiente del orden de claves y de operaciones). */
export function fingerprint(payload) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = norm(v[k]); return o; }, {});
    return v;
  };
  const p = norm(payload);
  for (const u of Object.values(p.users || {})) {
    if (Array.isArray(u.transactions)) u.transactions.sort((x, y) => (x.id < y.id ? -1 : 1));
  }
  return JSON.stringify(p);
}

/**
 * Lee la configuración de Firebase pegada por el usuario: acepta JSON o el
 * objeto JS que muestra la consola de Firebase (`const firebaseConfig = {...}`).
 */
export function parseFirebaseConfig(text) {
  if (!text) return null;
  if (typeof text === 'object') return validConfig(text);
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let body = m[0];
  try { return validConfig(JSON.parse(body)); } catch { /* sigue */ }
  body = body
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'([^']*)'/g, '"$1"')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*}/g, '}');
  try { return validConfig(JSON.parse(body)); } catch { return null; }
}

function validConfig(c) {
  if (!c || typeof c !== 'object') return null;
  if (!c.apiKey || !c.projectId || !c.authDomain) return null;
  const allowed = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
  return Object.fromEntries(Object.entries(c).filter(([k, v]) => allowed.includes(k) && typeof v === 'string'));
}
