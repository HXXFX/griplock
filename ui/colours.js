
const root = () => getComputedStyle(document.documentElement);
export const colour = (name) => root().getPropertyValue(`--${name}`).trim();
export const colourNum = (name) => parseInt(colour(name).replace('#', ''), 16);
export function scale(name) {
  return colour(name).replace(/["']/g, '').split(',').map((s) => s.trim().split(/\s+/)).filter((p) => p.length === 2).map(([v, c]) => [+v, c]);
}
const hooks = [];
export const onRecolour = (fn) => { hooks.push(fn); };
export function recolour() { for (const fn of hooks) fn(); }
