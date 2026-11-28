// Shared bits for the sky library: low-poly primitives, wing outlines, per-model tintable materials,
// and a baker that merges every static mesh under each moving part into one mesh per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mat } from '../models.js';

export { THREE, mat };
export const PI = Math.PI, TAU = Math.PI * 2;

// ---- cached unit geometries (scaled per mesh; the baker applies the transforms) ----
const G = new Map();
const geo = (k, make) => { if (!G.has(k)) G.set(k, make()); return G.get(k); };
export const SPH = () => geo('sph', () => new THREE.SphereGeometry(1, 10, 7));
export const SPH_LO = () => geo('sphlo', () => new THREE.SphereGeometry(1, 7, 5));
export const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
export const CYL = (s = 7) => geo(`cyl${s}`, () => new THREE.CylinderGeometry(1, 1, 1, s));
export const CONE = (s = 6) => geo(`cone${s}`, () => new THREE.ConeGeometry(1, 1, s));
export const TORUS = (t = 0.06, rs = 20) => geo(`tor${t},${rs}`, () => new THREE.TorusGeometry(1, t, 4, rs));
export const OCTA = () => geo('octa', () => new THREE.OctahedronGeometry(1, 0));

export function mesh(g, m, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z); o.scale.set(sx, sy, sz);
  return o;
}
export const ell = (p, m, x, y, z, rx, ry = rx, rz = rx, lo = false) => add(p, mesh(lo ? SPH_LO() : SPH(), m, x, y, z, rx, ry, rz));
export const blk = (p, m, x, y, z, w, h, d) => add(p, mesh(BOX(), m, x, y, z, w, h, d));
export function add(p, o) { p.add(o); return o; }
export function group(p, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); if (p) p.add(g); return g; }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** a tapered rod from a to b (radius ra at a, rb at b) */
export function rod(p, m, a, b, ra, rb = ra, sides = 6) {
  _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
  const len = _d.length(), big = Math.max(ra, rb, 1e-4), kt = Math.round((rb / big) * 20) / 20, kb = Math.round((ra / big) * 20) / 20;
  const o = new THREE.Mesh(geo(`rod${kt},${kb},${sides}`, () => new THREE.CylinderGeometry(kt, kb, 1, sides)), m);
  o.scale.set(big, len, big);
  o.position.copy(_a).addScaledVector(_d, 0.5);
  o.quaternion.setFromUnitVectors(_up, _d.normalize());
  p.add(o); return o;
}
/** a cone from base point a pointing at b */
export function spike(p, m, a, b, r, sides = 5) {
  _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
  const len = _d.length();
  const o = new THREE.Mesh(CONE(sides), m); o.scale.set(r, len, r);
  o.position.copy(_a).addScaledVector(_d, 0.5);
  o.quaternion.setFromUnitVectors(_up, _d.normalize());
  p.add(o); return o;
}
/** a flat double-sided plate from an outline [[x, s], ...] lying in the x-z plane (s → +z), lifted by y */
export function plate(p, m, pts, y = 0, cache = null) {
  const make = () => {
    const sh = new THREE.Shape(pts.map(([x, s]) => new THREE.Vector2(x, s)));
    return new THREE.ShapeGeometry(sh).rotateX(PI / 2);
  };
  const g = cache ? geo(cache, make) : make();
  const o = new THREE.Mesh(g, m); o.position.y = y; p.add(o); return o;
}
/** surface of revolution around +y from [[r, y], ...] */
export function lathe(p, m, prof, segs = 12, key = null, phiStart = 0, phiLen = TAU) {
  const make = () => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), segs, phiStart, phiLen);
  const o = new THREE.Mesh(key ? geo(key, make) : make(), m); p.add(o); return o;
}

// ---- materials: each model gets its own tintable copies of its main colours ----
export function tintSet() {
  const list = [];
  return {
    list,
    /** a private material that darkens with damage */
    t(color, o = {}) { const m = mat(color, o).clone(); m.userData.base = m.color.clone(); list.push(m); return m; },
    /** private emissive material (glows; flickers) */
    glow(color, k = 1.2, o = {}) { const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.6, ...o }); m.userData.glowBase = k; return m; },
    damage(lv) { for (const m of list) m.color.copy(m.userData.base).lerp(SOOT, lv * 0.17); },
  };
}
const SOOT = new THREE.Color(0x1c1814);
export const shade = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
export const mixc = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

// ---- bake: merge static meshes under each moving part, one mesh per material ----
/** `movers`: objects that animate or toggle (their own subtree is baked into them, not into the parent) */
export function bake(root, movers) {
  const pivots = new Set([root, ...movers]);
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && !pivots.has(o) && !o.userData.keep) meshes.push(o); });
  const buckets = new Map(), inv = new THREE.Matrix4();
  for (const m of meshes) {
    let p = m.parent;
    while (!pivots.has(p)) p = p.parent;
    let g = m.geometry.clone().applyMatrix4(inv.copy(p.matrixWorld).invert().multiply(m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const flip = new THREE.Matrix4().copy(p.matrixWorld).invert().multiply(m.matrixWorld).determinant() < 0;
    if (flip) {
      const pos = g.attributes.position.array, nor = g.attributes.normal.array;
      for (let i = 0; i < pos.length; i += 9) for (const arr of [pos, nor]) for (let j = 0; j < 3; j++) { const t = arr[i + 3 + j]; arr[i + 3 + j] = arr[i + 6 + j]; arr[i + 6 + j] = t; }
    }
    const key = m.material.uuid + (m.userData.noCrew ? '!' : '');
    if (!buckets.has(p)) buckets.set(p, new Map());
    const b = buckets.get(p);
    if (!b.has(key)) b.set(key, { m: m.material, noCrew: !!m.userData.noCrew, list: [] });
    b.get(key).list.push(g);
    m.parent.remove(m);
  }
  for (const [p, b] of buckets) for (const { m, noCrew, list } of b.values()) {
    const o = new THREE.Mesh(mergeGeometries(list, false), m);
    o.castShadow = !m.transparent; o.receiveShadow = false;
    if (noCrew) o.userData.noCrew = true;
    p.add(o);
  }
  // prune empty groups left behind
  return root;
}
export const noCrew = (o) => { o.traverse((c) => { c.userData.noCrew = true; }); return o; };

// ---- wing outlines [[x (chord, + forward), s (span, outward)]] ----
/** feathered wing: inner arm panel and outer hand panel with splayed primaries */
export function featherWing(c0, s1, s2, fingers = 5, o = {}) {
  const c1 = c0 * (o.taper ?? 0.85), lead = o.lead ?? 0.3;
  const inner = [[c0 * lead, -0.05], [c1 * lead + 0.05, s1 + 0.05], [-c1 * (1 - lead), s1 + 0.05]];
  // secondaries: scalloped trailing edge back to the root
  const n = 4;
  for (let i = 1; i <= n; i++) { const k = 1 - i / n, s = s1 * k; inner.push([-(c0 + (c1 - c0) * k) * (1 - lead) - (i % 2 ? 0.12 : 0), s]); }
  inner.push([-c0 * (1 - lead) * 0.6, -0.05]);
  const outer = [[c1 * lead, -0.05], [c1 * lead * 0.2, s2 * 0.75]];
  // primaries: long separate fingers fanning back from the tip
  const tipX = o.tipX ?? -c1 * 0.1;
  for (let i = 0; i < fingers; i++) {
    const k = i / Math.max(1, fingers - 1);
    const fx = tipX - k * c1 * 0.8, fs = s2 * (1 - k * 0.3);
    const w = c1 * 0.09;
    outer.push([fx + w, fs - (o.blunt ? 0 : 0.15)], [fx, fs], [fx - w, fs - 0.12]);
    if (i < fingers - 1) outer.push([fx - w * 1.3, fs - 0.45 - k * 0.2]);
  }
  outer.push([-c1 * (1 - lead), s2 * 0.35], [-c1 * (1 - lead), -0.05]);
  return { inner, outer };
}
/** membrane (bat / dragon) wing with fingers: returns panels and the finger bone tips */
export function batWing(c0, s1, s2, fingers = 3, o = {}) {
  const inner = [[c0 * 0.25, -0.05], [0.12, s1 + 0.04], [-c0 * 0.15, s1 + 0.04], [-c0 * 0.62, s1 * 0.55], [-c0 * (o.back ?? 0.8), -0.05]];
  // outer: leading edge to the tip, scalloped between finger tips back to the elbow
  const tips = [];
  for (let i = 0; i < fingers; i++) {
    const k = i / Math.max(1, fingers - 1);
    tips.push([-0.2 - k * c0 * 1.05 - (o.sweep ?? 0.3) * (1 - k), s2 * (1 - k * 0.45)]);
  }
  const outer = [[0.12, -0.04], [0.05, s2 * 0.55], [tips[0][0] + 0.35, s2 * 1.0]];
  outer.push(tips[0]);
  for (let i = 1; i < fingers; i++) {
    const a = tips[i - 1], b = tips[i];
    outer.push([(a[0] + b[0]) / 2 + 0.25, (a[1] + b[1]) / 2 - 0.25], b);
  }
  if (fingers === 1) outer.push([tips[0][0] - c0 * 0.45, s2 * 0.6], [-c0 * 0.75, s2 * 0.25]);
  outer.push([-c0 * 0.3, 0.25], [-c0 * 0.15, -0.04]);
  return { inner, outer, tips };
}
