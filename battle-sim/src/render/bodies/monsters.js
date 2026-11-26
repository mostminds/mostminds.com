// Monsters and engines: dragons, the stone golem and gargoyle, fire and ice elementals, the battering ram.
//
//   bodies.dragon(def, o)     wyrmling / elder drake            kind 'dragon'
//   bodies.golem(def, o)      stone golem; o.wings = gargoyle   kind 'golem' / 'gargoyle'
//   bodies.elemental(def, o)  fire elemental / ice wraith       kind 'fireElemental' / 'iceWraith' (picked by o.glow's hue)
//   bodies.ram(def, o)        battering ram                     kind 'ram'
//
// Rig keys beyond the stock ones (animate.js), all driven by the animators at the bottom of each section:
//   necks    dragon: the second and third neck segments (the first is the stock `neck`)
//   flames   fire elemental: the big plumes that sway and flicker on their own
//   spell    elementals: the charge that swells in the casting hand during an attack
//   chains   ram: the two pairs of sling chains, pivoting at the ridge pole as the trunk swings
//
// Authoring convention used throughout this file: a model is laid out in ONE space, its rest pose (Y up, facing +Z,
// feet on y = 0). Every node records the point it pivots about (`o`); finish() moves each node's prims and hard
// pieces into the node's own space and works out its position under its parent. Nodes flagged with `pos` / `rot`
// (heads, jaws) are authored in their own tilted frame instead.
import * as THREE from 'three';
import { S, H, rgb, noise3, fbm3 } from '../sculpt.js';

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
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const mirX = (v) => [-v[0], v[1], v[2]];

// ---------- deterministic variation ----------
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- colour ----------
const _c = new THREE.Color(), _c2 = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
/** shift a colour in hue / saturation / lightness (sRGB terms) */
function tone(hex, dh = 0, ds = 0, dl = 0) {
  _c.set(hex).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL(((_hsl.h + dh) % 1 + 1) % 1, clamp(_hsl.s + ds), clamp(_hsl.l + dl), THREE.SRGBColorSpace);
  return _c.getHex();
}
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), t).getHex(); }
const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// ---------- placement ----------
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler(), _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3();
/** Euler angles (degrees, XYZ) of the frame whose +Y is yDir and whose +Z leans toward zHint */
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
/** tapered capsule from a to b whose local Y follows the bone, so ridges and strands run along it */
function bone(a, b, ra, rb = ra, zHint) { return orient(S.capsule([0, 0, 0], [0, len3(sub3(b, a)), 0], ra, rb), a, sub3(b, a), zHint); }
/** smooth curve through points (Catmull-Rom), n samples */
function curve(pts, n) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const out = [];
  for (let i = 0; i <= n; i++) { const v = c.getPoint(i / n); out.push([v.x, v.y, v.z]); }
  return out;
}

const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// ---------- nodes ----------
/** start a node: o = the point it pivots about, in the space its prims are authored in */
function node(name, parent, o, extra = {}) { return { name, parent, o, prims: [], hard: [], ...extra }; }
/** move every node's pieces into its own space and produce the description rigkit wants */
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
    return out;
  });
}
const mirrorPrims = (list) => flat(list).map((p) => p.mirrorX());

// ---------- crisp pieces ----------
/** a curved cone pointing along +Y from the origin, hooking toward +Z: claws, fangs, spikes */
function clawGeo(hook, aspect, flatX = 1) {
  return cached(`claw${hook}:${aspect}:${flatX}`, () => {
    const g = new THREE.ConeGeometry(aspect, 1, 8, 5);
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

/** a horn: tube through points, tapering from r0 to a point, with growth rings; cols = [base, mid, tip] */
function horn(pts, r0, cols, opt = {}) {
  const n = opt.rings ?? 26, radii = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const taper = Math.pow(1 - t, opt.pow ?? 0.8) * (1 - (opt.tip ?? 0.04)) + (opt.tip ?? 0.04);
    radii.push(r0 * taper * (1 + (opt.ripple ?? 0.13) * (i % 2 ? -1 : 0.6) * (1 - t * 0.75)));
  }
  const total = pts.length;
  const a = rgb(cols[0]), b = rgb(cols[1]), c = rgb(cols[2]);
  // colour by distance along the horn: measured from the base point
  const base = pts[0], end = pts[total - 1], L = len3(sub3(end, base)) || 1;
  const shade = (x, y, z) => {
    const t = clamp(len3(sub3([x, y, z], base)) / L);
    return t < 0.5 ? mixRgb(a, b, t * 2) : mixRgb(b, c, (t - 0.5) * 2);
  };
  const fine = H.tube(pts, radii, n * 2, opt.radial ?? 8).shade(shade).color(cols[1]).pbr(opt.rough ?? 0.42, 0).lod(1);
  if (opt.fineOnly) return [fine];
  const core = H.tube(pts, [r0 * 0.8, r0 * 0.55, r0 * 0.28, r0 * 0.06], 5, 5).shade(shade).color(cols[1]).pbr(opt.rough ?? 0.42, 0);
  return [fine, core];
}

/** eyeball looking along +Z: slit pupil, banded iris. look: { iris, rim, pupil, white, glow } */
function reptileEye(r, look = {}) {
  const iris = rgb(look.iris ?? 0xffc21a), rim = rgb(look.rim ?? 0x7a3a08), pupil = rgb(look.pupil ?? 0x080606), white = rgb(look.white ?? 0x2a1a10);
  const inner = rgb(look.inner ?? 0xfff2a0);
  const h = H.sphere(1, 28).shade((x, y, z) => {
    if (z < 0.25) return white;
    const d = Math.hypot(x, y);
    if (look.cloud) return d < 0.6 ? mixRgb(rgb(0x8f9ea6), rgb(0x55626a), d / 0.6) : white;
    if (Math.abs(x) < 0.085 * (1.15 - Math.abs(y) * 0.9) && Math.abs(y) < 0.56) return pupil;
    if (d < 0.66) return d < 0.3 ? mixRgb(inner, iris, d / 0.3) : mixRgb(iris, rim, (d - 0.3) / 0.36);
    if (d < 0.74) return pupil;
    return white;
  }).color(look.white ?? 0x2a1a10).pbr(0.1, 0).scale(r);
  if (look.glow) h.glow(look.glow);
  return h;
}

/**
 * A skin stretched between two edge curves. A(u), B(u) with u in 0..1 give points; the sheet runs from A (v = 0)
 * to B (v = 1). Its far edge (u = 1) is scalloped between the two and the middle billows along `up`.
 * opt: nu, nv, scallop, billow, up, col(u, v, p) -> [r,g,b], hole(u, v) -> true to leave a tear, edge(v) -> extra trim of the far edge
 */
function membrane(A, B, opt = {}) {
  const nu = opt.nu ?? 10, nv = opt.nv ?? 8, sc = opt.scallop ?? 0.2, bil = opt.billow ?? 0.03, up = opt.up ?? [0, 1, 0];
  const pos = [], idx = [], cols = new Map();
  const key = (x, y, z) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
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
    if (opt.col) cols.set(key(p[0], p[1], p[2]), opt.col(u0, v, p));
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
  if (opt.col) h.shade((x, y, z) => cols.get(key(x, y, z)) ?? null);
  h.surf = surf;
  return h;
}
/** straight line a -> b as a curve function, optionally bowed by `bow` (a vector added at the middle) */
const lineFn = (a, b, bow) => (u) => { const p = lerp3(a, b, u); if (bow) { const k = 4 * u * (1 - u); p[0] += bow[0] * k; p[1] += bow[1] * k; p[2] += bow[2] * k; } return p; };

// =====================================================================================
//  DRAGONS
// =====================================================================================

function dragonPalette(o, old) {
  const base = o.scales ?? (old ? 0x8a2a2a : 0x3a8a3a);
  if (old) {
    return {
      scale: tone(base, 0, 0.06, -0.02), back: tone(base, -0.02, 0.0, -0.17), deep: tone(base, -0.03, -0.1, -0.24), flank: tone(base, 0.012, 0.08, 0.04),
      belly: 0xc9a05a, bellyEdge: 0x8f6a36, bellyDeep: 0x7a5a30,
      horn: [0x4a3e36, 0x2a2422, 0x100e0e], spine: [0x3a1418, 0x1c0c0e], claw: 0x161212, tooth: 0xe9dfc0,
      mouth: 0x3c0c12, tongue: 0xd0605a, throat: 0xff8a1e, socket: tone(base, -0.02, 0, -0.26),
      wingA: tone(base, 0.0, 0.0, -0.2), wingB: mix(tone(base, 0.035, 0.1, 0.06), 0xd8642a, 0.45), wingBone: tone(base, -0.02, 0, -0.2),
      frillA: 0x2a1014, frillB: 0xb8421e, scar: 0xd49a8c,
      eye: { iris: 0xffb414, inner: 0xfff3a0, rim: 0xc23a08, white: 0x1c0c0a, glow: 0.55 },
    };
  }
  return {
    scale: base, back: tone(base, 0.03, 0.04, -0.1), deep: tone(base, 0.05, 0.0, -0.17), flank: tone(base, -0.03, 0.06, 0.05),
    belly: 0xdccf8c, bellyEdge: 0xa89a56, bellyDeep: 0x8a8046,
    horn: [0xe6dcb8, 0xcbb98a, 0x6a563a], spine: [mix(base, 0xd8a83a, 0.55), 0x7a5a2a], claw: 0x2c2820, tooth: 0xf1e9cc,
    mouth: 0x5a1420, tongue: 0xe07a78, throat: 0xff9a2a, socket: tone(base, 0.02, 0, -0.2),
    wingA: tone(base, 0.02, 0.02, -0.08), wingB: mix(tone(base, -0.06, 0.1, 0.12), 0xe2c24a, 0.5), wingBone: tone(base, 0.03, 0.02, -0.13),
    frillA: mix(base, 0xe0a030, 0.35), frillB: 0xf0b838, scar: 0xb8c8a0,
    eye: { iris: 0xffc81e, inner: 0xfff7b0, rim: 0xd2640a, white: 0x1e1a0c, glow: 0.3 },
  };
}

function dragon(def, o = {}) {
  const old = def?.id === 'drake' || (o.scale ?? 1) >= 1.2;
  const rnd = rng(hashStr(def?.id || 'dragon'));
  const C = dragonPalette(o, old);
  // proportions: the wyrmling is a youngster (big head and eyes, short muzzle, stubby horns, small wings)
  const K = old
    ? { chest: [0.22, 0.25, 0.3], neck: [0.155, 0.128, 0.108, 0.098], snout: 0.37, headS: 1.0, head: 1.36, wing: 1.0, spineH: 0.115, tailR: 1.08, leg: 1.2, det: 0.97 }
    : { chest: [0.185, 0.205, 0.27], neck: [0.122, 0.1, 0.086, 0.08], snout: 0.27, headS: 1.14, head: 1.3, wing: 0.8, spineH: 0.072, tailR: 0.92, leg: 1.0, det: 0.85 };
  const bAmp = old ? 0.0095 : 0.0095, bFreq = old ? 21 : 19;
  const sk = (p) => p.color(C.scale).bump(bAmp, bFreq, 'scales').tint(0.16, 9).pbr(0.46, 0.05);
  const skFine = (p) => p.color(C.scale).bump(bAmp * 0.6, bFreq * 1.3, 'scales').tint(0.14, 12).pbr(0.46, 0.05);

  const nodes = [];
  const root = node('root', null, [0, 0, 0]); nodes.push(root);

  // ---------------- torso ----------------
  const TO = [0, 0.56, 0];
  const torso = node('torso', 'root', TO, { rig: 'torso', detail: 0.76 * K.det }); nodes.push(torso);
  const cr = K.chest;
  const N = [[0, 0.7, 0.4], [0, 0.95, 0.565], [0, 1.18, 0.545], [0, 1.36, 0.635]];      // neck joints, chest to skull
  const TL = [[0, 0.575, -0.5], [0, 0.535, -0.71], [0, 0.465, -0.92], [0, 0.4, -1.12], [0, 0.36, -1.31], [0, 0.365, -1.48]]; // tail joints
  {
    const p = torso.prims;
    p.push(sk(S.ellipsoid(cr[0], cr[1], cr[2]).rot(-9, 0, 0).at(0, 0.565, 0.2)));                         // rib cage
    p.push(sk(S.ellipsoid(0.165, 0.172, 0.27).at(0, 0.585, -0.1).blend(0.07)));                           // loin
    p.push(sk(S.ellipsoid(0.158, 0.165, 0.2).at(0, 0.575, -0.36).blend(0.06)));                           // pelvis
    p.push(sk(S.capsule([0, 0.6, 0.33], add3(N[0], [0, 0.02, 0.02]), 0.17, K.neck[0] * 1.04).blend(0.07))); // neck root
    p.push(sk(S.capsule([0, 0.58, -0.44], add3(TL[0], [0, 0, -0.03]), 0.14, 0.125 * K.tailR).blend(0.06)));  // tail root
    p.push(...S.mirrorX([
      sk(S.ellipsoid(0.085, 0.135, 0.115).rot(0, 0, -14).at(0.158, 0.6, 0.25).blend(0.035)),             // shoulder blade and muscle
      sk(S.ellipsoid(0.07, 0.05, 0.11).rot(0, 20, -20).at(0.105, 0.765, 0.2).blend(0.035)),              // wing root
      sk(S.ellipsoid(0.092, 0.145, 0.15).rot(18, 0, -8).at(0.142, 0.585, -0.34).blend(0.035)),           // haunch
      sk(S.ellipsoid(0.06, 0.06, 0.16).at(0.11, 0.69, -0.05).blend(0.04)),                               // long back muscles
      sk(S.ellipsoid(0.07, 0.09, 0.1).at(0.1, 0.44, 0.33).blend(0.03)),                                  // breast
    ]));
    // the darker saddle of the back, then stripes
    p.push(S.ellipsoid(0.15, 0.13, 0.72).at(0, 0.78, -0.08).color(C.back).paint(0.06));
    const nStripe = old ? 7 : 6;
    for (let i = 0; i < nStripe; i++) {
      const z = 0.36 - i * (0.86 / (nStripe - 1)), w = 0.012 + 0.008 * rnd();
      p.push(...S.mirrorX([S.ellipsoid(0.14, 0.2, w).rot(old ? -18 : 12, 0, -34).at(0.1, 0.74, z + (rnd() - 0.5) * 0.03).color(C.deep).paint(0.014)]));
    }
    // belly plates: overlapping scutes from the breast to the vent
    const under = [[0, 0.5, 0.47], [0, 0.375, 0.36], [0, 0.325, 0.2], [0, 0.35, 0.02], [0, 0.4, -0.16], [0, 0.415, -0.34], [0, 0.44, -0.5]];
    const us = curve(under, 13);
    for (let i = 0; i < us.length - 1; i++) {
      const a = us[i], b = us[i + 1], t = norm3(sub3(a, b)), nrm = [0, -t[2], t[1]];
      const w = lerp(0.1, 0.085, Math.abs(i - 5) / 7) * (i < 2 ? 0.8 : 1);
      p.push(orient(S.ellipsoid(w, 0.03, len3(sub3(a, b)) * 0.72), add3(lerp3(a, b, 0.5), mul3(nrm, -0.012)), nrm, t).color(i % 2 ? C.belly : mix(C.belly, C.bellyEdge, 0.25)).pbr(0.55).tint(0.1, 30).blend(0.006));
      p.push(orient(S.ellipsoid(w * 0.98, 0.012, 0.006), add3(b, mul3(nrm, 0.006)), nrm, t).color(C.bellyDeep).paint(0.004, -0.003));
    }
    // knobbly plates either side of the spine
    for (let i = 0; i < 9; i++) {
      const z = 0.4 - i * 0.105, y = 0.775 + 0.03 * Math.sin((i / 8) * Math.PI) - (i > 6 ? 0.015 : 0) + (i < 1 ? -0.02 : 0);
      p.push(...S.mirrorX([S.ellipsoid(0.03, 0.016, 0.04).rot(0, 0, -24).at(0.058, y, z).color(C.deep).pbr(0.42).blend(0.008)]));
    }
    // dorsal spines
    for (let i = 0; i < 9; i++) {
      const z = 0.36 - i * 0.1, y = 0.805 + 0.028 * Math.sin((i / 8) * Math.PI) - (i > 6 ? 0.02 : 0);
      const hgt = K.spineH * (0.8 + 0.5 * Math.sin((i / 8) * Math.PI)) * (old && i === 5 ? 0.45 : 1);
      torso.hard.push(spike([0, y - 0.02, z], [0, 1, -0.5], hgt, hgt * 0.3, C.spine[0], [0, -0.3, -1], 0.35, 0.34).shade((x, yy) => (yy > 0.55 ? C.spine[1] : null)).lod(1));
    }
  }

  // ---------------- neck ----------------
  const neckNodes = [];
  for (let i = 0; i < 3; i++) {
    const n = node(`neck${i}`, i === 0 ? 'torso' : `neck${i - 1}`, N[i], { rig: i === 0 ? 'neck' : 'necks', detail: 0.78 * K.det });
    nodes.push(n); neckNodes.push(n);
    const a = N[i], b = N[i + 1], t = norm3(sub3(b, a)), ven = [0, -t[2], t[1]], dor = mul3(ven, -1);
    const ra = K.neck[i], rb = K.neck[i + 1];
    const p = n.prims;
    p.push(sk(S.capsule(a, b, ra, rb)));
    p.push(sk(S.capsule(add3(a, mul3(ven, ra * 0.25)), add3(b, mul3(ven, rb * 0.25)), ra * 0.86, rb * 0.86).blend(0.03)));     // deeper than wide
    p.push(S.capsule(add3(a, mul3(dor, ra * 0.55)), add3(b, mul3(dor, rb * 0.55)), ra * 0.62, rb * 0.62).color(C.back).paint(0.035));
    // throat scutes
    const ns = 4;
    for (let k = 0; k < ns; k++) {
      const f = (k + 0.5) / ns, c = lerp3(a, b, f), r = lerp(ra, rb, f);
      p.push(orient(S.ellipsoid(r * 0.72, r * 0.3, len3(sub3(b, a)) / ns * 0.72), add3(c, mul3(ven, r * 0.95)), ven, t).color(k % 2 ? C.belly : mix(C.belly, C.bellyEdge, 0.25)).pbr(0.55).tint(0.1, 30).blend(0.006));
    }
    // stripes
    for (let k = 0; k < 2; k++) {
      const f = (k + 0.4) / 2, c = lerp3(a, b, f), r = lerp(ra, rb, f);
      p.push(orient(S.torus(r * 0.9, 0.014), add3(c, mul3(dor, r * 0.3)), t, dor).color(C.deep).paint(0.012));
    }
    // spines
    const nsp = 3;
    for (let k = 0; k < nsp; k++) {
      const f = (k + 0.35) / nsp, c = lerp3(a, b, f), r = lerp(ra, rb, f) * 1.12;
      const hgt = K.spineH * (0.85 + 0.25 * (i + f) / 3);
      n.hard.push(spike(add3(c, mul3(dor, r * 0.86)), add3(dor, mul3(t, -0.55)), hgt, hgt * 0.3, C.spine[0], mul3(t, -1), 0.35, 0.34).shade((x, yy) => (yy > 0.55 ? C.spine[1] : null)).lod(1));
    }
  }

  // ---------------- head and jaw ----------------
  const hd = dragonHead(K, C, old, rnd);
  const headPitch = old ? 16 : 12;
  const head = node('head', 'neck2', [0, 0, 0], { rig: 'head', pos: sub3(N[3], N[2]), rot: [headPitch, 0, 0], detail: old ? 1.15 : 1.1 });
  head.prims = hd.p; head.hard = hd.hard; nodes.push(head);
  const jaw = node('jaw', 'head', hd.hinge, { rig: 'jaw', pos: hd.hinge, detail: old ? 1.15 : 1.1 });
  jaw.prims = hd.jp; jaw.hard = hd.jhard; nodes.push(jaw);

  // ---------------- legs ----------------
  const legSpec = [
    { name: 'FL', front: true, J: [0.185, 0.5, 0.25], E: [0.243, 0.278, 0.165], Wp: [0.25, 0.085, 0.24] },
    { name: 'BL', front: false, J: [0.172, 0.54, -0.36], E: [0.243, 0.3, -0.225], Hk: [0.236, 0.155, -0.43], Wp: [0.24, 0.06, -0.37] },
  ];
  const legParts = {};
  for (const L of legSpec) legParts[L.name] = dragonLeg(L, K, C, sk, skFine, old);
  for (const [nm, src, side] of [['FL', 'FL', 1], ['FR', 'FL', -1], ['BL', 'BL', 1], ['BR', 'BL', -1]]) {
    const part = legParts[src], spec = legSpec.find((l) => l.name === src);
    const J = side > 0 ? spec.J : mirX(spec.J), E = side > 0 ? spec.E : mirX(spec.E);
    const up = node(`leg${nm}`, 'torso', J, { rig: 'legs', detail: 0.8 * K.det });
    const lo = node(`shin${nm}`, `leg${nm}`, E, { rig: 'shins', detail: 0.85 * K.det });
    const cp = (list) => (side > 0 ? flat(list).map((q) => q.clone()) : flat(list).map((q) => q.mirrorX()));
    up.prims = cp(part.up.prims); up.hard = cp(part.up.hard); lo.prims = cp(part.lo.prims); lo.hard = cp(part.lo.hard);
    nodes.push(up, lo);
  }

  // ---------------- wings ----------------
  const wg = dragonWing(K, C, sk, old);
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const cp = (list) => (side > 0 ? flat(list) : flat(list).map((q) => q.mirrorX()));
    const w = node(`wing${nm}`, 'torso', side > 0 ? wg.S : mirX(wg.S), { rig: 'wings', detail: 0.75 * K.det });
    const tp = node(`wingtip${nm}`, `wing${nm}`, side > 0 ? wg.W : mirX(wg.W), { rig: 'wingtips' });
    const src = side > 0 ? wg.left : wg.right;
    w.prims = cp(src.arm.prims); w.hard = cp(src.arm.hard);
    tp.prims = cp(src.tip.prims); tp.hard = cp(src.tip.hard);
    nodes.push(w, tp);
  }

  // ---------------- tail ----------------
  const tr = [0.125, 0.1, 0.078, 0.058, 0.041, 0.027].map((r) => r * K.tailR);
  for (let i = 0; i < 5; i++) {
    const n = node(`tail${i}`, i === 0 ? 'torso' : `tail${i - 1}`, TL[i], { rig: 'tail', detail: 0.75 * K.det });
    nodes.push(n);
    const a = TL[i], b = TL[i + 1], t = norm3(sub3(a, b)), ven = [0, -t[2], t[1]], dor = mul3(ven, -1);  // t points headward
    const ra = tr[i], rb = tr[i + 1], p = n.prims;
    p.push(sk(S.capsule(a, b, ra, rb)));
    p.push(S.capsule(add3(a, mul3(dor, ra * 0.5)), add3(b, mul3(dor, rb * 0.5)), ra * 0.66, rb * 0.66).color(C.back).paint(0.03));
    for (let k = 0; k < 3; k++) {
      const f = (k + 0.5) / 3, c = lerp3(a, b, f), r = lerp(ra, rb, f);
      p.push(orient(S.ellipsoid(r * 0.7, r * 0.3, len3(sub3(b, a)) / 3 * 0.74), add3(c, mul3(ven, r * 0.78)), ven, t).color(k % 2 ? C.belly : mix(C.belly, C.bellyEdge, 0.25)).pbr(0.55).tint(0.1, 30).blend(0.006));
      p.push(orient(S.torus(r * 0.92, 0.012), add3(c, mul3(dor, r * 0.28)), t, dor).color(C.deep).paint(0.01));
    }
    for (let k = 0; k < 2; k++) {
      const f = (k + 0.3) / 2, c = lerp3(a, b, f), r = lerp(ra, rb, f);
      const hgt = K.spineH * lerp(0.95, 0.4, (i + f) / 5);
      n.hard.push(spike(add3(c, mul3(dor, r * 0.86)), add3(dor, mul3(t, -0.6)), hgt, hgt * 0.3, C.spine[0], mul3(t, -1), 0.35, 0.34).shade((x, yy) => (yy > 0.55 ? C.spine[1] : null)).lod(1));
    }
    if (i === 4) dragonTailEnd(n, b, tr[5], C, old);
  }

  return { kind: 'dragon', attack: 'bite', nodes: finish(nodes) };
}

/** head and lower jaw, in the head's own frame: skull joint at the origin, muzzle along +Z */
function dragonHead(K, C, old, rnd) {
  const SL = K.snout, s = K.headS;
  const p = [], hard = [], jp = [], jhard = [];
  const sk = (q) => q.color(C.scale).bump(old ? 0.0058 : 0.0066, old ? 34 : 30, 'scales').tint(0.14, 16).pbr(0.46, 0.05);
  const bare = (q) => q.color(C.scale).tint(0.1, 20).pbr(0.48, 0.05);
  const lipY = -0.046;
  // ---- cranium and muzzle ----
  p.push(sk(S.ellipsoid(0.086 * s, 0.068 * s, 0.108).at(0, 0.014, 0.036)));
  p.push(sk(S.capsule([0, 0.004, 0.09], [0, -0.012, SL - 0.034], 0.062 * s, 0.035).blend(0.045)));
  p.push(sk(S.capsule([0, 0.0, -0.02], [0, -0.03, -0.09], 0.078, 0.082).blend(0.04)));                       // back of the skull into the neck
  p.push(...S.mirrorX([
    sk(S.capsule([0.05 * s, -0.022, 0.05], [0.021, -0.028, SL - 0.028], 0.03, 0.02).blend(0.03)),            // upper lip
    sk(S.ellipsoid(0.034 * s, 0.045, 0.058).at(0.066 * s, -0.016, 0.022).blend(0.03)),                       // jaw muscle
    bare(S.capsule([0.066 * s, 0.002, 0.15], [0.09 * s, 0.006, 0.02], 0.012, 0.017).blend(0.018)),           // cheekbone
    bare(S.capsule([0.028, 0.05, 0.165], [0.08 * s, 0.07 * s, -0.005], 0.017, old ? 0.03 : 0.024).blend(0.018)), // brow
    bare(S.ellipsoid(0.017, 0.014, 0.022).at(0.019, 0.006, SL - 0.024).blend(0.012)),                        // nostril mound
  ]));
  p.push(bare(S.capsule([0, 0.05, 0.11], [0, 0.014, SL - 0.06], 0.016, 0.011).blend(0.02)));                 // nasal ridge
  if (old) for (let i = 0; i < 4; i++) p.push(bare(S.ellipsoid(0.011, 0.011, 0.014).at(0, 0.058 - i * 0.011, 0.13 + i * 0.045).blend(0.006)).color(C.back));
  // lip scales along the upper jaw
  const nLab = old ? 9 : 7;
  for (let i = 0; i < nLab; i++) {
    const f = (i + 0.5) / nLab, z = lerp(0.065, SL - 0.03, f);
    p.push(...S.mirrorX([bare(S.ellipsoid(0.0085, 0.0105, 0.0135).at(lerp(0.0775 * s, 0.04, f) + 0.001, lipY + 0.013, z).blend(0.004)).color(i % 2 ? C.back : C.scale)]));
  }
  // cheek plates behind the eye
  for (const [x, y, z] of [[0.09, 0.0, 0.062], [0.095, -0.02, 0.036], [0.092, 0.018, 0.03], [0.096, -0.004, 0.006]]) {
    p.push(...S.mirrorX([bare(S.ellipsoid(0.007, 0.0145, 0.0165).at(x * s, y, z).blend(0.005)).color(C.back)]));
  }
  // crown plates between the brows
  for (const [x, z, rx, rz] of [[0, 0.045, 0.021, 0.028], [0.037, 0.075, 0.016, 0.024], [0, 0.105, 0.016, 0.026], [0.034, 0.012, 0.019, 0.026], [0, -0.02, 0.02, 0.026]]) {
    const y = 0.014 + 0.068 * s * Math.sqrt(Math.max(0.05, 1 - Math.pow(x / (0.086 * s), 2) - Math.pow((z - 0.036) / 0.108, 2))) - 0.003;
    const q = bare(S.ellipsoid(rx, 0.0075, rz).at(x, y, z).blend(0.005)).color(C.deep);
    p.push(q); if (x) p.push(q.mirrorX());
  }
  // darker crown
  p.push(S.ellipsoid(0.07 * s, 0.05, 0.2).at(0, 0.07, 0.08).color(C.back).paint(0.03));
  p.push(...S.mirrorX([S.ellipsoid(0.02, 0.02, 0.05).at(0.07 * s, 0.035, 0.11).color(C.deep).paint(0.012)]));  // shadow around the eye
  // flat lip line: carve away everything under it along the muzzle, the cut face is the palate
  p.push(S.box(0.3, 0.12, SL + 0.1, 0.004).at(0, lipY - 0.06, 0.07 + (SL + 0.1) / 2).cut(0.005).color(C.mouth));
  p.push(S.ellipsoid(0.026, 0.014, (SL - 0.1) / 2).at(0, lipY, (SL + 0.06) / 2).cut(0.008).color(C.mouth));   // vaulted palate
  p.push(S.ellipsoid(0.042, 0.03, 0.04).at(0, lipY - 0.002, 0.03).color(C.mouth).pbr(0.35).blend(0.004));     // gullet, seen when the jaws open
  p.push(S.sphere(0.034).at(0, lipY - 0.012, 0.062).color(C.throat).glow(old ? 1.6 : 1.1).paint(0.016));      // ember in the throat
  // a row of spikes along each brow
  {
    const a = [0.028, 0.05, 0.165], b = [0.08 * s, 0.07 * s, -0.005], nb = old ? 4 : 3;
    for (let i = 0; i < nb; i++) {
      const f = 0.3 + (i / (nb - 1)) * 0.62, c = lerp3(a, b, f), len = (old ? 0.03 : 0.018) * (0.7 + f * 0.8);
      for (const side of [1, -1]) hard.push(spike([side * (c[0] + 0.004), c[1] + 0.012, c[2]], [side * 0.5, 0.75, -0.75], len, len * 0.3, C.horn[1], [0, 0, -1], 0.3).lod(1));
    }
  }
  // eyes
  const eyeR = old ? 0.0155 : 0.02, eyeC = [0.058 * s, 0.03, old ? 0.108 : 0.1];
  p.push(...S.mirrorX([S.ellipsoid(eyeR * 1.25, eyeR * 1.05, eyeR * 1.5).at(eyeC[0] + 0.008, eyeC[1] - 0.002, eyeC[2] + 0.004).cut(0.007).color(C.socket)]));
  for (const side of [1, -1]) {
    const look = side > 0 && old ? { cloud: true, white: 0x2a1410 } : C.eye;
    hard.push(reptileEye(eyeR, look).rot(-8, side * 58, 0).at(side * eyeC[0], eyeC[1], eyeC[2]).lod(1));
  }
  // nostrils
  p.push(...S.mirrorX([S.ellipsoid(0.0065, 0.005, 0.011).rot(0, 35, 0).at(0.027, 0.008, SL - 0.014).cut(0.004).color(0x1a0a08)]));

  // ---- horns ----
  const hb = [0.058 * s, 0.07 * s, -0.025];
  const hornPts = old
    ? [hb, [0.09, 0.1, -0.12], [0.118, 0.15, -0.22], [0.125, 0.225, -0.285], [0.105, 0.3, -0.3]]
    : [hb, [0.078, 0.1, -0.075], [0.088, 0.135, -0.125], [0.086, 0.165, -0.15]];
  for (const side of [1, -1]) {
    const pts = hornPts.map((q) => [q[0] * side, q[1], q[2]]);
    hard.push(horn(pts, old ? 0.027 : 0.02, C.horn, { rings: old ? 22 : 14 }));
    p.push(bare(S.torus(old ? 0.026 : 0.02, 0.008).rot(-50, 0, side * -14).at(pts[0][0], pts[0][1] - 0.004, pts[0][2] + 0.004).blend(0.008)));
  }
  if (old) {
    // a second, lower pair, the left one snapped off years ago; cheek horns; a nose horn
    for (const side of [1, -1]) {
      const pts = [[0.082, 0.03, -0.035], [0.118, 0.045, -0.12], [0.142, 0.085, -0.2], [0.148, 0.14, -0.25]].map((q) => [q[0] * side, q[1], q[2]]);
      if (side > 0) hard.push(horn(pts.slice(0, 3), 0.021, C.horn, { rings: 14, tip: 0.5, pow: 0.5 }));
      else hard.push(horn(pts, 0.021, C.horn, { rings: 22 }));
      p.push(bare(S.sphere(0.024).at(pts[0][0], pts[0][1], pts[0][2]).blend(0.012)));
      for (let k = 0; k < 3; k++) hard.push(spike([side * (0.088 - k * 0.008), -0.022 - k * 0.006, 0.02 + k * 0.04], [side * 0.8, -0.25, -0.55], 0.06 - k * 0.012, 0.011, C.horn[1], [0, 0, -1], 0.3).lod(1));
    }
    hard.push(horn([[0, 0.014, SL - 0.085], [0, 0.045, SL - 0.092], [0, 0.082, SL - 0.115]], 0.016, C.horn, { rings: 10, fineOnly: true }));
    // old wounds: three claw marks over the blind eye, a nick across the muzzle
    for (let k = 0; k < 3; k++) p.push(S.box(0.09, 0.13, 0.0075, 0.003).rot(0, 72, 0).rot(0, 0, -38).at(0.066, 0.04, 0.155 - k * 0.03).color(mix(C.scar, C.scale, 0.3)).pbr(0.75).paint(0.003, -0.004));
    p.push(S.box(0.075, 0.08, 0.007, 0.003).rot(0, 50, 0).at(-0.03, 0.03, SL - 0.12).color(mix(C.scar, C.scale, 0.3)).paint(0.003, -0.004));
  } else {
    // nubs where the next horns will grow
    for (const side of [1, -1]) hard.push(spike([side * 0.084 * s, 0.03, -0.03], [side * 0.7, 0.3, -0.6], 0.045, 0.012, C.horn[1], [0, 0, -1], 0.25).lod(1));
    hard.push(spike([0, 0.02, SL - 0.075], [0, 1, -0.25], 0.022, 0.008, C.horn[1], [0, 0, -1], 0.2).lod(1));
  }

  // ---- frill: spines webbed with skin, fanning back from the cheek ----
  for (const side of [1, -1]) {
    const o0 = [side * 0.074 * s, -0.012, -0.012];
    const dirs = old
      ? [[0.5, 0.62, -0.6], [0.78, 0.2, -0.6], [0.8, -0.18, -0.57], [0.55, -0.55, -0.62]]
      : [[0.42, 0.72, -0.55], [0.72, 0.36, -0.6], [0.8, -0.02, -0.6], [0.66, -0.4, -0.63], [0.4, -0.68, -0.62]];
    const lens = old ? [0.15, 0.18, 0.16, 0.12] : [0.1, 0.125, 0.13, 0.115, 0.085];
    const tips = dirs.map((d, i) => add3(o0, mul3(norm3([d[0] * side, d[1], d[2]]), lens[i])));
    tips.forEach((tip, i) => hard.push(H.tube([o0, lerp3(o0, tip, 0.55), tip], [0.007, 0.005, 0.0015], 6, 5).color(old ? C.horn[1] : C.spine[1]).pbr(0.45).lod(1)));
    const cA = rgb(C.frillA), cB = rgb(C.frillB);
    for (let i = 0; i < tips.length - 1; i++) {
      const torn = old && ((i === 1 && side > 0) || (i === 2 && side < 0));
      hard.push(membrane(lineFn(o0, tips[i]), lineFn(o0, tips[i + 1]), {
        nu: 5, nv: 4, scallop: torn ? 0.5 : 0.24, billow: 0.006, up: [side, 0, 0.3],
        col: (u, v) => mixRgb(cA, cB, smooth(u * 1.15 - 0.1) * (0.55 + 0.45 * Math.sin(v * Math.PI))),
      }).lod(1));
    }
  }

  // ---- teeth: upper row hangs outside the lower jaw ----
  const lipX = (z) => lerp(0.064 * s, 0.027, clamp((z - 0.06) / (SL - 0.09))) ;
  const nUp = old ? 10 : 8;
  for (let i = 0; i < nUp; i++) {
    const f = i / (nUp - 1), z = lerp(0.085, SL - 0.03, f);
    const big = (i === nUp - 2 || i === nUp - 5) ? 1.75 : 1;
    const len = (0.017 + 0.007 * ((i * 7) % 3) / 2) * big * (old ? 1.15 : 1);
    for (const side of [1, -1]) hard.push(spike([side * (lipX(z) + 0.002), lipY + 0.006, z], [side * 0.12, -1, 0.06], len, len * 0.27, C.tooth, [0, 0, -1], 0.22).lod(1));
  }
  for (const side of [1, -1]) hard.push(spike([side * 0.012, lipY + 0.006, SL - 0.012], [0, -1, 0.15], 0.014, 0.004, C.tooth, [0, 0, -1], 0.2).lod(0));

  // ---- lower jaw (authored in the head frame; pivots about the hinge) ----
  const hinge = [0, -0.034, 0.02];
  const JL = SL - 0.03;                                                                                  // jaw is a little shorter than the muzzle
  jp.push(...S.mirrorX([sk(S.capsule([0.054 * s, -0.054, 0.01], [0.017, -0.066, JL - 0.02], 0.024, 0.018))]));
  jp.push(sk(S.ellipsoid(0.048, 0.023, (JL - 0.02) / 2).at(0, -0.068, (JL + 0.02) / 2).blend(0.03)));
  jp.push(sk(S.ellipsoid(0.024, 0.022, 0.03).at(0, -0.07, JL - 0.028).blend(0.02)));                    // chin
  jp.push(...S.mirrorX([
    sk(S.ellipsoid(0.022, 0.03, 0.03).at(0.052 * s, -0.04, 0.012).blend(0.02)),                         // jaw joint
    sk(S.ellipsoid(0.02, 0.03, 0.045).at(0.046 * s, -0.064, 0.045).blend(0.02)),                        // angle of the jaw
  ]));
  for (let i = 0; i < 4; i++) {                                                                          // pale plates under the jaw
    const z = lerp(0.05, JL - 0.06, i / 3);
    jp.push(S.ellipsoid(lerp(0.036, 0.02, i / 3), 0.011, 0.03).at(0, -0.086, z).color(i % 2 ? C.belly : mix(C.belly, C.bellyEdge, 0.25)).pbr(0.55).blend(0.006));
  }
  jp.push(S.box(0.3, 0.12, SL + 0.3, 0.004).at(0, lipY - 0.002 + 0.06, SL / 2).cut(0.005).color(C.mouth)); // flat top
  jp.push(S.ellipsoid(0.03, 0.01, (JL - 0.08) / 2).at(0, lipY - 0.002, (JL + 0.04) / 2).cut(0.006).color(C.mouth)); // trough
  jp.push(...S.limb([[0, -0.056, 0.05], [0, -0.05, JL * 0.55], [0, -0.046, JL - 0.06]], [0.024, 0.02, 0.011]).map((q) => q.color(C.tongue).pbr(0.3).blend(0.006)));
  jhard.push(H.sphere(0.03, 12).scale(1, 0.7, 1).at(0, -0.05, 0.045).color(C.throat).glow(2).pbr(0.4));          // the fire banked at the back of the throat
  jp.push(...S.mirrorX([S.capsule([0, -0.047, JL - 0.06], [0.008, -0.046, JL - 0.035], 0.005, 0.003).color(C.tongue).pbr(0.3).blend(0.004)]));
  const nLo = old ? 9 : 7;
  for (let i = 0; i < nLo; i++) {
    const f = i / (nLo - 1), z = lerp(0.1, JL - 0.022, f);
    const big = (i === nLo - 1 || i === nLo - 4) ? 1.6 : 1;
    const len = (0.014 + 0.005 * ((i * 5) % 3) / 2) * big;
    const x = lerp(0.043 * s, 0.012, clamp((z - 0.03) / (JL - 0.05))) ;
    for (const side of [1, -1]) jhard.push(spike([side * x, lipY - 0.006, z], [side * 0.08, 1, 0.02], len, len * 0.27, C.tooth, [0, 0, -1], 0.2).lod(1));
  }
  if (old) {
    // chin and jaw spikes: an old drake's beard
    for (let k = 0; k < 4; k++) for (const side of [1, -1]) jhard.push(spike([side * lerp(0.04, 0.016, k / 3), -0.074, lerp(0.06, JL - 0.05, k / 3)], [side * 0.5, -0.8, -0.35], 0.04 - k * 0.004, 0.008, C.horn[1], [0, 0, -1], 0.3).lod(1));
    jhard.push(spike([0, -0.08, JL - 0.035], [0, -0.9, -0.3], 0.05, 0.01, C.horn[1], [0, 0, -1], 0.35).lod(1));
  }
  const hs = K.head;
  for (const q of [...flat(p), ...flat(jp)]) q.scale(hs);
  for (const q of [...flat(hard), ...flat(jhard)]) q.scale(hs);
  return { p, hard, jp, jhard, hinge: mul3(hinge, hs) };
}

/** one left leg: upper segment hanging from joint J, lower from E. Returns parts in the model's rest space. */
function dragonLeg(L, K, C, sk, skFine, old) {
  const up = { prims: [], hard: [] }, lo = { prims: [], hard: [] };
  const k = K.leg;
  const toes = (palm, n = 4) => {
    // toes fan out along +Z from the palm, knuckles arched, claws biting the ground
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * 0.3 + 0.08, dx = Math.sin(a), dz = Math.cos(a);
      const len = (i === 0 || i === n - 1 ? 0.085 : 0.105) * k;
      const b0 = add3(palm, [dx * 0.03, -0.002, dz * 0.03]), kn = add3(palm, [dx * len * 0.62, 0.016, dz * len * 0.62]), tip = add3(palm, [dx * len, -palm[1] + 0.02, dz * len]);
      lo.prims.push(...S.limb([b0, kn, tip], [0.021 * k, 0.019 * k, 0.015 * k]).map((q) => skFine(q).blend(0.012)));
      lo.prims.push(S.sphere(0.017 * k).at(kn[0], kn[1] + 0.008, kn[2]).color(C.back).pbr(0.45).blend(0.006));
      lo.hard.push(spike(add3(tip, [0, 0.008, -dz * 0.008]), [dx * 0.9, -0.12, dz * 0.9], 0.058 * k * (old ? 1.15 : 1), 0.0125 * k, C.claw, [0, -1, 0], 0.45).lod(1));
    }
  };
  if (L.front) {
    const { J, E, Wp } = L;
    up.prims.push(sk(S.capsule(J, E, 0.078 * k, 0.054 * k)));
    up.prims.push(sk(S.sphere(0.088 * k).at(J[0] - 0.01, J[1] + 0.01, J[2]).blend(0.03)));
    up.prims.push(sk(S.ellipsoid(0.052 * k, 0.1 * k, 0.066 * k).rot(-18, 0, 0).at(lerp(J[0], E[0], 0.4) + 0.012, lerp(J[1], E[1], 0.42), lerp(J[2], E[2], 0.4) - 0.042).blend(0.014)));   // triceps
    up.prims.push(sk(S.ellipsoid(0.046 * k, 0.085 * k, 0.052 * k).rot(-14, 0, 0).at(lerp(J[0], E[0], 0.45) + 0.015, lerp(J[1], E[1], 0.45), lerp(J[2], E[2], 0.45) + 0.042).blend(0.014)));  // biceps
    for (let i = 0; i < 3; i++) up.prims.push(S.ellipsoid(0.02, 0.042 * k, 0.05 * k).rot(0, 0, -10).at(J[0] + 0.062 * k + i * 0.004, J[1] + 0.03 - i * 0.062 * k, J[2] - 0.005 - i * 0.012).color(i % 2 ? C.back : C.deep).pbr(0.42).blend(0.006)); // shoulder plates
    lo.prims.push(sk(S.capsule(E, Wp, 0.053 * k, 0.036 * k)));
    lo.prims.push(sk(S.sphere(0.058 * k).at(E[0], E[1], E[2] - 0.006).blend(0.02)));
    lo.prims.push(sk(S.ellipsoid(0.04 * k, 0.07 * k, 0.045 * k).rot(20, 0, 0).at(lerp(E[0], Wp[0], 0.3) + 0.008, lerp(E[1], Wp[1], 0.3), lerp(E[2], Wp[2], 0.3) - 0.022).blend(0.02)));
    // shin plates down the front of the forearm
    for (let i = 0; i < 4; i++) {
      const f = 0.25 + i * 0.19, c = lerp3(E, Wp, f), r = lerp(0.053, 0.036, f) * k;
      lo.prims.push(S.ellipsoid(r * 0.8, 0.026, r * 0.5).rot(-18, 0, 0).at(c[0], c[1], c[2] + r * 0.72).color(C.back).pbr(0.42).blend(0.006));
    }
    const palm = [Wp[0], 0.05, Wp[2] + 0.035];
    lo.prims.push(skFine(S.ellipsoid(0.052 * k, 0.04, 0.062 * k).at(palm[0], palm[1], palm[2]).blend(0.02)));
    toes(palm);
    lo.hard.push(spike([Wp[0] - 0.04, 0.07, Wp[2] - 0.02], [-0.7, -0.5, -0.4], 0.04 * k, 0.01, C.claw, [0, -1, 0], 0.4).lod(1));                                // dewclaw
    if (old) lo.hard.push(spike([E[0] + 0.005, E[1] + 0.012, E[2] - 0.045], [0.15, 0.35, -1], 0.075, 0.016, C.horn[1], [0, 1, 0], 0.3).lod(1));                 // elbow spur
  } else {
    const { J, E, Hk, Wp } = L;
    up.prims.push(sk(S.capsule(J, E, 0.098 * k, 0.062 * k)));
    up.prims.push(sk(S.sphere(0.1 * k).at(J[0] - 0.012, J[1], J[2]).blend(0.03)));
    up.prims.push(sk(S.ellipsoid(0.07 * k, 0.14 * k, 0.115 * k).rot(28, 0, -4).at(lerp(J[0], E[0], 0.42) + 0.014, lerp(J[1], E[1], 0.42), lerp(J[2], E[2], 0.42) - 0.012).blend(0.02)));     // thigh
    for (let i = 0; i < 4; i++) up.prims.push(S.ellipsoid(0.02, 0.04 * k, 0.055 * k).rot(24, 0, -8).at(J[0] + 0.07 * k + i * 0.003, J[1] + 0.045 - i * 0.058 * k, J[2] + 0.0 + i * 0.022).color(i % 2 ? C.back : C.deep).pbr(0.42).blend(0.006));  // haunch plates
    up.prims.push(sk(S.ellipsoid(0.045 * k, 0.07 * k, 0.05 * k).at(E[0], E[1] + 0.03, E[2] + 0.02).blend(0.025)));                                                                         // knee
    lo.prims.push(sk(S.capsule(E, Hk, 0.058 * k, 0.034 * k)));
    lo.prims.push(sk(S.sphere(0.063 * k).at(E[0], E[1], E[2]).blend(0.02)));
    lo.prims.push(sk(S.ellipsoid(0.04 * k, 0.075 * k, 0.05 * k).rot(-48, 0, 0).at(lerp(E[0], Hk[0], 0.3), lerp(E[1], Hk[1], 0.3) + 0.004, lerp(E[2], Hk[2], 0.3) - 0.03).blend(0.02)));      // calf
    lo.prims.push(skFine(S.capsule(Hk, Wp, 0.034 * k, 0.036 * k).blend(0.015)));
    lo.prims.push(skFine(S.sphere(0.04 * k).at(Hk[0], Hk[1], Hk[2] - 0.004).blend(0.012)));
    for (let i = 0; i < 3; i++) {
      const f = 0.2 + i * 0.28, c = lerp3(Hk, Wp, f);
      lo.prims.push(S.ellipsoid(0.03, 0.02, 0.018).rot(30, 0, 0).at(c[0], c[1], c[2] + 0.03).color(C.back).pbr(0.42).blend(0.006));
    }
    const palm = [Wp[0], 0.048, Wp[2] + 0.04];
    lo.prims.push(skFine(S.ellipsoid(0.054 * k, 0.04, 0.066 * k).at(palm[0], palm[1], palm[2]).blend(0.02)));
    toes(palm);
    lo.hard.push(spike([Hk[0], Hk[1] + 0.01, Hk[2] - 0.03], [0, 0.45, -1], old ? 0.07 : 0.04, old ? 0.015 : 0.011, old ? C.horn[1] : C.claw, [0, 1, 0], 0.3).lod(1));     // hock spur
  }
  return { up, lo };
}

/** both wings, spread: arm (shoulder S -> elbow -> wrist W) and hand (fingers from W). Left wing authored at +X. */
function dragonWing(K, C, sk, old) {
  const k = K.wing;
  const Sh = [0.105, 0.77, 0.2];
  const E = add3(Sh, mul3([0.3, 0.16, -0.12], k));
  const W = add3(E, mul3([0.32, 0.14, 0.22], k));
  const tips = [[0.7, 0.1, -0.06], [0.62, -0.05, -0.54], [0.36, -0.17, -0.88], [0.0, -0.25, -0.9]].map((d) => add3(W, mul3(d, k)));
  const hip = [0.13, 0.69, -0.42];
  const cA = rgb(C.wingA), cB = rgb(C.wingB), cBone = rgb(C.wingBone), cVein = mixRgb(rgb(C.wingA), [0, 0, 0], 0.25);
  const build = (side) => {
    // side only changes the damage: the elder's wings are torn differently left and right
    const arm = { prims: [], hard: [] }, tip = { prims: [], hard: [] };
    const bk = (q) => sk(q).color(C.wingBone);
    arm.prims.push(bk(S.capsule(Sh, E, 0.06 * k, 0.042 * k)));
    arm.prims.push(bk(S.ellipsoid(0.058 * k, 0.05 * k, 0.085 * k).rot(0, -20, 28).at(...lerp3(Sh, E, 0.32)).blend(0.03)));
    arm.prims.push(bk(S.ellipsoid(0.04 * k, 0.036 * k, 0.06 * k).rot(0, -20, 28).at(...add3(lerp3(Sh, E, 0.6), [0, -0.012, -0.03])).blend(0.02)));
    arm.prims.push(bk(S.sphere(0.047 * k).at(...E).blend(0.02)));
    arm.prims.push(bk(S.capsule(E, W, 0.042 * k, 0.03 * k).blend(0.02)));
    arm.prims.push(bk(S.ellipsoid(0.036 * k, 0.034 * k, 0.07 * k).rot(-18, 36, 0).at(...lerp3(E, W, 0.3)).blend(0.02)));
    arm.prims.push(bk(S.sphere(0.036 * k).at(...W).blend(0.015)));
    tip.prims.push(bk(S.sphere(0.036 * k).at(...W)));
    // fingers: long tapering bones with a knuckle
    const bows = [[0, 0.03, 0.05], [0.03, 0.035, 0.03], [0.04, 0.03, 0], [0.03, 0.02, 0]].map((b) => mul3(b, k));
    const finger = tips.map((t, i) => lineFn(W, t, bows[i]));
    finger.forEach((f) => {
      const pts = [0, 0.2, 0.45, 0.72, 1].map((u) => f(u));
      tip.hard.push(H.tube(pts, [0.021, 0.016, 0.013, 0.009, 0.0035].map((r) => r * (0.6 + 0.4 * k)), 14, 6).color(C.wingBone).pbr(0.5).lod(1));
      tip.hard.push(H.tube([pts[0], pts[2], pts[4]], [0.014, 0.009, 0.002], 4, 3).color(C.wingBone).pbr(0.5));
      tip.hard.push(H.sphere(0.016 * (0.6 + 0.4 * k), 8).at(...f(0.45)).color(C.wingBone).pbr(0.5).lod(1));
      tip.hard.push(spike(f(1), norm3(sub3(f(1), f(0.9))), 0.05 * k, 0.007, C.claw, [0, -1, 0], 0.3).lod(1));
    });
    const col = (panel) => (u, v) => {
      const between = 1 - Math.pow(Math.abs(v - 0.5) * 2, 1.7);            // 0 on the bones, 1 midway
      let c3 = mixRgb(cA, cB, clamp(0.1 + 0.9 * between * (0.3 + 0.7 * smooth(u * 1.25))));
      const n = noise3(u * 4.2 + panel * 5.3 + side * 2.1, v * 3.3 + panel, 0.7);
      c3 = mixRgb(c3, cA, clamp((n - 0.52) * 2.4) * 0.5);                   // darker blotches
      if (u > 0.84) c3 = mixRgb(c3, cA, ((u - 0.84) / 0.16) * 0.8);          // weathered rim
      return c3;
    };
    const veins = (m, list) => list.map(([v0, v1, u1]) => H.tube([0.14, 0.4, 0.66, u1].map((u, i) => m.surf(u, lerp(v0, v1, i / 3))), [0.0055, 0.0045, 0.0032, 0.0012], 9, 4)
      .shade(() => cVein).color(C.wingA).pbr(0.6).lod(0));
    for (let i = 0; i < 3; i++) {
      const torn = old && ((side > 0 && i === 1) || (side < 0 && i === 2));
      const m = membrane(finger[i], finger[i + 1], {
        nu: 12, nv: 8, scallop: 0.2 + (torn ? 0.07 : 0), billow: 0.045 * k, col: col(i),
        edge: torn ? (v) => 0.3 * Math.exp(-Math.pow((v - (side > 0 ? 0.62 : 0.35)) / 0.12, 2)) : null,
        hole: old && side < 0 && i === 0 ? (u, v) => u > 0.5 && u < 0.7 && v > 0.4 && v < 0.7 : null,
      });
      tip.hard.push(m, veins(m, [[0.2, 0.3, 0.93], [0.5, 0.46, 0.8], [0.8, 0.7, 0.93]]));
    }
    // arm membrane: from the hand's inner finger across to the flank, with a narrow leading skin ahead of the elbow
    const body = lineFn(add3(Sh, [-0.01, -0.03, 0.03]), hip);
    const am = membrane(finger[3], body, {
      nu: 10, nv: 9, scallop: 0.16, billow: 0.04 * k, col: (u, v) => col(3)(0.2 + u * 0.8, v * 0.62 + 0.3),
      edge: old && side > 0 ? (v) => 0.22 * Math.exp(-Math.pow((v - 0.4) / 0.1, 2)) : null,
    });
    arm.hard.push(am, veins(am, [[0.15, 0.2, 0.93], [0.36, 0.4, 0.9], [0.58, 0.6, 0.86], [0.8, 0.78, 0.9]]));
    arm.hard.push(membrane(lineFn(Sh, E), lineFn(Sh, W, [0, 0, 0.05]), { nu: 6, nv: 3, scallop: 0, billow: 0.006, col: () => mixRgb(cA, cBone, 0.4) }));
    // thumb claw on the wrist
    arm.hard.push(spike(add3(W, [0, 0.012, 0.018]), [0.25, 0.5, 1], 0.1 * k, 0.017 * k, C.claw, [0, -1, 0], 0.5).lod(1));
    return { arm, tip };
  };
  return { S: Sh, W, left: build(1), right: build(-1) };
}

function dragonTailEnd(n, at, r, C, old) {
  if (old) {
    // a mace of bone: four blades and a spike
    n.prims.push(S.ellipsoid(r * 1.5, r * 1.5, 0.05).at(at[0], at[1], at[2] - 0.035).color(C.back).bump(0.004, 30, 'scales').blend(0.02));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, d = [Math.cos(a), Math.sin(a), -0.55];
      n.hard.push(spike(add3(at, [d[0] * r * 0.8, d[1] * r * 0.8, -0.03]), d, 0.13, 0.024, C.horn[1], [0, 0, -1], 0.35, 0.55).shade((x, y) => (y > 0.6 ? C.horn[2] : y < 0.15 ? C.horn[0] : null)));
    }
    n.hard.push(spike(add3(at, [0, 0, -0.05]), [0, 0.05, -1], 0.16, 0.022, C.horn[1], [0, 1, 0], 0.1).shade((x, y) => (y > 0.6 ? C.horn[2] : null)));
  } else {
    // a leaf-shaped fin
    const half = [[0.012, 0], [0.03, 0.025], [0.062, 0.07], [0.082, 0.125], [0.07, 0.14], [0.05, 0.165], [0.028, 0.21], [0, 0.26]];
    const out = [...half, ...half.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
    const a = rgb(C.spine[0]), b = rgb(C.spine[1]);
    n.hard.push(H.extrude(out, 0.012, 0.006).rot(-90, 0, 0).at(at[0], at[1], at[2] + 0.01)
      .shade((x, y) => mixRgb(a, b, clamp(Math.abs(x) / 0.08 * 0.8 + (y > 0.2 ? (y - 0.2) * 8 : 0)))).color(C.spine[0]).pbr(0.5));
    n.hard.push(H.tube([[0, 0, 0.02], [0, 0.004, -0.1], [0, 0, -0.24]].map((q) => add3(at, q)), [r * 0.9, 0.012, 0.003], 8, 6).color(C.spine[1]).pbr(0.5).lod(1));
  }
}

// ---------------- dragon animator ----------------
function dragonAnim(rig, inner, c, base) {
  const { R, keys } = base;
  const s = inner.scale.y || 1, t = c.t, ph = c.phase || 0, fly = !!c.flying, a = c.atk;
  const L = rig.legs || [], Sh = rig.shins || [], W = rig.wings || [], WT = rig.wingtips || [], NX = rig.necks || [], T = rig.tail || [];
  const idle = Math.sin(t * 1.4 + ph), idle2 = Math.sin(t * 0.83 + ph * 1.7);
  const k = c.moving && !fly ? 1 : 0, gait = t * 7.5 + ph;
  let n0 = idle * 0.03, n1 = idle * 0.02, n2 = -idle * 0.02, hx = -idle * 0.03, hy = idle2 * 0.12, jaw = 0.02 + 0.02 * Math.max(0, idle2);
  let py = 0, pz = 0, pitch = 0, flare = 0;
  if (fly) { n0 = 0.42 + idle * 0.03; n1 = 0.3; n2 = -0.12; hx = -0.42; hy = idle2 * 0.08; }
  if (a >= 0) {
    // fire breath: the neck coils back, then whips forward with the jaws wide
    const rear = keys(a, [[0, 0], [0.32, 1], [0.5, -1], [0.78, -0.85], [1, 0]]);
    n0 += rear > 0 ? -0.3 * rear : -0.5 * rear; n1 += rear > 0 ? -0.34 * rear : -0.3 * rear; n2 += rear > 0 ? -0.1 * rear : -0.22 * rear;
    hx += rear > 0 ? 0.5 * rear : 0.62 * rear;
    hy *= 0.2;
    jaw = keys(a, [[0, 0.02], [0.3, 0.14], [0.46, 0.72], [0.78, 0.66], [1, 0.02]]);
    pz = keys(a, [[0, 0], [0.32, -0.06], [0.5, 0.14], [0.8, 0.1], [1, 0]]);
    pitch = keys(a, [[0, 0], [0.32, -0.07], [0.5, 0.06], [1, 0]]);
    flare = keys(a, [[0, 0], [0.32, 1], [0.6, 0.7], [1, 0]]);
  }
  R(rig.neck, n0); R(NX[0], n1, hy * 0.3); R(NX[1], n2, hy * 0.4); R(rig.head, hx, hy * 0.5); R(rig.jaw, jaw);

  // legs
  for (let i = 0; i < L.length; i++) {
    const front = i < 2, sg = i === 0 || i === 3 ? 1 : -1;
    if (fly) {
      const d = Math.sin(t * 2.1 + i * 1.3 + ph) * 0.05;
      if (front) { R(L[i], 1.05 + d); R(Sh[i], -1.5 - d); } else { R(L[i], 1.0 + d, 0, 0); R(Sh[i], 0.35 + d); }
      continue;
    }
    const sw = Math.sin(gait) * sg, lift = Math.max(0, Math.cos(gait) * sg);
    R(L[i], -sw * 0.42 * k + (a >= 0 && front ? -0.1 * flare : 0));
    R(Sh[i], k * lift * (front ? -0.55 : 0.7) + k * sw * 0.12);
  }
  R(rig.torso, (a >= 0 ? -0.05 * flare : 0) + (fly ? 0 : idle * 0.008), Math.sin(gait) * 0.035 * k, 0);

  // wings: beat in flight, half-folded and mantled on the ground
  const rate = 8.4 / Math.sqrt(s), beat = t * rate + ph;
  W.forEach((w, i) => {
    const sg = (w.userData.rest?.[3] ?? (i ? -1 : 1)) >= 0 ? 1 : -1;
    if (fly) {
      const f = Math.sin(beat);
      R(w, 0, sg * (0.06 + 0.1 * Math.cos(beat)), sg * (0.1 + f * 0.58));
      R(WT[i], 0, sg * (0.12 - 0.16 * Math.cos(beat - 0.5)), sg * (Math.sin(beat - 1.0) * 0.5 - 0.05));
    } else {
      const br = idle * 0.03, open = flare * 0.5;
      R(w, 0.12 * (1 - open), sg * (0.62 - 0.4 * open), sg * (0.62 + br + 0.1 * open));
      R(WT[i], 0, sg * (1.15 - 0.75 * open), sg * (-0.5 + 0.3 * open - br));
    }
  });

  // tail
  T.forEach((seg, i) => {
    const wave = Math.sin(t * (k || fly ? 4.2 : 1.7) + ph - i * 0.75);
    const lift = fly ? [-0.12, -0.2, -0.16, -0.08, 0.05][i] ?? 0 : 0;
    R(seg, lift + Math.sin(t * 1.3 + ph - i * 0.6) * 0.03 + (a >= 0 ? -0.06 * flare : 0), wave * (fly ? 0.07 : 0.11 + 0.05 * k), 0);
  });

  const dead = base.die(inner, c, true);
  inner.position.z = pz * s;
  if (dead) {
    const f = Math.min(1, c.dead * 2);
    inner.position.y += f * 0.2 * s;                                          // a body this big lies on its flank, not half in the ground
    R(rig.neck, 0.5 * f); R(NX[0], 0.45 * f); R(NX[1], 0.3 * f); R(rig.head, -0.2 * f, 0, 0.3 * f); R(rig.jaw, 0.5 * f);
    W.forEach((w, i) => { const sg = (w.userData.rest?.[3] ?? (i ? -1 : 1)) >= 0 ? 1 : -1; R(w, 0.1, sg * 0.5 * f, sg * (0.62 - 0.5 * f)); R(WT[i], 0, sg * 1.0 * f, sg * -0.3 * f); });
    for (let i = 0; i < L.length; i++) { R(L[i], (i < 2 ? -0.5 : 0.4) * f); R(Sh[i], (i < 2 ? 0.5 : 0.6) * f); }
    T.forEach((seg, i) => R(seg, 0.1 * f, 0.1 * f * (i % 2 ? 1 : -1), 0));
    return;
  }
  if (fly) {
    inner.rotation.x = -0.06 + pitch;
    inner.position.y = Math.cos(beat) * 0.045 * s;
  } else {
    inner.rotation.x = pitch;
    inner.position.y = k * Math.abs(Math.sin(gait)) * 0.02 * s;
  }
}

// =====================================================================================
//  STONE GOLEM
// =====================================================================================

function stonePalette(o, garg) {
  const stone = o.stone ?? (garg ? 0x6a6a72 : 0x8a8580);
  return {
    stone, light: tone(stone, 0.01, 0.0, 0.075), dark: tone(stone, -0.01, 0.01, -0.1), warm: tone(stone, 0.03, 0.05, 0.02), cool: tone(stone, 0.5, 0.0, -0.03),
    core: garg ? 0x2a2a30 : 0x3b3530, gap: garg ? 0x121216 : 0x1c1713,
    glow: garg ? 0xff4a1c : 0xffa82e, hot: garg ? 0xffb060 : 0xffd27a,
    moss: 0x4f6d28, moss2: 0x7b983a, lichen: 0xb9b46a, rust: 0xb8743a, vine: 0x3f5424,
  };
}

// glyphs of the golem-wrights: strokes in a unit square, [x0, y0, x1, y1]
const GLYPHS = {
  fork: [[0.5, 0, 0.5, 1], [0.5, 0.55, 0.92, 0.95], [0.5, 0.28, 0.08, 0.68]],
  gate: [[0.14, 0, 0.14, 1], [0.86, 0, 0.86, 1], [0.14, 1, 0.86, 0.58]],
  bolt: [[0.18, 1, 0.82, 0.64], [0.82, 0.64, 0.18, 0.36], [0.18, 0.36, 0.82, 0]],
  eye: [[0.5, 0, 1, 0.5], [1, 0.5, 0.5, 1], [0.5, 1, 0, 0.5], [0, 0.5, 0.5, 0], [0.44, 0.5, 0.56, 0.5]],
  peak: [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.26, 0.48, 0.74, 0.48]],
  root: [[0.5, 1, 0.5, 0.36], [0.5, 0.36, 0.08, 0], [0.5, 0.36, 0.92, 0]],
  bar: [[0.5, 0, 0.5, 1]],
};
/** engrave a glowing glyph into whatever surface lies at c; the face normal is local +Z turned by rotv (degrees) */
function rune(name, c, size, rotv, color, glow = 1.7, w = 0.017, depth = 0.1) {
  return GLYPHS[name].map(([x0, y0, x1, y1]) => {
    const dx = (x1 - x0) * size, dy = (y1 - y0) * size, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) / DEG;
    return S.box(len + w, w, depth, w * 0.45).rot(0, 0, ang).at(((x0 + x1) / 2 - 0.5) * size, ((y0 + y1) / 2 - 0.5) * size, 0)
      .rot(rotv[0], rotv[1], rotv[2]).at(c[0], c[1], c[2]).color(color).glow(glow).pbr(0.5).paint(0.0035, -0.007);
  });
}
/** a thin dark crack: a slab that always meets the surface, engraved */
const crack = (c, rotv, len, color, w = 0.008, depth = 0.1) => S.box(len, w, depth, 0.003).rot(rotv[0], rotv[1], rotv[2]).at(c[0], c[1], c[2]).color(color).paint(0.003, -0.005);
/** flat-shaded crystal: a six-sided prism with a point at each end, along +Y, base at the origin */
function crystalGeo(sides = 6, waist = 0.3, tip = 0.72) {
  return cached(`crystal${sides}:${waist}:${tip}`, () => {
    const g = new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(1, waist), new THREE.Vector2(0.92, tip), new THREE.Vector2(0.001, 1)], sides).toNonIndexed();
    g.computeVertexNormals();
    return g;
  });
}
const crystal = (r, h, color, sides, waist, tip) => H.geo(crystalGeo(sides, waist, tip)).scale(r, h, r).color(color);

/**
 * Knock n flat chips off the stone standing at c (half-size hs; round = it is an ellipsoid): corners and edges, each a
 * planar cut. A cut carves everything built before it, so neighbours inside the chip lose a corner too.
 */
function chips(c, hs, n, rnd, depth = 0.035, round = false) {
  const out = [], size = clamp(depth * 3.6, 0.07, 0.16);
  for (let i = 0; i < n; i++) {
    const sx = rnd() > 0.5 ? 1 : -1, sy = rnd() > 0.35 ? 1 : -1, sz = rnd() > 0.5 ? 1 : -1;
    const edge = rnd() > 0.6;                                             // some chips take an edge instead of a corner
    const d = norm3([sx * (0.6 + rnd() * 0.6), sy * (edge ? 0.05 : 0.5 + rnd() * 0.6), sz * (0.6 + rnd() * 0.6)]);
    const reach = round ? Math.hypot(d[0] * hs[0], d[1] * hs[1], d[2] * hs[2]) : Math.abs(d[0]) * hs[0] + Math.abs(d[1]) * hs[1] + Math.abs(d[2]) * hs[2];
    const at = add3(c, mul3(d, reach - depth * (0.5 + rnd()) + size / 2));
    out.push(orient(S.box(size, size, size, 0.002), at, d).cut(0.005));
  }
  return out;
}

function golem(def, o = {}) {
  if (o.wings) return gargoyle(def, o);
  const C = stonePalette(o, false);
  const rnd = rng(hashStr((def?.id || 'golem') + ':stone'));
  const shades = [C.stone, C.light, C.dark, C.warm, C.cool, C.stone];
  let si = 0;
  const rock = (p, amp = 0.02, freq = 13, kind = 'noise') => p.color(shades[si++ % shades.length]).bump(amp, freq, kind).tint(0.28, 8).pbr(0.93, 0);
  const fine = (p) => rock(p, 0.01, 22, 'noise');
  /** a fitted block: box of full size sz at c, turned by rotv, with n chips knocked off */
  const block = (sz, c, rotv = [0, 0, 0], n = 3, amp, freq) => [
    rock(S.box(sz[0], sz[1], sz[2], Math.min(0.022, Math.min(sz[0], sz[1], sz[2]) * 0.22)).rot(rotv[0], rotv[1], rotv[2]).at(c[0], c[1], c[2]), amp, freq).blend(0.004),
    ...chips(c, [sz[0] / 2, sz[1] / 2, sz[2] / 2], n, rnd, Math.min(0.04, Math.min(sz[0], sz[1], sz[2]) * 0.3)),
  ];
  const seam = (c, rotv, size = [0.7, 0.02, 0.7], glow = 0) => { const q = S.box(size[0], size[1], size[2], 0.004).rot(rotv[0], rotv[1], rotv[2]).at(c[0], c[1], c[2]).cut(0.006).color(glow ? mix(C.gap, C.glow, 0.3) : C.gap); if (glow) q.glow(glow); return q; };
  const inner = (p, glow = 0) => { p.color(C.core).pbr(0.85).blend(0); if (glow) p.color(mix(C.core, C.glow, 0.3)).glow(glow); return p; };
  const moss = (c, r, raise = 0.008) => S.ellipsoid(r[0], r[1], r[2]).at(c[0], c[1], c[2]).color(rnd() > 0.5 ? C.moss : mix(C.moss, C.moss2, 0.5)).tint(0.45, 30).pbr(1).paint(0.016, raise);
  const tuft = (c, r) => S.ellipsoid(r, r * 0.7, r).at(c[0], c[1], c[2]).color(rnd() > 0.5 ? C.moss2 : C.moss).bump(0.008, 34, 'noise').tint(0.4, 30).pbr(1).blend(0.012);
  const lichen = (c, r) => S.sphere(r).at(c[0], c[1], c[2]).color(rnd() > 0.6 ? C.rust : C.lichen).tint(0.3, 40).pbr(1).paint(0.006);
  const nodes = [];
  const root = node('root', null, [0, 0, 0]); nodes.push(root);

  // ---------------- legs ----------------
  const HIP = [0.128, 0.36, 0], KNEE = [0.138, 0.2, 0.005];
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const X = (v) => (side > 0 ? v : mirX(v));
    const leg = node(`leg${nm}`, 'root', X(HIP), { rig: 'legs', detail: 0.95 });
    const shin = node(`shin${nm}`, `leg${nm}`, X(KNEE), { rig: 'shins', detail: 0.95 });
    const lp = [], sp = [];
    si = side > 0 ? 1 : 3;
    lp.push(block([0.17, 0.165, 0.2], [0.138, 0.275, 0.0], [4, side * 6, 3], 3));
    lp.push(block([0.065, 0.12, 0.16], [0.218, 0.285, 0.0], [0, 0, -6], 2));                                  // outer thigh slab
    lp.push(seam([0.14, 0.29, 0.0], [10, 0, 22], [0.4, 0.016, 0.4]));
    lp.push(inner(S.sphere(0.078).at(HIP[0], HIP[1] - 0.01, 0)));
    lp.push(inner(S.capsule([HIP[0], HIP[1], 0], [KNEE[0], KNEE[1], 0], 0.045)));
    sp.push(rock(S.cone(0.118, 0.085, 0.165, 0.02).at(0.142, 0.118, 0.0)));                                   // shin, flaring to the foot
    sp.push(block([0.115, 0.1, 0.065], [0.14, 0.195, 0.09], [-12, 0, 0], 2));                                 // knee cap
    sp.push(block([0.21, 0.08, 0.27], [0.148, 0.042, 0.03], [0, 0, 0], 3));                                   // foot slab
    for (let i = 0; i < 3; i++) sp.push(fine(S.box(0.058, 0.066 - (i === 1 ? 0 : 0.008), 0.09, 0.016).rot(6, (i - 1) * 8, 0).at(0.083 + i * 0.066, 0.036, 0.2)).blend(0.004)); // toes
    sp.push(seam([0.14, 0.09, 0.0], [-6, 0, 4], [0.4, 0.016, 0.5]));
    sp.push(inner(S.sphere(0.066).at(KNEE[0], KNEE[1], KNEE[2])));
    sp.push(inner(S.box(0.13, 0.04, 0.22, 0.015).at(0.148, 0.04, 0.05)));
    sp.push(inner(S.capsule([0.14, 0.2, 0], [0.142, 0.06, 0], 0.05)));
    sp.push(moss([0.15, 0.088, 0.1], [0.08, 0.03, 0.07], 0.006), lichen([0.25, 0.1, 0.02], 0.03), lichen([0.2, 0.16, 0.08], 0.022));
    lp.push(lichen([0.25, 0.3, 0.05], 0.03), crack([0.2, 0.28, 0.1], [0, 30, 60], 0.12, C.gap));
    leg.prims = side > 0 ? lp : mirrorPrims(lp); shin.prims = side > 0 ? sp : mirrorPrims(sp);
    nodes.push(leg, shin);
  }

  // ---------------- torso ----------------
  const torso = node('torso', 'root', [0, 0.36, 0], { rig: 'torso', detail: 0.82, rot: [9, 0, 0] }); nodes.push(torso);
  {
    const T = torso.prims; si = 0;
    T.push(block([0.31, 0.15, 0.215], [0, 0.375, 0], [0, 0, 0], 4));                                           // pelvis
    T.push(block([0.25, 0.095, 0.2], [0, 0.487, 0.0], [0, 7, 2], 3));                                          // waist stones
    T.push(block([0.2, 0.07, 0.17], [0, 0.558, 0.005], [0, -9, -2], 2));
    T.push(block([0.59, 0.3, 0.33], [0, 0.705, 0.0], [5, 0, 0], 6, 0.02, 10));                                 // the great chest block
    for (const sd of [1, -1]) T.push(S.box(0.2, 0.3, 0.5, 0.002).rot(0, 0, sd * 27).at(sd * 0.35, 0.56, 0).cut(0.006));   // hewn in under the ribs
    T.push(rock(S.ellipsoid(0.27, 0.14, 0.2).at(0, 0.825, -0.07)).blend(0.03));                                // hump of the upper back
    T.push(...chips([0, 0.825, -0.07], [0.27, 0.14, 0.2], 5, rnd, 0.04, true));
    for (const sd of [1, -1]) {
      T.push(block([0.24, 0.185, 0.08], [sd * 0.14, 0.716, 0.168], [7, sd * -7, sd * -4], 2));                 // breast slabs
      T.push(block([0.095, 0.19, 0.25], [sd * 0.237, 0.595, -0.01], [0, 0, sd * 13], 2));                      // flank stones
      T.push(block([0.2, 0.2, 0.07], [sd * 0.15, 0.695, -0.165], [-5, sd * 8, sd * 6], 2));                    // shoulder-blade slabs
    }
    T.push(block([0.13, 0.19, 0.045], [0, 0.29, 0.122], [-7, 0, 0], 1, 0.008, 20));                            // keystone tablet hung at the hips
    // seams between the fitted stones
    T.push(seam([0, 0.438, 0], [0, 0, 3], [0.6, 0.018, 0.6], 0.45), seam([0, 0.528, 0], [3, 0, -4], [0.6, 0.016, 0.6]), seam([0, 0.597, 0], [-2, 0, 2], [0.6, 0.018, 0.6], 0.45));
    T.push(seam([0, 0.72, 0.2], [0, 0, 90], [0.3, 0.022, 0.14]));                                              // between the breast slabs
    T.push(seam([0.0, 0.75, -0.2], [0, 0, 90], [0.3, 0.02, 0.1]));                                             // between the shoulder blades
    T.push(seam([0.19, 0.84, 0], [0, 12, 64], [0.34, 0.016, 0.7]), seam([-0.16, 0.85, 0], [0, -20, -58], [0.34, 0.016, 0.7]));
    // the heart socket, lit from within
    T.push(S.sphere(0.084).at(0, 0.712, 0.212).cut(0.012).color(mix(C.core, C.glow, 0.55)).glow(0.9));
    // dark heartwood of the construct, seen in every gap
    T.push(inner(S.box(0.46, 0.2, 0.2, 0.04).rot(5, 0, 0).at(0, 0.705, -0.005)));
    T.push(inner(S.capsule([0, 0.4, 0], [0, 0.62, 0], 0.07)));
    T.push(inner(S.box(0.22, 0.08, 0.13, 0.03).at(0, 0.375, 0)));
    // rune work: a ring round the heart, glyphs on the breast, the tablet and down the back
    T.push(S.cyl(0.12, 0.14, 0).rot(90 + 7, 0, 0).at(0, 0.712, 0.21).color(C.glow).glow(1.7).paint(0.0035, -0.007));
    T.push(S.cyl(0.103, 0.16, 0).rot(90 + 7, 0, 0).at(0, 0.712, 0.21).color(C.stone).tint(0.2, 6.5).pbr(0.93).paint(0.0035, 0.007));
    T.push(rune('bolt', [0.17, 0.74, 0.21], 0.075, [7, -7, -4], C.glow), rune('peak', [-0.17, 0.74, 0.21], 0.075, [7, 7, 4], C.glow));
    T.push(rune('eye', [0, 0.29, 0.15], 0.075, [-7, 0, 0], C.glow));
    T.push(rune('fork', [0, 0.8, -0.24], 0.075, [0, 180, 0], C.glow), rune('gate', [0.15, 0.69, -0.2], 0.07, [-5, 188, 6], C.glow), rune('root', [-0.15, 0.69, -0.2], 0.07, [-5, 172, -6], C.glow));
    // weathering
    T.push(crack([0.2, 0.66, 0.2], [0, 0, 62], 0.2, C.gap), crack([0.24, 0.62, 0.16], [0, 20, 20], 0.1, C.gap), crack([-0.1, 0.8, -0.2], [0, 0, 40], 0.22, C.gap), crack([-0.26, 0.74, 0.1], [0, 70, 80], 0.16, C.gap));
    T.push(moss([0.02, 0.955, -0.08], [0.24, 0.05, 0.17], 0.012), moss([-0.2, 0.89, -0.14], [0.1, 0.07, 0.1], 0.01), moss([0.2, 0.85, -0.19], [0.07, 0.12, 0.06]), moss([-0.05, 0.6, -0.14], [0.09, 0.05, 0.05], 0.006));
    T.push(moss([0.13, 0.455, 0.02], [0.05, 0.025, 0.12], 0.006), moss([-0.3, 0.83, 0.02], [0.04, 0.09, 0.12], 0.006));
    for (const [x, y, z, r] of [[0.1, 0.955, -0.02, 0.05], [-0.08, 0.96, -0.12, 0.06], [0.16, 0.93, -0.17, 0.045], [-0.2, 0.93, -0.06, 0.04]]) T.push(tuft([x, y, z], r));
    for (const [x, y, z, r] of [[0.26, 0.78, 0.13, 0.034], [-0.22, 0.62, 0.17, 0.03], [0.1, 0.61, 0.18, 0.022], [-0.28, 0.66, -0.1, 0.036], [0.2, 0.56, -0.12, 0.03], [0.05, 0.37, 0.12, 0.022], [-0.12, 0.42, -0.1, 0.03]]) T.push(lichen([x, y, z], r));
    // vines trailing from the mossy shoulders, with a few leaves
    const vine = (pts, r = 0.0055) => H.tube(pts, [r, r * 0.9, r * 0.7, r * 0.35], 12, 5).color(C.vine).pbr(0.9).lod(1);
    const vines = [
      [[0.22, 0.92, 0.02], [0.27, 0.85, 0.17], [0.2, 0.7, 0.225], [0.23, 0.56, 0.2]],
      [[-0.1, 0.94, -0.02], [-0.2, 0.89, 0.16], [-0.27, 0.74, 0.19], [-0.25, 0.6, 0.14]],
      [[0.05, 0.94, -0.2], [0.08, 0.85, -0.29], [0.02, 0.7, -0.225], [0.06, 0.56, -0.2]],
      [[-0.18, 0.92, -0.18], [-0.23, 0.81, -0.25], [-0.2, 0.68, -0.21], [-0.24, 0.6, -0.16]],
    ];
    for (const v of vines) {
      torso.hard.push(vine(v));
      const cv = curve(v, 6);
      for (let i = 2; i < 6; i++) {
        const q = cv[i], sgn = i % 2 ? 1 : -1;
        torso.hard.push(H.sphere(1, 6).scale(0.019, 0.004, 0.012).rot(20 * sgn, 40 * sgn + i * 30, 25).at(q[0] + sgn * 0.012, q[1], q[2] + (q[2] > 0 ? 0.008 : -0.008)).color(i % 2 ? C.moss2 : C.moss).pbr(0.8).lod(0));
      }
    }
  }
  // the heart: an ember crystal held in the socket
  const core = node('core', 'torso', [0, 0.712, 0.18], { rig: 'core' }); nodes.push(core);
  core.hard.push(crystal(0.046, 0.12, 0xffa030, 6, 0.36, 0.64).at(0, -0.06, 0).rot(0, 20, 0).at(0, 0.712, 0.182).glow(1.25).pbr(0.2));
  for (let i = 0; i < 3; i++) core.hard.push(crystal(0.017, 0.055, 0xff8a20, 5, 0.3, 0.7).rot(55, i * 120 + 30, 0).at(0, 0.712, 0.182).glow(1.2).pbr(0.2).lod(1));

  // ---------------- head: a carved idol's face ----------------
  const head = node('head', 'torso', [0, 0.84, 0.05], { rig: 'head', detail: 1.4, rot: [-5, 0, 0] }); nodes.push(head);
  {
    const Hd = head.prims; si = 1;
    Hd.push(rock(S.box(0.17, 0.15, 0.17, 0.022).rot(6, 0, 0).at(0, 0.905, 0.085), 0.01, 20));                  // skull block
    Hd.push(...chips([0, 0.905, 0.085], [0.085, 0.075, 0.085], 2, rnd, 0.02));
    Hd.push(S.box(0.15, 0.04, 0.05, 0.006).at(0, 0.908, 0.172).cut(0.006).color(C.gap));                       // the eye trough under the brow
    Hd.push(fine(S.box(0.21, 0.05, 0.09, 0.014).rot(13, 0, 0).at(0, 0.95, 0.152)).blend(0.004));                // brow slab
    Hd.push(fine(S.box(0.19, 0.068, 0.135, 0.018).rot(-4, 0, 0).at(0, 0.826, 0.128)).blend(0.004));             // lantern jaw
    Hd.push(fine(S.box(0.04, 0.085, 0.05, 0.01).rot(-10, 0, 0).at(0, 0.896, 0.176)).blend(0.004));              // nose ridge
    for (const sd of [1, -1]) {
      Hd.push(fine(S.box(0.045, 0.105, 0.115, 0.012).rot(0, 0, sd * -7).at(sd * 0.098, 0.887, 0.085)).blend(0.004));   // cheek plates
      Hd.push(fine(S.cone(0.021, 0.011, 0.075, 0.006).rot(8, 0, sd * -8).at(sd * 0.078, 0.888, 0.18)).blend(0.004));   // tusk pegs rising from the jaw
    }
    Hd.push(seam([0, 0.866, 0.14], [-4, 0, 0], [0.3, 0.011, 0.2]));                                             // the mouth line
    Hd.push(inner(S.box(0.13, 0.11, 0.12, 0.02).at(0, 0.9, 0.085)));
    Hd.push(moss([0.01, 1.0, 0.04], [0.085, 0.04, 0.08], 0.01), moss([-0.08, 0.96, 0.02], [0.04, 0.05, 0.07], 0.006), lichen([0.09, 0.84, 0.16], 0.02));
    Hd.push(tuft([0.02, 0.99, 0.03], 0.04), tuft([-0.04, 0.985, 0.08], 0.03));
    Hd.push(crack([0.05, 0.92, 0.0], [0, 90, 50], 0.14, C.gap, 0.007));
    for (const sd of [1, -1]) head.hard.push(H.sphere(1, 14).scale(0.022, 0.009, 0.014).rot(0, 0, sd * -14).at(sd * 0.045, 0.908, 0.162).color(0xffb040).glow(1.8).pbr(0.3));
    head.hard.push(crystal(0.011, 0.03, 0xffa030, 4, 0.5, 0.5).rot(103, 0, 0).at(0, 0.956, 0.19).glow(1.3).pbr(0.2).lod(1));   // gem set in the brow
  }

  // ---------------- arms ----------------
  const SHO = [0.345, 0.765, 0], ELB = [0.38, 0.555, 0];
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const X = (v) => (side > 0 ? v : mirX(v));
    const arm = node(`arm${nm}`, 'torso', X(SHO), { rig: 'arms', detail: 0.9, rot: [-14, 0, 0] });
    const fore = node(`fore${nm}`, `arm${nm}`, X(ELB), { rig: 'forearms', detail: 1 });
    const ap = [], fp = [];
    si = side > 0 ? 2 : 0;
    const big = side > 0 ? 1.1 : 1;                                                                           // the left shoulder stone is the larger
    ap.push(rock(S.ellipsoid(0.165 * big, 0.15 * big, 0.175 * big).at(0.375, 0.815, 0.0), 0.02, 10));
    ap.push(rock(S.box(0.2 * big, 0.14, 0.24 * big, 0.03).rot(side * 5, 12, -20).at(0.39, 0.84, 0.0), 0.02, 10).blend(0.02));
    ap.push(...chips([0.38, 0.82, 0], [0.175 * big, 0.155 * big, 0.185 * big], 8, rnd, 0.04, true));
    ap.push(block([0.135, 0.165, 0.15], [0.37, 0.635, 0.0], [0, side * -8, 3], 3));                           // upper arm
    ap.push(seam([0.37, 0.722, 0], [0, 0, -8], [0.5, 0.018, 0.5], 0.4));
    ap.push(seam([0.42, 0.85, 0.0], [20, 30, 70], [0.3, 0.014, 0.6]));
    ap.push(inner(S.sphere(0.085).at(0.36, 0.79, 0)), inner(S.capsule(SHO, ELB, 0.045)));
    ap.push(rune('gate', [0.5, 0.82, 0.0], 0.075, [0, 90, -18], C.glow));
    ap.push(moss([0.39, 0.95 * (side > 0 ? 1.01 : 1), 0.0], [0.13, 0.05, 0.13], 0.012), moss([0.46, 0.88, -0.1], [0.06, 0.08, 0.06], 0.007), lichen([0.47, 0.76, 0.1], 0.03), lichen([0.43, 0.62, 0.06], 0.022));
    ap.push(tuft([0.36, 0.95, -0.05], 0.05), tuft([0.44, 0.93, 0.04], 0.04));
    ap.push(crack([0.42, 0.8, 0.14], [0, 20, 50], 0.16, C.gap));
    // forearm: a great tapered block bound with slabs, ending in a fist
    fp.push(rock(S.cone(0.118, 0.088, 0.225, 0.02).at(0.385, 0.425, 0.005)));
    fp.push(block([0.052, 0.2, 0.18], [0.487, 0.43, 0.005], [0, 0, 3], 2, 0.008, 20));                          // outer bracer slab
    fp.push(block([0.16, 0.18, 0.048], [0.385, 0.43, -0.11], [-3, 0, 0], 2, 0.01, 18));                         // back slab
    fp.push(block([0.16, 0.14, 0.045], [0.385, 0.445, 0.116], [4, 0, 0], 2, 0.01, 18));                         // front slab
    fp.push(fine(S.torus(0.105, 0.024).at(0.386, 0.322, 0.006)).blend(0.005));                                 // wrist ring
    fp.push(block([0.2, 0.12, 0.2], [0.39, 0.255, 0.01], [0, side * 4, 0], 3));                                // back of the fist
    for (let i = 0; i < 4; i++) fp.push(fine(S.box(0.044, 0.105 - (i % 3 === 0 ? 0.012 : 0), 0.075, 0.016).rot(-8 + i * 2, 0, (i - 1.5) * 2).at(0.315 + i * 0.051, 0.215, 0.105 + (i % 3 === 0 ? -0.008 : 0))).blend(0.003)); // curled fingers
    fp.push(fine(S.box(0.07, 0.07, 0.12, 0.022).rot(0, -18, 0).at(0.292, 0.262, 0.07)).blend(0.005));           // thumb
    fp.push(inner(S.sphere(0.072).at(ELB[0], ELB[1], ELB[2]), 0.3));
    fp.push(inner(S.capsule([0.385, 0.52, 0.005], [0.388, 0.26, 0.015], 0.05)));
    fp.push(inner(S.box(0.15, 0.08, 0.15, 0.02).at(0.39, 0.235, 0.03)));
    fp.push(rune('fork', [0.515, 0.475, 0.005], 0.07, [0, 90, 3], C.glow), rune('root', [0.515, 0.385, 0.005], 0.07, [0, 90, 3], C.glow));
    fp.push(moss([0.36, 0.545, -0.03], [0.07, 0.035, 0.07], 0.006), lichen([0.45, 0.3, 0.1], 0.028), lichen([0.4, 0.2, -0.09], 0.03), crack([0.42, 0.25, 0.1], [0, 0, 35], 0.12, C.gap));
    arm.prims = side > 0 ? ap : mirrorPrims(ap); fore.prims = side > 0 ? fp : mirrorPrims(fp);
    if (side > 0) {
      // standing stones and a tuft of grass on the great shoulder
      for (const [x, y, z, h, rx, rz, ry] of [[0.4, 0.96, -0.04, 0.17, 8, -16, 20], [0.33, 0.96, 0.05, 0.11, -10, 6, -30], [0.47, 0.93, 0.05, 0.085, 6, -30, 50]]) {
        arm.prims.push(fine(S.cone(0.03, 0.016, h, 0.008).rot(rx, ry, rz).at(x, y + h / 2 - 0.02, z)).blend(0.006));
      }
      for (let i = 0; i < 9; i++) {
        const a = i * 0.9, r0 = 0.03 + (i % 3) * 0.012;
        arm.hard.push(H.tube([[0.37 + Math.cos(a) * r0, 0.965, 0.1 + Math.sin(a) * r0 * 0.6], [0.37 + Math.cos(a) * r0 * 1.8, 1.01 + (i % 2) * 0.02, 0.1 + Math.sin(a) * r0 * 1.2], [0.37 + Math.cos(a) * r0 * 3, 1.03 + (i % 3) * 0.012, 0.1 + Math.sin(a) * r0 * 2]], [0.004, 0.003, 0.0008], 5, 3).color(i % 2 ? C.moss2 : 0x93a84a).pbr(0.9).lod(0));
      }
    }
    nodes.push(arm, fore);
  }
  return { kind: 'golem', attack: 'slam', nodes: finish(nodes) };
}

// =====================================================================================
//  GARGOYLE: a winged demon carved from weathered stone
// =====================================================================================

function gargoyle(def, o = {}) {
  const C = stonePalette({ ...o, stone: tone(o.stone ?? 0x6a6a72, 0, -0.01, 0.1) }, true);
  const rnd = rng(hashStr((def?.id || 'gargoyle') + ':carve'));
  const st = (p) => p.color(C.stone).bump(0.007, 19, 'noise').tint(0.34, 24).pbr(0.92, 0);
  const dk = (p) => st(p).color(C.dark);
  const groove = (a, b, r = 0.006, depth = 0.004) => S.capsule(a, b, r).color(C.dark).paint(0.004, -depth);     // a chiselled line
  const stain = (c, r) => S.ellipsoid(r[0], r[1], r[2]).at(c[0], c[1], c[2]).color(rnd() > 0.4 ? mix(C.light, 0xdedccf, 0.6) : mix(C.dark, 0x2a2c30, 0.5)).tint(0.25, 30).pbr(1).paint(0.012);   // rain streaks, pale and sooty
  const lichen = (c, r) => S.sphere(r).at(c[0], c[1], c[2]).color(rnd() > 0.55 ? 0x9aa05a : 0xb9b46a).tint(0.3, 40).pbr(1).paint(0.005);
  const moss = (c, r) => S.ellipsoid(r[0], r[1], r[2]).at(c[0], c[1], c[2]).color(C.moss).tint(0.45, 30).pbr(1).paint(0.012, 0.005);
  const nodes = [];
  nodes.push(node('root', null, [0, 0, 0]));
  const talon = (base, dir, len, r = len * 0.24) => spike(base, dir, len, r, 0x2b2b30, [0, -1, 0], 0.42).lod(1);

  // ---------------- legs: crouched haunches ----------------
  const HIP = [0.088, 0.37, -0.03], KNEE = [0.118, 0.268, 0.118], ANK = [0.1, 0.108, -0.015];
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const X = (v) => (side > 0 ? v : mirX(v));
    const leg = node(`leg${nm}`, 'root', X(HIP), { rig: 'legs', detail: 1.05 });
    const shin = node(`shin${nm}`, `leg${nm}`, X(KNEE), { rig: 'shins', detail: 1.1 });
    const lp = [], sp = [], sh = [];
    lp.push(st(S.capsule(HIP, KNEE, 0.074, 0.05)));
    lp.push(st(S.sphere(0.078).at(HIP[0] + 0.004, HIP[1] + 0.004, HIP[2] - 0.012).blend(0.03)));
    lp.push(st(S.ellipsoid(0.058, 0.09, 0.07).rot(-52, 0, 0).at(0.112, 0.335, 0.06).blend(0.022)));              // thigh
    lp.push(st(S.ellipsoid(0.04, 0.06, 0.045).rot(-52, 0, 0).at(0.1, 0.29, 0.02).blend(0.018)));                 // hamstring
    lp.push(groove([0.165, 0.36, 0.02], [0.155, 0.285, 0.12], 0.005));
    sp.push(st(S.capsule(KNEE, ANK, 0.047, 0.03)));
    sp.push(st(S.sphere(0.052).at(KNEE[0], KNEE[1], KNEE[2] + 0.004).blend(0.02)));
    sp.push(st(S.ellipsoid(0.036, 0.062, 0.04).rot(40, 0, 0).at(0.11, 0.21, 0.045).blend(0.018)));               // calf
    sp.push(dk(S.ellipsoid(0.02, 0.022, 0.02).at(KNEE[0], KNEE[1] + 0.012, KNEE[2] + 0.04).blend(0.01)));        // knee boss
    // foot: a long instep down to three splayed toes and a spur
    const ball = [0.102, 0.036, 0.055];
    sp.push(st(S.capsule(ANK, ball, 0.03, 0.03).blend(0.015)));
    sp.push(st(S.sphere(0.033).at(ANK[0], ANK[1], ANK[2] - 0.004).blend(0.012)));
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 0.42, d = [Math.sin(a), 0, Math.cos(a)];
      const kn = add3(ball, [d[0] * 0.05, 0.012, d[2] * 0.05]), tip = add3(ball, [d[0] * 0.088, -0.018, d[2] * 0.088]);
      sp.push(...S.limb([ball, kn, tip], [0.02, 0.017, 0.013]).map((q) => st(q).blend(0.01)));
      sh.push(talon(add3(tip, [0, 0.006, -d[2] * 0.004]), [d[0], -0.18, d[2]], 0.05));
    }
    sh.push(talon([ANK[0], ANK[1] - 0.012, ANK[2] - 0.024], [0, -0.3, -1], 0.04));
    sp.push(groove([0.14, 0.24, 0.1], [0.126, 0.14, 0.01], 0.004), lichen([0.14, 0.2, 0.06], 0.018));
    leg.prims = side > 0 ? lp : mirrorPrims(lp); shin.prims = side > 0 ? sp : mirrorPrims(sp);
    shin.hard = side > 0 ? sh : sh.map((q) => q.mirrorX());
    nodes.push(leg, shin);
  }

  // ---------------- torso ----------------
  const torso = node('torso', 'root', [0, 0.37, -0.03], { rig: 'torso', detail: 1.15 }); nodes.push(torso);
  {
    const T = torso.prims;
    T.push(st(S.ellipsoid(0.112, 0.078, 0.092).at(0, 0.385, -0.03)));                                            // pelvis
    T.push(st(S.ellipsoid(0.098, 0.09, 0.082).at(0, 0.475, 0.004).blend(0.04)));                                 // belly
    T.push(st(S.ellipsoid(0.148, 0.122, 0.116).rot(22, 0, 0).at(0, 0.592, 0.045).blend(0.045)));                 // rib cage
    T.push(st(S.ellipsoid(0.17, 0.062, 0.092).at(0, 0.672, 0.03).blend(0.035)));                                 // shoulder yoke
    T.push(st(S.capsule([0, 0.655, 0.06], [0, 0.775, 0.148], 0.06, 0.05).blend(0.03)));                          // bull neck
    T.push(...S.mirrorX([
      st(S.ellipsoid(0.072, 0.052, 0.036).rot(-12, 14, 8).at(0.068, 0.624, 0.142).blend(0.014)),                // breast
      st(S.ellipsoid(0.05, 0.085, 0.06).rot(0, 0, 14).at(0.118, 0.555, -0.02).blend(0.022)),                    // flank
      st(S.ellipsoid(0.055, 0.07, 0.03).rot(8, -20, -10).at(0.07, 0.61, -0.06).blend(0.02)),                    // shoulder blade
      st(S.capsule([0.03, 0.7, 0.03], [0.14, 0.675, 0.05], 0.036, 0.03).blend(0.022)),                          // trapezius
      st(S.ellipsoid(0.04, 0.045, 0.045).at(0.06, 0.385, -0.085).blend(0.02)),                                  // rump
    ]));
    // carved anatomy: breastbone, three ribs a side, the belly's blocks, the spine's knuckles
    T.push(groove([0, 0.66, 0.158], [0, 0.565, 0.165], 0.006, 0.005));
    for (let i = 0; i < 3; i++) T.push(...S.mirrorX([groove([0.03, 0.545 - i * 0.034, 0.15 - i * 0.012], [0.13, 0.575 - i * 0.04, 0.07 - i * 0.008], 0.0055, 0.0045)]));
    T.push(groove([0, 0.545, 0.142], [0, 0.42, 0.1], 0.005, 0.004));
    for (let i = 0; i < 3; i++) T.push(groove([-0.06, 0.52 - i * 0.04, 0.1 - i * 0.012], [0.06, 0.52 - i * 0.04, 0.1 - i * 0.012], 0.0045, 0.0035));
    for (let i = 0; i < 7; i++) T.push(dk(S.ellipsoid(0.014, 0.014, 0.012).at(0, 0.69 - i * 0.048, -0.045 - Math.sin((i / 6) * Math.PI) * 0.03 - (i > 4 ? (i - 4) * 0.012 : 0)).blend(0.008)));
    T.push(rune('eye', [0, 0.61, 0.17], 0.04, [-10, 0, 0], C.glow, 1.4, 0.009, 0.05));                              // the binding mark, still smouldering
    // weathering: cracks, rain streaks, lichen, moss in the hollows
    T.push(crack([0.07, 0.56, 0.1], [0, 20, 58], 0.15, C.gap, 0.006), crack([0.1, 0.5, 0.06], [0, 40, 20], 0.07, C.gap, 0.005), crack([-0.05, 0.6, -0.08], [0, 0, -40], 0.14, C.gap, 0.006));
    T.push(stain([0.07, 0.6, 0.12], [0.014, 0.08, 0.05]), stain([-0.1, 0.58, 0.08], [0.012, 0.09, 0.05]), stain([-0.03, 0.6, -0.08], [0.016, 0.1, 0.05]), stain([0.1, 0.64, -0.03], [0.014, 0.07, 0.05]));
    for (const [x, y, z, r] of [[0.12, 0.62, 0.08, 0.02], [-0.08, 0.5, 0.07, 0.017], [0.06, 0.42, 0.06, 0.02], [-0.12, 0.6, -0.05, 0.024], [0.03, 0.52, -0.09, 0.02], [-0.07, 0.4, -0.1, 0.02]]) T.push(lichen([x, y, z], r));
    T.push(moss([0, 0.71, -0.03], [0.1, 0.03, 0.06]), moss([-0.09, 0.69, 0.0], [0.05, 0.035, 0.06]));
  }

  // ---------------- head ----------------
  const HO = [0, 0.775, 0.148];
  const head = node('head', 'torso', HO, { rig: 'head', detail: 1.6 }); nodes.push(head);
  {
    const Hd = head.prims, hh = head.hard;
    Hd.push(st(S.ellipsoid(0.076, 0.07, 0.086).at(0, 0.822, 0.168)));                                            // skull
    Hd.push(st(S.ellipsoid(0.05, 0.04, 0.056).at(0, 0.797, 0.24).blend(0.03)));                                  // muzzle
    Hd.push(st(S.ellipsoid(0.03, 0.022, 0.024).rot(-20, 0, 0).at(0, 0.806, 0.29).blend(0.014)));                 // upturned nose
    Hd.push(...S.mirrorX([
      st(S.capsule([0.008, 0.836, 0.256], [0.074, 0.862, 0.2], 0.019, 0.024).blend(0.01)),                       // scowling brow
      st(S.ellipsoid(0.022, 0.02, 0.032).at(0.06, 0.797, 0.215).blend(0.014)),                                  // cheekbone
      st(S.ellipsoid(0.03, 0.035, 0.04).at(0.055, 0.782, 0.165).blend(0.02)),                                   // jaw muscle
      st(S.ellipsoid(0.016, 0.018, 0.024).rot(0, 20, 0).at(0.03, 0.782, 0.275).blend(0.008)),                   // snarling lip
      // bat ears: a tall pointed shell
      st(S.capsule([0.066, 0.84, 0.14], [0.135, 0.925, 0.1], 0.026, 0.005).blend(0.012)),
      st(S.capsule([0.07, 0.82, 0.135], [0.14, 0.875, 0.095], 0.02, 0.005).blend(0.012)),
      S.capsule([0.082, 0.846, 0.152], [0.128, 0.9, 0.118], 0.012, 0.003).cut(0.006).color(C.dark),
    ]));
    for (let i = 0; i < 5; i++) Hd.push(dk(S.ellipsoid(0.011, 0.012 + i * 0.0015, 0.016).at(0, 0.892 - i * 0.004, 0.2 - i * 0.034).blend(0.006)));   // crest
    Hd.push(...S.mirrorX([S.ellipsoid(0.021, 0.015, 0.02).rot(0, 0, 14).at(0.038, 0.824, 0.242).cut(0.006).color(C.gap)]));   // eye pits
    Hd.push(...S.mirrorX([S.ellipsoid(0.006, 0.005, 0.01).rot(0, 30, 0).at(0.012, 0.806, 0.306).cut(0.004).color(C.gap)]));  // nostrils
    // snarl: the mouth cut open, a lower jaw hung beneath it
    Hd.push(S.ellipsoid(0.04, 0.017, 0.045).at(0, 0.772, 0.262).cut(0.007).color(mix(C.gap, C.glow, 0.25)).glow(0.5));
    Hd.push(st(S.ellipsoid(0.04, 0.018, 0.05).at(0, 0.748, 0.238).blend(0.008)));                                // lower jaw
    Hd.push(st(S.ellipsoid(0.02, 0.016, 0.02).at(0, 0.742, 0.278).blend(0.01)));                                 // chin
    Hd.push(st(S.cone(0.014, 0.004, 0.05, 0.003).rot(160, 0, 0).at(0, 0.722, 0.287).blend(0.008)));              // chin spike
    Hd.push(S.ellipsoid(0.03, 0.012, 0.035).at(0, 0.764, 0.262).cut(0.005).color(mix(C.gap, C.glow, 0.25)).glow(0.5));
    Hd.push(dk(S.ellipsoid(0.014, 0.006, 0.026).at(0, 0.757, 0.26).blend(0.004)));                               // tongue
    Hd.push(...S.mirrorX([groove([0.048, 0.81, 0.245], [0.03, 0.788, 0.285], 0.004, 0.003)]));                   // snarl lines
    Hd.push(crack([0.04, 0.86, 0.15], [0, 60, 30], 0.09, C.gap, 0.005), stain([0.03, 0.83, 0.2], [0.01, 0.05, 0.05]), stain([-0.05, 0.8, 0.19], [0.01, 0.05, 0.04]), lichen([-0.04, 0.88, 0.14], 0.016), moss([0.01, 0.89, 0.12], [0.03, 0.02, 0.04]));
    for (const sd of [1, -1]) {
      hh.push(H.sphere(0.0095, 14).at(sd * 0.037, 0.824, 0.233).color(0xff5a1c).glow(1.7).pbr(0.3));
      // fangs: long uppers, tusked lowers, a row of small teeth
      hh.push(spike([sd * 0.024, 0.784, 0.286], [sd * 0.05, -1, 0.05], 0.042, 0.008, 0xd8d4c4, [0, 0, -1], 0.2).lod(1));
      hh.push(spike([sd * 0.03, 0.756, 0.272], [sd * 0.1, 1, 0.1], 0.026, 0.0065, 0xd8d4c4, [0, 0, -1], 0.2).lod(1));
      for (let i = 0; i < 3; i++) hh.push(spike([sd * (0.034 + i * 0.005), 0.781, 0.268 - i * 0.016], [sd * 0.1, -1, 0], 0.012, 0.0038, 0xcfcab8, [0, 0, -1], 0.15).lod(0));
      // ram horns curling back and round under the ears
      const pts = [[0.04, 0.872, 0.168], [0.078, 0.925, 0.115], [0.118, 0.925, 0.045], [0.142, 0.87, 0.01], [0.138, 0.805, 0.035], [0.115, 0.775, 0.08]].map((q) => [q[0] * sd, q[1], q[2]]);
      const broken = sd < 0;                                                                                    // the right horn lost its tip
      hh.push(horn(broken ? pts.slice(0, 5) : pts, 0.026, [C.dark, C.stone, C.light], { rings: 20, ripple: 0.16, rough: 0.85, tip: broken ? 0.42 : 0.06, pow: broken ? 0.55 : 0.8 }));
      Hd.push(dk(S.torus(0.025, 0.009).rot(-35, 0, sd * -35).at(sd * 0.042, 0.868, 0.166).blend(0.008)));
    }
  }

  // ---------------- arms ----------------
  const SHO = [0.178, 0.655, 0.07], ELB = [0.218, 0.472, 0.022], WRI = [0.196, 0.315, 0.125];
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const X = (v) => (side > 0 ? v : mirX(v));
    const arm = node(`arm${nm}`, 'torso', X(SHO), { rig: 'arms', detail: 1.05 });
    const fore = node(`fore${nm}`, `arm${nm}`, X(ELB), { rig: 'forearms', detail: 1.15 });
    const ap = [], fp = [], fh = [];
    ap.push(st(S.capsule(SHO, ELB, 0.052, 0.038)));
    ap.push(st(S.ellipsoid(0.064, 0.062, 0.062).at(SHO[0] + 0.004, SHO[1] + 0.004, SHO[2]).blend(0.025)));          // deltoid
    ap.push(st(S.ellipsoid(0.034, 0.07, 0.04).rot(-14, 0, 0).at(0.2, 0.57, 0.075).blend(0.014)));                  // biceps
    ap.push(st(S.ellipsoid(0.034, 0.075, 0.04).rot(-14, 0, 0).at(0.205, 0.565, 0.012).blend(0.014)));              // triceps
    ap.push(groove([0.245, 0.63, 0.06], [0.24, 0.52, 0.04], 0.0045, 0.0035), lichen([0.24, 0.6, 0.03], 0.018), stain([0.22, 0.6, 0.09], [0.012, 0.06, 0.03]));
    ap.push(moss([0.18, 0.715, 0.06], [0.05, 0.025, 0.05]));
    fp.push(st(S.capsule(ELB, WRI, 0.04, 0.028)));
    fp.push(st(S.sphere(0.043).at(ELB[0], ELB[1], ELB[2]).blend(0.02)));
    fp.push(st(S.ellipsoid(0.032, 0.06, 0.036).rot(34, 0, 0).at(0.212, 0.42, 0.06).blend(0.014)));                  // forearm muscle
    fh.push(spike([ELB[0] + 0.004, ELB[1] + 0.004, ELB[2] - 0.034], [0.1, 0.3, -1], 0.055, 0.012, 0x3a3a42, [0, 1, 0], 0.3).lod(1));   // elbow spur
    // hand: a broad palm, three hooked fingers and a thumb
    const palm = [WRI[0], WRI[1] - 0.03, WRI[2] + 0.012];
    fp.push(st(S.ellipsoid(0.03, 0.036, 0.022).rot(20, 0, 0).at(palm[0], palm[1], palm[2]).blend(0.015)));
    for (let i = 0; i < 3; i++) {
      const dx = (i - 1) * 0.02, b0 = add3(palm, [dx, -0.024, 0.008]), k1 = add3(palm, [dx * 1.5, -0.058, 0.03]), tip = add3(palm, [dx * 1.7, -0.092, 0.018]);
      fp.push(...S.limb([b0, k1, tip], [0.0125, 0.011, 0.009]).map((q) => st(q).blend(0.006)));
      fp.push(dk(S.sphere(0.0125).at(k1[0], k1[1], k1[2] + 0.003).blend(0.004)));
      fh.push(talon(tip, [dx * 2, -1, -0.25], 0.04, 0.008));
    }
    const t0 = add3(palm, [-0.028, 0.0, 0.01]), t1 = add3(palm, [-0.048, -0.03, 0.03]), t2 = add3(palm, [-0.046, -0.058, 0.03]);
    fp.push(...S.limb([t0, t1, t2], [0.013, 0.011, 0.009]).map((q) => st(q).blend(0.006)));
    fh.push(talon(t2, [0.1, -1, -0.1], 0.034, 0.0075));
    fp.push(groove([0.235, 0.44, 0.07], [0.215, 0.35, 0.13], 0.004, 0.003), lichen([0.2, 0.38, 0.12], 0.015), crack([0.2, 0.42, 0.07], [0, 30, 70], 0.07, C.gap, 0.005));
    arm.prims = side > 0 ? ap : mirrorPrims(ap); fore.prims = side > 0 ? fp : mirrorPrims(fp);
    fore.hard = side > 0 ? fh : fh.map((q) => q.mirrorX());
    nodes.push(arm, fore);
  }

  // ---------------- wings: thick ribbed slabs of stone ----------------
  {
    const R0 = [0.072, 0.672, -0.075], EL = [0.2, 0.87, -0.165], WR = [0.36, 1.0, -0.13];
    const tips = [[0.76, 0.95, -0.19], [0.71, 0.66, -0.26], [0.52, 0.44, -0.29], [0.27, 0.36, -0.22]];
    const base = [0.075, 0.47, -0.11];
    const bows = [[0, 0.03, 0], [0.03, 0.01, 0], [0.03, -0.01, 0], [0.02, -0.02, 0]];
    const cS = rgb(C.stone), cD = rgb(C.dark), cL = rgb(C.light), cM = rgb(C.moss), cLi = rgb(0xa9ad6e);
    const wingCol = (seed) => (u, v, p) => {
      const fold = Math.pow(Math.abs(v - 0.5) * 2, 2.5);
      let c3 = mixRgb(cL, cS, 0.15 + fold * 0.6);
      const n = fbm3(p[0] * 9 + seed, p[1] * 9, p[2] * 9 + seed * 2, 3);
      c3 = mixRgb(c3, n > 0.5 ? cL : cD, Math.abs(n - 0.5) * 1.1);
      const groove = Math.abs(Math.sin(v * Math.PI * 6));                        // chisel lines fanning along the web
      if (groove < 0.3) c3 = mixRgb(c3, cD, (0.3 - groove) * 1.2 * Math.min(1, u * 3));
      const li = noise3(p[0] * 5.3 + 4 + seed, p[1] * 5.3, 7.7);
      if (li > 0.62) c3 = mixRgb(c3, cLi, (li - 0.62) * 2.2);
      if (u > 0.88) c3 = mixRgb(c3, cL, (u - 0.88) * 5);                       // worn pale along the chipped edge
      if (p[1] > 0.9 && noise3(p[0] * 7, 3.3, p[2] * 7 + seed) > 0.5) c3 = mixRgb(c3, cM, 0.6);
      return c3;
    };
    for (const side of [1, -1]) {
      const nm = side > 0 ? 'L' : 'R';
      const w = node(`wing${nm}`, 'torso', side > 0 ? R0 : mirX(R0), { rig: 'wings', detail: 1.0 });
      const wp = [], wh = [];
      wp.push(st(S.capsule(R0, EL, 0.04, 0.03)), st(S.sphere(0.034).at(...EL).blend(0.015)), st(S.capsule(EL, WR, 0.03, 0.024).blend(0.015)), st(S.sphere(0.028).at(...WR).blend(0.012)));
      wp.push(st(S.ellipsoid(0.04, 0.05, 0.04).at(...lerp3(R0, EL, 0.3)).blend(0.02)));
      const finger = tips.map((t, i) => lineFn(WR, t, bows[i]));
      finger.forEach((f, i) => {
        const pts = [0, 0.25, 0.5, 0.75, 1].map((u) => f(u));
        wh.push(H.tube(pts, [0.022, 0.018, 0.015, 0.011, 0.005], 12, 7).shade((x, y, z) => mixRgb(cD, cS, noise3(x * 30, y * 30, z * 30))).color(C.dark).pbr(0.9).lod(1));
        wh.push(H.tube([pts[0], pts[2], pts[4]], [0.016, 0.011, 0.003], 4, 4).color(C.dark).pbr(0.9));
        if (i < 3) wh.push(spike(f(1), norm3(sub3(f(1), f(0.9))), 0.045, 0.008, 0x3a3a42, [0, -1, 0], 0.3).lod(1));
      });
      const slab = (A, B, k, opt = {}) => {
        // two skins and a rim: a membrane with real thickness
        const nrm = [0.1, 0.12, 1], th = 0.026;
        const front = membrane(A, B, { nu: 9, nv: 12, scallop: 0.2, billow: 0.03, up: nrm, col: wingCol(k + side), rough: 0.92, ...opt });
        const back = membrane((u) => add3(A(u), [0, 0, -th]), (u) => add3(B(u), [0, 0, -th]), { nu: 9, nv: 12, scallop: 0.2, billow: 0.03, up: nrm, col: wingCol(k + side + 9), rough: 0.92, ...opt });
        const rim = membrane((v) => front.surf(1, v), (v) => back.surf(1, v), { nu: 12, nv: 1, scallop: 0, billow: 0, col: () => cL, rough: 0.92 });
        const far = membrane(A, B, { nu: 4, nv: 3, scallop: 0.24, billow: 0.03, up: [nrm[0], nrm[1], nrm[2] - 0.45], col: wingCol(k + side), rough: 0.92, ...opt });   // the one skin left at distance, tucked between the two
        return [front.lod(1), back.lod(1), rim.lod(1), far];
      };
      for (let i = 0; i < 3; i++) wh.push(slab(finger[i], finger[i + 1], i, side < 0 && i === 1 ? { edge: (v) => 0.32 * Math.exp(-Math.pow((v - 0.45) / 0.16, 2)) } : {}));
      wh.push(slab(finger[3], lineFn(add3(R0, [0, 0.02, 0]), base), 3, { scallop: 0.14 }));
      wh.push(slab(lineFn(R0, EL), lineFn(R0, WR, [0, 0.03, 0]), 4, { nu: 5, nv: 2, scallop: 0, billow: 0.004 }).slice(0, 3));
      wh.push(spike(add3(WR, [0, 0.01, 0.01]), [0.1, 1, 0.5], 0.07, 0.013, 0x3a3a42, [0, 0, 1], 0.4).lod(1));    // wrist claw
      w.prims = side > 0 ? wp : mirrorPrims(wp);
      w.hard = side > 0 ? flat(wh) : flat(wh).map((q) => q.mirrorX());
      nodes.push(w);
    }
  }

  // ---------------- tail ----------------
  {
    const TP = [[0, 0.365, -0.115], [0, 0.265, -0.3], [0, 0.175, -0.48], [0, 0.185, -0.66]], tr = [0.044, 0.032, 0.021, 0.012];
    const cS = rgb(C.stone), cD = rgb(C.dark);
    for (let i = 0; i < 3; i++) {
      const n = node(`tail${i}`, i === 0 ? 'torso' : `tail${i - 1}`, TP[i], { rig: 'tail' });
      n.prims.push(st(S.capsule(TP[i], TP[i + 1], tr[i], tr[i + 1])));
      for (let k = 0; k < 3; k++) { const c = lerp3(TP[i], TP[i + 1], (k + 0.5) / 3), r = lerp(tr[i], tr[i + 1], (k + 0.5) / 3); n.prims.push(dk(S.ellipsoid(r * 0.4, r * 0.4, r * 0.55).at(c[0], c[1] + r * 0.85, c[2]).blend(0.006))); }
      if (i === 0) n.prims.push(lichen([0.03, 0.31, -0.2], 0.016));
      if (i === 2) {
        const half = [[0.008, 0], [0.03, 0.03], [0.052, 0.085], [0.03, 0.075], [0.016, 0.11], [0, 0.15]];
        const out = [...half, ...half.slice(0, -1).reverse().map(([x, y]) => [-x, y])];
        n.hard.push(H.extrude(out, 0.014, 0.006).rot(-90, 0, 0).rot(8, 0, 0).at(0, 0.186, -0.655).color(C.dark).pbr(0.9).shade((x, y, z) => mixRgb(cS, cD, noise3(x * 40, y * 40, z * 40))));
      }
      nodes.push(n);
    }
  }
  return { kind: 'gargoyle', attack: 'claw', nodes: finish(nodes) };
}

function golemAnim(rig, inner, c, base) {
  base.biped(rig, inner, c);
  if (rig.core) rig.core.scale.setScalar(1 + Math.sin(c.t * 2.4 + (c.phase || 0)) * 0.08 + (c.atk >= 0 ? Math.sin(c.atk * Math.PI) * 0.35 : 0));
}

function gargoyleAnim(rig, inner, c, base) {
  const { R } = base;
  base.biped(rig, inner, c);
  const t = c.t, ph = c.phase || 0, W = rig.wings || [], A = rig.arms || [], F = rig.forearms || [];
  const dead = c.dead > 0;
  const sgn = (w, i) => ((w.userData.rest?.[3] ?? (i ? -1 : 1)) >= 0 ? 1 : -1);
  if (c.flying && !dead) {
    const beat = t * 10 + ph, f = Math.sin(beat);
    W.forEach((w, i) => { const sg = sgn(w, i); R(w, 0.25, sg * (0.1 + 0.12 * Math.cos(beat)), sg * (-0.5 + f * 0.5)); });
    if (c.atk < 0) for (let i = 0; i < 2; i++) { R(A[i], -0.65 + Math.sin(t * 2 + i) * 0.06, 0, (i ? -1 : 1) * 0.22); R(F[i], -0.95); }
    inner.rotation.x = 0.42;
    inner.position.y = Math.cos(beat) * 0.03 * (inner.scale.y || 1);
  } else if (!dead) {
    // perched: wings mantled, breathing slowly
    const br = Math.sin(t * 1.5 + ph) * 0.04;
    W.forEach((w, i) => { const sg = sgn(w, i); R(w, 0, sg * (0.25 + br), sg * (0.08 + br) + (c.atk >= 0 ? sg * -0.3 * Math.sin(c.atk * Math.PI) : 0)); });
  } else {
    W.forEach((w, i) => { const sg = sgn(w, i); R(w, 0, sg * 0.5, sg * 0.3); });
  }
}

// =====================================================================================
//  ELEMENTALS: the fire elemental and the ice wraith
// =====================================================================================

const FIRE = [[0, 0xffb21e], [0.22, 0xff8a14], [0.48, 0xf2590c], [0.72, 0xc22a08], [1, 0x6a0e05]];
function ramp(stops, t) {
  t = clamp(t);
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) return mixRgb(rgb(stops[i - 1][1]), rgb(stops[i][1]), (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return rgb(stops[stops.length - 1][1]);
}
/** points of a licking tongue: rises h from base, leaning by lean [x, z] and swaying sideways by sway [x, z] on the way */
function lick(base, h, lean = [0, 0], sway = [0, 0], n = 5) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, w = Math.sin(u * Math.PI * 1.15);
    pts.push([base[0] + lean[0] * u * u + sway[0] * w, base[1] + h * u, base[2] + lean[1] * u * u + sway[1] * w]);
  }
  return pts;
}
/** a tongue of flame through pts: r0 at the root tapering to a point. t0..t1 pick the span of the fire ramp (0 = white-hot, 1 = dark red) */
function flame(pts, r0, opt = {}) {
  const n = pts.length - 1, out = [];
  const t0 = opt.t0 ?? 0.3, t1 = opt.t1 ?? 1, g0 = opt.g0 ?? 1.15, g1 = opt.g1 ?? 0.95, pw = opt.pow ?? 0.75, stops = opt.stops ?? FIRE;
  const rAt = (f) => r0 * Math.pow(1 - f, pw) * (1 + (opt.belly ?? 0.25) * Math.sin(f * Math.PI)) + 0.0035;
  for (let i = 0; i < n; i++) {
    const f = i / n, f2 = (i + 1) / n;
    out.push(S.capsule(pts[i], pts[i + 1], rAt(f), rAt(f2)).color(ramp(stops, lerp(t0, t1, (f + f2) / 2))).glow(lerp(g0, g1, f)).pbr(0.55).blend(opt.blend ?? 0.022));
  }
  return out;
}
/** flat-faced chunk of rock or ice: a squashed icosahedron */
function chunkGeo() { return cached('chunk', () => { const g = new THREE.IcosahedronGeometry(1, 0); g.computeVertexNormals(); return g; }); }
const chunk = (r, color) => H.geo(chunkGeo()).scale(r, r * 0.8, r * 0.9).color(color);

function fireElemental(def, o) {
  const rnd = rng(hashStr((def?.id || 'fire') + ':flame'));
  const glow = o.glow ?? 0xff6a1a;
  const stops = [[0, 0xffb21e], [0.22, 0xff8a14], [0.48, mix(glow, 0xf2500a, 0.6)], [0.72, mix(glow, 0xbe2206, 0.8)], [1, 0x6a0e05]];
  const fl = (pts, r0, opt = {}) => flame(pts, r0, { stops, ...opt });
  const BAS = 0x1d1512, BAS2 = 0x2c211b;
  const basalt = (p) => p.color(BAS).tint(0.4, 18).pbr(0.42, 0.1);
  const fissure = (c, rotv, size) => S.box(size[0], size[1], size[2], 0.002).rot(rotv[0], rotv[1], rotv[2]).at(c[0], c[1], c[2]).cut(0.004).color(0xffa028).glow(1.7);
  const molten = (p, g = 1.6) => p.color(0xffb030).glow(g).pbr(0.5).blend(0);
  const nodes = [];
  nodes.push(node('root', null, [0, 0, 0]));

  // ---------------- torso: a column of fire wrapped in rising tongues ----------------
  const TO = [0, 0.55, 0];
  const torso = node('torso', 'root', TO, { rig: 'torso', detail: 0.84 }); nodes.push(torso);
  {
    const T = torso.prims;
    T.push(S.ellipsoid(0.115, 0.2, 0.1).at(0, 0.76, 0).color(ramp(stops, 0.3)).glow(1.15).pbr(0.5));              // bright heart of the column
    T.push(S.ellipsoid(0.17, 0.115, 0.115).at(0, 0.925, 0).color(ramp(stops, 0.38)).glow(1.15).pbr(0.5).blend(0.05)); // chest
    T.push(S.ellipsoid(0.09, 0.1, 0.085).at(0, 0.6, 0).color(ramp(stops, 0.42)).glow(1.2).pbr(0.5).blend(0.05));     // waist
    // tongues climbing the body, each curling off into the air
    const NT = 12;
    for (let k = 0; k < NT; k++) {
      const a = (k / NT) * Math.PI * 2 + 0.26, ca = Math.cos(a), sa = Math.sin(a);
      const front = sa > 0.55;                                                                                  // keep the breast clear for the heart
      const y0 = 0.55 + (k % 3) * 0.07, h = front ? 0.16 : 0.3 + rnd() * 0.18 + (Math.abs(ca) > 0.7 ? 0.08 : 0), r = 0.085 + (y0 - 0.56) * 0.35;
      T.push(fl(lick([ca * r, y0, sa * r * 0.85], h, [ca * 0.12, sa * 0.1], [-sa * 0.07, ca * 0.07], 4), 0.05 + rnd() * 0.018, { t0: 0.36, t1: 1, blend: 0.018 }));
      if (k % 2) T.push(fl(lick([ca * r * 1.5, y0 + 0.16, sa * r * 1.3], 0.13, [ca * 0.07, sa * 0.06], [sa * 0.03, -ca * 0.03], 3), 0.024, { t0: 0.5, t1: 1, blend: 0.012 }));
    }
    // a gorget of cooling slag: broken plates riding the shoulders, the melt showing between them
    T.push(molten(S.torus(0.14, 0.02).rot(8, 0, 0).at(0, 0.965, -0.005), 1.4).color(ramp(stops, 0.3)));
    const NS = 11;
    for (let k = 0; k < NS; k++) {
      const a = (k / NS) * Math.PI * 2 + 0.29, ca = Math.cos(a), sa = Math.sin(a);
      if (sa > 0.8) continue;                                                                                   // open at the throat
      const b0 = [ca * 0.135, 0.955 + sa * 0.018, sa * 0.13 - 0.005], len = 0.085 + (k % 3) * 0.03 + (sa < -0.3 ? 0.03 : 0);
      const tip = add3(b0, mul3(norm3([ca * 0.8, 0.75 + (k % 2) * 0.3, sa * 0.8 - 0.1]), len));
      T.push(basalt(S.capsule(b0, tip, 0.034 - (k % 2) * 0.006, 0.006)).blend(0.004));
      T.push(basalt(S.box(0.06, 0.035, 0.045, 0.01).rot(0, -a / DEG + 90, 0).at(ca * 0.14, 0.955 + sa * 0.018, sa * 0.135 - 0.005)).blend(0.006));
    }
    T.push(basalt(S.ellipsoid(0.06, 0.07, 0.035).rot(-10, 0, 0).at(0, 0.93, -0.12)).blend(0.01));                 // spine plate
  }

  // the heart: a ball of slag with the fire showing through its cracks
  const CO = [0, 0.8, 0.1];
  const core = node('core', 'torso', CO, { rig: 'core', detail: 1.15 }); nodes.push(core);
  {
    const p = core.prims;
    p.push(basalt(S.sphere(0.094).at(...CO)));
    p.push(basalt(S.ellipsoid(0.05, 0.03, 0.04).at(CO[0] + 0.03, CO[1] + 0.05, CO[2] + 0.04)).blend(0.01), basalt(S.ellipsoid(0.04, 0.04, 0.03).at(CO[0] - 0.05, CO[1] - 0.03, CO[2] + 0.04)).blend(0.01));
    for (let i = 0; i < 9; i++) p.push(fissure(CO, [rnd() * 180, rnd() * 180, rnd() * 180], [0.011, 0.24, 0.24]).at((rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.05));
    p.push(molten(S.sphere(0.085).at(...CO), 1.8));
  }

  // ---------------- lower body: a narrowing whirl ----------------
  const TP = [[0, 0.55, 0], [0, 0.39, -0.015], [0, 0.235, 0.01], [0, 0.07, 0.03]], tr = [0.095, 0.068, 0.042, 0.006];
  for (let i = 0; i < 3; i++) {
    const n = node(`tail${i}`, i === 0 ? 'torso' : `tail${i - 1}`, TP[i], { rig: 'tail', detail: 0.76 });
    const t0 = 0.3 + i * 0.16;
    n.prims.push(S.capsule(TP[i], TP[i + 1], tr[i], tr[i + 1]).color(ramp(stops, t0)).glow(1.25 - i * 0.1).pbr(0.55));
    // ribbons of flame spiralling up round it
    for (let k = 0; k < 3; k++) {
      const a0 = k * 2.1 + i * 1.3, pts = [];
      for (let j = 0; j <= 4; j++) { const u = j / 4, a = a0 + u * 2.2, c = lerp3(TP[i + 1], TP[i], u * 1.15), r = lerp(tr[i + 1], tr[i], u) * (1.05 + 0.5 * u); pts.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]); }
      n.prims.push(fl(pts, tr[i] * 0.55, { t0: t0 + 0.12, t1: 1, blend: 0.014, pow: 0.6 }));
    }
    nodes.push(n);
  }

  // ---------------- head: a mask of slag in a crown of flame ----------------
  const HO = [0, 1.02, 0.01];
  const head = node('head', 'torso', HO, { rig: 'head', detail: 1.15 }); nodes.push(head);
  {
    const p = head.prims;
    p.push(S.ellipsoid(0.078, 0.095, 0.08).at(0, 1.1, -0.01).color(ramp(stops, 0.24)).glow(1.3).pbr(0.5));          // the fire behind the mask
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.45, ca = Math.cos(a), sa = Math.sin(a);
      if (sa > 0.75) continue;                                                                                 // none over the face
      p.push(fl(lick([ca * 0.055, 1.13, -0.02 + sa * 0.05], 0.17 + rnd() * 0.1, [ca * 0.05, sa * 0.05 - 0.03], [-sa * 0.035, ca * 0.035], 4), 0.036, { t0: 0.3, t1: 1, blend: 0.014 }));
    }
    // the mask: a long skull-plate with a furnace grate for a mouth
    p.push(basalt(S.ellipsoid(0.068, 0.085, 0.045).at(0, 1.095, 0.05)).blend(0.004));
    p.push(basalt(S.ellipsoid(0.04, 0.06, 0.036).at(0, 1.035, 0.058)).blend(0.012));                             // long jaw
    p.push(basalt(S.box(0.15, 0.034, 0.05, 0.012).rot(16, 0, 0).at(0, 1.132, 0.078)).blend(0.006));               // brow
    p.push(basalt(S.box(0.024, 0.075, 0.03, 0.008).rot(-12, 0, 0).at(0, 1.095, 0.096)).blend(0.006));             // nose ridge
    p.push(...S.mirrorX([
      basalt(S.ellipsoid(0.022, 0.045, 0.03).rot(0, 0, -10).at(0.058, 1.072, 0.058)).blend(0.006),               // cheek guard
      basalt(S.cone(0.012, 0.003, 0.075, 0.003).rot(172, 0, -10).at(0.052, 1.008, 0.06)).blend(0.006),           // jaw prong
      basalt(S.cone(0.017, 0.004, 0.13, 0.003).rot(-26, 0, -30).at(0.07, 1.2, 0.02)).blend(0.006),               // horn
      S.ellipsoid(0.026, 0.0085, 0.02).rot(0, 0, 30).at(0.034, 1.106, 0.092).cut(0.004).color(0xffd24a).glow(2),   // eye
    ]));
    for (let i = -2; i <= 2; i++) p.push(S.box(0.0085, 0.032 - Math.abs(i) * 0.005, 0.04, 0.002).at(i * 0.0155, 1.042, 0.09).cut(0.003).color(0xffa028).glow(1.8));  // grate
    p.push(fissure([0.02, 1.15, 0.07], [0, 20, 30], [0.008, 0.09, 0.08]), fissure([-0.045, 1.08, 0.06], [0, -30, -50], [0.007, 0.07, 0.08]));
    p.push(molten(S.ellipsoid(0.056, 0.072, 0.035).at(0, 1.095, 0.05)), molten(S.ellipsoid(0.03, 0.048, 0.027).at(0, 1.036, 0.058)));
    for (const q of flat(p)) q.at(-HO[0], -HO[1], -HO[2]).scale(1.22).at(HO[0], HO[1] + 0.012, HO[2] + 0.012);     // a head a little over life size
  }

  // big plumes that sway on their own
  const plume = (name, parent, base, h, lean, sway, r) => {
    const n = node(name, parent, base, { rig: 'flames', detail: 0.72 });
    n.prims.push(fl(lick(base, h, lean, sway, 6), r, { t0: 0.22, t1: 1, blend: 0.02 }));
    n.prims.push(fl(lick(add3(base, [sway[1] * 0.4 + 0.02, 0.02, -0.02]), h * 0.62, [lean[0] + 0.05, lean[1] - 0.04], [-sway[0], sway[1]], 4), r * 0.6, { t0: 0.45, t1: 1, blend: 0.014 }));
    nodes.push(n);
  };
  plume('plumeC', 'head', [0, 1.2, -0.03], 0.36, [0.02, -0.1], [0.05, 0.03], 0.062);
  plume('plumeL', 'torso', [0.12, 0.96, -0.1], 0.42, [0.12, -0.1], [-0.05, 0.04], 0.066);
  plume('plumeR', 'torso', [-0.12, 0.96, -0.1], 0.38, [-0.13, -0.09], [0.05, 0.04], 0.062);
  plume('plumeB', 'torso', [0, 0.84, -0.13], 0.4, [0.0, -0.2], [0.06, 0.0], 0.07);

  // ---------------- arms: streams of fire ending in gauntlets of slag ----------------
  const SHO = [0.215, 0.955, 0], ELB = [0.3, 0.765, 0.03], WRI = [0.285, 0.59, 0.14];
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const X = (v) => (side > 0 ? v : mirX(v));
    const arm = node(`arm${nm}`, 'torso', X(SHO), { rig: 'arms', detail: 0.85 });
    const fore = node(`fore${nm}`, `arm${nm}`, X(ELB), { rig: 'forearms', detail: 1.05 });
    const ap = [], fp = [], fh = [];
    ap.push(S.capsule(SHO, ELB, 0.052, 0.04).color(ramp(stops, 0.3)).glow(1.25).pbr(0.5));
    ap.push(S.sphere(0.06).at(...SHO).color(ramp(stops, 0.38)).glow(1.25).pbr(0.5).blend(0.03));
    for (let k = 0; k < 4; k++) {
      const c = lerp3(SHO, ELB, 0.15 + k * 0.24), a = k * 1.9;
      ap.push(fl(lick([c[0] + Math.cos(a) * 0.03, c[1], c[2] + Math.sin(a) * 0.03], 0.13 + (k % 2) * 0.05, [0.06 + Math.cos(a) * 0.03, -0.05 + Math.sin(a) * 0.03], [0.02, -0.02], 4), 0.03, { t0: 0.42, t1: 1, blend: 0.012 }));
    }
    // pauldron: a broken plate of slag riding the shoulder
    ap.push(basalt(S.ellipsoid(0.075, 0.05, 0.075).rot(0, 0, -22).at(SHO[0] + 0.025, SHO[1] + 0.045, 0)).blend(0.006));
    ap.push(basalt(S.cone(0.022, 0.006, 0.09, 0.004).rot(0, 0, -38).at(SHO[0] + 0.085, SHO[1] + 0.085, 0)).blend(0.008));
    ap.push(fissure([SHO[0] + 0.03, SHO[1] + 0.05, 0.02], [0, 35, -22], [0.01, 0.12, 0.16]), fissure([SHO[0] + 0.02, SHO[1] + 0.05, -0.03], [0, -50, -22], [0.009, 0.12, 0.14]));
    ap.push(molten(S.ellipsoid(0.066, 0.04, 0.066).rot(0, 0, -22).at(SHO[0] + 0.025, SHO[1] + 0.045, 0)));
    // gauntlet
    fp.push(S.sphere(0.045).at(...ELB).color(ramp(stops, 0.3)).glow(1.25).pbr(0.5));
    fp.push(basalt(S.capsule(lerp3(ELB, WRI, 0.18), WRI, 0.046, 0.054)).blend(0.004));
    fp.push(basalt(S.ellipsoid(0.03, 0.05, 0.035).at(...add3(lerp3(ELB, WRI, 0.35), [0.03, 0, -0.02]))).blend(0.008));
    fp.push(basalt(S.cone(0.016, 0.004, 0.075, 0.003).rot(-70, 0, -10).at(ELB[0] + 0.012, ELB[1] - 0.03, ELB[2] - 0.05)).blend(0.008));     // elbow spike
    const palm = add3(WRI, [0, -0.045, 0.02]);
    fp.push(basalt(S.ellipsoid(0.045, 0.045, 0.036).at(...palm)).blend(0.01));
    for (const [c, rv] of [[lerp3(ELB, WRI, 0.45), [20, 30, 10]], [lerp3(ELB, WRI, 0.7), [-30, -20, 60]], [lerp3(ELB, WRI, 0.85), [70, 0, 20]], [palm, [10, 70, 0]]]) fp.push(fissure(c, rv, [0.0095, 0.16, 0.16]));
    fp.push(molten(S.capsule(lerp3(ELB, WRI, 0.2), WRI, 0.038, 0.046)), molten(S.ellipsoid(0.037, 0.037, 0.028).at(...palm)));
    for (let i = 0; i < 4; i++) {
      const dx = (i - 1.5) * 0.023, b0 = add3(palm, [dx, -0.03, 0.012]), k1 = add3(palm, [dx * 1.4, -0.07, 0.04]);
      fp.push(basalt(S.capsule(b0, k1, 0.014, 0.011)).blend(0.006));
      fh.push(spike(k1, [dx * 1.5, -1, -0.15], 0.06, 0.0105, 0x120d0b, [0, 0, -1], 0.4).pbr(0.25, 0.2).lod(1));
      fh.push(H.sphere(0.0075, 6).at(k1[0], k1[1] + 0.004, k1[2]).color(0xffa028).glow(1.8).lod(1));
    }
    fp.push(basalt(S.capsule(add3(palm, [-0.04, 0.0, 0.012]), add3(palm, [-0.064, -0.035, 0.04]), 0.014, 0.011)).blend(0.006));
    fh.push(spike(add3(palm, [-0.064, -0.035, 0.04]), [-0.3, -1, 0.1], 0.05, 0.01, 0x120d0b, [0, 0, -1], 0.4).pbr(0.25, 0.2).lod(1));
    arm.prims = side > 0 ? ap : mirrorPrims(ap); fore.prims = side > 0 ? fp : mirrorPrims(fp);
    fore.hard = side > 0 ? fh : fh.map((q) => q.mirrorX());
    nodes.push(arm, fore);
    if (side < 0) {
      // the spell: a seed of fire that swells in the casting hand
      const sp = node('spell', `fore${nm}`, X(add3(palm, [0, -0.07, 0.05])), { rig: 'spell' });
      const c = X(add3(palm, [0, -0.07, 0.05]));
      sp.prims.push(S.sphere(0.05).at(...c).color(0xffe45c).glow(1.6).pbr(0.5));
      for (let k = 0; k < 5; k++) { const a = k * 1.26; sp.prims.push(fl(lick([c[0] + Math.cos(a) * 0.03, c[1], c[2] + Math.sin(a) * 0.03], 0.1, [Math.cos(a) * 0.04, Math.sin(a) * 0.04], [-Math.sin(a) * 0.03, Math.cos(a) * 0.03], 3), 0.026, { t0: 0.3, t1: 0.95, blend: 0.012 })); }
      nodes.push(sp);
    }
  }

  // ---------------- embers circling ----------------
  for (let i = 0; i < 4; i++) {
    const n = node(`ember${i}`, 'root', [0, 0.72, 0], { rig: 'shards' });
    const a = i * 1.7, r = 0.33 + (i % 2) * 0.09, y = 0.62 + i * 0.13;
    const c = [Math.cos(a) * r, y, Math.sin(a) * r];
    n.hard.push(chunk(0.036 + (i % 2) * 0.012, BAS2).rot(i * 40, i * 70, 20).at(...c).pbr(0.45, 0.1).shade((x, yy, z) => (noise3(x * 3 + i, yy * 3, z * 3) > 0.56 ? 0x5a1a08 : null)));
    n.hard.push(H.sphere(0.024 + (i % 2) * 0.008, 8).at(c[0] * 0.97, c[1] - 0.004, c[2] * 0.97).color(0xff8a20).glow(1.7));
    for (let k = 0; k < 3; k++) {
      const a2 = a + 0.5 + k * 0.5, r2 = r + (k - 1) * 0.07;
      n.hard.push(chunk(0.011 - k * 0.002, k % 2 ? 0xffc040 : 0xff7a18).rot(k * 50, k * 80, 0).at(Math.cos(a2) * r2, y + 0.08 + k * 0.07 - i * 0.03, Math.sin(a2) * r2).glow(1.8).lod(1));
    }
    nodes.push(n);
  }
  return { kind: 'fireElemental', attack: 'cast', nodes: finish(nodes) };
}

function elemental(def, o = {}) {
  const c = rgb(o.glow ?? 0xff6a1a);
  return c[2] > c[0] ? iceWraith(def, o) : fireElemental(def, o);
}
function iceWraith(def, o) {
  const rnd = rng(hashStr((def?.id || 'ice') + ':frost'));
  const glow = o.glow ?? 0x7fd4ff;
  const I = { pale: 0xd8f1ff, mid: mix(glow, 0xffffff, 0.12), deep: mix(glow, 0x1650a8, 0.72), shroud: 0x23466c, shroud2: 0x142c48, frost: 0xcfe6f2, hollow: 0x030912, eye: 0xd2f6ff };
  /** an ice crystal along +Y from the origin: flat faces, deep blue at the root, glowing pale at the tip */
  const ice = (r, h, opt = {}) => {
    const a = rgb(opt.root ?? I.deep), b = rgb(opt.tip ?? I.pale);
    const m = rgb(opt.mid ?? I.mid);
    return crystal(r, h, I.mid, opt.sides ?? 6, opt.waist ?? 0.2, opt.shoulder ?? 0.68).shade((x, y) => (y < 0.55 ? mixRgb(a, m, smooth(y / 0.55)) : mixRgb(m, b, smooth((y - 0.55) / 0.45)))).pbr(0.1, 0.05).glow(opt.glow ?? 0.32);
  };
  const shard = (base, dir, r, h, opt = {}) => orient(ice(r, h, opt).rot(0, opt.spin ?? 0, 0), base, dir, [0, 0, 1]);
  const cloth = (p) => p.color(I.shroud).bump(0.004, 24, 'noise').tint(0.28, 13).pbr(0.72, 0);
  const frost = (c, r, raise = 0.003) => S.ellipsoid(r[0], r[1], r[2]).at(c[0], c[1], c[2]).color(I.frost).tint(0.2, 36).pbr(0.85).paint(0.016, raise);
  const nodes = [];
  nodes.push(node('root', null, [0, 0, 0]));

  // ---------------- torso: a frozen shroud ----------------
  const torso = node('torso', 'root', [0, 0.6, 0], { rig: 'torso', detail: 1.0 }); nodes.push(torso);
  {
    const T = torso.prims, Th = torso.hard;
    T.push(cloth(S.ellipsoid(0.125, 0.13, 0.095).at(0, 0.9, 0)));
    T.push(cloth(S.capsule([-0.15, 0.99, -0.005], [0.15, 0.99, -0.005], 0.056).blend(0.035)));
    T.push(cloth(S.ellipsoid(0.085, 0.15, 0.075).at(0, 0.72, 0).blend(0.045)));
    // hanging folds
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.35, ca = Math.cos(a), sa = Math.sin(a);
      T.push(cloth(S.capsule([ca * 0.105, 0.93, sa * 0.075], [ca * 0.075, 0.59, sa * 0.065], 0.024, 0.02).blend(0.012)).color(k % 2 ? I.shroud : I.shroud2));
    }
    T.push(S.ellipsoid(0.2, 0.13, 0.2).at(0, 0.6, 0).color(mix(I.shroud, I.frost, 0.5)).tint(0.25, 30).pbr(0.85).paint(0.08));   // rime creeping up from the hem
    T.push(S.sphere(0.058).at(0, 0.885, 0.092).cut(0.008).color(mix(I.hollow, glow, 0.5)).glow(0.9));              // the hollow where the heart hangs
    // crystals budding from the cloth at the hip and flank
    for (const [x, y, z, dx, dy, dz, r, h] of [[0.085, 0.7, 0.03, 1, -0.35, 0.3, 0.02, 0.1], [0.08, 0.73, 0.0, 1, 0.1, -0.2, 0.016, 0.075], [0.075, 0.67, 0.05, 0.7, -0.8, 0.5, 0.013, 0.06], [-0.1, 0.84, -0.06, -1, -0.2, -0.6, 0.018, 0.085], [-0.09, 0.8, -0.07, -0.7, -0.7, -0.7, 0.013, 0.06]]) Th.push(shard([x, y, z], [dx, dy, dz], r, h, { glow: 0.45 }).lod(1));
    T.push(frost([0, 1.04, -0.01], [0.2, 0.035, 0.09], 0.004), frost([0, 0.885, 0.1], [0.085, 0.085, 0.03], 0.004), frost([0.08, 0.72, 0.06], [0.03, 0.09, 0.03]), frost([-0.07, 0.8, -0.07], [0.04, 0.1, 0.03]));
    // a breastplate of fitted crystal plates
    for (const [x, y, rz, r, h] of [[0.06, 0.985, -28, 0.03, 0.13], [-0.06, 0.985, 28, 0.03, 0.13], [0.105, 0.94, -52, 0.024, 0.1], [-0.105, 0.94, 52, 0.024, 0.1]]) {
      Th.push(ice(r, h, { sides: 4, waist: 0.3, shoulder: 0.55, glow: 0.35 }).scale(1, 1, 0.45).rot(180, 0, rz).at(x, y, 0.088));
    }
    // a mantle of spikes across the shoulders and back
    const mantle = [[0.12, 1.02, -0.03, 0.5, 1, -0.25, 0.034, 0.22], [-0.12, 1.02, -0.03, -0.5, 1, -0.25, 0.034, 0.24], [0.17, 1.0, 0.0, 1, 0.75, 0, 0.03, 0.19], [-0.17, 1.0, 0.0, -1, 0.7, 0.05, 0.03, 0.17],
      [0.06, 1.01, -0.06, 0.2, 1, -0.7, 0.03, 0.2], [-0.06, 1.01, -0.06, -0.25, 1, -0.75, 0.032, 0.26], [0, 0.95, -0.09, 0, 0.6, -1, 0.034, 0.24], [0.1, 0.92, -0.08, 0.6, 0.3, -1, 0.024, 0.15], [-0.1, 0.92, -0.08, -0.6, 0.35, -1, 0.024, 0.16],
      [0.19, 0.97, 0.02, 1, 0.2, 0.2, 0.02, 0.11], [-0.19, 0.97, 0.02, -1, 0.25, 0.15, 0.02, 0.12]];
    for (const [x, y, z, dx, dy, dz, r, h] of mantle) Th.push(shard([x, y, z], [dx, dy, dz], r, h, { sides: rnd() > 0.5 ? 6 : 5, spin: rnd() * 60 }));
    for (let k = 0; k < 8; k++) { const a = k * 0.8 + 0.3; Th.push(shard([Math.cos(a) * 0.13, 1.0 + (k % 2) * 0.01, -0.02 + Math.sin(a) * 0.06], [Math.cos(a), 1.1, Math.sin(a) - 0.3], 0.012, 0.06 + (k % 3) * 0.02, { glow: 0.6 }).lod(1)); }
  }
  // the heart crystal
  const CO = [0, 0.885, 0.075];
  const core = node('core', 'torso', CO, { rig: 'core' }); nodes.push(core);
  core.hard.push(ice(0.03, 0.105, { sides: 6, waist: 0.5, shoulder: 0.5, root: I.pale, tip: 0xffffff, glow: 1.7 }).at(0, -0.052, 0).rot(0, 15, 12).at(...CO));
  for (let i = 0; i < 3; i++) core.hard.push(ice(0.011, 0.04, { root: I.mid, tip: 0xffffff, glow: 1.4, sides: 4 }).rot(70, i * 120, 0).at(...CO).lod(1));

  // ---------------- the skirts of the shroud, then the wisp it trails instead of legs ----------------
  const TP = [[0, 0.6, 0], [0, 0.43, -0.035], [0, 0.25, -0.1], [0, 0.07, -0.05]], tr = [0.09, 0.07, 0.04, 0.004];
  for (let i = 0; i < 3; i++) {
    const n = node(`tail${i}`, i === 0 ? 'torso' : `tail${i - 1}`, TP[i], { rig: 'tail', detail: 0.95 });
    if (i === 0) {
      // the robe flares over the hips and ends in long tatters
      n.prims.push(cloth(S.capsule(TP[0], TP[1], 0.09, 0.105)));
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + 0.2, ca = Math.cos(a), sa = Math.sin(a), len = 0.1 + (k % 3) * 0.05 + (sa < 0 ? 0.05 : 0);
        const p0 = [ca * 0.085, 0.47, sa * 0.085 - 0.03], p1 = [ca * 0.11, 0.47 - len * 0.5, sa * 0.105 - 0.05], p2 = [ca * 0.1, 0.47 - len, sa * 0.095 - 0.08];
        n.prims.push(...S.limb([p0, p1, p2], [0.036, 0.026, 0.004]).map((q) => cloth(q).color(k % 2 ? I.shroud : I.shroud2).blend(0.012)));
      }
      n.prims.push(S.ellipsoid(0.2, 0.16, 0.2).at(0, 0.36, -0.05).color(mix(I.shroud, I.frost, 0.62)).tint(0.25, 30).pbr(0.85).paint(0.09));   // the tatters are white with rime
    }
    // the wisp: brighter and thinner as it falls away
    const g0 = 0.5 + i * 0.35, c0 = mix(I.deep, I.pale, 0.25 + i * 0.3);
    if (i > 0) n.prims.push(S.capsule(TP[i], TP[i + 1], tr[i] * 0.9, tr[i + 1]).color(c0).glow(g0).pbr(0.4));
    else n.prims.push(S.capsule(lerp3(TP[0], TP[1], 0.5), TP[1], 0.05, tr[1] * 0.9).color(c0).glow(g0).pbr(0.4).blend(0));
    for (let k = 0; k < 3; k++) {
      // curls of cold vapour peeling off
      const a0 = k * 2.1 + i * 1.4, pts = [];
      for (let j = 0; j <= 3; j++) { const u = j / 3, a = a0 + u * 1.8, c = lerp3(TP[i], TP[i + 1], 0.35 + u * 0.75), r = lerp(tr[i], tr[i + 1], 0.35 + u * 0.75) * (0.9 + u * 0.9) + 0.01; pts.push([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r]); }
      if (i > 0 || k === 0) n.prims.push(...S.limb(pts, [tr[i] * 0.4, tr[i] * 0.32, tr[i] * 0.2, 0.003]).map((q) => q.color(mix(c0, 0xffffff, 0.3)).glow(g0 + 0.2).pbr(0.4).blend(0.014)));
    }
    for (let k = 0; k < 3; k++) { const a = k * 2.3 + i, c = lerp3(TP[i], TP[i + 1], 0.3 + k * 0.25), r = lerp(tr[i], tr[i + 1], 0.3 + k * 0.25) + 0.03; n.hard.push(shard([c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r], [Math.cos(a), -0.6, Math.sin(a)], 0.009, 0.05, { glow: 0.7 }).lod(1)); }
    nodes.push(n);
  }

  // ---------------- head: a deep hood with nothing in it but two cold lights ----------------
  const HO = [0, 1.03, 0];
  const head = node('head', 'torso', HO, { rig: 'head', detail: 1.45 }); nodes.push(head);
  {
    const p = head.prims, hh = head.hard;
    p.push(cloth(S.ellipsoid(0.105, 0.125, 0.118).at(0, 1.135, -0.005)));
    p.push(cloth(S.capsule([0, 1.2, -0.05], [0, 1.255, -0.19], 0.058, 0.01).blend(0.03)));                        // the cowl's drooping point
    p.push(cloth(S.ellipsoid(0.135, 0.06, 0.105).at(0, 1.045, -0.02).blend(0.035)));                             // hood spreading onto the shoulders
    p.push(...S.mirrorX([cloth(S.capsule([0.07, 1.19, 0.06], [0.1, 1.04, 0.06], 0.026, 0.03).blend(0.02))]));    // heavy front edges
    p.push(S.ellipsoid(0.084, 0.11, 0.03).at(0, 1.12, 0.1).color(mix(I.frost, I.shroud, 0.35)).tint(0.2, 36).pbr(0.85).paint(0.008, 0.003));   // rime round the opening
    p.push(S.ellipsoid(0.064, 0.094, 0.085).at(0, 1.115, 0.075).cut(0.008).color(I.hollow));                      // the hollow
    p.push(S.ellipsoid(0.04, 0.058, 0.026).at(0, 1.1, 0.008).color(mix(I.hollow, I.deep, 0.06)).pbr(0.6).blend(0.004));   // a gaunt shape far back in the dark
    p.push(frost([0, 1.25, -0.03], [0.07, 0.03, 0.09], 0.004), frost([0, 1.22, -0.16], [0.035, 0.03, 0.06]), frost([0.08, 1.1, -0.06], [0.03, 0.07, 0.05]));
    for (const sd of [1, -1]) {
      hh.push(ice(0.0075, 0.046, { sides: 4, waist: 0.5, shoulder: 0.5, root: I.eye, mid: 0xffffff, tip: I.eye, glow: 2 }).at(0, -0.023, 0).rot(0, 0, 90 - sd * 26).at(sd * 0.028, 1.123, 0.036));
      // a tiara of ice over the brow, icicles under the hood's lip
      hh.push(shard([sd * 0.036, 1.225, 0.075], [sd * 0.25, 1, 0.45], 0.014, 0.09, { glow: 0.6 }), shard([sd * 0.07, 1.2, 0.055], [sd * 0.7, 1, 0.3], 0.011, 0.06, { glow: 0.6 }).lod(1));
      for (let k = 0; k < 3; k++) hh.push(shard([sd * (0.022 + k * 0.022), 1.04 + k * 0.012, 0.095 - k * 0.012], [sd * 0.05, -1, 0.12], 0.0075, 0.05 - k * 0.008, { glow: 0.5 }).lod(1));
    }
    hh.push(shard([0, 1.237, 0.08], [0, 1, 0.5], 0.018, 0.13, { glow: 0.7 }));
  }

  // ---------------- arms: sleeves of rime over limbs of ice ----------------
  const SHO = [0.168, 0.985, 0], ELB = [0.245, 0.8, 0.02], WRI = [0.228, 0.635, 0.13];
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const X = (v) => (side > 0 ? v : mirX(v));
    const arm = node(`arm${nm}`, 'torso', X(SHO), { rig: 'arms' });
    const fore = node(`fore${nm}`, `arm${nm}`, X(ELB), { rig: 'forearms', detail: 1.1 });
    const ap = [], ah = [], fp = [], fh = [];
    ap.push(cloth(S.capsule(SHO, lerp3(SHO, ELB, 0.92), 0.046, 0.056)));
    ap.push(cloth(S.sphere(0.058).at(...SHO).blend(0.03)));
    for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.4, b = [ELB[0] + Math.cos(a) * 0.04, ELB[1] + 0.02, ELB[2] + Math.sin(a) * 0.04]; ap.push(cloth(S.capsule(b, [b[0] + Math.cos(a) * 0.012, b[1] - 0.07 - (k % 2) * 0.03, b[2] + Math.sin(a) * 0.012], 0.02, 0.004).blend(0.012)).color(I.shroud2)); }  // ragged cuff
    ap.push(frost([SHO[0], SHO[1] + 0.045, 0], [0.06, 0.03, 0.06], 0.004), S.ellipsoid(0.09, 0.07, 0.09).at(ELB[0], ELB[1] - 0.05, ELB[2]).color(mix(I.shroud, I.frost, 0.6)).tint(0.25, 30).pbr(0.85).paint(0.05));
    ah.push(shard([SHO[0] + 0.015, SHO[1] + 0.035, 0], [0.7, 1, 0.1], 0.028, 0.17, { spin: 20 }), shard([SHO[0] + 0.04, SHO[1] + 0.01, 0.03], [1, 0.45, 0.5], 0.02, 0.11, { sides: 5 }), shard([SHO[0] + 0.035, SHO[1] + 0.01, -0.035], [1, 0.5, -0.6], 0.022, 0.13));
    // forearm: one long crystal, a knuckle of ice, five icicle fingers
    fp.push(S.sphere(0.03).at(...ELB).color(I.deep).glow(0.3).pbr(0.2).bump(0.003, 30, 'noise'));
    fh.push(orient(ice(0.027, len3(sub3(WRI, ELB)) + 0.03, { waist: 0.12, shoulder: 0.86, glow: 0.4 }), ELB, sub3(WRI, ELB)));
    const palm = add3(WRI, [0, -0.02, 0.012]);
    fh.push(chunk(0.03, I.mid).rot(20, 30, 10).at(...palm).pbr(0.1, 0.05).glow(0.5));
    for (let i = 0; i < 4; i++) {
      const dx = (i - 1.5) * 0.02;
      fh.push(shard(add3(palm, [dx, -0.012, 0.008]), [dx * 3.2, -1, 0.34 - Math.abs(i - 1.5) * 0.1], 0.0085, 0.11 - Math.abs(i - 1.5) * 0.012, { sides: 5, glow: 0.6, waist: 0.12 }).lod(1));
    }
    fh.push(shard(add3(palm, [-0.022, 0.004, 0.01]), [-0.75, -0.7, 0.5], 0.0085, 0.075, { sides: 5, glow: 0.6, waist: 0.12 }).lod(1));
    arm.prims = side > 0 ? ap : mirrorPrims(ap); fore.prims = side > 0 ? fp : mirrorPrims(fp);
    arm.hard = side > 0 ? ah : ah.map((q) => q.mirrorX()); fore.hard = side > 0 ? fh : fh.map((q) => q.mirrorX());
    nodes.push(arm, fore);
    if (side < 0) {
      // the spell: a burr of ice that grows in the casting hand
      const c = X(add3(palm, [0, -0.1, 0.06]));
      const sp = node('spell', `fore${nm}`, c, { rig: 'spell' });
      sp.hard.push(H.sphere(0.03, 10).at(...c).color(0xffffff).glow(2));
      for (let k = 0; k < 8; k++) { const a = k * 2.4, b = k * 1.1; sp.hard.push(shard(c, [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)], 0.012, 0.08 + (k % 3) * 0.02, { root: I.mid, glow: 1.2 })); }
      nodes.push(sp);
    }
  }

  // ---------------- shards of ice turning about it ----------------
  for (let i = 0; i < 4; i++) {
    const n = node(`shard${i}`, 'root', [0, 0.8, 0], { rig: 'shards' });
    const a = i * 1.65 + 0.4, r = 0.34 + (i % 2) * 0.08, y = 0.62 + i * 0.15;
    n.hard.push(ice(0.026 + (i % 2) * 0.008, 0.13 + (i % 3) * 0.03, { waist: 0.42, shoulder: 0.58, glow: 0.7 }).at(0, -0.07, 0).rot(20 + i * 25, i * 50, 15 - i * 20).at(Math.cos(a) * r, y, Math.sin(a) * r));
    for (let k = 0; k < 3; k++) { const a2 = a + 0.6 + k * 0.55, r2 = r + (k - 1) * 0.06; n.hard.push(chunk(0.009 - k * 0.0015, 0xffffff).rot(k * 40, k * 70, 0).at(Math.cos(a2) * r2, y + 0.06 + k * 0.06 - i * 0.04, Math.sin(a2) * r2).glow(1.4).lod(1)); }
    nodes.push(n);
  }
  return { kind: 'iceWraith', attack: 'cast', nodes: finish(nodes) };
}

function elementalAnim(rig, inner, c, base, fire) {
  const { R } = base, t = c.t, ph = c.phase || 0;
  rig.s0 ??= inner.scale.y || 1;
  const s = rig.s0;
  const cast = c.atk >= 0 ? Math.sin(c.atk * Math.PI) : 0;
  if (rig.core) rig.core.scale.setScalar(1 + (c.atk >= 0 ? cast * 0.35 : Math.sin(t * 5 + ph) * 0.05));
  (rig.shards || []).forEach((sh, i) => R(sh, Math.sin(t * 1.3 + i) * 0.22, (t * (1.5 + i * 0.3) + ph) * (i % 2 ? -1 : 1) + i * 2.1, Math.cos(t * 1.1 + i) * 0.22));
  (rig.flames || []).forEach((f, i) => {
    R(f, Math.sin(t * 4.3 + i * 1.7 + ph) * 0.13, Math.sin(t * 2.3 + i * 2.9 + ph) * 0.3, Math.cos(t * 3.4 + i * 2.3 + ph) * 0.13);
    f.scale.set(1, 1 + Math.sin(t * 7.1 + i * 1.3 + ph) * 0.09 + cast * 0.25, 1);
  });
  (rig.tail || []).forEach((sg, i) => R(sg, Math.sin(t * 2.2 + ph - i * 0.9) * 0.1 + (c.moving ? 0.16 : 0), Math.sin(t * 1.7 + ph - i * 0.8) * (fire ? 0.5 : 0.22), Math.cos(t * 2 + ph - i) * 0.09));
  if (rig.arms) base.upperBody(rig, c, 'cast');
  (rig.spell || []).forEach((sp) => sp.scale.setScalar(Math.max(0.001, c.atk >= 0 ? base.keys(c.atk, [[0, 0], [0.4, 1.25], [0.55, 0.9], [0.62, 0]]) : 0)));
  inner.rotation.x = 0;
  if (c.dead > 0) {
    const f = Math.min(1, c.dead);
    if (fire) { inner.scale.setScalar(s * (1 - 0.82 * f * f)); inner.position.y = 0; inner.rotation.z = 0; }      // the fire gutters out
    else { inner.scale.setScalar(s); inner.position.y = -f * 0.6 * s; inner.rotation.z = f * 1.2; }              // the wraith topples and sinks
  } else {
    inner.scale.setScalar(s);
    inner.rotation.z = 0;
    inner.position.y = (Math.sin(t * 2.6 + ph) * 0.04 + cast * 0.05) * s;
  }
}

// =====================================================================================
//  BATTERING RAM
// =====================================================================================

/** a hewn timber: w x d in section, len long, standing on the origin along +Y. Adze-wobbled, streaked along the grain. */
function timber(w, d, len, color, seed = 0, seg) {
  const n = seg ?? Math.max(2, Math.round(len / 0.14));
  const g = new THREE.BoxGeometry(w, len, d, 2, n, 2);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = y < 0.001 || y > len - 0.001 ? 0.4 : 1;
    p.setXYZ(i, x + (noise3(y * 7 + seed, z * 30, seed * 1.7) - 0.5) * 0.009 * k, y, z + (noise3(y * 7 + seed * 2.3, x * 30, 5.1 + seed) - 0.5) * 0.009 * k);
  }
  const base = rgb(color), end = mixRgb(base, rgb(0xd6b98a), 0.45), dark = mixRgb(base, [0.02, 0.015, 0.01], 0.55);
  return H.geo(g).shade((x, y, z, nx, ny) => {
    if (Math.abs(ny) > 0.9) return end;                                                   // end grain
    const s = noise3(x * 55 + seed * 3, y * 2.2, z * 55 + seed), kn = noise3(x * 8 + seed, y * 9, z * 8);
    let c = mixRgb(dark, base, clamp(0.25 + s * 1.1));
    if (kn > 0.74) c = mixRgb(c, dark, (kn - 0.74) * 3);                                     // knots
    return c;
  }).color(color).pbr(0.88, 0);
}
/** timber from a to b, with a plain box inside it that is all that is drawn from far away */
function beam(a, b, w, d, color, seed = 0, zHint = [0, 0, 1]) {
  const len = len3(sub3(b, a)), dir = sub3(b, a);
  const far = H.geo(cached(`box${w}:${d}:${len.toFixed(3)}`, () => { const g = new THREE.BoxGeometry(Math.max(0.01, w - 0.014), len, Math.max(0.01, d - 0.014)); g.translate(0, len / 2, 0); return g; })).color(color).pbr(0.88, 0);
  return [orient(timber(w, d, len, color, seed), a, dir, zHint).lod(1), orient(far, a, dir, zHint)];
}
const peg = (c, dir, color = 0x2e2118, r = 0.011, len = 0.03) => orient(H.cyl(r * 0.85, r, len, 6).at(0, len / 2, 0), c, dir).color(color).pbr(0.85).lod(1);
/** rope lashing: a few turns of cord round a joint, axis along dir */
const lashing = (c, dir, R, turns = 3, color = 0xb49a64) => { const out = []; for (let i = 0; i < turns; i++) out.push(orient(H.torus(R, 0.0085, 12, 5).rot(90, 0, 0).at(0, (i - (turns - 1) / 2) * 0.016, 0), c, dir).color(i % 2 ? color : tone(color, 0, 0, -0.07)).pbr(0.95).lod(1)); return out; };
/** a length of chain from a down to b: oval links turned alternately, with a thin rod that stands in for it at distance */
function chain(a, b, color = 0x34363a) {
  const out = [], len = len3(sub3(b, a)), step = 0.027, n = Math.max(2, Math.round(len / step)), dir = norm3(sub3(b, a));
  for (let i = 0; i < n; i++) {
    const c = lerp3(a, b, (i + 0.5) / n);
    out.push(orient(H.torus(0.0125, 0.0042, 8, 5).scale(1, 1.45, 1).rot(0, i % 2 ? 90 : 0, 0), c, dir).color(color).pbr(0.42, 0.9).lod(1));
  }
  out.push(orient(H.cyl(0.006, 0.006, len, 4).at(0, len / 2, 0), a, sub3(b, a)).color(color).pbr(0.42, 0.9));
  return out;
}

function ram(def, o = {}) {
  const rnd = rng(hashStr((def?.id || 'ram') + ':engine'));
  const WOOD = o.color ?? 0x6b4a2e;
  const W = { base: WOOD, dark: tone(WOOD, -0.01, -0.04, -0.09), pale: tone(WOOD, 0.01, -0.02, 0.07), red: tone(WOOD, -0.02, 0.06, -0.03), log: tone(WOOD, -0.01, -0.08, -0.12), bark: 0x3a2c20, heart: 0xc9a674 };
  const IRON = 0x4c5058, IRON2 = 0x2c2e33, BRONZE = 0x8f6a34, ROPE = 0xb49a64;
  const iron = (p) => p.color(IRON).tint(0.3, 22).pbr(0.5, 0.8);
  const woods = [W.base, W.dark, W.pale, W.red];
  let seed = 1;
  const tb = (a, b, w, d, zh) => beam(a, b, w, d, woods[seed % woods.length], seed++ * 1.37, zh);
  const nodes = [];
  const root = node('root', null, [0, 0, 0]); nodes.push(root);
  const F = root.hard;

  // ---------------- chassis ----------------
  const SX = 0.36, SY = 0.3, HALF = 0.78, AZ = 0.5, WX = 0.475, WR = 0.2;
  for (const sd of [1, -1]) {
    F.push(tb([sd * SX, SY, -HALF], [sd * SX, SY, HALF], 0.09, 0.105, [0, 1, 0]));                                // sills
    for (const z of [-AZ, AZ]) F.push(H.box(0.12, 0.085, 0.16, 0.012).at(sd * SX, SY - 0.085, z).color(W.dark).pbr(0.9));  // axle blocks
    F.push(H.box(0.02, 0.07, 0.02, 0.003).at(sd * (WX + 0.062), 0.2, AZ).color(IRON2).pbr(0.5, 0.8).lod(1), H.box(0.02, 0.07, 0.02, 0.003).at(sd * (WX + 0.062), 0.2, -AZ).color(IRON2).pbr(0.5, 0.8).lod(1));   // linchpins
  }
  for (const z of [-0.72, 0, 0.72]) F.push(tb([-0.43, SY + 0.005, z], [0.43, SY + 0.005, z], 0.085, 0.09, [0, 1, 0]));       // cross beams
  for (const z of [-AZ, AZ]) F.push(H.cyl(0.03, 0.03, 1.06, 10).rot(0, 0, 90).at(0, 0.2, z).color(W.dark).pbr(0.85), H.cyl(0.036, 0.036, 0.05, 10).rot(0, 0, 90).at(0.4, 0.2, z).color(IRON).pbr(0.5, 0.85).lod(1), H.cyl(0.036, 0.036, 0.05, 10).rot(0, 0, 90).at(-0.4, 0.2, z).color(IRON).pbr(0.5, 0.85).lod(1));
  F.push(tb([-0.28, 0.5, -0.83], [0.28, 0.5, -0.83], 0.05, 0.05, [0, 1, 0]));                                      // push bar at the back
  for (const sd of [1, -1]) F.push(tb([sd * 0.22, SY, -0.74], [sd * 0.22, 0.5, -0.83], 0.045, 0.045));

  // ---------------- three A-frames, a ridge pole, braces ----------------
  const RY = 1.1, frames = [-0.66, 0, 0.66];
  for (const z of frames) {
    for (const sd of [1, -1]) {
      const foot = [sd * SX, SY + 0.04, z], top = [sd * -0.03, RY + 0.045, z + sd * 0.036];
      F.push(tb(foot, top, 0.075, 0.07, [0, 0, 1]));
      F.push(peg([sd * (SX + 0.045), SY + 0.06, z], [sd, 0, 0]), peg([sd * SX, SY + 0.11, z + 0.035], [0, 0, 1]));
      F.push(lashing(lerp3(foot, top, 0.045), sub3(top, foot), 0.058, 3, ROPE));
    }
    F.push(tb([-0.215, 0.8, z + 0.05], [0.215, 0.8, z + 0.05], 0.05, 0.06, [0, 1, 0]));                            // collar tie
    for (const sd of [1, -1]) F.push(peg([sd * 0.16, 0.8, z + 0.075], [0, 0, 1]), peg([sd * 0.19, 0.8, z + 0.075], [0, 0, 1], 0x2e2118, 0.008));
    F.push(lashing([0, RY + 0.01, z], [0, 0, 1], 0.07, 4, ROPE));
  }
  F.push(tb([0, RY, -0.82], [0, RY, 0.82], 0.08, 0.085, [0, 1, 0]));                                               // ridge pole
  for (const sd of [1, -1]) {
    F.push(tb([sd * 0.335, 0.4, 0.62], [sd * 0.15, 0.86, 0.04], 0.04, 0.05));                                     // wind braces
    F.push(tb([sd * 0.335, 0.4, -0.62], [sd * 0.15, 0.86, -0.04], 0.04, 0.05));
    F.push(tb([sd * 0.2, 0.78, -0.76], [sd * 0.2, 0.78, 0.76], 0.045, 0.05, [0, 1, 0]));                          // purlins
  }
  // the front gable boarded over above the ram, studded with iron
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.062, top = RY - 0.02 - Math.abs(x) * 1.9;
    if (top < 0.84) continue;
    F.push(tb([x, 0.79, 0.735], [x, top, 0.735], 0.058, 0.022, [0, 0, 1]));
    F.push(H.sphere(0.008, 6).at(x, 0.83, 0.75).color(IRON2).pbr(0.5, 0.8).lod(0));
  }

  // ---------------- the roof: three courses of wet hides a side, pinned under battens ----------------
  const ridgeP = [0.035, 1.175], eaveP = [0.545, 0.465];
  const slopeLen = Math.hypot(eaveP[0] - ridgeP[0], eaveP[1] - ridgeP[1]);
  const HIDES = [[0x57402e, 0x35251b], [0x86643f, 0x4e3826], [0x7a4a2c, 0x45281a], [0x9a7c56, 0x62492f], [0x4a372b, 0x2a1d16], [0x6e5138, 0xb9a98a], [0x6a5f52, 0x3e362e]];
  for (const sd of [1, -1]) {
    const up = norm3([sd * (ridgeP[0] - eaveP[0]), ridgeP[1] - eaveP[1], 0]);                                      // up the slope, eave to ridge
    const N = norm3([sd * (ridgeP[1] - eaveP[1]), eaveP[0] - ridgeP[0], 0]);                                      // outward normal of this slope
    const at = (v, z, lift = 0) => [sd * eaveP[0] + up[0] * v * slopeLen + N[0] * lift, eaveP[1] + up[1] * v * slopeLen + N[1] * lift, z];
    // a plain skin beneath, which is the whole roof from far away
    F.push(orient(H.sheet(1.6, slopeLen * 0.98, 6, 3).shade((x, y) => { const k = 0.75 + 0.5 * noise3(x * 3 + sd, y * 4, 2.2); return [0.11 * k, 0.075 * k, 0.05 * k]; }).color(0x4f3828).pbr(0.6), at(0.5, 0, -0.004), up, N));
    for (let row = 0; row < 3; row++) {
      const v0 = [-0.03, 0.27, 0.56][row], v1 = [0.4, 0.69, 0.955][row], h = (v1 - v0) * slopeLen;
      let z = -0.83 + (row % 2) * 0.05;
      for (let k = 0; z < 0.8; k++) {
        const w = Math.min(0.83 - z, 0.34 + rnd() * 0.16), cols = HIDES[Math.floor(rnd() * HIDES.length)], sdd = rnd() * 50, pied = cols[1] === 0xb9a98a;
        const a = rgb(cols[0]), b = rgb(cols[1]);
        const hide = H.sheet(w + 0.03, h, 7, 6, (u, v) => {
          const wr = (noise3(u * 5 + sdd, v * 5, sdd) - 0.5) * 0.016, sag = -0.012 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
          const rag = v < 0.2 ? -(0.012 + 0.035 * noise3(u * 6 + sdd, 1.3, sdd)) * (1 - v / 0.2) : 0;
          const side = (noise3(v * 4 + sdd, 7.7, u > 0.5 ? 3 : 9) - 0.5) * 0.03 * Math.pow(Math.abs(u - 0.5) * 2, 4);
          return [side, rag, wr + sag];
        }).shade((x, y) => {
          const u = x / (w + 0.03) + 0.5, v = y / h + 0.5;
          let c = mixRgb(a, pied ? a : b, clamp(noise3(u * 4 + sdd, v * 4, 1.1) * 1.4 - 0.2) * (pied ? 0 : 1));
          if (pied && noise3(u * 3.4 + sdd, v * 3.4, 4.2) > 0.6) c = b;                     // a piebald hide
          const wet = clamp(1 - v / 0.45), edge = Math.max(Math.pow(Math.abs(u - 0.5) * 2, 6), Math.pow(1 - v, 8));
          c = mixRgb(c, [0.012, 0.01, 0.008], wet * 0.45 + edge * 0.35);
          return c;
        }).color(cols[0]).pbr(0.5 + rnd() * 0.14, 0).lod(1);
        F.push(orient(hide, at((v0 + v1) / 2, -(z + w / 2), 0.012 + row * 0.012), up, N));
        z += w - 0.02;
      }
    }
    // battens pinning the hides, pegged through
    for (const v of [0.3, 0.6]) {
      F.push(tb(at(v, -0.81, 0.045), at(v, 0.81, 0.045), 0.04, 0.022, N));
      for (let k = 0; k < 6; k++) F.push(peg(at(v, -0.7 + k * 0.28, 0.05), N, 0x2a1e16, 0.008, 0.016));
    }
    // shields hung along the eaves
    [-0.5, 0.02, 0.52].forEach((z, k) => F.push(ramShield(at(0.16, z, 0.062), up, N, (k + (sd > 0 ? 0 : 3)) % 6, IRON)));
  }
  // a long hide folded over the ridge, lashed down
  {
    const capA = (u) => [0.13, ridgeP[1] - 0.105, lerp(-0.84, 0.84, u)], capB = (u) => [-0.13, ridgeP[1] - 0.105, lerp(-0.84, 0.84, u)];
    const a = rgb(0x6e4f36), b = rgb(0x3a281c);
    F.push(membrane(capA, capB, { nu: 14, nv: 6, scallop: 0, billow: 0.118, archPow: 0.85, up: [0, 1, 0], rough: 0.55, col: (u, v) => mixRgb(a, b, clamp(noise3(u * 9, v * 3, 3.3) * 1.2 - 0.1 + Math.pow(Math.abs(v - 0.5) * 2, 3) * 0.6)) }));
    for (const z of [-0.6, -0.2, 0.2, 0.6]) F.push(H.tube([[0.14, ridgeP[1] - 0.1, z], [0.075, ridgeP[1] - 0.012, z], [0, ridgeP[1] + 0.026, z], [-0.075, ridgeP[1] - 0.012, z], [-0.14, ridgeP[1] - 0.1, z]], 0.007, 12, 5).color(ROPE).pbr(0.95).lod(1));
  }
  // arrows left standing in the roof
  for (const [x, v, z, rx, rz] of [[1, 0.72, 0.3, -30, -35], [1, 0.45, -0.38, 20, -50], [-1, 0.62, 0.45, -25, 40], [-1, 0.5, -0.1, 15, 28], [1, 0.86, -0.05, -10, -20]]) {
    const up = norm3([x * (ridgeP[0] - eaveP[0]), ridgeP[1] - eaveP[1], 0]);
    const c = [x * eaveP[0] + up[0] * v * slopeLen, eaveP[1] + up[1] * v * slopeLen, z];
    const arrow = [H.cyl(0.0035, 0.0035, 0.2, 5).at(0, 0.1, 0).color(0xcbb98a).pbr(0.8)];
    for (let k = 0; k < 3; k++) arrow.push(H.box(0.0015, 0.05, 0.022, 0).at(0, 0.172, 0.011).rot(0, k * 120, 0).color(k ? 0xd8d2c0 : 0x8a2a22).pbr(0.9));
    for (const q of arrow) F.push(q.rot(rx, 0, rz).at(c[0], c[1], c[2]).lod(1));
  }
  // a pail and a coil of rope at the back
  F.push(H.lathe([[0.001, 0], [0.04, 0], [0.05, 0.085], [0.044, 0.085], [0.036, 0.008], [0.001, 0.008]], 12).at(0.15, 0.555, -0.84).color(W.pale).pbr(0.85).lod(1), H.torus(0.047, 0.004, 14, 4).rot(90, 0, 0).at(0.15, 0.6, -0.84).color(IRON).pbr(0.5, 0.8).lod(1), H.torus(0.043, 0.004, 14, 4).rot(90, 0, 0).at(0.15, 0.57, -0.84).color(IRON).pbr(0.5, 0.8).lod(1));
  F.push(H.torus(0.045, 0.003, 10, 4, Math.PI).at(0.15, 0.64, -0.84).color(IRON2).pbr(0.5, 0.8).lod(1));
  for (let i = 0; i < 4; i++) F.push(H.torus(0.06 - i * 0.004, 0.009, 14, 5).rot(8, 0, 0).at(-0.16, 0.6 - i * 0.004, -0.855 - i * 0.012).color(i % 2 ? ROPE : tone(ROPE, 0, 0, -0.08)).pbr(0.95).lod(1));

  // ---------------- the ram: an iron-shod trunk with a ram's head, slung on chains ----------------
  const LY = 0.52, LO = [0, LY, 0];
  const log = node('log', 'root', LO, { rig: 'log', detail: 1.1 }); nodes.push(log);
  {
    const p = log.prims, h = log.hard;
    const zB = -0.74, zF = 0.84;
    p.push(S.cyl(0.094, zF - zB, 0.012).rot(90, 0, 0).at(0, LY, (zF + zB) / 2).color(W.bark).bump(0.0075, 34, 'fur').tint(0.3, 12).pbr(0.95));
    p.push(S.cyl(0.07, 0.03, 0.006).rot(90, 0, 0).at(0, LY, zB - 0.004).color(W.heart).tint(0.2, 30).pbr(0.9).paint(0.006));                // sawn end
    for (const r of [0.028, 0.052]) p.push(S.torus(r, 0.005).rot(90, 0, 0).at(0, LY, zB - 0.002).color(tone(W.heart, 0, 0, -0.12)).paint(0.003, -0.002));
    for (const [a, z] of [[0.6, -0.3], [2.5, 0.2], [4.4, -0.55]]) p.push(S.cyl(0.024, 0.045, 0.006).rot(90, 0, 0).rot(0, 0, a / DEG).at(Math.sin(-a) * 0.095, LY + Math.cos(a) * 0.095, z).rot(0, 0, 0).color(W.heart).tint(0.25, 30).pbr(0.9).blend(0.008)); // lopped branch stubs
    // iron bands
    for (const z of [-0.6, -0.45, 0.45, 0.6]) {
      p.push(iron(S.torus(0.097, 0.015).rot(90, 0, 0).at(0, LY, z)).blend(0.003));
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; h.push(H.sphere(0.0075, 6).at(Math.cos(a) * 0.112, LY + Math.sin(a) * 0.112, z).color(IRON2).pbr(0.45, 0.85).lod(0)); }
    }
    for (const z of [-0.45, 0.45]) h.push(H.torus(0.022, 0.006, 10, 5).rot(0, 90, 0).at(0, LY + 0.128, z).color(IRON2).pbr(0.45, 0.85).lod(1));     // sling rings
    // the shoe and the beast's head
    p.push(iron(S.cyl(0.108, 0.2, 0.012).rot(90, 0, 0).at(0, LY, zF - 0.06)).blend(0.004));
    p.push(iron(S.ellipsoid(0.1, 0.105, 0.11).at(0, LY + 0.012, zF + 0.05)).blend(0.01));                          // skull
    p.push(iron(S.capsule([0, LY - 0.004, zF + 0.08], [0, LY - 0.05, zF + 0.19], 0.074, 0.05)).blend(0.03));       // muzzle
    p.push(iron(S.ellipsoid(0.07, 0.04, 0.07).rot(-28, 0, 0).at(0, LY + 0.075, zF + 0.1)).blend(0.02));            // the butting boss of the brow
    p.push(...S.mirrorX([
      iron(S.capsule([0.02, LY + 0.052, zF + 0.15], [0.085, LY + 0.07, zF + 0.085], 0.02, 0.026)).blend(0.012),   // brow ridge
      iron(S.ellipsoid(0.03, 0.03, 0.04).at(0.062, LY - 0.012, zF + 0.1)).blend(0.016),                           // cheek
      iron(S.ellipsoid(0.022, 0.016, 0.02).at(0.024, LY - 0.03, zF + 0.215)).blend(0.01),                         // nostril wing
      S.sphere(0.017).at(0.058, LY + 0.03, zF + 0.135).cut(0.006).color(IRON2),                                    // eye socket
      S.ellipsoid(0.007, 0.006, 0.012).rot(0, 25, 0).at(0.022, LY - 0.026, zF + 0.232).cut(0.004).color(0x0c0c0e),   // nostril
    ]));
    p.push(S.ellipsoid(0.06, 0.012, 0.07).rot(18, 0, 0).at(0, LY - 0.074, zF + 0.17).cut(0.005).color(0x0e0e10));  // the snarl
    p.push(iron(S.ellipsoid(0.045, 0.02, 0.06).rot(22, 0, 0).at(0, LY - 0.094, zF + 0.14)).blend(0.006));          // jaw
    p.push(S.capsule([0, LY + 0.07, zF + 0.02], [0, LY + 0.02, zF + 0.2], 0.008).color(IRON2).paint(0.004, 0.004)); // ridge down the face
    for (let k = 0; k < 5; k++) p.push(S.sphere(0.011).at((k - 2) * 0.03, LY + 0.1 - Math.abs(k - 2) * 0.012, zF + 0.085).color(BRONZE).pbr(0.4, 0.9).blend(0.003));   // studs on the boss
    for (const sd of [1, -1]) {
      h.push(H.sphere(0.011, 10).at(sd * 0.056, LY + 0.03, zF + 0.134).color(0xc23a1c).glow(0.35).pbr(0.25, 0.3).lod(1));   // red enamel eyes
      for (let k = 0; k < 4; k++) h.push(spike([sd * (0.012 + k * 0.012), LY - 0.066 - k * 0.002, zF + 0.215 - k * 0.022], [sd * 0.1, -1, 0.1], 0.02 - k * 0.002, 0.005, 0xb8bcc2, [0, 0, -1], 0.2).pbr(0.35, 0.9).lod(1));
      // great curling horns of bronze
      const pts = [];
      for (let j = 0; j <= 9; j++) { const a = -0.5 + j * 0.52, r = 0.095 - j * 0.0045; pts.push([sd * (0.075 + j * 0.012), LY + 0.045 + Math.cos(a) * r - 0.02, zF - 0.01 - Math.sin(a) * r + 0.03]); }
      const br = rgb(BRONZE), pat = rgb(0x4f7a62);
      const hn = horn(pts, 0.04, [BRONZE, BRONZE, 0x5a4220], { rings: 26, ripple: 0.14, rough: 0.42, tip: 0.1, pow: 0.7 });
      hn.forEach((q) => q.pbr(0.42, 0.85).shade((x, y, z) => mixRgb(br, pat, clamp(noise3(x * 30, y * 30, z * 30) * 1.6 - 0.75))));
      h.push(hn);
      p.push(iron(S.torus(0.04, 0.012).rot(60, 0, sd * -70).at(sd * 0.078, LY + 0.06, zF + 0.035)).blend(0.006));
    }
  }
  // chains: each pair swings from the ridge
  for (const [i, z] of [[0, 0.45], [1, -0.45]]) {
    const n = node(`chain${i}`, 'root', [0, RY - 0.05, z], { rig: 'chains' });
    n.hard.push(chain([0.012, RY - 0.05, z], [0.012, LY + 0.14, z]), chain([-0.012, RY - 0.05, z], [-0.012, LY + 0.14, z]));
    n.hard.push(H.torus(0.05, 0.008, 12, 5).rot(0, 90, 0).at(0, RY - 0.01, z).color(IRON2).pbr(0.45, 0.85).lod(1));
    nodes.push(n);
  }

  // ---------------- wheels ----------------
  const wheel = ramWheel(WR, W, IRON, IRON2);
  [[1, AZ], [-1, AZ], [1, -AZ], [-1, -AZ]].forEach(([sd, z], i) => {
    const n = node(`wheel${i}`, 'root', [sd * WX, WR, z], { rig: 'wheels' });
    n.hard = wheel.map((q) => { const c = q.clone(); if (sd < 0) c.rot(0, 180, 0); return c.rot(i * 37, 0, 0).at(sd * WX, WR, z); });
    nodes.push(n);
  });
  return { kind: 'ram', attack: 'slam', nodes: finish(nodes) };
}

/** a spoked cart wheel on the origin, axle along X, outer face toward +X */
function ramWheel(R, W, IRON, IRON2) {
  const out = [], wd = 0.062;
  const wa = rgb(W.base), wb = rgb(W.dark), wc = rgb(W.pale);
  const woodShade = (k) => (x, y, z) => mixRgb(wb, k % 2 ? wa : wc, clamp(0.2 + noise3(x * 40 + k, y * 40, z * 40) * 1.1));
  // felloes: six curved blocks with a seam between each
  const fel = H.lathe([[R - 0.05, -wd / 2], [R - 0.008, -wd / 2], [R - 0.008, wd / 2], [R - 0.05, wd / 2], [R - 0.05, -wd / 2]], 36).shade((x, y, z) => {
    const a = Math.atan2(z, x), seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6), f = (((a + Math.PI) / (Math.PI * 2)) * 6) % 1;
    if (f < 0.035 || f > 0.965) return wb.map((v) => v * 0.5);
    return mixRgb(wb, seg % 2 ? wa : wc, clamp(0.25 + noise3(x * 30, y * 30, z * 30 + seg)));
  }).color(W.base).pbr(0.88).rot(0, 0, 90).lod(1);
  const tyre = H.lathe([[R - 0.008, -wd / 2 - 0.004], [R, -wd / 2 - 0.004], [R, wd / 2 + 0.004], [R - 0.008, wd / 2 + 0.004], [R - 0.008, -wd / 2 - 0.004]], 36).color(IRON).pbr(0.5, 0.85).rot(0, 0, 90).lod(1);
  out.push(fel, tyre);
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; out.push(H.sphere(0.006, 6).at(wd / 2 + 0.004, Math.cos(a) * (R - 0.004), Math.sin(a) * (R - 0.004)).color(IRON2).pbr(0.45, 0.85).lod(0)); }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    out.push(H.cyl(0.013, 0.019, R - 0.085, 7).at(0, (R - 0.085) / 2 + 0.04, 0).rot(a / DEG, 0, 0).shade(woodShade(k)).color(W.base).pbr(0.88).lod(1));
  }
  // hub: a turned barrel bound in iron, the axle end pinned
  out.push(H.lathe([[0.001, -0.075], [0.04, -0.075], [0.052, -0.04], [0.058, 0], [0.052, 0.04], [0.04, 0.075], [0.001, 0.075]], 14).shade(woodShade(3)).color(W.dark).pbr(0.88).rot(0, 0, 90).lod(1));
  for (const x of [-0.05, 0.05]) out.push(H.torus(0.046, 0.007, 14, 5).rot(0, 90, 0).at(x, 0, 0).color(IRON).pbr(0.5, 0.85).lod(1));
  out.push(H.cyl(0.02, 0.02, 0.03, 8).rot(0, 0, 90).at(0.088, 0, 0).color(IRON2).pbr(0.5, 0.85).lod(1));
  // what is left at distance, hidden inside the pieces above: a coarse rim, two crossed bars, a hub
  out.push(H.lathe([[R - 0.044, -wd * 0.4], [R - 0.012, -wd * 0.4], [R - 0.012, wd * 0.4], [R - 0.044, wd * 0.4], [R - 0.044, -wd * 0.4]], 12).color(W.dark).pbr(0.9).rot(0, 0, 90));
  for (let k = 0; k < 2; k++) out.push(H.geo(cached(`spokebar${R}`, () => new THREE.BoxGeometry(0.02, (R - 0.02) * 2, 0.02))).rot((k * 90) + 0.2 / DEG, 0, 0).color(W.base).pbr(0.9));
  out.push(H.cyl(0.04, 0.04, 0.13, 6).rot(0, 0, 90).color(W.dark).pbr(0.9));
  return out;
}

/** a round shield lying on a slope: face along N, top toward up. k picks the paint. */
function ramShield(c, up, N, k, IRON) {
  const R = 0.122;
  const paints = [[0x8a2a22, 0xd8c9a0, 'quarter'], [0x2f4a6a, 0xd8c9a0, 'ring'], [0x3d5a34, 0xc9a548, 'half'], [0x7a5a36, 0x5a4026, 'planks'], [0xc9a548, 0x2a2420, 'chevron'], [0x6a2a4a, 0xd8c9a0, 'ring']];
  const [ca, cb, kind] = paints[k % paints.length];
  const a = rgb(ca), b = rgb(cb), dirt = [0.03, 0.025, 0.02];
  const face = H.lathe([[0.001, 0.03], [0.045, 0.027], [0.09, 0.017], [R, 0.004], [R, -0.004], [0.001, -0.004]], 22).shade((x, y, z) => {
    const r = Math.hypot(x, z);
    let c3;
    if (kind === 'quarter') c3 = x * z > 0 ? a : b;
    else if (kind === 'ring') c3 = r > R * 0.52 && r < R * 0.78 ? b : a;
    else if (kind === 'half') c3 = z > 0 ? a : b;
    else if (kind === 'chevron') c3 = Math.abs(x) * 0.9 + z > 0 && Math.abs(x) * 0.9 + z < R * 0.55 ? b : a;
    else c3 = Math.floor((x + 1) / 0.035) % 2 ? a : b;
    const n = noise3(x * 30 + k, 2, z * 30);
    return mixRgb(c3, dirt, clamp(n * 0.7 - 0.15) + (y < 0 ? 0.5 : 0));
  }).color(ca).pbr(0.7);
  const parts = [face.lod(1), H.torus(R - 0.004, 0.0085, 22, 5).rot(90, 0, 0).at(0, 0.004, 0).color(IRON).pbr(0.45, 0.85).lod(1), H.sphere(0.03, 12).scale(1, 0.62, 1).at(0, 0.028, 0).color(IRON).pbr(0.4, 0.9).lod(1)];
  for (let i = 0; i < 8; i++) { const an = (i / 8) * Math.PI * 2; parts.push(H.sphere(0.005, 5).at(Math.cos(an) * (R - 0.02), 0.012, Math.sin(an) * (R - 0.02)).color(IRON).pbr(0.4, 0.9).lod(0)); }
  parts.push(H.cyl(R * 0.97, R * 0.97, 0.012, 10).shade((x, y, z) => (Math.hypot(x, z) < 0.03 ? rgb(IRON) : (kind === 'quarter' ? (x * z > 0 ? a : b) : kind === 'half' ? (z > 0 ? a : b) : a))).color(ca).pbr(0.7));   // far stand-in
  return parts.map((q) => orient(q, c, N, up));
}

function ramAnim(rig, inner, c, base) {
  base.ram(rig, inner, c);
  const ch = rig.chains;
  if (!ch || !rig.log) return;
  // the trunk hangs on its chains, so it rises a little at each end of the swing
  const rest = rig.log.userData.rest, dz = rest ? rig.log.position.z - rest[5] : 0;
  const L = Math.abs(ch[0].userData.rest ? ch[0].userData.rest[4] - rest[4] : 0.45) || 0.45;
  const th = Math.asin(Math.max(-0.95, Math.min(0.95, dz / L)));
  base.P(rig.log, 0, L * (1 - Math.cos(th)), dz);
  for (const k of ch) base.R(k, -th, 0, 0);
}

// =====================================================================================
export const bodies = { dragon, golem, elemental, ram };
export const animators = {
  dragon: dragonAnim, golem: golemAnim, gargoyle: gargoyleAnim, ram: ramAnim,
  fireElemental: (rig, inner, c, base) => elementalAnim(rig, inner, c, base, true),
  iceWraith: (rig, inner, c, base) => elementalAnim(rig, inner, c, base, false),
};
