
export const LBF = 4.4482216152605;
export const PSI = 0.68947572932;
export const INCH = 25.4;
export const YARD = 0.9144;
export const OUNCE = 28.349523125;
export const FOOT = 0.3048;

const fx = (x, d) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : Number(x).toFixed(d));
export const toLb = (N) => N / LBF;
export const toPsi = (Ncm2) => Ncm2 / PSI;
export const toIn = (mm) => mm / INCH;
export const toYd = (m) => m / YARD;
export const toOz = (kg) => (kg * 1000) / OUNCE;
export const toFps = (mps) => mps / FOOT;
export const toIn2 = (cm2) => cm2 / (INCH * INCH / 100);
export const lb = (N, d = 1) => `${fx(toLb(N), d)} lb`;
export const psi = (Ncm2, d = 1) => `${fx(toPsi(Ncm2), d)} psi`;
export const inch = (mm, d = 2) => `${fx(toIn(mm), d)} in`;
export const yd = (m, d = 0) => `${fx(toYd(m), d)} yd`;
export const oz = (kg, d = 1) => `${fx(toOz(kg), d)} oz`;
export const fps = (mps, d = 0) => `${fx(toFps(mps), d)} ft/s`;
export { fx };
