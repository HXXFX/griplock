
export function drawChart(canvas, { series, tMin = 0, tMax, unit, label, playhead = null, zeroLine = true }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const ink3 = css.getPropertyValue('--ink3').trim(), line = css.getPropertyValue('--line').trim();
  const L = 40, R = 8, T = 18, B = 20;
  let lo = 0, hi = 0;
  for (const s of series) for (let k = 0; k < s.t.length; k++) { lo = Math.min(lo, s.v[k]); hi = Math.max(hi, s.v[k]); }
  if (hi - lo < 1e-6) hi = lo + 1;
  const padV = (hi - lo) * 0.08; lo -= padV; hi += padV;
  const X = (t) => L + ((t - tMin) / (tMax - tMin || 1)) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  g.font = `${css.getPropertyValue('--t-xs').trim() || '11px'} ${css.getPropertyValue('--mono').trim() || 'monospace'}`;
  g.fillStyle = ink3; g.strokeStyle = line; g.lineWidth = 1;
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    g.globalAlpha = 0.6; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); g.globalAlpha = 1;
    g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(fmt(v, step), L - 4, Y(v));
  }
  let tStep = niceStep((tMax - tMin) / 5);
  const widest = () => Math.max(...[tMin, tMax].map((t) => g.measureText(fmt(Math.ceil(t / tStep) * tStep, tStep)).width));
  for (let k = 0; k < 6 && ((tMax - tMin) / tStep) * (widest() + 12) > W - L - R; k++) tStep = nextStep(tStep);
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax + 1e-9; t += tStep) g.fillText(`${fmt(t, tStep)}`, X(t), H - B + 4);
  if (tMin < 0) {
    g.strokeStyle = ink3; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(X(0), T); g.lineTo(X(0), H - B); g.stroke(); g.setLineDash([]);
    g.textAlign = 'left'; g.fillText('shot', X(0) + 3, 2);
  }
  g.textAlign = 'left'; g.fillText(unit, 2, 2);
  g.textBaseline = 'top'; g.fillText('ms', 2, H - B + 4);
  if (zeroLine && lo < 0 && hi > 0) { g.strokeStyle = ink3; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(W - R, Y(0)); g.stroke(); g.globalAlpha = 1; }
  for (const s of series) {
    g.strokeStyle = s.color; g.lineWidth = s.width || 1.6; g.beginPath();
    for (let k = 0; k < s.t.length; k++) { const x = X(s.t[k]), y = Y(s.v[k]); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  if (playhead !== null) {
    g.strokeStyle = '#ffffff'; g.globalAlpha = 0.7; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(playhead), T); g.lineTo(X(playhead), H - B); g.stroke(); g.globalAlpha = 1;
  }
}

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function nextStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x) + 1e-9)), m = Math.round(x / p);
  return (m === 1 ? 2 : m === 2 ? 5 : 10) * p;
}
const fmt = (v, step) => (step < 1 ? v.toFixed(Math.min(3, Math.ceil(-Math.log10(step)))) : Math.round(v).toString());
