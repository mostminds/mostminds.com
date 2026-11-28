// Fleet roles: no ship fights alone. Each hull has a part to play and covers another's blind spot.
//
//   line     anti-ship line-breakers and duelists: round shot at mid range, heavy shot close in, chain shot to
//            cripple a fleeing ship's rig, swivel guns on her crew, and a ram on a long straight run in deep water
//   hunter   leviathan hunters: harpoons that tether a beast to the surface, depth charges for what dives, swivel
//            guns at eyes and gills, fire barrels dropped astern; they fall back behind the line when warships come
//   siege    bomb-ketches: long-range mortars over islands and masts, best anchored in calm water and with a flier
//            spotting; slow and broadside-less, they sow fire barrels astern when raiders break through
//   carrier  sky-carriers: launch squadrons of fliers that harry crews, fire rigging and spot for the mortars
//   flak     anti-air ships: rapid guns that shred squadrons and flying beasts; they keep to the fleet's centre
//   troop    troop and supply flagships: patch hulls, send hands across, fill shot lockers and spur the gun crews of
//            ships near them, and lay alongside crippled enemies to board them with fresh marines
//   landing  landing craft: flat-bottomed, held back until the sea is won, then run in on the enemy's forts
//
// The sea itself matters: within a few tiles of an island the water is shallow, and deep-draft hulls slow and
// scrape their bottoms there; near land a big ship's wide turns are cramped; islands stop direct shot but not
// mortar shells; a rough sea throws mortars off.

import { ramMods, ramArc, fireshipIntent, hovers } from './fleetarts.js';
import { UNITS } from '../data/units.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, c) => Math.hypot(a.x - c.x, a.y - c.y) - a.radius - c.radius;
const submerged = (b, e) => !e.fort && b.tick < e.subUntil;
export const SHALLOW = 3.5; // tiles of shoal water round every island (not ice)

/** the role a hull plays, from its definition (sea beasts and diving boats have their own ways) */
export function roleOf(def) {
  if (def.role) return def.role;
  if (def.dive) return 'sub';
  if (def.beast) return def.carries >= 20 ? 'troop' : 'line';
  return 'line';
}
/** draws deep water: a hull that grounds in the shallows */
const deepDraft = (e) => e.ship && !e.def.flat && !hovers(e) && !e.def.beast && e.role !== 'landing' && e.role !== 'hunter' && (e.def.len || 0) >= 6;

export function roleSetup(b, e) {
  if (!e.ship) return;
  const d = e.def;
  e.role = roleOf(d);
  e.heavy = d.heavyShot ?? (e.role === 'line' && d.cannons.perSide >= 4 ? 4 : 0);
  e.shells = d.mortar ? d.mortar.shells ?? 16 : 0;
  e.barrels = d.barrels || 0;
  e.swivelCd = b.rng.int(0, 3); e.harpoonCd = b.rng.int(0, 4); e.depthCd = 0; e.mortarCd = b.rng.int(0, 6); e.flakCd = 0;
  e.launchCd = d.squadrons ? 12 : 0; e.ramCd = 0; e.barrelCd = 0;
}

// ---------- the sea round the islands ----------
export function shoal(b, x, y) {
  for (const isl of b.islands) { if (isl.ice) continue; const d = Math.hypot(x - isl.x, y - isl.y) - isl.r; if (d < SHALLOW) return true; }
  return false;
}
function nearLand(b, x, y, r) {
  for (const isl of b.islands) { if (isl.ice) continue; if (Math.hypot(x - isl.x, y - isl.y) - isl.r < r) return true; }
  return false;
}
/** an island between two points stops direct fire */
export function blocked(b, a, c) {
  const dx = c.x - a.x, dy = c.y - a.y, L2 = dx * dx + dy * dy || 1;
  for (const isl of b.islands) {
    if (isl.ice || isl.r < 2) continue;
    const t = Math.max(0, Math.min(1, ((isl.x - a.x) * dx + (isl.y - a.y) * dy) / L2));
    const px = a.x + dx * t - isl.x, py = a.y + dy * t - isl.y;
    if (px * px + py * py < (isl.r - 0.8) ** 2 && t > 0.05 && t < 0.95) return true;
  }
  return false;
}

// ---------- who stands where ----------
function centroid(list) {
  if (!list.length) return null;
  let x = 0, y = 0;
  for (const o of list) { x += o.x; y += o.y; }
  return { x: x / list.length, y: y / list.length };
}
function fleetState(b, side) {
  if (b.fleetAt === b.tick && b.fleets) return b.fleets[side];
  b.fleetAt = b.tick;
  b.fleets = [0, 1].map((s) => {
    const mine = b.ents.filter((o) => o.alive && o.side === s && o.ship);
    const line = mine.filter((o) => o.role === 'line');
    const warships = mine.filter((o) => o.role === 'line' || o.role === 'troop' || o.role === 'sub').length;
    const home = s === 0 ? { x: 0, y: b.H / 2 } : { x: b.W, y: b.H / 2 };
    return { mine, line, warships, lineAt: centroid(line) || centroid(mine) || home, home, all: centroid(mine) || home };
  });
  return b.fleets[side];
}
/** a point behind the battle line, `by` tiles nearer home */
function behindLine(b, side, by) {
  const F = fleetState(b, side), foe = fleetState(b, 1 - side);
  const ax = F.lineAt.x - foe.all.x, ay = F.lineAt.y - foe.all.y, L = Math.hypot(ax, ay) || 1;
  return { x: F.lineAt.x + (ax / L) * by, y: F.lineAt.y + (ay / L) * by };
}
const toward = (e, p) => Math.atan2(p.y - e.y, p.x - e.x);

// ---------- what each role wants to do this tick ----------
/** returns { desired, speedMul, target } to override the plain broadside-duel handling, or null to leave it */
export function roleIntent(b, e, t, d, bearing, range) {
  const foe = fleetState(b, 1 - e.side), F = fleetState(b, e.side);
  // with no battle line left to shelter behind, every hull fights as a ship of the line
  const lastStand = !F.line.length;
  if (lastStand && (e.role === 'flak' || e.role === 'carrier' || e.role === 'troop' || (e.role === 'siege' && e.shells <= 0))) return null;
  switch (e.role) {
    case 'hunter': {
      // beasts first, even those that have gone under: hunters track them by their wake
      let prey = null, pd = Infinity;
      for (const o of b.ents) {
        if (!o.alive || o.side === e.side || o.ship || o.fort || o.air) continue;
        const dd = Math.hypot(o.x - e.x, o.y - e.y);
        if (dd < pd) { pd = dd; prey = o; }
      }
      const warNear = foe.mine.some((o) => (o.role === 'line' || o.role === 'troop') && Math.hypot(o.x - e.x, o.y - e.y) < 16);
      if (prey && !(warNear && pd > 14)) {
        e.prey = prey.id;
        const want = (e.def.harpoon ? e.def.harpoon.range : 10) * 0.7;
        // keep the beast at harpoon's length, circling; lure the big ones into the shallows if land is near
        const ang = pd > want ? toward(e, prey) : toward(e, prey) + Math.PI / 2;
        return { desired: ang, speedMul: 1, target: prey };
      }
      e.prey = -1;
      // no beast to hunt: fall back behind the line if warships close, otherwise picket the fleet's flank
      if (warNear) return { desired: toward(e, behindLine(b, e.side, 8)), speedMul: 1 };
      const flank = { x: F.all.x + (e.id % 2 ? 1 : -1) * 0, y: F.all.y + (e.id % 2 ? 14 : -14) };
      return Math.hypot(flank.x - e.x, flank.y - e.y) > 6 ? { desired: toward(e, flank), speedMul: 0.8 } : null;
    }
    case 'siege': {
      const fs = fireshipIntent(b, e);
      if (fs) return fs;
      // stand off at mortar range, behind the line, ready to anchor
      const m = e.def.mortar, tgt = siegeTarget(b, e);
      const threat = foe.mine.find((o) => o.role !== 'landing' && Math.hypot(o.x - e.x, o.y - e.y) < 12);
      if (threat) { e.anchored = false; return { desired: toward(e, threat) + Math.PI, speedMul: 1, target: threat }; }
      if (!tgt) return { desired: toward(e, behindLine(b, e.side, 10)), speedMul: 0.7 };
      const dd = Math.hypot(tgt.x - e.x, tgt.y - e.y);
      if (dd > m.range * 0.92) { e.anchored = false; return { desired: toward(e, tgt), speedMul: 0.9, target: tgt }; }
      if (dd < m.range * 0.55 && !(e.def.arts && e.def.arts.claws)) { e.anchored = false; return { desired: toward(e, tgt) + Math.PI, speedMul: 0.8, target: tgt }; }
      if (!e.anchored) { e.anchored = true; if (!(b.tick - (e.anchorSaid || -999) < 120)) { e.anchorSaid = b.tick; b.events.push({ type: 'anchor', id: e.id }); } }
      return { desired: e.heading, speedMul: 0, target: tgt };
    }
    case 'carrier':
      // far back, where her deck is clear, behind land if she can find it
      return { desired: toward(e, behindLine(b, e.side, 22)), speedMul: Math.hypot(behindLine(b, e.side, 22).x - e.x, behindLine(b, e.side, 22).y - e.y) > 4 ? 0.8 : 0 };
    case 'flak': {
      // the centre of the fleet, over the ships worth most; a squadron in reach is the mark
      const keep = F.mine.filter((o) => o.role === 'troop' || o.role === 'carrier' || o.role === 'line');
      const at = centroid(keep) || F.all, air = nearestAir(b, e, 16);
      if (air) return { desired: toward(e, air), speedMul: 0.6, target: air };
      return Math.hypot(at.x - e.x, at.y - e.y) > 5 ? { desired: toward(e, at), speedMul: 0.9 } : { desired: e.heading, speedMul: 0.3 };
    }
    case 'troop': {
      // a crippled enemy near the line: lay alongside and board her
      let prize = null, best = 20;
      for (const o of foe.mine) {
        const dd = Math.hypot(o.x - e.x, o.y - e.y);
        if (dd < best && (o.rig < 0.6 || o.hp < o.maxHp * 0.45 || o.crew < o.def.crew * 0.4) && o.crew < e.crew) { best = dd; prize = o; }
      }
      if (prize) { e.boardingRun = prize.id; return { desired: toward(e, prize), speedMul: 1, target: prize }; }
      e.boardingRun = -1;
      const spot = behindLine(b, e.side, 7);
      return Math.hypot(spot.x - e.x, spot.y - e.y) > 3 ? { desired: toward(e, spot), speedMul: 0.8 } : { desired: e.heading, speedMul: 0.25 };
    }
    case 'landing': {
      // held back until the sea is won, then straight for the nearest enemy fort
      const won = foe.warships === 0 || F.warships >= foe.warships * 2;
      const fort = b.ents.filter((o) => o.alive && o.fort && o.side !== e.side && o.crew > 0).sort((a, c) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(c.x - e.x, c.y - e.y))[0];
      if (won && fort) { if (!e.going) { e.going = true; b.events.push({ type: 'landingRun', id: e.id, side: e.side }); } e.storming = fort; return { desired: toward(e, fort), speedMul: 1, target: fort }; }
      e.storming = null;
      if (!fort && (won || lastStand)) return null; // no forts to take: she fights like any small ship
      const spot = behindLine(b, e.side, 18);
      return Math.hypot(spot.x - e.x, spot.y - e.y) > 4 ? { desired: toward(e, spot), speedMul: 0.7 } : { desired: e.heading, speedMul: 0 };
    }
    case 'line': {
      // a ram on a long straight run when the water is deep and open, and the mark is ahead
      if ((e.def.ram || e.def.arts?.grapple) && t && t.ship && e.ramCd <= 0 && d < 14 && (!nearLand(b, e.x, e.y, 6) || e.def.arts?.blade)) {
        const off = Math.abs(wrap(bearing - e.heading));
        if (off < 30 * DEG) return { desired: bearing, speedMul: 1.15, target: t };
      }
      void range;
      return null; // otherwise: the broadside duel, chain shot as they run and heavy shot close in
    }
    default: return null;
  }
}

function siegeTarget(b, e) {
  // forts first, then the biggest and slowest hulls, then clusters
  let best = null, bs = Infinity;
  for (const o of b.ents) {
    if (!o.alive || o.side === e.side || o.air || submerged(b, o)) continue;
    if (o.fort && o.crew <= 0) continue;
    const dd = Math.hypot(o.x - e.x, o.y - e.y);
    if (dd > e.def.mortar.range * 1.6) continue;
    let s = dd - (o.fort ? 30 : 0) - (o.ship ? o.def.len * 1.2 : 0) - (o.anchored ? 10 : 0);
    if (s < bs) { bs = s; best = o; }
  }
  return best;
}
function nearestAir(b, e, r) {
  let best = null, bd = r;
  for (const o of b.ents) { if (!o.alive || !o.air || o.side === e.side) continue; const dd = Math.hypot(o.x - e.x, o.y - e.y); if (dd < bd) { bd = dd; best = o; } }
  return best;
}

// ---------- weapons beyond the broadside ----------
/** fires whatever this hull carries besides her broadside; `shoot` is the engine's own */
export function roleWeapons(b, e, t, shoot) {
  const d0 = e.def;
  for (const k of ['swivelCd', 'harpoonCd', 'depthCd', 'mortarCd', 'flakCd', 'launchCd', 'ramCd', 'barrelCd']) if (e[k] > 0) e[k]--;
  const crewEff = Math.max(0.2, e.crew / d0.crew);
  // swivel guns: quick, short and aimed at people (and at a beast's eyes and gills)
  const sw = d0.swivel;
  if (sw && e.swivelCd <= 0) {
    let best = null, bd = sw.range;
    for (const o of b.ents) {
      if (!o.alive || o.side === e.side || submerged(b, o)) continue;
      const dd = dist(e, o);
      if (dd < bd && !blocked(b, e, o)) { bd = dd; best = o; }
    }
    if (best) { shoot(b, e, best, best.ship || best.fort ? sw.dmg : [sw.dmg[0] * 2, sw.dmg[1] * 2], sw.acc, sw.range, 'swivel'); e.swivelCd = sw.reload; }
  }
  // harpoons: a tethered beast cannot dive, and is dragged slow
  const hp = d0.harpoon, prey = e.prey >= 0 ? b.ents[e.prey] : null;
  if (hp && prey && prey.alive && e.harpoonCd <= 0 && dist(e, prey) < hp.range) {
    if (submerged(b, prey) && d0.depth && e.depthCd <= 0 && dist(e, prey) < d0.depth.range) {
      // depth charges: the only thing that reaches a beast or a boat below
      b.events.push({ type: 'depthCharge', id: e.id, x: prey.x, y: prey.y });
      prey.subUntil = b.tick; // it is forced up
      b.shots.push({ tick: b.tick + 2, from: e.id, to: prey.id, dmg: b.rng.int(d0.depth.dmg[0], d0.depth.dmg[1]), hit: true, x: prey.x, y: prey.y, splash: 0, depth: true });
      e.depthCd = d0.depth.reload;
    } else if (!submerged(b, prey)) {
      shoot(b, e, prey, hp.dmg, hp.acc, hp.range, 'harpoon');
      b.shots[b.shots.length - 1].tether = { by: e.id, until: b.tick + (hp.tether || 18) };
      e.harpoonCd = Math.round(hp.reload / Math.min(1, crewEff + 0.3));
    }
  }
  // fire barrels astern when something is on her tail
  if (e.barrels > 0 && e.barrelCd <= 0) {
    const tail = b.ents.find((o) => o.alive && o.side !== e.side && !o.fort && !o.air && Math.hypot(o.x - e.x, o.y - e.y) < 9 && Math.abs(wrap(Math.atan2(o.y - e.y, o.x - e.x) - (e.heading + Math.PI))) < 60 * DEG);
    if (tail) {
      const bx = e.x - Math.cos(e.heading) * (e.radius + 1), by = e.y - Math.sin(e.heading) * (e.radius + 1);
      (b.barrels ||= []).push({ x: bx, y: by, side: e.side, by: e.id, until: b.tick + 90, r: 1.6, lit: false });
      e.barrels--; e.barrelCd = 8;
      b.events.push({ type: 'barrel', id: e.id, x: bx, y: by });
    }
  }
  // mortars: high-arching shells over islands and masts
  const m = d0.mortar;
  if (m && e.shells > 0 && e.mortarCd <= 0) {
    const tgt = siegeTarget(b, e);
    if (tgt) {
      const dd = dist(e, tgt);
      if (dd <= m.range && dd >= (m.minRange || 0)) {
        const spotted = b.ents.some((o) => o.alive && o.air && o.side === e.side && Math.hypot(o.x - tgt.x, o.y - tgt.y) < 14);
        const ar = d0.arts || {};
        const sea = ar.claws ? 1.1 : b.wind.speed > 1.05 ? 0.8 : 1.1; // a rough sea throws the shell off; a calm one steadies the mortar
        const acc = m.acc * sea * (spotted ? 1.3 : 1) * (e.anchored || ar.claws ? 1.15 : 0.85) * (tgt.fort ? 1.25 : 1);
        // one colossal gun, or a scattered salvo of lighter shells
        const n = ar.salvo || 1, k = (ar.single || 1) * (n > 1 ? 1.6 / n : 1);
        for (let i = 0; i < n; i++) {
          const dmg = [Math.round(m.dmg[0] * k), Math.round(m.dmg[1] * k)];
          shoot(b, e, tgt, dmg, Math.min(0.95, acc * (n > 1 ? 0.85 : 1)), m.range * 1.4, 'mortar');
          const s = b.shots[b.shots.length - 1]; s.splash = (m.splash || 2) * (ar.single ? 1.4 : 1); s.tick += 2 + i;
          s.look = ar.shot || 'mortar';
          if (n > 1 && !s.hit) { s.x += (b.rng.next() - 0.5) * 4; s.y += (b.rng.next() - 0.5) * 4; }
        }
        e.shells--; e.mortarCd = Math.round((m.reload * (ar.rapid || 1) * (ar.single || 1)) / Math.min(1, crewEff + 0.3));
      }
    }
  }
  // flak: rapid guns into the sky
  const fl = d0.flak;
  if (fl && e.flakCd <= 0) {
    const air = nearestAir(b, e, fl.range) || flyingBeast(b, e, fl.range);
    if (air) { for (let k = 0; k < (fl.guns || 2); k++) shoot(b, e, air, fl.dmg, fl.acc, fl.range, 'flak'); e.flakCd = fl.reload; }
  }
  // the carrier launches her squadrons
  const sq = d0.squadrons;
  if (sq && e.launchCd <= 0) {
    const up = b.ents.filter((o) => o.alive && o.air && o.carrier === e.id).length;
    if (up < sq.max) { launch(b, e, sq); e.launchCd = sq.every; }
  }
  // grapnels and maws: touching an enemy hull, she locks on
  if (d0.arts && d0.arts.grapple && t && t.alive && t.ship && !(e.lockUntil > b.tick) && dist(e, t) < 0.6 && e.ramCd <= 0) { e.ramCd = 20; e.lockTo = t.id; e.lockUntil = b.tick + 14; t.lockTo = e.id; t.lockUntil = b.tick + 14; b.events.push({ type: 'art', name: 'grapple', id: t.id, by: e.id }); }
  // ramming: the run builds the blow
  if (d0.ram && t && t.alive && t.ship && e.ramCd <= 0 && dist(e, t) < 0.4) {
    const ahead = Math.abs(wrap(Math.atan2(t.y - e.y, t.x - e.x) - e.heading)) < ramArc(e) * DEG;
    if (ahead) {
      const run = Math.min(30, e.run || 0);
      const rm = ramMods(b, e, t, Math.round(d0.ram.base + run * d0.ram.perTile), 0);
      const dmg = rm.dmg;
      e.ramCd = d0.ram.cooldown; e.run = 0;
      b.events.push({ type: 'ram', id: e.id, to: t.id, dmg });
      return { ram: { t, dmg, self: rm.self === 0 ? 0 : Math.round(dmg * 0.12) } };
    }
  }
  return null;
}
function flyingBeast(b, e, r) {
  let best = null, bd = r;
  for (const o of b.ents) { if (!o.alive || o.side === e.side || o.ship || o.fort || o.air || !o.def.flies) continue; const dd = dist(e, o); if (dd < bd) { bd = dd; best = o; } }
  return best;
}

// ---------- squadrons of fliers ----------
const SQUAD = { name: 'Squadron', hp: 40, speed: 1.5, radius: 0.8, dmg: [3, 8], crewKill: 2, burn: 0.3, every: 4 };
// a faction with an air wing (src/data/air) flies its own naval strikers and fighters off its carriers, turn about
function wingSquad(b, carrier) {
  const fid = carrier.def.realm || b.sides[carrier.side]?.faction;
  const pick = (carrier.wingN = (carrier.wingN || 0) + 1) % 2 ? ['naval', 'fighter'] : ['fighter', 'naval'];
  for (const role of pick) {
    const u = fid && UNITS[`${fid}_air_${role}`];
    if (!u) continue;
    const A = u.airArts || {}, max = u.max || Math.max(4, Math.round((u.rng > 1 ? u.rng : u.str) / 6));
    const k = Math.sqrt(u.hp / 75);
    const def = { name: u.name, airUnit: u.id, airRole: role, model: u.model, flier: u.model?.kind || u.model?.mountType || u.model?.body || 'glider', color: u.model?.cloth,
      hp: Math.round(30 + u.hp * 0.3), speed: +(1.3 + 0.1 * (u.move || 2) * (A.speed || 1)).toFixed(2), dmg: [Math.max(2, Math.round(max * 0.4)), Math.max(4, Math.round(max * 1.1))], crewKill: 2, burn: A.incendiary || A.fireTrail || A.breath === 'fire' ? 0.5 : 0.25, every: 4 };
    if (role === 'fighter') { def.hunter = true; def.vsAir = A.vsAir || 1.5; }
    else { def.torpedo = Math.round((A.torpedo || 30) * k); def.diveBomb = Math.round((A.diveBomb || A.torpedo || 24) * k); def.vsShip = A.vsShip || 1; def.vsLeviathan = A.vsLeviathan || 1.2; def.depthCharge = !!A.depthCharge; }
    return def;
  }
  return null;
}
function launch(b, carrier, sq) {
  const wing = wingSquad(b, carrier);
  const def = wing ? { ...SQUAD, ...wing, id: `${carrier.def.id}_squadron_${wing.airRole}` } : { ...SQUAD, ...sq.def, name: sq.name || 'Squadron', flier: sq.flier || 'glider', id: `${carrier.def.id}_squadron` };
  const e = {
    id: b.ents.length, side: carrier.side, def, ship: false, fort: false, air: true, carrier: carrier.id,
    x: carrier.x, y: carrier.y, px: carrier.x, py: carrier.y, heading: carrier.heading, ph: carrier.heading,
    hp: def.hp, maxHp: def.hp, crew: 0, alive: true, cd: 0, target: -1, radius: def.radius, kills: 0, reload: [0, 0],
    subUntil: 0, slowUntil: 0, slow: 1, inkUntil: 0, ink: 0, charmUntil: 0, nextSub: 0, dot: null, rig: 1,
  };
  b.ents.push(e);
  b.events.push({ type: 'launch', id: e.id, from: carrier.id, ...(def.airUnit ? { unit: def.airUnit, role: def.airRole } : {}) });
}
export function squadTick(b, e) {
  if (e.cd > 0) e.cd--;
  const home = b.ents[e.carrier];
  // pick: siege ships and carriers first, then supply flagships, then whatever is nearest
  let t = e.target >= 0 ? b.ents[e.target] : null;
  if (e.def.hunter) {
    // interceptors go for the enemy's fliers first
    let foe = null, fd = 30;
    for (const o of b.ents) { if (!o.alive || !o.air || o.side === e.side) continue; const dd = Math.hypot(o.x - e.x, o.y - e.y); if (dd < fd) { fd = dd; foe = o; } }
    if (foe) {
      const a = Math.atan2(foe.y - e.y, foe.x - e.x);
      e.heading = fd > 2 ? a : wrap(a + Math.PI / 2);
      e.x += Math.cos(e.heading) * e.def.speed; e.y += Math.sin(e.heading) * e.def.speed;
      if (fd < 3 && e.cd <= 0) { e.cd = e.def.every; foe.hp -= Math.round(b.rng.int(e.def.dmg[0], e.def.dmg[1]) * 2 * (e.def.vsAir ? e.def.vsAir / 1.5 : 1)); b.events.push({ type: 'strafe', id: e.id, to: foe.id }); if (foe.hp <= 0 && foe.alive) { foe.alive = false; foe.hp = 0; e.kills++; b.events.push({ type: 'death', id: foe.id }); } }
      return;
    }
  }
  if (e.def.torpedo) return strikerTick(b, e, home);
  if (!t || !t.alive || t.side === e.side || b.tick % 8 === 0) {
    let best = null, bs = Infinity;
    for (const o of b.ents) {
      if (!o.alive || o.side === e.side || o.air || submerged(b, o) || !(o.ship || o.fort)) continue;
      const dd = Math.hypot(o.x - e.x, o.y - e.y);
      const s = dd - (o.role === 'siege' ? 30 : o.role === 'carrier' ? 24 : o.role === 'troop' ? 14 : 0) + (b.ents.some((f) => f.alive && f.side === o.side && f.role === 'flak' && Math.hypot(f.x - o.x, f.y - o.y) < 12) ? 18 : 0);
      if (s < bs) { bs = s; best = o; }
    }
    t = best; e.target = best ? best.id : -1;
  }
  if (!t) { if (home && home.alive) { const a = Math.atan2(home.y - e.y, home.x - e.x); e.heading = a; e.x += Math.cos(a) * e.def.speed; e.y += Math.sin(a) * e.def.speed; } return; }
  // they circle the mark and strafe it
  const a = Math.atan2(t.y - e.y, t.x - e.x), dd = Math.hypot(t.x - e.x, t.y - e.y);
  e.heading = dd > 4 ? a : wrap(a + Math.PI / 2);
  e.x += Math.cos(e.heading) * e.def.speed; e.y += Math.sin(e.heading) * e.def.speed;
  e.x = Math.max(1, Math.min(b.W - 1, e.x)); e.y = Math.max(1, Math.min(b.H - 1, e.y));
  if (dd < 5 && e.cd <= 0) {
    e.cd = e.def.every;
    // an intercepting screen over the enemy fleet spoils the run
    const screened = b.ents.some((o) => o.alive && o.ship && o.side !== e.side && o.def.arts?.intercept && Math.hypot(o.x - e.x, o.y - e.y) < o.def.arts.intercept);
    if (screened && b.rng.chance(0.5)) { b.events.push({ type: 'art', name: 'intercept', id: e.id }); return; }
    b.events.push({ type: 'strafe', id: e.id, to: t.id });
    t.crew = Math.max(0, t.crew - b.rng.int(0, e.def.crewKill));
    t.hp -= b.rng.int(e.def.dmg[0], e.def.dmg[1]);
    if (t.ship && !t.dot && b.rng.chance(e.def.burn)) { t.dot = { until: b.tick + 18, from: b.tick, every: 3, dmg: 4, by: e.id }; b.events.push({ type: 'fireAboard', id: t.id }); }
    if (t.hp <= 0 && t.alive) { t.alive = false; t.hp = 0; e.kills++; b.events.push({ type: 'death', id: t.id }); }
  }
}

// naval strike squadrons (air wings): torpedo runs from range, armour-piercing dive bombs from overhead, depth charges
// for what dives. Events: { type: 'torpedo', id, to, x0, y0, x1, y1, flight } and { type: 'diveBomb', id, to, depth? }
function strikerTick(b, e, home) {
  let t = e.target >= 0 ? b.ents[e.target] : null;
  if (!t || !t.alive || t.side === e.side || b.tick % 8 === 0) {
    let best = null, bs = Infinity;
    for (const o of b.ents) {
      if (!o.alive || o.side === e.side || o.air || o.fort) continue;
      const beast = !o.ship;
      if (submerged(b, o) && !(beast && e.def.depthCharge)) continue;
      const s = Math.hypot(o.x - e.x, o.y - e.y) - (beast ? 10 * (e.def.vsLeviathan - 1) + 6 : 8 * (e.def.vsShip - 1)) - (o.role === 'carrier' || o.role === 'siege' ? 10 : 0);
      if (s < bs) { bs = s; best = o; }
    }
    t = best; e.target = best ? best.id : -1;
  }
  if (!t) { if (home && home.alive) { const a = Math.atan2(home.y - e.y, home.x - e.x); e.heading = a; e.x += Math.cos(a) * e.def.speed; e.y += Math.sin(a) * e.def.speed; } return; }
  const a = Math.atan2(t.y - e.y, t.x - e.x), dd = Math.hypot(t.x - e.x, t.y - e.y);
  e.heading = dd > 3 ? a : wrap(a + Math.PI / 2);
  e.x = Math.max(1, Math.min(b.W - 1, e.x + Math.cos(e.heading) * e.def.speed)); e.y = Math.max(1, Math.min(b.H - 1, e.y + Math.sin(e.heading) * e.def.speed));
  if (e.cd > 0) return;
  const screened = b.ents.some((o) => o.alive && o.ship && o.side !== e.side && o.def.arts?.intercept && Math.hypot(o.x - e.x, o.y - e.y) < o.def.arts.intercept);
  const beast = !t.ship, mul = beast ? e.def.vsLeviathan : e.def.vsShip, arm = t.def.armour || 0;
  if (dd < 9 && dd > 3 && !submerged(b, t)) {
    e.cd = 14;
    if (screened && b.rng.chance(0.5)) { b.events.push({ type: 'art', name: 'intercept', id: e.id }); return; }
    const hit = b.rng.chance(0.55 + Math.min(0.3, t.radius * 0.06));
    const flight = 2 + Math.floor(dd / 5);
    b.shots.push({ tick: b.tick + flight, from: e.id, to: t.id, dmg: hit ? Math.round(e.def.torpedo * mul * (100 / (100 + arm * 0.4))) : 0, hit, x: t.x, y: t.y, torpedo: true, kind: 'torpedo' });
    b.events.push({ type: 'torpedo', id: e.id, to: t.id, x0: e.x, y0: e.y, x1: t.x, y1: t.y, flight, hit });
  } else if (dd <= 3) {
    e.cd = 10;
    if (screened && b.rng.chance(0.5)) { b.events.push({ type: 'art', name: 'intercept', id: e.id }); return; }
    const depth = beast && submerged(b, t);
    const hit = b.rng.chance(depth ? 0.5 : 0.65);
    b.shots.push({ tick: b.tick + 1, from: e.id, to: t.id, dmg: hit ? Math.round(e.def.diveBomb * mul * (depth ? 1.3 : 1) * (100 / (100 + arm))) : 0, hit, x: t.x, y: t.y, depth, kind: 'dive' });
    b.events.push({ type: 'diveBomb', id: e.id, to: t.id, x: t.x, y: t.y, hit, ...(depth ? { depth: true } : {}) });
  }
}

// ---------- once a tick: shoals, supply, barrels, tethers ----------
export function rolesTick(b) {
  for (const e of b.ents) {
    if (!e.alive || !e.ship) continue;
    // a deep-draft hull in shoal water: slowed and scraping her bottom
    if (deepDraft(e) && !submerged(b, e) && shoal(b, e.x, e.y)) {
      e.slowUntil = b.tick + 2; e.slow = Math.min(e.slow || 1, 0.45);
      if (b.tick % 3 === 0) { e.hp -= 2; if (!e.aground) { e.aground = true; b.events.push({ type: 'aground', id: e.id }); } }
    } else e.aground = false;
    // a big ship near land cannot make her wide turns
    e.turnScale = deepDraft(e) && nearLand(b, e.x, e.y, 9) ? 0.6 : 1;
    // the supply flagship tends the ships round her
    const sp = e.def.supply;
    if (sp && b.tick % sp.every === 0) {
      for (const o of b.ents) {
        if (o === e || !o.alive || !o.ship || o.side !== e.side || Math.hypot(o.x - e.x, o.y - e.y) > sp.radius) continue;
        if (o.hp < o.maxHp) { o.hp = Math.min(o.maxHp, o.hp + sp.repair); }
        if (o.crew < o.def.crew * 0.6 && e.crew > e.def.crew * 0.35) { o.crew++; e.crew--; }
        if (o.heavy !== undefined && o.def.heavyShot !== 0 && o.heavy < 4 && o.role === 'line') o.heavy++;
        if (o.def.mortar && o.shells < (o.def.mortar.shells ?? 16)) o.shells++;
        if (o.def.barrels && o.barrels < o.def.barrels) o.barrels++;
        if (o.rig < 1) o.rig = Math.min(1, o.rig + 0.02);
        o.spurred = b.tick + sp.every; // her officers spur the gun crews: faster reloads
      }
      if (b.tick % (sp.every * 12) === 0) b.events.push({ type: 'resupply', id: e.id });
    }
  }
  // fire barrels: anything of the other side that runs over one is set alight
  if (b.barrels && b.barrels.length) {
    b.barrels = b.barrels.filter((br) => {
      if (b.tick > br.until) return false;
      for (const o of b.ents) {
        if (!o.alive || o.side === br.side || o.fort || o.air || submerged(b, o)) continue;
        if (Math.hypot(o.x - br.x, o.y - br.y) - o.radius < br.r) {
          o.dot = { until: b.tick + 15, from: b.tick, every: 3, dmg: o.ship ? 7 : 9, by: br.by };
          b.events.push({ type: 'barrelBurst', x: br.x, y: br.y, id: o.id });
          return false;
        }
      }
      return true;
    });
  }
  // a tethered beast is held up and slowed until the line parts
  for (const e of b.ents) {
    if (!e.alive || !e.tether) continue;
    const by = b.ents[e.tether.by];
    if (b.tick > e.tether.until || !by || !by.alive) { e.tether = null; continue; }
    e.subUntil = Math.min(e.subUntil, b.tick); e.nextSub = Math.max(e.nextSub || 0, b.tick + 4);
    e.slowUntil = b.tick + 2; e.slow = Math.min(e.slow || 1, 0.4);
  }
}
