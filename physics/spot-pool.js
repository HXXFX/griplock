
import { CHUNKS, FRAME_STATE, STRIDE, makeSpots } from './spots.js';

export const GEN = 0, DONE = 1, COUNT = 2, ASLEEP = 3, CO_ASLEEP = 4, JOINED = 5, BEAT = 6;
export const LAW_KEYS = ['A', 'B', 'bone', 'pBone', 'kBone', 'shear', 'tau', 'kin'];
export const pause = typeof Atomics.pause === 'function' ? () => Atomics.pause() : () => {};
const STALL_MS = 3000;

export async function startPool(helpers, capacity) {
  if (!helpers || helpers.length === 0 || typeof SharedArrayBuffer === 'undefined') return { makeRunner: null, capacity, threads: 1 };
  const T = helpers.length + 1;
  const range = (j) => [Math.floor((CHUNKS * j) / T), Math.floor((CHUNKS * (j + 1)) / T)];
  const sab = (bytes) => new SharedArrayBuffer(Math.max(8, bytes));
  const mem = {
    S: new Float64Array(sab(capacity * STRIDE * 8)),
    push: new Float64Array(sab(capacity * 8)),
    slipping: new Uint8Array(sab(capacity)),
    frameState: new Float64Array(sab(FRAME_STATE * 8)),
    partial: new Float64Array(sab(CHUNKS * 6 * 8)),
    law: new Float64Array(sab(LAW_KEYS.length * 8)),
    ctrl: new Int32Array(sab((BEAT + helpers.length) * 4)),
  };
  const { ctrl } = mem;
  helpers.forEach((h, j) => h.postMessage({ type: 'join', ...mem, chunks: range(j + 1), slot: BEAT + j }));
  const t0 = performance.now();
  while (Atomics.load(ctrl, JOINED) < helpers.length) {
    if (performance.now() - t0 > 10000) throw new Error(`only ${Atomics.load(ctrl, JOINED)} of ${helpers.length} helper threads started`);
    await new Promise((r) => setTimeout(r, 2));
  }
  const mine = range(0);
  let gen = 0;
  function makeRunner({ pads, cm, squashOf, law }) {
    if (pads.n > capacity) throw new Error(`${pads.n} painted spots is more than the pool holds (${capacity})`);
    const spots = makeSpots(pads, cm, squashOf, false, mem);
    LAW_KEYS.forEach((k, i) => { mem.law[i] = law[k]; });
    Atomics.store(ctrl, COUNT, pads.n);
    return {
      spots, frameState: mem.frameState, partial: mem.partial, threads: T,
      compute(work) {
        Atomics.store(ctrl, DONE, 0);
        gen = Atomics.add(ctrl, GEN, 1) + 1;
        if (Atomics.load(ctrl, ASLEEP) > 0) Atomics.notify(ctrl, GEN);
        work(mine[0], mine[1]);
        let spins = 0, since = 0, d;
        while ((d = Atomics.load(ctrl, DONE)) < helpers.length) {
          pause();
          if (++spins > 20000) {
            Atomics.store(ctrl, CO_ASLEEP, 1);
            Atomics.wait(ctrl, DONE, d, 1);
            Atomics.store(ctrl, CO_ASLEEP, 0);
            spins = 0;
            if (!since) since = performance.now();
            else if (performance.now() - since > STALL_MS) {
              const behind = helpers.map((_, j) => j).filter((j) => Atomics.load(ctrl, BEAT + j) < gen);
              throw new Error(`${behind.length} of ${helpers.length} helper threads stopped answering (round ${gen})`);
            }
          }
        }
      },
      finish() {},
    };
  }
  return { makeRunner, capacity, threads: T };
}
