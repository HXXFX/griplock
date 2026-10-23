
import { SHAPE } from '../data/glock17-shape.js';

export const ROW = 9;
export const PART_NAMES = ['frame', 'magazine', 'grip plug', 'small parts'];

export function parseSurface(buffer) {
  const f = new Float32Array(buffer);
  const n = f.length / ROW;
  if (!Number.isInteger(n) || n < 1) throw new Error(`gun-surface.bin: ${f.length} numbers is not a whole number of ${ROW}-number rows`);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const area = new Float32Array(n), open = new Float32Array(n), part = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = i * ROW;
    pos[i * 3] = f[r]; pos[i * 3 + 1] = f[r + 1]; pos[i * 3 + 2] = f[r + 2];
    nrm[i * 3] = f[r + 3]; nrm[i * 3 + 1] = f[r + 4]; nrm[i * 3 + 2] = f[r + 5];
    area[i] = f[r + 6]; open[i] = f[r + 7]; part[i] = f[r + 8];
  }
  const s = { n, pos, nrm, area, open, part };
  s.region = regions(s);
  s.grid = buildGrid(s, 4);
  let total = 0;
  for (let i = 0; i < n; i++) total += area[i];
  s.totalArea = total;
  return s;
}

export const REGIONS = [
  'right side of the grip', 'left side of the grip', 'front strap', 'back strap', 'under the beavertail',
  'trigger guard', 'right side above the trigger', 'left side above the trigger', 'dust cover', 'magazine base',
  'trigger face', 'right side of the trigger', 'left side of the trigger',
];
const GUARD_X = SHAPE.frontStrap.top[0] - 2;
const GUARD_TOP = Math.max(...SHAPE.guardHole.map((p) => p[1]));
function regions(s) {
  const out = new Uint8Array(s.n);
  for (let i = 0; i < s.n; i++) {
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1];
    const nx = s.nrm[i * 3], ny = s.nrm[i * 3 + 1], nz = s.nrm[i * 3 + 2];
    let r;
    if (s.part[i] === 4) r = nz > 0.5 ? 11 : nz < -0.5 ? 12 : 10;
    else if (s.part[i] === 1 && ny < -0.5) r = 9;
    else if (x < GUARD_X) {
      if (nz > 0.55) r = y > GUARD_TOP - 4 && x > GUARD_X - 25 ? 6 : 0;
      else if (nz < -0.55) r = y > GUARD_TOP - 4 && x > GUARD_X - 25 ? 7 : 1;
      else if (nx > 0.3) r = 2;
      else if (ny > 0.3 && x < 20) r = 4;
      else if (ny < -0.6) r = 9;
      else r = 3;
    } else if (y < GUARD_TOP) r = 5;
    else r = nz > 0.55 ? 6 : nz < -0.55 ? 7 : 8;
    out[i] = r;
  }
  return out;
}

function buildGrid(s, cell) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < s.n; i++) {
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  const nx = Math.floor((x1 - x0) / cell) + 1, ny = Math.floor((y1 - y0) / cell) + 1, nz = Math.floor((z1 - z0) / cell) + 1;
  const count = new Uint32Array(nx * ny * nz + 1);
  const cellOf = (i) => {
    const cx = Math.floor((s.pos[i * 3] - x0) / cell), cy = Math.floor((s.pos[i * 3 + 1] - y0) / cell), cz = Math.floor((s.pos[i * 3 + 2] - z0) / cell);
    return (cz * ny + cy) * nx + cx;
  };
  for (let i = 0; i < s.n; i++) count[cellOf(i) + 1]++;
  for (let c = 0; c < nx * ny * nz; c++) count[c + 1] += count[c];
  const fill = count.slice(0, -1), items = new Uint32Array(s.n);
  for (let i = 0; i < s.n; i++) items[fill[cellOf(i)]++] = i;
  return { x0, y0, z0, cell, nx, ny, nz, start: count, items };
}

export function forNear(s, x, y, z, radius, visit) {
  const G = s.grid, r2 = radius * radius;
  const ax = Math.max(0, Math.floor((x - radius - G.x0) / G.cell)), bx = Math.min(G.nx - 1, Math.floor((x + radius - G.x0) / G.cell));
  const ay = Math.max(0, Math.floor((y - radius - G.y0) / G.cell)), by = Math.min(G.ny - 1, Math.floor((y + radius - G.y0) / G.cell));
  const az = Math.max(0, Math.floor((z - radius - G.z0) / G.cell)), bz = Math.min(G.nz - 1, Math.floor((z + radius - G.z0) / G.cell));
  for (let cz = az; cz <= bz; cz++) for (let cy = ay; cy <= by; cy++) for (let cx = ax; cx <= bx; cx++) {
    const c = (cz * G.ny + cy) * G.nx + cx;
    for (let k = G.start[c]; k < G.start[c + 1]; k++) {
      const i = G.items[k];
      const dx = s.pos[i * 3] - x, dy = s.pos[i * 3 + 1] - y, dz = s.pos[i * 3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2) visit(i, Math.sqrt(d2));
    }
  }
}

export function mirrorMap(s) {
  const out = new Int32Array(s.n).fill(-1);
  for (let i = 0; i < s.n; i++) {
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = -s.pos[i * 3 + 2];
    const nx = s.nrm[i * 3], ny = s.nrm[i * 3 + 1], nz = -s.nrm[i * 3 + 2];
    let best = -1, bd = Infinity;
    forNear(s, x, y, z, 3, (j, d) => {
      if (d < bd && s.nrm[j * 3] * nx + s.nrm[j * 3 + 1] * ny + s.nrm[j * 3 + 2] * nz > 0.5) { bd = d; best = j; }
    });
    out[i] = best;
  }
  return out;
}

export const MIN_PRESSURE = 0.05;
export function padsFromPaint(s, pressure, friction, min = MIN_PRESSURE) {
  const idx = [];
  for (let i = 0; i < s.n; i++) if (pressure[i] >= min) idx.push(i);
  const n = idx.length;
  const pads = {
    n, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n),
    nx: new Float64Array(n), ny: new Float64Array(n), nz: new Float64Array(n),
    area: new Float64Array(n), p0: new Float64Array(n), mu: new Float64Array(n),
  };
  idx.forEach((i, k) => {
    pads.x[k] = s.pos[i * 3] / 1000; pads.y[k] = s.pos[i * 3 + 1] / 1000; pads.z[k] = s.pos[i * 3 + 2] / 1000;
    pads.nx[k] = s.nrm[i * 3]; pads.ny[k] = s.nrm[i * 3 + 1]; pads.nz[k] = s.nrm[i * 3 + 2];
    pads.area[k] = s.area[i] * 1e-6;
    pads.p0[k] = pressure[i] * 1e4;
    pads.mu[k] = friction[i];
  });
  return { pads, index: Int32Array.from(idx) };
}

export function regionPushes(s, pressure, least = 0.5) {
  const R = REGIONS.length;
  const F = new Float64Array(R), c = new Float64Array(R * 3), v = new Float64Array(R * 3);
  for (let i = 0; i < s.n; i++) {
    const p = pressure[i];
    if (p < MIN_PRESSURE) continue;
    const f = (p * s.area[i]) / 100, r = s.region[i];
    F[r] += f;
    for (let k = 0; k < 3; k++) { c[r * 3 + k] += f * s.pos[i * 3 + k]; v[r * 3 + k] -= f * s.nrm[i * 3 + k]; }
  }
  const out = [];
  for (let r = 0; r < R; r++) {
    if (F[r] < least) continue;
    const net = Math.hypot(v[r * 3], v[r * 3 + 1], v[r * 3 + 2]) || 1;
    out.push({ region: r, name: REGIONS[r], force: F[r], net,
      at: [c[r * 3] / F[r], c[r * 3 + 1] / F[r], c[r * 3 + 2] / F[r]], dir: [v[r * 3] / net, v[r * 3 + 1] / net, v[r * 3 + 2] / net] });
  }
  const best = new Float64Array(R).fill(Infinity), at = new Int32Array(R).fill(-1);
  const byRegion = new Map(out.map((a) => [a.region, a]));
  for (let i = 0; i < s.n; i++) {
    const a = byRegion.get(s.region[i]);
    if (!a || pressure[i] < MIN_PRESSURE) continue;
    const d = (s.pos[i * 3] - a.at[0]) ** 2 + (s.pos[i * 3 + 1] - a.at[1]) ** 2 + (s.pos[i * 3 + 2] - a.at[2]) ** 2;
    if (d < best[a.region]) { best[a.region] = d; at[a.region] = i; }
  }
  for (const a of out) {
    const i = at[a.region];
    a.surf = [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]];
    a.out = [s.nrm[i * 3], s.nrm[i * 3 + 1], s.nrm[i * 3 + 2]];
  }
  return out;
}

export function paintTotals(s, pressure) {
  let force = 0, area = 0, fx = 0, fy = 0, fz = 0, tx = 0, ty = 0, tz = 0;
  const byRegion = new Float64Array(REGIONS.length);
  for (let i = 0; i < s.n; i++) {
    const p = pressure[i];
    if (p < MIN_PRESSURE) continue;
    const F = p * s.area[i] / 100;
    force += F; area += s.area[i] / 100;
    byRegion[s.region[i]] += F;
    const gx = -s.nrm[i * 3] * F, gy = -s.nrm[i * 3 + 1] * F, gz = -s.nrm[i * 3 + 2] * F;
    const x = s.pos[i * 3] / 1000, y = s.pos[i * 3 + 1] / 1000, z = s.pos[i * 3 + 2] / 1000;
    fx += gx; fy += gy; fz += gz;
    tx += y * gz - z * gy; ty += z * gx - x * gz; tz += x * gy - y * gx;
  }
  return { force, area, net: [fx, fy, fz], turn: [tx, ty, tz], byRegion };
}
