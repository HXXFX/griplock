
import { n } from './num.js';

export const ISSF_TARGET = {
  ringStep: n(25, 'mm', 'standard', ['issfPrecisionTarget'], 'Each ring is 50 mm wider across than the one inside it: 25 mm more radius. The 10 ring is 50 mm across, the 1 ring 500 mm.'),
  innerTen: n(12.5, 'mm', 'standard', ['issfPrecisionTarget'], 'The inner ten, 25 mm across: its radius.'),
  black: n(100, 'mm', 'standard', ['issfPrecisionTarget'], 'The black aiming area, rings 7 to 10, 200 mm across: its radius.'),
  card: n(550, 'mm', 'standard', ['issfPrecisionTarget'], 'The card, at least 550 mm wide.'),
};
export const DISTANCES = { min: 3, max: 50, start: 7 };
