// Air wings in land and amphibious battles: what each of the eight kinds of aircraft (src/data/air) does.
// A flying unit with `airRole` runs its role's duty first each tick; when the role has nothing to do (no
// monsters for a hunter, no ships for a naval wing, no airship to guard for an escort) it fights as an
// ordinary flier. Role arts are read from `def.airArts` (schema: src/data/air/index.js).
//
// Events for the views (besides the usual attack / hit / death):
//   { type: 'airRole', id, role, kind, x, y, to?, n?, r?, delay? }
//     kind: drop (troops set down, n)        supply (crates lowered, n)      lift (n troops flown out to `to`)
//           bomb (a stick of n bombs, r)     strafe (a pass from x,y to `to`, n hit)   rocket (n rockets at x,y)
//           harpoon (to: unit id)            torpedo (from x,y to `to` {x,y})          dive (a diving strike at x,y, n hit)
//           intercept (to: unit id)          pd (a missile shot down near x,y)
// Status hooks this sets on units (read in battle.js): pinUntil (slowed: moves every other tick),
// landedUntil (grounded), blindUntil (shoots worse), poison.
import { near, queueHit, stepAir, spawnUnit, addSquad, freeTileNear, occupy, canStand, unitHeight, unitDist } from './battle.js';
import { unitVsAirship } from './airship.js';
import { addCrate } from './command.js';
import { hitChance, defenceRoll, hitDelay } from './combat.js';
import { isWater } from './terrain.js';

const NOBODY = { id: -1 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ucx = (u) => u.x + u.def.size / 2;
const ucy = (u) => u.y + u.def.size / 2;
const airborne = (b, u) => u.def.fly && !(u.landedUntil > b.tick);
const grounded = (b, u) => u.alive && u.aboard < 0 && u.x >= 0 && unitHeight(b, u) < 4;
const ev = (b, u, kind, x, y, extra = {}) => b.events.push({ type: 'airRole', id: u.id, role: u.def.airRole, kind, x, y, ...extra });

// ---------- shared helpers (also used by behemoth.js) ----------
/** the side's rally points (command layer), or [] */
export const pointsOf = (b, side) => (b.cmd ? b.cmd.points.filter((p) => p.side === side) : []);
/** where the side's line meets the enemy: its squad nearest an enemy squad, as {x, y} (or null) */
export function frontOf(b, side) {
  let best = null, bd = Infinity;
  for (const s of b.squads) {
    if (s.side !== side || s.alive <= 0 || s.role === 'air') continue;
    for (const e of b.squads) {
      if (e.side === side || e.alive <= 0 || e.role === 'air') continue;
      const d = Math.hypot(s.cx - e.cx, s.cy - e.cy);
      if (d < bd) { bd = d; best = { x: Math.round(s.cx), y: Math.round(s.cy) }; }
    }
  }
  return best;
}
/** enemies near a spot (ground troops only) */
export function enemiesNear(b, side, x, y, r) {
  let n = 0;
  near(b, x, y, r, (v) => { if (v.side !== side && grounded(b, v) && Math.abs(v.x - x) <= r && Math.abs(v.y - y) <= r) n++; });
  return n;
}
/** the side's rally point most under pressure, else the one nearest the front, else the front itself */
export function pressedPoint(b, side) {
  let best = null, bs = 0;
  for (const p of pointsOf(b, side)) { const s = enemiesNear(b, side, p.x, p.y, 8); if (s > bs) { bs = s; best = p; } }
  if (best) return { x: best.x, y: best.y, point: best };
  const f = frontOf(b, side);
  if (!f) return null;
  let np = null, nd = Infinity;
  for (const p of pointsOf(b, side)) { const d = Math.hypot(p.x - f.x, p.y - f.y); if (d < nd) { nd = d; np = p; } }
  return np && nd < 30 ? { x: np.x, y: np.y, point: np } : f;
}
/** somewhere safe behind the side's own lines: its rearmost rally point, or its own edge */
export function rearOf(b, side, y) {
  const pts = pointsOf(b, side);
  if (pts.length) return pts.reduce((a, c) => ((side === 0 ? c.x < a.x : c.x > a.x) ? c : a));
  return { x: side === 0 ? 3 : b.W - 4, y: clamp(Math.round(y), 3, b.H - 4) };
}
/** the densest enemy ground formation within range of (x, y): { x, y, n, sq } */
export function enemyCluster(b, side, x, y, range = Infinity) {
  let best = null, bs = 0;
  for (const s of b.squads) {
    if (s.side === side || s.alive <= 0 || s.role === 'air') continue;
    const d = Math.hypot(s.cx - x, s.cy - y);
    if (d > range) continue;
    const sc = s.alive / (1 + d / 20);
    if (sc > bs) { bs = sc; best = { x: s.cx, y: s.cy, n: s.alive, sq: s }; }
  }
  return best;
}
/** spawn n troops of `unitId` near (x, y) as a fresh squad; returns the units */
export function dropTroops(b, side, unitId, n, x, y) {
  const def = unitId && b.getDef(unitId);
  if (!def || def.fly) return [];
  const fresh = [];
  for (let k = 0; k < n; k++) {
    const spot = freeTileNear(b, clamp(Math.round(x), 1, b.W - 2), clamp(Math.round(y), 1, b.H - 2), def.size, side);
    if (spot) fresh.push(spawnUnit(b, def, side, spot[0], spot[1]));
  }
  if (fresh.length) addSquad(b, fresh, 'advance');
  return fresh;
}
/** blast on the ground: enemy troops (falloff), ships, guns, landing craft; structures via the air queue */
export function groundBlast(b, side, x, y, r, dmg, delay, opts = {}) {
  let n = 0;
  near(b, x, y, r + 2, (v) => {
    if (!v.alive || v.side === side || v.aboard >= 0 || (unitHeight(b, v) === 4 && !opts.air)) return;
    const d = Math.hypot(ucx(v) - x, ucy(v) - y);
    if (d > r + 0.5) return;
    queueHit(b, NOBODY, v, Math.round(b.rng.int(Math.floor(dmg / 3), dmg) * (1 - 0.5 * (d / (r + 0.5)))), delay, opts.style || 'ranged', true, { x, y, blast: true });
    if (opts.burn && !v.poison) v.poison = { dmg: opts.burn, left: 4, next: b.tick + delay + 3 };
    n++;
  });
  for (const s of b.ships) if (s.alive && s.side !== side && Math.hypot(s.x - x, s.y - y) <= r + s.radius * 0.6) b.pending.push({ tick: b.tick + delay, ship: s.id, dmg: Math.round(dmg * (opts.vsShip || 1) * (100 / (100 + (s.def.armour || 0)))), hit: true });
  for (const g of b.guns) if (!g.destroyed && g.owner !== null && g.owner !== side && Math.hypot(g.cx - x, g.cy - y) <= r + 1) b.pending.push({ tick: b.tick + delay, gun: g.id, dmg: Math.round(dmg * (opts.vsStructure || 1)), hit: true });
  for (const c of b.crafts) if (!c.sunk && c.side !== side && Math.hypot(c.x - x, c.y - y) <= r + 0.8) { const dm = Math.round(dmg * (opts.vsShip || 1)); c.pending += dm; b.pending.push({ tick: b.tick + delay, from: -1, craft: c.id, dmg: dm, hit: true, style: 'ranged' }); }
  if (opts.structures !== false && b.airQueue) b.airQueue.push({ tick: b.tick + delay, bomb: true, x, y, r: Math.max(0.6, r * 0.7), dmg: Math.round(dmg * 2 * (opts.vsStructure || 1)), side, unit: null, n: 0 });
  return n;
}

// one aimed shot (or blow) from an aircraft at a unit, with a damage multiplier
function shoot(b, u, t, mult = 1, style = u.def.style) {
  let hc = hitChance(u.def.aRoll, defenceRoll(t.def, style));
  if (u.blindUntil > b.tick) hc *= 0.6;
  const hit = b.rng.next() < hc;
  const dmg = hit ? b.rng.int(0, Math.max(1, Math.floor(u.def.max * mult))) : 0;
  const delay = style === 'melee' ? 0 : hitDelay(style, unitDist(u, t));
  queueHit(b, u, t, dmg, delay, style, hit);
  b.events.push({ type: 'attack', from: u.id, to: t.id, style, delay, proj: u.def.projectile || style });
  u.cd = u.def.speed; u.lastAttack = b.tick;
  u.face = Math.atan2(t.y - u.y, t.x - u.x);
  if (style === 'melee' && airborne(b, u)) u.landedUntil = b.tick + 3; // swoops down to strike
  return hit;
}
const goTo = (b, u, x, y) => stepAir(b, u, { x: clamp(Math.round(x), 0, b.W - u.def.size), y: clamp(Math.round(y), 0, b.H - u.def.size) });
// fly on past the mark for a few ticks after a pass
function egress(b, u, s) {
  if (!(s.egress > 0)) return false;
  s.egress--;
  goTo(b, u, u.x + Math.cos(u.face) * 4, u.y + Math.sin(u.face) * 4);
  return true;
}
const state = (u) => (u.aw ||= { cd: 0, egress: 0 });

// ---------- the duty ----------
/** an aircraft's role duty; true when it used the tick */
export function airwingDuty(b, u) {
  if (u.aboard >= 0 || u.landedUntil > b.tick) return false;
  const s = state(u);
  if (s.cd > 0) s.cd--;
  airArts(b, u);
  const R = ROLES[u.def.airRole];
  return R ? R(b, u, s, u.def.airArts || {}) : false;
}

// arts any aircraft may have
function airArts(b, u) {
  const A = u.def.airArts || {};
  if (A.terror && (b.tick + u.id) % 10 === 0) near(b, u.x, u.y, 3, (v) => { if (v.alive && v.side !== u.side && v.aboard < 0 && unitDist(u, v) <= 2 && b.rng.chance(0.4)) v.cd += 1; });
  if (A.fireTrail && (b.tick + u.id) % 2 === 0) near(b, u.x, u.y, 2, (v) => { if (v.side !== u.side && grounded(b, v) && unitDist(u, v) <= 0 && b.rng.chance(0.4)) queueHit(b, u, v, 2, 0, 'magic', true); });
}

// fly to a rally point under pressure; set down troops, lower crates, mend the hurt and fly out the surrounded
function transport(b, u, s, A) {
  if (s.loads === undefined) { s.loads = A.carry ? 1 : 0; s.crates = A.supply ? 1 : 0; s.lifts = A.extract ? 1 : 0; s.sorties = 0; s.mode = 'out'; }
  if (s.mode === 'home') {
    const r = s.rear;
    if (Math.hypot(r.x - u.x, r.y - u.y) > 2) { goTo(b, u, r.x, r.y); return true; }
    if (b.tick < s.until) return true;
    if (s.sorties >= 3) { s.mode = 'done'; return false; }
    s.loads = A.carry ? 1 : 0; s.crates = A.supply ? 1 : 0; s.lifts = A.extract ? 1 : 0; s.mode = 'out';
  }
  if (s.mode === 'done' || !(s.loads || s.crates || s.lifts || A.heal)) return false;
  if (!s.dest || (b.tick + u.id) % 10 === 0) s.dest = pressedPoint(b, u.side);
  const d0 = s.dest;
  if (!d0) return false;
  if (Math.hypot(d0.x - u.x, d0.y - u.y) > 1.8) { goTo(b, u, d0.x, d0.y); return true; }
  // over the point
  let did = false;
  if (s.loads > 0) {
    s.loads--;
    const fresh = dropTroops(b, u.side, A.troop, Math.round(clamp(A.carry, 1, 12)), d0.x, d0.y);
    if (fresh.length) { ev(b, u, 'drop', d0.x, d0.y, { n: fresh.length, ids: fresh.map((v) => v.id) }); did = true; }
  }
  if (s.crates > 0 && b.cmd) {
    s.crates--;
    const n = Math.round(clamp(A.supply, 1, 6));
    if (addCrate(b, u.side, d0.x + 1, d0.y + 1, n)) { ev(b, u, 'supply', d0.x + 1, d0.y + 1, { n }); did = true; }
  }
  if (A.heal) near(b, d0.x, d0.y, 4, (v) => { if (v.alive && v.side === u.side && v.aboard < 0 && v.hp < v.def.hp) v.hp = Math.min(v.def.hp, v.hp + A.heal); });
  if (s.lifts > 0) {
    s.lifts--;
    const got = [];
    near(b, d0.x, d0.y, 5, (v) => { if (v.side === u.side && grounded(b, v) && !v.def.fly && v.def.size === 1 && !v.def.leader && v.hp < v.def.hp * 0.6 && Math.hypot(v.x - d0.x, v.y - d0.y) <= 4 && enemiesNear(b, u.side, v.x, v.y, 2)) got.push(v); });
    const to = rearOf(b, u.side, u.y);
    let n = 0;
    for (const v of got.slice(0, 4)) {
      occupy(b, v, 0);
      const spot = freeTileNear(b, clamp(Math.round(to.x), 1, b.W - 2), clamp(Math.round(to.y), 1, b.H - 2), 1, v.side);
      if (!spot) { occupy(b, v, 1); continue; }
      v.px = v.x; v.py = v.y; v.x = spot[0]; v.y = spot[1]; occupy(b, v, 1); n++;
    }
    if (n) { ev(b, u, 'lift', d0.x, d0.y, { to: { x: to.x, y: to.y }, n }); did = true; }
  }
  void did;
  if (!(s.loads || s.crates || s.lifts)) { s.sorties++; s.mode = 'home'; s.rear = rearOf(b, u.side, u.y); s.until = b.tick + 30; }
  return true;
}

// bombing runs over works, guns, ships and dense formations
function bomber(b, u, s, A) {
  if (egress(b, u, s)) return true;
  if (!s.t || (b.tick + u.id) % 8 === 0 || !s.t.live()) s.t = bombTarget(b, u, A);
  const t = s.t;
  if (!t) return false;
  const d = Math.hypot(t.x - ucx(u), t.y - ucy(u));
  if (d > 1.6 || s.cd > 0) { if (d > 1.6) goTo(b, u, t.x - u.def.size / 2, t.y - u.def.size / 2); else goTo(b, u, u.x + Math.cos(u.face) * 3, u.y + Math.sin(u.face) * 3); return true; }
  const n = Math.round(clamp(A.bombs || 2, 1, 8)), r = clamp(A.blast || 1.5, 1, 4), dmg = Math.round(14 * Math.sqrt(u.def.hp / 105));
  const delay = 2;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * r * 0.8;
    const bx = clamp(t.x + Math.cos(u.face) * off, 1, b.W - 2), by = clamp(t.y + Math.sin(u.face) * off, 1, b.H - 2);
    groundBlast(b, u.side, bx, by, r, dmg, delay + (i >> 1), { burn: A.incendiary ? 3 : 0, vsStructure: A.vsStructure || 1, vsShip: A.vsShip || 1 });
  }
  ev(b, u, 'bomb', t.x, t.y, { n, r, delay, fire: !!A.incendiary });
  s.cd = 14; s.egress = 5;
  return true;
}
function bombTarget(b, u, A) {
  let best = null, bs = -Infinity;
  const consider = (x, y, value, live) => { const sc = value * 10 - Math.hypot(x - u.x, y - u.y); if (sc > bs) { bs = sc; best = { x, y, live }; } };
  b.structures.forEach((st) => { if (!st.destroyed && st.hp > 0 && st.side !== undefined && st.side !== null && st.side !== u.side) consider(st.x + st.w / 2, st.y + st.h / 2, 2.5 * (A.vsStructure || 1), () => !st.destroyed); });
  for (const g of b.guns) if (!g.destroyed && g.owner !== null && g.owner !== u.side) consider(g.cx, g.cy, 4, () => !g.destroyed && g.owner !== u.side);
  for (const sh of b.ships) if (sh.alive && sh.side !== u.side) consider(sh.x, sh.y, 4 * (A.vsShip || 1), () => sh.alive);
  for (const c of b.crafts) if (!c.sunk && c.side !== u.side && c.passengers.length) consider(c.x, c.y, 3, () => !c.sunk);
  for (const sq of b.squads) if (sq.side !== u.side && sq.alive >= 3 && sq.role !== 'air') consider(sq.cx, sq.cy, sq.alive * 0.6, () => sq.alive > 0);
  return best;
}

// fighters: enemy fliers first (bombers and transports before all), then airship crews
function fighter(b, u, s, A, around = null) {
  const range = u.def.range + 1;
  if (!s.foe || !s.foe.alive || !airborne(b, s.foe) || (b.tick + u.id) % 6 === 0 || (around && Math.hypot(s.foe.x - around.x, s.foe.y - around.y) > around.r)) {
    let best = null, bs = Infinity;
    const cx = around ? around.x : u.x, cy = around ? around.y : u.y, reach = around ? around.r : 24;
    near(b, cx, cy, reach, (v) => {
      if (!v.alive || v.side === u.side || v.aboard >= 0 || !airborne(b, v)) return;
      const dd = Math.hypot(v.x - cx, v.y - cy);
      if (dd > reach) return;
      const role = v.def.airRole, sc = Math.hypot(v.x - u.x, v.y - u.y) - (role === 'bomber' || role === 'transport' ? 8 : role === 'cas' || role === 'naval' ? 4 : 0) - (around && v.def.style === 'melee' && dd < around.r * 0.5 ? 6 : 0);
      if (sc < bs) { bs = sc; best = v; }
    });
    s.foe = best;
  }
  const t = s.foe;
  if (t) {
    const d = unitDist(u, t);
    if (d > range - 1) { goTo(b, u, t.x, t.y); return true; }
    if (u.cd > 0) return true;
    const big = t.def.airRole === 'bomber' || t.def.airRole === 'transport';
    let mult = (A.vsAir || 1.4) * (A.intercept && big ? 1.3 : 1);
    if (around && A.repelBoarders && t.def.style === 'melee') mult *= 2; // boarders closing on the ship it guards
    const guns = Math.round(clamp(A.guns || 1, 1, 4));
    for (let k = 0; k < guns && t.alive; k++) shoot(b, u, t, mult / Math.sqrt(guns), 'ranged');
    if (A.flak) near(b, t.x, t.y, 2, (v) => { if (v !== t && v.alive && v.side !== u.side && airborne(b, v) && unitDist(t, v) <= 1 && b.rng.chance(0.5)) queueHit(b, u, v, b.rng.int(0, Math.ceil(u.def.max * 0.6)), 1, 'ranged', true); });
    if (A.dogfight && t.def.airRole === 'fighter') u.cd = Math.max(1, u.cd - 1);
    ev(b, u, 'intercept', t.x, t.y, { to: t.id });
    return true;
  }
  if (around) return false;
  // no fliers about: go for the crews of enemy airships
  let ship = null, sd = 22;
  if (b.airships) for (const a of b.airships) { if (!a.alive || a.side === u.side) continue; const dd = Math.hypot(a.x - u.x, a.y - u.y); if (dd < sd) { sd = dd; ship = a; } }
  if (!ship) return false;
  if (u.cd <= 0 && unitVsAirship(b, u, u.def.range)) return true;
  goTo(b, u, ship.x, ship.y);
  return true;
}

// close air support: low strafing passes along the enemy ranks, rockets, pinning fire
function cas(b, u, s, A) {
  if (egress(b, u, s)) return true;
  if (!s.c || (b.tick + u.id) % 9 === 0) s.c = enemyCluster(b, u.side, u.x, u.y, 36);
  const c = s.c;
  if (!c) return false;
  const lead = c.sq.members.map((id) => b.units[id]).find((v) => grounded(b, v));
  if (!lead) { s.c = null; return false; }
  const d = Math.hypot(lead.x - u.x, lead.y - u.y);
  if (d > 2.5 || s.cd > 0) { goTo(b, u, lead.x, lead.y); return true; }
  // the pass: along the line from here through the mark and six tiles on
  const ang = d > 0.3 ? Math.atan2(lead.y - u.y, lead.x - u.x) : u.face;
  const x0 = ucx(u), y0 = ucy(u), x1 = x0 + Math.cos(ang) * 7, y1 = y0 + Math.sin(ang) * 7;
  const strafe = A.strafe || Math.round(u.def.max * 1.4);
  const hits = [];
  near(b, (x0 + x1) / 2, (y0 + y1) / 2, 5, (v) => {
    if (v.side === u.side || !grounded(b, v)) return;
    const px = ucx(v) - x0, py = ucy(v) - y0, along = px * Math.cos(ang) + py * Math.sin(ang), off = Math.abs(-px * Math.sin(ang) + py * Math.cos(ang));
    if (along >= -0.5 && along <= 7.5 && off <= 1) hits.push(v);
  });
  for (const v of hits.slice(0, 6)) {
    const hit = b.rng.next() < hitChance(u.def.aRoll, defenceRoll(v.def, 'ranged')) + 0.15;
    queueHit(b, u, v, hit ? b.rng.int(Math.ceil(strafe / 2), strafe) : 0, 1, 'ranged', hit);
    if (A.suppress) { v.pinUntil = b.tick + 8; v.cd += 1; }
  }
  ev(b, u, 'strafe', x0, y0, { to: { x: x1, y: y1 }, n: hits.length, arrows: !!A.arrows });
  s.passes = (s.passes || 0) + 1;
  if (A.rockets && s.passes % 2 === 1) {
    const n = Math.round(clamp(A.rockets, 1, 8));
    for (let i = 0; i < n; i++) groundBlast(b, u.side, clamp(lead.x + (b.rng.next() - 0.5) * 4, 1, b.W - 2), clamp(lead.y + (b.rng.next() - 0.5) * 4, 1, b.H - 2), 1, 12, 2 + (i >> 1), { structures: i === 0 });
    ev(b, u, 'rocket', lead.x, lead.y, { n });
  }
  u.face = ang; u.lastAttack = b.tick; s.cd = u.def.speed * 2; s.egress = 4;
  return true;
}

// hunters: great beasts, giants and dragons first; harpoons pin them and ground them
const monster = (v) => (v.def.size || 1) >= 2 || v.def.hp >= 150 || v.def.model?.body === 'dragon';
function hunter(b, u, s, A) {
  if (!s.t || !s.t.alive || (b.tick + u.id) % 8 === 0) {
    let best = null, bd = 34;
    for (const v of b.units) { if (!v.alive || v.side === u.side || v.aboard >= 0 || v.x < 0 || !monster(v)) continue; const d = Math.hypot(v.x - u.x, v.y - u.y) - (v.def.fly ? 4 : 0); if (d < bd) { bd = d; best = v; } }
    s.t = best;
  }
  const t = s.t;
  if (!t) return false;
  const d = unitDist(u, t);
  if (A.harpoon && d <= 4 && s.cd <= 0 && !(t.pinUntil > b.tick)) {
    const hit = b.rng.next() < hitChance(u.def.aRoll, defenceRoll(t.def, 'ranged')) + 0.2;
    if (hit) {
      const pin = Math.round(clamp(A.pin || 10, 4, 30));
      t.pinUntil = b.tick + pin;
      if (airborne(b, t)) t.landedUntil = b.tick + Math.ceil(pin / 2); // hauled down out of the sky
      queueHit(b, u, t, b.rng.int(2, Math.max(3, Math.round(u.def.max * 0.6))), 1, 'ranged', true);
    }
    ev(b, u, 'harpoon', ucx(u), ucy(u), { to: t.id, hit });
    s.cd = 24;
    return true;
  }
  if (d > 1) { goTo(b, u, t.x, t.y); return true; }
  if (u.cd > 0) return true;
  const mult = clamp(A.vsMonster || 1.8, 1, 3) * (A.lance && !s.lanced ? 1.4 : 1);
  s.lanced = true;
  const hit = shoot(b, u, t, mult, 'melee');
  if (hit && A.venom && !t.poison) t.poison = { dmg: Math.round(A.venom), left: 5, next: b.tick + 5 };
  return true;
}

// anti-ship and anti-leviathan: torpedo runs and dive bombs on ships, boats and sea creatures
function naval(b, u, s, A) {
  if (egress(b, u, s)) return true;
  if (!s.t || !s.t.live() || (b.tick + u.id) % 8 === 0) {
    let best = null, bd = 48;
    const take = (x, y, o) => { const d = Math.hypot(x - u.x, y - u.y); if (d < bd) { bd = d; best = o; } };
    for (const sh of b.ships) if (sh.alive && sh.side !== u.side) take(sh.x, sh.y, { kind: 'ship', o: sh, pos: () => sh, live: () => sh.alive });
    for (const c of b.crafts) if (!c.sunk && c.side !== u.side && !c.landed) take(c.x, c.y, { kind: 'craft', o: c, pos: () => c, live: () => !c.sunk && !c.landed });
    for (const v of b.units) if (v.alive && v.side !== u.side && v.aboard < 0 && v.x >= 0 && !v.def.fly && isWater(b.terrain[v.y * b.W + v.x])) take(v.x, v.y, { kind: 'beast', o: v, pos: () => v, live: () => v.alive });
    s.t = best;
  }
  const t = s.t;
  if (!t) return false;
  const p = t.pos(), d = Math.hypot(p.x - ucx(u), p.y - ucy(u));
  const arm = t.kind === 'ship' ? t.o.def.armour || 0 : 0;
  if (A.torpedo && d <= 6 && d > 2 && s.cd <= 0) {
    const dmg = Math.round(A.torpedo * (t.kind === 'beast' ? A.vsLeviathan || 1 : A.vsShip || 1) * (100 / (100 + arm * 0.4)));
    strike(b, u, t, dmg, 3);
    ev(b, u, 'torpedo', ucx(u), ucy(u), { to: { x: p.x, y: p.y } });
    s.cd = 16; s.egress = 3;
    return true;
  }
  if (d > 1.5 || s.cd > 0) { goTo(b, u, p.x, p.y); return true; }
  const base = A.diveBomb || A.torpedo || Math.round(u.def.max * 2.5);
  const dmg = Math.round(base * (t.kind === 'beast' ? (A.vsLeviathan || 1) * (A.depthCharge ? 1.3 : 1) : A.vsShip || 1) * (100 / (100 + arm)));
  strike(b, u, t, dmg, 2);
  ev(b, u, 'dive', p.x, p.y, { n: 1 });
  s.cd = 12; s.egress = 4;
  return true;
}
function strike(b, u, t, dmg, delay) {
  if (t.kind === 'ship') b.pending.push({ tick: b.tick + delay, ship: t.o.id, dmg, hit: true });
  else if (t.kind === 'craft') { t.o.pending += dmg; b.pending.push({ tick: b.tick + delay, from: u.id, craft: t.o.id, dmg, hit: true, style: 'ranged' }); }
  else queueHit(b, u, t.o, dmg, delay, 'ranged', true);
  u.lastAttack = b.tick;
}

// shock from the air: dive into a formation, throw the troops back, drop shock troops on it
function assault(b, u, s, A) {
  if (egress(b, u, s)) return true;
  if (!s.c || (b.tick + u.id) % 9 === 0) s.c = enemyCluster(b, u.side, u.x, u.y, 30);
  const c = s.c;
  if (!c) return false;
  const lead = c.sq.members.map((id) => b.units[id]).find((v) => grounded(b, v));
  if (!lead) { s.c = null; return false; }
  const d = Math.hypot(lead.x - u.x, lead.y - u.y);
  if (A.dropTroops && (s.drops ?? 1) > 0 && d < 5) {
    s.drops = 0;
    const fresh = dropTroops(b, u.side, A.dropTroops, Math.round(clamp(A.dropCount || 3, 1, 8)), lead.x, lead.y);
    if (fresh.length) ev(b, u, 'drop', lead.x, lead.y, { n: fresh.length, ids: fresh.map((v) => v.id) });
  }
  if (d > 1.5 || s.cd > 0 || u.cd > 0) { goTo(b, u, lead.x, lead.y); return true; }
  const mult = clamp(A.charge || 1.4, 1, 2.5);
  const hits = [];
  near(b, lead.x, lead.y, 3, (v) => { if (v.side !== u.side && grounded(b, v) && Math.hypot(v.x - lead.x, v.y - lead.y) <= 1.6) hits.push(v); });
  for (const v of hits.slice(0, 4)) {
    const hit = b.rng.next() < hitChance(u.def.aRoll, defenceRoll(v.def, 'melee'));
    queueHit(b, u, v, hit ? b.rng.int(Math.floor(u.def.max / 2), Math.max(1, Math.round(u.def.max * mult))) : 0, 0, 'melee', hit);
    if (A.shock && v.def.size === 1 && !v.def.leader) knockBack(b, v, ucx(u), ucy(u));
  }
  ev(b, u, 'dive', lead.x, lead.y, { n: hits.length });
  u.cd = u.def.speed; u.lastAttack = b.tick; u.landedUntil = b.tick + 3; s.cd = 10; s.egress = 3;
  return true;
}
export function knockBack(b, v, fx, fy, tiles = 1) {
  const ang = Math.atan2(v.y - fy, v.x - fx);
  for (let k = 0; k < tiles; k++) {
    const nx = Math.round(v.x + Math.cos(ang)), ny = Math.round(v.y + Math.sin(ang));
    if (!canStand(b, nx, ny, v.def.size, v.id, v.side)) break;
    occupy(b, v, 0); v.x = nx; v.y = ny; occupy(b, v, 1);
  }
  v.cd += 1;
}

// escorts: orbit their own airships, shoot down what comes at them, shred boarders
function escort(b, u, s, A) {
  let home = s.home !== undefined && b.airships ? b.airships[s.home] : null;
  if (!home || !home.alive || home.side !== u.side || (b.tick + u.id) % 20 === 0) {
    home = null; let hd = 70;
    if (b.airships) for (const a of b.airships) { if (!a.alive || a.side !== u.side) continue; const d = Math.hypot(a.x - u.x, a.y - u.y) - (a.def.behemoth ? 20 : 0); if (d < hd) { hd = d; home = a; } }
    s.home = home ? home.id : undefined;
  }
  if (!home) return A.vsAir ? fighter(b, u, s, A) : false;
  const R = home.radius * 0.6 + 2;
  // missiles at the ship it guards are shot down
  if (A.pointDefense && (b.tick + u.id) % 2 === 0 && Math.hypot(home.x - u.x, home.y - u.y) < R + 4) {
    for (const p of b.pending) {
      if (p.air !== home.id || p.pd || !(p.dmg > 0) || p.tick <= b.tick || p.from === undefined || p.from < 0) continue;
      p.pd = true;
      if (b.rng.chance(0.3)) { p.dmg = 0; p.hit = false; const f = b.units[p.from]; ev(b, u, 'pd', f ? (f.x + home.x) / 2 : home.x, f ? (f.y + home.y) / 2 : home.y, { air: home.id }); break; }
    }
  }
  if (fighter(b, u, s, A, { x: home.x, y: home.y, r: R + 8 })) return true;
  s.ang = (s.ang ?? b.rng.next() * 6.28) + 0.2;
  goTo(b, u, home.x + Math.cos(s.ang) * R, home.y + Math.sin(s.ang) * R);
  return true;
}

const ROLES = { transport, bomber, fighter: (b, u, s, A) => fighter(b, u, s, A), cas, hunter, naval, assault, escort };
