
export function n(v, unit, kind, src = [], note = '') {
  return { v, unit, kind, src, note };
}

export const val = (x) => (x !== null && typeof x === 'object' && 'v' in x ? x.v : x);

export const GRAIN = 0.06479891e-3;
export const FPS = 0.3048;
export const LBF = 4.4482216;
export const OZ = 0.028349523;
export const PSI = 6894.757;
export const KGF = 9.80665;
export const INCH = 0.0254;
export const MM = 0.001;
