// Lines of supply that run to a timetable: trains, cable cars and hot-air balloons.
//
//   rail     each army's track comes in from its own edge of the map and passes a station at every one
//            of its rally points. The train loads at the depot on the map edge and sets stores down at
//            each station it calls at. It will not run on to a station the enemy holds.
//   cable    the cable-car towers of a town are strung together, one in each district; the car calls at
//            every tower in turn and sets a crate down at each.
//   balloon  a mooring mast stands at each rally point. A balloon flies the round of its side's masts,
//            carrying stores from headquarters to the outposts and lifting soldiers who are posted to a
//            point far from where they stand.
//
// The track and the masts are planned before the battle is built (planTransit), so the ground can be
// levelled for them; the vehicles are set running once the rally points exist (initTransit).
import { STRUCTURES } from '../data/structures.js';
import { isWater, FORD } from './terrain.js';
import { field, walk, near, attack, damage, spawnUnit, addSquad, nearestEnemyDist, freeTileNear, occupy, structureFootprint } from './battle.js';
import { addCrate } from './command.js';
import { plannedPoints } from './fronts.js';

export const RIDE = 9000;   // u.aboard >= RIDE means "in the basket of balloon line (aboard - RIDE)"
const STOP = { rail: 12, cable: 8, balloon: 10 };   // ticks a vehicle stands at a stop
const STEP = { rail: 1, cable: 0.7, balloon: 0.8 }; // tiles a tick
const TRAIN_LOAD = 8, CAR_LOAD = 3, BASKET_LOAD = 3, BASKET_MEN = 6;
const FAR = 26;            // a soldier posted this far from his point looks for a balloon
const MAST_R = 10;         // and will walk this far to a mast

const CAR_HP = 220, BEAST_HP = 150; // a handcar's frame; a pack beast

// Peoples who keep no engines: their stores come up the trail on the backs of beasts.
export const SAVAGE = new Set(['beasts', 'dragons', 'cloven', 'fimbul', 'gorge', 'verdant', 'screaming', 'xibalba', 'greenhide', 'mistisles', 'elemental']);
/** whose army a side is: as the scenario says, else the realm most of its soldiers belong to, else what they are */
export function sideFaction(b, side) {
  if (b.sides[side].faction) return b.sides[side].faction;
  const tally = new Map();
  for (const u of b.units) {
    if (u.side !== side || u.crewOf !== undefined) continue;
    const id = u.def.id || '';
    const f = u.def.realm || (/goblin|hobgob|wolfRider/i.test(id) ? 'goblin' : /skelet|zombie|ghoul|wraith|lich|necro/i.test(id) ? 'undead' : /imp|demon|hell|fiend/i.test(id) ? 'infernal' : /dragon|wyvern|drake|wyrm|kobold/i.test(id) ? 'dragons'
      : /elemental|golem|sprite/i.test(id) ? 'elemental' : /wolf|bear|boar|beast|spider|bat|centaur|minotaur|cyclops|troll|ogre/i.test(id) ? 'beasts' : 'kingdom');
    tally.set(f, (tally.get(f) || 0) + 1);
  }
  return [...tally].sort((a, c) => c[1] - a[1])[0]?.[0] || (side === 1 && b.style) || 'kingdom';
}

const plans = new WeakMap();

/** Dijkstra over the tiles a track may cross, with a price on every bend so the line runs straight */
function routes(W, H, free, sx, sy) {
  const N = W * H, cost = new Float32Array(N * 4).fill(Infinity), from = new Int32Array(N * 4).fill(-1);
  const heap = [];
  const push = (c, s) => { heap.push([c, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; const l = i * 2 + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  for (let d = 0; d < 4; d++) { cost[(sy * W + sx) * 4 + d] = 0; push(0, (sy * W + sx) * 4 + d); }
  while (heap.length) {
    const [c, s] = pop();
    if (c > cost[s]) continue;
    const t = s >> 2, d = s & 3, x = t % W, y = (t / W) | 0;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue;
      const nx = x + DX[nd], ny = y + DY[nd];
      if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
      const f = free[ny * W + nx];
      if (!f) continue;
      const nc = c + f + (nd === d ? 0 : 7), ns = (ny * W + nx) * 4 + nd;
      if (nc < cost[ns]) { cost[ns] = nc; from[ns] = s; push(nc, ns); }
    }
  }
  return { cost, from };
}

/**
 * Where the track runs and the masts stand, for this scenario. Returns null when there is nothing to plan,
 * otherwise { extra: structures to add, taken: tiles they cover, rails: [{ side, path, stations }], masts }.
 */
export function planTransit(b, scn, SCENERY) {
  if (scn.mode === 'naval' || scn.ctf || scn.fronts === false || scn.transit === false) return null;
  const key = `${(scn.structures || []).length}:${JSON.stringify(scn.points || 0)}:${scn.terrainSeed}:${scn.shape}:${scn.size}`;
  const had = plans.get(scn);
  if (had && had.key === key) return had.plan;
  const { W, H } = b, N = W * H, pts = plannedPoints(b, scn);
  // ground a track or a mast may stand on: dry, and clear of everything built
  const free = new Float32Array(N), solid = new Uint8Array(N);
  for (let i = 0; i < N; i++) free[i] = b.terrain[i] === FORD ? 4 : isWater(b.terrain[i]) ? 0 : 1;
  for (const s of scn.structures || []) {
    if (!STRUCTURES[s.type] || SCENERY.has(s.type) || s.type === 'rail') continue;
    const { w, h } = structureFootprint(s);
    for (let y = s.y - 1; y < s.y + h + 1; y++) for (let x = s.x - 1; x < s.x + w + 1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const inside = x >= s.x && y >= s.y && x < s.x + w && y < s.y + h;
      if (inside) { free[y * W + x] = 0; solid[y * W + x] = 1; } else if (free[y * W + x]) free[y * W + x] = Math.max(free[y * W + x], 2.5); // keep a little off the walls
    }
  }
  for (const p of pts) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = p.x + dx, y = p.y + dy; if (x >= 0 && y >= 0 && x < W && y < H) free[y * W + x] = 0; } // the banner's own ground
  const plan = { extra: [], taken: new Set(), rails: [], masts: [] };
  const cheb = (x, y, p) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));

  // ---- rail: from the army's edge of the map past each of its points
  for (const side of [0, 1]) {
    if (scn.mode === 'amphibious' && side === 0) continue; // a landing force is supplied by sea
    const mine = pts.map((p, i) => ({ ...p, pi: i })).filter((p) => p.side === side);
    if (!mine.length) continue;
    const ex = side === 0 ? 1 : W - 2, hq = mine.find((p) => p.role === 'hq') || mine[0];
    let depot = null;
    for (let d = 0; d < H && !depot; d++) for (const y of [hq.y + d, hq.y - d]) if (y > 2 && y < H - 3 && free[y * W + ex] && free[y * W + ex + (side === 0 ? 1 : -1)]) { depot = [ex, y]; break; }
    if (!depot) continue;
    const order = mine.slice().sort((a, c) => Math.abs(a.x - ex) - Math.abs(c.x - ex));
    const path = [depot], stations = [{ k: 0, pi: -1, x: depot[0], y: depot[1] }];
    let cur = depot;
    for (const p of order) {
      const { cost, from } = routes(W, H, free, cur[0], cur[1]);
      let best = -1, bs = Infinity;
      for (let y = Math.max(1, p.y - 9); y <= Math.min(H - 2, p.y + 9); y++) for (let x = Math.max(1, p.x - 9); x <= Math.min(W - 2, p.x + 9); x++) {
        const d = cheb(x, y, p);
        if (d < 3) continue;
        for (let dir = 0; dir < 4; dir++) { const c = cost[(y * W + x) * 4 + dir]; if (c === Infinity) continue; const sc = d * 9 + c * 0.25; if (sc < bs) { bs = sc; best = (y * W + x) * 4 + dir; } }
      }
      if (best < 0) continue;
      const leg = [];
      for (let s = best; s >= 0; s = from[s]) leg.push([(s >> 2) % W, ((s >> 2) / W) | 0]);
      leg.reverse();
      for (let i = 1; i < leg.length; i++) path.push(leg[i]);
      cur = leg[leg.length - 1];
      stations.push({ k: path.length - 1, pi: p.pi, x: cur[0], y: cur[1] });
    }
    if (stations.length < 2) continue;
    // lay it: each straight run is one length of track
    const laid = new Set();
    let i = 0;
    while (i < path.length - 1) {
      const dx = path[i + 1][0] - path[i][0], dy = path[i + 1][1] - path[i][1];
      let j = i + 1;
      while (j < path.length - 1 && path[j + 1][0] - path[j][0] === dx && path[j + 1][1] - path[j][1] === dy && j - i < 39) j++;
      const x0 = Math.min(path[i][0], path[j][0]), y0 = Math.min(path[i][1], path[j][1]), len = j - i + 1, k = `${x0},${y0},${dx ? 0 : 1},${len}`;
      if (!laid.has(k)) { laid.add(k); plan.extra.push({ type: 'rail', x: x0, y: y0, rot: dx ? 0 : 1, len, line: side }); }
      i = j;
    }
    for (const [x, y] of path) { plan.taken.add(y * W + x); free[y * W + x] = Math.min(free[y * W + x] || 1, 1); solid[y * W + x] = 2; }
    plan.rails.push({ side, path, stations });
  }

  // ---- masts: one at each rally point (a mooring tower already standing there serves)
  const moor = (scn.structures || []).filter((s) => STRUCTURES[s.type] && STRUCTURES[s.type].mooring);
  pts.forEach((p, pi) => {
    if (scn.mode === 'amphibious' && p.side === 0) return; // nobody raises a mast on a beach under fire
    const near = moor.find((s) => (s.side ?? 1) === p.side && Math.hypot(s.x + 1 - p.x, s.y + 1 - p.y) <= 9);
    if (near) { plan.masts.push({ pi, side: p.side, x: near.x, y: near.y, type: near.type }); return; }
    for (let rad = 3; rad <= 8; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      const x = p.x + dx, y = p.y + dy;
      if (x < 2 || y < 2 || x >= W - 3 || y >= H - 3) continue;
      let ok = true;
      for (let yy = y - 1; yy <= y + 2 && ok; yy++) for (let xx = x - 1; xx <= x + 2; xx++) { const i = yy * W + xx; if (solid[i] || isWater(b.terrain[i]) || b.terrain[i] === FORD) { ok = false; break; } }
      if (!ok) continue;
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) { solid[yy * W + xx] = 1; plan.taken.add(yy * W + xx); }
      plan.extra.push({ type: 'balloonMast', x, y, rot: 0, side: p.side });
      plan.masts.push({ pi, side: p.side, x, y, type: 'balloonMast' });
      return;
    }
  });
  const out = plan.extra.length ? plan : null;
  plans.set(scn, { key, plan: out });
  return out;
}

const open = (b, L, s) => (s.st < 0 || !b.structures[s.st].destroyed) && (s.point < 0 || b.cmd.points[s.point].side === L.side);

function makeLine(b, kind, side, stops, path) {
  const L = { id: b.transit.lines.length, kind, side, stops, path, k: 0, dir: 1, wait: STOP[kind], cargo: 0, riders: [], live: true,
    x: path[0][0], y: path[0][1], px: path[0][0], py: path[0][1], calls: 0, delivered: 0, lifted: 0 };
  L.at = new Map(stops.map((s, i) => [s.k, i]));
  b.transit.lines.push(L);
  return L;
}
/** a straight flight or cable between stops, sampled every `step` tiles: [x, y, leg, fraction along it] */
function strung(stops, step) {
  const path = [];
  stops.forEach((s, i) => {
    s.k = path.length;
    path.push([s.x, s.y, Math.min(i, stops.length - 2), i === stops.length - 1 ? 1 : 0]);
    if (i === stops.length - 1) return;
    const n = stops[i + 1], d = Math.hypot(n.x - s.x, n.y - s.y), m = Math.max(1, Math.round(d / step));
    for (let j = 1; j < m; j++) path.push([s.x + ((n.x - s.x) * j) / m, s.y + ((n.y - s.y) * j) / m, i, j / m]);
  });
  return path;
}
/** put the stops in an order that does not double back: from the first, always on to the nearest left */
function chain(list) {
  const out = [list[0]], rest = list.slice(1);
  while (rest.length) {
    const a = out[out.length - 1];
    let bi = 0, bd = Infinity;
    rest.forEach((s, i) => { const d = Math.hypot(s.x - a.x, s.y - a.y); if (d < bd) { bd = d; bi = i; } });
    out.push(rest.splice(bi, 1)[0]);
  }
  return out;
}

export function initTransit(b, scn, plan) {
  b.transit = { lines: [], air: [null, null] };
  const structAt = (type, x, y) => b.structures.findIndex((s) => s.type === type && s.x === x && s.y === y);
  // cable cars: every tower that shares a cable number is a stop on the one line
  const cables = new Map();
  b.structures.forEach((st, idx) => { if (STRUCTURES[st.type].cable && st.cable !== undefined) { if (!cables.has(st.cable)) cables.set(st.cable, []); cables.get(st.cable).push({ x: st.x + st.w / 2, y: st.y + st.h / 2, st: idx, point: -1, stop: st.stop ?? 99 }); } });
  for (const list of cables.values()) {
    if (list.length < 2) continue;
    const stops = chain(list.sort((a, c) => a.stop - c.stop));
    makeLine(b, 'cable', b.structures[stops[0].st].side ?? 1, stops, strung(stops, STEP.cable)).cargo = CAR_LOAD;
  }
  if (!plan || !b.fronts) { if (!b.transit.lines.length) b.transit = null; return; }
  const pointOf = (pi) => { const p = b.cmd.points.find((q) => q.fixed && q.src === pi); return p ? p.id : -1; };
  for (const r of plan.rails) {
    const stops = r.stations.map((s) => ({ x: s.x, y: s.y, k: s.k, st: -1, point: s.pi < 0 ? -1 : pointOf(s.pi), depot: s.pi < 0 }));
    const L = makeLine(b, 'rail', r.side, stops, r.path);
    L.cargo = TRAIN_LOAD; L.crew = [];
    L.faction = sideFaction(b, r.side);
    L.beasts = SAVAGE.has(L.faction);
    if (L.beasts) L.cars = L.faction === 'fimbul' ? 2 : 3;
    else {
      // two handcars, two hands to each: the least of the army's foot work the pump
      L.cars = 2;
      let def = null;
      for (const u of b.units) { const d = u.def; if (u.side !== r.side || d.fly || d.leader || (d.size || 1) > 1 || d.role === 'siege') continue; if (!def || d.hp < def.hp) def = d; }
      if (def) {
        const men = [];
        for (let i = 0; i < 4; i++) { const u = spawnUnit(b, def, r.side, -1, -1); u.x = u.px = L.x; u.y = u.py = L.y; u.aboard = RIDE + L.id; u.crewOf = L.id; men.push(u); L.crew.push(u.id); }
        addSquad(b, men, 'hold');
      } else L.crewless = true;
    }
    L.hp = L.maxHp = L.cars * (L.beasts ? BEAST_HP : CAR_HP);
  }
  for (const side of [0, 1]) {
    const list = plan.masts.filter((m) => m.side === side).map((m) => ({ x: m.x + (m.type === 'balloonMast' ? 1 : 1.5), y: m.y + (m.type === 'balloonMast' ? 1 : 1.5), st: structAt(m.type, m.x, m.y), point: pointOf(m.pi) }))
      .filter((s) => s.st >= 0 && s.point >= 0);
    if (list.length < 2) continue;
    list.sort((a, c) => (c.point === b.fronts.hq[side]) - (a.point === b.fronts.hq[side]));
    const stops = chain(list);
    const L = makeLine(b, 'balloon', side, stops, strung(stops, STEP.balloon));
    L.cargo = BASKET_LOAD;
    b.transit.air[side] = L;
  }
  if (!b.transit.lines.length) b.transit = null;
}

/** the next stop ahead of the vehicle in the way it is going, or null at the end of the line */
function ahead(L, dir) {
  const here = L.at.get(L.k), i = here !== undefined ? here + dir : null;
  if (i !== null) return L.stops[i] || null;
  for (let k = L.k + dir; k >= 0 && k < L.path.length; k += dir) if (L.at.has(k)) return L.stops[L.at.get(k)];
  return null;
}

function setDown(b, L, u) {
  const spot = freeTileNear(b, Math.max(1, Math.min(b.W - 2, Math.round(L.x))), Math.max(1, Math.min(b.H - 2, Math.round(L.y))), u.def.size || 1, u.side);
  if (!spot) return false;
  u.x = spot[0]; u.y = spot[1]; u.px = spot[0]; u.py = spot[1]; u.aboard = -1; u.ride = null; u.noRide = b.tick + 160;
  occupy(b, u, 1);
  return true;
}

function call(b, L, si) {
  const s = L.stops[si], p = s.point >= 0 ? b.cmd.points[s.point] : null;
  L.calls++;
  let n = 0, men = 0;
  if (L.kind === 'rail') {
    if (s.depot) L.cargo = TRAIN_LOAD;
    else if (p && p.side === L.side && L.cargo > 0 && p.stock < 7) { n = Math.min(2, L.cargo, 7 - p.stock); p.stock += n; L.cargo -= n; }
  } else if (L.kind === 'cable') {
    if (si === 0) L.cargo = CAR_LOAD;
    else if (L.cargo > 0) { const st = b.structures[s.st]; if (addCrate(b, L.side, st.x - 1, st.y + st.h, 1)) { L.cargo--; n = 1; } }
  } else {
    if (si === 0) L.cargo = BASKET_LOAD;
    else if (p && p.side === L.side && L.cargo > 0 && p.stock < 5) { p.stock++; L.cargo--; n = 1; }
    // the men for this point get out; those waiting here get in
    const stay = [];
    for (const id of L.riders) { const u = b.units[id]; if (!u.alive) continue; const here = !u.ride || u.ride.to === si || !open(b, L, L.stops[u.ride.to]); if (here && setDown(b, L, u)) men++; else stay.push(id); }
    L.riders = stay;
    for (const u of b.units) {
      if (L.riders.length >= BASKET_MEN) break;
      if (!u.alive || !u.ride || u.ride.line !== L.id || u.ride.from !== si || u.aboard >= 0 || u.x < 0 || Math.max(Math.abs(u.x - s.x), Math.abs(u.y - s.y)) > 3) continue;
      occupy(b, u, 0); u.aboard = RIDE + L.id; L.riders.push(u.id); L.lifted++; men++;
    }
  }
  if (n && p) b.events.push({ type: 'supplyIn', point: p.id, stock: p.stock, by: -1 });
  L.delivered += n;
  b.events.push({ type: 'transit', line: L.id, kind: L.kind, side: L.side, stop: si, stores: n, men, point: s.point });
}

/** a blow to a train or a caravan: its frame, or the beasts that carry it */
export function hitLine(b, L, dmg, by) {
  if (!L.live || L.hp === undefined || dmg <= 0) return;
  L.hp -= dmg;
  b.events.push({ type: 'transitHit', line: L.id, side: L.side, hp: Math.max(0, L.hp), dmg });
  if (L.hp > 0) return;
  L.live = false;
  // the hands jump clear and fight on foot; what it carried lies where it stopped, for whoever gets to it
  for (const id of L.crew) { const u = b.units[id]; if (u.alive && u.aboard >= 0 && !setDown(b, L, u)) { u.aboard = -1; } u.crewOf = undefined; }
  L.crew = [];
  if (L.cargo > 0) addCrate(b, by ? by.side : 1 - L.side, L.x, L.y, Math.min(3, L.cargo));
  L.cargo = 0;
  b.events.push({ type: 'transitDown', line: L.id, kind: L.kind, side: L.side, beasts: !!L.beasts, by: by ? by.id : -1 });
}

/** the train's own troubles: its crew ride with it, and anyone hostile within reach has a go at it */
function railWar(b, L) {
  const X = Math.max(0, Math.min(b.W - 1, Math.round(L.x))), Y = Math.max(0, Math.min(b.H - 1, Math.round(L.y)));
  for (const id of L.crew) { const u = b.units[id]; if (u.alive) { u.x = u.px = X; u.y = u.py = Y; } }
  const hands = L.crew.filter((id) => b.units[id].alive);
  // with the army gone the hands give themselves up
  if (hands.length && b.tick % 20 === 0 && !b.units.some((u) => u.alive && u.side === L.side && u.crewOf === undefined)) {
    for (const id of hands) damage(b, b.units[id], b.units[id].hp, null, 'melee');
    return 0;
  }
  near(b, X, Y, 10, (u) => {
    if (!L.live || !u.alive || u.side === L.side || u.aboard >= 0 || u.x < 0 || u.cd > 0 || u.down || u.flag) return;
    const d = Math.hypot(u.x - L.x, u.y - L.y), melee = u.def.style === 'melee', reach = melee ? 2.3 : Math.min(u.def.range || 1, 9);
    if (d > reach) return;
    if (!melee && nearestEnemyDist(b, u, Math.ceil(reach)).d <= reach && !hands.length) return; // soldiers to shoot at come first
    const man = hands.map((id) => b.units[id]).find((m) => m.alive);
    if (man) { if (melee) attack(b, u, man); return; } // shooters pick the crew off by their own lights
    hitLine(b, L, b.rng.int(1, Math.max(4, u.def.max || 8)), u);
    u.cd = u.def.speed; u.lastAttack = b.tick;
  });
  return hands.length;
}

/** once a tick: every vehicle moves on, or stands at its stop */
export function transitTick(b) {
  const T = b.transit;
  if (!T) return;
  for (const L of T.lines) {
    L.px = L.x; L.py = L.y;
    if (!L.live) continue;
    if (L.riders.length) L.riders = L.riders.filter((id) => b.units[id].alive);
    // a cable car falls with the tower it hangs from
    if (L.kind !== 'rail' && L.stops.filter((s) => !b.structures[s.st].destroyed).length < 2) {
      L.live = false;
      for (const id of L.riders) { const u = b.units[id]; if (!setDown(b, L, u)) { u.aboard = -1; u.ride = null; } }
      L.riders = [];
      b.events.push({ type: 'transitDown', line: L.id, kind: L.kind, side: L.side });
      continue;
    }
    // a handcar goes nowhere without hands at the pump
    if (L.kind === 'rail' && L.hp !== undefined) { const hands = railWar(b, L); if (!L.live) continue; if (!L.beasts && !L.crewless && !hands) continue; }
    if (L.wait > 0) { L.wait--; }
    else {
      // which way: on as it was going unless the line is shut that way
      const shut = (dir) => { const s = ahead(L, dir); return !s || (L.kind !== 'balloon' && !open(b, L, s)); };
      if (shut(L.dir)) { if (shut(-L.dir)) { L.wait = 10; continue; } L.dir = -L.dir; }
      L.k += L.dir;
      L.x = L.path[L.k][0]; L.y = L.path[L.k][1];
      const si = L.at.get(L.k);
      // a balloon does not come down at a mast that has fallen or changed hands
      if (si !== undefined && (L.kind !== 'balloon' || open(b, L, L.stops[si]))) { L.wait = STOP[L.kind]; call(b, L, si); }
    }
    for (const id of L.riders) { const u = b.units[id]; u.x = u.px = Math.max(0, Math.min(b.W - 1, Math.round(L.x))); u.y = u.py = Math.max(0, Math.min(b.H - 1, Math.round(L.y))); }
  }
}

/** a soldier posted to a point a long way off takes the balloon when there is a mast at hand; true when that used his turn */
export function transitDuty(b, u) {
  const L = b.transit && b.transit.air[u.side];
  if (!L || !L.live || u.x < 0 || u.aboard >= 0 || u.def.fly) return false;
  if (u.ride) {
    const s = L.stops[u.ride.from];
    if (b.tick > u.ride.until || !open(b, L, s) || !open(b, L, L.stops[u.ride.to]) || nearestEnemyDist(b, u, 8).d <= 8) { u.ride = null; u.noRide = b.tick + 200; return false; }
    const sx = Math.round(s.x), sy = Math.round(s.y);
    if (Math.max(Math.abs(u.x - sx), Math.abs(u.y - sy)) <= 2) return true; // waiting at the mast
    const f = field(b, `mast${L.id}:${u.ride.from}`, 300, () => { const p = freeTileNear(b, sx, sy, 1, u.side); return p ? [p[1] * b.W + p[0]] : []; });
    if (f) { walk(b, u, f, 1, 1); return true; }
    u.ride = null; u.noRide = b.tick + 200;
    return false;
  }
  if ((b.tick + u.id) % 8 || u.noRide > b.tick || (u.def.size || 1) > 2 || u.def.leader || u.bearing || u.carry || u.down || u.flag) return false;
  const sq = b.squads[u.squad], fr = sq && sq.front;
  if (!fr || fr.point < 0 || sq.state === 'fallback' || sq.state === 'regroup') return false;
  const to = L.stops.findIndex((s) => s.point === fr.point);
  if (to < 0 || !open(b, L, L.stops[to])) return false;
  const P = b.cmd.points[fr.point];
  if (Math.hypot(P.x - u.x, P.y - u.y) < FAR) return false;
  let from = -1, bd = MAST_R;
  L.stops.forEach((s, i) => { if (i === to || !open(b, L, s)) return; const d = Math.hypot(s.x - u.x, s.y - u.y); if (d < bd) { bd = d; from = i; } });
  if (from < 0 || nearestEnemyDist(b, u, 9).d <= 9) return false;
  let queue = L.riders.length;
  for (const v of b.units) if (v.alive && v.ride && v.ride.line === L.id) queue++;
  if (queue >= BASKET_MEN) return false;
  u.ride = { line: L.id, from, to, until: b.tick + 140 };
  return true;
}
