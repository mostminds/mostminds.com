// Jungle islands: the plants, the animals and the stilt village of a jungle tribe, as cheap low-poly scenery.
//
//   scenery[key](seed)      -> a THREE.Object3D, y = 0 at the ground (or at the water for the pieces that stand in it),
//                              origin at the centre of the footprint. The caller owns the position, rotation and scale
//                              of the object it gets; everything that moves is a child.
//   animateScenery(obj, t)  -> gentle life for any of them (and a no-op for anything else). A pure function of t.
//
// Everything is flat-shaded vertex-coloured triangles on four shared materials; geometry is built once per key and
// variant and shared by every instance. Moving parts are separate meshes that carry their own plain-data animation
// record in userData.jg, so clones animate too (the animator finds them by walking the object once).
// Animals face +Z; long things (log, canoe, palisade, boardwalk) run along X; buildings open toward +Z.
import * as THREE from 'three';

const PI = Math.PI, TAU = PI * 2;
const _c = new THREE.Color(), _c2 = new THREE.Color();
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const frac = (v) => v - Math.floor(v);
const pulse = (c, a, b) => { if (!(c > a && c < b)) return 0; return Math.sin(((c - a) / (b - a)) * PI) ** 2; };
const N = (v, d = 0) => (typeof v === 'number' && v === v && Math.abs(v) < 1e12 ? v : d);
const mix = (a, b, t) => _c.set(a).lerp(_c2.set(b), clamp(t, 0, 1)).getHex();
const mul = (a, k) => _c.set(a).multiplyScalar(k).getHex();
const hash = (n) => frac(Math.sin(n * 12.9898 + 4.1414) * 43758.5453);
const seedOf = (seed) => { const n = Math.floor(N(Number(seed), 0)); return Math.abs(n) % 1000003; };
function rng(seed) { let s = (seedOf(seed) * 2654435761 + 97) >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; s ^= s >>> 13; return ((Math.imul(s, 3266489909) >>> 0) / 4294967296); }; }
const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (d) => { const l = Math.hypot(d[0], d[1], d[2]); return l > 1e-9 ? [d[0] / l, d[1] / l, d[2] / l] : [0, 1, 0]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ctr = (r) => { const m = [0, 0, 0]; for (const q of r) { m[0] += q[0]; m[1] += q[1]; m[2] += q[2]; } return sc3(m, 1 / r.length); };
/** a smooth curve through points (Catmull-Rom), k samples per span */
function curve(pts, k = 3) {
  const out = [], n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < k; j++) { const t = j / k, t2 = t * t, t3 = t2 * t, q = []; for (let a = 0; a < 3; a++) q.push(0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3)); out.push(q); }
  }
  out.push(pts[n - 1].slice());
  return out;
}

// =====================================================================================
// the triangle kit
// =====================================================================================
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
/** collects coloured triangles. Colours are hex numbers or functions (x, y, z, nx, ny, nz, i, j) -> hex of the face centre
 *  (in the space of the call) and its outward normal. Every face gets a small random change of brightness. */
class B {
  constructor(jit = 0.07) { this.p = []; this.c = []; this.nn = []; this.M = null; this.st = []; this.n = 0; this.jit = jit; }
  get count() { return this.p.length / 9; }
  v(q) { const M = this.M; if (!M) return q; const e = M.elements, x = q[0], y = q[1], z = q[2]; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; }
  /** draw fn() moved to pos, turned by rot (radians, XYZ) and scaled by s (number or [x, y, z]) */
  at(pos, rot, s, fn) {
    if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    const m = new THREE.Matrix4().compose(_v.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s);
    this.st.push(this.M); this.M = this.M ? this.M.clone().multiply(m) : m; fn(); this.M = this.st.pop(); return this;
  }
  k() { return 1 + (hash(this.n++) - 0.5) * 2 * this.jit; }
  /** already transformed corners; nrm = outward normal or null for a sheet */
  put(a, b, c, ca, cb, cc, k, nrm) {
    let n = cross(sub(b, a), sub(c, a));
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-12) return;
    n = sc3(n, 1 / l);
    if (nrm) { if (dot(n, nrm) < 0) { const t = b; b = c; c = t; const tc = cb; cb = cc; cc = tc; n = sc3(n, -1); } }
    else { if (n[1] < 0) { const t = b; b = c; c = t; const tc = cb; cb = cc; cc = tc; n = sc3(n, -1); } if (n[1] < 0.5) n = norm([n[0] * 0.4, n[1] + 0.8, n[2] * 0.4]); }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.nn.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    for (const col of [ca, cb, cc]) { _c.set(col); this.c.push(_c.r * k, _c.g * k, _c.b * k); }
  }
  /** a sheet triangle (seen from both sides) */
  tri(a, b, c, ca, cb = ca, cc = ca) { this.put(this.v(a), this.v(b), this.v(c), ca, cb, cc, this.k(), null); return this; }
  quad(a, b, c, d, ca, cb = ca, cc = ca, cd = ca) { const k = this.k(), A = this.v(a), Bq = this.v(b), C = this.v(c), D = this.v(d); this.put(A, Bq, C, ca, cb, cc, k, null); this.put(A, C, D, ca, cc, cd, k, null); return this; }
  /** a skin over a stack of rings of equal length; a ring whose points coincide is a tip. capA/capB: true, or a colour */
  loft(rings, col, capA = false, capB = false) {
    const W = rings.map((r) => r.map((q) => this.v(q))), cl = rings.map(ctr), cw = W.map(ctr);
    const pt = rings.map((r) => Math.hypot(...sub(r[0], r[1])) < 1e-7 && Math.hypot(...sub(r[0], r[r.length >> 1])) < 1e-7);
    const face = (la, lb, lc, ld, a, b, c, d, lref, wref, i, j, cc) => {
      let n = cross(sub(c, a), d ? sub(d, b) : sub(b, a));
      n = dot(n, n) < 1e-18 ? norm(wref) : norm(n);
      if (dot(n, wref) < 0) n = sc3(n, -1);
      const fc = ld ? sc3(add(add(la, lb), add(lc, ld)), 0.25) : sc3(add(add(la, lb), lc), 1 / 3);
      const hex = typeof cc === 'function' ? cc(fc[0], fc[1], fc[2], n[0], n[1], n[2], i, j) : cc, k = this.k();
      this.put(a, b, c, hex, hex, hex, k, n);
      if (d) this.put(a, c, d, hex, hex, hex, k, n);
    };
    for (let i = 0; i < rings.length - 1; i++) {
      if (pt[i] && pt[i + 1]) continue;
      const A = rings[i], Bq = rings[i + 1], n = A.length, lm = lerp3(cl[i], cl[i + 1], 0.5), wm = lerp3(cw[i], cw[i + 1], 0.5);
      for (let j = 0; j < n; j++) {
        const q = (j + 1) % n;
        if (pt[i]) { const lf = sc3(add(add(A[j], Bq[j]), Bq[q]), 1 / 3), wf = sc3(add(add(W[i][j], W[i + 1][j]), W[i + 1][q]), 1 / 3); face(A[j], Bq[q], Bq[j], null, W[i][j], W[i + 1][q], W[i + 1][j], null, sub(lf, lm), sub(wf, wm), i, j, col); }
        else if (pt[i + 1]) { const wf = sc3(add(add(W[i][j], W[i][q]), W[i + 1][j]), 1 / 3); face(A[j], A[q], Bq[j], null, W[i][j], W[i][q], W[i + 1][j], null, null, sub(wf, wm), i, j, col); }
        else { const wf = sc3(add(add(W[i][j], W[i][q]), add(W[i + 1][q], W[i + 1][j])), 0.25); face(A[j], A[q], Bq[q], Bq[j], W[i][j], W[i][q], W[i + 1][q], W[i + 1][j], null, sub(wf, wm), i, j, col); }
      }
    }
    const cap = (i, o, cc) => {
      if (pt[i]) return;
      const r = rings[i], w = W[i], n = r.length, wref = sub(cw[i], cw[o]);
      for (let j = 0; j < n; j++) { const q = (j + 1) % n; face(cl[i], r[j], r[q], null, cw[i], w[j], w[q], null, null, wref, i, j, cc === true ? col : cc); }
    };
    if (capA && rings.length > 1) cap(0, 1, capA);
    if (capB && rings.length > 1) cap(rings.length - 1, rings.length - 2, capB);
    return this;
  }
  /** a tube of n sides along pts. rad: number, array or fn(u). o: { cap: 1 start | 2 end, flat, rot, capCol } */
  tube(pts, rad, n, col, o = {}) {
    const m = pts.length, rings = [];
    let nv = null;
    for (let i = 0; i < m; i++) {
      const t = norm(sub(pts[Math.min(m - 1, i + 1)], pts[Math.max(0, i - 1)]));
      if (!nv) nv = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      nv = norm(sub(nv, sc3(t, dot(nv, t))));
      const bv = cross(t, nv), u = m > 1 ? i / (m - 1) : 0, r = typeof rad === 'function' ? rad(u, i) : Array.isArray(rad) ? rad[Math.min(i, rad.length - 1)] : rad, ring = [];
      for (let j = 0; j < n; j++) { const a = (j / n) * TAU + (o.rot || 0), ca = Math.cos(a) * r * (o.flat || 1), sa = Math.sin(a) * r; ring.push([pts[i][0] + nv[0] * ca + bv[0] * sa, pts[i][1] + nv[1] * ca + bv[1] * sa, pts[i][2] + nv[2] * ca + bv[2] * sa]); }
      rings.push(ring);
    }
    const cap = o.cap || 0, cc = o.capCol === undefined ? true : o.capCol;
    return this.loft(rings, col, cap & 1 ? cc : false, cap & 2 ? cc : false);
  }
  /** a straight bar from a to b */
  beam(a, b, r, col, n = 4, o = {}) { return this.tube([a, b], r, n, col, { rot: PI / 4, ...o }); }
  /** a frustum standing on y0 */
  cyl(x, y0, z, r0, r1, h, n, col, cap = 2, rot = 0, capCol = true) {
    const ring = (r, y) => { const o = []; for (let j = 0; j < n; j++) { const a = (j / n) * TAU + rot; o.push([x + Math.cos(a) * r, y, z - Math.sin(a) * r]); } return o; };
    return this.loft([ring(r0, y0), ring(r1, y0 + h)], col, cap & 1 ? capCol : false, cap & 2 ? capCol : false);
  }
  /** a box standing on y0, w along X, d along Z, turned by ry; top (and bottom with cap 3) closed */
  box(x, y0, z, w, h, d, col, ry = 0, cap = 2, taper = 1) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const ring = (y, k) => [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([a, b]) => { const px = a * w * 0.5 * k, pz = b * d * 0.5 * k; return [x + px * c + pz * s, y, z - px * s + pz * c]; });
    return this.loft([ring(y0, 1), ring(y0 + h, taper)], col, !!(cap & 1), !!(cap & 2));
  }
  /** an ellipsoid of n sides and m bands; rough > 0 with R knocks it about */
  ball(x, y, z, rx, ry, rz, col, n = 6, m = 3, rough = 0, R = null) {
    const rings = [];
    for (let i = 0; i <= m; i++) {
      const lat = -PI / 2 + (PI * i) / m, cr = i === 0 || i === m ? 0 : Math.cos(lat), sy = Math.sin(lat), ring = [];
      for (let j = 0; j < n; j++) { const a = (j / n) * TAU + i * 0.4, k = rough && R && cr ? 1 + (R() - 0.5) * 2 * rough : 1; ring.push([x + Math.cos(a) * cr * rx * k, y + sy * ry * (rough && R && !cr ? 1 + (R() - 0.5) * rough : 1), z - Math.sin(a) * cr * rz * k]); }
      if (!cr) for (let j = 1; j < n; j++) ring[j] = ring[0];
      rings.push(ring);
    }
    return this.loft(rings, col);
  }
  /** turned about the vertical through (x, z): prof = [[r, y], ...] bottom first; r = 0 closes it */
  lathe(x, y, z, prof, n, col, sx = 1, sz = 1, rot = 0) {
    const rings = prof.map(([r, py]) => { const o = []; for (let j = 0; j < n; j++) { const a = (j / n) * TAU + rot; o.push([x + Math.cos(a) * r * sx, y + py, z - Math.sin(a) * r * sz]); } return o; });
    return this.loft(rings, col);
  }
  /** a flat fan round c through pts (a sheet) */
  fan(c, pts, col, colC = col, close = true) { const n = pts.length; for (let j = 0; j < (close ? n : n - 1); j++) this.tri(c, pts[j], pts[(j + 1) % n], colC, col, col); return this; }
  /** a ribbon along pts, w wide (number or fn(u)) across side */
  ribbon(pts, w, side, col) {
    const m = pts.length;
    for (let i = 0; i < m - 1; i++) {
      const w0 = (typeof w === 'function' ? w(i / (m - 1)) : w) * 0.5, w1 = (typeof w === 'function' ? w((i + 1) / (m - 1)) : w) * 0.5, c = typeof col === 'function' ? col(i) : col;
      const a = add(pts[i], sc3(side, -w0)), b = add(pts[i], sc3(side, w0)), c2 = add(pts[i + 1], sc3(side, w1)), d = add(pts[i + 1], sc3(side, -w1));
      if (w1 < 1e-6) this.tri(a, b, pts[i + 1], c); else this.quad(a, b, c2, d, c);
    }
    return this;
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nn), 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---- materials and scene helpers ----
let MATS = null;
function mats() {
  return MATS ||= {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    animal: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    smoke: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }),
  };
}
function mesh(geo, mat = 'solid') { const m = new THREE.Mesh(geo, mats()[mat]); const lit = mat === 'solid' || mat === 'animal'; m.castShadow = lit; m.receiveShadow = lit; return m; }
function group(...kids) { const g = new THREE.Group(); for (const k of kids) if (k) g.add(k); return g; }
function rootOf(kind, variant, kids, extra) { const g = group(...kids); g.userData = { kind, variant, ...extra }; return g; }
/** make o a moving part: an animation record of plain numbers (kind k) with its rest position, rotation and scale */
function anim(o, k, d = {}, p = [0, 0, 0], r = [0, 0, 0], s = 1) { o.position.set(p[0], p[1], p[2]); o.rotation.set(r[0], r[1], r[2]); o.scale.setScalar(s); o.userData.jg = { k, p, r, s, ph: 0, rate: 1, ...d }; return o; }
function part(o, name, p, r) { o.userData.part = name; if (p) o.position.set(p[0], p[1], p[2]); if (r) o.rotation.set(r[0], r[1], r[2]); return o; }
/** an inner group turned and sized a little by the seed, so two of the same variant do not look stamped */
function turned(R, kids, sv = 0.1) { const g = group(...kids); g.rotation.y = R() * TAU; g.scale.setScalar(1 - sv + R() * sv * 2); return g; }

// ---- palette ----
const C = {
  leaf: 0x2c962a, leafL: 0x5cb82a, leafD: 0x1a6e2e, leafB: 0x0f5f3c, palm: 0x3fa42a, palmL: 0x7cc430, palmD: 0x237a2a, jade: 0x1f9a5a,
  canopy: 0x12553a, canopyL: 0x1f7040, canopyD: 0x0a3a2a,
  bark: 0x8d6b48, barkD: 0x5c432e, barkL: 0xb7986c, palmBark: 0xa89878, palmBarkD: 0x7d6c52, root: 0x9a8468,
  wood: 0xa06e40, woodD: 0x6b4527, woodL: 0xc99c62, drift: 0xbcab8e, driftD: 0x8f7e66,
  bamboo: 0xa4c83e, bambooG: 0xdcc452, bambooD: 0x64902c,
  thatch: 0xa8842e, thatchD: 0x8a6a26, thatchL: 0xb8983c, thatchO: 0x7a6428,
  reed: 0x5c4a30, reedL: 0x84703f, mat: 0xb48e40,
  hide: 0xb9783c, hideL: 0xdcae6c, hideD: 0x7b4a26, fur: 0x4c3524,
  bone: 0xf0e8cf, boneD: 0xcbbf9c, clay: 0xc4633a, clayD: 0x8f4428,
  rope: 0xcbb37a, vine: 0x4c902c, moss: 0x6fae3a, mossD: 0x3f7a2e, spanish: 0x9fb08c,
  red: 0xd9382a, orange: 0xf28a1e, yellow: 0xf6ca32, blue: 0x2a6fd9, teal: 0x22b6a8, purple: 0x8b3a9c, pink: 0xe8709a, white: 0xf5f0e2, black: 0x1f1b19,
  stone: 0x8c8c86, stoneD: 0x64645f, mud: 0x5b3f29, mudW: 0x7a5a3c, soot: 0x282421, sand: 0xe6d49a,
  fire: 0xff7a1a, fireH: 0xffc23a, ember: 0xe8361a,
};
const up = (a, b, t0 = 0.2, t1 = 0.75) => (x, y, z, nx, ny) => mix(a, b, (ny - t0) / (t1 - t0));   // lighter on the faces turned to the sky

// =====================================================================================
// FLORA
// =====================================================================================
/** a feathered frond from the origin out along +X: rises at `rise`, bends down by `bend` along its length */
function frond(T, L, W, rise, bend, segs, c1, c2, droop = 0.5, yaw = 0, o = [0, 0, 0]) {
  let x = 0, y = 0; const m = [[0, 0, 0]], cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 1; i <= segs; i++) { const th = rise - bend * ((i - 0.5) / segs) ** 1.2; x += (Math.cos(th) * L) / segs; y += (Math.sin(th) * L) / segs; m.push([x, y, 0]); }
  const P = (q) => [o[0] + q[0] * cy + q[2] * sy, o[1] + q[1], o[2] - q[0] * sy + q[2] * cy];
  const wAt = (i) => (i === segs ? 0 : W * Math.sin(PI * (0.16 + 0.8 * (i / segs))) ** 0.6 * (i % 2 ? 1 : 0.62));
  const edge = (i, sd) => { const a = m[Math.max(0, i - 1)], b = m[Math.min(segs, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1, w = wAt(i); return [m[i][0] + (ty / l) * droop * w + (i % 2 ? (tx / l) * w * 0.35 : 0), m[i][1] - (tx / l) * droop * w + (i % 2 ? (ty / l) * w * 0.35 : 0), sd * w]; };
  for (let i = 0; i < segs; i++) for (const sd of [-1, 1]) {
    const col = sd > 0 ? c1 : c2;
    if (i === segs - 1) T.tri(P(m[i]), P(m[i + 1]), P(edge(i, sd)), col); else T.quad(P(m[i]), P(m[i + 1]), P(edge(i + 1, sd)), P(edge(i, sd)), col);
  }
  return P(m[segs]);
}
/** a broad paddle leaf (banana): quads off a midrib, torn here and there */
function paddle(T, R, L, W, rise, bend, segs, c1, c2, yaw, o, tear = 0.35) {
  let x = 0, y = 0; const m = [[0, 0, 0]], cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 1; i <= segs; i++) { const th = rise - bend * ((i - 0.5) / segs) ** 1.4; x += (Math.cos(th) * L) / segs; y += (Math.sin(th) * L) / segs; m.push([x, y, 0]); }
  const P = (q) => [o[0] + q[0] * cy + q[2] * sy, o[1] + q[1], o[2] - q[0] * sy + q[2] * cy];
  const wAt = (u) => (u < 0.12 ? 0.12 : W * Math.sin(PI * clamp((u - 0.1) / 0.92, 0, 1) ** 0.75) ** 0.6);
  for (const sd of [-1, 1]) for (let i = 0; i < segs; i++) {
    const a = m[i], b = m[i + 1], w0 = wAt(i / segs), w1 = i === segs - 1 ? 0 : wAt((i + 1) / segs) * (R() < tear ? 0.45 : 1), dr = 0.22;
    const e0 = [a[0], a[1] - w0 * dr, sd * w0], e1 = [b[0] - (w1 < wAt((i + 1) / segs) ? 0.05 : 0), b[1] - w1 * dr, sd * w1];
    if (w1 === 0) T.tri(P(a), P(b), P(e0), c2, c2, c1); else T.quad(P(a), P(b), P(e1), P(e0), c2, c2, c1, c1);
  }
}
/** a leafy lump: lit top, dark underside */
function clump(T, R, x, y, z, rx, ry, rz, top, mid, low, n = 7, m = 4, rough = 0.16) {
  T.ball(x, y, z, rx, ry, rz, (px, py, pz, nx, ny) => (ny > 0.45 ? top : ny > -0.25 ? mid : low), n, m, rough, R);
}
function palmGeo(v) {
  return cached(`palm:${v}`, () => {
    const R = rng(v * 71 + 5), T = new B(0.06), H = [4.1, 3.6, 4.4, 3.9][v], lean = [0.9, -0.5, 0.35, 1.3][v], az = [0.3, 2.2, 4.1, 5.3][v];
    const top = [Math.cos(az) * lean, H, Math.sin(az) * lean], secs = 7, pts = [], rad = [];
    for (let i = 0; i <= secs; i++) {
      const u = i / secs, k = u ** 1.7, p = [top[0] * k, H * u, top[2] * k], r = lerp(0.2, 0.12, u) + (i === 0 ? 0.08 : 0);
      if (i) { pts.push(add(p, [0, -0.02, 0])); rad.push(r * 1.16); }
      pts.push(p); rad.push(r);
    }
    T.tube(pts, rad, 6, (x, y, z, nx, ny, nz, i) => (i % 2 ? C.palmBarkD : (i >> 1) % 2 ? C.palmBark : mix(C.palmBark, C.barkL, 0.5)), { cap: 0 });
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; T.tube([[Math.cos(a) * 0.2, 0.16, Math.sin(a) * 0.2], [Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34]], [0.07, 0.04], 3, C.palmBarkD); }
    const Cr = new B(0.08), nF = 10;
    for (let i = 0; i < nF; i++) {
      const hi = i % 2, a = (i / nF) * TAU + R() * 0.3;
      frond(Cr, (hi ? 1.55 : 1.95) + R() * 0.25, 0.4, hi ? 0.95 : 0.3, hi ? 1.9 : 1.5 + R() * 0.3, 7, hi ? C.palmL : C.palm, hi ? C.palm : C.palmD, 0.5, a, [0, 0.05, 0]);
    }
    for (let i = 0; i < 3; i++) frond(Cr, 0.9, 0.2, 1.45, 0.5, 3, C.palmL, 0xb4e04a, 0.4, i * 2.1 + 0.5, [0, 0.05, 0]);
    Cr.ball(0, 0, 0, 0.17, 0.14, 0.17, C.palmBarkD, 5, 2);
    for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.8, r = 0.2; Cr.ball(Math.cos(a) * r, -0.2 - (i % 2) * 0.1, Math.sin(a) * r, 0.125, 0.14, 0.125, i % 3 === 0 ? 0x86a83a : 0x7a5632, 5, 3); }
    return { trunk: T.geo(), crown: Cr.geo(), top, H };
  });
}
function bananaGeo(v) {
  return cached(`banana:${v}`, () => {
    const R = rng(v * 37 + 3), T = new B(0.06), H = [1.25, 1.1, 1.35][v], lean = [0.1, -0.12, 0.05][v];
    T.tube([[0, 0, 0], [lean * 0.3, H * 0.5, 0], [lean, H, 0]], [0.2, 0.15, 0.1], 6, (x, y) => (y < 0.25 ? 0x6a7a30 : hash(Math.floor(y * 6)) > 0.5 ? 0x5e9a2e : 0x4e8a2a));
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + 1; T.tri([Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [Math.cos(a + 0.7) * 0.19, 0.02, Math.sin(a + 0.7) * 0.19], [Math.cos(a + 0.3) * 0.34, 0.5 + R() * 0.2, Math.sin(a + 0.3) * 0.34], 0xb9a25a); }   // dry sheaths
    const L = new B(0.07), nL = 7;
    for (let i = 0; i < nL; i++) {
      const a = (i / nL) * TAU + R() * 0.4, hi = i % 3 === 0;
      paddle(L, R, (hi ? 0.8 : 0.9) + R() * 0.15, 0.27 + R() * 0.05, hi ? 1.25 : 0.75 + R() * 0.2, hi ? 1.0 : 1.5 + R() * 0.4, 5, i % 2 ? 0x268a24 : 0x319c2a, 0x52ae2e, a, [0, 0, 0]);
    }
    // the bunch: a stalk arching out and down, tiers of fingers, and the purple bud at the end
    const ba = [0.6, 3.5, 2.0][v], dx = Math.cos(ba), dz = Math.sin(ba), st = [[0, -0.05, 0], [dx * 0.2, 0.0, dz * 0.2], [dx * 0.34, -0.2, dz * 0.34], [dx * 0.36, -0.75, dz * 0.36]];
    L.tube(st, 0.03, 3, 0x7a9a3a);
    for (let tier = 0; tier < 3; tier++) for (let j = 0; j < 5; j++) { const a = j * 1.256 + tier * 0.6, y = -0.25 - tier * 0.13, cx = dx * 0.35 + Math.cos(a) * 0.035, cz = dz * 0.35 + Math.sin(a) * 0.035; L.tube([[cx, y, cz], [cx + Math.cos(a) * 0.09, y - 0.02, cz + Math.sin(a) * 0.09], [cx + Math.cos(a) * 0.11, y + 0.09, cz + Math.sin(a) * 0.11]], [0.035, 0.04, 0.012], 3, tier === 2 ? 0xa8d040 : C.yellow); }
    L.lathe(dx * 0.36, -0.95, dz * 0.36, [[0, 0], [0.075, 0.09], [0.06, 0.18], [0, 0.24]], 5, C.purple);
    return { stem: T.geo(), leaves: L.geo(), top: [lean, H, 0] };
  });
}
function banyanGeo(v) {
  return cached(`banyan:${v}`, () => {
    const R = rng(v * 91 + 17), T = new B(0.08), Vn = new B(0.08);
    const barkC = (x, y, z, nx, ny, nz, i, j) => (j % 2 ? C.root : mix(C.root, C.barkD, 0.45));
    // the trunk: a fluted column of fused roots
    const tr = [];
    for (const [y, r] of [[0, 0.62], [0.35, 0.44], [1.2, 0.4], [1.9, 0.5]]) { const ring = []; for (let j = 0; j < 9; j++) { const a = (j / 9) * TAU, k = r * (j % 2 ? 0.74 : 1.1) * (0.92 + R() * 0.16); ring.push([Math.cos(a) * k, y, -Math.sin(a) * k]); } tr.push(ring); }
    T.loft(tr, barkC);
    const nB = 6 + (v % 2), ends = [];
    for (let i = 0; i < nB; i++) {
      const a = (i / nB) * TAU + R() * 0.4 + v, L = 1.15 + R() * 0.3, y1 = 2.35 + R() * 0.35;
      const p0 = [Math.cos(a) * 0.25, 1.75, Math.sin(a) * 0.25], p1 = [Math.cos(a) * L * 0.55, y1 + 0.1, Math.sin(a) * L * 0.55], p2 = [Math.cos(a) * L, y1, Math.sin(a) * L];
      T.tube([p0, p1, p2], [0.2, 0.13, 0.08], 5, barkC);
      ends.push([a, L, y1]);
      // prop roots dropping from the bough like pillars
      const nr = 1 + (R() < 0.75 ? 1 : 0);
      for (let k = 0; k < nr; k++) {
        const f = k ? 0.52 + R() * 0.1 : 0.9 + R() * 0.12, aa = a + (R() - 0.5) * 0.25, rr = L * f, y0 = lerp(1.9, y1, clamp(f, 0, 1)), wob = (R() - 0.5) * 0.16, r0 = 0.07 + R() * 0.035;
        T.tube([[Math.cos(aa) * rr, y0, Math.sin(aa) * rr], [Math.cos(aa) * rr + wob, y0 * 0.5, Math.sin(aa) * rr - wob], [Math.cos(aa) * (rr + 0.03), 0.14, Math.sin(aa) * (rr + 0.03)], [Math.cos(aa) * (rr + 0.06), -0.02, Math.sin(aa) * (rr + 0.06)]], [r0, r0 * 0.85, r0 * 1.2, r0 * 2.2], 4, barkC);
      }
      // thin aerial roots that have not reached the ground yet
      for (let k = 0; k < 2; k++) { const f = 0.5 + R() * 0.6, aa = a + (R() - 0.5) * 0.6, rr = L * f, y0 = y1 + 0.1, len = 0.7 + R() * 1.0; Vn.tube([[Math.cos(aa) * rr, y0 - 2.5, Math.sin(aa) * rr], [Math.cos(aa) * rr + 0.03, y0 - 2.5 - len, Math.sin(aa) * rr]], [0.03, 0.012], 3, C.root); }
    }
    // the canopy: a broad dark dome of lumps
    for (const [a, L, y1] of ends) clump(T, R, Math.cos(a) * L * 0.92, y1 + 0.55 + R() * 0.2, Math.sin(a) * L * 0.95, 0.95 + R() * 0.2, 0.62 + R() * 0.12, 0.95 + R() * 0.2, C.canopyL, C.canopy, C.canopyD, 7, 4, 0.2);
    clump(T, R, 0.1, 3.75, -0.05, 1.35, 0.75, 1.3, C.canopyL, C.canopy, C.canopyD, 8, 4, 0.18);
    // hanging vines round the skirt of the canopy
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + R() * 0.3, r = 1.2 + R() * 0.8, len = 0.6 + R() * 1.1, y0 = 2.75 + R() * 0.2 - 2.5, x = Math.cos(a) * r, z = Math.sin(a) * r, sd = [-Math.sin(a), 0, Math.cos(a)];
      Vn.ribbon([[x, y0, z], [x + 0.03, y0 - len * 0.5, z + 0.03], [x, y0 - len, z]], (u) => 0.07 * (1 - u * 0.9), sd, i % 2 ? C.vine : C.leafD);
      for (let k = 0; k < 2; k++) { const yy = y0 - len * (0.3 + k * 0.35); Vn.tri([x, yy, z], [x + sd[0] * 0.12, yy - 0.05, z + sd[2] * 0.12], [x + sd[0] * 0.03, yy - 0.14, z + sd[2] * 0.03], C.leafL); }
    }
    return { tree: T.geo(), vines: Vn.geo() };
  });
}
function mangroveGeo(v) {
  return cached(`mangrove:${v}`, () => {
    const R = rng(v * 43 + 29), T = new B(0.08), lean = [0.25, -0.3, 0.1][v], tw = [0.5, 2.6, 4.4][v];
    const barkC = (x, y, z, nx, ny, nz, i, j) => (y < 0.06 ? 0x4a4034 : j % 2 ? 0x9c8a70 : 0x7a6850);
    const hub = [0, 0.85, 0], topP = [Math.cos(tw) * lean * 2, 1.75, Math.sin(tw) * lean * 2];
    T.tube(curve([[0, 0.55, 0], hub, [Math.cos(tw + 1) * 0.16, 1.25, Math.sin(tw + 1) * 0.16], topP], 2), (u) => lerp(0.15, 0.085, u), 5, barkC);
    const nR = 8 + v;
    for (let i = 0; i < nR; i++) {
      const a = (i / nR) * TAU + R() * 0.35, y0 = 0.5 + R() * 0.5, r = 0.48 + R() * 0.3, r0 = 0.05 + R() * 0.02;
      const c = Math.cos(a), s = Math.sin(a);
      T.tube([[c * 0.07, y0, s * 0.07], [c * r * 0.5, y0 + 0.06 - R() * 0.1, s * r * 0.5], [c * r * 0.88, y0 * 0.55, s * r * 0.88], [c * r, 0.1, s * r], [c * (r + 0.04), -0.36, s * (r + 0.04)]], (u) => r0 * (1 - u * 0.35), 4, barkC);
      if (i % 3 === 0) T.tube([[c * r * 0.6, y0 - 0.02, s * r * 0.6], [Math.cos(a + 0.5) * r * 0.85, 0.1, Math.sin(a + 0.5) * r * 0.85], [Math.cos(a + 0.55) * r * 0.9, -0.36, Math.sin(a + 0.55) * r * 0.9]], r0 * 0.6, 3, barkC);
    }
    for (let i = 0; i < 3; i++) { const a = tw + i * 2.1 + 0.6; T.tube([lerp3(hub, topP, 0.45 + i * 0.2), add(topP, [Math.cos(a) * 0.5, 0.1 + i * 0.08, Math.sin(a) * 0.5])], [0.06, 0.03], 4, barkC); clump(T, R, topP[0] + Math.cos(a) * 0.52, 2.0 + i * 0.1, topP[2] + Math.sin(a) * 0.52, 0.52, 0.36, 0.5, 0x1f8f3c, 0x147a40, 0x0c5a34, 7, 3, 0.18); }
    clump(T, R, topP[0], 2.28, topP[2], 0.6, 0.4, 0.58, 0x1f8f3c, 0x147a40, 0x0c5a34, 7, 4, 0.18);
    return T.geo();
  });
}
function fernGeo(v) {
  return cached(`fern:${v}`, () => {
    const R = rng(v * 13 + 1), T = new B(0.09), n = 9 + v;
    for (let i = 0; i < n; i++) frond(T, 0.6 + R() * 0.18, 0.15, 1.25 + R() * 0.2, 1.8 + R() * 0.5, 5, i % 2 ? C.leaf : C.leafD, C.leafL, 0.35, (i / n) * TAU + R() * 0.3, [0, 0.02, 0]);
    for (let i = 0; i < 5; i++) frond(T, 0.5 + R() * 0.1, 0.11, 1.5, 0.8, 4, C.leafL, 0x86d040, 0.3, i * 1.3 + 0.4, [0, 0.02, 0]);
    for (let i = 0; i < 2; i++) { const a = R() * TAU, c = Math.cos(a), s = Math.sin(a); T.tube([[c * 0.05, 0, s * 0.05], [c * 0.09, 0.3, s * 0.09], [c * 0.13, 0.42, s * 0.13], [c * 0.19, 0.44, s * 0.19], [c * 0.2, 0.37, s * 0.2], [c * 0.16, 0.36, s * 0.16]], 0.022, 3, 0xc4d85a); }   // fiddleheads
    return T.geo();
  });
}
function earGeo(v) {
  return cached(`ear:${v}`, () => {
    const R = rng(v * 19 + 7), T = new B(0.06), n = 5 + v;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R() * 0.5, r = 0.1 + R() * 0.16, h = 0.45 + R() * 0.38, c = Math.cos(a), s = Math.sin(a), top = [c * r, h, s * r], sz = 0.25 + R() * 0.08;
      T.tube([[c * 0.04, 0, s * 0.04], [c * r * 0.5, h * 0.6, s * r * 0.5], top], [0.03, 0.022, 0.018], 3, 0x8fc850);
      // a heart-shaped blade hanging tip-down and outward from the top of its stalk
      const o = [c, 0, s], sd = [-s, 0, c], tilt = 0.5 + R() * 0.3, f = [Math.cos(tilt) * c, -Math.sin(tilt), Math.cos(tilt) * s];   // f: toward the tip
      const P = (alongTip, across) => add(top, add(sc3(f, alongTip * sz), sc3(sd, across * sz)));
      const rim = [P(-0.3, 0.0), P(-0.48, 0.3), P(-0.3, 0.62), P(0.2, 0.7), P(0.75, 0.42), P(1.3, 0), P(0.75, -0.42), P(0.2, -0.7), P(-0.3, -0.62), P(-0.48, -0.3)].map((q, k) => add(q, [0, k === 5 ? -0.03 : 0.05 * sz * (k % 2), 0]));
      const mid = add(P(0.25, 0), [0, -0.05 * sz, 0]);
      T.fan(mid, rim, i % 2 ? 0x1f8a2e : 0x238f4a, 0x58b83a);
      void o;
    }
    return T.geo();
  });
}
function bromeliadGeo(v) {
  return cached(`brom:${v}`, () => {
    const R = rng(v * 23 + 11), T = new B(0.07), tipC = [C.red, C.pink, C.orange][v], spikeC = [C.orange, C.red, C.yellow][v];
    for (let ring = 0; ring < 2; ring++) {
      const n = ring ? 7 : 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + ring * 0.4 + R() * 0.2, c = Math.cos(a), s = Math.sin(a), L = ring ? 0.2 : 0.32 + R() * 0.05, up0 = ring ? 0.3 : 0.14, sd = [-s, 0, c];
        const p0 = [c * 0.03, 0.03, s * 0.03], p1 = [c * L * 0.55, up0 + 0.06, s * L * 0.55], p2 = [c * L, up0 - (ring ? 0 : 0.03), s * L], w = 0.055;
        const g = ring ? mix(C.leaf, tipC, 0.75) : C.leaf, g2 = ring ? tipC : C.leafD;
        for (const k of [-1, 1]) { const e0 = add(p0, sc3(sd, k * w * 0.7)), e1 = add(add(p1, sc3(sd, k * w)), [0, 0.03, 0]); T.quad(p0, p1, e1, e0, g2, g, g, g2); T.tri(p1, p2, e1, g, ring ? tipC : mix(C.leaf, tipC, 0.6), g); }
      }
    }
    for (let i = 0; i < 4; i++) T.cyl(0, 0.1 + i * 0.09, 0, 0.075 - i * 0.012, 0.03, 0.13, 5, i === 3 ? C.yellow : i % 2 ? spikeC : mix(spikeC, C.red, 0.5), 0, i * 0.6);
    T.cyl(0, 0.44, 0, 0.03, 0, 0.08, 4, C.yellow, 0);
    return T.geo();
  });
}
function bambooGeo(v) {
  return cached(`bamboo:${v}`, () => {
    const R = rng(v * 67 + 9), T = new B(0.07), n = 8 + v;
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, r = Math.sqrt(R()) * 0.36, x = Math.cos(a) * r, z = Math.sin(a) * r, H = 2.2 + R() * 1.0, la = a + (R() - 0.5), lean = 0.08 + R() * 0.2, r0 = 0.05 + R() * 0.02, gold = R() < 0.4, segs = 5, pts = [];
      for (let k = 0; k <= segs; k++) { const u = k / segs, q = lean * u * u; pts.push([x + Math.cos(la) * q, H * u, z + Math.sin(la) * q]); }
      T.tube(pts, (u) => r0 * (1 - u * 0.45), 4, (px, py, pz, nx, ny, nz, s) => (s % 2 ? (gold ? C.bambooG : C.bamboo) : gold ? 0xc0a83c : C.bambooD), { rot: R() });
      for (let k = 2; k <= segs; k++) { if (R() < 0.3) continue; const p = pts[k], nl = k === segs ? 4 : 2; for (let j = 0; j < nl; j++) { const b = R() * TAU, L = 0.3 + R() * 0.14, c = Math.cos(b), s = Math.sin(b), tip = [p[0] + c * L, p[1] - 0.12 + (k === segs ? 0.18 : 0), p[2] + s * L], w = 0.07; T.quad(p, [p[0] + c * L * 0.5 - s * w, p[1] + 0.08, p[2] + s * L * 0.5 + c * w], tip, [p[0] + c * L * 0.5 + s * w, p[1] + 0.08, p[2] + s * L * 0.5 - c * w], j % 2 ? C.leafL : C.leaf); } }
    }
    for (let i = 0; i < 3; i++) { const a = R() * TAU, r = 0.3 + R() * 0.2; T.cyl(Math.cos(a) * r, 0, Math.sin(a) * r, 0.045, 0.02, 0.3 + R() * 0.2, 4, 0xb8a85a, 2); }   // new shoots
    return T.geo();
  });
}
/** bark below, moss on the faces turned up */
const mossy = (seed, wood = C.bark, woodD = C.barkD) => (x, y, z, nx, ny, nz, i, j) => (ny > 0.3 ? (hash(i * 7 + j * 3 + seed) > 0.4 ? C.moss : C.mossD) : hash(i * 5 + j + seed) > 0.5 ? wood : woodD);
function logGeo(v) {
  return cached(`log:${v}`, () => {
    const R = rng(v * 29 + 13), T = new B(0.08), bend = [0.06, -0.08, 0.03][v], r = 0.17;
    const pts = [[-0.8, r, 0], [-0.3, r, bend], [0.25, r, bend * 0.5], [0.8, r, -bend]];
    T.tube(pts, [r, r * 1.05, r * 0.95, r * 0.9], 7, mossy(v));
    for (const [e, sg] of [[0, -1], [3, 1]]) { const rr = e ? r * 0.9 : r, ring = [], inner = []; for (let j = 0; j < 7; j++) { const a = (j / 7) * TAU; ring.push([pts[e][0], r + Math.cos(a) * rr, pts[e][2] + Math.sin(a) * rr]); inner.push([pts[e][0] - sg * 0.1, r + Math.cos(a) * rr * 0.55, pts[e][2] + Math.sin(a) * rr * 0.55]); } T.loft([ring, inner], C.woodL, false, 0x2e2018); }
    T.tube([[0.3, r + 0.1, bend * 0.5], [0.42, r + 0.34, bend * 0.5 + 0.12]], [0.06, 0.04], 4, mossy(v + 3), { cap: 2, capCol: C.woodL });
    // shelf fungi up one side, toadstools at the foot, a tuft of moss and a sprig of fern on top
    for (let i = 0; i < 4; i++) { const x = -0.6 + i * 0.3 + R() * 0.1, y = 0.12 + R() * 0.12, z = Math.sqrt(Math.max(0, r * r - (y - r) ** 2)) - 0.02 + (x > -0.3 ? bend : 0), rr = 0.09 + R() * 0.04, pts2 = []; for (let j = 0; j <= 4; j++) { const a = (j / 4) * PI; pts2.push([x + Math.cos(a) * rr, y - 0.02, z + Math.sin(a) * rr * 0.9]); } T.fan([x, y + 0.02, z], pts2, i % 2 ? C.orange : 0xf2b04a, C.white, false); }
    for (let i = 0; i < 3; i++) { const x = -0.5 + R() * 1.0, z = -0.26 - R() * 0.08, h = 0.1 + R() * 0.07; T.cyl(x, 0, z, 0.018, 0.015, h, 4, C.white, 0); T.cyl(x, h, z, 0.065, 0, 0.05, 6, i === 1 ? 0xe8b23a : C.red, 1, 0, C.white); }
    for (let i = 0; i < 3; i++) { const x = -0.6 + i * 0.5 + R() * 0.15; T.ball(x, r * 2 - 0.02, (R() - 0.5) * 0.1, 0.1 + R() * 0.05, 0.05, 0.08, i % 2 ? C.moss : 0x86c84a, 5, 2); }
    for (let i = 0; i < 3; i++) frond(T, 0.3, 0.09, 1.2, 1.4, 3, C.leafL, C.leaf, 0.3, i * 2.1 + v, [-0.15, r * 2 - 0.03, 0.03]);
    return T.geo();
  });
}
function vineGeo(v) {
  return cached(`vines:${v}`, () => {
    const R = rng(v * 59 + 31), out = [];
    for (let layer = 0; layer < 2; layer++) {
      const T = new B(0.09), z = layer ? -0.06 : 0.06, n = layer ? 6 : 7;
      for (let i = 0; i < n; i++) {
        const x = -0.55 + (i + (layer ? 0.5 : 0) + R() * 0.5) * (1.1 / n), len = 0.8 + R() * 0.8, moss = layer === 1 && i % 2 === 0, wob = (R() - 0.5) * 0.12;
        const pts = [[x, 0, z], [x + wob, -len * 0.35, z + (R() - 0.5) * 0.06], [x - wob * 0.6, -len * 0.7, z], [x + wob * 0.3, -len, z]];
        if (moss) T.ribbon(pts, (u) => 0.16 * (1 - u) + 0.02, [1, 0, 0], (s) => (s % 2 ? C.spanish : 0x86987a));
        else {
          T.ribbon(pts, 0.035, [1, 0, 0], C.vine);
          for (let k = 0; k < 5; k++) { const u = (k + 0.6) / 5.4, p = lerp3(pts[Math.min(2, Math.floor(u * 3))], pts[Math.min(3, Math.floor(u * 3) + 1)], frac(u * 3)), sd = k % 2 ? 1 : -1, w = 0.1 + R() * 0.03; T.quad(p, [p[0] + sd * w, p[1] - 0.02, p[2] + 0.02], [p[0] + sd * w * 0.9, p[1] - 0.16, p[2]], [p[0] + sd * 0.01, p[1] - 0.1, p[2] - 0.01], k % 3 ? C.leaf : C.leafL); }
          if (i % 3 === 1) { const p = pts[3]; T.ball(p[0], p[1] - 0.04, p[2], 0.05, 0.06, 0.05, i % 2 ? C.pink : C.purple, 5, 2); }   // a flower at the end
        }
      }
      if (!layer) { T.tube([[-0.62, 0, 0], [-0.2, -0.05, 0.02], [0.25, -0.02, -0.02], [0.62, 0, 0]], 0.035, 4, C.barkD); for (let i = 0; i < 5; i++) { const x = -0.5 + i * 0.25; T.ball(x, -0.02, 0, 0.11, 0.07, 0.09, i % 2 ? C.leaf : C.leafD, 5, 2); } }
      out.push(T.geo());
    }
    return out;
  });
}

// =====================================================================================
// FAUNA (all facing +Z)
// =====================================================================================
/** a body as rings across Z: stations [z, yCentre, halfWidth, halfHeight, xOffset], n sides with a ridge on top */
function hullZ(T, st, n, col, capA = true, capB = true) {
  const rings = st.map(([z, y, rx, ry, xo = 0]) => { const o = []; for (let j = 0; j < n; j++) { const a = PI / 2 + (j / n) * TAU; o.push([xo + Math.cos(a) * rx, y + Math.sin(a) * ry, z]); } return o; });
  return T.loft(rings, col, capA, capB);
}
const BOAR_FUR = [0x54402f, 0x8a5630, 0x3d3833];
function boarGeo(v) {
  return cached(`boar:${v}`, () => {
    const fur = BOAR_FUR[v], belly = mix(fur, 0xd0aa80, 0.5), dark = mul(fur, 0.55), T = new B(0.09), H = new B(0.08);
    const col = (x, y, z, nx, ny) => (ny < -0.45 ? belly : ny > 0.7 ? dark : fur);
    hullZ(T, [[-0.4, 0.33, 0.05, 0.06], [-0.32, 0.33, 0.15, 0.16], [-0.14, 0.33, 0.19, 0.19], [0.07, 0.36, 0.2, 0.22], [0.2, 0.35, 0.17, 0.18], [0.28, 0.33, 0.12, 0.13]], 7, col);
    for (const [sx, z] of [[1, 0.17], [-1, 0.17], [1, -0.28], [-1, -0.28]]) T.tube([[sx * 0.12, 0.26, z], [sx * 0.135, 0.1, z + 0.01], [sx * 0.135, 0, z + 0.02]], [0.07, 0.042, 0.04], 4, (x, y) => (y < 0.06 ? C.black : mul(fur, 0.85)));
    for (let i = 0; i < 6; i++) { const z = 0.26 - i * 0.095, y = 0.56 - Math.abs(z - 0.07) * 0.22; T.tri([0, y - 0.03, z + 0.06], [0, y - 0.03, z - 0.06], [0, y + 0.1, z - 0.03], C.black); T.tri([0.03, y - 0.04, z + 0.06], [-0.03, y - 0.04, z + 0.06], [0, y + 0.1, z - 0.03], dark); }
    T.tube([[0, 0.42, -0.38], [0, 0.4, -0.47], [0.02, 0.31, -0.5]], [0.022, 0.016, 0.012], 3, fur); T.ball(0.02, 0.28, -0.5, 0.025, 0.04, 0.025, C.black, 4, 2);
    // the head about the neck: a long wedge to a flat pink snout, ears, tusks
    hullZ(H, [[-0.05, 0.0, 0.12, 0.14], [0.07, -0.01, 0.118, 0.128], [0.18, -0.045, 0.078, 0.082], [0.27, -0.06, 0.06, 0.062]], 6, col, false, 0xdc9c8c);
    for (const sd of [-1, 1]) {
      H.tri([sd * 0.05, 0.1, 0.04], [sd * 0.115, 0.07, 0.0], [sd * 0.135, 0.21, -0.03], dark); H.tri([sd * 0.05, 0.1, 0.04], [sd * 0.09, 0.09, -0.04], [sd * 0.135, 0.21, -0.03], fur);
      H.tube([[sd * 0.055, -0.09, 0.17], [sd * 0.105, -0.085, 0.21], [sd * 0.13, -0.02, 0.215], [sd * 0.115, 0.04, 0.2]], [0.026, 0.024, 0.016, 0.003], 4, C.bone);
      H.tri([sd * 0.1, 0.045, 0.085], [sd * 0.105, 0.02, 0.105], [sd * 0.092, 0.05, 0.12], C.black);
    }
    return { body: T.geo(), head: H.geo() };
  });
}
function makeBoar(seed, p = [0, 0, 0], ry = 0, s0 = 1) {
  const s = seedOf(seed), R = rng(s * 17 + 3), G = boarGeo(s % 3);
  const g = group(part(mesh(G.body, 'animal'), 'body'), part(mesh(G.head, 'animal'), 'head', [0, 0.34, 0.27]));
  return anim(g, 'boar', { ph: R() * 40, rate: 0.8 + R() * 0.4, kind: 'boar', variant: s % 3 }, p, [0, ry, 0], s0 * 0.8 * (0.92 + R() * 0.16));
}
const MACAW = [
  { body: C.red, breast: C.red, wA: C.red, wB: C.yellow, wC: C.blue, tail: C.red, tail2: C.blue, beak: C.bone, cap: C.red },            // scarlet
  { body: 0x1f8fe0, breast: 0xf6c42a, wA: 0x1f8fe0, wB: 0x1a6fd0, wC: 0x1648a8, tail: 0x1f8fe0, tail2: 0xf6c42a, beak: C.black, cap: 0x3fb84a },   // blue and gold
  { body: 0x3fb83a, breast: 0x78d444, wA: 0x3fb83a, wB: 0x2a9ad8, wC: 0x1a5fc0, tail: 0xc8402a, tail2: 0x2a9ad8, beak: C.black, cap: C.red },      // great green
  { body: 0x2a44cc, breast: 0x2a44cc, wA: 0x2a44cc, wB: 0x2336a8, wC: 0x1c2a86, tail: 0x2a44cc, tail2: 0x2336a8, beak: C.black, cap: 0x2a44cc },   // hyacinth
];
function macawGeo(v) {
  return cached(`macaw:${v}`, () => {
    const P = MACAW[v], T = new B(0.06), H = new B(0.05), W = [new B(0.05), new B(0.05)];
    T.at([0, 0.14, -0.005], [0.35, 0, 0], 1, () => T.ball(0, 0, 0, 0.064, 0.108, 0.072, (x, y, z, nx, ny, nz) => (nz > 0.45 ? P.breast : P.body), 6, 3));
    for (const [dx, c, len] of [[0, P.tail, 0.36], [0.03, P.tail2, 0.3], [-0.03, P.tail2, 0.3]]) T.ribbon([[dx, 0.09, -0.06], [dx * 1.2, -0.08, -0.105], [dx * 1.3, 0.09 - len, -0.13]], (u) => 0.05 * (1 - u * 0.75), [1, 0, 0], c);
    for (const sd of [-1, 1]) T.ball(sd * 0.03, 0.012, 0.012, 0.018, 0.016, 0.03, 0x5a5a5a, 4, 2);
    H.ball(0, 0.045, 0.008, 0.056, 0.058, 0.06, (x, y, z, nx, ny, nz) => (Math.abs(nx) > 0.45 && nz > -0.25 && ny < 0.5 ? C.white : ny > 0.5 ? P.cap : P.body), 6, 3);
    H.tube([[0, 0.058, 0.05], [0, 0.056, 0.1], [0, 0.012, 0.125], [0, -0.03, 0.105]], [0.034, 0.032, 0.02, 0.003], 4, P.beak);
    H.tube([[0, 0.012, 0.045], [0, -0.012, 0.085]], [0.024, 0.008], 3, C.black);
    for (const sd of [-1, 1]) H.tri([sd * 0.052, 0.062, 0.035], [sd * 0.054, 0.04, 0.03], [sd * 0.05, 0.05, 0.052], C.black);
    W.forEach((w, i) => {
      const sd = i ? -1 : 1, s0 = [0, 0.012, 0.035], s1 = [0, 0.012, -0.03], f1 = [sd * 0.016, -0.075, 0.048], b1 = [sd * 0.016, -0.06, -0.055], f2 = [sd * 0.016, -0.16, 0.012], b2 = [sd * 0.016, -0.15, -0.085], tip = [sd * 0.012, -0.29, -0.1];
      w.quad(s0, f1, b1, s1, P.wA); w.quad(f1, f2, b2, b1, P.wB); w.tri(f2, tip, b2, P.wC);
    });
    return { body: T.geo(), head: H.geo(), wingL: W[0].geo(), wingR: W[1].geo() };
  });
}
function makeMacaw(seed, p = [0, 0, 0], ry = 0, s0 = 1) {
  const s = seedOf(seed), R = rng(s * 23 + 5), v = s % 4, G = macawGeo(v);
  const g = group(part(mesh(G.body, 'animal'), 'body'), part(mesh(G.head, 'animal'), 'head', [0, 0.235, 0.035]), part(mesh(G.wingL, 'animal'), 'wingL', [0.062, 0.2, 0]), part(mesh(G.wingR, 'animal'), 'wingR', [-0.062, 0.2, 0]));
  return anim(g, 'macaw', { ph: R() * 40, rate: 0.8 + R() * 0.4, kind: 'macaw', variant: v }, p, [0, ry, 0], s0 * (0.92 + R() * 0.16));
}
const MONKEY = [{ fur: 0x7a5232, face: 0xecd2a8, chest: 0xe2c898 }, { fur: 0xee962a, face: 0x4a3028, chest: 0xf6c050 }, { fur: 0x33291f, face: 0xa07a62, chest: 0x54402f }];
function monkeyGeo(v) {
  return cached(`monkey:${v}`, () => {
    const P = MONKEY[v], T = new B(0.08), H = new B(0.06), Tl = new B(0.08), A = [new B(0.07), new B(0.07)], dark = mul(P.fur, 0.6);
    T.at([0, 0.16, 0], [0.18, 0, 0], 1, () => T.ball(0, 0, 0, 0.088, 0.122, 0.082, (x, y, z, nx, ny, nz) => (nz > 0.5 && ny < 0.6 ? P.chest : P.fur), 6, 3));
    for (const sd of [-1, 1]) { T.tube([[sd * 0.06, 0.08, 0.02], [sd * 0.115, 0.155, 0.12], [sd * 0.1, 0.03, 0.15]], [0.048, 0.036, 0.028], 4, P.fur); T.ball(sd * 0.1, 0.018, 0.18, 0.03, 0.02, 0.048, dark, 4, 2); }
    Tl.tube([[0, 0, 0], [0, -0.03, -0.1], [0.02, 0.05, -0.22], [0.035, 0.2, -0.27], [0.03, 0.32, -0.21], [0.015, 0.31, -0.12], [0.005, 0.23, -0.13], [0, 0.22, -0.18]], (u) => 0.026 * (1 - u * 0.5), 4, (x, y, z, nx, ny, nz, i) => (i > 4 ? dark : P.fur));
    H.ball(0, 0.075, 0.005, 0.078, 0.072, 0.072, (x, y, z, nx, ny, nz) => (nz > 0.5 && ny < 0.55 ? P.face : P.fur), 6, 3);
    H.ball(0, 0.05, 0.062, 0.042, 0.034, 0.032, mix(P.face, 0x000000, 0.12), 5, 2);
    for (const sd of [-1, 1]) { H.ball(sd * 0.078, 0.085, -0.005, 0.014, 0.028, 0.024, P.face, 4, 2); H.tri([sd * 0.02, 0.1, 0.07], [sd * 0.045, 0.1, 0.064], [sd * 0.032, 0.078, 0.071], C.black); }
    H.tri([-0.03, 0.13, 0.05], [0.03, 0.13, 0.05], [0, 0.165, 0.02], dark);
    A.forEach((a, i) => { const sd = i ? -1 : 1; a.tube([[0, 0, 0], [sd * 0.025, -0.1, 0.04], [sd * 0.0, -0.13, 0.13]], [0.034, 0.028, 0.024], 4, P.fur); a.ball(0, -0.132, 0.15, 0.022, 0.018, 0.03, dark, 4, 2); });
    return { body: T.geo(), head: H.geo(), tail: Tl.geo(), armL: A[0].geo(), armR: A[1].geo() };
  });
}
function makeMonkey(seed, p = [0, 0, 0], ry = 0, s0 = 1) {
  const s = seedOf(seed), R = rng(s * 29 + 7), v = s % 3, reach = (s >> 1) % 2, G = monkeyGeo(v);
  const g = group(part(mesh(G.body, 'animal'), 'body'), part(mesh(G.head, 'animal'), 'head', [0, 0.27, 0.012]), part(mesh(G.tail, 'animal'), 'tail', [0, 0.05, -0.07]),
    part(mesh(G.armL, 'animal'), 'armL', [0.092, 0.24, 0.02]), part(mesh(G.armR, 'animal'), 'armR', [-0.092, 0.24, 0.02]));
  return anim(g, 'monkey', { ph: R() * 40, rate: 0.8 + R() * 0.4, reach, kind: 'monkey', variant: v }, p, [0, ry, 0], s0 * (0.92 + R() * 0.16));
}
function crocGeo(v) {
  return cached(`croc:${v}`, () => {
    const g1 = [0x7a9a2a, 0x5f8a3a, 0x8a8430][v], g2 = mul(g1, 0.5), belly = 0xdcd28a, pink = 0xeeb0a2, T = new B(0.08), J = new B(0.07), Tl = new B(0.08);
    const col = (x, y, z, nx, ny) => (ny < -0.25 ? belly : Math.floor((z + 3) * 6.5) % 2 ? g1 : g2);
    hullZ(T, [[-0.38, -0.025, 0.17, 0.115], [-0.2, -0.02, 0.27, 0.14], [0.1, -0.02, 0.29, 0.145], [0.35, -0.03, 0.22, 0.115], [0.5, -0.035, 0.15, 0.09]], 8, col, false, false);
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 8; i++) { const z = -0.36 + i * 0.11, x = sd * 0.1, top = 0.085 + 0.03 * Math.sin(((z + 0.38) / 0.9) * PI); T.tri([x - sd * 0.02, top, z - 0.045], [x + sd * 0.02, top - 0.01, z + 0.05], [x * 1.25, top + 0.06, z - 0.02], 0xa9bc4a); }
      for (const z of [0.3, -0.28]) T.tube([[sd * 0.2, -0.05, z], [sd * 0.4, -0.02, z + 0.05], [sd * 0.5, -0.08, z + 0.17]], [0.07, 0.055, 0.035], 4, col);
    }
    // the lower jaw lies still in the water; its teeth show when the mouth opens
    hullZ(T, [[0.48, -0.075, 0.14, 0.035], [0.75, -0.075, 0.095, 0.028], [0.99, -0.07, 0.065, 0.022]], 6, (x, y, z, nx, ny) => (ny > 0.4 ? pink : belly), false, true);
    for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) { const z = 0.56 + i * 0.09, x = sd * lerp(0.125, 0.065, i / 4.5); T.tri([x, -0.05, z - 0.02], [x, -0.05, z + 0.02], [x, -0.012, z], C.white); }
    // the skull and upper jaw, hinged at the back of the head
    hullZ(J, [[-0.02, 0.03, 0.155, 0.08], [0.11, 0.045, 0.155, 0.078], [0.24, 0.04, 0.1, 0.05], [0.4, 0.035, 0.075, 0.042], [0.5, 0.042, 0.082, 0.046]], 6, (x, y, z, nx, ny) => (ny < -0.4 ? pink : z > 0.2 ? mix(g1, 0xb8c060, 0.25) : g1), false, true);
    for (const sd of [-1, 1]) {
      J.ball(sd * 0.095, 0.115, 0.11, 0.045, 0.045, 0.055, (x, y, z, nx) => (nx * sd > 0.3 ? 0xf0d83a : g2), 5, 2);
      J.tri([sd * 0.142, 0.13, 0.1], [sd * 0.142, 0.1, 0.11], [sd * 0.142, 0.115, 0.13], C.black);
      for (let i = 0; i < 5; i++) { const z = 0.2 + i * 0.065, x = sd * lerp(0.105, 0.072, i / 4); J.tri([x, -0.005, z - 0.02], [x, -0.005, z + 0.02], [x, -0.05, z], C.white); }
      J.ball(sd * 0.03, 0.085, 0.47, 0.02, 0.018, 0.024, g2, 4, 2);
    }
    // the tail, with a saw of scutes down it
    const ts = [[0, 0, 0.17, 0.115, 0], [-0.25, -0.01, 0.115, 0.1, 0.03], [-0.5, -0.02, 0.07, 0.09, 0.1], [-0.72, -0.03, 0.04, 0.07, 0.2], [-0.86, -0.03, 0.006, 0.02, 0.28]];
    hullZ(Tl, ts, 6, col, false, false);
    for (let i = 0; i < 8; i++) { const u = (i + 0.5) / 8, k = Math.min(3, Math.floor(u * 4)), f = u * 4 - k, z = lerp(ts[k][0], ts[k + 1][0], f), x = lerp(ts[k][4], ts[k + 1][4], f), top = lerp(ts[k][1] + ts[k][3], ts[k + 1][1] + ts[k + 1][3], f); Tl.tri([x, top - 0.01, z + 0.05], [x, top - 0.01, z - 0.05], [x, top + 0.06 - u * 0.02, z - 0.03], 0xa9bc4a); }
    return { body: T.geo(), jaw: J.geo(), tail: Tl.geo() };
  });
}
const FROG = {
  tree: [{ body: 0x58d03a, side: 0x2a6fd9, belly: 0xf2eec8, toe: 0xf28a1e, eye: 0xe6281e, leg: 0x58d03a, leaf: 0x1f7a3a, leafC: 0x2f9a4a },
    { body: 0xa6dc3a, side: 0xf28a1e, belly: 0xf6f0c0, toe: 0xf28a1e, eye: 0xe6281e, leg: 0xa6dc3a, leaf: 0x1f7a3a, leafC: 0x2f9a4a },
    { body: 0x2fbf8c, side: 0x8b3a9c, belly: 0xf2eec8, toe: 0xf6ca32, eye: 0xe6281e, leg: 0x2fbf8c, leaf: 0x3f8a2a, leafC: 0x5aa832 }],
  dart: [{ body: 0x1f7af0, side: 0x1f7af0, belly: 0x1a3fa8, toe: 0x1a3fa8, eye: C.black, leg: 0x1a3fa8, spot: C.black, leaf: 0x86c84a, leafC: 0xb4e060 },
    { body: 0xf8d42a, side: 0xf8d42a, belly: C.black, toe: C.black, eye: C.black, leg: C.black, spot: C.black, leaf: 0x2f9a4a, leafC: 0x49b85a },
    { body: 0xf03a26, side: 0xf03a26, belly: 0xf03a26, toe: 0x2a4fc8, eye: C.black, leg: 0x2a4fc8, spot: 0x7a1a12, leaf: 0x86c84a, leafC: 0xb4e060 }],
};
function frogGeo(kind, v) {
  return cached(`frog:${kind}:${v}`, () => {
    const P = FROG[kind][v], tree = kind === 'tree', k = tree ? 1 : 0.82, T = new B(0.05), Th = new B(0.04), L = new B(0.07);
    const col = (x, y, z, nx, ny) => (ny < -0.45 ? P.belly : P.spot !== undefined && hash(Math.floor(x * 38) * 7 + Math.floor(z * 38) * 13 + v) > 0.62 ? P.spot : Math.abs(nx) > 0.72 && ny < 0.45 ? P.side : P.body);
    T.at([0, 0, 0], [-0.22, 0, 0], k, () => {
      hullZ(T, tree ? [[-0.12, 0.04, 0.03, 0.025], [-0.07, 0.058, 0.078, 0.05], [0.0, 0.074, 0.092, 0.062], [0.075, 0.078, 0.088, 0.05], [0.13, 0.07, 0.05, 0.03]] : [[-0.12, 0.04, 0.025, 0.022], [-0.07, 0.055, 0.058, 0.042], [0.0, 0.066, 0.068, 0.05], [0.075, 0.066, 0.062, 0.04], [0.135, 0.06, 0.036, 0.024]], 6, col);
      if (tree) for (const sd of [-1, 1]) { T.ball(sd * 0.06, 0.128, 0.078, 0.036, 0.036, 0.036, P.eye, 5, 3); T.quad([sd * 0.052, 0.15, 0.112], [sd * 0.068, 0.15, 0.112], [sd * 0.068, 0.108, 0.114], [sd * 0.052, 0.108, 0.114], C.black); T.tri([sd * 0.1, 0.07, 0.1], [sd * 0.1, 0.07, -0.06], [sd * 0.108, 0.045, 0.02], 0xf6e04a); }
      else for (const sd of [-1, 1]) T.ball(sd * 0.042, 0.095, 0.085, 0.02, 0.02, 0.022, C.black, 4, 2);
    });
    for (const sd of [-1, 1]) {
      T.tube([[sd * 0.055 * k, 0.045, -0.075 * k], [sd * 0.135 * k, 0.085 * k, -0.01], [sd * 0.105 * k, 0.018, -0.105 * k], [sd * 0.165 * k, 0.008, -0.03 * k]], [0.03 * k, 0.026 * k, 0.018 * k, 0.014 * k], 3, P.leg);
      T.fan([sd * 0.16 * k, 0.008, -0.035 * k], [[sd * 0.2 * k, 0.004, -0.06 * k], [sd * 0.215 * k, 0.004, -0.02 * k], [sd * 0.2 * k, 0.004, 0.015 * k]], P.toe, P.toe, false);
      T.tube([[sd * 0.06 * k, 0.075 * k, 0.07 * k], [sd * 0.105 * k, 0.04, 0.085 * k], [sd * 0.095 * k, 0.008, 0.13 * k]], [0.022 * k, 0.018 * k, 0.014 * k], 3, P.leg);
      T.fan([sd * 0.095 * k, 0.008, 0.125 * k], [[sd * 0.075 * k, 0.004, 0.165 * k], [sd * 0.105 * k, 0.004, 0.172 * k], [sd * 0.135 * k, 0.004, 0.155 * k]], P.toe, P.toe, false);
    }
    Th.ball(0, 0, 0, 0.04 * k, 0.03 * k, 0.036 * k, tree ? P.belly : mix(P.body, 0xffffff, 0.25), 5, 2);
    // the leaf it sits on
    const rim = [], n = 9, rr = tree ? 0.3 : 0.24;
    for (let j = 0; j < n; j++) { const a = (j / n) * TAU, r = rr * (j === 0 ? 1.3 : j === 4 || j === 5 ? 0.82 : 1); rim.push([Math.sin(a) * r * 0.82, 0.02 + (j % 2) * 0.025, Math.cos(a) * r - 0.02]); }
    L.fan([0, 0.012, 0], rim, P.leaf, P.leafC);
    L.tube([[0, 0.012, -rr * 0.6], [0.03, 0.01, -rr - 0.1]], 0.014, 3, P.leafC);
    return { body: T.geo(), throat: Th.geo(), leaf: L.geo(), k };
  });
}
function makeFrog(kind, seed) {
  const s = seedOf(seed), R = rng(s * 31 + 9), v = s % FROG[kind].length, G = frogGeo(kind, v);
  const frog = anim(group(part(mesh(G.body, 'animal'), 'body'), part(mesh(G.throat, 'animal'), 'throat', [0, 0.05 * G.k, 0.105 * G.k])), 'frog', { ph: R() * 40, rate: 0.8 + R() * 0.5 }, [0, 0.026, 0], [0, (R() - 0.5) * 1.2, 0], 0.94 + R() * 0.12);
  return rootOf(kind === 'tree' ? 'treeFrog' : 'dartFrog', v, [mesh(G.leaf), frog]);
}
const SNAKE = [(i) => (i % 4 === 0 ? 0xf2f0d0 : 0x2fc24a), (i) => (i % 3 === 0 ? 0x6a4a1a : 0xf4d22a), (i) => [C.red, C.black, 0xf6d232, C.black][i % 4]];
function snakeGeo(v) {
  return cached(`snake:${v}`, () => {
    const T = new B(0.07), S = new B(0.05), H = new B(0.05), band = SNAKE[v], R = rng(v * 7 + 77);
    T.cyl(0, 0, 0, 0.14, 0.11, 0.6, 6, mossy(v), 0); T.cyl(0, 0.6, 0, 0.11, 0.1, 0.58, 6, mossy(v + 2), 2, 0.3, C.woodL);
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; T.tri([Math.cos(a) * 0.1, 1.18, Math.sin(a) * 0.1], [Math.cos(a + 1) * 0.1, 1.18, Math.sin(a + 1) * 0.1], [Math.cos(a + 0.5) * 0.09, 1.3 + R() * 0.08, Math.sin(a + 0.5) * 0.09], C.barkL); }
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.5; T.tube([[Math.cos(a) * 0.12, 0.12, Math.sin(a) * 0.12], [Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24]], [0.05, 0.03], 3, C.barkD); }
    const turns = 3.1, n = 24, pts = [];
    for (let i = 0; i <= n; i++) { const u = i / n, a = PI / 2 - (1 - u) * turns * TAU, r = 0.175 + (u < 0.1 ? (0.1 - u) * 1.2 : 0); pts.push([Math.cos(a) * r, 0.05 + u * 1.02, Math.sin(a) * r]); }
    S.tube(pts, (u) => (u < 0.2 ? lerp(0.012, 0.058, u / 0.2) : 0.058), 4, (x, y, z, nx, ny, nz, i) => band(i), { rot: PI / 4 });
    // neck and head, about the top of the coils
    const neck = [[0, 0, 0], [0.02, 0.1, 0.03], [0, 0.24, -0.03], [0, 0.36, 0.0], [0, 0.42, 0.08]];
    H.tube(neck, [0.058, 0.055, 0.05, 0.046, 0.044], 4, (x, y, z, nx, ny, nz, i) => band(i + 1), { rot: PI / 4 });
    hullZ(H, [[0.05, 0.425, 0.045, 0.036], [0.13, 0.425, 0.072, 0.042], [0.23, 0.415, 0.05, 0.03], [0.29, 0.41, 0.022, 0.016]], 6, (x, y, z, nx, ny) => (ny < -0.5 ? 0xf2f0d0 : band(1)), true, true);
    for (const sd of [-1, 1]) { H.tri([sd * 0.062, 0.45, 0.13], [sd * 0.05, 0.445, 0.19], [sd * 0.068, 0.425, 0.16], 0xf8e23a); H.tri([0, 0.405, 0.28], [sd * 0.006, 0.405, 0.34], [sd * 0.03, 0.4, 0.4], C.red); }
    return { post: T.geo(), coil: S.geo(), head: H.geo(), top: pts[n] };
  });
}
function spiderGeo(v) {
  return cached(`spider:${v}`, () => {
    const W = new B(0.05), S = new B(0.06), hub = [0, 0.55, 0], silk = 0xeef4f2, c1 = [C.yellow, C.orange, 0xd8e23a][v], c2 = C.black, th = 0x7a2a1a;
    const stake = (sd) => [[sd * 0.47, -0.3, 0.0], [sd * 0.44, 0.4, 0.01], [sd * 0.47, 0.8, -0.01], [sd * 0.43, 1.12, 0]];
    for (const sd of [-1, 1]) { W.tube(stake(sd), [0.04, 0.035, 0.03, 0.022], 4, (x, y, z, nx, ny, nz, i) => (i % 2 ? C.wood : C.woodD), { cap: 2 }); W.tube([[sd * 0.45, 0.62, 0], [sd * 0.56, 0.8, -0.03]], [0.02, 0.008], 3, C.woodD); }
    const anchors = [[-0.44, 1.05], [0, 1.02], [0.44, 1.05], [0.455, 0.6], [0.45, 0.18], [0, 0.14], [-0.45, 0.18], [-0.455, 0.6]].map(([x, y]) => [x, y, 0]);
    const thread = (a, b, w = 0.016) => { const d = norm(sub(b, a)); W.quad(add(a, [-d[1] * w, d[0] * w, 0]), add(a, [d[1] * w, -d[0] * w, 0]), add(b, [d[1] * w, -d[0] * w, 0]), add(b, [-d[1] * w, d[0] * w, 0]), silk); };
    W.jit = 0.02;
    anchors.forEach((a, i) => { thread(hub, a); const b = anchors[(i + 1) % 8]; if (i === 0 || i === 1 || i === 4 || i === 5) thread(a, b); for (const f of [0.28, 0.52, 0.78]) thread(lerp3(hub, a, f), lerp3(hub, b, f * (0.94 + 0.1 * ((i + 1) % 2))), 0.011); });
    // the spider, about the hub of the web: head down, abdomen up
    S.ball(0, 0.13, 0.06, 0.105, 0.15, 0.09, (x, y) => (Math.floor(y * 26) % 2 ? c1 : c2), 6, 4);
    S.ball(0, -0.04, 0.05, 0.062, 0.07, 0.05, th, 5, 2);
    for (const sd of [-1, 1]) { [[-1.25, 0.38], [-0.5, 0.31], [0.35, 0.3], [1.05, 0.38]].forEach(([a, L], i) => { const c = Math.cos(a) * sd, s = Math.sin(a); S.tube([[sd * 0.035, -0.04 + i * 0.01, 0.05], [c * L * 0.5, -0.04 + s * L * 0.5, 0.15], [c * L, -0.04 + s * L, 0.01]], [0.02, 0.016, 0.007], 3, (x, y, z, nx, ny, nz, k) => (k ? c1 : c2)); }); S.tri([sd * 0.012, -0.1, 0.07], [sd * 0.035, -0.1, 0.06], [sd * 0.018, -0.15, 0.075], C.red); }
    return { web: W.geo(), spider: S.geo(), hub };
  });
}

// =====================================================================================
// THE PIECES: plants and animals
// =====================================================================================
export const scenery = {};
const sway = (o, p, d) => anim(o, 'sway', d, p);

/** coconut palm, 3.6-4.4 to the top of the trunk and about 5 with its fronds. Four shapes. The crown sways. */
scenery.coconutPalm = (seed) => {
  const s = seedOf(seed), v = s % 4, R = rng(s * 13 + 1), G = palmGeo(v);
  return rootOf('coconutPalm', v, [turned(R, [mesh(G.trunk), sway(mesh(G.crown), G.top, { ax: 0.05, az: 0.05, ay: 0.05, rate: 0.8 + R() * 0.3, ph: R() * 40 })])], { height: G.H + 0.8 });
};
scenery.bananaTree = (seed) => {
  const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 2), G = bananaGeo(v);
  return rootOf('bananaTree', v, [turned(R, [mesh(G.stem), sway(mesh(G.leaves), G.top, { ax: 0.045, az: 0.045, ay: 0.06, rate: 1 + R() * 0.3, ph: R() * 40 })])]);
};
scenery.banyan = (seed) => {
  const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 3), G = banyanGeo(v);
  return rootOf('banyan', v, [turned(R, [mesh(G.tree), sway(mesh(G.vines), [0, 2.5, 0], { ax: 0.03, az: 0.03, ay: 0.02, rate: 0.9, ph: R() * 40 })], 0.06)]);
};
scenery.mangrove = (seed) => { const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 4), g = turned(R, [mesh(mangroveGeo(v))], 0.06); g.scale.multiplyScalar(0.85); return rootOf('mangrove', v, [g]); };
scenery.fernClump = (seed) => { const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 5); return rootOf('fernClump', v, [turned(R, [mesh(fernGeo(v))], 0.15)]); };
scenery.elephantEar = (seed) => { const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 6); return rootOf('elephantEar', v, [turned(R, [mesh(earGeo(v))], 0.15)]); };
scenery.bromeliad = (seed) => { const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 7); return rootOf('bromeliad', v, [turned(R, [mesh(bromeliadGeo(v))], 0.12)]); };
scenery.bambooThicket = (seed) => { const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 8); return rootOf('bambooThicket', v, [turned(R, [mesh(bambooGeo(v))])]); };
/** a mossy log lying along X */
scenery.mossLog = (seed) => { const s = seedOf(seed), v = s % 3; return rootOf('mossLog', v, [mesh(logGeo(v))]); };
/** a curtain of vines 1.2 wide along X hanging down from the origin; two layers swing about the top edge */
scenery.vineCurtain = (seed) => {
  const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 10), G = vineGeo(v), ph = R() * 40;
  return rootOf('vineCurtain', v, [anim(mesh(G[0]), 'sway', { ax: 0.07, az: 0.015, ay: 0, rate: 1.1, ph }), anim(mesh(G[1]), 'sway', { ax: 0.09, az: 0.02, ay: 0, rate: 0.9, ph: ph + 1.3 })]);
};

scenery.boar = (seed) => { const b = makeBoar(seed); return rootOf('boar', b.userData.jg.variant, [b]); };
/** a macaw on a forked perch stick (the bird's feet are 0.39 up). Four colourings. */
function perchGeo() {
  return cached('perch', () => { const T = new B(0.08); T.tube([[0.03, 0, 0], [-0.02, 0.2, 0.01], [0, 0.34, 0]], [0.035, 0.03, 0.028], 4, C.driftD); T.tube([[-0.17, 0.35, 0.0], [0, 0.372, 0], [0.16, 0.36, 0.01]], [0.02, 0.026, 0.018], 4, C.drift, { cap: 3 }); T.tube([[0, 0.3, 0], [0.1, 0.46, -0.04]], [0.022, 0.01], 3, C.driftD); return T.geo(); });
}
scenery.macaw = (seed) => { const m = makeMacaw(seed, [0, 0.39, 0]); return rootOf('macaw', m.userData.jg.variant, [mesh(perchGeo()), m], { perch: 0.39 }); };
scenery.monkey = (seed) => { const m = makeMonkey(seed); return rootOf('monkey', m.userData.jg.variant, [m], { reaching: !!m.userData.jg.reach }); };
/** a crocodile lying in the water (y = 0 is the surface) */
scenery.crocodile = (seed) => {
  const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 14), G = crocGeo(v);
  const g = group(part(mesh(G.body, 'animal'), 'body'), part(mesh(G.jaw, 'animal'), 'jaw', [0, -0.03, 0.5]), part(mesh(G.tail, 'animal'), 'tail', [0, 0, -0.38]));
  return rootOf('crocodile', v, [anim(g, 'croc', { ph: R() * 40, rate: 0.8 + R() * 0.4 }, [0, 0, 0], [0, 0, 0], 0.95 + R() * 0.12)]);
};
scenery.treeFrog = (seed) => makeFrog('tree', seed);
scenery.dartFrog = (seed) => makeFrog('dart', seed);
/** a snake wound up a mossy post, its head reared off the top and swaying */
scenery.treeSnake = (seed) => {
  const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 17), G = snakeGeo(v);
  return rootOf('treeSnake', v, [mesh(G.post), mesh(G.coil, 'animal'), anim(mesh(G.head, 'animal'), 'snake', { ph: R() * 40, rate: 0.8 + R() * 0.4 }, G.top)]);
};
/** a spider at the hub of a web strung between two stakes 0.9 apart along X; the web leans back so it shows from above */
scenery.giantSpider = (seed) => {
  const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 18), G = spiderGeo(v);
  const tilt = group(mesh(G.web), anim(mesh(G.spider, 'animal'), 'spider', { ph: R() * 40, rate: 0.8 + R() * 0.4 }, [G.hub[0], G.hub[1], 0.02]));
  tilt.rotation.x = -0.6; tilt.position.set(0, 0, 0.3);
  return rootOf('giantSpider', v, [tilt]);
};


// =====================================================================================
// THE VILLAGE: shared bits
// =====================================================================================
const THATCH = [C.thatch, C.thatchL, C.thatchD, C.thatchL, C.thatchO], LEAFROOF = [0x3f9a2e, 0x2f8a2a, 0x58a832, 0x7a9a3a, 0x8a8a3a];
const pick = (R, a) => a[Math.floor(R() * a.length) % a.length];
const woodC = (a = C.wood, b = C.woodD) => (x, y, z, nx, ny, nz, i, j) => ((i + j) % 2 ? a : b);
/** a thatched roof face from the eave edge a->b up to the ridge edge d->c, in shaggy courses; bulge arches it */
function thatch(T, R, a, b, c, d, rows, cols, o = {}) {
  const t0 = o.t0 || 0, bulge = o.bulge || 0, pal = o.pal || THATCH, jag = o.jag === undefined ? 0.5 : o.jag;
  let nrm = norm(cross(sub(b, a), sub(d, a))); if (nrm[1] < 0) nrm = sc3(nrm, -1);
  const pt = (u, t) => add(lerp3(lerp3(a, b, u), lerp3(d, c, u), t), sc3(nrm, bulge * Math.sin(PI * clamp(t, 0, 1) * 0.92)));
  for (let r = 0; r < rows; r++) {
    const tA = lerp(t0, 1, r / rows), tB = lerp(t0, 1, (r + 1) / rows), dt = (1 - t0) / rows;
    let jp = R();
    for (let q = 0; q < cols; q++) {
      const jn = R(), u0 = q / cols, u1 = (q + 1) / cols, lift = r ? 0.05 : 0.02;
      const cq = mix(pal[r % 2], pick(R, pal), 0.45), dk = mul(cq, 0.55);
      T.quad(add(pt(u0, tA - jp * jag * dt), sc3(nrm, lift)), add(pt(u1, tA - jn * jag * dt), sc3(nrm, lift)), pt(u1, tB), pt(u0, tB), cq, cq, dk, dk);
      jp = jn;
    }
  }
}
/** a shaggy cone of thatch in tiers, base radius r at y0, h high, about (x, z) */
function thatchCone(T, R, x, y0, z, r, h, tiers, n, pal = THATCH) {
  for (let k = 0; k < tiers; k++) {
    const u0 = k / tiers, u1 = (k + 1) / tiers, rb = r * (1 - u0) + 0.07, rt = r * (1 - u1) * 0.96, yb = y0 + h * u0 - (k ? 0.1 : 0), yt = y0 + h * u1;
    let jp = R(); const j0 = jp;
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * TAU + k * 0.3, a1 = ((j + 1) / n) * TAU + k * 0.3, jn = j === n - 1 ? j0 : R();
      const p0 = [x + Math.cos(a0) * rb * (1 + jp * 0.08), yb - jp * 0.12, z + Math.sin(a0) * rb * (1 + jp * 0.08)], p1 = [x + Math.cos(a1) * rb * (1 + jn * 0.08), yb - jn * 0.12, z + Math.sin(a1) * rb * (1 + jn * 0.08)];
      const cq = mix(pal[k % 2], pick(R, pal), 0.45), dk = mul(cq, 0.55);
      if (rt < 0.02) T.tri(p0, p1, [x, yt, z], cq, cq, dk); else T.quad(p0, p1, [x + Math.cos(a1) * rt, yt, z + Math.sin(a1) * rt], [x + Math.cos(a0) * rt, yt, z + Math.sin(a0) * rt], cq, cq, dk, dk);
      jp = jn;
    }
  }
}
/** a rope or cane lashing round a pole at p */
const lash = (T, p, r, col = C.rope) => T.cyl(p[0], p[1] - 0.035, p[2], r * 1.3, r * 1.3, 0.07, 4, col, 0, 0.6);
/** a ladder from a to b, w wide across side */
function ladder(T, a, b, w, rungs, side = [1, 0, 0], col = C.wood, r = 0.03) {
  const h = sc3(side, w / 2);
  for (const k of [-1, 1]) T.beam(add(a, sc3(h, k)), add(b, sc3(h, k)), r, col, 4);
  for (let i = 0; i < rungs; i++) { const p = lerp3(a, b, (i + 0.7) / (rungs + 0.4)); T.beam(add(p, sc3(h, -1.1)), add(p, sc3(h, 1.1)), r * 0.8, C.woodL, 3); }
}
/** a horned animal skull, painted; about 0.3 across the horns at s = 1, facing +Z */
function skull(T, paint = C.red) {
  T.ball(0, 0.02, 0, 0.07, 0.065, 0.07, C.bone, 5, 2);
  T.box(0, -0.06, 0.07, 0.07, 0.07, 0.13, C.boneD, 0, 2, 0.7);
  for (const sd of [-1, 1]) { T.tube([[sd * 0.05, 0.04, 0], [sd * 0.13, 0.06, 0.01], [sd * 0.17, 0.15, 0.03]], [0.025, 0.02, 0.004], 3, C.boneD); T.tri([sd * 0.02, 0.03, 0.068], [sd * 0.055, 0.035, 0.05], [sd * 0.035, -0.005, 0.066], C.black); }
  T.tri([-0.02, 0.085, 0.03], [0.02, 0.085, 0.03], [0, 0.04, 0.072], paint);
}
/** a carved wooden mask about 0.3 high, facing +Z, standing on y = 0 */
function mask(T, v = 0) {
  const base = [C.red, C.teal, C.white, C.yellow][v % 4], trim = [C.white, C.yellow, C.red, C.black][v % 4], rim = [[0, 0], [0.09, 0.03], [0.12, 0.14], [0.1, 0.25], [0, 0.31], [-0.1, 0.25], [-0.12, 0.14], [-0.09, 0.03]].map(([x, y]) => [x, y, 0]);
  T.fan([0, 0.15, 0.05], rim, base, mix(base, 0xffffff, 0.15));
  for (const sd of [-1, 1]) { T.tri([sd * 0.025, 0.2, 0.05], [sd * 0.085, 0.215, 0.03], [sd * 0.055, 0.165, 0.045], C.black); T.tri([sd * 0.03, 0.24, 0.05], [sd * 0.1, 0.27, 0.02], [sd * 0.09, 0.235, 0.03], trim); }
  T.quad([-0.045, 0.09, 0.05], [0.045, 0.09, 0.05], [0.035, 0.05, 0.04], [-0.035, 0.05, 0.04], C.black); T.tri([-0.03, 0.09, 0.055], [0.03, 0.09, 0.055], [0, 0.065, 0.055], C.white);
  T.tri([0, 0.2, 0.055], [0.022, 0.11, 0.05], [-0.022, 0.11, 0.05], trim);
  for (let i = -1; i <= 1; i++) T.tri([i * 0.05 - 0.02, 0.29, 0], [i * 0.05 + 0.02, 0.29, 0], [i * 0.085, 0.42 - Math.abs(i) * 0.03, -0.02], [C.orange, C.teal, C.pink][i + 1]);
}
function gourd(T, col = 0xd8a43a) { T.lathe(0, 0, 0, [[0, 0], [0.06, 0.03], [0.07, 0.09], [0.03, 0.15], [0.036, 0.2], [0, 0.23]], 5, col); }
/** a clay pot r wide, h high; fill = colour of what is in it */
function pot(T, r, h, col = C.clay, fill = 0x2a1c16, n = 6) {
  T.lathe(0, 0, 0, [[r * 0.6, 0], [r, h * 0.4], [r * 0.88, h * 0.78], [r * 0.56, h * 0.9], [r * 0.68, h]], n, (x, y) => (y > h * 0.55 && y < h * 0.72 ? mix(col, 0xffffff, 0.45) : col));
  T.cyl(0, h * 0.93, 0, 0.001, r * 0.6, 0.001, n, fill, 0);
}
/** an oval hide shield 0.62 high, face +Z, standing on y = 0 */
function shield(T, v = 0) {
  const c1 = [C.hideL, C.red, C.white, C.hide, C.teal][v % 5], c2 = [C.red, C.white, C.black, C.yellow, C.white][v % 5], rim = [];
  for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU; rim.push([Math.sin(a) * 0.2, 0.31 + Math.cos(a) * 0.31, 0]); }
  T.fan([0, 0.31, 0.07], rim, c1, c2);
  T.quad([-0.035, 0.08, 0.04], [0.035, 0.08, 0.04], [0.035, 0.54, 0.04], [-0.035, 0.54, 0.04], C.black);
  T.ball(0, 0.31, 0.075, 0.045, 0.045, 0.03, C.bone, 4, 2);
}
/** a leaf-bladed spear standing on y = 0, len long */
function spear(T, len = 1.5, col = C.wood) {
  T.beam([0, 0, 0], [0, len - 0.2, 0], 0.022, col, 3);
  T.quad([0, len - 0.22, 0], [0.05, len - 0.12, 0], [0, len, 0], [-0.05, len - 0.12, 0], C.stone); T.quad([0, len - 0.22, 0], [0, len - 0.12, 0.05], [0, len, 0], [0, len - 0.12, -0.05], C.stoneD);
  T.tri([0, len - 0.24, 0], [0.07, len - 0.34, 0.02], [0.02, len - 0.38, 0], C.red);
}
/** a war drum: a hollowed log with a hide head, r wide and h high */
function drum(T, r, h) {
  T.lathe(0, 0, 0, [[r * 0.8, 0], [r * 1.05, h * 0.5], [r, h]], 8, (x, y, z, nx, ny, nz, i, j) => (i === 1 && j % 2 ? C.red : j % 2 ? C.wood : C.woodD));
  T.cyl(0, h, 0, r * 1.02, r * 1.02, 0.03, 8, C.rope, 2, 0, C.hideL);
  for (let j = 0; j < 8; j += 2) { const a = (j / 8) * TAU + 0.39; T.tri([Math.cos(a) * r * 1.07, h, -Math.sin(a) * r * 1.07], [Math.cos(a + 0.4) * r * 1.09, h * 0.55, -Math.sin(a + 0.4) * r * 1.09], [Math.cos(a - 0.4) * r * 1.09, h * 0.55, -Math.sin(a - 0.4) * r * 1.09], C.white); }
}
/** a low heap of n round things of radius r */
function heap(T, R, n, r, cols, spread = 1) {
  for (let i = 0; i < n; i++) { const lvl = i < n * 0.6 ? 0 : 1, a = R() * TAU, d = Math.sqrt(R()) * r * 2.4 * spread * (lvl ? 0.4 : 1); T.ball(Math.cos(a) * d, r * 0.9 + lvl * r * 1.3, Math.sin(a) * d, r, r * 0.92, r, pick(R, cols), 4, 2); }
}
/** a woven basket r wide, filled with fruit */
function basket(T, R, r, h, cols, n = 6) {
  T.lathe(0, 0, 0, [[r * 0.7, 0], [r, h], [r * 0.86, h * 0.86]], 7, (x, y, z, nx, ny, nz, i, j) => (j % 2 ? C.mat : C.thatchD));
  T.at([0, h * 0.75, 0], [0, 0, 0], 1, () => heap(T, R, n, r * 0.34, cols, 0.75));
}
function crate(T, w, h, d, ry = 0) { T.box(0, 0, 0, w, h, d, woodC(C.woodL, C.wood), ry); T.box(0, h * 0.42, 0, w * 1.04, h * 0.16, d * 1.04, C.woodD, ry, 0); }
function rock(T, R, r, col = C.stone) { T.ball(0, r * 0.5, 0, r, r * 0.7, r * 0.9, (x, y, z, nx, ny) => (ny > 0.4 ? mix(col, 0xffffff, 0.15) : col), 5, 2, 0.25, R); }
/** a coil of rope lying flat */
function coil(T, r) { for (let i = 0; i < 3; i++) T.lathe(0, i * r * 0.28, 0, [[r * 0.55, 0], [r, r * 0.14], [r * 0.55, r * 0.28]], 6, i % 2 ? C.rope : mul(C.rope, 0.82)); }
/** a bone lying along X, len long */
function bone(T, len, r = 0.025) { T.beam([-len / 2, r, 0], [len / 2, r, 0], r, C.bone, 4); for (const sd of [-1, 1]) T.ball(sd * len / 2, r, 0, r * 1.7, r * 1.5, r * 2.2, C.boneD, 4, 2); }
/** a fish 0.3 long hanging head-down from y = 0 */
function fish(T, col = 0xc8ccd0) { T.quad([0, 0, 0], [0.05, -0.1, 0], [0, -0.3, 0], [-0.05, -0.1, 0], col, mix(col, C.orange, 0.3), col, mix(col, 0x445566, 0.4)); T.tri([0, 0.0, 0], [0.045, 0.06, 0], [-0.045, 0.06, 0], mix(col, 0x445566, 0.3)); }
/** a fan of bright feathers standing up from the origin */
function feathers(T, n, len, cols = [C.red, C.yellow, C.teal, C.blue, C.orange, C.pink], spread = 1.6) {
  for (let i = 0; i < n; i++) { const a = (n > 1 ? i / (n - 1) - 0.5 : 0) * spread, tip = [Math.sin(a) * len, Math.cos(a) * len, (i % 2) * 0.03], sdx = Math.cos(a) * len * 0.14, sdy = -Math.sin(a) * len * 0.14; T.quad([0, 0, 0], [tip[0] * 0.55 + sdx, tip[1] * 0.55 + sdy, 0], tip, [tip[0] * 0.55 - sdx, tip[1] * 0.55 - sdy, 0], cols[i % cols.length], cols[i % cols.length], C.white, cols[i % cols.length]); }
}
function flameGeo() { return cached('flame', () => { const T = new B(0); T.lathe(0, 0, 0, [[0.5, 0], [0.62, 0.3], [0.3, 0.8], [0, 1.4]], 4, (x, y) => (y < 0.3 ? C.ember : y < 0.8 ? C.fire : C.fireH)); T.lathe(0.12, 0, 0.06, [[0.3, 0.1], [0.34, 0.4], [0, 1.0]], 3, C.fireH); return T.geo(); }); }
function puffGeo() { return cached('puff', () => { const T = new B(0.04); T.ball(0, 0, 0, 1, 0.85, 1, (x, y, z, nx, ny) => (ny > 0.1 ? 0xf4f2ec : 0xbcbab4), 5, 3, 0.2, rng(5)); return T.geo(); }); }
const fireAt = (p, s, R) => anim(mesh(flameGeo(), 'glow'), 'flame', { ph: R() * 40 }, p, [0, 0, 0], s);
const smokeAt = (p, h, s, n, R, dx = 0.3, dz = 0, rate = 0.14) => Array.from({ length: n }, (_, i) => anim(mesh(puffGeo(), 'smoke'), 'smoke', { ph: i / n + R() * 0.08, h, dx, dz, rate }, p, [0, 0, 0], s));
/** a bed of embers ringed with stones, r across (stones into T, glow into G) */
function firepit(T, G, R, x, y, z, r) {
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; T.at([x + Math.cos(a) * r, y, z + Math.sin(a) * r], [0, a, 0], 1, () => rock(T, R, r * 0.34, i % 2 ? C.stone : C.stoneD)); }
  G.cyl(x, y + 0.02, z, r * 0.9, r * 0.5, r * 0.25, 6, (px, py, pz, nx, ny) => (ny > 0.5 ? C.fire : C.ember), 2);
  T.beam([x - r * 0.7, y + r * 0.2, z - r * 0.2], [x + r * 0.6, y + r * 0.35, z + r * 0.3], r * 0.13, C.soot, 4); T.beam([x - r * 0.3, y + r * 0.2, z + r * 0.6], [x + r * 0.2, y + r * 0.4, z - r * 0.6], r * 0.13, C.soot, 4);
}
/** a hide banner hanging down a pole (the pole is the local Y axis, the hide flies along +X), with feathers at the hem */
function bannerGeo(v) {
  v = ((Math.floor(N(v)) % 4) + 4) % 4;
  return cached(`banner:${v}`, () => {
    const T = new B(0.06), dye = [C.red, C.teal, C.yellow, C.purple][v % 4], sign = [C.white, C.yellow, C.red, C.white][v % 4];
    const P = (x, y) => [x, y, Math.sin(x * 7 + y * 3) * 0.04];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const y0 = -i * 0.36, y1 = y0 - 0.36 - (i === 2 ? (j ? 0.05 : 0.16) : 0), x0 = j * 0.28, x1 = x0 + 0.28 - (j && i === 2 ? 0.08 : 0); T.quad(P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), (i + j) % 2 ? dye : mul(dye, 0.82)); }
    T.fan([0.28, -0.5, 0.05], [[0.28, -0.3, 0.05], [0.42, -0.5, 0.05], [0.28, -0.7, 0.05], [0.14, -0.5, 0.05]].map(([x, y]) => add(P(x, y), [0, 0, 0.012])), sign); T.fan([0.28, -0.5, -0.05], [[0.28, -0.3, 0], [0.42, -0.5, 0], [0.28, -0.7, 0], [0.14, -0.5, 0]].map(([x, y]) => add(P(x, y), [0, 0, -0.012])), sign);
    T.beam([0, 0.02, 0], [0.6, 0.02, 0], 0.025, C.woodD, 4);
    for (let i = 0; i < 3; i++) T.at([0.1 + i * 0.2, -1.1 - (i % 2) * 0.08, 0], [PI, 0, 0], 1, () => feathers(T, 2, 0.22, [[C.yellow, C.orange], [C.white, C.teal], [C.orange, C.red]][i], 0.7));
    return T.geo();
  });
}
const bannerAt = (v, p, ry, R, s = 1) => anim(mesh(bannerGeo(v)), 'flag', { ph: R() * 40, rate: 0.8 + R() * 0.4, amp: 1 }, p, [0, ry, 0], s);
function piece(kind, v, G, kids = [], extra = {}) { return rootOf(kind, v, [mesh(G.solid), G.glow ? mesh(G.glow, 'glow') : null, ...kids], extra); }

// =====================================================================================
// THE VILLAGE: small structures
// =====================================================================================
function hutGeo(v) {
  return cached(`hut:${v}`, () => {
    const R = rng(v * 41 + 3), T = new B(0.08), G = new B(0), D = new B(0.07), dy = 1.25, hz = -0.2, wr = 0.84;
    // crooked stilts and braces
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.2, x = Math.cos(a) * 1.0, z = Math.sin(a) * 1.0, w = (R() - 0.5) * 0.3; T.tube(curve([[x * 1.15, 0, z * 1.15], [x * 0.92 + w, 0.62, z * 0.92 - w], [x, dy - 0.05, z]], 2), [0.085, 0.075, 0.07, 0.065, 0.07], 5, woodC(C.drift, C.driftD)); lash(T, [x, dy - 0.2, z], 0.075); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.6, b = a + 1.75; T.beam([Math.cos(a) * 1.05, 0.25, Math.sin(a) * 1.05], [Math.cos(b) * 0.98, 1.05, Math.sin(b) * 0.98], 0.04, C.bamboo, 4); }
    // the deck: planks across, a rim of poles
    for (let i = -5; i < 5; i++) { const x0 = i * 0.24, x1 = x0 + 0.225, xm = x0 + 0.11, hw = Math.sqrt(Math.max(0.02, 1.44 - xm * xm)), c = pick(R, [C.woodL, C.wood, C.drift, C.wood]); T.quad([x0, dy, -hw], [x1, dy, -hw], [x1, dy, hw], [x0, dy, hw], c); }
    T.cyl(0, dy - 0.1, 0, 1.2, 1.21, 0.1, 10, C.woodD, 0);
    // woven-reed wall with a painted band and a dark doorway toward +Z
    const ring = (y, r) => { const o = []; for (let j = 0; j < 10; j++) { const a = ((j + 0.5) / 10) * TAU - PI / 2; o.push([Math.cos(a) * r, y, hz - Math.sin(a) * r]); } return o; };
    T.loft([ring(dy, wr), ring(dy + 0.36, wr), ring(dy + 0.52, wr + 0.01), ring(dy + 0.9, wr), ring(dy + 1.1, wr * 0.96)], (x, y, z, nx, ny, nz, i, j) => (i === 1 ? (j % 2 ? C.red : C.white) : (i + j) % 2 ? C.reed : C.reedL));
    const dz = hz + wr * Math.cos(PI / 10) + 0.012;
    T.quad([-0.2, dy, dz], [0.2, dy, dz], [0.2, dy + 0.78, dz], [-0.2, dy + 0.78, dz], 0x18120e);
    for (const sd of [-1, 1]) T.beam([sd * 0.24, dy, dz + 0.02], [sd * 0.22, dy + 0.85, dz + 0.02], 0.035, C.drift, 4);
    T.beam([-0.3, dy + 0.85, dz + 0.02], [0.3, dy + 0.85, dz + 0.02], 0.04, C.drift, 4);
    T.at([0, dy + 0.9, dz + 0.04], [0, 0, 0], 1.5, () => skull(T, C.red));
    T.quad([-0.19, dy + 0.78, dz + 0.02], [0.02, dy + 0.78, dz + 0.02], [-0.02, dy + 0.3, dz + 0.05], [-0.2, dy + 0.2, dz + 0.04], C.hide, C.hide, C.hideL, C.hideD);   // a hide door-flap, tied back
    // the roof: a steep shaggy cone, crossed horns and feathers at the peak
    thatchCone(T, R, 0, dy + 0.92, hz, 1.3, 1.95, 5, 14);
    for (const sd of [-1, 1]) T.tube([[0, dy + 2.75, hz], [sd * 0.14, dy + 2.95, hz], [sd * 0.3, dy + 3.05, hz]], [0.05, 0.035, 0.006], 4, C.bone);
    T.at([0, dy + 2.8, hz], [0, 0, 0], 1, () => feathers(T, 3, 0.3, [C.red, C.yellow, C.teal], 1.0));
    // the porch: a table of jars, a mortar, masks, and the brazier
    T.at([0.52, dy, 0.72], [0, -0.5, 0], 1, () => { T.box(0, 0.24, 0, 0.56, 0.04, 0.3, C.woodL); for (const [x, z] of [[-0.24, -0.11], [0.24, -0.11], [-0.24, 0.11], [0.24, 0.11]]) T.beam([x, 0, z], [x, 0.24, z], 0.022, C.woodD, 3);
      T.at([-0.18, 0.28, 0], [0, 0, 0], 1, () => pot(T, 0.075, 0.17, C.clay, 0x6ad04a)); T.at([0, 0.28, -0.03], [0, 0, 0], 1, () => pot(T, 0.06, 0.2, C.teal, C.purple, 5)); T.at([0.17, 0.28, 0.02], [0, 0, 0], 1, () => pot(T, 0.085, 0.09, C.stone, 0xd8c24a, 5)); T.beam([0.17, 0.33, 0.02], [0.24, 0.47, 0.06], 0.016, C.bone, 3); });
    T.at([0.95, dy, 0.2], [0, -1.1, 0], 1, () => pot(T, 0.12, 0.26, C.clayD, 0x2a1c16));
    T.at([-0.33, dy + 0.02, dz + 0.06], [-0.25, 0.15, 0], 1.25, () => mask(T, v)); T.at([0.36, dy + 0.02, dz + 0.05], [-0.25, -0.2, 0], 1.1, () => mask(T, v + 1)); T.at([-0.82, dy + 0.02, 0.5], [-0.3, 0.9, 0], 1.2, () => mask(T, v + 3));
    const bz = [-0.5, dy, 0.82];
    T.lathe(bz[0], bz[1], bz[2], [[0.07, 0], [0.05, 0.16], [0.17, 0.3], [0.19, 0.36]], 6, (x, y, z, nx, ny, nz, i) => (i === 2 ? C.clay : C.clayD));
    G.cyl(bz[0], bz[1] + 0.33, bz[2], 0.16, 0.08, 0.07, 6, (x, y, z, nx, ny) => (ny > 0.5 ? C.fire : C.ember), 2);
    // the ladder to the ground
    ladder(T, [0, 0, 1.78], [0, dy + 0.05, 1.16], 0.4, 5, [1, 0, 0], C.drift, 0.035);
    // fetishes hung all round the eave on cords (their own mesh, about the top of the wall)
    const ey = 0.02, er = 1.24, n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.15, x = Math.cos(a) * er, z = Math.sin(a) * er, len = 0.16 + R() * 0.22, k = i % 6, ry = PI / 2 - a;
      D.beam([x, ey, z], [x, ey - len, z], 0.008, C.rope, 3);
      D.at([x, ey - len, z], [0, ry, 0], 1, () => {
        if (k === 0) D.at([0, -0.13, 0], [0, 0, 0], 1.35, () => skull(D, pick(R, [C.red, C.teal, C.yellow])));
        else if (k === 1) D.at([0, -0.27, 0], [0, 0, 0], 1.2, () => gourd(D, pick(R, [0xd8a43a, 0xb8c24a, 0xc8763a])));
        else if (k === 2) { D.box(0, -0.2, 0, 0.11, 0.2, 0.1, pick(R, [C.red, C.teal, C.yellow]), 0, 3, 0.8); D.quad([-0.04, -0.07, 0.056], [0.04, -0.07, 0.056], [0.04, -0.1, 0.056], [-0.04, -0.1, 0.056], C.white); D.tri([-0.03, -0.14, 0.056], [0.03, -0.14, 0.056], [0, -0.18, 0.05], C.black); D.at([0, 0, 0], [0, 0, 0], 1, () => feathers(D, 2, 0.12, [C.white, C.orange], 1.2)); }
        else if (k === 3) { D.cyl(0, -0.24, 0, 0.07, 0.02, 0.24, 5, (px, py, pz, nx, ny, nz, i2, j) => (j % 2 ? 0x6a9a3a : 0x9aa84a), 0); D.cyl(0, -0.06, 0, 0.03, 0.03, 0.03, 4, C.rope, 0); }
        else if (k === 4) { D.beam([-0.09, 0, 0], [0.09, 0, 0], 0.012, C.woodD, 3); for (let b = 0; b < 4; b++) { const bx = -0.075 + b * 0.05, bl = 0.12 + ((b * 7) % 3) * 0.04; D.beam([bx, -0.02, 0], [bx, -0.02 - bl, 0], 0.013, b % 2 ? C.bone : C.boneD, 3); } }
        else D.at([0, -0.34, 0], [0, 0, 0], 1.0, () => mask(D, i));
      });
    }
    return { solid: T.geo(), glow: G.geo(), dangle: D.geo(), eave: [0, dy + 0.94, hz], brazier: [bz[0], bz[1] + 0.36, bz[2]] };
  });
}
/** the shaman's hut: door and ladder toward +Z */
scenery.shamanHut = (seed) => {
  const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 21), G = hutGeo(v);
  return piece('shamanHut', v, G, [anim(mesh(G.dangle), 'sway', { ax: 0.012, az: 0.012, ay: 0.045, rate: 1.1, ph: R() * 40 }, G.eave), fireAt(G.brazier, 0.2, R), ...smokeAt(add(G.brazier, [0, 0.25, 0]), 1.3, 0.12, 2, R, 0.2, 0.1)]);
};

/** a skeletal tower of timber posts and bamboo bracing into T, about (0, 0): deck at H, hb/ht = half width at the foot/top */
function tower(T, R, o) {
  const { H, hb, ht, levels } = o, top = H + 0.78, corner = (sx, sz, y) => { const k = lerp(hb, ht, clamp(y / H, 0, 1)); return [sx * k, y, sz * k]; };
  const C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of C4) { const w = (R() - 0.5) * 0.1; T.tube([corner(sx, sz, 0), add(corner(sx, sz, H * 0.5), [w, 0, -w]), corner(sx, sz, H), [sx * ht, top + R() * 0.12, sz * ht]], [0.085, 0.075, 0.065, 0.055], 5, woodC(C.wood, C.woodD), { cap: 2, capCol: C.woodL }); }
  for (let l = 0; l < levels; l++) {
    const y0 = (H * l) / levels + 0.12, y1 = (H * (l + 1)) / levels - 0.1;
    C4.forEach(([sx, sz], i) => {
      const [nx2, nz2] = C4[(i + 1) % 4], a0 = corner(sx, sz, y0), b0 = corner(nx2, nz2, y0), a1 = corner(sx, sz, y1), b1 = corner(nx2, nz2, y1), g = (l + i) % 2 ? C.bamboo : C.bambooG;
      T.beam(a1, b1, 0.04, g, 4);
      if (o.open !== undefined && i === o.open && l === 0) return;      // a face left clear at the foot
      T.beam(a0, b1, 0.034, (l + i) % 2 ? C.bambooG : C.bamboo, 4); T.beam(b0, a1, 0.034, C.bambooD, 4);
    });
    for (const [sx, sz] of C4) lash(T, corner(sx, sz, y1), 0.085);
  }
  if (levels > 2) for (let i = 0; i < 3; i++) T.box((i - 1) * ht * 0.55 - 0.1, (H * 2) / 3 - 0.06, 0, ht * 0.5, 0.04, ht * 2.1, pick(R, [C.woodL, C.wood, C.drift]));   // a half floor
  // the deck and its breastworks of woven cane hung with hides
  const dh = ht + 0.16, n = 5;
  for (let i = 0; i < n; i++) T.box(-dh + (i + 0.5) * ((dh * 2) / n), H - 0.03, 0, (dh * 2) / n - 0.02, 0.06, dh * 2 + (i % 2) * 0.08, pick(R, [C.woodL, C.wood, C.drift, C.woodL]), 0, 3);
  C4.forEach(([sx, sz], i) => {
    const [nx2, nz2] = C4[(i + 1) % 4], a = [sx * dh, H + 0.03, sz * dh], b = [nx2 * dh, H + 0.03, nz2 * dh], out = [(sx + nx2) * 0.04, 0, (sz + nz2) * 0.04];
    for (let q = 0; q < 3; q++) for (let r = 0; r < 2; r++) { const p0 = lerp3(a, b, q / 3), p1 = lerp3(a, b, (q + 1) / 3), y0 = r * 0.33, y1 = y0 + 0.33; T.quad(add(p0, [out[0] * r, y0, out[2] * r]), add(p1, [out[0] * r, y0, out[2] * r]), add(p1, [out[0] * (r + 1), y1, out[2] * (r + 1)]), add(p0, [out[0] * (r + 1), y1, out[2] * (r + 1)]), (q + r) % 2 ? C.mat : C.thatchD); }
    T.beam(add(a, [out[0] * 2, 0.68, out[2] * 2]), add(b, [out[0] * 2, 0.68, out[2] * 2]), 0.035, C.bamboo, 4);
    if (i % 2 === (o.hides || 0)) { const m = lerp3(a, b, 0.5), tng = norm(sub(b, a)), o3 = [out[0] * 3.4, 0, out[2] * 3.4], P = (u, y) => add(add(m, sc3(tng, u)), [o3[0], y, o3[2]]); T.quad(P(-0.3, 0.72), P(0.28, 0.72), P(0.34, 0.2), P(-0.26, 0.12), C.hide, C.hideL, C.hideD, C.hide); T.tri(P(-0.1, 0.5), P(0.1, 0.55), P(0.02, 0.3), C.fur); }
  });
  return { top, dh };
}
function hornTrumpet(T) {
  T.tube(curve([[0, 0, 0], [0.2, 0.03, 0], [0.42, 0.14, 0], [0.56, 0.34, 0]], 2), (u) => lerp(0.02, 0.1, u ** 1.4), 5, (x, y, z, nx, ny, nz, i) => (i === 1 || i === 4 ? C.red : C.bone));
}
function javelins(T, R, n, len) { for (let i = 0; i < n; i++) { const a = (i / n) * TAU, tip = [Math.cos(a) * 0.07 + 0.12, len, Math.sin(a) * 0.07 - 0.1]; T.beam([Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], tip, 0.016, C.woodL, 3); T.cyl(tip[0], tip[1] - 0.01, tip[2], 0.03, 0, 0.12, 3, C.stone, 0); } T.cyl(0.06, len * 0.5, -0.05, 0.075, 0.075, 0.05, 5, C.red, 0); }
function towerGeo(v) {
  return cached(`tower:${v}`, () => {
    const R = rng(v * 47 + 5), T = new B(0.08), H = 4.05, o = { H, hb: 0.74, ht: 0.56, levels: 3, hides: v % 2 }, { top, dh } = tower(T, R, o);
    // a knotted rope ladder down the front, javelins, sling stones and the horn
    const la = [0, H, dh + 0.03], lb = [0, 0.05, 0.86];
    for (const sd of [-1, 1]) T.beam(add(la, [sd * 0.17, 0, 0]), add(lb, [sd * 0.19, 0, 0]), 0.018, C.rope, 3);
    for (let i = 0; i < 10; i++) { const p = lerp3(la, lb, (i + 0.5) / 10); T.beam(add(p, [-0.2, 0, 0]), add(p, [0.2, 0, 0]), 0.022, C.woodL, 3); for (const sd of [-1, 1]) if (i % 2) T.ball(p[0] + sd * 0.18, p[1], p[2], 0.03, 0.03, 0.03, C.rope, 4, 2); }
    T.at([-0.4, H + 0.03, -0.38], [0, 0, 0], 1, () => javelins(T, R, 6, 1.15)); T.at([0.42, H + 0.03, -0.4], [0, 2, 0], 1, () => javelins(T, R, 5, 1.05));
    T.at([0.36, H + 0.03, 0.32], [0, 0, 0], 1, () => heap(T, R, 7, 0.085, [C.stone, C.stoneD, 0xa8a8a0], 0.7));
    T.beam([-0.42, H, 0.42], [-0.42, H + 0.62, 0.42], 0.03, C.woodD, 4); T.at([-0.42, H + 0.66, 0.44], [0, -PI / 4, 0.25], 1.15, () => hornTrumpet(T));
    // the standard: a tall pole with a skull and feathers
    const pole = [-0.56, top + 0.32, -0.56];
    T.beam([-0.56, H, -0.56], pole, 0.03, C.bamboo, 4); T.at([pole[0], pole[1] - 0.12, pole[2]], [0, PI / 4, 0], 1.3, () => skull(T, C.teal)); T.at(pole, [0, PI / 4, 0], 1, () => feathers(T, 5, 0.38));
    return { solid: T.geo(), flag: [pole[0], pole[1] - 0.22, pole[2]] };
  });
}
/** watch tower: rope ladder toward +Z, fighting deck at y = 4.05 */
scenery.watchTower = (seed) => { const s = seedOf(seed), v = s % 3, R = rng(s * 13 + 22), G = towerGeo(v); return piece('watchTower', v, G, [bannerAt(s % 4, G.flag, PI * 0.25, R, 0.42)], { deck: 4.05 }); };

/** one sharpened log of a palisade into T */
function stake(T, R, x, z, h, r = 0.13, lean = 0) {
  const c = pick(R, [C.bark, C.barkD, C.wood, C.woodD]), c2 = mul(c, 0.82), tx = x + lean * h;
  T.tube([[x, -0.02, z], [tx, h - 0.24, z + lean * 0.3]], [r, r * 0.92], 6, (px, py, pz, nx, ny, nz, i, j) => (j % 2 ? c : c2), { rot: R() });
  T.cyl(tx, h - 0.24, z + lean * 0.3, r * 0.92, 0, 0.26, 6, C.woodL, 0);
}
function vineRope(T, R, a, b, n, off) { for (let i = 0; i < n; i++) { const p = lerp3(a, b, i / n), q = lerp3(a, b, (i + 1) / n); T.quad(add(p, [0, -0.035, off]), add(q, [0, -0.035, off]), add(q, [0, 0.035, off]), add(p, [0, 0.035, off]), i % 2 ? C.vine : 0x6a7a2a); if (R() < 0.4) T.tri(add(p, [0.02, 0.03, off]), add(p, [0.12, 0.06, off + 0.03 * Math.sign(off)]), add(p, [0.06, -0.08, off + 0.02 * Math.sign(off)]), C.leafL); } }
function palisadeGeo(v) {
  return cached(`palisade:${v}`, () => {
    const R = rng(v * 53 + 7), T = new B(0.08);
    for (let i = 0; i < 8; i++) stake(T, R, -0.875 + i * 0.25, (R() - 0.5) * 0.05, 1.38 + R() * 0.26, 0.135, (R() - 0.5) * 0.04);
    for (const y of [0.45, 1.02]) for (const off of [0.15, -0.15]) vineRope(T, R, [-1, y + (R() - 0.5) * 0.06, 0], [1, y + (R() - 0.5) * 0.06, 0], 8, off);
    return { solid: T.geo() };
  });
}
/** a run of sharpened logs 2 long along X */
scenery.palisade = (seed) => { const s = seedOf(seed), v = s % 3; return piece('palisade', v, palisadeGeo(v)); };

function gateGeo(v) {
  return cached(`gate:${v}`, () => {
    const R = rng(v * 59 + 9), T = new B(0.08), H = 2.55, tx = 1.38, flags = [];
    for (const sd of [-1, 1]) T.at([sd * tx, 0, 0], [0, 0, 0], 1, () => { const { top } = tower(T, R, { H, hb: 0.52, ht: 0.42, levels: 2, hides: sd > 0 ? 0 : 1 }); T.at([sd * 0.25, H + 0.03, -0.25], [0, 0, 0], 1, () => javelins(T, R, 5, 1.0)); T.beam([sd * 0.42, H, 0.42], [sd * 0.42, top + 0.72, 0.42], 0.028, C.bamboo, 4); T.at([sd * 0.42, top + 0.72, 0.42], [0, 0, 0], 1, () => feathers(T, 4, 0.3)); flags.push([sd * tx + sd * 0.42, top + 0.55, 0.42]); });
    // the walkway between them and its rails
    for (let i = 0; i < 6; i++) T.box(-0.85 + i * 0.34, H - 0.03, 0, 0.32, 0.06, 0.82 + (i % 2) * 0.06, pick(R, [C.woodL, C.wood, C.drift]), 0, 3);
    for (const sz of [-1, 1]) { T.beam([-1.0, H - 0.1, sz * 0.36], [1.0, H - 0.1, sz * 0.36], 0.05, C.woodD, 4); T.beam([-0.98, H + 0.6, sz * 0.42], [0.98, H + 0.6, sz * 0.42], 0.03, C.bamboo, 4); for (let q = 0; q < 5; q++) T.quad([-0.96 + q * 0.384, H + 0.03, sz * 0.4], [-0.96 + (q + 1) * 0.384, H + 0.03, sz * 0.4], [-0.96 + (q + 1) * 0.384, H + 0.56, sz * 0.43], [-0.96 + q * 0.384, H + 0.56, sz * 0.43], q % 2 ? C.mat : C.thatchD); }
    // the gate: two leaves of logs under a heavy lintel hung with a great skull
    for (let i = 0; i < 8; i++) stake(T, R, -0.805 + i * 0.23, 0, 1.95 + ((i * 5) % 3) * 0.07, 0.118);
    for (const y of [0.55, 1.45]) for (const sd of [-1, 1]) T.beam([sd * 0.06, y, 0.13], [sd * 0.9, y + 0.06, 0.13], 0.045, C.woodD, 4);
    for (const sd of [-1, 1]) { T.beam([sd * 0.1, 0.55, 0.15], [sd * 0.86, 1.47, 0.15], 0.035, C.wood, 4); T.cyl(sd * 0.3, 0.95, 0.19, 0.05, 0.05, 0.1, 5, C.rope, 2); }
    T.tube([[-1.0, 2.2, 0.02], [0, 2.3, 0.05], [1.0, 2.2, 0.02]], 0.085, 5, woodC(C.drift, C.driftD), { cap: 3 });
    T.at([0, 2.26, 0.16], [0.15, 0, 0], 2.6, () => skull(T, C.red));
    for (const sd of [-1, 1]) for (const x of [1.875, 1.625]) stake(T, R, sd * x, 0, 1.45 + R() * 0.2, 0.135);
    return { solid: T.geo(), flags };
  });
}
/** two towers joined by a walkway (deck at 2.55) over a closed log gate; the gate faces +Z, palisades join at x = +-2 */
scenery.gatehouse = (seed) => { const s = seedOf(seed), v = s % 2, R = rng(s * 13 + 24), G = gateGeo(v); return piece('gatehouse', v, G, G.flags.map((p, i) => bannerAt(s + i, p, i ? PI : 0, R, 0.5)), { deck: 2.55 }); };

function boardwalkGeo(v) {
  return cached(`boardwalk:${v}`, () => {
    const R = rng(v * 61 + 11), T = new B(0.08), dy = 0.5, mx = v % 2 ? -0.6 : 0.6, mz = v > 1 ? -0.4 : 0.4;
    for (const x of [-0.6, 0.6]) { for (const z of [-0.4, 0.4]) { const moor = x === mx && z === mz, h = moor ? 1.2 : dy + (R() < 0.5 ? 0.14 : -0.05); T.tube([[x + (R() - 0.5) * 0.06, -0.45, z], [x, h, z]], [0.085, 0.07], 6, (px, py, pz, nx, ny, nz, i, j) => (py < 0.12 ? 0x4a5a3a : j % 2 ? C.driftD : C.drift), { cap: 2, capCol: C.woodL }); if (moor) { for (const y of [0.72, 0.8, 0.88]) lash(T, [x, y, z], 0.09); T.cyl(x, 1.02, z, 0.085, 0.085, 0.06, 5, C.red, 0); } }
      T.beam([x, dy - 0.11, -0.5], [x, dy - 0.11, 0.5], 0.05, C.woodD, 4); }
    for (const z of [-0.3, 0.3]) T.beam([-1.2, dy - 0.07, z], [1.2, dy - 0.07, z], 0.04, C.wood, 4);
    for (let i = 0; i < 12; i++) { if (v === 2 && i === 4) continue; T.box(-1.1 + i * 0.2, dy - 0.04, (R() - 0.5) * 0.05, 0.175, 0.04, 0.84 + R() * 0.1, pick(R, [C.woodL, C.drift, C.wood, C.driftD]), (R() - 0.5) * 0.06, 3); }
    T.at([mx * 0.5, dy, -mz * 0.6], [0, 0, 0], 1, () => coil(T, 0.14));
    if (v !== 1) T.at([-mx, dy, mz * 0.5], [0, 0.4, 0], 1, () => basket(T, R, 0.13, 0.14, [0xc8ccd0, 0x9ab0c0, C.orange], 4));
    return { solid: T.geo() };
  });
}
/** a plank walk 2.4 long along X, 0.9 wide, deck at y = 0.5 on pilings (y = 0 is the water) */
scenery.boardwalk = (seed) => { const s = seedOf(seed), v = s % 3; return piece('boardwalk', v, boardwalkGeo(v), [], { deck: 0.5 }); };

function totemGeo(v) {
  return cached(`totem:${v}`, () => {
    const R = rng(v * 67 + 13), T = new B(0.06), cols = [[C.red, C.teal, C.yellow], [C.teal, C.yellow, C.red], [C.white, C.red, C.teal]][v];
    T.cyl(0, 0, 0, 0.19, 0.16, 0.5, 7, (x, y, z, nx, ny, nz, i, j) => (j % 2 ? C.wood : C.woodD), 0);
    for (let i = 0; i < 4; i++) T.at([Math.cos(i * 1.6 + 0.4) * 0.24, 0, Math.sin(i * 1.6 + 0.4) * 0.24], [0, i, 0], 1, () => rock(T, R, 0.1));
    for (let f = 0; f < 3; f++) {
      const y = 0.5 + f * 0.5, base = cols[f], trim = cols[(f + 1) % 3], r = 0.18 - f * 0.01;
      T.at([0, y, 0], [0, 0, 0], 1, () => {
        T.cyl(0, 0, 0, r * 0.92, r, 0.5, 7, (x, yy, z, nx, ny, nz) => (nz > 0.3 ? base : (Math.floor(yy * 8) % 2 ? C.wood : C.woodD)), 2, PI / 14);
        T.box(0, 0.36, r * 0.86, r * 1.9, 0.08, 0.12, trim, 0, 3);                                    // the brow
        for (const sd of [-1, 1]) { T.box(sd * r * 0.48, 0.24, r * 0.93, 0.1, 0.1, 0.05, C.white, 0, 3); T.box(sd * r * 0.48, 0.265, r * 0.97, 0.045, 0.05, 0.03, C.black, 0, 3); }
        T.box(0, 0.14, r * 0.95, 0.07, 0.2, 0.1, mul(base, 0.75), 0, 3, 0.6);                        // the nose
        T.box(0, 0.03, r * 0.9, r * 1.3, 0.09, 0.08, C.black, 0, 3); for (let k = -2; k <= 2; k++) T.tri([k * 0.045 - 0.02, 0.12, r * 0.95 + 0.04], [k * 0.045 + 0.02, 0.12, r * 0.95 + 0.04], [k * 0.045, 0.06, r * 0.95 + 0.045], C.white);
        if (f === (v + 1) % 3) for (const sd of [-1, 1]) { T.quad([sd * r * 0.9, 0.3, 0], [sd * (r + 0.42), 0.46, -0.02], [sd * (r + 0.36), 0.2, -0.02], [sd * r * 0.9, 0.12, 0], trim, base, base, trim); T.tri([sd * (r + 0.1), 0.26, 0.012], [sd * (r + 0.3), 0.36, -0.01], [sd * (r + 0.27), 0.24, -0.01], C.white); }   // wings
      });
    }
    T.cyl(0, 2.0, 0, 0.17, 0.12, 0.12, 7, C.woodD, 2);
    for (const sd of [-1, 1]) T.tube(curve([[sd * 0.08, 2.08, 0], [sd * 0.26, 2.14, 0], [sd * 0.36, 2.34, 0], [sd * 0.3, 2.62, 0]], 2), (u) => 0.06 * (1 - u) + 0.006, 5, (x, y, z, nx, ny, nz, i) => (i % 3 === 0 ? C.boneD : C.bone));
    T.at([0, 2.1, -0.02], [0, 0, 0], 1, () => feathers(T, 5, 0.46, [C.red, C.yellow, C.teal, C.yellow, C.red], 1.1));
    for (const sd of [-1, 1]) { T.beam([sd * 0.17, 2.02, 0.05], [sd * 0.23, 1.72, 0.1], 0.008, C.rope, 3); T.at([sd * 0.23, 1.7, 0.1], [0, 0, PI / 2], 1, () => bone(T, 0.16, 0.018)); }
    return { solid: T.geo() };
  });
}
/** a carved and painted totem pole, faces toward +Z */
scenery.fetishPole = (seed) => { const s = seedOf(seed), v = s % 3; return piece('fetishPole', v, totemGeo(v)); };

function canoeGeo(v) {
  return cached(`canoe:${v}`, () => {
    const R = rng(v * 71 + 15), T = new B(0.07), paint = [C.red, C.teal, C.yellow][v], st = [[-1.3, 0.02, 0.42, 0.34], [-1.05, 0.12, 0.3, 0.1], [-0.6, 0.2, 0.3, 0.02], [0, 0.22, 0.3, 0], [0.6, 0.2, 0.3, 0.02], [1.05, 0.12, 0.31, 0.12], [1.32, 0.02, 0.5, 0.4]];
    T.at([0, 0.02, -0.25], [0.09, 0, 0], 1, () => {
      // the dugout: a thick-walled trough, narrow and rising at both ends
      const rings = st.map(([x, w, top, bot]) => [[x, top, -w], [x, lerp(bot, top, 0.35), -w * 0.92], [x, bot, -w * 0.4], [x, bot, w * 0.4], [x, lerp(bot, top, 0.35), w * 0.92], [x, top, w], [x, top - 0.02, w * 0.72], [x, bot + 0.07, 0], [x, top - 0.02, -w * 0.72]]);
      T.loft(rings, (x, y, z, nx, ny, nz, i, j) => (j >= 5 ? (j === 5 || j === 8 ? C.woodL : 0x3a2a1c) : j === 0 || j === 4 ? (Math.floor((x + 2) * 5) % 2 ? paint : C.white) : j % 2 ? C.wood : C.woodD), true, true);
      T.at([1.36, 0.42, 0], [0, 0, -0.5], 1, () => { T.box(0, 0, 0, 0.16, 0.2, 0.09, paint, 0, 3, 0.6); for (const sd of [-1, 1]) T.tri([0.02, 0.1, sd * 0.05], [0.07, 0.14, sd * 0.045], [0.06, 0.07, sd * 0.05], C.white); });
      // the outrigger: two booms lashed to a float
      const fz = 1.0, fy = 0.0;
      T.tube([[-1.0, fy + 0.12, fz], [-0.6, fy + 0.03, fz], [0.6, fy + 0.03, fz], [1.05, fy + 0.14, fz]], [0.01, 0.09, 0.09, 0.01], 5, woodC(C.bambooG, 0xc0a83c));
      for (const x of [-0.55, 0.55]) { T.tube([[x, 0.3, -0.24], [x, 0.36, 0.35], [x, 0.24, 0.8], [x, 0.08, fz]], 0.03, 4, C.woodD); lash(T, [x, 0.33, 0.2], 0.04); T.ball(x, 0.1, fz, 0.06, 0.05, 0.06, C.rope, 4, 2); }
      // paddles, and a coil of rope in the bow
      for (const [x, z, ry] of [[-0.1, 0.03, 0.12], [0.15, -0.05, -0.1]]) T.at([x, 0.2, z], [0, ry, 0.03], 1, () => { T.beam([-0.55, 0, 0], [0.25, 0, 0], 0.02, C.woodL, 3); T.quad([0.2, 0, 0], [0.42, 0, 0.08], [0.68, 0, 0], [0.42, 0, -0.08], pick(R, [C.woodL, paint]), C.woodL, C.wood, C.woodL); });
      T.at([-0.8, 0.14, 0], [0, 0, 0], 1, () => coil(T, 0.1));
    });
    return { solid: T.geo() };
  });
}
/** a dugout outrigger canoe drawn up on the sand: bow toward +X, the float on the +Z side */
scenery.canoe = (seed) => { const s = seedOf(seed), v = s % 3; return piece('canoe', v, canoeGeo(v)); };

// =====================================================================================
// THE VILLAGE: the great hall, the market and the working buildings
// =====================================================================================
function hallGeo(v) {
  return cached(`hall:${v}`, () => {
    const R = rng(v * 73 + 19), T = new B(0.08), G = new B(0), PY = 0.72, RM = 3.6, RE = 4.0, out = {};
    const drift = woodC(C.drift, C.driftD), carved = (x, y, z, nx, ny, nz, i) => (i % 4 === 1 ? C.red : i % 4 === 3 ? C.teal : i % 2 ? C.driftD : C.drift);
    T.at([0, 0, -0.3], [0, 0, 0], 1, () => {
      // the platform: heavy logs side by side on sleepers, log steps up the front
      for (const x of [-2.7, -0.9, 0.9, 2.7]) T.tube([[x, 0.24, -2.15], [x, 0.24, 2.0]], 0.25, 6, woodC(C.barkD, C.bark), { cap: 3, capCol: C.woodL });
      for (let i = 0; i < 9; i++) { const z = -1.95 + i * 0.47, e = 3.15 + R() * 0.2; T.tube([[-e, 0.48, z], [e - R() * 0.2, 0.48, z]], 0.245, 6, woodC(i % 2 ? C.wood : C.bark, i % 2 ? C.woodD : C.barkD), { cap: 3, capCol: C.woodL, rot: R() }); }
      T.tube([[-1.15, 0.42, 2.18], [1.15, 0.42, 2.18]], 0.2, 6, woodC(), { cap: 3, capCol: C.woodL }); T.tube([[-1.0, 0.18, 2.48], [1.0, 0.18, 2.48]], 0.18, 6, woodC(C.bark, C.barkD), { cap: 3, capCol: C.woodL });
      // the roof: an arched A-frame whose ridge sweeps up to both gables
      const ep = (f, sd, sz) => [sd * 3 * f, 1.2, sz * 2.0], rp = (f, sd) => [sd * 3.3 * f, RM + (RE - RM) * f, 0];
      for (const sd of [-1, 1]) {
        thatch(T, R, ep(1, sd, -1), ep(0, sd, -1), rp(0, sd), rp(1, sd), 6, 10, { bulge: 0.32 });
        thatch(T, R, ep(1, sd, 1), ep(0.42, sd, 1), rp(0.42, sd), rp(1, sd), 6, 6, { bulge: 0.32 });
        thatch(T, R, ep(0.42, sd, 1), ep(0, sd, 1), rp(0, sd), rp(0.42, sd), 2, 4, { bulge: 0.32, t0: 0.667, jag: 0.2 });
        // the porch gable over the open front
        thatch(T, R, [sd * 1.8, 1.45, 2.5], [sd * 1.8, 1.45, 0.55], [0, 3.15, 0.66], [0, 3.5, 2.8], 4, 5, { bulge: 0.2 });
        // gable ends: crossed driftwood beams carved with notches, a beast's head on each tip; a painted reed wall behind
        for (const sz of [-1, 1]) {
          const tip = [sd * 3.42, RE + 0.3, -sz * 0.36];
          T.tube(curve([[sd * 3.1, 0.3, sz * 2.25], [sd * 3.14, 1.9, sz * 1.5], [sd * 3.3, RE - 0.25, sz * 0.2], tip], 3), (u) => lerp(0.15, 0.09, u), 5, carved, { cap: 1 });
          T.at(tip, [sz * 0.5, sd > 0 ? PI / 2 : -PI / 2, 0], 1, () => { T.box(0, -0.1, 0.02, 0.24, 0.3, 0.26, sz > 0 ? C.red : C.teal, 0, 3, 0.75); for (const k of [-1, 1]) { T.tri([k * 0.05, 0.1, 0.14], [k * 0.11, 0.13, 0.12], [k * 0.09, 0.04, 0.15], C.white); T.tube([[k * 0.09, 0.17, 0], [k * 0.2, 0.3, 0], [k * 0.18, 0.46, 0]], [0.04, 0.03, 0.005], 3, C.bone); } T.quad([-0.08, -0.02, 0.15], [0.08, -0.02, 0.15], [0.06, -0.08, 0.14], [-0.06, -0.08, 0.14], C.white); });
        }
        const wx = sd * 2.9, arch = [[wx, PY, -1.9], [wx, 1.9, -1.45], [sd * 3.0, 3.0, -0.75], [sd * 3.12, RE - 0.3, 0], [sd * 3.0, 3.0, 0.75], [wx, 1.9, 1.45], [wx, PY, 1.9]];
        for (let i = 0; i < 6; i++) T.tri([wx, PY, 0], arch[i], arch[i + 1], i % 2 ? C.reedL : C.reed);
        T.at([sd * 3.02, 1.9, 0], [0, sd * PI / 2, 0], 3.2, () => mask(T, v + (sd > 0 ? 0 : 1)));
        // porch posts and rafters of thick driftwood
        T.tube(curve([[sd * 1.72, PY - 0.1, 2.38], [sd * 1.66, 1.2, 2.42], [sd * 1.7, 1.5, 2.44]], 2), 0.13, 6, carved, { cap: 2 });
        T.tube(curve([[sd * 1.74, 1.4, 2.5], [sd * 1.2, 2.5, 2.62], [sd * 0.5, 3.2, 2.72], [0, 3.52, 2.78], [-sd * 0.3, 3.85, 2.82]], 2), (u) => lerp(0.12, 0.06, u), 5, drift);
        T.at([sd * 1.68, 1.15, 2.56], [0, 0, 0], 1.7, () => skull(T, sd > 0 ? C.red : C.teal));
        // the two great tusks flanking the way in
        T.tube(curve([[sd * 1.8, 0, 2.5], [sd * 2.37, 1.0, 2.57], [sd * 2.3, 2.2, 2.62], [sd * 1.6, 3.1, 2.62]], 3), (u) => 0.21 * (1 - u) ** 0.8 + 0.012, 6, (x, y, z, nx, ny, nz, i) => (i === 1 ? C.red : i === 2 ? C.black : i % 2 ? C.bone : mix(C.bone, C.boneD, 0.5)));
        for (let k = 0; k < 4; k++) T.at([sd * 1.8 + Math.cos(k * 1.6) * 0.3, 0, 2.5 + Math.sin(k * 1.6) * 0.3], [0, k, 0], 1, () => rock(T, R, 0.13));
        // banner poles topped with feathers
        const bp = [sd * 2.95, 0, 2.3];
        T.tube([bp, [bp[0], 2.1, bp[2]], [bp[0] + sd * 0.05, 4.2, bp[2]]], [0.065, 0.055, 0.04], 5, (x, y, z, nx, ny, nz, i) => (Math.floor(y * 2.5) % 2 ? C.bamboo : C.bambooG));
        T.at([bp[0] + sd * 0.05, 4.2, bp[2]], [0, 0, 0], 1, () => feathers(T, 5, 0.42)); T.at([bp[0], 0, bp[2]], [0, 0, 0], 1, () => rock(T, R, 0.16));
        (out.flags ||= []).push([bp[0] + sd * 0.04, 3.95, bp[2] - 0.3, sd]);
        // inside the open front: log benches, drums
        T.tube([[sd * 0.95, PY + 0.12, 0.45], [sd * 0.9, PY + 0.12, 1.75]], 0.15, 6, woodC(C.woodL, C.wood), { cap: 3, capCol: C.woodL });
        T.at([sd * 1.2, PY, 2.05], [0, 0, 0], 1, () => drum(T, 0.3, 0.52)); T.at([sd * 0.72, PY, 2.12], [0, 1, 0], 1, () => drum(T, 0.18, 0.34));
      }
      // the mask of the house over the door
      T.at([0, 2.85, 2.82], [0.1, 0, 0], 2.6, () => mask(T, v + 2));
      // smoke gap: a little roof lifted off the ridge
      for (const sz of [-1, 1]) { thatch(T, R, [-0.95, RM + 0.12, sz * 0.62], [0.95, RM + 0.12, sz * 0.62], [0.8, RM + 0.6, 0], [-0.8, RM + 0.6, 0], 2, 4); for (const x of [-0.7, 0.7]) T.beam([x, RM - 0.15, sz * 0.3], [x, RM + 0.3, sz * 0.36], 0.04, C.driftD, 4); }
      T.quad([-0.75, RM + 0.02, -0.34], [0.75, RM + 0.02, -0.34], [0.75, RM + 0.02, 0.34], [-0.75, RM + 0.02, 0.34], 0x15100c);
      T.tube([[-3.3, RE + 0.04, 0], [-0.9, RM + 0.12, 0]], 0.07, 4, drift); T.tube([[0.9, RM + 0.12, 0], [3.3, RE + 0.04, 0]], 0.07, 4, drift);
      // the fire pit, and behind it the rack of shields and spears
      firepit(T, G, R, 0, PY, 1.1, 0.34);
      T.quad([-1.5, PY + 0.012, -1.6], [1.5, PY + 0.012, -1.6], [1.5, PY + 0.012, 0.3], [-1.5, PY + 0.012, 0.3], 0x2a1e16);
      for (const x of [-1.15, 1.15]) T.beam([x, PY, 0.1], [x, PY + 0.95, 0.1], 0.045, C.woodD, 4);
      T.beam([-1.25, PY + 0.8, 0.1], [1.25, PY + 0.8, 0.1], 0.04, C.wood, 4);
      for (let i = 0; i < 6; i++) T.at([-1.0 + i * 0.4, PY, 0.02], [0.12, 0, (i - 2.5) * 0.04], 1, () => spear(T, 1.75 + (i % 2) * 0.15));
      for (let i = 0; i < 4; i++) T.at([-0.75 + i * 0.5, PY + 0.02, 0.42], [-0.3, 0, 0], 1.25, () => shield(T, i + v));
    });
    out.solid = T.geo(); out.glow = G.geo(); out.fire = [0, PY + 0.05, 0.8]; out.smoke = [0, RM + 0.5, -0.3];
    return out;
  });
}
/** the great longhouse, 7 along X: the open porch, tusks and banner poles face +Z; floor at y = 0.72 */
scenery.tribalHall = (seed) => {
  const s = seedOf(seed), v = s % 2, R = rng(s * 13 + 26), G = hallGeo(v);
  return piece('tribalHall', v, G, [fireAt(G.fire, 0.42, R), ...smokeAt(G.smoke, 2.0, 0.34, 3, R, 0.5, 0.15), ...G.flags.map(([x, y, z, sd], i) => bannerAt(s + i * 2, [x, y, z], sd > 0 ? 0 : PI, R, 1.25))], { floor: 0.72 });
};

const FRUIT = [[C.orange, 0xf6a23a], [C.red, 0xd8502a], [C.purple, 0x6a3a8a], [C.yellow, 0xf2e04a], [0x7ac83a, 0xa8d84a], [0xe8709a, 0xf29a6a]];
function marketGeo(v) {
  return cached(`market:${v}`, () => {
    const R = rng(v * 79 + 23), T = new B(0.08), out = {};
    const poles = { A: [-2.25, 2.15, -2.15], Bq: [0, 2.35, -2.3], Cq: [2.25, 2.1, -2.1], D: [-2.35, 1.75, 0.05], E: [0, 1.95, -0.05], F: [2.3, 1.7, 0.1], Gq: [-2.0, 2.25, 2.2], Hq: [0.15, 2.3, 2.15] };
    for (const k in poles) { const [x, h, z] = poles[k], w = (R() - 0.5) * 0.12; T.tube([[x + w, 0, z - w], [x, h * 0.55, z], [x, h + 0.18, z]], [0.065, 0.055, 0.045], 5, (px, py, pz, nx, ny, nz, i) => (Math.floor(py * 3) % 2 ? C.bamboo : C.bambooG)); lash(T, [x, h, z], 0.06); T.at([x + w, 0, z - w], [0, 0, 0], 1, () => rock(T, R, 0.12)); }
    const top = (k) => [poles[k][0], poles[k][1], poles[k][2]];
    // canopy 1: a patchwork of stretched leather, sagging in the middle
    { const a = top('A'), b = top('Bq'), c = top('E'), d = top('D'), n = 4, P = (u, w) => { const p = lerp3(lerp3(a, b, u), lerp3(d, c, u), w); p[1] -= Math.sin(PI * u) * Math.sin(PI * w) * 0.28; return p; };
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) T.quad(P(i / n, j / n), P((i + 1) / n, j / n), P((i + 1) / n, (j + 1) / n), P(i / n, (j + 1) / n), pick(R, [C.hide, 0xa8763a, C.hideD, 0x9a3a26, 0x8a5a30, C.hide, 0xc08a48])); }
    // canopy 2: banana leaves laid over a bamboo frame
    { const a = top('Bq'), b = top('Cq'), c = top('F'), d = top('E');
      for (const [p, q] of [[a, b], [b, c], [c, d], [d, a], [a, c]]) T.beam(p, q, 0.03, C.bamboo, 4);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { const u = (i + 0.5) / 6, p0 = lerp3(lerp3(a, b, u), lerp3(d, c, u), j ? 0.42 : -0.06), p1 = lerp3(lerp3(a, b, u), lerp3(d, c, u), j ? 1.1 : 0.58), sdv = sc3(norm(sub(b, a)), 0.42), mid = add(lerp3(p0, p1, 0.5), [0, 0.1 + j * 0.04, 0]), col = pick(R, LEAFROOF);
        T.quad(p0, add(mid, sdv), p1, mid, col, col, col, C.leafL); T.quad(p0, mid, p1, sub(mid, sdv), col, C.leafL, col, col); } }
    // canopy 3: a striped reed mat, higher at the front
    { const a = top('D'), b = top('E'), c = top('Hq'), d = top('Gq'), n = 9; for (let i = 0; i < n; i++) { const P = (u, w) => { const p = lerp3(lerp3(a, b, u), lerp3(d, c, u), w); p[1] -= Math.sin(PI * w) * 0.15; return p; }; for (let j = 0; j < 2; j++) T.quad(P(i / n, j / 2), P((i + 1) / n, j / 2), P((i + 1) / n, (j + 1) / 2), P(i / n, (j + 1) / 2), i % 4 === 1 ? 0xb8402a : i % 2 ? C.mat : C.thatchD); } }
    // guy ropes
    for (const [k, gx, gz] of [['A', -2.6, -2.6], ['Cq', 2.6, -2.55], ['Gq', -2.45, 2.6], ['F', 2.75, 0.5], ['Hq', 0.5, 2.6]]) { T.beam(top(k), [gx, 0, gz], 0.012, C.rope, 3); T.cyl(gx, 0, gz, 0.03, 0.02, 0.14, 4, C.woodD, 2); }
    const stall = (x, z, ry, w, d, fn) => T.at([x, 0, z], [0, ry, 0], 1, () => { T.box(0, 0.42, 0, w, 0.05, d, (px, py, pz, nx, ny, nz, i, j) => C.woodL, 0, 3); for (const sx of [-1, 1]) for (const sz of [-1, 1]) T.beam([sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06)], [sx * (w / 2 - 0.06), 0.42, sz * (d / 2 - 0.06)], 0.035, sx * sz > 0 ? C.bamboo : C.bambooG, 4); T.beam([-w / 2, 0.2, d / 2 - 0.06], [w / 2, 0.2, d / 2 - 0.06], 0.025, C.bambooD, 4); fn(w, d); });
    // stall 1 (under the leather): pots, rope and bone tools; smoked meats on a rail
    stall(-1.2, -1.35, 0.1, 1.7, 0.7, (w) => {
      for (let i = 0; i < 4; i++) T.at([-0.65 + i * 0.28, 0.47, -0.12 + (i % 2) * 0.1], [0, i, 0], 1, () => pot(T, 0.09 + (i % 2) * 0.03, 0.16 + (i % 3) * 0.05, [C.clay, C.clayD, C.teal, 0xd8a43a][i], 0x2a1c16, 5));
      T.at([0.55, 0.47, 0.05], [0, 0, 0], 1, () => coil(T, 0.15)); T.at([0.5, 0.47, -0.22], [0, 0.5, 0], 1, () => bone(T, 0.3)); T.at([0.2, 0.47, 0.22], [0, -0.3, 0], 1, () => bone(T, 0.24));
      T.beam([-w / 2, 0, -0.4], [-w / 2, 1.5, -0.4], 0.035, C.bamboo, 4); T.beam([w / 2, 0, -0.4], [w / 2, 1.5, -0.4], 0.035, C.bamboo, 4); T.beam([-w / 2 - 0.1, 1.45, -0.4], [w / 2 + 0.1, 1.45, -0.4], 0.03, C.woodD, 4);
      for (let i = 0; i < 6; i++) { const x = -0.7 + i * 0.28, len = 0.26 + (i % 3) * 0.06; T.beam([x, 1.45, -0.4], [x, 1.33, -0.4], 0.008, C.rope, 3); T.lathe(x, 1.33 - len, -0.4, [[0, 0], [0.085, len * 0.3], [0.06, len * 0.75], [0.02, len]], 5, (px, py, pz, nx, ny, nz, i2, j) => (j % 2 ? 0x9a3a2a : 0x7a2a22)); }
    });
    T.at([-2.0, 0, -0.75], [0, 0.4, 0], 1, () => pot(T, 0.2, 0.5, C.clayD)); T.at([-0.3, 0, -0.85], [0, 0, 0], 1, () => pot(T, 0.16, 0.36, C.clay, 0xd8c24a));
    // stall 2 (under the leaves): baskets of fruit
    stall(1.2, -1.3, -0.08, 1.7, 0.7, () => { for (let i = 0; i < 4; i++) T.at([-0.62 + i * 0.42, 0.47, (i % 2) * 0.08 - 0.02], [0, i, 0], 1, () => basket(T, R, 0.17, 0.14, FRUIT[i], 7)); });
    for (let i = 0; i < 3; i++) T.at([0.55 + i * 0.5, 0, -0.62], [0, i * 2, 0], 1, () => basket(T, R, 0.21, 0.2, FRUIT[(i + 3) % 6], 8));
    T.at([2.05, 0, -0.75], [0, 0, 0], 1, () => heap(T, R, 9, 0.11, [0x7a5632, 0x6a4a2a, 0x86a83a], 0.9));
    // stall 3 (under the mat): feathers in jars, hides, bone tools
    stall(-1.15, 1.05, 0.05, 1.6, 0.7, () => {
      for (let i = 0; i < 3; i++) T.at([-0.6 + i * 0.3, 0.47, -0.1], [0, i, 0], 1, () => { pot(T, 0.07, 0.13, i % 2 ? C.clay : C.teal, C.black, 5); T.at([0, 0.12, 0], [0, i * 1.3, 0], 1, () => feathers(T, 4, 0.38, [[C.red, C.yellow, C.orange, C.red], [C.teal, C.blue, C.white, C.teal], [C.pink, C.purple, C.yellow, C.pink]][i], 1.3)); });
      for (let i = 0; i < 3; i++) T.box(0.45, 0.47 + i * 0.035, 0.0, 0.5 - i * 0.05, 0.035, 0.42 - i * 0.04, [C.hide, C.hideL, C.fur][i], i * 0.2, 3);
      T.at([-0.1, 0.47, 0.2], [0, 0.3, 0], 1, () => bone(T, 0.28)); T.at([-0.45, 0.47, 0.22], [0, -0.2, 0], 1, () => bone(T, 0.2, 0.02));
    });
    T.at([-2.05, 0, 1.6], [0, 0, 0], 1, () => { T.box(0, 0, 0, 0.5, 0.3, 0.4, C.hide, 0.3, 3); T.box(0.03, 0.3, 0, 0.42, 0.08, 0.34, C.hideL, 0.5, 3); T.at([0, 0.38, 0], [0, 0.3, 0], 1, () => coil(T, 0.16)); });
    // the open corner: crates and baskets heaped in the sun
    T.at([1.2, 0, 1.3], [0, 0, 0], 1, () => { crate(T, 0.6, 0.45, 0.5, 0.2); T.at([0, 0.45, 0], [0, 0.2, 0], 1, () => heap(T, R, 8, 0.1, FRUIT[0], 0.8)); });
    T.at([1.85, 0, 1.05], [0, 0, 0], 1, () => { crate(T, 0.55, 0.5, 0.5, -0.3); T.at([0, 0.5, 0], [0, 0, 0], 1, () => crate(T, 0.42, 0.3, 0.4, 0.5)); });
    T.at([0.75, 0, 1.95], [0, 0, 0], 1, () => crate(T, 0.5, 0.36, 0.5, 0.6));
    out.monkey = [0.75, 0.36, 1.95];
    for (let i = 0; i < 4; i++) T.at([1.35 + (i % 2) * 0.55 + (i > 1 ? 0.2 : 0), 0, 1.85 + Math.floor(i / 2) * 0.45], [0, i, 0], 1, () => basket(T, R, 0.2, 0.18, FRUIT[(i + 1) % 6], 8));
    T.at([2.2, 0, 0.6], [0, 0, 0], 1, () => heap(T, R, 8, 0.11, [0x7a5632, 0x6a4a2a], 0.8));
    T.at([0.55, 0, 0.55], [0, 0, 0], 1, () => { pot(T, 0.22, 0.55, C.clay, 0x3a8ad8); }); T.at([0.95, 0, 0.35], [0, 1, 0], 1, () => pot(T, 0.15, 0.4, 0xd8a43a));
    // a bunch of bananas hung from the mat pole, and the bird perch
    T.at([0.15, 1.75, 2.0], [0, 0, 0], 1, () => { for (let t = 0; t < 3; t++) for (let j = 0; j < 5; j++) { const a = j * 1.256 + t; T.tube([[Math.cos(a) * 0.04, -t * 0.12, Math.sin(a) * 0.04], [Math.cos(a) * 0.12, -t * 0.12 - 0.03, Math.sin(a) * 0.12], [Math.cos(a) * 0.13, -t * 0.12 + 0.09, Math.sin(a) * 0.13]], [0.035, 0.04, 0.012], 3, C.yellow); } });
    const px = 2.15, pz = 2.1;
    T.tube([[px, 0, pz], [px + 0.03, 0.8, pz], [px, 1.55, pz]], [0.055, 0.045, 0.04], 5, C.driftD); T.tube([[px - 0.4, 1.5, pz], [px, 1.56, pz], [px + 0.4, 1.52, pz]], 0.03, 4, C.drift, { cap: 3 }); T.at([px, 0, pz], [0, 0, 0], 1, () => rock(T, R, 0.14));
    out.macaws = [[px - 0.27, 1.55, pz, -0.4], [px + 0.25, 1.55, pz, 0.5]];
    out.solid = T.geo();
    return out;
  });
}
/** an open-air market 5 x 5 under three canopies, with two macaws on a perch and a monkey on a crate (userData.animals) */
scenery.market = (seed) => {
  const s = seedOf(seed), v = s % 2, G = marketGeo(v);
  const animals = [...G.macaws.map(([x, y, z, ry], i) => makeMacaw(s * 3 + i + (i ? 1 : 0), [x, y, z], ry, 1.5)), makeMonkey(s + 1, G.monkey, 0.5, 1.3)];
  return piece('market', v, G, animals, { animals });
};

function cookGeo(v) {
  return cached(`cook:${v}`, () => {
    const R = rng(v * 83 + 27), T = new B(0.08), G = new B(0);
    // the lean-to: tall posts in front, thatch falling to the back
    for (const sx of [-1, 1]) { T.tube([[sx * 1.25, 0, -0.9], [sx * 1.25, 1.3, -0.9]], 0.06, 5, woodC(C.drift, C.driftD)); T.tube([[sx * 1.25, 0, 0.2], [sx * 1.27, 2.08, 0.2]], 0.065, 5, woodC(C.drift, C.driftD)); T.beam([sx * 1.25, 1.22, -1.05], [sx * 1.27, 2.08, 0.36], 0.045, C.bamboo, 4); lash(T, [sx * 1.27, 1.95, 0.2], 0.065); }
    T.beam([-1.4, 2.03, 0.2], [1.4, 2.03, 0.2], 0.045, C.bambooG, 4); T.beam([-1.4, 1.25, -0.9], [1.4, 1.25, -0.9], 0.045, C.bambooG, 4);
    thatch(T, R, [-1.45, 1.14, -1.15], [1.45, 1.14, -1.15], [1.45, 2.2, 0.42], [-1.45, 2.2, 0.42], 4, 12, { bulge: 0.06 });
    // drying rack of fish under the roof, firewood stacked beside it
    for (const x of [-1.05, 0.15]) T.beam([x, 0, -0.55], [x, 1.05, -0.55], 0.035, C.woodD, 4);
    T.beam([-1.12, 1.0, -0.55], [0.22, 1.0, -0.55], 0.03, C.wood, 4);
    for (let i = 0; i < 6; i++) T.at([-0.95 + i * 0.2, 0.96, -0.55 + (i % 2) * 0.03], [0, (i % 2) * 0.5, 0], 1.25, () => fish(T, i % 3 ? 0xc8ccd0 : 0xd8a86a));
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) T.tube([[0.5 + i * 0.19 + r * 0.095, 0.09 + r * 0.16, -1.0], [0.5 + i * 0.19 + r * 0.095, 0.09 + r * 0.16, -0.35]], 0.09, 5, woodC(pick(R, [C.bark, C.wood]), C.barkD), { cap: 2, capCol: C.woodL, rot: R() });
    // the cauldron on its tripod over the embers, out in the open
    const cx = -0.35, cz = 0.72;
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; T.tube([[cx + Math.cos(a) * 0.62, 0, cz + Math.sin(a) * 0.62], [cx + Math.cos(a) * 0.04, 1.55, cz + Math.sin(a) * 0.04]], [0.06, 0.045], 5, woodC(C.woodD, C.barkD), { cap: 2 }); }
    lash(T, [cx, 1.42, cz], 0.09); T.beam([cx, 1.4, cz], [cx, 0.86, cz], 0.014, C.soot, 3);
    T.lathe(cx, 0.3, cz, [[0.12, 0], [0.3, 0.14], [0.34, 0.34], [0.29, 0.48], [0.33, 0.54]], 8, (x, y, z, nx, ny, nz, i) => (i === 3 ? 0x3a3632 : C.soot));
    T.cyl(cx, 0.8, cz, 0.001, 0.29, 0.001, 8, 0x8a9a3a, 0); T.beam([cx + 0.1, 0.8, cz], [cx + 0.42, 1.08, cz + 0.12], 0.018, C.woodL, 3);
    for (const sd of [-1, 1]) T.beam([cx + sd * 0.31, 0.82, cz], [cx, 0.9, cz], 0.012, C.soot, 3);
    firepit(T, G, R, cx, 0, cz, 0.36);
    // chopping block with a cleaver, and the bone pile
    T.at([0.85, 0, 0.6], [0, 0, 0], 1, () => { T.cyl(0, 0, 0, 0.21, 0.19, 0.34, 7, woodC(C.bark, C.barkD), 2, 0, C.woodL); T.quad([-0.08, 0.34, 0.02], [0.1, 0.34, 0.0], [0.12, 0.52, 0.03], [-0.05, 0.5, 0.05], C.stone); T.beam([0.1, 0.5, 0.03], [0.27, 0.6, 0.05], 0.02, C.woodD, 3); T.box(-0.08, 0.34, -0.08, 0.14, 0.05, 0.1, 0xb04a3a, 0.4, 3); });
    T.at([1.1, 0, 1.0], [0, 0, 0], 1, () => { for (let i = 0; i < 5; i++) T.at([(R() - 0.5) * 0.4, i * 0.02, (R() - 0.5) * 0.3], [0, R() * PI, (R() - 0.5) * 0.4], 1, () => bone(T, 0.2 + R() * 0.14)); for (let i = 0; i < 3; i++) T.tube(curve([[-0.1 + i * 0.08, 0.02, -0.12], [-0.1 + i * 0.08, 0.2, -0.02], [-0.1 + i * 0.08, 0.04, 0.12]], 2), 0.014, 3, C.bone); T.at([0.14, 0.12, 0.1], [0.2, 0.7, 0], 1.3, () => skull(T, C.boneD)); });
    T.at([-1.05, 0, 0.75], [0, 0, 0], 1, () => basket(T, R, 0.2, 0.2, FRUIT[4], 7));
    return { solid: T.geo(), glow: G.geo(), fire: [cx, 0.06, cz], steam: [cx, 0.85, cz] };
  });
}
/** the cookhouse: a lean-to open toward +Z with the cauldron out in front */
scenery.cookhouse = (seed) => { const s = seedOf(seed), v = s % 2, R = rng(s * 13 + 28), G = cookGeo(v); return piece('cookhouse', v, G, [fireAt(G.fire, 0.3, R), ...smokeAt(G.steam, 1.5, 0.2, 3, R, 0.3, -0.1, 0.2)]); };

function barracksGeo(v) {
  return cached(`barracks:${v}`, () => {
    const R = rng(v * 89 + 31), T = new B(0.08), xs = [-2.3, -0.77, 0.77, 2.3], zf = 0.3, zb = -0.95, zr = -0.32;
    for (const x of xs) { T.tube([[x, 0, zf], [x, 1.22, zf]], 0.055, 5, woodC(C.drift, C.driftD)); T.tube([[x, 0, zb], [x, 1.22, zb]], 0.055, 5, woodC(C.drift, C.driftD)); T.beam([x, 1.2, zb - 0.1], [x, 1.9, zr], 0.035, C.bamboo, 4); T.beam([x, 1.2, zf + 0.1], [x, 1.9, zr], 0.035, C.bamboo, 4); }
    T.beam([-2.45, 1.9, zr], [2.45, 1.9, zr], 0.05, C.woodD, 4);
    thatch(T, R, [-2.55, 1.12, zf + 0.22], [2.55, 1.12, zf + 0.22], [2.45, 1.98, zr], [-2.45, 1.98, zr], 3, 18, { bulge: 0.05 });
    thatch(T, R, [2.55, 1.12, zb - 0.2], [-2.55, 1.12, zb - 0.2], [-2.45, 1.98, zr], [2.45, 1.98, zr], 3, 18, { bulge: 0.05 });
    // reed screens: rolled up along the front, let down along the back
    for (let b = 0; b < 3; b++) { const x0 = xs[b] + 0.1, x1 = xs[b + 1] - 0.1; T.tube([[x0, 1.08, zf + 0.02], [x1, 1.08, zf + 0.02]], 0.085, 6, (x, y, z, nx, ny, nz, i, j) => (j % 2 ? C.mat : C.thatchD), { cap: 3 }); for (const u of [0.2, 0.8]) T.at([lerp(x0, x1, u), 1.08, zf + 0.02], [0, 0, PI / 2], 1, () => T.cyl(0, -0.02, 0, 0.095, 0.095, 0.04, 5, C.red, 0));
      if (b !== 1 - v) for (let q = 0; q < 4; q++) T.quad([lerp(x0, x1, q / 4), 0.08, zb], [lerp(x0, x1, (q + 1) / 4), 0.08, zb], [lerp(x0, x1, (q + 1) / 4), 1.15, zb], [lerp(x0, x1, q / 4), 1.15, zb], q % 2 ? C.mat : C.thatchD); }
    for (let i = 0; i < 4; i++) T.box(-1.75 + i * 1.15, 0.01, -0.35, 0.5, 0.03, 0.95, [C.red, C.mat, C.teal, C.mat][i], (R() - 0.5) * 0.2, 3);   // sleeping mats
    // outside: a rack of shields, a rack of spears, clubs and blowpipes, and the straw target
    const rack = (x0, x1, z) => { for (const x of [x0, x1]) { T.beam([x, 0, z - 0.18], [x, 0.85, z], 0.03, C.woodD, 4); T.beam([x, 0, z + 0.18], [x, 0.85, z], 0.03, C.woodD, 4); } T.beam([x0 - 0.08, 0.82, z], [x1 + 0.08, 0.82, z], 0.03, C.wood, 4); };
    rack(-2.2, -0.75, 0.85);
    for (let i = 0; i < 5; i++) T.at([-2.05 + i * 0.3, 0, 1.08], [-0.35, 0, 0], 1.15, () => shield(T, i + v));
    rack(-0.3, 1.0, 0.85);
    for (let i = 0; i < 5; i++) T.at([-0.2 + i * 0.16, 0, 1.12], [-0.2, 0, (i - 2) * 0.03], 1, () => spear(T, 1.5 + (i % 2) * 0.12));
    for (let i = 0; i < 2; i++) T.at([0.68 + i * 0.13, 0, 1.12], [-0.22, 0, 0], 1, () => { T.beam([0, 0, 0], [0, 0.7, 0], 0.025, C.woodD, 4); T.ball(0, 0.78, 0, 0.07, 0.11, 0.07, C.wood, 5, 2); T.cyl(0, 0.62, 0, 0.035, 0.035, 0.05, 4, C.red, 0); });
    for (let i = 0; i < 2; i++) T.at([0.4 + i * 0.1, 0, 0.62], [0.3, 0, 0.02], 1, () => { T.beam([0, 0, 0], [0, 1.55, 0], 0.02, C.bambooG, 4); T.cyl(0, 1.2, 0, 0.03, 0.03, 0.08, 4, C.teal, 0); });
    T.at([1.85, 0, 0.95], [0, -0.35, 0], 1, () => {
      for (const [x, z] of [[-0.3, 0.12], [0.3, 0.12], [0, -0.4]]) T.beam([x, 0, z], [x * 0.2, 1.0, -0.04], 0.03, C.woodD, 4);
      T.at([0, 0.62, 0.06], [PI / 2 - 0.2, 0, 0], 1, () => { T.cyl(0, 0, 0, 0.42, 0.42, 0.14, 10, (x, y, z, nx, ny, nz, i, j) => (j % 2 ? C.thatch : C.thatchD), 3, 0, C.thatchL); T.cyl(0, 0.142, 0, 0.3, 0.3, 0.004, 10, C.white, 2); T.cyl(0, 0.146, 0, 0.2, 0.2, 0.004, 8, C.red, 2); T.cyl(0, 0.15, 0, 0.09, 0.09, 0.004, 6, C.black, 2);
        for (const [ax, az] of [[0.05, 0.06], [-0.16, -0.1]]) { T.beam([ax, 0.14, az], [ax + 0.03, 0.5, az + 0.03], 0.012, C.woodL, 3); T.tri([ax + 0.03, 0.5, az + 0.03], [ax + 0.09, 0.44, az + 0.03], [ax + 0.03, 0.4, az + 0.03], C.red); } });
    });
    return { solid: T.geo() };
  });
}
/** the warriors' shelter, 5 along X; racks of arms and the archery target stand out front (+Z) */
scenery.barracks = (seed) => { const s = seedOf(seed), v = s % 2; return piece('barracks', v, barracksGeo(v)); };

function penGeo(v) {
  return cached(`pen:${v}`, () => {
    const R = rng(v * 97 + 33), T = new B(0.08), rad = 1.62, n = 24, gate = [5, 6];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + PI / 2 - (5.5 / n) * TAU, x = Math.cos(a) * rad, z = Math.sin(a) * rad, isGate = gate.includes(i), h = isGate ? 0.5 : 0.78 + R() * 0.3, c = pick(R, [C.bark, C.barkD, C.wood, C.woodD]);
      if (isGate) continue;
      T.tube([[x, -0.02, z], [x * (1 + (R() - 0.5) * 0.05), h, z * (1 + (R() - 0.5) * 0.05)]], [0.15, 0.13], 5, (px, py, pz, nx, ny, nz, i2, j) => (j % 2 ? c : mul(c, 0.8)), { cap: 2, capCol: C.woodL, rot: R() });
    }
    for (const y of [0.3, 0.62]) for (let i = 0; i < n; i++) { if (i === 5) continue; const a0 = (i / n) * TAU + PI / 2 - (5.5 / n) * TAU, a1 = a0 + TAU / n, r = rad + 0.16; T.quad([Math.cos(a0) * r, y - 0.035, Math.sin(a0) * r], [Math.cos(a1) * r, y - 0.035, Math.sin(a1) * r], [Math.cos(a1) * r, y + 0.035, Math.sin(a1) * r], [Math.cos(a0) * r, y + 0.035, Math.sin(a0) * r], i % 2 ? C.vine : 0x6a7a2a); if (i % 3 === 0) T.tri([Math.cos(a0) * r, y, Math.sin(a0) * r], [Math.cos(a0) * (r + 0.1), y + 0.1, Math.sin(a0) * (r + 0.1)], [Math.cos(a0 + 0.06) * (r + 0.05), y - 0.08, Math.sin(a0 + 0.06) * (r + 0.05)], C.leafL); }
    for (const y of [0.28, 0.58]) T.beam([-0.36, y, rad + 0.02], [0.36, y + 0.03, rad + 0.02], 0.04, C.drift, 4);   // the gate bars
    // the wallow, the trough and the lean-to
    const mud = [], wet = []; for (let j = 0; j < 9; j++) { const a = (j / 9) * TAU, r = 0.72 + R() * 0.2; mud.push([-0.35 + Math.cos(a) * r, 0.015, 0.3 + Math.sin(a) * r * 0.8]); wet.push([-0.35 + Math.cos(a) * r * 0.55, 0.02, 0.3 + Math.sin(a) * r * 0.45]); }
    T.fan([-0.35, 0.015, 0.3], mud, C.mud, C.mudW); T.fan([-0.35, 0.022, 0.3], wet, 0x6a4a30, 0x8a6a48);
    T.at([0.85, 0, 0.55], [0, 0.5, 0], 1, () => { T.box(0, 0, 0, 0.9, 0.2, 0.3, woodC(C.wood, C.woodD), 0, 2, 1.12); T.box(0, 0.19, 0, 0.84, 0.02, 0.24, 0x9a9a3a, 0, 2); for (let i = 0; i < 4; i++) T.ball(-0.3 + i * 0.2, 0.22, (i % 2) * 0.06 - 0.03, 0.05, 0.04, 0.05, FRUIT[i][0], 4, 2); for (const sx of [-1, 1]) T.box(sx * 0.4, 0, 0, 0.12, 0.12, 0.36, C.barkD, 0, 2); });
    for (const sx of [-1, 1]) T.tube([[sx * 0.7, 0, -0.55], [sx * 0.7, 1.22, -0.55]], 0.055, 5, woodC(C.drift, C.driftD));
    T.beam([-0.85, 1.2, -0.55], [0.85, 1.2, -0.55], 0.04, C.bamboo, 4);
    thatch(T, R, [-0.95, 0.82, -1.72], [0.95, 0.82, -1.72], [0.95, 1.3, -0.4], [-0.95, 1.3, -0.4], 3, 8, { pal: v ? LEAFROOF : THATCH, bulge: 0.05 });
    for (let i = 0; i < 6; i++) T.tri([-0.6 + i * 0.22, 0.02, -1.3 + (i % 2) * 0.3], [-0.4 + i * 0.22, 0.02, -0.9 + (i % 3) * 0.1], [-0.55 + i * 0.22, 0.09, -0.8], pick(R, THATCH));   // straw
    return { solid: T.geo() };
  });
}
/** a round corral 3.6 across with a wallow, a trough, a lean-to and two boars (userData.animals); the gate faces +Z */
scenery.boarPen = (seed) => {
  const s = seedOf(seed), v = s % 2, R = rng(s * 13 + 30), G = penGeo(v);
  const animals = [makeBoar(s * 5 + 1, [-0.35, 0.02, 0.3], 0.7 + R() * 0.6, 1.05), makeBoar(s * 5 + 2, [0.55, 0, -0.1], 1.9 + R() * 0.5, 0.95)];
  return piece('boarPen', v, G, animals, { animals });
};
// =====================================================================================
// ANIMATION: every moving part carries userData.jg = { k, p, r, s, ph, rate, ... } (plain numbers)
// =====================================================================================
const P3 = (a, i, d = 0) => (Array.isArray(a) ? N(a[i], d) : d);
const ANIM = {
  sway(o, d, t) {
    const w = t * N(d.rate, 1) + N(d.ph), ax = N(d.ax, 0.05), az = N(d.az, 0.05), ay = N(d.ay);
    o.rotation.set(P3(d.r, 0) + Math.sin(w) * ax + Math.sin(w * 2.3 + 1) * ax * 0.35, P3(d.r, 1) + Math.sin(w * 0.7 + 2) * ay, P3(d.r, 2) + Math.cos(w * 0.83) * az + Math.sin(w * 1.9) * az * 0.3);
  },
  flame(o, d, t) {
    const ph = N(d.ph), s = N(d.s, 1), f = 0.85 + 0.22 * Math.sin(t * 13 + ph) + 0.14 * Math.sin(t * 23.7 + ph * 2);
    o.scale.set(s * (1 + 0.1 * Math.sin(t * 17 + ph)), s * f, s * (1 + 0.1 * Math.sin(t * 19 + ph)));
    o.rotation.y = P3(d.r, 1) + Math.floor(t * 9 + ph) * 2.4;
  },
  smoke(o, d, t) {
    const ph = N(d.ph), u = frac(t * N(d.rate, 0.2) + ph), s = N(d.s, 1), k = Math.sin(PI * u) ** 0.6 * (0.4 + u * 1.2);
    o.position.set(P3(d.p, 0) + N(d.dx) * u + Math.sin(t * 0.9 + ph * 9) * 0.06 * u, P3(d.p, 1) + N(d.h, 1) * u, P3(d.p, 2) + N(d.dz) * u + Math.cos(t * 0.7 + ph * 5) * 0.06 * u);
    o.scale.setScalar(Math.max(1e-4, s * k)); o.rotation.y = u * 3 + ph * 7;
  },
  flag(o, d, t) {
    const w = t * N(d.rate, 1) + N(d.ph), a = N(d.amp, 1);
    o.rotation.set(P3(d.r, 0) + Math.sin(w * 3.1) * 0.05 * a, P3(d.r, 1) + (Math.sin(w * 2.1) * 0.3 + Math.sin(w * 5.3) * 0.08) * a, P3(d.r, 2) + Math.sin(w * 1.7) * 0.04 * a);
  },
  boar(o, d, t, pt) {
    const rate = N(d.rate, 1), ph = N(d.ph), w = t * rate + ph, s = N(d.s, 1), root = smooth(Math.sin(w * 0.35) * 1.6 + 0.4);
    o.position.set(P3(d.p, 0) + Math.sin(w * 0.47) * 0.035 * s, P3(d.p, 1) + Math.abs(Math.sin(w * 3)) * 0.008 * s * root, P3(d.p, 2) + Math.sin(w * 0.31 + 1) * 0.05 * s);
    o.rotation.set(root * 0.04, P3(d.r, 1) + Math.sin(w * 0.23) * 0.22, Math.sin(w * 3) * 0.025);
    if (pt.head) pt.head.rotation.set(0.08 + root * (0.42 + 0.12 * Math.sin(w * 6.3)), Math.sin(w * 0.9) * 0.3 * (1 - root) + root * Math.sin(w * 3.1) * 0.16, 0);
  },
  macaw(o, d, t, pt) {
    const rate = N(d.rate, 1), ph = N(d.ph), pc = frac(t * 0.085 * rate + ph * 0.37), pr = pulse(pc, 0, 0.3), sd = Math.floor(t * 0.085 * rate + ph * 0.37) % 2 ? 1 : -1;
    const fl = pulse(frac(t * 0.12 * rate + ph * 0.61), 0, 0.16), beat = Math.sin(t * 22 + ph);
    o.position.set(P3(d.p, 0), P3(d.p, 1) + fl * 0.03 * N(d.s, 1), P3(d.p, 2));
    o.rotation.set(-fl * 0.2 + Math.sin(t * 0.6 * rate + ph) * 0.05, P3(d.r, 1) + Math.sin(t * 0.21 * rate + ph * 2) * 0.25, 0);
    if (pt.head) pt.head.rotation.set(pr * 0.55 + (1 - pr) * Math.sin(t * 1.3 + ph) * 0.1, pr * 1.9 * sd + (1 - pr) * Math.sin(t * 0.7 * rate + ph * 1.7) * 0.6, pr * 0.3 * sd);
    const f = 0.04 + fl * (1.25 + 0.55 * beat);
    if (pt.wingL) pt.wingL.rotation.set(0, 0, f);
    if (pt.wingR) pt.wingR.rotation.set(0, 0, -f);
  },
  monkey(o, d, t, pt) {
    const rate = N(d.rate, 1), ph = N(d.ph), w = t * rate + ph, s = N(d.s, 1), sc = pulse(frac(t * 0.1 * rate + ph * 0.43), 0, 0.3), reach = d.reach ? 1 : 0;
    o.position.set(P3(d.p, 0), P3(d.p, 1) + Math.abs(Math.sin(w * 2.2)) * 0.012 * s, P3(d.p, 2));
    o.rotation.set(Math.sin(w * 1.1) * 0.05, P3(d.r, 1) + Math.sin(w * 0.27) * 0.3, Math.sin(w * 2.2) * 0.04);
    if (pt.head) pt.head.rotation.set(Math.sin(w * 0.9) * 0.15 - reach * 0.25, Math.sin(w * 0.53 + 1) * 0.7, Math.sin(w * 1.7) * 0.08);
    if (pt.armR) pt.armR.rotation.set(-sc * (1.9 + 0.3 * Math.sin(t * 19)), 0, -sc * 0.5);
    if (pt.armL) pt.armL.rotation.set(reach ? -2.5 + Math.sin(w * 1.3) * 0.3 : Math.sin(w * 0.8) * 0.08, 0, reach ? 0.25 + Math.sin(w * 0.9) * 0.15 : 0);
    if (pt.tail) pt.tail.rotation.set(Math.sin(w * 1.4) * 0.12, Math.sin(w * 0.9) * 0.35, 0);
  },
  croc(o, d, t, pt) {
    const rate = N(d.rate, 1), ph = N(d.ph), s = N(d.s, 1), jw = pulse(frac(t * 0.05 * rate + ph * 0.29), 0, 0.32);
    o.position.set(P3(d.p, 0) + Math.sin(t * 0.17 * rate + ph) * 0.08 * s, P3(d.p, 1) + Math.sin(t * 0.5 + ph) * 0.012 * s + jw * 0.02 * s, P3(d.p, 2) + Math.sin(t * 0.11 * rate + ph * 2) * 0.12 * s);
    o.rotation.set(-jw * 0.05, P3(d.r, 1) + Math.sin(t * 0.13 * rate + ph) * 0.1, 0);
    if (pt.jaw) pt.jaw.rotation.set(-jw * 0.55, 0, 0);
    if (pt.tail) pt.tail.rotation.set(0, Math.sin(t * 0.6 * rate + ph) * 0.25, 0);
  },
  frog(o, d, t, pt) {
    const rate = N(d.rate, 1), ph = N(d.ph), s = N(d.s, 1), call = smooth(Math.sin(t * 0.4 * rate + ph) * 2), pf = call * Math.max(0, Math.sin(t * 5.5 * rate + ph)) ** 2;
    o.scale.set(s, s * (1 + 0.04 * Math.sin(t * 2.2 + ph) + pf * 0.03), s);
    o.rotation.set(0, P3(d.r, 1) + Math.sin(t * 0.19 * rate + ph * 3) * 0.2, 0);
    if (pt.throat) pt.throat.scale.setScalar(1 + pf * 1.3);
  },
  snake(o, d, t) {
    const w = t * N(d.rate, 1) + N(d.ph);
    o.rotation.set(Math.sin(w * 0.53) * 0.16, Math.sin(w * 0.8) * 0.5, Math.sin(w * 0.67 + 1) * 0.12);
  },
  spider(o, d, t) {
    const rate = N(d.rate, 1), ph = N(d.ph), tw = pulse(frac(t * 0.21 * rate + ph * 0.31), 0, 0.1);
    o.position.set(P3(d.p, 0) + Math.sin(t * 0.13 * rate + ph) * 0.03, P3(d.p, 1) + Math.sin(t * 0.17 * rate + ph * 2) * 0.05 + Math.sin(t * 37) * 0.006 * tw, P3(d.p, 2));
    o.rotation.set(0, 0, Math.sin(t * 0.3 * rate + ph) * 0.15 + Math.sin(t * 41 + ph) * 0.1 * tw);
    o.scale.set(1 + tw * 0.06 * Math.sin(t * 29), 1 - tw * 0.05 * Math.sin(t * 29), 1);
  },
};
const found = new WeakMap();
function collect(obj) {
  const list = [];
  obj.traverse((o) => {
    const d = o.userData && o.userData.jg;
    if (!d || typeof d !== 'object' || typeof ANIM[d.k] !== 'function') return;
    const parts = {};
    for (const ch of o.children) { const p = ch.userData && ch.userData.part; if (typeof p === 'string') parts[p] = ch; }
    list.push({ o, d, parts });
  });
  return list;
}
/** per-frame life for a piece of jungle scenery (or any object holding some): a pure function of t; anything it does not know is left alone */
export function animateScenery(obj, t) {
  if (!obj || !obj.isObject3D) return;
  t = N(Number(t), 0);
  let list = found.get(obj);
  if (!list) found.set(obj, list = collect(obj));
  for (let i = 0; i < list.length; i++) { const e = list[i]; ANIM[e.d.k](e.o, e.d, t, e.parts); }
}
