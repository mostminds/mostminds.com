// Continuous-space naval battle: ships fire broadsides, board each other,
// and fight sea creatures. Shares the 0.6s tick with land battles.
import { createRng } from './rng.js';
import { SHIPS, CREATURES } from '../data/naval.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createNaval(scn, seed = 1, defs = { SHIPS, CREATURES }) {
  const W = scn.width || 140, H = scn.height || 90;
  const b = {
    W, H, tick: 0, rng: createRng(seed), ents: [], shots: [], events: [], winner: null,
    maxTicks: scn.maxTicks || 2500, islands: scn.islands || [],
    sides: scn.sides.map((s, i) => ({ name: s.name || `Side ${i + 1}`, initial: 0 })),
  };
  scn.sides.forEach((side, si) => {
    const list = [];
    for (const g of side.groups || []) {
      const def = defs.SHIPS[g.unit] || defs.CREATURES[g.unit];
      if (!def) continue;
      for (let k = 0; k < Math.min(g.count, 60); k++) list.push(def);
    }
    const cols = Math.ceil(Math.sqrt(list.length * 0.6)) || 1;
    list.forEach((def, k) => {
      const col = k % cols, row = Math.floor(k / cols);
      const x = si === 0 ? 10 + row * 8 : W - 10 - row * 8;
      const y = H / 2 + (col - (cols - 1) / 2) * 10;
      addEnt(b, def, si, x + b.rng.next() * 2, Math.max(4, Math.min(H - 4, y + b.rng.next() * 2)));
    });
  });
  return b;
}

function addEnt(b, def, side, x, y) {
  const ship = !!def.hull;
  const e = {
    id: b.ents.length, side, def, ship, x, y, px: x, py: y,
    heading: side === 0 ? 0 : Math.PI, ph: side === 0 ? 0 : Math.PI,
    hp: ship ? def.hull : def.hp, maxHp: ship ? def.hull : def.hp, crew: ship ? def.crew : 0,
    alive: true, reload: [b.rng.int(0, 4), b.rng.int(0, 4)], cd: b.rng.int(0, 3), target: -1,
    slowUntil: 0, slow: 1, inkUntil: 0, ink: 0, charmUntil: 0, charmBy: -1, subUntil: 0, nextSub: 0,
    nextSweep: 0, nextRam: 0, nextCharm: 0, radius: ship ? def.len / 2 : (def.size || 1) * 0.7, kills: 0,
  };
  b.ents.push(e);
  b.sides[side].initial++;
}

export function stepNaval(b) {
  if (b.winner !== null) return;
  b.tick++;
  b.events = [];
  for (const e of b.ents) { e.px = e.x; e.py = e.y; e.ph = e.heading; }
  for (const e of b.ents) if (e.alive) (e.ship ? shipTick : creatureTick)(b, e);
  separate(b);
  resolveShots(b);
  boarding(b);
  const alive = [0, 1].map((s) => b.ents.some((e) => e.alive && e.side === s));
  if (!alive[0] && !alive[1]) b.winner = -1;
  else if (!alive[0]) b.winner = 1;
  else if (!alive[1]) b.winner = 0;
  else if (b.tick >= b.maxTicks) b.winner = -1;
  if (b.winner !== null) b.events.push({ type: 'end', winner: b.winner });
}

const submerged = (b, e) => !e.ship && b.tick < e.subUntil;
const dist = (a, c) => Math.hypot(a.x - c.x, a.y - c.y) - a.radius - c.radius;

function chooseTarget(b, e) {
  let best = null, bs = Infinity;
  for (const o of b.ents) {
    if (!o.alive || o.side === e.side || submerged(b, o)) continue;
    const d = Math.hypot(o.x - e.x, o.y - e.y);
    const s = d + (o.hp / o.maxHp) * 15;
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
    const dx = e.x - isl.x, dy = e.y - isl.y, d = Math.hypot(dx, dy);
    const clear = isl.r + e.radius + 4;
    if (d < clear) { ax += (dx / d) * (clear - d) * 0.5; ay += (dy / d) * (clear - d) * 0.5; }
  }
  desired = Math.atan2(ay, ax);
  const turn = (e.ship ? e.def.turn : 14) * DEG;
  const diff = wrap(desired - e.heading);
  e.heading = wrap(e.heading + Math.max(-turn, Math.min(turn, diff)));
  let spd = e.def.speed * speedMul * (b.tick < e.slowUntil ? e.slow : 1);
  if (e.ship) spd *= 0.35 + 0.65 * Math.max(0.25, e.crew / e.def.crew); // short-handed ships are slow
  if (submerged(b, e)) spd *= 1.4;
  e.x += Math.cos(e.heading) * spd;
  e.y += Math.sin(e.heading) * spd;
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
  const boarder = e.crew > (t.crew || 0) * 1.6 && t.ship && e.crew >= 8;
  if (boarder && d < range * 1.2) {
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
  steer(b, e, desired);
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
  p *= Math.min(1.3, 0.75 + t.radius * 0.15);
  if (b.tick < e.inkUntil) p *= 1 - e.ink;
  const hit = b.rng.next() < p;
  let dm = hit ? b.rng.int(dmg[0], dmg[1]) : 0;
  const armour = t.ship ? t.def.armour : t.def.armour;
  dm = Math.round(dm * (100 / (100 + armour)));
  const flight = 1 + Math.floor(d / 7);
  // miss lands somewhere near the target
  const mx = t.x + (hit ? 0 : (b.rng.next() - 0.5) * 6), my = t.y + (hit ? 0 : (b.rng.next() - 0.5) * 6);
  // cannon origin along the hull
  const along = (offset - 0.5) * e.def.len * 0.7;
  const ox = e.x + Math.cos(e.heading) * along, oy = e.y + Math.sin(e.heading) * along;
  b.shots.push({ tick: b.tick + flight, from: e.id, to: t.id, dmg: dm, hit, x: mx, y: my });
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
  steer(b, e, want, d < atk.range * 0.7 && atk.range <= 4 ? 0.2 : 1);
  if (submerged(b, e)) return;

  for (const a of e.def.abilities) {
    if (a.type === 'ram' && b.tick >= e.nextRam && d < 1) {
      e.nextRam = b.tick + a.cooldown;
      hurt(b, t, Math.round(a.damage * (100 / (100 + (t.def.armour || 0)))), e);
      b.events.push({ type: 'ability', id: e.id, name: 'ram', to: t.id });
    }
    if (a.type === 'sweep' && b.tick >= e.nextSweep && d < a.radius) {
      e.nextSweep = b.tick + a.every;
      for (const o of b.ents) if (o.alive && o.side !== e.side && dist(e, o) < a.radius) hurt(b, o, b.rng.int(0, a.maxHit), e);
      b.events.push({ type: 'ability', id: e.id, name: 'sweep', radius: a.radius });
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
    const dmg = hit ? Math.round(b.rng.int(0, atk.maxHit) * (100 / (100 + (t.def.armour || 0)))) : 0;
    if (atk.range > 4) {
      b.shots.push({ tick: b.tick + 2, from: e.id, to: t.id, dmg, hit, x: t.x, y: t.y });
      b.events.push({ type: 'shot', kind: 'spell', from: e.id, to: t.id, x0: e.x, y0: e.y, x1: t.x, y1: t.y, flight: 2, hit });
    } else {
      hurt(b, t, dmg, e);
      b.events.push({ type: 'bite', id: e.id, to: t.id });
    }
    for (const a of e.def.abilities) {
      if (a.type === 'grapple' && hit) { t.slowUntil = b.tick + a.duration; t.slow = a.slow; }
      if (a.type === 'ink' && b.rng.chance(0.3)) { t.inkUntil = b.tick + a.duration; t.ink = a.accPenalty; b.events.push({ type: 'ability', id: e.id, name: 'ink', to: t.id }); }
    }
  }
}

function hurt(b, t, dmg, from) {
  if (!t.alive) return;
  t.hp -= dmg;
  if (t.ship && dmg > 0) t.crew = Math.max(0, t.crew - Math.floor(dmg / 12 + (b.rng.chance(0.3) ? 1 : 0)));
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
    if (s.hit && t.alive && !submerged(b, t)) hurt(b, t, s.dmg, b.ents[s.from]);
    else b.events.push({ type: 'splash', x: s.x, y: s.y });
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
      const push = (min - d) / 2;
      a.x -= (dx / d) * push; a.y -= (dy / d) * push;
      c.x += (dx / d) * push; c.y += (dy / d) * push;
    }
  }
}

// Ships touching hulls fight crew vs crew; a ship with no crew left is captured.
function boarding(b) {
  const ships = b.ents.filter((e) => e.alive && e.ship);
  for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) {
    const a = ships[i], c = ships[j];
    if (a.side === c.side || dist(a, c) > 1.2) continue;
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
  const surv = [0, 1].map((s) => b.ents.filter((e) => e.alive && e.side === s).length);
  return { winner: b.winner, ticks: b.tick, survivors: surv, initial: b.sides.map((s) => s.initial) };
}
export function runNaval(b) { while (b.winner === null) stepNaval(b); return navalSummary(b); }
