// Placeable map objects. w/h in tiles. Flags drive the engine:
//  blocksMove: impassable   blocksLos: stops arrows/spells
//  cover: low obstacle, +35% defence vs ranged/magic shot across it
//  elevated: walkable platform, +2 range for shooters, +10% defence
export const STRUCTURES = {
  wall:      { name: 'Stone wall',   w: 4, h: 1, blocksMove: true, blocksLos: true, model: 'wall', color: 0x8a8a86 },
  wallLong:  { name: 'Long wall',    w: 8, h: 1, blocksMove: true, blocksLos: true, model: 'wall', color: 0x8a8a86 },
  palisade:  { name: 'Palisade',     w: 4, h: 1, blocksMove: true, blocksLos: true, model: 'palisade', color: 0x7a5a36 },
  barricade: { name: 'Barricade',    w: 3, h: 1, cover: true, model: 'barricade', color: 0x8b6b42 },
  sandbags:  { name: 'Sandbags',     w: 2, h: 1, cover: true, model: 'sandbags', color: 0xc8b48a },
  tower:     { name: 'Watchtower',   w: 2, h: 2, elevated: true, model: 'tower', color: 0x9c7a4c },
  keep:      { name: 'Keep',         w: 5, h: 5, blocksMove: true, blocksLos: true, model: 'keep', color: 0x9b9790 },
  house:     { name: 'House',        w: 3, h: 3, blocksMove: true, blocksLos: true, model: 'house', color: 0xc9b38c },
  hut:       { name: 'Hut',          w: 2, h: 2, blocksMove: true, blocksLos: true, model: 'hut', color: 0x8d6e4a },
  tent:      { name: 'Tent',         w: 2, h: 2, blocksMove: true, model: 'tent', color: 0xd8cfb5 },
  gate:      { name: 'Gatehouse',    w: 4, h: 2, blocksMove: false, elevated: true, model: 'gate', color: 0x8a8a86 },
  tree:      { name: 'Tree',         w: 1, h: 1, blocksMove: true, blocksLos: true, model: 'tree', color: 0x3f7d3a },
  pine:      { name: 'Pine',         w: 1, h: 1, blocksMove: true, blocksLos: true, model: 'pine', color: 0x2e6b3a },
  rock:      { name: 'Boulder',      w: 2, h: 2, blocksMove: true, cover: true, model: 'rock', color: 0x7d7a73 },
  crates:    { name: 'Crates',       w: 1, h: 1, blocksMove: true, cover: true, model: 'crates', color: 0xa07a48 },
  statue:    { name: 'Statue',       w: 1, h: 1, blocksMove: true, blocksLos: true, model: 'statue', color: 0xb8b4aa },
  pillar:    { name: 'Pillar',       w: 1, h: 1, blocksMove: true, blocksLos: true, model: 'pillar', color: 0xcfc9bb },
  bridge:    { name: 'Raised deck',  w: 4, h: 2, elevated: true, model: 'deck', color: 0x8b6b42 },
};
