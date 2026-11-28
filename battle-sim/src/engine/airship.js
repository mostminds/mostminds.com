// War zeppelins in land and amphibious battles: flight, broadsides, bombs, hangar launches,
// drop pods, ladder rescues, airship duels with boarding, crews and hijacking.
import { AIRSHIPS } from '../data/airships.js';
import { isWater } from './terrain.js';
import { STRUCTURES } from '../data/structures.js';
import { addCrate } from './command.js';
import { hitChance, defenceRoll } from './combat.js';
import { behemothTick, skyFxTick, skyZonesTick, airHitMul, skyBlind } from './behemoth.js';
import { near, queueHit, damageStructure, hitStructuresAt, unitHeight, spawnUnit, addSquad, freeTileNear, occupy, canStandAir, damage, stepAir } from './battle.js';

const NOBODY = { id: -1 };
const ucx = (u) => u.x + u.def.size / 2;
const ucy = (u) => u.y + u.def.size / 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const LIFTED = 1000; // u.aboard >= LIFTED means "carried by airship (aboard - LIFTED)"

export function initAirships(b, scn) {
  b.airships = [];
  b.airQueue = [];
  scn.sides.forEach((side, si) => {
    const list = [];
    for (const g of side.airships || []) {
      const def = AIRSHIPS[g.unit];
      if (def) for (let k = 0; k < Math.min(6, g.count); k++) list.push(def);
    }
    list.forEach((def, k) => {
      const y = b.H * (list.length === 1 ? 0.5 : 0.2 + (0.6 * k) / (list.length - 1));
      const x = si === 0 ? 4 : b.W - 5;
      b.airships.push({
        id: b.airships.length, side: si, def, x, y, px: x, py: y, heading: si === 0 ? 0 : Math.PI, ph: si === 0 ? 0 : Math.PI,
        hp: def.hull, maxHp: def.hull, alive: true, crew: def.crew, radius: def.len / 2,
        cd: b.rng.int(0, 5), bombCd: 6, hangarCd: 10 + b.rng.int(0, 8), craftLeft: def.hangar.count,
        podsLeft: def.pods.pods, podCd: 20, ladderCd: 30, cargo: [], mode: 'hunt', run: false,
        pick: null, drop: null, grapple: -1, ladder: 0, lastFire: -99, orbit: b.rng.chance(0.5) ? 1 : -1,
      });
    });
  });
}

export function airAlive(b, side) {
  let n = 0;
  if (b.airships) for (const a of b.airships) if (a.alive && a.side === side && (a.crew > 0 || a.wild)) n++;
  return n;
}

export function airTick(b) {
  if (!b.airships || !b.airships.length) return;
  for (const a of b.airships) { a.px = a.x; a.py = a.y; a.ph = a.heading; }
  skyFxTick(b); // behemoths' wards, flares, veils and auras (src/engine/behemoth.js)
  for (const a of b.airships) if (a.alive) shipTick(b, a);
  skyZonesTick(b);
  // pods in the air come down
  const keep = [];
  for (const q of b.airQueue) {
    if (q.tick > b.tick) { keep.push(q); continue; }
    if (q.bomb) { hitStructuresAt(b, q.x, q.y, q.r, q.dmg); continue; } // the troops under it were hit when it was dropped
    const def = b.getDef(q.unit);
    const fresh = [];
    if (def) for (let k = 0; k < q.n; k++) {
      const spot = freeTileNear(b, q.x, q.y, def.size, q.side);
      if (spot) fresh.push(spawnUnit(b, def, q.side, spot[0], spot[1]));
    }
    addSquad(b, fresh);
    b.events.push({ type: 'podLand', x: q.x, y: q.y, side: q.side, n: fresh.length });
    // the pod hits like a boulder
    near(b, q.x, q.y, 2, (v) => { if (v.alive && v.side !== q.side && v.aboard < 0 && unitHeight(b, v) < 4 && Math.hypot(v.x - q.x, v.y - q.y) <= 1.5) queueHit(b, NOBODY, v, b.rng.int(4, 14), 0, 'ranged', true, { x: q.x, y: q.y, blast: true }); });
  }
  b.airQueue = keep;
}

// ---------- crews, boarding and capture ----------
function capture(b, a, side, crew) {
  // whoever was being carried belongs to the losing side
  for (const id of a.cargo) { const u = b.units[id]; if (u.alive) { u.alive = false; u.hp = 0; b.events.push({ type: 'death', id, by: -1 }); } }
  a.cargo = [];
  a.side = side; a.crew = Math.max(1, crew); a.mode = 'hunt'; a.grapple = -1; a.run = false; a.pick = a.drop = null;
  b.events.push({ type: 'airCaptured', air: a.id, side });
}
export function crewLoss(b, a, n, bySide, prize = 3) {
  if (n <= 0 || !a.alive) return;
  a.crew = Math.max(0, a.crew - n);
  if (a.crew === 0 && a.def.arts?.wild) { if (!a.wild) { a.wild = true; b.events.push({ type: 'airWild', air: a.id }); } return; } // a beast whose riders fall fights on by itself
  if (a.crew === 0) {
    if (bySide !== undefined && bySide !== a.side) capture(b, a, bySide, prize);
    else b.events.push({ type: 'airAdrift', air: a.id });
  }
}

// ---------- flying ----------
function steer(b, a, tx, ty, speedMul = 1) {
  const want = Math.atan2(ty - a.y, tx - a.x);
  const turn = (a.def.turn * Math.PI) / 180;
  const diff = Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading));
  a.heading += clamp(diff, -turn, turn);
  const v = a.def.speed * speedMul * (a.hp < a.maxHp * 0.33 ? 0.6 : 1) * (Math.abs(diff) > 1.2 ? 0.5 : 1);
  let nx = a.x + Math.cos(a.heading) * v, ny = a.y + Math.sin(a.heading) * v;
  // keep clear of other airships unless grappling
  for (const o of b.airships) {
    if (o === a || !o.alive) continue;
    const d = Math.hypot(o.x - nx, o.y - ny), min = (o.radius + a.radius) * 0.55;
    if (d < min && d > 0.01) { nx += ((nx - o.x) / d) * (min - d) * 0.5; ny += ((ny - o.y) / d) * (min - d) * 0.5; }
  }
  a.x = clamp(nx, 1, b.W - 2); a.y = clamp(ny, 1, b.H - 2);
}

function groundTarget(b, a) {
  let best = null, bs = Infinity;
  for (const sq of b.squads) {
    if (sq.side === a.side || sq.alive <= 0) continue;
    const lead = sq.members.map((id) => b.units[id]).find((u) => u.alive && u.aboard < 0);
    if (!lead) continue;
    const d = Math.hypot(lead.x - a.x, lead.y - a.y) - sq.alive * 0.8;
    if (d < bs) { bs = d; best = { x: lead.x, y: lead.y }; }
  }
  if (best) return best;
  for (const g of b.guns) if (!g.destroyed && g.owner !== null && g.owner !== a.side) return { x: g.cx, y: g.cy };
  for (const s of b.ships) if (s.alive && s.side !== a.side) return { x: s.x, y: s.y };
  for (const c of b.crafts) if (!c.sunk && c.side !== a.side && (c.passengers.length || c.crew > 0)) return { x: c.x, y: c.y };
  return null;
}

function shipTick(b, a) {
  for (const k of ['cd', 'bombCd', 'hangarCd', 'podCd', 'ladderCd']) if (a[k] > 0) a[k]--;
  if (a.ladder > 0) a.ladder--;
  const carry = () => { for (const id of a.cargo) { const u = b.units[id]; u.x = u.px = clamp(Math.round(a.x), 0, b.W - 1); u.y = u.py = clamp(Math.round(a.y), 0, b.H - 1); } };
  skyArts(b, a);
  if (!a.alive) return;
  if (a.def.behemoth) behemothTick(b, a); // its eight abilities
  if (a.crew <= 0 && !a.wild) { // nobody at the helm: she drifts on the wind
    a.heading += 0.01; a.x = clamp(a.x + Math.cos(a.heading) * 0.05, 1, b.W - 2); a.y = clamp(a.y + Math.sin(a.heading) * 0.05, 1, b.H - 2);
    carry(); return;
  }

  // a friendly mooring tower patches the hull and tops up the crew; a badly hurt ship runs for one
  let tower = null, td = Infinity;
  for (const st of b.structures) {
    if (st.destroyed || !STRUCTURES[st.type].mooring || (st.side !== undefined && st.side !== null && st.side !== a.side)) continue;
    const d = Math.hypot(st.x + 1.5 - a.x, st.y + 1.5 - a.y);
    if (d < td) { td = d; tower = st; }
  }
  if (tower && td < 5) {
    a.hp = Math.min(a.maxHp, a.hp + 6);
    if (b.tick % 40 === 0 && a.supplies < 4) a.supplies++; // stores are loaded at the mast
    if (b.tick % 12 === 0 && a.crew < a.def.crew) a.crew++;
  }
  if (a.mode === 'refit' && (!tower || a.hp > a.maxHp * 0.85)) a.mode = 'hunt';
  if (tower && a.mode === 'hunt' && !a.cargo.length && a.hp < a.maxHp * 0.4) { a.mode = 'refit'; b.events.push({ type: 'airRefit', air: a.id }); }
  if (a.mode === 'refit') {
    if (td > 2.5) steer(b, a, tower.x + 1.5, tower.y + 1.5 - 2.2);
    if (a.cd <= 0) fireAtGround(b, a, a.def.cannons);
    carry(); return;
  }

  // enemy airships come first: close, trade broadsides, grapple and board
  let foe = null, fd = Infinity;
  for (const o of b.airships) { if (!o.alive || o.side === a.side) continue; const d = Math.hypot(o.x - a.x, o.y - a.y); if (d < fd) { fd = d; foe = o; } }
  const C = a.def.cannons;
  if (foe && fd < 36 && !a.cargo.length) {
    const reach = (a.radius + foe.radius) * 0.6 + 0.6;
    if (fd > reach) { a.grapple = -1; steer(b, a, foe.x, foe.y); } else {
      if (a.grapple !== foe.id) { a.grapple = foe.id; b.events.push({ type: 'airGrapple', air: a.id, other: foe.id }); }
      // lie alongside
      const diff = Math.atan2(Math.sin(foe.heading - a.heading), Math.cos(foe.heading - a.heading));
      a.heading += clamp(diff, -0.15, 0.15);
      if (foe.crew <= 0 && !foe.wild) capture(b, foe, a.side, Math.max(2, Math.floor(a.crew / 3)));
      else if (b.tick % 2 === 0) {
        const kill = b.rng.next() < 0.5 + 0.03 * a.crew * a.def.marines ? 1 + (b.rng.chance(0.25 * a.def.marines) ? 1 : 0) : 0;
        if (kill) {
          b.events.push({ type: 'airBoard', air: a.id, other: foe.id, lost: kill });
          const prize = Math.max(2, Math.floor(a.crew / 3));
          const before = foe.side;
          crewLoss(b, foe, kill, a.side, prize);
          if (foe.side !== before) a.crew = Math.max(1, a.crew - prize);
        }
      }
    }
    if (a.cd <= 0 && fd <= C.range && foe.side !== a.side) {
      a.cd = C.reload; a.lastFire = b.tick;
      const delay = 1 + Math.floor(fd / 8);
      b.events.push({ type: 'airFire', air: a.id, x1: foe.x, y1: foe.y, h1: foe.def.altitude, delay, guns: C.perSide });
      let dmg = 0, hits = 0;
      for (let i = 0; i < C.perSide; i++) if (b.rng.next() < C.acc * (1 - 0.35 * (fd / C.range)) * 1.2 * (1 - (foe.def.arts?.fog || 0))) { dmg += Math.round(b.rng.int(C.dmg[0], C.dmg[1]) * (100 / (100 + foe.def.armour))); hits++; }
      b.pending.push({ tick: b.tick + delay, air: foe.id, dmg, hit: hits > 0, by: a.side });
    }
    carry(); return;
  }
  a.grapple = -1;

  // ferrying rescued troops to safety
  if (a.mode === 'ferry') {
    const d = Math.hypot(a.drop.x - a.x, a.drop.y - a.y);
    if (d > 1.2) steer(b, a, a.drop.x, a.drop.y);
    else {
      const still = [];
      for (const id of a.cargo) {
        const u = b.units[id];
        if (!u.alive) continue;
        const spot = freeTileNear(b, Math.round(a.x), Math.round(a.y), u.def.size, u.side);
        if (!spot) { still.push(id); continue; }
        u.x = spot[0]; u.y = spot[1]; u.px = Math.round(a.x); u.py = Math.round(a.y); u.aboard = -1; occupy(b, u, 1);
      }
      b.events.push({ type: 'airUnload', air: a.id, n: a.cargo.length - still.length });
      a.cargo = still; a.ladder = 6;
      if (!still.length) { a.mode = 'hunt'; a.ladderCd = a.def.ladders.every; } else a.drop = { x: clamp(a.drop.x + (a.side === 0 ? -3 : 3), 2, b.W - 3), y: a.drop.y };
    }
    carry(); return;
  }
  if (a.mode === 'rescue') {
    const d = Math.hypot(a.pick.x - a.x, a.pick.y - a.y);
    if (d > 1.2) { steer(b, a, a.pick.x, a.pick.y, 1.2); carry(); return; }
    const got = [];
    near(b, a.pick.x, a.pick.y, 4, (u) => {
      if (!u.alive || u.side !== a.side || u.aboard >= 0 || u.def.fly || u.def.size > 1 || Math.hypot(u.x - a.pick.x, u.y - a.pick.y) > 3) return;
      got.push(u);
    });
    got.sort((p, q) => p.hp / p.def.hp - q.hp / q.def.hp);
    for (const u of got.slice(0, a.def.ladders.capacity)) { occupy(b, u, 0); u.aboard = LIFTED + a.id; a.cargo.push(u.id); }
    a.ladder = 6;
    if (a.cargo.length) {
      b.events.push({ type: 'airLift', air: a.id, n: a.cargo.length });
      // set them down well behind their own lines, on dry land
      const back = a.side === 0 ? -1 : 1;
      let dx = clamp(a.pick.x + back * 16, 3, b.W - 4);
      const dy = clamp(a.pick.y, 3, b.H - 4);
      for (let k = 0; k < 20 && isWater(b.terrain[Math.round(dy) * b.W + Math.round(dx)]); k++) dx = clamp(dx - back * 2, 3, b.W - 4);
      a.drop = { x: dx, y: dy }; a.mode = 'ferry';
    } else { a.mode = 'hunt'; a.ladderCd = 20; }
    carry(); return;
  }
  // look for troops worth lifting out
  if (a.ladderCd <= 0 && (b.tick + a.id * 3) % 8 === 0) {
    let best = null, bs = 1;
    for (const u of b.units) {
      if (!u.alive || u.side !== a.side || u.aboard >= 0 || u.def.fly || u.def.size > 1 || u.hp > u.def.hp * 0.45) continue;
      if (Math.hypot(u.x - a.x, u.y - a.y) > 30) continue;
      let foes = 0, hurt = 0;
      near(b, u.x, u.y, 4, (v) => { if (!v.alive || v.aboard >= 0) return; const d = Math.max(Math.abs(v.x - u.x), Math.abs(v.y - u.y)); if (v.side !== u.side && d <= 2) foes++; else if (v.side === u.side && d <= 3 && v.hp < v.def.hp * 0.6) hurt++; });
      if (foes && hurt + foes * 0.2 > bs) { bs = hurt + foes * 0.2; best = u; }
    }
    if (best) { a.mode = 'rescue'; a.pick = { x: best.x, y: best.y }; b.events.push({ type: 'airRescue', air: a.id, x: best.x, y: best.y }); carry(); return; }
    a.ladderCd = 12;
  }

  // a supply run: fly to the held point shortest of stores, lower the crates, and go back to the fight
  if (a.mode === 'hunt' && a.supplies > 0 && b.cmd && b.tick >= (a.nextSupply || 60) && (b.tick + a.id) % 10 === 0) {
    let best = null, bs = Infinity;
    for (const p of b.cmd.points) { if (p.side !== a.side || p.stock >= 3) continue; const sc = Math.hypot(p.x - a.x, p.y - a.y) + p.stock * 12; if (sc < bs) { bs = sc; best = p; } }
    if (best) { a.mode = 'supply'; a.dest = best.id; b.events.push({ type: 'airSupplyRun', air: a.id }); } else a.nextSupply = b.tick + 60;
  }
  if (a.mode === 'supply') {
    const p = b.cmd.points[a.dest];
    if (!p || a.supplies <= 0) a.mode = 'hunt';
    else {
      const d = Math.hypot(p.x - a.x, p.y - a.y);
      if (d > 1.5) steer(b, a, p.x, p.y, 1.1);
      else {
        const n = Math.min(2, a.supplies);
        if (addCrate(b, a.side, p.x + 1, p.y + 1, n)) { a.supplies -= n; b.events.push({ type: 'airSupply', air: a.id, x: p.x + 1, y: p.y + 1 }); }
        a.ladder = 5; a.mode = 'hunt'; a.nextSupply = b.tick + 150;
      }
      if (a.cd <= 0) fireAtGround(b, a, C);
      carry(); return;
    }
  }

  // hunting: stand off and pound them, with bombing runs when the bay is loaded
  if (!a.goal || b.tick % 5 === 0) a.goal = groundTarget(b, a);
  const g = a.goal;
  if (!g) return;
  const d = Math.hypot(g.x - a.x, g.y - a.y);
  if (a.bombCd <= 0 && !a.run && d < 22) a.run = true;
  if (a.run) steer(b, a, g.x, g.y, 1.15);
  else if (d > C.range * 0.7) steer(b, a, g.x, g.y);
  else { const ang = Math.atan2(a.y - g.y, a.x - g.x) + a.orbit * 0.5; steer(b, a, g.x + Math.cos(ang) * C.range * 0.6, g.y + Math.sin(ang) * C.range * 0.6, 0.7); }

  // bombs
  if (a.bombCd <= 0) {
    const B = a.def.bombs;
    let n = 0, sx = 0, sy = 0;
    near(b, a.x, a.y, B.radius + 2, (v) => { if (v.alive && v.side !== a.side && v.aboard < 0 && unitHeight(b, v) < 4 && Math.hypot(ucx(v) - a.x, ucy(v) - a.y) <= B.radius + 0.8) { n++; sx += ucx(v); sy += ucy(v); } });
    let overStruct = false;
    const si = b.sid[Math.round(a.y) * b.W + Math.round(a.x)] - 1;
    if (si >= 0) { const st = b.structures[si]; overStruct = !st.destroyed && st.hp > 0 && st.side !== undefined && st.side !== null && st.side !== a.side; }
    if (n || overStruct) {
      const bx = n ? sx / n : a.x, by = n ? sy / n : a.y, delay = 3;
      a.bombCd = B.reload; a.run = false;
      b.events.push({ type: 'bomb', air: a.id, x: bx, y: by, delay, radius: B.radius });
      near(b, bx, by, B.radius + 2, (v) => {
        if (!v.alive || v.side === a.side || v.aboard >= 0 || unitHeight(b, v) === 4) return;
        const dd = Math.hypot(ucx(v) - bx, ucy(v) - by);
        if (dd > B.radius + 0.5) return;
        queueHit(b, NOBODY, v, Math.round(b.rng.int(Math.floor(B.maxHit / 4), B.maxHit) * (1 - 0.5 * (dd / (B.radius + 0.5)))), delay, 'ranged', true, { x: bx, y: by, blast: true });
      });
      b.airQueue.push({ tick: b.tick + delay, bomb: true, x: bx, y: by, r: B.radius, dmg: B.maxHit * 3, side: a.side, unit: null, n: 0 });
      skyBombExtras(b, a, bx, by, delay);
    } else if (a.run && d < 0.8) a.run = false;
  }

  // broadside at whatever is in reach
  if (a.cd <= 0) fireAtGround(b, a, C);

  // the hangar
  if (a.craftLeft > 0 && a.hangarCd <= 0 && d < 34) {
    const def = b.getDef(a.def.hangar.unit);
    const fresh = [];
    if (def) for (let k = 0; k < 2 && a.craftLeft > 0; k++) {
      const bx = Math.round(a.x - Math.cos(a.heading) * (a.radius * 0.6 + k)), by = Math.round(a.y - Math.sin(a.heading) * (a.radius * 0.6 + k));
      let spot = null;
      for (let r = 0; r < 4 && !spot; r++) for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) if (canStandAir(b, bx + dx, by + dy, def.size, -1)) spot = [bx + dx, by + dy];
      if (!spot) break;
      const u = spawnUnit(b, def, a.side, spot[0], spot[1]);
      u.px = Math.round(a.x); u.py = Math.round(a.y); u.launchedAt = b.tick;
      fresh.push(u); a.craftLeft--;
    }
    if (fresh.length) { addSquad(b, fresh); b.events.push({ type: 'airLaunch', air: a.id, ids: fresh.map((u) => u.id) }); }
    a.hangarCd = a.def.hangar.every;
  }

  // drop pods
  if (a.podsLeft > 0 && a.podCd <= 0 && d < 7) {
    const P = a.def.pods;
    const ang = b.rng.next() * Math.PI * 2;
    let px = clamp(Math.round(g.x + Math.cos(ang) * 3), 1, b.W - 2), py = clamp(Math.round(g.y + Math.sin(ang) * 3), 1, b.H - 2);
    if (isWater(b.terrain[py * b.W + px])) { px = Math.round(g.x); py = Math.round(g.y); }
    if (!isWater(b.terrain[py * b.W + px])) {
      a.podsLeft--; a.podCd = 16;
      b.airQueue.push({ tick: b.tick + 4, side: a.side, unit: P.unit, n: P.perPod, x: px, y: py });
      b.events.push({ type: 'podDrop', air: a.id, x: px, y: py, delay: 4 });
    } else a.podCd = 6;
  }
  carry();
}

function fireAtGround(b, a, C) {
  let best = null, bs = Infinity, kind = null;
  near(b, a.x, a.y, C.range + 1, (u) => {
    if (!u.alive || u.side === a.side || u.aboard >= 0) return;
    const d = Math.hypot(ucx(u) - a.x, ucy(u) - a.y);
    if (d > C.range) return;
    const sc = d - (unitHeight(b, u) === 4 ? 3 : 0) - u.def.size * 2;
    if (sc < bs) { bs = sc; best = u; kind = 'unit'; }
  });
  for (const g of b.guns) {
    if (g.destroyed || g.owner === null || g.owner === a.side) continue;
    const d = Math.hypot(g.cx - a.x, g.cy - a.y);
    if (d <= C.range && d - 6 < bs) { bs = d - 6; best = g; kind = 'gun'; }
  }
  for (const s of b.ships) {
    if (!s.alive || s.side === a.side) continue;
    const d = Math.hypot(s.x - a.x, s.y - a.y);
    if (d <= C.range && d - 4 < bs) { bs = d - 4; best = s; kind = 'ship'; }
  }
  for (const c of b.crafts) {
    if (c.sunk || c.side === a.side || (c.landed && !(c.crew > 0))) continue;
    const d = Math.hypot(c.x - a.x, c.y - a.y);
    if (d <= C.range && d - 2 < bs) { bs = d - 2; best = c; kind = 'craft'; }
  }
  if (!best) {
    b.structures.forEach((st, idx) => {
      if (st.destroyed || !st.hp || st.side === undefined || st.side === null || st.side === a.side) return;
      const d = Math.hypot(st.x + st.w / 2 - a.x, st.y + st.h / 2 - a.y);
      if (d <= C.range && d < bs) { bs = d; best = { idx, x: st.x + st.w / 2, y: st.y + st.h / 2 }; kind = 'struct'; }
    });
  }
  if (!best) return;
  const tx = kind === 'unit' ? ucx(best) : kind === 'gun' ? best.cx : best.x, ty = kind === 'unit' ? ucy(best) : kind === 'gun' ? best.cy : best.y;
  const d = Math.hypot(tx - a.x, ty - a.y), delay = 1 + Math.floor(d / 7);
  a.cd = C.reload; a.lastFire = b.tick;
  b.events.push({ type: 'airFire', air: a.id, x1: tx, y1: ty, h1: kind === 'unit' && unitHeight(b, best) === 4 ? 2.6 : 0.3, delay, guns: C.perSide, breath: a.def.arts?.breath });
  const acc = (k) => C.acc * (1 - 0.35 * (d / C.range)) * k;
  let stray = 0;
  for (let i = 0; i < C.perSide; i++) {
    const roll = b.rng.int(C.dmg[0], C.dmg[1]);
    if (kind === 'unit') {
      const hit = b.rng.next() < acc(0.45) && b.rng.next() < hitChance((60 + 9) * (60 + 64), defenceRoll(best.def, 'ranged')) + 0.25;
      queueHit(b, NOBODY, best, hit ? roll : 0, delay, 'ranged', hit, { x: a.x, y: a.y });
      if (!hit) stray += Math.round(roll * 0.6);
      const spread = a.def.arts?.breath ? 0.5 : 0.15; // breath washes over the ranks round the mark
      near(b, best.x, best.y, 3, (v) => { if (v !== best && v.alive && v.side !== a.side && v.aboard < 0 && Math.max(Math.abs(v.x - best.x), Math.abs(v.y - best.y)) <= 1 && b.rng.chance(spread)) queueHit(b, NOBODY, v, Math.floor(roll * 0.5), delay, 'ranged', true); });
    } else if (kind === 'gun') { const hit = b.rng.next() < acc(1.1); b.pending.push({ tick: b.tick + delay, gun: best.id, dmg: hit ? roll : 0, hit }); }
    else if (kind === 'ship') { const hit = b.rng.next() < acc(1.1); b.pending.push({ tick: b.tick + delay, ship: best.id, dmg: hit ? Math.round(roll * (100 / (100 + best.def.armour))) : 0, hit }); }
    else if (kind === 'craft') { const hit = b.rng.next() < acc(0.9); const dmg = hit ? roll : 0; best.pending += dmg; b.pending.push({ tick: b.tick + delay, from: -1, craft: best.id, dmg, hit, style: 'ranged' }); }
    else if (b.rng.next() < acc(1.2)) stray += roll * 2;
  }
  if (stray) { if (kind === 'struct') damageStructure(b, best.idx, stray, a); else hitStructuresAt(b, tx, ty, 0.8, stray); }
}

// ---------- being shot at ----------
export function resolveAirHit(b, p) {
  const a = b.airships[p.air];
  if (!a || !a.alive) return;
  if (b.skyFx && p.dmg > 0) { const m = airHitMul(b, a, p); if (m < 1) { p.dmg = Math.round(p.dmg * m); if (!p.dmg) p.hit = false; } } // phase, wards
  a.hp -= p.dmg;
  b.events.push({ type: 'airHit', air: a.id, dmg: p.dmg, hit: p.hit });
  // shot and splinters find the crew too
  if (p.dmg > 0 && a.crew > 0 && b.rng.next() < p.dmg / (a.maxHp / a.def.crew) * 0.6) crewLoss(b, a, 1, p.by);
  const vol = a.def.arts?.volatile;
  if (vol && a.hp > 0 && p.dmg > a.maxHp * 0.12 && b.rng.chance(0.15)) a.hp = 0; // the gasbag goes up
  if (a.hp > 0) return;
  if (vol) {
    b.events.push({ type: 'airArt', air: a.id, name: 'volatile', x: a.x, y: a.y });
    near(b, a.x, a.y, 5, (v) => { if (v.alive && v.aboard < 0 && Math.hypot(ucx(v) - a.x, ucy(v) - a.y) <= 4) queueHit(b, NOBODY, v, b.rng.int(Math.floor(vol / 3), vol), 2, 'ranged', true, { x: a.x, y: a.y, blast: true }); });
    for (const o of b.airships) if (o !== a && o.alive && Math.hypot(o.x - a.x, o.y - a.y) < 6) b.pending.push({ tick: b.tick + 1, air: o.id, dmg: Math.round(vol * 0.6), hit: true, by: -1 });
  }
  a.hp = 0; a.alive = false; a.crew = 0;
  b.events.push({ type: 'airDown', air: a.id, x: a.x, y: a.y, side: a.side });
  for (const id of a.cargo) { const u = b.units[id]; if (u.alive) { u.alive = false; u.hp = 0; u.aboard = -1; u.x = clamp(Math.round(a.x), 0, b.W - 1); u.y = clamp(Math.round(a.y), 0, b.H - 1); b.events.push({ type: 'death', id, by: -1 }); } }
  a.cargo = [];
  // the wreck comes down on whoever is underneath
  near(b, a.x, a.y, 4, (v) => { if (v.alive && v.aboard < 0 && unitHeight(b, v) < 4 && Math.hypot(ucx(v) - a.x, ucy(v) - a.y) <= 2.5) queueHit(b, NOBODY, v, b.rng.int(8, 36), 5, 'ranged', true, { x: a.x, y: a.y, blast: true }); });
  hitStructuresAt(b, a.x, a.y, 2.5, 160);
}

// archers, mages and gyrocopters shooting up at an airship
export function unitVsAirship(b, u, range) {
  let best = null, bd = Infinity;
  for (const a of b.airships) {
    if (!a.alive || a.side === u.side) continue;
    const d = Math.hypot(a.x - ucx(u), a.y - ucy(u)) - a.radius * 0.5;
    if (d <= range + 1 && d < bd) { bd = d; best = a; }
  }
  if (!best) return false;
  const ar = best.def.arts || {};
  // fog round it, flares in the fliers' eyes
  let blind = ar.fog || 0;
  if (u.def.fly) for (const o of b.airships) if (o.alive && o.side === best.side && o.def.arts?.flares && Math.hypot(o.x - ucx(u), o.y - ucy(u)) < 10) { blind = Math.max(blind, o.def.arts.flares); break; }
  if (b.skyFx) { const sb = skyBlind(b, u.side, ucx(u), ucy(u), best); if (sb > blind) { blind = sb; if ((best.flareSaid ?? -99) < b.tick - 10) { best.flareSaid = b.tick; b.events.push({ type: 'behemoth', air: best.id, kind: 'flares', name: 'flares', x: ucx(u), y: ucy(u), dodge: true }); } } }
  const hit = b.rng.next() < hitChance(u.def.aRoll, (30 + 9) * (best.def.armour * 2 + 64)) * (1 - blind);
  const dmg = hit ? Math.round(b.rng.int(0, u.def.max) * (100 / (100 + best.def.armour)) * (1 - (ar.bulwark || 0))) : 0;
  const delay = 1 + Math.floor(Math.max(0, bd) / 6);
  b.pending.push({ tick: b.tick + delay, air: best.id, dmg, hit, from: u.id, by: u.side });
  b.events.push({ type: 'attack', from: u.id, air: best.id, style: u.def.style, delay, proj: u.def.projectile || u.def.style });
  u.cd = u.def.speed; u.lastAttack = b.tick;
  u.face = Math.atan2(best.y - ucy(u), best.x - ucx(u));
  return true;
}

// melee fliers swarm an enemy airship: they cut down the crew and, when none are left, take her
export function flierVsAirship(b, u) {
  if (u.landedUntil > b.tick) return false;
  let best = null, bd = 18;
  for (const a of b.airships) {
    if (!a.alive || a.side === u.side) continue;
    const d = Math.hypot(a.x - ucx(u), a.y - ucy(u));
    if (d < bd) { bd = d; best = a; }
  }
  if (!best) return false;
  if (bd > best.radius * 0.6 + 1) { stepAir(b, u, { x: Math.round(best.x), y: Math.round(best.y) }); return true; }
  if (u.cd > 0) return true;
  u.cd = u.def.speed; u.lastAttack = b.tick;
  u.face = Math.atan2(best.y - ucy(u), best.x - ucx(u));
  b.events.push({ type: 'attack', from: u.id, air: best.id, style: 'melee', delay: 0 });
  if (best.crew <= 0 && !best.wild) { capture(b, best, u.side, 3); return true; }
  // a petrifying gaze: the flier that strikes may fall as stone
  if (best.def.arts?.petrify && b.rng.chance(best.def.arts.petrify)) { damage(b, u, u.hp + 1, null, 'melee'); b.events.push({ type: 'airArt', air: best.id, name: 'petrify', x: u.x, y: u.y }); return true; }
  // a boarder against the deck crew: sometimes a crewman falls, sometimes the boarder is thrown back
  if (b.rng.next() < 0.3 + u.def.max / 80) crewLoss(b, best, 1, u.side, 3);
  if (best.side !== u.side && b.rng.next() < 0.5) damage(b, u, b.rng.int(0, Math.round(8 * best.def.marines)), null, 'melee');
  b.pending.push({ tick: b.tick, air: best.id, dmg: Math.round(b.rng.int(0, u.def.max) * 0.3), hit: true, from: u.id, by: u.side });
  return true;
}

// guns that can elevate (ballistae, harpoons) pick airships as targets; returns one in range or null
export function airTargetFor(b, side, x, y, range) {
  let best = null, bd = Infinity;
  if (b.airships) for (const a of b.airships) {
    if (!a.alive || a.side === side) continue;
    const d = Math.hypot(a.x - x, a.y - y) - a.radius * 0.5;
    if (d <= range && d < bd) { bd = d; best = a; }
  }
  return best;
}

// ---------- sky arts (src/data/fleets/skyschema.js) ----------
function skyArts(b, a) {
  const ar = a.def.arts;
  if (!ar) return;
  if (ar.regen && b.tick % 4 === 0 && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + ar.regen);
  // a shriek that unnerves crews and fliers near it
  if (ar.shriek && b.tick % 8 === (a.id % 8)) {
    let any = false;
    for (const o of b.airships) if (o.alive && o.side !== a.side && Math.hypot(o.x - a.x, o.y - a.y) < 8 && b.rng.chance(ar.shriek)) { crewLoss(b, o, 1, a.side, 2); any = true; }
    near(b, a.x, a.y, 9, (v) => { if (v.alive && v.side !== a.side && v.def.fly && Math.hypot(ucx(v) - a.x, ucy(v) - a.y) < 8 && b.rng.chance(ar.shriek)) { queueHit(b, NOBODY, v, b.rng.int(2, 8), 0, 'ranged', true); any = true; } });
    if (any) b.events.push({ type: 'airArt', air: a.id, name: 'shriek', x: a.x, y: a.y });
  }
}
function skyBombExtras(b, a, bx, by, delay) {
  const ar = a.def.arts;
  if (!ar) return;
  // a rack of rockets or pots: scattered strikes round the mark
  if (ar.rockets) for (let i = 1; i < ar.rockets; i++) {
    const rx = clamp(bx + (b.rng.next() - 0.5) * 6, 1, b.W - 2), ry = clamp(by + (b.rng.next() - 0.5) * 6, 1, b.H - 2);
    b.events.push({ type: 'bomb', air: a.id, x: rx, y: ry, delay: delay + i, radius: 1.2, rocket: true });
    near(b, rx, ry, 3, (v) => { if (v.alive && v.side !== a.side && v.aboard < 0 && unitHeight(b, v) < 4 && Math.hypot(ucx(v) - rx, ucy(v) - ry) <= 1.4) queueHit(b, NOBODY, v, b.rng.int(6, Math.round(a.def.bombs.maxHit * 0.6)), delay + i, 'ranged', true, { x: rx, y: ry, blast: true }); });
  }
  // talons: soldiers plucked up and dropped from on high
  if (ar.snatch) {
    let n = ar.snatch;
    near(b, bx, by, 3, (v) => { if (n > 0 && v.alive && v.side !== a.side && v.aboard < 0 && !v.def.fly && v.def.size === 1 && Math.hypot(ucx(v) - bx, ucy(v) - by) <= 2) { n--; queueHit(b, NOBODY, v, v.hp + 20, delay + 3, 'melee', true); b.events.push({ type: 'airArt', air: a.id, name: 'snatch', x: v.x, y: v.y, unit: v.id }); } });
  }
}
