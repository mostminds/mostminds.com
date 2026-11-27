// Capture the flag. Each side keeps a flag at the heart of its fort. A soldier on foot who
// reaches the enemy's flag takes it and runs for home; he scores when he brings it to his own
// flag stand while his own flag is there. Kill the carrier and the flag falls: the owners return
// it by touching it, the raiders pick it up again, and a flag left lying goes home by itself.
// The fallen come back in waves at their own fort for as long as the match lasts. First to
// `toWin` captures takes the day; at the time limit the higher score wins.
//
// scn.ctf = { bases: [{ x, y }, { x, y }], muster: [...], toWin, wave, lieFor }
//   wave      ticks between reinforcement waves        muster     where raiders form up, before each main gate
//   lieFor    ticks a dropped flag lies before it returns home
import { field, walk, attack, unitDist, nearestEnemyDist, addSquad, freeTileNear, occupy } from './battle.js';

const TOUCH = 1;      // tiles from a flag at which it can be taken, returned or scored
const GUARD_R = 6;    // how far the home guard strays from its flag
const RETURN_HOLD = 6;  // ticks an owner must stand by his fallen flag, with no raider at it, to send it home
const GUARD_SHARE = 0.32; // of a side holds its fort
const CHASE_R = 14;   // anyone this close to an enemy carrier goes for him

export function initCtf(b, scn) {
  const c = scn.ctf;
  if (!c || !c.bases || c.bases.length < 2) return;
  const flag = (side) => {
    const p = freeTileNear(b, c.bases[side].x, c.bases[side].y, 1, side) || [c.bases[side].x, c.bases[side].y];
    return { side, hx: p[0], hy: p[1], x: p[0], y: p[1], state: 'home', carrier: -1, since: 0 };
  };
  b.ctf = {
    flags: [flag(0), flag(1)], score: [0, 0], toWin: c.toWin || 3, wave: c.wave || 40, lieFor: c.lieFor || 120,
    fallen: [[], []], respawns: [0, 0], taken: [0, 0], returned: [0, 0],
  };
  b.ctf.muster = (c.muster || c.bases).map((m) => ({ x: m.x, y: m.y }));
  b.ctf.rally = (c.rally || c.bases).map((m) => ({ x: m.x, y: m.y }));
  b.ctf.ways = c.ways || null; // ways[side] = points outside each way into that side's fort
  b.ctf.routes = 0;
  // who raids and who stays: about a third hold the fort, shooters and healers first
  for (const side of [0, 1]) {
    const sqs = b.squads.filter((s) => s.side === side), total = sqs.reduce((n, s) => n + s.members.length, 0);
    const pref = (s) => (s.role === 'support' ? 0 : s.role === 'artillery' ? 1 : s.role === 'frontline' ? 2 : 3);
    let held = 0;
    for (const sq of sqs.slice().sort((a, c) => pref(a) - pref(c) || a.id - c.id)) {
      const fly = b.units[sq.members[0]]?.def.fly;
      if (!fly && pref(sq) < 3 && held + sq.members.length <= total * GUARD_SHARE + 2) { sq.ctf = 'guard'; held += sq.members.length; } else { sq.ctf = 'raid'; sq.way = b.ctf.routes++ % 3; }
    }
  }
}

/** a fallen soldier stands up again at his fort, whole and rearmed; he keeps his rank */
function revive(b, u, x, y) {
  const old = b.squads[u.squad];
  if (old) old.members = old.members.filter((id) => id !== u.id); // he joins a new squad with his wave
  u.alive = true; u.hp = u.def.hp; u.x = x; u.y = y; u.px = x; u.py = y;
  u.cd = b.rng.int(0, u.def.speed); u.poison = null; u.aboard = -1; u.pending = 0; u.flag = false; u.under = false;
  u.wayStep = 0; u.airTime = 0; u.seekLand = false; u.heals = 0; u.outSaid = false; u.fresh = b.tick; u.lives = (u.lives || 0) + 1;
  if (u.ammo !== undefined) u.ammo = 40;
  if (u.duty && u.spec !== 'vanguard') u.duty = null;
  occupy(b, u, 1);
}

const canCarry = (u) => u.alive && !u.def.fly && u.x >= 0 && u.aboard < 0 && (u.def.size || 1) <= 2;
const distTo = (u, x, y) => Math.max(Math.abs(u.x - x), Math.abs(u.y - y)) - ((u.def.size || 1) - 1);

function drop(b, f, why) {
  const u = b.units[f.carrier];
  if (u) u.flag = false;
  f.state = 'dropped'; f.carrier = -1; f.since = b.tick;
  b.events.push({ type: 'flagDropped', flag: f.side, x: f.x, y: f.y, why });
}
function sendHome(b, f, by) {
  f.state = 'home'; f.carrier = -1; f.x = f.hx; f.y = f.hy; f.since = b.tick;
  b.ctf.returned[f.side]++;
  b.events.push({ type: 'flagReturned', flag: f.side, by: by ? by.id : -1 });
}

/** once a tick: flags follow their carriers, change hands, score; reinforcements arrive */
export function ctfTick(b) {
  const c = b.ctf;
  if (!c) return;
  for (const f of c.flags) {
    if (f.state === 'carried') {
      const u = b.units[f.carrier];
      if (!u || !u.alive) { drop(b, f, 'killed'); continue; }
      if (u.x < 0 || u.aboard >= 0) { drop(b, f, 'lifted'); continue; } // lifted off the field: the flag stays behind
      f.x = u.x; f.y = u.y;
      // home with it?
      const own = c.flags[u.side];
      if (own.state === 'home' && distTo(u, own.hx, own.hy) <= TOUCH) {
        u.flag = false; u.captures = (u.captures || 0) + 1;
        c.score[u.side]++;
        f.state = 'home'; f.carrier = -1; f.x = f.hx; f.y = f.hy; f.since = b.tick;
        b.events.push({ type: 'flagCaptured', flag: f.side, by: u.id, side: u.side, score: c.score.slice() });
      }
      continue;
    }
    if (f.state === 'dropped' && b.tick - f.since > c.lieFor) { sendHome(b, f, null); continue; }
    // who is standing at it? owners return a dropped flag; raiders lift it
    let taker = null, owner = null, td = 9, od = 9;
    for (const u of b.units) {
      if (!canCarry(u)) continue;
      const d = distTo(u, f.x, f.y);
      if (d > TOUCH) continue;
      if (u.side === f.side) { if (d < od) { od = d; owner = u; } }
      else if (!u.flag && d < td) { td = d; taker = u; }
    }
    // a fallen flag goes to the next raider at hand; its owners must hold the spot clear for a few moments to send it home
    if (f.state === 'dropped' && owner && !taker) {
      f.held = (f.held || 0) + 1;
      if (f.held >= RETURN_HOLD) { f.held = 0; sendHome(b, f, owner); }
      continue;
    }
    f.held = 0;
    if (taker) {
      f.state = 'carried'; f.carrier = taker.id; f.since = b.tick; taker.flag = true;
      c.taken[taker.side]++;
      b.events.push({ type: 'flagTaken', flag: f.side, by: taker.id });
    }
  }
  // the fallen return in waves at their own fort
  if (b.tick % c.wave === 0) {
    for (const side of [0, 1]) {
      const list = c.fallen[side];
      if (!list.length) continue;
      const home = c.flags[side], fresh = [];
      let alive = 0, guards = 0;
      for (const u of b.units) if (u.alive && u.side === side) { alive++; if (b.squads[u.squad]?.ctf === 'guard') guards++; }
      alive += Math.min(list.length, 40);
      while (list.length && fresh.length < 40) {
        const u = list.shift(), def = u.def;
        // the home guard is kept up to strength first; the rest form up before the gate and go out again
        const guard = !def.fly && def.role !== 'skirmisher' && guards + fresh.filter((x) => x.ctfRole === 'guard').length < alive * GUARD_SHARE;
        const at = guard ? { x: home.hx, y: home.hy } : c.rally[side]; // inside the walls, by the main gate: no easy killing ground for the enemy
        let p = null;
        if (!def.fly) p = freeTileNear(b, at.x, at.y, def.size || 1, side);
        else p = [home.hx, home.hy];
        if (!p) { list.unshift(u); break; }
        revive(b, u, p[0], p[1]);
        u.ctfRole = guard ? 'guard' : 'raid';
        fresh.push(u); c.respawns[side]++;
      }
      // each kind forms up as its own squad; most go back out, some stay on the walls
      const byRole = new Map();
      for (const u of fresh) { const k = `${u.ctfRole}:${u.def.role}`; if (!byRole.has(k)) byRole.set(k, []); byRole.get(k).push(u); }
      for (const [k, us] of byRole) { const sq = addSquad(b, us); if (sq) { sq.ctf = k.split(':')[0]; sq.way = c.routes++ % 3; } }
      if (fresh.length) b.events.push({ type: 'reinforce', side, ids: fresh.map((u) => u.id) });
    }
  }
}

/** a soldier dies: his flag falls where he stood, and he joins the next wave */
export function ctfDeath(b, u) {
  const c = b.ctf;
  if (!c) return;
  for (const f of c.flags) if (f.state === 'carried' && f.carrier === u.id) drop(b, f, 'killed');
  u.flag = false;
  c.fallen[u.side].push(u);
}

const toward = (b, key, x, y, ttl) => field(b, key, ttl, () => [y * b.W + x]);

/** what the flag asks of this soldier this tick; true when it has used his turn */
export function ctfDuty(b, u) {
  const c = b.ctf;
  if (!c || u.x < 0 || u.aboard >= 0) return false;
  const own = c.flags[u.side], foe = c.flags[1 - u.side];
  // the carrier runs for home and does not stop to fight
  if (u.flag) {
    const d = distTo(u, own.hx, own.hy);
    if (d <= TOUCH) return false; // home, waiting for his own flag to come back: he fights where he stands
    const f = toward(b, `ctfh${u.side}`, own.hx, own.hy, 200);
    if (f) walk(b, u, f, 1, 1);
    return true;
  }
  // an enemy has our flag: everyone near him, and the whole home guard, runs him down
  if (own.state === 'carried') {
    const t = b.units[own.carrier];
    const sq = b.squads[u.squad];
    if (t && t.alive && (distTo(u, t.x, t.y) <= CHASE_R || (sq && sq.ctf === 'guard'))) {
      const reach = Math.max(1, u.def.range || 1);
      if (unitDist(u, t) <= reach && (u.def.fly || !t.def.fly)) {
        if (u.cd <= 0) attack(b, u, t);
        return true;
      }
      if (u.def.fly) return false; // fliers hunt by their own rules
      const f = toward(b, `ctfc${own.side}:${t.x},${t.y}`, t.x, t.y, 2);
      if (f) { walk(b, u, f, reach); return true; }
    }
  }
  if (u.def.fly) return false;
  const sq = b.squads[u.squad];
  const role = sq ? sq.ctf : 'raid';
  const threat = nearestEnemyDist(b, u, 7).d;
  // our flag lies on the ground: the nearest go and pick it up
  if (own.state === 'dropped' && (role === 'guard' || distTo(u, own.x, own.y) <= CHASE_R) && threat > 1) {
    const f = toward(b, `ctfd${own.side}:${own.x},${own.y}`, own.x, own.y, 30);
    if (f) { walk(b, u, f, 1, 1); return true; }
  }
  if (role === 'guard') {
    if (threat <= 7) return false; // someone to fight
    const d = distTo(u, own.hx, own.hy);
    if (d > GUARD_R) { const f = toward(b, `ctfh${u.side}`, own.hx, own.hy, 200); if (f) walk(b, u, f, 1, 3); }
    return true; // hold the walls
  }
  // raiders: fight what is in the way, otherwise make for the enemy's flag (or escort the man who has it)
  if (threat <= (u.def.style === 'melee' ? 1 : 2)) return false;
  if (foe.state === 'carried') {
    const t = b.units[foe.carrier];
    if (!t || t.side !== u.side) return false;
    if (distTo(u, t.x, t.y) <= 3) return threat > 7; // keep with him; fight if anything comes close
    const f = toward(b, `ctfe${u.side}:${t.x},${t.y}`, t.x, t.y, 3);
    if (f) { walk(b, u, f, 1, 2); return true; }
    return false;
  }
  // each raiding squad has its own way in: it passes the points of that route in turn before going for the flag
  const route = foe.state === 'home' && c.ways && sq && sq.way ? c.ways[foe.side][sq.way] : null;
  if (route && (u.wayStep || 0) < route.length) {
    const k = u.wayStep || 0, pt = route[k];
    if (distTo(u, pt.x, pt.y) <= 5) u.wayStep = k + 1;
    else { const fw = toward(b, `ctfw${foe.side}:${sq.way}:${k}`, pt.x, pt.y, 400); if (fw) { walk(b, u, fw, 1, 2); return true; } }
  }
  const f = toward(b, `ctff${foe.side}:${foe.x},${foe.y}`, foe.x, foe.y, 40);
  if (f) { walk(b, u, f, 1, 1); return true; }
  return false;
}

/** the winner under flag rules, or null while the game goes on */
export function ctfWinner(b, alive0, alive1) {
  const c = b.ctf, s = c.score;
  if (s[0] >= c.toWin || s[1] >= c.toWin) return s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1;
  const out = (side, alive) => alive === 0 && !c.fallen[side].length;
  const o0 = out(0, alive0), o1 = out(1, alive1);
  if (o0 && o1) return s[0] === s[1] ? -1 : s[0] > s[1] ? 0 : 1;
  if (o0) return 1;
  if (o1) return 0;
  // time: the higher score, then whoever laid hands on the other's flag more often
  if (b.tick >= b.maxTicks) return s[0] !== s[1] ? (s[0] > s[1] ? 0 : 1) : c.taken[0] !== c.taken[1] ? (c.taken[0] > c.taken[1] ? 0 : 1) : -1;
  return null;
}

/** tiles to deploy on: the fort's yard for those who hold it (front = false), the ground before its main gate for those who go out */
export function ctfSpawnTiles(b, scn, side, isFree, front = false) {
  const base = scn.ctf.bases[side], at = (front && scn.ctf.muster && scn.ctf.muster[side]) || base, R = front ? 20 : 12, tiles = [];
  for (let y = Math.max(1, at.y - R); y < Math.min(b.H - 1, at.y + R + 1); y++) for (let x = Math.max(1, at.x - R); x < Math.min(b.W - 1, at.x + R + 1); x++) {
    if (!isFree(x, y)) continue;
    const d = Math.max(Math.abs(x - at.x), Math.abs(y - at.y)), db = Math.max(Math.abs(x - base.x), Math.abs(y - base.y));
    if (db < 2) continue; // leave the flag stand clear
    if (front && Math.abs(x - base.x) < Math.abs(at.x - base.x) - 2) continue; // raiders form up outside the walls
    tiles.push({ i: y * b.W + x, k: (front ? Math.abs(x - at.x) * 3 + Math.abs(y - at.y) : d * 100 + Math.abs(y - at.y)) });
  }
  tiles.sort((a, c) => a.k - c.k);
  return tiles.map((t) => t.i);
}
