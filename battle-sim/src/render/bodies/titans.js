// Titans: the great beasts of the realms.
//
//   bodies.bird(def, o)           eagle / raven / phoenix / vultureLord         kinds 'titan.bird', 'titan.vulture'
//   bodies.saurian(def, o)        tyrant / hornback / shieldback / pterosaur    'titan.tyrant', 'titan.quad', 'titan.bird'
//   bodies.hydra(def, o)          many heads; wings; flesh                      'titan.hydra'
//   bodies.treeman(def, o)        tree-warden / dryad / bog                     'titan.tree'
//   bodies.manticore(def, o)                                                    'titan.manticore'
//   bodies.scorpion(def, o)                                                     'titan.scorpion'
//   bodies.sphinx(def, o)                                                       'titan.sphinx'
//   bodies.crab(def, o)           giant crab / leviathan                        'titan.crab', 'titan.leviathan'
//   bodies.djinn(def, o)                                                        'titan.djinn'
//   bodies.serpent(def, o)                                                      'titan.serpent'
//   bodies.centaur(def, o)        drake-ogre                                    'titan.centaur'
//   bodies.wreckColossus(def, o)                                                'titan.wreck'
//   bodies.chariot(def, o)                                                      'titan.chariot'
//
// Authoring convention (the same one monsters.js uses): a model is laid out in ONE space, its rest pose (Y up,
// facing +Z, feet on y = 0). Every node records the point it pivots about (`o`); finish() moves each node's pieces
// into the node's own space. Nodes given `pos` / `rot` are authored in their own frame instead.
// Rig lists beyond the stock ones are named where each animator reads them.
import * as THREE from 'three';
import { S, H, rgb, noise3 } from '../sculpt.js';
import { weapon as makeWeapon } from './weapons.js';

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
function hueOf(hex) { _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace); return _hsl.h; }
function lumOf(hex) { _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace); return _hsl.l; }
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const col = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

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
/** a collector: N(name, parent, pivot, extra) adds and returns a node */
function rigOf() {
  const nodes = [];
  const N = (name, parent, o, extra) => { const n = node(name, parent, o, extra); nodes.push(n); return n; };
  N.nodes = nodes;
  return N;
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
/** claw from base pointing along dir, hooking toward `toward` */
const spike = (base, dir, len, r, color, toward = [0, 0, 1], hook = 0.3, flatX = 1) => orient(claw(len, r, color, hook, flatX), base, dir, toward);

/** a horn: tapering tube with growth rings, plus a plain core that survives at distance */
function horn(pts, r0, cols, opt = {}) {
  const n = opt.rings ?? 18, radii = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, taper = Math.pow(1 - t, opt.pow ?? 0.8) * 0.96 + 0.04;
    radii.push(r0 * taper * (1 + (opt.ripple ?? 0.12) * (i % 2 ? -1 : 0.6) * (1 - t * 0.75)));
  }
  const a = rgb(cols[0]), b = rgb(cols[1] ?? cols[0]), c = rgb(cols[2] ?? cols[1] ?? cols[0]);
  const base = pts[0], end = pts[pts.length - 1], L = len3(sub3(end, base)) || 1;
  const shade = (x, y, z) => { const t = clamp(len3(sub3([x, y, z], base)) / L); return t < 0.5 ? mixRgb(a, b, t * 2) : mixRgb(b, c, (t - 0.5) * 2); };
  const fine = H.tube(pts, radii, n * 2, 7).shade(shade).color(cols[1] ?? cols[0]).pbr(opt.rough ?? 0.42, 0).lod(1);
  const core = H.tube(pts, [r0 * 0.85, r0 * 0.6, r0 * 0.3, r0 * 0.06], 5, 5).shade(shade).color(cols[1] ?? cols[0]).pbr(opt.rough ?? 0.42, 0).from(2);
  return [fine, core];
}

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
/** an eye set in the head at p, looking along dir */
const eyeAt = (p, dir, r, look) => orient(eyeball(r, look).rot(-90, 0, 0), p, dir);   // sphere's +Z pole -> local +Y -> dir
const glowEye = (p, r, color, g = 1.6) => H.sphere(r, 10).at(p[0], p[1], p[2]).color(color).glow(g).pbr(0.3);

/** a skin stretched between two edge curves A(u), B(u); scalloped far edge, billowing middle */
function membrane(A, B, opt = {}) {
  const nu = opt.nu ?? 8, nv = opt.nv ?? 6, sc = opt.scallop ?? 0.2, bil = opt.billow ?? 0.03, up = opt.up ?? [0, 1, 0];
  const pos = [], idx = [], cols = [];
  const surf = (u0, v) => {
    const arch = Math.pow(4 * v * (1 - v), opt.archPow ?? 0.8);
    const u = u0 * (1 - sc * arch - (opt.edge ? opt.edge(v) : 0));
    const a = A(u), b = B(u);
    const lift = bil * arch * Math.sin(Math.PI * (0.12 + 0.8 * u0));
    return [lerp(a[0], b[0], v) + up[0] * lift, lerp(a[1], b[1], v) + up[1] * lift, lerp(a[2], b[2], v) + up[2] * lift];
  };
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const v = j / nv, u0 = i / nu, p = surf(u0, v);
    pos.push(p[0], p[1], p[2]);
    if (opt.col) cols.push(opt.col(u0, v, p));
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (opt.hole && opt.hole((i + 0.5) / nu, (j + 0.5) / nv)) continue;
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const h = H.geo(g).pbr(opt.rough ?? 0.62, 0);
  if (opt.col) h.shade((x, y, z, nx, ny, nz, i) => cols[i] ?? null);
  h.surf = surf;
  return h;
}
const lineFn = (a, b, bow) => (u) => { const p = lerp3(a, b, u); if (bow) { const k = 4 * u * (1 - u); p[0] += bow[0] * k; p[1] += bow[1] * k; p[2] += bow[2] * k; } return p; };
const pathFn = (pts) => { const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))); return (u) => { const v = c.getPoint(clamp(u)); return [v.x, v.y, v.z]; }; };

/** leathery wing (left, +X): arm Sh -> E -> W, fingers from W to tips, skin back to `hip`. Returns { arm, tip } parts. */
function batWing(G, C, opt = {}) {
  const { Sh, E, W, tips, hip } = G, k = opt.k ?? 1;
  const cA = rgb(C.wingA), cB = rgb(C.wingB);
  const arm = { prims: [], hard: [] }, tip = { prims: [], hard: [] };
  const bk = (q) => q.color(C.bone).pbr(0.5).tint(0.12, 14);
  arm.prims.push(bk(S.capsule(Sh, E, 0.055 * k, 0.038 * k)));
  arm.prims.push(bk(S.ellipsoid(0.055 * k, 0.05 * k, 0.08 * k).at(...lerp3(Sh, E, 0.3)).blend(0.03)));
  arm.prims.push(bk(S.sphere(0.042 * k).at(...E).blend(0.02)));
  arm.prims.push(bk(S.capsule(E, W, 0.038 * k, 0.027 * k).blend(0.02)));
  arm.prims.push(bk(S.sphere(0.033 * k).at(...W).blend(0.015)));
  tip.prims.push(bk(S.sphere(0.033 * k).at(...W)));
  const bows = tips.map((t, i) => mul3([0.02, 0.03, i === 0 ? 0.04 : 0.01], k));
  const finger = tips.map((t, i) => lineFn(W, t, bows[i]));
  finger.forEach((f) => {
    const pts = [0, 0.25, 0.55, 1].map((u) => f(u));
    tip.hard.push(H.tube(pts, [0.02, 0.015, 0.011, 0.003].map((r) => r * k), 9, 5).color(C.bone).pbr(0.5));
    tip.hard.push(spike(f(1), norm3(sub3(f(1), f(0.9))), 0.045 * k, 0.007, C.claw, [0, -1, 0], 0.3).lod(1));
  });
  const colFn = (panel) => (u, v) => {
    const between = 1 - Math.pow(Math.abs(v - 0.5) * 2, 1.7);
    let c3 = mixRgb(cA, cB, clamp(0.1 + 0.9 * between * (0.3 + 0.7 * smooth(u * 1.25))));
    const n = noise3(u * 4.2 + panel * 5.3, v * 3.3 + panel, 0.7);
    c3 = mixRgb(c3, cA, clamp((n - 0.52) * 2.4) * 0.5);
    if (u > 0.84) c3 = mixRgb(c3, cA, ((u - 0.84) / 0.16) * 0.8);
    return c3;
  };
  for (let i = 0; i < finger.length - 1; i++) {
    const torn = opt.torn && i === 1;
    tip.hard.push(membrane(finger[i], finger[i + 1], { nu: 8, nv: 6, scallop: 0.2 + (torn ? 0.1 : 0), billow: 0.04 * k, col: colFn(i),
      edge: torn ? (v) => 0.3 * Math.exp(-Math.pow((v - 0.55) / 0.13, 2)) : null }));
  }
  const body = lineFn(add3(Sh, [-0.01, -0.03, 0.02]), hip);
  arm.hard.push(membrane(finger[finger.length - 1], body, { nu: 8, nv: 7, scallop: 0.16, billow: 0.035 * k, col: (u, v) => colFn(3)(0.2 + u * 0.8, v * 0.62 + 0.3) }));
  arm.hard.push(membrane(lineFn(Sh, E), lineFn(Sh, W, [0, 0, 0.05]), { nu: 4, nv: 2, scallop: 0, billow: 0.006, col: () => mixRgb(cA, rgb(C.bone), 0.4) }));
  arm.hard.push(spike(add3(W, [0, 0.012, 0.018]), [0.25, 0.5, 1], 0.09 * k, 0.016 * k, C.claw, [0, -1, 0], 0.5).lod(1));
  return { arm, tip };
}

// ---------- feathers ----------
/** a flat feather along +Y, unit length, half-width hw; face normal +Z, slightly cambered. shape: 0 round, 1 pointed, 2 ragged */
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
/** one feather from base along dir with its face toward `up`; cols = [root, tip] (rgb arrays) or a shade fn of t */
function feather(base, dir, len, hw, cols, up = [0, 1, 0], shape = 0) {
  const ratio = Math.max(0.04, Math.round((hw / len) * 25) / 25);
  const h = H.geo(featherGeo(ratio, shape)).scale(len);
  if (typeof cols === 'function') h.shade((x, y) => cols(y, x / ratio));
  else h.shade((x, y) => (Math.abs(x) < ratio * 0.12 ? mixRgb(cols[0], cols[1], y * 0.6) : mixRgb(cols[0], cols[1], smooth(y * 1.15 - 0.1))));
  return orient(h, base, dir, up).pbr(0.6, 0);
}
/** triangle strip between two rows of points (a cheap stand-in for a row of feathers) */
function stripGeo(A, B) {
  const pos = [], idx = [];
  for (let i = 0; i < A.length; i++) pos.push(...A[i], ...B[i]);
  for (let i = 0; i < A.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/**
 * Feathered wing (left, +X), spread. G = { Sh, E, W, T } joints; opt: len (flight feather length), n = [inner, outer],
 * C = { bone, a, b, tip, covert, glow?, glowCol?, shape }. Returns { arm, tip } parts; W is the wingtip node's pivot.
 */
function featherWing(G, C, opt = {}) {
  const { Sh, E, W, T } = G, L = opt.len ?? 0.36, shape = C.shape ?? 0;
  const arm = { prims: [], hard: [] }, tip = { prims: [], hard: [] };
  const cA = rgb(C.a), cB = rgb(C.b), cT = rgb(C.tip ?? C.b), cC = rgb(C.covert ?? C.a), cC2 = mixRgb(cC, cA, 0.5);
  const sk = (q) => q.color(C.covert ?? C.a).bump(0.006, 34, 'fur').tint(0.14, 18).pbr(0.7);
  const ra = opt.r ?? 0.045;
  arm.prims.push(sk(S.capsule(Sh, E, ra * 1.25, ra)));
  arm.prims.push(sk(S.ellipsoid(ra * 1.5, ra * 1.1, ra * 2.2).at(...lerp3(Sh, E, 0.35)).blend(0.03)));
  arm.prims.push(sk(S.capsule(E, W, ra, ra * 0.75).blend(0.02)));
  tip.prims.push(sk(S.capsule(W, lerp3(W, T, 0.55), ra * 0.75, ra * 0.4)));
  const back = [0, 0, -1];
  const fcol = (c0, c1, band) => (t, x) => {
    if (Math.abs(x) < 0.12) return mixRgb(c0, c1, t * 0.5 + 0.1);
    let c3 = mixRgb(c0, c1, smooth(t * 1.2 - 0.15));
    if (band && Math.sin(t * 17) > 0.55 && t > 0.25) c3 = mixRgb(c3, cT, 0.45);
    if (t > 0.86) c3 = mixRgb(c3, cT, (t - 0.86) / 0.14);
    return c3;
  };
  const rowOn = (part, P0, P1, n, len0, len1, dir0, dir1, c0, c1, yOff, hwK, band, glow, flag) => {
    const bases = [], ends = [];
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1), base = add3(lerp3(P0, P1, f), [0, yOff - f * 0.004, 0]);
      const dir = norm3(lerp3(dir0, dir1, f)), len = lerp(len0, len1, f) * (0.94 + 0.12 * ((i * 7) % 3) / 2);
      const hw = Math.max(len3(sub3(P1, P0)) / Math.max(1, n - 1) * hwK, len * 0.09);
      const h = feather(base, dir, len, hw, fcol(c0, c1, band), [0.25 * (i % 2 ? 1 : -1), 1, 0], shape).near();
      if (glow) h.glow(glow);
      if (flag != null) h.lod(flag);
      part.hard.push(h);
      bases.push(base); ends.push(add3(base, mul3(dir, len * 0.93)));
    }
    return { bases, ends };
  };
  const nIn = opt.n?.[0] ?? 9, nOut = opt.n?.[1] ?? 9;
  const outDir = norm3(add3(norm3(sub3(T, W)), [0.25, 0, -0.25]));
  // flight feathers
  const sec = rowOn(arm, add3(Sh, [0.03, 0, -0.03]), W, nIn, L * 0.82, L, [-0.12, -0.05, -1], [0.1, -0.03, -1], cA, cB, -0.012, 0.85, C.band, C.glow);
  const pri = rowOn(tip, W, T, nOut, L * 1.02, L * 1.3, [0.14, -0.03, -1], outDir, cA, cB, -0.014, 0.9, C.band, C.glow);
  // coverts: two shorter rows on top
  rowOn(arm, add3(Sh, [0.04, 0, -0.01]), W, nIn + 1, L * 0.5, L * 0.52, [-0.1, 0, -1], [0.1, 0, -1], cC2, cA, 0.004, 0.8, false, 0);
  rowOn(arm, add3(Sh, [0.05, 0, 0.0]), W, nIn - 2, L * 0.3, L * 0.3, [-0.1, 0.02, -1], [0.08, 0.02, -1], cC, cC2, 0.016, 1.0, false, 0, 1);
  rowOn(tip, W, lerp3(W, T, 0.92), nOut - 1, L * 0.5, L * 0.55, [0.14, 0, -1], lerp3(back, outDir, 0.85), cC2, cA, 0.004, 0.85, false, 0);
  rowOn(tip, W, lerp3(W, T, 0.7), Math.max(3, nOut - 4), L * 0.3, L * 0.3, [0.12, 0.02, -1], lerp3(back, outDir, 0.6), cC, cC2, 0.016, 1.0, false, 0, 1);
  // far stand-ins
  const mk = (g) => H.geo(g).shade((x, y, z, nx, ny, nz, i) => (i % 2 ? cB : cA)).color(C.a).pbr(0.65).far();
  const fa = mk(stripGeo(sec.bases, sec.ends)), ft = mk(stripGeo(pri.bases, pri.ends));
  if (C.glow) { fa.glow(C.glow); ft.glow(C.glow); }
  arm.hard.push(fa); tip.hard.push(ft);
  return { arm, tip, pri, sec };
}

/** copy a part for one side: sx = 1 clones, -1 mirrors */
const sidePart = (list, sx) => flat(list).map((q) => (sx > 0 ? q.clone() : q.mirrorX()));

/** hang a two-part wing pair on `parent`: build(sx) -> { arm, tip } authored for the left */
function addWings(N, parent, G, build, detail = 0.8) {
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx), src = build(sx);
    const w = N(`wing${nm}`, parent, X(G.Sh), { rig: 'wings', detail });
    const t = N(`wingtip${nm}`, `wing${nm}`, X(G.W), { rig: 'wingtips', detail });
    w.prims = sidePart(src.arm.prims, sx); w.hard = sidePart(src.arm.hard, sx);
    t.prims = sidePart(src.tip.prims, sx); t.hard = sidePart(src.tip.hard, sx);
  }
}

/**
 * A two-bone leg. pts = [hip, knee, ankle, ground] on the +X side; sx mirrors. radii = [hip, knee, ankle].
 * foot: { kind: 'claw' | 'paw' | 'pillar' | 'talon' | 'root', len, w, toes, claw, clawLen, col }.
 */
function addLeg(N, nm, parent, sx, pts, radii, sk, opt = {}) {
  const X = sideX(sx), [J, K, A, F] = pts.map(X);
  const up = N(`leg${nm}`, parent, J, { rig: opt.rigU ?? 'legs', detail: opt.detail ?? 0.8, minRes: opt.minRes });
  const lo = N(`shin${nm}`, `leg${nm}`, K, { rig: opt.rigL ?? 'shins', detail: opt.detail ?? 0.8, minRes: opt.minRes });
  const m = opt.muscle ?? 1.25;
  up.prims.push(sk(S.capsule(J, K, radii[0], radii[1])));
  up.prims.push(sk(S.ellipsoid(radii[0] * m, radii[0] * m * 1.25, radii[0] * m * 1.2).at(...lerp3(J, K, 0.3)).blend(0.04)));
  up.prims.push(sk(S.sphere(radii[1] * 1.05).at(...K).blend(0.02)));
  lo.prims.push(sk(S.sphere(radii[1] * 1.02).at(...K)));
  lo.prims.push(sk(S.capsule(K, A, radii[1], radii[2]).blend(0.02)));
  lo.prims.push(sk(S.ellipsoid(radii[1] * 0.95, radii[1] * 1.3, radii[1] * 1.05).at(...add3(lerp3(K, A, 0.28), [0, 0, -radii[1] * 0.25])).blend(0.03)));
  const ft = opt.foot ?? {}, fl = ft.len ?? radii[2] * 2.6, fw = ft.w ?? radii[2] * 1.5, fc = ft.col ?? null;
  const skf = (q) => (fc != null ? sk(q).color(fc) : sk(q));
  if (ft.kind === 'pillar') {
    lo.prims.push(skf(S.capsule(A, F, radii[2], fw).blend(0.02)));
    lo.prims.push(skf(S.cyl(fw * 1.02, fw * 0.9, fw * 0.3).at(F[0], fw * 0.45, F[2]).blend(0.03)));
    const nt = ft.toes ?? 3;
    for (let i = 0; i < nt; i++) { const a = (i - (nt - 1) / 2) * 0.62; lo.prims.push(S.ellipsoid(fw * 0.3, fw * 0.34, fw * 0.3).at(F[0] + Math.sin(a) * fw * 0.86, fw * 0.3, F[2] + Math.cos(a) * fw * 0.86).color(ft.claw ?? 0x2a2620).pbr(0.4).blend(0.006)); }
  } else if (ft.kind === 'root') {
    lo.prims.push(skf(S.capsule(A, F, radii[2], fw).blend(0.03)));
  } else {
    lo.prims.push(skf(S.capsule(A, add3(F, [0, fw * 0.55, 0]), radii[2], fw * 0.75).blend(0.02)));
    lo.prims.push(skf(S.ellipsoid(fw, fw * 0.55, fl * 0.5).at(F[0], fw * 0.5, F[2] + fl * 0.3).blend(0.025)));
    const nt = ft.toes ?? 3, cl = ft.clawLen ?? fl * 0.5;
    for (let i = 0; i < nt; i++) {
      const a = (i - (nt - 1) / 2) * (ft.spread ?? 0.42), d = [Math.sin(a), 0, Math.cos(a)];
      const tb = [F[0] + d[0] * fl * 0.5, fw * 0.36, F[2] + fl * 0.3 + d[2] * fl * 0.5];
      lo.prims.push(skf(S.capsule([F[0] + d[0] * fl * 0.1, fw * 0.4, F[2] + fl * 0.25], tb, fw * 0.36, fw * 0.3).blend(0.012)));
      if (ft.kind !== 'paw' || cl > 0) lo.hard.push(spike(add3(tb, [0, fw * 0.05, fw * 0.1]), [d[0], -0.25, d[2]], cl, cl * 0.24, ft.claw ?? 0x1c1814, [0, -1, 0], 0.35).lod(opt.clawLod ?? 2));
    }
    if (ft.kind === 'talon') lo.hard.push(spike([F[0], fw * 0.45, F[2] - fl * 0.05], [0, -0.3, -1], cl, cl * 0.24, ft.claw ?? 0x1c1814, [0, -1, 0], 0.35).lod(2));
  }
  return { up, lo, J, K, A, F };
}

/**
 * A chain of segment nodes through pts (necks, tails, coils). radii per point. rig(i) names the rig key.
 * deco(n, a, b, ra, rb, i, frame) adds extras. Returns the nodes.
 */
function addChain(N, name, parent, pts, radii, sk, opt = {}) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const n = N(`${name}${i}`, i === 0 ? parent : `${name}${i - 1}`, pts[i], { rig: typeof opt.rig === 'function' ? opt.rig(i) : opt.rig, detail: opt.detail ?? 0.8, minRes: opt.minRes });
    const a = pts[i], b = pts[i + 1], ra = radii[i], rb = radii[i + 1];
    n.prims.push(sk(S.sphere(ra * 1.0).at(...a)));
    n.prims.push(sk(bone(a, b, ra, rb, opt.zHint).blend(0.01)));
    if (i === pts.length - 2 && opt.cap !== false) n.prims.push(sk(S.sphere(rb).at(...b).blend(0.01)));
    if (opt.deco) {
      const t = norm3(sub3(b, a));
      let side = cross3(t, opt.up ?? [0, 1, 0]); if (len3(side) < 1e-4) side = [1, 0, 0]; side = norm3(side);
      const dor = norm3(cross3(side, t));
      opt.deco(n, a, b, ra, rb, i, { t, side, dor });
    }
    out.push(n);
  }
  return out;
}

// ---------- small things that many of these beasts carry ----------
function barnacleGeo() {
  return cached('barnacle', () => { const g = new THREE.LatheGeometry([[1, 0], [0.8, 0.5], [0.48, 0.9], [0.3, 0.86], [0.24, 0.55]].map(([x, y]) => new THREE.Vector2(x, y)), 6); g.computeVertexNormals(); return g; });
}
/** a cluster of barnacles on a surface at p with outward normal nrm */
function barnacles(p, nrm, r, rnd, n = 5, lod = 1) {
  const out = [], t = norm3(cross3(nrm, Math.abs(nrm[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), b = cross3(nrm, t);
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.283, d = i === 0 ? 0 : r * (0.7 + rnd() * 0.9), s = r * (i === 0 ? 1 : 0.45 + rnd() * 0.5);
    const c = add3(p, add3(mul3(t, Math.cos(a) * d), mul3(b, Math.sin(a) * d)));
    const h = orient(H.geo(barnacleGeo()).scale(s, s * (0.8 + rnd() * 0.5), s), add3(c, mul3(nrm, -s * 0.25)), add3(nrm, mul3(t, (rnd() - 0.5) * 0.5)))
      .shade((x, y) => (y > 0.8 ? 0x4a4438 : null)).color(i % 2 ? 0xcfc7b0 : 0xb8ae96).pbr(0.85);
    out.push(i === 0 ? h.lod(lod + 1) : h.lod(lod));
  }
  return out;
}
/** a hanging strand of weed / rope / moss: tube from p drooping by `drop` */
function strand(p, drop, r, color, rnd, sway = 0.04, lod = 1) {
  const q = [p, add3(p, [(rnd() - 0.5) * sway, -drop * 0.4, (rnd() - 0.5) * sway]), add3(p, [(rnd() - 0.5) * sway * 2, -drop, (rnd() - 0.5) * sway * 2])];
  return H.tube(q, [r, r * 0.8, r * 0.25], 5, 4).color(color).pbr(0.8).lod(lod);
}
/** flat ragged strip hanging from p (weed, torn cloth), facing `face` */
function ribbon(p, drop, w, color, face = [0, 0, 1], rnd = Math.random, lod = 2) {
  const h = feather([0, 0, 0], [0.05 * (rnd() - 0.5), -1, 0.05 * (rnd() - 0.5)], drop, w, [rgb(color), rgb(tone(color, 0, 0, -0.08))], face, 2);
  return h.at(p[0], p[1], p[2]).lod(lod);
}
/** timber between two points, rectangular section, with end grain darker */
function beam(a, b, w, d, color, zHint = [0, 0, 1]) {
  const L = len3(sub3(b, a)), dk = rgb(tone(color, 0, 0, -0.09));
  const g = new THREE.BoxGeometry(w, L, d, 1, Math.max(1, Math.min(4, Math.round(L / 0.25))), 1);
  return orient(H.geo(g).at(0, L / 2, 0).shade((x, y, z, nx, ny, nz, i) => ((i * 7 + Math.round(y * 9)) % 3 === 0 ? dk : null)), a, sub3(b, a), zHint).color(color).pbr(0.85);
}
/** chain of links from a to b */
function chain(a, b, r = 0.02, color = 0x3a3c40, lod = 3) {
  const L = len3(sub3(b, a)), n = Math.max(2, Math.round(L / (r * 2.4))), out = [];
  for (let i = 0; i < n; i++) {
    const c = lerp3(a, b, (i + 0.5) / n);
    out.push(orient(H.torus(r, r * 0.32, 8, 5).scale(0.75, 1.25, 1).rot(0, i % 2 ? 90 : 0, 0), c, sub3(b, a)).color(color).pbr(0.5, 0.8).lod(lod));
  }
  return out;
}

/**
 * A small crew figure, about `h` tall, standing with its feet at `at`. style: 'lizard' | 'bone' | 'man'.
 * Adds nodes `${p}body`, `${p}head`, `${p}armL`, `${p}armR` (rig lists `crew`, `crewHeads`, `crewArms`).
 * pose: 'stand' | 'sit' (legs forward astride). Returns the right-hand point in model space.
 */
function addCrew(N, p, parent, at, h, style, C = {}, opt = {}) {
  const s = h, sit = opt.pose === 'sit', yaw = opt.yaw ?? 0;
  const skin = C.skin ?? (style === 'bone' ? 0xe8e0c8 : style === 'lizard' ? 0x4f8a4a : 0xd9a77c), cloth = C.cloth ?? 0x7a3a2a, metal = C.metal ?? 0xb8923a;
  const boneish = style === 'bone';
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
  const Q = (x, y, z) => [at[0] + (x * cy + z * sy) * s, at[1] + y * s, at[2] + (-x * sy + z * cy) * s];
  const sk = (q) => q.color(skin).pbr(boneish ? 0.55 : 0.6).tint(0.1, 30);
  const hipY = sit ? 0.12 : 0.47, det = opt.detail ?? 1, mr = Math.min(64, 1.3 / (0.03 * s));
  const body = N(`${p}body`, parent, Q(0, hipY, 0), { rig: 'crew', detail: det, minRes: mr });
  const r = boneish ? 0.55 : 1;
  for (const sx of [1, -1]) {
    if (sit) {
      body.prims.push(sk(S.capsule(Q(0.07 * sx, hipY, 0), Q(0.16 * sx, hipY - 0.05, 0.2), 0.055 * r, 0.045 * r)));
      body.prims.push(sk(S.capsule(Q(0.16 * sx, hipY - 0.05, 0.2), Q(0.18 * sx, hipY - 0.3, 0.12), 0.042 * r, 0.03 * r).blend(0.01)));
    } else {
      body.prims.push(sk(S.capsule(Q(0.07 * sx, hipY, 0), Q(0.085 * sx, 0.24, 0.02), 0.055 * r, 0.042 * r)));
      body.prims.push(sk(S.capsule(Q(0.085 * sx, 0.24, 0.02), Q(0.085 * sx, 0.03, 0), 0.04 * r, 0.03 * r).blend(0.01)));
      body.prims.push(sk(S.ellipsoid(0.04 * s, 0.025 * s, 0.07 * s).at(...Q(0.085 * sx, 0.025, 0.04)).blend(0.01)));
    }
  }
  if (boneish) {
    body.prims.push(sk(S.capsule(Q(0, hipY, 0), Q(0, hipY + 0.34, 0), 0.022 * s, 0.02 * s)));
    body.prims.push(sk(S.ellipsoid(0.085 * s, 0.045 * s, 0.05 * s).at(...Q(0, hipY, 0)).blend(0.01)));
    for (let i = 0; i < 4; i++) body.prims.push(sk(S.torus((0.085 - i * 0.008) * s, 0.012 * s).scale(1).at(...Q(0, hipY + 0.33 - i * 0.045, 0.01)).blend(0.004)));
    body.prims.push(sk(S.capsule(Q(-0.11, hipY + 0.36, 0), Q(0.11, hipY + 0.36, 0), 0.02 * s, 0.02 * s).blend(0.005)));
    body.prims.push(S.box(0.2 * s, 0.07 * s, 0.11 * s, 0.01).at(...Q(0, hipY + 0.02, 0)).color(cloth).blend(0.004));
    body.prims.push(S.torus(0.075 * s, 0.022 * s).at(...Q(0, hipY + 0.39, 0)).color(metal).pbr(0.35, 0.9).blend(0.003));
  } else {
    body.prims.push(S.ellipsoid(0.11 * s, 0.12 * s, 0.075 * s).at(...Q(0, hipY + 0.28, 0)).color(cloth).tint(0.1, 30));
    body.prims.push(S.ellipsoid(0.095 * s, 0.1 * s, 0.07 * s).at(...Q(0, hipY + 0.1, 0)).color(cloth).blend(0.03));
    body.prims.push(S.torus(0.09 * s, 0.02 * s).at(...Q(0, hipY + 0.06, 0)).color(metal).pbr(0.4, 0.8).paint(0.004, 0.004));
    body.prims.push(sk(S.capsule(Q(0, hipY + 0.36, 0), Q(0, hipY + 0.44, 0.01), 0.04 * s, 0.035 * s).blend(0.01)));
    if (style === 'lizard') body.prims.push(sk(S.capsule(Q(0, hipY + 0.02, -0.05), Q(0, hipY - 0.12, -0.3), 0.045 * s, 0.012 * s).blend(0.02)));
  }
  const HY = hipY + 0.5;
  const head = N(`${p}head`, `${p}body`, Q(0, HY - 0.06, 0), { rig: 'crewHeads', detail: det * 1.3, minRes: mr });
  if (boneish) {
    head.prims.push(sk(S.ellipsoid(0.07 * s, 0.075 * s, 0.085 * s).at(...Q(0, HY + 0.02, 0))));
    head.prims.push(sk(S.ellipsoid(0.05 * s, 0.045 * s, 0.05 * s).at(...Q(0, HY - 0.05, 0.035)).blend(0.015)));
    for (const sx of [1, -1]) head.prims.push(S.sphere(0.021 * s).at(...Q(0.028 * sx, HY + 0.01, 0.07)).color(0x0c0a08).cut(0.004));
    head.prims.push(S.box(0.06 * s, 0.006 * s, 0.03 * s, 0.001).at(...Q(0, HY - 0.06, 0.07)).color(0x1a1410).cut(0.002));
    if (C.crown !== false) head.prims.push(S.torus(0.066 * s, 0.014 * s).at(...Q(0, HY + 0.045, 0)).color(metal).pbr(0.35, 0.9).blend(0.003));
  } else if (style === 'lizard') {
    head.prims.push(sk(S.ellipsoid(0.065 * s, 0.065 * s, 0.075 * s).at(...Q(0, HY, 0))));
    head.prims.push(sk(S.capsule(Q(0, HY - 0.012, 0.04), Q(0, HY - 0.03, 0.15), 0.048 * s, 0.03 * s).blend(0.02)));
    head.prims.push(S.capsule(Q(0, HY + 0.06, 0.03), Q(0, HY + 0.05, -0.09), 0.012 * s, 0.03 * s).color(C.crest ?? 0xc8622a).blend(0.006));
    for (const sx of [1, -1]) head.hard.push(H.sphere(0.014 * s, 8).at(...Q(0.045 * sx, HY + 0.012, 0.06)).color(0xf0c030).pbr(0.2).lod(1));
  } else {
    head.prims.push(sk(S.ellipsoid(0.068 * s, 0.08 * s, 0.075 * s).at(...Q(0, HY, 0))));
    head.prims.push(S.ellipsoid(0.074 * s, 0.05 * s, 0.08 * s).at(...Q(0, HY + 0.045, -0.01)).color(metal).pbr(0.4, 0.8).blend(0.004));
  }
  let hand = null;
  [1, -1].forEach((sx, i) => {
    const Sp = Q(0.125 * sx, hipY + 0.36, 0), fwd = opt.arms?.[i] ?? 0.5;       // 0 = hanging, 1 = straight ahead
    const El = add3(Sp, mul3([0.02 * sx * cy + 0.12 * fwd * sy, -0.17 * (1 - fwd * 0.6), 0.12 * fwd * cy - 0.02 * sx * sy], s));
    const Hd = add3(El, mul3([(-0.02 * sx) * cy + 0.16 * fwd * sy, -0.16 * (1 - fwd), 0.16 * fwd * cy], s));
    const a = N(`${p}arm${sx > 0 ? 'L' : 'R'}`, `${p}body`, Sp, { rig: 'crewArms', detail: det, minRes: mr });
    a.prims.push(sk(S.capsule(Sp, El, 0.036 * s * r, 0.03 * s * r)));
    a.prims.push(sk(S.capsule(El, Hd, 0.03 * s * r, 0.024 * s * r).blend(0.008)));
    a.prims.push(sk(S.sphere(0.03 * s * (boneish ? 0.8 : 1)).at(...Hd).blend(0.006)));
    if (!boneish) a.prims.push(S.sphere(0.045 * s).at(...Sp).color(cloth).blend(0.01));
    if (sx < 0) hand = { p: Hd, node: a };
  });
  return { body, head, hand };
}

// ---------- animation helpers ----------
const sgn = (w, i) => ((w.userData.rest?.[3] ?? (i ? -1 : 1)) >= 0 ? 1 : -1);
const bellK = (k) => Math.sin(clamp(k) * Math.PI);
/** four-legged walk; returns the gait phase. amp = stride, bend = knee lift */
function walk4(rig, c, base, rate = 7.5, amp = 0.42, bend = 0.6, front = -0.5) {
  const { R } = base, L = rig.legs || [], Sh = rig.shins || [], k = c.moving && !c.flying ? 1 : 0, gait = c.t * rate + (c.phase || 0);
  for (let i = 0; i < L.length; i++) {
    const fr = i < 2, sg = i === 0 || i === 3 ? 1 : -1;
    const sw = Math.sin(gait) * sg, lift = Math.max(0, Math.cos(gait) * sg);
    R(L[i], -sw * amp * k);
    R(Sh[i], k * lift * (fr ? front : bend) + k * sw * 0.1);
  }
  return gait;
}
/** fold or beat a wing pair authored spread. fold = [wingYaw, wingRoll, tipYaw, tipRoll, wingPitch] */
function wingsPose(rig, c, base, s, opt = {}) {
  const { R } = base, W = rig.wings || [], WT = rig.wingtips || [], t = c.t, ph = c.phase || 0;
  const rate = (opt.rate ?? 8.4) / Math.sqrt(Math.max(0.3, s)), beat = t * rate + ph, amp = opt.amp ?? 0.58;
  const fold = opt.fold ?? [0.62, 0.62, 1.15, -0.5, 0.12], open = opt.open ?? 0, br = Math.sin(t * 1.4 + ph) * 0.03;
  W.forEach((w, i) => {
    const sg = sgn(w, i);
    if (c.flying && !(c.dead > 0)) {
      const f = Math.sin(beat);
      R(w, 0, sg * (0.06 + 0.1 * Math.cos(beat)), sg * (0.1 + f * amp));
      R(WT[i], 0, sg * (0.12 - 0.16 * Math.cos(beat - 0.5)), sg * (Math.sin(beat - 1.0) * amp * 0.85 - 0.05));
    } else {
      const k = 1 - open * 0.65;
      R(w, fold[4] * k, sg * fold[0] * k, sg * (fold[1] * k + br + 0.12 * open));
      R(WT[i], 0, sg * fold[2] * k, sg * (fold[3] * k - br));
    }
  });
  return beat;
}
function tailWave(rig, c, base, amp = 0.12, rate = 1.7, lift = 0) {
  (rig.tail || []).forEach((seg, i) => base.R(seg, lift + Math.sin(c.t * 1.3 + (c.phase || 0) - i * 0.6) * 0.03, Math.sin(c.t * (c.moving ? rate * 2.4 : rate) + (c.phase || 0) - i * 0.75) * amp, 0));
}
/** topple onto a flank and rest a little above the ground so the bulk does not sink through it */
function dieSide(inner, c, base, lift = 0.2) {
  const dead = base.die(inner, c, true);
  if (dead) inner.position.y += Math.min(1, c.dead * 2) * lift * (inner.scale.y || 1);
  return dead;
}

// =====================================================================================
//  GREAT BIRDS: eagle, raven, phoenix; the vulture-lord
// =====================================================================================
// rig: neck, head, jaw, legs[2], shins[2], wings[2], wingtips[2], tail[], plumes[] (phoenix tail streamers)

const isCold = (hex) => { const h = hueOf(hex); return h > 0.42 && h < 0.75; };

function birdHead(kind, C, K) {
  const p = [], hard = [], jp = [], jhard = [];
  const fe = (q) => q.color(C.head).bump(0.004, 40, 'fur').tint(0.1, 30).pbr(C.rough);
  const bk = (q) => q.color(C.beak).pbr(0.35).tint(0.08, 40);
  const r = 0.076;
  p.push(fe(S.ellipsoid(r * 0.95, r * 0.95, r * 1.12).at(0, 0, 0.015)));
  p.push(fe(S.capsule([0, -0.01, -0.02], [0, -0.04, -0.09], r * 0.92, r * 0.95).blend(0.03)));
  p.push(...S.mirrorX([fe(S.capsule([0.018, 0.045, 0.085], [0.066, 0.04, 0.0], 0.016, 0.022).blend(0.012))]));   // fierce brow
  const bl = K.beak, hook = K.hook;
  p.push(bk(S.capsule([0, 0.0, 0.065], [0, -0.012 - hook * 0.1, 0.065 + bl], 0.04 * K.beakR, 0.02 * K.beakR).blend(0.008)));
  p.push(bk(S.capsule([0, -0.012 - hook * 0.1, 0.065 + bl], [0, -0.03 - hook, 0.075 + bl], 0.019 * K.beakR, 0.005).blend(0.006)));
  p.push(S.ellipsoid(0.03, 0.02, 0.03).at(0, 0.014, 0.078).color(C.cere).pbr(0.45).blend(0.006));
  p.push(...S.mirrorX([S.sphere(0.006).at(0.015, 0.02, 0.095).color(0x1a1410).cut(0.002)]));
  for (const sx of [1, -1]) {
    hard.push(eyeAt([0.054 * sx, 0.014, 0.058], [0.85 * sx, 0.1, 0.55], 0.019, { iris: C.eye, rim: C.eyeRim, slit: false, white: 0x120c08, glow: C.eyeGlow }));
  }
  const hinge = [0, -0.028, 0.035];
  jp.push(bk(S.capsule([0, -0.036, 0.05], [0, -0.04, 0.05 + bl * 0.86], 0.024 * K.beakR, 0.01).blend(0.008)));
  jp.push(fe(S.ellipsoid(0.04, 0.022, 0.04).at(0, -0.045, 0.03)));
  if (kind === 'raven') {
    p.push(fe(S.ellipsoid(0.03, 0.022, 0.05).at(0, 0.016, 0.1).blend(0.01)).color(C.body).bump(0.006, 60, 'fur'));  // nasal bristles
    jp.push(fe(S.ellipsoid(0.045, 0.04, 0.05).at(0, -0.07, 0.0).blend(0.02)).bump(0.012, 40, 'fur'));                 // throat hackles
  }
  if (kind === 'phoenix') {
    // a swept crest of long plumes
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.2, len = 0.26 - Math.abs(i - 2) * 0.035;
      const f = feather([Math.sin(a) * 0.03, 0.062, -0.01], [Math.sin(a) * 0.5, 0.75, -0.9], len, 0.022, [rgb(C.plumeA), rgb(C.plumeB)], [0, 1, 1], 1).glow(C.glowK);
      hard.push(f);
      hard.push(H.sphere(0.014, 8).scale(1, 1.5, 1).at(...add3([Math.sin(a) * 0.03, 0.062, -0.01], mul3(norm3([Math.sin(a) * 0.5, 0.75, -0.9]), len))).color(C.glow).glow(1.5).lod(1));
    }
  }
  return { p, hard, jp, jhard, hinge };
}

function bird(def, o = {}) {
  if (o.kind === 'vultureLord') return vultureLord(def, o);
  const kind = o.kind === 'raven' || o.kind === 'phoenix' ? o.kind : 'eagle';
  const raven = kind === 'raven', phoenix = kind === 'phoenix';
  const base = col(o.color, raven ? 0x14141a : phoenix ? 0xff8a2a : 0x8a6a40);
  const glow = col(o.glow, phoenix ? tone(base, 0.04, 0, 0.18) : base), cold = phoenix && isCold(glow);
  const rnd = rng(hashStr(def?.id || kind));
  const C = raven
    ? { body: base, head: base, breast: tone(base, 0, 0.05, 0.03), beak: 0x1c1c20, cere: tone(base, 0, 0, 0.04), foot: 0x26262a, claw: 0x0c0c0e, eye: 0x8a6a40, eyeRim: 0x1a1008, rough: 0.34,
      wing: { bone: base, a: tone(base, 0.62, 0.25, 0.07), b: base, tip: tone(base, 0, 0, -0.03), covert: tone(base, 0.6, 0.2, 0.04), shape: 0 }, tailA: tone(base, 0.62, 0.2, 0.05), tailB: base }
    : phoenix
      ? { body: base, head: mix(base, glow, 0.35), breast: mix(base, glow, 0.55), beak: cold ? 0xdfe9f2 : 0xf2c040, cere: cold ? 0xa8c8e0 : 0xe08a20, foot: cold ? 0xb8cad8 : 0xd8a030, claw: cold ? 0x3a4a5a : 0x3a1a0a,
        eye: cold ? 0xe8f8ff : 0xfff0a0, eyeRim: glow, eyeGlow: 1.2, rough: 0.5, glow, glowK: 0.75, plumeA: base, plumeB: glow,
        wing: { bone: base, a: tone(base, cold ? 0.02 : -0.03, 0, -0.1), b: mix(base, glow, 0.6), tip: glow, covert: base, shape: 1, glow: 0.45 }, tailA: base, tailB: glow }
      : { body: base, head: mix(base, 0xf6f1e6, 0.88), breast: tone(base, 0.01, 0, 0.05), beak: 0xe9b62a, cere: 0xf0c83a, foot: 0xe2ac28, claw: 0x16120e, eye: 0xf2c838, eyeRim: 0x6a3a08, rough: 0.62,
        wing: { bone: base, a: tone(base, 0, -0.03, -0.06), b: tone(base, -0.01, -0.08, -0.17), tip: tone(base, 0, -0.15, -0.24), covert: tone(base, 0.01, 0.02, 0.04), shape: 0, band: true }, tailA: mix(base, 0xf6f1e6, 0.85), tailB: mix(base, 0xf6f1e6, 0.6) };
  const K = raven ? { beak: 0.15, hook: 0.012, beakR: 1.0, neck: 0.0, tail: 0.36, span: 0.9 }
    : phoenix ? { beak: 0.11, hook: 0.02, beakR: 0.8, neck: 0.16, tail: 0.3, span: 1.02 }
      : { beak: 0.1, hook: 0.042, beakR: 1.08, neck: 0.03, tail: 0.34, span: 1.0 };
  const fe = (q) => q.color(C.body).bump(0.007, 27, 'scales').tint(0.14, 14).pbr(C.rough);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const HIP = [0, 0.36, -0.08];
  const torso = N('torso', 'root', HIP, { rig: 'torso', detail: 0.85 });
  {
    const p = torso.prims;
    p.push(fe(S.ellipsoid(0.15, 0.15, 0.3).at(0, 0.4, 0.05)));
    p.push(fe(S.ellipsoid(0.14, 0.15, 0.17).at(0, 0.375, 0.2).blend(0.05)).color(C.breast));
    p.push(fe(S.ellipsoid(0.105, 0.1, 0.19).at(0, 0.415, -0.22).blend(0.05)));
    p.push(...S.mirrorX([fe(S.ellipsoid(0.07, 0.07, 0.12).at(0.1, 0.45, 0.17).blend(0.035))]));
    p.push(fe(S.capsule([0, 0.43, 0.26], [0, 0.47, 0.37], 0.1, 0.085).blend(0.04)));
    if (phoenix) { for (const q of p) q.glow(0.22); p.push(S.ellipsoid(0.1, 0.06, 0.26).at(0, 0.29, 0.08).color(glow).glow(0.6).paint(0.05)); }
    if (!raven && !phoenix) p.push(S.ellipsoid(0.12, 0.1, 0.1).at(0, 0.46, 0.34).color(C.head).paint(0.03));
  }
  // neck and head
  const NB = [0, 0.46, 0.36], NE = [0, 0.5 + K.neck * 0.8, 0.46 + K.neck * 0.45];
  const neck = N('neck', 'torso', NB, { rig: 'neck', detail: 0.9 });
  neck.prims.push(fe(S.capsule(NB, NE, 0.086 - K.neck * 0.12, 0.074 - K.neck * 0.08)).color(C.head));
  neck.prims.push(fe(S.sphere(0.088).at(...NB).blend(0.02)).color(C.head));
  if (phoenix) for (const q of neck.prims) q.glow(0.22);
  const hd = birdHead(kind, C, K);
  const head = N('head', 'neck', [0, 0, 0], { rig: 'head', pos: sub3(add3(NE, [0, 0.015, 0.03]), NB), rot: [8, 0, 0], detail: 1.5 });
  head.prims = hd.p; head.hard = hd.hard;
  const jaw = N('jaw', 'head', hd.hinge, { rig: 'jaw', pos: hd.hinge, detail: 1.5 });
  jaw.prims = hd.jp; jaw.hard = hd.jhard;
  // legs: feathered thigh, bare shank, talons
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R';
    const lg = addLeg(N, nm, 'torso', sx, [[0.075, 0.33, -0.05], [0.09, 0.19, 0.03], [0.09, 0.05, -0.005], [0.09, 0, 0.0]], [0.062, 0.024, 0.017],
      (q) => q.color(C.foot).pbr(0.5).bump(0.002, 60, 'scales'), { detail: 1.1, minRes: 70, muscle: 1.15, foot: { kind: 'talon', len: 0.1, w: 0.026, toes: 3, clawLen: 0.062, claw: C.claw, spread: 0.55 } });
    for (const q of lg.up.prims.slice(0, 2)) fe(q).color(C.breast);
    lg.up.prims[2].color(C.breast);
  }
  // tail fan
  const TP = [0, 0.415, -0.36];
  const tail = N('tail', 'torso', TP, { rig: 'tail' });
  tail.prims.push(fe(S.ellipsoid(0.07, 0.045, 0.09).at(0, 0.41, -0.38)));
  const nT = raven ? 7 : 9;
  for (let i = 0; i < nT; i++) {
    const f = (i / (nT - 1)) * 2 - 1, a = f * (phoenix ? 0.35 : 0.5), len = K.tail * (raven ? 1 - Math.abs(f) * 0.28 : 1 - Math.abs(f) * 0.08);
    const h = feather(add3(TP, [f * 0.035, -Math.abs(f) * 0.008, -0.03]), [Math.sin(a), -0.04, -Math.cos(a)], len, 0.045, [rgb(C.tailA), rgb(C.tailB)], [0.2 * (i % 2 ? 1 : -1), 1, 0], C.wing.shape);
    if (phoenix) h.glow(0.4);
    tail.hard.push(h);
  }
  if (phoenix) {
    // long streamers, each its own node so they trail and ripple
    for (let i = 0; i < 5; i++) {
      const f = (i - 2) / 2, len = 1.0 - Math.abs(f) * 0.22, a = f * 0.3;
      const dir = [Math.sin(a), -0.1, -Math.cos(a)], mid = add3(TP, mul3(dir, len * 0.5));
      for (let k = 0; k < 2; k++) {
        const b0 = k ? mid : TP, n = N(`plume${i}_${k}`, k ? `plume${i}_0` : 'tail', b0, { rig: 'plumes' });
        const pts = [0, 0.5, 1].map((u) => add3(b0, add3(mul3(dir, len * 0.5 * u), [0, Math.sin((k + u) * 1.6) * 0.03, 0])));
        n.hard.push(H.tube(pts, k ? [0.012, 0.009, 0.004] : [0.016, 0.014, 0.012], 5, 4).color(mix(base, glow, 0.3 + k * 0.4)).glow(0.7 + k * 0.5));
        const nb = 5;
        for (let j = 0; j < nb; j++) for (const sx of [1, -1]) {
          const u = (j + 0.5) / nb, q = add3(b0, mul3(dir, len * 0.5 * u));
          if (cold) n.hard.push(spike(q, [sx * 0.9, -0.3, -0.5], 0.055 + 0.03 * k, 0.008, mix(glow, 0xffffff, 0.5), [0, 0, -1], 0, 0.5).glow(1.0).lod(1));
          else n.hard.push(feather(q, [sx * 0.8, 0.12, -0.75], 0.075 + 0.03 * k, 0.014, [rgb(mix(base, glow, 0.5)), rgb(glow)], [0, 1, 0], 2).glow(1.1).lod(1));
        }
        if (k) {
          const e = add3(b0, mul3(dir, len * 0.5));
          n.hard.push(feather(add3(e, mul3(dir, -0.09)), dir, 0.2, 0.055, [rgb(mix(base, glow, 0.5)), rgb(glow)], [0, 1, 0], cold ? 1 : 0).glow(1.2));
          n.hard.push(H.sphere(0.02, 8).scale(1, 0.4, 1.4).at(e[0], e[1] + 0.004, e[2]).color(cold ? 0xffffff : tone(glow, 0, 0, 0.2)).glow(1.8).lod(1));
        }
      }
    }
  }
  // wings
  const s = K.span;
  const G = { Sh: [0.11, 0.47, 0.2], E: [0.11 + 0.26 * s, 0.5, 0.12], W: [0.11 + 0.5 * s, 0.49, 0.24], T: [0.11 + 0.9 * s, 0.46, 0.1] };
  addWings(N, 'torso', G, () => {
    const w = featherWing(G, C.wing, { len: 0.45 * s, n: [9, 9] });
    if (phoenix) {
      const licks = (part, row) => row.ends.forEach((e, i) => {
        const d = norm3(sub3(e, row.bases[i]));
        if (cold) part.hard.push(spike(add3(e, mul3(d, -0.05)), add3(d, [0, -0.35, 0]), 0.12 + 0.05 * rnd(), 0.012, mix(glow, 0xffffff, 0.55), [0, -1, 0], 0, 0.5).glow(1.0).lod(1));
        else part.hard.push(feather(add3(e, mul3(d, -0.07)), add3(d, [(rnd() - 0.5) * 0.4, 0.12, 0]), 0.15 + 0.07 * rnd(), 0.022, [rgb(glow), rgb(tone(glow, 0, 0, 0.12))], [0, 1, 0], 2).glow(1.4).lod(1));
      });
      licks(w.arm, w.sec); licks(w.tip, w.pri);
    }
    return w;
  }, 0.9);
  return { kind: 'titan.bird', attack: 'claw', rate: raven ? 10.5 : phoenix ? 7.6 : 8.2, perch: 0.34, nodes: finish(N.nodes) };
}

/** eagle, raven, phoenix and the pterosaur: built in flight with the legs hanging; this folds and perches them */
function birdAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, fly = !!c.flying;
  const L = rig.legs || [], Sh = rig.shins || [], T = rig.tail || [], PL = rig.plumes || [];
  const idle = Math.sin(t * 1.5 + ph), idle2 = Math.sin(t * 0.8 + ph * 1.7);
  const perch = rig.perch ?? 0.3, ptero = rig.variant === 'ptero';
  inner.rotation.x = 0; inner.rotation.z = 0; inner.position.set(0, 0, 0);
  if (c.dead > 0) {
    const f = Math.min(1, c.dead * 2), e = f * f * (3 - 2 * f);
    inner.rotation.z = e * 1.25; inner.position.y = (e * 0.12 - Math.max(0, c.dead - 0.5) * 0.5) * s;
    R(rig.torso, 0); R(rig.neck, 0.5 * e, 0.4 * e); R(rig.head, 0.3 * e); R(rig.jaw, 0.35 * e);
    (rig.wings || []).forEach((w, i) => { const sg = sgn(w, i); R(w, 0.1 * e, sg * 0.5 * e, sg * (i ? 0.25 : -0.5) * e); R((rig.wingtips || [])[i], 0, sg * 0.9 * e, sg * -0.2 * e); });
    L.forEach((l, i) => { R(l, 0.5 * e + i * 0.2); R(Sh[i], -0.9 * e); });
    T.forEach((x) => R(x, 0.15 * e)); PL.forEach((x, i) => R(x, 0.1 * e, (i % 2 ? 1 : -1) * 0.08 * e));
    return;
  }
  let strike = 0, open = 0;
  if (a >= 0) { strike = keys(a, [[0, 0], [0.35, 1], [0.6, 0.7], [1, 0]]); open = keys(a, [[0, 0], [0.3, 1], [0.7, 0.6], [1, 0]]); }
  const beat = wingsPose(rig, { ...c, flying: fly || (a >= 0 && false) }, base, s, { rate: rig.rate ?? 8.4, amp: ptero ? 0.5 : 0.62, fold: ptero ? [0.5, 0.55, 1.5, -0.6, 0.1] : [1.15, 0.22, 1.45, -0.2, 0.0], open });
  if (fly) {
    R(rig.torso, -0.42 * strike);
    R(rig.neck, 0.1 + idle * 0.03 + 0.25 * strike, idle2 * 0.1); R(rig.head, 0.06 + 0.3 * strike, idle2 * 0.12);
    L.forEach((l, i) => { const d = Math.sin(t * 2.1 + i * 1.3 + ph) * 0.05; R(l, lerp(1.05 + d, -0.85, strike), 0, (i ? 1 : -1) * 0.12 * strike); R(Sh[i], lerp(-1.75, 0.35, strike)); });
    T.forEach((x) => R(x, -0.05 + Math.cos(beat) * 0.06 + 0.35 * strike));
    inner.position.y = Math.cos(beat) * 0.05 * s; inner.position.z = strike * 0.1 * s;
    inner.rotation.x = -0.04;
  } else {
    const k = c.moving ? 1 : 0, gait = t * 9 + ph;
    R(rig.torso, -perch - 0.25 * strike + idle * 0.012);
    R(rig.neck, perch * 0.45 + idle * 0.03 - 0.3 * strike + (a >= 0 ? keys(a, [[0, 0], [0.5, 0], [0.62, 0.7], [1, 0]]) : 0), idle2 * 0.25 * (1 - k));
    R(rig.head, perch * 0.45 + (a >= 0 ? keys(a, [[0, 0], [0.5, -0.2], [0.62, 0.5], [1, 0]]) : 0), idle2 * 0.3 * (1 - k));
    L.forEach((l, i) => { const sg = i ? -1 : 1, sw = Math.sin(gait) * sg; R(l, perch - sw * 0.45 * k); R(Sh[i], k * Math.max(0, Math.cos(gait) * sg) * 0.5); });
    T.forEach((x) => R(x, 0.25 + idle * 0.03));
    inner.position.y = k * Math.abs(Math.sin(gait)) * 0.035 * s;
  }
  R(rig.jaw, a >= 0 ? keys(a, [[0, 0], [0.3, 0.5], [0.6, 0.35], [1, 0]]) : 0.02 + 0.03 * Math.max(0, idle2));
  PL.forEach((x, i) => R(x, Math.sin(t * (fly ? 5 : 1.6) + ph - i * 0.9) * (fly ? 0.07 : 0.03) + (fly ? 0 : -0.08), Math.sin(t * (fly ? 3.4 : 1.2) + ph + i * 1.7) * 0.07, 0));
}

// ---------------- the vulture-lord ----------------
// rig: torso, neck, necks[], head, jaw, legs[2], shins[2], arms[2], forearms[2], staff[], wings, wingtips, robe[]
function vultureLord(def, o = {}) {
  const base = col(o.color, 0x3a6ad8), glow = col(o.glow, 0xe85ac8);
  const rnd = rng(hashStr(def?.id || 'vultureLord'));
  const robeC = tone(base, 0.02, -0.1, -0.18), robeD = tone(base, 0.03, -0.1, -0.27), gold = 0xd8b03a, skin = mix(tone(base, 0.45, -0.35, 0.2), 0xd8b8c0, 0.5), beakC = 0xe6d9a8;
  const fe = (q) => q.color(base).bump(0.007, 27, 'scales').tint(0.16, 12).pbr(0.5);
  const cloth = (q) => q.color(robeC).bump(0.006, 16, 'fur').tint(0.1, 9).pbr(0.75);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  // robe skirt: stays planted, the feet stride beneath it
  const robe = N('robe', 'root', [0, 0.56, 0], { rig: 'robe', detail: 0.8 });
  robe.prims.push(cloth(S.cone(0.3, 0.17, 0.56, 0.03).at(0, 0.3, -0.02)));
  robe.prims.push(cloth(S.cone(0.22, 0.12, 0.5, 0.03).rot(-14, 0, 0).at(0, 0.3, -0.16).blend(0.06)));
  robe.prims.push(S.cyl(0.33, 0.07, 0.01).at(0, 0.035, -0.03).color(gold).pbr(0.4, 0.85).paint(0.006, 0.004));
  robe.prims.push(S.box(0.07, 0.56, 0.4, 0.01).at(0, 0.3, 0.14).color(mix(robeC, glow, 0.5)).paint(0.008, 0.002));
  for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.283 + 0.4; robe.hard.push(H.sphere(0.014, 8).at(Math.sin(a) * 0.31, 0.045, Math.cos(a) * 0.31 - 0.03).color(glow).glow(1.4).lod(1)); }
  for (const sx of [1, -1]) {
    addLeg(N, sx > 0 ? 'L' : 'R', 'root', sx, [[0.09, 0.5, 0.0], [0.1, 0.27, 0.05], [0.1, 0.06, 0.0], [0.1, 0, 0.02]], [0.06, 0.035, 0.024],
      (q) => q.color(0xcaa84a).pbr(0.5).bump(0.003, 50, 'scales'), { detail: 0.9, minRes: 50, foot: { kind: 'talon', len: 0.14, w: 0.034, toes: 3, clawLen: 0.07, claw: 0x18140f, spread: 0.5 } });
  }
  // hunched torso
  const torso = N('torso', 'root', [0, 0.56, 0], { rig: 'torso', detail: 0.85 });
  {
    const p = torso.prims;
    p.push(cloth(S.ellipsoid(0.19, 0.2, 0.15).at(0, 0.74, 0.0)));
    p.push(cloth(S.ellipsoid(0.21, 0.17, 0.17).rot(18, 0, 0).at(0, 0.9, 0.03).blend(0.06)));
    p.push(cloth(S.ellipsoid(0.16, 0.13, 0.14).at(0, 0.6, -0.01).blend(0.05)));
    p.push(cloth(S.ellipsoid(0.15, 0.12, 0.13).at(0, 1.0, -0.07).blend(0.05)).color(robeD));     // the hump of the shoulders
    p.push(S.torus(0.165, 0.025).at(0, 0.61, -0.005).color(gold).pbr(0.4, 0.85).paint(0.005, 0.005));
    p.push(S.box(0.07, 0.3, 0.3, 0.01).at(0, 0.76, 0.12).color(mix(robeC, glow, 0.5)).paint(0.008, 0.002));
    torso.hard.push(H.sphere(0.03, 12).scale(1, 1.2, 0.6).at(0, 0.61, 0.15).color(glow).glow(1.5));
    torso.hard.push(H.torus(0.036, 0.008, 12, 5).scale(1, 1.2, 1).at(0, 0.61, 0.152).color(gold).pbr(0.35, 0.9).lod(1));
    // feather ruff around the base of the neck
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 6.283, d = [Math.sin(a), 0.42, Math.cos(a) * 0.9 + 0.15];
      torso.hard.push(feather([Math.sin(a) * 0.07, 1.0, 0.07 + Math.cos(a) * 0.06], d, 0.2 + 0.03 * (i % 2), 0.04, [rgb(tone(base, -0.08, 0, 0.1)), rgb(i % 2 ? glow : 0xf2ece0)], [0, 1, 0], 1).lod(2));
    }
    // a mantle of feathers over the shoulders
    for (const sx of [1, -1]) for (let i = 0; i < 5; i++) {
      torso.hard.push(feather([sx * (0.1 + i * 0.025), 1.04 - i * 0.012, -0.02 - i * 0.012], [sx * (0.6 + i * 0.1), -0.25, -0.6], 0.24, 0.05, [rgb(base), rgb(tone(base, 0.1, 0, -0.1))], [0, 1, 0.3], 0).lod(2));
    }
  }
  // long bare neck, S-curved, wrinkled
  const NP = [[0, 1.0, 0.09], [0, 1.1, 0.2], [0, 1.2, 0.21], [0, 1.275, 0.27]];
  const nr = [0.062, 0.05, 0.045, 0.045];
  const skn = (q) => q.color(skin).bump(0.004, 34, 'ridges').tint(0.15, 20).pbr(0.55);
  addChain(N, 'neck', 'torso', NP, nr, skn, { rig: (i) => (i === 0 ? 'neck' : 'necks'), detail: 1.1, minRes: 40 });
  // head
  const head = N('head', 'neck2', [0, 0, 0], { rig: 'head', pos: sub3(NP[3], NP[2]), rot: [14, 0, 0], detail: 1.6 });
  {
    const p = head.prims, bk = (q) => q.color(beakC).pbr(0.35).tint(0.1, 30);
    p.push(skn(S.ellipsoid(0.062, 0.058, 0.08).at(0, 0.01, 0.02)).bump(0.003, 40, 'noise'));
    p.push(...S.mirrorX([skn(S.capsule([0.015, 0.045, 0.08], [0.058, 0.04, 0.0], 0.014, 0.02).blend(0.01))]));
    p.push(bk(S.capsule([0, 0.0, 0.07], [0, -0.02, 0.19], 0.036, 0.024).blend(0.008)));
    p.push(bk(S.capsule([0, -0.02, 0.19], [0, -0.075, 0.2], 0.023, 0.005).blend(0.006)));
    p.push(S.ellipsoid(0.028, 0.02, 0.035).at(0, 0.012, 0.085).color(0x3a3a48).pbr(0.4).blend(0.006));
    // many small eyes: three a side, and one in the brow
    const E = [[0.048, 0.016, 0.062, 0.014], [0.057, 0.022, 0.03, 0.011], [0.058, 0.0, 0.005, 0.009], [0.04, -0.012, 0.075, 0.007]];
    for (const [x, y, z, r] of E) for (const sx of [1, -1]) head.hard.push(glowEye([x * sx, y, z], r, glow, 1.7).lod(r > 0.01 ? 3 : 1));
    head.hard.push(glowEye([0, 0.05, 0.062], 0.011, glow, 1.7).lod(1));
    // crown of quills
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.3;
      head.hard.push(feather([Math.sin(a) * 0.04, 0.045, -0.03], [Math.sin(a) * 0.8, 0.8, -0.6], 0.17 - Math.abs(i - 3) * 0.018, 0.02, [rgb(base), rgb(glow)], [0, 0.5, 1], 1).lod(2));
    }
    head.hard.push(H.torus(0.058, 0.009, 14, 5).rot(80, 0, 0).at(0, 0.04, 0.0).color(gold).pbr(0.35, 0.9).lod(2));
  }
  const jaw = N('jaw', 'head', [0, -0.03, 0.04], { rig: 'jaw', pos: [0, -0.03, 0.04], detail: 1.5 });
  jaw.prims.push(S.capsule([0, -0.04, 0.05], [0, -0.05, 0.17], 0.02, 0.01).color(beakC).pbr(0.35));
  jaw.prims.push(skn(S.ellipsoid(0.035, 0.03, 0.04).at(0, -0.06, 0.02).blend(0.01)));     // wattle
  // arms in wide sleeves, taloned hands
  const staffOn = !!o.staff;
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.2, 0.96, 0.02]), El = X([0.24, 0.72, 0.0]), Wr = X([0.25, 0.5, 0.06]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.9 });
    up.prims.push(cloth(S.capsule(Sp, El, 0.07, 0.065)));
    up.prims.push(cloth(S.sphere(0.085).at(...Sp).blend(0.03)).color(robeD));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 1.0 });
    fo.prims.push(cloth(S.capsule(El, lerp3(El, Wr, 0.8), 0.066, 0.085)));
    fo.prims.push(S.torus(0.08, 0.016).rot(15, 0, 0).at(...lerp3(El, Wr, 0.8)).color(gold).pbr(0.4, 0.85).blend(0.004));
    fo.prims.push(skn(S.capsule(lerp3(El, Wr, 0.7), Wr, 0.03, 0.028).blend(0.004)));
    fo.prims.push(skn(S.ellipsoid(0.036, 0.04, 0.03).at(...add3(Wr, [0, -0.03, 0])).blend(0.01)));
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.4, b0 = add3(Wr, [Math.sin(a) * 0.025, -0.055, 0.012]);
      fo.hard.push(spike(b0, [Math.sin(a) * 0.5, -1, 0.35], 0.085, 0.011, 0x2a2420, [0, 0, 1], 0.4).lod(2));
    }
    if (sx < 0 && staffOn) {
      const st = N('staff', `fore${nm}`, add3(Wr, [0, -0.035, 0.03]), { rig: 'staff', detail: 1.0 });
      const g = add3(Wr, [0, -0.035, 0.03]);
      st.hard.push(H.cyl(0.016, 0.02, 1.3, 8).at(g[0], 0.66, g[2]).color(0x2a2030).pbr(0.6));
      for (const y of [0.3, 0.9, 1.22]) st.hard.push(H.torus(0.022, 0.008, 10, 5).rot(90, 0, 0).at(g[0], y, g[2]).color(gold).pbr(0.35, 0.9).lod(2));
      // head of the staff: a crescent cradling a burning eye
      st.hard.push(H.torus(0.085, 0.015, 16, 6, Math.PI * 1.25).rot(0, 0, -112).at(g[0], 1.42, g[2]).color(gold).pbr(0.35, 0.9));
      st.hard.push(H.sphere(0.048, 14).at(g[0], 1.42, g[2]).color(glow).glow(1.8));
      st.hard.push(H.sphere(0.018, 8).scale(0.5, 1.6, 1).at(g[0], 1.42, g[2] + 0.04).color(0x100818).lod(1));
      for (let i = 0; i < 3; i++) st.hard.push(feather([g[0], 1.3, g[2]], [(i - 1) * 0.5, -1, -0.3], 0.2, 0.025, [rgb(base), rgb(glow)], [0, 0, 1], 1).lod(2));
    }
  }
  // great iridescent wings
  const G = { Sh: [0.1, 0.98, -0.1], E: [0.4, 1.2, -0.2], W: [0.72, 1.12, -0.1], T: [1.2, 0.98, -0.2] };
  const WC = { bone: base, a: base, b: tone(base, 0.12, 0.05, -0.04), tip: glow, covert: tone(base, -0.1, 0.05, 0.06), shape: 0, band: true };
  addWings(N, 'torso', G, () => {
    const w = featherWing(G, WC, { len: 0.5, n: [10, 10], r: 0.05 });
    // eye-spots near the tips of the long feathers
    w.pri.ends.forEach((e, i) => { if (i % 2 === 0) w.tip.hard.push(H.sphere(0.022, 8).scale(1, 0.25, 1.5).at(e[0] * 0.97, e[1] + 0.012, e[2] + 0.05).color(glow).glow(1.2).lod(1)); });
    w.sec.ends.forEach((e, i) => { if (i % 3 === 1) w.arm.hard.push(H.sphere(0.02, 8).scale(1, 0.25, 1.5).at(e[0], e[1] + 0.012, e[2] + 0.05).color(glow).glow(1.2).lod(1)); });
    return w;
  }, 0.85);
  return { kind: 'titan.vulture', attack: 'cast', staffed: staffOn, nodes: finish(N.nodes) };
}

function vultureAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, fly = !!c.flying;
  const L = rig.legs || [], Sh = rig.shins || [], A = rig.arms || [], F = rig.forearms || [], NX = rig.necks || [];
  const idle = Math.sin(t * 1.3 + ph), idle2 = Math.sin(t * 0.7 + ph * 1.7);
  const k = c.moving && !fly ? 1 : 0, gait = t * 5.2 + ph;
  const cast = a >= 0 ? keys(a, [[0, 0], [0.4, 1], [0.62, 0.8], [1, 0]]) : 0, snap = a >= 0 ? keys(a, [[0, 0], [0.4, 0], [0.55, 1], [1, 0]]) : 0;
  for (let i = 0; i < 2; i++) {
    const sg = i ? -1 : 1;
    if (fly) { R(L[i], 0.5 + Math.sin(t * 2 + i) * 0.05); R(Sh[i], 0.5); } else { R(L[i], -Math.sin(gait) * sg * 0.4 * k); R(Sh[i], k * Math.max(0, Math.cos(gait) * sg) * 0.6); }
  }
  R(rig.torso, 0.05 * k + idle * 0.012 - 0.12 * cast + 0.2 * snap, Math.sin(gait) * 0.05 * k, 0);
  R(rig.neck, idle * 0.04 - 0.25 * cast + 0.3 * snap, idle2 * 0.12); NX.forEach((n, i) => R(n, -idle * 0.03 - 0.12 * cast + 0.2 * snap, idle2 * 0.14));
  R(rig.head, idle * 0.03 + 0.1 * cast, idle2 * 0.2); R(rig.jaw, 0.03 + 0.45 * cast);
  // left hand gestures; right hand keeps the staff planted and upright
  const ax = -0.35 - 0.12 * idle - 1.5 * cast, fx = -0.5 - 0.4 * cast + 0.3 * snap;
  R(A[0], ax, 0, 0.12 + 0.3 * cast); R(F[0], fx);
  const rx = -0.28 + Math.sin(gait) * 0.12 * k - 0.75 * cast - 0.5 * snap, rfx = -0.3 - 0.35 * cast;
  R(A[1], rx, 0, -0.1 - 0.15 * cast); R(F[1], rfx);
  const tx = rig.torso ? rig.torso.rotation.x - (rig.torso.userData.rest?.[0] ?? 0) : 0;
  (rig.staff || []).forEach((st) => R(st, -(rx + rfx + tx) + 0.5 * snap, 0, 0.1 + 0.15 * cast));
  wingsPose(rig, c, base, s * 1.6, { rate: 7.5, amp: 0.5, fold: [0.55, 0.3, 1.25, -0.3, 0.0], open: Math.max(cast, k * 0.15) });
  const dead = base.die(inner, c);
  if (dead) { const f = Math.min(1, c.dead * 2); inner.position.y += f * 0.12 * s; (rig.wings || []).forEach((w, i) => { const sg = sgn(w, i); R(w, 0, sg * 0.2, sg * -0.1 * f); }); R(A[0], -0.4, 0, 0.6 * f); R(A[1], -0.4, 0, -0.6 * f); (rig.staff || []).forEach((st) => R(st, 0.3 * f, 0, -0.5 * f)); return; }
  inner.position.y = fly ? Math.sin(t * 7.5 / Math.sqrt(s * 1.6) + ph) * 0.03 * s : k * Math.abs(Math.sin(gait)) * 0.02 * s;
  inner.rotation.x = fly ? 0.18 : 0;
}

// =====================================================================================
//  SAURIANS: tyrant, hornback, shieldback, pterosaur
// =====================================================================================

function saurPalette(skin) {
  return { skin, back: tone(skin, -0.01, 0.02, -0.12), deep: tone(skin, -0.02, 0, -0.2), belly: mix(skin, 0xe8dcae, 0.68), bellyD: mix(skin, 0xc8b88a, 0.6),
    horn: [0x4a4034, 0xcbbd98, 0xefe6cc], claw: 0x1e1a16, tooth: 0xf1e9cc, mouth: 0x5a1420, tongue: 0xd0605a,
    eye: { iris: 0xffb414, rim: 0x8a2a08, white: 0x1c0c0a, glow: 0.3 } };
}
const crewSize = (o, dflt) => clamp(0.95 / num(o.scale, dflt), 0.3, 0.75);

function saurian(def, o = {}) {
  switch (o.kind) {
    case 'hornback': return hornback(def, o);
    case 'shieldback': return shieldback(def, o);
    case 'pterosaur': return pterosaur(def, o);
    default: return tyrant(def, o);
  }
}

// ---------------- tyrant ----------------
function tyrant(def, o) {
  const C = saurPalette(col(o.skin, 0x7a3a2a));
  const sk = (q) => q.color(C.skin).bump(0.008, 21, 'scales').tint(0.16, 8).pbr(0.5, 0.03);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.74, -0.05], { rig: 'torso', detail: 0.72 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.2, 0.25, 0.34).rot(-10, 0, 0).at(0, 0.77, 0.2)));
    p.push(sk(S.ellipsoid(0.18, 0.21, 0.26).at(0, 0.76, -0.1).blend(0.07)));
    p.push(sk(S.capsule([0, 0.84, 0.4], [0, 0.93, 0.56], 0.185, 0.155).blend(0.07)));
    p.push(sk(S.capsule([0, 0.76, -0.26], [0, 0.745, -0.44], 0.17, 0.135).blend(0.06)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.1, 0.16, 0.17).rot(15, 0, -8).at(0.15, 0.74, -0.03).blend(0.04)), sk(S.ellipsoid(0.07, 0.09, 0.1).at(0.12, 0.66, 0.4).blend(0.03))]));
    p.push(S.ellipsoid(0.15, 0.14, 0.75).at(0, 0.96, 0.02).color(C.back).paint(0.07));
    p.push(S.ellipsoid(0.15, 0.12, 0.5).at(0, 0.53, 0.14).color(C.belly).paint(0.05));
    for (let i = 0; i < 8; i++) p.push(...S.mirrorX([S.ellipsoid(0.16, 0.2, 0.016).rot(-12, 0, -30).at(0.1, 0.92, 0.5 - i * 0.12).color(C.deep).paint(0.016)]));
    for (let i = 0; i < 10; i++) p.push(S.ellipsoid(0.022, 0.02, 0.035).at(0, 0.985 + 0.03 * Math.sin((i / 9) * Math.PI) - (i < 1 ? 0.0 : 0) + (i < 3 ? (3 - i) * 0.02 : 0) - (i > 7 ? (i - 7) * 0.03 : 0), 0.52 - i * 0.1).color(C.deep).pbr(0.4).blend(0.008));
  }
  // tiny arms
  for (const sx of [1, -1]) {
    const X = sideX(sx), a = N(`arm${sx > 0 ? 'L' : 'R'}`, 'torso', X([0.14, 0.64, 0.44]), { rig: 'arms', detail: 1, minRes: 60 });
    a.prims.push(sk(S.capsule(X([0.14, 0.64, 0.44]), X([0.16, 0.54, 0.5]), 0.04, 0.03)));
    a.prims.push(sk(S.capsule(X([0.16, 0.54, 0.5]), X([0.15, 0.5, 0.6]), 0.028, 0.022).blend(0.01)));
    for (const dz of [-0.012, 0.012]) a.hard.push(spike(X([0.15 + dz, 0.5, 0.61]), [0, -0.5, 1], 0.05, 0.01, C.claw, [0, -1, 0], 0.4).lod(1));
  }
  const NB = [0, 0.9, 0.5], HJ = [0, 1.04, 0.7];
  const neck = N('neck', 'torso', NB, { rig: 'neck', detail: 0.75 });
  neck.prims.push(sk(S.capsule(NB, HJ, 0.16, 0.135)));
  neck.prims.push(sk(S.capsule(add3(NB, [0, -0.07, 0.04]), add3(HJ, [0, -0.08, 0]), 0.12, 0.1).blend(0.03)).color(C.belly));
  neck.prims.push(S.capsule(add3(NB, [0, 0.1, 0]), add3(HJ, [0, 0.09, -0.02]), 0.09, 0.08).color(C.back).paint(0.04));
  // head: a great box of a skull
  const head = N('head', 'neck', [0, 0, 0], { rig: 'head', pos: sub3(HJ, NB), rot: [10, 0, 0], detail: 1.05 });
  {
    const p = head.prims, bare = (q) => q.color(C.skin).tint(0.12, 16).pbr(0.48).bump(0.004, 34, 'scales');
    p.push(bare(S.ellipsoid(0.125, 0.115, 0.16).at(0, 0.02, 0.05)));
    p.push(bare(S.capsule([0, 0.015, 0.12], [0, -0.005, 0.43], 0.1, 0.078).blend(0.04)));
    p.push(bare(S.capsule([0, -0.045, 0.12], [0, -0.05, 0.42], 0.085, 0.066).blend(0.03)));
    p.push(...S.mirrorX([
      bare(S.capsule([0.045, 0.1, 0.2], [0.1, 0.105, 0.02], 0.028, 0.04).blend(0.02)).color(C.deep),     // brow crest
      bare(S.ellipsoid(0.05, 0.065, 0.08).at(0.09, -0.03, 0.03).blend(0.03)),                             // jaw muscle
      bare(S.ellipsoid(0.022, 0.018, 0.03).at(0.04, 0.045, 0.43).blend(0.012)),                           // nostril
      S.sphere(0.011).at(0.05, 0.055, 0.455).color(0x1a0c08).cut(0.004),
      S.sphere(0.034).at(0.098, 0.05, 0.115).color(C.deep).cut(0.01),
    ]));
    for (let i = 0; i < 5; i++) p.push(bare(S.ellipsoid(0.02, 0.016, 0.03).at(0, 0.088 - i * 0.012, 0.19 + i * 0.055).blend(0.008)).color(C.deep));
    p.push(S.ellipsoid(0.07, 0.06, 0.34).at(0, 0.1, 0.2).color(C.back).paint(0.04));
    p.push(S.box(0.16, 0.05, 0.36, 0.01).at(0, -0.125, 0.27).color(C.mouth).paint(0.01));
    for (const sx of [1, -1]) {
      head.hard.push(eyeAt([0.096 * sx, 0.05, 0.118], [sx, 0.15, 0.4], 0.026, C.eye));
      for (let i = 0; i < 9; i++) {
        const f = i / 8, z = lerp(0.12, 0.47, f), x = lerp(0.085, 0.045, f * f) * sx, L = 0.05 + 0.03 * Math.sin(f * 7 + 1) + (i === 5 ? 0.02 : 0);
        head.hard.push(spike([x, -0.095, z], [sx * 0.12, -1, 0.05], L, 0.012, C.tooth, [0, 0, -1], 0.25).lod(i % 2 ? 1 : 2));
      }
    }
  }
  const HG = [0, -0.04, 0.0];
  const jaw = N('jaw', 'head', HG, { rig: 'jaw', pos: HG, detail: 1.0 });
  {
    const p = jaw.prims, bare = (q) => q.color(C.skin).tint(0.12, 16).pbr(0.48).bump(0.004, 34, 'scales');
    p.push(bare(S.capsule([0, -0.1, 0.04], [0, -0.115, 0.4], 0.075, 0.05)));
    p.push(...S.mirrorX([bare(S.capsule([0.08, -0.05, 0.0], [0.06, -0.1, 0.16], 0.04, 0.035).blend(0.03))]));
    p.push(S.ellipsoid(0.07, 0.05, 0.2).at(0, -0.15, 0.2).color(C.belly).paint(0.03));
    p.push(S.ellipsoid(0.045, 0.02, 0.15).at(0, -0.072, 0.22).color(C.tongue).pbr(0.35).blend(0.01));
    for (const sx of [1, -1]) for (let i = 0; i < 7; i++) {
      const f = i / 6, z = lerp(0.14, 0.43, f), x = lerp(0.06, 0.03, f * f) * sx;
      jaw.hard.push(spike([x, -0.08, z], [sx * 0.1, 1, 0.05], 0.04 + 0.015 * Math.sin(f * 9), 0.01, C.tooth, [0, 0, -1], 0.2).lod(i % 2 ? 1 : 2));
    }
  }
  for (const sx of [1, -1]) {
    const lg = addLeg(N, sx > 0 ? 'L' : 'R', 'torso', sx, [[0.17, 0.74, -0.03], [0.21, 0.43, 0.13], [0.2, 0.13, -0.09], [0.2, 0, 0.0]], [0.13, 0.08, 0.05], sk,
      { detail: 0.75, muscle: 1.3, foot: { kind: 'claw', len: 0.22, w: 0.07, toes: 3, clawLen: 0.1, claw: C.claw, spread: 0.45 } });
    lg.lo.prims.push(S.ellipsoid(0.06, 0.1, 0.07).at(sx * 0.2, 0.3, 0.02).color(C.back).paint(0.03));
  }
  const TL = [[0, 0.745, -0.42], [0, 0.735, -0.64], [0, 0.715, -0.85], [0, 0.7, -1.04], [0, 0.705, -1.21], [0, 0.72, -1.36]];
  addChain(N, 'tail', 'torso', TL, [0.135, 0.105, 0.078, 0.055, 0.036, 0.014], sk, { rig: 'tail', detail: 0.72, deco: (n, a, b, ra, rb, i, f) => {
    n.prims.push(S.capsule(add3(a, mul3(f.dor, ra * 0.5)), add3(b, mul3(f.dor, rb * 0.5)), ra * 0.7, rb * 0.7).color(C.back).paint(0.03));
    n.prims.push(S.capsule(add3(a, mul3(f.dor, -ra * 0.6)), add3(b, mul3(f.dor, -rb * 0.6)), ra * 0.6, rb * 0.6).color(C.belly).paint(0.03));
    for (let k = 0; k < 2; k++) n.prims.push(orient(S.torus(lerp(ra, rb, (k + 0.3) / 2) * 0.95, 0.014), add3(lerp3(a, b, (k + 0.3) / 2), mul3(f.dor, ra * 0.3)), f.t).color(C.deep).paint(0.012));
  } });
  return { kind: 'titan.tyrant', attack: 'bite', nodes: finish(N.nodes) };
}

function tyrantAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const L = rig.legs || [], Sh = rig.shins || [], A = rig.arms || [];
  const k = c.moving ? 1 : 0, gait = t * 5.6 + ph, idle = Math.sin(t * 1.3 + ph), idle2 = Math.sin(t * 0.7 + ph * 1.7);
  for (let i = 0; i < 2; i++) {
    const sg = i ? -1 : 1, sw = Math.sin(gait) * sg;
    R(L[i], -sw * 0.5 * k); R(Sh[i], k * (Math.max(0, Math.cos(gait) * sg) * 0.75 + sw * 0.12));
    R(A[i], Math.sin(t * 2.3 + i * 2 + ph) * 0.12 + (a >= 0 ? -0.5 * bellK(a) : 0));
  }
  let nx = idle * 0.04 + k * Math.sin(gait * 2) * 0.05, hx = -idle * 0.03, jaw = 0.04 + 0.04 * Math.max(0, idle2), tp = idle * 0.01, pz = 0;
  if (a >= 0) {
    const rear = keys(a, [[0, 0], [0.3, 1], [0.52, -1], [0.7, -0.7], [1, 0]]);
    nx += rear > 0 ? -0.4 * rear : -0.55 * rear; hx += rear > 0 ? -0.25 * rear : -0.3 * rear; tp += rear > 0 ? -0.14 * rear : -0.2 * rear;
    jaw = keys(a, [[0, 0.04], [0.3, 0.75], [0.5, 0.9], [0.6, 0.02], [1, 0.04]]);
    pz = keys(a, [[0, 0], [0.3, -0.06], [0.52, 0.2], [1, 0]]);
  }
  R(rig.torso, tp, Math.sin(gait) * 0.06 * k, 0);
  R(rig.neck, nx, idle2 * 0.14 * (1 - k)); R(rig.head, hx, idle2 * 0.16 * (1 - k)); R(rig.jaw, jaw);
  (rig.tail || []).forEach((seg, i) => R(seg, Math.sin(t * 1.3 + ph - i * 0.6) * 0.03 - tp * 0.5, Math.sin(k ? gait - 0.6 - i * 0.6 : t * 1.5 + ph - i * 0.7) * (0.08 + 0.05 * k), 0));
  const dead = dieSide(inner, c, base, 0.18);
  inner.position.z = pz * s;
  if (dead) { const f = Math.min(1, c.dead * 2); R(rig.neck, 0.4 * f); R(rig.jaw, 0.5 * f); for (let i = 0; i < 2; i++) { R(L[i], (i ? 0.5 : -0.4) * f); R(Sh[i], 0.6 * f); } return; }
  inner.position.y = k * Math.abs(Math.sin(gait)) * 0.035 * s;
}

// ---------------- crew platforms ----------------

function bowHowdah(N, parent, at, o, C) {
  const wood = 0x7a5a36, woodD = 0x5a4026, iron = 0x3a3c42, cloth = col(o.cloth, 0xa8342a), gold = col(o.trim, 0xd8b03a);
  const h = N('howdah', parent, at, { rig: 'howdah', detail: 0.9 });
  const [x0, y0, z0] = at, W = 0.62, Lz = 0.86;
  // saddle cloth and platform
  h.prims.push(S.box(W + 0.1, 0.06, Lz * 0.92, 0.02).at(x0, y0 - 0.02, z0).color(cloth).tint(0.1, 20).pbr(0.8));
  for (const sx of [1, -1]) h.prims.push(S.box(0.03, 0.26, Lz * 0.8, 0.012).rot(0, 0, sx * 24).at(x0 + sx * (W / 2 + 0.1), y0 - 0.13, z0).color(cloth).pbr(0.8).blend(0.01),
    S.box(0.034, 0.05, Lz * 0.8, 0.01).rot(0, 0, sx * 24).at(x0 + sx * (W / 2 + 0.148), y0 - 0.235, z0).color(gold).pbr(0.4, 0.8).blend(0.004));
  for (let i = 0; i < 5; i++) h.hard.push(beam([x0 - W / 2 + (i + 0.5) * (W / 5), y0 + 0.035, z0 - Lz / 2], [x0 - W / 2 + (i + 0.5) * (W / 5), y0 + 0.035, z0 + Lz / 2], W / 5 - 0.006, 0.035, i % 2 ? wood : woodD, [0, 1, 0]));
  for (const sx of [1, -1]) for (const sz of [1, -1]) h.hard.push(beam([x0 + sx * (W / 2 - 0.02), y0 + 0.03, z0 + sz * (Lz / 2 - 0.02)], [x0 + sx * (W / 2 - 0.02), y0 + 0.27, z0 + sz * (Lz / 2 - 0.02)], 0.04, 0.04, woodD));
  for (const sx of [1, -1]) h.hard.push(beam([x0 + sx * (W / 2 - 0.02), y0 + 0.25, z0 - Lz / 2], [x0 + sx * (W / 2 - 0.02), y0 + 0.25, z0 + Lz / 2], 0.03, 0.035, wood, [0, 1, 0]));
  h.hard.push(beam([x0 - W / 2, y0 + 0.25, z0 - Lz / 2 + 0.02], [x0 + W / 2, y0 + 0.25, z0 - Lz / 2 + 0.02], 0.03, 0.035, wood, [0, 1, 0]));
  for (const sx of [1, -1]) h.hard.push(H.cyl(0.11, 0.11, 0.02, 10).rot(0, 0, 90).at(x0 + sx * (W / 2 + 0.005), y0 + 0.15, z0 - 0.15).color(cloth).shade((x, y, z) => (Math.hypot(x, z) > 0.085 ? gold : null)).pbr(0.6).lod(2));
  // the bow engine on its post
  const ty = y0 + 0.36, tz = z0 + 0.14;
  h.hard.push(beam([x0, y0 + 0.04, tz], [x0, ty - 0.03, tz], 0.07, 0.07, woodD));
  const tu = N('turret', 'howdah', [x0, ty, tz], { rig: 'turret', detail: 0.9 });
  tu.hard.push(beam([x0, ty, tz - 0.34], [x0, ty, tz + 0.36], 0.07, 0.06, wood, [0, 1, 0]));
  tu.hard.push(H.box(0.1, 0.035, 0.1, 0.006).at(x0, ty - 0.035, tz).color(iron).pbr(0.5, 0.8));
  for (const sx of [1, -1]) {
    const pts = [[x0 + sx * 0.03, ty + 0.01, tz + 0.3], [x0 + sx * 0.22, ty + 0.015, tz + 0.27], [x0 + sx * 0.4, ty + 0.02, tz + 0.15], [x0 + sx * 0.5, ty + 0.02, tz + 0.0]];
    tu.hard.push(H.tube(pts, [0.03, 0.026, 0.02, 0.012], 10, 6).color(woodD).pbr(0.6));
    tu.hard.push(H.tube([pts[3], [x0, ty + 0.035, tz - 0.22]], 0.006, 2, 4).color(0xd8caa0).pbr(0.8).lod(2));
    tu.hard.push(H.torus(0.03, 0.009, 8, 5).rot(0, 0, 90).at(...pts[1]).color(gold).pbr(0.4, 0.8).lod(1));
  }
  const bolt = N('bolt', 'turret', [x0, ty + 0.045, tz], { rig: 'bolt' });
  bolt.hard.push(H.cyl(0.012, 0.012, 0.62, 6).rot(90, 0, 0).at(x0, ty + 0.045, tz + 0.1).color(0xcab890).pbr(0.7));
  bolt.hard.push(H.cone(0.03, 0.12, 6).rot(90, 0, 0).at(x0, ty + 0.045, tz + 0.46).color(0xb8bcc4).pbr(0.3, 0.9));
  for (const rz of [0, 90]) bolt.hard.push(H.box(0.07, 0.002, 0.1, 0.001).rot(0, 0, rz).at(x0, ty + 0.045, tz - 0.17).color(cloth).lod(1));
  const hgt = crewSize(o, 2);
  addCrew(N, 'c0_', 'howdah', [x0 - 0.17, y0 + 0.055, z0 - 0.2], hgt, 'lizard', { skin: col(o.crew, 0x4f9a5a), cloth, metal: gold }, { arms: [0.8, 0.8], yaw: 12 });
  addCrew(N, 'c1_', 'howdah', [x0 + 0.18, y0 + 0.055, z0 - 0.02], hgt, 'lizard', { skin: col(o.crew, 0x4f9a5a), cloth, metal: gold, crest: 0x3a8ac8 }, { arms: [0.3, 0.9], yaw: -25 });
}

function mirrorHowdah(N, parent, at, o, C) {
  const gold = col(o.trim, 0xe0b53c), goldD = tone(gold, -0.01, 0, -0.14), glow = col(o.glow, 0xfff0a8), cloth = col(o.cloth, 0x2a6a8a);
  const h = N('howdah', parent, at, { rig: 'howdah', detail: 0.9 });
  const [x0, y0, z0] = at;
  const G = (q) => q.color(gold).pbr(0.28, 1);
  h.prims.push(S.box(0.56, 0.05, 0.66, 0.02).at(x0, y0, z0).color(cloth).tint(0.1, 20).pbr(0.8));
  h.prims.push(G(S.box(0.44, 0.05, 0.5, 0.012).at(x0, y0 + 0.04, z0).blend(0.004)));
  for (const sx of [1, -1]) h.prims.push(S.box(0.03, 0.2, 0.6, 0.012).rot(0, 0, sx * 38).at(x0 + sx * 0.33, y0 - 0.07, z0).color(cloth).pbr(0.8).blend(0.01));
  // stepped pedestal and yoke
  h.hard.push(G(H.lathe([[0.2, 0], [0.2, 0.03], [0.15, 0.05], [0.15, 0.08], [0.09, 0.1], [0.07, 0.2], [0.09, 0.22], [0, 0.22]], 12).at(x0, y0 + 0.06, z0)));
  const py = y0 + 0.62;
  for (const sx of [1, -1]) {
    h.hard.push(G(H.tube([[x0 + sx * 0.05, y0 + 0.26, z0], [x0 + sx * 0.3, y0 + 0.34, z0], [x0 + sx * 0.36, py, z0]], [0.03, 0.028, 0.022], 10, 6)));
    h.hard.push(G(H.sphere(0.035, 10).at(x0 + sx * 0.36, py, z0)).color(goldD));
  }
  // the dish swings on the yoke
  const tu = N('turret', 'howdah', [x0, py, z0], { rig: 'turret', detail: 0.9 });
  const R0 = 0.33, tilt = -62;
  const P = (q) => q.rot(tilt, 0, 0).at(x0, py, z0);
  tu.hard.push(P(H.lathe([[0, 0], [0.1, 0.006], [0.2, 0.024], [0.28, 0.05], [R0, 0.075], [R0 + 0.01, 0.07], [0.28, 0.035], [0.15, -0.01], [0, -0.02]], 28).color(0xfff0b8).pbr(0.08, 1).shade((x, y, z) => (Math.hypot(x, z) > R0 - 0.03 ? rgb(gold) : y < 0 ? rgb(goldD) : null))));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 6.283, L = i % 2 ? 0.1 : 0.17;
    tu.hard.push(P(H.cone(0.035, L, 4).scale(1, 1, 0.35).rot(0, 0, -90).rot(0, -a / DEG, 0).at(Math.cos(a) * (R0 + L / 2), 0.065, Math.sin(a) * (R0 + L / 2)).color(gold).pbr(0.25, 1)).lod(i % 2 ? 2 : 3));
  }
  for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283 + 0.5; tu.hard.push(P(H.tube([[Math.cos(a) * 0.2, 0.03, Math.sin(a) * 0.2], [Math.cos(a) * 0.1, 0.2, Math.sin(a) * 0.1], [0, 0.32, 0]], 0.008, 6, 4).color(goldD).pbr(0.3, 1)).lod(2)); }
  const fz = Math.sin(-tilt * DEG) * 0.34, fy = Math.cos(tilt * DEG) * 0.34;
  const core = N('core', 'turret', [x0, py + fy, z0 + fz], { rig: 'core' });
  core.hard.push(H.geo(cached('octa', () => new THREE.OctahedronGeometry(1, 0))).scale(0.05, 0.075, 0.05).at(x0, py + fy, z0 + fz).color(glow).glow(2).pbr(0.2));
  core.hard.push(H.sphere(0.075, 10).at(x0, py + fy, z0 + fz).color(mix(glow, 0xffffff, 0.3)).glow(0.9).pbr(0.9).lod(1));
  const hgt = crewSize(o, 1.8);
  addCrew(N, 'c0_', 'howdah', [x0, y0 + 0.065, z0 - 0.26], hgt * 0.9, 'lizard', { skin: col(o.crew, 0x3a9a8a), cloth, metal: gold, crest: 0xe8c040 }, { arms: [1, 1] });
}

// ---------------- the shared four-legged animator ----------------
// rig values: rate (gait speed), stride, atkStyle 'gore' | 'tail' | 'cast' | 'bite'; lists crew*, turret, core, bolt
function quadAnim(rig, inner, c, base) {
  const { R, P, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const k = c.moving ? 1 : 0, idle = Math.sin(t * 1.2 + ph), idle2 = Math.sin(t * 0.66 + ph * 1.7);
  const gait = walk4(rig, c, base, rig.rate ?? 5.5, rig.stride ?? 0.34, 0.5, -0.4);
  const style = rig.atkStyle || 'bite';
  let hx = idle * 0.04 + k * Math.sin(gait * 2) * 0.03, hy = idle2 * 0.14 * (1 - k), jaw = 0.02, pz = 0, ty = Math.sin(gait) * 0.035 * k, tx = 0, tailY = 0, tailX = 0;
  if (a >= 0) {
    if (style === 'gore') {
      hx = keys(a, [[0, 0], [0.34, 0.5], [0.52, -0.55], [1, 0]]); pz = keys(a, [[0, 0], [0.34, -0.08], [0.52, 0.2], [1, 0]]); tx = keys(a, [[0, 0], [0.34, 0.05], [0.52, -0.07], [1, 0]]); hy = 0;
    } else if (style === 'tail') {
      const sw = keys(a, [[0, 0], [0.32, -1], [0.55, 1], [1, 0]]);
      ty = sw * 0.3; tailY = sw * 0.42; hy = -sw * 0.3;
    } else if (style === 'cast') {
      hx = -0.1 * bellK(a); tx = -0.03 * bellK(a);
    } else {
      hx = keys(a, [[0, 0], [0.34, -0.4], [0.52, 0.4], [1, 0]]); pz = keys(a, [[0, 0], [0.34, -0.06], [0.52, 0.18], [1, 0]]); jaw = keys(a, [[0, 0], [0.34, 0.7], [0.56, 0.05], [1, 0]]);
    }
  }
  R(rig.torso, tx + idle * 0.006, ty, 0);
  R(rig.neck, hx * 0.5, hy * 0.5); R(rig.head, hx * (rig.neck ? 0.6 : 1), hy); R(rig.jaw, jaw + 0.03 * Math.max(0, idle2));
  (rig.tail || []).forEach((seg, i) => R(seg, tailX + Math.sin(t * 1.3 + ph - i * 0.6) * 0.03, tailY + Math.sin(t * (k ? 4 : 1.5) + ph - i * 0.7) * (0.07 + 0.04 * k), 0));
  // the engine and its crew
  const cast = a >= 0 ? bellK(a) : 0;
  if (rig.turret) {
    if (rig.core) { R(rig.turret, 0.25 * cast + idle * 0.02, idle2 * 0.2 * (1 - cast)); rig.core.scale.setScalar(1 + cast * 1.6 + Math.sin(t * 5 + ph) * 0.08); }
    else { R(rig.turret, -0.06 + idle * 0.01 - 0.05 * cast, idle2 * 0.25); }
  }
  (rig.bolt || []).forEach((b) => { P(b, 0, 0, a >= 0 ? keys(a, [[0, 0], [0.3, -0.12], [0.36, 0.5], [0.4, 2.5], [0.45, 0], [1, 0]]) : 0); b.visible = !(a > 0.38 && a < 0.8); });
  (rig.crewArms || []).forEach((x, i) => R(x, Math.sin(t * 2 + i * 1.7 + ph) * 0.08 - 0.4 * cast * (i % 2 ? 1 : 0.4)));
  (rig.crewHeads || []).forEach((x, i) => R(x, 0, Math.sin(t * 0.9 + i * 2.3 + ph) * 0.35));
  const dead = dieSide(inner, c, base, rig.lie ?? 0.22);
  inner.position.z = pz * s;
  if (dead) { const f = Math.min(1, c.dead * 2); R(rig.neck, 0.3 * f); R(rig.head, 0.3 * f); R(rig.jaw, 0.4 * f); (rig.crewArms || []).forEach((x, i) => R(x, -1.2 * f, 0, (i % 2 ? -1 : 1) * 0.8 * f)); return; }
  inner.position.y = k * Math.abs(Math.sin(gait)) * 0.018 * s;
}

// ---------------- hornback ----------------
function hornback(def, o) {
  const C = saurPalette(col(o.skin, 0x5a7a4a));
  const frillA = tone(C.skin, 0.02, 0.05, -0.08), frillB = col(o.trim, 0xd8862a);
  const sk = (q) => q.color(C.skin).bump(0.009, 17, 'scales').tint(0.16, 7).pbr(0.55, 0.02);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.52, 0], { rig: 'torso', detail: 0.66 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.31, 0.3, 0.5).at(0, 0.53, -0.02)));
    p.push(sk(S.ellipsoid(0.26, 0.27, 0.26).at(0, 0.57, 0.3).blend(0.07)));
    p.push(sk(S.ellipsoid(0.28, 0.28, 0.27).at(0, 0.55, -0.34).blend(0.07)));
    p.push(sk(S.capsule([0, 0.55, 0.42], [0, 0.52, 0.6], 0.2, 0.17).blend(0.06)));
    p.push(sk(S.capsule([0, 0.55, -0.5], [0, 0.52, -0.62], 0.2, 0.17).blend(0.06)));
    p.push(S.ellipsoid(0.2, 0.12, 0.8).at(0, 0.82, -0.05).color(C.back).paint(0.08));
    p.push(S.ellipsoid(0.24, 0.12, 0.5).at(0, 0.25, 0).color(C.belly).paint(0.06));
    for (let i = 0; i < 7; i++) for (const sx of [1, -1]) p.push(S.ellipsoid(0.04, 0.03, 0.05).at(sx * (0.2 + 0.05 * Math.sin(i * 2.1)), 0.74 + 0.03 * Math.cos(i * 1.7), 0.38 - i * 0.14).color(C.deep).pbr(0.4).blend(0.012));
    for (let i = 0; i < 9; i++) p.push(S.ellipsoid(0.03, 0.03, 0.045).at(0, 0.81 + 0.035 * Math.sin((i / 8) * Math.PI), 0.42 - i * 0.12).color(C.horn[0]).pbr(0.4).blend(0.008));
  }
  // head with its frill
  const HP = [0, 0.52, 0.58];
  const head = N('head', 'torso', HP, { rig: 'head', detail: 0.95 });
  {
    const p = head.prims, bare = (q) => q.color(C.skin).tint(0.14, 14).pbr(0.5).bump(0.005, 30, 'scales');
    // frill first, so the skull blends over it
    p.push(S.ellipsoid(0.36, 0.33, 0.045).rot(-30, 0, 0).at(0, 0.73, 0.57).color(frillA).pbr(0.55).tint(0.12, 9));
    p.push(...S.mirrorX([S.ellipsoid(0.11, 0.13, 0.03).rot(-30, 0, 0).at(0.16, 0.8, 0.565).color(frillB).paint(0.012, -0.004), S.ellipsoid(0.05, 0.06, 0.03).rot(-30, 0, 0).at(0.16, 0.8, 0.57).color(0x1a1410).paint(0.008)]));
    p.push(bare(S.ellipsoid(0.16, 0.15, 0.2).at(0, 0.47, 0.75).blend(0.04)));
    p.push(bare(S.capsule([0, 0.5, 0.66], [0, 0.6, 0.6], 0.15, 0.13).blend(0.05)));
    p.push(bare(S.capsule([0, 0.44, 0.86], [0, 0.4, 0.99], 0.105, 0.07).blend(0.04)));
    p.push(S.capsule([0, 0.4, 0.98], [0, 0.33, 1.05], 0.07, 0.022).color(C.horn[1]).pbr(0.4).blend(0.012));          // beak
    p.push(...S.mirrorX([bare(S.capsule([0.06, 0.57, 0.86], [0.14, 0.58, 0.7], 0.035, 0.05).blend(0.02)), S.sphere(0.03).at(0.135, 0.5, 0.8).color(C.deep).cut(0.01), S.sphere(0.01).at(0.045, 0.42, 1.0).color(0x1a0c08).cut(0.004)]));
    for (const sx of [1, -1]) {
      head.hard.push(eyeAt([0.132 * sx, 0.5, 0.8], [sx, 0.1, 0.3], 0.024, C.eye));
      head.hard.push(...horn([[0.09 * sx, 0.57, 0.8], [0.12 * sx, 0.68, 0.92], [0.13 * sx, 0.78, 1.08], [0.12 * sx, 0.86, 1.2]], 0.05, C.horn));
      head.hard.push(spike([0.15 * sx, 0.4, 0.72], [sx, -0.5, 0.1], 0.1, 0.03, C.horn[1], [0, -1, 0], 0.2).lod(2));
      for (let i = 0; i < 6; i++) {
        const a = (i + 0.5) / 6 * 1.75, r = [Math.sin(a) * 0.35 * sx, Math.cos(a) * 0.32, 0];
        const c = [r[0], 0.73 + r[1] * Math.cos(30 * DEG), 0.57 - r[1] * Math.sin(30 * DEG)];
        head.hard.push(spike(c, [Math.sin(a) * sx, Math.cos(a) * 0.85, -Math.cos(a) * 0.5], 0.09, 0.03, C.horn[1], [0, 0, 1], 0.1, 0.6).lod(2));
      }
    }
    head.hard.push(...horn([[0, 0.5, 0.93], [0, 0.6, 0.97], [0, 0.69, 1.03]], 0.045, C.horn));
  }
  const jaw = N('jaw', 'head', [0, 0.4, 0.72], { rig: 'jaw', detail: 0.9 });
  jaw.prims.push(S.capsule([0, 0.37, 0.74], [0, 0.34, 0.95], 0.085, 0.045).color(C.skin).pbr(0.5).bump(0.005, 30, 'scales'));
  jaw.prims.push(S.capsule([0, 0.34, 0.95], [0, 0.34, 1.0], 0.045, 0.02).color(C.horn[1]).pbr(0.4).blend(0.01));
  const legSk = sk, ft = { kind: 'pillar', w: 0.105, toes: 3, claw: C.horn[0] };
  addLeg(N, 'FL', 'torso', 1, [[0.23, 0.5, 0.32], [0.27, 0.27, 0.3], [0.26, 0.1, 0.33], [0.26, 0, 0.33]], [0.125, 0.092, 0.085], legSk, { detail: 0.66, foot: ft });
  addLeg(N, 'FR', 'torso', -1, [[0.23, 0.5, 0.32], [0.27, 0.27, 0.3], [0.26, 0.1, 0.33], [0.26, 0, 0.33]], [0.125, 0.092, 0.085], legSk, { detail: 0.66, foot: ft });
  addLeg(N, 'BL', 'torso', 1, [[0.24, 0.52, -0.36], [0.28, 0.28, -0.3], [0.27, 0.1, -0.38], [0.27, 0, -0.36]], [0.145, 0.098, 0.088], legSk, { detail: 0.66, foot: ft });
  addLeg(N, 'BR', 'torso', -1, [[0.24, 0.52, -0.36], [0.28, 0.28, -0.3], [0.27, 0.1, -0.38], [0.27, 0, -0.36]], [0.145, 0.098, 0.088], legSk, { detail: 0.66, foot: ft });
  addChain(N, 'tail', 'torso', [[0, 0.52, -0.6], [0, 0.44, -0.84], [0, 0.35, -1.04], [0, 0.3, -1.2]], [0.17, 0.115, 0.07, 0.025], sk, { rig: 'tail', detail: 0.66,
    deco: (n, a, b, ra, rb, i, f) => n.prims.push(S.capsule(add3(a, mul3(f.dor, ra * 0.5)), add3(b, mul3(f.dor, rb * 0.5)), ra * 0.7, rb * 0.7).color(C.back).paint(0.03)) });
  const hd = o.howdah === 'bow' || o.howdah === true;
  if (hd) {
    torso.prims.push(S.torus(0.3, 0.03).rot(90, 0, 0).at(0, 0.54, 0.16).color(0x4a3220).pbr(0.7).paint(0.008, 0.008), S.torus(0.3, 0.03).rot(90, 0, 0).at(0, 0.54, -0.3).color(0x4a3220).pbr(0.7).paint(0.008, 0.008));
    bowHowdah(N, 'torso', [0, 0.87, -0.06], o, C);
  }
  return { kind: 'titan.quad', attack: 'bite', atkStyle: 'gore', rate: 5.2, stride: 0.3, lie: 0.3, nodes: finish(N.nodes) };
}

// ---------------- shieldback ----------------
function shieldback(def, o) {
  const C = saurPalette(col(o.skin, 0x6a6a4a));
  const plate = tone(C.skin, 0.0, -0.06, -0.14), boneC = 0xd8cfae;
  const sk = (q) => q.color(C.skin).bump(0.008, 19, 'scales').tint(0.16, 7).pbr(0.55, 0.02);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.36, 0], { rig: 'torso', detail: 0.68 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.4, 0.21, 0.54).at(0, 0.37, 0)));
    p.push(sk(S.ellipsoid(0.3, 0.19, 0.25).at(0, 0.37, 0.38).blend(0.07)));
    p.push(sk(S.capsule([0, 0.37, 0.5], [0, 0.36, 0.6], 0.15, 0.13).blend(0.05)));
    p.push(sk(S.capsule([0, 0.37, -0.42], [0, 0.36, -0.56], 0.18, 0.13).blend(0.06)));
    p.push(S.ellipsoid(0.3, 0.1, 0.5).at(0, 0.17, 0).color(C.belly).paint(0.05));
    // the shell: bands of armour with keeled scutes, and spikes along the flanks
    p.push(S.ellipsoid(0.39, 0.2, 0.6).at(0, 0.44, -0.02).color(plate).paint(0.03, 0.006));
    const rows = 7;
    for (let i = 0; i < rows; i++) {
      const z = 0.42 - i * 0.14, hw = 0.4 * Math.sqrt(Math.max(0.1, 1 - Math.pow((z + 0.0) / 0.6, 2)));
      p.push(S.box(1, 0.5, 0.014, 0.002).at(0, 0.5, z + 0.07).color(C.deep).paint(0.004, -0.008));
      const n = Math.max(2, Math.round(hw / 0.085));
      for (let j = 0; j < n; j++) {
        const x = (j + 0.5) / n * hw * 0.92, y = 0.37 + 0.215 * Math.sqrt(Math.max(0.02, 1 - Math.pow(x / 0.4, 2) - Math.pow(z / 0.56, 2)));
        const q = S.ellipsoid(0.036, 0.03, 0.05).rot(0, 0, -x * 110).at(x, y, z).color(j % 2 ? boneC : tone(boneC, 0, 0, -0.1)).pbr(0.45).blend(0.008);
        p.push(q, q.mirrorX());
      }
      const xe = hw * 0.97, ye = 0.4;
      for (const sx of [1, -1]) torso.hard.push(spike([sx * xe, ye, z], [sx, 0.12, -0.15], 0.13 + 0.05 * Math.sin((i / (rows - 1)) * Math.PI), 0.045, boneC, [0, 0, -1], 0.15, 0.7).shade((x, y) => (y < 0.25 ? rgb(plate) : null)).lod(2));
    }
  }
  const HP = [0, 0.36, 0.56];
  const head = N('head', 'torso', HP, { rig: 'head', detail: 1.0 });
  {
    const p = head.prims, bare = (q) => q.color(C.skin).tint(0.14, 14).pbr(0.5).bump(0.005, 30, 'scales');
    p.push(bare(S.ellipsoid(0.135, 0.09, 0.15).at(0, 0.33, 0.69)));
    p.push(bare(S.capsule([0, 0.31, 0.76], [0, 0.28, 0.87], 0.085, 0.06).blend(0.03)));
    p.push(S.capsule([0, 0.28, 0.87], [0, 0.25, 0.905], 0.058, 0.03).color(C.horn[1]).pbr(0.4).blend(0.01));
    p.push(S.ellipsoid(0.12, 0.04, 0.14).at(0, 0.385, 0.68).color(plate).paint(0.012, 0.006));
    for (const [x, z] of [[0, 0.7], [0.06, 0.64], [0.055, 0.76], [0, 0.8]]) { const q = S.ellipsoid(0.035, 0.016, 0.04).at(x, 0.412 - Math.abs(z - 0.69) * 0.18 - x * 0.2, z).color(boneC).pbr(0.45).blend(0.006); p.push(q); if (x) p.push(q.mirrorX()); }
    p.push(...S.mirrorX([S.sphere(0.022).at(0.105, 0.34, 0.76).color(C.deep).cut(0.008)]));
    for (const sx of [1, -1]) {
      head.hard.push(eyeAt([0.102 * sx, 0.34, 0.76], [sx, 0.1, 0.35], 0.018, C.eye));
      head.hard.push(spike([0.1 * sx, 0.39, 0.6], [sx * 0.8, 0.5, -0.5], 0.11, 0.035, boneC, [0, 0, -1], 0.15).lod(2));
      head.hard.push(spike([0.125 * sx, 0.3, 0.62], [sx, -0.3, -0.3], 0.09, 0.03, boneC, [0, 0, -1], 0.15).lod(2));
    }
  }
  const jaw = N('jaw', 'head', [0, 0.29, 0.66], { rig: 'jaw', detail: 0.9 });
  jaw.prims.push(S.capsule([0, 0.265, 0.68], [0, 0.245, 0.86], 0.07, 0.035).color(C.skin).pbr(0.5).bump(0.005, 30, 'scales'));
  const ft = { kind: 'pillar', w: 0.088, toes: 4, claw: C.horn[0] };
  const fl = [[0.29, 0.32, 0.3], [0.37, 0.18, 0.3], [0.36, 0.08, 0.32], [0.36, 0, 0.32]], bl = [[0.3, 0.34, -0.32], [0.38, 0.19, -0.28], [0.37, 0.08, -0.34], [0.37, 0, -0.33]];
  addLeg(N, 'FL', 'torso', 1, fl, [0.1, 0.08, 0.074], sk, { detail: 0.7, foot: ft }); addLeg(N, 'FR', 'torso', -1, fl, [0.1, 0.08, 0.074], sk, { detail: 0.7, foot: ft });
  addLeg(N, 'BL', 'torso', 1, bl, [0.115, 0.085, 0.076], sk, { detail: 0.7, foot: ft }); addLeg(N, 'BR', 'torso', -1, bl, [0.115, 0.085, 0.076], sk, { detail: 0.7, foot: ft });
  const TL = [[0, 0.36, -0.54], [0, 0.33, -0.76], [0, 0.3, -0.96], [0, 0.29, -1.14], [0, 0.29, -1.3]];
  const tn = addChain(N, 'tail', 'torso', TL, [0.13, 0.095, 0.07, 0.055, 0.05], sk, { rig: 'tail', detail: 0.7, deco: (n, a, b, ra, rb, i, f) => {
    n.prims.push(S.capsule(add3(a, mul3(f.dor, ra * 0.45)), add3(b, mul3(f.dor, rb * 0.45)), ra * 0.75, rb * 0.75).color(plate).paint(0.02, 0.004));
    for (const sx of [1, -1]) n.hard.push(spike(add3(lerp3(a, b, 0.4), [sx * ra * 0.8, 0.01, 0]), [sx, 0.1, -0.3], 0.07 - i * 0.008, 0.025, boneC, [0, 0, -1], 0.15, 0.7).lod(1));
  } });
  const club = tn[tn.length - 1];
  club.prims.push(...S.mirrorX([S.ellipsoid(0.1, 0.07, 0.11).at(0.07, 0.29, -1.36).color(boneC).pbr(0.45).bump(0.006, 20, 'rock').tint(0.12, 14).blend(0.02)]));
  club.prims.push(S.ellipsoid(0.07, 0.06, 0.07).at(0, 0.29, -1.45).color(tone(boneC, 0, 0, -0.08)).pbr(0.45).bump(0.006, 20, 'rock').blend(0.02));
  const mirror = o.howdah === 'mirror';
  if (mirror) mirrorHowdah(N, 'torso', [0, 0.6, -0.04], o, C);
  return { kind: 'titan.quad', attack: mirror ? 'cast' : 'slam', atkStyle: mirror ? 'cast' : 'tail', rate: 5, stride: 0.26, lie: 0.3, nodes: finish(N.nodes) };
}

// ---------------- pterosaur ----------------
function pterosaur(def, o) {
  const skin = col(o.skin, 0x8a5a3a), crest = col(o.trim, tone(skin, -0.04, 0.3, 0.08));
  const C = { skin, back: tone(skin, 0, 0, -0.1), belly: mix(skin, 0xe8dcc0, 0.6), beak: mix(skin, 0xe6c88a, 0.75), claw: 0x1c1814,
    wing: { wingA: tone(skin, 0.01, 0, -0.1), wingB: mix(tone(skin, -0.03, 0.1, 0.14), 0xe2b26a, 0.45), bone: tone(skin, 0, 0, -0.06), claw: 0x1c1814 } };
  const fur = (q) => q.color(C.skin).bump(0.005, 40, 'fur').tint(0.15, 14).pbr(0.7);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.36, -0.1], { rig: 'torso', detail: 0.95 });
  torso.prims.push(fur(S.ellipsoid(0.13, 0.125, 0.28).at(0, 0.4, 0.03)));
  torso.prims.push(fur(S.ellipsoid(0.115, 0.12, 0.14).at(0, 0.385, 0.17).blend(0.05)).color(C.belly));
  torso.prims.push(fur(S.capsule([0, 0.42, 0.2], [0, 0.45, 0.3], 0.09, 0.07).blend(0.04)));
  torso.prims.push(...S.mirrorX([fur(S.ellipsoid(0.06, 0.06, 0.1).at(0.09, 0.44, 0.15).blend(0.03))]));
  torso.prims.push(S.ellipsoid(0.08, 0.06, 0.3).at(0, 0.5, 0).color(C.back).paint(0.04));
  const NP = [[0, 0.44, 0.27], [0, 0.535, 0.42], [0, 0.585, 0.57]];
  addChain(N, 'neck', 'torso', NP, [0.07, 0.056, 0.05], fur, { rig: (i) => (i === 0 ? 'neck' : 'necks'), detail: 1.0 });
  const head = N('head', 'neck1', [0, 0, 0], { rig: 'head', pos: sub3(NP[2], NP[1]), rot: [22, 0, 0], detail: 1.4 });
  {
    const p = head.prims, bk = (q) => q.color(C.beak).pbr(0.4).tint(0.1, 24);
    p.push(fur(S.ellipsoid(0.058, 0.056, 0.085).at(0, 0.005, 0.02)));
    p.push(bk(S.capsule([0, 0.0, 0.07], [0, -0.03, 0.56], 0.045, 0.007).blend(0.012)));
    p.push(bk(S.ellipsoid(0.022, 0.03, 0.2).at(0, 0.018, 0.2).blend(0.02)));
    p.push(S.ellipsoid(0.014, 0.075, 0.24).rot(24, 0, 0).at(0, 0.085, -0.14).color(crest).pbr(0.5).blend(0.02));
    p.push(S.ellipsoid(0.02, 0.03, 0.2).rot(24, 0, 0).at(0, 0.115, -0.2).color(tone(crest, 0, 0, -0.22)).paint(0.01));
    p.push(S.ellipsoid(0.03, 0.02, 0.2).at(0, 0.02, 0.4).color(tone(crest, 0, 0, -0.05)).paint(0.015));
    for (const sx of [1, -1]) head.hard.push(eyeAt([0.05 * sx, 0.012, 0.055], [sx, 0.1, 0.3], 0.015, { iris: 0xf0c030, rim: 0x5a2a08, slit: false }));
  }
  const HG = [0, -0.03, 0.03];
  const jaw = N('jaw', 'head', HG, { rig: 'jaw', pos: HG, detail: 1.3, minRes: 60 });
  jaw.prims.push(S.capsule([0, -0.035, 0.05], [0, -0.045, 0.5], 0.028, 0.006).color(C.beak).pbr(0.4));
  jaw.prims.push(S.ellipsoid(0.03, 0.035, 0.09).at(0, -0.055, 0.1).color(C.belly).pbr(0.6).blend(0.02));
  for (const sx of [1, -1]) addLeg(N, sx > 0 ? 'L' : 'R', 'torso', sx, [[0.07, 0.35, -0.2], [0.09, 0.2, -0.13], [0.09, 0.05, -0.19], [0.09, 0, -0.18]], [0.045, 0.024, 0.016], fur,
    { detail: 1.1, minRes: 70, foot: { kind: 'claw', len: 0.09, w: 0.022, toes: 3, clawLen: 0.035, claw: C.claw } });
  const tail = N('tail', 'torso', [0, 0.4, -0.24], { rig: 'tail' });
  tail.prims.push(fur(S.capsule([0, 0.4, -0.22], [0, 0.39, -0.4], 0.05, 0.012)));
  const G = { Sh: [0.1, 0.46, 0.15], E: [0.36, 0.52, 0.06], W: [0.62, 0.49, 0.24], tips: [[1.34, 0.46, -0.12]], hip: [0.07, 0.38, -0.34] };
  addWings(N, 'torso', G, () => {
    const w = batWing(G, C.wing, { k: 0.85 });
    for (let i = 0; i < 3; i++) w.arm.hard.push(spike(add3(G.W, [0.0, 0.0, 0.02]), [0.3 - i * 0.3, -0.1, 1], 0.06, 0.008, C.claw, [0, -1, 0], 0.4).lod(1));
    return w;
  }, 0.9);
  if (o.rider) addCrew(N, 'r_', 'torso', [0, 0.47, 0.02], clamp(0.75 / num(o.scale, 1.2), 0.35, 0.7), 'lizard', { skin: col(o.crew, 0x3a9a7a), cloth: col(o.cloth, 0xa8342a), metal: 0xd8b03a }, { pose: 'sit', arms: [0.8, 0.8] });
  return { kind: 'titan.bird', variant: 'ptero', attack: 'bite', rate: 6.6, perch: 0.3, nodes: finish(N.nodes) };
}

// =====================================================================================
const guard = (fn) => (def, o) => fn(def || {}, o && typeof o === 'object' ? o : {});
const ALL = { bird, saurian };
const ANIM = { 'titan.bird': birdAnim, 'titan.vulture': vultureAnim, 'titan.tyrant': tyrantAnim, 'titan.quad': quadAnim };
export const bodies = Object.fromEntries(Object.entries(ALL).map(([k, f]) => [k, guard(f)]));
export const animators = ANIM;
