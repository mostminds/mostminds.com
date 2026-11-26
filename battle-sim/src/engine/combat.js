// Tick-based combat math modelled on classic MMO accuracy/max-hit formulas.
export const TICK_MS = 600;

export function combatLevel(u) {
  const base = 0.25 * (u.def + u.hp);
  const melee = 0.325 * (u.att + u.str);
  const range = 0.325 * Math.floor(1.5 * u.rng);
  const mage = 0.325 * Math.floor(1.5 * u.mag);
  return Math.max(1, Math.floor(base + Math.max(melee, range, mage)));
}

const b = (u, k) => (u.bonus && u.bonus[k]) || 0;

export function attackRoll(u) {
  if (u.style === 'ranged') return (u.rng + 9) * (b(u, 'rngAtt') + 64);
  if (u.style === 'magic') return (u.mag + 9) * (b(u, 'magAtt') + 64);
  return (u.att + 9) * (b(u, 'att') + 64);
}

export function defenceRoll(target, style) {
  if (style === 'magic') return (target.mag + 9) * (b(target, 'defMagic') + 64);
  if (style === 'ranged') return (target.def + 9) * (b(target, 'defRanged') + 64);
  return (target.def + 9) * (b(target, 'defMelee') + 64);
}

export function hitChance(a, d) {
  return a > d ? 1 - (d + 2) / (2 * (a + 1)) : a / (2 * (d + 1));
}

export function maxHit(u) {
  if (u.maxHit) return u.maxHit;
  if (u.style === 'ranged') return Math.floor(0.5 + ((u.rng + 9) * (b(u, 'rngStr') + 64)) / 640);
  if (u.style === 'magic') return Math.max(1, Math.floor(u.mag / 6));
  return Math.floor(0.5 + ((u.str + 9) * (b(u, 'str') + 64)) / 640);
}

// Delay in ticks before a projectile lands (melee is instant).
export function hitDelay(style, dist) {
  if (style === 'melee') return 0;
  if (style === 'magic') return 1 + Math.floor((1 + dist) / 3);
  return 1 + Math.floor((3 + dist) / 6);
}
