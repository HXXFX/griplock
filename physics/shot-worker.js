
import { simulateShot } from './recoil.js';
import { startPool } from './spot-pool.js';
import { GLOCK17 } from '../data/glock17.js';
import { AMMO } from '../data/ammo.js';
import { FLESH, KINETIC_RATIO } from '../data/skin.js';

const law = { ...FLESH, kineticRatio: KINETIC_RATIO };
const CAPACITY = 16384;
let starting = null;
let most = Math.max(0, (navigator.hardwareConcurrency || 2) - 2);

function ready() {
  if (starting) return starting;
  const shared = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
  const n = shared ? most : 0;
  starting = Promise.all(Array.from({ length: n }, () => new Promise((res, rej) => {
    const w = new Worker(new URL('./spot-helper.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { if (e.data && e.data.type === 'ready') res(w); };
    w.onerror = (e) => rej(new Error('A helper thread failed to start: ' + (e.message || 'unknown')));
  }))).then(async (helpers) => ({ helpers, ...(await startPool(helpers, CAPACITY)) }));
  starting.catch(() => { starting = null; });
  return starting;
}
function letGo(pool) {
  for (const w of pool.helpers) w.terminate();
  starting = null;
  most = Math.max(0, pool.helpers.length - 2);
}
const alone = { helpers: [], makeRunner: null, threads: 1 };

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'warm') {
      const pool = await ready();
      self.postMessage({ type: 'warm', threads: pool.threads, of: navigator.hardwareConcurrency || 1, shared: pool.threads > 1 });
      return;
    }
    if (m.type === 'fire') {
      let pool = alone;
      try { pool = await ready(); } catch { pool = alone; }
      const t0 = performance.now();
      let last = 0;
      const run = (p) => simulateShot({
        gun: GLOCK17, ammo: AMMO[m.ammo], pads: m.pads, law, options: { trigger: m.trigger, string: m.string, hands: m.hands },
        makeRunner: m.pads.n <= CAPACITY ? p.makeRunner : null,
        onProgress: (share, phase) => {
          const now = performance.now();
          if (now - last > 40 || share >= 1) { last = now; self.postMessage({ type: 'progress', id: m.id, share, phase }); }
        },
      });
      let out, note = null;
      try { out = run(pool); } catch (err) {
        if (pool === alone) throw err;
        letGo(pool);
        note = `The helper threads stopped answering (${err.message}), so this shot was worked out on one thread.`;
        out = run(alone);
      }
      out.ms = performance.now() - t0;
      out.note = note;
      self.postMessage({ type: 'result', id: m.id, out }, [out.frames.buffer, out.spots.buffer, out.spotRow.buffer, out.moved.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
