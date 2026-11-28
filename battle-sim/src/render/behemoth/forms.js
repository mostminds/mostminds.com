// The ten behemoth forms: each lays down the body (hull, rock, walls, tiers) and its main buildings, and tells the
// rest of the builder where things can go: X.yAt(x, z) the deck height, X.underY(x, z) the underside, X.rim (points
// round the deck edge [x, y, z, nx, nz, angle]), X.pads (free spots), X.extent [half length, half beam], X.keel (a
// line under the belly for doors, pods and bells), X.top (the highest point), crew slots on the decks.
import * as THREE from 'three';
import { noise3 } from '../sculpt.js';
import { nacelleGeo, propGeo } from '../sky/carved.js';
import { figureSculptGeo } from '../parts/bow.js';
import { styleOf as shipStyle } from '../parts/realmStyle.js';
import {
  PI, TAU, lin, clamp, lerp, h1, hexMix, hexShade, piece, place, building, wallRun, rockBase, padsFrom, take, reserve,
  envelope, rigging, waterfall, mist, vortex, lightPillar, bannerAt, astrolabe, finialAt, flowMat, merlons,
} from './build.js';
import { prismGeo, hullGeo, deckGeo, hullHalfBeam, hullPt, cap, band, cutAfter, tubeGeo, ringGeo, rockGeo, levels } from './surf.js';
import * as PC from './pieces.js';

const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const pat = (X, p, col, col2, o = {}) => ({ pat: p, col: lin(col), col2: lin(col2 ?? hexShade(col, 0.75)), seed: X.seed, ...o });

/** the rim of an ellipse (for built bases) */
function ellipseRim(X, rx, rz, y = 0) {
  X.rim = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU, x = Math.cos(a) * rx, z = Math.sin(a) * rz, l = Math.hypot(x / rx ** 2, z / rz ** 2) || 1; X.rim.push([x, y, z, x / rx ** 2 / l, z / rz ** 2 / l, a]); }
}
/** a bowl keel under a built deck (stone, plate or timber), rx x rz, depth; deck at y = 0 */
function bowlBase(X, rx, rz, depth, P, o = {}) {
  const prof = [[1.0, 0, 0.0, 'floor'], [1.02, 0, -0.1, 'trim'], [1.02, 0, -0.5, 'trim'], [1.0, 0, -0.6, 'wall'], [0.96, 0, -depth * 0.3, 'wall', undefined, 's'], [0.84, 0, -depth * 0.55, 'wall', undefined, 's'], [0.62, 0, -depth * 0.8, 'wall', undefined, 's'], [0.32, 0, -depth * 0.96, 'wall', undefined, 's'], [0, 0, -depth, 'wall', undefined, 's']];
  const spec = { plan: o.plan || 'circle', w: rx * 2, d: rz * 2, n: o.n, corner: o.corner ?? 2, prof: [[0, 0, 0.02, 'floor'], ...prof], mats: { floor: X.pat.floor, trim: X.pat.trim, wall: P }, dens: 6, seed: X.seed, holes: true };
  const key = `bowl|${X.fid}|${rx.toFixed(1)}|${rz.toFixed(1)}|${depth.toFixed(1)}|${o.plan || 'c'}`;
  const m = piece(X, prismGeo(key, spec, 0), X.I, [0, 0, 0], [0, 0, 0], 1);
  X.skins.push({ ent: m.userData.lodEntry, make: (lv) => prismGeo(key, spec, lv) });
  X.yAt = () => 0;
  X.underY = (x, z) => { const r = Math.hypot(x / rx, z / rz); return -depth * Math.pow(Math.max(0, 1 - r * r), 0.5) - 0.3; };
  X.extent = [rx, rz];
  ellipseRim(X, rx, rz, 0);
  X.rock = { at: [0, 0, 0] };
  padsFrom(X, 0.86, 1.4, 99);
  // the keel band of metal straps round the bowl
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; void a; }
  return m;
}
/** crew slots on a flat area */
function slotsIn(X, x0, x1, z0, z1, y, step = 1.1) { for (let x = x0; x <= x1; x += step) for (let z = z0; z <= z1; z += step) X.crewSlots.push([+x.toFixed(2), y + 0.01, +z.toFixed(2)]); }

// =============================================================================================
// AIRSHIP: a great hull under one or more envelopes
// =============================================================================================
function airship(X) {
  const L = X.L, HL = L * 0.66, HB = L * 0.19, HD = L * 0.13;
  const plated = X.kw('iron', 'steel', 'armour', 'riveted') || ['grom', 'malvash'].includes(X.fid);
  const hide = X.kw('hide', 'timber fortress');
  const decks = clamp(X.n('decks', 2), 1, 3);
  const ports = (X.ab.has('broadside') || X.has('cannons')) ? Array.from({ length: decks }, (_, i) => ({ y: 0.28 + i * 0.26, sp: 1.35 })) : [];
  const sp = { HL, HB, HD, P: plated ? X.pat.plate : pat(X, 'plank', X.pal.hull, hexShade(X.pal.hull, 0.75)), wale: X.pal.trim, wales: [0.12, 0.42, 0.72, 0.95].slice(0, decks + 1), ports, glow: X.pal.glow, seed: X.seed, dens: 8, sheer: 0.9 };
  const key = `${X.fid}|${L}`;
  const hm = piece(X, hullGeo(key, sp, 0), X.I, [0, 0, 0], [0, 0, 0], 1);
  X.skins.push({ ent: hm.userData.lodEntry, make: (lv) => hullGeo(key, sp, lv) });
  piece(X, deckGeo(key, { ...sp, deckP: pat(X, 'plank', hexMix(X.pal.wood, 0xc8a878, 0.4), hexShade(hexMix(X.pal.wood, 0xc8a878, 0.4), 0.8)) }, 0.02), X.I, [0, 0, 0], [0, 0, 0], 1);
  X.hullSpec = sp;
  X.yAt = () => 0;
  X.underY = (x) => { const t = clamp((x + HL / 2) / HL, 0, 1); return hullPt(sp, t, PI / 2)[1]; };
  X.extent = [HL / 2, HB / 2];
  X.rim = [];
  for (let i = 0; i <= 20; i++) { const t = 0.05 + (i / 20) * 0.9, x = -HL / 2 + t * HL, b = hullHalfBeam(sp, t); X.rim.push([x, 0, b, 0, 1, PI / 2], [x, 0, -b, 0, -1, -PI / 2]); }
  X.keelLine = [[-HL * 0.35, X.underY(-HL * 0.35), 0], [HL * 0.3, X.underY(HL * 0.3), 0]];
  // bulwarks and a cap-rail, the stern castle in tiers, the forecastle
  for (const s of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 16; i++) { const t = 0.02 + (i / 16) * 0.96; pts.push([-HL / 2 + t * HL, 0.55, s * (hullHalfBeam(sp, t) - 0.05)]); }
    piece(X, tubeGeo(`rail|${key}|${s}`, pts, 0.09, lin(X.pal.trim), { sides: 6, dens: 4, me: 0.8, ro: 0.4 }), X.I, [0, 0, 0], [0, 0, 0], 1);
    for (let i = 1; i < 16; i += 1) place(X, cutAfter(postGeo(X), 3), [pts[i][0], 0, pts[i][2]], [0, 0, 0], 1);
  }
  const wallP = hide ? X.pat.hide : plated ? X.pat.plate : pat(X, 'plank', hexMix(X.pal.hull, X.pal.wood, 0.5), hexShade(X.pal.hull, 0.7), { win: { sp: 1.1, dy: 1.9, w: 0.5, h: 0.8, y0: 0.6, glow: lin(X.pal.glow), lit: 0.7 } });
  const sx = -HL / 2 + HL * 0.15;
  let y = 0, w = HL * 0.24, d = HB * 0.86, castleTop = 0;
  for (let i = 0; i < decks; i++) {
    const last = i === decks - 1;
    const b = building(X, [sx + i * 0.5, y, 0], { w, d, h: 2.0, roof: last ? undefined : 'flat', wallP, wallPlainP: wallP, solo: last, breakable: last, seed: i, dens: 8, y0: -0.2 });
    y += 2.0 + (last ? 0 : 0.3); castleTop = b.top;
    if (!last) slotsIn(X, sx + i * 0.5 - w * 0.4, sx + i * 0.5 + w * 0.4, -d * 0.35, d * 0.35, y);
    w *= 0.82; d *= 0.9;
  }
  reserve(X, sx, 0, HL * 0.14);
  const fx = HL / 2 - HL * 0.14;
  const fc = building(X, [fx, 0, 0], { w: HL * 0.12, d: HB * 0.6, h: 1.6, roof: 'flat', wallP, wallPlainP: wallP, dens: 8 });
  reserve(X, fx, 0, HL * 0.08);
  X.foreTop = fc.top;
  // an observatory dome on the castle
  if (X.kw('observatory', 'star-reader') || X.has('spires')) building(X, [sx + decks * 0.5 - 0.3, castleTop - 0.4, 0], { plan: 'circle', w: 2.6, h: 1.0, roof: X.kw('observatory') ? 'dome' : 'spire', domeP: X.pat.gold, roofP: X.pat.gold, dens: 9, finial: true });
  // pads along the open deck between the castles
  for (let x = -HL / 2 + HL * 0.3; x < HL / 2 - HL * 0.25; x += 1.4) for (const z of [-HB * 0.25, 0, HB * 0.25]) X.pads.push({ x, z, y: 0, r: 0.7, used: false });
  slotsIn(X, -HL * 0.2, HL * 0.25, -HB * 0.35, HB * 0.35, 0, 1.0);
  // the lift
  const n = clamp(X.n('envelopes', 1), 1, 4), round = X.kw('hot-air', 'balloon heated', 'bonfire'), envs = [];
  const cy0 = L * 0.27;
  const layout = n === 1 ? [[0, cy0 + (round ? L * 0.04 : 0), 0, round ? L * 0.2 : L * 0.145, L * 0.85]] : n === 2 ? [[0, cy0, -L * 0.115, L * 0.105, L * 0.82], [0, cy0, L * 0.115, L * 0.105, L * 0.82]]
    : n === 3 ? [[0, cy0 + L * 0.06, 0, L * 0.12, L * 0.86], [-L * 0.02, cy0 - L * 0.02, -L * 0.2, L * 0.09, L * 0.7], [-L * 0.02, cy0 - L * 0.02, L * 0.2, L * 0.09, L * 0.7]]
      : [[L * 0.12, cy0, -L * 0.12, L * 0.09, L * 0.5], [L * 0.12, cy0, L * 0.12, L * 0.09, L * 0.5], [-L * 0.2, cy0, -L * 0.12, L * 0.09, L * 0.5], [-L * 0.2, cy0, L * 0.12, L * 0.09, L * 0.5]];
  for (const [x, cy, z, R, Le] of layout) envs.push(envelope(X, [x, cy, z], Le, R, { round, ribs: X.fid === 'grom' ? 7 : 4, spikes: X.kw('spiked'), col: X.pal.env }));
  X.envs = envs;
  // rigging from each bag's belly to the rails
  const pairs = [];
  for (const E of envs) for (let i = 0; i < 6; i++) { const t = (i + 0.5) / 6, x = E.g.position.x + (t - 0.5) * (E.round ? E.R : E.Le * 0.7); for (const s of [-1, 1]) { const tt = clamp((x + HL / 2) / HL, 0.05, 0.95); pairs.push([[x, E.g.position.y - E.R * 0.85, E.g.position.z + s * E.R * 0.4], [x, 0.55, s * (hullHalfBeam(sp, tt) - 0.1)]]); } }
  rigging(X, pairs, 0x2a241e, 0.04);
  if (round) { const br = piece(X, PC.lantern('brazier', { metal: X.pal.trim, glow: 0xff8a2a }), X.I, [0, castleTop * 0 + 0.0, 0], [0, 0, 0], 3.2); void br; X.fx.bonfire = lightPillar(X, [0, 2.8, 0], 1.2, L * 0.1, 0xff8a2a, 'fire'); reserve(X, 0, 0, 2.2); }
  // engines on outriggers, propellers turning
  const nE = plated ? 4 : 2;
  for (let i = 0; i < nE; i++) {
    const x = nE === 2 ? -HL * 0.05 : (i < 2 ? HL * 0.15 : -HL * 0.22), s = i % 2 ? 1 : -1, z = s * (HB / 2 + 2.0), yy = -HD * 0.25;
    piece(X, tubeGeo(`outrig|${key}|${i}`, [[x, yy + 0.2, s * HB * 0.45], [x, yy + 0.3, z]], 0.16, lin(X.pal.trim), { sides: 8, me: 0.8, ro: 0.4 }), X.I, [0, 0, 0], [0, 0, 0], 1);
    piece(X, nacelleGeo(X.pal.trim, 0x3e3e44), X.I, [x, yy, z], [0, 0, 0], 2.4);
    const pg = new THREE.Group(); pg.position.set(x - 1.6, yy, z); X.I.add(pg);
    piece(X, propGeo(1.6, 4, X.pal.wood, X.pal.trim, false), pg, [0, 0, 0], [0, 0, 0], 1);
    X.anim.spin.push({ o: pg, axis: 'x', speed: 14 * s, prop: true });
  }
  // the figurehead under the bowsprit
  const fig = X.S.figure && X.S.figure !== 'none' ? X.S.figure : null;
  if (fig) {
    const st0 = shipStyle({ realm: X.fid, color: X.pal.hull, trim: X.pal.trim });
    const geos = figureSculptGeo({ serpent: 'cobra' }[fig] || fig, { ...st0, id: X.fid, metal: X.pal.trim, carve: X.pal.trim }, X.pal.hull, X.pal.side, 56);
    if (geos) piece(X, geos, X.I, [HL / 2 - 0.2, -HD * 0.2, 0], [0, 0, -0.2], 3.4);
  }
  piece(X, tubeGeo(`sprit|${key}`, [[HL / 2 - 1, 0.6, 0], [HL / 2 + 3.2, 1.8, 0]], (t) => 0.22 * (1 - t * 0.6), lin(X.pal.wood), { sides: 8, bark: true }), X.I, [0, 0, 0], [0, 0, 0], 1);
  X.top = Math.max(...envs.map((E) => E.g.position.y + E.R * (E.round ? 1.05 : 1))) + 0.5;
  X.bowAt = [HL / 2 + 1, 0.5, 0]; X.sternAt = [-HL / 2 - 0.3, 1, 0];
}
function postGeo(X) { return prismGeo(`post|${X.pal.trim}|${X.pal.wood}`, { plan: 'rect', w: 0.14, d: 0.14, corner: 0.02, prof: [[1, 0, 0, 'w'], [1, 0, 0.6, 'w'], [1.4, 0, 0.62, 'w'], [0, 0, 0.66, 'w']], mats: { w: { pat: 'vplank', col: lin(X.pal.wood), col2: lin(hexShade(X.pal.wood, 0.8)), seed: 2 } }, dens: 20 }, 0); }

// =============================================================================================
// CITADEL: walls and towers round a keep, on a rock or a bowl hung from envelopes
// =============================================================================================
function citadel(X) {
  const L = X.L, rx = L * 0.38, rz = L * 0.3;
  const bowl = X.has('envelopes');
  if (bowl) bowlBase(X, rx, rz, L * 0.13, X.kw('iron') || X.pat.wall.pat === 'plate' ? X.pat.plate : X.pat.wallPlain, { plan: X.fid === 'screaming' ? 'star' : 'circle', n: 8 });
  else rockBase(X, { rx, rz, depth: L * 0.15, top: (x, z) => 0.0 + 0.25 * noise3(x * 0.2, z * 0.2, 3) * sst(0.7, 1, Math.hypot(x / rx, z / rz)), rockP: { col: lin(X.pal.rock), col2: lin(hexShade(X.pal.rock, 0.7)) }, veins: X.kw('glow', 'shifting', 'crystal') ? { c: lin(X.pal.glow), k: 1.3 } : null, seed: X.seed, dens: 7, rough: X.kw('jagged', 'glass') ? 1.0 : 0.6, lobes: X.kw('jagged') ? 9 : 5, mossCol: X.kw('obsidian', 'black', 'glass') ? null : undefined, ro: X.kw('glass') ? 0.2 : 0.92 });
  if (!bowl) padsFrom(X, 0.8, 1.5, 0.8);
  const nT = X.fid === 'screaming' ? 8 : clamp(X.n('towers', 6) || X.n('spires', 6), 4, 8);
  const spiky = X.fid === 'kaelneth' || X.fid === 'screaming';
  const tR = X.fid === 'shogunate' ? 1.4 : 1.5, tH = L * 0.17;
  const ring = [];
  for (let i = 0; i < nT; i++) {
    const a = (i / nT) * TAU + (nT % 2 ? 0 : PI / nT), x = Math.cos(a) * rx * 0.84, z = Math.sin(a) * rz * 0.84;
    ring.push([x, X.yAt(x, z), z]);
  }
  const wallH = L * 0.1;
  for (let i = 0; i < nT; i++) { const a = ring[i], b = ring[(i + 1) % nT]; wallRun(X, a, b, wallH, 1.0, { y0: -1.2 }); }
  ring.forEach((p, i) => {
    const t = building(X, p, { plan: X.fid === 'shogunate' ? 'rect' : 'circle', w: tR * 2, h: tH * (spiky ? 1.25 : 1), roof: spiky ? 'spire' : undefined, rh: spiky ? tR * 4 : undefined, breakable: i % 2 === 0, solo: true, seed: i, y0: -1.5, dens: 8 });
    X.towerTops = X.towerTops || []; X.towerTops.push([p[0], t.top, p[2]]);
    reserve(X, p[0], p[2], tR * 1.4);
    if (i % 2 === 1 && X.has('banners')) bannerAt(X, [p[0], p[1] + tH + 0.3, p[2]], 2.6, 1.3, 1.9, -Math.atan2(p[2], p[0]));
  });
  // the gate at the bow
  building(X, [rx * 0.84 + 0.2, X.yAt(rx * 0.84, 0), 0], { w: 2.8, d: 4.2, h: wallH + 1.2, roof: 'flat', win: false, dens: 8 });
  // the keep: a tower-house in the middle with corner turrets, or a tiered castle keep
  const kw = L * 0.26, kd = L * 0.2, kh = L * 0.2;
  reserve(X, 0, 0, kw * 0.75);
  if (X.S.roof === 'pagoda') {
    let y = X.yAt(0, 0), w = kw, d = kd;
    for (let i = 0; i < 4; i++) { const b = building(X, [0, y, 0], { w, d, h: 2.6, roof: 'pagoda', rh: Math.min(w, d) * 0.22, upturn: 0.5, solo: i === 3, breakable: i === 3, seed: i + 9, finial: i === 3, dens: 9 }); y += 2.6 + Math.min(w, d) * 0.12; w *= 0.78; d *= 0.78; X.keepTop = b.top; }
  } else {
    const k = building(X, [0, X.yAt(0, 0), 0], { w: kw, d: kd, h: kh, roof: spiky ? 'flat' : X.S.roof === 'onion' ? 'flat' : X.S.roof === 'spire' ? 'flat' : undefined, solo: true, breakable: true, breakAt: 3, seed: 7, y0: -1.2, dens: 8 });
    X.keepTop = k.top;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const t = building(X, [sx * kw * 0.48, X.yAt(0, 0), sz * kd * 0.48], { plan: 'circle', w: 2.0, h: kh + 2.4, roof: spiky ? 'spire' : X.S.roof === 'flat' ? 'cone' : undefined, rh: spiky ? 5 : undefined, seed: 11 + sx + sz, dens: 8, y0: -1 });
      void t;
    }
    if (X.S.roof === 'onion' || X.has('domes')) { building(X, [0, kh + X.yAt(0, 0) + 0.3, 0], { plan: 'circle', w: kd * 0.55, h: 2.2, roof: 'onion', domeP: X.pat.gold, dens: 9 }); X.keepTop += 6; }
    if (spiky) building(X, [0, kh + X.yAt(0, 0) + 0.3, 0], { plan: X.fid === 'screaming' ? 'star' : 'poly', n: X.fid === 'screaming' ? 8 : 6, w: kd * 0.5, h: 3, roof: 'spire', rh: L * 0.2, dens: 8 });
    slotsIn(X, -kw * 0.35, kw * 0.35, -kd * 0.35, kd * 0.35, X.yAt(0, 0) + kh + 0.3);
  }
  // halls inside the ward
  for (let i = 0; i < 3; i++) { const p = take(X, 2.4, 'centre'); if (p) building(X, p, { w: 3.6, d: 2.6, h: 2.6, ry: Math.atan2(p[2], p[0]) + PI / 2, seed: 20 + i, dens: 8 }); }
  slotsIn(X, -rx * 0.6, rx * 0.6, -rz * 0.6, rz * 0.6, X.yAt(0, 0), 1.6);
  if (bowl) {
    const n = clamp(X.n('envelopes', 2), 1, 4), envs = [];
    const cy = L * 0.42;
    for (let i = 0; i < n; i++) { const z = n === 1 ? 0 : ((i / (n - 1)) - 0.5) * L * 0.36; envs.push(envelope(X, [0, cy, z], L * 0.75, L * 0.11, { ribs: 5, spikes: X.kw('spiked', 'rust') })); }
    X.envs = envs;
    const pairs = [];
    for (const E of envs) for (let i = 0; i < 5; i++) { const x = E.g.position.x + ((i + 0.5) / 5 - 0.5) * E.Le * 0.65; pairs.push([[x, cy - E.R * 0.9, E.g.position.z], [x * 0.9, X.keepTop || 6, E.g.position.z * 0.5]]); }
    for (const p of X.towerTops) pairs.push([[p[0] * 0.5, cy - L * 0.1, p[2] * 0.5], p]);
    rigging(X, pairs, 0x2a2420, 0.05);
    X.top = cy + L * 0.12;
  } else X.top = Math.max(X.keepTop || 0, ...X.towerTops.map((p) => p[1])) + 1;
  if (X.fid === 'shogunate' || X.has('kites')) kites(X, 3);
}
function kites(X, n) {
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group(); g.position.set(-X.L * 0.1 + i * 3, X.L * 0.42 + i * 1.2, (i - 1) * X.L * 0.22); X.I.add(g);
    piece(X, PC.kite({ cloth: X.pal.cloth === 0 ? 0xc81a1a : 0xc81a1a, cloth2: 0xf0e8d8, wood: X.pal.wood }), g, [0, 0, 0], [0, 0, 0.3], 2.4);
    X.anim.sway.push({ o: g, axis: 'z', amp: 0.08, speed: 0.7, phase: i });
    rigging(X, [[[g.position.x, g.position.y - 3.6, g.position.z], [g.position.x * 0.3, (X.keepTop || 6) - 1, g.position.z * 0.3]]], 0x1a1612, 0.03);
  }
}

// =============================================================================================
// ISLAND: a torn-up piece of land, with what grew or was built on it
// =============================================================================================
function island(X) {
  const L = X.L, rx = L * 0.43, rz = L * 0.35;
  const icy = X.kw('ice', 'iceberg', 'glacier'), hill = X.has('hill') || X.kw('burial mound', 'barrow', 'hill');
  const topF = (x, z) => {
    const r = Math.hypot(x / rx, z / rz);
    let h = 0.55 * Math.max(0, noise3(x * 0.16, z * 0.16, X.seed) - 0.35) * 2.2 * (1 - sst(0.0, 0.25, 0.25 - Math.abs(r - 0.55)));
    if (hill) h += (X.L * 0.17) * Math.pow(Math.max(0, 1 - (r / 0.7) ** 2), 1.3);
    if (icy) h += X.L * 0.06 * Math.max(0, 1 - r * 1.2) + 1.2 * Math.max(0, noise3(x * 0.3, z * 0.3, 7) - 0.5);
    return h * (1 - sst(0.88, 1, r) * 0.6);
  };
  const grass = icy ? pat(X, 'snow', 0xdde8f0, 0xb8c8d8) : X.fid === 'pearlfleet' ? pat(X, 'sandy', 0xe8d8b8, 0xd8c0a0) : pat(X, 'grass', X.pal.grass, hexMix(X.pal.grass, 0x6a5a2a, 0.5));
  rockBase(X, { rx, rz, depth: L * 0.16, top: topF, topP: grass, rockP: { col: lin(icy ? 0xa8c8e0 : X.fid === 'pearlfleet' ? 0xd89aa8 : X.pal.rock), col2: lin(icy ? 0x6890b8 : X.fid === 'pearlfleet' ? 0xe8d0c0 : hexShade(X.pal.rock, 0.7)) }, under: icy ? 0x4a6a90 : undefined, ice: icy, veins: X.kw('glowing', 'ley', 'rune') || X.has('runes') ? { c: lin(X.pal.glow), k: 1.4, w: 0.02 } : null, seed: X.seed, dens: 7, lobes: 6, ro: icy ? 0.25 : 0.92, mossCol: icy ? null : undefined });
  padsFrom(X, 0.82, 1.5, 0.9);
  X.top = 4;
  // the great tree(s)
  const nTree = X.n('tree', 1);
  const kind = X.fid === 'baobab' ? 'baobab' : X.fid === 'deeproot' ? 'jungle' : X.kw('rot') ? 'rot' : ['xibalba', 'emerald'].includes(X.fid) ? 'jungle' : X.fid === 'verdant' ? 'oak' : 'oak';
  const tc = { bark: X.kw('iron-oak') ? 0x3a3632 : X.pal.bark, leaf: X.pal.leaf, leaf2: X.pal.leaf2, glow: X.fid === 'verdant' || X.fid === 'deeproot' ? X.pal.glow : 0 };
  if (X.has('tree')) {
    const big = nTree <= 1;
    for (let i = 0; i < Math.max(1, nTree); i++) {
      const p = big ? [rx * 0.05, X.yAt(rx * 0.05, 0), 0] : take(X, 3.2, 'centre');
      if (!p) continue;
      reserve(X, p[0], p[2], big ? 4 : 3);
      const s = big ? (X.fid === 'baobab' ? 4.2 : 4.6) : 3.4;
      const t = piece(X, PC.tree(kind, tc, X.seed + i), X.I, [p[0], p[1] - 0.3, p[2]], [0, i * 1.7, 0], s);
      X.breakParts.push({ mesh: t, at: [p[0], p[1] + s * 2, p[2]], kind: 'tree' });
      X.top = Math.max(X.top, p[1] + s * 3.6);
      X.treeTops = X.treeTops || []; X.treeTops.push([p[0], p[1] + s * 2.8, p[2], s]);
    }
  }
  // a stepped temple of terraces on the crown
  if (['xibalba', 'emerald'].includes(X.fid) || (X.n('terraces') >= 3 && X.form === 'island')) templeSteps(X, X.n('terraces', 4));
  if (X.fid === 'verdant' && X.has('terraces')) for (let i = 0; i < 2; i++) { const p = take(X, 2, 'edge'); if (p) building(X, p, { plan: 'circle', w: 3.2, h: 1.4, roof: 'dome', domeP: pat(X, 'thatch', 0x8a7a3a, 0x6a5a2a), dens: 8 }); }
  // the hill-smial: round doors in the hillside, chimneys and an inn
  if (X.fid === 'hearthmoot') smials(X);
  if (X.fid === 'fimbul') meadHall(X);
  if (X.fid === 'kurgan') yurts(X, 9, 'felt');
  if (X.fid === 'baobab') yurts(X, 6, 'thatch');
  if (X.fid === 'pearlfleet') reef(X);
  if (X.fid === 'mistisles' || X.n('obelisks') >= 6) stoneRing(X, X.n('obelisks', 9));
  // the lift: envelopes over the hill (patchwork balloons), else it floats by its own power
  if (X.has('envelopes')) {
    const n = X.n('envelopes', 3), envs = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.4; envs.push(envelope(X, [Math.cos(a) * rx * 0.35, L * 0.48, Math.sin(a) * rz * 0.35], 0, L * 0.11, { round: true, patches: 9, col: [X.pal.env, 0xc8a040, 0x8a3a2a, 0x3a6a8a][i % 4] })); }
    X.envs = envs;
    rigging(X, envs.flatMap((E) => [0, 1, 2].map((k) => { const a = (k / 3) * TAU; return [[E.g.position.x + Math.cos(a) * E.R * 0.6, E.g.position.y - E.R * 0.85, E.g.position.z + Math.sin(a) * E.R * 0.6], [E.g.position.x * 1.6 + Math.cos(a) * 2, X.yAt(E.g.position.x * 1.6, E.g.position.z * 1.6), E.g.position.z * 1.6 + Math.sin(a) * 2]]; })), 0x3a3028, 0.045);
    X.top = Math.max(X.top, L * 0.48 + L * 0.12);
  }
  slotsIn(X, -rx * 0.5, rx * 0.5, -rz * 0.5, rz * 0.5, 0, 1.5);
  X.crewSlots = X.crewSlots.map((p) => [p[0], X.yAt(p[0], p[2]) + 0.01, p[2]]);
}
function templeSteps(X, n) {
  const L = X.L, W = L * 0.36;
  let y = X.yAt(0, 0) - 0.3, w = W;
  const P = X.pat.wallPlain;
  reserve(X, 0, 0, W * 0.55);
  for (let i = 0; i < n; i++) {
    const h = 1.6;
    const spec = { plan: 'rect', w, d: w * 0.85, corner: 0.1, prof: [[1.02, 0, -0.8, 'wallPlain'], [1, 0, h * 0.8, 'wallPlain'], ...band(1, h * 0.8, 0.1, 0.16, 'trim').slice(1), [1, 0, h, 'wallPlain'], [0, 0, h, 'floor']], mats: { wallPlain: { ...P, rune: X.has('runes') ? { t: 0.7, h: 0.4, col: lin(X.pal.glow), k: 1.2 } : null }, trim: X.pat.gold, floor: X.pat.floor }, dens: 8, seed: X.seed + i };
    const m = piece(X, prismGeo(`temple|${X.fid}|${i}`, spec, 0), X.I, [0, y, 0], [0, 0, 0], 1);
    X.skins.push({ ent: m.userData.lodEntry, make: (lv) => prismGeo(`temple|${X.fid}|${i}`, spec, lv) });
    // a stair up the bow face of each step
    y += h; w *= 0.78;
    slotsIn(X, -w * 0.5, w * 0.5, -w * 0.4, w * 0.4, y, 1.4);
  }
  // stairs: a ramp of steps up the +x face
  const st = { plan: 'rect', w: 2.2, d: 2.4, corner: 0.03, prof: Array.from({ length: n * 4 + 1 }, (_, k) => [1 - k / (n * 4 + 1) * 0.9, 0, k * 0.4, 'wallPlain']).concat([[0, 0, n * 1.6, 'floor']]), mats: { wallPlain: X.pat.wallPlain, floor: X.pat.floor }, dens: 8 };
  void st;
  const shrine = building(X, [0, y, 0], { w: w * 1.0, d: w * 0.85, h: 2.4, roof: 'stepped', solo: true, breakable: true, wallP: X.pat.wall, dens: 9 });
  X.templeTop = shrine.top;
  X.top = Math.max(X.top || 0, shrine.top);
  for (const s of [-1, 1]) for (const t of [-1, 1]) X.cornerTops = [...(X.cornerTops || []), [s * W * 0.42, X.yAt(0, 0) + 1.6, t * W * 0.36]];
}
function smials(X) {
  const L = X.L;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.3, r = L * 0.2, x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8, y = X.yAt(x, z);
    place(X, roundDoor(X, i % 3), [x, y - 0.1, z], [0, -a, 0], 1.4);
    if (i % 2 === 0) { const cx = Math.cos(a) * r * 0.6, cz = Math.sin(a) * r * 0.5; building(X, [cx, X.yAt(cx, cz) - 0.6, cz], { plan: 'rect', w: 0.7, h: 1.8, roof: 'flat', wallP: pat(X, 'brick', 0x8a4a32, 0x6a3a28), win: false, finial: false, dens: 12 }); X.smoke = [...(X.smoke || []), [cx, X.yAt(cx, cz) + 1.6, cz]]; }
  }
  const inn = take(X, 3, 'edge'); if (inn) building(X, inn, { w: 4, d: 3, h: 2.6, roof: 'hip', wallP: X.pat.wall, roofP: pat(X, 'thatch', 0xb89a50, 0x8a7a3a), ry: 0.4, dens: 9 });
  for (let i = 0; i < 6; i++) { const p = take(X, 1.4, 'edge'); if (p) place(X, PC.tree('blossom', { bark: 0x5a4030, leaf: 0x5a8a2a, leaf2: 0x7a9a3a }, i), [p[0], p[1] - 0.2, p[2]], [0, i, 0], 1.1); }
  if (X.has('windmill')) { const p = take(X, 2.5, 'edge'); if (p) { const b = building(X, p, { plan: 'circle', w: 2.4, h: 5, roof: 'cone', taper: 0.7, wallP: X.pat.wall, dens: 9 }); const g = new THREE.Group(); g.position.set(p[0] + 1.0, b.top - 1.6, p[2]); X.I.add(g); piece(X, PC.windSails({ wood: X.pal.wood, cloth: 0xe8dcc0 }), g, [0, 0, 0], [0, 0, 0], 1.3); X.anim.spin.push({ o: g, axis: 'x', speed: 0.6 }); } }
}
function roundDoor(X, k) {
  return PC.sculpt(`door|${k}|${X.pal.trim}`, () => {
    const { S } = PCS_(), B = new (PCSB())();
    const col = [0x2a6a3a, 0xc8a040, 0x8a2a1a][k];
    B.p(S.cyl(0.6, 0.12, 0.02).rot(0, 0, 90).at(0.04, 0.55, 0).color(col).pbr(0.7));
    B.p(S.torus(0.6, 0.07).rot(0, 0, 90).at(0.06, 0.55, 0).color(0x6a4a2e).pbr(0.85));
    B.p(S.sphere(0.06).at(0.12, 0.55, 0).color(X.pal.trim).pbr(0.3, 0.9));
    B.p(S.box(0.6, 0.12, 1.8, 0.02).at(0.25, 0.04, 0).color(0x8a7a6a).pbr(0.9));
    for (const s of [-1, 1]) B.p(S.cyl(0.06, 0.6, 0.01).at(0.3, 0.3, s * 0.85).color(0x6a4a2e));
    return B.part();
  }, 36);
}
import * as PK from '../parts/kit.js';
const PCS_ = () => PK, PCSB = () => PK.SB;
function meadHall(X) {
  const L = X.L;
  reserve(X, 0, 0, L * 0.2);
  const b = building(X, [0, X.yAt(0, 0) - 0.3, 0], { w: L * 0.34, d: L * 0.14, h: 2.6, roof: 'hip', rh: L * 0.1, wallP: pat(X, 'vplank', 0x5a4030, 0x3a2a1a), roofP: pat(X, 'shingle', 0x4a3a2a, 0x2a2018, { moss: 0.5 }), solo: true, breakable: true, dens: 9 });
  X.hallTop = b.top;
  for (const s of [-1, 1]) for (const e of [-1, 1]) place(X, PC.sculpt(`dragonpost|${X.pal.wood}`, () => { const B = new PK.SB(); PK.SKH.limb(B, [[0, 0, 0], [0.2, 1.0, 0], [0.6, 1.5, 0], [0.9, 1.4, 0]], [0.12, 0.1, 0.08, 0.04], X.pal.wood, { k: 0.03, bump: [0.006, 14, 'fur'] }); B.p(PK.S.sphere(0.05).at(0.75, 1.52, 0.05).color(0xffd040).glow(1)); return B.part(); }, 40), [e * L * 0.17, b.top - L * 0.1 + 0.2, s * 0.05], [0, e > 0 ? 0 : PI, 0], 1.4);
  // longships moored along the cliffs
  for (let i = 0; i < 4; i++) {
    const r = X.rim[(i * 12 + 6) % 48], sp = { HL: 7, HB: 1.6, HD: 0.8, P: pat(X, 'plank', 0x6a4a2a, 0x4a3018), wale: 0xc8a040, wales: [0.2], ports: [], seed: i, dens: 7, sheer: 1.4 };
    const g = new THREE.Group(); g.position.set(r[0] + r[3] * 1.2, r[1] - 1.6, r[2] + r[4] * 1.2); g.rotation.y = -r[5] + PI / 2; X.I.add(g);
    piece(X, hullGeo(`longship|${i % 2}`, { ...sp, seed: i % 2 }, 0), g, [0, 0, 0], [0, 0, 0], 1);
    piece(X, deckGeo(`longship|${i % 2}`, sp, 0.0), g, [0, 0, 0], [0, 0, 0], 1);
    for (let k = 0; k < 6; k++) place(X, shieldGeo(X, k % 3), [-2.4 + k * 0.95, 0.15, 0.82], [0, 0, 0], 1, g), place(X, shieldGeo(X, (k + 1) % 3), [-2.4 + k * 0.95, 0.15, -0.82], [0, PI, 0], 1, g);
  }
}
function shieldGeo(X, k) { return cutAfter(PC.sculpt(`vshield|${k}`, () => { const B = new PK.SB(); const c = [0xc81a1a, 0xe8d8a0, 0x1a4a8a][k]; B.p(PK.S.cyl(0.36, 0.05, 0.02).rot(90, 0, 0).color(c).pbr(0.8)); B.p(PK.S.sphere(0.08).at(0, 0, 0.03).color(0xb8a060).pbr(0.3, 0.9)); B.p(PK.S.torus(0.36, 0.025).rot(90, 0, 0).color(0x6a6a70).pbr(0.4, 0.8)); return B.part(); }, 40), 2); }
function yurts(X, n, skin) {
  const P = skin === 'felt' ? X.pat.felt : pat(X, 'thatch', 0xb89a50, 0x8a7a3a);
  for (let i = 0; i < n; i++) {
    const p = take(X, 1.8, i < 3 ? 'centre' : 'edge'); if (!p) continue;
    const w = 2.2 + h1(i + X.seed) * 1.0;
    building(X, [p[0], p[1] - 0.2, p[2]], { plan: 'circle', w, h: 1.2, roof: 'dome', rh: w * 0.4, wallP: P, wallPlainP: P, domeP: P, roofP: P, win: false, finial: false, dens: 9, seed: i % 3 });
  }
}
function reef(X) {
  for (let i = 0; i < 10; i++) { const p = take(X, 1.3, i < 4 ? 'edge' : null); if (p) place(X, PC.coral({ col: [0xe87a8a, 0xf0a060, 0xb070c0][i % 3], col2: 0xf8e0d0 }, i % 4), [p[0], p[1] - 0.1, p[2]], [0, i, 0], 1.6 + h1(i) * 0.8); }
  const nd = X.n('domes', 3);
  for (let i = 0; i < nd; i++) { const p = take(X, 2.8, 'centre'); if (p) building(X, p, { plan: 'circle', w: 3.6 - i * 0.4, h: 1.4, roof: 'dome', rh: 2.4, domeP: pat(X, 'silver', 0xf0e8e0, 0xe0c8d8), wallP: pat(X, 'coral', 0xf0c0c8, 0xe0a0b0), dens: 9 }); }
  if (X.has('towers')) for (let i = 0; i < 3; i++) { const p = take(X, 1.6, 'centre'); if (p) building(X, p, { plan: 'circle', w: 1.6, h: 5 + i, roof: 'spire', rh: 3, taper: 0.7, wallP: pat(X, 'coral', 0xf0d0d8, 0xe0a0b0, { win: X.pat.wall.win }), roofP: pat(X, 'silver', 0xf8f0e8, 0xe8d0e0), dens: 9 }); }
}
function stoneRing(X, n) {
  const r = X.L * 0.13, c = X.treeTops ? [X.L * 0.15, 0] : [0, 0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, x = c[0] + Math.cos(a) * r, z = c[1] + Math.sin(a) * r * 0.85;
    place(X, megalith(X, i % 3), [x, X.yAt(x, z) - 0.4, z], [0, -a, 0], 1 + h1(i) * 0.3);
  }
}
function megalith(X, k) {
  return prismGeo(`megalith|${X.pal.rock}|${k}|${X.has('runes')}`, { plan: 'rect', w: 1.1, d: 0.6, corner: 0.15, prof: [[1.1, 0, -0.3, 'r'], [1, 0, 1.5, 'r'], [0.85 + k * 0.05, 0, 3.0 + k * 0.4, 'r'], [0, 0, 3.3 + k * 0.4, 'r']], mats: { r: { pat: 'rock', col: lin(hexMix(X.pal.rock, 0x8a8a80, 0.3)), col2: lin(hexShade(X.pal.rock, 0.7)), seed: k, rune: X.has('runes') ? { t: 1.6, h: 0.5, col: lin(X.pal.glow), k: 1.3 } : null } }, dens: 9 }, 0);
}

// =============================================================================================
// CRAG: a mountain torn up whole: a peak above, a hanging root of rock below
// =============================================================================================
function crag(X) {
  const L = X.L, rx = L * 0.36, rz = L * 0.3, peakH = L * 0.26, px = -L * 0.06;
  const arena = X.kw('arena'), eye = X.kw('eye');
  const topF = (x, z) => {
    const r = Math.hypot((x - px) / (rx * 0.85), z / (rz * 0.85));
    let h = peakH * Math.pow(Math.max(0, 1 - r), 1.4) + 1.6 * (noise3(x * 0.25, z * 0.25, X.seed) - 0.5) * (1 - r);
    h += 1.2 * Math.max(0, noise3(x * 0.12, z * 0.12, X.seed + 4) - 0.45);
    if (arena) { const rr = Math.hypot((x - px) / 5.2, z / 5.2); if (rr < 1) h = Math.min(h, peakH * 0.55 + (rr ** 4) * peakH * 0.3); }
    const shoulder = sst(0.45, 0.75, Math.hypot(x / rx, z / rz));
    return lerp(h, Math.min(h, 1.2), shoulder * 0.7);
  };
  rockBase(X, { rx, rz, depth: L * 0.18, top: topF, topP: pat(X, X.kw('grave', 'barrow', 'black') ? 'soil' : 'moss', X.pal.grass, hexMix(X.pal.rock, X.pal.grass, 0.5)), rockP: { col: lin(X.pal.rock), col2: lin(hexShade(X.pal.rock, 0.65)) }, veins: X.has('runes') || X.kw('rune', 'lava', 'glowing') ? { c: lin(X.pal.glow), k: 1.5, w: 0.024 } : null, seed: X.seed, dens: 7, rough: 0.9, lobes: 7, flat: 0 });
  padsFrom(X, 0.86, 1.4, 0.9);
  X.peak = [px, topF(px, 0), 0];
  X.top = X.peak[1] + 1;
  if (arena) {
    // a brass-walled arena in the crown and a throne at its head
    const ay = topF(px, 0);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, b = ((i + 1) / 16) * TAU; wallRun(X, [px + Math.cos(a) * 5.4, ay, Math.sin(a) * 5.4], [px + Math.cos(b) * 5.4, ay, Math.sin(b) * 5.4], 1.6, 0.6, { P: X.pat.trim, y0: -1, cren: false }); }
    reserve(X, px, 0, 6);
    throne(X, [px - 4.2, ay + 1.6, 0]);
    X.top = Math.max(X.top, ay + 9);
  } else if (X.fid === 'cloven' || X.has('totems') && X.n('totems') === 1) {
    place(X, megalith(X, 2), [X.peak[0], X.peak[1] - 1.2, 0], [0, 0.4, 0], 2.4);
    X.top = X.peak[1] + 8;
  } else if (X.fid === 'undead') {
    for (let i = 0; i < 5; i++) { const p = take(X, 2, 'centre'); if (p) building(X, [p[0], p[1] - 0.5, p[2]], { w: 2.2, d: 1.6, h: 1.6, roof: 'stepped', wallP: X.pat.wallPlain, win: false, dens: 9, seed: i }); }
  } else if (X.fid === 'elemental') {
    piece(X, PC.crystals({ glow: X.pal.glow, base: X.pal.rock }, 3), X.I, [X.peak[0], X.peak[1] - 0.6, 0], [0, 0, 0], 3.6);
    X.top = X.peak[1] + 7;
  }
  if (eye) {
    // the baleful eye carved into the cliff over the bow
    const g = new THREE.Group(); const r = X.rim[0]; g.position.set(r[0] - 1.2, -X.L * 0.05, 0); X.I.add(g);
    piece(X, eyeGeo(X), g, [0, 0, 0], [0, 0, 0], 3.2);
    X.eye = g; X.eyeAt = [r[0] + 1.6, -X.L * 0.05, 0];
  }
  slotsIn(X, -rx * 0.6, rx * 0.6, -rz * 0.6, rz * 0.6, 0, 1.5);
  X.crewSlots = X.crewSlots.filter((p) => Math.abs(X.yAt(p[0] + 0.5, p[2]) - X.yAt(p[0] - 0.5, p[2])) < 0.6).map((p) => [p[0], X.yAt(p[0], p[2]) + 0.01, p[2]]);
}
function eyeGeo(X) {
  return PC.sculpt(`bigeye|${X.pal.rock}|${X.pal.glow}`, () => {
    const B = new PK.SB();
    B.p(PK.S.ellipsoid(0.5, 1.0, 1.6).color(X.pal.rock).pbr(0.9).bump(0.03, 5, 'rock'));
    B.p(PK.S.ellipsoid(0.3, 0.75, 1.3).at(0.35, 0, 0).cut(0.06).color(0x1a1612));
    B.p(PK.S.sphere(0.7).at(0.1, 0, 0).color(0xf0e0a0).pbr(0.3).glow(0.9));
    B.p(PK.S.ellipsoid(0.15, 0.55, 0.16).at(0.75, 0, 0).color(0x0a0604));
    for (let i = 0; i < 9; i++) { const a = (i / 8) * Math.PI - Math.PI / 2; B.p(PK.S.capsule([0.4, Math.sin(a) * 0.95, Math.cos(a) * 1.4], [0.75, Math.sin(a) * 1.3, Math.cos(a) * 1.8], 0.08, 0.02).color(hexShade(X.pal.rock, 0.7)).blend(0.04)); }
    return B.part();
  }, 26);
}
function throne(X, p) {
  const geos = PC.sculpt(`throne|${X.pal.trim}`, () => {
    const B = new PK.SB(), M = (q) => q.color(X.pal.trim).pbr(0.3, 0.9).blend(0.03);
    B.p(M(PK.S.box(1.6, 0.4, 1.6, 0.05)).at(0, 0.2, 0));
    B.p(M(PK.S.box(1.2, 0.7, 1.2, 0.04)).at(0, 0.75, 0));
    B.p(M(PK.S.box(0.3, 2.6, 1.4, 0.05)).at(-0.6, 1.9, 0));
    for (const s of [-1, 1]) { B.p(M(PK.S.box(1.0, 0.25, 0.2, 0.04)).at(0, 1.3, s * 0.65)); PK.SKH.horn(B, [[-0.6, 3.0, s * 0.5], [-0.5, 3.6, s * 0.9], [-0.7, 4.0, s * 1.2]], 0.15, X.pal.trim, { rings: 6 }); }
    for (let i = 0; i < 5; i++) B.p(PK.S.sphere(0.16).at(-0.5, 3.2, (i - 2) * 0.28).color(0xd8cfb4).pbr(0.6).blend(0.02));
    return B.part();
  }, 30);
  piece(X, geos, X.I, p, [0, 0, 0], 2.2);
  X.thronePos = p;
}

// =============================================================================================
// HULK: a scrap mountain of lashed hulls, or a beast's ribcage carrying galleons
// =============================================================================================
function hulk(X) {
  const L = X.L, rx = L * 0.36, rz = L * 0.26;
  const bones = X.kw('ribcage', 'bone');
  if (bones) return ribHulk(X);
  const scrap = pat(X, 'plank', X.pal.hull, hexShade(X.pal.hull, 0.6));
  rockBase(X, { rx, rz, depth: L * 0.13, top: (x, z) => 1.5 * Math.max(0, noise3(x * 0.2, z * 0.2, X.seed) - 0.3) + 2.2 * Math.max(0, 1 - Math.hypot(x / rx, z / rz) * 1.4), topP: scrap, rockP: { col: lin(hexMix(X.pal.hull, 0x4a3a2a, 0.4)), col2: lin(hexMix(X.pal.hull, 0x6a5a4a, 0.5)) }, seed: X.seed, dens: 7, rough: 1.2, lobes: 8, mossCol: 0x3a3020, ro: 0.85, me: 0.15 });
  padsFrom(X, 0.8, 1.5, 1.2);
  // galleon hulls lashed round the pile at odd angles
  const hulls = [[0, 0.6, rz * 0.75, 0.05, 0.12], [0, 0.4, -rz * 0.75, -0.04, -0.1], [rx * 0.25, 2.6, 0, 0.12, 0.0], [-rx * 0.45, 1.4, rz * 0.2, -0.1, 0.4]];
  hulls.forEach(([x, y, z, roll, yaw], i) => {
    const sp = { HL: L * (i < 2 ? 0.55 : 0.4), HB: L * 0.11, HD: L * 0.07, P: pat(X, 'plank', hexMix(X.pal.hull, [0x6a4a2e, 0x5a3a2a, 0x7a5a3a, 0x4a3a2a][i], 0.5), hexShade(X.pal.hull, 0.6)), wale: X.pal.trim, wales: [0.15, 0.5], ports: [{ y: 0.35, sp: 1.3 }], glow: X.pal.glow, seed: X.seed + i, dens: 8, sheer: 1.0 };
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(roll, yaw, i === 2 ? 0.08 : 0); X.I.add(g);
    const m = piece(X, hullGeo(`hulk|${X.fid}|${i}`, sp, 0), g, [0, 0, 0], [0, 0, 0], 1);
    X.skins.push({ ent: m.userData.lodEntry, make: (lv) => hullGeo(`hulk|${X.fid}|${i}`, sp, lv) });
    piece(X, deckGeo(`hulk|${X.fid}|${i}`, sp, 0.02), g, [0, 0, 0], [0, 0, 0], 1);
    // a broken mast or two
    piece(X, tubeGeo(`hmast|${i}`, [[0, 0, 0], [0.2, 3.5 + i, 0.1]], (t) => 0.22 * (1 - t * 0.4), lin(X.pal.wood), { sides: 8, bark: true }), g, [-sp.HL * 0.1, 0, 0], [0, 0, 0], 1);
    X.hullDecks = [...(X.hullDecks || []), g];
    if (i < 2) for (let k = 0; k < 6; k++) X.muzzleHint = [...(X.muzzleHint || []), [x - sp.HL * 0.3 + k * sp.HL * 0.12, y - sp.HD * 0.35, z + Math.sign(z) * sp.HB * 0.5]];
  });
  // a shanty town piled on top
  const nh = 10;
  for (let i = 0; i < nh; i++) {
    const p = take(X, 1.6, i < 5 ? 'centre' : null); if (!p) continue;
    const w = 1.6 + h1(i + 3) * 1.4;
    building(X, [p[0], p[1] - 0.4 + (i % 3) * 0.6, p[2]], { w, d: w * (0.7 + h1(i) * 0.4), h: 1.4 + h1(i + 9) * 1.2, roof: i % 3 === 0 ? 'flat' : 'hip', ry: h1(i + 5) * 1.2 - 0.6, wallP: pat(X, i % 2 ? 'plank' : 'vplank', [0x6a4a2e, 0x5a5a4a, 0x7a5030][i % 3], 0x3a2a1a, { win: { sp: 1.2, dy: 1.6, w: 0.4, h: 0.6, y0: 0.5, glow: lin(X.pal.glow), lit: 0.6 } }), roofP: pat(X, i % 2 ? 'plate' : 'shingle', [0x6a3a2a, 0x5a5a5a, 0x7a6a4a][i % 3], 0x3a2a20, { rust: 0.8 }), dens: 9, seed: i % 4 });
  }
  const n = X.n('envelopes', 3), envs = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU + 0.5; envs.push(envelope(X, [Math.cos(a) * rx * 0.4, L * 0.42 + (i % 2) * 2, Math.sin(a) * rz * 0.5], L * 0.42, L * 0.085, { round: i % 2 === 1, patches: 9, ribs: 2, col: [X.pal.env, 0xa89060, 0x6a7a4a, 0x8a5a3a][i % 4] })); }
  X.envs = envs;
  rigging(X, envs.flatMap((E) => [-1, 1].map((s) => [[E.g.position.x + s * 2, E.g.position.y - E.R * 0.8, E.g.position.z], [E.g.position.x * 0.6 + s * 2, X.yAt(E.g.position.x * 0.6, E.g.position.z * 0.6) + 1, E.g.position.z * 0.6]])), 0x2a241e, 0.05);
  X.top = L * 0.42 + L * 0.12;
  slotsIn(X, -rx * 0.5, rx * 0.5, -rz * 0.5, rz * 0.5, 0, 1.4);
  X.crewSlots = X.crewSlots.map((p) => [p[0], X.yAt(p[0], p[2]) + 0.01, p[2]]);
}
function ribHulk(X) {
  const L = X.L, len = L * 0.8, bone = lin(X.kw('ghost') ? 0xc8c8b0 : 0xd8cfb4);
  // the spine: a chain of vertebrae; the ribs arching down and out; the skull at the bow
  const spine = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; spine.push([-len / 2 + t * len, 0.6 * Math.sin(t * PI) - 0.4, 0]); }
  piece(X, tubeGeo(`spine|${X.fid}`, spine, (t) => 0.7 * (1 - Math.abs(t - 0.45) * 0.8), bone, { sides: 12, dens: 6, bark: true, ro: 0.6 }), X.I, [0, 0, 0], [0, 0, 0], 1);
  for (let i = 0; i < 13; i++) place(X, cutAfter(vertebra(X), 4), [-len / 2 + (i / 12) * len, 0.6 * Math.sin((i / 12) * PI) - 0.4, 0], [0, 0, 0], 1.6 - Math.abs(i / 12 - 0.45) * 1.2);
  const ribs = 11;
  for (let i = 0; i < ribs; i++) {
    const t = 0.12 + (i / (ribs - 1)) * 0.72, x = -len / 2 + t * len, sz = 1 - Math.abs(t - 0.45) * 1.1, R = L * 0.16 * sz, D = L * 0.15 * sz;
    for (const s of [-1, 1]) {
      const pts = []; for (let k = 0; k <= 8; k++) { const a = (k / 8) * PI * 0.95; pts.push([x - k * 0.08, -0.2 + 0.6 * Math.sin(a * 0.6) * 0 - (1 - Math.cos(a)) * D * 0.5, s * Math.sin(a) * R]); }
      const m = piece(X, tubeGeo(`rib|${X.fid}|${i}|${s}`, pts, (u) => 0.32 * sz * (1 - u * 0.6), bone, { sides: 10, dens: 5, bark: true, ro: 0.6 }), X.I, [0, 0, 0], [0, 0, 0], 1);
      if (i % 3 === 1) X.breakParts.push({ mesh: m, at: [x, -D * 0.5, s * R * 0.7], kind: 'rib' });
    }
  }
  const sk = piece(X, PC.skull({ bone: 0xd8cfb4, glow: X.pal.glow, horns: false }), X.I, [len / 2 - 1, -1.2, 0], [0, 0, 0], L * 0.2);
  void sk;
  // three galleons lashed along the spine, guns run out
  X.extent = [len / 2, L * 0.16];
  X.yAt = () => 1.0; X.underY = (x) => -L * 0.15 * (1 - Math.abs(x / (len / 2)));
  const hulls = [[len * 0.12, 1.0, 0, 0.55], [-len * 0.22, 0.6, L * 0.12, 0.4], [-len * 0.22, 0.6, -L * 0.12, 0.4]];
  hulls.forEach(([x, y, z, k], i) => {
    const sp = { HL: L * k, HB: L * 0.12, HD: L * 0.075, P: pat(X, 'plank', hexMix(X.pal.hull, 0x3a4a3a, 0.4), 0x2a2a20), wale: X.pal.trim, wales: [0.15, 0.5], ports: [{ y: 0.35, sp: 1.3 }, { y: 0.65, sp: 1.3 }], glow: X.pal.glow, seed: X.seed + i, dens: 8, sheer: 1.0 };
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.x = Math.sign(z) * 0.05; X.I.add(g);
    const m = piece(X, hullGeo(`ribhull|${X.fid}|${i}`, sp, 0), g, [0, 0, 0], [0, 0, 0], 1);
    X.skins.push({ ent: m.userData.lodEntry, make: (lv) => hullGeo(`ribhull|${X.fid}|${i}`, sp, lv) });
    piece(X, deckGeo(`ribhull|${X.fid}|${i}`, sp, 0.02), g, [0, 0, 0], [0, 0, 0], 1);
    for (let k = 0; k < 2; k++) piece(X, tubeGeo(`rmast|${k}`, [[0, 0, 0], [0, 6 - k, 0]], (t) => 0.2 * (1 - t * 0.5), lin(X.pal.wood), { sides: 8, bark: true }), g, [sp.HL * (0.2 - k * 0.4), 0, 0], [0, 0, 0], 1);
    // tattered sails
    for (let k = 0; k < 2; k++) piece(X, flagGeo(X, k), g, [sp.HL * (0.2 - k * 0.4) + 0.1, 5 - k, 0], [0, PI / 2, 0], 1, flowMat(X, 'mist', X.pal.env, 0.0) && X.mats.paint);
    for (let k = 0; k < 7; k++) X.muzzleHint = [...(X.muzzleHint || []), [x - sp.HL * 0.35 + k * sp.HL * 0.11, y - sp.HD * 0.35, z + (z >= 0 ? 1 : -1) * sp.HB * 0.5]];
    slotsIn(X, x - sp.HL * 0.3, x + sp.HL * 0.3, z - sp.HB * 0.3, z + sp.HB * 0.3, y, 1.2);
    X.hullDecks = [...(X.hullDecks || []), g];
  });
  ellipseRim(X, len / 2, L * 0.16, 0.6);
  X.pads = [];
  for (let x = -len * 0.4; x < len * 0.4; x += 1.6) for (const z of [-L * 0.12, 0, L * 0.12]) X.pads.push({ x, z, y: 1.0, r: 0.7, used: false });
  // ghost-light under it, kelp and anchor chains trailing
  lightPillar(X, [0, -L * 0.2, 0], L * 0.16, L * 0.16, X.pal.glow, 'light');
  for (let i = 0; i < 8; i++) { const x = -len * 0.35 + i * len * 0.1, z = (i % 2 ? 1 : -1) * L * 0.1; piece(X, tubeGeo(`kelp|${i}`, [[x, -1, z], [x + 0.6, -4, z * 1.1], [x - 0.3, -7, z * 1.2], [x + 0.4, -9.5, z]], (t) => 0.18 * (1 - t * 0.7), lin(0x2a4a2a), { sides: 5, dens: 3, bark: true }), X.I, [0, 0, 0], [0, 0, 0], 1); }
  X.top = 8;
  X.ribs = true;
}
function vertebra(X) { return PC.sculpt(`vert|${X.fid}`, () => { const B = new PK.SB(), b = (p) => p.color(0xd8cfb4).pbr(0.6).blend(0.06).bump(0.005, 20, 'noise'); B.p(b(PK.S.cyl(0.5, 0.6, 0.1).rot(0, 0, 90))); B.p(b(PK.S.capsule([0, 0.3, 0], [-0.2, 1.4, 0], 0.18, 0.06))); for (const s of [-1, 1]) B.p(b(PK.S.capsule([0, 0, 0], [0, 0.1, s * 0.9], 0.16, 0.06))); return B.part(); }, 36); }
function flagGeo(X, k) { return PC.sculpt(`rag|${k}|${X.pal.env}`, () => { const B = new PK.SB(); B.h(PK.H.sheet(3.4, 3, 10, 10, (u, v) => [0, 0, 0.3 * Math.sin(u * 3.14) * (0.5 + v)]).color(hexMix(X.pal.env, 0x8a8a70, 0.5)).pbr(0.95).at(0, -1.5, 0)); for (let i = 0; i < 4; i++) B.h(PK.H.sheet(0.6, 0.9, 2, 3).color(0x2a2a20).at(-1 + i * 0.7, -2.6, 0.02)); return B.part(); }, 18); }

// =============================================================================================
// PYRAMID: a stepped ziggurat, upright on a vortex or hung point-down
// =============================================================================================
function pyramid(X) {
  const L = X.L, n = clamp(X.n('terraces', 4), 3, 6);
  const inverted = X.kw('upside-down', 'inverted', 'point-down');
  const W = L * (inverted ? 0.62 : 0.6), th = inverted ? 2.0 : 1.9;
  const wallP = { ...X.pat.wallPlain, rune: X.has('runes') ? { t: th * 0.55, h: 0.35, col: lin(X.pal.glow), k: 1.3 } : null };
  const tiers = [];
  if (inverted) {
    // widest at the top (y = deck), narrowing down to a point
    const top = n * th - 4.6;
    let y = top, w = W;
    for (let i = 0; i < n; i++) {
      const w2 = w * 0.72, spec = { plan: 'rect', w, d: w * 0.86, corner: 0.15, prof: [[0, 0, -th, 'floor'], [w2 / w, 0, -th, 'floor'], [w2 / w, 0, -th * 0.2, 'wall'], [1, 0, -th * 0.12, 'wall'], [1, 0, 0, 'trim'], [0.97, 0, 0.12, 'trim'], [0, 0, 0.12, 'floor']], mats: { wall: wallP, trim: X.pat.trim, floor: X.pat.floor }, dens: 7, seed: X.seed + i };
      const m = piece(X, prismGeo(`zig|${X.fid}|${i}`, spec, 0), X.I, [0, y, 0], [0, 0, 0], 1);
      X.skins.push({ ent: m.userData.lodEntry, make: (lv) => prismGeo(`zig|${X.fid}|${i}`, spec, lv) });
      tiers.push({ y, w, d: w * 0.86 });
      y -= th; w = w2;
    }
    // the point
    const tip = { plan: 'rect', w, d: w * 0.86, corner: 0.1, prof: [[1, 0, 0, 'wall'], [0, 0, -w * 0.9, 'wall']], mats: { wall: wallP }, dens: 7 };
    piece(X, prismGeo(`ziptip|${X.fid}`, tip, 0), X.I, [0, y, 0], [0, 0, 0], 1);
    X.deckY = top + 0.12;
    X.yAt = () => X.deckY;
    X.underY = (x, z) => { const r = Math.max(Math.abs(x) / (W / 2), Math.abs(z) / (W * 0.43)); return top - (1 - r) * n * th * 1.1; };
    X.extent = [W / 2, W * 0.43];
    ellipseRim(X, W / 2, W * 0.43, X.deckY);
    X.rim = X.rim.map((r) => { const k = Math.max(Math.abs(Math.cos(r[5])), Math.abs(Math.sin(r[5]))); return [r[0] / k, r[1], r[2] / k, r[3], r[4], r[5]]; });
    // ledges on every tier for the roosts: pads round each step
    tiers.forEach((t, i) => { if (i === 0) return; for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; X.ledges = [...(X.ledges || []), [Math.cos(a) * t.w * 0.55, t.y - th * 0.15, Math.sin(a) * t.d * 0.55, a]]; } });
    for (let x = -W * 0.4; x <= W * 0.4; x += 1.6) for (let z = -W * 0.35; z <= W * 0.35; z += 1.6) X.pads.push({ x, z, y: X.deckY, r: 0.7, used: false });
    // a temple on the top deck
    reserve(X, 0, 0, W * 0.18);
    const t = building(X, [0, X.deckY, 0], { w: W * 0.32, d: W * 0.26, h: 3.2, roof: 'stepped', solo: true, breakable: true, dens: 8 });
    X.top = t.top + 2;
    slotsIn(X, -W * 0.38, W * 0.38, -W * 0.33, W * 0.33, X.deckY, 1.3);
  } else {
    // upright: on a hanging plinth of rock, or riding its own fire
    const base = -1.0;
    rockBase(X, { rx: W * 0.55, rz: W * 0.48, depth: L * 0.1, top: () => base, topP: X.pat.floor, rockP: { col: lin(hexMix(X.pal.rock, X.pal.stone, 0.5)), col2: lin(hexShade(X.pal.stone, 0.6)) }, seed: X.seed, dens: 6, lobes: 4, mossCol: null, rimNoise: 0.08 });
    let y = base - 0.2, w = W;
    for (let i = 0; i < n; i++) {
      const spec = { plan: 'rect', w, d: w * 0.92, corner: 0.12, prof: [[1.0, 0, -0.4, 'wall'], [1, 0, th * 0.82, 'wall'], ...band(1, th * 0.82, 0.08, 0.14, 'trim').slice(1), [1, 0, th, 'wall'], [0, 0, th, 'floor']], mats: { wall: wallP, trim: X.pat.trim, floor: X.pat.floor }, dens: 7, seed: X.seed + i };
      const m = piece(X, prismGeo(`pyr|${X.fid}|${i}`, spec, 0), X.I, [0, y, 0], [0, 0, 0], 1);
      X.skins.push({ ent: m.userData.lodEntry, make: (lv) => prismGeo(`pyr|${X.fid}|${i}`, spec, lv) });
      tiers.push({ y: y + th, w, d: w * 0.92 });
      y += th; w *= 0.76;
    }
    // the capstone
    const cs = building(X, [0, y, 0], { w, d: w * 0.92, h: 0.4, roof: 'cone', rh: w * 0.8, roofP: X.pat.gold, wallP: X.pat.gold, wallPlainP: X.pat.gold, finial: false, dens: 9, solo: true, breakable: true });
    X.top = cs.top + 1;
    X.capAt = [0, cs.top, 0];
    X.deckY = tiers[0].y;
    X.yAt = (x, z) => { for (let i = tiers.length - 1; i >= 0; i--) if (Math.abs(x) < tiers[i].w / 2 && Math.abs(z) < tiers[i].d / 2) return tiers[i].y; return base; };
    X.pads = [];
    tiers.forEach((t, i) => { const inner = tiers[i + 1]; for (let x = -t.w / 2 + 0.8; x < t.w / 2 - 0.6; x += 1.5) for (let z = -t.d / 2 + 0.8; z < t.d / 2 - 0.6; z += 1.5) { if (inner && Math.abs(x) < inner.w / 2 + 0.6 && Math.abs(z) < inner.d / 2 + 0.6) continue; X.pads.push({ x, z, y: t.y, r: 0.6, used: false }); X.crewSlots.push([x, t.y + 0.01, z]); } });
    // a grand stair up the bow face
    const ns = n * 5, stair = { plan: 'rect', w: n * th * 0.9, d: 3.0, corner: 0.02, prof: [[1, 0, 0, 'f']].concat(Array.from({ length: ns }, (_, k) => [[1 - (k + 1) / ns, 0, (k / ns) * n * th, 'f'], [1 - (k + 1) / ns, 0, ((k + 1) / ns) * n * th, 'f']]).flat()).concat([[0, 0, n * th, 'f']]), mats: { f: X.pat.floor }, dens: 8 };
    piece(X, prismGeo(`stair|${X.fid}`, stair, 0), X.I, [W / 2 - n * th * 0.45 + 0.4, base - 0.2, 0], [0, 0, 0], 1);
    if (X.fid === 'ashur' || X.kw('daemon-fire', 'fire roaring')) { lightPillar(X, [0, -L * 0.24, 0], W * 0.18, L * 0.18, 0xff6a1a, 'fire'); X.fx.fireBase = true; }
    if (X.has('vortex') && X.kw('sand')) vortex(X, [0, -L * 0.08, 0], W * 0.5, L * 0.16, 0xd8b878, 'vortex', 0.55);
    const r = Math.max(W * 0.55, 1);
    void r;
    X.extent = [W / 2, W * 0.46];
    ellipseRim(X, W / 2, W * 0.46, base);
    X.underY = (x, z) => base - L * 0.1 * Math.max(0, 1 - Math.hypot(x / (W * 0.55), z / (W * 0.48)));
    X.cornerTops = tiers.slice(0, 2).flatMap((t) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => [sx * (t.w / 2 - 0.6), t.y, sz * (t.d / 2 - 0.6)]));
  }
  X.tiers = tiers;
}

// =============================================================================================
// CATHEDRAL: a nave, towers at the west front, spires, buttresses, rose window
// =============================================================================================
function cathedral(X) {
  const L = X.L, NL = L * 0.56, NW = L * 0.16, NH = L * 0.17;
  const lifted = X.has('envelopes') || X.has('wings') || X.has('rotors');
  const manor = X.kw('manor');
  if (lifted) bowlBase(X, L * 0.36, L * 0.22, L * 0.12, X.pat.wallPlain, { plan: 'rect', corner: 3.2 });
  else rockBase(X, { rx: L * 0.38, rz: L * 0.25, depth: L * 0.16, top: (x, z) => 0.2 * noise3(x * 0.3, z * 0.3, 2), topP: X.kw('rot', 'garden') ? pat(X, 'moss', 0x4a5a2a, 0x5a4a2a) : pat(X, 'grass', X.pal.grass, 0x6a5a3a), rockP: { col: lin(X.pal.rock), col2: lin(hexShade(X.pal.rock, 0.7)) }, seed: X.seed, dens: 7, lobes: 5 });
  if (!lifted) padsFrom(X, 0.86, 1.4, 0.6);
  const wallP = { ...X.pat.wall, win: { sp: 2.2, dy: NH * 0.45, w: 1.1, h: NH * 0.3, y0: 1.2, glow: lin(X.pal.glow), lit: 0.85 } };
  const glassy = { ...wallP };
  // nave (with the transept crossing it) and the apse
  if (manor) {
    const b = building(X, [-L * 0.06, 0, 0], { w: L * 0.36, d: L * 0.18, h: L * 0.12, roof: 'hip', rh: L * 0.08, wallP: X.pat.wall, solo: true, breakable: true, dens: 8 });
    reserve(X, -L * 0.06, 0, L * 0.18);
    X.naveTop = b.top;
  } else {
    const nave = building(X, [-L * 0.04, 0, 0], { w: NL, d: NW, h: NH, roof: 'hip', rh: NW * 0.75, wallP: glassy, solo: true, breakable: true, breakAt: 3, dens: 8, finial: false });
    building(X, [-L * 0.04, 0, 0], { w: NW * 1.05, d: NL * 0.62, h: NH * 0.95, roof: 'hip', rh: NW * 0.72, wallP: glassy, dens: 8, finial: false });
    building(X, [-L * 0.04 - NL / 2, 0, 0], { plan: 'poly', n: 8, w: NW * 1.0, h: NH * 0.9, roof: 'cone', rh: NW * 0.65, wallP: glassy, dens: 8 });
    reserve(X, -L * 0.04, 0, L * 0.3);
    X.naveTop = nave.top;
    // flying buttresses along both flanks, a gargoyle or statue on each pier
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
      const x = -L * 0.04 - NL * 0.4 + i * NL * 0.2;
      if (Math.abs(x + L * 0.04) < NW * 0.6) continue;
      place(X, PC.buttress({ stone: X.pal.stone }, 2.6, NH * 0.62), [x, 0, s * (NW / 2 + 2.6)], [0, s > 0 ? PI / 2 : -PI / 2, 0], 1);
      X.piers = [...(X.piers || []), [x, NH * 0.62 + 1.0, s * (NW / 2 + 2.6)]];
    }
    // the rose window on the west front (bow)
    const rose = PC.sculpt(`rose|${X.pal.glow}|${X.pal.stone}`, () => { const B = new PK.SB(); B.p(PK.S.torus(1.0, 0.12).rot(0, 0, 90).color(X.pal.stone).pbr(0.85)); B.p(PK.S.cyl(0.95, 0.06, 0.01).rot(0, 0, 90).color(X.pal.glow).glow(1.1)); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; B.p(PK.S.capsule([0.03, 0, 0], [0.03, Math.cos(a) * 0.95, Math.sin(a) * 0.95], 0.035).color(X.pal.stone)); B.p(PK.S.torus(0.18, 0.03).rot(0, 0, 90).at(0.03, Math.cos(a) * 0.62, Math.sin(a) * 0.62).color(X.pal.stone)); } return B.part(); }, 40);
    piece(X, rose, X.I, [-L * 0.04 + NL / 2 + 0.06, NH * 0.62, 0], [0, 0, 0], NW * 0.3);
  }
  // the west towers with their spires, and the crossing spire (or a great dome)
  const nSp = X.n('spires', 3);
  const tw = NW * 0.55, th = NH * 1.45, fx = -L * 0.04 + (manor ? L * 0.2 : NL / 2) + tw * 0.2;
  X.belfries = [];
  const towers = manor ? [[fx, 0, 0]] : [[fx, 0, NW / 2 + tw * 0.2], [fx, 0, -NW / 2 - tw * 0.2]];
  towers.forEach((p, i) => {
    const t = building(X, p, { w: tw, d: tw, h: th, roof: nSp > 0 ? 'spire' : X.S.roof === 'spire' ? 'spire' : undefined, rh: L * 0.18, wallP: { ...X.pat.wall, win: { sp: tw * 0.5, dy: 3, w: 0.6, h: 1.6, y0: 1.5, glow: lin(X.pal.glow), lit: 0.4 } }, solo: true, breakable: true, seed: 30 + i, dens: 8 });
    X.belfries.push([p[0], th - 1.6, p[2]]);
    X.towerTops = [...(X.towerTops || []), [p[0], t.top, p[2]]];
    reserve(X, p[0], p[2], tw);
  });
  if (X.fid === 'principalities' || X.has('domes')) {
    const d = building(X, [-L * 0.04, NH, 0], { plan: 'poly', n: 8, w: NW * 1.3, h: 2.6, roof: 'dome', rh: NW * 0.85, domeP: pat(X, 'tile', 0xb85a3a, 0x8a3a2a), solo: true, breakable: true, dens: 9 });
    X.crossTop = d.top;
  } else if (!manor) {
    const s = building(X, [-L * 0.04, NH + NW * 0.4, 0], { plan: 'poly', n: 8, w: NW * 0.55, h: 2.4, roof: 'spire', rh: L * 0.16, solo: true, breakable: true, dens: 9 });
    X.crossTop = s.top;
  }
  if (nSp > 3) for (let i = 0; i < nSp - 3; i++) { const x = -L * 0.04 - NL * 0.25 + i * NL * 0.2; for (const s of [-1, 1]) building(X, [x, NH, s * NW * 0.42], { plan: 'poly', n: 6, w: 1.0, h: 1.4, roof: 'spire', rh: 3.4, dens: 9 }); }
  X.top = Math.max(...X.towerTops.map((p) => p[1]), X.crossTop || 0) + 1;
  if (!lifted) slotsIn(X, -L * 0.34, L * 0.34, -L * 0.2, L * 0.2, 0, 1.6); else slotsIn(X, -L * 0.32, L * 0.32, -L * 0.18, L * 0.18, 0, 1.6);
  X.crewSlots = X.crewSlots.filter((p) => !(Math.abs(p[0] + L * 0.04) < NL / 2 + 1 && Math.abs(p[2]) < NW / 2 + 0.5)).map((p) => [p[0], X.yAt(p[0], p[2]) + 0.01, p[2]]);
  // what holds it up
  if (X.has('envelopes')) {
    const n = X.n('envelopes', 2), envs = [];
    const bladders = X.kw('bladder', 'swollen');
    for (let i = 0; i < n; i++) { const z = n === 1 ? 0 : ((i / (n - 1)) - 0.5) * L * 0.38, x = n > 2 ? (i % 2 ? -L * 0.12 : L * 0.12) : 0; envs.push(envelope(X, [x, X.top + L * 0.08 + (i % 2) * 1.5, z], bladders ? 0 : L * 0.6, bladders ? L * 0.1 : L * 0.1, { round: bladders, patches: bladders ? 6 : 2, ribs: 4, col: X.pal.env })); }
    X.envs = envs;
    rigging(X, envs.flatMap((E) => [-1, 1].flatMap((s) => [[[E.g.position.x + s * (E.round ? 1 : E.Le * 0.3), E.g.position.y - E.R * 0.85, E.g.position.z], [E.g.position.x * 0.5 + s * L * 0.2, 0.3, E.g.position.z * 0.6]]])), 0x2a2420, 0.05);
    X.top = Math.max(...envs.map((E) => E.g.position.y + E.R)) + 0.5;
  }
  if (X.has('wings')) for (const s of [-1, 1]) { const g = new THREE.Group(); g.position.set(-L * 0.02, NH * 0.9, s * NW * 0.6); g.scale.z = s; X.I.add(g); piece(X, PC.wing('feather', { col: 0xf0e8d8, col2: 0xe0d0b0 }), g, [0, 0, 0], [0, 0, 0], 1.7); X.anim.sway.push({ o: g, axis: 'x', amp: 0.25 * s, speed: 0.9, phase: 0, base: 0.1 * s }); X.wings = [...(X.wings || []), g]; X.breakParts.push({ mesh: g, at: [g.position.x, g.position.y, s * L * 0.3], kind: 'wing' }); }
  if (X.has('rotors')) for (const s of [-1, 1]) for (const x of [-L * 0.25, L * 0.2]) { const g = new THREE.Group(); g.position.set(x, NH * 0.5, s * (L * 0.22 + 1.6)); X.I.add(g); piece(X, propGeo(2.0, 4, X.pal.wood, X.pal.trim, false), g, [0, 0, 0], [0, 0, PI / 2], 1.2); X.anim.spin.push({ o: g, axis: 'y', speed: 6 * s, prop: true }); piece(X, tubeGeo(`rotarm|${x}|${s}`, [[x, NH * 0.5, s * L * 0.18], [x, NH * 0.5, s * (L * 0.22 + 1.6)]], 0.14, lin(X.pal.trim), { sides: 8, me: 0.8 }), X.I, [0, 0, 0], [0, 0, 0], 1); }
  if (X.kw('golden light', 'held aloft by golden')) for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; lightPillar(X, [Math.cos(a) * L * 0.18, -L * 0.3, Math.sin(a) * L * 0.1], 1.6, L * 0.26, X.pal.glow, 'light'); }
  X.bowAt = [fx + tw, 2, 0];
}

// =============================================================================================
// SPIRE: one soaring tower of tiers and terraces, turning rings about it
// =============================================================================================
function spire(X) {
  const L = X.L, crooked = X.kw('crooked'), pagoda = X.S.roof === 'pagoda' && X.n('towers') >= 5, crystal = X.fid === 'labyrinth', fire = X.kw('column of fire', 'riding a column');
  const R0 = L * 0.15;
  // the foot: an inverted cone of rock, crystal or iron under the first terrace
  const footDepth = L * 0.17;
  if (crystal) {
    let y = 0, w = L * 0.55;
    const P = pat(X, 'crystal', X.pal.hull, hexMix(X.pal.hull, X.pal.glow, 0.5));
    for (let i = 0; i < 4; i++) { const spec = { plan: 'rect', w, d: w, corner: 0.05, prof: [[0, 0, -2.2, 'c'], [0.72, 0, -2.2, 'c'], [1, 0, 0, 'c'], [0, 0, 0.05, 'c']], mats: { c: P }, dens: 6 }; const g = new THREE.Group(); g.position.y = y; X.I.add(g); piece(X, prismGeo(`prism|${X.fid}|${i}`, spec, 0), g, [0, 0, 0], [0, i * 0.3, 0], 1); X.anim.slide.push({ o: g, amp: 0.35, speed: 0.4 + i * 0.15, phase: i * 1.3 }); y -= 2.2; w *= 0.72; }
    X.yAt = () => 0.05; X.underY = (x, z) => -Math.max(0, 1 - Math.max(Math.abs(x), Math.abs(z)) / (L * 0.28)) * 8.8; X.extent = [L * 0.28, L * 0.28];
    ellipseRim(X, L * 0.28, L * 0.28, 0); X.rim = X.rim.map((r) => { const k = Math.max(Math.abs(Math.cos(r[5])), Math.abs(Math.sin(r[5]))); return [r[0] / k, r[1], r[2] / k, r[3], r[4], r[5]]; });
    for (let x = -L * 0.24; x <= L * 0.24; x += 1.5) for (let z = -L * 0.24; z <= L * 0.24; z += 1.5) X.pads.push({ x, z, y: 0.05, r: 0.7, used: false });
  } else {
    rockBase(X, { rx: R0 * 1.6, rz: R0 * 1.6, depth: footDepth, top: () => 0, topP: X.pat.floor, rockP: { col: lin(fire ? 0x1a1418 : X.pal.rock), col2: lin(hexShade(fire ? 0x2a1a18 : X.pal.rock, 0.7)) }, veins: fire || X.has('runes') ? { c: lin(fire ? 0xff6a1a : X.pal.glow), k: 1.6, w: 0.03 } : null, seed: X.seed, dens: 7, rimNoise: 0.08, lobes: 3, pow: 0.6, ypow: 0.9, mossCol: null, flat: 99 });
    padsFrom(X, 0.85, 1.4, 0.6);
  }
  // the tiers
  const nT = pagoda ? 9 : crooked ? 5 : 5;
  let y = 0, r = R0, top = 0;
  X.terraces = [];
  const wallP = X.pat.wall;
  for (let i = 0; i < nT; i++) {
    const h = pagoda ? 1.6 : crystal ? 2.2 : 2.8 - i * 0.2, last = i === nT - 1;
    const lean = crooked ? (h1(i + 3) - 0.5) * 0.8 : 0;
    const g = new THREE.Group(); g.position.set(lean, y, lean * 0.5); g.rotation.y = crooked ? (i * 0.12) : 0; X.I.add(g);
    const b = building(X, [0, 0, 0], { plan: pagoda ? 'rect' : X.fid === 'thousandgods' ? 'rect' : 'poly', n: 8, w: r * 2, d: r * 2, h, roof: pagoda ? 'pagoda' : last ? 'spire' : 'flat', rh: last ? L * 0.22 : r * 0.35, upturn: pagoda ? 0.7 : 0, wallP: crystal ? pat(X, 'crystal', X.pal.hull, X.pal.glow) : wallP, parent: g, solo: last || i === 2, breakable: last || i === 2, seed: i, dens: 8, foot: 1.02, y0: -0.1 });
    if (pagoda) for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + PI / 4; X.corners = [...(X.corners || []), [lean + Math.cos(a) * r * 1.55, y + h + 0.1, lean * 0.5 + Math.sin(a) * r * 1.55]]; }
    X.terraces.push({ y: y + h + (pagoda ? 0 : 0.3), r, x: lean });
    if (!pagoda && !last && i % 2 === 0) slotsIn(X, lean - r * 0.6, lean + r * 0.6, -r * 0.6, r * 0.6, y + h + 0.3, 1.0);
    y += h + (pagoda ? r * 0.25 : 0.3); top = b.top;
    r *= pagoda ? 0.9 : 0.82;
    // slender side spires on the lower tiers
    if (!pagoda && X.has('spires') && i < 2) for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + PI / 4 + i * 0.4, rr = r * 1.15; building(X, [Math.cos(a) * rr, 0, Math.sin(a) * rr], { plan: 'circle', w: 1.0, h: 2.6 + i, roof: 'spire', rh: 3.5, parent: g, dens: 9 }); }
  }
  X.top = top + 1;
  X.spireTop = [0, top, 0];
  // rings, wheels and the rest of the lift
  if (X.kw('astrolabe', 'rings', 'orrery') || X.fid === 'aethel' || X.fid === 'glimmer') astrolabe(X, [0, y * 0.45, 0], L * 0.36, 3, { P: X.pat.trim, speed: 0.3 });
  if (X.has('wheels') || X.kw('slave-wheel', 'sacred wheels')) for (const s of [-1, 1]) { const g = new THREE.Group(); g.position.set(0, 1.6, s * (R0 * 1.75)); X.I.add(g); const sub = new THREE.Group(); sub.rotation.x = PI / 2; g.add(sub); const spin = new THREE.Group(); sub.add(spin); piece(X, PC.gear({ metal: X.pal.trim, trim: X.pal.metal }), spin, [0, 0, 0], [0, 0, 0], L * 0.1); X.anim.spin.push({ o: spin, axis: 'y', speed: 0.8 * s }); }
  if (X.has('envelopes')) { const n = X.n('envelopes', 1), envs = []; for (let i = 0; i < n; i++) envs.push(envelope(X, [0, X.top + L * 0.12, n === 1 ? 0 : (i - 0.5) * L * 0.4], L * 0.55, L * 0.11, { ribs: 3, patches: X.kw('stitched') ? 9 : 2, col: X.pal.env })); X.envs = envs; X.top += L * 0.25; rigging(X, envs.flatMap((E) => [-1, 1].map((s) => [[E.g.position.x + s * E.Le * 0.3, E.g.position.y - E.R * 0.85, E.g.position.z], [s * R0, top - 1, 0]])), 0x2a2420, 0.05); }
  if (fire) { lightPillar(X, [0, -L * 0.36, 0], R0 * 0.9, L * 0.26, 0xff6a1a, 'fire'); X.fx.fireBase = true; }
  X.crewSlots = X.crewSlots.concat(X.pads.filter((p) => !p.used).map((p) => [p.x, p.y + 0.01, p.z]));
}

// =============================================================================================
// PALACE: tiers of halls on a platform (over a cloud, a whirlwind, or a raft of balloons)
// =============================================================================================
function palace(X) {
  const L = X.L, PW = L * 0.62, PD = L * 0.46;
  const cloud = X.kw('cloud of', 'swirling cloud'), wind = X.kw('whirlwind', 'roaring whirlwind', 'vortex') || X.has('vortex');
  const raft = X.has('envelopes');
  // the platform: a thick slab with a carved edge, a rock or bowl under it
  if (raft) bowlBase(X, PW / 2, PD / 2, L * 0.08, X.pat.wallPlain, { plan: 'rect', corner: 2.4 });
  else rockBase(X, { rx: PW * 0.55, rz: PD * 0.55, depth: L * (cloud || wind ? 0.1 : 0.15), top: () => 0, topP: X.pat.floor, rockP: { col: lin(X.pal.rock), col2: lin(hexShade(X.pal.rock, 0.7)) }, seed: X.seed, dens: 7, rimNoise: 0.06, lobes: 4, flat: 99, mossCol: cloud ? null : undefined });
  if (!raft) padsFrom(X, 0.86, 1.5, 0.5);
  const slab = { plan: 'rect', w: PW, d: PD, corner: 1.2, prof: [[1.02, 0, -1.2, 'wallPlain'], [1.02, 0, 0.6, 'wallPlain'], ...band(1.02, 0.6, 0.12, 0.2, 'trim').slice(1), [1.02, 0, 0.9, 'floor'], [0, 0, 0.9, 'floor']], mats: { wallPlain: X.pat.wallPlain, trim: X.pat.trim, floor: X.pat.floor }, dens: 7, seed: X.seed };
  piece(X, prismGeo(`pslab|${X.fid}`, slab, 0), X.I, [0, 0, 0], [0, 0, 0], 1);
  X.yAt = (x, z) => (Math.abs(x) < PW / 2 && Math.abs(z) < PD / 2 ? 0.9 : 0);
  // the tiers of the palace
  const tiers = clamp(X.n('decks', 3), 2, 4), felt = X.fid === 'khanate';
  let y = 0.9, w = PW * 0.55, d = PD * 0.55, topB = null;
  reserve(X, 0, 0, w * 0.6);
  for (let i = 0; i < tiers; i++) {
    const last = i === tiers - 1;
    const b = building(X, [0, y, 0], { w, d, h: 2.6, roof: last ? (felt ? 'dome' : undefined) : X.S.roof === 'pagoda' ? 'pagoda' : 'flat', rh: X.S.roof === 'pagoda' ? Math.min(w, d) * 0.12 : undefined, upturn: 0.6, wallP: felt ? X.pat.felt : X.pat.wall, domeP: felt ? X.pat.felt : undefined, solo: last, breakable: last, seed: i, dens: 8 });
    slotsIn(X, -w * 0.45, w * 0.45, -d * 0.45, d * 0.45, y + 2.6 + (X.S.roof === 'pagoda' && !last ? Math.min(w, d) * 0.12 : 0.3), 1.2);
    y += 2.6 + (X.S.roof === 'pagoda' ? Math.min(w, d) * 0.12 + 0.1 : 0.3); topB = b;
    w *= 0.72; d *= 0.72;
  }
  X.top = topB.top + 1;
  X.palaceTop = topB.top;
  // corner towers or minarets
  const minaret = X.has('minarets') || X.S.roof === 'dome';
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * (PW / 2 - 1.4), z = sz * (PD / 2 - 1.4);
    const t = building(X, [x, 0.9, z], { plan: minaret ? 'poly' : 'circle', n: 8, w: minaret ? 1.4 : 2.4, h: minaret ? L * 0.3 : L * 0.16, roof: minaret ? 'onion' : X.S.roof === 'pagoda' ? 'pagoda' : undefined, domeP: X.pat.gold, solo: true, breakable: sx > 0, seed: 40 + sx + sz * 2, dens: 9 });
    reserve(X, x, z, 1.6);
    X.towerTops = [...(X.towerTops || []), [x, t.top, z]];
    X.top = Math.max(X.top, t.top);
  }
  // domes over the halls
  const nd = X.n('domes');
  for (let i = 0; i < nd; i++) { const p = take(X, 2.6, 'centre'); if (!p) break; const b = building(X, [p[0], 0.9, p[2]], { plan: 'poly', n: 8, w: 3.4, h: 2.0, roof: X.S.roof === 'onion' ? 'onion' : 'dome', rh: 2.6, domeP: X.kw('violet') ? pat(X, 'tile', 0x7a3aaa, 0x5a2a8a) : X.pat.gold, dens: 9, seed: 60 + i }); void b; }
  // gardens and pools
  if (X.has('gardens') || X.has('terraces')) for (let i = 0; i < 6; i++) { const p = take(X, 1.3, 'edge'); if (p) place(X, PC.tree(X.kw('cherry', 'blossom') || X.fid === 'tianlong' ? 'blossom' : 'oak', { bark: 0x5a4030, leaf: 0x3a6a2a, leaf2: 0x5a8a3a }, i), [p[0], 0.85, p[2]], [0, i, 0], 0.9); }
  slotsIn(X, -PW * 0.45, PW * 0.45, -PD * 0.45, PD * 0.45, 0.9, 1.6);
  X.crewSlots = X.crewSlots.filter((p) => p[1] > 1 || !(Math.abs(p[0]) < PW * 0.3 && Math.abs(p[2]) < PD * 0.3));
  if (cloud) mist(X, [0, -1.5, 0], L * 0.36, L * 0.14, hexMix(X.pal.glow, 0xffffff, 0.5), 0.55, 3);
  if (wind) vortex(X, [0, -1, 0], L * 0.32, L * 0.2, X.kw('sun', 'golden') ? 0xf0d890 : 0xd8e8f0, 'vortex', 0.55);
  if (raft) { const n = X.n('envelopes', 4), envs = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU + PI / 4; envs.push(envelope(X, [Math.cos(a) * PW * 0.3, X.top + L * 0.06, Math.sin(a) * PD * 0.3], X.fid === 'westmark' ? L * 0.5 : 0, L * 0.1, { round: X.fid !== 'westmark', patches: 3, col: i % 2 ? X.pal.env : hexMix(X.pal.env, X.pal.trim, 0.3) })); } X.envs = envs; rigging(X, envs.flatMap((E) => [0, 1, 2].map((k) => { const a = (k / 3) * TAU; return [[E.g.position.x + Math.cos(a) * E.R * 0.5, E.g.position.y - E.R * 0.85, E.g.position.z + Math.sin(a) * E.R * 0.5], [E.g.position.x * 1.2 + Math.cos(a), 1, E.g.position.z * 1.2 + Math.sin(a)]]; })), 0x2a2420, 0.05); X.top = Math.max(...envs.map((E) => E.g.position.y + E.R)) + 0.5; }
  if (X.has('windmills')) for (const s of [-1, 1]) { const x = -PW * 0.3, z = s * PD * 0.38; const b = building(X, [x, 0.9, z], { plan: 'poly', n: 8, w: 2.0, h: 4.5, roof: 'cone', taper: 0.75, dens: 9 }); const g = new THREE.Group(); g.position.set(x + 0.9, b.top - 1.4, z); X.I.add(g); piece(X, PC.windSails({ wood: X.pal.wood, cloth: 0xe8dcc0 }), g, [0, 0, 0], [0, 0, 0], 1.2); X.anim.spin.push({ o: g, axis: 'x', speed: 0.7 }); }
}

// =============================================================================================
// BEAST: a colossal creature carrying its own world
// =============================================================================================
function beast(X) {
  if (X.kw('tortoise', 'turtle')) return tortoise(X);
  return wyrm(X);
}
function tortoise(X) {
  const L = X.L, SW = L * 0.62, SD = L * 0.5, SH = L * 0.18;
  const shellP = pat(X, 'scute', X.pal.hull, hexMix(X.pal.hull, 0x8a7a4a, 0.4));
  const prof = [[0, 0, -2.6, 'p'], [0.86, 0, -2.6, 'p'], [0.98, 0, -1.6, 'p', undefined, 's'], [1.03, 0, -0.6, 'rim'], [1.03, 0, -0.3, 'rim'], [1.0, 0, 0.0, 's'], ...cap(1.0, 0.0, SH, 'dome', 's')];
  const spec = { plan: 'circle', w: SW, d: SD, prof, mats: { p: pat(X, 'scute', hexMix(X.pal.hull, 0xc8b878, 0.5), 0x8a7a4a), rim: pat(X, 'scute', hexShade(X.pal.hull, 0.7), X.pal.hull), s: shellP }, dens: 6, seed: X.seed, holes: true };
  const sm = piece(X, prismGeo(`shell|${X.fid}`, spec, 0), X.I, [0, 0, 0], [0, 0, 0], 1);
  X.skins.push({ ent: sm.userData.lodEntry, make: (lv) => prismGeo(`shell|${X.fid}`, spec, lv) });
  // a mossy forest crown on the shell (a low rock of earth set into its top)
  rockBase(X, { rx: SW * 0.36, rz: SD * 0.36, depth: 1.2, at: [0, SH * 0.82, 0], top: (x, z) => 0.8 * Math.max(0, noise3(x * 0.2, z * 0.2, 4) - 0.3) + 1.4 * Math.max(0, 1 - Math.hypot(x / (SW * 0.3), z / (SD * 0.3))), topP: pat(X, 'grass', 0x4f7a2c, 0x6a5a2a), rockP: { col: lin(0x4a5a2a), col2: lin(0x3a3a20) }, seed: X.seed, dens: 7, lobes: 2 });
  padsFrom(X, 0.85, 1.5, 0.9);
  X.underY = (x, z) => -2.6 * Math.min(1, 1.5 - Math.hypot(x / (SW / 2), z / (SD / 2)));
  X.extent = [SW / 2, SD / 2];
  ellipseRim(X, SW * 0.5, SD * 0.5, -0.3);
  // head on a long neck, flippers stroking, a stub of a tail
  const neck = new THREE.Group(); neck.position.set(SW / 2 - 1, -1.0, 0); X.I.add(neck);
  piece(X, turtleNeck(X), neck, [0, 0, 0], [0, 0, 0], L * 0.11);
  X.anim.sway.push({ o: neck, axis: 'y', amp: 0.12, speed: 0.25, phase: 0 });
  X.anim.sway.push({ o: neck, axis: 'z', amp: 0.05, speed: 0.33, phase: 1 });
  X.head = neck; X.mouthAt = [SW / 2 + L * 0.3, 0.6, 0];
  X.flippers = [];
  for (const [fx, s] of [[0.28, 1], [0.28, -1], [-0.3, 1], [-0.3, -1]]) {
    const g = new THREE.Group(); g.position.set(fx * SW, -1.4, s * SD * 0.42); g.scale.z = s; X.I.add(g);
    piece(X, flipper(X, fx > 0), g, [0, 0, 0], [0, 0, 0], L * (fx > 0 ? 0.13 : 0.09));
    X.anim.sway.push({ o: g, axis: 'x', amp: 0.35 * s, speed: 0.5, phase: fx > 0 ? 0 : PI, base: 0.15 * s });
    X.anim.sway.push({ o: g, axis: 'y', amp: 0.25 * s, speed: 0.5, phase: (fx > 0 ? 0 : PI) + PI / 2 });
    X.flippers.push(g);
  }
  X.top = SH + 2 + L * 0.2;
  X.crewSlots = X.pads.filter((p) => !p.used).map((p) => [p.x, p.y + 0.01, p.z]);
}
function turtleNeck(X) {
  return PC.sculpt(`tneck|${X.pal.hull}|${X.pal.glow}`, () => {
    const B = new PK.SB(), sk = (p, k = 0.08) => p.color(hexMix(X.pal.hull, 0x8a7a5a, 0.5)).pbr(0.75).blend(k).bump(0.01, 10, 'scales');
    PK.SKH.limb(B, [[0, 0, 0], [0.8, 0.2, 0], [1.6, 0.5, 0], [2.3, 0.6, 0]], [0.55, 0.45, 0.38, 0.34], hexMix(X.pal.hull, 0x8a7a5a, 0.5), { k: 0.12, r: 0.75, bump: [0.012, 9, 'scales'] });
    B.p(sk(PK.S.ellipsoid(0.62, 0.42, 0.45).at(2.6, 0.62, 0), 0.12));
    B.p(sk(PK.S.ellipsoid(0.45, 0.2, 0.35).at(3.0, 0.48, 0), 0.08));
    B.p(PK.S.ellipsoid(0.42, 0.03, 0.36).at(3.05, 0.45, 0).cut(0.02).color(0x2a1a14));
    for (const s of [-1, 1]) { B.p(PK.S.sphere(0.09).at(2.95, 0.75, s * 0.32).color(X.pal.glow).glow(0.8)); B.p(sk(PK.S.ellipsoid(0.16, 0.06, 0.1).at(2.9, 0.84, s * 0.3), 0.04)); }
    B.p(PK.S.ellipsoid(0.5, 0.1, 0.4).at(3.0, 0.75, 0).color(0x6a5a3a).blend(0.06).bump(0.02, 6, 'ridges'));
    return B.part();
  }, 22);
}
function flipper(X, fore) {
  return PC.sculpt(`flip|${fore}|${X.pal.hull}`, () => {
    const B = new PK.SB(), c = hexMix(X.pal.hull, 0x8a7a5a, 0.5);
    PK.SKH.limb(B, [[0, 0, 0], [0.3, -0.2, 0.6], [0.2, -0.3, 1.4], [-0.3, -0.35, 2.3]], [0.4, 0.3, 0.22, 0.08], c, { k: 0.08, r: 0.75, bump: [0.01, 10, 'scales'] });
    B.p(PK.S.ellipsoid(0.5, 0.1, 1.0).rot(0, -20, 0).at(0.0, -0.32, 1.6).color(c).pbr(0.75).blend(0.1).bump(0.01, 10, 'scales'));
    return B.part();
  }, 20);
}
function wyrm(X) {
  const L = X.L;
  // the body: a scaled loft along the spine, head and neck forward, tail aft; wings beat slowly
  const scale = lin(X.pal.hull), belly = lin(hexMix(X.pal.hull, 0xc8a870, 0.5));
  const spine = []; for (let i = 0; i <= 14; i++) { const t = i / 14; spine.push([L * (0.32 - t * 0.78), -0.8 + 0.8 * Math.sin(t * PI) - (t > 0.6 ? (t - 0.6) * 4 : 0), Math.sin(t * 5) * (t > 0.5 ? (t - 0.5) * 3 : 0)]); }
  const rad = (t) => L * 0.11 * (t < 0.12 ? 0.6 + t * 3.3 : t < 0.45 ? 1 : Math.max(0.06, 1 - (t - 0.45) * 1.75));
  piece(X, scaleTube(X, `wbody|${X.fid}`, spine, rad, scale, belly), X.I, [0, 0, 0], [0, 0, 0], 1);
  // neck and head
  const neck = new THREE.Group(); neck.position.set(L * 0.3, 0.2, 0); X.I.add(neck);
  const npts = [[0, 0, 0], [L * 0.1, L * 0.06, 0], [L * 0.18, L * 0.1, 0], [L * 0.24, L * 0.09, 0]];
  piece(X, scaleTube(X, `wneck|${X.fid}`, npts, (t) => L * 0.07 * (1 - t * 0.45), scale, belly), neck, [0, 0, 0], [0, 0, 0], 1);
  const head = piece(X, dragonHead(X), neck, [L * 0.24, L * 0.09, 0], [0, 0, 0], L * 0.075);
  void head;
  X.anim.sway.push({ o: neck, axis: 'y', amp: 0.08, speed: 0.3, phase: 0 });
  X.anim.sway.push({ o: neck, axis: 'z', amp: 0.04, speed: 0.4, phase: 1 });
  X.head = neck; X.mouthAt = [L * 0.3 + L * 0.24 + L * 0.12, L * 0.09 + 0.2, 0];
  // wings: great membranes from the shoulders
  X.wings = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(L * 0.12, L * 0.06, s * L * 0.08); g.scale.z = s; X.I.add(g);
    const w = piece(X, PC.wing('membrane', { col: hexShade(X.pal.hull, 0.8), col2: hexMix(X.pal.hull, 0x8a3a2a, 0.35), bone: hexShade(X.pal.hull, 0.6) }), g, [0, 0, 0], [0, 0, 0], L * 0.075);
    void w;
    X.anim.sway.push({ o: g, axis: 'x', amp: 0.42 * s, speed: 0.55, phase: 0, base: -0.1 * s });
    X.wings.push(g); X.breakParts.push({ mesh: g, at: [L * 0.1, L * 0.1, s * L * 0.3], kind: 'wing' });
  }
  // legs tucked under
  for (const [x, s] of [[L * 0.2, 1], [L * 0.2, -1], [-L * 0.12, 1], [-L * 0.12, -1]]) piece(X, wyrmLeg(X), X.I, [x, -L * 0.06, s * L * 0.08], [0, 0, 0], [L * 0.06, L * 0.06, s * L * 0.06]);
  // tail sway
  X.yAt = (x) => 0.8 * Math.sin(clamp((L * 0.32 - x) / (L * 0.78), 0, 1) * PI) - 0.8 + L * 0.1;
  X.underY = (x) => X.yAt(x) - L * 0.2;
  X.extent = [L * 0.3, L * 0.09];
  ellipseRim(X, L * 0.3, L * 0.1, L * 0.1);
  // the citadel on its back
  const back = [[L * 0.08, 0], [-L * 0.08, 0], [-L * 0.2, 0]];
  X.towerTops = [];
  back.forEach(([x], i) => { const y = X.yAt(x) - 0.4; const t = building(X, [x, y, 0], { plan: 'circle', w: 2.4 - i * 0.3, h: 4.5 - i, roof: 'spire', rh: 3.5, solo: true, breakable: i === 0, seed: i, dens: 9, y0: -1.2 }); X.towerTops.push([x, t.top, 0]); });
  for (let i = 0; i < back.length - 1; i++) wallRun(X, [back[i][0], X.yAt(back[i][0]) - 0.4, 0], [back[i + 1][0], X.yAt(back[i + 1][0]) - 0.4, 0], 2.0, 1.8, { y0: -1 });
  X.top = Math.max(...X.towerTops.map((p) => p[1])) + 1;
  for (let x = -L * 0.25; x < L * 0.25; x += 1.4) for (const z of [-1.4, 1.4]) { X.pads.push({ x, z, y: X.yAt(x), r: 0.6, used: false }); X.crewSlots.push([x, X.yAt(x) + 0.01, z]); }
}
function scaleTube(X, key, pts, rad, col, belly) {
  return levels(`bh|${key}`, (lv) => {
    const g = tubeGeo(`${key}|raw`, pts, rad, col, { sides: 18, dens: 5, last: 9 })[lv];
    if (!g || !g.attributes.color) return g;
    // belly scutes paler, scale relief in the colour
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color;
    const c = g.clone(), CC = c.attributes.color;
    for (let i = 0; i < P.count; i++) {
      const down = clamp(-N.getY(i), 0, 1), sc = 0.82 + 0.25 * Math.abs(Math.sin(P.getX(i) * 5.5 + Math.round(P.getY(i) * 4) * 1.6) * Math.sin(P.getZ(i) * 5 + P.getY(i) * 3));
      CC.setXYZ(i, lerp(C.getX(i), belly[0], down) * sc, lerp(C.getY(i), belly[1], down) * sc, lerp(C.getZ(i), belly[2], down) * sc);
    }
    return c;
  });
}
function dragonHead(X) {
  return PC.sculpt(`whead|${X.pal.hull}|${X.pal.glow}`, () => {
    const B = new PK.SB(), c = X.pal.hull, hide = (p, k = 0.08) => p.color(c).pbr(0.55).blend(k).bump(0.012, 9, 'scales');
    B.p(hide(PK.S.ellipsoid(0.8, 0.55, 0.6).at(0.2, 0.1, 0), 0.15));
    B.p(hide(PK.S.capsule([0.5, 0.05, 0], [1.6, -0.05, 0], 0.38, 0.2), 0.15));
    B.p(hide(PK.S.capsule([0.4, -0.35, 0], [1.5, -0.4, 0], 0.26, 0.14), 0.1));
    B.p(PK.S.ellipsoid(0.7, 0.07, 0.3).at(1.05, -0.24, 0).cut(0.03).color(0x4a0a0a));
    for (const s of [-1, 1]) {
      PK.SKH.horn(B, [[0.0, 0.45, s * 0.35], [-0.5, 0.8, s * 0.55], [-1.0, 0.9, s * 0.5], [-1.4, 0.7, s * 0.35]], 0.16, 0xd8c8a0, { rings: 8 });
      B.p(PK.S.sphere(0.1).at(0.72, 0.28, s * 0.3).color(X.pal.glow).glow(1.6));
      B.p(hide(PK.S.ellipsoid(0.25, 0.1, 0.1).at(0.65, 0.4, s * 0.28), 0.05));
      for (let i = 0; i < 6; i++) B.p(PK.S.cone(0.04, 0, 0.16).rot(180, 0, 0).at(0.7 + i * 0.15, -0.16, s * (0.24 - i * 0.02)).color(0xf0e8d0).blend(0.01));
    }
    for (let i = 0; i < 5; i++) B.p(hide(PK.S.cone(0.1, 0, 0.35).rot(0, 0, 60).at(-0.2 - i * 0.2, 0.55 - i * 0.05, 0), 0.03));
    return B.part();
  }, 26);
}
function wyrmLeg(X) {
  return PC.sculpt(`wleg|${X.pal.hull}`, () => {
    const B = new PK.SB();
    PK.SKH.limb(B, [[0, 0, 0], [0.3, -0.8, 0.2], [0.9, -1.0, 0.3], [1.3, -1.2, 0.25]], [0.45, 0.3, 0.2, 0.12], X.pal.hull, { k: 0.08, r: 0.55, bump: [0.01, 9, 'scales'] });
    for (let i = 0; i < 3; i++) B.p(PK.S.cone(0.06, 0, 0.35).rot(0, 0, -100).at(1.4, -1.22, 0.1 + i * 0.12).color(0x2a2420).blend(0.02));
    return B.part();
  }, 20);
}

export const FORMS = { airship, citadel, island, crag, hulk, pyramid, cathedral, spire, palace, beast };
void finialAt; void merlons; void waterfall; void ringGeo; void rockGeo; void flowMat; void take;
