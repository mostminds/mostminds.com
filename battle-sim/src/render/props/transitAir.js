// Cable gondolas and hot-air balloons, sculpted for each faction (see props/transit.js for the contract).
//   buildGondola(look, sideColor) -> Object3D, origin at the cable, car floor at about y = -1.2
//   buildBalloon(look, sideColor) -> Object3D, origin at the basket floor, userData.fire = the flame mesh
// Everything is baked into a handful of vertex-coloured meshes: solid / metal / cloth (double-sided) / glow / owner
// (the owner mesh takes the side's colour from its material, so the geometry can be cached per faction).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PI = Math.PI, TAU = PI * 2, V3 = THREE.Vector3;
const ROPE = 0x3a3026, BONE = 0xe6dcc4, WICK = 0xb08a4e, SACK = 0xb8a888, CRATE = 0xa67c4c, CLAY = 0xb8683a, WHITE = 0xffffff, DARK = 0x1a1612;
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const C = (h) => new THREE.Color(h);
const sh = (c, k) => { const o = C(c).multiplyScalar(k); o.r = Math.min(1, o.r); o.g = Math.min(1, o.g); o.b = Math.min(1, o.b); return o.getHex(); };
const mix = (a, b, t) => C(a).lerp(C(b), t).getHex();
const _lin = new Map();
const rgb = (hex) => { let v = _lin.get(hex); if (!v) { const c = C(hex); v = [c.r, c.g, c.b]; _lin.set(hex, v); } return v; };

// ---- primitives -----------------------------------------------------------------------------
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rbox = (w, h, d, r = 0.03, s = 2) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, Math.min(w, h, d) * 0.49));
const cyl = (a, b, h, n = 10, open = false) => new THREE.CylinderGeometry(a, b, h, n, 1, open);
const ball = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
const cone = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n);
const torus = (R, r, a = 6, b = 20, arc = TAU) => new THREE.TorusGeometry(R, r, a, b, arc);
const gem = (r, h, n = 6) => new THREE.LatheGeometry([[0, -h * 0.4], [r, -h * 0.08], [r * 0.9, h * 0.2], [0, h * 0.6]].map((p) => new THREE.Vector2(p[0], p[1])), n);
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new V3(), _s = new V3(), _Y = new V3(0, 1, 0);
/** a transform: position, euler rotation, and either one uniform scale or three */
function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy, sz) {
  if (sy === undefined) { sy = sx; sz = sx; }
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
}
/** a transform that stands a +Y object at p pointing along d */
function TA(p, d, sx = 1, sy, sz) {
  if (sy === undefined) { sy = sx; sz = sx; }
  const dir = new V3(d[0], d[1], d[2]).normalize();
  return new THREE.Matrix4().compose(_p.set(p[0], p[1], p[2]), _q.setFromUnitVectors(_Y, dir), _s.set(sx, sy, sz));
}

/** a parametric sheet, smooth-shaded, coloured per quad (so stripes, panels and patches come out crisp) */
function surf(nu, nv, pos, col, o = {}) {
  const cu = !!o.closeU, W = cu ? nu : nu + 1, H = nv + 1, P = new Float32Array(W * H * 3), out = [0, 0, 0];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { pos(i / nu, j / nv, out, i, j); P[(j * W + i) * 3] = out[0]; P[(j * W + i) * 3 + 1] = out[1]; P[(j * W + i) * 3 + 2] = out[2]; }
  const idx = new Uint32Array(nu * nv * 6); let t = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * W + i, b = j * W + (cu ? (i + 1) % W : i + 1), c = a + W, d = b + W;
    if (o.flip) { idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c; } else { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
  }
  const N = new Float32Array(W * H * 3);
  for (let k = 0; k < idx.length; k += 3) {
    const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
  }
  for (let k = 0; k < N.length; k += 3) { const l = Math.hypot(N[k], N[k + 1], N[k + 2]) || 1; N[k] /= l; N[k + 1] /= l; N[k + 2] /= l; }
  const n = idx.length, p = new Float32Array(n * 3), nn = new Float32Array(n * 3), cc = new Float32Array(n * 3), fn = typeof col === 'function', Ar = Array.isArray(col);
  for (let k = 0; k < n; k++) {
    const v = idx[k] * 3, q = Math.floor(k / 6), i = q % nu, j = Math.floor(q / nu);
    p[k * 3] = P[v]; p[k * 3 + 1] = P[v + 1]; p[k * 3 + 2] = P[v + 2]; nn[k * 3] = N[v]; nn[k * 3 + 1] = N[v + 1]; nn[k * 3 + 2] = N[v + 2];
    const c = rgb(fn ? col((i + 0.5) / nu, (j + 0.5) / nv, i, j) : Ar ? col[Math.min(col.length - 1, Math.floor(((j + 0.5) / nv) * col.length))] : col ?? WHITE);
    cc[k * 3] = c[0]; cc[k * 3 + 1] = c[1]; cc[k * 3 + 2] = c[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  return g;
}
const sup = (c, s, ex) => (ex === 2 ? 1 : Math.pow(Math.pow(Math.abs(c), ex) + Math.pow(Math.abs(s), ex), -1 / ex));
/** a turned (lathed) solid from [radius, y] points given bottom to top; cols is one colour, a list up the rows, or a function.
 *  o.ex squares the section (superellipse), o.sx/o.sz stretch it, o.up lifts the corners, o.spl resamples the points as a spline */
function rev(pts, n = 14, cols = WHITE, o = {}) {
  let P = pts;
  if (o.spl) { const cv = new THREE.SplineCurve(pts.map((q) => new THREE.Vector2(q[0], q[1]))); P = []; for (let i = 0; i <= o.spl; i++) { const q = cv.getPoint(i / o.spl); P.push([Math.max(0, q.x), q.y]); } }
  const ex = o.ex || 2, sx = o.sx ?? 1, sz = o.sz ?? 1, up = o.up || 0, rot = o.rot || 0;
  return surf(n, P.length - 1, (u, v, out, i, j) => {
    const a = u * TAU + rot, c = Math.cos(a), s = Math.sin(a), f = sup(c, s, ex), r = P[j][0];
    out[0] = r * f * c * sx; out[1] = P[j][1] + up * (f - 1) * 2.4 * r; out[2] = r * f * s * sz;
  }, cols, { closeU: true });
}
/** a tube swept along a path of [x,y,z] points; r may be a function of 0..1 along it (so horns and tentacles taper) */
function sweep(pts, r, sides = 5, segs, col, o = {}) {
  const cv = new THREE.CatmullRomCurve3(pts.map((q) => new V3(q[0], q[1], q[2])), !!o.closed, 'catmullrom', 0.5);
  segs ??= pts.length * 2;
  let ref = o.ref ? new V3(...o.ref) : null;
  if (!ref) {
    const a = cv.getTangent(0), b = cv.getTangent(o.closed ? 0.25 : 0.6); ref = new V3().crossVectors(a, b);
    if (ref.length() < 0.08) { const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z); ref.set(ax <= ay && ax <= az ? 1 : 0, ay < ax && ay <= az ? 1 : 0, az < ax && az < ay ? 1 : 0); }
    ref.normalize();
  }
  const fr = []; let prev = null;
  for (let j = 0; j <= segs; j++) {
    const v = j / segs, p = cv.getPoint(v), t = cv.getTangent(v).normalize(), nm = new V3().crossVectors(ref, t);
    if (nm.length() < 0.05 && prev) nm.copy(prev); nm.normalize(); prev = nm;
    fr.push([p, nm, new V3().crossVectors(t, nm)]);
  }
  return surf(sides, segs, (u, v, out, i, j) => {
    const f = fr[j], rr = typeof r === 'function' ? r(v) : r, a = u * TAU, c = Math.cos(a) * rr, s = Math.sin(a) * rr;
    out[0] = f[0].x + f[1].x * c + f[2].x * s; out[1] = f[0].y + f[1].y * c + f[2].y * s; out[2] = f[0].z + f[1].z * c + f[2].z * s;
  }, col, { closeU: true, flip: true });
}
/** a leaf / feather / fin: grows along +y from the origin, faces +z */
function leaf(len, w, bend = 0.2, col = WHITE, o = {}) {
  return surf(o.nu || 4, o.nv || 8, (u, v, out) => {
    const ww = w * Math.pow(Math.sin(PI * Math.min(1, v * (o.tip ?? 0.93) + (o.base ?? 0.05))), o.pw || 0.8), x = (u - 0.5) * ww;
    out[0] = x; out[1] = v * len; out[2] = bend * len * v * v + (o.cup || 0) * Math.abs(u - 0.5) * 2 * ww;
  }, col);
}
/** a gabled roof block: ridge along x */
function gable(w, h, d) {
  const A = [-w / 2, 0, -d / 2], B = [w / 2, 0, -d / 2], Cc = [w / 2, 0, d / 2], D = [-w / 2, 0, d / 2], E = [-w / 2, h, 0], F = [w / 2, h, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([D, Cc, F, D, F, E, B, A, E, B, E, F, A, D, E, Cc, B, F, A, B, Cc, A, Cc, D].flat()), 3));
  g.computeVertexNormals(); return g;
}
let _shield;
const shieldGeo = () => {
  if (!_shield) { const s = new THREE.Shape(); s.moveTo(-0.11, 0.12); s.lineTo(0.11, 0.12); s.lineTo(0.11, 0); s.quadraticCurveTo(0.1, -0.12, 0, -0.17); s.quadraticCurveTo(-0.1, -0.12, -0.11, 0); s.closePath(); _shield = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 6 }); }
  return _shield;
};

// ---- the kit: collects baked geometry into a few bags ------------------------------------------
class Bag {
  constructor() { this.p = []; this.n = []; this.c = []; }
  add(geo, col, mat, flat) {
    const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, N = g.attributes.normal, CA = g.attributes.color, n = P.count;
    const v = new V3(), nv = new V3(), nm = new THREE.Matrix3().getNormalMatrix(mat), mir = mat.determinant() < 0, p = this.p, nn = this.n, cc = this.c, base = p.length;
    const fn = typeof col === 'function', k0 = col != null && !fn ? rgb(col) : null;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i);
      const k = k0 || (fn ? rgb(col(v.x, v.y, v.z)) : CA ? [CA.getX(i), CA.getY(i), CA.getZ(i)] : rgb(WHITE));
      v.applyMatrix4(mat); p.push(v.x, v.y, v.z);
      if (N) nv.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); else nv.set(0, 1, 0);
      nn.push(nv.x, nv.y, nv.z); cc.push(k[0], k[1], k[2]);
    }
    if (mir) for (let i = base; i < p.length; i += 9) for (const arr of [p, nn, cc]) for (let q = 0; q < 3; q++) { const t = arr[i + 3 + q]; arr[i + 3 + q] = arr[i + 6 + q]; arr[i + 6 + q] = t; }
    if (flat || !N) for (let i = base; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let q = 0; q < 9; q += 3) { nn[i + q] = nx; nn[i + q + 1] = ny; nn[i + q + 2] = nz; }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); return g;
  }
}
const _I = new THREE.Matrix4();
class Kit {
  constructor() { this.bags = {}; this.M = new THREE.Matrix4(); this.st = []; }
  add(bag, geo, col, mat, flat) { (this.bags[bag] ??= new Bag()).add(geo, col, new THREE.Matrix4().multiplyMatrices(this.M, mat || _I), flat); return this; }
  push(mat) { this.st.push(this.M.clone()); this.M.multiply(mat); } pop() { this.M = this.st.pop(); }
  s(geo, col, mat, flat) { return this.add('solid', geo, col, mat, flat); }
  m(geo, col, mat, flat) { return this.add('metal', geo, col, mat, flat); }
  c(geo, col, mat, flat) { return this.add('cloth', geo, col, mat, flat); }
  g(geo, col, mat, flat) { return this.add('glow', geo, col, mat, flat); }
  o(geo, col, mat, flat) { return this.add('owner', geo, col, mat, flat); }
  /** a straight rod between two points */
  rod(bag, col, a, b, r = 0.012, sides = 5) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1e-4;
    return this.add(bag, cyl(r, r, 1, sides, true), col, TA([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], d, 1, l, 1));
  }
  /** a seam tape up an envelope */
  tape(env, u, v0, v1, r, col, bag = 'solid', n = 14, sides = 3) { const pts = []; for (let i = 0; i <= n; i++) pts.push(env.at(u, v0 + ((v1 - v0) * i) / n, r * 0.5)); return this.add(bag, sweep(pts, r, sides, n, col), null); }
  /** a hoop round an envelope */
  hoop(env, v, r, col, bag = 'metal', sides = 5) { const pts = [], n = env.gores * 2; for (let i = 0; i < n; i++) pts.push(env.at(i / n, v, r * 0.4)); return this.add(bag, sweep(pts, r, sides, n * 2, col, { closed: true, ref: [0, 1, 0] }), null); }
}

// ---- materials and assembly ---------------------------------------------------------------------
let MATS = null; const sideMats = new Map();
function materials() {
  return MATS ??= {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
  };
}
function sideMat(side) { if (!sideMats.has(side)) sideMats.set(side, new THREE.MeshStandardMaterial({ color: side, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); return sideMats.get(side); }
const cache = new Map();
function assemble(key, side, make) {
  let c = cache.get(key);
  if (!c) { const k = new Kit(), extra = make(k) || {}; c = { geos: {}, extra }; for (const [name, bag] of Object.entries(k.bags)) if (bag.p.length) c.geos[name] = bag.geometry(); cache.set(key, c); }
  const g = new THREE.Group(), mats = materials();
  for (const [name, geo] of Object.entries(c.geos)) { const m = new THREE.Mesh(geo, name === 'owner' ? sideMat(side) : mats[name]); m.castShadow = name !== 'glow'; m.receiveShadow = false; m.name = name; g.add(m); }
  return { g, extra: c.extra };
}

// ---- envelopes ----------------------------------------------------------------------------------
const spl = (pts) => { const cv = new THREE.SplineCurve(pts.map((q) => new THREE.Vector2(q[0], q[1]))); return (t) => { const q = cv.getPoint(t); return [Math.max(0, q.x), q.y]; }; };
const lin = (pts) => (t) => { const f = Math.min(0.99999, Math.max(0, t)) * (pts.length - 1), i = Math.floor(f), k = f - i; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; };
const PROF = {
  globe: spl([[0.45, -1.85], [0.62, -1.6], [1.05, -1.15], [1.5, -0.55], [1.72, 0.15], [1.6, 0.85], [1.2, 1.45], [0.62, 1.83], [0.25, 1.94], [0, 1.96]]),
  lantern: spl([[0.6, -1.62], [1.0, -1.55], [1.36, -1.2], [1.47, -0.6], [1.5, 0], [1.47, 0.6], [1.36, 1.2], [1.0, 1.55], [0.6, 1.62]]),
  tear: spl([[0.36, -1.9], [0.6, -1.55], [1.1, -0.95], [1.46, -0.25], [1.5, 0.4], [1.24, 1.05], [0.8, 1.55], [0.36, 1.9], [0.1, 2.1], [0, 2.18]]),
  onion: spl([[0.42, -1.85], [0.7, -1.6], [1.3, -1.15], [1.7, -0.5], [1.72, 0.15], [1.35, 0.75], [0.7, 1.15], [0.3, 1.45], [0.12, 1.8], [0, 2.05]]),
  gourd: spl([[0.42, -1.85], [0.8, -1.62], [1.25, -1.2], [1.32, -0.75], [1.05, -0.35], [0.95, -0.1], [1.25, 0.25], [1.6, 0.75], [1.55, 1.3], [1.0, 1.75], [0.35, 1.95], [0, 1.98]]),
  barrel: spl([[0.5, -1.72], [1.0, -1.62], [1.5, -1.25], [1.76, -0.55], [1.8, 0.05], [1.76, 0.65], [1.5, 1.25], [1.0, 1.6], [0.4, 1.72], [0, 1.74]]),
  oblate: spl([[0.45, -1.75], [0.8, -1.5], [1.5, -0.95], [1.9, -0.2], [1.86, 0.45], [1.42, 1.05], [0.72, 1.42], [0.25, 1.53], [0, 1.55]]),
  bulb: spl([[0.72, -1.95], [0.72, -1.65], [0.82, -1.3], [1.3, -0.8], [1.7, -0.1], [1.76, 0.6], [1.42, 1.3], [0.76, 1.8], [0.25, 1.94], [0, 1.96]]),
  pod: spl([[0.16, -1.9], [0.6, -1.45], [1.2, -0.75], [1.52, 0], [1.36, 0.75], [0.9, 1.4], [0.42, 1.85], [0.12, 2.1], [0, 2.2]]),
  spindle: lin([[0.3, -1.9], [0.75, -1.35], [1.45, -0.45], [1.75, 0.1], [1.4, 0.8], [0.8, 1.45], [0.3, 1.95], [0, 2.3]]),
  bell: spl([[0.95, -1.7], [1.45, -1.62], [1.56, -1.0], [1.6, 0], [1.5, 0.8], [1.15, 1.45], [0.6, 1.85], [0.2, 1.98], [0, 2.0]]),
  zig: lin([[0.5, -1.85], [1.3, -1.6], [1.3, -0.85], [1.04, -0.8], [1.04, -0.05], [0.78, 0], [0.78, 0.75], [0.52, 0.8], [0.52, 1.5], [0.2, 1.62], [0, 1.62]]),
  jar: spl([[0.45, -1.85], [0.9, -1.7], [1.32, -1.2], [1.62, -0.35], [1.66, 0.35], [1.34, 0.95], [0.9, 1.2], [0.82, 1.35], [1.02, 1.5], [0.95, 1.8], [0.5, 2.05], [0, 2.12]]),
  stupa: lin([[0.45, -1.85], [1.0, -1.55], [1.5, -1.05], [1.7, -0.4], [1.68, 0.15], [1.4, 0.65], [0.95, 0.95], [0.62, 1.05], [0.66, 1.2], [0.48, 1.3], [0.5, 1.45], [0.34, 1.55], [0.36, 1.7], [0.2, 1.8], [0.08, 2.1], [0, 2.2]]),
  round: spl([[0.62, -1.6], [1.1, -1.32], [1.5, -0.76], [1.66, 0], [1.5, 0.76], [1.1, 1.32], [0.62, 1.6]]),
  dome: spl([[0.45, -1.85], [0.8, -1.55], [1.4, -0.95], [1.72, -0.15], [1.62, 0.55], [1.18, 1.1], [0.62, 1.45], [0.26, 1.72], [0.08, 1.98], [0, 2.1]]),
  yurt: lin([[0.5, -1.8], [1.35, -1.6], [1.68, -1.25], [1.74, -0.5], [1.74, 0.25], [1.66, 0.5], [1.2, 0.9], [0.7, 1.3], [0.38, 1.52], [0.38, 1.66], [0, 1.68]]),
  jelly: spl([[1.5, -1.05], [1.72, -0.75], [1.76, -0.15], [1.56, 0.65], [1.06, 1.3], [0.5, 1.68], [0.18, 1.78], [0, 1.8]]),
  heart: spl([[0.3, -1.95], [0.6, -1.55], [1.2, -0.85], [1.66, -0.05], [1.72, 0.65], [1.4, 1.3], [0.85, 1.68], [0.4, 1.76], [0.12, 1.7], [0, 1.66]]),
};
function mkEnv(o) {
  const { prof, gores = 12, per = 6, rows = 40, bulge = 0.05, sx = 1, sz = 1, twist = 0, ex = 2, ripple = 0, wob = null, cx = 0, cy = 4.1, cz = 0, s = 1 } = o;
  const env = {
    gores, per, rows, nu: gores * per, cx, cy, cz,
    at(u, v, lift = 0, out = [0, 0, 0]) {
      let [r, y] = prof(v);
      if (lift) { const a = prof(Math.max(0, v - 0.012)), b = prof(Math.min(1, v + 0.012)), dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1; r += (lift * dy) / l / s; y -= (lift * dr) / l / s; }
      let m = 1 - bulge * (1 - Math.abs(Math.sin(PI * u * gores)));
      if (ripple) m *= 1 + 0.014 * Math.abs(Math.sin(PI * v * ripple));
      if (wob) m *= wob(u, v);
      const th = TAU * (u + twist * v), c = Math.cos(th), sn = Math.sin(th), f = sup(c, sn, ex);
      out[0] = cx + r * m * f * c * sx * s; out[1] = cy + y * s; out[2] = cz + r * m * f * sn * sz * s; return out;
    },
    nrm(u, v) { const a = env.at(u, v), b = env.at(u, v, 0.5); return [(b[0] - a[0]) * 2, (b[1] - a[1]) * 2, (b[2] - a[2]) * 2]; },
    geo(col) { return surf(env.nu, rows, (u, v, out) => env.at(u, v, 0, out), col, { closeU: true }); },
    strip(v0, v1, lift, col, n = 3) { return surf(env.nu, n, (u, v, out) => env.at(u, v0 + (v1 - v0) * v, lift, out), col, { closeU: true }); },
    top() { return env.at(0, 1)[1]; },
  };
  return env;
}
/** a round patch painted on an envelope (a sun disc, an eye, a badge) */
const disc = (env, uc, vc, ru, rv, col, n = 20, lift = 0.03) => surf(n, 3, (u, v, out) => env.at(uc + ru * v * Math.cos(u * TAU), vc + rv * v * Math.sin(u * TAU), lift, out), col, { closeU: true });
/** things standing off an envelope along its normal, n of them round height v */
function studs(k, env, v, n, bag, geo, col, o = {}) {
  for (let i = 0; i < n; i++) { const u = (i + (o.off ?? 0)) / n, p = env.at(u, v, o.lift ?? 0), d = env.nrm(u, v); if (o.tilt) d[1] += o.tilt; k.add(bag, geo, typeof col === 'function' ? col(i) : col, TA(p, d, o.s ?? 1), o.flat); }
}
/** a dagged valance hanging from height v of an envelope */
function valance(k, env, v, len, col, o = {}) {
  const n = o.n ?? env.gores, bag = o.bag || 'cloth';
  k.add(bag, surf(n * 4, 2, (u, t, out, i) => { env.at(u, v, o.lift ?? 0.025, out); const dag = t === 1 ? (o.dag ?? 0.5) * len * Math.abs(Math.sin(PI * u * n)) : 0; out[1] -= t * len - dag; const k2 = 1 - (o.pull ?? 0) * t; out[0] = env.cx + (out[0] - env.cx) * k2; out[2] = env.cz + (out[2] - env.cz) * k2; }, typeof col === 'function' ? col : (u, t, i) => (Math.floor(i / 4) & 1 ? col[0] : col[1])));
}
function finial(k, y, col, s = 1, bag = 'metal') { k.add(bag, rev([[0, 0], [0.15, 0], [0.17, 0.03], [0.08, 0.07], [0.05, 0.12], [0.1, 0.17], [0.1, 0.22], [0.03, 0.28], [0.015, 0.42], [0, 0.44]], 12, col), null, T(0, y - 0.02, 0, 0, 0, 0, s)); }

// ---- small props --------------------------------------------------------------------------------
function cargo(k, kind, x, y, z, s = 1, ry = 0, tint) {
  k.push(T(x, y, z, 0, ry, 0, s));
  switch (kind) {
    case 'crate': { const c = tint ?? CRATE, d = sh(c, 0.68); k.s(box(0.2, 0.2, 0.2), c, T(0, 0.1, 0)); for (const yy of [0.04, 0.16]) k.s(box(0.214, 0.03, 0.214), d, T(0, yy, 0)); k.s(box(0.03, 0.202, 0.216), d, T(0, 0.1, 0)); k.s(box(0.216, 0.202, 0.03), d, T(0, 0.1, 0)); break; }
    case 'sack': { const c = tint ?? SACK; k.s(ball(0.11, 10, 7), c, T(0, 0.085, 0, 0, 0, 0, 1.05, 0.78, 0.9)); k.s(cone(0.045, 0.08, 7), sh(c, 0.82), T(0.015, 0.19, 0, 0, 0, -0.25)); k.s(torus(0.03, 0.008, 4, 8), ROPE, T(0.01, 0.165, 0, PI / 2)); break; }
    case 'jar': { const c = tint ?? CLAY, b = sh(c, 0.6), l = sh(c, 1.25); k.s(rev([[0, 0], [0.05, 0], [0.085, 0.05], [0.1, 0.11], [0.09, 0.17], [0.05, 0.215], [0.04, 0.245], [0.058, 0.262], [0.05, 0.275], [0, 0.275]], 12, [b, c, l, c, b, c, c, b, b]), null); break; }
    case 'barrel': { const c = tint ?? 0x8a623a, h = 0x3a3a40; k.s(rev([[0, 0], [0.075, 0], [0.088, 0.04], [0.095, 0.075], [0.095, 0.145], [0.088, 0.18], [0.075, 0.22], [0, 0.22]], 12, [sh(c, 0.7), h, c, sh(c, 1.1), c, h, sh(c, 0.7)]), null); break; }
    case 'bale': { const c = tint ?? 0xc8b070; k.s(rbox(0.26, 0.16, 0.18, 0.04, 2), c, T(0, 0.08, 0)); for (const xx of [-0.07, 0.07]) k.s(box(0.02, 0.168, 0.188), ROPE, T(xx, 0.08, 0)); break; }
    case 'chest': { const c = tint ?? 0x6a4428, t = 0xc8a040; k.s(box(0.26, 0.12, 0.16), c, T(0, 0.06, 0)); k.s(cyl(0.08, 0.08, 0.26, 10), c, T(0, 0.12, 0, 0, 0, PI / 2, 1, 1, 1)); for (const xx of [-0.09, 0.09]) k.m(box(0.03, 0.125, 0.166), t, T(xx, 0.062, 0)); k.m(box(0.05, 0.05, 0.02), t, T(0, 0.11, 0.085)); break; }
    case 'bundle': { const c = tint ?? 0x8a6a4a; k.s(cyl(0.07, 0.07, 0.3, 8), c, T(0, 0.07, 0, 0, 0, PI / 2)); for (const xx of [-0.08, 0.08]) k.s(torus(0.072, 0.01, 4, 10), ROPE, T(xx, 0.07, 0, 0, PI / 2)); break; }
    default: break;
  }
  k.pop();
}
function sandbag(k, x, y, z, col = 0xb09a6a, len = 0.16, rope = ROPE) {
  k.rod('solid', rope, [x, y, z], [x, y - len, z], 0.008, 4);
  k.s(rev([[0, -0.2], [0.05, -0.19], [0.075, -0.14], [0.07, -0.08], [0.03, -0.03], [0.022, -0.01], [0.04, 0.005], [0, 0.005]], 9, [sh(col, 0.8), col, col, sh(col, 1.1), ROPE, sh(col, 0.9), col]), null, T(x, y - len, z));
}
/** a cargo net with a bulging load in it, hanging from (x,y,z) */
function netbag(k, x, y, z, s = 1, col = SACK, rope = ROPE) {
  k.push(T(x, y, z, 0, 0, 0, s));
  k.s(ball(0.17, 12, 9), (px, py) => (py < -0.02 ? sh(col, 0.85) : col), T(0, -0.28, 0, 0, 0, 0, 1, 1.1, 1));
  for (let i = 0; i < 4; i++) k.s(torus(0.176, 0.008, 4, 16), rope, T(0, -0.28, 0, 0, (i * PI) / 4, 0, 1, 1.1, 1));
  for (const yy of [-0.36, -0.24]) k.s(torus(Math.sqrt(0.031 - ((yy + 0.28) / 1.1) ** 2), 0.008, 4, 16), rope, T(0, yy, 0, PI / 2));
  k.s(cone(0.05, 0.13, 6), rope, T(0, -0.04, 0));
  k.pop();
}
function pennant(k, bag, col, x, y, z, ry, len = 0.6, h = 0.22, tail = 0) {
  k.add(bag, surf(8, 2, (u, v, out, i, j) => {
    const hh = tail === 0 ? h * (1 - u * 0.94) : h;
    out[0] = (tail === 1 && j === 1 ? u * (1 - 0.3 * u * u) : u) * len; out[1] = (v - 0.5) * hh - 0.1 * u * u * len; out[2] = 0.06 * Math.sin(u * 7) * len * u;
  }, typeof col === 'function' ? col : (u, v, i) => (i & 1 ? col : sh(col, 0.86))), null, T(x, y, z, 0, ry, 0));
}
/** a staff with a pennant in the side's colour */
function flagstaff(k, x, y, z, hgt, ry, o = {}) {
  k.rod(o.bag || 'solid', o.col ?? 0x5a4026, [x, y, z], [x + (o.lean ?? 0), y + hgt, z], 0.014, 5);
  if (o.knob !== 0) k.m(ball(0.03, 8, 6), o.knob ?? 0xc8a040, T(x + (o.lean ?? 0), y + hgt + 0.02, z));
  pennant(k, 'owner', WHITE, x + (o.lean ?? 0), y + hgt - (o.h ?? 0.2) / 2 - 0.02, z, ry, o.len ?? 0.55, o.h ?? 0.2, o.tail ?? 1);
}
function shield(k, x, y, z, ry, s = 1, face = null, rim = 0xc8a040) {
  k.push(T(x, y, z, 0, ry, 0, s));
  k.m(shieldGeo(), rim, T(0, 0, -0.012, 0, 0, 0, 1.12, 1.1, 1)); k.add(face == null ? 'owner' : 'solid', shieldGeo(), face ?? WHITE, T(0, 0, 0)); k.m(ball(0.03, 8, 6), rim, T(0, 0, 0.025));
  k.pop();
}
function roundShield(k, x, y, z, ry, r = 0.13, face = null, rim = 0x4a4a52, rx = 0) {
  k.push(T(x, y, z, rx, ry, 0));
  k.add(face == null ? 'owner' : 'solid', cyl(r, r, 0.02, 14), face ?? WHITE, T(0, 0, 0, PI / 2)); k.m(torus(r, 0.014, 5, 16), rim, T(0, 0, 0)); k.m(ball(r * 0.3, 8, 6), rim, T(0, 0, 0.015, 0, 0, 0, 1, 1, 0.6));
  k.pop();
}
function skull(k, m, bone = BONE, eye = null, horns = 0) {
  k.push(m);
  k.s(ball(0.5, 12, 9), bone, T(0, 0, 0, 0, 0, 0, 0.88, 0.95, 1)); k.s(rbox(0.5, 0.3, 0.42, 0.08, 2), bone, T(0, -0.4, 0.2)); k.s(box(0.42, 0.08, 0.3), sh(bone, 0.5), T(0, -0.5, 0.26));
  for (const x of [-0.18, 0.18]) k.add(eye ? 'glow' : 'solid', ball(0.13, 8, 6), eye ?? DARK, T(x, -0.02, 0.4, 0, 0, 0, 1, 1.1, 0.7));
  k.s(cone(0.06, 0.16, 4), DARK, T(0, -0.2, 0.47, 0.3, 0, 0));
  for (let i = 0; i < 5; i++) k.s(box(0.06, 0.1, 0.04), sh(bone, 1.08), T(-0.16 + i * 0.08, -0.52, 0.41));
  if (horns) for (const sx of [-1, 1]) k.s(sweep([[sx * 0.3, 0.2, 0], [sx * 0.62, 0.3, 0.02], [sx * 0.85, 0.55, 0.1], [sx * 0.8, 0.9, 0.2]], (v) => 0.11 * (1 - v * 0.85), 6, 8, sh(bone, 0.85)), null);
  k.pop();
}
/** a membrane wing (bat, drake): a scalloped fan in the local xy plane with finger bones */
function wing(k, m, R, spread, fingers, mem, bone) {
  k.push(m);
  k.c(surf(fingers * 5, 3, (u, v, out) => { const a = u * spread, r = R * v * (1 - 0.26 * Math.abs(Math.sin(PI * u * fingers)) * v) * (0.72 + 0.28 * u); out[0] = r * Math.cos(a); out[1] = r * Math.sin(a); out[2] = 0.05 * R * Math.sin(PI * u * fingers) * v; }, (u, v, i, j) => (j === 2 ? sh(mem, 0.8) : mem)));
  for (let i = 0; i <= fingers; i++) { const a = (i / fingers) * spread, r = R * (0.72 + (0.28 * i) / fingers); k.add('solid', sweep([[0, 0, 0], [r * 0.5 * Math.cos(a), r * 0.5 * Math.sin(a), 0.01], [r * Math.cos(a), r * Math.sin(a), 0]], (v) => 0.03 * R * (1 - v * 0.7) + 0.006, 4, 4, bone), null); }
  k.pop();
}
function eyeball(k, p, d, r, iris, white = 0xe8e0d0) {
  const n = new V3(...d).normalize();
  k.s(ball(r, 10, 8), white, T(p[0], p[1], p[2])); k.g(ball(r * 0.55, 8, 6), iris, T(p[0] + n.x * r * 0.58, p[1] + n.y * r * 0.58, p[2] + n.z * r * 0.58)); k.s(ball(r * 0.28, 6, 5), DARK, T(p[0] + n.x * r * 0.98, p[1] + n.y * r * 0.98, p[2] + n.z * r * 0.98));
}
function lantern(k, x, y, z, glow, frame = 0x2a2a2e, s = 1) {
  k.push(T(x, y, z, 0, 0, 0, s));
  k.g(cyl(0.035, 0.03, 0.08, 6), glow, T(0, -0.07, 0)); k.m(cone(0.055, 0.04, 6), frame, T(0, -0.01, 0)); k.m(cyl(0.04, 0.04, 0.012, 6), frame, T(0, -0.115, 0)); k.m(torus(0.02, 0.005, 4, 8), frame, T(0, 0.025, 0));
  k.pop();
}
function tassel(k, x, y, z, col, len = 0.3, cord = 0xc8a040) { k.rod('solid', cord, [x, y, z], [x, y - len * 0.5, z], 0.008, 4); k.s(ball(0.03, 6, 5), cord, T(x, y - len * 0.5, z)); k.s(cone(0.04, len * 0.55, 7), col, T(x, y - len * 0.78, z)); }

// ---- baskets --------------------------------------------------------------------------------------
/** a woven basket: outer weave, darker lining, floor, bound rim and foot */
function wicker(k, o = {}) {
  const { w = 1, d = 1, h = 0.5, ex = 5, taper = 0.88, c1 = WICK, c2 = 0x8a6a3a, y = 0, nu = 56, nv = 10, rim = 0x6a4a2a, amp = 0.02, flare = 0 } = o;
  const P = (u, v, k2, out) => { const a = u * TAU, c = Math.cos(a), s = Math.sin(a), f = sup(c, s, ex) * (taper + (1 - taper) * v + flare * v * v) * k2; out[0] = (c * f * w) / 2; out[1] = y + v * h; out[2] = (s * f * d) / 2; };
  k.s(surf(nu, nv, (u, v, out, i, j) => { P(u, v, 1 + amp * Math.sin((i * PI) / 2 + j * PI), out); }, (u, v, i, j) => sh(((i >> 1) + j) & 1 ? c1 : c2, 0.9 + 0.2 * rnd(i * 13 + j * 7))));
  k.s(surf(nu / 2, 3, (u, v, out) => P(u, v, 1 - 0.09 / Math.min(w, d), out), sh(c2, 0.55), { flip: true }));
  for (const fl of [true, false]) k.s(surf(nu / 2, 1, (u, v, out) => { P(u, 0, v * 0.97, out); out[1] = y + (fl ? 0.03 : 0); }, sh(c2, fl ? 0.7 : 0.5), { flip: fl }));
  const ring = (v, r, col) => { const pts = []; for (let i = 0; i < 28; i++) { const q = [0, 0, 0]; P(i / 28, v, 1 - (v > 0.5 ? 0.02 : 0), q); pts.push(q); } k.s(sweep(pts, r, 5, 44, col, { closed: true, ref: [0, 1, 0] }), null); };
  ring(1, 0.036, rim); ring(0.03, 0.03, sh(rim, 0.8));
  return P;
}
/** an open-topped tub of four walls and a floor (planked, plated, lacquered...) */
function tub(k, o = {}) {
  const { w = 1, d = 1, h = 0.5, th = 0.05, col = 0x7a5a36, bag = 'solid', y = 0, r = 0.02, rim = null, rimBag = 'metal', planks = 0, floor = null } = o;
  k.add(bag, rbox(w, 0.05, d, r, 1), floor ?? sh(col, 0.7), T(0, y + 0.025, 0));
  const wall = (len, x, z, ry) => {
    if (planks) for (let i = 0; i < planks; i++) { const pw = len / planks; k.add(bag, rbox(pw * 0.94, h, th, 0.012, 1), sh(col, 0.85 + 0.3 * rnd(i * 3.1 + x * 7 + z * 5)), T(x + Math.cos(ry) * (-len / 2 + pw * (i + 0.5)), y + h / 2, z - Math.sin(ry) * (-len / 2 + pw * (i + 0.5)), 0, ry, 0)); }
    else k.add(bag, rbox(len, h, th, r, 1), col, T(x, y + h / 2, z, 0, ry, 0));
  };
  wall(w, 0, d / 2 - th / 2, 0); wall(w, 0, -d / 2 + th / 2, 0); wall(d - th * 2, w / 2 - th / 2, 0, PI / 2); wall(d - th * 2, -w / 2 + th / 2, 0, PI / 2);
  if (rim != null) { for (const z of [-1, 1]) k.add(rimBag, rbox(w + 0.04, 0.05, th + 0.04, 0.015, 1), rim, T(0, y + h, z * (d / 2 - th / 2))); for (const x of [-1, 1]) k.add(rimBag, rbox(th + 0.04, 0.05, d + 0.04, 0.015, 1), rim, T(x * (w / 2 - th / 2), y + h, 0)); }
}
/** an open boat hull: bow toward +x */
function hull(k, o = {}) {
  const { len = 1.3, wid = 0.8, h = 0.5, col = 0x6a4a2e, y = 0, strakes = 6, bag = 'solid', sheer = 0.12, blunt = 2.2, stern = 0.75 } = o;
  const P = (u, v, k2, out) => { const x = u * 2 - 1, wf = Math.pow(1 - Math.pow(Math.abs(x), blunt), 0.6) * (x < 0 ? 1 : 1) * (x < 0 ? stern + (1 - stern) * (1 + x) : 1) + (x < -0.98 ? 0 : 0), a = (v - 0.5) * PI; out[0] = (x * len) / 2; out[1] = y + h * (1 - Math.cos(a) * 1) * 0 + h - h * Math.cos(a) * k2 + sheer * x * x * Math.abs(Math.sin(a)); out[2] = (Math.sin(a) * wid * wf * k2) / 2; };
  k.add(bag, surf(20, strakes * 2, (u, v, out) => P(u, v, 1, out), (u, v, i, j) => sh(col, (j >> 1) & 1 ? 1.0 : 0.82)));
  k.add(bag, surf(20, strakes, (u, v, out) => P(u, v, 0.93, out), sh(col, 0.55), { flip: true }));
  for (const sv of [0, 1]) { const pts = []; for (let i = 0; i <= 12; i++) { const q = [0, 0, 0]; P(i / 12, sv, 1, q); pts.push(q); } k.add(bag, sweep(pts, 0.03, 5, 24, o.rail ?? sh(col, 0.6)), null); }
  k.add(bag, rbox(len * 0.56, 0.03, wid * 0.42, 0.01, 1), sh(col, 0.7), T(0, y + 0.075, 0));
  return P;
}

// ---- balloon rigging ----------------------------------------------------------------------------
function rig(k, L, env, o = {}) {
  const rope = o.rope ?? ROPE, n = o.n ?? 8, ry = o.ringY ?? 1.38, rr = o.ringR ?? 0.5, vr = o.vr ?? 0.2, rb = o.bag ?? 'solid', rad = o.r ?? 0.011;
  if (o.ring !== false) k.add(o.ringBag ?? 'metal', torus(rr, o.ringT ?? 0.03, 6, 24), o.ringCol ?? L.metal, T(0, ry, 0, PI / 2));
  for (let i = 0; i < n; i++) { const u = (i + (o.off ?? 0)) / n, a = u * TAU, p = env.at(u, vr, 0.01); k.rod(rb, rope, [Math.cos(a) * rr, ry, Math.sin(a) * rr], p, rad, 4); }
  for (const [x, z] of o.posts ?? [[-0.47, -0.47], [0.47, -0.47], [-0.47, 0.47], [0.47, 0.47]]) { const a = Math.atan2(z, x); k.rod(o.postBag ?? rb, o.postCol ?? rope, [x, o.top ?? 0.5, z], [Math.cos(a) * rr, ry, Math.sin(a) * rr], o.postR ?? 0.016, 5); }
  const b = o.burner ?? (L.savage ? 'bowl' : 'can');
  if (b === 'can') {
    const mc = o.burnCol ?? L.metal, tc = L.trim;
    k.m(rev([[0, 1.28], [0.1, 1.28], [0.13, 1.32], [0.13, 1.5], [0.09, 1.55], [0.09, 1.59], [0.12, 1.62], [0.1, 1.63], [0.07, 1.6], [0, 1.6]], 12, [mc, tc, mc, mc, tc, tc, mc, DARK, DARK]), null);
    for (let i = 0; i < 2; i++) k.rod('metal', mc, [-rr * Math.cos(i * PI / 2), ry, -rr * Math.sin(i * PI / 2)], [rr * Math.cos(i * PI / 2), ry, rr * Math.sin(i * PI / 2)], 0.018, 5);
    k.m(torus(0.1, 0.012, 4, 12), tc, T(0, 1.42, 0, PI / 2)); k.m(cyl(0.012, 0.012, 0.5, 5), tc, T(0.16, 1.2, 0.05, 0, 0, 0.2));
  } else if (b === 'bowl') {
    const cc = o.burnCol ?? 0x4a3a30;
    k.s(rev([[0, 1.36], [0.08, 1.37], [0.17, 1.44], [0.21, 1.54], [0.19, 1.55], [0.14, 1.47], [0, 1.44]], 12, [sh(cc, 0.8), cc, sh(cc, 1.15), sh(cc, 0.6), DARK, DARK]), null);
    k.g(ball(0.13, 8, 5), mix(L.glow, 0xff3a10, 0.5), T(0, 1.5, 0, 0, 0, 0, 1, 0.35, 1));
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; k.rod(rb, rope, [Math.cos(a) * 0.2, 1.54, Math.sin(a) * 0.2], [Math.cos(a) * rr, ry + 0.01, Math.sin(a) * rr], 0.009, 4); }
  }
}
/** the usual stores round a basket: sandbags over the side, a net of supplies, and stores in the corners */
function stores(k, L, o = {}) {
  const hw = (o.w ?? 1) / 2 + 0.05, hd = (o.d ?? 1) / 2 + 0.05, top = o.top ?? 0.5, bagc = o.bagCol ?? 0xb09a6a, rope = o.rope ?? ROPE;
  for (const [x, z] of [[hw, -0.24], [hw, 0.26], [-hw, 0.22], [-0.25, hd], [0.27, -hd]]) sandbag(k, x, top - 0.03, z, bagc, 0.12, rope);
  netbag(k, -hw - 0.1, top + 0.02, -0.18, 0.95, o.netCol ?? SACK, rope); netbag(k, 0.05, top + 0.02, hd + 0.1, 0.8, o.netCol2 ?? 0x9a8a6a, rope);
  const kinds = o.kinds ?? ['crate', 'sack', 'jar'], fy = o.fy ?? 0.05, ix = (o.w ?? 1) / 2 - 0.2, iz = (o.d ?? 1) / 2 - 0.2;
  cargo(k, kinds[0], -ix, fy, -iz, 1.05, 0.2); cargo(k, kinds[1], ix, fy, -iz, 1.1, 1); cargo(k, kinds[2], ix - 0.02, fy, iz, 1.0, 0.4); cargo(k, kinds[0], -ix + 0.21, fy, -iz, 0.8, -0.3);
}
function flameGeo(col, kind) {
  if (kind === 'gem') return gem(0.16, 0.5, 6);
  const hot = mix(col, 0xffffff, 0.55);
  return rev([[0, -0.25], [0.09, -0.21], [0.15, -0.1], [0.13, 0.03], [0.07, 0.17], [0.02, 0.28], [0, 0.33]], 10, [hot, hot, mix(col, hot, 0.5), col, col, sh(col, 0.85)]);
}

/** the common balloon: envelope, owner's band, seam tapes, hoops, rigging, basket; returns the envelope for embellishing */
function balloon(k, L, sp) {
  const env = mkEnv({ prof: PROF[sp.shape || 'globe'], ...(sp.env || {}) });
  k.c(env.geo(sp.pat(env)));
  const [b0, b1] = sp.band || [0.3, 0.38];
  k.o(env.strip(b0, b1, 0.022, (u, v, i) => (Math.floor(i / env.per) & 1 ? WHITE : 0xd0d0d0), 3));
  if (sp.cap !== false) { const [c0, c1] = sp.cap || [0.86, 0.905]; k.o(env.strip(c0, c1, 0.02, (u, v, i) => (Math.floor(i / env.per) & 1 ? WHITE : 0xd0d0d0), 2)); }
  if (sp.bandTrim !== false) for (const v of [b0, b1]) k.hoop(env, v, 0.016, sp.bandTrim ?? L.trim, sp.bandBag ?? 'solid', 4);
  if (sp.tapes !== 0) for (let g = 0; g < env.gores; g += sp.tapes || 1) k.tape(env, g / env.gores, sp.tv0 ?? 0.02, sp.tv1 ?? 0.985, sp.tr ?? 0.012, sp.tcol ?? ROPE, sp.tbag);
  for (const h of sp.hoops || []) k.hoop(env, h[0], h[1] ?? 0.03, h[2] ?? L.trim, h[3] ?? 'metal');
  if (sp.skirt) valance(k, env, 0, sp.skirtLen ?? 0.3, sp.skirt, { n: env.gores, pull: 0.12, lift: 0.0, dag: 0.45 });
  if (sp.mouth !== false) k.add(sp.mouthBag ?? 'solid', sweep(Array.from({ length: 16 }, (_, i) => env.at(i / 16, 0)), 0.028, 5, 32, sp.mouth ?? ROPE, { closed: true, ref: [0, 1, 0] }), null);
  if (sp.rig !== false) rig(k, L, env, sp.rig || {});
  return env;
}

// =====================================================================================================
// BALLOONS, faction by faction
// =====================================================================================================
const B = {};
const stripes = (e, a, b) => (u, v, i) => (Math.floor(i / e.per) & 1 ? a : b);

B.kingdom = (k, L) => { // the classic gored globe in livery, dancetty band, heater shields on a square wicker basket
  const main = L.envelope, pale = mix(main, 0xf2e6c8, 0.78), gold = L.trim;
  const env = balloon(k, L, { pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v > 0.93) return gold; if (v > 0.56 && v < 0.66) { const t = Math.abs(((i + 0.5) / e.per) % 1 - 0.5) * 2; return t < (v - 0.56) / 0.1 ? L.cloth2 : g & 1 ? main : pale; } if (v < 0.06) return sh(main, 0.7); return g & 1 ? main : pale; }, skirt: [main, L.cloth2], hoops: [[0.555, 0.014, gold, 'metal'], [0.665, 0.014, gold, 'metal']] });
  finial(k, env.top(), gold); pennant(k, 'owner', WHITE, 0, env.top() + 0.32, 0, 0.4, 0.5, 0.16, 1);
  wicker(k, {}); stores(k, L, {});
  for (const [x, z, ry] of [[0, 0.53, 0], [0.53, 0, PI / 2], [0, -0.53, PI], [-0.53, 0, -PI / 2]]) shield(k, x * 1.0, 0.3, z * 1.0, ry, 1.15, null, gold);
  flagstaff(k, 0.5, 0.5, 0.5, 0.75, 0.5); flagstaff(k, -0.5, 0.5, -0.5, 0.75, 3.6);
};
B.graal = (k, L) => { // a tourney balloon: chequered belt, coronet of points, a little crenellated turret for a basket
  const main = L.envelope, c2 = L.cloth2, gold = L.trim, pale = mix(main, 0xffffff, 0.8);
  const env = balloon(k, L, { env: { gores: 16, per: 5 }, band: [0.26, 0.33], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v > 0.42 && v < 0.62) return (g + Math.floor((v - 0.42) / 0.05)) & 1 ? c2 : pale; if (v > 0.9) return gold; if (v > 0.62 && v < 0.66) return gold; return g % 4 < 2 ? main : pale; }, skirt: [main, pale], tapes: 2 });
  studs(k, env, 0.9, 8, 'metal', cone(0.07, 0.34, 6).translate(0, 0.17, 0), gold, { tilt: 1.4 }); finial(k, env.top(), gold, 1.1);
  for (let i = 0; i < 8; i++) { const u = i / 8, p = env.at(u, 0.4, 0.03); shield(k, p[0], p[1] - 0.05, p[2], PI / 2 - u * TAU, 1.5, i & 1 ? c2 : pale, gold); }
  const st = 0x9a968c; tub(k, { w: 1.04, d: 1.04, h: 0.44, th: 0.07, col: st, planks: 5 });
  for (let i = 0; i < 12; i++) { const s = Math.floor(i / 3), t = (i % 3) - 1, x = s & 1 ? (s === 1 ? 0.485 : -0.485) : t * 0.38, z = s & 1 ? t * 0.38 : s === 0 ? 0.485 : -0.485; k.s(rbox(s & 1 ? 0.08 : 0.2, 0.13, s & 1 ? 0.2 : 0.08, 0.012, 1), sh(st, 1.08), T(x, 0.5, z)); }
  k.s(rbox(1.1, 0.06, 1.1, 0.02, 1), sh(st, 0.8), T(0, 0.02, 0)); for (let s = 0; s < 4; s++) k.o(box(1.0, 0.1, 0.012), WHITE, T(s === 1 ? 0.527 : s === 3 ? -0.527 : 0, 0.2, s === 0 ? 0.527 : s === 2 ? -0.527 : 0, 0, s & 1 ? PI / 2 : 0, 0));
  stores(k, L, { w: 1.04, d: 1.04, top: 0.46 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) flagstaff(k, x * 0.5, 0.5, z * 0.5, 0.95, x * z > 0 ? 0.6 : 2.4, { len: 0.42, h: 0.14, tail: 0, col: main });
};
B.aurelia = (k, L) => { // a grand montgolfier: painted bulb with gilt swags and laurels, a round balustraded gallery
  const main = L.envelope, gold = L.trim, ivory = 0xf0e6cc, c2 = L.cloth2;
  const env = balloon(k, L, { shape: 'bulb', env: { gores: 16, per: 5, bulge: 0.03 }, band: [0.36, 0.43], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v < 0.16) return g & 1 ? gold : main; if (v > 0.5 && v < 0.6) return ivory; if (v > 0.6 && v < 0.63 || v > 0.47 && v < 0.5) return gold; if (v > 0.86) return (i % e.per === 0 || i % e.per === e.per - 1) ? gold : c2; return i % e.per === 2 ? mix(main, gold, 0.5) : main; }, tapes: 0, hoops: [[0.17, 0.03, gold], [0.86, 0.025, gold]], mouth: gold, mouthBag: 'metal', rig: { n: 8, vr: 0.02, ringR: 0.62, ringY: 1.3, posts: Array.from({ length: 8 }, (_, i) => [Math.cos(i * PI / 4 + 0.39) * 0.55, Math.sin(i * PI / 4 + 0.39) * 0.55]), top: 0.52, postCol: gold, postBag: 'metal' } });
  for (let i = 0; i < 8; i++) { const pts = []; for (let t = 0; t <= 6; t++) { const p = env.at((i + t / 6) / 8, 0.66, 0.05); p[1] -= 0.32 * Math.sin((PI * t) / 6); pts.push(p); } k.m(sweep(pts, 0.03, 5, 10, gold), null); const p = env.at(i / 8, 0.66, 0.06); k.m(ball(0.07, 8, 6), gold, T(p[0], p[1], p[2])); tassel(k, p[0], p[1] - 0.05, p[2], c2, 0.3, gold); }
  for (let i = 0; i < 8; i++) { const u = (i + 0.5) / 8; k.c(disc(env, u, 0.55, 0.02, 0.032, i & 1 ? c2 : main, 12, 0.03)); k.m(disc(env, u, 0.55, 0.007, 0.011, gold, 6, 0.05)); }
  k.m(rev([[0, 0], [0.2, 0], [0.22, 0.04], [0.1, 0.08], [0.06, 0.14], [0.16, 0.24], [0.17, 0.32], [0.1, 0.4], [0.03, 0.44], [0, 0.46]], 14, gold), null, T(0, env.top() - 0.03, 0, 0, 0, 0, 0.85)); k.m(torus(0.07, 0.014, 5, 14), gold, T(0, env.top() + 0.41, 0));
  // the gallery
  k.s(rev([[0, 0], [0.5, 0], [0.56, 0.03], [0.56, 0.07], [0.5, 0.08], [0, 0.08]], 24, [sh(L.wood, 0.6), L.wood, gold, L.wood, sh(L.wood, 0.75)]), null);
  k.s(surf(24, 4, (u, v, out) => { const a = u * TAU; out[0] = Math.cos(a) * 0.5; out[1] = 0.08 + v * 0.2; out[2] = Math.sin(a) * 0.5; }, (u, v, i) => (i % 3 === 0 ? gold : main), { closeU: true })); k.s(surf(24, 1, (u, v, out) => { const a = u * TAU; out[0] = Math.cos(a) * 0.47; out[1] = 0.08 + v * 0.2; out[2] = Math.sin(a) * 0.47; }, sh(main, 0.5), { closeU: true, flip: true }));
  const bal = rev([[0.016, 0], [0.03, 0.03], [0.014, 0.08], [0.034, 0.14], [0.016, 0.2], [0.02, 0.22]], 6, ivory); for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; k.s(bal, null, T(Math.cos(a) * 0.52, 0.28, Math.sin(a) * 0.52)); }
  k.m(torus(0.52, 0.03, 6, 28), gold, T(0, 0.51, 0, PI / 2)); k.m(torus(0.5, 0.02, 5, 28), gold, T(0, 0.285, 0, PI / 2));
  k.o(surf(24, 1, (u, v, out) => { const a = u * TAU; out[0] = Math.cos(a) * 0.512; out[1] = 0.12 + v * 0.1; out[2] = Math.sin(a) * 0.512; }, (u, v, i) => (i % 3 === 0 ? 0xd0d0d0 : WHITE), { closeU: true }));
  for (let i = 0; i < 5; i++) { const a = i * 1.257; sandbag(k, Math.cos(a) * 0.6, 0.48, Math.sin(a) * 0.6, 0xc8b88a, 0.14); }
  netbag(k, -0.66, 0.5, 0.2, 0.9); cargo(k, 'chest', -0.2, 0.08, -0.28, 1, 0.3); cargo(k, 'jar', 0.28, 0.08, -0.2); cargo(k, 'barrel', 0.2, 0.08, 0.3);
  flagstaff(k, 0.36, 0.52, 0.36, 0.7, 0.6, { tail: 1 });
};
B.westmark = (k, L) => { // the republic's workaday balloon: banded cloth under a full diamond net, plank car, barrels and tools
  const main = L.envelope, pale = 0xe8dcc0, c2 = L.cloth2;
  const env = balloon(k, L, { env: { gores: 10, per: 6, bulge: 0.035 }, band: [0.4, 0.5], pat: (e) => (u, v, i, j) => (v > 0.94 ? sh(main, 0.7) : v > 0.72 ? main : v > 0.6 ? pale : v > 0.5 ? c2 : v > 0.3 ? pale : v > 0.14 ? main : sh(pale, 0.85)), tapes: 0, bandTrim: false, rig: { n: 10, vr: 0.3, ringCol: 0x6a4a2a, ringBag: 'solid', ringT: 0.04 } });
  const N = 10; for (let i = 0; i < N; i++) for (const dir of [-1, 1]) { const pts = []; for (let t = 0; t <= 10; t++) { const v = 0.3 + 0.66 * (t / 10); pts.push(env.at(i / N + dir * 0.16 * (t / 10) * 2, v, 0.012)); } k.s(sweep(pts, 0.009, 3, 10, ROPE), null); }
  k.hoop(env, 0.3, 0.02, ROPE, 'solid', 4); k.s(rev([[0, 0], [0.2, 0], [0.22, 0.03], [0.1, 0.07], [0, 0.08]], 12, 0x6a4a2a), null, T(0, env.top() - 0.02, 0));
  tub(k, { w: 1.04, d: 1.0, h: 0.5, col: L.wood, planks: 6, rim: sh(L.wood, 0.6), rimBag: 'solid' });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.m(box(0.09, 0.5, 0.09), L.metal, T(x * 0.49, 0.25, z * 0.47));
  for (const y of [0.12, 0.38]) for (const z of [-1, 1]) k.m(box(1.06, 0.035, 0.02), L.metal, T(0, y, z * 0.505));
  stores(k, L, { w: 1.04, kinds: ['barrel', 'crate', 'barrel'] }); cargo(k, 'barrel', 0.62, 0.02, 0.0, 1.2, 0); k.s(torus(0.115, 0.012, 4, 12), ROPE, T(0.62, 0.15, 0, PI / 2));
  k.o(box(0.7, 0.2, 0.02), WHITE, T(0, 0.26, 0.515)); k.o(box(0.7, 0.2, 0.02), WHITE, T(0, 0.26, -0.515));
  flagstaff(k, -0.5, 0.5, 0.47, 0.8, 0.3, { tail: 2, len: 0.5, h: 0.26 });
};
B.principalities = (k, L) => { // a merchant prince's twin-lobed harlequin, heavy with nets, chests and bunting
  const main = L.envelope, gold = L.trim, c2 = L.cloth2, pale = 0xf0e4c4;
  const env = balloon(k, L, { shape: 'gourd', env: { gores: 14, per: 5 }, band: [0.37, 0.45], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per), d = (g + Math.floor(v * 16)) & 1; if (v > 0.37 && v < 0.45) return gold; if (v > 0.93) return gold; return v < 0.37 ? (d ? main : pale) : (g + Math.floor(v * 16) * 2) % 3 === 0 ? c2 : d ? main : pale; }, skirt: [gold, main], tapes: 2, tcol: gold, tbag: 'metal', hoops: [[0.36, 0.03, gold], [0.46, 0.03, gold]], bandTrim: false });
  finial(k, env.top(), gold, 1.2); for (let i = 0; i < 7; i++) { const u = i / 7, p = env.at(u, 0.4, 0.05); k.m(rev([[0, -0.08], [0.06, -0.05], [0.07, 0], [0.05, 0.05], [0, 0.07]], 8, gold), null, T(p[0], p[1], p[2])); }
  wicker(k, { ex: 2.6, w: 1.1, d: 1.1, c1: 0xc09a58, c2: 0x9a7440, rim: gold });
  for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3; if (i % 2) netbag(k, Math.cos(a) * 0.66, 0.52, Math.sin(a) * 0.66, 0.9, i === 3 ? 0xa86a4a : SACK); else sandbag(k, Math.cos(a) * 0.6, 0.47, Math.sin(a) * 0.6, c2, 0.12); }
  cargo(k, 'chest', -0.2, 0.05, -0.22, 1.1, 0.4); cargo(k, 'jar', 0.26, 0.05, -0.22); cargo(k, 'bale', 0.22, 0.05, 0.26, 1, 0.5, main); cargo(k, 'jar', -0.3, 0.05, 0.2, 0.8, 0, 0x4a7a8a);
  for (let s = 0; s < 4; s++) { const a = s * PI / 2 + 0.78, p0 = [Math.cos(a) * 0.55, 0.52, Math.sin(a) * 0.55], p1 = env.at(a / TAU, 0.3, 0.03); k.rod('solid', ROPE, p0, p1, 0.007, 3); for (let t = 1; t < 8; t++) { const f = t / 8; k.add(t === 4 ? 'owner' : 'cloth', cone(0.06, 0.14, 3), t === 4 ? WHITE : [main, pale, c2, gold][t % 4], T(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f - 0.08, p0[2] + (p1[2] - p0[2]) * f, PI, a, 0, 1, 1, 0.15)); } }
  k.o(surf(28, 1, (u, v, out) => { const a = u * TAU; out[0] = Math.cos(a) * (0.5 + 0.06 * v) * 1.02; out[1] = 0.14 + v * 0.14; out[2] = Math.sin(a) * (0.5 + 0.06 * v) * 1.02; }, WHITE, { closeU: true }));
};
B.sunkings = (k, L) => { // a broad sun: gold rays bursting from the crown, a spiked corona at the equator, gilded sun-faces
  const main = L.envelope, gold = L.trim, c2 = L.cloth2;
  const env = balloon(k, L, { shape: 'oblate', env: { gores: 24, per: 3, bulge: 0.03, s: 0.97 }, band: [0.24, 0.32], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v > 0.84) return gold; if (v > 0.44) return g & 1 ? gold : (g % 4 === 0 ? main : sh(main, 0.8)); if (v > 0.4) return c2; return g & 1 ? main : sh(main, 0.82); }, tapes: 4, tcol: gold, skirt: [gold, main], hoops: [[0.42, 0.03, gold]], rig: { n: 12 } });
  studs(k, env, 0.42, 24, 'metal', cone(0.06, 0.2, 4).translate(0, 0.08, 0), gold, { s: 1 });
  for (const u of [0.25, 0.75]) { const p = env.at(u, 0.62, 0.05), d = env.nrm(u, 0.62); k.push(TA(p, d)); k.m(cyl(0.34, 0.34, 0.05, 20), gold, T(0, 0, 0)); k.m(ball(0.2, 12, 8), sh(gold, 1.15), T(0, 0.03, 0, 0, 0, 0, 1, 0.4, 1)); for (let i = 0; i < 12; i++) k.m(cone(0.06, i & 1 ? 0.2 : 0.32, 4), gold, T(Math.cos(i * PI / 6) * 0.44, 0, Math.sin(i * PI / 6) * 0.44, 0, -i * PI / 6, -PI / 2)); k.pop(); }
  k.m(rev([[0, 0], [0.25, 0], [0.2, 0.06], [0.08, 0.1], [0.12, 0.2], [0, 0.3]], 12, gold), null, T(0, env.top() - 0.03, 0)); for (let i = 0; i < 8; i++) k.m(cone(0.04, 0.26, 4), gold, T(Math.cos(i * PI / 4) * 0.2, env.top() + 0.17, Math.sin(i * PI / 4) * 0.2, 0, -i * PI / 4, -1.0));
  tub(k, { w: 1.04, d: 1.04, h: 0.48, col: L.wood, rim: gold, th: 0.06 });
  for (const [x, z, ry] of [[0, 0.53, 0], [0.53, 0, PI / 2], [0, -0.53, PI], [-0.53, 0, -PI / 2]]) { k.push(T(x, 0.27, z, 0, ry, 0)); k.m(cyl(0.16, 0.16, 0.03, 16), gold, T(0, 0, 0, PI / 2)); for (let i = 0; i < 10; i++) k.m(cone(0.035, 0.12, 4), gold, T(Math.cos(i * 0.628) * 0.21, Math.sin(i * 0.628) * 0.21, 0, 0, 0, i * 0.628 - PI / 2)); k.o(box(0.9, 0.09, 0.012), WHITE, T(0, -0.17, -0.005)); k.o(box(0.9, 0.06, 0.012), WHITE, T(0, 0.17, -0.005)); k.pop(); }
  stores(k, L, { w: 1.04, kinds: ['chest', 'jar', 'sack'] }); flagstaff(k, 0.5, 0.5, -0.5, 0.8, -0.6, { knob: gold });
};
B.aethel = (k, L) => { // a slender white-and-gold teardrop with leaf vanes and a star-crystal, over a swan-prowed skiff
  const main = L.envelope, gold = L.trim, pale = mix(main, 0xffffff, 0.6), c2 = L.cloth2;
  const env = balloon(k, L, { shape: 'tear', env: { gores: 10, per: 6, bulge: 0.03, cy: 4.0 }, band: [0.36, 0.43], pat: (e) => (u, v, i, j) => { const q = i % e.per; if (v > 0.9) return gold; if (v > 0.52 && v < 0.56) return gold; if (v > 0.56 && v < 0.64) return (q === 2 || q === 3) ? gold : pale; return q === 0 || q === e.per - 1 ? mix(main, gold, 0.35) : v < 0.1 ? mix(main, c2, 0.4) : main; }, tcol: gold, tbag: 'metal', tr: 0.014, mouth: gold, mouthBag: 'metal', rig: { rope: 0xd8d0b8, n: 5, vr: 0.14, ringCol: gold, ringR: 0.42, posts: [[0.55, 0.2], [0.55, -0.2], [-0.5, 0.22], [-0.5, -0.22]], top: 0.5, burner: 'none', r: 0.008 } });
  for (let i = 0; i < 5; i++) { const u = (i + 0.5) / 5, p = env.at(u, 0.03, 0), a = u * TAU; k.c(leaf(1.5, 0.62, -0.22, (uu, v) => (Math.abs(uu - 0.5) < 0.13 ? gold : v > 0.6 ? pale : c2), { nu: 4, nv: 10, pw: 0.7 }), null, T(p[0], p[1] - 0.05, p[2], 0.95, PI / 2 - a, 0)); }
  k.g(gem(0.12, 0.42, 6), L.glow, T(0, env.top() + 0.14, 0), true); k.m(torus(0.17, 0.014, 5, 20), gold, T(0, env.top() + 0.14, 0, PI / 2)); k.m(torus(0.17, 0.014, 5, 20), gold, T(0, env.top() + 0.14, 0, 0, 0, 0));
  k.m(rev([[0, 1.3], [0.05, 1.32], [0.13, 1.4], [0.16, 1.5], [0.13, 1.56], [0.1, 1.5], [0, 1.46]], 12, gold), null); k.g(gem(0.07, 0.2, 6), L.glow, T(0, 1.55, 0), true);
  const P = hull(k, { len: 1.5, wid: 0.92, h: 0.5, col: L.wood, rail: gold, strakes: 5, sheer: 0.16 });
  k.s(sweep([[0.7, 0.42, 0], [0.92, 0.62, 0], [0.95, 0.95, 0], [0.8, 1.1, 0], [0.84, 0.96, 0]], (v) => 0.075 * (1 - v * 0.55), 7, 12, L.wood), null); k.s(ball(0.07, 8, 6), L.wood, T(0.86, 1.0, 0, 0, 0, -0.6, 1.5, 0.9, 0.9)); k.m(cone(0.03, 0.14, 5), gold, T(0.98, 0.93, 0, 0, 0, -2.2));
  for (const z of [-1, 1]) for (let i = 0; i < 4; i++) k.c(leaf(0.62 - i * 0.07, 0.2, 0.25 * z, i & 1 ? pale : L.wood, { nv: 6 }), null, T(-0.05 - i * 0.14, 0.3 + i * 0.03, z * 0.42, 0, 0, 1.25 + i * 0.07));
  k.o(surf(12, 1, (u, v, out) => { P(0.15 + u * 0.7, 0.86, 1.012, out); out[1] -= v * 0.12; }, WHITE)); k.o(surf(12, 1, (u, v, out) => { P(0.15 + u * 0.7, 0.14, 1.012, out); out[1] -= v * 0.12; }, WHITE));
  lantern(k, -0.74, 0.86, 0, L.glow, gold, 1.3); k.m(sweep([[-0.68, 0.45, 0], [-0.82, 0.7, 0], [-0.74, 0.9, 0]], 0.014, 4, 6, gold), null);
  cargo(k, 'jar', -0.3, 0.08, 0.12, 0.9, 0, 0xe8e0cc); cargo(k, 'chest', 0.3, 0.08, -0.1, 0.9, 0.2, 0xd8d0bc); cargo(k, 'sack', -0.34, 0.08, -0.14, 0.9, 0, 0xe0d8c0);
  for (const z of [-0.44, 0.44]) sandbag(k, 0.2, 0.44, z, 0xe8e0cc, 0.1, 0xd8d0b8); pennant(k, 'owner', WHITE, -0.74, 1.15, 0, PI, 0.7, 0.14, 0);
};
B.kaelneth = (k, L) => { // a bladed black star-spindle with glowing violet seams and crescent vanes, over a barbed hull
  const main = L.envelope, glow = L.glow, dk = 0x16121c, c2 = L.cloth2;
  const env = balloon(k, L, { shape: 'spindle', env: { gores: 6, per: 8, bulge: -0.16, rows: 32, s: 0.86, cy: 3.95 }, band: [0.22, 0.29], pat: (e) => (u, v, i, j) => { const q = i % e.per; return q === 0 || q === e.per - 1 ? dk : (q === 3 || q === 4) && v > 0.3 && v < 0.75 ? sh(main, 1.25) : (j & 3) === 0 ? sh(main, 0.7) : main; }, tapes: 0, bandTrim: L.metal, mouth: L.metal, rig: { rope: 0x1a1620, n: 6, vr: 0.15, ringCol: L.metal, postCol: L.metal, postBag: 'metal', posts: [[0.5, 0.22], [0.5, -0.22], [-0.5, 0.22], [-0.5, -0.22]], burner: 'none' } });
  for (let g = 0; g < 6; g++) k.tape(env, g / 6, 0.05, 0.97, 0.02, glow, 'glow', 14, 3);
  for (let g = 0; g < 6; g++) { const u = g / 6, a = u * TAU, p = env.at(u, 0.47, 0.0); k.m(sweep([[p[0], p[1] - 0.5, p[2]], [p[0] + Math.cos(a) * 0.16, p[1], p[2] + Math.sin(a) * 0.16], [p[0] * 0.92, p[1] + 0.75, p[2] * 0.92]], (v) => 0.06 * Math.sin(PI * v) + 0.004, 4, 10, L.metal), null, null, true); }
  k.m(cone(0.1, 0.6, 6), L.metal, T(0, env.top() + 0.1, 0)); for (let i = 0; i < 3; i++) { const a = i * 2.094; k.g(gem(0.09, 0.34, 5), glow, T(Math.cos(a + 0.5) * 1.7, 4.4 + i * 0.5, Math.sin(a + 0.5) * 1.7, 0.3, a, 0.2), true); }
  k.g(gem(0.1, 0.4, 6), glow, T(0, 1.46, 0), true); k.m(rev([[0, 1.24], [0.1, 1.28], [0.16, 1.38], [0.1, 1.36], [0, 1.34]], 6, L.metal), null, null, true);
  const P = hull(k, { len: 1.6, wid: 0.84, h: 0.5, col: L.wood, rail: L.metal, strakes: 4, blunt: 1.5, stern: 0.9, sheer: 0.3 });
  for (const sx of [-1, 1]) k.m(sweep([[sx * 0.72, 0.5, 0], [sx * 0.95, 0.62, 0], [sx * 1.06, 0.95, 0]], (v) => 0.05 * (1 - v) + 0.004, 4, 8, L.metal), null, null, true);
  for (let i = 0; i < 5; i++) for (const z of [-1, 1]) k.m(cone(0.03, 0.2, 4), L.metal, T(-0.4 + i * 0.2, 0.4, z * 0.43, z * 1.3, 0, 0));
  k.o(surf(12, 1, (u, v, out) => { P(0.2 + u * 0.6, 0.84, 1.015, out); out[1] -= v * 0.11; }, WHITE)); k.o(surf(12, 1, (u, v, out) => { P(0.2 + u * 0.6, 0.16, 1.015, out); out[1] -= v * 0.11; }, WHITE));
  cargo(k, 'chest', -0.28, 0.08, 0, 0.95, 0.1, 0x2a2434); cargo(k, 'jar', 0.3, 0.08, 0.1, 0.9, 0, 0x4a2a6a); cargo(k, 'crate', 0.3, 0.08, -0.13, 0.8, 0.3, 0x3a3044);
  for (const z of [-0.42, 0.42]) { sandbag(k, -0.2, 0.42, z, 0x3a3044, 0.1, 0x1a1620); lantern(k, 0.35, 0.36, z * 1.08, glow, L.metal); }
  pennant(k, 'owner', WHITE, -1.04, 0.9, 0, PI, 0.7, 0.2, 1);
};
B.grom = (k, L) => { // a squat leather barrel bound in riveted iron hoops, with a furnace and stack over an iron-plated car
  const main = L.envelope, iron = L.metal, gold = L.trim, lt = sh(main, 1.15), dk = sh(main, 0.8);
  const env = balloon(k, L, { shape: 'barrel', env: { gores: 8, per: 8, bulge: 0.035, cy: 4.05 }, band: [0.37, 0.46], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); return v > 0.9 || v < 0.08 ? sh(iron, 1.3) : (g + (v > 0.5 ? 1 : 0)) & 1 ? lt : dk; }, tapes: 1, tr: 0.035, tcol: sh(iron, 1.3), tbag: 'metal', hoops: [[0.2, 0.045, sh(iron, 1.3)], [0.5, 0.05, sh(iron, 1.3)], [0.78, 0.045, sh(iron, 1.3)]], bandTrim: gold, bandBag: 'metal', mouth: iron, mouthBag: 'metal', rig: { rope: 0x2a2a30, bag: 'metal', n: 8, vr: 0.12, r: 0.014, ringT: 0.045, ringCol: sh(iron, 1.3), postR: 0.03, burner: 'none' } });
  for (const v of [0.2, 0.5, 0.78]) studs(k, env, v, 24, 'metal', ball(0.038, 5, 3), gold, { lift: 0.05, off: 0.5 });
  k.m(rev([[0, 0], [0.5, -0.06], [0.52, 0], [0.3, 0.08], [0.2, 0.1], [0.2, 0.3], [0.25, 0.32], [0.25, 0.38], [0.16, 0.38], [0.16, 0.1]], 16, [iron, gold, sh(iron, 1.3), iron, sh(iron, 1.3), gold, gold, DARK, DARK]), null, T(0, env.top() - 0.04, 0));
  for (let i = 0; i < 8; i++) { const p = env.at((i + 0.5) / 8, 0.5, 0.06), d = env.nrm((i + 0.5) / 8, 0.5); k.push(TA(p, d)); k.m(cyl(0.16, 0.16, 0.04, 8), i & 1 ? gold : sh(iron, 1.4), T()); k.m(box(0.05, 0.05, 0.22), iron, T(0, 0.02, 0)); k.m(box(0.22, 0.05, 0.05), iron, T(0, 0.02, 0)); k.pop(); }
  // furnace
  k.m(rev([[0, 1.1], [0.2, 1.1], [0.24, 1.16], [0.24, 1.44], [0.17, 1.54], [0.13, 1.56], [0.13, 1.62], [0.16, 1.63], [0.1, 1.6], [0, 1.58]], 8, [iron, gold, sh(iron, 1.4), iron, gold, sh(iron, 1.3), gold, DARK, DARK], { rot: PI / 8 }), null, null, true);
  for (let i = 0; i < 4; i++) k.g(box(0.1, 0.12, 0.02), L.glow, T(Math.cos(i * PI / 2) * 0.225, 1.3, Math.sin(i * PI / 2) * 0.225, 0, PI / 2 - i * PI / 2, 0));
  k.m(sweep([[0.2, 1.4, 0.1], [0.42, 1.5, 0.2], [0.46, 1.9, 0.22]], 0.045, 6, 8, sh(iron, 1.3)), null); k.m(cyl(0.065, 0.05, 0.08, 8), gold, T(0.46, 1.92, 0.22));
  tub(k, { w: 1.06, d: 1.06, h: 0.5, th: 0.06, col: sh(iron, 1.5), bag: 'metal', rim: gold, r: 0.03 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { k.m(rbox(0.12, 0.56, 0.12, 0.02, 1), iron, T(x * 0.5, 0.27, z * 0.5)); k.m(ball(0.06, 8, 6), gold, T(x * 0.5, 0.58, z * 0.5)); }
  for (let s = 0; s < 4; s++) { const ry = s * PI / 2; k.push(T(0, 0, 0, 0, ry, 0)); for (let i = 0; i < 7; i++) for (const y of [0.08, 0.42]) k.m(ball(0.02, 5, 4), gold, T(-0.36 + i * 0.12, y, 0.535)); k.o(rbox(0.72, 0.2, 0.02, 0.008, 1), WHITE, T(0, 0.25, 0.535)); roundShield(k, 0, 0.25, 0.55, 0, 0.11, s & 1 ? gold : sh(iron, 1.6), iron); k.pop(); }
  stores(k, L, { w: 1.06, d: 1.06, kinds: ['barrel', 'crate', 'chest'], bagCol: 0x7a6a50 }); k.s(ball(0.1, 6, 4), 0xd8b040, T(0.3, 0.3, -0.3, 0, 0, 0, 1, 0.5, 1), true);
  flagstaff(k, -0.5, 0.6, 0.5, 0.6, 0.4, { bag: 'metal', col: iron, tail: 2, len: 0.42, h: 0.26 });
};
B.tianlong = (k, L) => { // a great ribbed lantern under a swept roof, a gold dragon coiled round it, tassels and a lacquer car
  const main = L.envelope, gold = L.trim, dk = sh(main, 0.75), c2 = L.cloth2;
  const env = balloon(k, L, { shape: 'lantern', env: { gores: 16, per: 4, bulge: 0.02, ripple: 9, rows: 36, cy: 3.95 }, band: [0.14, 0.22], pat: (e) => (u, v, i, j) => (v > 0.94 || v < 0.05 ? gold : v > 0.76 && v < 0.82 ? gold : (Math.floor(i / e.per) & 1) ? main : dk), tapes: 0, hoops: [[0.0, 0.05, gold], [1.0, 0.05, gold], [0.48, 0.02, gold]], mouth: false, rig: { n: 8, vr: 0.02, ringCol: gold, rope: 0x7a1a14, postCol: 0x7a1a14, postBag: 'solid', postR: 0.022 } });
  const ty = env.top();
  k.s(rev([[0.62, 0], [0.62, 0.1], [0.4, 0.14], [0.36, 0.2]], 16, [sh(main, 0.6), gold, DARK]), null, T(0, ty, 0));
  k.s(rev([[1.25, 0.0], [1.0, 0.02], [0.62, 0.1], [0.3, 0.24], [0.1, 0.4], [0, 0.44]], 28, (u, v) => (v < 0.15 ? gold : v > 0.85 ? gold : (Math.floor(u * 56) & 1 ? 0x2a4a3a : 0x234034)), { ex: 5, up: 0.22, spl: 8, sx: 0.78, sz: 0.78 }), null, T(0, ty + 0.16, 0)); k.m(rev([[0, 0], [0.06, 0.02], [0.03, 0.08], [0.08, 0.14], [0, 0.26]], 8, gold), null, T(0, ty + 0.58, 0));
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4, x = Math.cos(a) * 1.3, z = Math.sin(a) * 1.3; tassel(k, x, ty + 0.3, z, main, 0.36, gold); }
  for (let i = 0; i < 8; i++) { const p = env.at(i / 8 + 0.0625, 0, 0.03); tassel(k, p[0], p[1] - 0.02, p[2], i & 1 ? gold : c2, 0.34, gold); }
  const dp = []; for (let t = 0; t <= 26; t++) { const f = t / 26; dp.push(env.at(0.2 + 1.35 * f, 0.24 + 0.5 * f + 0.03 * Math.sin(f * 30), 0.1 + 0.03 * Math.sin(f * 22))); }
  k.m(sweep(dp, (v) => 0.04 + 0.1 * Math.sin(PI * Math.min(1, v * 1.1 + 0.03)), 7, 60, (u, v, i, j) => (i === 1 || i === 2 ? sh(gold, 1.15) : j % 3 === 0 ? sh(gold, 0.75) : gold)), null);
  { const h = dp[26], h2 = dp[25], d = [h[0] - h2[0], h[1] - h2[1] + 0.02, h[2] - h2[2]]; k.push(TA(h, d)); k.m(rbox(0.2, 0.3, 0.17, 0.05, 2), gold, T(0, 0.1, 0)); k.m(rbox(0.13, 0.2, 0.12, 0.03, 1), sh(gold, 1.1), T(0, 0.32, -0.01)); for (const x of [-1, 1]) { k.m(cone(0.025, 0.24, 5), 0xf0e0c0, T(x * 0.08, -0.02, 0.1, -2.4, 0, x * 0.3)); k.g(ball(0.03, 6, 5), L.glow, T(x * 0.09, 0.14, 0.07)); k.s(sweep([[x * 0.06, 0.36, 0.04], [x * 0.2, 0.5, 0.1], [x * 0.3, 0.42, 0.2]], 0.01, 3, 6, 0xb02a22), null); } k.pop(); }
  for (let t = 3; t < 25; t += 2) { const p = dp[t], n = env.nrm(0.2 + 1.35 * t / 26, 0.24 + 0.5 * t / 26); k.s(cone(0.03, 0.14, 4), 0xb02a22, TA([p[0] + n[0] * 0.07, p[1] + 0.03, p[2] + n[2] * 0.07], [n[0], 0.6, n[2]])); }
  tub(k, { w: 1.04, d: 1.04, h: 0.36, col: main, th: 0.05, rim: gold, r: 0.025 });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { k.s(cyl(0.035, 0.035, 0.62, 8), 0x7a1a14, T(x * 0.5, 0.31, z * 0.5)); k.m(ball(0.045, 8, 6), gold, T(x * 0.5, 0.64, z * 0.5)); lantern(k, x * 0.6, 0.5, z * 0.6, L.glow, 0x7a1a14, 1.2); }
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); k.m(box(0.96, 0.025, 0.025), gold, T(0, 0.52, 0.5)); for (let i = 0; i < 5; i++) k.m(box(0.02, 0.16, 0.02), gold, T(-0.36 + i * 0.18, 0.44, 0.5)); k.o(box(0.8, 0.16, 0.012), WHITE, T(0, 0.2, 0.527)); k.m(torus(0.05, 0.012, 4, 10), gold, T(0, 0.2, 0.535)); k.pop(); }
  stores(k, L, { w: 1.04, top: 0.38, kinds: ['chest', 'jar', 'bale'], bagCol: 0xc8a868 });
  flagstaff(k, 0.5, 0.66, -0.5, 0.5, -0.5, { tail: 2, len: 0.3, h: 0.5, col: 0x7a1a14, knob: gold });
};
B.shogunate = (k, L) => { // a round paper lantern, white with the sun disc, black lacquer caps; war banners on a dark car
  const main = L.envelope, lac = 0x1c1a1c, paper = 0xf2ecdc, gold = L.trim;
  const env = balloon(k, L, { shape: 'round', env: { gores: 20, per: 3, bulge: 0.012, ripple: 16, rows: 48, cy: 3.95 }, band: [0.1, 0.17], pat: (e) => (u, v, i, j) => (v < 0.06 || v > 0.94 ? lac : (j % 3 === 0) ? sh(paper, 0.9) : paper), tapes: 0, bandTrim: lac, hoops: [[0, 0.06, lac, 'solid'], [1, 0.06, lac, 'solid']], mouth: false, rig: { n: 8, vr: 0.01, ringCol: lac, ringBag: 'solid', rope: lac, postR: 0.02 } });
  for (const u of [0.25, 0.75]) k.c(disc(env, u, 0.54, 0.105, 0.2, main, 28, 0.03));
  for (const u of [0, 0.5]) for (let t = 0; t < 3; t++) k.c(disc(env, u, 0.36 + t * 0.15, 0.022, 0.045, lac, 10, 0.03));
  const ty = env.top(); k.s(rev([[0.64, -0.02], [0.66, 0.08], [0.5, 0.14], [0.2, 0.16], [0.0, 0.16]], 20, [lac, gold, lac, lac]), null, T(0, ty, 0)); k.s(torus(0.16, 0.03, 5, 14), 0xb02a22, T(0, ty + 0.3, 0)); k.s(cyl(0.03, 0.03, 0.14, 6), lac, T(0, ty + 0.2, 0));
  k.s(rev([[0.5, -0.16], [0.66, -0.1], [0.64, 0.02]], 20, [gold, lac]), null, T(0, env.at(0, 0)[1], 0));
  for (let i = 0; i < 4; i++) { const p = env.at(i / 4 + 0.125, 0, 0.05); tassel(k, p[0], p[1] - 0.12, p[2], main, 0.36, 0xb02a22); }
  tub(k, { w: 1.04, d: 1.04, h: 0.46, col: 0x3a2e28, planks: 7, th: 0.045, rim: lac, rimBag: 'solid' });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { k.s(box(0.07, 0.56, 0.07), lac, T(x * 0.5, 0.28, z * 0.5)); k.m(box(0.085, 0.05, 0.085), gold, T(x * 0.5, 0.55, z * 0.5)); k.m(box(0.085, 0.04, 0.085), gold, T(x * 0.5, 0.03, z * 0.5)); }
  for (const z of [-1, 1]) { k.s(box(1.24, 0.06, 0.07), lac, T(0, 0.98, z * 0.5)); k.s(box(1.1, 0.045, 0.06), 0xa81a1a, T(0, 0.86, z * 0.5)); for (const x of [-1, 1]) { k.s(box(0.06, 0.5, 0.06), 0xa81a1a, T(x * 0.5, 0.8, z * 0.5)); k.s(box(0.12, 0.05, 0.1), lac, T(x * 0.64, 1.02, z * 0.5, 0, 0, x * -0.4)); } }
  for (const x of [-0.42, 0.42]) { k.s(cyl(0.014, 0.014, 1.2, 5), lac, T(x, 1.0, -0.56)); k.s(cyl(0.012, 0.012, 0.3, 5), lac, T(x, 1.58, -0.56, 0, 0, PI / 2)); k.o(surf(2, 6, (u, v, out) => { out[0] = x + (u - 0.5) * 0.26; out[1] = 1.57 - v * 0.9; out[2] = -0.565 - 0.03 * Math.sin(v * 5); }, (u, v, i, j) => (j === 0 ? 0xc8c8c8 : WHITE))); k.s(cyl(0.05, 0.05, 0.012, 12), main, T(x, 1.25, -0.578, PI / 2)); }
  k.o(box(0.8, 0.18, 0.012), WHITE, T(0, 0.26, 0.527)); k.s(cyl(0.065, 0.065, 0.014, 14), paper, T(0, 0.26, 0.53, PI / 2));
  stores(k, L, { w: 1.04, kinds: ['bale', 'barrel', 'jar'], bagCol: 0xc8b88a, netCol: 0xd8c89a });
};
B.thousandgods = (k, L) => { // a saffron temple-spire of a balloon: lotus skirt, bell-hung rings, prayer flags of every colour
  const main = L.envelope, gold = L.trim, c2 = L.cloth2, FL = [0xd83a2a, 0xe8a81a, 0x2a8a4a, 0x2a5ab8, 0xf0ece0, 0xc83a8a];
  const env = balloon(k, L, { shape: 'stupa', env: { gores: 16, per: 4, bulge: 0.035, rows: 40 }, band: [0.23, 0.29], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v > 0.6) return j & 1 ? gold : sh(gold, 0.8); if (v > 0.5) return FL[g % 6]; if (v > 0.47 || (v > 0.2 && v < 0.23)) return gold; return g & 1 ? main : mix(main, c2, 0.55); }, tapes: 2, tcol: gold, skirt: false, rig: { n: 8, ringCol: gold } });
  for (let i = 0; i < 16; i++) { const u = (i + 0.5) / 16, p = env.at(u, 0.045, 0.02), a = u * TAU; k.c(leaf(0.62, 0.42, 0.5, (uu, v) => (v > 0.7 ? 0xf0a0b0 : v > 0.3 ? 0xf6c8cc : gold), { nu: 4, nv: 6, pw: 0.6, cup: -0.15 }), null, T(p[0], p[1] - 0.02, p[2], 0.25, PI / 2 - a, 0)); }
  studs(k, env, 0.47, 16, 'metal', rev([[0.05, -0.16], [0.055, -0.13], [0.035, -0.08], [0.02, -0.03], [0.006, 0.0]], 7, gold).translate(0, -0.02, 0.0), gold, { lift: 0.06, tilt: 100 });
  for (const v of [0.635, 0.725, 0.81]) k.hoop(env, v, 0.035, gold, 'metal', 4); k.m(rev([[0, 0], [0.07, 0.02], [0.03, 0.08], [0.09, 0.15], [0.02, 0.24], [0, 0.34]], 8, gold), null, T(0, env.top() - 0.04, 0));
  const tip = [0, env.top() + 0.2, 0];
  for (let s = 0; s < 4; s++) { const a = s * PI / 2 + PI / 4, end = [Math.cos(a) * 1.95, 3.3, Math.sin(a) * 1.95], pts = []; for (let t = 0; t <= 12; t++) { const f = t / 12; pts.push([tip[0] + (end[0] - tip[0]) * f, tip[1] + (end[1] - tip[1]) * f - 0.3 * Math.sin(PI * f), tip[2] + (end[2] - tip[2]) * f]); }
    k.s(sweep(pts, 0.008, 3, 12, ROPE), null); for (let t = 1; t < 12; t++) k.add(t === 6 ? 'owner' : 'cloth', box(0.15, 0.17, 0.008), t === 6 ? WHITE : FL[(t + s) % 6], T(pts[t][0], pts[t][1] - 0.1, pts[t][2], 0, -a + PI / 2, 0)); k.rod('solid', ROPE, end, [Math.cos(a) * 0.66, 0.5, Math.sin(a) * 0.66], 0.008, 3); }
  tub(k, { w: 1.04, d: 1.04, h: 0.46, col: L.wood, th: 0.06, rim: gold });
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); for (let i = 0; i < 4; i++) { const x = -0.33 + i * 0.22, c = FL[(i + s) % 6]; k.s(box(0.16, 0.3, 0.03), sh(L.wood, 0.7), T(x, 0.25, 0.525)); k.s(ball(0.045, 6, 4), c, T(x, 0.3, 0.55)); k.s(rev([[0.06, 0], [0.065, 0.03], [0.035, 0.1], [0, 0.12]], 7, c), null, T(x, 0.14, 0.55)); } k.o(box(0.96, 0.06, 0.014), WHITE, T(0, 0.06, 0.528)); k.pop(); }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { k.m(rev([[0.06, 0], [0.07, 0.5], [0.09, 0.52], [0.05, 0.6], [0.07, 0.64], [0.02, 0.72], [0, 0.8]], 8, gold), null, T(x * 0.52, 0, z * 0.52)); }
  stores(k, L, { w: 1.04, kinds: ['jar', 'sack', 'bale'], bagCol: main, netCol: 0xd8a84a });
};
B.caliphate = (k, L) => { // an ogee dome in bold stripes with a crescent finial, tasselled girdle and carpets over the basket
  const main = L.envelope, gold = L.trim, c2 = L.cloth2, pale = 0xf0e6c8;
  const env = balloon(k, L, { shape: 'dome', env: { gores: 16, per: 4, cy: 3.98 }, band: [0.28, 0.35], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v > 0.9) return gold; if (v > 0.38 && v < 0.46) return (i + Math.floor(v * 80)) & 1 ? c2 : pale; if (v > 0.46 && v < 0.48 || v > 0.36 && v < 0.38) return gold; return g & 1 ? main : pale; }, tapes: 2, tcol: gold, skirt: [c2, gold], rig: { n: 8, ringCol: gold } });
  const ty = env.top(); k.m(rev([[0, 0], [0.1, 0], [0.12, 0.04], [0.04, 0.1], [0.08, 0.18], [0.02, 0.26], [0.015, 0.36]], 10, gold), null, T(0, ty - 0.04, 0)); k.m(torus(0.11, 0.022, 5, 14, PI * 1.5), gold, T(0, ty + 0.4, 0, 0, 0, PI * 0.75));
  for (let i = 0; i < 16; i++) { const p = env.at(i / 16, 0.37, 0.03); tassel(k, p[0], p[1], p[2], i & 1 ? c2 : main, 0.3, gold); }
  for (let i = 0; i < 8; i++) { const u = (i + 0.5) / 8; k.c(disc(env, u, 0.62, 0.028, 0.06, gold, 4, 0.03)); }
  wicker(k, { ex: 4, c1: 0xc8a468, c2: 0xa07c48, rim: gold });
  const carpet = (ry, c) => { k.push(T(0, 0, 0, 0, ry, 0)); k.c(surf(6, 8, (u, v, out) => { const s = v * 0.7; out[0] = (u - 0.5) * 0.6; out[1] = s < 0.14 ? 0.56 : 0.56 - (s - 0.14); out[2] = s < 0.14 ? 0.4 + s : 0.545 + 0.015 * Math.sin(u * 9); }, (u, v, i, j) => (i === 0 || i === 5 || j === 7 ? gold : (i + j) & 1 ? c : sh(c, 0.7)))); k.pop(); };
  carpet(0, c2); carpet(PI, 0x9a2a2a); k.o(box(0.02, 0.26, 0.7), WHITE, T(0.535, 0.26, 0)); k.o(box(0.02, 0.26, 0.7), WHITE, T(-0.535, 0.26, 0));
  stores(k, L, { kinds: ['jar', 'sack', 'jar'], bagCol: 0xd8c08a }); cargo(k, 'jar', -0.6, 0.02, 0.3, 1.2, 0, 0xc8a040); k.s(torus(0.11, 0.01, 4, 10), ROPE, T(-0.6, 0.2, 0.3, PI / 2));
  lantern(k, 0.58, 0.44, -0.4, L.glow, gold, 1.4); flagstaff(k, 0.48, 0.5, 0.48, 0.7, 0.4, { tail: 0, knob: gold });
};
B.khemet = (k, L) => { // a striped royal jar of the dead: blue-and-gold headcloth bands, winged scarab, eye-glow, obelisk posts
  const main = L.envelope, gold = L.trim, blue = 0x1e4a8a, glow = L.glow, wrap = 0xd8ceb0;
  const env = balloon(k, L, { shape: 'jar', env: { gores: 12, per: 5, bulge: 0.02, rows: 44 }, band: [0.22, 0.28], pat: (e) => (u, v, i, j) => (v > 0.7 ? (i % e.per < 2 ? blue : gold) : v > 0.64 ? blue : v < 0.18 ? (j & 1 ? wrap : sh(wrap, 0.8)) : (Math.floor(v * 26) & 1) ? blue : main), tapes: 0, hoops: [[0.655, 0.035, gold], [0.72, 0.03, gold]], skirt: false, rig: { n: 6, ringCol: gold, rope: 0x8a7a5a } });
  for (const u of [0.25, 0.75]) { const p = env.at(u, 0.47, 0.1), d = env.nrm(u, 0.47); k.push(TA(p, d)); k.m(ball(0.2, 10, 8), 0x1a6a6a, T(0, 0, 0, 0, 0, 0, 0.9, 0.45, 1.2)); k.g(ball(0.09, 8, 6), glow, T(0, 0.02, 0.32)); for (const sx of [-1, 1]) for (let f = 0; f < 5; f++) k.c(leaf(0.85 - f * 0.09, 0.2, 0.04, f & 1 ? blue : gold, { nv: 5 }), null, T(sx * 0.1, 0.03 + f * 0.004, 0, -PI / 2, sx * (0.75 - f * 0.26), -sx * PI / 2)); k.pop(); }
  for (const u of [0, 0.5]) { k.g(disc(env, u, 0.5, 0.018, 0.022, glow, 10, 0.04)); k.c(disc(env, u, 0.5, 0.045, 0.03, DARK, 12, 0.03)); k.c(disc(env, u, 0.44, 0.012, 0.04, DARK, 6, 0.03)); }
  k.m(rev([[0, 0], [0.16, 0], [0.12, 0.05], [0.12, 0.1], [0, 0.34]], 4, gold, { rot: PI / 4 }), null, T(0, env.top() - 0.03, 0), true);
  for (let i = 0; i < 9; i++) { const u = i / 9, p = env.at(u, 0.02, 0.02); k.c(surf(1, 5, (uu, v, out) => { out[0] = p[0] + (uu - 0.5) * 0.12 * Math.sin(u * TAU) + 0.05 * Math.sin(v * 4 + i); out[1] = p[1] - v * (0.4 + 0.3 * rnd(i)); out[2] = p[2] - (uu - 0.5) * 0.12 * Math.cos(u * TAU); }, sh(wrap, 0.8 + 0.2 * rnd(i + 3)))); }
  tub(k, { w: 1.04, d: 1.04, h: 0.48, col: main, th: 0.06, rim: gold, r: 0.02 });
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); for (let i = 0; i < 6; i++) k.s(box(0.07, 0.36, 0.012), i & 1 ? blue : 0x1a6a6a, T(-0.375 + i * 0.15, 0.25, 0.526)); k.o(box(0.94, 0.07, 0.014), WHITE, T(0, 0.06, 0.527)); k.pop(); }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { k.s(rev([[0.07, 0], [0.05, 0.72], [0, 0.84]], 4, [0xcfc4a0, gold], { rot: PI / 4 }), null, T(x * 0.52, 0, z * 0.52), true); }
  stores(k, L, { w: 1.04, kinds: ['jar', 'chest', 'jar'], bagCol: wrap, netCol: wrap }); for (let i = 0; i < 3; i++) { cargo(k, 'jar', -0.62, 0.04, -0.22 + i * 0.22, 0.8, 0, [0xd8ceb0, 0x1e4a8a, 0xc8a040][i]); }
  k.s(box(0.2, 0.03, 0.72), sh(main, 0.7), T(-0.62, 0.025, 0)); flagstaff(k, 0.52, 0.84, 0.52, 0.4, 0.4, { tail: 2, len: 0.4, h: 0.22, knob: 0 });
};
B.velikaya = (k, L) => { // an onion dome in barley-twist stripes with a gilt spire, fur at the mouth, a log-built car
  const main = L.envelope, gold = L.trim, pale = L.cloth2, fur = 0xe8e0d0;
  const env = balloon(k, L, { shape: 'onion', env: { gores: 12, per: 5, twist: 0.22, bulge: 0.06, cy: 4.05 }, band: [0.25, 0.32], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v > 0.84) return gold; if (v < 0.08) return sh(main, 0.75); return g % 3 === 0 ? main : g % 3 === 1 ? pale : gold; }, tapes: 0, rig: { n: 8, vr: 0.14, ringCol: gold } });
  const ty = env.top(); k.m(rev([[0, 0], [0.07, 0], [0.1, 0.06], [0.03, 0.12], [0.07, 0.19], [0.02, 0.26], [0.012, 0.44], [0, 0.46]], 10, gold), null, T(0, ty - 0.05, 0)); for (const y of [0.3, 0.38]) k.m(box(y > 0.35 ? 0.1 : 0.16, 0.02, 0.02), gold, T(0, ty + y - 0.05, 0));
  k.s(surf(32, 6, (u, v, out, i, j) => { const p = env.at(u, 0, 0); const a = v * TAU, rr = 0.09 * (1 + 0.35 * rnd(i * 5 + j * 3)); const cxx = p[0] * (1 + rr * Math.cos(a) / 0.42), czz = p[2] * (1 + rr * Math.cos(a) / 0.42); out[0] = cxx; out[1] = p[1] + rr * Math.sin(a); out[2] = czz; }, (u, v, i, j) => sh(fur, 0.82 + 0.22 * rnd(i * 3 + j)), { closeU: true, flip: true }));
  for (let i = 0; i < 6; i++) { const y = 0.05 + i * 0.085, off = i & 1; for (const s of [-1, 1]) { if (off) k.s(cyl(0.048, 0.048, 1.16, 8), sh(L.wood, 0.9 + 0.2 * rnd(i)), T(0, y, s * 0.48, 0, 0, PI / 2)); else k.s(cyl(0.048, 0.048, 1.16, 8), sh(L.wood, 0.9 + 0.2 * rnd(i + 9)), T(s * 0.48, y, 0, PI / 2)); } }
  for (const s of [-1, 1]) { for (let i = 0; i < 6; i++) if (!(i & 1)) { k.s(box(0.96, 0.085, 0.04), sh(L.wood, 0.8), T(0, 0.05 + i * 0.085, s * 0.48)); } else k.s(box(0.04, 0.085, 0.96), sh(L.wood, 0.8), T(s * 0.48, 0.05 + i * 0.085, 0)); }
  k.s(box(1.0, 0.04, 1.0), sh(L.wood, 0.6), T(0, 0.02, 0));
  for (const z of [-1, 1]) { k.s(gable(0.7, 0.2, 0.04), main, T(0, 0.56, z * 0.5)); k.m(ball(0.035, 6, 5), gold, T(0, 0.78, z * 0.5)); k.o(box(0.6, 0.14, 0.014), WHITE, T(0, 0.3, z * 0.535)); }
  for (const x of [-1, 1]) k.c(surf(4, 4, (u, v, out) => { out[0] = x * (0.5 + 0.045 * Math.sin(v * PI)); out[1] = 0.56 - v * 0.34; out[2] = (u - 0.5) * 0.5; }, (u, v, i, j) => sh(0x6a4a32, 0.8 + 0.3 * rnd(i + j * 4))));
  stores(k, L, { kinds: ['barrel', 'sack', 'crate'], bagCol: 0x9a8a6a }); flagstaff(k, 0.48, 0.54, 0.48, 0.8, 0.5, { knob: gold });
};
B.undead = (k, L) => { // a gaunt grey shroud on a cage of ribs with a great skull at the brow, rags trailing; an open coffin below
  const bone = L.trim, glow = L.glow, a = 0x4a4a52, b = 0x36363e;
  const env = balloon(k, L, { env: { gores: 9, per: 6, bulge: 0.09 }, band: [0.26, 0.33], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per), r = rnd(g * 7 + Math.floor(v * 7) * 3); return r > 0.82 ? 0x2a2a30 : r < 0.12 ? 0x5a5a60 : g & 1 ? a : b; }, tapes: 1, tr: 0.04, tcol: bone, tv0: 0.08, tv1: 0.96, bandTrim: bone, mouth: bone, rig: { rope: 0x1e1e22, n: 9, vr: 0.1, ringCol: bone, ringBag: 'solid', postCol: bone, postR: 0.022, posts: [[0.6, 0.3], [0.6, -0.3], [-0.6, 0.3], [-0.6, -0.3]], top: 0.42, burner: 'bowl', burnCol: 0x2a2a2e } });
  for (let g = 0; g < 9; g++) for (let t = 0; t < 6; t++) { const p = env.at(g / 9, 0.14 + t * 0.14, 0.05); k.s(ball(0.065, 6, 5), bone, T(p[0], p[1], p[2])); }
  const p = env.at(0.25, 0.56, -0.1); skull(k, T(p[0], p[1], p[2] + 0.05, 0.1, 0, 0, 1.25), bone, glow);
  for (let i = 0; i < 12; i++) { const u = i / 12, q = env.at(u, 0.01, 0.01), len = 0.5 + 0.7 * rnd(i * 3); k.c(surf(2, 5, (uu, v, out) => { out[0] = q[0] + (uu - 0.5) * 0.3 * Math.sin(u * TAU) * (1 - v * 0.6) + 0.04 * Math.sin(v * 5 + i); out[1] = q[1] - v * len; out[2] = q[2] - (uu - 0.5) * 0.3 * Math.cos(u * TAU) * (1 - v * 0.6); }, i & 1 ? 0x2a2a30 : 0x3a3a42)); }
  k.s(cone(0.1, 0.5, 5), bone, T(0, env.top() + 0.2, 0));
  // the coffin: long hexagon, open
  const cof = [[-0.7, 0.2], [-0.42, 0.37], [0.7, 0.27], [0.7, -0.27], [-0.42, -0.37], [-0.7, -0.2]], wood = 0x2a2420;
  for (let i = 0; i < 6; i++) { const A = cof[i], Bq = cof[(i + 1) % 6], mx = (A[0] + Bq[0]) / 2, mz = (A[1] + Bq[1]) / 2, len = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]), ry = -Math.atan2(Bq[1] - A[1], Bq[0] - A[0]); k.s(rbox(len + 0.03, 0.4, 0.045, 0.012, 1), i & 1 ? wood : sh(wood, 1.25), T(mx, 0.21, mz, 0, ry, 0)); k.s(box(len + 0.05, 0.035, 0.06), bone, T(mx, 0.42, mz, 0, ry, 0)); if (i === 1 || i === 4) k.o(box(len * 0.8, 0.16, 0.012), WHITE, T(mx + (i === 1 ? 0 : 0), 0.2, mz + (i === 1 ? 0.028 : -0.028) * 1, 0, ry, 0)); }
  k.s(new THREE.ExtrudeGeometry(new THREE.Shape(cof.map((q) => new THREE.Vector2(q[0], q[1]))), { depth: 0.04, bevelEnabled: false }), sh(wood, 0.8), T(0, 0.04, 0, PI / 2, 0, 0));
  k.s(rbox(1.2, 0.04, 0.5, 0.012, 1), sh(wood, 1.2), T(-0.05, 0.3, -0.52, 1.2, 0.05, 0)); k.s(box(0.5, 0.03, 0.05), bone, T(-0.2, 0.33, -0.56, 1.2, 0.05, 0)); k.s(box(0.05, 0.03, 0.26), bone, T(-0.3, 0.33, -0.56, 1.2, 0.05, 0));
  skull(k, T(0.74, 0.3, 0, 0, PI / 2, 0, 0.3), bone, glow); lantern(k, -0.76, 0.36, 0, glow, 0x2a2a2e, 1.5);
  for (const [x, z] of [[0.2, 0.38], [-0.2, -0.38], [0.5, -0.33]]) sandbag(k, x, 0.4, z, 0x4a4a52, 0.1, 0x1e1e22);
  cargo(k, 'crate', -0.48, 0.08, 0, 0.9, 0.2, 0x3a3230); cargo(k, 'jar', 0.5, 0.08, 0.08, 0.9, 0, 0x4a4a52); cargo(k, 'sack', 0.48, 0.08, -0.12, 0.8, 0, 0x6a6a66); netbag(k, 0.3, 0.42, 0.42, 0.8, 0x6a6a66, 0x1e1e22);
  pennant(k, 'owner', WHITE, 0, env.top() + 0.36, 0, 0.6, 0.6, 0.22, 1);
};
B.crimson = (k, L) => { // a blood-red heart of silk in black gothic tracery, bat-winged and crowned with iron; a velvet-hung coach car
  const main = L.envelope, blk = 0x141216, gold = L.trim, red = sh(main, 1.5);
  const env = balloon(k, L, { shape: 'heart', env: { gores: 12, per: 6, bulge: 0.06 }, band: [0.24, 0.3], pat: (e) => (u, v, i, j) => { const q = ((i + 0.5) / e.per) % 1, arch = 0.34 + 0.22 * Math.sin(PI * q); if (v > 0.9) return blk; if (v > 0.3 && v < arch) return blk; if (v < 0.07) return blk; return Math.floor(i / e.per) & 1 ? main : red; }, tapes: 1, tcol: blk, tr: 0.018, bandTrim: gold, mouth: blk, rig: { rope: blk, n: 6, ringCol: blk, postCol: blk, postBag: 'metal', postR: 0.02 } });
  studs(k, env, 0.9, 12, 'metal', cone(0.05, 0.5, 5).translate(0, 0.25, 0), blk, { tilt: 2.5 }); k.m(cone(0.08, 0.7, 6), blk, T(0, env.top() + 0.3, 0)); k.g(gem(0.07, 0.2, 6), 0xff2a2a, T(0, env.top() + 0.72, 0), true);
  for (const s of [-1, 1]) { const p = env.at(s > 0 ? 0 : 0.5, 0.6, -0.3); wing(k, T(p[0], p[1] - 0.3, p[2], 0, s > 0 ? 0 : PI, 0.95), 1.35, 1.5, 4, sh(main, 0.6), blk); }
  for (let i = 0; i < 6; i++) { const u = (i + 0.5) / 6; k.g(disc(env, u, 0.26, 0.012, 0.03, 0xff3a2a, 6, 0.035)); }
  tub(k, { w: 1.04, d: 1.04, h: 0.48, col: blk, th: 0.05, rim: gold, r: 0.03 });
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); k.c(surf(10, 3, (u, v, out) => { out[0] = (u - 0.5) * 0.9; out[1] = 0.47 - v * (0.2 + 0.1 * Math.abs(Math.sin(u * PI * 3))); out[2] = 0.53 + 0.02 * Math.sin(u * PI * 10); }, (u, v, i, j) => (j === 2 ? gold : i & 1 ? main : sh(main, 0.75)))); k.o(box(0.8, 0.12, 0.012), WHITE, T(0, 0.1, 0.527)); k.m(cone(0.03, 0.12, 4), gold, T(0, 0.2, 0.54, PI, 0, 0)); k.pop(); }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { k.m(rev([[0.045, 0], [0.04, 0.5], [0.07, 0.54], [0.03, 0.62], [0, 0.8]], 6, blk), null, T(x * 0.5, 0, z * 0.5)); lantern(k, x * 0.62, 0.5, z * 0.5, 0xff3a2a, blk, 1.2); }
  stores(k, L, { w: 1.04, kinds: ['chest', 'jar', 'crate'], bagCol: 0x3a1a1e, netCol: 0x5a2a2e, rope: blk }); k.s(rbox(0.5, 0.16, 0.2, 0.03, 1), 0x2a1a16, T(0, 0.1, 0.3)); k.s(box(0.52, 0.03, 0.22), gold, T(0, 0.19, 0.3));
  flagstaff(k, 0.5, 0.8, 0.5, 0.3, 0.5, { bag: 'metal', col: blk, knob: 0 });
};
B.drowned = (k, L) => { // a pale ghost-jelly of rotten sailcloth trailing weed, lit from within, hauling a wrecked ship's boat on chains
  const main = L.envelope, glow = L.glow, weed = 0x2a5a3a, pale = mix(main, 0x9ad8c0, 0.45), chain = 0x2a3230;
  const env = balloon(k, L, { shape: 'jelly', env: { gores: 12, per: 5, bulge: 0.08, rows: 30 }, band: [0.3, 0.4], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per), r = rnd(g * 3 + Math.floor(v * 9) * 5); return v > 0.85 ? pale : r > 0.85 ? sh(main, 0.6) : r < 0.1 ? mix(main, 0xc8c0a0, 0.5) : g & 1 ? main : mix(main, pale, 0.4); }, tapes: 1, tcol: sh(main, 0.5), tr: 0.02, bandTrim: chain, mouth: false, rig: { rope: chain, bag: 'metal', n: 8, vr: 0.04, r: 0.016, ringCol: chain, postCol: chain, postBag: 'metal', postR: 0.018, posts: [[0.55, 0.28], [0.55, -0.28], [-0.5, 0.3], [-0.5, -0.3]], top: 0.48, burner: 'none' } });
  valance(k, env, 0, 0.5, [main, sh(main, 0.6)], { n: 12, dag: 0.8, pull: 0.1 });
  for (let i = 0; i < 14; i++) { const u = (i + 0.3) / 14, q = env.at(u, 0.0, -0.1), len = 0.9 + 1.0 * rnd(i * 5); if (q[1] - len < 1.3 && Math.hypot(q[0], q[2]) < 0.8) continue; k.c(sweep([q, [q[0] * 0.96 + 0.1 * Math.sin(i), q[1] - len * 0.4, q[2] * 0.96], [q[0] * 0.9, q[1] - len * 0.75, q[2] * 0.9 + 0.12 * Math.cos(i * 2)], [q[0] * 0.88, q[1] - len, q[2] * 0.88]], (v) => 0.05 * (1 - v * 0.85), 4, 9, i % 3 ? weed : sh(pale, 0.9)), null); }
  k.g(ball(0.5, 12, 8), mix(glow, main, 0.35), T(0, 4.2, 0, 0, 0, 0, 1, 0.8, 1)); for (let i = 0; i < 5; i++) k.g(ball(0.09, 8, 6), glow, T(Math.cos(i * 1.257) * 0.7, 3.5 + 0.2 * rnd(i), Math.sin(i * 1.257) * 0.7));
  for (let i = 0; i < 40; i++) { const u = rnd(i * 2.3), v = 0.12 + 0.7 * rnd(i * 5.1 + 1), p = env.at(u, v, 0.0), d = env.nrm(u, v); k.s(cone(0.055, 0.07, 6), 0xb8b8a0, TA(p, d, 0.7 + 0.8 * rnd(i))); }
  k.g(gem(0.12, 0.36, 6), glow, T(0, 1.46, 0), true); k.m(rev([[0, 1.22], [0.08, 1.24], [0.2, 1.34], [0.22, 1.42], [0.19, 1.42], [0.1, 1.33], [0, 1.31]], 10, chain), null); k.m(torus(0.5, 0.012, 4, 20), chain, T(0, 1.38, 0, PI / 2));
  const P = hull(k, { len: 1.5, wid: 0.9, h: 0.5, col: L.wood, strakes: 5, rail: sh(L.wood, 0.5), stern: 0.6 });
  for (let i = 0; i < 6; i++) { const u = 0.14 + i * 0.14; for (const sv of [0.08, 0.92]) { const a = [0, 0, 0], b2 = [0, 0, 0]; P(u, sv, 0.9, a); P(u, 0.5, 0.9, b2); k.s(sweep([a, [a[0], (a[1] + b2[1]) / 2 - 0.08, a[2] * 0.82], b2], 0.022, 4, 6, sh(L.wood, 0.7)), null); } }
  for (let i = 0; i < 16; i++) { const q = [0, 0, 0]; P(rnd(i) * 0.9 + 0.05, rnd(i * 3) * 0.8 + 0.1, 1.01, q); k.s(cone(0.04, 0.05, 5), 0xb8b8a0, T(q[0], q[1], q[2], rnd(i) * 3, 0, rnd(i * 2) * 3)); }
  k.o(surf(10, 1, (u, v, out) => { P(0.25 + u * 0.5, 0.86, 1.015, out); out[1] -= v * 0.13; }, WHITE)); k.o(surf(10, 1, (u, v, out) => { P(0.25 + u * 0.5, 0.14, 1.015, out); out[1] -= v * 0.13; }, WHITE));
  k.rod('metal', chain, [0.8, 0.42, 0], [0.92, -0.25, 0], 0.014, 4); k.m(torus(0.16, 0.028, 5, 12, PI), chain, T(0.92, -0.32, 0, 0, 0, PI)); k.m(cyl(0.025, 0.025, 0.36, 5), chain, T(0.92, -0.18, 0)); k.m(box(0.22, 0.03, 0.03), chain, T(0.92, -0.04, 0));
  cargo(k, 'barrel', -0.36, 0.08, 0.05, 1, 0, 0x3a4a40); cargo(k, 'chest', 0.3, 0.08, -0.05, 1, 0.3, 0x2a3a34); cargo(k, 'crate', 0.05, 0.08, 0.14, 0.8, 0.5, 0x4a5a4a); lantern(k, -0.78, 0.6, 0, glow, chain, 1.5); k.m(sweep([[-0.7, 0.4, 0], [-0.86, 0.55, 0], [-0.78, 0.66, 0]], 0.012, 4, 6, chain), null);
  k.c(surf(4, 5, (u, v, out) => { out[0] = -0.2 + u * 0.5; out[1] = 1.25 - v * 0.6 - 0.1 * u; out[2] = 0.5 + 0.05 * Math.sin(v * 4 + u * 3); }, (u, v, i, j) => ((i + j) % 4 === 3 ? sh(pale, 0.6) : sh(pale, 0.85))));
};
B.infernal = (k, L) => { // a black horned globe split by burning seams, ringed with spikes, hung with chains over a barbed iron cage
  const main = L.envelope, blk = 0x18161a, glow = L.glow, iron = 0x2a2a2e;
  const env = balloon(k, L, { env: { gores: 8, per: 8, bulge: 0.09, cy: 3.95 }, band: [0.26, 0.34], pat: (e) => (u, v, i, j) => { const q = i % e.per, r = rnd(Math.floor(i / 2) * 3 + Math.floor(v * 12) * 7); return q === 0 || q === e.per - 1 ? sh(main, 1.6) : r > 0.8 ? sh(main, 0.8) : (q === 3 || q === 4) ? sh(blk, 1.4) : blk; }, tapes: 0, bandTrim: iron, bandBag: 'metal', mouth: iron, mouthBag: 'metal', rig: { rope: iron, bag: 'metal', n: 8, r: 0.014, ringCol: iron, ringT: 0.04, postR: 0.022, burner: 'none' } });
  for (let g = 0; g < 8; g++) k.tape(env, g / 8, 0.04, 0.95, 0.022, glow, 'glow', 16, 3);
  k.hoop(env, 0.5, 0.06, iron, 'metal', 6); studs(k, env, 0.5, 16, 'metal', cone(0.08, 0.32, 5).translate(0, 0.14, 0), iron, { lift: 0.04 });
  for (const s of [-1, 1]) { const p = env.at(s > 0 ? 0 : 0.5, 0.78, -0.1); k.s(sweep([p, [p[0] + s * 0.45, p[1] + 0.2, 0], [p[0] + s * 0.62, p[1] + 0.55, 0.1], [p[0] + s * 0.4, p[1] + 0.85, 0.2]], (v) => 0.2 * (1 - v * 0.9) + 0.01, 7, 14, (u, v, i, j) => (j & 1 ? 0x2a2220 : 0x3a302c)), null); }
  k.m(rev([[0, 0], [0.3, 0], [0.26, 0.06], [0.1, 0.1], [0, 0.4]], 6, iron), null, T(0, env.top() - 0.04, 0), true);
  { const p = env.at(0.25, 0.6, 0.05); skull(k, T(p[0], p[1], p[2] - 0.12, 0.2, 0, 0, 0.7), 0x3a302c, glow, 1); }
  k.m(rev([[0, 1.2], [0.1, 1.22], [0.24, 1.36], [0.27, 1.5], [0.23, 1.5], [0.12, 1.36], [0, 1.34]], 8, iron), null, null, true); k.g(ball(0.18, 8, 5), glow, T(0, 1.48, 0, 0, 0, 0, 1, 0.4, 1)); for (let i = 0; i < 8; i++) k.m(cone(0.03, 0.14, 4), iron, T(Math.cos(i * PI / 4) * 0.26, 1.56, Math.sin(i * PI / 4) * 0.26));
  // cage car
  k.m(rbox(1.06, 0.07, 1.06, 0.02, 1), iron, T(0, 0.035, 0)); for (const y of [0.3, 0.52]) for (let s = 0; s < 4; s++) k.m(box(1.06, 0.05, 0.05), iron, T(s === 1 ? 0.505 : s === 3 ? -0.505 : 0, y, s === 0 ? 0.505 : s === 2 ? -0.505 : 0, 0, s & 1 ? PI / 2 : 0, 0));
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); for (let i = 0; i < 8; i++) { k.m(cyl(0.016, 0.016, 0.5, 5), iron, T(-0.42 + i * 0.12, 0.28, 0.505)); k.m(cone(0.022, 0.12, 4), iron, T(-0.42 + i * 0.12, 0.6, 0.505)); } k.o(box(0.9, 0.17, 0.016), WHITE, T(0, 0.17, 0.52)); k.m(cone(0.05, 0.3, 5), iron, T(0.5, 0.3, 0.5, PI / 2, 0, -PI / 4)); k.pop(); }
  for (const [x, z] of [[0.3, 0.56], [-0.56, 0.2], [0.56, -0.3]]) sandbag(k, x, 0.5, z, 0x3a2a26, 0.12, iron);
  cargo(k, 'crate', -0.28, 0.07, -0.28, 1.1, 0.2, 0x4a3a34); cargo(k, 'barrel', 0.3, 0.07, -0.3, 1, 0, 0x3a2a26); cargo(k, 'chest', 0.26, 0.07, 0.3, 1, 0.4, 0x2a2224); netbag(k, -0.62, 0.52, -0.2, 0.9, 0x5a3a30, iron);
  for (let i = 0; i < 3; i++) { const a = 1 + i * 2.1, p = env.at(a / TAU, 0.3, 0); k.m(sweep([p, [p[0] * 1.05, p[1] - 0.5, p[2] * 1.05], [p[0] * 1.02, p[1] - 0.9, p[2] * 1.02]], 0.016, 4, 6, iron), null); k.m(cone(0.05, 0.16, 4), iron, T(p[0] * 1.02, p[1] - 0.98, p[2] * 1.02, PI, 0, 0)); }
  flagstaff(k, -0.5, 0.55, 0.5, 0.75, 0.3, { bag: 'metal', col: iron, knob: 0, tail: 1 });
};
B.ironbound = (k, L) => { // an armoured shell of riveted dark-iron plate with a bladed crest and vents; a slit-windowed armoured car
  const main = L.envelope, iron = L.metal, st = sh(iron, 1.9), glow = L.glow, tr = L.trim;
  const env = balloon(k, L, { shape: 'bell', env: { gores: 12, per: 4, bulge: 0.012, rows: 32 }, band: [0.34, 0.45], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per), row = Math.floor(j / 4), pl = (g + row) & 1; return (j % 4 === 0) ? sh(iron, 0.9) : v > 0.9 ? st : pl ? sh(iron, 1.75) : sh(iron, 1.4 + 0.3 * rnd(g + row * 5)); }, tapes: 1, tcol: st, tbag: 'metal', tr: 0.028, bandTrim: tr, bandBag: 'metal', mouth: st, mouthBag: 'metal', rig: { rope: iron, bag: 'metal', n: 6, vr: 0.0, r: 0.02, ringCol: st, ringT: 0.045, postR: 0.03, postCol: st, burnCol: st } });
  k.add('cloth', env.strip(0, 0.1, 0.0, main, 2), null); for (const v of [0.125, 0.25, 0.5, 0.625, 0.75, 0.875]) studs(k, env, v + 0.012, 24, 'metal', ball(0.03, 5, 4), tr, { lift: 0.015, off: 0.5 });
  k.m(surf(12, 3, (u, v, out) => { const a = (u - 0.5) * 2.2, p = env.at(0, 1 - Math.abs(a) * 0.23, 0); const r = Math.hypot(p[0], p[2]) * Math.sign(a); out[0] = r; out[1] = p[1] + v * (0.42 - 0.2 * Math.abs(a)) - 0.03; out[2] = (v === 3 / 3 ? 0 : (1 - v) * 0.05); }, st), null); k.m(surf(12, 3, (u, v, out) => { const a = (u - 0.5) * 2.2, p = env.at(0, 1 - Math.abs(a) * 0.23, 0); const r = Math.hypot(p[0], p[2]) * Math.sign(a); out[0] = r; out[1] = p[1] + v * (0.42 - 0.2 * Math.abs(a)) - 0.03; out[2] = -(1 - v) * 0.05; }, st, { flip: true }), null);
  for (const u of [0.25, 0.75]) { const p = env.at(u, 0.62, 0.02), d = env.nrm(u, 0.62); k.push(TA(p, d)); k.m(cyl(0.24, 0.27, 0.1, 8), st, T()); for (let i = -2; i <= 2; i++) k.g(box(0.3 - Math.abs(i) * 0.05, 0.02, 0.035), glow, T(0, 0.055, i * 0.08)); k.pop(); }
  studs(k, env, 0.27, 6, 'metal', cone(0.07, 0.4, 4).translate(0, 0.2, 0), st, { off: 0.5 });
  tub(k, { w: 1.06, d: 1.06, h: 0.54, th: 0.06, col: sh(iron, 1.6), bag: 'metal', rim: st, r: 0.015 });
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); k.o(box(0.86, 0.14, 0.016), WHITE, T(0, 0.15, 0.537)); for (let i = 0; i < 3; i++) k.s(box(0.2, 0.035, 0.02), DARK, T(-0.28 + i * 0.28, 0.4, 0.535)); for (let i = 0; i < 8; i++) for (const y of [0.05, 0.28, 0.5]) k.m(ball(0.018, 5, 4), tr, T(-0.42 + i * 0.12, y, 0.535)); k.m(cone(0.06, 0.3, 4), st, T(0.53, 0.56, 0.53, 0, 0, 0)); k.m(box(0.1, 0.56, 0.1), iron, T(0.5, 0.28, 0.5)); k.pop(); }
  for (const [x, z] of [[0.3, 0.58], [-0.58, 0.2], [0.58, -0.3], [-0.2, -0.58]]) sandbag(k, x, 0.5, z, 0x4a4640, 0.12, iron);
  cargo(k, 'crate', -0.28, 0.07, -0.28, 1.1, 0.2, 0x4a4640); cargo(k, 'barrel', 0.3, 0.07, -0.3, 1, 0, 0x3a3a40); cargo(k, 'crate', 0.28, 0.07, 0.3, 0.9, 0.4, 0x5a4a3a);
  flagstaff(k, -0.5, 0.56, -0.5, 0.7, 2.6, { bag: 'metal', col: st, tail: 2, len: 0.4, h: 0.3, knob: 0 });
};
B.ashur = (k, L) => { // a stepped ziggurat of bronze-banded cloth, fire-bowls on every terrace, bull horns at the summit
  const main = L.envelope, br = L.trim, glow = L.glow, blue = 0x2a5a8a, clay = mix(main, 0xc89a6a, 0.35);
  const env = balloon(k, L, { shape: 'zig', env: { gores: 4, per: 12, bulge: 0, ex: 7, rows: 40, cy: 4.1 }, band: [0.12, 0.2], pat: (e) => (u, v, i, j) => { const tier = v < 0.1 ? 0 : Math.floor((v - 0.1) / 0.2), tv = ((v - 0.1) / 0.2) % 1; if (v < 0.1) return sh(main, 0.7); if (tv > 0.86 || v > 0.92) return br; if (tv > 0.6 && tv < 0.75) return (i & 1) ? blue : 0xd8c08a; return (i % 3 === 0) ? sh(tier & 1 ? clay : main, 0.8) : tier & 1 ? clay : main; }, tapes: 0, bandTrim: br, bandBag: 'metal', mouth: br, mouthBag: 'metal', rig: { rope: 0x2a2220, bag: 'metal', n: 4, off: 0.5, vr: 0.1, r: 0.016, ringCol: br, postCol: br, postBag: 'metal', postR: 0.022 } });
  for (let t = 0; t < 4; t++) for (let c = 0; c < 4; c++) { const p = env.at((c + 0.5) / 4, 0.1 + t * 0.2 + 0.19, 0.0), s = 1 - t * 0.15; k.m(rev([[0.03, -0.02], [0.05, 0.02], [0.1, 0.1], [0.08, 0.1], [0, 0.06]], 7, br), null, T(p[0] * 0.97, p[1] + 0.03, p[2] * 0.97, 0, 0, 0, s)); k.g(cone(0.07, 0.2, 5), glow, T(p[0] * 0.97, p[1] + 0.2 * s, p[2] * 0.97, 0, 0, 0, s)); }
  const ty = env.top(); k.m(rbox(0.36, 0.14, 0.36, 0.02, 1), br, T(0, ty + 0.06, 0)); for (const s of [-1, 1]) k.s(sweep([[s * 0.12, ty + 0.1, 0], [s * 0.42, ty + 0.16, 0], [s * 0.52, ty + 0.5, 0], [s * 0.34, ty + 0.72, 0]], (v) => 0.08 * (1 - v * 0.85) + 0.006, 6, 10, 0xe0d4b0), null);
  k.g(ball(0.09, 8, 6), glow, T(0, ty + 0.2, 0));
  for (let c = 0; c < 4; c++) { const u = c / 4, p = env.at(u, 0.2, 0.03), d = env.nrm(u, 0.2); k.push(TA(p, d)); k.m(cyl(0.16, 0.16, 0.03, 12), br, T()); k.m(cone(0.05, 0.08, 6), sh(br, 1.2), T(0, 0.04, 0)); k.pop(); }
  k.m(rev([[0.36, 0], [0.5, 0.02], [0.5, 0.14], [0.54, 0.16], [0.54, 0.3], [0.58, 0.32], [0.58, 0.5], [0.52, 0.5], [0.52, 0.06], [0, 0.05]], 24, [br, sh(main, 1.2), br, main, br, sh(main, 1.2), br, sh(br, 0.5), sh(br, 0.5)], { ex: 8, rot: 0 }), null);
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); k.o(box(0.86, 0.13, 0.014), WHITE, T(0, 0.41, 0.585)); k.m(cone(0.04, 0.12, 4), br, T(0.56, 0.56, 0.56)); k.pop(); }
  for (const [x, z] of [[0.3, 0.62], [-0.62, 0.2], [0.62, -0.3], [-0.2, -0.62]]) sandbag(k, x, 0.5, z, 0x8a5a3a, 0.12);
  cargo(k, 'jar', -0.28, 0.07, -0.28, 1.1, 0, 0x8a4a2a); cargo(k, 'crate', 0.3, 0.07, -0.3, 1, 0.2, 0x6a4a3a); cargo(k, 'jar', 0.28, 0.07, 0.3, 0.9, 0, 0x2a5a8a); netbag(k, -0.68, 0.5, -0.2, 0.9, 0x8a6a4a);
  flagstaff(k, -0.52, 0.5, 0.52, 0.8, 0.3, { bag: 'metal', col: br, tail: 2, len: 0.36, h: 0.3 });
};
B.goblin = (k, L) => { // a lopsided bladder of mismatched patches with a second bag bodged on, a wonky plank crate and a ladder
  const main = L.envelope, cols = [main, L.cloth2, L.trim, 0x8a3a2a, 0x4a6a6a, 0xb8a060, sh(main, 0.7)];
  const wob = (u, v) => 1 + 0.07 * Math.sin(u * TAU * 2 + v * 5) + 0.05 * Math.sin(u * TAU * 3 - v * 9 + 1) + 0.12 * Math.max(0, Math.sin(u * TAU + 0.6)) * Math.sin(PI * v);
  const env = balloon(k, L, { env: { gores: 9, per: 6, bulge: 0.07, wob, sz: 0.94 }, band: [0.3, 0.38], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per), a = Math.floor((i + g * 2) / 4), b = Math.floor((j + g * 3) / 5); return cols[Math.floor(rnd(a * 5.3 + b * 9.1) * 7)]; }, tapes: 3, bandTrim: false, rig: { n: 7, vr: 0.22, ringCol: 0x6a5234, ringBag: 'solid', ringT: 0.04, posts: [[-0.44, -0.46], [0.5, -0.44], [-0.47, 0.48], [0.45, 0.5]], top: 0.5, burnCol: 0x6a5a48 } });
  const e2 = mkEnv({ prof: PROF.globe, gores: 6, per: 4, rows: 16, bulge: 0.08, s: 0.42, cx: 1.25, cy: 5.25, cz: 0.6 }); k.c(e2.geo((u, v, i, j) => cols[(Math.floor(i / 4) * 3 + Math.floor(j / 6)) % 7])); for (let i = 0; i < 6; i += 2) k.tape(e2, i / 6, 0.05, 0.95, 0.01, ROPE, 'solid', 8); k.rod('solid', ROPE, e2.at(0, 0), env.at(0.07, 0.62), 0.012, 4);
  for (let i = 0; i < 14; i++) { const u = rnd(i * 3.7), v = 0.2 + 0.6 * rnd(i * 1.9 + 4), p = env.at(u, v, 0.03), d = env.nrm(u, v); k.c(rbox(0.36, 0.012, 0.3, 0.005, 1), cols[(i * 3 + 1) % 7], TA(p, d, 0.8 + 0.5 * rnd(i)), false); for (let q = 0; q < 4; q++) k.s(box(0.06, 0.02, 0.015), 0x1a1a1a, TA(env.at(u + (q < 2 ? -0.02 : 0.02), v + (q & 1 ? 0.03 : -0.03), 0.04), d)); }
  { const p = env.at(0.6, 0.55, 0.04), d = env.nrm(0.6, 0.55); k.push(TA(p, d)); for (let i = 0; i < 3; i++) k.s(box(0.5, 0.03, 0.13), sh(L.wood, 0.8 + i * 0.15), T(0, 0, -0.14 + i * 0.14, 0, 0.1 * i, 0)); k.pop(); }
  k.m(cone(0.2, 0.2, 7), 0x6a5a48, T(0.05, env.top() + 0.05, 0, 0, 0, 0.2)); k.m(cyl(0.03, 0.03, 0.3, 5), 0x6a5a48, T(0.1, env.top() + 0.2, 0, 0, 0, 0.3));
  k.push(T(0, 0, 0, 0, 0.06, 0.035)); tub(k, { w: 1.02, d: 1.0, h: 0.5, col: L.wood, planks: 5, th: 0.045 }); k.pop();
  for (let i = 0; i < 4; i++) k.m(box(0.34, 0.2, 0.02), [0x6a5a48, 0x8a5a2a, 0x5a5a60, 0x7a6a50][i], T(i & 1 ? (i === 1 ? 0.53 : -0.53) : 0.1, 0.2 + 0.1 * rnd(i), i & 1 ? 0.1 : i === 0 ? 0.52 : -0.52, 0, i & 1 ? PI / 2 : 0, 0.2 - 0.15 * i));
  k.o(box(0.5, 0.2, 0.02), WHITE, T(-0.2, 0.3, 0.535, 0, 0, -0.08)); k.o(box(0.5, 0.2, 0.02), WHITE, T(0.2, 0.28, -0.53, 0, 0, 0.1));
  for (const x of [-0.14, 0.14]) k.rod('solid', L.wood, [0.6 + x * 0, 0.55, x], [0.72, -0.5, x], 0.016, 4); for (let i = 0; i < 5; i++) k.rod('solid', L.wood, [0.61 + i * 0.024, 0.4 - i * 0.2, -0.16], [0.61 + i * 0.024, 0.4 - i * 0.2, 0.16], 0.014, 4);
  stores(k, L, { kinds: ['crate', 'sack', 'barrel'], bagCol: 0x7a7a4a, netCol: 0x8a7a5a }); k.m(sweep([[-0.5, 0.4, 0.3], [-0.6, 0.0, 0.34], [-0.62, -0.3, 0.3], [-0.52, -0.38, 0.3], [-0.46, -0.28, 0.3]], 0.016, 4, 10, 0x4a4a50), null);
  k.rod('solid', L.wood, [-0.48, 0.5, -0.46], [-0.6, 1.25, -0.52], 0.016, 4); pennant(k, 'owner', WHITE, -0.6, 1.14, -0.52, 2.6, 0.5, 0.24, 1);
};
B.skar = (k, L) => { // a cluster of sickly gas-bladders piped to a brass still that crackles green; a stave tub hung with gears and tails of cable
  const main = L.envelope, brass = 0xa8853a, glow = 0x7aff5a, cols = [main, sh(main, 0.75), mix(main, 0xc8b070, 0.4), L.cloth2, 0x6a5a4a];
  const bags = [[0, 4.5, 0, 0.62, 9], [1.02, 3.9, 0.45, 0.42, 7], [-0.95, 4.0, 0.55, 0.45, 7], [-0.5, 3.85, -0.95, 0.4, 6], [0.75, 4.05, -0.85, 0.42, 7]];
  bags.forEach(([x, y, z, s, g], bi) => {
    const e = mkEnv({ prof: PROF.globe, gores: g, per: bi ? 4 : 6, rows: bi ? 20 : 32, bulge: 0.08, s, cx: x, cy: y + 0.3, cz: z, wob: (u, v) => 1 + 0.06 * Math.sin(u * TAU * 2 + bi) });
    k.c(e.geo((u, v, i, j) => { const a = Math.floor(i / (bi ? 4 : 3)), b = Math.floor(j / 5); return v < 0.08 ? brass : cols[Math.floor(rnd(a * 3.1 + b * 7.7 + bi) * 5)]; }));
    for (let i = 0; i < g; i += bi ? 2 : 1) k.tape(e, i / g, 0.04, 0.97, 0.012, ROPE, 'solid', 8);
    if (!bi) { k.o(e.strip(0.34, 0.44, 0.02, WHITE, 2)); k.m(cone(0.04, 0.5, 5), brass, T(x, e.top() + 0.2, z)); k.g(ball(0.06, 6, 5), glow, T(x, e.top() + 0.48, z)); }
    else k.o(e.strip(0.4, 0.5, 0.015, WHITE, 1));
    const m = e.at(0, 0); k.m(cyl(0.45 * s, 0.4 * s, 0.1, 8), brass, T(x, m[1] - 0.03, z));
    k.m(sweep([[x, m[1] - 0.05, z], [x * 0.8, m[1] - 0.5 - (bi ? 0 : 0.3), z * 0.8], [x * 0.25, 2.0, z * 0.25], [x * 0.1, 1.75, z * 0.1]], 0.035, 5, 10, (u, v, i, j) => (j % 3 === 0 ? sh(brass, 0.6) : brass)), null);
    for (let q = 0; q < 3; q++) { const a = q * 2.094 + bi, p = e.at(a / TAU, 0.25, 0.01); k.rod('solid', ROPE, p, [Math.cos(a) * 0.5 * 0 + Math.cos(Math.atan2(z, x) + (q - 1) * 0.5) * 0.5, 1.38, Math.sin(Math.atan2(z, x) + (q - 1) * 0.5) * 0.5], 0.009, 3); }
  });
  k.m(torus(0.5, 0.035, 6, 20), brass, T(0, 1.38, 0, PI / 2)); for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) k.rod('solid', ROPE, [x, 0.5, z], [x * 0.78, 1.38, z * 0.78], 0.016, 4);
  k.m(rev([[0, 1.2], [0.12, 1.2], [0.2, 1.3], [0.2, 1.5], [0.1, 1.6], [0.06, 1.62], [0, 1.6]], 10, [brass, sh(brass, 0.7), brass, sh(brass, 1.2), brass, DARK]), null); k.g(cyl(0.05, 0.05, 0.24, 6), glow, T(0.24, 1.42, 0)); k.m(torus(0.055, 0.012, 4, 8), brass, T(0.24, 1.3, 0, PI / 2)); k.m(torus(0.055, 0.012, 4, 8), brass, T(0.24, 1.54, 0, PI / 2));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; k.s(rbox(0.26, 0.5, 0.045, 0.012, 1), sh(L.wood, 0.8 + 0.35 * rnd(i)), T(Math.cos(a) * 0.5, 0.25 + 0.03 * rnd(i * 3), Math.sin(a) * 0.5, 0, PI / 2 - a, 0)); }
  for (const y of [0.1, 0.4]) k.m(torus(0.53, 0.02, 4, 24), 0x5a4a3a, T(0, y, 0, PI / 2)); k.s(cyl(0.5, 0.5, 0.05, 16), sh(L.wood, 0.6), T(0, 0.025, 0));
  k.o(surf(20, 1, (u, v, out) => { const a = u * TAU; out[0] = Math.cos(a) * 0.545; out[1] = 0.18 + v * 0.14; out[2] = Math.sin(a) * 0.545; }, (u, v, i) => (i % 5 === 0 ? 0xb0b0b0 : WHITE), { closeU: true }));
  const gear = (x, y, z, r, ry) => { k.push(T(x, y, z, 0, ry, 0)); k.m(cyl(r, r, 0.03, 12), brass, T(0, 0, 0, PI / 2)); for (let i = 0; i < 8; i++) k.m(box(r * 0.3, r * 0.34, 0.03), brass, T(Math.cos(i * PI / 4) * r, Math.sin(i * PI / 4) * r, 0, 0, 0, i * PI / 4 + PI / 2)); k.m(cyl(r * 0.25, r * 0.25, 0.05, 6), 0x4a3a2a, T(0, 0, 0, PI / 2)); k.pop(); };
  gear(0.2, 0.3, 0.57, 0.13, 0.35); gear(-0.03, 0.22, 0.59, 0.08, 0); gear(-0.56, 0.3, 0.1, 0.12, -PI / 2 + 0.2);
  for (let i = 0; i < 3; i++) { const a = 3.6 + i * 0.5; k.s(sweep([[Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5], [Math.cos(a) * 0.75, -0.2, Math.sin(a) * 0.75], [Math.cos(a + 0.3) * 0.8, -0.6, Math.sin(a + 0.3) * 0.8], [Math.cos(a + 0.1) * 0.7, -0.95 + 0.1 * i, Math.sin(a + 0.1) * 0.7]], (v) => 0.03 * (1 - v * 0.7), 4, 10, 0xb88a7a), null); }
  for (const a of [0.6, 2.2, 5.2]) sandbag(k, Math.cos(a) * 0.58, 0.48, Math.sin(a) * 0.58, 0x7a7a4a, 0.12); netbag(k, 0.64, 0.5, -0.24, 0.9, 0x8a8a5a);
  cargo(k, 'crate', -0.2, 0.06, -0.22, 1, 0.3); cargo(k, 'barrel', 0.24, 0.06, -0.18, 0.95, 0, 0x5a6a3a); cargo(k, 'sack', 0.2, 0.06, 0.26); k.g(cyl(0.035, 0.035, 0.16, 6), glow, T(-0.26, 0.14, 0.24)); k.m(cyl(0.04, 0.04, 0.03, 6), brass, T(-0.26, 0.23, 0.24));
  k.rod('solid', L.wood, [-0.46, 0.5, -0.2], [-0.6, 1.2, -0.3], 0.014, 4); pennant(k, 'owner', WHITE, -0.6, 1.1, -0.3, 3.4, 0.5, 0.22, 1);
};

// ---- the savage peoples: hide, bone, sinew, wicker ---------------------------------------------
const SINEW = 0x4a3424;
/** a hide-bound wicker basket with tusk or bone posts at the corners */
function hideBasket(k, L, o = {}) {
  const hide = o.hide ?? L.hide ?? 0x7a5a40;
  wicker(k, { ex: o.ex ?? 2.4, w: 1.06, d: 1.06, c1: o.c1 ?? 0xa88448, c2: o.c2 ?? 0x7a5c34, rim: sh(hide, 0.7), nu: 48, ...o.wk });
  k.s(surf(32, 2, (u, v, out, i, j) => { const a = u * TAU, r = 0.52 + 0.03 * v + 0.012 * Math.sin(i * 2.4); out[0] = Math.cos(a) * r; out[1] = 0.1 + v * 0.16 + 0.03 * Math.sin(i * 1.3) * (j === 2 ? 1 : 0); out[2] = Math.sin(a) * r; }, (u, v, i) => sh(hide, 0.85 + 0.25 * rnd(Math.floor(i / 4))), { closeU: true }));
  k.o(surf(32, 1, (u, v, out, i) => { const a = u * TAU, r = 0.562 + 0.012 * Math.sin(i * 2.4); out[0] = Math.cos(a) * r; out[1] = 0.3 + v * 0.1 + 0.02 * Math.sin(i * 1.7); out[2] = Math.sin(a) * r; }, (u, v, i) => (i % 4 === 0 ? 0xb0b0b0 : WHITE), { closeU: true }));
  if (o.posts !== false) for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4, x = Math.cos(a) * 0.55, z = Math.sin(a) * 0.55; k.s(sweep([[x * 0.95, 0.05, z * 0.95], [x * 1.12, 0.4, z * 1.12], [x * 1.05, 0.78, z * 1.05]], (v) => 0.05 * (1 - v * 0.7) + 0.008, 6, 8, o.post ?? BONE), null); }
}
function savageStores(k, L, o = {}) {
  const hide = L.hide ?? 0x7a5a40, rope = SINEW;
  for (const a of [0.2, 1.9, 3.3, 5.0]) sandbag(k, Math.cos(a) * 0.6, 0.47, Math.sin(a) * 0.6, o.bag ?? sh(hide, 1.1), 0.12, rope);
  netbag(k, Math.cos(2.6) * 0.66, 0.5, Math.sin(2.6) * 0.66, 0.9, o.net ?? 0xa89878, rope); netbag(k, Math.cos(5.9) * 0.66, 0.5, Math.sin(5.9) * 0.66, 0.75, sh(hide, 1.2), rope);
  cargo(k, 'sack', -0.24, 0.05, -0.22, 1.1, 0, sh(hide, 1.25)); cargo(k, 'jar', 0.26, 0.05, -0.2, 1, 0, o.jar ?? 0x8a5a3a); cargo(k, 'bundle', 0.2, 0.05, 0.28, 1, 0.5, sh(hide, 0.9)); cargo(k, 'sack', -0.28, 0.05, 0.22, 0.85, 1);
}
const hidePat = (hide, n = 6) => (e) => (u, v, i, j) => { const g = Math.floor(i / e.per), a = Math.floor((j + g * 4) / n); return (i % e.per === 0) ? sh(hide, 0.6) : sh(hide, 0.82 + 0.4 * rnd(g * 3.3 + a * 5.1)); };
const savRig = (o = {}) => ({ rope: SINEW, n: 7, ringCol: 0x5a4026, ringBag: 'solid', ringT: 0.04, postR: 0.014, posts: [0, 1, 2, 3].map((i) => [Math.cos(i * PI / 2 + PI / 4) * 0.58, Math.sin(i * PI / 2 + PI / 4) * 0.58]), top: 0.76, ...o });
function ownerHide(k, env, u, v, s = 1) { // a painted hide panel in the side's colour, pegged to the envelope
  k.o(disc(env, u, v, 0.075 * s, 0.13 * s, (uu, vv, i, j) => (j === 2 ? 0xb8b8b8 : WHITE), 9, 0.035));
}

B.beasts = (k, L) => { // a stitched hide bladder in a sinew net, ribbed with great bones, a horned skull at the brow
  const hide = L.hide ?? 0x6a4a32;
  const env = balloon(k, L, { env: { gores: 7, per: 8, bulge: 0.08, sz: 0.94, wob: (u, v) => 1 + 0.04 * Math.sin(u * TAU * 3 + v * 6) }, band: [0.26, 0.34], pat: hidePat(hide), tapes: 0, bandTrim: SINEW, rig: savRig() });
  for (let i = 0; i < 7; i++) for (const dir of [-1, 1]) { const pts = []; for (let t = 0; t <= 8; t++) pts.push(env.at(i / 7 + dir * 0.28 * (t / 8), 0.2 + 0.72 * (t / 8), 0.015)); k.s(sweep(pts, 0.012, 3, 8, SINEW), null); }
  for (let g = 0; g < 7; g++) { const pts = []; for (let t = 0; t <= 8; t++) pts.push(env.at(g / 7, 0.42 + 0.5 * (t / 8), 0.05)); k.s(sweep(pts, (v) => 0.06 * (1 - v * 0.7) + 0.01, 5, 10, BONE), null); k.s(ball(0.08, 6, 5), BONE, T(...pts[0])); }
  { const p = env.at(0.25, 0.55, 0.0); skull(k, T(p[0], p[1], p[2] - 0.05, 0.15, 0, 0, 0.95), BONE, null, 1); }
  studs(k, env, 0.26, 14, 'solid', cone(0.045, 0.4, 5).translate(0, 0.2, 0), BONE, { tilt: -100, lift: 0.02 });
  k.s(cone(0.14, 0.2, 7), sh(hide, 0.7), T(0, env.top() + 0.06, 0)); for (let i = 0; i < 5; i++) k.c(leaf(0.5, 0.09, 0.5, i & 1 ? 0x8a2a1a : 0x2a2a2a, { nv: 5 }), null, T(0, env.top() + 0.1, 0, 0.2, i * 1.257, 0));
  hideBasket(k, L); savageStores(k, L); skull(k, T(0, 0.3, 0.6, 0, 0, 0, 0.26), BONE, null, 1);
  flagstaff(k, -0.42, 0.5, -0.42, 0.9, 3.9, { knob: 0, tail: 1, col: 0x4a3424 });
};
B.dragons = (k, L) => { // a scaled, long-bodied envelope with a spined crest and two great membrane wings; a rib-and-hide car under a drake skull
  const hide = L.hide ?? 0x8a3a2a, belly = mix(hide, 0xe0b060, 0.5);
  const env = balloon(k, L, { env: { gores: 10, per: 6, bulge: 0.04, sx: 1.12, sz: 0.86 }, band: [0.24, 0.31], pat: (e) => (u, v, i, j) => { const sc = ((i + (j & 1) * 1) >> 1) + j * 31; if (Math.abs(u - 0.75) < 0.07 || Math.abs(u - 0.25) < 0.07) return j & 1 ? belly : sh(belly, 0.85); return ((i + (j & 1)) & 1) ? sh(hide, 0.75 + 0.4 * rnd(sc)) : sh(hide, 0.6); }, tapes: 0, bandTrim: SINEW, rig: savRig({ n: 8 }) });
  for (let t = 0; t < 11; t++) { const a = (t / 10 - 0.5) * 2.5, v = 1 - Math.abs(a) * 0.3, u = a > 0 ? 0 : 0.5, p = env.at(u, v, 0.0), h = 0.5 - 0.22 * Math.abs(a); k.s(cone(0.1, h, 4), sh(hide, 0.5), T(p[0], p[1] + h * 0.4 * Math.cos(a * 0.6), p[2], 0, 0, -a * 0.55, 1, 1, 0.45)); }
  for (const s of [-1, 1]) { const p = env.at(s > 0 ? 0.25 : 0.75, 0.47, -0.2); wing(k, T(p[0] + 0.2, p[1] - 0.1, p[2], 0, s > 0 ? -2.5 : 2.5, 0.3), 1.35, 1.5, 4, mix(hide, 0xd8a050, 0.35), sh(hide, 0.45)); }
  { const p = env.at(0, 0.5, 0); k.s(sweep([p, [p[0] + 0.12, p[1] - 0.5, 0], [p[0] - 0.05, p[1] - 1.1, 0.1], [p[0] + 0.1, p[1] - 1.5, 0]], (v) => 0.12 * (1 - v * 0.9) + 0.01, 6, 12, hide), null); k.s(cone(0.1, 0.24, 3), sh(hide, 0.5), T(p[0] + 0.12, p[1] - 1.6, 0, PI, 0, 0, 1, 1, 0.3)); }
  hideBasket(k, L, { hide, post: sh(BONE, 0.9) });
  for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.52; k.s(sweep([[Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3], [Math.cos(a) * 0.6, 0.05, Math.sin(a) * 0.6], [Math.cos(a) * 0.68, 0.36, Math.sin(a) * 0.68], [Math.cos(a) * 0.56, 0.62, Math.sin(a) * 0.56]], 0.022, 4, 8, BONE), null); }
  k.push(T(0, 0.34, -0.66, 0, PI, 0, 0.42)); k.s(ball(0.4, 10, 8), BONE, T(0, 0, 0, 0, 0, 0, 0.8, 0.7, 1.1)); k.s(rbox(0.36, 0.26, 0.7, 0.08, 2), BONE, T(0, -0.08, 0.6)); k.s(box(0.3, 0.06, 0.6), sh(BONE, 0.6), T(0, -0.26, 0.55)); for (const x of [-1, 1]) { k.s(ball(0.09, 6, 5), DARK, T(x * 0.2, 0.06, 0.3)); k.s(sweep([[x * 0.2, 0.2, -0.1], [x * 0.35, 0.5, -0.4], [x * 0.3, 0.7, -0.8]], (v) => 0.08 * (1 - v * 0.8), 5, 8, sh(BONE, 0.85)), null); for (let t = 0; t < 4; t++) k.s(cone(0.03, 0.12, 4), BONE, T(x * 0.15, -0.26, 0.4 + t * 0.14, PI, 0, 0)); } k.pop();
  savageStores(k, L, { bag: 0x8a5a3a }); flagstaff(k, 0.42, 0.5, 0.42, 0.9, 0.7, { knob: 0, tail: 1, col: 0x4a3424 });
};
B.cloven = (k, L) => { // a dark hide bladder between two great curling ram-horns, hung with hooves and charms; a herd-totem on the basket
  const hide = L.hide ?? 0x3a2a22;
  const env = balloon(k, L, { env: { gores: 8, per: 6, bulge: 0.07, wob: (u, v) => 1 + 0.03 * Math.sin(u * TAU * 4 + v * 7) }, band: [0.27, 0.35], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v > 0.56 && v < 0.6) return 0x8a2a1a; if (v > 0.6 && v < 0.7 && ((i + 1) % e.per < 2)) return 0xd8c8a0; return hidePat(hide, 7)(e)(u, v, i, j); }, tapes: 2, tcol: SINEW, tr: 0.016, bandTrim: SINEW, rig: savRig({ n: 8 }) });
  for (const s of [-1, 1]) { const p = env.at(s > 0 ? 0 : 0.5, 0.74, -0.15), pts = []; for (let t = 0; t <= 14; t++) { const a = (t / 14) * PI * 2.3, r = 0.62 - 0.33 * (t / 14); pts.push([p[0] + s * (0.36 + 0.2 * (t / 14) + (r * Math.sin(a)) * 0.55), p[1] + 0.1 + r * Math.cos(a) - 0.62, p[2] + 0.1 + r * Math.sin(a) * 0.8]); } k.s(sweep(pts, (v) => 0.24 * (1 - v * 0.85) + 0.01, 8, 34, (u, v, i, j) => (j & 1 ? 0x6a5a48 : 0x8a7a60)), null); }
  { const p = env.at(0.25, 0.5, 0.02); skull(k, T(p[0], p[1], p[2] - 0.08, 0.1, 0, 0, 0.6), BONE, null, 0); }
  for (let i = 0; i < 16; i++) { const p = env.at(i / 16, 0.27, 0.02); k.rod('solid', SINEW, p, [p[0], p[1] - 0.22, p[2]], 0.007, 3); k.s(i & 1 ? cone(0.04, 0.1, 5) : ball(0.035, 6, 5), i & 1 ? 0x2a2220 : BONE, T(p[0], p[1] - 0.26, p[2], i & 1 ? PI : 0, 0, 0)); }
  k.s(cone(0.16, 0.24, 7), sh(hide, 0.7), T(0, env.top() + 0.06, 0));
  hideBasket(k, L, { post: 0x7a6a54 }); savageStores(k, L);
  k.s(cyl(0.035, 0.045, 1.5, 6), 0x4a3424, T(-0.42, 1.1, -0.42)); skull(k, T(-0.42, 1.92, -0.42, 0, 2.4, 0, 0.22), BONE, null, 1); k.s(box(0.5, 0.03, 0.03), 0x4a3424, T(-0.42, 1.62, -0.42, 0, 0.8, 0)); pennant(k, 'owner', WHITE, -0.42, 1.38, -0.42, 0.8, 0.26, 0.5, 2); pennant(k, 'owner', WHITE, -0.42, 1.38, -0.42, 0.8 + PI, 0.26, 0.5, 2);
};
B.fimbul = (k, L) => { // a pale sealskin globe painted with frost-knots, bearded with icicles and cradled on four mammoth tusks; fur-rimmed
  const hide = L.hide ?? 0xb8b0a0, ice = 0xbfe6f4, paint = 0x2a4a7a, fur = 0xe8e4dc;
  const env = balloon(k, L, { shape: 'barrel', env: { gores: 10, per: 6, bulge: 0.05, cy: 4.1 }, band: [0.3, 0.38], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per), q = i % e.per; if (v > 0.52 && v < 0.64) return ((q + Math.floor((v - 0.52) / 0.03)) % 3 === 0) ? paint : sh(hide, 1.05); if (v > 0.64 && v < 0.67 || v > 0.49 && v < 0.52) return paint; if (v > 0.9) return fur; return q === 0 ? sh(hide, 0.7) : sh(hide, 0.9 + 0.15 * rnd(g * 3 + Math.floor(j / 6))); }, tapes: 0, bandTrim: SINEW, rig: savRig({ n: 5, vr: 0.1, posts: [] }) });
  studs(k, env, 0.3, 30, 'solid', cone(0.05, 0.6, 5).translate(0, 0.3, 0), (i) => (i & 1 ? ice : 0xe8f6ff), { tilt: -100, lift: 0.0, s: 1 }); studs(k, env, 0.3, 30, 'solid', cone(0.035, 0.34, 4).translate(0, 0.17, 0), ice, { tilt: -100, off: 0.5 });
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4, p = env.at(a / TAU, 0.2, 0.06); k.s(sweep([[Math.cos(a) * 0.52, 0.2, Math.sin(a) * 0.52], [Math.cos(a) * 1.0, 0.8, Math.sin(a) * 1.0], [Math.cos(a) * 1.35, 1.9, Math.sin(a) * 1.35], [p[0], p[1], p[2]], env.at(a / TAU, 0.34, 0.08)], (v) => 0.085 * (1 - v * 0.8) + 0.012, 7, 20, (u, v, ii, j) => (j % 5 === 0 ? sh(BONE, 0.8) : BONE)), null); }
  k.s(surf(24, 5, (u, v, out, i, j) => { const a = u * TAU, t = v * TAU, rr = 0.1 * (1 + 0.4 * rnd(i * 5 + j * 3)); out[0] = Math.cos(a) * (0.4 + rr * Math.cos(t)); out[1] = env.top() + rr * Math.sin(t); out[2] = Math.sin(a) * (0.4 + rr * Math.cos(t)); }, (u, v, i, j) => sh(fur, 0.8 + 0.2 * rnd(i + j * 7)), { closeU: true, flip: true }));
  hideBasket(k, L, { hide: 0x8a7a68, posts: false });
  k.s(surf(28, 6, (u, v, out, i, j) => { const a = u * TAU, t = v * TAU, rr = 0.075 * (1 + 0.45 * rnd(i * 5 + j * 3)); out[0] = Math.cos(a) * (0.54 + rr * Math.cos(t)); out[1] = 0.5 + rr * Math.sin(t); out[2] = Math.sin(a) * (0.54 + rr * Math.cos(t)); }, (u, v, i, j) => sh(fur, 0.8 + 0.2 * rnd(i * 3 + j)), { closeU: true, flip: true }));
  for (let i = 0; i < 4; i++) { const a = i * PI / 2; roundShield(k, Math.cos(a) * 0.6, 0.26, Math.sin(a) * 0.6, PI / 2 - a, 0.15, i & 1 ? paint : null, 0x6a5a48); }
  savageStores(k, L, { bag: 0x9a8a78 }); flagstaff(k, 0.3, 0.5, -0.45, 1.0, -0.7, { knob: 0, tail: 1, col: 0x4a3424 });
};
B.gorge = (k, L) => { // a felt tent of a balloon: lattice-banded walls, a smoke-wheel crown, horsehair standards; a rug-hung round basket
  const hide = L.hide ?? 0x4a3a2c, felt = 0xd8ceb4, red = 0x9a2a1e, hair = 0x1e1a18;
  const env = balloon(k, L, { shape: 'yurt', env: { gores: 12, per: 5, bulge: 0.02, rows: 40 }, band: [0.4, 0.48], pat: (e) => (u, v, i, j) => { if (v > 0.2 && v < 0.36) return ((i + j) % 4 === 0 || (i - j + 400) % 4 === 0) ? red : sh(felt, 0.9); if (v > 0.36 && v < 0.39 || v > 0.17 && v < 0.2) return hide; if (v > 0.56 && v < 0.6) return red; if (v > 0.9) return hide; return (i % e.per === 0) ? sh(felt, 0.75) : sh(felt, 0.92 + 0.1 * rnd(Math.floor(i / e.per) + Math.floor(j / 8) * 3)); }, tapes: 0, bandTrim: SINEW, rig: savRig({ n: 8, vr: 0.06 }) });
  for (let i = 0; i < 12; i++) { const pts = []; for (let t = 0; t <= 6; t++) pts.push(env.at(i / 12, 0.58 + 0.33 * (t / 6), 0.02)); k.s(sweep(pts, 0.018, 4, 6, 0x6a4a2a), null); }
  const ty = env.top(); k.s(torus(0.4, 0.05, 6, 20), red, T(0, ty - 0.08, 0, PI / 2)); for (let i = 0; i < 4; i++) k.s(box(0.8, 0.04, 0.04), red, T(0, ty - 0.06, 0, 0, i * PI / 4, 0));
  for (let i = 0; i < 3; i++) k.hoop(env, 0.44 + i * 0.07 - (i === 0 ? 0.06 : 0), 0.016, 0x4a3424, 'solid', 3);
  const tug = (x, y, z, h) => { k.s(cyl(0.016, 0.02, h, 5), 0x4a3424, T(x, y + h / 2, z)); k.s(cone(0.1, 0.4, 9), hair, T(x, y + h - 0.2, z)); k.s(torus(0.07, 0.015, 4, 10), red, T(x, y + h, z, PI / 2)); k.s(cone(0.03, 0.14, 5), 0xc8a040, T(x, y + h + 0.08, z)); };
  tug(0, ty - 0.05, 0, 0.5); hideBasket(k, L, { hide: felt, c1: 0x9a7a48, post: 0x5a4026 });
  for (let i = 0; i < 4; i++) { const a = i * PI / 2; k.c(surf(5, 4, (u, v, out) => { const aa = a + (u - 0.5) * 0.7; out[0] = Math.cos(aa) * (0.575 + 0.01 * v); out[1] = 0.52 - v * 0.36; out[2] = Math.sin(aa) * (0.575 + 0.01 * v); }, (u, v, ii, j) => (ii === 0 || ii === 4 || j === 3 ? 0xc8a040 : (ii + j) & 1 ? red : 0x2a4a6a))); }
  tug(-0.44, 0.4, 0.44, 1.1); tug(0.44, 0.4, -0.44, 0.9); savageStores(k, L, { bag: felt, jar: 0x6a4a3a }); pennant(k, 'owner', WHITE, -0.44, 1.2, 0.44, 0.9, 0.5, 0.2, 1);
};
B.verdant = (k, L) => { // a living seed-pod, spiral-ribbed, cupped in great leaves and wound with flowering vine; an acorn-cup nest for a car
  const g1 = L.envelope, g2 = sh(g1, 0.72), leafc = 0x3a7a34, bark = 0x5a4228, glow = L.glow, bloom = 0xf0d060;
  const env = balloon(k, L, { shape: 'pod', env: { gores: 8, per: 6, bulge: 0.1, twist: 0.3, cy: 3.98 }, band: [0.3, 0.37], pat: (e) => (u, v, i, j) => { const q = i % e.per; return q === 0 || q === e.per - 1 ? sh(leafc, 0.6) : v > 0.85 ? mix(g1, 0xd8c060, 0.5) : (q === 2 || q === 3) ? g1 : g2; }, tapes: 0, bandTrim: 0x2a5a2a, mouth: false, rig: savRig({ rope: 0x2a5a2a, n: 6, vr: 0.12, r: 0.016, ringCol: bark, burner: 'none' }) });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.c(leaf(2.0, 0.95, 0.2, (u, v) => (Math.abs(u - 0.5) < 0.12 ? sh(leafc, 0.6) : v > 0.75 ? 0x6a9a3a : leafc), { nu: 6, nv: 10, pw: 0.65, cup: -0.25 }), null, T(Math.cos(a) * 0.2, 2.2, Math.sin(a) * 0.2, 0.62, PI / 2 - a, 0)); }
  for (let s = 0; s < 2; s++) { const pts = []; for (let t = 0; t <= 22; t++) pts.push(env.at(s * 0.5 + 1.2 * (t / 22), 0.14 + 0.74 * (t / 22), 0.06)); k.s(sweep(pts, (v) => 0.045 * (1 - v * 0.6), 5, 44, (u, v, i, j) => (j & 1 ? bark : sh(bark, 1.2))), null); for (let t = 2; t < 22; t += 3) { const d = env.nrm(s * 0.5 + 1.2 * (t / 22), 0.14 + 0.74 * (t / 22)); k.c(leaf(0.34, 0.16, 0.3, t % 2 ? leafc : 0x5a9a3a, { nv: 5 }), null, TA(pts[t], [d[0], d[1] + 0.6, d[2]])); if (t % 6 === 2) { k.g(ball(0.055, 6, 5), bloom, T(pts[t][0] + d[0] * 0.1, pts[t][1], pts[t][2] + d[2] * 0.1)); for (let q = 0; q < 5; q++) k.c(leaf(0.14, 0.09, 0.3, 0xf4f0e0, { nv: 3, nu: 2 }), null, TA([pts[t][0] + d[0] * 0.08, pts[t][1], pts[t][2] + d[2] * 0.08], [d[0] + Math.cos(q * 1.257) * 0.9, d[1] + Math.sin(q * 1.257) * 0.9, d[2] + Math.cos(q * 1.257 + 1.5) * 0.9])); } } }
  const ty = env.top(); k.s(sweep([[0, ty - 0.1, 0], [0.05, ty + 0.15, 0.02], [0.16, ty + 0.3, 0.04]], (v) => 0.04 * (1 - v * 0.6), 5, 6, 0x4a8a34), null); for (const s of [-1, 1]) k.c(leaf(0.4, 0.2, 0.3, 0x6aaa3a, { nv: 5 }), null, T(0.1, ty + 0.2, 0, 0.3, s * 1.2, s * 0.9));
  k.g(ball(0.13, 10, 8), glow, T(0, 1.5, 0)); for (let i = 0; i < 4; i++) k.c(leaf(0.3, 0.2, -0.5, 0x8a6a34, { nv: 5, cup: 0.3 }), null, T(0, 1.34, 0, 0.75, i * PI / 2, 0));
  wicker(k, { ex: 2, w: 1.14, d: 1.14, h: 0.5, taper: 0.62, flare: 0.0, c1: 0x7a5a34, c2: 0x5a4228, rim: 0x4a3620, amp: 0.035, nu: 48 });
  k.s(rev([[0, -0.12], [0.1, -0.1], [0.3, 0], [0.36, 0.06]], 12, [bark, sh(bark, 0.8), bark]), null); k.s(cyl(0.03, 0.045, 0.16, 5), bark, T(0, -0.18, 0));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + 0.2; k.c(leaf(0.3, 0.17, 0.5, i & 1 ? leafc : 0x5a9a3a, { nv: 5 }), null, T(Math.cos(a) * 0.55, 0.46, Math.sin(a) * 0.55, 0.9, PI / 2 - a, 0)); }
  k.o(surf(28, 1, (u, v, out) => { const a = u * TAU, r = 0.5 + 0.08 * v; out[0] = Math.cos(a) * r; out[1] = 0.22 + v * 0.13; out[2] = Math.sin(a) * r; }, (u, v, i) => (i & 1 ? WHITE : 0xc8c8c8), { closeU: true }));
  for (const a of [0.4, 2.5, 4.4]) { const x = Math.cos(a) * 0.62, z = Math.sin(a) * 0.62; k.rod('solid', 0x2a5a2a, [x, 0.5, z], [x, 0.3, z], 0.008, 3); k.s(rev([[0, -0.2], [0.06, -0.16], [0.08, -0.08], [0.05, 0], [0, 0.02]], 8, [0x8a5a2a, 0x9a6a34, 0x7a4a24, bark]), null, T(x, 0.3, z)); }
  cargo(k, 'sack', -0.22, 0.08, -0.2, 1, 0, 0x8a9a5a); cargo(k, 'bundle', 0.22, 0.08, 0.2, 1, 0.5, bark); cargo(k, 'jar', 0.22, 0.08, -0.2, 0.9, 0, 0x6a7a3a); netbag(k, -0.66, 0.5, 0.2, 0.85, 0x9a8a4a, 0x2a5a2a);
  for (let i = 0; i < 5; i++) k.g(ball(0.025, 5, 4), 0xd8ff8a, T(Math.cos(i * 2.4) * (0.9 + 0.3 * rnd(i)), 1.0 + i * 0.35, Math.sin(i * 2.4) * (0.9 + 0.3 * rnd(i + 2))));
  k.s(sweep([[0.4, 0.5, 0.4], [0.5, 0.9, 0.46], [0.46, 1.3, 0.5]], 0.018, 4, 6, bark), null); pennant(k, 'owner', WHITE, 0.46, 1.18, 0.5, 0.6, 0.5, 0.22, 0);
};
B.screaming = (k, L) => { // a bloated sac of nightmare flesh, veined, studded with staring eyes, a toothed maw; tentacles trail from it
  const flesh = L.envelope, dkf = sh(flesh, 0.6), vein = 0x5a1a4a, glow = L.glow, hide = L.hide ?? 0x6a2a6a;
  const wob = (u, v) => 1 + 0.06 * Math.sin(u * TAU * 3 + v * 8) + 0.05 * Math.sin(u * TAU * 5 - v * 13) + 0.04 * Math.sin(v * 21 + u * 9);
  const env = balloon(k, L, { env: { gores: 7, per: 9, bulge: 0.05, wob, rows: 36 }, band: [0.24, 0.31], pat: (e) => (u, v, i, j) => { const r = rnd(Math.floor(i / 3) * 2.7 + Math.floor(j / 4) * 9.3); return v < 0.1 ? dkf : r > 0.86 ? mix(flesh, 0xe8a0a0, 0.5) : r < 0.14 ? dkf : (i % e.per === 0) ? vein : sh(flesh, 0.9 + 0.2 * r); }, tapes: 0, bandTrim: vein, mouth: dkf, rig: savRig({ rope: 0x4a1a3a, n: 7, r: 0.016, ringCol: BONE, burner: 'none' }) });
  for (let g = 0; g < 7; g++) { const pts = []; for (let t = 0; t <= 12; t++) pts.push(env.at(g / 7 + 0.5 / 7 + 0.03 * Math.sin(t * 1.3 + g), 0.1 + 0.82 * (t / 12), 0.01)); k.s(sweep(pts, (v) => 0.03 * (1 - v * 0.6), 4, 16, vein), null); }
  for (let i = 0; i < 13; i++) { const u = (i * 0.618 + 0.13) % 1, v = 0.32 + 0.5 * rnd(i * 2.2 + 1), p = env.at(u, v, -0.03), d = env.nrm(u, v), r = 0.11 + 0.1 * rnd(i * 7); if (Math.abs(u - 0.25) < 0.09 && v < 0.6) continue; eyeball(k, p, d, r, i % 4 === 0 ? 0xffd040 : glow); k.s(torus(r * 1.02, r * 0.3, 5, 12), dkf, TA(p, d).multiply(T(0, r * 0.2, 0, PI / 2))); }
  { const p = env.at(0.25, 0.44, 0.0), d = env.nrm(0.25, 0.44); k.push(TA(p, d)); k.s(ball(0.4, 12, 8), 0x2a0a14, T(0, -0.1, 0, 0, 0, 0, 1.1, 0.4, 0.7)); k.s(torus(0.4, 0.09, 6, 16), dkf, T(0, 0.02, 0, PI / 2, 0, 0, 1.1, 0.7, 1)); for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; k.s(cone(0.045, 0.24, 4), BONE, T(Math.cos(a) * 0.36, 0.08, Math.sin(a) * 0.24, Math.sin(a) * -0.9, 0, Math.cos(a) * 0.9)); } k.g(ball(0.12, 8, 6), 0xff3a6a, T(0, -0.02, 0, 0, 0, 0, 1.6, 0.4, 0.8)); k.pop(); }
  for (let i = 0; i < 9; i++) { const u = i / 9 + 0.04, q = env.at(u, 0.05, -0.08), len = 1.0 + 0.9 * rnd(i * 4), ax = Math.cos(u * TAU), az = Math.sin(u * TAU); k.s(sweep([q, [q[0] + ax * 0.35, q[1] - len * 0.3, q[2] + az * 0.35], [q[0] + ax * 0.5, q[1] - len * 0.7, q[2] + az * 0.5], [q[0] + ax * 0.25 + az * 0.2, q[1] - len, q[2] + az * 0.25 - ax * 0.2], [q[0] + ax * 0.45, q[1] - len * 1.05, q[2] + az * 0.45]], (v) => 0.09 * (1 - v * 0.88) + 0.008, 6, 16, (uu, v, ii, j) => (ii < 2 ? mix(flesh, 0xe8a0a0, 0.5) : j & 1 ? hide : sh(hide, 0.8))), null); }
  k.g(ball(0.14, 10, 8), glow, T(0, 1.5, 0)); eyeball(k, [0, 1.5, 0], [0, 0, 1], 0.1, 0xffd040); for (let i = 0; i < 5; i++) k.s(sweep([[Math.cos(i * 1.257) * 0.5, 1.38, Math.sin(i * 1.257) * 0.5], [Math.cos(i * 1.257) * 0.3, 1.3, Math.sin(i * 1.257) * 0.3], [Math.cos(i * 1.257) * 0.14, 1.42, Math.sin(i * 1.257) * 0.14]], 0.022, 4, 6, BONE), null);
  // a car of ribs and stretched skin
  k.s(rev([[0, -0.03], [0.3, -0.02], [0.5, 0.1], [0.56, 0.3], [0.54, 0.5], [0.5, 0.5], [0.5, 0.3], [0.44, 0.12], [0.28, 0.04], [0, 0.04]], 20, (u, v, i, j) => (j > 4 ? dkf : (i & 3) === 0 ? vein : sh(flesh, 0.8 + 0.2 * rnd(i + j * 5))), {}), null);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; k.s(sweep([[Math.cos(a) * 0.3, -0.02, Math.sin(a) * 0.3], [Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55], [Math.cos(a) * 0.62, 0.4, Math.sin(a) * 0.62], [Math.cos(a) * 0.5, 0.72, Math.sin(a) * 0.5]], (v) => 0.035 * (1 - v * 0.7) + 0.006, 5, 10, BONE), null); }
  k.o(surf(24, 1, (u, v, out) => { const a = u * TAU; out[0] = Math.cos(a) * 0.572; out[1] = 0.26 + v * 0.12; out[2] = Math.sin(a) * 0.572; }, (u, v, i) => (i % 3 === 0 ? 0xb0b0b0 : WHITE), { closeU: true }));
  for (const a of [0.5, 2.0, 3.6, 5.2]) eyeball(k, [Math.cos(a) * 0.56, 0.17, Math.sin(a) * 0.56], [Math.cos(a), 0, Math.sin(a)], 0.07, glow);
  cargo(k, 'sack', -0.2, 0.06, -0.2, 1, 0, 0x8a5a6a); cargo(k, 'jar', 0.22, 0.06, -0.18, 0.9, 0, 0x4a2a4a); cargo(k, 'sack', 0.2, 0.06, 0.22, 0.9, 1, 0x9a6a6a); netbag(k, -0.68, 0.52, 0.1, 0.9, 0x8a5a6a, 0x4a1a3a); netbag(k, 0.5, 0.52, 0.48, 0.7, 0x6a3a5a, 0x4a1a3a);
  k.s(sweep([[-0.4, 0.5, -0.4], [-0.5, 0.95, -0.44], [-0.44, 1.35, -0.5]], (v) => 0.03 * (1 - v * 0.5), 4, 6, BONE), null); pennant(k, 'owner', WHITE, -0.44, 1.2, -0.5, 3.6, 0.55, 0.24, 1);
};
B.xibalba = (k, L) => { // a gold-and-jade sun-gourd with a stepped-fret girdle, a high fan of plumes and a sun-stone; a stepped gilded car
  const main = L.envelope, gold = 0xd8a82a, jade = 0x2a9a6a, red = 0xb8281e, turq = 0x2ab0c0, FE = [jade, red, turq, 0xe8c030, 0x1a6a4a];
  const env = balloon(k, L, { shape: 'oblate', env: { gores: 16, per: 4, bulge: 0.035, cy: 3.95 }, band: [0.2, 0.27], pat: (e) => (u, v, i, j) => { const g = Math.floor(i / e.per); if (v > 0.38 && v < 0.56) { const x = i % 8, y = Math.floor((v - 0.38) / 0.03); const fret = (y === 0 || y === 5) || (x === 0 && y < 5) || (y === 2 && x > 1 && x < 6) || (x === 5 && y > 1 && y < 4) || (y === 4 && x < 4 && x > 1) && false; return fret ? jade : gold; } if (v > 0.56 && v < 0.6 || v > 0.34 && v < 0.38) return red; if (v > 0.86) return jade; return g & 1 ? main : sh(main, 0.8); }, tapes: 2, tcol: 0x6a4a2a, bandTrim: 0x6a4a2a, rig: savRig({ n: 8, ringCol: 0x6a4a2a, rope: 0x6a5a3a }) });
  for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; k.c(leaf(1.0 + 0.25 * (i & 1), 0.22, 0.45, (u, v) => (v > 0.7 ? FE[(i + 1) % 5] : Math.abs(u - 0.5) < 0.15 ? 0xf0e8c0 : FE[i % 5]), { nu: 4, nv: 7 }), null, T(Math.cos(a) * 0.3, env.top() - 0.12, Math.sin(a) * 0.3, 0.42, PI / 2 - a, 0)); }
  k.m(rev([[0, 0], [0.34, 0], [0.36, 0.06], [0.2, 0.1], [0.12, 0.22], [0, 0.26]], 14, gold), null, T(0, env.top() - 0.06, 0));
  for (let i = 0; i < 32; i++) { const u = i / 32, p = env.at(u, 0.345, 0.02), a = u * TAU; k.c(leaf(0.5, 0.13, 0.25, FE[i % 5], { nv: 5 }), null, T(p[0], p[1], p[2], PI - 0.3, PI / 2 - a, 0)); }
  for (const u of [0.25, 0.75]) { const p = env.at(u, 0.68, 0.04), d = env.nrm(u, 0.68); k.push(TA(p, d)); k.m(cyl(0.36, 0.36, 0.05, 20), gold, T()); k.s(cyl(0.26, 0.26, 0.07, 16), 0xb8a888, T()); k.s(ball(0.12, 8, 6), jade, T(0, 0.04, 0, 0, 0, 0, 1, 0.5, 1)); for (let i = 0; i < 8; i++) k.m(cone(0.07, 0.16, 3), gold, T(Math.cos(i * PI / 4) * 0.42, 0, Math.sin(i * PI / 4) * 0.42, 0, -i * PI / 4, -PI / 2)); for (let i = 0; i < 8; i++) k.s(box(0.05, 0.03, 0.05), i & 1 ? red : turq, T(Math.cos(i * PI / 4 + 0.39) * 0.2, 0.04, Math.sin(i * PI / 4 + 0.39) * 0.2)); k.pop(); }
  k.s(rev([[0.4, 0], [0.5, 0.02], [0.5, 0.16], [0.55, 0.18], [0.55, 0.34], [0.6, 0.36], [0.6, 0.5], [0.53, 0.5], [0.53, 0.06], [0, 0.05]], 24, [0x8a7a60, 0xb0a488, gold, 0xa89878, gold, 0xb0a488, 0x8a7a60, 0x6a5a48, 0x6a5a48], { ex: 8 }), null);
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); k.o(box(0.9, 0.11, 0.014), WHITE, T(0, 0.26, 0.557)); k.s(rbox(0.2, 0.16, 0.05, 0.02, 1), jade, T(0, 0.43, 0.61)); for (const x of [-0.05, 0.05]) k.s(box(0.04, 0.03, 0.02), DARK, T(x, 0.45, 0.64)); k.s(box(0.1, 0.025, 0.02), DARK, T(0, 0.39, 0.64)); for (const x of [-1, 1]) for (let f = 0; f < 3; f++) k.c(leaf(0.3, 0.08, 0.3, FE[(f + s) % 5], { nv: 4 }), null, T(x * 0.1, 0.5, 0.61, 0, 0, -x * (0.4 + f * 0.45))); k.pop(); }
  for (const a of [0.9, 2.4, 4.0, 5.5]) sandbag(k, Math.cos(a) * 0.72, 0.5, Math.sin(a) * 0.72, 0xb89a5a, 0.12, 0x6a5a3a);
  cargo(k, 'jar', -0.25, 0.07, -0.25, 1.1, 0, 0xb8683a); cargo(k, 'sack', 0.26, 0.07, -0.26, 1, 0, 0xc8b070); cargo(k, 'jar', 0.26, 0.07, 0.26, 0.9, 0, jade); cargo(k, 'bundle', -0.26, 0.07, 0.28, 1, 0.3, 0xc8a84a); netbag(k, -0.74, 0.5, 0, 0.9, 0xc8a85a, 0x6a5a3a);
  flagstaff(k, 0.56, 0.5, 0.56, 0.8, 0.6, { knob: gold, col: 0x6a4a2a, tail: 2, len: 0.36, h: 0.36 });
};
B.greenhide = (k, L) => { // a crude lumpy gas-hide of rough patches and fat stitches, tusked and war-painted; a spiked plank crate with a skull pole
  const hide = L.hide ?? 0x4a4238, green = L.envelope, cols = [hide, sh(hide, 1.3), mix(hide, green, 0.5), 0x6a5a40, sh(hide, 0.7), mix(green, 0x2a2a20, 0.4)];
  const wob = (u, v) => 1 + 0.08 * Math.sin(u * TAU * 2 + v * 4 + 1) + 0.06 * Math.sin(u * TAU * 3 - v * 7);
  const env = balloon(k, L, { env: { gores: 6, per: 10, bulge: 0.1, wob }, band: [0.3, 0.42], pat: (e) => (u, v, i, j) => { const a = Math.floor((i + Math.floor(j / 7) * 3) / 6), b = Math.floor(j / 7); return (i % 6 === 0 || j % 7 === 0) ? sh(hide, 0.45) : cols[Math.floor(rnd(a * 3.3 + b * 7.1) * 6)]; }, tapes: 0, bandTrim: false, rig: savRig({ n: 6, rope: 0x3a2e22, r: 0.016 }) });
  for (let i = 0; i < 30; i++) { const u = i / 30, vv = [0.3, 0.42][i & 1]; k.o(cone(0.11, 0.3, 3), WHITE, TA(env.at(u, vv, 0.03), [0, i & 1 ? 1 : -1, 0], 1, 1, 0.12)); }
  for (let g = 0; g < 6; g++) for (let t = 0; t < 9; t++) { const p = env.at(g / 6, 0.12 + t * 0.09, 0.03), d = env.nrm(g / 6, 0.12 + t * 0.09); k.s(box(0.2, 0.03, 0.03), 0x1e1a16, TA(p, d).multiply(T(0, 0, 0, 0, g, 0.3))); }
  for (const s of [-1, 1]) { const p = env.at(0.25 + s * 0.07, 0.42, -0.05); k.s(sweep([p, [p[0] + s * 0.1, p[1] - 0.1, p[2] + 0.3], [p[0] + s * 0.2, p[1] + 0.2, p[2] + 0.45], [p[0] + s * 0.2, p[1] + 0.6, p[2] + 0.4]], (v) => 0.15 * (1 - v * 0.85) + 0.01, 7, 12, BONE), null); }
  { const p = env.at(0.25, 0.58, 0.02), d = env.nrm(0.25, 0.58); for (const x of [-0.3, 0.3]) k.g(ball(0.1, 8, 6), 0xff4a1a, T(p[0] + x, p[1] + 0.05, p[2] - 0.04, 0, 0, 0, 1.3, 0.6, 0.5)); }
  k.s(cone(0.18, 0.2, 6), sh(hide, 0.6), T(0, env.top() + 0.05, 0)); for (let i = 0; i < 4; i++) k.s(cone(0.05, 0.4, 4), BONE, T(Math.cos(i * 1.57) * 0.16, env.top() + 0.2, Math.sin(i * 1.57) * 0.16, Math.sin(i * 1.57) * 0.5, 0, -Math.cos(i * 1.57) * 0.5));
  k.push(T(0, 0, 0, 0, -0.05, -0.02)); tub(k, { w: 1.06, d: 1.04, h: 0.5, col: 0x5a4630, planks: 4, th: 0.06 }); k.pop();
  for (let s = 0; s < 4; s++) { k.push(T(0, 0, 0, 0, s * PI / 2, 0)); for (let i = 0; i < 4; i++) k.s(cone(0.05, 0.26, 4), BONE, T(-0.36 + i * 0.24, 0.6, 0.5, 0.2, 0, 0)); k.s(box(1.1, 0.07, 0.03), 0x3a2e22, T(0, 0.14, 0.545, 0, 0, 0.03)); k.o(box(0.7, 0.2, 0.016), WHITE, T(0, 0.32, 0.54, 0, 0, s & 1 ? 0.06 : -0.05)); k.s(sweep([[0.5, 0.05, 0.5], [0.6, 0.3, 0.6], [0.56, 0.7, 0.56]], (v) => 0.05 * (1 - v * 0.7) + 0.008, 5, 6, BONE), null); k.pop(); }
  savageStores(k, L, { bag: 0x6a6a48 }); k.s(cyl(0.03, 0.04, 1.2, 5), 0x3a2e22, T(-0.44, 1.0, 0.44)); skull(k, T(-0.44, 1.7, 0.44, 0, 0.8, 0, 0.2), BONE); pennant(k, 'owner', WHITE, -0.44, 1.36, 0.44, 0.7, 0.55, 0.3, 1);
};
B.mistisles = (k, L) => { // a scaled teal teardrop with a flared serpent's hood and a fanged head, a great snake coiled about it; a coiled-reed basket
  const hide = L.hide ?? 0x5a8a9a, pale = mix(hide, 0xe8f0d8, 0.6), dk = sh(hide, 0.6), glow = L.glow, gold = 0xc8a84a;
  const env = balloon(k, L, { shape: 'tear', env: { gores: 12, per: 4, bulge: 0.03, cy: 4.1 }, band: [0.2, 0.26], pat: (e) => (u, v, i, j) => { if (Math.abs(u - 0.25) < 0.1) return j & 1 ? pale : sh(pale, 0.86); return ((i + (j & 1)) & 1) ? sh(hide, 0.85 + 0.25 * rnd(i * 3 + j * 11)) : dk; }, tapes: 0, bandTrim: gold, rig: savRig({ n: 6, vr: 0.14, rope: 0x4a5a4a, ringCol: 0x5a4a30 }) });
  for (const s of [-1, 1]) k.c(surf(8, 10, (u, v, out) => { const uu = 0.25 + s * (0.13 + 0.01), p = env.at(uu, 0.36 + 0.5 * v, 0), w = 1.0 * Math.pow(Math.sin(PI * (0.08 + v * 0.9)), 0.7) * u; out[0] = p[0] - s * w * 0.92; out[1] = p[1] + 0.1 * u; out[2] = p[2] + 0.35 * u * u - 0.1 * u; }, (u, v, i, j) => (i === 7 ? gold : (i + j) % 3 === 0 ? dk : j > 3 && j < 7 && i > 2 && i < 6 ? 0xd8c060 : hide)));
  { const p = env.at(0.25, 0.88, 0); k.push(T(p[0], p[1] + 0.06, p[2] + 0.1, 0.5, 0, 0)); k.s(ball(0.3, 12, 8), hide, T(0, 0, 0.1, 0, 0, 0, 0.95, 0.6, 1.3)); k.s(rbox(0.34, 0.1, 0.46, 0.04, 1), pale, T(0, -0.16, 0.2, 0.25, 0, 0)); for (const x of [-1, 1]) { k.g(ball(0.055, 6, 5), glow, T(x * 0.19, 0.08, 0.26)); k.s(cone(0.03, 0.22, 4), BONE, T(x * 0.1, -0.14, 0.42, PI - 0.2, 0, 0)); } k.s(sweep([[0, -0.08, 0.4], [0, -0.14, 0.62], [0.05, -0.1, 0.78]], 0.012, 3, 5, 0xb02a3a), null); k.s(sweep([[0, -0.14, 0.62], [-0.05, -0.1, 0.78]], 0.012, 3, 3, 0xb02a3a), null); k.pop(); }
  { const pts = []; for (let t = 0; t <= 30; t++) { const f = t / 30; pts.push(env.at(0.6 + 1.6 * f, 0.16 + 0.42 * f, 0.1)); } k.s(sweep(pts, (v) => 0.03 + 0.1 * Math.sin(PI * Math.min(1, v * 0.9 + 0.1)), 7, 70, (u, v, i, j) => (i < 2 ? pale : j % 4 < 2 ? 0x2a6a5a : gold)), null); const h = pts[30]; k.s(ball(0.13, 8, 6), 0x2a6a5a, T(h[0], h[1], h[2], 0, 0, 0, 1.2, 0.8, 1.2)); }
  k.s(rev([[0, 0], [0.34, 0.01], [0.5, 0.06], [0.56, 0.14], [0.52, 0.2], [0.57, 0.27], [0.53, 0.33], [0.58, 0.4], [0.54, 0.46], [0.57, 0.5], [0.5, 0.5], [0.5, 0.1], [0, 0.05]], 28, (u, v, i, j) => (j > 9 ? 0x5a4a30 : (j & 1) ? 0xb89a58 : 0x9a7c44)), null);
  k.o(surf(28, 1, (u, v, out) => { const a = u * TAU; out[0] = Math.cos(a) * 0.585; out[1] = 0.235 + v * 0.07; out[2] = Math.sin(a) * 0.585; }, WHITE, { closeU: true }));
  { const pts = []; for (let t = 0; t <= 16; t++) { const a = (t / 16) * 4.6 + 1; pts.push([Math.cos(a) * 0.62, 0.06 + 0.5 * (t / 16), Math.sin(a) * 0.62]); } pts.push([Math.cos(5.6) * 0.66, 0.74, Math.sin(5.6) * 0.66]); k.s(sweep(pts, (v) => 0.02 + 0.035 * Math.sin(PI * Math.min(1, v + 0.1)), 6, 36, (u, v, i, j) => (j % 3 === 0 ? gold : 0x2a6a5a)), null); k.s(ball(0.06, 6, 5), 0x2a6a5a, T(Math.cos(5.6) * 0.66, 0.76, Math.sin(5.6) * 0.66, 0, 0, 0, 1.3, 0.8, 1)); }
  for (const a of [0.4, 2.2, 3.7]) sandbag(k, Math.cos(a) * 0.62, 0.48, Math.sin(a) * 0.62, 0x8a9a7a, 0.12, 0x4a5a4a); netbag(k, Math.cos(4.6) * 0.68, 0.5, Math.sin(4.6) * 0.68, 0.9, 0x9aa88a, 0x4a5a4a);
  cargo(k, 'jar', -0.22, 0.07, -0.2, 1.1, 0, 0x3a7a7a); cargo(k, 'sack', 0.24, 0.07, -0.2, 1, 0, 0xa8b090); cargo(k, 'jar', 0.2, 0.07, 0.24, 0.9, 0, 0x8a6a3a); cargo(k, 'bundle', -0.24, 0.07, 0.24, 1, 0.4, 0x6a7a5a);
  flagstaff(k, -0.4, 0.5, -0.42, 0.95, 3.9, { knob: gold, col: 0x5a4a30, tail: 0, len: 0.6, h: 0.26 });
};
B.elemental = (k, L) => { // no cloth at all: a great floating crystal with a swarm of shards over a hovering slab of rune-cut stone
  const stone = L.hide ?? 0x7a7a82, glow = L.glow, cr = mix(L.envelope, 0xbfe8ff, 0.5), cr2 = mix(cr, 0x6a8ad8, 0.5), dk = sh(stone, 0.7);
  const facet = (c) => (x, y) => (y > 0.3 ? mix(c, 0xffffff, 0.45) : y < -0.5 ? sh(c, 0.7) : c);
  k.c(gem(1.5, 4.6, 7), facet(cr), T(0, 4.1 - 0.44, 0, 0, 0.2, 0), true);
  k.g(gem(0.5, 2.6, 5), mix(glow, 0xffffff, 0.3), T(0, 3.9, 0, 0, 0.5, 0), true);
  for (let i = 0; i < 9; i++) { const a = i * 0.698 + 0.3, r = 1.15 + 0.4 * rnd(i * 3), y = 3.0 + 2.2 * rnd(i * 7 + 1), s = 0.5 + 0.5 * rnd(i * 5); k.c(gem(0.3 * s + 0.12, 1.5 * s + 0.5, 5 + (i % 2)), facet(i % 3 ? cr2 : cr), T(Math.cos(a) * r, y, Math.sin(a) * r, 0.5 * Math.sin(a) * (0.5 + rnd(i)), a, -0.5 * Math.cos(a) * (0.5 + rnd(i))), true); }
  for (let i = 0; i < 14; i++) { const a = i * 0.449 + 0.1, s = 0.5 + 0.5 * rnd(i * 9 + 2); k.c(gem(0.16 + 0.12 * s, 0.7 + 0.7 * s, 5 + (i % 3)), facet(i % 2 ? cr2 : cr), T(Math.cos(a) * (0.75 + 0.3 * rnd(i)), 2.75 + 0.5 * rnd(i * 3), Math.sin(a) * (0.75 + 0.3 * rnd(i)), PI + 0.7 * Math.sin(a), 0, -0.7 * Math.cos(a)), true); }
  for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU, r = 1.78 + 0.06 * Math.sin(i * 3); k.add(i % 4 === 0 ? 'glow' : 'cloth', gem(0.045 + 0.03 * rnd(i), 0.2 + 0.16 * rnd(i * 2), 5), i % 4 === 0 ? glow : facet(i & 1 ? cr : cr2), T(Math.cos(a) * r, 4.35 + 0.5 * Math.sin(a * 2 + 1), Math.sin(a) * r, i, i * 2, i * 3), true); }
  k.o(rev([[1.3, -0.26], [1.52, -0.05], [1.52, 0.05], [1.4, 0.24]], 7, [0xc0c0c0, WHITE, 0xd8d8d8], { rot: 0.2 - PI / 2 }), null, T(0, 3.3, 0), true);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.65; k.s(new THREE.DodecahedronGeometry(0.16 + 0.08 * rnd(i)), i & 1 ? stone : dk, T(Math.cos(a) * 1.68, 2.5 + 0.25 * Math.sin(i * 2), Math.sin(a) * 1.68, i, i * 2, 0), true); k.g(gem(0.05, 0.2, 5), glow, T(Math.cos(a) * 1.68, 2.78 + 0.25 * Math.sin(i * 2), Math.sin(a) * 1.68), true); }
  // the slab
  for (let i = 0; i < 18; i++) k.g(box(0.05, 0.012, 0.012), glow, T(Math.cos(i * 0.349) * 0.4, 0.03, Math.sin(i * 0.349) * 0.4, 0, -i * 0.349 + (i & 1 ? 0.6 : -0.6), 0));
  k.s(rev([[0, -0.75], [0.1, -0.68], [0.2, -0.5], [0.36, -0.36], [0.5, -0.2], [0.68, -0.08], [0.72, 0], [0.6, 0.02], [0, 0.02]], 9, (u, v, i, j) => (j === 5 ? dk : (i + j) & 1 ? stone : sh(stone, 0.86)), { rot: 0.3 }), null, null, true);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + 0.3 + PI / 9; if (i === 2) continue; k.s(new THREE.DodecahedronGeometry(0.17), i & 1 ? sh(stone, 1.1) : dk, T(Math.cos(a) * 0.6, 0.14 + 0.1 * rnd(i), Math.sin(a) * 0.6, i, i * 3, 0, 1, 1.6 + 0.9 * rnd(i * 3), 1), true); k.g(box(0.03, 0.16, 0.02), glow, T(Math.cos(a) * 0.74, 0.16, Math.sin(a) * 0.74, 0, -a + PI / 2, 0)); }
  for (let i = 0; i < 5; i++) k.s(new THREE.DodecahedronGeometry(0.1 + 0.05 * rnd(i)), i & 1 ? stone : dk, T(Math.cos(i * 1.3) * (0.5 + 0.4 * rnd(i)), -0.9 - 0.25 * rnd(i * 3), Math.sin(i * 1.3) * (0.5 + 0.4 * rnd(i + 5)), i, i, i), true);
  for (let i = 0; i < 3; i++) k.c(gem(0.1, 0.5, 5), facet(cr2), T(Math.cos(i * 2.1 + 1) * 0.35, -0.5, Math.sin(i * 2.1 + 1) * 0.35, PI + 0.3 * Math.cos(i), 0, 0.3 * Math.sin(i)), true);
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; k.g(cyl(0.012, 0.012, 1, 4, true), glow, TA([Math.cos(a) * 0.6, 1.2, Math.sin(a) * 0.6], [Math.cos(a) * 0.1, 1.7, Math.sin(a) * 0.1], 1, 1.75, 1)); k.g(gem(0.06, 0.22, 5), glow, T(Math.cos(a) * 0.65, 0.5, Math.sin(a) * 0.65), true); }
  k.s(torus(0.3, 0.05, 5, 7), dk, T(0, 1.42, 0, PI / 2), true);
  cargo(k, 'jar', -0.25, 0.02, -0.2, 1.1, 0, 0x8a8a92); cargo(k, 'crate', 0.25, 0.02, -0.2, 1, 0.2, 0x8a8478); cargo(k, 'sack', 0.2, 0.02, 0.25, 1, 0, 0x9a9aa0); k.s(new THREE.DodecahedronGeometry(0.12), 0xd8b040, T(-0.25, 0.1, 0.25), true); k.c(gem(0.07, 0.3, 5), cr, T(-0.1, 0.14, 0.34, 0.2, 0, 0.2), true);
  k.o(gem(0.09, 0.44, 4), WHITE, T(Math.cos(0.3 + 2 * TAU / 9 + PI / 9) * 0.62, 0.36, Math.sin(0.3 + 2 * TAU / 9 + PI / 9) * 0.62), true);
  return { fire: 'gem' };
};

// =====================================================================================================
// GONDOLAS, faction by faction
// =====================================================================================================
/** the trolley: two grooved sheaves riding the cable between cheek plates, and the block the hanger swings from */
function trolley(k, L, o = {}) {
  const mc = o.col ?? sh(L.metal, 1.5), tc = o.trim ?? L.trim, r = o.r ?? 1;
  const sheave = rev([[0, -0.034], [0.068, -0.034], [0.078, -0.028], [0.078, -0.016], [0.054, -0.004], [0.054, 0.004], [0.078, 0.016], [0.078, 0.028], [0.068, 0.034], [0, 0.034]], 18, [mc, tc, tc, mc, DARK, mc, tc, tc, mc]);
  for (const x of [-0.13, 0.13]) { k.m(sheave, null, T(x, 0.057, 0, PI / 2, 0, 0, r, 1, r)); k.m(cyl(0.018, 0.018, 0.12, 8), tc, T(x, 0.057, 0, PI / 2)); for (let i = 0; i < 5; i++) k.m(box(0.012, 0.09, 0.072), mc, T(x, 0.057, 0, 0, 0, (i * PI) / 5)); }
  for (const z of [-0.05, 0.05]) { k.m(rbox(0.42, 0.06, 0.014, 0.006, 1), mc, T(0, 0.062, z)); k.m(rbox(0.1, 0.2, 0.014, 0.006, 1), mc, T(0, -0.03, z)); for (const x of [-0.13, 0.13]) k.m(cyl(0.03, 0.03, 0.02, 8), tc, T(x, 0.057, z * 1.15, PI / 2)); }
  k.m(rbox(0.1, 0.05, 0.114, 0.012, 1), mc, T(0, -0.13, 0)); k.m(cyl(0.02, 0.02, 0.14, 8), tc, T(0, -0.13, 0, PI / 2));
}
/** a hanger: a bar from the trolley block down to y, with a swivel eye */
function hanger(k, L, y, o = {}) { const c = o.col ?? sh(L.metal, 1.4), bag = o.bag ?? 'metal'; k.rod(bag, c, [0, -0.14, 0], [0, y, 0], o.r ?? 0.022, 6); k.add(bag, torus(0.04, 0.012, 5, 12), o.trim ?? L.trim, T(0, -0.19, 0)); if (o.yoke) for (const x of [-1, 1]) k.add(bag, sweep([[0, y + 0.16, 0], [x * o.yoke * 0.6, y + 0.1, 0], [x * o.yoke, y - (o.drop ?? 0.1), 0]], o.r ?? 0.02, 5, 8, c), null); }
/** an open car: floor tray, low walls with the owner's panel, and corner posts up to where a roof sits */
function car(k, L, o = {}) {
  const { w = 0.86, d = 0.56, fy = -1.2, wall = 0.2, col = L.wood, post = 0.52, bag = 'solid', pcol = null, pbag = null, planks = 0, th = 0.035, panel = true, rim = null } = o;
  k.push(T(0, fy - 0.06, 0)); tub(k, { w, d, h: wall + 0.06, th, col, bag, planks, rim, rimBag: o.rimBag ?? 'metal', r: 0.015 }); k.pop();
  if (panel) for (const z of [-1, 1]) k.o(box(w * 0.78, wall * 0.55, 0.012), WHITE, T(0, fy + wall * 0.48, z * (d / 2 + 0.004)));
  if (post) for (const x of [-1, 1]) for (const z of [-1, 1]) k.add(pbag ?? bag, rbox(0.04, post, 0.04, 0.01, 1), pcol ?? sh(col, 0.75), T(x * (w / 2 - 0.02), fy + post / 2, z * (d / 2 - 0.02)));
  return fy + post;
}
const load = (k, list, fy = -1.2) => { for (const [kind, x, z, s, ry, tint] of list) cargo(k, kind, x, fy - 0.005, z, s ?? 1, ry ?? 0, tint); };
const STD_LOAD = [['crate', -0.24, -0.08, 1.15, 0.2], ['crate', -0.26, 0.14, 0.75, 0.6], ['sack', 0.02, 0.1, 1.05, 0.5], ['jar', 0.24, -0.1, 1.0, 0], ['sack', 0.27, 0.12, 0.9, 2], ['barrel', 0.02, -0.14, 0.9, 0]];
const G = {};

G.kingdom = (k, L) => { // a timber car with a slate gable, lantern and shield
  trolley(k, L); const ry = car(k, L, { col: L.wood, planks: 6, rim: L.metal });
  k.s(gable(0.98, 0.2, 0.7), (x, y, z) => (Math.floor((Math.abs(z) + 0.02) / 0.07) & 1 ? 0x4a5560 : 0x3e4852), T(0, ry, 0)); k.s(box(1.0, 0.03, 0.72), sh(L.wood, 0.6), T(0, ry - 0.01, 0)); k.m(cyl(0.014, 0.014, 1.0, 5), L.trim, T(0, ry + 0.2, 0, 0, 0, PI / 2));
  hanger(k, L, ry + 0.18); load(k, STD_LOAD); lantern(k, 0.47, ry - 0.06, 0.3, L.glow, L.metal, 1.1);
  for (const z of [-1, 1]) { k.c(box(0.84, 0.07, 0.012), L.cloth, T(0, ry - 0.05, z * 0.285)); shield(k, 0, -1.07, z * 0.292, z > 0 ? 0 : PI, 0.62, null, L.trim); }
  pennant(k, 'owner', WHITE, -0.5, ry + 0.12, 0, PI, 0.3, 0.12, 1);
};
G.graal = (k, L) => { // a little hanging tower: crenellated stone-grey car with lance pennons and blazoned shields
  trolley(k, L); const st = 0x9a968c; car(k, L, { col: st, wall: 0.34, post: 0, th: 0.05, panel: false });
  for (let i = 0; i < 5; i++) for (const z of [-1, 1]) k.s(rbox(0.1, 0.08, 0.055, 0.008, 1), sh(st, 1.08), T(-0.38 + i * 0.19, -0.82, z * 0.255)); for (const x of [-1, 1]) for (const z of [-0.12, 0.12]) k.s(rbox(0.055, 0.08, 0.1, 0.008, 1), sh(st, 1.08), T(x * 0.405, -0.82, z));
  k.o(box(0.88, 0.1, 0.57), WHITE, T(0, -1.08, 0)); for (const z of [-1, 1]) for (const x of [-0.25, 0, 0.25]) shield(k, x, -0.98, z * 0.29, z > 0 ? 0 : PI, 0.55, x ? L.cloth : L.cloth2, L.trim);
  hanger(k, L, -0.62, { yoke: 0.4, drop: 0.24 }); load(k, STD_LOAD);
  for (const x of [-1, 1]) { k.rod('solid', 0x5a4026, [x * 0.4, -0.86, 0.22], [x * 0.46, -0.3, 0.26], 0.012, 5); pennant(k, 'owner', WHITE, x * 0.455, -0.38, 0.26, x > 0 ? 0 : PI, 0.26, 0.1, 0); }
};
G.aurelia = (k, L) => { // a gilded state-coach of a car: pilastered, glazed, under a ribbed dome with an orb
  trolley(k, L, { col: L.trim }); const gold = L.trim, body = L.cloth;
  k.s(rbox(0.86, 0.5, 0.56, 0.06, 3), body, T(0, -0.97, 0)); k.m(rbox(0.9, 0.05, 0.6, 0.02, 1), gold, T(0, -1.2, 0)); k.m(rbox(0.9, 0.04, 0.6, 0.02, 1), gold, T(0, -0.73, 0));
  for (const z of [-1, 1]) { for (const x of [-0.24, 0, 0.24]) { k.g(rbox(0.16, 0.2, 0.012, 0.005, 1), 0xffe8a8, T(x, -0.9, z * 0.283)); k.m(torus(0.08, 0.012, 4, 10, PI), gold, T(x, -0.8, z * 0.284)); } for (const x of [-0.36, -0.12, 0.12, 0.36]) k.m(box(0.03, 0.42, 0.02), gold, T(x, -0.96, z * 0.283)); k.o(box(0.8, 0.1, 0.012), WHITE, T(0, -1.1, z * 0.285)); }
  k.m(rev([[0.5, 0], [0.48, 0.03], [0.4, 0.09], [0.24, 0.15], [0.08, 0.18], [0.05, 0.2]], 20, (u, v, i) => (i % 5 === 0 ? gold : L.cloth2), { sx: 0.92, sz: 0.62, spl: 6 }), null, T(0, -0.71, 0)); k.m(ball(0.04, 8, 6), gold, T(0, -0.47, 0));
  hanger(k, L, -0.47, { col: gold }); for (const x of [-1, 1]) { k.m(rbox(0.07, 0.03, 0.4, 0.01, 1), gold, T(x * 0.5, -1.14, 0)); cargo(k, 'chest', x * 0.52, -1.125, 0, 0.72, PI / 2); lantern(k, x * 0.46, -0.76, 0.3, L.glow, gold, 0.9); }
  cargo(k, 'bale', 0, -0.57, 0.12, 0.6, 0, L.cloth2);
};
G.westmark = (k, L) => { // an honest plank freight-car under a tarred canvas tilt, barrels aboard, a hand-brake wheel
  trolley(k, L); const ry = car(k, L, { planks: 7, rim: sh(L.wood, 0.6), rimBag: 'solid', pcol: L.metal, pbag: 'metal' });
  k.c(surf(8, 6, (u, v, out) => { out[0] = (u - 0.5) * 1.0; const a = (v - 0.5) * 2; out[2] = a * 0.36; out[1] = ry + 0.13 * (1 - a * a) + 0.012 * Math.sin(u * 20); }, (u, v, i, j) => (i === 0 || i === 7 ? sh(0xb8a888, 0.7) : j & 1 ? 0xb8a888 : 0xa89878)));
  for (const x of [-0.42, 0, 0.42]) k.m(torus(0.29, 0.012, 4, 12, PI), L.metal, T(x, ry - 0.02, 0, 0, PI / 2, 0, 1, 0.5, 1));
  hanger(k, L, ry + 0.1, { yoke: 0.42, drop: 0.14 }); load(k, [['barrel', -0.25, -0.1, 1.2], ['barrel', -0.25, 0.13, 1.0], ['crate', 0.02, 0.0, 1.2, 0.2], ['sack', 0.27, 0.1, 1.1], ['barrel', 0.27, -0.12, 0.9]]);
  k.m(torus(0.07, 0.01, 4, 12), L.metal, T(0.46, -0.9, 0, 0, PI / 2)); for (let i = 0; i < 3; i++) k.m(box(0.012, 0.14, 0.012), L.metal, T(0.46, -0.9, 0, i * 1.047, 0, 0));
  k.o(box(0.5, 0.1, 0.012), WHITE, T(0, ry + 0.02, 0.37, 0.5, 0, 0));
};
G.principalities = (k, L) => { // a merchant's stall on a wire: striped scalloped awning, bales, amphorae and a brass scale
  trolley(k, L, { col: L.trim }); const ry = car(k, L, { planks: 5, col: 0x8a5a36, rim: L.trim, pcol: L.trim, pbag: 'metal' });
  k.c(surf(12, 4, (u, v, out, i, j) => { out[0] = (u - 0.5) * 1.04; const a = (v - 0.5) * 2; out[2] = a * 0.4; out[1] = ry + 0.16 * (1 - Math.abs(a)) - (j === 0 || j === 4 ? 0.07 * Math.abs(Math.sin(u * PI * 6)) : 0); }, (u, v, i) => (i & 1 ? L.cloth : 0xf0e4c4)));
  k.m(cyl(0.012, 0.012, 1.04, 5), L.trim, T(0, ry + 0.16, 0, 0, 0, PI / 2)); for (const x of [-0.52, 0.52]) k.m(ball(0.025, 6, 5), L.trim, T(x, ry + 0.16, 0));
  hanger(k, L, ry + 0.16, { col: L.trim }); load(k, [['bale', -0.24, -0.1, 0.9, 0, L.cloth], ['bale', -0.24, 0.1, 0.85, 0.2, L.cloth2], ['jar', 0.05, 0.12, 1], ['jar', 0.06, -0.1, 0.9, 0, 0x4a7a8a], ['chest', 0.28, 0.0, 0.85, PI / 2]]);
  cargo(k, 'bale', -0.22, -1.07, 0, 0.8, 0.1, 0xc8b070); for (const x of [-1, 1]) netbag(k, x * 0.5, -0.92, 0.0, 0.5, x > 0 ? SACK : 0xa86a4a);
  k.m(cyl(0.006, 0.006, 0.24, 4), L.trim, T(0.3, ry - 0.06, 0.2, 0, 0, PI / 2)); for (const x of [0.2, 0.4]) { k.m(cyl(0.004, 0.004, 0.1, 3), L.trim, T(x, ry - 0.11, 0.2)); k.m(cyl(0.04, 0.03, 0.012, 8), L.trim, T(x, ry - 0.16, 0.2)); }
};
G.sunkings = (k, L) => { // a gilded litter with a sun-disc at either end and a rayed canopy
  trolley(k, L, { col: L.trim }); const gold = L.trim, ry = car(k, L, { col: L.cloth, rim: gold, pcol: gold, pbag: 'metal', wall: 0.18 });
  k.m(rev([[0.56, 0], [0.5, 0.03], [0.3, 0.09], [0.1, 0.13], [0, 0.14]], 24, (u, v, i) => (i & 1 ? gold : L.cloth2), { sx: 0.9, sz: 0.62, ex: 3 }), null, T(0, ry, 0));
  for (const x of [-1, 1]) { k.push(T(x * 0.45, -0.95, 0, 0, x > 0 ? PI / 2 : -PI / 2, 0)); k.m(cyl(0.12, 0.12, 0.02, 14), gold, T(0, 0, 0, PI / 2)); k.m(ball(0.07, 8, 6), sh(gold, 1.15), T(0, 0, 0.01, 0, 0, 0, 1, 1, 0.4)); for (let i = 0; i < 12; i++) k.m(cone(0.022, i & 1 ? 0.07 : 0.11, 4), gold, T(Math.cos(i * PI / 6) * 0.16, Math.sin(i * PI / 6) * 0.16, 0, 0, 0, i * PI / 6 - PI / 2)); k.pop(); }
  hanger(k, L, ry + 0.13, { col: gold }); load(k, [['chest', -0.22, 0, 1, PI / 2], ['jar', 0.02, 0.12], ['sack', 0.04, -0.1, 1, 0, 0xd8c08a], ['crate', 0.26, 0.04, 1.05, 0.3], ['jar', 0.26, -0.16, 0.7, 0, 0xc8a040]]);
  for (const z of [-1, 1]) for (let i = 0; i < 7; i++) k.m(cone(0.02, 0.08, 4), gold, T(-0.36 + i * 0.12, ry - 0.04, z * 0.3, PI, 0, 0));
};
G.aethel = (k, L) => { // a leaf-light swan skiff of pale wood hung from a gilded crescent, a star-crystal at its arch
  const gold = L.trim, glow = L.glow; trolley(k, L, { col: gold, trim: 0xf0ece0 });
  const P = hull(k, { len: 0.98, wid: 0.58, h: 0.36, y: -1.27, col: L.wood, rail: gold, strakes: 5, sheer: 0.1 });
  k.s(sweep([[0.45, -1.02, 0], [0.56, -0.9, 0], [0.56, -0.72, 0], [0.48, -0.64, 0], [0.5, -0.72, 0]], (v) => 0.04 * (1 - v * 0.5), 6, 12, L.wood), null); k.m(cone(0.018, 0.08, 5), gold, T(0.56, -0.74, 0, 0, 0, -2.2));
  for (const x of [-1, 1]) k.m(sweep([[x * 0.42, -0.98, 0], [x * 0.46, -0.6, 0], [x * 0.24, -0.3, 0], [0, -0.16, 0]], (v) => 0.012 + 0.014 * v, 5, 14, gold), null);
  for (const z of [-1, 1]) { for (let i = 0; i < 3; i++) k.c(leaf(0.36 - i * 0.05, 0.12, 0.25 * z, i & 1 ? 0xf6f2e6 : L.cloth2, { nv: 5 }), null, T(-0.1 - i * 0.1, -1.05, z * 0.27, 0, 0, 1.3 + i * 0.08)); k.o(surf(8, 1, (u, v, out) => { P(0.25 + u * 0.5, z > 0 ? 0.88 : 0.12, 1.02, out); out[1] -= v * 0.08; }, WHITE)); }
  k.g(gem(0.05, 0.18, 6), glow, T(0, -0.36, 0), true); k.m(torus(0.07, 0.008, 4, 12), gold, T(0, -0.36, 0)); lantern(k, -0.47, -0.84, 0, glow, gold, 0.9);
  load(k, [['jar', -0.2, 0.0, 0.9, 0, 0xe8e0cc], ['chest', 0.04, 0.0, 0.8, 0.2, 0xd8d0bc], ['sack', 0.24, 0.04, 0.85, 0, 0xe0d8c0], ['jar', 0.2, -0.1, 0.6, 0, L.cloth2]], -1.2);
};
G.kaelneth = (k, L) => { // a barbed black lantern-cage on hooked blades, a violet crystal burning in its crown
  const iron = L.metal, glow = L.glow; trolley(k, L, { col: iron, trim: 0x4a3a5a });
  k.m(rev([[0, -1.3], [0.2, -1.26], [0.46, -1.2], [0.5, -1.16], [0.44, -1.15], [0, -1.17]], 6, [iron, sh(iron, 1.4), iron, sh(iron, 0.7), sh(iron, 0.7)], { sx: 0.95, sz: 0.62 }), null, null, true);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, c = Math.cos(a) * 0.95, s = Math.sin(a) * 0.62; k.m(sweep([[c * 0.47, -1.17, s * 0.47], [c * 0.56, -0.95, s * 0.56], [c * 0.4, -0.66, s * 0.4], [c * 0.06, -0.44, s * 0.06]], (v) => 0.028 * (1 - v * 0.5), 4, 12, iron), null, null, true); k.m(cone(0.022, 0.16, 4), iron, T(c * 0.58, -0.95, s * 0.58, 0, -a, -PI / 2 - 0.5)); }
  k.m(torus(0.5, 0.016, 4, 6), iron, T(0, -0.95, 0, PI / 2, 0, 0, 1.05, 0.7, 1)); k.o(rev([[0.5, -1.13], [0.535, -1.06], [0.52, -0.99]], 6, [WHITE, 0xc0c0c0], { sx: 0.95, sz: 0.62 }), null, null, true);
  k.g(gem(0.07, 0.24, 6), glow, T(0, -0.56, 0), true); hanger(k, L, -0.44, { col: iron, trim: 0x4a3a5a }); k.m(cone(0.04, 0.1, 4), iron, T(0, -1.3, 0, PI, 0, 0));
  load(k, [['chest', -0.18, 0, 0.9, 0.2, 0x2a2434], ['jar', 0.06, 0.1, 0.9, 0, 0x4a2a6a], ['crate', 0.2, -0.06, 0.85, 0.4, 0x3a3044], ['jar', -0.02, -0.12, 0.7, 0, 0x6a4a8a]], -1.15);
  for (const x of [-0.3, 0.3]) k.g(gem(0.03, 0.1, 5), glow, T(x, -1.02, 0.25), true);
};
G.grom = (k, L) => { // a riveted iron ore-skip on a forked hanger, heaped with gold ore and kegs
  const iron = sh(L.metal, 1.5), gold = L.trim; trolley(k, L, { col: sh(L.metal, 1.3), r: 1.0 });
  k.m(rev([[0, -1.3], [0.34, -1.3], [0.4, -1.26], [0.5, -0.86], [0.52, -0.84], [0.52, -0.8], [0.46, -0.8], [0.37, -1.22], [0, -1.24]], 24, [sh(iron, 0.7), gold, iron, gold, sh(iron, 1.2), sh(iron, 0.6), sh(iron, 0.6), sh(iron, 0.5)], { ex: 6, sx: 0.88, sz: 0.58 }), null);
  for (const y of [-1.18, -0.95]) { const f = 0.4 + (y + 1.26) * 0.25; for (let i = 0; i < 9; i++) for (const z of [-1, 1]) k.m(ball(0.014, 5, 4), gold, T((-0.4 + i * 0.1) * f * 2.1, y, z * (f * 0.58 + 0.005))); }
  for (const z of [-1, 1]) { k.o(rbox(0.6, 0.12, 0.014, 0.005, 1), WHITE, T(0, -1.07, z * 0.265, z * -0.2, 0, 0)); k.m(cyl(0.05, 0.05, 0.06, 8), gold, T(0, -0.86, z * 0.33, PI / 2)); k.m(sweep([[0, -0.86, z * 0.34], [0, -0.6, z * 0.36], [0, -0.36, z * 0.2], [0, -0.2, 0]], 0.028, 6, 12, sh(L.metal, 1.3)), null); }
  k.rod('metal', sh(L.metal, 1.3), [0, -0.14, 0], [0, -0.22, 0], 0.03, 6);
  k.s(ball(0.36, 10, 6), (x, y, z) => (rnd(Math.floor(x * 30) + Math.floor(z * 40) * 7) > 0.6 ? 0xd8b040 : 0x5a5a66), T(0, -0.86, 0, 0, 0, 0, 0.95, 0.3, 0.6), true);
  for (let i = 0; i < 5; i++) k.s(new THREE.DodecahedronGeometry(0.05 + 0.02 * rnd(i)), i & 1 ? 0xd8b040 : 0x6a6a74, T(-0.2 + i * 0.1, -0.76 + 0.02 * rnd(i * 3), 0.1 * Math.sin(i * 2)), true);
  cargo(k, 'barrel', 0.3, -0.84, 0.0, 0.8, 0); cargo(k, 'barrel', -0.3, -0.86, 0.02, 0.75, 0); lantern(k, 0.46, -0.9, 0.22, L.glow, L.metal, 1.0);
};
G.tianlong = (k, L) => { // a red lacquer pavilion-car with gilt lattice, a swept green-tiled roof and paper lanterns at the eaves
  const gold = L.trim, red = L.cloth; trolley(k, L, { col: sh(L.metal, 1.4) }); const ry = car(k, L, { col: red, rim: gold, pcol: 0x7a1a14, wall: 0.2 });
  for (const z of [-1, 1]) { k.m(box(0.8, 0.014, 0.014), gold, T(0, ry - 0.06, z * 0.26)); for (let i = 0; i < 7; i++) k.m(box(0.012, 0.07, 0.012), gold, T(-0.36 + i * 0.12, ry - 0.03, z * 0.26)); }
  k.s(rev([[1.3, 0], [1.02, 0.015], [0.66, 0.07], [0.32, 0.16], [0.1, 0.26], [0, 0.28]], 28, (u, v) => (v < 0.14 ? gold : v > 0.9 ? gold : Math.floor(u * 56) & 1 ? 0x2a4a3a : 0x234034), { ex: 6, up: 0.15, spl: 8, sx: 0.47, sz: 0.33 }), null, T(0, ry, 0)); k.m(rev([[0, 0], [0.035, 0.015], [0.015, 0.04], [0.04, 0.07], [0, 0.13]], 8, gold), null, T(0, ry + 0.27, 0));
  hanger(k, L, ry + 0.38, { trim: gold }); for (const x of [-1, 1]) for (const z of [-1, 1]) { lantern(k, x * 0.52, ry - 0.0, z * 0.36, L.glow, 0x7a1a14, 0.85); k.s(cone(0.014, 0.07, 5), red, T(x * 0.52, ry - 0.15, z * 0.36, PI, 0, 0)); }
  load(k, [['chest', -0.22, 0, 1, PI / 2, 0x6a2a1e], ['jar', 0.0, 0.1, 1, 0, 0x3a6a8a], ['bale', 0.05, -0.1, 0.8, 0, 0xc8b070], ['jar', 0.25, -0.08, 0.9, 0, 0xe8e0d0], ['sack', 0.27, 0.12, 0.85]]);
};
G.shogunate = (k, L) => { // a dark palanquin slung from a great carrying-beam: slatted sides, a curved black roof, a white curtain with the sun disc
  const lac = 0x1c1a1c, wood = 0x3a2e28, gold = L.trim; trolley(k, L, { col: sh(L.metal, 1.4) });
  const ry = car(k, L, { col: wood, planks: 8, pcol: lac, wall: 0.16, panel: false });
  k.s(rev([[1.25, 0.02], [1.0, 0.0], [0.6, 0.05], [0.25, 0.1], [0, 0.11]], 24, (u, v) => (v < 0.2 ? gold : lac), { ex: 7, up: 0.1, sx: 0.48, sz: 0.34, spl: 6 }), null, T(0, ry, 0));
  k.s(rbox(1.16, 0.06, 0.07, 0.02, 1), lac, T(0, ry + 0.16, 0)); for (const x of [-0.58, 0.58]) k.m(rbox(0.05, 0.075, 0.085, 0.01, 1), gold, T(x, ry + 0.16, 0)); for (const x of [-0.28, 0.28]) k.m(box(0.05, 0.08, 0.09), gold, T(x, ry + 0.14, 0));
  hanger(k, L, ry + 0.18, { trim: gold });
  k.o(surf(6, 3, (u, v, out) => { out[0] = (u - 0.5) * 0.5; out[1] = ry - 0.02 - v * 0.26; out[2] = 0.287 + 0.008 * Math.sin(u * 9); }, WHITE)); k.s(cyl(0.07, 0.07, 0.008, 14), L.envelope, T(0, ry - 0.15, 0.297, PI / 2)); k.o(surf(6, 3, (u, v, out) => { out[0] = (u - 0.5) * 0.5; out[1] = ry - 0.02 - v * 0.26; out[2] = -0.287; }, WHITE)); k.s(cyl(0.07, 0.07, 0.008, 14), L.envelope, T(0, ry - 0.15, -0.297, PI / 2));
  for (const z of [-1, 1]) for (const x of [-1, 1]) for (let i = 0; i < 4; i++) k.s(box(0.14, 0.012, 0.012), lac, T(x * 0.33, ry - 0.05 - i * 0.06, z * 0.265));
  load(k, [['bale', -0.24, 0, 0.9, PI / 2, 0xc8b88a], ['barrel', 0.0, 0.1, 1, 0, 0xb8a070], ['jar', 0.02, -0.1, 0.8], ['crate', 0.26, 0.0, 1.0, 0.1, 0x6a4a36]]); k.s(torus(0.085, 0.01, 4, 10), 0xd8c8a0, T(0, -1.09, 0.1, PI / 2));
};
G.thousandgods = (k, L) => { // a hanging shrine: carved posts, a tiered gilt spire, bells at the corners and a string of prayer flags
  const gold = L.trim, FL = [0xd83a2a, 0xe8a81a, 0x2a8a4a, 0x2a5ab8, 0xf0ece0, 0xc83a8a]; trolley(k, L, { col: gold });
  const ry = car(k, L, { col: L.wood, rim: gold, pcol: gold, pbag: 'metal', post: 0.44 });
  k.m(rev([[1.1, 0], [1.0, 0.03], [0.7, 0.05], [0.72, 0.09], [0.45, 0.12], [0.47, 0.16], [0.24, 0.19], [0.26, 0.22], [0.08, 0.26], [0.04, 0.34], [0, 0.36]], 24, (u, v, i, j) => (j & 1 ? L.envelope : gold), { ex: 5, sx: 0.47, sz: 0.33 }), null, T(0, ry, 0));
  hanger(k, L, ry + 0.34, { col: gold }); for (const x of [-1, 1]) for (const z of [-1, 1]) { k.m(rev([[0.03, -0.07], [0.032, -0.05], [0.018, -0.02], [0.005, 0]], 7, gold), null, T(x * 0.5, ry - 0.02, z * 0.35)); k.s(ball(0.03, 6, 5), FL[(x + 1) + (z + 1) / 2], T(x * 0.41, -0.96, z * 0.26)); }
  for (const z of [-1, 1]) { for (let i = 0; i < 7; i++) k.c(box(0.085, 0.09, 0.006), FL[(i + (z > 0 ? 0 : 3)) % 6], T(-0.36 + i * 0.12, ry - 0.07 - 0.03 * Math.sin((PI * i) / 6), z * 0.27)); for (let i = 0; i < 3; i++) { k.s(rev([[0.035, 0], [0.04, 0.02], [0.02, 0.06], [0, 0.07]], 6, FL[(i * 2 + 1) % 6]), null, T(-0.26 + i * 0.26, -1.0, z * 0.3)); k.s(ball(0.024, 6, 5), FL[(i * 2 + 1) % 6], T(-0.26 + i * 0.26, -0.91, z * 0.3)); } }
  load(k, [['jar', -0.24, -0.06, 1, 0, 0xd8a84a], ['sack', -0.2, 0.12, 0.8, 0, L.envelope], ['bale', 0.03, 0.0, 0.9, 0.3, 0xe8a81a], ['jar', 0.26, 0.08, 0.9], ['sack', 0.25, -0.12, 0.9]]);
};
G.caliphate = (k, L) => { // an arcaded howdah with a brass onion dome and crescent, carpets over the sides, tall jars within
  const gold = L.trim, c2 = L.cloth2; trolley(k, L, { col: gold }); const ry = car(k, L, { col: L.wood, rim: gold, pcol: 0xf0e6c8, post: 0.46, panel: false });
  for (const z of [-1, 1]) { for (const x of [-0.2, 0.2]) k.s(torus(0.2, 0.022, 4, 12, PI), 0xf0e6c8, T(x, ry - 0.2, z * 0.26, 0, 0, 0, 1, 1.0, 1)); k.s(rbox(0.04, 0.26, 0.04, 0.01, 1), 0xf0e6c8, T(0, ry - 0.33, z * 0.26)); k.c(surf(6, 3, (u, v, out) => { out[0] = (u - 0.5) * 0.5; out[1] = -0.98 - v * 0.22; out[2] = z * (0.288 + 0.006 * Math.sin(u * 9)); }, (u, v, i, j) => (i === 0 || i === 5 || j === 2 ? gold : (i + j) & 1 ? c2 : 0x9a2a2a))); for (const x of [-0.34, 0.34]) k.o(box(0.14, 0.2, 0.012), WHITE, T(x, -1.09, z * 0.286)); }
  k.s(rbox(0.94, 0.05, 0.64, 0.015, 1), 0xf0e6c8, T(0, ry, 0)); k.m(rev([[0.24, 0], [0.3, 0.05], [0.29, 0.12], [0.2, 0.19], [0.08, 0.24], [0.02, 0.3], [0, 0.31]], 16, (u, v, i) => (i & 1 ? gold : sh(gold, 0.8)), { spl: 8 }), null, T(0, ry + 0.02, 0)); k.m(torus(0.04, 0.009, 4, 10, PI * 1.5), gold, T(0, ry + 0.38, 0, 0, 0, PI * 0.75));
  hanger(k, L, ry + 0.3, { col: gold }); for (const x of [-1, 1]) lantern(k, x * 0.36, ry - 0.06, 0, L.glow, gold, 0.9);
  load(k, [['jar', -0.26, -0.06, 1.15, 0, 0xc8a040], ['jar', -0.22, 0.14, 0.8, 0, 0x2a8a9a], ['sack', 0.0, 0.0, 1.1, 0, 0xd8c08a], ['jar', 0.25, 0.1, 1.0], ['bale', 0.24, -0.12, 0.7, 0, 0x9a2a2a]]);
};
G.khemet = (k, L) => { // a painted barque of the dead with a gilt shrine amidships, jars of the embalmers and green-glowing eyes at the prow
  const gold = L.trim, blue = 0x1e4a8a, glow = L.glow; trolley(k, L, { col: gold });
  const P = hull(k, { len: 1.0, wid: 0.56, h: 0.3, y: -1.3, col: L.cloth, rail: gold, strakes: 4, sheer: 0.26, blunt: 2.6, stern: 1 });
  for (const x of [-1, 1]) { k.s(sweep([[x * 0.44, -1.02, 0], [x * 0.52, -0.9, 0], [x * 0.5, -0.74, 0], [x * 0.44, -0.66, 0]], (v) => 0.035 * (1 - v * 0.3), 6, 8, (u, v, i, j) => (j & 1 ? blue : gold)), null); k.c(leaf(0.14, 0.14, 0.3 * x, gold, { nv: 4 }), null, T(x * 0.44, -0.68, 0, 0, PI / 2, x * 0.2)); }
  for (const z of [-1, 1]) { k.g(ball(0.025, 6, 5), glow, T(0.36, -1.08, z * 0.18)); k.o(surf(8, 1, (u, v, out) => { P(0.25 + u * 0.5, z > 0 ? 0.86 : 0.14, 1.02, out); out[1] -= v * 0.08; }, WHITE)); }
  k.s(rbox(0.3, 0.3, 0.24, 0.015, 1), 0xcfc4a0, T(0, -1.05, 0)); for (const z of [-1, 1]) for (let i = 0; i < 3; i++) k.s(box(0.05, 0.22, 0.008), i & 1 ? gold : blue, T(-0.08 + i * 0.08, -1.05, z * 0.122)); k.m(rev([[0.24, 0], [0.22, 0.03], [0, 0.14]], 4, gold, { rot: PI / 4 }), null, T(0, -0.9, 0), true);
  hanger(k, L, -0.76, { col: gold }); for (const x of [-1, 1]) k.rod('metal', gold, [0, -0.5, 0], [x * 0.36, -0.98, 0], 0.012, 4);
  load(k, [['jar', -0.28, 0.08, 0.85, 0, 0xd8ceb0], ['jar', -0.28, -0.1, 0.85, 0, blue], ['jar', 0.27, 0.08, 0.85, 0, gold], ['jar', 0.27, -0.1, 0.85, 0, 0x1a6a6a]], -1.2); for (const [x, z] of [[-0.28, 0.08], [-0.28, -0.1], [0.27, 0.08], [0.27, -0.1]]) k.s(ball(0.035, 6, 5), 0x2a2a2a, T(x, -0.945, z));
};
G.velikaya = (k, L) => { // a little log izba on a wire: notched logs, carved gable-boards, a gilded onion on the ridge, furs and kegs
  const gold = L.trim, wood = L.wood; trolley(k, L);
  k.s(rbox(0.9, 0.05, 0.6, 0.015, 1), sh(wood, 0.6), T(0, -1.225, 0));
  for (let i = 0; i < 4; i++) { const y = -1.16 + i * 0.075; for (const z of [-1, 1]) k.s(cyl(0.04, 0.04, 0.96, 8), sh(wood, 0.9 + 0.2 * rnd(i + z)), T(0, y, z * 0.26, 0, 0, PI / 2)); for (const x of [-1, 1]) k.s(cyl(0.04, 0.04, 0.64, 8), sh(wood, 0.9 + 0.2 * rnd(i * 3 + x)), T(x * 0.41, y + 0.037, 0, PI / 2)); }
  for (const x of [-1, 1]) for (const z of [-1, 1]) k.s(rbox(0.05, 0.3, 0.05, 0.01, 1), sh(wood, 0.7), T(x * 0.41, -0.72, z * 0.26));
  const ry = -0.58; k.s(gable(1.02, 0.2, 0.72), (x, y, z) => (Math.floor(x / 0.085 + 20) & 1 ? L.cloth : sh(L.cloth, 0.8)), T(0, ry, 0)); for (const x of [-1, 1]) for (const z of [-1, 1]) k.s(box(0.02, 0.05, 0.42), L.cloth2, T(x * 0.515, ry + 0.09, z * 0.18, z * 0.5, 0, 0));
  k.m(rev([[0.03, 0], [0.1, 0.05], [0.095, 0.1], [0.04, 0.15], [0.01, 0.2], [0, 0.24]], 12, (u, v, i) => (i & 1 ? gold : sh(gold, 0.8)), { spl: 8 }), null, T(0, ry + 0.18, 0)); hanger(k, L, ry + 0.4, {});
  for (const z of [-1, 1]) { k.o(box(0.6, 0.1, 0.012), WHITE, T(0, -1.0, z * 0.303)); k.c(surf(3, 3, (u, v, out) => { out[0] = -0.3 + (u - 0.5) * 0.2; out[1] = -0.86 - v * 0.2; out[2] = z * (0.305 + 0.02 * Math.sin(v * PI)); }, (u, v, i, j) => sh(0x6a4a32, 0.8 + 0.3 * rnd(i + j * 4)))); }
  load(k, [['barrel', -0.22, 0.0, 1.2], ['sack', 0.03, 0.08, 1], ['crate', 0.25, 0.0, 1.1, 0.2], ['barrel', 0.02, -0.12, 0.8]], -1.2);
};
G.undead = (k, L) => { // a coffin slung on chains from a spine-and-rib hanger, grave-goods lashed on its lid, a skull at the head
  const bone = L.trim, glow = L.glow, wood = 0x2a2420, chain = 0x3a3a40; trolley(k, L, { col: 0x3a3a40, trim: bone });
  const cof = [[-0.46, 0.16], [-0.24, 0.28], [0.46, 0.2], [0.46, -0.2], [-0.24, -0.28], [-0.46, -0.16]];
  for (let i = 0; i < 6; i++) { const A = cof[i], Bq = cof[(i + 1) % 6], mx = (A[0] + Bq[0]) / 2, mz = (A[1] + Bq[1]) / 2, len = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]), ry = -Math.atan2(Bq[1] - A[1], Bq[0] - A[0]); k.s(rbox(len + 0.02, 0.26, 0.035, 0.01, 1), i & 1 ? wood : sh(wood, 1.3), T(mx, -1.1, mz, 0, ry, 0)); k.s(box(len + 0.04, 0.03, 0.05), bone, T(mx, -0.97, mz, 0, ry, 0)); if (i === 1 || i === 4) k.o(box(len * 0.8, 0.12, 0.01), WHITE, T(mx, -1.11, mz * 1.085, 0, ry, 0)); }
  k.s(new THREE.ExtrudeGeometry(new THREE.Shape(cof.map((q) => new THREE.Vector2(q[0], q[1]))), { depth: 0.04, bevelEnabled: false }), sh(wood, 0.8), T(0, -1.2, 0, PI / 2, 0, 0));
  for (let i = 0; i < 7; i++) k.s(ball(0.035, 6, 5), bone, T(0, -0.2 - i * 0.06, 0, 0, 0, 0, 1, 0.8, 1));
  for (let i = 0; i < 3; i++) for (const z of [-1, 1]) k.s(sweep([[0, -0.3 - i * 0.1, 0], [0, -0.32 - i * 0.1, z * 0.16], [0, -0.46 - i * 0.1, z * 0.22], [0, -0.58 - i * 0.1, z * 0.12]], (v) => 0.02 * (1 - v * 0.6) + 0.004, 4, 8, bone), null);
  for (const x of [-0.36, 0.38]) for (const z of [-1, 1]) k.rod('metal', chain, [0, -0.6, 0], [x, -0.97, z * 0.18], 0.01, 4);
  skull(k, T(-0.5, -1.04, 0, 0, -PI / 2, 0, 0.2), bone, glow); lantern(k, 0.5, -0.86, 0, glow, 0x2a2a2e, 1.1); k.m(sweep([[0.46, -0.98, 0], [0.54, -0.9, 0], [0.5, -0.83, 0]], 0.008, 3, 5, chain), null);
  load(k, [['crate', -0.2, 0.0, 1, 0.2, 0x3a3230], ['jar', 0.04, 0.08, 0.9, 0, 0x4a4a52], ['sack', 0.25, 0.0, 0.9, 0, 0x6a6a66], ['jar', 0.03, -0.1, 0.7, 0, 0x8a8a80]], -1.16);
};
G.crimson = (k, L) => { // a black gothic coach-car with lancet windows lit red, velvet swags, a spired roof and a bat at the crest
  const blk = 0x141216, gold = L.trim, main = L.cloth; trolley(k, L, { col: 0x2a2a2e, trim: gold });
  k.s(rbox(0.84, 0.48, 0.54, 0.04, 2), blk, T(0, -0.98, 0)); k.m(rbox(0.88, 0.04, 0.58, 0.015, 1), gold, T(0, -1.21, 0)); k.m(rbox(0.88, 0.035, 0.58, 0.015, 1), gold, T(0, -0.75, 0));
  for (const z of [-1, 1]) { for (const x of [-0.26, 0, 0.26]) { k.g(box(0.1, 0.16, 0.01), 0xff3a2a, T(x, -0.95, z * 0.273)); k.g(cone(0.05, 0.08, 3), 0xff3a2a, T(x, -0.83, z * 0.27, 0, 0, 0, 1, 1, 0.1)); k.m(box(0.012, 0.24, 0.014), gold, T(x, -0.92, z * 0.276)); } k.c(surf(10, 2, (u, v, out) => { out[0] = (u - 0.5) * 0.8; out[1] = -0.78 - v * (0.05 + 0.06 * Math.abs(Math.sin(u * PI * 3))); out[2] = z * 0.283; }, (u, v, i, j) => (j ? gold : main))); k.o(box(0.76, 0.08, 0.012), WHITE, T(0, -1.13, z * 0.274)); }
  k.m(rev([[1.05, 0], [0.95, 0.03], [0.5, 0.08], [0.2, 0.16], [0.06, 0.26], [0, 0.3]], 4, (u, v, i, j) => (j === 0 ? gold : blk), { rot: PI / 4, sx: 0.62, sz: 0.42 }), null, T(0, -0.73, 0), true);
  for (const x of [-1, 1]) for (const z of [-1, 1]) k.m(cone(0.025, 0.2, 4), blk, T(x * 0.4, -0.65, z * 0.25));
  wing(k, T(0, -0.52, 0.02, 0, 0, 0.3, 1), 0.2, 1.3, 3, sh(main, 0.7), blk); wing(k, T(0, -0.52, 0.02, 0, PI, 0.3), 0.2, 1.3, 3, sh(main, 0.7), blk);
  hanger(k, L, -0.45, { col: 0x2a2a2e, trim: gold }); for (const x of [-1, 1]) { lantern(k, x * 0.47, -0.82, 0.29, 0xff3a2a, blk, 0.9); k.m(rbox(0.07, 0.025, 0.36, 0.008, 1), gold, T(x * 0.49, -1.16, 0)); cargo(k, x > 0 ? 'chest' : 'crate', x * 0.5, -1.15, 0, 0.7, PI / 2, x > 0 ? 0x2a1a16 : 0x3a2a2a); }
  cargo(k, 'jar', 0.12, -0.6, -0.14, 0.5, 0, 0x5a1a1e);
};
G.drowned = (k, L) => { // a rotted ship's boat on barnacled chains, ribs showing, a ghost-lamp at the stern and weed trailing
  const glow = L.glow, chain = 0x2a3230, weed = 0x2a5a3a; trolley(k, L, { col: 0x3a4640, trim: 0x6a7a6a });
  const P = hull(k, { len: 0.98, wid: 0.58, h: 0.32, y: -1.3, col: L.wood, strakes: 5, rail: sh(L.wood, 0.5), stern: 0.6, sheer: 0.08 });
  for (let i = 0; i < 5; i++) { const u = 0.16 + i * 0.16; for (const sv of [0.06, 0.94]) { const a = [0, 0, 0], b = [0, 0, 0]; P(u, sv, 0.9, a); P(u, 0.5, 0.9, b); k.s(sweep([a, [a[0], (a[1] + b[1]) / 2 - 0.05, a[2] * 0.82], b], 0.014, 4, 6, sh(L.wood, 0.7)), null); } }
  for (let i = 0; i < 14; i++) { const q = [0, 0, 0]; P(rnd(i) * 0.9 + 0.05, rnd(i * 3) * 0.8 + 0.1, 1.01, q); k.s(cone(0.025, 0.03, 5), 0xb8b8a0, T(q[0], q[1], q[2], rnd(i) * 3, 0, rnd(i * 2) * 3)); }
  for (const z of [-1, 1]) k.o(surf(8, 1, (u, v, out) => { P(0.25 + u * 0.5, z > 0 ? 0.88 : 0.12, 1.02, out); out[1] -= v * 0.09; }, WHITE));
  k.m(torus(0.05, 0.012, 4, 10), chain, T(0, -0.22, 0)); for (const x of [-0.4, 0.42]) { const q = [0, 0, 0]; P(x + 0.5, 0.5, 0, q); for (const z of [-1, 1]) { const e = [x, -0.99, z * 0.12]; k.rod('metal', chain, [0, -0.26, 0], e, 0.012, 4); for (let t = 1; t < 6; t++) k.m(torus(0.02, 0.006, 3, 6), chain, T(x * t / 6, -0.26 - 0.73 * t / 6, e[2] * t / 6, 0, t & 1 ? PI / 2 : 0, 0)); } }
  k.rod('metal', chain, [0, -0.14, 0], [0, -0.2, 0], 0.016, 5);
  for (let i = 0; i < 6; i++) { const q = [0, 0, 0]; P(0.15 + i * 0.14, i & 1 ? 0.95 : 0.05, 1.02, q); if (q[1] - 0.2 > -1.36) k.c(sweep([q, [q[0] + 0.02, q[1] - 0.12, q[2] * 1.05], [q[0], Math.max(-1.34, q[1] - 0.26), q[2] * 1.02]], (v) => 0.02 * (1 - v * 0.8), 3, 5, weed), null); }
  lantern(k, -0.5, -0.84, 0, glow, chain, 1.1); k.m(sweep([[-0.44, -1.0, 0], [-0.54, -0.9, 0], [-0.5, -0.81, 0]], 0.008, 3, 5, chain), null); k.g(ball(0.03, 6, 5), glow, T(0.3, -1.12, 0.1));
  load(k, [['barrel', -0.2, 0.02, 1, 0, 0x3a4a40], ['chest', 0.06, 0.0, 0.85, 0.3, 0x2a3a34], ['crate', 0.26, 0.02, 0.8, 0.5, 0x4a5a4a], ['jar', -0.02, -0.12, 0.6, 0, 0x5a7a6a]], -1.2);
};
G.infernal = (k, L) => { // a spiked iron gibbet-cage with a coal-pan glowing under it, hung on a hook and chain
  const iron = 0x2a2a2e, glow = L.glow; trolley(k, L, { col: iron, trim: L.trim });
  k.m(rbox(0.88, 0.05, 0.58, 0.015, 1), iron, T(0, -1.2, 0)); for (const y of [-0.98, -0.72]) for (let s = 0; s < 4; s++) k.m(box(s & 1 ? 0.56 : 0.86, 0.035, 0.035), iron, T(s === 1 ? 0.415 : s === 3 ? -0.415 : 0, y, s === 0 ? 0.265 : s === 2 ? -0.265 : 0, 0, s & 1 ? PI / 2 : 0, 0));
  for (let i = 0; i < 9; i++) for (const z of [-1, 1]) { k.m(cyl(0.012, 0.012, 0.5, 5), iron, T(-0.4 + i * 0.1, -0.96, z * 0.265)); k.m(cone(0.018, 0.09, 4), iron, T(-0.4 + i * 0.1, -0.66, z * 0.265)); }
  for (let i = 0; i < 5; i++) for (const x of [-1, 1]) k.m(cyl(0.012, 0.012, 0.5, 5), iron, T(x * 0.415, -0.96, -0.2 + i * 0.1));
  for (const x of [-1, 1]) for (const z of [-1, 1]) { k.m(sweep([[x * 0.415, -0.72, z * 0.265], [x * 0.3, -0.52, z * 0.18], [0, -0.38, 0]], 0.016, 4, 8, iron), null); k.m(cone(0.035, 0.2, 4), iron, T(x * 0.44, -1.2, z * 0.29, 0, 0, 0).multiply(TA([0, 0, 0], [x, -0.3, z]))); }
  k.m(sweep([[0, -0.14, 0], [0, -0.26, 0], [0.05, -0.33, 0], [0, -0.4, 0], [-0.04, -0.35, 0]], 0.018, 5, 10, iron), null);
  for (const z of [-1, 1]) k.o(box(0.8, 0.13, 0.012), WHITE, T(0, -1.1, z * 0.282));
  k.m(rev([[0, -1.34], [0.1, -1.33], [0.2, -1.26], [0.16, -1.25], [0, -1.27]], 8, iron), null, null, true); k.g(ball(0.13, 8, 5), glow, T(0, -1.255, 0, 0, 0, 0, 1, 0.25, 1));
  load(k, [['crate', -0.24, -0.06, 1.1, 0.2, 0x4a3a34], ['barrel', -0.22, 0.14, 0.8, 0, 0x3a2a26], ['chest', 0.02, 0.0, 0.9, 0.4, 0x2a2224], ['sack', 0.26, 0.08, 1, 0, 0x5a3a30], ['crate', 0.26, -0.12, 0.75, 0.5, 0x4a3a34]]);
  skull(k, T(0.44, -0.9, 0, 0, PI / 2, 0, 0.14), 0x8a7a6a, glow, 1);
};
G.ironbound = (k, L) => { // an armoured strong-box of riveted plate with shuttered slits, ram-spikes fore and aft, kit lashed on the roof
  const iron = sh(L.metal, 1.6), st = sh(L.metal, 2.0), tr = L.trim; trolley(k, L, { col: sh(L.metal, 1.4) });
  k.m(rbox(0.84, 0.5, 0.54, 0.02, 1), iron, T(0, -0.99, 0)); k.m(rbox(0.9, 0.05, 0.6, 0.012, 1), st, T(0, -1.22, 0)); k.m(rbox(0.9, 0.05, 0.6, 0.012, 1), st, T(0, -0.74, 0));
  for (const z of [-1, 1]) { for (const x of [-0.28, 0, 0.28]) { k.m(box(0.012, 0.44, 0.012), st, T(x + 0.14, -0.98, z * 0.274)); k.s(box(0.16, 0.03, 0.01), DARK, T(x, -0.88, z * 0.272)); k.g(box(0.1, 0.012, 0.01), L.glow, T(x, -0.88, z * 0.275)); } for (let i = 0; i < 9; i++) for (const y of [-1.17, -0.79]) k.m(ball(0.014, 5, 4), tr, T(-0.4 + i * 0.1, y, z * 0.274)); k.o(box(0.8, 0.14, 0.012), WHITE, T(0, -1.05, z * 0.273)); }
  for (const x of [-1, 1]) { k.m(cone(0.06, 0.2, 4), st, T(x * 0.5, -1.0, 0, 0, 0, -x * PI / 2)); for (const z of [-0.16, 0.16]) k.m(cone(0.03, 0.1, 4), st, T(x * 0.46, -1.1, z, 0, 0, -x * PI / 2)); }
  hanger(k, L, -0.7, { yoke: 0.36, drop: 0.02, r: 0.026 }); k.m(box(0.86, 0.02, 0.02), st, T(0, -0.66, 0.24)); k.m(box(0.86, 0.02, 0.02), st, T(0, -0.66, -0.24));
  load(k, [['crate', -0.24, 0.0, 1.0, 0.1, 0x4a4640], ['barrel', 0.0, 0.1, 0.8, 0, 0x3a3a40], ['crate', 0.22, -0.04, 0.8, 0.3, 0x5a4a3a], ['sack', 0.02, -0.1, 0.8, 0, 0x6a6458]], -0.715);
};
G.ashur = (k, L) => { // a stepped bronze fire-skip like an upturned ziggurat, horned at the ends, coals aglow below, jars of naphtha aboard
  const br = L.trim, glow = L.glow, main = L.cloth; trolley(k, L, { col: sh(L.metal, 1.5), trim: br });
  k.m(rev([[0, -1.33], [0.2, -1.33], [0.2, -1.24], [0.34, -1.24], [0.34, -1.12], [0.44, -1.12], [0.44, -0.98], [0.52, -0.98], [0.52, -0.86], [0.46, -0.86], [0.42, -1.19], [0, -1.2]], 24, [br, sh(main, 1.3), br, main, br, sh(main, 1.3), br, main, sh(br, 0.5), sh(br, 0.5), sh(br, 0.4)], { ex: 8, sx: 0.86, sz: 0.56 }), null);
  for (const z of [-1, 1]) k.o(box(0.72, 0.09, 0.012), WHITE, T(0, -0.92, z * 0.295)); for (const x of [-1, 1]) { k.s(sweep([[x * 0.44, -0.9, 0], [x * 0.56, -0.86, 0], [x * 0.58, -0.7, 0], [x * 0.5, -0.6, 0]], (v) => 0.035 * (1 - v * 0.8) + 0.004, 5, 8, 0xe0d4b0), null); k.g(cone(0.03, 0.08, 5), glow, T(x * 0.36, -0.8, 0.22)); k.m(cyl(0.035, 0.025, 0.03, 6), br, T(x * 0.36, -0.85, 0.22)); }
  k.g(box(0.2, 0.03, 0.2), glow, T(0, -1.34, 0)); for (const x of [-1, 1]) for (const z of [-1, 1]) k.m(sweep([[x * 0.4, -0.86, z * 0.24], [x * 0.3, -0.56, z * 0.16], [0, -0.36, 0]], 0.014, 4, 8, br), null);
  hanger(k, L, -0.36, { col: br }); load(k, [['jar', -0.24, -0.04, 1.1, 0, 0x8a4a2a], ['jar', -0.2, 0.14, 0.7, 0, 0x2a5a8a], ['crate', 0.02, 0.0, 1, 0.2, 0x6a4a3a], ['jar', 0.26, 0.06, 1, 0, 0x2a5a8a], ['sack', 0.24, -0.12, 0.8, 0, 0x8a6a4a]], -1.19);
};
G.goblin = (k, L) => { // a tin bath and half a crate nailed together, hung skew-whiff on rope and a bent hook, with a patched brolly on top
  const junk = [0x6a5a48, 0x8a5a2a, 0x5a5a60, 0x7a6a50]; trolley(k, L, { col: 0x6a5a48, trim: 0x8a5a2a, r: 0.9 });
  k.push(T(0, 0, 0, 0, 0.05, 0.06));
  k.m(rev([[0, -1.28], [0.3, -1.28], [0.42, -1.2], [0.5, -0.92], [0.53, -0.9], [0.5, -0.88], [0.4, -1.18], [0, -1.22]], 20, [0x5a5a60, 0x6a6a70, 0x7a7a80, 0x8a5a2a, 0x4a4a50, 0x4a4a50, 0x3a3a40], { ex: 3, sx: 0.6, sz: 0.56 }), null, T(-0.14, 0, 0));
  k.push(T(0.26, -1.26, 0, 0, 0.1, 0)); tub(k, { w: 0.4, d: 0.52, h: 0.3, col: L.wood, planks: 3, th: 0.03 }); k.pop();
  for (let i = 0; i < 4; i++) k.m(box(0.22, 0.14, 0.012), junk[i], T(-0.3 + i * 0.2, -1.05 - 0.05 * (i & 1), i & 1 ? 0.3 : -0.3, 0, 0, 0.2 * (i - 1.5)));
  k.o(box(0.34, 0.14, 0.014), WHITE, T(0.26, -1.1, 0.268, 0, 0.1, -0.06)); k.o(box(0.34, 0.14, 0.014), WHITE, T(-0.1, -1.04, -0.3, 0, 0, 0.1));
  load(k, [['crate', -0.24, 0.0, 0.95, 0.4], ['sack', -0.02, 0.08, 1], ['barrel', 0.26, -0.08, 0.9], ['jar', 0.26, 0.12, 0.7], ['sack', -0.1, -0.12, 0.8, 1, 0x7a7a4a]], -1.2);
  k.pop();
  for (const [x, z] of [[-0.42, 0.2], [0.42, 0.22], [-0.4, -0.24], [0.44, -0.2]]) k.rod('solid', ROPE, [x, -0.9, z], [0.03, -0.42, 0], 0.01, 4);
  k.m(sweep([[0, -0.14, 0], [0.02, -0.3, 0], [0.07, -0.38, 0], [0.03, -0.45, 0], [-0.02, -0.4, 0]], 0.016, 5, 10, 0x5a5a60), null);
  k.c(rev([[0.42, -0.06], [0.3, 0.0], [0.15, 0.04], [0, 0.06]], 8, (u, v, i) => [L.cloth, L.cloth2, 0x8a3a2a, 0xb8a060][i % 4]), null, T(0.05, -0.56, 0.02, 0.1, 0, -0.12), true); k.rod('solid', L.wood, [0.03, -0.5, 0.02], [-0.02, -0.9, 0.0], 0.01, 4);
  k.m(cyl(0.05, 0.04, 0.07, 8), 0x8a5a2a, T(-0.5, -1.0, 0.1)); k.m(torus(0.035, 0.006, 3, 8, PI), 0x5a5a60, T(-0.5, -0.96, 0.1));
};
G.skar = (k, L) => { // a stave-built tub wrapped in copper pipe with a fizzing green phial and a cogged trolley; tail-like cables trail behind
  const brass = 0xa8853a, glow = 0x7aff5a; trolley(k, L, { col: 0x6a5a48, trim: brass });
  for (const x of [-0.13, 0.13]) for (let i = 0; i < 8; i++) k.m(box(0.02, 0.03, 0.02), brass, T(x + Math.cos(i * PI / 4) * 0.085, 0.057 + Math.sin(i * PI / 4) * 0.085, 0.07, 0, 0, i * PI / 4));
  for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; k.s(rbox(0.17, 0.34 + 0.04 * rnd(i), 0.03, 0.008, 1), sh(L.wood, 0.8 + 0.35 * rnd(i)), T(Math.cos(a) * 0.42, -1.05, Math.sin(a) * 0.28, 0, PI / 2 - Math.atan2(Math.sin(a) * 0.42, Math.cos(a) * 0.28) + PI / 2 * 0, 0)); }
  k.s(cyl(0.42, 0.42, 0.04, 16), sh(L.wood, 0.6), T(0, -1.22, 0, 0, 0, 0, 1, 1, 0.67)); for (const y of [-1.16, -0.96]) k.m(torus(0.44, 0.014, 4, 22), 0x5a4a3a, T(0, y, 0, PI / 2, 0, 0, 1, 0.68, 1));
  k.o(surf(22, 1, (u, v, out) => { const a = u * TAU; out[0] = Math.cos(a) * 0.447; out[1] = -1.12 + v * 0.11; out[2] = Math.sin(a) * 0.3; }, (u, v, i) => (i % 4 === 0 ? 0xb0b0b0 : WHITE), { closeU: true }));
  k.m(sweep([[0.44, -1.2, 0.1], [0.5, -1.0, 0.2], [0.42, -0.8, 0.26], [0.2, -0.72, 0.3], [0.05, -0.62, 0.16], [0, -0.45, 0]], 0.018, 5, 16, (u, v, i, j) => (j % 4 === 0 ? sh(brass, 0.6) : brass)), null);
  k.g(cyl(0.035, 0.035, 0.16, 6), glow, T(0.46, -0.9, -0.16)); for (const y of [-0.99, -0.81]) k.m(cyl(0.042, 0.042, 0.025, 6), brass, T(0.46, y, -0.16)); k.g(ball(0.025, 5, 4), glow, T(0, -0.45, 0));
  for (const [x, z] of [[-0.36, 0.14], [0.36, 0.14], [-0.36, -0.14], [0.36, -0.14]]) k.rod('solid', ROPE, [x, -0.88, z], [0, -0.3, 0], 0.01, 4); k.rod('metal', 0x6a5a48, [0, -0.14, 0], [0, -0.32, 0], 0.018, 5);
  for (let i = 0; i < 2; i++) k.s(sweep([[-0.42, -1.1, i * 0.1 - 0.05], [-0.56, -1.16, i * 0.16 - 0.08], [-0.62, -1.3, i * 0.1], [-0.56, -1.34, i * 0.2 - 0.1]], (v) => 0.02 * (1 - v * 0.7), 4, 8, 0xb88a7a), null);
  load(k, [['crate', -0.2, 0.0, 1, 0.3], ['sack', 0.04, 0.08, 1], ['barrel', 0.22, -0.04, 0.9, 0, 0x5a6a3a], ['jar', 0.0, -0.1, 0.7, 0, 0x6a7a3a]], -1.2);
  k.push(T(-0.2, -0.9, 0.3, 0, 0.2, 0)); k.m(cyl(0.08, 0.08, 0.02, 10), brass, T(0, 0, 0, PI / 2)); for (let i = 0; i < 8; i++) k.m(box(0.03, 0.03, 0.02), brass, T(Math.cos(i * PI / 4) * 0.085, Math.sin(i * PI / 4) * 0.085, 0, 0, 0, i * PI / 4)); k.pop();
};

/** a pair of bone hooks over the cable joined by a thigh-bone, with sinew lines down to the load (no machinery) */
function boneHooks(k, L, o = {}) {
  const bone = o.col ?? BONE, y0 = o.y ?? -0.3;
  for (const x of [-0.12, 0.12]) { k.s(sweep([[x, y0, 0], [x, -0.14, 0.075], [x, 0.03, 0.085], [x, 0.092, 0], [x, 0.03, -0.075], [x, -0.07, -0.06]], (v) => 0.032 * (1 - v * 0.65) + 0.006, 6, 16, (u, v, i, j) => (j % 4 === 0 ? sh(bone, 0.8) : bone)), null); k.s(torus(0.036, 0.009, 4, 8), SINEW, T(x, y0 + 0.03, 0, PI / 2)); }
  k.s(cyl(0.022, 0.022, 0.4, 6), bone, T(0, y0, 0, 0, 0, PI / 2)); for (const x of [-0.2, 0.2]) for (const z of [-0.018, 0.018]) k.s(ball(0.03, 6, 5), bone, T(x, y0, z));
  for (const [x, z] of o.lines ?? [[-0.36, 0.2], [0.36, 0.2], [-0.36, -0.2], [0.36, -0.2]]) k.rod('solid', o.rope ?? SINEW, [Math.sign(x) * 0.17, y0, 0], [x, o.to ?? -0.85, z], 0.009, 4);
}
function slungBasket(k, L, o = {}) { // an oval wicker pannier with a hide collar and the owner's painted band
  const hide = o.hide ?? L.hide ?? 0x6a4a32;
  k.push(T(0, -1.24, 0)); wicker(k, { w: 0.92, d: 0.6, h: 0.4, ex: o.ex ?? 2.6, nu: 40, nv: 8, taper: 0.8, c1: o.c1 ?? 0xa88448, c2: o.c2 ?? 0x7a5c34, rim: sh(hide, 0.7), amp: 0.025 }); k.pop();
  k.o(surf(28, 1, (u, v, out, i) => { const a = u * TAU, f = sup(Math.cos(a), Math.sin(a), o.ex ?? 2.6) * (0.93 + 0.04 * v) * 1.03; out[0] = Math.cos(a) * f * 0.46; out[1] = -1.08 + v * 0.1 + 0.012 * Math.sin(i * 1.7); out[2] = Math.sin(a) * f * 0.3; }, (u, v, i) => (i % 4 === 0 ? 0xb0b0b0 : WHITE), { closeU: true }));
}
const SAV_LOAD = (L) => [['sack', -0.22, 0.0, 1.1, 0, sh(L.hide ?? 0x7a5a40, 1.3)], ['jar', 0.02, 0.08, 0.95, 0, 0x8a5a3a], ['bundle', 0.24, 0.0, 0.9, 1.2, sh(L.hide ?? 0x7a5a40, 0.9)], ['sack', 0.02, -0.1, 0.8, 1]];

G.beasts = (k, L) => { // a wicker pannier in a hide collar slung from bone hooks, a horned skull on its flank
  boneHooks(k, L); slungBasket(k, L); load(k, SAV_LOAD(L), -1.19);
  skull(k, T(0, -1.02, 0.33, 0, 0, 0, 0.14), BONE, null, 1); for (const x of [-0.46, 0.46]) k.s(cone(0.025, 0.2, 5), BONE, T(x, -0.9, 0, 0, 0, x > 0 ? -0.5 : 0.5));
  for (let i = 0; i < 5; i++) { k.rod('solid', SINEW, [-0.3 + i * 0.15, -1.22, 0.24], [-0.3 + i * 0.15, -1.3, 0.25], 0.005, 3); k.s(cone(0.012, 0.06, 4), BONE, T(-0.3 + i * 0.15, -1.32, 0.25, PI, 0, 0)); }
};
G.dragons = (k, L) => { // a cradle of great curved ribs lined with scaled hide, a drake's jaw for a prow and a wing-membrane awning
  const hide = L.hide ?? 0x8a3a2a; boneHooks(k, L, { to: -0.72 });
  k.s(rev([[0, -1.27], [0.25, -1.26], [0.42, -1.16], [0.47, -0.96], [0.44, -0.95], [0.4, -1.13], [0.24, -1.21], [0, -1.22]], 24, (u, v, i, j) => (j > 3 ? sh(hide, 0.5) : ((i + j) & 1) ? sh(hide, 0.8 + 0.3 * rnd(i * 3 + j)) : sh(hide, 0.6)), { sx: 0.98, sz: 0.64 }), null);
  for (let i = 0; i < 7; i++) { const x = -0.36 + i * 0.12; for (const z of [-1, 1]) k.s(sweep([[x, -1.3, 0], [x, -1.26, z * 0.2], [x, -1.05, z * 0.32], [x, -0.8, z * 0.27], [x, -0.7, z * 0.16]], (v) => 0.02 * (1 - v * 0.6) + 0.004, 4, 10, BONE), null); }
  k.s(cyl(0.025, 0.025, 0.92, 6), BONE, T(0, -1.31, 0, 0, 0, PI / 2)); k.o(rev([[0.455, -1.1], [0.485, -1.03], [0.48, -0.98]], 24, [WHITE, 0xc8c8c8], { sx: 0.98, sz: 0.64 }), null);
  k.push(T(0.5, -0.98, 0, 0, PI / 2, 0, 0.3)); k.s(ball(0.3, 8, 6), BONE, T(0, 0.1, 0, 0, 0, 0, 0.8, 0.7, 1)); k.s(rbox(0.3, 0.2, 0.5, 0.06, 1), BONE, T(0, 0.02, 0.4)); for (const x of [-1, 1]) { k.s(ball(0.07, 6, 5), DARK, T(x * 0.16, 0.14, 0.18)); k.s(sweep([[x * 0.15, 0.3, -0.1], [x * 0.28, 0.5, -0.4], [x * 0.2, 0.6, -0.7]], (v) => 0.06 * (1 - v * 0.8), 4, 6, BONE), null); for (let t = 0; t < 3; t++) k.s(cone(0.03, 0.1, 4), BONE, T(x * 0.12, -0.12, 0.3 + t * 0.14, PI, 0, 0)); } k.pop();
  for (const s of [-1, 1]) wing(k, T(-0.1, -0.74, s * 0.14, s * -1.25, 0, 0.3), 0.34, 2.4, 4, mix(hide, 0xd8a050, 0.35), sh(hide, 0.45));
  load(k, SAV_LOAD(L), -1.2);
};
G.cloven = (k, L) => { // a deep wicker creel hung between two curling ram-horns, hooves and charm-bones dangling beneath
  boneHooks(k, L, { col: 0x8a7a60 }); slungBasket(k, L, { c1: 0x8a6a40, c2: 0x5a4228 }); load(k, SAV_LOAD(L), -1.19);
  for (const s of [-1, 1]) { const pts = []; for (let t = 0; t <= 10; t++) { const a = (t / 10) * PI * 1.9, r = 0.17 - 0.09 * (t / 10); pts.push([s * (0.46 + 0.05 * (t / 10)), -0.92 + r * Math.cos(a) - 0.16, r * Math.sin(a)]); } k.s(sweep(pts, (v) => 0.065 * (1 - v * 0.85) + 0.005, 6, 22, (u, v, i, j) => (j & 1 ? 0x6a5a48 : 0x8a7a60)), null); }
  for (let i = 0; i < 6; i++) { const x = -0.3 + i * 0.12; k.rod('solid', SINEW, [x, -1.22, -0.24], [x, -1.29, -0.25], 0.005, 3); k.s(i & 1 ? cone(0.02, 0.05, 5) : ball(0.018, 5, 4), i & 1 ? 0x2a2220 : BONE, T(x, -1.32, -0.25, PI, 0, 0)); }
  k.s(box(0.3, 0.012, 0.012), 0x8a2a1a, T(0, -0.96, 0.315));
};
G.fimbul = (k, L) => { // a skin-boat hull on tusk runners like a slung sled, furs heaped over the gunwales, an ice-hung prow
  const hide = L.hide ?? 0xb8b0a0, fur = 0xe8e4dc, ice = 0xbfe6f4; boneHooks(k, L, { to: -0.9, lines: [[-0.38, 0.14], [0.38, 0.14], [-0.38, -0.14], [0.38, -0.14]] });
  const P = hull(k, { len: 0.96, wid: 0.56, h: 0.3, y: -1.27, col: mix(hide, 0x8a7a68, 0.5), strakes: 4, rail: 0x6a4a2a, sheer: 0.14, stern: 1 });
  for (const z of [-1, 1]) { k.s(sweep([[-0.44, -1.3, z * 0.16], [0, -1.33, z * 0.18], [0.4, -1.3, z * 0.16], [0.56, -1.14, z * 0.12], [0.58, -0.98, z * 0.1]], (v) => 0.028 * (1 - v * 0.6) + 0.006, 6, 16, BONE), null); k.o(surf(8, 1, (u, v, out) => { P(0.25 + u * 0.5, z > 0 ? 0.88 : 0.12, 1.02, out); out[1] -= v * 0.08; }, WHITE)); }
  for (let i = 0; i < 2; i++) k.s(surf(6, 5, (u, v, out, ii, j) => { const x = -0.26 + i * 0.4 + (u - 0.5) * 0.24, a = (v - 0.5) * 2.6; out[0] = x; out[1] = -0.99 + 0.07 * Math.cos(a) + 0.015 * rnd(ii * 5 + j); out[2] = Math.sin(a) * 0.31; }, (u, v, ii, j) => sh(i ? fur : 0x8a7a68, 0.8 + 0.25 * rnd(ii + j * 7))));
  for (let i = 0; i < 9; i++) k.s(cone(0.014, 0.05 + 0.07 * rnd(i), 4), ice, T(-0.4 + i * 0.1, -1.28 - 0.03 * rnd(i * 2), (i & 1 ? 1 : -1) * 0.2, PI, 0, 0));
  roundShield(k, 0, -1.12, 0.29, 0, 0.09, 0x2a4a7a, 0x6a5a48); load(k, [['sack', -0.02, 0.0, 1.0, 0, 0x9a8a78], ['barrel', 0.24, 0.0, 0.8, 0, 0x7a6a50], ['bundle', -0.02, -0.08, 0.8, 1.4, fur]], -1.19);
};
G.gorge = (k, L) => { // a round felt-wrapped pannier like a little tent, red lattice band, horsehair tufts on a carrying yoke
  const felt = 0xd8ceb4, red = 0x9a2a1e, hair = 0x1e1a18;
  boneHooks(k, L, { col: 0x6a4a2a, y: -0.34, lines: [[-0.38, 0.1], [0.38, 0.1], [-0.38, -0.1], [0.38, -0.1]], to: -0.8 });
  k.s(rev([[0, -1.28], [0.3, -1.27], [0.44, -1.2], [0.47, -0.9], [0.44, -0.83], [0.4, -0.84], [0.42, -0.9], [0.4, -1.17], [0, -1.22]], 28, (u, v, i, j) => (j === 2 ? (((i + Math.floor(v * 40)) & 1) ? red : sh(felt, 0.9)) : j > 3 ? sh(felt, 0.5) : j === 3 ? 0x4a3a2c : sh(felt, 0.88 + 0.12 * rnd(i >> 2))), { sx: 0.98, sz: 0.64 }), null);
  for (let i = 0; i < 2; i++) k.s(rev([[0.45, -1.17 + i * 0.25], [0.475, -1.16 + i * 0.25], [0.45, -1.15 + i * 0.25]], 24, 0x4a3424, { sx: 0.98, sz: 0.64 }), null);
  k.o(rev([[0.455, -1.13], [0.482, -1.09], [0.48, -1.04]], 24, [WHITE, 0xc8c8c8], { sx: 0.98, sz: 0.64 }), null);
  for (const x of [-1, 1]) { k.s(cyl(0.012, 0.012, 0.5, 5), 0x4a3424, T(x * 0.47, -0.72, 0)); k.s(cone(0.05, 0.22, 8), hair, T(x * 0.47, -0.6, 0)); k.s(torus(0.035, 0.008, 4, 8), red, T(x * 0.47, -0.49, 0, PI / 2)); }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; k.s(cyl(0.008, 0.008, 0.34, 4), 0x6a4a2a, T(Math.cos(a) * 0.47, -1.02, Math.sin(a) * 0.307, 0, -a, i & 1 ? 0.5 : -0.5)); }
  for (const x of [-0.2, 0.2]) { k.s(ball(0.04, 8, 6), 0x3a2e28, T(x, -1.29, 0.24, 0, 0, 0, 1, 1.2, 1)); k.rod('solid', SINEW, [x, -1.25, 0.24], [x, -1.14, 0.27], 0.006, 3); }
  k.c(surf(4, 4, (u, v, out) => { out[0] = (u - 0.5) * 0.3; out[1] = -0.86 - v * 0.26; out[2] = 0.31 + 0.012 * Math.sin(v * PI); }, (u, v, i, j) => (i === 0 || i === 3 || j === 3 ? 0xc8a040 : (i + j) & 1 ? red : 0x2a4a6a)));
  load(k, [['sack', -0.2, 0.0, 1.1, 0, felt], ['jar', 0.04, 0.06, 0.9, 0, 0x6a4a3a], ['bundle', 0.24, 0.0, 0.9, 1.2, 0x8a6a4a], ['sack', 0.02, -0.1, 0.8, 1, 0xb8a888]], -1.2);
};
G.verdant = (k, L) => { // a hanging seed-pod of woven vine, split open to show its cargo, leaves and a glow-berry at the stem
  const leafc = 0x3a7a34, bark = 0x5a4228, g1 = L.envelope;
  k.s(sweep([[0, -0.5, 0], [0.02, -0.2, 0.03], [0.0, -0.06, 0.08], [0, 0.07, 0.07], [0, 0.1, 0], [0, 0.04, -0.07], [0, -0.06, -0.05]], (v) => 0.03 * (1 - v * 0.5), 6, 16, (u, v, i, j) => (j & 1 ? bark : sh(bark, 1.2))), null);
  k.s(sweep([[0, -0.1, 0.06], [0.1, -0.02, 0.07], [0.14, 0.06, 0.02], [0.1, 0.09, -0.04]], 0.012, 4, 8, 0x4a8a34), null); for (const s of [-1, 1]) k.c(leaf(0.2, 0.1, 0.3, 0x5a9a3a, { nv: 4 }), null, T(s * 0.03, -0.12, 0.05, 0.4, s * 1.4, s * 0.8));
  k.s(surf(36, 14, (u, v, out, i, j) => { const a = u * TAU, t = v, r = Math.sin(PI * Math.min(1, t * 0.86 + 0.02)) ** 0.75 * (1 + 0.03 * Math.sin(i * PI / 2 + j * PI)), open = t > 0.5 ? Math.max(0, Math.cos(a - PI / 2)) * (t - 0.5) * 0.5 : 0; out[0] = Math.cos(a) * r * 0.47; out[1] = -1.33 + t * 0.92 - open * 0.8; out[2] = Math.sin(a) * r * 0.31 * (1 - open * 0.5); }, (u, v, i, j) => (((i >> 1) + j) & 1 ? sh(bark, 1.15) : i % 6 === 0 ? leafc : sh(g1, 0.8)), { closeU: true }));
  k.s(surf(36, 6, (u, v, out) => { const a = u * TAU, r = Math.sin(PI * Math.min(1, v * 0.5 * 0.86 + 0.02)) ** 0.75 * 0.93; out[0] = Math.cos(a) * r * 0.47; out[1] = -1.32 + v * 0.46; out[2] = Math.sin(a) * r * 0.31; }, sh(bark, 0.5), { closeU: true, flip: true }));
  k.s(cyl(0.3, 0.3, 0.02, 14), sh(bark, 0.7), T(0, -1.19, 0, 0, 0, 0, 1.2, 1, 0.75));
  k.o(surf(30, 1, (u, v, out) => { const a = u * TAU, r = Math.sin(PI * ((0.22 + v * 0.09) * 0.86 + 0.02)) ** 0.75 * 1.04; out[0] = Math.cos(a) * r * 0.47; out[1] = -1.33 + (0.22 + v * 0.09) * 0.92; out[2] = Math.sin(a) * r * 0.31; }, (u, v, i) => (i & 1 ? WHITE : 0xc8c8c8), { closeU: true }));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; k.c(leaf(0.26, 0.13, 0.4, i & 1 ? leafc : 0x5a9a3a, { nv: 5 }), null, T(Math.cos(a) * 0.1, -0.5, Math.sin(a) * 0.08, 2.2, PI / 2 - a, 0)); }
  k.g(ball(0.035, 6, 5), L.glow, T(0.12, -0.62, 0.2)); k.g(ball(0.025, 6, 5), 0xd8ff8a, T(-0.3, -0.9, 0.28)); k.rod('solid', 0x2a5a2a, [0.06, -0.5, 0.1], [0.12, -0.6, 0.2], 0.005, 3);
  load(k, [['sack', -0.2, 0.02, 0.95, 0, 0x8a9a5a], ['jar', 0.02, 0.06, 0.85, 0, 0x6a7a3a], ['bundle', 0.2, 0.02, 0.8, 1.2, bark], ['sack', 0.0, -0.08, 0.7, 1, 0xa8b070]], -1.18);
};
G.screaming = (k, L) => { // a sagging sack of living flesh gripped in a cage of talons, eyes rolling in its sides, a tongue lolling under
  const flesh = L.envelope, dkf = sh(flesh, 0.6), glow = L.glow, vein = 0x5a1a4a;
  for (const x of [-0.1, 0.1]) k.s(sweep([[x, -0.36, 0], [x, -0.14, 0.075], [x, 0.03, 0.085], [x, 0.092, 0], [x, 0.03, -0.075], [x, -0.07, -0.06]], (v) => 0.034 * (1 - v * 0.7) + 0.006, 6, 16, BONE), null);
  k.s(ball(0.09, 8, 6), dkf, T(0, -0.4, 0, 0, 0, 0, 1.4, 1, 1));
  k.s(surf(32, 14, (u, v, out, i, j) => { const a = u * TAU, r = Math.sin(PI * Math.min(1, v * 0.9 + 0.03)) ** 0.6 * (1 + 0.06 * Math.sin(a * 3 + v * 9) + 0.04 * Math.sin(a * 5 - v * 14)) * (0.82 + 0.3 * (1 - v)); out[0] = Math.cos(a) * r * 0.42; out[1] = -1.33 + v * 0.85; out[2] = Math.sin(a) * r * 0.29; }, (u, v, i, j) => { const r = rnd(Math.floor(i / 3) * 2.7 + Math.floor(j / 3) * 9.3); return v > 0.86 ? dkf : i % 8 === 0 ? vein : r > 0.85 ? mix(flesh, 0xe8a0a0, 0.5) : sh(flesh, 0.85 + 0.25 * r); }, { closeU: true }));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3, c = Math.cos(a), s = Math.sin(a); k.s(sweep([[c * 0.08, -0.4, s * 0.06], [c * 0.4, -0.56, s * 0.28], [c * 0.52, -0.92, s * 0.34], [c * 0.4, -1.2, s * 0.26], [c * 0.3, -1.3, s * 0.2]], (v) => 0.03 * (1 - v * 0.75) + 0.005, 5, 14, BONE), null); }
  for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.2, y = -1.08 + 0.3 * rnd(i * 3), r = 0.05 + 0.03 * rnd(i); eyeball(k, [Math.cos(a) * 0.4, y, Math.sin(a) * 0.275], [Math.cos(a), 0.1, Math.sin(a) * 1.4], r, i % 3 === 0 ? 0xffd040 : glow); }
  k.o(surf(28, 1, (u, v, out) => { const a = u * TAU, r = (1 + 0.06 * Math.sin(a * 3)) * 1.06; out[0] = Math.cos(a) * r * 0.42; out[1] = -0.78 + v * 0.1; out[2] = Math.sin(a) * r * 0.29; }, (u, v, i) => (i % 3 === 0 ? 0xb0b0b0 : WHITE), { closeU: true }));
  k.s(sweep([[0, -1.28, 0.1], [0.04, -1.33, 0.2], [0.02, -1.35, 0.3]], (v) => 0.035 * (1 - v * 0.6), 5, 6, 0xc84a6a), null);
  // its mouth gapes at the top, cargo crammed in
  k.s(torus(0.2, 0.04, 5, 14), dkf, T(0, -0.56, 0, PI / 2, 0, 0, 1.3, 0.9, 1)); for (let i = 0; i < 10; i++) k.s(cone(0.018, 0.08, 4), BONE, T(Math.cos(i * 0.628) * 0.24, -0.53, Math.sin(i * 0.628) * 0.17, 0, 0, 0));
  cargo(k, 'sack', -0.08, -0.66, 0.0, 0.9, 0, 0x8a5a6a); cargo(k, 'jar', 0.1, -0.68, 0.02, 0.8, 0, 0x4a2a4a); cargo(k, 'crate', 0.0, -0.7, -0.08, 0.6, 0.4, 0x5a3a3a);
};
G.xibalba = (k, L) => { // a gilded stepped litter-chest with jade masks, a plume canopy of quetzal green and red, on feathered cords
  const gold = 0xd8a82a, jade = 0x2a9a6a, red = 0xb8281e, FE = [jade, red, 0x2ab0c0, 0xe8c030, 0x1a6a4a];
  boneHooks(k, L, { col: 0x6a4a2a, rope: 0x6a5a3a, to: -0.74, lines: [[-0.38, 0.22], [0.38, 0.22], [-0.38, -0.22], [0.38, -0.22]] });
  k.s(rev([[0.3, -1.3], [0.42, -1.28], [0.42, -1.16], [0.48, -1.15], [0.48, -1.02], [0.53, -1.01], [0.53, -0.9], [0.47, -0.9], [0.45, -1.19], [0, -1.2]], 24, [0x8a7a60, 0xb0a488, gold, 0xa89878, gold, 0xb0a488, 0x6a5a48, 0x6a5a48, 0x5a4a3a], { ex: 8, sx: 0.86, sz: 0.56 }), null);
  for (const z of [-1, 1]) { k.o(box(0.76, 0.1, 0.012), WHITE, T(0, -1.085, z * 0.272)); k.s(rbox(0.13, 0.11, 0.035, 0.012, 1), jade, T(0, -0.96, z * 0.3)); for (const x of [-0.03, 0.03]) k.s(box(0.025, 0.018, 0.012), DARK, T(x, -0.945, z * 0.32)); k.s(box(0.06, 0.014, 0.012), DARK, T(0, -0.985, z * 0.32)); for (const x of [-0.3, 0.3]) k.m(cyl(0.05, 0.05, 0.016, 10), gold, T(x, -0.955, z * 0.3, PI / 2)); }
  for (const x of [-1, 1]) for (const z of [-1, 1]) { k.s(cyl(0.016, 0.016, 0.3, 5), 0x6a4a2a, T(x * 0.42, -0.76, z * 0.25)); k.m(ball(0.025, 6, 5), gold, T(x * 0.42, -0.6, z * 0.25)); }
  for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; k.c(leaf(0.5, 0.11, -0.35, (u, v) => (v > 0.7 ? FE[(i + 1) % 5] : FE[i % 5]), { nv: 5 }), null, T(Math.cos(a) * 0.05, -0.6, Math.sin(a) * 0.04, 1.25, PI / 2 - a, 0, 1, 1, 1)); }
  k.m(rev([[0.07, 0], [0.09, 0.03], [0.04, 0.07], [0, 0.1]], 8, gold), null, T(0, -0.62, 0));
  load(k, [['jar', -0.24, 0.0, 1, 0, 0xb8683a], ['sack', 0.0, 0.08, 1, 0, 0xc8b070], ['jar', 0.24, 0.02, 0.9, 0, jade], ['bundle', 0.0, -0.1, 0.8, 1.4, 0xc8a84a]], -1.19);
};
G.greenhide = (k, L) => { // a rough plank cage lashed with rope, tusks jutting from the corners, a painted hide nailed on, hung from a meat-hook bone
  const hide = L.hide ?? 0x4a4238, wood = 0x5a4630; boneHooks(k, L, { rope: 0x3a2e22, to: -0.62 });
  k.push(T(0, 0, 0, 0, 0.03, -0.03)); car(k, L, { col: wood, planks: 5, wall: 0.22, post: 0.56, pcol: sh(wood, 0.7), panel: false, th: 0.04 });
  for (const z of [-1, 1]) { k.s(box(0.92, 0.04, 0.03), sh(wood, 0.8), T(0, -0.74, z * 0.27, 0, 0, z * 0.04)); k.s(box(0.9, 0.035, 0.025), sh(wood, 1.1), T(0, -0.9, z * 0.275, 0, 0, -z * 0.05)); k.o(box(0.5, 0.17, 0.014), WHITE, T(z * 0.08, -1.1, z * 0.29, 0, 0, z * 0.05)); for (const x of [-0.2, 0.2]) k.s(box(0.02, 0.02, 0.02), 0x1e1a16, T(z * 0.08 + x, -1.03, z * 0.3)); }
  for (const x of [-1, 1]) { k.s(box(0.03, 0.04, 0.56), sh(wood, 0.8), T(x * 0.42, -0.74, 0)); for (const z of [-1, 1]) { k.s(sweep([[x * 0.4, -1.16, z * 0.25], [x * 0.52, -1.1, z * 0.32], [x * 0.56, -0.92, z * 0.34]], (v) => 0.03 * (1 - v * 0.8) + 0.004, 5, 6, BONE), null); k.s(torus(0.03, 0.008, 3, 8), 0x3a2e22, T(x * 0.41, -0.8, z * 0.26, PI / 2)); } }
  load(k, [['sack', -0.24, 0.0, 1.15, 0, 0x6a6a48], ['crate', 0.02, 0.06, 1, 0.3], ['barrel', 0.26, -0.02, 0.95], ['sack', 0.02, -0.12, 0.8, 1, sh(hide, 1.4)]]); k.pop();
  skull(k, T(0.47, -0.94, 0, 0, PI / 2, 0, 0.13), BONE);
};
G.mistisles = (k, L) => { // a tall coiled-reed snake-basket with a lid ajar, a carved serpent wound round it rearing to hook the cable
  const hide = L.hide ?? 0x5a8a9a, gold = 0xc8a84a, sn = 0x2a6a5a;
  k.s(rev([[0, -1.3], [0.24, -1.29], [0.4, -1.22], [0.46, -1.1], [0.42, -1.04], [0.47, -0.97], [0.43, -0.91], [0.46, -0.85], [0.4, -0.8], [0.36, -0.8], [0.38, -0.9], [0.36, -1.18], [0, -1.22]], 40, (u, v, i, j) => (j > 8 ? 0x5a4a30 : j & 1 ? 0xb89a58 : 0x9a7c44), { sx: 0.98, sz: 0.66 }), null);
  k.o(rev([[0.462, -1.12], [0.482, -1.09], [0.45, -1.05]], 26, [WHITE, 0xc8c8c8], { sx: 0.98, sz: 0.66 }), null);
  k.s(rev([[0.36, 0], [0.3, 0.04], [0.14, 0.08], [0.04, 0.09], [0.03, 0.12], [0, 0.13]], 20, (u, v, i, j) => (j & 1 ? 0xb89a58 : 0x9a7c44), { sx: 0.98, sz: 0.66 }), null, T(-0.12, -0.72, 0, 0, 0, 0.5));
  { const pts = []; for (let t = 0; t <= 20; t++) { const a = (t / 20) * 7.2 + 0.5, r = 1.02; pts.push([Math.cos(a) * 0.46 * r, -1.26 + 0.44 * (t / 20), Math.sin(a) * 0.31 * r]); } pts.push([0.36, -0.66, 0.1], [0.16, -0.4, 0.06], [0.02, -0.16, 0.07], [0, 0.04, 0.085], [0, 0.095, 0], [0, 0.04, -0.07], [0, -0.04, -0.07]);
    k.s(sweep(pts, (v) => 0.016 + 0.03 * Math.sin(PI * Math.min(1, v * 0.9 + 0.08)), 7, 110, (u, v, i, j) => (i < 2 ? mix(hide, 0xe8f0d8, 0.6) : j % 4 < 2 ? sn : gold)), null); k.s(ball(0.045, 8, 6), sn, T(0, -0.07, -0.085, 0.4, 0, 0, 1, 0.75, 1.5)); for (const x of [-1, 1]) k.g(ball(0.012, 5, 4), L.glow, T(x * 0.03, -0.055, -0.12)); }
  for (const [x, z] of [[-0.4, 0.12], [-0.38, -0.14], [0.36, -0.16]]) k.rod('solid', 0x4a5a4a, [x, -0.82, z], [0.02, -0.2, 0.05], 0.008, 4);
  load(k, [['jar', -0.2, 0.0, 1, 0, 0x3a7a7a], ['sack', 0.02, 0.08, 0.95, 0, 0xa8b090], ['jar', 0.2, 0.02, 0.85, 0, 0x8a6a3a], ['bundle', 0.0, -0.1, 0.8, 1.4, 0x6a7a5a]], -1.2);
};
G.elemental = (k, L) => { // a hovering stone trough ringed by crystal, held under a rune-ring that grips the cable with no touch at all
  const stone = L.hide ?? 0x7a7a82, glow = L.glow, cr = mix(L.envelope, 0xbfe8ff, 0.5), dk = sh(stone, 0.7);
  k.s(torus(0.1, 0.035, 5, 7), stone, T(0, 0.02, 0, 0, PI / 2, 0), true); for (let i = 0; i < 7; i++) k.g(box(0.012, 0.03, 0.03), glow, T(0.036, 0.02 + Math.sin(i * 0.898) * 0.1, Math.cos(i * 0.898) * 0.1));
  k.c(gem(0.07, 0.4, 6), (x, y) => (y > 0.05 ? mix(cr, 0xffffff, 0.4) : cr), T(0, -0.36, 0, PI, 0, 0), true); k.g(gem(0.03, 0.24, 5), glow, T(0, -0.36, 0, PI, 0, 0), true);
  for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; k.g(cyl(0.007, 0.007, 1, 4, true), glow, TA([Math.cos(a) * 0.2, -0.68, Math.sin(a) * 0.13], [Math.cos(a) * 0.36, -0.44, Math.sin(a) * 0.22], 1, 0.52, 1)); }
  k.s(rev([[0, -1.33], [0.22, -1.3], [0.42, -1.2], [0.5, -1.02], [0.49, -0.92], [0.42, -0.93], [0.4, -1.16], [0, -1.2]], 9, (u, v, i, j) => (j > 4 ? dk : (i + j) & 1 ? stone : sh(stone, 0.86)), { sx: 0.94, sz: 0.62, rot: 0.2 }), null, null, true);
  k.o(rev([[0.5, -1.12], [0.54, -1.05], [0.525, -0.99]], 9, [WHITE, 0xc8c8c8], { sx: 0.94, sz: 0.62, rot: 0.2 }), null, null, true);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.4, c = Math.cos(a) * 0.47, s = Math.sin(a) * 0.31; k.c(gem(0.035 + 0.02 * rnd(i), 0.22 + 0.14 * rnd(i * 3), 5), (x, y) => (y > 0.05 ? mix(cr, 0xffffff, 0.4) : i & 1 ? cr : mix(cr, 0x6a8ad8, 0.5)), T(c, -0.88, s, 0.25 * Math.sin(a), 0, -0.25 * Math.cos(a)), true); }
  for (let i = 0; i < 4; i++) k.s(new THREE.DodecahedronGeometry(0.05 + 0.03 * rnd(i)), i & 1 ? stone : dk, T(Math.cos(i * 1.7) * 0.5, -1.25 + 0.1 * rnd(i * 2), Math.sin(i * 1.7) * 0.36, i, i, 0), true);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU + 0.2; k.add(i % 4 === 0 ? 'glow' : 'cloth', gem(0.022 + 0.015 * rnd(i), 0.1 + 0.08 * rnd(i * 2), 5), i % 4 === 0 ? glow : cr, T(Math.cos(a) * 0.3, -0.52 + 0.06 * Math.sin(a * 3), Math.sin(a) * 0.2, i, i * 2, i * 3), true); }
  for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + 0.2; k.s(new THREE.DodecahedronGeometry(0.06), i & 1 ? sh(stone, 1.1) : dk, T(Math.cos(a) * 0.46, -0.97, Math.sin(a) * 0.3, i, i * 3, 0, 1, 1.5, 1), true); k.g(box(0.012, 0.07, 0.012), glow, T(Math.cos(a) * 0.5, -1.0, Math.sin(a) * 0.335)); }
  for (let i = 0; i < 5; i++) k.c(gem(0.04, 0.2, 5), mix(cr, 0x6a8ad8, 0.5), T(Math.cos(i * 1.3) * 0.25, -1.24, Math.sin(i * 1.3) * 0.16, PI + 0.4 * Math.cos(i), 0, 0.4 * Math.sin(i)), true);
  for (const x of [-0.3, 0.3]) k.g(box(0.03, 0.1, 0.01), glow, T(x, -1.12, 0.268 - Math.abs(x) * 0.12, 0, x > 0 ? -0.3 : 0.3, 0));
  load(k, [['jar', -0.2, 0.0, 1, 0, 0x8a8a92], ['crate', 0.04, 0.04, 0.95, 0.2, 0x8a8478], ['sack', 0.24, 0.0, 0.9, 0, 0x9a9aa0]], -1.19); k.s(new THREE.DodecahedronGeometry(0.07), 0xd8b040, T(0.0, -1.12, -0.12), true);
};

// =====================================================================================================
const pick = (table, L) => table[L && L.faction] || table.kingdom;
const keyOf = (L) => (L && (B[L.faction] ? L.faction : `kingdom:${L.faction}:${L.cloth}:${L.envelope}`)) || 'kingdom';

export function buildGondola(look, sideColor) {
  const { g } = assemble(`g:${keyOf(look)}`, sideColor, (k) => pick(G, look)(k, look));
  g.name = `gondola:${look.faction}`;
  return g;
}

const flames = new Map();
export function buildBalloon(look, sideColor) {
  const { g, extra } = assemble(`b:${keyOf(look)}`, sideColor, (k) => pick(B, look)(k, look));
  const kind = extra.fire || 'flame', fk = `${look.glow}:${kind}`;
  if (!flames.has(fk)) { const b = new Bag(); b.add(flameGeo(look.glow, kind), kind === 'gem' ? mix(look.glow, 0xffffff, 0.3) : null, new THREE.Matrix4(), kind === 'gem'); flames.set(fk, b.geometry()); }
  const fire = new THREE.Mesh(flames.get(fk), materials().glow); fire.position.y = 1.75; fire.castShadow = false; fire.name = 'fire'; g.add(fire);
  g.userData.fire = fire; g.name = `balloon:${look.faction}`;
  return g;
}
