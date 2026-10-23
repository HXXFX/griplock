
import { dab } from '../paint/brush.js';

const DWELL = 70;
const UNDO_DEPTH = 80;

export function createBrushTool({ view, targets, getBrush, onStart, onStroke, onHover, onLimit }) {
  const canvas = view.canvas;
  let stroke = null, timer = null, lastHover = null, hoverQueued = null;
  const undo = [], redo = [];
  const snapshot = () => Object.fromEntries(Object.entries(targets).map(([k, t]) => [k, { pressure: t.paint.pressure.slice(), friction: t.paint.friction.slice() }]));

  function apply(part, at) {
    const t = targets[part], brush = getBrush(part);
    if (!brush) return;
    const touched = new Set();
    const P = t.paint.pressure, before = t.limit && brush.mode !== 'friction' ? P.slice() : null;
    dab(t.surface, t.paint, at, brush, touched);
    if (before) {
      const was = t.measure(before), now = t.measure(P), most = t.limit();
      if (now > most && now > was) {
        const f = Math.max(0, (most - was) / (now - was));
        for (const i of touched) P[i] = before[i] + (P[i] - before[i]) * f;
        if (onLimit) onLimit(part);
      }
    }
    if (touched.size) t.heat.setSome(touched, t.paint.pressure, t.shade || t.paint.friction);
    view.draw();
  }
  function along(part, a, b) {
    const step = Math.max(0.3, getBrush(part).radius * 0.25);
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.floor(d / step);
    for (let k = 1; k <= n; k++) {
      const s = (k * step) / d;
      apply(part, { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s, nx: b.nx, ny: b.ny, nz: b.nz });
    }
    return n > 0;
  }
  function ring(at) {
    for (const [k, t] of Object.entries(targets)) {
      const u = t.heat.uniforms.uBrush.value;
      if (at && at.part === k) u.set(at.x, at.y, at.z, getBrush(k) ? getBrush(k).radius : 0); else u.w = 0;
    }
    view.draw();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.altKey) return;
    const at = view.pick(e.clientX, e.clientY);
    if (!at || !targets[at.part]) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch {   }
    if (onStart) onStart(at.part);
    undo.push(snapshot()); if (undo.length > UNDO_DEPTH) undo.shift();
    redo.length = 0;
    stroke = { id: e.pointerId, part: at.part, last: at, laid: at };
    apply(at.part, at);
    ring(at);
    timer = setInterval(() => { if (stroke) apply(stroke.part, stroke.last); }, DWELL);
  }, { capture: true });

  canvas.addEventListener('pointermove', (e) => {
    if (stroke && e.pointerId === stroke.id) {
      const at = view.pick(e.clientX, e.clientY);
      if (!at || at.part !== stroke.part) return;
      if (along(stroke.part, stroke.laid, at)) stroke.laid = at;
      stroke.last = at;
      ring(at);
      return;
    }
    lastHover = e;
    if (!hoverQueued) hoverQueued = requestAnimationFrame(() => {
      hoverQueued = null;
      if (!lastHover || e.buttons) return;
      const at = view.pick(lastHover.clientX, lastHover.clientY);
      ring(at);
      if (onHover) onHover(at);
    });
  });
  const end = (e) => {
    if (!stroke || e.pointerId !== stroke.id) return;
    const part = stroke.part;
    stroke = null;
    clearInterval(timer);
    if (onStroke) onStroke(part);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!stroke) { ring(null); if (onHover) onHover(null); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function restore(from, to) {
    if (!from.length) return false;
    to.push(snapshot());
    const s = from.pop();
    for (const [k, t] of Object.entries(targets)) {
      t.paint.pressure.set(s[k].pressure); t.paint.friction.set(s[k].friction);
      t.heat.setAll(t.paint.pressure, t.paint.friction);
    }
    view.draw();
    if (onStroke) onStroke(null);
    return true;
  }
  return {
    undo: () => restore(undo, redo),
    redo: () => restore(redo, undo),
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    remember() { undo.push(snapshot()); if (undo.length > UNDO_DEPTH) undo.shift(); redo.length = 0; },
    ring,
  };
}
