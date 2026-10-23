
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLOCK17 } from '../data/glock17.js';

const G = GLOCK17.geom;
export const GLOCK_URL = new URL('../assets/glock/g17_artist_parts.glb', import.meta.url).href;

export async function loadGlock(onProgress) {
  const gltf = await new GLTFLoader().loadAsync(GLOCK_URL, (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); });
  const part = {};
  for (const k of ['frame', 'slide', 'trigger', 'barrel']) part[k] = gltf.scene.getObjectByName(k) || null;
  for (const k of ['frame', 'slide', 'trigger', 'barrel']) if (!part[k]) throw new Error(`The Glock parts file has no "${k}"`);

  const gun = new THREE.Group(); gun.name = 'glock17';
  const frame = new THREE.Group(); frame.name = 'frame';
  part.frame.removeFromParent(); frame.add(part.frame);
  gun.add(frame);
  const trigger = new THREE.Group(); trigger.name = 'trigger';
  trigger.position.set(G.triggerPivot[0], G.triggerPivot[1], 0);
  part.trigger.removeFromParent();
  part.trigger.position.set(-G.triggerPivot[0], -G.triggerPivot[1], 0);
  trigger.add(part.trigger);
  frame.add(trigger);
  const barrel = new THREE.Group(); barrel.name = 'barrel';
  part.barrel.removeFromParent(); barrel.add(part.barrel);
  frame.add(barrel);
  const slide = new THREE.Group(); slide.name = 'slide';
  part.slide.removeFromParent(); slide.add(part.slide);
  frame.add(slide);

  const own = (root) => {
    const list = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      list.push(o);
    });
    return list;
  };
  const frameMeshes = own(part.frame), triggerMeshes = own(part.trigger);
  const meshes = (root) => { const list = []; root.traverse((o) => { if (o.isMesh) list.push(o); }); return list; };
  const solidMeshes = [...frameMeshes, ...triggerMeshes, ...meshes(part.slide), ...meshes(part.barrel)];
  gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { gun, frame, slide, barrel, trigger, frameMeshes, triggerMeshes, solidMeshes };
}

const FACE_R = Math.hypot(G.triggerFace[0] - G.triggerPivot[0], G.triggerFace[1] - G.triggerPivot[1]);

export function poseGlock(parts, s, b, trig = 0) {
  parts.trigger.rotation.z = -trig / FACE_R;
  parts.slide.position.x = -s;
  const tilt = Math.max(0, Math.min(1, (b - 2.5) / 0.6)) * 1.4 * Math.PI / 180;
  parts.barrel.rotation.z = tilt;
  parts.barrel.position.set(-b + G.muzzleX * (1 - Math.cos(tilt)), -G.muzzleX * Math.sin(tilt), 0);
}
