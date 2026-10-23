
import { n, LBF, KGF } from './num.js';

export const FLESH = {
  a: n(2.5e4, 'Pa', 'estimate', [], "The law's scale: 2.5 N per cm2. The palm law of the project's earlier hand simulation, shaped like measured fingerpad behaviour (stiffness rising with load); the sizes are its estimates."),
  B: n(600, '1/m', 'estimate', ['spartacus2021'], 'How fast the push grows with squash: 0.6 per mm, the same palm law. At 5 N/cm2 a spot is squashed 1.8 mm and stiffens by 4.5 N/cm2 per mm; the measured palm (a 3 mm indenter, slow) gave 3.7-7.6 N/cm2 per mm.'),
  bone: n(0.009, 'm', 'estimate', [], 'How far the flesh can squash before the bone: a palm pad. Past it, the push keeps growing at the stiffness it had there.'),
  shearRatio: n(0.5, '', 'estimate', [], 'Sideways stiffness of the skin as a share of its pressing stiffness.'),
  dampingTime: n(0.0012, 's', 'estimate', [], "The flesh's damping: damping = stiffness x this time."),
};

export const FRICTION = {
  dryTexture: { name: 'Dry hands, textured grip', mu: n(0.6, '', 'estimate', ['derler2012'], 'Dry skin is about 0.5; texture adds some bite.') },
  drySmooth: { name: 'Dry hands, smooth plastic', mu: n(0.3, '', 'estimate', ['wu2009'], 'Fingertip on hard plastics measured 0.14-0.29; a palm on a smooth grip a little more.') },
  damp: { name: 'Slightly damp hands', mu: n(0.9, '', 'estimate', ['derler2012'], 'Moist skin grips harder: typically above 1 in the review.') },
  oily: { name: 'Wet or oily hands', mu: n(0.25, '', 'estimate', [], 'A film of water or oil lubricates; no direct measurement found.') },
  tape: { name: 'Rubber grip tape', mu: n(0.75, '', 'estimate', ['wu2009', 'buchholz1988'], 'Rubbers measured 0.41-0.83; skin on tape 0.41 dry, 0.66 moist.') },
};
export const KINETIC_RATIO = n(0.8, '', 'estimate', [], 'Sliding friction as a share of sticking friction.');

export const SQUEEZE = {
  shooterGrip: n(80 * LBF, 'N', 'measured', ['forceScienceGrip'], '80-125 lb grip strength went with 85-90% qualification scores; the low end.'),
  shooterGripHigh: n(125 * LBF, 'N', 'measured', ['forceScienceGrip'], 'The high end of the same range.'),
};

const HANDS = (name, grip, gripSd, support, supportSd, finger, fingerKind, fingerNote, src, gripKind = 'measured') => ({
  name,
  grip: n(grip * KGF, 'N', gripKind, src, `${grip} kg, the stronger hand (dynamometer)${gripSd}.`),
  support: n(support * KGF, 'N', gripKind, src, `${support} kg, the other hand${supportSd}.`),
  finger: n(finger, 'N', fingerKind, ['milnerTrigger2025'], fingerNote),
});
export const STRENGTH = {
  man: HANDS('Average man', 54.79, ' (men 25-29, mean; SD 10.43)', 50.12, ' (SD 7.35)', 80.7, 'measured',
    'The index finger pulling a trigger as hard as it can with its pad, the wrist straight: 80.7 N, the mean of 10 men (SD 20.9), each the mean of their tries (worked out from the published data).', ['mathiowetz1985']),
  woman: HANDS('Average woman', 33.79, ' (women 25-29, mean; SD 6.30)', 28.8, ' (SD 5.53)', 61.1, 'measured',
    'The same, 13 women: 61.1 N (SD 18.6).', ['mathiowetz1985']),
  strong: HANDS('Strong man (1 in 20)', 72.0, ': the men 25-29 mean plus 1.65 SD (worked out from the table, so 1 man in 20 is stronger)', 62.2,
    ': mean plus 1.65 SD', 115.2, 'estimate', 'The men\'s 80.7 N plus 1.65 SD (20.9): 1 man in 20 pulls harder, if the 10 men measured are like men in general (a small sample).', ['mathiowetz1985'], 'estimate'),
};
export const TYPICAL_SQUEEZE = n((80 + 125) / 2 * LBF, 'N', 'estimate', ['forceScienceGrip'],
  'The middle of 80-125 lb (the grip strength of shooters who qualified well), taken as both hands\' working squeeze together.');

export const FATIGUE = {
  rate: n(0.87, '1/min', 'estimate', ['maFatigue2009'], 'k: the average Ma et al. report from 24 static endurance models. Held at 45% of its strength, a grip can still give 97% after 5 s and falls to 45% after about 2 minutes.'),
};
