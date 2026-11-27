// Island scenery for four climates of the sea-battle view: temperate (green northern islands), desert (arid coasts),
// swamp (drowned, misty islands) and volcanic (ash-black islands).
//
//   scenery[key](seed)        -> a THREE.Object3D, y = 0 at the ground (or at the water surface for swamp pieces that
//                                stand in water), origin at the centre of the footprint, sized in map tiles at scale 1
//   animateScenery(obj, t)    -> cheap idle life driven only by userData; a no-op for anything it does not know
//
// Everything is low-poly, flat-shaded and vertex-coloured. Geometry is built once per key and variant and shared by
// every instance; five shared materials cover the whole file (matt, glossy, steady glow, pulsing lava, light beam).
// Long things (boats, the wreck, the alligator, the lava flow, the stone wall) run along X; animals face +Z.
//
// Handles for the game sit on the root's userData (lamp, sails, animals, birds, motes, lava, smoke, ...). They are
// non-enumerable, so Object3D.clone() does not try to serialise them; animateScenery(clone, t) puts them back on a
// clone the first time it sees it (the moving parts are found again through each child's plain userData.role).
import * as THREE from 'three';

const PI = Math.PI, TAU = PI * 2;
const _c = new THREE.Color(), _c2 = new THREE.Color();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const frac = (v) => v - Math.floor(v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const fin0 = (v) => (Number.isFinite(v) ? v : 0);
function mix(a, b, t) { return _c.set(a).lerp(_c2.set(b), clamp(t, 0, 1)).getHex(); }
function tone(hex, dl = 0, ds = 0, dh = 0) { return _c.set(hex).offsetHSL(dh, ds, dl).getHex(); }
function hash(x, y = 0, z = 0) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + 1.3) * 43758.5453; return s - Math.floor(s); }
function pulse(c, a, b) { if (c <= a || c >= b) return 0; const u = (c - a) / (b - a); return Math.sin(u * PI) ** 2; }
const seedOf = (seed) => { const n = Math.floor(num(Number(seed), 0)); return Number.isFinite(n) ? Math.abs(n) % 1000003 : 0; };
function rng(seed) { let s = (seedOf(seed) * 2654435761 + 97) >>> 0; return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; s ^= s >>> 13; return ((Math.imul(s, 3266489909) >>> 0) / 4294967296); }; }
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mean = (r) => { const m = [0, 0, 0]; for (const q of r) { m[0] += q[0] / r.length; m[1] += q[1] / r.length; m[2] += q[2] / r.length; } return m; };

const geoCache = new Map();
function cached(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const icoCache = new Map();
function unitSolid(kind) {
  if (!icoCache.has(kind)) {
    const d = +kind[1], g = kind[0] === 'o' ? new THREE.OctahedronGeometry(1, d) : new THREE.IcosahedronGeometry(1, d), p = (g.index ? g.toNonIndexed() : g).attributes.position, out = [];
    for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
    icoCache.set(kind, out);
  }
  return icoCache.get(kind);
}
function trs(x = 0, y = 0, z = 0, ry = 0, s = 1, rx = 0, rz = 0) {
  const sc = Array.isArray(s) ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(s, s, s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), sc);
}

/**
 * Collects coloured flat triangles. A colour is a hex or a function (centre, normal, localCentre) -> hex. Faces given a
 * reference point inside the solid are wound to face away from it; loose faces are wound to face up. A little light is
 * baked into every face (tops lighter, undersides darker, a touch of per-face jitter) unless `bake` is 0.
 */
class Tris {
  constructor(bake = 1) { this.p = []; this.c = []; this.M = null; this.bake = bake; }
  get count() { return this.p.length / 9; }
  /** run fn with a transform applied to everything it adds */
  xf(m, fn) { const prev = this.M; this.M = prev ? prev.clone().multiply(m) : m; fn(this); this.M = prev; return this; }
  at(x, y, z, ry, s, rx, rz, fn) { return this.xf(trs(x, y, z, ry, s, rx, rz), fn); }
  _v(a) { if (!this.M) return a; const e = this.M.elements, x = a[0], y = a[1], z = a[2]; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; }
  face(a, b, c, col, ref) {
    const A = this._v(a); let B = this._v(b), C = this._v(c);
    const cr = vcross(vsub(B, A), vsub(C, A)), l = Math.hypot(cr[0], cr[1], cr[2]);
    if (!(l > 1e-10)) return this;
    let n = [cr[0] / l, cr[1] / l, cr[2] / l];
    const m = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    let flip = n[1] < 0;
    if (ref) { const d = vdot(n, vsub(m, this._v(ref))); if (Math.abs(d) > 1e-6) flip = d < 0; }
    if (flip) { const t = B; B = C; C = t; n = [-n[0], -n[1], -n[2]]; }
    const hex = typeof col === 'function' ? col(m, n, [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]) : col;
    if (hex === null || hex === undefined) return this;   // a colour function may drop a face
    _c.set(hex);
    const f = this.bake ? 1 + this.bake * (0.14 * n[1] - 0.05 + 0.04 * n[2] - 0.03 * n[0] + (hash(m[0] * 3.1, m[1] * 3.7, m[2] * 2.9) - 0.5) * 0.07) : 1;
    this.p.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    for (let i = 0; i < 3; i++) this.c.push(_c.r * f, _c.g * f, _c.b * f);
    return this;
  }
  quad(a, b, c, d, col, ref) { return this.face(a, b, c, col, ref).face(a, c, d, col, ref); }
  /** a lump from a stack of rings (any consistent direction), optionally capped */
  stack(rings, col, capTop = true, capBot = false) {
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i], B = rings[i + 1], n = A.length, ref = mean([...A, ...B]);
      for (let j = 0; j < n; j++) { const k = (j + 1) % n; this.face(A[j], B[k], A[k], col, ref); this.face(A[j], B[j], B[k], col, ref); }
    }
    const cap = (r, other) => { const m = mean(r), ref = other ? mean(other) : vsub(m, [0, 1, 0]); for (let j = 0; j < r.length; j++) this.face(m, r[j], r[(j + 1) % r.length], col, ref); };
    if (capTop) cap(rings[rings.length - 1], rings[rings.length - 2]);
    if (capBot) cap(rings[0], rings[1]);
    return this;
  }
  /** rings round the Y axis: prof = [[radius, y], ...]; o = { x, z, sx, sz, a0, mod(j, i, a) -> radius factor, lean(y) -> [dx, dz], capTop, capBot } */
  lathe(prof, n, col, o = {}) {
    const { x = 0, z = 0, sx = 1, sz = 1, a0 = 0, mod = null, lean = null, capTop = true, capBot = false } = o;
    const rings = prof.map(([r, y], i) => { const L = lean ? lean(y) : [0, 0], out = []; for (let j = 0; j < n; j++) { const a = a0 + (j / n) * TAU, k = r * (mod ? mod(j, i, a) : 1); out.push([x + L[0] + Math.cos(a) * k * sx, y, z + L[1] - Math.sin(a) * k * sz]); } return out; });
    return this.stack(rings, col, capTop, capBot);
  }
  /** rings in XY planes along Z: st = [[z, y, rx, ry, x?], ...] (animal bodies, hulls of birds) */
  spindle(st, n, col, capA = true, capB = true) {
    const rings = st.map(([z, y, rx, ry, x = 0]) => { const out = []; for (let j = 0; j < n; j++) { const a = ((j + 0.5) / n) * TAU; out.push([x + Math.sin(a) * rx, y - Math.cos(a) * ry, z]); } return out; });
    return this.stack(rings, col, capB, capA);
  }
  /** a tube along a polyline; radii: number, per-point numbers, or per-point [across, up] pairs */
  tube(pts, radii, n, col, o = {}) {
    const { caps = [1, 1], a0 = 0 } = o, rings = [];
    let u = null;
    for (let i = 0; i < pts.length; i++) {
      const t = vnorm(vsub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
      if (!u) u = vnorm(vcross(Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], t));
      else u = vnorm(vsub(u, vmul(t, vdot(u, t))));
      const v = vcross(t, u), rr = Array.isArray(radii) ? radii[Math.min(i, radii.length - 1)] : radii, ru = Array.isArray(rr) ? rr[0] : rr, rv = Array.isArray(rr) ? rr[1] : rr, out = [];
      for (let j = 0; j < n; j++) { const a = a0 + (j / n) * TAU, cu = Math.cos(a) * ru, sv = Math.sin(a) * rv; out.push([pts[i][0] + u[0] * cu + v[0] * sv, pts[i][1] + u[1] * cu + v[1] * sv, pts[i][2] + u[2] * cu + v[2] * sv]); }
      rings.push(out);
    }
    return this.stack(rings, col, !!caps[1], !!caps[0]);
  }
  /** a square beam from a to b: w across (horizontal for a level beam), h the other way */
  beam(a, b, w, h, col, caps = [1, 1]) { return this.tube([a, b], [[w * 0.7071, (h ?? w) * 0.7071]], 4, col, { a0: PI / 4, caps }); }
  /** a box: centre, half sizes, optional yaw / tilt (about X) / roll (about Z) in radians */
  box(c, h, col, ry = 0, rx = 0, rz = 0, bottom = false) {
    return this.xf(trs(c[0], c[1], c[2], ry, 1, rx, rz), () => {
      const ring = (y) => [[-h[0], y, -h[2]], [-h[0], y, h[2]], [h[0], y, h[2]], [h[0], y, -h[2]]];
      this.stack([ring(-h[1]), ring(h[1])], col, true, bottom);
    });
  }
  /** a faceted lump: kind 'o0' 8 faces, 'i0' 20, 'o1' 32, 'i1' 80; jag = how far corners are pushed in and out; floor = flatten below this fraction of the radius */
  blob(c, r, col, o = {}) {
    const { kind = 'i1', jag = 0.14, seed = 0, floor = -2, ry = 0 } = o, R = Array.isArray(r) ? r : [r, r, r], src = unitSolid(kind), cy = Math.cos(ry), sy = Math.sin(ry);
    const pt = (q) => { const k = 1 + (hash(q[0] * 5.3 + seed, q[1] * 4.1 - seed * 0.7, q[2] * 6.7 + seed * 1.3) - 0.5) * 2 * jag, x = q[0] * k * R[0], z = q[2] * k * R[2]; return [c[0] + x * cy + z * sy, c[1] + Math.max(q[1] * k, floor) * R[1], c[2] - x * sy + z * cy]; };
    for (let i = 0; i < src.length; i += 3) this.face(pt(src[i]), pt(src[i + 1]), pt(src[i + 2]), col, c);
    return this;
  }
  /** a flat irregular patch lying on the ground with a rim sloping down to y = 0 */
  patch(c, rx, rz, n, col, rimCol, o = {}) {
    const { y = 0.03, jag = 0.18, seed = 0, rim = 0.12 } = o, top = [], out = [];
    for (let j = 0; j < n; j++) { const a = (j / n) * TAU, k = 1 + (hash(j * 3.3 + seed, seed * 1.7) - 0.5) * 2 * jag; top.push([c[0] + Math.cos(a) * rx * k * (1 - rim), y, c[2] - Math.sin(a) * rz * k * (1 - rim)]); out.push([c[0] + Math.cos(a) * rx * k, 0.004, c[2] - Math.sin(a) * rz * k]); }
    const m = [c[0], y, c[2]];
    for (let j = 0; j < n; j++) { const k = (j + 1) % n; this.face(m, top[j], top[k], col); this.quad(top[j], out[j], out[k], top[k], rimCol ?? col); }
    return this;
  }
  /** a grid sheet: fn(u, v) -> [x, y, z] for u, v in 0..1; col as usual, or (centre, normal, local, u, v) */
  sheet(nu, nv, fn, col, ref) {
    const P = []; for (let i = 0; i <= nu; i++) { P.push([]); for (let j = 0; j <= nv; j++) P[i].push(fn(i / nu, j / nv)); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const k = typeof col === 'function' ? (p, n, lp) => col(p, n, lp, (i + 0.5) / nu, (j + 0.5) / nv) : col;
      if ((i + j) % 2) this.face(P[i][j], P[i + 1][j], P[i + 1][j + 1], k, ref).face(P[i][j], P[i + 1][j + 1], P[i][j + 1], k, ref);
      else this.face(P[i][j], P[i + 1][j], P[i][j + 1], k, ref).face(P[i + 1][j], P[i + 1][j + 1], P[i][j + 1], k, ref);
    }
    return this;
  }
  /** a coursed masonry panel from a to b ([x, z]) rising from y0: cols x rows cells drawn as staggered blocks. o = { top(c) -> rows in that column, skip(c, r) -> leave an opening, thick, inside: [x, z] a point on the inner side, capCol, innerCol } */
  wall(a, b, y0, rowH, rows, cols, col, o = {}) {
    const { top = null, skip = null, thick = 0, inside = [0, 0], capCol = null, innerCol = null } = o;
    const dx = (b[0] - a[0]) / cols, dz = (b[1] - a[1]) / cols, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;   // unit normal, turned to point at the inside
    if ((inside[0] - a[0]) * nx + (inside[1] - a[1]) * nz < 0) { nx = -nx; nz = -nz; }
    const ref = (c, y) => [a[0] + dx * (c + 0.5) + nx * (thick || 1) * 0.5, y, a[1] + dz * (c + 0.5) + nz * (thick || 1) * 0.5];
    const hs = []; for (let c = 0; c < cols; c++) hs.push(top ? clamp(Math.round(top(c)), 0, rows) : rows);
    for (let c = 0; c < cols; c++) {
      const P = (u, y, in_ = 0) => [a[0] + dx * (c + u) + nx * thick * in_, y, a[1] + dz * (c + u) + nz * thick * in_];
      for (let r = 0; r < hs[c]; r++) {
        if (skip && skip(c, r)) continue;
        const ya = y0 + r * rowH, yb = ya + rowH;
        for (let h = 0; h < 2; h++) { const id = Math.floor((2 * c + h + (r % 2)) / 2); this.quad(P(h * 0.5, ya), P(h * 0.5 + 0.5, ya), P(h * 0.5 + 0.5, yb), P(h * 0.5, yb), typeof col === 'function' ? (p, n) => col(id, r, p, n) : col, ref(c, ya)); }
        if (thick) this.quad(P(0, ya, 1), P(1, ya, 1), P(1, yb, 1), P(0, yb, 1), innerCol ?? (typeof col === 'function' ? col(c + 31, r) : col), ref(c, ya));
      }
      if (!thick) continue;
      const yt = y0 + hs[c] * rowH, cc = capCol ?? (typeof col === 'function' ? col(c * 7 + 3, 99) : col);
      if (hs[c]) this.quad(P(0, yt), P(1, yt), P(1, yt, 1), P(0, yt, 1), cc, ref(c, yt - 0.01));
      const hn = c + 1 < cols ? hs[c + 1] : 0, hp = c ? hs[c - 1] : 0;
      if (hn < hs[c]) this.quad(P(1, y0 + hn * rowH), P(1, yt), P(1, yt, 1), P(1, y0 + hn * rowH, 1), cc, ref(c, yt));
      if (hp < hs[c]) this.quad(P(0, y0 + hp * rowH), P(0, yt), P(0, yt, 1), P(0, y0 + hp * rowH, 1), cc, ref(c, yt));
    }
    return this;
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.computeVertexNormals();
    return g;
  }
}

// ---------- materials ----------
let matScene = null, matGloss = null, matGlow = null, matLava = null, matBeam = null;
function mats() {
  if (matScene) return;
  matScene = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  matGloss = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.2, metalness: 0.25, side: THREE.DoubleSide });
  matGlow = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });                        // lamps, lanterns, embers, eyes, fireflies
  matLava = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });                        // lava: its brightness is pulsed by animateScenery
  matBeam = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
}
function mesh(geo, mat, shadow = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = shadow; return m; }
/** remembers where a moving part rests: [x, y, z, rx, ry, rz, scale] */
function rest(o) { o.userData.rest = [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x]; return o; }
function part(geo, mat, role, data = {}, pos = null, shadow = true) { const m = mesh(geo, mat, shadow); if (pos) m.position.set(pos[0], pos[1], pos[2]); m.userData = { role, ...data }; return rest(m); }
function group(role, data = {}) { const g = new THREE.Group(); g.userData = { role, ...data }; return g; }
function place(o, x, y, z, ry = 0, s = 1) { o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); return rest(o); }

// ---------- finding the moving parts again (also on clones) ----------
const ROLES = ['sway', 'puff', 'lamp', 'spin', 'flyer', 'animal', 'mote', 'flick', 'lava'];
const SUBS = ['head', 'wings', 'tail', 'throat'];
const partsCache = new WeakMap();
function partsOf(obj) {
  let P = partsCache.get(obj);
  if (P) return P;
  P = { sub: new Map(), any: false };
  for (const r of ROLES) P[r] = [];
  obj.traverse((o) => {
    const r = o.userData && o.userData.role;
    if (!r) return;
    if (P[r] && Array.isArray(P[r])) { P[r].push(o); P.any = true; }
    else if (SUBS.includes(r) && o.parent) { let s = P.sub.get(o.parent); if (!s) P.sub.set(o.parent, s = {}); s[r] = o; }
  });
  partsCache.set(obj, P);
  const refs = obj.userData && obj.userData.refs;
  if (refs && typeof refs === 'object') {
    for (const k of Object.keys(refs)) {
      const [role, single] = Array.isArray(refs[k]) ? refs[k] : [], list = P[role];
      if (!Array.isArray(list)) continue;
      Object.defineProperty(obj.userData, k, { value: single ? list[0] || null : list, enumerable: false, writable: true, configurable: true });
    }
  }
  return P;
}
/** stamps the root: kind, variant, and the handles the game may want ({ name: [role, single] }) */
function finish(g, kind, variant, refs = null, extra = null) {
  const role = g.userData && g.userData.role;
  g.userData = { ...(role ? g.userData : {}), kind, variant, ...(extra || {}) };
  if (refs) { g.userData.refs = refs; g.userData.anim = 1; partsOf(g); animateScenery(g, 0); }
  return g;
}

// ---------- shared small things ----------
/** a smoke puff: role 'puff'. base = where it is born, rise = how far it climbs, s0/s1 = size at birth / at the top */
function puffGeo(tint, big = false) {
  return cached(`puff:${tint}:${big}`, () => { const T = new Tris(0.6), lo = [0x8a8580, 0x3a3634, 0xc8c6c0][tint], hi = [0xd8d4cc, 0x6e6864, 0xf4f4f0][tint]; T.blob([0, 0, 0], [1, 0.9, 1], (p, n) => mix(lo, hi, 0.5 + n[1] * 0.5), { kind: big ? 'i1' : 'i0', jag: big ? 0.2 : 0.12, seed: tint }); return T.geo(); });
}
function smoke(g, n, base, o = {}) {
  const { rise = 0.9, s0 = 0.08, s1 = 0.22, rate = 0.22, drift = [0.25, 0.1], tint = 0, seed = 0, big = false } = o;
  for (let i = 0; i < n; i++) {
    const m = mesh(puffGeo(tint, big), matScene, false);
    m.userData = { role: 'puff', base, rise, s0, s1, rate, dx: drift[0], dz: drift[1], ph: (i + hash(seed, i) * 0.4) / n };
    g.add(m);
  }
  return g;
}
const glowCol = (a, b) => (p, n) => mix(a, b, 0.5 + n[1] * 0.5);
const LAMP_HOT = 0xfff0b0, LAMP = 0xffb030, EMBER = 0xff5a10, EMBER_D = 0xb81c04;

// =====================================================================================
// TEMPERATE
// =====================================================================================
const BARK = 0x5e4630, BARK_D = 0x43301f, LEAF = 0x4c8a30, LEAF_D = 0x2c5e22, LEAF_L = 0x74aa3c, PINE = 0x1e4c30, PINE_L = 0x35693a;
const STONE = 0x9c988c, STONE_D = 0x76726a, STONE_L = 0xb8b4a6, THATCH = 0xcfa64c, THATCH_D = 0x9c7a30, THATCH_L = 0xe2c06a;
const WOOD = 0x8a6238, WOOD_D = 0x5c3f24, WOOD_L = 0xb08a58, WHITE = 0xf2eee2, RED = 0xb8342a, SOIL = 0x5a4026, GRASS = 0x5c9a3a, GRASS_D = 0x3f7a2c, TAR = 0x2a2420;
const stoneCol = (id, r) => [STONE, STONE_D, STONE_L, 0x8c8a84, 0xa49c88][Math.floor(hash(id * 1.7, r * 3.1) * 5)];
const barkCol = (p, n) => mix(BARK_D, BARK, 0.5 + n[0] * 0.3 + n[1] * 0.3 + hash(p[1] * 9, p[0] * 7) * 0.3);

function oakGeo(v) {
  return cached(`oak:${v}`, () => {
    const R = rng(v * 37 + 5), trunk = new Tris(), crown = new Tris(), PY = 1.15;
    const lean = [(R() - 0.5) * 0.14 + (v === 2 ? 0.16 : 0), (R() - 0.5) * 0.12];
    trunk.lathe([[0.44, 0], [0.27, 0.14], [0.2, 0.45], [0.17, 0.9], [0.16, 1.35]], 7, barkCol, { mod: (j, i) => (i === 0 ? 0.75 + (j % 2) * 0.5 : 1), lean: (y) => [lean[0] * y, lean[1] * y] });
    const top = [lean[0] * 1.2, 1.2, lean[1] * 1.2];
    const leaf = (p, n) => mix(mix(LEAF_D, LEAF, clamp(0.55 + n[1] * 0.6 + p[1] * 0.25, 0, 1)), LEAF_L, clamp(n[1] * 0.9 - 0.25 + p[1] * 0.3 + (hash(p[0] * 4, p[1] * 4, p[2] * 4) - 0.5) * 0.5, 0, 1));
    const lobes = [[0, 0.95, 0, 0.82, 0.7, 0.8, 'i1']], nl = 4 + (v % 2);
    for (let i = 0; i < nl; i++) { const a = (i / nl) * TAU + R() * 0.5, r = 0.56 + R() * 0.1 + (v === 2 ? 0.05 : 0); lobes.push([Math.cos(a) * r, 0.62 + R() * 0.3, Math.sin(a) * r * 0.95, 0.56 + R() * 0.1, 0.46 + R() * 0.08, 0.56 + R() * 0.1, i % 2 ? 'o1' : 'i1']); }
    lobes.push([(R() - 0.5) * 0.4, 1.42, (R() - 0.5) * 0.4, 0.52, 0.42, 0.52, 'o1']);
    lobes.forEach(([x, y, z, rx, ry, rz, kind], i) => {
      crown.blob([x + lean[0] * 2, y, z + lean[1] * 2], [rx, ry, rz], leaf, { kind, jag: 0.16, seed: v * 9 + i });
      if (i && i <= 4) trunk.tube([top, [lean[0] * 1.6 + x * 0.5, PY + y * 0.45, lean[1] * 1.6 + z * 0.5], [x * 0.85 + lean[0] * 2, PY + y * 0.9, z * 0.85 + lean[1] * 2]], [0.1, 0.075, 0.045], 4, barkCol, { caps: [0, 0] });
    });
    return { trunk: trunk.geo(), crown: crown.geo(), py: PY };
  });
}
function pineGeo(k) {
  return cached(`pine:${k}`, () => {
    const R = rng(k * 19 + 3), T = new Tris(), H = [3.6, 2.9, 2.3, 3.3][k], r0 = [0.62, 0.54, 0.46, 0.5][k], m = [6, 5, 4, 6][k], n = 7;
    T.lathe([[0.13, 0], [0.09, H * 0.35], [0.04, H * 0.8]], 5, barkCol, { mod: (j, i) => (i ? 1 : 1.25) });
    const y0 = H * 0.16, step = (H - y0) / (m + 0.35);
    for (let i = 0; i < m; i++) {
      const y = y0 + i * step, rb = r0 * (1 - (i / m) * 0.78), a0 = R() * TAU, last = i === m - 1;
      const skirt = []; for (let j = 0; j < n; j++) { const a = a0 + (j / n) * TAU, r = rb * (0.82 + R() * 0.3); skirt.push([Math.cos(a) * r, y - (j % 2) * step * 0.16, -Math.sin(a) * r]); }
      const topR = last ? 0.012 : rb * 0.34, topY = y + step * (last ? 1.35 : 1.25), up = []; for (let j = 0; j < n; j++) { const a = a0 + (j / n) * TAU; up.push([Math.cos(a) * topR, topY, -Math.sin(a) * topR]); }
      T.stack([skirt, up], (p, nn) => (nn[1] < -0.3 ? 0x143424 : mix(PINE, PINE_L, clamp(0.25 + nn[1] * 0.5 + (hash(p[0] * 5, i, p[2] * 5) - 0.5) * 0.7 + i / m * 0.3, 0, 1))), true, true);
    }
    return T.geo();
  });
}
/** ridge along X; z0/z1 are the eaves (overhang included), th the slab thickness */
function gableRoof(T, x0, x1, z0, z1, yE, yR, th, cols, bands = 3, edge = THATCH_D) {
  const zm = (z0 + z1) / 2, e = 0.035, ref = [(x0 + x1) / 2, yE - 0.3, zm];
  for (const ze of [z0, z1]) {
    for (let b = 0; b < bands; b++) {
      const u0 = b / bands, u1 = (b + 1) / bands, za = lerp(ze, zm, u0), zb = lerp(ze, zm, u1), ya = lerp(yE, yR, u0) + th, yb = lerp(yE, yR, u1) + th;
      T.quad([x0, ya + e, za], [x1, ya + e, za], [x1, yb, zb], [x0, yb, zb], (p) => cols[(b + Math.floor(hash(Math.round(p[0] * 3), b, ze) * 2)) % cols.length], ref);
      if (b) T.quad([x0, ya, za], [x1, ya, za], [x1, ya + e, za], [x0, ya + e, za], edge, ref);
    }
    T.quad([x0, yE, ze], [x1, yE, ze], [x1, yE + th + e, ze], [x0, yE + th + e, ze], edge, ref);
    for (const x of [x0, x1]) T.quad([x, yE, ze], [x, yR, zm], [x, yR + th, zm], [x, yE + th + e, ze], edge, [ref[0], yE, zm]);
  }
  return T;
}
function fence(T, pts, h = 0.3, col = WOOD_L) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; T.beam([a[0], 0, a[1]], [a[0], h + 0.05, a[1]], 0.055, 0.055, WOOD);
    if (i + 1 < pts.length) { const b = pts[i + 1]; for (const y of [h * 0.5, h * 0.92]) T.beam([a[0], y, a[1]], [b[0], y, b[1]], 0.03, 0.045, col, [0, 0]); }
  }
}
function cottageGeo(v) {
  return cached(`cottage:${v}`, () => {
    const R = rng(v * 11 + 2), T = new Tris(), x0 = -1.02, x1 = 0.34, z0 = -0.82, z1 = 0.22, wh = 0.8, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, yR = 1.62;
    const wc = v === 1 ? (id, r) => [WHITE, 0xe6dfcc, 0xf8f4ea][Math.floor(hash(id, r) * 3)] : stoneCol, ins = [cx, cz];
    T.wall([x0, z1], [x1, z1], 0, 0.2, 4, 5, wc, { inside: ins }).wall([x0, z0], [x1, z0], 0, 0.2, 4, 5, wc, { inside: ins });
    T.wall([x0, z0], [x0, z1], 0, 0.2, 4, 4, wc, { inside: ins }).wall([x1, z0], [x1, z1], 0, 0.2, 4, 4, wc, { inside: ins });
    for (const x of [x0, x1]) for (let k = 0; k < 2; k++) T.face([x, wh, k ? cz : z0], [x, wh, k ? z1 : cz], [x, yR - 0.05, cz], wc(k + 3, 7), [cx, 1, cz]);
    gableRoof(T, x0 - 0.12, x1 + 0.12, z0 - 0.2, z1 + 0.2, wh - 0.12, yR, 0.1, v === 2 ? [0x6f8f4a, 0x86a35a, 0x5c7c40] : [THATCH, THATCH_L, THATCH_D, 0xc09a40], 3, v === 2 ? 0x4a6434 : THATCH_D);
    T.tube([[x0 - 0.14, yR + 0.12, cz], [x1 + 0.14, yR + 0.12, cz]], [[0.09, 0.07]], 5, v === 2 ? 0x4a6434 : THATCH_D);
    // chimney on the west gable
    T.box([x0 + 0.02, 0.95, cz + 0.1], [0.15, 0.95, 0.15], (p) => stoneCol(Math.round(p[1] * 5), Math.round(p[0] * 9 + p[2] * 7)));
    T.box([x0 + 0.02, 1.92, cz + 0.1], [0.18, 0.03, 0.18], STONE_D);
    // door, windows, step
    const zf = z1 + 0.012;
    T.box([cx - 0.12, 0.3, zf], [0.17, 0.3, 0.02], [0x7a3b22, 0x2f5a7a, 0x3d6a3a][v]); T.box([cx - 0.12, 0.62, zf], [0.21, 0.035, 0.035], WOOD_D); T.box([cx - 0.12, 0.02, zf + 0.1], [0.2, 0.02, 0.1], STONE_L);
    for (const wx of [cx - 0.5, cx + 0.36]) { T.box([wx, 0.45, zf], [0.11, 0.11, 0.02], 0x2c3a48); T.box([wx, 0.45, zf + 0.01], [0.015, 0.11, 0.02], WHITE); T.box([wx, 0.33, zf + 0.02], [0.14, 0.02, 0.04], WOOD_D); for (const s of [-1, 1]) T.box([wx + s * 0.155, 0.45, zf], [0.04, 0.12, 0.015], [0x3d6a3a, 0xb8342a, 0x2f5a7a][v]); }
    T.box([x1 + 0.012, 0.45, cz], [0.02, 0.11, 0.11], 0x2c3a48);
    // garden: dug soil, rows of greens, fence
    const gx0 = 0.48, gx1 = 1.08, gz0 = -0.78, gz1 = 0.86;
    T.quad([gx0, 0.02, gz0], [gx1, 0.02, gz0], [gx1, 0.02, gz1], [gx0, 0.02, gz1], SOIL);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) { const px = gx0 + 0.13 + r * 0.17, pz = gz0 + 0.16 + k * 0.26; T.blob([px, 0.05, pz], [0.07, r === 1 ? 0.12 : 0.07, 0.07], [0x6fae3c, 0x3f8a3a, 0x8fbf4a][r], { kind: 'o0', jag: 0.2, seed: k + r * 7 }); if (r === 2 && k % 2 === 0) T.blob([px, 0.1, pz], 0.045, 0xe0802a, { kind: 'o0' }); }
    fence(T, [[gx0 - 0.04, gz1 + 0.06], [gx1 + 0.06, gz1 + 0.06], [gx1 + 0.06, gz1 * 0.3 + gz0 * 0.7 + 0.5], [gx1 + 0.06, gz0 - 0.04], [gx0 - 0.04, gz0 - 0.04]]);
    fence(T, [[gx0 - 0.04, gz1 + 0.06], [gx0 - 0.04, 0.42]]);
    // woodpile / barrel by the door
    if (v !== 1) for (let k = 0; k < 5; k++) T.tube([[x0 + 0.15 + (k % 3) * 0.12 + (k > 2 ? 0.06 : 0), 0.06 + (k > 2 ? 0.1 : 0), z1 + 0.08], [x0 + 0.15 + (k % 3) * 0.12 + (k > 2 ? 0.06 : 0), 0.06 + (k > 2 ? 0.1 : 0), z1 + 0.4]], 0.06, 5, (p, n) => (Math.abs(n[2]) > 0.8 ? 0xd8b880 : BARK));
    else T.lathe([[0.1, 0], [0.13, 0.14], [0.1, 0.3]], 7, (p) => (Math.abs(p[1] - 0.08) < 0.03 || Math.abs(p[1] - 0.24) < 0.03 ? 0x4a4a4a : WOOD), { x: x0 + 0.25, z: z1 + 0.22 });
    T.patch([cx + 0.1, 0, z1 + 0.5], 0.3, 0.26, 6, 0xb8a888, 0x9a8c70, { y: 0.015, seed: v + R() });
    return T.geo();
  });
}
function lighthouseGeo(v) {
  return cached(`lighthouse:${v}`, () => {
    const T = new Tris(), B1 = [WHITE, 0xf0ece0, 0xe8e2d2], B2 = v === 1 ? [0x25344e, 0x2c3e5c] : [RED, 0xa82c24], n = 10;
    // rock foot
    const rock = (p, nn) => (nn[1] > 0.75 ? mix(GRASS, GRASS_D, hash(p[0] * 3, p[2] * 3)) : mix(0x6c6a66, 0x8e8c86, 0.5 + nn[0] * 0.3 + nn[1] * 0.3));
    T.blob([0, 0.05, 0], [0.98, 0.5, 0.94], rock, { kind: 'i1', jag: 0.16, seed: 3 + v, floor: -0.1 });
    for (let k = 0; k < 4; k++) { const a = k * 1.7 + v; T.blob([Math.cos(a) * 0.78, 0.05, Math.sin(a) * 0.74], [0.24, 0.26, 0.22], rock, { kind: 'i0', jag: 0.22, seed: k, floor: -0.2 }); }
    // banded tower
    const y0 = 0.4, y1 = 4.5, bands = 5, prof = []; for (let i = 0; i <= bands; i++) { const u = i / bands; prof.push([lerp(0.64, 0.42, u ** 0.8), lerp(y0, y1, u)]); }
    T.lathe(prof, n, (p, nn, lp) => { const b = Math.floor(clamp((lp[1] - y0) / (y1 - y0), 0, 0.999) * bands); return (b % 2 ? B2 : B1)[Math.floor(hash(Math.round(lp[0] * 9), b, Math.round(lp[2] * 9)) * 2)]; }, { capTop: false });
    T.lathe([[0.7, 0.25], [0.68, 0.45], [0.6, 0.47]], n, STONE_D, { capTop: false });
    // gallery
    T.lathe([[0.42, 4.36], [0.72, 4.52], [0.72, 4.6], [0.3, 4.6]], n, (p, nn) => (nn[1] > 0.5 ? 0x5a5a60 : 0x3e3e44), { capTop: false });
    for (let j = 0; j < n; j++) { const a = (j / n) * TAU + PI / n, x = Math.cos(a) * 0.69, z = Math.sin(a) * 0.69; T.beam([x, 4.6, z], [x, 4.92, z], 0.04, 0.04, 0x2a2a30, [0, 1]); }
    T.lathe([[0.7, 4.88], [0.7, 4.94]], n, 0x2a2a30, { capTop: false, a0: PI / n });
    // lamp room: sill, mullions, cap
    T.lathe([[0.38, 4.6], [0.38, 4.8], [0.33, 4.8]], 8, WHITE, { capTop: true });
    for (let j = 0; j < 8; j++) { const a = (j / 8) * TAU, x = Math.cos(a) * 0.35, z = Math.sin(a) * 0.35; T.beam([x, 4.8, z], [x, 5.42, z], 0.045, 0.045, 0x2a2a30, [0, 0]); }
    T.lathe([[0.36, 5.4], [0.52, 5.4], [0.5, 5.48], [0.2, 5.95], [0.07, 6.02], [0.1, 6.12], [0.02, 6.2], [0.012, 6.5]], 8, (p, nn, lp) => (lp[1] > 5.98 ? 0x2a2a30 : nn[1] < -0.3 ? 0x5a1a16 : mix(B2[0], tone(B2[0], 0.08), hash(Math.round(lp[0] * 5), Math.round(lp[2] * 5)))), { capBot: false });
    // door and windows
    T.box([0, 0.72, 0.61], [0.15, 0.24, 0.05], WOOD_D); T.box([0, 0.99, 0.61], [0.19, 0.04, 0.06], STONE_D); T.box([0, 0.43, 0.72], [0.22, 0.04, 0.12], STONE_L);
    [[1.7, 0.5], [2.75, 2.6], [3.7, 4.4]].forEach(([y, a]) => { const r = lerp(0.64, 0.42, ((y - y0) / (y1 - y0)) ** 0.8) - 0.02; T.box([Math.sin(a) * r, y, Math.cos(a) * r], [0.07, 0.12, 0.05], 0x1e2630, a); });
    // keeper's store
    const hx = -0.62, hz = 0.5;
    T.box([hx, 0.42, hz], [0.3, 0.28, 0.24], (p, nn) => (nn[1] > 0.5 ? STONE_D : [WHITE, 0xe8e2d2][Math.floor(hash(p[0] * 5, p[1] * 7) * 2)]), 0.5);
    T.at(hx, 0.7, hz, 0.5, 1, 0, 0, () => gableRoof(T, -0.36, 0.36, -0.32, 0.32, 0, 0.26, 0.04, [B2[0], tone(B2[0], 0.05)], 2, tone(B2[0], -0.1)));
    T.box([hx + 0.12, 0.38, hz + 0.21], [0.07, 0.14, 0.02], WOOD_D, 0.5);
    // the lamp: a lens and two beams
    const L = new Tris(0), beam = new Tris(0);
    L.lathe([[0.1, -0.24], [0.2, -0.1], [0.2, 0.1], [0.1, 0.24]], 6, (p, nn, lp) => (Math.abs(lp[1]) < 0.1 ? LAMP_HOT : LAMP), { capBot: true });
    for (const s of [-1, 1]) beam.tube([[0, 0, s * 0.18], [0, -0.05, s * 2.4]], [[0.1, 0.12], [0.34, 0.2]], 6, 0xffa838, { caps: [0, 0] });
    return { body: T.geo(), lamp: L.geo(), beam: beam.geo() };
  });
}
function windmillGeo(v) {
  return cached(`windmill:${v}`, () => {
    const T = new Tris(), S = new Tris(), plank = [[WOOD, WOOD_L, 0x9a7244, WOOD_D], [0xe8e2d2, WHITE, 0xd8d0bc, 0xf4f0e6], [0x6e4a30, 0x805a38, 0x5c3e28, 0x8a6a48]][v], roofC = [0x4a3a30, 0x6a3028, 0x3a4a3a][v];
    // trestle: cross sills, post, quarter bars, stone pads
    for (const a of [PI / 4, -PI / 4]) { const c = Math.cos(a), s = Math.sin(a); T.beam([-c * 0.9, 0.1, -s * 0.9], [c * 0.9, 0.1, s * 0.9], 0.13, 0.12, WOOD_D); for (const k of [-1, 1]) { T.beam([k * c * 0.78, 0.14, k * s * 0.78], [k * c * 0.08, 1.0, k * s * 0.08], 0.1, 0.1, WOOD, [0, 0]); T.box([k * c * 0.86, 0.03, k * s * 0.86], [0.14, 0.04, 0.14], STONE, a); } }
    T.beam([0, 0.1, 0], [0, 1.3, 0], 0.2, 0.2, WOOD_D);
    // the buck
    const bx = 0.5, bz0 = -0.6, bz1 = 0.5, by0 = 1.12, by1 = 2.72, cols = 5;
    const strip = (a, b) => { for (let c = 0; c < cols; c++) { const p = vlerp(a, b, c / cols), q = vlerp(a, b, (c + 1) / cols); T.quad([p[0], by0, p[2]], [q[0], by0, q[2]], [q[0], by1, q[2]], [p[0], by1, p[2]], plank[(c * 3 + Math.round(a[0] * 2 + a[2])) & 3], [0, 2, 0]); } };
    strip([-bx, 0, bz1], [bx, 0, bz1]); strip([-bx, 0, bz0], [bx, 0, bz0]); strip([-bx, 0, bz0], [-bx, 0, bz1]); strip([bx, 0, bz0], [bx, 0, bz1]);
    T.quad([-bx, by0, bz0], [bx, by0, bz0], [bx, by0, bz1], [-bx, by0, bz1], WOOD_D, [0, 2, 0]);
    T.box([0, by0 - 0.04, -0.05], [bx + 0.04, 0.05, 0.6], WOOD_D);
    // roof: a curved ridge along Z
    const arc = [[-bx - 0.07, by1 - 0.06], [-bx * 0.62, by1 + 0.34], [0, by1 + 0.5], [bx * 0.62, by1 + 0.34], [bx + 0.07, by1 - 0.06]];
    for (let i = 0; i < 4; i++) { T.quad([arc[i][0], arc[i][1], bz0 - 0.08], [arc[i + 1][0], arc[i + 1][1], bz0 - 0.08], [arc[i + 1][0], arc[i + 1][1], bz1 + 0.08], [arc[i][0], arc[i][1], bz1 + 0.08], (p) => tone(roofC, (hash(i, Math.round(p[2] * 3)) - 0.5) * 0.06), [0, 2, 0]); }
    for (const z of [bz0, bz1]) for (let i = 1; i < 4; i++) T.face([arc[0][0] + 0.07, by1, z], [arc[i][0], arc[i][1] - 0.03, z], [arc[i + 1][0] - (i === 3 ? 0.07 : 0), i === 3 ? by1 : arc[i + 1][1] - 0.03, z], plank[i & 3], [0, 2, 0]);
    // window, door, ladder, tail pole
    T.box([0, 2.25, bz1 + 0.01], [0.1, 0.1, 0.02], 0x2c3440); T.box([bx + 0.01, 1.95, -0.1], [0.02, 0.1, 0.09], 0x2c3440);
    T.box([0, 1.5, bz0 - 0.01], [0.16, 0.32, 0.02], WOOD_D);
    for (const s of [-1, 1]) T.beam([s * 0.17, 0.02, -1.25], [s * 0.17, by0 + 0.04, bz0 - 0.04], 0.05, 0.05, WOOD_L);
    for (let k = 1; k < 6; k++) { const u = k / 6; T.beam([-0.17, lerp(0.02, by0 + 0.04, u), lerp(-1.25, bz0 - 0.04, u)], [0.17, lerp(0.02, by0 + 0.04, u), lerp(-1.25, bz0 - 0.04, u)], 0.06, 0.03, WOOD); }
    T.beam([0.3, by0, bz0], [0.42, 0.22, -1.5], 0.07, 0.07, WOOD_D);
    T.lathe([[0.1, 0.02], [0.1, 0.2]], 6, WOOD, { x: 0.42, z: -1.52 });
    // windshaft
    T.tube([[0, 2.5, bz1 - 0.1], [0, 2.52, bz1 + 0.26]], 0.09, 6, WOOD_D);
    // sails (about the hub; they turn in the XY plane)
    const canvas = [0xefe6cc, 0xe2d6b6];
    S.lathe([[0.11, -0.05], [0.11, 0.05]], 6, 0x3a2c20, { capBot: true });
    for (let k = 0; k < 4; k++) S.at(0, 0, 0, 0, 1, 0, k * PI / 2, () => {
      S.beam([0, 0, 0.02], [0, 1.5, 0.02], 0.07, 0.05, WOOD_D);
      for (let r = 0; r < 4; r++) { const ya = 0.32 + r * 0.29, yb = ya + 0.27; S.quad([0.03, ya, 0.035], [0.4, ya, 0.0], [0.4, yb, 0.0], [0.03, yb, 0.035], canvas[r % 2]); S.beam([-0.08, ya - 0.01, 0.03], [0.42, ya - 0.01, 0], 0.03, 0.03, WOOD, [0, 0]); }
      S.beam([-0.08, 1.48, 0.03], [0.42, 1.48, 0], 0.03, 0.03, WOOD, [0, 0]); S.beam([0.41, 0.3, 0], [0.41, 1.49, 0], 0.03, 0.03, WOOD, [0, 0]); S.beam([-0.08, 0.3, 0.03], [-0.08, 1.49, 0.03], 0.025, 0.025, WOOD, [0, 0]);
    });
    return { body: T.geo(), sails: S.geo(), hub: [0, 2.52, bz1 + 0.3] };
  });
}
// ---- four-legged animals: a body mesh and a head mesh on a neck pivot, facing +Z ----
function legs(T, pts, r, h, col, hoof = null) { for (const [x, z] of pts) { T.tube([[x, h, z], [x, 0, z]], [r, r * 0.7], 4, col, { caps: [0, 0] }); if (hoof) T.box([x, 0.012, z + r * 0.3], [r * 0.9, 0.014, r * 1.1], hoof); } }
function sheepGeo(v) {
  return cached(`sheep:${v}`, () => {
    const B = new Tris(), Hd = new Tris(), wool = v === 2 ? 0x4a4038 : 0xf0ece0, woolD = v === 2 ? 0x322a24 : 0xcfc8b6, face = v === 1 ? 0xe6dcc8 : 0x2a2622;
    B.spindle([[-0.22, 0.27, 0.09, 0.09], [-0.13, 0.285, 0.175, 0.165], [0.1, 0.29, 0.175, 0.165], [0.2, 0.28, 0.09, 0.09]], 6, (p, n) => mix(woolD, wool, clamp(0.6 + n[1] * 0.5, 0, 1)));
    legs(B, [[-0.08, -0.13], [0.08, -0.13], [-0.08, 0.11], [0.08, 0.11]], 0.035, 0.18, face === 0x2a2622 ? 0x2a2622 : 0x8a7a64);
    B.face([-0.03, 0.3, -0.21], [0.03, 0.3, -0.21], [0, 0.2, -0.27], wool);
    Hd.spindle([[-0.03, 0.02, 0.07, 0.075], [0.07, 0.0, 0.062, 0.062], [0.16, -0.03, 0.04, 0.04]], 5, face);
    Hd.blob([0, 0.06, 0.0], [0.075, 0.05, 0.06], wool, { kind: 'o0' });
    for (const s of [-1, 1]) Hd.face([s * 0.05, 0.04, 0.02], [s * 0.14, 0.03, 0.0], [s * 0.06, 0.0, 0.04], face);
    return { body: B.geo(), head: Hd.geo(), neck: [0, 0.3, 0.19] };
  });
}
function deerGeo(v) {
  return cached(`deer:${v}`, () => {
    const B = new Tris(), Hd = new Tris(), stag = v === 0, coat = stag ? 0x9a5a30 : 0xb0703c, coatD = stag ? 0x6e3e22 : 0x80502a, pale = 0xe8dcc0, k = stag ? 1 : 0.86;
    const col = (p, n) => (n[1] < -0.55 ? pale : mix(coatD, coat, clamp(0.5 + n[1] * 0.6, 0, 1)));
    B.spindle([[-0.3 * k, 0.56 * k, 0.07, 0.09], [-0.2 * k, 0.56 * k, 0.13 * k, 0.15 * k], [0.02, 0.55 * k, 0.12 * k, 0.14 * k], [0.2 * k, 0.57 * k, 0.13 * k, 0.16 * k], [0.28 * k, 0.6 * k, 0.07, 0.1]], 6, col);
    legs(B, [[-0.07 * k, -0.22 * k], [0.07 * k, -0.22 * k], [-0.07 * k, 0.2 * k], [0.07 * k, 0.2 * k]], 0.03, 0.5 * k, coat, 0x2a2018);
    B.blob([0, 0.6 * k, -0.31 * k], [0.06, 0.07, 0.04], 0xf8f4e8, { kind: 'o0' });
    // neck and head hang from the shoulder pivot
    Hd.tube([[0, -0.04, -0.02], [0, 0.16 * k, 0.06], [0, 0.32 * k, 0.1]], [[0.075, 0.1], [0.055, 0.07], [0.05, 0.055]], 5, col, { caps: [0, 0] });
    Hd.spindle([[0.04, 0.34 * k, 0.06, 0.06], [0.14, 0.33 * k, 0.05, 0.05], [0.25, 0.3 * k, 0.028, 0.028]], 5, (p, n, lp) => (lp[2] > 0.22 ? 0x241a14 : col(p, n)));
    for (const s of [-1, 1]) {
      Hd.face([s * 0.04, 0.38 * k, 0.05], [s * 0.13, 0.44 * k, 0.02], [s * 0.05, 0.42 * k, 0.07], coatD);
      if (stag) { const A = 0xd8c8a0, b0 = [s * 0.03, 0.39, 0.06], b1 = [s * 0.12, 0.56, 0.0], b2 = [s * 0.2, 0.74, 0.04], b3 = [s * 0.17, 0.9, 0.12];
        Hd.tube([b0, b1, b2, b3], [0.022, 0.02, 0.016, 0.006], 3, A, { caps: [0, 0] }); Hd.tube([b1, [s * 0.1, 0.62, 0.16]], [0.016, 0.004], 3, A, { caps: [0, 0] }); Hd.tube([b2, [s * 0.3, 0.84, 0.0]], [0.014, 0.004], 3, A, { caps: [0, 0] }); Hd.tube([b2, [s * 0.14, 0.86, -0.08]], [0.014, 0.004], 3, A, { caps: [0, 0] }); }
    }
    return { body: B.geo(), head: Hd.geo(), neck: [0, 0.6 * k, 0.24 * k] };
  });
}
/** an animal: Group(role 'animal') holding a body mesh and a head mesh (role 'head') */
function animal(G, act, data = {}, mat = null) {
  mats();
  const g = group('animal', { act, ...data });
  g.add(mesh(G.body, mat || matScene));
  if (G.head) { const h = mesh(G.head, mat || matScene); h.position.set(G.neck[0], G.neck[1], G.neck[2]); h.userData = { role: 'head' }; g.add(h); }
  return g;
}
/** scatter n spots inside radius R, at least d apart */
function spots(R, n, rad, d) { const out = []; for (let i = 0; i < n; i++) { let x = 0, z = 0; for (let k = 0; k < 40; k++) { const a = R() * TAU, r = Math.sqrt(R()) * rad; x = Math.cos(a) * r; z = Math.sin(a) * r; if (out.every(([px, pz]) => Math.hypot(px - x, pz - z) > d)) break; } out.push([x, z]); } return out; }

// ---- birds on the wing: a body mesh and one wings mesh (both wings; flapped by scaling it in Y), facing +Z ----
function flyerGeo(kind) {
  return cached(`flyer:${kind}`, () => {
    const B = new Tris(), W = new Tris(), E = new Tris(0);
    if (kind === 'gull') {
      B.spindle([[-0.2, 0.0, 0.012, 0.01], [-0.1, 0.0, 0.05, 0.04], [0.04, 0.0, 0.065, 0.055], [0.13, 0.015, 0.045, 0.045], [0.19, 0.01, 0.02, 0.02]], 5, (p, n, lp) => (lp[2] > 0.17 ? 0xf0a020 : n[1] > 0.3 && lp[2] < 0.08 ? 0xb8c0c8 : 0xfafaf6));
      B.face([-0.06, 0, -0.16], [0.06, 0, -0.16], [0, 0, -0.3], 0xf4f4f0); B.face([0, 0.01, 0.19], [0.012, 0, 0.26], [-0.012, 0, 0.26], 0xf0a020);
      for (const s of [-1, 1]) { const a = [s * 0.04, 0, 0.07], b = [s * 0.04, 0, -0.06], c = [s * 0.27, 0.13, -0.05], d = [s * 0.25, 0.13, 0.08], e = [s * 0.52, 0.2, -0.04], f = [s * 0.56, 0.2, -0.1], h = [s * 0.4, 0.17, 0.045];
        W.quad(a, b, c, d, 0xc4ccd4).quad(d, c, [s * 0.4, 0.17, -0.07], h, 0xb4bcc6).face(h, [s * 0.4, 0.17, -0.07], e, 0x30343a).face([s * 0.4, 0.17, -0.07], f, e, 0x1e2024); }
    } else if (kind === 'vulture') {
      B.spindle([[-0.2, 0.0, 0.02, 0.015], [-0.1, 0.0, 0.085, 0.06], [0.06, 0.0, 0.09, 0.07], [0.16, 0.0, 0.05, 0.05]], 5, (p, n) => mix(0x2a2018, 0x4a3828, 0.5 + n[1] * 0.5));
      B.spindle([[0.14, 0.0, 0.075, 0.06], [0.19, -0.005, 0.07, 0.055]], 6, 0xe8e0d0, false, false);   // ruff
      B.spindle([[0.18, -0.01, 0.035, 0.035], [0.27, -0.03, 0.04, 0.04], [0.33, -0.05, 0.015, 0.02]], 4, (p, n, lp) => (lp[2] > 0.29 ? 0x3a3a34 : 0xd88878));
      B.quad([-0.1, 0, -0.14], [0.1, 0, -0.14], [0.13, 0, -0.34], [-0.13, 0, -0.34], 0x221a14);
      for (const s of [-1, 1]) { const y1 = 0.1, y2 = 0.2;
        W.quad([s * 0.06, 0, 0.12], [s * 0.06, 0, -0.1], [s * 0.4, y1, -0.14], [s * 0.4, y1, 0.14], 0x4a3828).quad([s * 0.4, y1, 0.14], [s * 0.4, y1, -0.14], [s * 0.72, y2, -0.13], [s * 0.72, y2, 0.1], 0x2e241a);
        for (let k = 0; k < 4; k++) { const z = 0.1 - k * 0.075; W.face([s * 0.72, y2, z], [s * 0.72, y2, z - 0.06], [s * (0.92 - k * 0.03), y2 + 0.07, z - 0.03 - k * 0.02], 0x18120e); } }
    } else if (kind === 'bat') {
      B.spindle([[-0.12, 0.0, 0.02, 0.02], [-0.03, 0.0, 0.06, 0.055], [0.07, 0.01, 0.055, 0.05], [0.13, 0.01, 0.05, 0.045], [0.17, 0.0, 0.025, 0.025]], 5, (p, n) => mix(0x1a1614, 0x3a302c, 0.5 + n[1] * 0.5));
      for (const s of [-1, 1]) { B.face([s * 0.025, 0.045, 0.12], [s * 0.065, 0.13, 0.1], [s * 0.05, 0.03, 0.08], 0x2a2220); E.face([s * 0.022, 0.035, 0.168], [s * 0.05, 0.045, 0.15], [s * 0.035, 0.015, 0.16], 0xffa020); E.face([s * 0.022, 0.035, 0.168], [s * 0.05, 0.045, 0.15], [s * 0.04, 0.06, 0.158], 0xff6010); }
      B.face([-0.03, 0, -0.1], [0.03, 0, -0.1], [0, 0, -0.2], 0x2a201c);
      for (const s of [-1, 1]) { const sh = [s * 0.04, 0, 0.06], hip = [s * 0.04, 0, -0.08], wr = [s * 0.3, 0.14, 0.12], f1 = [s * 0.62, 0.2, 0.0], f2 = [s * 0.5, 0.17, -0.2], f3 = [s * 0.28, 0.1, -0.24], m1 = [s * 0.5, 0.175, -0.07], m2 = [s * 0.36, 0.13, -0.15], m3 = [s * 0.15, 0.05, -0.13];
        const mem = [0x5a2c20, 0x44201a], bone = 0x1c1614;
        W.face(sh, wr, m1, mem[0]).face(wr, f1, m1, bone).face(sh, m1, m2, mem[1]).face(m1, f2, m2, mem[0]).face(sh, m2, m3, mem[0]).face(m2, f3, m3, mem[1]).face(sh, m3, hip, mem[1]); }
    } else {   // crow (perched: wings folded into the body)
      B.spindle([[-0.2, 0.1, 0.012, 0.01], [-0.08, 0.14, 0.06, 0.055], [0.02, 0.18, 0.07, 0.075], [0.08, 0.24, 0.05, 0.055], [0.12, 0.27, 0.045, 0.045], [0.17, 0.26, 0.02, 0.02]], 5, (p, n) => mix(0x0e0e12, 0x2a2a36, clamp(0.3 + n[1] * 0.6, 0, 1)));
      B.face([0.014, 0.27, 0.16], [-0.014, 0.27, 0.16], [0, 0.245, 0.26], 0x3a3630); B.face([0.014, 0.25, 0.16], [-0.014, 0.25, 0.16], [0, 0.245, 0.26], 0x24221e);
      for (const s of [-1, 1]) B.beam([s * 0.025, 0.12, 0.02], [s * 0.03, 0, 0.03], 0.016, 0.016, 0x24221e, [0, 0]);
    }
    return { body: B.geo(), wings: W.count ? W.geo() : null, eyes: E.count ? E.geo() : null };
  });
}
function flock(kind, n, seed, o) {
  mats();
  const G = flyerGeo(kind), R = rng(seed * 17 + 5), g = new THREE.Group(), dir = R() < 0.5 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const b = group('flyer', { cx: (R() - 0.5) * o.spread, cz: (R() - 0.5) * o.spread, R: o.r0 + R() * (o.r1 - o.r0), h: lerp(o.h0, o.h1, (i + R() * 0.6) / n), ph: (i / n) * TAU + R() * 0.8, speed: o.speed * (0.8 + R() * 0.4), dir, bob: o.bob, flapRate: o.flapRate * (0.85 + R() * 0.3), flapAmp: o.flapAmp, glide: o.glide, bank: o.bank, burst: o.burst });
    b.rotation.order = 'YXZ';
    const s = o.size * (0.88 + R() * 0.24);
    b.scale.setScalar(s); b.userData.size = s;
    b.add(mesh(G.body, matScene));
    const w = mesh(G.wings, matScene); w.userData = { role: 'wings' }; b.add(w);
    if (G.eyes) b.add(mesh(G.eyes, matGlow, false));
    g.add(b);
  }
  return g;
}
function haystacksGeo(v) {
  return cached(`hay:${v}`, () => {
    const T = new Tris(), hay = (p, n) => mix(mix(THATCH_D, THATCH, clamp(0.5 + n[1] * 0.5 + p[1] * 0.3, 0, 1)), THATCH_L, clamp(hash(p[0] * 6, p[1] * 3, p[2] * 6) * 1.6 - 0.9, 0, 1));
    const stack = (x, z, s, sd) => T.at(x, 0, z, sd, s, 0, 0, () => { T.lathe([[0.4, 0], [0.46, 0.2], [0.42, 0.5], [0.26, 0.82], [0.07, 1.02]], 8, hay, { mod: (j, i) => 1 + (hash(j, i, sd) - 0.5) * 0.18 }); T.beam([0, 0.9, 0], [0.02, 1.28, 0], 0.045, 0.045, WOOD_D); });
    stack(-0.42, -0.3, 1, 1); stack(v === 1 ? 0.0 : 0.3, v === 1 ? 0.42 : -0.42, 0.78, 2.2);
    // hay cart
    T.at(v === 1 ? 0.42 : 0.28, 0, v === 1 ? -0.3 : 0.36, v === 1 ? 1.2 : -0.35, 1, 0, 0, () => {
      T.box([0, 0.3, 0], [0.36, 0.035, 0.24], WOOD);
      for (const s of [-1, 1]) { T.box([0, 0.4, s * 0.23], [0.36, 0.08, 0.02], WOOD_L); for (const k of [-1, 0, 1]) T.beam([k * 0.3, 0.3, s * 0.24], [k * 0.3, 0.56, s * 0.27], 0.035, 0.035, WOOD_D);
        T.at(-0.05, 0.2, s * 0.3, 0, 1, PI / 2, 0, () => { T.lathe([[0.2, -0.025], [0.2, 0.025]], 8, WOOD_D, { capBot: true }); T.lathe([[0.05, -0.04], [0.05, 0.04]], 6, 0x3a3a3a, { capBot: true }); });
        T.beam([0.34, 0.3, s * 0.16], [0.95, 0.12, s * 0.16], 0.04, 0.04, WOOD_L); }
      T.blob([0, 0.5, 0], [0.38, 0.24, 0.24], hay, { kind: 'i0', jag: 0.2, seed: 5, floor: -0.5 });
      T.beam([0.6, 0.02, 0], [0.6, 0.22, 0], 0.04, 0.04, WOOD_D);
    });
    T.patch([-0.05, 0, 0], 0.72, 0.62, 8, 0xb8a050, 0x9a8a48, { y: 0.012, seed: v });
    return T.geo();
  });
}
function fishingHutGeo(v) {
  return cached(`fhut:${v}`, () => {
    const T = new Tris(), x0 = -1.0, x1 = 0.1, z0 = -0.7, z1 = 0.15, wh = 0.72, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, tar = [[TAR, 0x342c26, 0x3e342c, 0x241e1a], [0x5a2a22, 0x6a3228, 0x4c221c, 0x74382c], [0x3a4640, 0x2e3a36, 0x46524a, 0x343e3a]][v];
    const strip = (a, b, cols) => { for (let c = 0; c < cols; c++) { const p = vlerp(a, b, c / cols), q = vlerp(a, b, (c + 1) / cols); T.quad([p[0], 0, p[2]], [q[0], 0, q[2]], [q[0], wh, q[2]], [p[0], wh, p[2]], tar[(c * 3 + Math.round(a[0] * 3 + a[2] * 5)) & 3], [cx, 0.4, cz]); } };
    strip([x0, 0, z1], [x1, 0, z1], 6); strip([x0, 0, z0], [x1, 0, z0], 6); strip([x0, 0, z0], [x0, 0, z1], 5); strip([x1, 0, z0], [x1, 0, z1], 5);
    const yR = 1.38;
    for (const x of [x0, x1]) T.face([x, wh, z0], [x, wh, z1], [x, yR - 0.04, cz], tar[1], [cx, 1, cz]);
    gableRoof(T, x0 - 0.1, x1 + 0.1, z0 - 0.14, z1 + 0.14, wh - 0.08, yR, 0.06, v === 1 ? [0x5a5e64, 0x6a6e74, 0x4c5056] : [0x6a8a44, 0x7c9a50, 0x587838, 0x8a8a50], 3, v === 1 ? 0x3a3e44 : 0x4a3a28);
    T.box([cx + 0.1, 0.27, z1 + 0.012], [0.15, 0.27, 0.02], [0xa84a28, 0xd8c8a0, 0xa84a28][v]); T.box([cx - 0.32, 0.42, z1 + 0.012], [0.09, 0.09, 0.02], 0xd8c070);
    T.box([cx - 0.2, 1.5, cz], [0.07, 0.12, 0.07], 0x4a4644);
    // net poles with a draped net and floats
    const net = [0x6a8a80, 0x587870], px = [0.36, 1.0], pz = -0.5;
    for (const x of px) { T.beam([x, 0, pz], [x, 1.2, pz], 0.06, 0.06, WOOD_L); T.beam([x, 0, pz + 0.02], [x + (x > 0.5 ? 0.14 : -0.14), 0.0, pz + 0.3], 0.03, 0.03, WOOD_L); }
    T.beam([px[0] - 0.06, 1.14, pz], [px[1] + 0.06, 1.14, pz], 0.045, 0.045, WOOD);
    for (let k = 0; k < 4; k++) { const xa = lerp(px[0], px[1], k / 4), xb = lerp(px[0], px[1], (k + 1) / 4), sag = (u) => 0.5 - Math.sin(u * PI) * 0.16 + (u * 0.1); T.quad([xa, 1.12, pz], [xb, 1.12, pz], [xb + 0.02, sag((k + 1) / 4), pz + 0.16], [xa + 0.02, sag(k / 4), pz + 0.16], net[k % 2]); T.blob([xa + 0.08, sag((k + 0.5) / 4) + 0.02, pz + 0.17], 0.04, k % 2 ? 0xe8842a : 0xd8d0b0, { kind: 'o0' }); }
    // drying rack with fish
    const rz = 0.62;
    for (const x of [-0.9, -0.2]) for (const s of [-1, 1]) T.beam([x, 0, rz + s * 0.16], [x, 0.66, rz], 0.04, 0.04, WOOD_L);
    T.beam([-0.96, 0.64, rz], [-0.14, 0.64, rz], 0.04, 0.04, WOOD);
    for (let k = 0; k < 5; k++) { const x = -0.84 + k * 0.145; T.face([x - 0.035, 0.62, rz], [x + 0.035, 0.62, rz], [x, 0.36, rz + 0.02], k % 2 ? 0xc8ccd0 : 0xa8b4bc); T.face([x - 0.03, 0.34, rz + 0.02], [x + 0.03, 0.34, rz + 0.02], [x, 0.4, rz + 0.02], 0x8a949c); }
    // lobster pots and a barrel
    const pot = (x, z, ry) => T.at(x, 0, z, ry, 1, 0, 0, () => { T.tube([[-0.16, 0.1, 0], [0.16, 0.1, 0]], [[0.12, 0.12]], 6, (p, n, lp) => (Math.round(lp[0] * 14) % 2 ? 0xb89a60 : 0x7a6038), { a0: 0 }); T.box([0, 0.012, 0], [0.18, 0.014, 0.13], WOOD_D); });
    pot(0.42, 0.3, 0.3); pot(0.78, 0.48, -0.5); if (v !== 2) pot(0.6, 0.38, 0.1), T.at(0.6, 0.2, 0.38, 0.9, 1, 0, 0, () => T.tube([[-0.16, 0.1, 0], [0.16, 0.1, 0]], [[0.12, 0.12]], 6, (p, n, lp) => (Math.round(lp[0] * 14) % 2 ? 0xc8a868 : 0x86683c)));
    T.lathe([[0.1, 0], [0.13, 0.15], [0.1, 0.32]], 7, (p, n, lp) => (Math.abs(lp[1] - 0.08) < 0.03 || Math.abs(lp[1] - 0.25) < 0.03 ? 0x3a3a3a : WOOD), { x: 0.3, z: -0.1 });
    T.tube([[0.9, 0.03, 0.0], [1.0, 0.03, -0.1], [0.92, 0.03, -0.22], [0.8, 0.03, -0.12], [0.9, 0.05, 0.0]], 0.035, 4, 0xc8b078);   // coiled rope
    return T.geo();
  });
}
function rowboatGeo(v) {
  return cached(`rowboat:${v}`, () => {
    const T = new Tris(), paint = [[0xb8342a, 0xf0ece0], [0x2f5a8a, 0xf0ece0], [0x3d6a3a, 0xe8d8a8]][v], st = [[-0.86, 0.26, 0.1, 0.34], [-0.6, 0.33, 0.04, 0.3], [-0.2, 0.37, 0.0, 0.28], [0.25, 0.34, 0.0, 0.28], [0.62, 0.22, 0.04, 0.32], [0.9, 0.0, 0.16, 0.4]];
    // stations: [x, half beam, keel y, sheer y]; three strakes a side
    const pts = st.map(([x, b, yk, ys]) => [[x, yk, 0], [x, lerp(yk, ys, 0.3), b * 0.62], [x, lerp(yk, ys, 0.68), b * 0.92], [x, ys, b]]);
    T.at(0, 0.0, 0, 0, 1, 0.2, 0, () => {
      for (let i = 0; i < st.length - 1; i++) for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const f = ([x, y, z]) => [x, y, z * s]; T.quad(f(pts[i][k]), f(pts[i + 1][k]), f(pts[i + 1][k + 1]), f(pts[i][k + 1]), k === 2 ? paint[0] : k === 1 ? paint[1] : tone(paint[1], -0.1), [(st[i][0] + st[i + 1][0]) / 2, 0.5, 0]); }
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) T.face([pts[0][0][0], pts[0][0][1], 0], [pts[0][k][0], pts[0][k][1], pts[0][k][2] * s], [pts[0][k + 1][0], pts[0][k + 1][1], pts[0][k + 1][2] * s], WOOD, [0, 0.2, 0]);
      for (const x of [-0.42, 0.18]) { const b = 0.35; T.box([x, 0.2, 0], [0.07, 0.015, b], WOOD_L); }
      T.box([-0.78, 0.22, 0], [0.07, 0.015, 0.27], WOOD_L);
      T.beam([-0.86, 0.04, 0], [0.86, 0.0, 0], 0.05, 0.06, WOOD_D); T.beam([0.84, 0.04, 0], [0.96, 0.46, 0], 0.05, 0.06, WOOD_D);
      for (const s of [-1, 1]) { T.beam([-0.5, 0.25, s * 0.14], [0.55, 0.2, s * 0.1], 0.035, 0.035, WOOD_L); T.box([0.62, 0.2, s * 0.09], [0.12, 0.012, 0.05], WOOD_L, s * 0.1); }
    });
    T.beam([-0.5, 0, -0.42], [-0.5, 0.22, -0.3], 0.05, 0.05, WOOD_D);
    T.tube([[0.93, 0.36, 0.06], [1.0, 0.1, 0.2], [0.9, 0.03, 0.42]], 0.022, 3, 0xc8b078);
    return T.geo();
  });
}
function stoneWallGeo(v) {
  return cached(`swall:${v}`, () => {
    const R = rng(v * 7 + 1), T = new Tris(), rows = 3;
    for (let r = 0; r < rows; r++) {
      const n = 6 + ((r + v) % 2), w = 2 / n, y = 0.07 + r * 0.125;
      for (let k = 0; k < n; k++) { const x = -1 + (k + 0.5) * w, c = stoneCol(k + r * 9 + v * 31, r); T.box([x, y + (R() - 0.5) * 0.012, (R() - 0.5) * 0.03], [w * 0.5 - 0.004, 0.066, 0.13 - r * 0.012 + R() * 0.02], c, (R() - 0.5) * 0.12, 0, 0, false); }
    }
    for (let k = 0; k < 8; k++) { const x = -1 + (k + 0.5) * (2 / 8); T.box([x, 0.425 + R() * 0.02, 0], [0.118, 0.045 + R() * 0.025, 0.1 + R() * 0.03], stoneCol(k + 50 + v, 5), (R() - 0.5) * 0.2, 0, (R() - 0.5) * 0.3); }
    for (let k = 0; k < 4; k++) { const x = -0.8 + k * 0.5 + R() * 0.1, s = k % 2 ? 1 : -1; for (let b = -1; b <= 1; b++) T.face([x + b * 0.04 - 0.03, 0, s * 0.17], [x + b * 0.04 + 0.03, 0, s * 0.19], [x + b * 0.09, 0.13 + (b ? 0 : 0.05), s * 0.22], b ? GRASS_D : LEAF_L); if (k % 2) T.face([x - 0.05, 0.3, s * 0.146], [x + 0.06, 0.26, s * 0.146], [x + 0.01, 0.18, s * 0.148], 0x6a9a4a); }
    return T.geo();
  });
}
function wildflowersGeo(v) {
  return cached(`wflow:${v}`, () => {
    const R = rng(v * 23 + 9), T = new Tris();
    T.patch([0, 0, 0], 0.6, 0.56, 9, GRASS, GRASS_D, { y: 0.03, seed: v, jag: 0.2 });
    // heather mounds
    const heath = [0xb04a9a, 0xc86ab0, 0x8a3a8a, 0xd88ac0];
    for (let k = 0; k < 4 + (v % 2); k++) { const a = k * 1.9 + v, r = 0.18 + R() * 0.24, x = Math.cos(a) * r, z = Math.sin(a) * r; T.blob([x, 0.05, z], [0.15 + R() * 0.05, 0.13 + R() * 0.05, 0.14 + R() * 0.05], (p, n) => (n[1] > 0.1 ? heath[Math.floor(hash(p[0] * 9, p[2] * 9) * 4)] : 0x3f6a34), { kind: 'i0', jag: 0.25, seed: k + v, floor: -0.3 }); }
    // foxgloves: tall spikes of bells
    for (let k = 0; k < 3 + (v === 2 ? 1 : 0); k++) { const a = k * 2.3 + 1 + v * 0.7, r = 0.1 + R() * 0.3, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.62 + R() * 0.25, lean = (R() - 0.5) * 0.12;
      T.beam([x, 0, z], [x + lean, h * 0.5, z], 0.03, 0.03, 0x3f7a34, [0, 0]);
      T.lathe([[0.05, h * 0.4], [0.065, h * 0.55], [0.04, h * 0.85], [0.01, h]], 5, (p, n, lp) => [0xd8489a, 0xe86ab0, 0xc03a8a, 0xf4a0cc][Math.floor(hash(Math.round(lp[1] * 14), Math.round(Math.atan2(lp[2] - z, lp[0] - x) * 2)) * 4)], { x: x + lean, z, mod: (j, i) => 1 + (j % 2) * 0.25 });
      for (const s of [-1, 1]) T.face([x, 0.04, z], [x + s * 0.16, 0.12, z + 0.05], [x + s * 0.08, 0.2, z - 0.05], 0x4f8a3a); }
    // daisies
    for (let k = 0; k < 7; k++) { const a = k * 2.4 + v * 1.3, r = 0.3 + R() * 0.24, x = Math.cos(a) * r, z = Math.sin(a) * r, y = 0.1 + R() * 0.08, pr = 0.065 + R() * 0.02;
      T.face([x - 0.015, 0, z], [x + 0.015, 0, z], [x, y, z], 0x4f8a3a);
      for (let j = 0; j < 6; j++) { const a0 = (j / 6) * TAU, a1 = ((j + 0.8) / 6) * TAU; T.face([x, y + 0.012, z], [x + Math.cos(a0) * pr, y, z + Math.sin(a0) * pr], [x + Math.cos(a1) * pr, y, z + Math.sin(a1) * pr], j % 2 ? 0xffffff : 0xf0f0e4); }
      T.face([x - 0.03, y + 0.02, z - 0.02], [x + 0.03, y + 0.02, z - 0.02], [x, y + 0.02, z + 0.034], 0xf2c020); }
    return T.geo();
  });
}

const temperate = {
  /** broad oak, 2.4 across, 3 high. userData.crown sways */
  oak(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = oakGeo(v), g = new THREE.Group();
    g.add(mesh(G.trunk, matScene), part(G.crown, matScene, 'sway', { amp: 0.022, rate: 0.9, ph: (s % 17) * 0.7 }, [0, G.py, 0]));
    return finish(g, 'oak', v, { crown: ['sway', 1] });
  },
  /** two or three dark pines, 1.6 across, up to 3.6 high. userData.trees sway */
  pineStand(seed) {
    mats(); const s = seedOf(seed), v = s % 3, g = new THREE.Group();
    const lay = [[[0, 0.05, -0.25, 1], [1, 0.5, 0.32, 1], [2, -0.48, 0.3, 1]], [[3, -0.3, -0.1, 1], [1, 0.42, 0.15, 0.95]], [[0, -0.4, 0.2, 0.94], [3, 0.42, -0.2, 0.9], [2, 0.1, 0.5, 1.05]]][v];
    lay.forEach(([k, x, z, sc], i) => { const m = part(pineGeo(k), matScene, 'sway', { amp: 0.016, rate: 1.1, ph: s * 0.9 + i * 2.1 }); m.position.set(x, 0, z); m.scale.setScalar(sc); m.rotation.y = i * 1.3 + s; g.add(rest(m)); });
    return finish(g, 'pineStand', v, { trees: ['sway', 0] });
  },
  /** fisher's cottage 2.2 x 1.8 with a garden (door faces +Z). userData.smoke = chimney puffs */
  cottage(seed) {
    mats(); const s = seedOf(seed), v = s % 3, g = new THREE.Group();
    g.add(mesh(cottageGeo(v), matScene));
    smoke(g, 3, [-1.0, 1.98, -0.2], { rise: 0.85, s0: 0.07, s1: 0.2, rate: 0.2, drift: [0.3, 0.08], tint: 0, seed: s });
    return finish(g, 'cottage', v, { smoke: ['puff', 0] });
  },
  /** banded lighthouse on a rock, 2 across, 6.5 high. userData.lamp turns; userData.lampHeight */
  lighthouse(seed) {
    mats(); const s = seedOf(seed), v = s % 2, G = lighthouseGeo(v), g = new THREE.Group();
    const lamp = part(G.lamp, matGlow, 'lamp', { rate: 0.9, ph: s * 1.1 }, [0, 5.1, 0], false);
    lamp.add(mesh(G.beam, matBeam, false));
    g.add(mesh(G.body, matScene), lamp);
    return finish(g, 'lighthouse', v, { lamp: ['lamp', 1] }, { lampHeight: 5.1 });
  },
  /** post mill, 2 across at the foot (sails sweep 3 wide), 4.2 high, sails face +Z. userData.sails turns */
  windmill(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = windmillGeo(v), g = new THREE.Group();
    const sails = part(G.sails, matScene, 'spin', { rate: 0.55, ph: (s % 13) * 0.4 }, G.hub);
    g.add(mesh(G.body, matScene), sails);
    return finish(g, 'windmill', v, { sails: ['spin', 1] });
  },
  /** five or six sheep and a lamb over 2 tiles. userData.animals */
  sheepFlock(seed) {
    const s = seedOf(seed), R = rng(s * 13 + 1), g = new THREE.Group(), n = 5 + (s % 2), P = spots(R, n + 1, 0.82, 0.42), face = R() * TAU;
    for (let i = 0; i <= n; i++) { const lamb = i === n, a = animal(sheepGeo(lamb ? 0 : i === 2 ? 1 + (s % 2) : 0), 'graze', { ph: R() * 40, rate: 0.8 + R() * 0.4, down: 0.95 }); let [x, z] = P[i]; if (lamb) { x = P[0][0] + 0.26; z = P[0][1] + 0.12; } g.add(place(a, x, 0, z, R() < 0.6 ? face + (R() - 0.5) * 1.2 : R() * TAU, lamb ? 0.6 : 0.95 + R() * 0.15)); }
    return finish(g, 'sheepFlock', 0, { animals: ['animal', 0] });
  },
  /** a stag and a doe, 1.2 across. userData.animals */
  deer(seed) {
    const s = seedOf(seed), R = rng(s * 5 + 3), g = new THREE.Group(), a0 = R() * TAU;
    g.add(place(animal(deerGeo(0), 'graze', { ph: R() * 30, rate: 0.7, down: 0.25, shy: 1 }), -0.22, 0, 0.05, a0, 1));
    g.add(place(animal(deerGeo(1), 'graze', { ph: R() * 30, rate: 0.9, down: 1.5 }), 0.28, 0, -0.1, a0 + 0.9 + R() * 0.8, 1));
    return finish(g, 'deer', 0, { animals: ['animal', 0] });
  },
  /** six gulls wheeling 2-4 above the ground over 3 tiles. userData.birds */
  gullFlock(seed) {
    const s = seedOf(seed), g = flock('gull', 6, s, { spread: 0.5, r0: 0.7, r1: 1.2, h0: 2.1, h1: 3.8, speed: 0.75, bob: 0.14, flapRate: 9, flapAmp: 0.9, glide: 0.35, bank: 0.35, burst: 0.5, size: 1.05 });
    return finish(g, 'gullFlock', 0, { birds: ['flyer', 0] });
  },
  /** two haystacks and a hay cart, 1.6 across */
  haystacks(seed) { mats(); const v = seedOf(seed) % 2; return finish(mesh(haystacksGeo(v), matScene), 'haystacks', v); },
  /** tarred fishing hut 2.2 x 1.6 with nets, pots and a drying rack (door faces +Z) */
  fishingHut(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(fishingHutGeo(v), matScene), 'fishingHut', v); },
  /** clinker rowboat 1.8 long (bow +X), heeled over on the shore */
  rowboat(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(rowboatGeo(v), matScene), 'rowboat', v); },
  /** dry-stone wall, 2 long along X, 0.5 high; butt copies end to end */
  stoneWall(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(stoneWallGeo(v), matScene), 'stoneWall', v); },
  /** heather, foxgloves and daisies, 1.2 across */
  wildflowers(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(wildflowersGeo(v), matScene), 'wildflowers', v); },
};

// =====================================================================================
// DESERT
// =====================================================================================
const SAND = 0xcfaa66, SAND_L = 0xdcbc7c, SAND_D = 0xae8850, ROCKS = [0xc8743c, 0xd89858, 0xb85a30, 0xe4b070, 0xa84a28], MARBLE = 0xc4ae82, MARBLE_D = 0xa08a5e, MARBLE_L = 0xd6c298;
const MUD = [0xc49a62, 0xb48a54, 0xd4aa72, 0xa87c48], CAMEL = 0xc8a064, CAMEL_D = 0x9a7646, CAMEL_L = 0xdcc090, PALM = 0x4c8a3a, PALM_D = 0x35702c, PALM_L = 0x7aa844, BLEACH = 0xb8ac90, BLEACH_D = 0x857a62;
const strata = (seed = 0) => (p) => { const b = Math.floor(p[1] * 2.5 + 0.02 + seed * 0.4); return tone(ROCKS[(b * 2 + seed) % 5], (hash(Math.round(p[0] * 3), b, Math.round(p[2] * 3)) - 0.5) * 0.07); };
const sandCol = (p, n) => mix(SAND_D, mix(SAND, SAND_L, hash(p[0] * 4, p[2] * 4)), clamp(0.3 + n[1] * 0.8, 0, 1));
/** a low drift of sand (or ash) heaped at c */
function drift(T, c, r, col = sandCol, seed = 0) { return T.blob([c[0], c[1] ?? 0, c[2]], r, col, { kind: 'o1', jag: 0.16, seed, floor: 0 }); }

function datePalmGeo(v) {
  return cached(`dpalm:${v}`, () => {
    const R = rng(v * 41 + 7), T = new Tris(), C = new Tris(), H = [3.35, 3.7, 3.0][v], bend = [0.45, -0.3, 0.7][v], bz = [0.1, 0.25, -0.2][v], pts = [], rad = [];
    for (let i = 0; i <= 9; i++) { const u = i / 9; pts.push([bend * u * u, u * H, bz * u * u]); rad.push((u < 0.12 ? lerp(0.24, 0.15, u / 0.12) : lerp(0.15, 0.11, u)) * (1 + (i % 2) * 0.16)); }
    T.tube(pts, rad, 6, (p) => (Math.floor(p[1] * 5.4) % 2 ? 0x8a6a48 : 0x6a4e34), { caps: [0, 1] });
    T.patch([0, 0, 0], 0.4, 0.4, 6, SAND_L, SAND, { y: 0.03, seed: v });
    // crown, built about the top of the trunk
    C.blob([0, 0.02, 0], [0.19, 0.2, 0.19], (p, n) => (n[1] > 0 ? PALM_D : 0x7a5a38), { kind: 'o1', jag: 0.1 });
    const nf = 10 + (v % 2);
    for (let f = 0; f < nf + 3; f++) {
      const young = f >= nf, a = young ? f * 2.1 : (f / nf) * TAU + R() * 0.3, L = young ? 0.8 : 1.35 + R() * 0.3, up = young ? 1.0 : 0.5 + R() * 0.16, dr = young ? 0.45 : 0.85 + R() * 0.25, ca = Math.cos(a), sa = Math.sin(a), seg = 4, rib = [], lf = [], rt = [];
      for (let k = 0; k <= seg; k++) { const u = k / seg, r = L * u * (young ? 0.5 : 1), y = L * (up * u - dr * u * u) + 0.08, w = 0.2 * Math.sin(PI * (u * 0.8 + 0.12)) * (young ? 0.7 : 1); rib.push([ca * r, y, sa * r]); lf.push([ca * r - sa * w, y - w * 0.45, sa * r + ca * w]); rt.push([ca * r + sa * w, y - w * 0.45, sa * r - ca * w]); }
      for (let k = 0; k < seg; k++) { const c = k === seg - 1 ? PALM_L : (k + f) % 2 ? PALM : PALM_D; C.quad(rib[k], rib[k + 1], lf[k + 1], lf[k], c).quad(rib[k], rib[k + 1], rt[k + 1], rt[k], tone(c, -0.04)); }
    }
    for (let k = 0; k < 4; k++) { const a = k * 1.7 + v, x = Math.cos(a) * 0.2, z = Math.sin(a) * 0.2; C.beam([x * 0.5, 0, z * 0.5], [x * 1.3, -0.2, z * 1.3], 0.03, 0.03, 0xc8a040, [0, 0]); C.blob([x * 1.35, -0.36, z * 1.35], [0.1, 0.2, 0.1], (p, n) => (hash(p[0] * 20, p[1] * 20, p[2] * 20) > 0.5 ? 0xd88a20 : 0x9a3c16), { kind: 'i0', jag: 0.12, seed: k }); }
    return { trunk: T.geo(), crown: C.geo(), top: pts[9] };
  });
}
function saguaroGeo(v) {
  return cached(`saguaro:${v}`, () => {
    const T = new Tris(), H = [2.35, 2.1, 2.4][v], G1 = 0x4e8a4a, G2 = 0x3a6e3c, G3 = 0x6aa058;
    const rib = (p, n, lp) => (hash(Math.round(Math.atan2(lp[2], lp[0]) * 4), 1) > 0.5 ? G1 : G2);
    T.lathe([[0.2, 0], [0.25, 0.3], [0.25, H - 0.6], [0.22, H - 0.25], [0.12, H - 0.04], [0.02, H]], 8, (p, n, lp) => (lp[1] > H - 0.12 ? G3 : rib(p, n, lp)), { mod: (j) => (j % 2 ? 0.8 : 1) });
    const arms = [[[1, 0.85, 1.95, 0.52], [-1, 1.15, 1.75, 0.46]], [[1, 0.7, 1.5, 0.48], [-1, 1.0, 2.0, 0.5], [0.3, 1.3, 1.9, -0.44]], [[-1, 0.9, 2.1, 0.55]]][v], tops = [[0, H, 0]];
    for (const [sx, y0, y1, out] of arms) {
      const dz = sx === 0.3 ? out : 0, dx = sx === 0.3 ? 0.05 : sx * out;
      T.tube([[dx * 0.3, y0 - 0.05, dz * 0.3], [dx * 0.85, y0, dz * 0.85], [dx, y0 + 0.22, dz], [dx, y1 - 0.1, dz], [dx, y1, dz]], [0.14, 0.15, 0.155, 0.15, 0.06], 6, (p, n) => (p[1] > y1 - 0.08 ? G3 : hash(Math.round(n[0] * 3), Math.round(n[2] * 3)) > 0.5 ? G1 : G2), { caps: [0, 1] });
      tops.push([dx, y1, dz]);
    }
    tops.forEach(([x, y, z], i) => { if ((i + v) % 3 === 2) { T.blob([x + 0.04, y + 0.02, z], [0.06, 0.07, 0.06], 0xc8283a, { kind: 'o0' }); return; } for (let j = 0; j < 5; j++) { const a = (j / 5) * TAU; T.face([x, y + 0.03, z], [x + Math.cos(a) * 0.13, y + 0.06, z + Math.sin(a) * 0.13], [x + Math.cos(a + 0.9) * 0.13, y + 0.06, z + Math.sin(a + 0.9) * 0.13], 0xfff4e0); } T.blob([x, y + 0.06, z], 0.045, 0xf2c020, { kind: 'o0', jag: 0 }); });
    T.patch([0, 0, 0], 0.4, 0.38, 6, SAND_L, SAND, { y: 0.025, seed: v });
    for (let k = 0; k < 3; k++) T.blob([Math.cos(k * 2.2 + v) * 0.3, 0.02, Math.sin(k * 2.2 + v) * 0.3], [0.08, 0.06, 0.07], ROCKS[k], { kind: 'o0', jag: 0.3, seed: k });
    return T.geo();
  });
}
function rockArchGeo(v) {
  return cached(`arch:${v}`, () => {
    const R = rng(v * 29 + 3), T = new Tris(), col = strata(v), m = v === 1 ? -1 : 1, hs = [1, 1.0, 0.9][v];
    const pillar = (x0, x1, r0, r1, h, n, z = 0) => { const rings = []; for (let i = 0; i <= 5; i++) { const u = i / 5, cx = lerp(x0, x1, u * u) * m, r = lerp(r0, r1, u) * (1 + (i % 2 ? 0.1 : -0.04)), ring = []; for (let j = 0; j < n; j++) { const a = (j / n) * TAU + i * 0.3; ring.push([cx + Math.cos(a) * r * (0.86 + R() * 0.28), u * h, z - Math.sin(a) * r * 0.8 * (0.86 + R() * 0.28)]); } rings.push(ring); } T.stack(rings, col, true, false); };
    pillar(-1.05, -0.82, 0.5, 0.4, 2.0 * hs, 7); pillar(1.12, 0.9, 0.36, 0.3, 1.75 * hs, 6);
    const span = [[-0.95 * m, 1.95 * hs, 0], [-0.4 * m, 2.24 * hs, 0.03], [0.25 * m, 2.24 * hs, 0], [0.98 * m, 1.72 * hs, -0.02]];
    T.tube(span, [[0.36, 0.4], [0.3, 0.32], [0.27, 0.27], [0.3, 0.3]], 7, col);
    T.blob([-0.7 * m, 2.42 * hs, 0], [0.4, 0.24, 0.34], col, { kind: 'i0', jag: 0.2, seed: v });
    if (v === 2) pillar(-0.2, -0.3, 0.3, 0.16, 1.1, 5, 0.75);
    for (let k = 0; k < 5; k++) { const a = k * 1.3 + v, x = (k % 2 ? 1.1 : -1.1) * m + Math.cos(a) * 0.45, z = Math.sin(a) * 0.5; T.blob([x, 0.04, z], [0.16 + R() * 0.12, 0.14 + R() * 0.1, 0.15 + R() * 0.1], col, { kind: 'i0', jag: 0.25, seed: k, floor: -0.3 }); }
    drift(T, [-1.0 * m, 0, 0.42], [0.6, 0.2, 0.36], sandCol, 1); drift(T, [1.0 * m, 0, -0.38], [0.5, 0.16, 0.3], sandCol, 2);
    return T.geo();
  });
}
/** a crescent dune w x d, crest h; horns trail toward +Z (downwind) */
function duneGeo(key, v, w, d, h, pal) {
  return cached(`${key}:${v}`, () => {
    const T = new Tris(0.8), hw = w / 2, hd = d / 2, sk = [0, 0.25, -0.2][v];
    const f = (u, vv) => {
      const x = (u - 0.5) * w, z = (vv - 0.5) * d, xn = x / hw, zc = (-0.3 + 0.62 * xn * xn + sk * xn) * hd, dd = (z - zc) / hd;
      const env = Math.max(0, 1 - xn * xn) ** 0.7, body = dd < 0 ? smooth(1 + dd / 0.62) : Math.max(0, 1 - dd / 0.2);
      const edge = clamp((1 - xn * xn - (z / hd) ** 2) * 3.5, 0, 1);
      return [x, h * env * body * edge * (1 + Math.sin(xn * 5 + v) * 0.08), z, dd];
    };
    T.sheet(16, 10, (u, vv) => f(u, vv).slice(0, 3), (p, n, lp, u, vv) => { const dd = f(u, vv)[3]; if (p[1] < 0.012) return null; if (dd > 0.0) return pal[3]; return Math.sin(dd * 34 + p[0] * 2.5) > 0.1 ? pal[0] : pal[2]; });
    return T;
  });
}
function nomadTentGeo(v) {
  return cached(`tent:${v}`, () => {
    const T = new Tris(), F = new Tris(0), dark = [0x2e2620, 0x3a2e26], pal = [[0x2e2620, 0xd8c8a0, 0x3a2e26, 0x8a2a20, 0x2e2620, 0xd8c8a0], [0x3a2e26, 0x2e2620, 0xc8b890, 0x2e2620, 0x1f4a6a, 0x3a2e26], [0x5a3a28, 0xd8c8a0, 0x8a2a20, 0x5a3a28, 0xd8c8a0, 0x3a2e26]][v];
    const X0 = -1.28, X1 = 1.28, Z0 = -0.86, Z1 = 0.5, pole = [-0.82, 0, 0.82];
    const hz = (vv) => (vv < 0.45 ? lerp(0.62, 1.5, vv / 0.45) : lerp(1.5, 1.08, (vv - 0.45) / 0.55));
    const roof = (u, vv) => { const x = lerp(X0, X1, u), near = Math.min(...pole.map((p) => Math.abs(x - p))), end = smooth(Math.min(u, 1 - u) / 0.14); return [x, hz(vv) * lerp(0.55, 1, end) - near * 0.22 * end, lerp(Z0, Z1, vv)]; };
    T.sheet(8, 6, roof, (p, n, lp, u, vv) => pal[Math.floor(vv * 6) % 6], [0, 0, 0]);
    // back and end walls hang to the ground
    for (let i = 0; i < 8; i++) { const a = roof(i / 8, 0), b = roof((i + 1) / 8, 0); T.quad(a, b, [b[0], 0, Z0 - 0.1], [a[0], 0, Z0 - 0.1], dark[i % 2], [0, 0.5, 0]); }
    for (const u of [0, 1]) for (let j = 0; j < 6; j++) { const a = roof(u, j / 6), b = roof(u, (j + 1) / 6), ox = u ? 0.12 : -0.12; T.quad(a, b, [b[0] + ox, 0, b[2]], [a[0] + ox, 0, a[2]], dark[j % 2], [0, 0.5, 0]); }
    // poles, guy ropes and pegs
    for (const x of pole) { T.beam([x, 0, -0.25], [x, 1.66, -0.25], 0.06, 0.06, WOOD_L); T.beam([x, 0, Z1], [x, 1.14, Z1], 0.05, 0.05, WOOD_L); T.beam([x, 1.08, Z1], [x * 1.12, 0.02, 0.97], 0.02, 0.02, 0xd8c8a0, [0, 0]); T.beam([x * 1.12, 0, 0.97], [x * 1.13, 0.12, 0.99], 0.04, 0.04, WOOD_D); }
    for (const s of [-1, 1]) { T.beam([s * 1.28, 0.6, 0.3], [s * 1.5, 0.02, 0.6], 0.02, 0.02, 0xd8c8a0, [0, 0]); T.beam([s * 1.5, 0, 0.6], [s * 1.52, 0.12, 0.61], 0.04, 0.04, WOOD_D); }
    // carpets and cushions
    const rug = (x, z, hw, hd, ry, c1, c2, c3) => T.at(x, 0.014, z, ry, 1, 0, 0, () => { T.quad([-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], c2); T.quad([-hw * 0.84, 0.004, -hd * 0.76], [hw * 0.84, 0.004, -hd * 0.76], [hw * 0.84, 0.004, hd * 0.76], [-hw * 0.84, 0.004, hd * 0.76], c1); for (let k = -2; k <= 2; k++) T.quad([k * hw * 0.3, 0.008, -hd * 0.3], [k * hw * 0.3 + hw * 0.12, 0.008, 0], [k * hw * 0.3, 0.008, hd * 0.3], [k * hw * 0.3 - hw * 0.12, 0.008, 0], k % 2 ? c2 : c3); });
    rug(-0.35, -0.1, 0.62, 0.42, 0.05, 0xa8281e, 0x2a2a5a, 0xe8c860); rug(0.62, -0.25, 0.36, 0.5, -0.1, 0x1f5a6a, 0xd8c8a0, 0xb8342a);
    const cush = [[-0.8, -0.5, 0xb8342a], [-0.45, -0.58, 0xe0a030], [-0.1, -0.56, 0x2f5a8a], [0.7, -0.6, 0x7a2a6a], [-0.95, -0.15, 0x2a7a5a]];
    cush.forEach(([x, z, c], i) => T.blob([x, 0.07, z], [0.14, 0.07, 0.11], c, { kind: 'o0', jag: 0.1, seed: i, ry: i }));
    T.lathe([[0.13, 0], [0.16, 0.16], [0.08, 0.3]], 6, (p) => (p[1] > 0.22 ? 0x7a5a38 : 0xa85a2a), { x: 0.98, z: -0.55 });   // water jar
    // the fire out front with the coffee pot
    const fx = 0.2, fz = 0.72;
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; T.blob([fx + Math.cos(a) * 0.17, 0.03, fz + Math.sin(a) * 0.17], [0.06, 0.05, 0.06], [0x6a625a, 0x4a4440, 0x8a8278][k % 3], { kind: 'o0', jag: 0.2, seed: k }); }
    T.beam([fx - 0.14, 0.03, fz - 0.06], [fx + 0.14, 0.05, fz + 0.06], 0.05, 0.05, 0x241a14); T.beam([fx - 0.08, 0.03, fz + 0.12], [fx + 0.08, 0.05, fz - 0.12], 0.05, 0.05, 0x2a1e16);
    T.lathe([[0.075, 0.08], [0.095, 0.15], [0.05, 0.25], [0.065, 0.3], [0.02, 0.36]], 6, (p, n) => mix(0x9a6a18, 0xe8b838, 0.5 + n[1] * 0.3 + n[0] * 0.3), { x: fx + 0.02, z: fz });
    T.face([fx + 0.07, 0.22, fz], [fx + 0.2, 0.3, fz - 0.015], [fx + 0.2, 0.3, fz + 0.015], 0xe8b838); T.tube([[fx - 0.04, 0.26, fz], [fx - 0.13, 0.24, fz], [fx - 0.07, 0.13, fz]], 0.014, 3, 0x9a6a18);
    for (let k = 0; k < 3; k++) T.lathe([[0.03, 0], [0.035, 0.05]], 5, 0xf0e8d8, { x: fx - 0.3 + k * 0.07, z: fz + 0.12 - k * 0.05 });
    for (let k = 0; k < 5; k++) { const a = k * 1.3; F.face([Math.cos(a) * 0.1, 0.035, Math.sin(a) * 0.1], [Math.cos(a + 1.3) * 0.1, 0.035, Math.sin(a + 1.3) * 0.1], [Math.cos(a + 0.6) * 0.03, 0.07 + (k % 2) * 0.1, Math.sin(a + 0.6) * 0.03], k % 2 ? 0xffa020 : EMBER); }
    return { body: T.geo(), fire: F.geo(), fireAt: [fx, 0, fz] };
  });
}
function column(T, x, z, h, o = {}) {
  const { r = 0.17, cap = false, broken = false, seed = 0 } = o, flute = (j) => (j % 2 ? 0.86 : 1), n = 10, drum = 0.42;
  T.lathe([[r * 1.45, 0], [r * 1.45, 0.07], [r * 1.15, 0.13]], 8, MARBLE_D, { x, z, capTop: false });
  const prof = []; for (let y = 0.13; y < h - 0.001; y += drum) prof.push(y); prof.push(h);
  for (let i = 0; i < prof.length - 1; i++) { const c = [MARBLE, MARBLE_L, MARBLE_D, 0xd0bc90][Math.floor(hash(seed, i) * 4)], last = i === prof.length - 2;
    if (last && broken) { const ring = (y, jag) => { const o2 = []; for (let j = 0; j < n; j++) { const a = (j / n) * TAU; o2.push([x + Math.cos(a) * r * flute(j), y + (jag ? hash(j, seed) * 0.26 - 0.05 : 0), z - Math.sin(a) * r * flute(j)]); } return o2; }; T.stack([ring(prof[i], 0), ring(prof[i + 1], 1)], (p, nn) => (nn[1] > 0.6 ? MARBLE_L : c), true); }
    else T.lathe([[r * (1 - prof[i] * 0.03), prof[i] + 0.012], [r * (1 - prof[i + 1] * 0.03), prof[i + 1]]], n, c, { x, z, mod: flute, capTop: !cap || !last }); }
  if (cap) { T.lathe([[r * 0.95, h], [r * 1.5, h + 0.1]], 8, MARBLE_L, { x, z }); T.box([x, h + 0.14, z], [r * 1.6, 0.045, r * 1.6], MARBLE); }
}
/** an entablature block w long along X centred on the origin: architrave, a frieze of carved bars, a cornice */
function lintel(T, w, d = 0.2) {
  T.box([0, 0.07, 0], [w / 2, 0.07, d], MARBLE); T.box([0, 0.2, 0], [w / 2, 0.06, d * 0.92], MARBLE_D); T.box([0, 0.29, 0], [w / 2 + 0.03, 0.035, d * 1.15], MARBLE_L);
  const n = Math.round(w / 0.22); for (let k = 0; k < n; k++) for (const s of [-1, 1]) T.box([(k + 0.5) / n * w - w / 2, 0.2, s * d * 0.95], [w / n * 0.22, 0.05, 0.02], MARBLE_L);
}
function ruinColumnsGeo(v) {
  return cached(`ruincol:${v}`, () => {
    const T = new Tris(), z = -0.15;
    T.box([0, 0.07, z], [1.22, 0.07, 0.42], (p) => [MARBLE_D, 0xa8946c, 0xc4b084][Math.floor(hash(Math.round(p[0] * 2.4), 3) * 3)]); T.box([0, 0.0, z + 0.05], [1.3, 0.05, 0.56], 0xa8946c);
    const xs = [-0.9, -0.3, 0.3, 0.9], H = 2.5, plan = [[H, H, 1.55, 0.6], [0.9, H, H, 1.3], [H, 1.2, H, H]][v], pair = [[0, 1], [1, 2], [2, 3]][v];
    xs.forEach((x, i) => column(T, x, z, plan[i] + 0.14, { cap: plan[i] === H, broken: plan[i] < H, seed: i + v * 5 }));
    T.at((xs[pair[0]] + xs[pair[1]]) / 2, H + 0.32, z, 0, 1, 0, 0, () => lintel(T, 0.98));
    // the fallen lintel, a drum, and the drifts
    T.at(0.25, 0.02, 0.62, 0.22, 1, 0.12, -0.1, () => lintel(T, 1.0));
    T.at(-0.85, 0.15, 0.6, 0.6, 1, 0, PI / 2, () => T.lathe([[0.17, -0.2], [0.17, 0.2]], 10, MARBLE, { mod: (j) => (j % 2 ? 0.86 : 1), capBot: true }));
    T.at(1.05, 0.12, 0.45, 2.2, 1, 0.3, PI / 2, () => T.lathe([[0.17, -0.14], [0.17, 0.14]], 10, MARBLE_D, { mod: (j) => (j % 2 ? 0.86 : 1), capBot: true }));
    drift(T, [-1.05, 0, -0.1], [0.55, 0.3, 0.6], sandCol, 1); drift(T, [0.75, 0, -0.5], [0.7, 0.26, 0.4], sandCol, 2); drift(T, [0.2, 0, 0.9], [0.75, 0.14, 0.3], sandCol, 3); drift(T, [-0.3, 0, 0.2], [0.5, 0.2, 0.35], sandCol, 4);
    return T.geo();
  });
}
function camelGeo(kneel, pack) {
  return cached(`camel:${kneel}:${pack}`, () => {
    const B = new Tris(), Hd = new Tris(), by = kneel ? 0.34 : 0.86, col = (p, n) => (n[1] < -0.5 ? CAMEL_L : mix(CAMEL_D, CAMEL, clamp(0.55 + n[1] * 0.55, 0, 1)));
    B.spindle([[-0.44, by + 0.02, 0.08, 0.11], [-0.28, by + 0.02, 0.2, 0.22], [0.2, by, 0.2, 0.22], [0.38, by + 0.03, 0.1, 0.14]], 6, col);
    B.blob([0, by + 0.25, -0.06], [0.16, 0.22, 0.24], col, { kind: 'i0', jag: 0.06, seed: 2 });
    B.tube([[0, by + 0.08, -0.44], [0, by - 0.1, -0.5], [0, by - 0.3, -0.48]], [0.03, 0.02, 0.03], 3, CAMEL_D);
    if (kneel) { for (const s of [-1, 1]) { B.box([s * 0.17, 0.07, 0.24], [0.05, 0.07, 0.15], CAMEL_D, s * 0.06); B.box([s * 0.19, 0.08, -0.2], [0.06, 0.08, 0.17], CAMEL_D, -s * 0.08); } }
    else for (const [x, z] of [[-0.11, -0.3], [0.11, -0.3], [-0.11, 0.26], [0.11, 0.26]]) { B.tube([[x, by - 0.05, z], [x, 0.4, z + (z < 0 ? -0.04 : 0.03)], [x, 0.03, z]], [0.07, 0.05, 0.055], 4, CAMEL_D, { caps: [0, 0] }); }
    if (pack) {
      const c1 = [0xb8342a, 0x2f5a8a, 0x7a2a6a][pack - 1], c2 = [0xe8c860, 0xe8dcc0, 0xe0a030][pack - 1];
      for (let k = 0; k < 3; k++) B.box([0, by + 0.2, -0.22 + k * 0.16], [0.225 - (k % 2 ? 0 : 0.012), 0.2, 0.08], k % 2 ? c2 : c1);
      for (const s of [-1, 1]) { B.blob([s * 0.27, by + 0.12, -0.05], [0.1, 0.16, 0.2], (p, n) => mix(0x8a6a44, 0xc8b088, 0.5 + n[1] * 0.5), { kind: 'o0', jag: 0.12, seed: s + 2 }); }
      B.tube([[-0.22, by + 0.45, 0.02], [0.22, by + 0.45, -0.04]], 0.075, 6, (p, n, lp) => (Math.abs(lp[0]) > 0.19 ? 0x8a6a44 : Math.round(lp[0] * 12) % 2 ? c1 : 0xd8c8a0));
    }
    // neck and head, about the chest
    const ny = kneel ? 0.02 : 0;
    Hd.tube([[0, -0.03, -0.05], [0, 0.05 + ny, 0.16], [0, 0.3, 0.26], [0, 0.52, 0.24]], [[0.1, 0.13], [0.08, 0.1], [0.065, 0.075], [0.06, 0.065]], 5, col, { caps: [0, 0] });
    Hd.spindle([[0.16, 0.56, 0.065, 0.07], [0.3, 0.55, 0.06, 0.065], [0.44, 0.52, 0.05, 0.05], [0.5, 0.5, 0.035, 0.03]], 5, (p, n, lp) => (lp[2] > 0.45 ? 0x6a4e34 : col(p, n)));
    for (const s of [-1, 1]) { Hd.face([s * 0.04, 0.62, 0.2], [s * 0.09, 0.69, 0.17], [s * 0.05, 0.62, 0.25], CAMEL_D); Hd.face([s * 0.062, 0.58, 0.33], [s * 0.066, 0.56, 0.37], [s * 0.066, 0.6, 0.37], 0x1a1410); }
    if (pack) Hd.tube([[0, 0.5, 0.42], [0, 0.4, 0.3], [0, 0.1, 0.12]], 0.014, 3, 0xb8342a);
    return { body: B.geo(), head: Hd.geo(), neck: [0, by + 0.03, 0.34] };
  });
}
function oasisGeo(v) {
  return cached(`oasis:${v}`, () => {
    const R = rng(v * 31 + 5), T = new Tris(), Wt = new Tris(0.3), n = 11, rim = [], sx = [1, 1.12, 0.92][v], sz = [0.88, 0.74, 1][v];
    for (let j = 0; j < n; j++) { const a = (j / n) * TAU, r = 0.86 + R() * 0.22 - (v === 1 && j % 5 === 0 ? 0.2 : 0); rim.push([Math.cos(a) * r * sx, Math.sin(a) * r * sz]); }
    for (let j = 0; j < n; j++) { const k = (j + 1) % n, a = rim[j], b = rim[k];
      T.quad([a[0] * 1.42, 0.004, a[1] * 1.42], [b[0] * 1.42, 0.004, b[1] * 1.42], [b[0] * 1.14, 0.05, b[1] * 1.14], [a[0] * 1.14, 0.05, a[1] * 1.14], j % 2 ? 0x8aa058 : 0x9aa860);
      T.quad([a[0] * 1.14, 0.05, a[1] * 1.14], [b[0] * 1.14, 0.05, b[1] * 1.14], [b[0], 0.02, b[1]], [a[0], 0.02, a[1]], 0x8a7a50);
      Wt.quad([a[0] * 1.02, 0.03, a[1] * 1.02], [b[0] * 1.02, 0.03, b[1] * 1.02], [b[0] * 0.6, 0.032, b[1] * 0.6], [a[0] * 0.6, 0.032, a[1] * 0.6], j % 2 ? 0x4fb8b4 : 0x44a8a8); Wt.face([a[0] * 0.6, 0.032, a[1] * 0.6], [b[0] * 0.6, 0.032, b[1] * 0.6], [0, 0.032, 0], j % 2 ? 0x1f7a8a : 0x25869a); }
    // reeds, flowers, stones round the rim
    for (let c = 0; c < 7; c++) { const j = Math.floor(R() * n), [rx, rz] = rim[j], k = 1.02 + R() * 0.12, x = rx * k, z = rz * k;
      for (let b = 0; b < 5; b++) { const ox = (R() - 0.5) * 0.22, oz = (R() - 0.5) * 0.22, h = 0.45 + R() * 0.5, lx = (R() - 0.5) * 0.3; T.face([x + ox - 0.035, 0.03, z + oz], [x + ox + 0.035, 0.03, z + oz + 0.02], [x + ox + lx, h, z + oz], b % 2 ? 0x5a9a3a : 0x7ab048); }
      if (c % 2) { T.beam([x, 0, z], [x, 0.75, z], 0.025, 0.025, 0x5a8a3a, [0, 0]); T.lathe([[0.04, 0.58], [0.05, 0.62], [0.05, 0.78], [0.012, 0.82]], 4, 0x6a3c1a, { x, z }); } }
    for (let c = 0; c < 6; c++) { const j = (c * 2 + v) % n, [rx, rz] = rim[j], x = rx * 1.26, z = rz * 1.26; T.blob([x, 0.1, z], [0.07, 0.06, 0.07], [0xf06a9a, 0xfff0f0, 0xf2c020][c % 3], { kind: 'o0', jag: 0.1, seed: c }); T.face([x - 0.08, 0.04, z], [x + 0.08, 0.04, z + 0.03], [x, 0.11, z - 0.05], 0x4f8a3a); }
    for (let c = 0; c < 4; c++) { const j = (c * 3 + 1) % n, [rx, rz] = rim[j]; T.blob([rx * 1.1, 0.04, rz * 1.1], [0.11, 0.08, 0.09], [0x8a8274, 0xa89c88][c % 2], { kind: 'o0', jag: 0.25, seed: c }); }
    for (let c = 0; c < 2; c++) { const x = (c ? 0.3 : -0.25) * sx, z = (c ? -0.2 : 0.3) * sz; for (let j = 0; j < 6; j++) { const a0 = (j / 6) * TAU; if (j === 0) continue; Wt.face([x, 0.036, z], [x + Math.cos(a0) * 0.12, 0.036, z + Math.sin(a0) * 0.12], [x + Math.cos(a0 + 1.05) * 0.12, 0.036, z + Math.sin(a0 + 1.05) * 0.12], 0x3f8a3a); } }
    return { bank: T.geo(), water: Wt.geo() };
  });
}
function watchRuinGeo(v) {
  return cached(`wruin:${v}`, () => {
    const R = rng(v * 13 + 7), T = new Tris(), hw = 0.6, rowH = 0.2, rows = 17, cols = 5, th = 0.13;
    const brick = (id, r) => MUD[Math.floor(hash(id * 1.3, r * 2.1) * 4)], cs = [[-hw, hw], [hw, hw], [hw, -hw], [-hw, -hw]];
    const low = [5, 14, 9][v], top = (p) => clamp(Math.round(11.5 + 5.5 * Math.cos(((p - low) / 20) * TAU) + (hash(p, v) - 0.5) * 2.4), 5, rows);
    for (let w = 0; w < 4; w++) T.wall(cs[w], cs[(w + 1) % 4], 0.1, rowH, rows, cols, brick, { inside: [0, 0], thick: th, top: (c) => top(w * 5 + c), skip: (c, r) => (w === 0 && c === 2 && r < 4) || (w !== 0 && c === 2 && (r === 8 || r === 9)) || (w === 2 && c === 1 && r === 13), innerCol: 0x8a6a40, capCol: 0xd8b47c });
    T.lathe([[0.98, 0], [0.9, 0.12], [0.86, 0.36], [0.86, 0.1]], 4, (p, n) => (n[1] > 0.5 ? MUD[2] : MUD[3]), { a0: PI / 4, capTop: false });
    T.quad([-hw + th, 0.11, -hw + th], [hw - th, 0.11, -hw + th], [hw - th, 0.11, hw - th], [-hw + th, 0.11, hw - th], 0x6a5236);
    T.box([0, 0.94, hw + 0.01], [0.17, 0.035, 0.05], WOOD_D);
    for (const [x, z, ry] of [[-0.25, hw, 0], [0.3, hw, 0], [hw, 0.2, PI / 2], [hw, -0.3, PI / 2]]) T.at(x, 2.25, z, ry, 1, 0, 0, () => T.beam([0, 0, -0.1], [0, 0, 0.22], 0.06, 0.06, WOOD_D));
    // fallen brick and drifted sand
    const a0 = (low / 20) * TAU - PI * 0.75;
    for (let k = 0; k < 7; k++) { const a = a0 + (R() - 0.5) * 1.4, r = 0.75 + R() * 0.25; T.box([Math.cos(a) * r, 0.05 + R() * 0.08, -Math.sin(a) * r], [0.09 + R() * 0.05, 0.05, 0.06], brick(k, 3), R() * 3, R() * 0.5, R() * 0.4); }
    drift(T, [Math.cos(a0) * 0.72, 0, -Math.sin(a0) * 0.72], [0.5, 0.3, 0.42], sandCol, v); drift(T, [-Math.cos(a0) * 0.75, 0, Math.sin(a0) * 0.75], [0.42, 0.18, 0.5], sandCol, v + 3);
    return T.geo();
  });
}
function wreckGeo(v) {
  return cached(`wreck:${v}`, () => {
    const R = rng(v * 17 + 11), T = new Tris(), wood = (p, n) => mix(BLEACH_D, BLEACH, clamp(0.4 + n[1] * 0.5 + hash(p[0] * 7, p[1] * 5, p[2] * 7) * 0.4, 0, 1)), m = v === 1 ? -1 : 1;
    T.blob([0, 0, 0], [2.0, 0.34, 0.85], sandCol, { kind: 'i1', jag: 0.1, seed: v, floor: 0 });
    T.at(0, 0.16, 0, 0, 1, 0.24 * m, 0.03, () => {
      T.beam([-1.8, 0.08, 0], [1.55, 0.08, 0], 0.13, 0.14, wood);
      T.tube([[1.45, 0.06, 0], [1.75, 0.3, 0], [1.9, 0.8, 0], [1.93, 1.35, 0]], [[0.07, 0.09], [0.07, 0.08], [0.06, 0.07], [0.05, 0.05]], 4, wood);
      T.tube([[-1.7, 0.06, 0], [-1.86, 0.5, 0], [-1.9, 0.85, 0]], [[0.07, 0.09], [0.06, 0.07], [0.05, 0.05]], 4, wood);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1), x = lerp(-1.5, 1.3, u), w = 0.45 + 0.42 * Math.sin(PI * (u * 0.86 + 0.07)), h = 0.75 + 0.5 * Math.sin(PI * (u * 0.8 + 0.1));
        for (const s of [-1, 1]) { const cut = hash(i, s, v) < 0.3 ? 1 : hash(i, s, v + 5) < 0.3 ? 2 : 3, lowSide = s * m > 0, pts = [[x, 0.1, 0], [x, 0.16, s * w * 0.55], [x + 0.02, h * 0.55, s * w * 0.96], [x + 0.04, h * (lowSide ? 0.95 : 1.12), s * w * 0.9]].slice(0, cut + 1);
          T.tube(pts, [0.075, 0.07, 0.058, 0.04], 4, wood, { caps: [0, 1] }); }
        if (i > 1 && i < 7 && i % 1 === 0) { const s = m, w2 = 0.45 + 0.42 * Math.sin(PI * ((i + 1) / (n - 1) * 0.86 + 0.07)), x2 = lerp(-1.5, 1.3, (i + 1) / (n - 1)); if (hash(i, v, 9) > 0.25) T.quad([x - 0.05, 0.2, s * w * 0.62], [x2 + 0.05, 0.2, s * w2 * 0.62], [x2 + 0.05, 0.42, s * w2 * 0.9], [x - 0.05, 0.42, s * w * 0.9], i % 2 ? BLEACH_D : 0x8f8672, [x, 0.6, 0]); }
      }
    });
    T.beam([-0.6, 0.2, 0.8 * m], [0.5, 0.26, 0.95 * m], 0.08, 0.04, wood); T.beam([0.9, 0.1, -0.75 * m], [1.5, 0.3, -0.5 * m], 0.07, 0.05, wood);
    drift(T, [-0.9, 0, -0.45 * m], [0.8, 0.42, 0.45], sandCol, 5); drift(T, [0.8, 0, 0.5 * m], [0.7, 0.3, 0.4], sandCol, 6 + R());
    return T.geo();
  });
}
function scorpionGeo(v) {
  return cached(`scorp:${v}`, () => {
    const B = new Tris(), Tl = new Tris(), c1 = [0xc8922a, 0x3a2e28, 0xd8b04a][v], c2 = [0x7a4a14, 0x1a1412, 0x9a6a20][v], col = (p, n) => mix(c2, c1, clamp(0.4 + n[1] * 0.7, 0, 1));
    B.spindle([[-0.1, 0.05, 0.03, 0.025], [-0.05, 0.055, 0.075, 0.04], [0.05, 0.06, 0.085, 0.045], [0.13, 0.055, 0.07, 0.04], [0.17, 0.05, 0.035, 0.025]], 6, (p, n, lp) => (Math.floor(lp[2] * 34 + 10) % 2 ? col(p, n) : c2));
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) { const z = 0.1 - k * 0.055, a = [s * 0.06, 0.05, z], b = [s * 0.16, 0.1, z + 0.02 - k * 0.025], c = [s * 0.24, 0.0, z + 0.03 - k * 0.045]; B.beam(a, b, 0.022, 0.022, c1, [0, 0]); B.beam(b, c, 0.018, 0.018, c2, [0, 0]); }
      const e = [s * 0.14, 0.05, 0.24], w = [s * 0.11, 0.05, 0.32];
      B.tube([[s * 0.05, 0.05, 0.15], e, w], [0.022, 0.025, 0.03], 4, c1, { caps: [0, 0] });
      B.blob([w[0], w[1], w[2] + 0.03], [0.04, 0.03, 0.05], col, { kind: 'o0', jag: 0.1 });
      B.face([w[0] - 0.03, 0.05, w[2] + 0.06], [w[0] - 0.005, 0.05, w[2] + 0.06], [w[0] - 0.02 * s - 0.02, 0.05, w[2] + 0.15], c2); B.face([w[0] + 0.005, 0.05, w[2] + 0.06], [w[0] + 0.03, 0.05, w[2] + 0.06], [w[0] - 0.02 * s + 0.02, 0.05, w[2] + 0.15], c2);
    }
    // tail: arches up and forward from the pivot, stinger over the back
    const tp = [[0, 0, 0], [0, 0.07, -0.08], [0, 0.17, -0.11], [0, 0.26, -0.07], [0, 0.3, 0.02]];
    for (let i = 0; i < 4; i++) Tl.tube([tp[i], tp[i + 1]], [0.032 - i * 0.003, 0.03 - i * 0.003], 4, i % 2 ? c1 : col, { a0: PI / 4 });
    Tl.blob([0, 0.3, 0.05], [0.035, 0.035, 0.045], c2, { kind: 'o0' }); Tl.face([-0.012, 0.3, 0.08], [0.012, 0.3, 0.08], [0, 0.23, 0.13], 0x1a1008); Tl.face([0, 0.32, 0.08], [0, 0.28, 0.08], [0, 0.23, 0.13], 0x1a1008);
    return { body: B.geo(), tail: Tl.geo(), tailAt: [0, 0.055, -0.09] };
  });
}
/** a low lizard along a bent spine: body with tail (static) and a head on a neck pivot */
function lizardGeo(key, v, o) {
  return cached(`${key}:${v}`, () => {
    const B = new Tris(), Hd = new Tris(), Gl = new Tris(0), { c1, c2, belly, k = 1, band = 7, fat = 1 } = o, sp = [], rad = [], N = 12;
    // spine from tail tip (u = 0) to the shoulders (u = 1), curling
    for (let i = 0; i <= N; i++) { const u = i / N, z = lerp(-0.42, 0.16, u) * k, x = (Math.sin(u * 5.2 + v * 1.9) * 0.07 * (1 - u * 0.6) + (u < 0.4 ? (0.4 - u) * (v % 2 ? -0.5 : 0.5) : 0)) * k, bw = u < 0.5 ? lerp(0.008, 0.045, u / 0.5) : 0.045 + 0.03 * Math.sin(PI * (u - 0.5) / 0.5 * 0.9); sp.push([x, (0.03 + bw * 0.6) * k, z]); rad.push([bw * k * fat, bw * 0.72 * k * fat]); }
    const skin = (p, n, lp) => (n[1] < -0.3 ? belly : Math.floor((lp[2] / k + 1) * band * 2.2) % 2 ? c2 : mix(c2, c1, clamp(0.5 + n[1] * 0.6, 0, 1)));
    B.tube(sp, rad, 5, skin, { caps: [1, 1] });
    const sh = sp[N], hip = sp[7];
    for (const s of [-1, 1]) for (const [q, fz] of [[sh, 0.06], [hip, -0.02]]) { const a = [q[0] + s * 0.03 * k, q[1], q[2] - 0.03 * k], b = [q[0] + s * 0.12 * k, q[1] + 0.025 * k, q[2] - 0.04 * k + fz * k * 0.3], c = [q[0] + s * 0.16 * k, 0.004, q[2] + fz * k]; B.beam(a, b, 0.032 * k, 0.03 * k, c1, [0, 0]); B.beam(b, c, 0.026 * k, 0.024 * k, c2, [0, 0]); B.face([c[0] - 0.03 * k, 0.006, c[2]], [c[0] + 0.03 * k, 0.006, c[2]], [c[0] + s * 0.025 * k, 0.006, c[2] + 0.065 * k], c2); }
    // head and neck about the shoulders
    Hd.spindle([[-0.02 * k, 0.0, 0.055 * k * fat, 0.042 * k * fat], [0.07 * k, 0.012 * k, 0.045 * k * fat, 0.036 * k], [0.13 * k, 0.015 * k, 0.056 * k * fat, 0.036 * k], [0.21 * k, 0.005 * k, 0.034 * k * fat, 0.022 * k], [0.245 * k, 0, 0.014 * k, 0.012 * k]], 5, (p, n, lp) => (n[1] < -0.3 ? belly : lp[2] > 0.1 * k ? c1 : c2));
    for (const s of [-1, 1]) (o.glow ? Gl : Hd).face([s * 0.05 * k * fat, 0.035 * k, 0.12 * k], [s * 0.052 * k * fat, 0.03 * k, 0.16 * k], [s * 0.04 * k * fat, 0.052 * k, 0.14 * k], o.glow ? 0xffd040 : 0x1a1408);
    if (o.glow) for (let i = 2; i <= N; i++) { const q = sp[i], r = rad[i], w = r[0] * 0.62, y = q[1] + r[1] * 1.02, nx = sp[Math.min(i + 1, N)], dz = (nx[2] - q[2]) * 0.42 || 0.02; Gl.quad([q[0], y, q[2] - dz], [q[0] + w, y - r[1] * 0.22, q[2]], [q[0], y, q[2] + dz], [q[0] - w, y - r[1] * 0.22, q[2]], i % 2 ? 0xff8a18 : 0xffc040); }
    return { body: B.geo(), head: Hd.geo(), glow: Gl.count ? Gl.geo() : null, neck: [sh[0], sh[1], sh[2]] };
  });
}

const desert = {
  /** date palm, trunk 0.8 across at the foot (fronds spread ~3), up to 4 high. userData.crown sways */
  datePalm(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = datePalmGeo(v), g = new THREE.Group();
    g.add(mesh(G.trunk, matScene), part(G.crown, matScene, 'sway', { amp: 0.035, rate: 0.8, ph: (s % 19) * 0.6 }, G.top));
    return finish(g, 'datePalm', v, { crown: ['sway', 1] });
  },
  /** branching cactus with flowers, 0.8-1.2 across, 2.4 high */
  saguaro(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(saguaroGeo(v), matScene), 'saguaro', v); },
  /** wind-carved sandstone arch, 3 across (along X), 2.6 high; a ship's boat could pass under */
  rockArch(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(rockArchGeo(v), matScene), 'rockArch', v); },
  /** rippled crescent dune, 4 x 2.6, 0.7 high; slip face toward +Z */
  dune(seed) { mats(); const v = seedOf(seed) % 3, m = mesh(cached(`dunegeo:${v}`, () => duneGeo('dune', v, 4, 2.6, 0.7, [SAND_L, SAND, 0xc8a460, 0xa8824a]).geo()), matScene); return finish(m, 'dune', v); },
  /** striped goat-hair tent 2.6 x 2 (open side +Z) with carpets, cushions and a coffee fire. userData.fire flickers */
  nomadTent(seed) {
    mats(); const v = seedOf(seed) % 3, G = nomadTentGeo(v), g = new THREE.Group();
    g.add(mesh(G.body, matScene), part(G.fire, matGlow, 'flick', { amp: 0.12, ph: v }, G.fireAt, false));
    return finish(g, 'nomadTent', v, { fire: ['flick', 1] });
  },
  /** sand-drifted broken columns with a standing and a fallen lintel, 2.6 across, 3 high */
  ruinColumns(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(ruinColumnsGeo(v), matScene), 'ruinColumns', v); },
  /** two camels kneeling with packs and one standing, 2.4 across. userData.animals */
  camelGroup(seed) {
    const s = seedOf(seed), R = rng(s * 7 + 5), g = new THREE.Group(), a0 = R() * TAU;
    const lay = [[0, 0, 0.0, 0.55, 0.3], [1, 1 + (s % 3), -0.6, -0.3, -0.5], [1, 1 + ((s + 1) % 3), 0.62, -0.25, 0.9]];
    lay.forEach(([kn, pk, x, z, ry], i) => { const c = Math.cos(a0), sn = Math.sin(a0); g.add(place(animal(camelGeo(kn, pk), 'chew', { ph: R() * 30, rate: 0.8 + R() * 0.4 }), x * c + z * sn, 0, -x * sn + z * c, a0 + ry + (R() - 0.5) * 0.5, 0.95 + R() * 0.1 + (i ? 0 : 0.05))); });
    return finish(g, 'camelGroup', 0, { animals: ['animal', 0] });
  },
  /** five vultures circling 2.5-4 above the ground over 3 tiles. userData.birds */
  vultureFlock(seed) {
    const s = seedOf(seed), g = flock('vulture', 5, s, { spread: 0.3, r0: 0.75, r1: 1.15, h0: 2.6, h1: 3.9, speed: 0.42, bob: 0.1, flapRate: 4, flapAmp: 0.35, glide: 0.45, bank: 0.28, burst: -0.55, size: 1 });
    return finish(g, 'vultureFlock', 0, { birds: ['flyer', 0] });
  },
  /** a small pool ringed with reeds and flowers, 2.6 across. userData.water = the water mesh */
  oasisPool(seed) {
    mats(); const v = seedOf(seed) % 3, G = oasisGeo(v), g = new THREE.Group(), w = mesh(G.water, matGloss); w.userData = { role: 'water' };
    g.add(mesh(G.bank, matScene), w);
    const o = finish(g, 'oasisPool', v); Object.defineProperty(o.userData, 'water', { value: w, enumerable: false, writable: true, configurable: true }); return o;
  },
  /** crumbling mud-brick watchtower, 1.8 across, 3.4 high (door faces +Z) */
  watchRuin(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(watchRuinGeo(v), matScene), 'watchRuin', v); },
  /** bleached ribs and keel of a ship half buried in sand, 4 long (bow +X), 1.6 high */
  wreck(seed) { mats(); const v = seedOf(seed) % 2; return finish(mesh(wreckGeo(v), matScene), 'wreck', v); },
  /** an oversized scorpion, 0.6 across, facing +Z. userData.animals */
  scorpion(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = scorpionGeo(v), g = new THREE.Group(), a = group('animal', { act: 'look', ph: s * 1.7, rate: 1.2, turn: 0.5, tailAxis: 'x', tailAmp: 0.22, tailRate: 2.1 });
    const tl = mesh(G.tail, matScene); tl.position.set(G.tailAt[0], G.tailAt[1], G.tailAt[2]); tl.userData = { role: 'tail' };
    a.add(mesh(G.body, matScene), tl); g.add(place(a, 0, 0, 0, 0, 1.05));
    return finish(g, 'scorpion', v, { animals: ['animal', 0] });
  },
  /** a basking monitor lizard, 0.6 across, facing +Z. userData.animals */
  lizard(seed) {
    const s = seedOf(seed), v = s % 3, G = lizardGeo('lizard', v, { c1: [0xa89a52, 0x8a7a5a, 0xb8a060][v], c2: [0x4a4428, 0x3e3626, 0x6a5a30][v], belly: 0xd8cc9a, k: 1.15 }), g = new THREE.Group();
    g.add(place(animal(G, 'look', { ph: s * 2.3, rate: 1, turn: 0.2, bobY: 0.018 }), 0, 0, 0.08, 0, 1));
    return finish(g, 'lizard', v, { animals: ['animal', 0] });
  },
};

// @@SWAMP@@
// =====================================================================================
// SWAMP (y = 0 is the water surface for pieces that stand in water)
// =====================================================================================
const CYP = 0x6e5e4c, CYP_D = 0x473a2e, SWAMP_G = 0x4a6a3a, SWAMP_D = 0x33502c, SWAMP_L = 0x6f8c48, MOSS = 0x93a087, MOSS_D = 0x74826c, PLANK = [0x6e6a54, 0x7c765a, 0x5c5a48, 0x86806a], RUST = [0x8a4a2a, 0x9a6a4a, 0x6a7474, 0x7a3e22], MUDC = 0x4a3e2a;
const WISP = 0x80ffd8, WISP_HOT = 0xe8fff4, FLY = 0xd8ff50;
const planks = (T, a, b, y0, y1, cols, pal, ref) => { for (let c = 0; c < cols; c++) { const p = vlerp(a, b, c / cols), q = vlerp(a, b, (c + 1) / cols); T.quad([p[0], y0, p[2]], [q[0], y0, q[2]], [q[0], y1, q[2]], [p[0], y1, p[2]], pal[(c * 3 + Math.round(a[0] * 3 + a[2] * 5)) & 3], ref); } };

function cypressGeo(v) {
  return cached(`cypress:${v}`, () => {
    const R = rng(v * 43 + 9), T = new Tris(), C = new Tris(), PY = 2.3, lean = [[0.05, 0.02], [-0.07, 0.03], [0.02, -0.06]][v];
    const bark = (p, n) => (p[1] < 0.06 ? 0x3a3026 : mix(CYP_D, CYP, clamp(0.45 + n[0] * 0.3 + n[1] * 0.4 + hash(p[1] * 6, p[0] * 9) * 0.3, 0, 1)));
    T.lathe([[0.66, -0.3], [0.52, 0], [0.33, 0.35], [0.22, 0.9], [0.17, 1.9], [0.12, 3.0], [0.06, 3.7]], 10, bark, { mod: (j, i) => (i <= 2 ? (j % 2 ? 0.7 : 1.12) : i === 3 ? (j % 2 ? 0.9 : 1.04) : 1), lean: (y) => [lean[0] * y, lean[1] * y] });
    for (let k = 0; k < 5 + (v % 2); k++) { const a = k * 1.4 + v * 0.8, r = 0.62 + R() * 0.25, h = 0.22 + R() * 0.34; T.lathe([[0.1, -0.3], [0.075, h * 0.5], [0.02, h]], 4, bark, { x: Math.cos(a) * r, z: Math.sin(a) * r, a0: k }); }
    const leaf = (p, n) => mix(mix(SWAMP_D, SWAMP_G, clamp(0.5 + n[1] * 0.6, 0, 1)), SWAMP_L, clamp(n[1] * 0.8 - 0.3 + (hash(p[0] * 4, p[1] * 4, p[2] * 4) - 0.5) * 0.5, 0, 1));
    // flat-topped crown in tiers, about the pivot at PY
    const tiers = [[0, 1.5, 0, 0.82, 0.32, 0.78, 'i1'], [0.42, 1.02, 0.2, 0.52, 0.26, 0.5, 'o1'], [-0.48, 0.9, -0.12, 0.55, 0.26, 0.5, 'o1'], [0.05, 0.62, -0.48, 0.46, 0.22, 0.44, 'o1'], [-0.1, 0.4, 0.46, 0.42, 0.2, 0.4, 'o1']];
    tiers.forEach(([x, y, z, rx, ry, rz, kind], i) => {
      const cx = x + lean[0] * (PY + y), cz = z + lean[1] * (PY + y);
      C.blob([cx, y, cz], [rx, ry, rz], leaf, { kind, jag: 0.16, seed: v * 7 + i });
      if (i) T.tube([[lean[0] * (PY + y - 0.2), PY + y - 0.25, lean[1] * (PY + y - 0.2)], [cx * 0.8, PY + y - 0.05, cz * 0.8]], [0.07, 0.04], 4, bark, { caps: [0, 0] });
      const nm = i ? 3 : 5;
      for (let k = 0; k < nm; k++) { const a = k * (TAU / nm) + i * 1.1 + R(), mx = cx + Math.cos(a) * rx * 0.72, mz = cz + Math.sin(a) * rz * 0.72, my = y - ry * 0.35, L = 0.5 + R() * 0.55, w = 0.07 + R() * 0.04, tx = -Math.sin(a) * w, tz = Math.cos(a) * w;
        C.quad([mx - tx, my, mz - tz], [mx + tx, my, mz + tz], [mx + tx * 0.6, my - L * 0.6, mz + tz * 0.6], [mx - tx * 0.7, my - L * 0.5, mz - tz * 0.7], k % 2 ? MOSS : MOSS_D); C.face([mx + tx * 0.6, my - L * 0.6, mz + tz * 0.6], [mx - tx * 0.7, my - L * 0.5, mz - tz * 0.7], [mx, my - L, mz], MOSS_D); }
    });
    return { trunk: T.geo(), crown: C.geo(), py: PY };
  });
}
function reedBedGeo(v) {
  return cached(`reeds:${v}`, () => {
    const R = rng(v * 13 + 3), T = new Tris(), G = [0x6a9a3a, 0x86b048, 0x4f7a30, 0xa8b060];
    T.patch([0, 0, 0], 0.74, 0.66, 8, 0x4a5a30, 0x3a4a2c, { y: 0.02, seed: v, jag: 0.22 });
    for (let k = 0; k < 26; k++) { const a = R() * TAU, r = Math.sqrt(R()) * 0.62, x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9, h = 0.6 + R() * 0.55, lx = (R() - 0.5) * 0.36, lz = (R() - 0.5) * 0.3, w = 0.035 + R() * 0.02, ca = Math.cos(k * 1.9) * w, sa = Math.sin(k * 1.9) * w; T.face([x - ca, 0, z - sa], [x + ca, 0, z + sa], [x + lx, h, z + lz], G[k & 3]); }
    for (let k = 0; k < 7 + v; k++) { const a = R() * TAU, r = Math.sqrt(R()) * 0.5, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.9 + R() * 0.3, lx = (R() - 0.5) * 0.12; T.face([x - 0.02, 0, z], [x + 0.02, 0, z + 0.01], [x + lx * 0.85, h * 0.75, z], 0x7a9a44); T.lathe([[0.03, h * 0.7], [0.052, h * 0.74], [0.052, h * 0.92], [0.012, h * 0.95]], 4, 0x5c3416, { x: x + lx * 0.85, z }); }
    return T.geo();
  });
}
function stiltShackGeo(v) {
  return cached(`shack:${v}`, () => {
    const R = rng(v * 19 + 1), T = new Tris(), Gl = new Tris(0), py = 1.1, pal = [PLANK, [0x7a6a50, 0x6a5a44, 0x8a7a5c, 0x5c4e3a], [0x5c6a5a, 0x6a7866, 0x4e5a4c, 0x788672]][v];
    // stilts and braces
    const st = [[-0.92, -0.72], [0.0, -0.74], [0.92, -0.7], [-0.9, 0.62], [0.05, 0.64], [0.94, 0.6]];
    st.forEach(([x, z], i) => T.tube([[x + (R() - 0.5) * 0.2, -0.3, z + (R() - 0.5) * 0.14], [x + (R() - 0.5) * 0.06, 0.5, z], [x, py, z]], [0.07, 0.06, 0.06], 5, (p) => (p[1] < 0.12 ? 0x2e2a22 : i % 2 ? CYP : CYP_D), { caps: [0, 0] }));
    T.beam([-0.92, 0.2, 0.62], [0.05, 0.95, 0.64], 0.05, 0.05, CYP_D); T.beam([0.92, 0.25, -0.7], [0.0, 0.9, -0.74], 0.05, 0.05, CYP_D); T.beam([0.94, 0.2, 0.6], [0.92, 0.95, -0.7], 0.05, 0.05, CYP);
    // deck
    for (let c = 0; c < 8; c++) { const x0 = -1.02 + c * 0.255, w = 0.25; T.box([x0 + w / 2, py + 0.02 + (hash(c, v) - 0.5) * 0.02, -0.06], [w / 2 - 0.006, 0.035, 0.8 + (hash(c, 7) - 0.5) * 0.08], pal[(c * 3) & 3], 0, 0, 0, true); }
    // the shack, leaning a little
    const x0 = -0.95, x1 = 0.3, z0 = -0.78, z1 = 0.36, y0 = py + 0.05, wh = 1.0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, tilt = [0.05, -0.06, 0.04][v];
    T.at(cx, y0, cz, 0, 1, 0, tilt, () => {
      const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, ref = [0, 0.5, 0];
      planks(T, [-hx, 0, hz], [hx, 0, hz], 0, wh + 0.28, 6, pal, ref); planks(T, [-hx, 0, -hz], [hx, 0, -hz], 0, wh, 6, pal, ref);
      for (const sx of [-hx, hx]) for (let c = 0; c < 5; c++) { const za = lerp(-hz, hz, c / 5), zb = lerp(-hz, hz, (c + 1) / 5), ya = wh + 0.28 * (c / 5), yb = wh + 0.28 * ((c + 1) / 5); T.quad([sx, 0, za], [sx, 0, zb], [sx, yb, zb], [sx, ya, za], pal[(c + (sx > 0 ? 2 : 0)) & 3], ref); }
      // rusty tin roof, one pitch, patched
      for (let c = 0; c < 6; c++) { const xa = lerp(-hx - 0.14, hx + 0.14, c / 6), xb = lerp(-hx - 0.14, hx + 0.14, (c + 1) / 6), e = (c % 2) * 0.025; T.quad([xa, wh - 0.06 + e, -hz - 0.16], [xb, wh - 0.06 + e, -hz - 0.16], [xb, wh + 0.34 + e, hz + 0.2], [xa, wh + 0.34 + e, hz + 0.2], RUST[(c * 3 + v) & 3], [0, 0, 0]); }
      T.box([0.1, wh + 0.2, 0.1], [0.2, 0.012, 0.16], 0x9aa4a4, 0.2, -0.245, 0);
      // door, window, stovepipe
      T.box([hx - 0.26, 0.36, hz + 0.01], [0.16, 0.36, 0.02], 0x3a3026); Gl.xf(T.M, () => Gl.box([-0.3, 0.52, hz + 0.012], [0.12, 0.11, 0.012], LAMP)); T.box([-0.3, 0.52, hz + 0.02], [0.15, 0.015, 0.02], pal[2]); T.box([-0.3, 0.52, hz + 0.02], [0.015, 0.13, 0.02], pal[2]);
      T.tube([[-0.36, wh + 0.02, -0.32], [-0.38, wh + 0.42, -0.32], [-0.3, wh + 0.72, -0.3]], 0.065, 6, (p) => (hash(Math.round(p[1] * 6), 2) > 0.6 ? 0x8a5a3a : 0x6a7272), { caps: [0, 1] });
      T.pipeTop = T._v([-0.3, wh + 0.86, -0.3]);
      T.lathe([[0.13, wh + 0.74], [0.02, wh + 0.84]], 6, 0x5a6262, { x: -0.3, z: -0.3 });
    });
    // porch: rail, lantern post, barrel, ladder
    for (const [x, z] of [[1.0, 0.72], [1.0, -0.78], [0.42, 0.72]]) T.beam([x, py, z], [x, py + 0.5, z], 0.05, 0.05, CYP);
    T.beam([1.0, py + 0.46, 0.72], [1.0, py + 0.46, -0.78], 0.04, 0.04, pal[1]); T.beam([0.42, py + 0.46, 0.72], [1.0, py + 0.46, 0.72], 0.04, 0.04, pal[1]);
    T.beam([1.0, py + 0.4, 0.72], [1.0, py + 1.0, 0.72], 0.05, 0.05, CYP_D); T.beam([1.0, py + 0.97, 0.72], [0.82, py + 0.97, 0.72], 0.035, 0.035, CYP_D);
    const lan = [0.82, py + 0.8, 0.72];
    T.box([lan[0], lan[1] + 0.1, lan[2]], [0.05, 0.015, 0.05], 0x2a2a2a); T.box([lan[0], lan[1] - 0.09, lan[2]], [0.05, 0.015, 0.05], 0x2a2a2a); T.beam([lan[0], lan[1] + 0.1, lan[2]], [lan[0], lan[1] + 0.17, lan[2]], 0.015, 0.015, 0x2a2a2a);
    T.at(0.7, py + 0.055, -0.5, 0, 1, 0, 0, () => T.lathe([[0.1, 0], [0.13, 0.15], [0.1, 0.3]], 7, (p, n, lp) => (Math.abs(lp[1] - 0.08) < 0.03 || Math.abs(lp[1] - 0.25) < 0.03 ? 0x3a3a3a : WOOD_D)));
    for (const s of [-1, 1]) T.beam([1.08, py + 0.3, 0.1 + s * 0.16], [1.36, -0.25, 0.1 + s * 0.16], 0.045, 0.045, pal[3]);
    for (let k = 0; k < 5; k++) { const u = (k + 0.5) / 5.6; T.beam([lerp(1.36, 1.08, u), lerp(-0.25, py + 0.3, u), -0.06], [lerp(1.36, 1.08, u), lerp(-0.25, py + 0.3, u), 0.26], 0.05, 0.03, pal[0]); }
    const L = new Tris(0); L.blob([0, 0, 0], [0.045, 0.075, 0.045], glowCol(LAMP, LAMP_HOT), { kind: 'o0', jag: 0 });
    return { body: T.geo(), glow: Gl.geo(), lantern: L.geo(), lanternAt: lan, pipe: T.pipeTop };
  });
}
function heronGeo(v) {
  return cached(`heron:${v}`, () => {
    const B = new Tris(), Hd = new Tris(), egret = v === 1, c1 = egret ? 0xfafaf4 : 0x8a9aac, c2 = egret ? 0xdcdcd4 : 0x55606e, legc = egret ? 0x1e1e1e : 0x8a7a40, k = egret ? 0.85 : 1;
    const col = (p, n) => mix(c2, c1, clamp(0.55 + n[1] * 0.6, 0, 1));
    B.spindle([[-0.24 * k, 0.5 * k, 0.015, 0.02], [-0.1 * k, 0.56 * k, 0.075 * k, 0.08 * k], [0.04 * k, 0.62 * k, 0.085 * k, 0.1 * k], [0.13 * k, 0.68 * k, 0.05 * k, 0.06 * k]], 5, col);
    B.face([-0.05, 0.55 * k, -0.2 * k], [0.05, 0.55 * k, -0.2 * k], [0, 0.42 * k, -0.34 * k], c2);
    for (const s of [-1, 1]) { B.beam([s * 0.035, 0.55 * k, 0.0], [s * 0.04, 0.26 * k, 0.03 * s], 0.024, 0.024, legc, [0, 0]); B.beam([s * 0.04, 0.26 * k, 0.03 * s], [s * 0.04, -0.2, 0.0], 0.02, 0.02, legc, [0, 0]); }
    Hd.tube([[0, -0.02, -0.02], [0, 0.12 * k, 0.08 * k], [0, 0.27 * k, 0.02 * k], [0, 0.41 * k, 0.07 * k]], [0.04, 0.03, 0.026, 0.028], 4, egret ? col : (p, n) => (n[2] > 0.3 ? 0xf0f0ea : col(p, n)), { caps: [0, 0] });
    Hd.spindle([[0.02 * k, 0.43 * k, 0.034, 0.036], [0.1 * k, 0.43 * k, 0.03, 0.03], [0.14 * k, 0.425 * k, 0.018, 0.018]], 5, egret ? col : 0xf0f0ea);
    Hd.spindle([[0.13 * k, 0.425 * k, 0.016, 0.018], [0.34 * k, 0.4 * k, 0.003, 0.003]], 4, egret ? 0xf2b020 : 0xe8a030, false, false);
    if (!egret) { Hd.face([0.0, 0.47, 0.1], [0.0, 0.47, 0.0], [0, 0.42, -0.14], 0x1e222a); for (const s of [-1, 1]) Hd.face([s * 0.034, 0.455, 0.1], [s * 0.034, 0.45, 0.02], [s * 0.02, 0.47, 0.03], 0x1e222a); }
    return { body: B.geo(), head: Hd.geo(), neck: [0, 0.67 * k, 0.12 * k] };
  });
}
function alligatorGeo(v) {
  return cached(`gator:${v}`, () => {
    const B = new Tris(), Tl = new Tris(), c1 = [0x6a7a44, 0x5c6e52, 0x7c7a48][v], c2 = [0x3a4628, 0x32422f, 0x4b4d2c][v], col = (p, n) => (p[1] < 0.0 ? 0x2a3020 : mix(c2, c1, clamp(0.35 + n[1] * 0.6 + hash(p[0] * 9, p[2] * 9) * 0.25, 0, 1)));
    // built along +Z, then turned to run along +X
    const turn = trs(0, 0, 0, PI / 2, 2.2 / 2.36);
    B.xf(turn, () => {
      B.spindle([[-0.2, -0.05, 0.18, 0.14], [0.0, -0.04, 0.25, 0.16], [0.3, -0.04, 0.25, 0.16], [0.5, -0.03, 0.18, 0.13], [0.62, -0.02, 0.17, 0.105], [0.74, -0.01, 0.18, 0.09], [0.95, -0.025, 0.125, 0.055], [1.1, -0.03, 0.1, 0.045]], 6, col);
      for (const s of [-1, 1]) { B.blob([s * 0.085, 0.085, 0.68], [0.045, 0.045, 0.06], (p, n) => (Math.abs(n[0]) > 0.5 && n[1] > -0.2 ? 0xe8c030 : c1), { kind: 'o0', jag: 0 }); B.blob([s * 0.04, 0.02, 1.06], [0.025, 0.025, 0.03], c2, { kind: 'o0', jag: 0 });
        for (let k = 0; k < 7; k++) { const z = -0.16 + k * 0.1; B.face([s * 0.07 - 0.04, 0.1, z - 0.04], [s * 0.07 + 0.04, 0.1, z - 0.04], [s * 0.07, 0.15, z + 0.02], k % 2 ? c1 : 0x6e7a4a); B.face([s * 0.07 - 0.04, 0.1, z - 0.04], [s * 0.07, 0.1, z + 0.06], [s * 0.07, 0.15, z + 0.02], c2); B.face([s * 0.07 + 0.04, 0.1, z - 0.04], [s * 0.07, 0.1, z + 0.06], [s * 0.07, 0.15, z + 0.02], c2); } }
    });
    Tl.xf(trs(0, 0, 0, PI / 2, 2.2 / 2.36), () => {
      Tl.spindle([[0.0, -0.05, 0.18, 0.14], [-0.3, -0.04, 0.11, 0.11], [-0.6, -0.03, 0.07, 0.09], [-0.9, -0.02, 0.035, 0.07], [-1.06, -0.02, 0.01, 0.03]], 5, col);
      for (let k = 0; k < 8; k++) { const z = -0.08 - k * 0.12, h = 0.1 - k * 0.006; Tl.face([0, 0.04, z + 0.05], [0, 0.04, z - 0.07], [0, 0.04 + h, z - 0.03], k % 2 ? c1 : 0x6e7a4a); }
    });
    return { body: B.geo(), tail: Tl.geo(), tailAt: [-0.2 * 2.2 / 2.36, 0, 0] };
  });
}
function deadTreeGeo(v) {
  return cached(`dtree:${v}`, () => {
    const R = rng(v * 23 + 5), T = new Tris(), lean = [[0.1, 0.04], [-0.12, 0.02], [0.05, -0.1]][v], H = [2.2, 2.5, 1.9][v];
    const wood = (p, n) => (p[1] < 0.07 ? 0x4a4438 : mix(0x665e50, 0xa89e88, clamp(0.4 + n[1] * 0.4 + n[0] * 0.2 + hash(p[1] * 8, p[0] * 6) * 0.35, 0, 1)));
    const ax = (y) => [lean[0] * y * y * 0.3 + lean[0] * y, y, lean[1] * y];
    const rings = [[0.5, -0.3], [0.34, 0], [0.21, 0.4], [0.16, 1.1], [0.13, H - 0.25], [0.11, H]].map(([r, y], i) => { const c = ax(y), o = []; for (let j = 0; j < 7; j++) { const a = (j / 7) * TAU; o.push([c[0] + Math.cos(a) * r * (i < 2 ? (j % 2 ? 0.75 : 1.15) : 1), y + (i === 5 ? hash(j, v) * 0.4 - 0.1 : 0), c[2] - Math.sin(a) * r * (i < 2 ? (j % 2 ? 0.75 : 1.15) : 1)]); } return o; });
    T.stack(rings, wood, true); T.blob(vadd(ax(0.9), [0.12, 0, 0.1]), [0.07, 0.12, 0.05], 0x2a241e, { kind: 'o0' });
    const br = [[0.95, 0.9, 0.9, 0.3], [1.35, 3.6, 1.0, 0.5], [1.7, 2.2, 0.75, 0.7], [H - 0.15, 5.2, 0.8, 0.9]]; let perch = [0, H, 0];
    br.forEach(([y, a, L, up], i) => { const o = ax(y), d = [Math.cos(a + v), 0, Math.sin(a + v)], m = [o[0] + d[0] * L * 0.55, y + up * L * 0.35, o[2] + d[2] * L * 0.55], e = [o[0] + d[0] * L, y + up * L * 0.9 + 0.1, o[2] + d[2] * L];
      T.tube([o, m, e], [0.09, 0.06, 0.028], 4, wood, { caps: [0, 1] }); T.tube([m, [m[0] - d[2] * L * 0.3 + d[0] * 0.1, m[1] + L * 0.42, m[2] + d[0] * L * 0.3]], [0.045, 0.015], 3, wood, { caps: [0, 1] });
      if (i === 1) perch = e; });
    return { geo: T.geo(), perch };
  });
}
function lilyPatchGeo(v) {
  return cached(`lily:${v}`, () => {
    const R = rng(v * 37 + 1), T = new Tris(0.5), G = [0x4a8a3a, 0x5a9a44, 0x3a7a34, 0x6aa84c], P = spots(R, 11 + v, 0.72, 0.3);
    P.forEach(([x, z], i) => { const r = 0.13 + R() * 0.1, a0 = R() * TAU, y = 0.012 + (i % 3) * 0.003, n = 8; for (let j = 1; j < n; j++) { const a = a0 + (j / n) * TAU, b = a0 + ((j + 1) / n) * TAU; if (j === n - 1) break; T.face([x, y, z], [x + Math.cos(a) * r, y, z + Math.sin(a) * r], [x + Math.cos(b) * r, y, z + Math.sin(b) * r], j % 2 ? G[i & 3] : tone(G[i & 3], 0.03)); }
      if (i % 4 === 0) { const pc = [[0xffffff, 0xf8e8f0], [0xf890b8, 0xffc0d8], [0xfff0a0, 0xffffff]][(i / 4 + v) % 3 | 0], fx = x + 0.02, fz = z + 0.02; for (let j = 0; j < 6; j++) { const a = (j / 6) * TAU, b = a + 0.62; T.face([fx, y + 0.02, fz], [fx + Math.cos(a) * 0.11, y + 0.07, fz + Math.sin(a) * 0.11], [fx + Math.cos(b) * 0.11, y + 0.07, fz + Math.sin(b) * 0.11], pc[j % 2]); } T.blob([fx, y + 0.06, fz], [0.035, 0.035, 0.035], 0xf2c020, { kind: 'o0', jag: 0 }); }
      else if (i % 4 === 2) T.lathe([[0.03, y], [0.04, y + 0.05], [0.005, y + 0.12]], 4, 0xf0a0c0, { x: x + r * 1.15, z }); });
    return T.geo();
  });
}
function puntGeo(v) {
  return cached(`punt:${v}`, () => {
    const T = new Tris(), pal = [PLANK, [0x7a6040, 0x8a7050, 0x6a5236, 0x947a58], [0x4e5a50, 0x5c6a5e, 0x424e44, 0x6a786a]][v], hb = 0.32, prof = [[-1.0, 0.2], [-1.0, 0.13], [-0.68, -0.05], [0.68, -0.05], [1.0, 0.13], [1.0, 0.2]];
    for (const s of [-1, 1]) for (let i = 1; i < prof.length - 1; i++) { const x0 = prof[i][0], x1 = prof[i + 1] ? prof[i + 1][0] : 1; if (i < 4) { T.quad([prof[i][0], prof[i][1], s * hb], [prof[i + 1][0], prof[i + 1][1], s * hb], [prof[i + 1][0], 0.2, s * (hb + 0.02)], [prof[i][0], 0.2, s * (hb + 0.02)], pal[i & 3], [0, 0.4, 0]); T.quad([x0, 0.2, s * (hb + 0.04)], [x1, 0.2, s * (hb + 0.04)], [x1, 0.2, s * (hb - 0.03)], [x0, 0.2, s * (hb - 0.03)], pal[3]); } }
    for (let i = 1; i < 4; i++) T.quad([prof[i][0], prof[i][1], -hb], [prof[i + 1][0], prof[i + 1][1], -hb], [prof[i + 1][0], prof[i + 1][1], hb], [prof[i][0], prof[i][1], hb], i === 2 ? pal[2] : pal[0], [0, 0.4, 0]);
    for (const s of [-1, 1]) { T.quad([s * 1.0, 0.13, -hb], [s * 1.0, 0.13, hb], [s * 1.0, 0.2, hb], [s * 1.0, 0.2, -hb], pal[1], [0, 0.2, 0]); T.quad([s * 0.76, 0.19, -hb], [s * 1.0, 0.19, -hb], [s * 1.0, 0.19, hb], [s * 0.76, 0.19, hb], pal[1]); }
    for (let c = 0; c < 5; c++) T.quad([-0.66 + c * 0.265, -0.03, -hb + 0.02], [-0.66 + (c + 1) * 0.265 - 0.012, -0.03, -hb + 0.02], [-0.66 + (c + 1) * 0.265 - 0.012, -0.03, hb - 0.02], [-0.66 + c * 0.265, -0.03, hb - 0.02], pal[(c * 3 + 1) & 3]);
    T.box([-0.25, 0.14, 0], [0.07, 0.015, hb], pal[3]);
    // pole, fish traps, stake and rope
    T.tube([[-1.5, 0.62, 0.3], [0.7, 0.2, -0.22]], 0.028, 4, WOOD_L);
    const trap = (x, z, ry, s) => T.at(x, 0.06 * s, z, ry, s, 0, 0, () => { T.tube([[-0.17, 0.04, 0], [0.12, 0.04, 0], [0.2, 0.04, 0]], [[0.1, 0.1], [0.1, 0.1], [0.045, 0.045]], 6, (p, n, lp) => (Math.round(lp[0] * 16) % 2 ? 0xc8a868 : 0x8a6a3c)); });
    trap(0.3, 0.08, 0.3, 1); trap(0.05, -0.12, -0.5, 0.9); if (v !== 1) trap(0.5, -0.1, 1.4, 0.8);
    T.blob([-0.52, 0.03, 0.05], [0.12, 0.07, 0.14], (p, n) => (hash(p[0] * 30, p[2] * 30) > 0.5 ? 0x6a8a80 : 0x587870), { kind: 'o0', jag: 0.2 });
    T.tube([[1.3, -0.3, 0.3], [1.28, 0.3, 0.3], [1.3, 0.72, 0.31]], [0.055, 0.05, 0.045], 5, (p) => (p[1] < 0.1 ? 0x2e2a22 : CYP)); T.tube([[0.98, 0.2, 0.1], [1.14, 0.1, 0.2], [1.28, 0.42, 0.3]], 0.018, 3, 0xc8b078);
    T.lathe([[0.062, 0.4], [0.062, 0.46]], 5, 0xc8b078, { x: 1.285, z: 0.3, capBot: true });
    return T.geo();
  });
}
function bogMoundGeo(v) {
  return cached(`bog:${v}`, () => {
    const R = rng(v * 11 + 9), T = new Tris(), moss = (p, n) => (p[1] < 0.06 ? MUDC : n[1] > 0.5 ? [0x5a7a34, 0x6a8a3a, 0x4a6a30, 0x7a9440][Math.floor(hash(p[0] * 5, p[2] * 5) * 4)] : 0x4a5a2a);
    T.lathe([[1.0, 0], [0.86, 0.16], [0.6, 0.36], [0.3, 0.5], [0.02, 0.55]], 10, moss, { sz: 0.9, mod: (j, i) => 1 + (hash(j * 3.1, i * 1.7, v) - 0.5) * 0.24 });
    // toadstools
    for (let k = 0; k < 5; k++) { const a = k * 1.4 + v * 2, r = 0.25 + R() * 0.4, x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9, y = 0.52 - r * 0.42, s = 0.7 + R() * 0.7, h = 0.16 * s;
      T.lathe([[0.03 * s, y - 0.04], [0.025 * s, y + h]], 5, 0xf0e8d0, { x, z, capTop: false });
      T.lathe([[0.12 * s, y + h], [0.09 * s, y + h + 0.06 * s], [0.02 * s, y + h + 0.09 * s]], 6, (p, n) => (n[1] < -0.3 ? 0xf0e8d0 : hash(Math.round(p[0] * 60), Math.round(p[2] * 60)) > 0.72 ? 0xfff8f0 : k % 3 === 2 ? 0xd8902a : 0xc8281c), { x, z, capBot: true }); }
    // stump with the wisp lantern
    const sx = [-0.35, 0.3, 0.0][v], sz = [0.1, -0.15, 0.3][v], sy = 0.36;
    const ring = (r, y, jag) => { const o = []; for (let j = 0; j < 7; j++) { const a = (j / 7) * TAU; o.push([sx + Math.cos(a) * r * (j % 2 ? 0.85 : 1.1), y + (jag ? hash(j, v) * 0.14 : 0), sz - Math.sin(a) * r * (j % 2 ? 0.85 : 1.1)]); } return o; };
    T.stack([ring(0.2, sy - 0.1, 0), ring(0.13, sy + 0.1, 0), ring(0.12, sy + 0.32, 1)], (p, n) => (n[1] > 0.6 ? 0xa89878 : mix(CYP_D, CYP, hash(p[1] * 9, p[0] * 9))), true);
    const ly = sy + 0.52;
    T.box([sx, ly - 0.11, sz], [0.075, 0.015, 0.075], 0x2a2a2a); T.box([sx, ly + 0.11, sz], [0.075, 0.015, 0.075], 0x2a2a2a); for (const [dx, dz] of [[-1, -1], [1, 1]]) T.beam([sx + dx * 0.068, ly - 0.11, sz + dz * 0.068], [sx + dx * 0.068, ly + 0.11, sz + dz * 0.068], 0.014, 0.014, 0x2a2a2a, [0, 0]);
    T.lathe([[0.06, ly + 0.12], [0.012, ly + 0.19]], 4, 0x2a2a2a, { x: sx, z: sz });
    for (let k = 0; k < 7; k++) { const a = k * 0.9 + v, r = 0.55 + R() * 0.3, x = Math.cos(a) * r, z = Math.sin(a) * r * 0.9, y = Math.max(0.02, 0.5 - r * 0.5); for (let b = 0; b < 3; b++) T.face([x - 0.03 + b * 0.03, y, z], [x + 0.03 + b * 0.03, y, z + 0.02], [x + (b - 1) * 0.1, y + 0.2 + R() * 0.12, z + (R() - 0.5) * 0.1], b % 2 ? 0x7a9a44 : 0x5a8a3a); }
    const Wm = new Tris(0); Wm.blob([0, 0, 0], [0.065, 0.085, 0.065], glowCol(WISP, WISP_HOT), { kind: 'o0', jag: 0 });
    return { body: T.geo(), wisp: Wm.geo(), wispAt: [sx, ly, sz] };
  });
}
function toadGeo(v) {
  return cached(`toad:${v}`, () => {
    const B = new Tris(), Th = new Tris(), c1 = [0x6e7034, 0x7a5a34, 0x5a6a3a][v], c2 = [0x4a4e22, 0x55391e, 0x3a4a28][v], belly = 0xd8d0a0, col = (p, n) => (n[1] < -0.35 ? belly : mix(c2, c1, clamp(0.4 + n[1] * 0.6 + hash(p[0] * 14, p[2] * 14) * 0.3, 0, 1)));
    B.spindle([[-0.2, 0.09, 0.09, 0.07], [-0.1, 0.13, 0.2, 0.13], [0.04, 0.16, 0.21, 0.155], [0.16, 0.165, 0.17, 0.125], [0.24, 0.15, 0.1, 0.07]], 7, col);
    B.box([0, 0.135, 0.245], [0.1, 0.008, 0.012], 0x2a2414);
    for (const s of [-1, 1]) {
      B.blob([s * 0.1, 0.28, 0.14], [0.055, 0.055, 0.055], (p, n) => (n[1] > 0.55 ? c1 : n[2] > 0.1 || Math.abs(n[0]) > 0.5 ? 0xe8c030 : c1), { kind: 'o0', jag: 0 }); B.face([s * 0.13, 0.3, 0.17], [s * 0.15, 0.27, 0.15], [s * 0.125, 0.26, 0.19], 0x14100c);
      B.blob([s * 0.2, 0.08, -0.08], [0.09, 0.08, 0.14], col, { kind: 'o0', jag: 0.1, ry: s * 0.4 }); B.face([s * 0.2, 0.012, 0.0], [s * 0.34, 0.012, 0.04], [s * 0.3, 0.012, -0.12], c2);
      B.beam([s * 0.14, 0.12, 0.14], [s * 0.19, 0.0, 0.2], 0.05, 0.05, c2, [0, 0]); B.face([s * 0.15, 0.012, 0.19], [s * 0.26, 0.012, 0.24], [s * 0.2, 0.012, 0.3], c2);
      for (let k = 0; k < 4; k++) B.blob([s * (0.05 + k * 0.035), 0.265 - k * 0.022 + (k === 0 ? 0.015 : 0), -0.08 + k * 0.05 - (k % 2) * 0.09], 0.028, tone(c1, 0.12), { kind: 'o0', jag: 0 });
    }
    Th.blob([0, 0, 0], [0.11, 0.065, 0.06], (p, n) => mix(0xb8b080, belly, 0.5 + n[1] * 0.5), { kind: 'o1', jag: 0.04 });
    return { body: B.geo(), throat: Th.geo(), throatAt: [0, 0.085, 0.2] };
  });
}

const swamp = {
  /** bald cypress with knees and hanging moss, 1.8 across, 4.2 high; roots reach to -0.3. userData.crown sways */
  cypress(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = cypressGeo(v), g = new THREE.Group();
    g.add(mesh(G.trunk, matScene), part(G.crown, matScene, 'sway', { amp: 0.02, rate: 0.7, ph: (s % 23) * 0.5 }, [0, G.py, 0]));
    return finish(g, 'cypress', v, { crown: ['sway', 1] });
  },
  /** cattails and reeds, 1.6 across, 1.2 high; sways */
  reedBed(seed) { mats(); const s = seedOf(seed), v = s % 3, g = new THREE.Group(); g.add(part(reedBedGeo(v), matScene, 'sway', { amp: 0.03, rate: 1.3, ph: s * 0.8 })); return finish(g, 'reedBed', v, { reeds: ['sway', 1] }); },
  /** crooked plank shack on stilts, 2.2 x 1.8, 3 high (door and ladder side +Z / +X). userData.lantern flickers, userData.smoke = stovepipe puffs */
  stiltShack(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = stiltShackGeo(v), g = new THREE.Group();
    g.add(mesh(G.body, matScene), mesh(G.glow, matGlow, false), part(G.lantern, matGlow, 'flick', { amp: 0.14, ph: s }, G.lanternAt, false));
    smoke(g, 3, G.pipe, { rise: 0.75, s0: 0.06, s1: 0.17, rate: 0.19, drift: [0.22, 0.1], tint: 0, seed: s });
    return finish(g, 'stiltShack', v, { lantern: ['flick', 1], smoke: ['puff', 0] });
  },
  /** two herons and an egret in the shallows, 1.4 across (legs reach below the water). userData.animals */
  heronGroup(seed) {
    const s = seedOf(seed), R = rng(s * 9 + 7), g = new THREE.Group(), P = spots(R, 3, 0.56, 0.62);
    for (let i = 0; i < 3; i++) g.add(place(animal(heronGeo(i === 2 ? 1 : 0), 'stalk', { ph: R() * 40, rate: 0.8 + R() * 0.5, down: 1.15 }), P[i][0], 0, P[i][1], R() * TAU, 0.95 + R() * 0.15));
    return finish(g, 'heronGroup', 0, { animals: ['animal', 0] });
  },
  /** half-submerged alligator, 2.2 long, head toward +X; y = 0 is the water. userData.animals (its tail sculls) */
  alligator(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = alligatorGeo(v), g = new THREE.Group(), a = group('animal', { act: 'stir', ph: s * 1.3, rate: 0.9 + (s % 5) * 0.06 });
    const tl = mesh(G.tail, matScene); tl.position.set(G.tailAt[0], G.tailAt[1], G.tailAt[2]); tl.userData = { role: 'tail' };
    a.add(mesh(G.body, matScene), tl); g.add(place(a, 0.1, 0, 0, 0, 1));
    return finish(g, 'alligator', v, { animals: ['animal', 0] });
  },
  /** a drifting cloud of 14 glowing motes, 2 across, 0.4-1.6 up. userData.motes */
  fireflies(seed) {
    mats(); const s = seedOf(seed), R = rng(s * 3 + 11), g = new THREE.Group(), geo = cached('mote', () => { const T = new Tris(0); T.blob([0, 0, 0], 1, glowCol(FLY, 0xf8ffc0), { kind: 'o0', jag: 0 }); return T.geo(); });
    for (let i = 0; i < 14; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 0.7, m = mesh(geo, matGlow, false); m.userData = { role: 'mote', base: [Math.cos(a) * r, 0.62 + R() * 0.76, Math.sin(a) * r], ph: R() * 60, rate: 0.7 + R() * 0.7, r: 0.2 + R() * 0.1, s: 0.07 + R() * 0.035 }; g.add(m); }
    return finish(g, 'fireflies', 0, { motes: ['mote', 0] });
  },
  /** bleached drowned tree with a crow, 1.4 across, 3 high; roots reach to -0.3. userData.crow */
  deadTree(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = deadTreeGeo(v), g = new THREE.Group();
    g.add(mesh(G.geo, matScene));
    const c = group('animal', { act: 'look', ph: s * 0.9, rate: 1.4, turn: 1.2, bobY: 0.02 }); c.add(mesh(flyerGeo('crow').body, matScene)); g.add(place(c, G.perch[0], G.perch[1] + 0.01, G.perch[2], s * 1.3, 1.15));
    return finish(g, 'deadTree', v, { crow: ['animal', 1] });
  },
  /** lily pads and flowers lying on the water, 1.8 across */
  lilyPatch(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(lilyPatchGeo(v), matScene), 'lilyPatch', v); },
  /** flat-bottomed punt 2.2 long along X with pole and fish traps, moored to a stake at +X; y = 0 is the water */
  punt(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(puntGeo(v), matScene), 'punt', v); },
  /** mossy hummock with toadstools and a will-o'-wisp lantern on a stump, 2 across, 0.6 high (lantern to 1.1). userData.wisp */
  bogMound(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = bogMoundGeo(v), g = new THREE.Group();
    g.add(mesh(G.body, matScene), part(G.wisp, matGlow, 'flick', { amp: 0.25, ph: s * 1.9, bob: 0.02 }, G.wispAt, false));
    return finish(g, 'bogMound', v, { wisp: ['flick', 1] });
  },
  /** a warty oversized toad, 0.6 across, facing +Z. userData.animals */
  giantToad(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = toadGeo(v), g = new THREE.Group(), a = group('animal', { act: 'toad', ph: s * 2.1, rate: 0.9 + (s % 4) * 0.1 });
    const th = mesh(G.throat, matScene); th.position.set(G.throatAt[0], G.throatAt[1], G.throatAt[2]); th.userData = { role: 'throat' };
    a.add(mesh(G.body, matScene), th); g.add(place(a, 0, 0, -0.02, 0, 1.1));
    return finish(g, 'giantToad', v, { animals: ['animal', 0] });
  },
};

// =====================================================================================
// VOLCANIC
// =====================================================================================
const ASH = 0x423d3a, ASH_L = 0x5e5955, ASH_D = 0x2c2826, BASALT = 0x242120, SCORIA = 0x5c3024, LAVA_Y = 0xffd040, LAVA_O = 0xff7a10, LAVA_R = 0xd82a06, LAVA_D = 0x7a1404, CRUST = 0x2a0e08;
const ashCol = (p, n) => mix(ASH_D, mix(ASH, ASH_L, hash(p[0] * 4, p[2] * 4)), clamp(0.3 + n[1] * 0.8, 0, 1));

function volcanoGeo(v) {
  return cached(`volcano:${v}`, () => {
    const T = new Tris(1.3), Lv = new Tris(0), NU = 36, NV = 13, RIM = 0.17, sd = v * 2.7 + 0.6, breach = [0.9, 3.3, 5.1][v];
    const ridge = (a) => Math.sin(a * 9 + Math.sin(a * 3 + sd) * 1.5 + sd) * 0.6 + Math.sin(a * 17 + sd * 2) * 0.28 + Math.sin(a * 5 - sd) * 0.3;
    const dA = (a) => { let d = Math.abs(a - breach) % TAU; return d > PI ? TAU - d : d; };
    const rimY = (a) => 1.0 + 0.05 * Math.sin(a * 4 + sd) + 0.045 * Math.sin(a * 7 + sd * 3) + 0.07 * Math.max(0, Math.cos(a - breach - 2.2)) - 0.16 * Math.max(0, 1 - dA(a) / 0.5);
    const baseR = (a) => 0.9 + 0.1 * Math.sin(a * 3 + sd) * Math.sin(a * 2 - sd) + 0.05 * Math.sin(a * 7 + sd) + 0.05;
    const surf = (a, vv) => {
      const r = lerp(RIM, Math.min(1, baseR(a)), vv ** 1.15), h = rimY(a) * (1 - vv) ** 1.75 + 0.16 * (1 - vv) * vv * 4 * 0.5;
      const g = ridge(a) * 0.06 * Math.sin(PI * clamp(vv * 1.05, 0, 1)) ** 0.7 * (0.6 + vv);
      return [Math.cos(a) * r, vv >= 1 ? 0 : Math.max(0.004, h + g), Math.sin(a) * r];
    };
    T.sheet(NU, NV, (u, vv) => surf(u * TAU, vv), (p, n, lp, u, vv) => {
      const a = u * TAU, rd = ridge(a), k = hash(p[0] * 9, p[1] * 9, p[2] * 9);
      let c = mix(mix(ASH, ASH_L, clamp(0.5 - rd * 0.5, 0, 1) * 0.4), BASALT, clamp(rd * 0.7 + k * 0.5 - 0.2, 0, 1));
      if (vv < 0.3) c = mix(c, SCORIA, (0.3 - vv) / 0.3 * 0.75);
      if (vv > 0.8) c = mix(c, 0x4a433e, (vv - 0.8) / 0.2 * 0.6);
      return c;
    }, [0, 0.3, 0]);
    // crater wall and the lava lake
    const LY = 0.84, LR = 0.1;
    T.sheet(NU, 2, (u, vv) => { const a = u * TAU, r = lerp(RIM, LR, vv ** 0.7); return [Math.cos(a) * r, lerp(rimY(a), LY - 0.01, vv), Math.sin(a) * r]; }, (p, n, lp, u, vv) => (vv > 0.5 ? 0x8a2c10 : mix(SCORIA, 0x3a1a12, hash(u * 40, 1))));
    for (let j = 0; j < 12; j++) { const a = (j / 12) * TAU, b = ((j + 1) / 12) * TAU; Lv.face([0, LY + 0.012, 0], [Math.cos(a) * LR * 0.55, LY + 0.008, Math.sin(a) * LR * 0.55], [Math.cos(b) * LR * 0.55, LY + 0.008, Math.sin(b) * LR * 0.55], j % 3 ? LAVA_Y : 0xffe880); Lv.quad([Math.cos(a) * LR * 0.55, LY + 0.008, Math.sin(a) * LR * 0.55], [Math.cos(b) * LR * 0.55, LY + 0.008, Math.sin(b) * LR * 0.55], [Math.cos(b) * LR * 1.06, LY, Math.sin(b) * LR * 1.06], [Math.cos(a) * LR * 1.06, LY, Math.sin(a) * LR * 1.06], j % 2 ? LAVA_O : 0xff5a08); }
    // glowing cracks down the gullies, and the flow through the breach
    const mins = []; for (let j = 0; j < 72; j++) { const a = (j / 72) * TAU; if (ridge(a) < ridge(a - 0.09) && ridge(a) < ridge(a + 0.09) && ridge(a) < -0.3 && dA(a) > 0.5) mins.push(a); }
    const crack = (a0, v0, v1, w0, w1, hot) => { const n = 7; let prev = null; for (let i = 0; i <= n; i++) { const vv = lerp(v0, v1, i / n), a = a0 + Math.sin(vv * 9 + a0 * 5) * 0.035, w = lerp(w0, w1, i / n) / Math.max(0.2, lerp(RIM, 1, vv)), L = surf(a - w, vv), Rr = surf(a + w, vv), C = surf(a, vv); L[1] = Math.max(L[1], C[1]) + 0.012; Rr[1] = Math.max(Rr[1], C[1]) + 0.012; const cur = [L, Rr]; if (prev) Lv.quad(prev[0], prev[1], cur[1], cur[0], i < 3 || hot ? (i % 2 ? LAVA_O : LAVA_Y) : i < 5 ? (i % 2 ? LAVA_O : LAVA_R) : LAVA_R); prev = cur; } };
    mins.slice(0, 6).forEach((a, i) => crack(a, 0.03, 0.3 + (i % 3) * 0.1, 0.014, 0.004, false));
    crack(breach, 0.0, 0.86, 0.03, 0.02, true);
    // where the lake spills through the breach
    Lv.quad([Math.cos(breach - 0.3) * LR, LY + 0.004, Math.sin(breach - 0.3) * LR], [Math.cos(breach + 0.3) * LR, LY + 0.004, Math.sin(breach + 0.3) * LR], surf(breach + 0.16, 0), surf(breach - 0.16, 0), LAVA_Y);
    return { cone: T.geo(), lava: Lv.geo(), top: rimY(breach + PI) };
  });
}
function lavaFlowGeo(v) {
  return cached(`lflow:${v}`, () => {
    const T = new Tris(), Lv = new Tris(0), n = 6, wob = (x) => Math.sin(x * TAU) * 0.02 * (v ? -1 : 1) + Math.sin(x * TAU * 2) * 0.012;
    const row = (x, k) => { const w = wob(x), e = (hash(k, v) - 0.5) * 0.03 * (k % n ? 1 : 0); return { x, o: [-0.175 - e, 0.175 + e], c: [-0.125 + w - e * 0.5, 0.125 + w + e * 0.5], l: [-0.08 + w, 0.08 + w], w, h: 0.045 + (k % n ? hash(k, 3) * 0.02 : 0) }; };
    let p = row(-0.5, 0);
    for (let k = 1; k <= n; k++) {
      const q = row(-0.5 + k / n, k);
      for (const s of [0, 1]) { const c = (pp, nn) => mix(BASALT, ASH, hash(pp[0] * 20, pp[2] * 20) * 0.9); T.quad([p.x, 0.003, p.o[s]], [q.x, 0.003, q.o[s]], [q.x, q.h, q.c[s]], [p.x, p.h, p.c[s]], c, [p.x, -0.2, 0]); T.quad([p.x, p.h, p.c[s]], [q.x, q.h, q.c[s]], [q.x, 0.02, q.l[s]], [p.x, 0.02, p.l[s]], k % 2 ? CRUST : 0x4a1a0c, [p.x, 0.5, s ? 1 : -1]);
        Lv.quad([p.x, 0.02, p.l[s]], [q.x, 0.02, q.l[s]], [q.x, 0.034, q.w], [p.x, 0.034, p.w], (k + s) % 2 ? LAVA_O : 0xff9a20); }
      if (k % 2) { const cx = (p.x + q.x) / 2 + 0.02, cz = p.w + (k % 4 === 1 ? 0.03 : -0.035); Lv.quad([cx - 0.04, 0.036, cz - 0.02], [cx + 0.03, 0.036, cz - 0.028], [cx + 0.045, 0.036, cz + 0.02], [cx - 0.03, 0.036, cz + 0.026], LAVA_Y); }
      else { const cx = (p.x + q.x) / 2, cz = p.w + (k % 4 ? 0.04 : -0.03); T.quad([cx - 0.035, 0.037, cz - 0.02], [cx + 0.03, 0.037, cz - 0.015], [cx + 0.04, 0.037, cz + 0.02], [cx - 0.02, 0.037, cz + 0.024], CRUST); }
      p = q;
    }
    return { crust: T.geo(), lava: Lv.geo() };
  });
}
function basaltColumnsGeo(v) {
  return cached(`basalt:${v}`, () => {
    const R = rng(v * 7 + 13), T = new Tris(), r = 0.185, C = [0x3a3a42, 0x2c2c33, 0x484850, 0x33333a], peak = [[0.1, -0.15], [-0.2, 0.05], [0.25, 0.1]][v];
    for (let q = -3; q <= 3; q++) for (let s = -3; s <= 3; s++) {
      const x = (q + s * 0.5) * r * 1.74, z = s * r * 1.5, d = Math.hypot((x - peak[0]) / 0.86, (z - peak[1]) / 0.78);
      if (Math.hypot(x / 0.82, z / 0.76) > 1) continue;
      const h = Math.max(0.12, 2.2 * (1 - d * 0.78) ** 1.2 + (R() - 0.5) * 0.4) * (d < 0.15 ? 1 : 0.94), tilt = (R() - 0.5) * 0.12, c = C[Math.floor(R() * 4)];
      const top = [], bot = []; for (let j = 0; j < 6; j++) { const a = (j / 6) * TAU; top.push([x + Math.cos(a) * r, Math.min(2.2, h + Math.cos(a + q) * tilt), z - Math.sin(a) * r]); bot.push([x + Math.cos(a) * r, 0, z - Math.sin(a) * r]); }
      T.stack([bot, top], (p, n) => (n[1] > 0.7 ? mix(0x4e4e58, 0x62626c, hash(q, s)) : mix(c, tone(c, -0.04), hash(Math.round(p[1] * 3), q, s))), true);
    }
    for (let k = 0; k < 3; k++) { const a = k * 2.2 + v; T.at(Math.cos(a) * 0.72, 0.13, Math.sin(a) * 0.7, a * 2, 1, 0, PI / 2 - 0.15, () => T.lathe([[0.15, -0.2], [0.15, 0.2]], 6, C[k], { capBot: true })); }
    return T.geo();
  });
}
function charredTreeGeo(v) {
  return cached(`char:${v}`, () => {
    const T = new Tris(), E = new Tris(0), lean = [[0.12, 0.05], [-0.1, 0.08], [0.04, -0.12]][v], H = [2.3, 2.6, 2.0][v], EY = 1.2;
    const coal = (p, n) => mix(0x141110, mix(0x2c2624, 0x4a4542, clamp(n[1], 0, 1)), clamp(0.4 + n[0] * 0.3 + hash(p[1] * 9, p[0] * 9, p[2] * 9) * 0.5, 0, 1));
    const ax = (y) => [lean[0] * y, y, lean[1] * y];
    T.lathe([[0.36, 0], [0.2, 0.18], [0.15, 0.8], [0.12, H * 0.7], [0.07, H - 0.2], [0.012, H]], 6, coal, { mod: (j, i) => (i === 0 ? (j % 2 ? 0.7 : 1.2) : 1 + (hash(j, i, v) - 0.5) * 0.2), lean: (y) => [lean[0] * y, lean[1] * y] });
    const br = [[0.9, 0.6, 0.8, 0.5], [1.3, 2.9, 0.95, 0.75], [1.65, 4.6, 0.7, 0.9], [H * 0.8, 1.6, 0.55, 1.1]], tips = [];
    br.forEach(([y, a, L, up]) => { const o = ax(y), d = [Math.cos(a + v * 1.1), 0, Math.sin(a + v * 1.1)], m = [o[0] + d[0] * L * 0.5, y + up * L * 0.3, o[2] + d[2] * L * 0.5], e = [o[0] + d[0] * L * 0.85, Math.min(2.6, y + up * L * 0.85), o[2] + d[2] * L * 0.85];
      T.tube([o, m, e], [0.08, 0.055, 0.012], 4, coal, { caps: [0, 1] }); T.tube([m, [m[0] + d[2] * 0.22, m[1] + 0.3, m[2] - d[0] * 0.22]], [0.04, 0.008], 3, coal, { caps: [0, 1] }); tips.push(m); });
    T.patch([0, 0, 0], 0.5, 0.46, 7, 0x1e1a18, ASH_D, { y: 0.02, seed: v });
    // embers in the cracks (about the middle of the trunk)
    for (let k = 0; k < 7; k++) { const y = 0.25 + k * 0.27, a = k * 2.4 + v, c = ax(y), r = lerp(0.2, 0.09, y / H) + 0.012, x = c[0] + Math.cos(a) * r, z = c[2] + Math.sin(a) * r, tx = -Math.sin(a) * 0.055, tz = Math.cos(a) * 0.055; E.quad([x, y - EY - 0.14, z], [x + tx, y - EY, z + tz], [x, y - EY + 0.16, z], [x - tx, y - EY, z - tz], k % 2 ? LAMP : EMBER); }
    tips.forEach(([x, y, z], i) => E.blob([x, y - EY + 0.02, z], [0.035, 0.045, 0.035], i % 2 ? EMBER : 0xff8a18, { kind: 'o0', jag: 0 }));
    return { body: T.geo(), embers: E.geo(), ey: EY };
  });
}
function obsidianGeo(v) {
  return cached(`obsid:${v}`, () => {
    const R = rng(v * 31 + 17), T = new Tris(0.6), glass = (p, n) => { const k = n[0] * 0.5 + n[2] * 0.3 + n[1] * 0.6; return k > 0.55 ? 0x7a7a9a : k > 0.2 ? 0x3a2e5a : k > -0.2 ? 0x1c1a26 : 0x0e0c14; };
    const shard = (x, z, h, r, tilt, yaw, n) => T.at(x, 0, z, yaw, 1, tilt, 0, () => T.lathe([[r * 0.85, -0.1], [r, h * 0.22], [r * 0.7, h * 0.72], [0.004, h]], n, glass, { mod: (j, i) => 0.75 + hash(j * 2.3, i, x * 9) * 0.5, a0: yaw }));
    shard(0, 0, [2.4, 2.2, 2.4][v], 0.27, [0.04, -0.1, 0.12][v], v, 5);
    const n = 5 + (v % 2);
    for (let k = 0; k < n; k++) { const a = (k / n) * TAU + v, r = 0.26 + R() * 0.12; shard(Math.cos(a) * r, Math.sin(a) * r, 0.7 + R() * 0.9, 0.13 + R() * 0.07, 0.28 + R() * 0.3, -a + PI / 2, 4); }
    for (let k = 0; k < 4; k++) T.blob([Math.cos(k * 1.7 + v) * 0.42, 0.03, Math.sin(k * 1.7 + v) * 0.42], [0.09, 0.07, 0.08], glass, { kind: 'o0', jag: 0.3, seed: k });
    return T.geo();
  });
}
function smokeVentGeo(v) {
  return cached(`vent:${v}`, () => {
    const T = new Tris(), Gl = new Tris(0), SUL = [0xd8c020, 0xe8d850, 0xc89a18, 0xf0e488], sz = [0.62, 0.8, 0.55][v];
    T.lathe([[0.4, 0], [0.31, 0.11], [0.2, 0.22], [0.13, 0.24], [0.09, 0.12]], 9, (p, n, lp) => { const k = hash(Math.round(lp[0] * 14), Math.round(lp[2] * 14), v); return lp[1] > 0.19 ? SUL[Math.floor(k * 4)] : lp[1] > 0.1 && k > 0.5 ? SUL[2] : mix(BASALT, ASH, k); }, { sz, mod: (j, i) => 1 + (hash(j * 1.9, i, v) - 0.5) * 0.3, capTop: false, a0: v });
    Gl.lathe([[0.1, 0.125], [0.0, 0.11]], 6, (p) => (hash(p[0] * 50, p[2] * 50) > 0.5 ? EMBER_D : 0x7a1404), { sz, capTop: false });
    for (let k = 0; k < 5; k++) { const a = k * 1.3 + v; T.patch([Math.cos(a) * 0.36, 0, Math.sin(a) * 0.3], 0.1, 0.08, 5, SUL[k & 3], SUL[2], { y: 0.012, seed: k }); }
    for (let k = 0; k < 3; k++) T.blob([Math.cos(k * 2.3 + 1 + v) * 0.3, 0.03, Math.sin(k * 2.3 + 1 + v) * 0.26], [0.07, 0.06, 0.06], BASALT, { kind: 'o0', jag: 0.3, seed: k });
    return { body: T.geo(), glow: Gl.geo() };
  });
}
function ashRuinGeo(v) {
  return cached(`aruin:${v}`, () => {
    const R = rng(v * 5 + 3), T = new Tris(), hx = 1.08, hz = 0.86, rowH = 0.16, rows = 10, th = 0.13;
    const st = (id, r) => [0x5c5856, 0x4a4644, 0x6c6864, 0x3e3a38, 0x545050][Math.floor(hash(id * 1.9, r * 2.3) * 5)];
    const cs = [[-hx, hz], [hx, hz], [hx, -hz], [-hx, -hz]], cn = [9, 7, 9, 7], hi = [22, 6, 14][v];   // perimeter column where the walls stand tallest
    const top = (p) => { let d = Math.abs(p - hi) % 32; d = Math.min(d, 32 - d); return clamp(Math.round(9.5 - d * 0.52 + (hash(p, v) - 0.5) * 2.6), 1, rows); };
    let base = 0;
    for (let w = 0; w < 4; w++) { const b0 = base; T.wall(cs[w], cs[(w + 1) % 4], 0, rowH, rows, cn[w], st, { inside: [0, 0], thick: th, top: (c) => top(b0 + c), skip: (c, r) => (w === 0 && c === 3 && r < 6) || (w === 0 && c === 6 && r > 2 && r < 6) || (w === 2 && c === 4 && r > 2 && r < 6) || (w === 1 && c === 3 && r > 2 && r < 6), innerCol: 0x3a3634, capCol: 0x7a7672 }); base += cn[w]; }
    // the gable and chimney stub on the west wall
    const gz = [-0.3, 0, 0.3];
    T.box([-hx + 0.02, 1.05, gz[v]], [0.17, 1.05, 0.2], (p) => st(Math.round(p[1] * 6), Math.round(p[2] * 9))); T.box([-hx + 0.02, 2.12, gz[v]], [0.2, 0.03, 0.23], 0x3e3a38);
    // ash heaped inside and against the walls, charred beams
    T.quad([-hx + th, 0.02, -hz + th], [hx - th, 0.02, -hz + th], [hx - th, 0.02, hz - th], [-hx + th, 0.02, hz - th], ASH);
    drift(T, [0.3, 0, -0.2], [0.7, 0.34, 0.5], ashCol, 1); drift(T, [-0.5, 0, 0.3], [0.5, 0.24, 0.42], ashCol, 2); drift(T, [hx + 0.05, 0, 0.3], [0.36, 0.3, 0.6], ashCol, 3); drift(T, [-0.2, 0, -hz - 0.1], [0.8, 0.26, 0.34], ashCol, 4); drift(T, [0.5, 0, hz + 0.1], [0.6, 0.18, 0.3], ashCol, 5);
    T.beam([-hx + 0.1, 1.2, -0.3], [0.5, 0.2, 0.2], 0.09, 0.09, (p, n) => mix(0x141110, 0x2c2624, hash(p[0] * 9, p[1] * 9))); T.beam([0.1, 0.25, -hz + 0.1], [0.8, 0.5, 0.5], 0.08, 0.08, 0x1c1816);
    for (let k = 0; k < 6; k++) T.box([(R() - 0.5) * 2.6, 0.05, (k % 2 ? 1 : -1) * (hz + 0.12 + R() * 0.12)], [0.09, 0.05, 0.06], st(k, 2), R() * 3, R() * 0.4, 0);
    return T.geo();
  });
}
function scorchGeo(v) {
  return cached(`scorch:${v}`, () => {
    const R = rng(v * 3 + 5), T = new Tris(0.4), Lv = new Tris(0), n = 14, out = [], mid = [];
    for (let j = 0; j < n; j++) { const a = (j / n) * TAU + R() * 0.2, r = (j % 2 ? 0.44 : 0.68) * (0.85 + R() * 0.3); out.push([Math.cos(a) * r, 0.006, Math.sin(a) * r]); mid.push([Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3]); }
    for (let j = 0; j < n; j++) { const k = (j + 1) % n; T.quad(out[j], out[k], mid[k], mid[j], j % 2 ? 0x221e1c : 0x2c2826); T.face(mid[j], mid[k], [0, 0.012, 0], j % 2 ? 0x0e0c0c : 0x161212); }
    for (let k = 0; k < 5; k++) { const a = k * 1.26 + v, w = 0.022; let p0 = [Math.cos(a) * 0.05, Math.sin(a) * 0.05]; for (let s = 1; s <= 3; s++) { const b = a + Math.sin(s * 2 + k) * 0.25, r = 0.05 + s * 0.1, p1 = [Math.cos(b) * r, Math.sin(b) * r], px = -Math.sin(b) * w * (1 - s * 0.22), pz = Math.cos(b) * w * (1 - s * 0.22); Lv.quad([p0[0] - px, 0.024, p0[1] - pz], [p0[0] + px, 0.024, p0[1] + pz], [p1[0] + px * 0.6, 0.024, p1[1] + pz * 0.6], [p1[0] - px * 0.6, 0.024, p1[1] - pz * 0.6], s === 1 ? LAVA_O : s === 2 ? LAVA_R : LAVA_D); p0 = p1; } }
    for (let j = 0; j < 5; j++) { const a = (j / 5) * TAU; Lv.face([0, 0.026, 0], [Math.cos(a) * 0.06, 0.024, Math.sin(a) * 0.06], [Math.cos(a + 1.26) * 0.06, 0.024, Math.sin(a + 1.26) * 0.06], j % 2 ? LAVA_O : LAVA_R); }
    for (let k = 0; k < 6; k++) { const a = k * 1.1 + v, r = 0.38 + R() * 0.26; T.blob([Math.cos(a) * r, 0.02, Math.sin(a) * r], [0.05, 0.04, 0.045], BASALT, { kind: 'o0', jag: 0.3, seed: k }); }
    return { soot: T.geo(), lava: Lv.geo() };
  });
}

const volcanic = {
  /** steep ash cone: base radius 1, rim ~1.05-1.15 high (scale it up to the island). userData.lava (lake, cracks and the breach flow), userData.smoke (the plume), userData.crater = [0, y, 0] */
  volcanoCone(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = volcanoGeo(v), g = new THREE.Group(), lava = mesh(G.lava, matLava, false); lava.userData = { role: 'lava' };
    g.add(mesh(G.cone, matScene), lava);
    smoke(g, 5, [0, 0.92, 0], { rise: 1.0, s0: 0.1, s1: 0.3, rate: 0.07, drift: [0.3, 0.12], tint: 1, seed: s, big: true });
    return finish(g, 'volcanoCone', v, { lava: ['lava', 1], smoke: ['puff', 0] }, { crater: [0, 0.86, 0] });
  },
  /** a glowing river of lava with crusted banks: 1 long along X (ends at x = +-0.5 match, so copies tile), 0.35 wide. userData.lava */
  lavaFlow(seed) {
    mats(); const v = seedOf(seed) % 2, G = lavaFlowGeo(v), g = new THREE.Group(), lava = mesh(G.lava, matLava, false); lava.userData = { role: 'lava' };
    g.add(mesh(G.crust, matScene), lava);
    return finish(g, 'lavaFlow', v, { lava: ['lava', 1] });
  },
  /** a cluster of hexagonal basalt columns, 1.6 across, 2.2 high */
  basaltColumns(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(basaltColumnsGeo(v), matScene), 'basaltColumns', v); },
  /** a burnt black tree with embers, 1 across (branches reach ~1.6), 2.6 high. userData.embers flicker */
  charredTree(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = charredTreeGeo(v), g = new THREE.Group();
    g.add(mesh(G.body, matScene), part(G.embers, matGlow, 'flick', { amp: 0.035, ph: s * 1.3 }, [0, G.ey, 0], false));
    return finish(g, 'charredTree', v, { embers: ['flick', 1] });
  },
  /** jagged black glass shards, 1 across, 2.4 high */
  obsidianSpire(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(obsidianGeo(v), matGloss), 'obsidianSpire', v); },
  /** a fuming fissure with sulphur crust, 0.8 across; steam climbs to ~1.6. userData.smoke */
  smokeVent(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = smokeVentGeo(v), g = new THREE.Group();
    g.add(mesh(G.body, matScene), mesh(G.glow, matGlow, false));
    smoke(g, 4, [0, 0.2, 0], { rise: 1.25, s0: 0.07, s1: 0.2, rate: 0.24, drift: [0.18, 0.08], tint: 2, seed: s });
    return finish(g, 'smokeVent', v, { smoke: ['puff', 0] });
  },
  /** roofless ash-buried stone house, 2.4 x 2, 1.6 high (chimney stub to 2.1; door gap faces +Z) */
  ashRuin(seed) { mats(); const v = seedOf(seed) % 3; return finish(mesh(ashRuinGeo(v), matScene), 'ashRuin', v); },
  /** salamander with a glowing ember back, 0.9 long, facing +Z. userData.animals, userData.glow */
  fireLizard(seed) {
    mats(); const s = seedOf(seed), v = s % 3, G = lizardGeo('flizard', v, { c1: [0x3a302c, 0x4a2a22, 0x2e2c30][v], c2: [0x1a1614, 0x24120e, 0x141418][v], belly: 0x6a3a22, k: 1.55, fat: 1.25, glow: true }), g = new THREE.Group();
    const a = animal(G, 'look', { ph: s * 1.7, rate: 1.1, turn: 0.3, bobY: 0.012 }), gl = mesh(G.glow, matLava, false); gl.userData = { role: 'lava' };
    a.add(gl); g.add(place(a, 0, 0, 0.12, 0, 1));
    return finish(g, 'fireLizard', v, { animals: ['animal', 0], glow: ['lava', 1] });
  },
  /** six bat-like ash birds with glowing eyes circling 2-4 above the ground over 3 tiles. userData.birds */
  emberBats(seed) {
    const s = seedOf(seed), g = flock('bat', 6, s, { spread: 0.6, r0: 0.6, r1: 1.2, h0: 2.1, h1: 3.8, speed: 1.0, bob: 0.22, flapRate: 13, flapAmp: 1.0, glide: 0.15, bank: 0.4, burst: 1.2, size: 1.05 });
    return finish(g, 'emberBats', 0, { birds: ['flyer', 0] });
  },
  /** a glowing molten rock, 0.5 across, centred on its own origin (for the game to throw). userData.lava is the mesh itself */
  lavaBomb(seed) {
    mats(); const v = seedOf(seed) % 3, m = mesh(cached(`bomb:${v}`, () => { const T = new Tris(0); T.blob([0, 0, 0], 0.25, (p) => { const k = hash(p[0] * 9, p[1] * 9, p[2] * 9); return k > 0.62 ? CRUST : k > 0.5 ? LAVA_D : k > 0.25 ? LAVA_O : k > 0.1 ? 0xff9a20 : LAVA_Y; }, { kind: 'i1', jag: 0.2, seed: v + 4 }); return T.geo(); }), matLava, false);
    m.userData = { role: 'lava' };
    return finish(m, 'lavaBomb', v, { lava: ['lava', 1] });
  },
  /** a blackened, faintly glowing crater mark, 1.4 across, flat. userData.lava = the glowing cracks */
  scorch(seed) {
    mats(); const v = seedOf(seed) % 3, G = scorchGeo(v), g = new THREE.Group(), lava = mesh(G.lava, matLava, false); lava.userData = { role: 'lava' };
    const soot = mesh(G.soot, matScene); soot.castShadow = false; g.add(soot, lava);
    return finish(g, 'scorch', v, { lava: ['lava', 1] });
  },
  /** a grey ash drift, 3 x 2, 0.5 high */
  ashDune(seed) {
    mats(); const v = seedOf(seed) % 3;
    return finish(mesh(cached(`ashdunegeo:${v}`, () => { const T = duneGeo('ashdune', v, 3, 2, 0.5, [ASH_L, ASH, 0x625d59, ASH_D]); for (let k = 0; k < 4; k++) T.blob([Math.cos(k * 1.9 + v) * 1.0, 0.03, Math.sin(k * 1.9 + v) * 0.6], [0.09, 0.07, 0.08], BASALT, { kind: 'o0', jag: 0.3, seed: k }); return T.geo(); }), matScene), 'ashDune', v);
  },
};

export const scenery = { ...temperate, ...desert, ...swamp, ...volcanic };

// =====================================================================================
// ANIMATION
// =====================================================================================
function animFlyer(o, t, sub) {
  const u = o.userData, ph = num(u.ph, 0), dir = u.dir < 0 ? -1 : 1, a = ph + t * num(u.speed, 0.7) * dir, R = num(u.R, 1) * (1 + 0.12 * Math.sin(t * 0.31 + ph * 3));
  o.position.set(num(u.cx, 0) + Math.cos(a) * R, num(u.h, 3) + Math.sin(t * 0.5 + ph * 2) * num(u.bob, 0.1), num(u.cz, 0) + Math.sin(a) * R);
  o.rotation.set(Math.sin(t * 0.5 + ph * 2 + 1.2) * 0.08, Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir), dir * num(u.bank, 0.3));
  if (sub && sub.wings) {
    const burst = smooth(Math.sin(t * 0.4 + ph * 4) * 2 + num(u.burst, 0.3));
    let y = num(u.glide, 0.3) + burst * Math.sin(t * num(u.flapRate, 8) + ph * 7) * num(u.flapAmp, 0.8);
    if (Math.abs(y) < 0.03) y = 0.03;
    sub.wings.scale.set(1, y, 1);
  }
}
function animAnimal(o, t, sub) {
  const u = o.userData, r = u.rest;
  if (!Array.isArray(r)) return;
  const ph = num(u.ph, 0), rate = num(u.rate, 1), s = num(r[6], 1), hd = sub && sub.head, tail = sub && sub.tail, throat = sub && sub.throat;
  let x = r[0], y = r[1], z = r[2], ry = r[4], rx = 0, rz = 0, sy = 1;
  switch (u.act) {
    case 'graze': {   // sheep and deer: amble a step, turn a little, head down to the grass
      const w = t * 0.33 * rate + ph, step = Math.sin(w) * 0.07 * s, moving = Math.abs(Math.cos(w));
      ry += Math.sin(w * 0.61 + ph) * 0.3;
      x += Math.sin(ry) * step; z += Math.cos(ry) * step; y += Math.abs(Math.sin(t * 2.6 * rate + ph)) * 0.012 * s * moving;
      if (hd) { const down = smooth(Math.sin(t * 0.47 * rate + ph * 2.3) * 1.4 + (u.shy ? 0.1 : 0.75)); hd.rotation.set(down * num(u.down, 0.9) + Math.sin(t * 7 + ph) * 0.05 * down, Math.sin(t * 0.7 + ph * 1.9) * 0.4 * (1 - down), 0); }
      break;
    }
    case 'chew': {   // camels: slow look around, the jaw grinding sideways
      y += Math.sin(t * 1.1 * rate + ph) * 0.006 * s;
      if (hd) hd.rotation.set(Math.sin(t * 0.31 * rate + ph) * 0.1, Math.sin(t * 0.23 * rate + ph * 1.7) * 0.4, Math.sin(t * 5.2 * rate + ph) * 0.07);
      if (tail) tail.rotation.set(0, 0, Math.sin(t * 2.3 + ph) * 0.3 * pulse(frac(t * 0.13 + ph), 0, 0.3));
      break;
    }
    case 'stalk': {   // herons: wade a slow step, freeze, then strike
      const w = t * 0.27 * rate + ph, step = Math.sin(w) * 0.13 * s, moving = Math.abs(Math.cos(w));
      ry += Math.sin(w * 0.5 + ph) * 0.2;
      x += Math.sin(ry) * step; z += Math.cos(ry) * step; y += Math.abs(Math.sin(t * 1.8 * rate + ph)) * 0.02 * s * moving;
      if (hd) { const k = pulse(frac(t * 0.11 * rate + ph * 0.37), 0, 0.09); hd.rotation.set(k * num(u.down, 1.1) + Math.sin(t * 0.9 + ph) * 0.05, Math.sin(t * 0.33 + ph * 2) * 0.25 * (1 - k), 0); }
      break;
    }
    case 'stir': {   // alligator: drifts, the tail sculling
      y += Math.sin(t * 0.6 + ph) * 0.012 * s; ry += Math.sin(t * 0.21 + ph) * 0.1;
      if (tail) tail.rotation.set(0, Math.sin(t * 0.9 * rate + ph) * 0.3, 0);
      if (hd) hd.rotation.set(-pulse(frac(t * 0.05 * rate + ph * 0.3), 0, 0.2) * 0.35, 0, 0);
      break;
    }
    case 'toad': {   // squats breathing, the throat swelling; now and then a hop on the spot
      const hop = pulse(frac(t * 0.09 * rate + ph * 0.61), 0, 0.07);
      y += hop * 0.14 * s; sy = 1 + Math.sin(t * 2.4 * rate + ph) * 0.03 - hop * 0.06; rx = -hop * 0.25;
      ry += Math.sin(t * 0.17 + ph) * 0.2;
      if (throat) throat.scale.setScalar(1 + 0.3 * Math.max(0, Math.sin(t * 3.1 * rate + ph)));
      break;
    }
    default: {   // 'look': lizards, scorpion, crow - mostly still, a turn of the head, a flick of the tail
      const turn = smooth(Math.sin(t * 0.23 * rate + ph) * 3 + 0.5) - 0.5;
      ry += turn * num(u.turn, 0.25);
      y += Math.max(0, Math.sin(t * 1.7 * rate + ph)) * num(u.bobY, 0) * s;
      if (hd) hd.rotation.set(Math.sin(t * 0.8 + ph) * 0.08, Math.sin(t * 0.41 * rate + ph * 2.7) * 0.5, 0);
      if (tail) { const k = Math.sin(t * num(u.tailRate, 1.3) * rate + ph * 1.3) * num(u.tailAmp, 0.25); if (u.tailAxis === 'x') tail.rotation.set(k, 0, 0); else tail.rotation.set(0, k, 0); }
    }
  }
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(s, s * sy, s);
}
/** per-frame idle life. Safe on anything: objects that are not from this file are left alone. */
export function animateScenery(obj, t) {
  const u = obj && obj.userData;
  if (!u || !u.anim || !obj.isObject3D) return;
  t = fin0(Number(t));
  const P = partsOf(obj);
  if (!P.any) return;
  for (const o of P.sway) { const d = o.userData, r = d.rest, a = num(d.amp, 0.02), w = t * num(d.rate, 1) + num(d.ph, 0); if (Array.isArray(r)) { o.rotation.z = r[5] + (Math.sin(w) + Math.sin(w * 2.7 + 1) * 0.3) * a; o.rotation.x = r[3] + Math.sin(w * 0.77 + 2) * a * 0.7; } }
  for (const o of P.puff) {
    const d = o.userData, b = Array.isArray(d.base) ? d.base : [0, 0, 0], ph = num(d.ph, 0), c = frac(t * num(d.rate, 0.2) + ph), rise = num(d.rise, 1);
    const k = lerp(num(d.s0, 0.1), num(d.s1, 0.2), c) * Math.min(1, c * 5) * (c > 0.72 ? (1 - c) / 0.28 : 1);
    o.position.set(num(b[0], 0) + num(d.dx, 0) * c * c + Math.sin(t * 0.9 + ph * 19) * 0.04 * rise * c, num(b[1], 0) + rise * c, num(b[2], 0) + num(d.dz, 0) * c * c + Math.cos(t * 0.7 + ph * 13) * 0.04 * rise * c);
    o.scale.setScalar(Math.max(k, 1e-4)); o.rotation.set(t * 0.23 + ph * 9, t * 0.4 + ph * 30, 0);
  }
  for (const o of P.lamp) { const d = o.userData; o.rotation.y = num(d.ph, 0) + t * num(d.rate, 1); o.scale.setScalar(num(d.rest && d.rest[6], 1) * (1 + 0.05 * Math.sin(t * 3.1 + num(d.ph, 0)))); }
  for (const o of P.spin) { const d = o.userData; o.rotation.z = num(d.ph, 0) + t * num(d.rate, 0.5); }
  for (const o of P.flyer) animFlyer(o, t, P.sub.get(o));
  for (const o of P.animal) animAnimal(o, t, P.sub.get(o));
  for (const o of P.mote) {
    const d = o.userData, b = Array.isArray(d.base) ? d.base : [0, 1, 0], ph = num(d.ph, 0), w = t * num(d.rate, 1), r = num(d.r, 0.3);
    o.position.set(num(b[0], 0) + Math.sin(w * 0.5 + ph) * r + Math.sin(w * 1.3 + ph * 2.2) * r * 0.3, num(b[1], 1) + Math.sin(w * 0.37 + ph * 2.1) * r * 0.5, num(b[2], 0) + Math.cos(w * 0.43 + ph * 1.7) * r);
    const blink = Math.max(0, Math.sin(w * 1.6 + ph * 5)) ** 2;
    o.scale.setScalar(num(d.s, 0.05) * (0.12 + 0.88 * blink));
  }
  for (const o of P.flick) {
    const d = o.userData, r = d.rest, ph = num(d.ph, 0);
    if (!Array.isArray(r)) continue;
    o.scale.setScalar(num(r[6], 1) * (1 + num(d.amp, 0.2) * (Math.sin(t * 11 + ph) * 0.5 + Math.sin(t * 7.3 + ph * 2) * 0.5)));
    if (d.bob) { o.position.y = r[1] + Math.sin(t * 1.3 + ph) * d.bob; o.position.x = r[0] + Math.sin(t * 0.7 + ph * 2) * d.bob * 0.6; }
  }
  if (P.lava.length && matLava) matLava.color.setScalar(0.86 + 0.2 * Math.sin(t * 1.6) + 0.07 * Math.sin(t * 4.7 + 1));
}
