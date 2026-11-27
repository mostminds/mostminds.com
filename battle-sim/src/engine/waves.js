// Armies that come in waves, defenders spread over the places they hold, and landing craft that find
// their own way round the islands.
//
//   scn.sides[i].waves   how many waves the side's army comes in (the first is the strongest)
//   scn.waveEvery        ticks between waves
// Each later wave marches in from the side's own edge of the map with stores, or (a landing force) comes
// ashore in landing craft at the island it is to take next.
import { isWater, FORD } from './terrain.js';
import { spawnUnit, addSquad, freeTileNear, canStand, canStandAir, newCraft, CRAFT_CAPACITY, SQUAD_SIZE } from './battle.js';
import { addCrate } from './command.js';

/** a tile mask from run lengths (see encodeMask in data/worldgen.js) */
export function decodeMask(str, N) {
  const m = new Uint8Array(N);
  if (!str) return m;
  let i = 0, v = 0;
  for (const part of str.split(',')) { const n = parseInt(part, 36) || 0; if (v) m.fill(1, i, Math.min(N, i + n)); i += n; v ^= 1; }
  return m;
}

/** which island (or stretch of mainland) each dry tile belongs to; fords do not join them */
export function islands(b) {
  const { W, H } = b, N = W * H, id = new Int16Array(N).fill(-1), q = new Int32Array(N);
  let n = 0;
  for (let s = 0; s < N; s++) {
    if (id[s] >= 0 || isWater(b.terrain[s]) || b.terrain[s] === FORD) continue;
    let h = 0, t = 0; q[t++] = s; id[s] = n;
    while (h < t) {
      const i = q[h++], x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= N || id[j] >= 0 || isWater(b.terrain[j]) || b.terrain[j] === FORD) continue;
        id[j] = n; q[t++] = j;
      }
    }
    n++;
  }
  return id;
}

/** the army split into waves: each kind of soldier is spread over all of them, two fifths in the first */
export function splitWaves(pool, n) {
  const out = Array.from({ length: n }, () => []);
  const per = new Map();
  for (const d of pool) per.set(d.id, (per.get(d.id) || 0) + 1);
  const seen = new Map();
  for (const d of pool) {
    const m = per.get(d.id), k = seen.get(d.id) || 0, first = Math.ceil(m * 0.4);
    seen.set(d.id, k + 1);
    out[k < first || n === 1 ? 0 : 1 + ((k - first) % (n - 1))].push(d);
  }
  return out;
}

/** up to n free tiles round (x, y), nearest first, over ground a soldier can walk (decks and wall-walks too) */
export function tilesAround(b, x, y, n) {
  const { W, H } = b, start = Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x)), seen = new Uint8Array(W * H), q = [start], out = [];
  seen[start] = 1;
  for (let h = 0; h < q.length && out.length < n && h < 20000; h++) {
    const i = q[h], cx = i % W, cy = (i / W) | 0;
    if (!b.blockMove[i] && (!isWater(b.terrain[i]) || b.level[i]) && !b.occ[i]) out.push(i);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, j = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j]) continue;
      seen[j] = 1;
      if (b.blockMove[j] && b.door[j] < 0) continue;
      if (isWater(b.terrain[j]) && !b.level[j]) continue;
      if (Math.abs(b.level[j] - b.level[i]) > 1 && !b.ladder[i] && !b.ladder[j]) continue;
      q.push(j);
    }
  }
  return out;
}

/** The defenders start spread over the places they hold, more at the headquarters and the landings.
 * Each kind of soldier is shared out over the points; returns true when it placed them. */
export function spreadDefenders(b, scn, si, pool, fits, addUnit) {
  const pts = (scn.points || []).map((p, i) => ({ ...p, i })).filter((p) => p.side === si);
  if (pts.length < 2) return false;
  const weight = (p) => (p.role === 'hq' ? 3 : p.hub ? 1.5 : p.main ? 2 : 1);
  const total = pts.reduce((a, p) => a + weight(p), 0);
  const want = pts.map(() => []);
  const byDef = new Map();
  for (const d of pool) { if (!byDef.has(d.id)) byDef.set(d.id, []); byDef.get(d.id).push(d); }
  for (const list of byDef.values()) {
    // largest remainder: each point its share of this kind
    const exact = pts.map((p) => (list.length * weight(p)) / total), got = exact.map(Math.floor);
    let left = list.length - got.reduce((a, c) => a + c, 0);
    const order = exact.map((e, k) => [e - got[k], k]).sort((a, c) => c[0] - a[0]);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) got[order[k][1]]++;
    let at = 0;
    got.forEach((n, k) => { for (let j = 0; j < n; j++) want[k].push(list[at++]); });
  }
  pts.forEach((p, k) => {
    const defs = want[k];
    if (!defs.length) return;
    const tiles = tilesAround(b, p.x, p.y, defs.length * 3 + 12);
    let t = 0;
    for (const def of defs) {
      let placed = false;
      for (let tt = t; tt < tiles.length; tt++) {
        const x = tiles[tt] % b.W, y = (tiles[tt] / b.W) | 0;
        if (!fits(def, x, y, si)) continue;
        const u = addUnit(def, si, x, y); u.home = p.i; placed = true;
        if (tt === t) t++;
        break;
      }
      if (!placed) { const s = freeTileNear(b, p.x, p.y, def.size || 1, si); if (s && fits(def, s[0], s[1], si)) { const u = addUnit(def, si, s[0], s[1]); u.home = p.i; } }
    }
  });
  return true;
}

// ---------- landing craft that find their own way ----------
/** distance over open water to the shore at (gx, gy), for steering boats; fords count as land */
export function waterField(b, gx, gy) {
  const key = `wf${gx},${gy}`;
  b.waterFields ||= new Map();
  if (b.waterFields.has(key)) return b.waterFields.get(key);
  const { W, H } = b, N = W * H, f = new Uint16Array(N).fill(65535), q = new Int32Array(N);
  let h = 0, t = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = gx + dx, y = gy + dy, i = y * W + x; if (x >= 0 && y >= 0 && x < W && y < H && isWater(b.terrain[i]) && f[i] === 65535) { f[i] = 1; q[t++] = i; } }
  while (h < t) {
    const i = q[h++], x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W, x > 0 ? i - W - 1 : -1, x < W - 1 ? i - W + 1 : -1, x > 0 ? i + W - 1 : -1, x < W - 1 ? i + W + 1 : -1]) {
      if (j < 0 || j >= N || f[j] !== 65535 || !isWater(b.terrain[j])) continue;
      f[j] = f[i] + 1; q[t++] = j;
    }
  }
  b.waterFields.set(key, f);
  return f;
}

/** a stretch of beach on an island's seaward side, near (x, y) */
function beachNear(b, x, y, isle) {
  const { W, H } = b;
  let best = null, bd = Infinity;
  for (let yy = Math.max(1, y - 30); yy < Math.min(H - 1, y + 30); yy++) for (let xx = Math.max(1, x - 40); xx < Math.min(W - 1, x + 30); xx++) {
    const i = yy * W + xx;
    if (isWater(b.terrain[i]) || b.terrain[i] === FORD || b.blockMove[i] || (isle >= 0 && b.isle[i] !== isle)) continue;
    if (!isWater(b.terrain[i - 1]) && !isWater(b.terrain[i - W]) && !isWater(b.terrain[i + W])) continue;
    const d = Math.hypot(xx - x, yy - y) + Math.max(0, xx - x) * 0.6; // the side facing the open sea is best
    if (d < bd) { bd = d; best = [xx, yy]; }
  }
  return best;
}

/** where this wave of boats should go ashore: the islands the enemy still holds, nearest first */
function landingGoals(b, side) {
  const F = b.fronts;
  if (!F || !b.isle) return [];
  const pts = F.points.map((id) => b.cmd.points[id]);
  const theirs = pts.filter((p) => p.side !== side);
  const isleOf = (p) => b.isle[p.y * b.W + p.x];
  const byIsle = new Map();
  for (const p of theirs) { const k = isleOf(p); if (k < 0) continue; if (!byIsle.has(k)) byIsle.set(k, []); byIsle.get(k).push(p); }
  // the westernmost first: the islands before the mainland
  const order = [...byIsle.entries()].map(([k, ps]) => ({ k, x: Math.min(...ps.map((p) => p.x)), ps })).sort((a, c) => a.x - c.x);
  const goals = [];
  for (const o of order.slice(0, 2)) {
    const beach = pts.find((p) => p.home === side && isleOf(p) === o.k) || o.ps.sort((a, c) => a.x - c.x)[0];
    const g = beachNear(b, beach.x, beach.y, o.k);
    if (g) goals.push(g);
  }
  return goals;
}

/** boats for this many soldiers, from the western edge to the goals; the soldiers go aboard */
export function craftWave(b, side, defs, onUnit) {
  const goals = landingGoals(b, side);
  if (!goals.length) return false;
  const { W, H } = b, walkers = defs.filter((d) => !d.fly && (d.size || 1) <= 2), fliers = defs.filter((d) => d.fly || (d.size || 1) > 2);
  const n = Math.ceil(walkers.length / CRAFT_CAPACITY);
  let p = 0;
  for (let c = 0; c < n; c++) {
    const g = goals[c % goals.length], lane = Math.floor(c / goals.length), spread = 3 * (lane % 7) * (lane % 2 ? 1 : -1);
    let sy = Math.max(3, Math.min(H - 4, g[1] + spread)), sx = 1;
    while (sx < 6 && !isWater(b.terrain[sy * W + sx])) sx++;
    const craft = newCraft(b, side, sx - Math.floor(lane / 7) * 3, sy, g[0], g[1]);
    craft.wf = waterField(b, g[0], g[1]); craft.supplies = 3;
    for (let k = 0; k < CRAFT_CAPACITY && p < walkers.length; k++, p++) {
      const u = spawnUnit(b, walkers[p], side, -1, -1);
      u.aboard = craft.id; u.x = u.px = craft.x | 0; u.y = u.py = craft.y; craft.passengers.push(u.id);
      onUnit(u);
    }
  }
  // the beasts and fliers make their own way over the water
  for (const def of fliers) {
    const g = goals[0];
    const spot = def.fly ? [2, Math.max(2, Math.min(H - 3, g[1]))] : freeTileNear(b, g[0], g[1], def.size || 1, side);
    if (!spot || !(def.fly ? canStandAir(b, spot[0], spot[1], def.size, -1) : canStand(b, spot[0], spot[1], def.size, -1, side))) continue;
    onUnit(spawnUnit(b, def, side, spot[0], spot[1]));
  }
  return true;
}

/** the side's own edge of the map, level with its headquarters */
function homeAnchor(b, side) {
  const F = b.fronts, { W, H } = b;
  const hq = F && b.cmd.points[F.hq[side]];
  const y = Math.max(2, Math.min(H - 3, hq ? hq.y : H >> 1));
  if (side === 0) { for (let x = 1; x < W / 2; x++) if (canStand(b, x, y, 1, -1, side)) return [x, y]; }
  else for (let x = W - 2; x > W / 2; x--) if (canStand(b, x, y, 1, -1, side)) return [x, y];
  return hq ? [hq.x, hq.y] : [side === 0 ? 2 : W - 3, y];
}

/** once a tick: a wave that is due comes on */
export function wavesTick(b) {
  if (!b.reserve) return;
  for (const side of [0, 1]) {
    const R = b.reserve[side];
    if (!R || !R.length || R[0].at > b.tick) continue;
    const w = R.shift(), fresh = [];
    b.sides[side].initial -= w.defs.length; // they were counted from the start; spawning counts them again
    const add = (u) => fresh.push(u);
    let done = false;
    if (b.mode === 'amphibious' && side === 0) done = craftWave(b, side, w.defs, add);
    if (!done) {
      const [ax, ay] = homeAnchor(b, side);
      const tiles = (() => { const t = []; for (let r = 0; r < 4 && t.length < w.defs.length * 2; r++) for (const i of tilesAround(b, ax, ay, w.defs.length * 3 + 20)) t.push(i); return t; })();
      let t = 0;
      for (const def of w.defs) {
        for (let tt = t; tt < tiles.length; tt++) {
          const x = tiles[tt] % b.W, y = (tiles[tt] / b.W) | 0;
          if (!(def.fly ? canStandAir(b, x, y, def.size, -1) : canStand(b, x, y, def.size, -1, side))) continue;
          add(spawnUnit(b, def, side, x, y));
          if (tt === t) t++;
          break;
        }
      }
      // they bring their stores with them
      for (const dy of [-3, 3]) addCrate(b, side, ax + (side === 0 ? 4 : -4), ay + dy, 3);
    }
    const lost = w.defs.length - fresh.length;
    if (lost > 0) b.sides[side].initial -= 0; // those that found no room simply do not come
    // into squads by kind (and by boat)
    const groups = new Map();
    for (const u of fresh) { const k = `${u.def.id}:${u.aboard >= 0 ? Math.floor(u.aboard / 2) : 'l'}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
    for (const list of groups.values()) for (let k = 0; k < list.length; k += SQUAD_SIZE) addSquad(b, list.slice(k, k + SQUAD_SIZE), b.sides[side].posture === 'defend' ? 'hold' : 'advance');
    if (b.fronts) b.fronts.teamsAt = -99; // tell them where to go at once
    b.events.push({ type: 'reinforce', side, ids: fresh.map((u) => u.id), wave: b.sides[side].wave = (b.sides[side].wave || 1) + 1, landing: b.mode === 'amphibious' && side === 0 });
  }
}

/** soldiers still to come for this side */
export const reserveCount = (b, side) => (b.reserve && b.reserve[side] ? b.reserve[side].reduce((n, w) => n + w.defs.length, 0) : 0);
