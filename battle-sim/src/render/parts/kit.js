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
//   sculptL(key, make, o)       a SCULPTED piece (sculpt.js prims + hard pieces, the ground units' pipeline) meshed once per
//                               detail level on first use and cached by key: figureheads, beasts, carvings, lamps
//
// Every primitive is shaded the way the sculpted hull under it is: a faint grain / mottle baked into its colour and
// metal at the hull's metalness, so the dressing reads as part of the same ship rather than pasted on. Merged levels
// are indexed and built lazily (a level is only meshed the first time something asks for it).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sculptMaterial, buildPartGeometry, noise3, fbm3, S, H } from '../sculpt.js';
export { S, H, noise3, fbm3 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/** a geometry with nothing in it: a detail level where a part is not drawn */
export const EMPTY_GEO = new THREE.BufferGeometry();
EMPTY_GEO.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
export const LEVELS = 6;

// ---------- primitive geometries, cached by shape ----------
const cache = new Map();
const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
const tag = (g, prim) => { g.userData.prim ||= prim; return g; };
export const G = {
  box: (w, h, d) => memo(`b${w},${h},${d}`, () => tag(new THREE.BoxGeometry(w, h, d), { t: 'box', w, h, d, r: 0 })),
  cyl: (rt, rb, h, n = 8, open = false) => memo(`c${rt},${rb},${h},${n},${open}`, () => tag(new THREE.CylinderGeometry(rt, rb, h, n, 1, open), { t: open ? 'x' : 'cyl', rt, rb, h })),
  sph: (r, w = 8, h = 6) => memo(`s${r},${w},${h}`, () => tag(new THREE.SphereGeometry(r, w, h), { t: 'sph', r })),
  hemi: (r, w = 10, h = 5) => memo(`h${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2)),
  cone: (r, h, n = 8) => memo(`k${r},${h},${n}`, () => tag(new THREE.ConeGeometry(r, h, n), { t: 'cone', r, h })),
  tor: (R, r, rs = 5, ts = 14, arc = Math.PI * 2) => memo(`t${R},${r},${rs},${ts},${arc}`, () => tag(new THREE.TorusGeometry(R, r, rs, ts, arc), { t: arc >= Math.PI * 1.99 ? 'tor' : 'x', R, r })),
  ico: (r, d = 0) => memo(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  oct: (r) => memo(`o${r}`, () => new THREE.OctahedronGeometry(r, 0)),
  dod: (r) => memo(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
  plane: (w, h) => memo(`p${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
  circle: (r, n = 16) => memo(`ci${r},${n}`, () => new THREE.CircleGeometry(r, n)),
  ring: (a, b, n = 20) => memo(`r${a},${b},${n}`, () => new THREE.RingGeometry(a, b, n)),
  lathe: (key, pts, n = 10) => memo(`l${key}`, () => tag(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), Math.max(n, 10)), { t: 'lathe', pts })),
  /** a flat outline [[x, y], ...] in the xy plane, optionally extruded by depth along z (centred); bevel rounds its edges */
  shape: (key, pts, depth = 0, bevel = 0) => memo(`sh${key}`, () => {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    if (!depth) return new THREE.ShapeGeometry(s);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 }); g.translate(0, 0, -depth / 2); return g;
  }),
  /** a tube along points [[x, y, z], ...] */
  tube: (key, pts, r, seg = 16, rs = 5) => memo(`tu${key}`, () => tag(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, Math.max(rs, 6), false), { t: 'taper', pts, radii: [r, r] })),
  custom: (key, make) => memo(`x${key}`, make),
  /** a rounded box (bevelled edges) */
  rbox: (w, h, d, r = 0.02, seg = 1) => memo(`rb${w},${h},${d},${r},${seg}`, () => tag(new RoundedBoxGeometry(w, h, d, Math.max(seg, 2), Math.min(r, w / 2.05, h / 2.05, d / 2.05)), { t: 'box', w, h, d, r })),
};

/** the parts give metalness on the old 0..0.55 scale; the sculpted hull's iron and gilt sit at 0.8..0.85 */
const metalOf = (m) => (m ? Math.min(0.85, m >= 0.4 ? 0.35 + m : m) : 0);
const colOf = (c) => (c && c.isColor ? c : _c.set(c ?? 0xff00ff));
const hexLin = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };

// ---------- lofted shapes ----------
/**
 * A body swept through rings. stations: [[x, y, z, rw, rh, o?], ...] along a path (rw: half width across, rh: half
 * height); o (per station, optional): { n: superellipse exponent (2 round, 4 boxy), fl: 0..1 flatten the underside,
 * up: 0..1 raise the ring's centre by this much of rh, c: hex colour of this ring }.
 * opts: { radial: ring vertices (default 12), sub: smoothing steps between stations (default 2), cap: [start, end],
 *         belly: hex colour of the underside (blended by how far down the ring the vertex is), col: base hex,
 *         ridge: hex for the top line, paint: (t, a, side) => hex|null, lat: [lx, ly, lz] the ring's sideways axis,
 *         disp: (t, a) => k a relief over the surface (bark, hide): the ring's radius there is multiplied by k, and the
 *         hollows of the relief are shaded darker }.
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
      let dk = 1;
      if (o.disp) { const d = o.disp(i / (m - 1), ang); u *= d; v *= d; dk = clamp(1 + (d - 1) * 6, 0.6, 1.1); }
      v += so.up * rh;
      P.push(x + L.x * u + N.x * v, y + L.y * u + N.y * v, z + L.z * u + N.z * v);
      let col = rc;
      const down = Math.max(0, -sa);
      if (be && down > 0.25) { const f = Math.min(1, (down - 0.25) * 2.2); col = [lerp(col[0], be[0], f), lerp(col[1], be[1], f), lerp(col[2], be[2], f)]; }
      if (ri && sa > 0.93) col = ri;
      if (o.paint) { const h = o.paint(i / (m - 1), ang, ca); if (h !== null && h !== undefined) col = hexLin(h); }
      Cc.push(col[0] * dk, col[1] * dk, col[2] * dk);
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
    g.userData.prim = { t: 'taper', pts, radii: R };
    return g;
  });
}

/**
 * a cloth panel over u (across) and v (up), mapped by fn(u, v) -> [x, y, bellyK?, z?] and bellied along z by belly
 * (or set to the z fn returns);
 * seams: { u: n vertical seams, v: n horizontal, dark: shade of the seam rows (0.78), fold: depth of the stress folds
 * running down from the head to the clews (a fraction of the panel's size; 0 for none) }; ragged edges come from fn.
 */
export function clothPanel(key, fn, belly, nu = 10, nv = 8, seams = null) {
  return memo(`cp${key}`, () => {
    const P = [], idx = [], Cc = [];
    const su = seams?.u ?? 0, sv = seams?.v ?? 0, dk = seams?.dark ?? 0.8;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, r = fn(u, v), [x, y, bk] = r;
      let z = r.length > 3 ? r[3] : belly * Math.sin(Math.PI * u) * (bk ?? (0.35 + 0.65 * Math.sin(Math.PI * clamp(v, 0, 1))));
      if (seams?.fold) {
        // stress folds fanning from the head toward the clews, deepest at the corners, and a slight lift along each seam
        const f = seams.fold, ce = Math.pow(Math.abs(2 * u - 1), 2) * (0.4 + 0.6 * v);
        z += f * (Math.sin(u * Math.PI * 9 + v * 2.5) * 0.5 * ce + Math.sin(u * Math.PI * 23 - v * 4) * 0.18 * Math.sin(Math.PI * v));
      }
      P.push(x, y, z);
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

// ---------- sculpted pieces ----------
const sculpts = new Map();
let sculptMs = 0;
/** time spent meshing sculpted pieces so far (ms), for build reports */
export const sculptTime = () => sculptMs;
/**
 * A sculpted piece: make() -> { prims, hard } (sculpt.js S / H) in the piece's own space, meshed with surface nets at
 * o.res cells per unit at level 0 (default 64), coarser further out ([1, 0.6, 0.32, 0.17] of it for levels 0, 1, 2,
 * 3..5; never below o.min, default 9). Returns an array of six geometries for Kit.add, each built the first time it is
 * read and shared by every kit that uses the key. o: { res, min, ao, paint(x, y, z, nx, ny, nz, rgb) -> rgb | null (a pattern
 * painted over the meshed colours: stripes, scutes, plank seams; rgb is linear [r, g, b]) }.
 */
export function sculptL(key, make, o = {}) {
  const k = `sc${key}`;
  if (sculpts.has(k)) return sculpts.get(k);
  const r0 = o.res ?? 64, mn = o.min ?? 9, ao = o.ao ?? 0.7;
  const RES = [r0, r0 * 0.6, r0 * 0.32, r0 * 0.17, r0 * 0.1].map((r, i) => Math.max(i > 3 ? Math.min(mn, 7) : mn, Math.round(r)));
  let part = null;
  const geo = [];
  const at = (i) => {
    if (geo[i] === undefined) {
      part ||= make();
      const t0 = performance.now();
      let g = buildPartGeometry(part, { res: RES[i], lod: Math.min(i, 3), levels: 4, ao });
      sculptMs += performance.now() - t0;
      if (g && o.paint) paintGeo(g, o.paint);
      if (!g) g = i > 0 ? at(i - 1) : EMPTY_GEO;
      if (!g.boundingSphere) g.computeBoundingSphere();
      geo[i] = g;
    }
    return geo[i];
  };
  const arr = [];
  const TOK = [0, 1, 2, 3, 4, 4];
  for (let lv = 0; lv < LEVELS; lv++) Object.defineProperty(arr, lv, { enumerable: true, get: () => at(TOK[lv]) });
  arr.tok = TOK; arr.sculpt = true;
  Object.defineProperty(arr, 'probe', { get: () => at(3) });
  sculpts.set(k, arr);
  return arr;
}

/**
 * Re-cut a kit's work as a sculpt: every sphere, box, cylinder, cone, ring and tapered tube becomes a sculpt prim (so
 * they blend into one carved piece with baked occlusion), anything else (lathes, outlines, cloth) rides along as a hard
 * piece. draw(K) draws into a fresh kit at the piece's own scale; o as for sculptL plus k (blend radius).
 */
export function sculptKit(key, draw, o = {}) {
  return sculptL(key, () => { const K = new Kit(); draw(K); return kitToPart(K, o.k ?? 0.008, o.thin ?? 2.6 / (o.res ?? 64)); }, o);
}
const _dp = new THREE.Vector3(), _dq = new THREE.Quaternion(), _ds = new THREE.Vector3(), _de = new THREE.Euler(), _dv = new THREE.Vector3();
const RAD = 180 / Math.PI;
export function kitToPart(K, k = 0.008, thin = 0) {
  const prims = [], hard = [];
  for (const it of K.items) {
    if (it.lv < 0) continue;
    const g = Array.isArray(it.geo) ? it.geo[0] : it.geo;
    if (!g) continue;
    const q = g.userData?.prim;
    it.mtx.decompose(_dp, _dq, _ds);
    _de.setFromQuaternion(_dq, 'XYZ');
    const fin = (p) => { p.color(it.c).pbr(it.pbr[0], it.pbr[1]).glow(it.pbr[2]).blend(k); return p.rot(_de.x * RAD, _de.y * RAD, _de.z * RAD).at(_dp.x, _dp.y, _dp.z); };
    const sx = _ds.x, sy = _ds.y, sz = _ds.z, sxz = (sx + sz) / 2;
    let p = null;
    const mn = Math.min(sx, sy, sz);
    const thick = !q ? 0 : q.t === 'sph' ? q.r * mn : q.t === 'box' ? Math.min(q.w * sx, q.h * sy, q.d * sz) : q.t === 'cyl' ? Math.min(Math.max(q.rt, q.rb) * mn * 2, q.h * sy) : q.t === 'cone' ? q.r * mn * 1.2 : q.t === 'tor' ? q.r * mn * 2 : q.t === 'taper' ? Math.max(...q.radii) * mn * 2 : 0;
    if (q && !g.attributes.color && thick >= thin) {
      if (q.t === 'sph') p = fin(Math.abs(sx - sy) + Math.abs(sy - sz) < 1e-4 ? S.sphere(q.r * sx) : S.ellipsoid(q.r * sx, q.r * sy, q.r * sz));
      else if (q.t === 'box') p = fin(S.box(q.w * sx, q.h * sy, q.d * sz, Math.max(q.r * Math.min(sx, sy, sz), 0.004 * Math.min(q.w * sx, q.h * sy, q.d * sz) * 10)));
      else if (q.t === 'cyl') p = fin(Math.abs(q.rt - q.rb) < 1e-5 ? S.cyl(q.rt * sxz, q.h * sy, Math.min(q.rt * sxz, q.h * sy) * 0.12) : S.cone(q.rb * sxz, q.rt * sxz, q.h * sy, Math.min(q.rt, q.rb) * sxz * 0.2));
      else if (q.t === 'cone') p = fin(S.cone(q.r * sxz, 0, q.h * sy));
      else if (q.t === 'tor' && Math.abs(sx - sy) < 1e-3) p = fin(S.torus(q.R * sx, q.r * Math.min(sx, sz)).rot(90, 0, 0));
      else if (q.t === 'taper') {
        const pts = q.pts.map((a) => _dv.set(a[0], a[1], a[2]).applyMatrix4(it.mtx).toArray()), sc = Math.cbrt(Math.abs(sx * sy * sz));
        const R = q.radii.length === q.pts.length ? q.radii : q.pts.map((_, i) => lerp(q.radii[0], q.radii[q.radii.length - 1], i / (q.pts.length - 1)));
        for (let i = 0; i < pts.length - 1; i++) prims.push(S.capsule(pts[i], pts[i + 1], Math.max(R[i] * sc, 1e-3), Math.max(R[i + 1] * sc, 1e-3)).color(it.c).pbr(it.pbr[0], it.pbr[1]).glow(it.pbr[2]).blend(k));
        continue;
      }
    }
    if (p) { prims.push(p); continue; }
    // the rest is hard work: the geometry as it is, carried by the item's matrix
    const h = H.geo(g).color(it.c).pbr(it.pbr[0], it.pbr[1]).glow(it.pbr[2]);
    const ca = g.attributes.color, c0 = it.c;
    if (ca) h.shade((x, y, z, nx, ny, nz, i) => [ca.getX(i) * c0[0], ca.getY(i) * c0[1], ca.getZ(i) * c0[2]]);
    h.m.copy(it.mtx);
    if (it.lv < 2) h.lod(it.lv);
    hard.push(h);
  }
  return { prims, hard };
}

function paintGeo(g, fn) {
  const P = g.attributes.position, N = g.attributes.normal, Cc = g.attributes.color, rgb = [0, 0, 0];
  for (let i = 0; i < P.count; i++) {
    rgb[0] = Cc.getX(i); rgb[1] = Cc.getY(i); rgb[2] = Cc.getZ(i);
    const r = fn(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), rgb);
    if (r) Cc.setXYZ(i, r[0], r[1], r[2]);
  }
}

/**
 * Sculpt builder: gathers prims and hard pieces with nested frames, so a head can be authored in its own space and
 * hung on a neck.   const B = new SB(); B.push([x, y, z], [rxDeg, ryDeg, rzDeg], s); B.p(S.sphere(1)); B.pop(); B.part()
 */
export class SB {
  constructor() { this.prims = []; this.hard = []; this.st = []; }
  p(...a) { for (const x of a.flat(Infinity)) if (x) this.prims.push(x); return this; }
  h(...a) { for (const x of a.flat(Infinity)) if (x) this.hard.push(x); return this; }
  push(at = [0, 0, 0], rot = [0, 0, 0], s = 1) { this.st.push([this.prims.length, this.hard.length, at, rot, s]); return this; }
  pop() {
    const [np, nh, at, rot, s] = this.st.pop();
    for (let i = np; i < this.prims.length; i++) { const x = this.prims[i]; if (s !== 1) x.scale(s); x.rot(...rot).at(...at); }
    for (let i = nh; i < this.hard.length; i++) { const x = this.hard[i]; if (s !== 1) x.scale(s, s, s); x.rot(...rot).at(...at); }
    return this;
  }
  /** a copy of everything added since mark, mirrored across z = 0 */
  mirrorZ(mark) {
    const [np, nh] = mark;
    const P = this.prims.slice(np), Hh = this.hard.slice(nh);
    for (const x of P) { const c = x.clone(); c.m.premultiply(new THREE.Matrix4().makeScale(1, 1, -1)); this.prims.push(c); }
    for (const x of Hh) { const c = x.clone(); c.m.premultiply(new THREE.Matrix4().makeScale(1, 1, -1)); this.hard.push(c); }
    return this;
  }
  mark() { return [this.prims.length, this.hard.length]; }
  part() { return { prims: this.prims, hard: this.hard }; }
}
const toRgb = (hex) => hexLin(hex);
/** sculpt helpers (all add to a builder B in its current frame) */
export const SKH = {
  /** a chain of blended tapered capsules through pts with a radius per point */
  limb(B, pts, radii, col, o = {}) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = S.capsule(pts[i], pts[i + 1], radii[i], radii[i + 1]).color(col).blend(o.k ?? 0.03).pbr(o.r ?? 0.6, o.m ?? 0);
      if (o.bump) p.bump(...o.bump);
      if (o.tint) p.tint(...o.tint);
      if (o.glow) p.glow(o.glow);
      if (o.paint) p.paint(...o.paint); else if (o.cut) p.cut(o.cut);
      B.p(p);
    }
    return B;
  },
  /** a pair of eyes (mirrored in z) at [x, y, +-z]: a glossy ball, a slit or round pupil, and a heavy brow in col */
  eyes(B, at, r, iris, col, o = {}) {
    const [x, y, z] = at;
    for (const s of [-1, 1]) {
      B.h(H.sphere(r, 14).color(iris).pbr(0.15, 0).glow(o.glow ?? 1.2).at(x, y, s * z));
      B.h(H.sphere(r * 0.55, 10).scale(o.round ? 0.5 : 0.35, o.round ? 1 : 1.5, 1).color(0x0a0806).pbr(0.1, 0).at(x + r * 0.62, y, s * (z + r * 0.25)).rot(0, s * 0.0, 0).lod(1));
      if (col !== null) B.p(S.ellipsoid(r * 1.5, r * 0.55, r * 1.25).rot(0, 0, -8).at(x - r * 0.1, y + r * 0.75, s * z * 0.97).color(col).blend(0.02));
    }
    return B;
  },
  /** a row of teeth (mirrored), pointing down (up = false) or up */
  teeth(B, x0, x1, y, z, h, n, up, col = 0xeae0c4, z1 = null) {
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1), hh = h * (i === n - 1 || i === Math.floor(n * 0.3) ? 1.5 : 1), zz = lerp(z, z1 ?? z * 0.65, t);
      B.h(H.cone(hh * 0.28, hh, 7).color(col).pbr(0.35, 0).rot(up ? 0 : 180, 0, 0).at(lerp(x0, x1, t), y + (up ? hh / 2 : -hh / 2), s * zz).lod(2));
    }
    return B;
  },
  /** a horn / tusk: a ringed tube along pts tapering from r to a point */
  horn(B, pts, r, col = 0xe4d8b8, o = {}) {
    const radii = pts.map((_, i) => r * Math.pow(1 - i / (pts.length - 1), 0.8) + r * 0.04);
    const rings = o.rings ?? 10, dark = toRgb(shade(col, 0.72)), base = toRgb(col), tip = toRgb(shade(col, o.tip ?? 0.6));
    B.h(H.tube(pts, radii, Math.max(12, pts.length * 6), 10).color(col).pbr(o.r ?? 0.4, o.m ?? 0).shade((x, y, z, nx, ny, nz, i) => {
      const seg = Math.floor(i / 11) / Math.max(12, pts.length * 6);
      if (seg > 0.8) return tip;
      return rings && Math.abs(Math.sin(seg * Math.PI * rings)) < 0.22 ? dark : base;
    }));
    return B;
  },
  /** a flat fin, frill or ear: outline [[x, y]...] extruded thin, ribs darkened toward its root */
  fin(B, outline, depth, col, at, rot = [0, 0, 0], o = {}) {
    const lo = toRgb(shade(col, 0.7)), hi = toRgb(o.edge ?? col);
    B.h(H.extrude(outline, depth, Math.min(0.006, depth * 0.3)).color(col).pbr(o.r ?? 0.5, o.m ?? 0).shade((x, y) => {
      const rib = Math.abs(Math.sin(Math.atan2(y, x + 0.0001) * (o.ribs ?? 7))) < 0.18;
      return rib ? lo : Math.hypot(x, y) > (o.edgeAt ?? 1e9) ? hi : null;
    }).rot(...rot).at(...at));
    return B;
  },
  /** one feather lying along +x from its root: a curved vane with a shaft and barbs baked in */
  feather(B, len, w, col, at, rot = [0, 0, 0], o = {}) {
    const lo = toRgb(shade(col, 0.72)), tipC = o.tip !== undefined ? toRgb(o.tip) : null;
    B.h(H.sheet(len, w, 8, 3, (u, v) => [0, 0, Math.sin(u * Math.PI) * w * 0.12 + (v - 0.5) * (v - 0.5) * w * 0.3 - Math.pow(Math.abs(v - 0.5) * 2, 3) * u * w * 0.0]).color(col).pbr(0.75, 0).shade((x, y) => {
      const u = x / len + 0.5;
      if (Math.abs(y) < w * 0.06) return lo;
      if (tipC && u > 0.8) return tipC;
      return Math.abs(Math.sin((u * 14 + Math.abs(y) / w * 6) * Math.PI)) < 0.12 ? lo : null;
    }).scale(1, 1, 1).at(len / 2, 0, 0).rot(...rot).at(...at));
    return B;
  },
};

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
        let z = hw * Math.sign(s) * Math.pow(Math.abs(s), 0.55) * (1 - flare * 0.25 * (1 - Math.abs(s))) ;
        const fy = (y - yk) / Math.max(1e-3, yt - yk);
        // the seams between strakes are let in a little, so the planking reads in the light as well as the paint
        if (strakes && NV > 12 && fy < 0.97) z *= 1 - 0.012 * Math.max(0, 1 - Math.abs(Math.sin(fy * Math.PI * strakes)) / 0.2);
        P.push(x, y, z);
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
   * order, lv (the farthest level it is drawn at), from (the nearest level it is drawn at: a stand-in for finer work),
   * grain (0..0.4 colour grain baked in; 0 for none) }
   */
  add(geo, col, x = 0, y = 0, z = 0, o = {}) {
    const s = o.s ?? 1;
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'XYZ')), _s.set(o.sx ?? s, o.sy ?? s, o.sz ?? s));
    const c = colOf(col);
    this.items.push({ geo, mtx: this.base.clone().multiply(_m), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.8, metalOf(o.m), o.g ?? 0], lv: Math.min(this.lv, o.lv ?? 9), lo: o.from, grain: o.grain });
    return this;
  }
  /** a round bar from a to b (local coordinates) */
  bar(a, b, r, col, o = {}, n = 6) {
    _a.set(...a); _b.set(...b); _d.subVectors(_b, _a);
    const len = _d.length(); if (len < 1e-5) return this;
    _q.setFromUnitVectors(UP, _d.normalize());
    _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(1, len, 1));
    const c = colOf(col);
    this.items.push({ geo: G.cyl(o.r2 ?? r, r, 1, n), mtx: this.base.clone().multiply(_m), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.8, metalOf(o.m), o.g ?? 0], lv: Math.min(this.lv, o.lv ?? 9) });
    return this;
  }
  /** a sagging chain or rope from a to b, as a tube */
  rope(a, b, sag, r, col, o = {}) {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t]); }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), o.seg ?? 10, r, o.rs ?? 4, false);
    const c = colOf(col);
    this.items.push({ geo, mtx: this.base.clone(), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.6, metalOf(o.m ?? 0.5), o.g ?? 0], lv: Math.min(this.lv, o.lv ?? 9) });
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
        this.items.push({ geo: link, mtx: this.base.clone().multiply(_m), c: [c.r, c.g, c.b], pbr: [o.r ?? 0.45, 0.82, 0], lv: this.lv });
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
  /** the merged geometry for one detail level (EMPTY_GEO when nothing is drawn there); indexed */
  build(level = 0) {
    let nv = 0, ni = 0;
    const flat = [];
    for (const it of this.items) {
      if (!shown(it, level)) continue;
      let g = Array.isArray(it.geo) ? it.geo[Math.min(level, it.geo.length - 1)] : it.geo;
      if (level >= 2 && g && g.type === 'RoundedBoxGeometry') { const q = g.parameters; g = G.box(q.width, q.height, q.depth); } // far away a bevel is not worth its faces
      if (!g || !g.attributes.position || !g.attributes.position.count) continue;
      const c = g.attributes.position.count;
      nv += c; ni += g.index ? g.index.count : c; flat.push([it, g]);
    }
    if (!nv) return EMPTY_GEO;
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), Cl = new Float32Array(nv * 3), M = new Float32Array(nv * 3);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let o = 0, q = 0;
    for (const [it, g] of flat) {
      const pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color, ma = g.attributes.aPbr;
      nm.getNormalMatrix(it.mtx);
      const flip = it.mtx.determinant() < 0, base = o;
      // primitives take the hull's grain / mottle so they sit in the same material as the sculpted ship
      const grain = ca || it.pbr[2] > 0.3 ? 0 : it.grain ?? (it.pbr[1] > 0.4 ? 0.16 : 0.2);
      const fx = it.pbr[1] > 0.4 ? 11 : 2.6, fy = it.pbr[1] > 0.4 ? 11 : 31;
      for (let i = 0; i < pa.count; i++, o++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(it.mtx); P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
        const k = grain ? 1 - grain * 0.5 + grain * noise3(v.x * fx + 3.1, v.y * fy + 7.7, v.z * fy) : 1;
        if (na) { v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); N[o * 3] = v.x; N[o * 3 + 1] = v.y; N[o * 3 + 2] = v.z; } else N[o * 3 + 1] = 1;
        if (ca) { Cl[o * 3] = it.c[0] * ca.getX(i); Cl[o * 3 + 1] = it.c[1] * ca.getY(i); Cl[o * 3 + 2] = it.c[2] * ca.getZ(i); }
        else { Cl[o * 3] = it.c[0] * k; Cl[o * 3 + 1] = it.c[1] * k; Cl[o * 3 + 2] = it.c[2] * k; }
        if (ma) { M[o * 3] = ma.getX(i); M[o * 3 + 1] = ma.getY(i); M[o * 3 + 2] = ma.getZ(i); }
        else { M[o * 3] = it.pbr[0]; M[o * 3 + 1] = it.pbr[1]; M[o * 3 + 2] = it.pbr[2]; }
      }
      if (g.index) {
        const ix = g.index.array;
        for (let t = 0; t < ix.length; t += 3) { I[q++] = base + ix[t]; if (flip) { I[q++] = base + ix[t + 2]; I[q++] = base + ix[t + 1]; } else { I[q++] = base + ix[t + 1]; I[q++] = base + ix[t + 2]; } }
      } else {
        for (let t = 0; t < pa.count; t += 3) { I[q++] = base + t; if (flip) { I[q++] = base + t + 2; I[q++] = base + t + 1; } else { I[q++] = base + t + 1; I[q++] = base + t + 2; } }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(Cl, 3));
    geo.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }
  /** one geometry per detail level (levels that draw the same items share one), each built on first read; cached under key */
  levels(key) {
    if (key && lodCache.has(key)) return lodCache.get(key);
    const sig = (lv) => this.items.map((it) => (shown(it, lv) ? (Array.isArray(it.geo) ? geoTok(it.geo, lv) : 1) : 0)).join(',');
    const out = [], sigs = [], made = new Map();
    for (let lv = 0; lv < LEVELS; lv++) sigs.push(sig(lv));
    for (let lv = 0; lv < LEVELS; lv++) Object.defineProperty(out, lv, { enumerable: true, get: () => { const s = sigs[lv]; if (!made.has(s)) made.set(s, this.build(lv)); return made.get(s); } });
    out.toJSON = () => undefined;
    if (key) { lodCache.set(key, out); if (lodCache.size > 600) lodCache.delete(lodCache.keys().next().value); }
    return out;
  }
  /**
   * the merged mesh (marked so the crew system ignores it); mesh.userData.lodGeos holds a geometry per detail level.
   * The finest levels are not meshed until the mesh is first drawn that close: it starts on level 2 and takes the
   * level asked for (userData.lodLevel(), else 0) the first time it renders.
   */
  mesh(material = sculptMaterial(), key = null) {
    return lazyMesh(new THREE.Mesh(undefined, material), this.levels(key));
  }
}
/** give a mesh per-level geometries (an array of six) that are meshed lazily: it shows level LAZY until first drawn */
export function lazyMesh(m, geos) {
  m.geometry = geos[LAZY];
  m.castShadow = true; m.receiveShadow = true; m.userData.noCrew = true; m.userData.lodGeos = geos; m.userData.pending0 = true;
  m.onBeforeRender = () => {
    m.onBeforeRender = NOOP;
    if (!m.userData.pending0) return;
    m.userData.pending0 = false;
    const lv = m.userData.lodLevel ? m.userData.lodLevel() : 0;
    if (lv < LAZY) m.geometry = (m.userData.lodGeos || geos)[lv];
  };
  return m;
}
/** a per-level array whose entries are fn(source entry), each made on first read */
export function lazyMap(src, fn) {
  const out = [], done = new Map();
  for (let lv = 0; lv < LEVELS; lv++) Object.defineProperty(out, lv, { enumerable: true, get: () => { const g = src[lv]; if (!done.has(g)) done.set(g, fn(g)); return done.get(g); } });
  out.toJSON = () => undefined;
  return out;
}
/** the level a new mesh shows until it is first drawn */
export const LAZY = 2;
const NOOP = () => {};
const lodCache = new Map();
const arrIds = new WeakMap();
let arrN = 0;
/** a token for which geometry of a per-level array a level uses, without building it */
function geoTok(arr, lv) {
  if (arr.tok) { if (!arrIds.has(arr)) arrIds.set(arr, ++arrN); return `s${arrIds.get(arr)}:${arr.tok[Math.min(lv, arr.tok.length - 1)]}`; }
  return arr[Math.min(lv, arr.length - 1)].id;
}
// far away, small things go: below CULL[level] units across an item is not drawn at that level
const CULL = [0, 0, 0.03, 0.09, 0.2, 0.35];
function radiusOf(it) {
  if (it.rad === undefined) {
    const g = Array.isArray(it.geo) ? (it.geo.probe || it.geo[0]) : it.geo;
    if (!g.boundingSphere) g.computeBoundingSphere();
    it.rad = (g.boundingSphere?.radius || 0) * it.mtx.getMaxScaleOnAxis();
  }
  return it.rad;
}
function shown(it, lv) { return it.lv >= lv && !(it.lo !== undefined && lv < it.lo) && (lv < 2 || radiusOf(it) * 2 >= CULL[lv]); }

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
