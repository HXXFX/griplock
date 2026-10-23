
import * as THREE from 'three';
import { ISSF_TARGET } from '../data/target.js';
import { val } from '../data/num.js';
import { colour, colourNum, onRecolour } from '../ui/colours.js';

const CARD = val(ISSF_TARGET.card), STEP = val(ISSF_TARGET.ringStep), TEN = val(ISSF_TARGET.innerTen), BLACK = val(ISSF_TARGET.black);
const TEX = 1024, PX = TEX / CARD;
const GROUND = -1300;
const HOLE = 9;

export function createTarget(scene) {
  const group = new THREE.Group(); group.name = 'target';
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = TEX;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(CARD, CARD), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  group.add(card);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(CARD + 40, CARD + 40, 12), wood);
  back.position.z = -8; group.add(back);
  const posts = [];
  for (const x of [-CARD / 2, CARD / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(30, 1, 30), wood);
    post.position.x = x; group.add(post); posts.push(post);
  }
  scene.add(group);

  const pathGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const path = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: colourNum('angle'), transparent: true, opacity: 0.85, depthWrite: false }));
  path.visible = false; path.frustumCulled = false;
  scene.add(path);
  const bullet = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc78a4a, metalness: 0.8, roughness: 0.3 }));
  bullet.scale.set(1, 1, 1.7); bullet.visible = false;
  scene.add(bullet);

  let hits = [], aim = null, distance = 7;
  const M = new THREE.Vector3(), R = new THREE.Matrix4();
  function setAim(a) {
    aim = a || { M: [186, 0, 0], R: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    M.set(...aim.M);
    const r = aim.R;
    R.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
    place();
  }
  const fromAim = (f, u, rt) => new THREE.Vector3(f, u, rt).applyMatrix4(R).add(M);
  function place() {
    const c = fromAim(distance * 1000, 0, 0);
    group.position.copy(c);
    const ax = new THREE.Vector3().setFromMatrixColumn(R, 0), ay = new THREE.Vector3().setFromMatrixColumn(R, 1), az = new THREE.Vector3().setFromMatrixColumn(R, 2);
    const basis = new THREE.Matrix4().makeBasis(az, ay, ax.clone().negate());
    group.quaternion.setFromRotationMatrix(basis);
    const h = c.y - GROUND;
    for (const p of posts) { p.scale.y = Math.max(1, h - CARD / 2); p.position.y = -(CARD / 2 + (h - CARD / 2) / 2); }
  }
  function draw() {
    const g = canvas.getContext('2d');
    g.fillStyle = '#ece6d6'; g.fillRect(0, 0, TEX, TEX);
    const c = TEX / 2;
    g.fillStyle = '#16181b'; g.beginPath(); g.arc(c, c, BLACK * PX, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2;
    for (let k = 1; k <= 10; k++) {
      const r = k * STEP * PX;
      g.strokeStyle = r <= BLACK * PX + 0.5 ? '#ece6d6' : '#16181b';
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = '#ece6d6'; g.beginPath(); g.arc(c, c, TEN * PX, 0, Math.PI * 2); g.stroke();
    g.font = `600 ${Math.round(9 * PX)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 1; k <= 8; k++) {
      const r = (k + 0.5) * STEP * PX;
      g.fillStyle = r < BLACK * PX ? '#ece6d6' : '#16181b';
      for (const sgn of [-1, 1]) g.fillText(String(10 - k), c + sgn * r, c);
    }
    for (const h of [...hits.filter((x) => !x.current), ...hits.filter((x) => x.current)]) {
      const x = c + h.right * PX, y = c - h.up * PX, r = (HOLE / 2) * PX;
      if (x < -r || y < -r || x > TEX + r || y > TEX + r) continue;
      g.fillStyle = '#050505'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.lineWidth = h.current ? 5 : 2;
      g.strokeStyle = h.current ? colour('angle') : '#9aa3ad';
      g.beginPath(); g.arc(x, y, r + (h.current ? 5 : 2), 0, Math.PI * 2); g.stroke();
      if (!h.label) continue;
      g.font = `700 ${Math.round(7 * PX)}px ui-monospace, Consolas, monospace`;
      g.lineWidth = 6; g.strokeStyle = '#ece6d6'; g.strokeText(h.label, x + r + 9 * PX * 0.6, y - r - 4);
      g.fillStyle = h.current ? '#16181b' : '#30363d'; g.fillText(h.label, x + r + 9 * PX * 0.6, y - r - 4);
    }
    tex.needsUpdate = true;
  }
  setAim(null);
  draw();
  onRecolour(() => { path.material.color.set(colourNum('angle')); draw(); });

  return {
    group,
    get distance() { return distance; },
    setDistance(d) { distance = d; place(); },
    setAim,
    setHits(list) { hits = list; draw(); },
    setPath(from, hit) {
      if (!from || !hit) { path.visible = false; return; }
      const a = fromAim(...from), b = fromAim(distance * 1000, hit.up, hit.right);
      pathGeo.setFromPoints([a, b]); path.visible = true;
      path.userData = { a, b };
    },
    setBullet(share) {
      if (share === null || !path.visible) { bullet.visible = false; return; }
      const { a, b } = path.userData;
      bullet.position.lerpVectors(a, b, share);
      bullet.lookAt(b);
      bullet.visible = true;
    },
    centre: () => group.position.clone(),
    fromAim,
    GROUND,
  };
}
