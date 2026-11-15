// =====================================================================
// MOTOR DE SINCRONIZACIÓN (independiente del proveedor → testeable)
//
// store:    { getPayload(), apply(payload), onChange(fn(meta)) }
// provider: { subscribe(onRemote(payload|null), onError) → unsubscribe,
//             write(payload) → Promise }
// =====================================================================
import { mergeRoots, fingerprint } from './sync-merge.js';

export function createSyncEngine({ store, provider, debounceMs = 1500, onStatus = () => {} }) {
  let unsub = null, offChange = null, timer = null, lastRemoteFp = null, pushing = null;
  const state = { status: 'idle', lastSync: null, error: null };
  const setStatus = (status, extra = {}) => { Object.assign(state, { status, ...extra }); onStatus({ ...state }); };

  async function push() {
    clearTimeout(timer); timer = null;
    const payload = store.getPayload();
    const fp = fingerprint(payload);
    if (fp === lastRemoteFp) { setStatus('synced', { lastSync: Date.now(), error: null }); return; }
    setStatus('saving');
    try {
      pushing = provider.write(payload);
      await pushing;
      lastRemoteFp = fp;
      setStatus('synced', { lastSync: Date.now(), error: null });
    } catch (err) {
      setStatus('error', { error: String(err?.message || err) });
    } finally {
      pushing = null;
    }
  }

  function schedulePush(ms = debounceMs) {
    clearTimeout(timer);
    timer = setTimeout(push, ms);
  }

  function handleRemote(remote) {
    if (!remote) { push(); return; } // primera vez: no hay nada en la nube
    const local = store.getPayload();
    const merged = mergeRoots(local, remote);
    const fpMerged = fingerprint(merged);
    lastRemoteFp = fingerprint(remote);
    if (fpMerged !== fingerprint(local)) store.apply(merged);
    if (fpMerged !== lastRemoteFp) schedulePush(0);
    else setStatus('synced', { lastSync: Date.now(), error: null });
  }

  return {
    state,
    start() {
      if (unsub) return;
      setStatus('connecting');
      unsub = provider.subscribe(handleRemote, (err) => setStatus('error', { error: String(err?.message || err) }));
      offChange = store.onChange((meta = {}) => {
        if (meta.remote || meta.deviceOnly) return;
        schedulePush();
      });
    },
    stop() {
      clearTimeout(timer); timer = null;
      unsub?.(); unsub = null;
      offChange?.(); offChange = null;
      lastRemoteFp = null;
      setStatus('idle');
    },
    async flush() { if (timer || !lastRemoteFp) await push(); else if (pushing) await pushing; },
    pushNow: push,
  };
}
