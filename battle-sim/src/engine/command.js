// Command, supply and support: ranks and specialisations, commanders, rally points and held
// ground, supplies that must be unloaded and hauled, engineers who fortify, vanguards who guard
// and raid, medics who seek out the wounded, and squads that fall back to a commander or a rally
// point when they break.
//
// The shape follows well-known squad AI and infantry doctrine (see docs/TACTICS.md): a strategy
// layer that owns objectives and rally points, a squad layer that assigns roles, and individuals
// that pick positions by scoring them; "consolidate and reorganise" after contact; broken units
// fall back to the last rally point and re-form before going back in.
import { DEEP } from './terrain.js';
import { STRUCTURES } from '../data/structures.js';
import { near, field, walk, walkable, nearestEnemyDist, freeTileNear, rebuildGrid, damageStructure, squadUnits } from './battle.js';
import { addGun } from './support.js';

export const RANKS = ['Recruit', 'Veteran', 'Sergeant', 'Captain'];
export const SPECS = { line: 'line', medic: 'medic', engineer: 'engineer', vanguard: 'vanguard', marksman: 'marksman', commander: 'commander' };
const BOOST = [null, { hp: 1.1, max: 1.1, roll: 1.05 }, { hp: 1.2, max: 1.15, roll: 1.1 }, { hp: 1.5, max: 1.25, roll: 1.2 }];
const BUILDS = {
  sandbags: { cost: 1, work: 5 }, barricade: { cost: 1, work: 5 }, ballista: { cost: 3, work: 12 }, cannon: { cost: 3, work: 12 }, tower: { cost: 4, work: 16 }, tent: { cost: 2, work: 8 },
  mortar: { cost: 3, work: 14 }, harpoon: { cost: 3, work: 12 }, battery: { cost: 4, work: 18 },
};
export const AMMO = 40;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const has = (u, type) => u.def.abilities.some((a) => a.type === type);

function promote(b, u, rank) {
  if (rank <= u.rank) return;
  const base = u.baseDef || u.def, k = BOOST[rank];
  u.baseDef = base;
  // a soldier takes one of his kind's trades when he becomes a veteran, and keeps it
  const trades = base.trades || [];
  if (u.trade === undefined && trades.length) u.trade = (u.id * 7 + (u.id >> 3)) % trades.length;
  const t = trades[u.trade] || null, key = `${base.id}:${rank}:${t ? u.trade : ''}`;
  if (!b.cmd.defs[key]) {
    const d = { ...base, hp: Math.round(base.hp * k.hp * (t?.hp || 1)), max: Math.max(base.max + 1, Math.round(base.max * k.max * (t?.max || 1))), aRoll: Math.round(base.aRoll * k.roll * (t?.roll || 1)),
      name: `${base.name} ${RANKS[rank]}`, rankOf: rank, tradeName: t ? t.name : '' };
    if (t) {
      if (t.speed) d.speed = Math.max(2, Math.round(base.speed * t.speed));
      if (t.range && base.range > 1) d.range = base.range + t.range;
      if (t.move) d.move = base.move + t.move;
      if (t.gain) d.abilities = [...base.abilities.filter((a) => a.type !== t.gain.type), t.gain];
    }
    b.cmd.defs[key] = d;
  }
  const gain = b.cmd.defs[key].hp - u.def.hp;
  u.def = b.cmd.defs[key]; u.hp += Math.max(0, gain); u.rank = rank;
}

export function initCommand(b, scn) {
  b.cmd = { points: [], crates: [], builds: [], defs: {}, shock: [0, 0], commanders: [[], []], nextId: 1, fighters: [99, 99] };
  if (scn.command === false) { for (const u of b.units) { u.rank = 0; u.spec = 'line'; } return; }
  for (let side = 0; side < 2; side++) {
    const mine = b.units.filter((u) => u.side === side);
    for (const u of mine) {
      u.rank = 0;
      u.spec = has(u, 'heal') ? 'medic' : has(u, 'repair') ? 'engineer' : u.def.role === 'artillery' ? 'marksman' : 'line';
    }
    const foot = mine.filter((u) => u.spec === 'line' && !u.def.fly && u.def.role !== 'siege');
    // commanders: the toughest soldiers, one per forty or so, from different squads
    const want = clamp(Math.ceil(mine.length / 40), mine.length ? 1 : 0, 5);
    const cand = foot.filter((u) => u.def.size <= 2).sort((p, q) => q.def.level * q.def.hp - p.def.level * p.def.hp);
    const usedSquads = new Set();
    for (const u of cand) {
      if (b.cmd.commanders[side].length >= want) break;
      if (usedSquads.has(u.squad) && cand.length > want * 3) continue;
      usedSquads.add(u.squad);
      promote(b, u, 3); u.spec = 'commander';
      b.cmd.commanders[side].push(u.id);
    }
    // the general himself is a commander, and carries the army's standard
    for (const u of mine) if (u.def.leader && !b.cmd.commanders[side].includes(u.id)) { promote(b, u, 3); u.spec = 'commander'; b.cmd.commanders[side].unshift(u.id); }
    // sergeants lead squads; a fifth of the rest are veterans
    for (const sq of b.squads) {
      if (sq.side !== side || sq.members.length < 4) continue;
      const lead = sq.members.map((id) => b.units[id]).find((u) => u.rank === 0 && u.spec !== 'medic');
      if (lead) promote(b, lead, 2);
    }
    for (const u of mine) if (u.rank === 0 && b.rng.chance(0.18)) promote(b, u, 1);
    // vanguards: picked foot soldiers who guard the supply chain and raid the enemy's
    const line = foot.filter((u) => u.spec === 'line' && u.def.size === 1 && u.def.style === 'melee');
    const nVan = Math.min(line.length >> 2, Math.max(mine.length >= 16 ? 2 : 0, Math.round(mine.length * 0.08)));
    for (let i = 0; i < nVan; i++) { const u = line[Math.floor((i + 0.5) * line.length / nVan)]; if (u.spec === 'line') { u.spec = 'vanguard'; u.duty = i % 3 === 2 ? 'raid' : 'guard'; } }
    // armies with no engineers of their own detail a few soldiers to the work
    if (!mine.some((u) => u.spec === 'engineer')) {
      const pool = line.filter((u) => u.spec === 'line' && u.rank < 2);
      const n = Math.min(pool.length >> 2, mine.length >= 12 ? Math.max(2, Math.round(mine.length * 0.05)) : 0);
      for (let i = 0; i < n; i++) pool[pool.length - 1 - i].spec = 'engineer';
    }
    // support troops are attached to fighting squads and look to those squads first
    const fighting = b.squads.filter((s) => s.side === side && s.role !== 'support' && s.role !== 'siege' && s.role !== 'air');
    let k = 0;
    for (const u of mine) if ((u.spec === 'medic' || u.spec === 'engineer' || u.spec === 'vanguard') && fighting.length) u.ward = fighting[k++ % fighting.length].id;

    // ground to hold: defenders rally on their own position and on their works, where their stores are
    let garrison = null;
    // (with fixed rally points the ground to hold is laid down by the map: see fronts.js)
    if (b.sides[side].posture === 'defend' && mine.length && (scn.ctf || scn.fronts === false)) {
      const g = mine.filter((u) => u.aboard < 0 && !u.def.fly);
      if (g.length) garrison = addPoint(b, side, 'rally', Math.round(g.reduce((a, u) => a + u.x, 0) / g.length), Math.round(g.reduce((a, u) => a + u.y, 0) / g.length));
      const works = b.structures.filter((s) => s.side === side && !STRUCTURES[s.type].weapon);
      if (works.length >= 4) garrison = addPoint(b, side, 'fort', Math.round(works.reduce((a, s) => a + s.x + s.w / 2, 0) / works.length), Math.round(works.reduce((a, s) => a + s.y + s.h / 2, 0) / works.length));
    }
  }
  for (const p of b.cmd.points) if (p.kind === 'fort' || (p.kind === 'rally' && !b.cmd.points.some((q) => q.side === p.side && q.kind === 'fort'))) p.stock = 4;
  // arrows, bolts and sling stones run out and must be drawn from a stocked point
  for (const u of b.units) if (u.def.style === 'ranged' && !u.def.fly) u.ammo = AMMO;
  // cable cars: towers that share a cable number are joined; the car carries stores to the upper end
  b.cmd.cables = []; // (they run to a timetable now: see transit.js)
  // what there is to unload
  for (const c of b.crafts) c.supplies = 3;
  for (const s of b.ships) s.supplies = s.def.supplies ?? 6;
  for (const a of b.airships) a.supplies = 4;
  b.structures.forEach((st) => {
    if (!STRUCTURES[st.type].cargo) return;
    st.supplies = STRUCTURES[st.type].cargo;
    if (st.side === undefined || st.side === null) st.side = st.x + st.w / 2 < b.W / 2 ? 0 : 1;
  });
}

export function addPoint(b, side, kind, x, y) {
  const spot = freeTileNear(b, clamp(x, 1, b.W - 2), clamp(y, 1, b.H - 2), 1, side);
  if (!spot) return null;
  const p = { id: b.cmd.points.length, side, kind, x: spot[0], y: spot[1], stock: 0, built: 0, since: b.tick };
  b.cmd.points.push(p);
  b.events.push({ type: 'point', point: p.id, side, kind, x: p.x, y: p.y });
  return p;
}
export function addCrate(b, side, x, y, n) {
  const spot = freeTileNear(b, clamp(Math.round(x), 1, b.W - 2), clamp(Math.round(y), 1, b.H - 2), 1, side);
  if (!spot) return null;
  const c = { id: b.cmd.nextId++, side, x: spot[0], y: spot[1], n };
  b.cmd.crates.push(c);
  b.events.push({ type: 'crate', crate: c.id, side, x: c.x, y: c.y, n });
  return c;
}
const pointsOf = (b, side) => b.cmd.points.filter((p) => p.side === side);
function nearestPoint(b, side, x, y) {
  let best = null, bd = Infinity;
  for (const p of b.cmd.points) { if (p.side !== side) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
  return best;
}
function liveCommanders(b, side) { return b.cmd.commanders[side].map((id) => b.units[id]).filter((u) => u.alive && u.aboard < 0); }

/** where a broken squad should run: the nearest rally point or beachhead, else the nearest living commander */
export function fallbackFor(b, sq) {
  let best = null, bd = Infinity;
  const own = b.cmd.points[sq.point];
  if (own && own.side === sq.side && Math.hypot(own.x - sq.cx, own.y - sq.cy) > 5) return { x: own.x, y: own.y, kind: own.kind === 'beachhead' ? 'the beachhead' : own.kind === 'fort' ? 'the fortifications' : 'its rally point' };
  for (const p of b.cmd.points) {
    if (p.side !== sq.side) continue;
    const d = Math.hypot(p.x - sq.cx, p.y - sq.cy);
    if (d > 5 && d < bd) { bd = d; best = { x: p.x, y: p.y, kind: p.kind === 'beachhead' ? 'the beachhead' : p.kind === 'fort' ? 'the fortifications' : 'the rally point' }; }
  }
  for (const c of liveCommanders(b, sq.side)) {
    if (c.squad === sq.id) continue;
    const d = Math.hypot(c.x - sq.cx, c.y - sq.cy) + (best ? 6 : 0); // a marked rally point is preferred when one is about as near
    if (d > 5 && d < bd) { bd = d; best = { x: c.x, y: c.y, kind: 'their commander' }; }
  }
  return best;
}

export function onUnitDeath(b, t, from) {
  if (!b.cmd) return;
  if (t.spec === 'commander') {
    b.cmd.shock[t.side] = b.tick + 40;
    // the squads that were fighting under him lose heart
    for (const sq of b.squads) if (sq.side === t.side && sq.alive > 0 && Math.hypot(sq.cx - t.x, sq.cy - t.y) < 14) sq.leaderless = true;
    b.events.push({ type: 'commanderDown', id: t.id, side: t.side });
  }
  if (t.carry) { addCrate(b, t.side, t.x, t.y, 1); t.carry = 0; }
  // promotions in the field
  if (from && from.alive && from.rank !== undefined && from.rank < 2) {
    const need = from.rank === 0 ? 3 : 8;
    if (from.kills >= need) { promote(b, from, from.rank + 1); b.events.push({ type: 'promoted', id: from.id, rank: from.rank }); }
  }
}

export function commandTick(b) {
  const C = b.cmd;
  if (!C || !b.units.length) return;
  // boats that have beached and emptied put their stores on the sand and mark a beachhead
  for (const c of b.crafts) {
    if (!c.landed || c.sunk || !(c.supplies > 0) || c.passengers.length) continue;
    const x = Math.round(c.x), y = Math.round(c.y);
    if (addCrate(b, c.side, x + 1, y, c.supplies)) {
      c.supplies = 0;
      const p = nearestPoint(b, c.side, x, y);
      if (!b.fronts && (!p || Math.hypot(p.x - x, p.y - y) > 12)) addPoint(b, c.side, 'beachhead', x + 2, y);
    }
  }
  if (b.tick % 10 !== 0) return;
  // inns and temples tend the wounded of whoever holds them; cable cars keep running while both towers stand
  for (const st of b.structures) {
    const h = STRUCTURES[st.type].heals;
    if (!h || st.destroyed) continue;
    near(b, st.x + (st.w >> 1), st.y + (st.h >> 1), 6, (u) => { if (u.alive && u.aboard < 0 && u.hp < u.def.hp && (st.side === undefined || st.side === null || st.side === u.side) && Math.max(st.x - u.x, u.x - (st.x + st.w - 1), st.y - u.y, u.y - (st.y + st.h - 1)) <= 3) u.hp = Math.min(u.def.hp, u.hp + h); });
  }
  for (const cb of C.cables || []) {
    const A = b.structures[cb.a], Z = b.structures[cb.c];
    cb.live = !A.destroyed && !Z.destroyed;
    if (!cb.live || b.tick < cb.next) continue;
    cb.next = b.tick + 70;
    if (addCrate(b, cb.side, Z.x - 1, Z.y + 1, 1)) b.events.push({ type: 'cable', a: cb.a, c: cb.c });
  }
  C.fighters = [0, 0];
  for (const u of b.units) if (u.alive && (u.spec === 'line' || u.spec === 'marksman' || u.spec === 'commander' || u.spec === undefined)) C.fighters[u.side]++;
  // ships lying close inshore send stores across; zeppelins lower theirs onto a held point
  if (b.tick % 50 === 0) for (const s of b.ships) {
    if (!s.alive || !(s.supplies > 0)) continue;
    let best = null, bd = 8;
    for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
      const x = Math.round(s.x) + dx, y = Math.round(s.y) + dy;
      if (x < 1 || y < 1 || x >= b.W - 1 || y >= b.H - 1 || !walkable(b, x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best && addCrate(b, s.side, best[0], best[1], 1)) { s.supplies--; b.events.push({ type: 'shipSupply', ship: s.id, x: best[0], y: best[1] }); }
  }
  if (b.tick % 20 !== 0) return;
  // Each fighting squad decides where it rallies and what ground it holds: the nearest marked point
  // behind it if one is close, otherwise a new point of its own a few tiles back from where it stands
  // (on its commander if he is near). Squads that end up close together share a point.
  const foe = [[], []];
  for (const u of b.units) if (u.alive && u.aboard < 0) foe[1 - u.side].push(u);
  for (const sq of b.squads) {
    if (sq.alive < 2 || sq.role === 'support' || sq.role === 'air' || sq.role === 'siege') continue;
    const us = squadUnits(b, sq).filter((u) => u.aboard < 0 && !u.def.fly);
    if (us.length < 2 || !foe[sq.side].length) continue;
    const cx = us.reduce((a, u) => a + u.x, 0) / us.length, cy = us.reduce((a, u) => a + u.y, 0) / us.length;
    let ex = 0, ey = 0, ed = Infinity;
    for (const t of foe[sq.side]) { const d = Math.hypot(t.x - cx, t.y - cy); if (d < ed) { ed = d; ex = t.x; ey = t.y; } }
    const cur = C.points[sq.point];
    // keep the present point while it is still close and not in front of the squad
    const ahead = (p) => (p.x - cx) * (ex - cx) + (p.y - cy) * (ey - cy) > 9;
    if (cur && cur.side === sq.side && (b.fronts ? (b.tick + sq.id) % 40 !== 0 : Math.hypot(cur.x - cx, cur.y - cy) < 16 && !ahead(cur))) continue;
    // with fixed points a squad rallies on the nearest its side holds, however far
    let best = null, bd = b.fronts ? Infinity : 14;
    for (const p of C.points) { if (p.side !== sq.side || (!b.fronts && ahead(p))) continue; const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = p; } }
    if (!best && !b.fronts && pointsOf(b, sq.side).length < 10 && ed > 5) {
      const cmd = liveCommanders(b, sq.side).find((c) => Math.hypot(c.x - cx, c.y - cy) < 8);
      const d = ed || 1, bx = cmd ? cmd.x : cx, by = cmd ? cmd.y : cy;
      best = addPoint(b, sq.side, b.sides[sq.side].posture === 'defend' || sq.state === 'hold' ? 'hold' : 'rally', Math.round(bx - ((ex - cx) / d) * 4), Math.round(by - ((ey - cy) / d) * 4));
      if (best) best.squad = sq.id;
    }
    if (best) sq.point = best.id;
  }
}

// ---------- individual duties ----------
const gapTo = (u, x, y, w = 1, h = 1) => Math.max(Math.max(x - u.x, u.x - (x + w - 1), 0), Math.max(y - u.y, u.y - (y + h - 1), 0));
function goTo(b, u, key, x, y, w = 1, h = 1) {
  const f = field(b, key, 40, () => {
    const out = [];
    for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (walkable(b, xx, yy)) out.push(yy * b.W + xx);
    return out;
  });
  if (!f || f[u.y * b.W + u.x] >= 32767) return false;
  walk(b, u, f, 1, 0);
  return true;
}

/** true when the unit spent its tick on its specialist duty */
export function specDuty(b, u) {
  if (!b.cmd || u.aboard >= 0 || u.def.fly) return false;
  if (b.cmd.fighters[u.side] < 4 || b.tick > 1400) return false; // the line has gone, or the day is dragging: everyone fights
  if (u.spec === 'engineer') return engineerDuty(b, u);
  if (u.spec === 'medic') return medicDuty(b, u);
  if (u.spec === 'vanguard') return vanguardDuty(b, u);
  if (u.ammo !== undefined) return resupply(b, u);
  return false;
}

function engineerDuty(b, u) {
  const C = b.cmd;
  if (nearestEnemyDist(b, u, 3).d <= 2) return false;
  // carrying a load to where it is wanted
  if (u.carry) {
    const p = C.points[u.carryTo];
    if (!p) { u.carry = 0; addCrate(b, u.side, u.x, u.y, 1); return false; }
    if (gapTo(u, p.x, p.y) <= 1) { p.stock++; u.carry = 0; b.events.push({ type: 'supplyIn', point: p.id, stock: p.stock, by: u.id }); return true; }
    if (goTo(b, u, `pt${p.id}`, p.x, p.y)) return true;
    // cannot get there: set it down and leave hauling alone for a while
    u.carry = 0; u.noHaul = b.tick + 150; addCrate(b, u.side, u.x, u.y, 1);
    return false;
  }
  // working on something being built
  if (u.site !== undefined && u.site >= 0) {
    const s = C.builds[u.site];
    if (!s || s.done) u.site = -1;
    else {
      if (gapTo(u, s.x, s.y, s.w, s.h) <= 1) {
        s.progress++; u.lastAttack = b.tick; u.face = Math.atan2(s.y + s.h / 2 - u.y - 0.5, s.x + s.w / 2 - u.x - 0.5);
        if (s.progress >= s.work) finishBuild(b, s, u);
        return true;
      }
      if (goTo(b, u, `site${s.id}`, s.x, s.y, s.w, s.h)) return true;
      u.site = -1;
    }
  }

  // fetch: a crate on the ground, or a rail car that still has stores
  let pts = pointsOf(b, u.side);
  let src = null, sd = 45;
  if (!(u.noHaul > b.tick)) for (const c of C.crates) { if (c.side !== u.side || c.n <= (c.claims || 0)) continue; const d = Math.hypot(c.x - u.x, c.y - u.y); if (d < sd) { sd = d; src = { crate: c }; } }
  if (!(u.noHaul > b.tick)) b.structures.forEach((st, idx) => { if (st.destroyed || !(st.supplies > 0) || st.side !== u.side) return; const d = Math.hypot(st.x - u.x, st.y - u.y); if (d < sd) { sd = d; src = { car: st, idx }; } });
  u.fetch = !!src;
  if (src) {
    if (!pts.length && !b.fronts) { const cmd = liveCommanders(b, u.side)[0]; if (cmd) addPoint(b, u.side, 'rally', cmd.x, cmd.y); pts = pointsOf(b, u.side); }
    if (pts.length) {
      const sx = src.crate ? src.crate.x : src.car.x, sy = src.crate ? src.crate.y : src.car.y, sw = src.crate ? 1 : src.car.w, sh = src.crate ? 1 : src.car.h;
      // a crate already lying at a point is simply taken into its stock
      const here = src.crate && pts.find((p) => Math.hypot(p.x - sx, p.y - sy) <= 2);
      if (gapTo(u, sx, sy, sw, sh) <= 1) {
        if (src.crate) { src.crate.n--; if (src.crate.n <= 0) { C.crates.splice(C.crates.indexOf(src.crate), 1); b.events.push({ type: 'crateGone', crate: src.crate.id }); } }
        else src.car.supplies--;
        if (here) { here.stock++; b.events.push({ type: 'supplyIn', point: here.id, stock: here.stock, by: u.id }); return true; }
        // take it to the point that is shortest of stores, nearer ones first
        const mine = b.squads[u.ward] ? b.squads[u.ward].point : -1;
        const dest = pts.slice().sort((p, q) => (p.stock - q.stock) * 6 + Math.hypot(p.x - u.x, p.y - u.y) - Math.hypot(q.x - u.x, q.y - u.y) - (p.id === mine ? 14 : 0) + (q.id === mine ? 14 : 0))[0];
        u.carry = 1; u.carryTo = dest.id;
        b.events.push({ type: 'supplyUp', by: u.id });
        return true;
      }
      if (goTo(b, u, src.crate ? `cr${src.crate.id}` : `car${src.idx}`, sx, sy, sw, sh)) return true;
      u.noHaul = b.tick + 150;
    }
  }
  // build: whatever the nearest stocked point most needs
  // one load is always kept back for ammunition and dressings
  const stocked = pts.filter((p) => p.stock > 1).sort((p, q) => Math.hypot(p.x - u.x, p.y - u.y) - Math.hypot(q.x - u.x, q.y - u.y));
  for (const p of stocked) {
    const open = C.builds.find((s) => !s.done && s.point === p.id && s.side === u.side);
    const s = open || planBuild(b, u.side, p);
    if (s) { u.site = s.id; return true; }
  }
  // nothing to haul or build: wait at the nearest held point rather than wander into the fighting
  const home = pts.sort((p, q) => Math.hypot(p.x - u.x, p.y - u.y) - Math.hypot(q.x - u.x, q.y - u.y))[0];
  if (home && b.cmd.fighters[u.side] >= 4 && (b.tick + u.id) % 3) {
    if (gapTo(u, home.x, home.y) <= 3) return b.structures.every((st) => st.destroyed || !st.maxHp || st.hp >= st.maxHp); // unless something needs mending
    return goTo(b, u, `pt${home.id}`, home.x, home.y);
  }
  return false;
}

function planBuild(b, side, p) {
  const C = b.cmd;
  let ex = 0, ey = 0, n = 0, air = false, ed = Infinity;
  for (const t of b.units) { if (!t.alive || t.side === side) continue; if (t.def.fly) air = true; if (t.aboard >= 0) continue; ex += t.x; ey += t.y; n++; ed = Math.min(ed, Math.hypot(t.x - p.x, t.y - p.y)); }
  if (b.airships.some((a) => a.alive && a.side !== side)) air = true;
  if (!n) return null;
  ex /= n; ey /= n;
  const ang = Math.atan2(ey - p.y, ex - p.x);
  const gunsNear = (type) => b.guns.filter((g) => !g.destroyed && (!type || g.type === type) && Math.hypot(g.cx - p.x, g.cy - p.y) < 9).length;
  const sitesOf = (type) => C.builds.filter((s) => s.point === p.id && s.type === type).length;
  // the situation decides: air defence against fliers, a gun for a beachhead or fort, an aid tent
  // once the place has stood a while, a watchtower for a long hold, otherwise a breastwork facing the enemy
  let type;
  if (air && p.stock >= 3 && !gunsNear('ballista') && !sitesOf('ballista')) type = 'ballista';
  else if (p.fixed && sea(b, side) && p.stock >= 4 && !gunsNear('battery') && !sitesOf('battery')) type = 'battery';       // guns that reach the boats
  else if (p.fixed && sea(b, side) && p.stock >= 3 && !gunsNear('harpoon') && !sitesOf('harpoon') && p.built >= 2) type = 'harpoon';
  else if ((p.kind === 'beachhead' || p.kind === 'fort' || p.fixed) && p.stock >= 3 && gunsNear() < 2 && sitesOf('cannon') < 1) type = 'cannon';
  else if (p.fixed && p.stock >= 3 && p.built >= 3 && !gunsNear('mortar') && !sitesOf('mortar') && ed > 8) type = 'mortar';
  else if (p.stock >= 4 && p.built >= 4 && !sitesOf('tower')) type = 'tower';
  else if (p.stock >= 2 && p.built >= 2 && !sitesOf('tent') && b.tick - p.since > 60) type = 'tent';
  else if (p.built < 9) type = p.built % 2 ? 'barricade' : 'sandbags';
  else return null;
  return startBuild(b, side, p, type, false, ang);
}
// is there anything of the enemy's still on the water for shore guns to shoot at?
const sea = (b, side) => b.crafts.some((c) => c.side !== side && !c.sunk && !c.landed) || b.ships.some((sh) => sh.alive && sh.side !== side);

/** mark out a work of this type at a point and charge its stores (`free` raises it whatever the stock) */
export function startBuild(b, side, p, type, free0 = false, ang = 0) {
  const C = b.cmd;
  const def = STRUCTURES[type], B = BUILDS[type];
  if (!def || !B) return null;
  // breastworks go in an arc toward the enemy; everything else just behind it
  const slot = p.built, front = type === 'sandbags' || type === 'barricade';
  const horiz = Math.abs(Math.cos(ang)) < 0.7; // enemy mostly north or south: lay the work east-west
  const rot = front && !horiz ? 1 : 0;
  const w = rot ? def.h : def.w, h = rot ? def.w : def.h;
  const free = (x, y) => {
    if (x < 1 || y < 1 || x + w >= b.W - 1 || y + h >= b.H - 1) return false;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = yy * b.W + xx; if (b.sid[i] || !walkable(b, xx, yy)) return false; }
    return !C.builds.some((s) => !s.done && x < s.x + s.w + 1 && s.x < x + w + 1 && y < s.y + s.h + 1 && s.y < y + h + 1) && Math.hypot(x - p.x, y - p.y) >= 2;
  };
  const off = front ? ((slot % 5) - 2) * 0.42 : (slot % 2 ? 1 : -1) * 0.5 * (1 + (slot >> 1));
  const r = front ? 4 + Math.floor(slot / 5) * 2 : 2;
  const wx = Math.round(p.x + Math.cos(ang + off) * r), wy = Math.round(p.y + Math.sin(ang + off) * r);
  let spot = null, bd = Infinity;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = wx + dx, y = wy + dy, d = Math.hypot(dx, dy);
    if (d < bd && free(x, y)) { bd = d; spot = [x, y]; }
  }
  if (spot) {
    const [x, y] = spot;
    const s = { id: C.builds.length, side, point: p.id, type, x, y, w, h, rot, work: B.work, progress: 0, done: false };
    C.builds.push(s);
    if (!free0) p.stock -= B.cost;
    b.events.push({ type: 'buildStart', site: s.id, side, kind: type, x, y, w, h });
    return s;
  }
  return null;
}

export function finishBuild(b, s, u) {
  const def = STRUCTURES[s.type];
  // wait for anyone standing in the way of something solid
  if (def.blocksMove) for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) if (b.occ[y * b.W + x]) { s.progress = s.work - 1; return; }
  s.done = true;
  const idx = b.structures.length;
  b.structures.push({ type: s.type, x: s.x, y: s.y, rot: s.rot, side: s.side, w: s.w, h: s.h, hp: def.hp || 0, maxHp: def.hp || 0, destroyed: false, built: true });
  rebuildGrid(b); b.fields.clear();
  b.hasRamparts = b.level.some((l) => l > 0);
  if (def.weapon) addGun(b, idx);
  const p = b.cmd.points[s.point];
  if (p) p.built++;
  u.site = -1;
  b.events.push({ type: 'built', site: s.id, s: idx, side: s.side, kind: s.type, by: u.id });
}

// A shooter low on ammunition, or a medic out of dressings, draws more from the nearest stocked point.
// Each issue uses a share of a load, so a starved or raided point leaves them short.
function resupply(b, u) {
  const heal = u.def.abilities.find((a) => a.type === 'heal');
  const dry = u.ammo !== undefined ? u.ammo <= 0 : heal && (u.heals || 0) >= (heal.charges || 20);
  const low = u.ammo !== undefined ? u.ammo <= 5 : dry;
  if (!low) return false;
  let best = null, bd = dry ? 36 : 4;
  for (const p of b.cmd.points) { if (p.side !== u.side || p.stock <= 0) continue; const d = Math.hypot(p.x - u.x, p.y - u.y); if (d < bd) { bd = d; best = p; } }
  if (!best) { if (dry && !u.outSaid) { u.outSaid = true; b.events.push({ type: 'outOfAmmo', id: u.id, side: u.side, medic: u.ammo === undefined }); } return false; }
  if (bd <= 3) {
    if (u.ammo !== undefined) u.ammo = AMMO; else u.heals = 0;
    u.outSaid = false;
    best.issued = (best.issued || 0) + (u.ammo !== undefined ? 0.2 : 0.34);
    if (best.issued >= 1) { best.issued -= 1; best.stock--; b.events.push({ type: 'supplyIn', point: best.id, stock: best.stock, by: u.id }); }
    b.events.push({ type: 'resupplied', id: u.id });
    return true;
  }
  if (!dry || nearestEnemyDist(b, u, 4).d <= 3) return false;
  return goTo(b, u, `pt${best.id}`, best.x, best.y);
}

// Medics go to the wounded: their own squad first, then anyone near.
function medicDuty(b, u) {
  const heal = u.def.abilities.find((a) => a.type === 'heal');
  if (!heal) return false;
  if ((u.heals || 0) >= (heal.charges || 20)) return resupply(b, u);
  let best = null, bs = 0.7;
  const consider = (a, bias) => { if (!a.alive || a === u || a.aboard >= 0 || a.def.fly) return; const r = a.hp / a.def.hp + bias + Math.hypot(a.x - u.x, a.y - u.y) * 0.01; if (r < bs) { bs = r; best = a; } };
  const ward = b.squads[u.ward];
  if (ward) for (const a of squadUnits(b, ward)) consider(a, -0.15);
  if (!best || (b.tick + u.id) % 5 === 0) near(b, u.x, u.y, 16, (a) => { if (a.side === u.side) consider(a, 0); });
  if (!best) return false;
  if (Math.max(Math.abs(best.x - u.x), Math.abs(best.y - u.y)) <= Math.max(1, heal.range - 1)) return false; // close enough: the ordinary healing takes over
  const f = field(b, `m${best.id}`, 3, () => [best.y * b.W + best.x]);
  if (!f || f[u.y * b.W + u.x] >= 32767) return false;
  walk(b, u, f, heal.range, Math.max(1, heal.range - 1));
  return true;
}

// Vanguards: most stand guard over the supply chain, the medics and the engineers; some go for the enemy's stores.
function vanguardDuty(b, u) {
  const C = b.cmd;
  if (nearestEnemyDist(b, u, 6).d <= 4) return false; // a threat in reach is dealt with first
  if (u.duty === 'raid') {
    let tgt = null, bd = 60;
    for (const c of C.crates) { if (c.side === u.side) continue; const d = Math.hypot(c.x - u.x, c.y - u.y); if (d < bd) { bd = d; tgt = { crate: c, x: c.x, y: c.y, w: 1, h: 1, key: `cr${c.id}` }; } }
    for (const p of C.points) { if (p.side === u.side || p.stock <= 0) continue; const d = Math.hypot(p.x - u.x, p.y - u.y); if (d < bd) { bd = d; tgt = { point: p, x: p.x, y: p.y, w: 1, h: 1, key: `pt${p.id}` }; } }
    b.structures.forEach((st, idx) => { if (st.destroyed || !(st.supplies > 0) || st.side === u.side) return; const d = Math.hypot(st.x - u.x, st.y - u.y); if (d < bd) { bd = d; tgt = { car: st, idx, x: st.x, y: st.y, w: st.w, h: st.h, key: `car${idx}` }; } });
    if (!tgt) return false;
    if (gapTo(u, tgt.x, tgt.y, tgt.w, tgt.h) <= 1) {
      if (u.cd > 0) return true;
      u.cd = u.def.speed; u.lastAttack = b.tick;
      if (tgt.crate) { tgt.crate.side = u.side; tgt.crate.claims = 0; b.events.push({ type: 'raid', by: u.id, side: u.side, what: 'crate', crate: tgt.crate.id }); } // carried off for their own side
      else if (tgt.point) { tgt.point.stock--; b.events.push({ type: 'raid', by: u.id, side: u.side, what: 'stores', point: tgt.point.id, stock: tgt.point.stock }); }
      else { tgt.car.supplies = Math.max(0, tgt.car.supplies - 2); damageStructure(b, tgt.idx, 40, u); b.events.push({ type: 'raid', by: u.id, side: u.side, what: 'rail car' }); }
      return true;
    }
    return goTo(b, u, tgt.key, tgt.x, tgt.y, tgt.w, tgt.h);
  }
  // guard: stay close to the nearest medic or engineer of the squad it is attached to, else the nearest stores
  let ward = null, bd = 40;
  near(b, u.x, u.y, 24, (a) => {
    if (!a.alive || a.side !== u.side || a.aboard >= 0 || (a.spec !== 'medic' && a.spec !== 'engineer')) return;
    const d = Math.hypot(a.x - u.x, a.y - u.y) - (a.ward === u.ward ? 8 : 0);
    if (d < bd) { bd = d; ward = a; }
  });
  if (!ward) { const p = pointsOf(b, u.side).filter((q) => q.stock > 0 || C.crates.some((c) => c.side === u.side && Math.hypot(c.x - q.x, c.y - q.y) < 6)).sort((p1, p2) => Math.hypot(p1.x - u.x, p1.y - u.y) - Math.hypot(p2.x - u.x, p2.y - u.y))[0]; if (p) ward = p; }
  if (!ward) return false;
  if (Math.max(Math.abs(ward.x - u.x), Math.abs(ward.y - u.y)) <= 3) return true; // on post
  const f = field(b, ward.def ? `m${ward.id}` : `gp${ward.id}`, 3, () => [ward.y * b.W + ward.x]);
  if (!f || f[u.y * b.W + u.x] >= 32767) return false;
  walk(b, u, f, 3, 2);
  return true;
}
