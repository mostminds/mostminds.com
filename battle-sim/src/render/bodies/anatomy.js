// Body proportions for two-legged characters, in model units before the unit's
// own `scale` is applied (an adult human stands 1.0 tall). Everything that
// dresses or arms a body reads these, so gear fits every species.
const BASE = {
  // heights of joints above the ground
  footH: 0.045, shin: 0.235, thigh: 0.235,
  torso: 0.30,        // hip joint to shoulder line
  neck: 0.045, headR: 0.095, headLen: 1.12, // head is an ellipsoid: radius, and height stretch
  upper: 0.17, fore: 0.155, handR: 0.036,
  hipX: 0.075, shoulderX: 0.155,
  chestW: 0.27, chestD: 0.16, waistW: 0.205, waistD: 0.135, hipW: 0.225,
  rThigh: 0.058, rCalf: 0.045, rAnkle: 0.03, rUpper: 0.042, rFore: 0.036, rWrist: 0.026, rNeck: 0.045,
  footLen: 0.13, hunch: 0, // forward lean of the torso in degrees
};
const SPECIES = {
  human: {},
  goblin: { shin: 0.2, thigh: 0.19, torso: 0.3, headR: 0.125, headLen: 0.95, upper: 0.19, fore: 0.19, handR: 0.045, shoulderX: 0.15, chestW: 0.25, waistW: 0.22, rThigh: 0.05, rCalf: 0.038, rUpper: 0.036, rFore: 0.034, footLen: 0.15, hunch: 12 },
  hobgoblin: { headR: 0.1, shoulderX: 0.175, chestW: 0.31, chestD: 0.18, waistW: 0.23, rUpper: 0.05, rFore: 0.043, rThigh: 0.064, hunch: 6 },
  ogre: { shin: 0.19, thigh: 0.2, torso: 0.36, headR: 0.085, upper: 0.2, fore: 0.19, handR: 0.05, hipX: 0.1, shoulderX: 0.215, chestW: 0.4, chestD: 0.27, waistW: 0.4, waistD: 0.3, hipW: 0.36, rThigh: 0.085, rCalf: 0.065, rAnkle: 0.045, rUpper: 0.068, rFore: 0.06, rWrist: 0.042, rNeck: 0.06, footLen: 0.17, hunch: 6 },
  troll: { shin: 0.225, thigh: 0.215, torso: 0.34, headR: 0.09, headLen: 1.2, upper: 0.235, fore: 0.235, handR: 0.055, hipX: 0.085, shoulderX: 0.2, chestW: 0.34, chestD: 0.21, waistW: 0.24, hipW: 0.245, rThigh: 0.06, rCalf: 0.046, rAnkle: 0.034, rUpper: 0.05, rFore: 0.046, rWrist: 0.036, rNeck: 0.05, footLen: 0.18, hunch: 20 },
  cyclops: { torso: 0.33, headR: 0.105, shoulderX: 0.2, chestW: 0.36, chestD: 0.22, waistW: 0.28, hipW: 0.27, rThigh: 0.075, rCalf: 0.058, rUpper: 0.06, rFore: 0.052, rWrist: 0.036, rNeck: 0.055, handR: 0.048, footLen: 0.16, hunch: 4 },
  minotaur: { torso: 0.34, headR: 0.1, headLen: 1.0, shoulderX: 0.215, chestW: 0.4, chestD: 0.25, waistW: 0.27, hipW: 0.25, rThigh: 0.075, rCalf: 0.05, rUpper: 0.066, rFore: 0.055, rWrist: 0.038, rNeck: 0.07, handR: 0.048, hunch: 8 },
  demon: { shin: 0.265, thigh: 0.255, torso: 0.33, headR: 0.092, upper: 0.185, fore: 0.175, shoulderX: 0.2, chestW: 0.36, chestD: 0.21, waistW: 0.23, hipW: 0.235, rThigh: 0.068, rCalf: 0.05, rAnkle: 0.034, rUpper: 0.06, rFore: 0.05, rWrist: 0.034, rNeck: 0.052, handR: 0.046, footLen: 0.16, hunch: 5 },
  imp: { shin: 0.2, thigh: 0.2, headR: 0.12, upper: 0.16, fore: 0.16, chestW: 0.22, waistW: 0.19, rThigh: 0.045, rCalf: 0.034, rUpper: 0.032, rFore: 0.03, hunch: 10 },
  ghoul: { upper: 0.2, fore: 0.2, handR: 0.042, chestW: 0.25, waistW: 0.17, waistD: 0.11, rThigh: 0.046, rCalf: 0.036, rUpper: 0.034, rFore: 0.03, rNeck: 0.03, hunch: 26 },
  harpy: { chestW: 0.24, waistW: 0.18, rThigh: 0.05, rCalf: 0.03, rUpper: 0.034, rFore: 0.03, hunch: 8 },
  // the wider fantasy races
  elf: { shin: 0.268, thigh: 0.262, torso: 0.3, neck: 0.056, headR: 0.088, headLen: 1.18, upper: 0.182, fore: 0.166, handR: 0.034, hipX: 0.068, shoulderX: 0.142, chestW: 0.236, chestD: 0.14, waistW: 0.172, waistD: 0.118, hipW: 0.198, rThigh: 0.05, rCalf: 0.038, rAnkle: 0.026, rUpper: 0.035, rFore: 0.03, rWrist: 0.022, rNeck: 0.038, footLen: 0.125 },
  dwarf: { footH: 0.05, shin: 0.122, thigh: 0.12, torso: 0.255, neck: 0.024, headR: 0.1, headLen: 1.06, upper: 0.138, fore: 0.128, handR: 0.047, hipX: 0.088, shoulderX: 0.184, chestW: 0.345, chestD: 0.215, waistW: 0.3, waistD: 0.2, hipW: 0.285, rThigh: 0.072, rCalf: 0.06, rAnkle: 0.042, rUpper: 0.058, rFore: 0.052, rWrist: 0.037, rNeck: 0.06, footLen: 0.152 },
  orc: { shin: 0.252, thigh: 0.248, torso: 0.37, neck: 0.016, headR: 0.094, headLen: 1.0, upper: 0.19, fore: 0.185, handR: 0.053, hipX: 0.092, shoulderX: 0.232, chestW: 0.43, chestD: 0.255, waistW: 0.3, waistD: 0.19, hipW: 0.275, rThigh: 0.082, rCalf: 0.06, rAnkle: 0.039, rUpper: 0.073, rFore: 0.067, rWrist: 0.043, rNeck: 0.07, footLen: 0.165, hunch: 10 },
  lizard: { torso: 0.315, neck: 0.05, headR: 0.09, headLen: 0.96, upper: 0.175, fore: 0.165, handR: 0.043, shoulderX: 0.168, chestW: 0.295, chestD: 0.195, waistW: 0.225, waistD: 0.15, hipW: 0.235, rThigh: 0.068, rCalf: 0.047, rAnkle: 0.03, rUpper: 0.047, rFore: 0.041, rWrist: 0.029, rNeck: 0.052, footLen: 0.17, hunch: 11 },
  rat: { shin: 0.2, thigh: 0.2, torso: 0.29, headR: 0.092, headLen: 0.95, upper: 0.172, fore: 0.168, handR: 0.038, hipX: 0.07, shoulderX: 0.145, chestW: 0.24, chestD: 0.155, waistW: 0.19, waistD: 0.128, hipW: 0.21, rThigh: 0.05, rCalf: 0.035, rAnkle: 0.024, rUpper: 0.034, rFore: 0.029, rWrist: 0.022, rNeck: 0.04, footLen: 0.165, hunch: 24 },
  goat: { torso: 0.325, headR: 0.095, headLen: 1.0, upper: 0.175, fore: 0.165, shoulderX: 0.188, chestW: 0.345, chestD: 0.215, waistW: 0.24, hipW: 0.24, rThigh: 0.072, rCalf: 0.047, rUpper: 0.055, rFore: 0.047, rWrist: 0.033, rNeck: 0.06, handR: 0.045, hunch: 12 },
  tiger: { shin: 0.246, thigh: 0.246, torso: 0.322, neck: 0.04, headR: 0.1, headLen: 0.98, upper: 0.176, fore: 0.166, shoulderX: 0.186, chestW: 0.335, chestD: 0.2, waistW: 0.222, hipW: 0.232, rThigh: 0.068, rCalf: 0.048, rAnkle: 0.032, rUpper: 0.055, rFore: 0.047, rWrist: 0.033, rNeck: 0.058, handR: 0.045, footLen: 0.15 },
  mummy: { upper: 0.178, fore: 0.17, chestW: 0.252, chestD: 0.148, waistW: 0.172, waistD: 0.112, hipW: 0.2, rThigh: 0.046, rCalf: 0.035, rAnkle: 0.026, rUpper: 0.034, rFore: 0.029, rWrist: 0.023, rNeck: 0.033, hunch: 9 },
};

/**
 * Proportions for a model descriptor `o` (the unit's `model` field).
 * Returns the lengths above plus derived joint heights:
 *   hipY, shoulderY (above ground), kneeY, headY (centre of the head), height (top of the skull)
 * Node origins used by the humanoid rig, all in the parent's space:
 *   legs at (+-hipX, hipY, 0) under root; shins at (0, -thigh, 0) under their leg;
 *   torso at (0, hipY, 0) under root; head at (0, torso + neck + headR * headLen * 0.9, 0) under torso;
 *   arms at (+-shoulderX, torso - 0.02, 0) under torso; forearms at (0, -upper, 0) under their arm.
 * A hand sits at (0, -fore - handR, 0) in its forearm's space (the humanoid rig gives each hand its own node at the
 * wrist, (0, -fore, 0); gear added to a forearm below the wrist is handed on to that hand automatically).
 */
export function proportions(o = {}) {
  const p = { ...BASE, ...(SPECIES[o.species] || {}) };
  if (o.build === 'heavy') { p.chestW *= 1.12; p.chestD *= 1.15; p.waistW *= 1.25; p.waistD *= 1.3; p.rUpper *= 1.15; p.rFore *= 1.12; p.rThigh *= 1.15; p.rCalf *= 1.1; p.rNeck *= 1.2; }
  if (o.build === 'slim') { p.chestW *= 0.92; p.waistW *= 0.9; p.rUpper *= 0.9; p.rThigh *= 0.92; }
  if (o.hunch) p.hunch = Math.max(p.hunch, 18);
  p.species = o.species || 'human';
  p.hipY = p.footH + p.shin + p.thigh;
  p.kneeY = p.footH + p.shin;
  p.shoulderY = p.hipY + p.torso;
  p.headY = p.shoulderY + p.neck + p.headR * p.headLen * 0.9;
  p.height = p.headY + p.headR * p.headLen;
  return p;
}
export const SPECIES_NAMES = Object.keys(SPECIES);
