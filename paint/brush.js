
import { forNear, MIN_PRESSURE } from './surface.js';
import { FRICTION, TYPICAL_SQUEEZE } from '../data/skin.js';
import { GRIP_AREA, areaOf } from '../data/grip-area.js';
import { val } from '../data/num.js';

export const MAX_PRESSURE = 40;
export const DEFAULT_FRICTION = val(FRICTION.dryTexture.mu);

export function newPaint(s) {
  return { pressure: new Float32Array(s.n), friction: new Float32Array(s.n).fill(DEFAULT_FRICTION) };
}

const falloff = (d, R) => { const q = 1 - (d * d) / (R * R); return q > 0 ? q * q : 0; };
const facing = (dot) => Math.min(1, Math.max(0, (dot + 0.2) / 0.6));

export function dab(s, paint, at, brush, touched = null) {
  const R = brush.radius, P = paint.pressure, F = paint.friction;
  const near = [];
  forNear(s, at.x, at.y, at.z, R, (i, d) => {
    const w = falloff(d, R) * facing(s.nrm[i * 3] * at.nx + s.nrm[i * 3 + 1] * at.ny + s.nrm[i * 3 + 2] * at.nz);
    if (w > 0) near.push(i, w);
  });
  if (brush.mode === 'smooth') {
    let sw = 0, sp = 0;
    for (let k = 0; k < near.length; k += 2) { sw += near[k + 1]; sp += near[k + 1] * P[near[k]]; }
    const avg = sw > 0 ? sp / sw : 0;
    for (let k = 0; k < near.length; k += 2) {
      const i = near[k];
      P[i] += (avg - P[i]) * Math.min(1, brush.amount * near[k + 1]);
      if (touched) touched.add(i);
    }
    return near.length / 2;
  }
  for (let k = 0; k < near.length; k += 2) {
    const i = near[k], w = near[k + 1];
    if (brush.mode === 'push') P[i] = Math.min(MAX_PRESSURE, P[i] + brush.amount * w);
    else if (brush.mode === 'lighten') { P[i] = Math.max(0, P[i] - brush.amount * w); if (P[i] < MIN_PRESSURE) P[i] = 0; }
    else if (brush.mode === 'friction') F[i] += (brush.friction - F[i]) * Math.min(1, brush.amount * w);
    if (touched) touched.add(i);
  }
  return near.length / 2;
}

export function mirrorPaint(s, paint, map, fromRight) {
  const P = paint.pressure.slice(), F = paint.friction.slice();
  for (let i = 0; i < s.n; i++) {
    const z = s.pos[i * 3 + 2];
    if (Math.abs(z) < 1) continue;
    const onTarget = fromRight ? z < 0 : z > 0;
    if (!onTarget) continue;
    const j = map[i];
    if (j < 0) continue;
    P[i] = paint.pressure[j]; F[i] = paint.friction[j];
  }
  paint.pressure.set(P); paint.friction.set(F);
}

export function soften(s, P, passes, R) {
  for (let pass = 0; pass < passes; pass++) {
    const out = new Float32Array(s.n);
    for (let i = 0; i < s.n; i++) {
      let sw = 0, sp = 0;
      const nx = s.nrm[i * 3], ny = s.nrm[i * 3 + 1], nz = s.nrm[i * 3 + 2];
      forNear(s, s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2], R, (j, d) => {
        const w = falloff(d, R) * facing(s.nrm[j * 3] * nx + s.nrm[j * 3 + 1] * ny + s.nrm[j * 3 + 2] * nz);
        sw += w; sp += w * P[j];
      });
      out[i] = sw > 0 ? sp / sw : P[i];
    }
    P.set(out);
  }
}
export function evenOver(s, area, R) {
  const P = Float32Array.from(area);
  soften(s, P, 2, R);
  for (let i = 0; i < s.n; i++) P[i] = area[i] ? P[i] : 0;
  return P;
}

export function squeezeOf(s, pressure) {
  let F = 0;
  for (let i = 0; i < s.n; i++) if (pressure[i] >= MIN_PRESSURE) F += (pressure[i] * s.area[i]) / 100;
  return F / 2;
}

export function startingGrip(s, squeeze = val(TYPICAL_SQUEEZE)) {
  const paint = newPaint(s);
  const P = evenOver(s, areaOf(GRIP_AREA, s.n), 4);
  const k = squeeze / (squeezeOf(s, P) || 1);
  for (let i = 0; i < s.n; i++) P[i] = P[i] * k >= MIN_PRESSURE ? P[i] * k : 0;
  paint.pressure.set(P);
  return paint;
}
