import { castleKit } from './castle.js';

// Ready-made scenarios. Each sets up one mode; everything stays editable.
// The regional maps are an original setting; gun placements are designed
// to cover each map's landing beaches, fords and harbor mouths.
const ring = (cx, cy, r, type) => {
  const out = [];
  for (let a = 0; a < 12; a++) out.push({ type, x: Math.round(cx + Math.cos((a / 12) * Math.PI * 2) * r), y: Math.round(cy + Math.sin((a / 12) * Math.PI * 2) * r), rot: 0 });
  return out;
};
const S = (type, x, y, extra = {}) => ({ type, x, y, rot: 0, ...extra });
const gun = (type, x, y, side = 1) => ({ type, x, y, rot: 0, side });
const g = (unit, count) => ({ unit, count });

export const PRESETS = [
  // ---------------- Field battles ----------------
  {
    id: 'breakout', name: 'Arena breakout: 32 Knights vs 12 Cyclopes', mode: 'field',
    scn: { size: 40, shape: 'plains', biome: 'temperate', structures: ring(20, 20, 17, 'pillar'),
      sides: [{ name: 'Garrison', posture: 'defend', groups: [g('knight', 32)], placed: [] },
              { name: 'Cyclopes', posture: 'attack', groups: [g('cyclops', 12)], placed: [] }] },
  },
  {
    id: 'horde', name: 'Kingdom host vs Goblin horde', mode: 'field',
    scn: { size: 64, shape: 'plains', biome: 'temperate', structures: [
      S('tree', 30, 8), S('pine', 32, 10), S('tree', 34, 54), S('pine', 30, 56),
      S('rock', 31, 30), S('barricade', 18, 28, { rot: 1 }), S('barricade', 18, 33, { rot: 1 }), S('tower', 14, 31),
      gun('ballista', 15, 27, 0), gun('ballista', 15, 36, 0),
    ],
      sides: [{ name: 'Kingdom', posture: 'attack', groups: [g('footman', 23), g('halberdier', 7), g('longbow', 16), g('cleric', 5), g('lancer', 7)], placed: [] },
              { name: 'Goblin horde', posture: 'attack', groups: [g('goblin', 150), g('hobgoblin', 30), g('goblinArcher', 40), g('shaman', 12), g('wolfRider', 30), g('warboss', 3)], placed: [] }] },
  },
  {
    id: 'siege', name: 'Undead siege of the keep', mode: 'field',
    scn: { size: 64, shape: 'plains', biome: 'temperate', structures: [
      S('keep', 50, 30),
      S('wallLong', 44, 20, { rot: 1 }), S('gate', 43, 28, { rot: 1 }), S('wallLong', 44, 32, { rot: 1 }), S('wall', 44, 40, { rot: 1 }),
      S('tower', 41, 18), S('tower', 41, 42), S('house', 52, 20), S('house', 52, 40),
      S('tree', 20, 12), S('tree', 24, 50), S('statue', 30, 32),
      gun('cannon', 46, 24), gun('cannon', 46, 37), gun('mortar', 56, 26), gun('mortar', 56, 38),
    ],
      sides: [{ name: 'Dead legion', posture: 'attack', groups: [g('skeleton', 90), g('skeletonArcher', 30), g('ghoul', 24), g('necromancer', 6), g('boneColossus', 3)], placed: [] },
              { name: 'Keep garrison', posture: 'defend', groups: [g('knight', 14), g('crossbow', 18), g('battlemage', 6), g('cleric', 4), g('paladin', 2)], placed: [] }] },
  },
  {
    id: 'dragons', name: 'Dragons vs Infernal host', mode: 'field',
    scn: { size: 48, shape: 'plains', biome: 'volcanic', structures: [S('rock', 22, 12), S('rock', 24, 34)],
      sides: [{ name: 'Dragonflight', posture: 'attack', groups: [g('drake', 3), g('wyrmling', 4)], placed: [] },
              { name: 'Infernal host', posture: 'attack', groups: [g('infernalLord', 1), g('pitFiend', 3), g('imp', 30)], placed: [] }] },
  },
  {
    id: 'wildwood', name: 'Wildwood ambush: wolves, spiders and bats', mode: 'field',
    scn: { size: 48, shape: 'plains', biome: 'temperate', structures: [
      S('tree', 20, 6), S('pine', 23, 9), S('tree', 26, 5), S('pine', 21, 14), S('tree', 25, 17), S('rock', 22, 21),
      S('pine', 20, 27), S('tree', 24, 30), S('pine', 27, 34), S('tree', 21, 37), S('pine', 25, 41), S('tree', 19, 43),
      S('tent', 7, 20), S('tent', 7, 26), S('crates', 10, 23), S('barricade', 13, 19, { rot: 1 }), S('barricade', 13, 26, { rot: 1 }),
    ],
      sides: [{ name: 'Ranger patrol', posture: 'defend', groups: [g('longbow', 18), g('footman', 14), g('halberdier', 6), g('militia', 12), g('cleric', 3)], placed: [] },
              { name: 'The wild hunt', posture: 'attack', groups: [g('wolf', 38), g('spider', 18), g('bat', 32)], placed: [] }] },
  },
  {
    id: 'greenmantle', name: 'Greenmantle Crossing: forcing the fords', mode: 'field',
    scn: { size: 64, shape: 'river', biome: 'temperate', terrainSeed: 7, structures: [
      // east bank guns covering the three fords
      gun('ballista', 39, 9), gun('cannon', 40, 13), gun('cannon', 40, 31), gun('ballista', 40, 36),
      gun('cannon', 40, 51), gun('ballista', 39, 56), gun('mortar', 50, 22), gun('mortar', 50, 44),
      S('sandbags', 38, 11), S('sandbags', 38, 33), S('sandbags', 38, 53),
      S('tower', 44, 30), S('house', 54, 12), S('house', 54, 48), S('tree', 14, 20), S('tree', 12, 44), S('pine', 20, 6), S('pine', 22, 58),
    ],
      sides: [{ name: 'Western levy', posture: 'attack', groups: [g('footman', 40), g('halberdier', 12), g('longbow', 20), g('lancer', 10), g('cleric', 6)], placed: [] },
              { name: 'River wardens', posture: 'defend', groups: [g('militia', 39), g('crossbow', 21), g('knight', 10), g('cleric', 4)], placed: [] }] },
  },
  {
    id: 'sunscar', name: 'Sunscar Oasis: battle for the water', mode: 'field',
    scn: { size: 64, shape: 'lake', biome: 'desert', terrainSeed: 11, structures: [
      S('bastion', 30, 5), gun('ballista', 31, 6, null), gun('ballista', 32, 7, null),
      S('bastion', 30, 55), gun('ballista', 31, 56, null), gun('ballista', 32, 57, null),
      S('tent', 8, 20), S('tent', 8, 40), S('tent', 54, 20), S('tent', 54, 40), S('rock', 20, 8), S('rock', 42, 54), S('pillar', 18, 50), S('pillar', 45, 12),
    ],
      sides: [{ name: 'Sand raiders', posture: 'attack', groups: [g('wolfRider', 20), g('hobgoblin', 16), g('goblinArcher', 30), g('goblin', 60), g('shaman', 6)], placed: [] },
              { name: 'Oasis guard', posture: 'attack', groups: [g('footman', 12), g('crossbow', 7), g('lancer', 4), g('battlemage', 2), g('cleric', 2)], placed: [] }] },
  },

  {
    id: 'highcrag', name: 'Highcrag Castle: rams, sappers and griffons', mode: 'field',
    scn: { size: 64, shape: 'plains', biome: 'snow', structures: [
      ...castleKit(38, 19, 24, 1, 'west').map((x) => ({ ...x, grp: 1 })),
      gun('ballista', 39, 20), gun('ballista', 39, 41), gun('mortar', 52, 26), gun('mortar', 52, 36),
      S('pine', 12, 8), S('pine', 16, 54), S('rock', 24, 14), S('rock', 22, 46), S('tent', 4, 30),
    ],
      sides: [{ name: 'Northern host', posture: 'attack', groups: [g('ram', 3), g('footman', 42), g('halberdier', 10), g('longbow', 21), g('griffon', 8), g('cleric', 5)], placed: [] },
              { name: 'Highcrag garrison', posture: 'defend', groups: [g('knight', 10), g('footman', 14), g('crossbow', 22), g('battlemage', 4), g('cleric', 3), g('harpy', 6)], placed: [] }] },
  },

  // ---------------- Island and coastal assaults ----------------
  {
    id: 'landing', name: 'Island landing', mode: 'amphibious',
    scn: { size: 64, shape: 'island', biome: 'temperate', structures: [
      S('sandbags', 30, 20), S('sandbags', 29, 28), S('sandbags', 29, 36), S('sandbags', 30, 44),
      S('tower', 36, 24), S('tower', 36, 38), S('palisade', 40, 28, { rot: 1 }), S('palisade', 40, 34, { rot: 1 }),
      S('hut', 50, 26), S('hut', 52, 36), S('tent', 46, 31), S('pine', 56, 18), S('pine', 58, 46),
      gun('cannon', 32, 24), gun('cannon', 32, 39), gun('battery', 44, 20), gun('mortar', 47, 34),
    ],
      sides: [{ name: 'Landing force', posture: 'attack', groups: [g('footman', 20), g('knight', 3), g('crossbow', 6), g('cleric', 2)], ships: [g('cutter', 2)], placed: [] },
              { name: 'Island goblins', posture: 'defend', groups: [g('goblin', 60), g('goblinArcher', 44), g('hobgoblin', 22), g('shaman', 8), g('warboss', 2)], placed: [] }] },
  },
  {
    id: 'saltspire', name: 'Saltspire Sea Castle: bombard, land and breach', mode: 'amphibious',
    scn: { size: 64, shape: 'coast', biome: 'temperate', terrainSeed: 5, structures: [
      ...castleKit(40, 20, 20, 1, 'west').map((x) => ({ ...x, grp: 1 })),
      gun('battery', 34, 14), gun('battery', 34, 46), gun('harpoon', 41, 21), gun('harpoon', 41, 37),
      S('sandbags', 33, 24), S('sandbags', 33, 36), S('house', 56, 6), S('house', 56, 52),
    ],
      sides: [{ name: 'Sea lords', posture: 'attack', groups: [g('ram', 1), g('footman', 14), g('knight', 3), g('crossbow', 5), g('griffon', 3), g('cleric', 1)], ships: [g('galleon', 1), g('frigate', 2)], placed: [] },
              { name: 'Saltspire wardens', posture: 'defend', groups: [g('skeleton', 30), g('skeletonArcher', 24), g('necromancer', 3), g('bat', 12)], placed: [] }] },
  },
  {
    id: 'saltmarsh', name: 'Saltmarsh Landing: beach guns in the bog', mode: 'amphibious',
    scn: { size: 64, shape: 'coast', biome: 'swamp', terrainSeed: 5, structures: [
      S('sandbags', 34, 14), S('sandbags', 34, 26), S('sandbags', 34, 38), S('sandbags', 34, 50),
      gun('cannon', 36, 12), gun('cannon', 36, 24), gun('cannon', 36, 40), gun('cannon', 36, 52),
      gun('battery', 42, 30), gun('mortar', 50, 18), gun('mortar', 50, 46),
      S('hut', 54, 28), S('hut', 56, 36), S('tree', 46, 8), S('tree', 46, 58), S('tree', 58, 14), S('crates', 44, 40),
    ],
      sides: [{ name: 'Marsh crusade', posture: 'attack', groups: [g('footman', 27), g('halberdier', 8), g('crossbow', 9), g('cleric', 3), g('knight', 4)], ships: [g('brigantine', 1), g('cutter', 2)], placed: [] },
              { name: 'Bog dead', posture: 'defend', groups: [g('skeleton', 50), g('skeletonArcher', 26), g('ghoul', 14), g('necromancer', 4)], placed: [] }] },
  },
  {
    id: 'frostfang', name: 'Frostfang Fjord: batteries at the harbor mouth', mode: 'amphibious',
    scn: { size: 64, shape: 'harbor', biome: 'snow', terrainSeed: 3, structures: [
      // flanking batteries on both headlands command the mouth
      gun('battery', 26, 17), gun('battery', 26, 45), gun('harpoon', 27, 24), gun('harpoon', 26, 39),
      S('bastion', 36, 12), gun('cannon', 37, 13), gun('cannon', 38, 14),
      S('bastion', 36, 48), gun('cannon', 37, 49), gun('cannon', 38, 50),
      S('wall', 30, 8), S('wall', 30, 55), S('house', 50, 6), S('house', 50, 54), S('pine', 44, 4), S('pine', 44, 58), S('pine', 58, 8), S('pine', 58, 56),
    ],
      sides: [{ name: 'Raiders from the south sea', posture: 'attack', groups: [g('hobgoblin', 38), g('goblin', 80), g('goblinArcher', 32), g('warboss', 3), g('shaman', 10)], ships: [g('brigantine', 2), g('sloop', 2)], placed: [] },
              { name: 'Fjord watch', posture: 'defend', groups: [g('footman', 20), g('crossbow', 14), g('knight', 6), g('cleric', 3)], ships: [g('frigate', 1)], placed: [] }] },
  },
  {
    id: 'emberreach', name: 'Emberreach Isle: storming the fire mountain', mode: 'amphibious',
    scn: { size: 64, shape: 'island', biome: 'volcanic', terrainSeed: 9, structures: [
      gun('battery', 30, 14), gun('battery', 30, 46), gun('mortar', 44, 22), gun('mortar', 44, 40), gun('mortar', 52, 31),
      gun('cannon', 31, 31), S('rock', 40, 30), S('rock', 56, 16), S('rock', 56, 46), S('statue', 48, 31), S('pillar', 50, 26), S('pillar', 50, 37),
    ],
      sides: [{ name: 'Kingdom expedition', posture: 'attack', groups: [g('knight', 8), g('footman', 12), g('paladin', 2), g('crossbow', 5), g('battlemage', 3), g('cleric', 2)], ships: [g('frigate', 2), g('galleon', 1)], placed: [] },
              { name: 'Infernal garrison', posture: 'defend', groups: [g('imp', 40), g('pitFiend', 3), g('fireElemental', 8)], placed: [] }] },
  },
  {
    id: 'coralteeth', name: 'Coral Teeth Archipelago: island hopping', mode: 'amphibious',
    scn: { size: 64, shape: 'archipelago', biome: 'jungle', terrainSeed: 7, structures: [
      gun('cannon', 33, 12), gun('cannon', 37, 40), gun('battery', 40, 36), gun('harpoon', 52, 22), gun('mortar', 54, 50),
      S('hut', 36, 14), S('hut', 42, 42), S('tree', 34, 18), S('tree', 40, 44), S('tree', 54, 20), S('tree', 56, 52), S('crates', 26, 52),
    ],
      sides: [{ name: 'Corsair landing', posture: 'attack', groups: [g('footman', 16), g('crossbow', 9), g('halberdier', 4), g('cleric', 2)], ships: [g('cutter', 3), g('sloop', 2)], placed: [] },
              { name: 'Reef tribes', posture: 'defend', groups: [g('goblin', 40), g('goblinArcher', 24), g('spider', 8), g('shaman', 6)], ships: [g('skiff', 2)], placed: [] }] },
  },
  {
    id: 'ironbay', name: 'Ironbay Citadel: the great harbor assault', mode: 'amphibious',
    scn: { size: 80, shape: 'harbor', biome: 'temperate', terrainSeed: 21, structures: [
      S('keep', 58, 6), S('keep', 58, 68),
      S('bastion', 32, 18), gun('battery', 32, 18), gun('cannon', 35, 21),
      S('bastion', 32, 58), gun('battery', 32, 58), gun('cannon', 35, 61),
      gun('battery', 28, 30), gun('battery', 28, 48), gun('harpoon', 33, 26), gun('harpoon', 33, 52),
      gun('mortar', 66, 22), gun('mortar', 66, 56), gun('mortar', 72, 39),
      S('wallLong', 44, 12), S('wallLong', 44, 66), S('house', 48, 16), S('house', 48, 62), S('house', 70, 14), S('house', 70, 64),
    ],
      sides: [{ name: 'Grand armada', posture: 'attack', groups: [g('footman', 22), g('knight', 8), g('halberdier', 6), g('crossbow', 9), g('battlemage', 3), g('cleric', 3)], ships: [g('galleon', 2), g('frigate', 3), g('cutter', 2)], placed: [] },
              { name: 'Citadel guard', posture: 'defend', groups: [g('footman', 30), g('crossbow', 24), g('knight', 10), g('paladin', 2), g('cleric', 4)], ships: [g('frigate', 1), g('sloop', 2)], placed: [] }] },
  },
  {
    id: 'twinpeaks', name: 'Dunewall Strait: running the gun line', mode: 'amphibious',
    scn: { size: 64, shape: 'strait', biome: 'desert', terrainSeed: 4, structures: [
      gun('battery', 24, 18), gun('battery', 40, 17), gun('battery', 25, 47), gun('battery', 40, 45),
      gun('mortar', 32, 10), gun('mortar', 32, 54), gun('harpoon', 50, 22), gun('harpoon', 50, 41),
      S('tent', 20, 8), S('tent', 44, 8), S('tent', 20, 56), S('tent', 44, 56), S('rock', 56, 8), S('rock', 56, 54),
    ],
      sides: [{ name: 'Strait runners', posture: 'attack', groups: [g('footman', 12), g('crossbow', 4), g('lancer', 2), g('cleric', 2)], ships: [g('frigate', 2), g('cutter', 3)], placed: [] },
              { name: 'Dune holds', posture: 'defend', groups: [g('hobgoblin', 16), g('goblin', 40), g('goblinArcher', 30), g('shaman', 4)], placed: [] }] },
  },

  // ---------------- Naval ----------------
  {
    id: 'fleet', name: 'Fleet action', mode: 'naval',
    scn: { islands: [{ x: 70, y: 30, r: 5 }, { x: 64, y: 62, r: 4 }], forts: [],
      sides: [{ name: 'Blue squadron', groups: [g('frigate', 3), g('cutter', 3)] },
              { name: 'Red squadron', groups: [g('galleon', 1), g('brigantine', 3), g('sloop', 2)] }] },
  },
  {
    id: 'kraken', name: 'Kraken hunt from the harpoon reef', mode: 'naval',
    scn: { islands: [{ x: 90, y: 45, r: 6 }, { x: 40, y: 22, r: 4 }], forts: [{ type: 'harpoon', x: 40, y: 27, side: 0 }, { type: 'harpoon', x: 44, y: 21, side: 0 }],
      sides: [{ name: 'Hunting fleet', groups: [g('galleon', 2), g('cutter', 4)] },
              { name: 'The deep', groups: [g('kraken', 1), g('shark', 6), g('siren', 2)] }] },
  },
  {
    id: 'leviathan', name: "Leviathan's wake: the deep rises", mode: 'naval',
    scn: { islands: [{ x: 60, y: 20, r: 4 }, { x: 98, y: 66, r: 5 }], forts: [],
      sides: [{ name: 'Grand fleet', groups: [g('manowar', 1), g('frigate', 2), g('brigantine', 1), g('skiff', 3), g('raft', 2)] },
              { name: 'The deep', groups: [g('leviathan', 1), g('serpent', 2), g('eel', 4), g('crab', 8)] }] },
  },
  {
    id: 'narrows', name: 'Narrows of the twin forts', mode: 'naval',
    scn: { islands: [{ x: 72, y: 22, r: 7 }, { x: 72, y: 68, r: 7 }, { x: 112, y: 45, r: 4 }],
      forts: [{ type: 'battery', x: 72, y: 29, side: 1 }, { type: 'battery', x: 72, y: 61, side: 1 }, { type: 'mortar', x: 76, y: 18, side: 1 },
              { type: 'mortar', x: 76, y: 72, side: 1 }, { type: 'seaFort', x: 112, y: 45, side: 1 }],
      sides: [{ name: 'Breakthrough fleet', groups: [g('galleon', 3), g('frigate', 3), g('cutter', 2)] },
              { name: 'Strait guard', groups: [g('brigantine', 1), g('sloop', 2)] }] },
  },
  {
    id: 'seafort', name: 'Storming the sea fort', mode: 'naval',
    scn: { islands: [{ x: 96, y: 45, r: 5 }, { x: 80, y: 20, r: 4 }, { x: 80, y: 70, r: 4 }],
      forts: [{ type: 'seaFort', x: 96, y: 45, side: 1 }, { type: 'battery', x: 80, y: 24, side: 1 }, { type: 'battery', x: 80, y: 66, side: 1 }, { type: 'harpoon', x: 92, y: 39, side: 1 }],
      sides: [{ name: 'Assault squadron', groups: [g('manowar', 1), g('galleon', 2), g('frigate', 1)] },
              { name: 'Fort command', groups: [g('sloop', 2)] }] },
  },
];

// The scenarios above were laid out on small maps. They are enlarged here so armies have room to
// manoeuvre: open-field maps gain a wide margin all round (the layout itself is untouched), shaped
// maps (coasts, rivers, islands) are scaled with their terrain, castles moving as one piece, and sea
// battles get a bigger sea.
function enlarge(p) {
  const scn = p.scn;
  if (p.mode === 'naval') {
    const K = 1.5;
    scn.width = 210; scn.height = 135; scn.maxTicks = 5000;
    for (const i of scn.islands || []) { i.x = Math.round(i.x * K); i.y = Math.round(i.y * K); i.r = Math.round(i.r * 1.3); }
    for (const f of scn.forts || []) { f.x = Math.round(f.x * K); f.y = Math.round(f.y * K); }
    return;
  }
  const old = scn.size;
  if (!scn.shape || scn.shape === 'plains') {
    const size = Math.round((old * 1.75) / 4) * 4, off = (size - old) >> 1;
    scn.size = size;
    for (const st of scn.structures || []) { st.x += off; st.y += off; }
    for (const sd of scn.sides) for (const q of sd.placed || []) { q.x += off; q.y += off; }
    return;
  }
  const K = 1.6;
  scn.size = Math.round((old * K) / 4) * 4;
  const k = scn.size / old;
  const grp = (scn.structures || []).filter((st) => st.grp);
  let dx = 0, dy = 0;
  if (grp.length) { const gx = Math.min(...grp.map((st) => st.x)), gy = Math.min(...grp.map((st) => st.y)); dx = Math.round(gx * k) - gx; dy = Math.round(gy * k) - gy; }
  for (const st of scn.structures || []) {
    if (st.grp) { st.x += dx; st.y += dy; } else { st.x = Math.round(st.x * k); st.y = Math.round(st.y * k); }
    delete st.grp;
  }
  for (const sd of scn.sides) for (const q of sd.placed || []) { q.x = Math.round(q.x * k); q.y = Math.round(q.y * k); }
}
for (const p of PRESETS) enlarge(p);

export const DEFAULT_SCENARIOS = {
  field: PRESETS.find((p) => p.id === 'horde').scn,
  amphibious: PRESETS.find((p) => p.id === 'landing').scn,
  naval: PRESETS.find((p) => p.id === 'fleet').scn,
};
