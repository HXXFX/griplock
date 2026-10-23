
import { parseSurface, padsFromPaint, paintTotals, regionPushes, mirrorMap, REGIONS } from './paint/surface.js';
import { newPaint, startingGrip, mirrorPaint, squeezeOf, DEFAULT_FRICTION } from './paint/brush.js';
import { startingTrigger, triggerTotals, turnPerPush } from './paint/trigger.js';
import { createScene } from './view/scene.js';
import { createHeat, pressureRamp, frictionRamp, leverRamp, RAMP_TICKS, pressureU, FRAME_GRID, TRIGGER_GRID, LEVER_TOP, F_TOP } from './view/heat.js';
import { createBrushTool } from './view/brushtool.js';
import { createAnnotations } from './view/annotate.js';
import { createScope } from './view/scope.js';
import { colour, onRecolour, recolour } from './ui/colours.js';
import { canMakeVideo, encode, paintStage, SIZES, FPS } from './ui/video.js';
import { createShooter } from './physics/client.js';
import { impactAt } from './physics/recoil.js';
import { drawChart } from './ui/chart.js';
import * as store from './ui/store.js';
import { AMMO } from './data/ammo.js';
import { FRICTION, SQUEEZE, STRENGTH } from './data/skin.js';
import { PRESS_STYLES, GLOCK_TRIGGER, TRIGGER_FINGER } from './data/trigger.js';
import { DISTANCES } from './data/target.js';
import { GLOCK17 } from './data/glock17.js';
import { val } from './data/num.js';
import * as THREE from 'three';
import { lb, psi, inch, oz, fps, toLb, toPsi, toIn, toIn2, toOz, toFps, YARD, PSI } from './ui/units.js';

const $ = (id) => document.getElementById(id);
const MUZZLE_X = GLOCK17.geom.muzzleX;
const SLIDE_TRAVEL = GLOCK17.phys.travel * 1000;
const RISE_SCALE = 4;
const f = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : Number(x).toFixed(d));
const app = (window.__app = { ready: false });
const BREAK = val(GLOCK_TRIGGER.breakForce);
const INFO = {};

const cover = { show(phase, share) { $('cover').hidden = false; $('cover-phase').textContent = phase; $('cover-bar').style.width = `${Math.round((share || 0) * 100)}%`; $('cover-pct').textContent = share === null ? ' ' : `${Math.round((share || 0) * 100)}%`; }, hide() { $('cover').hidden = true; } };
cover.show('Loading the gun', 0);

const loadBin = (name) => fetch(new URL(`./data/${name}`, import.meta.url)).then((r) => { if (!r.ok) throw new Error(`${name}: ${r.status}`); return r.arrayBuffer(); });
const [frameBuf, triggerBuf] = await Promise.all([loadBin('gun-surface.bin'), loadBin('trigger-surface.bin')]);
const surface = parseSurface(frameBuf), tsurface = parseSurface(triggerBuf);
const sigs = { frame: store.surfaceSignature(surface), trigger: store.surfaceSignature(tsurface) };
const view = await createScene($('view'), { stage: $('stage'), onLoad: (s) => cover.show('Loading the gun', s * 0.9) });
cover.show('Preparing the paint', 0.95);
const heat = createHeat(surface, FRAME_GRID), theat = createHeat(tsurface, TRIGGER_GRID);
for (const { mesh, toGun } of view.frameMeshesToGun()) for (const m of [].concat(mesh.material)) heat.patch(m, toGun);
for (const { mesh, toGun } of view.triggerMeshesToGun()) for (const m of [].concat(mesh.material)) theat.patch(m, toGun);
const notes = createAnnotations(view);

const DEMO = false;
const scope = createScope({
  win: $('scope'), bar: $('scope-bar'), paper: $('scope-paper'), grip: $('scope-grip'), stage: $('stage'),
  zoomOut: $('scope-out'), zoomIn: $('scope-in'), zoomText: $('scope-x'), fitShots: $('scope-fit'), wholeCard: $('scope-card'),
  keep: DEMO ? null : 'recoil-control.scope',
});
const HANDS_KEY = 'recoil-control.hands';
let hands = 'man';
try { const h = localStorage.getItem(HANDS_KEY); if (h in STRENGTH) hands = h; } catch {   }
const mostSqueeze = () => val(STRENGTH[hands].grip) + val(STRENGTH[hands].support);
const mostFinger = () => val(STRENGTH[hands].finger);
const fingerPush = (P) => triggerTotals(tsurface, P).push;

const paint = newPaint(surface);
const tpaint = { pressure: new Float32Array(tsurface.n), friction: new Float32Array(tsurface.n) };
const press = { style: 'smooth', speed: 0.25 };
function useGrip(g) {
  paint.pressure.set(g.paint.pressure); paint.friction.set(g.paint.friction);
  if (g.trigger) tpaint.pressure.set(g.trigger.pressure);
  if (g.press) { press.style = g.press.style in PRESS_STYLES ? g.press.style : 'smooth'; press.speed = +g.press.speed || 0.25; }
}
let cutNote = '';
function keepToLimit() {
  const words = [];
  const sq = squeezeOf(surface, paint.pressure), most = mostSqueeze();
  if (sq > most + 0.5) { const k = most / sq; for (let i = 0; i < paint.pressure.length; i++) paint.pressure[i] *= k; words.push(`the grip from ${lb(sq, 0)} to ${lb(most, 0)}`); }
  const fp = fingerPush(tpaint.pressure), mf = mostFinger();
  if (fp > mf + 0.05) { const k = mf / fp; for (let i = 0; i < tpaint.pressure.length; i++) tpaint.pressure[i] *= k; words.push(`the finger from ${lb(fp, 1)} to ${lb(mf, 1)}`); }
  cutNote = words.length ? `More than ${STRENGTH[hands].name.toLowerCase()}'s hands can do: scaled down, ${words.join(' and ')}.` : '';
}
const startFinger = () => startingTrigger(tsurface, BREAK, mostFinger());
{
  let restored = false;
  const kept = DEMO ? null : store.loadNow();
  if (kept) { try { useGrip(store.decode(kept, sigs)); restored = true; } catch {   } }
  if (!restored) { const s = startingGrip(surface); paint.pressure.set(s.pressure); paint.friction.set(s.friction); }
  if (!tpaint.pressure.some((p) => p > 0)) tpaint.pressure.set(startFinger());
  keepToLimit();
}
const tShade = Float32Array.from(turnPerPush(tsurface), (v) => (Math.max(0, v) / LEVER_TOP) * F_TOP);
heat.setAll(paint.pressure, paint.friction);
theat.setAll(tpaint.pressure, tShade);
const mirror = mirrorMap(surface);
const grip = () => ({ paint, trigger: tpaint, press });

const ui = { step: 'grip', tool: 'push', show: 'pressure', where: false };
function setStep(s) {
  ui.step = s;
  for (const b of $('steps').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.step === s));
  for (const p of document.querySelectorAll('.step')) p.hidden = p.dataset.step !== s;
  if (s === 'trigger') setTool(ui.tool === 'friction' ? 'push' : ui.tool);
  if (s === 'shot' && current) drawShotChart(replayMs());
  if (ui.where) setShow(ui.show);
}
for (const b of $('steps').querySelectorAll('button')) b.addEventListener('click', () => setStep(b.dataset.step));


const brushOf = {
  frame: () => ({ radius: +$('g-radius').value, amount: +$('g-amount').value }),
  trigger: () => ({ radius: +$('t-radius').value, amount: +$('t-amount').value }),
};
function getBrush(part) {
  if (part === 'trigger' && ui.tool === 'friction') return null;
  const b = brushOf[part]();
  return { mode: ui.tool, radius: b.radius, amount: ui.tool === 'friction' ? 0.35 : ui.tool === 'smooth' ? 0.5 : b.amount, friction: +$('mu').value };
}
let replay = null;
const atLimit = { frame: false, trigger: false };
const tool = createBrushTool({
  view, getBrush,
  targets: {
    frame: { surface, paint, heat, limit: mostSqueeze, measure: (P) => squeezeOf(surface, P) },
    trigger: { surface: tsurface, paint: tpaint, heat: theat, limit: mostFinger, measure: fingerPush, shade: tShade },
  },
  onLimit: (part) => { atLimit[part] = true; },
  onStart: (part) => { leaveReplay(); setStep(part === 'trigger' ? 'trigger' : 'grip'); atLimit.frame = atLimit.trigger = false; },
  onStroke: (part) => paintChanged(part),
  onHover: (at) => hoverReadout(at),
});

for (const b of $('rail').querySelectorAll('button[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
function setTool(t) {
  ui.tool = t;
  for (const b of $('rail').querySelectorAll('button[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  $('g-amount-field').hidden = t === 'friction' || t === 'smooth';
  $('mu-field').hidden = t !== 'friction';
  $('g-amount-label').textContent = t === 'lighten' ? 'Lighten' : 'Press';
  if (t === 'friction') { setStep('grip'); setShow('friction'); } else if (ui.show === 'friction') setShow('pressure');
  outs();
}
function outs() {
  $('g-radius-out').textContent = inch(+$('g-radius').value);
  $('g-amount-out').textContent = psi(+$('g-amount').value);
  $('t-radius-out').textContent = inch(+$('t-radius').value, 3);
  $('t-amount-out').textContent = psi(+$('t-amount').value);
  $('mu-out').textContent = f(+$('mu').value, 2);
  const what = { push: 'press', lighten: 'lighten', smooth: 'smooth', friction: `friction ${f(+$('mu').value, 2)}` }[ui.tool];
  $('sv-brush').textContent = `${what}, ${inch(+$('g-radius').value)}`;
  $('sv-tbrush').textContent = `${ui.tool === 'friction' ? 'press' : what}, ${inch(+$('t-radius').value, 3)}`;
}
for (const id of ['g-radius', 'g-amount', 't-radius', 't-amount', 'mu']) $(id).addEventListener('input', () => { outs(); tool.ring(null); });
outs();
$('mu-preset').innerHTML = '<option value="">Pick a known surface...</option>' + Object.entries(FRICTION).map(([k, v]) => `<option value="${k}">${v.name} (${val(v.mu)})</option>`).join('');
$('mu-preset').addEventListener('change', () => { const v = FRICTION[$('mu-preset').value]; if (v) { $('mu').value = val(v.mu); outs(); } $('mu-preset').value = ''; });

for (const b of $('show').querySelectorAll('button')) b.addEventListener('click', () => setShow(b.dataset.show));
function setShow(s) {
  ui.show = s;
  for (const b of $('show').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.show === s));
  heat.uniforms.uMode.value = s === 'pressure' ? 1 : s === 'friction' ? 2 : 0;
  theat.uniforms.uMode.value = whereOn() ? 3 : s === 'none' ? 0 : 1;
  $('t-where').setAttribute('aria-pressed', String(ui.where));
  drawLegend();
  view.draw();
}
const whereOn = () => ui.where && ui.step === 'trigger';
$('t-where').addEventListener('click', () => { ui.where = !ui.where; setShow(ui.show); });

$('undo').addEventListener('click', () => tool.undo());
$('redo').addEventListener('click', () => tool.redo());
const change = (fn) => {
  leaveReplay(); tool.remember(); fn(); keepToLimit();
  heat.setAll(paint.pressure, paint.friction); theat.setAll(tpaint.pressure, tShade);
  view.draw(); paintChanged(null);
};
$('clear').addEventListener('click', () => change(() => { paint.pressure.fill(0); paint.friction.fill(DEFAULT_FRICTION); }));
$('mirror-rl').addEventListener('click', () => change(() => mirrorPaint(surface, paint, mirror, true)));
$('mirror-lr').addEventListener('click', () => change(() => mirrorPaint(surface, paint, mirror, false)));
$('starting').addEventListener('click', () => change(() => { const s = startingGrip(surface); paint.pressure.set(s.pressure); paint.friction.set(s.friction); }));
$('t-clear').addEventListener('click', () => change(() => tpaint.pressure.fill(0)));
$('t-starting').addEventListener('click', () => change(() => tpaint.pressure.set(startFinger())));
$('hands').innerHTML = Object.entries(STRENGTH).map(([k, h]) => `<option value="${k}">${h.name}</option>`).join('');
$('hands').value = hands;
$('hands').addEventListener('change', () => {
  hands = $('hands').value;
  try { localStorage.setItem(HANDS_KEY, hands); } catch {   }
  change(() => {});
});

$('press').innerHTML = Object.entries(PRESS_STYLES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
$('press').value = press.style; $('press-time').value = press.speed;
const pressOuts = () => {
  press.style = $('press').value; press.speed = +$('press-time').value;
  $('press-time-field').hidden = press.style === 'none';
  $('press-time-out').textContent = `${f((press.style === 'slap' ? 0.3 : 1) * press.speed, 2)} s`;
  $('sv-press').textContent = press.style === 'none' ? 'no finger' : `${{ smooth: 'smooth', staged: 'slack, then press', slap: 'slap' }[press.style]}, ${$('press-time-out').textContent}`;
  fireWarn();
  saveSoon();
};
for (const id of ['press', 'press-time']) $(id).addEventListener('input', pressOuts);

function drawLegend() {
  $('legend').hidden = ui.show === 'none' && !whereOn();
  const c = $('legend-ramp'), g = c.getContext('2d');
  const px = whereOn() ? leverRamp() : ui.show === 'friction' ? frictionRamp() : pressureRamp();
  const img = g.createImageData(256, 1); img.data.set(px);
  for (let y = 0; y < c.height; y++) g.putImageData(img, 0, y);
  const ticks = (vals, at) => vals.map((v, i, a) => `<span style="left:${(at(v) * 100).toFixed(1)}%;transform:translateX(-${i === 0 ? 0 : i === a.length - 1 ? 100 : 50}%)">${v}</span>`).join('');
  if (whereOn()) {
    $('legend-title').textContent = 'Turns the trigger, per lb pushed';
    $('legend-ticks').innerHTML = ticks([0, 0.5, 1, 1.5], (v) => v / LEVER_TOP);
  } else if (ui.show === 'friction') {
    $('legend-title').textContent = 'Friction (sticking share)';
    $('legend-ticks').innerHTML = [0, 0.5, 1, 1.5].map((v, i, a) => `<span style="left:${(100 * i) / (a.length - 1)}%;transform:translateX(-${i === 0 ? 0 : i === a.length - 1 ? 100 : 50}%)">${v}</span>`).join('');
  } else {
    $('legend-title').innerHTML = 'Pressure, psi';
    const top = toPsi(RAMP_TICKS[RAMP_TICKS.length - 1]);
    $('legend-ticks').innerHTML = [0, 3, 10, 20, 40, Math.round(top)].map((v, i, a) => `<span style="left:${(pressureU(v * PSI) * 100).toFixed(1)}%;transform:translateX(-${i === 0 ? 0 : i === a.length - 1 ? 100 : 50}%)">${v}</span>`).join('');
  }
  $('legend-slip').hidden = !(replay && ui.show === 'pressure');
}

function updateGrip() {
  const t = paintTotals(surface, paint.pressure);
  const sq = t.force / 2, most = mostSqueeze();
  $('g-squeeze').innerHTML = `${f(toLb(sq), 0)} <small>of ${lb(most, 0)}</small>`;
  $('g-squeeze').classList.toggle('warn', sq >= most - 0.5 || !!cutNote);
  $('g-gauge').style.width = `${Math.min(100, (100 * sq) / most)}%`;
  $('g-gauge').classList.toggle('full', sq >= most - 0.5);
  const atLimit = sq >= most - 0.5;
  $('g-limit-note').hidden = !(cutNote || atLimit);
  $('g-limit-note').textContent = cutNote || (atLimit ? 'At the limit: the brush adds no more. Lighten somewhere to press harder elsewhere.' : '');
  INFO.squeeze = `<p>A squeeze presses two opposite sides of the grip, as a grip-strength meter's two handles do, so it is the paint's pushes added up, halved: <b>${lb(sq, 0)}</b> of <b>${lb(t.force, 0)}</b>.</p>` +
    `<p>The brush stops at what the chosen hands can do: ${STRENGTH[hands].name.toLowerCase()}'s two hands' measured grip strength together, ${lb(val(STRENGTH[hands].grip), 0)} + ${lb(val(STRENGTH[hands].support), 0)} = <b>${lb(most, 0)}</b>.</p>`;
  $('g-force').innerHTML = `${f(toLb(t.force), 0)} <small>lb</small>`;
  $('g-area').innerHTML = `${f(toIn2(t.area), 1)} <small>in²</small>`;
  const [fx, fy, fz] = t.net, net = Math.hypot(fx, fy, fz), lop = net > 0.25 * t.force;
  const pushes = [[fx, 'Forward', 'Back', 'fwd', 'back'], [fy, 'Up', 'Down', 'up', 'down'], [fz, 'To the right', 'To the left', 'right', 'left']]
    .filter(([v]) => Math.abs(v) >= 2).sort((p, q) => Math.abs(q[0]) - Math.abs(p[0]));
  $('sv-balance').textContent = t.force < 1 ? 'nothing painted' : pushes.length ? pushes.slice(0, 2).map(([v, , , a, b]) => `${lb(Math.abs(v), 0)} ${v > 0 ? a : b}`).join(', ') : 'balanced';
  $('sv-balance').classList.toggle('warn', t.force < 1 || lop);
  $('g-balance').innerHTML = t.force < 1 ? '' : pushes.length
    ? pushes.map(([v, a, b]) => `<span class="k">${v > 0 ? a : b}</span><span class="v">${lb(Math.abs(v))}</span>`).join('')
    : `<span class="k">Every way</span><span class="v">under ${lb(2)}</span>`;
  $('g-balance-warn').hidden = !(t.force < 1 || lop);
  $('g-balance-warn').textContent = t.force < 1 ? 'Nothing painted: nothing holds the gun.' : 'Lopsided: it may not hold.';
  const words = pushes.map(([v, a, b]) => `${lb(Math.abs(v))} ${(v > 0 ? a : b).toLowerCase()}`);
  INFO.balance = (t.force < 1 ? '<p>Paint where a hand would press. With nothing painted, nothing holds the gun.</p>'
    : `<p>Before anything moves, the paint pushes the gun ${words.length ? `<b>${words.join(', ')}</b>` : `less than <b>${lb(2)}</b> any way`}. It will shift until the squashed spots even this out.</p>` +
      `<p>When what is left over is a quarter or more of the paint's pushes added up (now ${f((100 * net) / Math.max(t.force, 1e-9), 0)}%), it may not hold.</p>`) +
    `<p>Shooters who qualify well have a grip strength of ${f(toLb(val(SQUEEZE.shooterGrip)), 0)}-${lb(val(SQUEEZE.shooterGripHigh), 0)}.</p>`;
  if (!replay) {
    notes.setGrip(regionPushes(surface, paint.pressure));
    notes.setGauges({ squeeze: { share: sq / most, text: lb(sq, 0) }, slide: { share: 0, text: inch(0) }, muzzle: { share: 0, text: '0.00°' } });
  }
}
function fingerArrow(pressure, share = 1) {
  const areas = regionPushes(tsurface, pressure, 0.01);
  if (!areas.length) return null;
  let F = 0; const at = [0, 0, 0];
  for (const a of areas) { F += a.force; for (let k = 0; k < 3; k++) at[k] += a.at[k] * a.force; }
  const t = triggerTotals(tsurface, pressure);
  return { at: at.map((x) => x / F), dir: t.net, push: F * share, text: `finger ${lb(F * share)}\n${lb(t.faceForce * share)} at the face` };
}
function updateTrigger() {
  const t = triggerTotals(tsurface, tpaint.pressure);
  const mf = mostFinger();
  $('t-push').innerHTML = `${f(toLb(t.push), 1)} <small>of ${lb(mf)}</small>`;
  $('t-limit').style.width = `${Math.min(100, (100 * t.push) / mf)}%`;
  $('t-limit').classList.toggle('full', t.push >= mf - 0.05);
  $('t-face').textContent = t.push < 0.05 ? 'nothing painted' : `${lb(t.faceForce)} at the face`;
  $('t-face').classList.toggle('warn', t.faceForce < BREAK);
  $('t-push').classList.toggle('warn', t.push >= mf - 0.05);
  const fingerFull = t.push >= mf - 0.05;
  $('t-limit-note').hidden = !fingerFull;
  $('t-limit-note').textContent = 'At the limit: the brush adds no more.';
  INFO.finger = `<p>The finger's pushes added up, <b>${lb(t.push)}</b>, against the most ${STRENGTH[hands].name.toLowerCase()}'s index finger can press, <b>${lb(mf)}</b>. The brush adds no more past it.</p>`;
  $('t-gauge').style.width = `${Math.min(100, (t.faceForce / (2 * BREAK)) * 100)}%`;
  $('t-break').style.left = '50%';
  const side = Math.abs(t.sideways) >= 0.2 ? `${lb(Math.abs(t.sideways))} of it pushes the gun to its ${t.sideways > 0 ? 'right' : 'left'}` : 'none of it pushes the gun sideways';
  $('t-face-note').hidden = t.faceForce >= BREAK && t.push >= 0.05;
  $('t-face-note').innerHTML = t.push < 0.05 ? '<b>Nothing painted</b>: the trigger will not break.'
    : `<b>Too light</b>: it breaks at ${lb(BREAK)} (the white line). ${fingerFull ? 'Paint lower on the trigger, or off its sides.' : 'Press harder, or paint lower.'}`;
  $('t-face-kv').innerHTML = t.push < 0.05 ? '' : `<span class="k">The finger pushes</span><span class="v">${lb(t.push)}</span>` +
    `<span class="k">Turns it like <small>at the face</small></span><span class="v ${t.faceForce >= BREAK ? '' : 'warn'}">${lb(t.faceForce)} <small>(${f((100 * t.faceForce) / t.push, 0)}%)</small></span>`;
  INFO.face = `<p>The trigger turns about its pin. What breaks it is how hard the paint turns it, given as the force at the middle of its face, where a trigger's weight is measured: <b>${lb(t.faceForce)}</b> at the full press, against <b>${lb(BREAK)}</b> to break it (the white line)` +
    (t.faceForce >= BREAK ? `, so it breaks ${f(Math.max(0, 1 - BREAK / t.faceForce) * 100, 0)}% short of the full press.</p>` : '.</p>') +
    `<p>The finger's pushes add up to <b>${lb(t.push)}</b>; ${side}. Each painted spot pulls straight back as far as the skin's grip on the trigger allows (friction ${val(TRIGGER_FINGER.padFriction)}); where the face curves further away, and on the trigger's sides, a push turns it less. Paint low on the trigger (a longer lever) turns it more: <b>Where it turns</b>, under the brush, colours the trigger by this.</p>`;
  if (!replay) {
    notes.setFinger(fingerArrow(tpaint.pressure));
    notes.setGauges({ trigger: { share: t.faceForce / (2 * BREAK), mark: 0.5, text: lb(t.faceForce) } });
  }
  fireWarn();
}
function fireWarn() {
  const t = triggerTotals(tsurface, tpaint.pressure), short = press.style !== 'none' && t.faceForce < BREAK;
  $('fire-warn').hidden = !short;
  if (short) $('fire-warn').innerHTML = `<b>The trigger will not break</b>: the finger's paint reaches ${lb(Math.max(0, t.faceForce))} at its face, and it needs ${lb(BREAK)}. Nothing will fire. Paint more, or lower, on the trigger (step 2).`;
  $('fire').textContent = short ? 'Fire (the trigger will not break)' : +$('nshots').value > 1 ? `Fire ${$('nshots').value} shots` : 'Fire';
}
let saveTimer = null;
const saveSoon = () => { if (DEMO) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => store.saveNow(grip(), sigs), 400); };
function paintChanged(part) {
  $('banner').hidden = true;
  if (part !== 'trigger') updateGrip();
  if (part !== 'frame') updateTrigger();
  if (current) $('r-stale').hidden = sameAs(current);
  saveSoon();
  $('undo').disabled = !tool.canUndo(); $('redo').disabled = !tool.canRedo();
}
const sameAs = (shot) => shot.paint.pressure.every((v, i) => v === paint.pressure[i]) && shot.paint.friction.every((v, i) => v === paint.friction[i]) &&
  shot.trigger.pressure.every((v, i) => v === tpaint.pressure[i]) && shot.press.style === press.style && shot.press.speed === press.speed;

function hoverReadout(at) {
  if (replay) return;
  const el = $('readout');
  if (!at) { el.hidden = true; return; }
  const s = at.part === 'trigger' ? tsurface : surface, P = at.part === 'trigger' ? tpaint.pressure : paint.pressure;
  let best = -1, bd = 3;
  for (let i = 0; i < s.n; i++) {
    const d = Math.hypot(s.pos[i * 3] - at.x, s.pos[i * 3 + 1] - at.y, s.pos[i * 3 + 2] - at.z);
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `${REGIONS[s.region[best]]} &middot; <b>${psi(P[best])}</b>` + (at.part === 'frame' ? ` &middot; friction <b>${f(paint.friction[best], 2)}</b>` : '');
}

const distYd = () => +$('distance').value;
const dist = () => distYd() * YARD;
$('distance').min = DISTANCES.min; $('distance').max = DISTANCES.max; $('distance').value = DISTANCES.start;
$('distance').addEventListener('input', () => {
  $('distance-out').textContent = `${distYd()} yd`;
  view.target.setDistance(dist());
  showHits();
  view.draw();
});
$('distance-out').textContent = `${distYd()} yd`;
view.target.setDistance(dist());
const hitWords = (h) => `${inch(Math.abs(h.right))} ${h.right >= 0 ? 'right' : 'left'}, ${inch(Math.abs(h.up))} ${h.up >= 0 ? 'high' : 'low'}`;
const firedOf = (sh) => (sh && sh.out.shots ? sh.out.shots.filter((s) => s.exit) : []);
const hitsOf = (sh, D) => firedOf(sh).map((s) => impactAt(s.exit, D));
function groupOf(hs) {
  let spread = 0;
  for (let a = 0; a < hs.length; a++) for (let b = a + 1; b < hs.length; b++) spread = Math.max(spread, Math.hypot(hs[a].right - hs[b].right, hs[a].up - hs[b].up));
  return { spread, right: hs.reduce((s, h) => s + h.right, 0) / hs.length, up: hs.reduce((s, h) => s + h.up, 0) / hs.length };
}
let arrived = Infinity;
function showHits() {
  const D = dist(), holes = [];
  for (const sh of shots) {
    const hs = hitsOf(sh, D), many = hs.length > 1;
    hs.forEach((h, j) => {
      if (sh === current && j >= arrived) return;
      holes.push({ label: many ? (sh === current ? String(j + 1) : '') : String(sh.n), current: sh === current, ...h });
    });
  }
  view.target.setHits(holes);
  scope.setHits(holes);
  const hs = hitsOf(current, D);
  if (!hs.length) {
    view.target.setPath(null);
    $('scope-hit').textContent = current ? 'no shot' : '';
    notes.setHit(null);
    return;
  }
  const fired = firedOf(current);
  view.target.setAim({ M: fired[0].exit.aimMuzzle, R: fired[0].exit.aimR });
  const k = Math.min(hs.length, arrived) - 1;
  if (!replay) view.target.setPath(fired[hs.length - 1].exit.muzzle.map((x) => x * 1000), hs[hs.length - 1]);
  const which = (j) => (hs.length > 1 ? `shot ${j + 1}` : `shot ${current.n}`);
  $('scope-hit').textContent = k >= 0 ? `${which(k)}: ${hitWords(hs[k])}` : '';
  notes.setHit(k >= 0 ? `${which(k)}: ${hitWords(hs[k])} at ${distYd()} yd` : null, k >= 0 ? hs[k] : null);
  const at = (x) => `${f(toIn(Math.abs(x.right)), 2)} ${x.right >= 0 ? 'right' : 'left'}, ${f(toIn(Math.abs(x.up)), 2)} ${x.up >= 0 ? 'high' : 'low'}`;
  const row = (k, v, cls = '') => `<span class="k">${k}</span><span class="v ${cls}">${v}</span>`;
  const head = '<span></span><span class="kh">inches from the middle</span>';
  INFO.landed = `<p>Where the bullet hit the target at <b>${distYd()} yd</b>, against where an undisturbed shot lands (the sights are set for the target's distance). ` +
    'It comes from where the muzzle pointed and how it was moving as the bullet left, half a millisecond after the shot.</p>' +
    (hs.length > 1 ? `<p>The group, <b>${hs.length} holes</b>: <b>${inch(groupOf(hs).spread, 2)}</b> between its two furthest holes; its middle is the average of the holes. The target window joins the two furthest.</p>` : '');
  if (hs.length > 1) {
    const g = groupOf(hs);
    $('hit').textContent = `${inch(g.spread, 1)} group`;
    $('hit-d').innerHTML = head + row('Group middle', at(g)) + row('First shot', at(hs[0])) + row('Last shot', at(hs[hs.length - 1]));
    return;
  }
  const h = hs[0], off = Math.hypot(h.right, h.up);
  $('hit').textContent = hitWords(h);
  const prev = shots.slice(0, shots.indexOf(current)).reverse().find((sh) => hitsOf(sh, D).length === 1);
  if (prev) {
    const ph = hitsOf(prev, D)[0], poff = Math.hypot(ph.right, ph.up);
    $('hit-d').innerHTML = row('From the middle', inch(off), off < poff ? 'better' : off > poff ? 'worse' : '') + row(`Shot ${prev.n}`, inch(poff));
  } else $('hit-d').innerHTML = row('From the middle', inch(off)) + row('Distance', `${distYd()} yd`);
}

$('ammo').innerHTML = Object.values(AMMO).map((a) => `<option value="${a.id}"${a.id === '124' ? ' selected' : ''}>${a.name}</option>`).join('');
const shooter = createShooter();
let pool = null;
shooter.warm().then((w) => {
  pool = w;
  $('threads').textContent = w.shared ? `${w.threads} of ${w.of} processor threads` : '1 processor thread';
  INFO.threads = w.shared
    ? `<p>Each shot is worked out on <b>${w.threads}</b> of this computer's <b>${w.of}</b> processor threads; one is left free for the page.</p>`
    : '<p>Each shot is worked out on <b>1</b> processor thread: this browser did not let the page split the work between threads, so a shot takes longer.</p>';
}).catch((e) => { $('threads').textContent = 'no processor threads'; INFO.threads = `<p>${e.message}</p>`; });
INFO.credits = '<p>The gun: "G17 Pistol - Animated" by user77 (the gun by 3dvachevsky), ' +
  '<a href="https://sketchfab.com/3d-models/g17-pistol-animated-7723ab14e70446ef8e06a134984f287f" target="_blank" rel="noopener">on Sketchfab</a>, ' +
  'licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>; changed for GripLock: placed at its real size and cut into its parts.</p>' +
  '<p>Fonts: Inter by Rasmus Andersson, JetBrains Mono by JetBrains and, for the name, Michroma by Vernon Adams (SIL Open Font License 1.1). ' +
  'The 3D drawing: three.js; the videos: mp4-muxer (both MIT License).</p>' +
  '<p class="plate"><span>GripLock &middot; <a href="https://windnoise.org" target="_blank" rel="noopener">A Windnoise solution</a> &middot; ' +
  '<a href="https://github.com/HXXFX/griplock" target="_blank" rel="noopener" aria-label="HXXFX: the source of GripLock on GitHub">HXXFX</a></span>' +
  '<span>&copy; 2026 Windnoise &middot; All rights reserved</span></p>';

$('nshots').innerHTML = Array.from({ length: 17 }, (_, i) => `<option value="${i + 1}">${i + 1} shot${i ? 's' : ''}</option>`).join('');
const stringOuts = () => {
  $('split-field').hidden = +$('nshots').value < 2;
  $('split-out').textContent = `${f(+$('split').value, 2)} s`;
  fireWarn();
};
for (const id of ['nshots', 'split']) $(id).addEventListener('input', stringOuts);
stringOuts();

const shots = [];
let current = null;
$('fire').addEventListener('click', fire);
async function fire() {
  const { pads, index } = padsFromPaint(surface, paint.pressure, paint.friction);
  const tp = padsFromPaint(tsurface, tpaint.pressure, tpaint.friction);
  const snap = { paint: { pressure: paint.pressure.slice(), friction: paint.friction.slice() }, trigger: { pressure: tpaint.pressure.slice() }, press: { ...press } };
  const totals = paintTotals(surface, paint.pressure), ttotals = triggerTotals(tsurface, tpaint.pressure);
  const how = {
    trigger: { style: press.style, speed: press.speed, pads: tp.pads },
    string: { shots: +$('nshots').value, split: +$('split').value },
    hands: mostSqueeze(),
  };
  leaveReplay();
  $('banner').hidden = true;
  $('fire').disabled = true;
  cover.show(pads.n ? 'Getting the processor threads ready' : 'Nothing is painted on the grip: the gun just falls', null);
  try {
    const many = how.string.shots > 1;
    const out = await shooter.fire(pads, $('ammo').value, how, (share, phase) =>
      cover.show(phase === 'settle' ? 'The grip takes hold' : phase === 'press' ? 'The finger presses the trigger' : phase === 'shot' ? (many ? `The string of ${how.string.shots} shots` : 'The shot') : 'Done', share));
    const shot = { n: shots.length + 1, ammo: $('ammo').value, ...snap, totals, ttotals, index, tindex: tp.index, out, hands, string: how.string };
    shots.push(shot);
    show(shot);
    setStep('shot');
  } catch (e) {
    alert(`The shot could not be worked out: ${e.message}`);
  } finally {
    cover.hide();
    $('fire').disabled = false;
  }
}

function show(shot) {
  current = shot;
  const o = shot.out, s = o.shot, prev = shots.slice(0, shots.indexOf(shot)).reverse().find((x) => x.out.shot) || null;
  $('no-shot').hidden = true; $('result').hidden = false; $('shots-block').hidden = false;
  $('result-title').textContent = shot.string && shot.string.shots > 1 ? `Fire ${shot.n}: a string of ${shot.string.shots}` : `Shot ${shot.n}`;
  $('r-stale').hidden = sameAs(shot);
  const nh = $('r-notheld');
  $('banner').hidden = !!s;
  if (!s) $('banner').innerHTML = !o.settle.held ? '<b>No shot</b>: the grip did not hold the gun. The replay shows it falling.'
    : `<b>No shot</b>: the trigger did not break. The finger reached ${lb(o.press.faceForce)} at its face; it needs ${lb(BREAK)}. Paint more, or lower, on the trigger in step 2.`;
  if (!o.settle.held || !s) {
    nh.hidden = false;
    nh.innerHTML = !o.settle.held
      ? `<b>The grip did not hold the gun</b>, so it was not fired. While the paint took hold, the gun moved ${inch(o.settle.shift, 1)} and turned ` +
        `${f(o.settle.turn, 0)}° (it holds when it moves under ${inch(o.settle.rule.move, 1)} and ${o.settle.rule.turn}° and has stopped). ` +
        'Paint both sides of the grip, press harder, or raise the friction. The replay shows it.'
      : `<b>The trigger did not break</b>, so the gun did not fire. At full press the finger's paint turns the trigger as hard as ` +
        `${lb(o.press.faceForce)} at its face; it breaks at ${lb(BREAK)}. Press harder in step 2, or paint lower on the trigger.`;
    $('r-body').hidden = true;
  } else {
    nh.hidden = true; $('r-body').hidden = false;
    const p = prev ? prev.out.shot : null;
    const row = (k, v, cls = '', dd = '<span></span>') => `<span class="k">${k}</span><span class="v ${cls}">${v}</span>${dd}`;
    const d = (now, was, digits, unit) => {
      if (was === null || was === undefined) return '<span></span>';
      const delta = now - was;
      if (Math.abs(delta) < Math.pow(10, -digits) / 2) return '<span class="d">same</span>';
      return `<span class="d ${delta < 0 ? 'better' : 'worse'}">${delta > 0 ? '+' : ''}${f(delta, digits)}</span>`;
    };
    const side = (v, d = 2) => `${f(Math.abs(v), d)}° ${Math.abs(v) < Math.pow(10, -d) / 2 ? '' : v > 0 ? 'right' : 'left'}`;
    $('r-stats').innerHTML = (prev ? `<span></span><span></span><span class="kh">vs shot ${prev.n}</span>` : '') + [
      row(`Rise <small>at ${f(s.tRise, 0)} ms</small>`, `${f(s.rise, 2)}°`, 'angle', d(s.rise, p && p.rise, 2)),
      row('Pushed back', inch(s.back), 'angle', d(toIn(s.back), p && toIn(p.back), 2)),
      row('Sideways', side(s.side), 'angle', d(Math.abs(s.side), p && Math.abs(p.side), 2)),
      row('Top rolled', side(s.roll), 'angle'),
      row('Skin shifted', inch(s.slid, 3), 'slip', d(toIn(s.slid), p && toIn(p.slid), 3)),
      row('Hold, hardest', lb(s.pushPeak, 0), 'force'),
      row('Hold, settled', lb(o.settle.push, 0)),
    ].join('');
    INFO.move = '<p><b>Rise, pushed back, sideways</b>: how the muzzle moved from where it was at the shot; the rise at its peak, and when. <b>Top rolled</b>: which way the top of the gun turned about the bore.</p>' +
      '<p><b>Skin shifted</b>: where the skin ended up on the gun, averaged by how hard each spot pressed. <b>Hold</b>: all the grip\'s pushes added up, at their hardest in the shot, and as the gun settled before it.</p>' +
      (prev ? `<p>The last column compares with shot ${prev.n}, in the same units: green is less, red more.</p>` : '') +
      '<p>No wrists or arms are simulated: the paint presses from a support that does not move. Real wrists and arms give, so a real gun rises more.</p>';
    const pr = o.press;
    const turnWords = (pitch, yaw) => [Math.abs(pitch) >= 0.0005 ? `${f(Math.abs(pitch), 3)}° ${pitch > 0 ? 'up' : 'down'}` : '', Math.abs(yaw) >= 0.0005 ? `${f(Math.abs(yaw), 3)}° ${yaw > 0 ? 'right' : 'left'}` : ''].filter(Boolean).join(', ') || 'not at all';
    const two = (a, b) => [a, b].filter(Boolean).join('<br>') || 'not at all';
    const dir = (v, d, unit, pos, neg) => (Math.abs(v) >= Math.pow(10, -d) / 2 ? `${f(Math.abs(v), d)}${unit} ${v > 0 ? pos : neg}` : '');
    const pair = (k, v, cls = '') => `<span class="k">${k}</span><span class="v ${cls}">${v}</span>`;
    $('press-note').innerHTML = (pr ? [
      pair('Press to break', `${f(pr.time - 2.5, 0)} ms`),
      pair('Break <small>at the face</small>', lb(BREAK)),
      pair('Full press', lb(pr.faceForce)),
      pair('Muzzle turned <small>by the press</small>', two(dir(pr.pitch, 3, '°', 'up', 'down'), dir(pr.yaw, 3, '°', 'right', 'left')), 'angle'),
    ] : [pair('Trigger', 'not pressed')]).join('') +
      pair('Bullet left the barrel', `${f(o.exit.t, 2)} ms`) +
      pair('Muzzle moving <small>ft/s</small>', two(dir(toFps(o.exit.across[1]), 2, '', 'up', 'down'), dir(toFps(o.exit.across[2]), 2, '', 'right', 'left')), 'angle');
    INFO['shot-trigger'] = (pr
      ? `<p>The trigger (${PRESS_STYLES[pr.style].name.toLowerCase()}) broke <b>${f(pr.time - 2.5, 0)} ms</b> into the press, at <b>${lb(BREAK)}</b> at its face (the full press: ${lb(pr.faceForce)}). Before the shot went off, the press had turned the muzzle <b>${turnWords(pr.pitch, pr.yaw)}</b>: the finger's pushes go into the gun where they are painted.</p>`
      : '<p>No trigger press: the shot went off where the gun settled.</p>') +
      `<p>The bullet left <b>${f(o.exit.t, 2)} ms</b> after the shot, the muzzle already moving ${fps(o.exit.across[1], 2)} up and ${fps(o.exit.across[2], 2)} right; that motion goes with the bullet. Its spin from the barrel's twist rolled the gun's top to the left.</p>`;
    const pkRegion = s.pressurePeakAt >= 0 ? REGIONS[surface.region[shot.index[s.pressurePeakAt]]] : '-';
    const home = s.cycle !== null && !s.stovepipe;
    $('r-cycle').innerHTML = pair('Went back', inch(s.slideMax), s.stovepipe ? 'warn' : '') +
      pair('Fastest', fps(s.slideSpeed, 1)) +
      pair('Home again', s.stovepipe ? 'jammed' : home ? `${f(s.cycle, 0)} ms` : 'not by 250 ms', home ? '' : 'warn') +
      (home ? pair('Next round', s.chambered ? 'in' : 'not in', s.chambered ? '' : 'warn') : '') +
      pair(`Hardest press <small>${pkRegion}</small>`, psi(s.pressurePeak, 0), 'force') +
      (o.note ? `<span class="k warn">${o.note}</span><span></span>` : '');
    INFO.slide = (s.stovepipe ? `<p><b>The slide only went back ${inch(s.slideMax)}</b>: too little to throw out the empty case (a jam).</p>`
      : s.cycle === null ? `<p>The slide went back <b>${inch(s.slideMax)}</b> but had not returned by 250 ms.</p>`
      : `<p>The slide went back <b>${inch(s.slideMax)}</b> at up to ${fps(s.slideSpeed, 1)} and was home again at <b>${f(s.cycle, 0)} ms</b>${s.chambered ? ', with the next round in' : ', but without the next round (it did not get behind it)'}.</p>`) +
      `<p>The hardest press on the grip in the shot was <b>${psi(s.pressurePeak, 0)}</b>, on the ${pkRegion}.</p>`;
    $('sv-move').textContent = `${f(s.rise, 2)}° rise`;
    $('sv-trigger').textContent = pr ? `broke ${f(pr.time - 2.5, 0)} ms in` : 'no finger';
    $('sv-slide').textContent = s.stovepipe ? 'jammed' : s.cycle === null ? 'not home' : `home at ${f(s.cycle, 0)} ms`;
    $('sv-slide').classList.toggle('warn', s.stovepipe || s.cycle === null || !s.chambered);
  }
  $('threads').textContent = `${f(o.ms / 1000, 1)} s on ${o.info.threads} thread${o.info.threads > 1 ? 's' : ''}`;
  INFO.threads = `<p>Fire ${shot.n} was worked out in <b>${f(o.ms / 1000, 1)} s</b> on <b>${o.info.threads}</b> processor thread${o.info.threads > 1 ? 's' : ''}` +
    (pool && pool.of ? ` of this computer's ${pool.of}; one is left free for the page.</p>` : '.</p>');
  showString(shot);
  renderShots();
  showHits();
  startReplay(shot);
}

function showString(shot) {
  const o = shot.out, list = o.shots || [], box = $('r-string');
  $('string-sec').hidden = !o.shot || (o.string && o.string.planned < 2);
  if ($('string-sec').hidden) return;
  $('sv-string').textContent = `${list.length} of ${o.string.planned} fired, ${f(o.string.split, 2)} s apart`;
  $('sv-string').classList.toggle('warn', list.length < o.string.planned);
  const D = dist();
  const rows = list.map((s) => `<tr><td>${s.n}</td><td>${f(s.pitch, 2)}°</td><td>${f(s.yaw, 2)}°</td><td>${f(s.rise, 2)}°</td></tr>`).join('');
  const full = list.map((s, j) => {
    const h = s.exit ? impactAt(s.exit, D) : null, gap = j ? s.t - list[j - 1].t : null;
    return `<tr><td>${s.n}</td><td>${j ? f(gap, 0) : '-'}</td><td>${oz(s.mass)}</td><td>${h ? `${f(toIn(h.right), 2)}, ${f(toIn(h.up), 2)}` : '-'}</td></tr>`;
  }).join('');
  const short = list.length < o.string.planned
    ? `<p class="note warn">${list.length} of ${o.string.planned} shots fired: ${(o.events.find((e) => e.type === 'noFire') || {}).note || 'the string stopped'}</p>` : '';
  const tire = o.tiring, gave = tire && tire.gaveAt !== null;
  const tireText = !tire ? '' : gave
    ? `The hands tired: at <b>${f(tire.gaveAt, 0)} ms</b> they could no longer hold the squeeze, and the grip eased to ${f(tire.share * 100, 0)}% of it.`
    : `The hands held the squeeze (<b>${f(tire.load * 100, 0)}%</b> of their strength) throughout, with <b>${f(tire.left * 100, 0)}%</b> of their strength left at the end.`;
  const row = (k, v, cls = '') => `<span class="k">${k}</span><span class="v ${cls}">${v}</span>`;
  box.innerHTML = `${short}<div class="tablewrap"><table class="shots-table"><thead><tr><th>Shot</th><th>Aimed up</th><th>Aimed right</th><th>Rise</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div><div class="kv">` +
    (tire ? row('The hands', gave ? `gave way at ${f(tire.gaveAt, 0)} ms` : `held, ${f(tire.left * 100, 0)}% left`, gave ? 'warn' : '') : '') +
    row('Skin slid <small>over the string</small>', inch(o.shot.slid, 3), 'slip') + '</div>';
  INFO.string = '<p>Each shot after the first fires from wherever the gun was: nothing re-aims it, and it has not come back to the aim on its own. ' +
    `<b>Aimed up</b> and <b>aimed right</b>: where the bore pointed as each shot fired, from the first aim (a minus is down or left). The gun is a round lighter after each.</p><p>${tireText} ` +
    `The skin slid <b>${inch(o.shot.slid, 3)}</b> over the string, averaged by push.</p>` +
    `<div class="tablewrap"><table class="shots-table"><thead><tr><th>Shot</th><th>After, ms</th><th>Gun</th><th>Hole, in (right, high)</th></tr></thead><tbody>${full}</tbody></table></div>`;
}

function renderShots() {
  $('shots').innerHTML = shots.map((sh) => {
    const s = sh.out.shot, hs = hitsOf(sh, dist());
    const what = !s ? `<span class="hint">${sh.out.settle.held ? 'no break' : 'not held'}</span>`
      : hs.length > 1 ? `<span class="rise">${hs.length} shots · ${inch(groupOf(hs).spread, 1)} group</span>`
      : `<span class="rise">${inch(Math.hypot(hs[0].right, hs[0].up), 1)} · ${f(s.rise, 2)}°</span>`;
    return `<li><button data-n="${sh.n}" aria-current="${sh === current}"><span class="n">${sh.n}</span>` +
      `<span class="sum">${lb(sh.totals.force / 2, 0)} squeeze · ${lb(sh.ttotals.faceForce)} finger · ${sh.press.style}</span>${what}</button></li>`;
  }).reverse().join('');
  for (const b of $('shots').querySelectorAll('button')) b.addEventListener('click', () => show(shots[+b.dataset.n - 1]));
  $('load-paint').disabled = !current;
  $('sv-shots').textContent = `${shots.length} fired`;
}
$('load-paint').addEventListener('click', () => {
  if (!current) return;
  change(() => useGrip(current));
  $('press').value = press.style; $('press-time').value = press.speed; pressOuts();
});

const chartChoice = { q: 'rise' };
const CHARTS = {
  rise: { label: 'Muzzle rise', unit: 'deg', col: 10, color: 'angle' },
  side: { label: 'Muzzle sideways', unit: 'deg', col: 11, color: 'angle' },
  back: { label: 'Muzzle pushed back', unit: 'in', col: 13, sign: -1, to: toIn, color: 'angle' },
  hold: { label: 'Hold, all spots', unit: 'lb', col: 16, to: toLb, color: 'force' },
  slide: { label: 'Slide back', unit: 'in', col: 8, to: toIn, color: 'slide' },
  trigger: { label: 'Finger, at the face', unit: 'lb', col: 18, to: toLb, color: 'finger' },
};
const msOf = (o, k) => (o.frames[k * o.frameWidth] - (o.settle.held ? 0 : o.frames[0])) * 1000;
function seriesOf(shot, q, color, width) {
  const o = shot.out, W = o.frameWidth, c = CHARTS[q];
  const from = o.settle.held ? o.settleFrames : 0;
  const t = [], v = [];
  const to = c.to || ((x) => x);
  for (let k = from; k < o.nFrames; k++) { t.push(msOf(o, k)); v.push(to(o.frames[k * W + c.col] * (c.sign || 1))); }
  return { t, v, color, width };
}
const replayMs = () => (replay ? msOf(replay.shot.out, replay.from) + replay.tMs : null);
function drawShotChart(playMs = null) {
  if (!current || $('result').hidden || ui.step !== 'shot' || !$('chart').clientWidth) return;
  const series = [];
  const prev = shots.slice(0, shots.indexOf(current)).reverse().find((x) => x.out.shot);
  const now = colour(CHARTS[chartChoice.q].color), before = colour('prev');
  if (prev && current.out.shot) series.push(seriesOf(prev, chartChoice.q, before, 1.2));
  series.push(seriesOf(current, chartChoice.q, now, 2));
  const tMax = Math.max(...series.map((s) => s.t[s.t.length - 1] || 1));
  const tMin = Math.min(...series.map((s) => s.t[0] || 0));
  drawChart($('chart'), { series, tMin, tMax, unit: CHARTS[chartChoice.q].unit, label: CHARTS[chartChoice.q].label, playhead: playMs });
  $('chart-key').innerHTML = `<span><i style="background:${now}"></i>shot ${current.n}</span>` +
    (series.length > 1 ? `<span><i style="background:${before}"></i>shot ${prev.n}</span>` : '');
}
$('chart-q').innerHTML = Object.entries(CHARTS).map(([k, c]) => `<option value="${k}">${c.label}, ${c.unit}</option>`).join('');
$('chart-q').addEventListener('change', () => { chartChoice.q = $('chart-q').value; drawShotChart(replayMs()); });
INFO.time = '<p>The number picked above, through the shot: time across in ms from the shot (the press before it is negative), the number up. ' +
  'The coloured line is the Fire on show, the grey one the shot before it; the white line is where the replay is.</p>';

const pFrame = new Float32Array(surface.n), slideFrame = new Float32Array(surface.n), tFrame = new Float32Array(tsurface.n);
function startReplay(shot) {
  const o = shot.out;
  const from = o.settle.held ? o.settleFrames : 0;
  const t0 = o.frames[from * o.frameWidth], t1 = o.frames[(o.nFrames - 1) * o.frameWidth];
  const start = o.settle.held ? Math.max(0, (-0.04 - t0) * 1000) : 0;
  replay = { shot, from, t0, t1, start, tMs: start, playing: true, last: performance.now(), frame: -1 };
  for (const id of ['play', 'scrub', 'video']) $(id).disabled = false;
  $('hint').classList.add('faded');
  view.setAim(o.settle.held ? o.frames.subarray(o.settleFrames * o.frameWidth, (o.settleFrames + 1) * o.frameWidth) : null);
  $('play').textContent = 'Pause';
  const marks = [];
  const at = (t) => (100 * (t - t0)) / (t1 - t0);
  for (const e of o.events) {
    const name = { press: 'press', break: 'break', shot: 'shot', battery: 'slide home', noBreak: 'no break' }[e.type];
    if (name && e.t >= t0 - 1e-6 && e.t <= t1) marks.push(`<i class="${e.type}" style="left:${at(e.t).toFixed(2)}%"><b>${name}</b></i>`);
  }
  $('marks').innerHTML = marks.join('');
  spaceMarks();
  if (o.shots && o.shots.length > 1 && +$('speed').value < 0.1) $('speed').value = '0.1';
  const W = o.frameWidth, n = o.nFrames - from, pts = new Float32Array(n * 3), M = new THREE.Vector3(), Q = new THREE.Quaternion();
  for (let k = 0; k < n; k++) {
    const r = o.frames.subarray((from + k) * W, (from + k + 1) * W);
    M.set(MUZZLE_X, 0, 0).applyQuaternion(Q.set(r[5], r[6], r[7], r[4]));
    pts[k * 3] = r[1] + M.x; pts[k * 3 + 1] = r[2] + M.y; pts[k * 3 + 2] = r[3] + M.z;
  }
  notes.setTrail(pts);
  drawLegend();
  view.animate(tick);
}
function spaceMarks() {
  const names = [...$('marks').querySelectorAll('b')];
  names.sort((a, b) => (b.parentElement.classList.contains('shot') ? 1 : 0) - (a.parentElement.classList.contains('shot') ? 1 : 0));
  const kept = [];
  for (const b of names) {
    b.style.visibility = '';
    const r = b.getBoundingClientRect();
    if (kept.some((k) => r.left < k.right + 4 && r.right + 4 > k.left)) b.style.visibility = 'hidden'; else kept.push(r);
  }
}
function frameAt(o, t) {
  let lo = replay.from, hi = o.nFrames - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (o.frames[m * o.frameWidth] <= t) lo = m; else hi = m - 1; }
  return lo;
}
function tick() {
  if (!replay) return;
  const sh = replay.shot, o = sh.out, now = performance.now();
  const span = replay.t1 - replay.t0;
  if (replay.playing) {
    replay.tMs += (now - replay.last) * +$('speed').value;
    if (replay.tMs > span * 1000) replay.tMs = 0;
  }
  replay.last = now;
  const tNow = replay.t0 + replay.tMs / 1000;
  const fired = firedOf(sh);
  if (fired.length) {
    let landed = 0, flying = -1, share = 0;
    fired.forEach((s, j) => {
      const since = tNow - s.exit.t / 1000, time = impactAt(s.exit, dist()).time;
      if (since >= time) landed++;
      else if (since >= 0) { flying = j; share = since / time; }
    });
    if (landed !== arrived) { arrived = landed; showHits(); }
    const s = fired[flying >= 0 ? flying : Math.max(0, landed - 1)];
    view.target.setPath(s.exit.muzzle.map((x) => x * 1000), impactAt(s.exit, dist()));
    view.target.setBullet(flying >= 0 ? share : null);
    notes.setBullet(flying >= 0 ? view.target.fromAim(s.exit.muzzle[0] * 1000 + share * (dist() * 1000 - s.exit.muzzle[0] * 1000), 0, 0) : null,
      `bullet ${fired.length > 1 ? flying + 1 + ' ' : ''}${fps(s.exit.speed)}`);
    view.draw();
  }
  const k = frameAt(o, tNow);
  if (k !== replay.frame) {
    replay.frame = k;
    const W = o.frameWidth, row = o.frames.subarray(k * W, (k + 1) * W);
    view.poseFromFrame(row);
    pFrame.fill(0); slideFrame.fill(0);
    const N = o.nSpots, idx = sh.index;
    let peak = 0, peakAt = -1;
    for (let i = 0; i < N; i++) {
      const q = o.spots[o.spotRow[k] * N + i], p = (q & 32767) / 100;
      pFrame[idx[i]] = p; slideFrame[idx[i]] = q & 32768 ? 1 : 0;
      if (p > peak) { peak = p; peakAt = idx[i]; }
    }
    heat.setAll(pFrame, sh.paint.friction, slideFrame);
    const faceFull = o.press ? o.press.faceForce : 0, share = faceFull > 0 ? row[18] / faceFull : 0;
    for (let i = 0; i < tsurface.n; i++) tFrame[i] = sh.trigger.pressure[i] * share;
    theat.setAll(tFrame, tShade);
    notes.setGrip(regionPushes(surface, pFrame));
    notes.setFinger(share > 0 ? fingerArrow(sh.trigger.pressure, share) : null);
    const ms = msOf(o, k);
    notes.setPeak(peakAt >= 0 && ms >= 0 ? [surface.pos[peakAt * 3], surface.pos[peakAt * 3 + 1], surface.pos[peakAt * 3 + 2]] : null, `hardest ${psi(peak, 0)}`);
    $('time').textContent = !o.settle.held ? `settling ${f(ms, 1)} ms` : ms < -0.05 ? `${f(-ms, 1)} ms before the shot` : `${f(ms, 1)} ms after`;
    $('scrub').value = Math.round((1000 * replay.tMs) / (span * 1000));
    const el = $('readout'); el.hidden = false;
    el.innerHTML = o.settle.held ? `hold <b>${lb(row[16], 0)}</b> &middot; trigger <b>${inch(row[17])}</b>` : `gun moved <b>${inch(Math.hypot(row[1], row[2], row[3]), 1)}</b>`;
    notes.setGauges({
      squeeze: { share: row[16] / 2 / mostSqueeze(), text: lb(row[16] / 2, 0) },
      trigger: { share: row[18] / (2 * BREAK), mark: 0.5, text: lb(row[18]) },
      slide: { share: row[8] / SLIDE_TRAVEL, text: inch(row[8]) },
      muzzle: { share: Math.max(0, row[10]) / RISE_SCALE, text: `${f(row[10], 2)}° up, ${f(row[11], 2)}° right` },
    });
    notes.trailTo(k - replay.from + 1);
    drawShotChart(o.settle.held ? ms : null);
  }
}
function leaveReplay() {
  if (!replay) return;
  replay = null;
  view.animate(null);
  view.poseRest();
  view.setAim(null);
  view.target.setBullet(null);
  heat.setAll(paint.pressure, paint.friction); theat.setAll(tpaint.pressure, tShade);
  notes.setPeak(null); notes.setBullet(null); notes.setTrail(null);
  updateGrip(); updateTrigger();
  $('readout').hidden = true; $('play').textContent = 'Play';
  if (arrived !== Infinity) { arrived = Infinity; showHits(); }
  drawLegend();
  drawShotChart(null);
}
$('play').addEventListener('click', () => {
  if (!replay) { if (current) startReplay(current); return; }
  replay.playing = !replay.playing; replay.last = performance.now();
  $('play').textContent = replay.playing ? 'Pause' : 'Play';
});
$('scrub').addEventListener('input', () => {
  if (!replay) return;
  replay.playing = false; $('play').textContent = 'Play';
  replay.tMs = (+$('scrub').value / 1000) * (replay.t1 - replay.t0) * 1000;
});

const SPEED_WORDS = { 0.01: '1/100 speed', 0.025: '1/40 speed', 0.1: '1/10 speed', 1: 'real time' };
const film = { busy: false, cancel: false, msPerFrame: null };
function filmPlan(sizeKey, speed) {
  const size = SIZES[sizeKey], step = (1000 / FPS) * speed;
  const r = replay || { start: 0, t0: 0, t1: 0 };
  const end = (r.t1 - r.t0) * 1000, moving = Math.max(1, Math.floor((end - r.start) / step) + 1);
  return { size, speed, step, end, moving, count: moving + FPS };
}
function clockWords() {
  const o = replay.shot.out, ms = replayMs(), n = firedOf(replay.shot).length;
  const when = !o.settle.held ? `settling, ${f(ms, 1)} ms` : ms < -0.05 ? `<b>${f(-ms, 1)} ms</b> before the shot` : `<b>${f(ms, 1)} ms</b> after ${n > 1 ? 'the first shot' : 'the shot'}`;
  return `${when} &middot; ${SPEED_WORDS[film.speed]}`;
}
async function filmReplay(opts, progress = () => {}) {
  if (film.busy) throw new Error('a video is already being made');
  if (!replay) { if (!current) throw new Error('fire first: there is no replay to film'); startReplay(current); }
  const plan = filmPlan(opts.size, opts.speed), { size } = plan;
  film.busy = true; film.cancel = false; film.speed = opts.speed;
  const was = { playing: replay.playing, tMs: replay.tMs, legend: $('legend').hidden, scope: $('scope').hidden };
  replay.playing = false;
  const stage = $('stage');
  document.body.classList.add('filming');
  Object.assign(stage.style, { width: `${size.width / size.scale}px`, height: `${size.height / size.scale}px` });
  $('scope').hidden = !opts.target;
  $('legend').hidden = was.legend || !opts.key;
  notes.setShown(!!opts.numbers);
  $('clock').hidden = false;
  view.setPixelRatio(size.scale); scope.setPixelRatio(size.scale); scope.fit();
  const canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const g = canvas.getContext('2d');
  try {
    const out = await encode({
      canvas, size, count: plan.count, cancelled: () => film.cancel, progress,
      frame: (j) => {
        replay.tMs = Math.min(plan.end, replay.start + Math.min(j, plan.moving - 1) * plan.step);
        tick();
        $('clock').innerHTML = clockWords();
        view.renderNow();
        paintStage(g, stage, $('view'), size.scale);
      },
    });
    if (out) { out.frames = plan.count; film.msPerFrame = out.ms / plan.count; }
    return out;
  } finally {
    document.body.classList.remove('filming');
    stage.style.width = stage.style.height = '';
    $('scope').hidden = was.scope; $('legend').hidden = was.legend; $('clock').hidden = true;
    notes.setShown($('show-data').checked);
    view.setPixelRatio(Math.min(window.devicePixelRatio, 2)); scope.setPixelRatio(null); scope.fit();
    replay.tMs = was.tMs; replay.playing = was.playing; replay.last = performance.now(); replay.frame = -1;
    view.renderNow();
    film.busy = false;
  }
}
const MB = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
function filmAbout() {
  const p = filmPlan($('video-size').value, +$('video-speed').value);
  const secs = p.count / FPS, ms = film.msPerFrame || (p.size.scale > 1 ? 45 : 30);
  const make = Math.max(1, Math.round((p.count * ms) / 1000));
  $('video-about').textContent = `About ${secs.toFixed(1)} s of video (${p.count} frames, ${FPS} a second, the last second held), ` +
    `about ${MB((p.size.bitrate / 8) * secs)}. Making it takes about ${make} s${film.msPerFrame ? '' : ' (a guess until one has been made)'}.`;
}
function openFilm() {
  if (!canMakeVideo()) {
    $('video-err').hidden = false;
    $('video-err').textContent = 'This browser has no video encoder (WebCodecs), so it cannot make an MP4. Chrome or Edge can.';
    $('video-go').disabled = true;
  }
  $('video-speed').value = $('speed').value;
  $('video-numbers').checked = $('show-data').checked;
  $('video-opts').hidden = false; $('video-run').hidden = true;
  $('video-cancel').textContent = 'Cancel';
  filmAbout();
  $('video-dlg').hidden = false;
  $('video-go').focus();
}
$('video').addEventListener('click', () => { if (current || replay) openFilm(); });
for (const id of ['video-size', 'video-speed']) $(id).addEventListener('change', filmAbout);
$('video-cancel').addEventListener('click', () => { if (film.busy) film.cancel = true; else $('video-dlg').hidden = true; });
$('video-go').addEventListener('click', async () => {
  const opts = { size: $('video-size').value, speed: +$('video-speed').value, numbers: $('video-numbers').checked, target: $('video-target').checked, key: $('video-key').checked };
  $('video-opts').hidden = true; $('video-run').hidden = false; $('video-err').hidden = true; $('video-go').disabled = true;
  $('video-bar').style.width = '0%';
  const sh = (replay && replay.shot) || current;
  try {
    const out = await filmReplay(opts, (d, n, ms) => {
      $('video-bar').style.width = `${((100 * d) / n).toFixed(1)}%`;
      const left = d > 4 ? Math.round(((n - d) * ms) / d / 1000) : null;
      $('video-pct').textContent = `frame ${d} of ${n}${left !== null ? `, about ${left} s to go` : ''}`;
    });
    $('video-opts').hidden = false; $('video-run').hidden = true;
    if (!out) { $('video-about').textContent = 'Stopped: no video saved.'; return; }
    const name = `griplock-fire-${sh.n}-${new Date().toISOString().slice(0, 10)}.mp4`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.bytes], { type: 'video/mp4' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    $('video-about').textContent = `Saved to your downloads as ${name}: ${MB(out.bytes.byteLength)}, ${(out.frames / FPS).toFixed(1)} s of video, ` +
      `made in ${(out.ms / 1000).toFixed(1)} s (each picture drawn here and encoded by the browser's own H.264 encoder).`;
    $('video-cancel').textContent = 'Close';
  } catch (e) {
    $('video-opts').hidden = false; $('video-run').hidden = true;
    $('video-err').hidden = false; $('video-err').textContent = `No video: ${e.message}`;
  } finally { $('video-go').disabled = !canMakeVideo(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('video-dlg').hidden) $('video-cancel').click(); });

const menu = $('grips-pop');
$('grips-btn').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; $('grips-btn').setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', (e) => { if (!menu.hidden && !$('grips-menu').contains(e.target)) { menu.hidden = true; $('grips-btn').setAttribute('aria-expanded', 'false'); } });
function listSaved() {
  const all = store.listSaved();
  $('saved').innerHTML = all.length ? all.map((g) => `<option>${g.name.replace(/</g, '&lt;')}</option>`).join('') : '<option value="">No saved grips yet</option>';
  $('open-saved').disabled = $('delete-saved').disabled = !all.length;
}
listSaved();
const openGrip = (obj, label) => {
  try {
    const g = store.decode(obj, sigs);
    change(() => useGrip(g));
    $('press').value = press.style; $('press-time').value = press.speed; pressOuts();
  } catch (e) { alert(`Could not open ${label}: ${e.message}`); }
};
$('save').addEventListener('click', () => {
  const name = (prompt('Name for this grip:', `Grip ${store.listSaved().length + 1}`) || '').trim();
  if (!name) return;
  if (!store.saveNamed(grip(), sigs, name)) alert('This browser would not save it (storage is full or blocked). Use "Download file" instead.');
  listSaved(); $('saved').value = name;
});
$('open-saved').addEventListener('click', () => { const g = store.listSaved().find((x) => x.name === $('saved').value); if (g) openGrip(g, `"${g.name}"`); });
$('delete-saved').addEventListener('click', () => { const name = $('saved').value; if (name && confirm(`Delete the saved grip "${name}"?`)) { store.deleteNamed(name); listSaved(); } });
$('download').addEventListener('click', () => store.download(grip(), sigs, $('saved').value || 'grip'));
$('upload').addEventListener('click', () => $('upload-file').click());
$('upload-file').addEventListener('change', async () => {
  const file = $('upload-file').files[0];
  $('upload-file').value = '';
  if (file) openGrip(JSON.parse(await file.text()), `"${file.name}"`);
});

for (const b of $('views').querySelectorAll('button')) b.addEventListener('click', () => view.setView(b.dataset.view));
$('show-data').addEventListener('change', () => notes.setShown($('show-data').checked));

const HELP = {
  grip: `Press adds pressure where you paint. The brush is soft: strongest in the middle, fading to nothing at its edge. Going over a spot again, or resting on it, presses it harder - like a heat map.\n\nLighten takes pressure away; Smooth evens it out; Friction paints how grippy the skin is (everywhere starts at ${DEFAULT_FRICTION}, dry hands on the textured grip).\n\nEach painted spot pushes straight into the gun's surface. In the shot, a spot the gun presses into pushes back harder, like flesh squashing; one it pulls away from pushes less, and nothing once the gun leaves it. Sideways, the skin holds by friction until the gun pulls harder than friction x push, then slides.\n\nSqueeze: the paint's pushes added up, halved (a squeeze presses two opposite sides of the grip, as a grip-strength meter's two handles). The brush stops at what the chosen hands can do: both hands' measured grip strength together.\n\nThe arrows on the gun show the push of each area, added up; the three biggest have their number.`,
  trigger: `Paint where the finger touches the trigger and how hard it presses at full press, with the same brush. Then choose how the finger gets there: a smooth press, slack first then a press, or a slap, and how long it takes.\n\nThe trigger turns about its pin against its spring. Each painted spot pulls it straight back, as far as the skin's grip on the trigger allows (where the face curves away, friction carries the rest). What breaks it is how hard the paint TURNS it: paint low on the trigger has a longer lever, so it breaks it with less; paint on the trigger's sides turns it less and pushes the gun sideways. "Where it turns" colours the trigger by this. It breaks at ${lb(BREAK)} at its face (the measured pull of a stock Gen5); paint that cannot reach that does not fire the gun.\n\nEvery push the finger makes goes into the gun where it is painted, so the gun moves a little while the finger presses - and that moves where the shot lands.\n\nThe finger's pushes added up stop at what an index finger can pull a trigger with its pad (about ${lb(val(STRENGTH.man.finger), 0)} for an average man, measured).`,
  result: `Landed: where the bullet hit the target, against where an undisturbed shot lands (the sights are set for the target's distance). It comes from where the muzzle pointed and how it was moving as the bullet left, half a millisecond after the shot.\n\nMuzzle rise, pushed back, sideways, roll: how the gun moved from where it was at the shot.\n\nSkin shifted: where the skin ended up on the gun, averaged by how hard each spot pressed. Hold at its hardest: all the grip's pushes at their peak.\n\nThe replay shows it all slowed down, with the numbers on the gun: each area's push, the finger's push, the slide's travel, the muzzle's turn, the hardest-pressed spot, the bullet in flight. The blue line is where the bore points; the white line where it pointed before the press.\n\nA string (more than 1 shot, beside Fire): after each shot the finger lets the trigger out to its reset and presses again, timed for the spacing you set. Each shot fires from wherever the last one left the gun; the gun is a round (about ${oz(val(AMMO['124'].cartridgeMass), 2)}) lighter after each; the hands tire as they hold the squeeze (by a fatigue law fitted to measured endurance: a squeeze under half their strength holds for minutes).\n\nNo arms or hands are simulated: the paint presses from a support that does not move, and no one re-aims between shots. Real wrists and arms give, so a real gun rises more.`,
};
let pinned = null, pop = null, hideTimer = null;
function openHelp(btn, pin) {
  clearTimeout(hideTimer);
  if (!pop) { pop = document.createElement('div'); pop.className = 'helppop'; pop.setAttribute('role', 'tooltip'); document.body.appendChild(pop); pop.addEventListener('mouseenter', () => clearTimeout(hideTimer)); pop.addEventListener('mouseleave', () => { if (!pinned) hideHelp(); }); }
  if (btn.dataset.info) { pop.innerHTML = INFO[btn.dataset.info] || '<p>Nothing to explain yet.</p>'; pop.classList.add('rich'); }
  else { pop.textContent = HELP[btn.dataset.help]; pop.classList.remove('rich'); }
  for (const b of document.querySelectorAll('.help[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-expanded', 'true');
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = Math.min(340, window.innerWidth - 24);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w))}px`;
  const h = pop.offsetHeight, below = r.bottom + 6 + h <= window.innerHeight - 8;
  pop.style.top = `${window.scrollY + (below ? r.bottom + 6 : Math.max(8, r.top - 6 - h))}px`;
  if (pin) pinned = btn;
}
function hideHelp() {
  if (pop) pop.hidden = true;
  pinned = null;
  for (const b of document.querySelectorAll('.help[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
}
for (const b of document.querySelectorAll('.help')) {
  b.addEventListener('mouseenter', () => { if (!pinned) openHelp(b, false); });
  b.addEventListener('mouseleave', () => { if (!pinned) hideTimer = setTimeout(hideHelp, 150); });
  b.addEventListener('focus', () => { if (!pinned) openHelp(b, false); });
  b.addEventListener('blur', () => { if (!pinned) hideTimer = setTimeout(hideHelp, 150); });
  b.addEventListener('click', (e) => { e.stopPropagation(); if (pinned === b) hideHelp(); else openHelp(b, true); });
}
document.addEventListener('click', (e) => { if (pinned && pop && !pop.contains(e.target)) hideHelp(); });

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input[type="text"], textarea')) return;
  if (e.key === 'Escape') { hideHelp(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? tool.redo() : tool.undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); tool.redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '[' || e.key === ']') {
    const r = $(ui.step === 'trigger' ? 't-radius' : 'g-radius');
    r.value = +r.value + (e.key === ']' ? 1 : -1) * (ui.step === 'trigger' ? 0.25 : 1); outs(); tool.ring(null);
  }
  if (e.key === ' ' && replay && e.target === document.body) { e.preventDefault(); $('play').click(); }
});

$('stage').addEventListener('pointermove', (e) => {
  const r = $('stage').getBoundingClientRect();
  $('hint').classList.toggle('faded', !!replay && r.bottom - e.clientY > 120);
}, { passive: true });
window.addEventListener('resize', () => { if (current) drawShotChart(replayMs()); spaceMarks(); });

setStep('grip'); setTool('push'); setShow('pressure'); pressOuts();
updateGrip(); updateTrigger();
$('undo').disabled = true; $('redo').disabled = true;
cover.hide();
app.ready = true;
onRecolour(() => { drawLegend(); drawShotChart(replayMs()); showHits(); scope.draw(); view.draw(); });
Object.assign(app, { surface, tsurface, paint, tpaint, press, heat, theat, view, notes, scope, shots, fire, show, startReplay, leaveReplay, setShow, setStep, tick, filmReplay, recolour });
if (DEMO) {
  $('nshots').value = 3; stringOuts();
  app.demo = fire().then(() => {
    if (!replay) return;
    const s2 = replay.shot.out.shots[1];
    replay.playing = false; $('play').textContent = 'Play';
    replay.tMs = (s2 ? s2.t / 1000 + 0.012 - replay.t0 : 0.012 - replay.t0) * 1000;
    tick(); view.renderNow();
  });
}
Object.defineProperty(app, 'current', { get: () => current });
Object.defineProperty(app, 'replay', { get: () => replay });
