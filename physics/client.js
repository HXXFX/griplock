
export function createShooter() {
  const worker = new Worker(new URL('./shot-worker.js', import.meta.url), { type: 'module' });
  const waiting = new Map();
  let next = 1, warmed = null;
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'warm') { if (warmed) warmed.resolve(m); return; }
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.type === 'progress') w.onProgress && w.onProgress(m.share, m.phase);
    else if (m.type === 'result') { waiting.delete(m.id); w.resolve(m.out); }
    else if (m.type === 'error') { waiting.delete(m.id); w.reject(new Error(m.message)); }
  };
  worker.onerror = (e) => {
    const err = new Error('The shot worker failed: ' + (e.message || 'unknown'));
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
    if (warmed) warmed.reject(err);
  };
  return {
    warm() {
      if (!warmed) {
        let resolve, reject;
        const p = new Promise((a, b) => { resolve = a; reject = b; });
        warmed = { promise: p, resolve, reject };
        worker.postMessage({ type: 'warm' });
      }
      return warmed.promise;
    },
    fire(pads, ammo, how, onProgress) {
      const id = next++;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject, onProgress });
        const buffers = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'area', 'p0', 'mu'].map((k) => pads[k].buffer);
        worker.postMessage({ type: 'fire', id, pads, ammo, trigger: how.trigger, string: how.string, hands: how.hands }, buffers);
      });
    },
  };
}
