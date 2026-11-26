// Placeable map objects. w/h in tiles. Flags drive the engine:
//  blocksMove: impassable        blocksLos: stops arrows/spells (losHeight: how tall, in levels)
//  cover: low obstacle, +35% defence vs shots crossing it
//  level: walkable top at this height (1 per 0.8 m step); units step at most
//         one level at a time unless the structure is a ladder
//  ladder: climbable from any level (watchtowers, bastions)
//  door: only its owner side may pass; enemies must break it
//  hp: can be destroyed; rubble gives cover. stretch: length set per piece (len)
export const STRUCTURES = {
  wall:        { name: 'Stone wall',   w: 4, h: 1, blocksMove: true, blocksLos: true, losHeight: 2, hp: 700, model: 'wall', color: 0x8a8a86 },
  wallLong:    { name: 'Long wall',    w: 8, h: 1, blocksMove: true, blocksLos: true, losHeight: 2, hp: 1200, model: 'wall', color: 0x8a8a86 },
  palisade:    { name: 'Palisade',     w: 4, h: 1, blocksMove: true, blocksLos: true, losHeight: 2, hp: 350, model: 'palisade', color: 0x7a5a36 },
  barricade:   { name: 'Barricade',    w: 3, h: 1, cover: true, hp: 200, model: 'barricade', color: 0x8b6b42 },
  sandbags:    { name: 'Sandbags',     w: 2, h: 1, cover: true, hp: 250, model: 'sandbags', color: 0xc8b48a },
  tower:       { name: 'Watchtower',   w: 2, h: 2, level: 2, ladder: true, hp: 350, model: 'tower', color: 0x9c7a4c },
  keep:        { name: 'Keep',         w: 5, h: 5, blocksMove: true, blocksLos: true, losHeight: 6, hp: 3000, model: 'keep', color: 0x9b9790 },
  house:       { name: 'House',        w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 500, model: 'house', color: 0xc9b38c },
  hut:         { name: 'Hut',          w: 2, h: 2, blocksMove: true, blocksLos: true, losHeight: 2, hp: 250, model: 'hut', color: 0x8d6e4a },
  tent:        { name: 'Tent',         w: 2, h: 2, blocksMove: true, hp: 80, model: 'tent', color: 0xd8cfb5 },
  gate:        { name: 'Archway',      w: 4, h: 2, model: 'gate', color: 0x8a8a86 },
  tree:        { name: 'Tree',         w: 1, h: 1, blocksMove: true, blocksLos: true, losHeight: 3, model: 'tree', color: 0x3f7d3a },
  pine:        { name: 'Pine',         w: 1, h: 1, blocksMove: true, blocksLos: true, losHeight: 3, model: 'pine', color: 0x2e6b3a },
  rock:        { name: 'Boulder',      w: 2, h: 2, blocksMove: true, cover: true, model: 'rock', color: 0x7d7a73 },
  crates:      { name: 'Crates',       w: 1, h: 1, blocksMove: true, cover: true, hp: 60, model: 'crates', color: 0xa07a48 },
  statue:      { name: 'Statue',       w: 1, h: 1, blocksMove: true, blocksLos: true, losHeight: 3, hp: 300, model: 'statue', color: 0xb8b4aa },
  pillar:      { name: 'Pillar',       w: 1, h: 1, blocksMove: true, blocksLos: true, losHeight: 3, hp: 400, model: 'pillar', color: 0xcfc9bb },
  bridge:      { name: 'Raised deck',  w: 4, h: 2, level: 1, ladder: true, hp: 300, model: 'deck', color: 0x8b6b42 },
  bastion:     { name: 'Gun bastion',  w: 4, h: 4, level: 1, ladder: true, hp: 1500, model: 'bastion', color: 0x8f8a80 },

  // ---- Multi-level castle pieces ----
  castleWall:  { name: 'Castle wall',  w: 4, h: 1, stretch: true, level: 2, hp: 1400, model: 'castleWall', color: 0x9a958b },
  castleTower: { name: 'Castle tower', w: 3, h: 3, level: 3, hp: 2200, model: 'castleTower', color: 0x938e84 },
  stairs:      { name: 'Stairs',       w: 2, h: 1, level: 1, hp: 400, model: 'stairs', color: 0x8a857c },
  castleGate:  { name: 'Castle gate',  w: 3, h: 1, door: true, blocksLos: true, losHeight: 2, hp: 900, model: 'castleGate', color: 0x6b4a2e },

  // ---- Crewed weapons ----
  // A weapon fires for whichever side has troops standing next to it and no
  // enemies there; kill the crew and step up to capture it.
  //  level/bonus: accuracy roll like a unit's ranged attack
  //  antiShip: damage multiplier against ships and landing craft
  //  antiAir: can shoot flying units
  //  indirect: lobs over walls (no line of sight needed), minRange: dead zone
  cannon:    { name: 'Cannon',        w: 1, h: 1, blocksMove: true, cover: true, model: 'cannon', color: 0x2e2e2e, hp: 150,
               weapon: { level: 60, bonus: 60, range: 12, maxHit: 28, speed: 8, splash: 1, antiShip: 1.0, siege: 2, shot: 'cannon' } },
  ballista:  { name: 'Ballista',      w: 1, h: 1, blocksMove: true, model: 'ballista', color: 0x7a5a36, hp: 100,
               weapon: { level: 70, bonus: 85, range: 14, maxHit: 36, speed: 7, splash: 0, antiShip: 0.7, antiAir: true, shot: 'bolt' } },
  mortar:    { name: 'Mortar',        w: 1, h: 1, blocksMove: true, model: 'mortar', color: 0x45464a, hp: 140,
               weapon: { level: 50, bonus: 40, range: 22, minRange: 5, maxHit: 24, speed: 12, splash: 2, antiShip: 0.8, indirect: true, siege: 3, shot: 'shell' } },
  battery:   { name: 'Shore battery', w: 2, h: 2, blocksMove: true, cover: true, model: 'battery', color: 0x8a8a86, hp: 400,
               weapon: { level: 70, bonus: 70, range: 20, maxHit: 45, speed: 10, splash: 1, antiShip: 1.8, prefersShips: true, siege: 2, shot: 'cannon' } },
  harpoon:   { name: 'Harpoon gun',   w: 1, h: 1, blocksMove: true, model: 'harpoon', color: 0x6b4a2e, hp: 120,
               weapon: { level: 65, bonus: 75, range: 15, maxHit: 30, speed: 7, splash: 0, antiShip: 1.4, prefersShips: true, antiAir: true, shot: 'bolt' } },
};
for (const [id, d] of Object.entries(STRUCTURES)) d.id = id;
export const isWeapon = (type) => !!STRUCTURES[type]?.weapon;
