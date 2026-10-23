
const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs';
const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'];
export const SIZES = { 1080: { width: 1920, height: 1080, scale: 1.5, bitrate: 12e6 }, 720: { width: 1280, height: 720, scale: 1, bitrate: 6e6 } };
export const FPS = 30;

export const canMakeVideo = () => typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';

const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
const px = (v) => parseFloat(v) || 0;
function alphaOf(el, stop) {
  let a = 1;
  for (let e = el; e && e !== stop.parentElement; e = e.parentElement) a *= +getComputedStyle(e).opacity;
  return a;
}
function shown(el) {
  if (el.closest('[hidden]')) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
}
function paintBox(g, el, cs, r, o) {
  const rad = Math.min(px(cs.borderTopLeftRadius), r.height / 2, r.width / 2);
  const x = r.left - o.left, y = r.top - o.top;
  if (!transparent(cs.backgroundColor)) {
    g.fillStyle = cs.backgroundColor;
    g.beginPath(); g.roundRect(x, y, r.width, r.height, rad); g.fill();
  }
  const stripe = /^repeating-linear-gradient\(45deg,\s*(rgba?\([^)]*\))[^,]*,\s*rgba?\([^)]*\)\s+([\d.]+)px/.exec(cs.backgroundImage);
  if (stripe) {
    const on = +stripe[2], across = 2 * on * Math.SQRT2;
    g.save(); g.beginPath(); g.roundRect(x, y, r.width, r.height, rad); g.clip();
    g.strokeStyle = stripe[1]; g.lineWidth = on;
    for (let d = -r.height; d < r.width + r.height; d += across) {
      g.beginPath(); g.moveTo(x + d, y); g.lineTo(x + d + r.height, y + r.height); g.stroke();
    }
    g.restore();
  }
  const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => ({ s, w: px(cs[`border${s}Width`]), style: cs[`border${s}Style`], c: cs[`border${s}Color`] }));
  const drawn = (q) => q.w > 0 && q.style !== 'none' && !transparent(q.c);
  const same = sides.every((q) => q.w === sides[0].w && q.style === sides[0].style && q.c === sides[0].c);
  if (same && drawn(sides[0])) {
    const bw = sides[0].w;
    g.strokeStyle = sides[0].c; g.lineWidth = bw;
    g.setLineDash(sides[0].style === 'dashed' ? [4 * bw, 3 * bw] : []);
    g.beginPath(); g.roundRect(x + bw / 2, y + bw / 2, r.width - bw, r.height - bw, Math.max(0, rad - bw / 2)); g.stroke();
    g.setLineDash([]);
  } else if (!same) {
    for (const q of sides.filter(drawn)) {
      g.strokeStyle = q.c; g.lineWidth = q.w;
      const h = q.w / 2, R = x + r.width, B = y + r.height;
      const [x0, y0, x1, y1] = { Top: [x, y + h, R, y + h], Bottom: [x, B - h, R, B - h], Left: [x + h, y, x + h, B], Right: [R - h, y, R - h, B] }[q.s];
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  }
}
function paintText(g, node, o) {
  const el = node.parentElement, cs = getComputedStyle(el);
  if (cs.visibility === 'hidden') return;
  const pre = /^pre/.test(cs.whiteSpace);
  let text = node.textContent;
  if (!text.trim()) return;
  const range = document.createRange();
  if (!pre) {
    text = text.replace(/\s+/g, ' ');
    range.setStart(node, 0); range.setEnd(node, 1);
    const q = range.getClientRects()[0];
    if (text[0] === ' ' && (!q || q.width === 0)) text = text.slice(1);
  }
  if (cs.textTransform === 'uppercase') text = text.toUpperCase();
  g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
  g.fillStyle = cs.color; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  range.selectNodeContents(node);
  const lines = [...range.getClientRects()].filter((q) => q.width > 0);
  const draw = (s, q) => {
    const m = g.measureText(s);
    g.fillText(s, q.left - o.left, q.top - o.top + (q.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent);
  };
  if (lines.length === 1) { draw(text, lines[0]); return; }
  if (pre && lines.length === text.split('\n').length) { text.split('\n').forEach((s, i) => draw(s, lines[i])); return; }
  let run = '', at = null;
  for (let i = 0; i < node.textContent.length; i++) {
    range.setStart(node, i); range.setEnd(node, i + 1);
    const q = range.getClientRects()[0];
    const ch = cs.textTransform === 'uppercase' ? node.textContent[i].toUpperCase() : node.textContent[i];
    if (!q || q.width === 0) { if (at) run += ch; continue; }
    if (at && Math.abs(q.top - at.top) > 1) { draw(run.replace(/\s+/g, ' ').trimEnd(), at); run = ''; at = null; }
    if (!at) { at = q; run = ch.trimStart(); } else run += ch;
  }
  if (at && run.trim()) draw(run.replace(/\s+/g, ' ').trimEnd(), at);
}
function paintSvg(g, svg, o) {
  const r = svg.getBoundingClientRect(), vb = svg.viewBox && svg.viewBox.baseVal;
  g.save();
  g.translate(r.left - o.left, r.top - o.top);
  if (vb && vb.width) {
    const k = Math.min(r.width / vb.width, r.height / vb.height);
    g.translate((r.width - vb.width * k) / 2, (r.height - vb.height * k) / 2); g.scale(k, k); g.translate(-vb.x, -vb.y);
  }
  for (const s of svg.querySelectorAll('path, line, circle')) {
    const cs = getComputedStyle(s);
    if (cs.display === 'none' || cs.visibility === 'hidden' || s.getAttribute('visibility') === 'hidden') continue;
    let p;
    if (s.tagName === 'path') p = new Path2D(s.getAttribute('d'));
    else if (s.tagName === 'line') { p = new Path2D(); p.moveTo(+s.getAttribute('x1'), +s.getAttribute('y1')); p.lineTo(+s.getAttribute('x2'), +s.getAttribute('y2')); }
    else { p = new Path2D(); p.arc(+s.getAttribute('cx'), +s.getAttribute('cy'), +s.getAttribute('r'), 0, Math.PI * 2); }
    g.save();
    const turn = /rotate\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)/.exec(s.getAttribute('transform') || '');
    if (turn) { g.translate(+turn[2], +turn[3]); g.rotate((+turn[1] * Math.PI) / 180); g.translate(-turn[2], -turn[3]); }
    g.globalAlpha *= +cs.opacity;
    if (!transparent(cs.fill) && cs.fill !== 'none') { g.fillStyle = cs.fill; g.fill(p); }
    if (cs.stroke && cs.stroke !== 'none') {
      g.strokeStyle = cs.stroke; g.lineWidth = px(cs.strokeWidth); g.lineCap = cs.strokeLinecap;
      const dash = cs.strokeDasharray && cs.strokeDasharray !== 'none' ? cs.strokeDasharray.split(/[ ,]+/).map(px) : [];
      g.setLineDash(dash); g.lineDashOffset = px(cs.strokeDashoffset);
      g.stroke(p);
    }
    g.restore();
  }
  g.restore();
}
function paintTree(g, el, o, stage) {
  if (!shown(el)) return;
  const cs = getComputedStyle(el);
  g.save();
  g.globalAlpha = alphaOf(el, stage);
  const r = el.getBoundingClientRect();
  if (el instanceof HTMLCanvasElement) { if (r.width && el.width) g.drawImage(el, r.left - o.left, r.top - o.top, r.width, r.height); g.restore(); return; }
  if (el instanceof SVGSVGElement) { paintSvg(g, el, o); g.restore(); return; }
  paintBox(g, el, cs, r, o);
  g.restore();
  for (const c of el.childNodes) {
    if (c.nodeType === 3) { g.save(); g.globalAlpha = alphaOf(el, stage); paintText(g, c, o); g.restore(); }
    else if (c.nodeType === 1) paintTree(g, c, o, stage);
  }
}
export function paintStage(g, stage, view3d, k) {
  const o = stage.getBoundingClientRect();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(view3d, 0, 0, g.canvas.width, g.canvas.height);
  g.setTransform(k, 0, 0, k, 0, 0);
  const layers = [...stage.children].filter((e) => e !== view3d && !e.classList.contains('cover'));
  const top = layers.filter((e) => +getComputedStyle(e).zIndex > 0);
  for (const e of [...layers.filter((x) => !top.includes(x)), ...top]) paintTree(g, e, o, stage);
}

export async function encode({ canvas, count, size, frame, progress, cancelled }) {
  const { Muxer, ArrayBufferTarget } = await import(MUXER);
  const { width, height, bitrate } = size;
  let config = null;
  for (const codec of CODECS) {
    const c = { codec, width, height, bitrate, framerate: FPS, avc: { format: 'avc' } };
    const ok = await VideoEncoder.isConfigSupported(c).catch(() => null);
    if (ok && ok.supported) { config = c; break; }
  }
  if (!config) throw new Error(`this browser's video encoder cannot make H.264 at ${width} x ${height}`);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: FPS }, fastStart: 'in-memory' });
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  encoder.configure(config);
  const t0 = performance.now();
  for (let j = 0; j < count; j++) {
    if (failure) throw failure;
    if (cancelled()) { encoder.close(); return null; }
    await frame(j);
    const vf = new VideoFrame(canvas, { timestamp: Math.round((j * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    encoder.encode(vf, { keyFrame: j % (FPS * 2) === 0 });
    vf.close();
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 2));
    if (j % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    progress(j + 1, count, performance.now() - t0);
  }
  await encoder.flush();
  if (failure) throw failure;
  encoder.close();
  muxer.finalize();
  return { bytes: muxer.target.buffer, codec: config.codec, ms: performance.now() - t0 };
}
