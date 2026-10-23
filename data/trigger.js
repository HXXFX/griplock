
import { n } from './num.js';

export const GLOCK_TRIGGER = {
  breakForce: n(25.6, 'N', 'measured', ['all4shootersGPT'], 'Stock Gen5, mean of 10 pulls (5.8 lb).'),
  travel: n(12.5, 'mm', 'press', ['athlonGen5'], 'Total travel from rest to the stop.'),
  curve: n([[0, 4], [6.8, 11], [7.6, 13], [8.4, 25.6], [8.45, 7], [12.5, 8]], 'mm, N', 'estimate', [],
    'Take-up rising to a wall, a short stiff press through the wall, the break, then overtravel to the stop. Shape estimated; ends measured.'),
  breakAt: n(8.4, 'mm', 'estimate', [], 'Travel at the break: where the curve above peaks.'),
};

export const TRIGGER_FINGER = {
  lockTime: n(0.0025, 's', 'estimate', [], 'From the trigger breaking to the shot: the striker running forward to the primer.'),
  overtravelTime: n(0.003, 's', 'estimate', [], 'From the break to the trigger reaching its rear stop.'),
  holdTime: n(0.06, 's', 'estimate', [], 'How long the finger holds the trigger back after the shot before letting it out.'),
  releaseSpeed: n(120, 'mm/s', 'estimate', [], 'How fast the finger lets the trigger out to the reset.'),
  resetAt: n(8.0, 'mm', 'estimate', [], 'Where the trigger resets on the way back (before the break).'),
  resetForce: n(13, 'N', 'estimate', [], "What the finger holds at the reset: the trigger's return spring there, not the press curve."),
  padFriction: n(0.3, '', 'estimate', ['wu2009', 'derler2012'], "The finger pad's skin on the trigger's smooth polymer face: how far a push may lean from straight into the surface (friction carries the rest) as the finger pulls straight back. Skin on metals and plastics measures 0.14-0.29 (Tomlinson, via Wu et al.), dry skin in general about 0.5 (Derler & Gerhardt); 0.3 is the top of the first, below the second."),
};

export const RIFLING = {
  twist: n(0.25, 'm per turn', 'press', ['athlonGen5'], 'Right-hand, 250 mm (9.84 in) per turn, hexagonal (the GLOCK Marksman Barrel), as GLOCK\'s Gen5 launch spec sheet gives it; not on GLOCK\'s own product page.'),
  spinShare: n(0.5, 'x m r2', 'estimate', [], "The bullet's turning inertia about its axis, as a share of its mass times its radius squared: 0.5 for a solid cylinder of even density. A jacketed lead bullet is close to it."),
  bulletDiameter: n(0.00902, 'm', 'standard', ['saami9mm'], '0.355 in: the 9mm Luger bullet diameter.'),
};

export function triggerForceAt(mm) {
  const c = GLOCK_TRIGGER.curve.v;
  if (mm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (mm <= c[i][0]) {
      const [x0, y0] = c[i - 1], [x1, y1] = c[i];
      return y0 + ((y1 - y0) * (mm - x0)) / (x1 - x0);
    }
  }
  return c[c.length - 1][1];
}
export function travelForForce(F) {
  const c = GLOCK_TRIGGER.curve.v, B = GLOCK_TRIGGER.breakAt.v;
  if (F <= c[0][1]) return 0;
  for (let i = 1; i < c.length; i++) {
    const [x0, y0] = c[i - 1], [x1, y1] = c[i];
    if (x1 > B + 1e-9) break;
    if (F <= y1) return x0 + ((x1 - x0) * (F - y0)) / (y1 - y0);
  }
  return B;
}

export const PRESS_STYLES = {
  smooth: { name: 'Smooth, steady press', note: 'The finger builds up evenly to its full press.' },
  staged: { name: 'Take up the slack, then press', note: 'Quickly to the wall, a pause there, then on to the full press.' },
  slap: { name: 'Slap', note: 'The finger arrives fast: full press in 30% of the time.' },
  none: { name: 'No trigger (the shot just goes off)', note: 'No finger: the recoil alone, from a gun held still.' },
};
export function pressShare(style, speed, t, wall = 0.4) {
  const T = speed;
  if (t <= 0) return 0;
  if (style === 'staged') {
    const t1 = T * 0.25, t2 = T * 0.75;
    if (t < t1) return (wall * t) / t1;
    if (t < t2) return wall + (0.05 * (t - t1)) / (t2 - t1);
    return Math.min(1, wall + 0.05 + ((0.95 - wall) * (t - t2)) / (T - t2));
  }
  if (style === 'slap') return Math.min(1, t / (T * 0.3));
  return Math.min(1, t / T);
}
