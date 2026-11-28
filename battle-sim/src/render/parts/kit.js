// The parts library's tools: a kit that gathers low-poly primitives (each with its own colour, roughness, metalness
// and glow) into one merged geometry drawn with the sculpt material, so a ship's whole dressing costs one draw call.
//   const k = new Kit(); k.push(x, y, z, rx, ry, rz); k.add(G.box(1, 1, 1), 0x6b4a2e, 0, 0.5, 0, { m: 0.6 }); k.pop();
//   const mesh = k.mesh();      // or k.build() for the geometry alone
import * as THREE from 'three';
import { sculptMaterial } from '../sculpt.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

// ---------- primitive geometries, cached by shape ----------
const cache = new Map();
const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
export const G = {
  box: (w, h, d) => memo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt, rb, h, n = 8, open = false) => memo(`c${rt},${rb},${h},${n},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, n, 1, open)),
  sph: (r, w = 8, h = 6) => memo(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  hemi: (r, w = 10, h = 5) => memo(`h${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2)),
  cone: (r, h, n = 8) => memo(`k${r},${h},${n}`, () => new THREE.ConeGeometry(r, h, n)),
  tor: (R, r, rs = 5, ts = 14, arc = Math.PI * 2) => memo(`t${R},${r},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc)),
  ico: (r, d = 0) => memo(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  oct: (r) => memo(`o${r}`, () => new THREE.OctahedronGeometry(r, 0)),
  dod: (r) => memo(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
  plane: (w, h) => memo(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
  circle: (r, n = 16) => memo(`ci${r},${n}`, () => new THREE.CircleGeometry(r, n)),
  ring: (a, b, n = 20) => memo(`r${a},${b},${n}`, () => new THREE.RingGeometry(a, b, n)),
  lathe: (key, pts, n = 10) => memo(`l${key}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), n)),
  /** a flat outline [[x, y], ...] in the xy plane, optionally extruded by depth along z (centred) */
  shape: (key, pts, depth = 0) => memo(`sh${key}`, () => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    if (!depth) return new THREE.ShapeGeometry(s);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }); g.translate(0, 0, -depth / 2); return g;
  }),
  /** a tube along points [[x, y, z], ...] */
  tube: (key, pts, r, seg = 16, rs = 5) => memo(`tu${key}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rs, false)),
  custom: (key, make) => memo(`x${key}`, make),
};

const colOf = (c) => (c && c.isColor ? c : _c.set(c ?? 0xff00ff));

export class Kit {
  constructor() { this.items = []; this.base = new THREE.Matrix4(); this.stack = []; }
  /** enter a local frame (position, euler rotation, uniform or [x, y, z] scale) */
  push(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    this.stack.push(this.base);
    const sc = Array.isArray(s) ? _s.set(s[0], s[1], s[2]) : _s.set(s, s, s);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), sc);
    this.base = this.base.clone().multiply(_m);
    return this;
  }
  pop() { this.base = this.stack.pop() || new THREE.Matrix4(); return this; }
  /** o: { rx, ry, rz, s, sx, sy, sz, r (roughness), m (metalness), g (glow), order } */
  add(geo, col, x = 0, y = 0, z = 0, o = {}) {
    const s = o.s ?? 1;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ')), _s.set(o.sx ?? s, o.sy ?? s, o.sz ?? s));
    const c = colOf(col);
    this.items.push({ geo, mtx: this.base.clone().multiply(_m), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.8, Math.min(0.55, o.m ?? 0), o.g ?? 0] });
    return this;
  }
  /** a round bar from a to b (local coordinates) */
  bar(a, b, r, col, o = {}, n = 6) {
    _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
    const len = _d.length(); if (len < 1e-5) return this;
    _q.setFromUnitVectors(UP, _d.normalize());
    _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    const c = colOf(col);
    this.items.push({ geo: G.cyl(o.r2 ?? r, r, 1, n).clone().scale(1, len, 1), mtx: this.base.clone().multiply(_m), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.8, Math.min(0.55, o.m ?? 0), o.g ?? 0] });
    return this;
  }
  /** a sagging chain or rope from a to b, as a tube */
  rope(a, b, sag, r, col, o = {}) {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]); }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 10, r, 4, false);
    const c = colOf(col);
    this.items.push({ geo, mtx: this.base.clone(), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.6, Math.min(0.55, o.m ?? 0.5), o.g ?? 0] });
    return this;
  }
  get empty() { return !this.items.length; }
  build() {
    let n = 0;
    const flat = this.items.map((it) => { const g = it.geo.index ? it.geo.toNonIndexed() : it.geo; n += g.attributes.position.count; return [it, g]; });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), M = new Float32Array(n * 3);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let o = 0;
    for (const [it, g] of flat) {
      const pa = g.attributes.position, na = g.attributes.normal;
      nm.getNormalMatrix(it.mtx);
      for (let i = 0; i < pa.count; i++, o++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(it.mtx); P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
        if (na) { v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); N[o * 3] = v.x; N[o * 3 + 1] = v.y; N[o * 3 + 2] = v.z; } else N[o * 3 + 1] = 1;
        C[o * 3] = it.c[0]; C[o * 3 + 1] = it.c[1]; C[o * 3 + 2] = it.c[2];
        M[o * 3] = it.pbr[0]; M[o * 3 + 1] = it.pbr[1]; M[o * 3 + 2] = it.pbr[2];
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }
  /** the merged mesh (marked so the crew system ignores it) */
  mesh(material = sculptMaterial()) {
    const m = new THREE.Mesh(this.build(), material);
    m.castShadow = true; m.receiveShadow = true; m.userData.noCrew = true;
    return m;
  }
}

/** colour helpers (hex in, hex out) */
export function shade(hex, k) { _c.set(hex); return _c.multiplyScalar(k).getHex(); }
export function blend(a, b, t) { _c.set(a); return _c.lerp(new THREE.Color(b), t).getHex(); }
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// common colours
export const C = {
  wood: 0x6b4a2e, dark: 0x4a3220, plank: 0x8a6a44, rope: 0xc8b88a, iron: 0x3a3a40, steel: 0x9aa2aa, bronze: 0xb08a3a, gold: 0xd4a83a,
  stone: 0x8f8a7c, darkStone: 0x3a3836, bone: 0xd8cfb4, cloth: 0xe8e0c8, fire: 0xff7a22, green: 0x6aff5a, black: 0x161616, red: 0x9a1a14,
  leaf: 0x4f8a34, felt: 0xb8a07a, brick: 0x8a4a32, flesh: 0xb06a5a, slime: 0x8ad83a,
};
