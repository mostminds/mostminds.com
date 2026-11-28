// Fringe folk: the serpent-people of the jungle temple-cities and four odd mounts of the far realms.
//
//   bodies.naga(def, o)        serpent warrior: kris-guard / cobra guard / viper archer / blood sorcerer   kind 'fringe.naga'
//                              o: skin, belly, armor, trim, arms (2 | 4), weapon ('glaive' | 'longbow' | 'staff'), hood, robe
//   bodies.warCamel(def, o)    two-humped war-camel with a steppe lancer                                  kind 'beast.rider'
//   bodies.hippoRider(def, o)  war-hippocampus (horse forequarters, seahorse tail) and sea-elf mariner    kind 'fringe.hippo'
//   bodies.swanRider(def, o)   giant swan and halfling scout                                             kind 'fringe.swan'
//   bodies.mechOwl(def, o)     steam-driven brass owl                                                     kind 'titan.bird'
//
// Authoring convention (as titans.js): a model is laid out in ONE space, its rest pose (Y up, facing +Z, feet on
// y = 0). Every node records the point it pivots about (`o`); finish() moves each node's pieces into the node's own
// space. The mounts are authored at their final size (a man stands 1.0 tall) and shrunk by the unit's scale before
// finish(), since the whole model is scaled back up by it; the rider is a humanoid() in its riding pose, seated with
// its own scale divided by the unit's.
//
// Rig keys:
//   naga      the humanoid's torso / head / arms / forearms / hands / weapon (+ string, arrow), and
//             trunk (the rising serpent body, pivot on the ground), coil[] (the tail, root to tip),
//             arms2[] forearms2[] hands2[] (the lower pair of a four-armed naga)
//   mounts    body, mneck[], mhead[], mjaw[], legs[] shins[] paws[] (FL FR BL BR, or only FL FR), tail[]; the rider
//             keeps the stock upper-body keys (prefix r_ on its node names)
//   swan      body (trunk), neck, mhead[], mjaw[], legs[2], shins[2], wings[2], wingtips[2], tail[] + rider
//   owl       the great-bird rig of titans.js: torso, neck, head, jaw, legs, shins, wings, wingtips, tail, plus
//             gears[] (spinning cogs) and the plain value `steam`
import * as THREE from 'three';
import { S, H, rgb, noise3 } from '../sculpt.js';
import { weapon as makeWeapon } from './weapons.js';
import { humanoid, poseCarried, animators as HUM_ANIM } from './humanoid.js';
import { proportions } from './anatomy.js';
import { animators as TITAN_ANIM } from './titans.js';
import { animators as BEAST_ANIM } from './beasts.js';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => mul3(a, 1 / (len3(a) || 1e-9));
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const col = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const sideX = (sx) => (p) => [p[0] * sx, p[1], p[2]];

function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- colour ----------
const _c = new THREE.Color(), _c2 = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
function tone(hex, dh = 0, ds = 0, dl = 0) {
  _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL(((_hsl.h + dh) % 1 + 1) % 1, clamp(_hsl.s + ds), clamp(_hsl.l + dl), THREE.SRGBColorSpace);
  return _c.getHex();
}
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), t).getHex(); }
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------- placement ----------
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler(), _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3();
function frameEuler(yDir, zHint = [0, 0, 1]) {
  _vy.set(yDir[0], yDir[1], yDir[2]).normalize();
  _vz.set(zHint[0], zHint[1], zHint[2]);
  _vx.crossVectors(_vy, _vz);
  if (_vx.lengthSq() < 1e-8) _vx.crossVectors(_vy, _vz.set(1, 0, 0));
  if (_vx.lengthSq() < 1e-8) _vx.crossVectors(_vy, _vz.set(0, 0, 1));
  _vx.normalize();
  _vz.crossVectors(_vx, _vy);
  _eu.setFromRotationMatrix(_m4.makeBasis(_vx, _vy, _vz), 'XYZ');
  return [_eu.x / DEG, _eu.y / DEG, _eu.z / DEG];
}
/** turn a piece built along +Y so +Y points along yDir (and +Z toward zHint), then move it to origin */
function orient(piece, origin, yDir, zHint) {
  const e = frameEuler(yDir, zHint);
  return piece.rot(e[0], e[1], e[2]).at(origin[0], origin[1], origin[2]);
}
/** tapered capsule from a to b whose local Y follows the bone */
function bone(a, b, ra, rb = ra, zHint) { return orient(S.capsule([0, 0, 0], [0, len3(sub3(b, a)), 0], ra, rb), a, sub3(b, a), zHint); }
function curve(pts, n) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const out = [];
  for (let i = 0; i <= n; i++) { const v = c.getPoint(i / n); out.push([v.x, v.y, v.z]); }
  return out;
}
const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// ---------- nodes ----------
function node(name, parent, o, extra = {}) { return { name, parent, o, prims: [], hard: [], ...extra }; }
function finish(nodes) {
  const by = new Map(nodes.map((n) => [n.name, n]));
  return nodes.map((n) => {
    const par = n.parent ? by.get(n.parent) : null;
    const pos = n.pos ?? (par ? sub3(n.o, par.o) : n.o);
    const prims = flat(n.prims), hard = flat(n.hard);
    if (n.o[0] || n.o[1] || n.o[2]) { for (const p of prims) p.at(-n.o[0], -n.o[1], -n.o[2]); for (const h of hard) h.at(-n.o[0], -n.o[1], -n.o[2]); }
    const out = { name: n.name, pos, prims, hard };
    if (n.parent) out.parent = n.parent;
    if (n.rig) out.rig = n.rig;
    if (n.rot) out.rot = n.rot;
    if (n.detail) out.detail = n.detail;
    if (n.minRes) out.minRes = n.minRes;
    return out;
  });
}
function rigOf() {
  const nodes = [];
  const N = (name, parent, o, extra) => { const n = node(name, parent, o, extra); nodes.push(n); return n; };
  N.nodes = nodes;
  return N;
}
/** scale an unfinished node list about the origin (detail rises so the sculpt keeps its density once scaled back up) */
function scaleNodes(nodes, u) {
  for (const n of nodes) {
    n.o = mul3(n.o, u); if (n.pos) n.pos = mul3(n.pos, u);
    for (const p of flat(n.prims)) p.scale(u);
    for (const h of flat(n.hard)) h.scale(u);
    n.detail = (n.detail ?? 1) / u; if (n.minRes) n.minRes /= u;
  }
}

// ---------- crisp pieces ----------
function clawGeo(hook, aspect, flatX = 1) {
  return cached(`claw${hook}:${aspect}:${flatX}`, () => {
    const g = new THREE.ConeGeometry(aspect, 1, 7, 4);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setXYZ(i, p.getX(i) * flatX, y, p.getZ(i) + hook * y * y); }
    g.computeVertexNormals();
    return g;
  });
}
function claw(len, r, color, hook = 0.3, flatX = 1) { return H.geo(clawGeo(hook, Math.max(0.05, Math.round((r / len) * 20) / 20), flatX)).scale(len).color(color).pbr(0.32, 0); }
const spike = (base, dir, len, r, color, toward = [0, 0, 1], hook = 0.3, flatX = 1) => orient(claw(len, r, color, hook, flatX), base, dir, toward);

/** eyeball looking along +Z. look: { iris, rim, pupil, white, glow, slit } */
function eyeball(r, look = {}) {
  const iris = rgb(look.iris ?? 0xffc21a), rim = rgb(look.rim ?? 0x5a2a08), pupil = rgb(look.pupil ?? 0x080606), white = rgb(look.white ?? 0x2a1a10);
  const slit = look.slit !== false;
  const h = H.sphere(1, 16).shade((x, y, z) => {
    if (z < 0.2) return white;
    const d = Math.hypot(x, y);
    if (slit ? (Math.abs(x) < 0.1 * (1.15 - Math.abs(y) * 0.9) && Math.abs(y) < 0.56) : d < 0.3) return pupil;
    if (d < 0.68) return mixRgb(iris, rim, clamp((d - 0.3) / 0.38));
    return white;
  }).color(look.white ?? 0x2a1a10).pbr(0.12, 0).scale(r);
  if (look.glow) h.glow(look.glow);
  return h;
}
const eyeAt = (p, dir, r, look) => orient(eyeball(r, look).rot(-90, 0, 0), p, dir);

// ---------- feathers (and fins, and brass plates) ----------
function featherGeo(hw, shape = 0, rows = 5) {
  return cached(`fth${hw}:${shape}:${rows}`, () => {
    const pos = [], idx = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      let w = hw * (0.35 + 0.65 * Math.sin(Math.min(1, t * 1.35) * Math.PI * 0.5));
      if (shape === 1) w *= t > 0.55 ? Math.pow(1 - (t - 0.55) / 0.45, 0.8) : 1; else if (shape === 2) w *= t > 0.6 ? (1 - (t - 0.6) / 0.4) * (j % 2 ? 1 : 0.55) + 0.02 : 1; else w *= t > 0.82 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.82) / 0.18, 2))) : 1;
      pos.push(-w, t, -w * 0.22, 0, t, 0, w, t, -w * 0.22);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < 2; i++) { const a = j * 3 + i, b = a + 1, c = a + 3, d = c + 1; idx.push(a, b, d, a, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}
function feather(base, dir, len, hw, cols, up = [0, 1, 0], shape = 0) {
  const ratio = Math.max(0.04, Math.round((hw / len) * 25) / 25);
  const h = H.geo(featherGeo(ratio, shape)).scale(len);
  if (typeof cols === 'function') h.shade((x, y) => cols(y, x / ratio));
  else h.shade((x, y) => (Math.abs(x) < ratio * 0.12 ? mixRgb(cols[0], cols[1], y * 0.6) : mixRgb(cols[0], cols[1], smooth(y * 1.15 - 0.1))));
  return orient(h, base, dir, up).pbr(0.6, 0);
}
function stripGeo(A, B) {
  const pos = [], idx = [];
  for (let i = 0; i < A.length; i++) pos.push(...A[i], ...B[i]);
  for (let i = 0; i < A.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** a double-sided fan of skin between a spine (base points) and its tips: fins, crests, webbing */
function fanGeo(bases, tips, scallop = 0.18) {
  const pos = [], idx = [], n = bases.length;
  for (let i = 0; i < n; i++) {
    pos.push(...bases[i]);
    const k = i === 0 || i === n - 1 ? 1 : 1;
    pos.push(...tips[i].map((v, j) => v * k + 0 * j));
    if (i < n - 1) { const m = lerp3(lerp3(bases[i], bases[i + 1], 0.5), lerp3(tips[i], tips[i + 1], 0.5), 1 - scallop); pos.push(...m); }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 3, b = a + 1, m = a + 2, c = a + 3, d = a + 4;
    idx.push(a, b, m, a, m, c, c, m, d);
    idx.push(a, m, b, a, c, m, c, d, m);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** a fin: rays from bases to tips with skin between them */
function fin(bases, tips, skin, ray, opt = {}) {
  const out = [H.geo(fanGeo(bases, tips, opt.scallop ?? 0.2)).shade((x, y, z, nx, ny, nz, i) => (i % 3 === 1 ? rgb(opt.edge ?? skin) : null)).color(skin).pbr(opt.rough ?? 0.4, 0)];
  if (opt.glossy) out[0].pbr(0.25, 0.1);
  for (let i = 0; i < bases.length; i++) out.push(H.tube([bases[i], lerp3(bases[i], tips[i], 0.6), tips[i]], [opt.rayR ?? 0.006, (opt.rayR ?? 0.006) * 0.7, 0.0015], 4, 4).color(ray).pbr(0.4).lod(1));
  return out;
}

/** Feathered wing (left, +X), spread. G = { Sh, E, W, T }; C = { bone, a, b, tip, covert, shape }. Returns { arm, tip }. */
function featherWing(G, C, opt = {}) {
  const { Sh, E, W, T } = G, L = opt.len ?? 0.36, shape = C.shape ?? 0;
  const arm = { prims: [], hard: [] }, tip = { prims: [], hard: [] };
  const cA = rgb(C.a), cB = rgb(C.b), cT = rgb(C.tip ?? C.b), cC = rgb(C.covert ?? C.a), cC2 = mixRgb(cC, cA, 0.5);
  const sk = opt.skin || ((q) => q.color(C.bone ?? C.a).bump(0.006, 34, 'fur').tint(0.14, 18).pbr(0.7));
  const ra = opt.r ?? 0.045;
  arm.prims.push(sk(S.capsule(Sh, E, ra * 1.25, ra)));
  arm.prims.push(sk(S.ellipsoid(ra * 1.5, ra * 1.1, ra * 2.2).at(...lerp3(Sh, E, 0.35)).blend(0.03)));
  arm.prims.push(sk(S.capsule(E, W, ra, ra * 0.75).blend(0.02)));
  tip.prims.push(sk(S.capsule(W, lerp3(W, T, 0.55), ra * 0.75, ra * 0.4)));
  const back = [0, 0, -1];
  const fcol = (c0, c1) => (t, x) => {
    if (Math.abs(x) < 0.12) return mixRgb(c0, c1, t * 0.5 + 0.1);
    let c3 = mixRgb(c0, c1, smooth(t * 1.2 - 0.15));
    if (t > 0.86) c3 = mixRgb(c3, cT, (t - 0.86) / 0.14);
    return c3;
  };
  const fin2 = opt.finish || ((h) => h);
  const rowOn = (part, P0, P1, n, len0, len1, dir0, dir1, c0, c1, yOff, hwK, flag) => {
    const bases = [], ends = [];
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1), base = add3(lerp3(P0, P1, f), [0, yOff - f * 0.004, 0]);
      const dir = norm3(lerp3(dir0, dir1, f)), len = lerp(len0, len1, f) * (0.94 + 0.12 * ((i * 7) % 3) / 2);
      const hw = Math.max(len3(sub3(P1, P0)) / Math.max(1, n - 1) * hwK, len * 0.09);
      const h = fin2(feather(base, dir, len, hw, fcol(c0, c1), [0.25 * (i % 2 ? 1 : -1), 1, 0], shape).near());
      if (flag != null) h.lod(flag);
      part.hard.push(h);
      bases.push(base); ends.push(add3(base, mul3(dir, len * 0.93)));
    }
    return { bases, ends };
  };
  const nIn = opt.n?.[0] ?? 9, nOut = opt.n?.[1] ?? 9;
  const outDir = norm3(add3(norm3(sub3(T, W)), [0.25, 0, -0.25]));
  const sec = rowOn(arm, add3(Sh, [0.03, 0, -0.03]), W, nIn, L * 0.82, L, [-0.12, -0.05, -1], [0.1, -0.03, -1], cA, cB, -0.012, 0.85);
  const pri = rowOn(tip, W, T, nOut, L * 1.02, L * 1.3, [0.14, -0.03, -1], outDir, cA, cB, -0.014, 0.9);
  rowOn(arm, add3(Sh, [0.04, 0, -0.01]), W, nIn + 1, L * 0.5, L * 0.52, [-0.1, 0, -1], [0.1, 0, -1], cC2, cA, 0.004, 0.8);
  rowOn(arm, add3(Sh, [0.05, 0, 0.0]), W, nIn - 2, L * 0.3, L * 0.3, [-0.1, 0.02, -1], [0.08, 0.02, -1], cC, cC2, 0.016, 1.0, 1);
  rowOn(tip, W, lerp3(W, T, 0.92), nOut - 1, L * 0.5, L * 0.55, [0.14, 0, -1], lerp3(back, outDir, 0.85), cC2, cA, 0.004, 0.85);
  const mk = (g) => fin2(H.geo(g).shade((x, y, z, nx, ny, nz, i) => (i % 2 ? cB : cA)).color(C.a).pbr(0.65).far());
  arm.hard.push(mk(stripGeo(sec.bases, sec.ends))); tip.hard.push(mk(stripGeo(pri.bases, pri.ends)));
  return { arm, tip, pri, sec };
}
const sidePart = (list, sx) => flat(list).map((q) => (sx > 0 ? q.clone() : q.mirrorX()));
function addWings(N, parent, G, build, detail = 0.8) {
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx), src = build(sx);
    const w = N(`wing${nm}`, parent, X(G.Sh), { rig: 'wings', detail });
    const t = N(`wingtip${nm}`, `wing${nm}`, X(G.W), { rig: 'wingtips', detail });
    w.prims = sidePart(src.arm.prims, sx); w.hard = sidePart(src.arm.hard, sx);
    t.prims = sidePart(src.tip.prims, sx); t.hard = sidePart(src.tip.hard, sx);
  }
}

/** chain of segment nodes through pts; deco(n, a, b, ra, rb, i, frame) adds extras */
function addChain(N, name, parent, pts, radii, sk, opt = {}) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const n = N(`${name}${i}`, i === 0 ? parent : `${name}${i - 1}`, pts[i], { rig: opt.rig, detail: opt.detail ?? 0.8, minRes: opt.minRes });
    const a = pts[i], b = pts[i + 1], ra = radii[i], rb = radii[i + 1];
    n.prims.push(sk(S.sphere(ra).at(...a)));
    n.prims.push(sk(bone(a, b, ra, rb).blend(0.01)));
    if (i === pts.length - 2) n.prims.push(sk(S.sphere(rb).at(...b).blend(0.01)));
    if (opt.deco) {
      const t = norm3(sub3(b, a));
      let side = cross3(t, opt.up ?? [0, 1, 0]); if (len3(side) < 1e-4) side = [1, 0, 0]; side = norm3(side);
      opt.deco(n, a, b, ra, rb, i, { t, side, dor: norm3(cross3(side, t)) });
    }
    out.push(n);
  }
  return out;
}

/** a three-part leg: hip J, knee K, fetlock A, ground F; nodes legX (legs), shinX (shins), pawX (paws) */
function leg3(N, nm, parent, pts, rr, sk, opt = {}) {
  const [J, K, A, F] = pts, det = opt.detail ?? 0.8;
  const up = N(`leg${nm}`, parent, J, { rig: 'legs', detail: det, minRes: opt.minRes });
  up.prims.push(sk(S.capsule(J, K, rr[0], rr[1])));
  if (opt.thigh) up.prims.push(sk(S.ellipsoid(...opt.thigh).at(...add3(lerp3(J, K, 0.25), opt.thighOff ?? [0, 0, 0])).blend(0.05)));
  up.prims.push(sk(S.sphere(rr[1] * 1.12).at(...K).blend(0.02)));
  const sh = N(`shin${nm}`, `leg${nm}`, K, { rig: 'shins', detail: det, minRes: opt.minRes });
  sh.prims.push(sk(S.sphere(rr[1] * 1.08).at(...K)), sk(S.capsule(K, A, rr[1] * 0.85, rr[2]).blend(0.02)));
  const pw = N(`paw${nm}`, `shin${nm}`, A, { rig: 'paws', detail: det, minRes: opt.minRes });
  pw.prims.push(sk(S.sphere(rr[2] * 1.15).at(...A)), sk(S.capsule(A, add3(F, [0, rr[3] * 0.9, 0]), rr[2] * 0.95, rr[3] * 0.8).blend(0.015)));
  if (opt.foot) opt.foot(pw, A, F, sh);
  return { up, sh, pw };
}

// =====================================================================================
//  RIDERS: a humanoid built in its riding pose, seated on a mount
// =====================================================================================
const _e1 = new THREE.Euler(), _ma = new THREE.Matrix4(), _mb = new THREE.Matrix4(), _v1 = new THREE.Vector3();
const RIDER_VALUES = ['reach', 'butt', 'lie', 'pass', 'build', 'wscale', 'handR'];
function makeRider(def, rd, f) {
  rd = rd && typeof rd === 'object' ? rd : { species: 'human', outfit: 'levy', weapon: 'spear' };
  const desc = humanoid(def, { ...rd, pose: 'riding' });
  const P = proportions(rd);
  const by = new Map(desc.nodes.map((n) => [n.name, n]));
  const rot = (n) => _mb.makeRotationFromEuler(_e1.set((n.rot?.[0] || 0) * DEG, (n.rot?.[1] || 0) * DEG, (n.rot?.[2] || 0) * DEG, 'XYZ'));
  const chain = (leg, shin, local) => {
    const L = by.get(leg), Sn = by.get(shin);
    if (!L) return [0, P.hipY * 0.3, 0.2];
    _ma.makeTranslation(L.pos[0], L.pos[1], L.pos[2]).multiply(rot(L));
    if (Sn) _ma.multiply(_mb.makeTranslation(Sn.pos[0], Sn.pos[1], Sn.pos[2])).multiply(rot(Sn));
    _v1.set(local[0], local[1], local[2]).applyMatrix4(_ma);
    return [_v1.x, _v1.y, _v1.z];
  };
  const foot = (side) => chain(side > 0 ? 'legL' : 'legR', side > 0 ? 'shinL' : 'shinR', [0, -P.shin - P.footH, P.footLen * 0.28]);
  const hand = (side) => {   // the rein hand in its riding rest (arms hang): a rough point in front of the hip
    return [side * P.shoulderX * 0.8, P.hipY + P.torso * 0.35, P.chestD * 0.9];
  };
  const vals = {};
  for (const k of RIDER_VALUES) if (typeof desc[k] === 'number') vals[k] = desc[k];
  return { desc, P, f, foot, hand, vals };
}
/** seat a rider (all points in the mount's finished, scaled-down space): its root becomes `rider` under bodyName */
function seatRider(out, R, bodyName, bodyO, seat) {
  const f = R.f, P = R.P;
  for (const n of R.desc.nodes) {
    const m = { ...n, name: n.name === 'root' ? 'rider' : `r_${n.name}` };
    if (n.name === 'root') { m.parent = bodyName; m.pos = [seat[0] - bodyO[0], seat[1] - bodyO[1] - P.hipY * f, seat[2] - bodyO[2]]; }
    else { m.parent = n.parent === 'root' ? 'rider' : `r_${n.parent}`; m.pos = mul3(n.pos, f); }
    m.prims = flat(n.prims); m.hard = flat(n.hard);
    if (f !== 1) {
      for (const q of m.prims) q.scale(f);
      for (const q of m.hard) q.scale(f);
      m.detail = (n.detail ?? 1) / Math.max(f, 0.8);
    }
    out.push(m);
  }
  return out;
}
/** a battlefield holds many of these: thin the sculpt density of every node */
function thin(nodes, k) { for (const n of nodes) n.detail = (n.detail ?? 1) * k; return nodes; }
const riderPt = (R, seat, pt) => [seat[0] + pt[0] * R.f, seat[1] + (pt[1] - R.P.hipY) * R.f, seat[2] + pt[2] * R.f];

// shared tack
const BRASS = 0xd0a040, IRON = 0x5a5e66, LEATHER = 0x5a3a22, LEATHER_D = 0x3a2616, HAIR = 0x1c1612;
function bell(p, r, color = BRASS, lod = 1) {
  return [
    H.lathe([[0.0001, r * 1.25], [r * 0.45, r * 1.15], [r * 0.8, r * 0.6], [r * 1.0, -r * 0.1], [r * 1.18, -r * 0.45], [r * 0.9, -r * 0.4], [0.0001, -r * 0.2]], 10).at(p[0], p[1], p[2]).color(color).pbr(0.3, 0.95).lod(lod),
    H.sphere(r * 0.3, 6).at(p[0], p[1] - r * 0.5, p[2]).color(0x3a2a1a).pbr(0.5, 0.6).lod(lod),
  ];
}
function tassel(p, len, r, c0, c1, lod = 1) {
  return [
    H.sphere(r * 1.2, 7).at(p[0], p[1], p[2]).color(c1).pbr(0.6).lod(lod),
    H.cone(r * 1.5, len, 7).rot(180, 0, 0).at(p[0], p[1] - len * 0.5 - r * 0.6, p[2]).shade((x, y) => (y > len * 0.3 ? rgb(c1) : rgb(c0))).color(c0).pbr(0.9).lod(lod),
  ];
}

// =====================================================================================
//  NAGA
// =====================================================================================
const NAGA_WEAPONS = new Set(['glaive', 'longbow', 'staff']);
function naga(def, o = {}) {
  const skin = col(o.skin, 0x3a7a4a), belly = col(o.belly, 0xc8c070), armor = col(o.armor, 0x8a6a3a), trim = col(o.trim, 0xd8b03a);
  const four = +o.arms === 4, hood = !!o.hood, robe = !!o.robe;
  const wk = NAGA_WEAPONS.has(o.weapon) ? o.weapon : 'glaive';
  const variant = robe ? 'blood' : hood ? 'cobra' : wk === 'longbow' ? 'viper' : 'kris';
  const rnd = rng(hashStr(`${def?.id || 'naga'}:${variant}`));
  const C = {
    skin, back: tone(skin, 0, 0.03, -0.1), mark: tone(skin, -0.02, 0.05, -0.2), belly, bellyD: tone(belly, 0, 0, -0.12),
    armor, armorL: tone(armor, 0.01, 0.05, 0.08), verd: mix(armor, 0x4a9a80, 0.55), trim, gem: variant === 'blood' ? 0xff2a1a : variant === 'cobra' ? 0x2ad070 : 0xd0202a,
    robe: 0x8a1420, robeD: 0x5a0a14, fang: 0xf4eed8, tongue: 0x8a1428,
    eye: variant === 'blood' ? { iris: 0xff4020, rim: 0x5a0808, white: 0x200806, glow: 1.1 } : { iris: 0xf0c020, rim: 0x4a2808, white: 0x1a1008, glow: 0.25 },
  };
  if (variant === 'cobra') { C.mark = tone(skin, 0, 0, 0.12); C.back = tone(skin, 0, 0, 0.04); }
  const hd = humanoid(def, { species: 'lizard', skin, cloth: robe ? C.robe : tone(armor, 0, -0.15, -0.14), cloth2: trim, armor, trim, outfit: robe ? 'silkRobe' : 'loincloth', weapon: wk });
  const P = proportions({ species: 'lizard' });
  const LIFT = 0.07, Y0 = P.hipY + LIFT;
  const sk = (q, c = skin) => q.color(c).bump(0.0055, 30, 'scales').tint(0.12, 12).pbr(0.42, 0.05);
  const goldH = (h) => h.color(trim).pbr(0.28, 0.95);
  const bronze = (q) => q.color(armor).tint(0.22, 11).pbr(0.42, 0.72);

  // --- the humanoid's upper body, without legs or lizard tail ---
  const drop = new Set();
  for (const n of hd.nodes) if (['legL', 'legR', 'shinL', 'shinR', 'hair'].includes(n.name) || /^tail\d/.test(n.name) || (n.parent && drop.has(n.parent))) drop.add(n.name);
  const kept = hd.nodes.filter((n) => !drop.has(n.name));
  const by = new Map(kept.map((n) => [n.name, n]));
  const torso = by.get('torso'), head = by.get('head');

  // --- the serpent body: a trunk rising from the ground to the waist, then a long tail coiled behind ---
  const N = rigOf();
  const T0 = [0, 0.13, 0.07];
  const trunk = N('trunk', 'root', T0, { rig: 'trunk', detail: 0.85 });
  const TP = [[0, Y0 + 0.05, -0.01], [0, Y0 - 0.2, 0.05], [0, 0.22, 0.09], [0, 0.125, -0.06]], TR = [0.112, 0.122, 0.128, 0.124];
  for (let i = 0; i < TP.length - 1; i++) trunk.prims.push(sk(S.capsule(TP[i], TP[i + 1], TR[i], TR[i + 1]).blend(0.04)));
  for (let i = 0; i < 7; i++) {   // belly scutes up the front of the trunk
    const t = i / 6, y = lerp(Y0 - 0.06, 0.2, t), z = lerp(0.06, 0.13, smooth(t)) + 0.08;
    trunk.prims.push(S.box(0.17, 0.034, 0.08, 0.012).at(0, y, z).color(i % 2 ? C.belly : C.bellyD).paint(0.008, 0.003));
  }
  trunk.prims.push(S.ellipsoid(0.07, 0.24, 0.07).at(0, Y0 - 0.2, -0.08).color(C.back).paint(0.03));
  for (let i = 0; i < 4; i++) trunk.prims.push(S.ellipsoid(0.05, 0.035, 0.05).at(0, Y0 - 0.08 - i * 0.11, -0.115 + i * 0.006).color(C.mark).paint(0.01));
  // the tail
  const CP = [[0, 0.124, -0.06], [0.12, 0.112, -0.3], [0.3, 0.1, -0.47], [0.36, 0.088, -0.7], [0.2, 0.075, -0.86], [-0.06, 0.062, -0.86], [-0.24, 0.048, -0.7], [-0.25, 0.034, -0.5], [-0.12, 0.016, -0.4]];
  const CR = [0.124, 0.112, 0.1, 0.088, 0.075, 0.062, 0.047, 0.033, 0.012];
  addChain(N, 'coil', 'trunk', CP, CR, sk, { rig: 'coil', detail: 0.8, minRes: 34, deco: (n, a, b, ra, rb, i, f) => {
    n.prims.push(S.capsule(add3(a, [0, -ra * 0.6, 0]), add3(b, [0, -rb * 0.6, 0]), ra * 0.72, rb * 0.72).color(C.belly).paint(0.02));
    n.prims.push(S.ellipsoid(ra * 0.55, ra * 0.4, ra * 0.7).at(...add3(lerp3(a, b, 0.5), [0, ra * 0.82, 0])).color(C.mark).paint(0.012));
    n.prims.push(S.ellipsoid(ra * 0.35, ra * 0.3, ra * 0.45).at(...add3(lerp3(a, b, 0.5), mul3(f.side, ra * 0.9))).color(C.back).paint(0.01));
    if (variant === 'kris' || variant === 'blood') n.hard.push(spike(add3(lerp3(a, b, 0.5), [0, ra * 0.95, 0]), add3([0, 1, 0], mul3(f.t, -0.7)), ra * 0.6, ra * 0.16, C.back, f.t, 0.2, 0.4).lod(1));
  } });

  // --- torso: breastplate, belt, scutes; the torso is re-hung from the trunk ---
  torso.parent = 'trunk';
  torso.pos = [0, Y0 - T0[1], -T0[2]];
  {
    const p = torso.prims, h = torso.hard, cy = P.torso - 0.1, cw = P.chestW / 2, cd = P.chestD / 2;
    p.push(sk(S.capsule([0, P.torso - 0.03, 0.0], [0, P.torso + P.neck + 0.03, 0.005], 0.07, 0.06).blend(0.03)));   // a serpent's thick neck
    p.push(S.capsule([0, P.torso - 0.05, 0.05], [0, P.torso + P.neck + 0.02, 0.05], 0.035, 0.03).color(C.belly).paint(0.012));
    p.push(S.ellipsoid(0.09, 0.12, 0.05).at(0, 0.06, cd * 0.82).color(C.belly).paint(0.03));
    for (let i = 0; i < 4; i++) p.push(S.box(0.14, 0.012, 0.06, 0.004).at(0, -0.01 + i * 0.035, cd * 0.95).color(C.bellyD).paint(0.004, -0.003));
    if (variant !== 'viper') {
      // tarnished bronze cuirass: a moulded chest, the gold rim, a sunburst boss with its stone
      p.push(bronze(S.ellipsoid(cw + 0.024, 0.135, cd + 0.03).at(0, cy, 0.008).blend(0.004)));
      p.push(bronze(S.ellipsoid(0.05, 0.06, 0.03).at(0.055, cy + 0.02, cd + 0.012).blend(0.03)), bronze(S.ellipsoid(0.05, 0.06, 0.03).at(-0.055, cy + 0.02, cd + 0.012).blend(0.03)));
      for (let i = 0; i < 9; i++) { const a = rnd() * 6.28, yy = cy + (rnd() - 0.5) * 0.18; p.push(S.ellipsoid(0.03 + rnd() * 0.03, 0.02 + rnd() * 0.02, 0.05).at(Math.sin(a) * (cw + 0.02), yy, Math.cos(a) * (cd + 0.03)).color(C.verd).paint(0.012)); }
      h.push(goldH(H.torus(0.16, 0.009, 34, 6).rot(90, 0, 0).scale(1, 1, 0.74).at(0, cy - 0.1, 0.012)));
      h.push(goldH(H.torus(0.13, 0.008, 30, 6).rot(90, 0, 0).scale(1, 1, 0.82).at(0, cy + 0.12, 0.006)).lod(1));
      h.push(goldH(H.cyl(0.035, 0.04, 0.012, 14).rot(90, 0, 0).at(0, cy + 0.0, cd + 0.034)));
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; h.push(goldH(spike([Math.sin(a) * 0.035, cy + Math.cos(a) * 0.035, cd + 0.032], [Math.sin(a), Math.cos(a), 0.2], 0.03, 0.009, trim, [0, 0, 1], 0, 0.5)).lod(1)); }
      h.push(H.sphere(0.016, 10).scale(1, 1, 0.6).at(0, cy, cd + 0.045).color(C.gem).pbr(0.12, 0.2).glow(0.35));
      // shoulder scales of bronze
      for (const sx of [1, -1]) for (let r = 0; r < 2; r++) p.push(bronze(S.ellipsoid(0.065 - r * 0.012, 0.035, 0.07 - r * 0.01).rot(0, 0, sx * (-25 - r * 15)).at(sx * (0.15 + r * 0.035), P.torso + 0.01 - r * 0.05, 0).blend(0.004)));
    } else {
      // the archer goes lighter: a gold-studded leather harness, a bronze pectoral and the quiver
      p.push(S.ellipsoid(0.12, 0.05, cd + 0.025).at(0, cy + 0.08, 0.004).color(armor).pbr(0.42, 0.72).tint(0.2, 11).blend(0.004));
      for (const sx of [1, -1]) p.push(S.capsule([sx * 0.11, P.torso, 0], [-sx * 0.1, 0.03, cd * 0.9], 0.014).color(LEATHER).pbr(0.7).paint(0.004, 0.006));
      const q0 = [0.07, 0.14, -cd - 0.05], q1 = [-0.02, 0.48, -cd - 0.08];
      h.push(orient(H.cyl(0.04, 0.034, len3(sub3(q1, q0)), 12), lerp3(q0, q1, 0.5), sub3(q1, q0)).color(LEATHER).pbr(0.75).shade((x, y) => (Math.abs(y) > 0.14 ? rgb(trim) : rgb(LEATHER))));
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1, top = add3(q1, [Math.sin(a) * 0.022, 0.05 + (i % 2) * 0.02, Math.cos(a) * 0.022]);
        h.push(H.cyl(0.003, 0.003, 0.12, 4).at(top[0], top[1] - 0.06, top[2]).color(0x6a4a2a).lod(1));
        h.push(feather(add3(top, [0, -0.04, 0]), [Math.sin(a) * 0.2, 1, 0], 0.07, 0.012, [rgb(0x2a4a20), rgb(0xc8c070)], [Math.cos(a), 0, -Math.sin(a)], 1).lod(1));
      }
    }
    // belt of gold plaques
    p.push(S.torus(P.waistW / 2 + 0.01, 0.018).at(0, 0.02, 0.005).color(trim).pbr(0.3, 0.9).blend(0.004));
    for (let i = 0; i < 7; i++) { const a = (i - 3) * 0.42; h.push(goldH(H.box(0.026, 0.03, 0.008, 0.003).rot(0, a / DEG, 0).at(Math.sin(a) * (P.waistW / 2 + 0.028), 0.02, Math.cos(a) * (P.waistD / 2 + 0.035) + 0.01)).lod(1)); }
    h.push(H.sphere(0.012, 8).at(0, 0.02, P.waistD / 2 + 0.05).color(C.gem).pbr(0.12).glow(0.3).lod(1));
    // a collar of beaten gold with beads
    h.push(goldH(H.torus(0.075, 0.014, 22, 6).rot(90, 0, 0).scale(1, 1, 0.9).at(0, P.torso + 0.0, 0.008)));
    for (let i = 0; i < 9; i++) { const a = (i - 4) * 0.32; h.push(H.sphere(0.009, 6).at(Math.sin(a) * 0.09, P.torso - 0.02 - Math.cos(a * 1.3) * 0.02, Math.cos(a) * 0.08 + 0.008).color(i % 2 ? C.gem : trim).pbr(0.2, 0.6).lod(1)); }
    if (hood) {
      // the cobra hood: spread from the neck behind the head, pale and banded in front, spectacles on its back
      const hc = [0, P.torso + 0.08, -0.035];
      p.push(sk(S.ellipsoid(0.17, 0.18, 0.032).rot(-10, 0, 0).at(...hc).blend(0.035)));
      p.push(sk(S.ellipsoid(0.11, 0.1, 0.04).rot(-10, 0, 0).at(hc[0], hc[1] - 0.1, hc[2] + 0.004).blend(0.04)));
      p.push(S.ellipsoid(0.15, 0.16, 0.03).rot(-10, 0, 0).at(hc[0], hc[1], hc[2] + 0.02).color(C.belly).paint(0.012));
      for (let i = 0; i < 4; i++) p.push(S.box(0.34, 0.014, 0.05, 0.002).rot(-10, 0, 0).at(0, hc[1] - 0.11 + i * 0.06, hc[2] + 0.025).color(C.bellyD).paint(0.004, -0.002));
      for (const sx of [1, -1]) {
        const ec = [0.075 * sx, hc[1] + 0.03, hc[2] - 0.03];
        p.push(S.ellipsoid(0.05, 0.06, 0.03).rot(-10, 0, sx * -14).at(...ec).color(0xe8dcb0).paint(0.006), S.ellipsoid(0.03, 0.038, 0.03).rot(-10, 0, sx * -14).at(...ec).color(0x101010).paint(0.005));
      }
      for (let i = 0; i < 7; i++) { const a = (i - 3) * 0.33; h.push(goldH(H.sphere(0.008, 6).at(Math.sin(a) * 0.15, hc[1] + Math.cos(a) * 0.15 - 0.02, hc[2] + 0.03)).lod(1)); }
    }
  }

  // --- the serpent head ---
  head.prims = []; head.hard = [];
  {
    const p = head.prims, h = head.hard, k = variant === 'cobra' ? 1.0 : 0.95;
    const hs = (q, c = skin) => q.color(c).bump(0.0035, 46, 'scales').tint(0.1, 18).pbr(0.4, 0.05);
    p.push(hs(S.ellipsoid(0.07 * k, 0.056, 0.085).at(0, 0.0, -0.005)));
    p.push(hs(S.capsule([0, -0.005, 0.03], [0, -0.016, 0.135 * k], 0.054, 0.034).blend(0.03)));
    p.push(...S.mirrorX([hs(S.ellipsoid(0.03, 0.034, 0.045).at(0.048, -0.025, -0.02).blend(0.03))]));        // jaw muscles
    p.push(...S.mirrorX([hs(S.capsule([0.028, 0.034, 0.105], [0.058, 0.04, 0.012], 0.011, 0.016).blend(0.012), C.back)]));
    p.push(hs(S.capsule([0, -0.04, -0.03], [0, -0.1, -0.06], 0.05, 0.06).blend(0.03)));                       // into the neck
    p.push(S.ellipsoid(0.052, 0.03, 0.11).at(0, 0.04, 0.03).color(C.back).paint(0.02));
    p.push(S.ellipsoid(0.045, 0.022, 0.1).at(0, -0.04, 0.05).color(C.belly).paint(0.02));
    p.push(...S.mirrorX([S.capsule([0.03, -0.028, 0.13], [0.058, -0.02, 0.0], 0.0045).color(0x1a0a08).paint(0.003, -0.003)]));     // the lipline
    p.push(...S.mirrorX([S.sphere(0.0055).at(0.015, 0.002, 0.14).cut(0.002)]));
    p.push(...S.mirrorX([S.sphere(0.017).at(0.05, 0.018, 0.065).cut(0.004)]));
    for (const sx of [1, -1]) {
      h.push(eyeAt([0.048 * sx, 0.018, 0.064], [sx, 0.15, 0.55], 0.0155, C.eye));
      h.push(spike([0.022 * sx, -0.03, 0.115], [0, -1, 0.05], 0.034, 0.0055, C.fang, [0, 0, -1], 0.3).lod(1));
    }
    h.push(H.tube([[0, -0.03, 0.12], [0, -0.04, 0.17], [0, -0.05, 0.2]], [0.005, 0.004, 0.003], 6, 4).color(C.tongue).pbr(0.4).lod(1));
    for (const sx of [1, -1]) h.push(H.tube([[0, -0.05, 0.198], [0.011 * sx, -0.058, 0.225]], [0.003, 0.001], 2, 4).color(C.tongue).pbr(0.4).lod(1));
    if (variant === 'kris') {
      // a temple guard's bronze helm with a gold comb, cheek plates over the jaw hinge
      p.push(S.ellipsoid(0.078, 0.05, 0.088).at(0, 0.025, -0.012).color(armor).pbr(0.42, 0.75).tint(0.18, 14).blend(0.004));
      p.push(S.box(0.012, 0.05, 0.14, 0.005).at(0, 0.075, -0.02).color(trim).pbr(0.28, 0.95).blend(0.004));
      p.push(...S.mirrorX([S.ellipsoid(0.012, 0.035, 0.04).rot(0, 0, 10).at(0.07, -0.01, -0.01).color(armor).pbr(0.42, 0.75).blend(0.004)]));
      for (let i = 0; i < 4; i++) h.push(spike([0, 0.095 - i * 0.008, 0.03 - i * 0.03], [0, 1, -0.55], 0.06 - i * 0.008, 0.01, trim, [0, 0, -1], 0.25, 0.35).pbr(0.28, 0.95).lod(1));
      h.push(H.sphere(0.012, 8).at(0, 0.05, 0.078).color(C.gem).pbr(0.12).glow(0.3));
    } else if (variant === 'viper') {
      for (const sx of [1, -1]) h.push(spike([0.042 * sx, 0.045, 0.06], [sx * 0.25, 1, -0.15], 0.05, 0.012, tone(skin, 0, 0, -0.18), [0, 0, -1], 0.3).lod(1));
      h.push(goldH(H.torus(0.073, 0.0055, 26, 5).rot(90, 0, 0).scale(1, 1, 1.15).at(0, 0.03, -0.006)));
    } else if (variant === 'cobra') {
      h.push(goldH(H.torus(0.072, 0.006, 26, 5).rot(84, 0, 0).scale(1, 1, 1.15).at(0, 0.035, -0.006)));
      h.push(H.sphere(0.011, 8).at(0, 0.052, 0.078).color(C.gem).pbr(0.12).glow(0.4));
    } else {
      // the blood sorcerer's crown: a gold fan of serpent heads round a burning stone
      p.push(S.ellipsoid(0.075, 0.03, 0.085).at(0, 0.04, -0.01).color(trim).pbr(0.28, 0.95).blend(0.004));
      for (let i = 0; i < 7; i++) {
        const a = (i - 3) * 0.36, b = [Math.sin(a) * 0.07, 0.06, Math.cos(a) * 0.07 - 0.02];
        h.push(goldH(spike(b, [Math.sin(a) * 0.4, 1, Math.cos(a) * 0.25 - 0.2], 0.08 - Math.abs(i - 3) * 0.012, 0.014, trim, [Math.sin(a), 0, Math.cos(a)], -0.25, 0.5)));
      }
      h.push(H.sphere(0.017, 10).at(0, 0.08, 0.06).color(C.gem).pbr(0.1).glow(1.4));
    }
  }

  // --- arm bands and bracers ---
  const armBands = (n, k = 1) => {
    if (!n) return;
    n.hard.push(goldH(H.torus(P.rUpper * k + 0.012, 0.0085, 22, 6).rot(90, 0, 0).at(0, -0.06 * k, 0)));
    n.hard.push(goldH(H.torus(P.rUpper * k + 0.01, 0.006, 22, 5).rot(90, 0, 0).at(0, -0.085 * k, 0)).lod(1));
    for (let i = 0; i < 3; i++) { const a = (i - 1) * 0.9; n.hard.push(H.sphere(0.008, 6).at(Math.sin(a) * (P.rUpper * k + 0.02), -0.072 * k, Math.cos(a) * (P.rUpper * k + 0.02)).color(C.gem).pbr(0.12).glow(0.2).lod(1)); }
  };
  const bracer = (n, k = 1) => { if (n) n.hard.push(goldH(H.cyl(P.rFore * k + 0.01, P.rWrist * k + 0.012, 0.06 * k, 16, true).at(0, -P.fore * 0.72 * k, 0)).lod(2), goldH(H.torus(P.rWrist * k + 0.013, 0.005, 18, 5).rot(90, 0, 0).at(0, -P.fore * 0.92 * k, 0)).lod(1)); };
  armBands(by.get('armL')); armBands(by.get('armR')); bracer(by.get('foreL')); bracer(by.get('foreR'));

  // --- the robe: a draped skirt down the rising trunk and a train over the coils ---
  if (robe) {
    const p = trunk.prims, h = trunk.hard;
    const rb = (q, c = C.robe) => q.color(c).tint(0.12, 18).bump(0.003, 40, 'weave').pbr(0.85);
    p.push(rb(S.cone(0.2, 0.138, 0.42, 0.02).at(0, Y0 - 0.2, 0.02).blend(0.01)));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + 0.3; p.push(rb(S.capsule([Math.sin(a) * 0.13, Y0 - 0.01, Math.cos(a) * 0.13 + 0.02], [Math.sin(a) * 0.195, Y0 - 0.4, Math.cos(a) * 0.195 + 0.02], 0.016, 0.03).blend(0.02))); }
    p.push(S.box(0.07, 0.42, 0.2, 0.01).at(0, Y0 - 0.2, 0.2).color(C.robeD).paint(0.008));
    p.push(S.box(0.09, 0.42, 0.2, 0.01).at(0, Y0 - 0.2, 0.2).color(trim).pbr(0.35, 0.8).paint(0.004, 0.002));
    p.push(S.box(0.06, 0.42, 0.2, 0.01).at(0, Y0 - 0.2, 0.2).color(C.robeD).paint(0.004));
    p.push(S.torus(0.198, 0.012).at(0, Y0 - 0.405, 0.02).color(trim).pbr(0.35, 0.8).blend(0.004));
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; h.push(...tassel([Math.sin(a) * 0.2, Y0 - 0.41, Math.cos(a) * 0.2 + 0.02], 0.04, 0.006, C.robeD, trim, 1)); }
    // a sash train trailing back over the first coil
    const train = [[0, Y0 - 0.1, -0.1], [0, Y0 - 0.3, -0.18], [0.03, 0.2, -0.24], [0.1, 0.22, -0.36]];
    p.push(...train.slice(0, -1).map((a, i) => rb(S.capsule(a, train[i + 1], 0.05, 0.05).blend(0.02)).color(i % 2 ? C.robe : C.robeD)));
  }

  // --- the lower pair of arms ---
  const extra = [];
  if (four) {
    const lower = [['armL', 'foreL', 'handL', 1], ['armR', 'foreR', 'handR', -1]];
    const k = 0.9;
    for (const [an, fn, hn, sx] of lower) {
      const A = by.get(an), F = by.get(fn), Hd = by.get(hn);
      if (!A || !F || !Hd) continue;
      const nm = sx > 0 ? 'L' : 'R';
      const cl = (n) => ({ prims: flat(n.prims).map((q) => q.clone().scale(k)), hard: flat(n.hard).map((q) => q.clone().scale(k)) });
      const a2 = { name: `arm2${nm}`, parent: 'torso', rig: 'arms2', pos: [sx * (P.shoulderX - 0.012), P.torso - 0.125, 0.0], rot: [-20, 0, sx * 24], detail: A.detail, ...cl(A) };
      const f2 = { name: `fore2${nm}`, parent: `arm2${nm}`, rig: 'forearms2', pos: mul3(F.pos, k), rot: [-62, 0, 0], detail: F.detail, ...cl(F) };
      const h2 = { name: `hand2${nm}`, parent: `fore2${nm}`, rig: 'hands2', pos: mul3(Hd.pos, k), detail: Hd.detail, ...cl(Hd) };
      armBands(a2, k); bracer(f2, k);
      const hr = P.handR * k;
      if (sx < 0 || wk !== 'staff') {
        // a wavy-bladed kris in each lower hand (the sorcerer keeps one, for the blood)
        const dg = makeWeapon('dagger', { scale: 1.05 });
        if (dg) h2.hard.push(...flat(dg.hard).map((q) => q.rot(78, 0, sx * -6).at(0, -hr, 0.008)));
      } else {
        h2.hard.push(H.sphere(0.04, 14).at(0, -hr * 2.3, 0.03).color(0xff2a14).pbr(0.2).glow(1.6));
        h2.hard.push(H.sphere(0.052, 12).at(0, -hr * 2.3, 0.03).color(0x8a0a08).pbr(0.3).glow(0.5).lod(1));
        h2.hard.push(goldH(H.torus(0.045, 0.004, 18, 4).rot(90, 0, 0).at(0, -hr * 2.3, 0.03)).lod(1));
      }
      extra.push(a2, f2, h2);
    }
  }

  // assemble: root, the trunk and coil, then the humanoid's upper body under it, then the lower arms
  const mine = finish(N.nodes.map((n) => n));
  const out = [];
  out.push(kept[0]);                        // root
  out.push(...mine);
  for (const n of kept.slice(1)) out.push(n);
  out.push(...extra);
  for (const n of out) if (n.name === 'trunk') n.pos = T0;
  for (const n of out) if (n.prims?.length || n.hard?.length) n.detail = (n.detail ?? 1) * 0.62;      // a hundred of these share a battlefield
  const vals = {};
  for (const k of RIDER_VALUES) if (typeof hd[k] === 'number') vals[k] = hd[k];
  return { kind: 'fringe.naga', attack: hd.attack, hold: hd.hold || 'none', ...vals, lie: 0.12, nodes: out };
}

function nagaAnim(rig, inner, c, base) {
  const { R, keys } = base, t = c.t, ph = c.phase || 0, a = c.atk, k = c.moving ? 1 : 0;
  const s = inner.scale.y || 1;
  const hum = HUM_ANIM[`humanoid.${rig.hold || 'none'}`] || HUM_ANIM['humanoid.none'];
  const dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 2) : 0, e = df * df * (3 - 2 * df);
  hum(rig, inner, dead ? { ...c, dead: 0, atk: -1 } : c, base);
  inner.rotation.set(0, 0, 0);
  inner.position.set(0, 0, 0);
  // slithering: the coils roll in a travelling wave; the trunk sways and the body glides side to side
  const wave = t * (k ? 6.5 : 1.4) + ph;
  (rig.coil || []).forEach((seg, i) => {
    if (dead) { R(seg, 0, (i % 2 ? -1 : 1) * 0.12 * e, 0); return; }
    R(seg, 0, Math.sin(wave - i * 0.9) * (k ? 0.16 : 0.035) * (0.6 + i * 0.08), 0);
  });
  let lean = 0, rise = 0;
  if (a >= 0 && !dead) { lean = keys(a, [[0, 0], [0.35, -0.12], [0.55, 0.22], [1, 0]]); rise = keys(a, [[0, 0], [0.35, 0.03], [0.55, -0.02], [1, 0]]); }
  if (dead) {
    // the trunk topples back onto its own coils
    R((rig.trunk || [])[0], -1.05 * e, 0, 0.35 * e);
    inner.position.y = -Math.max(0, c.dead - 0.6) * 0.4 * s;
  } else {
    R((rig.trunk || [])[0], lean + k * 0.08 + Math.sin(t * 1.1 + ph) * 0.02, Math.sin(wave * 0.5) * 0.08 * k, Math.sin(wave) * 0.06 * k + Math.sin(t * 0.9 + ph) * 0.015);
    inner.position.x = Math.sin(wave) * 0.035 * k * s;
    inner.position.y = (rise + Math.sin(t * 1.3 + ph) * 0.006) * s;
  }
  // the lower arms: weaving at rest, stabbing in on the attack
  const A2 = rig.arms2 || [], F2 = rig.forearms2 || [];
  const st = a >= 0 && !dead ? keys(a, [[0, 0], [0.4, -0.5], [0.58, 1], [0.8, 0.4], [1, 0]]) : 0;
  for (let i = 0; i < A2.length; i++) {
    const sg = i ? -1 : 1, w = Math.sin(t * 1.7 + ph + i * 2.2);
    if (dead) { R(A2[i], 0.5 * e, 0, sg * 0.4 * e); R(F2[i], 0.6 * e); continue; }
    R(A2[i], -0.9 * Math.max(0, st) + 0.3 * Math.max(0, -st) + w * 0.06 + k * Math.sin(wave + i * Math.PI) * 0.12, 0, sg * (-0.15 * Math.max(0, st) + w * 0.04));
    R(F2[i], 0.7 * Math.max(0, st) - 0.2 * Math.max(0, -st) - w * 0.05);
  }
  // the head sways like a snake's while it waits
  if (!dead && a < 0 && rig.head) { rig.head.rotation.z += Math.sin(t * 1.2 + ph) * 0.06; rig.head.rotation.y += Math.sin(t * 0.8 + ph) * 0.1; }
  if (dead && rig.torso) { rig.torso.rotation.x += -0.2 * e; }
}

// =====================================================================================
//  WAR-CAMEL
// =====================================================================================
function warCamel(def, o = {}) {
  const sc = num(o.scale, 1.4), hide = col(o.hide, 0xc8a070);
  const rnd = rng(hashStr(`${def?.id || 'camel'}:camel`));
  const C = {
    hide, dark: tone(hide, -0.01, 0.03, -0.13), deep: tone(hide, -0.01, 0.02, -0.24), light: mix(hide, 0xf2e8d0, 0.35), wool: tone(hide, -0.005, 0.06, -0.06),
    lip: tone(hide, 0, -0.12, -0.18), pad: 0x3a2e26, nail: 0x24201c,
    felt1: 0xa8262a, felt2: 0x1e3a6a, felt3: 0xd8a83a, felt4: 0x2a6a4a, white: 0xe8e0cc, wood: 0x6a4428,
  };
  const sk = (q, c = hide) => q.color(c).bump(0.006, 26, 'fur').tint(0.12, 9).pbr(0.88);
  const wool = (q, c = C.wool) => q.color(c).bump(0.012, 30, 'fur').tint(0.2, 16).pbr(0.95);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const BO = [0, 0.86, 0];
  const body = N('body', 'root', BO, { rig: 'body', detail: 0.7 });
  {
    const p = body.prims;
    p.push(sk(S.ellipsoid(0.235, 0.24, 0.5).at(0, 0.87, -0.04)));
    p.push(sk(S.ellipsoid(0.2, 0.25, 0.2).at(0, 0.86, 0.34).blend(0.08)));
    p.push(sk(S.ellipsoid(0.12, 0.1, 0.12).at(0, 0.66, 0.36).blend(0.07)));                    // chest pad
    p.push(sk(S.ellipsoid(0.21, 0.23, 0.22).at(0, 0.88, -0.42).blend(0.08)));
    p.push(sk(S.ellipsoid(0.16, 0.17, 0.12).at(0, 0.84, -0.58).blend(0.06)));
    p.push(sk(S.ellipsoid(0.15, 0.17, 0.17).at(0, 0.99, 0.44).blend(0.08)));                   // withers into the neck
    // the two humps, woolly on top
    p.push(sk(S.ellipsoid(0.16, 0.2, 0.19).at(0, 1.07, 0.21).blend(0.1)));
    p.push(sk(S.ellipsoid(0.16, 0.2, 0.2).at(0, 1.06, -0.27).blend(0.1)));
    p.push(wool(S.ellipsoid(0.12, 0.08, 0.13).at(0, 1.22, 0.23).blend(0.03)));
    p.push(wool(S.ellipsoid(0.12, 0.08, 0.13).at(0, 1.21, -0.28).blend(0.03)));
    p.push(S.ellipsoid(0.17, 0.08, 0.42).at(0, 0.64, -0.04).color(C.light).paint(0.06));
    p.push(...S.mirrorX([wool(S.ellipsoid(0.09, 0.14, 0.12).at(0.12, 0.88, 0.38).blend(0.04))]));    // shaggy shoulders
  }
  // neck: down from the withers, then up in the camel's curve
  const NB = [0, 0.96, 0.5];
  const neck = N('neck', 'body', NB, { rig: 'mneck', detail: 0.8 });
  {
    const pts = [NB, [0, 0.86, 0.72], [0, 0.97, 0.93], [0, 1.2, 1.0], [0, 1.27, 1.02]], rr = [0.14, 0.1, 0.085, 0.075, 0.07];
    for (let i = 0; i < pts.length - 1; i++) neck.prims.push(sk(S.capsule(pts[i], pts[i + 1], rr[i], rr[i + 1]).blend(0.03)));
    neck.prims.push(wool(S.capsule([0, 0.82, 0.62], [0, 0.88, 0.88], 0.09, 0.06).blend(0.03)));                  // the throat beard
    neck.prims.push(wool(S.capsule([0, 1.04, 0.56], [0, 1.0, 0.76], 0.06, 0.04).blend(0.03)));
    // a felt collar with bells and a horse-hair tassel
    const cc = [0, 1.02, 0.95], ax = norm3([0, 1, -0.25]);
    neck.prims.push(orient(S.torus(0.088, 0.017), cc, ax).color(C.felt1).pbr(0.9).bump(0.003, 50, 'weave').blend(0.006));
    neck.prims.push(orient(S.torus(0.09, 0.007), add3(cc, [0, 0.016, -0.004]), ax).color(C.felt3).pbr(0.8).paint(0.003, 0.003));
    for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.55; neck.hard.push(...bell([Math.sin(a) * 0.1, 0.97 - Math.cos(a) * 0.02, 0.98 + Math.cos(a) * 0.06], 0.017, BRASS, 1)); }
    neck.hard.push(...tassel([0, 0.86, 1.06], 0.16, 0.012, C.felt1, C.felt3, 1));
  }
  const head = N('head', 'neck', [0, 1.27, 1.02], { rig: 'mhead', detail: 1.15 });
  {
    const p = head.prims, h = head.hard;
    p.push(sk(S.ellipsoid(0.075, 0.082, 0.1).at(0, 1.31, 1.03)));
    p.push(sk(S.capsule([0, 1.3, 1.08], [0, 1.25, 1.24], 0.064, 0.054).blend(0.04)));
    p.push(sk(S.ellipsoid(0.05, 0.04, 0.045).at(0, 1.215, 1.255).blend(0.02), C.lip));                      // the drooping split lip
    p.push(S.box(0.005, 0.03, 0.03, 0.002).at(0, 1.225, 1.295).cut(0.003));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.03, 0.022, 0.035).at(0.05, 1.355, 1.08).blend(0.02)), S.capsule([0.022, 1.27, 1.27], [0.03, 1.28, 1.25], 0.006).cut(0.003)]));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.018, 0.035, 0.014).rot(-20, 0, -30).at(0.06, 1.39, 0.98).blend(0.015))]));      // small round ears
    p.push(wool(S.ellipsoid(0.06, 0.04, 0.06).at(0, 1.39, 1.0).blend(0.02)));
    for (const sx of [1, -1]) h.push(eyeAt([0.066 * sx, 1.33, 1.085], [sx, 0.1, 0.45], 0.016, { iris: 0x3a2010, rim: 0x1a0c06, white: 0x2a1a10, slit: false }));
    // halter: a red-and-gold noseband with a crown tassel
    const hb = (pts) => H.tube(pts, 0.008, 18, 5).color(C.felt1).pbr(0.8);
    h.push(hb([[0.062, 1.25, 1.18], [0, 1.31, 1.19], [-0.062, 1.25, 1.18], [0, 1.2, 1.17], [0.062, 1.25, 1.18]]));
    for (const sx of [1, -1]) h.push(hb([[0.062 * sx, 1.25, 1.18], [0.075 * sx, 1.32, 1.06], [0.06 * sx, 1.4, 0.98]]));
    h.push(hb([[0.06, 1.4, 0.98], [0, 1.43, 0.97], [-0.06, 1.4, 0.98]]));
    for (const sx of [1, -1]) h.push(H.sphere(0.012, 8).at(0.068 * sx, 1.25, 1.18).color(BRASS).pbr(0.3, 0.9).lod(1));
    h.push(...tassel([0, 1.43, 0.99], 0.08, 0.01, C.felt1, C.felt3, 1));
    h.push(H.cone(0.012, 0.11, 6).at(0, 1.49, 0.98).color(C.felt3).pbr(0.6).lod(1));
  }
  const jaw = N('jaw', 'head', [0, 1.27, 1.07], { rig: 'mjaw', detail: 1.1 });
  jaw.prims.push(sk(S.ellipsoid(0.042, 0.026, 0.08).at(0, 1.215, 1.17), C.lip));
  // legs: long, knobby, padded feet
  const foot = (pw, A, F) => {
    pw.prims.push(S.ellipsoid(0.07, 0.03, 0.085).at(F[0], 0.03, F[2] + 0.02).color(C.pad).pbr(0.85).blend(0.025));
    for (const dx of [-0.028, 0.028]) {
      pw.prims.push(S.ellipsoid(0.03, 0.026, 0.045).at(F[0] + dx, 0.028, F[2] + 0.085).color(C.pad).pbr(0.85).blend(0.015));
      pw.hard.push(H.sphere(0.014, 8).scale(1, 0.6, 1.3).at(F[0] + dx, 0.03, F[2] + 0.125).color(C.nail).pbr(0.4).lod(1));
    }
  };
  const knee = (sh, K) => sh.prims.push(S.ellipsoid(0.05, 0.05, 0.04).at(K[0], K[1], K[2] + 0.025).color(C.deep).pbr(0.9).paint(0.01, 0.006));
  const FL = [[0.14, 0.76, 0.36], [0.15, 0.44, 0.39], [0.14, 0.12, 0.36], [0.14, 0, 0.38]];
  const BL = [[0.15, 0.82, -0.44], [0.16, 0.5, -0.52], [0.14, 0.12, -0.5], [0.14, 0, -0.48]];
  for (const [P0, nm, sx, rr, th] of [[FL, 'FL', 1, [0.085, 0.048, 0.034, 0.045], [0.1, 0.17, 0.11]], [FL, 'FR', -1, [0.085, 0.048, 0.034, 0.045], [0.1, 0.17, 0.11]], [BL, 'BL', 1, [0.1, 0.05, 0.034, 0.045], [0.11, 0.2, 0.14]], [BL, 'BR', -1, [0.1, 0.05, 0.034, 0.045], [0.11, 0.2, 0.14]]]) {
    const pts = P0.map(sideX(sx));
    const lg = leg3(N, nm, 'body', pts, rr, sk, { detail: 0.75, minRes: 40, thigh: th, thighOff: [0, 0.03, 0], foot });
    knee(lg.sh, pts[1]);
    if (nm[0] === 'F') lg.sh.prims.push(S.ellipsoid(0.04, 0.035, 0.035).at(pts[2][0], pts[2][1] + 0.12, pts[2][2] + 0.02).color(C.deep).paint(0.01, 0.004));
  }
  // tail with a dark tuft
  addChain(N, 'tail', 'body', [[0, 0.9, -0.66], [0, 0.78, -0.72], [0, 0.62, -0.72]], [0.035, 0.025, 0.018], (q) => sk(q), { rig: 'tail', detail: 0.9, deco: (n, a, b, ra, rb, i) => { if (i === 1) n.hard.push(H.cone(0.035, 0.16, 8).rot(180, 0, 0).at(b[0], b[1] - 0.06, b[2]).color(HAIR).pbr(0.9)); } });
  // ---- tack: felt saddle-cloths between and over the humps, a wooden saddle, tassels and bells ----
  const tack = N('tack', 'body', BO, { detail: 0.75 });
  const seat = [0, 1.2, -0.03];
  {
    const p = tack.prims, h = tack.hard;
    const felt = (q, c) => q.color(c).bump(0.003, 50, 'weave').tint(0.08, 30).pbr(0.95);
    p.push(felt(S.ellipsoid(0.255, 0.27, 0.27).at(0, 0.89, -0.03), C.felt1));
    p.push(S.box(1, 0.6, 1.2, 0.01).at(0, 0.4, -0.03).cut(0.01));                                                     // the cloth stops half way down
    p.push(S.box(0.8, 0.045, 0.8, 0.004).at(0, 0.7, -0.03).color(C.felt3).paint(0.004, 0.004));                       // a gold hem band
    p.push(S.box(0.8, 0.015, 0.8, 0.004).at(0, 0.745, -0.03).color(C.white).paint(0.003, 0.002));
    for (const sx of [1, -1]) for (let i = 0; i < 3; i++) {                                                         // indigo lozenges on each flank
      const z = -0.17 + i * 0.14;
      p.push(S.box(0.06, 0.075, 0.075, 0.004).rot(45, 0, 0).at(sx * 0.25, 0.85, z).color(C.felt2).paint(0.004, 0.003));
      p.push(S.box(0.06, 0.035, 0.035, 0.004).rot(45, 0, 0).at(sx * 0.255, 0.85, z).color(C.felt3).paint(0.003, 0.004));
    }
    // a second, smaller cloth over the front hump and a blanket roll on the rear hump
    p.push(felt(S.ellipsoid(0.17, 0.09, 0.2).at(0, 1.18, 0.22).blend(0.005), C.felt2));
    p.push(felt(S.capsule([0.17, 1.19, -0.25], [-0.17, 1.19, -0.25], 0.07), C.felt4).blend(0.004));
    for (let i = 0; i < 4; i++) p.push(S.torus(0.072, 0.008).rot(0, 0, 90).at(-0.12 + i * 0.08, 1.19, -0.25).color(LEATHER).paint(0.004, 0.006));
    // the saddle: a cushion between the humps and two arched wooden bows
    p.push(felt(S.ellipsoid(0.16, 0.06, 0.13).at(0, 1.135, -0.03).blend(0.01), C.felt2));
    for (const z of [0.08, -0.14]) h.push(H.tube([[-0.17, 1.06, z], [-0.1, 1.2, z], [0, 1.24, z], [0.1, 1.2, z], [0.17, 1.06, z]], 0.016, 20, 6).color(C.wood).pbr(0.7));
    for (const z of [0.08, -0.14]) for (const sx of [1, -1]) h.push(H.sphere(0.02, 8).at(sx * 0.1, 1.2, z).color(BRASS).pbr(0.3, 0.9).lod(1));
    // tassels of horse-hair round the hem, bells at the corners
    for (const sx of [1, -1]) {
      for (let i = 0; i < 8; i++) {
        const z = -0.27 + i * 0.07, x = sx * Math.sqrt(Math.max(0, 1 - Math.pow((z + 0.03) / 0.27, 2))) * 0.255 * 0.98;
        h.push(...tassel([x + sx * 0.008, 0.705, z], 0.09 + (i % 2) * 0.03, 0.008, i % 2 ? HAIR : C.felt1, C.felt3, 1));
      }
      h.push(...bell([sx * 0.2, 0.68, 0.18], 0.022, BRASS, 1), ...bell([sx * 0.2, 0.68, -0.25], 0.022, BRASS, 1));
    }
    // girth strap
    p.push(S.torus(0.25, 0.014).rot(90, 0, 0).scale(1).at(0, 0.86, 0.1).color(LEATHER_D).pbr(0.7).blend(0.004));
    // a quiver of javelins and a round shield on the off side
    h.push(H.cyl(0.04, 0.035, 0.36, 10).rot(18, 0, 0).at(-0.27, 0.95, -0.2).color(LEATHER).pbr(0.7).shade((x, y) => (Math.abs(y) > 0.15 ? rgb(C.felt3) : null)));
    h.push(H.cyl(0.13, 0.13, 0.025, 20).rot(0, 0, 90).at(0.28, 0.92, -0.3).color(C.felt1).pbr(0.6).shade((x, y, z) => (Math.hypot(y, z) > 0.11 ? rgb(BRASS) : Math.hypot(y, z) < 0.03 ? rgb(BRASS) : null)));
    h.push(H.sphere(0.03, 10).scale(0.6, 1, 1).at(0.295, 0.92, -0.3).color(BRASS).pbr(0.3, 0.9));
  }
  scaleNodes(N.nodes, 1 / sc);
  const nodes = finish(N.nodes);
  // the rider and his stirrups
  const rs = num(o.rider?.scale, 1), R = makeRider(def, o.rider, rs / sc);
  const seatS = mul3(seat, 1 / sc), BOs = mul3(BO, 1 / sc);
  const stir = nodes.find((n) => n.name === 'tack');
  for (const side of [1, -1]) {
    const ft = riderPt(R, seatS, R.foot(side)), top = [side * 0.17 / sc, 1.1 / sc, -0.03 / sc];
    const rel = (q) => sub3(q, BOs);
    stir.hard.push(H.tube([rel(top), rel([ft[0] + side * 0.01 / sc, (ft[1] + top[1]) / 2, ft[2] - 0.01 / sc]), rel([ft[0], ft[1] + 0.05 / sc, ft[2]])], 0.007 / sc, 10, 4).color(LEATHER_D).pbr(0.7));
    stir.hard.push(H.torus(0.03 / sc, 0.006 / sc, 14, 5).at(...rel([ft[0], ft[1] + 0.02 / sc, ft[2]])).color(IRON).pbr(0.4, 0.9));
  }
  seatRider(nodes, R, 'body', BOs, seatS);
  thin(nodes, 0.62);
  return { kind: 'beast.rider', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: 'bull', mount: 'horse', girth: 1.6, ...R.vals, nodes };
}

// =====================================================================================
//  WAR-HIPPOCAMPUS
// =====================================================================================
function hippoRider(def, o = {}) {
  const sc = num(o.scale, 1.3), hide = col(o.hide, 0x2aa8b8), finC = col(o.fin, 0xe8f0f0);
  const C = { hide, dark: tone(hide, 0.02, 0.05, -0.14), deep: tone(hide, 0.03, 0.05, -0.24), belly: mix(hide, 0xf0f4e8, 0.6), fin: finC, finEdge: mix(finC, hide, 0.45), ray: mix(finC, hide, 0.25), hoof: 0x2a3a44, pearl: 0xf4f0e8, shell: 0xe8b898, gold: 0xe0c060, cloth: 0x1a3a7a };
  const sk = (q, c = hide) => q.color(c).bump(0.0045, 40, 'scales').tint(0.14, 12).pbr(0.32, 0.12);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const BO = [0, 0.76, 0];
  const body = N('body', 'root', BO, { rig: 'body', detail: 0.75 });
  {
    const p = body.prims;
    p.push(sk(S.ellipsoid(0.2, 0.24, 0.24).at(0, 0.78, 0.2)));
    p.push(sk(S.ellipsoid(0.19, 0.22, 0.3).at(0, 0.77, -0.08).blend(0.08)));
    p.push(sk(S.ellipsoid(0.13, 0.14, 0.17).at(0, 0.93, 0.27).blend(0.07)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.08, 0.15, 0.13).at(0.11, 0.76, 0.3).blend(0.05))]));
    p.push(S.ellipsoid(0.15, 0.09, 0.36).at(0, 0.56, 0.06).color(C.belly).paint(0.05));
    p.push(S.ellipsoid(0.1, 0.2, 0.06).at(0, 0.72, 0.42).color(C.belly).paint(0.04));
    for (let i = 0; i < 5; i++) p.push(S.box(0.3, 0.012, 0.1, 0.004).at(0, 0.57 + i * 0.002, 0.24 - i * 0.1).color(tone(C.belly, 0, 0, -0.08)).paint(0.004, -0.003));
    p.push(S.ellipsoid(0.08, 0.06, 0.4).at(0, 0.99, -0.04).color(C.dark).paint(0.04));
  }
  // the seahorse tail: armoured rings, a dorsal fin, curled forward under itself on the ground
  const TP = [[0, 0.76, -0.3], [0, 0.63, -0.55], [0, 0.44, -0.7], [0, 0.25, -0.72], [0, 0.11, -0.6], [0, 0.1, -0.43], [0, 0.17, -0.34], [0, 0.26, -0.37], [0, 0.29, -0.46]];
  const TR = [0.18, 0.15, 0.12, 0.096, 0.076, 0.06, 0.045, 0.032, 0.016];
  addChain(N, 'tail', 'body', TP, TR, sk, { rig: 'tail', detail: 0.8, minRes: 34, up: [1, 0, 0], deco: (n, a, b, ra, rb, i, f) => {
    const out = norm3(cross3(f.t, [1, 0, 0])), dor = mul3(out, -1);   // `out` faces the belly side of the curl
    for (let q = 0; q < 2; q++) n.prims.push(orient(S.torus(lerp(ra, rb, (q + 0.5) / 2) * 0.98, 0.009), lerp3(a, b, (q + 0.5) / 2), f.t).color(C.dark).paint(0.004, 0.005));
    n.prims.push(S.capsule(add3(a, mul3(out, ra * 0.6)), add3(b, mul3(out, rb * 0.6)), ra * 0.6, rb * 0.6).color(C.belly).paint(0.02));
    for (const sx of [1, -1]) n.hard.push(spike(add3(lerp3(a, b, 0.5), add3(mul3([sx, 0, 0], ra * 0.8), mul3(dor, ra * 0.4))), add3([sx, 0, 0], mul3(dor, 0.5)), ra * 0.35, ra * 0.1, C.deep, f.t, 0.1).lod(1));
    if (i < 4) {
      const nb = 3, bases = [], tips = [];
      for (let j = 0; j <= nb; j++) { const u = j / nb, q = add3(lerp3(a, b, u), mul3(dor, lerp(ra, rb, u) * 0.85)); bases.push(q); tips.push(add3(q, add3(mul3(dor, 0.11 * (1 - i * 0.18)), mul3(f.t, -0.03)))); }
      n.hard.push(...fin(bases, tips, C.fin, C.ray, { edge: C.finEdge, glossy: true }).map((x, j) => (j ? x : x.near())));
    }
  } });
  // neck, crest fin, head
  const NB = [0, 0.92, 0.36];
  const neck = N('neck', 'body', NB, { rig: 'mneck', detail: 0.8 });
  {
    const pts = [NB, [0, 1.04, 0.47], [0, 1.14, 0.55]];
    neck.prims.push(sk(S.capsule(pts[0], pts[1], 0.14, 0.105).blend(0.03)), sk(S.capsule(pts[1], pts[2], 0.105, 0.085).blend(0.03)));
    neck.prims.push(S.capsule([0, 0.86, 0.46], [0, 1.08, 0.6], 0.06, 0.04).color(C.belly).paint(0.02));
    const bases = [], tips = [];
    for (let j = 0; j <= 7; j++) { const u = j / 7, q = add3(lerp3([0, 0.98, 0.22], [0, 1.22, 0.52], u), [0, 0.02 * Math.sin(u * Math.PI), 0]); bases.push(q); tips.push(add3(q, [0, 0.16 * (1 - Math.pow(Math.abs(u - 0.45) * 1.8, 2) * 0.5), -0.12 - 0.04 * u])); }
    neck.hard.push(...fin(bases, tips, C.fin, C.ray, { edge: C.finEdge, glossy: true, rayR: 0.007 }));
    // a breast-collar of pearls and a shell boss
    const cc = [0, 0.93, 0.45];
    neck.prims.push(orient(S.torus(0.135, 0.016), cc, [0, 1, -0.5]).color(C.cloth).pbr(0.6).blend(0.005));
    for (let i = 0; i < 11; i++) { const a = (i - 5) * 0.26; neck.hard.push(H.sphere(0.012, 8).at(Math.sin(a) * 0.15, 0.9 - Math.cos(a) * 0.01, 0.5 + Math.cos(a) * 0.06).color(C.pearl).pbr(0.15, 0.3).lod(1)); }
  }
  const head = N('head', 'neck', [0, 1.16, 0.57], { rig: 'mhead', detail: 1.15 });
  {
    const p = head.prims, h = head.hard;
    p.push(sk(S.ellipsoid(0.07, 0.08, 0.09).at(0, 1.2, 0.6)));
    p.push(sk(S.capsule([0, 1.17, 0.64], [0, 1.06, 0.8], 0.062, 0.05).blend(0.04)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.03, 0.045, 0.04).at(0.05, 1.15, 0.6).blend(0.03))]));
    p.push(sk(S.ellipsoid(0.048, 0.035, 0.03).at(0, 1.04, 0.82).blend(0.02), C.belly));
    p.push(...S.mirrorX([S.capsule([0.02, 1.07, 0.835], [0.026, 1.08, 0.82], 0.006).cut(0.003)]));
    p.push(S.ellipsoid(0.04, 0.03, 0.14).at(0, 1.22, 0.66).color(C.dark).paint(0.02));
    for (const sx of [1, -1]) {
      h.push(eyeAt([0.058 * sx, 1.21, 0.64], [sx, 0.1, 0.4], 0.017, { iris: 0x1a6a8a, rim: 0x0a2a3a, white: 0x10202a, slit: false }));
      // fin-ears and gill frills
      const eb = [0.045 * sx, 1.26, 0.57];
      h.push(...fin([eb, add3(eb, [0.005 * sx, 0.015, -0.035])], [add3(eb, [0.04 * sx, 0.12, -0.02]), add3(eb, [0.03 * sx, 0.07, -0.12])], C.fin, C.ray, { edge: C.finEdge, glossy: true }));
      const gb = [0.06 * sx, 1.14, 0.56];
      h.push(...fin([add3(gb, [0, 0.04, 0.01]), gb, add3(gb, [0, -0.05, 0.0])], [add3(gb, [0.07 * sx, 0.07, -0.08]), add3(gb, [0.08 * sx, 0.0, -0.1]), add3(gb, [0.06 * sx, -0.07, -0.07])], C.fin, C.ray, { edge: C.finEdge, glossy: true }));
    }
    // a bridle of blue cord with pearl studs
    const cord = (pts) => H.tube(pts, 0.006, 16, 5).color(C.cloth).pbr(0.6);
    h.push(cord([[0.055, 1.08, 0.75], [0, 1.12, 0.77], [-0.055, 1.08, 0.75], [0, 1.03, 0.74], [0.055, 1.08, 0.75]]));
    for (const sx of [1, -1]) h.push(cord([[0.055 * sx, 1.08, 0.75], [0.068 * sx, 1.18, 0.64], [0.05 * sx, 1.27, 0.57]]), H.sphere(0.01, 8).at(0.058 * sx, 1.08, 0.75).color(C.pearl).pbr(0.15, 0.3).lod(1));
  }
  const jaw = N('jaw', 'head', [0, 1.1, 0.66], { rig: 'mjaw', detail: 1.1 });
  jaw.prims.push(sk(S.ellipsoid(0.04, 0.022, 0.07).at(0, 1.045, 0.76), C.belly));
  // fore-legs with finned forearms and fetlocks
  const hoof = (pw, A, F) => {
    pw.prims.push(S.cone(0.055, 0.042, 0.07, 0.008).at(F[0], 0.035, F[2]).color(C.hoof).pbr(0.35, 0.2).blend(0.01));
    const b = [[F[0], A[1] - 0.01, A[2] - 0.03], [F[0], A[1] - 0.06, A[2] - 0.035], [F[0], 0.06, F[2] - 0.04]];
    pw.hard.push(...fin(b, b.map((q, i) => add3(q, [0, -0.02 - i * 0.02, -0.1 + i * 0.02])), C.fin, C.ray, { edge: C.finEdge, glossy: true }));
  };
  const FL = [[0.12, 0.7, 0.28], [0.13, 0.42, 0.31], [0.12, 0.14, 0.29], [0.12, 0, 0.31]];
  for (const [nm, sx] of [['FL', 1], ['FR', -1]]) {
    const pts = FL.map(sideX(sx));
    const lg = leg3(N, nm, 'body', pts, [0.08, 0.046, 0.034, 0.045], sk, { detail: 0.75, minRes: 40, thigh: [0.075, 0.15, 0.1], thighOff: [0, 0.02, 0], foot: hoof });
    const b = [lerp3(pts[1], pts[2], 0.05), lerp3(pts[1], pts[2], 0.35), lerp3(pts[1], pts[2], 0.7)].map((q) => add3(q, [0, 0, -0.035]));
    lg.sh.hard.push(...fin(b, b.map((q, i) => add3(q, [sx * 0.03, 0.02 - i * 0.02, -0.14 + i * 0.03])), C.fin, C.ray, { edge: C.finEdge, glossy: true }));
  }
  // a scallop-shell saddle with a deep blue seat
  const tack = N('tack', 'body', BO, { detail: 0.8 });
  const seat = [0, 1.06, 0.0];
  {
    const p = tack.prims, h = tack.hard;
    p.push(S.ellipsoid(0.21, 0.12, 0.27).at(0, 0.9, 0.0).color(C.cloth).bump(0.003, 50, 'weave').pbr(0.8));
    p.push(S.box(1, 0.6, 1, 0.01).at(0, 0.5, 0).cut(0.01));
    p.push(S.box(0.6, 0.03, 0.7, 0.004).at(0, 0.82, 0).color(C.gold).pbr(0.3, 0.9).paint(0.003, 0.004));
    p.push(S.ellipsoid(0.13, 0.05, 0.14).at(0, 1.0, 0.0).color(C.cloth).pbr(0.7).blend(0.01));
    // the cantle: a fan of ribs like a scallop shell
    for (let i = 0; i < 9; i++) { const a = (i - 4) * 0.3; h.push(H.tube([[0, 1.0, -0.1], [Math.sin(a) * 0.08, 1.06 + Math.cos(a) * 0.05, -0.13], [Math.sin(a) * 0.13, 1.06 + Math.cos(a) * 0.12, -0.16]], [0.02, 0.025, 0.018], 8, 5).color(i % 2 ? C.shell : tone(C.shell, 0, 0, 0.06)).pbr(0.35, 0.1)); }
    h.push(H.tube([[0, 0.98, 0.12], [0, 1.06, 0.15], [0, 1.08, 0.17]], [0.025, 0.02, 0.012], 8, 6).color(C.shell).pbr(0.35, 0.1));
    for (const sx of [1, -1]) for (let i = 0; i < 6; i++) h.push(H.sphere(0.011, 8).at(sx * 0.2, 0.84, -0.18 + i * 0.07).color(C.pearl).pbr(0.15, 0.3).lod(1));
    p.push(S.torus(0.2, 0.013).rot(90, 0, 0).at(0, 0.78, 0.12).color(C.cloth).pbr(0.6).blend(0.004));
  }
  scaleNodes(N.nodes, 1 / sc);
  const nodes = finish(N.nodes);
  const rs = num(o.rider?.scale, 1), R = makeRider(def, o.rider, rs / sc);
  const seatS = mul3(seat, 1 / sc), BOs = mul3(BO, 1 / sc);
  const tk = nodes.find((n) => n.name === 'tack');
  for (const side of [1, -1]) {
    const ft = riderPt(R, seatS, R.foot(side)), top = [side * 0.18 / sc, 0.95 / sc, 0.02 / sc], rel = (q) => sub3(q, BOs);
    tk.hard.push(H.tube([rel(top), rel([ft[0] + side * 0.01 / sc, (ft[1] + top[1]) / 2, ft[2]]), rel([ft[0], ft[1] + 0.04 / sc, ft[2]])], 0.006 / sc, 10, 4).color(C.cloth).pbr(0.6));
    tk.hard.push(H.torus(0.028 / sc, 0.007 / sc, 14, 5).at(...rel([ft[0], ft[1] + 0.02 / sc, ft[2]])).color(C.shell).pbr(0.35, 0.1));
  }
  seatRider(nodes, R, 'body', BOs, seatS);
  thin(nodes, 0.62);
  return { kind: 'fringe.hippo', attack: R.desc.attack, hold: R.desc.hold || 'none', gait: 'horse', mount: 'horse', girth: 1.3, ...R.vals, nodes };
}
function hippoAnim(rig, inner, c, base) {
  BEAST_ANIM['beast.rider'](rig, inner, c, base);
  const { R } = base, t = c.t, ph = c.phase || 0, k = c.moving ? 1 : 0, T = rig.tail || [];
  if (c.dead > 0) return;
  // the curled tail rolls under it like a spring as it bounds along on its forelegs
  const g = t * 10 + ph;
  T.forEach((seg, i) => R(seg, (k ? Math.sin(g - i * 0.7) * 0.07 : Math.sin(t * 1.2 + ph - i * 0.6) * 0.03) + (i > 3 ? -0.04 * k : 0), Math.sin(t * 1.6 + ph - i * 0.8) * 0.03, 0));
  if (k) inner.position.y += Math.max(0, Math.sin(g)) * 0.03 * (inner.scale.y || 1);
}

// =====================================================================================
//  GIANT SWAN (and its halfling scout)
// =====================================================================================
function swanRider(def, o = {}) {
  const sc = num(o.scale, 1.2), plume = col(o.plumage, 0xf0f0ec);
  const C = {
    plume, shade: tone(plume, 0, 0, -0.1), grey: mix(plume, 0x8a8a90, 0.3), bill: 0xe87a20, knob: 0x141414, foot: 0x1c1c1e,
    cloth: 0x3a6a2a, cloth2: 0xc8a040, leather: LEATHER,
  };
  const fe = (q, c = plume) => q.color(c).bump(0.006, 24, 'scales').tint(0.06, 12).pbr(0.75);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const BO = [0, 0.48, -0.05];
  const body = N('body', 'root', BO, { rig: 'body', detail: 0.72 });
  {
    const p = body.prims;
    p.push(fe(S.ellipsoid(0.3, 0.24, 0.52).at(0, 0.52, -0.06)));
    p.push(fe(S.ellipsoid(0.27, 0.25, 0.3).at(0, 0.49, 0.28).blend(0.09)));
    p.push(fe(S.ellipsoid(0.2, 0.15, 0.25).at(0, 0.6, -0.46).blend(0.09)));
    p.push(fe(S.ellipsoid(0.12, 0.1, 0.12).at(0, 0.68, -0.64).blend(0.06)));
    p.push(fe(S.ellipsoid(0.24, 0.1, 0.4).at(0, 0.32, -0.02).blend(0.06), C.shade));
    // folded-feather ridges along the flanks
    for (const sx of [1, -1]) for (let i = 0; i < 5; i++) p.push(S.ellipsoid(0.02, 0.06, 0.12).rot(0, 0, sx * 30).at(sx * 0.26, 0.52 - i * 0.012, 0.15 - i * 0.13).color(C.shade).paint(0.01, 0.004));
  }
  // the S of the neck, as two nodes so it can coil
  const NB = [0, 0.6, 0.42];
  const neck = N('neck', 'body', NB, { rig: 'neck', detail: 0.85 });
  const NP = [NB, [0, 0.82, 0.58], [0, 1.02, 0.56], [0, 1.2, 0.48], [0, 1.34, 0.5], [0, 1.42, 0.58]], NR = [0.13, 0.085, 0.068, 0.062, 0.058, 0.055];
  for (let i = 0; i < NP.length - 1; i++) neck.prims.push(fe(S.capsule(NP[i], NP[i + 1], NR[i], NR[i + 1]).blend(0.03)));
  // reins and a red-and-green neck band
  neck.prims.push(orient(S.torus(0.075, 0.012), [0, 0.92, 0.585], [0, 1, 0.15]).color(C.cloth).pbr(0.8).blend(0.004));
  neck.hard.push(...bell([0, 0.88, 0.66], 0.016, BRASS, 1));
  const head = N('head', 'neck', [0, 1.42, 0.58], { rig: 'mhead', detail: 1.3 });
  {
    const p = head.prims, h = head.hard;
    p.push(fe(S.ellipsoid(0.055, 0.058, 0.075).at(0, 1.45, 0.6)));
    p.push(fe(S.capsule([0, 1.44, 0.62], [0, 1.42, 0.67], 0.045, 0.036).blend(0.03)));
    p.push(S.sphere(0.024).at(0, 1.455, 0.67).color(C.knob).pbr(0.3).blend(0.015));
    p.push(...S.mirrorX([S.ellipsoid(0.022, 0.02, 0.04).at(0.03, 1.445, 0.64).color(C.knob).paint(0.006)]));
    p.push(S.capsule([0, 1.43, 0.68], [0, 1.395, 0.8], 0.026, 0.016).color(C.bill).pbr(0.35).blend(0.01));
    p.push(S.ellipsoid(0.03, 0.012, 0.11).at(0, 1.42, 0.73).color(C.bill).pbr(0.35).blend(0.012));
    p.push(S.ellipsoid(0.012, 0.008, 0.012).at(0, 1.405, 0.805).color(C.knob).paint(0.004));
    for (const sx of [1, -1]) h.push(eyeAt([0.04 * sx, 1.46, 0.63], [sx, 0.1, 0.3], 0.01, { iris: 0x1a1008, rim: 0x0a0604, white: 0x0a0604, slit: false }));
    // bridle: a thin green cord round the bill
    h.push(H.tube([[0.03, 1.425, 0.7], [0, 1.445, 0.705], [-0.03, 1.425, 0.7], [0, 1.395, 0.695], [0.03, 1.425, 0.7]], 0.004, 16, 4).color(C.cloth).pbr(0.6).lod(1));
  }
  const jaw = N('jaw', 'head', [0, 1.425, 0.66], { rig: 'mjaw', detail: 1.2 });
  jaw.prims.push(S.capsule([0, 1.415, 0.68], [0, 1.39, 0.79], 0.016, 0.01).color(tone(C.bill, 0, 0, -0.06)).pbr(0.4));
  // short black legs, webbed feet
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const J = X([0.13, 0.36, -0.08]), K = X([0.14, 0.2, -0.04]), A = X([0.14, 0.05, 0.0]);
    const lg = N(`leg${nm}`, 'body', J, { rig: 'legs', detail: 1.0, minRes: 60 });
    lg.prims.push(fe(S.ellipsoid(0.07, 0.09, 0.09).at(...lerp3(J, K, 0.2))), S.capsule(lerp3(J, K, 0.4), K, 0.035, 0.026).color(C.foot).pbr(0.5).blend(0.02));
    const sh = N(`shin${nm}`, `leg${nm}`, K, { rig: 'shins', detail: 1.0, minRes: 60 });
    sh.prims.push(S.sphere(0.027).at(...K).color(C.foot).pbr(0.5), S.capsule(K, A, 0.024, 0.02).color(C.foot).pbr(0.5).blend(0.01));
    const toes = [-0.45, 0, 0.45].map((a) => add3(A, [Math.sin(a) * 0.13, -0.04, Math.cos(a) * 0.13]));
    for (const tp of toes) sh.prims.push(S.capsule(A, tp, 0.014, 0.01).color(C.foot).pbr(0.5).blend(0.01));
    sh.hard.push(H.geo(fanGeo([A, A], [toes[0], toes[1]], 0.15)).color(C.foot).pbr(0.6), H.geo(fanGeo([A, A], [toes[1], toes[2]], 0.15)).color(C.foot).pbr(0.6));
  }
  // tail: a short upturned fan
  const TPt = [0, 0.66, -0.66];
  const tail = N('tail', 'body', TPt, { rig: 'tail', detail: 0.9 });
  for (let i = 0; i < 9; i++) { const f = (i / 8) * 2 - 1, a = f * 0.6; tail.hard.push(feather(add3(TPt, [f * 0.06, 0, 0]), [Math.sin(a), 0.45, -Math.cos(a)], 0.2 - Math.abs(f) * 0.04, 0.04, [rgb(plume), rgb(C.shade)], [0, 1, 0.3], 0)); }
  // great wings, authored spread
  const G = { Sh: [0.2, 0.64, 0.2], E: [0.58, 0.68, 0.08], W: [0.92, 0.66, 0.2], T: [1.5, 0.62, 0.02] };
  const wc = { bone: plume, a: plume, b: tone(plume, 0, 0, -0.04), tip: C.grey, covert: tone(plume, 0, 0, 0.02), shape: 0 };
  addWings(N, 'body', G, () => featherWing(G, wc, { len: 0.62, n: [10, 10], r: 0.06, skin: (q) => fe(q) }), 0.8);
  // a small saddle on the shoulders, the halfling's pack behind
  const tack = N('tack', 'body', BO, { detail: 0.9 });
  const seat = [0, 0.8, 0.14];
  {
    const p = tack.prims, h = tack.hard;
    p.push(S.ellipsoid(0.14, 0.05, 0.14).at(0, 0.765, 0.14).color(C.cloth).bump(0.003, 50, 'weave').pbr(0.85));
    p.push(S.ellipsoid(0.15, 0.02, 0.15).at(0, 0.745, 0.14).color(C.cloth2).pbr(0.6).blend(0.004));
    p.push(S.ellipsoid(0.1, 0.06, 0.03).rot(-10, 0, 0).at(0, 0.8, 0.04).color(C.leather).pbr(0.6).blend(0.01));
    p.push(orient(S.torus(0.27, 0.012), [0, 0.5, 0.2], [0, 0.15, 1]).color(C.leather).pbr(0.6).blend(0.004));
    p.push(S.ellipsoid(0.08, 0.07, 0.07).at(0, 0.8, -0.04).color(0x7a5a3a).pbr(0.85).blend(0.01));
    p.push(S.capsule([0.1, 0.84, -0.06], [-0.1, 0.84, -0.06], 0.035).color(0x3a5a8a).pbr(0.9).blend(0.006));
    for (let i = 0; i < 3; i++) p.push(S.torus(0.037, 0.005).rot(0, 0, 90).at(-0.06 + i * 0.06, 0.84, -0.06).color(LEATHER_D).paint(0.003, 0.004));
    h.push(...bell([0.06, 0.73, 0.02], 0.012, BRASS, 1));
  }
  scaleNodes(N.nodes, 1 / sc);
  const nodes = finish(N.nodes);
  const rs = num(o.rider?.scale, 0.68), R = makeRider(def, o.rider || { species: 'halfling', outfit: 'doublet', weapon: 'longbow' }, rs / sc);
  const seatS = mul3(seat, 1 / sc), BOs = mul3(BO, 1 / sc);
  seatRider(nodes, R, 'body', BOs, seatS);
  thin(nodes, 0.62);
  return { kind: 'fringe.swan', attack: R.desc.attack, hold: R.desc.hold || 'none', perch: 0.04, rate: 6.4, ...R.vals, nodes };
}

const _cu = { t: 0, phase: 0, atk: -1, dead: 0, moving: false, flying: false };
/** the rider's upper body: stock arms, weapon from humanoid, the free hand on the rein */
function rideUpper(rig, c, base) {
  const { R } = base;
  const A = rig.arms || [], F = rig.forearms || [], T = rig.torso;
  _cu.t = c.t; _cu.phase = c.phase || 0; _cu.dead = c.dead; _cu.flying = false; _cu.moving = false; _cu.atk = c.atk;
  base.upperBody(rig, _cu);
  if (T && !(c.dead > 0)) T.rotation.x += (c.moving || c.flying ? 0.14 : 0.03);
  const bowish = rig.hold === 'bow' || rig.hold === 'xbow';
  poseCarried(rig, _cu, base, rig.hold, !bowish);
  if (c.dead > 0) return;
  if (!(bowish && c.atk >= 0)) { R(A[0], -0.62 + Math.sin(c.t * 1.6 + (c.phase || 0)) * 0.02, 0, 0.16); R(F[0], -0.95); }
}
function swanAnim(rig, inner, c, base) {
  // the great-bird animator poses the swan; its torso / head / jaw keys are the rider's here, so lend it the swan's
  const rt = rig.torso, rh = rig.head, rj = rig.jaw;
  rig.torso = rig.body; rig.head = (rig.mhead || [])[0]; rig.jaw = (rig.mjaw || [])[0];
  TITAN_ANIM['titan.bird'](rig, inner, c, base);
  rig.torso = rt; rig.head = rh; rig.jaw = rj;
  foldWings(rig, c, base);
  // a swan's neck carries its head high; on the water-walk it bobs
  if (!(c.dead > 0) && !c.flying && rig.neck) rig.neck.rotation.x += -0.05 + (c.moving ? Math.sin(c.t * 9 + (c.phase || 0)) * 0.05 : 0);
  if (c.flying && !(c.dead > 0) && rig.neck) { rig.neck.rotation.x += 1.05; const hd = (rig.mhead || [])[0]; if (hd) hd.rotation.x -= 0.85; }   // neck stretched out ahead in flight
  rideUpper(rig, c, base);
}

// =====================================================================================
//  STEAM-OWL
// =====================================================================================
function mechOwl(def, o = {}) {
  const brass = col(o.brass, 0xc8a040), glow = col(o.glow, 0x9ad8ff);
  const C = { brass, brassD: tone(brass, 0, -0.05, -0.16), brassL: tone(brass, 0.01, 0.05, 0.1), copper: 0xb8643a, copperD: 0x7a3a22, steel: 0x7a8088, steelD: 0x3a3e44, iron: 0x2a2c30, glass: glow, ember: 0xff8a30 };
  const br = (q, c = brass) => q.color(c).tint(0.1, 14).pbr(0.34, 0.9);
  const rnd = rng(hashStr(def?.id || 'owl'));
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const HIP = [0, 0.36, -0.04];
  const torso = N('torso', 'root', HIP, { rig: 'torso', detail: 0.85 });
  const BC = [0, 0.46, 0.02];
  {
    const p = torso.prims, h = torso.hard;
    p.push(br(S.ellipsoid(0.19, 0.19, 0.27).rot(-30, 0, 0).at(...BC)));
    p.push(br(S.ellipsoid(0.17, 0.17, 0.16).at(0, 0.5, 0.15).blend(0.06)));
    p.push(br(S.ellipsoid(0.12, 0.11, 0.15).at(0, 0.36, -0.18).blend(0.05), C.brassD));
    // riveted plate seams: rows of engraved rings round the body, staggered vertical seams
    for (let i = 0; i < 5; i++) p.push(orient(S.torus(0.18 - Math.abs(i - 1.5) * 0.012, 0.005), add3(BC, mul3(norm3([0, 0.5, 0.87]), -0.15 + i * 0.07)), [0, 0.5, 0.87]).color(C.brassD).paint(0.003, -0.003));
    // chest: overlapping scale plates of lighter brass
    for (let r = 0; r < 4; r++) for (let j = 0; j < 5 - (r % 2); j++) {
      const a = (j - (4 - (r % 2)) / 2) * 0.32, y = 0.58 - r * 0.075, rr = 0.165 - Math.abs(r - 1.2) * 0.01;
      const base = [Math.sin(a) * rr, y, 0.15 + Math.cos(a) * rr * 0.95];
      h.push(feather(base, [0, -1, 0.25], 0.085, 0.034, [rgb(C.brassL), rgb(brass)], [Math.sin(a), 0, Math.cos(a)], 0).pbr(0.3, 0.92).lod(1));
      h.push(H.sphere(0.006, 6).at(base[0] * 1.02, base[1] - 0.012, base[2] * 1.0 + 0.01).color(C.brassD).pbr(0.3, 0.9).lod(0));
    }
    // a pressure gauge set in the breast
    h.push(H.cyl(0.045, 0.045, 0.02, 18).rot(72, 0, 0).at(0, 0.42, 0.29).color(C.copper).pbr(0.3, 0.9));
    h.push(H.cyl(0.036, 0.036, 0.006, 18).rot(72, 0, 0).at(0, 0.423, 0.3).color(0xf0e8d0).pbr(0.2).glow(0.5).shade((x, y, z) => (Math.abs(x) < 0.003 && z > 0 ? 0x1a1a1a : null)));
    h.push(H.box(0.003, 0.03, 0.002, 0.0005).rot(72, 0, 30).at(0.006, 0.425, 0.305).color(0xc02020).lod(0));
    // the boiler on its back, its stack and an ember-lit grate
    const b0 = [0, 0.6, -0.12];
    h.push(orient(H.cyl(0.085, 0.085, 0.26, 18), b0, [0, 0.3, -1]).color(C.copper).pbr(0.3, 0.9));
    for (let i = 0; i < 3; i++) h.push(orient(H.torus(0.087, 0.008, 22, 5).rot(90, 0, 0), add3(b0, mul3(norm3([0, 0.3, -1]), -0.1 + i * 0.1)), [0, 0.3, -1]).color(C.brassD).pbr(0.3, 0.9));
    h.push(orient(H.sphere(0.085, 16).scale(1, 0.4, 1), add3(b0, mul3(norm3([0, 0.3, -1]), -0.13)), [0, 0.3, -1]).color(C.copperD).pbr(0.3, 0.9));
    const stack = add3(b0, [0, 0.06, 0.05]);
    h.push(H.cyl(0.02, 0.024, 0.16, 12).at(stack[0], stack[1] + 0.1, stack[2]).color(C.iron).pbr(0.5, 0.7));
    h.push(H.cyl(0.032, 0.022, 0.03, 12).at(stack[0], stack[1] + 0.19, stack[2]).color(C.iron).pbr(0.5, 0.7));
    h.push(H.cyl(0.018, 0.018, 0.006, 10).at(stack[0], stack[1] + 0.205, stack[2]).color(C.ember).glow(1.6));
    h.push(orient(H.cyl(0.04, 0.04, 0.006, 12), add3(b0, mul3(norm3([0, 0.3, -1]), 0.131)), [0, 0.3, -1]).color(C.ember).glow(1.4).shade((x, y, z) => (Math.abs(x) % 0.016 < 0.005 ? 0x2a1a10 : null)));
    // pipes from the boiler round to the wing roots and down to the legs
    for (const sx of [1, -1]) {
      h.push(H.tube([add3(b0, [sx * 0.06, 0.03, 0.06]), [sx * 0.14, 0.64, 0.02], [sx * 0.17, 0.6, 0.12]], 0.011, 16, 6).color(C.copper).pbr(0.3, 0.9));
      h.push(H.tube([add3(b0, [sx * 0.05, -0.06, 0.0]), [sx * 0.15, 0.42, -0.1], [sx * 0.1, 0.32, -0.04]], 0.009, 16, 6).color(C.brassD).pbr(0.3, 0.9).lod(1));
      h.push(H.torus(0.014, 0.005, 10, 5).rot(0, 0, 90).at(sx * 0.15, 0.635, 0.05).color(C.brassD).pbr(0.3, 0.9).lod(1));
    }
    // rivets down the seams
    for (let i = 0; i < 16; i++) { const a = rnd() * 6.283, yy = 0.35 + rnd() * 0.3; h.push(H.sphere(0.006, 6).at(Math.sin(a) * 0.185, yy, 0.02 + Math.cos(a) * 0.2).color(C.brassD).pbr(0.3, 0.9).lod(0)); }
  }
  // neck (a short collar of steel rings) and the great round head
  const NB = [0, 0.62, 0.12];
  const neck = N('neck', 'torso', NB, { rig: 'neck', detail: 0.9 });
  neck.prims.push(br(S.cyl(0.1, 0.08, 0.02).at(0, 0.67, 0.13), C.steel).pbr(0.4, 0.85));
  for (let i = 0; i < 3; i++) neck.prims.push(S.torus(0.1 - i * 0.004, 0.012).at(0, 0.63 + i * 0.028, 0.13).color(i % 2 ? C.steel : C.steelD).pbr(0.4, 0.85).blend(0.004));
  const head = N('head', 'neck', [0, 0.72, 0.14], { rig: 'head', detail: 1.3 });
  const HC = [0, 0.83, 0.15];
  {
    const p = head.prims, h = head.hard;
    p.push(br(S.ellipsoid(0.17, 0.15, 0.14).at(...HC)));
    p.push(br(S.ellipsoid(0.15, 0.06, 0.12).at(HC[0], HC[1] + 0.1, HC[2] - 0.02).blend(0.05), C.brassD));
    // the facial disc: two shallow dishes, copper rims
    for (const sx of [1, -1]) {
      const ec = [0.07 * sx, 0.84, 0.28];
      p.push(S.sphere(0.075).at(ec[0], ec[1], ec[2] + 0.03).cut(0.01).color(C.brassL));
      h.push(H.torus(0.075, 0.008, 28, 6).at(ec[0], ec[1], ec[2] - 0.012).color(C.copper).pbr(0.3, 0.9));
      // a lens in a bezel, its glow, and the iris shutter
      h.push(H.cyl(0.05, 0.054, 0.04, 22).rot(90, 0, 0).at(ec[0], ec[1], ec[2] - 0.01).color(C.iron).pbr(0.45, 0.8));
      h.push(H.torus(0.048, 0.008, 24, 6).at(ec[0], ec[1], ec[2] + 0.012).color(C.brassL).pbr(0.3, 0.9));
      h.push(H.sphere(0.044, 20).scale(1, 1, 0.45).at(ec[0], ec[1], ec[2] + 0.008).color(C.glass).pbr(0.05, 0.1).glow(1.5).shade((x, y, z) => (Math.hypot(x, y) < 0.012 ? mix(C.glass, 0xffffff, 0.7) : Math.hypot(x, y) > 0.036 ? tone(C.glass, 0, 0, -0.15) : null)));
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; h.push(H.sphere(0.004, 5).at(ec[0] + Math.sin(a) * 0.06, ec[1] + Math.cos(a) * 0.06, ec[2] - 0.004).color(C.brassD).pbr(0.3, 0.9).lod(0)); }
      // ear tufts: brass vanes
      for (let i = 0; i < 3; i++) h.push(feather([0.09 * sx, 0.94, 0.12 - i * 0.025], [sx * (0.35 + i * 0.1), 1, -0.15 - i * 0.1], 0.11 - i * 0.02, 0.022, [rgb(C.brassL), rgb(C.brassD)], [0, 0, 1], 1).pbr(0.3, 0.92));
    }
    // beak: a steel hook between the dishes
    h.push(spike([0, 0.8, 0.29], [0, -0.5, 1], 0.06, 0.022, C.steel, [0, -1, 0], 0.55, 0.8).pbr(0.35, 0.9));
    p.push(br(S.ellipsoid(0.03, 0.04, 0.02).at(0, 0.82, 0.29).blend(0.01), C.brassD));
    // a crown of rivets and a little whistle valve on top
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; h.push(H.sphere(0.006, 5).at(HC[0] + Math.sin(a) * 0.12, HC[1] + 0.1, HC[2] - 0.02 + Math.cos(a) * 0.09).color(C.brassD).pbr(0.3, 0.9).lod(0)); }
    h.push(H.cyl(0.012, 0.012, 0.05, 8).at(0, 0.98, 0.1).color(C.copper).pbr(0.3, 0.9).lod(1), H.sphere(0.016, 8).at(0, 1.01, 0.1).color(C.brassL).pbr(0.3, 0.9).lod(1));
  }
  const jaw = N('jaw', 'head', [0, 0.79, 0.26], { rig: 'jaw', detail: 1.2 });
  jaw.hard.push(spike([0, 0.775, 0.275], [0, -0.8, 0.6], 0.032, 0.016, C.steelD, [0, -1, 0], 0.4, 0.8).pbr(0.4, 0.85));
  // piston legs with steel talons
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const J = X([0.08, 0.34, 0.02]), K = X([0.1, 0.19, 0.08]), A = X([0.09, 0.05, 0.04]);
    const lg = N(`leg${nm}`, 'torso', J, { rig: 'legs', detail: 1.0, minRes: 60 });
    lg.prims.push(br(S.ellipsoid(0.06, 0.08, 0.07).at(...lerp3(J, K, 0.25)), C.brassD));
    lg.hard.push(orient(H.cyl(0.022, 0.022, len3(sub3(K, J)) * 0.8, 10), lerp3(J, K, 0.55), sub3(K, J)).color(C.steel).pbr(0.35, 0.9));
    lg.hard.push(H.sphere(0.03, 12).at(...K).color(C.brassD).pbr(0.3, 0.9));
    const sh = N(`shin${nm}`, `leg${nm}`, K, { rig: 'shins', detail: 1.0, minRes: 60 });
    sh.hard.push(orient(H.cyl(0.017, 0.017, len3(sub3(A, K)), 10), lerp3(K, A, 0.5), sub3(A, K)).color(C.steel).pbr(0.35, 0.9));
    sh.hard.push(orient(H.cyl(0.026, 0.026, len3(sub3(A, K)) * 0.45, 10), lerp3(K, A, 0.3), sub3(A, K)).color(C.copper).pbr(0.3, 0.9));
    sh.hard.push(H.sphere(0.024, 10).at(...A).color(C.brassD).pbr(0.3, 0.9));
    for (const [a, l] of [[-0.5, 0.09], [0, 0.1], [0.5, 0.09], [Math.PI, 0.06]]) {
      const d = [Math.sin(a), 0, Math.cos(a)], tb = add3(A, [d[0] * l, -0.035, d[2] * l]);
      sh.hard.push(H.tube([A, add3(A, [d[0] * l * 0.5, -0.02, d[2] * l * 0.5]), tb], 0.011, 6, 6).color(C.steelD).pbr(0.4, 0.85));
      sh.hard.push(spike(tb, [d[0], -0.6, d[2]], 0.045, 0.011, C.iron, [0, -1, 0], 0.5).pbr(0.4, 0.8));
    }
  }
  // tail fan of brass plates
  const TP = [0, 0.38, -0.24];
  const tail = N('tail', 'torso', TP, { rig: 'tail' });
  tail.prims.push(br(S.ellipsoid(0.07, 0.04, 0.07).at(0, 0.38, -0.26), C.brassD));
  for (let i = 0; i < 7; i++) { const f = (i / 6) * 2 - 1, a = f * 0.5; tail.hard.push(feather(add3(TP, [f * 0.03, 0, -0.02]), [Math.sin(a), -0.15, -Math.cos(a)], 0.24 - Math.abs(f) * 0.04, 0.04, [rgb(brass), rgb(C.brassD)], [0, 1, 0], 0).pbr(0.32, 0.9)); }
  // clockwork wings: brass plate feathers on steel spars, a cog at each shoulder
  const G = { Sh: [0.15, 0.56, 0.12], E: [0.4, 0.6, 0.04], W: [0.62, 0.58, 0.14], T: [1.0, 0.55, 0.0] };
  const wc = { bone: C.steel, a: brass, b: C.brassD, tip: C.copper, covert: C.brassL, shape: 0 };
  addWings(N, 'torso', G, () => {
    const w = featherWing(G, wc, { len: 0.36, n: [8, 8], r: 0.035, skin: (q) => q.color(C.steel).pbr(0.38, 0.85), finish: (h) => h.pbr(0.32, 0.88) });
    const cog = (p, R0) => {
      const out = [H.torus(R0, R0 * 0.18, 20, 5).rot(0, 0, 0).at(...p).color(C.brassD).pbr(0.3, 0.9), H.cyl(R0 * 0.35, R0 * 0.35, R0 * 0.4, 10).rot(90, 0, 0).at(...p).color(C.steel).pbr(0.35, 0.9)];
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; out.push(H.box(R0 * 0.25, R0 * 0.3, R0 * 0.3, 0.001).rot(0, 0, -a / DEG).at(p[0] + Math.sin(a) * R0 * 1.15, p[1] + Math.cos(a) * R0 * 1.15, p[2]).color(C.brassD).pbr(0.3, 0.9).lod(1)); }
      return out.map((q) => q.rot(0, 0, 0));
    };
    w.arm.hard.push(...cog([0.2, 0.6, 0.16], 0.04).map((q) => q.rot(0, 0, 0)));
    w.tip.hard.push(...cog([0.62, 0.6, 0.16], 0.028));
    w.arm.hard.push(H.tube([[0.18, 0.58, 0.1], [0.4, 0.62, 0.06], [0.6, 0.6, 0.14]], 0.007, 16, 5).color(C.copper).pbr(0.3, 0.9).lod(1));
    return w;
  }, 0.9);
  return { kind: 'fringe.owl', attack: 'claw', rate: 9.5, perch: 0.12, nodes: thin(finish(N.nodes), 0.75) };
}

/** on the ground: wings swept back along the flanks, the hand folded under; they mantle open as it strikes */
const _ewf = new THREE.Euler(0, 0, 0, 'YXZ');
function foldWings(rig, c, base) {
  if (c.flying || c.dead > 0) return;
  const W = rig.wings || [], WT = rig.wingtips || [], t = c.t, ph = c.phase || 0;
  const roll = num(rig.foldRoll, -1.25), fy = num(rig.foldY, 1.42), fz = num(rig.foldZ, 0.05), ty = num(rig.tipY, 2.5);
  const open = c.atk >= 0 ? Math.sin(Math.PI * c.atk) : 0, br = Math.sin(t * 1.4 + ph) * 0.03;
  W.forEach((w, i) => {
    const sg = i ? -1 : 1;
    w.quaternion.setFromEuler(_ewf.set(lerp(roll, -0.3, open), sg * lerp(fy, 0.6, open), sg * (lerp(fz, 0.4, open) + br)));
    if (WT[i]) WT[i].quaternion.setFromEuler(_ewf.set(0, sg * lerp(ty, 0.4, open), 0));
  });
}
/** the great-bird animator, with the short clockwork wings folded tight to the flanks on the ground */
function owlAnim(rig, inner, c, base) {
  TITAN_ANIM['titan.bird'](rig, inner, c, base);
  const { R } = base, W = rig.wings || [], WT = rig.wingtips || [], t = c.t, ph = c.phase || 0;
  foldWings(rig, c, base, rig.fold);
  (rig.gears || []).forEach((g, i) => { g.rotation.z = t * (c.flying ? 9 : 2) * (i % 2 ? -1 : 1); });
}

// =====================================================================================
const guard = (fn) => (def, o) => fn(def || {}, o && typeof o === 'object' ? o : {});
const ALL = { naga, warCamel, hippoRider, swanRider, mechOwl };
export const bodies = Object.fromEntries(Object.entries(ALL).map(([k, f]) => [k, guard(f)]));
export const animators = { 'fringe.naga': nagaAnim, 'fringe.hippo': hippoAnim, 'fringe.swan': swanAnim, 'fringe.owl': owlAnim };
