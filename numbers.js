
import * as gun from './data/glock17.js';
import * as ammo from './data/ammo.js';
import * as skin from './data/skin.js';
import * as trigger from './data/trigger.js';
import * as target from './data/target.js';
import { SOURCES, KIND_LABEL } from './data/sources.js';
import { LBF, YARD, OUNCE } from './ui/units.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const isRecord = (o) => o && typeof o === 'object' && 'v' in o && 'kind' in o && 'src' in o;

function records(obj, path = [], out = [], seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return out;
  seen.add(obj);
  if (isRecord(obj)) { out.push({ path: path.join(' / '), r: obj }); return out; }
  for (const [k, v] of Object.entries(obj)) records(v, [...path, k], out, seen);
  return out;
}
const US = {
  N: (v) => `${(v / LBF).toPrecision(3)} lb`, Pa: (v) => `${(v / 6894.757293).toPrecision(3)} psi`,
  m: (v) => (v >= 1 ? `${(v / YARD).toPrecision(3)} yd` : `${(v / 0.0254).toPrecision(3)} in`), mm: (v) => `${(v / 25.4).toPrecision(3)} in`,
  kg: (v) => (v < 0.02 ? `${(v / 0.00006479891).toPrecision(4)} gr` : `${((v * 1000) / OUNCE).toPrecision(3)} oz`),
  'm/s': (v) => `${(v / 0.3048).toPrecision(4)} ft/s`, 'm per turn': (v) => `${(v / 0.0254).toPrecision(3)} in per turn`,
};
const fmt = (v, unit) => {
  if (typeof v === 'number') {
    const a = Math.abs(v);
    const s = a !== 0 && (a < 0.01 || a >= 1e5) ? v.toExponential(3) : Number(v.toPrecision(4)).toString();
    return `${s} ${unit}` + (US[unit] ? ` <span class="us">(${US[unit](v)})</span>` : '');
  }
  return `${esc(JSON.stringify(v))} ${unit}`;
};

const groups = [
  ['The gun: Glock 17 Gen 5', { spec: gun.GLOCK17.spec }],
  ['The ammunition', { loads: ammo.AMMO, ballistics: ammo.BALLISTICS }],
  ['The painted hold: flesh, friction, grip strength', { flesh: skin.FLESH, friction: skin.FRICTION, sliding: { share: skin.KINETIC_RATIO }, squeeze: skin.SQUEEZE, starting: { squeeze: skin.TYPICAL_SQUEEZE } }],
  ['The hands\' limits: how hard they can squeeze and press, how they tire', { hands: skin.STRENGTH, tiring: skin.FATIGUE }],
  ['The trigger and the finger', { trigger: trigger.GLOCK_TRIGGER, finger: trigger.TRIGGER_FINGER }],
  ['The barrel\'s rifling: the bullet\'s spin', { rifling: trigger.RIFLING }],
  ['The target', { target: target.ISSF_TARGET }],
];
const all = [];
const used = new Set();
$('tables').innerHTML = groups.map(([title, obj]) => {
  const rows = records(obj);
  all.push(...rows);
  return `<h2>${title}</h2><table><thead><tr><th>Number</th><th>Value</th><th>Kind</th><th>Sources and note</th></tr></thead><tbody>` +
    rows.map(({ path, r }) => {
      r.src.forEach((s) => used.add(s));
      const src = r.src.map((s) => (SOURCES[s] ? `<a href="#src-${s}">${esc(SOURCES[s].who)}</a>` : `<span class="kind-estimate">${esc(s)} (missing)</span>`)).join(', ');
      return `<tr><td class="k">${esc(path)}</td><td class="v">${fmt(r.v, esc(r.unit))}</td><td class="kind-${r.kind}">${KIND_LABEL[r.kind] || r.kind}</td><td>${src}${src && r.note ? '. ' : ''}${esc(r.note)}</td></tr>`;
    }).join('') + '</tbody></table>';
}).join('');

const byKind = {};
for (const { r } of all) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
$('counts').innerHTML = `<span><b>${all.length}</b> numbers</span>` +
  Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, c]) => `<span class="kind-${k}"><b>${c}</b> ${KIND_LABEL[k] || k}</span>`).join('');

$('sources').innerHTML = [...used].filter((s) => SOURCES[s]).map((s) => {
  const S = SOURCES[s];
  return `<p class="src" id="src-${s}"><b>${esc(S.title)}</b> &middot; ${esc(S.who)} &middot; ${KIND_LABEL[S.kind] || S.kind}<br>${esc(S.says)}<br>` +
    `<a href="${esc(S.url)}" target="_blank" rel="noopener" aria-label="${esc(S.title)} (opens in a new tab)">${esc(S.url)}</a></p>`;
}).join('');
