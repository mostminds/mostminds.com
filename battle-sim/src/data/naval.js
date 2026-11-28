import { realmShips } from './realms.js';
// Original ship classes and sea creatures. "level" is the sailing level a
// captain needs for the hull. Speeds are tiles per tick, turn in degrees per tick.
// cannons: per broadside. dmg [min,max], range tiles, reload ticks, acc 0..1.
export const SHIPS = {
  raft:      { name: 'Raft',          level: 1,  hull: 40,  armour: 0,  speed: 0.35, turn: 9, crew: 3,  len: 2.2, beam: 1.6,
               cannons: { perSide: 0, dmg: [0, 0], range: 0, reload: 99, acc: 0 }, musket: { range: 6, dmg: [0, 4], reload: 4, acc: 0.5 }, sails: 1, oars: true, color: 0x8b6b42, sail: 0xd8cfb5 },
  skiff:     { name: 'Skiff',         level: 10, hull: 90,  armour: 5,  speed: 0.6,  turn: 10, crew: 6, len: 3.4, beam: 1.6,
               cannons: { perSide: 1, dmg: [4, 12], range: 10, reload: 8, acc: 0.55 }, sails: 1, color: 0x7a5a36, sail: 0xe8e2d0 },
  sloop:     { name: 'Sloop',         level: 25, hull: 160, armour: 10, speed: 0.55, turn: 8, crew: 12, len: 4.5, beam: 2,
               cannons: { perSide: 2, dmg: [6, 16], range: 12, reload: 8, acc: 0.55 }, sails: 1, color: 0x6b4a2e, sail: 0xf0ead8 },
  cutter:    { name: 'Cutter',        level: 35, hull: 200, armour: 12, speed: 0.7,  turn: 9, crew: 14, len: 5, beam: 1.9,
               cannons: { perSide: 2, dmg: [8, 18], range: 13, reload: 7, acc: 0.6 }, sails: 2, color: 0x2f4f6f, sail: 0xf0ead8 },
  brigantine:{ name: 'Brigantine',    level: 50, hull: 320, armour: 18, speed: 0.5,  turn: 6, crew: 26, len: 6.2, beam: 2.4,
               cannons: { perSide: 4, dmg: [8, 20], range: 14, reload: 9, acc: 0.55 }, sails: 2, color: 0x5a3a24, sail: 0xe8e2d0 },
  frigate:   { name: 'Frigate',       level: 65, hull: 480, armour: 25, speed: 0.55, turn: 5, crew: 40, len: 7.5, beam: 2.7,
               cannons: { perSide: 6, dmg: [10, 24], range: 16, reload: 9, acc: 0.55 }, sails: 3, color: 0x3a2a1a, sail: 0xf0ead8 },
  galleon:   { name: 'Galleon',       level: 75, hull: 650, armour: 30, speed: 0.4,  turn: 4, crew: 70, len: 8.5, beam: 3.3,
               cannons: { perSide: 7, dmg: [10, 26], range: 15, reload: 10, acc: 0.5 }, sails: 3, color: 0x6b3a1a, sail: 0xd8c07a },
  manowar:   { name: "Ship of the Line", level: 90, hull: 900, armour: 38, speed: 0.38, turn: 3.5, crew: 90, len: 10, beam: 3.6,
               cannons: { perSide: 10, dmg: [12, 30], range: 17, reload: 11, acc: 0.5 }, sails: 3, color: 0x1f1f2a, sail: 0xf0ead8 },
  // ---- War beasts: sea creatures broken to harness, with a fighting tower and a crew on their backs.
  // They ignore the wind, carry troops (carries), stores (supplies) and sometimes a siege weapon
  // (siege) which they land on an enemy shore in land battles.
  siegeCrab:    { name: 'Siege Crab',    level: 55, hull: 520,  armour: 45, speed: 0.4,  turn: 9,  crew: 18, len: 5,  beam: 4,   beast: 'crab', beastSize: 3.2, carries: 8, siege: 'ballista', supplies: 6,
                  cannons: { perSide: 1, dmg: [14, 30], range: 13, reload: 9, acc: 0.6 }, sails: 0, color: 0xb5462f, sail: 0xd8cfb5 },
  warSerpent:   { name: 'War Serpent',   level: 70, hull: 420,  armour: 20, speed: 0.75, turn: 10, crew: 18, len: 7,  beam: 2,   beast: 'serpent', beastSize: 2.4, carries: 10, supplies: 4,
                  cannons: { perSide: 1, dmg: [8, 20], range: 11, reload: 7, acc: 0.6 }, sails: 0, color: 0x2f6f5a, sail: 0xd8cfb5 },
  leviathanArk: { name: 'Leviathan Ark', level: 95, hull: 1300, armour: 40, speed: 0.33, turn: 4,  crew: 44, len: 11, beam: 5,   beast: 'leviathan', beastSize: 5, carries: 24, siege: 'mortar', supplies: 12,
                  cannons: { perSide: 3, dmg: [14, 34], range: 15, reload: 11, acc: 0.5 }, sails: 0, color: 0x3a4a5a, sail: 0xd8cfb5 },
};

// Creature attacks: range tiles, maxHit, speed ticks, acc 0..1
// Abilities: submerge {every,duration} (untargetable, faster), grapple {slow,duration}
//  ink {accPenalty,duration}, ram {damage,cooldown}, sweep {radius,maxHit,every}, charm {duration,every}
export const CREATURES = {
  crab:      { name: 'Reef Crab',     level: 15, hp: 40,  armour: 20, speed: 0.4,  size: 1,   attack: { range: 1.5, maxHit: 6,  speed: 4, acc: 0.6 }, abilities: [], model: 'crab', color: 0xc0502a },
  shark:     { name: 'Great Shark',   level: 30, hp: 80,  armour: 5,  speed: 0.9,  size: 1.4, attack: { range: 1.5, maxHit: 14, speed: 4, acc: 0.65 }, abilities: [{ type: 'submerge', every: 20, duration: 6 }], model: 'shark', color: 0x6a7a8a },
  eel:       { name: 'Giant Eel',     level: 40, hp: 110, armour: 10, speed: 0.75, size: 1.8, attack: { range: 2,   maxHit: 16, speed: 4, acc: 0.6 }, abilities: [{ type: 'grapple', slow: 0.5, duration: 5 }], model: 'eel', color: 0x3a5a3a },
  siren:     { name: 'Siren',         level: 50, hp: 90,  armour: 5,  speed: 0.6,  size: 1.2, attack: { range: 9,   maxHit: 14, speed: 5, acc: 0.6 }, abilities: [{ type: 'charm', every: 18, duration: 6 }, { type: 'submerge', every: 24, duration: 5 }], model: 'siren', color: 0x6ad0c0 },
  serpent:   { name: 'Sea Serpent',   level: 65, hp: 320, armour: 25, speed: 0.7,  size: 3,   attack: { range: 3,   maxHit: 28, speed: 5, acc: 0.6 }, abilities: [{ type: 'submerge', every: 25, duration: 6 }, { type: 'sweep', radius: 4, maxHit: 18, every: 12 }], model: 'serpent', color: 0x2a6a5a },
  kraken:    { name: 'Kraken',        level: 85, hp: 700, armour: 35, speed: 0.35, size: 4,   attack: { range: 4,   maxHit: 34, speed: 5, acc: 0.65 }, abilities: [{ type: 'grapple', slow: 0.2, duration: 6 }, { type: 'crush', duration: 12, dmg: 10, drag: 0.25 }, { type: 'ink', accPenalty: 0.4, duration: 8 }, { type: 'sweep', radius: 5, maxHit: 22, every: 10 }], model: 'kraken', color: 0x7a2a4a },
  leviathan: { name: 'Leviathan',     level: 99, hp: 1200, armour: 45, speed: 0.5, size: 6,   attack: { range: 4,   maxHit: 45, speed: 6, acc: 0.6 }, abilities: [{ type: 'ram', damage: 90, cooldown: 25 }, { type: 'submerge', every: 30, duration: 8 }], model: 'leviathan', color: 0x2a3a5a },
  // ---- Lords of the deep: independent monsters any fleet may bind or ally with to hunt enemy ships ----
  //  wave {every, range, radius, maxHit, push}   a tidal wave over the target: damage, ships thrown back and slowed
  //  breath {every, range, maxHit, burn, burnDmg, fire}   a cone of steam or fire that sets ships alight
  //  crush {duration, dmg, drag}   holds a ship fast and crushes it; below `drag` of her hull she is pulled under
  //  overboard {chance, crew}   washes or snatches hands off the deck      shear / frenzy {below, mult}   worse against a weakened hull
  //  swallow {every, maxHull, below}   takes small damaged craft whole     breach {over, duration, dmg}   a holed hull takes water
  //  shrugs: share of cannon damage it takes (round shot barely troubles it)   refuses: realms it will not sail with
  triton:      { name: 'Triton',            level: 96, hp: 950,  armour: 30, speed: 0.5,  size: 4.5, attack: { range: 3.5, maxHit: 52, speed: 5, acc: 0.7 }, model: 'triton', alt: 'leviathan', color: 0x4a9a8a,
                 abilities: [{ type: 'wave', every: 22, range: 14, radius: 6, maxHit: 44, push: 5 }, { type: 'overboard', chance: 0.4, crew: 3 }], refuses: ['kaelneth', 'ironbound', 'screaming', 'greenhide'] },
  seaElemental:{ name: 'Sea Elemental',     level: 88, hp: 440,  armour: 0,  speed: 0.65, size: 4,   attack: { range: 2.5, maxHit: 26, speed: 4, acc: 0.75 }, model: 'seaElemental', alt: 'kraken', color: 0x4aa8d8, shrugs: 0.12,
                 abilities: [{ type: 'overboard', chance: 0.8, crew: 5 }, { type: 'grapple', slow: 0.35, duration: 5 }, { type: 'wave', every: 30, range: 6, radius: 4, maxHit: 20, push: 3 }] },
  seaDragon:   { name: 'Sea Dragon',        level: 94, hp: 820,  armour: 35, speed: 0.7,  size: 5,   attack: { range: 3,   maxHit: 40, speed: 5, acc: 0.65 }, model: 'seaDragon', alt: 'serpent', color: 0x2a7a6a,
                 abilities: [{ type: 'breath', every: 16, range: 9, maxHit: 36, burn: 18, burnDmg: 7, fire: true }, { type: 'submerge', every: 34, duration: 5 }] },
  megalodon:   { name: 'Megalodon',         level: 80, hp: 560,  armour: 18, speed: 0.95, size: 4,   attack: { range: 2,   maxHit: 38, speed: 4, acc: 0.7 }, model: 'megalodon', alt: 'shark', color: 0x5a6a78,
                 abilities: [{ type: 'frenzy', below: 0.6, mult: 1.5 }, { type: 'overboard', chance: 0.5, crew: 4 }, { type: 'submerge', every: 22, duration: 5 }] },
  ironshell:   { name: 'Ironshell Colossus', level: 90, hp: 900, armour: 120, speed: 0.34, size: 4.5, attack: { range: 2.5, maxHit: 46, speed: 6, acc: 0.65 }, model: 'ironshell', alt: 'crab', color: 0x8a4a3a, shrugs: 0.55,
                 abilities: [{ type: 'shear', below: 0.4, mult: 2.2 }, { type: 'grapple', slow: 0.4, duration: 4 }] },
  abyssalMaw:  { name: 'Abyssal Maw',       level: 92, hp: 780,  armour: 28, speed: 0.6,  size: 5,   attack: { range: 2.5, maxHit: 44, speed: 5, acc: 0.65 }, model: 'abyssalMaw', alt: 'leviathan', color: 0x1a1424,
                 abilities: [{ type: 'swallow', every: 30, maxHull: 340, below: 0.75 }, { type: 'crush', duration: 8, dmg: 9, drag: 0.22 }, { type: 'submerge', every: 28, duration: 7 }] },
  coilSerpent: { name: 'Great Coil Serpent', level: 78, hp: 600, armour: 28, speed: 0.72, size: 5.5, attack: { range: 3,   maxHit: 30, speed: 5, acc: 0.65 }, model: 'coilSerpent', alt: 'serpent', color: 0x3a6a4a,
                 abilities: [{ type: 'crush', duration: 10, dmg: 8, drag: 0.12 }, { type: 'sweep', radius: 5, maxHit: 20, every: 12 }, { type: 'submerge', every: 26, duration: 6 }] },
  behemoth:    { name: 'Horned Behemoth',   level: 99, hp: 1500, armour: 50, speed: 0.55, size: 6.5, attack: { range: 3.5, maxHit: 48, speed: 6, acc: 0.6 }, model: 'behemoth', alt: 'leviathan', color: 0x2a3444,
                 abilities: [{ type: 'ram', damage: 130, cooldown: 20 }, { type: 'breach', over: 14, duration: 24, dmg: 8 }, { type: 'submerge', every: 32, duration: 8 }] },
  // ---- Hunters of the frozen sea ----
  //  breath {.., freeze: {slow, duration}}   a frost breath slows ships and their gun crews instead of burning them
  tuskWalrus:  { name: 'Tusk-Lord Walrus',  level: 83, hp: 900,  armour: 45, speed: 0.5,  size: 4,   attack: { range: 2.5, maxHit: 44, speed: 5, acc: 0.68 }, model: 'tuskWalrus', alt: 'leviathan', color: 0x7a6252, arctic: true,
                 abilities: [{ type: 'breach', over: 14, duration: 15, dmg: 6 }, { type: 'sweep', radius: 4, maxHit: 18, every: 12 }] },
  orca:        { name: 'Killer Whale',      level: 50, hp: 190,  armour: 10, speed: 1.05, size: 3,   attack: { range: 1.5, maxHit: 20, speed: 3, acc: 0.72 }, model: 'orca', alt: 'shark', color: 0x16181c, arctic: true,
                 abilities: [{ type: 'pack', radius: 9, bonus: 0.3 }, { type: 'overboard', chance: 0.4, crew: 2 }, { type: 'submerge', every: 20, duration: 4 }] },
  narwhal:     { name: 'Narwhal',           level: 42, hp: 130,  armour: 8,  speed: 1.0,  size: 2.5, attack: { range: 1.5, maxHit: 12, speed: 4, acc: 0.65 }, model: 'narwhal', alt: 'shark', color: 0x9aa4ac, arctic: true, turn: 10,
                 abilities: [{ type: 'ram', damage: 16, cooldown: 10, perTile: 3, max: 50 }, { type: 'pack', radius: 8, bonus: 0.2 }] },
  iceKraken:   { name: 'Rime Kraken',       level: 87, hp: 760,  armour: 40, speed: 0.4,  size: 4.5, attack: { range: 4,   maxHit: 34, speed: 5, acc: 0.65 }, model: 'iceKraken', alt: 'kraken', color: 0xb8d8e8, arctic: true,
                 abilities: [{ type: 'crush', duration: 12, dmg: 9, drag: 0.22 }, { type: 'grapple', slow: 0.15, duration: 7 }, { type: 'sweep', radius: 5, maxHit: 20, every: 11 }] },
  polarSerpent:{ name: 'Polar Serpent',     level: 80, hp: 620,  armour: 26, speed: 0.75, size: 5,   attack: { range: 3,   maxHit: 30, speed: 5, acc: 0.65 }, model: 'polarSerpent', alt: 'serpent', color: 0xe8f0f4, arctic: true,
                 abilities: [{ type: 'breath', every: 14, range: 9, maxHit: 22, freeze: { slow: 0.3, duration: 9 } }, { type: 'crush', duration: 8, dmg: 7, drag: 0.1 }, { type: 'submerge', every: 26, duration: 6 }] },
  bergTitan:   { name: 'Berg Titan',        level: 90, hp: 1100, armour: 60, speed: 0.3,  size: 4.5, attack: { range: 3,   maxHit: 46, speed: 6, acc: 0.6 }, model: 'bergTitan', alt: 'leviathan', color: 0xcfe6f2, arctic: true, shrugs: 0.5, turn: 7,
                 abilities: [{ type: 'wave', every: 26, range: 10, radius: 5, maxHit: 30, push: 4 }, { type: 'breath', every: 20, range: 7, maxHit: 16, freeze: { slow: 0.25, duration: 10 } }] },
  // ---- Hunters of other waters: kin of the beasts above, bred by their own seas ----
  cinderSerpent:{ name: 'Cinder Serpent',   level: 82, hp: 640,  armour: 34, speed: 0.7,  size: 5,   attack: { range: 3,   maxHit: 30, speed: 5, acc: 0.65 }, model: 'coilSerpent', alt: 'serpent', color: 0x4a1a12, waters: 'volcanic',
                 abilities: [{ type: 'breath', every: 15, range: 8, maxHit: 30, burn: 15, burnDmg: 7, fire: true }, { type: 'crush', duration: 8, dmg: 8, drag: 0.1 }, { type: 'submerge', every: 26, duration: 6 }] },
  magmaCrab:   { name: 'Magma Crab',        level: 84, hp: 760,  armour: 110, speed: 0.36, size: 4,  attack: { range: 2.5, maxHit: 40, speed: 6, acc: 0.65 }, model: 'ironshell', alt: 'crab', color: 0x2a1614, shrugs: 0.6, waters: 'volcanic',
                 abilities: [{ type: 'shear', below: 0.4, mult: 2 }, { type: 'breath', every: 24, range: 5, maxHit: 18, burn: 12, burnDmg: 6, fire: true }] },
  bogLurker:   { name: 'Bog Lurker',        level: 78, hp: 620,  armour: 24, speed: 0.55, size: 4,   attack: { range: 2.5, maxHit: 38, speed: 5, acc: 0.65 }, model: 'abyssalMaw', alt: 'leviathan', color: 0x2a3a22, waters: 'swamp',
                 abilities: [{ type: 'swallow', every: 30, maxHull: 260, below: 0.8 }, { type: 'grapple', slow: 0.3, duration: 6 }, { type: 'submerge', every: 20, duration: 8 }] },
  mireEel:     { name: 'Mire Eel',          level: 55, hp: 220,  armour: 12, speed: 0.85, size: 2.6, attack: { range: 2,   maxHit: 22, speed: 4, acc: 0.65 }, model: 'eel', color: 0x3a3a1e, waters: 'swamp',
                 abilities: [{ type: 'grapple', slow: 0.4, duration: 6 }, { type: 'pack', radius: 8, bonus: 0.25 }, { type: 'submerge', every: 16, duration: 5 }] },
  reefDrake:   { name: 'Coral Drake',       level: 86, hp: 700,  armour: 32, speed: 0.7,  size: 4.5, attack: { range: 3,   maxHit: 36, speed: 5, acc: 0.65 }, model: 'seaDragon', alt: 'serpent', color: 0xd87a6a, waters: 'desert',
                 abilities: [{ type: 'breath', every: 16, range: 8, maxHit: 28, burn: 14, burnDmg: 6 }, { type: 'submerge', every: 30, duration: 5 }] },
  sandCrab:    { name: 'Dune Crab',         level: 48, hp: 200,  armour: 60, speed: 0.5,  size: 2.4, attack: { range: 1.5, maxHit: 18, speed: 4, acc: 0.62 }, model: 'crab', color: 0xd8b070, waters: 'desert',
                 abilities: [{ type: 'pack', radius: 7, bonus: 0.2 }, { type: 'grapple', slow: 0.5, duration: 4 }] },
  riverTyrant: { name: 'River Tyrant',      level: 80, hp: 640,  armour: 26, speed: 0.9,  size: 4.2, attack: { range: 2.5, maxHit: 40, speed: 4, acc: 0.7 }, model: 'tylosaurus', alt: 'serpent', color: 0x2a6a2a, waters: 'jungle',
                 abilities: [{ type: 'overboard', chance: 0.7, crew: 5 }, { type: 'frenzy', below: 0.6, mult: 1.4 }, { type: 'submerge', every: 18, duration: 6 }] },
  lagoonSquid: { name: 'Lagoon Strangler',  level: 74, hp: 420,  armour: 10, speed: 0.95, size: 3.6, attack: { range: 2.5, maxHit: 22, speed: 4, acc: 0.7 }, model: 'tusoteuthis', alt: 'kraken', color: 0x2aa88a, waters: 'jungle',
                 abilities: [{ type: 'snare', every: 18, range: 8, duration: 12, slow: 0.45 }, { type: 'crush', duration: 9, dmg: 7, drag: 0.1 }, { type: 'ink', accPenalty: 0.3, duration: 6 }] },
  // ---- Beasts bound to the newer realms: each fleet brings its own ----
  brassLeviathan:   { name: 'Brass Leviathan',      level: 97, hp: 1100, armour: 70, speed: 0.55, size: 5.5, attack: { range: 3,   maxHit: 46, speed: 5, acc: 0.68 }, model: 'brassLeviathan', alt: 'megalodon', color: 0xb07a2a, shrugs: 0.6, realm: 'kharnak',
                      abilities: [{ type: 'breath', every: 14, range: 7, maxHit: 30, burn: 16, burnDmg: 8 }, { type: 'sweep', radius: 5, maxHit: 26, every: 11 }, { type: 'shear', below: 0.5, mult: 1.8 }] },
  sumpKraken:       { name: 'Sump-Kraken',          level: 90, hp: 820,  armour: 22, speed: 0.4,  size: 5,   attack: { range: 4,   maxHit: 30, speed: 5, acc: 0.65 }, model: 'sumpKraken', alt: 'kraken', color: 0x9ab87a, realm: 'morbus',
                      abilities: [{ type: 'crush', duration: 12, dmg: 9, drag: 0.2 }, { type: 'breach', over: 10, duration: 24, dmg: 7 }, { type: 'snare', every: 16, range: 8, duration: 12, slow: 0.5 }] },
  astralNautilus:   { name: 'Astral Nautilus',      level: 93, hp: 760,  armour: 60, speed: 0.45, size: 5,   attack: { range: 7,   maxHit: 30, speed: 5, acc: 0.7 }, model: 'astralNautilus', alt: 'kraken', color: 0x7a9ae8, shrugs: 0.5, realm: 'labyrinth',
                      abilities: [{ type: 'wave', every: 20, range: 12, radius: 5, maxHit: 30, push: 6 }, { type: 'snare', every: 18, range: 10, duration: 10, slow: 0.5 }, { type: 'charm', every: 22, duration: 6 }] },
  sirenScolopendra: { name: 'Siren-Scolopendra',    level: 92, hp: 780,  armour: 26, speed: 0.75, size: 6,   attack: { range: 3,   maxHit: 34, speed: 5, acc: 0.68 }, model: 'sirenScolopendra', alt: 'serpent', color: 0xb87ad8, realm: 'velvet',
                      abilities: [{ type: 'charm', every: 16, duration: 8 }, { type: 'crush', duration: 10, dmg: 8, drag: 0.15 }, { type: 'snare', every: 20, range: 9, duration: 10, slow: 0.4 }] },
  ironcladLeviathan:{ name: 'Ironclad Leviathan',   level: 95, hp: 1000, armour: 90, speed: 0.45, size: 5.5, attack: { range: 2.5, maxHit: 46, speed: 6, acc: 0.65 }, model: 'ironcladLeviathan', alt: 'abyssalMaw', color: 0x3a3a40, shrugs: 0.5, realm: 'malvash',
                      abilities: [{ type: 'charm', every: 24, duration: 7 }, { type: 'swallow', every: 26, maxHull: 380, below: 0.8 }, { type: 'ram', damage: 80, cooldown: 22 }] },
  abyssalOuroboros: { name: 'Abyssal Ouroboros',    level: 96, hp: 980,  armour: 34, speed: 0.6,  size: 6.5, attack: { range: 3.5, maxHit: 40, speed: 5, acc: 0.65 }, model: 'abyssalOuroboros', alt: 'coilSerpent', color: 0x1a1a24, realm: 'ashhorde',
                      abilities: [{ type: 'crush', duration: 12, dmg: 11, drag: 0.3 }, { type: 'sweep', radius: 6, maxHit: 24, every: 12 }, { type: 'submerge', every: 28, duration: 7 }] },
  balorMaw:         { name: 'Balor-Maw',            level: 86, hp: 640,  armour: 40, speed: 0.6,  size: 4.5, attack: { range: 2.5, maxHit: 34, speed: 5, acc: 0.65 }, model: 'balorMaw', alt: 'eel', color: 0x3a4a3a, realm: 'balor',
                      abilities: [{ type: 'breath', every: 14, range: 12, maxHit: 26, burn: 14, burnDmg: 6 }, { type: 'grapple', slow: 0.4, duration: 6 }, { type: 'submerge', every: 20, duration: 7 }] },
  baikalWyrm:       { name: 'Steppe-Kraken',        level: 82, hp: 760,  armour: 40, speed: 0.6,  size: 4.5, attack: { range: 2.5, maxHit: 40, speed: 5, acc: 0.66 }, model: 'baikalWyrm', alt: 'tuskWalrus', color: 0xc8c0b0, arctic: true, realm: 'kurgan',
                      abilities: [{ type: 'breach', over: 12, duration: 18, dmg: 7 }, { type: 'overboard', chance: 0.5, crew: 4 }, { type: 'submerge', every: 22, duration: 6 }] },
  riverPike:        { name: 'Old Man of the River', level: 72, hp: 520,  armour: 40, speed: 0.6,  size: 4,   attack: { range: 2.5, maxHit: 36, speed: 5, acc: 0.66 }, model: 'riverPike', alt: 'megalodon', color: 0x5a6a3a, realm: 'hearthmoot', waters: 'swamp',
                      abilities: [{ type: 'swallow', every: 30, maxHull: 300, below: 0.9 }, { type: 'submerge', every: 22, duration: 7 }] },
  nyamiNyami:       { name: 'River-Serpent Nyami-Nyami', level: 84, hp: 620, armour: 28, speed: 0.75, size: 5, attack: { range: 3,   maxHit: 32, speed: 5, acc: 0.66 }, model: 'nyamiNyami', alt: 'seaDragon', color: 0x5a8a7a, realm: 'baobab',
                      abilities: [{ type: 'wave', every: 18, range: 12, radius: 6, maxHit: 32, push: 5 }, { type: 'submerge', every: 24, duration: 6 }] },
  vasukiLeviathan:  { name: 'Vasuki-Leviathan',     level: 97, hp: 1000, armour: 36, speed: 0.6,  size: 6.5, attack: { range: 3.5, maxHit: 42, speed: 5, acc: 0.66 }, model: 'vasukiLeviathan', alt: 'coilSerpent', color: 0x2a8a5a, realm: 'nagavar',
                      abilities: [{ type: 'crush', duration: 14, dmg: 12, drag: 0.25 }, { type: 'sweep', radius: 6, maxHit: 24, every: 12 }, { type: 'breath', every: 20, range: 6, maxHit: 20, burn: 10, burnDmg: 5 }] },
  cetusPrimeval:    { name: 'Cetus-Primeval',       level: 96, hp: 1150, armour: 46, speed: 0.55, size: 6,   attack: { range: 4,   maxHit: 40, speed: 6, acc: 0.65 }, model: 'cetusPrimeval', alt: 'leviathan', color: 0xe8e0d0, realm: 'pearlfleet',
                      abilities: [{ type: 'wave', every: 20, range: 14, radius: 6, maxHit: 38, push: 5 }, { type: 'ram', damage: 90, cooldown: 24 }] },
  mirageLeviathan:  { name: 'Mirage-Leviathan',     level: 70, hp: 260,  armour: 0,  speed: 0.8,  size: 6,   attack: { range: 3,   maxHit: 8,  speed: 5, acc: 0.5 }, model: 'mirageLeviathan', alt: 'serpent', color: 0xb8d8f0, shrugs: 0.15, realm: 'glimmer',
                      abilities: [{ type: 'charm', every: 10, duration: 8 }, { type: 'submerge', every: 14, duration: 6 }] },
  wolfEel:          { name: 'Wolf-Eel of the Black Gulf', level: 58, hp: 230, armour: 12, speed: 0.95, size: 2.8, attack: { range: 2, maxHit: 22, speed: 4, acc: 0.68 }, model: 'wolfEel', alt: 'eel', color: 0x3a3a3a, realm: 'khanate',
                      abilities: [{ type: 'pack', radius: 9, bonus: 0.3 }, { type: 'shear', below: 0.6, mult: 1.6 }, { type: 'frenzy', below: 0.5, mult: 1.4 }] },
  matriarchCaiman:  { name: 'Matriarch-Caiman',     level: 88, hp: 820,  armour: 55, speed: 0.6,  size: 5,   attack: { range: 2.5, maxHit: 48, speed: 5, acc: 0.68 }, model: 'matriarchCaiman', alt: 'tylosaurus', color: 0x4a5a2a, realm: 'emerald', waters: 'jungle',
                      abilities: [{ type: 'shear', below: 0.5, mult: 2.2 }, { type: 'overboard', chance: 0.6, crew: 4 }, { type: 'submerge', every: 22, duration: 6 }] },
  mangroveHydra:    { name: 'Mangrove-Hydra',       level: 85, hp: 900,  armour: 40, speed: 0.3,  size: 5,   attack: { range: 3.5, maxHit: 30, speed: 5, acc: 0.66 }, model: 'mangroveHydra', alt: 'ironshell', color: 0x4a5a2a, realm: 'deeproot', waters: 'swamp',
                      abilities: [{ type: 'snare', every: 14, range: 8, duration: 14, slow: 0.6 }, { type: 'crush', duration: 9, dmg: 8, drag: 0.12 }, { type: 'grapple', slow: 0.3, duration: 8 }] },
  zaratan:          { name: 'Zaratan',              level: 99, hp: 1600, armour: 80, speed: 0.3,  size: 7,   attack: { range: 3.5, maxHit: 44, speed: 6, acc: 0.62 }, model: 'zaratan', alt: 'ironshell', color: 0x7a8a5a, shrugs: 0.45, realm: 'goldsands',
                      abilities: [{ type: 'ram', damage: 110, cooldown: 26 }, { type: 'wave', every: 28, range: 10, radius: 6, maxHit: 30, push: 4 }] },
  bahamut:          { name: 'Bahamut',              level: 94, hp: 820,  armour: 30, speed: 0.8,  size: 5.5, attack: { range: 3,   maxHit: 36, speed: 5, acc: 0.68 }, model: 'bahamut', alt: 'megalodon', color: 0xd8e0e8, realm: 'goldsands',
                      abilities: [{ type: 'snare', every: 14, range: 10, duration: 10, slow: 0.55 }, { type: 'wave', every: 22, range: 12, radius: 5, maxHit: 30, push: 5 }] },
  // ---- Beasts of the ancient seas: prehistoric hunters broken to war ----
  //  pierce {plate, mult}   armour does not count against its bite; against plate of `plate` or more it bites harder still
  //  ram {.., perTile, max, through}   builds damage over a straight run; `through` ignores armour     jet {cycle, burst, speed}   moves in straight bursts
  //  keelbreak {below, chance}   may sink a weakened ship outright     snare {every, range, duration, slow}   fouls the rudder: no turning
  //  pack {radius, bonus}   bites harder for each of its kind nearby     oarbreak {slow, duration}   cripples oared ships
  //  leap {chance, crew}   snatches topmen from the rigging     screen: enemy ships within this range shoot at it first     attack.reach: strikes at range with its neck
  dunkleosteus:{ name: 'Dunkleosteus',  level: 82, hp: 620,  armour: 70, speed: 0.6,  size: 3.5, attack: { range: 2,   maxHit: 46, speed: 5, acc: 0.7 }, model: 'dunkleosteus', alt: 'shark', color: 0x6a7a4a, shrugs: 0.75,
                 abilities: [{ type: 'pierce', plate: 30, mult: 1.35 }] },
  leedsichthys:{ name: 'Leedsichthys',  level: 86, hp: 2600, armour: 25, speed: 0.3,  size: 7,   attack: { range: 3,   maxHit: 16, speed: 6, acc: 0.6 }, model: 'leedsichthys', alt: 'leviathan', color: 0xc8a03a, screen: 16, turn: 6,
                 abilities: [{ type: 'sweep', radius: 5, maxHit: 12, every: 14 }] },
  tylosaurus:  { name: 'Tylosaurus',    level: 84, hp: 720,  armour: 24, speed: 0.95, size: 4.5, attack: { range: 2.5, maxHit: 42, speed: 4, acc: 0.72 }, model: 'tylosaurus', alt: 'serpent', color: 0x5a7a3a,
                 abilities: [{ type: 'overboard', chance: 0.7, crew: 5 }, { type: 'sweep', radius: 3.5, maxHit: 16, every: 9 }, { type: 'submerge', every: 20, duration: 5 }] },
  shonisaurus: { name: 'Shonisaurus',   level: 85, hp: 700,  armour: 22, speed: 1.05, size: 5,   attack: { range: 2.5, maxHit: 24, speed: 5, acc: 0.65 }, model: 'shonisaurus', alt: 'shark', color: 0xa8482a, turn: 9,
                 abilities: [{ type: 'ram', damage: 40, cooldown: 14, perTile: 5, max: 150 }, { type: 'breach', over: 12, duration: 15, dmg: 6 }] },
  kronosaurus: { name: 'Kronosaurus',   level: 93, hp: 1050, armour: 35, speed: 0.7,  size: 5,   attack: { range: 2.5, maxHit: 76, speed: 6, acc: 0.66 }, model: 'kronosaurus', alt: 'leviathan', color: 0xc86a2a,
                 abilities: [{ type: 'keelbreak', below: 0.45, chance: 0.5 }, { type: 'submerge', every: 28, duration: 5 }] },
  elasmosaurus:{ name: 'Elasmosaurus',  level: 76, hp: 480,  armour: 15, speed: 0.6,  size: 5,   attack: { range: 7,   maxHit: 12, speed: 3, acc: 0.8, reach: true }, model: 'elasmosaurus', alt: 'serpent', color: 0xc89a4a,
                 abilities: [{ type: 'overboard', chance: 0.9, crew: 4 }, { type: 'leap', chance: 0.35, crew: 2 }] },
  tusoteuthis: { name: 'Tusoteuthis',   level: 79, hp: 460,  armour: 10, speed: 1.0,  size: 4,   attack: { range: 2.5, maxHit: 24, speed: 4, acc: 0.7 }, model: 'tusoteuthis', alt: 'kraken', color: 0xc8322a,
                 abilities: [{ type: 'snare', every: 18, range: 9, duration: 12, slow: 0.45 }, { type: 'crush', duration: 9, dmg: 7, drag: 0.1 }, { type: 'ink', accPenalty: 0.3, duration: 6 }] },
  orthoceras:  { name: 'Orthoceras',    level: 72, hp: 320,  armour: 60, speed: 0.55, size: 3.5, attack: { range: 1.5, maxHit: 14, speed: 5, acc: 0.6 }, model: 'orthoceras', alt: 'eel', color: 0xd8c8a0, jet: { cycle: 11, burst: 5, speed: 3.4 },
                 abilities: [{ type: 'ram', damage: 24, cooldown: 10, perTile: 6, max: 80, through: true }, { type: 'breach', over: 10, duration: 12, dmg: 5 }] },
  xiphactinus: { name: 'Xiphactinus',   level: 45, hp: 140,  armour: 8,  speed: 1.1,  size: 2.5, attack: { range: 1.5, maxHit: 18, speed: 3, acc: 0.7 }, model: 'xiphactinus', alt: 'shark', color: 0x2a9a6a,
                 abilities: [{ type: 'pack', radius: 8, bonus: 0.25 }, { type: 'frenzy', below: 0.8, mult: 1.6 }, { type: 'oarbreak', slow: 0.4, duration: 8 }] },
  styxosaurus: { name: 'Styxosaurus',   level: 60, hp: 300,  armour: 12, speed: 1.0,  size: 3,   attack: { range: 4,   maxHit: 16, speed: 3, acc: 0.8, reach: true }, model: 'styxosaurus', alt: 'serpent', color: 0x3a5a8a,
                 abilities: [{ type: 'leap', chance: 0.7, crew: 3 }, { type: 'overboard', chance: 0.5, crew: 2 }, { type: 'submerge', every: 18, duration: 4 }] },
};
// ---- Diving boats. A submersible goes under as she closes (nothing can aim at her then, and pack ice does not
// stop her), comes up within torpedo range and looses ahead: a torpedo counts well under half the target's armour
// and leaves her taking water. dive { every, duration, range }   torpedo { dmg, range, reload, acc }   engine: no need of wind
export const SUBMERSIBLE = { level: 55, hull: 260, armour: 30, speed: 0.55, turn: 9, crew: 18, len: 5.5, beam: 1.5, kind: 'submersible', engine: true, sails: 0,
  cannons: { perSide: 1, dmg: [6, 14], range: 9, reload: 9, acc: 0.5 }, torpedo: { dmg: [34, 72], range: 10, reload: 8, acc: 0.75 }, dive: { every: 12, duration: 8, range: 24 } };
Object.assign(SHIPS, {
  kingdomSub:  { ...SUBMERSIBLE, name: 'Royal Diving Boat',  color: 0x7a5a36, sail: 0x2f5aa8, trim: 0xc9a23a },
  goblinSub:   { ...SUBMERSIBLE, name: 'Scrap Diver',        color: 0x5a4a36, sail: 0x8a7a4a, trim: 0x8a8070, hull: 200, armour: 16, crew: 22, torpedo: { dmg: [24, 84], range: 9, reload: 8, acc: 0.62 } },
  undeadSub:   { ...SUBMERSIBLE, name: 'Coffin Diver',       color: 0x2a2630, sail: 0x8a8a78, trim: 0x9a9a8a, crew: 14 },
  infernalSub: { ...SUBMERSIBLE, name: 'Brimstone Lurker',   color: 0x2a1a1a, sail: 0xff5a14, trim: 0xb0782a, hull: 320, armour: 38, speed: 0.48 },
});
Object.assign(SHIPS, realmShips(SHIPS, SUBMERSIBLE)); // each realm's own hulls and diving boats (see realms.js)
for (const [id, s] of Object.entries(SHIPS)) s.id = id;
for (const [id, c] of Object.entries(CREATURES)) c.id = id;

// Island forts for naval battles. They never move, fire in every direction,
// and can be stormed: a ship that comes alongside with a bigger crew than the
// garrison lands a boarding party, and a fort whose garrison falls changes hands.
// weapon: shots per volley, dmg [min,max], range, reload ticks, acc,
//  minRange (mortars), splash radius, vsCreature multiplier, grapple {slow, duration}
export const FORTS = {
  battery:  { name: 'Shore battery',  level: 40, hp: 450,  armour: 30, garrison: 30, size: 2.2, model: 'battery',
              weapon: { shots: 3, dmg: [10, 28], range: 18, reload: 9, acc: 0.55 } },
  mortar:   { name: 'Mortar battery', level: 55, hp: 380,  armour: 25, garrison: 24, size: 2,   model: 'mortar',
              weapon: { shots: 2, dmg: [16, 34], range: 26, minRange: 7, reload: 14, acc: 0.4, splash: 3 } },
  harpoon:  { name: 'Harpoon tower',  level: 45, hp: 320,  armour: 20, garrison: 16, size: 1.8, model: 'harpoon',
              weapon: { shots: 1, dmg: [14, 32], range: 15, reload: 7, acc: 0.65, vsCreature: 2.2, grapple: { slow: 0.4, duration: 6 } } },
  seaFort:  { name: 'Sea fort',       level: 80, hp: 1400, armour: 45, garrison: 120, size: 4,   model: 'seaFort',
              weapon: { shots: 8, dmg: [12, 30], range: 20, reload: 10, acc: 0.55 } },
};
for (const [id, f] of Object.entries(FORTS)) f.id = id;
