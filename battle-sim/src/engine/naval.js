// Continuous-space naval battle: ships fire broadsides, board each other,
// and fight sea creatures. Shares the 0.6s tick with land battles.
import { createRng } from './rng.js';
import { SHIPS, CREATURES, FORTS } from '../data/naval.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createNaval(scn, seed = 1, defs = { SHIPS, CREATURES, FORTS }) {
  const fortDefs = defs.FORTS || FORTS;
  const W = scn.width || 140, H = scn.height || 90;
  const b = {
    W, H, tick: 0, rng: createRng(seed), ents: [], shots: [], events: [], winner: null,
    maxTicks: scn.maxTicks || 2500, islands: scn.islands || [], theme: scn.theme || null,
    sides: scn.sides.map((s, i) => ({ name: s.name || `Side ${i + 1}`, initial: 0 })),
  };
  // the wind blows toward `dir` and backs and veers a little as the fight goes on
  b.wind = { dir: scn.wind !== undefined ? scn.wind : b.rng.next() * Math.PI * 2, speed: 0.85 + b.rng.next() * 0.3, veer: (b.rng.next() - 0.5) * 0.004 };
  scn.sides.forEach((side, si) => {
    const list = [];
    for (const g of side.groups || []) {
      const def = defs.SHIPS[g.unit] || defs.CREATURES[g.unit];
      if (!def) continue;
      for (let k = 0; k < Math.min(g.count, 60); k++) list.push(def);
    }
    // some of the deep's lords choose their company: they will not sail with fleets they despise
    const realms = new Set(list.map((d) => d.realm).filter(Boolean));
    for (let k = list.length - 1; k >= 0; k--) {
      const d = list[k];
      if (d.refuses && d.refuses.some((r) => realms.has(r))) { list.splice(k, 1); (b.refused ||= []).push({ side: si, name: d.name }); }
    }
    const cols = Math.ceil(Math.sqrt(list.length * 0.6)) || 1;
    list.forEach((def, k) => {
      const col = k % cols, row = Math.floor(k / cols);
      const x = si === 0 ? 10 + row * 8 : W - 10 - row * 8;
      const y = H / 2 + (col - (cols - 1) / 2) * 10;
      addEnt(b, def, si, x + b.rng.next() * 2, Math.max(4, Math.min(H - 4, y + b.rng.next() * 2)));
    });
  });
  for (const f of scn.forts || []) {
    const def = fortDefs[f.type];
    if (def && (f.side === 0 || f.side === 1)) addEnt(b, def, f.side, f.x, f.y);
  }
  return b;
}

function addEnt(b, def, side, x, y) {
  const ship = !!def.hull, fort = !!def.garrison;
  const e = {
    id: b.ents.length, side, def, ship, fort, x, y, px: x, py: y,
    heading: side === 0 ? 0 : Math.PI, ph: side === 0 ? 0 : Math.PI,
    hp: ship ? def.hull : def.hp, maxHp: ship ? def.hull : def.hp, crew: ship ? def.crew : fort ? def.garrison : 0,
    alive: true, reload: [b.rng.int(0, 4), b.rng.int(0, 4)], cd: b.rng.int(0, 3), target: -1,
    rig: 1, tack: 1, tackUntil: 0, slowUntil: 0, slow: 1, inkUntil: 0, ink: 0, charmUntil: 0, charmBy: -1, subUntil: 0, nextSub: 0,
    nextSweep: 0, nextRam: 0, nextCharm: 0, nextWave: 0, nextBreath: 0, nextSwallow: 0, dot: null, gripBy: -1, radius: ship ? def.len / 2 : fort ? def.size : (def.size || 1) * 0.7, kills: 0,
  };
  b.ents.push(e);
  if (!fort) b.sides[side].initial++;
}

export function stepNaval(b) {
  if (b.winner !== null) return;
  b.tick++;
  b.events = [];
  b.wind.dir = wrap(b.wind.dir + b.wind.veer + (b.rng.next() - 0.5) * 0.004);
  for (const e of b.ents) { e.px = e.x; e.py = e.y; e.ph = e.heading; }
  if (b.tick === 1 && b.refused) for (const r of b.refused) b.events.push({ type: 'refused', side: r.side, name: r.name });
  for (const e of b.ents) if (e.alive) (e.ship ? shipTick : e.fort ? fortTick : creatureTick)(b, e);
  // fire in the rigging, water in the hold, coils round the hull: harm that goes on after the blow
  for (const e of b.ents) {
    const d = e.dot;
    if (!d || !e.alive) continue;
    if (b.tick >= d.until || (d.grip && !(b.ents[d.by] && b.ents[d.by].alive))) { e.dot = null; if (d.grip) e.gripBy = -1; continue; }
    if ((b.tick - d.from) % d.every === 0) {
      hurt(b, e, d.dmg, b.ents[d.by]);
      // a ship held fast and nearly broken is pulled under
      if (d.grip && d.drag && e.alive && e.ship && e.hp < e.maxHp * d.drag) { e.hp = 0; e.alive = false; e.dragged = true; if (b.ents[d.by]) b.ents[d.by].kills++; b.events.push({ type: 'dragged', id: e.id, by: d.by }); b.events.push({ type: 'death', id: e.id }); }
    }
  }
  separate(b);
  resolveShots(b);
  boarding(b);
  // a fort with no garrison is out of the fight; forts alone can't finish a battle
  const fighting = (e) => e.alive && (!e.fort || e.crew > 0);
  const alive = [0, 1].map((s) => b.ents.some((e) => fighting(e) && e.side === s));
  const mobile = [0, 1].map((s) => b.ents.some((e) => fighting(e) && !e.fort && e.side === s));
  if (alive[0] && alive[1] && !mobile[0] && !mobile[1]) {
    const hp = [0, 1].map((s) => b.ents.filter((e) => fighting(e) && e.side === s).reduce((a, e) => a + e.hp, 0));
    alive[hp[0] >= hp[1] ? 1 : 0] = false;
  }
  if (!alive[0] && !alive[1]) b.winner = -1;
  else if (!alive[0]) b.winner = 1;
  else if (!alive[1]) b.winner = 0;
  else if (b.tick >= b.maxTicks) b.winner = -1;
  if (b.winner !== null) b.events.push({ type: 'end', winner: b.winner });
}

// How well a ship sails on this heading: nothing in the wind's eye, slow close-hauled, best with
// the wind on the beam or quarter, a little less dead before it. Square-riggers point worse than
// fore-and-aft rigs. Oared craft and beasts do not care.
export function sailFactor(b, e, heading = e.heading) {
  if (!e.ship || e.def.oars || e.def.beast || e.def.engine) return 1;
  const off = Math.abs(wrap(heading - b.wind.dir)) / DEG; // 0 = running, 180 = head to wind
  const irons = e.def.sails >= 3 ? 128 : 140;             // how close to the wind she will lie
  let f;
  if (off > irons) f = 0.18;
  else if (off > irons - 25) f = 0.18 + (0.62 * (irons - off)) / 25;
  else if (off > 55) f = 1;
  else f = 0.82 + 0.18 * (off / 55);
  return f * b.wind.speed * (0.4 + 0.6 * e.rig);
}
const submerged = (b, e) => !e.fort && b.tick < e.subUntil; // sea creatures, and ships built to dive
const dist = (a, c) => Math.hypot(a.x - c.x, a.y - c.y) - a.radius - c.radius;

function chooseTarget(b, e) {
  let best = null, bs = Infinity;
  for (const o of b.ents) {
    if (!o.alive || o.side === e.side || submerged(b, o)) continue;
    const d = Math.hypot(o.x - e.x, o.y - e.y);
    let s = d + (o.hp / o.maxHp) * 15;
    // a living barricade fills the gunners' sights: ships near it shoot at it before anything behind
    if (e.ship && o.def.screen && d < o.def.screen) s -= 60;
    if (s < bs) { bs = s; best = o; }
  }
  e.target = best ? best.id : -1;
  return best;
}

function steer(b, e, desired, speedMul = 1) {
  // keep off the edges and islands
  const margin = 6;
  let ax = Math.cos(desired), ay = Math.sin(desired);
  if (e.x < margin) ax += (margin - e.x) * 0.4;
  if (e.x > b.W - margin) ax -= (e.x - (b.W - margin)) * 0.4;
  if (e.y < margin) ay += (margin - e.y) * 0.4;
  if (e.y > b.H - margin) ay -= (e.y - (b.H - margin)) * 0.4;
  for (const isl of b.islands) {
    // pack ice and bergs: sea creatures swim beneath, a diving boat passes under, an ice-breaking bow goes through
    if (isl.ice && (!e.ship || e.def.icebreaker || e.def.kind === 'icebreaker' || e.def.kind === 'dreadnought' || submerged(b, e))) continue;
    const dx = e.x - isl.x, dy = e.y - isl.y, d = Math.hypot(dx, dy);
    const storming = e.storming && Math.hypot(e.storming.x - isl.x, e.storming.y - isl.y) < isl.r + 3;
    const clear = isl.r + e.radius + (storming ? 0.5 : 4);
    if (d < clear) { ax += (dx / d) * (clear - d) * 0.5; ay += (dy / d) * (clear - d) * 0.5; }
  }
  desired = Math.atan2(ay, ax);
  // a fouled rudder will not answer; a creature in mid-jet cannot swerve
  const turn = (e.ship ? e.def.turn : (e.def.turn ?? 14)) * DEG * (b.tick < (e.rudderUntil || 0) ? 0 : (e.turnScale ?? 1));
  const diff = wrap(desired - e.heading), turned = Math.max(-turn, Math.min(turn, diff));
  e.heading = wrap(e.heading + turned);
  e.straight = Math.abs(turned) < 4 * DEG; // for those that build speed on a straight run
  let spd = e.def.speed * speedMul * (b.tick < e.slowUntil ? e.slow : 1);
  if (e.ship) spd *= 0.35 + 0.65 * Math.max(0.25, e.crew / e.def.crew); // short-handed ships are slow
  if (e.ship) spd *= sailFactor(b, e);
  if (submerged(b, e)) spd *= 1.4;
  e.x += Math.cos(e.heading) * spd;
  e.y += Math.sin(e.heading) * spd;
  e.run = e.straight ? (e.run || 0) + spd : 0;
}

function shipTick(b, e) {
  for (let s = 0; s < 2; s++) if (e.reload[s] > 0) e.reload[s]--;
  if (e.cd > 0) e.cd--;
  if (b.tick < e.charmUntil) {
    const c = b.ents[e.charmBy];
    if (c && c.alive) { steer(b, e, Math.atan2(c.y - e.y, c.x - e.x)); return; }
  }
  const t = (b.tick % 5 === 0 || e.target < 0 || !b.ents[e.target].alive || submerged(b, b.ents[e.target])) ? chooseTarget(b, e) : b.ents[e.target];
  if (!t) {
    steer(b, e, e.heading, 0.5);
    return;
  }
  const dx = t.x - e.x, dy = t.y - e.y, d = Math.hypot(dx, dy), bearing = Math.atan2(dy, dx);
  const range = e.def.cannons.perSide ? e.def.cannons.range : (e.def.musket ? e.def.musket.range : 3);
  let desired;
  const boarder = e.crew > (t.crew || 0) * 1.6 && (t.ship || t.fort) && e.crew >= 8;
  e.storming = boarder && t.fort ? t : null;
  if (boarder && (d < range * 1.2 || t.fort)) {
    desired = bearing; // close in and board
  } else if (!t.ship && d < range * 0.45) {
    desired = bearing + Math.PI; // keep monsters at arm's length
  } else if (d > range * 0.85) {
    desired = bearing;
  } else {
    // present a broadside: turn perpendicular to the target on the closer side
    const port = wrap(bearing + Math.PI / 2), star = wrap(bearing - Math.PI / 2);
    desired = Math.abs(wrap(port - e.heading)) < Math.abs(wrap(star - e.heading)) ? port : star;
    if (d < range * 0.4) desired = wrap(desired + (wrap(desired - bearing) > 0 ? 0.4 : -0.4));
  }
  // a ship cannot sail into the wind's eye: she beats up to her mark on alternate tacks
  if (!e.def.oars && !e.def.beast && !e.def.engine) {
    const eye = wrap(b.wind.dir + Math.PI), irons = (e.def.sails >= 3 ? 52 : 40) * DEG;
    const offEye = wrap(desired - eye);
    if (Math.abs(offEye) < irons) {
      if (b.tick > e.tackUntil) { e.tack = offEye >= 0 ? 1 : -1; if (Math.abs(offEye) < 8 * DEG) e.tack = -e.tack; e.tackUntil = b.tick + 22; if (!e.beating) { e.beating = true; b.events.push({ type: 'tack', id: e.id }); } }
      desired = wrap(eye + e.tack * (irons + 6 * DEG));
    } else e.beating = false;
  }
  // a diving boat goes under as she closes, runs in unseen, and comes up to loose her torpedo
  const dv = e.def.dive;
  if (dv) {
    if (!submerged(b, e) && b.tick >= e.nextSub && d < dv.range && (d > 4 || e.hp < e.maxHp * 0.5)) { e.subUntil = b.tick + dv.duration; e.nextSub = b.tick + dv.every + dv.duration; b.events.push({ type: 'submerge', id: e.id }); }
    if (submerged(b, e)) { steer(b, e, d > 5 ? bearing : desired); return; }
  }
  // with a torpedo ready she points her bow at the mark; otherwise she handles like any ship
  steer(b, e, e.def.torpedo && e.cd <= 3 && d < e.def.torpedo.range * 1.6 ? bearing : desired);
  const tp = e.def.torpedo;
  if (tp && e.cd <= 0 && (t.ship || t.def.size >= 3) && !submerged(b, t) && d - t.radius < tp.range && Math.abs(wrap(bearing - e.heading)) < 28 * DEG) {
    shoot(b, e, t, tp.dmg, tp.acc, tp.range, 'torpedo');
    e.cd = tp.reload;
    b.events.push({ type: 'torpedo', id: e.id, to: t.id });
  }
  fireBroadsides(b, e);
}

function fireBroadsides(b, e) {
  const c = e.def.cannons;
  if (!c.perSide) {
    // small craft: muskets in any direction
    const m = e.def.musket;
    const t = b.ents[e.target];
    if (m && t && e.cd <= 0 && !submerged(b, t) && dist(e, t) <= m.range) {
      shoot(b, e, t, m.dmg, m.acc, m.range, 'musket');
      e.cd = m.reload;
    }
    return;
  }
  const crewEff = Math.max(0.2, e.crew / e.def.crew);
  for (let s = 0; s < 2; s++) {
    if (e.reload[s] > 0) continue;
    const beam = wrap(e.heading + (s === 0 ? Math.PI / 2 : -Math.PI / 2));
    let best = null, bd = Infinity;
    for (const o of b.ents) {
      if (!o.alive || o.side === e.side || submerged(b, o)) continue;
      const d = dist(e, o);
      if (d > c.range) continue;
      const ang = Math.abs(wrap(Math.atan2(o.y - e.y, o.x - e.x) - beam));
      if (ang > 35 * DEG) continue;
      const score = d + (o.id === e.target ? -5 : 0);
      if (score < bd) { bd = score; best = o; }
    }
    if (!best) continue;
    const guns = Math.max(1, Math.round(c.perSide * crewEff));
    for (let g = 0; g < guns; g++) shoot(b, e, best, c.dmg, c.acc, c.range, 'cannon', s, g / guns);
    e.reload[s] = Math.round(c.reload / Math.min(1, crewEff + 0.3));
    b.events.push({ type: 'broadside', id: e.id, side: s, guns });
  }
}

function shoot(b, e, t, dmg, acc, range, kind, broadside = 0, offset = 0) {
  const d = Math.max(0, dist(e, t));
  let p = acc * (1 - 0.45 * (d / Math.max(1, range)));
  // the weather gage: the ship to windward shoots through clear air, her smoke rolling down on the enemy
  if (kind === 'cannon') { const upwind = Math.cos(wrap(Math.atan2(t.y - e.y, t.x - e.x) - b.wind.dir)); p *= 1 + 0.12 * upwind; }
  p *= Math.min(1.3, 0.75 + t.radius * 0.15);
  if (b.tick < e.inkUntil) p *= 1 - e.ink;
  const hit = b.rng.next() < p;
  let dm = hit ? b.rng.int(dmg[0], dmg[1]) : 0;
  const armour = t.ship ? t.def.armour : t.def.armour;
  dm = Math.round(dm * (100 / (100 + (kind === 'torpedo' ? armour * 0.4 : armour)))); // a torpedo strikes below the belt of the armour
  const flight = 1 + Math.floor(d / 7);
  // miss lands somewhere near the target
  const mx = t.x + (hit ? 0 : (b.rng.next() - 0.5) * 6), my = t.y + (hit ? 0 : (b.rng.next() - 0.5) * 6);
  // cannon origin along the hull
  const along = (offset - 0.5) * (e.def.len || 0) * 0.7;
  const ox = e.x + Math.cos(e.heading) * along, oy = e.y + Math.sin(e.heading) * along;
  b.shots.push({ tick: b.tick + flight, from: e.id, to: t.id, dmg: dm, hit, x: mx, y: my, splash: e.def.weapon?.splash || 0, grapple: e.def.weapon?.grapple, torpedo: kind === 'torpedo' });
  b.events.push({ type: 'shot', kind, from: e.id, to: t.id, x0: ox, y0: oy, x1: mx, y1: my, flight, hit });
}

function creatureTick(b, e) {
  if (e.cd > 0) e.cd--;
  for (const a of e.def.abilities) {
    if (a.type === 'submerge' && b.tick >= e.nextSub && e.hp < e.maxHp * 0.85) {
      e.subUntil = b.tick + a.duration; e.nextSub = b.tick + a.every + a.duration;
      b.events.push({ type: 'submerge', id: e.id });
    }
  }
  const t = (b.tick % 4 === 0 || e.target < 0 || !b.ents[e.target].alive) ? chooseTarget(b, e) : b.ents[e.target];
  if (!t) { steer(b, e, e.heading, 0.3); return; }
  const d = dist(e, t);
  const atk = e.def.attack;
  const bearing = Math.atan2(t.y - e.y, t.x - e.x);
  // ranged creatures hover at range, others close in
  const want = atk.range > 4 ? (d < atk.range * 0.5 ? bearing + Math.PI : d > atk.range * 0.9 ? bearing : bearing + Math.PI / 2) : bearing;
  if (e.def.jet) {
    // jet-propelled: a few ticks of straight, violent thrust, then a drift in which it lines up the next run
    const burst = (b.tick + e.id * 7) % e.def.jet.cycle < e.def.jet.burst;
    e.turnScale = burst ? 0.08 : 1.6;
    steer(b, e, bearing, burst ? e.def.jet.speed : 0.12);
  } else steer(b, e, want, d < atk.range * 0.7 && atk.range <= 4 ? 0.2 : 1);
  if (submerged(b, e)) return;

  for (const a of e.def.abilities) {
    if (a.type === 'ram' && b.tick >= e.nextRam && d < 1) {
      e.nextRam = b.tick + a.cooldown;
      // some build their blow over a long straight run, and some go clean through plate
      const run = a.perTile ? Math.min(a.max, (e.run || 0) * a.perTile) : 0;
      hurt(b, t, Math.round((a.damage + run) * (a.through ? 1 : 100 / (100 + (t.def.armour || 0)))), e);
      e.run = 0;
      b.events.push({ type: 'ability', id: e.id, name: 'ram', to: t.id });
    }
    if (a.type === 'sweep' && b.tick >= e.nextSweep && d < a.radius) {
      e.nextSweep = b.tick + a.every;
      for (const o of b.ents) if (o.alive && o.side !== e.side && dist(e, o) < a.radius) hurt(b, o, b.rng.int(0, a.maxHit), e);
      b.events.push({ type: 'ability', id: e.id, name: 'sweep', radius: a.radius });
    }
    if (a.type === 'wave' && b.tick >= e.nextWave && d < a.range) {
      // a wall of water rolls out over the target: hulls are battered, thrown back and left wallowing
      e.nextWave = b.tick + a.every;
      for (const o of b.ents) {
        if (!o.alive || o.side === e.side || o.fort || submerged(b, o)) continue;
        const dd = Math.hypot(o.x - t.x, o.y - t.y);
        if (dd - o.radius > a.radius) continue;
        hurt(b, o, Math.round(b.rng.int(a.maxHit >> 1, a.maxHit) * (100 / (100 + (o.def.armour || 0)))), e);
        if (!o.alive) continue;
        const ang = Math.atan2(o.y - e.y, o.x - e.x), push = a.push * (o.ship ? Math.min(1, 6 / o.def.len) : 0.5);
        o.x = Math.max(2, Math.min(b.W - 2, o.x + Math.cos(ang) * push)); o.y = Math.max(2, Math.min(b.H - 2, o.y + Math.sin(ang) * push));
        o.slowUntil = b.tick + 6; o.slow = 0.4;
        if (o.ship && b.rng.chance(0.5)) o.crew = Math.max(0, o.crew - b.rng.int(1, 3)); // hands swept off the deck
      }
      b.events.push({ type: 'ability', id: e.id, name: 'wave', x: t.x, y: t.y, radius: a.radius });
    }
    if (a.type === 'breath' && b.tick >= e.nextBreath && d < a.range) {
      // scalding steam or fire: everything ahead in a cone burns
      e.nextBreath = b.tick + a.every;
      for (const o of b.ents) {
        if (!o.alive || o.side === e.side || submerged(b, o)) continue;
        const dd = dist(e, o);
        if (dd > a.range || Math.abs(wrap(Math.atan2(o.y - e.y, o.x - e.x) - bearing)) > 0.5) continue;
        hurt(b, o, b.rng.int(a.maxHit >> 1, a.maxHit), e);
        if (o.alive && a.freeze) {
          // a breath of the far north: spray freezes on the rigging and the sea thickens round the hull
          o.slowUntil = b.tick + a.freeze.duration; o.slow = a.freeze.slow;
          if (o.ship) o.reload = o.reload.map((r) => r + 2);
          b.events.push({ type: 'frozen', id: o.id });
        } else if (o.alive && o.ship && !o.def.beast) {
          if (o.rig > 0.35) o.rig = Math.max(0.35, o.rig - 0.15); // sails and tarred rope go up
          o.dot = { until: b.tick + a.burn, from: b.tick, every: 3, dmg: a.burnDmg, by: e.id };
          b.events.push({ type: 'afire', id: o.id });
        }
      }
      b.events.push({ type: 'ability', id: e.id, name: 'breath', to: t.id, range: a.range, fire: !!a.fire, frost: !!a.freeze });
    }
    if (a.type === 'swallow' && b.tick >= e.nextSwallow && t.ship && d < 1.2 && t.maxHp <= a.maxHull && t.hp <= t.maxHp * a.below) {
      // small craft go down whole
      e.nextSwallow = b.tick + a.every;
      t.hp = 0; t.alive = false; t.swallowed = true; e.kills++;
      b.events.push({ type: 'swallowed', id: t.id, by: e.id }); b.events.push({ type: 'death', id: t.id });
      e.cd = Math.max(e.cd, 6); // it takes a moment to get a brig down
      return;
    }
    if (a.type === 'snare' && b.tick >= (e.nextSnare || 0) && t.ship && d < a.range) {
      // long arms round the rudder: she cannot turn, and can barely make way
      e.nextSnare = b.tick + a.every;
      t.rudderUntil = b.tick + a.duration; t.slowUntil = Math.max(t.slowUntil, b.tick + a.duration); t.slow = a.slow;
      b.events.push({ type: 'ability', id: e.id, name: 'snare', to: t.id });
    }
    if (a.type === 'charm' && b.tick >= e.nextCharm && t.ship && d < atk.range) {
      e.nextCharm = b.tick + a.every;
      t.charmUntil = b.tick + a.duration; t.charmBy = e.id;
      b.events.push({ type: 'ability', id: e.id, name: 'charm', to: t.id });
    }
  }
  if (e.cd <= 0 && d <= atk.range) {
    e.cd = atk.speed;
    const hit = b.rng.next() < atk.acc;
    // bone shears that treat iron plate like driftwood: armour does not count, and thick plate only makes it worse
    const pierce = e.def.abilities.find((a) => a.type === 'pierce');
    let dmg = hit ? Math.round(b.rng.int(pierce ? atk.maxHit >> 2 : 0, atk.maxHit) * (pierce ? ((t.def.armour || 0) >= pierce.plate ? pierce.mult : 1) : 100 / (100 + (t.def.armour || 0)))) : 0;
    for (const a of e.def.abilities) {
      // claws that shear a weakened hull in two; jaws that go mad at the scent of a wounded ship
      if (a.type === 'shear' && t.ship && t.hp < t.maxHp * a.below) dmg = Math.round(dmg * a.mult);
      if (a.type === 'frenzy' && t.hp < t.maxHp * a.below) { dmg = Math.round(dmg * a.mult); e.cd = Math.max(1, atk.speed - 1); }
      // hunters in a pack: each of its kind close by adds to the bite
      if (a.type === 'pack') { let n = 0; for (const o of b.ents) if (o !== e && o.alive && o.side === e.side && o.def.id === e.def.id && dist(e, o) < a.radius) n++; dmg = Math.round(dmg * (1 + a.bonus * Math.min(3, n))); }
    }
    if (atk.range > 4 && !atk.reach) {
      b.shots.push({ tick: b.tick + 2, from: e.id, to: t.id, dmg, hit, x: t.x, y: t.y });
      b.events.push({ type: 'shot', kind: 'spell', from: e.id, to: t.id, x0: e.x, y0: e.y, x1: t.x, y1: t.y, flight: 2, hit });
    } else {
      hurt(b, t, dmg, e);
      b.events.push({ type: 'bite', id: e.id, to: t.id });
    }
    for (const a of e.def.abilities) {
      if (a.type === 'grapple' && hit) { t.slowUntil = b.tick + a.duration; t.slow = a.slow; }
      // a bite that breaks a weakened ship's back: she goes down at once
      if (a.type === 'keelbreak' && hit && t.alive && t.ship && t.hp < t.maxHp * a.below && b.rng.chance(a.chance)) { t.hp = 0; t.alive = false; e.kills++; b.events.push({ type: 'keel', id: t.id, by: e.id }); b.events.push({ type: 'death', id: t.id }); }
      // oars snapped off along one side: a galley crawls
      if (a.type === 'oarbreak' && hit && t.ship && t.def.oars) { t.slowUntil = b.tick + a.duration; t.slow = a.slow; }
      // topmen snatched out of the rigging: fewer hands, and sail that nobody is left to trim
      if (a.type === 'leap' && hit && t.ship && b.rng.chance(a.chance)) { t.crew = Math.max(0, t.crew - b.rng.int(1, a.crew)); if (t.rig > 0.35) t.rig = Math.max(0.35, t.rig - 0.05); b.events.push({ type: 'ability', id: e.id, name: 'leap', to: t.id }); }
      // coils or arms round the hull: held, crushed a little every moment, and dragged down when nearly broken
      if (a.type === 'crush' && hit && t.ship && !t.dot) { t.dot = { until: b.tick + a.duration, from: b.tick, every: 2, dmg: a.dmg, by: e.id, grip: true, drag: a.drag || 0 }; t.gripBy = e.id; t.slowUntil = b.tick + a.duration; t.slow = 0.15; b.events.push({ type: 'ability', id: e.id, name: 'crush', to: t.id }); }
      // sailors washed or snatched off the deck
      if (a.type === 'overboard' && hit && t.ship && t.crew > 0 && b.rng.chance(a.chance)) { const n = Math.min(t.crew, b.rng.int(1, a.crew)); t.crew -= n; b.events.push({ type: 'ability', id: e.id, name: 'overboard', to: t.id, n }); }
      // a horn through the planking: she takes water until the hole is stopped
      if (a.type === 'breach' && hit && t.ship && !t.dot && dmg > a.over) { t.dot = { until: b.tick + a.duration, from: b.tick, every: 3, dmg: a.dmg, by: e.id }; b.events.push({ type: 'ability', id: e.id, name: 'breach', to: t.id }); }
      if (a.type === 'ink' && b.rng.chance(0.3)) { t.inkUntil = b.tick + a.duration; t.ink = a.accPenalty; b.events.push({ type: 'ability', id: e.id, name: 'ink', to: t.id }); }
    }
  }
}

function hurt(b, t, dmg, from) {
  if (!t.alive) return;
  t.hp -= dmg;
  if ((t.ship || t.fort) && dmg > 0) t.crew = Math.max(0, t.crew - Math.floor(dmg / 12 + (b.rng.chance(0.3) ? 1 : 0)));
  b.events.push({ type: 'hit', id: t.id, dmg });
  if (t.hp <= 0) {
    t.alive = false; t.hp = 0;
    if (from) from.kills++;
    b.events.push({ type: 'death', id: t.id });
  }
}

function resolveShots(b) {
  const keep = [];
  for (const s of b.shots) {
    if (s.tick > b.tick) { keep.push(s); continue; }
    const t = b.ents[s.to];
    if (s.hit && t.alive && !submerged(b, t)) {
      let dmg = s.dmg;
      const src = b.ents[s.from];
      // round shot passes through living water: only magic and other monsters truly hurt it
      if (t.def.shrugs && src && (src.ship || src.fort)) dmg = Math.round(dmg * t.def.shrugs);
      if (t.ship && !t.def.beast && src && src.ship && dmg > 0) {
        // raking fire down the length of the deck from ahead or astern does far more harm
        const ang = Math.abs(wrap(Math.atan2(src.y - t.y, src.x - t.x) - t.heading)) / DEG;
        if (ang < 24 || ang > 156) { dmg = Math.round(dmg * 1.6); t.crew = Math.max(0, t.crew - 1); if (b.tick !== t.rakedAt) { t.rakedAt = b.tick; b.events.push({ type: 'rake', id: t.id, by: src.id, stern: ang > 156 }); } }
        // shot aloft cuts up sails and rigging
        if (t.rig > 0.35 && b.rng.chance(0.12)) { t.rig = Math.max(0.35, t.rig - 0.1); if (t.rig <= 0.55 && !t.crippled) { t.crippled = true; b.events.push({ type: 'rigging', id: t.id }); } }
      }
      hurt(b, t, dmg, src);
      // holed below the waterline: she takes water for a while
      if (s.torpedo && t.alive && t.ship && !t.dot && dmg > 10) t.dot = { until: b.tick + 15, from: b.tick, every: 3, dmg: 5, by: s.from };
      if (s.grapple) { t.slowUntil = b.tick + s.grapple.duration; t.slow = s.grapple.slow; }
    } else b.events.push({ type: 'splash', x: s.x, y: s.y });
    if (s.splash) {
      const src = b.ents[s.from];
      for (const o of b.ents) {
        if (o === t || !o.alive || o.side === src.side || submerged(b, o)) continue;
        if (Math.hypot(o.x - s.x, o.y - s.y) - o.radius < s.splash) hurt(b, o, Math.floor(s.dmg * 0.5), src);
      }
      b.events.push({ type: 'blast', x: s.x, y: s.y, r: s.splash });
    }
  }
  b.shots = keep;
}

function separate(b) {
  const es = b.ents.filter((e) => e.alive);
  for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
    const a = es[i], c = es[j];
    if (submerged(b, a) || submerged(b, c)) continue;
    const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.radius + c.radius;
    if (d < min) {
      const wa = a.fort ? 0 : c.fort ? 1 : 0.5, wc = 1 - wa;
      const push = min - d;
      a.x -= (dx / d) * push * wa; a.y -= (dy / d) * push * wa;
      c.x += (dx / d) * push * wc; c.y += (dy / d) * push * wc;
    }
  }
}

// Ships touching hulls fight crew vs crew; a ship with no crew left is captured.
function boarding(b) {
  const ships = b.ents.filter((e) => e.alive && (e.ship || e.fort));
  for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
    const a = ships[i], c = ships[j];
    if (a.fort && c.fort) continue;
    if (a.side === c.side || dist(a, c) > (a.fort || c.fort ? 3 : 1.2)) continue;
    if (b.tick % 2) continue;
    const la = Math.max(0, Math.round(c.crew * 0.08 * b.rng.next() + b.rng.next()));
    const lc = Math.max(0, Math.round(a.crew * 0.08 * b.rng.next() + b.rng.next()));
    a.crew = Math.max(0, a.crew - la); c.crew = Math.max(0, c.crew - lc);
    b.events.push({ type: 'boarding', a: a.id, c: c.id });
    for (const [loser, winner] of [[a, c], [c, a]]) {
      if (loser.crew === 0 && winner.crew > 1) {
        const move = Math.floor(winner.crew / 3);
        winner.crew -= move; loser.crew = move; loser.side = winner.side;
        b.events.push({ type: 'captured', id: loser.id, by: winner.side });
      }
    }
  }
}

export function navalSummary(b) {
  const surv = [0, 1].map((s) => b.ents.filter((e) => e.alive && e.side === s && !e.fort).length);
  return { winner: b.winner, ticks: b.tick, survivors: surv, initial: b.sides.map((s) => s.initial) };
}
export function runNaval(b) { while (b.winner === null) stepNaval(b); return navalSummary(b); }

function fortTick(b, e) {
  if (e.cd > 0) e.cd--;
  const w = e.def.weapon;
  if (e.cd > 0 || e.crew <= 0) return;
  let best = null, bs = Infinity;
  for (const o of b.ents) {
    if (!o.alive || o.side === e.side || submerged(b, o)) continue;
    const d = dist(e, o);
    if (d > w.range || d < (w.minRange || 0)) continue;
    const s = d - (w.vsCreature && !o.ship && !o.fort ? 15 : 0) + (o.hp / o.maxHp) * 5;
    if (s < bs) { bs = s; best = o; }
  }
  if (!best) return;
  e.target = best.id;
  e.heading = Math.atan2(best.y - e.y, best.x - e.x);
  const crewEff = Math.max(0.3, e.crew / e.def.garrison);
  const shots = Math.max(1, Math.round(w.shots * crewEff));
  const mult = w.vsCreature && !best.ship && !best.fort ? w.vsCreature : 1;
  const dmg = [Math.round(w.dmg[0] * mult), Math.round(w.dmg[1] * mult)];
  for (let i = 0; i < shots; i++) shoot(b, e, best, dmg, w.acc, w.range, w.splash ? 'shell' : w.grapple ? 'harpoon' : 'cannon', 0, i / shots);
  e.cd = Math.round(w.reload / Math.min(1, crewEff + 0.3));
  b.events.push({ type: 'broadside', id: e.id, side: 0, guns: shots });
}
