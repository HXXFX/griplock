
export function qmul(a, b, out = [0, 0, 0, 0]) {
  const [aw, ax, ay, az] = a, [bw, bx, by, bz] = b;
  out[0] = aw * bw - ax * bx - ay * by - az * bz;
  out[1] = aw * bx + ax * bw + ay * bz - az * by;
  out[2] = aw * by - ax * bz + ay * bw + az * bx;
  out[3] = aw * bz + ax * by - ay * bx + az * bw;
  return out;
}
export const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
export function qnorm(q) { const L = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= L; q[1] /= L; q[2] /= L; q[3] /= L; return q; }
export function qFromAxisAngle(ax, ay, az, ang) {
  const L = Math.hypot(ax, ay, az) || 1, s = Math.sin(ang / 2) / L;
  return [Math.cos(ang / 2), ax * s, ay * s, az * s];
}
export function qFromTo(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const c = cross(a, ax);
    return qFromAxisAngle(c[0], c[1], c[2], Math.PI);
  }
  const c = cross(a, b);
  return qnorm([1 + d, c[0], c[1], c[2]]);
}
export function qFromBasis(x, y, z) {
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let w, qx, qy, qz;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s; }
  return qnorm([w, qx, qy, qz]);
}
export function qToR(q, R) {
  const [w, x, y, z] = q;
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - w * z); R[2] = 2 * (x * z + w * y);
  R[3] = 2 * (x * y + w * z); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - w * x);
  R[6] = 2 * (x * z - w * y); R[7] = 2 * (y * z + w * x); R[8] = 1 - 2 * (x * x + y * y);
  return R;
}
export function qLog(q, out = [0, 0, 0]) {
  let [w, x, y, z] = q;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const s = Math.hypot(x, y, z);
  if (s < 1e-12) { out[0] = 2 * x; out[1] = 2 * y; out[2] = 2 * z; return out; }
  const k = (2 * Math.atan2(s, w)) / s;
  out[0] = x * k; out[1] = y * k; out[2] = z * k;
  return out;
}
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const L = len(a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
export function rotate(q, v) { const R = qToR(q, new Float64Array(9)); return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; }
export function unrotate(q, v) { const R = qToR(q, new Float64Array(9)); return [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]]; }

export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

export function makeBody(name, m, Ibody, p, q = [1, 0, 0, 0]) {
  const b = {
    name, m, im: 1 / m, I: Float64Array.from(Ibody), iI: Float64Array.from(inv3(Ibody)),
    px: p[0], py: p[1], pz: p[2], vx: 0, vy: 0, vz: 0,
    qw: q[0], qx: q[1], qy: q[2], qz: q[3], wx: 0, wy: 0, wz: 0,
    fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0,
    R: new Float64Array(9), iIw: new Float64Array(9), fixed: false,
  };
  refresh(b);
  return b;
}
export const boxInertia = (m, lx, ly, lz) => [m * (ly * ly + lz * lz) / 12, 0, 0, 0, m * (lx * lx + lz * lz) / 12, 0, 0, 0, m * (lx * lx + ly * ly) / 12];
export const rodInertia = (m, r, L) => [m * r * r / 2, 0, 0, 0, m * (3 * r * r + L * L) / 12, 0, 0, 0, m * (3 * r * r + L * L) / 12];

export function refresh(b) {
  const R = b.R, w = b.qw, x = b.qx, y = b.qy, z = b.qz;
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - w * z); R[2] = 2 * (x * z + w * y);
  R[3] = 2 * (x * y + w * z); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - w * x);
  R[6] = 2 * (x * z - w * y); R[7] = 2 * (y * z + w * x); R[8] = 1 - 2 * (x * x + y * y);
  const I = b.iI, o = b.iIw;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) {
        const Rrk = R[r * 3 + k];
        for (let l = 0; l < 3; l++) s += Rrk * I[k * 3 + l] * R[c * 3 + l];
      }
      o[r * 3 + c] = s;
    }
  }
}

export function integrate(b, dt, damp = 1) {
  if (b.fixed) return;
  b.vx = (b.vx + b.fx * b.im * dt) * damp;
  b.vy = (b.vy + b.fy * b.im * dt) * damp;
  b.vz = (b.vz + b.fz * b.im * dt) * damp;
  const o = b.iIw;
  b.wx = (b.wx + (o[0] * b.tx + o[1] * b.ty + o[2] * b.tz) * dt) * damp;
  b.wy = (b.wy + (o[3] * b.tx + o[4] * b.ty + o[5] * b.tz) * dt) * damp;
  b.wz = (b.wz + (o[6] * b.tx + o[7] * b.ty + o[8] * b.tz) * dt) * damp;
  b.px += b.vx * dt; b.py += b.vy * dt; b.pz += b.vz * dt;
  const w = b.qw, x = b.qx, y = b.qy, z = b.qz, h = 0.5 * dt;
  b.qw = w - h * (b.wx * x + b.wy * y + b.wz * z);
  b.qx = x + h * (b.wx * w + b.wy * z - b.wz * y);
  b.qy = y + h * (b.wy * w + b.wz * x - b.wx * z);
  b.qz = z + h * (b.wz * w + b.wx * y - b.wy * x);
  const L = 1 / Math.sqrt(b.qw * b.qw + b.qx * b.qx + b.qy * b.qy + b.qz * b.qz);
  b.qw *= L; b.qx *= L; b.qy *= L; b.qz *= L;
}
