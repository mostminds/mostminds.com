// Ready-made scenarios. Each sets up one mode; the user can edit everything.
const ring = (cx, cy, r, type) => {
  const out = [];
  for (let a = 0; a < 12; a++) out.push({ type, x: Math.round(cx + Math.cos((a / 12) * Math.PI * 2) * r), y: Math.round(cy + Math.sin((a / 12) * Math.PI * 2) * r), rot: 0 });
  return out;
};

export const PRESETS = [
  {
    id: 'breakout', name: 'Arena breakout: 32 Knights vs 12 Cyclopes', mode: 'field',
    scn: { size: 40, structures: ring(20, 20, 17, 'pillar'),
      sides: [{ name: 'Garrison', posture: 'defend', groups: [{ unit: 'knight', count: 32 }], placed: [] },
              { name: 'Cyclopes', posture: 'attack', groups: [{ unit: 'cyclops', count: 12 }], placed: [] }] },
  },
  {
    id: 'horde', name: 'Kingdom host vs Goblin horde', mode: 'field',
    scn: { size: 64, structures: [
      { type: 'tree', x: 30, y: 8 }, { type: 'pine', x: 32, y: 10 }, { type: 'tree', x: 34, y: 54 }, { type: 'pine', x: 30, y: 56 },
      { type: 'rock', x: 31, y: 30 }, { type: 'barricade', x: 18, y: 28, rot: 1 }, { type: 'barricade', x: 18, y: 33, rot: 1 }, { type: 'tower', x: 14, y: 31 },
    ],
      sides: [{ name: 'Kingdom', posture: 'attack', groups: [{ unit: 'footman', count: 20 }, { unit: 'halberdier', count: 6 }, { unit: 'longbow', count: 14 }, { unit: 'cleric', count: 4 }, { unit: 'lancer', count: 6 }], placed: [] },
              { name: 'Goblin horde', posture: 'attack', groups: [{ unit: 'goblin', count: 150 }, { unit: 'hobgoblin', count: 30 }, { unit: 'goblinArcher', count: 40 }, { unit: 'shaman', count: 12 }, { unit: 'wolfRider', count: 30 }, { unit: 'warboss', count: 3 }], placed: [] }] },
  },
  {
    id: 'siege', name: 'Undead siege of the keep', mode: 'field',
    scn: { size: 64, structures: [
      { type: 'keep', x: 50, y: 30 },
      { type: 'wallLong', x: 44, y: 20, rot: 1 }, { type: 'gate', x: 43, y: 28, rot: 1 }, { type: 'wallLong', x: 44, y: 32, rot: 1 }, { type: 'wall', x: 44, y: 40, rot: 1 },
      { type: 'tower', x: 41, y: 18 }, { type: 'tower', x: 41, y: 42 }, { type: 'house', x: 52, y: 20 }, { type: 'house', x: 52, y: 40 },
      { type: 'tree', x: 20, y: 12 }, { type: 'tree', x: 24, y: 50 }, { type: 'statue', x: 30, y: 32 },
    ],
      sides: [{ name: 'Dead legion', posture: 'attack', groups: [{ unit: 'skeleton', count: 90 }, { unit: 'skeletonArcher', count: 30 }, { unit: 'ghoul', count: 24 }, { unit: 'necromancer', count: 6 }, { unit: 'boneColossus', count: 3 }], placed: [] },
              { name: 'Keep garrison', posture: 'defend', groups: [{ unit: 'knight', count: 14 }, { unit: 'crossbow', count: 18 }, { unit: 'battlemage', count: 6 }, { unit: 'cleric', count: 4 }, { unit: 'paladin', count: 2 }], placed: [] }] },
  },
  {
    id: 'landing', name: 'Island landing', mode: 'amphibious',
    scn: { size: 64, structures: [
      { type: 'sandbags', x: 30, y: 20 }, { type: 'sandbags', x: 29, y: 28 }, { type: 'sandbags', x: 29, y: 36 }, { type: 'sandbags', x: 30, y: 44 },
      { type: 'tower', x: 36, y: 24 }, { type: 'tower', x: 36, y: 38 }, { type: 'palisade', x: 40, y: 28, rot: 1 }, { type: 'palisade', x: 40, y: 34, rot: 1 },
      { type: 'hut', x: 50, y: 26 }, { type: 'hut', x: 52, y: 36 }, { type: 'tent', x: 46, y: 31 }, { type: 'pine', x: 56, y: 18 }, { type: 'pine', x: 58, y: 46 },
    ],
      sides: [{ name: 'Landing force', posture: 'attack', groups: [{ unit: 'footman', count: 22 }, { unit: 'knight', count: 3 }, { unit: 'crossbow', count: 8 }, { unit: 'cleric', count: 3 }], placed: [] },
              { name: 'Island goblins', posture: 'defend', groups: [{ unit: 'goblin', count: 60 }, { unit: 'goblinArcher', count: 44 }, { unit: 'hobgoblin', count: 22 }, { unit: 'shaman', count: 8 }, { unit: 'warboss', count: 2 }], placed: [] }] },
  },
  {
    id: 'dragons', name: 'Dragons vs Infernal host', mode: 'field',
    scn: { size: 48, structures: [{ type: 'rock', x: 22, y: 12 }, { type: 'rock', x: 24, y: 34 }],
      sides: [{ name: 'Dragonflight', posture: 'attack', groups: [{ unit: 'drake', count: 3 }, { unit: 'wyrmling', count: 4 }], placed: [] },
              { name: 'Infernal host', posture: 'attack', groups: [{ unit: 'infernalLord', count: 1 }, { unit: 'pitFiend', count: 3 }, { unit: 'imp', count: 30 }], placed: [] }] },
  },
  {
    id: 'fleet', name: 'Fleet action', mode: 'naval',
    scn: { islands: [{ x: 70, y: 30, r: 5 }, { x: 64, y: 62, r: 4 }],
      sides: [{ name: 'Blue squadron', groups: [{ unit: 'frigate', count: 2 }, { unit: 'cutter', count: 3 }] },
              { name: 'Red squadron', groups: [{ unit: 'galleon', count: 1 }, { unit: 'brigantine', count: 3 }, { unit: 'sloop', count: 2 }] }] },
  },
  {
    id: 'kraken', name: 'Kraken hunt', mode: 'naval',
    scn: { islands: [{ x: 90, y: 45, r: 6 }],
      sides: [{ name: 'Hunting fleet', groups: [{ unit: 'galleon', count: 2 }, { unit: 'cutter', count: 4 }] },
              { name: 'The deep', groups: [{ unit: 'kraken', count: 1 }, { unit: 'shark', count: 6 }, { unit: 'siren', count: 2 }] }] },
  },
];

export const DEFAULT_SCENARIOS = {
  field: PRESETS[1].scn,
  amphibious: PRESETS[3].scn,
  naval: PRESETS[5].scn,
};
