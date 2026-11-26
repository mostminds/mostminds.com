// Headless land / amphibious battle simulation. No DOM, no Three.js:
// the same code runs the live 3D view and the batch worker.
import { createRng } from './rng.js';
import { attackRoll, defenceRoll, hitChance, maxHit, hitDelay, combatLevel } from './combat.js';
import { generateTerrain, DEEP } from './terrain.js';
import { STRUCTURES } from '../data/structures.js';

const INF = 32767;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const SQUAD_SIZE = 8;
const CRAFT_CAPACITY = 6;

export function inferRole(def) {
  if (def.role) return def.role;
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
  return { w: rot ? def.h : def.w, h: rot ? def.w : def.h, def };
}

export function createBattle(scn, roster, seed = 1) {
  const W = scn.size, H = scn.size, N = W * H;
  const b = {
    W, H, mode: scn.mode, tick: 0, seed, rng: createRng(seed),
    terrain: scn.terrain || generateTerrain(scn.mode, W),
    blockMove: new Uint8Array(N), blockLos: new Uint8Array(N), cover: new Uint8Array(N),
    elevated: new Uint8Array(N), occ: new Int32Array(N),
    units: [], squads: [], crafts: [], pending: [], events: [], fields: new Map(),
    sides: scn.sides.map((s, i) => ({ name: s.name || `Side ${i + 1}`, posture: s.posture || 'attack', initial: 0 })),
    maxTicks: scn.maxTicks || 3000, winner: null, structures: [],
    buckets: new Map(),
  };
  const defs = {};
  const getDef = (id) => (defs[id] ||= roster[id] ? prepareDef(roster[id]) : null);

  // Structures
  for (const s of scn.structures || []) {
    const def = STRUCTURES[s.type];
    if (!def) continue;
    const { w, h } = structureFootprint(s);
    b.structures.push({ ...s, w, h });
    for (let y = s.y; y < s.y + h; y++) for (let x = s.x; x < s.x + w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (def.blocksMove) b.blockMove[i] = 1;
      if (def.blocksLos) b.blockLos[i] = 1;
      if (def.cover) b.cover[i] = 1;
      if (def.elevated) b.elevated[i] = 1;
    }
  }

  const addUnit = (def, side, x, y) => {
    const u = {
      id: b.units.length, side, def, x, y, px: x, py: y, hp: def.hp, cd: b.rng.int(0, def.speed),
      alive: true, aboard: -1, pending: 0, squad: -1, poison: null, kills: 0, dealt: 0,
      moved: 0, attacks: 0, face: side === 0 ? 0 : Math.PI, lastAttack: -99,
    };
    b.units.push(u);
    b.sides[side].initial++;
    if (x >= 0) occupy(b, u, 1);
    return u;
  };

  scn.sides.forEach((side, si) => {
    const fresh = [];
    for (const p of side.placed || []) {
      const def = getDef(p.unit);
      if (def && canStand(b, p.x, p.y, def.size, -1)) fresh.push(addUnit(def, si, p.x, p.y));
    }
    const pool = [];
    for (const g of side.groups || []) {
      const def = getDef(g.unit);
      if (!def) continue;
      for (let k = 0; k < Math.min(g.count, 500); k++) pool.push(def);
    }
    const order = { frontline: 0, skirmisher: 1, support: 2, artillery: 3 };
    pool.sort((a, c) => order[a.role] - order[c.role] || (a.id < c.id ? -1 : 1));

    if (scn.mode === 'amphibious' && si === 0) {
      deployByCraft(b, pool, addUnit, si);
    } else {
      const tiles = spawnTiles(b, scn.mode, si);
      let ti = 0;
      for (const def of pool) {
        while (ti < tiles.length && !canStand(b, tiles[ti] % W, (tiles[ti] / W) | 0, def.size, -1)) ti++;
        if (ti >= tiles.length) break;
        addUnit(def, si, tiles[ti] % W, (tiles[ti] / W) | 0);
      }
    }
    // Also squad manually-placed units
    void fresh;
  });

  buildSquads(b);
  return b;
}

function spawnTiles(b, mode, side) {
  const { W, H } = b;
  const tiles = [];
  const cy = H / 2;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (b.terrain[i] === DEEP || b.blockMove[i]) continue;
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
    for (let xx = 0; xx < W; xx++) if (b.terrain[y * W + xx] !== DEEP) { tx = xx; break; }
    const craft = {
      id: b.crafts.length, side, x, y, px: x, py: y, tx, ty: y, hp: 60, maxHp: 60,
      passengers: [], landed: false, sunk: false, speed: 0.55 + b.rng.next() * 0.1, pending: 0,
    };
    b.crafts.push(craft);
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
function walkable(b, x, y) {
  if (x < 0 || y < 0 || x >= b.W || y >= b.H) return false;
  const i = y * b.W + x;
  return !b.blockMove[i] && b.terrain[i] !== DEEP;
}
export function canStand(b, x, y, size, selfId) {
  for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) {
    if (!walkable(b, xx, yy)) return false;
    const o = b.occ[yy * b.W + xx];
    if (o && o - 1 !== selfId) return false;
  }
  return true;
}
function occupy(b, u, on) {
  const s = u.def.size;
  for (let yy = u.y; yy < u.y + s; yy++) for (let xx = u.x; xx < u.x + s; xx++) {
    if (xx < 0 || yy < 0 || xx >= b.W || yy >= b.H) continue;
    const i = yy * b.W + xx;
    if (on) b.occ[i] = u.id + 1; else if (b.occ[i] === u.id + 1) b.occ[i] = 0;
  }
}
function gap(ax, ay, as, bx, by, bs) {
  const dx = Math.max(0, ax - (bx + bs - 1), bx - (ax + as - 1));
  const dy = Math.max(0, ay - (by + bs - 1), by - (ay + as - 1));
  return Math.max(dx, dy);
}
export function unitDist(a, c) { return gap(a.x, a.y, a.def.size, c.x, c.y, c.def.size); }

function losCheck(b, x0, y0, x1, y1) {
  // returns 0 blocked, 1 clear, 2 clear-through-cover
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0, cov = false;
  while (!(x === x1 && y === y1)) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) break;
    const i = y * b.W + x;
    if (b.blockLos[i]) return 0;
    if (b.cover[i]) cov = true;
  }
  return cov ? 2 : 1;
}

function bfs(b, sources) {
  const N = b.W * b.H;
  const dist = new Int16Array(N).fill(INF);
  const q = new Int32Array(N);
  let head = 0, tail = 0;
  for (const s of sources) if (dist[s] === INF) { dist[s] = 0; q[tail++] = s; }
  while (head < tail) {
    const i = q[head++], x = i % b.W, y = (i / b.W) | 0, d = dist[i] + 1;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!walkable(b, nx, ny)) continue;
      if (dx && dy && (!walkable(b, x + dx, y) || !walkable(b, x, y + dy))) continue;
      const n = ny * b.W + nx;
      if (dist[n] > d) { dist[n] = d; q[tail++] = n; }
    }
  }
  return dist;
}
function field(b, key, ttl, sourceFn) {
  const c = b.fields.get(key);
  if (c && b.tick - c.tick < ttl) return c.dist;
  const src = sourceFn();
  if (!src.length) return null;
  const dist = bfs(b, src);
  b.fields.set(key, { tick: b.tick, dist });
  return dist;
}
function unitTiles(b, list) {
  const out = [];
  for (const u of list) {
    if (!u.alive || u.aboard >= 0) continue;
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
function near(b, x, y, r, fn) {
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
  return n;
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
function moveCrafts(b) {
  for (const c of b.crafts) {
    if (c.sunk || c.landed) {
      if (c.landed && c.passengers.length) disembark(b, c);
      continue;
    }
    const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
    if (d < 0.01) { c.landed = true; continue; }
    const step = Math.min(c.speed, d);
    const nx = c.x + (dx / d) * step, ny = c.y + (dy / d) * step;
    const ti = Math.round(ny) * b.W + Math.round(nx);
    c.x = nx; c.y = ny;
    if (b.terrain[ti] !== DEEP) { c.landed = true; b.events.push({ type: 'land', craft: c.id }); }
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
      if (canStand(b, x, y, u.def.size, -1)) {
        u.x = x; u.y = y; u.px = Math.round(c.x); u.py = Math.round(c.y);
        u.aboard = -1; occupy(b, u, 1); placed = true; break;
      }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, n = ny * b.W + nx;
        if (walkable(b, nx, ny) && !seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    if (!placed) keep.push(id);
  }
  c.passengers = keep;
}

// ---------- squads ----------
function squadUnits(b, sq) { return sq.members.map((id) => b.units[id]).filter((u) => u.alive); }

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
  if (sq.state !== 'regroup' && ratio <= 0.34 && sq.initial >= 3 && myHp < theirHp * 0.8) {
    const friends = b.squads.filter((s) => s.side === sq.side && s.id !== sq.id && s.alive >= 3 && s.role === sq.role);
    if (friends.length) {
      sq.state = 'regroup';
      sq.rally = friends.reduce((a, c) => (Math.hypot(c.cx - sq.cx, c.cy - sq.cy) < Math.hypot(a.cx - sq.cx, a.cy - sq.cy) ? c : a)).id;
      b.events.push({ type: 'regroup', squad: sq.id, side: sq.side, name: us[0].def.name });
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
        b.events.push({ type: 'flank', squad: sq.id, side: sq.side, name: us[0].def.name });
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
function ability(u, type) { return u.def.abilities.find((a) => a.type === type); }

function unitRange(b, u) {
  let r = u.def.range;
  if (u.def.style !== 'melee' && u.aboard < 0 && b.elevated[u.y * b.W + u.x]) r += 2;
  return r;
}

function pickTarget(b, u, range) {
  const sq = b.squads[u.squad];
  const focus = sq && sq.focus >= 0 ? b.units[sq.focus] : null;
  const inReach = (t) => t.alive && t.side !== u.side && (t.aboard < 0 || u.def.style !== 'melee') && t.hp - t.pending > 0;
  if (focus && inReach(focus) && focus.aboard < 0 && unitDist(u, focus) <= range && (range <= 1 || losCheck(b, u.x, u.y, focus.x, focus.y))) return focus;
  let best = null, bs = Infinity;
  near(b, u.x, u.y, range + 3, (t) => {
    if (!inReach(t) || t.aboard >= 0) return;
    const d = unitDist(u, t);
    if (d > range) return;
    if (range > 1 && d > 1 && !losCheck(b, u.x, u.y, t.x, t.y)) return;
    // prefer low effective hp, close, and squishy roles
    const s = (t.hp - t.pending) + d * 2 + (t.def.role === 'artillery' || t.def.role === 'support' ? -4 : 0);
    if (s < bs) { bs = s; best = t; }
  });
  return best;
}

function nearestEnemyDist(b, u, r) {
  let best = Infinity, who = null;
  near(b, u.x, u.y, r, (t) => {
    if (!t.alive || t.side === u.side || t.aboard >= 0) return;
    const d = unitDist(u, t);
    if (d < best) { best = d; who = t; }
  });
  return { d: best, t: who };
}

function unitTick(b, u) {
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
  if (heal && u.cd <= 0) {
    let best = null, bs = 0.75;
    near(b, u.x, u.y, heal.range + 1, (a) => {
      if (!a.alive || a.side !== u.side || a.aboard >= 0 || unitDist(u, a) > heal.range) return;
      const r = a.hp / a.def.hp;
      if (r < bs) { bs = r; best = a; }
    });
    if (best) {
      const amt = b.rng.int(Math.ceil(heal.amount / 2), heal.amount);
      best.hp = Math.min(best.def.hp, best.hp + amt);
      u.cd = u.def.speed;
      b.events.push({ type: 'heal', from: u.id, to: best.id, amount: amt });
      return;
    }
  }

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
      if (c.sunk || c.landed || c.side === u.side || !c.passengers.length || c.hp - c.pending <= 0) continue;
      const d = Math.max(Math.abs(c.x - u.x), Math.abs(c.y - u.y));
      if (d <= range && d < cd) { cd = d; craft = c; }
    }
    if (craft) { attackCraft(b, u, craft, cd); return; }
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

function walk(b, u, f, range) {
  const steps = u.def.move;
  for (let s = 0; s < steps; s++) {
    const here = f[u.y * b.W + u.x];
    if (here <= Math.max(1, range === 1 ? 1 : range - 1)) return; // close enough for this weapon
    let best = -1, bv = here, bx = 0, by = 0;
    for (const [dx, dy] of DIRS) {
      const nx = u.x + dx, ny = u.y + dy;
      if (nx < 0 || ny < 0 || nx >= b.W || ny >= b.H) continue;
      if (dx && dy && (!walkable(b, u.x + dx, u.y) || !walkable(b, u.x, u.y + dy))) continue;
      const v = f[ny * b.W + nx] + (b.rng.next() * 0.5);
      if (v < bv && canStand(b, nx, ny, u.def.size, u.id)) { bv = v; best = 1; bx = nx; by = ny; }
    }
    if (best < 0) return;
    occupy(b, u, 0);
    face(u, bx, by);
    u.x = bx; u.y = by; u.moved++;
    occupy(b, u, 1);
  }
}

function kite(b, u, threat) {
  let best = null, bv = unitDist(u, threat);
  for (const [dx, dy] of DIRS) {
    const nx = u.x + dx, ny = u.y + dy;
    if (!canStand(b, nx, ny, u.def.size, u.id)) continue;
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
  if (b.elevated[t.y * b.W + t.x] && t.aboard < 0) dRoll *= 1.1;
  if (style !== 'melee' && dist > 1 && losCheck(b, u.x, u.y, t.x, t.y) === 2) dRoll *= 1.35;

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

function queueHit(b, u, t, dmg, delay, style, hit = dmg > 0) {
  const prot = t.def.abilities.find((a) => a.type === 'protect' && a.style === style);
  if (prot) dmg = Math.floor(dmg * (1 - prot.reduction));
  t.pending += dmg;
  b.pending.push({ tick: b.tick + delay, from: u.id, to: t.id, dmg, style, hit });
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
    if (p.craft !== undefined) {
      const c = b.crafts[p.craft];
      c.pending -= p.dmg;
      if (c.sunk) continue;
      c.hp -= p.dmg;
      b.events.push({ type: 'craftHit', craft: c.id, dmg: p.dmg, hit: p.hit });
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
    damage(b, t, p.dmg, from, p.style, p.hit);
    if (from && p.dmg > 0 && t.alive) {
      const psn = ability(from, 'poison');
      if (psn && !t.poison && b.rng.chance(psn.chance || 0.25)) t.poison = { dmg: psn.damage, left: 5, next: b.tick + 5 };
    }
  }
  b.pending = keep;
}

function damage(b, t, dmg, from, style, hit = true) {
  if (!t.alive) return;
  dmg = Math.min(dmg, t.hp);
  t.hp -= dmg;
  if (from) from.dealt += dmg;
  b.events.push({ type: 'hit', id: t.id, dmg, hit: hit || dmg > 0, style });
  if (t.hp <= 0) {
    t.alive = false;
    occupy(b, t, 0);
    if (from) from.kills++;
    b.events.push({ type: 'death', id: t.id, by: from ? from.id : -1 });
  }
}

export function runToEnd(b) {
  while (b.winner === null) stepBattle(b);
  return summary(b);
}
