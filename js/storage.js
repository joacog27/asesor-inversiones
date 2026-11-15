// =====================================================================
// PERSISTENCIA
// - Datos de usuarios (perfiles, cartera, ajustes): localStorage.
// - Caché de datos de mercado (respuestas grandes): IndexedDB.
// La capa está aislada para poder sumar sincronización (Firebase/Supabase)
// en la etapa 2 sin tocar el resto de la app.
// =====================================================================
import { DEFAULT_WATCH, DEFAULT_SECTIONS, DEFAULT_REMINDER_DAY } from './config.js';
import { mergeRoots, syncPayload } from './sync-merge.js';

const ROOT_KEY = 'asesor:v1';

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function newUserData(name) {
  return {
    id: uid('u'),
    name: name || 'Yo',
    createdAt: new Date().toISOString(),
    profile: null, // { answers, score, level, horizon, goal, emergency, takenAt }
    settings: {
      currency: 'ARS',
      fxCasa: 'bolsa',
      monthlyAmount: 0,
      monthlyCurrency: 'ARS',
      reminderOn: false,
      reminderDay: DEFAULT_REMINDER_DAY,
    },
    market: {
      sections: [...DEFAULT_SECTIONS],
      watch: JSON.parse(JSON.stringify(DEFAULT_WATCH)),
    },
    transactions: [],
    manualPrices: {},
    seen: {}, // últimos valores vistos (para "novedades desde tu última visita")
    goals: [], // { id, name, emoji, target, currency, date, share, createdAt }
    alerts: [], // { id, kind, symbol, name, type: 'above'|'below'|'move', value, active, triggeredAt }
    deletedTx: {}, // id -> timestamp (para sincronizar borrados)
    updatedAt: Date.now(),
  };
}

function emptyRoot() {
  return { version: 1, theme: 'auto', activeUserId: null, users: {}, deleted: {}, sync: { config: null } };
}

let root = load();

function load() {
  const raw = safeGet(ROOT_KEY);
  if (!raw) return emptyRoot();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.users) return emptyRoot();
    // Migraciones suaves: completar campos que falten.
    for (const u of Object.values(parsed.users)) normalizeUser(u);
    parsed.deleted = parsed.deleted || {};
    parsed.sync = parsed.sync || { config: null };
    return parsed;
  } catch {
    return emptyRoot();
  }
}

function normalizeUser(u) {
  const base = newUserData(u.name);
  u.settings = { ...base.settings, ...(u.settings || {}) };
  u.market = { ...base.market, ...(u.market || {}) };
  u.market.watch = { ...base.market.watch, ...(u.market.watch || {}) };
  u.transactions = Array.isArray(u.transactions) ? u.transactions : [];
  u.manualPrices = u.manualPrices || {};
  u.seen = u.seen || {};
  u.goals = Array.isArray(u.goals) ? u.goals : [];
  u.alerts = Array.isArray(u.alerts) ? u.alerts : [];
  u.deletedTx = u.deletedTx || {};
  u.updatedAt = u.updatedAt || 0;
  if (u.profile === undefined) u.profile = null;
  return u;
}

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** meta.remote = true cuando el cambio vino de otro dispositivo (no re-subir). */
export function save(meta = {}) {
  const ok = safeSet(ROOT_KEY, JSON.stringify(root));
  listeners.forEach((fn) => { try { fn(meta); } catch (e) { console.error(e); } });
  return ok;
}

export function getRoot() { return root; }
export function getUsers() { return Object.values(root.users); }
export function getActiveUser() {
  return root.users[root.activeUserId] || null;
}
export function setActiveUser(id) {
  if (root.users[id]) { root.activeUserId = id; save({ deviceOnly: true }); }
}
export function createUser(name) {
  const u = newUserData(name);
  root.users[u.id] = u;
  root.activeUserId = u.id;
  save();
  return u;
}
export function deleteUser(id) {
  delete root.users[id];
  root.deleted = { ...(root.deleted || {}), [id]: Date.now() };
  if (root.activeUserId === id) root.activeUserId = Object.keys(root.users)[0] || null;
  save();
}
export function updateUser(mutator) {
  const u = getActiveUser();
  if (!u) return;
  mutator(u);
  u.updatedAt = Date.now();
  save();
}
export function renameUser(id, name) {
  const u = root.users[id];
  if (!u) return;
  u.name = name;
  u.updatedAt = Date.now();
  save();
}

// Operaciones (con marcas de tiempo para sincronizar ediciones y borrados)
export function upsertTransactions(txs) {
  updateUser((u) => {
    const now = Date.now();
    for (const tx of txs) {
      const rec = { ...tx, updatedAt: now };
      const i = u.transactions.findIndex((t) => t.id === rec.id);
      if (i >= 0) u.transactions[i] = rec; else u.transactions.push(rec);
    }
  });
}
export function removeTransactions(ids) {
  const set = new Set(ids);
  updateUser((u) => {
    const now = Date.now();
    u.transactions = u.transactions.filter((t) => !set.has(t.id));
    for (const id of set) u.deletedTx[id] = now;
  });
}

// ---------------------------------------------------------------------
// Sincronización
// ---------------------------------------------------------------------
export function getSyncPayload() { return syncPayload(root); }
/** Aplica datos fusionados que llegaron de otro dispositivo. */
export function applySynced(payload) {
  for (const u of Object.values(payload.users || {})) normalizeUser(u);
  root.users = payload.users || {};
  root.deleted = payload.deleted || {};
  if (!root.users[root.activeUserId]) root.activeUserId = Object.keys(root.users)[0] || null;
  save({ remote: true });
}
export function getSyncConfig() { return root.sync?.config || null; }
export function setSyncConfig(config) {
  root.sync = { ...(root.sync || {}), config };
  save({ local: true, deviceOnly: true });
}
export function getTheme() { return root.theme || 'auto'; }
export function setTheme(t) { root.theme = t; save({ deviceOnly: true }); }

// ---------------------------------------------------------------------
// Exportar / importar
// ---------------------------------------------------------------------
export function exportJSON() {
  return JSON.stringify({ app: 'asesor-inversiones', exportedAt: new Date().toISOString(), data: root }, null, 2);
}

/** mode: 'merge' (suma usuarios / reemplaza los que tengan mismo id) | 'replace' */
export function importJSON(text, mode = 'merge') {
  const parsed = JSON.parse(text);
  const data = parsed?.data ?? parsed;
  if (!data || typeof data !== 'object' || !data.users) throw new Error('El archivo no tiene el formato esperado.');
  for (const u of Object.values(data.users)) normalizeUser(u);
  if (mode === 'replace') {
    const sync = root.sync;
    root = { ...emptyRoot(), ...data, sync: sync || { config: null } };
    root.deleted = root.deleted || {};
  } else {
    const merged = mergeRoots(syncPayload(root), { users: data.users, deleted: data.deleted || {} });
    root.users = merged.users;
    root.deleted = merged.deleted;
    if (!root.users[root.activeUserId]) root.activeUserId = data.activeUserId && root.users[data.activeUserId] ? data.activeUserId : Object.keys(root.users)[0];
  }
  save();
  return Object.keys(data.users).length;
}

export function wipeAll() {
  root = emptyRoot();
  save();
  cacheClear();
}

// ---------------------------------------------------------------------
// Caché en IndexedDB (con respaldo en memoria si no está disponible)
// ---------------------------------------------------------------------
const mem = new Map();
let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open('asesor-cache', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

export async function cacheGet(key) {
  if (mem.has(key)) return mem.get(key);
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const req = d.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => { if (req.result) mem.set(key, req.result); resolve(req.result || null); };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function cacheSet(key, data) {
  const entry = { t: Date.now(), data };
  mem.set(key, entry);
  const d = await db();
  if (!d) return;
  try { d.transaction('kv', 'readwrite').objectStore('kv').put(entry, key); } catch { /* sin espacio: seguimos en memoria */ }
}

export async function cacheClear() {
  mem.clear();
  const d = await db();
  if (!d) return;
  try { d.transaction('kv', 'readwrite').objectStore('kv').clear(); } catch { /* ignore */ }
}
