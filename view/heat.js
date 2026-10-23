
import * as THREE from 'three';
import { colour, scale, onRecolour } from '../ui/colours.js';

export const FRAME_GRID = { voxel: 1.25, reach: 2.0 };
export const TRIGGER_GRID = { voxel: 0.5, reach: 1.0 };
const FULL = 0.25;
export const P_TOP = 200;
export const F_TOP = 1.5;
export const RAMP_TICKS = [0, 2, 6, 12, 25, 100];
export const LEVER_TOP = 1.5;
const pressureU = (p) => Math.log2(1 + p) / Math.log2(101);

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rampPixels(stops, where) {
  const px = new Uint8Array(256 * 4);
  const at = stops.map(([v, c]) => [where(v), hex(c)]);
  for (let k = 0; k < 256; k++) {
    const u = k / 255;
    let i = 0;
    while (i < at.length - 1 && u > at[i + 1][0]) i++;
    const [u0, c0] = at[i], [u1, c1] = at[Math.min(at.length - 1, i + 1)];
    const t = u1 > u0 ? Math.min(1, Math.max(0, (u - u0) / (u1 - u0))) : 0;
    for (let j = 0; j < 3; j++) px[k * 4 + j] = Math.round(c0[j] + (c1[j] - c0[j]) * t);
    px[k * 4 + 3] = 255;
  }
  return px;
}
export const pressureRamp = () => rampPixels(scale('ramp-pressure'), pressureU);
export const frictionRamp = () => rampPixels(scale('ramp-friction'), (m) => m / F_TOP);
export const leverRamp = () => rampPixels(scale('ramp-lever'), (v) => v / LEVER_TOP);
export { pressureU };

export function createHeat(s, { voxel: VOX, reach: REACH } = FRAME_GRID) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < s.n; i++) {
    const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
  }
  const pad = REACH + VOX;
  x0 -= pad; y0 -= pad; z0 -= pad;
  const nx = Math.ceil((x1 + pad - x0) / VOX) + 1, ny = Math.ceil((y1 + pad - y0) / VOX) + 1, nz = Math.ceil((z1 + pad - z0) / VOX) + 1;
  const nv = nx * ny * nz;
  const start = new Uint32Array(s.n + 1), cells = [], weights = [];
  const wsum = new Float32Array(nv);
  const r = Math.ceil(REACH / VOX);
  for (let i = 0; i < s.n; i++) {
    const px = s.pos[i * 3], py = s.pos[i * 3 + 1], pz = s.pos[i * 3 + 2];
    const cx = Math.round((px - x0) / VOX - 0.5), cy = Math.round((py - y0) / VOX - 0.5), cz = Math.round((pz - z0) / VOX - 0.5);
    for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const ix = cx + dx, iy = cy + dy, iz = cz + dz;
      if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) continue;
      const qx = x0 + (ix + 0.5) * VOX - px, qy = y0 + (iy + 0.5) * VOX - py, qz = z0 + (iz + 0.5) * VOX - pz;
      const d2 = (qx * qx + qy * qy + qz * qz) / (REACH * REACH);
      if (d2 >= 1) continue;
      const w = (1 - d2) * (1 - d2);
      const v = (iz * ny + iy) * nx + ix;
      cells.push(v); weights.push(w); wsum[v] += w;
    }
    start[i + 1] = cells.length;
  }
  const cell = Uint32Array.from(cells), weight = Float32Array.from(weights);
  const used = [];
  for (let v = 0; v < nv; v++) if (wsum[v] > 0) used.push(v);
  const usedCells = Uint32Array.from(used);
  const accG = new Float32Array(nv), accB = new Float32Array(nv), accA = new Float32Array(nv);
  const data = new Uint8Array(nv * 4);
  for (const v of usedCells) data[v * 4] = Math.round(255 * Math.min(1, wsum[v] / FULL));

  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  const rampTex = (px) => { const t = new THREE.DataTexture(px, 256, 1); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };

  const uniforms = {
    uHeat: { value: tex },
    uHeatOrigin: { value: new THREE.Vector3(x0, y0, z0) },
    uHeatSize: { value: new THREE.Vector3(nx * VOX, ny * VOX, nz * VOX) },
    uRamp: { value: rampTex(pressureRamp()) },
    uFRamp: { value: rampTex(frictionRamp()) },
    uLRamp: { value: rampTex(leverRamp()) },
    uMode: { value: 1 },
    uBrush: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSlipColor: { value: new THREE.Color(colour('slip')) },
  };
  onRecolour(() => {
    for (const [u, px] of [['uRamp', pressureRamp()], ['uFRamp', frictionRamp()], ['uLRamp', leverRamp()]]) {
      uniforms[u].value.image.data.set(px); uniforms[u].value.needsUpdate = true;
    }
    uniforms.uSlipColor.value.set(colour('slip'));
  });

  const g = (p) => Math.sqrt(Math.min(1, Math.max(0, p) / P_TOP));
  const write = (v) => {
    const w = wsum[v], cov = Math.min(1, w / FULL);
    data[v * 4 + 1] = Math.round(255 * cov * accG[v] / w);
    data[v * 4 + 2] = Math.round(255 * cov * Math.min(1, accB[v] / w / F_TOP));
    data[v * 4 + 3] = Math.round(255 * cov * Math.min(1, accA[v] / w));
  };

  function setAll(pressure, friction, sliding = null) {
    accG.fill(0); accB.fill(0); accA.fill(0);
    for (let i = 0; i < s.n; i++) {
      const gi = g(pressure[i]), fi = friction[i], ai = sliding ? sliding[i] : 0;
      for (let k = start[i]; k < start[i + 1]; k++) {
        const v = cell[k], w = weight[k];
        accG[v] += w * gi; accB[v] += w * fi; accA[v] += w * ai;
      }
    }
    for (const v of usedCells) write(v);
    tex.needsUpdate = true;
  }
  const mark = new Uint8Array(nv);
  function setSome(points, pressure, friction) {
    const touched = [];
    for (const i of points) for (let k = start[i]; k < start[i + 1]; k++) if (!mark[cell[k]]) { mark[cell[k]] = 1; touched.push(cell[k]); }
    for (const v of touched) { accG[v] = 0; accB[v] = 0; accA[v] = 0; }
    const near = new Set();
    for (const i of points) near.add(i);
    for (let i = 0; i < s.n; i++) {
      for (let k = start[i]; k < start[i + 1]; k++) if (mark[cell[k]]) { near.add(i); break; }
    }
    for (const i of near) {
      const gi = g(pressure[i]), fi = friction[i];
      for (let k = start[i]; k < start[i + 1]; k++) {
        const v = cell[k];
        if (!mark[v]) continue;
        accG[v] += weight[k] * gi; accB[v] += weight[k] * fi;
      }
    }
    for (const v of touched) { write(v); mark[v] = 0; }
    tex.needsUpdate = true;
  }

  function patch(material, meshToGun) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, { uMeshToGun: { value: meshToGun } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uMeshToGun;\nvarying vec3 vGun;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGun = (uMeshToGun * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
precision highp sampler3D;
uniform sampler3D uHeat; uniform sampler2D uRamp; uniform sampler2D uFRamp; uniform sampler2D uLRamp;
uniform vec3 uHeatOrigin; uniform vec3 uHeatSize; uniform float uMode; uniform vec4 uBrush; uniform vec3 uSlipColor;
varying vec3 vGun;`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
{
  vec4 h = texture(uHeat, (vGun - uHeatOrigin) / uHeatSize);
  float cov = h.r;
  if (uMode > 0.5 && cov > 0.02) {
    float edge = smoothstep(0.02, 0.3, cov);
    if (uMode < 1.5) {
      float gq = h.g / cov;
      float p = gq * gq * ${P_TOP.toFixed(1)};
      float u = log2(1.0 + p) / log2(101.0);
      vec3 c = texture(uRamp, vec2(clamp(u, 0.0, 1.0), 0.5)).rgb;
      // shaded by the surface's turn to a light over the viewer's shoulder, so the grip's shape still reads
      float shade = 0.62 + 0.38 * max(dot(normalize(normal), normalize(vec3(0.35, 0.55, 0.75))), 0.0);
      float a = smoothstep(0.04, 0.6, p) * 0.82 * edge;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, c * shade, a);
      float sl = h.a / cov;
      if (sl > 0.35) {
        float st = step(0.5, fract((vGun.x + vGun.y + vGun.z) * 0.45));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uSlipColor, 0.7 * st * edge);
      }
    } else if (uMode < 2.5) {
      float m = h.b / cov * ${F_TOP.toFixed(2)};
      vec3 c = texture(uFRamp, vec2(clamp(m / ${F_TOP.toFixed(2)}, 0.0, 1.0), 0.5)).rgb;
      float shade = 0.62 + 0.38 * max(dot(normalize(normal), normalize(vec3(0.35, 0.55, 0.75))), 0.0);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, c * shade, 0.8 * edge);
    } else {
      // where it turns: the map everywhere on the part, the paint over it as white hatching
      vec3 c = texture(uLRamp, vec2(clamp(h.b / cov, 0.0, 1.0), 0.5)).rgb;
      float shade = 0.62 + 0.38 * max(dot(normalize(normal), normalize(vec3(0.35, 0.55, 0.75))), 0.0);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, c * shade, 0.9 * edge);
      float gq = h.g / cov;
      float p = gq * gq * ${P_TOP.toFixed(1)};
      float st = step(0.55, fract((vGun.x - vGun.y) * 0.8));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), 0.75 * st * smoothstep(0.04, 0.6, p) * edge);
    }
  }
  if (uBrush.w > 0.0) {
    float d = length(vGun - uBrush.xyz);
    float w = max(0.3, fwidth(d) * 1.5);
    float ring = 1.0 - smoothstep(0.0, w, abs(d - uBrush.w));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), ring * 0.95);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), 0.08 * step(d, uBrush.w));
  }
}`);
    };
    material.needsUpdate = true;
  }

  return { uniforms, setAll, setSome, patch, grid: { nx, ny, nz, voxel: VOX, cubes: usedCells.length } };
}
