// The parts library's tools: a kit that gathers primitives (each with its own colour, roughness, metalness and glow)
// into one merged geometry drawn with the sculpt material, so a ship's whole dressing costs one draw call, with up to
// six detail levels for rigkit.setLod (0 closest .. 5 farthest).
//   const k = new Kit(); k.push(x, y, z, rx, ry, rz); k.add(G.box(1, 1, 1), 0x6b4a2e, 0, 0.5, 0, { m: 0.6 }); k.pop();
//   k.detail(1, () => { ...rivets, seams: drawn at levels 0 and 1 only... });
//   const mesh = k.mesh();      // or k.build(level) for the geometry alone; mesh.userData.lodGeos holds every level
//
// Shapes beyond the primitives (all cached by key; the *L variants return one geometry per detail level):
//   loft(key, stations, o)      a body swept through rings of varying size: necks, tails, beast bodies, hulls of floats
//   taper(key, pts, radii, ..)  a tube whose radius changes along it: horns, tusks, tentacles, ropes
//   clothPanel(key, fn, ..)     a bellied sail or banner with darker seams baked into its vertex colours
//   boatHull(key, o)            a planked boat hull with sheer, rocker, a transom or a pointed stern, and its deck
//   ribbon(key, pts, w)         a flat strip along a path (paint bands, wales, straps)
//   Kit.chain(a, b, sag, size)  a hanging chain of links (a tube from far away)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sculptMaterial } from '../sculpt.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/** a geometry with nothing in it: a detail level where a part is not drawn */
export const EMPTY_GEO = new THREE.BufferGeometry();
EMPTY_GEO.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
export const LEVELS = 6;

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
  /** a flat outline [[x, y], ...] in the xy plane, optionally extruded by depth along z (centred); bevel rounds its edges */
  shape: (key, pts, depth = 0, bevel = 0) => memo(`sh${key}`, () => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    if (!depth) return new THREE.ShapeGeometry(s);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 }); g.translate(0, 0, -depth / 2); return g;
  }),
  /** a tube along points [[x, y, z], ...] */
  tube: (key, pts, r, seg = 16, rs = 5) => memo(`tu${key}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rs, false)),
  custom: (key, make) => memo(`x${key}`, make),
  /** a rounded box (bevelled edges) */
  rbox: (w, h, d, r = 0.02, seg = 1) => memo(`rb${w},${h},${d},${r},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.05, h / 2.05, d / 2.05))),
};

const colOf = (c) => (c && c.isColor ? c : _c.set(c ?? 0xff00ff));
const hexLin = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };

// ---------- lofted shapes ----------
/**
 * A body swept through rings. stations: [[x, y, z, rw, rh, o?], ...] along a path (rw: half width across, rh: half
 * height); o (per station, optional): { n: superellipse exponent (2 round, 4 boxy), fl: 0..1 flatten the underside,
 * up: 0..1 raise the ring's centre by this much of rh, c: hex colour of this ring }.
 * opts: { radial: ring vertices (default 12), sub: smoothing steps between stations (default 2), cap: [start, end],
 *         belly: hex colour of the underside (blended by how far down the ring the vertex is), col: base hex,
 *         ridge: hex for the top line, paint: (t, a, side) => hex|null, lat: [lx, ly, lz] the ring's sideways axis }.
 * The ring's sideways axis is horizontal (perpendicular to the path and to world up) unless opts.lat is given.
 * Returns an indexed geometry with a colour attribute (multiply by white in the kit to keep its colours).
 */
export function loft(key, stations, opts = {}) {
  return memo(`lo${key}`, () => buildLoft(stations, opts));
}
/** loft at three densities: [lv0, lv0, lv2, lv3, lv3, lv3] (pass to Kit.add as the geometry) */
export function loftL(key, stations, opts = {}) {
  const r = opts.radial ?? 12, s = opts.sub ?? 2;
  const a = loft(`${key}|0`, stations, opts), b = loft(`${key}|1`, stations, { ...opts, radial: Math.max(6, Math.round(r * 0.6)), sub: Math.max(1, s - 1) }), c = loft(`${key}|2`, stations, { ...opts, radial: Math.max(5, Math.round(r * 0.4)), sub: 1 });
  return [a, a, b, c, c, c];
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function buildLoft(stations, o) {
  const radial = o.radial ?? 12, sub = o.sub ?? 2, n = stations.length;
  // smooth the stations: every numeric field interpolated with Catmull-Rom (radii clamped to >= 0)
  const S = [];
  const get = (i) => stations[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub, a = get(i - 1), b = get(i), c = get(i + 1), d = get(i + 2);
      const v = [0, 1, 2, 3, 4].map((j) => catmull(a[j], b[j], c[j], d[j], t));
      v[3] = Math.max(0, v[3]); v[4] = Math.max(0, v[4]);
      const ob = b[5] || {}, oc = c[5] || {};
      v[5] = { n: lerp(ob.n ?? 2, oc.n ?? 2, t), fl: lerp(ob.fl ?? 0, oc.fl ?? 0, t), up: lerp(ob.up ?? 0, oc.up ?? 0, t), c: t < 0.5 ? ob.c : oc.c ?? ob.c };
      S.push(v);
    }
  }
  const last = stations[n - 1]; S.push([last[0], last[1], last[2], last[3], last[4], { n: last[5]?.n ?? 2, fl: last[5]?.fl ?? 0, up: last[5]?.up ?? 0, c: last[5]?.c }]);
  const m = S.length, P = [], Cc = [], idx = [];
  const T = new THREE.Vector3(), L = new THREE.Vector3(), N = new THREE.Vector3(), lat0 = o.lat ? new THREE.Vector3(...o.lat).normalize() : null;
  const base = o.col ?? 0xffffff, belly = o.belly, ridge = o.ridge;
  const bc = hexLin(base), be = belly !== undefined ? hexLin(belly) : null, ri = ridge !== undefined ? hexLin(ridge) : null;
  for (let i = 0; i < m; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(m - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    if (lat0) { L.copy(lat0).addScaledVector(T, -lat0.dot(T)).normalize(); }
    else { L.crossVectors(T, UP); if (L.lengthSq() < 1e-6) L.set(0, 0, 1); L.normalize(); }
    N.crossVectors(L, T).normalize();
    const [x, y, z, rw, rh, so] = S[i];
    const rc = so.c !== undefined ? hexLin(so.c) : bc;
    for (let j = 0; j < radial; j++) {
      const ang = (j / radial) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang), e = 2 / so.n;
      let u = Math.sign(ca) * Math.pow(Math.abs(ca), e) * rw, v = Math.sign(sa) * Math.pow(Math.abs(sa), e) * rh;
      if (v < 0) v *= 1 - so.fl;
      v += so.up * rh;
      P.push(x + L.x * u + N.x * v, y + L.y * u + N.y * v, z + L.z * u + N.z * v);
      let col = rc;
      const down = Math.max(0, -sa);
      if (be && down > 0.25) { const f = Math.min(1, (down - 0.25) * 2.2); col = [lerp(col[0], be[0], f), lerp(col[1], be[1], f), lerp(col[2], be[2], f)]; }
      if (ri && sa > 0.93) col = ri;
      if (o.paint) { const h = o.paint(i / (m - 1), ang, ca); if (h !== null && h !== undefined) col = hexLin(h); }
      Cc.push(col[0], col[1], col[2]);
    }
  }
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = a + radial, d = b + radial;
    idx.push(a, c, b, b, c, d);
  }
  const cap = o.cap ?? [true, true];
  for (const [end, ring] of [[0, 0], [1, m - 1]]) {
    if (!cap[end]) continue;
    const s = S[ring]; if (s[3] < 1e-4 && s[4] < 1e-4) continue;
    let cx = 0, cy = 0, cz = 0, cr = 0, cg = 0, cb = 0;
    for (let j = 0; j < radial; j++) { const k = (ring * radial + j) * 3; cx += P[k]; cy += P[k + 1]; cz += P[k + 2]; cr += Cc[k]; cg += Cc[k + 1]; cb += Cc[k + 2]; }
    const ci = P.length / 3; P.push(cx / radial, cy / radial, cz / radial); Cc.push(cr / radial, cg / radial, cb / radial);
    for (let j = 0; j < radial; j++) { const a = ring * radial + j, b = ring * radial + ((j + 1) % radial); if (end === 0) idx.push(ci, b, a); else idx.push(ci, a, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** a tube through pts [[x, y, z], ...] whose radius goes through radii (one per point, or [start, end]) */
export function taper(key, pts, radii, seg = 12, radial = 6) {
  return memo(`ta${key}`, () => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const g = new THREE.TubeGeometry(curve, seg, 1, radial, false), p = g.attributes.position, c = new THREE.Vector3();
    const R = radii.length === pts.length ? radii : [radii[0], radii[radii.length - 1]];
    const rAt = (t) => { const f = t * (R.length - 1), i = Math.min(R.length - 2, Math.floor(f)); return R[i] + (R[i + 1] - R[i]) * (f - i); };
    for (let i = 0; i <= seg; i++) {
      curve.getPointAt(i / seg, c);
      const r = rAt(i / seg);
      for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; p.setXYZ(k, c.x + (p.getX(k) - c.x) * r, c.y + (p.getY(k) - c.y) * r, c.z + (p.getZ(k) - c.z) * r); }
    }
    g.computeVertexNormals();
    return g;
  });
}

/**
 * a cloth panel over u (across) and v (up), mapped by fn(u, v) -> [x, y, bellyK?, z?] and bellied along z by belly
 * (or set to the z fn returns);
 * seams: { u: n vertical seams, v: n horizontal, dark: shade of the seam rows (0.78) }; ragged edges come from fn.
 */
export function clothPanel(key, fn, belly, nu = 10, nv = 8, seams = null) {
  return memo(`cp${key}`, () => {
    const P = [], idx = [], Cc = [];
    const su = seams?.u ?? 0, sv = seams?.v ?? 0, dk = seams?.dark ?? 0.8;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, r = fn(u, v), [x, y, bk] = r;
      P.push(x, y, r.length > 3 ? r[3] : belly * Math.sin(Math.PI * u) * (bk ?? (0.35 + 0.65 * Math.sin(Math.PI * clamp(v, 0, 1)))));
      let k = 1;
      if (su && i % Math.max(1, Math.round(nu / su)) === 0 && i > 0 && i < nu) k = dk;
      if (sv && j % Math.max(1, Math.round(nv / sv)) === 0 && j > 0 && j < nv) k = dk;
      if (i === 0 || i === nu || j === 0 || j === nv) k = Math.min(k, 0.86); // the bolt-rope hem
      Cc.push(k, k, k);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, d = a + nu + 1, e = d + 1; idx.push(a, b, e, a, e, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}

/** a flat strip along pts [[x, y, z], ...], width w across `side` ([0, 1, 0] by default: a vertical band) */
export function ribbon(key, pts, w, side = [0, 1, 0]) {
  return memo(`rib${key}`, () => {
    const P = [], idx = [], s = new THREE.Vector3(...side).normalize().multiplyScalar(w / 2);
    pts.forEach(([x, y, z]) => { P.push(x - s.x, y - s.y, z - s.z, x + s.x, y + s.y, z + s.z); });
    for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  });
}

/**
 * a boat hull, bow at +x, keel at y = 0, length l, beam w (full), depth h; o: { stern: 'transom' | 'point',
 * sheer: rise of the ends (fraction of h), rocker, flare (0..1 how much the topsides flare), deck: true,
 * strakes: n planking lines baked dark, col, deckCol, band: [hex, y0 (0..1 of h), y1] a painted band }.
 * Returns an indexed geometry with colours. Meant to be cached by key.
 */
export function boatHull(key, l, w, h, o = {}) {
  return memo(`bh${key}`, () => {
    const NU = o.nu ?? 22, NV = o.nv ?? 12, stern = o.stern ?? 'transom', sheer = o.sheer ?? 0.25, rocker = o.rocker ?? 0.12, flare = o.flare ?? 0.35;
    const col = hexLin(o.col ?? 0x6b4a2e), dcol = hexLin(o.deckCol ?? 0x9a7a52), dark = col.map((v) => v * 0.62);
    const band = o.band ? [hexLin(o.band[0]), o.band[1], o.band[2]] : null;
    const strakes = o.strakes ?? 5;
    const halfW = (u) => {
      // u: 0 stern .. 1 bow
      const bow = Math.pow(Math.sin(Math.min(1, (1 - u) / 0.42) * Math.PI / 2), 0.85);
      const st = stern === 'transom' ? 0.62 + 0.38 * Math.sin(Math.min(1, u / 0.3) * Math.PI / 2) : Math.pow(Math.sin(Math.min(1, u / 0.36) * Math.PI / 2), 0.9);
      return (w / 2) * Math.min(bow, st);
    };
    const top = (u) => h * (1 + sheer * Math.pow(Math.abs(2 * u - 1), 2.2) * (u > 0.5 ? 1.15 : 1));
    const keel = (u) => h * rocker * Math.pow(Math.abs(2 * u - 1), 3);
    const P = [], Cc = [], idx = [];
    // the shell: rings from port rail round the keel to starboard rail
    for (let i = 0; i <= NU; i++) {
      const u = i / NU, x = (u - 0.5) * l, hw = Math.max(0.004, halfW(u)), yt = top(u), yk = keel(u);
      for (let j = 0; j <= NV; j++) {
        const t = j / NV, a = (t - 0.5) * Math.PI; // -90 port rail .. 0 keel .. +90 starboard rail
        const s = Math.sin(a), c = Math.cos(a);
        const depth = Math.pow(c, 0.7);
        const y = yt - (yt - yk) * depth;
        const z = hw * Math.sign(s) * Math.pow(Math.abs(s), 0.55) * (1 - flare * 0.25 * (1 - Math.abs(s))) ;
        P.push(x, y, z);
        const fy = (y - yk) / Math.max(1e-3, yt - yk);
        let k = col;
        if (band && fy > band[1] && fy < band[2]) k = band[0];
        if (strakes && Math.abs(Math.sin(fy * Math.PI * strakes)) < 0.16 && fy < 0.97) k = [k[0] * 0.72, k[1] * 0.72, k[2] * 0.72];
        if (fy > 0.93) k = dark;
        Cc.push(k[0], k[1], k[2]);
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    // the transom
    if (stern === 'transom') {
      const ci = P.length / 3; P.push(-l / 2, (top(0) + keel(0)) / 2, 0); Cc.push(dark[0], dark[1], dark[2]);
      for (let j = 0; j < NV; j++) idx.push(ci, j + 1, j);
    }
    // the deck, a little under the rail
    if (o.deck !== false) {
      const d0 = P.length / 3;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU, x = (u - 0.5) * l, hw = Math.max(0.004, halfW(u)) * 0.96, y = top(u) - h * 0.1;
        for (const s of [-1, 1]) { P.push(x, y, s * hw); const k = i % 2 ? dcol : dcol.map((v) => v * 0.9); Cc.push(k[0], k[1], k[2]); }
      }
      for (let i = 0; i < NU; i++) { const a = d0 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    g.setIndex(idx); g.computeVertexNormals();
    g.userData.top = top; g.userData.halfW = halfW;
    return g;
  });
}

export class Kit {
  constructor() { this.items = []; this.base = new THREE.Matrix4(); this.stack = []; this.lv = LEVELS - 1; }
  /** enter a local frame (position, euler rotation, uniform or [x, y, z] scale) */
  push(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    this.stack.push(this.base);
    const sc = Array.isArray(s) ? _s.set(s[0], s[1], s[2]) : _s.set(s, s, s);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), sc);
    this.base = this.base.clone().multiply(_m);
    return this;
  }
  pop() { this.base = this.stack.pop() || new THREE.Matrix4(); return this; }
  /** everything fn adds is drawn only at detail levels 0..lv (1: the finest work, 2: middle distance, 3: silhouettes) */
  detail(lv, fn) { const was = this.lv; this.lv = Math.min(was, lv); try { fn(this); } finally { this.lv = was; } return this; }
  /**
   * geo: a geometry, or one per detail level (an array of 6). A geometry with its own colour attribute is tinted by
   * col (pass 0xffffff to keep its colours). o: { rx, ry, rz, s, sx, sy, sz, r (roughness), m (metalness), g (glow),
   * order, lv (the farthest level it is drawn at), from (the nearest level it is drawn at: a stand-in for finer work) }
   */
  add(geo, col, x = 0, y = 0, z = 0, o = {}) {
    const s = o.s ?? 1;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ')), _s.set(o.sx ?? s, o.sy ?? s, o.sz ?? s));
    const c = colOf(col);
    this.items.push({ geo, mtx: this.base.clone().multiply(_m), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.8, Math.min(0.55, o.m ?? 0), o.g ?? 0], lv: Math.min(this.lv, o.lv ?? 9), lo: o.from });
    return this;
  }
  /** a round bar from a to b (local coordinates) */
  bar(a, b, r, col, o = {}, n = 6) {
    _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
    const len = _d.length(); if (len < 1e-5) return this;
    _q.setFromUnitVectors(UP, _d.normalize());
    _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(1, len, 1));
    const c = colOf(col);
    this.items.push({ geo: G.cyl(o.r2 ?? r, r, 1, n), mtx: this.base.clone().multiply(_m), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.8, Math.min(0.55, o.m ?? 0), o.g ?? 0], lv: Math.min(this.lv, o.lv ?? 9) });
    return this;
  }
  /** a sagging chain or rope from a to b, as a tube */
  rope(a, b, sag, r, col, o = {}) {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]); }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), o.seg ?? 10, r, o.rs ?? 4, false);
    const c = colOf(col);
    this.items.push({ geo, mtx: this.base.clone(), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.6, Math.min(0.55, o.m ?? 0.5), o.g ?? 0], lv: Math.min(this.lv, o.lv ?? 9) });
    return this;
  }
  /** a hanging chain of links from a to b (size: link length); seen from far away it is a plain dark tube */
  chain(a, b, sag, size, col = 0x3a3a40, o = {}) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = clamp(Math.round(len / (size * 0.78)), 2, 60);
    const link = G.tor(size * 0.32, size * 0.07, 4, 8);
    this.detail(1, () => {
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, t2 = Math.min(1, t + 0.01);
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
        const q = [a[0] + (b[0] - a[0]) * t2, a[1] + (b[1] - a[1]) * t2 - Math.sin(t2 * Math.PI) * sag, a[2] + (b[2] - a[2]) * t2];
        _d.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
        _q.setFromUnitVectors(_a.set(1, 0, 0), _d);
        if (i % 2) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_a.set(1, 0, 0), Math.PI / 2));
        _m.compose(_p.set(...p), _q, _s.set(1.35, 1, 1));
        const c = colOf(col);
        this.items.push({ geo: link, mtx: this.base.clone().multiply(_m), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.45, 0.55, 0], lv: this.lv });
      }
    });
    const was = this.lv; this.lv = Math.min(was, o.lv ?? 9); // the far tube stands in for the links from level 2
    const items0 = this.items.length;
    this.rope(a, b, sag, size * 0.12, shade(col, 0.8), { m: 0.5, seg: 6, rs: 3 });
    for (let i = items0; i < this.items.length; i++) this.items[i].lo = 2;
    this.lv = was;
    return this;
  }
  get empty() { return !this.items.length; }
  /** the merged geometry for one detail level (EMPTY_GEO when nothing is drawn there) */
  build(level = 0) {
    let n = 0;
    const flat = [];
    for (const it of this.items) {
      if (!shown(it, level)) continue;
      let g = Array.isArray(it.geo) ? it.geo[Math.min(level, it.geo.length - 1)] : it.geo;
      if (level >= 2 && g.type === 'RoundedBoxGeometry') { const q = g.parameters; g = G.box(q.width, q.height, q.depth); } // far away a bevel is not worth its faces
      if (!g || !g.attributes.position || !g.attributes.position.count) continue;
      if (g.index) g = nonIndexed(g);
      n += g.attributes.position.count; flat.push([it, g]);
    }
    if (!n) return EMPTY_GEO;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cl = new Float32Array(n * 3), M = new Float32Array(n * 3);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let o = 0;
    for (const [it, g] of flat) {
      const pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, ma = g.attributes.aPbr;
      nm.getNormalMatrix(it.mtx);
      const flip = it.mtx.determinant() < 0, start = o;
      for (let i = 0; i < pa.count; i++, o++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(it.mtx); P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
        if (na) { v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); N[o * 3] = v.x; N[o * 3 + 1] = v.y; N[o * 3 + 2] = v.z; } else N[o * 3 + 1] = 1;
        if (ca) { Cl[o * 3] = it.c[0] * ca.getX(i); Cl[o * 3 + 1] = it.c[1] * ca.getY(i); Cl[o * 3 + 2] = it.c[2] * ca.getZ(i); }
        else { Cl[o * 3] = it.c[0]; Cl[o * 3 + 1] = it.c[1]; Cl[o * 3 + 2] = it.c[2]; }
        if (ma) { M[o * 3] = ma.getX(i); M[o * 3 + 1] = ma.getY(i); M[o * 3 + 2] = ma.getZ(i); }
        else { M[o * 3] = it.pbr[0]; M[o * 3 + 1] = it.pbr[1]; M[o * 3 + 2] = it.pbr[2]; }
      }
      if (flip) for (let t = start; t < o; t += 3) for (const A of [P, N, Cl, M]) for (let k = 0; k < 3; k++) { const x = A[(t + 1) * 3 + k]; A[(t + 1) * 3 + k] = A[(t + 2) * 3 + k]; A[(t + 2) * 3 + k] = x; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(Cl, 3));
    geo.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }
  /** one geometry per detail level (levels that draw the same items share one); cached under key when given */
  levels(key) {
    if (key && lodCache.has(key)) return lodCache.get(key);
    const sig = (lv) => this.items.map((it) => (shown(it, lv) ? (Array.isArray(it.geo) ? it.geo[Math.min(lv, it.geo.length - 1)].id : 1) : 0)).join(',');
    const out = [], seen = new Map();
    for (let lv = 0; lv < LEVELS; lv++) {
      const s = sig(lv);
      if (!seen.has(s)) seen.set(s, this.build(lv));
      out.push(seen.get(s));
    }
    if (key) { lodCache.set(key, out); if (lodCache.size > 600) lodCache.delete(lodCache.keys().next().value); }
    return out;
  }
  /** the merged mesh (marked so the crew system ignores it); mesh.userData.lodGeos holds a geometry per detail level */
  mesh(material = sculptMaterial(), key = null) {
    const geos = this.levels(key);
    const m = new THREE.Mesh(geos[0], material);
    m.castShadow = true; m.receiveShadow = true; m.userData.noCrew = true; m.userData.lodGeos = geos;
    return m;
  }
}
const lodCache = new Map();
// far away, small things go: below CULL[level] units across an item is not drawn at that level
const CULL = [0, 0, 0.03, 0.09, 0.2, 0.35];
function radiusOf(it) {
  if (it.rad === undefined) {
    const g = Array.isArray(it.geo) ? it.geo[0] : it.geo;
    if (!g.boundingSphere) g.computeBoundingSphere();
    it.rad = (g.boundingSphere?.radius || 0) * it.mtx.getMaxScaleOnAxis();
  }
  return it.rad;
}
function shown(it, lv) { return it.lv >= lv && !(it.lo !== undefined && lv < it.lo) && (lv < 2 || radiusOf(it) * 2 >= CULL[lv]); }
const niCache = new WeakMap();
function nonIndexed(g) { let r = niCache.get(g); if (!r) { r = g.toNonIndexed(); niCache.set(g, r); } return r; }

/** colour helpers (hex in, hex out) */
export function shade(hex, k) { _c.set(hex); return _c.multiplyScalar(k).getHex(); }
export function blend(a, b, t) { _c.set(a); return _c.lerp(new THREE.Color(b), t).getHex(); }
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// common colours
export const C = {
  wood: 0x6b4a2e, dark: 0x4a3220, plank: 0x8a6a44, rope: 0xc8b88a, iron: 0x3a3a40, steel: 0x9aa2aa, bronze: 0xb08a3a, gold: 0xd4a83a,
  stone: 0x8f8a7c, darkStone: 0x3a3836, bone: 0xd8cfb4, cloth: 0xe8e0c8, fire: 0xff7a22, green: 0x6aff5a, black: 0x161616, red: 0x9a1a14,
  leaf: 0x4f8a34, felt: 0xb8a07a, brick: 0x8a4a32, flesh: 0xb06a5a, slime: 0x8ad83a,
};
