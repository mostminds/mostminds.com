// Procedural scenarios: a place (village, fort, castle, city, coastal town, harbour city,
// island stronghold) laid out in the building style of the faction that holds it, with a
// garrison inside and an attacking army sized to the defences. Everything it returns is an
// ordinary scenario, so the armies and the map stay editable afterwards.
import { generateTerrain, GRASS, SAND } from '../engine/terrain.js';
import { combatLevel } from '../engine/combat.js';
import { STRUCTURES } from './structures.js';
import { UNITS } from './units.js';
import { AIRSHIPS } from './airships.js';
import { realmFactions, LANDMARKS } from './realms.js';

const clampRow = (y, S) => Math.max(3, Math.min(S - 4, y));

// ---------- factions ----------
// wall: what the faction raises around a place that deserves walls.
// layout: how the inside is arranged. homes / small / camp: its buildings, big to small.
export const FACTIONS = {
  kingdom: {
    name: 'Kingdom', adj: 'Kingdom', biomes: ['temperate', 'temperate', 'snow'],
    wall: 'rampart', strongWall: 'rampart', layout: 'streets', homes: 'house', small: 'hut', camp: 'tent', lookout: 'tower',
    deco: ['crates', 'statue', 'crates'], trees: ['tree', 'tree', 'pine'], guns: ['cannon', 'ballista', 'mortar'], shoreGun: 'battery',
    army: { footman: 0.24, longbow: 0.14, crossbow: 0.13, halberdier: 0.12, knight: 0.16, militia: 0.05, cleric: 0.05, battlemage: 0.06, paladin: 0.05, engineer: 0.03, pikeman: 0.1, scout: 0.04, grenadier: 0.05, warPriest: 0.04 },
    assault: { ram: 0.07, lancer: 0.08, griffon: 0.06 }, ships: ['frigate', 'cutter', 'galleon'],
    places: { village: 'village', fort: 'border fort', castle: 'castle', city: 'walled city', coast: 'fishing town', harbor: 'harbour city', island: 'island keep' },
  },
  goblin: {
    name: 'Goblin Horde', adj: 'Goblin', biomes: ['swamp', 'desert', 'jungle', 'temperate'],
    wall: 'palisade', strongWall: 'palisade', layout: 'warren', homes: 'hut', small: 'tent', camp: 'tent', lookout: 'tower',
    deco: ['crates', 'barricade', 'crates'], trees: ['tree', 'pine'], guns: ['ballista', 'ballista', 'cannon'], shoreGun: 'harpoon',
    army: { goblin: 0.2, goblinArcher: 0.18, hobgoblin: 0.26, shaman: 0.08, warboss: 0.16, wolfRider: 0.12, tinker: 0.02, goblinSpear: 0.12, bomber: 0.06, trollShaman: 0.05 },
    assault: { sapper: 0.06, wolfRider: 0.08 }, ships: ['sloop', 'brigantine', 'skiff'],
    places: { village: 'warren', fort: 'stockade', castle: 'great stockade', city: 'shanty city', coast: 'wreckers\' cove', harbor: 'corsair haven', island: 'reef stockade' },
  },
  undead: {
    name: 'Undead', adj: 'Undead', biomes: ['swamp', 'snow', 'temperate'],
    wall: 'ruin', strongWall: 'rampart', layout: 'necropolis', homes: 'keep', small: 'statue', camp: 'pillar', lookout: 'pillar',
    deco: ['statue', 'pillar', 'pillar'], trees: ['pine'], guns: ['mortar', 'ballista'], shoreGun: 'battery',
    army: { skeleton: 0.32, skeletonArcher: 0.2, ghoul: 0.14, necromancer: 0.1, boneColossus: 0.16, bat: 0.08, wight: 0.12, banshee: 0.05, plagueBearer: 0.08 },
    assault: { boneColossus: 0.08 }, ships: ['brigantine', 'cutter'],
    places: { village: 'graveyard', fort: 'barrow fort', castle: 'black keep', city: 'necropolis', coast: 'drowned chapel', harbor: 'ghost harbour', island: 'crypt isle' },
  },
  infernal: {
    name: 'Infernal', adj: 'Infernal', biomes: ['volcanic'],
    wall: 'bastions', strongWall: 'rampart', layout: 'rings', homes: 'bastion', small: 'pillar', camp: 'rock', lookout: 'pillar',
    deco: ['pillar', 'statue', 'rock'], trees: [], guns: ['mortar', 'cannon'], shoreGun: 'battery',
    army: { imp: 0.16, pitFiend: 0.3, infernalLord: 0.2, fireElemental: 0.1, hellhound: 0.1, cultist: 0.06, hellknight: 0.16 },
    assault: { gargoyle: 0.08 }, ships: ['galleon', 'brigantine'],
    places: { village: 'ash shrine', fort: 'brimstone redoubt', castle: 'obsidian citadel', city: 'infernal city', coast: 'cinder shore', harbor: 'burning harbour', island: 'ember isle' },
  },
  beasts: {
    name: 'Beasts', adj: 'Wild', biomes: ['jungle', 'temperate', 'desert'],
    wall: 'ring', strongWall: 'palisade', layout: 'wild', homes: 'rock', small: 'tent', camp: 'tent', lookout: 'tower',
    deco: ['rock', 'barricade', 'crates'], trees: ['tree', 'tree', 'pine'], guns: [], shoreGun: null,
    army: { wolf: 0.14, spider: 0.12, troll: 0.18, ogre: 0.18, cyclops: 0.16, minotaur: 0.14, harpy: 0.08, alphaWolf: 0.08, broodmother: 0.08, ogreMage: 0.06 },
    assault: {}, ships: ['raft', 'skiff'],
    places: { village: 'den', fort: 'ogre camp', castle: 'giants\' hold', city: 'great lair', coast: 'troll shore', harbor: 'harpy cove', island: 'cyclops isle' },
  },
  elemental: {
    name: 'Elemental', adj: 'Elemental', biomes: ['snow', 'volcanic', 'desert'],
    wall: 'ring', strongWall: 'ring', layout: 'rings', homes: 'pillar', small: 'statue', camp: 'rock', lookout: 'pillar',
    deco: ['pillar', 'rock', 'statue'], trees: ['pine'], guns: [], shoreGun: null,
    army: { golem: 0.28, gargoyle: 0.2, fireElemental: 0.16, iceWraith: 0.16, frostGolem: 0.14, stormElemental: 0.1 },
    assault: {}, ships: ['cutter'],
    places: { village: 'standing stones', fort: 'rune circle', castle: 'stone sanctum', city: 'city of pillars', coast: 'tide stones', harbor: 'drowned sanctum', island: 'rune isle' },
  },
  dragons: {
    name: 'Dragons', adj: 'Dragon', biomes: ['volcanic', 'snow'],
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
  village: { name: 'Village raid', mode: 'field', shape: ['plains', 'plains', 'lake'], size: 96, points: 11000, edge: 1.15 },
  fort: { name: 'Fort assault', mode: 'field', shape: ['plains', 'plains', 'river'], size: 96, points: 15000, edge: 1.5 },
  castle: { name: 'Castle siege', mode: 'field', shape: ['plains'], size: 112, points: 21000, edge: 1.9 },
  city: { name: 'City siege', mode: 'field', shape: ['plains', 'river'], size: 144, points: 36000, edge: 1.6 },
  coast: { name: 'Coastal settlement landing', mode: 'amphibious', shape: ['coast'], size: 112, points: 14000, edge: 1.2 },
  harbor: { name: 'Harbour city assault', mode: 'amphibious', shape: ['harbor'], size: 128, points: 24000, edge: 1.4 },
  island: { name: 'Island stronghold', mode: 'amphibious', shape: ['island'], size: 112, points: 16000, edge: 1.3 },
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
  road(x, y, w, h) { this.mark(x, y, w, h, 2); }
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
      for (let s = from; s < to; s += 40) { const len = Math.min(40, to - s); if (len > 0) add('castleWall', rot ? fx : fx + s, rot ? fy + s : fy, { rot, len }); }
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
  const { siteId, defId, r, town, S, cy, sea, shoreRow, rampart } = o;
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
  if ((big || siteId === 'castle') && R.w >= 26 && R.h >= 30 && (has.has('palace') || has.has('temple'))) {
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
    const lo = nearPut('cableTower', cx + plaza + 2, my + plaza + 2, { side: 1, cable: 1 }, 1);
    if (lo && !p.put('cableTower', hx + 1, hy + hh - 3, { side: 1, cable: 1 }, 0)) p.out[p.out.length - 1].cable = undefined;
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
    if (!levelled) track(Math.min(S - 14, town.x + town.w + 1), S - 2, ry, 1); // a city on levels has its own viaduct
    track(2, Math.round(S * 0.2), ay, 0);
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

  // armies
  const scale = (S / site.size) ** 1.3;
  const garrison = muster(D.army, site.points * scale, r);
  const host = muster({ ...A.army, ...A.assault }, site.points * scale * site.edge, r);
  const place = `${r.pick(NAME_A)}${r.pick(NAME_B)}`;
  const sides = [
    { name: `${A.adj} ${sea ? 'landing' : 'host'}`, posture: 'attack', groups: host, placed: [] },
    { name: `${place} ${siteId === 'village' ? 'folk' : 'garrison'}`, posture: 'defend', groups: garrison, placed: [] },
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
    scn: { size: S, shape, biome, terrainSeed, structures: p.out.map((st) => (st.side === 0 ? st : { ...st, style: defId, look })), sides, style: defId, look },
  };
}
