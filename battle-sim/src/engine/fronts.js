// Fixed rally points, the teams that fight over them, generals, and the wounded.
//
// Every land battle has rally points at fixed places (scn.points, or a default pair a side).
// An attacking army's are fortified camps with siege weapons and stores; a defender's are lightly
// fortified posts where engineers raise what the fight calls for: guns against ships, against
// infantry, against fliers. A point changes hands when only the other side's soldiers have stood on
// it for a while. Part of each army is told off to hold its own points, the rest to take the
// enemy's, a named point each.
//
// Each side may have a general (or king, warboss, ...): one soldier of ordinary size and great
// strength who keeps to his headquarters. To win, a side must hold every rally point and the enemy
// general must be dead. (A side with nobody left has lost in any case.)
//
// The wounded: a soldier struck down may be left alive on the field. A medic goes to him, takes
// him up on a stretcher and carries him to an aid tent (raising one at the nearest rally point if
// there is none); after a while there he returns to the fight. Left too long, he dies.
import { field, walk, nearestEnemyDist, squadUnits, addSquad, freeTileNear, reviveUnit, walkable } from './battle.js';
import { addPoint, startBuild, finishBuild } from './command.js';
import { STRUCTURES } from '../data/structures.js';
import { isWater } from './terrain.js';

const HOLD_R = 4;       // tiles round a point that count as standing on it
const TAKE = 24;        // ticks of sole possession that turn a point
const BLEED = 260;      // ticks a wounded man lasts where he fell
const MEND = 50;        // ticks in the tent before he is fit again

/** the default points for a map that names none: two a side, each in its own ground */
function defaultPoints(b, scn) {
  const { W, H } = b, out = [];
  if (b.mode === 'amphibious') {
    // the landing force's are where it comes ashore; the defenders' are inland
    for (const fy of [0.34, 0.66]) {
      const y = Math.round(H * fy);
      let x = 2; while (x < W - 3 && isWater(b.terrain[y * W + x])) x++;
      out.push({ x: Math.min(W - 3, x + 3), y, side: 0, role: 'camp' });
    }
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < W * H; i += 3) if (!isWater(b.terrain[i])) { sx += i % W; sy += (i / W) | 0; n++; }
    const cx = n ? sx / n : W * 0.7, cy = n ? sy / n : H / 2;
    out.push({ x: Math.round(cx + W * 0.06), y: Math.round(cy - H * 0.14), side: 1, role: 'post' }, { x: Math.round(cx + W * 0.06), y: Math.round(cy + H * 0.14), side: 1, role: 'hq' });
  } else {
    for (const [fx, side] of [[0.15, 0], [0.85, 1]]) for (const fy of [0.3, 0.7]) out.push({ x: Math.round(W * fx), y: Math.round(H * fy), side, role: fy < 0.5 ? 'hq' : (b.sides[side].posture === 'defend' ? 'post' : 'camp') });
  }
  void scn;
  return out;
}

export function initFronts(b, scn) {
  if (scn.ctf || scn.fronts === false || !b.cmd || !b.units.length) return;
  const list = (scn.points && scn.points.length ? scn.points : defaultPoints(b, scn));
  const F = (b.fronts = { points: [], hq: [-1, -1], leader: [-1, -1], down: [], teamsAt: 0, lost: [false, false] });
  for (const sp of list) {
    const p = addPoint(b, sp.side, sp.role === 'camp' ? 'camp' : sp.role === 'hq' ? 'hq' : 'post', sp.x, sp.y);
    if (!p) continue;
    Object.assign(p, { fixed: true, home: sp.side, role: sp.role || 'post', cap: 0, stock: sp.stock ?? (sp.role === 'camp' ? 7 : 5), name: sp.name || null });
    F.points.push(p.id);
    if (sp.role === 'hq' || F.hq[sp.side] < 0) F.hq[sp.side] = p.id;
  }
  if (!F.points.length) { b.fronts = null; return; }
  for (const u of b.units) if (u.def.leader && F.leader[u.side] < 0) F.leader[u.side] = u.id;
  assignTeams(b);
}

const pt = (b, id) => b.cmd.points[id];
const fixedPoints = (b) => b.fronts.points.map((id) => pt(b, id));
const distTo = (u, p) => Math.max(Math.abs(u.x - p.x), Math.abs(u.y - p.y));

/** who holds and who goes: each fighting squad gets a named point */
function assignTeams(b) {
  const F = b.fronts, pts = fixedPoints(b);
  F.teamsAt = b.tick;
  // a battle that has gone quiet is pressed harder: fewer hold back each time nothing has fallen
  const alive = b.units.reduce((n, u) => n + (u.alive ? 1 : 0), 0);
  F.stall = alive === F.aliveWas ? (F.stall || 0) + 1 : 0;
  F.aliveWas = alive;
  for (const side of [0, 1]) {
    const own = pts.filter((p) => p.side === side), foe = pts.filter((p) => p.side !== side);
    const sqs = b.squads.filter((s) => s.side === side && s.alive > 0 && s.role !== 'air' && s.role !== 'siege');
    const fighting = sqs.filter((s) => s.role !== 'support');
    const quiet = Math.max(0, (F.stall || 0) - 2);
    const share = !foe.length ? 1 : !own.length ? 0 : b.sides[side].posture === 'defend' ? Math.max(0.3, 0.5 - quiet * 0.04) : Math.max(0.06, 0.22 - quiet * 0.05);
    // keep the guard up to strength first, on the headquarters before the outposts
    const total = fighting.reduce((n, s) => n + s.alive, 0);
    let held = fighting.filter((s) => s.front && s.front.kind === 'guard' && own.some((p) => p.id === s.front.point)).reduce((n, s) => n + s.alive, 0);
    const load = new Map();
    for (const s of fighting) if (s.front) load.set(s.front.point, (load.get(s.front.point) || 0) + s.alive);
    const order = own.slice().sort((a, c) => (c.id === F.hq[side]) - (a.id === F.hq[side]));
    // when the guard is over strength (the battle has gone quiet), its foot go out first and its shooters last
    if (held > total * share + 2) for (const s of fighting.filter((x) => x.front && x.front.kind === 'guard').sort((a, c) => (a.role === 'artillery') - (c.role === 'artillery') || c.id - a.id)) {
      if (held <= total * share + 2) break;
      held -= s.alive; load.set(s.front.point, (load.get(s.front.point) || 0) - s.alive); s.front = null;
    }
    // shooters are the first choice to hold a post
    for (const s of fighting.slice().sort((a, c) => (c.role === 'artillery') - (a.role === 'artillery') || a.id - c.id)) {
      const f = s.front;
      if (f && f.kind === 'guard' && own.some((p) => p.id === f.point)) continue;          // still holding its post
      if (f && f.kind === 'assault' && foe.some((p) => p.id === f.point)) continue;          // still going for its mark
      if (f && f.point >= 0) load.set(f.point, (load.get(f.point) || 0) - s.alive);
      // artillery and a share of the foot hold; the rest go out
      const wantGuard = own.length && (held < total * share || !foe.length);
      if (wantGuard) {
        const p = order.slice().sort((a, c) => (load.get(a.id) || 0) - (load.get(c.id) || 0) || (c.id === F.hq[side]) - (a.id === F.hq[side]))[0];
        s.front = { kind: 'guard', point: p.id }; held += s.alive; load.set(p.id, (load.get(p.id) || 0) + s.alive);
      } else if (foe.length) {
        const p = foe.slice().sort((a, c) => (Math.hypot(a.x - s.cx, a.y - s.cy) + (load.get(a.id) || 0) * 0.6) - (Math.hypot(c.x - s.cx, c.y - s.cy) + (load.get(c.id) || 0) * 0.6))[0];
        s.front = { kind: 'assault', point: p.id }; load.set(p.id, (load.get(p.id) || 0) + s.alive);
      } else s.front = { kind: 'hunt', point: -1 }; // every point is ours: find their general
    }
  }
}

/** once a tick: points change hands, teams are re-told, the wounded bleed or mend */
export function frontsTick(b) {
  const F = b.fronts;
  if (!F) return;
  if (b.tick % 4 === 0) {
    let turned = false;
    for (const p of fixedPoints(b)) {
      let mine = 0, theirs = 0;
      for (const u of b.units) {
        if (!u.alive || u.x < 0 || u.aboard >= 0 || u.def.fly || distTo(u, p) > HOLD_R) continue;
        if (u.side === p.side) mine++; else theirs++;
      }
      if (!mine && theirs >= 2) {
        p.cap += 4;
        if (p.cap >= TAKE) {
          const from = p.side;
          p.side = 1 - from; p.cap = 0; p.stock = Math.floor(p.stock / 2); p.since = b.tick;
          turned = true;
          b.events.push({ type: 'pointTaken', point: p.id, side: p.side, from, x: p.x, y: p.y, hq: p.id === F.hq[from] });
        }
      } else if (p.cap > 0) p.cap = Math.max(0, p.cap - 4);
    }
    if (turned || b.tick - F.teamsAt >= 24) assignTeams(b);
  }
  // the wounded
  for (let i = F.down.length - 1; i >= 0; i--) {
    const c = F.down[i], u = b.units[c.id];
    if (c.mendAt) {
      if (b.tick < c.mendAt) continue;
      const spot = freeTileNear(b, c.x, c.y, u.def.size || 1, u.side);
      if (!spot) { c.mendAt = b.tick + 5; continue; }
      reviveUnit(b, u, spot[0], spot[1], 0.5);
      u.down = null;
      const home = fixedPoints(b).filter((p) => p.side === u.side).sort((a, q) => distTo(u, a) - distTo(u, q))[0];
      const sq = addSquad(b, [u]);
      if (sq && home) sq.front = { kind: 'guard', point: home.id };
      F.down.splice(i, 1);
      b.events.push({ type: 'reinforce', side: u.side, ids: [u.id], recovered: true });
      continue;
    }
    if (c.bearer >= 0) {
      const m = b.units[c.bearer];
      if (m && m.alive && m.bearing === c.id) { c.x = m.x; c.y = m.y; continue; }
      // the bearer fell: the stretcher is set down where he stood
      c.bearer = -1; c.since = b.tick; u.x = c.x; u.y = c.y;
      b.events.push({ type: 'stretcherDown', id: c.id, dropped: true, x: c.x, y: c.y });
    }
    if (b.tick - c.since > BLEED) { F.down.splice(i, 1); u.down = null; b.events.push({ type: 'bledOut', id: c.id }); }
  }
}

const CARRIED = new Set(['humanoid', 'rider', 'skeleton', undefined]);
/** called when a soldier is struck down: true if he lies wounded rather than dead */
export function maybeDown(b, t, style) {
  const F = b.fronts;
  if (!F || t.def.fly || (t.def.size || 1) > 1 || t.def.leader || style === 'fall' || t.flag || !CARRIED.has(t.def.model?.body)) return false;
  if (F.down.length >= 40 || !b.units.some((m) => m.alive && m.side === t.side && m.spec === 'medic')) return false;
  if (!b.rng.chance(0.45)) return false;
  t.down = b.tick;
  F.down.push({ id: t.id, side: t.side, x: t.x, y: t.y, since: b.tick, bearer: -1, claim: -1, mendAt: 0 });
  return true;
}

const tentsOf = (b, side) => b.structures.map((s, i) => ({ s, i })).filter(({ s }) => !s.destroyed && s.side === side && (s.type === 'tent' || STRUCTURES[s.type].heals));
function around(b, s) {
  const out = [];
  for (let y = s.y - 1; y <= s.y + s.h; y++) for (let x = s.x - 1; x <= s.x + s.w; x++) if (x >= 0 && y >= 0 && x < b.W && y < b.H && walkable(b, x, y)) out.push(y * b.W + x);
  return out;
}
const gapTo = (u, s) => Math.max(s.x - u.x, u.x - (s.x + s.w - 1), s.y - u.y, u.y - (s.y + s.h - 1), 0);

/** a medic's work with the stretcher; true when it has used his turn */
export function stretcherDuty(b, u) {
  const F = b.fronts;
  if (!F || u.spec !== 'medic' || u.def.fly) return false;
  if (u.bearing !== undefined && u.bearing !== null) {
    const c = F.down.find((x) => x.id === u.bearing);
    if (!c || c.bearer !== u.id) { u.bearing = null; return false; }
    // to the nearest aid tent of our own
    const tents = tentsOf(b, u.side);
    if (tents.length) {
      const { s, i } = tents.sort((a, q) => gapTo(u, a.s) - gapTo(u, q.s))[0];
      if (gapTo(u, s) <= 1) {
        c.bearer = -1; c.mendAt = b.tick + MEND; c.x = u.x; c.y = u.y; u.bearing = null;
        b.events.push({ type: 'stretcherDown', id: c.id, medic: u.id, tent: i });
        return true;
      }
      const f = field(b, `tent${i}`, 200, () => around(b, s));
      if (f) walk(b, u, f, 1, 0);
      return true;
    }
    // none standing: carry him to the nearest rally point and raise one there
    const p = fixedPoints(b).filter((q) => q.side === u.side).sort((a, q) => distTo(u, a) - distTo(u, q))[0];
    if (!p) return false;
    if (distTo(u, p) > 3) { const f = field(b, `fp${p.id}`, 400, () => [p.y * b.W + p.x]); if (f) walk(b, u, f, 1, 2); return true; }
    let site = b.cmd.builds.find((x) => !x.done && x.type === 'tent' && x.side === u.side && x.point === p.id);
    if (!site) site = startBuild(b, u.side, p, 'tent', true);
    if (site) { site.progress++; if (site.progress >= site.work) finishBuild(b, site, u); }
    return true;
  }
  // find a wounded man nobody has gone for
  let best = null, bd = 34;
  for (const c of F.down) {
    if (c.side !== u.side || c.bearer >= 0 || c.mendAt) continue;
    if (c.claim >= 0 && c.claim !== u.id && b.units[c.claim] && b.units[c.claim].alive && b.tick - c.claimAt < 80) continue;
    const d = Math.max(Math.abs(c.x - u.x), Math.abs(c.y - u.y));
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return false;
  best.claim = u.id; best.claimAt = best.claimAt && best.claim === u.id ? best.claimAt : b.tick;
  if (bd <= 1) {
    best.bearer = u.id; u.bearing = best.id;
    b.events.push({ type: 'stretcherUp', id: best.id, medic: u.id });
    return true;
  }
  const f = field(b, `cas${best.id}:${best.x},${best.y}`, 60, () => [best.y * b.W + best.x]);
  if (!f || f[u.y * b.W + u.x] >= 32767) return false;
  walk(b, u, f, 1, 1);
  return true;
}

const toward = (b, p) => field(b, `fp${p.id}`, 400, () => [p.y * b.W + p.x]);

/** what his team's task asks of this soldier this tick; true when it has used his turn */
export function frontDuty(b, u) {
  const F = b.fronts;
  if (!F || u.x < 0 || u.aboard >= 0 || u.def.fly) return false;
  if (u.spec === 'medic' && stretcherDuty(b, u)) return true;
  const sq = b.squads[u.squad];
  if (sq && (sq.state === 'fallback' || sq.state === 'regroup')) return false;
  // the general keeps his headquarters, and moves to another point of his own if it falls
  if (u.def.leader) {
    let home = pt(b, F.hq[u.side]);
    if (!home || home.side !== u.side) home = fixedPoints(b).filter((p) => p.side === u.side).sort((a, q) => distTo(u, a) - distTo(u, q))[0];
    if (!home) return false;
    if (nearestEnemyDist(b, u, 6).d <= 6) return false;
    if (distTo(u, home) > 2) { const f = toward(b, home); if (f) walk(b, u, f, 1, 1); }
    return true;
  }
  const fr = sq && sq.front;
  if (!fr || fr.kind === 'hunt') return false;
  const p = pt(b, fr.point);
  if (!p) return false;
  const threat = nearestEnemyDist(b, u, 9).d, d = distTo(u, p);
  if (fr.kind === 'guard') {
    if (threat <= 9) return false;             // something to fight
    if (d > 5) { const f = toward(b, p); if (f) walk(b, u, f, 1, 3); }
    return true;                                // hold the post
  }
  // assault: fight what bars the way, otherwise make for the point and stand on it
  if (threat <= (u.def.style === 'melee' ? 2 : Math.max(2, (u.def.range || 2) - 1))) return false;
  if (d <= HOLD_R - 1) return threat > 9;       // on it: stay until it turns, unless there is someone to fight
  const f = toward(b, p);
  if (!f) return false;
  walk(b, u, f, 1, 2);
  return true;
}

/** the winner under these rules, or null while the battle goes on */
export function frontsWinner(b, alive0, alive1) {
  const F = b.fronts;
  if (alive0 === 0 && alive1 === 0) return -1;
  if (alive0 === 0) return 1;
  if (alive1 === 0) return 0;
  const pts = fixedPoints(b), held = [pts.filter((p) => p.side === 0).length, pts.filter((p) => p.side === 1).length];
  for (const side of [0, 1]) {
    const lead = b.units[F.leader[1 - side]];
    if (held[side] === pts.length && !(lead && lead.alive)) return side;
  }
  if (b.tick >= b.maxTicks) {
    // time: more points, then the general still standing
    if (held[0] !== held[1]) return held[0] > held[1] ? 0 : 1;
    const l0 = b.units[F.leader[0]], l1 = b.units[F.leader[1]], a0 = !!(l0 && l0.alive), a1 = !!(l1 && l1.alive);
    return a0 === a1 ? -1 : a0 ? 0 : 1;
  }
  return null;
}
void squadUnits;
