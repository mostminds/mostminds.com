// Chaos beasts, second brood: the swamp, the labyrinth, the velvet court and the pearl fleet.
//
//   bodies.bogSlug(def, o)      { skin, spots, scale }                    kind 'chaos2.slug'
//   bodies.fateLord(def, o)     { feathers, glow, heads, scale }          kind 'chaos2.fate'    (flies)
//   bodies.skyManta(def, o)     { color, belly, glow, scale, rider? }     kind 'chaos2.manta'   (flies)
//   bodies.shardHorror(def, o)  { color, glow, scale }                    kind 'chaos2.shard'
//   bodies.whipFiend(def, o)    { skin, armor, scale }                    kind 'titan.quad'     (the stock four-legged walk, tail lash)
//
// Authoring convention (the same one titans.js uses): one rest-pose space, Y up, facing +Z, feet on y = 0.
// Every node records the point it pivots about (`o`); finish() moves each node's pieces into the node's own space.
// Nodes given `pos` / `rot` are authored in their own frame instead. The helpers below are copied from titans.js.
import * as THREE from 'three';
import { S, H, rgb, noise3 } from '../sculpt.js';
import { humanoid, poseCarried } from './humanoid.js';
import { proportions } from './anatomy.js';

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

// ---------- pieces shared by this brood ----------
/** a faceted crystal along +Y from 0 to 1 (hexagonal, pointed at both ends); aspect = radius / length */
function crystalGeo(aspect, sides = 6) {
  return cached(`xtal${aspect}:${sides}`, () => {
    const r = aspect, ta = Math.min(0.28, r * 2.0), tb = Math.min(0.34, r * 2.6);
    const g0 = new THREE.LatheGeometry([[0.0001, 0], [r * 0.78, ta], [r, 0.5], [r * 0.88, 1 - tb], [0.0001, 1]].map(([x, y]) => new THREE.Vector2(x, y)), sides);
    const g = g0.toNonIndexed();
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g.computeVertexNormals();
    return g;
  });
}
/** a crystal shard from base along dir; facets coloured between cA and cB by the way they face (iridescence) */
function shard(base, dir, len, r, cA, cB, seed = 0, opt = {}) {
  const asp = Math.max(0.04, Math.round((r / len) * 40) / 40);
  const A = rgb(cA), B = rgb(cB), Wt = [1, 1, 1];
  const h = H.geo(crystalGeo(asp, opt.sides ?? 6)).scale(len).shade((x, y, z, nx, ny, nz) => {
    const f = 0.5 + 0.5 * Math.sin(nx * 2.9 + nz * 3.3 + ny * 1.7 + seed * 1.91);
    let c3 = mixRgb(A, B, smooth(f));
    if (y > 0.82) c3 = mixRgb(c3, Wt, (y - 0.82) * 2.2);
    return c3;
  }).color(cA).pbr(opt.rough ?? 0.14, opt.metal ?? 0.2).glow(opt.glow ?? 0.22);
  return orient(h, base, dir, opt.up ?? [0, 0, 1]);
}
/** a toadstool standing at p: stem height h, cap radius cr */
function toadstool(p, h, cr, capCol, opt = {}) {
  const out = [], tilt = opt.tilt ?? [0, 0, 0];
  const put = (q) => q.rot(tilt[0], tilt[1], tilt[2]).at(p[0], p[1], p[2]);
  out.push(put(H.cyl(cr * 0.26, cr * 0.36, h, 7).at(0, h / 2, 0).color(opt.stem ?? 0xe8e0c4).pbr(0.7)));
  const cap = H.lathe([[0.001, h + cr * 0.6], [cr * 0.45, h + cr * 0.55], [cr * 0.85, h + cr * 0.32], [cr, h + cr * 0.05], [cr * 0.8, h - cr * 0.04], [0.001, h]], opt.seg ?? 10).color(capCol).pbr(opt.rough ?? 0.45);
  if (opt.glow) cap.glow(opt.glow);
  out.push(put(cap));
  if (opt.dots) for (let i = 0; i < opt.dots; i++) {
    const a = i * 2.4 + 0.6, d = cr * (0.25 + 0.45 * ((i * 0.37) % 1));
    out.push(put(H.sphere(cr * 0.11, 5).scale(1, 0.5, 1).at(Math.sin(a) * d, h + cr * (0.6 - (d / cr) * 0.38), Math.cos(a) * d).color(0xf4ecd8).pbr(0.6)).lod(1));
  }
  return out;
}
/** a rune: a few glowing strokes in the plane at c facing nrm, `up` its upright; pattern 0..5 */
const RUNES = [
  [[0, -0.5, 0, 0.5], [0, 0.1, -0.35, 0.45], [0, 0.1, 0.35, 0.45]],
  [[0, -0.5, 0.35, 0], [0.35, 0, 0, 0.5], [0, 0.5, -0.35, 0], [-0.35, 0, 0, -0.5]],
  [[-0.4, -0.3, 0.4, -0.3], [0, -0.3, 0, 0.5], [-0.3, 0.2, 0.3, 0.2]],
  [[-0.3, 0.5, 0.3, 0.2], [0.3, 0.2, -0.3, -0.2], [-0.3, -0.2, 0.3, -0.5]],
  [[-0.4, -0.4, 0.4, -0.4], [0.4, -0.4, 0, 0.4], [0, 0.4, -0.4, -0.4]],
  [[-0.35, -0.5, -0.35, 0.5], [-0.35, 0.5, 0.35, 0.1], [-0.35, 0, 0.35, -0.5]],
];
function rune(c, nrm, up, size, color, pat, glow = 1.5) {
  const n = norm3(nrm), rt = norm3(cross3(up, n)), u = norm3(cross3(n, rt)), out = [], w = size * 0.11;
  for (const [x0, y0, x1, y1] of RUNES[pat % RUNES.length]) {
    const a = add3(c, add3(mul3(rt, x0 * size), mul3(u, y0 * size))), b = add3(c, add3(mul3(rt, x1 * size), mul3(u, y1 * size)));
    const L = len3(sub3(b, a)) + w;
    out.push(orient(H.box(w, L, w * 0.6, w * 0.2), add3(lerp3(a, b, 0.5), mul3(n, w * 0.3)), sub3(b, a), n).color(color).glow(glow).pbr(0.3).lod(1));
  }
  return out;
}
/** wrap a node list of a humanoid descriptor onto `parent`; f scales it, at = its root position in the parent's frame */
function seatHumanoid(nodes, desc, parent, at, f, rot) {
  for (const n of desc.nodes) {
    const m = { ...n, name: n.name === 'root' ? 'rider' : `r_${n.name}` };
    if (n.name === 'root') { m.parent = parent; m.pos = at; m.rig = 'rider'; if (rot) m.rot = rot; }
    else { m.parent = n.parent === 'root' ? 'rider' : `r_${n.parent}`; m.pos = mul3(n.pos || [0, 0, 0], f); }
    if (f !== 1) { m.prims = flat(n.prims).map((q) => q.clone().scale(f)); m.hard = flat(n.hard).map((q) => q.clone().scale(f)); }
    nodes.push({ ...m, raw: true });
  }
}
const finishRaw = (nodes) => { const fin = finish(nodes.filter((n) => !n.raw)); for (const n of nodes) if (n.raw) { const m = { ...n }; delete m.raw; fin.push(m); } return fin; };

// =====================================================================================
//  THE BOG-SLUG: a vast, cheerful swamp slug
// =====================================================================================
// rig: torso (mid body), tail[] (two rear sections), neck (the raised front), head, jaw, tongue[], feelers[], stubs[] (little legs)

// the body's section along its length: [z, centre y, half width, half height]
const SLUG = [[-1.0, 0.05, 0.03, 0.025], [-0.82, 0.08, 0.1, 0.07], [-0.56, 0.13, 0.2, 0.13], [-0.28, 0.2, 0.29, 0.2], [0.02, 0.23, 0.31, 0.22], [0.26, 0.25, 0.28, 0.2], [0.44, 0.33, 0.23, 0.18], [0.56, 0.36, 0.2, 0.16]];
function slugSec(z) {
  if (z <= SLUG[0][0]) return SLUG[0].slice(1);
  for (let i = 1; i < SLUG.length; i++) if (z <= SLUG[i][0]) { const a = SLUG[i - 1], b = SLUG[i], f = (z - a[0]) / (b[0] - a[0]); return [lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)]; }
  return SLUG[SLUG.length - 1].slice(1);
}

function bogSlug(def, o = {}) {
  const skin = col(o.skin, 0xa8b86a), spots = col(o.spots, 0x6a3a5a);
  const rnd = rng(hashStr((def?.id || 'bogSlug') + ':slug'));
  const C = {
    skin, back: tone(skin, 0.01, 0.04, -0.07), foot: mix(skin, 0xf2ecc8, 0.3), spot: spots, spotL: mix(spots, skin, 0.4), moss: tone(skin, 0.06, 0.05, -0.2),
    mouth: 0x4a1426, tongue: 0xe8789a, tongueD: 0xc04a6a, slime: tone(skin, -0.02, 0.2, 0.06), trail: tone(skin, 0.0, 0.12, -0.1),
  };
  const sk = (q) => q.color(C.skin).tint(0.12, 7).bump(0.004, 24, 'noise').pbr(0.2, 0.04);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  // a glistening trail behind it
  {
    const tr = N('trail', 'root', [0, 0, 0], { rig: 'trail' });
    const W = 0.56, L = 1.5, zc = -0.95;
    const sh = H.sheet(W, L, 6, 14, (u, v) => {
      const narrow = 1 - 0.6 * v, wav = 0.035 * Math.sin(v * 11 + 1.3) * (u - 0.5) * 2;
      return [(u - 0.5) * W * (narrow - 1) + wav, 0, 0.003 * Math.sin(u * 9 + v * 13)];
    });
    tr.hard.push(sh.rot(-90, 0, 0).at(0, 0.006, zc).shade((x, y, z) => mixRgb(rgb(C.trail), rgb(C.slime), clamp(Math.abs(x) * 4 + 0.5 * noise3(x * 9, y * 4, 0.3) - 0.2))).color(C.trail).pbr(0.04, 0.35).glow(0.06));
  }
  const spotsOn = (n, z0, z1, count) => {
    for (let i = 0; i < count; i++) {
      const z = lerp(z0, z1, rnd()), [y, w, h] = slugSec(z), a = (rnd() - 0.5) * 2.4;
      const p = [Math.sin(a) * w * 0.98, y + Math.cos(a) * h * 0.98, z], r = 0.025 + rnd() * 0.04;
      n.prims.push(S.sphere(r).at(...p).color(C.spot).paint(0.01));
      if (r > 0.045) n.prims.push(S.sphere(r * 0.5).at(...add3(p, [0, 0.005, 0.01])).color(C.spotL).paint(0.006));
    }
  };
  const section = (n, z0, z1, footTo = 0.36) => {
    const steps = Math.max(2, Math.round((z1 - z0) / 0.08));
    for (let j = 0; j <= steps; j++) {
      const z = lerp(z0, z1, j / steps), [y, w, h] = slugSec(z);
      n.prims.push(sk(S.ellipsoid(w, h, 0.17).at(0, y, z)).blend(0.1));
      if (z < footTo) n.prims.push(S.ellipsoid(w * 1.1 + 0.01, 0.045, 0.15).at(0, 0.045, z).color(C.foot).pbr(0.3).blend(0.07));
    }
    // a darker band along the back
    n.prims.push(S.capsule([0, slugSec(z0)[0] + slugSec(z0)[2] * 0.9, z0], [0, slugSec(z1)[0] + slugSec(z1)[2] * 0.9, z1], 0.06, 0.06).color(C.back).paint(0.04));
  };
  // ---- the middle of the body, with the mantle and the fungus garden on its back
  const torso = N('torso', 'root', [0, 0.2, -0.05], { rig: 'torso', detail: 0.46 });
  section(torso, -0.36, 0.28);
  torso.prims.push(sk(S.ellipsoid(0.29, 0.11, 0.24).at(0, 0.39, 0.1).blend(0.06)).color(tone(skin, 0.02, 0.04, -0.03)).bump(0.006, 34, 'ridges'));     // mantle
  torso.prims.push(S.sphere(0.03).at(0.27, 0.33, 0.12).color(0x3a3a1a).cut(0.01));                                                                     // breathing pore
  torso.prims.push(S.ellipsoid(0.2, 0.08, 0.2).at(-0.04, 0.42, -0.14).color(C.moss).bump(0.01, 30, 'fur').tint(0.2, 10).pbr(0.85).paint(0.03, 0.006)); // moss patch
  spotsOn(torso, -0.36, 0.28, 12);
  {
    const H0 = (x, z) => { const [y, w, h] = slugSec(z); return [x, y + h * Math.sqrt(Math.max(0, 1 - (x / w) ** 2)) - 0.01, z]; };
    const caps = [[0.06, -0.12, 0.13, 0.085, 0xc8402a, 4], [-0.1, -0.2, 0.1, 0.07, 0xd85a2a, 3], [0.12, -0.24, 0.07, 0.05, 0xc8402a, 2], [-0.02, -0.04, 0.08, 0.06, 0xd8b878, 0],
      [-0.15, -0.06, 0.06, 0.04, 0xd8b878, 0], [0.16, -0.06, 0.05, 0.035, 0xd8b878, 0], [0.0, -0.3, 0.05, 0.035, 0xc8f060, 0, 0.9], [-0.06, -0.33, 0.04, 0.028, 0xc8f060, 0, 0.9], [0.08, 0.02, 0.04, 0.026, 0xc8f060, 0, 0.9]];
    caps.forEach(([x, z, h, cr, c, dots, g], i) => torso.hard.push(...toadstool(H0(x, z), h, cr, c, { dots, glow: g, tilt: [Math.sin(i * 2.1) * 12, 0, Math.sin(i * 1.3) * 14], stem: g ? 0xd8e8a0 : 0xe8e0c4 }).map((q, j) => (i > 5 && j > 0 ? q : i > 2 ? q.lod(2) : q))));
    // shelf fungus on the flanks
    for (const [sx, z, y] of [[1, -0.22, 0.25], [1, -0.15, 0.32], [-1, -0.1, 0.25]]) {
      const [cy, w] = slugSec(z);
      torso.hard.push(H.sphere(0.1, 10).scale(0.7, 0.24, 1).rot(0, 0, sx * 12).at(sx * (w * Math.sqrt(Math.max(0, 1 - ((y - cy) / 0.21) ** 2)) + 0.015), y, z).color(0xb8884a).pbr(0.7).shade((x, yy, zz, nx, ny) => (ny > 0.6 ? 0xd8b070 : null)).lod(1));
    }
  }
  // ---- the tail: two sections that ripple as it creeps
  const t0 = N('tail0', 'torso', [0, 0.17, -0.36], { rig: 'tail', detail: 0.46 });
  section(t0, -0.66, -0.36); spotsOn(t0, -0.64, -0.38, 6);
  t0.hard.push(...toadstool([0.04, slugSec(-0.5)[0] + slugSec(-0.5)[2] - 0.01, -0.5], 0.07, 0.05, 0xc8402a, { dots: 2, tilt: [-10, 0, 8] }));
  const t1 = N('tail1', 'tail0', [0, 0.1, -0.66], { rig: 'tail', detail: 0.5, minRes: 34 });
  section(t1, -0.98, -0.66); spotsOn(t1, -0.9, -0.68, 3);
  // ---- the raised front, the head and its grin
  const neck = N('neck', 'torso', [0, 0.25, 0.24], { rig: 'neck', detail: 0.5 });
  section(neck, 0.24, 0.52, 0.4); spotsOn(neck, 0.26, 0.48, 4);
  const head = N('head', 'neck', [0, 0.42, 0.46], { rig: 'head', detail: 0.68 });
  {
    const p = head.prims;
    p.push(sk(S.ellipsoid(0.215, 0.15, 0.19).at(0, 0.52, 0.55)));
    p.push(sk(S.ellipsoid(0.225, 0.07, 0.17).at(0, 0.45, 0.6).blend(0.05)));                                         // the upper lip, overhanging
    p.push(...S.mirrorX([sk(S.ellipsoid(0.07, 0.05, 0.06).at(0.1, 0.6, 0.62).blend(0.04))]));                       // brows
    // the grin: a wide curved slit, turned up at the corners
    for (let i = 0; i <= 10; i++) {
      const f = (i / 10) * 2 - 1, a = f * 1.15;
      p.push(S.ellipsoid(0.035, 0.022, 0.04).at(Math.sin(a) * 0.2, 0.415 + 0.035 * f * f, 0.6 + Math.cos(a) * 0.15).color(C.mouth).cut(0.012));
    }
    spotsOn(head, 0.44, 0.6, 0);
    for (const [x, y, z, r] of [[0.15, 0.56, 0.48, 0.03], [-0.13, 0.6, 0.5, 0.024], [0.05, 0.65, 0.44, 0.022]]) p.push(S.sphere(r).at(x, y, z).color(C.spot).paint(0.008));
    p.push(...S.mirrorX([S.ellipsoid(0.045, 0.03, 0.02).at(0.15, 0.49, 0.72).color(mix(skin, 0xe88a9a, 0.45)).paint(0.02)]));   // a flush in the cheeks
  }
  const jaw = N('jaw', 'head', [0, 0.43, 0.48], { rig: 'jaw', detail: 0.7 });
  {
    jaw.prims.push(sk(S.ellipsoid(0.2, 0.085, 0.16).at(0, 0.37, 0.58)));
    jaw.prims.push(S.ellipsoid(0.17, 0.035, 0.13).at(0, 0.44, 0.6).color(C.mouth).paint(0.012));
    jaw.prims.push(S.ellipsoid(0.12, 0.03, 0.09).at(-0.03, 0.445, 0.6).color(C.tongueD).paint(0.01));
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.45 + 0.2, p0 = [Math.sin(a) * 0.17, 0.4, 0.6 + Math.cos(a) * 0.13];
      jaw.hard.push(H.tube([p0, add3(p0, [0.004, -0.07 - (i % 2) * 0.04, 0.01]), add3(p0, [0.0, -0.13 - (i % 3) * 0.06, 0.012])], [0.012, 0.008, 0.004], 5, 5).color(C.slime).pbr(0.05, 0.1).glow(0.15).lod(i % 2 ? 2 : 1));
      jaw.hard.push(H.sphere(0.012, 6).at(p0[0], 0.4 - 0.14 - (i % 3) * 0.06, p0[2] + 0.012).color(C.slime).pbr(0.05, 0.1).glow(0.15).lod(1));
    }
  }
  // the tongue lolls out of the side of the grin
  const tg = N('tongue', 'jaw', [0.05, 0.43, 0.62], { rig: 'tongue', detail: 1.1, minRes: 40 });
  {
    const tq = (q) => q.color(C.tongue).pbr(0.25).tint(0.06, 20);
    const TP = [[0.04, 0.43, 0.6], [0.1, 0.42, 0.71], [0.15, 0.36, 0.77], [0.17, 0.28, 0.76], [0.165, 0.22, 0.72]], TR = [0.05, 0.048, 0.042, 0.036, 0.026];
    for (let i = 0; i < TP.length - 1; i++) tg.prims.push(tq(S.capsule(TP[i], TP[i + 1], TR[i], TR[i + 1])).blend(0.02));
    for (let i = 1; i < TP.length - 1; i++) tg.prims.push(S.sphere(0.012).at(...add3(TP[i], [0.01, 0.0, TR[i] * 0.85])).color(C.tongueD).paint(0.01, -0.004));
    tg.hard.push(H.tube([[0.165, 0.2, 0.72], [0.166, 0.14, 0.72], [0.168, 0.07, 0.72]], [0.01, 0.007, 0.003], 4, 5).color(C.slime).pbr(0.05, 0.1).glow(0.15).lod(1));
  }
  // eyes on short stalks (the upper feelers), two stubby feelers below
  for (const sx of [1, -1]) {
    const b = [0.09 * sx, 0.62, 0.52], tip = [0.15 * sx, 0.77, 0.58];
    const f = N(`stalk${sx > 0 ? 'L' : 'R'}`, 'head', b, { rig: 'feelers', detail: 1.2, minRes: 50 });
    f.prims.push(sk(S.capsule(b, tip, 0.04, 0.03)), sk(S.sphere(0.04).at(...tip).blend(0.02)));
    const ec = add3(tip, [0.01 * sx, 0.035, 0.02]);
    f.hard.push(eyeAt(ec, [0.25 * sx, 0.05, 1], 0.06, { iris: 0x3a2412, rim: 0x140a06, pupil: 0x040303, white: 0xf6f2e4, slit: false }));
    f.hard.push(H.sphere(0.013, 6).at(ec[0] + 0.012 * sx, ec[1] + 0.025, ec[2] + 0.05).color(0xffffff).glow(1.2).lod(1));
    const b2 = [0.13 * sx, 0.47, 0.68], t2 = [0.21 * sx, 0.45, 0.8];
    const f2 = N(`feeler${sx > 0 ? 'L' : 'R'}`, 'head', b2, { rig: 'feelers', detail: 1.2, minRes: 50 });
    f2.prims.push(sk(S.capsule(b2, t2, 0.032, 0.022)), sk(S.sphere(0.026).at(...t2).blend(0.01)).color(C.back));
  }
  // little vestigial legs, three a side, paddling beneath the skirt
  for (const [z, par] of [[0.18, 'torso'], [-0.16, 'torso'], [-0.46, 'tail0']]) for (const sx of [1, -1]) {
    const [, w] = slugSec(z), b = [sx * (w + 0.0), 0.07, z];
    const n = N(`stub${sx > 0 ? 'L' : 'R'}${Math.round(z * 100)}`, par, b, { rig: 'stubs', detail: 1.2, minRes: 46 });
    const e = [sx * (w + 0.055), 0.028, z + 0.03];
    n.prims.push(sk(S.capsule(b, e, 0.042, 0.034)), sk(S.ellipsoid(0.04, 0.024, 0.05).at(e[0], 0.024, e[2] + 0.01).blend(0.02)).color(C.foot));
    for (let i = 0; i < 3; i++) n.prims.push(S.sphere(0.011).at(e[0] + sx * 0.012 + (i - 1) * 0.012, 0.016, e[2] + 0.045).color(tone(C.foot, 0, 0, -0.1)).blend(0.006));
  }
  return { kind: 'chaos2.slug', attack: 'bite', nodes: finish(N.nodes) };
}

function slugAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const k = c.moving ? 1 : 0, wave = t * (k ? 5.5 : 1.3) + ph;
  inner.rotation.set(0, 0, 0); inner.position.set(0, 0, 0);
  const dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 1.6) : 0, e = smooth(df);
  let rear = 0, lunge = 0, jaw = 0.07 + 0.05 * Math.max(0, Math.sin(t * 0.9 + ph));
  if (a >= 0) { rear = keys(a, [[0, 0], [0.32, 1], [0.5, -0.3], [1, 0]]); lunge = keys(a, [[0, 0], [0.32, -0.25], [0.5, 1], [0.7, 0.6], [1, 0]]); jaw = keys(a, [[0, 0.07], [0.3, 0.75], [0.5, 0.12], [0.8, 0.3], [1, 0.07]]); }
  if (dead) { rear = 0; lunge = 0; jaw = 0.5 * e; }
  // a ripple runs back from the head as it creeps
  R(rig.torso, Math.sin(wave) * 0.025 * k, Math.sin(t * 0.6 + ph) * 0.03 * (1 - e), 0);
  (rig.tail || []).forEach((x, i) => R(x, Math.sin(wave - (i + 1) * 1.1) * 0.07 * k + 0.04 * e, Math.sin(t * (k ? 2.6 : 0.8) + ph - i * 0.8) * 0.12 * (1 - e), 0));
  R(rig.neck, -0.3 * rear + 0.16 * lunge + Math.sin(wave + 1.1) * 0.05 * k + 0.22 * e, Math.sin(t * 0.7 + ph) * 0.12 * (a >= 0 || dead ? 0 : 1));
  R(rig.head, 0.12 * rear - 0.05 * lunge + Math.sin(t * 1.3 + ph) * 0.03 + 0.15 * e, Math.sin(t * 0.5 + ph * 1.3) * 0.1 * (1 - e), Math.sin(t * 0.9 + ph) * 0.05 + 0.25 * e);
  R(rig.jaw, jaw);
  (rig.tongue || []).forEach((x) => R(x, Math.sin(t * 2.1 + ph) * 0.08 + 0.2 * e, 0, Math.sin(t * 1.7 + ph) * 0.1 - 0.2 * rear));
  (rig.feelers || []).forEach((x, i) => R(x, Math.sin(t * 2.3 + i * 1.7 + ph) * 0.14 + 0.6 * e, 0, Math.sin(t * 1.9 + i * 2.3 + ph) * 0.14 + (i % 2 ? -1 : 1) * 0.3 * e));
  (rig.stubs || []).forEach((x, i) => R(x, k ? Math.sin(t * 13 + i * 2.1) * 0.55 : Math.sin(t * 1.5 + i) * 0.08, 0, 0));
  if (dead) {
    // it slumps, rolls a little onto one flank and sinks into the bog
    inner.rotation.z = 0.32 * e;
    inner.position.y = (0.05 * e - Math.max(0, c.dead - 0.6) * 0.45) * s;
    return;
  }
  inner.position.z = (0.14 * lunge - 0.03 * rear) * s;
  inner.position.y = k * Math.max(0, Math.sin(wave)) * 0.012 * s;
}

// =====================================================================================
//  THE FATE-LORD: a towering many-headed bird sorcerer
// =====================================================================================
// rig: robe, legs[2], shins[2], torso, nk0[] nk1[] ... (one list of neck segments per head), hds[], jws[],
//      arms[2], forearms[2], staff[], orb[], wings[2], wingtips[2]

function fateLord(def, o = {}) {
  const base = col(o.feathers, 0x3a6ad8), glow = col(o.glow, 0xe85ac8), nH = clamp(Math.round(num(o.heads, 3)), 1, 5);
  const gold = 0xd8b03a, goldD = 0xa8822a, teal = tone(base, -0.09, 0.08, 0.08), violet = tone(base, 0.09, 0.02, -0.04);
  const robeC = tone(base, 0.03, -0.12, -0.22), robeD = tone(base, 0.04, -0.12, -0.3), lining = mix(robeC, glow, 0.45);
  const beakC = 0xe8d49a, faceC = tone(base, 0.02, -0.2, -0.32), runeC = mix(glow, 0xffffff, 0.25);
  const fe = (q, c = base) => q.color(c).bump(0.006, 30, 'scales').tint(0.18, 10).pbr(0.42, 0.12);
  const cloth = (q, c = robeC) => q.color(c).bump(0.005, 16, 'fur').tint(0.1, 9).pbr(0.78);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  // ---- the robe skirt: stays planted, the taloned feet stride beneath it
  const robe = N('robe', 'root', [0, 0.62, 0], { rig: 'robe', detail: 0.55 });
  {
    const p = robe.prims;
    p.push(cloth(S.cone(0.33, 0.18, 0.62, 0.03).at(0, 0.33, -0.02)));
    p.push(cloth(S.cone(0.25, 0.13, 0.56, 0.03).rot(-14, 0, 0).at(0, 0.33, -0.17).blend(0.06)));
    p.push(S.cyl(0.36, 0.08, 0.01).at(0, 0.035, -0.03).color(gold).pbr(0.35, 0.85).paint(0.006, 0.004));
    p.push(S.cyl(0.34, 0.025, 0.005).at(0, 0.11, -0.03).color(gold).pbr(0.35, 0.85).paint(0.004, 0.003));
    p.push(S.box(0.09, 0.62, 0.45, 0.01).at(0, 0.33, 0.15).color(lining).paint(0.008, 0.002));
    p.push(S.box(0.11, 0.62, 0.45, 0.01).at(0, 0.33, 0.15).color(gold).pbr(0.35, 0.85).paint(0.006, 0.001));
    p.push(S.box(0.07, 0.62, 0.45, 0.01).at(0, 0.33, 0.15).color(robeD).paint(0.006, 0.002));
    const rAt = (y) => lerp(0.33, 0.18, (y - 0.02) / 0.62);
    // a ring of runes round the hem, a column of them down the front
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 6.283 + 0.26, y = 0.2, r = rAt(y) + 0.004;
      if (Math.abs(Math.cos(a)) < 0.3 && Math.cos(a) < 0) continue;
      robe.hard.push(...rune([Math.sin(a) * r, y, Math.cos(a) * r - 0.02], [Math.sin(a), 0.22, Math.cos(a)], [0, 1, 0], 0.07, runeC, i, 1.4));
    }
    for (let i = 0; i < 3; i++) { const y = 0.3 + i * 0.12, r = rAt(y) + 0.008; robe.hard.push(...rune([0, y, r - 0.02], [0, 0.22, 1], [0, 1, 0], 0.055, runeC, i + 3, 1.6)); }
    for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283 + 0.35; robe.hard.push(H.sphere(0.014, 6).at(Math.sin(a) * 0.36, 0.035, Math.cos(a) * 0.36 - 0.03).color(glow).glow(1.4).lod(1)); }
  }
  for (const sx of [1, -1]) {
    addLeg(N, sx > 0 ? 'L' : 'R', 'root', sx, [[0.09, 0.55, 0.0], [0.1, 0.3, 0.05], [0.1, 0.07, 0.0], [0.1, 0, 0.03]], [0.065, 0.038, 0.026],
      (q) => q.color(0xd8b04a).pbr(0.45).bump(0.003, 50, 'scales'), { detail: 0.55, minRes: 40, foot: { kind: 'talon', len: 0.15, w: 0.036, toes: 3, clawLen: 0.075, claw: 0x18140f, spread: 0.5 } });
  }
  // ---- torso: a broad chest of shining plumage under a gold pectoral
  const torso = N('torso', 'root', [0, 0.62, 0], { rig: 'torso', detail: 0.62 });
  {
    const p = torso.prims;
    p.push(cloth(S.ellipsoid(0.2, 0.2, 0.16).at(0, 0.8, 0.0)));
    p.push(fe(S.ellipsoid(0.23, 0.18, 0.18).rot(16, 0, 0).at(0, 0.97, 0.03).blend(0.06)));
    p.push(fe(S.ellipsoid(0.17, 0.14, 0.12).at(0, 0.93, 0.1).blend(0.05), teal));
    p.push(cloth(S.ellipsoid(0.17, 0.13, 0.14).at(0, 0.66, -0.01).blend(0.05)));
    p.push(fe(S.ellipsoid(0.17, 0.12, 0.14).at(0, 1.07, -0.07).blend(0.05), violet));
    p.push(...S.mirrorX([fe(S.ellipsoid(0.1, 0.09, 0.11).at(0.18, 1.06, -0.01).blend(0.05))]));
    p.push(S.torus(0.18, 0.028).at(0, 0.67, -0.005).color(gold).pbr(0.35, 0.85).paint(0.005, 0.006));
    p.push(S.box(0.06, 0.26, 0.32, 0.01).at(0, 0.79, 0.12).color(mix(robeC, glow, 0.3)).paint(0.008, 0.002));
    p.push(S.ellipsoid(0.17, 0.07, 0.1).rot(25, 0, 0).at(0, 1.02, 0.12).color(gold).pbr(0.32, 0.9).paint(0.006, 0.008));       // pectoral
    torso.hard.push(H.geo(cached('octa', () => new THREE.OctahedronGeometry(1, 0))).scale(0.035, 0.05, 0.02).at(0, 0.99, 0.205).color(glow).glow(1.8).pbr(0.15));
    torso.hard.push(H.torus(0.045, 0.009, 14, 5).scale(1, 1.25, 1).at(0, 0.99, 0.2).color(gold).pbr(0.3, 0.95).lod(1));
    for (let i = 0; i < 4; i++) torso.hard.push(H.sphere(0.012, 6).at(Math.sin((i - 1.5) * 0.5) * 0.12, 0.965 - Math.abs(i - 1.5) * 0.02, 0.16 + Math.cos((i - 1.5) * 0.5) * 0.03).color(glow).glow(1.5).lod(1));
    // a ruff where the necks rise, a mantle of feathers on the shoulders
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * 6.283, d = [Math.sin(a), 0.42, Math.cos(a) * 0.9 + 0.12];
      torso.hard.push(feather([Math.sin(a) * 0.11, 1.08, 0.05 + Math.cos(a) * 0.07], d, 0.2 + 0.04 * (i % 2), 0.045, [rgb(teal), rgb(i % 2 ? glow : gold)], [0, 1, 0], 1).lod(2));
    }
    for (const sx of [1, -1]) for (let i = 0; i < 5; i++) {
      torso.hard.push(feather([sx * (0.12 + i * 0.03), 1.1 - i * 0.012, -0.02 - i * 0.012], [sx * (0.6 + i * 0.1), -0.25, -0.6], 0.26, 0.055, [rgb(base), rgb(i % 2 ? gold : violet)], [0, 1, 0.3], 0).lod(2));
    }
  }
  // ---- the necks and their long-beaked heads
  const skn = (c) => (q) => q.color(c).bump(0.005, 36, 'fur').tint(0.14, 16).pbr(0.45, 0.1);
  for (let i = 0; i < nH; i++) {
    const f = nH === 1 ? 0 : (i - (nH - 1) / 2) / ((nH - 1) / 2), mid = 1 - Math.abs(f);
    const pts = [[f * 0.08, 1.08, 0.06], [f * 0.17, 1.27, 0.12], [f * 0.27, 1.44, 0.12], [f * 0.33, 1.58 + mid * 0.13, 0.19]];
    const cN = mix(teal, base, Math.abs(f) * 0.6), hk = 1.4;
    addChain(N, `n${i}_`, 'torso', pts, [0.058, 0.048, 0.042, 0.04], skn(cN), { rig: () => `nk${i}`, detail: 0.7, minRes: 36 });
    const hd = N(`hd${i}`, `n${i}_2`, [0, 0, 0], { rig: 'hds', pos: sub3(pts[3], pts[2]), rot: [12, f * 24, 0], detail: 0.95, minRes: 40 });
    {
      const p = hd.prims, sk2 = skn(cN), bk = (q) => q.color(beakC).pbr(0.3, 0.2).tint(0.08, 30);
      p.push(sk2(S.ellipsoid(0.05, 0.05, 0.068).at(0, 0.012, 0.0)));
      p.push(sk2(S.capsule([0, 0.0, -0.02], [0, -0.03, -0.075], 0.04, 0.036).blend(0.02)));
      p.push(...S.mirrorX([S.ellipsoid(0.026, 0.024, 0.034).at(0.026, 0.012, 0.04).color(faceC).paint(0.008)]));      // bare dark mask round the eyes
      p.push(bk(S.capsule([0, 0.004, 0.045], [0, -0.008, 0.13], 0.024, 0.016).blend(0.008)));
      p.push(bk(S.capsule([0, -0.008, 0.13], [0, -0.03, 0.2], 0.016, 0.01).blend(0.004)));
      p.push(bk(S.capsule([0, -0.03, 0.2], [0, -0.062, 0.245], 0.01, 0.003).blend(0.003)));
      for (const sx of [1, -1]) hd.hard.push(glowEye([0.042 * sx, 0.016, 0.04], 0.012, glow, 1.8));
      hd.hard.push(H.geo(cached('octa', () => new THREE.OctahedronGeometry(1, 0))).scale(0.008, 0.012, 0.006).at(0, 0.052, 0.04).color(glow).glow(2).lod(1));    // the third eye
      hd.hard.push(H.torus(0.05, 0.007, 14, 5).rot(78, 0, 0).at(0, 0.035, -0.005).color(gold).pbr(0.3, 0.95).lod(2));
      for (let j = 0; j < 4; j++) {
        const a = (j - 1.5) * 0.28;
        hd.hard.push(feather([Math.sin(a) * 0.025, 0.045, -0.02], [Math.sin(a) * 0.6, 0.55, -1], 0.16 - Math.abs(j - 1.5) * 0.02, 0.018, [rgb(cN), rgb(j % 2 ? gold : glow)], [0, 1, 0.3], 1).lod(j % 3 ? 2 : 1));
      }
    }
    for (const q of [...hd.prims, ...hd.hard]) q.scale(hk);
    const JO = mul3([0, -0.012, 0.03], hk);
    const jw = N(`jw${i}`, `hd${i}`, JO, { rig: 'jws', pos: JO, detail: 0.95, minRes: 40 });
    jw.prims.push(S.capsule([0, -0.012, 0.03], [0, -0.024, 0.12], 0.016, 0.01).color(beakC).pbr(0.3, 0.2));
    jw.prims.push(S.capsule([0, -0.024, 0.12], [0, -0.05, 0.19], 0.01, 0.003).color(beakC).pbr(0.3, 0.2).blend(0.004));
    jw.prims.push(skn(cN)(S.ellipsoid(0.03, 0.022, 0.04).at(0, -0.022, 0.0).blend(0.01)));
    for (const q of jw.prims) q.scale(hk);
  }
  // ---- arms in wide sleeves, gold bangles, taloned hands; the staff in the right, a rune-orb over the left
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', X = sideX(sx);
    const Sp = X([0.22, 1.02, 0.02]), El = X([0.27, 0.77, 0.0]), Wr = X([0.28, 0.54, 0.07]);
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms', detail: 0.7 });
    up.prims.push(cloth(S.capsule(Sp, El, 0.072, 0.066)), cloth(S.sphere(0.09).at(...Sp).blend(0.03), robeD));
    up.prims.push(S.torus(0.072, 0.013).rot(0, 0, sx * 10).at(...lerp3(Sp, El, 0.55)).color(gold).pbr(0.32, 0.9).blend(0.004));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms', detail: 0.8 });
    fo.prims.push(cloth(S.capsule(El, lerp3(El, Wr, 0.72), 0.068, 0.095)));
    fo.prims.push(S.cone(0.1, 0.07, 0.03, 0.005).rot(10, 0, 0).at(...lerp3(El, Wr, 0.72)).color(gold).pbr(0.35, 0.85).paint(0.004, 0.003));
    fo.prims.push(skn(teal)(S.capsule(lerp3(El, Wr, 0.62), Wr, 0.032, 0.03).blend(0.004)));
    for (let b = 0; b < 3; b++) fo.prims.push(S.torus(0.034, 0.008).rot(12, 0, 0).at(...lerp3(lerp3(El, Wr, 0.78), Wr, b * 0.3)).color(b === 1 ? glow : gold).pbr(0.3, b === 1 ? 0.2 : 0.95).blend(0.002));
    fo.prims.push(skn(teal)(S.ellipsoid(0.038, 0.042, 0.03).at(...add3(Wr, [0, -0.03, 0])).blend(0.01)));
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.4, b0 = add3(Wr, [Math.sin(a) * 0.026, -0.058, 0.012]);
      fo.hard.push(spike(b0, [Math.sin(a) * 0.5, -1, 0.35], 0.085, 0.011, 0x2a2420, [0, 0, 1], 0.4).lod(2));
    }
    fo.hard.push(...rune(add3(lerp3(El, Wr, 0.35), [sx * 0.064, 0, 0.0]), [sx, 0, 0.15], [0, 1, 0], 0.05, runeC, sx > 0 ? 1 : 4, 1.4));
    if (sx > 0) {
      const oc = add3(Wr, [0.0, 0.02, 0.13]), orb = N('orb', `fore${nm}`, oc, { rig: 'orb' });
      orb.hard.push(H.sphere(0.04, 14).at(...oc).color(mix(glow, 0xffffff, 0.3)).glow(1.9));
      orb.hard.push(H.torus(0.065, 0.005, 20, 4).rot(70, 0, 20).at(...oc).color(glow).glow(1.6), H.torus(0.075, 0.004, 20, 4).rot(20, 40, 0).at(...oc).color(gold).glow(0.8).pbr(0.3, 0.9).lod(1));
    } else {
      const g = add3(Wr, [0, -0.04, 0.03]), st = N('staff', `fore${nm}`, g, { rig: 'staff', detail: 1.0 });
      st.hard.push(H.cyl(0.017, 0.021, 1.44, 8).at(g[0], 0.74, g[2]).color(0x1e1a40).pbr(0.5));
      for (const y of [0.25, 0.75, 1.2, 1.4]) st.hard.push(H.torus(0.024, 0.008, 10, 5).rot(90, 0, 0).at(g[0], y, g[2]).color(gold).pbr(0.32, 0.95).lod(2));
      st.hard.push(H.lathe([[0.001, 1.42], [0.03, 1.44], [0.05, 1.5], [0.03, 1.52], [0.001, 1.52]], 10).at(g[0], 0, g[2]).color(gold).pbr(0.3, 0.95));
      // a crown of golden prongs cradling the crystal
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * 6.283 + 0.4, d = [Math.sin(a), 0, Math.cos(a)];
        st.hard.push(H.tube([[g[0] + d[0] * 0.03, 1.5, g[2] + d[2] * 0.03], [g[0] + d[0] * 0.085, 1.58, g[2] + d[2] * 0.085], [g[0] + d[0] * 0.07, 1.68, g[2] + d[2] * 0.07], [g[0] + d[0] * 0.035, 1.71, g[2] + d[2] * 0.035]], [0.011, 0.009, 0.007, 0.003], 10, 5).color(gold).pbr(0.3, 0.95));
      }
      st.hard.push(shard([g[0], 1.47, g[2]], [0, 1, 0], 0.32, 0.06, mix(glow, 0xffffff, 0.15), tone(base, 0, 0.1, 0.25), 2, { glow: 1.1, rough: 0.1 }));
      for (let i = 0; i < 3; i++) { const a = i * 2.09 + 0.3; st.hard.push(shard([g[0] + Math.sin(a) * 0.15, 1.6 + i * 0.04, g[2] + Math.cos(a) * 0.15], [Math.sin(a) * 0.3, 1, Math.cos(a) * 0.3], 0.07, 0.016, glow, base, i, { glow: 1.0 }).lod(1)); }
    }
  }
  // ---- great iridescent wings
  const G = { Sh: [0.11, 1.05, -0.11], E: [0.4, 1.3, -0.2], W: [0.66, 1.25, -0.12], T: [1.04, 1.12, -0.2] };
  const WC = { bone: base, a: base, b: violet, tip: gold, covert: teal, shape: 0, band: true };
  addWings(N, 'torso', G, () => {
    const w = featherWing(G, WC, { len: 0.5, n: [8, 8], r: 0.048 });
    w.pri.ends.forEach((e, i) => { if (i % 2 === 0) w.tip.hard.push(H.sphere(0.024, 8).scale(1, 0.25, 1.5).at(e[0] * 0.97, e[1] + 0.012, e[2] + 0.06).color(glow).glow(1.3).lod(1)); });
    w.sec.ends.forEach((e, i) => { if (i % 3 === 1) w.arm.hard.push(H.sphere(0.022, 8).scale(1, 0.25, 1.5).at(e[0], e[1] + 0.012, e[2] + 0.06).color(glow).glow(1.3).lod(1)); });
    return w;
  }, 0.7);
  return { kind: 'chaos2.fate', attack: 'cast', nHeads: nH, nodes: finish(N.nodes) };
}

function fateAnim(rig, inner, c, base) {
  const { R, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk, fly = !!c.flying;
  const L = rig.legs || [], Sh = rig.shins || [], A = rig.arms || [], F = rig.forearms || [];
  const idle = Math.sin(t * 1.3 + ph), idle2 = Math.sin(t * 0.7 + ph * 1.7);
  const k = c.moving && !fly ? 1 : 0, gait = t * 5 + ph;
  const cast = a >= 0 ? keys(a, [[0, 0], [0.4, 1], [0.62, 0.8], [1, 0]]) : 0, snap = a >= 0 ? keys(a, [[0, 0], [0.4, 0], [0.55, 1], [1, 0]]) : 0;
  for (let i = 0; i < 2; i++) {
    const sg = i ? -1 : 1;
    if (fly) { R(L[i], 0.5 + Math.sin(t * 2 + i) * 0.05); R(Sh[i], 0.5); } else { R(L[i], -Math.sin(gait) * sg * 0.4 * k); R(Sh[i], k * Math.max(0, Math.cos(gait) * sg) * 0.6); }
  }
  R(rig.torso, 0.05 * k + idle * 0.012 - 0.12 * cast + 0.16 * snap, Math.sin(gait) * 0.05 * k, 0);
  // each head keeps its own counsel: they turn, peer and nod out of step, and all cry out on the cast
  const n = rig.nHeads || 1, HD = rig.hds || [], JW = rig.jws || [];
  for (let i = 0; i < n; i++) {
    const q = ph + i * 2.3, ia = Math.sin(t * 1.1 + q), ib = Math.sin(t * 0.6 + q * 1.3), f = n === 1 ? 0 : (i - (n - 1) / 2) / ((n - 1) / 2);
    (rig[`nk${i}`] || []).forEach((seg, j) => R(seg, ia * 0.04 - 0.14 * cast + 0.18 * snap, ib * 0.12 + f * 0.1 * cast, f * 0.04 * ia));
    R(HD[i], ia * 0.06 + 0.1 * cast - 0.1 * snap, ib * 0.3 * (1 - cast), 0);
    R(JW[i], 0.04 + 0.5 * cast + 0.08 * Math.max(0, Math.sin(t * 2.7 + q)));
  }
  const ax = -0.35 - 0.12 * idle - 1.5 * cast, fx = -0.5 - 0.4 * cast + 0.3 * snap;
  R(A[0], ax, 0, 0.12 + 0.3 * cast); R(F[0], fx);
  const rx = -0.28 + Math.sin(gait) * 0.12 * k - 0.75 * cast - 0.5 * snap, rfx = -0.3 - 0.35 * cast;
  R(A[1], rx, 0, -0.1 - 0.15 * cast); R(F[1], rfx);
  const tx = rig.torso ? rig.torso.rotation.x - (rig.torso.userData.rest?.[0] ?? 0) : 0;
  (rig.staff || []).forEach((st) => R(st, -(rx + rfx + tx) + 0.5 * snap, 0, 0.1 + 0.15 * cast));
  (rig.orb || []).forEach((ob) => { R(ob, t * 0.9, t * 1.7, 0); ob.scale.setScalar(1 + 0.5 * cast + Math.sin(t * 4 + ph) * 0.06); });
  wingsPose(rig, c, base, s * 1.6, { rate: 7.5, amp: 0.52, fold: [0.55, 0.3, 1.25, -0.3, 0.0], open: Math.max(cast, k * 0.15) });
  const dead = base.die(inner, c);
  if (dead) { const f = Math.min(1, c.dead * 2); inner.position.y += f * 0.12 * s; (rig.wings || []).forEach((w, i) => { const sg = sgn(w, i); R(w, 0, sg * 0.2, sg * -0.1 * f); }); R(A[0], -0.4, 0, 0.6 * f); R(A[1], -0.4, 0, -0.6 * f); (rig.staff || []).forEach((st) => R(st, 0.3 * f, 0, -0.5 * f)); return; }
  inner.position.y = fly ? Math.sin(t * 7.5 / Math.sqrt(s * 1.6) + ph) * 0.03 * s : k * Math.abs(Math.sin(gait)) * 0.02 * s;
  inner.rotation.x = fly ? 0.16 : 0;
}

// =====================================================================================
//  THE SKY-MANTA: a ray that glides through the air, ridden or not
// =====================================================================================
// rig: body, wings[2] / wingmid[2] / wingtips[2] (three sections of each wing-fin), mtail[], rider + r_* (a seated humanoid)

/** the left wing-fin's surface: u 0 (root) .. 1 (tip), v 0 (leading edge) .. 1 (trailing edge), side +1 top / -1 underneath */
const MANTA = {
  x: (u) => 0.14 + 0.86 * u,
  zl: (u) => 0.27 - 0.52 * Math.pow(u, 1.3),
  zt: (u) => -0.25 + 0.13 * Math.sin(Math.PI * Math.pow(u, 0.85)) - 0.05 * u,
  y: (u) => 0.32 + 0.03 * u - 0.07 * u * u,
  th: (u) => 0.07 * Math.pow(1 - u, 0.9) + 0.003,
};
function mantaPt(u, v, side) {
  const z = lerp(MANTA.zl(u), MANTA.zt(u), v), th = MANTA.th(u) * Math.pow(Math.sin(Math.PI * clamp(v)), 0.6) * (1 - 0.35 * v);
  return [MANTA.x(u), MANTA.y(u) + (side > 0 ? th * 0.62 : -th * 0.38), z];
}
function mantaFin(u0, u1, C) {
  const nu = 9, nv = 9, pos = [], cols = [], idx = [];
  const top = rgb(C.top), topL = rgb(C.topL), bel = rgb(C.belly), edge = rgb(C.edge);
  for (const side of [1, -1]) {
    const o0 = pos.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = lerp(u0, u1, i / nu), v = j / nv, p = mantaPt(u, v, side);
      pos.push(...p);
      let c3;
      if (side > 0) {
        const n = noise3(u * 5.3, v * 4.1, 1.7), chev = Math.sin((v * 1.4 - u * 0.9) * 9);
        c3 = mixRgb(top, topL, clamp((n - 0.45) * 2.2) * 0.55 + (chev > 0.8 ? 0.3 : 0));
        c3 = mixRgb(c3, edge, clamp((Math.max(1 - v * 5, v * 5 - 4, u * 6 - 5)) * 0.8) * 0.6);
      } else {
        c3 = mixRgb(bel, top, clamp(Math.max(u * 5 - 3.6, Math.abs(v - 0.5) * 6 - 2.4)));
      }
      cols.push(c3);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = o0 + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      if (side > 0) idx.push(a, d, b, a, c, d); else idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return H.geo(g).shade((x, y, z, nx, ny, nz, i) => cols[i] ?? null).color(C.top).pbr(0.32, 0.08);
}

function skyManta(def, o = {}) {
  const top = col(o.color, 0x2a4ac8), belly = col(o.belly, 0xd8b03a), glow = col(o.glow, mix(belly, 0x8af0ff, 0.6));
  const ridden = !!(o.rider && typeof o.rider === 'object');
  const C = { top, topL: tone(top, 0.02, 0.0, 0.16), belly, edge: tone(top, -0.03, 0.05, -0.1), glow };
  const sk = (q) => q.color(top).tint(0.1, 12).bump(0.003, 30, 'noise').pbr(0.32, 0.08);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const BO = [0, 0.32, 0];
  const body = N('body', 'root', BO, { rig: 'body', detail: 0.95 });
  {
    const p = body.prims;
    p.push(sk(S.ellipsoid(0.2, 0.075, 0.36).at(0, 0.32, 0.0)));
    p.push(sk(S.ellipsoid(0.13, 0.055, 0.22).at(0, 0.355, -0.03).blend(0.05)));
    p.push(sk(S.ellipsoid(0.17, 0.055, 0.1).at(0, 0.315, 0.3).blend(0.05)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.09, 0.05, 0.2).at(0.16, 0.325, 0.02).blend(0.05))]));
    p.push(S.ellipsoid(0.19, 0.03, 0.34).at(0, 0.265, 0.02).color(belly).pbr(0.4).paint(0.025));
    p.push(S.box(0.2, 0.024, 0.08, 0.008).at(0, 0.3, 0.4).color(0x140c1a).cut(0.01));                          // the wide mouth
    for (const sx of [1, -1]) for (let i = 0; i < 5; i++) p.push(S.box(0.035, 0.012, 0.006, 0.002).rot(0, sx * 20, 0).at(sx * 0.08, 0.262, 0.16 - i * 0.03).color(tone(belly, 0, 0, -0.2)).cut(0.003));   // gill slits
    p.push(S.ellipsoid(0.08, 0.03, 0.16).at(0, 0.385, -0.04).color(C.topL).paint(0.03));
    p.push(...S.mirrorX([S.ellipsoid(0.07, 0.04, 0.14).rot(0, -35, 0).at(0.12, 0.36, 0.13).color(mix(top, belly, 0.55)).paint(0.03)]));
    // the rolled horn-fins either side of the mouth
    for (const sx of [1, -1]) {
      p.push(sk(S.capsule([0.12 * sx, 0.31, 0.34], [0.145 * sx, 0.3, 0.46], 0.03, 0.024)).blend(0.02), sk(S.capsule([0.145 * sx, 0.3, 0.46], [0.11 * sx, 0.275, 0.53], 0.024, 0.014)).blend(0.01));
      p.push(S.capsule([0.12 * sx, 0.29, 0.36], [0.135 * sx, 0.28, 0.48], 0.018, 0.012).color(belly).paint(0.008));
      body.hard.push(eyeAt([0.168 * sx, 0.325, 0.29], [sx, 0.1, 0.25], 0.02, { iris: glow, rim: tone(glow, 0, 0, -0.3), slit: false, white: 0x0a0a14, glow: 0.6 }));
    }
    // a little fin on the back, and the root of the tail
    p.push(sk(S.ellipsoid(0.012, 0.045, 0.05).rot(-30, 0, 0).at(0, 0.4, -0.28).blend(0.02)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.07, 0.015, 0.06).rot(0, 25, 0).at(0.08, 0.3, -0.34).blend(0.02))]));
    // glowing spots down the back
    for (let i = 0; i < 6; i++) for (const sx of [1, -1]) body.hard.push(H.sphere(0.011, 6).scale(1, 0.4, 1).at(sx * (0.05 + i * 0.008), 0.393 - i * 0.006, 0.12 - i * 0.07).color(glow).glow(1.6).lod(1));
  }
  // the wing-fins: three sections a side so a ripple can run out along them
  const cuts = [[0, 0.4, 'wings'], [0.38, 0.72, 'wingmid'], [0.7, 1, 'wingtips']];
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R';
    let par = 'body';
    cuts.forEach(([u0, u1, key], ci) => {
      const pv = [sx * MANTA.x(u0 + (ci ? 0.01 : 0)), MANTA.y(u0), 0];
      const n = N(`${key}${nm}`, par, ci ? pv : [sx * MANTA.x(0.0), MANTA.y(0), 0], { rig: key, detail: 1 });
      const fin = mantaFin(u0, u1, C);
      const spots = [];
      for (let q = 0; q < 4; q++) {
        const u = lerp(u0, u1, (q + 0.5) / 4);
        spots.push(H.sphere(0.012 + 0.006 * (1 - u), 6).scale(1, 0.35, 1).at(...add3(mantaPt(u, 0.1, 1), [0, 0.004, 0])).color(glow).glow(1.6).lod(1));
        if (q % 2 === 0) spots.push(H.sphere(0.01 + 0.005 * (1 - u), 6).scale(1, 0.35, 1).at(...add3(mantaPt(u, 0.86, 1), [0, 0.004, 0])).color(glow).glow(1.6).lod(1));
      }
      if (ci === 2) spots.push(H.sphere(0.012, 6).scale(1, 0.35, 1).at(...add3(mantaPt(0.97, 0.45, 1), [0, 0.003, 0])).color(glow).glow(1.8).lod(1));
      const list = [fin, ...spots];
      n.hard = sx > 0 ? list : list.map((q) => q.mirrorX());
      par = n.name;
    });
  }
  // the long whip of a tail
  const TP = [[0, 0.31, -0.34], [0, 0.3, -0.58], [0, 0.28, -0.82], [0, 0.25, -1.06], [0, 0.22, -1.28], [0, 0.2, -1.48]];
  const TR = [0.032, 0.022, 0.016, 0.011, 0.007, 0.002];
  for (let i = 0; i < TP.length - 1; i++) {
    const n = N(`tail${i}`, i ? `tail${i - 1}` : 'body', TP[i], { rig: 'mtail' });
    n.hard.push(H.tube([TP[i], lerp3(TP[i], TP[i + 1], 0.5), add3(TP[i + 1], mul3(norm3(sub3(TP[i + 1], TP[i])), 0.01))], [TR[i], (TR[i] + TR[i + 1]) / 2, TR[i + 1]], 6, 6).color(i ? C.edge : top).pbr(0.35));
    if (i < 3) n.hard.push(H.torus(TR[i] * 1.05, 0.003, 10, 3).at(...lerp3(TP[i], TP[i + 1], 0.6)).color(glow).glow(1.5).lod(1));
    if (i === 0) n.hard.push(spike([0, 0.335, -0.42], [0, 0.25, -1], 0.08, 0.01, tone(belly, 0, 0, -0.25), [0, 1, 0], -0.2).lod(1));
  }
  // the rider sits astride the middle of its back
  const extra = {};
  if (ridden) {
    const ro = o.rider, f = clamp(1.05 / num(o.scale, 1.6), 0.45, 1);
    const rdesc = { ...ro, body: 'humanoid', pose: 'riding', alt: undefined, scale: undefined };
    const P = proportions(rdesc);
    const desc = humanoid({ ...(def || {}), id: `${(def && def.id) || 'manta'}:rider` }, rdesc);
    // kneeling astride the flat back: thighs down and forward, shins folded back along the body
    for (const n of desc.nodes) {
      if (n.name === 'legL' || n.name === 'legR') n.rot = [-32, 0, n.name === 'legL' ? 26 : -26];
      else if (n.name === 'shinL' || n.name === 'shinR') n.rot = [116, 0, n.name === 'shinL' ? -4 : 4];
    }
    const seatY = 0.39 + (P.thigh * Math.cos(32 * DEG) * Math.cos(26 * DEG) + P.rCalf) * f;
    seatHumanoid(N.nodes, desc, 'body', [0, seatY - P.hipY * f - BO[1], 0.04 - BO[2]], f);
    for (const [kk, v] of Object.entries(desc)) if (kk !== 'nodes' && kk !== 'kind' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) extra[kk] = v;
    // a saddle-pad with a pearl-shell pommel
    body.hard.push(H.cyl(0.12, 0.13, 0.02, 14).scale(1, 1, 1.25).at(0, 0.39, 0.01).color(tone(belly, 0, -0.1, -0.15)).pbr(0.7));
    body.hard.push(H.sphere(0.03, 10).scale(1.3, 0.8, 1).at(0, 0.405, 0.17).color(0xf0ece4).pbr(0.15, 0.4).lod(1));
    extra.seated = true;
  }
  return { ...extra, kind: 'chaos2.manta', attack: ridden ? extra.attack || 'thrust' : 'slam', nodes: finishRaw(N.nodes) };
}

const _cu = {};
function mantaAnim(rig, inner, c, base) {
  const { R, P, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 1.4) : 0, e = smooth(df);
  const k = c.moving ? 1 : 0, rate = k ? 3.4 : 1.7, amp = dead ? 0 : k ? 0.34 : 0.17, beat = t * rate + ph;
  const W = rig.wings || [], M = rig.wingmid || [], T = rig.wingtips || [];
  W.forEach((w, i) => {
    const sg = i ? -1 : 1;
    R(w, Math.sin(beat - 0.4) * 0.03 * (1 - e), 0, sg * (Math.sin(beat) * amp * 0.45 - 0.12 * e));
    R(M[i], Math.sin(beat - 1.0) * 0.05 * (1 - e), 0, sg * (Math.sin(beat - 0.75) * amp * 0.85 - 0.3 * e));
    R(T[i], Math.sin(beat - 1.6) * 0.07 * (1 - e), 0, sg * (Math.sin(beat - 1.5) * amp * 1.2 - 0.4 * e));
  });
  let whip = 0, rear = 0, lunge = 0;
  if (a >= 0 && !rig.seated) { rear = keys(a, [[0, 0], [0.35, 1], [0.55, 0], [1, 0]]); whip = keys(a, [[0, 0], [0.3, -0.4], [0.5, 1], [0.7, 0.5], [1, 0]]); lunge = keys(a, [[0, 0], [0.35, -0.3], [0.52, 1], [1, 0]]); }
  R(rig.body, Math.cos(beat) * 0.03 * (1 - e) - 0.25 * rear + 0.12 * lunge, 0, 0);
  (rig.mtail || []).forEach((x, i) => R(x, Math.sin(t * 2.1 + ph - i * 0.8) * 0.05 - 0.35 * whip * (i < 2 ? 1 : 0.6) + 0.12 * e, Math.sin(t * (k ? 3 : 1.4) + ph - i * 0.9) * (0.1 + 0.04 * i) * (1 - e), 0));
  if (rig.seated && rig.arms) {
    _cu.t = t; _cu.phase = ph; _cu.dead = c.dead; _cu.flying = false; _cu.moving = false; _cu.atk = dead ? -1 : a;
    base.upperBody(rig, _cu);
    poseCarried(rig, _cu, base, rig.hold || 'none', false);
    if (rig.torso && !dead) rig.torso.rotation.x += k ? 0.12 : 0.03;
    if (dead && rig.rider && rig.rider[0]) { const rd = rig.rider[0], r = rd.userData.rest; rd.rotation.set(r[0] - 0.4 * e, r[1], r[2] + 1.2 * e); rd.position.set(r[3] + 0.12 * e, r[4] - 0.05 * e, r[5]); }
  }
  inner.rotation.set(0, 0, 0); inner.position.set(0, 0, 0);
  if (dead) {
    // the glide fails: it slews over, falls and lies flat
    inner.rotation.z = 0.45 * e - Math.max(0, c.dead - 0.7) * 0.6;
    inner.rotation.x = 0.15 * e;
    inner.position.y = (-0.22 * e - Math.max(0, c.dead - 0.8) * 0.35) * s;
    return;
  }
  inner.position.y = (0.03 + Math.sin(beat - 0.9) * 0.028) * s;
  inner.position.z = 0.1 * lunge * s;
  inner.rotation.z = Math.sin(t * 0.6 + ph) * 0.05;
  inner.rotation.x = k ? 0.05 : 0;
}

// =====================================================================================
//  THE SHARD-HORROR: a capering knot of crystal shards with a grin of light
// =====================================================================================
// rig: torso, head, arms[4] / forearms[4] (upper pair then lower pair, left first), legs[2], shins[2], motes[]

function shardHorror(def, o = {}) {
  const cA = col(o.color, 0xe85ac8), cB = col(o.glow, 0x6ad8ff), cM = mix(cA, cB, 0.5), light = mix(cB, 0xffffff, 0.55);
  const rnd = rng(hashStr((def?.id || 'shard') + ':shard'));
  let seed = 0;
  const X = (b, d, len, r, a = cA, b2 = cB, opt) => shard(b, d, len, r, a, b2, seed++, opt);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const CORE = [0, 0.64, 0];
  const torso = N('torso', 'root', [0, 0.46, 0], { rig: 'torso' });
  {
    const h = torso.hard;
    h.push(H.sphere(0.085, 14).at(...CORE).color(light).glow(1.7).pbr(0.2));
    h.push(H.sphere(0.11, 10).at(...CORE).color(cB).glow(0.9).pbr(0.2).far());
    // the chest: shards burst out of the light
    for (let i = 0; i < 13; i++) {
      const az = i * 2.39996 + 0.3, el = lerp(-0.55, 0.95, ((i * 0.618) % 1));
      const d = [Math.sin(az) * Math.cos(el), Math.sin(el) * 0.8 + 0.2, Math.cos(az) * Math.cos(el) * 0.75];
      const len = 0.17 + rnd() * 0.12, r = 0.042 + rnd() * 0.026;
      h.push(X(add3(CORE, mul3(norm3(d), 0.035)), d, len, r, i % 3 ? cA : cM, cB));
    }
    for (const sx of [1, -1]) {
      h.push(X([sx * 0.11, 0.7, -0.02], [sx * 0.55, 1, -0.3], 0.3, 0.055, cA, cB));                       // great spikes over the shoulders
      h.push(X([sx * 0.06, 0.72, -0.07], [sx * 0.25, 1, -0.7], 0.24, 0.04, cM, cA).lod(2));
    }
    h.push(X([0, 0.7, -0.08], [0, 0.8, -1], 0.26, 0.05, cB, cA));                                          // the spine
    // the waist: a thin twist of crystal between chest and hips, then the hips
    h.push(X([0, 0.46, 0.0], [0.05, 1, 0.02], 0.17, 0.035, cM, cB));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283 + 0.5; h.push(X([0, 0.49, 0], [Math.sin(a), -0.9, Math.cos(a) * 0.7], 0.13 + (i % 2) * 0.04, 0.035, i % 2 ? cA : cB, cM)); }
    for (let i = 0; i < 6; i++) { const a = i * 1.1; h.push(H.sphere(0.012, 6).at(Math.sin(a) * 0.04, 0.53 + i * 0.012, Math.cos(a) * 0.04).color(light).glow(1.8).lod(1)); }
  }
  // the head: a great faceted gem split by a grin of light
  const HC = [0, 0.95, 0.05], ha = 0.15, hb = 0.13, hc = 0.13;
  const head = N('head', 'torso', [0, 0.84, 0.02], { rig: 'head', detail: 1.2 });
  {
    const h = head.hard;
    const gem = H.geo(cached('octaNI', () => { const g = new THREE.OctahedronGeometry(1, 0); if (g.index) { const g2 = g.toNonIndexed(); g.dispose(); return (g2.deleteAttribute('uv'), g2.computeVertexNormals(), g2); } g.deleteAttribute('uv'); g.computeVertexNormals(); return g; }))
      .shade((x, y, z, nx, ny, nz) => mixRgb(rgb(cA), rgb(cB), smooth(0.5 + 0.5 * Math.sin(nx * 2.2 + ny * 3.1 - nz * 1.4)))).color(cA).pbr(0.12, 0.2).glow(0.3);
    h.push(gem.scale(ha, hb, hc).at(...HC));
    // the grin: an upturned crack that wraps round the faces, lit from within
    const onFace = (x, dy, out = 0.006) => { const z = hc * Math.max(0, 1 - Math.abs(x) / ha - Math.abs(dy) / hb); return [x, HC[1] + dy, HC[2] + z + out]; };
    const up = [], lo = [];
    for (let i = 0; i <= 12; i++) {
      const f = (i / 12) * 2 - 1, x = f * 0.1, cy = -0.03 + 0.045 * f * f;
      up.push(onFace(x, cy + (i % 2 ? 0.012 : -0.004)));
      lo.push(onFace(x * 0.92, cy - 0.028 * (1 - f * f) - 0.004));
    }
    h.push(H.tube(up, 0.0075, 36, 5).color(light).glow(2));
    h.push(H.tube(lo, 0.007, 30, 5).color(light).glow(2));
    h.push(membrane(pathFn(up), pathFn(lo), { nu: 12, nv: 2, scallop: 0, billow: 0, col: () => rgb(mix(cB, 0xffffff, 0.35)) }).glow(1.6).pbr(0.3));
    // eyes: two slanted slits of light, one larger than the other, and a third in the brow
    h.push(H.sphere(0.02, 8).scale(1.8, 0.55, 0.5).rot(0, 30, -22).at(...onFace(0.055, 0.04, 0.004)).color(light).glow(2.2));
    h.push(H.sphere(0.016, 8).scale(1.6, 0.55, 0.5).rot(0, -30, 18).at(...onFace(-0.05, 0.035, 0.004)).color(light).glow(2.2));
    h.push(H.sphere(0.01, 6).at(...onFace(0.0, 0.085, 0.004)).color(light).glow(2).lod(1));
    // a crown of shards
    for (let i = 0; i < 6; i++) {
      const a = (i - 2.5) * 0.42;
      h.push(X([Math.sin(a) * 0.07, HC[1] + 0.06, HC[2] - 0.03 - Math.abs(Math.sin(a)) * 0.02], [Math.sin(a) * 0.8, 1, -0.55], 0.16 - Math.abs(i - 2.5) * 0.018, 0.03, i % 2 ? cB : cA, cM).lod(i % 2 ? 2 : 3));
    }
    for (const sx of [1, -1]) h.push(X([sx * 0.12, HC[1] + 0.0, HC[2] - 0.01], [sx, 0.35, -0.3], 0.12, 0.03, cB, cA));       // cheek spurs
  }
  // four arms of loosely bound shards: the upper pair flung up in glee, the lower pair grasping forward
  const ARMS = [
    [[0.17, 0.75, 0.0], [0.33, 0.88, 0.06], [0.42, 1.06, 0.12]],
    [[0.15, 0.6, 0.04], [0.3, 0.5, 0.14], [0.36, 0.43, 0.32]],
  ];
  for (const pair of [0, 1]) for (const sx of [1, -1]) {
    const nm = `${pair}${sx > 0 ? 'L' : 'R'}`, [Sp, El, Hd] = ARMS[pair].map(sideX(sx)), k = pair ? 0.85 : 1;
    const up = N(`arm${nm}`, 'torso', Sp, { rig: 'arms' });
    up.hard.push(H.sphere(0.02 * k, 6).at(...Sp).color(light).glow(1.8));
    up.hard.push(X(lerp3(Sp, El, 0.08), sub3(El, Sp), len3(sub3(El, Sp)) * 0.84, 0.036 * k, cA, cB));
    up.hard.push(X(lerp3(Sp, El, 0.3), add3(sub3(El, Sp), [0, 0.12, -0.08]), len3(sub3(El, Sp)) * 0.45, 0.022 * k, cB, cM).lod(2));
    const fo = N(`fore${nm}`, `arm${nm}`, El, { rig: 'forearms' });
    fo.hard.push(H.sphere(0.018 * k, 6).at(...El).color(light).glow(1.8));
    fo.hard.push(X(lerp3(El, Hd, 0.1), sub3(Hd, El), len3(sub3(Hd, El)) * 0.8, 0.03 * k, cM, cA));
    const d = norm3(sub3(Hd, El)), side = norm3(cross3(d, [0, 0, 1])), dn = norm3(cross3(side, d));
    fo.hard.push(H.sphere(0.014 * k, 6).at(...Hd).color(light).glow(1.8).lod(1));
    for (let i = 0; i < 3; i++) {
      const sp = (i - 1) * 0.55, cd = add3(add3(d, mul3(side, sp)), mul3(dn, 0.25));
      fo.hard.push(X(add3(Hd, mul3(d, 0.01)), cd, 0.11 * k, 0.015 * k, i === 1 ? cB : cA, cM, { glow: 0.45 }));
    }
    fo.hard.push(X(Hd, add3(mul3(d, 0.3), mul3(dn, 1)), 0.07 * k, 0.013 * k, cB, cA, { glow: 0.45 }).lod(2));
  }
  // bandy legs, capering
  for (const sx of [1, -1]) {
    const nm = sx > 0 ? 'L' : 'R', Q = sideX(sx);
    const Hp = Q([0.08, 0.46, 0]), Kn = Q([0.2, 0.27, 0.08]), An = Q([0.15, 0.06, 0.02]);
    const lg = N(`leg${nm}`, 'torso', Hp, { rig: 'legs' });
    lg.hard.push(H.sphere(0.02, 6).at(...Hp).color(light).glow(1.8));
    lg.hard.push(X(lerp3(Hp, Kn, 0.08), sub3(Kn, Hp), len3(sub3(Kn, Hp)) * 0.86, 0.045, cA, cB));
    const sh = N(`shin${nm}`, `leg${nm}`, Kn, { rig: 'shins' });
    sh.hard.push(H.sphere(0.02, 6).at(...Kn).color(light).glow(1.8));
    sh.hard.push(X(lerp3(Kn, An, 0.08), sub3(An, Kn), len3(sub3(An, Kn)) * 0.86, 0.038, cM, cA));
    sh.hard.push(X(lerp3(Kn, An, 0.15), add3(sub3(An, Kn), [sx * 0.08, 0.1, -0.12]), 0.1, 0.022, cB, cA).lod(2));
    sh.hard.push(X(add3(An, [0, -0.01, 0]), [sx * 0.35, -0.25, 1], 0.15, 0.032, cA, cB));
    sh.hard.push(X(add3(An, [0, -0.01, 0]), [-sx * 0.2, -0.3, 1], 0.12, 0.028, cB, cM));
    sh.hard.push(X(add3(An, [0, 0.0, 0]), [0, -0.6, -1], 0.07, 0.024, cM, cA).lod(1));
  }
  // loose shards that orbit the body, never quite part of it
  for (let m = 0; m < 3; m++) {
    const mo = N(`mote${m}`, 'torso', [0, 0.46, 0], { rig: 'motes' });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.09 + m * 0.7, r = 0.28 + m * 0.05, y = 0.5 + m * 0.18 + Math.sin(a * 2) * 0.04;
      const p = [Math.sin(a) * r, y, Math.cos(a) * r];
      mo.hard.push(X(p, [Math.cos(a), 0.6 + 0.3 * Math.sin(a + m), -Math.sin(a)], 0.06 + 0.02 * ((i + m) % 2), 0.016, (i + m) % 2 ? cA : cB, cM, { glow: 0.6 }).lod(m === 2 ? 1 : 3));
    }
  }
  return { kind: 'chaos2.shard', attack: 'claw', nodes: finish(N.nodes) };
}

function shardAnim(rig, inner, c, base) {
  const { R, P, keys } = base, s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, a = c.atk;
  const k = c.moving ? 1 : 0, dead = c.dead > 0, df = dead ? Math.min(1, c.dead * 1.8) : 0, e = smooth(df);
  const g = t * (k ? 9 : 3.2) + ph, hop = Math.abs(Math.sin(g * 0.5));
  const A = rig.arms || [], F = rig.forearms || [], L = rig.legs || [], Sh = rig.shins || [], MO = rig.motes || [];
  let strike = 0, wind = 0;
  if (a >= 0) { wind = keys(a, [[0, 0], [0.3, 1], [0.48, 0], [1, 0]]); strike = keys(a, [[0, 0], [0.3, 0], [0.5, 1], [0.7, 0.7], [1, 0]]); }
  inner.rotation.set(0, 0, 0); inner.position.set(0, 0, 0);
  // it capers: hops from foot to foot, rocking and twisting, arms flailing out of step
  R(rig.torso, 0.1 * k - 0.25 * wind + 0.4 * strike + Math.sin(t * 2.1 + ph) * 0.04, Math.sin(g * 0.5) * 0.22 * (k ? 1 : 0.4) - 0.3 * wind + 0.2 * strike, Math.sin(g * 0.5 + 1) * 0.12);
  R(rig.head, Math.sin(t * 3.1 + ph) * 0.08 - 0.2 * strike, Math.sin(t * 1.3 + ph) * 0.35, Math.sin(t * 2.3 + ph * 1.7) * 0.25);
  A.forEach((x, i) => {
    const lower = i >= 2, sg = i % 2 ? -1 : 1, q = t * (lower ? 3.7 : 2.9) + ph + i * 1.37;
    R(x, Math.sin(q) * 0.35 - (lower ? 1.1 : 0.4) * wind * -1 - (lower ? 1.3 : 1.6) * strike, sg * Math.sin(q * 0.7) * 0.25, sg * (Math.cos(q) * 0.22 + 0.2 * strike));
    R(F[i], Math.sin(q + 1.2) * 0.4 - 0.6 * strike, 0, sg * Math.sin(q + 0.5) * 0.2);
  });
  L.forEach((x, i) => {
    const sg = i ? -1 : 1, sw = Math.sin(g * 0.5 + (i ? Math.PI : 0));
    R(x, -sw * 0.45 * (k ? 1 : 0.3), 0, sg * 0.1 * Math.max(0, sw));
    R(Sh[i], Math.max(0, sw) * (k ? 0.9 : 0.35));
  });
  MO.forEach((x, i) => { const r = x.userData.rest; x.rotation.set(r[0] + Math.sin(t + i) * 0.15, r[1] + t * (1.3 + i * 0.45) * (i % 2 ? -1 : 1), r[2]); x.scale.setScalar(dead ? Math.max(0.01, 1 - e) : 1); });
  if (dead) {
    // it breaks apart: the pieces burst outward and rain down
    const parts = [rig.head, ...A, ...L];
    parts.forEach((x, i) => {
      if (!x) return;
      const r = x.userData.rest, d = norm3([r[3] || 0.001, 0.3, r[5] + 0.05]), up = Math.sin(Math.min(1, c.dead * 1.4) * Math.PI) * 0.25;
      P(x, d[0] * 0.35 * e, up - 0.25 * e * (i === 0 ? 1.4 : 0.6), d[2] * 0.3 * e + (i === 0 ? 0.12 * e : 0));
      x.rotation.x += (i % 3 - 1) * 1.6 * e; x.rotation.z += ((i * 7) % 5 - 2) * 0.7 * e;
    });
    R(rig.torso, 0.9 * e, 0.4 * e, 0.3 * e);
    inner.position.y = (-0.32 * e - Math.max(0, c.dead - 0.8) * 0.5) * s;
    return;
  }
  inner.position.y = hop * (k ? 0.07 : 0.025) * s;
  inner.position.z = 0.12 * strike * s;
}

// =====================================================================================
//  THE WHIP-FIEND: a sleek, masked, venomous thing on slender legs
// =====================================================================================
// kind 'titan.quad' (the stock four-legged walk, tail lash): torso, neck, head, jaw, legs[4], shins[4], tail[]; fins[] are passengers

function finFan(n, bases, tips, C, opt = {}) {
  // spines from each base to its tip, webbed between with banded membrane, scalloped like a lion-fish
  const stripe = (u, v) => { const b = Math.sin(u * (opt.bands ?? 15) + v * 1.5); return b > 0.25 ? rgb(C.webA) : b > -0.35 ? rgb(C.webB) : rgb(C.webC); };
  for (let i = 0; i < bases.length; i++) {
    n.hard.push(H.tube([bases[i], lerp3(bases[i], tips[i], 0.5), tips[i]], [opt.r ?? 0.008, (opt.r ?? 0.008) * 0.6, 0.0015], 6, 4).color(C.spine).pbr(0.4).lod(opt.lod ?? 3));
    if (i < bases.length - 1) {
      const A = lineFn(bases[i], lerp3(bases[i], tips[i], 0.92)), B = lineFn(bases[i + 1], lerp3(bases[i + 1], tips[i + 1], 0.92));
      n.hard.push(membrane(A, B, { nu: 6, nv: 3, scallop: 0.22, billow: 0.008, col: stripe, rough: 0.5 }).glow(0.08).lod(opt.lod ?? 3));
    }
  }
}

function whipFiend(def, o = {}) {
  const skin = col(o.skin, 0xd8b8e0), armor = col(o.armor, 0x6a2a9a), gold = 0xd8b03a;
  const C = {
    skin, belly: mix(skin, 0xf8f0f4, 0.55), shade: tone(skin, 0.02, 0.05, -0.12), stripe: mix(skin, armor, 0.35), armor, armorD: tone(armor, 0, 0, -0.1), gold,
    mask: 0xf4eee6, claw: 0x241a2a, eye: 0xd8f040,
    webA: mix(skin, 0xffffff, 0.45), webB: tone(armor, 0, 0.1, 0.12), webC: mix(armor, 0xe0405a, 0.55), spine: tone(armor, 0, 0, -0.05),
  };
  const sk = (q) => q.color(skin).tint(0.08, 14).bump(0.002, 40, 'noise').pbr(0.36, 0.04);
  const N = rigOf();
  N('root', null, [0, 0, 0]);
  const torso = N('torso', 'root', [0, 0.58, 0], { rig: 'torso', detail: 0.8 });
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(0.12, 0.14, 0.19).at(0, 0.62, 0.2)));
    p.push(sk(S.ellipsoid(0.09, 0.105, 0.2).at(0, 0.62, -0.04).blend(0.08)));
    p.push(sk(S.ellipsoid(0.105, 0.115, 0.14).at(0, 0.63, -0.26).blend(0.08)));
    p.push(...S.mirrorX([sk(S.ellipsoid(0.055, 0.09, 0.1).at(0.085, 0.64, 0.24).blend(0.05)), sk(S.ellipsoid(0.06, 0.1, 0.12).at(0.075, 0.63, -0.28).blend(0.05))]));
    p.push(S.ellipsoid(0.08, 0.05, 0.32).at(0, 0.52, 0.0).color(C.belly).paint(0.03));
    for (let i = 0; i < 5; i++) p.push(...S.mirrorX([S.box(0.04, 0.16, 0.025, 0.01).rot(0, 0, 12).at(0.09, 0.62, 0.1 - i * 0.085).color(C.stripe).paint(0.01)]));
    // the caparison: purple silk over the back, edged and patterned in gold
    const W = 0.36, Lc = 0.52;
    const cap = H.sheet(W, Lc, 12, 10, (u, v) => {
      const a = (u - 0.5) * Math.PI * 0.95, R0 = 0.118 + 0.01 * Math.sin(v * Math.PI);
      const tgt = [Math.sin(a) * R0 * 1.12, 0.63 + Math.cos(a) * R0 * 1.18 - (Math.abs(u - 0.5) > 0.4 ? 0.01 : 0) - 0.02 * Math.abs(Math.sin(v * 7)) * Math.abs(u - 0.5) * 2, lerp(0.18, -0.32, v)];
      return [tgt[0] - (u - 0.5) * W, tgt[1] - (v - 0.5) * Lc, tgt[2]];
    });
    torso.hard.push(cap.shade((x, y, z, nx, ny, nz, i) => {
      const u = (i % 13) / 12, v = Math.floor(i / 13) / 10;
      if (u < 0.08 || u > 0.92 || v < 0.06 || v > 0.94) return rgb(gold);
      if (Math.abs(u - 0.5) < 0.035) return rgb(gold);
      const dd = Math.abs(((u - 0.5) * 4) % 1) + Math.abs(((v * 5) % 1) - 0.5);
      return dd < 0.18 ? rgb(mix(gold, armor, 0.3)) : rgb(armor);
    }).color(armor).pbr(0.5, 0.15));
    for (const sx of [1, -1]) for (let i = 0; i < 5; i++) {
      const v = 0.1 + i * 0.2, a = sx * Math.PI * 0.95 * 0.5, R0 = 0.118 + 0.01 * Math.sin(v * Math.PI);
      const pt = [Math.sin(a) * R0 * 1.12, 0.63 + Math.cos(a) * R0 * 1.18 - 0.012, lerp(0.18, -0.32, v)];
      torso.hard.push(H.cone(0.012, 0.05, 6).rot(180, 0, 0).at(pt[0], pt[1] - 0.025, pt[2]).color(gold).pbr(0.35, 0.85).lod(1));
    }
    // a gold collar where the neck rises
    torso.hard.push(orient(H.torus(0.078, 0.014, 18, 6).rot(90, 0, 0), [0, 0.7, 0.33], [0, 0.6, 0.8]).color(gold).pbr(0.3, 0.9));
    torso.hard.push(H.sphere(0.022, 10).at(0, 0.66, 0.4).color(armor).pbr(0.15, 0.3).glow(0.4));
    // lion-fish fans: a dorsal crest and a great fan behind each shoulder
    const db = [], dt = [];
    for (let i = 0; i < 7; i++) {
      const z = 0.25 - i * 0.075, h = 0.2 + 0.11 * Math.sin((i + 0.6) / 7 * Math.PI);
      const b0 = [0, 0.75 - Math.abs(z + 0.02) * 0.08, z];
      db.push(b0); dt.push(add3(b0, mul3(norm3([0, 1, -0.55]), h)));
    }
    finFan(torso, db, dt, C, { bands: 16 });
    for (const sx of [1, -1]) {
      const fb = [], ft = [];
      for (let i = 0; i < 7; i++) {
        const f = i / 6, b0 = [sx * 0.1, 0.67 - f * 0.1, 0.21 - f * 0.03], dir = norm3([sx * (0.5 + 0.25 * f), 0.6 - 1.15 * f, -0.8]);
        fb.push(b0); ft.push(add3(b0, mul3(dir, 0.42 - 0.12 * Math.abs(f - 0.3))));
      }
      const fan = N(`fin${sx > 0 ? 'L' : 'R'}`, 'torso', [sx * 0.1, 0.63, 0.19], { rig: 'fins' });
      finFan(fan, fb, ft, C, { bands: 14 });
    }
  }
  // neck and the masked head
  const NB = [0, 0.7, 0.34], NE = [0, 0.8, 0.55];
  const neck = N('neck', 'torso', NB, { rig: 'neck', detail: 0.95 });
  neck.prims.push(sk(S.capsule(NB, NE, 0.07, 0.048)), sk(S.sphere(0.075).at(...NB).blend(0.02)));
  neck.prims.push(S.capsule(add3(NB, [0, -0.05, 0.03]), add3(NE, [0, -0.04, 0.02]), 0.04, 0.03).color(C.belly).paint(0.02));
  {
    const nb = [], nt = [];
    for (let i = 0; i < 5; i++) { const b0 = lerp3(add3(NB, [0, 0.06, -0.01]), add3(NE, [0, 0.04, -0.01]), i / 4); nb.push(b0); nt.push(add3(b0, mul3(norm3([0, 1, -0.9]), 0.11 + 0.03 * Math.sin(i)))); }
    finFan(neck, nb, nt, C, { bands: 12, r: 0.006 });
  }
  const head = N('head', 'neck', NE, { rig: 'head', detail: 1.4, minRes: 60 });
  {
    const p = head.prims;
    p.push(sk(S.ellipsoid(0.062, 0.058, 0.08).at(0, 0.9, 0.51)));
    p.push(sk(S.capsule([0, 0.89, 0.56], [0, 0.875, 0.68], 0.044, 0.028).blend(0.03)));
    // the mask: porcelain over brow and muzzle, gold at the rim, a violet tear under each eye
    p.push(S.ellipsoid(0.07, 0.05, 0.1).at(0, 0.925, 0.585).color(C.mask).pbr(0.18, 0.1).paint(0.004, 0.005));
    p.push(S.capsule([0, 0.955, 0.49], [0, 0.915, 0.69], 0.012, 0.008).color(gold).pbr(0.3, 0.9).paint(0.003, 0.004));
    p.push(...S.mirrorX([
      S.ellipsoid(0.02, 0.012, 0.03).rot(0, 0, -15).at(0.04, 0.913, 0.6).color(0x14081c).cut(0.004),
      S.ellipsoid(0.007, 0.022, 0.006).at(0.046, 0.89, 0.617).color(armor).paint(0.003, 0.002),
      S.ellipsoid(0.03, 0.006, 0.08).rot(0, 12, -10).at(0.052, 0.905, 0.57).color(gold).pbr(0.3, 0.9).paint(0.003, 0.003),
    ]));
    for (const sx of [1, -1]) head.hard.push(glowEye([0.038 * sx, 0.913, 0.598], 0.011, C.eye, 1.8));
    // swept-back horns and a small crest fan between them
    for (const sx of [1, -1]) head.hard.push(...horn([[0.035 * sx, 0.95, 0.5], [0.07 * sx, 1.0, 0.42], [0.09 * sx, 1.02, 0.32], [0.085 * sx, 1.0, 0.24]], 0.018, [armor, mix(armor, gold, 0.5), gold], { rings: 12 }));
    const cb = [], ct = [];
    for (let i = 0; i < 4; i++) { const b0 = [0, 0.955, 0.52 - i * 0.03]; cb.push(b0); ct.push(add3(b0, mul3(norm3([0, 1, -0.7]), 0.1 - i * 0.012))); }
    finFan(head, cb, ct, C, { bands: 10, r: 0.005 });
  }
  const jaw = N('jaw', 'head', [0, 0.79, 0.6], { rig: 'jaw', detail: 1.3, minRes: 60 });
  jaw.prims.push(sk(S.capsule([0, 0.865, 0.54], [0, 0.858, 0.66], 0.032, 0.02)));
  jaw.prims.push(S.ellipsoid(0.026, 0.008, 0.06).at(0, 0.878, 0.61).color(0x5a1a4a).paint(0.004));
  for (const sx of [1, -1]) jaw.hard.push(spike([0.02 * sx, 0.87, 0.64], [0, 1, 0.1], 0.025, 0.005, 0xf4eee0, [0, 0, 1], 0.2).lod(1));
  // the head was laid out on a higher neck: bring it down and forward onto this one
  for (const q of [...head.prims, ...head.hard, ...jaw.prims, ...jaw.hard]) q.scale(1.12).at(0, -0.08 - 0.88 * 0.12, 0.07 - 0.48 * 0.12);
  // four slender legs, gold-banded, ending in black points (order: front-left, front-right, back-left, back-right)
  const legSk = (q) => sk(q);
  for (const [nm, sx, front] of [['FL', 1, true], ['FR', -1, true], ['BL', 1, false], ['BR', -1, false]]) {
    const pts = front ? [[0.085, 0.6, 0.24], [0.1, 0.34, 0.28], [0.095, 0.1, 0.24], [0.095, 0, 0.26]] : [[0.085, 0.62, -0.28], [0.1, 0.4, -0.19], [0.095, 0.15, -0.33], [0.095, 0, -0.3]];
    const lg = addLeg(N, nm, 'torso', sx, pts, [0.044, 0.024, 0.018], legSk, { detail: 0.9, minRes: 56, muscle: 0.95, foot: { kind: 'claw', len: 0.07, w: 0.024, toes: 2, clawLen: 0.05, claw: C.claw, spread: 0.5, col: C.shade } });
    const Ax = sideX(sx)(pts[2]);
    lg.lo.prims.push(S.torus(0.024, 0.008).at(Ax[0], Ax[1] + 0.03, Ax[2]).color(gold).pbr(0.3, 0.9).paint(0.003, 0.006));
    lg.lo.prims.push(S.capsule(lerp3(sideX(sx)(pts[1]), Ax, 0.2), lerp3(sideX(sx)(pts[1]), Ax, 0.75), 0.02, 0.016).color(C.stripe).paint(0.006));
  }
  // the whip: a long barbed lash ending in a hooked sting
  const TL = [[0, 0.64, -0.38], [0, 0.73, -0.57], [0, 0.84, -0.76], [0, 0.9, -0.96], [0, 0.88, -1.16], [0, 0.8, -1.34], [0, 0.7, -1.49], [0, 0.6, -1.62]];
  const TR = [0.066, 0.048, 0.036, 0.028, 0.021, 0.016, 0.012, 0.009];
  const tn = addChain(N, 'tail', 'torso', TL, TR, sk, { rig: 'tail', detail: 0.95, minRes: 50, deco: (n, a, b, ra, rb, i, f) => {
    n.prims.push(S.capsule(add3(a, mul3(f.dor, ra * 0.5)), add3(b, mul3(f.dor, rb * 0.5)), ra * 0.55, rb * 0.55).color(i % 2 ? C.stripe : C.shade).paint(0.01));
    if (i < 2) n.prims.push(orient(S.torus(lerp(ra, rb, 0.5) * 1.02, 0.007), lerp3(a, b, 0.5), f.t).color(gold).pbr(0.3, 0.9).paint(0.003, 0.005));
    for (const sx of [1, -1]) n.hard.push(spike(add3(lerp3(a, b, 0.55), mul3(f.side, sx * ra * 0.8)), add3(mul3(f.side, sx), mul3(f.t, -0.9)), 0.05 + 0.01 * (i % 2), 0.008, C.spine, [0, 1, 0], -0.25).lod(i % 2 ? 1 : 2));
    n.hard.push(spike(add3(lerp3(a, b, 0.4), mul3(f.dor, ra * 0.85)), add3(f.dor, mul3(f.t, -1.2)), 0.04, 0.007, C.spine, [0, 0, 1], -0.2).lod(1));
  } });
  {
    const last = tn[tn.length - 1], e = TL[TL.length - 1], d = norm3(sub3(e, TL[TL.length - 2]));
    last.hard.push(spike(add3(e, mul3(d, -0.01)), d, 0.16, 0.022, C.armorD, [0, 1, 0], 0.15, 0.5));
    for (const sx of [1, -1]) last.hard.push(spike(add3(e, mul3(d, 0.02)), add3(mul3(d, -0.6), [sx, 0.3, 0]), 0.07, 0.012, gold, [0, 1, 0], 0.4).color(gold).pbr(0.3, 0.9));
    last.hard.push(spike(add3(e, mul3(d, 0.03)), add3(mul3(d, -0.6), [0, 1, 0]), 0.06, 0.012, C.armorD, [0, 0, -1], 0.4));
  }
  return { kind: 'titan.quad', attack: 'slam', atkStyle: 'tail', rate: 6.4, stride: 0.38, lie: 0.24, nodes: finish(N.nodes) };
}

function quadAnimLite(rig, inner, c, base) {
  // the stock titan.quad animator lives in titans.js; this is used only when that file is missing
  const { R } = base, t = c.t, ph = c.phase || 0, a = c.atk, s = inner.scale.y || 1;
  const gait = walk4(rig, c, base, rig.rate ?? 5.5, rig.stride ?? 0.34, 0.5, -0.4);
  const sw = a >= 0 ? base.keys(a, [[0, 0], [0.32, -1], [0.55, 1], [1, 0]]) : 0, k = c.moving ? 1 : 0;
  R(rig.torso, 0, Math.sin(gait) * 0.035 * k + sw * 0.3, 0);
  R(rig.neck, 0, -sw * 0.15); R(rig.head, Math.sin(t * 1.2 + ph) * 0.04, -sw * 0.15);
  (rig.tail || []).forEach((seg, i) => R(seg, Math.sin(t * 1.3 + ph - i * 0.6) * 0.03, sw * 0.42 + Math.sin(t * (k ? 4 : 1.5) + ph - i * 0.7) * (0.07 + 0.04 * k), 0));
  const dead = dieSide(inner, c, base, rig.lie ?? 0.22);
  if (!dead) inner.position.y = k * Math.abs(Math.sin(gait)) * 0.018 * s;
}

// =====================================================================================
const guard = (fn) => (def, o) => fn(def || {}, o && typeof o === 'object' ? o : {});
export const bodies = Object.fromEntries(Object.entries({ bogSlug, fateLord, skyManta, shardHorror, whipFiend }).map(([k, f]) => [k, guard(f)]));
export const animators = { 'chaos2.slug': slugAnim, 'chaos2.fate': fateAnim, 'chaos2.manta': mantaAnim, 'chaos2.shard': shardAnim };
// titans.js registers 'titan.quad'; if it is not there, the fiend still walks
try { await import('./titans.js'); } catch (err) { animators['titan.quad'] = quadAnimLite; }
