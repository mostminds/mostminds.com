// Fleet arts: what makes one realm's ship of a role unlike another's. Each working ship may carry a few arts
// (see the list in src/data/fleets/index.js); the sea engine calls the hooks below at the moments they matter:
//   aimMods     as a shot is aimed: accuracy and damage modifiers for the shooter's and target's arts
//   onHit       when a shot lands: fire, plague, poison, frost, terror, stun, acid, briars, beasts fleeing or turned
//   ramMods     when she rams: drill, blade, grapple, snare, a towing beast, a wedge of friends
//   boardMult   the weight of a crew in a boarding fight
//   artsTick    once a tick: auras round supply ships, sludge and lures round hunters, kegs, fire-ships, wakes
//   moveMul     her speed this tick (oars, the beam reach, a friendly wind)
const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, c) => Math.hypot(a.x - c.x, a.y - c.y) - a.radius - c.radius;
const A = (e) => (e && e.def && e.def.arts) || NONE;
const NONE = {};
const beast = (o) => !o.ship && !o.fort && !o.air;
const DIRECT = new Set(['cannon', 'heavy', 'chain', 'swivel', 'musket', 'beam', 'harpoon', 'torpedo']);

/** modifiers as a shot is aimed: { acc, dmg, armour } multipliers */
export function aimMods(b, e, t, kind) {
  const a = A(e), ta = A(t);
  let acc = 1, dmg = 1, armour = 1;
  if (DIRECT.has(kind)) {
    if (ta.lowProfile) acc *= 1 - ta.lowProfile;
    if (t.fogged > b.tick) acc *= 1 - t.fog;
  }
  if (a.wedge && e.ship) {
    let n = 0;
    for (const o of b.ents) if (o !== e && o.alive && o.ship && o.side === e.side && o.role === 'line' && Math.hypot(o.x - e.x, o.y - e.y) < 8) n++;
    acc *= 1 + Math.min(0.3, n * 0.06);
  }
  if (a.beam && (kind === 'beam' || kind === 'cannon' || kind === 'heavy')) armour *= 0.5;
  if (a.beastBane && beast(t) && (kind === 'harpoon' || kind === 'swivel')) dmg *= a.beastBane;
  if (a.swarm && beast(t) && kind === 'harpoon') {
    let n = 0;
    for (const o of b.ents) if (o !== e && o.alive && o.side === e.side && o.role === 'hunter' && Math.hypot(o.x - t.x, o.y - t.y) < 10) n++;
    dmg *= 1 + 0.15 * n;
  }
  if (a.breaker && t.fort && (kind === 'mortar' || kind === 'beam' || kind === 'heavy')) dmg *= a.breaker;
  if (t.noRegenUntil > b.tick) dmg *= 1.25; // wounds that will not close
  if (e.lulled > b.tick) acc *= 0.85;
  return { acc, dmg, armour };
}

/** when a shot lands on t (dmg already done) */
export function onHit(b, s, src, t, dmg) {
  if (!src || !t.alive || dmg <= 0) return;
  const a = A(src), dispelled = t.dispelled > b.tick;
  const R = b.rng;
  if (a.fireShot && (t.ship || t.fort) && !t.dot && R.chance(a.fireShot)) { t.dot = { until: b.tick + 15, from: b.tick, every: 3, dmg: 5, by: src.id }; b.events.push({ type: 'afire', id: t.id }); }
  if (a.incendiary && s.kind === 'mortar' && (t.ship || t.fort) && !t.dot) { t.dot = { until: b.tick + 18, from: b.tick, every: 3, dmg: t.fort ? 6 : 5, by: src.id }; b.events.push({ type: 'afire', id: t.id }); }
  if (a.plague && (t.ship || t.fort) && R.chance(a.plague)) { t.plagueUntil = b.tick + 30; b.events.push({ type: 'art', name: 'plague', id: t.id, by: src.id }); }
  if (a.fear && !dispelled && (t.ship || t.fort) && R.chance(a.fear)) { t.reload[0] += 3; t.reload[1] += 3; t.cd = (t.cd || 0) + 3; }
  if (a.terror && (t.ship || t.fort)) t.crew = Math.max(0, t.crew - R.int(0, a.terror));
  if (a.stun && (t.ship || t.fort) && s.kind === 'mortar') { t.reload[0] += a.stun; t.reload[1] += a.stun; t.cd = (t.cd || 0) + a.stun; b.events.push({ type: 'art', name: 'stun', id: t.id, by: src.id }); }
  if (a.acid && !t.dot && (s.kind === 'mortar' || s.kind === 'beam')) t.dot = { until: b.tick + 15, from: b.tick, every: 3, dmg: a.acid, by: src.id };
  if (a.briar && t.ship && s.kind === 'mortar') { t.slowUntil = b.tick + a.briar; t.slow = Math.min(t.slow || 1, 0.5); t.rig = Math.max(0.35, t.rig - 0.08); }
  if (t.air && s.kind === 'flak') {
    if (a.netting) { t.slowNet = b.tick + 8; }
    if (a.snipe && R.chance(a.snipe)) { t.hp = 0; t.alive = false; src.kills++; b.events.push({ type: 'death', id: t.id }); return null; }
    if (a.skyPoison && !t.dot) t.dot = { until: b.tick + 12, from: b.tick, every: 3, dmg: a.skyPoison, by: src.id };
  }
  if (beast(t)) {
    if (a.noRegen) t.noRegenUntil = b.tick + a.noRegen;
    if (a.poison && !t.dot) t.dot = { until: b.tick + 15, from: b.tick, every: 3, dmg: a.poison, by: src.id };
    if ((a.paralyze || a.freeze) && R.chance(0.35)) { t.slowUntil = b.tick + (a.paralyze || a.freeze); t.slow = 0.05; t.rudderUntil = b.tick + (a.paralyze || a.freeze); b.events.push({ type: 'art', name: a.freeze ? 'freeze' : 'paralyze', id: t.id, by: src.id }); }
    if (a.scare && R.chance(a.scare) && !(t.def.size >= 6 && R.chance(0.5))) { t.fleeUntil = b.tick + 24; b.events.push({ type: 'art', name: 'scare', id: t.id, by: src.id }); }
    if (a.dominate && s.kind === 'harpoon' && t.turnedUntil === undefined && R.chance(a.dominate)) {
      t.turnedUntil = b.tick + 24; t.trueSide = t.side; t.side = src.side; t.target = -1;
      b.events.push({ type: 'art', name: 'dominate', id: t.id, by: src.id });
    }
  }
  // a shot through one hull and into the next
  if (a.pierce && t.ship && (s.kind === 'cannon' || s.kind === 'heavy' || s.kind === 'beam') && !s.pierced && R.chance(a.pierce)) {
    const ax = t.x - src.x, ay = t.y - src.y, L = Math.hypot(ax, ay) || 1;
    let next = null, nd = 7;
    for (const o of b.ents) {
      if (o === t || !o.alive || o.side === src.side || o.air || !(o.ship || o.fort)) continue;
      const rx = o.x - t.x, ry = o.y - t.y, along = (rx * ax + ry * ay) / L, off = Math.abs(rx * ay - ry * ax) / L;
      if (along > 0 && along < nd && off < 1.5 + o.radius * 0.5) { nd = along; next = o; }
    }
    if (next) { b.events.push({ type: 'art', name: 'pierce', id: next.id, by: src.id, from: t.id }); return { also: next, dmg: Math.round(dmg * 0.5) }; }
  }
  return null;
}

/** her ram: damage, damage to herself, and what it does besides */
export function ramMods(b, e, t, dmg, self) {
  const a = A(e);
  if (a.drill) { dmg = Math.round(dmg * a.drill * (100 + (t.def.armour || 0)) / 100); if (!t.dot) t.dot = { until: b.tick + 18, from: b.tick, every: 3, dmg: 5, by: e.id }; }
  if (a.tow) dmg = Math.round(dmg * 1.33);
  if (a.wedge) {
    let n = 0;
    for (const o of b.ents) if (o !== e && o.alive && o.ship && o.side === e.side && o.role === 'line' && Math.hypot(o.x - e.x, o.y - e.y) < 8) n++;
    dmg = Math.round(dmg * (1 + Math.min(0.3, n * 0.06)));
  }
  if (a.blade || a.drill) self = 0;
  if (a.snare && t.alive) { t.rudderUntil = b.tick + a.snare; b.events.push({ type: 'art', name: 'snare', id: t.id, by: e.id }); }
  if (a.grapple && t.alive) lock(b, e, t);
  return { dmg, self };
}
function lock(b, e, t) {
  e.lockTo = t.id; e.lockUntil = b.tick + 14; t.lockTo = e.id; t.lockUntil = b.tick + 14;
  b.events.push({ type: 'art', name: 'grapple', id: t.id, by: e.id });
}
/** the arc she rams in (degrees either side of the bow) */
export const ramArc = (e) => (A(e).blade ? 60 : 35);

/** a crew's weight in a boarding fight: `att` is true for the side that came over the rail */
export function boardMult(b, e, foe) {
  const a = A(e);
  let m = 1;
  if (a.antiBoard) m *= a.antiBoard;
  if (a.boardBonus) m *= a.boardBonus;
  if (a.charge && foe && foe.fort) m *= a.charge;
  if (e.boardAura > b.tick) m *= 1 + e.boardAuraX;
  if (e.fearless > b.tick) m *= 1.25;
  if (e.lulled > b.tick) m *= 1 - e.lullX;
  return m;
}

/** her speed this tick */
export function moveMul(b, e, t) {
  const a = A(e);
  let m = 1;
  if (a.oars && t && Math.hypot(t.x - e.x, t.y - e.y) < 14) m *= 1.25;
  if (a.windRunner && b.wind) { const off = Math.abs(wrap(e.heading - b.wind.dir)) / DEG; if (off > 60 && off < 120) m *= 1.2; }
  if (e.windUntil > b.tick) m *= 1 + e.windX;
  if (e.lockUntil > b.tick) m *= 0.05;
  if (e.def.mul && e.def.mul.speed) m *= e.def.mul.speed;
  return m;
}

/** spells, breath, ink and charms against her */
export function magicMul(b, t) { return (t.dispelled > b.tick ? 0.6 : 1) * (1 - (A(t).magicWard || 0)); }
/** damage she takes after wards and her own fortifying */
export function wardMul(b, t) {
  let m = 1;
  if (t.wardUntil > b.tick) m *= 1 - t.wardX;
  const a = A(t);
  if (a.fortify && t.anchored) m *= 1 - a.fortify;
  return m;
}
/** a hull she cannot see until it is close */
export function hidden(b, e, by) {
  if (!A(e).stealth || !e.alive) return false;
  const near = b.ents.some((o) => o.alive && o.fort && o.side !== e.side && Math.hypot(o.x - e.x, o.y - e.y) < 8);
  return !near && !(by && Math.hypot(by.x - e.x, by.y - e.y) < 4);
}
export const ignoresIslands = (e) => !!A(e).phase;
export const hovers = (e) => !!(A(e).hover || A(e).phase);

/** once a tick */
export function artsTick(b) {
  const t = b.tick, R = b.rng;
  for (const e of b.ents) {
    if (!e.alive) {
      // a ship that goes down primed to burst
      if (e.ship && A(e).blast && !e.burst) {
        e.burst = true;
        for (const o of b.ents) if (o.alive && !o.air && Math.hypot(o.x - e.x, o.y - e.y) - o.radius < 5) hurtRaw(b, o, Math.round(A(e).blast * (o.side === e.side ? 0.5 : 1)), e);
        b.events.push({ type: 'art', name: 'blast', id: e.id, x: e.x, y: e.y });
      }
      // the dead rise to crew her side's ships
      if ((e.ship || e.fort) && !e.mourned) {
        e.mourned = true;
        for (const o of b.ents) {
          const r = A(o).reanimate;
          if (!r || !o.alive || o.side === e.side || Math.hypot(o.x - e.x, o.y - e.y) > (o.def.supply?.radius || 11)) continue;
          let gain = Math.round((e.def.crew || e.def.garrison || 10) * r);
          for (const f of b.ents) { if (gain <= 0) break; if (f.alive && f.ship && f.side === o.side && Math.hypot(f.x - o.x, f.y - o.y) < 14 && f.crew < f.def.crew) { const k = Math.min(gain, f.def.crew - f.crew); f.crew += k; gain -= k; } }
          b.events.push({ type: 'art', name: 'reanimate', id: o.id, from: e.id });
          break;
        }
      }
      continue;
    }
    const a = A(e);
    // a sickened crew dies off
    if (e.plagueUntil > t && t % 4 === 0 && e.crew > 1) e.crew--;
    // a beast turned against its own comes back to itself
    if (e.turnedUntil !== undefined && e.turnedUntil <= t && e.trueSide !== undefined) { e.side = e.trueSide; e.trueSide = undefined; e.target = -1; e.turnedUntil = t + 400; }
    // locked hulls stay together
    if (e.lockUntil > t) { const o = b.ents[e.lockTo]; if (o && o.alive) { const d = Math.hypot(o.x - e.x, o.y - e.y), min = e.radius + o.radius + 0.3; if (d > min) { e.x += ((o.x - e.x) / d) * (d - min) * 0.5; e.y += ((o.y - e.y) / d) * (d - min) * 0.5; } } }
    // a landing craft that hits the beach under a fort strikes the garrison at once
    if (a.beachKill && e.ship && !e.beached) for (const o of b.ents) if (o.alive && o.fort && o.side !== e.side && o.crew > 0 && dist(e, o) < 3) { e.beached = true; o.crew = Math.max(0, o.crew - a.beachKill); b.events.push({ type: 'art', name: 'beach', id: e.id, to: o.id }); break; }
    if (!e.ship || t % 4 !== 0) continue;
    // auras round a supply ship (and anything else that carries one)
    const r = e.def.supply?.radius || 11;
    if (a.ward || a.fog || a.regen || a.refill || a.spur || a.dispel || a.wind || a.boardAura || a.fearless) {
      for (const o of b.ents) {
        if (!o.alive || o.side !== e.side || o.air || Math.hypot(o.x - e.x, o.y - e.y) > r) continue;
        if (a.ward) { o.wardUntil = t + 5; o.wardX = a.ward; }
        if (a.fog) { o.fogged = t + 5; o.fog = a.fog; }
        if (a.regen && o.ship && o.hp < o.maxHp) o.hp = Math.min(o.maxHp, o.hp + a.regen);
        if (a.refill && o.ship && o.crew < o.def.crew) o.crew = Math.min(o.def.crew, o.crew + a.refill);
        if (a.spur && o.ship) o.spurred = t + 5;
        if (a.dispel) { o.dispelled = t + 5; o.inkUntil = Math.min(o.inkUntil, t); o.charmUntil = Math.min(o.charmUntil, t); }
        if (a.wind) { o.windUntil = t + 5; o.windX = a.wind; }
        if (a.boardAura) { o.boardAura = t + 5; o.boardAuraX = a.boardAura; }
        if (a.fearless) o.fearless = t + 5;
      }
    }
    if (a.lull) for (const o of b.ents) if (o.alive && o.side !== e.side && (o.ship || o.fort) && Math.hypot(o.x - e.x, o.y - e.y) < r && !(o.dispelled > t)) { o.lulled = t + 5; o.lullX = a.lull; if (t % 8 === 0) { o.reload[0]++; o.reload[1]++; } }
    // hunters' sludge and lures
    if (a.sludge) for (const o of b.ents) if (o.alive && beast(o) && o.side !== e.side && Math.hypot(o.x - e.x, o.y - e.y) < a.sludge) { o.inkUntil = t + 5; o.ink = 0.4; hurtRaw(b, o, 3, e); }
    if (a.lure) for (const o of b.ents) if (o.alive && beast(o) && o.side !== e.side && Math.hypot(o.x - e.x, o.y - e.y) < a.lure) o.lured = e.id;
    // a grabber hauls her tethered catch alongside and hacks at it
    if (a.grabber) for (const o of b.ents) if (o.alive && o.tether && o.tether.by === e.id) { const d = Math.hypot(o.x - e.x, o.y - e.y); if (d > e.radius + o.radius + 0.5) { o.x += ((e.x - o.x) / d) * 0.5; o.y += ((e.y - o.y) / d) * 0.5; } else hurtRaw(b, o, R.int(4, 12), e); }
  }
  // powder kegs on a parted harpoon line
  for (const e of b.ents) {
    if (!e.alive || !e.tether) continue;
    const by = b.ents[e.tether.by];
    if (by && A(by).kegs && (t >= e.tether.until - 1 || !by.alive)) { hurtRaw(b, e, A(by).kegs, by); b.events.push({ type: 'depthCharge', id: by.id, x: e.x, y: e.y }); }
  }
}
function hurtRaw(b, o, dmg, by) {
  if (!o.alive || dmg <= 0) return;
  o.hp -= dmg;
  b.events.push({ type: 'hit', id: o.id, dmg });
  if (o.hp <= 0) { o.hp = 0; o.alive = false; if (by) by.kills++; b.events.push({ type: 'death', id: o.id }); }
}

/** a fire-ship's run: returns an intent, and bursts her on contact */
export function fireshipIntent(b, e) {
  const a = A(e);
  if (!a.fireship) return null;
  let best = null, bs = Infinity;
  for (const o of b.ents) {
    if (!o.alive || o.side === e.side || !o.ship || o.air) continue;
    const d = Math.hypot(o.x - e.x, o.y - e.y);
    if (d > 30) continue;
    const s = d - o.def.len * 2;
    if (s < bs) { bs = s; best = o; }
  }
  if (!best) return null;
  if (dist(e, best) < 0.6) {
    for (const o of b.ents) if (o.alive && !o.air && o !== e && Math.hypot(o.x - e.x, o.y - e.y) - o.radius < 3.5) { hurtRaw(b, o, Math.round(a.fireship * (o.side === e.side ? 0.4 : 1)), e); if (o.alive && o.ship) o.dot = { until: t0(b) + 18, from: t0(b), every: 3, dmg: 6, by: e.id }; }
    b.events.push({ type: 'art', name: 'fireship', id: e.id, x: e.x, y: e.y });
    hurtRaw(b, e, e.hp + 1, null);
    return { desired: e.heading, speedMul: 0 };
  }
  return { desired: Math.atan2(best.y - e.y, best.x - e.x), speedMul: 1.2, target: best };
}
const t0 = (b) => b.tick;

/** a beast that has been scared off swims away from the nearest enemy hull */
export function fleeHeading(b, e) {
  if (!(e.fleeUntil > b.tick)) return null;
  let best = null, bd = Infinity;
  for (const o of b.ents) { if (!o.alive || o.side === e.side || !o.ship) continue; const d = Math.hypot(o.x - e.x, o.y - e.y); if (d < bd) { bd = d; best = o; } }
  return best ? Math.atan2(e.y - best.y, e.x - best.x) : null;
}
