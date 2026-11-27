import { readyLandmarks } from './realms.js';
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
  dock:          { name: 'Dock',           w: 6, h: 2, level: 1, ladder: true, overWater: true, hp: 450, model: 'dock', color: 0x8b6b42 },
  zeppelinTower: { name: 'Zeppelin tower', w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 6, hp: 1300, mooring: true, model: 'zeppelinTower', color: 0x8f8a80 },
  hangar:        { name: 'Hangar',         w: 5, h: 4, blocksMove: true, blocksLos: true, losHeight: 4, hp: 900, model: 'hangar', color: 0x7a6a52 },
  workshop:      { name: 'Workshop',       w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 600, model: 'workshop', color: 0x9a7a52 },
  // ---- Civic buildings and districts ----
  marketHall:  { name: 'Market hall',     w: 4, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 700, cargo: 4, model: 'marketHall', color: 0xb98a52 },
  stall:       { name: 'Market stall',    w: 2, h: 1, blocksMove: true, cover: true, hp: 90, model: 'stall', color: 0xc24a3a },
  bank:        { name: 'Bank',            w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 4, hp: 1400, model: 'bank', color: 0xb8b0a0 },
  inn:         { name: 'Inn',             w: 4, h: 3, blocksMove: true, blocksLos: true, losHeight: 4, hp: 650, heals: 1, model: 'inn', color: 0xc9a87a },
  garden:      { name: 'Garden',          w: 3, h: 3, cover: true, model: 'garden', color: 0x4f8a3f },
  fountain:    { name: 'Fountain',        w: 2, h: 2, blocksMove: true, cover: true, hp: 300, model: 'fountain', color: 0xb8b4aa },
  barracks:    { name: 'Barracks',        w: 5, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 1100, model: 'barracks', color: 0x8a7a66 },
  temple:      { name: 'Temple',          w: 4, h: 5, blocksMove: true, blocksLos: true, losHeight: 6, hp: 1600, heals: 2, model: 'temple', color: 0xd8d0bc },
  shrine:      { name: 'Shrine',          w: 2, h: 2, blocksMove: true, blocksLos: true, losHeight: 3, hp: 350, heals: 1, model: 'shrine', color: 0xcfc9bb },
  alchemist:   { name: "Alchemist's lab", w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 4, hp: 500, volatile: 3, model: 'alchemist', color: 0x6a5a8a },
  dockhouse:   { name: 'Dock house',      w: 4, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 600, cargo: 6, model: 'dockhouse', color: 0x7a6248 },
  palace:      { name: 'Palace',          w: 7, h: 6, blocksMove: true, blocksLos: true, losHeight: 7, hp: 4000, model: 'palace', color: 0xe0d6b8 },
  graveyard:   { name: 'Graveyard',       w: 4, h: 4, cover: true, model: 'graveyard', color: 0x6a7a62 },
  // ---- Faction buildings ----
  scrapHut:     { name: 'Scrap hut',      w: 2, h: 2, blocksMove: true, blocksLos: true, losHeight: 2, hp: 220, model: 'scrapHut', color: 0x7a6a4a },
  warDrum:      { name: 'War drum',       w: 2, h: 2, blocksMove: true, cover: true, hp: 300, heals: 1, model: 'warDrum', color: 0x8a5a3a },
  brewery:      { name: 'Brewery',        w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 450, volatile: 2, model: 'brewery', color: 0x6a8a4a },
  crypt:        { name: 'Crypt',          w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 1200, model: 'crypt', color: 0x4a4a52 },
  boneSpire:    { name: 'Bone spire',     w: 2, h: 2, blocksMove: true, blocksLos: true, losHeight: 6, hp: 700, heals: 1, model: 'boneSpire', color: 0xd8d0b8 },
  charnel:      { name: 'Charnel house',  w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 600, model: 'charnel', color: 0x5a5a4a },
  forge:        { name: 'Brimstone forge', w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 5, hp: 1300, cargo: 4, model: 'forge', color: 0x3a2a2a },
  obelisk:      { name: 'Obelisk',        w: 1, h: 1, blocksMove: true, blocksLos: true, losHeight: 5, hp: 600, model: 'obelisk', color: 0x2a2228 },
  pitGate:      { name: 'Pit gate',       w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 4, hp: 1500, volatile: 3, model: 'pitGate', color: 0x4a2020 },
  yurt:         { name: 'Hide yurt',      w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 350, model: 'yurt', color: 0xa88a5a },
  totem:        { name: 'Totem',          w: 1, h: 1, blocksMove: true, blocksLos: true, losHeight: 4, hp: 300, heals: 1, model: 'totem', color: 0x8a5a3a },
  bonePit:      { name: 'Bone pit',       w: 3, h: 3, blocksMove: true, cover: true, hp: 500, cargo: 3, model: 'bonePit', color: 0xcfc4a8 },
  crystalSpire: { name: 'Crystal spire',  w: 2, h: 2, blocksMove: true, blocksLos: true, losHeight: 6, hp: 900, heals: 1, model: 'crystalSpire', color: 0x7ad0ff },
  monolith:     { name: 'Monolith',       w: 1, h: 1, blocksMove: true, blocksLos: true, losHeight: 4, hp: 800, model: 'monolith', color: 0x8a8a92 },
  stoneRing:    { name: 'Stone ring',     w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 1000, volatile: 2, model: 'stoneRing', color: 0x9a9aa2 },
  nest:         { name: 'Dragon nest',    w: 3, h: 3, blocksMove: true, cover: true, hp: 700, model: 'nest', color: 0x4a3a2a },
  perch:        { name: 'Dragon perch',   w: 2, h: 2, blocksMove: true, blocksLos: true, losHeight: 6, hp: 1400, model: 'perch', color: 0x5a524a },
  hoard:        { name: 'Hoard cave',     w: 3, h: 3, blocksMove: true, blocksLos: true, losHeight: 3, hp: 1200, cargo: 5, model: 'hoard', color: 0xd8b04a },
  // ---- A city on levels ----
  // Terraces are walkable stone platforms; buildings placed on them stand at their height.
  terrace:     { name: 'Terrace',         w: 4, h: 4, stretch: true, stretch2: true, level: 1, hp: 3000, model: 'terrace', color: 0x9a958b },
  terraceHigh: { name: 'High terrace',    w: 4, h: 4, stretch: true, stretch2: true, level: 2, hp: 4000, model: 'terraceHigh', color: 0x938e84 },
  walkway:     { name: 'Elevated walkway', w: 4, h: 1, stretch: true, level: 2, ladder: true, span: true, hp: 260, model: 'walkway', color: 0x8b6b42 },
  stoneBridge: { name: 'Stone bridge',    w: 4, h: 2, stretch: true, level: 1, ladder: true, overWater: true, hp: 900, model: 'stoneBridge', color: 0x8f8a80 },
  viaduct:     { name: 'Rail viaduct',    w: 4, h: 1, stretch: true, level: 2, ladder: true, span: true, hp: 700, model: 'viaduct', color: 0x8a857c },
  cableTower:  { name: 'Cable car tower', w: 2, h: 2, blocksMove: true, blocksLos: true, losHeight: 5, hp: 600, cable: true, model: 'cableTower', color: 0x7a6248 },
  railCar:       { name: 'Supply wagon',   w: 3, h: 1, blocksMove: true, cover: true, hp: 400, cargo: 8, model: 'railCar', color: 0x6b4a2e },
  rail:          { name: 'Rail track',     w: 4, h: 1, stretch: true, model: 'rail', color: 0x5a5148 },
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
Object.assign(STRUCTURES, readyLandmarks()); // the realms' landmark buildings (see realms.js)
for (const [id, d] of Object.entries(STRUCTURES)) d.id = id;
export const isWeapon = (type) => !!STRUCTURES[type]?.weapon;
