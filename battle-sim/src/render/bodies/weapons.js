// Hand-held weapons and shields. PLACEHOLDER shapes: to be replaced with detailed models.
//
// Frame: the grip is at the origin; the business end (blade tip, spear head,
// staff top, upper bow limb) points along +Y; the cutting edge / front faces +Z.
// A shield's outer face points +Z, its top is +Y, and its centre is the origin.
import { H } from '../sculpt.js';

const STEEL = 0xc9d1d9, WOOD = 0x6b4a2e;
const META = {
  sword: ['one', 'swing', 0.5], longsword: ['one', 'swing', 0.62], greatsword: ['two', 'swing', 0.85], dagger: ['one', 'thrust', 0.22],
  claws: ['none', 'claw', 0.08], spear: ['pole', 'thrust', 1.15], lance: ['pole', 'thrust', 1.6], halberd: ['pole', 'swing', 1.25],
  axe: ['one', 'swing', 0.5], greataxe: ['two', 'slam', 0.95], club: ['one', 'swing', 0.62], warhammer: ['one', 'swing', 0.62],
  staff: ['staff', 'cast', 1.05], longbow: ['bow', 'shoot', 0.85], sling: ['one', 'shoot', 0.3], crossbow: ['bow', 'shoot', 0.45],
};

/**
 * weapon(kind, opts) -> { prims: [], hard: [], hold, attack, length } or null for 'none'.
 * hold: one | two | pole | staff | bow | none.  attack: the animation style (see animate.js).
 * length: reach from the grip to the tip, model units.  opts: { tint, scale }.
 */
export function weapon(kind) {
  const meta = META[kind];
  if (!meta) return null;
  const [hold, attack, length] = meta;
  const hard = [];
  if (hold === 'bow') hard.push(H.torus(length / 2, 0.012, 24, 8, Math.PI).rot(0, 0, -90).color(WOOD));
  else if (hold !== 'none') {
    hard.push(H.cyl(0.014, 0.014, length, 10).at(0, length / 2 - 0.08, 0).color(hold === 'pole' || hold === 'staff' || kind === 'club' ? WOOD : STEEL).pbr(0.5, hold === 'pole' || hold === 'staff' || kind === 'club' ? 0 : 0.8));
    hard.push(H.box(0.05, 0.08, 0.03).at(0, length - 0.1, 0).color(STEEL).pbr(0.4, 0.8));
  }
  return { prims: [], hard, hold, attack, length };
}

/** shield(opts) -> { prims: [], hard: [] }.  opts: { color (heraldic field), shape: 'kite' | 'round' | 'tower', size } */
export function shield(opts = {}) {
  return { prims: [], hard: [H.box(0.26, 0.34, 0.03, 0.01).color(opts.color ?? 0x6b4a2e), H.sphere(0.04, 12).at(0, 0, 0.02).color(0xd6a646).pbr(0.4, 0.8)] };
}
