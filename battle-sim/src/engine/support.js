// Crewed guns (cannons, ballistae, mortars, shore batteries, harpoon guns)
// and fire-support ships inside land / amphibious battles.
import { defenceRoll, hitChance } from './combat.js';
import { DEEP } from './terrain.js';
import { STRUCTURES } from '../data/structures.js';
import { near, losCheck, queueHit, damageStructure, hitStructuresAt, unitHeight } from './battle.js';
import { airTargetFor } from './airship.js';

const NOBODY = { id: -1 };
const ucx = (u) => u.x + u.def.size / 2;
const ucy = (u) => u.y + u.def.size / 2;

/** register the gun standing on structure si (also used for guns built during the battle) */
export function addGun(b, si) {
  const s = b.structures[si];
  const def = STRUCTURES[s.type];
  if (!def.weapon) return;
  const ring = [];
  for (let y = s.y - 1; y <= s.y + s.h; y++) for (let x = s.x - 1; x <= s.x + s.w; x++) {
    if (x < 0 || y < 0 || x >= b.W || y >= b.H) continue;
    if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) continue;
    ring.push(y * b.W + x);
  }
  let elev = 0;
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) elev = Math.max(elev, b.level[y * b.W + x]);
  b.guns.push({
    id: b.guns.length, si, type: s.type, x: s.x, y: s.y, w: s.w, h: s.h, cx: s.x + s.w / 2, cy: s.y + s.h / 2,
    wpn: def.weapon, hp: def.hp, maxHp: def.hp, owner: s.side ?? null, cd: b.rng.int(0, 4), crew: [0, 0],
    aim: s.side === 1 ? Math.PI : 0, destroyed: false, claim: -1, ring, elev, lastFire: -99,
  });
}

export function initSupport(b, scn, shipDefs = {}) {
  b.guns = [];
  b.structures.forEach((s, si) => addGun(b, si));

  b.ships = [];
  scn.sides.forEach((side, si) => {
    const list = [];
    for (const g of side.ships || []) {
      const def = shipDefs[g.unit];
      if (def) for (let k = 0; k < Math.min(30, g.count); k++) list.push(def);
    }
    if (!list.length) return;
    // candidate deep-water spawn tiles: west sea for side A, the waters nearest the B army for side B
    const cand = [];
    let bx = 0, by = 0, n = 0;
    for (const u of b.units) if (u.side === 1 && u.aboard < 0) { bx += u.x; by += u.y; n++; }
    bx = n ? bx / n : b.W * 0.8; by = n ? by / n : b.H / 2;
    for (let y = 2; y < b.H - 2; y++) for (let x = 2; x < b.W - 2; x++) {
      if (b.terrain[y * b.W + x] !== DEEP) continue;
      if (si === 0 && x > b.W * 0.3) continue;
      if (si === 1 && x < b.W * 0.3) continue;
      cand.push({ x, y, k: si === 0 ? x * 1000 + Math.abs(y - b.H / 2) : Math.hypot(x - bx, y - by) });
    }
    cand.sort((a, c) => a.k - c.k);
    const used = [];
    for (const def of list) {
      const spot = cand.find((c) => used.every((u) => Math.hypot(u.x - c.x, u.y - c.y) > def.len + 1.5));
      if (!spot) break;
      used.push(spot);
      b.ships.push({
        id: b.ships.length, side: si, def, x: spot.x + 0.5, y: spot.y + 0.5, px: spot.x + 0.5, py: spot.y + 0.5,
        heading: si === 0 ? 0 : Math.PI, ph: si === 0 ? 0 : Math.PI, hp: def.hull, maxHp: def.hull,
        alive: true, cd: b.rng.int(0, 5), radius: def.len / 2, pending: 0, goal: null, lastFire: -99,
      });
      b.sides[si].ships = (b.sides[si].ships || 0) + 1;
    }
  });
}

export function supportTick(b) {
  for (const s of b.ships) { s.px = s.x; s.py = s.y; s.ph = s.heading; }
  for (const g of b.guns) gunTick(b, g);
  for (const s of b.ships) if (s.alive) shipTick(b, s);
}

// ---------- guns ----------
function gunTick(b, g) {
  if (g.destroyed) return;
  const c = [0, 0];
  for (const i of g.ring) {
    const o = b.occ[i];
    if (o) { const u = b.units[o - 1]; if (u.alive) c[u.side]++; }
  }
  g.crew = c;
  let owner = g.owner;
  if (c[0] && !c[1]) owner = 0; else if (c[1] && !c[0]) owner = 1;
  if (owner !== g.owner) {
    if (g.owner !== null) b.events.push({ type: 'gunCaptured', gun: g.id, side: owner });
    g.owner = owner;
  }
  if (g.cd > 0) g.cd--;
  if (g.owner === null || !c[g.owner] || c[1 - g.owner] || g.cd > 0) return;

  const w = g.wpn, R = w.range + g.elev * 2, minR = w.minRange || 0, side = g.owner;
  let best = null, bs = Infinity, kind = null;
  for (const s of b.ships) {
    if (!s.alive || s.side === side) continue;
    const d = Math.hypot(s.x - g.cx, s.y - g.cy) - s.radius;
    if (d > R || d < minR) continue;
    const sc = d - (w.prefersShips ? 40 : 8) * w.antiShip;
    if (sc < bs) { bs = sc; best = s; kind = 'ship'; }
  }
  for (const cr of b.crafts) {
    if (cr.sunk || cr.landed || cr.side === side || !cr.passengers.length || cr.hp - cr.pending <= 0) continue;
    const d = Math.hypot(cr.x + 0.5 - g.cx, cr.y + 0.5 - g.cy);
    if (d > R || d < minR) continue;
    const sc = d - 12 * w.antiShip;
    if (sc < bs) { bs = sc; best = cr; kind = 'craft'; }
  }
  if (w.antiAir) {
    const a = airTargetFor(b, side, g.cx, g.cy, R + 2);
    if (a) { const sc = Math.hypot(a.x - g.cx, a.y - g.cy) - 14; if (sc < bs) { bs = sc; best = a; kind = 'air'; } }
  }
  near(b, g.cx, g.cy, R + 1, (u) => {
    if (!u.alive || u.side === side || u.aboard >= 0) return;
    const air = unitHeight(b, u) === 4;
    if (air && !w.antiAir) return;
    const d = Math.hypot(ucx(u) - g.cx, ucy(u) - g.cy);
    if (d > R || d < minR) return;
    let sc = d + (w.prefersShips ? 6 : 0);
    if (sc - 12 > bs) return;
    if (!w.indirect && !losCheck(b, Math.floor(g.cx), Math.floor(g.cy), u.x, u.y, g.elev + 1, unitHeight(b, u))) return;
    if (w.splash) { let n = 0; near(b, u.x, u.y, w.splash + 1, (v) => { if (v.alive && v.side !== side && v.aboard < 0 && Math.max(Math.abs(v.x - u.x), Math.abs(v.y - u.y)) <= w.splash) n++; }); sc -= n * 3; }
    if (sc < bs) { bs = sc; best = u; kind = 'unit'; }
  });
  if (!best) return;

  const aRoll = (w.level + 9) * (w.bonus + 64);
  let tx, ty;
  if (kind === 'unit') { tx = ucx(best); ty = ucy(best); } else if (kind === 'craft') { tx = best.x + 0.5; ty = best.y + 0.5; } else { tx = best.x; ty = best.y; }
  const d = Math.hypot(tx - g.cx, ty - g.cy);
  const delay = 1 + Math.floor(d / (w.indirect ? 4 : 7));
  g.aim = Math.atan2(ty - g.cy, tx - g.cx);
  g.cd = c[side] >= 2 ? Math.round(w.speed * 0.8) : w.speed;
  g.lastFire = b.tick;
  b.events.push({ type: 'gunFire', gun: g.id, x1: tx, y1: ty, h1: kind === 'air' ? best.def.altitude : 0.3, delay, shot: w.shot });

  if (kind === 'unit') {
    blast(b, side, aRoll, w.maxHit, best, w.splash, delay);
    if (w.siege && unitHeight(b, best) < 4) hitStructuresAt(b, tx, ty, Math.max(0.6, w.splash), Math.round(b.rng.int(0, w.maxHit) * w.siege * 0.5));
  } else if (kind === 'air') {
    const hit = b.rng.next() < hitChance(aRoll, (30 + 9) * (best.def.armour * 2 + 64));
    b.pending.push({ tick: b.tick + delay, air: best.id, dmg: hit ? Math.round(b.rng.int(0, w.maxHit) * 1.5 * (100 / (100 + best.def.armour))) : 0, hit, by: side });
  } else if (kind === 'craft') {
    const hit = b.rng.next() < hitChance(aRoll, (30 + 9) * (40 + 64));
    const dmg = hit ? Math.round(b.rng.int(0, w.maxHit) * w.antiShip) : 0;
    best.pending += dmg;
    b.pending.push({ tick: b.tick + delay, from: -1, craft: best.id, dmg, hit, style: 'ranged' });
  } else {
    const hit = b.rng.next() < hitChance(aRoll, (30 + 9) * (best.def.armour * 2 + 64));
    const dmg = hit ? Math.round(b.rng.int(0, w.maxHit) * w.antiShip * (100 / (100 + best.def.armour))) : 0;
    b.pending.push({ tick: b.tick + delay, ship: best.id, dmg, hit });
  }
}

// Explosive or single hit on a unit plus splash on its neighbours
function blast(b, side, aRoll, max, t, splash, delay, accMul = 1) {
  const hit = b.rng.next() < hitChance(aRoll, defenceRoll(t.def, 'ranged')) * accMul;
  queueHit(b, NOBODY, t, hit ? b.rng.int(0, max) : 0, delay, 'ranged', hit);
  if (!splash) return;
  near(b, t.x, t.y, splash + 2, (v) => {
    if (v === t || !v.alive || v.side === side || v.aboard >= 0) return;
    if (Math.max(Math.abs(v.x - t.x), Math.abs(v.y - t.y)) > splash) return;
    const h2 = b.rng.next() < hitChance(aRoll, defenceRoll(v.def, 'ranged'));
    queueHit(b, NOBODY, v, h2 ? Math.floor(b.rng.int(0, max) * 0.5) : 0, delay, 'ranged', h2, { x: t.x, y: t.y, blast: true });
  });
}

// ---------- ships ----------
const isDeep = (b, x, y) => x >= 0 && y >= 0 && x < b.W && y < b.H && b.terrain[Math.floor(y) * b.W + Math.floor(x)] === DEEP;

function shipWeapon(s) {
  const c = s.def.cannons;
  if (c.perSide) return { n: c.perSide, dmg: c.dmg, range: c.range, reload: c.reload, acc: c.acc };
  const m = s.def.musket || { range: 5, dmg: [0, 3], reload: 4, acc: 0.5 };
  return { n: 1, dmg: m.dmg, range: m.range, reload: m.reload, acc: m.acc };
}

function shipTargets(b, s, R) {
  let best = null, bs = Infinity, kind = null, bd = 0;
  const consider = (obj, k, x, y, rad, bonus) => {
    const d = Math.hypot(x - s.x, y - s.y) - rad;
    if (d > R) return;
    const sc = d + bonus;
    if (sc < bs) { bs = sc; best = obj; kind = k; bd = d; }
  };
  for (const g of b.guns) if (!g.destroyed && g.owner !== null && g.owner !== s.side && g.crew[g.owner]) consider(g, 'gun', g.cx, g.cy, g.w / 2, -15);
  for (const o of b.ships) if (o.alive && o.side !== s.side) consider(o, 'ship', o.x, o.y, o.radius, -8);
  for (const c of b.crafts) if (!c.sunk && !c.landed && c.side !== s.side && c.passengers.length) consider(c, 'craft', c.x + 0.5, c.y + 0.5, 1, -4);
  near(b, s.x, s.y, R + 1, (u) => { if (u.alive && u.side !== s.side && u.aboard < 0 && unitHeight(b, u) < 4) consider(u, 'unit', ucx(u), ucy(u), 0, 0); });
  // enemy walls, gates and towers along the shore
  b.structures.forEach((st, idx) => {
    if (st.destroyed || !st.hp || st.side === undefined || st.side === null || st.side === s.side) return;
    consider({ idx, x: st.x + st.w / 2, y: st.y + st.h / 2 }, 'struct', st.x + st.w / 2, st.y + st.h / 2, Math.max(st.w, st.h) / 2, 6);
  });
  return best ? { obj: best, kind, d: bd } : null;
}

function shipTick(b, s) {
  if (s.cd > 0) s.cd--;
  const wpn = shipWeapon(s);
  const t = shipTargets(b, s, wpn.range);

  if (!t || t.d > wpn.range * 0.8) {
    if (!s.goal || b.tick % 6 === 0) s.goal = shipGoal(b, s);
    if (s.goal) sail(b, s, Math.atan2(s.goal.y - s.y, s.goal.x - s.x));
  }
  if (!t || s.cd > 0) return;
  const o = t.obj;
  let tx, ty;
  if (t.kind === 'unit') { tx = ucx(o); ty = ucy(o); } else if (t.kind === 'gun') { tx = o.cx; ty = o.cy; } else if (t.kind === 'craft') { tx = o.x + 0.5; ty = o.y + 0.5; } else { tx = o.x; ty = o.y; }
  const delay = 1 + Math.floor(t.d / 7);
  let wallDmg = 0;
  s.cd = wpn.reload; s.lastFire = b.tick;
  b.events.push({ type: 'shipFire', ship: s.id, x1: tx, y1: ty, delay, guns: wpn.n });
  const acc = (k) => wpn.acc * (1 - 0.4 * (t.d / wpn.range)) * k;
  for (let i = 0; i < wpn.n; i++) {
    if (t.kind === 'struct') {
      if (b.rng.next() < acc(1.2)) wallDmg += b.rng.int(wpn.dmg[0], wpn.dmg[1]) * 2;
    } else if (t.kind === 'unit') {
      const hit = b.rng.next() < acc(0.35); // round shot rarely finds a single soldier
      queueHit(b, NOBODY, o, hit ? b.rng.int(wpn.dmg[0], wpn.dmg[1]) : 0, delay, 'ranged', hit);
      if (!hit) wallDmg += Math.round(b.rng.int(wpn.dmg[0], wpn.dmg[1]) * 0.6);
      near(b, o.x, o.y, 3, (v) => {
        if (v === o || !v.alive || v.side === s.side || v.aboard >= 0 || Math.max(Math.abs(v.x - o.x), Math.abs(v.y - o.y)) > 1) return;
        if (b.rng.chance(0.15)) queueHit(b, NOBODY, v, Math.floor(b.rng.int(wpn.dmg[0], wpn.dmg[1]) * 0.5), delay, 'ranged', true);
      });
    } else if (t.kind === 'gun') {
      const hit = b.rng.next() < acc(1.1);
      b.pending.push({ tick: b.tick + delay, gun: o.id, dmg: hit ? b.rng.int(wpn.dmg[0], wpn.dmg[1]) : 0, hit });
    } else if (t.kind === 'craft') {
      const hit = b.rng.next() < acc(0.9);
      const dmg = hit ? b.rng.int(wpn.dmg[0], wpn.dmg[1]) : 0;
      o.pending += dmg;
      b.pending.push({ tick: b.tick + delay, from: -1, craft: o.id, dmg, hit, style: 'ranged' });
    } else {
      const hit = b.rng.next() < acc(Math.min(1.3, 0.75 + o.radius * 0.15));
      const dmg = hit ? Math.round(b.rng.int(wpn.dmg[0], wpn.dmg[1]) * (100 / (100 + o.def.armour))) : 0;
      b.pending.push({ tick: b.tick + delay, ship: o.id, dmg, hit });
    }
  }
  if (wallDmg) {
    if (t.kind === 'struct') damageStructure(b, o.idx, wallDmg, s);
    else hitStructuresAt(b, tx, ty, 0.8, wallDmg); // stray balls batter whatever is built near the target
  }
}

function shipGoal(b, s) {
  let best = null, bd = Infinity;
  const take = (x, y, bias = 0) => { const d = Math.hypot(x - s.x, y - s.y) + bias; if (d < bd) { bd = d; best = { x, y }; } };
  for (const g of b.guns) if (!g.destroyed && g.owner !== null && g.owner !== s.side) take(g.cx, g.cy, -10);
  for (const o of b.ships) if (o.alive && o.side !== s.side) take(o.x, o.y);
  for (const c of b.crafts) if (!c.sunk && !c.landed && c.side !== s.side) take(c.x + 0.5, c.y + 0.5);
  b.structures.forEach((st) => { if (!st.destroyed && st.hp && st.side !== undefined && st.side !== null && st.side !== s.side) take(st.x + st.w / 2, st.y + st.h / 2, 4); });
  if (!best) for (const u of b.units) if (u.alive && u.side !== s.side && u.aboard < 0) take(ucx(u), ucy(u), 5);
  return best;
}

function sail(b, s, desired) {
  const look = Math.max(2, s.def.len * 0.6);
  const offsets = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, 2.6, -2.6, Math.PI];
  let pick = null;
  for (const o of offsets) {
    const h = desired + o;
    let ok = true;
    for (const k of [1, look, look + 1.5]) if (!isDeep(b, s.x + Math.cos(h) * k, s.y + Math.sin(h) * k)) { ok = false; break; }
    if (ok) { pick = h; break; }
  }
  if (pick === null) { s.heading += 0.2; return; }
  const turn = (s.def.turn * Math.PI) / 180;
  const diff = Math.atan2(Math.sin(pick - s.heading), Math.cos(pick - s.heading));
  s.heading += Math.max(-turn, Math.min(turn, diff));
  const nx = s.x + Math.cos(s.heading) * s.def.speed, ny = s.y + Math.sin(s.heading) * s.def.speed;
  if (isDeep(b, nx, ny) && isDeep(b, nx + Math.cos(s.heading) * look * 0.6, ny + Math.sin(s.heading) * look * 0.6)) {
    // keep clear of other ships
    for (const o of b.ships) if (o !== s && o.alive && Math.hypot(o.x - nx, o.y - ny) < (o.radius + s.radius) * 0.8) return;
    s.x = nx; s.y = ny;
  }
}

// Ranged/magic units shooting at ships close to shore
export function unitVsShip(b, u, range) {
  let best = null, bd = Infinity;
  for (const s of b.ships) {
    if (!s.alive || s.side === u.side) continue;
    const d = Math.hypot(s.x - ucx(u), s.y - ucy(u)) - s.radius;
    if (d <= range && d < bd) { bd = d; best = s; }
  }
  if (!best) return false;
  const hit = b.rng.next() < hitChance(u.def.aRoll, (30 + 9) * (best.def.armour * 2 + 64));
  const dmg = hit ? Math.round(b.rng.int(0, u.def.max) * (100 / (100 + best.def.armour))) : 0;
  const delay = 1 + Math.floor(bd / 6);
  b.pending.push({ tick: b.tick + delay, ship: best.id, dmg, hit, from: u.id });
  b.events.push({ type: 'attack', from: u.id, ship: best.id, style: u.def.style, delay, proj: u.def.projectile || u.def.style });
  u.cd = u.def.speed; u.lastAttack = b.tick;
  u.face = Math.atan2(best.y - ucy(u), best.x - ucx(u));
  return true;
}

export function resolveSupportHit(b, p) {
  if (p.ship !== undefined) {
    const s = b.ships[p.ship];
    if (!s.alive) return;
    s.hp -= p.dmg;
    b.events.push({ type: 'shipHit', ship: s.id, dmg: p.dmg });
    if (s.hp <= 0) { s.alive = false; s.hp = 0; b.events.push({ type: 'shipSunk', ship: s.id }); }
  } else if (p.gun !== undefined) {
    const g = b.guns[p.gun];
    if (g.destroyed) return;
    g.hp -= p.dmg;
    b.events.push({ type: 'gunHit', gun: g.id, dmg: p.dmg });
    if (g.hp <= 0) { g.destroyed = true; g.hp = 0; b.events.push({ type: 'gunDestroyed', gun: g.id }); }
  }
}

// AI: send idle troops to crew friendly or abandoned guns, and to seize enemy guns whose crew is dead.
export function gunDuty(b, u, sq, enemyNear) {
  if (!b.guns.length || u.aboard >= 0) return null;
  if (u.gunId !== undefined && u.gunId >= 0) {
    const g = b.guns[u.gunId];
    if (g.destroyed || (g.crew[1 - u.side] && g.owner !== u.side)) { g.claim = -1; u.gunId = -1; return null; }
    // a gun with nothing to shoot at is abandoned so its crew rejoins the fight
    const idle = b.tick - Math.max(g.lastFire, u.gunSince);
    const patience = b.sides[u.side].posture === 'defend' ? 300 : 70;
    if (idle > patience && enemyNear > 6) { g.claim = -1; u.gunId = -1; g.idleUntil = b.tick + 200; return null; }
    return g;
  }
  if (enemyNear <= 5 || u.def.role === 'support' || u.def.role === 'skirmisher' || u.def.size > 1) return null;
  const reach = sq && (sq.state === 'hold' || sq.role === 'artillery') ? 14 : 8;
  let best = null, bd = Infinity;
  for (const g of b.guns) {
    if (g.destroyed || g.crew[u.side] || g.crew[1 - u.side] || g.idleUntil > b.tick) continue;
    const c = g.claim >= 0 ? b.units[g.claim] : null;
    if (c && c.alive && c.gunId === g.id) continue;
    const d = Math.hypot(g.cx - ucx(u), g.cy - ucy(u));
    if (d < reach && d < bd) { bd = d; best = g; }
  }
  if (!best) return null;
  best.claim = u.id; u.gunId = best.id; u.gunSince = b.tick;
  return best;
}

export function onGunRing(b, g, u) {
  return g.ring.includes(u.y * b.W + u.x);
}
