
const KEY_NOW = 'recoil-control.paint.now';
const KEY_SAVED = 'recoil-control.paint.saved';
export const FORMAT = 'recoil-control-grip-2';
const FORMAT_1 = 'recoil-control-grip-1';

export function surfaceSignature(s) {
  let h = 2166136261 >>> 0;
  const f = new Uint32Array(s.pos.buffer, s.pos.byteOffset, s.pos.length);
  for (let i = 0; i < f.length; i += 7) { h ^= f[i]; h = Math.imul(h, 16777619) >>> 0; }
  return `${s.n}:${h.toString(16)}`;
}

const toB64 = (arr) => { const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (str) => { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new Float32Array(b.buffer); };

export function encode(grip, sigs, name = '') {
  return {
    format: FORMAT, name, saved: new Date().toISOString(),
    surface: sigs.frame, pressure: toB64(grip.paint.pressure), friction: toB64(grip.paint.friction),
    triggerSurface: sigs.trigger, triggerPressure: toB64(grip.trigger.pressure),
    press: { style: grip.press.style, speed: grip.press.speed },
  };
}
export function decode(obj, sigs) {
  if (!obj || (obj.format !== FORMAT && obj.format !== FORMAT_1)) throw new Error('This is not a GripLock grip file.');
  if (obj.surface !== sigs.frame) throw new Error('This grip was painted on a different version of the gun\'s surface points, so it would land on the wrong spots.');
  const pressure = fromB64(obj.pressure), friction = fromB64(obj.friction);
  const n = Number(sigs.frame.split(':')[0]);
  if (pressure.length !== n || friction.length !== n) throw new Error('This grip file is damaged.');
  let trigger = null, press = null;
  if (obj.format === FORMAT) {
    if (obj.triggerSurface !== sigs.trigger) throw new Error('This grip\'s trigger paint was made on a different version of the trigger\'s points.');
    const tp = fromB64(obj.triggerPressure);
    if (tp.length !== Number(sigs.trigger.split(':')[0])) throw new Error('This grip file is damaged.');
    trigger = { pressure: tp };
    press = obj.press || null;
  }
  return { paint: { pressure, friction }, trigger, press };
}

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const loadNow = () => read(KEY_NOW);
export const saveNow = (grip, sigs) => write(KEY_NOW, encode(grip, sigs));
export const listSaved = () => read(KEY_SAVED) || [];
export function saveNamed(grip, sigs, name) {
  const all = listSaved().filter((g) => g.name !== name);
  all.push(encode(grip, sigs, name));
  all.sort((a, b) => a.name.localeCompare(b.name));
  return write(KEY_SAVED, all);
}
export function deleteNamed(name) { return write(KEY_SAVED, listSaved().filter((g) => g.name !== name)); }

export function download(grip, sigs, name) {
  const blob = new Blob([JSON.stringify(encode(grip, sigs, name))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(name || 'grip').replace(/[^\w.-]+/g, '-')}.griplock.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
