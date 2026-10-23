
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadGlock, poseGlock } from './gun3d.js';
import { createTarget } from './target3d.js';
import { colourNum, onRecolour } from '../ui/colours.js';
import { GLOCK17 } from '../data/glock17.js';

const G = GLOCK17.geom;
const TARGET = new THREE.Vector3(55, -45, 0);
const VIEWS = {
  right: [[0.12, 0.08, 1], 430, 300], left: [[0.12, 0.08, -1], 430, 300], back: [[-1, 0.1, 0.2], 330, 120],
  front: [[1, 0.1, 0.2], 480, 120], bottom: [[0.05, -1, 0.25], 400, 300], top: [[0.05, 1, 0.25], 400, 300],
  trigger: [[0.15, -0.05, 1], 170, 110],
};
const LASER = 1500;

export async function createScene(canvas, { stage, onLoad } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#5d6168';
  scene.background = new THREE.Color(bg);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(300, 500, 400);
  scene.add(key, new THREE.HemisphereLight(0xdde6f0, 0x30343a, 0.5));

  const camera = new THREE.PerspectiveCamera(30, 1, 5, 200000);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(TARGET);
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.minDistance = 40; controls.maxDistance = 80000;

  const parts = await loadGlock(onLoad);
  scene.add(parts.gun);
  const target = createTarget(scene);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000), new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = target.GROUND;
  const grid = new THREE.GridHelper(120000, 120, 0x6a7078, 0x585d64);
  grid.position.y = target.GROUND + 1;
  scene.add(floor, grid);

  const lineMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const geo = (from, to) => new THREE.BufferGeometry().setFromPoints([from, to]);
  const muzzle = new THREE.Vector3(G.muzzleX, 0, 0);
  const laser = new THREE.Line(geo(muzzle, new THREE.Vector3(G.muzzleX + LASER, 0, 0)), lineMat(colourNum('angle'), 0.95));
  parts.gun.add(laser);
  onRecolour(() => { laser.material.color.set(colourNum('angle')); draw(); });
  const aim = new THREE.Line(geo(muzzle, new THREE.Vector3(G.muzzleX + LASER, 0, 0)), lineMat(0xffffff, 0.45));
  scene.add(aim);
  laser.visible = aim.visible = false;

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'labels3d';
  (stage || canvas.parentElement).appendChild(labels.domElement);

  let dirty = true, animating = null;
  const beforeLabels = [];
  const afterLabels = [];
  const keepClear = [];
  const draw = () => { dirty = true; };
  controls.addEventListener('change', draw);
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (started) render(); else draw();
  }
  let started = false;
  new ResizeObserver(resize).observe(canvas);
  resize();

  function setView(name) {
    if (name === 'range') {
      camera.position.copy(target.fromAim(-900, 200, 150));
      controls.target.copy(target.fromAim(3000, -420, 60));
      camera.up.set(0, 1, 0);
      camera.lookAt(controls.target);
      controls.update(); draw();
      return;
    }
    if (name === 'target') {
      const c = target.centre();
      controls.target.copy(c);
      camera.position.copy(target.fromAim(target.distance * 1000 - 1600, 150, 350));
      camera.up.set(0, 1, 0);
      camera.lookAt(c);
      controls.update(); draw();
      return;
    }
    const [d, near, span] = VIEWS[name];
    const dist = Math.max(near, span / 2 / (Math.tan((camera.fov * Math.PI) / 360) * camera.aspect));
    const dir = new THREE.Vector3(...d).normalize();
    const at = name === 'trigger' ? new THREE.Vector3(G.triggerFace[0], G.triggerFace[1], 0) : TARGET;
    controls.target.copy(at);
    camera.position.copy(at).addScaledVector(dir, dist);
    camera.up.set(0, 1, 0);
    if (name === 'top' || name === 'bottom') camera.up.set(1, 0, 0);
    camera.lookAt(at);
    controls.update();
    draw();
  }
  setView('right');

  const q = new THREE.Quaternion();
  function poseFromFrame(row) {
    q.set(row[5], row[6], row[7], row[4]);
    parts.gun.quaternion.copy(q);
    parts.gun.position.set(row[1], row[2], row[3]);
    poseGlock(parts, row[8], row[9], row[17] || 0);
    draw();
  }
  function poseRest() {
    parts.gun.quaternion.identity(); parts.gun.position.set(0, 0, 0);
    poseGlock(parts, 0, 0, 0);
    draw();
  }
  function setAim(row) {
    if (!row) { aim.visible = laser.visible = false; draw(); return; }
    q.set(row[5], row[6], row[7], row[4]);
    aim.quaternion.copy(q); aim.position.set(row[1], row[2], row[3]);
    aim.visible = laser.visible = true;
    draw();
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const inv = new THREE.Matrix4(), nm = new THREE.Matrix3();
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const h = raycaster.intersectObjects(parts.solidMeshes, false)[0];
    if (!h) return null;
    const part = parts.frameMeshes.includes(h.object) ? 'frame' : parts.triggerMeshes.includes(h.object) ? 'trigger' : null;
    if (!part) return null;
    inv.copy(h.object.matrixWorld).invert();
    const p = h.point.clone().applyMatrix4(inv);
    const n = h.face.normal.clone();
    const eye = raycaster.ray.direction.clone().transformDirection(inv);
    if (n.dot(eye) > 0) n.negate();
    return { part, x: p.x, y: p.y, z: p.z, nx: n.x, ny: n.y, nz: n.z };
  }

  function frame() {
    if (animating) animating();
    if (dirty) render();
    requestAnimationFrame(frame);
  }
  function render() {
    {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setViewport(0, 0, w, h);
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.render(scene, camera);
      for (const fn of beforeLabels) fn(camera);
      labels.render(scene, camera);
      const cr = canvas.getBoundingClientRect();
      for (const fn of afterLabels) fn(camera, cr);
      declutter();
      dirty = false;
    }
  }
  requestAnimationFrame(frame);
  const overlaps = (r, k) => r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top;
  const NUDGE = [];
  for (const dy of [0, 22, -22, 44, -44, 66, -66, 88, -88, 110, -110, 132, -132]) for (const dx of [0, 60, -60, 120, -120]) if (dx || dy) NUDGE.push([dx, dy]);
  NUDGE.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
  function declutter() {
    const box = labels.domElement.getBoundingClientRect(), EDGE = 4;
    const kept = stage ? [...stage.querySelectorAll('.float')]
      .filter((e) => e.offsetParent && !e.hidden && getComputedStyle(e).opacity > 0.1).map((e) => e.getBoundingClientRect()) : [];
    for (const fn of keepClear) kept.push(...fn());
    const shown = [...labels.domElement.children].filter((e) => e.offsetParent && e.textContent)
      .sort((a, b) => (+a.dataset.rank || 99) - (+b.dataset.rank || 99));
    for (const e of shown) {
      e.style.visibility = ''; e.style.marginLeft = ''; e.style.marginTop = '';
      let r = e.getBoundingClientRect();
      const dx = Math.min(0, box.right - EDGE - r.right) || Math.max(0, box.left + EDGE - r.left);
      const dy = Math.min(0, box.bottom - EDGE - r.bottom) || Math.max(0, box.top + EDGE - r.top);
      if (Math.abs(dx) >= r.width || Math.abs(dy) >= r.height) { e.style.visibility = 'hidden'; continue; }
      if (dx || dy) { e.style.marginLeft = `${dx}px`; e.style.marginTop = `${dy}px`; r = e.getBoundingClientRect(); }
      if (!kept.some((k) => overlaps(r, k))) { kept.push(r); continue; }
      const free = NUDGE.find(([nx, ny]) => {
        const t = { left: r.left + nx, right: r.right + nx, top: r.top + ny, bottom: r.bottom + ny };
        return t.top >= box.top + EDGE && t.bottom <= box.bottom - EDGE && t.left >= box.left + EDGE && t.right <= box.right - EDGE && !kept.some((k) => overlaps(t, k));
      });
      if (free === undefined) { e.style.visibility = 'hidden'; continue; }
      e.style.marginLeft = `${dx + free[0]}px`; e.style.marginTop = `${dy + free[1]}px`;
      kept.push(e.getBoundingClientRect());
    }
  }

  started = true;

  function meshesToGun(list) {
    parts.gun.updateMatrixWorld(true);
    const gi = parts.gun.matrixWorld.clone().invert();
    return list.map((m) => ({ mesh: m, toGun: gi.clone().multiply(m.matrixWorld) }));
  }

  return {
    renderer, scene, camera, controls, parts, canvas, target, labels, beforeLabels, afterLabels, keepClear,
    draw, setView, pick, poseFromFrame, poseRest, setAim,
    animate(fn) { animating = fn; draw(); },
    frameMeshesToGun: () => meshesToGun(parts.frameMeshes),
    triggerMeshesToGun: () => meshesToGun(parts.triggerMeshes),
    renderNow() { if (animating) animating(); render(); },
    setPixelRatio(r) { renderer.setPixelRatio(r); resize(); },
    resize,
  };
}
