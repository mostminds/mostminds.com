// Shared bits for the sky library: primitives that know their own resolution at each detail level, swept tubes
// and lofted bodies, emblems, waving cloth, and a baker that merges every static mesh under each moving part into
// one vertex-coloured mesh (plus one per special material) with a geometry for each of the six detail levels.
//
// Detail: every mesh carries a tier d (the highest detail level 0..5 at which it still shows; 5 = always) — set it
// for a block of code with tier(d, () => ...). Curved primitives also carry a family (q) => geometry, so the
// baker draws them with fewer segments further away (RES maps level -> q).
import * as THREE from 'three';
import { mat } from '../models.js';
import { sculptMaterial } from '../sculpt.js';

export { THREE, mat };
export const PI = Math.PI, TAU = Math.PI * 2;
export const RES = [0, 1, 1, 2, 3, 3];
export const EMPTY = new THREE.BufferGeometry();
EMPTY.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, k) => a + (b - a) * k;
export const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

// ---- detail tiers ----
let CUR_D = 5;
/** run fn with every mesh made inside it shown only up to detail level d (0 = closest only) */
export function tier(d, fn) { const p = CUR_D; CUR_D = Math.min(p, d); try { return fn(); } finally { CUR_D = p; } }

// ---- geometry families: (q) => geometry, q = 0 (full) .. 3 (coarsest) ----
const FAM = new Map();
export function fam(key, make) {
  if (key && FAM.has(key)) return FAM.get(key);
  const cache = [];
  const f = (q = 0) => cache[q] || (cache[q] = make(q));
  f.isFam = true;
  if (key) FAM.set(key, f);
  return f;
}
export const sidesAt = (s, q) => Math.max(3, Math.round(s * [1, 0.72, 0.52, 0.36][q]));
export const SPH = () => fam('sph', (q) => new THREE.SphereGeometry(1, [22, 15, 10, 7][q], [15, 10, 7, 5][q]));
export const SPH_LO = () => fam('sphlo', (q) => new THREE.SphereGeometry(1, [12, 9, 7, 5][q], [8, 6, 5, 4][q]));
export const DOT = () => fam('dot', (q) => new THREE.SphereGeometry(1, q < 2 ? 6 : 4, q < 2 ? 4 : 3));
export const HEMI = () => fam('hemi', (q) => new THREE.SphereGeometry(1, [18, 12, 8, 6][q], [7, 5, 4, 3][q], 0, TAU, 0, PI / 2));
export const BOX = () => fam('box', () => new THREE.BoxGeometry(1, 1, 1));
export const CYL = (s = 12, open = false) => fam(`cyl${s}${open}`, (q) => new THREE.CylinderGeometry(1, 1, 1, sidesAt(s, q), 1, open));
export const CONE = (s = 8) => fam(`cone${s}`, (q) => new THREE.ConeGeometry(1, 1, sidesAt(s, q)));
export const TORUS = (t = 0.06, rs = 24, ts = 6, arc = TAU) => fam(`tor${t},${rs},${ts},${arc}`, (q) => new THREE.TorusGeometry(1, t, sidesAt(ts, q), sidesAt(rs, q), arc));
export const OCTA = () => fam('octa', () => new THREE.OctahedronGeometry(1, 0));
export const ICO = (d = 0) => fam(`ico${d}`, (q) => new THREE.IcosahedronGeometry(1, q < 2 ? d : 0));
export const DODE = () => fam('dode', () => new THREE.DodecahedronGeometry(1, 0));

export function mesh(g, m, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  const f = g && g.isFam ? g : null;
  const o = new THREE.Mesh(f ? f(0) : g, m);
  if (f) o.userData.fam = f;
  o.position.set(x, y, z); o.scale.set(sx, sy, sz);
  return o;
}
export function add(p, o) { if (o.userData.d === undefined) o.userData.d = CUR_D; p.add(o); return o; }
export function group(p, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.userData.d = CUR_D; if (p) p.add(g); return g; }
export const ell = (p, m, x, y, z, rx, ry = rx, rz = rx, lo = false) => { const r = Math.max(rx, ry, rz); return add(p, mesh(r < 0.045 ? DOT() : lo || r < 0.14 ? SPH_LO() : SPH(), m, x, y, z, rx, ry, rz)); };
export const blk = (p, m, x, y, z, w, h, d) => add(p, mesh(BOX(), m, x, y, z, w, h, d));

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** a tapered rod from a to b (radius ra at a, rb at b) */
export function rod(p, m, a, b, ra, rb = ra, sides = 6) {
  _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
  const len = _d.length() || 1e-4, big = Math.max(ra, rb, 1e-4), kt = Math.round((rb / big) * 20) / 20, kb = Math.round((ra / big) * 20) / 20;
  const open = big < 0.03;
  const o = mesh(fam(`rod${kt},${kb},${sides},${open}`, (q) => new THREE.CylinderGeometry(kt, kb, 1, sidesAt(sides, q), 1, open)), m);
  o.scale.set(big, len, big);
  o.position.copy(_a).addScaledVector(_d, 0.5);
  o.quaternion.setFromUnitVectors(_up, _d.normalize());
  return add(p, o);
}
/** a cone from base point a pointing at b */
export function spike(p, m, a, b, r, sides = 6) {
  _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
  const len = _d.length() || 1e-4;
  const o = mesh(CONE(sides), m); o.scale.set(r, len, r);
  o.position.copy(_a).addScaledVector(_d, 0.5);
  o.quaternion.setFromUnitVectors(_up, _d.normalize());
  return add(p, o);
}
/** a flat double-sided plate from an outline [[x, s], ...] lying in the x-z plane (s -> +z), lifted by y */
export function plate(p, m, pts, y = 0, cache = null) {
  const make = () => new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, s]) => new THREE.Vector2(x, s))), 6).rotateX(PI / 2);
  const o = mesh(cache ? fam(cache, make) : make(), m); o.position.y = y; return add(p, o);
}
/** a plate with thickness and a small bevel (outline in x-z like plate) */
export function slab(p, m, pts, thick = 0.05, bevel = 0.015, cache = null) {
  const make = (q) => {
    const sh = new THREE.Shape(pts.map(([x, s]) => new THREE.Vector2(x, s)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: bevel > 0 && q < 2, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: q < 2 ? 8 : 4 });
    return g.translate(0, 0, -thick / 2).rotateX(PI / 2);
  };
  const o = mesh(cache ? fam(cache, make) : fam(null, make), m); return add(p, o);
}
/** surface of revolution around +y from [[r, y], ...] */
export function lathe(p, m, prof, segs = 16, key = null, phiStart = 0, phiLen = TAU) {
  const make = (q) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0005), y)), Math.max(phiLen < TAU - 1e-6 ? 1 : 3, Math.round(sidesAt(segs, q) * phiLen / TAU)), phiStart, phiLen);
  return add(p, mesh(key ? fam(key, make) : fam(null, make), m));
}

// ---- swept tubes and lofted bodies ----
const spec = (r, t, def) => (r === undefined ? def : typeof r === 'number' ? r : typeof r === 'function' ? r(t) : r.length === 2 ? lerp(r[0], r[1], t) : sampleArr(r, t));
function sampleArr(a, t) { const u = clamp(t, 0, 1) * (a.length - 1), i = Math.min(a.length - 2, Math.floor(u)), f = u - i; return lerp(a[i], a[i + 1], f); }
/**
 * a tube along a smooth curve through pts, radius r (number | [r0, r1] | array along | fn(t)), ellipse by o.ry (multiplier of r,
 * same forms); o.prof(t, ang) shapes the section; o.n segments along, o.m around; rounded ends by default (o.round = 0 for flat caps).
 * o.up: the direction the section's 'top' faces (default +y). o.twist(t): rotation of the section.
 */
export function sweepGeo(pts, r, o = {}, q = 0) {
  const curve = pts.length === 2 ? new THREE.LineCurve3(new THREE.Vector3(...pts[0]), new THREE.Vector3(...pts[1])) : new THREE.CatmullRomCurve3(pts.map((v) => new THREE.Vector3(...v)), false, 'centripetal');
  const nA = Math.max(2, Math.round((o.n ?? Math.max(4, pts.length * 4)) * [1, 0.66, 0.45, 0.3][q]));
  const mR = Math.max(o.minM ?? 4, Math.round((o.m ?? 10) * [1, 0.75, 0.55, 0.42][q]));
  const round = o.round ?? 1;
  const rings = [];
  const P = [], T = [];
  for (let i = 0; i <= nA; i++) { const t = i / nA; P.push(curve.getPointAt(t)); T.push(curve.getTangentAt(t).normalize()); }
  // parallel-transport frames starting from 'up'
  const up = new THREE.Vector3(...(o.up || [0, 1, 0]));
  let N = up.clone().addScaledVector(T[0], -up.dot(T[0]));
  if (N.lengthSq() < 1e-6) N = new THREE.Vector3(1, 0, 0).addScaledVector(T[0], -T[0].x);
  N.normalize();
  const Ns = [], Bs = [];
  for (let i = 0; i <= nA; i++) {
    if (i > 0) { const ax = new THREE.Vector3().crossVectors(T[i - 1], T[i]); if (ax.lengthSq() > 1e-12) N.applyAxisAngle(ax.normalize(), Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1))); N.addScaledVector(T[i], -N.dot(T[i])).normalize(); }
    Ns.push(N.clone()); Bs.push(new THREE.Vector3().crossVectors(T[i], N).normalize());
  }
  const ring = (c, t, Tn, Nn, Bn, k) => {
    const rr = spec(r, t, 0.1) * k, yy = spec(o.ry, t, 1), tw = o.twist ? o.twist(t) : 0, row = [];
    for (let j = 0; j < mR; j++) {
      const a = (j / mR) * TAU + tw, pf = o.prof ? o.prof(t, a) : 1;
      row.push(new THREE.Vector3().copy(c).addScaledVector(Nn, Math.cos(a) * rr * yy * pf).addScaledVector(Bn, Math.sin(a) * rr * pf));
    }
    return row;
  };
  const capN = round ? 2 : 0;
  // start cap rings
  const r0 = spec(r, 0, 0.1), r1 = spec(r, 1, 0.1);
  for (let c = capN; c >= 1; c--) { const a = (c / (capN + 1)) * PI / 2; rings.push(ring(P[0].clone().addScaledVector(T[0], -Math.sin(a) * r0 * round), 0, T[0], Ns[0], Bs[0], Math.cos(a))); }
  for (let i = 0; i <= nA; i++) rings.push(ring(P[i], i / nA, T[i], Ns[i], Bs[i], 1));
  for (let c = 1; c <= capN; c++) { const a = (c / (capN + 1)) * PI / 2; rings.push(ring(P[nA].clone().addScaledVector(T[nA], Math.sin(a) * r1 * round), 1, T[nA], Ns[nA], Bs[nA], Math.cos(a))); }
  const pos = [], idx = [];
  for (const rw of rings) for (const v of rw) pos.push(v.x, v.y, v.z);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < mR; j++) {
    const a = i * mR + j, b = i * mR + ((j + 1) % mR), c = a + mR, d = b + mR;
    idx.push(a, c, b, b, c, d);
  }
  // end points close the tube
  const e0 = pos.length / 3; const s0 = round ? P[0].clone().addScaledVector(T[0], -r0 * round) : P[0]; pos.push(s0.x, s0.y, s0.z);
  for (let j = 0; j < mR; j++) idx.push(e0, j, (j + 1) % mR);
  const e1 = pos.length / 3; const s1 = round ? P[nA].clone().addScaledVector(T[nA], r1 * round) : P[nA]; pos.push(s1.x, s1.y, s1.z);
  const last = (rings.length - 1) * mR;
  for (let j = 0; j < mR; j++) idx.push(e1, last + ((j + 1) % mR), last + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function sweep(p, m, pts, r, o = {}) { return add(p, mesh(fam(null, (q) => sweepGeo(pts, r, o, q)), m)); }
/** a rope or chain-line that sags between a and b */
export function rope(p, m, a, b, r = 0.012, sag = 0.06, n = 5) {
  if (!sag) return rod(p, m, a, b, r, r, 3);
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t)]); }
  return sweep(p, m, pts, r, { n: n * 2, m: 3, minM: 3, round: 0 });
}
/** a horn or claw: a curved cone from base along pts */
export function horn(p, m, pts, r0, r1 = 0.004, o = {}) { return sweep(p, m, pts, (t) => lerp(r0, r1, Math.pow(t, o.pow ?? 1.1)), { n: o.n ?? 7, m: o.m ?? 6, round: 0.4, ...o }); }

// ---- surfaces: a grid between two edges (wing membranes, sails, cloth) ----
/** quad patch: f(u, v) -> [x, y, z] over nu x nv cells (double-sided by the material) */
export function patchGeo(f, nu, nv) {
  const pos = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(...f(i / nu, j / nv));
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export function patch(p, m, f, nu = 8, nv = 4) { return add(p, mesh(fam(null, (q) => patchGeo(f, Math.max(1, Math.round(nu * [1, 0.7, 0.5, 0.35][q])), Math.max(1, Math.round(nv * [1, 0.7, 0.5, 0.35][q])))), m)); }

// ---- emblems: unit-sized outlines in the x-y plane, extruded along +z ----
const V = (x, y) => new THREE.Vector2(x, y);
const poly = (pts) => new THREE.Shape(pts.map(([x, y]) => V(x, y)));
const circ = (cx, cy, r, n = 20, rev = false) => { const p = []; for (let i = 0; i < n; i++) { const a = ((rev ? -i : i) / n) * TAU; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return p; };
const star = (n, r0, r1, rot = PI / 2) => { const p = []; for (let i = 0; i < n * 2; i++) { const a = rot + (i / (n * 2)) * TAU, r = i % 2 ? r1 : r0; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; };
const holed = (outer, ...holes) => { const s = poly(outer); for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => V(x, y)))); return s; };
const mirr = (half) => half.concat(half.slice().reverse().map(([x, y]) => [-x, y]));
const EMB = {
  lion: () => [poly([[-0.45, -1], [-0.3, -0.55], [-0.55, -0.2], [-0.75, 0.15], [-0.6, 0.15], [-0.4, -0.05], [-0.25, 0.2], [-0.35, 0.55], [-0.2, 0.85], [0.05, 1], [0.3, 0.9], [0.45, 0.95], [0.35, 0.72], [0.55, 0.65], [0.4, 0.5], [0.2, 0.5], [0.15, 0.3], [0.5, 0.45], [0.7, 0.75], [0.62, 0.35], [0.35, 0.05], [0.3, -0.25], [0.55, -0.45], [0.75, -0.3], [0.85, -0.55], [0.6, -0.65], [0.3, -0.55], [0.15, -0.75], [0.25, -1], [0.0, -0.95], [-0.1, -0.7], [-0.2, -1]])],
  comet: () => [poly([[0.55, 0.55], [0.85, 0.3], [0.75, 0.05], [0.95, 0], [0.6, -0.1], [0.3, -0.6], [0.25, -0.25], [-0.9, -0.95], [0.05, -0.05], [-0.95, -0.55], [0.0, 0.15], [-0.85, 0.05], [0.15, 0.45], [0.35, 0.85]])],
  star: () => [poly(star(5, 1, 0.42))],
  star8: () => [poly(star(8, 1, 0.68, 0))],
  sun: () => [holed(star(14, 1, 0.68, 0), circ(0, 0, 0.38, 16, true))],
  wingedSun: () => [poly(mirr([[0, 0.45], [0.3, 0.35], [0.4, 0.15], [0.6, 0.3], [0.85, 0.35], [1, 0.25], [0.8, 0.12], [0.95, 0.05], [0.7, -0.05], [0.85, -0.15], [0.55, -0.15], [0.35, -0.15], [0.25, -0.35], [0, -0.42]]))],
  crescent: () => { const p = []; for (let i = 0; i <= 18; i++) { const a = (49.5 + (i / 18) * 261) * PI / 180; p.push([Math.cos(a), Math.sin(a)]); } for (let i = 0; i <= 14; i++) { const a = (288.2 - (i / 14) * 216.4) * PI / 180; p.push([0.4 + Math.cos(a) * 0.8, Math.sin(a) * 0.8]); } return [poly(p)]; },
  skull: () => [holed(mirr([[0, 1], [0.55, 0.85], [0.75, 0.4], [0.65, 0], [0.45, -0.2], [0.45, -0.55], [0.25, -0.75], [0.1, -0.6], [0, -0.75]]), circ(-0.3, 0.15, 0.2, 10, true), circ(0.3, 0.15, 0.2, 10, true), [[0, -0.05], [0.1, -0.3], [-0.1, -0.3]])],
  skullHorn: () => [...EMB.skull(), poly([[-0.55, 0.65], [-1, 1], [-0.95, 0.4], [-0.7, 0.35]]), poly([[0.55, 0.65], [1, 1], [0.95, 0.4], [0.7, 0.35]])],
  horns: () => [poly(mirr([[0, -0.2], [0.25, -0.1], [0.55, 0.15], [0.8, 0.6], [0.75, 1], [0.95, 0.55], [0.85, 0.05], [0.5, -0.4], [0.2, -0.75], [0, -0.9]]))],
  cross: () => [poly(mirr([[0, 1], [0.35, 1], [0.15, 0.25], [0.15, 0.15], [0.25, 0.15], [1, 0.35], [1, -0.35], [0.25, -0.15], [0.15, -0.15], [0.15, -0.25], [0.35, -1], [0, -1]]))],
  crown: () => [poly(mirr([[0, -0.6], [0.8, -0.6], [0.85, 0.6], [0.55, 0.15], [0.3, 0.75], [0.1, 0.2], [0, 0.9]]))],
  leaf: () => [poly([[0, -1], [0.3, -0.6], [0.55, -0.1], [0.5, 0.4], [0.2, 0.8], [0, 1], [-0.2, 0.8], [-0.5, 0.4], [-0.55, -0.1], [-0.3, -0.6], [-0.05, -0.85], [-0.05, -1]])],
  anvil: () => [poly([[-1, 0.6], [0.7, 0.6], [0.95, 0.35], [0.4, 0.2], [0.25, -0.25], [0.55, -0.6], [0.6, -0.85], [-0.6, -0.85], [-0.55, -0.6], [-0.25, -0.25], [-0.4, 0.2], [-0.75, 0.35]])],
  hammer: () => [poly([[-0.9, 0.95], [0.9, 0.95], [0.9, 0.35], [0.12, 0.35], [0.12, -1], [-0.12, -1], [-0.12, 0.35], [-0.9, 0.35]])],
  gear: () => { const p = [], n = 10; for (let i = 0; i < n; i++) { const a = (i / n) * TAU, h = TAU / n; for (const [da, r] of [[0, 0.78], [h * 0.2, 1], [h * 0.5, 1], [h * 0.7, 0.78]]) p.push([Math.cos(a + da) * r, Math.sin(a + da) * r]); } return [holed(p, circ(0, 0, 0.35, 14, true))]; },
  eye: () => [holed([...circ(0, 0, 1, 24).map(([x, y]) => [x, y * 0.55])], circ(0, 0, 0.42, 16, true)), poly(circ(0, 0, 0.22, 12))],
  wheel: () => { const s = [holed(circ(0, 0, 1, 28), circ(0, 0, 0.82, 28, true)), poly(circ(0, 0, 0.18, 12))]; for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, c = Math.cos(a), si = Math.sin(a); s.push(poly([[c * 0.15 - si * 0.05, si * 0.15 + c * 0.05], [c * 0.85 - si * 0.07, si * 0.85 + c * 0.07], [c * 0.85 + si * 0.07, si * 0.85 - c * 0.07], [c * 0.15 + si * 0.05, si * 0.15 - c * 0.05]])); } return s; },
  lotus: () => [poly(mirr([[0, -0.6], [0.35, -0.55], [0.75, -0.35], [1, 0.05], [0.65, -0.05], [0.55, 0.45], [0.3, 0.15], [0.15, 0.7], [0, 1]]))],
  flame: () => [poly([[0, -1], [0.55, -0.75], [0.7, -0.2], [0.45, 0.25], [0.55, 0.65], [0.25, 0.4], [0.1, 1], [-0.15, 0.45], [-0.45, 0.7], [-0.35, 0.15], [-0.7, -0.15], [-0.6, -0.7]])],
  ziggurat: () => [poly(mirr([[0, 1], [0.2, 1], [0.2, 0.6], [0.45, 0.6], [0.45, 0.2], [0.7, 0.2], [0.7, -0.2], [0.95, -0.2], [0.95, -0.7], [0, -0.7]]))],
  maw: () => [holed(circ(0, 0, 1, 24), mirr([[0, 0.6], [0.25, 0.25], [0.45, 0.5], [0.55, 0.05], [0.7, 0.1], [0.55, -0.2], [0.45, -0.5], [0.25, -0.25], [0, -0.6]]).reverse())],
  slash: () => [0, 1, 2].map((i) => poly([[-0.75 + i * 0.5, -1], [-0.55 + i * 0.5, -1], [0.15 + i * 0.4, 1], [-0.05 + i * 0.4, 0.9]])),
  tusks: () => [poly([[-0.25, -0.3], [-0.55, 0.2], [-0.5, 0.95], [-0.35, 0.3], [-0.05, -0.1]]), poly([[0.25, -0.3], [0.55, 0.2], [0.5, 0.95], [0.35, 0.3], [0.05, -0.1]]), poly(mirr([[0, -0.1], [0.4, -0.25], [0.55, -0.6], [0.3, -0.95], [0, -0.85]]))],
  rune: () => [poly([[-0.15, -1], [0.15, -1], [0.15, -0.1], [0.75, 0.45], [0.55, 0.65], [0.15, 0.3], [0.15, 1], [-0.15, 1], [-0.15, 0.3], [-0.55, 0.65], [-0.75, 0.45], [-0.15, -0.1]])],
  wolf: () => [poly([[-0.6, 1], [-0.35, 0.45], [0.35, 0.45], [0.6, 1], [0.65, 0.2], [0.45, -0.25], [0.2, -0.95], [0, -1], [-0.2, -0.95], [-0.45, -0.25], [-0.65, 0.2]])],
  tamga: () => [poly([[-0.12, -1], [0.12, -1], [0.12, 0.1], [0.6, 0.6], [0.6, 1], [0.42, 1], [0.42, 0.7], [0, 0.32], [-0.42, 0.7], [-0.42, 1], [-0.6, 1], [-0.6, 0.6], [-0.12, 0.1]]), poly(circ(0, -0.45, 0.25, 12))],
  triskele: () => [0, 1, 2].map((i) => { const a0 = (i / 3) * TAU, pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10, a = a0 + t * 3.2, r = 0.15 + t * 0.85; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } for (let k = 10; k >= 0; k--) { const t = k / 10, a = a0 + t * 3.2 - 0.35, r = 0.1 + t * 0.7; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } return poly(pts); }),
  tree: () => [poly([[-0.12, -1], [0.12, -1], [0.18, -0.2], [0.5, 0.05], [0.95, 0.15], [0.7, 0.5], [0.35, 0.45], [0.3, 0.85], [0, 0.65], [-0.3, 0.85], [-0.35, 0.45], [-0.7, 0.5], [-0.95, 0.15], [-0.5, 0.05], [-0.18, -0.2]])],
  cobra: () => [poly(mirr([[0, 1], [0.3, 0.9], [0.55, 0.5], [0.6, 0.0], [0.4, -0.25], [0.15, -0.3], [0.2, -0.6], [0.45, -0.85], [0.1, -1], [0, -0.95]]))],
  wave: () => [poly([[-1, -0.6], [-1, 0], [-0.7, 0.45], [-0.3, 0.6], [0.05, 0.4], [0.05, 0.05], [-0.2, 0.15], [-0.25, -0.05], [0.1, -0.25], [0.5, 0.0], [0.9, 0.35], [1, -0.6]])],
  mushroom: () => [poly([[-0.2, -1], [0.2, -1], [0.25, 0.1], [0.95, 0.15], [0.7, 0.6], [0, 0.85], [-0.7, 0.6], [-0.95, 0.15], [-0.25, 0.1]])],
  rose: () => { const p = []; for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU, r = 0.68 + 0.32 * Math.abs(Math.cos(a * 2.5)); p.push([Math.cos(a) * r, Math.sin(a) * r]); } return [holed(p, circ(0, 0, 0.3, 12, true)), poly(circ(0, 0, 0.22, 10))]; },
  anchor: () => [holed(mirr([[0, 1], [0.25, 0.9], [0.22, 0.65], [0.08, 0.6], [0.08, 0.4], [0.4, 0.4], [0.4, 0.28], [0.08, 0.28], [0.08, -0.8], [0.45, -0.55], [0.6, -0.25], [0.8, -0.5], [0.6, -0.8], [0.25, -1], [0, -1]]), circ(0, 0.8, 0.1, 8, true))],
  key: () => [holed([...circ(0, 0.55, 0.42, 16)].concat([[0.1, 0.15], [0.1, -0.5], [0.4, -0.5], [0.4, -0.65], [0.1, -0.65], [0.1, -0.8], [0.35, -0.8], [0.35, -0.95], [-0.1, -1], [-0.1, 0.15]]), circ(0, 0.55, 0.2, 10, true))],
  mon: () => [holed(circ(0, 0, 1, 28), circ(0, 0, 0.88, 28, true)), ...[0, 1, 2].flatMap((i) => { const a = (i / 3) * TAU, cx = Math.cos(a) * 0.36, cy = Math.sin(a) * 0.36, b = a + PI / 2; return [poly(circ(cx, cy, 0.26, 12)), poly([[cx + Math.cos(b) * 0.26, cy + Math.sin(b) * 0.26], [cx - Math.cos(b) * 0.05, cy - Math.sin(b) * 0.05], [Math.cos(a + 1.5) * 0.7, Math.sin(a + 1.5) * 0.7]])]; })],
  shell: () => { const p = [[0.25, -1], [0.3, -0.85]]; for (let i = 0; i <= 14; i++) { const a = PI * 0.2 + (i / 14) * PI * 0.6, r = i % 2 ? 1.75 : 1.9; p.push([Math.cos(a) * r * 0.62, -0.95 + Math.sin(a) * r]); } p.push([-0.3, -0.85], [-0.25, -1]); return [poly(p)]; },
  mask: () => [holed(mirr([[0, 0.25], [0.35, 0.45], [0.8, 0.55], [1, 0.75], [0.95, 0.2], [0.75, -0.25], [0.35, -0.25], [0.1, -0.05], [0, -0.1]]), circ(-0.5, 0.15, 0.17, 10, true), circ(0.5, 0.15, 0.17, 10, true))],
  fly: () => [poly(mirr([[0, 0.9], [0.18, 0.6], [0.25, 0.1], [0.95, 0.65], [0.8, 0.05], [0.2, -0.15], [0.25, -0.6], [0.1, -1], [0, -1]]))],
  axe: () => [poly([[-0.08, -1], [0.08, -1], [0.08, 0.35], [0.3, 0.2], [0.75, 0.05], [0.95, 0.5], [0.85, 0.95], [0.4, 0.75], [0.08, 0.7], [0.08, 0.95], [-0.08, 0.95], [-0.08, 0.7], [-0.4, 0.75], [-0.85, 0.95], [-0.95, 0.5], [-0.75, 0.05], [-0.3, 0.2], [-0.08, 0.35]])],
  acorn: () => [poly([[0, -1], [0.45, -0.6], [0.55, 0.05], [0.75, 0.1], [0.7, 0.45], [0.3, 0.6], [0.08, 0.65], [0.1, 1], [-0.08, 1], [-0.08, 0.65], [-0.3, 0.6], [-0.7, 0.45], [-0.75, 0.1], [-0.55, 0.05], [-0.45, -0.6]])],
  spiral: () => { const a = [], b = []; for (let i = 0; i <= 30; i++) { const t = i / 30, ang = t * TAU * 2.2, r = 0.12 + t * 0.85; a.push([Math.cos(ang) * r, Math.sin(ang) * r]); b.push([Math.cos(ang) * (r - 0.16), Math.sin(ang) * (r - 0.16)]); } return [poly(a.concat(b.reverse()))]; },
  serpent: () => { const a = [], b = []; for (let i = 0; i <= 20; i++) { const t = i / 20, x = -0.9 + t * 1.8, y = Math.sin(t * TAU * 1.1) * 0.55, w = 0.08 + 0.1 * Math.sin(t * PI); a.push([x, y + w]); b.push([x, y - w]); } a.push([1, 0.35], [0.95, 0.1]); return [poly(a.concat(b.reverse()))]; },
  dragon: () => EMB.serpent().concat([poly([[0.75, 0.1], [1, 0.25], [0.9, 0.55], [0.7, 0.35]]), poly(mirr([[0, -0.2], [0.15, 0.15], [0.05, 0.5]]).map(([x, y]) => [x - 0.2, y - 0.1]))]),
  eagle: () => [poly(mirr([[0, 0.95], [0.12, 0.75], [0.15, 0.4], [0.55, 0.7], [1, 0.75], [0.85, 0.45], [0.95, 0.3], [0.7, 0.2], [0.75, 0.0], [0.3, 0.05], [0.25, -0.35], [0.45, -0.85], [0.15, -0.7], [0, -1]]))],
  feather: () => [poly([[0, -1], [0.08, -0.6], [0.35, -0.2], [0.4, 0.4], [0.15, 0.9], [0, 1], [-0.25, 0.7], [-0.35, 0.2], [-0.25, -0.4], [-0.08, -0.6]])],
  bat: () => [poly(mirr([[0, 0.55], [0.12, 0.35], [0.3, 0.45], [0.6, 0.55], [1, 0.5], [0.85, 0.15], [0.7, 0.25], [0.6, -0.05], [0.45, 0.1], [0.35, -0.2], [0.15, -0.05], [0.1, -0.45], [0, -0.55]]))],
  owl: () => [holed(mirr([[0, 0.55], [0.3, 0.6], [0.55, 0.95], [0.6, 0.35], [0.55, -0.4], [0.3, -0.9], [0, -1]]), circ(-0.25, 0.2, 0.17, 10, true), circ(0.25, 0.2, 0.17, 10, true))],
};
EMB.moon = () => [...EMB.crescent(), poly(star(4, 0.3, 0.1).map(([x, y]) => [x + 0.45, y + 0.25]))];
export const EMBLEMS = Object.keys(EMB);
/** an emblem as an extruded badge facing +z, about size units across */
export function emblem(p, m, name, size = 1, depth = 0.04) {
  const k = EMB[name] ? name : 'star';
  const f = fam(`emb:${k}:${depth}`, (q) => {
    const g = new THREE.ExtrudeGeometry(EMB[k](), { depth: depth, bevelEnabled: q < 1, bevelThickness: depth * 0.4, bevelSize: 0.03, bevelSegments: 1, curveSegments: 4 });
    return g.translate(0, 0, -depth / 2);
  });
  return add(p, mesh(f, m, 0, 0, 0, size / 2, size / 2, 1));
}

// ---- cloth: banners and flags, waving gently (static); hoist along local y at x = 0, fly toward -x ----
/**
 * kind: swallow | square | pennon | streamer | gonfalon | nobori | tatter | triangle | bunting(one pennant)
 * vertical kinds (gonfalon, nobori, tatter) hang from a crossbar: top edge at y = 0, fly downward, width along -x.
 */
export function clothGeo(kind, w, h, q, seed = 0, wave = 1) {
  const vertical = kind === 'gonfalon' || kind === 'nobori' || kind === 'tatter' || kind === 'standard';
  const nu = Math.max(2, Math.round(8 * [1, 0.7, 0.5, 0.35][q])), nv = Math.max(1, Math.round(5 * [1, 0.7, 0.5, 0.35][q]));
  return patchGeo((u, v) => {
    // u: from the hoist (0) to the fly (1); v: across (0 at the top)
    let x, y, len = 1, z;
    if (!vertical) {
      if (kind === 'swallow') len = 1 - 0.32 * (1 - Math.abs(2 * v - 1));
      else if (kind === 'pennon' || kind === 'triangle' || kind === 'bunting') { const k = kind === 'pennon' ? 0.92 : 1; y = -h / 2 + (v - 0.5) * h * (1 - k * u); }
      else if (kind === 'streamer') { y = -h / 2 + (v - 0.5) * h * (1 - 0.75 * u); }
      x = -u * w * (kind === 'swallow' ? len : 1);
      if (y === undefined) y = -v * h;
      z = wave * Math.sin(u * 5.5 + seed) * 0.07 * u * w;
    } else {
      // hangs down: across = u (along -x), down = v
      let drop = 1;
      if (kind === 'gonfalon') drop = 1 - 0.22 * Math.abs(Math.sin(u * PI * 3));
      else if (kind === 'tatter') drop = 0.72 + 0.28 * hash(Math.floor(u * 7) + seed * 13);
      else if (kind === 'standard') drop = 1 - 0.35 * Math.abs(u - 0.5) * 2;
      x = -u * w; y = -v * h * drop;
      z = wave * Math.sin(v * 4 + u * 2 + seed) * 0.05 * v * h;
    }
    return [x, y, z];
  }, nu, nv);
}
export function cloth(p, m, kind, w, h, seed = 0, wave = 1) {
  return add(p, mesh(fam(null, (q) => clothGeo(kind, w, h, q, seed, wave)), m));
}
/** the cloth's own z offset at (u, v), so badges can sit on it */
export function clothZ(kind, w, h, u, v, seed = 0, wave = 1) {
  const vertical = kind === 'gonfalon' || kind === 'nobori' || kind === 'tatter' || kind === 'standard';
  return vertical ? wave * Math.sin(v * 4 + u * 2 + seed) * 0.05 * v * h : wave * Math.sin(u * 5.5 + seed) * 0.07 * u * w;
}

// ---- materials: one vertex-coloured material per model (damage darkens it) plus private glows and side colours ----
const SOOT = new THREE.Color(0x2a221c);
export function tintSet() {
  const paint = sculptMaterial().clone();
  paint.color.set(0xffffff);
  const glows = [];
  return {
    paint, glows,
    /** an ordinary surface colour (baked into vertex colours) */
    t(color, o = {}) { const { side, ...rest } = o; void side; return mat(color, rest); },
    /** a surface that lights itself a little (windows, runes); baked, does not flicker */
    lit(color, k = 0.8) { return mat(color, { emissive: color, emissiveIntensity: k, roughness: 0.6 }); },
    /** private emissive material (glows; flickers) */
    glow(color, k = 1.2, o = {}) { const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.6, ...o }); m.userData.glowBase = k; glows.push(m); return m; },
    damage(lv) { paint.color.setRGB(1, 1, 1).lerp(SOOT, lv * 0.2); },
  };
}
export const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
export const mixc = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

// ---- bake: merge static meshes under each moving part, per detail level ----
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const PBR = new Map();
function pbrOf(m) {
  if (!PBR.has(m)) {
    const e = m.emissive && m.emissiveIntensity && (m.emissive.r + m.emissive.g + m.emissive.b) > 0 ? m.emissiveIntensity : 0;
    PBR.set(m, [m.roughness ?? 0.85, m.metalness ?? 0, e]);
  }
  return PBR.get(m);
}
function mergeItems(list, q, paint) {
  const srcs = list.map((it) => (it.fam ? it.fam(q) : it.geo));
  let n = 0;
  for (const g of srcs) n += g.index ? g.index.count : g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = paint ? new Float32Array(n * 3) : null, pbr = paint ? new Float32Array(n * 3) : null;
  let w = 0;
  list.forEach((it, k) => {
    const g = srcs[k];
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, I = g.index, cnt = I ? I.count : P.count;
    _nm.getNormalMatrix(it.M);
    for (let i = 0; i < cnt; i++) {
      const r = i % 3, t = it.flip && r ? i - r + (3 - r) : i;
      const vi = I ? I.getX(t) : t;
      _v.fromBufferAttribute(P, vi).applyMatrix4(it.M); _n.fromBufferAttribute(N, vi).applyMatrix3(_nm).normalize();
      const o = w * 3;
      pos[o] = _v.x; pos[o + 1] = _v.y; pos[o + 2] = _v.z; nor[o] = _n.x; nor[o + 1] = _n.y; nor[o + 2] = _n.z;
      if (paint) { col[o] = it.col[0]; col[o + 1] = it.col[1]; col[o + 2] = it.col[2]; pbr[o] = it.pbr[0]; pbr[o + 1] = it.pbr[1]; pbr[o + 2] = it.pbr[2]; }
      w++;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (paint) { g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 3)); }
  g.computeBoundingSphere();
  return g;
}
/**
 * `movers`: objects that animate or toggle (their own subtree is baked into them, not into the parent).
 * Returns the LOD table entries [{ mesh, geos }] for model.userData.lod.
 */
export function bake(root, movers, T) {
  const pivots = new Set([root, ...movers]);
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !pivots.has(o) && !o.userData.keep) meshes.push(o); });
  const buckets = new Map(), inv = new THREE.Matrix4();
  for (const m of meshes) {
    let p = m.parent;
    while (!pivots.has(p)) p = p.parent;
    let d = 5;
    for (let a = m; a; a = a.parent) { if (a.userData.d !== undefined) d = Math.min(d, a.userData.d); if (a === root) break; }
    const M = inv.copy(p.matrixWorld).invert().multiply(m.matrixWorld).clone();
    const mt = m.material, paint = !mt.transparent && mt.userData.glowBase === undefined && !mt.userData.keep;
    const key = paint ? 'paint' : mt.uuid;
    if (!buckets.has(p)) buckets.set(p, new Map());
    const b = buckets.get(p);
    if (!b.has(key)) b.set(key, { m: paint ? T.paint : mt, paint, list: [] });
    b.get(key).list.push({ fam: m.userData.fam, geo: m.geometry, M, flip: M.determinant() < 0, d, col: paint ? [mt.color.r, mt.color.g, mt.color.b] : null, pbr: paint ? pbrOf(mt) : null });
    m.parent.remove(m);
  }
  const out = [];
  for (const [p, b] of buckets) for (const { m, paint, list } of b.values()) {
    const geos = [], memo = new Map();
    for (let lv = 0; lv < 6; lv++) {
      const q = RES[lv], items = list.filter((it) => it.d >= lv), k = `${q}|${items.length}`;
      if (!memo.has(k)) memo.set(k, items.length ? mergeItems(items, q, paint) : EMPTY);
      geos.push(memo.get(k));
    }
    const o = new THREE.Mesh(geos[0], m);
    o.castShadow = !m.transparent; o.receiveShadow = false;
    p.add(o);
    out.push({ mesh: o, geos });
  }
  return out;
}
export const noCrew = (o) => { o.traverse((c) => { c.userData.noCrew = true; }); return o; };
/** a smooth 0 -> 1 -> 0 pulse over k in [0, 1] (rise until `peak`, then fall) */
export const pulse = (k, peak = 0.25) => (k <= 0 || k >= 1 ? 0 : k < peak ? Math.sin((k / peak) * PI / 2) : Math.cos(((k - peak) / (1 - peak)) * PI / 2) ** 2);
