
import { n, GRAIN, FPS, PSI } from './num.js';

function load(id, grains, fps, srcId, powderGrains, caseGrams) {
  const bullet = grains * GRAIN;
  const v = fps * FPS;
  const powder = powderGrains * GRAIN;
  return {
    id,
    name: `9mm ${grains} gr FMJ`,
    bulletMass: n(bullet, 'kg', 'maker', [srcId], `${grains} grains.`),
    muzzleVelocity: n(v, 'm/s', 'maker', [srcId], `${fps} ft/s from a 4-inch test barrel.`),
    powderMass: n(powder, 'kg', 'estimate', ['saami9mm'], `About ${powderGrains} grains; factory charges for this bullet are roughly 4-6 grains depending on the powder.`),
    cartridgeMass: n(bullet + powder + caseGrams * 1e-3, 'kg', 'estimate', [], 'Bullet + powder + brass case and primer (about 4.3 g).'),
  };
}

export const AMMO = {
  '115': load('115', 115, 1180, 'federalAE9DP', 5.0, 4.3),
  '124': load('124', 124, 1150, 'federalAE9AP', 4.6, 4.3),
};

export const BALLISTICS = {
  maxPressure: n(35000 * PSI, 'Pa', 'standard', ['saami9mm'], 'SAAMI maximum average pressure; factory loads run below it.'),
  barrelTime: n(0.0005, 's', 'press', ['patentCamming'], 'Bullet leaves 0.4-0.6 ms after firing.'),
  gasSpeedFactor: n(1.5, 'x bullet speed', 'estimate', [], 'Common recoil-calculator convention; not verified for pistols.'),
};

export function shotImpulse(ammo) {
  const mb = ammo.bulletMass.v, v = ammo.muzzleVelocity.v, mp = ammo.powderMass.v;
  const bullet = mb * v;
  const gas = mp * BALLISTICS.gasSpeedFactor.v * v;
  return { bullet, gas, total: bullet + gas };
}

export function barrelTime(ammo, barrelLength) {
  const travel = barrelLength - 0.015;
  return 1.7 * travel / ammo.muzzleVelocity.v;
}
