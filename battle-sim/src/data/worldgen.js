// Procedural scenarios: a place (village, fort, castle, city, coastal town, harbour city,
// island stronghold) laid out in the building style of the faction that holds it, with a
// garrison inside and an attacking army sized to the defences. Everything it returns is an
// ordinary scenario, so the armies and the map stay editable afterwards.
import { generateTerrain, regionLayout, GRASS, SAND, FORD, isWater } from '../engine/terrain.js';
import { combatLevel } from '../engine/combat.js';
import { STRUCTURES } from './structures.js';
import { UNITS, leaderOf } from './units.js';
import { AIRSHIPS } from './airships.js';
import { SHIPS, CREATURES, FORTS, ROLE_SHIPS } from './naval.js';
import { realmFactions, LANDMARKS } from './realms.js';

const clampRow = (y, S) => Math.max(3, Math.min(S - 4, y));

// ---------- factions ----------
// wall: what the faction raises around a place that deserves walls.
// layout: how the inside is arranged. homes / small / camp: its buildings, big to small.
export const FACTIONS = {
  kingdom: {
    undersea: 'kingdomSub', name: 'Kingdom', adj: 'Kingdom', biomes: ['temperate', 'temperate', 'snow'],
    wall: 'rampart', strongWall: 'rampart', layout: 'streets', homes: 'house', small: 'hut', camp: 'tent', lookout: 'tower',
    deco: ['crates', 'statue', 'crates'], trees: ['tree', 'tree', 'pine'], guns: ['cannon', 'ballista', 'mortar'], shoreGun: 'battery',
    army: { footman: 0.24, longbow: 0.14, crossbow: 0.13, halberdier: 0.12, knight: 0.16, militia: 0.05, cleric: 0.05, battlemage: 0.06, paladin: 0.05, engineer: 0.03, pikeman: 0.1, scout: 0.04, grenadier: 0.05, warPriest: 0.04 },
    assault: { ram: 0.07, lancer: 0.08, griffon: 0.06 }, ships: ['frigate', 'cutter', 'galleon'],
    places: { village: 'village', fort: 'border fort', castle: 'castle', city: 'walled city', coast: 'fishing town', harbor: 'harbour city', island: 'island keep' },
  },
  goblin: {
    cost: 0.35, // price correction from trials against the Kingdom (twenty battles a step)
    undersea: 'goblinSub', name: 'Goblin Horde', adj: 'Goblin', biomes: ['swamp', 'desert', 'jungle', 'temperate'],
    wall: 'palisade', strongWall: 'palisade', layout: 'warren', homes: 'hut', small: 'tent', camp: 'tent', lookout: 'tower',
    deco: ['crates', 'barricade', 'crates'], trees: ['tree', 'pine'], guns: ['ballista', 'ballista', 'cannon'], shoreGun: 'harpoon',
    army: { goblin: 0.2, goblinArcher: 0.18, hobgoblin: 0.26, shaman: 0.08, warboss: 0.16, wolfRider: 0.12, tinker: 0.02, goblinSpear: 0.12, bomber: 0.06, trollShaman: 0.05 },
    assault: { sapper: 0.06, wolfRider: 0.08 }, ships: ['sloop', 'brigantine', 'skiff'],
    places: { village: 'warren', fort: 'stockade', castle: 'great stockade', city: 'shanty city', coast: 'wreckers\' cove', harbor: 'corsair haven', island: 'reef stockade' },
  },
  undead: {
    cost: 0.79, // price correction from trials against the Kingdom (twenty battles a step)
    undersea: 'undeadSub', name: 'Undead', adj: 'Undead', biomes: ['swamp', 'snow', 'temperate'],
    wall: 'ruin', strongWall: 'rampart', layout: 'necropolis', homes: 'keep', small: 'statue', camp: 'pillar', lookout: 'pillar',
    deco: ['statue', 'pillar', 'pillar'], trees: ['pine'], guns: ['mortar', 'ballista'], shoreGun: 'battery',
    army: { skeleton: 0.32, skeletonArcher: 0.2, ghoul: 0.14, necromancer: 0.1, boneColossus: 0.16, bat: 0.08, wight: 0.12, banshee: 0.05, plagueBearer: 0.08 },
    assault: { boneColossus: 0.08 }, ships: ['brigantine', 'cutter'],
    places: { village: 'graveyard', fort: 'barrow fort', castle: 'black keep', city: 'necropolis', coast: 'drowned chapel', harbor: 'ghost harbour', island: 'crypt isle' },
  },
  infernal: {
    cost: 2.15, // price correction from trials against the Kingdom (twenty battles a step)
    undersea: 'infernalSub', name: 'Infernal', adj: 'Infernal', biomes: ['volcanic'],
    wall: 'bastions', strongWall: 'rampart', layout: 'rings', homes: 'bastion', small: 'pillar', camp: 'rock', lookout: 'pillar',
    deco: ['pillar', 'statue', 'rock'], trees: [], guns: ['mortar', 'cannon'], shoreGun: 'battery',
    army: { imp: 0.16, pitFiend: 0.3, infernalLord: 0.2, fireElemental: 0.1, hellhound: 0.1, cultist: 0.06, hellknight: 0.16 },
    assault: { gargoyle: 0.08 }, ships: ['galleon', 'brigantine'],
    places: { village: 'ash shrine', fort: 'brimstone redoubt', castle: 'obsidian citadel', city: 'infernal city', coast: 'cinder shore', harbor: 'burning harbour', island: 'ember isle' },
  },
  beasts: {
    cost: 0.63, // price correction from trials against the Kingdom (twenty battles a step)
    undersea: 'megalodon', name: 'Beasts', adj: 'Wild', biomes: ['jungle', 'temperate', 'desert'],
    wall: 'ring', strongWall: 'palisade', layout: 'wild', homes: 'rock', small: 'tent', camp: 'tent', lookout: 'tower',
    deco: ['rock', 'barricade', 'crates'], trees: ['tree', 'tree', 'pine'], guns: [], shoreGun: null,
    army: { wolf: 0.14, spider: 0.12, troll: 0.18, ogre: 0.18, cyclops: 0.16, minotaur: 0.14, harpy: 0.08, alphaWolf: 0.08, broodmother: 0.08, ogreMage: 0.06 },
    assault: {}, ships: ['raft', 'skiff'],
    places: { village: 'den', fort: 'ogre camp', castle: 'giants\' hold', city: 'great lair', coast: 'troll shore', harbor: 'harpy cove', island: 'cyclops isle' },
  },
  elemental: {
    cost: 1.60, // price correction from trials against the Kingdom (twenty battles a step)
    undersea: 'seaElemental', name: 'Elemental', adj: 'Elemental', biomes: ['snow', 'volcanic', 'desert'],
    wall: 'ring', strongWall: 'ring', layout: 'rings', homes: 'pillar', small: 'statue', camp: 'rock', lookout: 'pillar',
    deco: ['pillar', 'rock', 'statue'], trees: ['pine'], guns: [], shoreGun: null,
    army: { golem: 0.28, gargoyle: 0.2, fireElemental: 0.16, iceWraith: 0.16, frostGolem: 0.14, stormElemental: 0.1 },
    assault: {}, ships: ['cutter'],
    places: { village: 'standing stones', fort: 'rune circle', castle: 'stone sanctum', city: 'city of pillars', coast: 'tide stones', harbor: 'drowned sanctum', island: 'rune isle' },
  },
  dragons: {
    cost: 1.22, // price correction from trials against the Kingdom (twenty battles a step)
    undersea: 'seaDragon', name: 'Dragons', adj: 'Dragon', biomes: ['volcanic', 'snow'],
    wall: 'ring', strongWall: 'ring', layout: 'wild', homes: 'rock', small: 'rock', camp: 'rock', lookout: 'pillar',
    deco: ['rock', 'pillar', 'statue'], trees: ['pine'], guns: [], shoreGun: null,
    army: { drake: 0.4, wyrmling: 0.25, whelp: 0.1, kobold: 0.1, dragonKnight: 0.15 },
    assault: {}, ships: ['frigate'],
    places: { village: 'nesting ground', fort: 'eyrie', castle: 'great eyrie', city: 'dragon roost', coast: 'sea eyrie', harbor: 'drake cove', island: 'dragon isle' },
  },
};
// the twenty-seven realms
const REALM_FACTIONS = realmFactions();
Object.assign(FACTIONS, REALM_FACTIONS);

// size: map tiles. points: garrison strength. edge: how much stronger the attackers come.
export const SITES = {
  village: { name: 'Village raid', mode: 'field', shape: ['plains', 'plains', 'lake', 'marsh', 'twinRivers', 'bay'], size: 96, points: 11000, edge: 1.15 },
  fort: { name: 'Fort assault', mode: 'field', shape: ['plains', 'plains', 'river', 'isthmus', 'twinRivers', 'marsh'], size: 96, points: 15000, edge: 1.5 },
  castle: { name: 'Castle siege', mode: 'field', shape: ['plains', 'plains', 'isthmus', 'bay'], size: 112, points: 21000, edge: 1.9 },
  city: { name: 'City siege', mode: 'field', shape: ['plains', 'river', 'bay'], size: 144, points: 36000, edge: 1.6 },
  coast: { name: 'Coastal settlement landing', mode: 'amphibious', shape: ['coast', 'coast', 'fjord'], size: 112, points: 14000, edge: 1.2 },
  harbor: { name: 'Harbour city assault', mode: 'amphibious', shape: ['harbor'], size: 128, points: 24000, edge: 1.4 },
  sea: { name: 'Sea battle', mode: 'naval', shape: ['sea'], size: 210, points: 0, edge: 1 },
  ctf: { name: 'Capture the flag', mode: 'field', shape: ['plains'], size: 112, points: 12000, edge: 1 },
  island: { name: 'Island stronghold', mode: 'amphibious', shape: ['island', 'island', 'peninsula'], size: 112, points: 16000, edge: 1.3 },
  // the big maps: three villages, two forts and a city with its castle
  region: { name: 'Borderland war', mode: 'field', shape: ['region'], size: 256, points: 150000, edge: 1.15, big: true },
  isles: { name: 'Island campaign', mode: 'amphibious', shape: ['isles'], size: 256, points: 150000, edge: 1.2, big: true },
};

// ---------- helpers ----------
function rng32(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  return next;
}

const footprint = (type, rot = 0, len = 0, wid = 0) => {
  const d = STRUCTURES[type];
  const l = d.stretch && len ? len : d.w, w2 = d.stretch2 && wid ? wid : d.h;
  return rot % 2 ? [w2, l] : [l, w2];
};

// Keeps track of what is built where, so nothing overlaps and roads stay open.
class Plan {
  constructor(size, terrain, rng) {
    this.S = size; this.t = terrain; this.r = rng;
    this.occ = new Uint8Array(size * size); // 1 = built, 2 = road kept clear
    this.paths = new Uint8Array(size * size); // roads and squares, for drawing
    this.out = [];
  }
  land(x, y) { return x >= 1 && y >= 1 && x < this.S - 1 && y < this.S - 1 && this.t[y * this.S + x] === GRASS; }
  free(x, y, w, h, gap = 0) {
    for (let j = y - gap; j < y + h + gap; j++) for (let i = x - gap; i < x + w + gap; i++) {
      const inside = i >= x && i < x + w && j >= y && j < y + h;
      if (i < 0 || j < 0 || i >= this.S || j >= this.S) { if (inside) return false; continue; }
      const o = this.occ[j * this.S + i];
      if (inside ? o !== 0 || !this.land(i, j) : o === 1) return false;
    }
    return true;
  }
  mark(x, y, w, h, v = 1) {
    for (let j = Math.max(0, y); j < Math.min(this.S, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.S, x + w); i++) if (v === 1 || !this.occ[j * this.S + i]) this.occ[j * this.S + i] = v;
  }
  /** place if it fits; gap keeps that many clear tiles around it */
  put(type, x, y, extra = {}, gap = 0) {
    const [w, h] = footprint(type, extra.rot, extra.len, extra.wid);
    if (!this.free(x, y, w, h, gap)) return false;
    this.mark(x, y, w, h);
    this.out.push({ type, x, y, rot: 0, ...extra });
    return true;
  }
  /** place on dry land even over a reserved road (walls and gates must close the ring) */
  force(type, x, y, extra = {}) {
    const [w, h] = footprint(type, extra.rot, extra.len, extra.wid);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (i < 0 || j < 0 || i >= this.S || j >= this.S) return false;
      if (this.occ[j * this.S + i] === 1 || (this.t[j * this.S + i] !== GRASS && this.t[j * this.S + i] !== SAND)) return false;
    }
    this.mark(x, y, w, h);
    this.out.push({ type, x, y, rot: 0, ...extra });
    return true;
  }
  road(x, y, w, h) {
    this.mark(x, y, w, h, 2);
    for (let j = Math.max(0, y); j < Math.min(this.S, y + h); j++) for (let i = Math.max(0, x); i < Math.min(this.S, x + w); i++) if (this.t[j * this.S + i] === GRASS || this.t[j * this.S + i] === SAND) this.paths[j * this.S + i] = 1;
  }
  /** try `tries` random spots inside a rectangle */
  scatter(type, rect, count, gap = 1, extra = {}, tries = 14) {
    let done = 0;
    const [w, h] = footprint(type, extra.rot);
    for (let k = 0; k < count * tries && done < count; k++) {
      const x = this.r.int(rect.x, Math.max(rect.x, rect.x + rect.w - w)), y = this.r.int(rect.y, Math.max(rect.y, rect.y + rect.h - h));
      if (this.put(type, x, y, typeof extra === 'function' ? extra() : extra, gap)) done++;
    }
    return done;
  }
}

// ---------- walls ----------
// Stone ramparts with corner and mid towers, wall-walks, gates and stairs. gates: faces that get a gate.
function rampart(p, x, y, w, h, side, gates) {
  const T = 3;
  const add = (type, ax, ay, extra = {}) => p.force(type, ax, ay, { side, ...extra });
  for (const [tx, ty] of [[x, y], [x + w - T, y], [x, y + h - T], [x + w - T, y + h - T]]) add('castleTower', tx, ty);
  // one face: a run of wall between the corner towers, broken by a gate and mid towers
  const face = (fx, fy, rot, run, gated, inner) => {
    const feats = []; // [offset, width, kind]
    if (gated) feats.push([Math.floor((run - 3) / 2), 3, 'gate']);
    const mids = run > 44 ? [1 / 4, 3 / 4] : run > 26 && !gated ? [1 / 2] : run > 30 ? [1 / 5, 4 / 5] : [];
    for (const f of mids) feats.push([Math.floor(run * f) - 1, 3, 'tower']);
    feats.sort((a, c) => a[0] - c[0]);
    let at = 0;
    const wall = (from, to) => {
      for (let s = from; s < to; s += 40) {
        const len = Math.min(40, to - s);
        if (len <= 0 || add('castleWall', rot ? fx : fx + s, rot ? fy + s : fy, { rot, len })) continue;
        // something in the way (a river, a canal): build it in short lengths, leaving only the gap it needs
        for (let q = s; q < s + len; q++) add('castleWall', rot ? fx : fx + q, rot ? fy + q : fy, { rot, len: 1 });
      }
    };
    for (const [o, wd, kind] of feats) {
      wall(at, o);
      if (kind === 'gate') add('castleGate', rot ? fx : fx + o, rot ? fy + o : fy, { rot });
      else add('castleTower', rot ? fx - inner : fx + o, rot ? fy + o : fy - inner);
      at = o + wd;
    }
    wall(at, run);
  };
  face(x + T, y, 0, w - 2 * T, gates.includes('north'), 0);
  face(x + T, y + h - 1, 0, w - 2 * T, gates.includes('south'), 2);
  face(x, y + T, 1, h - 2 * T, gates.includes('west'), 0);
  face(x + w - 1, y + T, 1, h - 2 * T, gates.includes('east'), 2);
  add('stairs', x + T + 1, y + 1);
  add('stairs', x + w - T - 3, y + h - 2);
  add('stairs', x + 1, y + h - T - 3, { rot: 1 });
  add('stairs', x + w - 2, y + T + 1, { rot: 1 });
  if (w > 40) { add('stairs', x + Math.floor(w / 2) + 4, y + 1); add('stairs', x + Math.floor(w / 2) - 6, y + h - 2); }
}

// A ring of 4-tile pieces (palisade or broken stone wall) with gate gaps and lookouts at the corners.
function fence(p, x, y, w, h, side, gates, type, missing, lookout) {
  const gapAt = (run) => Math.floor((run - 4) / 2);
  const line = (fx, fy, rot, run, gated) => {
    for (let s = 0; s + 4 <= run; s += 4) {
      if (gated && s + 4 > gapAt(run) && s < gapAt(run) + 4) continue;
      if (missing && p.r.chance(missing)) continue;
      p.force(type, rot ? fx : fx + s, rot ? fy + s : fy, { rot });
    }
  };
  line(x, y, 0, w, gates.includes('north'));
  line(x, y + h - 1, 0, w, gates.includes('south'));
  line(x, y + 1, 1, h - 2, gates.includes('west'));
  line(x + w - 1, y + 1, 1, h - 2, gates.includes('east'));
  if (lookout) for (const [tx, ty] of [[x + 1, y + 1], [x + w - 3, y + 1], [x + 1, y + h - 3], [x + w - 3, y + h - 3]]) p.put(lookout, tx, ty, lookout === 'tower' ? { side } : {});
}

// A loose ring of boulders or standing stones.
function stoneRing(p, cx, cy, r, type, step = 0.34, skipWest = true) {
  for (let a = 0; a < Math.PI * 2; a += step / Math.max(1, r / 8)) {
    if (skipWest && Math.abs(a - Math.PI) < 0.3) continue; // the way in
    p.put(type, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
  }
}

// Gun bastions at the corners with stone walls between: a low artillery fort.
function bastionFort(p, x, y, w, h, side) {
  for (const [bx, by] of [[x, y], [x + w - 4, y], [x, y + h - 4], [x + w - 4, y + h - 4]]) p.force('bastion', bx, by);
  const line = (fx, fy, rot, run, gated) => {
    for (let s = 0; s + 4 <= run; s += 4) {
      if (gated && Math.abs(s + 2 - run / 2) < 3) continue;
      p.force('wall', rot ? fx : fx + s, rot ? fy + s : fy, { rot });
    }
  };
  line(x + 4, y + 1, 0, w - 8, false); line(x + 4, y + h - 2, 0, w - 8, false);
  line(x + 1, y + 4, 1, h - 8, true); line(x + w - 2, y + 4, 1, h - 8, false);
  void side;
}

function enclose(p, kind, R, side, gates, F) {
  if (kind === 'rampart') rampart(p, R.x, R.y, R.w, R.h, side, gates);
  else if (kind === 'palisade') fence(p, R.x, R.y, R.w, R.h, side, gates, 'palisade', 0, F.lookout === 'tower' ? 'tower' : null);
  else if (kind === 'ruin') fence(p, R.x, R.y, R.w, R.h, side, gates, 'wall', 0.3, 'pillar');
  else if (kind === 'bastions') bastionFort(p, R.x, R.y, R.w, R.h, side);
  else if (kind === 'ring') stoneRing(p, R.x + R.w / 2, R.y + R.h / 2, Math.min(R.w, R.h) / 2, F.homes === 'pillar' ? 'pillar' : 'rock');
}

// ---------- insides ----------
const inner = (R, m) => ({ x: R.x + m, y: R.y + m, w: R.w - 2 * m, h: R.h - 2 * m });

// Streets on a grid: blocks of houses with lanes between, a square with a statue in the middle.
function streets(p, R, F, density) {
  const cx = R.x + (R.w >> 1), cy = R.y + (R.h >> 1);
  p.road(R.x, cy - 1, R.w, 3); p.road(cx - 1, R.y, 3, R.h); // high street and cross street
  const plaza = Math.max(3, Math.round(Math.min(R.w, R.h) / 9));
  p.road(cx - plaza, cy - plaza, plaza * 2 + 1, plaza * 2 + 1);
  p.out.push({ type: 'statue', x: cx, y: cy, rot: 0 }); p.mark(cx, cy, 1, 1);
  for (const [dx, dy] of [[-plaza, -plaza], [plaza, -plaza], [-plaza, plaza], [plaza, plaza]]) { p.out.push({ type: 'pillar', x: cx + dx, y: cy + dy, rot: 0 }); p.mark(cx + dx, cy + dy, 1, 1); }
  for (let y = R.y + 1; y + 3 <= R.y + R.h; y += 5) for (let x = R.x + 1; x + 3 <= R.x + R.w; x += 5) {
    if (!p.r.chance(density)) continue;
    const big = p.r.chance(0.72);
    if (big) p.put(F.homes, x, y, {}, 1) || p.put(F.small, x, y, {}, 1);
    else { p.put(F.small, x + p.r.int(0, 1), y + p.r.int(0, 1), {}, 1); if (p.r.chance(0.4)) p.put('crates', x + 2, y + 2); }
  }
}

// A goblin warren: huts and tents crowded in rings round a chieftain's fire, with clutter everywhere.
function warren(p, R, F, density) {
  const cx = R.x + (R.w >> 1), cy = R.y + (R.h >> 1);
  p.road(R.x, cy - 1, R.w, 2);
  p.road(cx - 2, cy - 2, 5, 5);
  const n = Math.round((R.w * R.h) / 26 * density);
  p.scatter(F.homes, R, Math.round(n * 0.55), 1);
  p.scatter(F.small, R, Math.round(n * 0.45), 1);
  p.scatter('crates', R, Math.round(n * 0.3), 0);
  p.scatter('barricade', R, Math.round(n * 0.12), 1, () => ({ rot: p.r.int(0, 1) }));
  if (R.w > 24) p.scatter('tower', inner(R, 3), Math.round(n / 14), 2, { side: 1 });
}

// A city of the dead: avenues of pillars and statues leading to mausoleums.
function necropolis(p, R, F, density) {
  const cx = R.x + (R.w >> 1), cy = R.y + (R.h >> 1);
  p.road(R.x, cy - 1, R.w, 3);
  for (let x = R.x + 2; x < R.x + R.w - 2; x += 4) { p.put('pillar', x, cy - 3); p.put('pillar', x, cy + 3); }
  if (R.w >= 16 && R.h >= 16) p.put('keep', cx - 2, cy - (R.h >> 2) - 5, {}, 1) || p.put('keep', cx - 2, R.y + 2, {}, 1);
  if (R.w >= 34) p.put('keep', cx - 2, cy + (R.h >> 2), {}, 1);
  const n = Math.round((R.w * R.h) / 30 * density);
  for (let y = R.y + 2; y < R.y + R.h - 2; y += 3) for (let x = R.x + 2; x < R.x + R.w - 2; x += 3) {
    if (Math.abs(y - cy) < 5 || !p.r.chance(density * 0.5)) continue;
    p.put(p.r.chance(0.6) ? 'statue' : 'pillar', x, y); // rows of grave markers
  }
  p.scatter('wall', R, Math.round(n * 0.12), 1, () => ({ rot: p.r.int(0, 1) }));
  p.scatter('crates', R, Math.round(n * 0.08), 0);
}

// Rings of standing stones or brimstone pillars round a central platform.
function rings(p, R, F, density) {
  const cx = R.x + (R.w >> 1), cy = R.y + (R.h >> 1), rad = Math.min(R.w, R.h) / 2 - 2;
  p.road(R.x, cy - 1, R.w >> 1, 3);
  if (rad >= 7) p.put(F.homes === 'bastion' ? 'bastion' : 'statue', cx - (F.homes === 'bastion' ? 2 : 0), cy - (F.homes === 'bastion' ? 2 : 0));
  for (let r = 4 + (F.homes === 'bastion' ? 3 : 0), k = 0; r < rad; r += 5, k++) stoneRing(p, cx, cy, r, k % 2 ? F.small : 'pillar', 0.5);
  const n = Math.round((R.w * R.h) / 60 * density);
  p.scatter('rock', R, n, 1);
  if (F.homes === 'bastion' && R.w > 30) { p.put('bastion', R.x + 3, R.y + 3, {}, 1); p.put('bastion', R.x + R.w - 7, R.y + R.h - 7, {}, 1); p.put('bastion', R.x + 3, R.y + R.h - 7, {}, 1); p.put('bastion', R.x + R.w - 7, R.y + 3, {}, 1); }
}

// A lair: boulders, bone piles (crates), rough shelters and trees left standing.
function wild(p, R, F, density) {
  const n = Math.round((R.w * R.h) / 34 * density);
  p.road(R.x, R.y + (R.h >> 1) - 1, R.w >> 1, 3);
  p.scatter('rock', R, Math.round(n * 0.5), 1);
  if (F.small !== 'rock') p.scatter(F.small, R, Math.round(n * 0.3), 1);
  p.scatter('barricade', R, Math.round(n * 0.14), 1, () => ({ rot: p.r.int(0, 1) }));
  p.scatter('crates', R, Math.round(n * 0.14), 0);
  for (const t of F.trees) p.scatter(t, R, Math.round(n * 0.2), 0);
  if (F.lookout === 'tower') p.scatter('tower', R, Math.max(1, Math.round(n / 16)), 2, { side: 1 });
  else p.scatter('pillar', R, Math.round(n * 0.2), 1);
}

const LAYOUTS = { streets, warren, necropolis, rings, wild };

const FACTION_OWN = new Set([...Object.keys(LANDMARKS), 'scrapHut', 'warDrum', 'brewery', 'crypt', 'boneSpire', 'charnel', 'forge', 'obelisk', 'pitGate', 'yurt', 'totem', 'bonePit', 'crystalSpire', 'monolith', 'stoneRing', 'nest', 'perch', 'hoard']);
// Which civic buildings each faction raises.
const CIVIC = {
  ...Object.fromEntries(Object.entries(REALM_FACTIONS).map(([k, v]) => [k, v.civic])),
  kingdom: ['marketHall', 'stall', 'bank', 'inn', 'garden', 'fountain', 'barracks', 'temple', 'shrine', 'alchemist', 'graveyard', 'palace'],
  goblin: ['marketHall', 'stall', 'inn', 'barracks', 'shrine', 'alchemist', 'graveyard', 'scrapHut', 'warDrum', 'brewery'],
  undead: ['temple', 'shrine', 'graveyard', 'alchemist', 'palace', 'garden', 'crypt', 'boneSpire', 'charnel'],
  infernal: ['temple', 'shrine', 'alchemist', 'barracks', 'palace', 'fountain', 'forge', 'obelisk', 'pitGate'],
  beasts: ['shrine', 'graveyard', 'stall', 'yurt', 'totem', 'bonePit'],
  elemental: ['shrine', 'temple', 'garden', 'fountain', 'crystalSpire', 'monolith', 'stoneRing'],
  dragons: ['shrine', 'graveyard', 'nest', 'perch', 'hoard'],
};

// Districts for the main part of a settlement. Returns true when it built an upper town on terraces.
function civic(p, R, o) {
  const { siteId, defId, r, town, S, cy, sea, shoreRow, rampart, noUpper } = o;
  const has = new Set(CIVIC[defId] || []);
  const cx = R.x + (R.w >> 1), my = R.y + (R.h >> 1);
  const area = R.w * R.h, big = siteId === 'city' || siteId === 'harbor', mid = big || siteId === 'castle' || siteId === 'coast';
  // try the wanted spot, then spiral out a little
  const nearPut = (type, x, y, extra = {}, gap = 1) => {
    if (!has.has(type) && !['terrace', 'stairs', 'cableTower', 'dockhouse'].includes(type)) return false;
    for (let rad = 0; rad <= 7; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      if (p.put(type, x + dx, y + dy, typeof extra === 'function' ? extra() : extra, gap)) return [x + dx, y + dy];
    }
    return false;
  };
  // the high street, the cross street and the square stay open
  p.road(R.x, my - 1, R.w, 3); p.road(cx - 1, R.y, 3, R.h);
  const plaza = Math.max(3, Math.round(Math.min(R.w, R.h) / 9));
  p.road(cx - plaza, my - plaza, plaza * 2 + 1, plaza * 2 + 1);

  let levelled = false;
  if (!noUpper && (big || siteId === 'castle') && R.w >= 26 && R.h >= 30 && (has.has('palace') || has.has('temple'))) {
    // The upper town: a terrace over the eastern part, a higher one for the palace, an elevated walkway
    // in from the west wall, a rail viaduct in from the east, and a cable car up from the square.
    levelled = true;
    const tw = Math.max(12, Math.round((R.w * 0.42) / 4) * 4), th = Math.max(16, Math.round((R.h * 0.46) / 4) * 4);
    const tx = R.x + R.w - tw - 1, ty = my - (th >> 1);
    p.out.push({ type: 'terrace', x: tx, y: ty, rot: 0, len: tw, wid: th, side: 1 });
    const hw = big ? 12 : 8, hh = big ? 12 : 8, hx = tx + tw - hw - 1, hy = my - (hh >> 1);
    p.out.push({ type: 'terraceHigh', x: hx, y: hy, rot: 0, len: hw, wid: hh, side: 1 });
    p.road(tx, my - 1, tw - hw - 1, 3);
    if (!(big && has.has('palace') && p.put('palace', hx + ((hw - 7) >> 1), hy + ((hh - 6) >> 1), { side: 1 }, 0))) (has.has('temple') && p.put('temple', hx + ((hw - 4) >> 1), hy + ((hh - 5) >> 1), { side: 1 }, 0)) || p.put('keep', hx + ((hw - 5) >> 1), hy + ((hh - 5) >> 1), { side: 1 }, 0);
    for (const dy of [-1, 0, 1]) p.put('stairs', tx - 2, my + dy * 6, { side: 1 }, 0);
    if (rampart) {
      // from the wall-walk over the street to the upper town
      const wy = my - plaza - 3, x0 = town.x + 1, len = Math.min(40, hx - x0);
      if (len > 4) { p.out.push({ type: 'walkway', x: x0, y: wy, rot: 0, len, side: 1 }); p.road(x0, wy, len, 1); }
      const wy2 = my + plaza + 3, len2 = Math.min(40, tx - x0);
      if (len2 > 4) { p.out.push({ type: 'walkway', x: x0, y: wy2, rot: 0, len: len2, side: 1 }); p.road(x0, wy2, len2, 1); }
    }
    // the viaduct comes in over the east wall with two wagons standing on it
    const vy = Math.min(ty + th - 2, hy + hh + 2), vx = tx + tw;
    for (let x = vx; x < S - 2; x += 40) p.out.push({ type: 'viaduct', x, y: vy, rot: 0, len: Math.min(40, S - 2 - x), side: 1 });
    for (let k2 = 0; k2 < 2; k2++) p.out.push({ type: 'railCar', x: S - 7 - k2 * 4, y: vy, rot: 0, side: 1 });
    p.road(vx, vy, S - vx, 1);
    // cable car from the square up to the palace terrace
    const lo = nearPut('cableTower', cx + plaza + 2, my + plaza + 2, { side: 1, cable: 1, stop: 0 }, 1);
    if (lo && !p.put('cableTower', hx + 1, hy + hh - 3, { side: 1, cable: 1, stop: 50 }, 0)) p.out[p.out.length - 1].cable = undefined;
    else if (lo) { const a = p.out.length - 2, c = p.out.length - 1; [p.out[a], p.out[c]] = [p.out[c], p.out[a]]; } // the upper tower is the delivery end
  }

  // the market on the square
  if (area > 500 && nearPut('marketHall', cx + plaza + 1, my - plaza - 4, { side: 1 })) for (let i = 0; i < (big ? 8 : 4); i++) nearPut('stall', cx + (i % 2 ? plaza + 1 : -plaza - 2), my + (i < 4 ? -1 : 1) * (2 + (i >> 1) * 2) - (i % 2), { rot: 1, side: 1 }, 0);
  if (mid) nearPut('fountain', cx - plaza + 1, my + plaza - 2);
  if (mid) nearPut('bank', cx - plaza - 5, my - plaza - 5, { side: 1 });
  nearPut('inn', R.x + 3, my + 3, { side: 1 });
  if (big) nearPut('inn', cx + 3, R.y + R.h - 6, { side: 1 });
  // the temple quarter with its graveyard
  const t = nearPut(area > 700 ? 'temple' : 'shrine', R.x + 3, R.y + 3, { side: 1 });
  if (t) nearPut('graveyard', t[0] + 6, t[1], {}, 0);
  if (area > 300) nearPut('barracks', R.x + 3, my - 8, { side: 1 });
  if (big) nearPut('barracks', R.x + 3, R.y + R.h - 7, { side: 1 });
  if (mid || area > 600) nearPut('alchemist', R.x + (R.w >> 2), R.y + R.h - 6, { side: 1 });
  for (let i = 0, n = big ? 4 : mid ? 2 : 1; i < n; i++) nearPut('garden', R.x + 4 + r.int(0, Math.max(1, R.w - 10)), R.y + 4 + r.int(0, Math.max(1, R.h - 10)), {}, 1);
  for (let i = 0, n = big ? 3 : 1; i < n; i++) nearPut('shrine', R.x + 2 + r.int(0, Math.max(1, R.w - 6)), R.y + 2 + r.int(0, Math.max(1, R.h - 6)), { side: 1 }, 1);
  if (!t) nearPut('graveyard', R.x + 2, R.y + R.h - 6, {}, 0);
  // the faction's own buildings, scattered through the place
  const own = (CIVIC[defId] || []).filter((c) => FACTION_OWN.has(c));
  own.forEach((type, i) => { for (let k2 = 0, n = Math.max(1, Math.round(area / (STRUCTURES[type].w > 1 ? 420 : 200))); k2 < Math.min(n, STRUCTURES[type].w >= 5 ? 1 : STRUCTURES[type].w >= 4 ? 2 : 5); k2++) nearPut(type, R.x + 3 + r.int(0, Math.max(1, R.w - 8)), R.y + 3 + r.int(0, Math.max(1, R.h - 8)), { side: 1 }, 1); void i; });
  // warehouses along the waterfront
  if (sea && shoreRow) for (let i = 0, n = siteId === 'harbor' ? 4 : 2; i < n; i++) {
    const y = Math.round(R.y + 4 + ((R.h - 8) * (i + 0.5)) / n);
    if (shoreRow[y] > 0) nearPut('dockhouse', shoreRow[y] + 3, y, { side: 1 }, 1);
  }
  void cy; void S;
  return levelled;
}

// ---------- armies ----------
// Stronger units cost more than their level alone suggests, so price rises faster than level.
const priceOf = (id) => Math.pow(combatLevel(UNITS[id]), 1.45) * (UNITS[id].fly ? 1.15 : 1);
// ---------- sea battles ----------
// Open water with islands, some of them fortified; two fleets drawn from their factions' own hulls, each with a
// diving boat (or the beast that does that work) and a few sea monsters bound to it. In the far north the sea is
// part frozen: pack ice and bergs that ships must steer round, and the hunters of the cold water.
const seaPrice = (d) => Math.pow(d.level || 30, 1.7);
const SEA_BEASTS = ['shark', 'eel', 'siren', 'serpent', 'kraken', 'megalodon', 'seaDragon', 'seaElemental', 'ironshell', 'abyssalMaw', 'coilSerpent', 'behemoth', 'triton', 'leviathan',
  'dunkleosteus', 'leedsichthys', 'tylosaurus', 'shonisaurus', 'kronosaurus', 'elasmosaurus', 'tusoteuthis', 'orthoceras', 'xiphactinus', 'styxosaurus'];
const ICE_BEASTS = ['tuskWalrus', 'orca', 'narwhal', 'iceKraken', 'polarSerpent', 'bergTitan', 'styxosaurus', 'behemoth'];
// every sea has its own hunters
const WATERS = {
  arctic: ICE_BEASTS,
  temperate: ['shark', 'eel', 'siren', 'serpent', 'kraken', 'megalodon', 'behemoth', 'triton', 'leviathan', 'elasmosaurus', 'xiphactinus', 'seaElemental', 'coilSerpent'],
  desert: ['reefDrake', 'sandCrab', 'ironshell', 'dunkleosteus', 'orthoceras', 'tusoteuthis', 'kronosaurus', 'seaElemental', 'shark', 'triton'],
  swamp: ['bogLurker', 'mireEel', 'tylosaurus', 'coilSerpent', 'leedsichthys', 'abyssalMaw', 'crab', 'siren', 'eel'],
  volcanic: ['cinderSerpent', 'magmaCrab', 'seaDragon', 'ironshell', 'abyssalMaw', 'dunkleosteus', 'kraken', 'orthoceras'],
  jungle: ['riverTyrant', 'lagoonSquid', 'shonisaurus', 'tylosaurus', 'styxosaurus', 'elasmosaurus', 'leedsichthys', 'megalodon', 'siren', 'xiphactinus', 'serpent'],
};
export const SEA_THEMES = { temperate: 'The grey sea', arctic: 'The frozen sea', desert: 'The burning coast', swamp: 'The drowned marshes', volcanic: 'The sea of fire', jungle: 'The green lagoons' };
const PACKS = { xiphactinus: 3, orca: 3, narwhal: 4, shark: 4, eel: 3, crab: 5, mireEel: 3, sandCrab: 4 };
const COLD = new Set(['velikaya', 'fimbul', 'grom', 'undead', 'elemental']);

function generateNaval({ r, seed, defId, attId, D, A, theme }) {
  const W = 210, H = 135;
  // the sea takes after the lands of those who fight on it, unless one was asked for
  let env = SEA_THEMES[theme] ? theme : null;
  if (!env) {
    if ((COLD.has(defId) || COLD.has(attId)) && r.chance(0.6)) env = 'arctic';
    else { const b2 = r.pick([...D.biomes, ...A.biomes, 'temperate']); env = b2 === 'snow' ? 'arctic' : b2; }
  }
  const arctic = env === 'arctic';
  const islands = [], forts = [];
  const clear = (x, y, rad, gap = 6) => islands.every((i) => Math.hypot(i.x - x, i.y - y) > i.r + rad + gap);
  // islands: a few big ones and a scatter of small, kept out of the two fleets' forming-up water
  const nIsl = r.int(4, 8);
  for (let k = 0, tries = 0; k < nIsl && tries < 200; tries++) {
    const rad = k < 2 ? r.int(7, 10) : r.int(3, 6), x = r.int(46, W - 46), y = r.int(12, H - 12);
    if (!clear(x, y, rad)) continue;
    islands.push({ x, y, r: rad }); k++;
  }
  // the sea of fire: one or two islands are live volcanoes, which nobody garrisons
  if (env === 'volcanic') {
    const mid = islands.filter((i) => i.x > W * 0.3 && i.x < W * 0.7).sort((a, c) => c.r - a.r);
    for (const isl of (mid.length ? mid : islands).slice(0, r.int(1, 2))) { isl.volcano = true; isl.r = Math.max(isl.r, 8); }
  }
  // forts: the defenders (side 1, to the east) hold the islands on their side of the sea; the attackers may hold one of theirs
  const fortify = (isl, side, strong) => {
    const toward = side === 1 ? Math.PI : 0; // guns face the enemy
    if (isl.r <= 5 && strong) { forts.push({ type: 'seaFort', x: isl.x, y: isl.y, side }); return; }
    const kinds = strong ? ['battery', 'battery', 'mortar', 'harpoon'] : r.chance(0.5) ? ['battery', 'harpoon'] : ['battery'];
    kinds.forEach((type, i) => {
      const a = toward + (i - (kinds.length - 1) / 2) * 0.9;
      forts.push({ type, x: Math.round(isl.x + Math.cos(a) * (isl.r - 1.5)), y: Math.round(isl.y + Math.sin(a) * (isl.r - 1.5)), side });
    });
  };
  const east = islands.filter((i) => i.x > W * 0.52 && !i.volcano).sort((a, c) => c.r - a.r), west = islands.filter((i) => i.x < W * 0.42 && !i.volcano);
  east.slice(0, r.int(1, 3)).forEach((isl, i) => fortify(isl, 1, i === 0));
  if (west.length && r.chance(0.45)) fortify(r.pick(west), 0, false);
  // the frozen sea: a field of pack ice across part of the map, bergs adrift, and floes round the islands
  if (arctic) {
    const band = r.chance(0.5) ? 'north' : 'south', cy = band === 'north' ? H * 0.2 : H * 0.8;
    for (let k = 0, tries = 0, n = r.int(12, 18); k < n && tries < 400; tries++) {
      const rad = r.int(3, 7), x = r.int(34, W - 34), y = Math.round(cy + (r() - 0.5) * H * 0.34);
      if (y < 5 || y > H - 5 || !clear(x, y, rad, 1.5)) continue;
      islands.push({ x, y, r: rad, ice: true }); k++;
    }
    for (let k = 0, tries = 0, n = r.int(6, 11); k < n && tries < 300; tries++) {
      const rad = r.pick([1.5, 2, 2.5, 3]), x = r.int(36, W - 36), y = r.int(8, H - 8);
      if (!clear(x, y, rad, 3)) continue;
      islands.push({ x, y, r: rad, ice: true, berg: true }); k++;
    }
  }
  // fleets
  const fleet = (id, F, budget, foeId, mySide) => {
    const groups = [], add = (unit, count) => { const g = groups.find((x) => x.unit === unit); if (g) g.count += count; else groups.push({ unit, count }); };
    const hulls = F.ships.map((k) => SHIPS[k]).filter(Boolean).sort((a, c) => (c.level || 0) - (a.level || 0));
    let left = budget;
    const buy = (d, n = 1) => { add(d.id, n); left -= seaPrice(d) * n; };
    // what goes beneath: a diving boat or two, or the beast that serves for one
    const u = SHIPS[F.undersea] || CREATURES[F.undersea];
    if (u) buy(u, SHIPS[F.undersea] ? r.int(1, 2) : 1);
    // monsters bound to the fleet: about a quarter of its strength
    const pool = (WATERS[env] || SEA_BEASTS).map((k) => CREATURES[k]).filter((c) => c && !(c.refuses && c.refuses.some((x) => x === id)));
    let beasts = budget * (0.18 + r() * 0.14);
    // a realm that keeps its own great beast of the deep brings it (the Zaratan comes with its Bahamut)
    const own = FACTIONS[id] && FACTIONS[id].seaMonster;
    if (own && CREATURES[own]) { for (const k of own === 'zaratan' ? ['zaratan', 'bahamut'] : [own]) { buy(CREATURES[k]); beasts -= seaPrice(CREATURES[k]); } }
    for (let k = 0; k < 3 && beasts > 600; k++) {
      const can = pool.filter((c) => seaPrice(c) * (PACKS[c.id] || 1) <= beasts * 1.25);
      if (!can.length) break;
      const c = r.pick(can), n = PACKS[c.id] ? r.int(2, PACKS[c.id]) : 1;
      buy(c, n); beasts -= seaPrice(c) * n;
    }
    // a battle group: first the line (half of what is left), then the ships that cover its blind spots,
    // then more of the line with whatever the purse still runs to
    const role = (k) => SHIPS[(F.roleShips || ROLE_SHIPS)[k]] || SHIPS[ROLE_SHIPS[k]];
    const foeForts = forts.some((f) => f.side !== mySide);
    const lineShips = () => {
      for (let guard = 0; guard < 40 && left > 0; guard++) {
        const can = hulls.filter((h) => seaPrice(h) <= left);
        if (!can.length) break;
        buy(r.chance(0.55) ? can[0] : r.pick(can));
      }
    };
    const keep = left * 0.5;
    if (hulls.length && left > seaPrice(hulls[0])) buy(hulls[0]); // the flagship of the line
    for (let guard = 0; guard < 20 && left > keep; guard++) { const can = hulls.filter((h) => seaPrice(h) <= left - keep * 0.6); if (!can.length) break; buy(r.chance(0.55) ? can[0] : r.pick(can)); }
    const wants = [['troop', 1], ['hunter', 1], ['flak', 1], ['siege', foeForts ? 2 : 1], ['carrier', 1], ['landing', foeForts ? 2 : 0], ['hunter', 1]];
    for (const [k, n] of wants) { const d = role(k); for (let i = 0; i < n; i++) if (d && left >= seaPrice(d) * 0.9) buy(d); }
    if (hulls.length) lineShips();
    void foeId;
    return groups;
  };
  const FORT_WORTH = 1.5; // what an island fort is worth in ships to the side that must take it
  const base = 13500 + r.int(0, 4500);
  const fortWorth = forts.filter((f) => f.side === 1).reduce((n, f) => n + seaPrice(FORTS[f.type]) * FORT_WORTH, 0) - forts.filter((f) => f.side === 0).reduce((n, f) => n + seaPrice(FORTS[f.type]) * FORT_WORTH, 0);
  const sides = [
    { name: `${A.adj} fleet`, groups: fleet(attId, A, base + Math.max(0, fortWorth), defId, 0) },
    { name: `${D.adj} fleet`, groups: fleet(defId, D, base + Math.max(0, -fortWorth), attId, 1) },
  ];
  const place = `${r.pick(NAME_A)}${r.pick(NAME_B)}`;
  return {
    name: `${SEA_THEMES[env]} off ${place}: ${A.adj} fleet against the ${D.adj.toLowerCase()} ${forts.some((f) => f.side === 1) ? 'island forts' : 'squadron'}`,
    mode: 'naval', seed, site: 'sea', defender: defId, attacker: attId,
    scn: { width: W, height: H, islands, forts, sides, theme: env, maxTicks: 5000 },
  };
}

// ---------- capture the flag ----------
// Two forts face each other across open ground, each built and garrisoned by its own faction,
// each with a flag at its heart. Side A holds the west fort, side B the east.
function generateCtf({ r, seed, site, defId, attId, D, A, size }) {
  const S = [96, 112, 128, 144].includes(size) ? size : site.size;
  const terrainSeed = 1 + r.int(0, 9998), biome = r.pick(A.biomes.filter((x) => D.biomes.includes(x)).concat(A.biomes[0]));
  const terrain = generateTerrain('plains', S, terrainSeed);
  const p = new Plan(S, terrain, r);
  const cy = S >> 1, FW = 28, FH = 32;
  const forts = [{ id: attId, F: A, x: 6, side: 0, gates: ['east', 'north', 'south'] }, { id: defId, F: D, x: S - 6 - FW, side: 1, gates: ['west', 'north', 'south'] }];
  const bases = [], musterAt = [], rallyAt = [], waysIn = [];
  for (const ft of forts) {
    const R = { x: ft.x, y: cy - (FH >> 1), w: FW, h: FH }, from = p.out.length;
    const bx = R.x + (R.w >> 1), by = R.y + (R.h >> 1);
    bases.push({ x: bx, y: by });
    musterAt.push({ x: ft.side === 0 ? R.x + R.w + 7 : R.x - 8, y: by });
    rallyAt.push({ x: ft.side === 0 ? R.x + R.w - 7 : R.x + 6, y: by });
    // three ways in: the main gate facing the enemy, and a postern north and south
    // (each is a list of points to pass: the flanking parties keep to the edges of the field, clear of the fight in the middle)
    waysIn.push([[musterAt[musterAt.length - 1]], [{ x: S >> 1, y: 9 }, { x: bx, y: R.y - 5 }], [{ x: S >> 1, y: S - 10 }, { x: bx, y: R.y + R.h + 4 }]]);
    // the way from each gate to the flag stays open, and so does the yard around the flag
    p.road(R.x, by - 1, R.w, 3); p.road(bx - 1, R.y, 3, R.h); p.road(bx - 4, by - 4, 9, 9);
    const kind = ft.F.strongWall === 'ring' ? 'palisade' : ft.F.strongWall; // a flag fort needs a wall to assault
    enclose(p, kind, R, ft.side, ft.gates, ft.F);
    const In = inner(R, 4), F = ft.F;
    // quarters, stores and somewhere to patch up the wounded
    const own = (CIVIC[ft.id] || []).filter((c) => FACTION_OWN.has(c) && STRUCTURES[c].w <= 4);
    for (const type of own.slice(0, 2)) p.scatter(type, In, 1, 1, { side: ft.side });
    p.scatter(STRUCTURES[F.homes].w <= 3 ? F.homes : 'house', In, 4, 1, { side: ft.side });
    p.scatter(F.camp, In, 4, 1, { side: ft.side });
    p.scatter('crates', In, 3, 1, { side: ft.side });
    if ((CIVIC[ft.id] || []).includes('inn')) p.scatter('inn', In, 1, 1, { side: ft.side });
    if (F.guns.length) for (const gy of [R.y + 5, R.y + R.h - 7]) p.put(r.pick(F.guns), ft.side === 0 ? R.x + R.w - 5 : R.x + 3, gy, { side: ft.side });
    // outworks in front of the main gate
    const fx = ft.side === 0 ? R.x + R.w + 3 : R.x - 5;
    for (const oy of [by - 6, by + 5]) p.put('barricade', fx, oy, { rot: 1 });
    // the posterns stand open (their gates are left off); the main gate and palisades are light enough to break: a raid, not a siege
    for (let i = p.out.length - 1; i >= from; i--) if (p.out[i].type === 'castleGate' && !p.out[i].rot) p.out.splice(i, 1);
    for (let i = from; i < p.out.length; i++) p.out[i] = { ...p.out[i], style: ft.id, look: ft.F.look || ft.id, ...(p.out[i].type === 'castleGate' ? { hp: 260 } : p.out[i].type === 'palisade' ? { hp: 160 } : {}) };
  }
  // the ground between: a road, scattered cover, a ruin to fight over in the middle
  p.road(forts[0].x + FW, cy - 1, forts[1].x - forts[0].x - FW, 3);
  const mid = { x: forts[0].x + FW + 4, y: 4, w: forts[1].x - forts[0].x - FW - 8, h: S - 8 };
  const cx = S >> 1;
  fence(p, cx - 6, cy - 16, 12, 8, null, ['south'], 'wall', 0.35, 'pillar');
  fence(p, cx - 6, cy + 8, 12, 8, null, ['north'], 'wall', 0.35, 'pillar');
  p.scatter('rock', mid, Math.round(S / 7), 2);
  p.scatter('barricade', mid, 6, 2, () => ({ rot: r.int(0, 1) }));
  const trees = [...new Set([...A.trees, ...D.trees])];
  if (trees.length) for (let i = 0; i < S * 1.1; i++) p.put(r.pick(trees), r.int(2, S - 3), r.int(2, S - 3), {}, 1);
  const pts = site.points * (S / site.size) ** 1.2;
  const army = (id, F) => muster(F.army, pts / (F.cost || 1), r);
  const sides = [
    { name: `${A.adj} raiders`, posture: 'attack', groups: army(attId, A), placed: [] },
    { name: `${D.adj} raiders`, posture: 'attack', groups: army(defId, D), placed: [] },
  ];
  return {
    name: `${r.pick(NAME_A)}${r.pick(NAME_B)}: ${A.adj} and ${D.adj} forts fight for each other's flag`,
    mode: 'field', seed, site: 'ctf', defender: defId, attacker: attId,
    scn: { size: S, shape: 'plains', biome, terrainSeed, relief: { hills: 0.9, cliffs: 0.6 }, structures: p.out, sides, maxTicks: 3000, ctf: { bases, muster: musterAt, rally: rallyAt, ways: waysIn, toWin: 3, wave: 40, lieFor: 120 } },
  };
}

/** An army of `points` for a faction, for balance trials: { unit, count } groups. */
export function musterFor(factionId, points, seed = 1, cost = null) {
  const F = FACTIONS[factionId];
  return muster(F.army, points / (cost ?? F.cost ?? 1), rng32(seed * 2654435761));
}
function muster(weights, points, rng) {
  const groups = [];
  let total = 0;
  for (const w of Object.values(weights)) total += w;
  for (const [unit, w] of Object.entries(weights)) {
    if (!UNITS[unit] || w <= 0) continue;
    const share = (points * w) / total, price = priceOf(unit);
    let n = Math.round((share / price) * (0.85 + rng() * 0.3));
    if (n < 1 && share > price * 0.45) n = 1;
    if (n > 0) groups.push({ unit, count: Math.min(n, 260) });
  }
  return groups;
}

// ---------- names ----------
const NAME_A = ['Bracken', 'Ash', 'Grey', 'Thorn', 'Raven', 'Mire', 'Cold', 'Red', 'Storm', 'Hollow', 'Iron', 'Salt', 'Elder', 'Wolf', 'Black', 'Gold', 'Moss', 'Cinder', 'Frost', 'Dusk'];
const NAME_B = ['ford', 'wick', 'hold', 'mere', 'crag', 'haven', 'reach', 'moor', 'gate', 'fell', 'watch', 'stead', 'barrow', 'cross', 'spire', 'marsh', 'cliff', 'vale'];

// ---------- the generator ----------
/**
 * opts: { site, defender, attacker, size (0 = the site's own), seed }
 * returns { name, mode, scn } where scn is an ordinary scenario for that mode.
 */
export function generateScenario(opts = {}) {
  const seed = (opts.seed >>> 0) || 1;
  const r = rng32(seed * 2654435761);
  const siteId = SITES[opts.site] ? opts.site : 'castle';
  const site = SITES[siteId];
  const ids = Object.keys(FACTIONS);
  const defId = FACTIONS[opts.defender] ? opts.defender : r.pick(ids);
  let attId = FACTIONS[opts.attacker] ? opts.attacker : r.pick(ids.filter((k) => k !== defId));
  if (!opts.attacker && attId === defId) attId = ids[(ids.indexOf(defId) + 1) % ids.length];
  const D = FACTIONS[defId], A = FACTIONS[attId];
  if (siteId === 'ctf') return generateCtf({ r, seed, site, defId, attId, D, A, size: +opts.size });
  if (siteId === 'sea') return generateNaval({ r, seed, defId, attId, D, A, theme: opts.theme });
  if (site.big) return generateRegion({ r, seed, siteId, site, defId, attId, D, A });
  const S = [64, 80, 96, 112, 128, 144, 160].includes(+opts.size) ? +opts.size : site.size;
  const shape = r.pick(site.shape), biome = r.pick(D.biomes), terrainSeed = 1 + r.int(0, 9998);
  const terrain = generateTerrain(shape, S, terrainSeed);
  const p = new Plan(S, terrain, r);
  const k = S / site.size; // layouts scale with the map
  const cy = S >> 1;
  const sea = site.mode === 'amphibious';
  const strong = siteId === 'castle' || siteId === 'city' || siteId === 'harbor';
  const wallKind = strong ? D.strongWall : D.wall;
  // The first (main) part of a settlement gets its civic buildings and, for the big places, its
  // upper town on terraces, before the houses fill in around them.
  let civicDone = false, shoreRow = null, levelled = null;
  const layout = (pp, R, F, dens) => {
    if (!civicDone) { civicDone = true; levelled = civic(pp, R, { siteId, defId, r, town, S, cy, sea, shoreRow, rampart: wallKind === 'rampart' }); }
    LAYOUTS[D.layout](pp, R, F, dens);
  };
  const even = (n) => Math.max(8, Math.round(n / 4) * 4); // fences are built from 4-tile pieces
  const guns = (list, spots, side = 1) => { if (list.length) for (const [gx, gy] of spots) p.put(r.pick(list), gx, gy, { side }); };
  let town; // the rectangle the settlement fills

  if (siteId === 'village') {
    town = { x: Math.round(S * 0.56), y: Math.round(S * 0.22), w: even(S * 0.34), h: even(S * 0.56) };
    p.road(0, cy - 1, town.x, 3);
    layout(p, town, D, 0.7);
    for (let i = 0; i < 5; i++) p.put('barricade', town.x - 3, town.y + 3 + Math.round((town.h - 6) * (i / 4)), { rot: 1 }, 0);
    if (D.lookout === 'tower') { p.put('tower', town.x - 2, cy - 6, { side: 1 }); p.put('tower', town.x - 2, cy + 5, { side: 1 }); }
    guns(D.guns.slice(0, 2), [[town.x - 1, cy - 3], [town.x - 1, cy + 3]]);
  } else if (siteId === 'fort') {
    const w = even(22 * k), h = even(24 * k);
    town = { x: Math.round(S * 0.62), y: cy - (h >> 1), w, h };
    p.road(0, cy - 1, town.x + 2, 3);
    enclose(p, wallKind, town, 1, ['west'], D);
    const yard = inner(town, wallKind === 'rampart' ? 4 : wallKind === 'bastions' ? 5 : 2);
    if (D.layout === 'streets') { p.put('keep', yard.x + yard.w - 6, cy - 2, {}, 0); p.scatter(D.camp, yard, 6, 1); p.scatter('crates', yard, 5, 0); }
    else layout(p, yard, D, 0.55);
    guns(D.guns, [[yard.x, yard.y], [yard.x, yard.y + yard.h - 1], [yard.x + 3, cy - 4], [yard.x + 3, cy + 4]]);
    for (const dy of [-7, 6]) p.put('barricade', town.x - 4, cy + dy, { rot: 1 });
  } else if (siteId === 'castle') {
    const w = even(30 * k), h = even(34 * k);
    town = { x: Math.round(S * 0.58), y: cy - (h >> 1), w, h };
    p.road(0, cy - 1, town.x + 4, 3);
    // the village that grew up under the walls
    const burg = { x: town.x - even(16 * k) - 3, y: cy - even(14 * k), w: even(16 * k), h: even(28 * k) };
    enclose(p, wallKind, town, 1, ['west'], D);
    const yard = inner(town, wallKind === 'rampart' ? 4 : 2);
    p.road(yard.x, cy - 1, yard.w, 3);
    if (wallKind === 'rampart' || D.layout === 'streets') p.put('keep', yard.x + yard.w - 7, cy - 2, {}, 0);
    if (wallKind === 'palisade') fence(p, yard.x + (yard.w >> 1) - 6, cy - 6, 12, 12, 1, ['west'], 'palisade', 0, null); // the chief's inner ring
    layout(p, yard, D, 0.5);
    guns(D.guns, [[yard.x, yard.y + 2], [yard.x, yard.y + yard.h - 3], [yard.x + 2, cy - 5], [yard.x + 2, cy + 5], [yard.x + (yard.w >> 1), yard.y + 1], [yard.x + (yard.w >> 1), yard.y + yard.h - 2]]);
    layout(p, burg, D, 0.4);
  } else if (siteId === 'city') {
    const w = even(50 * k), h = even(84 * k);
    town = { x: Math.min(S - w - 3, Math.round(S * (shape === 'river' ? 0.6 : 0.52))), y: cy - (h >> 1), w, h };
    p.road(0, cy - 1, town.x + 4, 3);
    enclose(p, wallKind, town, 1, ['west', 'north', 'south'], D);
    const yard = inner(town, wallKind === 'rampart' ? 4 : 2);
    // the citadel against the far wall
    const cw = even(16 * k), cit = { x: yard.x + yard.w - cw - 2, y: cy - (cw >> 1), w: cw, h: cw };
    const upperTown = (CIVIC[defId] || []).some((c) => c === 'palace' || c === 'temple'); // these build a palace terrace instead of a walled citadel
    if (upperTown) { /* the upper town is laid out with the districts */ }
    else if (wallKind === 'rampart') { rampart(p, cit.x, cit.y, cit.w, cit.h, 1, ['west']); p.put('keep', cit.x + (cw >> 1) - 2, cit.y + (cw >> 1) - 2, {}, 0); p.mark(cit.x, cit.y, cit.w, cit.h); }
    else if (wallKind === 'palisade') { fence(p, cit.x, cit.y, cit.w, cit.h, 1, ['west'], 'palisade', 0, 'tower'); p.mark(cit.x, cit.y, cit.w, cit.h, 2); }
    layout(p, yard, D, 0.62);
    const gy = [yard.y + 2, yard.y + (yard.h >> 2), cy - 5, cy + 5, yard.y + yard.h - (yard.h >> 2), yard.y + yard.h - 3];
    guns(D.guns, gy.map((y) => [yard.x + 1, y]).concat([[yard.x + (yard.w >> 1), yard.y + 1], [yard.x + (yard.w >> 1), yard.y + yard.h - 2]]));
    // farms and hovels outside the walls
    layout(p, { x: town.x - even(14 * k) - 4, y: cy - even(20 * k), w: even(14 * k), h: even(40 * k) }, D, 0.3);
  } else {
    // coastal places: find where dry land begins on each row
    const shore = (shoreRow = new Int16Array(S).fill(-1));
    for (let y = 0; y < S; y++) for (let x = 2; x < S - 2; x++) if (p.land(x, y) && p.land(x + 1, y) && p.land(x + 2, y)) { shore[y] = x; break; }
    const rows = [...shore.keys()].filter((y) => shore[y] >= 0 && y > 4 && y < S - 5);
    const coastX = rows.length ? Math.round(rows.reduce((a, y) => a + shore[y], 0) / rows.length) : S >> 1;
    if (siteId === 'coast') {
      town = { x: coastX + 5, y: Math.round(S * 0.2), w: even(S * 0.3), h: even(S * 0.6) };
      layout(p, town, D, 0.62);
      for (let i = 0; i < 6; i++) { const y = town.y + 2 + Math.round((town.h - 4) * (i / 5)); if (shore[y] >= 0) p.put('sandbags', shore[y] + 2, y, { rot: 1 }); }
    } else if (siteId === 'harbor') {
      town = { x: Math.round(S * 0.34), y: Math.round(S * 0.1), w: even(S * 0.58), h: even(S * 0.8) };
      // wall the landward (east) side only when the faction builds proper walls
      if (wallKind === 'rampart') {
        const wx = Math.min(S - 4, town.x + town.w);
        for (const ty of [town.y, cy - 1, town.y + town.h - 3]) p.force('castleTower', wx - 2, ty, { side: 1 });
        p.force('castleWall', wx, town.y + 3, { rot: 1, len: cy - 1 - town.y - 3, side: 1 });
        p.force('castleWall', wx, cy + 2, { rot: 1, len: town.y + town.h - 3 - cy - 2, side: 1 });
        p.put('stairs', wx - 1, town.y + 5, { rot: 1, side: 1 }); p.put('stairs', wx - 1, town.y + town.h - 8, { rot: 1, side: 1 });
      }
      layout(p, town, D, 0.6);
      if (D.homes !== 'keep' && D.layout === 'streets') { p.put('keep', town.x + town.w - 8, town.y + 3, {}, 1); p.put('keep', town.x + town.w - 8, town.y + town.h - 9, {}, 1); }
    } else { // island
      const w = even(20 * k), h = even(22 * k);
      town = { x: Math.round(S * 0.7) - (w >> 1), y: cy - (h >> 1), w, h };
      enclose(p, wallKind, town, 1, ['west'], D);
      const yard = inner(town, wallKind === 'rampart' ? 4 : wallKind === 'bastions' ? 5 : 2);
      if (D.layout === 'streets') { p.put('keep', yard.x + yard.w - 6, cy - 2, {}, 0); p.scatter(D.camp, yard, 5, 1); p.scatter('crates', yard, 4, 0); }
      else layout(p, yard, D, 0.55);
      guns(D.guns, [[yard.x, yard.y], [yard.x, yard.y + yard.h - 1], [yard.x + 2, cy - 3], [yard.x + 2, cy + 3]]);
      layout(p, { x: town.x - 2, y: town.y + town.h + 3, w: even(14 * k), h: even(8 * k) }, D, 0.4); // huts outside the walls
    }
    // shore defences face the sea: heavy guns where the faction has them, barricades where it does not
    const step = Math.max(6, Math.round(rows.length / (siteId === 'harbor' ? 9 : 7)));
    for (let i = step >> 1; i < rows.length; i += step) {
      const y = rows[i], x = shore[y] + 3;
      if (D.shoreGun) { if (!p.put(D.shoreGun, x, y, { side: 1 }, 1) && D.guns.length) p.put(r.pick(D.guns), x + 1, y, { side: 1 }); }
      else p.put('barricade', x, y, { rot: 1 });
      if (D.guns.length && r.chance(0.6)) p.put(r.pick(D.guns), x + 4, y + (r.chance(0.5) ? 2 : -2), { side: 1 });
    }
  }

  // the cable car: a tower in every district of the place, strung into one line that calls at each
  {
    const [nx, ny] = { village: [1, 2], castle: [1, 3], city: [2, 3], coast: [1, 3], harbor: [2, 3], island: [1, 2] }[siteId] || [0, 0];
    let stop = 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const dx0 = Math.round(town.x + (town.w * (i + 0.5)) / nx), dy0 = Math.round(town.y + (town.h * (j + 0.5)) / ny);
      let done = false;
      for (let rad = 0; rad <= 8 && !done; rad++) for (let dy = -rad; dy <= rad && !done; dy++) for (let dx = -rad; dx <= rad && !done; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        if (p.put('cableTower', dx0 + dx, dy0 + dy, { side: 1, cable: 1, stop: stop }, 1)) { done = true; stop++; }
      }
    }
  }
  // works that serve the army: a mooring tower and hangar for airships, workshops, a supply line
  const big = siteId === 'castle' || siteId === 'city' || siteId === 'harbor' || siteId === 'island';
  const around = { x: Math.max(2, town.x - 4), y: Math.max(2, town.y - 4), w: Math.min(S - town.x, town.w + 8), h: Math.min(S - town.y, town.h + 8) };
  let moored = false;
  if (big) moored = p.scatter('zeppelinTower', around, siteId === 'city' ? 2 : 1, 2, { side: 1 }, 40) > 0;
  if (siteId === 'city' || siteId === 'harbor') p.scatter('hangar', around, 1, 2, () => ({ side: 1, rot: p.r.int(0, 1) }), 40);
  p.scatter('workshop', around, siteId === 'city' ? 3 : siteId === 'village' ? 1 : 2, 1, { side: 1 }, 30);
  // stone bridges carry the roads over a river between the fords
  if (shape === 'river') for (const fy of [0.34, 0.5, 0.68]) {
    const y = Math.round(S * fy);
    let x0 = -1, x1 = -1;
    for (let x = 2; x < S - 2; x++) { const wet = terrain[y * S + x] === 2 || terrain[y * S + x] === 3; if (wet && x0 < 0) x0 = x; if (wet) x1 = x; }
    if (x0 > 2 && x1 - x0 < 30) { p.out.push({ type: 'stoneBridge', x: x0 - 2, y, rot: 0, len: x1 - x0 + 5 }); p.road(x0 - 6, y, x1 - x0 + 12, 2); }
  }
  if (!sea) {
    // a supply line runs in from each army's own edge, with loaded wagons standing on it
    const track = (x0, x1, y, side) => {
      for (let x = x0; x < x1; x += 40) p.out.push({ type: 'rail', x, y, rot: 0, len: Math.min(40, x1 - x) });
      for (let k = 0; k < 2; k++) { const x = side === 0 ? x0 + 2 + k * 4 : x1 - 5 - k * 4; p.out.push({ type: 'railCar', x, y, rot: 0, side }); p.mark(x, y, 3, 1); }
      p.road(x0, y, x1 - x0, 1);
    };
    const ry = clampRow(town.y + town.h + 3, S), ay = clampRow(cy + (ry > cy ? -9 : 9), S);
    void track; void ry; void ay; void levelled; // the railway is laid by the engine now, from each army's edge past every one of its rally points
  } else {
    // piers run out from the shore in front of the settlement
    const shoreAt = (y) => { for (let x = 2; x < S - 2; x++) if (p.land(x, y) && p.land(x + 1, y)) return x; return -1; };
    const n = siteId === 'harbor' ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const y = Math.round(town.y + 3 + ((town.h - 8) * (k + 0.5)) / n), sx = shoreAt(y);
      if (sx < 8 || shoreAt(y + 1) < 0) continue;
      p.out.push({ type: 'dock', x: sx - 5, y, rot: 0, side: 1 });
    }
  }

  // countryside: woods and boulders everywhere else, thinner where the attackers form up
  const wilds = Math.round((S * S) / 150);
  const all = { x: 2, y: 2, w: S - 4, h: S - 4 };
  for (const t of D.trees) p.scatter(t, all, Math.round(wilds / Math.max(1, D.trees.length)), 1, {}, 4);
  p.scatter('rock', all, Math.round(wilds / (D.trees.length ? 5 : 1.5)), 2, {}, 4);

  // Rally points, at fixed places. The attackers' are camps: breastworks, siege pieces and stores for the
  // assault (a landing force has only the beaches it comes in on). The defenders' are their headquarters in
  // the middle of the place and a few lightly held posts, where their engineers raise what the fight needs.
  const points = [];
  const clampXY = (x, y) => [Math.max(4, Math.min(S - 5, Math.round(x))), Math.max(4, Math.min(S - 5, Math.round(y)))];
  if (sea) {
    for (const fy of S >= 128 ? [0.3, 0.5, 0.7] : [0.36, 0.64]) {
      const y = Math.round(S * fy), sx = shoreRow && shoreRow[y] > 0 ? shoreRow[y] : Math.round(S * 0.3);
      points.push({ x: sx + 2, y, side: 0, role: fy === 0.5 || points.length === 0 ? 'hq' : 'camp', stock: 3 });
    }
  } else {
    const siege = A.guns.length ? A.guns : ['ballista', 'mortar'];
    for (const [k, fy] of (big ? [0.5, 0.26, 0.74] : [0.34, 0.66]).entries()) {
      const [cx0, cy0] = clampXY(S * (k === 0 && big ? 0.09 : 0.14), S * fy);
      points.push({ x: cx0, y: cy0, side: 0, role: k === 0 ? 'hq' : 'camp' });
      p.road(cx0 - 1, cy0 - 1, 3, 3);
      const mine = { side: 0, style: attId, look: A.look || attId };
      for (const [dx, dy, type, extra] of [[3, -3, siege[k % siege.length], {}], [3, 2, siege[(k + 1) % siege.length], {}], [-3, -1, 'crates', {}], [-3, 1, 'crates', {}], [-4, -4, 'tent', {}],
        [6, -4, 'barricade', { rot: 1 }], [6, 0, 'barricade', { rot: 1 }], [6, 4, 'barricade', { rot: 1 }], [1, -6, 'sandbags', {}], [1, 6, 'sandbags', {}]]) p.put(type, cx0 + dx, cy0 + dy, { ...mine, ...extra });
    }
  }
  if (town) {
    const tx = town.x + (town.w >> 1), ty = town.y + (town.h >> 1);
    points.push({ x: tx, y: ty, side: 1, role: 'hq', stock: 6 });
    const posts = sea
      ? [[town.x + 2, town.y + town.h * 0.2], [town.x + 2, town.y + town.h * 0.8]]
      : [[town.x - 8, ty - S * 0.17], [town.x - 8, ty + S * 0.17], ...(big ? [[town.x + town.w * 0.78, ty]] : [])];
    for (const [fx, fy] of posts) {
      const [px, py] = clampXY(fx, fy);
      points.push({ x: px, y: py, side: 1, role: 'post' });
      // a few sandbags toward the enemy: the rest is for the engineers
      p.put('sandbags', px - 3, py - 1, { side: 1 }); p.put('sandbags', px - 3, py + 2, { side: 1 }); p.put('crates', px + 2, py, { side: 1 });
    }
  }

  // armies
  const scale = (S / site.size) ** 1.3;
  // `cost` corrects a faction whose troops fight above or below their price (found by tools-side trials)
  const garrison = muster(D.army, (site.points * scale) / (D.cost || 1), r);
  const host = muster({ ...A.army, ...A.assault }, (site.points * scale * site.edge) / (A.cost || 1), r);
  const place = `${r.pick(NAME_A)}${r.pick(NAME_B)}`;
  const sides = [
    { name: `${A.adj} ${sea ? 'landing' : 'host'}`, posture: 'attack', groups: host, placed: [], leader: leaderOf(attId), faction: attId },
    { name: `${place} ${siteId === 'village' ? 'folk' : 'garrison'}`, posture: 'defend', groups: garrison, placed: [], leader: leaderOf(defId), faction: defId },
  ];
  // airships: the attackers bring one to a big fight; a place with a mooring tower keeps its own
  const zep = (id) => (AIRSHIPS[`${id}Zeppelin`] ? [{ unit: `${id}Zeppelin`, count: 1 }] : []);
  const look = D.look || defId; // the building style to fall back on until a realm's own is sculpted
  if (big || S >= 96) sides[0].airships = zep(attId);
  if (moored && (siteId === 'city' || siteId === 'harbor' || r.chance(0.5))) sides[1].airships = zep(defId);
  if (sea) {
    const big = siteId === 'harbor' ? 4 : 3;
    sides[0].ships = [{ unit: A.ships[0], count: Math.max(1, big - 1) }];
    if (A.ships[1]) sides[0].ships.push({ unit: A.ships[1], count: 2 });
    if (siteId === 'harbor' && D.ships.length) sides[1].ships = [{ unit: D.ships[0], count: 1 }];
  }
  return {
    name: `${place}: ${A.adj} ${sea ? 'landing' : 'assault'} on a ${D.adj.toLowerCase()} ${D.places[siteId]}`,
    mode: site.mode, seed, site: siteId, defender: defId, attacker: attId,
    scn: { size: S, shape, biome, terrainSeed, roads: encodeMask(p.paths), relief: { hills: 1, cliffs: sea ? 0.5 : 1 }, structures: p.out.map((st) => (st.side === 0 ? st : { ...st, style: defId, look })), sides, points, style: defId, look, maxTicks: 4000 },
  };
}

// ---------- the big maps ----------
/** a tile mask as run lengths, alternating clear and set, in base 36 */
export function encodeMask(m) {
  const out = [];
  let v = 0, n = 0;
  for (let i = 0; i < m.length; i++) { const b = m[i] ? 1 : 0; if (b === v) n++; else { out.push(n.toString(36)); v = b; n = 1; } }
  out.push(n.toString(36));
  return out.join(',');
}

/** A path for a road between two tiles that keeps off anything built, prefers straight runs and crosses water only where it must */
function roadPath(p, a, b) {
  const S = p.S, N = S * S, cost = new Float32Array(N * 4).fill(Infinity), from = new Int32Array(N * 4).fill(-1), heap = [];
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const step = (x, y) => {
    if (x < 1 || y < 1 || x >= S - 1 || y >= S - 1) return 0;
    const i = y * S + x, t = p.t[i];
    if (p.occ[i] === 1 && Math.max(Math.abs(x - b[0]), Math.abs(y - b[1])) > 1 && Math.max(Math.abs(x - a[0]), Math.abs(y - a[1])) > 1) return 0;
    return t === FORD ? 3 : isWater(t) ? 7 : t === SAND ? 1.3 : p.occ[i] === 2 ? 0.7 : 1;
  };
  const h = (x, y) => (Math.abs(x - b[0]) + Math.abs(y - b[1])) * 0.7;
  const push = (c, s) => { heap.push([c, s]); let i = heap.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; const l = i * 2 + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (let d = 0; d < 4; d++) { const s0 = (a[1] * S + a[0]) * 4 + d; cost[s0] = 0; push(h(a[0], a[1]), s0); }
  let end = -1, guard = 0;
  while (heap.length && guard++ < 900000) {
    const [f, st] = pop(), t = st >> 2, d = st & 3, x = t % S, y = (t / S) | 0, c = cost[st];
    if (f - h(x, y) > c + 1e-6) continue;
    if (x === b[0] && y === b[1]) { end = st; break; }
    const wet = isWater(p.t[t]);
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3) || (wet && nd !== d)) continue; // over water a road runs straight: that is a bridge
      const nx = x + DX[nd], ny = y + DY[nd], k = step(nx, ny);
      if (!k) continue;
      const nc = c + k + (nd === d ? 0 : 4), ns = (ny * S + nx) * 4 + nd;
      if (nc < cost[ns]) { cost[ns] = nc; from[ns] = st; push(nc + h(nx, ny), ns); }
    }
  }
  if (end < 0) return null;
  const path = [];
  for (let st = end; st >= 0; st = from[st]) path.push([(st >> 2) % S, ((st >> 2) / S) | 0]);
  return path.reverse();
}

/** lay a road along a path: three tiles wide on land, a stone bridge over each stretch of water */
function layRoad(p, path, wide = 3) {
  if (!path) return;
  const S = p.S, o = wide >> 1;
  for (let k = 0; k < path.length; k++) {
    const [x, y] = path[k];
    if (!isWater(p.t[y * S + x])) { p.road(x - o, y - o, wide, wide); continue; }
    // the run of water from here, all in one direction
    let e = k;
    while (e + 1 < path.length && isWater(p.t[path[e + 1][1] * S + path[e + 1][0]])) e++;
    const [x0, y0] = path[Math.max(0, k - 1)], [x1, y1] = path[Math.min(path.length - 1, e + 1)], rot = x0 !== x1 ? 0 : 1, len = (rot ? Math.abs(y1 - y0) : Math.abs(x1 - x0)) + 3;
    const bx = rot ? x - 1 : Math.min(x0, x1) - 1, by = rot ? Math.min(y0, y1) - 1 : y - 1;
    if (len <= 44) { p.out.push({ type: 'stoneBridge', x: bx, y: by, rot, len, side: 1 }); p.mark(bx, by, rot ? 2 : len, rot ? len : 2); }
    k = e;
  }
}

/** guns on the towers and bastions of every wall inside a rectangle, so the walls can be fought from */
function manWalls(p, R, list, most) {
  const kit = list.length ? list : ['ballista'];
  let n = 0;
  for (const st of p.out.slice()) {
    if (n >= most || st.x < R.x - 1 || st.y < R.y - 1 || st.x > R.x + R.w || st.y > R.y + R.h) continue;
    const o = st.type === 'castleTower' ? 1 : st.type === 'bastion' ? 1 : st.type === 'tower' ? 0 : -1;
    if (o < 0) continue;
    p.out.push({ type: kit[n % kit.length], x: st.x + o, y: st.y + o, rot: 0, side: 1, onWall: true });
    n++;
  }
}

function generateRegion({ r, seed, siteId, site, defId, attId, D, A }) {
  const isles = siteId === 'isles', S = site.size, shape = site.shape[0];
  const biome = r.pick(D.biomes), terrainSeed = 1 + r.int(0, 9998);
  const terrain = generateTerrain(shape, S, terrainSeed), L = regionLayout(shape, S, terrainSeed);
  const p = new Plan(S, terrain, r);
  const even = (n) => Math.max(8, Math.round(n / 4) * 4);
  const clampXY = (x, y) => [Math.max(4, Math.min(S - 5, Math.round(x))), Math.max(4, Math.min(S - 5, Math.round(y)))];
  const points = [], ends = {}, rects = {};
  const point = (x, y, role, siteRef, extra = {}) => { const [px, py] = clampXY(x, y); points.push({ x: px, y: py, side: 1, role, site: siteRef, ...extra }); };
  const look = D.look || defId;
  const civ = (R, kind, cxy) => civic(p, R, { siteId: kind, defId, r, town: R, S, cy: cxy, sea: false, shoreRow: null, rampart: D.strongWall === 'rampart', noUpper: true });
  // the gates of a rectangle, just outside each face
  const gatesOf = (R) => ({ west: [R.x - 2, R.y + (R.h >> 1)], east: [R.x + R.w + 1, R.y + (R.h >> 1)], north: [R.x + (R.w >> 1), R.y - 2], south: [R.x + (R.w >> 1), R.y + R.h + 1] });

  // ---- the city, with its castle, its upper town on terraces and its walled districts
  const C0 = L.sites.find((s) => s.kind === 'city');
  {
    const w = even(76), h = even(104);
    const R = { x: Math.min(S - w - 14, C0.x - (w >> 1)), y: Math.max(6, Math.min(S - h - 6, C0.y - (h >> 1))), w, h };
    rects.city = R;
    const wall = D.strongWall === 'ring' ? 'rampart' : D.strongWall;
    enclose(p, wall, R, 1, ['west', 'north', 'south', 'east'], D);
    const m = wall === 'rampart' ? 4 : 2, I = inner(R, m);
    const half = Math.round(I.w * 0.48), lower = { x: I.x, y: I.y, w: half, h: I.h };
    const bx = lower.x + lower.w; // the boulevard between the lower and the upper town
    p.road(bx, I.y, 3, I.h);
    const E = { x: bx + 3, y: I.y, w: I.x + I.w - bx - 3, h: I.h };
    // the castle in the north of the east half
    const K = { x: E.x + 1, y: E.y + 1, w: even(E.w - 2), h: even(Math.min(36, E.h * 0.36)) };
    rampart(p, K.x, K.y, K.w, K.h, 1, ['south']);
    const KI = inner(K, 4);
    p.road(KI.x, KI.y + KI.h - 6, KI.w, 6);
    (p.put('keep', KI.x + (KI.w >> 1) - 2, KI.y + 2, { side: 1 }, 0) || p.put('keep', KI.x + 1, KI.y + 1, { side: 1 }, 0));
    p.scatter(D.camp === 'rock' ? 'crates' : D.camp, { x: KI.x, y: KI.y + 7, w: KI.w, h: KI.h - 8 }, 3, 1);
    manWalls(p, K, D.guns, 6);
    point(K.x + (K.w >> 1), KI.y + KI.h - 3, 'hq', 'city', { main: true, name: 'the castle' });
    // the upper town: a terrace over the rest of the east half, a higher one in its middle for the palace or temple
    const U = { x: E.x, y: K.y + K.h + 4, w: E.w, h: E.y + E.h - (K.y + K.h + 4) };
    p.road(E.x, K.y + K.h, E.w, 4); // the street under the castle walls
    if (U.h >= 20) {
      // the whole upper town stands two storeys up: stairs and walkways are the only ways onto it
      p.out.push({ type: 'terraceHigh', x: U.x, y: U.y, rot: 0, len: U.w, wid: U.h, side: 1 });
      const hw = even(Math.min(16, U.w - 10)), hh = even(Math.min(16, U.h - 14)), hx = U.x + U.w - hw - 2, hy = U.y + ((U.h - hh) >> 1);
      const has = new Set(CIVIC[defId] || []);
      (has.has('palace') && p.put('palace', hx + ((hw - 7) >> 1), hy + ((hh - 6) >> 1), { side: 1 }, 0)) || (has.has('temple') && p.put('temple', hx + ((hw - 4) >> 1), hy + ((hh - 5) >> 1), { side: 1 }, 0)) || p.put('keep', hx + ((hw - 5) >> 1), hy + ((hh - 5) >> 1), { side: 1 }, 0);
      // stairs up from the boulevard, and from the terrace to the high terrace
      for (const f of [0.2, 0.5, 0.8]) p.out.push({ type: 'stairs', x: U.x - 1, y: U.y + Math.round(U.h * f), rot: 1, side: 1 });
      p.out.push({ type: 'stairs', x: U.x + Math.round(U.w * 0.3), y: U.y - 1, rot: 0, side: 1 });
      p.road(U.x + 2, hy + (hh >> 1) - 1, hx - U.x - 2, 3);
      // houses on the terrace
      const T = { x: U.x + 3, y: U.y + 2, w: hx - U.x - 5, h: U.h - 4 };
      if (D.layout === 'streets') for (let y = T.y; y + 3 <= T.y + T.h; y += 4) for (let x = T.x; x + 3 <= T.x + T.w; x += 4) p.put(r.chance(0.7) ? D.homes : D.small, x, y, {}, 0);
      else LAYOUTS[D.layout](p, T, D, 0.9);
      // a footbridge from the high terrace over the street to the castle's south wall
      p.out.push({ type: 'walkway', x: hx + (hw >> 1), y: K.y + K.h - 1, rot: 1, len: hy - (K.y + K.h) + 1, side: 1 });
      point(U.x + Math.round(U.w * 0.3), U.y + (U.h >> 1), 'post', 'city', { name: 'the upper town' });
    }
    // the lower town: three districts behind their own walls and gates
    const thirds = [0, 1, 2].map((k) => ({ x: lower.x, y: lower.y + Math.round((lower.h * k) / 3), w: lower.w, h: Math.round(lower.h / 3) }));
    for (const k of [1, 2]) {
      // a wall from the city wall to the upper town, with a gate in the district and another across the boulevard
      const y = thirds[k].y - 1, gx = lower.x + (lower.w >> 1) - 1, x0 = R.x + 1;
      p.force('castleWall', x0, y, { rot: 0, len: gx - x0, side: 1 });
      p.force('castleGate', gx, y, { rot: 0, side: 1 });
      p.force('castleWall', gx + 3, y, { rot: 0, len: bx - gx - 3, side: 1 });
      p.force('castleGate', bx, y, { rot: 0, side: 1 });
      p.force('castleWall', bx + 3, y, { rot: 0, len: 1, side: 1 }); // close the last step to the castle or the terrace
      p.out.push({ type: 'stairs', x: lower.x + 3, y: y - 1, rot: 0, side: 1 }, { type: 'stairs', x: lower.x + lower.w - 5, y: y + 1, rot: 0, side: 1 });
      // a walkway from the district wall over the boulevard onto the upper town
      p.out.push({ type: 'walkway', x: bx - 1, y: y - 1, rot: 0, len: 6, side: 1 });
    }
    thirds.forEach((Dk, k) => {
      const Z = { x: Dk.x + 1, y: Dk.y + 1, w: Dk.w - 2, h: Dk.h - 3 }, cx = Z.x + (Z.w >> 1), cy = Z.y + (Z.h >> 1);
      if (k < 2) civ(Z, 'city', cy);
      // lanes every few blocks, houses packed between
      for (let x = Z.x + 7; x < Z.x + Z.w - 3; x += 9) p.road(x, Z.y, 2, Z.h);
      p.road(Z.x, cy - 1, Z.w, 3); p.road(cx - 1, Z.y, 3, Z.h);
      if (D.layout === 'streets') for (let y = Z.y; y + 3 <= Z.y + Z.h; y += 3) for (let x = Z.x; x + 3 <= Z.x + Z.w; x += 3) p.put(r.chance(0.65) ? D.homes : D.small, x, y, {}, 0) || p.put(D.small, x, y, {}, 0);
      else LAYOUTS[D.layout](p, Z, D, 1);
      point(cx, cy, k === 1 ? 'post' : 'post', 'city', { name: ['the north quarter', 'the gate quarter', 'the dock quarter'][k] });
    });
    manWalls(p, R, D.guns, 10);
    ends.city = gatesOf(R);
  }

  // ---- forts
  for (const F0 of L.sites.filter((s) => s.kind === 'fort')) {
    const w = even(30), h = even(32), R = { x: F0.x - (w >> 1), y: F0.y - (h >> 1), w, h };
    rects[F0.id] = R;
    enclose(p, D.wall, R, 1, ['west', 'east'], D);
    const Y = inner(R, D.wall === 'rampart' ? 4 : D.wall === 'bastions' ? 5 : 2);
    p.road(Y.x, F0.y - 1, Y.w, 3); p.road(F0.x - 1, Y.y, 3, Y.h);
    if (D.layout === 'streets') { p.put('keep', Y.x + Y.w - 7, F0.y - 7, {}, 1); p.scatter(D.camp, Y, 6, 1); p.scatter('crates', Y, 5, 0); }
    else LAYOUTS[D.layout](p, Y, D, 0.6);
    manWalls(p, R, D.guns, 6);
    point(F0.x + 4, F0.y, 'post', F0.id, { main: true, name: 'the fort' });
    point(Y.x + 2, F0.y + 4, 'post', F0.id, { name: 'the fort gate' });
    ends[F0.id] = gatesOf(R);
  }

  // ---- villages
  for (const V0 of L.sites.filter((s) => s.kind === 'village')) {
    const w = even(32), h = even(40), R = { x: V0.x - (w >> 1), y: V0.y - (h >> 1), w, h };
    rects[V0.id] = R;
    civ(R, 'village', V0.y);
    LAYOUTS[D.layout](p, R, D, 0.75);
    for (let i = 0; i < 5; i++) p.put('barricade', R.x - 3, R.y + 3 + Math.round((R.h - 6) * (i / 4)), { rot: 1 }, 0);
    if (D.lookout === 'tower') for (const [tx, ty] of [[R.x - 2, V0.y - 8], [R.x - 2, V0.y + 7], [R.x + R.w, V0.y]]) p.put('tower', tx, ty, { side: 1 });
    manWalls(p, { x: R.x - 4, y: R.y - 2, w: R.w + 8, h: R.h + 4 }, D.guns.slice(0, 2), 3);
    point(V0.x, V0.y, 'post', V0.id, { main: true, name: `the village` });
    point(R.x + 3, R.y + Math.round(R.h * 0.25), 'post', V0.id, { name: 'the village edge' });
    ends[V0.id] = gatesOf(R);
  }

  // ---- docks: a landing stage with a gun and sandbags, the hub of each place's boats
  const waterways = [];
  const dockAt = {};
  for (const [id, [wx, wy]] of Object.entries(L.docks)) {
    // the bank nearest the water point
    let bank = null, bd = 1e9;
    for (let y = wy - 14; y <= wy + 14; y++) for (let x = wx - 14; x <= wx + 14; x++) {
      if (!p.land(x, y) || p.occ[y * S + x] === 1) continue;
      const d = Math.hypot(x - wx, y - wy);
      if (d < bd) { bd = d; bank = [x, y]; }
    }
    if (!bank) continue;
    const dx = Math.sign(wx - bank[0]), dy = Math.sign(wy - bank[1]), rot = Math.abs(wx - bank[0]) >= Math.abs(wy - bank[1]) ? 0 : 1;
    const len = 7, X = rot ? bank[0] : dx > 0 ? bank[0] - 1 : bank[0] - len + 2, Y = rot ? (dy > 0 ? bank[1] - 1 : bank[1] - len + 2) : bank[1];
    p.out.push({ type: 'dock', x: X, y: Y, rot, len, side: 1 }); p.mark(X, Y, rot ? 2 : len, rot ? len : 2);
    const ix = bank[0] - (rot ? 0 : dx * 3), iy = bank[1] - (rot ? dy * 3 : 0); // a little way inland
    for (const [ox, oy] of rot ? [[-3, 0], [3, 0]] : [[0, -3], [0, 3]]) p.put('sandbags', ix + ox - (rot ? 0 : dx), iy + oy, { side: 1 });
    p.put(D.shoreGun || (D.guns[0] || 'harpoon'), ix + (rot ? 2 : 0), iy + (rot ? 0 : 2), { side: 1 }) || p.put('harpoon', ix - 2, iy - 2, { side: 1 });
    p.put('crates', ix + (rot ? -2 : 0), iy + (rot ? 0 : -2), { side: 1 });
    if (D.lookout === 'tower') p.put('tower', ix - (rot ? 0 : dx * 3) + 2, iy - (rot ? dy * 3 : 0) + 2, { side: 1 });
    point(ix, iy, 'hub', id, { hub: true, name: 'the landing' });
    dockAt[id] = { water: [wx, wy], land: [ix, iy] };
  }
  L.lines.forEach((ids, k) => { const stops = ids.filter((id) => dockAt[id]).map((id) => ({ site: id, x: dockAt[id].water[0], y: dockAt[id].water[1] })); if (stops.length >= 2) waterways.push({ kind: L.kinds[k] || 'riverboat', stops }); });

  // ---- the attackers' side: camps on the west edge, or (for the islands) the beaches they mean to take
  const host = A;
  const camps = [];
  if (!isles) {
    const siege = host.guns.length ? host.guns : ['ballista', 'mortar'];
    for (const [k, fy] of [0.5, 0.2, 0.8].entries()) {
      const [cx0, cy0] = clampXY(S * 0.06, S * fy);
      points.push({ x: cx0, y: cy0, side: 0, role: k === 0 ? 'hq' : 'camp', main: true });
      camps.push([cx0 + 7, cy0]);
      p.road(cx0 - 1, cy0 - 1, 3, 3);
      const mine = { side: 0, style: attId, look: host.look || attId };
      for (const [dx, dy, type, extra] of [[3, -3, siege[k % siege.length], {}], [3, 2, siege[(k + 1) % siege.length], {}], [-3, -1, 'crates', {}], [-3, 1, 'crates', {}], [-4, -4, 'tent', {}], [-4, 3, 'tent', {}],
        [6, -5, 'barricade', { rot: 1 }], [6, 4, 'barricade', { rot: 1 }], [1, -7, 'sandbags', {}], [1, 7, 'sandbags', {}]]) p.put(type, cx0 + dx, cy0 + dy, { ...mine, ...extra });
    }
  } else {
    // a beach on the seaward side of each island
    for (const [k, o] of L.isles.entries()) {
      let bx = Math.round(o.x - o.rx * 0.8);
      while (bx < o.x && !p.land(bx, o.y)) bx++;
      points.push({ x: bx + 3, y: o.y + (k === 1 ? 6 : 0), side: 0, role: k === 1 ? 'hq' : 'camp', beach: true, main: true });
      camps.push([bx + 3, o.y]);
    }
  }

  // ---- roads between everything
  const E = (id, face) => ends[id] && ends[id][face];
  const link = (a, b) => { if (a && b) layRoad(p, roadPath(p, clampXY(a[0], a[1]), clampXY(b[0], b[1]))); };
  for (const [id, d] of Object.entries(dockAt)) { const R = rects[id]; if (R) link(d.land, [Math.max(R.x - 1, Math.min(R.x + R.w, d.land[0])), Math.max(R.y - 1, Math.min(R.y + R.h, d.land[1]))]); }
  const east = (y) => [S - 3, y];
  if (!isles) {
    link(camps[1], E('v1', 'west')); link(camps[0], E('v3', 'west')); link(camps[2], E('v2', 'west'));
    link(E('v1', 'south'), E('v3', 'north')); link(E('v3', 'south'), E('v2', 'north'));
    link(E('v1', 'east'), E('f1', 'west')); link(E('v2', 'east'), E('f2', 'west')); link(E('v3', 'east'), E('city', 'west'));
    link(E('f1', 'east'), E('city', 'north')); link(E('f2', 'east'), E('city', 'south'));
  } else {
    for (const [k, id] of ['v1', 'v3', 'f2'].entries()) link(camps[k], E(id, 'west'));
    link(E('f1', 'south'), E('city', 'north')); link(E('v2', 'north'), E('city', 'south'));
  }
  // the defenders' road in from their own edge
  for (const id of ['city', 'f1', 'f2']) { const g = E(id, 'east'); if (g && (!isles || id !== 'f2')) link(g, east(g[1])); }
  if (isles) { const g = E('v2', 'east'); if (g) link(g, east(g[1])); }

  // ---- countryside: woods and boulders, farms round the villages
  const wilds = Math.round((S * S) / 170), all = { x: 2, y: 2, w: S - 4, h: S - 4 };
  for (const t of D.trees) p.scatter(t, all, Math.round(wilds / Math.max(1, D.trees.length)), 1, {}, 4);
  p.scatter('rock', all, Math.round(wilds / (D.trees.length ? 5 : 1.5)), 2, {}, 4);
  for (const R of Object.values(rects)) p.scatter(D.small, { x: R.x - 12, y: R.y - 10, w: R.w + 24, h: R.h + 20 }, 6, 2);

  // ---- armies, in waves
  const garrison = muster(D.army, site.points / (D.cost || 1), r);
  const hostArmy = muster({ ...host.army, ...host.assault }, (site.points * site.edge) / (host.cost || 1), r);
  const place = `${r.pick(NAME_A)}${r.pick(NAME_B)}`;
  const sides = [
    { name: `${host.adj} ${isles ? 'invasion' : 'host'}`, posture: 'attack', groups: hostArmy, placed: [], leader: leaderOf(attId), faction: attId, waves: 4 },
    { name: `${place} march`, posture: 'defend', groups: garrison, placed: [], leader: leaderOf(defId), faction: defId, waves: 4 },
  ];
  const zep = (id) => (AIRSHIPS[`${id}Zeppelin`] ? [{ unit: `${id}Zeppelin`, count: 1 }] : []);
  sides[0].airships = zep(attId);
  sides[1].airships = zep(defId);
  if (isles) {
    sides[0].ships = [{ unit: host.ships[0], count: 3 }];
    if (host.ships[1]) sides[0].ships.push({ unit: host.ships[1], count: 2 });
    if (D.ships.length) sides[1].ships = [{ unit: D.ships[0], count: 2 }];
  }
  return {
    name: `${place}: ${host.adj} ${isles ? 'island campaign against' : 'war on'} the ${D.adj.toLowerCase()} march`,
    mode: site.mode, seed, site: siteId, defender: defId, attacker: attId,
    scn: { size: S, shape, biome, terrainSeed, roads: encodeMask(p.paths), relief: { hills: 1, cliffs: isles ? 0.4 : 0.8 }, region: true,
      structures: p.out.map((st) => (st.side === 0 ? st : { ...st, style: defId, look })), sides, points, waterways, waveEvery: 240,
      style: defId, look, maxTicks: 9000 },
  };
}
