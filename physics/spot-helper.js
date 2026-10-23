
import { spotForces, chunkStart } from './spots.js';
import { GEN, DONE, COUNT, ASLEEP, CO_ASLEEP, JOINED, LAW_KEYS, pause } from './spot-pool.js';

function run(m) {
  const { ctrl, frameState, partial, chunks, slot } = m;
  const sp = { S: m.S, push: m.push, slipping: m.slipping, n: 0 };
  const law = {};
  let seen = Atomics.load(ctrl, GEN);
  Atomics.add(ctrl, JOINED, 1);
  for (;;) {
    let spins = 0, g;
    while ((g = Atomics.load(ctrl, GEN)) === seen && ++spins < 200000) pause();
    if (g === seen) {
      Atomics.add(ctrl, ASLEEP, 1);
      while ((g = Atomics.load(ctrl, GEN)) === seen) Atomics.wait(ctrl, GEN, seen, 2000);
      Atomics.sub(ctrl, ASLEEP, 1);
    }
    seen = g;
    sp.n = Atomics.load(ctrl, COUNT);
    LAW_KEYS.forEach((k, i) => { law[k] = m.law[i]; });
    for (let c = chunks[0]; c < chunks[1]; c++) spotForces(sp, law, frameState, chunkStart(sp.n, c), chunkStart(sp.n, c + 1), partial, c * 6);
    Atomics.store(ctrl, slot, g);
    Atomics.add(ctrl, DONE, 1);
    if (Atomics.load(ctrl, CO_ASLEEP)) Atomics.notify(ctrl, DONE);
  }
}

const onMessage = (msg) => { if (msg && msg.type === 'join') run(msg); };
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (e) => onMessage(e.data);
  self.postMessage({ type: 'ready' });
} else {
  const { parentPort } = await import('node:worker_threads');
  parentPort.on('message', onMessage);
  parentPort.postMessage({ type: 'ready' });
}
