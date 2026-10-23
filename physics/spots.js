
export const CHUNKS = 64;
export const STRIDE = 16;
const LX = 0, NX = 3, R0 = 6, AX = 9, AREA = 12, D0 = 13, MU = 14, SLIP = 15;
export const FRAME_STATE = 18;

export function makeSpots(pads, cm, squashOf, shared = false, into = null) {
  const n = pads.n;
  const Buf = shared ? SharedArrayBuffer : ArrayBuffer;
  const S = into ? into.S : new Float64Array(new Buf(Math.max(1, n * STRIDE) * 8));
  const push = into ? into.push : new Float64Array(new Buf(Math.max(1, n) * 8));
  const slipping = into ? into.slipping : new Uint8Array(new Buf(Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const r = i * STRIDE;
    const L = Math.hypot(pads.nx[i], pads.ny[i], pads.nz[i]) || 1;
    S[r + LX] = pads.x[i] - cm[0]; S[r + LX + 1] = pads.y[i] - cm[1]; S[r + LX + 2] = pads.z[i] - cm[2];
    S[r + NX] = pads.nx[i] / L; S[r + NX + 1] = pads.ny[i] / L; S[r + NX + 2] = pads.nz[i] / L;
    S[r + R0] = S[r + AX] = pads.x[i]; S[r + R0 + 1] = S[r + AX + 1] = pads.y[i]; S[r + R0 + 2] = S[r + AX + 2] = pads.z[i];
    S[r + AREA] = pads.area[i];
    S[r + D0] = pads.p0[i] > 0 ? squashOf(pads.p0[i]) : -1;
    S[r + MU] = pads.mu[i];
    S[r + SLIP] = 0;
    push[i] = pads.p0[i] * pads.area[i];
    slipping[i] = 0;
  }
  return { n, S, push, slipping };
}

export const chunkStart = (n, c) => Math.floor((n * c) / CHUNKS);

export function spotForces(sp, law, F, i0, i1, out, o) {
  const S = sp.S, push = sp.push, slipping = sp.slipping;
  const A = law.A, B = law.B, BONE = law.bone, pBone = law.pBone, kBone = law.kBone, SHEAR = law.shear, TAU = law.tau, KIN = law.kin;
  const fpx = F[0], fpy = F[1], fpz = F[2], vx = F[3], vy = F[4], vz = F[5], wx = F[6], wy = F[7], wz = F[8];
  const R0_ = F[9], R1 = F[10], R2 = F[11], R3 = F[12], R4 = F[13], R5 = F[14], R6 = F[15], R7 = F[16], R8 = F[17];
  let Fx = 0, Fy = 0, Fz = 0, Tx = 0, Ty = 0, Tz = 0;
  for (let i = i0; i < i1; i++) {
    const r = i * STRIDE;
    const d0 = S[r + D0];
    if (d0 < 0) continue;
    const lx = S[r], ly = S[r + 1], lz = S[r + 2];
    const rx = R0_ * lx + R1 * ly + R2 * lz, ry = R3 * lx + R4 * ly + R5 * lz, rz = R6 * lx + R7 * ly + R8 * lz;
    const px = fpx + rx, py = fpy + ry, pz = fpz + rz;
    const ux0 = S[r + 3], uy0 = S[r + 4], uz0 = S[r + 5];
    const nx = R0_ * ux0 + R1 * uy0 + R2 * uz0, ny = R3 * ux0 + R4 * uy0 + R5 * uz0, nz = R6 * ux0 + R7 * uy0 + R8 * uz0;
    const d = d0 + (px - S[r + 6]) * nx + (py - S[r + 7]) * ny + (pz - S[r + 8]) * nz;
    if (d <= 0) {
      push[i] = 0; slipping[i] = 0;
      S[r + 9] = px; S[r + 10] = py; S[r + 11] = pz;
      continue;
    }
    const Vx = vx + wy * rz - wz * ry, Vy = vy + wz * rx - wx * rz, Vz = vz + wx * ry - wy * rx;
    const area = S[r + AREA];
    let p, kp;
    if (d <= BONE) { const e = Math.exp(B * d); p = A * (e - 1); kp = B * A * e; }
    else { p = pBone + kBone * (d - BONE); kp = kBone; }
    const kn = kp * area;
    const vn = Vx * nx + Vy * ny + Vz * nz;
    let Fn = p * area + kn * TAU * vn;
    if (Fn < 0) Fn = 0;
    const ax = S[r + 9], ay = S[r + 10], az = S[r + 11];
    let ux = px - ax, uy = py - ay, uz = pz - az;
    const un = ux * nx + uy * ny + uz * nz;
    ux -= un * nx; uy -= un * ny; uz -= un * nz;
    const kt = SHEAR * kn, ct = kt * TAU;
    let fx = -kt * ux - ct * (Vx - vn * nx), fy = -kt * uy - ct * (Vy - vn * ny), fz = -kt * uz - ct * (Vz - vn * nz);
    const fm2 = fx * fx + fy * fy + fz * fz, lim = S[r + MU] * Fn;
    if (fm2 > lim * lim) {
      const s = (KIN * lim) / Math.sqrt(fm2);
      fx *= s; fy *= s; fz *= s;
      const nax = px + fx / kt, nay = py + fy / kt, naz = pz + fz / kt;
      const mx = nax - ax, my = nay - ay, mz = naz - az;
      S[r + SLIP] += Math.sqrt(mx * mx + my * my + mz * mz);
      S[r + 9] = nax; S[r + 10] = nay; S[r + 11] = naz;
      slipping[i] = 1;
    } else slipping[i] = 0;
    push[i] = Fn;
    const Gx = fx - nx * Fn, Gy = fy - ny * Fn, Gz = fz - nz * Fn;
    Fx += Gx; Fy += Gy; Fz += Gz;
    Tx += ry * Gz - rz * Gy; Ty += rz * Gx - rx * Gz; Tz += rx * Gy - ry * Gx;
  }
  out[o] = Fx; out[o + 1] = Fy; out[o + 2] = Fz; out[o + 3] = Tx; out[o + 4] = Ty; out[o + 5] = Tz;
}

export const spotArea = (sp, i) => sp.S[i * STRIDE + AREA];
export const spotSlip = (sp, i) => sp.S[i * STRIDE + SLIP];
export const spotSticking = (sp, i, out) => { const r = i * STRIDE + AX; out[0] = sp.S[r]; out[1] = sp.S[r + 1]; out[2] = sp.S[r + 2]; return out; };
export function resetSlip(sp) { for (let i = 0; i < sp.n; i++) sp.S[i * STRIDE + SLIP] = 0; }
export function shiftSpots(sp, dx, dy, dz) {
  for (let i = 0; i < sp.n; i++) { const r = i * STRIDE + LX; sp.S[r] -= dx; sp.S[r + 1] -= dy; sp.S[r + 2] -= dz; }
}
export function squeezeSpots(sp, p0, squashOf, share) {
  for (let i = 0; i < sp.n; i++) sp.S[i * STRIDE + D0] = p0[i] > 0 ? squashOf(p0[i] * share) : -1;
}
