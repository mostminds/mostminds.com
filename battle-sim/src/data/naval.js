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
  kraken:    { name: 'Kraken',        level: 85, hp: 700, armour: 35, speed: 0.35, size: 4,   attack: { range: 4,   maxHit: 34, speed: 5, acc: 0.65 }, abilities: [{ type: 'grapple', slow: 0.2, duration: 6 }, { type: 'ink', accPenalty: 0.4, duration: 8 }, { type: 'sweep', radius: 5, maxHit: 22, every: 10 }], model: 'kraken', color: 0x7a2a4a },
  leviathan: { name: 'Leviathan',     level: 99, hp: 1200, armour: 45, speed: 0.5, size: 6,   attack: { range: 4,   maxHit: 45, speed: 6, acc: 0.6 }, abilities: [{ type: 'ram', damage: 90, cooldown: 25 }, { type: 'submerge', every: 30, duration: 8 }], model: 'leviathan', color: 0x2a3a5a },
};
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
