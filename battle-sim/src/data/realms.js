// Twenty-seven further factions, in four groups. Each is described once here (palette, people,
// troops, beasts, ships, airship, how it builds) and expanded into unit, ship, airship and
// worldgen entries by the functions at the bottom. Troops take their statistics from a unit of
// the original roster (`base`) scaled by `k`, so they stay in balance with it.
//
// Roster rows: [id, name, base unit, model, { k, w, as, ...overrides }]
//   k   strength multiplier against the base unit (hit points scale by k, attack and defence by its root)
//   w   share of a generated army     as: true   only joins an attacking host
// Models may name bodies, species, outfits, mounts and weapons that are sculpted later; `alt`
// gives the stand-in used until then.

const HUMAN = 0xd9a77c, PALE = 0xe9dccf, TAN = 0xc48a5a, DARK = 0x8a5a3a, OLIVE = 0xc79a6a;

// ---- model shorthands (P is the faction palette) ----
const mk = (P) => {
  const base = (x = {}) => ({ species: P.species, skin: P.skin, cloth: P.cloth, cloth2: P.cloth2, armor: P.armor, trim: P.trim, ...x });
  return {
    h: (outfit, weapon, x = {}) => ({ body: 'humanoid', ...base(), outfit, weapon, ...x }),
    r: (outfit, mountType, weapon, mount, x = {}) => ({ body: 'rider', ...base(), outfit, mountType, weapon, mount, ...x }),
    q: (kind, fur, scale = 1, x = {}) => ({ body: 'quadruped', kind, fur, scale, ...x }),
    d: (scales, scale = 1, x = {}) => ({ body: 'dragon', scales, scale, ...x }),
    g: (stone, scale = 1, x = {}) => ({ body: 'golem', stone, scale, ...x }),
    e: (glow, x = {}) => ({ body: 'elemental', glow, ...x }),
    b: (body, x = {}, alt = null) => ({ body, ...x, alt }),
  };
};

const TOWN = {
  civ: { wall: 'rampart', strongWall: 'rampart', layout: 'streets', homes: 'house', small: 'hut', camp: 'tent', lookout: 'tower', deco: ['crates', 'statue', 'crates'], trees: ['tree', 'tree', 'pine'], guns: ['cannon', 'ballista', 'mortar'], shoreGun: 'battery',
    civic: ['marketHall', 'stall', 'bank', 'inn', 'garden', 'fountain', 'barracks', 'temple', 'shrine', 'alchemist', 'graveyard', 'palace'] },
  old: { wall: 'rampart', strongWall: 'rampart', layout: 'streets', homes: 'house', small: 'hut', camp: 'tent', lookout: 'tower', deco: ['statue', 'pillar', 'crates'], trees: ['tree', 'pine'], guns: ['ballista', 'ballista', 'mortar'], shoreGun: 'harpoon',
    civic: ['marketHall', 'stall', 'inn', 'garden', 'fountain', 'barracks', 'temple', 'shrine', 'graveyard', 'palace'] },
  tribal: { wall: 'palisade', strongWall: 'palisade', layout: 'warren', homes: 'hut', small: 'tent', camp: 'tent', lookout: 'tower', deco: ['crates', 'barricade', 'rock'], trees: ['tree', 'pine'], guns: ['ballista'], shoreGun: 'harpoon',
    civic: ['stall', 'inn', 'barracks', 'shrine', 'graveyard'] },
  wild: { wall: 'ring', strongWall: 'palisade', layout: 'wild', homes: 'tent', small: 'tent', camp: 'tent', lookout: 'tower', deco: ['rock', 'barricade', 'rock'], trees: ['tree', 'tree', 'pine'], guns: [], shoreGun: null,
    civic: ['shrine', 'graveyard', 'stall'] },
  dark: { wall: 'bastions', strongWall: 'rampart', layout: 'rings', homes: 'keep', small: 'pillar', camp: 'tent', lookout: 'pillar', deco: ['pillar', 'statue', 'rock'], trees: ['pine'], guns: ['mortar', 'ballista'], shoreGun: 'battery',
    civic: ['temple', 'shrine', 'alchemist', 'barracks', 'palace', 'graveyard'] },
  necro: { wall: 'ruin', strongWall: 'rampart', layout: 'necropolis', homes: 'keep', small: 'statue', camp: 'pillar', lookout: 'pillar', deco: ['statue', 'pillar', 'pillar'], trees: ['pine'], guns: ['mortar', 'ballista'], shoreGun: 'battery',
    civic: ['temple', 'shrine', 'graveyard', 'alchemist', 'palace', 'garden'] },
};
const PLACES = { village: 'village', fort: 'fort', castle: 'castle', city: 'city', coast: 'coastal town', harbor: 'harbour', island: 'island hold' };

import { FLEET_DESIGNS } from './fleets/index.js';
import { SKY } from './fleets/sky.js';
import { AIRWINGS, AIR_ROLES } from './air/index.js';

export const REALM_GROUPS = ['The Realms of Order', 'The Forces of Destruction', 'The Undead Legions', 'Outcasts and Distant Lands', 'The Realms of Chaos', 'The Hidden and Fringe Races'];

// Every faction: id, names, group (index above), palette, town kind, own buildings and the rest.
export const REALMS = [
  // =========================== The Realms of Order ===========================
  { id: 'graal', name: 'The Graalish Kingdoms', adj: 'Graalish', group: 0, town: 'civ', look: 'kingdom', biomes: ['temperate', 'temperate'],
    P: { species: 'human', skin: HUMAN, cloth: 0x2a4fa8, cloth2: 0xd9b23a, armor: 0xc9d1d9, trim: 0xd9b23a },
    places: { castle: 'white castle', city: 'cathedral city', village: 'serf village', fort: 'motte and bailey' },
    roster: (m) => [
      ['levy', 'Peasant Levy', 'militia', m.h('levy', 'spear'), { w: 0.2 }],
      ['bowmen', 'Peasant Bowman', 'longbow', m.h('levy', 'longbow'), { k: 0.8, w: 0.14 }],
      ['manAtArms', 'Man-at-Arms', 'footman', m.h('footman', 'sword', { shield: true, helm: true }), { w: 0.14 }],
      ['knightErrant', 'Knight Errant', 'lancer', m.r('surcoat', 'horse', 'lance', 0x5a4030, { barding: true }), { k: 1.15, w: 0.16 }],
      ['questKnight', 'Questing Knight', 'knight', m.h('surcoat', 'greatsword'), { k: 1.1, w: 0.12 }],
      ['grailKnight', 'Knight of the Cup', 'paladin', m.r('surcoat', 'horse', 'lance', 0xe8e4dc, { barding: true, cloth: 0xe8e4dc }), { k: 1.2, w: 0.06, move: 2 }],
      ['pegasusKnight', 'Pegasus Knight', 'griffon', m.r('surcoat', 'pegasus', 'lance', 0xf0ece4, { wings: true }), { w: 0.06 }],
      ['hippogryph', 'Hippogriff Knight', 'griffon', m.r('surcoat', 'hippogriff', 'lance', 0x8a6a40, { wings: true }), { k: 1.3, as: true, w: 0.05 }],
      ['pilgrims', 'Relic Pilgrim', 'warPriest', m.h('gothicHabit', 'club', { cloth: 0x8a7a5a }), { k: 0.8, w: 0.05 }],
      ['damsel', 'Lady of the Lake', 'cleric', m.h('priest', 'staff', { robe: true, cloth: 0x9ac0d8, female: true }), { w: 0.04 }],
      ['trebuchetCrew', 'Siege Mason', 'engineer', m.h('levy', 'warhammer'), { w: 0.03 }],
    ],
    ships: [['cog', 'Heraldic Cog', 'brigantine', 'cog', { color: 0x7a5a36, sail: 0x2a4fa8, sail2: 0xd9b23a, emblem: 'lion' }], ['carrack', 'Great Carrack', 'galleon', 'cog', { color: 0x6b4a2e, sail: 0xd9b23a, sail2: 0xb02a2a, emblem: 'lion' }]],
    air: { name: 'Royal Sky-Cog', style: 'kingdom', color: 0x7a5a36, envelope: 0x2a4fa8, pods: 'questKnight' } },

  { id: 'aurelia', name: 'The Aurelian Empire', adj: 'Aurelian', group: 0, town: 'civ', look: 'kingdom', biomes: ['temperate', 'temperate', 'snow'],
    P: { species: 'human', skin: HUMAN, cloth: 0xb02a2a, cloth2: 0xe8e0d0, armor: 0xaab2bc, trim: 0xc9a23a },
    places: { city: 'free city', castle: 'elector\'s fortress', fort: 'star fort' },
    roster: (m) => [
      ['pike', 'Imperial Pikeman', 'pikeman', m.h('landsknecht', 'pike'), { w: 0.18 }],
      ['halberd', 'Imperial Halberdier', 'halberdier', m.h('landsknecht', 'halberd', { cloth: 0x2a5aa8, cloth2: 0xe8c83a }), { w: 0.14 }],
      ['handgunner', 'Handgunner', 'crossbow', m.h('landsknecht', 'handgun', { cloth: 0x2a2a2a, cloth2: 0xe8c83a }), { k: 1.05, w: 0.14, projectile: 'bolt' }],
      ['greatsword', 'Doppelsoldner', 'knight', m.h('landsknecht', 'greatsword', { cuirass: true }), { w: 0.1 }],
      ['zealot', 'Zealot', 'hobgoblin', m.h('flagellant', 'club', { species: 'human' }), { k: 0.8, w: 0.08 }],
      ['reiter', 'Imperial Knight', 'lancer', m.r('knight', 'horse', 'lance', 0x3a2a20, { barding: true }), { k: 1.2, w: 0.1 }],
      ['halfgriffon', 'Gryph-Charger Knight', 'lancer', m.r('knight', 'halfgriffon', 'halberd', 0xc8a050), { k: 1.6, w: 0.06, size: 2 }],
      ['griffonLord', 'Imperial Griffon', 'griffon', m.r('paladin', 'griffon', 'warhammer', 0xc8a050, { wings: true, scale: 1.3 }), { k: 2.2, w: 0.04, size: 2 }],
      ['warPriestA', 'Hammer-Priest', 'warPriest', m.h('gothicHabit', 'warhammer'), { w: 0.05 }],
      ['wizard', 'College Wizard', 'battlemage', m.h('mage', 'staff', { robe: true, hood: true, cloth: 0xe8a02a }), { w: 0.05 }],
      ['steamTank', 'Steam Tank', 'ram', m.b('steamTank', { color: 0x6a7078, trim: 0xc9a23a }, { body: 'ram', color: 0x6a7078 }), { k: 2.2, w: 0.05, as: true, style: 'ranged', range: 7, rng: 60, projectile: 'rock', name: 'Steam Tank' }],
      ['clockRider', 'Clockwork Outrider', 'scout', m.r('landsknecht', 'clockHorse', 'handgun', 0xb08a4a), { k: 1.2, w: 0.04 }],
      ['artificer', 'Artificer', 'engineer', m.h('sapper', 'warhammer'), { w: 0.03 }],
    ],
    ships: [['paddle', 'Paddle Galleon', 'galleon', 'paddleGalleon', { color: 0x4a3a2a, sail: 0xe8e0d0, sail2: 0xb02a2a }], ['mortarBarge', 'Mortar Barge', 'brigantine', 'paddleGalleon', { color: 0x3a3a40, sail: 0xe8e0d0, sails: 1 }], ['royal', 'Royal Carrack', 'manowar', 'cog', { color: 0x5a3a24, sail: 0xe8e0d0, sail2: 0xb02a2a, emblem: 'skull' }]],
    air: { name: 'Imperial Airship', style: 'kingdom', color: 0x5a3a24, envelope: 0xb02a2a, pods: 'greatsword' } },

  { id: 'aethel', name: 'The Aethelian Dominion', adj: 'Aethelian', group: 0, town: 'old', look: 'elemental', biomes: ['temperate', 'snow'],
    P: { species: 'elf', skin: 0xf0dcc8, cloth: 0xf2f0ea, cloth2: 0x3a7ac8, armor: 0xe8e2c8, trim: 0xd8c070 },
    places: { city: 'ivory city', castle: 'tower of the dawn', village: 'waystone glade', island: 'shining isle' },
    roster: (m) => [
      ['spear', 'Dominion Spearman', 'pikeman', m.h('elfScale', 'spear', { shield: true }), { k: 1.15, w: 0.2 }],
      ['archer', 'Dominion Archer', 'longbow', m.h('elfScale', 'longbow'), { k: 1.2, w: 0.18 }],
      ['swordmaster', 'Blade-Master', 'knight', m.h('elfScale', 'greatsword'), { k: 1.1, w: 0.12 }],
      ['silverHelm', 'Silver Helm', 'lancer', m.r('elfScale', 'horse', 'lance', 0xf0ece4, { barding: true }), { k: 1.25, w: 0.1 }],
      ['lionGuard', 'White Lion', 'halberdier', m.h('elfScale', 'greataxe', { cloak: 'lion' }), { k: 1.2, w: 0.08 }],
      ['mageA', 'Loremaster', 'battlemage', m.h('mage', 'staff', { robe: true, cloth: 0xf2f0ea }), { k: 1.2, w: 0.06 }],
      ['warLion', 'White War-Lion', 'alphaWolf', m.q('lion', 0xf0ece0, 1.3), { w: 0.06 }],
      ['eagle', 'Great Eagle', 'harpy', m.b('bird', { kind: 'eagle', color: 0x8a6a40, scale: 1.4 }, { body: 'humanoid', species: 'harpy', outfit: 'feathers', skin: 0xd8c8a8, cloth: 0x8a6a40 }), { k: 1.6, w: 0.05 }],
      ['phoenix', 'Phoenix', 'wyrmling', m.b('bird', { kind: 'phoenix', color: 0xff8a2a, glow: 0xffc040, scale: 1.8 }, { body: 'dragon', scales: 0xff8a2a, scale: 0.8 }), { k: 1.3, w: 0.04 }],
      ['frostPhoenix', 'Frost Phoenix', 'wyrmling', m.b('bird', { kind: 'phoenix', color: 0x9ad8ff, glow: 0xc8f0ff, scale: 1.8 }, { body: 'dragon', scales: 0x9ad8ff, scale: 0.8 }), { k: 1.3, w: 0.03, as: true }],
      ['sunDragon', 'Sun Dragon', 'wyrmling', m.d(0xe8b03a, 1.0), { k: 1.6, w: 0.04, size: 2 }],
      ['moonDragon', 'Moon Dragon', 'drake', m.d(0xb8c4e0, 1.4), { w: 0.04 }],
      ['starDragon', 'Star Dragon', 'drake', m.d(0xf2f0ff, 1.8), { k: 1.6, w: 0.02, as: true }],
    ],
    ships: [['swan', 'Swan Galley', 'frigate', 'swanGalley', { color: 0xf0ece4, sail: 0xe8f0ff, sail2: 0xc8a0e8, trim: 0xc8ccd8 }], ['swanSkiff', 'Swan Skiff', 'cutter', 'swanGalley', { color: 0xf0ece4, sail: 0xe8f0ff, sail2: 0x9ad8ff, trim: 0xc8ccd8 }]],
    air: { name: 'Skycutter', style: 'elemental', color: 0xf0ece4, envelope: 0xe8f0ff, pods: 'swordmaster', hangar: 'eagle' } },

  { id: 'kaelneth', name: "The Shadow-Kin of Kael'Neth", adj: 'Shadow-Kin', group: 0, town: 'dark', look: 'infernal', biomes: ['snow', 'volcanic', 'swamp'],
    P: { species: 'elf', skin: 0xd8d0dc, cloth: 0x8a1420, cloth2: 0x1a1a22, armor: 0x24242c, trim: 0x9a8a9a },
    places: { city: 'obsidian citadel', castle: 'cliff citadel', coast: 'slaver port', harbor: 'corsair harbour', village: 'slave pen' },
    roster: (m) => [
      ['dread', 'Dreadspear', 'pikeman', m.h('barbed', 'spear', { shield: true }), { k: 1.1, w: 0.2 }],
      ['repeater', 'Darkshard', 'crossbow', m.h('barbed', 'repeater'), { k: 1.1, w: 0.16, speed: 4 }],
      ['corsair', 'Corsair', 'footman', m.h('barbed', 'cutlass', { cloak: 'scale' }), { k: 1.2, w: 0.12 }],
      ['executioner', 'Executioner', 'halberdier', m.h('barbed', 'greataxe'), { k: 1.3, w: 0.08 }],
      ['witch', 'Blood Witch', 'hobgoblin', m.h('none', 'dagger', { female: true, hair: 'long' }), { k: 0.9, w: 0.08, speed: 3 }],
      ['coldRider', 'Raptor Knight', 'lancer', m.r('barbed', 'raptor', 'lance', 0x3a5a4a), { k: 1.4, w: 0.1 }],
      ['sorceress', 'Sorceress', 'necromancer', m.h('mage', 'staff', { robe: true, cloth: 0x4a1a5a, female: true }), { w: 0.05 }],
      ['harpyK', 'Shrieking Harpy', 'harpy', { body: 'humanoid', species: 'harpy', outfit: 'feathers', skin: 0xc8c0cc, cloth: 0x2a2a34 }, { w: 0.06 }],
      ['manticore', 'Manticore', 'wyrmling', m.b('manticore', { fur: 0x6a3a2a, scale: 1.4 }, { body: 'quadruped', fur: 0x6a3a2a, scale: 1.6 }), { k: 1.2, w: 0.04 }],
      ['hydra', 'War Hydra', 'drake', m.b('hydra', { scales: 0x2a4a3a, heads: 5, scale: 1.5 }, { body: 'dragon', scales: 0x2a4a3a, scale: 1.3 }), { k: 1.1, w: 0.05, fly: false }],
      ['blackDragon', 'Black Dragon', 'drake', m.d(0x1a1a22, 1.6), { k: 1.3, w: 0.03, as: true }],
    ],
    ships: [['raider', 'Razor Galley', 'cutter', 'razorGalley', { color: 0x1a1a22, sail: 0x8a1420 }], ['reaver', 'Reaver Galley', 'frigate', 'razorGalley', { color: 0x1a1a22, sail: 0x8a1420 }],
      ['citadel', 'Citadel-Beast', 'leviathanArk', 'citadelBeast', { color: 0x1a1a22, sail: 0x8a1420, len: 12, beam: 6 }]],
    air: { name: 'Shadow Barque', style: 'infernal', color: 0x1a1a22, envelope: 0x4a1020, pods: 'executioner', hangar: 'harpyK' } },

  { id: 'verdant', name: 'The Verdant Host of Athel-Vael', adj: 'Verdant', group: 0, town: 'wild', look: 'beasts', biomes: ['temperate', 'jungle'],
    P: { species: 'elf', skin: 0xe8d0b0, cloth: 0xa8562a, cloth2: 0x5a7a2a, armor: 0x6a4a2a, trim: 0xd8a03a },
    over: { homes: 'hut', small: 'tent', trees: ['tree', 'tree', 'tree', 'pine'], civic: ['shrine', 'garden', 'fountain', 'stall', 'temple'] },
    places: { village: 'glade', fort: 'thorn ring', castle: 'tree-palace', city: 'canopy city', coast: 'river haven', harbor: 'root harbour', island: 'grove isle' },
    roster: (m) => [
      ['glade', 'Glade Guard', 'longbow', m.h('leafcloak', 'longbow', { hood: true }), { k: 1.2, w: 0.24 }],
      ['eternal', 'Thorn Guard', 'pikeman', m.h('leafcloak', 'spear', { shield: true, antlers: true }), { k: 1.15, w: 0.14 }],
      ['wardancer', 'War-Dancer', 'scout', m.h('woad', 'sword', { paint: 0x3a7a5a, hair: 'mohawk' }), { k: 1.3, w: 0.1 }],
      ['wildRider', 'Wild Rider', 'lancer', m.r('leafcloak', 'stag', 'spear', 0x7a5a3a, { antlers: true }), { k: 1.2, w: 0.1 }],
      ['dryad', 'Dryad', 'ghoul', m.b('treeman', { kind: 'dryad', bark: 0x5a4a2a, leaf: 0x7a9a2a, scale: 0.55 }, { body: 'humanoid', species: 'ghoul', outfit: 'none', skin: 0x5a4a2a }), { k: 0.9, w: 0.12 }],
      ['spellweaver', 'Spellweaver', 'cleric', m.h('leafcloak', 'staff', { hood: true, robe: true }), { w: 0.05 }],
      ['stag', 'Great Stag', 'alphaWolf', m.q('stag', 0x7a5a3a, 1.5), { w: 0.06 }],
      ['eagleV', 'Great Eagle', 'harpy', m.b('bird', { kind: 'eagle', color: 0x6a4a2a, scale: 1.4 }, { body: 'humanoid', species: 'harpy', outfit: 'feathers', skin: 0xd8c8a8, cloth: 0x6a4a2a }), { k: 1.6, w: 0.05 }],
      ['treeman', 'Tree-Warden', 'boneColossus', m.b('treeman', { bark: 0x4a3a22, leaf: 0x5a8a2a, scale: 2.4 }, { body: 'golem', stone: 0x4a3a22, scale: 2.2 }), { w: 0.07 }],
      ['forestDragon', 'Forest Dragon', 'drake', m.d(0x3a6a2a, 1.4), { w: 0.03, as: true }],
    ],
    ships: [['skiff', 'Living Skiff', 'skiff', 'livingSkiff', { color: 0x6a4a2a, sail: 0x7a9a2a }], ['rootship', 'Root-Ship', 'brigantine', 'livingSkiff', { color: 0x5a4022, sail: 0xa8562a }]],
    air: null },

  { id: 'grom', name: 'The Grom Holds', adj: 'Hold', group: 0, town: 'civ', look: 'elemental', biomes: ['snow', 'volcanic', 'temperate'],
    P: { species: 'dwarf', skin: 0xd8a080, cloth: 0x2a4a7a, cloth2: 0x8a2a1a, armor: 0x8a9098, trim: 0xb8862a },
    over: { homes: 'keep', small: 'house', lookout: 'pillar', deco: ['pillar', 'crates', 'statue'], guns: ['cannon', 'cannon', 'mortar'] },
    places: { village: 'mine head', fort: 'gatehouse', castle: 'mountain hold', city: 'great hold', coast: 'sea gate', harbor: 'iron harbour', island: 'rock hold' },
    roster: (m) => [
      ['warrior', 'Hold Warrior', 'footman', m.h('starIron', 'axe', { shield: true, beard: 'braided' }), { k: 1.3, w: 0.22, speed: 5 }],
      ['thunderer', 'Thunderer', 'crossbow', m.h('starIron', 'handgun', { beard: 'braided' }), { k: 1.25, w: 0.16 }],
      ['quarreller', 'Quarreller', 'crossbow', m.h('starIron', 'crossbow', { beard: 'forked', cloth: 0x4a6a2a }), { k: 1.15, w: 0.1 }],
      ['ironbreaker', 'Ironbreaker', 'paladin', m.h('starIron', 'warhammer', { shield: true, beard: 'braided', armor: 0xb0b8c8 }), { w: 0.1 }],
      ['slayer', 'Oathbreaker', 'hobgoblin', m.h('woad', 'greataxe', { hair: 'mohawk', beard: 'braided', paint: 0x2a4a8a }), { k: 1.3, w: 0.08 }],
      ['runesmith', 'Runesmith', 'warPriest', m.h('starIron', 'warhammer', { beard: 'forked', cloth: 0x8a2a1a }), { w: 0.05 }],
      ['miner', 'Miner', 'engineer', m.h('sapper', 'warhammer', { beard: 'braided' }), { k: 1.2, w: 0.05 }],
      ['gyro', 'Gyrocopter', 'gyrocopter', { body: 'aircraft', kind: 'gyro', style: 'kingdom' }, { k: 1.2, w: 0.07 }],
      ['ancestor', 'Stone Ancestor', 'golem', m.g(0x7a7a80, 1.7, { runes: 0x5ac8ff }), { k: 1.2, w: 0.07 }],
      ['organGun', 'Flame Cannon Crew', 'grenadier', m.h('starIron', 'handgun', { beard: 'curled' }), { k: 1.4, w: 0.04, projectile: 'fire' }],
    ],
    ships: [['dreadnought', 'Ironclad Dreadnought', 'manowar', 'dreadnought', { color: 0x4a4e56, sail: 0x8a2a1a, sails: 0, trim: 0xb8862a }], ['monitor', 'Steam Monitor', 'brigantine', 'dreadnought', { color: 0x4a4e56, sail: 0x8a2a1a, sails: 0, trim: 0xb8862a }]],
    air: { name: 'Bomber Blimp', style: 'kingdom', color: 0x6a5a40, envelope: 0xb8862a, pods: 'ironbreaker', hangar: 'gyro', bombs: 1.4 } },

  { id: 'xibalba', name: 'The Xibalban Temple-Cities', adj: 'Xibalban', group: 0, town: 'old', look: 'elemental', biomes: ['jungle', 'jungle', 'swamp'],
    P: { species: 'lizard', skin: 0x3a9a8a, cloth: 0xc83a2a, cloth2: 0x2ab8c8, armor: 0xd8a82a, trim: 0xd8a82a },
    over: { homes: 'keep', small: 'hut', lookout: 'pillar', guns: ['ballista', 'ballista'], shoreGun: 'harpoon', trees: ['tree', 'tree', 'tree'] },
    places: { village: 'spawning pools', fort: 'sun gate', castle: 'star temple', city: 'temple-city', coast: 'reef temple', harbor: 'serpent harbour', island: 'sun isle' },
    roster: (m) => [
      ['skink', 'Skink Skirmisher', 'goblinArcher', m.h('loincloth', 'blowpipe', { scale: 0.8, skin: 0x4ab8d8 }), { k: 1.2, w: 0.18, projectile: 'poison' }],
      ['saurus', 'Saurian Warrior', 'hobgoblin', m.h('sunGold', 'club', { shield: true }), { k: 1.2, w: 0.24 }],
      ['temple', 'Temple Guard', 'halberdier', m.h('sunGold', 'halberd', { skin: 0x2a6a8a }), { k: 1.4, w: 0.1 }],
      ['priest', 'Sun Priest', 'shaman', m.h('sunGold', 'staff', { scale: 0.8, skin: 0x4ab8d8 }), { k: 1.3, w: 0.05, projectile: 'holy' }],
      ['raptorRider', 'Raptor Rider', 'wolfRider', m.r('sunGold', 'raptor', 'spear', 0x3a7a4a), { k: 1.6, w: 0.08 }],
      ['skyrazor', 'Skyrazor Rider', 'harpy', m.b('saurian', { kind: 'pterosaur', skin: 0x8a5a3a, scale: 1.2, rider: true }, { body: 'humanoid', species: 'harpy', outfit: 'feathers', skin: 0x8a5a3a, cloth: 0x8a5a3a }), { k: 1.3, w: 0.07 }],
      ['hornback', 'Hornback Bow-Beast', 'cyclops', m.b('saurian', { kind: 'hornback', skin: 0x5a7a4a, scale: 2.0, howdah: 'bow' }, { body: 'quadruped', fur: 0x5a7a4a, scale: 2.4 }), { k: 1.6, w: 0.07, size: 3 }],
      ['shieldback', 'Shieldback Sun-Engine', 'cyclops', m.b('saurian', { kind: 'shieldback', skin: 0x6a6a4a, scale: 1.8, howdah: 'mirror' }, { body: 'quadruped', fur: 0x6a6a4a, scale: 2.2 }), { k: 1.3, w: 0.05, size: 3, style: 'magic', range: 8, mag: 70, projectile: 'holy' }],
      ['tyrant', 'Tyrant Lizard', 'drake', m.b('saurian', { kind: 'tyrant', skin: 0x7a3a2a, scale: 2.2 }, { body: 'dragon', scales: 0x7a3a2a, scale: 1.3 }), { w: 0.05, fly: false, as: true }],
    ],
    ships: [['serpent', 'Serpent Barge', 'frigate', 'serpentBarge', { color: 0xb0a890, sail: 0xc83a2a, sails: 0, trim: 0xd8a82a }], ['sunBarge', 'Sun Barge', 'cutter', 'serpentBarge', { color: 0xb0a890, sail: 0x2ab8c8, sails: 0, trim: 0xd8a82a }]],
    air: { name: 'Sky Temple', style: 'elemental', color: 0xb0a890, envelope: 0xd8a82a, pods: 'saurus', hangar: 'skyrazor' } },

  { id: 'velikaya', name: 'The Tsardom of Velikaya', adj: 'Velikayan', group: 0, town: 'civ', look: 'kingdom', biomes: ['snow', 'snow', 'temperate'],
    P: { species: 'human', skin: HUMAN, cloth: 0xa82a2a, cloth2: 0xe8e0d0, armor: 0xb0b8c0, trim: 0xd8b03a },
    over: { trees: ['pine', 'pine', 'tree'] },
    places: { castle: 'kremlin', city: 'domed city', village: 'stanitsa', fort: 'ostrog' },
    roster: (m) => [
      ['streltsi', 'Streltsi', 'crossbow', m.h('streltsy', 'axeGun'), { k: 1.1, w: 0.2 }],
      ['kossar', 'Kossar', 'longbow', m.h('streltsy', 'longbow', { cloth: 0x2a5a8a }), { k: 1.1, w: 0.12 }],
      ['axemen', 'Boyar Guard', 'halberdier', m.h('streltsy', 'greataxe', { cloth: 0x2a6a3a }), { k: 1.1, w: 0.12 }],
      ['hussar', 'Winged Lancer', 'lancer', m.r('hussar', 'horse', 'lance', 0x4a3020), { k: 1.4, w: 0.14 }],
      ['cossack', 'Steppe Rider', 'scout', m.r('streltsy', 'horse', 'sword', 0x7a5a3a), { k: 1.3, w: 0.1 }],
      ['iceWitch', 'Ice Witch', 'battlemage', m.h('brocade', 'staff', { robe: true, female: true, cloth: 0xb8d8f0 }), { k: 1.2, w: 0.06, projectile: 'ice' }],
      ['bearRider', 'War-Bear Rider', 'lancer', m.r('hussar', 'bear', 'halberd', 0x5a4030), { k: 1.8, w: 0.07, size: 2 }],
      ['warBear', 'Armoured War Bear', 'troll', m.q('bear', 0xe8e8e8, 1.6, { armor: 0xb0b8c0 }), { w: 0.07 }],
      ['snowLeopard', 'Snow Leopard', 'alphaWolf', m.q('leopard', 0xd8e0e8, 1.1, { glow: 0x9ad8ff }), { w: 0.05 }],
      ['iceConstruct', 'Ice-and-Stone Colossus', 'frostGolem', m.g(0xa8c8dc, 2.0), { k: 1.5, w: 0.05, as: true }],
    ],
    ships: [['icebreaker', 'Icebreaker Galleon', 'galleon', 'icebreaker', { color: 0x5a3a24, sail: 0xe8e0d0, sail2: 0xa82a2a }], ['icecutter', 'Ice Brig', 'brigantine', 'icebreaker', { color: 0x5a3a24, sail: 0xe8e0d0, len: 7 }]],
    air: { name: 'Tsar\'s Sky-Sled', style: 'kingdom', color: 0x5a3a24, envelope: 0xa82a2a, pods: 'axemen' } },

  { id: 'tianlong', name: 'The Celestial Dynasty of Tian-Long', adj: 'Celestial', group: 0, town: 'civ', look: 'kingdom', biomes: ['temperate', 'jungle', 'desert'],
    P: { species: 'human', skin: 0xe0b890, cloth: 0xb8201a, cloth2: 0x2a8a6a, armor: 0x7a1a14, trim: 0xd8b03a },
    places: { castle: 'wall fortress', city: 'pagoda city', fort: 'wall gate', village: 'rice village', harbor: 'treasure harbour' },
    roster: (m) => [
      ['peasantLong', 'Peasant Spearman', 'militia', m.h('lamellar', 'spear', { variant: 'ashigaru', armor: 0x5a4a3a }), { k: 1.1, w: 0.16 }],
      ['jadeWarrior', 'Jade Warrior', 'halberdier', m.h('lamellar', 'halberd', { armor: 0x2a8a6a }), { k: 1.1, w: 0.18 }],
      ['repeaterC', 'Jade Crossbow', 'crossbow', m.h('lamellar', 'repeater', { armor: 0x2a8a6a }), { w: 0.16, speed: 4 }],
      ['celestialGuard', 'Celestial Guard', 'knight', m.h('lamellar', 'glaive', { armor: 0xd8b03a, cloth: 0xb8201a }), { k: 1.2, w: 0.08 }],
      ['longmaRider', 'Longma Rider', 'griffon', m.r('lamellar', 'longma', 'glaive', 0x2a8a6a, { wings: true }), { k: 1.2, w: 0.05 }],
      ['alchemist', 'Alchemist', 'battlemage', m.h('silkRobe', 'staff', { robe: true, cloth: 0xe8c83a }), { w: 0.05 }],
      ['rocketeer', 'Fire-Rain Rocketeer', 'grenadier', m.h('lamellar', 'handgun', { variant: 'ashigaru' }), { k: 1.3, w: 0.06, range: 8, projectile: 'fire' }],
      ['jadeLion', 'Jade Lion', 'golem', m.q('lion', 0x3aa87a, 1.5, { stone: true }), { k: 0.9, w: 0.06, move: 2 }],
      ['terracotta', 'Terracotta Sentinel', 'boneColossus', m.g(0xb8724a, 2.4, { armor: 'lamellar' }), { w: 0.06 }],
      ['balloon', 'War Balloon', 'gyrocopter', m.b('balloon', { color: 0xb8201a, trim: 0xd8b03a }, { body: 'aircraft', kind: 'gyro', style: 'kingdom' }), { k: 1.5, w: 0.05, projectile: 'fire' }],
      ['celestialDragon', 'River Dragon', 'drake', m.d(0x2a9a8a, 1.3, { eastern: true }), { w: 0.03, as: true }],
    ],
    ships: [['junk', 'Treasure Junk', 'manowar', 'junk', { color: 0x6a2a1a, sail: 0xb8201a, sail2: 0x5a1a10, emblem: 'dragon' }], ['warJunk', 'War Junk', 'brigantine', 'junk', { color: 0x6a2a1a, sail: 0xd8a03a }]],
    air: { name: 'Sky-Junk', style: 'kingdom', color: 0x6a2a1a, envelope: 0xb8201a, pods: 'celestialGuard', hangar: 'balloon' } },

  // =========================== The Forces of Destruction ===========================
  { id: 'ironbound', name: 'The Ironbound Legions', adj: 'Ironbound', group: 1, town: 'dark', look: 'infernal', biomes: ['volcanic', 'snow'],
    P: { species: 'human', skin: PALE, cloth: 0x3a1010, cloth2: 0x1a1a1a, armor: 0x1e1e24, trim: 0x8a2a1a },
    places: { village: 'skull altar', fort: 'basalt redoubt', castle: 'dark-iron fortress', city: 'city of monoliths' },
    roster: (m) => [
      ['marauder', 'Marauder', 'hobgoblin', m.h('pelts', 'axe', { shield: true, species: 'human', paint: 0x6a1a1a }), { w: 0.2 }],
      ['warriorI', 'Ironbound Warrior', 'knight', m.h('dreadPlate', 'axe', { shield: true }), { k: 1.2, w: 0.2 }],
      ['chosen', 'Chosen Champion', 'paladin', m.h('dreadPlate', 'greataxe', { scale: 1.12 }), { k: 1.2, w: 0.1 }],
      ['dreadKnight', 'Dread Knight', 'lancer', m.r('dreadPlate', 'horse', 'lance', 0x1a1a1a, { barding: true }), { k: 1.6, w: 0.1 }],
      ['sorcererI', 'Iron Sorcerer', 'necromancer', m.h('dreadPlate', 'staff'), { k: 1.2, w: 0.05 }],
      ['spawn', 'Twisted Spawn', 'troll', { body: 'humanoid', species: 'ghoul', outfit: 'tatters', skin: 0xa86a7a, cloth: 0x3a1010, weapon: 'claws', scale: 1.5 }, { k: 0.9, w: 0.08 }],
      ['goreOx', 'Gore-Ox Rider', 'lancer', m.r('dreadPlate', 'bull', 'greataxe', 0x4a1a1a), { k: 2.0, w: 0.06, size: 2 }],
      ['stormOgre', 'Storm Drake-Ogre', 'cyclops', m.b('centaur', { kind: 'drake', skin: 0x4a5a7a, scale: 1.8, weapon: 'greataxe' }, { body: 'humanoid', species: 'ogre', outfit: 'hides', skin: 0x4a5a7a, cloth: 0x2a2a2a, weapon: 'greataxe', scale: 1.3 }), { k: 1.5, w: 0.06 }],
      ['chaosDragon', 'Three-Headed Dragon', 'drake', m.b('hydra', { scales: 0x3a1a2a, heads: 3, wings: true, scale: 1.6 }, { body: 'dragon', scales: 0x3a1a2a, scale: 1.6 }), { k: 1.4, w: 0.03, as: true }],
    ],
    ships: [['dreadGalley', 'Dread-Galley', 'frigate', 'dreadGalley', { color: 0x1e1e24, sail: 0x8a6a5a }], ['reaverI', 'Iron Reaver', 'cutter', 'dreadGalley', { color: 0x1e1e24, sail: 0x8a6a5a }]],
    air: { name: 'Floating Dark-Iron Fortress', style: 'infernal', color: 0x1e1e24, envelope: 0x3a1010, pods: 'chosen' } },

  { id: 'screaming', name: 'The Endless Screaming', adj: 'Screaming', group: 1, town: 'dark', look: 'infernal', biomes: ['volcanic', 'swamp'],
    P: { species: 'demon', skin: 0xa8442a, cloth: 0x3a1010, cloth2: 0x6a1a5a, armor: 0xb0782a, trim: 0xb0782a },
    places: { village: 'fungal garden', fort: 'bone palisade', castle: 'palace of bone and brass', city: 'city of impossible spires' },
    roster: (m) => [
      ['brass', 'Brass Berserker', 'hobgoblin', m.h('loincloth', 'greatsword', { skin: 0xb85a2a }), { k: 1.4, w: 0.2 }],
      ['rot', 'Rot-Fiend', 'plagueBearer', m.h('bloat', 'club', { species: 'ogre', skin: 0x7a8a4a, scale: 0.8 }), { k: 1.3, w: 0.18 }],
      ['horror', 'Iridescent Horror', 'imp', m.h('none', 'claws', { species: 'imp', skin: 0xe85ac8, eyes: 5 }), { k: 1.4, w: 0.16, fly: false }],
      ['temptress', 'Silk Temptress', 'ghoul', m.h('silkRobe', 'claws', { species: 'demon', female: true, skin: 0xd8b8e0, cloth: 0x9a5ac8, claw: 'crab', wings: false }), { k: 1.2, w: 0.16 }],
      ['fleshHound', 'Brass Hound', 'hellhound', m.q('hound', 0x8a2a1a, 1.2, { armor: 0xb0782a }), { w: 0.08 }],
      ['rageLord', 'Lord of Rage', 'infernalLord', m.h('infernalPlate', 'greataxe', { build: 'heavy', skin: 0x8a1a14, armor: 0xb0782a, scale: 2.0, wings: true }), { w: 0.03, as: true, fly: false }],
      ['plagueFather', 'Father of Plagues', 'infernalLord', m.h('bloat', 'club', { species: 'ogre', build: 'heavy', skin: 0x6a7a3a, scale: 2.1 }), { k: 1.1, w: 0.03, abilities: [{ type: 'siege', mult: 2 }, { type: 'poison', damage: 6, chance: 0.6 }, { type: 'regen', amount: 8, every: 5 }, { type: 'stomp', every: 4, radius: 2, maxHit: 30 }] }],
      ['featheredSeer', 'Feathered Seer', 'infernalLord', m.b('bird', { kind: 'vultureLord', color: 0x3a6ad8, glow: 0xe85ac8, scale: 2.6, staff: true }, { body: 'humanoid', species: 'harpy', outfit: 'feathers', skin: 0x7a8ad8, cloth: 0x3a6ad8, weapon: 'staff', scale: 2.2 }), { k: 0.8, w: 0.03, style: 'magic', range: 9, mag: 95, projectile: 'shadow', fly: true }],
      ['keeper', 'Keeper of Whispers', 'infernalLord', m.h('silkRobe', 'claws', { species: 'demon', female: true, build: 'tall', skin: 0xe0c0e8, cloth: 0x9a5ac8, scale: 2.0, claw: 'crab', arms: 4 }), { k: 0.9, w: 0.03, speed: 3, move: 2 }],
      ['forgeCrawler', 'Forge-Crawler', 'boneColossus', m.b('daemonEngine', { color: 0x3a3a40, glow: 0xff5a14, legs: 6, scale: 2.2 }, { body: 'spider', fur: 0x3a3a40, scale: 2.4 }), { k: 1.3, w: 0.04 }],
    ],
    ships: [['fleshBarge', 'Flesh-and-Brass Barge', 'galleon', 'fleshBarge', { color: 0x7a2a22, sail: 0xc89a8a, trim: 0xb0782a }], ['crystalSkiff', 'Crystal Skiff', 'cutter', 'serpentBarge', { color: 0x9a7ad8, sail: 0xe85ac8, sails: 0, trim: 0xe85ac8 }], ['rotHulk', 'Rotting Ghost-Hulk', 'brigantine', 'shroudGalleon', { color: 0x4a5a3a, sail: 0x5a6a3a, ghost: true }]],
    air: { name: 'Screaming Spire', style: 'infernal', color: 0x4a1a3a, envelope: 0x9a5ac8, pods: 'brass', hangar: '!imp' } },

  { id: 'cloven', name: 'The Cloven Herds', adj: 'Cloven', group: 1, town: 'wild', look: 'beasts', biomes: ['temperate', 'swamp', 'jungle'],
    P: { species: 'goat', skin: 0x6a4a32, cloth: 0x4a3626, cloth2: 0x6a1a1a, armor: 0x6a4a3a, trim: 0x8a8070 },
    over: { civic: ['shrine', 'graveyard', 'totem', 'bonePit'], homes: 'tent', small: 'tent' },
    places: { village: 'herdstone clearing', fort: 'bone ring', castle: 'great herdstone', city: 'gathering of herds', coast: 'driftwood camp', harbor: 'wreckers\' camp', island: 'herd isle' },
    roster: (m) => [
      ['ungor', 'Lesser Herdling', 'goblinSpear', m.h('rags', 'spear', { scale: 0.85, horns: 'swept' }), { k: 1.5, w: 0.2 }],
      ['raiderC', 'Herd Raider', 'goblinArcher', m.h('rags', 'longbow', { scale: 0.85, horns: 'swept' }), { k: 1.6, w: 0.12, projectile: 'arrow' }],
      ['gor', 'Cloven Brute', 'hobgoblin', m.h('hides', 'cleaver', { shield: true }), { k: 1.1, w: 0.24 }],
      ['bestigor', 'Great-Horn', 'halberdier', m.h('scrapPlate', 'greataxe', { horns: 'long', scale: 1.1 }), { k: 1.2, w: 0.1 }],
      ['shamanC', 'Bray-Seer', 'shaman', m.h('shaman', 'staff', { horns: 'long' }), { k: 1.6, w: 0.05 }],
      ['boar', 'Razor-Tusk Boar', 'alphaWolf', m.q('boar', 0x4a3a2a, 1.4), { k: 1.1, w: 0.08 }],
      ['minotaurC', 'Minotaur', 'minotaur', { body: 'humanoid', species: 'minotaur', outfit: 'loincloth', skin: 0x5a3a24, cloth: 0x3a2a1a, weapon: 'greataxe', scale: 1.5 }, { w: 0.1 }],
      ['giantC', 'Two-Headed Giant', 'boneColossus', m.h('hides', 'club', { species: 'cyclops', heads: 2, skin: 0xb89a7a, scale: 2.6 }), { w: 0.05 }],
      ['gorgon', 'Four-Armed Gorgon', 'cyclops', m.h('loincloth', 'claws', { species: 'minotaur', arms: 4, skin: 0x4a2a2a, scale: 2.0 }), { k: 1.5, w: 0.04, as: true }],
    ],
    ships: [['hideRaft', 'Hide Raft', 'raft', 'hideRaft', { color: 0x6a5a40, sail: 0x8a6a4a }], ['boneRaft', 'Ribcage Raft', 'skiff', 'hideRaft', { color: 0x6a5a40, sail: 0x8a6a4a }]],
    air: null },

  { id: 'fimbul', name: 'The Fimbulwinter Raiders', adj: 'Fimbulwinter', group: 1, town: 'tribal', look: 'beasts', biomes: ['snow', 'snow', 'temperate'],
    P: { species: 'human', skin: 0xe0b89a, cloth: 0x4a3a2a, cloth2: 0x8a2a1a, armor: 0x6a6a70, trim: 0xb8862a },
    over: { homes: 'house', civic: ['inn', 'stall', 'barracks', 'shrine', 'graveyard', 'marketHall'], trees: ['pine', 'pine'] },
    places: { village: 'longhouse steading', fort: 'fjord stockade', castle: 'jarl\'s hall', city: 'fjord port', coast: 'raiders\' beach', harbor: 'longship harbour', island: 'skerry hold' },
    roster: (m) => [
      ['berserker', 'Berserker', 'hobgoblin', m.h('pelts', 'axe', { paint: 0x2a4a7a, hair: 'braids', beard: 'braided' }), { k: 1.1, w: 0.22, abilities: [{ type: 'enrage', threshold: 0.5, mult: 1.5 }] }],
      ['shieldmaiden', 'Shield-Bearer', 'footman', m.h('pelts', 'sword', { shield: true, helm: true, beard: 'forked' }), { k: 1.1, w: 0.2 }],
      ['hunter', 'Ice Hunter', 'longbow', m.h('pelts', 'javelin', { hair: 'braids' }), { k: 1.0, w: 0.12, range: 6 }],
      ['huscarl', 'Huscarl', 'knight', m.h('pelts', 'greataxe', { helm: true, armor: 0x6a6a70, cuirass: true }), { w: 0.1 }],
      ['skinwolf', 'Skinwolf', 'troll', m.h('none', 'claws', { species: 'ghoul', wolfHead: true, skin: 0x5a5a60, scale: 1.4 }), { k: 0.8, w: 0.08, move: 2 }],
      ['seer', 'Rune Seer', 'shaman', m.h('shaman', 'staff', { species: 'human' }), { k: 1.8, w: 0.04, projectile: 'ice' }],
      ['iceTroll', 'Ice Troll', 'troll', { body: 'humanoid', species: 'troll', outfit: 'loincloth', skin: 0x9ac0d8, cloth: 0x4a3a2a, weapon: 'club', scale: 1.5 }, { w: 0.08 }],
      ['mammoth', 'War Mammoth', 'boneColossus', m.q('mammoth', 0x5a4030, 2.6, { howdah: true }), { k: 1.2, w: 0.06 }],
      ['frostWyrm', 'Frost-Wyrm', 'drake', m.d(0xb8dcf0, 1.3, { wings: false }), { w: 0.04, as: true, fly: false }],
    ],
    ships: [['longship', 'Longship', 'sloop', 'longship', { color: 0x5a3a24, sail: 0xe8e0d0, sail2: 0x8a2a1a, oars: true }], ['drakkar', 'Great Drakkar', 'brigantine', 'longship', { color: 0x4a2a1a, sail: 0xe8e0d0, sail2: 0x2a4a7a, oars: true }]],
    air: null },

  { id: 'ashur', name: 'The Ziggurat Forges of Ashur', adj: 'Ashurite', group: 1, town: 'dark', look: 'infernal', biomes: ['volcanic', 'desert'],
    P: { species: 'dwarf', skin: 0xb88a6a, cloth: 0x6a1a14, cloth2: 0x1a1a1a, armor: 0x26262c, trim: 0xb0782a },
    over: { guns: ['mortar', 'mortar', 'cannon'] },
    places: { village: 'slave pits', fort: 'brass gate', castle: 'forge-ziggurat', city: 'ziggurat city', harbor: 'ash harbour' },
    roster: (m) => [
      ['slave', 'Hobgoblin Overseer', 'hobgoblin', { body: 'humanoid', species: 'hobgoblin', outfit: 'hides', skin: 0x8a8a4a, cloth: 0x3a2a1a, weapon: 'sword' }, { w: 0.18 }],
      ['ashWarrior', 'Ashurite Warrior', 'footman', m.h('ziggurat', 'axe', { shield: true, beard: 'curled' }), { k: 1.3, w: 0.2 }],
      ['blunder', 'Blunderbuss', 'crossbow', m.h('ziggurat', 'blunderbuss', { beard: 'curled' }), { k: 1.2, w: 0.16, range: 5, abilities: [{ type: 'splash', radius: 1, mult: 0.5 }] }],
      ['immortal', 'Obsidian Immortal', 'paladin', m.h('ziggurat', 'greataxe', { beard: 'curled', armor: 0x1a1a22 }), { w: 0.08 }],
      ['daemonsmith', 'Daemonsmith', 'battlemage', m.h('ziggurat', 'staff', { beard: 'curled', robe: true }), { k: 1.2, w: 0.05 }],
      ['slaveOgre', 'Chained Ogre', 'ogre', { body: 'humanoid', species: 'ogre', outfit: 'scrapPlate', skin: 0xa6895a, cloth: 0x3a2a1a, armor: 0x26262c, weapon: 'club', scale: 1.3 }, { w: 0.08 }],
      ['ironBull', 'Burning Iron Bull', 'minotaur', m.b('ironBull', { color: 0x2a2a30, glow: 0xff5a14, scale: 1.8 }, { body: 'quadruped', fur: 0x2a2a30, scale: 2.0 }), { k: 1.3, w: 0.07, abilities: [{ type: 'charge', mult: 2 }, { type: 'siege', mult: 2 }, { type: 'breath', every: 4, maxHit: 20, radius: 1 }] }],
      ['taurus', 'Winged Fire-Bull', 'wyrmling', m.b('ironBull', { color: 0x4a1a14, glow: 0xff5a14, wings: true, scale: 1.6 }, { body: 'dragon', scales: 0x4a1a14, scale: 0.9 }), { k: 1.5, w: 0.04 }],
      ['engine', 'Daemon-Engine', 'boneColossus', m.b('daemonEngine', { color: 0x26262c, glow: 0xff5a14, scale: 2.2 }, { body: 'golem', stone: 0x26262c, scale: 2.2 }), { w: 0.05, as: true }],
    ],
    ships: [['monitorA', 'Fire-Bound Monitor', 'frigate', 'dreadnought', { color: 0x26262c, sail: 0x6a1a14, sails: 0, trim: 0xb0782a }], ['mortarShip', 'Volcano Mortar-Ship', 'galleon', 'dreadnought', { color: 0x26262c, sail: 0x6a1a14, sails: 0, trim: 0xb0782a }]],
    air: { name: 'Smog Barge', style: 'infernal', color: 0x26262c, envelope: 0x6a1a14, pods: 'immortal', bombs: 1.3 } },

  { id: 'greenhide', name: 'The Greenhide Hordes', adj: 'Greenhide', group: 1, town: 'tribal', look: 'goblin', biomes: ['swamp', 'desert', 'temperate'],
    P: { species: 'orc', skin: 0x5a8a3a, cloth: 0x4a3626, cloth2: 0x8a1a14, armor: 0x5a5a5e, trim: 0x8a1a14 },
    over: { civic: ['stall', 'inn', 'barracks', 'shrine', 'graveyard', 'scrapHut', 'warDrum', 'brewery', 'totem'] },
    places: { village: 'scrap camp', fort: 'stockade', castle: 'boss fort', city: 'shanty sprawl', coast: 'wreckers\' cove', harbor: 'hulk yard', island: 'rock fort' },
    roster: (m) => [
      ['nightGoblin', 'Hooded Goblin', 'goblin', m.h('darkHood', 'spear', { species: 'goblin', skin: 0x6f9a3a, cloth: 0x1a1a22 }), { w: 0.18 }],
      ['gobArcher', 'Hooded Archer', 'goblinArcher', m.h('darkHood', 'longbow', { species: 'goblin', skin: 0x6f9a3a, cloth: 0x1a1a22 }), { w: 0.12, projectile: 'arrow' }],
      ['boy', 'Greenhide Brute', 'hobgoblin', m.h('scrapPlate', 'cleaver', { shield: true }), { k: 1.25, w: 0.24 }],
      ['bigUn', 'Iron Brute', 'knight', m.h('scrapPlate', 'greataxe', { scale: 1.12, armor: 0x3a3a3e }), { k: 1.2, w: 0.1 }],
      ['boarBoy', 'Boar Rider', 'lancer', m.r('scrapPlate', 'boar', 'spear', 0x4a3a2a), { k: 1.1, w: 0.1 }],
      ['shamanG', 'Hedge Shaman', 'shaman', m.h('shaman', 'staff', { species: 'goblin', skin: 0x6f9a3a }), { w: 0.05 }],
      ['riverTroll', 'River Troll', 'troll', { body: 'humanoid', species: 'troll', outfit: 'loincloth', skin: 0x4a7a6a, cloth: 0x3a3a2a, weapon: 'club', scale: 1.5 }, { w: 0.07 }],
      ['wyvern', 'Wyvern Rider', 'wyrmling', m.d(0x6a7a3a, 0.9, { rider: 'orc' }), { k: 1.2, w: 0.04 }],
      ['greatSpider', 'Great Forest Spider', 'boneColossus', { body: 'spider', fur: 0x2a3a2a, scale: 3.0, howdah: true }, { w: 0.04, abilities: [{ type: 'poison', damage: 5, chance: 0.5 }, { type: 'siege', mult: 2 }, { type: 'cleave', radius: 2, mult: 0.5 }] }],
      ['rockIdol', 'Rogue Idol', 'golem', m.g(0x6a6a5a, 2.6, { crude: true }), { k: 1.8, w: 0.03, as: true, size: 3 }],
    ],
    ships: [['hulk', 'Scrap-Hulk', 'galleon', 'scrapHulk', { color: 0x5a4a36, sail: 0x8a7a5a }], ['paddler', 'Paddle Wreck', 'brigantine', 'scrapHulk', { color: 0x5a4a36, sail: 0x8a7a5a, len: 7 }]],
    air: { name: 'Scrap Blimp', style: 'goblin', color: 0x5a4630, envelope: 0x6a7a3a, pods: 'boy', hangar: '!glider' } },

  { id: 'skar', name: 'The Warrens of Skar', adj: 'Skarrish', group: 1, town: 'tribal', look: 'goblin', biomes: ['swamp', 'temperate', 'volcanic'],
    P: { species: 'rat', skin: 0x6a5a4a, cloth: 0x5a2a22, cloth2: 0x3a3a2a, armor: 0x7a6a4a, trim: 0x5aff5a },
    over: { civic: ['stall', 'barracks', 'shrine', 'alchemist', 'alchemist', 'graveyard', 'scrapHut', 'brewery'], guns: ['mortar', 'ballista', 'cannon'] },
    places: { village: 'burrow', fort: 'scaffold fort', castle: 'reactor warren', city: 'under-city', coast: 'sewer mouth', harbor: 'sludge docks', island: 'plague rock' },
    roster: (m) => [
      ['slaveRat', 'Warren Thrall', 'goblin', m.h('rags', 'spear', { scale: 0.9 }), { k: 1.2, w: 0.2 }],
      ['clanrat', 'Clawpack Rat', 'footman', m.h('ragGoggles', 'sword', { shield: true }), { k: 0.8, w: 0.22 }],
      ['stormrat', 'Stormrat', 'halberdier', m.h('scrapPlate', 'halberd', { skin: 0x2a2a2a }), { k: 0.9, w: 0.1 }],
      ['jezzail', 'Blight-Rifle', 'crossbow', m.h('ragGoggles', 'handgun', { glow: 0x5aff5a }), { w: 0.1, range: 9, projectile: 'poison' }],
      ['globadier', 'Gas Globadier', 'bomber', m.h('ragGoggles', 'sling', { glow: 0x5aff5a }), { k: 2.4, w: 0.06, projectile: 'poison' }],
      ['plagueMonk', 'Plague Monk', 'plagueBearer', m.h('flagellant', 'club', { skin: 0x7a7a5a }), { k: 0.8, w: 0.08 }],
      ['warlock', 'Blightstone Engineer', 'battlemage', m.h('ragGoggles', 'staff', { glow: 0x5aff5a }), { w: 0.05, projectile: 'poison' }],
      ['giantRat', 'Giant Plague-Rat', 'wolf', m.q('rat', 0x5a4a3a, 0.9), { k: 0.7, w: 0.06 }],
      ['ratOgre', 'Stitched Rat-Ogre', 'troll', m.h('none', 'claws', { species: 'rat', build: 'heavy', stitched: true, scale: 1.9 }), { w: 0.07 }],
      ['wheel', 'Lightning Wheel', 'ram', m.b('wheelEngine', { color: 0x6a4a2a, glow: 0x5aff5a }, { body: 'ram', color: 0x6a4a2a }), { k: 0.9, w: 0.04, move: 2, abilities: [{ type: 'charge', mult: 2.5 }, { type: 'siege', mult: 2 }, { type: 'cleave', radius: 1, mult: 0.6 }] }],
      ['abomination', 'Pit Abomination', 'boneColossus', m.b('hydra', { scales: 0x8a6a6a, heads: 3, flesh: true, scale: 1.6 }, { body: 'humanoid', species: 'troll', outfit: 'tatters', skin: 0x8a6a6a, cloth: 0x3a2a2a, weapon: 'claws', scale: 2.6 }), { w: 0.03, as: true }],
    ],
    ships: [['sub', 'Rat Submersible', 'cutter', 'submersible', { color: 0x8a6a3a, sail: 0x5aff5a, sails: 0 }], ['sludge', 'Sludge Paddler', 'brigantine', 'scrapHulk', { color: 0x4a4a36, sail: 0x5a6a3a }]],
    air: { name: 'Blight Balloon', style: 'goblin', color: 0x5a4630, envelope: 0x4a6a3a, pods: 'stormrat', bombs: 1.3 } },

  // =========================== The Undead Legions ===========================
  { id: 'crimson', name: 'The Crimson Aristocracy', adj: 'Crimson', group: 2, town: 'necro', look: 'undead', biomes: ['swamp', 'snow', 'temperate'],
    P: { species: 'human', skin: 0xe4dcd8, cloth: 0x7a1018, cloth2: 0x14141a, armor: 0x2a1a1e, trim: 0xb89a4a },
    over: { civic: ['temple', 'shrine', 'graveyard', 'graveyard', 'alchemist', 'palace', 'garden', 'crypt', 'charnel', 'inn'] },
    places: { village: 'gallows hamlet', fort: 'mausoleum fort', castle: 'spired castle', city: 'city of the counts', coast: 'fog chapel', harbor: 'shroud harbour', island: 'crypt isle' },
    roster: (m) => [
      ['zombie', 'Rotting Peasant', 'militia', { body: 'humanoid', species: 'ghoul', outfit: 'peasant', skin: 0x8a9a7a, cloth: 0x5a4a3a, weapon: 'club' }, { k: 1.2, w: 0.2, speed: 6 }],
      ['rustSkel', 'Rusted Skeleton', 'skeleton', { body: 'skeleton', weapon: 'spear', shield: true }, { w: 0.2 }],
      ['graveGuard', 'Grave Guard', 'wight', { body: 'skeleton', weapon: 'greatsword', armor: 0x3a4a4a }, { w: 0.1 }],
      ['direWolf', 'Dire Wolf', 'wolf', m.q('wolf', 0x2a2a30, 1.15, { rot: true }), { w: 0.08 }],
      ['fellBat', 'Giant Vampire Bat', 'bat', { body: 'bat', fur: 0x2a1a20, scale: 1.5 }, { k: 1.6, w: 0.07 }],
      ['wraith', 'Wraith', 'banshee', { body: 'elemental', glow: 0x9ad8c8, hood: true }, { k: 1.2, w: 0.05, fly: false, abilities: [{ type: 'protect', style: 'melee', reduction: 0.5 }] }],
      ['bloodKnight', 'Blood Knight', 'lancer', m.r('nobleDead', 'horse', 'lance', 0x14141a, { barding: true }), { k: 2.0, w: 0.07, abilities: [{ type: 'charge', mult: 2 }, { type: 'regen', amount: 3, every: 4 }] }],
      ['vampire', 'Vampire Count', 'paladin', m.h('nobleDead', 'longsword', { hair: 'swept', hairColor: 0x14141a }), { k: 1.5, w: 0.05, abilities: [{ type: 'regen', amount: 5, every: 4 }, { type: 'cleave', radius: 1, mult: 0.5 }] }],
      ['necroC', 'Necromancer', 'necromancer', { body: 'humanoid', outfit: 'necromancer', skin: 0xb8b8a8, cloth: 0x2a1f3a, weapon: 'staff', hood: true }, { w: 0.05 }],
      ['terrorBat', 'Carrion Colossus Bat', 'drake', { body: 'bat', fur: 0x3a3a34, scale: 4.2, bones: true }, { k: 0.9, w: 0.03 }],
      ['zombieDragon', 'Zombie Dragon', 'drake', m.d(0x5a6a4a, 1.5, { rot: true }), { k: 1.1, w: 0.02, as: true }],
    ],
    ships: [['shroud', 'Shrouded Galleon', 'galleon', 'shroudGalleon', { color: 0x2a2224, sail: 0x14141a }], ['barrow', 'Barrow Hulk', 'brigantine', 'shroudGalleon', { color: 0x2a2224, sail: 0x14141a }]],
    air: { name: 'Coffin Ship', style: 'undead', color: 0x2a2224, envelope: 0x4a1018, pods: 'graveGuard', hangar: 'fellBat' } },

  { id: 'khemet', name: 'The Eternal Dynasties of Khemet', adj: 'Khemetic', group: 2, town: 'necro', look: 'undead', biomes: ['desert', 'desert'],
    P: { species: 'mummy', skin: 0x5a4a3a, cloth: 0xe8dcc0, cloth2: 0xd8ceb0, armor: 0xb8862a, trim: 0xd8b03a },
    over: { civic: ['temple', 'temple', 'shrine', 'graveyard', 'palace', 'garden', 'obelisk', 'crypt'], trees: [] },
    places: { village: 'tomb village', fort: 'pylon gate', castle: 'pyramid', city: 'necropolis of kings', coast: 'delta temple', harbor: 'barque harbour', island: 'tomb isle' },
    roster: (m) => [
      ['skelSpear', 'Skeleton Spearman', 'skeleton', { body: 'skeleton', weapon: 'spear', shield: true, bone: 0xe8e0c8, trim: 0xd8b03a, gold: true }, { w: 0.22 }],
      ['skelBow', 'Skeleton Bowman', 'skeletonArcher', { body: 'skeleton', weapon: 'longbow', bone: 0xe8e0c8, gold: true }, { w: 0.18 }],
      ['tombGuard', 'Tomb Guard', 'wight', m.h('pharaoh', 'khopesh', { variant: 'guard', shield: true }), { w: 0.12 }],
      ['chariot', 'Skeleton Chariot', 'lancer', m.b('chariot', { bone: 0xe8e0c8, trim: 0xd8b03a }, { body: 'rider', outfit: 'pharaoh', species: 'mummy', mountType: 'horse', skin: 0x5a4a3a, cloth: 0xe8dcc0, weapon: 'spear', mount: 0xe8e0c8, bones: true }), { k: 1.4, w: 0.08, size: 2 }],
      ['liche', 'Liche Priest', 'necromancer', m.h('pharaoh', 'staff', { variant: 'guard', robe: true }), { w: 0.05 }],
      ['king', 'Tomb King', 'paladin', m.h('pharaoh', 'khopesh', { scale: 1.15 }), { k: 1.4, w: 0.04 }],
      ['scorpion', 'Obsidian Scorpion', 'broodmother', m.b('scorpion', { shell: 0x1a1a22, trim: 0xd8b03a, scale: 2.0 }, { body: 'spider', fur: 0x1a1a22, scale: 2.0 }), { w: 0.07 }],
      ['ushabti', 'Jackal Statue', 'golem', m.g(0xc8b088, 1.6, { gold: true }), { w: 0.07 }],
      ['boneGiant', 'Bone Giant', 'boneColossus', { body: 'skeleton', weapon: 'greataxe', scale: 2.8, bone: 0xe8e0c8, gold: true }, { w: 0.05 }],
      ['sphinx', 'Marble War-Sphinx', 'boneColossus', m.b('sphinx', { stone: 0xe8e0d0, trim: 0xd8b03a, scale: 2.4 }, { body: 'quadruped', fur: 0xe8e0d0, scale: 2.8 }), { k: 1.4, w: 0.04, as: true }],
    ],
    ships: [['barque', 'Solar Barque', 'brigantine', 'solarBarque', { color: 0x8a5a2a, sail: 0xe8dcc0, trim: 0xd8b03a, emblem: 'sun' }], ['royalBarque', 'Royal Barque', 'frigate', 'solarBarque', { color: 0x8a5a2a, sail: 0xd8b03a, trim: 0xd8b03a, emblem: 'sun' }]],
    air: { name: 'Sky Barque', style: 'undead', color: 0x8a5a2a, envelope: 0xd8b03a, pods: 'tombGuard' } },

  { id: 'drowned', name: 'The Drowned Armada', adj: 'Drowned', group: 2, town: 'tribal', look: 'undead', biomes: ['swamp', 'jungle', 'temperate'],
    P: { species: 'ghoul', skin: 0x7a9a8a, cloth: 0x3a4a5a, cloth2: 0xb8b0a0, armor: 0x5a4a3a, trim: 0x5affa0 },
    over: { civic: ['inn', 'inn', 'stall', 'dockhouse', 'shrine', 'graveyard', 'alchemist', 'marketHall'], guns: ['cannon', 'cannon', 'mortar'], shoreGun: 'battery' },
    places: { village: 'wreck shanties', fort: 'lighthouse fort', castle: 'hulk fortress', city: 'shipwreck city', coast: 'smugglers\' cove', harbor: 'pirate haven', island: 'treasure grotto' },
    roster: (m) => [
      ['deckhand', 'Drowned Deckhand', 'militia', m.h('pirate', 'cutlass', { bare: true }), { k: 1.6, w: 0.2 }],
      ['gunnery', 'Zombie Gunner', 'crossbow', m.h('pirate', 'handgun'), { k: 0.9, w: 0.2, speed: 6 }],
      ['depthGuard', 'Depth Guard', 'knight', m.h('pirate', 'halberd', { armor: 0x4a6a5a, cuirass: true, scale: 1.1 }), { w: 0.1 }],
      ['syreen', 'Ghost Siren', 'banshee', { body: 'elemental', glow: 0x5affc8, female: true }, { w: 0.06 }],
      ['bloatCorpse', 'Bloated Corpse', 'bomber', m.h('bloat', 'claws', { species: 'ogre', skin: 0x8aa890, scale: 0.75 }), { k: 3, w: 0.05, style: 'melee', range: 1 }],
      ['crabBeast', 'Bloated Giant Crab', 'broodmother', m.b('crab', { shell: 0x7a4a3a, scale: 2.2, barnacles: true }, { body: 'spider', fur: 0x7a4a3a, scale: 2.0 }), { k: 1.2, w: 0.08 }],
      ['mournghul', 'Sea-Wraith', 'wight', { body: 'humanoid', species: 'ghoul', outfit: 'tatters', skin: 0x9ad8c8, cloth: 0x2a3a3a, weapon: 'claws', scale: 1.2 }, { w: 0.07 }],
      ['captain', 'Vampire Captain', 'paladin', m.h('pirate', 'cutlass', { species: 'human', skin: 0xd8e0d8, cloth: 0x5a1a22 }), { k: 1.3, w: 0.04 }],
      ['wreckColossus', 'Wreck Colossus', 'boneColossus', m.b('wreckColossus', { color: 0x4a3a2a, glow: 0x5affa0, scale: 3.0 }, { body: 'golem', stone: 0x4a3a2a, scale: 2.6 }), { k: 1.3, w: 0.05, style: 'ranged', range: 8, rng: 70, projectile: 'rock' }],
      ['rotLeviathan', 'Rotting Leviathan', 'drake', m.b('crab', { shell: 0x5a6a5a, scale: 3.4, kind: 'leviathan' }, { body: 'dragon', scales: 0x5a6a5a, scale: 1.4 }), { w: 0.03, fly: false, as: true }],
    ],
    ships: [['ghostGalleon', 'Ghost Galleon', 'galleon', 'shroudGalleon', { color: 0x3a3a34, sail: 0x1a1a1a, ghost: true }], ['ghostSloop', 'Ghost Brig', 'brigantine', 'shroudGalleon', { color: 0x3a3a34, sail: 0x1a1a1a, ghost: true, len: 7 }], ['dreadManowar', 'Drowned Flagship', 'manowar', 'shroudGalleon', { color: 0x3a3a34, sail: 0x1a1a1a, ghost: true }]],
    air: { name: 'Phantom Galleon', style: 'undead', color: 0x3a3a34, envelope: 0x2a4a3a, pods: 'depthGuard' } },

  // =========================== Outcasts and Distant Lands ===========================
  { id: 'gorge', name: 'The Gorge-Tribes of the Steppe', adj: 'Gorge-Tribe', group: 3, town: 'wild', look: 'beasts', biomes: ['snow', 'desert', 'temperate'],
    P: { species: 'ogre', skin: 0xc8a888, cloth: 0x5a4030, cloth2: 0x8a2a1a, armor: 0x5a5a5e, trim: 0x8a8070 },
    over: { civic: ['shrine', 'graveyard', 'stall', 'yurt', 'yurt', 'bonePit', 'totem'], homes: 'tent' },
    places: { village: 'yurt camp', fort: 'bone corral', castle: 'tyrant\'s camp', city: 'great feast-camp', coast: 'barge landing', harbor: 'barge moot', island: 'feast rock' },
    roster: (m) => [
      ['scrapling', 'Scrapling', 'goblin', { body: 'humanoid', species: 'goblin', outfit: 'rags', skin: 0x8a9a5a, cloth: 0x5a4030, weapon: 'dagger' }, { w: 0.16 }],
      ['bull', 'Steppe Bull', 'ogre', m.h('gutplate', 'club', { hair: 'topknot', scale: 1.3 }), { w: 0.26 }],
      ['ironGut', 'Iron-Gut', 'ogre', m.h('gutplate', 'greatsword', { hair: 'topknot', scale: 1.4, armor: 0x3a3a3e, cuirass: true }), { k: 1.4, w: 0.12 }],
      ['leadBelcher', 'Cannon-Bearer', 'ogre', m.h('gutplate', 'blunderbuss', { hair: 'topknot', scale: 1.3 }), { w: 0.1, style: 'ranged', range: 6, rng: 60, projectile: 'rock', abilities: [{ type: 'splash', radius: 1, mult: 0.6 }] }],
      ['butcher', 'Butcher-Shaman', 'ogreMage', m.h('gutplate', 'cleaver', { hair: 'topknot', scale: 1.3, cloth: 0x8a2a1a }), { w: 0.05 }],
      ['yeti', 'Mountain Yeti', 'troll', { body: 'humanoid', species: 'troll', outfit: 'none', skin: 0xe8ece8, cloth: 0xe8ece8, weapon: 'claws', scale: 1.5, fur: true }, { w: 0.07 }],
      ['rhinoRider', 'Woolly Rhino Rider', 'minotaur', m.r('gutplate', 'rhino', 'club', 0x6a5040, { scale: 1.3 }), { k: 1.4, w: 0.08, size: 3 }],
      ['frostTusker', 'Frost-Tusker', 'boneColossus', m.q('mammoth', 0xc8d8e0, 2.6, { sabre: true, glow: 0x9ad8ff }), { k: 1.2, w: 0.05 }],
      ['cragHorn', 'Crag-Horn', 'boneColossus', m.q('rhino', 0x7a7a70, 2.8, { stone: true }), { k: 1.3, w: 0.04, as: true }],
    ],
    ships: [['barge', 'Feast Barge', 'galleon', 'oxBarge', { color: 0x5a4030, sail: 0x8a6a4a, oars: true }], ['raftG', 'Plated Raft', 'sloop', 'oxBarge', { color: 0x5a4030, sail: 0x8a6a4a, oars: true }]],
    air: null },

  { id: 'westmark', name: 'The Free Republic of Westmark', adj: 'Westmark', group: 3, town: 'civ', look: 'kingdom', biomes: ['temperate', 'swamp'],
    P: { species: 'human', skin: HUMAN, cloth: 0xd8782a, cloth2: 0x1a2a5a, armor: 0xb0b8c0, trim: 0xd8b03a },
    over: { civic: ['marketHall', 'marketHall', 'stall', 'bank', 'bank', 'inn', 'garden', 'fountain', 'barracks', 'temple', 'dockhouse', 'alchemist', 'palace'] },
    places: { city: 'canal city', harbor: 'guild harbour', coast: 'sea-lock town', castle: 'star citadel', fort: 'sea-lock fort' },
    roster: (m) => [
      ['militiaW', 'Guild Militia', 'militia', m.h('doublet', 'spear', { hat: 'cap' }), { k: 1.3, w: 0.14 }],
      ['pikeW', 'Mercenary Pike', 'pikeman', m.h('doublet', 'pike', { cuirass: true }), { k: 1.1, w: 0.2 }],
      ['shotW', 'Mercenary Shot', 'crossbow', m.h('doublet', 'handgun'), { k: 1.1, w: 0.2 }],
      ['marine', 'Sea-Lock Marine', 'footman', m.h('doublet', 'cutlass', { cuirass: true, hat: 'morion' }), { k: 1.2, w: 0.12 }],
      ['burgher', 'Burgher Cavalry', 'lancer', m.r('doublet', 'horse', 'handgun', 0x2a2a2a, { cuirass: true }), { k: 1.1, w: 0.1 }],
      ['guildMage', 'Guild Hydromancer', 'battlemage', m.h('mage', 'staff', { robe: true, cloth: 0x1a2a5a }), { w: 0.05, projectile: 'ice' }],
      ['surgeon', 'Barber-Surgeon', 'cleric', m.h('doublet', 'staff', { cloth: 0x1a1a1a, hat: 'cap' }), { w: 0.05 }],
      ['menagerieLion', 'Menagerie Lion', 'alphaWolf', m.q('lion', 0xc8963a, 1.3, { collar: 0xd8b03a }), { w: 0.05 }],
      ['seaDrake', 'Captive Sea-Drake', 'wyrmling', m.d(0x2a7a8a, 0.9, { wings: false, collar: 0xd8b03a }), { w: 0.04, fly: false }],
      ['grenadierW', 'Grenadier', 'grenadier', m.h('doublet', 'sling', { cuirass: true }), { w: 0.05 }],
    ],
    ships: [['fluyt', 'Armed Fluyt', 'galleon', 'fluyt', { color: 0x6b4a2e, sail: 0xf0ead8, sail2: 0xd8782a }], ['jacht', 'War Yacht', 'brigantine', 'fluyt', { color: 0x6b4a2e, sail: 0xf0ead8, len: 7 }], ['eastIndiaman', 'Republic Flagship', 'manowar', 'fluyt', { color: 0x5a3a24, sail: 0xf0ead8, sail2: 0xd8782a }]],
    air: { name: 'Merchant Airship', style: 'kingdom', color: 0x6b4a2e, envelope: 0xd8782a, pods: 'marine' } },

  { id: 'principalities', name: 'The Merchant Principalities', adj: 'Principality', group: 3, town: 'civ', look: 'kingdom', biomes: ['temperate', 'desert'],
    P: { species: 'human', skin: OLIVE, cloth: 0xc8322a, cloth2: 0xe8c83a, armor: 0xb08a4a, trim: 0xd8b03a },
    places: { city: 'city-state', castle: 'hill-town', fort: 'condottiere camp', harbor: 'lagoon city', village: 'villa estate' },
    roster: (m) => [
      ['pikeT', 'Condottiere Pike', 'pikeman', m.h('doublet', 'pike', { stripes: true, cuirass: true, hat: 'morion' }), { k: 1.15, w: 0.22 }],
      ['xbowT', 'Pavise Crossbow', 'crossbow', m.h('doublet', 'crossbow', { stripes: true, hat: 'morion', shield: true }), { k: 1.15, w: 0.2 }],
      ['duellist', 'Duellist', 'scout', m.h('doublet', 'rapier', { stripes: true, hat: 'plumed' }), { k: 1.3, w: 0.1 }],
      ['legion', 'Republican Guard', 'knight', m.h('doublet', 'sword', { cuirass: true, shield: true, hat: 'morion', armor: 0xb08a4a }), { w: 0.1 }],
      ['stradiot', 'Light Horse', 'scout', m.r('doublet', 'horse', 'spear', 0x6a4a2a, { stripes: true }), { k: 1.4, w: 0.08 }],
      ['birdman', 'Birdman Glider', 'glider', m.b('aircraft', { kind: 'glider', style: 'kingdom' }), { k: 1.8, w: 0.07 }],
      ['mastiff', 'Armoured War-Mastiff', 'wolf', m.q('hound', 0x6a5040, 1.0, { armor: 0xb0b8c0 }), { k: 1.1, w: 0.08 }],
      ['warWagon', 'Clockwork War-Wagon', 'ram', m.b('warWagon', { color: 0x7a5a36, trim: 0xb08a4a }, { body: 'ram', color: 0x7a5a36 }), { k: 1.3, w: 0.05, style: 'ranged', range: 6, rng: 50, projectile: 'bolt' }],
      ['inventor', 'Inventor', 'engineer', m.h('doublet', 'warhammer', { hat: 'cap' }), { w: 0.04 }],
      ['physician', 'Physician', 'cleric', m.h('doublet', 'staff', { cloth: 0x1a1a1a, hat: 'cap' }), { w: 0.04 }],
    ],
    ships: [['galley', 'War Galley', 'brigantine', 'warGalley', { color: 0x7a3a22, sail: 0xc8322a, sail2: 0xe8c83a, oars: true, emblem: 'lion' }], ['galleass', 'Great Galleass', 'galleon', 'warGalley', { color: 0x7a3a22, sail: 0xc8322a, sail2: 0xe8c83a, oars: true, emblem: 'lion' }]],
    air: { name: 'Aerial Screw-Ship', style: 'kingdom', color: 0x7a5a36, envelope: 0xc8322a, pods: 'legion', hangar: 'birdman' } },

  { id: 'sunkings', name: 'The Kingdoms of the Sun', adj: 'Sun-Kingdom', group: 3, town: 'civ', look: 'kingdom', biomes: ['desert', 'temperate'],
    P: { species: 'human', skin: OLIVE, cloth: 0xa8201a, cloth2: 0xe8c83a, armor: 0xb8c0c8, trim: 0xd8b03a },
    places: { city: 'cathedral city', castle: 'white fortress', fort: 'presidio', harbor: 'treasure port', village: 'mission village' },
    roster: (m) => [
      ['tercioPike', 'Tercio Pikeman', 'pikeman', m.h('doublet', 'pike', { cuirass: true, hat: 'morion' }), { k: 1.2, w: 0.22 }],
      ['arquebus', 'Arquebusier', 'crossbow', m.h('doublet', 'handgun', { hat: 'morion' }), { k: 1.1, w: 0.18 }],
      ['rodelero', 'Sword-and-Buckler Man', 'footman', m.h('doublet', 'rapier', { cuirass: true, shield: true, hat: 'morion' }), { k: 1.25, w: 0.14 }],
      ['conquistador', 'Conquistador', 'lancer', m.r('doublet', 'horse', 'lance', 0x8a8a8a, { cuirass: true, hat: 'morion' }), { k: 1.3, w: 0.12 }],
      ['inquisitor', 'Inquisitor', 'warPriest', m.h('gothicHabit', 'warhammer', { cloth: 0x1a1a1a }), { w: 0.05 }],
      ['zealotS', 'Penitent', 'hobgoblin', m.h('flagellant', 'club', { species: 'human' }), { k: 0.8, w: 0.07 }],
      ['hound', 'War-Hound', 'wolf', m.q('hound', 0x4a3a2a, 0.95), { w: 0.08 }],
      ['stallion', 'Royal Lancer', 'lancer', m.r('knight', 'horse', 'lance', 0xe8e4dc, { barding: true }), { k: 1.6, w: 0.06 }],
      ['arenaBull', 'Armoured Arena Bull', 'minotaur', m.q('bull', 0x1a1a1a, 1.5, { armor: 0xb8c0c8 }), { k: 0.8, w: 0.05 }],
      ['diestro', 'Sword Master', 'knight', m.h('doublet', 'rapier', { hat: 'plumed', cloth: 0x1a1a1a }), { k: 1.2, w: 0.05, speed: 3 }],
    ],
    ships: [['treasure', 'Treasure Galleon', 'galleon', 'treasureGalleon', { color: 0x5a3a24, sail: 0xf0ead8, sail2: 0xa8201a, emblem: 'cross' }], ['armada', 'Armada Flagship', 'manowar', 'treasureGalleon', { color: 0x5a3a24, sail: 0xf0ead8, sail2: 0xa8201a, emblem: 'cross' }], ['caravel', 'Caravel', 'brigantine', 'treasureGalleon', { color: 0x6b4a2e, sail: 0xf0ead8, emblem: 'cross', len: 7 }]],
    air: { name: 'Sun Galleon', style: 'kingdom', color: 0x5a3a24, envelope: 0xa8201a, pods: 'rodelero' } },

  { id: 'caliphate', name: 'The Caliphates of the Great Desert', adj: 'Caliphate', group: 3, town: 'civ', look: 'kingdom', biomes: ['desert', 'desert'],
    P: { species: 'human', skin: TAN, cloth: 0xe8e0d0, cloth2: 0x2aa8a8, armor: 0xd8b03a, trim: 0xd8b03a },
    over: { trees: [] },
    places: { city: 'city of minarets', castle: 'desert citadel', fort: 'caravan fort', village: 'oasis village', harbor: 'dhow harbour' },
    roster: (m) => [
      ['spearA', 'Caliphate Spearman', 'pikeman', m.h('silkRobe', 'spear', { shield: true }), { w: 0.2 }],
      ['archerA', 'Desert Archer', 'longbow', m.h('silkRobe', 'longbow', { cloth: 0x2aa8a8 }), { w: 0.16 }],
      ['guardA', 'Palace Guard', 'knight', m.h('silkRobe', 'scimitar', { mail: true, shield: true }), { w: 0.12 }],
      ['mamluk', 'Mamluk Lancer', 'lancer', m.r('silkRobe', 'horse', 'lance', 0x8a6a4a, { mail: true, barding: true }), { k: 1.3, w: 0.14 }],
      ['raiderA', 'Desert Raider', 'scout', m.r('silkRobe', 'horse', 'scimitar', 0xc8a070), { k: 1.3, w: 0.08 }],
      ['dervish', 'Whirling Blade', 'scout', m.h('silkRobe', 'scimitar', { cloth: 0xa82a2a }), { k: 1.4, w: 0.06 }],
      ['vizier', 'Vizier', 'battlemage', m.h('silkRobe', 'staff', { robe: true, cloth: 0x4a2a7a }), { w: 0.05 }],
      ['carpet', 'Carpet Rider', 'gyrocopter', m.b('carpet', { color: 0xa82a2a, trim: 0xd8b03a, rider: m.h('silkRobe', 'longbow') }, { body: 'aircraft', kind: 'glider', style: 'kingdom' }), { w: 0.06, projectile: 'arrow' }],
      ['djinn', 'Bound Djinn', 'fireElemental', m.b('djinn', { skin: 0x3a8ac8, glow: 0x9ad8ff, scale: 1.8 }, { body: 'elemental', glow: 0x5ab8ff }), { k: 2.2, w: 0.05, size: 2, projectile: 'holy' }],
      ['elephantA', 'War Elephant', 'boneColossus', m.q('elephant', 0x7a7068, 2.6, { howdah: true, trim: 0xd8b03a }), { w: 0.05, style: 'melee' }],
    ],
    ships: [['dhow', 'War Dhow', 'sloop', 'dhow', { color: 0x7a5a36, sail: 0xe8e0d0, sail2: 0x2aa8a8 }], ['xebec', 'Royal Xebec', 'frigate', 'dhow', { color: 0x6b4a2e, sail: 0xe8e0d0, sail2: 0xa82a2a }]],
    air: { name: 'Flying Palace', style: 'kingdom', color: 0x7a5a36, envelope: 0x2aa8a8, pods: 'guardA', hangar: 'carpet' } },

  { id: 'shogunate', name: 'The Shogunate of the Rising Sun', adj: 'Shogunate', group: 3, town: 'civ', look: 'kingdom', biomes: ['temperate', 'snow'],
    P: { species: 'human', skin: 0xe0b890, cloth: 0xa81a1a, cloth2: 0xe8e0d0, armor: 0x2a2a30, trim: 0xd8b03a },
    over: { guns: ['ballista', 'cannon'] },
    places: { castle: 'tiered castle', city: 'castle town', fort: 'hill fort', village: 'rice village', harbor: 'pirate lords\' harbour' },
    roster: (m) => [
      ['ashigaru', 'Ashigaru Spearman', 'militia', m.h('lamellar', 'spear', { variant: 'ashigaru' }), { k: 1.6, w: 0.22 }],
      ['ashigaruBow', 'Ashigaru Bowman', 'longbow', m.h('lamellar', 'longbow', { variant: 'ashigaru' }), { w: 0.14 }],
      ['teppo', 'Matchlock Ashigaru', 'crossbow', m.h('lamellar', 'handgun', { variant: 'ashigaru' }), { w: 0.1 }],
      ['samurai', 'Samurai', 'knight', m.h('lamellar', 'katana', { variant: 'samurai' }), { k: 1.1, w: 0.14 }],
      ['naginata', 'Warrior Monk', 'halberdier', m.h('gothicHabit', 'naginata', { cloth: 0xe8e0d0 }), { k: 1.1, w: 0.08 }],
      ['mounted', 'Mounted Samurai', 'lancer', m.r('lamellar', 'horse', 'longbow', 0x3a2a20, { variant: 'samurai' }), { k: 1.3, w: 0.1 }],
      ['shinobi', 'Shinobi', 'scout', m.h('shinobi', 'dagger'), { k: 1.5, w: 0.06 }],
      ['tengu', 'Tengu', 'harpy', { body: 'humanoid', species: 'harpy', outfit: 'feathers', skin: 0xc84a3a, cloth: 0x1a1a22, weapon: 'katana', beak: true }, { k: 1.5, w: 0.05 }],
      ['kitsune', 'Great Fox Spirit', 'alphaWolf', m.q('fox', 0xe8823a, 1.5, { tails: 9, glow: 0x9ad8ff }), { k: 1.2, w: 0.04, style: 'magic', range: 6, mag: 60, projectile: 'fire' }],
      ['oni', 'Oni', 'cyclops', { body: 'humanoid', species: 'ogre', outfit: 'loincloth', skin: 0xb83a2a, cloth: 0xd8a03a, weapon: 'club', horns: 'long', scale: 1.5 }, { w: 0.05 }],
      ['waterDragon', 'Water Dragon', 'drake', m.d(0x2a6a9a, 1.3, { eastern: true, wings: false }), { w: 0.02, as: true }],
    ],
    ships: [['atakebune', 'Atakebune', 'galleon', 'atakebune', { color: 0x2a2a30, sail: 0xe8e0d0, sail2: 0xa81a1a, oars: true, sails: 1 }], ['sekibune', 'Sekibune', 'sloop', 'atakebune', { color: 0x3a3028, sail: 0xe8e0d0, oars: true, sails: 1 }]],
    air: { name: 'Kite Fortress', style: 'kingdom', color: 0x3a3028, envelope: 0xa81a1a, pods: 'samurai', hangar: 'tengu' } },

  { id: 'mistisles', name: 'The Mist-Cloaked Isles', adj: 'Isles', group: 3, town: 'wild', look: 'elemental', biomes: ['swamp', 'temperate'],
    P: { species: 'human', skin: 0xe0c0a0, cloth: 0x3a6a4a, cloth2: 0x2a3a6a, armor: 0xb08a4a, trim: 0xb08a4a },
    over: { civic: ['shrine', 'shrine', 'graveyard', 'stoneRing', 'monolith', 'stall'], homes: 'hut', wall: 'ring', strongWall: 'ring' },
    places: { village: 'round-hut village', fort: 'hill fort', castle: 'great stone ring', city: 'ring of rings', coast: 'bog shrine', harbor: 'curragh strand', island: 'druid isle' },
    roster: (m) => [
      ['woadWarrior', 'Woad Warrior', 'hobgoblin', m.h('woad', 'greatsword', { paint: 0x2a5ab8, hair: 'spiked' }), { w: 0.26 }],
      ['slinger', 'Slinger', 'goblinArcher', m.h('woad', 'sling', { paint: 0x2a5ab8, species: 'human' }), { k: 2.0, w: 0.14 }],
      ['hearth', 'Hearth Guard', 'footman', m.h('woad', 'spear', { shield: true, cloak: true, paint: 0x2a5ab8 }), { k: 1.2, w: 0.16 }],
      ['chariotM', 'Chieftain', 'knight', m.h('woad', 'greatsword', { cloak: true, hair: 'spiked', paint: 0x2a5ab8, scale: 1.1 }), { w: 0.08 }],
      ['druid', 'Druid', 'cleric', m.h('mage', 'staff', { robe: true, hood: true, cloth: 0xe8e0d0 }), { k: 1.2, w: 0.06 }],
      ['raven', 'Giant Raven', 'harpy', m.b('bird', { kind: 'raven', color: 0x14141a, scale: 1.3 }, { body: 'bat', fur: 0x14141a, scale: 1.4 }), { k: 1.2, w: 0.08 }],
      ['fenBeast', 'Fen-Beast', 'troll', m.b('treeman', { kind: 'bog', bark: 0x3a3a22, leaf: 0x4a5a2a, scale: 1.5 }, { body: 'golem', stone: 0x3a3a22, scale: 1.4 }), { w: 0.1 }],
      ['hound2', 'Wolfhound', 'wolf', m.q('hound', 0x8a8a80, 1.0), { w: 0.06 }],
      ['giantM', 'Primeval Giant', 'boneColossus', { body: 'humanoid', species: 'cyclops', eyes: 2, outfit: 'hides', skin: 0xc8a888, cloth: 0x4a3a2a, weapon: 'club', scale: 3.0 }, { k: 1.2, w: 0.06 }],
    ],
    ships: [['curragh', 'Hide Curragh', 'skiff', 'curragh', { color: 0x6a5a40, sail: 0x8a9a8a, oars: true }], ['oakboat', 'Rune Longboat', 'sloop', 'curragh', { color: 0x4a3a26, sail: 0x8a9a8a, oars: true }]],
    air: null },

  { id: 'thousandgods', name: 'The Kingdoms of the Thousand Gods', adj: 'Thousand-Gods', group: 3, town: 'civ', look: 'kingdom', biomes: ['jungle', 'desert', 'temperate'],
    P: { species: 'human', skin: DARK, cloth: 0xe87a1a, cloth2: 0xc81a5a, armor: 0xd8b03a, trim: 0xd8b03a },
    places: { city: 'city of temples', castle: 'marble fort', fort: 'elephant gate', village: 'tank village', harbor: 'garland harbour' },
    roster: (m) => [
      ['sepoy', 'Temple Spearman', 'pikeman', m.h('silkRobe', 'spear', { shield: true }), { w: 0.2 }],
      ['chakram', 'Chakram Thrower', 'longbow', m.h('silkRobe', 'chakram', { cloth: 0xc81a5a }), { k: 1.1, w: 0.14, range: 6, speed: 4, projectile: 'bolt' }],
      ['rajput', 'Gilded Warrior', 'knight', m.h('tigerPelt', 'scimitar', { shield: true }), { w: 0.14 }],
      ['tigerman', 'Tiger Warrior', 'hobgoblin', m.h('silkRobe', 'scimitar', { species: 'tiger', skin: 0xd8822a, mail: true }), { k: 1.6, w: 0.12 }],
      ['tigerLord', 'Tiger Caste Champion', 'paladin', m.h('tigerPelt', 'greatsword', { species: 'tiger', skin: 0xe8e4dc, scale: 1.15 }), { w: 0.05 }],
      ['brahmin', 'Temple Sage', 'cleric', m.h('silkRobe', 'staff', { robe: true, cloth: 0xe8e0d0 }), { w: 0.06 }],
      ['cobra', 'Giant Cobra', 'broodmother', m.b('serpent', { scales: 0x6a5a2a, hood: true, scale: 2.0 }, { body: 'dragon', scales: 0x6a5a2a, scale: 0.8, wings: false }), { w: 0.06 }],
      ['elephantI', 'Armoured War Elephant', 'boneColossus', m.q('elephant', 0x6a6460, 2.8, { howdah: true, armor: 0xd8b03a }), { k: 1.2, w: 0.07 }],
      ['avatar', 'Many-Armed Avatar', 'infernalLord', m.h('tigerPelt', 'scimitar', { arms: 6, skin: 0x3a6ac8, scale: 2.2, bare: true }), { k: 0.7, w: 0.03, as: true }],
      ['mahout', 'Elephant-Master', 'engineer', m.h('silkRobe', 'warhammer'), { w: 0.03 }],
    ],
    ships: [['swanBarge', 'Royal Swan-Barge', 'brigantine', 'swanBarge', { color: 0x6a4a2a, sail: 0xe87a1a, sail2: 0xc81a5a, oars: true }], ['teakDhow', 'Teak Dhow', 'sloop', 'dhow', { color: 0x6a4a2a, sail: 0xe87a1a, sail2: 0xe8e0d0 }]],
    air: { name: 'Sky Chariot', style: 'kingdom', color: 0x6a4a2a, envelope: 0xe87a1a, pods: 'rajput' } },
  // =========================== The Realms of Chaos ===========================
  { id: 'kharnak', name: 'The Crimson Brass-Hordes of Kharnak', adj: 'Kharnak', group: 4, town: 'dark', look: 'ironbound', biomes: ['volcanic', 'desert'],
    P: { species: 'demon', skin: 0xa8281e, cloth: 0x2a0e0a, cloth2: 0x5a1010, armor: 0xb07a2a, trim: 0x1e1c1c },
    over: { civic: ['temple', 'barracks', 'forge', 'obelisk', 'graveyard', 'pitGate'] },
    places: { village: 'skull-camp', fort: 'iron blood-keep', castle: 'brutalist citadel', city: 'city of the great arena', coast: 'slaughter-beach', harbor: 'bronze-ram docks', island: 'altar isle' },
    sea: 'brassLeviathan',
    roster: (m) => [
      ['reaver', 'Bloodsworn Reaver', 'hobgoblin', m.h('dreadPlate', 'greataxe', { build: 'heavy', horns: 'great', helm: true }), { k: 1.4, w: 0.22 }],
      ['champion', 'Brass Champion', 'knight', m.h('infernalPlate', 'greatsword', { build: 'heavy', horns: 'great' }), { k: 1.3, w: 0.14 }],
      ['skullTaker', 'Skull-Taker', 'footman', m.h('loincloth', 'cleaver', { build: 'heavy', skin: 0xb83020 }), { k: 1.5, w: 0.16, abilities: [{ type: 'enrage', threshold: 0.5, mult: 1.4 }] }],
      ['gorer', 'Gorer Knight', 'lancer', m.b('brassRhino', { rider: m.h('dreadPlate', 'greataxe', { armor: 0xb07a2a, horns: 'great' }), hide: 0x5a3a32, armor: 0xb07a2a, scale: 1.4 }, { body: 'rider', species: 'demon', skin: 0xa8281e, outfit: 'infernalPlate', mountType: 'rhino', weapon: 'greataxe', mount: 0x5a3a32, armor: 0xb07a2a }), { k: 1.8, w: 0.08, size: 2 }],
      ['warhound', 'Brass Warhound', 'hellhound', m.q('hound', 0x7a1a14, 1.3, { armor: 0xb07a2a }), { w: 0.1 }],
      ['reaper', 'Blood-Reaper', 'gargoyle', m.b('bloodReaper', { skin: 0xa8281e, armor: 0xb07a2a, scale: 2.0 }, { body: 'humanoid', species: 'demon', outfit: 'infernalPlate', weapon: 'greataxe', skin: 0xa8281e, armor: 0xb07a2a, scale: 1.8, wings: true }), { k: 1.3, w: 0.05, size: 2 }],
      ['brute', 'Slaughter-Brute', 'pitFiend', m.b('slaughterBrute', { skin: 0x8a1a14, armor: 0x1e1c1c, glow: 0xff5a14, scale: 2.2 }, { body: 'humanoid', species: 'ogre', outfit: 'dreadPlate', weapon: 'claws', skin: 0x8a1a14, scale: 2.0 }), { k: 1.1, w: 0.05, abilities: [{ type: 'breath', every: 4, radius: 2, maxHit: 30 }] }],
      ['juggernaut', 'Brass Gorer', 'boneColossus', m.b('brassRhino', { hide: 0x5a3a32, armor: 0xb07a2a, scale: 2.6 }, { body: 'quadruped', kind: 'rhino', fur: 0x5a3a32, scale: 2.6, armor: 0xb07a2a }), { k: 1.4, w: 0.04, as: true }],
      ['priest', 'Skull-Altar Priest', 'warPriest', m.h('ziggurat', 'warhammer', { cloth: 0x5a1010 }), { w: 0.05 }],
    ],
    ships: [['dreadGalley', 'Ironclad Dread-Galley', 'galleon', 'dreadGalley', { color: 0x2a1e1a, sail: 0xb89a7a, trim: 0xb07a2a, oars: true }], ['ramMonitor', 'Brass Ram-Monitor', 'frigate', 'paddleGalleon', { color: 0x8a5a2a, sail: 0x5a1010, trim: 0xb07a2a }]],
    air: { name: 'Brass Blood-Barge', style: 'infernal', color: 0x3a1a14, envelope: 0x8a1a14, pods: 'reaver', hangar: '!imp' } },

  { id: 'morbus', name: 'The Festering Gardens of Morbus', adj: 'Morbid', group: 4, town: 'necro', look: 'drowned', biomes: ['swamp', 'swamp', 'temperate'],
    P: { species: 'human', skin: 0x8a9a5a, cloth: 0x4a4a2a, cloth2: 0x6a5a2a, armor: 0x6a5a3a, trim: 0xa08a3a },
    over: { civic: ['temple', 'shrine', 'graveyard', 'alchemist', 'garden', 'garden', 'crypt', 'charnel'] },
    places: { village: 'mire-hamlet', fort: 'sunken manor', castle: 'bell-tower keep', city: 'garden of rot', coast: 'fly-blown shore', harbor: 'moss harbour', island: 'blight isle' },
    sea: 'sumpKraken',
    roster: (m) => [
      ['warden', 'Rot-Warden', 'plagueBearer', m.h('bloat', 'club', { build: 'heavy', helm: true }), { k: 1.2, w: 0.22 }],
      ['bileKnight', 'Bile-Knight', 'knight', m.h('bloat', 'greatsword', { build: 'heavy', cuirass: true, armor: 0x6a5a3a, horns: 'swept' }), { k: 1.3, w: 0.12 }],
      ['hiveBearer', 'Swarm-Hive Bearer', 'ghoul', m.h('bloat', 'claws', { skin: 0x9aa86a }), { k: 1.1, w: 0.12, abilities: [{ type: 'poison', damage: 4, chance: 0.5 }] }],
      ['bowman', 'Mildew Bowman', 'longbow', m.h('rags', 'longbow'), { w: 0.12 }],
      ['toad', 'Plague-Toad', 'ogre', m.b('plagueToad', { skin: 0x6a8a3a, belly: 0xc8c070, scale: 1.8 }, { body: 'quadruped', kind: 'boar', fur: 0x6a8a3a, scale: 1.8 }), { k: 1.2, w: 0.08, size: 2 }],
      ['flyRider', 'Carrion-Fly Rider', 'harpy', m.b('carrionFly', { body2: 0x3a4a2a, wing: 0xb8c0a0, rider: m.h('bloat', 'spear'), scale: 1.7 }, { body: 'bat', fur: 0x3a4a2a, scale: 1.7 }), { k: 1.4, w: 0.08, size: 2 }],
      ['bogBeast', 'Beast of the Bog', 'troll', m.b('bogSlug', { skin: 0xa8b86a, spots: 0x6a3a5a, scale: 1.8 }, { body: 'serpent', scales: 0xa8b86a, scale: 1.4 }), { k: 1.1, w: 0.07, abilities: [{ type: 'poison', damage: 5, chance: 0.5 }] }],
      ['bellRinger', 'Plague Bell-Ringer', 'cleric', m.h('gothicHabit', 'staff', { cloth: 0x4a4a2a }), { w: 0.05 }],
      ['patriarch', 'Rot-Patriarch', 'infernalLord', m.h('bloat', 'club', { species: 'ogre', build: 'heavy', skin: 0x7a8a4a, scale: 2.2, horns: 'great' }), { k: 1, w: 0.03, as: true, abilities: [{ type: 'poison', damage: 6, chance: 0.6 }, { type: 'regen', amount: 6, every: 5 }] }],
    ],
    ships: [['ghostGalleon', 'Moss-Hulled Galleon', 'galleon', 'shroudGalleon', { color: 0x3a4a2a, sail: 0x8a8a5a, trim: 0x6a5a3a }], ['bargeM', 'Worm-Eaten Barge', 'brigantine', 'shroudGalleon', { color: 0x4a4a32, sail: 0x9a9a6a, trim: 0x5a5a3a }]],
    air: { name: 'Bloated Gas-Bladder', style: 'undead', color: 0x3a3a22, envelope: 0x7a8a4a, pods: 'warden' } },

  { id: 'labyrinth', name: 'The Iridescent Labyrinth of Ysh-Keth', adj: 'Labyrinthine', group: 4, town: 'dark', look: 'aethel', biomes: ['desert', 'snow', 'temperate'],
    P: { species: 'harpy', skin: 0x3a6ad8, cloth: 0x2a4ac8, cloth2: 0xd8b03a, armor: 0x8ad8f0, trim: 0xd8b03a },
    over: { civic: ['temple', 'shrine', 'alchemist', 'alchemist', 'crystalSpire', 'monolith', 'palace'] },
    places: { village: 'scriptorium hamlet', fort: 'maze-fort', castle: 'shifting fortress', city: 'city of inverted spires', coast: 'glass shore', harbor: 'starlight quay', island: 'mirror isle' },
    sea: 'astralNautilus',
    roster: (m) => [
      ['crystalGuard', 'Crystal-Mail Warrior', 'footman', m.h('starIron', 'halberd', { species: 'human', skin: 0xc8b8a8, armor: 0x8ad8f0, helm: true }), { k: 1.2, w: 0.2 }],
      ['sorcerer', 'Staff-Flame Sorcerer', 'battlemage', m.h('feathers', 'staff', { eyes: 3 }), { k: 1.1, w: 0.14 }],
      ['warpBow', 'Warp-Bow Archer', 'longbow', m.h('silkRobe', 'longbow', { cloth: 0x9a5ac8 }), { k: 1.1, w: 0.14 }],
      ['horror', 'Shard-Horror', 'imp', m.b('shardHorror', { color: 0xe85ac8, glow: 0x6ad8ff, scale: 1 }, { body: 'elemental', glow: 0xe85ac8 }), { k: 1.6, w: 0.14, fly: false, abilities: [{ type: 'split', into: 'labyrinth_shardling', count: 2 }] }],
      ['shardling', 'Shardling', 'imp', m.b('shardHorror', { color: 0x6ad8ff, glow: 0xe85ac8, scale: 0.6 }, { body: 'elemental', glow: 0x6ad8ff, scale: 0.6 }), { k: 0.7, fly: false }],
      ['manta', 'Sky-Manta', 'harpy', m.b('skyManta', { color: 0x2a4ac8, belly: 0xd8b03a, glow: 0xe85ac8, scale: 1.6 }, { body: 'bat', fur: 0x2a4ac8, scale: 1.6 }), { k: 1.2, w: 0.08 }],
      ['augur', 'Many-Headed Augur', 'infernalLord', m.b('fateLord', { feathers: 0x3a6ad8, glow: 0xe85ac8, heads: 3, scale: 2.6 }, { body: 'bird', kind: 'vultureLord', color: 0x3a6ad8, glow: 0xe85ac8, scale: 2.6 }), { k: 1, w: 0.03, as: true, fly: true }],
      ['wyrm', 'Flame-Wyrm', 'drake', m.d(0x3a6ad8, 2.2, { glow: 0xe85ac8 }), { w: 0.04 }],
    ],
    ships: [['barque', 'Solar Barque', 'frigate', 'solarBarque', { color: 0xd8d0c0, sail: 0x9ad8ff, trim: 0xd8b03a }], ['crescent', 'Crescent Skimmer', 'cutter', 'solarBarque', { color: 0xc0c8d8, sail: 0xe85ac8, trim: 0xd8b03a }]],
    air: { name: 'Floating Prism', style: 'elemental', color: 0x2a4ac8, envelope: 0x9ad8ff, pods: 'crystalGuard', hangar: 'manta' } },

  { id: 'velvet', name: 'The Velvet Courts of Vel-Ishara', adj: 'Velvet', group: 4, town: 'civ', look: 'principalities', biomes: ['temperate', 'desert'],
    P: { species: 'elf', skin: 0xf2e6ea, cloth: 0x6a2a9a, cloth2: 0xd8b03a, armor: 0xe8e4f0, trim: 0xd8b03a },
    over: { civic: ['palace', 'garden', 'garden', 'fountain', 'fountain', 'inn', 'temple', 'marketHall', 'stall', 'bank'] },
    places: { village: 'masquerade villa', fort: 'mirror-maze fort', castle: 'pleasure palace', city: 'city of amphitheatres', coast: 'perfumed strand', harbor: 'yacht harbour', island: 'isle of song' },
    sea: 'sirenScolopendra',
    roster: (m) => [
      ['duelist', 'Mirror Duelist', 'footman', m.h('brocade', 'rapier', { female: true, armor: 0xe8e4f0, claw: 'crab' }), { k: 1.2, w: 0.22 }],
      ['whip', 'Razor-Whip Dancer', 'ghoul', m.h('silkRobe', 'flail', { female: true }), { k: 1.2, w: 0.14 }],
      ['sonicLancer', 'Sonic Lancer', 'crossbow', m.h('elfScale', 'lance', { cloth: 0x6a2a9a }), { w: 0.12 }],
      ['racer', 'Long-Snout Racer', 'lancer', m.r('silkRobe', 'raptor', 'rapier', 0xd8b8e0, { female: true }), { k: 1.2, w: 0.12, move: 2 }],
      ['fiend', 'Whip-Tailed Fiend', 'minotaur', m.b('whipFiend', { skin: 0xd8b8e0, armor: 0x6a2a9a, scale: 1.5 }, { body: 'scorpion', shell: 0xd8b8e0, trim: 0xd8b03a, scale: 1.5 }), { k: 1.0, w: 0.07, abilities: [{ type: 'poison', damage: 5, chance: 0.5 }] }],
      ['golem', 'Mirror-Golem', 'golem', m.g(0xe8e4f0, 2.2, { crystal: true, glow: 0xd8b0ff }), { k: 1.1, w: 0.05 }],
      ['siren', 'Organ-Siren', 'battlemage', m.h('brocade', 'staff', { female: true, cloth: 0xd8b03a }), { w: 0.06 }],
      ['keeper', 'Keeper of Longing', 'infernalLord', m.h('silkRobe', 'claws', { species: 'demon', build: 'tall', skin: 0xf2e6ea, cloth: 0x6a2a9a, scale: 2.0, arms: 4, claw: 'crab' }), { k: 0.95, w: 0.03, as: true, speed: 3, move: 2 }],
    ],
    ships: [['yacht', 'Swan-Necked Yacht', 'frigate', 'swanGalley', { color: 0xe8e0d0, sail: 0xc8a0e8, trim: 0xd8b03a }], ['catamaran', 'Pearl Catamaran', 'cutter', 'swanGalley', { color: 0xf0e8f0, sail: 0x6a2a9a, trim: 0xd8b03a }]],
    air: { name: 'Perfumed Pavilion', style: 'kingdom', color: 0xe8e0d0, envelope: 0x6a2a9a, pods: 'duelist' } },

  { id: 'malvash', name: 'The Forges of Mal-Vash', adj: 'Mal-Vashi', group: 4, town: 'dark', look: 'ashur', biomes: ['volcanic', 'desert', 'snow'],
    P: { species: 'human', skin: 0xb0806a, cloth: 0x2a2420, cloth2: 0x4a3a2a, armor: 0x3a3a40, trim: 0xb08a3a },
    over: { civic: ['forge', 'forge', 'workshop', 'barracks', 'alchemist', 'obelisk', 'pitGate'] },
    places: { village: 'slag-works', fort: 'piston keep', castle: 'clockwork citadel', city: 'city of smokestacks', coast: 'coaling shore', harbor: 'dreadnought yards', island: 'foundry isle' },
    sea: 'ironcladLeviathan',
    roster: (m) => [
      ['warSmith', 'Iron-Masked War-Smith', 'footman', m.h('scrapPlate', 'warhammer', { helm: true }), { k: 1.2, w: 0.2 }],
      ['construct', 'Stitched Construct', 'hobgoblin', m.h('none', 'claws', { species: 'ghoul', build: 'heavy', skin: 0x9a5a4a, glow: 0xff8a3a, scale: 1.3 }), { k: 1.4, w: 0.16 }],
      ['boilerGunner', 'Boiler-Gunner', 'grenadier', m.h('scrapPlate', 'handgun'), { w: 0.14 }],
      ['automaton', 'Spider-Legged Automaton', 'spider', m.b('daemonEngine', { color: 0x3a3a40, glow: 0xff8a3a, legs: 8, scale: 1.4 }, { body: 'spider', fur: 0x3a3a40, scale: 1.4 }), { k: 1.2, w: 0.1 }],
      ['clockHound', 'Clockwork Hound', 'hellhound', m.q('hound', 0x3a3a40, 1.1, { armor: 0xb08a3a, glow: 0xff8a3a }), { w: 0.1 }],
      ['soulMill', 'Soul-Mill Engine', 'boneColossus', m.b('daemonEngine', { color: 0x2a2a30, glow: 0x6aff9a, legs: 6, scale: 2.6 }, { body: 'spider', fur: 0x2a2a30, scale: 2.4 }), { k: 1.3, w: 0.04, as: true }],
      ['wyvern', 'Brass Wyvern', 'drake', m.d(0xb08a3a, 2.0, { glow: 0xff5a14 }), { w: 0.04 }],
      ['colossus', 'Piston Colossus', 'golem', m.g(0x3a3a40, 2.6, { glow: 0xff8a3a }), { k: 1.3, w: 0.04 }],
      ['tender', 'Soul-Furnace Tender', 'engineer', m.h('scrapPlate', 'warhammer'), { w: 0.04 }],
    ],
    ships: [['dreadnought', 'Soul-Fired Dreadnought', 'manowar', 'dreadnought', { color: 0x2a2a30, sail: 0x4a4a4a, trim: 0xb08a3a }], ['clawRam', 'Boarding-Claw Ironclad', 'frigate', 'dreadnought', { color: 0x3a3a40, sail: 0x5a4a3a, trim: 0xb08a3a }]],
    air: { name: 'Smog-Belching Sky-Foundry', style: 'infernal', color: 0x2a2a30, envelope: 0x4a3a2a, pods: 'warSmith', hangar: '!gyrocopter' } },

  { id: 'ashhorde', name: 'The Ash-Hordes of the Riven Abyss', adj: 'Ash-Horde', group: 4, town: 'dark', look: 'ironbound', biomes: ['snow', 'volcanic', 'temperate'],
    P: { species: 'human', skin: 0xc8a888, cloth: 0x1a1a1e, cloth2: 0x6a1a14, armor: 0x1e1e22, trim: 0xb08a3a },
    over: { civic: ['temple', 'barracks', 'obelisk', 'obelisk', 'graveyard', 'forge'] },
    places: { village: 'raider camp', fort: 'chained iron fort', castle: 'black citadel', city: 'city of black cathedrals', coast: 'reaving beach', harbor: 'galley fjord', island: 'brazier peak' },
    sea: 'abyssalOuroboros',
    roster: (m) => [
      ['marauder', 'Ash Marauder', 'footman', m.h('pelts', 'axe', { hair: 'long' }), { k: 1.1, w: 0.22 }],
      ['berserker', 'Mutated Berserker', 'hobgoblin', m.h('loincloth', 'greataxe', { build: 'heavy', horns: 'swept' }), { k: 1.4, w: 0.14 }],
      ['chosen', 'Abyss-Chosen', 'knight', m.h('dreadPlate', 'greatsword', { build: 'heavy', horns: 'great' }), { k: 1.5, w: 0.12 }],
      ['knight', 'Riven Knight', 'lancer', m.r('dreadPlate', 'horse', 'lance', 0x1a1a1e, { barding: true }), { k: 1.4, w: 0.1 }],
      ['horsemen', 'Horse Marauder', 'wolfRider', m.r('pelts', 'horse', 'javelin', 0x5a4030), { k: 1.4, w: 0.08 }],
      ['gorebeast', 'Armoured Gore-Beast', 'minotaur', m.q('rhino', 0x5a4a42, 1.8, { armor: 0x1e1e22 }), { k: 1.2, w: 0.06, size: 2 }],
      ['manticore', 'Manticore', 'griffon', m.b('manticore', { fur: 0x6a2a1a, scale: 1.6 }), { w: 0.05 }],
      ['drakeCentaur', 'Drake-Centaur', 'minotaur', m.b('centaur', { kind: 'drake', skin: 0x3a3a4a, scale: 1.8, weapon: 'greataxe' }), { k: 1.3, w: 0.06 }],
      ['spawn', 'Abyss-Spawn', 'troll', m.h('none', 'claws', { species: 'troll', skin: 0x8a6a7a, scale: 1.5 }), { w: 0.05 }],
      ['dragon', 'Three-Headed Abyss Dragon', 'drake', m.b('hydra', { scales: 0x1e1e2a, heads: 3, wings: true, scale: 1.7 }), { w: 0.03, as: true }],
    ],
    ships: [['blackGalley', 'Black-Iron Dread-Galley', 'galleon', 'dreadGalley', { color: 0x1a1a1e, sail: 0x6a1a14, trim: 0xb08a3a, oars: true }], ['dragonRam', 'Dragon-Jaw Rammer', 'frigate', 'razorGalley', { color: 0x1e1e22, sail: 0x3a3a3a, trim: 0x6a1a14 }]],
    air: { name: 'Black Cathedral Sky-Barge', style: 'infernal', color: 0x1a1a1e, envelope: 0x3a1a14, pods: 'chosen' } },

  // =========================== The Hidden and Fringe Races ===========================
  { id: 'balor', name: 'The Bog-Lords of Balor', adj: 'Balorian', group: 5, town: 'tribal', look: 'mistisles', biomes: ['swamp', 'swamp', 'temperate'],
    P: { species: 'cyclops', skin: 0x6a7a5a, cloth: 0x3a4a2a, cloth2: 0x5a4a2a, armor: 0x8a6a3a, trim: 0xd8c8a0 },
    over: { wall: 'ruin', strongWall: 'rampart', civic: ['shrine', 'graveyard', 'stoneRing', 'monolith', 'barracks'] },
    places: { village: 'fog-steading', fort: 'basalt crag', castle: 'crag fortress', city: 'drowned crag-city', coast: 'fogbound strand', harbor: 'peat-barge landing', island: 'mist isle' },
    sea: 'balorMaw',
    roster: (m) => [
      ['fenWarrior', 'Fen-Warrior', 'hobgoblin', m.h('lamellar', 'cleaver', { tail: 'club', armor: 0x8a6a3a }), { k: 1.4, w: 0.24 }],
      ['brute', 'Bronze-Cleaver Brute', 'ogre', m.h('lamellar', 'greataxe', { build: 'heavy', tail: 'club', scale: 1.3 }), { k: 1.1, w: 0.14 }],
      ['mistWeaver', 'Mist-Weaver', 'shaman', m.h('rags', 'staff', { build: 'tall', arms: 4 }), { k: 1.4, w: 0.08 }],
      ['thrall', 'Fog-Thrall', 'militia', m.h('rags', 'spear', { species: 'human', skin: 0x9a9a8a }), { w: 0.14 }],
      ['fenBeast', 'Fen-Beast', 'troll', m.b('treeman', { kind: 'bog', bark: 0x3a2e22, leaf: 0x3a5a2a, scale: 1.8 }), { k: 1.2, w: 0.08 }],
      ['newt', 'Giant Marsh-Newt', 'wolf', m.b('saurian', { kind: 'tyrant', skin: 0x6a8a3a, scale: 0.9 }), { k: 1.2, w: 0.08, abilities: [{ type: 'poison', damage: 4, chance: 0.5 }] }],
      ['bogWyrm', 'Leech Bog-Wyrm', 'spider', m.b('serpent', { scales: 0x3a2e2e, scale: 1.1 }), { w: 0.08 }],
      ['eye', 'Eye of Balor', 'cyclops', m.h('lamellar', 'greataxe', { build: 'heavy', scale: 1.8, glow: 0xffd84a }), { k: 1.2, w: 0.04, as: true }],
    ],
    ships: [['warBarge', 'Peat-Moss War-Barge', 'galleon', 'oxBarge', { color: 0x2a221a, sail: 0x3a4a2a, oars: true }], ['fogBarge', 'Silent Fog-Barge', 'brigantine', 'oxBarge', { color: 0x1e1a16, sail: 0x4a4a3a, oars: true }]],
    air: null },

  { id: 'kurgan', name: 'The Steppe-Wolves of the Great Kurgan', adj: 'Kurgan', group: 5, town: 'wild', look: 'gorge', biomes: ['temperate', 'snow', 'desert'],
    P: { species: 'human', skin: 0xc48a5a, cloth: 0x6a4a2a, cloth2: 0x8a2a1a, armor: 0x3a3a3a, trim: 0xc8a060 },
    over: { civic: ['shrine', 'graveyard', 'stall', 'yurt', 'yurt', 'totem'], homes: 'tent' },
    places: { village: 'wagon-camp', fort: 'kurgan mound', castle: 'khagan\'s horde-camp', city: 'great moving city', coast: 'river ford camp', harbor: 'catamaran landing', island: 'burial isle' },
    sea: 'baikalWyrm',
    roster: (m) => [
      ['horseArcher', 'Steppe Horse-Archer', 'longbow', m.r('lamellar', 'horse', 'bow', 0x8a6a4a), { k: 1.4, w: 0.24, move: 2 }],
      ['cataphract', 'Black-Scale Cataphract', 'lancer', m.r('lamellar', 'horse', 'lance', 0x3a2a22, { barding: true, armor: 0x2a2a2a }), { k: 1.3, w: 0.14 }],
      ['axeman', 'Kurgan Axeman', 'footman', m.h('pelts', 'axe'), { w: 0.18 }],
      ['shaman', 'Blood-Shaman', 'shaman', m.h('pelts', 'staff', { cloth: 0x8a2a1a }), { k: 2, w: 0.06 }],
      ['camel', 'War-Camel Lancer', 'lancer', m.b('warCamel', { hide: 0xc8a070, rider: m.h('lamellar', 'lance'), scale: 1.4 }, { body: 'rider', species: 'human', outfit: 'lamellar', mountType: 'horse', weapon: 'lance', mount: 0xc8a070, skin: 0xc48a5a }), { k: 1.2, w: 0.08 }],
      ['wolf', 'Mutant Steppe-Wolf', 'wolf', m.q('wolf', 0x6a6a6a, 1.2), { w: 0.1 }],
      ['caveBear', 'Woolly Cave-Bear', 'troll', m.q('bear', 0x5a4030, 1.8), { k: 0.9, w: 0.06 }],
      ['bearLord', 'Bear-Lord', 'minotaur', m.r('pelts', 'bear', 'greataxe', 0x5a4030), { w: 0.04, size: 2 }],
    ],
    ships: [['catamaran', 'Hide River-Catamaran', 'sloop', 'hideRaft', { color: 0x6a4a2a, sail: 0x8a2a1a }], ['junkK', 'Palisaded Junk', 'brigantine', 'junk', { color: 0x5a4030, sail: 0x8a6a4a }]],
    air: null },

  { id: 'hearthmoot', name: 'The Shire-Wardens of Hearthmoot', adj: 'Hearthmoot', group: 5, town: 'civ', look: 'westmark', biomes: ['temperate', 'temperate'],
    P: { species: 'human', skin: 0xe8b898, cloth: 0x4a7a3a, cloth2: 0xd8b880, armor: 0xa8a8a0, trim: 0xc8a040 },
    over: { homes: 'hut', civic: ['inn', 'inn', 'marketHall', 'stall', 'garden', 'garden', 'fountain', 'shrine', 'barracks'] },
    places: { village: 'burrow-hamlet', fort: 'hedge fort', castle: 'thain\'s great smial', city: 'market town', coast: 'fishing village', harbor: 'punt harbour', island: 'river isle' },
    sea: 'riverPike',
    roster: (m) => [
      ['militia', 'Shire Militia', 'militia', m.h('doublet', 'spear', { scale: 0.68, helm: true }), { w: 0.24 }],
      ['slinger', 'Hedge Slinger', 'longbow', m.h('doublet', 'sling', { scale: 0.68 }), { k: 0.8, w: 0.18, projectile: 'rock' }],
      ['bowman', 'Hunting Bowman', 'longbow', m.h('ranger', 'longbow', { scale: 0.68 }), { k: 0.9, w: 0.14 }],
      ['blunder', 'Blunderbuss Warden', 'crossbow', m.h('doublet', 'blunderbuss', { scale: 0.7 }), { w: 0.1 }],
      ['soupCart', 'Soup-Catapult', 'grenadier', m.b('warWagon', { color: 0x7a5a36, trim: 0xc8a040 }), { k: 1.3, w: 0.05, abilities: [{ type: 'splash', radius: 1, mult: 0.6 }] }],
      ['ramRider', 'War-Ram Rider', 'lancer', m.r('doublet', 'boar', 'spear', 0xe8e0d0, { scale: 0.7 }), { k: 0.9, w: 0.08 }],
      ['mastiff', 'Shire Mastiff', 'wolf', m.q('hound', 0x8a6a4a, 1.1), { w: 0.1 }],
      ['swanScout', 'Swan-Rider Scout', 'harpy', m.b('swanRider', { plumage: 0xf0f0ec, rider: m.h('doublet', 'longbow', { scale: 0.68 }), scale: 1.2 }, { body: 'bird', kind: 'eagle', color: 0xf0f0ec, scale: 1.3 }), { w: 0.05 }],
      ['badger', 'Badger Companion', 'wolf', m.b('badger', { fur: 0x3a3a3a, stripe: 0xe8e8e8, scale: 1 }, { body: 'quadruped', kind: 'boar', fur: 0x3a3a3a, scale: 1 }), { k: 0.9, w: 0.06 }],
    ],
    ships: [['houseboat', 'Lantern-Lit Houseboat', 'brigantine', 'fluyt', { color: 0x7a5a36, sail: 0xd8c8a0, trim: 0x4a7a3a }], ['punt', 'River Punt', 'sloop', 'curragh', { color: 0x8a6a42, sail: 0xd8c8a0 }]],
    air: { name: 'Picnic Balloon', style: 'kingdom', color: 0x7a5a36, envelope: 0x4a7a3a, pods: 'militia' } },

  { id: 'baobab', name: 'The Baobab-Kin of the Sun-Savanna', adj: 'Baobab-Kin', group: 5, town: 'tribal', look: 'mistisles', biomes: ['desert', 'jungle', 'temperate'],
    P: { species: 'human', skin: 0x9a6a3a, cloth: 0xc8a050, cloth2: 0xe8e0d0, armor: 0x9a6a3a, trim: 0xc87a3a },
    over: { homes: 'hut', civic: ['shrine', 'stall', 'graveyard', 'totem', 'totem'] },
    places: { village: 'grass-dome kraal', fort: 'thorn boma', castle: 'great baobab', city: 'savanna gathering', coast: 'delta camp', harbor: 'canoe landing', island: 'mangrove isle' },
    sea: 'nyamiNyami',
    roster: (m) => [
      ['blowgun', 'Poison Blowgunner', 'goblinArcher', m.h('loincloth', 'blowpipe', { scale: 0.72 }), { k: 1.5, w: 0.2, abilities: [{ type: 'poison', damage: 4, chance: 0.6 }] }],
      ['bowman', 'Acacia Bowman', 'longbow', m.h('loincloth', 'longbow', { scale: 0.72 }), { k: 0.9, w: 0.16 }],
      ['spear', 'Copper-Spear Thrower', 'goblinSpear', m.h('loincloth', 'javelin', { scale: 0.72 }), { k: 1.8, w: 0.18 }],
      ['ostrich', 'War-Ostrich Rider', 'wolfRider', m.r('loincloth', 'raptor', 'spear', 0x2a2420, { scale: 0.75 }), { k: 1.1, w: 0.12 }],
      ['pangolin', 'Giant Pangolin', 'troll', m.b('pangolin', { scales: 0x8a6a4a, scale: 1.6 }, { body: 'quadruped', kind: 'boar', fur: 0x8a6a4a, scale: 1.6 }), { k: 0.9, w: 0.06 }],
      ['porcupine', 'Crested Porcupine', 'wolf', m.b('porcupine', { fur: 0x4a3a2a, quills: 0xe8e0d0, scale: 1.1 }, { body: 'quadruped', kind: 'boar', fur: 0x4a3a2a, scale: 1.1 }), { w: 0.08 }],
      ['honeyBadger', 'Honey-Badger', 'wolf', m.b('badger', { fur: 0x2a2a2a, stripe: 0xd8d8d0, scale: 0.9 }, { body: 'quadruped', kind: 'boar', fur: 0x2a2a2a, scale: 0.9 }), { k: 1.1, w: 0.08 }],
      ['rainCaller', 'Rain-Caller', 'shaman', m.h('feathers', 'staff', { scale: 0.72 }), { k: 1.8, w: 0.06 }],
    ],
    ships: [['outrigger', 'Painted Outrigger', 'sloop', 'livingSkiff', { color: 0x8a6a3a, sail: 0xe8e0d0 }], ['warCanoe', 'Papyrus War-Canoe', 'cutter', 'curragh', { color: 0xc8a050, sail: 0xc87a3a }]],
    air: null },

  { id: 'nagavar', name: 'The Blood-Pagodas of Nagavar', adj: 'Nagavari', group: 5, town: 'old', look: 'thousandgods', biomes: ['jungle', 'jungle', 'swamp'],
    P: { species: 'lizard', skin: 0x3a7a4a, cloth: 0x6a1a1a, cloth2: 0xd8b03a, armor: 0x8a6a3a, trim: 0xd8b03a },
    over: { civic: ['temple', 'temple', 'shrine', 'shrine', 'garden', 'graveyard', 'palace'] },
    places: { village: 'jungle shrine-village', fort: 'stupa fort', castle: 'serpent temple-keep', city: 'city of blood pagodas', coast: 'mangrove landing', harbor: 'serpent-galley harbour', island: 'stupa isle' },
    sea: 'vasukiLeviathan',
    roster: (m) => [
      ['krisGuard', 'Naga Kris-Guard', 'hobgoblin', m.b('naga', { skin: 0x3a7a4a, belly: 0xc8c070, armor: 0x8a6a3a, trim: 0xd8b03a, arms: 2, weapon: 'glaive' }, { body: 'humanoid', species: 'lizard', outfit: 'ziggurat', weapon: 'glaive', skin: 0x3a7a4a }), { k: 1.4, w: 0.22 }],
      ['cobraGuard', 'Cobra-Hooded Guard', 'halberdier', m.b('naga', { skin: 0x2a2a2a, belly: 0xc8b070, hood: true, arms: 4, weapon: 'glaive', armor: 0x8a6a3a, trim: 0xd8b03a, scale: 1.2 }, { body: 'humanoid', species: 'lizard', outfit: 'ziggurat', weapon: 'glaive', skin: 0x2a2a2a, scale: 1.2 }), { k: 1.2, w: 0.14 }],
      ['viperArcher', 'Viper Archer', 'longbow', m.b('naga', { skin: 0x6a8a3a, belly: 0xd8d0a0, weapon: 'longbow', armor: 0x8a6a3a, trim: 0xd8b03a }, { body: 'humanoid', species: 'lizard', outfit: 'loincloth', weapon: 'longbow', skin: 0x6a8a3a }), { w: 0.14 }],
      ['bloodNaga', 'Blood-Naga Sorcerer', 'necromancer', m.b('naga', { skin: 0x8a1a1a, belly: 0xd8a080, arms: 4, weapon: 'staff', robe: true, armor: 0x8a6a3a, trim: 0xd8b03a }, { body: 'humanoid', species: 'lizard', outfit: 'silkRobe', weapon: 'staff', skin: 0x8a1a1a }), { w: 0.06 }],
      ['python', 'Two-Headed Python', 'spider', m.b('hydra', { scales: 0x6a5a2a, heads: 2, scale: 1.0 }), { k: 1.2, w: 0.08 }],
      ['basilisk', 'Acid Basilisk', 'troll', m.b('saurian', { kind: 'hornback', skin: 0x5a7a3a, scale: 1.3 }), { w: 0.06, abilities: [{ type: 'breath', every: 5, radius: 1, maxHit: 18 }] }],
      ['komodo', 'Giant Komodo', 'wolf', m.b('saurian', { kind: 'tyrant', skin: 0x6a5a4a, scale: 0.8 }), { k: 1.3, w: 0.08, abilities: [{ type: 'poison', damage: 4, chance: 0.5 }] }],
      ['viperDrake', 'Feathered Viper-Drake', 'wyrmling', m.d(0x3a8a5a, 1.6, { feathers: 0xd8b03a }), { w: 0.05 }],
    ],
    ships: [['snakeGalley', 'Bronze Sea-Snake Galley', 'galleon', 'serpentBarge', { color: 0x8a6a3a, sail: 0x6a1a1a, trim: 0xd8b03a, oars: true }], ['cobraProw', 'Cobra-Prow Fire-Galley', 'frigate', 'warGalley', { color: 0x5a4a2a, sail: 0xd8b03a, trim: 0x3a7a4a }]],
    air: null },

  { id: 'pearlfleet', name: 'The Pearl-Fleets of the Coral Reaches', adj: 'Pearl-Fleet', group: 5, town: 'civ', look: 'aethel', biomes: ['temperate', 'jungle', 'desert'],
    P: { species: 'elf', skin: 0xc8a07a, cloth: 0x2aa8b8, cloth2: 0xe8f0f0, armor: 0xc0d0d8, trim: 0xf0e8d8 },
    over: { civic: ['marketHall', 'stall', 'inn', 'fountain', 'fountain', 'temple', 'dockhouse', 'dockhouse', 'garden'] },
    places: { village: 'pontoon village', fort: 'lighthouse fort', castle: 'atoll citadel', city: 'floating city', coast: 'pearl beach', harbor: 'pontoon harbour', island: 'coral atoll' },
    sea: 'cetusPrimeval',
    roster: (m) => [
      ['mariner', 'Pearl Mariner', 'footman', m.h('elfScale', 'cutlass', { helm: true }), { k: 1.1, w: 0.22 }],
      ['tridentGuard', 'Trident Guard', 'halberdier', m.h('elfScale', 'trident', { cuirass: true }), { w: 0.16 }],
      ['harpooner', 'Repeating Harpooner', 'crossbow', m.h('elfScale', 'repeater'), { k: 1.1, w: 0.16 }],
      ['hippocampus', 'Hippocampus Rider', 'lancer', m.b('hippoRider', { hide: 0x2aa8b8, fin: 0xe8f0f0, rider: m.h('elfScale', 'trident'), scale: 1.3 }, { body: 'rider', species: 'elf', outfit: 'elfScale', mountType: 'horse', weapon: 'trident', mount: 0x2aa8b8 }), { k: 1.2, w: 0.1 }],
      ['tuskLancer', 'Narwhal-Tusk Lancer', 'knight', m.h('elfScale', 'lance', { cloth: 0xe8f0f0 }), { w: 0.08 }],
      ['manta', 'Manta Glider', 'griffon', m.b('skyManta', { color: 0x1a3a5a, belly: 0xe8f0f0, rider: m.h('elfScale', 'trident'), scale: 1.6 }, { body: 'bat', fur: 0x1a3a5a, scale: 1.6 }), { w: 0.06 }],
      ['tideSpirit', 'Tide Spirit', 'stormElemental', m.e(0x4ad8e8), { w: 0.06 }],
      ['tideSinger', 'Tide-Singer', 'battlemage', m.h('silkRobe', 'staff', { female: true }), { w: 0.06 }],
    ],
    ships: [['trimaran', 'Nacre Trimaran', 'frigate', 'swanGalley', { color: 0xe8f0f0, sail: 0x9ae8f0, trim: 0x2aa8b8 }], ['waveCutter', 'Crystal Wave-Cutter', 'cutter', 'razorGalley', { color: 0xd8e8f0, sail: 0x2aa8b8, trim: 0xf0e8d8 }]],
    air: { name: 'Jellyfish-Silk Skyship', style: 'elemental', color: 0xe8f0f0, envelope: 0x9ae8f0, pods: 'mariner', hangar: 'manta' } },

  { id: 'glimmer', name: 'The Clockwork Burrows of Glimmer-Hill', adj: 'Glimmer-Hill', group: 5, town: 'civ', look: 'grom', biomes: ['temperate', 'snow'],
    P: { species: 'human', skin: 0xe8b898, cloth: 0x6a2a5a, cloth2: 0x2a5a6a, armor: 0xc8a040, trim: 0xc8a040 },
    over: { homes: 'hut', civic: ['workshop', 'workshop', 'alchemist', 'alchemist', 'inn', 'garden', 'marketHall', 'stall'] },
    places: { village: 'boulder burrows', fort: 'hidden workshop', castle: 'great observatory', city: 'city under the hill', coast: 'cove of decoys', harbor: 'clockwork quay', island: 'illusion isle' },
    sea: 'mirageLeviathan',
    roster: (m) => [
      ['blunder', 'Steam-Blunderbussier', 'crossbow', m.h('doublet', 'blunderbuss', { scale: 0.62 }), { w: 0.22 }],
      ['tinker', 'Burrow Tinker', 'engineer', m.h('doublet', 'warhammer', { scale: 0.62 }), { w: 0.1 }],
      ['illusionist', 'Prism Illusionist', 'battlemage', m.h('mage', 'staff', { scale: 0.62 }), { w: 0.14 }],
      ['grenadier', 'Clockwork Grenadier', 'grenadier', m.h('doublet', 'dagger', { scale: 0.62 }), { w: 0.14 }],
      ['pike', 'Burrow Pikeman', 'pikeman', m.h('doublet', 'pike', { scale: 0.62, helm: true }), { k: 0.8, w: 0.14 }],
      ['clockBadger', 'Clockwork Badger', 'wolf', m.b('badger', { fur: 0xc8a040, stripe: 0x3a3a40, clockwork: true, scale: 1 }, { body: 'quadruped', kind: 'boar', fur: 0xc8a040, scale: 1 }), { w: 0.08 }],
      ['owl', 'Steam-Owl', 'gyrocopter', m.b('mechOwl', { brass: 0xc8a040, glow: 0x9ad8ff, scale: 1.2 }, { body: 'bird', kind: 'eagle', color: 0xc8a040, scale: 1.2 }), { w: 0.06 }],
      ['mole', 'Giant Burrow-Mole', 'troll', m.q('bear', 0x4a3a3a, 1.4), { k: 0.9, w: 0.06 }],
      ['phantom', 'Phantom-Beast', 'wolf', m.q('wolf', 0x9ad8ff, 1.3, { glow: 0x9ad8ff }), { w: 0.04 }],
    ],
    ships: [['duckBoat', 'Decoy Duck Paddle-Boat', 'brigantine', 'paddleGalleon', { color: 0xc8a040, sail: 0x6a2a5a, trim: 0x2a5a6a }], ['logBoat', 'Drifting-Log Raider', 'sloop', 'livingSkiff', { color: 0x6a4a2a, sail: 0x5a4030 }]],
    air: { name: 'Brass-Domed Sky-Observatory', style: 'kingdom', color: 0xc8a040, envelope: 0x6a2a5a, pods: 'blunder', hangar: 'owl' } },

  { id: 'khanate', name: 'The Khanates of the Eastern Steppes', adj: 'Khanate', group: 5, town: 'tribal', look: 'gorge', biomes: ['temperate', 'desert', 'snow'],
    P: { species: 'hobgoblin', skin: 0xc8b04a, cloth: 0x2a2a3a, cloth2: 0x8a1a1a, armor: 0x6a2a1a, trim: 0xc8a040 },
    over: { homes: 'tent', civic: ['stall', 'stall', 'barracks', 'shrine', 'graveyard', 'yurt'] },
    places: { village: 'winter camp', fort: 'skull-tower stockade', castle: 'khan\'s palisade', city: 'slave-market city', coast: 'raft landing', harbor: 'barge moorings', island: 'black gulf isle' },
    sea: 'wolfEel',
    roster: (m) => [
      ['blade', 'Khanate Scimitar', 'hobgoblin', m.h('lamellar', 'scimitar', { hair: 'topknot' }), { w: 0.24 }],
      ['bowman', 'Composite Bowman', 'goblinArcher', m.h('lamellar', 'bow', { hair: 'topknot' }), { k: 2.4, w: 0.16 }],
      ['wolfRider', 'Steppe Wolf-Rider', 'wolfRider', m.r('lamellar', 'wolf', 'scimitar', 0x5a5a5a, { hair: 'topknot' }), { k: 1.3, w: 0.16 }],
      ['mustang', 'Mustang Raider', 'lancer', m.r('lamellar', 'horse', 'scimitar', 0x6a4a2a, { hair: 'topknot' }), { w: 0.1 }],
      ['cutthroat', 'Poisoned Cutthroat', 'scout', m.h('darkHood', 'dagger'), { k: 1.2, w: 0.1, abilities: [{ type: 'poison', damage: 5, chance: 0.5 }] }],
      ['hyena', 'Armoured War-Hyena', 'hellhound', m.q('hound', 0x8a7a4a, 1.1, { armor: 0x6a2a1a }), { w: 0.1, abilities: [] }],
      ['greatWolf', 'Scarred Great-Wolf', 'alphaWolf', m.q('wolf', 0x4a4a4a, 1.6), { w: 0.05 }],
      ['khanGuard', 'Khan\'s Lamellar Guard', 'knight', m.h('lamellar', 'glaive', { cuirass: true }), { w: 0.06 }],
    ],
    ships: [['ferry', 'Lashed Troop-Ferry', 'brigantine', 'oxBarge', { color: 0x5a4030, sail: 0x8a6a4a, oars: true }], ['stolenBarge', 'Captured River-Barge', 'sloop', 'oxBarge', { color: 0x6a4a2a, sail: 0x8a1a1a }]],
    air: null },

  { id: 'emerald', name: 'The Sisterhood of the Emerald River', adj: 'Emerald', group: 5, town: 'old', look: 'xibalba', biomes: ['jungle', 'jungle', 'swamp'],
    P: { species: 'human', skin: 0xb07850, cloth: 0x8a6a2a, cloth2: 0x2a8a5a, armor: 0xd8b03a, trim: 0x2a8a5a },
    over: { civic: ['temple', 'temple', 'shrine', 'garden', 'fountain', 'barracks', 'palace'] },
    places: { village: 'canopy village', fort: 'river citadel', castle: 'sun-temple keep', city: 'golden river-city', coast: 'jaguar strand', harbor: 'galley haven', island: 'river isle' },
    sea: 'matriarchCaiman',
    roster: (m) => [
      ['warrior', 'Jaguar-Pelt Warrior', 'footman', m.h('tigerPelt', 'macuahuitl', { female: true }), { k: 1.2, w: 0.22 }],
      ['huntress', 'Blowgun Huntress', 'longbow', m.h('feathers', 'blowpipe', { female: true }), { w: 0.14, abilities: [{ type: 'poison', damage: 4, chance: 0.5 }] }],
      ['solar', 'Solar-Staff Priestess', 'battlemage', m.h('sunGold', 'staff', { female: true, glow: 0xffd84a }), { k: 1.1, w: 0.1 }],
      ['goldGuard', 'Gold-Breastplate Guard', 'halberdier', m.h('sunGold', 'spear', { female: true, cuirass: true }), { w: 0.14 }],
      ['jaguar', 'Black Jaguar', 'wolf', m.q('leopard', 0x1a1a1e, 1.3), { k: 1.2, w: 0.1 }],
      ['otter', 'Armoured River-Otter', 'wolf', m.b('riverOtter', { fur: 0x5a4030, armor: 0xd8b03a, scale: 1.3 }, { body: 'quadruped', kind: 'fox', fur: 0x5a4030, scale: 1.3 }), { w: 0.08 }],
      ['guardian', 'Glowing Stone Guardian', 'golem', m.g(0x8a9a8a, 2, { glow: 0x6affc8 }), { w: 0.05 }],
      ['blade', 'Matriarch\'s Blade', 'knight', m.h('sunGold', 'greatsword', { female: true, cuirass: true }), { w: 0.06 }],
    ],
    ships: [['jaguarGalley', 'Leaping-Jaguar Galley', 'galleon', 'warGalley', { color: 0x8a6a2a, sail: 0x2a8a5a, trim: 0xd8b03a, oars: true }], ['piranha', 'Piranha War-Galley', 'frigate', 'razorGalley', { color: 0x6a4a2a, sail: 0xd8b03a, trim: 0x2a8a5a }]],
    air: null },

  { id: 'deeproot', name: 'The Deep-Root Folk of the Whispering Canopy', adj: 'Deep-Root', group: 5, town: 'wild', look: 'verdant', biomes: ['jungle', 'swamp'],
    P: { species: 'goblin', skin: 0x6a8a4a, cloth: 0x3a6a2a, cloth2: 0xe83a3a, armor: 0x5a4030, trim: 0xe8d83a },
    over: { homes: 'hut', civic: ['shrine', 'totem', 'totem', 'graveyard', 'stall'] },
    places: { village: 'nest-tree village', fort: 'vine fort', castle: 'great canopy hold', city: 'city in the canopy', coast: 'swamp landing', harbor: 'reed-raft landing', island: 'mangrove isle' },
    sea: 'mangroveHydra',
    roster: (m) => [
      ['hunter', 'Canopy Spear-Hunter', 'goblinSpear', m.h('feathers', 'spear'), { k: 1.2, w: 0.24 }],
      ['dartBlower', 'Dart-Frog Blowpiper', 'goblinArcher', m.h('loincloth', 'blowpipe'), { k: 1.2, w: 0.2, abilities: [{ type: 'poison', damage: 5, chance: 0.6 }] }],
      ['knifeDancer', 'Obsidian Knife-Dancer', 'goblin', m.h('loincloth', 'dagger'), { k: 1.4, w: 0.12 }],
      ['tarantula', 'Giant Tarantula', 'spider', { body: 'spider', fur: 0x3a2a20, scale: 1.2 }, { w: 0.1 }],
      ['cassowary', 'Cassowary Rider', 'wolfRider', m.r('feathers', 'raptor', 'spear', 0x1a1a2a), { w: 0.1 }],
      ['wasps', 'Jungle Wasp-Swarm', 'bat', m.b('waspSwarm', { body2: 0xe8c83a, stripe: 0x1a1a1a, scale: 1 }, { body: 'bat', fur: 0xe8c83a, scale: 0.9 }), { w: 0.08 }],
      ['frog', 'Poison Tree-Frog', 'wolf', m.b('dartFrog', { skin: 0xe83a3a, spots: 0x1a1a2a, scale: 1.2 }, { body: 'quadruped', kind: 'boar', fur: 0xe83a3a, scale: 1 }), { w: 0.06, abilities: [{ type: 'poison', damage: 6, chance: 0.6 }] }],
      ['spiritCaller', 'Totem Spirit-Caller', 'shaman', m.h('feathers', 'staff'), { w: 0.06 }],
    ],
    ships: [['balsa', 'Balsa Canoe', 'sloop', 'livingSkiff', { color: 0xc8a870, sail: 0x3a6a2a }], ['reedRaft', 'Woven Reed Raft', 'raft', 'hideRaft', { color: 0x8a8a4a, sail: 0x3a6a2a }]],
    air: null },

  { id: 'goldsands', name: 'The Sun-Empires of the Golden Sands', adj: 'Golden Sands', group: 5, town: 'civ', look: 'caliphate', biomes: ['desert', 'desert'],
    P: { species: 'human', skin: 0xb07850, cloth: 0xe8e0d0, cloth2: 0x2a8a9a, armor: 0xd8b03a, trim: 0xd8b03a },
    over: { civic: ['palace', 'marketHall', 'stall', 'stall', 'stall', 'bank', 'fountain', 'garden', 'temple', 'alchemist'] },
    places: { village: 'oasis', fort: 'desert ribat', castle: 'sultan\'s citadel', city: 'city of a thousand domes', coast: 'pearl-diver coast', harbor: 'dhow harbour', island: 'oasis isle' },
    sea: 'zaratan',
    roster: (m) => [
      ['mamluk', 'Gilded Mamluk', 'lancer', m.r('lamellar', 'horse', 'scimitar', 0xe8e0d0, { barding: true }), { k: 1.3, w: 0.16 }],
      ['dervish', 'Desert Dervish', 'footman', m.h('silkRobe', 'scimitar'), { k: 1.1, w: 0.2 }],
      ['bowman', 'Bedouin Bowman', 'longbow', m.h('silkRobe', 'bow', { cloth: 0xc8a070 }), { w: 0.14 }],
      ['vizier', 'Sorcerer-Vizier', 'battlemage', m.h('brocade', 'staff', { cloth: 0x6a2a9a }), { w: 0.06 }],
      ['stallion', 'Desert Stallion Rider', 'wolfRider', m.r('silkRobe', 'horse', 'spear', 0xd8d0c0), { k: 1.6, w: 0.1 }],
      ['elephant', 'Tower War-Elephant', 'boneColossus', m.q('elephant', 0x8a8078, 2.4, { howdah: true }), { k: 0.75, w: 0.04 }],
      ['carpet', 'Flying-Carpet Archer', 'gyrocopter', m.b('carpet', { color: 0x2a8a9a, trim: 0xd8b03a, rider: m.h('silkRobe', 'longbow') }), { w: 0.05 }],
      ['djinn', 'Bound Djinn', 'infernalLord', m.b('djinn', { skin: 0x3a8ac8, glow: 0x9ad8ff, scale: 1.8 }), { k: 0.8, w: 0.03, as: true }],
      ['efreet', 'Bound Efreet', 'fireElemental', m.e(0xff7a2a, { scale: 1.6 }), { k: 1.2, w: 0.05 }],
    ],
    ships: [['xebec', 'Royal Xebec', 'frigate', 'dhow', { color: 0xc8a070, sail: 0xe8e0d0, sail2: 0x2a8a9a, trim: 0xd8b03a }], ['dhowG', 'Naphtha Dhow', 'brigantine', 'dhow', { color: 0x9a7a4a, sail: 0xe8e0d0, trim: 0xd8b03a }]],
    air: { name: 'Golden Sky-Dhow', style: 'kingdom', color: 0xc8a070, envelope: 0x2a8a9a, pods: 'dervish', hangar: 'carpet' } },
];

// ------------------------------------------------------------------------------------------
// Expansion into the game's tables
// ------------------------------------------------------------------------------------------
const uid = (f, id) => `${f.id}_${id}`;
const STAT = ['att', 'str', 'def', 'rng', 'mag'];

/** Units of every realm, built from the base roster. Returns { id: def }. */
export function realmUnits(BASE) {
  const out = {};
  for (const f of REALMS) {
    const m = mk(f.P);
    for (const [id, name, baseId, model, mods = {}] of f.roster(m)) {
      const b = BASE[baseId];
      if (!b) throw new Error(`realms: ${f.id}.${id} is based on an unknown unit "${baseId}"`);
      const { k = 1, w, as, ...over } = mods, r = Math.sqrt(k);
      const u = { ...b, name, category: f.name, model, realm: f.id };
      delete u.id; delete u.trades;
      u.hp = Math.max(1, Math.round(b.hp * k));
      for (const s of STAT) if (b[s] > 1) u[s] = Math.max(1, Math.round(b[s] * r));
      u.bonus = Object.fromEntries(Object.entries(b.bonus || {}).map(([key, v]) => [key, Math.round(v * (v > 0 ? r : 1))]));
      u.abilities = (b.abilities || []).map((a) => ({ ...a }));
      Object.assign(u, over);
      // a unit that changes how it fights needs the matching attack bonus
      if (over.style && over.style !== b.style) {
        const top = Math.max(u.bonus.att || 0, u.bonus.rngAtt || 0, u.bonus.magAtt || 0, 30);
        if (over.style === 'ranged') { u.bonus.rngAtt = top; u.bonus.rngStr = Math.round(top * 0.7); }
        if (over.style === 'magic') u.bonus.magAtt = top;
        if (over.style === 'melee') { u.bonus.att = top; u.bonus.str = top; }
      }
      out[uid(f, id)] = u;
    }
  }
  return out;
}

// Price correction per realm, from trials at equal points against the Kingdom on open ground
// (forty battles a step, then a closer search between the two nearest prices): below 1 the realm's troops fought under their price, so it musters more.
const COST = { aethel: 0.73, ashur: 0.82, aurelia: 0.80, caliphate: 0.94, cloven: 0.76, crimson: 0.78, drowned: 0.97, fimbul: 0.71, gorge: 0.66, graal: 0.81,
  greenhide: 0.74, grom: 0.95, ironbound: 0.82, kaelneth: 0.80, khemet: 1.01, mistisles: 0.71, principalities: 0.59, screaming: 0.64, shogunate: 0.58,
  skar: 0.50, sunkings: 0.64, thousandgods: 1.34, tianlong: 1.00, velikaya: 0.75, verdant: 0.70, westmark: 0.81, xibalba: 0.49,
  kharnak: 0.60, morbus: 0.87, velvet: 0.67, malvash: 0.79, ashhorde: 0.61, balor: 0.54, kurgan: 0.76, hearthmoot: 0.50, baobab: 0.76, nagavar: 0.73,
  pearlfleet: 0.80, glimmer: 0.97, khanate: 0.47, emerald: 0.82, deeproot: 0.42, goldsands: 0.91, labyrinth: 1.28 };

/** lays a realm's own design (src/data/fleets) over a working hull: name, looks, arts and what they need */
function designed(out, id, f, D) {
  const s = out[id];
  if (!s || !D) return;
  s.name = `${f.adj} ${D.name}`;
  if (D.note) s.note = D.note;
  if (D.look) { if (D.look.hull !== undefined) s.color = D.look.hull; if (D.look.sail !== undefined) s.sail = D.look.sail; if (D.look.trim !== undefined) s.trim = D.look.trim; }
  s.dress = D.dress || [];
  const a = { ...(D.arts || {}) };
  s.arts = a;
  const m = D.mul || {};
  if (m.hull) s.hull = Math.round(s.hull * m.hull);
  if (m.speed) s.speed = +(s.speed * m.speed).toFixed(3);
  if (m.armour) s.armour = Math.round(s.armour * m.armour);
  if (m.crew) s.crew = Math.round(s.crew * m.crew);
  if (m.turn) s.turn = +(s.turn * m.turn).toFixed(2);
  if (a.armour) s.armour += a.armour;
  if (a.aa) s.flak = { range: 14, dmg: [6, 14], reload: 2, acc: 0.55, guns: 2, ...a.aa };
  if ((a.ram || a.drill || a.blade || a.tow) && !s.ram) s.ram = { base: 30, perTile: 3, cooldown: 30 };
  if (a.hover || a.phase) s.flat = true;
  if (a.oars) s.oars = true;
  if (D.flier && s.squadrons) {
    const F = D.flier;
    s.squadrons = { ...s.squadrons, flier: F.style || s.squadrons.flier, name: F.name ? `${f.adj} ${F.name}` : s.squadrons.name, color: F.color,
      def: { ...(F.hp ? { hp: F.hp } : {}), ...(F.dmg ? { dmg: F.dmg } : {}), ...(F.burn !== undefined ? { burn: F.burn } : {}), ...(F.crewKill ? { crewKill: F.crewKill } : {}), ...(F.speed ? { speed: F.speed } : {}), ...(F.hunter ? { hunter: true } : {}), color: F.color } };
  }
  // a siege ship's shells must last if she fires salvoes
  if (s.mortar && a.salvo) s.mortar = { ...s.mortar, shells: Math.round((s.mortar.shells ?? 16) * 1.3) };
}

/** Worldgen factions: how each realm builds and what it musters. */
export function realmFactions() {
  const out = {};
  for (const f of REALMS) {
    const t = { ...TOWN[f.town], ...(f.over || {}) }, army = {}, assault = {};
    for (const [id, , , , mods = {}] of f.roster(mk(f.P))) if (mods.w) (mods.as ? assault : army)[uid(f, id)] = mods.w;
    const { civic, ...build } = t;
    out[f.id] = { name: f.name, adj: f.adj, group: REALM_GROUPS[f.group], biomes: f.biomes, cost: COST[f.id] || 1, ...build, civic: [...civic, ...landmarksOf(f.id)], look: f.look, army, assault,
      ships: [...(FLEET_DESIGNS[f.id]?.line ? [`${f.id}_line`] : []), ...f.ships.map((s) => uid(f, s[0]))], roleShips: Object.fromEntries(['siege', 'carrier', 'flak', 'troop', 'hunter', 'landing'].map((k) => [k, `${f.id}_${k}`])), undersea: underseaOf(f), seaMonster: f.sea || null, airship: f.air || SKY[f.id] ? `${f.id}Zeppelin` : null, places: { ...PLACES, ...(f.places || {}) } };
  }
  return out;
}

// What each realm sends beneath the waves: a diving boat of its own make, or, for the peoples who build no
// such thing, a sea beast broken to the same work. [name] for a boat, or '!creature id' for a beast.
const UNDERSEA = {
  graal: ['Pilgrim Diving-Bell'], aurelia: ['Imperial Steam Diver'], aethel: ['Pearl Diver-Galley'], kaelneth: ['Black Fang Lurker'], verdant: '!coilSerpent',
  grom: ['Deep-Delver Ironfish'], xibalba: '!shonisaurus', velikaya: ['Under-Ice Boat'], tianlong: ['Jade Carp Diver'],
  ironbound: ['Iron Maw Lurker'], screaming: '!abyssalMaw', cloven: '!tylosaurus', fimbul: '!polarSerpent', ashur: ['Brass Fire-Fish'], greenhide: ['Scrap Diver'], skar: null,
  crimson: ['Coffin Diver'], khemet: ['Scarab Diver'], drowned: ['Drowned Lurker'],
  gorge: '!kronosaurus', westmark: ['Republic Diving Boat'], principalities: ["Inventor's Sea-Turtle"], sunkings: ['Royal Diving Galley'], caliphate: ['Brass Whale'], shogunate: ['Iron Turtle-Boat'],
  mistisles: '!elasmosaurus', thousandgods: ['Makara Diver'],
  kharnak: ['Brass Ram-Sub'], morbus: '!bogLurker', labyrinth: ['Crystal Diving-Orb'], velvet: ['Pearl Diving-Swan'], malvash: ['Soul-Fired Iron Lurker'], ashhorde: ['Black-Iron Lurker'],
  balor: '!mireEel', kurgan: '!tuskWalrus', hearthmoot: ['Barrel Diving-Bell'], baobab: '!riverTyrant', nagavar: ['Bronze Sea-Snake Diver'], pearlfleet: ['Nacre Diver'],
  glimmer: ['Clockwork Submersible'], khanate: '!mireEel', emerald: ['Cedar Diving-Galley'], deeproot: '!lagoonSquid', goldsands: ['Djinn-Bottle Diver'],
};
/** the id of a realm's undersea unit: a ship class, or a creature for the peoples who use beasts */
export const underseaOf = (f) => { const u = UNDERSEA[f.id]; return u === null ? `${f.id}_sub` : typeof u === 'string' ? u.slice(1) : `${f.id}_diver`; };

/** Ship classes of every realm: an existing class's sailing and gunnery with the realm's own hull. */
export function realmShips(BASE, SUB = null) {
  const out = {};
  // each boat-building realm's submersible, in its own colours
  if (SUB) for (const f of REALMS) {
    const u = UNDERSEA[f.id];
    if (!Array.isArray(u)) continue;
    const first = f.ships[0] && f.ships[0][4] || {};
    out[`${f.id}_diver`] = { ...SUB, name: u[0], realm: f.id, fleet: f.name, color: first.color ?? f.P.armor, sail: f.P.cloth, trim: f.P.trim };
  }
  // every realm's fleet has the six supporting roles too, in its own hulls and colours
  const ROLES = [['siege', 'bombKetch', 'Bomb-Ketch'], ['carrier', 'skyCarrier', 'Sky-Carrier'], ['flak', 'flakFrigate', 'Flak Ship'], ['troop', 'supplyGalleon', 'Supply Flagship'], ['hunter', 'hunterCutter', 'Leviathan Hunter'], ['landing', 'landingBarge', 'Landing Barge']];
  for (const f of REALMS) {
    const [, , , kind, look = {}] = f.ships[0];
    for (const [role, baseId, label] of ROLES) {
      const b = BASE[baseId];
      if (!b) continue;
      const { color, sail, sail2, trim, emblem } = look;
      out[`${f.id}_${role}`] = { ...b, name: `${f.adj} ${label}`, kind, realm: f.id, fleet: f.name, roleShip: true, ...(color !== undefined ? { color } : {}), ...(sail !== undefined ? { sail } : {}), ...(sail2 !== undefined ? { sail2 } : {}), ...(trim !== undefined ? { trim } : {}), ...(emblem ? { emblem } : {}), ...(role === 'landing' ? { oars: true, sails: 0 } : {}) };
      // realms that build airships fly gliders and gyros off their carriers; the rest fly tamed beasts
      if (role === 'carrier') out[`${f.id}_${role}`].squadrons = { ...b.squadrons, flier: f.air ? (f.id.length % 2 ? 'gyro' : 'glider') : 'beast', name: f.air ? `${f.adj} Squadron` : `${f.adj} Sky-Riders` };
      designed(out, `${f.id}_${role}`, f, FLEET_DESIGNS[f.id]?.[role]);
    }
    // the realm's own ship of the line, built for breaking other ships
    const L = FLEET_DESIGNS[f.id]?.line;
    if (L && BASE[L.base || 'frigate']) {
      const lk = look;
      out[`${f.id}_line`] = { ...BASE[L.base || 'frigate'], kind, realm: f.id, fleet: f.name, roleShip: true, role: 'line',
        ...(lk.color !== undefined ? { color: lk.color } : {}), ...(lk.sail !== undefined ? { sail: lk.sail } : {}), ...(lk.trim !== undefined ? { trim: lk.trim } : {}), ...(lk.emblem ? { emblem: lk.emblem } : {}) };
      designed(out, `${f.id}_line`, f, L);
    }
  }
  for (const f of REALMS) for (const [id, name, baseId, kind, over = {}] of f.ships) {
    const b = BASE[baseId];
    if (!b) throw new Error(`realms: ship ${f.id}.${id} is based on an unknown class "${baseId}"`);
    out[uid(f, id)] = { ...(kind === 'submersible' && SUB ? SUB : b), name, kind, realm: f.id, fleet: f.name, ...over }; // a submersible hull dives and carries torpedoes whatever it was drawn from
  }
  return out;
}

/** One airship for each realm that flies them. `make` is the airship table's own constructor. */
export function realmAirships(make) {
  const out = {};
  for (const f of REALMS) {
    const D = SKY[f.id];
    if (!f.air && !D) continue;
    const a = f.air || {}, k = a.bombs || 1, beast = D && D.kind === 'beast';
    // who rides down: the airship's own boarders, or the realm's most numerous troops
    let pods = a.pods ? uid(f, a.pods) : null;
    if (!pods) { let bw = -1; for (const [id, , , , mods = {}] of f.roster(mk(f.P))) if (mods.w && !mods.as && mods.w > bw) { bw = mods.w; pods = uid(f, id); } }
    const hang = D && D.hangar ? D.hangar : a.hangar;
    const hangUnit = !hang ? (beast ? 'harpy' : 'gyrocopter') : hang[0] === '!' ? hang.slice(1) : uid(f, hang);
    const look = (D && D.look) || {};
    const def = make({ name: D ? D.name : a.name, faction: f.id, style: a.style || (f.group >= 4 ? 'infernal' : 'kingdom'),
      color: look.hull ?? look.body ?? a.color ?? f.P.armor, envelope: look.envelope ?? look.wing ?? a.envelope ?? f.P.cloth, hull: 820, crew: 14, marines: 1,
      cannons: { perSide: 4, dmg: [8, 24], range: 10, reload: 7, acc: 0.55 }, bombs: { maxHit: Math.round(34 * k), radius: 2, reload: 9 },
      hangar: { unit: hangUnit, count: beast && !hang ? 0 : 6, every: 26 }, pods: { unit: pods, pods: 4, perPod: 3 }, ladders: { capacity: 8, every: 60 } });
    if (D) {
      def.name = `${f.adj} ${D.name}`;
      def.note = D.note; def.sky = D; def.arts = { ...(D.arts || {}) };
      if (beast) {
        // a great flying beast: lower and quicker than a gasbag, its riders on its back, its breath for a gun deck
        Object.assign(def, { beast: D.creature, len: 8, altitude: 4.6, speed: 0.62, turn: 20, armour: 22, hull: 760, crew: Math.max(4, (D.riders || 4) * 2), marines: 1.3,
          cannons: { perSide: 2, dmg: [10, 26], range: 7, reload: 6, acc: 0.6 }, ladders: { capacity: 4, every: 80 } });
        def.pods = { ...def.pods, pods: 3, perPod: 2 };
      }
      const m = D.mul || {};
      for (const key of ['hull', 'speed', 'crew', 'armour']) if (m[key]) def[key] = key === 'speed' ? +(def[key] * m[key]).toFixed(3) : Math.round(def[key] * m[key]);
      if (def.arts.swarm) def.hangar = { ...def.hangar, count: def.hangar.count * 2 || 8, every: Math.round(def.hangar.every * 0.6) };
      if (def.arts.dive) def.bombs = { ...def.bombs, maxHit: Math.round(def.bombs.maxHit * 1.5) };
      if (def.arts.steady) def.cannons = { ...def.cannons, acc: +(def.cannons.acc * 1.2).toFixed(2) };
    }
    out[`${f.id}Zeppelin`] = def;
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Landmark buildings: two per realm. They join the game's structure table and each realm's
// districts once their models are sculpted (LANDMARK_REALMS).
// ------------------------------------------------------------------------------------------
// realms whose landmark models exist
const LANDMARK_REALMS = new Set(['graal', 'aurelia', 'aethel', 'kaelneth', 'verdant', 'grom', 'xibalba', 'velikaya', 'tianlong',
  'ironbound', 'screaming', 'cloven', 'fimbul', 'ashur', 'greenhide', 'skar', 'crimson', 'khemet', 'drowned',
  'gorge', 'westmark', 'principalities', 'sunkings', 'caliphate', 'shogunate', 'mistisles', 'thousandgods',
  'kharnak', 'morbus', 'labyrinth', 'velvet', 'malvash', 'ashhorde',
  'balor', 'kurgan', 'hearthmoot', 'baobab', 'nagavar', 'pearlfleet', 'glimmer', 'khanate', 'emerald', 'deeproot', 'goldsands']);
const L = (realm, name, w, h, hp, losHeight, x = {}) => ({ name, w, h, hp, losHeight, realm, ...(x.cover ? {} : { blocksMove: true, blocksLos: true }), ...x });
export const LANDMARKS = {
  graal_cathedral: L('graal', 'Gothic cathedral', 4, 6, 2200, 8, { model: 'graal_cathedral', color: 0x8a8a86, heals: 2 }),
  graal_hovel: L('graal', 'Serf hovel', 2, 2, 160, 2, { model: 'graal_hovel', color: 0x8a8a86 }),
  aurelia_foundry: L('aurelia', 'Foundry', 4, 3, 900, 5, { model: 'aurelia_foundry', color: 0x8a8a86, cargo: 4 }),
  aurelia_hammerTemple: L('aurelia', 'Temple of the Hammer-Saint', 4, 5, 1800, 7, { model: 'aurelia_hammerTemple', color: 0x8a8a86, heals: 2 }),
  aethel_ivoryTower: L('aethel', 'Ivory tower', 3, 3, 1400, 9, { model: 'aethel_ivoryTower', color: 0x8a8a86 }),
  aethel_waystone: L('aethel', 'Crystal waystone', 1, 1, 300, 4, { model: 'aethel_waystone', color: 0x8a8a86, heals: 1 }),
  kaelneth_bloodZiggurat: L('kaelneth', 'Sacrificial ziggurat', 5, 5, 2200, 6, { model: 'kaelneth_bloodZiggurat', color: 0x8a8a86 }),
  kaelneth_spikeTower: L('kaelneth', 'Spiked iron watchtower', 2, 2, 700, 7, { model: 'kaelneth_spikeTower', color: 0x8a8a86 }),
  verdant_treePalace: L('verdant', 'Tree-palace', 5, 5, 2400, 9, { model: 'verdant_treePalace', color: 0x8a8a86, heals: 1 }),
  verdant_sapLantern: L('verdant', 'Sap-lantern', 1, 1, 120, 3, { model: 'verdant_sapLantern', color: 0x8a8a86 }),
  grom_runeGate: L('grom', 'Rune-gate hall', 5, 4, 3000, 6, { model: 'grom_runeGate', color: 0x8a8a86 }),
  grom_steamWorks: L('grom', 'Steam works', 3, 3, 900, 5, { model: 'grom_steamWorks', color: 0x8a8a86, cargo: 4 }),
  xibalba_stepPyramid: L('xibalba', 'Stepped ziggurat', 6, 6, 3200, 7, { model: 'xibalba_stepPyramid', color: 0x8a8a86 }),
  xibalba_sunMirror: L('xibalba', 'Solar mirror', 2, 2, 400, 4, { model: 'xibalba_sunMirror', color: 0x8a8a86 }),
  velikaya_onionCathedral: L('velikaya', 'Onion-domed cathedral', 4, 5, 1900, 8, { model: 'velikaya_onionCathedral', color: 0x8a8a86, heals: 2 }),
  velikaya_boyarManor: L('velikaya', 'Boyar manor', 4, 3, 800, 4, { model: 'velikaya_boyarManor', color: 0x8a8a86 }),
  tianlong_pagoda: L('tianlong', 'Pagoda palace', 4, 4, 2000, 9, { model: 'tianlong_pagoda', color: 0x8a8a86 }),
  tianlong_skyLantern: L('tianlong', 'Sky-lantern observatory', 2, 2, 500, 6, { model: 'tianlong_skyLantern', color: 0x8a8a86 }),
  ironbound_basaltMonolith: L('ironbound', 'Spiked monolith', 2, 2, 1200, 7, { model: 'ironbound_basaltMonolith', color: 0x8a8a86 }),
  ironbound_skullAltar: L('ironbound', 'Skull-paved altar', 3, 3, 600, 2, { model: 'ironbound_skullAltar', color: 0x8a8a86 }),
  screaming_warpSpire: L('screaming', 'Impossible spire', 3, 3, 1300, 9, { model: 'screaming_warpSpire', color: 0x8a8a86 }),
  screaming_fungalGarden: L('screaming', 'Festering garden', 3, 3, 300, 2, { model: 'screaming_fungalGarden', color: 0x8a8a86, cover: true }),
  cloven_herdstone: L('cloven', 'Herdstone', 2, 2, 900, 5, { model: 'cloven_herdstone', color: 0x8a8a86 }),
  cloven_hideTent: L('cloven', 'Hide tent', 2, 2, 120, 2, { model: 'cloven_hideTent', color: 0x8a8a86 }),
  fimbul_longhouse: L('fimbul', 'Longhouse', 5, 3, 900, 4, { model: 'fimbul_longhouse', color: 0x8a8a86, heals: 1 }),
  fimbul_whaleShrine: L('fimbul', 'Whalebone shrine', 2, 2, 300, 4, { model: 'fimbul_whaleShrine', color: 0x8a8a86 }),
  ashur_forgeZiggurat: L('ashur', 'Forge-ziggurat', 6, 6, 3400, 8, { model: 'ashur_forgeZiggurat', color: 0x8a8a86 }),
  ashur_blastFurnace: L('ashur', 'Blast furnace', 3, 3, 1000, 6, { model: 'ashur_blastFurnace', color: 0x8a8a86, cargo: 4 }),
  greenhide_idol: L('greenhide', 'Great idol', 2, 2, 800, 6, { model: 'greenhide_idol', color: 0x8a8a86 }),
  greenhide_boneTower: L('greenhide', 'Timber-and-bone watchtower', 2, 2, 400, 6, { model: 'greenhide_boneTower', color: 0x8a8a86 }),
  skar_reactor: L('skar', 'Blightstone reactor', 3, 3, 900, 6, { model: 'skar_reactor', color: 0x8a8a86, volatile: 4 }),
  skar_scaffoldWarren: L('skar', 'Scaffold warren', 4, 3, 500, 5, { model: 'skar_scaffoldWarren', color: 0x8a8a86 }),
  crimson_mausoleum: L('crimson', 'Mausoleum', 3, 4, 1400, 5, { model: 'crimson_mausoleum', color: 0x8a8a86 }),
  crimson_gallows: L('crimson', 'Gallows', 2, 1, 150, 3, { model: 'crimson_gallows', color: 0x8a8a86 }),
  khemet_pyramid: L('khemet', 'Pyramid', 7, 7, 5000, 9, { model: 'khemet_pyramid', color: 0x8a8a86 }),
  khemet_sphinxStatue: L('khemet', 'Gold-capped sphinx', 2, 4, 1200, 4, { model: 'khemet_sphinxStatue', color: 0x8a8a86 }),
  drowned_hullHouse: L('drowned', 'Upturned-hull house', 4, 2, 500, 3, { model: 'drowned_hullHouse', color: 0x8a8a86 }),
  drowned_lighthouse: L('drowned', 'Lighthouse', 2, 2, 900, 9, { model: 'drowned_lighthouse', color: 0x8a8a86 }),
  gorge_mammothYurt: L('gorge', 'Mammoth-hide yurt', 4, 4, 700, 4, { model: 'gorge_mammothYurt', color: 0x8a8a86 }),
  gorge_gorgeAltar: L('gorge', 'Stone-and-skull altar', 3, 3, 800, 3, { model: 'gorge_gorgeAltar', color: 0x8a8a86 }),
  westmark_canalHouse: L('westmark', 'Canal house', 2, 3, 600, 5, { model: 'westmark_canalHouse', color: 0x8a8a86 }),
  westmark_exchange: L('westmark', 'Stock exchange', 5, 4, 1800, 5, { model: 'westmark_exchange', color: 0x8a8a86, cargo: 6 }),
  principalities_villa: L('principalities', 'Marble villa', 4, 4, 1000, 4, { model: 'principalities_villa', color: 0x8a8a86 }),
  principalities_bellTower: L('principalities', 'Bell tower', 2, 2, 1100, 9, { model: 'principalities_bellTower', color: 0x8a8a86 }),
  sunkings_baroqueChurch: L('sunkings', 'Baroque church', 4, 6, 2000, 8, { model: 'sunkings_baroqueChurch', color: 0x8a8a86, heals: 2 }),
  sunkings_aqueduct: L('sunkings', 'Aqueduct', 6, 1, 900, 4, { model: 'sunkings_aqueduct', color: 0x8a8a86 }),
  caliphate_minaret: L('caliphate', 'Minaret', 2, 2, 900, 9, { model: 'caliphate_minaret', color: 0x8a8a86 }),
  caliphate_bazaar: L('caliphate', 'Bazaar courtyard', 5, 5, 700, 3, { model: 'caliphate_bazaar', color: 0x8a8a86, cargo: 6 }),
  shogunate_tenshu: L('shogunate', 'Castle keep', 5, 5, 3400, 9, { model: 'shogunate_tenshu', color: 0x8a8a86 }),
  shogunate_torii: L('shogunate', 'Torii gate', 3, 1, 250, 4, { model: 'shogunate_torii', color: 0x8a8a86 }),
  mistisles_megaliths: L('mistisles', 'Megalith ring', 5, 5, 1500, 4, { model: 'mistisles_megaliths', color: 0x8a8a86, heals: 1 }),
  mistisles_roundHut: L('mistisles', 'Round stone hut', 2, 2, 250, 2, { model: 'mistisles_roundHut', color: 0x8a8a86 }),
  thousandgods_carvedTemple: L('thousandgods', 'Temple of a thousand statues', 5, 5, 2600, 9, { model: 'thousandgods_carvedTemple', color: 0x8a8a86, heals: 2 }),
  thousandgods_stepwell: L('thousandgods', 'Stepped water-tank', 4, 4, 600, 1, { model: 'thousandgods_stepwell', color: 0x8a8a86, cover: true }),
  kharnak_coliseum: L('kharnak', 'Brass gladiatorial coliseum', 5, 5, 2600, 5, { model: 'kharnak_coliseum', color: 0x8a8a86 }),
  kharnak_bronzeAltar: L('kharnak', 'Stepped altar of molten bronze', 3, 3, 900, 4, { model: 'kharnak_bronzeAltar', color: 0x8a8a86, volatile: 3 }),
  morbus_greenhouse: L('morbus', 'Greenhouse cathedral', 4, 5, 1800, 7, { model: 'morbus_greenhouse', color: 0x8a8a86, heals: 2 }),
  morbus_cauldronSpire: L('morbus', 'Bubbling cauldron-spire', 2, 2, 700, 7, { model: 'morbus_cauldronSpire', color: 0x8a8a86 }),
  labyrinth_invertedPyramid: L('labyrinth', 'Floating inverted pyramid', 4, 4, 2000, 8, { model: 'labyrinth_invertedPyramid', color: 0x8a8a86 }),
  labyrinth_spiralTower: L('labyrinth', 'Non-Euclidean spiral tower', 3, 3, 1300, 9, { model: 'labyrinth_spiralTower', color: 0x8a8a86 }),
  velvet_palace: L('velvet', 'Alabaster pleasure palace', 5, 4, 2000, 6, { model: 'velvet_palace', color: 0x8a8a86, heals: 1 }),
  velvet_organTower: L('velvet', 'Pipe-organ tower', 2, 2, 900, 9, { model: 'velvet_organTower', color: 0x8a8a86 }),
  malvash_smokestack: L('malvash', 'Smokestack cathedral', 4, 4, 2200, 9, { model: 'malvash_smokestack', color: 0x8a8a86, cargo: 4 }),
  malvash_soulFoundry: L('malvash', 'Soul-grinding foundry', 3, 3, 1100, 6, { model: 'malvash_soulFoundry', color: 0x8a8a86, volatile: 3 }),
  ashhorde_monolith: L('ashhorde', 'Obsidian monolith', 2, 2, 1200, 7, { model: 'ashhorde_monolith', color: 0x8a8a86 }),
  ashhorde_brazierTower: L('ashhorde', 'Burning brazier-tower', 2, 2, 800, 8, { model: 'ashhorde_brazierTower', color: 0x8a8a86 }),
  balor_basaltCrag: L('balor', 'Basalt crag-fortress', 5, 4, 3000, 7, { model: 'balor_basaltCrag', color: 0x8a8a86 }),
  balor_fogStones: L('balor', 'Fog-shrouded standing stones', 3, 3, 1200, 3, { model: 'balor_fogStones', color: 0x8a8a86, heals: 1 }),
  kurgan_wagonYurt: L('kurgan', 'Yurt on a wheeled platform', 4, 3, 600, 4, { model: 'kurgan_wagonYurt', color: 0x8a8a86 }),
  kurgan_burialMound: L('kurgan', 'Skull-topped kurgan mound', 4, 4, 1600, 3, { model: 'kurgan_burialMound', color: 0x8a8a86 }),
  hearthmoot_burrow: L('hearthmoot', 'Round-doored hillside burrow', 3, 3, 900, 3, { model: 'hearthmoot_burrow', color: 0x8a8a86, heals: 1 }),
  hearthmoot_watermill: L('hearthmoot', 'Watermill and bakery', 3, 3, 700, 5, { model: 'hearthmoot_watermill', color: 0x8a8a86, cargo: 4 }),
  baobab_baobabTree: L('baobab', 'Hollow baobab with platforms', 3, 3, 1400, 8, { model: 'baobab_baobabTree', color: 0x8a8a86 }),
  baobab_grassDome: L('baobab', 'Woven grass dome-hut', 2, 2, 160, 2, { model: 'baobab_grassDome', color: 0x8a8a86 }),
  nagavar_serpentTemple: L('nagavar', 'Serpent temple-complex', 5, 5, 2800, 8, { model: 'nagavar_serpentTemple', color: 0x8a8a86, heals: 2 }),
  nagavar_bloodWell: L('nagavar', 'Stepped blood-well', 3, 3, 600, 1, { model: 'nagavar_bloodWell', color: 0x8a8a86, cover: true }),
  pearlfleet_lighthouse: L('pearlfleet', 'White-marble lighthouse', 2, 2, 1000, 10, { model: 'pearlfleet_lighthouse', color: 0x8a8a86 }),
  pearlfleet_amphitheatre: L('pearlfleet', 'Tidal amphitheatre', 4, 4, 900, 2, { model: 'pearlfleet_amphitheatre', color: 0x8a8a86, cover: true }),
  glimmer_observatory: L('glimmer', 'Brass-domed observatory', 3, 3, 900, 6, { model: 'glimmer_observatory', color: 0x8a8a86 }),
  glimmer_windmillLab: L('glimmer', 'Windmill laboratory', 3, 3, 700, 7, { model: 'glimmer_windmillLab', color: 0x8a8a86, volatile: 2 }),
  khanate_skullTower: L('khanate', 'Horse-skull watchtower', 2, 2, 500, 7, { model: 'khanate_skullTower', color: 0x8a8a86 }),
  khanate_winterCamp: L('khanate', 'Timber-and-felt winter hall', 4, 4, 800, 4, { model: 'khanate_winterCamp', color: 0x8a8a86 }),
  emerald_sunTemple: L('emerald', 'Circular golden sun-temple', 4, 4, 2000, 7, { model: 'emerald_sunTemple', color: 0x8a8a86, heals: 2 }),
  emerald_riverCitadel: L('emerald', 'Vine-draped limestone citadel', 5, 5, 3000, 7, { model: 'emerald_riverCitadel', color: 0x8a8a86 }),
  deeproot_nestTree: L('deeproot', 'Titan tree of nest-huts', 3, 3, 1300, 9, { model: 'deeproot_nestTree', color: 0x8a8a86 }),
  deeproot_spiritTotem: L('deeproot', 'Carved spirit-totem', 1, 1, 300, 4, { model: 'deeproot_spiritTotem', color: 0x8a8a86 }),
  goldsands_palace: L('goldsands', 'Domed palace', 5, 5, 2600, 8, { model: 'goldsands_palace', color: 0x8a8a86 }),
  goldsands_souk: L('goldsands', 'Shaded souk', 4, 3, 700, 3, { model: 'goldsands_souk', color: 0x8a8a86, cargo: 6 }),
};
export const landmarksOf = (realm) => (LANDMARK_REALMS.has(realm) ? Object.keys(LANDMARKS).filter((k) => LANDMARKS[k].realm === realm) : []);
/** the landmark definitions that can be built now, for the structure table */
export const readyLandmarks = () => Object.fromEntries(Object.entries(LANDMARKS).filter(([, d]) => LANDMARK_REALMS.has(d.realm)));

// ------------------------------------------------------------------------------------------
// Air wings (src/data/air): eight aircraft per faction, built from a role template and a tier, and the
// faction's sky-behemoth. Every realm above and the seven original factions.
// ------------------------------------------------------------------------------------------
// the original factions are not in REALMS: their names, line troops and palettes
const ORIGINAL_AIR = {
  kingdom: { name: 'Kingdom', adj: 'Royal', troop: 'footman', P: { species: 'human', skin: HUMAN, cloth: 0x2f5aa8, cloth2: 0xd8c07a, armor: 0x9aa3ad, trim: 0xd8c07a } },
  goblin: { name: 'Goblin Horde', adj: 'Goblin', troop: 'hobgoblin', P: { species: 'goblin', skin: 0x6f9a3a, cloth: 0x5a4630, cloth2: 0x8a2c2c, armor: 0x6b6b6b, trim: 0xb8862a } },
  undead: { name: 'Undead', adj: 'Undead', troop: 'skeleton', P: { species: 'human', skin: 0xb8b8a8, cloth: 0x2a1f3a, cloth2: 0x5a5a4a, armor: 0x6a6a70, trim: 0x8aa88a } },
  infernal: { name: 'Infernal', adj: 'Infernal', troop: 'hellknight', P: { species: 'human', skin: 0x8a2a1a, cloth: 0x2a1a1a, cloth2: 0xd84a1a, armor: 0x3a2a2a, trim: 0xff8a2a } },
  beasts: { name: 'Beasts', adj: 'Wild', troop: 'wolf', P: { species: 'human', skin: TAN, cloth: 0x6b4a2e, cloth2: 0xb89a6a, armor: 0x5a4a3a, trim: 0xc8a050 } },
  elemental: { name: 'Elemental', adj: 'Elemental', troop: 'golem', P: { species: 'human', skin: 0x8a8a92, cloth: 0x6a8aa8, cloth2: 0x9ad8ff, armor: 0x7a7a82, trim: 0x9ad8ff } },
  dragons: { name: 'Dragons', adj: 'Dragon', troop: 'kobold', P: { species: 'human', skin: 0xb8862a, cloth: 0x5a2a22, cloth2: 0x8a3a2a, armor: 0x7a2a22, trim: 0xd8a040 } },
};
/** name, adjective, palette and line troop of any faction that has an air wing */
export function airFaction(id) {
  if (ORIGINAL_AIR[id]) return { id, ...ORIGINAL_AIR[id] };
  const f = REALMS.find((r) => r.id === id);
  if (!f) return null;
  let troop = null, bw = -1;
  for (const [rid, , , , mods = {}] of f.roster(mk(f.P))) if (mods.w && !mods.as && mods.w > bw) { bw = mods.w; troop = uid(f, rid); }
  return { id, name: f.name, adj: f.adj, troop, P: f.P };
}

// the role templates at medium tier; tiers scale them (hit points by k, the rest by its root)
const AIR_T = {
  transport: { hp: 95, def: 50, rng: 30, style: 'ranged', range: 5, speed: 5, move: 2, stamina: 600, projectile: 'bolt', priceMul: 1.25, bonus: { rngAtt: 20, rngStr: 15, defMelee: 50, defRanged: 45, defMagic: 15 } },
  bomber: { hp: 105, def: 50, rng: 40, style: 'ranged', range: 4, speed: 6, move: 2, stamina: 500, projectile: 'fire', priceMul: 1.35, bonus: { rngAtt: 30, rngStr: 30, defMelee: 45, defRanged: 45, defMagic: 10 } },
  fighter: { hp: 60, def: 40, rng: 55, style: 'ranged', range: 6, speed: 3, move: 3, stamina: 380, projectile: 'bolt', priceMul: 1.1, bonus: { rngAtt: 55, rngStr: 35, defMelee: 35, defRanged: 40, defMagic: 10 } },
  cas: { hp: 75, def: 45, rng: 50, style: 'ranged', range: 5, speed: 4, move: 2, stamina: 420, projectile: 'bolt', priceMul: 1.25, bonus: { rngAtt: 45, rngStr: 40, defMelee: 40, defRanged: 40, defMagic: 10 } },
  hunter: { hp: 85, att: 62, str: 64, def: 50, style: 'melee', speed: 4, move: 2, stamina: 400, priceMul: 1.15, abilities: [{ type: 'charge', mult: 1.4 }], bonus: { att: 55, str: 55, defMelee: 60, defRanged: 45, defMagic: 15 } },
  naval: { hp: 75, def: 45, rng: 48, style: 'ranged', range: 6, speed: 5, move: 2, stamina: 450, projectile: 'bolt', priceMul: 1.1, bonus: { rngAtt: 40, rngStr: 35, defMelee: 40, defRanged: 40, defMagic: 10 } },
  assault: { hp: 90, att: 60, str: 62, def: 55, style: 'melee', speed: 4, move: 2, stamina: 380, priceMul: 1.2, abilities: [{ type: 'charge', mult: 1.5 }], bonus: { att: 55, str: 55, defMelee: 65, defRanged: 50, defMagic: 10 } },
  escort: { hp: 70, def: 50, rng: 50, style: 'ranged', range: 6, speed: 3, move: 2, stamina: 600, projectile: 'arrow', priceMul: 1.05, bonus: { rngAtt: 45, rngStr: 30, defMelee: 45, defRanged: 50, defMagic: 15 } },
};
const AIR_TIER = { light: { k: 0.65, size: 1, count: 4 }, medium: { k: 1, size: 1, count: 3 }, heavy: { k: 1.6, size: 2, count: 2 } };
const BREATH_PROJ = { fire: 'fire', frost: 'frost', acid: 'poison', plague: 'poison', lightning: 'lightning', light: 'holy', warp: 'shadow', sound: 'shadow' };
const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const fillModel = (model, f) => {
  const m = { ...(model || { body: 'aircraft', kind: 'gyro' }) };
  for (const k of ['skin', 'cloth', 'cloth2', 'armor', 'trim']) if (m[k] === undefined && f.P[k] !== undefined) m[k] = f.P[k];
  if (m.body === 'rider' && m.species === undefined) m.species = f.P.species;
  if (m.mount === undefined) m.mount = f.P.cloth2 ?? f.P.armor;
  if (m.style === undefined) m.style = f.id;
  return m;
};

/** the flying units of every air wing: { `${faction}_air_${role}`: def } */
export function realmAirwings(BASE) {
  const out = {};
  for (const [fid, W] of Object.entries(AIRWINGS)) {
    const f = airFaction(fid);
    if (!f || !W) continue;
    for (const role of AIR_ROLES) {
      const D = W[role];
      if (!D) continue;
      const T = AIR_T[role], tier = AIR_TIER[D.tier] ? D.tier : 'medium', { k, size, count } = AIR_TIER[tier], r = Math.sqrt(k);
      const arts = { ...(D.arts || {}) };
      const u = { name: `${f.adj} ${D.name || role}`, category: f.name, realm: fid, fly: true, airRole: role, airArts: arts, airTier: tier, note: D.note || '',
        hp: Math.round(T.hp * k), att: 1, str: 1, def: Math.round(T.def * r), rng: 1, mag: 1, style: T.style, speed: T.speed, move: T.move, stamina: T.stamina, size,
        count: Math.round(num(D.count, 1, 8, count)), priceMul: T.priceMul, bonus: Object.fromEntries(Object.entries(T.bonus).map(([key, v]) => [key, Math.round(v * r)])),
        abilities: (T.abilities || []).map((a) => ({ ...a })), model: fillModel(D.model, f) };
      if (T.style === 'melee') { u.att = Math.round(T.att * r); u.str = Math.round(T.str * r); } else { u.rng = Math.round(T.rng * r); u.range = T.range; u.projectile = T.projectile; }
      if (role === 'cas' && arts.arrows) u.projectile = 'arrow';
      // arts any role may have
      if (arts.armour) { const a = arts.armour <= 10 ? arts.armour * 12 : Math.min(150, arts.armour); u.bonus.defMelee += a; u.bonus.defRanged += a; }
      if (arts.magicWard) u.abilities.push({ type: 'protect', style: 'magic', reduction: num(arts.magicWard, 0, 0.8, 0.3) });
      if (arts.regen) u.abilities.push({ type: 'regen', amount: Math.round(num(arts.regen, 1, 10, 2)), every: 4 });
      if (arts.poison) u.abilities.push({ type: 'poison', damage: Math.round(num(arts.poison, 1, 12, 3)), chance: 0.35 });
      if (arts.speed) { const s = num(arts.speed, 0.7, 1.4, 1); u.move = Math.max(1, Math.round(u.move * s)); u.stamina = Math.round(u.stamina * s); u.speed = Math.max(2, Math.round(u.speed / Math.sqrt(s))); }
      if (arts.breath) { u.abilities.push({ type: 'breath', every: 4, maxHit: Math.round(10 * r + 4), radius: 1 }); if (u.style !== 'melee') u.projectile = BREATH_PROJ[arts.breath] || u.projectile; u.breath = arts.breath; }
      if (role === 'transport') arts.troop = arts.troop && BASE[arts.troop] ? arts.troop : f.troop;
      // what the role brings besides its own fighting: troops set down, crates, bombs
      if (role === 'transport') u.priceMul = +(u.priceMul + 0.12 * num(arts.carry, 0, 0, 12) + 0.05 * num(arts.supply, 0, 0, 6) + (arts.extract ? 0.1 : 0)).toFixed(2);
      if (role === 'bomber') u.priceMul = +(u.priceMul + 0.04 * num(arts.bombs, 2, 1, 8) * num(arts.blast, 1.5, 1, 4) / 1.5).toFixed(2);
      if (role === 'assault' && arts.dropTroops) u.priceMul = +(u.priceMul + 0.08 * num(arts.dropCount, 3, 1, 8)).toFixed(2);
      if (role === 'assault' && arts.dropTroops && !BASE[arts.dropTroops]) arts.dropTroops = f.troop;
      out[`${fid}_air_${role}`] = u;
    }
  }
  return out;
}

// behemoth forms: length, hull, crew and how slow
const FORM = { airship: [24, 3200, 44, 0.34], citadel: [28, 4600, 60, 0.26], island: [30, 5000, 56, 0.22], hulk: [26, 4200, 52, 0.28], pyramid: [26, 4600, 48, 0.24],
  cathedral: [26, 4000, 50, 0.28], spire: [22, 3600, 42, 0.3], palace: [26, 4000, 54, 0.28], beast: [22, 3400, 40, 0.4], crag: [28, 4800, 50, 0.24] };
/** every air wing's sky-behemoth: { `${faction}Behemoth`: def }. `make` is the airship table's own constructor. */
export function realmBehemoths(make) {
  const out = {};
  for (const [fid, W] of Object.entries(AIRWINGS)) {
    const D = W && W.behemoth, f = D && airFaction(fid);
    if (!f) continue;
    const [len, hull, crew, speed] = FORM[D.form] || FORM.airship, look = D.look || {};
    const abilities = (D.abilities || []).filter((a) => a && a.kind).map((a) => ({ ...a }));
    const has = (k) => abilities.some((a) => a.kind === k);
    const hang = W.escort ? `${fid}_air_escort` : W.fighter ? `${fid}_air_fighter` : 'gyrocopter';
    out[`${fid}Behemoth`] = make({ name: `${f.adj} ${D.name || 'Behemoth'}`, faction: fid, style: fid, behemoth: true, note: D.note || '', form: D.form || 'airship', parts: D.parts || [], look,
      abilities, len, hull, crew, speed, turn: 6, armour: 60, altitude: 7.4, level: 99, marines: 1.6, priceMul: 1,
      color: look.hull ?? f.P.armor, envelope: look.envelope ?? look.trim ?? f.P.cloth, trim: look.trim ?? f.P.trim, glow: look.glow,
      cannons: { perSide: 8, dmg: [12, 32], range: 12, reload: 6, acc: 0.6 }, bombs: { maxHit: 60, radius: 3, reload: 11 },
      // the ability list does the launching and the dropping; the plain bays stay small when it does
      hangar: { unit: hang, count: has('hangar') ? 0 : 6, every: 30 }, pods: { unit: f.troop, pods: has('dropPods') ? 0 : 3, perPod: 4 },
      ladders: { capacity: 12, every: 50 } });
  }
  return out;
}
