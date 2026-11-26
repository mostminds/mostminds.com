// Headless land / amphibious battle simulation. No DOM, no Three.js:
// the same code runs the live 3D view and the batch worker.
import { createRng } from './rng.js';
import { attackRoll, defenceRoll, hitChance, maxHit, hitDelay, combatLevel } from './combat.js';
import { generateTerrain, DEEP, isWater } from './terrain.js';
import { STRUCTURES } from '../data/structures.js';
import { initSupport, supportTick, unitVsShip, resolveSupportHit, gunDuty, onGunRing } from './support.js';
import { initAirships, airTick, airAlive, resolveAirHit, unitVsAirship, flierVsAirship } from './airship.js';
import { initCommand, commandTick, specDuty, fallbackFor, onUnitDeath } from './command.js';

const INF = 32767;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SQUAD_SIZE = 8;
const CRAFT_CAPACITY = 6;

export function inferRole(def) {
  if (def.role) return def.role;
  if (def.fly) return 'air';
  if ((def.abilities || []).some((a) => a.type === 'heal')) return 'support';
  if (def.style !== 'melee') return 'artillery';
  if ((def.move || 1) >= 2) return 'skirmisher';
  return 'frontline';
}

export function prepareDef(def) {
  const d = { size: 1, move: 1, range: 1, speed: 4, abilities: [], bonus: {}, ...def };
  d.level = d.level || combatLevel(d);
  d.aRoll = attackRoll(d);
  d.max = maxHit(d);
  d.role = inferRole(d);
  return d;
}

export function structureFootprint(s) {
  const def = STRUCTURES[s.type];
  const rot = (s.rot || 0) % 2;
  const len = def.stretch && s.len ? Math.max(1, s.len) : def.w;
  return { w: rot ? def.h : len, h: rot ? len : def.h, def };
}

export function createBattle(scn, roster, seed = 1, shipDefs = {}) {
  const W = scn.size, H = scn.size, N = W * H;
  const b = {
    W, H, mode: scn.mode, tick: 0, seed, rng: createRng(seed),
    terrain: scn.terrain || generateTerrain(scn.shape || (scn.mode === 'amphibious' ? 'island' : 'plains'), W, scn.terrainSeed || 7),
    shape: scn.shape, biome: scn.biome || 'temperate', guns: [], ships: [],
    blockMove: new Uint8Array(N), blockLos: new Uint8Array(N), cover: new Uint8Array(N),
    elevated: new Uint8Array(N), occ: new Int32Array(N), occAir: new Int32Array(N),
    level: new Uint8Array(N), ladder: new Uint8Array(N), door: new Int8Array(N).fill(-1),
    losH: new Uint8Array(N), sid: new Int16Array(N),
    units: [], squads: [], crafts: [], pending: [], events: [], fields: new Map(),
    sides: scn.sides.map((s, i) => ({ name: s.name || `Side ${i + 1}`, posture: s.posture || 'attack', initial: 0 })),
    maxTicks: scn.maxTicks || 3000, winner: null, structures: [],
    buckets: new Map(),
  };
  const defs = {};
  const getDef = (id) => (defs[id] ||= roster[id] ? prepareDef(roster[id]) : null);
  b.getDef = getDef;

  // Structures
  for (const s of scn.structures || []) {
    const def = STRUCTURES[s.type];
    if (!def) continue;
    const { w, h } = structureFootprint(s);
    let wet = false;
    for (let y = s.y; y < s.y + h; y++) for (let x = s.x; x < s.x + w; x++) if (x < 0 || y < 0 || x >= W || y >= H || b.terrain[y * W + x] === DEEP) wet = true;
    if (wet && !def.overWater) continue; // nothing is built on open water or off the map
    b.structures.push({ ...s, w, h, hp: def.hp || 0, maxHp: def.hp || 0, destroyed: false });
  }
  rebuildGrid(b);
  b.hasRamparts = b.level.some((l) => l > 0);

  const addUnit = (def, side, x, y) => spawnUnit(b, def, side, x, y);
  const fits = (def, x, y, side) => def.fly ? canStandAir(b, x, y, def.size, -1) : canStand(b, x, y, def.size, -1, side);

  scn.sides.forEach((side, si) => {
    const fresh = [];
    for (const p of side.placed || []) {
      const def = getDef(p.unit);
      if (def && fits(def, p.x, p.y, si)) fresh.push(addUnit(def, si, p.x, p.y));
    }
    const pool = [];
    for (const g of side.groups || []) {
      const def = getDef(g.unit);
      if (!def) continue;
      for (let k = 0; k < Math.min(g.count, 500); k++) pool.push(def);
    }
    const order = { siege: 0, frontline: 1, skirmisher: 2, air: 3, support: 4, artillery: 5 };
    pool.sort((a, c) => (order[a.role] ?? 3) - (order[c.role] ?? 3) || (a.id < c.id ? -1 : 1));

    if ((side.crafts || []).length) deployPlacedCrafts(b, side.crafts, pool, addUnit, si);
    if (scn.mode === 'amphibious' && si === 0) {
      // fliers cross the water on their own wings; everyone else takes the boats
      const air = pool.filter((d) => d.fly);
      deployByCraft(b, pool.filter((d) => !d.fly), addUnit, si);
      let k = 0;
      for (const def of air) {
        for (; k < W * H; k++) {
          const x = 1 + Math.floor(k / (H - 4)) * def.size, y = 2 + (k % (H - 4));
          if (x >= W * 0.3) break;
          if (fits(def, x, y, si)) { addUnit(def, si, x, y); break; }
        }
      }
    } else {
      const tiles = spawnTiles(b, scn.mode, si);
      let ti = 0;
      for (const def of pool) {
        let t = ti;
        while (t < tiles.length && !fits(def, tiles[t] % W, (tiles[t] / W) | 0, si)) t++;
        if (t >= tiles.length) continue;
        addUnit(def, si, tiles[t] % W, (tiles[t] / W) | 0);
        if (t === ti && !def.fly) ti++;
      }
    }
    // Also squad manually-placed units
    void fresh;
  });

  buildSquads(b);
  initSupport(b, scn, shipDefs);
  initAirships(b, scn);
  initCommand(b, scn);
  return b;
}

/** add one unit to a battle (x < 0 leaves it off the grid, e.g. aboard something) */
export function spawnUnit(b, def, side, x, y) {
  const u = {
    id: b.units.length, side, def, x, y, px: x, py: y, hp: def.hp, cd: b.rng.int(0, def.speed),
    alive: true, aboard: -1, pending: 0, squad: -1, poison: null, kills: 0, dealt: 0,
    moved: 0, attacks: 0, face: side === 0 ? 0 : Math.PI, lastAttack: -99,
  };
  b.units.push(u);
  b.sides[side].initial++;
  if (x >= 0) occupy(b, u, 1);
  return u;
}
/** form units that arrived mid-battle into a squad of their own */
export function addSquad(b, members, state = 'advance') {
  if (!members.length) return null;
  const sq = {
    id: b.squads.length, side: members[0].side, role: members[0].def.role, members: members.map((u) => u.id),
    initial: members.length, state, target: -1, focus: -1, waypoint: null, cx: 0, cy: 0, alive: members.length, flankUntil: 0,
  };
  for (const u of members) u.squad = sq.id;
  b.squads.push(sq);
  return sq;
}
/** nearest free tiles to (x, y) for a unit of this size, searched outward over walkable ground */
export function freeTileNear(b, x, y, size, side) {
  const start = y * b.W + x, seen = new Set([start]), q = [start];
  for (let h = 0; h < q.length && h < 600; h++) {
    const i = q[h], cx = i % b.W, cy = (i / b.W) | 0;
    if (canStand(b, cx, cy, size, -1, side)) return [cx, cy];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy, n = ny * b.W + nx;
      if (nx < 0 || ny < 0 || nx >= b.W || ny >= b.H || seen.has(n) || (isWater(b.terrain[n]) && !b.level[n])) continue;
      seen.add(n); q.push(n);
    }
  }
  return null;
}

function spawnTiles(b, mode, side) {
  const { W, H } = b;
  const tiles = [];
  const cy = H / 2;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (isWater(b.terrain[i]) || b.blockMove[i] || b.door[i] >= 0) continue;
    let depth;
    if (mode === 'amphibious') {
      if (side === 0) continue;
      if (b.terrain[i] !== 0 && b.terrain[i] !== 1) continue;
      depth = x; // defenders: front faces west
    } else {
      if (side === 0 && x > W * 0.3) continue;
      if (side === 1 && x < W * 0.7) continue;
      depth = side === 0 ? W - x : x;
    }
    tiles.push({ i, k: depth * 1000 + Math.abs(y - cy) });
  }
  tiles.sort((a, c) => a.k - c.k);
  return tiles.map((t) => t.i);
}

const CRAFT_GUN = { range: 6, maxHit: 9, reload: 5 };
function newCraft(b, side, x, y, tx, ty) {
  const craft = {
    id: b.crafts.length, side, x, y, px: x, py: y, tx, ty, hp: 60, maxHp: 60,
    passengers: [], landed: false, sunk: false, speed: 0.55 + b.rng.next() * 0.1, pending: 0,
    crew: 3, maxCrew: 3, gunCd: b.rng.int(0, 4), aim: side === 0 ? 0 : Math.PI,
  };
  b.crafts.push(craft);
  return craft;
}
// craft the player set down on the water: each takes the next foot soldiers from the pool and
// makes for the nearest shore on the enemy's side
function deployPlacedCrafts(b, list, pool, addUnit, side) {
  const { W, H } = b, ex = side === 0 ? W * 0.85 : W * 0.15;
  for (const c of list) {
    if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= H || !isWater(b.terrain[c.y * W + c.x])) continue;
    let best = null, bs = Infinity;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (isWater(b.terrain[i]) || b.blockMove[i]) continue;
      if (!isWater(b.terrain[i - 1]) && !isWater(b.terrain[i + 1]) && !isWater(b.terrain[i - W]) && !isWater(b.terrain[i + W])) continue;
      const sc = Math.hypot(x - c.x, y - c.y) + 0.5 * Math.hypot(x - ex, y - H / 2);
      if (sc < bs) { bs = sc; best = [x, y]; }
    }
    if (!best) continue;
    const craft = newCraft(b, side, c.x, c.y, best[0], best[1]);
    for (let k = 0, n = 0; k < pool.length && n < CRAFT_CAPACITY;) {
      if (pool[k].fly || pool[k].size > 1) { k++; continue; }
      const u = addUnit(pool.splice(k, 1)[0], side, -1, -1);
      u.aboard = craft.id; u.x = u.px = c.x; u.y = u.py = c.y;
      craft.passengers.push(u.id); n++;
    }
  }
}
function deployByCraft(b, pool, addUnit, side) {
  const { W, H } = b;
  const craftCount = Math.max(1, Math.ceil(pool.length / CRAFT_CAPACITY));
  const lanes = Math.min(craftCount, Math.max(1, Math.floor((H - 6) / 3)));
  let p = 0;
  for (let c = 0; c < craftCount; c++) {
    const lane = c % lanes, wave = Math.floor(c / lanes);
    const y = Math.round(3 + ((lane + 0.5) * (H - 6)) / lanes);
    const x = 2 - wave * 4;
    // Beach target: first non-deep tile eastward on this row
    let tx = W - 1;
    for (let xx = 0; xx < W; xx++) if (!isWater(b.terrain[y * W + xx])) { tx = xx; break; } // run right in to dry ground
    const craft = newCraft(b, side, x, y, tx, y);
    for (let k = 0; k < CRAFT_CAPACITY && p < pool.length; k++, p++) {
      const u = addUnit(pool[p], side, -1, -1);
      u.aboard = craft.id;
      u.x = x; u.y = y; u.px = x; u.py = y;
      craft.passengers.push(u.id);
    }
  }
}

function buildSquads(b) {
  const groups = new Map();
  for (const u of b.units) {
    const key = `${u.side}:${u.def.id}:${u.aboard >= 0 ? 'c' + Math.floor(u.aboard / 2) : 'l'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u);
  }
  for (const list of groups.values()) {
    for (let k = 0; k < list.length; k += SQUAD_SIZE) {
      const members = list.slice(k, k + SQUAD_SIZE);
      const sq = {
        id: b.squads.length, side: members[0].side, role: members[0].def.role, members: members.map((u) => u.id),
        initial: members.length, state: b.sides[members[0].side].posture === 'defend' ? 'hold' : 'advance',
        target: -1, focus: -1, waypoint: null, cx: 0, cy: 0, alive: members.length, flankUntil: 0,
      };
      for (const u of members) u.squad = sq.id;
      b.squads.push(sq);
    }
  }
}

// ---------- grid helpers ----------
export function walkable(b, x, y) {
  if (x < 0 || y < 0 || x >= b.W || y >= b.H) return false;
  const i = y * b.W + x;
  return !b.blockMove[i] && (!isWater(b.terrain[i]) || b.level[i] > 0); // soldiers keep out of the water; a deck over it can be walked on
}
// side may pass this tile (doors only open for their owner)
function passable(b, i, side) {
  return !b.blockMove[i] && (!isWater(b.terrain[i]) || b.level[i] > 0) && (b.door[i] < 0 || b.door[i] === side);
}
// one level up or down per step, or any height on a ladder
function stepOk(b, a, c) {
  return Math.abs(b.level[a] - b.level[c]) <= 1 || b.ladder[a] || b.ladder[c];
}
function breakableFor(b, i, side) {
  const id = b.sid[i] - 1;
  if (id < 0) return null;
  const s = b.structures[id];
  if (s.destroyed || !s.hp) return null;
  if (s.side !== undefined && s.side !== null && s.side === side) return null;
  return s;
}
const breachCost = (s) => 4 + Math.ceil(s.hp / 50);

export function canStand(b, x, y, size, selfId, side) {
  for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) {
    if (!walkable(b, xx, yy)) return false;
    const i = yy * b.W + xx;
    if (b.door[i] >= 0 && b.door[i] !== side) return false;
    const o = b.occ[i];
    if (o && o - 1 !== selfId) return false;
  }
  return true;
}
export function canStandAir(b, x, y, size, selfId) {
  for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) {
    if (xx < 0 || yy < 0 || xx >= b.W || yy >= b.H) return false;
    const o = b.occAir[yy * b.W + xx];
    if (o && o - 1 !== selfId) return false;
  }
  return true;
}
export function occupy(b, u, on) {
  const s = u.def.size, grid = u.def.fly ? b.occAir : b.occ;
  for (let yy = u.y; yy < u.y + s; yy++) for (let xx = u.x; xx < u.x + s; xx++) {
    if (xx < 0 || yy < 0 || xx >= b.W || yy >= b.H) continue;
    const i = yy * b.W + xx;
    if (on) grid[i] = u.id + 1; else if (grid[i] === u.id + 1) grid[i] = 0;
  }
}
const isAirborne = (b, u) => u.def.fly && !(u.landedUntil > b.tick);
export function unitHeight(b, u) {
  if (isAirborne(b, u)) return 4;
  if (u.x < 0) return 0;
  return b.level[u.y * b.W + u.x];
}

// Paint every standing structure onto the grid (also used after one is destroyed)
export function rebuildGrid(b) {
  const N = b.W * b.H;
  b.blockMove.fill(0); b.blockLos.fill(0); b.cover.fill(0); b.elevated.fill(0);
  b.level.fill(0); b.ladder.fill(0); b.door.fill(-1); b.losH.fill(0); b.sid.fill(0);
  b.structures.forEach((s, idx) => {
    const def = STRUCTURES[s.type];
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
      const i = y * b.W + x;
      if (s.destroyed) { if (def.blocksMove || def.level) b.cover[i] = 1; continue; } // rubble
      if (def.blocksMove) b.blockMove[i] = 1;
      if (def.blocksLos) { b.blockLos[i] = 1; b.losH[i] = def.losHeight || 6; }
      if (def.cover) b.cover[i] = 1;
      if (def.level) b.level[i] = Math.max(b.level[i], def.level);
      if (def.ladder) b.ladder[i] = 1;
      if (def.door) b.door[i] = s.side ?? 1;
      b.sid[i] = idx + 1;
    }
  });
  for (let i = 0; i < N; i++) b.elevated[i] = b.level[i] > 0 ? 1 : 0;
}

export function damageStructure(b, idx, dmg, from) {
  const s = b.structures[idx];
  if (!s || s.destroyed || !s.hp || dmg <= 0) return;
  if (STRUCTURES[s.type].weapon) {
    // guns keep their own hit points; a wrecked gun stays as an obstacle
    const g = b.guns.find((x) => x.si === idx);
    if (!g || g.destroyed) return;
    g.hp = Math.max(0, g.hp - dmg);
    b.events.push({ type: 'gunHit', gun: g.id, dmg });
    if (g.hp <= 0) { g.destroyed = true; b.events.push({ type: 'gunDestroyed', gun: g.id }); }
    return;
  }
  s.hp = Math.max(0, s.hp - dmg);
  b.events.push({ type: 'structHit', s: idx, dmg });
  if (s.hp > 0) return;
  s.destroyed = true;
  const before = b.level.slice();
  rebuildGrid(b);
  b.fields.clear();
  b.hasRamparts = b.level.some((l) => l > 0);
  b.events.push({ type: 'structDestroyed', s: idx, side: from ? from.side : -1 });
  // anyone standing on it falls
  for (const u of b.units) {
    if (!u.alive || u.aboard >= 0 || u.def.fly) continue;
    const i = u.y * b.W + u.x;
    const drop = before[i] - b.level[i];
    if (drop > 0) damage(b, u, drop * 6 + b.rng.int(0, drop * 4), null, 'fall');
    if (u.alive && isWater(b.terrain[i]) && !b.level[i]) { u.alive = false; u.hp = 0; occupy(b, u, 0); b.events.push({ type: 'death', id: u.id, drowned: true }); } // the dock went from under them
  }
}
// blast damage to anything built within r tiles of (x, y)
export function hitStructuresAt(b, x, y, r, dmg) {
  const seen = new Set();
  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
    if (xx < 0 || yy < 0 || xx >= b.W || yy >= b.H) continue;
    const id = b.sid[yy * b.W + xx] - 1;
    if (id >= 0 && !seen.has(id)) { seen.add(id); damageStructure(b, id, dmg, null); }
  }
}
function gap(ax, ay, as, bx, by, bs) {
  const dx = Math.max(0, ax - (bx + bs - 1), bx - (ax + as - 1));
  const dy = Math.max(0, ay - (by + bs - 1), by - (ay + as - 1));
  return Math.max(dx, dy);
}
export function unitDist(a, c) { return gap(a.x, a.y, a.def.size, c.x, c.y, c.def.size); }

export function losCheck(b, x0, y0, x1, y1, h0, h1) {
  // returns 0 blocked, 1 clear, 2 clear-through-cover. Heights are in levels;
  // a raised shooter or target sees over anything no taller than itself.
  const h = Math.max(h0 ?? b.level[y0 * b.W + x0] ?? 0, h1 ?? b.level[y1 * b.W + x1] ?? 0);
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0, cov = false;
  while (!(x === x1 && y === y1)) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) break;
    const i = y * b.W + x;
    if ((b.blockLos[i] && b.losH[i] > h) || b.level[i] > h) return 0;
    if (b.cover[i] && h < 2) cov = true;
  }
  return cov ? 2 : 1;
}

// Weighted distance field toward the sources for movers of `side`.
// Stepping into a wall, gate or building costs its breach time, so troops go
// around when that is quicker and break through when it is not.
function bfs(b, sources, side) {
  const W = b.W, N = W * b.H;
  const dist = new Int16Array(N).fill(INF);
  const buckets = [[]];
  for (const s of sources) if (dist[s] === INF) { dist[s] = 0; buckets[0].push(s); }
  for (let d = 0; d < buckets.length; d++) {
    const list = buckets[d];
    if (!list) continue;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (dist[i] !== d) continue;
      const x = i % W, y = (i / W) | 0;
      const iOpen = passable(b, i, side);
      const brk = iOpen ? null : breakableFor(b, i, side);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= b.H) continue;
        const n = ny * W + nx;
        if (isWater(b.terrain[n]) && !b.level[n]) continue;
        if (!passable(b, n, side) && !breakableFor(b, n, side)) continue;
        let cost;
        if (iOpen && stepOk(b, n, i)) {
          if (dx && dy && (!passable(b, y * W + nx, side) || !passable(b, ny * W + x, side))) continue;
          cost = 1;
        } else {
          const s = brk || breakableFor(b, i, side);
          if (!s || (dx && dy)) continue;
          cost = breachCost(s);
        }
        const nd = d + cost;
        if (nd < dist[n] && nd < INF) { dist[n] = nd; (buckets[nd] ||= []).push(n); }
      }
    }
  }
  return dist;
}
export function field(b, key, ttl, sourceFn) {
  const side = b.moverSide ?? -1;
  key = `${key}|${side}`;
  const c = b.fields.get(key);
  if (c && b.tick - c.tick < ttl) return c.dist;
  const src = sourceFn();
  if (!src.length) return null;
  const dist = bfs(b, src, side);
  b.fields.set(key, { tick: b.tick, dist });
  return dist;
}
function unitTiles(b, list) {
  const out = [];
  for (const u of list) {
    if (!u.alive || u.aboard >= 0 || isAirborne(b, u)) continue;
    const s = u.def.size;
    for (let yy = u.y; yy < u.y + s; yy++) for (let xx = u.x; xx < u.x + s; xx++) out.push(yy * b.W + xx);
  }
  return out;
}

// ---------- spatial hash ----------
const BK = 8;
function rebuildBuckets(b) {
  b.buckets.clear();
  for (const u of b.units) {
    if (!u.alive) continue;
    const k = ((u.x / BK) | 0) * 1024 + ((u.y / BK) | 0);
    let a = b.buckets.get(k);
    if (!a) b.buckets.set(k, (a = []));
    a.push(u);
  }
}
export function near(b, x, y, r, fn) {
  const x0 = Math.floor((x - r) / BK), x1 = Math.floor((x + r) / BK);
  const y0 = Math.floor((y - r) / BK), y1 = Math.floor((y + r) / BK);
  for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) {
    const a = b.buckets.get(bx * 1024 + by);
    if (a) for (const u of a) fn(u);
  }
}

// ---------- main step ----------
export function stepBattle(b) {
  if (b.winner !== null) return;
  b.tick++;
  b.events = [];
  for (const u of b.units) { u.px = u.x; u.py = u.y; }
  for (const c of b.crafts) { c.px = c.x; c.py = c.y; }
  rebuildBuckets(b);

  moveCrafts(b);
  supportTick(b);
  airTick(b);
  commandTick(b);
  for (const sq of b.squads) if ((b.tick + sq.id) % 3 === 0) updateSquad(b, sq);

  // Fair-ish ordering: shuffle each tick
  const order = b.units.filter((u) => u.alive);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(b.rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const u of order) if (u.alive) unitTick(b, u);

  resolvePending(b);
  checkWinner(b);
}

function sideAlive(b, side) {
  let n = 0;
  for (const u of b.units) if (u.alive && u.side === side) n++;
  // a side made only of ships stays in the fight while it has hulls afloat
  if (!b.sides[side].initial) for (const s of b.ships) if (s.alive && s.side === side) n++;
  return n + airAlive(b, side); // a crewed airship keeps its side in the fight
}
function sideHp(b, side) {
  let n = 0;
  for (const u of b.units) if (u.alive && u.side === side) n += u.hp;
  return n;
}
function checkWinner(b) {
  const a0 = sideAlive(b, 0), a1 = sideAlive(b, 1);
  if (a0 === 0 && a1 === 0) b.winner = -1;
  else if (a0 === 0) b.winner = 1;
  else if (a1 === 0) b.winner = 0;
  else if (b.tick >= b.maxTicks) b.winner = -1;
  if (b.winner !== null) b.events.push({ type: 'end', winner: b.winner });
}

export function summary(b) {
  return {
    winner: b.winner, ticks: b.tick,
    survivors: [sideAlive(b, 0), sideAlive(b, 1)],
    initial: b.sides.map((s) => s.initial),
    hp: [sideHp(b, 0), sideHp(b, 1)],
  };
}

// ---------- landing craft ----------
// the swivel gun in the bow, worked by the boat's own crew afloat and on the beach
function craftFire(b, c) {
  if (c.gunCd > 0) { c.gunCd--; return; }
  let best = null, bd = CRAFT_GUN.range + 0.01;
  near(b, Math.round(c.x), Math.round(c.y), CRAFT_GUN.range + 1, (t) => {
    if (!t.alive || t.side === c.side || t.aboard >= 0) return;
    const d = Math.hypot(t.x - c.x, t.y - c.y);
    if (d < bd) { bd = d; best = t; }
  });
  if (!best) return;
  const hit = b.rng.next() < hitChance((40 + 9) * (40 + 64), defenceRoll(best.def, 'ranged'));
  const delay = 1 + Math.floor(bd / 6);
  queueHit(b, { id: -1 }, best, hit ? b.rng.int(0, CRAFT_GUN.maxHit) : 0, delay, 'ranged', hit);
  c.gunCd = CRAFT_GUN.reload; c.aim = Math.atan2(best.y - c.y, best.x - c.x);
  b.events.push({ type: 'craftFire', craft: c.id, to: best.id, delay });
}
function moveCrafts(b) {
  for (const c of b.crafts) {
    if (!c.sunk && c.crew > 0) {
      craftFire(b, c);
      // boarders on the beach cut the crew down
      if (c.landed && b.tick % 3 === 0) {
        let foes = 0;
        near(b, Math.round(c.x), Math.round(c.y), 2, (t) => { if (t.alive && t.side !== c.side && t.aboard < 0 && Math.hypot(t.x - c.x, t.y - c.y) <= 1.6) foes++; });
        if (foes && b.rng.chance(0.5)) { c.crew--; b.events.push({ type: 'craftCrew', craft: c.id, crew: c.crew }); }
      }
    }
    if (!c.sunk && !c.landed && c.crew <= 0 && !c.passengers.length) continue; // adrift with nobody at the oars
    if (c.sunk || c.landed) {
      if (c.landed && c.passengers.length) disembark(b, c);
      continue;
    }
    const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
    if (d < 0.01) { c.landed = true; continue; }
    const step = Math.min(c.speed * (c.crew > 0 ? 1 : 0.5), d); // passengers row badly
    const nx = c.x + (dx / d) * step, ny = c.y + (dy / d) * step;
    const ti = Math.round(ny) * b.W + Math.round(nx);
    c.x = nx; c.y = ny;
    if (!isWater(b.terrain[ti])) { c.landed = true; b.events.push({ type: 'land', craft: c.id }); }
    for (const id of c.passengers) { const u = b.units[id]; u.x = Math.round(c.x); u.y = Math.round(c.y); }
  }
}
function disembark(b, c) {
  const start = Math.round(c.y) * b.W + Math.round(c.x);
  // BFS outward from craft across land for free tiles
  const seen = new Set([start]);
  const q = [start];
  const keep = [];
  for (const id of c.passengers) {
    const u = b.units[id];
    let placed = false;
    for (let h = 0; h < q.length && h < 400; h++) {
      const i = q[h], x = i % b.W, y = (i / b.W) | 0;
      if (canStand(b, x, y, u.def.size, -1, u.side)) {
        u.x = x; u.y = y; u.px = Math.round(c.x); u.py = Math.round(c.y);
        u.aboard = -1; occupy(b, u, 1); placed = true; break;
      }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, n = ny * b.W + nx;
        if (nx >= 0 && ny >= 0 && nx < b.W && ny < b.H && !b.blockMove[n] && b.terrain[n] !== DEEP && !seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    if (!placed) keep.push(id);
  }
  c.passengers = keep;
}

// ---------- squads ----------
export function squadUnits(b, sq) { return sq.members.map((id) => b.units[id]).filter((u) => u.alive); }

function updateSquad(b, sq) {
  const us = squadUnits(b, sq);
  sq.alive = us.length;
  if (!us.length) return;
  let cx = 0, cy = 0;
  for (const u of us) { cx += u.x; cy += u.y; }
  sq.cx = cx / us.length; sq.cy = cy / us.length;
  if (us.every((u) => u.aboard >= 0)) return;

  const enemies = b.squads.filter((s) => s.side !== sq.side && s.alive > 0 && squadUnits(b, s).some((u) => u.aboard < 0));
  if (!enemies.length) { sq.target = -1; return; }
  const dTo = (s) => Math.hypot(s.cx - sq.cx, s.cy - sq.cy);
  const nearest = enemies.reduce((a, c) => (dTo(c) < dTo(a) ? c : a));

  // Defensive posture: hold until the enemy closes in
  if (sq.state === 'hold') {
    if (dTo(nearest) < 12 + (sq.role === 'artillery' ? 4 : 0)) sq.state = 'advance';
    else { sq.target = nearest.id; return; }
  }

  // Morale: broken squads fall back and merge into a healthier friendly squad
  const ratio = sq.alive / sq.initial;
  const myHp = sideHp(b, sq.side), theirHp = sideHp(b, 1 - sq.side);
  const shaken = b.cmd.shock[sq.side] > b.tick && sq.leaderless; // their commander has just fallen
  if (sq.state !== 'regroup' && sq.state !== 'fallback' && !sq.rallied && sq.initial >= 3 && ((ratio <= 0.4 && myHp < theirHp * 0.9) || (shaken && ratio <= 0.75))) {
    const pt = fallbackFor(b, sq);
    if (pt) {
      sq.prev = sq.state; sq.state = 'fallback'; sq.rallyPt = pt; sq.rallyUntil = b.tick + 150; sq.rallied = true;
      b.events.push({ type: 'fallback', squad: sq.id, side: sq.side, name: (us[0].baseDef || us[0].def).name, to: pt.kind });
    }
  }
  if (sq.state === 'fallback') {
    const pt = sq.rallyPt;
    if (Math.hypot(pt.x - sq.cx, pt.y - sq.cy) < 4 || b.tick > sq.rallyUntil) {
      // steadied at the rally point: reorganise and go back in
      sq.state = sq.prev === 'hold' ? 'hold' : 'advance'; sq.initial = Math.max(1, sq.alive); sq.leaderless = false;
      b.events.push({ type: 'rallied', squad: sq.id, side: sq.side, name: (us[0].baseDef || us[0].def).name });
    } else { sq.target = nearest.id; return; }
  }
  if (sq.state !== 'regroup' && ratio <= 0.34 && sq.initial >= 3 && myHp < theirHp * 0.8) {
    const friends = b.squads.filter((s) => s.side === sq.side && s.id !== sq.id && s.alive >= 3 && s.role === sq.role);
    if (friends.length) {
      sq.state = 'regroup';
      sq.rally = friends.reduce((a, c) => (Math.hypot(c.cx - sq.cx, c.cy - sq.cy) < Math.hypot(a.cx - sq.cx, a.cy - sq.cy) ? c : a)).id;
      b.events.push({ type: 'regroup', squad: sq.id, side: sq.side, name: (us[0].baseDef || us[0].def).name });
    }
  }
  if (sq.state === 'regroup') {
    const host = b.squads[sq.rally];
    if (!host || host.alive === 0) { sq.state = 'advance'; }
    else if (Math.hypot(host.cx - sq.cx, host.cy - sq.cy) < 3) {
      for (const u of us) { u.squad = host.id; host.members.push(u.id); }
      host.initial += us.length;
      sq.members = []; sq.alive = 0;
      return;
    } else return;
  }

  let target = nearest;
  if (sq.role === 'air') {
    const soft = enemies.filter((s) => s.role === 'artillery' || s.role === 'support' || s.role === 'siege');
    if (soft.length) target = soft.reduce((a, c) => (dTo(c) < dTo(a) ? c : a));
  }
  if (sq.role === 'skirmisher') {
    const soft = enemies.filter((s) => s.role === 'artillery' || s.role === 'support');
    if (soft.length) {
      target = soft.reduce((a, c) => (dTo(c) < dTo(a) ? c : a));
      const screen = enemies.some((s) => s.role === 'frontline');
      if (screen && sq.state === 'advance' && dTo(target) > 10 && !sq.flanked) {
        // swing around the side of the map nearest to us
        const fy = sq.cy < b.H / 2 ? 2 : b.H - 3;
        sq.state = 'flank'; sq.flanked = true; sq.flankUntil = b.tick + 45;
        sq.waypoint = { x: Math.round(Math.max(1, Math.min(b.W - 2, target.cx))), y: fy };
        b.events.push({ type: 'flank', squad: sq.id, side: sq.side, name: (us[0].baseDef || us[0].def).name });
      }
    }
  }
  if (sq.state === 'flank') {
    const w = sq.waypoint;
    if (b.tick > sq.flankUntil || Math.hypot(w.x - sq.cx, w.y - sq.cy) < 5 || dTo(nearest) < 4) sq.state = 'advance';
  }
  sq.target = target.id;

  // Focus fire: weakest reachable unit of the target squad
  let best = null, bs = Infinity;
  for (const u of squadUnits(b, target)) {
    if (u.aboard >= 0 && sq.role !== 'artillery') continue;
    const eff = u.hp - u.pending;
    if (eff <= 0) continue;
    const s = eff + 0.5 * Math.hypot(u.x - sq.cx, u.y - sq.cy);
    if (s < bs) { bs = s; best = u; }
  }
  sq.focus = best ? best.id : -1;
}

// ---------- units ----------
// Repair crews look for damaged buildings and guns that are theirs or nobody's, walk to them and mend them.
function repairDuty(b, u, mend) {
  if (nearestEnemyDist(b, u, 3).d <= 2) return false; // fight first when cornered
  const mine = (side) => side === undefined || side === null || side === u.side;
  if (!u.job || b.tick % 10 === 0) {
    let best = null, bd = Infinity;
    b.structures.forEach((s, idx) => {
      if (s.destroyed || !s.maxHp || STRUCTURES[s.type].weapon || s.hp >= s.maxHp || !mine(s.side)) return;
      const d = Math.hypot(s.x + s.w / 2 - u.x, s.y + s.h / 2 - u.y) - (1 - s.hp / s.maxHp) * 6;
      if (d < bd) { bd = d; best = { s: idx }; }
    });
    for (const g of b.guns) {
      if (g.destroyed || g.hp >= g.maxHp || !mine(g.owner)) continue;
      const d = Math.hypot(g.cx - u.x, g.cy - u.y) - (1 - g.hp / g.maxHp) * 6 - 3;
      if (d < bd) { bd = d; best = { g: g.id }; }
    }
    u.job = best;
  }
  const j = u.job;
  if (!j) return false;
  const box = j.g !== undefined ? b.guns[j.g] : b.structures[j.s];
  const done = j.g !== undefined ? box.destroyed || box.hp >= box.maxHp : box.destroyed || box.hp >= box.maxHp;
  if (done) { u.job = null; return false; }
  const gapX = Math.max(box.x - u.x, u.x - (box.x + box.w - 1), 0), gapY = Math.max(box.y - u.y, u.y - (box.y + box.h - 1), 0);
  if (Math.max(gapX, gapY) <= 1) {
    if (u.cd > 0) return true;
    box.hp = Math.min(box.maxHp, box.hp + (j.g !== undefined ? mend.amount : mend.amount * 3));
    u.cd = u.def.speed; u.lastAttack = b.tick;
    face(u, box.x + (box.w >> 1), box.y + (box.h >> 1));
    b.events.push({ type: 'repair', from: u.id, s: j.s, gun: j.g, hp: box.hp });
    return true;
  }
  const f = field(b, `mend:${j.g !== undefined ? 'g' + j.g : j.s}`, 40, () => {
    const out = [];
    for (let y = box.y - 1; y <= box.y + box.h; y++) for (let x = box.x - 1; x <= box.x + box.w; x++) if (walkable(b, x, y) && (x < box.x || y < box.y || x >= box.x + box.w || y >= box.y + box.h)) out.push(y * b.W + x);
    return out;
  });
  if (!f || f[u.y * b.W + u.x] >= INF) { u.job = null; return false; }
  walk(b, u, f, 1, 0);
  return true;
}

function ability(u, type) { return u.def.abilities.find((a) => a.type === type); }

function unitRange(b, u) {
  let r = u.def.range;
  if (u.def.style !== 'melee' && u.aboard < 0) r += u.def.fly ? 1 : Math.min(3, b.level[u.y * b.W + u.x]);
  return r;
}
// melee can't reach a flier in the air, or a foe two levels above or below
function canReach(b, u, t) {
  if (u.def.style !== 'melee') return true;
  const ha = unitHeight(b, u), ht = unitHeight(b, t);
  if (isAirborne(b, u)) return true;
  if (ht === 4) return false;
  return Math.abs(ha - ht) <= 1;
}
const sees = (b, u, t) => losCheck(b, u.x, u.y, t.x, t.y, unitHeight(b, u), unitHeight(b, t));

function pickTarget(b, u, range) {
  const sq = b.squads[u.squad];
  const focus = sq && sq.focus >= 0 ? b.units[sq.focus] : null;
  const inReach = (t) => t.alive && t.side !== u.side && (t.aboard < 0 || u.def.style !== 'melee') && t.hp - t.pending > 0 && canReach(b, u, t);
  if (focus && inReach(focus) && focus.aboard < 0 && unitDist(u, focus) <= range && (range <= 1 || sees(b, u, focus))) return focus;
  let best = null, bs = Infinity;
  near(b, u.x, u.y, range + 3, (t) => {
    if (!inReach(t) || t.aboard >= 0) return;
    const d = unitDist(u, t);
    if (d > range) return;
    if (range > 1 && d > 1 && !sees(b, u, t)) return;
    // prefer low effective hp, close, and squishy roles
    const s = (t.hp - t.pending) + d * 2 + (t.def.role === 'artillery' || t.def.role === 'support' ? -4 : 0);
    if (s < bs) { bs = s; best = t; }
  });
  return best;
}

export function nearestEnemyDist(b, u, r) {
  let best = Infinity, who = null;
  near(b, u.x, u.y, r, (t) => {
    if (!t.alive || t.side === u.side || t.aboard >= 0) return;
    const d = unitDist(u, t);
    if (d < best) { best = d; who = t; }
  });
  return { d: best, t: who };
}

function unitTick(b, u) {
  b.moverSide = u.side;
  // Status effects
  if (u.poison && b.tick >= u.poison.next) {
    damage(b, u, u.poison.dmg, null, 'poison');
    u.poison.left--; u.poison.next = b.tick + 5;
    if (u.poison.left <= 0 || !u.alive) u.poison = null;
    if (!u.alive) return;
  }
  const regen = ability(u, 'regen');
  if (regen && b.tick % regen.every === 0 && u.hp < u.def.hp) u.hp = Math.min(u.def.hp, u.hp + regen.amount);
  if (u.cd > 0) u.cd--;
  // fliers tire: after `stamina` ticks aloft they must land and rest
  if (u.def.fly && u.aboard < 0) {
    if (isAirborne(b, u)) {
      u.airTime = (u.airTime || 0) + 1;
      if (u.airTime > (u.def.stamina || 250)) {
        u.airTime = 0;
        if (isWater(b.terrain[u.y * b.W + u.x])) { u.seekLand = true; u.airTime = (u.def.stamina || 250); }
        else {
          u.seekLand = false;
          u.landedUntil = b.tick + 40;
          b.events.push({ type: 'ability', id: u.id, name: 'rest' });
        }
      }
    }
  }

  if (u.seekLand) { flyToward(b, u, null, 0); return; }

  // Embarked: ranged/magic passengers can shoot from the boat
  if (u.aboard >= 0) {
    if (u.def.style !== 'melee' && u.cd <= 0) {
      const t = pickTarget(b, u, u.def.range);
      if (t) attack(b, u, t);
    }
    return;
  }

  const stomp = ability(u, 'stomp');
  if (stomp && u.cd <= 0 && b.tick % stomp.every === 0) {
    let hits = 0;
    near(b, u.x, u.y, stomp.radius + u.def.size, (t) => {
      if (!t.alive || t.side === u.side || t.aboard >= 0 || unitDist(u, t) > stomp.radius) return;
      const dmg = b.rng.int(0, stomp.maxHit);
      damage(b, t, dmg, u, 'stomp'); hits++;
    });
    if (hits) { b.events.push({ type: 'ability', id: u.id, name: 'stomp', radius: stomp.radius }); u.cd = u.def.speed; return; }
  }

  // Healers
  const heal = ability(u, 'heal');
  if (heal && u.cd <= 0 && (u.heals || 0) < (heal.charges || 20)) {
    let best = null, bs = 0.75;
    near(b, u.x, u.y, heal.range + 1, (a) => {
      if (!a.alive || a.side !== u.side || a.aboard >= 0 || unitDist(u, a) > heal.range) return;
      const r = a.hp / a.def.hp;
      if (r < bs) { bs = r; best = a; }
    });
    if (best) {
      const amt = b.rng.int(Math.ceil(heal.amount / 2), heal.amount);
      best.hp = Math.min(best.def.hp, best.hp + amt);
      u.heals = (u.heals || 0) + 1; // runes and prayer run out
      u.cd = u.def.speed;
      b.events.push({ type: 'heal', from: u.id, to: best.id, amount: amt });
      return;
    }
  }

  if (u.spec !== 'line' && specDuty(b, u)) return;
  const mend = ability(u, 'repair') || (u.spec === 'engineer' ? { amount: 22 } : null);
  if (mend && repairDuty(b, u, mend)) return;

  const sq = b.squads[u.squad];
  const range = unitRange(b, u);
  const target = pickTarget(b, u, range);

  if (target) {
    face(u, target.x, target.y);
    if (u.cd <= 0) { attack(b, u, target); return; }
    // Kite: ranged units step back from adjacent melee between shots
    if (u.def.style !== 'melee' && u.cd >= 2 && unitDist(u, target) <= 1 && target.def.style === 'melee') kite(b, u, target);
    return;
  }

  // Crafts as targets for ranged/magic defenders
  if (u.def.style !== 'melee' && u.cd <= 0 && b.crafts.length) {
    let craft = null, cd = Infinity;
    for (const c of b.crafts) {
      if (c.sunk || c.side === u.side || c.hp - c.pending <= 0 || (c.landed ? !(c.crew > 0) : !c.passengers.length && !(c.crew > 0))) continue;
      const d = Math.max(Math.abs(c.x - u.x), Math.abs(c.y - u.y));
      if (d <= range && d < cd) { cd = d; craft = c; }
    }
    if (craft) { attackCraft(b, u, craft, cd); return; }
  }
  if (u.def.style !== 'melee' && u.cd <= 0 && b.ships.length && unitVsShip(b, u, range)) return;
  if (u.def.style !== 'melee' && u.cd <= 0 && b.airships.length && unitVsAirship(b, u, range)) return;
  if (u.def.fly && u.def.style === 'melee' && b.airships.length && flierVsAirship(b, u)) return;
  if (u.def.fly) { flyToward(b, u, sq, range); return; }

  // Siege engines and sappers make for the enemy's gates and walls
  if (u.def.role === 'siege' && b.structures.some((s) => !s.destroyed && s.hp && ((s.side !== undefined && s.side !== null && s.side !== u.side) || STRUCTURES[s.type].door))) {
    const f = field(b, 'siege', 10, () => {
      const out = [];
      b.structures.forEach((s, idx) => {
        if (s.destroyed || !s.hp) return;
        const enemy = (s.side !== undefined && s.side !== null && s.side !== u.side) || (STRUCTURES[s.type].door && (s.side ?? 1) !== u.side);
        if (!enemy) return;
        for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) out.push(y * b.W + x);
        void idx;
      });
      return out;
    });
    if (f) { walk(b, u, f, 1); return; }
  }

  // Defending shooters man the walls and towers and stay up there
  if (b.sides[u.side].posture === 'defend' && u.def.style !== 'melee' && !u.def.fly && b.hasRamparts) {
    const hi = u.y * b.W + u.x, lv = b.level[hi];
    const stair = (i) => b.sid[i] && STRUCTURES[b.structures[b.sid[i] - 1].type].model === 'stairs';
    const nearStair = (i) => { const x = i % b.W, y = (i / b.W) | 0; for (const [dx, dy] of DIRS) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < b.W && yy < b.H && stair(yy * b.W + xx)) return true; } return stair(i); };
    const posted = lv > 0 && !nearStair(hi);
    if (posted && b.tick - u.lastAttack < 220) return;
    if (!posted) {
      const f = field(b, 'ramparts', 60, () => {
        const out = [];
        for (let i = 0; i < b.W * b.H; i++) if (b.level[i] > 0 && !b.blockMove[i] && b.door[i] < 0 && !isWater(b.terrain[i]) && !nearStair(i)) out.push(i);
        return out;
      });
      const d = f ? f[hi] : INF;
      if (d < 18 && (b.tick - u.lastAttack > 6 || d < 6 || lv > 0)) { walk(b, u, f, 1, 0); return; }
    }
  }

  // Crew a gun, or seize one whose crew has fallen
  const enemyNear = b.guns.length ? nearestEnemyDist(b, u, 6).d : Infinity;
  const gun = gunDuty(b, u, sq, enemyNear);
  if (gun) {
    if (onGunRing(b, gun, u)) return;
    const f = field(b, `g${gun.id}`, 9999, () => gun.ring.filter((i) => walkable(b, i % b.W, (i / b.W) | 0)));
    if (f) walk(b, u, f, 1, 0);
    return;
  }

  if (!sq || sq.target < 0 && sq.state !== 'regroup') {
    // No squad objective: chase anything
    const f = field(b, `e${u.side}`, 2, () => unitTiles(b, b.units.filter((t) => t.side !== u.side)));
    if (f) walk(b, u, f, range);
    return;
  }
  if (sq.state === 'hold') {
    const ne = nearestEnemyDist(b, u, 7);
    if (ne.d > 6) return;
  }

  let f = null;
  const local = nearestEnemyDist(b, u, 7);
  if (sq.state === 'fallback') {
    const pt = sq.rallyPt;
    f = field(b, `fb${pt.x},${pt.y}`, 60, () => [pt.y * b.W + pt.x]);
    if (f) { walk(b, u, f, 1, 2); return; }
  }
  if (sq.state === 'regroup') {
    const host = b.squads[sq.rally];
    f = host && field(b, `s${host.id}`, 4, () => unitTiles(b, squadUnits(b, host)));
  } else if (sq.state === 'flank' && local.d > 3) {
    const w = sq.waypoint;
    f = field(b, `w${sq.id}`, 9999, () => [w.y * b.W + w.x]);
  } else if (sq.role === 'support' && local.d > range + 2) {
    // Follow the most battered friendly frontline squad
    const friends = b.squads.filter((s) => s.side === u.side && s.alive > 0 && s.role !== 'support');
    if (friends.length) {
      const host = friends.reduce((a, c) => (c.alive / c.initial < a.alive / a.initial ? c : a));
      f = field(b, `s${host.id}`, 4, () => unitTiles(b, squadUnits(b, host)));
      if (f && f[u.y * b.W + u.x] <= 2) return;
    }
  } else if (local.d <= 6) {
    f = field(b, `e${u.side}`, 2, () => unitTiles(b, b.units.filter((t) => t.side !== u.side)));
  } else {
    const ts = b.squads[sq.target];
    f = ts && field(b, `s${ts.id}`, 4, () => unitTiles(b, squadUnits(b, ts)));
  }
  if (!f) f = field(b, `e${u.side}`, 2, () => unitTiles(b, b.units.filter((t) => t.side !== u.side)));
  if (f) walk(b, u, f, range);
}

function face(u, tx, ty) {
  if (tx !== u.x || ty !== u.y) u.face = Math.atan2(ty - u.y, tx - u.x);
}

export function walk(b, u, f, range, stop = null) {
  const steps = u.def.move;
  for (let s = 0; s < steps; s++) {
    const hi = u.y * b.W + u.x;
    const here = f[hi];
    if (here <= (stop ?? Math.max(1, range === 1 ? 1 : range - 1))) return; // close enough for this weapon
    let best = -1, bv = here, bx = 0, by = 0, side = null;
    for (const [dx, dy] of DIRS) {
      const nx = u.x + dx, ny = u.y + dy;
      if (nx < 0 || ny < 0 || nx >= b.W || ny >= b.H) continue;
      const n = ny * b.W + nx;
      if (dx && dy && (!passable(b, u.y * b.W + nx, u.side) || !passable(b, ny * b.W + u.x, u.side))) continue;
      if (!stepOk(b, hi, n)) continue;
      const v = f[n] + (b.rng.next() * 0.5);
      if (v < bv && canStand(b, nx, ny, u.def.size, u.id, u.side)) { bv = v; best = 1; bx = nx; by = ny; }
      else if (best < 0 && f[n] === here && !side && canStand(b, nx, ny, u.def.size, u.id, u.side)) side = [nx, ny];
    }
    // blocked by a crowd: sometimes step sideways to flow around it
    if (best < 0 && side && b.rng.next() < 0.4) { best = 1; bx = side[0]; by = side[1]; }
    if (best < 0) {
      if (s === 0) { const br = breachTarget(b, u, f, here); if (br !== null) attackStructure(b, u, br); }
      return;
    }
    occupy(b, u, 0);
    face(u, bx, by);
    u.x = bx; u.y = by; u.moved++;
    occupy(b, u, 1);
  }
}

function kite(b, u, threat) {
  if (u.def.fly) return;
  let best = null, bv = unitDist(u, threat);
  for (const [dx, dy] of DIRS) {
    const nx = u.x + dx, ny = u.y + dy;
    if (!canStand(b, nx, ny, u.def.size, u.id, u.side) || !stepOk(b, u.y * b.W + u.x, ny * b.W + nx)) continue;
    const d = gap(nx, ny, u.def.size, threat.x, threat.y, threat.def.size);
    if (d > bv) { bv = d; best = [nx, ny]; }
  }
  if (!best) return;
  occupy(b, u, 0); u.x = best[0]; u.y = best[1]; occupy(b, u, 1);
}

function attack(b, u, t) {
  const dist = unitDist(u, t);
  const style = u.def.style;
  let dRoll = defenceRoll(t.def, style);
  const th = t.aboard < 0 && !isAirborne(b, t) ? b.level[t.y * b.W + t.x] : 0;
  if (th) dRoll *= 1 + 0.06 * th;
  if (style !== 'melee' && dist > 1 && sees(b, u, t) === 2) dRoll *= 1.35;
  if (style === 'melee' && isAirborne(b, u)) u.landedUntil = b.tick + 3; // swoops down to strike

  let mult = 1;
  const enrage = ability(u, 'enrage');
  if (enrage && u.hp / u.def.hp < enrage.threshold) mult *= enrage.mult;
  const charge = ability(u, 'charge');
  if (charge && u.moved >= 3) { mult *= charge.mult; b.events.push({ type: 'ability', id: u.id, name: 'charge' }); }
  u.moved = 0;

  // Special breath / volley replaces the normal attack every N swings
  const special = ability(u, 'breath');
  u.attacks++;
  if (special && u.attacks % special.every === 0) {
    b.events.push({ type: 'ability', id: u.id, name: 'breath', to: t.id, radius: special.radius });
    near(b, t.x, t.y, special.radius + 2, (v) => {
      if (!v.alive || v.side === u.side || v.aboard >= 0 || unitDist(t, v) > special.radius) return;
      queueHit(b, u, v, b.rng.int(0, special.maxHit), 2, 'magic');
    });
    u.cd = u.def.speed; u.lastAttack = b.tick;
    return;
  }

  const hit = b.rng.next() < hitChance(u.def.aRoll, dRoll);
  let dmg = hit ? b.rng.int(0, Math.floor(u.def.max * mult)) : 0;
  const delay = hitDelay(style, dist);
  queueHit(b, u, t, dmg, delay, style, hit);
  b.events.push({ type: 'attack', from: u.id, to: t.id, style, delay, proj: u.def.projectile || style });
  // matched combat: two melee fighters of a size, toe to toe, play the blow out together
  if (style === 'melee' && dist <= 1 && t.def.style === 'melee' && t.def.size === u.def.size && t.aboard < 0 && !isAirborne(b, t) && !isAirborne(b, u)
    && !(t.duelUntil > b.tick) && !(u.duelUntil > b.tick) && b.rng.chance(0.45)) {
    u.duelUntil = t.duelUntil = b.tick + 2;
    face(t, u.x, u.y); face(u, t.x, t.y);
    b.events.push({ type: 'duel', a: u.id, d: t.id, kind: t.hp - t.pending <= 0 ? 'kill' : dmg > 0 ? 'hit' : 'parry', delay });
  }

  const splash = ability(u, 'cleave') || ability(u, 'splash');
  if (splash) {
    near(b, t.x, t.y, splash.radius + 2, (v) => {
      if (v === t || !v.alive || v.side === u.side || v.aboard >= 0 || unitDist(t, v) > splash.radius) return;
      const h2 = b.rng.next() < hitChance(u.def.aRoll, defenceRoll(v.def, style));
      queueHit(b, u, v, h2 ? Math.floor(b.rng.int(0, u.def.max) * (splash.mult || 0.5)) : 0, delay, style, h2);
    });
  }
  u.cd = u.def.speed; u.lastAttack = b.tick;
}

// src: where the blow came from when no unit dealt it ({ x, y, blast }), so the fallen lie the right way
export function queueHit(b, u, t, dmg, delay, style, hit = dmg > 0, src = null) {
  const prot = t.def.abilities.find((a) => a.type === 'protect' && a.style === style);
  if (prot) dmg = Math.floor(dmg * (1 - prot.reduction));
  t.pending += dmg;
  b.pending.push({ tick: b.tick + delay, from: u.id, to: t.id, dmg, style, hit, src });
}

function attackCraft(b, u, c, dist) {
  const hit = b.rng.next() < hitChance(u.def.aRoll, (30 + 9) * (40 + 64));
  const dmg = hit ? b.rng.int(0, u.def.max) : 0;
  const delay = hitDelay(u.def.style, dist);
  c.pending += dmg;
  b.pending.push({ tick: b.tick + delay, from: u.id, craft: c.id, dmg, style: u.def.style, hit });
  b.events.push({ type: 'attack', from: u.id, craft: c.id, style: u.def.style, delay, proj: u.def.projectile || u.def.style });
  u.cd = u.def.speed; u.lastAttack = b.tick;
  face(u, Math.round(c.x), Math.round(c.y));
}

function resolvePending(b) {
  const keep = [];
  for (const p of b.pending) {
    if (p.tick > b.tick) { keep.push(p); continue; }
    const from = b.units[p.from];
    if (p.air !== undefined) { resolveAirHit(b, p); continue; }
    if (p.ship !== undefined || p.gun !== undefined) { resolveSupportHit(b, p); continue; }
    if (p.craft !== undefined) {
      const c = b.crafts[p.craft];
      c.pending -= p.dmg;
      if (c.sunk) continue;
      c.hp -= p.dmg;
      b.events.push({ type: 'craftHit', craft: c.id, dmg: p.dmg, hit: p.hit });
      if (p.dmg > 0 && c.crew > 0 && b.rng.chance(0.3)) { c.crew--; b.events.push({ type: 'craftCrew', craft: c.id, crew: c.crew }); }
      if (c.hp <= 0 && c.landed) { c.crew = 0; c.wrecked = true; }
      if (c.hp <= 0 && !c.landed) {
        c.sunk = true;
        b.events.push({ type: 'sunk', craft: c.id });
        for (const id of c.passengers) {
          const v = b.units[id];
          v.alive = false; v.hp = 0;
          b.events.push({ type: 'death', id, drowned: true });
          if (from) from.kills++;
        }
        c.passengers = [];
      }
      continue;
    }
    const t = b.units[p.to];
    t.pending -= p.dmg;
    if (!t.alive) continue;
    damage(b, t, p.dmg, from, p.style, p.hit, p.src);
    if (from && p.dmg > 0 && t.alive) {
      const psn = ability(from, 'poison');
      if (psn && !t.poison && b.rng.chance(psn.chance || 0.25)) t.poison = { dmg: psn.damage, left: 5, next: b.tick + 5 };
    }
  }
  b.pending = keep;
}

export function damage(b, t, dmg, from, style, hit = true, src = null) {
  if (!t.alive) return;
  dmg = Math.min(dmg, t.hp);
  t.hp -= dmg;
  if (from) from.dealt += dmg;
  b.events.push({ type: 'hit', id: t.id, dmg, hit: hit || dmg > 0, style });
  if (t.hp <= 0) {
    t.alive = false;
    occupy(b, t, 0);
    if (from) from.kills++;
    const o = from || src;
    b.events.push({ type: 'death', id: t.id, by: from ? from.id : -1, style, ax: o ? o.x : undefined, ay: o ? o.y : undefined, blast: !!(src && src.blast) });
    onUnitDeath(b, t, from);
  }
}

export function runToEnd(b) {
  while (b.winner === null) stepBattle(b);
  return summary(b);
}

// ---------- sieges and flight ----------
// Something breakable touching the unit's footprint that lies on its route
function breachTarget(b, u, f, here) {
  const z = u.def.size, hi = u.y * b.W + u.x;
  let pick = null, pv = here + 0.5 + (z - 1);
  for (let k = 0; k < z; k++) for (const [x, y] of [[u.x + k, u.y - 1], [u.x + k, u.y + z], [u.x - 1, u.y + k], [u.x + z, u.y + k]]) {
    if (x < 0 || y < 0 || x >= b.W || y >= b.H) continue;
    const n = y * b.W + x;
    const brk = breakableFor(b, n, u.side);
    if (!brk || (passable(b, n, u.side) && stepOk(b, hi, n))) continue;
    const v = f[n] + breachCost(brk);
    if (v <= pv) { pv = v; pick = b.sid[n] - 1; }
  }
  return pick;
}
function attackStructure(b, u, idx) {
  if (u.cd > 0) return;
  const st = b.structures[idx];
  const siege = ability(u, 'siege');
  const mult = siege ? siege.mult : u.def.style === 'melee' ? 0.6 : 0.3;
  const dmg = Math.round(b.rng.int(Math.ceil(u.def.max / 3), Math.max(1, u.def.max)) * mult);
  face(u, st.x + st.w / 2 - 0.5, st.y + st.h / 2 - 0.5);
  u.cd = u.def.speed; u.lastAttack = b.tick;
  b.events.push({ type: 'attack', from: u.id, struct: idx, style: u.def.style, delay: 0, proj: u.def.projectile || u.def.style });
  damageStructure(b, idx, dmg, u);
}

function flyToward(b, u, sq, range) {
  if (u.landedUntil > b.tick) return; // resting on the ground
  if (u.seekLand) {
    // exhausted over open water: make for the nearest shore
    let best = null, bd = Infinity;
    for (let r = 1; r < 30 && !best; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = u.x + dx, y = u.y + dy;
      if (x < 0 || y < 0 || x >= b.W || y >= b.H || isWater(b.terrain[y * b.W + x])) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = { x, y, def: { size: 1 } }; }
    }
    if (best) { stepAir(b, u, best); return; }
  }
  let goal = sq && sq.focus >= 0 ? b.units[sq.focus] : null;
  if (!goal || !goal.alive || goal.aboard >= 0) {
    let bd = Infinity; goal = null;
    for (const t of b.units) {
      if (!t.alive || t.side === u.side || t.aboard >= 0) continue;
      const d = Math.hypot(t.x - u.x, t.y - u.y);
      if (d < bd) { bd = d; goal = t; }
    }
  }
  if (!goal) return;
  if (unitDist(u, goal) <= range) return;
  stepAir(b, u, goal);
}
export function stepAir(b, u, goal) {
  for (let s = 0; s < u.def.move; s++) {
    let best = null, bd = Math.hypot(goal.x - u.x, goal.y - u.y);
    for (const [dx, dy] of DIRS) {
      const nx = u.x + dx, ny = u.y + dy;
      if (!canStandAir(b, nx, ny, u.def.size, u.id)) continue;
      const d = Math.hypot(goal.x - nx, goal.y - ny) + b.rng.next() * 0.2;
      if (d < bd) { bd = d; best = [nx, ny]; }
    }
    if (!best) return;
    occupy(b, u, 0); face(u, best[0], best[1]);
    u.x = best[0]; u.y = best[1]; u.moved++;
    occupy(b, u, 1);
  }
}
