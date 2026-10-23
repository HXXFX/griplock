
export function fingerPull(nx, ny, nz, mu, out = [0, 0, 0]) {
  const L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const ix = -nx / L, iy = -ny / L, iz = -nz / L;
  const c = -ix;
  const ca = 1 / Math.sqrt(1 + mu * mu), sa = mu * ca;
  if (c >= ca) { out[0] = -1; out[1] = 0; out[2] = 0; return out; }
  let tx = -1 - c * ix, ty = -c * iy, tz = -c * iz;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (mu <= 0 || tl < 1e-12) { out[0] = ix; out[1] = iy; out[2] = iz; return out; }
  tx /= tl; ty /= tl; tz /= tl;
  out[0] = ca * ix + sa * tx; out[1] = ca * iy + sa * ty; out[2] = ca * iz + sa * tz;
  return out;
}
