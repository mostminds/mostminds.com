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

/** scale a finished-in-world-space node list about the origin */
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
  finger.forEach((f, fi) => {
    if (opt.ghost && opt.ghost.includes(fi)) return;        // an edge of skin with no bone in it
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
  const sk = (q) => q.color(C.bone ?? C.a).bump(0.006, 34, 'fur').tint(0.14, 18).pbr(0.7);
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
  const hipY = sit ? 0.12 : 0.47, det = opt.detail ?? 1, mr = Math.min(40, 0.45 / (0.03 * s));
  const body = N(`${p}body`, parent, Q(0, hipY, 0), { rig: 'crew', detail: det, minRes: mr });
  const r = boneish ? 0.55 : 1;
  // limbs are plain tubes: they stay whole at any distance and cost next to nothing
  const limb = (n, a, b, c, ra, rb, rc, lod) => { const h = H.tube([a, b, c], [ra * s * r, rb * s * r, rc * s * r], 6, 6).color(skin).pbr(boneish ? 0.55 : 0.6); n.hard.push(lod == null ? h : h.lod(lod)); if (boneish) n.hard.push(H.sphere(rb * s * 0.8, 6).at(...b).color(skin).pbr(0.55).lod(1)); };
  for (const sx of [1, -1]) {
    if (sit) limb(body, Q(0.07 * sx, hipY, 0), Q(0.16 * sx, hipY - 0.05, 0.2), Q(0.18 * sx, hipY - 0.3, 0.12), 0.055, 0.045, 0.03);
    else {
      limb(body, Q(0.07 * sx, hipY, 0), Q(0.085 * sx, 0.24, 0.02), Q(0.085 * sx, 0.03, 0), 0.055, 0.042, 0.03);
      body.hard.push(H.sphere(0.04 * s, 8).scale(1, 0.6, 1.7).at(...Q(0.085 * sx, 0.025, 0.035)).color(boneish ? skin : 0x3a2a1c).pbr(0.6));
    }
  }
  if (boneish) {
    body.prims.push(sk(S.capsule(Q(0, hipY, 0), Q(0, hipY + 0.34, 0), 0.022 * s, 0.02 * s)));
    body.prims.push(sk(S.ellipsoid(0.085 * s, 0.045 * s, 0.05 * s).at(...Q(0, hipY, 0)).blend(0.01)));
    for (let i = 0; i < 4; i++) body.prims.push(sk(S.torus((0.085 - i * 0.008) * s, 0.012 * s).scale(1).at(...Q(0, hipY + 0.33 - i * 0.045, 0.01)).blend(0.004)));
    body.prims.push(sk(S.capsule(Q(-0.11, hipY + 0.36, 0), Q(0.11, hipY + 0.36, 0), 0.02 * s, 0.02 * s).blend(0.005)));
    body.prims.push(S.box(0.2 * s, 0.07 * s, 0.11 * s, 0.01).at(...Q(0, hipY + 0.02, 0)).color(cloth).blend(0.004));
    body.prims.push(S.torus(0.045 * s, 0.022 * s).at(...Q(0, hipY + 0.4, 0)).color(metal).pbr(0.35, 0.9).blend(0.003));
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
    limb(a, Sp, El, Hd, 0.036, 0.03, 0.024);
    a.hard.push(H.sphere(0.03 * s * (boneish ? 0.8 : 1), 8).at(...Hd).color(skin).pbr(0.6));
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
    : phoenix ? { beak: 0.11, hook: 0.02, beakR: 0.8, neck: 0.16, tail: 0.3, span: 0.9 }
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
      const f = (i - 2) / 2, len = 0.8 - Math.abs(f) * 0.18, a = f * 0.3;
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
  const { R, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk, fly = !!c.flying;
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
      st.hard.push(H.cyl(0.016, 0.02, 1.2, 8).at(g[0], 0.61, g[2]).color(0x2a2030).pbr(0.6));
      for (const y of [0.3, 0.9, 1.14]) st.hard.push(H.torus(0.022, 0.008, 10, 5).rot(90, 0, 0).at(g[0], y, g[2]).color(gold).pbr(0.35, 0.9).lod(2));
      // head of the staff: a crescent cradling a burning eye
      st.hard.push(H.torus(0.085, 0.015, 16, 6, Math.PI * 1.25).rot(0, 0, -112).at(g[0], 1.31, g[2]).color(gold).pbr(0.35, 0.9));
      st.hard.push(H.sphere(0.048, 14).at(g[0], 1.31, g[2]).color(glow).glow(1.8));
      st.hard.push(H.sphere(0.018, 8).scale(0.5, 1.6, 1).at(g[0], 1.31, g[2] + 0.04).color(0x100818).lod(1));
      for (let i = 0; i < 3; i++) st.hard.push(feather([g[0], 1.2, g[2]], [(i - 1) * 0.5, -1, -0.3], 0.2, 0.025, [rgb(base), rgb(glow)], [0, 0, 1], 1).lod(2));
    }
  }
  // great iridescent wings
  const G = { Sh: [0.1, 0.98, -0.1], E: [0.33, 1.16, -0.18], W: [0.56, 1.1, -0.1], T: [0.88, 0.99, -0.18] };
  const WC = { bone: base, a: base, b: tone(base, 0.12, 0.05, -0.04), tip: glow, covert: tone(base, -0.1, 0.05, 0.06), shape: 0, band: true };
  addWings(N, 'torso', G, () => {
    const w = featherWing(G, WC, { len: 0.4, n: [9, 9], r: 0.045 });
    // eye-spots near the tips of the long feathers
    w.pri.ends.forEach((e, i) => { if (i % 2 === 0) w.tip.hard.push(H.sphere(0.022, 8).scale(1, 0.25, 1.5).at(e[0] * 0.97, e[1] + 0.012, e[2] + 0.05).color(glow).glow(1.2).lod(1)); });
    w.sec.ends.forEach((e, i) => { if (i % 3 === 1) w.arm.hard.push(H.sphere(0.02, 8).scale(1, 0.25, 1.5).at(e[0], e[1] + 0.012, e[2] + 0.05).color(glow).glow(1.2).lod(1)); });
    return w;
  }, 0.85);
  return { kind: 'titan.vulture', attack: 'cast', staffed: staffOn, nodes: finish(N.nodes) };
}

function vultureAnim(rig, inner, c, base) {
  const { R, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk, fly = !!c.flying;
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
const crewSize = (o, dflt) => clamp(0.95 / num(o.scale, dflt), 0.3, 0.75) / 0.9;

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
  scaleNodes(N.nodes, 0.78);
  return { kind: 'titan.tyrant', attack: 'bite', u: 0.78, nodes: finish(N.nodes) };
}

function tyrantAnim(rig, inner, c, base) {
  const { R, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk;
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
  tu.hard.push(P(H.lathe([[0, 0], [0.1, 0.006], [0.2, 0.024], [0.28, 0.05], [R0, 0.075], [R0 + 0.01, 0.07], [0.28, 0.035], [0.15, -0.01], [0, -0.02]], 28).color(0xfff3c4).pbr(0.25, 0.55).glow(0.3).shade((x, y, z) => (Math.hypot(x, z) > R0 - 0.03 ? rgb(gold) : y < 0 ? rgb(goldD) : null))));
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
  const { R, P, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk;
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
  (rig.bolt || []).forEach((b) => { P(b, 0, 0, (rig.u || 1) * (a >= 0 ? keys(a, [[0, 0], [0.3, -0.12], [0.36, 0.5], [0.4, 2.5], [0.45, 0], [1, 0]]) : 0)); b.visible = !(a > 0.38 && a < 0.8); });
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
    p.push(...S.mirrorX([S.ellipsoid(0.05, 0.16, 0.03).rot(-30, 0, -22).at(0.1, 0.82, 0.55).color(frillB).paint(0.012, -0.003), S.ellipsoid(0.045, 0.13, 0.03).rot(-30, 0, -58).at(0.22, 0.76, 0.56).color(frillB).paint(0.012, -0.003), S.ellipsoid(0.36, 0.33, 0.02).rot(-30, 0, 0).at(0, 0.73, 0.6).color(tone(frillA, 0, 0, -0.08)).paint(0.01)]));
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
  scaleNodes(N.nodes, 0.9);
  return { kind: 'titan.quad', attack: 'bite', atkStyle: 'gore', rate: 5.2, stride: 0.3, lie: 0.3, u: 0.9, nodes: finish(N.nodes) };
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
  scaleNodes(N.nodes, 0.9);
  return { kind: 'titan.quad', attack: mirror ? 'cast' : 'slam', atkStyle: mirror ? 'cast' : 'tail', rate: 5, stride: 0.26, lie: 0.3, u: 0.9, nodes: finish(N.nodes) };
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
  const G = { Sh: [0.1, 0.46, 0.15], E: [0.36, 0.52, 0.06], W: [0.62, 0.49, 0.24], tips: [[1.34, 0.46, -0.12], [0.52, 0.43, -0.4]], hip: [0.07, 0.38, -0.34] };
  addWings(N, 'torso', G, () => {
    const w = batWing(G, C.wing, { k: 0.85, ghost: [1] });
    for (let i = 0; i < 3; i++) w.arm.hard.push(spike(add3(G.W, [0.0, 0.0, 0.02]), [0.3 - i * 0.3, -0.1, 1], 0.06, 0.008, C.claw, [0, -1, 0], 0.4).lod(1));
    return w;
  }, 0.9);
  if (o.rider) addCrew(N, 'r_', 'torso', [0, 0.47, 0.02], clamp(0.75 / num(o.scale, 1.2), 0.35, 0.7), 'lizard', { skin: col(o.crew, 0x3a9a7a), cloth: col(o.cloth, 0xa8342a), metal: 0xd8b03a }, { pose: 'sit', arms: [0.8, 0.8] });
  return { kind: 'titan.bird', variant: 'ptero', attack: 'bite', rate: 6.6, perch: 0.3, nodes: finish(N.nodes) };
}

// =====================================================================================
//  HYDRA: many heads on serpent necks; wings: a many-headed dragon; flesh: a stitched abomination
// =====================================================================================
// rig: torso, legs[4], shins[4], tail[], nk0[], nk1[], ... (one list of neck segments per head), heads[], jaws[], wings, wingtips

function hydraHead(N, name, parent, pos, rot, C, flesh, k, rnd, idx) {
  const head = N(name, parent, [0, 0, 0], { rig: 'hd', pos, rot, detail: 0.95 });
  const jaw = N(`${name}j`, name, [0, -0.03 * k, 0.0], { rig: 'jw', pos: [0, -0.03 * k, 0.0], detail: 0.9 });
  const p = head.prims, jp = jaw.prims;
  const V = (x, y, z) => [x * k, y * k, z * k];
  if (!flesh) {
    const sk = (q) => q.color(C.skin).bump(0.005, 32, 'scales').tint(0.14, 16).pbr(0.48, 0.04);
    p.push(sk(S.ellipsoid(0.085 * k, 0.07 * k, 0.1 * k).at(...V(0, 0.012, 0.03))));
    p.push(sk(S.capsule(V(0, 0.005, 0.08), V(0, -0.012, 0.3), 0.062 * k, 0.04 * k).blend(0.04)));
    p.push(...S.mirrorX([
      sk(S.capsule(V(0.03, 0.05, 0.15), V(0.075, 0.062, 0.0), 0.016 * k, 0.026 * k).blend(0.015)).color(C.deep),
      sk(S.ellipsoid(0.035 * k, 0.045 * k, 0.055 * k).at(...V(0.062, -0.018, 0.02)).blend(0.03)),
      sk(S.ellipsoid(0.016 * k, 0.013 * k, 0.02 * k).at(...V(0.02, 0.012, 0.3)).blend(0.01)),
      S.sphere(0.022 * k).at(...V(0.066, 0.03, 0.105)).color(C.deep).cut(0.006),
    ]));
    p.push(S.ellipsoid(0.05 * k, 0.04 * k, 0.2 * k).at(...V(0, 0.06, 0.1)).color(C.back).paint(0.03));
    p.push(S.box(0.1 * k, 0.03 * k, 0.24 * k, 0.006).at(...V(0, -0.062, 0.19)).color(C.mouth).paint(0.008));
    for (const sx of [1, -1]) {
      head.hard.push(eyeAt(V(0.064 * sx, 0.03, 0.106), [sx, 0.2, 0.4], 0.017 * k, C.eye));
      head.hard.push(...horn([V(0.05 * sx, 0.055, -0.03), V(0.075 * sx, 0.1, -0.14), V(0.07 * sx, 0.12, -0.26)], 0.024 * k, C.horn, { rings: 10 }));
      head.hard.push(spike(V(0.08 * sx, -0.01, -0.02), [sx, -0.1, -0.7], 0.08 * k, 0.02 * k, C.horn[1], [0, 0, -1], 0.2, 0.5).lod(1));
      for (let i = 0; i < 6; i++) { const f = i / 5; head.hard.push(spike(V(lerp(0.055, 0.03, f) * sx, -0.045, lerp(0.1, 0.31, f)), [sx * 0.1, -1, 0.05], (0.03 + 0.016 * Math.sin(f * 8 + 1)) * k, 0.008 * k, C.tooth, [0, 0, -1], 0.25).lod(i % 2 ? 1 : 2)); }
    }
    jp.push(sk(S.capsule(V(0, -0.055, 0.02), V(0, -0.065, 0.28), 0.045 * k, 0.03 * k)));
    jp.push(S.ellipsoid(0.04 * k, 0.03 * k, 0.13 * k).at(...V(0, -0.085, 0.14)).color(C.belly).paint(0.02));
    jp.push(S.ellipsoid(0.026 * k, 0.012 * k, 0.1 * k).at(...V(0, -0.04, 0.16)).color(C.tongue).pbr(0.35).blend(0.008));
    for (const sx of [1, -1]) for (let i = 0; i < 4; i++) { const f = i / 3; jaw.hard.push(spike(V(lerp(0.04, 0.022, f) * sx, -0.045, lerp(0.12, 0.29, f)), [sx * 0.1, 1, 0.05], 0.028 * k, 0.007 * k, C.tooth, [0, 0, -1], 0.2).lod(1)); }
  } else {
    // a rat's head: pointed snout, round naked ears, chisel teeth
    const furC = [0x6a5a4a, 0x8a7a6a, 0x4a4038, 0x9a8a80][idx % 4];
    const fur = (q) => q.color(furC).bump(0.006, 36, 'fur').tint(0.2, 14).pbr(0.75);
    const pink = (q) => q.color(C.skin).tint(0.2, 18).pbr(0.5);
    p.push(fur(S.ellipsoid(0.08 * k, 0.075 * k, 0.095 * k).at(...V(0, 0.01, 0.02))));
    p.push(fur(S.capsule(V(0, 0.0, 0.07), V(0, -0.02, 0.27), 0.058 * k, 0.026 * k).blend(0.04)));
    p.push(pink(S.sphere(0.022 * k).at(...V(0, -0.012, 0.295)).blend(0.01)));
    p.push(...S.mirrorX([
      pink(S.ellipsoid(0.05 * k, 0.055 * k, 0.012 * k).rot(0, 25, -20).at(...V(0.075, 0.08, -0.03)).blend(0.01)),
      S.ellipsoid(0.03 * k, 0.035 * k, 0.012 * k).rot(0, 25, -20).at(...V(0.078, 0.08, -0.022)).color(tone(C.skin, 0, 0, -0.12)).paint(0.006, -0.003),
      S.sphere(0.02 * k).at(...V(0.058, 0.03, 0.1)).color(0x1a0c0c).cut(0.005),
    ]));
    if (idx % 2) p.push(S.box(0.2 * k, 0.012, 0.012, 0.002).rot(0, 20, 30).at(...V(0, 0.05, 0.08)).color(C.suture).paint(0.003, -0.005));
    for (const sx of [1, -1]) {
      head.hard.push(glowEye(V(0.056 * sx, 0.03, 0.1), 0.015 * k, 0xff3a2a, 1.3));
      head.hard.push(H.box(0.014 * k, 0.055 * k, 0.01 * k, 0.002).at(...V(0.009 * sx, -0.055, 0.275)).color(0xe8d08a).pbr(0.4));
      for (let i = 0; i < 3; i++) head.hard.push(H.tube([V(0.025 * sx, -0.01, 0.26), V(0.09 * sx, 0.0 + (i - 1) * 0.03, 0.27), V(0.15 * sx, -0.01 + (i - 1) * 0.06, 0.25)], 0.0025, 4, 3).color(0xd8d0c0).lod(0));
    }
    jp.push(fur(S.capsule(V(0, -0.05, 0.02), V(0, -0.06, 0.22), 0.04 * k, 0.02 * k)));
    jp.push(S.ellipsoid(0.022 * k, 0.01 * k, 0.08 * k).at(...V(0, -0.038, 0.13)).color(C.tongue).pbr(0.35).blend(0.008));
    for (const sx of [1, -1]) jaw.hard.push(H.box(0.012 * k, 0.04 * k, 0.009 * k, 0.002).at(...V(0.008 * sx, -0.03, 0.225)).color(0xe8d08a).pbr(0.4).lod(2));
  }
}

function hydra(def, o = {}) {
  const flesh = !!o.flesh, winged = !!o.wings;
  const n = Math.round(clamp(num(o.heads, 5), 1, 9));
  const base = col(o.scales, flesh ? 0x8a6a6a : 0x2a4a3a);
  const rnd = rng(hashStr(def?.id || 'hydra') + n);
  const C = flesh
    ? { skin: mix(base, 0xd8a09a, 0.45), back: tone(base, 0, 0, -0.08), deep: tone(base, 0.95, 0.1, -0.2), belly: mix(base, 0xe0c8b8, 0.6), suture: 0x3a1418, tongue: 0xc05058, mouth: 0x5a1420, claw: 0x2a2420, horn: [0x4a4034, 0xcbbd98, 0xefe6cc], tooth: 0xe8d08a }
    : { skin: base, back: tone(base, 0.02, 0.03, -0.1), deep: tone(base, 0.04, 0, -0.17), belly: mix(base, 0xdccf8c, 0.72), tongue: 0xd0605a, mouth: 0x5a1420, claw: 0x1c1814,
      horn: [tone(base, 0, -0.1, -0.1), 0xcbbd98, 0xefe6cc], tooth: 0xf1e9cc, eye: { iris: 0xffb414, rim: 0xc23a08, white: 0x1c0c0a, glow: 0.45 },
      wing: { wingA: tone(base, 0.0, 0.0, -0.1), wingB: mix(tone(base, 0.04, 0.1, 0.1), 0xd8642a, 0.4), bone: tone(base, 0.02, 0, -0.1), claw: 0x1c1814 } };
  const sk = flesh
    ? (q) => q.color(C.skin).bump(0.012, 10, 'noise').tint(0.28, 7).pbr(0.42)
    : (q) => q.color(C.skin).bump(0.009, 20, 'scales').tint(0.16, 8).pbr(0.46, 0.05);
  const det = n > 5 ? 0.54 : 0.58;
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.5, 0], { rig: 'torso', detail: det });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.29, 0.27, 0.42).at(0, 0.5, 0.0)));
    p.push(sk(S.ellipsoid(0.27, 0.27, 0.24).at(0, 0.55, 0.26).blend(0.08)));
    p.push(sk(S.ellipsoid(0.25, 0.24, 0.24).at(0, 0.5, -0.32).blend(0.07)));
    p.push(sk(S.capsule([0, 0.5, -0.44], [0, 0.48, -0.58], 0.2, 0.17).blend(0.06)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.12, 0.15, 0.15).at(0.22, 0.5, 0.3).blend(0.04)), sk(S.ellipsoid(0.12, 0.15, 0.16).at(0.22, 0.5, -0.32).blend(0.04))]));
    p.push(S.ellipsoid(0.2, 0.12, 0.4).at(0, 0.24, 0.02).color(C.belly).paint(0.06));
    if (!flesh) {
      p.push(S.ellipsoid(0.18, 0.12, 0.7).at(0, 0.76, -0.05).color(C.back).paint(0.07));
      for (let i = 0; i < 7; i++) p.push(...S.mirrorX([S.ellipsoid(0.17, 0.22, 0.016).rot(-10, 0, -32).at(0.13, 0.7, 0.3 - i * 0.13).color(C.deep).paint(0.016)]));
      for (let i = 0; i < 8; i++) { const z = 0.2 - i * 0.1, h = 0.11 * (0.7 + 0.5 * Math.sin((i / 7) * Math.PI)); torso.hard.push(spike([0, 0.74 + 0.03 * Math.sin((i / 7) * Math.PI), z], [0, 1, -0.5], h, h * 0.3, C.horn[0], [0, -0.3, -1], 0.35, 0.4).shade((x, y) => (y > 0.5 ? rgb(C.horn[1]) : null)).lod(i % 2 ? 1 : 2)); }
    } else {
      // bloated: tumours, a split belly held with staples, patches of other creatures' hide
      for (let i = 0; i < 9; i++) { const a = rnd() * 6.283, z = (rnd() - 0.5) * 0.8, r = 0.05 + rnd() * 0.06; p.push(sk(S.sphere(r).at(Math.sin(a) * 0.26, 0.5 + Math.cos(a) * 0.22, z).blend(0.03)).color(i % 3 ? C.skin : tone(C.skin, 0.03, 0.1, -0.1))); }
      p.push(sk(S.ellipsoid(0.2, 0.18, 0.22).at(-0.08, 0.34, 0.05).blend(0.06)).color(mix(C.skin, 0xc8c090, 0.4)));
      p.push(S.ellipsoid(0.16, 0.14, 0.2).at(0.16, 0.66, -0.1).color(0x6a5a4a).bump(0.006, 34, 'fur').paint(0.02));
      p.push(S.ellipsoid(0.14, 0.14, 0.18).at(-0.2, 0.56, 0.22).color(0x7a8a6a).paint(0.02));
      const seams = [[[0, 0.78, 0.05], [0, 0, 28], 0.5], [[0.2, 0.6, -0.1], [0, 90, 60], 0.5], [[-0.24, 0.45, 0.15], [0, 90, -70], 0.45], [[0, 0.62, -0.42], [0, 0, 90], 0.45], [[0.02, 0.3, 0.3], [0, 60, 0], 0.4]];
      for (const [c, r, L] of seams) {
        p.push(S.box(L, 0.016, 0.3, 0.003).rot(r[0], r[1], r[2]).at(c[0], c[1], c[2]).color(C.suture).paint(0.003, -0.008));
      }
      // staples along the spine seam
      for (let i = 0; i < 8; i++) torso.hard.push(H.box(0.07, 0.012, 0.012, 0.002).rot(0, 20, 28).at((i - 3.5) * 0.05, 0.79 - Math.pow((i - 3.5) * 0.05, 2) * 1.3 + (i - 3.5) * 0.026, 0.05).color(0x8a8a8a).pbr(0.4, 0.8).lod(1));
      for (let i = 0; i < 4; i++) torso.hard.push(spike([(i - 1.5) * 0.09, 0.74, -0.25 + (i % 2) * 0.1], [(i - 1.5) * 0.3, 1, -0.3], 0.12, 0.022, 0xd8d0b8, [0, 0, -1], 0.3).lod(2));  // ribs breaking the skin
    }
  }
  // legs: sprawling; the abomination's are a mismatched set
  const L4 = [['FL', 1, true], ['FR', -1, true], ['BL', 1, false], ['BR', -1, false]];
  const mis = [{ k: 1.3, c: 0xa8b09a }, { k: 0.82, c: 0xd8a09a }, { k: 1.0, c: 0x6a5a4a, fur: true }, { k: 1.15, c: 0x8a8aa8 }];
  L4.forEach(([nm, sx, fr], i) => {
    const m = flesh ? mis[i] : { k: 1 };
    const lsk = flesh ? (q) => (m.fur ? q.color(m.c).bump(0.008, 30, 'fur').tint(0.2, 12).pbr(0.75) : q.color(m.c).bump(0.01, 12, 'noise').tint(0.25, 8).pbr(0.45)) : sk;
    const pts = fr ? [[0.24, 0.48, 0.3], [0.42, 0.3, 0.36], [0.42, 0.1, 0.32], [0.42, 0, 0.34]] : [[0.24, 0.5, -0.34], [0.42, 0.31, -0.26], [0.42, 0.1, -0.36], [0.42, 0, -0.33]];
    const lg = addLeg(N, nm, 'torso', sx, pts, [0.115 * m.k, 0.078 * m.k, 0.056 * m.k], lsk, { detail: det, foot: { kind: 'claw', len: 0.17 * m.k, w: 0.065 * m.k, toes: flesh && i === 1 ? 2 : 3, clawLen: 0.075 * m.k, claw: C.claw, spread: 0.5 } });
    if (flesh) lg.up.prims.push(S.torus(0.115 * m.k, 0.014).rot(0, 0, sx * -50).at(...lerp3(lg.J, lg.K, 0.12)).color(C.suture).paint(0.003, -0.006));
  });
  // tail
  const TL = [[0, 0.48, -0.56], [0, 0.42, -0.8], [0, 0.33, -1.02], [0, 0.25, -1.22], [0, 0.2, -1.4], [0, 0.2, -1.56]];
  const tsk = flesh ? (q) => q.color(mix(C.skin, 0xe0a8a0, 0.5)).bump(0.006, 24, 'ridges').tint(0.15, 12).pbr(0.45) : sk;
  addChain(N, 'tail', 'torso', TL, (flesh ? [0.15, 0.1, 0.07, 0.05, 0.035, 0.014] : [0.17, 0.125, 0.09, 0.065, 0.042, 0.015]), tsk, { rig: 'tail', detail: det, deco: flesh ? null : (nd, a, b, ra, rb, i, f) => {
    nd.prims.push(S.capsule(add3(a, mul3(f.dor, ra * 0.5)), add3(b, mul3(f.dor, rb * 0.5)), ra * 0.7, rb * 0.7).color(C.back).paint(0.03));
    for (let k = 0; k < 2; k++) { const c = lerp3(a, b, (k + 0.3) / 2), r = lerp(ra, rb, (k + 0.3) / 2), h = 0.1 * (1 - i * 0.16); nd.hard.push(spike(add3(c, mul3(f.dor, r * 0.85)), add3(f.dor, mul3(f.t, 0.6)), h, h * 0.3, C.horn[0], f.t, 0.35, 0.4).lod(1)); }
  } });
  // necks and heads
  const kk = clamp(Math.sqrt(5 / Math.max(3, n)), 0.82, 1.18) * (flesh ? 1.05 : 1);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : (i / (n - 1)) * 2 - 1, af = Math.abs(f), alt = (i % 2 ? -0.1 : 0.06) * (n > 2 ? 1 : 0);
    const b0 = [f * 0.2, 0.66 - af * 0.1, 0.36 - af * 0.06];
    const hp = [f * (0.5 + 0.06 * n), 1.34 - af * 0.36 + alt, 0.98 - af * 0.24 + (i % 2 ? 0.1 : 0)];
    const pts = curve([b0, add3(b0, [f * 0.14, 0.3, 0.14]), add3(hp, [-f * 0.06, 0.07, -0.3]), hp], 4);
    const r0 = 0.115 * kk, radii = [r0, r0 * 0.86, r0 * 0.74, r0 * 0.64, r0 * 0.6];
    const nsk = flesh ? (q) => q.color(i % 2 ? C.skin : mix(C.skin, [0x9aa88a, 0xa89a8a, 0x8a8aa0][i % 3], 0.5)).bump(0.009, 14, 'noise').tint(0.25, 9).pbr(0.45) : sk;
    addChain(N, `n${i}_`, 'torso', pts, radii, nsk, { rig: () => `nk${i}`, detail: det * 1.05, deco: (nd, a, b, ra, rb, j, fr) => {
      const ven = mul3(fr.dor, -1);
      if (flesh) {
        if (j === 1 + (i % 2)) { nd.prims.push(orient(S.torus(ra * 1.0, 0.012), lerp3(a, b, 0.5), fr.t).color(C.suture).paint(0.003, -0.006)); for (let q = 0; q < 6; q++) { const an = q / 6 * 6.283, c = add3(lerp3(a, b, 0.5), add3(mul3(fr.side, Math.cos(an) * ra), mul3(fr.dor, Math.sin(an) * ra))); nd.hard.push(orient(H.box(0.01, 0.05, 0.01, 0.002), add3(c, mul3(fr.t, -0.025)), fr.t).color(0x8a8a8a).pbr(0.4, 0.8).lod(0)); } }
        return;
      }
      nd.prims.push(S.capsule(add3(a, mul3(ven, ra * 0.5)), add3(b, mul3(ven, rb * 0.5)), ra * 0.68, rb * 0.68).color(C.belly).paint(0.025));
      nd.prims.push(S.capsule(add3(a, mul3(fr.dor, ra * 0.55)), add3(b, mul3(fr.dor, rb * 0.55)), ra * 0.6, rb * 0.6).color(C.back).paint(0.03));
      const c = lerp3(a, b, 0.5), r = (ra + rb) / 2, h = 0.085 * kk;
      nd.hard.push(spike(add3(c, mul3(fr.dor, r * 0.85)), add3(fr.dor, mul3(fr.t, -0.5)), h, h * 0.3, C.horn[0], mul3(fr.t, -1), 0.35, 0.4).lod(1));
    }, up: [f === 0 ? 1 : Math.sign(f), 0, 0.001], zHint: [0, 0, 1] });
    hydraHead(N, `head${i}`, `n${i}_3`, sub3(pts[4], pts[3]), [16 + (i % 2) * 8, f * 22, 0], C, flesh, kk * 0.95, rnd, i);
  }
  if (winged && !flesh) {
    const G = { Sh: [0.15, 0.72, 0.18], E: [0.5, 0.93, 0.04], W: [0.86, 1.08, 0.3], tips: [[1.62, 1.2, 0.22], [1.56, 1.02, -0.3], [1.26, 0.9, -0.66], [0.9, 0.82, -0.7]], hip: [0.16, 0.66, -0.4] };
    addWings(N, 'torso', G, () => batWing(G, C.wing, { k: 1.15, torn: true }), det);
  }
  return { kind: 'titan.hydra', attack: 'bite', nodes: finish(N.nodes) };
}

function hydraAnim(rig, inner, c, base) {
  const { R, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk, fly = !!c.flying && !!(rig.wings && rig.wings.length);
  const L = rig.legs || [], Sh = rig.shins || [], HD = rig.hd || [], JW = rig.jw || [], cnt = Math.max(1, HD.length);
  const k = c.moving && !fly ? 1 : 0, idle = Math.sin(t * 1.2 + ph);
  const gait = walk4(rig, { ...c, flying: fly }, base, 6, 0.36, 0.5, -0.4);
  if (fly) for (let i = 0; i < L.length; i++) { const d = Math.sin(t * 2.1 + i * 1.3 + ph) * 0.05; R(L[i], (i < 2 ? 0.7 : 0.9) + d, 0, 0); R(Sh[i], i < 2 ? -0.9 : 0.4); }
  const dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 2) : 0;
  // every neck weaves on its own clock; in an attack the heads strike one after another
  for (let i = 0; i < cnt; i++) {
    const list = rig[`nk${i}`] || [], p = ph + i * 1.9;
    let strike = 0, hx = Math.sin(t * 1.3 + p) * 0.08, jaw = 0.04 + 0.22 * Math.max(0, Math.sin(t * 0.9 + p * 1.7));
    if (a >= 0) {
      const ai = clamp(a * 1.5 - (i / cnt) * 0.5);
      strike = keys(ai, [[0, 0], [0.3, -1], [0.5, 1], [0.72, 0.6], [1, 0]]);
      hx = keys(ai, [[0, 0], [0.3, -0.35], [0.5, 0.3], [1, 0]]);
      jaw = keys(ai, [[0, 0.05], [0.3, 0.6], [0.5, 0.85], [0.62, 0.05], [1, 0.05]]);
    }
    list.forEach((seg, j) => {
      const wx = Math.sin(t * 1.1 + p - j * 0.55) * 0.07, wy = Math.sin(t * 0.8 + p * 1.3 - j * 0.6) * 0.1;
      R(seg, dead ? 0.42 * df : wx + (strike < 0 ? 0.2 * strike : 0.3 * strike) * (j === 0 ? 0.6 : 1) + (fly ? 0.12 : 0), dead ? ((i % 2) - 0.5) * 0.3 * df : wy, 0);
    });
    R(HD[i], dead ? 0.2 * df : hx, dead ? 0 : Math.sin(t * 0.7 + p * 2.1) * 0.16, dead ? (i % 2 ? 0.4 : -0.4) * df : 0);
    R(JW[i], dead ? 0.5 * df : jaw);
  }
  R(rig.torso, idle * 0.008 + (a >= 0 ? -0.05 * bellK(a) : 0), Math.sin(gait) * 0.04 * k, 0);
  tailWave(rig, c, base, 0.13, 1.6, fly ? -0.1 : 0);
  const beat = wingsPose(rig, { ...c, flying: fly }, base, s, { rate: 8, open: a >= 0 ? bellK(a) : 0 });
  if (dieSide(inner, c, base, 0.22)) return;
  inner.rotation.x = fly ? -0.05 : 0;
  inner.position.z = (a >= 0 ? keys(a, [[0, 0], [0.3, -0.05], [0.55, 0.1], [1, 0]]) : 0) * s;
  inner.position.y = (fly ? Math.cos(beat) * 0.04 : k * Math.abs(Math.sin(gait)) * 0.02) * s;
}

// =====================================================================================
//  TREE-FOLK: the tree-warden, the dryad, the fen-beast
// =====================================================================================
// stock biped rig (legs, shins, torso, head, arms, forearms); `pace` slows the gait of the big ones

const leafCard = (p, dir, len, w, c0, c1, up = [0, 1, 0]) => feather(p, dir, len, w, [rgb(c0), rgb(c1)], up, 1);
function treeman(def, o = {}) {
  if (o.kind === 'dryad') return dryad(def, o);
  if (o.kind === 'bog') return bogBeast(def, o);
  const bark = col(o.bark, 0x4a3a22), leaf = col(o.leaf, 0x5a8a2a);
  const barkD = tone(bark, 0, 0, -0.07), heart = mix(bark, 0xc8a870, 0.6), leaf2 = tone(leaf, -0.03, 0.05, 0.1), leafD = tone(leaf, 0.02, 0, -0.1), moss = mix(leaf, 0x4a5a2a, 0.5);
  const rnd = rng(hashStr(def?.id || 'treeman'));
  const bk = (q) => q.color(bark).bump(0.03, 15, 'fur').tint(0.24, 9).pbr(0.9);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.5, 0], { rig: 'torso', detail: 0.72 });
  {
    const p = torso.prims;
    p.push(bk(S.capsule([0, 0.52, 0], [0, 1.16, 0.02], 0.21, 0.185)));
    p.push(bk(S.ellipsoid(0.24, 0.13, 0.21).at(0, 0.5, 0).blend(0.06)));
    p.push(bk(S.ellipsoid(0.17, 0.14, 0.15).at(0.05, 0.72, 0.1).blend(0.06)));               // burl
    p.push(bk(S.capsule([0, 1.1, 0.01], [0.02, 1.32, -0.02], 0.19, 0.15).blend(0.05)));
    p.push(...S.mirrorX([bk(S.ellipsoid(0.13, 0.12, 0.13).at(0.24, 1.1, 0).blend(0.06))]));   // shoulder boles
    // the face in the bark
    p.push(...S.mirrorX([
      bk(S.capsule([0.02, 1.05, 0.2], [0.14, 1.11, 0.15], 0.035, 0.045).blend(0.02)).color(barkD),   // brows
      S.ellipsoid(0.045, 0.036, 0.05).rot(0, 0, 14).at(0.078, 1.01, 0.185).color(0x120c06).cut(0.012),
      bk(S.ellipsoid(0.04, 0.05, 0.03).at(0.12, 0.93, 0.15).blend(0.03)),                             // cheek
    ]));
    p.push(bk(S.capsule([0, 1.03, 0.2], [0, 0.92, 0.25], 0.03, 0.045).blend(0.025)));               // nose: a broken knot
    p.push(S.box(0.2, 0.045, 0.12, 0.012).at(0, 0.83, 0.2).color(0x140e08).cut(0.012));
    p.push(...S.mirrorX([S.box(0.05, 0.03, 0.1, 0.008).rot(0, 0, -30).at(0.1, 0.85, 0.2).color(0x140e08).cut(0.008)]));
    p.push(S.ellipsoid(0.12, 0.15, 0.07).at(0, 0.68, 0.17).color(moss).bump(0.012, 30, 'fur').tint(0.25, 14).blend(0.03));    // moss beard
    p.push(S.ellipsoid(0.2, 0.1, 0.18).at(-0.12, 1.2, -0.03).color(moss).bump(0.008, 30, 'fur').tint(0.25, 14).paint(0.03, 0.006));
    p.push(S.ellipsoid(0.12, 0.2, 0.1).at(0.14, 0.75, -0.14).color(moss).tint(0.25, 14).paint(0.03, 0.004));
    p.push(S.sphere(0.05).at(-0.15, 0.82, 0.13).color(0x140e08).cut(0.015), S.torus(0.058, 0.02).rot(90, 0, -40).at(-0.15, 0.82, 0.135).color(barkD).blend(0.01));    // a hollow
    for (const sx of [1, -1]) {
      torso.hard.push(glowEye([0.078 * sx, 1.008, 0.182], 0.022, 0xffb020, 1.8));
      for (let i = 0; i < 3; i++) torso.hard.push(spike([sx * (0.03 + i * 0.03), 0.85, 0.2], [0, -1, 0.1], 0.03 + (i % 2) * 0.012, 0.01, heart, [0, 0, 1], 0.1).lod(1));
    }
    // side shoots
    for (const [b, d, L] of [[[0.2, 0.9, -0.05], [1, 0.7, -0.3], 0.3], [[-0.19, 0.66, 0.02], [-1, 0.5, 0.2], 0.22], [[0.05, 1.0, -0.19], [0.2, 0.6, -1], 0.3]]) {
      const e = add3(b, mul3(norm3(d), L));
      torso.hard.push(H.tube([b, lerp3(b, add3(e, [0, 0.05, 0]), 0.6), e], [0.026, 0.016, 0.006], 6, 5).color(barkD).pbr(0.9));
      for (let i = 0; i < 4; i++) torso.hard.push(leafCard(lerp3(b, e, 0.5 + i * 0.16), [d[0] + (rnd() - 0.5) * 1.5, 0.5 + rnd(), d[2] + (rnd() - 0.5) * 1.5], 0.11, 0.035, leaf, leaf2).lod(2));
    }
  }
  // crown: boughs and foliage; sways as the rig's head
  const crown = N('head', 'torso', [0, 1.26, 0], { rig: 'head', detail: 0.6 });
  {
    const boughs = [[[0, 1.28, 0], [0.16, 1.5, 0.04], [0.3, 1.62, 0.0]], [[0, 1.28, 0], [-0.14, 1.52, -0.05], [-0.3, 1.7, -0.08]], [[0, 1.3, 0], [0.02, 1.56, -0.12], [0.06, 1.8, -0.16]], [[0, 1.3, 0.02], [-0.04, 1.5, 0.14], [-0.1, 1.62, 0.26]]];
    for (const b of boughs) crown.prims.push(...S.limb(b, [0.11, 0.065, 0.035]).map((q) => bk(q).blend(0.04)));
    crown.prims.push(S.cyl(0.1, 0.05, 0.01).at(0.02, 1.36, 0.0).color(heart).blend(0.004));             // the broken leader
    const clumps = [[0.32, 1.66, 0.02, 0.2], [-0.32, 1.74, -0.1, 0.21], [0.07, 1.86, -0.17, 0.22], [-0.12, 1.66, 0.28, 0.18], [0.1, 1.64, 0.2, 0.15], [-0.05, 1.72, -0.3, 0.17], [0.3, 1.8, -0.22, 0.16]];
    clumps.forEach(([x, y, z, r], i) => {
      crown.prims.push(S.ellipsoid(r, r * 0.8, r).at(x, y, z).color(i % 3 === 0 ? leaf2 : i % 3 === 1 ? leaf : leafD).bump(0.035, 10, 'scales').tint(0.3, 8).pbr(0.75).blend(0.02));
      for (let j = 0; j < 7; j++) { const d = norm3([rnd() - 0.5, rnd() - 0.35, rnd() - 0.5]); crown.hard.push(leafCard(add3([x, y, z], mul3(d, r * 0.8)), add3(d, [0, -0.25, 0]), 0.13, 0.04, j % 2 ? leaf : leaf2, leafD, [d[2], 0.4, -d[0]]).lod(1)); }
    });
  }
  // arms: boughs ending in twig fingers
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.29, 1.1, 0]), El = X([0.44, 0.78, 0.0]), Wr = X([0.47, 0.46, 0.07]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.75 });
    up.prims.push(bk(S.capsule(Sp, El, 0.085, 0.066)), bk(S.sphere(0.1).at(...Sp).blend(0.03)), bk(S.sphere(0.075).at(...El).blend(0.02)));
    up.prims.push(S.ellipsoid(0.1, 0.06, 0.1).at(Sp[0], Sp[1] + 0.07, Sp[2]).color(moss).bump(0.008, 30, 'fur').paint(0.02, 0.006));
    for (let i = 0; i < 4; i++) up.hard.push(leafCard(add3(Sp, [sx * 0.03, 0.08, (i - 1.5) * 0.04]), [sx * (0.4 + rnd()), 0.6, (i - 1.5) * 0.6], 0.14, 0.04, leaf, leaf2).lod(2));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.8 });
    fo.prims.push(bk(S.sphere(0.072).at(...El)), bk(S.capsule(El, Wr, 0.064, 0.085).blend(0.02)), bk(S.ellipsoid(0.09, 0.09, 0.08).at(Wr[0], Wr[1] - 0.04, Wr[2]).blend(0.03)).color(barkD));
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.42, b0 = add3(Wr, [Math.sin(a) * 0.06 * 1, -0.09, 0.02]);
      const d = norm3([Math.sin(a) * 0.5, -1, 0.25]), L = 0.24 - Math.abs(i - 1.5) * 0.03;
      fo.hard.push(H.tube([b0, add3(b0, mul3(d, L * 0.5)), add3(add3(b0, mul3(d, L)), [0, 0, 0.06])], [0.026, 0.02, 0.005], 6, 5).color(barkD).pbr(0.9));
    }
    fo.hard.push(H.tube([add3(Wr, [-sx * 0.06, -0.03, 0.03]), add3(Wr, [-sx * 0.12, -0.12, 0.09]), add3(Wr, [-sx * 0.12, -0.2, 0.14])], [0.024, 0.018, 0.005], 5, 5).color(barkD).pbr(0.9));
    fo.hard.push(H.tube([lerp3(El, Wr, 0.3), add3(lerp3(El, Wr, 0.3), [sx * 0.1, 0.06, -0.06]), add3(lerp3(El, Wr, 0.3), [sx * 0.16, 0.16, -0.08])], [0.02, 0.012, 0.004], 5, 4).color(barkD).pbr(0.9).lod(2));
    for (let i = 0; i < 3; i++) fo.hard.push(leafCard(add3(lerp3(El, Wr, 0.3), [sx * 0.14, 0.13, -0.08]), [sx * (i - 0.5), 0.8, (i - 1) * 0.8], 0.1, 0.032, leaf2, leaf).lod(2));
  }
  // legs: split trunks standing on a splay of roots
  for (const sx of [1, -1]) {
    const lg = addLeg(N, sx > 0 ? 'L' : 'R', 'root', sx, [[0.14, 0.5, 0], [0.19, 0.27, 0.04], [0.2, 0.1, 0.0], [0.2, 0.02, 0.01]], [0.125, 0.095, 0.09], bk, { detail: 0.72, muscle: 1.05, foot: { kind: 'root', w: 0.11 } });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283 + 0.4 * sx, L = 0.2 + 0.08 * ((i * 5) % 3), c = [sx * 0.2, 0.07, 0.01];
      const e = [c[0] + Math.sin(a) * L, 0.022, c[2] + Math.cos(a) * L];
      lg.lo.prims.push(...S.limb([c, lerp3(c, [e[0], 0.07, e[2]], 0.5), e], [0.06, 0.04, 0.016]).map((q) => bk(q).blend(0.025)));
    }
    lg.lo.prims.push(S.ellipsoid(0.1, 0.05, 0.1).at(sx * 0.2, 0.21, -0.03).color(moss).paint(0.02, 0.004));
  }
  scaleNodes(N.nodes, 0.72);
  return { kind: 'titan.tree', attack: 'slam', pace: 0.5, u: 0.72, nodes: finish(N.nodes) };
}

function treeAnim(rig, inner, c, base) {
  const pace = rig.pace ?? 1;
  base.biped(rig, inner, pace === 1 ? c : { ...c, t: c.t * pace, phase: (c.phase || 0) });
  // boughs and weed stir in the wind
  (rig.sway || []).forEach((x, i) => base.R(x, Math.sin(c.t * 1.3 + i * 1.7 + (c.phase || 0)) * 0.08, 0, Math.sin(c.t * 0.9 + i * 2.3) * 0.06));
  if (rig.head && pace < 1 && !(c.dead > 0)) rig.head.rotation.z += Math.sin(c.t * 0.9 + (c.phase || 0)) * 0.03;
  if (c.dead > 0 && pace < 1) inner.position.y += Math.min(1, c.dead * 2) * 0.12 * (inner.scale.y || 1) * (rig.u || 1);
}

// ---------------- dryad ----------------
function dryad(def, o) {
  const bark = col(o.bark, 0x5a4a2a), leaf = col(o.leaf, 0x7a9a2a);
  const skin = mix(bark, 0xa8925a, 0.35), barkD = tone(bark, 0, 0, -0.08), leaf2 = tone(leaf, -0.04, 0.05, 0.1), leafD = tone(leaf, 0.03, 0, -0.1), glow = tone(leaf, -0.06, 0.3, 0.2);
  const rnd = rng(hashStr(def?.id || 'dryad'));
  const sk = (q) => q.color(skin).bump(0.0025, 60, 'fur').tint(0.14, 30).pbr(0.7);
  const bk = (q) => q.color(bark).bump(0.005, 36, 'fur').tint(0.2, 26).pbr(0.9);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.5, 0], { rig: 'torso', detail: 1.1 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.098, 0.07, 0.07).at(0, 0.5, 0)));
    p.push(sk(S.capsule([0, 0.55, 0], [0, 0.68, 0.005], 0.064, 0.06).blend(0.03)));
    p.push(sk(S.ellipsoid(0.094, 0.085, 0.066).at(0, 0.745, 0.0).blend(0.03)));
    p.push(...S.mirrorX([sk(S.sphere(0.036).at(0.042, 0.745, 0.05).blend(0.018)), sk(S.sphere(0.036).at(0.112, 0.795, 0).blend(0.02))]));
    p.push(sk(S.capsule([0, 0.8, 0], [0, 0.875, 0.01], 0.034, 0.03).blend(0.015)));
    // plates of rough bark like armour, and a vine belt
    p.push(S.ellipsoid(0.1, 0.06, 0.075).at(0, 0.5, -0.005).color(bark).bump(0.005, 36, 'fur').paint(0.006, 0.005));
    p.push(...S.mirrorX([S.ellipsoid(0.05, 0.04, 0.05).at(0.11, 0.805, 0).color(bark).bump(0.005, 36, 'fur').paint(0.006, 0.006)]));
    p.push(S.ellipsoid(0.07, 0.1, 0.03).at(0, 0.72, -0.06).color(bark).bump(0.005, 36, 'fur').paint(0.006, 0.004));
    p.push(S.torus(0.066, 0.01).rot(0, 0, 10).at(0, 0.58, 0).color(leafD).paint(0.003, 0.005));
    p.push(S.torus(0.09, 0.009).rot(18, 0, -62).at(0, 0.72, 0).color(leafD).paint(0.003, 0.005));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; torso.hard.push(leafCard([Math.sin(a) * 0.085, 0.545, Math.cos(a) * 0.06], [Math.sin(a) * 0.45, -1, Math.cos(a) * 0.45], 0.13 + 0.04 * (i % 2), 0.032, i % 2 ? leaf : leaf2, leafD, [Math.sin(a), 0.3, Math.cos(a)]).lod(2)); }
    for (let i = 0; i < 4; i++) torso.hard.push(leafCard([(i - 1.5) * 0.04, 0.78, 0.06], [(i - 1.5) * 0.5, -1, 0.5], 0.06, 0.02, leaf2, leaf, [0, 0, 1]).lod(1));
  }
  const head = N('head', 'torso', [0, 0.87, 0.005], { rig: 'head', detail: 1.7 });
  {
    const p = head.prims, R = 0.07, hy = 0.935;
    p.push(sk(S.ellipsoid(R * 0.92, R * 1.16, R * 1.02).at(0, hy, 0.005)));
    p.push(sk(S.ellipsoid(R * 0.62, R * 0.5, R * 0.6).at(0, hy - R * 0.72, R * 0.3).blend(0.03)));
    p.push(sk(S.capsule([0, hy + 0.004, R * 0.92], [0, hy - 0.022, R * 1.1], 0.008, 0.011).blend(0.012)));
    p.push(...S.mirrorX([
      S.capsule([0.008, hy + 0.012, R * 0.93], [0.045, hy + 0.036, R * 0.72], 0.008, 0.011).color(barkD).blend(0.008),        // angry brows
      S.sphere(0.013).at(0.026, hy + 0.004, R * 0.88).color(0x1a1408).cut(0.004),
      sk(S.ellipsoid(0.01, 0.034, 0.016).rot(-20, 0, -28).at(R * 0.98, hy + 0.02, -0.004).blend(0.008)),                        // long ear
      sk(S.ellipsoid(0.014, 0.012, 0.012).at(0.036, hy - 0.022, R * 0.74).blend(0.012)),
    ]));
    p.push(S.box(0.036, 0.008, 0.03, 0.002).at(0, hy - 0.046, R * 0.82).color(0x2a1408).cut(0.004));
    p.push(S.ellipsoid(R * 0.96, R * 0.7, R * 1.04).at(0, hy + R * 0.55, -0.012).color(bark).bump(0.006, 40, 'fur').blend(0.008));
    for (const sx of [1, -1]) {
      head.hard.push(glowEye([0.026 * sx, hy + 0.004, R * 0.84], 0.0085, glow, 1.9));
      head.hard.push(H.tube([[0.03 * sx, hy + 0.07, 0.0], [0.06 * sx, hy + 0.14, -0.02], [0.05 * sx, hy + 0.2, -0.05]], [0.01, 0.007, 0.002], 6, 4).color(barkD).pbr(0.9));
      head.hard.push(H.tube([[0.057 * sx, hy + 0.13, -0.018], [0.09 * sx, hy + 0.16, -0.01]], [0.006, 0.002], 2, 4).color(barkD).lod(1));
    }
    // hair of long leaves
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * 6.283, up = 0.2 + 0.6 * rnd(), back = Math.cos(a) > 0.5;
      if (back && up < 0.5) continue;
      const b0 = [Math.sin(a) * 0.05, hy + 0.05 + up * 0.03, -0.01 + Math.cos(a) * 0.05];
      head.hard.push(leafCard(b0, [Math.sin(a) * 0.7, back ? 0.9 : -0.5 - rnd() * 0.5, Math.cos(a) * 0.5 - 0.75], 0.17 + rnd() * 0.12, 0.024, i % 3 ? leaf : leaf2, leafD, [Math.sin(a), 0.5, Math.cos(a)]).lod(i % 4 ? 2 : 3));
    }
  }
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.125, 0.79, 0]), El = X([0.15, 0.61, -0.01]), Wr = X([0.155, 0.43, 0.03]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 1.1, minRes: 44 });
    up.prims.push(sk(S.capsule(Sp, El, 0.031, 0.026)), sk(S.sphere(0.035).at(...Sp).blend(0.01)));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 1.2, minRes: 44 });
    fo.prims.push(sk(S.capsule(El, Wr, 0.027, 0.02)), bk(S.capsule(lerp3(El, Wr, 0.25), lerp3(El, Wr, 0.85), 0.032, 0.026).blend(0.004)));
    fo.prims.push(sk(S.ellipsoid(0.02, 0.03, 0.014).at(Wr[0], Wr[1] - 0.028, Wr[2]).blend(0.008)));
    for (let i = 0; i < 4; i++) { const a = (i - 1.5) * 0.36; fo.hard.push(spike([Wr[0] + Math.sin(a) * 0.016, Wr[1] - 0.048, Wr[2] + 0.004], [Math.sin(a) * 0.5, -1, 0.3], 0.085, 0.007, 0x2a1c0e, [0, 0, 1], 0.4).lod(2)); }
    for (let i = 0; i < 3; i++) fo.hard.push(spike(add3(lerp3(El, Wr, 0.3 + i * 0.2), [sx * 0.025, 0, -0.01]), [sx, 0.4, -0.5], 0.04, 0.008, 0x2a1c0e, [0, 1, 0], 0.3).lod(1));
    const lg = addLeg(N, nm, 'root', sx, [[0.062, 0.5, 0], [0.068, 0.275, 0.012], [0.064, 0.05, 0.0], [0.064, 0.012, 0.01]], [0.054, 0.04, 0.027], sk, { detail: 1.1, minRes: 40, muscle: 1.1, foot: { kind: 'root', w: 0.03 } });
    lg.lo.prims.push(bk(S.capsule([sx * 0.066, 0.24, 0.012], [sx * 0.064, 0.09, 0.004], 0.044, 0.034).blend(0.004)));
    for (let i = 0; i < 3; i++) { const a = (i - 1) * 0.5 + sx * 0.1; lg.lo.prims.push(sk(S.capsule([sx * 0.064, 0.03, 0.01], [sx * 0.064 + Math.sin(a) * 0.07, 0.012, 0.01 + Math.cos(a) * 0.09], 0.02, 0.008).blend(0.012))); }
    lg.up.prims.push(S.torus(0.05, 0.008).rot(0, 0, 20 * sx).at(sx * 0.064, 0.4, 0.004).color(leafD).paint(0.003, 0.005));
  }
  scaleNodes(N.nodes, 1.85);
  return { kind: 'titan.tree', attack: 'claw', pace: 1, nodes: finish(N.nodes) };
}

// ---------------- fen-beast ----------------
function bogBeast(def, o) {
  const peat = col(o.bark, 0x3a3a22), leaf = col(o.leaf, 0x4a5a2a);
  const peatD = tone(peat, 0, 0, -0.06), wood = mix(peat, 0x8a7450, 0.5), moss = tone(leaf, 0, 0.05, 0.04), weed = tone(leaf, 0.04, 0, -0.06), slime = tone(leaf, -0.05, 0.2, 0.16);
  const rnd = rng(hashStr(def?.id || 'bog'));
  const mud = (q) => q.color(peat).bump(0.026, 8, 'rock').tint(0.3, 6).pbr(0.6);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.42, 0], { rig: 'torso', detail: 0.7 });
  {
    const p = torso.prims;
    p.push(mud(S.ellipsoid(0.37, 0.33, 0.31).at(0, 0.6, 0)));
    p.push(mud(S.ellipsoid(0.33, 0.27, 0.29).rot(14, 0, 0).at(0, 0.9, 0.04).blend(0.1)));
    p.push(mud(S.ellipsoid(0.3, 0.16, 0.26).at(0, 0.4, 0.02).blend(0.08)));
    p.push(...S.mirrorX([mud(S.ellipsoid(0.17, 0.16, 0.17).at(0.3, 0.98, 0.02).blend(0.08))]));
    p.push(mud(S.ellipsoid(0.16, 0.13, 0.15).at(0.02, 1.03, 0.2).blend(0.07)));                          // the head, sunk in the shoulders
    p.push(S.ellipsoid(0.4, 0.2, 0.32).at(0, 1.1, -0.06).color(moss).bump(0.012, 26, 'fur').tint(0.3, 10).pbr(0.85).paint(0.05, 0.01));
    p.push(S.ellipsoid(0.2, 0.25, 0.12).at(-0.22, 0.66, -0.24).color(moss).bump(0.012, 26, 'fur').tint(0.3, 10).paint(0.04, 0.008));
    p.push(S.ellipsoid(0.2, 0.14, 0.12).at(0.14, 0.52, 0.24).color(mix(peat, slime, 0.35)).pbr(0.25).tint(0.3, 12).paint(0.06));
    p.push(S.ellipsoid(0.1, 0.035, 0.08).rot(0, 0, -8).at(0.02, 0.975, 0.3).color(0x0c0e08).cut(0.02));     // sagging mouth
    p.push(S.sphere(0.03).at(0.08, 1.06, 0.31).color(0x0c0e08).cut(0.01), S.sphere(0.022).at(-0.05, 1.07, 0.32).color(0x0c0e08).cut(0.008));
    torso.hard.push(glowEye([0.08, 1.06, 0.305], 0.017, 0xd8f040, 1.9), glowEye([-0.05, 1.07, 0.315], 0.012, 0xd8f040, 1.9));
    // bog-wood: dead boughs and a broken log through the back
    const boughs = [[[0.2, 1.1, -0.1], [0.34, 1.34, -0.2], [0.3, 1.52, -0.3]], [[-0.14, 1.14, -0.12], [-0.3, 1.36, -0.16], [-0.44, 1.42, -0.1]], [[-0.3, 0.8, -0.18], [-0.5, 0.92, -0.32], [-0.56, 1.06, -0.42]], [[0.02, 1.16, -0.14], [0.02, 1.36, -0.26], [-0.06, 1.46, -0.38]]];
    boughs.forEach((b, i) => {
      torso.hard.push(H.tube(b, [0.05, 0.034, 0.012], 7, 6).color(i % 2 ? wood : tone(wood, 0, 0, -0.1)).pbr(0.9));
      torso.hard.push(H.tube([b[1], add3(b[1], [0.1 * (i % 2 ? 1 : -1), 0.08, 0.04]), add3(b[1], [0.16 * (i % 2 ? 1 : -1), 0.2, 0.02])], [0.022, 0.014, 0.004], 5, 4).color(wood).pbr(0.9).lod(2));
      torso.hard.push(ribbon(lerp3(b[1], b[2], 0.5), 0.2 + rnd() * 0.1, 0.03, weed, [1, 0, 0], rnd));
    });
    torso.hard.push(H.cyl(0.07, 0.085, 0.5, 8).rot(0, 0, 62).rot(0, 20, 0).at(0.3, 0.86, -0.2).color(wood).pbr(0.95), H.cyl(0.072, 0.072, 0.012, 8).rot(0, 0, 62).rot(0, 20, 0).at(0.52, 0.975, -0.28).color(mix(wood, 0xd8c090, 0.5)).lod(2));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283 + rnd(); torso.hard.push(ribbon([Math.sin(a) * 0.34, 0.86 - rnd() * 0.35, Math.cos(a) * 0.27 + 0.02], 0.2 + rnd() * 0.18, 0.028, i % 2 ? weed : moss, [Math.sin(a), 0, Math.cos(a)], rnd)); }
    for (let i = 0; i < 4; i++) torso.hard.push(strand([(i - 1.5) * 0.045 + 0.02, 0.955, 0.33], 0.12 + rnd() * 0.12, 0.008, slime, rnd, 0.02));
    for (let i = 0; i < 4; i++) torso.hard.push(H.cone(0.02, 0.07, 6).at(-0.1 + i * 0.07 + rnd() * 0.03, 1.27 + rnd() * 0.03, 0.05 - rnd() * 0.2).color(0xc8b88a).lod(1), H.sphere(0.035, 8).scale(1, 0.5, 1).at(-0.1 + i * 0.07, 1.31, 0.03 - (i % 2) * 0.16).color(i % 2 ? 0xb8552a : 0xc8a04a).lod(1));  // toadstools
  }
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.38, 0.96, 0.03]), El = X([0.52, 0.62, 0.08]), Wr = X([0.52, 0.28, 0.2]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.7 });
    up.prims.push(mud(S.capsule(Sp, El, 0.14, 0.11)), mud(S.sphere(0.15).at(...Sp).blend(0.04)));
    up.prims.push(S.ellipsoid(0.15, 0.08, 0.15).at(Sp[0], Sp[1] + 0.1, Sp[2]).color(moss).bump(0.012, 26, 'fur').paint(0.03, 0.008));
    for (let i = 0; i < 4; i++) up.hard.push(ribbon(add3(lerp3(Sp, El, 0.2 + i * 0.22), [sx * 0.08, -0.06, (i % 2 - 0.5) * 0.12]), 0.2 + rnd() * 0.14, 0.028, i % 2 ? weed : moss, [sx, 0, 0.3], rnd));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.7 });
    fo.prims.push(mud(S.sphere(0.115).at(...El)), mud(S.capsule(El, Wr, 0.105, 0.14).blend(0.03)), mud(S.ellipsoid(0.17, 0.15, 0.16).at(Wr[0], Wr[1] - 0.06, Wr[2] + 0.02).blend(0.05)).color(peatD));
    for (let i = 0; i < 3; i++) { const a = (i - 1) * 0.55; fo.hard.push(H.tube([add3(Wr, [Math.sin(a) * 0.1, -0.12, 0.08]), add3(Wr, [Math.sin(a) * 0.16, -0.2, 0.2]), add3(Wr, [Math.sin(a) * 0.17, -0.27, 0.27])], [0.04, 0.028, 0.008], 6, 5).color(wood).pbr(0.9)); }
    for (let i = 0; i < 3; i++) fo.hard.push(ribbon(add3(lerp3(El, Wr, 0.3 + i * 0.25), [sx * 0.07, -0.08, 0]), 0.16 + rnd() * 0.1, 0.026, weed, [sx, 0, 0.3], rnd));
    addLeg(N, nm, 'root', sx, [[0.19, 0.42, 0], [0.21, 0.22, 0.03], [0.21, 0.1, 0.0], [0.21, 0.03, 0.02]], [0.17, 0.14, 0.14], mud, { detail: 0.7, muscle: 1.05, foot: { kind: 'root', w: 0.17 } });
  }
  return { kind: 'titan.tree', attack: 'slam', pace: 0.58, nodes: finish(N.nodes) };
}

// =====================================================================================
//  MANTICORE, SCORPION, SPHINX
// =====================================================================================

/** an arched, segmented stinging tail through pts; the last node carries the bulb and sting. rig list `tail`. */
function stingTail(N, name, parent, pts, radii, C, detail = 0.8) {
  const sh = (q) => q.color(C.shell).pbr(C.rough ?? 0.25, 0.12).tint(0.1, 12);
  const nodes = addChain(N, name, parent, pts, radii, sh, { rig: 'tail', detail, up: [1, 0, 0], deco: (n, a, b, ra, rb, i, f) => {
    const c = lerp3(a, b, 0.5), L = len3(sub3(b, a));
    n.prims.push(sh(orient(S.ellipsoid(ra * 1.22, L * 0.46, ra * 1.18), c, f.t).blend(0.012)));
    // keels along the back, and a band of inlay at the joint
    for (const sx of [1, -1]) n.prims.push(sh(S.capsule(add3(a, add3(mul3(f.dor, ra * 0.5 * sx), mul3(f.side, -ra * 0.95))), add3(b, add3(mul3(f.dor, rb * 0.5 * sx), mul3(f.side, -rb * 0.95))), ra * 0.2, rb * 0.2).blend(0.01)).color(C.shellD));
    if (C.trim != null) n.prims.push(orient(S.torus(ra * 1.12, ra * 0.16), lerp3(a, b, 0.5), f.t).color(C.trim).pbr(0.3, 0.9).paint(0.004, 0.004));
  } });
  const last = nodes[nodes.length - 1], e = pts[pts.length - 1], d = norm3(sub3(e, pts[pts.length - 2])), r = radii[radii.length - 1];
  const bc = add3(e, mul3(d, r * 1.2));
  last.prims.push(sh(orient(S.ellipsoid(r * 1.5, r * 1.9, r * 1.5), bc, d).blend(0.015)).color(C.bulb ?? C.shell));
  const tipDir = norm3(add3(d, [0, -0.9, 0.25]));
  last.hard.push(spike(add3(bc, mul3(d, r * 1.2)), tipDir, r * 4.2, r * 0.6, C.sting ?? 0x1a0c0c, [0, -1, 0.5], 0.45).shade((x, y) => (y > 0.7 ? rgb(C.venom ?? 0x8aff5a) : null)));
  return nodes;
}
/** tail motion shared by scorpion and manticore: sway, and the overhead strike */
function stingAnim(rig, c, base, amp = 1) {
  const { R, keys } = base, T = rig.tail || [], t = c.t, ph = c.phase || 0, a = c.atk;
  const st = a >= 0 ? keys(a, [[0, 0], [0.32, -1], [0.5, 1], [0.66, 0.8], [1, 0]]) : 0;
  T.forEach((seg, i) => {
    const sway = Math.sin(t * 1.5 + ph - i * 0.5) * 0.035, sw2 = Math.sin(t * 1.1 + ph * 1.3 - i * 0.4) * 0.06;
    R(seg, sway + (st < 0 ? 0.1 * st : 0.3 * st * amp) * (i < 1 ? 0.5 : 1), 0, sw2);
  });
  return st;
}

// ---------------- manticore ----------------
// rig: torso, neck, head, jaw, legs[4], shins[4], wings, wingtips, tail[]
function manticore(def, o = {}) {
  const fur = col(o.fur, 0x6a3a2a);
  const C = { fur, belly: mix(fur, 0xe0c8a0, 0.5), mane: tone(fur, -0.01, 0.0, -0.16), maneD: tone(fur, -0.02, 0, -0.22), skin: mix(fur, 0xc89a78, 0.55), claw: 0x1c1814,
    shell: tone(fur, -0.02, 0.05, -0.2), shellD: tone(fur, -0.02, 0, -0.26), bulb: 0x5a1418, sting: 0x1a0c0c, rough: 0.28,
    wing: { wingA: tone(fur, -0.02, 0.05, -0.14), wingB: mix(tone(fur, -0.03, 0.15, 0.04), 0xb8422a, 0.5), bone: tone(fur, 0, 0, -0.1), claw: 0x1c1814 } };
  const fr = (q) => q.color(C.fur).bump(0.006, 34, 'fur').tint(0.15, 12).pbr(0.75);
  const mn = (q) => q.color(C.mane).bump(0.02, 17, 'fur').tint(0.22, 9).pbr(0.85);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.6, 0], { rig: 'torso', detail: 0.82 });
  {
    const p = torso.prims;
    p.push(fr(S.ellipsoid(0.2, 0.23, 0.3).rot(-6, 0, 0).at(0, 0.62, 0.25)));
    p.push(fr(S.ellipsoid(0.16, 0.175, 0.3).at(0, 0.63, -0.08).blend(0.07)));
    p.push(fr(S.ellipsoid(0.18, 0.2, 0.22).at(0, 0.6, -0.38).blend(0.06)));
    p.push(fr(S.capsule([0, 0.68, 0.36], [0, 0.76, 0.5], 0.17, 0.15).blend(0.06)));
    p.push(...S.mirrorX([fr(S.ellipsoid(0.085, 0.14, 0.12).at(0.14, 0.62, 0.3).blend(0.04)), fr(S.ellipsoid(0.09, 0.15, 0.15).rot(14, 0, 0).at(0.13, 0.6, -0.38).blend(0.04)), fr(S.ellipsoid(0.06, 0.05, 0.09).at(0.1, 0.8, 0.2).blend(0.03))]));
    p.push(S.ellipsoid(0.13, 0.1, 0.4).at(0, 0.42, 0.0).color(C.belly).paint(0.05));
    p.push(mn(S.ellipsoid(0.1, 0.08, 0.3).at(0, 0.82, 0.12).blend(0.03)));                    // mane running down the spine
    p.push(mn(S.ellipsoid(0.15, 0.17, 0.12).at(0, 0.52, 0.47).blend(0.04)).color(C.maneD));
    p.push(fr(S.capsule([0, 0.62, -0.5], [0, 0.68, -0.6], 0.12, 0.1).blend(0.04)).color(C.shell));
  }
  const NB = [0, 0.74, 0.46], HJ = [0, 0.9, 0.64];
  const neck = N('neck', 'torso', NB, { rig: 'neck', detail: 0.8 });
  neck.prims.push(fr(S.capsule(NB, HJ, 0.15, 0.125)));
  neck.prims.push(mn(S.ellipsoid(0.25, 0.27, 0.19).rot(-35, 0, 0).at(0, 0.84, 0.5).blend(0.03)));
  neck.prims.push(mn(S.ellipsoid(0.2, 0.18, 0.2).at(0, 0.98, 0.48).blend(0.04)).color(C.maneD));
  neck.prims.push(...S.mirrorX([mn(S.ellipsoid(0.12, 0.2, 0.13).rot(0, 0, -20).at(0.17, 0.74, 0.54).blend(0.04))]));
  // a fanged, near-human face
  const head = N('head', 'neck', [0, 0, 0], { rig: 'head', pos: sub3(HJ, NB), rot: [6, 0, 0], detail: 1.35 });
  {
    const p = head.prims, sk = (q) => q.color(C.skin).tint(0.12, 24).pbr(0.6);
    p.push(sk(S.ellipsoid(0.112, 0.118, 0.11).at(0, 0.02, 0.05)));
    p.push(sk(S.ellipsoid(0.09, 0.07, 0.07).at(0, -0.035, 0.12).blend(0.035)));                                  // muzzle, short and broad
    p.push(sk(S.capsule([0, 0.035, 0.15], [0, -0.012, 0.19], 0.022, 0.034).blend(0.02)));                         // flat nose
    p.push(S.ellipsoid(0.034, 0.02, 0.02).at(0, -0.02, 0.2).color(tone(C.skin, 0, 0, -0.2)).paint(0.008));
    p.push(...S.mirrorX([
      sk(S.capsule([0.012, 0.062, 0.15], [0.09, 0.085, 0.08], 0.02, 0.03).blend(0.015)).color(C.mane),            // heavy brow
      sk(S.ellipsoid(0.04, 0.035, 0.04).at(0.075, -0.005, 0.11).blend(0.025)),                                    // cheekbone
      S.sphere(0.022).at(0.05, 0.04, 0.14).color(0x1a0c08).cut(0.006),
      fr(S.ellipsoid(0.03, 0.05, 0.016).rot(-10, 20, -24).at(0.1, 0.13, 0.02).blend(0.012)),                      // ear
    ]));
    p.push(S.box(0.13, 0.03, 0.09, 0.008).at(0, -0.078, 0.14).color(0x4a1018).paint(0.006));
    for (const sx of [1, -1]) {
      head.hard.push(eyeAt([0.05 * sx, 0.04, 0.136], [sx * 0.25, 0.05, 1], 0.017, { iris: 0xffd21a, rim: 0xb8420a, white: 0xe8dcc8, slit: true, glow: 0.5 }));
      head.hard.push(spike([0.038 * sx, -0.062, 0.175], [sx * 0.05, -1, 0.08], 0.062, 0.012, 0xf1e9cc, [0, 0, -1], 0.25).lod(2));
      for (let i = 0; i < 3; i++) head.hard.push(spike([(0.058 + i * 0.012) * sx, -0.062, 0.155 - i * 0.022], [0, -1, 0], 0.024, 0.008, 0xf1e9cc, [0, 0, -1], 0.2).lod(1));
      head.hard.push(spike([0.013 * sx, -0.062, 0.19], [0, -1, 0], 0.018, 0.008, 0xf1e9cc, [0, 0, -1], 0.1).lod(1));
    }
  }
  const HG = [0, -0.05, 0.02];
  const jaw = N('jaw', 'head', HG, { rig: 'jaw', pos: HG, detail: 1.2 });
  jaw.prims.push(S.ellipsoid(0.078, 0.04, 0.085).at(0, -0.105, 0.1).color(C.skin).tint(0.12, 24).pbr(0.6));
  jaw.prims.push(S.ellipsoid(0.07, 0.11, 0.06).at(0, -0.19, 0.09).color(C.maneD).bump(0.016, 20, 'fur').tint(0.2, 10).blend(0.02));   // beard
  for (const sx of [1, -1]) jaw.hard.push(spike([0.04 * sx, -0.085, 0.16], [sx * 0.05, 1, 0.05], 0.045, 0.011, 0xf1e9cc, [0, 0, -1], 0.2).lod(2));
  const paw = (k) => ({ kind: 'paw', len: 0.14 * k, w: 0.062 * k, toes: 4, clawLen: 0.035, claw: C.claw, spread: 0.3 });
  const F = [[0.15, 0.6, 0.32], [0.17, 0.34, 0.3], [0.165, 0.11, 0.33], [0.165, 0, 0.33]], B = [[0.15, 0.6, -0.4], [0.18, 0.37, -0.3], [0.17, 0.15, -0.46], [0.17, 0, -0.42]];
  addLeg(N, 'FL', 'torso', 1, F, [0.09, 0.062, 0.05], fr, { detail: 0.85, foot: paw(1) }); addLeg(N, 'FR', 'torso', -1, F, [0.09, 0.062, 0.05], fr, { detail: 0.85, foot: paw(1) });
  addLeg(N, 'BL', 'torso', 1, B, [0.105, 0.064, 0.046], fr, { detail: 0.85, foot: paw(0.95) }); addLeg(N, 'BR', 'torso', -1, B, [0.105, 0.064, 0.046], fr, { detail: 0.85, foot: paw(0.95) });
  const G = { Sh: [0.12, 0.8, 0.2], E: [0.42, 1.02, 0.06], W: [0.74, 1.14, 0.3], tips: [[1.42, 1.22, 0.24], [1.36, 1.06, -0.26], [1.1, 0.95, -0.58], [0.8, 0.88, -0.62]], hip: [0.13, 0.7, -0.36] };
  addWings(N, 'torso', G, () => batWing(G, C.wing, { k: 1.0 }), 0.8);
  stingTail(N, 'tail', 'torso', [[0, 0.68, -0.58], [0, 0.82, -0.82], [0, 1.05, -0.98], [0, 1.3, -0.96], [0, 1.48, -0.78], [0, 1.52, -0.56]], [0.1, 0.085, 0.078, 0.07, 0.064, 0.058], C, 0.8);
  return { kind: 'titan.manticore', attack: 'bite', nodes: finish(N.nodes) };
}

function manticoreAnim(rig, inner, c, base) {
  const { R, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk, fly = !!c.flying;
  const L = rig.legs || [], Sh = rig.shins || [];
  const k = c.moving && !fly ? 1 : 0, idle = Math.sin(t * 1.4 + ph), idle2 = Math.sin(t * 0.8 + ph * 1.7);
  const gait = walk4(rig, c, base, 8, 0.45, 0.7, -0.5);
  if (fly) for (let i = 0; i < L.length; i++) { const d = Math.sin(t * 2.1 + i * 1.3 + ph) * 0.05; R(L[i], (i < 2 ? 0.9 : 0.8) + d); R(Sh[i], i < 2 ? -1.3 : 0.5); }
  const st = stingAnim(rig, c, base, 1);
  let hx = idle * 0.04, jaw = 0.03 + 0.04 * Math.max(0, idle2), pz = 0;
  if (a >= 0) { hx = keys(a, [[0, 0], [0.3, -0.3], [0.5, 0.3], [1, 0]]); jaw = keys(a, [[0, 0.03], [0.3, 0.6], [0.6, 0.7], [0.75, 0.05], [1, 0.03]]); pz = keys(a, [[0, 0], [0.3, -0.06], [0.52, 0.16], [1, 0]]); }
  R(rig.torso, (a >= 0 ? 0.06 * st : 0) + idle * 0.008, Math.sin(gait) * 0.04 * k, 0);
  R(rig.neck, hx * 0.5 + (fly ? 0.2 : 0), idle2 * 0.1 * (1 - k)); R(rig.head, hx * 0.6 + (fly ? -0.2 : 0), idle2 * 0.16 * (1 - k)); R(rig.jaw, jaw);
  const beat = wingsPose(rig, c, base, s, { rate: 8.6, open: a >= 0 ? bellK(a) * 0.8 : 0 });
  if (dieSide(inner, c, base, 0.2)) { const f = Math.min(1, c.dead * 2); (rig.tail || []).forEach((x) => R(x, -0.3 * f)); R(rig.jaw, 0.4 * f); return; }
  inner.rotation.x = fly ? -0.05 : 0;
  inner.position.z = pz * s;
  inner.position.y = (fly ? Math.cos(beat) * 0.04 : k * Math.abs(Math.sin(gait)) * 0.03) * s;
}

// ---------------- scorpion ----------------
// rig: torso, legs[8] (one node each), arms[2], forearms[2], pincers[2], tail[]
function scorpion(def, o = {}) {
  const shell = col(o.shell, 0x1a1a22), trim = col(o.trim, 0xd8b03a);
  const C = { shell, shellD: tone(shell, 0, 0, -0.04), shellL: tone(shell, 0.0, 0.05, 0.1), trim, bulb: mix(shell, 0x6a1420, 0.6), sting: 0x100808, rough: 0.2 };
  const sh = (q) => q.color(shell).pbr(0.2, 0.15).tint(0.1, 14);
  const gold = (q) => q.color(trim).pbr(0.3, 0.9);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.27, 0], { rig: 'torso', detail: 0.9 });
  {
    const p = torso.prims;
    p.push(sh(S.ellipsoid(0.25, 0.1, 0.21).at(0, 0.29, 0.22)));
    p.push(sh(S.ellipsoid(0.2, 0.07, 0.1).at(0, 0.27, 0.4).blend(0.03)));
    p.push(...S.mirrorX([sh(S.ellipsoid(0.07, 0.035, 0.1).at(0.1, 0.37, 0.24).blend(0.02))]));
    p.push(S.box(0.012, 0.1, 0.3, 0.003).at(0, 0.39, 0.24).color(C.shellD).paint(0.003, -0.006));
    // tergites: overlapping plates, each with a band of inlay
    for (let i = 0; i < 7; i++) {
      const z = 0.06 - i * 0.085, w = 0.27 - Math.abs(i - 2) * 0.016 - (i > 4 ? (i - 4) * 0.035 : 0), h = 0.11 - i * 0.004;
      p.push(sh(S.ellipsoid(w, h, 0.075).rot(8, 0, 0).at(0, 0.29, z).blend(0.006)));
      p.push(gold(S.box(w * 1.5, 0.3, 0.014, 0.002).at(0, 0.3, z - 0.058).paint(0.003, 0.003)));
      if (i % 2 === 0) p.push(...S.mirrorX([gold(S.ellipsoid(0.03, 0.03, 0.022).at(w * 0.5, 0.29 + h * 0.86, z + 0.005).paint(0.003, 0.003))]));
    }
    p.push(gold(S.torus(0.09, 0.012).at(0, 0.385, 0.23).paint(0.003, 0.003)));
    p.push(S.ellipsoid(0.2, 0.05, 0.4).at(0, 0.2, -0.1).color(C.shellL).paint(0.03));
    for (const sx of [1, -1]) {
      torso.hard.push(glowEye([0.035 * sx, 0.395, 0.27], 0.016, 0xff5a2a, 1.6).lod(2));
      for (let i = 0; i < 3; i++) torso.hard.push(glowEye([(0.17 + i * 0.022) * sx, 0.33, 0.37 - i * 0.03], 0.008, 0xff5a2a, 1.4).lod(1));
      torso.hard.push(spike([0.045 * sx, 0.25, 0.48], [sx * -0.2, -0.3, 1], 0.09, 0.022, C.shellL, [0, -1, 0], 0.4).lod(2));      // chelicerae
    }
  }
  // pincers
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.15, 0.27, 0.4]), El = X([0.44, 0.32, 0.56]), Wr = X([0.4, 0.32, 0.84]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.9 });
    up.prims.push(sh(S.capsule(Sp, El, 0.055, 0.062)), sh(S.sphere(0.07).at(...El).blend(0.01)));
    up.prims.push(gold(orient(S.torus(0.06, 0.012), lerp3(Sp, El, 0.55), sub3(El, Sp)).paint(0.003, 0.003)));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.95 });
    fo.prims.push(sh(S.sphere(0.066).at(...El)), sh(S.capsule(El, Wr, 0.058, 0.066).blend(0.01)));
    const hc = X([0.37, 0.32, 0.99]);
    fo.prims.push(sh(S.ellipsoid(0.125, 0.085, 0.17).rot(0, sx * -8, 0).at(...hc).blend(0.015)));
    fo.prims.push(...S.limb([X([0.3, 0.32, 1.08]), X([0.26, 0.32, 1.26]), X([0.3, 0.32, 1.42])], [0.055, 0.04, 0.012]).map((q) => sh(q).blend(0.015)));            // fixed finger
    fo.prims.push(gold(S.ellipsoid(0.07, 0.04, 0.1).rot(0, sx * -8, 0).at(hc[0], hc[1] + 0.06, hc[2]).paint(0.004, 0.003)));
    fo.prims.push(S.ellipsoid(0.03, 0.03, 0.045).at(hc[0], hc[1] + 0.075, hc[2]).color(shell).paint(0.003));
    fo.prims.push(gold(orient(S.torus(0.066, 0.012), lerp3(El, Wr, 0.6), sub3(Wr, El)).paint(0.003, 0.003)));
    for (let i = 0; i < 4; i++) fo.hard.push(spike(X([0.29 + i * 0.004, 0.32, 1.14 + i * 0.06]), [sx, 0, 0.1], 0.03, 0.012, C.shellL, [0, 0, 1], 0.1).lod(1));
    const PV = X([0.45, 0.32, 1.1]);
    const pn = N(`pincer${nm}`, `fore${nm}`, PV, { rig: 'pincers', detail: 0.95 });
    pn.prims.push(...S.limb([PV, X([0.47, 0.32, 1.27]), X([0.39, 0.32, 1.43])], [0.05, 0.036, 0.011]).map((q) => sh(q).blend(0.015)));
    for (let i = 0; i < 3; i++) pn.hard.push(spike(X([0.44 - i * 0.012, 0.32, 1.2 + i * 0.06]), [-sx, 0, 0.1], 0.03, 0.012, C.shellL, [0, 0, 1], 0.1).lod(1));
  }
  // eight walking legs
  for (const sx of [1, -1]) for (let i = 0; i < 4; i++) {
    const z0 = 0.3 - i * 0.13, sp = (1.5 - i) * 0.17, X = sideX(sx);
    const J = X([0.2, 0.25, z0]), K = X([0.5, 0.5, z0 + sp * 0.9]), M = X([0.7, 0.3, z0 + sp * 1.5]), F = X([0.78, 0.0, z0 + sp * 1.75]);
    const lg = N(`leg${sx > 0 ? 'L' : 'R'}${i}`, 'torso', J, { rig: 'legs', detail: 0.9, minRes: 28 });
    lg.prims.push(...S.limb([J, K, M, F], [0.045, 0.036, 0.026, 0.008]).map((q) => sh(q).blend(0.008)));
    lg.prims.push(sh(S.sphere(0.045).at(...K).blend(0.008)), gold(orient(S.torus(0.036, 0.009), lerp3(J, K, 0.6), sub3(K, J)).paint(0.003, 0.003)));
  }
  stingTail(N, 'tail', 'torso', [[0, 0.29, -0.5], [0, 0.4, -0.76], [0, 0.64, -0.96], [0, 0.94, -0.98], [0, 1.18, -0.82], [0, 1.28, -0.58]], [0.1, 0.09, 0.084, 0.078, 0.072, 0.066], C, 0.9);
  scaleNodes(N.nodes, 0.66);
  return { kind: 'titan.scorpion', attack: 'claw', u: 0.66, nodes: finish(N.nodes) };
}

const scorpionAnim = (rig, inner, c, base) => arthroAnim(rig, inner, c, base, false);

// ---------------- sphinx ----------------
// rig: torso, head, legs[4], shins[4], tail[]
function sphinx(def, o = {}) {
  const stone = col(o.stone, 0xe8e0d0), trim = col(o.trim, 0xd8b03a);
  const stoneD = tone(stone, 0, 0, -0.1), lapis = col(o.accent, 0x2a4a9a);
  const st = (q) => q.color(stone).pbr(0.22, 0.02).tint(0.1, 4.5);
  const gold = (q) => q.color(trim).pbr(0.28, 0.95);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.58, 0], { rig: 'torso', detail: 0.8 });
  {
    const p = torso.prims;
    p.push(st(S.ellipsoid(0.2, 0.24, 0.29).rot(-8, 0, 0).at(0, 0.62, 0.28)));
    p.push(st(S.ellipsoid(0.165, 0.185, 0.34).at(0, 0.61, -0.05).blend(0.06)));
    p.push(st(S.ellipsoid(0.2, 0.22, 0.24).at(0, 0.59, -0.36).blend(0.05)));
    p.push(st(S.capsule([0, 0.72, 0.36], [0, 0.82, 0.44], 0.15, 0.13).blend(0.05)));
    p.push(...S.mirrorX([st(S.ellipsoid(0.085, 0.15, 0.13).at(0.14, 0.62, 0.32).blend(0.03)), st(S.ellipsoid(0.1, 0.17, 0.16).rot(15, 0, 0).at(0.14, 0.59, -0.37).blend(0.03))]));
    // stylised carving: ribs and the line of the flank
    for (let i = 0; i < 5; i++) p.push(...S.mirrorX([S.box(0.2, 0.24, 0.012, 0.002).rot(0, 0, -14).rot(-14, 0, 0).at(0.14, 0.6, 0.1 - i * 0.075).color(stoneD).paint(0.003, -0.005)]));
    // a broad collar of gold and blue, and a saddle-cloth carved in the stone
    p.push(gold(S.ellipsoid(0.215, 0.2, 0.17).rot(-50, 0, 0).at(0, 0.7, 0.4).paint(0.004, 0.006)));
    for (let i = 0; i < 3; i++) p.push(S.torus(0.14 + i * 0.045, 0.012).rot(-50, 0, 0).rot(90, 0, 0).at(0, 0.7 - i * 0.02, 0.43 + i * 0.03).color(i % 2 ? trim : lapis).pbr(0.3, 0.5).paint(0.003, 0.002));
    p.push(S.box(0.5, 0.3, 0.36, 0.02).at(0, 0.74, -0.08).color(lapis).pbr(0.3, 0.2).paint(0.004, 0.005));
    for (const z of [0.1, -0.26]) p.push(gold(S.box(0.5, 0.3, 0.03, 0.004).at(0, 0.74, z).paint(0.003, 0.007)));
    p.push(...S.mirrorX([gold(S.box(0.03, 0.03, 0.36, 0.004).at(0.165, 0.615, -0.08).paint(0.004, 0.007))]));
  }
  const NB = [0, 0.82, 0.42];
  const head = N('head', 'torso', NB, { rig: 'head', detail: 1.25 });
  {
    const p = head.prims, hy = 1.12, hz = 0.53, R = 0.1;
    p.push(st(S.capsule(NB, [0, 1.02, 0.5], 0.115, 0.1)));
    // the headcloth: dome, wings beside the face, lappets on the breast, a bound queue behind
    const cl = (q) => q.color(trim).pbr(0.3, 0.9);
    p.push(cl(S.ellipsoid(R * 1.12, R * 1.08, R * 1.16).at(0, hy + 0.035, hz - 0.03).blend(0.01)));
    p.push(...S.mirrorX([
      cl(S.ellipsoid(0.055, 0.14, 0.085).rot(0, 0, 24).at(0.125, hy - 0.04, hz - 0.03).blend(0.03)),
      cl(S.box(0.085, 0.27, 0.035, 0.012).rot(8, 0, -4).at(0.105, hy - 0.23, hz + 0.055).blend(0.02)),
    ]));
    p.push(cl(S.capsule([0, hy - 0.04, hz - 0.12], [0, hy - 0.27, hz - 0.15], 0.06, 0.035).blend(0.03)));
    for (let i = 0; i < 16; i++) p.push(S.box(0.5, 0.018, 0.5, 0.002).at(0, hy + 0.13 - i * 0.036, hz).color(lapis).pbr(0.3, 0.25).paint(0.002, -0.002));
    p.push(gold(S.torus(R * 1.06, 0.016).rot(-12, 0, 0).at(0, hy + 0.062, hz - 0.01).blend(0.004)));                  // brow band
    // the face, carved after the cloth so the stripes stop at it
    p.push(st(S.ellipsoid(R * 0.86, R * 1.1, R * 0.9).at(0, hy - 0.012, hz + 0.022).blend(0.004)));
    p.push(st(S.ellipsoid(R * 0.6, R * 0.48, R * 0.55).at(0, hy - R * 0.72, hz + 0.045).blend(0.03)));
    p.push(st(S.capsule([0, hy + 0.012, hz + R * 0.86], [0, hy - 0.036, hz + R * 1.04], 0.013, 0.02).blend(0.018)));
    p.push(...S.mirrorX([
      st(S.capsule([0.014, hy + 0.03, hz + R * 0.84], [0.062, hy + 0.034, hz + R * 0.62], 0.01, 0.012).blend(0.012)),
      S.ellipsoid(0.022, 0.011, 0.012).at(0.037, hy + 0.006, hz + R * 0.8).color(stoneD).cut(0.004),
      st(S.ellipsoid(0.024, 0.02, 0.018).at(0.05, hy - 0.04, hz + R * 0.66).blend(0.02)),
      st(S.ellipsoid(0.012, 0.03, 0.02).at(R * 0.86, hy - 0.01, hz + 0.01).blend(0.008)),
    ]));
    p.push(st(S.ellipsoid(0.03, 0.009, 0.012).at(0, hy - 0.058, hz + R * 0.86).blend(0.006)), st(S.ellipsoid(0.026, 0.008, 0.012).at(0, hy - 0.072, hz + R * 0.84).blend(0.006)));
    p.push(S.box(0.05, 0.004, 0.02, 0.001).at(0, hy - 0.065, hz + R * 0.9).color(stoneD).paint(0.002, -0.003));
    // the ceremonial beard
    p.push(gold(S.cone(0.03, 0.02, 0.15, 0.008).rot(-8, 0, 0).at(0, hy - 0.19, hz + 0.06).blend(0.004)));
    for (let i = 0; i < 4; i++) p.push(S.torus(0.027, 0.006).rot(-8, 0, 0).at(0, hy - 0.14 - i * 0.03, hz + 0.066 - i * 0.004).color(lapis).paint(0.002, 0.001));
    for (const sx of [1, -1]) head.hard.push(H.sphere(0.0125, 10).scale(1.5, 0.8, 0.6).at(0.037 * sx, hy + 0.006, hz + R * 0.775).color(lapis).glow(0.9).pbr(0.2));
    // the rearing serpent on the brow
    head.hard.push(H.tube([[0, hy + 0.06, hz + R * 0.98], [0, hy + 0.1, hz + R * 1.14], [0, hy + 0.15, hz + R * 1.08]], [0.012, 0.014, 0.01], 8, 6).color(trim).pbr(0.28, 0.95));
    head.hard.push(H.sphere(0.02, 8).scale(1.3, 1, 0.5).at(0, hy + 0.13, hz + R * 1.12).color(trim).pbr(0.28, 0.95).lod(2));
  }
  const paw = (k) => ({ kind: 'paw', len: 0.17 * k, w: 0.078 * k, toes: 4, clawLen: 0, spread: 0.26 });
  const F = [[0.15, 0.56, 0.33], [0.16, 0.32, 0.33], [0.16, 0.11, 0.34], [0.16, 0, 0.35]], B = [[0.16, 0.56, -0.38], [0.19, 0.35, -0.28], [0.18, 0.14, -0.44], [0.18, 0, -0.4]];
  const legs = [addLeg(N, 'FL', 'torso', 1, F, [0.09, 0.07, 0.062], st, { detail: 0.8, foot: paw(1) }), addLeg(N, 'FR', 'torso', -1, F, [0.09, 0.07, 0.062], st, { detail: 0.8, foot: paw(1) }),
    addLeg(N, 'BL', 'torso', 1, B, [0.115, 0.072, 0.056], st, { detail: 0.8, foot: paw(0.95) }), addLeg(N, 'BR', 'torso', -1, B, [0.115, 0.072, 0.056], st, { detail: 0.8, foot: paw(0.95) })];
  legs.forEach((lg, i) => { lg.lo.prims.push(gold(orient(S.torus(i < 2 ? 0.068 : 0.06, 0.016), lerp3(lg.K, lg.A, 0.8), sub3(lg.A, lg.K)).paint(0.003, 0.005))); });
  const tn = addChain(N, 'tail', 'torso', [[0, 0.64, -0.56], [0, 0.6, -0.78], [0, 0.72, -0.95], [0, 0.93, -0.94], [0, 1.04, -0.8]], [0.04, 0.034, 0.03, 0.028, 0.026], st, { rig: 'tail', detail: 0.9, minRes: 40 });
  tn[tn.length - 1].prims.push(gold(S.ellipsoid(0.045, 0.07, 0.045).rot(50, 0, 0).at(0, 1.07, -0.75).blend(0.01)));
  scaleNodes(N.nodes, 0.86);
  return { kind: 'titan.sphinx', attack: 'slam', u: 0.86, nodes: finish(N.nodes) };
}

function sphinxAnim(rig, inner, c, base) {
  const { R, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), ph = c.phase || 0, a = c.atk;
  // stone moves in steps: time is quantised, each pose held and then ground into the next
  const q = (x, n) => { const f = x * n, i = Math.floor(f), r = f - i; return (i + Math.min(1, r * 2.5)) / n; };
  const t = q(c.t, 4);
  const L = rig.legs || [], Sh = rig.shins || [], k = c.moving ? 1 : 0;
  const gait = walk4(rig, { ...c, t }, base, 5, 0.3, 0.42, -0.35);
  let slam = 0, rear = 0;
  if (a >= 0) { const aq = q(a, 8); rear = keys(aq, [[0, 0], [0.38, 1], [0.56, 0], [1, 0]]); slam = keys(aq, [[0, 0], [0.38, -1.5], [0.56, 0.25], [1, 0]]); R(L[1], slam); R(Sh[1], keys(aq, [[0, 0], [0.38, -0.9], [0.56, 0], [1, 0]])); R(L[0], -0.2 * rear); }
  R(rig.torso, -0.16 * rear, Math.sin(gait) * 0.025 * k, 0);
  R(rig.head, 0.1 * rear, Math.sin(q(c.t, 1.5) * 0.9 + ph) * 0.3 * (1 - k) * (a >= 0 ? 0 : 1));
  (rig.tail || []).forEach((x, i) => R(x, 0, Math.sin(q(c.t, 2) * 1.2 + ph + i) * 0.05, 0));
  if (dieSide(inner, c, base, 0.2)) return;
  inner.position.z = 0;
  inner.position.y = k * Math.abs(Math.sin(gait)) * 0.012 * s;
}

// =====================================================================================
//  GIANT CRAB and the ROTTING LEVIATHAN
// =====================================================================================
// crab rig: torso, legs[8] (one node each), arms[2], forearms[2], pincers[2]

function crab(def, o = {}) {
  if (o.kind === 'leviathan') return leviathan(def, o);
  const shell = col(o.shell, 0x7a4a3a);
  const C = { shell, dark: tone(shell, -0.01, 0.02, -0.12), pale: mix(shell, 0xe8d8b8, 0.62), tip: tone(shell, -0.02, 0, -0.26), wart: tone(shell, 0.02, 0.05, 0.08) };
  const rnd = rng(hashStr(def?.id || 'crab'));
  const sh = (q) => q.color(shell).bump(0.01, 13, 'rock').tint(0.2, 7).pbr(0.42, 0.04);
  const smooth_ = (q) => q.color(shell).bump(0.006, 20, 'rock').tint(0.22, 9).pbr(0.4, 0.04);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.42, 0], { rig: 'torso', detail: 0.72 });
  {
    const p = torso.prims;
    p.push(sh(S.ellipsoid(0.52, 0.3, 0.39).at(0, 0.52, -0.02)));
    p.push(sh(S.ellipsoid(0.4, 0.2, 0.2).at(0, 0.5, 0.22).blend(0.06)));
    p.push(...S.mirrorX([sh(S.ellipsoid(0.2, 0.17, 0.24).at(0.34, 0.56, -0.02).blend(0.07)), sh(S.ellipsoid(0.16, 0.12, 0.14).at(0.2, 0.74, -0.1).blend(0.06)).color(C.wart)]));
    p.push(sh(S.ellipsoid(0.2, 0.12, 0.16).at(-0.06, 0.78, 0.04).blend(0.06)).color(C.wart));               // swollen, lopsided
    p.push(S.ellipsoid(0.46, 0.14, 0.33).at(0, 0.36, 0.02).color(C.pale).pbr(0.5).tint(0.12, 12).blend(0.02));
    p.push(S.ellipsoid(0.36, 0.2, 0.3).at(0, 0.72, -0.12).color(C.dark).paint(0.08));
    // grooves of the carapace
    p.push(...S.mirrorX([S.torus(0.17, 0.012).rot(18, 0, -24).at(0.19, 0.66, 0.06).color(C.tip).paint(0.004, -0.008), S.box(0.012, 0.3, 0.3, 0.002).rot(0, 24, 0).at(0.1, 0.72, -0.2).color(C.tip).paint(0.004, -0.007)]));
    for (let i = 0; i < 16; i++) { const a = rnd() * 6.283, r = 0.1 + rnd() * 0.32; const x = Math.sin(a) * r, z = Math.cos(a) * r * 0.7 - 0.03; p.push(S.sphere(0.022 + rnd() * 0.02).at(x, 0.52 + 0.3 * Math.sqrt(Math.max(0.03, 1 - (x / 0.52) ** 2 - ((z + 0.02) / 0.39) ** 2)), z).color(C.wart).pbr(0.4).blend(0.012)); }
    // mouthparts
    p.push(...S.mirrorX([S.box(0.07, 0.11, 0.03, 0.012).rot(-12, 0, 6).at(0.04, 0.4, 0.37).color(C.pale).pbr(0.45).blend(0.006)]));
    for (const sx of [1, -1]) {
      for (let i = 0; i < 6; i++) { const f = i / 5, x = (0.12 + f * 0.36) * sx, z = 0.4 - f * f * 0.22; torso.hard.push(spike([x, 0.5, z], [sx * (0.3 + f), 0.15, 1 - f * 0.6], 0.07, 0.03, C.tip, [0, 1, 0], 0.2, 0.6).lod(2)); }
      const eb = [0.1 * sx, 0.56, 0.36], et = [0.13 * sx, 0.7, 0.44];
      torso.hard.push(H.tube([eb, lerp3(eb, et, 0.6), et], 0.016, 5, 6).color(C.pale).pbr(0.5));
      torso.hard.push(H.sphere(0.036, 12).scale(0.9, 1.25, 0.9).at(...et).color(0x0c0a0a).pbr(0.08).shade((x, y) => (y > 0.02 ? 0x3a1410 : null)));
      torso.hard.push(H.tube([[0.03 * sx, 0.5, 0.4], [0.07 * sx, 0.56, 0.56], [0.16 * sx, 0.52, 0.66]], [0.008, 0.005, 0.002], 6, 4).color(C.tip).lod(1));
    }
    if (o.barnacles) {
      const spots = [[0.2, 0.3], [-0.3, -0.1], [0.05, -0.3], [-0.12, 0.2], [0.38, -0.12], [-0.4, 0.1], [0.3, -0.3], [-0.2, -0.26], [0.0, 0.02]];
      for (const [x, z] of spots) { const y = 0.52 + 0.3 * Math.sqrt(Math.max(0.03, 1 - (x / 0.52) ** 2 - ((z + 0.02) / 0.39) ** 2)); torso.hard.push(barnacles([x, y, z], norm3([x * 0.8, 1, z]), 0.035 + rnd() * 0.02, rnd, 6)); }
      for (let i = 0; i < 9; i++) { const a = Math.PI * (0.25 + 1.5 * (i / 8)); torso.hard.push(ribbon([Math.sin(a) * 0.5, 0.48 + rnd() * 0.08, Math.cos(a) * 0.36 - 0.03], 0.18 + rnd() * 0.14, 0.03, i % 2 ? 0x3a5a2a : 0x5a6a2a, [Math.sin(a), 0, Math.cos(a)], rnd)); }
    }
  }
  // claws: the right one is the crusher
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', k = sx > 0 ? 1 : 1.4, X = sideX(sx);
    const Sp = X([0.36, 0.42, 0.26]), El = X([0.62, 0.44, 0.46]), Wr = X([0.56, 0.44, 0.46 + 0.22 * k]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.75 });
    up.prims.push(smooth_(S.capsule(Sp, El, 0.085 * k, 0.09 * k)), smooth_(S.sphere(0.1 * k).at(...El).blend(0.01)));
    for (let i = 0; i < 3; i++) up.hard.push(spike(add3(lerp3(Sp, El, 0.4 + i * 0.25), [0, 0.07 * k, 0]), [sx * 0.3, 1, 0.2], 0.05, 0.02, C.tip, [0, 0, 1], 0.2).lod(1));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.75 });
    fo.prims.push(smooth_(S.sphere(0.095 * k).at(...El)), smooth_(S.capsule(El, Wr, 0.085 * k, 0.1 * k).blend(0.01)));
    const hc = add3(Wr, [-sx * 0.02, 0, 0.17 * k]);
    fo.prims.push(sh(S.ellipsoid(0.15 * k, 0.14 * k, 0.21 * k).at(...hc).blend(0.015)));
    fo.prims.push(S.ellipsoid(0.1 * k, 0.06 * k, 0.18 * k).at(hc[0], hc[1] - 0.09 * k, hc[2]).color(C.pale).paint(0.03));
    const f0 = add3(hc, [-sx * 0.02, -0.06 * k, 0.14 * k]);
    fo.prims.push(...S.limb([f0, add3(f0, [0, -0.02 * k, 0.17 * k]), add3(f0, [0, 0.03 * k, 0.33 * k])], [0.075 * k, 0.055 * k, 0.016]).map((q) => smooth_(q).color(C.tip).blend(0.02)));
    for (let i = 0; i < 4; i++) fo.hard.push(H.sphere(0.02 * k, 6).at(f0[0], f0[1] + 0.045 * k, f0[2] + (0.08 + i * 0.055) * k).color(C.pale).lod(1));
    for (let i = 0; i < 4; i++) fo.hard.push(spike(add3(hc, [(i - 1.5) * 0.05 * k, 0.12 * k, -0.04 * k + (i % 2) * 0.06]), [(i - 1.5) * 0.3, 1, 0], 0.05 * k, 0.02 * k, C.tip, [0, 0, 1], 0.2).lod(1));
    const PV = add3(hc, [0, 0.05 * k, 0.1 * k]);
    const pn = N(`pincer${nm}`, `fore${nm}`, PV, { rig: 'pincers', detail: 0.75 });
    pn.prims.push(...S.limb([PV, add3(PV, [0, 0.07 * k, 0.17 * k]), add3(PV, [0, 0.0, 0.36 * k])], [0.07 * k, 0.052 * k, 0.015]).map((q) => smooth_(q).color(C.tip).blend(0.02)));
    for (let i = 0; i < 4; i++) pn.hard.push(H.sphere(0.02 * k, 6).at(PV[0], PV[1] + (0.0 - i * 0.004) * k, PV[2] + (0.1 + i * 0.055) * k).color(C.pale).lod(1));
  }
  // walking legs
  for (const sx of [1, -1]) for (let i = 0; i < 4; i++) {
    const z0 = 0.12 - i * 0.115, sp = (1.2 - i) * 0.2, X = sideX(sx);
    const J = X([0.4, 0.4, z0]), K = X([0.74, 0.66, z0 + sp * 0.8]), M = X([0.98, 0.36, z0 + sp * 1.35]), F = X([1.06, 0.0, z0 + sp * 1.55]);
    const lg = N(`leg${sx > 0 ? 'L' : 'R'}${i}`, 'torso', J, { rig: 'legs', detail: 0.75, minRes: 18 });
    lg.prims.push(...S.limb([J, K], [0.07, 0.06]).map((q) => smooth_(q)), smooth_(S.sphere(0.066).at(...K).blend(0.01)), smooth_(S.capsule(K, M, 0.056, 0.042).blend(0.01)), smooth_(S.capsule(M, F, 0.04, 0.01).blend(0.01)).color(C.tip));
    lg.prims.push(S.capsule(add3(J, [0, -0.03, 0]), add3(K, [0, -0.03, 0]), 0.055, 0.045).color(C.pale).paint(0.02));
    for (let j = 0; j < 3; j++) lg.hard.push(spike(add3(lerp3(K, M, 0.2 + j * 0.3), [0, 0.04, 0]), [sx * 0.6, 1, 0], 0.035, 0.012, C.tip, [0, 0, 1], 0.2).lod(0));
  }
  scaleNodes(N.nodes, 0.66);
  return { kind: 'titan.crab', attack: 'slam', u: 0.66, nodes: finish(N.nodes) };
}

/** scorpion and crab: many single-node legs, clawed arms; crabs raise and hammer their claws and die on their backs */
function arthroAnim(rig, inner, c, base, isCrab) {
  const { R, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk;
  const k = c.moving ? 1 : 0, gait = t * (isCrab ? 10 : 12) + ph, idle = Math.sin(t * 1.3 + ph);
  const dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 2) : 0;
  (rig.legs || []).forEach((l, i) => {
    const sg = sgn(l, i), an = gait + (i % 2) * Math.PI + (i % 4) * 0.5;
    const lift = k * Math.max(0, Math.cos(an)) * 0.2, sweep = k * Math.sin(an) * 0.22;
    R(l, 0, sweep * sg, dead ? -sg * (isCrab ? 0.5 + 0.2 * Math.sin(i * 2.4) : 0.75) * df : lift * sg + sg * idle * 0.01);
  });
  const st = stingAnim(rig, c, base, 1.05);
  const hit = a >= 0 ? keys(a, [[0, 0], [0.36, -1], [0.54, 0.5], [1, 0]]) : 0;
  const snap = a >= 0 ? keys(a, [[0, 0], [0.25, 1], [0.45, 0], [0.6, 0.6], [1, 0]]) : 0.5 + 0.5 * Math.sin(t * 2.2 + ph);
  (rig.arms || []).forEach((x, i) => { const sg = sgn(x, i); R(x, isCrab ? 0.5 * hit * (i ? 1 : 0.5) + Math.sin(t * 1.2 + i * 2 + ph) * 0.04 : 0, sg * (Math.sin(t * 1.1 + i * 2 + ph) * 0.1 - (a >= 0 ? 0.25 * bellK(a) : 0)), sg * (0.05 * idle + (a >= 0 && !isCrab ? 0.2 * bellK(a) : 0))); });
  (rig.forearms || []).forEach((x, i) => { const sg = sgn(x, i); R(x, isCrab ? 0.4 * hit * (i ? 1 : 0.5) : 0, sg * (Math.sin(t * 0.9 + i * 2.6 + ph) * 0.12 + (a >= 0 ? -0.3 * bellK(a) : 0)), 0); });
  (rig.pincers || []).forEach((x, i) => { const sg = sgn(x, i); if (isCrab) R(x, -(0.08 + 0.4 * snap) * (dead ? 0.3 : 1), 0, 0); else R(x, 0, sg * (0.1 + 0.3 * snap) * (dead ? 0.3 : 1), 0); });
  R(rig.torso, a >= 0 ? (isCrab ? -0.12 * Math.max(0, -hit) + 0.08 * Math.max(0, hit) : 0.08 * st) : idle * 0.01, 0, isCrab ? Math.sin(gait * 0.5) * 0.03 * k : 0);
  inner.position.z = (a >= 0 ? keys(a, [[0, 0], [0.3, -0.05], [0.5, 0.14], [1, 0]]) : 0) * s;
  if (isCrab) {
    inner.rotation.z = dead ? df * Math.PI : 0;
    inner.position.y = (dead ? 0.9 * Math.sin(df * Math.PI * 0.5) * (0.6 + 0.4 * df) - Math.max(0, c.dead - 0.5) * 0.8 : Math.sin(t * 3 + ph) * 0.01 + k * Math.abs(Math.sin(gait)) * 0.012) * s;
  } else {
    inner.rotation.z = dead ? df * 0.35 : 0;
    inner.position.y = (dead ? -0.08 * df - Math.max(0, c.dead - 0.5) * 0.6 : Math.sin(t * 3 + ph) * 0.008 + k * Math.abs(Math.sin(gait)) * 0.01) * s;
    if (dead) (rig.tail || []).forEach((x, i) => R(x, (i === 0 ? -1.15 : -0.3) * df, 0, 0.12 * df * (i % 2 ? 1 : -1)));
  }
}

// ---------------- leviathan ----------------
// rig: torso, head, jaw, legs[4] (flippers: front pair, hind pair), tail[]
function leviathan(def, o) {
  const hide = col(o.shell, 0x5a6a5a);
  const C = { hide, dark: tone(hide, 0.02, 0, -0.12), pale: mix(hide, 0xd8d0b0, 0.6), rot: 0x5a1c20, rotD: 0x2a0c10, bone: 0xd8cfae, weed: 0x3a5a2a, weed2: 0x5a6a2a };
  const rnd = rng(hashStr(def?.id || 'leviathan'));
  const sk = (q) => q.color(hide).bump(0.012, 9, 'noise').tint(0.25, 5).pbr(0.4, 0.02);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.3, 0], { rig: 'torso', detail: 0.66 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.36, 0.31, 0.5).at(0, 0.33, 0.08)));
    p.push(sk(S.ellipsoid(0.3, 0.26, 0.36).at(0, 0.3, -0.36).blend(0.08)));
    p.push(sk(S.capsule([0, 0.36, 0.4], [0, 0.36, 0.58], 0.3, 0.26).blend(0.07)));
    p.push(sk(S.capsule([0, 0.28, -0.6], [0, 0.26, -0.74], 0.22, 0.19).blend(0.06)));
    p.push(S.ellipsoid(0.3, 0.14, 0.7).at(0, 0.12, 0).color(C.pale).paint(0.07));
    p.push(S.ellipsoid(0.2, 0.12, 0.8).at(0, 0.62, -0.05).color(C.dark).paint(0.07));
    // rot: sloughing patches, and a flank laid open to the ribs
    for (const [x, y, z, r] of [[-0.3, 0.42, 0.2, 0.12], [-0.22, 0.5, -0.4, 0.1], [0.1, 0.6, 0.3, 0.09], [0.2, 0.2, -0.5, 0.1]]) p.push(S.ellipsoid(r * 1.5, r * 0.9, r * 1.2).rot(x * 90, y * 200, z * 60).at(x, y, z).color(C.rot).pbr(0.35).tint(0.45, 22).paint(0.035, -0.004), S.ellipsoid(r * 0.7, r * 0.5, r * 0.6).rot(x * 90, y * 200, z * 60).at(x, y, z).color(C.rotD).tint(0.3, 30).paint(0.03, -0.004));
    p.push(S.ellipsoid(0.2, 0.22, 0.3).at(0.33, 0.42, -0.02).color(C.rotD).cut(0.03));
    p.push(S.ellipsoid(0.17, 0.17, 0.25).at(0.2, 0.36, -0.02).color(C.rot).pbr(0.3).tint(0.3, 12).blend(0.02));
    for (let i = 0; i < 7; i++) {
      const z = 0.22 - i * 0.08;
      torso.hard.push(H.tube([[0.1, 0.62, z], [0.27, 0.56, z + 0.01], [0.345, 0.4, z + 0.015], [0.32, 0.22, z + 0.01], [0.2, 0.1, z]], [0.022, 0.019, 0.017, 0.014, 0.01], 10, 5).color(i % 2 ? C.bone : tone(C.bone, 0, 0, -0.08)).pbr(0.6));
    }
    // knobs of the spine
    for (let i = 0; i < 12; i++) p.push(S.ellipsoid(0.03, 0.03, 0.04).at(0, 0.64 - Math.pow((i - 5) / 6.5, 2) * 0.12 - (i > 8 ? (i - 8) * 0.03 : 0), 0.5 - i * 0.1).color(C.dark).pbr(0.4).blend(0.012));
    for (const [x, y, z] of [[-0.2, 0.58, 0.25], [0.05, 0.63, -0.2], [-0.3, 0.44, -0.2], [0.24, 0.56, 0.36], [-0.12, 0.6, -0.5], [0.2, 0.5, -0.45], [-0.33, 0.3, 0.3]]) torso.hard.push(barnacles([x, y, z], norm3([x, y - 0.3, 0]), 0.04 + rnd() * 0.025, rnd, 6));
    for (let i = 0; i < 12; i++) { const z = 0.5 - i * 0.1, sx = i % 2 ? 1 : -1; torso.hard.push(ribbon([sx * (0.28 + rnd() * 0.06), 0.4 + rnd() * 0.12, z], 0.22 + rnd() * 0.15, 0.035, i % 3 ? C.weed : C.weed2, [sx, 0.2, 0], rnd)); }
    torso.hard.push(H.tube([[-0.36, 0.3, 0.1], [0, 0.66, 0.16], [0.3, 0.5, 0.26]], 0.012, 10, 4).color(0x8a7a5a).pbr(0.9).lod(2));   // a harpoon line, long since parted
    torso.hard.push(H.cyl(0.01, 0.01, 0.4, 5).rot(0, 0, 40).rot(0, 30, 0).at(-0.2, 0.72, -0.12).color(0x5a4a36), H.cone(0.022, 0.07, 5).rot(0, 0, 40).rot(0, 30, 0).at(-0.085, 0.585, -0.05).color(0x4a4a50).pbr(0.4, 0.8).lod(2));
  }
  const head = N('head', 'torso', [0, 0.36, 0.56], { rig: 'head', detail: 0.8 });
  {
    const p = head.prims;
    p.push(sk(S.ellipsoid(0.27, 0.2, 0.3).at(0, 0.42, 0.78)));
    p.push(sk(S.capsule([0, 0.4, 0.9], [0, 0.36, 1.22], 0.2, 0.13).blend(0.05)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.07, 0.05, 0.1).at(0.2, 0.5, 0.82).blend(0.03)).color(C.dark), S.sphere(0.04).at(0.235, 0.44, 0.86).color(C.rotD).cut(0.012)]));
    p.push(S.ellipsoid(0.12, 0.1, 0.16).at(-0.2, 0.36, 1.0).color(C.bone).pbr(0.55).paint(0.02));                     // the snout rotted to the bone
    p.push(S.ellipsoid(0.1, 0.08, 0.14).at(0.14, 0.5, 1.08).color(C.rot).pbr(0.35).tint(0.45, 22).paint(0.035, -0.004));
    p.push(S.box(0.3, 0.06, 0.6, 0.02).at(0, 0.27, 0.95).color(C.rotD).paint(0.01));
    head.hard.push(H.sphere(0.036, 12).at(0.228, 0.44, 0.862).color(0xc8d0c0).pbr(0.25).shade((x, y, z) => (x > 0.02 && Math.hypot(y, z) < 0.016 ? 0x8a9a90 : null)));        // one clouded eye
    for (const sx of [1, -1]) for (let i = 0; i < 9; i++) {
      if ((i * 7 + (sx > 0 ? 0 : 3)) % 5 === 0) continue;       // gaps where teeth have fallen
      const f = i / 8, z = lerp(0.72, 1.3, f), x = lerp(0.2, 0.07, f * f) * sx;
      head.hard.push(spike([x, 0.31, z], [sx * 0.15, -1, 0.1], 0.07 + 0.03 * Math.sin(i * 2.3), 0.02, 0xd8d0b0, [0, 0, -1], 0.2).lod(i % 2 ? 1 : 2));
    }
    for (let i = 0; i < 3; i++) head.hard.push(barnacles([-0.1 + i * 0.1, 0.6 - i * 0.02, 0.74 + i * 0.12], [0, 1, 0.1], 0.035, rnd, 4));
  }
  const jaw = N('jaw', 'head', [0, 0.3, 0.6], { rig: 'jaw', detail: 0.75 });
  {
    const p = jaw.prims;
    p.push(sk(S.capsule([0, 0.2, 0.66], [0, 0.17, 1.2], 0.17, 0.1)).color(C.pale));
    p.push(...S.mirrorX([sk(S.capsule([0.19, 0.3, 0.62], [0.13, 0.2, 0.9], 0.07, 0.06).blend(0.04))]));
    p.push(S.ellipsoid(0.1, 0.04, 0.26).at(0, 0.27, 0.92).color(0x7a3a44).pbr(0.3).blend(0.015));
    p.push(S.ellipsoid(0.08, 0.08, 0.14).at(0.12, 0.16, 1.05).color(C.bone).pbr(0.55).paint(0.02));
    for (const sx of [1, -1]) for (let i = 0; i < 7; i++) { if ((i * 5 + (sx > 0 ? 1 : 0)) % 4 === 0) continue; const f = i / 6; jaw.hard.push(spike([lerp(0.14, 0.06, f) * sx, 0.26, lerp(0.8, 1.25, f)], [sx * 0.1, 1, 0.05], 0.06, 0.018, 0xd8d0b0, [0, 0, -1], 0.2).lod(i % 2 ? 1 : 2)); }
    for (let i = 0; i < 5; i++) jaw.hard.push(ribbon([(i - 2) * 0.07, 0.14, 0.85 + (i % 2) * 0.15], 0.1 + rnd() * 0.06, 0.03, C.weed, [0, 0, 1], rnd));
  }
  // flippers: the front pair haul the carcass along
  const flip = (nm, sx, J, len, wid, yaw, rig_) => {
    const n = N(nm, 'torso', [J[0] * sx, J[1], J[2]], { rig: rig_, detail: 0.66 });
    const d = [Math.cos(yaw * DEG) * sx, -0.14, -Math.sin(yaw * DEG)], c = add3([J[0] * sx, J[1], J[2]], mul3(d, len * 0.5));
    n.prims.push(sk(S.ellipsoid(len * 0.58, 0.05, wid).rot(0, yaw * sx, sx * -8).at(...c)));
    n.prims.push(sk(S.sphere(wid * 0.75).at(J[0] * sx, J[1], J[2]).blend(0.04)));
    n.prims.push(S.ellipsoid(len * 0.3, 0.06, wid * 0.5).rot(0, yaw * sx, sx * -8).at(...add3(c, mul3(d, len * 0.2))).color(C.rot).pbr(0.3).paint(0.02, -0.004));
    for (let i = 0; i < 3; i++) n.hard.push(H.tube([add3(c, mul3(d, -len * 0.1)), add3(c, add3(mul3(d, len * 0.3), [0, 0.03, (i - 1) * wid * 0.5])), add3(c, add3(mul3(d, len * 0.56), [0, 0.0, (i - 1) * wid * 0.8]))], [0.016, 0.013, 0.008], 6, 4).color(C.bone).pbr(0.6).lod(2));
    for (let i = 0; i < 4; i++) n.hard.push(ribbon(add3(c, add3(mul3(d, len * (0.1 + i * 0.12)), [0, 0, -wid * 0.8])), 0.1 + rnd() * 0.08, 0.04, C.dark, [0, 1, 0.2], rnd, 1));
  };
  flip('flipFL', 1, [0.3, 0.2, 0.3], 0.62, 0.17, 28, 'legs'); flip('flipFR', -1, [0.3, 0.2, 0.3], 0.62, 0.17, 28, 'legs');
  flip('flipBL', 1, [0.24, 0.17, -0.5], 0.36, 0.11, 40, 'legs'); flip('flipBR', -1, [0.24, 0.17, -0.5], 0.36, 0.11, 40, 'legs');
  const TL = [[0, 0.26, -0.72], [0, 0.2, -0.98], [0, 0.14, -1.2], [0, 0.11, -1.4]];
  const tn = addChain(N, 'tail', 'torso', TL, [0.19, 0.14, 0.09, 0.055], sk, { rig: 'tail', detail: 0.66, deco: (n, a, b, ra, rb, i, f) => {
    n.prims.push(S.capsule(add3(a, mul3(f.dor, -ra * 0.5)), add3(b, mul3(f.dor, -rb * 0.5)), ra * 0.7, rb * 0.7).color(C.pale).paint(0.03));
    if (i === 1) { n.prims.push(S.ellipsoid(0.1, 0.1, 0.12).at(-0.08, 0.2, -1.08).color(C.rot).pbr(0.3).paint(0.02, -0.01)); for (let q = 0; q < 3; q++) n.hard.push(H.sphere(0.035, 6).scale(1, 0.8, 0.7).at(-0.02, 0.24 - q * 0.004, -1.03 - q * 0.06).color(C.bone).lod(2)); }
  } });
  const fl = tn[tn.length - 1];
  fl.prims.push(sk(S.ellipsoid(0.26, 0.03, 0.12).rot(0, 28, 6).at(0.2, 0.1, -1.48).blend(0.03)).color(C.dark), sk(S.ellipsoid(0.17, 0.03, 0.1).rot(0, -34, -6).at(-0.14, 0.09, -1.46).blend(0.03)).color(C.dark));
  for (let i = 0; i < 4; i++) fl.hard.push(ribbon([-0.24 + i * 0.03, 0.09, -1.52 + i * 0.01], 0.12, 0.04, C.dark, [0, 1, 0], rnd, 1));
  scaleNodes(N.nodes, 0.5);
  return { kind: 'titan.leviathan', attack: 'bite', u: 0.5, nodes: finish(N.nodes) };
}

function leviathanAnim(rig, inner, c, base) {
  const { R, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk;
  const k = c.moving ? 1 : 0, g = t * 3.2 + ph, idle = Math.sin(t * 0.9 + ph), idle2 = Math.sin(t * 0.55 + ph * 1.7);
  const L = rig.legs || [];
  // the haul: both fore-flippers reach, plant and drag; the body heaves after them
  const pull = Math.sin(g), plant = Math.max(0, Math.cos(g));
  L.forEach((f, i) => {
    const sg = sgn(f, i), fr = i < 2;
    R(f, 0, sg * (fr ? pull * 0.5 * k + idle * 0.04 : -pull * 0.25 * k), sg * (fr ? plant * 0.35 * k : 0.05 * plant * k) + sg * 0.03 * idle);
  });
  let hx = idle * 0.03 - 0.06 * pull * k, jaw = 0.12 + 0.1 * Math.max(0, idle2), pz = 0;
  if (a >= 0) { hx = keys(a, [[0, 0], [0.34, -0.4], [0.54, 0.22], [1, 0]]); jaw = keys(a, [[0, 0.12], [0.34, 0.85], [0.5, 0.9], [0.6, 0.05], [1, 0.12]]); pz = keys(a, [[0, 0], [0.34, -0.05], [0.54, 0.22], [1, 0]]); }
  R(rig.torso, -0.03 * pull * k + idle * 0.01 + (a >= 0 ? hx * 0.2 : 0), 0, 0.03 * Math.sin(g * 0.5) * k);
  R(rig.head, hx, idle2 * 0.08); R(rig.jaw, jaw);
  (rig.tail || []).forEach((x, i) => R(x, Math.sin(t * 1.1 + ph - i) * 0.04 + 0.04 * pull * k, Math.sin(t * (k ? 1.6 : 0.7) + ph - i * 0.8) * 0.12, 0));
  if (c.dead > 0) {
    const f = Math.min(1, c.dead * 2);
    inner.rotation.z = f * 0.5; inner.position.y = (f * 0.06 - Math.max(0, c.dead - 0.5) * 0.7) * s; inner.position.z = 0;
    R(rig.head, 0.15 * f, 0, 0.2 * f); R(rig.jaw, 0.7 * f); L.forEach((x, i) => R(x, 0, 0, sgn(x, i) * -0.25 * f));
    return;
  }
  inner.rotation.z = 0;
  inner.position.z = (pz + 0.03 * plant * k) * s;
  inner.position.y = (0.02 * plant * k + 0.004 * idle) * s;
}

// =====================================================================================
//  DJINN
// =====================================================================================
// rig: lamp[], tail[] (the smoke column, rooted at the lamp's spout; the torso rides its last segment), torso, head, arms, forearms

function djinn(def, o = {}) {
  const skin = col(o.skin, 0x3a8ac8), glow = col(o.glow, 0x9ad8ff);
  const skinD = tone(skin, 0.01, 0, -0.1), gold = 0xe0b53c, goldD = 0xb8862a, cloth = col(o.cloth, 0xf2ece0), hair = 0x14121a;
  const sk = (q) => q.color(skin).tint(0.1, 14).pbr(0.5);
  const G = (q) => q.color(gold).pbr(0.28, 0.95);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  // the lamp
  const lamp = N('lamp', 'root', [0, 0, 0], { rig: 'lamp', detail: 1 });
  lamp.hard.push(H.lathe([[0, 0], [0.085, 0], [0.09, 0.012], [0.05, 0.03], [0.06, 0.05], [0.13, 0.075], [0.15, 0.11], [0.12, 0.15], [0.06, 0.168], [0.04, 0.185], [0.045, 0.2], [0.022, 0.215], [0.028, 0.235], [0, 0.245]], 18).scale(1, 1, 1.25).color(gold).pbr(0.28, 0.95)
    .shade((x, y) => (Math.abs(y - 0.11) < 0.012 || Math.abs(y - 0.012) < 0.008 ? rgb(goldD) : null)));
  lamp.hard.push(H.tube([[0, 0.1, 0.15], [0, 0.11, 0.25], [0, 0.15, 0.33], [0, 0.185, 0.36]], [0.05, 0.036, 0.026, 0.024], 10, 8).color(gold).pbr(0.28, 0.95));
  lamp.hard.push(H.torus(0.065, 0.013, 14, 6).rot(0, 90, 0).scale(1, 1.2, 1).at(0, 0.115, -0.22).color(goldD).pbr(0.3, 0.95));
  lamp.hard.push(H.sphere(0.02, 8).at(0, 0.19, 0.362).color(glow).glow(1.8).lod(2));
  // the smoke column
  const SP = [[0, 0.19, 0.36], [0.07, 0.3, 0.24], [-0.07, 0.44, 0.1], [0.05, 0.6, 0.0], [0, 0.78, 0]];
  const sr = [0.03, 0.065, 0.105, 0.15, 0.2];
  const smoke = (f) => (q) => q.color(mix(glow, skin, smooth(f * 1.1))).glow(lerp(0.75, 0.12, f)).bump(0.016, 11, 'noise').tint(0.15, 8).pbr(0.9);
  let si = 0;
  const tn = addChain(N, 'tail', 'root', SP, sr, (q) => smoke(Math.min(1, si / 3.6))(q), { rig: 'tail', detail: 0.8, minRes: 30, cap: false, deco: (n, a, b, ra, rb, i, f) => {
    si = i + 1;
    // puffs wreathing the column, and a pale spiral winding up it
    for (let j = 0; j < 3; j++) { const an = i * 2.1 + j * 2.2, u = (j + 0.5) / 3, c = lerp3(a, b, u), r = lerp(ra, rb, u); n.prims.push(smoke(Math.min(1, (i + u) / 4))(S.sphere(r * 0.62).at(c[0] + Math.cos(an) * r * 0.7, c[1], c[2] + Math.sin(an) * r * 0.7).blend(0.03))); }
    n.prims.push(orient(S.torus(lerp(ra, rb, 0.5) * 1.02, 0.02), lerp3(a, b, 0.5), add3(f.t, [0.5, 0, 0.3])).color(mix(glow, 0xffffff, 0.5)).glow(0.9).paint(0.02));
  } });
  const waist = tn[tn.length - 1].name;
  const torso = N('torso', waist, [0, 0.78, 0], { rig: 'torso', detail: 0.9 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.185, 0.13, 0.14).at(0, 0.86, 0.0)));
    p.push(sk(S.ellipsoid(0.17, 0.15, 0.125).at(0, 0.97, 0.01).blend(0.05)));
    p.push(sk(S.ellipsoid(0.265, 0.18, 0.165).at(0, 1.14, 0.0).blend(0.06)));
    p.push(...S.mirrorX([
      sk(S.ellipsoid(0.12, 0.095, 0.075).rot(0, 0, 8).at(0.115, 1.17, 0.11).blend(0.03)),         // pectorals
      sk(S.ellipsoid(0.1, 0.16, 0.09).rot(0, 0, 14).at(0.2, 1.06, -0.05).blend(0.05)),             // lats
      sk(S.ellipsoid(0.11, 0.07, 0.09).rot(0, 0, -28).at(0.15, 1.28, -0.02).blend(0.04)),          // traps
    ]));
    for (let i = 0; i < 3; i++) p.push(...S.mirrorX([sk(S.ellipsoid(0.048, 0.036, 0.03).at(0.05, 1.03 - i * 0.068, 0.118 - i * 0.004).blend(0.018))]));
    p.push(S.box(0.008, 0.26, 0.05, 0.002).at(0, 0.97, 0.135).color(skinD).paint(0.004, -0.004));
    p.push(sk(S.capsule([0, 1.25, 0.0], [0, 1.34, 0.015], 0.078, 0.07).blend(0.03)));
    // sash and collar
    p.push(S.torus(0.17, 0.05).at(0, 0.82, 0).color(cloth).pbr(0.75).bump(0.004, 40, 'ridges').blend(0.012));
    p.push(G(S.torus(0.185, 0.02).at(0, 0.86, 0).blend(0.004)));
    p.push(S.box(0.1, 0.22, 0.03, 0.012).rot(8, 0, 6).at(0.08, 0.72, 0.17).color(cloth).pbr(0.75).blend(0.01));
    p.push(G(S.torus(0.1, 0.022).rot(18, 0, 0).at(0, 1.27, 0.02).blend(0.004)));
    torso.hard.push(H.sphere(0.03, 10).scale(1, 1.2, 0.6).at(0, 0.85, 0.19).color(glow).glow(1.6));
    torso.hard.push(H.sphere(0.024, 10).scale(1, 1.3, 0.6).at(0, 1.21, 0.125).color(glow).glow(1.6).lod(2));
  }
  const head = N('head', 'torso', [0, 1.33, 0.012], { rig: 'head', detail: 1.5 });
  {
    const p = head.prims, hy = 1.43, hz = 0.03, R = 0.09;
    p.push(sk(S.ellipsoid(R * 0.94, R * 1.14, R * 1.02).at(0, hy, hz)));
    p.push(sk(S.ellipsoid(R * 0.72, R * 0.55, R * 0.66).at(0, hy - R * 0.7, hz + R * 0.3).blend(0.035)));
    p.push(sk(S.capsule([0, hy + 0.012, hz + R * 0.94], [0, hy - 0.03, hz + R * 1.14], 0.014, 0.022).blend(0.015)));
    p.push(...S.mirrorX([
      sk(S.capsule([0.012, hy + 0.03, hz + R * 0.94], [0.07, hy + 0.048, hz + R * 0.66], 0.014, 0.018).blend(0.012)).color(hair),
      S.sphere(0.017).at(0.037, hy + 0.008, hz + R * 0.86).color(0x0c1420).cut(0.005),
      sk(S.ellipsoid(0.012, 0.04, 0.02).rot(-15, 0, -24).at(R * 0.98, hy + 0.01, hz - 0.005).blend(0.008)),
      sk(S.ellipsoid(0.022, 0.018, 0.018).at(0.05, hy - 0.03, hz + R * 0.72).blend(0.015)),
    ]));
    p.push(S.box(0.05, 0.007, 0.03, 0.002).at(0, hy - 0.062, hz + R * 0.88).color(0x0c1420).cut(0.003));
    p.push(S.cone(0.034, 0.008, 0.12, 0.006).rot(170, 0, 0).at(0, hy - 0.15, hz + R * 0.7).color(hair).bump(0.004, 50, 'fur').blend(0.01));     // pointed beard
    p.push(...S.mirrorX([S.capsule([0.012, hy - 0.05, hz + R * 0.98], [0.06, hy - 0.085, hz + R * 0.84], 0.008, 0.005).color(hair).blend(0.004)]));
    // turban with a jewel and a plume, a topknot spilling out behind
    p.push(S.ellipsoid(R * 1.2, R * 0.72, R * 1.22).at(0, hy + R * 0.82, hz - 0.012).color(cloth).pbr(0.75).blend(0.006));
    for (let i = 0; i < 4; i++) p.push(S.torus(R * (1.12 - i * 0.14), 0.024).rot(i % 2 ? 14 : -12, 0, i % 2 ? -10 : 12).at(0, hy + R * (0.62 + i * 0.26), hz - 0.012).color(i === 1 ? gold : cloth).pbr(i === 1 ? 0.3 : 0.75, i === 1 ? 0.9 : 0).blend(0.008));
    p.push(...S.limb([[0, hy + R * 1.4, hz - 0.03], [0, hy + R * 1.75, hz - 0.1], [0, hy + R * 1.2, hz - 0.22], [0, hy + R * 0.3, hz - 0.25]], [0.035, 0.03, 0.026, 0.01]).map((q) => q.color(hair).bump(0.004, 50, 'fur').blend(0.012)));
    p.push(G(S.torus(0.032, 0.012).rot(60, 0, 0).at(0, hy + R * 1.62, hz - 0.075).blend(0.003)));
    for (const sx of [1, -1]) {
      head.hard.push(glowEye([0.037 * sx, hy + 0.008, hz + R * 0.83], 0.011, mix(glow, 0xffffff, 0.4), 1.9));
      head.hard.push(H.torus(0.02, 0.005, 10, 5).at(R * 1.02 * sx, hy - 0.04, hz).rot(0, 0, 0).color(gold).pbr(0.28, 0.95).lod(1));
    }
    head.hard.push(H.geo(cached('octa', () => new THREE.OctahedronGeometry(1, 0))).scale(0.022, 0.03, 0.012).at(0, hy + R * 0.78, hz + R * 1.2).color(glow).glow(1.8));
    head.hard.push(feather([0, hy + R * 0.9, hz + R * 1.1], [0, 1, -0.25], 0.17, 0.03, [rgb(cloth), rgb(glow)], [0, 0, 1], 1).lod(2));
  }
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.31, 1.21, 0.0]), El = X([0.36, 0.95, -0.01]), Wr = X([0.36, 0.71, 0.05]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.9 });
    up.prims.push(sk(S.capsule(Sp, El, 0.085, 0.066)), sk(S.sphere(0.105).at(...Sp).blend(0.03)), sk(S.ellipsoid(0.08, 0.1, 0.085).at(...add3(lerp3(Sp, El, 0.45), [0, 0, 0.025])).blend(0.03)));
    up.prims.push(G(orient(S.torus(0.083, 0.016), lerp3(Sp, El, 0.62), sub3(El, Sp)).blend(0.004)));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.95 });
    fo.prims.push(sk(S.sphere(0.066).at(...El)), sk(S.capsule(El, Wr, 0.07, 0.05).blend(0.015)));
    fo.prims.push(G(S.capsule(lerp3(El, Wr, 0.42), lerp3(El, Wr, 0.92), 0.066, 0.058).blend(0.003)));
    fo.prims.push(S.torus(0.062, 0.008).rot(14, 0, 0).at(...lerp3(El, Wr, 0.67)).color(goldD).paint(0.003, 0.003));
    fo.prims.push(sk(S.ellipsoid(0.055, 0.065, 0.05).at(Wr[0], Wr[1] - 0.06, Wr[2] + 0.01).blend(0.012)));
    for (let i = 0; i < 4; i++) fo.prims.push(sk(S.capsule([Wr[0] + (i - 1.5) * 0.024, Wr[1] - 0.09, Wr[2] + 0.03], [Wr[0] + (i - 1.5) * 0.026, Wr[1] - 0.13, Wr[2] + 0.02], 0.016, 0.013).blend(0.008)));
  }
  return { kind: 'titan.djinn', attack: 'cast', nodes: finish(N.nodes) };
}

function djinnAnim(rig, inner, c, base) {
  const { R, P, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk;
  const A = rig.arms || [], F = rig.forearms || [], T = rig.tail || [], k = c.moving ? 1 : 0;
  const idle = Math.sin(t * 1.5 + ph), idle2 = Math.sin(t * 0.8 + ph * 1.7);
  inner.rotation.x = 0; inner.rotation.z = 0; inner.position.set(0, 0, 0);
  const dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 1.6) : 0;
  // the smoke coils; moving, it streams out behind and the body leans into the wind
  T.forEach((seg, i) => R(seg, Math.sin(t * 1.7 + ph - i * 0.9) * 0.05 + (i === 1 ? -0.16 * k : i === 3 ? 0.1 * k : 0), Math.sin(t * 1.1 + ph + i * 1.3) * 0.22, Math.sin(t * 1.4 + ph - i * 1.1) * 0.05));
  if (T[0]) T[0].scale.setScalar(dead ? Math.max(0.04, 1 - df * 0.96) : 1);
  (rig.lamp || []).forEach((l) => R(l, 0, 0, dead ? 0 : Math.sin(t * 9 + ph) * 0.012 * (a >= 0 ? 2 : 0.3)));
  P(rig.torso, 0, idle * 0.025, 0);
  if (a >= 0) base.upperBody(rig, c, 'cast');
  else {
    // arms folded across the chest
    R(A[0], -0.5 + idle * 0.02, 0, -0.14); R(F[0], -1.38, 0, -1.2);
    R(A[1], -0.66 + idle * 0.02, 0, 0.14); R(F[1], -1.3, 0, 1.2);
    R(rig.torso, 0.14 * k + idle * 0.012, idle2 * 0.06, 0);
    R(rig.head, idle * 0.03 - 0.08 * k, idle2 * 0.2);
  }
  if (dead) inner.position.y = -Math.max(0, c.dead - 0.7) * 0.3 * s;
}

// =====================================================================================
//  GIANT SERPENT
// =====================================================================================
// rig: coil[] (the heap of coils, turns about Y to slither), nk[] (the reared neck), head, jaw, tongue[], tail[]

function serpent(def, o = {}) {
  const base = col(o.scales, 0x6a5a2a), hood = !!o.hood;
  const C = { skin: base, back: tone(base, 0, 0.02, -0.14), mark: tone(base, -0.02, 0.05, -0.24), belly: mix(base, 0xf0e6b8, 0.72), bellyD: mix(base, 0xd8c890, 0.6), mouth: 0xd87a80, eye: { iris: 0xe8b020, rim: 0x3a1a08, white: 0x1a1008, glow: 0.3 } };
  const sk = (q) => q.color(base).bump(0.007, 24, 'scales').tint(0.14, 9).pbr(0.38, 0.05);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  // the heap: a spiral from the outside in, climbing as it goes
  const coil = N('coil', 'root', [0, 0, 0], { rig: 'coil', detail: 0.8 });
  {
    const turns = 2.6, n = 46, pts = [], rr = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, a = f * turns * 6.283 + 0.6, r = lerp(0.46, 0.0, Math.pow(f, 1.25)) + 0.0;
      pts.push([Math.sin(a) * r, lerp(0.105, 0.3, Math.pow(f, 0.8)), Math.cos(a) * r]);
      rr.push(lerp(0.085, 0.112, Math.min(1, f * 2.5)));
    }
    coil.prims.push(...S.limb(pts, rr).map((q) => sk(q).blend(0.004)));
    for (let i = 2; i < n - 6; i += 3) {
      const p0 = pts[i], out = norm3([p0[0], 0, p0[2]]);
      coil.prims.push(S.ellipsoid(0.07, 0.05, 0.07).at(p0[0], p0[1] + rr[i] * 0.8, p0[2]).color(C.mark).paint(0.012));
      coil.prims.push(S.sphere(0.07).at(p0[0] + out[0] * rr[i] * 0.3, p0[1] - rr[i] * 0.85, p0[2] + out[2] * rr[i] * 0.3).color(C.belly).paint(0.02));
    }
  }
  // the tail's end lies out across the ground
  const a0 = 0.6, t0 = [Math.sin(a0) * 0.46, 0.1, Math.cos(a0) * 0.46], td = [Math.cos(a0), 0, -Math.sin(a0)];
  addChain(N, 'tailtip', 'coil', [t0, add3(t0, mul3(td, -0.2)), add3(add3(t0, mul3(td, -0.38)), [0.06, -0.04, 0.06]), add3(add3(t0, mul3(td, -0.52)), [0.16, -0.07, 0.12])], [0.085, 0.066, 0.042, 0.012], sk, { rig: 'tail', detail: 0.8, minRes: 30 });
  // the reared neck, rising from the heart of the coils
  const NP = [[0, 0.27, 0], [0, 0.5, -0.1], [0, 0.72, -0.1], [0, 0.92, 0.0], [0, 1.06, 0.14], [0, 1.12, 0.3]];
  const nr = [0.112, 0.104, 0.097, 0.09, 0.08, 0.07];
  const nk = addChain(N, 'nk', 'root', NP, nr, sk, { rig: 'nk', detail: 0.85, up: [1, 0, 0], deco: (n, a, b, ra, rb, i, f) => {
    const ven = f.side;                     // with up = +X the "side" vector faces forward: the belly
    n.prims.push(S.capsule(add3(a, mul3(ven, ra * 0.55)), add3(b, mul3(ven, rb * 0.55)), ra * 0.62, rb * 0.62).color(C.belly).paint(0.02));
    for (let q = 0; q < 3; q++) n.prims.push(orient(S.torus(lerp(ra, rb, (q + 0.5) / 3) * 0.7, 0.008), add3(lerp3(a, b, (q + 0.5) / 3), mul3(ven, ra * 0.5)), f.t).color(C.bellyD).paint(0.004, -0.003));
    n.prims.push(S.ellipsoid(ra * 0.7, 0.05, ra * 0.5).at(...add3(lerp3(a, b, 0.5), mul3(ven, -ra * 0.75))).color(C.mark).paint(0.012));
  } });
  if (hood) {
    // the hood spreads from the upper neck: pale and banded in front, a pair of eyes painted on its back
    const hn = nk[3], hc = [0, 0.96, 0.03], hd = norm3(sub3(NP[5], NP[2])), fwd = norm3(cross3([1, 0, 0], hd));
    const tilt = Math.atan2(hd[2], hd[1]) / DEG;
    hn.prims.push(sk(S.ellipsoid(0.25, 0.22, 0.04).rot(tilt, 0, 0).at(...hc).blend(0.035)).bump(0.005, 30, 'scales'));
    hn.prims.push(sk(S.ellipsoid(0.17, 0.16, 0.045).rot(tilt, 0, 0).at(...add3(hc, mul3(hd, -0.16))).blend(0.04)));
    hn.prims.push(S.ellipsoid(0.22, 0.2, 0.04).rot(tilt, 0, 0).at(...add3(hc, mul3(fwd, 0.035))).color(C.belly).paint(0.014));
    for (let i = 0; i < 4; i++) hn.prims.push(S.box(0.5, 0.016, 0.06, 0.002).rot(tilt, 0, 0).at(...add3(add3(hc, mul3(hd, -0.14 + i * 0.08)), mul3(fwd, 0.04))).color(C.bellyD).paint(0.004, -0.002));
    for (const sx of [1, -1]) {
      const ec = add3(add3(hc, mul3(fwd, -0.04)), [0.105 * sx, 0.02, 0]);
      hn.prims.push(S.ellipsoid(0.07, 0.085, 0.03).rot(tilt, 0, sx * -14).at(...ec).color(0xf0e6c0).paint(0.006), S.ellipsoid(0.045, 0.058, 0.03).rot(tilt, 0, sx * -14).at(...ec).color(C.mark).paint(0.005), S.ellipsoid(0.02, 0.028, 0.03).rot(tilt, 0, sx * -14).at(...ec).color(0xe8b020).paint(0.004));
    }
    hn.prims.push(S.box(0.1, 0.03, 0.03, 0.004).rot(tilt, 0, 0).at(...add3(add3(hc, mul3(fwd, -0.04)), mul3(hd, -0.06))).color(0xf0e6c0).paint(0.006));
  }
  const head = N('head', nk[nk.length - 1].name, [0, 0, 0], { rig: 'head', pos: sub3(NP[5], NP[4]), rot: [22, 0, 0], detail: 1.3 });
  {
    const p = head.prims, bare = (q) => q.color(base).bump(0.004, 36, 'scales').tint(0.12, 16).pbr(0.38, 0.05);
    p.push(bare(S.ellipsoid(0.092, 0.058, 0.11).at(0, 0.008, 0.04)));
    p.push(bare(S.capsule([0, 0.0, 0.08], [0, -0.008, 0.21], 0.066, 0.042).blend(0.03)));
    p.push(...S.mirrorX([bare(S.capsule([0.03, 0.042, 0.15], [0.078, 0.046, 0.02], 0.014, 0.022).blend(0.012)).color(C.back), S.sphere(0.02).at(0.066, 0.02, 0.11).color(C.mark).cut(0.005), S.sphere(0.007).at(0.026, 0.006, 0.245).color(0x1a0c08).cut(0.003)]));
    p.push(S.ellipsoid(0.06, 0.03, 0.12).at(0, 0.05, 0.04).color(C.back).paint(0.02));
    p.push(S.box(0.12, 0.02, 0.2, 0.004).at(0, -0.042, 0.13).color(C.mouth).paint(0.006));
    for (const sx of [1, -1]) {
      head.hard.push(eyeAt([0.064 * sx, 0.02, 0.112], [sx, 0.2, 0.35], 0.016, C.eye));
      head.hard.push(spike([0.034 * sx, -0.03, 0.2], [0, -1, -0.12], 0.085, 0.01, 0xf4eed8, [0, 0, -1], 0.35).lod(2));
    }
  }
  const HG = [0, -0.02, 0.0];
  const jaw = N('jaw', 'head', HG, { rig: 'jaw', pos: HG, detail: 1.2 });
  jaw.prims.push(S.capsule([0, -0.04, 0.02], [0, -0.045, 0.2], 0.05, 0.03).color(C.belly).pbr(0.4).tint(0.1, 20));
  jaw.prims.push(S.ellipsoid(0.04, 0.012, 0.09).at(0, -0.02, 0.11).color(C.mouth).pbr(0.35).blend(0.006));
  const tg = N('tongue', 'jaw', [0, -0.022, 0.16], { rig: 'tongue' });
  tg.hard.push(H.tube([[0, -0.022, 0.12], [0, -0.03, 0.26], [0, -0.03, 0.31]], [0.007, 0.006, 0.005], 6, 4).color(0x7a1420).pbr(0.4));
  for (const sx of [1, -1]) tg.hard.push(H.tube([[0, -0.03, 0.3], [0.02 * sx, -0.035, 0.37]], [0.005, 0.0015], 2, 4).color(0x7a1420).pbr(0.4).lod(2));
  return { kind: 'titan.serpent', attack: 'bite', nodes: finish(N.nodes) };
}

function serpentAnim(rig, inner, c, base) {
  const { R, P, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk;
  const NK = rig.nk || [], k = c.moving ? 1 : 0, idle = Math.sin(t * 1.2 + ph);
  inner.rotation.x = 0; inner.rotation.z = 0; inner.position.set(0, 0, 0);
  const dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 2) : 0, e = df * df * (3 - 2 * df);
  // slithering: the heap turns on itself so its scales stream past, and the whole body weaves
  (rig.coil || []).forEach((x) => { if (!dead) x.rotation.y = (x.userData.rest?.[1] ?? 0) + (k ? t * 2.6 : Math.sin(t * 0.5 + ph) * 0.12); });
  let rear = 0, strike = 0, jaw = 0.02;
  if (a >= 0) { rear = keys(a, [[0, 0], [0.3, 1], [0.45, 0], [1, 0]]); strike = keys(a, [[0, 0], [0.3, 0], [0.46, 1], [0.62, 0.9], [1, 0]]); jaw = keys(a, [[0, 0.02], [0.3, 0.5], [0.46, 1.0], [0.6, 0.1], [1, 0.02]]); }
  let sum = 0;
  NK.forEach((seg, i) => {
    const w = Math.sin(t * (k ? 4.6 : 1.3) + ph - i * 0.8) * (k ? 0.1 : 0.06);
    const x = dead ? [1.25, 0.35, 0.2, 0.1, 0][i] * e : -0.07 * rear + (i === 0 ? 0.45 : 0.2) * strike + 0.05 * k + Math.sin(t * 0.9 + ph - i * 0.5) * 0.025;
    sum += x;
    R(seg, x, dead ? 0.12 * e * (i % 2 ? 1 : -1) : idle * 0.03, dead ? 0.2 * e : w);
  });
  R(rig.head, dead ? -0.3 * e : -sum * 0.55 + idle * 0.03, dead ? 0 : Math.sin(t * 0.7 + ph * 1.7) * 0.2 * (a >= 0 ? 0 : 1), dead ? 0.5 * e : 0);
  R(rig.jaw, dead ? 0.4 * e : jaw);
  const flick = Math.max(0, Math.sin(t * 2.4 + ph)) * Math.max(0, Math.sin(t * 19));
  (rig.tongue || []).forEach((x) => { P(x, 0, 0, a >= 0 || dead ? -0.1 : -0.1 + 0.1 * flick); R(x, 0.2 * Math.sin(t * 23) * flick); });
  (rig.tail || []).forEach((x, i) => R(x, 0, Math.sin(t * (k ? 7 : 2.2) + ph - i) * (0.12 + i * 0.08) * (dead ? 0 : 1), 0));
  if (dead) { inner.position.y = -Math.max(0, c.dead - 0.5) * 0.5 * s; return; }
  inner.position.x = k * Math.sin(t * 4.6 + ph) * 0.05 * s;
  inner.position.z = (0.1 * strike - 0.03 * rear) * s;
}

// =====================================================================================
//  DRAKE-OGRE (centaur kind 'drake')
// =====================================================================================
// rig: body (the lizard trunk), legs[4], shins[4], tail[], torso (the rider-like upper body), head, jaw, arms, forearms, weapon[]

function centaur(def, o = {}) {
  const skin = col(o.skin, 0x4a5a7a);
  const C = { skin, back: tone(skin, 0.01, 0.02, -0.1), deep: tone(skin, 0.02, 0, -0.17), belly: mix(skin, 0xd8d0b0, 0.6), steel: col(o.armor, 0x3a3e48), steelL: 0x6a707c, trim: col(o.trim, 0xc89a3a), claw: 0x1c1814, horn: [0x2a2622, 0x8a8068, 0xd8d0b8] };
  const sk = (q) => q.color(skin).bump(0.008, 21, 'scales').tint(0.16, 8).pbr(0.48, 0.04);
  const st = (q) => q.color(C.steel).pbr(0.38, 0.85).tint(0.08, 12);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const body = N('body', 'root', [0, 0.5, -0.05], { rig: 'body', detail: 0.74 });
  {
    const p = body.prims;
    p.push(sk(S.ellipsoid(0.24, 0.24, 0.4).at(0, 0.5, -0.1)));
    p.push(sk(S.ellipsoid(0.23, 0.25, 0.22).at(0, 0.56, 0.22).blend(0.07)));
    p.push(sk(S.ellipsoid(0.22, 0.22, 0.22).at(0, 0.5, -0.38).blend(0.06)));
    p.push(sk(S.capsule([0, 0.5, -0.46], [0, 0.48, -0.58], 0.18, 0.15).blend(0.06)));
    p.push(sk(S.capsule([0, 0.6, 0.26], [0, 0.76, 0.3], 0.22, 0.2).blend(0.06)));
    p.push(S.ellipsoid(0.17, 0.1, 0.4).at(0, 0.27, 0.0).color(C.belly).paint(0.05));
    p.push(S.ellipsoid(0.15, 0.1, 0.5).at(0, 0.73, -0.2).color(C.back).paint(0.06));
    for (let i = 0; i < 6; i++) p.push(...S.mirrorX([S.ellipsoid(0.15, 0.2, 0.016).rot(-10, 0, -32).at(0.11, 0.66, 0.05 - i * 0.12).color(C.deep).paint(0.016)]));
    for (let i = 0; i < 6; i++) { const h = 0.1 * (0.8 + 0.4 * Math.sin((i / 5) * Math.PI)); body.hard.push(spike([0, 0.72, 0.0 - i * 0.1], [0, 1, -0.5], h, h * 0.3, C.horn[0], [0, -0.3, -1], 0.35, 0.4).lod(i % 2 ? 1 : 2)); }
    // peytral: plate across the forequarters
    p.push(st(S.ellipsoid(0.22, 0.18, 0.1).at(0, 0.52, 0.4).blend(0.006)));
    p.push(S.torus(0.17, 0.014).rot(90, 0, 0).at(0, 0.52, 0.47).color(C.trim).pbr(0.35, 0.9).paint(0.004, 0.004));
    body.hard.push(spike([0, 0.52, 0.5], [0, 0, 1], 0.1, 0.03, C.steelL, [0, 1, 0], 0).lod(2));
  }
  const ft = (k) => ({ kind: 'claw', len: 0.16 * k, w: 0.06 * k, toes: 3, clawLen: 0.07, claw: C.claw, spread: 0.5 });
  const F = [[0.2, 0.5, 0.24], [0.3, 0.3, 0.3], [0.3, 0.1, 0.26], [0.3, 0, 0.28]], B = [[0.2, 0.5, -0.36], [0.31, 0.32, -0.28], [0.3, 0.1, -0.4], [0.3, 0, -0.37]];
  addLeg(N, 'FL', 'body', 1, F, [0.1, 0.07, 0.052], sk, { detail: 0.74, foot: ft(1) }); addLeg(N, 'FR', 'body', -1, F, [0.1, 0.07, 0.052], sk, { detail: 0.74, foot: ft(1) });
  addLeg(N, 'BL', 'body', 1, B, [0.115, 0.075, 0.054], sk, { detail: 0.74, foot: ft(1.05) }); addLeg(N, 'BR', 'body', -1, B, [0.115, 0.075, 0.054], sk, { detail: 0.74, foot: ft(1.05) });
  addChain(N, 'tail', 'body', [[0, 0.48, -0.56], [0, 0.44, -0.78], [0, 0.37, -0.98], [0, 0.3, -1.16], [0, 0.26, -1.32], [0, 0.26, -1.46]], [0.15, 0.115, 0.085, 0.06, 0.04, 0.014], sk, { rig: 'tail', detail: 0.74, deco: (n, a, b, ra, rb, i, f) => {
    n.prims.push(S.capsule(add3(a, mul3(f.dor, ra * 0.5)), add3(b, mul3(f.dor, rb * 0.5)), ra * 0.7, rb * 0.7).color(C.back).paint(0.03));
    const h = 0.09 * (1 - i * 0.15); n.hard.push(spike(add3(lerp3(a, b, 0.5), mul3(f.dor, (ra + rb) * 0.42)), add3(f.dor, mul3(f.t, 0.6)), h, h * 0.3, C.horn[0], f.t, 0.35, 0.4).lod(1));
  } });
  // the upper body: an ogre's trunk in plate
  const WP = [0, 0.74, 0.3];
  const torso = N('torso', 'body', WP, { rig: 'torso', detail: 0.85 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.2, 0.15, 0.17).at(0, 0.84, 0.3)));
    p.push(sk(S.ellipsoid(0.26, 0.2, 0.19).at(0, 1.05, 0.29).blend(0.06)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.11, 0.08, 0.1).rot(0, 0, -25).at(0.17, 1.2, 0.27).blend(0.04))]));
    p.push(sk(S.capsule([0, 1.18, 0.29], [0, 1.27, 0.3], 0.09, 0.085).blend(0.03)));
    p.push(st(S.ellipsoid(0.255, 0.19, 0.16).at(0, 1.06, 0.33).blend(0.004)));                  // breastplate
    p.push(st(S.ellipsoid(0.24, 0.18, 0.13).at(0, 1.07, 0.23).blend(0.004)));                   // backplate
    p.push(S.box(0.014, 0.3, 0.1, 0.004).at(0, 1.06, 0.48).color(C.trim).pbr(0.35, 0.9).paint(0.004, 0.006));
    p.push(S.torus(0.2, 0.02).at(0, 0.92, 0.31).color(C.trim).pbr(0.35, 0.9).paint(0.004, 0.005));
    p.push(S.torus(0.165, 0.035).at(0, 0.8, 0.3).color(0x3a2a1c).pbr(0.7).blend(0.008));         // belt
    for (let i = 0; i < 7; i++) { const a = (i - 3) * 0.5; p.push(st(S.box(0.1, 0.16, 0.02, 0.008).rot(-12, 0, 0).rot(0, a / DEG, 0).at(Math.sin(a) * 0.21, 0.71, 0.3 + Math.cos(a) * 0.19).blend(0.004))); }   // tassets
    torso.hard.push(H.sphere(0.03, 10).scale(1, 1, 0.5).at(0, 0.8, 0.48).color(C.trim).pbr(0.35, 0.9));
    for (const sx of [1, -1]) {
      p.push(st(S.ellipsoid(0.14, 0.1, 0.14).rot(0, 0, sx * -22).at(sx * 0.31, 1.23, 0.29).blend(0.004)), st(S.ellipsoid(0.12, 0.07, 0.13).rot(0, 0, sx * -34).at(sx * 0.37, 1.16, 0.29).blend(0.004)).color(C.steelL));
      p.push(S.torus(0.115, 0.012).rot(0, 0, sx * -22).at(sx * 0.31, 1.215, 0.29).color(C.trim).pbr(0.35, 0.9).paint(0.003, 0.004));
      torso.hard.push(spike([sx * 0.33, 1.3, 0.29], [sx * 0.5, 1, 0], 0.13, 0.03, C.steelL, [0, 0, 1], 0.2).lod(2));
    }
  }
  const head = N('head', 'torso', [0, 1.27, 0.3], { rig: 'head', detail: 1.3 });
  {
    const p = head.prims, hy = 1.36, hz = 0.32, bare = (q) => q.color(skin).bump(0.004, 34, 'scales').tint(0.12, 16).pbr(0.48);
    p.push(bare(S.ellipsoid(0.1, 0.105, 0.11).at(0, hy, hz)));
    p.push(bare(S.capsule([0, hy - 0.02, hz + 0.06], [0, hy - 0.04, hz + 0.17], 0.075, 0.06).blend(0.03)));
    p.push(...S.mirrorX([bare(S.capsule([0.015, hy + 0.04, hz + 0.11], [0.085, hy + 0.055, hz + 0.02], 0.02, 0.03).blend(0.015)).color(C.deep), S.sphere(0.018).at(0.052, hy + 0.012, hz + 0.1).color(0x120c0a).cut(0.005), bare(S.ellipsoid(0.04, 0.05, 0.05).at(0.075, hy - 0.05, hz + 0.02).blend(0.025))]));
    p.push(S.ellipsoid(0.06, 0.05, 0.14).at(0, hy + 0.08, hz - 0.01).color(C.back).paint(0.02));
    for (const sx of [1, -1]) {
      head.hard.push(glowEye([0.05 * sx, hy + 0.012, hz + 0.092], 0.011, 0xffb020, 1.5));
      head.hard.push(...horn([[0.07 * sx, hy + 0.06, hz - 0.02], [0.14 * sx, hy + 0.13, hz - 0.1], [0.15 * sx, hy + 0.24, hz - 0.14]], 0.032, C.horn, { rings: 10 }));
    }
    for (let i = 0; i < 4; i++) head.hard.push(spike([0, hy + 0.1 - i * 0.01, hz + 0.02 - i * 0.045], [0, 1, -0.5], 0.06, 0.016, C.horn[0], [0, 0, -1], 0.3, 0.4).lod(1));
  }
  const jaw = N('jaw', 'head', [0, 1.31, 0.33], { rig: 'jaw', detail: 1.2 });
  jaw.prims.push(S.ellipsoid(0.085, 0.045, 0.1).at(0, 1.275, 0.4).color(skin).bump(0.004, 34, 'scales').tint(0.12, 16).pbr(0.48));
  for (const sx of [1, -1]) jaw.hard.push(spike([0.055 * sx, 1.29, 0.47], [sx * 0.2, 1, 0.1], 0.07, 0.016, 0xe8dfc0, [0, 0, -1], 0.25).lod(2));
  let wpn = null;
  const wk = typeof o.weapon === 'string' ? o.weapon : 'greataxe';
  try { wpn = makeWeapon(wk); } catch (e) { try { wpn = makeWeapon('greataxe'); } catch (e2) { wpn = null; } }
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.33, 1.17, 0.29]), El = X([0.39, 0.91, 0.28]), Wr = X([0.39, 0.67, 0.34]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.85 });
    up.prims.push(sk(S.capsule(Sp, El, 0.092, 0.074)), sk(S.sphere(0.1).at(...Sp).blend(0.03)), sk(S.ellipsoid(0.085, 0.1, 0.09).at(...add3(lerp3(Sp, El, 0.45), [0, 0, 0.02])).blend(0.03)));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.9 });
    fo.prims.push(sk(S.sphere(0.072).at(...El)), sk(S.capsule(El, Wr, 0.074, 0.056).blend(0.015)));
    fo.prims.push(st(S.capsule(lerp3(El, Wr, 0.3), lerp3(El, Wr, 0.9), 0.076, 0.064).blend(0.003)));
    fo.prims.push(S.torus(0.07, 0.01).rot(14, 0, 0).at(...lerp3(El, Wr, 0.35)).color(C.trim).pbr(0.35, 0.9).paint(0.003, 0.004));
    fo.prims.push(sk(S.ellipsoid(0.06, 0.07, 0.055).at(Wr[0], Wr[1] - 0.06, Wr[2] + 0.01).blend(0.012)));
    for (let i = 0; i < 3; i++) fo.hard.push(spike([Wr[0] + (i - 1) * 0.03, Wr[1] - 0.11, Wr[2] + 0.03], [0, -1, 0.4], 0.04, 0.01, C.claw, [0, 0, 1], 0.3).lod(1));
    if (sx < 0 && wpn) {
      const g = [Wr[0], Wr[1] - 0.07, Wr[2] + 0.03], k = 1.25;
      const wn = N('weapon', `fore${nm}`, g, { rig: 'weapon', detail: 0.9 });
      const place = (q) => q.scale(k, k, k).rot(42, 0, 0).at(g[0], g[1], g[2]);
      wn.prims = flat(wpn.prims).map((q) => q.scale(k).rot(42, 0, 0).at(g[0], g[1], g[2]));
      wn.hard = flat(wpn.hard).map(place);
    }
  }
  const atk = wpn && ['thrust', 'cast', 'shoot'].includes(wpn.attack) ? wpn.attack : 'swing';
  return { kind: 'titan.centaur', attack: atk, nodes: finish(N.nodes) };
}

function centaurAnim(rig, inner, c, base) {
  const { R } = base, s = (inner.scale.y || 1) * (rig.u || 1);
  base.quad(rig, inner, { ...c, t: c.t * 0.8 });
  const k = c.moving ? 1 : 0, gait = c.t * 7.2 + (c.phase || 0);
  R(rig.body, 0, Math.sin(gait) * 0.03 * k, 0);
  tailWave(rig, c, base, 0.12, 1.6);
  if (c.dead > 0) inner.position.y += Math.min(1, c.dead * 2) * 0.2 * s;
}

// =====================================================================================
//  WRECK COLOSSUS
// =====================================================================================
// rig: torso, head, core (the lantern), legs, shins, arms[2] (right = the gun arm), forearms[2], anchor[], sway[]

function wreckColossus(def, o = {}) {
  const wood = col(o.color, 0x4a3a2a), glow = col(o.glow, 0x5affa0);
  const woodD = tone(wood, 0, 0, -0.07), woodL = mix(wood, 0xa89068, 0.45), iron = 0x34363a, rust = 0x6a3a22, brass = 0x9a8a4a, rope = 0x9a8a62, sail = 0xb8b09a, weed = 0x3a5a2a;
  const rnd = rng(hashStr(def?.id || 'wreck'));
  const wd = (q) => q.color(wood).bump(0.008, 26, 'fur').tint(0.2, 9).pbr(0.85);
  const planks = (p, c, size, n, horizontal = true) => { for (let i = 0; i < n; i++) { const f = (i + 0.5) / n - 0.5; p.push((horizontal ? S.box(size[0], 0.01, size[2], 0.002).at(c[0], c[1] + f * size[1], c[2]) : S.box(0.01, size[1], size[2], 0.002).at(c[0] + f * size[0], c[1], c[2])).color(woodD).paint(0.003, -0.006)); } };
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.52, 0], { rig: 'torso', detail: 0.74 });
  {
    const p = torso.prims;
    // a length of hull stood on end: the chest
    p.push(wd(S.ellipsoid(0.31, 0.36, 0.25).at(0, 0.88, 0)));
    p.push(wd(S.ellipsoid(0.36, 0.2, 0.26).at(0, 1.04, -0.01).blend(0.06)));
    p.push(wd(S.cyl(0.2, 0.2, 0.03).at(0, 0.6, 0).blend(0.05)));
    planks(p, [0, 0.88, 0], [0.8, 0.72, 0.6], 11);
    p.push(S.ellipsoid(0.18, 0.21, 0.2).at(0.0, 0.9, 0.17).color(0x120e0a).cut(0.02));           // stove in: the lantern hangs inside
    for (const y of [0.56, 0.66]) p.push(S.torus(0.205, 0.014).at(0, y, 0).color(iron).pbr(0.5, 0.8).tint(0.3, 20).paint(0.004, 0.004));
    p.push(S.ellipsoid(0.34, 0.2, 0.26).at(0, 0.62, 0).color(mix(wood, weed, 0.5)).tint(0.3, 10).paint(0.06));
    // ribs of the ship across the breach, keel down the back
    for (const sx of [1, -1]) for (let i = 0; i < 3; i++) {
      const x = sx * (0.045 + i * 0.062);
      torso.hard.push(H.tube([[x, 1.12, 0.17], [x * 1.25, 1.0, 0.27 - i * 0.02], [x * 1.3, 0.86, 0.285 - i * 0.025], [x * 1.1, 0.7, 0.24]], [0.02, 0.022, 0.022, 0.018], 8, 5).color(i % 2 ? woodL : wood).pbr(0.85));
    }
    torso.hard.push(beam([0, 0.56, -0.25], [0, 1.24, -0.22], 0.08, 0.07, woodD));
    // the yard across the shoulders, with what is left of its sail
    torso.hard.push(H.cyl(0.04, 0.04, 1.0, 8).rot(0, 0, 90).at(0, 1.2, -0.06).color(woodL).pbr(0.85));
    for (const sx of [1, -1]) {
      torso.hard.push(H.cyl(0.06, 0.06, 0.2, 8).rot(0, 0, 90).at(sx * 0.3, 1.2, -0.06).color(sail).pbr(0.9).lod(2));
      for (let i = 0; i < 3; i++) torso.hard.push(H.torus(0.062, 0.01, 8, 5).rot(0, 90, 0).at(sx * (0.23 + i * 0.07), 1.2, -0.06).color(rope).lod(1));
      torso.hard.push(ribbon([sx * 0.44, 1.18, -0.06], 0.3 + rnd() * 0.1, 0.06, sail, [0, 0, 1], rnd, 3));
      for (let i = 0; i < 4; i++) torso.hard.push(ribbon([sx * (0.1 + i * 0.07), 0.62, 0.2 - i * 0.04], 0.16 + rnd() * 0.12, 0.03, weed, [sx * 0.5, 0, 1], rnd));
    }
    // a broken mast with its top and a rag of colours, stayed to the yard
    const M0 = [-0.1, 1.1, -0.17], M1 = [-0.14, 1.86, -0.25];
    torso.hard.push(H.tube([M0, M1], [0.045, 0.03], 3, 8).color(woodL).pbr(0.85));
    torso.hard.push(H.cyl(0.085, 0.06, 0.09, 10).at(-0.133, 1.62, -0.235).color(wood).pbr(0.85), H.torus(0.086, 0.008, 10, 5).rot(90, 0, 0).at(-0.133, 1.665, -0.235).color(iron).lod(1));
    torso.hard.push(H.sheet(0.3, 0.2, 6, 3, (u, v) => [0, 0, Math.sin(u * 7) * 0.025 * u]).rot(0, 100, 0).at(-0.17, 1.76, -0.4).color(col(o.flag, 0x2a2a30)).shade((x, y) => (x > 0.09 && Math.sin(y * 60) > 0.2 ? null : null)));
    for (const [e, lod] of [[[0.45, 1.21, -0.06], 3], [[-0.46, 1.21, -0.06], 3], [[0.1, 1.22, 0.1], 1]]) torso.hard.push(H.tube([M1, lerp3(M1, e, 0.5).map((v, i) => (i === 1 ? v - 0.05 : v)), e], 0.007, 6, 4).color(rope).pbr(0.9).lod(lod));
    for (const [x, y, z, nx, nz] of [[0.26, 0.74, 0.12, 1, 0.5], [-0.28, 0.82, 0.05, -1, 0.2], [0.2, 0.7, -0.18, 0.7, -0.7], [-0.16, 0.64, 0.18, -0.4, 1], [0.3, 0.98, -0.06, 1, 0]]) torso.hard.push(barnacles([x, y, z], norm3([nx, 0.1, nz]), 0.035, rnd, 5));
  }
  // the lantern in the chest
  const core = N('core', 'torso', [0, 0.93, 0.15], { rig: 'core' });
  core.hard.push(H.sphere(0.07, 14).scale(1, 1.25, 1).at(0, 0.93, 0.15).color(glow).glow(2));
  const cage = N('cage', 'torso', [0, 1.06, 0.15], { rig: 'sway' });
  cage.hard.push(H.cyl(0.04, 0.085, 0.04, 8).at(0, 1.04, 0.15).color(brass).pbr(0.4, 0.9), H.cyl(0.085, 0.07, 0.03, 8).at(0, 0.82, 0.15).color(brass).pbr(0.4, 0.9));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; cage.hard.push(H.cyl(0.006, 0.006, 0.2, 4).at(Math.sin(a) * 0.08, 0.93, 0.15 + Math.cos(a) * 0.08).color(brass).pbr(0.4, 0.9).lod(2)); }
  cage.hard.push(H.torus(0.02, 0.006, 8, 4).at(0, 1.07, 0.15).color(iron).lod(1));
  // head: the stump of a prow, two ports for eyes, the bowsprit for a horn
  const head = N('head', 'torso', [0, 1.2, 0.02], { rig: 'head', detail: 0.9 });
  {
    const p = head.prims;
    p.push(wd(S.box(0.24, 0.2, 0.22, 0.04).at(0, 1.32, 0.02)));
    p.push(wd(S.capsule([0, 1.3, 0.1], [0, 1.24, 0.3], 0.1, 0.045).blend(0.04)));
    p.push(wd(S.box(0.2, 0.07, 0.24, 0.02).rot(8, 0, 0).at(0, 1.21, 0.1).blend(0.01)).color(woodD));       // the jutting jaw: a strake of the bow
    planks(p, [0, 1.32, 0.05], [0.4, 0.2, 0.6], 4);
    p.push(...S.mirrorX([S.sphere(0.036).at(0.075, 1.34, 0.125).color(0x0c0a08).cut(0.008)]));
    p.push(S.torus(0.125, 0.014).rot(90, 0, 0).at(0, 1.31, -0.02).color(iron).pbr(0.5, 0.8).paint(0.004, 0.004));
    for (const sx of [1, -1]) {
      head.hard.push(H.torus(0.036, 0.009, 12, 5).at(0.075 * sx, 1.34, 0.128).rot(0, sx * 16, 0).color(brass).pbr(0.4, 0.9).lod(2));
      head.hard.push(glowEye([0.073 * sx, 1.34, 0.11], 0.024, glow, 1.9));
    }
    head.hard.push(H.tube([[0, 1.4, 0.06], [0, 1.52, 0.3]], [0.03, 0.02], 2, 7).color(woodL).pbr(0.85));
    head.hard.push(H.tube([[0, 1.52, 0.3], [0, 1.4, 0.2], [0, 1.29, 0.31]], 0.006, 5, 4).color(rope).lod(1));
    for (let i = 0; i < 5; i++) head.hard.push(ribbon([(i - 2) * 0.045, 1.2, 0.2 + (i % 2) * 0.04], 0.1 + rnd() * 0.1, 0.03, weed, [0, 0, 1], rnd));
    head.hard.push(barnacles([-0.1, 1.42, -0.02], [-0.3, 1, 0], 0.03, rnd, 4));
  }
  // arms
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.42, 1.12, 0]), El = X([0.48, 0.84, 0.02]), Wr = X([0.48, 0.5, 0.08]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.74 });
    up.prims.push(wd(S.sphere(0.13).at(...Sp)), wd(S.capsule(Sp, El, 0.08, 0.07).blend(0.03)));
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + sx, d = [Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055]; up.hard.push(beam(add3(Sp, add3(d, [0, 0.04 * (i - 1), 0])), add3(El, add3(d, [0, -0.03 * i, 0])), 0.07, 0.06, i % 2 ? woodL : woodD)); }
    for (const f of [0.3, 0.75]) up.hard.push(orient(H.torus(0.1, 0.012, 10, 5).rot(90, 0, 0), lerp3(Sp, El, f), sub3(El, Sp)).color(rope).pbr(0.9).lod(2));
    up.hard.push(barnacles(add3(Sp, [sx * 0.1, 0.06, 0]), [sx, 0.6, 0], 0.03, rnd, 4));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.74 });
    fo.prims.push(wd(S.sphere(0.1).at(...El)));
    if (sx < 0) {
      // the gun: a ship's cannon lashed on for a forearm
      const L = len3(sub3(Wr, El)) + 0.12;
      const gun = H.lathe([[0, -0.02], [0.05, -0.02], [0.062, 0.0], [0.105, 0.02], [0.105, 0.06], [0.094, 0.07], [0.09, L * 0.45], [0.098, L * 0.46], [0.098, L * 0.5], [0.08, L * 0.52], [0.074, L * 0.9], [0.09, L * 0.93], [0.09, L], [0.05, L], [0.05, L * 0.6]], 14)
        .color(0x3a3a3e).pbr(0.42, 0.85).shade((x, y, z) => (y > L * 0.6 && Math.hypot(x, z) < 0.055 ? 0x080808 : noise3(x * 40, y * 30, z * 40) > 0.62 ? rgb(rust) : null));
      fo.hard.push(orient(gun, add3(El, [0, 0.03, 0]), sub3(Wr, El)));
      for (const f of [0.15, 0.5]) fo.hard.push(orient(H.torus(0.108, 0.014, 10, 5).rot(90, 0, 0), lerp3(El, Wr, f), sub3(Wr, El)).color(rope).pbr(0.9).lod(2));
      fo.hard.push(beam(add3(El, [sx * 0.1, 0, -0.02]), add3(lerp3(El, Wr, 0.6), [sx * 0.1, 0, -0.02]), 0.04, 0.12, woodD));
    } else {
      fo.prims.push(wd(S.capsule(El, Wr, 0.075, 0.06).blend(0.02)));
      for (const f of [0.3, 0.8]) fo.prims.push(orient(S.torus(0.07, 0.014), lerp3(El, Wr, f), sub3(Wr, El)).color(iron).pbr(0.5, 0.8).paint(0.003, 0.004));
      fo.hard.push(H.cyl(0.07, 0.07, 0.03, 8).at(Wr[0], Wr[1] - 0.01, Wr[2]).color(iron).pbr(0.5, 0.8));
      // anchor on its chain
      const A0 = [Wr[0], Wr[1] - 0.03, Wr[2]], A1 = [Wr[0], Wr[1] - 0.13, Wr[2]];
      const an = N('anchor', `fore${nm}`, A0, { rig: 'anchor' });
      an.hard.push(chain(A0, A1, 0.022, iron));
      const ay = A1[1] - 0.03, fe = (q) => q.color(0x2e3034).pbr(0.5, 0.8).shade((x, y, z) => (noise3(x * 30, y * 30, z * 30) > 0.6 ? rgb(rust) : null));
      an.hard.push(fe(H.torus(0.035, 0.01, 10, 5).at(A1[0], ay, A1[2])));
      an.hard.push(fe(H.box(0.035, 0.27, 0.035, 0.008).at(A1[0], ay - 0.155, A1[2])));
      an.hard.push(fe(H.box(0.19, 0.028, 0.028, 0.006).at(A1[0], ay - 0.07, A1[2])));
      an.hard.push(fe(H.torus(0.125, 0.02, 14, 6, Math.PI).rot(0, 0, 180).at(A1[0], ay - 0.165, A1[2])));
      for (const s2 of [1, -1]) an.hard.push(fe(H.cone(0.045, 0.09, 4).scale(1, 1, 0.5).rot(0, 0, s2 * 18).at(A1[0] + s2 * 0.125, ay - 0.145, A1[2])));
      an.hard.push(ribbon([A1[0] + 0.1, ay - 0.25, A1[2]], 0.08, 0.03, weed, [0, 0, 1], rnd));
    }
    // legs: bundled spars for thighs, a mast's foot for the shin, a cask for the foot
    const J = X([0.17, 0.52, 0]), K = X([0.2, 0.28, 0.03]), Fp = X([0.2, 0.0, 0.02]);
    const lu = N(`leg${nm}`, 'root', J, { rig: 'legs', detail: 0.74 });
    lu.prims.push(wd(S.capsule(J, K, 0.1, 0.085)), wd(S.sphere(0.095).at(...K).blend(0.02)));
    for (let i = 0; i < 3; i++) { const a = i * 2.1, d = [Math.cos(a) * 0.065, 0, Math.sin(a) * 0.065]; lu.hard.push(beam(add3(J, d), add3(K, d), 0.075, 0.065, i % 2 ? woodL : woodD)); }
    lu.hard.push(orient(H.torus(0.115, 0.013, 10, 5).rot(90, 0, 0), lerp3(J, K, 0.5), sub3(K, J)).color(rope).pbr(0.9).lod(2));
    const ll = N(`shin${nm}`, `leg${nm}`, K, { rig: 'shins', detail: 0.74 });
    ll.prims.push(wd(S.sphere(0.09).at(...K)), wd(S.capsule(K, [Fp[0], 0.1, Fp[2]], 0.075, 0.07).blend(0.02)));
    ll.prims.push(wd(S.cyl(0.12, 0.2, 0.03).rot(90, 0, 0).at(Fp[0], 0.115, Fp[2] + 0.05).blend(0.02)).color(woodL));
    for (const z of [-0.03, 0.05, 0.13]) ll.prims.push(S.torus(0.117, 0.012).rot(90, 0, 0).at(Fp[0], 0.115, Fp[2] + z).color(iron).pbr(0.5, 0.8).paint(0.003, 0.004));
    ll.hard.push(barnacles([Fp[0] + sx * 0.08, 0.2, Fp[2] + 0.05], [sx, 0.7, 0], 0.03, rnd, 4));
  }
  scaleNodes(N.nodes, 0.76);
  return { kind: 'titan.wreck', attack: 'slam', u: 0.76, nodes: finish(N.nodes) };
}

function wreckAnim(rig, inner, c, base) {
  const { R, keys } = base, t = c.t, ph = c.phase || 0, a = c.atk, A = rig.arms || [], F = rig.forearms || [];
  base.biped(rig, inner, { ...c, t: t * 0.5, atk: -1 });
  let lx = A[0] ? A[0].rotation.x - (A[0].userData.rest?.[0] ?? 0) : 0, lfx = F[0] ? F[0].rotation.x - (F[0].userData.rest?.[0] ?? 0) : 0;
  if (a >= 0 && !(c.dead > 0)) {
    // level the gun, fire, ride the recoil; the anchor arm swings up as a counterweight
    const aim = keys(a, [[0, 0], [0.32, 1], [0.7, 1], [1, 0]]), kick = keys(a, [[0, 0], [0.44, 0], [0.5, 1], [0.75, 0], [1, 0]]);
    R(A[1], -1.35 * aim - 0.3 * kick, 0, -0.08 * aim); R(F[1], -0.2 * aim - 0.25 * kick);
    lx = -0.5 * aim + 0.5 * kick; lfx = -0.4 * aim;
    R(A[0], lx, 0, 0.2 * aim); R(F[0], lfx);
    R(rig.torso, -0.06 * aim - 0.14 * kick, 0.25 * aim, 0);
  }
  if (rig.core) rig.core.scale.setScalar(1 + Math.sin(t * 2.4 + ph) * 0.1 + (a >= 0 ? bellK(a) * 0.5 : 0));
  (rig.anchor || []).forEach((x) => R(x, -(lx + lfx) * 0.85 + Math.sin(t * 1.9 + ph) * 0.1, 0, Math.sin(t * 1.3 + ph) * 0.06));
  (rig.sway || []).forEach((x) => R(x, Math.sin(t * 1.9 + ph) * 0.1, 0, Math.sin(t * 1.4 + ph) * 0.08));
  if (c.dead > 0) inner.position.y += Math.min(1, c.dead * 2) * 0.15 * (inner.scale.y || 1) * (rig.u || 1);
}

// =====================================================================================
//  SKELETON CHARIOT
// =====================================================================================
// rig: horses[2] (trunks), hnecks[2], hheads[2], htails[], legs[8], shins[8] (horse 0 then horse 1: FL FR BL BR), body (the car),
//      wheels[2], crew / crewHeads / crewArms (driver's two arms, then the spearman's), spear[]

function boneHorse(N, p, x0, z0, C) {
  const bn = (q) => q.color(C.bone).tint(0.14, 22).pbr(0.55);
  const mr = 64;
  const body = N(`${p}body`, 'root', [x0, 0.74, z0], { rig: 'horses', detail: 1.0, minRes: 30 });
  {
    const q = body.prims;
    const sp = curve([[x0, 0.84, z0 + 0.3], [x0, 0.8, z0 + 0.05], [x0, 0.82, z0 - 0.2], [x0, 0.78, z0 - 0.36]], 9);
    sp.forEach((v, i) => { if (i < sp.length - 1) q.push(bn(S.capsule(v, sp[i + 1], 0.02, 0.02).blend(0.004))); q.push(bn(S.ellipsoid(0.026, 0.034, 0.02).at(v[0], v[1] + 0.012, v[2]).blend(0.006))); });
    q.push(bn(S.ellipsoid(0.085, 0.07, 0.085).at(x0, 0.74, z0 - 0.3).blend(0.02)));                                            // pelvis
    q.push(...[1, -1].map((sx) => bn(S.ellipsoid(0.024, 0.085, 0.055).rot(18, 0, sx * -10).at(x0 + sx * 0.085, 0.74, z0 + 0.27).blend(0.008))));   // shoulder blades
    q.push(bn(S.capsule([x0, 0.52, z0 + 0.26], [x0, 0.5, z0 + 0.02], 0.022, 0.018)));                                          // breastbone
    for (let i = 0; i < 7; i++) {
      const z = z0 + 0.25 - i * 0.062, R0 = 0.125 - Math.abs(i - 2.5) * 0.008, cy = 0.82 - R0 + (i > 4 ? 0.01 : 0);
      body.hard.push(H.torus(R0, 0.011, 12, 5, Math.PI * 1.72).rot(0, 0, -64.8).scale(0.86, 1.16, 1).rot(i * 3 - 6, 0, 0).at(x0, cy - 0.02, z).color(i % 2 ? C.bone : C.boneD).pbr(0.55).lod(i % 2 ? 2 : 3));
    }
    // trappings: a cloth over the back, a gilded collar
    q.push(S.box(0.2, 0.014, 0.26, 0.005).at(x0, 0.862, z0 - 0.02).color(C.cloth).pbr(0.8).blend(0.004));
    for (const sx of [1, -1]) q.push(S.box(0.014, 0.17, 0.26, 0.005).rot(0, 0, sx * 12).at(x0 + sx * 0.115, 0.78, z0 - 0.02).color(C.cloth).pbr(0.8).blend(0.006), S.box(0.016, 0.03, 0.27, 0.004).rot(0, 0, sx * 12).at(x0 + sx * 0.132, 0.705, z0 - 0.02).color(C.trim).pbr(0.35, 0.9).blend(0.003));
    q.push(S.torus(0.1, 0.016).rot(62, 0, 0).at(x0, 0.76, z0 + 0.32).color(C.trim).pbr(0.35, 0.9).blend(0.004));
    for (let i = 0; i < 5; i++) body.hard.push(H.box(0.03, 0.09, 0.006, 0.002).rot(-20, 0, 0).at(x0 + (i - 2) * 0.034, 0.6, z0 + 0.4).color(i % 2 ? C.trim : C.cloth).pbr(0.5, i % 2 ? 0.8 : 0).lod(2));
  }
  const NB = [x0, 0.84, z0 + 0.3], HJ = [x0, 1.14, z0 + 0.5];
  const neck = N(`${p}neck`, `${p}body`, NB, { rig: 'hnecks', detail: 1.0, minRes: 32 });
  for (let i = 0; i <= 5; i++) { const v = lerp3(NB, HJ, i / 5); v[2] += Math.sin((i / 5) * Math.PI) * 0.03; neck.prims.push(bn(S.ellipsoid(0.032, 0.03, 0.036).at(...v).blend(0.006))); }
  neck.prims.push(bn(S.capsule(NB, HJ, 0.02, 0.018).blend(0.006)));
  for (let i = 0; i < 6; i++) neck.hard.push(feather(add3(lerp3(NB, HJ, 0.15 + i * 0.15), [0, 0.02, -0.03]), [0.2 * (i % 2 ? 1 : -1), 0.3, -1], 0.14, 0.02, [rgb(C.cloth), rgb(tone(C.cloth, 0, 0, -0.1))], [1, 0, 0], 2).lod(2));
  const head = N(`${p}head`, `${p}neck`, [0, 0, 0], { rig: 'hheads', pos: sub3(HJ, NB), rot: [48, 0, 0], detail: 1.4, minRes: 30 });
  {
    const q = head.prims;
    q.push(bn(S.ellipsoid(0.052, 0.05, 0.07).at(0, 0.0, 0.02)));
    q.push(bn(S.capsule([0, -0.005, 0.07], [0, -0.02, 0.27], 0.04, 0.03).blend(0.02)));
    q.push(bn(S.capsule([0, -0.055, 0.03], [0, -0.05, 0.25], 0.022, 0.018).blend(0.004)));              // jaw bone
    q.push(...S.mirrorX([S.sphere(0.021).at(0.04, 0.008, 0.07).color(0x120c08).cut(0.005), S.ellipsoid(0.012, 0.012, 0.03).at(0.02, 0.0, 0.25).color(0x120c08).cut(0.004), bn(S.ellipsoid(0.01, 0.03, 0.014).rot(-20, 0, -14).at(0.03, 0.06, -0.01).blend(0.006))]));
    q.push(S.box(0.1, 0.006, 0.16, 0.001).at(0, -0.034, 0.17).color(0x1a140c).cut(0.003));
    q.push(S.ellipsoid(0.03, 0.012, 0.09).at(0, 0.034, 0.12).color(C.trim).pbr(0.35, 0.9).blend(0.004));                           // chamfron
    for (const sx of [1, -1]) head.hard.push(glowEye([0.036 * sx, 0.008, 0.07], 0.012, C.glow, 1.8));
    for (let i = 0; i < 3; i++) head.hard.push(feather([0, 0.045, 0.0], [(i - 1) * 0.35, 1, -0.3], 0.16, 0.022, [rgb(C.cloth), rgb(C.trim)], [0, 0, 1], 1).lod(2));
  }
  const tl = N(`${p}tail`, `${p}body`, [x0, 0.78, z0 - 0.37], { rig: 'htails', minRes: 30 });
  tl.prims.push(...S.limb([[x0, 0.78, z0 - 0.37], [x0, 0.74, z0 - 0.46], [x0, 0.62, z0 - 0.52]], [0.018, 0.014, 0.008]).map(bn));
  for (let i = 0; i < 4; i++) tl.hard.push(H.tube([[x0, 0.7, z0 - 0.49], [x0 + (i - 1.5) * 0.02, 0.5, z0 - 0.56], [x0 + (i - 1.5) * 0.035, 0.3, z0 - 0.54]], [0.006, 0.005, 0.001], 5, 3).color(0x2a2620).lod(1));
  const leg = (nm, sx, front) => {
    const x = x0 + sx * 0.08;
    const J = front ? [x, 0.69, z0 + 0.27] : [x, 0.72, z0 - 0.3], K = front ? [x, 0.4, z0 + 0.28] : [x, 0.44, z0 - 0.22];
    const A = front ? [x, 0.2, z0 + 0.275] : [x, 0.24, z0 - 0.33], Fp = front ? [x, 0.0, z0 + 0.29] : [x, 0.0, z0 - 0.3];
    const hb = (q) => q.color(C.bone).pbr(0.55);
    const up = N(`${p}leg${nm}`, `${p}body`, J, { rig: 'legs' });
    up.hard.push(hb(H.tube([J, lerp3(J, K, 0.5), K], [0.03, 0.019, 0.026], 6, 6)).near(), hb(H.tube([J, K], [0.028, 0.024], 1, 4)).far(), hb(H.sphere(0.033, 8).at(...J)).lod(1), hb(H.sphere(0.029, 8).at(...K)).color(C.boneD));
    const lo = N(`${p}shin${nm}`, `${p}leg${nm}`, K, { rig: 'shins' });
    lo.hard.push(hb(H.tube([K, lerp3(K, A, 0.5), A], [0.024, 0.016, 0.02], 6, 6)).near(), hb(H.tube([K, A], [0.022, 0.02], 1, 4)).far(), hb(H.sphere(0.023, 8).at(...A)).color(C.boneD).lod(1), hb(H.tube([A, [Fp[0], 0.05, Fp[2]]], [0.018, 0.02], 2, 6)));
    lo.hard.push(H.cyl(0.026, 0.038, 0.055, 8).at(Fp[0], 0.028, Fp[2] + 0.004).color(0x2a2620).pbr(0.5));
    lo.hard.push(H.torus(0.022, 0.008, 8, 4).rot(90, 0, 0).at(Fp[0], 0.075, Fp[2]).color(C.trim).pbr(0.35, 0.9).lod(1));
  };
  leg('FL', 1, true); leg('FR', -1, true); leg('BL', 1, false); leg('BR', -1, false);
}

function chariot(def, o = {}) {
  const bone = col(o.bone, 0xe8e0c8), trim = col(o.trim, 0xd8b03a), cloth = col(o.cloth, 0x1f5a8a);
  const C = { bone, boneD: tone(bone, 0, 0, -0.08), trim, cloth, glow: col(o.glow, 0x5affd0) };
  const wood = 0x6a4a2c, woodD = 0x4a3420;
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const HZ = 0.52, CZ = -0.66, HX = 0.27;
  boneHorse(N, 'h0_', HX, HZ, C); boneHorse(N, 'h1_', -HX, HZ, C);
  // the car
  const car = N('car', 'root', [0, 0.32, CZ], { rig: 'body', detail: 1.0 });
  {
    const R0 = 0.33, FY = 0.36;
    car.hard.push(H.cyl(R0, R0, 0.03, 20).scale(1, 1, 1.05).at(0, FY, CZ).color(wood).pbr(0.85).shade((x, y, z) => (Math.sin(x * 55) > 0.9 ? rgb(woodD) : null)));
    // breastwork: a curved screen round the front and sides
    const scr = H.sheet(1, 0.4, 20, 4, (u, v) => { const a = (u - 0.5) * Math.PI * 1.25, top = 0.4 * (0.62 + 0.38 * Math.cos(a * 0.8)); return [Math.sin(a) * R0 - (u - 0.5), top * v - (v - 0.5) * 0.4 - 0.2, Math.cos(a) * R0 * 1.05]; });
    car.hard.push(scr.at(0, FY + 0.2, CZ).color(cloth).pbr(0.7).shade((x, y, z) => (y > -0.165 && y < -0.13 ? rgb(trim) : Math.abs(x) < 0.07 && y < 0.02 && y > -0.1 && Math.hypot(x, y + 0.04) < 0.062 ? rgb(trim) : Math.sin((Math.atan2(x, z)) * 14) > 0.75 ? rgb(tone(cloth, 0, 0, 0.1)) : null)));
    const rim = []; for (let i = 0; i <= 12; i++) { const a = (i / 12 - 0.5) * Math.PI * 1.25; rim.push([Math.sin(a) * R0, FY + 0.4 * (0.62 + 0.38 * Math.cos(a * 0.8)), CZ + Math.cos(a) * R0 * 1.05]); }
    car.hard.push(H.tube(rim, 0.016, 24, 6).color(trim).pbr(0.35, 0.9));
    car.hard.push(H.cyl(0.02, 0.02, 0.86, 8).rot(0, 0, 90).at(0, 0.3, CZ).color(woodD).pbr(0.8));
    // pole and yoke
    car.hard.push(H.tube([[0, 0.33, CZ + 0.25], [0, 0.4, CZ + 0.7], [0, 0.7, HZ + 0.1], [0, 0.88, HZ + 0.3]], 0.02, 16, 6).color(wood).pbr(0.85));
    car.hard.push(H.tube([[-HX - 0.12, 0.86, HZ + 0.3], [-HX, 0.9, HZ + 0.3], [0, 0.88, HZ + 0.3], [HX, 0.9, HZ + 0.3], [HX + 0.12, 0.86, HZ + 0.3]], 0.018, 16, 6).color(trim).pbr(0.35, 0.9));
    // reins, a case of javelins, a standard
    for (const sx of [1, -1]) car.hard.push(H.tube([[-0.1 + sx * 0.05, FY + 0.56, CZ + 0.16], [sx * HX * 0.6, 0.86, 0.1], [sx * HX, 0.93, HZ + 0.34]], 0.005, 10, 3).color(0x3a2a1c).lod(1));
    car.hard.push(H.cyl(0.05, 0.04, 0.34, 8).rot(-14, 0, 0).at(R0 + 0.04, FY + 0.2, CZ - 0.02).color(cloth).pbr(0.7).shade((x, y) => (Math.abs(y) > 0.14 ? rgb(trim) : null)));
    for (let i = 0; i < 3; i++) car.hard.push(H.cyl(0.007, 0.007, 0.6, 5).rot(-14 + i * 3, 0, (i - 1) * 3).at(R0 + 0.04 + (i - 1) * 0.02, FY + 0.38, CZ - 0.06).color(woodD).lod(1), H.cone(0.014, 0.06, 5).rot(-14 + i * 3, 0, (i - 1) * 3).at(R0 + 0.04 + (i - 1) * 0.035, FY + 0.69, CZ - 0.14 - i * 0.015).color(0xc8a85a).pbr(0.35, 0.9).lod(1));
    car.hard.push(H.cyl(0.011, 0.011, 1.0, 6).at(-R0 + 0.03, FY + 0.5, CZ - 0.2).color(woodD));
    car.hard.push(H.cyl(0.11, 0.11, 0.012, 14).rot(90, 0, 0).at(-R0 + 0.03, FY + 1.0, CZ - 0.2).color(trim).pbr(0.3, 0.95).shade((x, y, z) => (Math.hypot(x, z) < 0.05 ? rgb(cloth) : null)));
    for (let i = 0; i < 9; i++) { const a = (i / 8 - 0.5) * 2.6; car.hard.push(feather([-R0 + 0.03 + Math.sin(a) * 0.1, FY + 1.0 + Math.cos(a) * 0.1, CZ - 0.2], [Math.sin(a), Math.cos(a), 0], 0.13, 0.024, [rgb(trim), rgb(i % 2 ? cloth : bone)], [0, 0, 1], 1).lod(2)); }
  }
  for (const sx of [1, -1]) {
    const w = N(`wheel${sx > 0 ? 'L' : 'R'}`, 'car', [sx * 0.4, 0.3, CZ], { rig: 'wheels' });
    const P = (h) => h.at(sx * 0.4, 0.3, CZ);
    w.hard.push(P(H.torus(0.285, 0.022, 28, 6).rot(0, 90, 0).color(wood).pbr(0.85)).near(), P(H.torus(0.29, 0.026, 14, 4).rot(0, 90, 0).color(trim).pbr(0.5, 0.6)).far());
    w.hard.push(P(H.torus(0.305, 0.012, 28, 5).rot(0, 90, 0).color(trim).pbr(0.35, 0.9)).near());
    for (let i = 0; i < 6; i++) w.hard.push(P(H.cyl(0.014, 0.018, 0.27, 6).at(0, 0.145, 0).rot(i * 60, 0, 0).color(i % 2 ? wood : woodD).pbr(0.85)));
    w.hard.push(P(H.cyl(0.045, 0.045, 0.09, 10).rot(0, 0, 90).color(trim).pbr(0.35, 0.9)));
  }
  const cc = { skin: bone, cloth, metal: trim };
  addCrew(N, 'c0_', 'car', [-0.1, 0.375, CZ + 0.02], 0.98, 'bone', cc, { arms: [0.85, 0.85] });
  const sp = addCrew(N, 'c1_', 'car', [0.13, 0.375, CZ - 0.1], 1.0, 'bone', cc, { arms: [0.4, 0.75], yaw: -8 });
  if (sp.hand) {
    const g = sp.hand.p, sn = N('spear', sp.hand.node.name, g, { rig: 'spear' });
    sn.hard.push(H.cyl(0.011, 0.011, 1.3, 6).rot(74, 0, 0).at(g[0], g[1] + 0.06, g[2] + 0.22).color(woodD).pbr(0.8));
    sn.hard.push(H.cone(0.03, 0.14, 6).scale(1, 1, 0.5).rot(74, 0, 0).at(g[0], g[1] + 0.26, g[2] + 0.91).color(0xc8a85a).pbr(0.3, 0.9));
    sn.hard.push(H.torus(0.016, 0.006, 8, 4).rot(74 - 90, 0, 0).at(g[0], g[1] + 0.235, g[2] + 0.83).color(trim).pbr(0.35, 0.9).lod(1));
  }
  return { kind: 'titan.chariot', attack: 'thrust', nodes: finish(N.nodes) };
}

function chariotAnim(rig, inner, c, base) {
  const { R, P, keys } = base, s = (inner.scale.y || 1) * (rig.u || 1), t = c.t, ph = c.phase || 0, a = c.atk;
  const k = c.moving ? 1 : 0, L = rig.legs || [], Sh = rig.shins || [];
  const dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 2) : 0;
  for (let h = 0; h < 2; h++) {
    const g = t * 11 + ph + h * 0.7, idle = Math.sin(t * 1.3 + ph + h * 2.1), toss = Math.max(0, Math.sin(t * 0.6 + ph + h * 2.6)) ** 6;
    for (let j = 0; j < 4; j++) {
      const i = h * 4 + j, front = j < 2, off = front ? (j ? 0.5 : 0) : (j === 3 ? 2.2 : 2.7), an = g + off;   // a rotary gallop
      if (dead) { R(L[i], (front ? -0.9 : 0.7) * df); R(Sh[i], (front ? 1.6 : -1.1) * df); continue; }
      R(L[i], -Math.sin(an) * 0.6 * k + (front ? -0.05 : 0.05) * idle * (1 - k));
      R(Sh[i], k * (front ? Math.max(0, Math.cos(an)) * 1.1 : -Math.max(0, Math.cos(an)) * 0.5 + Math.max(0, -Math.sin(an)) * 0.5));
    }
    const hb = (rig.horses || [])[h];
    P(hb, 0, dead ? -0.42 * df : k * Math.sin(g * 2) * 0.02, 0); R(hb, dead ? 0 : k * Math.sin(g) * 0.04, 0, dead ? (h ? -1 : 1) * 0.25 * df : 0);
    R((rig.hnecks || [])[h], dead ? 0.9 * df : 0.12 * k + k * Math.sin(g + 0.6) * 0.07 + idle * 0.04 - toss * 0.3, dead ? 0 : idle * 0.06);
    R((rig.hheads || [])[h], dead ? 0.2 * df : -0.05 * k + toss * 0.35 + idle * 0.03);
    R((rig.htails || [])[h], k * 0.5 + Math.sin(t * (k ? 9 : 2) + h) * 0.15, Math.sin(t * 1.7 + h * 2) * 0.2);
  }
  if (k && !dead) (rig.wheels || []).forEach((w) => R(w, t * 9));
  R(rig.body, dead ? 0.36 * df : k * Math.sin(t * 22 + ph) * 0.012 - 0.01, 0, dead ? 0.3 * df : k * Math.sin(t * 13 + ph) * 0.012);
  P(rig.body, 0, k * Math.abs(Math.sin(t * 11 + ph)) * 0.012, 0);
  // the crew: the driver works the reins; the spearman draws back and thrusts
  const CA = rig.crewArms || [], thrust = a >= 0 ? keys(a, [[0, 0], [0.35, -1], [0.52, 1], [1, 0]]) : 0;
  R(CA[0], Math.sin(t * (k ? 11 : 1.4) + ph) * (k ? 0.14 : 0.03)); R(CA[1], -Math.sin(t * (k ? 11 : 1.4) + ph) * (k ? 0.14 : 0.03));
  R(CA[2], 0.2 * thrust); R(CA[3], thrust < 0 ? 0.5 * thrust : -0.55 * thrust, 0, 0);
  (rig.crew || []).forEach((x, i) => R(x, 0.06 * k + (i ? 0.25 * Math.max(0, thrust) - 0.1 * Math.max(0, -thrust) : 0) + (dead ? 0.8 * df : 0), i ? -0.25 * thrust : 0, dead ? (i ? 0.5 : -0.4) * df : 0));
  (rig.crewHeads || []).forEach((x, i) => R(x, 0, Math.sin(t * 0.8 + i * 2 + ph) * 0.25 * (1 - k)));
  inner.rotation.x = 0; inner.rotation.z = 0;
  inner.position.set(0, dead ? -Math.max(0, c.dead - 0.5) * 0.7 * s : 0, 0);
}

// =====================================================================================
const guard = (fn) => (def, o) => fn(def || {}, o && typeof o === 'object' ? o : {});
const ALL = { bird, saurian, hydra, treeman, manticore, scorpion, sphinx, crab, djinn, serpent, centaur, wreckColossus, chariot };
const ANIM = { 'titan.bird': birdAnim, 'titan.vulture': vultureAnim, 'titan.tyrant': tyrantAnim, 'titan.quad': quadAnim, 'titan.hydra': hydraAnim, 'titan.tree': treeAnim, 'titan.manticore': manticoreAnim, 'titan.scorpion': scorpionAnim, 'titan.sphinx': sphinxAnim,
  'titan.crab': (rig, inner, c, base) => arthroAnim(rig, inner, c, base, true), 'titan.leviathan': leviathanAnim, 'titan.djinn': djinnAnim, 'titan.serpent': serpentAnim,
  'titan.centaur': centaurAnim, 'titan.wreck': wreckAnim, 'titan.chariot': chariotAnim };
export const bodies = Object.fromEntries(Object.entries(ALL).map(([k, f]) => [k, guard(f)]));
export const animators = ANIM;
