// =====================================================================
// SINCRONIZACIÓN CON FIREBASE (plan Spark, gratis)
// - Login con Google.
// - Un documento por cuenta: asesor/{uid} con todos los usuarios/carteras.
// - Firebase se carga solo si activás la sincronización.
// =====================================================================
import * as store from './storage.js';
import { FIREBASE_CONFIG } from './config.js';
import { createSyncEngine } from './sync-engine.js';

const BUNDLE = '../vendor/firebase-13.1.0.bundle.js';

export const syncState = { status: 'off', email: null, name: null, lastSync: null, error: null };
const listeners = new Set();
export function onSyncStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(patch) {
  Object.assign(syncState, patch);
  listeners.forEach((fn) => { try { fn({ ...syncState }); } catch (e) { console.error(e); } });
}

let fb = null, app = null, auth = null, db = null, engine = null, configKey = null;

export function activeConfig() {
  return FIREBASE_CONFIG || store.getSyncConfig();
}

const ERRORS = {
  'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase. Agregalo en Authentication → Settings → Authorized domains.',
  'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
  'auth/network-request-failed': 'Sin conexión a internet.',
  'auth/operation-not-allowed': 'Falta habilitar el inicio de sesión con Google en Firebase (Authentication → Sign-in method).',
  'auth/invalid-api-key': 'La apiKey de la configuración no es válida.',
  'permission-denied': 'Firestore rechazó el acceso: revisá las reglas de seguridad (ver README).',
};
export function friendlyError(err) {
  const code = err?.code || '';
  return ERRORS[code] || err?.message || String(err);
}

/** Inicializa Firebase con la configuración (sin abrir el login). */
export async function initSync() {
  const config = activeConfig();
  if (!config) { emit({ status: 'off' }); return false; }
  const key = JSON.stringify(config);
  if (app && configKey === key) return true;
  try {
    emit({ status: 'loading', error: null });
    fb = fb || await import(BUNDLE);
    // Nombre fijo: Firebase guarda la sesión con este nombre. Si cambiara en cada
    // carga, la sesión se perdería al recargar y el regreso del login de Google también.
    app = fb.initializeApp(config, `asesor-${config.projectId}-${String(config.apiKey).slice(-6)}`);
    configKey = key;
    auth = fb.getAuth(app);
    db = fb.getFirestore(app);
    // Solo para pruebas locales con los emuladores de Firebase
    let emu = null;
    try { emu = localStorage.getItem('asesor:emulator'); } catch { /* ignore */ }
    if (emu) {
      fb.connectAuthEmulator(auth, `http://${emu}:9099`, { disableWarnings: true });
      fb.connectFirestoreEmulator(db, emu, 8081);
    }
    await fb.setPersistence(auth, fb.browserLocalPersistence).catch(() => {});
    let pendingRedirect = false;
    try { pendingRedirect = sessionStorage.getItem('asesor:redirect') === '1'; sessionStorage.removeItem('asesor:redirect'); } catch { /* ignore */ }
    if (pendingRedirect) fb.getRedirectResult(auth).catch((err) => emit({ status: 'error', error: friendlyError(err) }));
    fb.onAuthStateChanged(auth, (user) => {
      if (user) {
        emit({ status: 'connecting', email: user.email, name: user.displayName, error: null });
        startEngine(user.uid);
      } else {
        stopEngine();
        emit({ status: 'signed-out', email: null, name: null });
      }
    });
    return true;
  } catch (err) {
    emit({ status: 'error', error: friendlyError(err) });
    return false;
  }
}

function startEngine(uid) {
  stopEngine();
  const ref = fb.doc(db, 'asesor', uid);
  const provider = {
    subscribe(onRemote, onError) {
      return fb.onSnapshot(ref, (snap) => {
        if (snap.metadata.hasPendingWrites) return; // eco de nuestra propia escritura
        if (!snap.exists()) { onRemote(null); return; }
        try { onRemote(JSON.parse(snap.data().payload)); } catch (e) { onError(e); }
      }, (err) => onError({ message: friendlyError(err) }));
    },
    write(payload) {
      return fb.setDoc(ref, { payload: JSON.stringify(payload), updatedAt: Date.now(), schema: 1 });
    },
  };
  engine = createSyncEngine({
    store: { getPayload: store.getSyncPayload, apply: store.applySynced, onChange: store.onChange },
    provider,
    onStatus: (s) => emit({ status: s.status === 'idle' ? 'signed-out' : s.status, lastSync: s.lastSync, error: s.error }),
  });
  engine.start();
}

function stopEngine() {
  engine?.stop();
  engine = null;
}

export async function signIn() {
  if (!(await initSync())) throw new Error(syncState.error || 'Falta la configuración de Firebase.');
  // Solo con los emuladores locales: login de prueba sin ventana de Google
  let emuUser = null;
  try { emuUser = localStorage.getItem('asesor:emulator') && localStorage.getItem('asesor:emulator-user'); } catch { /* ignore */ }
  if (emuUser) {
    const cred = fb.GoogleAuthProvider.credential(JSON.stringify({ sub: emuUser, email: emuUser, email_verified: true, name: emuUser.split('@')[0] }));
    await fb.signInWithCredential(auth, cred);
    return;
  }
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const redirect = () => {
    try { sessionStorage.setItem('asesor:redirect', '1'); } catch { /* ignore */ }
    return fb.signInWithRedirect(auth, provider);
  };
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (err) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(err?.code)) {
      return redirect();
    }
    emit({ status: 'error', error: friendlyError(err) });
    throw err;
  }
}

export async function signOutSync() {
  if (engine) await engine.flush().catch(() => {});
  stopEngine();
  if (auth) await fb.signOut(auth);
  emit({ status: 'signed-out', email: null, name: null });
}

export async function syncNow() {
  if (!engine) throw new Error('No hay sesión iniciada.');
  await engine.pushNow();
}

/** Olvida la configuración guardada en este dispositivo. */
export async function disconnect() {
  await signOutSync().catch(() => {});
  store.setSyncConfig(null);
  app = null; auth = null; db = null; configKey = null;
  emit({ status: 'off', error: null });
}
