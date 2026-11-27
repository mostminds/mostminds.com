// Original unit roster. Stats follow the same shape as classic MMO monster
// stat blocks: levels (hp/att/str/def/rng/mag), equipment bonuses, attack
// speed in 0.6s ticks, range in tiles, move = tiles per tick, size in tiles.
// Add your own via the "Import units" panel using the same fields.
//
// Abilities:
//  cleave {radius, mult}   splash melee hits around the target
//  splash {radius, mult}   splash for ranged/magic
//  breath {every, maxHit, radius}  special AoE every N attacks
//  stomp  {every, radius, maxHit}  ground slam around self
//  poison {damage, chance}         5 ticks of damage over time
//  heal   {amount, range, charges} heals the weakest nearby ally (20 heals unless charges says otherwise)
//  regen  {amount, every}          self heal
//  enrage {threshold, mult}        bigger hits when wounded
//  charge {mult}                   first hit after running 3+ tiles
//  protect{style, reduction}       damage reduction vs one style
//  siege  {mult}                   extra damage against walls, gates and buildings
//
// fly: true puts a unit in the air. Ground melee cannot reach it except in the
// moment it swoops down to strike; archers, mages, ballistae and harpoons can.

import { realmUnits } from './realms.js';

const H = (o) => ({ body: 'humanoid', ...o });

export const UNITS = {
  // ---- Kingdom ----
  militia: { name: 'Militia', category: 'Kingdom', hp: 12, att: 8, str: 8, def: 6, rng: 1, mag: 1, style: 'melee', speed: 5,
    bonus: { att: 8, str: 6, defMelee: 8, defRanged: 6, defMagic: 0 }, model: H({ outfit: 'peasant', skin: 0xd9a77c, cloth: 0x7a6a4f, weapon: 'spear' }) },
  footman: { name: 'Footman', category: 'Kingdom', hp: 30, att: 30, str: 30, def: 30, rng: 1, mag: 1, style: 'melee', speed: 4,
    bonus: { att: 30, str: 28, defMelee: 60, defRanged: 55, defMagic: -10 }, model: H({ outfit: 'footman', skin: 0xd9a77c, cloth: 0x2f5aa8, armor: 0x9aa3ad, weapon: 'sword', shield: true, helm: true }) },
  knight: { name: 'Knight', category: 'Kingdom', hp: 70, att: 65, str: 62, def: 70, rng: 1, mag: 1, style: 'melee', speed: 4,
    bonus: { att: 65, str: 60, defMelee: 140, defRanged: 130, defMagic: -15 }, model: H({ outfit: 'knight', skin: 0xd9a77c, cloth: 0x2f5aa8, armor: 0xc9d1d9, weapon: 'longsword', shield: true, helm: 'full', scale: 1.05 }) },
  halberdier: { name: 'Halberdier', category: 'Kingdom', hp: 45, att: 48, str: 55, def: 40, rng: 1, mag: 1, style: 'melee', speed: 6,
    abilities: [{ type: 'cleave', radius: 1, mult: 0.5 }],
    bonus: { att: 45, str: 60, defMelee: 70, defRanged: 60, defMagic: -10 }, model: H({ outfit: 'manAtArms', skin: 0xd9a77c, cloth: 0x2f5aa8, armor: 0x9aa3ad, weapon: 'halberd', helm: true }) },
  lancer: { name: 'Lancer', category: 'Kingdom', hp: 55, att: 55, str: 58, def: 45, rng: 1, mag: 1, style: 'melee', speed: 5, move: 2, role: 'skirmisher',
    abilities: [{ type: 'charge', mult: 1.6 }],
    bonus: { att: 55, str: 50, defMelee: 80, defRanged: 70, defMagic: 0 }, model: { outfit: 'lancer', mountType: 'horse', body: 'rider', skin: 0xd9a77c, cloth: 0x2f5aa8, armor: 0x9aa3ad, weapon: 'lance', mount: 0x6b4a2e } },
  longbow: { name: 'Longbowman', category: 'Kingdom', hp: 28, att: 1, str: 1, def: 22, rng: 45, mag: 1, style: 'ranged', speed: 6, range: 9,
    bonus: { rngAtt: 50, rngStr: 25, defMelee: 20, defRanged: 25, defMagic: 10 }, projectile: 'arrow', model: H({ outfit: 'ranger', skin: 0xd9a77c, cloth: 0x3c6b35, weapon: 'longbow', hood: true }) },
  crossbow: { name: 'Crossbowman', category: 'Kingdom', hp: 32, att: 1, str: 1, def: 30, rng: 40, mag: 1, style: 'ranged', speed: 5, range: 7,
    bonus: { rngAtt: 55, rngStr: 40, defMelee: 45, defRanged: 45, defMagic: 0 }, projectile: 'bolt', model: H({ outfit: 'arbalist', skin: 0xd9a77c, cloth: 0x2f5aa8, armor: 0x9aa3ad, weapon: 'crossbow', helm: true }) },
  battlemage: { name: 'Battle Mage', category: 'Kingdom', hp: 30, att: 1, str: 1, def: 15, rng: 1, mag: 55, style: 'magic', speed: 5, range: 8, maxHit: 16,
    abilities: [{ type: 'splash', radius: 1, mult: 0.4 }],
    bonus: { magAtt: 40, defMelee: 5, defRanged: 5, defMagic: 40 }, projectile: 'fire', model: H({ outfit: 'mage', skin: 0xd9a77c, cloth: 0x8a2c2c, weapon: 'staff', hood: true, robe: true }) },
  cleric: { name: 'Cleric', category: 'Kingdom', hp: 30, att: 10, str: 10, def: 20, rng: 1, mag: 40, style: 'magic', speed: 5, range: 5, maxHit: 6,
    abilities: [{ type: 'heal', amount: 14, range: 5 }],
    bonus: { magAtt: 15, defMelee: 15, defRanged: 15, defMagic: 30 }, projectile: 'holy', model: H({ outfit: 'priest', skin: 0xd9a77c, cloth: 0xe8e2d0, weapon: 'staff', robe: true }) },
  paladin: { name: 'Paladin', category: 'Kingdom', hp: 95, att: 80, str: 78, def: 85, rng: 1, mag: 50, style: 'melee', speed: 5, size: 1,
    abilities: [{ type: 'regen', amount: 2, every: 5 }, { type: 'protect', style: 'magic', reduction: 0.4 }],
    bonus: { att: 85, str: 82, defMelee: 180, defRanged: 170, defMagic: 40 }, model: H({ outfit: 'paladin', skin: 0xd9a77c, cloth: 0xd8c07a, armor: 0xe8e2c8, weapon: 'warhammer', shield: true, helm: 'full', scale: 1.1 }) },

  gyrocopter: { name: 'Gyrocopter', category: 'Kingdom', fly: true, hp: 30, att: 1, str: 1, def: 25, rng: 48, mag: 1, style: 'ranged', speed: 4, range: 6, move: 2, stamina: 400,
    bonus: { rngAtt: 45, rngStr: 30, defMelee: 20, defRanged: 30, defMagic: 10 }, projectile: 'bolt', model: { body: 'aircraft', kind: 'gyro', style: 'kingdom' } },
  engineer: { name: 'Engineer', category: 'Kingdom', role: 'support', hp: 30, att: 20, str: 20, def: 25, rng: 1, mag: 1, style: 'melee', speed: 5,
    abilities: [{ type: 'repair', amount: 40 }],
    bonus: { att: 15, str: 15, defMelee: 35, defRanged: 30, defMagic: 0 }, model: H({ outfit: 'sapper', skin: 0xd9a77c, cloth: 0x8a5a2a, weapon: 'warhammer', helm: true }) },
  griffon: { name: 'Griffon Rider', category: 'Kingdom', fly: true, hp: 60, att: 60, str: 58, def: 45, rng: 1, mag: 1, style: 'melee', speed: 4, move: 2, size: 1,
    abilities: [{ type: 'charge', mult: 1.5 }],
    bonus: { att: 50, str: 45, defMelee: 60, defRanged: 40, defMagic: 10 }, model: { outfit: 'skyKnight', mountType: 'griffon', body: 'rider', skin: 0xd9a77c, cloth: 0x2f5aa8, armor: 0x9aa3ad, weapon: 'lance', mount: 0xc8a050, wings: true } },
  ram: { name: 'Battering Ram', category: 'Kingdom', role: 'siege', hp: 160, att: 30, str: 40, def: 90, rng: 1, mag: 1, style: 'melee', speed: 6, size: 2,
    abilities: [{ type: 'siege', mult: 10 }, { type: 'protect', style: 'ranged', reduction: 0.6 }],
    bonus: { att: 0, str: 0, defMelee: 120, defRanged: 220, defMagic: 40 }, model: { body: 'ram', color: 0x6b4a2e } },

  // ---- Goblin horde ----
  goblin: { name: 'Goblin Grunt', category: 'Goblin Horde', hp: 8, att: 5, str: 5, def: 3, rng: 1, mag: 1, style: 'melee', speed: 4,
    bonus: { att: 4, str: 4, defMelee: 2, defRanged: 2, defMagic: 0 }, model: H({ species: 'goblin', outfit: 'rags', skin: 0x6f9a3a, cloth: 0x6b4a2e, weapon: 'dagger', scale: 0.72 }) },
  goblinArcher: { name: 'Goblin Slinger', category: 'Goblin Horde', hp: 8, att: 1, str: 1, def: 3, rng: 10, mag: 1, style: 'ranged', speed: 5, range: 5,
    bonus: { rngAtt: 6, rngStr: 6, defMelee: 1, defRanged: 2, defMagic: 0 }, projectile: 'rock', model: H({ species: 'goblin', outfit: 'rags', skin: 0x6f9a3a, cloth: 0x5a4630, weapon: 'sling', scale: 0.72 }) },
  hobgoblin: { name: 'Hobgoblin Brute', category: 'Goblin Horde', hp: 38, att: 32, str: 40, def: 26, rng: 1, mag: 1, style: 'melee', speed: 5,
    bonus: { att: 20, str: 30, defMelee: 30, defRanged: 20, defMagic: 0 }, model: H({ species: 'hobgoblin', outfit: 'hides', skin: 0x8a7a3a, cloth: 0x4a3a2a, weapon: 'club', scale: 1.08 }) },
  wolfRider: { name: 'Wolf Rider', category: 'Goblin Horde', hp: 28, att: 30, str: 26, def: 18, rng: 1, mag: 1, style: 'melee', speed: 4, move: 2, role: 'skirmisher',
    abilities: [{ type: 'charge', mult: 1.4 }],
    bonus: { att: 20, str: 18, defMelee: 18, defRanged: 15, defMagic: 0 }, model: { species: 'goblin', outfit: 'raider', mountType: 'wolf', body: 'rider', skin: 0x6f9a3a, cloth: 0x5a4630, weapon: 'spear', mount: 0x5b5b5b, wolf: true, scale: 0.85 } },
  shaman: { name: 'Goblin Shaman', category: 'Goblin Horde', hp: 18, att: 1, str: 1, def: 8, rng: 1, mag: 28, style: 'magic', speed: 5, range: 6, maxHit: 7,
    abilities: [{ type: 'heal', amount: 8, range: 4 }, { type: 'poison', damage: 2, chance: 0.4 }],
    bonus: { magAtt: 12, defMelee: 4, defRanged: 4, defMagic: 15 }, projectile: 'poison', model: H({ species: 'goblin', outfit: 'shaman', skin: 0x6f9a3a, cloth: 0x3d6b6b, weapon: 'staff', robe: true, scale: 0.75 }) },
  warboss: { name: 'Goblin Warboss', category: 'Goblin Horde', hp: 120, att: 70, str: 80, def: 60, rng: 1, mag: 1, style: 'melee', speed: 5, size: 2,
    abilities: [{ type: 'siege', mult: 3 }, { type: 'cleave', radius: 1, mult: 0.6 }, { type: 'enrage', threshold: 0.4, mult: 1.3 }],
    bonus: { att: 50, str: 60, defMelee: 80, defRanged: 60, defMagic: 10 }, model: H({ species: 'hobgoblin', build: 'heavy', outfit: 'warlord', skin: 0x5f8a2a, cloth: 0x8a2c2c, armor: 0x6b6b6b, weapon: 'greataxe', helm: 'horned', scale: 1.5 }) },

  glider: { name: 'Goblin Glider', category: 'Goblin Horde', fly: true, hp: 14, att: 22, str: 20, def: 8, rng: 1, mag: 1, style: 'melee', speed: 4, move: 2, stamina: 300,
    abilities: [{ type: 'charge', mult: 1.5 }],
    bonus: { att: 14, str: 14, defMelee: 5, defRanged: 5, defMagic: 0 }, model: { body: 'aircraft', kind: 'glider', style: 'goblin' } },
  tinker: { name: 'Goblin Tinker', category: 'Goblin Horde', role: 'support', hp: 12, att: 6, str: 6, def: 5, rng: 1, mag: 1, style: 'melee', speed: 5,
    abilities: [{ type: 'repair', amount: 28 }],
    bonus: { att: 5, str: 5, defMelee: 5, defRanged: 5, defMagic: 0 }, model: H({ species: 'goblin', outfit: 'sapper', skin: 0x6f9a3a, cloth: 0x6a5a2a, weapon: 'club', scale: 0.72, helm: true }) },
  sapper: { name: 'Goblin Sapper', category: 'Goblin Horde', role: 'siege', hp: 14, att: 8, str: 10, def: 5, rng: 1, mag: 1, style: 'melee', speed: 5,
    abilities: [{ type: 'siege', mult: 12 }],
    bonus: { att: 5, str: 5, defMelee: 5, defRanged: 5, defMagic: 0 }, model: H({ species: 'goblin', outfit: 'sapper', skin: 0x6f9a3a, cloth: 0x8a3a1a, weapon: 'axe', scale: 0.72, helm: true }) },

  // ---- Undead ----
  skeleton: { name: 'Skeleton', category: 'Undead', hp: 24, att: 22, str: 22, def: 20, rng: 1, mag: 1, style: 'melee', speed: 4,
    abilities: [{ type: 'protect', style: 'ranged', reduction: 0.3 }],
    bonus: { att: 15, str: 15, defMelee: 25, defRanged: 40, defMagic: -20 }, model: { body: 'skeleton', weapon: 'sword', shield: true } },
  skeletonArcher: { name: 'Skeleton Archer', category: 'Undead', hp: 20, att: 1, str: 1, def: 15, rng: 30, mag: 1, style: 'ranged', speed: 5, range: 7,
    bonus: { rngAtt: 25, rngStr: 15, defMelee: 10, defRanged: 40, defMagic: -20 }, projectile: 'arrow', model: { body: 'skeleton', weapon: 'longbow' } },
  ghoul: { name: 'Ghoul', category: 'Undead', hp: 40, att: 35, str: 38, def: 25, rng: 1, mag: 1, style: 'melee', speed: 3, move: 2, role: 'skirmisher',
    abilities: [{ type: 'poison', damage: 3, chance: 0.3 }],
    bonus: { att: 20, str: 25, defMelee: 15, defRanged: 15, defMagic: 0 }, model: H({ species: 'ghoul', outfit: 'tatters', skin: 0x8a9a8a, cloth: 0x3a3a34, weapon: 'claws', hunch: true }) },
  necromancer: { name: 'Necromancer', category: 'Undead', hp: 40, att: 1, str: 1, def: 25, rng: 1, mag: 70, style: 'magic', speed: 5, range: 8, maxHit: 20,
    abilities: [{ type: 'heal', amount: 10, range: 6 }],
    bonus: { magAtt: 45, defMelee: 10, defRanged: 10, defMagic: 50 }, projectile: 'shadow', model: H({ outfit: 'necromancer', skin: 0xb8b8a8, cloth: 0x2a1f3a, weapon: 'staff', hood: true, robe: true }) },
  boneColossus: { name: 'Bone Colossus', category: 'Undead', hp: 260, att: 90, str: 105, def: 80, rng: 1, mag: 1, style: 'melee', speed: 6, size: 3,
    abilities: [{ type: 'siege', mult: 6 }, { type: 'stomp', every: 10, radius: 2, maxHit: 18 }, { type: 'protect', style: 'ranged', reduction: 0.4 }],
    bonus: { att: 60, str: 80, defMelee: 120, defRanged: 200, defMagic: 20 }, model: { body: 'skeleton', weapon: 'greataxe', scale: 2.6 } },

  bat: { name: 'Vampire Bat', category: 'Undead', fly: true, hp: 16, att: 22, str: 16, def: 10, rng: 1, mag: 1, style: 'melee', speed: 3, move: 2,
    abilities: [{ type: 'regen', amount: 1, every: 3 }],
    bonus: { att: 10, str: 8, defMelee: 10, defRanged: 5, defMagic: 5 }, model: { body: 'bat', fur: 0x2a1f24 } },

  // ---- Beasts & giants ----
  wolf: { name: 'Dire Wolf', category: 'Beasts', hp: 34, att: 38, str: 34, def: 22, rng: 1, mag: 1, style: 'melee', speed: 4, move: 2, role: 'skirmisher',
    bonus: { att: 20, str: 15, defMelee: 10, defRanged: 10, defMagic: 10 }, model: { body: 'quadruped', fur: 0x5b5b5b, scale: 1 } },
  spider: { name: 'Giant Spider', category: 'Beasts', hp: 45, att: 40, str: 40, def: 35, rng: 1, mag: 1, style: 'melee', speed: 4,
    abilities: [{ type: 'poison', damage: 4, chance: 0.35 }],
    bonus: { att: 30, str: 25, defMelee: 40, defRanged: 20, defMagic: 10 }, model: { body: 'spider', fur: 0x2a2420 } },
  troll: { name: 'Hill Troll', category: 'Beasts', hp: 110, att: 60, str: 75, def: 55, rng: 1, mag: 1, style: 'melee', speed: 5, size: 2,
    abilities: [{ type: 'siege', mult: 3 }, { type: 'regen', amount: 3, every: 4 }],
    bonus: { att: 30, str: 50, defMelee: 60, defRanged: 50, defMagic: 10 }, model: H({ species: 'troll', outfit: 'loincloth', skin: 0x6b7f6a, cloth: 0x5a4630, weapon: 'club', scale: 1.7, hunch: true }) },
  ogre: { name: 'Ogre', category: 'Beasts', hp: 90, att: 50, str: 70, def: 45, rng: 1, mag: 1, style: 'melee', speed: 6, size: 2,
    abilities: [{ type: 'siege', mult: 3 }, { type: 'cleave', radius: 1, mult: 0.5 }],
    bonus: { att: 25, str: 45, defMelee: 40, defRanged: 30, defMagic: 10 }, model: H({ species: 'ogre', outfit: 'hides', skin: 0xa6895a, cloth: 0x6b4a2e, weapon: 'club', scale: 1.65 }) },
  cyclops: { name: 'Cyclops', category: 'Beasts', hp: 125, att: 82, str: 92, def: 60, rng: 1, mag: 1, style: 'melee', speed: 6, size: 2,
    abilities: [{ type: 'siege', mult: 4 }, { type: 'stomp', every: 12, radius: 1, maxHit: 12 }],
    bonus: { att: 40, str: 60, defMelee: 50, defRanged: 40, defMagic: 20 }, model: H({ species: 'cyclops', outfit: 'loincloth', skin: 0xc8a07a, cloth: 0x6b4a2e, weapon: 'club', scale: 1.8, cyclops: true }) },
  minotaur: { name: 'Minotaur', category: 'Beasts', hp: 140, att: 85, str: 95, def: 70, rng: 1, mag: 1, style: 'melee', speed: 5, size: 2, move: 2, role: 'skirmisher',
    abilities: [{ type: 'siege', mult: 3 }, { type: 'charge', mult: 1.5 }, { type: 'enrage', threshold: 0.5, mult: 1.2 }],
    bonus: { att: 60, str: 70, defMelee: 70, defRanged: 60, defMagic: 20 }, model: H({ species: 'minotaur', outfit: 'loincloth', skin: 0x5a3a24, cloth: 0x3a2a1a, weapon: 'greataxe', scale: 1.6, horns: true }) },

  harpy: { name: 'Harpy', category: 'Beasts', fly: true, hp: 32, att: 34, str: 28, def: 18, rng: 1, mag: 1, style: 'melee', speed: 4, move: 2,
    bonus: { att: 20, str: 16, defMelee: 15, defRanged: 10, defMagic: 10 }, model: H({ species: 'harpy', outfit: 'feathers', skin: 0xc8a07a, cloth: 0x6a5a8a, weapon: 'claws', wings: true, scale: 0.85 }) },

  // ---- Elemental & infernal ----
  golem: { name: 'Stone Golem', category: 'Elemental', hp: 150, att: 60, str: 70, def: 110, rng: 1, mag: 1, style: 'melee', speed: 7, size: 2,
    abilities: [{ type: 'siege', mult: 5 }, { type: 'protect', style: 'ranged', reduction: 0.5 }],
    bonus: { att: 20, str: 40, defMelee: 180, defRanged: 220, defMagic: -30 }, model: { body: 'golem', stone: 0x8a8580, scale: 1.6 } },
  gargoyle: { name: 'Gargoyle', category: 'Elemental', fly: true, hp: 90, att: 55, str: 60, def: 85, rng: 1, mag: 1, style: 'melee', speed: 5,
    abilities: [{ type: 'protect', style: 'ranged', reduction: 0.4 }],
    bonus: { att: 30, str: 40, defMelee: 120, defRanged: 150, defMagic: -10 }, model: { body: 'golem', stone: 0x6a6a72, scale: 1.1, wings: true } },
  fireElemental: { name: 'Fire Elemental', category: 'Elemental', hp: 60, att: 1, str: 1, def: 40, rng: 1, mag: 60, style: 'magic', speed: 4, range: 6, maxHit: 15,
    abilities: [{ type: 'splash', radius: 1, mult: 0.5 }],
    bonus: { magAtt: 40, defMelee: 60, defRanged: 80, defMagic: 20 }, projectile: 'fire', model: { body: 'elemental', glow: 0xff6a1a } },
  iceWraith: { name: 'Ice Wraith', category: 'Elemental', hp: 55, att: 1, str: 1, def: 45, rng: 1, mag: 65, style: 'magic', speed: 5, range: 7, maxHit: 14,
    bonus: { magAtt: 50, defMelee: 40, defRanged: 40, defMagic: 60 }, projectile: 'ice', model: { body: 'elemental', glow: 0x7fd4ff } },
  imp: { name: 'Lesser Imp', category: 'Infernal', fly: true, hp: 14, att: 12, str: 10, def: 6, rng: 1, mag: 15, style: 'magic', speed: 4, range: 4, maxHit: 4, move: 2,
    bonus: { magAtt: 10, defMelee: 5, defRanged: 5, defMagic: 10 }, projectile: 'fire', model: H({ species: 'imp', outfit: 'none', skin: 0xb33a2a, cloth: 0x2a1a1a, weapon: 'none', scale: 0.6, horns: true, wings: true }) },
  pitFiend: { name: 'Pit Fiend', category: 'Infernal', hp: 160, att: 95, str: 100, def: 75, rng: 1, mag: 60, style: 'melee', speed: 5, size: 2,
    abilities: [{ type: 'siege', mult: 2 }, { type: 'cleave', radius: 1, mult: 0.5 }, { type: 'protect', style: 'melee', reduction: 0.25 }],
    bonus: { att: 70, str: 80, defMelee: 100, defRanged: 80, defMagic: 50 }, model: H({ species: 'demon', outfit: 'loincloth', skin: 0x8a1f1f, cloth: 0x1a1010, weapon: 'greatsword', scale: 1.7, horns: true, wings: true }) },
  infernalLord: { name: 'Infernal Lord', category: 'Infernal', hp: 420, att: 140, str: 150, def: 120, rng: 1, mag: 120, style: 'melee', speed: 5, size: 3,
    abilities: [{ type: 'siege', mult: 4 }, { type: 'cleave', radius: 1, mult: 0.6 }, { type: 'breath', every: 4, maxHit: 30, radius: 2 }, { type: 'regen', amount: 4, every: 5 }],
    bonus: { att: 120, str: 140, defMelee: 200, defRanged: 180, defMagic: 120 }, model: H({ species: 'demon', build: 'heavy', outfit: 'infernalPlate', skin: 0x6a0f0f, cloth: 0x1a0a0a, armor: 0x2a2a2a, weapon: 'greatsword', scale: 2.6, horns: true, wings: true }) },

  // ---- Dragons ----
  wyrmling: { name: 'Wyrmling', category: 'Dragons', fly: true, hp: 80, att: 50, str: 50, def: 50, rng: 1, mag: 40, style: 'melee', speed: 4, size: 2,
    abilities: [{ type: 'breath', every: 3, maxHit: 14, radius: 1 }],
    bonus: { att: 30, str: 30, defMelee: 60, defRanged: 50, defMagic: 40 }, model: { body: 'dragon', scale: 0.8, scales: 0x3a8a3a } },
  drake: { name: 'Elder Drake', category: 'Dragons', fly: true, hp: 240, att: 110, str: 115, def: 110, rng: 1, mag: 100, style: 'melee', speed: 4, size: 3,
    abilities: [{ type: 'breath', every: 3, maxHit: 35, radius: 2 }],
    bonus: { att: 80, str: 90, defMelee: 160, defRanged: 140, defMagic: 100 }, model: { body: 'dragon', scale: 1.4, scales: 0x8a2a2a } },
};

// ---- More troops for every faction ----
Object.assign(UNITS, {
  pikeman: { name: 'Pikeman', category: 'Kingdom', hp: 36, att: 36, str: 34, def: 34, rng: 1, mag: 1, style: 'melee', speed: 5,
    abilities: [{ type: 'protect', style: 'melee', reduction: 0.2 }], bonus: { att: 40, str: 30, defMelee: 70, defRanged: 45, defMagic: -5 },
    model: H({ outfit: 'manAtArms', skin: 0xd9a77c, cloth: 0x2f5aa8, armor: 0x9aa3ad, weapon: 'spear', helm: true }) },
  scout: { name: 'Scout', category: 'Kingdom', role: 'skirmisher', hp: 24, att: 30, str: 24, def: 18, rng: 1, mag: 1, style: 'melee', speed: 3, move: 2,
    abilities: [{ type: 'charge', mult: 1.3 }], bonus: { att: 25, str: 15, defMelee: 20, defRanged: 25, defMagic: 5 },
    model: H({ outfit: 'ranger', skin: 0xd9a77c, cloth: 0x5a6b3a, weapon: 'dagger', hood: true }) },
  grenadier: { name: 'Grenadier', category: 'Kingdom', hp: 30, att: 1, str: 1, def: 26, rng: 44, mag: 1, style: 'ranged', speed: 7, range: 6,
    abilities: [{ type: 'splash', radius: 1, mult: 0.6 }, { type: 'siege', mult: 3 }], bonus: { rngAtt: 35, rngStr: 55, defMelee: 35, defRanged: 35, defMagic: 0 }, projectile: 'rock',
    model: H({ outfit: 'sapper', skin: 0xd9a77c, cloth: 0x7a2c2c, weapon: 'sling', helm: true }) },
  warPriest: { name: 'War Priest', category: 'Kingdom', hp: 60, att: 50, str: 52, def: 55, rng: 1, mag: 45, style: 'melee', speed: 5,
    abilities: [{ type: 'heal', amount: 10, range: 3, charges: 12 }, { type: 'protect', style: 'magic', reduction: 0.3 }], bonus: { att: 50, str: 50, defMelee: 110, defRanged: 100, defMagic: 30 },
    model: H({ outfit: 'paladin', skin: 0xd9a77c, cloth: 0xe8e2d0, armor: 0xc9c2a8, weapon: 'warhammer', helm: true }) },

  goblinSpear: { name: 'Goblin Spearman', category: 'Goblin Horde', hp: 11, att: 8, str: 7, def: 6, rng: 1, mag: 1, style: 'melee', speed: 5,
    abilities: [{ type: 'protect', style: 'melee', reduction: 0.15 }], bonus: { att: 8, str: 5, defMelee: 8, defRanged: 4, defMagic: 0 },
    model: H({ species: 'goblin', outfit: 'rags', skin: 0x6f9a3a, cloth: 0x4a5a30, weapon: 'spear', scale: 0.72, helm: true }) },
  bomber: { name: 'Goblin Bomber', category: 'Goblin Horde', hp: 10, att: 1, str: 1, def: 4, rng: 16, mag: 1, style: 'ranged', speed: 7, range: 5,
    abilities: [{ type: 'splash', radius: 1, mult: 0.7 }, { type: 'siege', mult: 4 }], bonus: { rngAtt: 8, rngStr: 26, defMelee: 2, defRanged: 2, defMagic: 0 }, projectile: 'rock',
    model: H({ species: 'goblin', outfit: 'sapper', skin: 0x6f9a3a, cloth: 0x8a3a1a, weapon: 'sling', scale: 0.72 }) },
  trollShaman: { name: 'Troll Witch-doctor', category: 'Goblin Horde', hp: 85, att: 30, str: 40, def: 40, rng: 1, mag: 55, style: 'magic', speed: 6, range: 6, maxHit: 12, size: 2,
    abilities: [{ type: 'heal', amount: 16, range: 5 }, { type: 'regen', amount: 2, every: 4 }], bonus: { magAtt: 25, defMelee: 40, defRanged: 30, defMagic: 30 }, projectile: 'poison',
    model: H({ species: 'troll', outfit: 'shaman', skin: 0x5a7f6a, cloth: 0x3d6b6b, weapon: 'staff', scale: 1.6, hunch: true }) },

  wight: { name: 'Barrow Wight', category: 'Undead', hp: 75, att: 68, str: 70, def: 62, rng: 1, mag: 30, style: 'melee', speed: 5,
    abilities: [{ type: 'protect', style: 'ranged', reduction: 0.3 }, { type: 'poison', damage: 3, chance: 0.3 }], bonus: { att: 60, str: 62, defMelee: 120, defRanged: 120, defMagic: 10 },
    model: H({ species: 'ghoul', outfit: 'knight', skin: 0x8a9a9a, cloth: 0x2a2a34, armor: 0x4a4a52, weapon: 'greatsword', helm: 'full', scale: 1.1 }) },
  banshee: { name: 'Banshee', category: 'Undead', fly: true, hp: 36, att: 1, str: 1, def: 20, rng: 1, mag: 58, style: 'magic', speed: 5, range: 5, maxHit: 12, move: 2,
    abilities: [{ type: 'splash', radius: 1, mult: 0.4 }], bonus: { magAtt: 40, defMelee: 30, defRanged: 20, defMagic: 50 }, projectile: 'shadow',
    model: H({ species: 'harpy', outfit: 'feathers', skin: 0xb8c8c8, cloth: 0x3a3a4a, weapon: 'none', wings: true, scale: 0.9 }) },
  plagueBearer: { name: 'Plague Bearer', category: 'Undead', hp: 48, att: 30, str: 30, def: 22, rng: 1, mag: 1, style: 'melee', speed: 6,
    abilities: [{ type: 'poison', damage: 4, chance: 0.6 }, { type: 'cleave', radius: 1, mult: 0.4 }], bonus: { att: 15, str: 20, defMelee: 10, defRanged: 10, defMagic: 0 },
    model: H({ species: 'ghoul', outfit: 'tatters', skin: 0x7a8a4a, cloth: 0x4a4a2a, weapon: 'club', hunch: true, build: 'heavy' }) },

  alphaWolf: { name: 'Alpha Wolf', category: 'Beasts', hp: 80, att: 60, str: 58, def: 36, rng: 1, mag: 1, style: 'melee', speed: 4, move: 2, role: 'skirmisher',
    abilities: [{ type: 'regen', amount: 2, every: 4 }, { type: 'charge', mult: 1.4 }], bonus: { att: 35, str: 30, defMelee: 25, defRanged: 20, defMagic: 15 },
    model: { body: 'quadruped', fur: 0x2e2e34, scale: 1.35 } },
  broodmother: { name: 'Spider Broodmother', category: 'Beasts', hp: 150, att: 62, str: 66, def: 55, rng: 1, mag: 1, style: 'melee', speed: 5, size: 2,
    abilities: [{ type: 'poison', damage: 6, chance: 0.5 }, { type: 'cleave', radius: 1, mult: 0.5 }], bonus: { att: 45, str: 45, defMelee: 70, defRanged: 40, defMagic: 20 },
    model: { body: 'spider', fur: 0x3a1f2a, scale: 1.8 } },
  ogreMage: { name: 'Ogre Mage', category: 'Beasts', hp: 100, att: 30, str: 40, def: 42, rng: 1, mag: 70, style: 'magic', speed: 6, range: 7, maxHit: 22, size: 2,
    abilities: [{ type: 'splash', radius: 1, mult: 0.5 }], bonus: { magAtt: 45, defMelee: 40, defRanged: 30, defMagic: 45 }, projectile: 'fire',
    model: H({ species: 'ogre', outfit: 'shaman', skin: 0x7a8ab0, cloth: 0x4a3a7a, weapon: 'staff', scale: 1.6, robe: true }) },

  frostGolem: { name: 'Frost Golem', category: 'Elemental', hp: 130, att: 55, str: 62, def: 95, rng: 1, mag: 1, style: 'melee', speed: 6, size: 2,
    abilities: [{ type: 'protect', style: 'magic', reduction: 0.4 }, { type: 'stomp', every: 9, radius: 1, maxHit: 12 }], bonus: { att: 20, str: 35, defMelee: 150, defRanged: 170, defMagic: 40 },
    model: { body: 'golem', stone: 0xa8c8dc, scale: 1.5 } },
  stormElemental: { name: 'Storm Elemental', category: 'Elemental', hp: 50, att: 1, str: 1, def: 35, rng: 1, mag: 72, style: 'magic', speed: 3, range: 8, maxHit: 12,
    bonus: { magAtt: 55, defMelee: 40, defRanged: 60, defMagic: 40 }, projectile: 'holy', model: { body: 'elemental', glow: 0xffd23a } },

  hellhound: { name: 'Hellhound', category: 'Infernal', hp: 46, att: 48, str: 44, def: 28, rng: 1, mag: 30, style: 'melee', speed: 3, move: 2, role: 'skirmisher',
    abilities: [{ type: 'breath', every: 5, maxHit: 10, radius: 1 }], bonus: { att: 30, str: 25, defMelee: 25, defRanged: 20, defMagic: 30 },
    model: { body: 'quadruped', fur: 0x7a1f14, scale: 1.1 } },
  cultist: { name: 'Cultist', category: 'Infernal', hp: 22, att: 1, str: 1, def: 12, rng: 1, mag: 38, style: 'magic', speed: 5, range: 6, maxHit: 9,
    abilities: [{ type: 'heal', amount: 8, range: 4, charges: 10 }], bonus: { magAtt: 22, defMelee: 5, defRanged: 5, defMagic: 30 }, projectile: 'fire',
    model: H({ outfit: 'necromancer', skin: 0xc8a890, cloth: 0x5a1414, weapon: 'staff', hood: true, robe: true }) },
  hellknight: { name: 'Hell Knight', category: 'Infernal', hp: 110, att: 88, str: 92, def: 82, rng: 1, mag: 40, style: 'melee', speed: 5,
    abilities: [{ type: 'cleave', radius: 1, mult: 0.5 }, { type: 'enrage', threshold: 0.4, mult: 1.3 }], bonus: { att: 80, str: 85, defMelee: 170, defRanged: 150, defMagic: 60 },
    model: H({ species: 'demon', outfit: 'infernalPlate', skin: 0x7a1a1a, cloth: 0x1a0a0a, armor: 0x2a2a2a, weapon: 'greataxe', scale: 1.3, horns: true }) },

  kobold: { name: 'Kobold Spearman', category: 'Dragons', hp: 16, att: 16, str: 14, def: 12, rng: 1, mag: 1, style: 'melee', speed: 4,
    bonus: { att: 12, str: 10, defMelee: 14, defRanged: 10, defMagic: 10 }, model: H({ species: 'goblin', outfit: 'rags', skin: 0xb0502a, cloth: 0x5a2a1a, weapon: 'spear', scale: 0.78 }) },
  dragonKnight: { name: 'Dragon Knight', category: 'Dragons', hp: 85, att: 76, str: 78, def: 76, rng: 1, mag: 30, style: 'melee', speed: 5,
    abilities: [{ type: 'protect', style: 'magic', reduction: 0.35 }, { type: 'cleave', radius: 1, mult: 0.4 }], bonus: { att: 72, str: 70, defMelee: 150, defRanged: 140, defMagic: 40 },
    model: H({ outfit: 'knight', skin: 0xd9a77c, cloth: 0x8a2a1a, armor: 0x7a2a22, weapon: 'halberd', helm: 'full', scale: 1.08 }) },
  whelp: { name: 'Drake Whelp', category: 'Dragons', fly: true, hp: 34, att: 30, str: 28, def: 26, rng: 1, mag: 26, style: 'melee', speed: 4, move: 2,
    abilities: [{ type: 'breath', every: 4, maxHit: 8, radius: 1 }], bonus: { att: 18, str: 16, defMelee: 30, defRanged: 25, defMagic: 25 },
    model: { body: 'dragon', scale: 0.45, scales: 0xb8862a } },
});

// ---- Specialisations ----
// Every kind of unit has trades of its own. A soldier takes one when he becomes a veteran (some
// start with one). stats multiply the unit's own; `gain` adds an ability.
//   hp, max (max hit), roll (accuracy), speed (attack interval), range (+tiles), move (+tiles per tick)
const T = (name, mods) => ({ name, ...mods });
const TRADES = {
  frontShield: [T('Shieldbearer', { hp: 1.15, gain: { type: 'protect', style: 'ranged', reduction: 0.25 } }), T('Swordmaster', { max: 1.2, roll: 1.12 }), T('Sergeant-at-arms', { hp: 1.1, max: 1.08, gain: { type: 'regen', amount: 1, every: 6 } })],
  frontTwoHand: [T('Reaver', { max: 1.25, gain: { type: 'cleave', radius: 1, mult: 0.35 } }), T('Guardsman', { hp: 1.25 }), T('Breaker', { gain: { type: 'siege', mult: 3 }, max: 1.1 })],
  pole: [T('Pikemaster', { gain: { type: 'protect', style: 'melee', reduction: 0.2 }, roll: 1.1 }), T('Skirmisher', { move: 1, hp: 0.9, gain: { type: 'charge', mult: 1.3 } }), T('Halberd-captain', { max: 1.15, hp: 1.1 })],
  bow: [T('Sharpshooter', { roll: 1.25, range: 2, speed: 1.15 }), T('Quickshot', { speed: 0.75, max: 0.9 }), T('Fire archer', { max: 1.1, gain: { type: 'splash', radius: 1, mult: 0.3 } })],
  thrower: [T('Grenadier', { max: 1.2, gain: { type: 'splash', radius: 1, mult: 0.4 } }), T('Sniper', { roll: 1.2, range: 2 }), T('Skirmisher', { move: 1, speed: 0.85 })],
  mage: [T('Pyromancer', { max: 1.25 }), T('Warder', { hp: 1.2, gain: { type: 'protect', style: 'magic', reduction: 0.4 } }), T('Stormcaller', { range: 2, gain: { type: 'splash', radius: 1, mult: 0.35 } })],
  healer: [T('Surgeon', { gain: { type: 'heal', amount: 20, range: 4, charges: 30 } }), T('Battle chaplain', { hp: 1.3, max: 1.3 }), T('Herbalist', { gain: { type: 'regen', amount: 2, every: 4 }, hp: 1.1 })],
  rider: [T('Shock rider', { max: 1.2, gain: { type: 'charge', mult: 1.8 } }), T('Outrider', { move: 1, hp: 0.92 }), T('Heavy horse', { hp: 1.25 })],
  flier: [T('Diver', { max: 1.25, gain: { type: 'charge', mult: 1.6 } }), T('Windrider', { move: 1 }), T('Harrier', { speed: 0.8, roll: 1.1 })],
  brute: [T('Wall-breaker', { gain: { type: 'siege', mult: 5 }, max: 1.1 }), T('Ravager', { max: 1.2, gain: { type: 'cleave', radius: 1, mult: 0.5 } }), T('Thick-hide', { hp: 1.3, gain: { type: 'regen', amount: 2, every: 5 } })],
  beast: [T('Pack leader', { hp: 1.2, max: 1.15 }), T('Stalker', { move: 1, gain: { type: 'charge', mult: 1.4 } }), T('Venomous', { gain: { type: 'poison', damage: 3, chance: 0.4 } })],
  construct: [T('Bulwark', { hp: 1.3 }), T('Crusher', { max: 1.25, gain: { type: 'siege', mult: 4 } }), T('Runebound', { gain: { type: 'protect', style: 'magic', reduction: 0.35 }, roll: 1.1 })],
  siege: [T('Reinforced', { hp: 1.3 }), T('Iron-headed', { max: 1.3 })],
  engineer: [T('Sapper', { gain: { type: 'siege', mult: 6 } }), T('Fortifier', { hp: 1.2, gain: { type: 'repair', amount: 60 } }), T('Quartermaster', { move: 1 })],
};
// each unit's own list; anything not named falls back by what it is
const OWN = {
  militia: [T('Watchman', { hp: 1.2, roll: 1.1 }), T('Pitchfork mob', { max: 1.3 }), T('Runner', { move: 1 })],
  knight: [T('Knight-champion', { max: 1.2, roll: 1.15 }), T('Shield of the realm', { hp: 1.25, gain: { type: 'protect', style: 'ranged', reduction: 0.3 } }), T('Banneret', { hp: 1.1, gain: { type: 'regen', amount: 2, every: 6 } })],
  paladin: [T('Templar', { max: 1.2, gain: { type: 'cleave', radius: 1, mult: 0.4 } }), T('Hospitaller', { gain: { type: 'heal', amount: 12, range: 3, charges: 10 } }), T('Inquisitor', { roll: 1.2, gain: { type: 'protect', style: 'magic', reduction: 0.6 } })],
  goblin: [T('Backstabber', { max: 1.4, roll: 1.1 }), T('Scavenger', { hp: 1.3 }), T('Sneak', { move: 1 })],
  warboss: [T('Tyrant', { hp: 1.2, max: 1.15 }), T('Skull-taker', { max: 1.3 }), T('Iron-gut', { hp: 1.35, gain: { type: 'regen', amount: 3, every: 5 } })],
  skeleton: [T('Grave guard', { hp: 1.25, gain: { type: 'protect', style: 'melee', reduction: 0.2 } }), T('Bone reaver', { max: 1.3 }), T('Restless', { gain: { type: 'regen', amount: 1, every: 4 } })],
  necromancer: [T('Lich-adept', { max: 1.3, range: 1 }), T('Bonebinder', { gain: { type: 'heal', amount: 16, range: 6, charges: 30 } }), T('Soul-leech', { gain: { type: 'regen', amount: 2, every: 3 }, hp: 1.2 })],
  drake: [T('Ancient', { hp: 1.25, max: 1.1 }), T('Firestorm', { gain: { type: 'breath', every: 2, maxHit: 35, radius: 2 } }), T('Ironscale', { gain: { type: 'protect', style: 'ranged', reduction: 0.4 } })],
  infernalLord: [T('Archfiend', { max: 1.2, hp: 1.1 }), T('Lord of cinders', { gain: { type: 'breath', every: 3, maxHit: 36, radius: 2 } }), T('Unbroken', { hp: 1.3 })],
};
function tradesFor(u) {
  if (OWN[u.id]) return OWN[u.id];
  const m = u.model || {}, w = m.weapon, has = (t) => (u.abilities || []).some((a) => a.type === t);
  if (has('repair')) return TRADES.engineer;
  if (has('heal')) return TRADES.healer;
  if (u.role === 'siege') return TRADES.siege;
  if (m.body === 'rider') return TRADES.rider;
  if (u.fly) return TRADES.flier;
  if (u.style === 'magic') return TRADES.mage;
  if (u.style === 'ranged') return w === 'sling' ? TRADES.thrower : TRADES.bow;
  if (m.body === 'golem' || m.body === 'elemental') return TRADES.construct;
  if (m.body === 'quadruped' || m.body === 'spider' || m.body === 'bat' || m.body === 'dragon') return TRADES.beast;
  if ((u.size || 1) >= 2) return TRADES.brute;
  if (w === 'spear' || w === 'halberd' || w === 'lance') return TRADES.pole;
  if (m.shield) return TRADES.frontShield;
  return TRADES.frontTwoHand;
}

// the twenty-seven realms (see realms.js) muster troops built on the roster above
Object.assign(UNITS, realmUnits(UNITS));

// ---- Generals. Every faction has one: a king, warlord or high priest who stands no taller than the troops of
// his kind but is worth a company of them. He keeps to his headquarters; to win, the enemy must kill him and
// hold every rally point. [title, the unit he is drawn from]
export const LEADERS = {
  kingdom: ['King', 'paladin'], goblin: ['Goblin King', 'warboss'], undead: ['Lich King', 'necromancer'], infernal: ['Arch-Fiend', 'hellknight'], beasts: ['Beast Lord', 'minotaur'],
  elemental: ['Stone Speaker', 'frostGolem'], dragons: ['Dragon Lord', 'dragonKnight'],
  graal: ['Grail King', 'graal_questKnight'], aurelia: ['Emperor', 'aurelia_greatsword'], aethel: ['Phoenix King', 'aethel_swordmaster'], kaelneth: ['Witch King', 'kaelneth_executioner'],
  verdant: ['King in the Wood', 'verdant_eternal'], grom: ['High King', 'grom_ironbreaker'], xibalba: ['Sun Speaker', 'xibalba_temple'], velikaya: ['Tsar', 'velikaya_axemen'],
  tianlong: ['Dragon Emperor', 'tianlong_celestialGuard'], ironbound: ['Everchosen Warlord', 'ironbound_chosen'], screaming: ['Herald of the Screaming', 'screaming_brass'],
  cloven: ['Great Beastlord', 'cloven_bestigor'], fimbul: ['Sea King', 'fimbul_huscarl'], ashur: ['High Priest of the Forge', 'ashur_immortal'], greenhide: ['Great Warboss', 'greenhide_bigUn'],
  skar: ['Lord of the Warrens', 'skar_stormrat'], crimson: ['Elder Count', 'crimson_vampire'], khemet: ['King of Kings', 'khemet_king'], drowned: ['Dread Admiral', 'drowned_captain'],
  gorge: ['Overtyrant', 'gorge_ironGut'], westmark: ['Stadtholder', 'westmark_marine'], principalities: ['Merchant Prince', 'principalities_legion'], sunkings: ['King of the Sun', 'sunkings_diestro'],
  caliphate: ['Sultan', 'caliphate_guardA'], shogunate: ['Shogun', 'shogunate_samurai'], mistisles: ['High Chieftain', 'mistisles_chariotM'], thousandgods: ['Maharaja', 'thousandgods_rajput'],
};
/** the unit id of a faction's general */
export const leaderOf = (faction) => (LEADERS[faction] ? `${faction}_leader` : null);
for (const [fid, [title, baseId]] of Object.entries(LEADERS)) {
  const base = UNITS[baseId];
  if (!base) throw new Error(`units: the ${fid} general is drawn from an unknown unit "${baseId}"`);
  const k = 1.5, bonus = Object.fromEntries(Object.entries(base.bonus || {}).map(([key, v]) => [key, Math.round(v > 0 ? v * k + 30 : v)]));
  const abil = (base.abilities || []).filter((a) => !['regen', 'cleave', 'protect', 'heal', 'repair'].includes(a.type));
  UNITS[`${fid}_leader`] = { ...base, name: title, category: base.category, leader: true, role: 'frontline',
    hp: Math.max(360, Math.round(base.hp * 6)), att: Math.round(base.att * k) + 10, str: Math.round(base.str * k) + 10, def: Math.round(base.def * k) + 10,
    rng: base.rng > 1 ? Math.round(base.rng * k) : 1, mag: base.mag > 1 ? Math.round(base.mag * k) : 1, bonus,
    abilities: [...abil, { type: 'regen', amount: 4, every: 5 }, { type: 'cleave', radius: 1, mult: 0.6 }, { type: 'protect', style: 'ranged', reduction: 0.35 }],
    model: { ...(base.model || {}), general: true } };
}

for (const [id, u] of Object.entries(UNITS)) { u.id = id; u.abilities ||= []; u.trades = tradesFor(u); }

// Not a game unit: the sculpting example shown by `viewer.html?kind=unit&id=_example` (see docs/MODELING.md)
export const EXAMPLE_UNIT = { id: '_example', name: 'Sculpting example', hp: 1, att: 1, str: 1, def: 1, rng: 1, mag: 1, style: 'melee', speed: 4, abilities: [], model: { body: 'example' } };
