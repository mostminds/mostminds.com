// Sky-behemoths: each faction's colossal airship-class unit (AIRSHIPS entries with `behemoth: true`, designs in
// src/data/air). It flies and fights like any airship (src/engine/airship.js: broadsides, bombs, ladders,
// boarding) and on top of that works its eight abilities, each on its own cooldown, driven by its params
// (schema: src/data/air/index.js).
//
// Events for the views: { type: 'behemoth', air: airship id, kind, name: the ability's own name, x, y, ... }
//   broadside  x,y target, n guns, delay           beam       x0,y0 → x,y, delay        barrage  x,y, r, n, delay
//   bombBay    x,y, to {x,y} (the end of the stick), r, n, delay                           meteor   x,y, r, delay
//   hangar     x,y, ids, unit                      dropPods   x,y, n, delay             teleport x,y, n, ids
//   extraction x,y, to {x,y}, n                    supplyDrop x,y, n (crates), r         pointDefense x,y, to (unit id) | pd: true (a missile shot down)
//   snipers    x,y, to (unit id)                   heal       x,y, r, n                 raise    x,y, r, n, ids
//   cloud      x,y, r, cloud (its kind), until     sonic      x,y, r                    gale     x,y, r
//   lightning  x,y, to (unit id) | air (airship id) | gun (gun id) | ship (ship id)       harpoon  x,y, to (unit id) | ship | air (target airship id)
//   swarm      x,y, r, n                           aura       x,y, r, effect (pulses every 24 ticks)
//   ward / camouflage / flares / phase: x,y, r — when the standing effect first rises and then every 60 ticks,
//   and kind 'phase' / 'flares' with `dodge: true` when a shot actually passes through or goes wide.
//
// Standing effects (rebuilt every tick into b.skyFx) and their numeric hooks:
//   ward       { reduce, radius }  damage to allied troops beneath (queueHit) and allied airships (resolveAirHit) × (1 - reduce)
//   camouflage { radius }          ranged attacks from more than 4 tiles at allies within radius: defence roll × 1.6 (attack in battle.js);
//                                  the behemoth itself: shots at it from afar miss 30% more (unitVsAirship)
//   flares     { penalty }         enemy anti-air within 14 tiles (or aiming at it): hit chance × (1 - penalty) (unitVsAirship)
//   phase      { chance }          each hit on it passes through with this chance (resolveAirHit)
//   aura       { radius, effect }  courage: allied squads beneath do not break; frenzy: allies' attack timers run 1 faster;
//                                  vigor: allies mend 2 hp; reload: allies' ammunition +4 and timers 1 faster;
//                                  dispel: allies lose poison, pins and blindness; terror: enemies beneath falter (timer +2, 35%)
import { near, queueHit, spawnUnit, addSquad, freeTileNear, occupy, canStandAir, unitHeight, hitStructuresAt } from './battle.js';
import { addCrate } from './command.js';
import { isWater } from './terrain.js';
import { crewLoss } from './airship.js';
import { pointsOf, frontOf, pressedPoint, rearOf, enemyCluster, dropTroops, groundBlast, enemiesNear } from './airwing.js';

const NOBODY = { id: -1 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ucx = (u) => u.x + u.def.size / 2;
const ucy = (u) => u.y + u.def.size / 2;
const airborne = (b, u) => u.def.fly && !(u.landedUntil > b.tick);
const grounded = (b, u) => u.alive && u.aboard < 0 && u.x >= 0 && unitHeight(b, u) < 4;
const STANDING = new Set(['ward', 'camouflage', 'flares', 'phase']);
// cooldowns, in ticks
const CD = { broadside: 9, beam: 18, barrage: 24, bombBay: 16, meteor: 70, hangar: 34, dropPods: 80, teleport: 100, extraction: 60, supplyDrop: 90,
  pointDefense: 2, snipers: 7, heal: 10, raise: 30, cloud: 34, sonic: 28, gale: 22, lightning: 15, harpoon: 45, swarm: 10, aura: 6 };
const num = (v, d, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : d);
const fire = (b, a, ab, x, y, extra = {}) => b.events.push({ type: 'behemoth', air: a.id, kind: ab.kind, name: ab.name || ab.kind, x, y, ...extra });
const working = (a) => a.alive && (a.crew > 0 || a.wild);

// ---------- standing effects ----------
/** once a tick, before the airships move: the domes, flares, veils and auras of every working behemoth */
export function skyFxTick(b) {
  const fx = (b.skyFx ||= { ward: [], camo: [], flares: [], phase: [], aura: [] });
  fx.ward.length = fx.camo.length = fx.flares.length = fx.phase.length = fx.aura.length = 0;
  if (!b.airships) return;
  for (const a of b.airships) {
    if (!a.def.behemoth || !working(a)) continue;
    for (const ab of a.def.abilities || []) {
      const e = { air: a.id, side: a.side, x: a.x, y: a.y, hull: a.radius * 0.4 };
      if (ab.kind === 'ward') fx.ward.push({ ...e, r: num(ab.radius, 8, 2, 20), reduce: num(ab.reduce, 0.3, 0, 0.8) });
      else if (ab.kind === 'camouflage') fx.camo.push({ ...e, r: num(ab.radius, 8, 2, 20) });
      else if (ab.kind === 'flares') fx.flares.push({ ...e, r: 14, penalty: num(ab.penalty, 0.3, 0, 0.8) });
      else if (ab.kind === 'phase') fx.phase.push({ ...e, chance: num(ab.chance, 0.2, 0, 0.6) });
      else if (ab.kind === 'aura') fx.aura.push({ ...e, r: num(ab.radius, 8, 2, 20), effect: ab.effect });
      if (STANDING.has(ab.kind) && (a.fxSaid?.[ab.kind] ?? -999) <= b.tick - 60) { (a.fxSaid ||= {})[ab.kind] = b.tick; fire(b, a, ab, a.x, a.y, { r: e.r ?? num(ab.radius, 8) }); }
    }
  }
}
/** damage multiplier for a unit beneath an allied ward (1 when none) */
export function wardMul(b, t) {
  const W = b.skyFx && b.skyFx.ward;
  if (!W || !W.length) return 1;
  let m = 1;
  for (const w of W) if (w.side === t.side && Math.hypot(t.x - w.x, t.y - w.y) <= w.r + w.hull) m = Math.min(m, 1 - w.reduce);
  return m;
}
/** a unit under allied camouflage, seen from a shooter more than 4 tiles off */
export function camouflaged(b, t, from) {
  const C = b.skyFx && b.skyFx.camo;
  if (!C || !C.length || Math.hypot(t.x - from.x, t.y - from.y) <= 4) return false;
  for (const c of C) if (c.side === t.side && Math.hypot(t.x - c.x, t.y - c.y) <= c.r + c.hull) return true;
  return false;
}
/** extra miss chance for a shot at airship `a` from a shooter of `side` at (x, y): flares and camouflage */
export function skyBlind(b, side, x, y, a) {
  const F = b.skyFx;
  if (!F) return 0;
  let p = 0;
  for (const f of F.flares) if (f.side !== side && (f.air === a.id || Math.hypot(x - f.x, y - f.y) <= f.r || Math.hypot(a.x - f.x, a.y - f.y) <= f.r)) p = Math.max(p, f.penalty);
  if (a.def.behemoth && Math.hypot(a.x - x, a.y - y) > a.radius * 0.5 + 6) for (const c of F.camo) if (c.air === a.id) p = Math.max(p, 0.3);
  return p;
}
/** the damage that reaches airship `a` from a hit: phase may let it through, an allied ward softens it */
export function airHitMul(b, a, p) {
  const F = b.skyFx;
  if (!F || !(p.dmg > 0)) return 1;
  for (const f of F.phase) if (f.air === a.id && b.rng.chance(f.chance)) {
    if ((a.phaseSaid ?? -99) < b.tick - 8) { a.phaseSaid = b.tick; b.events.push({ type: 'behemoth', air: a.id, kind: 'phase', name: abName(a, 'phase'), x: a.x, y: a.y, dodge: true }); }
    return 0;
  }
  let m = 1;
  for (const w of F.ward) if (w.side === a.side && Math.hypot(a.x - w.x, a.y - w.y) <= w.r) m = Math.min(m, 1 - w.reduce);
  return m;
}
const abName = (a, kind) => (a.def.abilities || []).find((x) => x.kind === kind)?.name || kind;

// clouds of gas, plague or spores that hang where they fell
function zonesTick(b) {
  if (!b.skyZones || !b.skyZones.length) return;
  b.skyZones = b.skyZones.filter((z) => {
    if (b.tick > z.until) return false;
    if ((b.tick - z.from) % 2 === 0) near(b, z.x, z.y, z.r + 1, (v) => { if (v.side !== z.side && grounded(b, v) && Math.hypot(ucx(v) - z.x, ucy(v) - z.y) <= z.r) queueHit(b, NOBODY, v, b.rng.int(1, z.dmg), 0, 'magic', true, { x: z.x, y: z.y }); });
    return true;
  });
}
/** once a tick, after the airships: the clouds below */
export function skyZonesTick(b) { zonesTick(b); }

// ---------- the abilities ----------
/** a behemoth's abilities, each on its own cooldown (called from shipTick) */
export function behemothTick(b, a) {
  if (!working(a)) return;
  const list = a.def.abilities || [];
  if (!a.bcd) a.bcd = list.map((ab, i) => 6 + i * 3 + b.rng.int(0, 4));
  for (let i = 0; i < list.length; i++) {
    const ab = list[i];
    if (STANDING.has(ab.kind)) continue;
    if (a.bcd[i] > 0) { a.bcd[i]--; continue; }
    const fn = KINDS[ab.kind];
    if (!fn) { a.bcd[i] = 9999; continue; } // a kind the engine does not know: ignored
    let used = false;
    try { used = fn(b, a, ab); } catch (err) { if (globalThis.__behemothStrict) throw err; used = false; }
    a.bcd[i] = used ? Math.round(num(ab.every, CD[ab.kind] || 20, 2, 400)) : 4; // nothing to do: look again soon
  }
}

// what lies below and around it
function groundMark(b, a, range) {
  let best = null, bs = -Infinity;
  const take = (x, y, value, hit) => { const d = Math.hypot(x - a.x, y - a.y); if (d > range) return; const sc = value - d * 0.3; if (sc > bs) { bs = sc; best = { x, y, hit }; } };
  for (const s of b.ships) if (s.alive && s.side !== a.side) take(s.x, s.y, 12, 'ship');
  for (const g of b.guns) if (!g.destroyed && g.owner !== null && g.owner !== a.side) take(g.cx, g.cy, 10, 'gun');
  const c = enemyCluster(b, a.side, a.x, a.y, range);
  if (c) take(c.x, c.y, c.n * 1.2, 'troops');
  if (!best) b.structures.forEach((st) => { if (!st.destroyed && st.hp > 0 && st.side !== undefined && st.side !== null && st.side !== a.side) take(st.x + st.w / 2, st.y + st.h / 2, 4, 'struct'); });
  return best;
}
const enemyAir = (b, a, r) => { const out = []; near(b, a.x, a.y, r + 1, (v) => { if (v.alive && v.side !== a.side && v.aboard < 0 && airborne(b, v) && Math.hypot(ucx(v) - a.x, ucy(v) - a.y) <= r) out.push(v); }); return out; };
const enemyShips = (b, a, r) => (b.airships || []).filter((o) => o.alive && o.side !== a.side && Math.hypot(o.x - a.x, o.y - a.y) <= r + o.radius * 0.5);
// a behemoth is huge: what lies 'beneath' it reaches out from its hull, not its centre
const reach = (a, r) => r + a.radius * 0.4;
const friendlyBelow = (b, a, r, fn) => { const R = reach(a, r); near(b, a.x, a.y, R + 1, (v) => { if (v.alive && v.side === a.side && v.aboard < 0 && v.x >= 0 && Math.hypot(v.x - a.x, v.y - a.y) <= R) fn(v); }); };
// the forward rally point (or the front, or the mark below) where troops are set down
function dropSpot(b, a) {
  const p = pressedPoint(b, a.side);
  if (p) return p;
  const c = enemyCluster(b, a.side, a.x, a.y, 40);
  if (c) return { x: clamp(c.x + (a.side === 0 ? -4 : 4), 2, b.W - 3), y: c.y };
  return null;
}
const dry = (b, x, y) => !isWater(b.terrain[clamp(Math.round(y), 0, b.H - 1) * b.W + clamp(Math.round(x), 0, b.W - 1)]);

const KINDS = {
  broadside(b, a, ab) {
    const range = num(ab.range, 12, 4, 24), dmg = num(ab.dmg, 30, 1, 200);
    const m = groundMark(b, a, range);
    if (!m) return false;
    const delay = 1 + Math.floor(Math.hypot(m.x - a.x, m.y - a.y) / 8), guns = 6;
    for (let i = 0; i < guns; i++) {
      if (!b.rng.chance(0.6)) continue;
      const x = clamp(m.x + (b.rng.next() - 0.5) * 2.5, 1, b.W - 2), y = clamp(m.y + (b.rng.next() - 0.5) * 2.5, 1, b.H - 2);
      groundBlast(b, a.side, x, y, 0.9, b.rng.int(Math.ceil(dmg / 2), dmg), delay, { structures: i < 2 });
    }
    fire(b, a, ab, m.x, m.y, { n: guns, delay });
    return true;
  },
  beam(b, a, ab) {
    const range = num(ab.range, 14, 4, 30), dmg = num(ab.dmg, 50, 1, 300);
    const m = groundMark(b, a, range);
    if (!m) return false;
    const len = Math.hypot(m.x - a.x, m.y - a.y) || 1, ux = (m.x - a.x) / len, uy = (m.y - a.y) / len, delay = 1;
    const hit = new Set();
    near(b, (a.x + m.x) / 2, (a.y + m.y) / 2, len / 2 + 2, (v) => {
      if (!v.alive || v.side === a.side || v.aboard >= 0 || hit.has(v.id)) return;
      const px = ucx(v) - a.x, py = ucy(v) - a.y, along = px * ux + py * uy, off = Math.abs(-px * uy + py * ux);
      if (along < 0 || along > len + 1 || off > 0.9) return;
      hit.add(v.id);
      queueHit(b, NOBODY, v, b.rng.int(Math.ceil(dmg / 2), dmg), delay, 'magic', true, { x: a.x, y: a.y, blast: true });
    });
    for (let t = len * 0.5; t <= len + 0.5; t += 1.5) hitStructuresAt(b, a.x + ux * t, a.y + uy * t, 0.5, Math.round(dmg * 0.8));
    for (const s of b.ships) if (s.alive && s.side !== a.side && Math.hypot(s.x - m.x, s.y - m.y) <= s.radius + 1) b.pending.push({ tick: b.tick + delay, ship: s.id, dmg: dmg * 2, hit: true });
    for (const g of b.guns) if (!g.destroyed && g.owner !== null && g.owner !== a.side && Math.hypot(g.cx - m.x, g.cy - m.y) <= 1.5) b.pending.push({ tick: b.tick + delay, gun: g.id, dmg: dmg * 2, hit: true });
    fire(b, a, ab, m.x, m.y, { x0: a.x, y0: a.y, delay, n: hit.size });
    return true;
  },
  barrage(b, a, ab) {
    const salvo = Math.round(num(ab.salvo, 6, 1, 16)), dmg = num(ab.dmg, 24, 1, 200), r = num(ab.radius, 1.5, 0.5, 4);
    const m = groundMark(b, a, 20);
    if (!m) return false;
    for (let i = 0; i < salvo; i++) groundBlast(b, a.side, clamp(m.x + (b.rng.next() - 0.5) * 6, 1, b.W - 2), clamp(m.y + (b.rng.next() - 0.5) * 6, 1, b.H - 2), r, dmg, 2 + (i >> 1), { structures: i % 2 === 0 });
    fire(b, a, ab, m.x, m.y, { r: 3 + r, n: salvo, delay: 2 });
    return true;
  },
  bombBay(b, a, ab) {
    const dmg = num(ab.dmg, 40, 1, 300), r = num(ab.radius, 2, 1, 4);
    if (enemiesNear(b, a.side, Math.round(a.x), Math.round(a.y), Math.ceil(a.radius * 0.5 + r)) < 2 && !groundMarkUnder(b, a)) return false;
    const n = 5, x0 = a.x - Math.cos(a.heading) * a.radius * 0.4, y0 = a.y - Math.sin(a.heading) * a.radius * 0.4;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * a.radius * 0.8;
      groundBlast(b, a.side, clamp(x0 + Math.cos(a.heading) * t, 1, b.W - 2), clamp(y0 + Math.sin(a.heading) * t, 1, b.H - 2), r, dmg, 3 + (i >> 1), { vsStructure: 1.5 });
    }
    fire(b, a, ab, x0, y0, { to: { x: x0 + Math.cos(a.heading) * a.radius * 0.8, y: y0 + Math.sin(a.heading) * a.radius * 0.8 }, r, n, delay: 3 });
    return true;
  },
  meteor(b, a, ab) {
    const dmg = num(ab.dmg, 100, 1, 500), r = num(ab.radius, 3, 1, 6);
    const c = enemyCluster(b, a.side, a.x, a.y, 50) || groundMark(b, a, 50);
    if (!c) return false;
    const delay = 5;
    groundBlast(b, a.side, c.x, c.y, r, dmg, delay, { vsStructure: 2, style: 'magic' });
    fire(b, a, ab, c.x, c.y, { r, delay });
    return true;
  },
  hangar(b, a, ab) {
    const id = `${a.def.faction}_air_${ab.role || 'fighter'}`, def = b.getDef(id) || b.getDef(a.def.hangar?.unit);
    if (!def) return false;
    const max = Math.round(num(ab.max, 6, 1, 16));
    let up = 0;
    for (const u of b.units) if (u.alive && u.fromAir === a.id && u.def.id === def.id) up++;
    if (up >= max) return false;
    const fresh = [];
    for (let k = 0; k < 2 && up + fresh.length < max; k++) {
      const bx = Math.round(a.x - Math.cos(a.heading) * (a.radius * 0.5 + k)), by = Math.round(a.y - Math.sin(a.heading) * (a.radius * 0.5 + k));
      let spot = null;
      for (let r = 0; r < 5 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) if (canStandAir(b, bx + dx, by + dy, def.size, -1)) spot = [bx + dx, by + dy];
      if (!spot) break;
      const u = spawnUnit(b, def, a.side, spot[0], spot[1]);
      u.px = Math.round(clamp(a.x, 0, b.W - 1)); u.py = Math.round(clamp(a.y, 0, b.H - 1)); u.launchedAt = b.tick; u.fromAir = a.id;
      fresh.push(u);
    }
    if (!fresh.length) return false;
    addSquad(b, fresh);
    b.events.push({ type: 'airLaunch', air: a.id, ids: fresh.map((u) => u.id) });
    fire(b, a, ab, a.x, a.y, { ids: fresh.map((u) => u.id), unit: def.id });
    return true;
  },
  dropPods(b, a, ab) {
    const p = dropSpot(b, a);
    if (!p) return false;
    const unit = b.getDef(ab.unit) && !b.getDef(ab.unit).fly ? ab.unit : a.def.pods?.unit;
    const count = Math.round(num(ab.count, 6, 1, 24));
    let n = 0;
    for (let k = 0; k < count; k += 4) {
      const ang = b.rng.next() * Math.PI * 2;
      let px = clamp(Math.round(p.x + Math.cos(ang) * 2), 1, b.W - 2), py = clamp(Math.round(p.y + Math.sin(ang) * 2), 1, b.H - 2);
      if (!dry(b, px, py)) { px = Math.round(p.x); py = Math.round(p.y); }
      if (!dry(b, px, py)) continue;
      b.airQueue.push({ tick: b.tick + 4 + (k >> 2), side: a.side, unit, n: Math.min(4, count - k), x: px, y: py });
      b.events.push({ type: 'podDrop', air: a.id, x: px, y: py, delay: 4 + (k >> 2) });
      n += Math.min(4, count - k);
    }
    if (!n) return false;
    fire(b, a, ab, p.x, p.y, { n, delay: 4 });
    return true;
  },
  teleport(b, a, ab) {
    const p = dropSpot(b, a);
    if (!p) return false;
    const unit = b.getDef(ab.unit) && !b.getDef(ab.unit).fly ? ab.unit : a.def.pods?.unit;
    const fresh = dropTroops(b, a.side, unit, Math.round(num(ab.count, 4, 1, 16)), p.x, p.y);
    if (!fresh.length) return false;
    b.events.push({ type: 'reinforce', side: a.side, ids: fresh.map((u) => u.id) });
    fire(b, a, ab, p.x, p.y, { n: fresh.length, ids: fresh.map((u) => u.id) });
    return true;
  },
  extraction(b, a, ab) {
    const cap = Math.round(num(ab.capacity, 8, 1, 30));
    let pick = null, ps = 0.9;
    for (const u of b.units) {
      if (u.side !== a.side || !grounded(b, u) || u.def.fly || u.def.size > 1 || u.def.leader || u.hp > u.def.hp * 0.5 || Math.hypot(u.x - a.x, u.y - a.y) > 40) continue;
      const foes = enemiesNear(b, a.side, u.x, u.y, 2);
      if (foes && foes * 0.4 + (1 - u.hp / u.def.hp) > ps) { ps = foes * 0.4 + (1 - u.hp / u.def.hp); pick = u; }
    }
    if (!pick) return false;
    const got = [];
    near(b, pick.x, pick.y, 4, (v) => { if (v.side === a.side && grounded(b, v) && !v.def.fly && v.def.size === 1 && !v.def.leader && v.hp < v.def.hp * 0.75 && Math.hypot(v.x - pick.x, v.y - pick.y) <= 3) got.push(v); });
    const to = rearOf(b, a.side, pick.y);
    let n = 0;
    for (const v of got.slice(0, cap)) {
      occupy(b, v, 0);
      const spot = freeTileNear(b, clamp(Math.round(to.x), 1, b.W - 2), clamp(Math.round(to.y), 1, b.H - 2), 1, v.side);
      if (!spot) { occupy(b, v, 1); continue; }
      v.px = v.x; v.py = v.y; v.x = spot[0]; v.y = spot[1]; occupy(b, v, 1); n++;
    }
    if (!n) return false;
    fire(b, a, ab, pick.x, pick.y, { to: { x: to.x, y: to.y }, n });
    return true;
  },
  supplyDrop(b, a, ab) {
    const amount = Math.round(num(ab.amount, 3, 1, 10));
    let p = null, ps = Infinity;
    for (const q of pointsOf(b, a.side)) { const sc = (q.stock || 0) * 10 + Math.hypot(q.x - a.x, q.y - a.y) * 0.2 - enemiesNear(b, a.side, q.x, q.y, 8) * 2; if (sc < ps) { ps = sc; p = q; } }
    const at = p || frontOf(b, a.side);
    if (!at) return false;
    let crates = 0;
    if (b.cmd && addCrate(b, a.side, at.x + 1, at.y + 1, amount)) crates = amount;
    near(b, at.x, at.y, 5, (v) => { if (v.alive && v.side === a.side && v.aboard < 0 && Math.hypot(v.x - at.x, v.y - at.y) <= 4) { v.hp = Math.min(v.def.hp, v.hp + amount * 4); if (v.ammo !== undefined) v.ammo = Math.max(v.ammo, 40); } });
    fire(b, a, ab, at.x, at.y, { n: crates, r: 4 });
    return true;
  },
  pointDefense(b, a, ab) {
    const range = num(ab.range, 8, 2, 20), dmg = num(ab.dmg, 12, 1, 100);
    let used = false;
    // turrets shred the fliers about it
    const foes = enemyAir(b, a, range + a.radius * 0.4);
    for (const v of foes.slice(0, 2)) {
      const hit = b.rng.chance(0.55);
      queueHit(b, NOBODY, v, hit ? b.rng.int(Math.ceil(dmg / 3), dmg) : 0, 1, 'ranged', hit, { x: a.x, y: a.y });
      if ((a.pdSaid ?? -99) < b.tick - 6) { a.pdSaid = b.tick; fire(b, a, ab, ucx(v), ucy(v), { to: v.id }); }
      used = true;
    }
    // and missiles coming at it or its consorts
    for (const p of b.pending) {
      if (p.air === undefined || p.pd || !(p.dmg > 0) || p.tick <= b.tick || !(p.from >= 0)) continue;
      const o = b.airships[p.air];
      if (!o || o.side !== a.side || Math.hypot(o.x - a.x, o.y - a.y) > range + a.radius * 0.5) continue;
      p.pd = true;
      if (b.rng.chance(0.3)) { p.dmg = 0; p.hit = false; fire(b, a, ab, o.x, o.y, { pd: true }); used = true; break; }
    }
    return used;
  },
  snipers(b, a, ab) {
    const range = num(ab.range, 16, 4, 30), dmg = num(ab.dmg, 30, 1, 200);
    const cmd = new Set(b.cmd ? b.cmd.commanders.flat() : []);
    let best = null, bs = -Infinity;
    near(b, a.x, a.y, range + 1, (v) => {
      if (!v.alive || v.side === a.side || v.aboard >= 0 || v.x < 0 || Math.hypot(ucx(v) - a.x, ucy(v) - a.y) > range) return;
      const sc = (v.def.leader ? 30 : 0) + (cmd.has(v.id) ? 20 : 0) + (airborne(b, v) ? 14 : 0) + (v.def.model?.body === 'rider' && v.def.size >= 2 ? 16 : 0) - v.hp * 0.02;
      if (sc > bs) { bs = sc; best = v; }
    });
    if (!best || bs < 10) return false;
    const hit = b.rng.chance(0.7);
    queueHit(b, NOBODY, best, hit ? b.rng.int(Math.ceil(dmg / 2), dmg) : 0, 1, 'ranged', hit, { x: a.x, y: a.y });
    fire(b, a, ab, ucx(best), ucy(best), { to: best.id, hit });
    return true;
  },
  heal(b, a, ab) {
    const amount = Math.round(num(ab.amount, 10, 1, 80)), r = num(ab.radius, 8, 2, 20);
    let n = 0;
    friendlyBelow(b, a, r, (v) => { if (v.hp < v.def.hp) { v.hp = Math.min(v.def.hp, v.hp + amount); n++; } });
    for (const o of b.airships) if (o.alive && o.side === a.side && Math.hypot(o.x - a.x, o.y - a.y) <= r + o.radius * 0.5 && o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + amount * 4); n++; }
    for (const s of b.ships) if (s.alive && s.side === a.side && Math.hypot(s.x - a.x, s.y - a.y) <= r && s.hp < s.maxHp) { s.hp = Math.min(s.maxHp, s.hp + amount * 2); n++; }
    for (const g of b.guns) if (!g.destroyed && g.owner === a.side && Math.hypot(g.cx - a.x, g.cy - a.y) <= r && g.hp < g.maxHp) { g.hp = Math.min(g.maxHp, g.hp + amount); n++; }
    if (!n) return false;
    fire(b, a, ab, a.x, a.y, { r, n });
    return true;
  },
  raise(b, a, ab) {
    const r = num(ab.radius, 8, 2, 20), unit = a.def.pods?.unit, def = unit && b.getDef(unit);
    if (!def || def.fly) return false;
    const fresh = [];
    for (const u of b.units) {
      if (fresh.length >= 3) break;
      if (u.alive || u.raised || u.down || u.def.fly || u.def.leader || u.x < 0 || u.aboard >= 0 || Math.hypot(u.x - a.x, u.y - a.y) > reach(a, r)) continue;
      u.raised = true;
      const spot = freeTileNear(b, u.x, u.y, def.size, a.side);
      if (spot) fresh.push(spawnUnit(b, def, a.side, spot[0], spot[1]));
    }
    if (!fresh.length) return false;
    addSquad(b, fresh);
    fire(b, a, ab, a.x, a.y, { r, n: fresh.length, ids: fresh.map((u) => u.id) });
    return true;
  },
  cloud(b, a, ab) {
    const dmg = Math.round(num(ab.dmg, 6, 1, 60)), r = num(ab.radius, 3, 1, 6);
    const c = enemyCluster(b, a.side, a.x, a.y, 20);
    if (!c) return false;
    (b.skyZones ||= []).push({ side: a.side, x: c.x, y: c.y, r, dmg, from: b.tick, until: b.tick + 14, kind: ab.cloud || ab.type || 'gas' });
    fire(b, a, ab, c.x, c.y, { r, cloud: ab.cloud || ab.type || 'gas', until: b.tick + 14 });
    return true;
  },
  sonic(b, a, ab) {
    const stun = Math.round(num(ab.stun, 3, 1, 10)), r = num(ab.radius, 4, 1, 10);
    const c = enemyCluster(b, a.side, a.x, a.y, 14) || groundMark(b, a, 14);
    if (!c) return false;
    near(b, c.x, c.y, r + 1, (v) => { if (v.alive && v.side !== a.side && v.aboard < 0 && Math.hypot(ucx(v) - c.x, ucy(v) - c.y) <= r) { v.cd += stun; queueHit(b, NOBODY, v, b.rng.int(0, 4), 0, 'magic', true, { x: c.x, y: c.y }); } });
    hitStructuresAt(b, c.x, c.y, r * 0.6, 40);
    for (const o of enemyShips(b, a, r + 6)) crewLoss(b, o, 1, a.side);
    fire(b, a, ab, c.x, c.y, { r });
    return true;
  },
  gale(b, a, ab) {
    const push = Math.round(num(ab.push, 3, 1, 8)), r = num(ab.radius, 8, 2, 20);
    const foes = enemyAir(b, a, r + a.radius * 0.4), ships = enemyShips(b, a, r * 1.5);
    if (!foes.length && !ships.length) return false;
    for (const v of foes) pushAir(b, v, Math.atan2(v.y - a.y, v.x - a.x), push);
    for (const o of ships) { const ang = Math.atan2(o.y - a.y, o.x - a.x); o.x = clamp(o.x + Math.cos(ang) * push * 0.5, 1, b.W - 2); o.y = clamp(o.y + Math.sin(ang) * push * 0.5, 1, b.H - 2); }
    fire(b, a, ab, a.x, a.y, { r, n: foes.length + ships.length });
    return true;
  },
  lightning(b, a, ab) {
    const strikes = Math.round(num(ab.strikes, 3, 1, 10)), dmg = num(ab.dmg, 30, 1, 200);
    const marks = [];
    for (const v of enemyAir(b, a, 16)) marks.push({ u: v, x: ucx(v), y: ucy(v) });
    for (const o of enemyShips(b, a, 18)) marks.push({ air: o, x: o.x, y: o.y });
    for (const g of b.guns) if (!g.destroyed && g.owner !== null && g.owner !== a.side && Math.hypot(g.cx - a.x, g.cy - a.y) <= 16) marks.push({ gun: g, x: g.cx, y: g.cy });
    for (const s of b.ships) if (s.alive && s.side !== a.side && Math.hypot(s.x - a.x, s.y - a.y) <= 18) marks.push({ ship: s, x: s.x, y: s.y });
    if (!marks.length) return false;
    for (let i = 0; i < strikes; i++) {
      const m = marks[b.rng.int(0, marks.length - 1)];
      const d = b.rng.int(Math.ceil(dmg / 2), dmg);
      if (m.u) queueHit(b, NOBODY, m.u, d, 1, 'magic', true, { x: a.x, y: a.y });
      else if (m.air) b.pending.push({ tick: b.tick + 1, air: m.air.id, dmg: d, hit: true, by: a.side });
      else if (m.gun) b.pending.push({ tick: b.tick + 1, gun: m.gun.id, dmg: d * 2, hit: true }); // the powder goes up
      else b.pending.push({ tick: b.tick + 1, ship: m.ship.id, dmg: d, hit: true });
      fire(b, a, ab, m.x, m.y, m.u ? { to: m.u.id } : m.air ? { air: m.air.id } : m.gun ? { gun: m.gun.id } : { ship: m.ship.id });
    }
    return true;
  },
  harpoon(b, a, ab) {
    const pull = num(ab.pull, 3, 1, 10);
    const o = enemyShips(b, a, 16)[0];
    if (o) {
      const ang = Math.atan2(a.y - o.y, a.x - o.x), d = Math.hypot(a.x - o.x, a.y - o.y), step = Math.min(pull, Math.max(0, d - (a.radius + o.radius) * 0.6));
      o.x = clamp(o.x + Math.cos(ang) * step, 1, b.W - 2); o.y = clamp(o.y + Math.sin(ang) * step, 1, b.H - 2);
      fire(b, a, ab, o.x, o.y, { air: o.id });
      return true;
    }
    let mon = null, md = 14;
    near(b, a.x, a.y, 15, (v) => { if (v.alive && v.side !== a.side && v.aboard < 0 && v.x >= 0 && ((v.def.size || 1) >= 2 || v.def.hp >= 150)) { const d = Math.hypot(v.x - a.x, v.y - a.y); if (d < md) { md = d; mon = v; } } });
    if (mon) {
      mon.pinUntil = b.tick + 12;
      if (airborne(b, mon)) mon.landedUntil = b.tick + 8;
      queueHit(b, NOBODY, mon, b.rng.int(4, 16), 1, 'ranged', true, { x: a.x, y: a.y });
      const ang = Math.atan2(a.y - mon.y, a.x - mon.x);
      for (let k = 0; k < Math.round(pull); k++) {
        const nx = Math.round(mon.x + Math.cos(ang)), ny = Math.round(mon.y + Math.sin(ang));
        const ok = mon.def.fly ? canStandAir(b, nx, ny, mon.def.size, mon.id) : false; // ground beasts are held, not dragged through walls
        if (!ok) break;
        occupy(b, mon, 0); mon.x = nx; mon.y = ny; occupy(b, mon, 1);
      }
      fire(b, a, ab, mon.x, mon.y, { to: mon.id });
      return true;
    }
    const s = b.ships.find((q) => q.alive && q.side !== a.side && Math.hypot(q.x - a.x, q.y - a.y) <= 14);
    if (!s) return false;
    const ang = Math.atan2(a.y - s.y, a.x - s.x), nx = s.x + Math.cos(ang) * pull * 0.5, ny = s.y + Math.sin(ang) * pull * 0.5;
    if (!dry(b, nx, ny)) { s.x = nx; s.y = ny; }
    fire(b, a, ab, s.x, s.y, { ship: s.id });
    return true;
  },
  swarm(b, a, ab) {
    const dmg = Math.round(num(ab.dmg, 6, 1, 60)), r = num(ab.radius, 6, 2, 16);
    const foes = enemyAir(b, a, r + a.radius * 0.4), ships = enemyShips(b, a, r + 4);
    if (!foes.length && !ships.length) return false;
    for (const v of foes) { queueHit(b, NOBODY, v, b.rng.int(1, dmg), 0, 'magic', true, { x: a.x, y: a.y }); v.blindUntil = b.tick + 8; }
    for (const o of ships) if (b.rng.chance(0.4)) crewLoss(b, o, 1, a.side);
    fire(b, a, ab, a.x, a.y, { r, n: foes.length + ships.length });
    return true;
  },
  aura(b, a, ab) {
    const r = num(ab.radius, 8, 2, 20), eff = ab.effect || 'courage';
    if (eff === 'courage') { for (const sq of b.squads) if (sq.side === a.side && sq.alive > 0 && Math.hypot(sq.cx - a.x, sq.cy - a.y) <= reach(a, r)) sq.steadyUntil = Math.max(sq.steadyUntil || 0, b.tick + 12); }
    else if (eff === 'frenzy') friendlyBelow(b, a, r, (v) => { if (v.cd > 0) v.cd--; });
    else if (eff === 'vigor') friendlyBelow(b, a, r, (v) => { if (v.hp < v.def.hp) v.hp = Math.min(v.def.hp, v.hp + 2); });
    else if (eff === 'reload') friendlyBelow(b, a, r, (v) => { if (v.ammo !== undefined) v.ammo = Math.min(40, v.ammo + 4); if (v.cd > 0 && v.def.style !== 'melee') v.cd--; });
    else if (eff === 'dispel') friendlyBelow(b, a, r, (v) => { v.poison = null; v.pinUntil = 0; v.blindUntil = 0; });
    else if (eff === 'terror') near(b, a.x, a.y, reach(a, r) + 1, (v) => { if (v.alive && v.side !== a.side && v.aboard < 0 && Math.hypot(v.x - a.x, v.y - a.y) <= reach(a, r) && b.rng.chance(0.35)) v.cd += 2; });
    const key = `aura:${eff}`;
    if ((a.fxSaid?.[key] ?? -999) <= b.tick - 24) { (a.fxSaid ||= {})[key] = b.tick; fire(b, a, ab, a.x, a.y, { r, effect: eff }); }
    return true;
  },
};
function groundMarkUnder(b, a) {
  const st = b.sid[clamp(Math.round(a.y), 0, b.H - 1) * b.W + clamp(Math.round(a.x), 0, b.W - 1)] - 1;
  if (st >= 0) { const s = b.structures[st]; if (!s.destroyed && s.hp > 0 && s.side !== undefined && s.side !== null && s.side !== a.side) return true; }
  return b.ships.some((s) => s.alive && s.side !== a.side && Math.hypot(s.x - a.x, s.y - a.y) < a.radius * 0.5) || b.guns.some((g) => !g.destroyed && g.owner !== null && g.owner !== a.side && Math.hypot(g.cx - a.x, g.cy - a.y) < a.radius * 0.5);
}
// thrown along `ang` by the wind, a tile at a time while the sky is clear
function pushAir(b, v, ang, n) {
  for (let k = 0; k < n; k++) {
    const nx = Math.round(v.x + Math.cos(ang)), ny = Math.round(v.y + Math.sin(ang));
    if (!canStandAir(b, nx, ny, v.def.size, v.id)) break;
    occupy(b, v, 0); v.x = nx; v.y = ny; occupy(b, v, 1);
  }
}
