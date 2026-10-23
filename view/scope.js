
import { ISSF_TARGET } from '../data/target.js';
import { val } from '../data/num.js';
import { inch, INCH } from '../ui/units.js';

const CARD = val(ISSF_TARGET.card), STEP = val(ISSF_TARGET.ringStep), TEN = val(ISSF_TARGET.innerTen), BLACK = val(ISSF_TARGET.black);
const BOARD = CARD + 40;
const HOLE = 9;
const MAX_ZOOM = 40;
const BARS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 12];

export function createScope({ win, bar, paper, grip, zoomOut, zoomIn, zoomText, fitShots, wholeCard, stage, keep }) {
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const g = paper.getContext('2d');
  let holes = [], zoom = 1, cx = 0, cy = 0, w = 0, h = 0, dpr = 1;

  const fitScale = () => Math.min(w, h) / (BOARD + 30);
  const scale = () => fitScale() * zoom;
  const toX = (mm) => w / 2 + (mm - cx) * scale();
  const toY = (mm) => h / 2 - (mm - cy) * scale();
  function draw() {
    if (!w || !h) return;
    const s = scale(), font = css('--mono') || 'monospace';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = css('--stage'); g.fillRect(0, 0, w, h);
    const ox = toX(0), oy = toY(0);
    g.fillStyle = '#8a6a48'; g.fillRect(ox - (BOARD / 2) * s, oy - (BOARD / 2) * s, BOARD * s, BOARD * s);
    g.fillStyle = '#ece6d6'; g.fillRect(ox - (CARD / 2) * s, oy - (CARD / 2) * s, CARD * s, CARD * s);
    g.fillStyle = '#16181b'; g.beginPath(); g.arc(ox, oy, BLACK * s, 0, Math.PI * 2); g.fill();
    g.lineWidth = Math.max(1, 0.5 * s);
    for (let k = 1; k <= 10; k++) {
      const r = k * STEP;
      g.strokeStyle = r <= BLACK + 0.01 ? '#ece6d6' : '#16181b';
      g.beginPath(); g.arc(ox, oy, r * s, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = '#ece6d6'; g.beginPath(); g.arc(ox, oy, TEN * s, 0, Math.PI * 2); g.stroke();
    if (9 * s >= 6) {
      g.font = `600 ${9 * s}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 1; k <= 8; k++) {
        const r = (k + 0.5) * STEP;
        g.fillStyle = r < BLACK ? '#ece6d6' : '#16181b';
        for (const sgn of [-1, 1]) g.fillText(String(10 - k), ox + sgn * r * s, oy);
      }
    }
    const angle = css('--angle'), ordered = [...holes.filter((x) => !x.current), ...holes.filter((x) => x.current)];
    const hr = Math.max(2, (HOLE / 2) * s);
    for (const o of ordered) {
      const x = toX(o.right), y = toY(o.up);
      g.fillStyle = '#4a3b2c'; g.beginPath(); g.arc(x, y, hr, 0, Math.PI * 2); g.fill();
      g.lineWidth = Math.max(1, 0.6 * s); g.strokeStyle = '#d8d0bd'; g.stroke();
      g.lineWidth = o.current ? 2 : 1;
      g.strokeStyle = o.current ? angle : '#9aa3ad';
      g.beginPath(); g.arc(x, y, hr + (o.current ? 3 : 1.5), 0, Math.PI * 2); g.stroke();
    }
    const cur = holes.filter((o) => o.current);
    if (cur.length > 1) {
      let a = cur[0], b = cur[1], far = -1;
      for (let i = 0; i < cur.length; i++) for (let j = i + 1; j < cur.length; j++) {
        const d = Math.hypot(cur[i].right - cur[j].right, cur[i].up - cur[j].up);
        if (d > far) { far = d; a = cur[i]; b = cur[j]; }
      }
      g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeStyle = angle;
      g.beginPath(); g.moveTo(toX(a.right), toY(a.up)); g.lineTo(toX(b.right), toY(b.up)); g.stroke();
      g.setLineDash([]);
      const mx = cur.reduce((t, o) => t + o.right, 0) / cur.length, my = cur.reduce((t, o) => t + o.up, 0) / cur.length;
      const X = toX(mx), Y = toY(my), c = 5;
      g.beginPath(); g.moveTo(X - c, Y); g.lineTo(X + c, Y); g.moveTo(X, Y - c); g.lineTo(X, Y + c); g.stroke();
      const ax = toX(a.right), ay = toY(a.up), bx = toX(b.right), by = toY(b.up), L = Math.hypot(bx - ax, by - ay) || 1;
      let nx = -(by - ay) / L, ny = (bx - ax) / L;
      if (ny > 0) { nx = -nx; ny = -ny; }
      label(`${inch(far, 1)} across`, (ax + bx) / 2 + nx * 12, (ay + by) / 2 + ny * 12, angle, font, nx > 0.3 ? 'left' : nx < -0.3 ? 'right' : 'center');
    }
    for (const o of ordered) if (o.label) label(o.label, toX(o.right) + hr + 5, toY(o.up) - hr - 3, o.current ? angle : css('--ink2'), font, 'left');
    scaleBar(font);
    zoomText.textContent = `×${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}`;
    zoomOut.disabled = zoom <= 1.0001; zoomIn.disabled = zoom >= MAX_ZOOM - 0.001;
  }
  function label(text, x, y, color, font, align) {
    g.font = `${css('--w-label') || 600} ${css('--t-xs') || '11px'} ${font}`; g.textAlign = align; g.textBaseline = 'middle';
    g.lineWidth = 3; g.strokeStyle = 'rgba(16, 19, 23, 0.9)'; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
  }
  function scaleBar(font) {
    const s = scale(), want = 70 / (s * INCH);
    const len = BARS.reduce((best, b) => (Math.abs(Math.log(b / want)) < Math.abs(Math.log(best / want)) ? b : best), BARS[0]);
    const px = len * INCH * s, x = 10, y = h - 38;
    g.strokeStyle = '#eef2f6'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + px, y); g.lineTo(x + px, y - 5); g.stroke();
    label(`${len} in`, x + px + 6, y - 3, '#eef2f6', font, 'left');
  }

  function clamp() {
    const lim = BOARD / 2;
    cx = Math.max(-lim, Math.min(lim, cx)); cy = Math.max(-lim, Math.min(lim, cy));
    if (zoom <= 1.0001) { cx = 0; cy = 0; }
  }
  function zoomAt(f, px, py) {
    const before = { x: cx + (px - w / 2) / scale(), y: cy - (py - h / 2) / scale() };
    zoom = Math.max(1, Math.min(MAX_ZOOM, zoom * f));
    cx = before.x - (px - w / 2) / scale(); cy = before.y + (py - h / 2) / scale();
    clamp(); draw(); save();
  }
  paper.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = paper.getBoundingClientRect();
    zoomAt(Math.pow(1.2, -e.deltaY / 100), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let pan = null;
  paper.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    paper.setPointerCapture(e.pointerId);
    pan = { x: e.clientX, y: e.clientY, cx, cy };
    paper.classList.add('panning');
  });
  paper.addEventListener('pointermove', (e) => {
    if (!pan) return;
    cx = pan.cx - (e.clientX - pan.x) / scale(); cy = pan.cy + (e.clientY - pan.y) / scale();
    clamp(); draw();
  });
  const endPan = () => { if (pan) { pan = null; paper.classList.remove('panning'); save(); } };
  paper.addEventListener('pointerup', endPan);
  paper.addEventListener('pointercancel', endPan);
  paper.addEventListener('dblclick', () => showCard());
  zoomIn.addEventListener('click', () => zoomAt(2, w / 2, h / 2));
  zoomOut.addEventListener('click', () => zoomAt(0.5, w / 2, h / 2));
  wholeCard.addEventListener('click', () => showCard());
  fitShots.addEventListener('click', () => showShots());
  function showCard() { zoom = 1; cx = 0; cy = 0; draw(); save(); }
  const PAD = 24, BANDS = 60;
  function showShots() {
    const list = holes.some((o) => o.current) ? holes.filter((o) => o.current) : holes;
    if (!list.length) { showCard(); return; }
    const xs = list.map((o) => o.right), ys = list.map((o) => o.up);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = Math.max(x1 - x0, 1.5 * INCH) + HOLE, sy = Math.max(y1 - y0, 1.5 * INCH) + HOLE;
    const fitW = Math.max(40, w - 2 * PAD), fitH = Math.max(40, h - BANDS - 2 * PAD);
    cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
    zoom = Math.max(1, Math.min(MAX_ZOOM, Math.min(fitW / sx, fitH / sy) / fitScale()));
    clamp(); draw(); save();
  }

  const MIN_W = 200, MIN_H = 170;
  let place = null;
  function apply() {
    if (!place) { Object.assign(win.style, { left: '', top: '', width: '', height: '', right: '', bottom: '', aspectRatio: '' }); return; }
    const S = stage.getBoundingClientRect();
    const width = Math.max(MIN_W, Math.min(S.width, place.width)), height = Math.max(MIN_H, Math.min(S.height, place.height));
    const left = Math.max(0, Math.min(S.width - width, place.left)), top = Math.max(0, Math.min(S.height - height, place.top));
    Object.assign(win.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, right: 'auto', bottom: 'auto', aspectRatio: 'auto' });
  }
  function current() {
    const S = stage.getBoundingClientRect(), r = win.getBoundingClientRect();
    return { left: r.left - S.left, top: r.top - S.top, width: r.width, height: r.height };
  }
  function drag(handle, how) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('input, button, select')) return;
      e.preventDefault(); e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const from = current(), x = e.clientX, y = e.clientY;
      win.classList.add('moving');
      const move = (m) => { place = how(from, m.clientX - x, m.clientY - y); apply(); };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
        win.classList.remove('moving'); save();
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
    });
  }
  drag(bar, (f, dx, dy) => ({ ...f, left: f.left + dx, top: f.top + dy }));
  drag(grip, (f, dx, dy) => ({ ...f, width: f.width + dx, height: f.height + dy }));
  bar.addEventListener('dblclick', () => { place = null; apply(); save(); });

  let ratio = null;
  function fit() {
    const r = paper.getBoundingClientRect();
    dpr = ratio || Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    paper.width = Math.max(1, Math.round(w * dpr)); paper.height = Math.max(1, Math.round(h * dpr));
    draw();
  }
  new ResizeObserver(fit).observe(paper);
  new ResizeObserver(() => { if (place) apply(); }).observe(stage);

  function save() {
    if (!keep) return;
    try { localStorage.setItem(keep, JSON.stringify({ place, zoom, cx, cy })); } catch {   }
  }
  if (keep) {
    try {
      const k = JSON.parse(localStorage.getItem(keep) || 'null');
      if (k) {
        if (k.place && ['left', 'top', 'width', 'height'].every((n) => Number.isFinite(k.place[n]))) place = k.place;
        if (Number.isFinite(k.zoom)) zoom = Math.max(1, Math.min(MAX_ZOOM, k.zoom));
        if (Number.isFinite(k.cx) && Number.isFinite(k.cy)) { cx = k.cx; cy = k.cy; }
        clamp();
      }
    } catch {   }
  }
  apply(); fit();

  return {
    setHits(list) { holes = list; draw(); },
    showShots, showCard, draw,
    setPixelRatio(r) { ratio = r; fit(); },
    fit() { apply(); fit(); },
    get zoom() { return zoom; },
  };
}
