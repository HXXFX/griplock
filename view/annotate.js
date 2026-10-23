
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLOCK17 } from '../data/glock17.js';
import { lb } from '../ui/units.js';
import { colourNum, onRecolour } from '../ui/colours.js';

const G = GLOCK17.geom;
const MM_PER_N = 0.9, ARROW_MIN = 12, ARROW_MAX = 70;
const ARROWS = 3;
const OFF = 2;
const COLOURS = { get grip() { return colourNum('force'); }, get trigger() { return colourNum('finger'); }, get trail() { return colourNum('angle'); } };

function tag(cls, rank) {
  const el = document.createElement('div');
  el.className = `tag3d ${cls || ''}`;
  el.dataset.rank = rank;
  const obj = new CSS2DObject(el);
  obj.center.set(0, 1);
  return { el, obj };
}

export function createAnnotations(view) {
  const { parts, target, scene } = view;
  const root = new THREE.Group(); root.name = 'annotations';
  parts.gun.add(root);
  let shown = true;
  const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

  const overlay = document.createElement('div');
  overlay.className = 'area-labels';
  const lines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lines.setAttribute('class', 'area-lines');
  view.canvas.parentElement.append(lines, overlay);
  const slots = [];
  const RING = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 49 }, (_, k) => new THREE.Vector3(Math.cos((k / 48) * Math.PI * 2), Math.sin((k / 48) * Math.PI * 2), 0)));
  const HALO = new THREE.LineBasicMaterial({ color: 0x101317 }), HALO_GROW = 1.08;
  function slot(i) {
    if (slots[i]) return slots[i];
    const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 20, COLOURS.grip, 7, 4.5);
    const ring = new THREE.Line(RING, new THREE.LineBasicMaterial({ color: COLOURS.grip }));
    const halo = new THREE.Line(RING, HALO);
    ring.add(halo); halo.scale.setScalar(HALO_GROW);
    root.add(a, ring);
    const el = document.createElement('div');
    el.className = 'tag3d push area';
    el.innerHTML = '<span></span><span class="far-note"> · far side</span>';
    overlay.appendChild(el);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    lines.appendChild(line);
    slots[i] = { a, ring, el, line, on: false, arrow: false, anchor: new THREE.Vector3(), surf: new THREE.Vector3(), out: new THREE.Vector3() };
    return slots[i];
  }
  function place(s, area) {
    const d = v3(area.dir).normalize();
    s.out.copy(v3(area.out)).normalize();
    s.surf.copy(v3(area.surf));
    const tip = s.surf.clone().addScaledVector(s.out, OFF);
    const r = 4 + Math.sqrt(area.force) * 0.9;
    s.ring.scale.set(r, r, 1);
    s.ring.position.copy(tip);
    s.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.out);
    s.ring.visible = shown;
    s.anchor.copy(tip);
    s.a.visible = shown && s.arrow;
    if (s.arrow) {
      const len = Math.min(ARROW_MAX, Math.max(ARROW_MIN, area.force * MM_PER_N));
      s.a.position.copy(tip).addScaledVector(d, -len);
      s.a.setDirection(d); s.a.setLength(len, Math.min(8, len * 0.35), Math.min(5, len * 0.22));
    }
  }

  const P = new THREE.Vector3(), W = new THREE.Vector3();
  const ray = new THREE.Raycaster(), blockers = parts.solidMeshes;
  let hiddenAt = -Infinity;
  const hiddenCam = new THREE.Matrix4();
  const GAP = 4, EDGE = 10;
  const stage = view.canvas.parentElement;
  const floats = (rect) => [...stage.querySelectorAll('.float')]
    .filter((e) => e.offsetParent && !e.hidden && getComputedStyle(e).opacity > 0.1)
    .map((e) => { const r = e.getBoundingClientRect(); return { lx: r.left - rect.left, ly: r.top - rect.top, w: r.width, h: r.height }; });
  view.afterLabels.push((camera, rect) => {
    const W0 = rect.width, H0 = rect.height;
    const list = slots.filter((s) => s.on);
    lines.setAttribute('width', W0); lines.setAttribute('height', H0);
    for (const s of slots) { s.line.setAttribute('visibility', 'hidden'); if (!s.on) s.el.style.display = 'none'; }
    if (!shown || !list.length) { for (const s of list) s.el.style.display = 'none'; return; }
    root.updateWorldMatrix(true, false);
    const now = performance.now(), fresh = now - hiddenAt > 120 || !camera.matrixWorld.equals(hiddenCam);
    if (fresh) { hiddenAt = now; hiddenCam.copy(camera.matrixWorld); }
    const items = list.map((s) => {
      W.copy(s.anchor).applyMatrix4(root.matrixWorld);
      if (fresh) {
        P.copy(W).sub(camera.position);
        const d = P.length();
        ray.set(camera.position, P.normalize());
        ray.far = d - 1;
        s.hidden = ray.intersectObjects(blockers, false).length > 0;
      }
      const away = s.hidden;
      W.project(camera);
      s.el.style.display = '';
      s.el.classList.toggle('far', away);
      const r = s.el.getBoundingClientRect();
      return { s, x: (W.x * 0.5 + 0.5) * W0, y: (-W.y * 0.5 + 0.5) * H0, w: r.width, h: r.height, away };
    });
    const placed = floats(rect);
    const hit = (it, ly) => placed.find((q) => it.lx < q.lx + q.w + GAP && it.lx + it.w + GAP > q.lx && ly < q.ly + q.h + GAP && ly + it.h + GAP > q.ly);
    const slide = (it, start, dir) => {
      let ly = start, q, n = 0;
      while ((q = hit(it, ly)) && n++ < 60) ly = dir > 0 ? q.ly + q.h + GAP : q.ly - it.h - GAP;
      return !hit(it, ly) && ly >= EDGE && ly + it.h <= H0 - EDGE ? ly : null;
    };
    for (const it of [...items].sort((p, q) => p.y - q.y)) {
      const start = Math.max(EDGE, it.y - it.h - 4);
      const sides = [it.x + 6, it.x - 6 - it.w].map((x) => Math.max(EDGE, Math.min(W0 - EDGE - it.w, x)));
      let ly = null;
      for (const lx of sides) {
        it.lx = lx;
        ly = slide(it, start, 1) ?? slide(it, start, -1);
        if (ly !== null) break;
      }
      if (ly === null) { it.lx = sides[0]; ly = start; }
      it.ly = ly;
      placed.push(it);
    }
    for (const it of items) {
      it.s.el.style.transform = `translate(${Math.round(it.lx)}px, ${Math.round(it.ly)}px)`;
      const cx = it.lx + (it.lx + it.w / 2 < it.x ? it.w : 0), cy = it.ly + it.h / 2;
      if (!it.away && Math.hypot(cx - it.x, cy - it.y) > 12) {
        const L = it.s.line;
        L.setAttribute('x1', cx); L.setAttribute('y1', cy); L.setAttribute('x2', it.x); L.setAttribute('y2', it.y);
        L.setAttribute('visibility', 'visible');
      }
    }
  });
  view.keepClear.push(() => slots.filter((s) => s.on && s.el.style.display !== 'none').map((s) => s.el.getBoundingClientRect()));

  const finger = new THREE.ArrowHelper(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(), 20, COLOURS.trigger, 6, 4);
  const fingerTag = tag('finger', 4);
  fingerTag.obj.center.set(0, 0);
  finger.add(fingerTag.obj);
  parts.trigger.add(finger);
  const PIV = new THREE.Vector3(G.triggerPivot[0], G.triggerPivot[1], 0);

  const peakTag = tag('peak', 5); root.add(peakTag.obj);
  const bulletTag = tag('part', 1); scene.add(bulletTag.obj);
  const hitTag = tag('hit', 0); target.group.add(hitTag.obj);

  const gauge = (name, rank, kind) => {
    const t = tag(`dial ${kind}`, rank);
    t.obj.center.set(0.5, 0.5);
    t.el.innerHTML = `<svg viewBox="0 0 64 40" aria-hidden="true"><path class="g-bg" d="M6 36 A26 26 0 0 1 58 36"/><path class="g-fill" d="M6 36 A26 26 0 0 1 58 36"/><line class="g-mark" x1="32" y1="6" x2="32" y2="13"/></svg><b></b><span>${name}</span>`;
    return t;
  };
  const gauges = { squeeze: gauge('squeeze', 6, 'push'), trigger: gauge('at the face', 7, 'finger'), slide: gauge('slide back', 3, 'slide'), muzzle: gauge('muzzle', 2, 'muzzle') };
  gauges.squeeze.obj.position.set(-10, -150, 0); parts.frame.add(gauges.squeeze.obj);
  gauges.trigger.obj.position.set(G.triggerFace[0] + 10, -95, 0); parts.frame.add(gauges.trigger.obj);
  gauges.slide.obj.position.set(60, 52, 0); parts.slide.add(gauges.slide.obj);
  gauges.muzzle.obj.position.set(G.muzzleX - 18, 56, 0); parts.frame.add(gauges.muzzle.obj);
  const ARC = Math.PI * 26;
  function setGauge(g, share, text, mark = null) {
    const fill = g.el.querySelector('.g-fill');
    fill.style.strokeDasharray = `${ARC}`;
    fill.style.strokeDashoffset = `${ARC * (1 - Math.max(0, Math.min(1, share)))}`;
    g.el.classList.toggle('full', share >= 0.999);
    const m = g.el.querySelector('.g-mark');
    if (mark === null) m.style.display = 'none';
    else { m.style.display = ''; m.setAttribute('transform', `rotate(${-90 + 180 * mark} 32 36)`); }
    g.el.querySelector('b').textContent = text;
  }
  const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLOURS.trail, transparent: true, opacity: 0.9, depthTest: false }));
  trail.renderOrder = 12; trail.frustumCulled = false; trail.visible = false;
  scene.add(trail);

  onRecolour(() => {
    for (const s of slots) { s.a.setColor(COLOURS.grip); s.ring.material.color.set(COLOURS.grip); }
    finger.setColor(COLOURS.trigger);
    trail.material.color.set(COLOURS.trail);
    view.draw();
  });

  const hide = (t) => { t.obj.visible = false; };
  [peakTag, bulletTag, hitTag, fingerTag].forEach(hide);
  Object.values(gauges).forEach(hide);
  finger.visible = false;

  function showGauges() { for (const g of Object.values(gauges)) g.obj.visible = shown; trail.visible = shown && trail.userData.n > 1; }
  showGauges();

  return {
    setShown(on) {
      shown = on;
      root.visible = on; finger.visible = on && finger.userData.on;
      for (const t of [bulletTag, hitTag, fingerTag]) t.el.style.display = on ? '' : 'none';
      overlay.style.display = lines.style.display = on ? '' : 'none';
      for (const s of slots) if (s.on) place(s, s.area);
      showGauges();
      view.draw();
    },
    setGrip(list) {
      const areas = [...list].sort((p, q) => q.force - p.force);
      areas.forEach((r, i) => {
        const s = slot(i);
        s.on = true; s.area = r; s.arrow = i < ARROWS;
        place(s, r);
        s.el.firstChild.textContent = `${r.name}  ${lb(r.force, r.force < 22 ? 1 : 0)}`;
      });
      for (let i = areas.length; i < slots.length; i++) {
        const s = slots[i];
        s.on = false; s.a.visible = s.ring.visible = false; s.el.style.display = 'none';
      }
      view.draw();
    },
    setFinger(f) {
      finger.userData.on = !!f;
      if (!f) { finger.visible = false; fingerTag.obj.visible = false; view.draw(); return; }
      const len = Math.min(45, Math.max(14, f.push * 0.8));
      const d = v3(f.dir).normalize();
      finger.position.copy(v3(f.at).sub(PIV).addScaledVector(d, -len));
      finger.setDirection(d); finger.setLength(len, 6, 4);
      fingerTag.el.textContent = f.text;
      fingerTag.obj.visible = shown; finger.visible = shown;
      view.draw();
    },
    setPeak(at, text) {
      if (!at) { peakTag.obj.visible = false; return; }
      peakTag.obj.position.set(at[0], at[1], at[2]); peakTag.el.textContent = text; peakTag.obj.visible = shown;
    },
    setBullet(pos, text) {
      if (!pos) { bulletTag.obj.visible = false; return; }
      bulletTag.obj.position.copy(pos); bulletTag.el.textContent = text; bulletTag.obj.visible = shown;
    },
    setHit(text, at) {
      hitTag.el.textContent = text || ''; hitTag.obj.visible = !!text && shown;
      if (at) hitTag.obj.position.set(at.right + 12, at.up + 12, 10);
    },
    setGauges(v) {
      for (const [k, g] of Object.entries(gauges)) if (v[k]) setGauge(g, v[k].share, v[k].text, v[k].mark ?? null);
      showGauges();
    },
    setTrail(points) {
      trail.geometry.dispose();
      trail.geometry = new THREE.BufferGeometry();
      if (points) trail.geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
      trail.userData.n = points ? points.length / 3 : 0;
      trail.geometry.setDrawRange(0, 0);
      showGauges();
    },
    trailTo(n) { trail.geometry.setDrawRange(0, Math.max(0, Math.min(trail.userData.n || 0, n))); },
  };
}
