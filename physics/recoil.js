
import { val } from '../data/num.js';
import { shotImpulse, barrelTime } from '../data/ammo.js';
import { makeBody, refresh, integrate, boxInertia, inv3, qmul, qconj, qLog } from './math3d.js';
import { CHUNKS, FRAME_STATE, STRIDE, makeSpots, spotForces, chunkStart, spotArea, spotSlip, spotSticking, resetSlip, shiftSpots, squeezeSpots } from './spots.js';
import { GLOCK_TRIGGER, TRIGGER_FINGER, RIFLING, travelForForce, pressShare } from '../data/trigger.js';
import { FATIGUE } from '../data/skin.js';
import { fingerPull } from './finger.js';

const DEG = Math.PI / 180;
export const SETTLE = { damped: 0.3, free: 0.2, fine: 0.15, dampTime: 0.05, move: 0.010, turn: 5, speed: 0.002 };
const TRACK_K = 2e6, TRACK_C = 1500;
const LOCK_W = 4000;

export function defaultOptions() {
  return {
    gravity: 9.81,
    fire: true,
    spin: true,
    after: 0.25,
    dt: 1e-5, settleDt: 2e-5,
    padEvery: 2, settlePadEvery: 4,
    frameEvery: 5e-4,
    settleFrameEvery: 5e-3,
    pressFrameEvery: 1e-3,
    trigger: { style: 'smooth', speed: 0.25, pads: null },
    string: { shots: 1, split: 0.25 },
    hands: null,
  };
}
const MIN_RAMP = 0.02;
const SPOT_DENSE = 0.03;
const SPOT_SPARSE = 0.005;
const PRESS_CLOSE = 0.04;
const NO_BREAK_AFTER = 0.1;

export function impactAt(exit, distance) {
  if (!exit) return null;
  const at = (q, v, gr, D) => {
    const t = (D - q[0]) / v[0];
    return { t, y: q[1] + v[1] * t + 0.5 * gr[1] * t * t, z: q[2] + v[2] * t + 0.5 * gr[2] * t * t };
  };
  const hit = at(exit.muzzle, exit.vel, exit.gravity, distance);
  const ref = at([0, 0, 0], [exit.speed, 0, 0], exit.gravity, distance);
  return { right: (hit.z - ref.z) * 1000, up: (hit.y - ref.y) * 1000, time: hit.t };
}

export function simulateShot({ gun, ammo, pads, law, options = {}, onProgress = null, makeRunner = null }) {
  const o = { ...defaultOptions(), ...options };
  const ph = gun.phys, G = gun.geom, g = o.gravity;
  const v3 = (p) => [p[0] / 1000, p[1] / 1000, (p[2] || 0) / 1000];

  const CART = val(ammo.cartridgeMass), top = v3(ph.magTop), SLOPE = G.gripSlope * DEG;
  function frameMass(rounds) {
    const col = (rounds * ph.roundPitch) / 2000;
    const pieces = [
      ...[...ph.frameParts, ph.mag].map((q) => ({ m: q.m, at: v3(q.at), size: [q.size[0] / 1000, q.size[1] / 1000] })),
      { m: rounds * CART, at: [top[0] - Math.sin(SLOPE) * col, top[1] - Math.cos(SLOPE) * col, 0], size: [0.03, 0.08 * (rounds / ph.capacity)] },
    ];
    let m = 0;
    const cm = [0, 0, 0];
    for (const q of pieces) { m += q.m; for (let k = 0; k < 3; k++) cm[k] += q.m * q.at[k]; }
    for (let k = 0; k < 3; k++) cm[k] /= m;
    const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const q of pieces) {
      if (q.m === 0) continue;
      const r = [q.at[0] - cm[0], q.at[1] - cm[1], q.at[2] - cm[2]];
      const own = boxInertia(q.m, q.size[0], q.size[1], G.frameWidth / 1000);
      const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i * 3 + j] += own[i * 3 + j] + q.m * ((i === j ? r2 : 0) - r[i] * r[j]);
    }
    return { m, cm, I };
  }
  let rounds = ph.capacity;
  const FM0 = frameMass(rounds);
  const mF = FM0.m, cmF = FM0.cm, IF = FM0.I, FM0cm = cmF.slice();
  const cmS = v3(ph.slide.cm), cmB = v3(ph.barrel.cm);
  const frame = makeBody('frame', mF, IF, cmF);
  const slide = makeBody('slide', ph.slide.m, boxInertia(ph.slide.m, ph.slide.size[0] / 1000, ph.slide.size[1] / 1000, G.slideWidth / 1000), cmS);
  const barrel = makeBody('barrel', ph.barrel.m, boxInertia(ph.barrel.m, ph.barrel.size[0] / 1000, G.barrelOD / 1000, G.barrelOD / 1000), cmB);
  const bodies = [frame, slide, barrel];
  const gunMass = mF + slide.m + barrel.m;
  const offS = [cmS[0] - cmF[0], cmS[1] - cmF[1], cmS[2] - cmF[2]];
  const offB = [cmB[0] - cmF[0], cmB[1] - cmF[1], cmB[2] - cmF[2]];
  const lockOf = (b) => { const I = [b.I[0], b.I[4], b.I[8]]; return { k: I.map((i) => i * LOCK_W * LOCK_W), c: I.map((i) => 2 * i * LOCK_W) }; };
  const lockS = lockOf(slide), lockB = lockOf(barrel);

  const A_ = val(law.a), B_ = val(law.B), BONE = val(law.bone), SHEAR = val(law.shearRatio), TAU = val(law.dampingTime);
  const KIN = val(law.kineticRatio);
  const pBone = A_ * (Math.exp(B_ * BONE) - 1), kBone = B_ * (pBone + A_);
  const squashOf = (p) => (p <= pBone ? Math.log(1 + p / A_) / B_ : BONE + (p - pBone) / kBone);
  const N = pads.n;
  const LAW = { A: A_, B: B_, bone: BONE, pBone, kBone, shear: SHEAR, tau: TAU, kin: KIN };
  const runner = makeRunner ? makeRunner({ pads, cm: cmF, squashOf, law: LAW }) : null;
  const sp = runner ? runner.spots : makeSpots(pads, cmF, squashOf);
  const push = sp.push, slipping = sp.slipping;
  const FS = runner ? runner.frameState : new Float64Array(FRAME_STATE);
  const PART = runner ? runner.partial : new Float64Array(CHUNKS * 6);
  const work = (c0, c1) => { for (let c = c0; c < c1; c++) spotForces(sp, LAW, FS, chunkStart(N, c), chunkStart(N, c + 1), PART, c * 6); };
  const computeChunks = runner ? () => runner.compute(work) : () => work(0, CHUNKS);

  const MOST = o.hands && o.hands > 0 ? o.hands : null;
  let held0 = 0;
  for (let i = 0; i < N; i++) held0 += pads.p0[i] * pads.area[i];
  const LOAD = MOST ? Math.min(1, held0 / 2 / MOST) : 0;
  const K_FAT = val(FATIGUE.rate) / 60;
  const tire = { from: null, left: 1, share: 1, gaveAt: null };
  const P0 = Float64Array.from(pads.p0);
  function tiring() {
    if (!MOST || tire.from === null) return;
    tire.left = Math.exp(-K_FAT * LOAD * (t - tire.from));
    const share = tire.left >= LOAD ? 1 : tire.left / LOAD;
    if (share < 1 && tire.gaveAt === null) tire.gaveAt = t;
    if (Math.abs(share - tire.share) > 0.002) { tire.share = share; squeezeSpots(sp, P0, squashOf, share); }
  }

  const imp = shotImpulse(ammo);
  const tExit = barrelTime(ammo, val(gun.spec.barrelLength));
  const tau = tExit / 7, tauGas = 0.00015;
  const inBarrel = imp.bullet + imp.gas * 0.5, gasOut = imp.gas * 0.5;
  const pulseCum = (x) => (x <= 0 ? 0 : 1 - Math.exp(-x / tau) * (1 + x / tau));
  const gasCum = (x) => (x <= tExit ? 0 : 1 - Math.exp(-(x - tExit) / tauGas));
  const kRS = (ph.spring.atFull - ph.spring.atRest) / ph.travel;
  const lockY = G.lockY / 1000, rodY = G.guideRodY / 1000, railY = -0.015;
  const muzzleLocal = [G.muzzleX / 1000 - cmF[0], -cmF[1], -cmF[2]];
  const originLocal = [-cmF[0], -cmF[1], -cmF[2]];
  const breechLocal = [G.breechX / 1000 - cmS[0], -cmS[1], -cmS[2]];
  function setRounds(n) {
    rounds = n;
    const fm = frameMass(n), R = frame.R;
    const d = [fm.cm[0] - cmF[0], fm.cm[1] - cmF[1], fm.cm[2] - cmF[2]];
    const Dx = R[0] * d[0] + R[1] * d[1] + R[2] * d[2], Dy = R[3] * d[0] + R[4] * d[1] + R[5] * d[2], Dz = R[6] * d[0] + R[7] * d[1] + R[8] * d[2];
    frame.px += Dx; frame.py += Dy; frame.pz += Dz;
    frame.vx += frame.wy * Dz - frame.wz * Dy; frame.vy += frame.wz * Dx - frame.wx * Dz; frame.vz += frame.wx * Dy - frame.wy * Dx;
    frame.m = fm.m; frame.im = 1 / fm.m; frame.I.set(fm.I); frame.iI.set(inv3(fm.I)); refresh(frame);
    for (let k = 0; k < 3; k++) {
      cmF[k] = fm.cm[k];
      offS[k] = cmS[k] - cmF[k]; offB[k] = cmB[k] - cmF[k];
      muzzleLocal[k] -= d[k]; originLocal[k] -= d[k];
    }
    shiftSpots(sp, d[0], d[1], d[2]);
  }
  const st = { locked: true, chambered: true, feeding: false, slideLock: false, stovepipe: false, maxS: 0, mag: ph.capacity };
  let t = 0, tShot = -1, fired = false, sNow = 0, vsNow = 0, bNow = 0;
  const events = [];
  const event = (type, extra = {}) => { events.push({ t, type, ...extra }); };

  const trig = { ...defaultOptions().trigger, ...(options.trigger || {}) };
  const X_BREAK = val(GLOCK_TRIGGER.breakAt), X_STOP = val(GLOCK_TRIGGER.travel), F_BREAK = val(GLOCK_TRIGGER.breakForce);
  const X_RESET = val(TRIGGER_FINGER.resetAt), F_RESET = val(TRIGGER_FINGER.resetForce), LOCK = val(TRIGGER_FINGER.lockTime);
  const OVER = val(TRIGGER_FINGER.overtravelTime), HOLD_T = val(TRIGGER_FINGER.holdTime), REL = val(TRIGGER_FINGER.releaseSpeed);
  const PIV = [G.triggerPivot[0] / 1000, G.triggerPivot[1] / 1000];
  const FACE_R = Math.hypot(G.triggerFace[0] - G.triggerPivot[0], G.triggerFace[1] - G.triggerPivot[1]) / 1000;
  const tp = trig.pads && trig.pads.n > 0 ? trig.pads : null;
  const TN = tp ? tp.n : 0;
  const trx = new Float64Array(TN), try_ = new Float64Array(TN), trz = new Float64Array(TN);
  const tfx = new Float64Array(TN), tfy = new Float64Array(TN), tfz = new Float64Array(TN);
  const MU_PAD = val(TRIGGER_FINGER.padFriction), dir = [0, 0, 0];
  let fullTurn = 0, fullPush = 0;
  for (let i = 0; i < TN; i++) {
    const F = tp.p0[i] * tp.area[i];
    fingerPull(tp.nx[i], tp.ny[i], tp.nz[i], MU_PAD, dir);
    trx[i] = tp.x[i] - PIV[0]; try_[i] = tp.y[i] - PIV[1]; trz[i] = tp.z[i];
    tfx[i] = dir[0] * F; tfy[i] = dir[1] * F; tfz[i] = dir[2] * F;
    fullTurn += -(trx[i] * tfy[i] - try_[i] * tfx[i]);
    fullPush += F;
  }
  const faceForce = fullTurn / FACE_R;
  const fingerOn = trig.style !== 'none' && o.fire;
  const T_FULL = trig.speed;
  const wallShare = faceForce > 0 ? Math.min(0.95, val(GLOCK_TRIGGER.curve)[1][1] / faceForce) : 0.4;
  const share = (since) => pressShare(trig.style, T_FULL, since, wallShare);
  let tBreak = null;
  const need = faceForce > 0 ? F_BREAK / faceForce : Infinity;
  if (fingerOn && faceForce > F_BREAK) {
    for (let s = 0; s <= T_FULL + 1e-9; s += 1e-5) if (share(s) >= need) { tBreak = s; break; }
  }
  const breaks = tBreak !== null;
  const PRESS = !fingerOn ? 0 : breaks ? tBreak + LOCK : T_FULL + NO_BREAK_AFTER;
  const SHOTS = fingerOn && breaks ? Math.max(1, Math.min(ph.capacity, Math.round((o.string && o.string.shots) || 1))) : 1;
  const SPLIT = Math.max(0.05, (o.string && o.string.split) || 0.25);
  const rest = Math.min(need * 0.999, F_RESET / faceForce);
  const resetAfter = LOCK + HOLD_T + (X_STOP - X_RESET) / REL;
  const breakT = [-LOCK], pressFrom = [-PRESS];
  for (let j = 1; j < SHOTS; j++) {
    const reset = breakT[j - 1] + resetAfter;
    const b = Math.max(breakT[j - 1] + LOCK + SPLIT - LOCK, reset + MIN_RAMP);
    breakT.push(b);
    pressFrom.push(trig.style === 'slap' ? b - 0.3 * (b - reset) : reset);
  }
  let nBreaks = fingerOn && breaks ? SHOTS : 0;
  const shareOf = (j, tt) => (j === 0 ? share(tt + PRESS)
    : Math.min(1, rest + ((need - rest) * Math.max(0, tt - pressFrom[j])) / (breakT[j] - pressFrom[j])));
  let trigX = 0, trigS = 0, trigF = 0, trigCos = 1, trigSin = 0;
  function finger(tt) {
    trigX = 0; trigS = 0; trigF = 0;
    if (!fingerOn) return;
    if (tt + PRESS < 0) return;
    let j = -1;
    while (j + 1 < nBreaks && tt >= breakT[j + 1]) j++;
    if (j + 1 < nBreaks && j >= 0 && tt >= pressFrom[j + 1]) {
      trigS = shareOf(j + 1, tt);
      trigX = Math.max(X_RESET, travelForForce(trigS * faceForce));
    } else if (j < 0) {
      trigS = share(tt + PRESS);
      trigX = travelForForce(trigS * faceForce);
    } else {
      trigS = shareOf(j, tt);
      const after = tt - breakT[j], holdEnd = LOCK + HOLD_T;
      if (after < OVER) trigX = X_BREAK + ((X_STOP - X_BREAK) * after) / OVER;
      else if (after < holdEnd) trigX = X_STOP;
      else {
        trigX = Math.max(X_RESET, X_STOP - REL * (after - holdEnd));
        const low = Math.min(trigS, rest);
        trigS = low + ((trigS - low) * (trigX - X_RESET)) / (X_STOP - X_RESET);
      }
    }
    trigF = trigS * faceForce;
    const a = trigX / 1000 / FACE_R;
    trigCos = Math.cos(a); trigSin = Math.sin(a);
  }

  const bulletR = val(RIFLING.bulletDiameter) / 2;
  const spinL = o.spin === false ? 0 : val(RIFLING.spinShare) * val(ammo.bulletMass) * bulletR * bulletR * ((2 * Math.PI * val(ammo.muzzleVelocity)) / val(RIFLING.twist));

  const P = [0, 0, 0], VA = [0, 0, 0], TR2 = [0, 0];
  function applyAt(b, Fx, Fy, Fz, px, py, pz) {
    b.fx += Fx; b.fy += Fy; b.fz += Fz;
    const rx = px - b.px, ry = py - b.py, rz = pz - b.pz;
    b.tx += ry * Fz - rz * Fy; b.ty += rz * Fx - rx * Fz; b.tz += rx * Fy - ry * Fx;
  }
  function worldPoint(b, l, out) {
    const R = b.R;
    out[0] = b.px + R[0] * l[0] + R[1] * l[1] + R[2] * l[2];
    out[1] = b.py + R[3] * l[0] + R[4] * l[1] + R[5] * l[2];
    out[2] = b.pz + R[6] * l[0] + R[7] * l[1] + R[8] * l[2];
    return out;
  }
  function pointVel(b, px, py, pz, out) {
    const rx = px - b.px, ry = py - b.py, rz = pz - b.pz;
    out[0] = b.vx + b.wy * rz - b.wz * ry; out[1] = b.vy + b.wz * rx - b.wx * rz; out[2] = b.vz + b.wx * ry - b.wy * rx;
    return out;
  }
  function track(part, off, L) {
    const R = frame.R;
    const dx = part.px - frame.px, dy = part.py - frame.py, dz = part.pz - frame.pz;
    const qx = R[0] * dx + R[3] * dy + R[6] * dz, qy = R[1] * dx + R[4] * dy + R[7] * dz, qz = R[2] * dx + R[5] * dy + R[8] * dz;
    pointVel(frame, part.px, part.py, part.pz, VA);
    const rvx = part.vx - VA[0], rvy = part.vy - VA[1], rvz = part.vz - VA[2];
    const vlx = R[0] * rvx + R[3] * rvy + R[6] * rvz, vly = R[1] * rvx + R[4] * rvy + R[7] * rvz, vlz = R[2] * rvx + R[5] * rvy + R[8] * rvz;
    const fy = -TRACK_K * (qy - off[1]) - TRACK_C * vly, fz = -TRACK_K * (qz - off[2]) - TRACK_C * vlz;
    const Fx = R[1] * fy + R[2] * fz, Fy = R[4] * fy + R[5] * fz, Fz = R[7] * fy + R[8] * fz;
    applyAt(part, Fx, Fy, Fz, part.px, part.py, part.pz);
    applyAt(frame, -Fx, -Fy, -Fz, part.px, part.py, part.pz);
    const aw = frame.qw, bx0 = -frame.qx, by0 = -frame.qy, bz0 = -frame.qz;
    const bw = part.qw, bx = part.qx, by = part.qy, bz = part.qz;
    const ew = aw * bw - bx0 * bx - by0 * by - bz0 * bz, sg = ew < 0 ? -2 : 2;
    const ex = sg * (aw * bx + bx0 * bw + by0 * bz - bz0 * by);
    const ey = sg * (aw * by - bx0 * bz + by0 * bw + bz0 * bx);
    const ez = sg * (aw * bz + bx0 * by - by0 * bx + bz0 * bw);
    const dwx = part.wx - frame.wx, dwy = part.wy - frame.wy, dwz = part.wz - frame.wz;
    const wlx = R[0] * dwx + R[3] * dwy + R[6] * dwz, wly = R[1] * dwx + R[4] * dwy + R[7] * dwz, wlz = R[2] * dwx + R[5] * dwy + R[8] * dwz;
    const tlx = -L.k[0] * ex - L.c[0] * wlx, tly = -L.k[1] * ey - L.c[1] * wly, tlz = -L.k[2] * ez - L.c[2] * wlz;
    const Tx = R[0] * tlx + R[1] * tly + R[2] * tlz, Ty = R[3] * tlx + R[4] * tly + R[5] * tlz, Tz = R[6] * tlx + R[7] * tly + R[8] * tlz;
    part.tx += Tx; part.ty += Ty; part.tz += Tz;
    frame.tx -= Tx; frame.ty -= Ty; frame.tz -= Tz;
    TR2[0] = -(qx - off[0]); TR2[1] = -vlx;
  }
  const FL = new Float64Array(6);
  function fingerOnFrame(out) {
    let Fx = 0, Fy = 0, Fz = 0, Tx = 0, Ty = 0, Tz = 0;
    const c = trigCos, sn = trigSin;
    for (let i = 0; i < TN; i++) {
      const rx = PIV[0] + trx[i] * c + try_[i] * sn - cmF[0], ry = PIV[1] - trx[i] * sn + try_[i] * c - cmF[1], rz = trz[i] - cmF[2];
      const fx = (tfx[i] * c + tfy[i] * sn) * trigS, fy = (-tfx[i] * sn + tfy[i] * c) * trigS, fz = tfz[i] * trigS;
      Fx += fx; Fy += fy; Fz += fz;
      Tx += ry * fz - rz * fy; Ty += rz * fx - rx * fz; Tz += rx * fy - ry * fx;
    }
    out[0] = Fx; out[1] = Fy; out[2] = Fz; out[3] = Tx; out[4] = Ty; out[5] = Tz;
  }
  const PW = new Float64Array(3);
  function powderAt(t0, dt, out) {
    const t1 = t0 + dt;
    out[0] = 0; out[1] = 0; out[2] = 0;
    if (t1 > 0 && t0 < tExit + 12 * tauGas) {
      const Jp = inBarrel * (pulseCum(t1) - pulseCum(t0)) + gasOut * (gasCum(t1) - gasCum(t0));
      if (Jp > 0) out[0] = Jp / dt;
      if (t0 < tExit) {
        const dL = (spinL * (pulseCum(Math.min(t1, tExit)) - pulseCum(Math.max(0, t0)))) / pulseCum(tExit);
        out[1] = dL / dt; out[2] = 1;
      }
    }
  }

  function axial(part, F, yLine, other = frame) {
    const R = frame.R, qx = 0.1 - cmF[0], qy = yLine - cmF[1], qz = -cmF[2];
    const px = frame.px + R[0] * qx + R[1] * qy + R[2] * qz;
    const py = frame.py + R[3] * qx + R[4] * qy + R[5] * qz;
    const pz = frame.pz + R[6] * qx + R[7] * qy + R[8] * qz;
    applyAt(part, F * R[0], F * R[3], F * R[6], px, py, pz);
    applyAt(other, -F * R[0], -F * R[3], -F * R[6], px, py, pz);
  }

  const HOLD = new Float64Array(6);
  function spots() {
    const R = frame.R;
    FS[0] = frame.px; FS[1] = frame.py; FS[2] = frame.pz;
    FS[3] = frame.vx; FS[4] = frame.vy; FS[5] = frame.vz;
    FS[6] = frame.wx; FS[7] = frame.wy; FS[8] = frame.wz;
    for (let k = 0; k < 9; k++) FS[9 + k] = R[k];
    computeChunks();
    let Fx = 0, Fy = 0, Fz = 0, Tx = 0, Ty = 0, Tz = 0;
    for (let c = 0; c < CHUNKS; c++) {
      const o = c * 6;
      Fx += PART[o]; Fy += PART[o + 1]; Fz += PART[o + 2]; Tx += PART[o + 3]; Ty += PART[o + 4]; Tz += PART[o + 5];
    }
    HOLD[0] = Fx; HOLD[1] = Fy; HOLD[2] = Fz; HOLD[3] = Tx; HOLD[4] = Ty; HOLD[5] = Tz;
  }

  let stepCount = 0;
  function step(dt, damp, padEvery) {
    for (let i = 0; i < 3; i++) {
      const b = bodies[i];
      b.fx = 0; b.fy = -b.m * g; b.fz = 0; b.tx = 0; b.ty = 0; b.tz = 0;
      refresh(b);
    }
    track(slide, offS, lockS); const s = TR2[0], vs = TR2[1];
    track(barrel, offB, lockB); const b = TR2[0], vb = TR2[1];
    sNow = s; vsNow = vs; bNow = b;
    finger(t);
    if (trigS > 0 && TN > 0) {
      fingerOnFrame(FL);
      const R = frame.R, Fx = FL[0], Fy = FL[1], Fz = FL[2], Tx = FL[3], Ty = FL[4], Tz = FL[5];
      frame.fx += R[0] * Fx + R[1] * Fy + R[2] * Fz; frame.fy += R[3] * Fx + R[4] * Fy + R[5] * Fz; frame.fz += R[6] * Fx + R[7] * Fy + R[8] * Fz;
      frame.tx += R[0] * Tx + R[1] * Ty + R[2] * Tz; frame.ty += R[3] * Tx + R[4] * Ty + R[5] * Tz; frame.tz += R[6] * Tx + R[7] * Ty + R[8] * Tz;
    }
    if (fired) {
      powderAt(t - tShot, dt, PW);
      if (PW[0] > 0) {
        const F = PW[0], R = frame.R;
        worldPoint(slide, breechLocal, P);
        applyAt(slide, -F * R[0], -F * R[3], -F * R[6], P[0], P[1], P[2]);
      }
      if (PW[2]) {
        const tq = PW[1], R = barrel.R;
        barrel.tx -= tq * R[0]; barrel.ty -= tq * R[3]; barrel.tz -= tq * R[6];
      }
    }
    if (st.locked) {
      axial(barrel, -(2e6 * (s - b) + 600 * (vs - vb)), lockY, slide);
      if (s > ph.locked && vs > 0) { st.locked = false; event('unlock'); }
    } else {
      const stop = ph.locked + 0.0005;
      if (b > stop) axial(barrel, 3e6 * (b - stop) + (vb > 0 ? 2500 * vb : 0), lockY);
      if (s < b) axial(barrel, 2e6 * (b - s) + (vs < vb ? 600 * (vb - vs) : 0), 0, slide);
      if (vs < 0 && s < ph.locked && b < ph.locked + 0.001) st.locked = true;
    }
    if (b < 0) axial(barrel, 4e6 * b + (vb < 0 ? 1500 * vb : 0), lockY);
    axial(slide, ph.spring.atRest + kRS * Math.max(0, s), rodY);
    axial(slide, ph.railFriction * Math.tanh(vs / 0.05), railY);
    if (vs < 0) {
      if (st.feeding && s > ph.stripZone[0] && s < ph.stripZone[1]) axial(slide, -ph.stripForce, -0.010);
      if (s < ph.strikerZone[1]) axial(slide, -ph.strikerForce, 0.002);
    }
    if (s > ph.travel) axial(slide, 4e6 * (s - ph.travel) + (vs > 0 ? 900 * vs : 0), railY);
    if (s < 0) axial(slide, 4e6 * s + (vs < 0 ? 1200 * vs : 0), lockY);
    const lockAt = ph.travel - 0.004;
    if (st.slideLock && s < lockAt) axial(slide, 4e6 * (s - lockAt) + (vs < 0 ? 1200 * vs : 0), railY);

    if (stepCount % padEvery === 0) spots();
    frame.fx += HOLD[0]; frame.fy += HOLD[1]; frame.fz += HOLD[2];
    frame.tx += HOLD[3]; frame.ty += HOLD[4]; frame.tz += HOLD[5];

    for (let i = 0; i < 3; i++) integrate(bodies[i], dt, damp);
    t += dt;
    stepCount++;
  }

  const FW = 19;
  const frames = [], spotRows = [], spotRowOf = [];
  let nextSpotRow = -Infinity, denseUntil = -Infinity;
  let aimQ = [1, 0, 0, 0], aimR = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), aimMuzzle = [G.muzzleX / 1000, 0, 0];
  const Q = [0, 0, 0], QQ = [0, 0, 0, 0], RV = [0, 0, 0];
  function angles(out) {
    const c = qconj(aimQ);
    qmul(c, [frame.qw, frame.qx, frame.qy, frame.qz], QQ);
    qLog(QQ, RV);
    out[0] = RV[2] / DEG; out[1] = -RV[1] / DEG; out[2] = RV[0] / DEG;
    return out;
  }
  const ANG = [0, 0, 0];
  function record() {
    const row = new Float32Array(FW);
    row[0] = t;
    worldPoint(frame, originLocal, P);
    row[1] = P[0] * 1000; row[2] = P[1] * 1000; row[3] = P[2] * 1000;
    row[4] = frame.qw; row[5] = frame.qx; row[6] = frame.qy; row[7] = frame.qz;
    row[8] = sNow * 1000; row[9] = bNow * 1000;
    angles(ANG); row[10] = ANG[0]; row[11] = ANG[1]; row[12] = ANG[2];
    worldPoint(frame, muzzleLocal, P);
    const dx = P[0] - aimMuzzle[0], dy = P[1] - aimMuzzle[1], dz = P[2] - aimMuzzle[2], R = aimR;
    row[13] = (R[0] * dx + R[3] * dy + R[6] * dz) * 1000;
    row[14] = (R[1] * dx + R[4] * dy + R[7] * dz) * 1000;
    row[15] = (R[2] * dx + R[5] * dy + R[8] * dz) * 1000;
    let tot = 0;
    for (let i = 0; i < N; i++) tot += push[i];
    if (t < 0 || t <= denseUntil || t >= nextSpotRow - 1e-12) {
      const each = new Uint16Array(N);
      for (let i = 0; i < N; i++) {
        const q = Math.min(32767, Math.round((push[i] / spotArea(sp, i)) / 100));
        each[i] = q | (slipping[i] ? 32768 : 0);
      }
      spotRows.push(each);
      if (t >= nextSpotRow - 1e-12) nextSpotRow = t + SPOT_SPARSE;
    }
    row[16] = tot;
    row[17] = trigX; row[18] = trigF;
    frames.push(row);
    spotRowOf.push(spotRows.length - 1);
  }

  const totalSettle = SETTLE.damped + SETTLE.free;
  const part = { settle: 0.2, press: fingerOn ? 0.25 : 0 };
  part.shot = 1 - part.settle - part.press;
  const progress = (share, phase) => { if (onProgress) onProgress(share, phase); };
  let nextRec = 0, nextProg = 0;
  const end = -PRESS;
  t = end - totalSettle;
  nextRec = t; nextProg = t;
  const dampStep = Math.exp(-o.settleDt / SETTLE.dampTime);
  const LATE = 0.1;
  let late = null;
  while (t < end - 1e-12) {
    const damped = t < end - SETTLE.free;
    if (!late && t >= end - LATE) late = { p: [frame.px, frame.py, frame.pz], q: [frame.qw, frame.qx, frame.qy, frame.qz] };
    if (t < end - SETTLE.fine) step(o.settleDt, damped ? dampStep : 1, o.settlePadEvery);
    else step(o.dt, 1, o.padEvery);
    if (t >= nextRec - 1e-12) { record(); nextRec += o.settleFrameEvery; }
    if (t >= nextProg) { progress((part.settle * (t - end + totalSettle)) / totalSettle, 'settle'); nextProg += 0.02; }
    if (!Number.isFinite(frame.px + frame.qw)) { event('error', { note: 'The simulation blew up while the grip took hold.' }); break; }
  }
  t = end;
  angles(ANG);
  const shift = Math.hypot(frame.px - cmF[0], frame.py - cmF[1], frame.pz - cmF[2]);
  const turn = Math.hypot(ANG[0], ANG[1], ANG[2]);
  let speed = Infinity;
  if (late) {
    const lateTurn = qLog(qmul(qconj(late.q), [frame.qw, frame.qx, frame.qy, frame.qz]));
    speed = (Math.hypot(frame.px - late.p[0], frame.py - late.p[1], frame.pz - late.p[2]) + 0.1 * Math.hypot(...lateTurn)) / LATE;
  }
  const held = Number.isFinite(shift + speed) && shift < SETTLE.move && turn < SETTLE.turn && speed < SETTLE.speed;
  let settledPush = 0;
  for (let i = 0; i < N; i++) settledPush += push[i];
  const settle = {
    held,
    shift: shift * 1000, turn, speed: speed * 1000,
    push: settledPush, pitch: ANG[0], yaw: ANG[1], roll: ANG[2],
    rule: { move: SETTLE.move * 1000, turn: SETTLE.turn, speed: SETTLE.speed * 1000 },
  };
  const settleFrames = frames.length;

  let press = null, shotFrame = settleFrames;
  if (held) {
    aimQ = [frame.qw, frame.qx, frame.qy, frame.qz];
    aimR = Float64Array.from(frame.R);
    worldPoint(frame, muzzleLocal, P); aimMuzzle = [P[0], P[1], P[2]];
  }
  if (held && fingerOn) {
    event('press', { style: trig.style, faceForce, push: fullPush });
    record();
    nextRec = t + o.pressFrameEvery; nextProg = t;
    tire.from = t;
    let atBreak = null, nextTire = t;
    while (t < -1e-12) {
      step(o.dt, 1, t < -PRESS_CLOSE ? o.settlePadEvery : o.padEvery);
      if (t >= nextTire) { tiring(); nextTire += 0.005; }
      if (breaks && !atBreak && t + PRESS >= tBreak - 1e-12) {
        angles(ANG);
        atBreak = { t, pitch: ANG[0], yaw: ANG[1], roll: ANG[2], force: trigF };
        event('break', { force: trigF });
      }
      if (t >= nextRec - 1e-12 && t < -1e-12) { record(); nextRec += t < -PRESS_CLOSE ? o.pressFrameEvery : o.frameEvery; }
      if (t >= nextProg) { progress(part.settle + (part.press * (t + PRESS)) / PRESS, 'press'); nextProg += 0.005; }
      if (!Number.isFinite(frame.px + frame.qw)) { event('error', { note: 'The simulation blew up while the finger pressed.' }); break; }
    }
    t = 0;
    angles(ANG);
    worldPoint(frame, muzzleLocal, P);
    const dx = P[0] - aimMuzzle[0], dy = P[1] - aimMuzzle[1], dz = P[2] - aimMuzzle[2], R = aimR;
    press = {
      style: trig.style, speed: trig.speed, spots: TN,
      push: fullPush,
      faceForce,
      breakForce: F_BREAK, breaks, time: PRESS * 1000, breakAt: atBreak,
      pitch: ANG[0], yaw: ANG[1], roll: ANG[2],
      moved: [(R[0] * dx + R[3] * dy + R[6] * dz) * 1000, (R[1] * dx + R[4] * dy + R[7] * dz) * 1000, (R[2] * dx + R[5] * dy + R[8] * dz) * 1000],
    };
    if (!breaks) event('noBreak', { note: `The paint on the trigger turns it as hard as ${faceForce.toFixed(1)} N at its face; it breaks at ${F_BREAK} N.` });
  }
  const shoots = held && (!fingerOn || breaks);

  const shotList = [];
  const stick0 = new Float64Array(N * 3), push0 = new Float64Array(N);
  const ready = () => st.chambered && st.locked && sNow < 0.0005;
  function exitNow() {
    worldPoint(frame, muzzleLocal, P);
    pointVel(frame, P[0], P[1], P[2], VA);
    const R = aimR, B = frame.R, v = val(ammo.muzzleVelocity);
    const toAim = (x, y, z) => [R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z];
    const d = [B[0], B[3], B[6]];
    const along = VA[0] * d[0] + VA[1] * d[1] + VA[2] * d[2];
    const across = [VA[0] - along * d[0], VA[1] - along * d[1], VA[2] - along * d[2]];
    return {
      t: t * 1000, speed: v,
      muzzle: toAim(P[0] - aimMuzzle[0], P[1] - aimMuzzle[1], P[2] - aimMuzzle[2]),
      dir: toAim(d[0], d[1], d[2]),
      vel: toAim(v * d[0] + across[0], v * d[1] + across[1], v * d[2] + across[2]),
      across: toAim(across[0], across[1], across[2]),
      gravity: toAim(0, -g, 0),
      aimMuzzle: aimMuzzle.map((x) => x * 1000), aimR: Array.from(aimR),
    };
  }
  function fireNow(j) {
    if (j > 0 && !ready()) return false;
    if (j > 0) setRounds(rounds - 1);
    fired = o.fire; tShot = t;
    if (fired) { st.chambered = false; event('shot', { n: j + 1 }); }
    angles(ANG);
    shotList.push({
      n: j + 1, t: t * 1000, frame: frames.length, pitch: ANG[0], yaw: ANG[1], roll: ANG[2], exit: null,
      mass: frame.m + slide.m + barrel.m, rounds,
      cycle: null, sawRear: false, slideMax: 0, slideSpeed: 0, stovepipe: false, chambered: false,
    });
    st.maxS = 0;
    denseUntil = t + SPOT_DENSE;
    record();
    nextRec = t + o.frameEvery;
    return true;
  }
  function shotStart() {
    const body = (b) => ({ m: b.m, iI: Array.from(b.iI), p: [b.px, b.py, b.pz], v: [b.vx, b.vy, b.vz], q: [b.qw, b.qx, b.qy, b.qz], w: [b.wx, b.wy, b.wz] });
    return {
      bodies: [body(frame), body(slide), body(barrel)],
      spots: { n: N, S: Float64Array.from(sp.S.subarray(0, N * STRIDE)), push: Float64Array.from(push.subarray(0, N)), slipping: Uint8Array.from(slipping.subarray(0, N)) },
      hold: Array.from(HOLD), stepCount, t, tShot, dt: o.dt, padEvery: o.padEvery, after: o.after, frameEvery: o.frameEvery, gravity: g,
      law: { ...LAW }, st: { ...st }, rounds,
      mech: {
        locked: ph.locked, travel: ph.travel, atRest: ph.spring.atRest, kRS, railFriction: ph.railFriction,
        stripZone: ph.stripZone.slice(), stripForce: ph.stripForce, strikerZone: ph.strikerZone.slice(), strikerForce: ph.strikerForce,
        ejectAt: ph.ejectAt, feedAt: ph.feedAt, lockY, rodY, railY, trackK: TRACK_K, trackC: TRACK_C,
        lockS: { k: lockS.k.slice(), c: lockS.c.slice() }, lockB: { k: lockB.k.slice(), c: lockB.c.slice() },
        offS: offS.slice(), offB: offB.slice(), cmF: cmF.slice(), breechLocal: breechLocal.slice(), muzzleLocal: muzzleLocal.slice(),
      },
      aim: { q: aimQ.slice(), R: Array.from(aimR), muzzle: aimMuzzle.slice() },
      fingerLocal(tt, out) {
        const was = [trigX, trigS, trigF, trigCos, trigSin];
        finger(tt);
        if (trigS > 0 && TN > 0) fingerOnFrame(out); else out.fill(0);
        [trigX, trigS, trigF, trigCos, trigSin] = was;
      },
      powder: (tt, dt, out) => powderAt(tt - tShot, dt, out),
    };
  }

  let tEnd = 0;
  if (shoots) {
    resetSlip(sp);
    for (let i = 0; i < N; i++) { spotSticking(sp, i, P); stick0[i * 3] = P[0]; stick0[i * 3 + 1] = P[1]; stick0[i * 3 + 2] = P[2]; push0[i] = push[i]; }
    if (tire.from === null) tire.from = 0;
    fireNow(0);
    shotFrame = shotList[0].frame;
    if (o.probe) o.probe(shotStart());
    const planEnd = breakT[SHOTS - 1] + LOCK + o.after;
    tEnd = o.after;
    let next = 1, brokeNext = false, nextTire = 0;
    nextProg = 0;
    while (t < tEnd) {
      step(o.dt, 1, o.padEvery);
      const cur = shotList[shotList.length - 1];
      if (fired && !cur.exit && t - cur.t / 1000 >= tExit) { cur.exit = exitNow(); event('bulletExit', { n: cur.n }); }
      if (sNow > st.maxS) st.maxS = sNow;
      if (vsNow > cur.slideSpeed) cur.slideSpeed = vsNow;
      if (!cur.sawRear && vsNow < 0 && st.maxS > 0.01) {
        cur.sawRear = true;
        cur.slideMax = st.maxS * 1000;
        event(st.maxS >= ph.travel - 0.0005 ? 'rearStop' : 'shortStroke', { n: cur.n, travel: cur.slideMax });
        if (st.maxS < ph.ejectAt) { cur.stovepipe = st.stovepipe = true; event('stovepipe', { n: cur.n, note: 'The slide did not travel far enough to throw the empty case out.' }); }
        else if (st.maxS < ph.feedAt) event('failToFeed', { n: cur.n, note: 'The slide did not get behind the next round, so the chamber stays empty.' });
        else { st.feeding = true; st.mag -= 1; }
      }
      if (cur.sawRear && cur.cycle === null && sNow < 0.0003 && !cur.stovepipe) {
        cur.cycle = (t - cur.t / 1000) * 1000;
        if (st.feeding) st.chambered = true;
        cur.chambered = st.chambered;
        st.feeding = false;
        event('battery', { n: cur.n });
      }
      if (next < nBreaks && !brokeNext && t >= breakT[next] - 1e-12) { brokeNext = true; event('break', { n: next + 1, force: trigF }); }
      if (next < nBreaks && t >= breakT[next] + LOCK - 1e-12) {
        if (fireNow(next)) { next++; brokeNext = false; tEnd = t + o.after; continue; }
        event('noFire', { n: next + 1, note: !st.chambered ? 'No round in the chamber: the slide had not fed the next one.' : 'The slide was not home yet.' });
        nBreaks = next + 1; next = nBreaks;
        tEnd = t + o.after;
      }
      if (t >= nextTire) { tiring(); nextTire += 0.005; }
      if (t >= nextRec - 1e-12) { record(); nextRec += o.frameEvery; }
      if (t >= nextProg) { progress(part.settle + part.press + (part.shot * Math.min(1, t / planEnd)), 'shot'); nextProg += 0.005; }
      if (!Number.isFinite(frame.px + frame.qw)) { event('error', { note: 'The simulation blew up in the shot.' }); break; }
    }
  }
  if (runner) runner.finish();
  progress(1, 'done');

  const nF = frames.length;
  const flat = new Float32Array(nF * FW);
  for (let k = 0; k < nF; k++) flat.set(frames[k], k * FW);
  const nRows = spotRows.length;
  const spotsFlat = new Uint16Array(nRows * N);
  for (let k = 0; k < nRows; k++) spotsFlat.set(spotRows[k], k * N);
  const spotRow = Int32Array.from(spotRowOf);
  let shot = null;
  const moved = new Float32Array(N);
  for (let j = 0; j < shotList.length; j++) {
    const s = shotList[j], k0 = s.frame, k1 = j + 1 < shotList.length ? shotList[j + 1].frame : nF;
    const a0 = frames[k0], m0 = [a0[13], a0[14], a0[15]];
    let rise = -1e9, tRise = 0, sideMax = 0, roll = 0, back = 0, upMax = -1e9, pushPeak = 0, pPeak = 0, pPeakAt = -1, lastRow = -1;
    for (let k = k0; k < k1; k++) {
      const r = frames[k];
      if (r[10] - a0[10] > rise) { rise = r[10] - a0[10]; tRise = r[0] - s.t / 1000; }
      if (Math.abs(r[11] - a0[11]) > Math.abs(sideMax)) sideMax = r[11] - a0[11];
      if (Math.abs(r[12] - a0[12]) > Math.abs(roll)) roll = r[12] - a0[12];
      if (-(r[13] - m0[0]) > back) back = -(r[13] - m0[0]);
      if (r[14] - m0[1] > upMax) upMax = r[14] - m0[1];
      if (r[16] > pushPeak) pushPeak = r[16];
      if (spotRowOf[k] === lastRow) continue;
      lastRow = spotRowOf[k];
      const row = spotRows[lastRow];
      for (let i = 0; i < N; i++) { const q = row[i] & 32767; if (q > pPeak) { pPeak = q; pPeakAt = i; } }
    }
    const last = frames[k1 - 1];
    Object.assign(s, {
      rise, tRise: tRise * 1000, side: sideMax, roll, back, up: upMax,
      endRise: last[10] - a0[10], endBack: -(last[13] - m0[0]),
      pushPeak, pressurePeak: pPeak / 100, pressurePeakAt: pPeakAt,
    });
  }
  if (shoots && shotList.length) {
    let w = 0, slid = 0, slidPush = 0;
    for (let i = 0; i < N; i++) {
      spotSticking(sp, i, P);
      const m = Math.hypot(P[0] - stick0[i * 3], P[1] - stick0[i * 3 + 1], P[2] - stick0[i * 3 + 2]);
      moved[i] = m * 1000;
      w += push0[i]; slid += push0[i] * m;
      if (spotSlip(sp, i) > 5e-5) slidPush += push0[i];
    }
    const s0 = shotList[0];
    shot = {
      rise: s0.rise, tRise: s0.tRise, side: s0.side, roll: s0.roll, back: s0.back, up: s0.up,
      endRise: s0.endRise, endBack: s0.endBack,
      pushPeak: s0.pushPeak, pressurePeak: s0.pressurePeak, pressurePeakAt: s0.pressurePeakAt,
      slid: w > 0 ? (slid / w) * 1000 : 0, slidShare: w > 0 ? slidPush / w : 0,
      slideMax: s0.slideMax, slideSpeed: s0.slideSpeed, cycle: s0.cycle, stovepipe: s0.stovepipe, chambered: s0.chambered,
    };
  }
  const freeGun = { impulse: imp.total, velocity: imp.total / gunMass, gunMass };
  const momentum = [0, 1, 2].map((k) => bodies.reduce((m, b) => m + b.m * [b.vx, b.vy, b.vz][k], 0));
  return {
    frames: flat, frameWidth: FW, nFrames: nF, settleFrames, shotFrame,
    spots: spotsFlat, spotRow, nSpots: N,
    moved,
    events, settle, press, shot,
    shots: shotList,
    exit: shotList.length ? shotList[0].exit : null,
    string: { planned: SHOTS, split: SPLIT, fired: shotList.length },
    tiring: MOST ? { load: LOAD, left: tire.left, share: tire.share, gaveAt: tire.gaveAt === null ? null : tire.gaveAt * 1000 } : null,
    info: { threads: runner ? runner.threads : 1, spin: spinL, gunMass, frameMass: mF, cmF: FM0cm.map((v) => v * 1000), tExit: tExit * 1000, freeGun, momentum, steps: stepCount, rounds },
  };
}
