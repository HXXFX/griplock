
import { GLOCK17 } from '../data/glock17.js';
import { TRIGGER_AREA, areaOf } from '../data/grip-area.js';
import { TRIGGER_FINGER } from '../data/trigger.js';
import { val } from '../data/num.js';
import { fingerPull } from '../physics/finger.js';
import { forNear, MIN_PRESSURE } from './surface.js';
import { evenOver } from './brush.js';

const G = GLOCK17.geom;
const PIV = G.triggerPivot, FACE = G.triggerFace;
export const FACE_R = Math.hypot(FACE[0] - PIV[0], FACE[1] - PIV[1]);
const MU = val(TRIGGER_FINGER.padFriction);

export function turnPerPush(s) {
  const out = new Float32Array(s.n), d = [0, 0, 0];
  for (let i = 0; i < s.n; i++) {
    fingerPull(s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2], MU, d);
    const rx = s.pos[i * 3] - PIV[0], ry = s.pos[i * 3 + 1] - PIV[1];
    out[i] = -(rx * d[1] - ry * d[0]) / FACE_R;
  }
  return out;
}

export function triggerTotals(s, pressure) {
  let push = 0, turn = 0, side = 0;
  const net = [0, 0, 0], d = [0, 0, 0];
  for (let i = 0; i < s.n; i++) {
    const p = pressure[i];
    if (p < MIN_PRESSURE) continue;
    const F = (p * s.area[i]) / 100;
    fingerPull(s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2], MU, d);
    const fx = d[0] * F, fy = d[1] * F, fz = d[2] * F;
    const rx = s.pos[i * 3] - PIV[0], ry = s.pos[i * 3 + 1] - PIV[1];
    push += F; side += fz;
    net[0] += fx; net[1] += fy; net[2] += fz;
    turn += -(rx * fy - ry * fx);
  }
  return { push, faceForce: turn / FACE_R, sideways: side, net };
}

export function startingTrigger(s, breakForce, most = Infinity) {
  const pressure = evenOver(s, areaOf(TRIGGER_AREA, s.n), 1.2);
  const { faceForce, push } = triggerTotals(s, pressure);
  let k = faceForce > 0 ? (1.25 * breakForce) / faceForce : 0;
  if (push * k > most) k = most / push;
  for (let i = 0; i < s.n; i++) pressure[i] = pressure[i] * k >= MIN_PRESSURE ? pressure[i] * k : 0;
  return pressure;
}
export { forNear };
