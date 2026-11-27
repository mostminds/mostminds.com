// Supply boats that ferry soldiers and stores between docks along rivers, canals and short sea crossings.
//   buildBoat(look, sideColor, kind) -> Object3D       kind: 'gondola' | 'riverboat' | 'raft'
//     +x is forward (bow at +x), origin at the waterline amidships (y = 0 is the water surface).
//     userData.len    overall length, bow to stern
//     userData.deck   height of the floor riders stand on
//     userData.seats  [Vector3] where riders stand (the first is the boatman / steersman / poler at the stern)
//     userData.wheel  (some) a paddle wheel the game spins about its local z
//     userData.sweep  (most) oars, poles and sweeps the game rocks about local z, each pivoted at its rowlock
// Every boat is baked into a handful of vertex-coloured meshes (solid, metal, cloth, glow, owner) plus one mesh per
// moving part; geometry is cached per faction and kind, materials are shared, and the owner mesh takes the side's colour
// from its material so the cache is independent of it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PI = Math.PI, TAU = PI * 2, HP = PI / 2, V3 = THREE.Vector3;
const ROPE = 0x8a7450, BONE = 0xe6dcc4, SACK = 0xb8a888, CRATE = 0xa67c4c, CLAY = 0xb8683a, WHITE = 0xffffff, DARK = 0x1a1612, TAR = 0x2a221c, GOLD = 0xd8a838, BRASS = 0xb8923a, COPPER = 0xb8683a, REED = 0xc8b070;
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const C = (h) => new THREE.Color(h);
const sh = (c, k) => { const o = C(c).multiplyScalar(k); o.r = Math.min(1, o.r); o.g = Math.min(1, o.g); o.b = Math.min(1, o.b); return o.getHex(); };
const mix = (a, b, t) => C(a).lerp(C(b), t).getHex();
const _lin = new Map();
const rgb = (hex) => { let v = _lin.get(hex); if (!v) { const c = C(hex); v = [c.r, c.g, c.b]; _lin.set(hex, v); } return v; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---- primitives -----------------------------------------------------------------------------
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const rbox = (w, h, d, r = 0.03, s = 2) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, Math.min(w, h, d) * 0.49));
const cyl = (a, b, h, n = 10, open = false) => new THREE.CylinderGeometry(a, b, h, n, 1, open);
const ball = (r, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);
const hemi = (r, w = 12, h = 5) => new THREE.SphereGeometry(r, w, h, 0, TAU, 0, HP);
const cone = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n);
const torus = (R, r, a = 6, b = 20, arc = TAU) => new THREE.TorusGeometry(R, r, a, b, arc);
const oct = (r) => new THREE.OctahedronGeometry(r);
const dodec = (r) => new THREE.DodecahedronGeometry(r);
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new V3(), _s = new V3(), _Y = new V3(0, 1, 0);
/** a transform: position, euler rotation (YXZ), and either one uniform scale or three */
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

/** a parametric sheet, smooth-shaded, coloured per quad */
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
/** a turned solid from [radius, y] points bottom to top */
function rev(pts, n = 14, cols = WHITE, o = {}) {
  const ex = o.ex || 2, sx = o.sx ?? 1, sz = o.sz ?? 1;
  return surf(n, pts.length - 1, (u, v, out, i, j) => { const a = u * TAU + (o.rot || 0), c = Math.cos(a), s = Math.sin(a), f = sup(c, s, ex), r = pts[j][0]; out[0] = r * f * c * sx; out[1] = pts[j][1]; out[2] = r * f * s * sz; }, cols, { closeU: true });
}
/** a tube swept along [x,y,z] points; r may be a function of 0..1 along it */
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
    const f = fr[j], rr = typeof r === 'function' ? r(v) : r, a = u * TAU, c = Math.cos(a) * rr, s = Math.sin(a) * rr * (o.flat ?? 1);
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
/** a gabled roof block: ridge along x, eaves at y = 0 */
function gable(w, h, d) {
  const A = [-w / 2, 0, -d / 2], B = [w / 2, 0, -d / 2], Cc = [w / 2, 0, d / 2], D = [-w / 2, 0, d / 2], E = [-w / 2, h, 0], F = [w / 2, h, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([D, Cc, F, D, F, E, B, A, E, B, E, F, A, D, E, Cc, B, F, A, B, Cc, A, Cc, D].flat()), 3));
  g.computeVertexNormals(); return g;
}
/** a flat polygon in the xy plane from [x,y] points (convex or simple), extruded thinly along z */
function slab(pts, depth = 0.02) { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -depth / 2); }
/** a pennant / flag trailing from a hoist at the origin toward -x */
function flagGeo(w, h, kind = 'swallow', ph = 0) {
  return surf(8, 3, (u, v, out) => {
    let x = u * w, y = (v - 0.5) * h; const t = u;
    if (kind === 'point') y *= 1 - t * 0.94; else if (kind === 'swallow') { y *= 1 - t * 0.2; if (t > 0.6) x -= ((t - 0.6) / 0.4) * w * 0.3 * (1 - Math.abs(v - 0.5) * 2); } else if (kind === 'rag') { if (t > 0.7) x -= w * 0.3 * rnd(Math.round(v * 3) + 7) * ((t - 0.7) / 0.3); }
    out[0] = -x; out[1] = y - t * t * h * 0.15; out[2] = Math.sin(t * 5.5 + ph) * 0.07 * t * w;
  }, WHITE);
}

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
  constructor() { this.bags = {}; this.M = new THREE.Matrix4(); this.st = []; this.pre = ''; this.parts = {}; }
  add(bag, geo, col, mat, flat) { const name = this.pre || bag; (this.bags[name] ??= new Bag()).add(geo, col, new THREE.Matrix4().multiplyMatrices(this.M, mat || _I), flat); return this; }
  push(mat) { this.st.push(this.M.clone()); this.M.multiply(mat); } pop() { this.M = this.st.pop(); }
  at(mat, fn) { this.push(mat); fn(); this.pop(); }
  s(geo, col, mat, flat) { return this.add('solid', geo, col, mat, flat); }
  m(geo, col, mat, flat) { return this.add('metal', geo, col, mat, flat); }
  c(geo, col, mat, flat) { return this.add('cloth', geo, col, mat, flat); }
  g(geo, col, mat, flat) { return this.add('glow', geo, col, mat, flat); }
  o(geo, col, mat, flat) { return this.add('owner', geo, col ?? WHITE, mat, flat); }
  rod(bag, col, a, b, r = 0.012, sides = 5, r2) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1e-4;
    return this.add(bag, cyl(r2 ?? r, r, 1, sides, r2 === undefined), col, TA([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], d, 1, l, 1));
  }
  /** a moving part: everything drawn inside fn (in boat coordinates) is baked relative to the pivot into one mesh */
  part(name, pivot, fn) { const sM = this.M, sSt = this.st, sPre = this.pre; this.M = pivot.clone().invert(); this.st = []; this.pre = name; fn(); this.M = sM; this.st = sSt; this.pre = sPre; this.parts[name] = pivot.clone(); }
}

// ---- materials and assembly ---------------------------------------------------------------------
let MATS = null; const sideMats = new Map();
function materials() {
  return MATS ??= {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    part: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide }),
  };
}
function sideMat(side) { if (!sideMats.has(side)) sideMats.set(side, new THREE.MeshStandardMaterial({ color: side, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, emissive: side, emissiveIntensity: 0.18 })); return sideMats.get(side); }
const cache = new Map();
function assemble(key, side, make) {
  let c = cache.get(key);
  if (!c) { const k = new Kit(), extra = make(k); c = { geos: {}, extra, parts: k.parts }; for (const [name, bag] of Object.entries(k.bags)) if (bag.p.length) c.geos[name] = bag.geometry(); cache.set(key, c); }
  const g = new THREE.Group(), mats = materials(), groups = {};
  for (const [name, pv] of Object.entries(c.parts)) { const pg = new THREE.Group(); pv.decompose(pg.position, pg.quaternion, pg.scale); pg.name = name; g.add(pg); groups[name] = pg; }
  for (const [name, geo] of Object.entries(c.geos)) {
    const part = groups[name], m = new THREE.Mesh(geo, part ? mats.part : name === 'owner' ? sideMat(side) : mats[name]);
    m.castShadow = name !== 'glow'; m.receiveShadow = name === 'solid'; m.name = name; (part || g).add(m);
  }
  const ex = c.extra;
  g.userData.len = ex.len; g.userData.deck = ex.deck; g.userData.seats = ex.seats.map((s) => new V3(s[0], s[1], s[2])); g.userData.kind = ex.kind;
  const sw = Object.keys(groups).filter((n) => n.startsWith('sw')).sort((a, b) => +a.slice(2) - +b.slice(2)).map((n) => groups[n]);
  if (sw.length) g.userData.sweep = sw;
  if (groups.wheel) g.userData.wheel = groups.wheel;
  return g;
}

// =====================================================================================================
// HULLS
// =====================================================================================================
/** a hull shape: half-breadth, sheer and depth along s (0 = stern, 1 = bow), superelliptic sections (ex 2 round .. 6 boxy) */
function shape(o) {
  const { x0 = -1.7, x1 = 1.7, B = 0.9, draft = 0.22, free = 0.3, bowRise = 0, sternRise = 0, br = 3, sr = 3, pb = 2, ps = 2, qb = 0.6, qs = 0.6, ex = 2.4, tr = 0, tb = 0, rocker = 0, dp = 3, th = 0.035 } = o;
  const Lh = x1 - x0, e = 2 / ex;
  const H = {
    o, x0, x1, B, th, ex,
    s: (x) => Math.min(1, Math.max(0, (x - x0) / Lh)),
    x: (s) => x0 + Lh * s,
    hw(s) { const t = 2 * s - 1; return t >= 0 ? (B / 2) * (tb + (1 - tb) * Math.pow(Math.max(0, 1 - Math.pow(t, pb)), qb)) : (B / 2) * (tr + (1 - tr) * Math.pow(Math.max(0, 1 - Math.pow(-t, ps)), qs)); },
    top(s) { const t = 2 * s - 1; return free + (t > 0 ? bowRise * Math.pow(t, br) : sternRise * Math.pow(-t, sr)); },
    dep(s) { const t = Math.abs(2 * s - 1); return draft * (1 - Math.pow(t, dp)) - rocker * Math.pow(t, 4); },
    at(s, a, ins = 0, out = [0, 0, 0]) {
      const hw = Math.max(0.0008, H.hw(s) - ins), dpp = H.dep(s) - ins, tp = H.top(s), th2 = (a - 0.5) * PI, c = Math.abs(Math.cos(th2)), sn = Math.sin(th2);
      out[0] = H.x(s); out[1] = tp - (tp + dpp) * Math.pow(c, e); out[2] = hw * Math.sign(sn) * Math.pow(Math.abs(sn), e); return out;
    },
    /** the a (0 port .. 1 starboard) where the hull is dt below its sheer, on side sd */
    aAt(s, dt, sd) { const tp = H.top(s), dpp = H.dep(s), c = Math.pow(Math.min(1, Math.max(0, dt / Math.max(0.01, tp + dpp))), 1 / e); return 0.5 + (sd * Math.acos(Math.min(1, c))) / PI; },
    halfAt(x, y, ins = 0) {
      const s = H.s(x), tp = H.top(s), dpp = H.dep(s) - ins, hw = Math.max(0, H.hw(s) - ins);
      if (y >= tp) return hw; if (y <= -dpp) return 0;
      const c = Math.pow((tp - y) / (tp + dpp), 1 / e), sn = Math.sqrt(Math.max(0, 1 - c * c)); return hw * Math.pow(sn, e);
    },
    topAt: (x) => H.top(H.s(x)),
    side(x, sd, dt = 0, ins = 0) { const s = H.s(x); return H.at(s, H.aAt(s, dt, sd), ins); },
  };
  return H;
}
const sv = (v) => 0.5 - 0.5 * Math.cos(PI * v);
/** columns crowd toward the gunwales, where the paint is */
const am = (u) => { const w = Math.abs(2 * u - 1); return 0.5 + 0.5 * Math.sign(u - 0.5) * (1 - (1 - w) * (1 - w)); };
/** the shell: outer skin, gunwale and inner skin in one closed sheet; col(region, s, y, a, i, j) */
function shell(k, H, col, o = {}) {
  const m = o.m ?? 16, nv = o.nv ?? 44, th = H.th, bag = o.bag || 'solid';
  const P = (i, v, out) => (i <= m ? H.at(sv(v), am(i / m), 0, out) : H.at(sv(v), am(1 - (i - m - 1) / m), th, out));
  k.add(bag, surf(2 * m + 2, nv, (u, v, out, i) => P(i, v, out), (u, v, i, j) => {
    const s = sv((j + 0.5) / nv); let reg, a, ins = 0;
    if (i < m) { reg = 'out'; a = am((i + 0.5) / m); } else if (i === m || i === 2 * m + 1) { reg = 'rim'; a = i === m ? 1 : 0; } else { reg = 'in'; a = am(1 - (i - m - 0.5) / m); ins = th; }
    const p = H.at(s, a, ins); return col(reg, s, p[1], a, i, j, p);
  }, { closeU: true, flip: !!o.flip }), null);
  for (const [s, on] of [[0, H.o.tr], [1, H.o.tb]]) if (on) { // a transom: fill the end section
    const c = [H.x(s), (H.top(s) - H.dep(s)) / 2, 0];
    k.add('cloth', surf(m, 1, (u, v, out) => { const p = H.at(s, u, 0); out[0] = c[0] + (p[0] - c[0]) * v; out[1] = c[1] + (p[1] - c[1]) * v; out[2] = c[2] + (p[2] - c[2]) * v; }, (u) => col('out', s, H.at(s, u)[1], u, 0, 0, H.at(s, u))), null);
  }
}
/** colours for a hull: bands by depth below the sheer, strakes, a dark bottom */
function hcol(H, o) {
  const st = o.strake ?? 0.075;
  return (reg, s, y, a, i, j) => {
    if (reg === 'rim') return o.rim ?? sh(o.out, 0.75);
    if (reg === 'in') return typeof o.in === 'function' ? o.in(s, y, j, i) : o.in ?? sh(o.out, 0.62);
    if (y < (o.wl ?? 0.025)) return typeof o.bottom === 'function' ? o.bottom(s, y, j, i) : o.bottom ?? TAR;
    const dt = H.top(s) - y;
    if (o.bands) for (const b of o.bands) if (dt >= b[0] && dt < b[1] && s >= (b[3] ?? 0) && s <= (b[4] ?? 1)) return typeof b[2] === 'function' ? b[2](s, dt, j, i) : b[2];
    if (o.fn) return o.fn(s, dt, y, j, i);
    return st ? sh(o.out, Math.floor(dt / st) & 1 ? 0.86 : 1) : o.out;
  };
}
/** a band of the side's colour along both flanks, dt0..dt1 below the sheer */
function ownerBand(k, H, dt0, dt1, s0 = 0.12, s1 = 0.88, n = 28) {
  for (const sd of [-1, 1]) k.o(surf(n, 1, (u, v, out) => { const s = s0 + (s1 - s0) * u; H.at(s, H.aAt(s, dt0 + (dt1 - dt0) * v, sd), -0.008, out); }, WHITE), null);
}
/** a painted strake on both flanks, dt0..dt1 below the sheer, into any bag */
function paint(k, H, dt0, dt1, col, s0 = 0.03, s1 = 0.97, bag = 'solid', n = 30, lift = 0.005) {
  for (const sd of [-1, 1]) k.add(bag, surf(n, 1, (u, v, out) => { const s = s0 + (s1 - s0) * sv(u); H.at(s, H.aAt(s, dt0 + (dt1 - dt0) * v, sd), -lift, out); }, col, { flip: sd < 0 }), null);
}
/** a gunwale rail along both sheers */
function gunwale(k, H, col, r = 0.022, o = {}) {
  const s0 = o.s0 ?? 0.02, s1 = o.s1 ?? 0.98, n = o.n ?? 20, bag = o.bag || 'solid';
  for (const a of [0, 1]) { const pts = []; for (let i = 0; i <= n; i++) { const p = H.at(s0 + (s1 - s0) * sv(i / n), a, -r * 0.2); p[1] += r * 0.4 + (o.lift ?? 0); pts.push(p); } k.add(bag, sweep(pts, r, o.sides ?? 6, n * 2, col), null); }
}
/** a strake or rubbing band along both flanks at dt below the sheer */
function wale(k, H, dt, col, r = 0.018, o = {}) {
  const s0 = o.s0 ?? 0.05, s1 = o.s1 ?? 0.95, n = o.n ?? 18, bag = o.bag || 'solid';
  for (const sd of [-1, 1]) { const pts = []; for (let i = 0; i <= n; i++) { const s = s0 + (s1 - s0) * sv(i / n); pts.push(H.at(s, H.aAt(s, dt, sd), -r * 0.5)); } k.add(bag, sweep(pts, r, o.sides ?? 5, n * 2, col, o.flat ? { flat: o.flat } : {}), null); }
}
/** floorboards across the hull from xa to xb at height y */
function floor(k, H, xa, xb, y, col, o = {}) {
  const step = o.step ?? 0.11; let n = 0;
  for (let x = xa + step / 2; x < xb; x += step, n++) { const hw = H.halfAt(x, y, H.th) - 0.004; if (hw < 0.05) continue; k.add(o.bag || 'solid', box(step * 0.9, 0.03, hw * 2), sh(col, 0.86 + 0.24 * rnd(n * 7.3 + xa * 3)), T(x, y - 0.015, 0)); }
}
/** ribs inside the hull */
function ribs(k, H, xs, col, r = 0.018, bag = 'solid') { for (const x of xs) { const s = H.s(x), pts = []; for (let i = 0; i <= 8; i++) pts.push(H.at(s, i / 8, H.th + r * 0.6)); k.add(bag, sweep(pts, r, 4, 12, col), null); } }
/** ribs outside the hull standing proud of the gunwale (bone cages, frames) */
function cageRibs(k, H, xs, col, h, r = 0.02, bag = 'solid') {
  for (const x of xs) { const s = H.s(x), a = H.at(s, 0, -0.01), b = H.at(s, 1, -0.01), tp = H.top(s); const pts = [[x, -0.05, a[2] * 0.9], [x, tp * 0.6, a[2] * 1.02], a, [x, tp + h * 0.6, a[2] * 1.05], [x, tp + h, a[2] * 0.75]]; k.add(bag, sweep(pts, (v) => r * (1 - v * 0.6), 5, 10, col), null); k.add(bag, sweep(pts.map((p) => [p[0], p[1], -p[2]]), (v) => r * (1 - v * 0.6), 5, 10, col), null); }
}
/** a curved post rising from the stem or stern: pts relative to the end of the hull */
function post(k, pts, r, col, bag = 'solid', sides = 6) { return k.add(bag, sweep(pts, r, sides, pts.length * 3, col), null); }

// =====================================================================================================
// FITTINGS
// =====================================================================================================
function cargo(k, kind, x, y, z, s = 1, ry = 0, tint) {
  k.push(T(x, y, z, 0, ry, 0, s));
  switch (kind) {
    case 'crate': { const c = tint ?? CRATE, d = sh(c, 0.68); k.s(box(0.2, 0.2, 0.2), c, T(0, 0.1, 0)); for (const yy of [0.02, 0.18]) k.s(box(0.214, 0.03, 0.214), d, T(0, yy, 0)); k.s(box(0.03, 0.202, 0.216), d, T(0, 0.1, 0)); k.s(box(0.216, 0.202, 0.03), d, T(0, 0.1, 0)); break; }
    case 'sack': { const c = tint ?? SACK; k.s(ball(0.11, 10, 7), c, T(0, 0.075, 0, 0, 0, 0, 1.1, 0.72, 0.95)); k.s(cone(0.04, 0.07, 6), sh(c, 0.82), T(0.03, 0.15, 0, 0, 0, -0.5)); k.s(torus(0.028, 0.008, 4, 8), ROPE, T(0.025, 0.135, 0, PI / 2, 0, -0.5)); break; }
    case 'jar': { const c = tint ?? CLAY, b = sh(c, 0.6), l = sh(c, 1.2); k.s(rev([[0, 0], [0.05, 0], [0.085, 0.05], [0.1, 0.11], [0.09, 0.17], [0.05, 0.215], [0.04, 0.245], [0.058, 0.262], [0.05, 0.275], [0, 0.275]], 10, [b, c, l, c, b, c, c, b, b]), null); break; }
    case 'amphora': { const c = tint ?? CLAY; k.s(rev([[0, 0], [0.03, 0.02], [0.08, 0.1], [0.1, 0.2], [0.09, 0.28], [0.045, 0.34], [0.035, 0.4], [0.05, 0.42], [0, 0.42]], 10, [sh(c, 0.7), c, sh(c, 1.15), c, c, sh(c, 0.8), c, c]), null); for (const sz of [-1, 1]) k.s(torus(0.04, 0.01, 4, 8, PI), sh(c, 0.85), T(0, 0.35, sz * 0.05, 0, HP)); break; }
    case 'barrel': { const c = tint ?? 0x8a623a, h = 0x3a3a40; k.s(rev([[0, 0], [0.075, 0], [0.088, 0.04], [0.095, 0.075], [0.095, 0.145], [0.088, 0.18], [0.075, 0.22], [0, 0.22]], 12, [sh(c, 0.7), h, c, sh(c, 1.1), c, h, sh(c, 0.7)]), null); break; }
    case 'cask': { const c = tint ?? 0x8a623a, h = 0x3a3a40; k.push(T(0, 0.095, 0, 0, 0, HP)); k.s(rev([[0, -0.11], [0.075, -0.11], [0.088, -0.07], [0.095, -0.035], [0.095, 0.035], [0.088, 0.07], [0.075, 0.11], [0, 0.11]], 12, [sh(c, 0.7), h, c, sh(c, 1.1), c, h, sh(c, 0.7)]), null); k.pop(); break; }
    case 'bale': { const c = tint ?? 0xc8b070; k.s(rbox(0.26, 0.16, 0.18, 0.04, 2), c, T(0, 0.08, 0)); for (const xx of [-0.07, 0.07]) k.s(box(0.02, 0.168, 0.188), ROPE, T(xx, 0.08, 0)); break; }
    case 'carpet': { const c = tint ?? 0x8a2a2a; k.s(cyl(0.065, 0.065, 0.36, 10), (px, py, pz) => (Math.abs(py) > 0.15 ? 0xd8b04a : c), T(0, 0.065, 0, HP, 0, 0)); break; }
    case 'chest': { const c = tint ?? 0x6a4428, t = GOLD; k.s(box(0.26, 0.12, 0.16), c, T(0, 0.06, 0)); k.s(cyl(0.08, 0.08, 0.26, 10, false), c, T(0, 0.12, 0, 0, 0, HP, 1, 1, 1)); for (const xx of [-0.09, 0.09]) k.m(box(0.03, 0.125, 0.166), t, T(xx, 0.062, 0)); k.m(box(0.05, 0.05, 0.02), t, T(0, 0.11, 0.085)); break; }
    case 'bundle': { const c = tint ?? 0x8a6a4a; k.s(cyl(0.07, 0.07, 0.3, 8), c, T(0, 0.07, 0, 0, 0, HP)); for (const xx of [-0.08, 0.08]) k.s(torus(0.072, 0.012, 4, 10), ROPE, T(xx, 0.07, 0, 0, HP)); break; }
    case 'basket': { const c = tint ?? 0xb08a4e; k.s(cyl(0.11, 0.08, 0.16, 10), (px, py) => sh(c, Math.floor((py + 0.08) * 40) & 1 ? 0.85 : 1), T(0, 0.08, 0)); k.s(torus(0.11, 0.015, 4, 10), sh(c, 0.7), T(0, 0.16, 0, HP)); k.s(ball(0.08, 8, 5), 0xc8a050, T(0, 0.15, 0, 0, 0, 0, 1, 0.5, 1)); break; }
    case 'ingot': { const c = tint ?? GOLD; for (let q = 0; q < 3; q++) k.m(box(0.16, 0.045, 0.07), c, T(0, 0.024 + q * 0.046, (q % 2 ? 0.04 : -0.04) * (q === 2 ? 0 : 1), 0, q * 0.3, 0)); break; }
    case 'ore': { const c = tint ?? 0x5a5a66; k.s(cyl(0.12, 0.1, 0.14, 8), 0x4a4a52, T(0, 0.07, 0)); k.s(dodec(0.11), c, T(0, 0.16, 0, 0, 0, 0, 1, 0.55, 1), true); break; }
    case 'gourd': { const c = tint ?? 0xb89a4a; k.s(rev([[0, 0], [0.07, 0.01], [0.1, 0.07], [0.08, 0.13], [0.04, 0.16], [0.05, 0.21], [0.03, 0.26], [0.015, 0.29], [0, 0.29]], 9, c), null); break; }
    case 'hide': { const c = tint ?? 0x8a6a4a; k.s(cyl(0.09, 0.09, 0.3, 8), c, T(0, 0.085, 0, 0, 0, HP, 1, 1, 0.8)); k.s(torus(0.09, 0.012, 4, 8), 0x3a2a1c, T(0.06, 0.085, 0, 0, HP)); break; }
    case 'meat': { const c = tint ?? 0x9a3a2a; k.s(ball(0.1, 8, 6), c, T(0, 0.08, 0, 0, 0, 0.3, 1.3, 0.8, 0.9)); k.s(cyl(0.02, 0.02, 0.18, 5), BONE, T(0.12, 0.1, 0, 0, 0, HP + 0.3)); break; }
    default: break;
  }
  k.pop();
}
/** a heap of stores: list of [kind, dx, dz, s?, ry?, tint?, dy?] around (x, y, z) */
function heap(k, x, y, z, list, H) { for (const [kind, dx, dz, s = 1.5, ry = 0, tint, dy = 0] of list) { let zz = z + dz; if (H) { const hw = Math.max(0, H.halfAt(x + dx, y + 0.1, H.th) - 0.11 * s); zz = Math.max(-hw, Math.min(hw, zz)); } cargo(k, kind, x + dx, y + dy, zz, s, ry, tint); } }
function pennant(k, x, y, z, w = 0.5, h = 0.22, kind = 'swallow', bag = 'owner', col = WHITE) { k.add(bag, flagGeo(w, h, kind), col, T(x, y, z)); }
/** a staff with a pennant in the side's colour */
function flagstaff(k, x, y, z, hgt, o = {}) {
  k.rod(o.bag || 'solid', o.col ?? 0x5a4026, [x, y, z], [x, y + hgt, z], o.r ?? 0.016, 5);
  if (o.knob !== 0) k.m(o.knobGeo ?? ball(0.032, 8, 6), o.knob ?? GOLD, T(x, y + hgt + 0.02, z));
  pennant(k, x - 0.015, y + hgt - (o.h ?? 0.22) / 2 - 0.03, z, o.w ?? 0.55, o.h ?? 0.22, o.kind ?? 'swallow');
}
function lantern(k, x, y, z, glow, frame = 0x2a2a2e, s = 1, cap = 'cone') {
  k.push(T(x, y, z, 0, 0, 0, s));
  k.g(cyl(0.04, 0.035, 0.1, 6), glow, T(0, -0.08, 0)); k.m(cap === 'dome' ? hemi(0.06, 8, 3) : cone(0.065, 0.06, 6), frame, T(0, -0.02, 0)); k.m(cyl(0.048, 0.048, 0.014, 6), frame, T(0, -0.135, 0)); k.m(torus(0.02, 0.006, 4, 8), frame, T(0, 0.02, 0));
  for (let i = 0; i < 4; i++) { const a = i * HP + PI / 4; k.m(box(0.008, 0.1, 0.008), frame, T(Math.cos(a) * 0.045, -0.08, Math.sin(a) * 0.045)); }
  k.pop();
}
/** a lantern hung from a crooked arm on a post standing at (x, y0, z) */
function lampPost(k, x, y0, z, h, glow, col = 0x2a2a2e, dir = 1, cap) { k.rod('metal', col, [x, y0, z], [x, y0 + h, z], 0.016, 5); k.add('metal', sweep([[x, y0 + h, z], [x + dir * 0.1, y0 + h + 0.06, z], [x + dir * 0.18, y0 + h, z]], 0.011, 4, 6, col), null); lantern(k, x + dir * 0.18, y0 + h - 0.03, z, glow, col, 0.9, cap); }
function shield(k, x, y, z, ry, s, c1, c2, rim, kind = 0) {
  const g = slab([[-0.11, 0.12], [0.11, 0.12], [0.11, 0], [0.07, -0.11], [0, -0.16], [-0.07, -0.11], [-0.11, 0]], 0.02);
  k.push(T(x, y, z, 0, ry, 0, s));
  k.m(slab([[-0.125, 0.135], [0.125, 0.135], [0.125, 0], [0.08, -0.12], [0, -0.18], [-0.08, -0.12], [-0.125, 0]], 0.016), rim, T(0, 0, -0.012));
  k.s(g, c1, T(0, 0, 0));
  if (kind === 0) k.s(box(0.05, 0.25, 0.024), c2, T(0, -0.01, 0.003)); else if (kind === 1) k.s(box(0.22, 0.06, 0.024), c2, T(0, 0.05, 0.003)); else if (kind === 2) { k.s(box(0.05, 0.22, 0.024), c2, T(0, -0.01, 0.003)); k.s(box(0.2, 0.05, 0.024), c2, T(0, 0.03, 0.003)); }
  k.pop();
}
function roundShield(k, x, y, z, ry, r, face, rim, boss, bag = 'solid') { k.push(T(x, y, z, 0, ry, 0)); k.add(bag, cyl(r, r, 0.024, 14), face, T(0, 0, 0, HP)); k.m(torus(r, 0.014, 4, 16), rim, T(0, 0, 0)); k.m(ball(r * 0.28, 8, 5), boss ?? rim, T(0, 0, 0.012, 0, 0, 0, 1, 1, 0.6)); k.pop(); }
function skull(k, x, y, z, s = 1, ry = 0, bone = BONE, eye = null, horns = 0, hornCol) {
  k.push(T(x, y, z, 0, ry, 0, s));
  k.s(ball(0.1, 10, 8), bone, T(0, 0.02, 0, 0, 0, 0, 1.05, 0.95, 0.88)); k.s(rbox(0.11, 0.07, 0.1, 0.02, 1), sh(bone, 0.92), T(0.05, -0.06, 0));
  for (const sz of [-1, 1]) k.add(eye ? 'glow' : 'solid', ball(0.026, 6, 4), eye ?? DARK, T(0.085, 0.01, sz * 0.038));
  k.s(cone(0.014, 0.03, 4), DARK, T(0.104, -0.03, 0, 0, 0, -HP));
  if (horns) for (const sz of [-1, 1]) k.s(sweep([[0, 0.06, sz * 0.06], [0, 0.1, sz * 0.15 * horns], [0.04, 0.2 * horns, sz * 0.22 * horns], [0.1, 0.27 * horns, sz * 0.2 * horns]], (v) => 0.03 * (1 - v * 0.85), 5, 8, hornCol ?? sh(bone, 0.85)), null);
  k.pop();
}
function eyeball(k, p, d, r, iris, white = 0xe8e0d0) {
  const n = new V3(...d).normalize();
  k.s(ball(r, 10, 8), white, T(p[0], p[1], p[2])); k.g(ball(r * 0.55, 8, 6), iris, T(p[0] + n.x * r * 0.58, p[1] + n.y * r * 0.58, p[2] + n.z * r * 0.58)); k.s(ball(r * 0.26, 6, 5), DARK, T(p[0] + n.x * r * 0.96, p[1] + n.y * r * 0.96, p[2] + n.z * r * 0.96));
}
/** a membrane wing in its local xy plane (bat, drake), fanning from the origin */
function wing(k, m, R, spread, fingers, mem, bone) {
  k.push(m);
  k.c(surf(fingers * 5, 3, (u, v, out) => { const a = u * spread, r = R * v * (1 - 0.26 * Math.abs(Math.sin(PI * u * fingers)) * v) * (0.72 + 0.28 * u); out[0] = r * Math.cos(a); out[1] = r * Math.sin(a); out[2] = 0.05 * R * Math.sin(PI * u * fingers) * v; }, (u, v, i, j) => (j === 2 ? sh(mem, 0.8) : mem)));
  for (let i = 0; i <= fingers; i++) { const a = (i / fingers) * spread, r = R * (0.72 + (0.28 * i) / fingers); k.add('solid', sweep([[0, 0, 0], [r * 0.5 * Math.cos(a), r * 0.5 * Math.sin(a), 0.01], [r * Math.cos(a), r * Math.sin(a), 0]], (v) => 0.03 * R * (1 - v * 0.7) + 0.006, 4, 4, bone), null); }
  k.pop();
}
function flame(k, x, y, z, s = 1, col = 0xff8a30) { k.g(cone(0.07, 0.24, 7), col, T(x, y + 0.12 * s, z, 0, 0, 0, s)); k.g(cone(0.04, 0.15, 6), mix(col, 0xffffff, 0.55), T(x + 0.012 * s, y + 0.08 * s, z + 0.01 * s, 0, 0, 0, s)); }
function brazier(k, x, y, z, s, metal, fire) { k.push(T(x, y, z, 0, 0, 0, s)); k.m(rev([[0, 0], [0.05, 0], [0.04, 0.1], [0.07, 0.14], [0.13, 0.2], [0.12, 0.22], [0, 0.19]], 10, metal), null); k.g(ball(0.1, 8, 5), mix(fire, 0xffd070, 0.3), T(0, 0.21, 0, 0, 0, 0, 1, 0.4, 1)); flame(k, 0, 0.2, 0, 1.1, fire); k.pop(); }
function onion(k, x, y, z, s, col, tip = GOLD) { k.m(rev([[0, 0], [0.06, 0], [0.105, 0.035], [0.125, 0.09], [0.115, 0.15], [0.07, 0.215], [0.03, 0.27], [0.012, 0.33], [0, 0.37]], 12, col), null, T(x, y, z, 0, 0, 0, s)); k.m(cyl(0.006, 0.006, 0.18, 4), tip, T(x, y + 0.42 * s, z)); k.m(box(0.006, 0.006, 0.08), tip, T(x, y + 0.46 * s, z)); }
function lotus(k, x, y, z, s, petal, inner, n = 8) { k.push(T(x, y, z, 0, 0, 0, s)); for (let i = 0; i < n; i++) { const a = (i / n) * TAU; k.s(leaf(0.16, 0.09, 0.35, petal, { nv: 4 }), null, T(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, 0.9, -a + HP, 0)); } for (let i = 0; i < n; i++) { const a = ((i + 0.5) / n) * TAU; k.s(leaf(0.12, 0.07, 0.25, inner, { nv: 4 }), null, T(Math.cos(a) * 0.03, 0.01, Math.sin(a) * 0.03, 0.45, -a + HP, 0)); } k.m(ball(0.04, 8, 6), GOLD, T(0, 0.06, 0)); k.pop(); }
/** a dragon / serpent head facing +x at (x,y,z) */
function dragonHead(k, x, y, z, s, col, o = {}) {
  k.push(T(x, y, z, 0, 0, o.tilt ?? 0, s));
  const c2 = o.belly ?? sh(col, 1.3), horn = o.horn ?? GOLD;
  k.s(ball(0.12, 10, 8), col, T(0, 0, 0, 0, 0, 0, 1.25, 0.9, 0.85)); k.s(rbox(0.2, 0.09, 0.13, 0.04, 2), col, T(0.13, -0.02, 0)); k.s(rbox(0.17, 0.035, 0.11, 0.015, 1), c2, T(0.13, -0.075, 0, 0, 0, -0.25));
  for (const sz of [-1, 1]) { k.add(o.eye ? 'glow' : 'solid', ball(0.025, 6, 5), o.eye ?? 0xf0d040, T(0.07, 0.05, sz * 0.07)); if (o.horns !== false) k.add('metal', sweep([[-0.04, 0.07, sz * 0.05], [-0.13, 0.14, sz * 0.08], [-0.22, 0.16, sz * 0.1]], (v) => 0.025 * (1 - v * 0.8), 5, 6, horn), null); if (o.whisker !== false) k.add('solid', sweep([[0.2, -0.02, sz * 0.05], [0.25, -0.04, sz * 0.14], [0.22, -0.1, sz * 0.22]], 0.008, 3, 6, horn), null); }
  for (let i = 0; i < 4; i++) k.s(cone(0.02, 0.05, 4), 0xf0ead8, T(0.2 - i * 0.03, -0.065, 0.045 * (i % 2 ? 1 : -1), PI));
  if (o.mane) for (let i = 0; i < 5; i++) k.s(cone(0.035, 0.14, 4), o.mane, T(-0.08 - i * 0.04, 0.08 - i * 0.015, 0, 0, 0, 1.2 + i * 0.1));
  k.pop();
}

/** oars: name 'swN', pivot at the rowlock p, rocks about the vertical (the part's local z) */
function oar(k, C, p, sd, o = {}) {
  const name = 'sw' + C.nsw++, out = o.out ?? 1.0, inb = o.inb ?? 0.42;
  const e = o.e ?? [p[0] - (o.rake ?? 0.1), -0.04, p[2] + sd * out], h = o.h ?? [p[0] + 0.03, p[1] + 0.12, p[2] - sd * inb];
  k.part(name, T(p[0], p[1], p[2], -HP, 0, 0), () => {
    k.rod('solid', o.shaft ?? 0x8a6a40, h, e, o.r ?? 0.017, 6);
    const d = [e[0] - h[0], e[1] - h[1], e[2] - h[2]], l = Math.hypot(...d), u = d.map((q) => q / l), bl = o.bl ?? 0.34;
    const bc = [e[0] - (u[0] * bl) / 2.4, e[1] - (u[1] * bl) / 2.4, e[2] - (u[2] * bl) / 2.4];
    if (o.blade !== false) k.s(o.bladeGeo ?? rbox(0.022, bl, o.bw ?? 0.13, 0.01, 1), o.bcol ?? sh(o.shaft ?? 0x8a6a40, 1.1), TA(bc, d));
    k.s(cyl(0.022, 0.022, 0.1, 6), o.grip ?? 0x4a3424, TA(h, d));
    if (o.deco) o.deco(e, h, u);
  });
  if (o.lock !== false) k.m(torus(0.028, 0.009, 4, 8), o.lockCol ?? C.L.metal, T(p[0], p[1] + 0.01, p[2], HP));
}
/** a punt pole held at p; rocks fore and aft (about world z through the hands) */
function pole(k, C, p, o = {}) {
  const name = 'sw' + C.nsw++;
  k.part(name, T(p[0], p[1], p[2]), () => {
    const top = [p[0] + 0.28, p[1] + 0.75, p[2] + (o.dz ?? 0)], bot = [p[0] - 0.42, -0.65, p[2] + 0.05 + (o.dz ?? 0)];
    k.rod('solid', o.col ?? 0x8a6a40, top, bot, o.r ?? 0.018, 6);
    if (o.shoe) k.s(cone(0.025, 0.1, 5), o.shoe, TA(lerp3(bot, top, 0.03), [bot[0] - top[0], bot[1] - top[1], bot[2] - top[2]]));
    if (o.deco) o.deco(top, bot);
  });
}
/** a stern paddle wheel, axle across the boat (the part's local z) */
function paddleWheel(k, C, x, y, R, W, o = {}) {
  k.part('wheel', T(x, y, 0), () => {
    const rim = o.rim ?? C.L.metal, pad = o.pad ?? C.L.wood, n = o.n ?? 8, sp = o.spoke ?? rim;
    for (const z of [-W / 2, W / 2]) { k.s(torus(R, o.rr ?? 0.026, 5, 28), rim, T(x, y, z)); k.s(torus(R * 0.42, 0.02, 4, 16), rim, T(x, y, z)); for (let i = 0; i < n; i++) { const a = (i / n) * TAU; k.rod('solid', sp, [x, y, z], [x + Math.cos(a) * R, y + Math.sin(a) * R, z], o.sr ?? 0.017, 4); } }
    for (let i = 0; i < n; i++) { const a = ((i + 0.5) / n) * TAU; k.s(box(0.035, R * 0.44, W * 0.97), sh(pad, 0.88 + 0.22 * rnd(i + 3)), T(x + Math.cos(a) * R * 0.76, y + Math.sin(a) * R * 0.76, 0, 0, 0, a - HP)); }
    k.s(cyl(0.05, 0.05, W + 0.18, 8), o.hub ?? C.L.trim, T(x, y, 0, HP));
    if (o.extra) o.extra(x, y, R, W);
  });
}
/** a square sail across the boat, billowing forward; col(u, v, i, j) */
function sqSail(k, x, y0, y1, w, col, o = {}) {
  const bil = o.bil ?? 0.16, h = y1 - y0, tp = o.taper ?? 0;
  const P = (u, v, out, lift = 0) => { const ww = w * (1 - tp * (1 - v)); out[0] = x + 0.05 + lift + bil * Math.sin(PI * u) * Math.sin(PI * (0.12 + 0.88 * v)); out[1] = y1 - v * h - (o.belly ?? 0) * Math.sin(PI * u) * v * v; out[2] = (u - 0.5) * ww; };
  k.c(surf(o.nu ?? 10, o.nv ?? 8, (u, v, out) => P(u, v, out), col));
  if (o.owner) for (const l of [0.012, -0.012]) { const [v0, v1] = o.owner; k.o(surf(o.nu ?? 10, 2, (u, v, out) => P(u, v0 + (v1 - v0) * v, out, l), WHITE)); }
  if (o.yard !== false) k.rod('solid', o.spar ?? 0x5a4026, [x + 0.05, y1 + 0.02, -w / 2 - 0.08], [x + 0.05, y1 + 0.02, w / 2 + 0.08], 0.022, 6);
  if (o.boom) k.rod('solid', o.spar ?? 0x5a4026, [x + 0.05, y0, -w * (1 - tp) / 2 - 0.04], [x + 0.05, y0, w * (1 - tp) / 2 + 0.04], 0.018, 6);
  return P;
}
/** a fore-and-aft sail in the boat's midplane: corners tack A (low fore), clew B (low aft), peak C (high aft), throat D (high fore) */
function faSail(k, A, B, Cc, D, col, o = {}) {
  const bil = o.bil ?? 0.12;
  const P = (u, v, out, lift = 0) => { const lo = lerp3(A, B, u), hi = lerp3(D, Cc, u), p = lerp3(lo, hi, v); out[0] = p[0]; out[1] = p[1]; out[2] = p[2] + lift + bil * Math.sin(PI * u) * Math.sin(PI * Math.min(1, v * 0.9 + 0.1)) * (o.sd ?? 1); };
  k.c(surf(o.nu ?? 10, o.nv ?? 8, (u, v, out) => P(u, v, out), col));
  if (o.owner) for (const l of [0.012, -0.012]) { const [v0, v1] = o.owner; k.o(surf(o.nu ?? 10, 2, (u, v, out) => P(u, v0 + (v1 - v0) * v, out, l), WHITE)); }
  return P;
}
/** a deckhouse: walls x0..x1, width w, wall height h standing on y; roof kinds */
function cabin(k, x0, x1, w, h, y, o = {}) {
  const cx = (x0 + x1) / 2, L = x1 - x0, wall = o.wall ?? 0x8a6a40, trim = o.trim ?? sh(wall, 0.7), roofC = o.roofCol ?? 0x7a3a2a, rb = o.roofBag || 'solid';
  k.add(o.wallBag || 'solid', rbox(L, h, w, 0.02, 1), wall, T(cx, y + h / 2, 0));
  if (o.frame !== false) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.s(box(0.05, h, 0.05), trim, T(cx + sx * (L / 2 - 0.02), y + h / 2, sz * (w / 2 - 0.02))); k.s(box(L + 0.02, 0.05, w + 0.02), trim, T(cx, y + h - 0.025, 0)); }
  if (o.win !== false) for (const sz of [-1, 1]) for (let i = 0; i < (o.nwin ?? 2); i++) { const wx = x0 + (L * (i + 1)) / ((o.nwin ?? 2) + 1); k.add(o.winGlow ? 'glow' : 'solid', o.winGeo ?? box(0.14, 0.16, 0.012), o.winCol ?? (o.winGlow ? 0xffd080 : 0x1e1a18), T(wx, y + h * 0.58, sz * (w / 2 + 0.004))); k.s(box(0.18, 0.025, 0.03), trim, T(wx, y + h * 0.58 - 0.095, sz * (w / 2 + 0.01))); }
  if (o.door !== false) k.s(box(0.012, h * 0.72, 0.22), o.doorCol ?? sh(wall, 0.6), T(x0 - 0.004, y + h * 0.36, 0));
  const ry = y + h;
  switch (o.roof || 'gable') {
    case 'gable': k.add(rb, gable(L + 0.16, o.rh ?? 0.3, w + 0.18), roofC, T(cx, ry, 0)); k.s(box(L + 0.2, 0.03, 0.04), trim, T(cx, ry + (o.rh ?? 0.3), 0)); break;
    case 'swept': { const e = o.rh ?? 0.26; k.add(rb, rbox(L + 0.26, 0.04, w + 0.26, 0.01, 1), sh(roofC, 0.8), T(cx, ry + 0.02, 0)); k.add(rb, cone(0.7071, 1, 4), roofC, T(cx, ry + 0.04 + e / 2, 0, 0, PI / 4, 0, (L + 0.12) * 1.0, e, (w + 0.12) * 1.0)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.m(cone(0.026, 0.16, 5), o.tip ?? GOLD, T(cx + sx * (L / 2 + 0.14), ry + 0.07, sz * (w / 2 + 0.14), sz * 0.9, 0, -sx * 0.9)); k.m(ball(0.04, 8, 6), o.tip ?? GOLD, T(cx, ry + e + 0.06, 0)); break; }
    case 'flat': k.add(rb, rbox(L + 0.08, 0.06, w + 0.08, 0.01, 1), roofC, T(cx, ry + 0.03, 0)); break;
    case 'barrel': k.add(rb, cyl(w / 2 + 0.05, w / 2 + 0.05, L + 0.1, 14, false), roofC, T(cx, ry, 0, 0, 0, HP, 1, 1, 1)); break;
    case 'dome': k.add(rb, rbox(L + 0.08, 0.05, w + 0.08, 0.01, 1), sh(roofC, 0.8), T(cx, ry + 0.025, 0)); k.add(rb, hemi(Math.min(L, w) * 0.42, 14, 6), roofC, T(cx, ry + 0.05, 0, 0, 0, 0, 1, o.domeK ?? 0.9, 1)); k.m(cone(0.03, 0.16, 6), o.tip ?? GOLD, T(cx, ry + 0.05 + Math.min(L, w) * 0.42 * (o.domeK ?? 0.9) + 0.06, 0)); break;
    case 'onion': k.add(rb, rbox(L + 0.1, 0.05, w + 0.1, 0.01, 1), sh(roofC, 0.8), T(cx, ry + 0.025, 0)); k.add(rb, gable(L + 0.1, 0.14, w + 0.1), roofC, T(cx, ry + 0.05, 0)); k.s(cyl(0.1, 0.1, 0.14, 10), o.drum ?? wall, T(cx, ry + 0.2, 0)); onion(k, cx, ry + 0.26, 0, 1.25, o.dome ?? GOLD, o.tip ?? GOLD); break;
    default: break;
  }
}
/** a rail of posts with a rope or bar between them along a list of [x, z] */
function rail(k, pts, y, h, col, o = {}) {
  for (const [x, z] of pts) { k.add(o.bag || 'solid', o.postGeo ?? cyl(0.022, 0.026, h, 5), col, T(x, y + h / 2, z)); if (o.knob != null) k.m(ball(0.032, 6, 5), o.knob, T(x, y + h + 0.01, z)); }
  for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; if (o.rope) k.add('solid', sweep([[a[0], y + h - 0.04, a[1]], [(a[0] + b[0]) / 2, y + h - 0.1, (a[1] + b[1]) / 2], [b[0], y + h - 0.04, b[1]]], 0.01, 4, 6, o.rope), null); else k.rod(o.bag || 'solid', o.bar ?? col, [a[0], y + h - 0.02, a[1]], [b[0], y + h - 0.02, b[1]], 0.016, 5); }
}

// =====================================================================================================
// LAYOUTS: where the riders stand on each kind of boat
// =====================================================================================================
const GD = 0.2, RD = 0.32, FD = 0.26;
const gSeats = (d = GD) => [[-1.2, d, 0], [-0.62, d, 0], [-0.12, d, 0], [0.38, d, 0]];
const rSeats = (d = RD, wheel = false) => [[wheel ? -1.32 : -1.6, d, 0], [-0.88, d, -0.3], [-0.88, d, 0.3], [-0.32, d, -0.3], [-0.32, d, 0.3], [0.2, d, 0]];
const fSeats = (d = FD) => [[-1.0, d, 0.28], [-0.4, d, -0.34], [-0.4, d, 0.34], [0.2, d, -0.34], [0.2, d, 0.34]];

// standard hull shapes for each kind
const G_SHAPE = { x0: -1.7, x1: 1.7, B: 0.9, draft: 0.2, free: 0.34, bowRise: 0.4, sternRise: 0.28, br: 3, sr: 3, pb: 2.2, ps: 2.2, ex: 2.6, rocker: 0.1 };
const R_SHAPE = { x0: -2.1, x1: 2.1, B: 1.5, draft: 0.26, free: 0.5, bowRise: 0.24, sternRise: 0.2, br: 2.5, sr: 2.5, pb: 2.6, ps: 3.4, qb: 0.55, qs: 0.42, ex: 3.4, tr: 0.42, dp: 5 };

/** the usual oarage of a riverboat: two pairs */
function riverOars(k, C, H, o = {}) { for (const x of o.xs ?? [-0.62, -0.06]) for (const sd of [-1, 1]) { const p = H.side(x, sd, 0, -0.01); p[1] += 0.04; oar(k, C, p, sd, { out: 1.0, inb: 0.38, ...o }); } }
/** a stern rudder and tiller for a transom-sterned boat */
function rudder(k, H, col, tiller, o = {}) {
  const x = H.x0, tp = H.top(0);
  k.s(rbox(0.06, tp + 0.28, 0.32, 0.02, 1), col, T(x - 0.06, (tp - 0.28) / 2, 0, 0, 0, -0.08));
  k.s(slab([[0, 0], [-0.22, 0], [-0.26, -0.24], [0, -0.3]], 0.05), col, T(x - 0.06, -0.02, 0));
  k.rod('solid', tiller ?? sh(col, 0.8), [x - 0.06, tp + 0.08, 0], [x + 0.5, tp + 0.12, 0], 0.022, 6);
  if (o.knob) k.m(ball(0.035, 8, 6), o.knob, T(x + 0.52, tp + 0.12, 0));
}

// =====================================================================================================
// THE REALMS OF MEN
// =====================================================================================================
const WM = { o: 0xd8782a, w: 0xf0ece0, b: 0x1a2a5a };
/** realm accents among the kingdoms */
function kAccent(L) {
  const f = L.faction, c1 = L.cloth, c2 = L.cloth2, tr = L.trim;
  switch (f) {
    case 'westmark': return { top: WM.o, mid: WM.w, low: WM.b, sail: (u, v, i) => [WM.o, WM.w, WM.b][Math.min(2, Math.floor(u * 3))], fig: 'flag' };
    case 'aurelia': return { top: c1, mid: tr, low: sh(c1, 0.6), sail: (u, v, i) => (v < 0.16 ? tr : i % 3 === 1 ? c2 : c1), fig: 'eagle' };
    case 'graal': return { top: c1, mid: c2, low: sh(c1, 0.55), sail: (u, v, i) => (i & 1 ? c1 : c2), fig: 'lily' };
    case 'principalities': return { top: c1, mid: c2, low: sh(c1, 0.6), sail: (u, v, i) => (i & 1 ? c1 : c2), fig: 'lion' };
    case 'sunkings': return { top: c1, mid: tr, low: sh(c1, 0.6), sail: (u, v, i, j) => { const dx = u - 0.5, dy = v - 0.45; return dx * dx + dy * dy < 0.045 ? tr : c1; }, fig: 'sun' };
    default: return { top: c1, mid: c2, low: sh(c1, 0.6), sail: (u, v, i) => (i & 1 ? c2 : sh(c2, 0.9)), fig: 'shield' };
  }
}
/** the figure on a kingdom's prow, standing at p facing +x */
function kFigure(k, L, A, p, s = 1) {
  const tr = L.trim;
  k.push(T(p[0], p[1], p[2], 0, 0, 0, s));
  switch (A.fig) {
    case 'eagle': k.m(ball(0.07, 10, 8), tr, T(0, 0.08, 0, 0, 0, 0, 1.2, 1, 0.9)); k.m(ball(0.045, 8, 6), tr, T(0.07, 0.16, 0)); k.m(cone(0.022, 0.07, 5), tr, T(0.12, 0.15, 0, 0, 0, -HP - 0.4)); for (const sz of [-1, 1]) k.m(leaf(0.26, 0.12, 0.1, null, { nv: 5 }), tr, T(-0.02, 0.1, sz * 0.05, sz * -1.1, 0, 0.3)); k.m(cone(0.05, 0.12, 6), tr, T(-0.08, 0.02, 0, 0, 0, HP)); break;
    case 'lily': shield(k, 0.01, 0.02, 0, HP, 0.9, L.cloth, L.cloth2, tr, 2); for (const [dz, ry] of [[0, 0], [-0.05, -0.6], [0.05, 0.6]]) k.m(leaf(0.16, 0.06, 0.3, null, { nv: 4 }), tr, T(0, 0.16, dz, ry, HP, 0)); k.m(box(0.03, 0.03, 0.12), tr, T(0, 0.18, 0)); break;
    case 'lion': k.m(ball(0.075, 10, 8), tr, T(0.02, 0.1, 0)); k.m(torus(0.07, 0.03, 6, 14), sh(tr, 0.8), T(0.0, 0.1, 0, 0, HP)); k.m(rbox(0.06, 0.05, 0.06, 0.02, 1), tr, T(0.09, 0.08, 0)); break;
    case 'sun': k.m(cyl(0.11, 0.11, 0.03, 16), tr, T(0, 0.14, 0, HP, HP, 0)); for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; k.m(cone(0.025, 0.09, 4), tr, T(0, 0.14 + Math.sin(a) * 0.15, Math.cos(a) * 0.15, -a + HP, 0, 0)); } break;
    case 'flag': k.rod('solid', 0x5a4026, [0, 0, 0], [0, 0.55, 0], 0.014, 5); for (let q = 0; q < 3; q++) k.c(surf(5, 1, (u, v, out) => { out[0] = -u * 0.36; out[1] = 0.5 - (q + v) * 0.07; out[2] = Math.sin(u * 4) * 0.03; }, [WM.o, WM.w, WM.b][q])); k.m(ball(0.028, 6, 5), GOLD, T(0, 0.57, 0)); break;
    default: shield(k, 0.01, 0.04, 0, HP, 1, L.cloth, L.cloth2, tr, 0); k.m(ball(0.035, 8, 6), tr, T(0, 0.2, 0)); break;
  }
  k.pop();
}
function kingdomGondola(k, C) {
  const L = C.L, A = kAccent(L), H = shape(G_SHAPE), tr = L.trim, W = L.wood;
  shell(k, H, hcol(H, { out: W, in: sh(W, 0.75), rim: tr }));
  paint(k, H, 0, 0.06, A.top); paint(k, H, 0.06, 0.08, A.mid, 0.05, 0.95, 'metal');
  if (C.f === 'westmark') { paint(k, H, 0.08, 0.13, WM.w); paint(k, H, 0.13, 0.19, WM.b); } else paint(k, H, 0.08, 0.2, A.low, 0.06, 0.94);
  ownerBand(k, H, 0.13, 0.17, 0.18, 0.8);
  gunwale(k, H, sh(tr, 0.9), 0.02, { bag: 'metal', s0: 0.04, s1: 0.96 });
  floor(k, H, -1.45, 1.3, GD, sh(W, 1.1));
  // the iron stem-head and the figure on the prow
  const bt = H.at(0.995, 0.5); post(k, [[bt[0] - 0.14, bt[1] - 0.06, 0], [bt[0] - 0.02, bt[1] - 0.02, 0], [bt[0] + 0.07, bt[1] + 0.12, 0]], 0.03, tr, 'metal');
  kFigure(k, L, A, [bt[0] + 0.07, bt[1] + 0.12, 0], 1.05);
  const st = H.at(0.005, 0.5); post(k, [[st[0] + 0.14, st[1] - 0.05, 0], [st[0] + 0.02, st[1], 0], [st[0] - 0.04, st[1] + 0.14, 0], [st[0] + 0.02, st[1] + 0.22, 0]], 0.026, sh(W, 0.7));
  lampPost(k, -1.42, H.topAt(-1.42), -0.16, 0.7, L.glow, 0x2a2a2e, -1);
  // the boatman's oar on its forked rest
  const fp = H.side(-0.92, 1, 0, -0.02); k.s(rbox(0.06, 0.24, 0.06, 0.015, 1), sh(W, 0.7), T(fp[0], fp[1] + 0.1, fp[2])); k.m(torus(0.035, 0.012, 4, 8, PI), tr, T(fp[0], fp[1] + 0.24, fp[2], 0, HP, 0));
  oar(k, C, [fp[0], fp[1] + 0.25, fp[2]], 1, { e: [fp[0] - 1.05, -0.05, fp[2] + 0.32], h: [fp[0] + 0.45, fp[1] + 0.42, fp[2] - 0.32], bl: 0.4, bw: 0.11, lock: false });
  // little rider's rail amidships, shields or gilt
  for (const sd of [-1, 1]) for (const x of [-0.4, 0.15]) { const p = H.side(x, sd, 0.08, -0.012); if (C.f === 'graal' || C.f === 'kingdom') shield(k, p[0], p[1], p[2], sd > 0 ? 0 : PI, 0.55, x > 0 ? L.cloth : L.cloth2, x > 0 ? L.cloth2 : L.cloth, tr, 0); else k.m(cyl(0.045, 0.045, 0.02, 10), tr, T(p[0], p[1], p[2], HP)); }
  heap(k, 0.95, GD, 0, [['crate', 0, -0.06, 1.3, 0.2], ['sack', 0.27, 0.1, 1.2, 1.2], ['barrel', 0.0, 0.18, 1.1]], H);
  heap(k, -1.5, GD + 0.04, 0, [['sack', 0, 0.02, 1.0, 0.4]]);
  flagstaff(k, 1.22, GD, -0.2, 0.75, { h: 0.18, w: 0.42 });
  if (C.f === 'principalities') for (const x of [-0.85, 0.65]) { k.add('solid', cyl(0.018, 0.018, 0.5, 6), (px, py) => (Math.floor((py + 0.25) * 10) & 1 ? L.cloth : L.cloth2), T(x, H.topAt(x) + 0.25, 0.38)); k.m(ball(0.03, 6, 5), tr, T(x, H.topAt(x) + 0.52, 0.38)); }
}
function kingdomRiver(k, C) {
  const L = C.L, A = kAccent(L), H = shape(R_SHAPE), tr = L.trim, W = L.wood, f = C.f;
  shell(k, H, hcol(H, { out: W, in: sh(W, 0.7), rim: sh(W, 0.7) }));
  paint(k, H, 0, 0.08, A.top); paint(k, H, 0.08, 0.1, A.mid, 0.03, 0.97, f === 'aurelia' || f === 'sunkings' ? 'metal' : 'solid'); if (f === 'westmark') { paint(k, H, 0.1, 0.16, WM.w); paint(k, H, 0.24, 0.3, WM.b); }
  ownerBand(k, H, 0.17, 0.24, 0.12, 0.86);
  gunwale(k, H, sh(W, 0.65), 0.03); wale(k, H, 0.3, sh(W, 0.6), 0.02);
  floor(k, H, -1.95, 1.95, RD, sh(W, 1.12), { step: 0.12 });
  // a timbered deckhouse forward of the riders
  cabin(k, 0.48, 1.12, 0.96, 0.62, RD, { wall: f === 'aurelia' ? 0xe8e0d0 : 0xd8c8a0, trim: sh(W, 0.6), roofCol: f === 'westmark' ? WM.b : A.top, roof: 'gable', rh: 0.3, winGlow: true, winCol: sh(L.glow, 1.1) });
  if (f === 'aurelia') for (const sz of [-1, 1]) k.m(box(0.66, 0.04, 0.02), tr, T(0.8, RD + 0.5, sz * 0.49));
  // mast and square sail
  const mx = 1.28; k.rod('solid', sh(W, 0.75), [mx, RD - 0.05, 0], [mx, 2.75, 0], 0.04, 8); k.m(cyl(0.07, 0.05, 0.12, 8), tr, T(mx, 2.75, 0));
  sqSail(k, mx, 1.22, 2.5, 1.36, (u, v, i, j) => A.sail(u, v, i, j), { owner: [0.06, 0.16], bil: 0.16, nu: 12 });
  if (f === 'aurelia') { k.m(cyl(0.16, 0.16, 0.02, 14), tr, T(mx + 0.26, 1.9, 0, 0, 0, HP)); }
  flagstaff(k, mx, 2.8, 0, 0.3, { h: 0.2, w: 0.6, knob: tr });
  for (const sd of [-1, 1]) { k.rod('solid', ROPE, [mx, 2.55, 0], [H.x1 - 0.1, H.topAt(1.95), 0], 0.008, 3); k.rod('solid', ROPE, [mx, 2.55, 0], [mx - 0.2, H.topAt(mx - 0.2), sd * 0.66], 0.008, 3); }
  // shields along the rails, or gilt roundels
  for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) { const x = -1.5 + i * 0.4, p = H.side(x, sd, 0.08, -0.012); if (f === 'graal' || f === 'kingdom' || f === 'westmark') shield(k, p[0], p[1], p[2], sd > 0 ? 0 : PI, 0.7, i & 1 ? A.top : A.mid, i & 1 ? A.mid : A.top, tr, i % 3); else k.m(cyl(0.055, 0.055, 0.02, 12), tr, T(p[0], p[1], p[2], HP)); }
  kFigure(k, L, A, [H.x1 + 0.02, H.top(1) - 0.02, 0], 1.25);
  rudder(k, H, sh(W, 0.8), sh(W, 0.6), { knob: tr });
  lampPost(k, -1.95, H.topAt(-1.95), 0.5, 0.75, L.glow, 0x2a2a2e, -1);
  riverOars(k, C, H, { shaft: 0x9a7a4a });
  heap(k, 1.55, RD, 0, [['crate', 0, -0.3, 1.5, 0.1], ['crate', 0.02, -0.3, 1.2, 0.5, 0xb08a5a, 0.3], ['barrel', 0.0, 0.05, 1.5], ['sack', 0.3, 0.2, 1.4, 1.2], ['sack', 0.28, -0.12, 1.3, 0.3], ['barrel', -0.12, 0.38, 1.3]], H);
  heap(k, -1.7, RD, 0, [['barrel', 0, -0.5, 1.3], ['cask', 0.02, 0.5, 1.2, HP], ['sack', -0.25, -0.45, 1.2, 0.4]], H);
  if (f === 'principalities') { for (const sd of [-1, 1]) k.c(surf(8, 1, (u, v, out) => { out[0] = 0.48 + u * 0.64; out[1] = RD + 0.62 - v * 0.14; out[2] = sd * (0.5 + v * 0.05); }, (u, v, i) => (i & 1 ? L.cloth : L.cloth2))); }
}
function kingdomRaft(k, C) {
  const L = C.L, A = kAccent(L), tr = L.trim, W = L.wood, f = C.f;
  // four floats of whole logs under a plank deck
  for (const z of [-0.58, -0.2, 0.2, 0.58]) { k.s(cyl(0.15, 0.15, 3.0, 10), sh(W, 0.75 + rnd(z * 9) * 0.2), T(0, 0.03, z, 0, 0, HP)); for (const sx of [-1, 1]) k.s(cyl(0.12, 0.12, 0.012, 10), 0xc8a878, T(sx * 1.5, 0.03, z, 0, 0, HP)); }
  for (let i = 0; i < 24; i++) { const x = -1.38 + i * 0.12; k.s(box(0.11, 0.05, 1.6), sh(W, 1.0 + 0.24 * rnd(i * 3)), T(x, FD - 0.025, 0)); }
  for (const z of [-0.79, 0.79]) k.s(box(3.0, 0.1, 0.06), A.top, T(0, FD - 0.03, z));
  for (const x of [-1.47, 1.47]) k.s(box(0.06, 0.1, 1.64), sh(W, 0.6), T(x, FD - 0.03, 0));
  k.o(box(2.2, 0.05, 0.012), WHITE, T(0, FD - 0.02, 0.825)); k.o(box(2.2, 0.05, 0.012), WHITE, T(0, FD - 0.02, -0.825));
  // rope rails on turned posts, gilt caps
  for (const sd of [-1, 1]) rail(k, [[-1.4, sd * 0.74], [-0.7, sd * 0.74], [0, sd * 0.74], [0.7, sd * 0.74], [1.4, sd * 0.74]], FD, 0.42, sh(W, 0.7), { rope: ROPE, knob: tr });
  // a ferry ramp at the bow, raised on chains
  k.s(rbox(0.5, 0.05, 1.1, 0.01, 1), sh(W, 0.9), T(1.62, FD + 0.17, 0, 0, 0, 0.75)); for (const z of [-0.5, 0.5]) k.rod('metal', 0x3a3a40, [1.42, FD + 0.62, z], [1.78, FD + 0.34, z], 0.008, 3);
  for (const z of [-0.5, 0.5]) { k.s(rbox(0.07, 0.62, 0.07, 0.015, 1), sh(W, 0.6), T(1.42, FD + 0.31, z)); k.m(ball(0.04, 8, 6), tr, T(1.42, FD + 0.64, z)); }
  kFigure(k, L, A, [1.42, FD + 0.66, 0.5], 0.8);
  if (f === 'graal' || f === 'kingdom') for (const sd of [-1, 1]) for (const x of [-0.7, 0.7]) shield(k, x, FD + 0.24, sd * 0.77, sd > 0 ? 0 : PI, 0.75, x > 0 ? L.cloth : L.cloth2, x > 0 ? L.cloth2 : L.cloth, tr, 1);
  if (f === 'westmark') for (const sd of [-1, 1]) k.c(surf(12, 1, (u, v, out) => { out[0] = -1.4 + u * 2.8; out[1] = FD + 0.38 - v * 0.08 - Math.sin(PI * ((u * 4) % 1)) * 0.06; out[2] = sd * 0.745; }, (u, v, i) => [WM.o, WM.w, WM.b][i % 3]));
  if (f === 'sunkings' || f === 'principalities' || f === 'aurelia') { // a striped awning over the stern stores
    for (const [x, z] of [[-1.42, -0.7], [-1.42, -0.1], [-0.95, -0.7], [-0.95, -0.1]]) k.rod('solid', sh(W, 0.7), [x, FD, z], [x, FD + 1.05, z], 0.02, 5);
    k.c(surf(6, 4, (u, v, out) => { out[0] = -1.46 + v * 0.56; out[1] = FD + 1.05 + Math.sin(PI * u) * 0.08; out[2] = -0.74 + u * 0.68; }, (u, v, i) => (i & 1 ? L.cloth : f === 'sunkings' ? L.trim : L.cloth2)));
  }
  lampPost(k, 1.2, FD, -0.72, 0.75, L.glow, 0x2a2a2e, 1);
  flagstaff(k, -1.42, FD, 0.72, 1.0, { h: 0.24, w: 0.6, knob: tr });
  heap(k, 1.0, FD, 0, [['crate', 0, -0.3, 1.5, 0.1], ['crate', 0.25, 0.3, 1.4, 0.4], ['sack', 0.05, 0.1, 1.4, 1.0], ['barrel', 0.28, -0.05, 1.4]]);
  heap(k, -1.25, FD, 0, [['barrel', 0, -0.42, 1.3], ['sack', 0.15, -0.2, 1.3, 0.5]]);
  pole(k, C, [-1.0, FD + 0.9, 0.52], { col: 0x9a7a4a, shoe: 0x3a3a40 });
}

// =====================================================================================================
// SHARED BUILDING BLOCKS FOR THE OTHER PEOPLES
// =====================================================================================================
/** shell + paint + owner band + gunwale + floor in one call */
function baseHull(k, C, shp, o = {}) {
  const H = shape(shp);
  shell(k, H, hcol(H, o.col), { bag: o.bag, m: o.m, nv: o.nv });
  for (const p of o.paint || []) paint(k, H, ...p);
  if (o.owner) ownerBand(k, H, ...o.owner);
  if (o.gun !== false) gunwale(k, H, o.gun ?? sh(C.L.wood, 0.7), o.gunR ?? 0.022, o.gunO ?? {});
  if (o.floor !== false) floor(k, H, o.fx0 ?? H.x0 + 0.3, o.fx1 ?? H.x1 - 0.35, C.deck, o.floor ?? sh(C.L.wood, 1.1), o.floorO ?? {});
  return H;
}
/** the boatman's long oar on its forked rest at the stern quarter */
function gondolierOar(k, C, H, o = {}) {
  const fp = H.side(o.x ?? -0.92, 1, 0, -0.02);
  k.add(o.restBag || 'solid', rbox(0.06, 0.24, 0.06, 0.015, 1), o.rest ?? sh(C.L.wood, 0.7), T(fp[0], fp[1] + 0.1, fp[2])); k.m(torus(0.035, 0.012, 4, 8, PI), o.fork ?? C.L.trim, T(fp[0], fp[1] + 0.24, fp[2], 0, HP, 0));
  oar(k, C, [fp[0], fp[1] + 0.25, fp[2]], 1, { e: [fp[0] - 1.05, -0.05, fp[2] + 0.32], h: [fp[0] + 0.45, fp[1] + 0.42, fp[2] - 0.32], bl: 0.4, bw: 0.11, lock: false, ...(o.oar || {}) });
}
/** a sculling oar over the transom */
function yuloh(k, C, H, o = {}) { const x = H.x0 + 0.04, y = H.top(0) + 0.06; k.s(rbox(0.08, 0.06, 0.1, 0.02, 1), o.rest ?? sh(C.L.wood, 0.6), T(x, y - 0.03, 0)); oar(k, C, [x, y, 0], 1, { e: [x - 1.15, -0.06, 0.18], h: [x + 0.55, y + 0.36, -0.12], bl: 0.42, bw: 0.12, lock: false, ...(o.oar || {}) }); }
function rivetRow(k, H, dt, col, s0 = 0.08, s1 = 0.92, n = 18) { for (const sd of [-1, 1]) for (let i = 0; i < n; i++) { const s = s0 + ((s1 - s0) * i) / (n - 1), p = H.at(s, H.aAt(s, dt, sd), -0.004); k.m(ball(0.016, 5, 3), col, T(p[0], p[1], p[2])); } }
function spikes(k, H, dt, col, n, len = 0.14, s0 = 0.12, s1 = 0.88, bag = 'metal', up = 0.7) { for (const sd of [-1, 1]) for (let i = 0; i < n; i++) { const s = s0 + ((s1 - s0) * i) / (n - 1), p = H.at(s, H.aAt(s, dt, sd), -0.01); k.add(bag, cone(0.025, len, 5), col, TA([p[0], p[1] + len * 0.3 * up, p[2] + sd * len * 0.35], [0, up, sd])); } }
function barnacles(k, H, n, seed = 1, col = 0xb8b0a0) { for (let i = 0; i < n; i++) { const r = rnd(i * 3.7 + seed), sd = i & 1 ? 1 : -1, s = 0.08 + 0.84 * r, dt = H.top(s) - (0.02 + rnd(i * 5.1) * 0.12), p = H.at(s, H.aAt(s, dt, sd), -0.008); k.s(cone(0.022 + rnd(i) * 0.012, 0.035, 5), sh(col, 0.8 + rnd(i * 2.3) * 0.3), TA(p, [0, 0.2, sd])); } }
function seaweed(k, H, n, col = 0x3a6a3a, seed = 2) { for (let i = 0; i < n; i++) { const sd = i & 1 ? 1 : -1, s = 0.1 + 0.8 * rnd(i * 4.3 + seed), p = H.at(s, sd > 0 ? 1 : 0, -0.02); k.s(sweep([p, [p[0] + 0.02, p[1] - 0.12, p[2] + sd * 0.03], [p[0] - 0.03, p[1] - 0.26, p[2] + sd * 0.02], [p[0] + 0.02, p[1] - 0.4 - rnd(i) * 0.15, p[2] + sd * 0.0]], 0.016, 4, 8, sh(col, 0.8 + rnd(i * 7) * 0.4), { flat: 0.3 }), null); } }
function icicles(k, H, n, s0 = 0.1, s1 = 0.9) { for (const sd of [-1, 1]) for (let i = 0; i < n; i++) { const s = s0 + ((s1 - s0) * (i + rnd(i) * 0.5)) / n, p = H.at(s, H.aAt(s, 0.03, sd), -0.012), l = 0.08 + rnd(i * 3.1 + sd) * 0.14; k.m(cone(0.016, l, 5), i & 1 ? 0xd8f0ff : 0xb8dcf0, T(p[0], p[1] - l / 2, p[2], PI)); } }
function paperLantern(k, x, y, z, col, s = 1, cap = 0x2a1a14) { k.g(ball(0.075, 10, 7), col, T(x, y, z, 0, 0, 0, s, s * 1.25, s)); for (const d of [-1, 1]) k.s(cyl(0.035 * s, 0.035 * s, 0.025 * s, 8), cap, T(x, y + d * 0.09 * s, z)); k.s(cone(0.015 * s, 0.07 * s, 5), 0xc8a040, T(x, y - 0.14 * s, z, PI)); }
function torii(k, x, y, z, s, red = 0xc02a1a, black = 0x1a1414) {
  k.push(T(x, y, z, 0, 0, 0, s));
  for (const sz of [-1, 1]) { k.s(cyl(0.035, 0.042, 0.72, 8), red, T(0, 0.36, sz * 0.3)); k.s(cyl(0.05, 0.05, 0.06, 8), black, T(0, 0.03, sz * 0.3)); }
  k.s(box(0.06, 0.06, 0.78), red, T(0, 0.58, 0)); k.s(box(0.08, 0.06, 0.04), red, T(0, 0.64, 0));
  k.s(sweep([[0, 0.74, -0.52], [0, 0.7, -0.3], [0, 0.69, 0], [0, 0.7, 0.3], [0, 0.74, 0.52]], 0.045, 5, 12, black, { flat: 0.6 }), null);
  k.pop();
}
function nobori(k, x, y, z, h, emblem = 0xf0ece0, pc = 0x1a1414) { k.rod('solid', pc, [x, y, z], [x, y + h, z], 0.015, 5); k.rod('solid', pc, [x, y + h - 0.02, z], [x - 0.22, y + h - 0.02, z], 0.01, 4); k.o(surf(3, 6, (u, v, out) => { out[0] = x - 0.02 - u * 0.2; out[1] = y + h - 0.03 - v * h * 0.62; out[2] = z + Math.sin(v * 5 + u) * 0.02; }, WHITE)); k.s(cyl(0.05, 0.05, 0.01, 10), emblem, T(x - 0.12, y + h - 0.2, z + 0.008, HP)); k.s(cyl(0.05, 0.05, 0.01, 10), emblem, T(x - 0.12, y + h - 0.2, z - 0.008, HP)); }
function parasol(k, x, y0, z, h, r, c1, c2, tas = GOLD) { k.rod('solid', 0x5a4026, [x, y0, z], [x, y0 + h, z], 0.016, 5); k.c(rev([[r, 0], [r * 0.7, 0.1], [r * 0.3, 0.17], [0, 0.2]], 12, (u, v, i) => (i & 1 ? c1 : c2)), null, T(x, y0 + h - 0.12, z)); k.m(cone(0.03, 0.12, 6), tas, T(x, y0 + h + 0.12, z)); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; k.m(cone(0.018, 0.08, 5), tas, T(x + Math.cos(a) * r, y0 + h - 0.16, z + Math.sin(a) * r, PI)); } }
function garland(k, pts, col, n = 14, r = 0.03) { const cv = new THREE.CatmullRomCurve3(pts.map((q) => new V3(...q))); for (let i = 0; i <= n; i++) { const p = cv.getPoint(i / n); k.s(ball(r, 6, 4), i % 3 ? col : sh(col, 0.75), T(p.x, p.y, p.z)); } }
function idol(k, x, y, z, s, col = GOLD, ry = 0) {
  k.push(T(x, y, z, 0, ry, 0, s));
  lotus(k, 0, 0, 0, 0.9, 0xe86a8a, 0xf0c0c8, 8); k.m(ball(0.07, 10, 8), col, T(0, 0.13, 0, 0, 0, 0, 1, 1.2, 0.85)); k.m(ball(0.045, 8, 6), col, T(0, 0.24, 0)); k.m(cone(0.03, 0.09, 6), col, T(0, 0.31, 0));
  for (const sz of [-1, 1]) for (const a of [0.5, 1.1]) k.m(cyl(0.012, 0.012, 0.12, 4), col, T(0, 0.15 + (a - 0.8) * 0.05, sz * 0.09, sz * -a, 0, 0));
  k.m(torus(0.11, 0.012, 4, 14, PI), col, T(-0.03, 0.2, 0, 0, HP, 0)); k.pop();
}
/** a lattice screen in the local xy plane (w by h), turned by ry */
function lattice(k, x, y, z, w, h, ry, col, back = 0x2a2018, n = 6) {
  k.push(T(x, y, z, 0, ry, 0));
  k.s(box(w, h, 0.01), back, T(0, h / 2, -0.012));
  for (let i = 0; i <= n; i++) { k.s(box(0.014, h, 0.02), col, T(-w / 2 + (w * i) / n, h / 2, 0)); }
  const m = Math.round((n * h) / w); for (let j = 0; j <= m; j++) k.s(box(w, 0.014, 0.02), col, T(0, (h * j) / m, 0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) if ((i + j) & 1) k.s(box(0.02, 0.02, 0.022), sh(col, 1.2), T(-w / 2 + (w * (i + 0.5)) / n, (h * (j + 0.5)) / m, 0, 0, 0, PI / 4));
  k.pop();
}
/** an awning or hood: a half-barrel of cloth along x from x0 to x1 at height y */
function hood(k, x0, x1, y, w, h, col, o = {}) { k.add(o.bag || 'cloth', surf(o.nu ?? 10, o.nv ?? 6, (u, v, out) => { const a = PI * u; out[0] = x0 + (x1 - x0) * v; out[1] = y + Math.sin(a) * h; out[2] = -Math.cos(a) * w / 2; }, col), null); if (o.ribs) for (let i = 0; i <= o.ribs; i++) { const x = x0 + ((x1 - x0) * i) / o.ribs, pts = []; for (let q = 0; q <= 8; q++) { const a = (PI * q) / 8; pts.push([x, y + Math.sin(a) * (h + 0.01), -Math.cos(a) * (w / 2 + 0.01)]); } k.add('solid', sweep(pts, 0.014, 4, 12, o.ribCol ?? 0x5a4026), null); } }
/** a bundle of reeds along a path; r may vary */
function reedBundle(k, pts, r, col, ties = 6, tie = 0x6a5030, seg = 24) {
  k.s(sweep(pts, r, 7, seg, (u, v, i, j) => sh(col, i & 1 ? 0.9 : 1.05)), null);
  const cv = new THREE.CatmullRomCurve3(pts.map((q) => new V3(...q)));
  for (let t = 1; t <= ties; t++) { const v = t / (ties + 1), p = cv.getPoint(v), d = cv.getTangent(v), rr = typeof r === 'function' ? r(v) : r; k.s(torus(rr * 1.02, 0.012, 4, 10), tie, TA([p.x, p.y, p.z], [d.x, d.y, d.z]).multiply(T(0, 0, 0, HP))); }
}

// =====================================================================================================
// THE ELVEN COURTS
// =====================================================================================================
function swanNeck(k, x, y, s, col, beak, eye = DARK) {
  k.push(T(x, y, 0, 0, 0, 0, s));
  k.s(sweep([[-0.2, -0.05, 0], [0.08, 0.05, 0], [0.18, 0.35, 0], [0.06, 0.66, 0], [0.12, 0.86, 0], [0.24, 0.88, 0]], (v) => 0.075 - v * 0.035, 8, 22, col), null);
  k.s(ball(0.065, 10, 8), col, T(0.24, 0.89, 0, 0, 0, 0, 1.3, 0.9, 0.85)); k.m(cone(0.03, 0.13, 6), beak, T(0.35, 0.87, 0, 0, 0, -HP - 0.15)); k.s(ball(0.024, 6, 5), DARK, T(0.33, 0.86, 0));
  for (const sz of [-1, 1]) k.add(eye === DARK ? 'solid' : 'glow', ball(0.014, 6, 4), eye, T(0.27, 0.91, sz * 0.05));
  k.pop();
}
function featherFan(k, x, y, z, n, len, col, col2, spread = 1.2, tilt = 0.3, bag = 'solid') { for (let i = 0; i < n; i++) { const a = -spread / 2 + (spread * i) / Math.max(1, n - 1); k.add(bag, leaf(len * (1 - Math.abs(a) * 0.3), len * 0.22, 0.15, i & 1 ? col : col2, { nv: 6 }), null, T(x, y, z, tilt, HP, a)); } }
function bladeFin(k, x, y, z, s, col, edge, sd, bag = 'metal') { k.add(bag, slab([[0, 0], [-0.32, 0.04], [-0.5, 0.18], [-0.22, 0.12]], 0.018), col, T(x, y, z, 0, 0, 0.15, s)); k.g(slab([[-0.32, 0.045], [-0.5, 0.19], [-0.48, 0.2], [-0.3, 0.06]], 0.022), edge, T(x, y, z, 0, 0, 0.15, s)); }
function elvenHull(k, C, shp, o) {
  const L = C.L, dark = C.f === 'kaelneth', W = dark ? 0x241e2c : L.wood, tr = dark ? 0x8a7a9a : L.trim;
  return baseHull(k, C, shp, { col: { out: W, strake: dark ? 0.1 : 0, in: sh(W, dark ? 1.3 : 0.86), rim: tr, bottom: dark ? 0x141018 : sh(W, 0.7) }, paint: [[0.03, 0.055, tr, 0.04, 0.96, 'metal'], [0.11, 0.125, dark ? L.glow : L.cloth2, 0.08, 0.92, dark ? 'glow' : 'solid']], owner: [0.065, 0.1, 0.16, 0.84], gun: tr, gunO: { bag: 'metal', s0: 0.03, s1: 0.97 }, floor: dark ? 0x3a3242 : 0xf0e8d4, ...o });
}
function elvenGondola(k, C) {
  const L = C.L, dark = C.f === 'kaelneth', tr = dark ? 0x8a7a9a : L.trim, gl = L.glow, W = dark ? 0x241e2c : L.wood;
  const H = elvenHull(k, C, { ...G_SHAPE, B: 0.84, bowRise: dark ? 0.26 : 0.18, sternRise: 0.4, sr: 2.2, pb: 1.7, ps: 1.7, ex: 2.2, rocker: 0.14 }, { fx0: -1.42, fx1: 1.32 });
  const bt = H.at(0.995, 0.5), st = H.at(0.005, 0.5);
  if (dark) { // a scythe of a prow, finned flanks and a violet crystal
    k.m(slab([[0, 0], [0.22, 0.25], [0.2, 0.62], [0.05, 0.95], [0.12, 0.6], [0.08, 0.3], [-0.1, 0.08]], 0.03), 0x2a2432, T(bt[0] - 0.08, bt[1] - 0.06, 0));
    k.g(slab([[0.2, 0.62], [0.05, 0.95], [0.08, 0.92], [0.22, 0.6]], 0.036), gl, T(bt[0] - 0.08, bt[1] - 0.06, 0));
    for (const sd of [-1, 1]) for (const x of [-0.7, 0, 0.7]) { const p = H.side(x, sd, 0.02, -0.01); bladeFin(k, p[0] + 0.15, p[1], p[2], 0.8, 0x2a2432, gl, sd); }
    k.m(sweep([[st[0] + 0.1, st[1] - 0.05, 0], [st[0] - 0.05, st[1] + 0.15, 0], [st[0] + 0.05, st[1] + 0.4, 0]], (v) => 0.04 - v * 0.03, 5, 8, 0x2a2432), null);
    k.g(oct(0.07), gl, T(st[0] + 0.05, st[1] + 0.48, 0, 0, 0, 0, 1, 1.6, 1));
  } else { // a swan: neck at the bow, folded wings along the flanks, a fan of tail feathers astern
    swanNeck(k, bt[0] - 0.08, bt[1] - 0.04, 1.05, 0xf4f0e8, GOLD);
    for (const sd of [-1, 1]) { const p = H.side(0.95, sd, 0.03, -0.02); k.s(leaf(0.75, 0.24, 0.05, (u, v, i, j) => (j > 5 ? 0xe8e0d0 : 0xf8f4ec), { nv: 8, nu: 4 }), null, T(p[0], p[1] - 0.02, p[2] + sd * 0.02, 0, sd > 0 ? 0 : PI, HP + 0.08)); }
    featherFan(k, st[0] + 0.02, st[1] - 0.02, 0, 7, 0.42, 0xf4f0e8, 0xe0d8c8, 1.4, 0.15);
  }
  lampPost(k, -1.38, H.topAt(-1.38), 0.14, 0.72, gl, dark ? 0x2a2432 : tr, -1, 'dome');
  gondolierOar(k, C, H, { rest: W, fork: tr, oar: { shaft: dark ? 0x3a3242 : 0xe8e0cc, bcol: dark ? 0x2a2432 : 0xd8c8a0 } });
  heap(k, 0.98, GD, 0, [['chest', 0, -0.05, 1.3, 0.1, dark ? 0x2a2432 : 0xf0ead8], ['bundle', 0.28, 0.06, 1.1, 0.2, dark ? 0x5a1a2a : L.cloth2], ['jar', -0.05, 0.2, 1.1, 0, dark ? 0x3a3242 : 0xd8e8e0]], H);
  heap(k, -1.52, GD + 0.04, 0, [['bundle', 0, 0, 0.9, 0, dark ? 0x5a1a2a : L.cloth2]], H);
  flagstaff(k, 1.2, GD, -0.18, 0.8, { h: 0.18, w: 0.5, kind: 'point', col: dark ? 0x2a2432 : 0xe8e0cc, knob: tr, knobGeo: oct(0.04) });
}
function elvenRiver(k, C) {
  const L = C.L, dark = C.f === 'kaelneth', tr = dark ? 0x8a7a9a : L.trim, gl = L.glow, W = dark ? 0x241e2c : L.wood, c2 = L.cloth2;
  const H = elvenHull(k, C, { ...R_SHAPE, B: 1.42, tr: 0, ps: 1.9, pb: 1.9, qs: 0.6, bowRise: 0.22, sternRise: 0.5, sr: 2.2, ex: 2.6, dp: 3 }, { fx0: -1.85, fx1: 1.8 });
  const bt = H.at(0.995, 0.5), st = H.at(0.005, 0.5);
  // a pavilion of slender posts and a leaf roof
  for (const [x, z] of [[0.5, -0.42], [0.5, 0.42], [1.1, -0.42], [1.1, 0.42]]) { k.add(dark ? 'metal' : 'solid', cyl(0.025, 0.03, 0.95, 6), dark ? 0x2a2432 : 0xf4f0e6, T(x, RD + 0.475, z)); k.m(torus(0.035, 0.01, 4, 8), tr, T(x, RD + 0.9, z, HP)); }
  if (dark) { k.m(gable(0.78, 0.4, 1.05), 0x2a2432, T(0.8, RD + 0.95, 0)); for (const sz of [-1, 1]) for (const x of [0.45, 0.8, 1.15]) k.m(cone(0.03, 0.26, 4), 0x2a2432, T(x, RD + 0.98, sz * 0.55, sz * 0.9, 0, 0)); k.g(box(0.8, 0.02, 0.02), gl, T(0.8, RD + 1.36, 0)); }
  else for (const sz of [-1, 1]) k.c(leaf(0.95, 0.75, 0.12, (u, v, i, j) => (i === 1 || i === 2 ? sh(c2, 1.1) : c2), { nv: 8, nu: 4 }), null, T(0.33, RD + 0.92, sz * 0.02, sz * 0.55, 0, -HP));
  lantern(k, 0.8, RD + 0.86, 0, gl, tr, 1.1, 'dome');
  // the mast and a leaf of a sail, fore and aft
  const mx = 1.3; k.rod('solid', dark ? 0x2a2432 : 0xe8e0cc, [mx, RD, 0], [mx, 3.0, 0], 0.035, 8); k.add(dark ? 'glow' : 'metal', oct(0.07), dark ? gl : tr, T(mx, 3.08, 0, 0, 0, 0, 1, 1.5, 1));
  const sc = dark ? (u, v, i, j) => (i === 5 ? gl : j & 1 ? L.cloth : sh(L.cloth, 0.8)) : (u, v, i, j) => (i === 5 ? sh(c2, 1.2) : (i + j) % 4 === 0 ? 0xe8f0ec : L.cloth);
  faSail(k, [mx, 1.5, 0], [-0.55, 1.55, 0], [-0.35, 2.35, 0], [mx - 0.05, 2.95, 0], sc, { owner: [0.05, 0.13], bil: 0.14 });
  k.rod('solid', dark ? 0x2a2432 : 0xe8e0cc, [mx, 1.5, 0], [-0.6, 1.55, 0], 0.02, 5);
  if (dark) { k.m(slab([[0, 0], [0.3, 0.3], [0.32, 0.8], [0.08, 1.2], [0.16, 0.75], [0.1, 0.35], [-0.12, 0.1]], 0.04), 0x2a2432, T(bt[0] - 0.1, bt[1] - 0.1, 0)); k.g(slab([[0.32, 0.8], [0.08, 1.2], [0.12, 1.16], [0.34, 0.78]], 0.046), gl, T(bt[0] - 0.1, bt[1] - 0.1, 0)); for (const sd of [-1, 1]) for (const x of [-1.3, -0.4, 0.5, 1.4]) { const p = H.side(x, sd, 0.03, -0.01); bladeFin(k, p[0] + 0.2, p[1], p[2], 1.1, 0x2a2432, gl, sd); } k.g(oct(0.09), gl, T(st[0] + 0.1, st[1] + 0.3, 0, 0, 0, 0, 1, 1.8, 1)); }
  else { swanNeck(k, bt[0] - 0.1, bt[1] - 0.05, 1.45, 0xf4f0e8, GOLD); for (const sd of [-1, 1]) { const p = H.side(1.2, sd, 0.04, -0.02); k.s(leaf(1.15, 0.34, 0.05, (u, v, i, j) => (j > 5 ? 0xe8e0d0 : 0xf8f4ec), { nv: 8, nu: 4 }), null, T(p[0], p[1] - 0.03, p[2] + sd * 0.02, 0, sd > 0 ? 0 : PI, HP + 0.06)); } featherFan(k, st[0] + 0.04, st[1] - 0.03, 0, 9, 0.6, 0xf4f0e8, 0xe0d8c8, 1.5, 0.15); }
  riverOars(k, C, H, { shaft: dark ? 0x3a3242 : 0xe8e0cc, bcol: dark ? 0x2a2432 : 0xd8c8a0, lockCol: tr });
  k.s(rbox(0.05, 0.5, 0.05, 0.01, 1), dark ? 0x2a2432 : 0xe8e0cc, T(-1.95, H.topAt(-1.95) + 0.1, 0)); lampPost(k, -1.85, H.topAt(-1.85), 0.3, 0.75, gl, dark ? 0x2a2432 : tr, -1, 'dome');
  heap(k, 1.62, RD, 0, [['chest', 0, -0.25, 1.5, 0.1, dark ? 0x2a2432 : 0xf0ead8], ['chest', 0.02, 0.22, 1.4, -0.1, dark ? 0x3a1a2a : 0xe0e8e0], ['bundle', 0.0, -0.02, 1.3, 0, dark ? 0x5a1a2a : c2, 0.18], ['jar', 0.3, 0.0, 1.3, 0, dark ? 0x3a3242 : 0xd8e8e0]], H);
  heap(k, -1.62, RD, 0, [['jar', 0, -0.42, 1.3, 0, dark ? 0x3a3242 : 0xd8e8e0], ['bundle', 0, 0.42, 1.2, 0.3, dark ? 0x5a1a2a : c2]], H);
}
function elvenRaft(k, C) {
  const L = C.L, dark = C.f === 'kaelneth', tr = dark ? 0x8a7a9a : L.trim, gl = L.glow, W = dark ? 0x241e2c : L.wood, c2 = L.cloth2;
  // two slim floats with a leaf-shaped deck laid across them
  for (const z of [-0.56, 0.56]) { const F = shape({ x0: -1.5, x1: 1.5, B: 0.36, draft: 0.16, free: 0.12, bowRise: 0.22, sternRise: 0.1, br: 2.5, pb: 1.8, ps: 2, ex: 2.2, th: 0.02 }); k.push(T(0, 0, z)); shell(k, F, hcol(F, { out: W, strake: 0, in: sh(W, 0.8), rim: tr, bottom: sh(W, 0.7) }), { m: 8, nv: 24 }); paint(k, F, 0.02, 0.05, dark ? gl : tr, 0.05, 0.95, dark ? 'glow' : 'metal', 16); k.pop(); }
  for (let i = 0; i < 26; i++) { const x = -1.35 + i * 0.108, t = x / 1.45, w = 1.62 * Math.pow(Math.max(0, 1 - t * t), 0.45) * (x > 0 ? 1 : 0.92 + 0.08 * (1 + t)); if (w < 0.2) continue; k.s(box(0.1, 0.04, w), sh(dark ? 0x3a3242 : 0xf0e8d4, 0.9 + 0.15 * rnd(i)), T(x, FD - 0.02, 0)); }
  k.add('metal', torus(0.86, 0.02, 5, 40), tr, T(0, FD - 0.02, 0, HP, 0, 0, 1.7, 0.94, 1)); k.o(torus(0.86, 0.016, 4, 40), WHITE, T(0, FD - 0.05, 0, HP, 0, 0, 1.72, 0.95, 1));
  // an arch at the bow with a hanging lamp
  if (dark) { for (const sz of [-1, 1]) k.m(slab([[0, 0], [0.08, 0.5], [0.0, 1.0], [-0.04, 0.5]], 0.04), 0x2a2432, T(1.15, FD, sz * 0.42)); k.m(box(0.06, 0.06, 0.92), 0x2a2432, T(1.15, FD + 0.98, 0)); k.g(oct(0.08), gl, T(1.15, FD + 0.78, 0, 0, 0, 0, 1, 1.6, 1)); for (const sd of [-1, 1]) for (const x of [-0.8, 0.4]) bladeFin(k, x, 0.08, sd * 0.76, 1, 0x2a2432, gl, sd); }
  else { k.m(torus(0.48, 0.03, 6, 20, PI), tr, T(1.15, FD, 0, 0, HP, 0)); for (const sz of [-1, 1]) k.s(leaf(0.3, 0.12, 0.2, c2, { nv: 4 }), null, T(1.15, FD + 0.2, sz * 0.44, 0, 0, sz * 0.4)); lantern(k, 1.15, FD + 0.44, 0, gl, tr, 1.1, 'dome'); swanNeck(k, 1.42, 0.12, 0.6, 0xf4f0e8, GOLD); }
  for (const z of [-0.56, 0.56]) featherFan(k, -1.45, 0.14, z, 3, 0.26, dark ? 0x2a2432 : 0xf4f0e8, dark ? 0x3a3242 : 0xe0d8c8, 0.8, 0.2, dark ? 'metal' : 'solid');
  flagstaff(k, -1.25, FD, -0.45, 1.0, { h: 0.22, w: 0.6, kind: 'point', col: dark ? 0x2a2432 : 0xe8e0cc, knob: tr, knobGeo: oct(0.045) });
  heap(k, 0.75, FD, 0, [['chest', 0, -0.3, 1.4, 0.1, dark ? 0x2a2432 : 0xf0ead8], ['bundle', 0.05, 0.28, 1.3, 0.2, dark ? 0x5a1a2a : c2], ['jar', 0.3, -0.02, 1.3, 0, dark ? 0x3a3242 : 0xd8e8e0]]);
  heap(k, -1.25, FD, 0, [['jar', 0, 0.0, 1.2, 0, dark ? 0x3a3242 : 0xd8e8e0], ['bundle', 0.12, -0.25, 1.1, 0.5, dark ? 0x5a1a2a : c2]]);
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: dark ? 0x3a3242 : 0xe8e0cc, shoe: tr });
}

// =====================================================================================================
// THE HOLDS
// =====================================================================================================
function dwarfHull(k, C, shp, o = {}) {
  const L = C.L, M = L.metal, tr = L.trim;
  const H = baseHull(k, C, shp, { bag: 'metal', col: { out: M, strake: 0, fn: (s, dt, y, j) => sh(M, Math.floor(s * 14) & 1 ? 1.12 : 0.95), in: sh(L.wood, 0.8), rim: tr, bottom: sh(M, 0.6) }, paint: [[0.0, 0.04, tr, 0.02, 0.98, 'metal'], [0.07, 0.15, L.cloth, 0.08, 0.92]], owner: [0.17, 0.22, 0.14, 0.86], gun: tr, gunO: { bag: 'metal', s0: 0.02, s1: 0.98 }, gunR: 0.028, floor: sh(L.wood, 1.05), ...o });
  rivetRow(k, H, 0.05, tr, 0.06, 0.94, o.riv ?? 18); rivetRow(k, H, 0.25, sh(M, 1.5), 0.1, 0.9, o.riv ?? 18);
  return H;
}
function runeStone(k, x, y, z, s, glow, ry = 0) { k.push(T(x, y, z, 0, ry, 0, s)); k.s(rbox(0.1, 0.36, 0.28, 0.03, 1), 0x8a8a84, T(0, 0.18, 0)); for (const [a, b] of [[[0.06, 0.08, -0.06], [0.06, 0.28, -0.06]], [[0.06, 0.28, -0.06], [0.06, 0.2, 0.06]], [[0.06, 0.2, 0.06], [0.06, 0.08, 0.06]], [[0.06, 0.18, -0.06], [0.06, 0.12, 0.06]]]) k.rod('glow', glow, a, b, 0.012, 4); k.pop(); }
function dwarfGondola(k, C) {
  const L = C.L, tr = L.trim, M = L.metal;
  const H = dwarfHull(k, C, { ...G_SHAPE, B: 0.96, bowRise: 0.2, sternRise: 0.12, br: 2, ex: 3.2, tr: 0.32, ps: 3, qs: 0.4, rocker: 0.02, dp: 5 }, { fx0: -1.55, fx1: 1.3 });
  const bt = H.at(0.995, 0.5);
  k.m(cone(0.09, 0.32, 6), tr, T(bt[0] + 0.1, 0.05, 0, 0, 0, -HP)); // a gilt ram
  runeStone(k, bt[0] - 0.12, bt[1] - 0.02, 0, 1.0, L.glow, 0);
  k.m(rbox(0.08, 0.5, 0.08, 0.02, 1), M, T(bt[0] - 0.24, bt[1] + 0.05, 0)); k.m(cyl(0.07, 0.07, 0.06, 8), tr, T(bt[0] - 0.24, bt[1] + 0.32, 0));
  lampPost(k, -1.5, H.topAt(-1.5), -0.25, 0.72, L.glow, M, -1);
  // a little stove astern to keep the boatman's beard dry
  k.m(cyl(0.11, 0.12, 0.22, 8), 0x3a3434, T(-1.52, GD + 0.11, 0.18)); k.g(box(0.02, 0.06, 0.08), L.glow, T(-1.41, GD + 0.1, 0.18)); k.m(cyl(0.035, 0.035, 0.42, 6), M, T(-1.56, GD + 0.42, 0.2)); k.m(cyl(0.05, 0.04, 0.04, 6), tr, T(-1.56, GD + 0.64, 0.2));
  gondolierOar(k, C, H, { rest: M, restBag: 'metal', oar: { shaft: 0x6a5030, bcol: M } });
  heap(k, 0.92, GD, 0, [['ore', 0, -0.12, 1.4, 0, 0xc8a040], ['cask', 0.3, 0.12, 1.25, 0.1], ['ingot', -0.05, 0.22, 1.2, 0.2]], H);
  heap(k, -1.25, GD, 0, [['cask', 0, -0.22, 1.1, 0.0]], H);
  for (const sd of [-1, 1]) { const p = H.side(-0.3, sd, 0.1, -0.02); roundShield(k, p[0], p[1], p[2], sd > 0 ? 0 : PI, 0.12, L.cloth2, tr, tr); }
  flagstaff(k, 1.2, GD, -0.25, 0.8, { h: 0.2, w: 0.45, kind: 'point', col: M, knob: tr });
}
function dwarfRiver(k, C) {
  const L = C.L, tr = L.trim, M = L.metal; C.wheel = true;
  const H = dwarfHull(k, C, { ...R_SHAPE, x0: -1.72, tr: 0.75, ps: 4, qs: 0.3, ex: 4, bowRise: 0.18, sternRise: 0.05, free: 0.48, dp: 6 }, { fx0: -1.6, fx1: 1.8, riv: 22 });
  // the boiler house with its stack
  cabin(k, 0.46, 1.14, 1.0, 0.66, RD, { wallBag: 'metal', wall: sh(M, 1.2), trim: tr, roof: 'flat', roofCol: sh(M, 0.9), roofBag: 'metal', winGlow: true, winCol: L.glow, nwin: 1, doorCol: 0x3a2a20 });
  for (const sz of [-1, 1]) for (let i = 0; i < 5; i++) k.m(box(0.1, 0.1, 0.1), sh(M, 0.9), T(0.5 + i * 0.16, RD + 0.73, sz * 0.47));
  k.m(cyl(0.11, 0.13, 1.5, 12), 0x2e2e34, T(0.8, RD + 1.4, 0)); for (const y of [0.9, 1.6, 2.1]) k.m(cyl(0.135, 0.135, 0.06, 12), tr, T(0.8, RD + y, 0)); k.m(cyl(0.17, 0.12, 0.12, 12), 0x2e2e34, T(0.8, RD + 2.2, 0));
  k.g(box(0.02, 0.18, 0.24), L.glow, T(1.15, RD + 0.2, 0)); for (const d of [-0.08, 0, 0.08]) k.m(box(0.024, 0.2, 0.02), 0x2a2a2e, T(1.152, RD + 0.2, d));
  // the stern wheel and its frame
  const wx = -1.98, wy = 0.34; paddleWheel(k, C, wx, wy, 0.46, 1.0, { rim: sh(M, 1.2), pad: L.wood, hub: tr, n: 8 });
  for (const sz of [-1, 1]) { k.m(rbox(0.7, 0.08, 0.08, 0.02, 1), sh(M, 1.1), T(-1.72, wy + 0.08, sz * 0.62, 0, 0, -0.1)); k.m(cyl(0.07, 0.07, 0.1, 8), tr, T(wx, wy, sz * 0.62, HP)); k.m(rbox(0.06, 0.5, 0.06, 0.02, 1), sh(M, 1.1), T(-1.68, wy + 0.25, sz * 0.62)); }
  k.m(cyl(0.035, 0.035, 2.2, 6), COPPER, T(-0.6, RD + 0.28, 0.55, 0, 0, HP)); k.m(cyl(0.035, 0.035, 2.2, 6), COPPER, T(-0.6, RD + 0.28, -0.55, 0, 0, HP));
  const bt = H.at(0.995, 0.5); k.m(cone(0.12, 0.4, 6), tr, T(bt[0] + 0.14, 0.08, 0, 0, 0, -HP)); runeStone(k, bt[0] - 0.14, bt[1] - 0.04, 0, 1.3, L.glow);
  for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) { const p = H.side(-1.3 + i * 0.5, sd, 0.12, -0.02); roundShield(k, p[0], p[1], p[2], sd > 0 ? 0 : PI, 0.13, i & 1 ? L.cloth : L.cloth2, tr, tr); }
  flagstaff(k, 1.35, RD, 0.45, 1.2, { h: 0.26, w: 0.62, kind: 'point', col: M, knob: tr });
  heap(k, 1.6, RD, 0, [['ore', 0, -0.3, 1.5, 0, 0x5a5a66], ['ore', 0.05, 0.3, 1.4, 0, 0xc8a040], ['cask', 0.28, 0.0, 1.4, 0.1], ['ingot', -0.05, 0.02, 1.4, 0.3]], H);
  heap(k, -1.4, RD, 0, [['cask', 0, -0.5, 1.2, 0], ['cask', 0, 0.5, 1.2, 0], ['ingot', 0.05, 0.52, 1.0, 0, GOLD, 0.2]], H);
  lampPost(k, -1.6, RD, -0.62, 0.8, L.glow, M, 1);
}
function dwarfRaft(k, C) {
  const L = C.L, tr = L.trim, M = L.metal;
  // six great casks under a riveted deck
  for (const z of [-0.5, 0.5]) for (const x of [-0.98, 0, 0.98]) { k.push(T(x, 0.08, z, 0, 0, HP)); k.s(rev([[0, -0.45], [0.2, -0.45], [0.24, -0.3], [0.26, 0], [0.24, 0.3], [0.2, 0.45], [0, 0.45]], 12, [sh(L.wood, 0.7), L.wood, sh(L.wood, 1.15), L.wood, L.wood, sh(L.wood, 0.7)]), null); for (const y of [-0.35, -0.1, 0.1, 0.35]) k.m(cyl(0.25, 0.25, 0.04, 12, true), M, T(0, y, 0, 0, 0, 0, Math.abs(y) > 0.2 ? 0.94 : 1.03, 1, Math.abs(y) > 0.2 ? 0.94 : 1.03)); k.pop(); }
  for (let i = 0; i < 13; i++) k.s(box(0.22, 0.05, 1.56), sh(L.wood, 0.9 + rnd(i) * 0.2), T(-1.38 + i * 0.23, FD - 0.025, 0));
  for (const z of [-0.8, 0.8]) { k.m(box(2.96, 0.1, 0.05), M, T(0, FD - 0.03, z)); for (let i = 0; i < 12; i++) k.m(ball(0.016, 5, 3), tr, T(-1.4 + i * 0.255, FD - 0.03, z * 1.035)); }
  for (const x of [-1.48, 1.48]) k.m(box(0.05, 0.1, 1.64), M, T(x, FD - 0.03, 0));
  k.o(box(2.4, 0.04, 0.012), WHITE, T(0, FD - 0.01, 0.83)); k.o(box(2.4, 0.04, 0.012), WHITE, T(0, FD - 0.01, -0.83));
  // an anvil and a little crane at the bow
  k.m(rbox(0.16, 0.14, 0.12, 0.02, 1), 0x3a3a40, T(1.25, FD + 0.07, -0.5)); k.m(rbox(0.34, 0.07, 0.14, 0.02, 1), 0x4a4a52, T(1.27, FD + 0.17, -0.5)); k.m(cone(0.06, 0.16, 6), 0x4a4a52, T(1.48, FD + 0.17, -0.5, 0, 0, -HP));
  k.m(cyl(0.04, 0.05, 1.3, 8), M, T(1.35, FD + 0.65, 0.6)); k.m(cyl(0.03, 0.03, 0.8, 6), M, T(1.1, FD + 1.25, 0.6, 0, 0, 1.2)); k.rod('solid', ROPE, [0.74, FD + 1.1, 0.6], [0.74, FD + 0.6, 0.6], 0.008, 3); k.m(torus(0.04, 0.01, 4, 8), tr, T(0.74, FD + 0.56, 0.6));
  runeStone(k, -1.38, FD, -0.62, 0.9, L.glow, 0);
  flagstaff(k, -1.4, FD, 0.65, 1.0, { h: 0.24, w: 0.6, kind: 'point', col: M, knob: tr });
  lampPost(k, 1.4, FD, 0.0, 0.7, L.glow, M, 1);
  heap(k, 0.78, FD, 0, [['ore', 0, -0.25, 1.5, 0, 0x5a5a66], ['cask', 0.2, 0.25, 1.4, 0.2], ['ingot', 0.0, 0.0, 1.3, 0.2]]);
  heap(k, -1.25, FD, 0, [['cask', 0, -0.3, 1.2, 0], ['ore', 0.15, 0.0, 1.1, 0, 0xc8a040]]);
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: 0x6a5030, shoe: M });
}

// =====================================================================================================
// THE EASTERN REALMS
// =====================================================================================================
function eLook(L) {
  const f = L.faction;
  if (f === 'shogunate') return { hull: 0x1c1616, top: 0xa81a1a, rim: 0xa81a1a, sail: (u, v) => { const dx = (u - 0.45) * 1.3, dy = v - 0.55; return dx * dx + dy * dy < 0.05 ? 0xb81a1a : 0xece4d4; }, hoodC: 0xb8a070, lan: 0xfff0d0 };
  if (f === 'thousandgods') return { hull: 0x2a7a7a, top: 0xe87a1a, rim: GOLD, sail: (u, v, i, j) => { const dx = u - 0.45, dy = v - 0.5, r = dx * dx + dy * dy; return r < 0.02 ? L.cloth2 : r < 0.05 ? GOLD : j & 1 ? 0xe87a1a : 0xf08a2a; }, hoodC: L.cloth2, lan: 0xffb040 };
  return { hull: 0x6a2a1e, top: 0xb8201a, rim: GOLD, sail: (u, v, i, j) => (j & 1 ? 0xa8402a : 0xb85030), hoodC: 0xa88a50, lan: 0xff5030 };
}
function eastHull(k, C, shp, E, o = {}) {
  const L = C.L, f = C.f;
  return baseHull(k, C, shp, { col: { out: E.hull, strake: 0.09, in: sh(L.wood, 0.85), rim: E.rim, bottom: f === 'shogunate' ? 0x101010 : TAR }, paint: [[0, 0.07, E.top], [0.07, 0.09, f === 'tianlong' ? L.cloth2 : GOLD, 0.04, 0.96, 'metal']], owner: [0.13, 0.18, 0.15, 0.85], gun: f === 'shogunate' ? 0x1a1414 : E.rim, gunO: { bag: f === 'shogunate' ? 'solid' : 'metal' }, floor: sh(L.wood, 1.2), ...o });
}
function oculus(k, H, x, dt, s = 1) { for (const sd of [-1, 1]) { const p = H.side(x, sd, dt, -0.012); k.s(cyl(0.07 * s, 0.07 * s, 0.01, 14), 0xf0ece0, TA(p, [0, 0, sd])); const q = H.side(x + 0.01, sd, dt, -0.02); k.s(cyl(0.035 * s, 0.035 * s, 0.012, 10), 0x101010, TA(q, [0, 0, sd])); } }
function eastGondola(k, C) {
  const L = C.L, f = C.f, E = eLook(L);
  const H = eastHull(k, C, { ...G_SHAPE, B: 0.92, bowRise: 0.16, br: 2, sternRise: 0.3, sr: 2, ex: 3.0, tr: 0.45, ps: 2.6, qs: 0.45, rocker: 0.04, dp: 4 }, E, { fx0: -1.5, fx1: 1.3 });
  const bt = H.at(0.995, 0.5);
  if (f === 'thousandgods') { lotus(k, bt[0] - 0.06, bt[1] - 0.02, 0, 1.3, 0xe86a8a, 0xf8d0d8, 8); parasol(k, 0.95, GD, 0, 1.15, 0.42, L.cloth2, 0xe87a1a); garland(k, [H.side(-0.9, 1, 0, -0.02), [-0.1, H.topAt(-0.1) - 0.08, 0.47], H.side(0.6, 1, 0, -0.02)], 0xf09a20); garland(k, [H.side(-0.9, -1, 0, -0.02), [-0.1, H.topAt(-0.1) - 0.08, -0.47], H.side(0.6, -1, 0, -0.02)], 0xf09a20); }
  else hood(k, 0.66, 1.24, H.topAt(0.9) - 0.02, 0.84, 0.44, (u, v, i, j) => sh(E.hoodC, (i + j) & 1 ? 0.85 : 1), { ribs: 3, ribCol: 0x5a4026 });
  if (f === 'tianlong') { dragonHead(k, bt[0] + 0.06, bt[1] + 0.1, 0, 0.9, 0x2a8a6a, { belly: GOLD, mane: 0xb8201a }); k.s(sweep([[H.x0 + 0.05, H.top(0) - 0.05, 0], [H.x0 - 0.15, H.top(0) + 0.1, 0], [H.x0 - 0.05, H.top(0) + 0.3, 0], [H.x0 - 0.18, H.top(0) + 0.38, 0]], (v) => 0.05 - v * 0.04, 6, 12, 0x2a8a6a), null); paperLantern(k, 1.24, H.topAt(0.9) + 0.38, 0, E.lan, 1); paperLantern(k, -1.45, H.topAt(-1.45) + 0.55, -0.2, E.lan, 0.9); k.rod('solid', 0x2a1a14, [-1.45, H.topAt(-1.45), -0.2], [-1.45, H.topAt(-1.45) + 0.46, -0.2], 0.012, 4); }
  if (f === 'shogunate') { torii(k, 1.48, H.topAt(1.48) - 0.04, 0, 0.55); nobori(k, -1.5, H.topAt(-1.5) - 0.05, -0.22, 1.25, 0xf0ece0); paperLantern(k, 1.0, H.topAt(1.0) + 0.5, 0, E.lan, 0.8); }
  oculus(k, H, 1.45, 0.11, 0.8);
  yuloh(k, C, H, { oar: { shaft: 0x6a4a2a } });
  heap(k, 0.95, GD, 0, [['basket', 0, -0.12, 1.3], ['jar', 0.28, 0.12, 1.2, 0, f === 'thousandgods' ? 0xb84a2a : 0x3a4a3a], ['bale', -0.05, 0.18, 1.0, 0.2, 0xc8b070]], H);
  heap(k, -1.42, GD + 0.02, 0, [['basket', 0, 0.18, 0.9]], H);
  if (f !== 'shogunate') flagstaff(k, -1.48, H.topAt(-1.48) - 0.05, 0.22, 0.75, { h: 0.18, w: 0.5, kind: 'point', col: 0x2a1a14, knob: GOLD });
}
function eastRiver(k, C) {
  const L = C.L, f = C.f, E = eLook(L);
  const H = eastHull(k, C, { ...R_SHAPE, tb: 0.28, pb: 3, qb: 0.4, tr: 0.62, ps: 3.5, qs: 0.35, sternRise: 0.52, sr: 2, bowRise: 0.26, br: 2, ex: 3.4, dp: 5 }, E, { fx0: -1.9, fx1: 1.85 });
  for (let x = -1.8; x <= 1.9; x += 0.45) for (const sd of [-1, 1]) { const p = H.side(x, sd, 0.02, -0.02); k.s(box(0.04, 0.1, 0.03), sh(E.hull, 0.7), T(p[0], p[1] - 0.04, p[2])); }
  // the deckhouse with a swept roof, or a shrine
  if (f === 'thousandgods') { cabin(k, 0.48, 1.12, 0.92, 0.6, RD, { wall: 0xe8d8b8, trim: GOLD, roof: 'none', winGlow: true, winCol: E.lan, nwin: 1 }); for (let q = 0; q < 4; q++) k.m(rbox(0.66 - q * 0.12, 0.1, 0.96 - q * 0.18, 0.02, 1), q & 1 ? GOLD : L.cloth2, T(0.8, RD + 0.65 + q * 0.1, 0)); k.m(rev([[0.12, 0], [0.13, 0.08], [0.08, 0.18], [0.03, 0.26], [0.012, 0.36], [0, 0.4]], 10, GOLD), null, T(0.8, RD + 1.05, 0)); idol(k, 0.4, RD + 0.62 + 0.0, 0.0, 1.2, GOLD, 0); }
  else cabin(k, 0.48, 1.12, 0.94, 0.58, RD, { wall: f === 'shogunate' ? 0xe8e0cc : 0x8a3a24, trim: f === 'shogunate' ? 0x1a1414 : GOLD, roof: 'swept', rh: 0.28, roofCol: f === 'shogunate' ? 0x2a2a2e : 0x2a6a5a, tip: GOLD, winGlow: true, winCol: E.lan, nwin: 2, winGeo: box(0.16, 0.14, 0.012) });
  // the mast and a battened sail
  const mx = 1.3; k.rod('solid', 0x5a3a24, [mx, RD, 0], [mx, 3.2, 0], 0.04, 8);
  const sc = E.sail, P = faSail(k, [mx + 0.1, 1.45, 0], [-0.45, 1.5, 0], [-0.5, 2.55, 0], [mx - 0.05, 3.15, 0], (u, v, i, j) => sc(u, v, i, j), { owner: [0.03, 0.1], bil: 0.06, nv: 10 });
  for (let b = 0; b <= 6; b++) { const v = b / 6, a = [0, 0, 0], c = [0, 0, 0]; P(0, v, a, 0.02); P(1, v, c, 0.02); k.rod('solid', 0x3a2a1a, a, c, 0.012, 4); }
  k.rod('solid', 0x3a2a1a, [mx, 3.0, 0], [-0.45, 1.52, 0], 0.006, 3);
  oculus(k, H, 1.82, 0.16, 1.3);
  if (f === 'tianlong') { const bt = H.at(0.995, 0.5); dragonHead(k, bt[0] + 0.1, bt[1] + 0.18, 0, 1.4, 0x2a8a6a, { belly: GOLD, mane: 0xb8201a }); for (const x of [-1.4, -0.3, 1.9]) paperLantern(k, x, H.topAt(x) + 0.55, x > 0 ? 0 : 0.6, E.lan, 1.1); k.rod('solid', 0x2a1a14, [-1.4, H.topAt(-1.4), 0.6], [-1.4, H.topAt(-1.4) + 0.62, 0.6], 0.012, 4); k.rod('solid', 0x2a1a14, [-0.3, H.topAt(-0.3), 0.6], [-0.3, H.topAt(-0.3) + 0.62, 0.6], 0.012, 4); k.s(sweep([[H.x0 + 0.1, H.top(0), 0], [H.x0 - 0.15, H.top(0) + 0.2, 0], [H.x0 - 0.02, H.top(0) + 0.45, 0], [H.x0 - 0.2, H.top(0) + 0.55, 0]], (v) => 0.07 - v * 0.05, 6, 12, 0x2a8a6a), null); }
  if (f === 'shogunate') { torii(k, 1.98, H.topAt(1.98) - 0.06, 0, 0.8); for (const sd of [-1, 1]) nobori(k, -1.85, H.topAt(-1.85) - 0.05, sd * 0.5, 1.5, 0xf0ece0); paperLantern(k, 0.4, RD + 1.5, 0, E.lan, 0.9); }
  if (f === 'thousandgods') { const bt = H.at(0.995, 0.5); lotus(k, bt[0] - 0.08, bt[1], 0, 1.8, 0xe86a8a, 0xf8d0d8, 10); for (const sd of [-1, 1]) garland(k, [H.side(-1.7, sd, 0, -0.02), [-0.6, H.topAt(-0.6) - 0.1, sd * 0.75], H.side(0.45, sd, 0, -0.02)], 0xf09a20, 16, 0.035); parasol(k, -1.85, H.topAt(-1.85), 0.45, 1.2, 0.36, L.cloth2, 0xe87a1a); }
  yuloh(k, C, H, { oar: { shaft: 0x6a4a2a } }); riverOars(k, C, H, { xs: [-0.5], shaft: 0x6a4a2a });
  heap(k, 1.6, RD, 0, [['bale', 0, -0.32, 1.4, 0.1, 0xc8b070], ['jar', 0.05, 0.32, 1.5, 0, 0x4a3a2a], ['basket', 0.28, 0.0, 1.4], ['bale', 0.0, -0.3, 1.2, -0.2, 0xb8a060, 0.24], ['jar', -0.1, 0.05, 1.3, 0, 0x6a4a3a]], H);
  heap(k, -1.72, RD, 0, [['jar', 0, -0.5, 1.3, 0, 0x4a3a2a], ['basket', 0.02, 0.5, 1.3]], H);
  if (f !== 'shogunate') flagstaff(k, -1.95, H.topAt(-1.95), -0.45, 1.0, { h: 0.24, w: 0.6, kind: 'point', col: 0x2a1a14, knob: GOLD });
}
function eastRaft(k, C) {
  const L = C.L, f = C.f, E = eLook(L), BAM = 0xa8a050;
  for (let i = 0; i < 11; i++) { const z = -0.75 + i * 0.15, r = 0.075; k.s(sweep([[-1.5, 0.08, z], [0.6, 0.08, z], [1.25, 0.12, z], [1.5, 0.3, z * 0.9]], r, 7, 16, (u, v, ii, j) => (j % 3 === 0 ? sh(BAM, 0.7) : sh(BAM, 0.95 + rnd(i) * 0.15))), null); k.s(cyl(r * 0.8, r * 0.8, 0.01, 7), 0xd8d0a0, T(-1.505, 0.08, z, 0, 0, HP)); }
  for (const x of [-1.25, -0.55, 0.15, 0.85]) k.s(cyl(0.05, 0.05, 1.7, 6), sh(BAM, 0.8), T(x, 0.19, 0, HP)); 
  for (let i = 0; i < 9; i++) k.s(box(2.7, 0.03, 0.15), sh(0xc8b878, 0.9 + rnd(i * 3) * 0.15), T(-0.2, FD - 0.015, -0.68 + i * 0.17));
  k.o(box(2.6, 0.035, 0.012), WHITE, T(-0.2, FD - 0.04, 0.78)); k.o(box(2.6, 0.035, 0.012), WHITE, T(-0.2, FD - 0.04, -0.78));
  // a woven hood over the bow stores
  if (f === 'thousandgods') { parasol(k, 0.95, FD, 0, 1.25, 0.5, L.cloth2, 0xe87a1a); idol(k, 1.3, FD, 0.5, 1.2, GOLD, 0); garland(k, [[-1.4, FD + 0.06, 0.78], [-0.2, FD + 0.02, 0.8], [1.0, FD + 0.06, 0.78]], 0xf09a20, 14, 0.035); }
  else { hood(k, 0.65, 1.3, FD, 1.3, 0.6, (u, v, i, j) => sh(E.hoodC, (i + j) & 1 ? 0.82 : 1), { ribs: 3, ribCol: 0x5a4026 }); }
  if (f === 'tianlong') { for (const z of [-0.6, 0.6]) { k.rod('solid', 0x2a1a14, [-1.4, FD, z], [-1.4, FD + 0.9, z], 0.014, 4); paperLantern(k, -1.4, FD + 1.0, z, E.lan, 1); } dragonHead(k, 1.52, 0.42, 0, 0.7, 0x2a8a6a, { belly: GOLD, mane: 0xb8201a }); }
  if (f === 'shogunate') { torii(k, 1.38, FD, 0, 0.75); nobori(k, -1.42, FD, -0.6, 1.4, 0xf0ece0); paperLantern(k, -1.42, FD + 1.5, 0.6, E.lan, 0.8); k.rod('solid', 0x1a1414, [-1.42, FD, 0.6], [-1.42, FD + 1.4, 0.6], 0.014, 4); }
  if (f !== 'shogunate') flagstaff(k, -1.42, FD, -0.6, 1.0, { h: 0.22, w: 0.55, kind: 'point', col: 0x2a1a14, knob: GOLD });
  heap(k, 0.9, FD, 0, [['basket', 0, -0.3, 1.4], ['jar', 0.25, 0.25, 1.4, 0, 0x4a3a2a], ['bale', 0.0, 0.2, 1.3, 0.2, 0xc8b070], ['jar', 0.3, -0.1, 1.2, 0, 0x6a4a3a]]);
  heap(k, -1.25, FD, 0, [['basket', 0, -0.25, 1.2], ['jar', 0.12, -0.02, 1.1, 0, 0x4a3a2a]]);
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: BAM });
}

// =====================================================================================================
// THE DESERT REALMS
// =====================================================================================================
/** a row of painted dogteeth hanging from dt below the sheer */
function teethRow(k, H, dt, h, col, n = 22, s0 = 0.1, s1 = 0.9, bag = 'solid') { const w = ((s1 - s0) * (H.x1 - H.x0)) / n; for (const sd of [-1, 1]) for (let i = 0; i < n; i++) { const s = s0 + ((s1 - s0) * (i + 0.5)) / n, p = H.at(s, H.aAt(s, dt, sd), -0.011); k.add(bag, slab([[-w / 2, 0], [w / 2, 0], [0, -h]], 0.006), col, T(p[0], p[1], p[2], 0, sd > 0 ? 0 : PI, 0)); } }
function brassLamp(k, x, y, z, glow, s = 1) { k.push(T(x, y, z, 0, 0, 0, s)); k.m(cone(0.07, 0.12, 8), BRASS, T(0, 0.02, 0)); k.g(ball(0.055, 8, 6), glow, T(0, -0.07, 0)); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.m(box(0.008, 0.12, 0.008), BRASS, T(Math.cos(a) * 0.06, -0.07, Math.sin(a) * 0.06)); } k.m(cone(0.04, 0.05, 8), BRASS, T(0, -0.14, 0, PI)); k.m(cone(0.012, 0.08, 4), BRASS, T(0, 0.12, 0)); k.pop(); }
function hangLamp(k, x, y0, z, h, glow) { k.rod('metal', BRASS, [x, y0, z], [x, y0 + h, z], 0.014, 5); k.rod('metal', BRASS, [x, y0 + h, z], [x + 0.16, y0 + h, z], 0.01, 4); k.rod('metal', BRASS, [x + 0.16, y0 + h, z], [x + 0.16, y0 + h - 0.08, z], 0.005, 3); brassLamp(k, x + 0.16, y0 + h - 0.16, z, glow, 0.9); }
function umbel(k, p, s, dir = 1, col = 0x8a9a3a, band = GOLD) { k.push(T(p[0], p[1], p[2], 0, 0, -dir * 0.5, s)); k.m(cyl(0.05, 0.05, 0.05, 10), band, T(0, 0, 0)); k.s(rev([[0.04, 0], [0.07, 0.05], [0.14, 0.14], [0.17, 0.2], [0.0, 0.18]], 12, (u, v, i) => (i & 1 ? col : sh(col, 1.25))), null, T(0, 0.02, 0)); k.pop(); }
function wedjat(k, H, x, dt, glow, s = 1) { for (const sd of [-1, 1]) { const p = H.side(x, sd, dt, -0.014); k.push(TA(p, [0, 0, sd]).multiply(T(0, 0, 0, 0, 0, 0, s))); k.g(cyl(0.07, 0.07, 0.008, 12), glow, T(0, 0, 0, 0, 0, 0, 1.6, 1, 0.8)); k.s(cyl(0.032, 0.032, 0.012, 10), 0x101418, T(0, 0.002, 0)); k.s(box(0.26, 0.01, 0.02), 0x101418, T(0, 0.004, -0.09 * sd)); k.s(box(0.02, 0.01, 0.12), 0x101418, T(0.02, 0.004, 0.1 * sd)); k.pop(); } }
function papyrusHull(k, C, shp, o = {}) {
  const L = C.L, P = 0xb8b070, tie = 0x6a5030;
  const H = baseHull(k, C, shp, { col: { out: P, strake: 0, fn: (s, dt, y, j, i) => ((Math.floor(s * 38) % 6 === 0) ? tie : sh(P, i & 1 ? 0.9 : 1.06)), in: sh(P, 0.85), rim: sh(P, 0.8), bottom: sh(P, 0.55), wl: -0.05 }, paint: [[0.0, 0.05, GOLD, 0.15, 0.85, 'metal'], [0.05, 0.1, L.cloth2 === 0xd8ceb0 ? 0x2a6a9a : L.cloth2, 0.15, 0.85]], owner: [0.12, 0.17, 0.22, 0.78], gun: sh(P, 0.85), gunO: { s0: 0.0, s1: 1.0 }, gunR: 0.04, floor: 0xa89058, m: 18, ...o });
  return H;
}
function desertGondola(k, C) {
  const L = C.L, f = C.f;
  if (f === 'khemet') {
    const H = papyrusHull(k, C, { ...G_SHAPE, B: 0.86, bowRise: 0.55, sternRise: 0.6, br: 2, sr: 2, ex: 2.0, rocker: 0.16, pb: 1.8, ps: 1.8 }, { fx0: -1.35, fx1: 1.25 });
    const bt = H.at(1, 0.5), st = H.at(0, 0.5);
    umbel(k, [bt[0] + 0.02, bt[1] - 0.03, 0], 1.1, 1); k.s(sweep([[st[0] + 0.1, st[1] - 0.15, 0], [st[0] - 0.02, st[1], 0], [st[0] + 0.1, st[1] + 0.15, 0], [st[0] + 0.25, st[1] + 0.1, 0]], (v) => 0.06 - v * 0.03, 7, 12, 0xb8b070), null); umbel(k, [st[0] + 0.28, st[1] + 0.06, 0], 0.9, -1);
    wedjat(k, H, 1.25, 0.15, L.glow, 0.9);
    pole(k, C, [-1.2, GD + 0.9, 0.3], { col: 0x8a6a40, shoe: GOLD });
    for (const [x, z] of [[0.68, -0.3], [0.68, 0.3], [1.22, -0.22], [1.22, 0.22]]) k.rod('solid', 0x6a4a2a, [x, GD, z], [x, GD + 0.78, z], 0.015, 5);
    k.c(surf(4, 4, (u, v, out) => { out[0] = 0.62 + v * 0.66; out[1] = GD + 0.78 + Math.sin(PI * u) * 0.05; out[2] = -0.34 + u * 0.68; }, (u, v, i) => (i & 1 ? 0xe8dcc0 : 0x2a6a9a)));
    heap(k, 0.95, GD, 0, [['amphora', 0, -0.12, 1.3, 0, 0xb86a42], ['basket', 0.26, 0.1, 1.2, 0, 0xc8a050], ['jar', -0.05, 0.18, 1.1, 0, 0x2a6a9a]], H);
    heap(k, -1.45, GD + 0.05, 0, [['jar', 0, 0, 0.9, 0, 0xb86a42]], H);
    flagstaff(k, 1.15, GD, -0.25, 1.0, { h: 0.18, w: 0.4, kind: 'point', col: 0x6a4a2a, knob: GOLD });
    return;
  }
  const H = baseHull(k, C, { ...G_SHAPE, bowRise: 0.36, br: 1.6, sternRise: 0.22, ex: 2.6, tr: 0.25, ps: 2.6 }, { col: { out: 0xe8e0d0, strake: 0, in: sh(L.wood, 0.9), rim: GOLD }, paint: [[0, 0.06, L.cloth2], [0.06, 0.08, GOLD, 0.05, 0.95, 'metal'], [0.08, 0.17, 0xe8e0d0, 0.08, 0.92]], owner: [0.19, 0.23, 0.18, 0.82], gun: GOLD, gunO: { bag: 'metal' }, fx0: -1.5, fx1: 1.3, floor: 0xb89a62 });
  teethRow(k, H, 0.085, 0.07, L.cloth2, 22, 0.1, 0.9);
  // a latticed pavilion over the bow stores, lamps fore and aft
  for (const [x, z] of [[0.66, -0.3], [0.66, 0.3], [1.22, -0.24], [1.22, 0.24]]) k.rod('solid', 0x6a4a2a, [x, GD, z], [x, GD + 0.72, z], 0.016, 5);
  for (const sd of [-1, 1]) lattice(k, 0.94, GD + 0.36, sd * 0.28, 0.5, 0.34, sd > 0 ? 0 : PI, 0xc8a060, 0x3a2a1c, 5);
  k.s(rbox(0.66, 0.04, 0.7, 0.01, 1), 0xe8e0d0, T(0.94, GD + 0.74, 0)); k.m(hemi(0.22, 12, 5), L.cloth2, T(0.94, GD + 0.76, 0)); k.m(cone(0.025, 0.14, 6), GOLD, T(0.94, GD + 1.04, 0));
  hangLamp(k, -1.42, H.topAt(-1.42), 0, 0.62, L.glow); brassLamp(k, H.x1 + 0.02, H.top(1) + 0.15, 0, L.glow, 0.9); k.m(cone(0.03, 0.2, 6), GOLD, T(H.x1 + 0.01, H.top(1) + 0.02, 0));
  gondolierOar(k, C, H, { oar: { shaft: 0x8a6a40 } });
  heap(k, 0.95, GD, 0, [['carpet', 0, -0.14, 1.2, 0.0, 0x8a2a3a], ['jar', 0.3, 0.12, 1.2, 0, 0x3a7a8a], ['bale', -0.02, 0.18, 1.0, 0.1, 0xd8c08a]], H);
  heap(k, -1.5, GD + 0.04, 0, [['jar', 0, 0.02, 0.9, 0, 0x3a7a8a]], H);
}
function desertRiver(k, C) {
  const L = C.L, f = C.f;
  if (f === 'khemet') {
    const H = papyrusHull(k, C, { ...R_SHAPE, tr: 0, ps: 1.8, pb: 1.8, qs: 0.6, bowRise: 0.75, sternRise: 0.95, br: 2.2, sr: 2.2, ex: 2.4, rocker: 0.2, dp: 2.5 }, { fx0: -1.75, fx1: 1.75 });
    const bt = H.at(1, 0.5), st = H.at(0, 0.5);
    umbel(k, [bt[0] + 0.02, bt[1] - 0.03, 0], 1.5, 1);
    k.s(sweep([[st[0] + 0.15, st[1] - 0.25, 0], [st[0] - 0.02, st[1], 0], [st[0] + 0.15, st[1] + 0.22, 0], [st[0] + 0.38, st[1] + 0.12, 0]], (v) => 0.09 - v * 0.04, 7, 14, 0xb8b070), null); umbel(k, [st[0] + 0.42, st[1] + 0.06, 0], 1.2, -1);
    wedjat(k, H, 1.65, 0.2, L.glow, 1.3);
    // the naos: a shrine with a gilt cornice and a sun between horns
    cabin(k, 0.48, 1.12, 0.9, 0.62, RD, { wall: 0xe8dcc0, trim: 0x2a6a9a, roof: 'flat', roofCol: GOLD, roofBag: 'metal', win: false, doorCol: 0x2a6a9a });
    for (const sz of [-1, 1]) for (let i = 0; i < 6; i++) k.s(box(0.08, 0.5, 0.012), i & 1 ? 0x2a6a9a : 0xb83a2a, T(0.55 + i * 0.11, RD + 0.3, sz * 0.456));
    k.m(rbox(0.74, 0.08, 1.0, 0.02, 1), GOLD, T(0.8, RD + 0.7, 0, 0, 0, 0)); k.m(cyl(0.16, 0.16, 0.03, 16), GOLD, T(0.8, RD + 1.0, 0, HP, HP, 0)); k.g(cyl(0.1, 0.1, 0.034, 14), mix(L.glow, 0xffd070, 0.6), T(0.8, RD + 1.0, 0, HP, HP, 0)); for (const sz of [-1, 1]) k.m(sweep([[0.8, RD + 0.78, sz * 0.05], [0.8, RD + 0.9, sz * 0.22], [0.8, RD + 1.15, sz * 0.2]], (v) => 0.025 * (1 - v * 0.7), 5, 8, GOLD), null);
    const mx = 1.3; k.rod('solid', 0x6a4a2a, [mx, RD, 0], [mx, 3.0, 0], 0.04, 8); k.m(cyl(0.06, 0.05, 0.1, 8), GOLD, T(mx, 3.0, 0));
    sqSail(k, mx, 1.5, 2.85, 1.0, (u, v, i, j) => (v > 0.9 || u < 0.08 || u > 0.92 ? GOLD : j === 4 ? 0x2a6a9a : 0xf0e8d4), { owner: [0.15, 0.25], bil: 0.12, boom: true, taper: -0.4 });
    for (const sd of [-1, 1]) { const p = H.side(-1.55, sd, 0, -0.02); p[1] += 0.12; k.rod('solid', 0x6a4a2a, [p[0], RD, p[2] * 0.9], [p[0], p[1] + 0.05, p[2]], 0.025, 5); oar(k, C, p, sd, { e: [p[0] - 0.9, -0.12, p[2] + sd * 0.5], h: [p[0] + 0.35, p[1] + 0.35, p[2] - sd * 0.1], bl: 0.6, bw: 0.2, shaft: 0x6a4a2a, bcol: 0x2a6a9a, lock: false }); }
    heap(k, 1.55, RD, 0, [['amphora', 0, -0.25, 1.5, 0, 0xb86a42], ['amphora', 0.0, 0.25, 1.5, 0.5, 0xa85a3a], ['basket', 0.3, 0.0, 1.4, 0, 0xc8a050], ['jar', -0.05, 0.0, 1.3, 0, 0x2a6a9a]], H);
    heap(k, -1.82, RD, 0, [['jar', 0, 0.0, 1.2, 0, 0x2a6a9a]], H);
    return;
  }
  // a dhow: raked stem, a high poop, one great lateen sail
  const H = baseHull(k, C, { ...R_SHAPE, bowRise: 0.5, br: 1.5, sternRise: 0.45, sr: 2, ex: 2.8, tr: 0.5, ps: 3, pb: 2.2 }, { col: { out: 0xd8c8a0, strake: 0.08, in: sh(L.wood, 0.9), rim: GOLD }, paint: [[0, 0.08, L.cloth2], [0.08, 0.1, GOLD, 0.04, 0.96, 'metal'], [0.1, 0.2, 0xe8e0d0, 0.08, 0.92]], owner: [0.22, 0.28, 0.12, 0.85], gun: GOLD, gunO: { bag: 'metal' }, fx0: -1.9, fx1: 1.8, floor: 0xb89a62 });
  teethRow(k, H, 0.105, 0.08, L.cloth2, 26, 0.08, 0.92);
  cabin(k, 0.48, 1.12, 0.92, 0.6, RD, { wall: 0xe8e0d0, trim: GOLD, roof: 'dome', roofCol: L.cloth2, roofBag: 'metal', win: false, doorCol: 0x3a2a1c });
  for (const sd of [-1, 1]) lattice(k, 0.8, RD + 0.1, sd * 0.47, 0.48, 0.42, sd > 0 ? 0 : PI, 0xc8a060, 0x2a1c14, 5);
  const mx = 1.3; k.rod('solid', 0x6a4a2a, [mx, RD, 0], [mx + 0.12, 2.7, 0], 0.045, 8);
  k.rod('solid', 0x5a3a24, [2.2, 1.25, 0], [-0.75, 3.45, 0], 0.03, 6);
  faSail(k, [2.15, 1.3, 0], [-0.25, 1.55, 0], [-0.7, 3.4, 0], [2.15, 1.3, 0], (u, v, i, j) => (i === 2 || i === 6 ? L.cloth2 : 0xf0e8d8), { owner: [0.02, 0.08], bil: 0.16, nu: 10 });
  for (const sd of [-1, 1]) hangLamp(k, -1.92, H.topAt(-1.92), sd * 0.4, 0.75, L.glow);
  brassLamp(k, H.x1, H.top(1) + 0.14, 0, L.glow, 1.0);
  rudder(k, H, 0xb89a62, 0x6a4a2a, { knob: GOLD });
  riverOars(k, C, H, { shaft: 0x8a6a40 });
  heap(k, 1.55, RD, 0, [['carpet', 0, -0.28, 1.5, 0.1, 0x8a2a3a], ['carpet', 0, -0.28, 1.4, -0.05, 0x2a5a8a, 0.18], ['jar', 0.05, 0.25, 1.5, 0, 0x3a7a8a], ['bale', 0.3, 0.0, 1.4, 0.2, 0xd8c08a], ['chest', -0.05, 0.02, 1.2, 0.0, 0x6a3a22]], H);
  heap(k, -1.75, RD, 0, [['jar', 0, -0.5, 1.3, 0, 0x3a7a8a], ['carpet', 0, 0.48, 1.2, 0.0, 0x6a2a5a]], H);
}
function desertRaft(k, C) {
  const L = C.L, f = C.f;
  if (f === 'khemet') {
    for (let i = 0; i < 5; i++) { const z = -0.62 + i * 0.31, r = 0.17; reedBundle(k, [[-1.5, 0.32, z * 0.8], [-1.3, 0.12, z], [0, 0.09, z], [1.3, 0.12, z], [1.52, 0.36, z * 0.8]], (v) => r * (0.4 + 0.6 * Math.sin(PI * Math.min(1, v * 1.1 + 0.03))), 0xb8b070, 5, 0x6a5030, 28); }
    for (let i = 0; i < 12; i++) k.s(box(0.14, 0.03, 1.4), sh(0xa89058, 0.9 + rnd(i) * 0.2), T(-1.05 + i * 0.18, FD - 0.01, 0));
    for (const z of [-0.6, 0.6]) { umbel(k, [1.56, 0.4, z * 0.8], 0.8, 1); umbel(k, [-1.56, 0.37, z * 0.8], 0.8, -1); }
    k.o(box(2.0, 0.04, 0.012), WHITE, T(0, FD - 0.02, 0.72)); k.o(box(2.0, 0.04, 0.012), WHITE, T(0, FD - 0.02, -0.72));
    for (const [x, z] of [[-1.42, -0.7], [-1.42, -0.1], [-0.95, -0.7], [-0.95, -0.1]]) k.rod('solid', 0x6a4a2a, [x, FD, z], [x, FD + 1.0, z], 0.02, 5);
    k.c(surf(6, 4, (u, v, out) => { out[0] = -1.46 + v * 0.56; out[1] = FD + 1.0 + Math.sin(PI * u) * 0.06; out[2] = -0.74 + u * 0.68; }, (u, v, i) => (i & 1 ? 0xe8dcc0 : 0x2a6a9a)));
    k.s(rbox(0.12, 0.8, 0.12, 0.02, 1), 0xe8dcc0, T(1.3, FD + 0.4, 0.5)); k.m(cone(0.09, 0.16, 4), GOLD, T(1.3, FD + 0.88, 0.5, 0, PI / 4, 0)); k.g(box(0.01, 0.06, 0.1), L.glow, T(1.37, FD + 0.6, 0.5));
    flagstaff(k, 1.3, FD + 0.95, 0.5, 0.4, { h: 0.18, w: 0.45, kind: 'point', col: 0x6a4a2a, knob: GOLD });
    heap(k, 0.85, FD, 0, [['amphora', 0, -0.3, 1.4, 0, 0xb86a42], ['basket', 0.3, -0.05, 1.3, 0, 0xc8a050], ['jar', 0.0, 0.1, 1.3, 0, 0x2a6a9a]]);
    heap(k, -1.2, FD, 0, [['amphora', 0, -0.45, 1.2, 0, 0xa85a3a], ['jar', 0.0, -0.2, 1.1, 0, 0x2a6a9a]]);
    pole(k, C, [-1.0, FD + 0.9, 0.55], { col: 0x8a6a40, shoe: GOLD });
    return;
  }
  // palm logs, a carpet laid over them, brass lamps on posts
  for (let i = 0; i < 7; i++) { const z = -0.69 + i * 0.23; k.s(cyl(0.12, 0.12, 2.9, 9), (px, py, pz) => sh(0x8a6a40, Math.floor((py + 1.5) * 8) & 1 ? 0.85 : 1.0), T(0, 0.12, z, 0, 0, HP)); }
  for (const x of [-1.2, 0, 1.2]) k.s(cyl(0.05, 0.05, 1.72, 6), 0x6a4a2a, T(x, 0.22, 0, HP)); for (let i = 0; i < 20; i++) k.s(box(0.13, 0.03, 1.58), sh(0xb89a62, 0.9 + rnd(i) * 0.2), T(-1.33 + i * 0.14, FD - 0.015, 0));
  k.c(surf(10, 6, (u, v, out) => { out[0] = -0.75 + u * 1.3; out[1] = FD + 0.006; out[2] = -0.6 + v * 1.2; }, (u, v, i, j) => (i === 0 || i === 9 || j === 0 || j === 5 ? GOLD : (i + j) % 3 === 0 ? L.cloth2 : 0x8a2a3a)));
  k.o(box(2.6, 0.04, 0.012), WHITE, T(0, 0.16, 0.81)); k.o(box(2.6, 0.04, 0.012), WHITE, T(0, 0.16, -0.81));
  for (const [x, z] of [[1.35, -0.7], [1.35, 0.7], [-1.35, -0.7]]) hangLamp(k, x, FD, z, 0.8, L.glow);
  for (const sd of [-1, 1]) lattice(k, -1.15, FD, sd * 0.74, 0.55, 0.45, sd > 0 ? 0 : PI, 0xc8a060, 0x2a1c14, 5);
  flagstaff(k, -1.42, FD, 0.68, 1.1, { h: 0.24, w: 0.6, kind: 'swallow', col: 0x6a4a2a, knob: GOLD });
  heap(k, 0.95, FD, 0, [['carpet', 0, -0.32, 1.5, 0.1, 0x2a5a8a], ['jar', 0.25, 0.25, 1.5, 0, 0x3a7a8a], ['bale', 0.0, 0.25, 1.3, 0.2, 0xd8c08a], ['chest', 0.3, -0.05, 1.2, 0.3, 0x6a3a22]]);
  heap(k, -1.25, FD, 0, [['jar', 0, -0.3, 1.2, 0, 0x3a7a8a], ['carpet', 0.05, 0.0, 1.1, 0.0, 0x6a2a5a]]);
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: 0x8a6a40 });
}

// =====================================================================================================
// THE TSARDOM
// =====================================================================================================
function northHull(k, C, shp, o = {}) {
  const L = C.L, R = L.cloth, Wt = L.cloth2;
  const H = baseHull(k, C, shp, { col: { out: L.wood, strake: 0.07, in: sh(L.wood, 0.75), rim: sh(L.wood, 0.7) }, paint: [[0, 0.07, R], [0.07, 0.15, Wt, 0.06, 0.94], [0.15, 0.17, GOLD, 0.06, 0.94, 'metal']], owner: [0.2, 0.25, 0.14, 0.86], gun: sh(L.wood, 0.6), ...o });
  teethRow(k, H, 0.072, 0.07, R, o.teeth ?? 20, 0.08, 0.92); return H;
}
function horseHead(k, x, y, s, col, mane = GOLD) { k.push(T(x, y, 0, 0, 0, 0, s)); k.s(sweep([[-0.1, -0.1, 0], [0.02, 0.15, 0], [0.06, 0.35, 0], [0.18, 0.42, 0]], (v) => 0.07 - v * 0.025, 7, 12, col), null); k.s(rbox(0.2, 0.09, 0.09, 0.03, 1), col, T(0.24, 0.39, 0, 0, 0, -0.35)); for (const sz of [-1, 1]) { k.s(cone(0.025, 0.08, 4), col, T(0.07, 0.5, sz * 0.03)); k.s(ball(0.015, 5, 4), DARK, T(0.18, 0.44, sz * 0.045)); } for (let i = 0; i < 5; i++) k.m(cone(0.03, 0.12, 4), mane, T(-0.02 + i * 0.035, 0.08 + i * 0.07, 0, 0, 0, 0.9)); k.pop(); }
function northGondola(k, C) {
  const L = C.L, R = L.cloth;
  const H = northHull(k, C, { ...G_SHAPE, bowRise: 0.3, br: 2.2, sternRise: 0.24, ex: 2.5 }, { fx0: -1.45, fx1: 1.3 });
  const bt = H.at(0.995, 0.5), st = H.at(0.005, 0.5);
  horseHead(k, bt[0] - 0.04, bt[1], 1.05, R, GOLD);
  k.s(rbox(0.06, 0.42, 0.06, 0.015, 1), sh(L.wood, 0.7), T(st[0] + 0.05, st[1] + 0.12, 0)); onion(k, st[0] + 0.05, st[1] + 0.33, 0, 0.7, GOLD);
  for (const x of [-0.85, 0.65]) { k.rod('solid', 0x5a3a24, [x, H.topAt(x), -0.38], [x, H.topAt(x) + 0.55, -0.38], 0.014, 5); k.rod('solid', 0x5a3a24, [x, H.topAt(x) + 0.55, -0.38], [x, H.topAt(x) + 0.55, 0.38], 0.012, 4); k.rod('solid', 0x5a3a24, [x, H.topAt(x), 0.38], [x, H.topAt(x) + 0.55, 0.38], 0.014, 5); }
  k.c(surf(10, 2, (u, v, out) => { out[0] = -0.85 + u * 1.5; out[1] = H.topAt(-0.1) + 0.55 - v * 0.12 - Math.sin(PI * u) * 0.04; out[2] = 0.385; }, (u, v, i) => (i & 1 ? R : L.cloth2)));
  k.c(surf(10, 2, (u, v, out) => { out[0] = -0.85 + u * 1.5; out[1] = H.topAt(-0.1) + 0.55 - v * 0.12 - Math.sin(PI * u) * 0.04; out[2] = -0.385; }, (u, v, i) => (i & 1 ? R : L.cloth2)));
  lampPost(k, -1.42, H.topAt(-1.42), 0.18, 0.7, L.glow, 0x2a2a2e, -1, 'dome');
  gondolierOar(k, C, H, { oar: { shaft: 0x9a7a4a, bcol: R } });
  heap(k, 0.95, GD, 0, [['hide', 0, -0.1, 1.3, 0.1, 0x6a4a32], ['cask', 0.28, 0.12, 1.2], ['sack', -0.05, 0.18, 1.1, 0.5]], H);
  heap(k, -1.55, GD + 0.04, 0, [['bundle', 0, 0, 0.9, 0.0, 0x5a3a2a]], H);
  flagstaff(k, 1.2, GD, 0.2, 0.8, { h: 0.2, w: 0.45, kind: 'swallow', col: 0x5a3a24, knob: GOLD });
}
function northRiver(k, C) {
  const L = C.L, R = L.cloth;
  const H = northHull(k, C, { ...R_SHAPE, tr: 0, ps: 2.4, qs: 0.55, sternRise: 0.3, bowRise: 0.35, br: 2.2, ex: 3 }, { fx0: -1.85, fx1: 1.85 });
  const bt = H.at(0.995, 0.5); horseHead(k, bt[0] - 0.06, bt[1] - 0.02, 1.45, R, GOLD);
  cabin(k, 0.48, 1.12, 0.94, 0.6, RD, { wall: 0x8a5a3a, trim: L.cloth2, roof: 'onion', roofCol: R, dome: GOLD, drum: L.cloth2, winGlow: true, winCol: L.glow, nwin: 2 });
  for (const sz of [-1, 1]) for (const x of [0.62, 0.98]) k.s(slab([[-0.1, 0], [0.1, 0], [0.1, 0.2], [0, 0.28], [-0.1, 0.2]], 0.01), L.cloth2, T(x, RD + 0.25, sz * 0.48));
  const mx = 1.3; k.rod('solid', 0x5a3a24, [mx, RD, 0], [mx, 2.8, 0], 0.04, 8); onion(k, mx, 2.8, 0, 0.5, GOLD);
  sqSail(k, mx, 1.25, 2.5, 1.36, (u, v, i, j) => (v > 0.45 && v < 0.6 ? L.cloth2 : (u > 0.45 && u < 0.55) ? L.cloth2 : R), { owner: [0.06, 0.16], bil: 0.16, nu: 12 });
  rudder(k, shape({ ...R_SHAPE, tr: 0.2 }), sh(L.wood, 0.8), sh(L.wood, 0.6), { knob: GOLD });
  riverOars(k, C, H, { shaft: 0x9a7a4a, bcol: R });
  for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) { const p = H.side(-1.5 + i * 0.42, sd, 0.1, -0.012); roundShield(k, p[0], p[1], p[2], sd > 0 ? 0 : PI, 0.13, i & 1 ? R : L.cloth2, GOLD, GOLD); }
  lampPost(k, -1.85, H.topAt(-1.85), 0.35, 0.75, L.glow, 0x2a2a2e, -1, 'dome');
  heap(k, 1.6, RD, 0, [['hide', 0, -0.3, 1.5, 0.1, 0x6a4a32], ['cask', 0.02, 0.3, 1.5, 0.0], ['sack', 0.3, -0.05, 1.4, 0.4], ['hide', 0, -0.28, 1.3, -0.1, 0x8a6a4a, 0.22], ['crate', 0.0, 0.0, 1.3, 0.2]], H);
  heap(k, -1.75, RD, 0, [['cask', 0, -0.48, 1.3, 0], ['bundle', 0, 0.48, 1.2, 0.2, 0x5a3a2a]], H);
}
function northRaft(k, C) {
  const L = C.L, R = L.cloth, BARK = 0x5a4430;
  for (let i = 0; i < 8; i++) { const z = -0.7 + i * 0.2; k.s(cyl(0.11, 0.105, 3.0, 9), (px, py, pz) => sh(BARK, 0.85 + rnd(Math.floor(py * 3) + i) * 0.3), T(0, 0.13, z, 0, 0, HP)); k.s(cyl(0.09, 0.09, 0.012, 9), 0xd8b880, T(1.506, 0.13, z, 0, 0, HP)); k.s(cyl(0.09, 0.09, 0.012, 9), 0xd8b880, T(-1.506, 0.13, z, 0, 0, HP)); }
  for (const x of [-1.25, 0, 1.25]) k.s(cyl(0.07, 0.07, 1.8, 8), sh(BARK, 1.1), T(x, FD - 0.06, 0, HP)); 
  for (let i = 0; i < 16; i++) k.s(box(0.17, 0.03, 1.5), sh(L.wood, 0.95 + rnd(i * 2) * 0.2), T(-1.27 + i * 0.17, FD - 0.015, 0));
  k.o(box(2.5, 0.05, 0.012), WHITE, T(0, FD - 0.04, 0.8)); k.o(box(2.5, 0.05, 0.012), WHITE, T(0, FD - 0.04, -0.8));
  // a roadside shrine with an onion top at the bow corner
  k.s(rbox(0.08, 0.7, 0.08, 0.02, 1), sh(L.wood, 0.7), T(1.35, FD + 0.35, 0.6)); k.s(rbox(0.22, 0.24, 0.18, 0.02, 1), 0x8a5a3a, T(1.35, FD + 0.82, 0.6)); k.g(box(0.01, 0.1, 0.08), L.glow, T(1.462, FD + 0.82, 0.6)); k.s(gable(0.28, 0.1, 0.24), R, T(1.35, FD + 0.94, 0.6)); onion(k, 1.35, FD + 1.0, 0.6, 0.55, GOLD);
  for (const sd of [-1, 1]) rail(k, [[-1.4, sd * 0.72], [-0.5, sd * 0.72], [0.4, sd * 0.72], [1.2, sd * 0.72]], FD, 0.35, BARK, { rope: ROPE });
  flagstaff(k, -1.42, FD, -0.62, 1.1, { h: 0.24, w: 0.6, kind: 'swallow', col: 0x5a3a24, knob: GOLD });
  lampPost(k, -1.42, FD, 0.62, 0.7, L.glow, 0x2a2a2e, 1, 'dome');
  heap(k, 0.85, FD, 0, [['hide', 0, -0.3, 1.5, 0.1, 0x6a4a32], ['cask', 0.28, 0.0, 1.4, 0.1], ['sack', 0.0, 0.25, 1.4, 0.4], ['hide', 0.02, -0.28, 1.3, -0.1, 0x9a7a5a, 0.2]]);
  heap(k, -1.25, FD, 0, [['cask', 0, -0.3, 1.2, 0.0], ['bundle', 0.1, 0.0, 1.1, 0.4, 0x5a3a2a]]);
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: 0x9a7a4a, shoe: 0x3a3a40 });
}

// =====================================================================================================
// THE DEATHLESS
// =====================================================================================================
function uLook(L) {
  const f = L.faction;
  if (f === 'crimson') return { hull: 0x161418, band: L.cloth, trim: L.trim, glow: 0xff3a4a, wood: 0x241a1c, bone: 0xd8ccb8, sail: 0x3a0a10 };
  if (f === 'drowned') return { hull: 0x3a4a42, band: 0x2a3a3a, trim: 0x6a7a6a, glow: L.glow, wood: 0x4a5a4a, bone: 0xc8c8b0, sail: 0x6a7a6a };
  return { hull: 0x2a2624, band: 0x3a3a44, trim: BONE, glow: L.glow, wood: 0x3a3230, bone: BONE, sail: 0x5a5a60 };
}
/** a rotten flank: holes and weed for the drowned */
const rotten = (U) => (s, dt, y, j, i) => { const r = rnd(i * 31 + j * 7); return r > 0.93 ? 0x0a0c0c : r > 0.75 ? sh(U.hull, 0.75) : sh(U.hull, Math.floor(dt / 0.07) & 1 ? 0.85 : 1.05); };
function undeadHull(k, C, shp, U, o = {}) {
  const f = C.f, dr = f === 'drowned';
  const H = baseHull(k, C, shp, { col: { out: U.hull, strake: 0.07, fn: dr ? rotten(U) : undefined, in: sh(U.wood, 0.8), rim: U.trim, bottom: dr ? 0x2a3a2a : 0x141212 }, paint: dr ? [] : [[0, 0.05, U.band], [0.05, 0.065, U.trim, 0.04, 0.96, f === 'crimson' ? 'metal' : 'solid']], owner: [0.1, 0.14, 0.2, 0.8], gun: U.trim, gunO: { bag: f === 'crimson' ? 'metal' : 'solid' }, floor: sh(U.wood, 1.1), ...o });
  if (dr) { barnacles(k, H, o.barn ?? 40, 3); seaweed(k, H, o.weed ?? 12); }
  return H;
}
function tatter(k, x, y0, y1, w, col, o = {}) { // a ragged square sail
  sqSail(k, x, y0, y1, w, (u, v, i, j) => { const r = rnd(i * 13 + j * 5); return r > 0.88 ? sh(col, 0.5) : sh(col, 0.8 + r * 0.3); }, { bil: 0.1, nu: 10, nv: 8, ...o });
  for (let i = 0; i < 7; i++) { const u = (i + 0.5) / 7, l = 0.1 + rnd(i * 3) * 0.25; k.c(surf(1, 2, (uu, v, out) => { out[0] = x + 0.06 + Math.sin(PI * u) * 0.04; out[1] = y0 - v * l; out[2] = (u - 0.5) * w + (uu - 0.5) * (w / 7) * (1 - v * 0.8); }, sh(col, 0.75)), null); }
}
function batFig(k, x, y, z, s, col, eye) { k.push(T(x, y, z, 0, 0, 0, s)); k.s(ball(0.05, 8, 6), col, T(0, 0, 0, 0, 0, 0, 1, 1.3, 0.9)); k.s(ball(0.035, 8, 6), col, T(0, 0.07, 0)); for (const sz of [-1, 1]) { k.s(cone(0.012, 0.05, 4), col, T(0, 0.11, sz * 0.02)); k.add('glow', ball(0.008, 4, 3), eye, T(0.03, 0.075, sz * 0.015)); wing(k, T(0, 0.02, sz * 0.03, 0, sz > 0 ? -HP : HP, -0.5), 0.2, 1.3, 3, sh(col, 1.4), col); } k.pop(); }
function undeadGondola(k, C) {
  const L = C.L, f = C.f, U = uLook(L);
  const H = undeadHull(k, C, { ...G_SHAPE, B: 0.86, ex: f === 'crimson' ? 2.6 : 4.5, pb: f === 'crimson' ? 2.2 : 1.3, ps: f === 'crimson' ? 2.2 : 1.3, qb: 0.8, qs: 0.8, bowRise: f === 'crimson' ? 0.45 : 0.22, br: 2, sternRise: 0.2 }, U, { fx0: -1.45, fx1: 1.3, barn: 30, weed: 10 });
  const bt = H.at(0.995, 0.5), st = H.at(0.005, 0.5);
  if (f === 'crimson') { // black lacquer, a bat at the prow with its wings spread, gothic lamps
    post(k, [[bt[0] - 0.12, bt[1] - 0.05, 0], [bt[0], bt[1], 0], [bt[0] + 0.05, bt[1] + 0.14, 0]], 0.03, U.trim, 'metal');
    batFig(k, bt[0] + 0.05, bt[1] + 0.22, 0, 1.5, 0x1a1418, U.glow);
    for (const x of [-1.42, 0.62]) { k.rod('metal', 0x1a1418, [x, H.topAt(x), x > 0 ? 0.3 : -0.18], [x, H.topAt(x) + 0.7, x > 0 ? 0.3 : -0.18], 0.014, 5); k.m(cone(0.06, 0.16, 4), 0x1a1418, T(x, H.topAt(x) + 0.86, x > 0 ? 0.3 : -0.18)); k.g(cyl(0.035, 0.035, 0.1, 4), U.glow, T(x, H.topAt(x) + 0.74, x > 0 ? 0.3 : -0.18)); }
    for (const sd of [-1, 1]) for (const x of [-0.55, 0.15]) { const p = H.side(x, sd, 0.08, -0.012); k.m(cyl(0.05, 0.05, 0.016, 8), U.trim, TA(p, [0, 0, sd])); }
  } else { // a coffin-boat with a skull on the stem, rib-hoops and witch-lights
    skull(k, bt[0] + 0.02, bt[1] + 0.04, 0, 1.4, 0, U.bone, U.glow, f === 'drowned' ? 0 : 0.6);
    ribs(k, H, [-0.95, -0.35, 0.15, 0.65], U.bone, 0.018);
    for (const x of [-1.42, 0.9]) { const y = H.topAt(x), z = x > 0 ? 0.3 : -0.2; k.add('solid', sweep([[x, y, z], [x, y + 0.5, z], [x + 0.05, y + 0.75, z], [x + 0.2, y + 0.78, z]], 0.014, 4, 8, U.wood), null); lantern(k, x + 0.2, y + 0.74, z, U.glow, 0x2a2a2e, 0.9); }
    if (f === 'drowned') { k.m(torus(0.09, 0.02, 4, 10, PI), 0x4a4a42, T(st[0] + 0.05, st[1] - 0.05, 0.1, 0, 0, PI)); k.m(box(0.02, 0.22, 0.02), 0x4a4a42, T(st[0] + 0.05, st[1] - 0.0, 0.1)); }
  }
  gondolierOar(k, C, H, { rest: U.wood, fork: U.trim, oar: { shaft: f === 'crimson' ? 0x1a1418 : U.bone, bcol: f === 'drowned' ? 0x4a5a4a : U.bone } });
  heap(k, 0.95, GD, 0, f === 'crimson' ? [['chest', 0, -0.06, 1.3, 0.1, 0x3a0a10], ['jar', 0.28, 0.1, 1.2, 0, 0x5a0a14], ['cask', 0.0, 0.18, 1.0, 0.2, 0x2a1a14]] : [['chest', 0, -0.06, 1.3, 0.1, 0x2a2420], ['jar', 0.28, 0.1, 1.2, 0, 0x4a4a42], ['bundle', 0, 0.18, 1.0, 0.2, 0x3a3a34]], H);
  heap(k, -1.5, GD + 0.04, 0, [['jar', 0, 0, 0.9, 0, 0x3a3a34]], H);
  flagstaff(k, 1.2, GD, -0.2, 0.8, { h: 0.2, w: 0.45, kind: 'rag', col: U.wood, knob: U.trim });
}
function undeadRiver(k, C) {
  const L = C.L, f = C.f, U = uLook(L);
  const H = undeadHull(k, C, { ...R_SHAPE, tr: f === 'crimson' ? 0.45 : 0.3, bowRise: 0.3, sternRise: 0.4, ex: f === 'crimson' ? 3 : 3.6 }, U, { fx0: -1.9, fx1: 1.85, barn: 60, weed: 18 });
  const bt = H.at(0.995, 0.5), mx = 1.3;
  if (f === 'crimson') {
    cabin(k, 0.48, 1.12, 0.94, 0.62, RD, { wall: 0x1a1418, wallBag: 'metal', trim: U.trim, roof: 'gable', rh: 0.42, roofCol: 0x2a1a1e, winGlow: true, winCol: U.glow, nwin: 2, winGeo: slab([[-0.06, -0.1], [0.06, -0.1], [0.06, 0.04], [0, 0.12], [-0.06, 0.04]], 0.012) });
    for (const x of [0.48, 1.12]) k.m(cone(0.04, 0.3, 4), 0x1a1418, T(x, RD + 1.08, 0));
    k.rod('metal', 0x1a1418, [mx, RD, 0], [mx, 2.9, 0], 0.04, 8); k.m(box(0.06, 0.06, 1.5), 0x1a1418, T(mx, 2.6, 0));
    for (const sz of [-1, 1]) wing(k, T(mx + 0.04, 2.6, 0, 0, sz > 0 ? -HP : HP, -1.4), 1.05, 1.9, 4, U.sail, 0x1a1418);
    batFig(k, bt[0] + 0.05, bt[1] + 0.25, 0, 2.0, 0x1a1418, U.glow);
    k.o(surf(4, 3, (u, v, out) => { out[0] = mx + 0.06; out[1] = 2.55 - v * 0.5; out[2] = (u - 0.5) * 0.34; }, WHITE)); k.o(surf(4, 3, (u, v, out) => { out[0] = mx + 0.04; out[1] = 2.55 - v * 0.5; out[2] = (u - 0.5) * 0.34; }, WHITE));
  } else {
    cageRibs(k, H, [-1.5, -1.0, -0.5, 0.0, 1.5], U.bone, 0.22, 0.022);
    cabin(k, 0.48, 1.12, 0.92, 0.6, RD, { wall: f === 'drowned' ? 0x5a6a5a : 0x6a6a6a, trim: f === 'drowned' ? 0x3a4a3a : 0x4a4a4a, roof: 'gable', rh: 0.38, roofCol: f === 'drowned' ? 0x3a4a42 : 0x34343c, winGlow: true, winCol: U.glow, nwin: 1, doorCol: 0x141414 });
    if (f === 'drowned') { k.rod('solid', U.wood, [mx, RD, 0], [mx + 0.05, 2.2, 0], 0.045, 8); k.s(cone(0.05, 0.14, 5), sh(U.wood, 1.3), T(mx + 0.05, 2.25, 0, 0, 0, 0.6)); tatter(k, mx, 1.35, 2.05, 1.2, U.sail, { owner: [0.05, 0.15], yard: true }); k.rod('solid', U.wood, [mx + 0.05, 2.05, -0.1], [mx + 0.3, 2.3, 0.7], 0.02, 5); k.m(torus(0.16, 0.03, 4, 12, PI), 0x4a4a42, T(bt[0] + 0.05, 0.25, 0.3, 0, 0, PI)); k.m(box(0.03, 0.4, 0.03), 0x4a4a42, T(bt[0] + 0.05, 0.42, 0.3)); }
    else { k.rod('solid', U.wood, [mx, RD, 0], [mx, 2.8, 0], 0.04, 8); tatter(k, mx, 1.3, 2.55, 1.3, U.sail, { owner: [0.06, 0.16] }); for (let i = 0; i < 3; i++) skull(k, mx + 0.05, 2.62 + i * 0.0, -0.4 + i * 0.4, 0.8, 0, U.bone, U.glow); }
    skull(k, bt[0] + 0.05, bt[1] + 0.06, 0, 2.2, 0, U.bone, U.glow, f === 'drowned' ? 0 : 0.8);
    for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { const p = H.side(-1.4 + i * 0.6, sd, 0.06, -0.02); skull(k, p[0], p[1] - 0.06, p[2], 0.75, sd > 0 ? -HP : HP, U.bone, f === 'drowned' ? null : U.glow); }
  }
  for (const x of [-1.95]) { const y = H.topAt(x); for (const sd of [-1, 1]) { k.add('solid', sweep([[x, y, sd * 0.4], [x, y + 0.6, sd * 0.4], [x + 0.05, y + 0.85, sd * 0.4], [x + 0.2, y + 0.88, sd * 0.4]], 0.015, 4, 8, f === 'crimson' ? 0x1a1418 : U.wood), null); lantern(k, x + 0.2, y + 0.84, sd * 0.4, U.glow, 0x2a2a2e, 1); } }
  rudder(k, H, sh(U.wood, 0.9), sh(U.wood, 0.7), { knob: U.trim });
  riverOars(k, C, H, { shaft: f === 'crimson' ? 0x1a1418 : U.bone, bcol: f === 'drowned' ? 0x4a5a4a : f === 'crimson' ? 0x3a0a10 : U.bone });
  heap(k, 1.6, RD, 0, f === 'crimson' ? [['chest', 0, -0.3, 1.5, 0.1, 0x3a0a10], ['cask', 0.02, 0.3, 1.4, 0, 0x2a1a14], ['jar', 0.3, 0.0, 1.4, 0, 0x5a0a14], ['chest', 0.0, -0.3, 1.2, -0.1, 0x1a1418, 0.24]] : [['chest', 0, -0.3, 1.5, 0.1, 0x2a2420], ['cask', 0.02, 0.3, 1.4, 0, 0x3a3430], ['jar', 0.3, 0.0, 1.3, 0, 0x4a4a42], ['bundle', 0.0, -0.3, 1.2, 0.2, 0x3a3a34, 0.18]], H);
  heap(k, -1.72, RD, 0, [['cask', 0, -0.5, 1.2, 0, 0x2a2420], ['jar', 0, 0.5, 1.2, 0, 0x3a3a34]], H);
}
function coffin(k, x, y, z, l, w, h, col, lid, ry = 0, trim) { const pts = [[-l / 2, 0], [l * 0.18, -w / 2], [l / 2, -w * 0.32], [l / 2, w * 0.32], [l * 0.18, w / 2], [-l / 2, 0.0]]; const shp = [[-l / 2, -w * 0.3], [l * 0.18, -w / 2], [l / 2, -w * 0.32], [l / 2, w * 0.32], [l * 0.18, w / 2], [-l / 2, w * 0.3]]; k.push(T(x, y, z, HP, ry, 0)); k.s(slab(shp, h), col, T(0, 0, -h / 2)); k.s(slab(shp, 0.03), lid, T(0, 0, -h - 0.015, 0, 0, 0, 1.04, 1.04, 1)); if (trim) { k.m(box(0.03, w * 0.6, 0.012), trim, T(l * 0.05, 0, -h - 0.032)); k.m(box(l * 0.35, 0.03, 0.012), trim, T(l * 0.05, 0, -h - 0.032)); } k.pop(); void pts; }
function undeadRaft(k, C) {
  const L = C.L, f = C.f, U = uLook(L);
  if (f === 'crimson') { // black coffins for floats, a lacquered deck, candelabra
    for (const z of [-0.5, 0.0, 0.5]) for (const x of [-0.75, 0.75]) coffin(k, x, 0.16, z, 1.4, 0.46, 0.22, 0x1a1418, 0x2a1a1e, 0, U.trim);
    for (let i = 0; i < 20; i++) k.s(box(0.14, 0.04, 1.6), sh(0x1e1a1c, 0.9 + rnd(i) * 0.25), T(-1.33 + i * 0.14, FD - 0.02, 0));
    for (const z of [-0.8, 0.8]) { k.m(box(2.9, 0.06, 0.04), U.trim, T(0, FD - 0.02, z)); k.c(surf(12, 2, (u, v, out) => { out[0] = -1.4 + u * 2.8; out[1] = FD - 0.02 - v * 0.18 - Math.abs(Math.sin(u * PI * 6)) * 0.06 * v; out[2] = z * 1.01; }, U.band)); }
    for (const [x, z] of [[1.35, 0.65], [-1.35, -0.65], [1.35, -0.65]]) { k.rod('metal', 0x1a1418, [x, FD, z], [x, FD + 0.7, z], 0.016, 5); k.m(torus(0.1, 0.01, 4, 10, PI), 0x1a1418, T(x, FD + 0.7, z, 0, 0, PI)); for (const d of [-0.1, 0, 0.1]) { k.s(cyl(0.015, 0.015, 0.1, 5), 0xf0e8d8, T(x, FD + 0.76 + (d ? 0 : 0.06), z + d)); k.g(cone(0.012, 0.04, 5), U.glow, T(x, FD + 0.83 + (d ? 0 : 0.06), z + d)); } }
    batFig(k, 1.4, FD + 0.1, 0, 1.6, 0x1a1418, U.glow);
  } else if (f === 'drowned') { // wreckage lashed together
    for (let i = 0; i < 9; i++) { const z = -0.72 + i * 0.18; k.s(box(2.6 + rnd(i) * 0.5, 0.06, 0.16), sh(U.wood, 0.75 + rnd(i * 3) * 0.35), T(-0.1 + (rnd(i * 7) - 0.5) * 0.3, FD - 0.03 - rnd(i * 2) * 0.02, z, 0, (rnd(i * 5) - 0.5) * 0.06, (rnd(i * 9) - 0.5) * 0.04)); }
    for (const [x, z] of [[-0.9, -0.5], [-0.9, 0.5], [0.4, 0.0], [0.9, -0.55], [0.95, 0.55]]) { k.push(T(x, 0.08, z, 0, rnd(x * 9) * 2, HP)); k.s(rev([[0, -0.32], [0.17, -0.32], [0.2, 0], [0.17, 0.32], [0, 0.32]], 10, sh(U.wood, 0.9)), null); k.pop(); }
    const F = shape({ x0: -1.5, x1: 1.5, B: 1.6, free: FD - 0.04, draft: 0.12, ex: 6, pb: 6, ps: 6 }); barnacles(k, F, 50, 9); seaweed(k, F, 14, 0x3a6a3a, 5);
    k.rod('solid', U.wood, [-1.2, FD, 0.55], [-1.15, FD + 1.3, 0.55], 0.035, 6); k.s(cone(0.04, 0.12, 5), sh(U.wood, 1.3), T(-1.15, FD + 1.36, 0.55, 0, 0, 0.5)); lantern(k, -1.0, FD + 1.05, 0.55, U.glow, 0x2a2a2e, 1.1); k.rod('solid', U.wood, [-1.15, FD + 1.15, 0.55], [-1.0, FD + 1.12, 0.55], 0.012, 4);
    k.m(torus(0.18, 0.035, 4, 12, PI), 0x4a4a42, T(1.3, FD + 0.04, 0.2, -HP, 0, 0)); k.m(box(0.5, 0.04, 0.04), 0x4a4a42, T(1.25, FD + 0.02, 0.2));
    skull(k, 1.4, FD + 0.08, -0.45, 1.3, 0, U.bone, U.glow);
  } else { // a raft of bones and coffin lids, skulls on stakes with witch-fire
    for (let i = 0; i < 8; i++) { const z = -0.7 + i * 0.2; k.s(cyl(0.1, 0.1, 2.9, 8), sh(0x3a3230, 0.85 + rnd(i) * 0.3), T(0, 0.12, z, 0, 0, HP)); }
    for (let i = 0; i < 6; i++) coffin(k, -1.15 + i * 0.47, FD - 0.03, 0, 1.6, 0.44, 0.03, sh(U.wood, 1.1 + rnd(i) * 0.2), sh(U.wood, 1.3), HP, null);
    for (const z of [-0.79, 0.79]) for (let i = 0; i < 14; i++) k.s(cyl(0.022, 0.022, 0.2, 5), U.bone, T(-1.35 + i * 0.21, FD - 0.02, z, 0, 0, HP));
    for (const [x, z] of [[1.4, 0.7], [1.4, -0.7], [-1.4, -0.7]]) { k.s(cyl(0.02, 0.025, 0.8, 5), U.wood, T(x, FD + 0.4, z)); skull(k, x, FD + 0.86, z, 1.1, 0, U.bone, U.glow); k.g(cone(0.05, 0.18, 6), U.glow, T(x, FD + 1.05, z)); }
  }
  k.o(box(2.4, 0.05, 0.012), WHITE, T(0, FD - 0.04, 0.82)); k.o(box(2.4, 0.05, 0.012), WHITE, T(0, FD - 0.04, -0.82));
  flagstaff(k, -1.42, FD, 0.62, 1.1, { h: 0.24, w: 0.55, kind: 'rag', col: U.wood, knob: U.trim });
  heap(k, 0.85, FD, 0, f === 'crimson' ? [['chest', 0, -0.3, 1.5, 0.1, 0x3a0a10], ['cask', 0.28, 0.0, 1.4, 0.1, 0x2a1a14], ['jar', 0.0, 0.28, 1.4, 0, 0x5a0a14]] : [['chest', 0, -0.3, 1.5, 0.1, 0x2a2420], ['cask', 0.28, 0.0, 1.4, 0.1, 0x3a3430], ['jar', 0.0, 0.28, 1.4, 0, 0x4a4a42]]);
  heap(k, -1.2, FD, 0, [['bundle', 0, -0.3, 1.2, 0.2, 0x3a3a34], ['jar', 0.15, 0.0, 1.1, 0, 0x3a3a34]]);
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: f === 'crimson' ? 0x1a1418 : U.bone });
}

// =====================================================================================================
// THE INFERNAL LEGIONS
// =====================================================================================================
function iLook(L) {
  const f = L.faction;
  if (f === 'ashur') return { hull: 0x4a3020, plate: 0x6a4a2a, band: 0x2a4a8a, trim: L.trim, fire: L.glow, bag: 'solid' };
  if (f === 'ironbound') return { hull: 0x2a2a30, plate: 0x3a3a42, band: L.cloth, trim: 0x8a8a90, fire: L.glow, bag: 'metal' };
  return { hull: 0x1c1a1c, plate: 0x2a2224, band: L.cloth, trim: L.trim, fire: L.glow, bag: 'metal' };
}
function infernalHull(k, C, shp, I, o = {}) {
  const f = C.f;
  const H = baseHull(k, C, shp, { bag: I.bag, col: { out: I.hull, strake: 0, fn: (s, dt, y, j, i) => sh(I.hull, Math.floor(s * 16) & 1 ? 1.15 : 0.92), in: sh(I.plate, 0.9), rim: I.trim, bottom: 0x141012 }, paint: [[0, 0.05, I.trim, 0.03, 0.97, 'metal'], [0.06, 0.14, I.band, 0.06, 0.94, f === 'ashur' ? 'solid' : 'solid']], owner: [0.16, 0.2, 0.18, 0.82], gun: I.trim, gunO: { bag: 'metal' }, gunR: 0.026, floor: sh(I.plate, 1.2), ...o });
  if (f === 'ironbound') { rivetRow(k, H, 0.04, 0x9a9aa0, 0.06, 0.94, 18); rivetRow(k, H, 0.2, 0x9a9aa0, 0.1, 0.9, 16); }
  else if (f === 'ashur') { for (const sd of [-1, 1]) for (let i = 0; i < 10; i++) { const s = 0.1 + i * 0.09, p = H.at(s, H.aAt(s, 0.1, sd), -0.012); k.m(cyl(0.035, 0.035, 0.012, 8), GOLD, TA(p, [0, 0, sd])); k.s(cyl(0.015, 0.015, 0.016, 6), 0xf0e8d0, TA(p, [0, 0, sd])); } }
  else spikes(k, H, 0.02, 0x2a2224, o.spk ?? 10, 0.16);
  return H;
}
function hornPair(k, x, y, z, s, col, bag = 'metal') { for (const sz of [-1, 1]) k.add(bag, sweep([[x, y, z + sz * 0.05 * s], [x + 0.05 * s, y + 0.1 * s, z + sz * 0.22 * s], [x + 0.18 * s, y + 0.3 * s, z + sz * 0.3 * s], [x + 0.32 * s, y + 0.38 * s, z + sz * 0.22 * s]], (v) => 0.05 * s * (1 - v * 0.85), 6, 10, col), null); }
function bullHead(k, x, y, s, col, horn) { k.push(T(x, y, 0, 0, 0, 0, s)); k.add('metal', ball(0.13, 10, 8), col, T(0, 0, 0, 0, 0, 0, 1.2, 1, 0.9)); k.add('metal', rbox(0.16, 0.12, 0.14, 0.04, 1), col, T(0.13, -0.05, 0)); for (let i = 0; i < 4; i++) k.add('metal', torus(0.04, 0.012, 4, 8), sh(col, 0.8), T(0.0, -0.12 - i * 0.04, 0, HP)); k.add('metal', box(0.04, 0.2, 0.18), sh(col, 0.8), T(-0.02, -0.2, 0)); for (const sz of [-1, 1]) k.s(ball(0.02, 6, 4), 0x101010, T(0.1, 0.04, sz * 0.08)); hornPair(k, -0.02, 0.06, 0, 0.8, horn); k.pop(); }
function infernalGondola(k, C) {
  const L = C.L, f = C.f, I = iLook(L);
  const H = infernalHull(k, C, { ...G_SHAPE, B: 0.92, bowRise: 0.3, br: 2, sternRise: 0.18, ex: 3.2, tr: f === 'ironbound' ? 0.4 : 0, ps: f === 'ironbound' ? 3 : 2.2, qs: f === 'ironbound' ? 0.4 : 0.6 }, I, { fx0: -1.5, fx1: 1.3, spk: 8 });
  const bt = H.at(0.995, 0.5);
  if (f === 'ashur') { bullHead(k, bt[0] + 0.02, bt[1] + 0.06, 1.1, I.trim, I.trim); brazier(k, 1.15, GD, 0.0, 1.2, I.trim, I.fire); for (const sd of [-1, 1]) for (let q = 0; q < 3; q++) k.s(box(0.08, 0.08, +(0.16 - q * 0.05).toFixed(2)), sh(0xb08a5a, 1 - q * 0.08), T(-1.45, H.topAt(-1.45) + 0.04 + q * 0.08, sd * 0.16)); }
  else if (f === 'ironbound') { k.m(cone(0.1, 0.4, 4), 0x4a4a52, T(bt[0] + 0.12, 0.05, 0, 0, PI / 4, -HP)); hood(k, 0.66, 1.25, H.topAt(0.9), 0.84, 0.36, 0x2a2a30, { bag: 'metal', nu: 8, nv: 4, ribs: 4, ribCol: 0x5a5a62 }); k.g(box(0.02, 0.1, 0.2), I.fire, T(1.26, H.topAt(1.0) + 0.12, 0)); k.m(cyl(0.1, 0.1, 0.24, 8), 0x2a2a30, T(-1.45, GD + 0.12, 0.15)); k.m(cyl(0.04, 0.05, 0.5, 6), 0x3a3a42, T(-1.48, GD + 0.48, 0.15)); k.g(box(0.02, 0.06, 0.08), I.fire, T(-1.345, GD + 0.12, 0.15)); }
  else { hornPair(k, bt[0] - 0.1, bt[1] - 0.04, 0, 1.4, 0x2a2224); skull(k, bt[0] + 0.03, bt[1] + 0.02, 0, 1.1, 0, 0xd8ccb8, I.fire); brazier(k, 1.1, GD, 0.0, 1.2, 0x2a2224, I.fire); }
  brazier(k, -1.45, H.topAt(-1.45) - 0.08, -0.15, 1.0, f === 'ashur' ? I.trim : 0x2a2224, I.fire);
  gondolierOar(k, C, H, { rest: I.plate, restBag: 'metal', fork: I.trim, oar: { shaft: 0x3a2a22, bcol: f === 'ashur' ? I.trim : 0x2a2224 } });
  heap(k, 0.82, GD, 0, [['crate', 0, -0.2, 1.2, 0.1, 0x4a2a1a], ['cask', 0.0, 0.18, 1.1, 0.0, 0x3a2a1a]], H);
  heap(k, -1.25, GD, 0, [['cask', 0, -0.22, 1.0, 0.0, 0x3a2a1a]], H);
  flagstaff(k, 0.62, GD, -0.3, 0.9, { h: 0.22, w: 0.45, kind: 'swallow', col: 0x2a2224, knob: I.trim, knobGeo: cone(0.04, 0.12, 4) });
}
function infernalRiver(k, C) {
  const L = C.L, f = C.f, I = iLook(L), mx = 1.3;
  if (f === 'ironbound') C.wheel = true;
  const H = infernalHull(k, C, { ...R_SHAPE, x0: f === 'ironbound' ? -1.72 : -2.1, tr: f === 'ironbound' ? 0.75 : 0.42, ps: f === 'ironbound' ? 4 : 3.4, qs: f === 'ironbound' ? 0.3 : 0.42, bowRise: 0.3, br: 2, sternRise: f === 'ironbound' ? 0.05 : 0.3, ex: 3.4 }, I, { fx0: f === 'ironbound' ? -1.6 : -1.9, fx1: 1.8, spk: 14 });
  const bt = H.at(0.995, 0.5);
  if (f === 'ironbound') {
    cabin(k, 0.46, 1.14, 1.0, 0.66, RD, { wallBag: 'metal', wall: 0x3a3a42, trim: 0x5a5a62, roof: 'flat', roofCol: 0x2a2a30, roofBag: 'metal', winGlow: true, winCol: I.fire, nwin: 2, winGeo: box(0.16, 0.05, 0.012), doorCol: 0x1a1a1c });
    for (const z of [-0.22, 0.22]) { k.m(cyl(0.09, 0.1, 1.2, 10), 0x2a2a30, T(0.8, RD + 1.25, z)); k.m(cyl(0.11, 0.11, 0.05, 10), I.band, T(0.8, RD + 1.4, z)); k.g(cyl(0.07, 0.07, 0.02, 10), I.fire, T(0.8, RD + 1.86, z)); for (let i = 0; i < 4; i++) k.m(cone(0.02, 0.1, 4), 0x2a2a30, T(0.8 + Math.cos(i * HP) * 0.1, RD + 1.88, z + Math.sin(i * HP) * 0.1)); }
    paddleWheel(k, C, -1.98, 0.34, 0.46, 1.0, { rim: 0x3a3a42, pad: 0x2a2a30, hub: I.band, n: 8, extra: (x, y, R, W) => { for (let i = 0; i < 8; i++) { const a = ((i + 0.5) / 8) * TAU; k.s(cone(0.03, 0.12, 4), 0x5a5a62, T(x + Math.cos(a) * (R + 0.05), y + Math.sin(a) * (R + 0.05), 0, 0, 0, a - HP)); } } });
    for (const sz of [-1, 1]) { k.m(rbox(0.7, 0.1, 0.08, 0.02, 1), 0x3a3a42, T(-1.72, 0.42, sz * 0.62, 0, 0, -0.1)); k.m(cyl(0.07, 0.07, 0.1, 8), I.band, T(-1.98, 0.34, sz * 0.62, HP)); k.m(rbox(0.06, 0.5, 0.06, 0.02, 1), 0x3a3a42, T(-1.68, 0.59, sz * 0.62)); }
    k.m(cone(0.14, 0.5, 4), 0x4a4a52, T(bt[0] + 0.18, 0.08, 0, 0, PI / 4, -HP));
    for (let i = 0; i < 9; i++) k.m(torus(0.04, 0.012, 4, 8), 0x4a4a52, T(1.9 - i * 0.07, H.topAt(1.6) + 0.02, 0.62, i & 1 ? HP : 0, 0, 0));
    lampPost(k, -1.55, RD, -0.6, 0.8, I.fire, 0x2a2a30, 1);
  } else if (f === 'ashur') {
    for (let q = 0; q < 4; q++) k.s(rbox(0.68 - q * 0.14, 0.18, 0.96 - q * 0.2, 0.01, 1), q & 1 ? sh(0xb08a5a, 0.85) : 0xb08a5a, T(0.8, RD + 0.09 + q * 0.18, 0));
    k.s(box(0.69, 0.04, 0.97), I.band, T(0.8, RD + 0.18, 0)); k.g(box(0.1, 0.12, 1.0), I.fire, T(0.8, RD + 0.06, 0)); brazier(k, 0.8, RD + 0.72, 0, 1.4, I.trim, I.fire);
    k.rod('solid', 0x4a3020, [mx + 0.12, RD, 0], [mx + 0.12, 2.7, 0], 0.04, 8);
    sqSail(k, mx + 0.12, 1.3, 2.45, 1.3, (u, v, i, j) => { const dx = u - 0.5, dy = v - 0.5; return dx * dx + dy * dy < 0.04 ? I.trim : j & 1 ? L.cloth : sh(L.cloth, 0.8); }, { owner: [0.06, 0.15], bil: 0.14 });
    bullHead(k, bt[0] + 0.04, bt[1] + 0.1, 1.4, I.trim, I.trim);
    for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) for (let q = 0; q < 3; q++) { const x = -1.85 + i * 0.12; k.s(box(0.1, 0.08, +(0.1 - q * 0.03).toFixed(2)), sh(0xb08a5a, 1 - q * 0.08), T(x, H.topAt(x) + 0.04 + q * 0.08, sd * 0.45)); }
    riverOars(k, C, H, { shaft: 0x5a3a24, bcol: I.trim });
    rudder(k, H, sh(I.hull, 1.2), 0x5a3a24, { knob: I.trim });
  } else {
    cabin(k, 0.48, 1.12, 0.94, 0.56, RD, { wallBag: 'metal', wall: 0x2a2224, trim: I.trim, roof: 'flat', roofCol: 0x1c1a1c, roofBag: 'metal', winGlow: true, winCol: I.fire, nwin: 2, winGeo: box(0.12, 0.12, 0.012) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.m(cone(0.05, 0.4, 5), 0x2a2224, T(0.8 + sx * 0.3, RD + 0.78, sz * 0.43));
    brazier(k, 0.8, RD + 0.6, 0, 1.6, 0x2a2224, I.fire);
    k.rod('metal', 0x2a2224, [mx, RD, 0], [mx, 2.6, 0], 0.04, 8); k.m(box(0.06, 0.06, 1.2), 0x2a2224, T(mx, 2.4, 0)); for (const sz of [-1, 1]) k.m(cone(0.04, 0.2, 4), 0x2a2224, T(mx, 2.4, sz * 0.66, sz * HP, 0, 0));
    k.c(surf(6, 6, (u, v, out) => { out[0] = mx + 0.05 + Math.sin(PI * u) * 0.08; out[1] = 2.36 - v * 0.95; out[2] = (u - 0.5) * 1.1 * (1 - v * 0.25); }, (u, v, i, j) => (j === 5 && (i & 1) ? 0x1a0a0a : I.band)));
    skull(k, mx + 0.1, 1.95, 0, 1.6, 0, 0xd8ccb8, I.fire, 1.0, 0x2a2224);
    hornPair(k, bt[0] - 0.15, bt[1] - 0.06, 0, 2.0, 0x2a2224); skull(k, bt[0] + 0.04, bt[1] + 0.05, 0, 1.5, 0, 0xd8ccb8, I.fire);
    riverOars(k, C, H, { shaft: 0x3a2a22, bcol: 0x2a2224 });
    rudder(k, H, 0x2a2224, 0x3a2a22, { knob: I.trim });
    for (let i = 0; i < 2; i++) { k.add('metal', sweep([[1.6, H.topAt(1.6), 0.62], [1.4, H.topAt(1.4) - 0.15, 0.68], [1.2, H.topAt(1.2) + 0.0, 0.62]], 0.015, 4, 8, 0x4a4a52), null); }
  }
  if (f !== 'ironbound') { brazier(k, -1.95, H.topAt(-1.95), 0.4, 1.1, f === 'ashur' ? I.trim : 0x2a2224, I.fire); brazier(k, -1.95, H.topAt(-1.95), -0.4, 1.1, f === 'ashur' ? I.trim : 0x2a2224, I.fire); }
  flagstaff(k, f === 'ironbound' ? 1.35 : -1.75, RD, f === 'ironbound' ? 0.45 : 0.55, 1.2, { h: 0.26, w: 0.6, kind: 'swallow', col: 0x2a2224, knob: I.trim, knobGeo: cone(0.04, 0.12, 4) });
  heap(k, 1.6, RD, 0, [['crate', 0, -0.3, 1.5, 0.1, 0x4a2a1a], ['cask', 0.02, 0.3, 1.4, 0, 0x3a2a1a], ['crate', 0.3, 0.0, 1.3, 0.3, 0x3a2418], ['ingot', 0.0, 0.0, 1.3, 0.2, f === 'ashur' ? I.trim : 0x4a4a52]], H);
  heap(k, f === 'ironbound' ? -1.4 : -1.72, RD, 0, [['cask', 0, -0.5, 1.2, 0, 0x3a2a1a], ['crate', 0, 0.5, 1.1, 0.2, 0x4a2a1a]], H);
}
function infernalRaft(k, C) {
  const L = C.L, f = C.f, I = iLook(L);
  if (f === 'ashur') { for (let i = 0; i < 8; i++) { const z = -0.7 + i * 0.2; k.s(cyl(0.11, 0.11, 2.9, 9), sh(0x5a3a24, 0.85 + rnd(i) * 0.3), T(0, 0.13, z, 0, 0, HP)); for (const sx of [-1, 1]) k.m(cyl(0.115, 0.115, 0.06, 9), I.trim, T(sx * 1.43, 0.13, z, 0, 0, HP)); } }
  else for (const z of [-0.5, 0.5]) { const F = shape({ x0: -1.5, x1: 1.5, B: 0.55, draft: 0.16, free: 0.16, bowRise: 0.08, ex: 3, pb: 3, ps: 3, th: 0.02 }); k.push(T(0, 0, z)); shell(k, F, hcol(F, { out: I.hull, strake: 0, fn: (s) => sh(I.hull, Math.floor(s * 10) & 1 ? 1.2 : 0.9), in: I.plate, rim: I.trim }), { m: 8, nv: 20, bag: 'metal' }); k.pop(); }
  if (f === 'ashur') for (let i = 0; i < 16; i++) k.s(box(0.17, 0.03, 1.6), sh(0x6a4a2a, 0.9 + rnd(i) * 0.2), T(-1.27 + i * 0.17, FD - 0.015, 0));
  else { for (let i = 0; i <= 14; i++) k.m(box(0.03, 0.04, 1.6), I.plate, T(-1.4 + i * 0.2, FD - 0.02, 0)); for (let i = 0; i <= 7; i++) k.m(box(2.84, 0.04, 0.03), I.plate, T(0, FD - 0.025, -0.78 + i * 0.223)); k.g(box(2.6, 0.01, 1.4), mix(I.fire, 0x000000, 0.6), T(0, 0.12, 0)); }
  for (const z of [-0.8, 0.8]) k.m(box(2.96, 0.08, 0.04), I.trim, T(0, FD - 0.03, z));
  k.o(box(2.4, 0.05, 0.012), WHITE, T(0, FD - 0.06, 0.826)); k.o(box(2.4, 0.05, 0.012), WHITE, T(0, FD - 0.06, -0.826));
  if (f === 'ashur') { for (let q = 0; q < 3; q++) k.s(rbox(0.55 - q * 0.14, 0.12, 0.55 - q * 0.14, 0.01, 1), q & 1 ? sh(0xb08a5a, 0.85) : 0xb08a5a, T(1.15, FD + 0.06 + q * 0.12, 0)); k.s(box(0.56, 0.03, 0.56), I.band, T(1.15, FD + 0.1, 0)); brazier(k, 1.15, FD + 0.36, 0, 1.3, I.trim, I.fire); for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) for (let q = 0; q < 2; q++) k.s(box(0.1, 0.08, 0.06), 0xb08a5a, T(-1.3 + i * 0.5, FD + 0.04 + q * 0.08, sd * 0.78)); }
  else if (f === 'ironbound') { k.m(rbox(0.5, 0.36, 0.7, 0.03, 1), 0x3a3a42, T(1.15, FD + 0.18, 0)); k.m(cyl(0.06, 0.07, 0.6, 8), 0x2a2a30, T(1.15, FD + 0.6, 0)); k.g(cyl(0.045, 0.045, 0.02, 8), I.fire, T(1.15, FD + 0.9, 0)); k.g(box(0.02, 0.08, 0.3), I.fire, T(1.405, FD + 0.18, 0)); rivetRow(k, shape({ x0: -1.5, x1: 1.5, B: 1.62, free: FD, draft: 0.05, ex: 8, pb: 8, ps: 8 }), 0.03, 0x9a9aa0, 0.05, 0.95, 14); for (let i = 0; i < 9; i++) k.m(torus(0.04, 0.012, 4, 8), 0x4a4a52, T(-1.2 + i * 0.07, FD + 0.01, 0.65, i & 1 ? HP : 0, 0, 0)); }
  else { brazier(k, 1.2, FD, 0, 1.6, 0x2a2224, I.fire); for (const [x, z] of [[1.42, 0.75], [1.42, -0.75], [-1.42, -0.75], [-1.42, 0.75]]) k.m(cone(0.05, 0.4, 5), 0x2a2224, T(x, FD + 0.2, z)); skull(k, 1.45, FD + 0.42, 0.75, 1.0, 0, 0xd8ccb8, I.fire); }
  flagstaff(k, -1.4, FD, -0.62, 1.1, { h: 0.24, w: 0.55, kind: 'swallow', col: 0x2a2224, knob: I.trim, knobGeo: cone(0.04, 0.12, 4) });
  heap(k, 0.72, FD, 0, [['crate', 0, -0.35, 1.5, 0.1, 0x4a2a1a], ['cask', 0.0, 0.35, 1.4, 0.0, 0x3a2a1a], ['ingot', -0.1, 0.0, 1.3, 0.2, f === 'ashur' ? I.trim : 0x4a4a52]]);
  heap(k, -1.25, FD, 0, [['cask', 0, 0.0, 1.2, 0, 0x3a2a1a], ['crate', 0.1, -0.3, 1.1, 0.3, 0x4a2a1a]]);
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: 0x3a2a22, shoe: I.trim });
}

// =====================================================================================================
// THE SMALL FOLK
// =====================================================================================================
const patches = (base, cols, seed = 1) => (s, dt, y, j, i) => { const r = rnd(Math.floor(s * 9) * 7 + Math.floor(dt / 0.12) * 13 + seed); return r > 0.72 ? cols[Math.floor(r * 31) % cols.length] : sh(base, Math.floor(dt / 0.07) & 1 ? 0.86 : 1.02); };
function goblinHull(k, C, shp, o = {}) {
  const L = C.L, sk = C.f === 'skar', base = sk ? 0x5a4a3a : L.wood;
  const H = baseHull(k, C, shp, { col: { out: base, strake: 0.07, fn: patches(base, sk ? [COPPER, 0x7a6a4a, 0x4a4038] : [0x8a4a2a, 0x7a7a6a, L.cloth, 0x5a5a48], sk ? 3 : 1), in: sh(base, 0.75), rim: sh(base, 0.6), bottom: 0x2a2420 }, paint: [[0.0, 0.04, sk ? BRASS : 0x8a4a2a, 0.05, 0.95, sk ? 'metal' : 'solid']], owner: [0.1, 0.16, 0.25, 0.7], gun: sh(base, 0.6), floor: sh(base, 1.05), floorO: { step: 0.13 }, ...o });
  for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) { const s = 0.15 + rnd(i * 3 + sd) * 0.7, p = H.at(s, H.aAt(s, 0.08 + rnd(i * 5) * 0.12, sd), -0.012); k.m(box(0.14 + rnd(i) * 0.1, 0.08 + rnd(i * 2) * 0.06, 0.01), [0x6a6a5a, 0x8a4a2a, COPPER][i % 3], T(p[0], p[1], p[2], 0, sd > 0 ? 0 : PI, (rnd(i * 7) - 0.5) * 0.5)); }
  return H;
}
function crookedPole(k, x, y, z, h, col, lean = 0.1) { k.s(sweep([[x, y, z], [x + lean * 0.3, y + h * 0.4, z + 0.02], [x - lean * 0.2, y + h * 0.7, z - 0.02], [x + lean, y + h, z]], 0.02, 5, 10, col), null); }
function goblinGondola(k, C) {
  const L = C.L, sk = C.f === 'skar', G = L.trim;
  const H = goblinHull(k, C, { ...G_SHAPE, B: 0.94, bowRise: 0.22, br: 2, sternRise: 0.12, ex: 2.4, tr: 0.35, ps: 2.6, qs: 0.5, rocker: 0.05 }, { fx0: -1.45, fx1: 1.3 });
  const bt = H.at(0.995, 0.5);
  for (let i = 0; i < 6; i++) k.s(cone(0.024, 0.1, 4), BONE, T(bt[0] - 0.04 - i * 0.05, bt[1] - 0.1, (i & 1 ? 0.06 : -0.06) * (1 + i * 0.4), PI));
  if (sk) { // copper pipes, a gear and a green sight-glass tank
    for (const sd of [-1, 1]) { const pts = []; for (let i = 0; i <= 8; i++) { const s = 0.12 + i * 0.09; pts.push(H.at(s, H.aAt(s, 0.1 + (i % 3 === 1 ? 0.04 : 0), sd), -0.03)); } k.m(sweep(pts, 0.022, 5, 24, COPPER), null); }
    k.m(cyl(0.1, 0.1, 0.32, 10), COPPER, T(1.0, GD + 0.16, -0.18)); k.g(cyl(0.06, 0.06, 0.2, 8), G, T(1.0, GD + 0.18, -0.08)); k.m(hemi(0.1, 10, 3), BRASS, T(1.0, GD + 0.32, -0.18));
    k.m(cyl(0.16, 0.16, 0.03, 12), BRASS, T(-1.48, H.topAt(-1.48) + 0.12, 0, HP)); for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; k.m(box(0.04, 0.04, 0.03), BRASS, T(-1.48 + Math.cos(a) * 0.17, H.topAt(-1.48) + 0.12 + Math.sin(a) * 0.17, 0)); }
    crookedPole(k, bt[0] - 0.12, bt[1] - 0.05, 0, 0.6, 0x3a342c); k.g(ball(0.05, 8, 6), G, T(bt[0] - 0.02, bt[1] + 0.58, 0));
  } else {
    crookedPole(k, bt[0] - 0.12, bt[1] - 0.05, 0, 0.75, L.wood, 0.12); skull(k, bt[0] + 0.0, bt[1] + 0.78, 0, 1.0, 0, BONE); k.add('owner', flagGeo(0.34, 0.22, 'rag'), WHITE, T(bt[0] - 0.02, bt[1] + 0.55, 0));
    k.m(cyl(0.09, 0.1, 0.2, 8), 0x3a3430, T(-1.45, GD + 0.1, 0.12)); k.m(cyl(0.03, 0.03, 0.4, 6), 0x6a5a48, T(-1.48, GD + 0.38, 0.12, 0, 0, 0.15)); k.g(box(0.02, 0.05, 0.06), L.glow, T(-1.355, GD + 0.1, 0.12));
  }
  pole(k, C, [-1.15, GD + 0.9, 0.3], { col: sk ? 0x4a4038 : L.wood, shoe: sk ? BRASS : 0x6a5a48 });
  heap(k, 0.85, GD, 0, [['crate', 0, -0.18, 1.2, 0.3, 0x7a5a36], ['sack', 0.25, 0.1, 1.2, 0.8, 0x8a8a5a], ['barrel', 0.0, 0.2, 1.0, 0, 0x6a5a3a]], H);
  heap(k, -1.25, GD, 0, [['sack', 0, -0.2, 1.0, 0.4, 0x9a8a5a]], H);
  if (sk) flagstaff(k, 0.55, GD, 0.3, 0.8, { h: 0.2, w: 0.4, kind: 'rag', col: 0x3a342c, knob: G, knobGeo: ball(0.035, 6, 5) });
}
function goblinRiver(k, C) {
  const L = C.L, sk = C.f === 'skar', G = L.trim; C.wheel = true;
  const H = goblinHull(k, C, { ...R_SHAPE, x0: -1.72, tr: 0.7, ps: 4, qs: 0.3, ex: 3.2, bowRise: 0.22, sternRise: 0.08 }, { fx0: -1.6, fx1: 1.8 });
  const bt = H.at(0.995, 0.5);
  if (sk) { // a copper boiler house with a spark-spire, pipes everywhere, a green-glowing wheel
    k.m(cyl(0.34, 0.34, 0.9, 12), COPPER, T(0.8, RD + 0.38, 0, 0, 0, HP)); for (const x of [0.45, 0.8, 1.15]) k.m(cyl(0.355, 0.355, 0.04, 12, true), BRASS, T(x, RD + 0.38, 0, 0, 0, HP)); k.g(cyl(0.12, 0.12, 0.02, 10), G, T(1.26, RD + 0.38, 0, 0, 0, HP));
    for (const z of [-0.45, 0.45]) { k.m(cyl(0.09, 0.09, 0.5, 8), 0x3a342c, T(0.62, RD + 0.25, z)); k.g(cyl(0.06, 0.06, 0.3, 8), G, T(0.62, RD + 0.3, z * 1.02)); }
    k.m(cyl(0.05, 0.05, 1.2, 8), 0x3a342c, T(0.9, RD + 1.25, 0)); for (let i = 0; i < 4; i++) k.m(torus(0.09 - i * 0.012, 0.014, 4, 12), COPPER, T(0.9, RD + 1.4 + i * 0.12, 0, HP)); k.g(ball(0.09, 10, 8), G, T(0.9, RD + 1.95, 0));
    for (const sd of [-1, 1]) k.m(sweep([[0.55, RD + 0.5, sd * 0.25], [0.0, RD + 0.55, sd * 0.62], [-1.2, RD + 0.45, sd * 0.62], [-1.75, 0.45, sd * 0.55]], 0.03, 5, 24, COPPER), null);
    paddleWheel(k, C, -1.98, 0.36, 0.46, 1.0, { rim: BRASS, pad: 0x6a5234, hub: COPPER, n: 9, spoke: COPPER, extra: (x, y, R, W) => { for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; k.s(cyl(0.01, 0.01, W * 0.9, 4), 0x8a7a5a, T(x + Math.cos(a) * R * 0.98, y + Math.sin(a) * R * 0.98, 0, HP)); } k.s(ball(0.05, 6, 5), G, T(x, y, W / 2 + 0.1)); } });
  } else { // a ramshackle shack, a crooked stovepipe, a patched sail, and a crank-wheel astern
    cabin(k, 0.48, 1.12, 0.94, 0.6, RD, { wall: 0x6a5234, trim: 0x4a3a24, roof: 'none', winGlow: true, winCol: L.glow, nwin: 1, frame: false });
    k.m(rbox(0.82, 0.04, 1.1, 0.01, 1), 0x7a7a6a, T(0.78, RD + 0.66, 0.02, 0.12, 0, 0.05)); k.m(rbox(0.4, 0.04, 0.5, 0.01, 1), 0x8a4a2a, T(0.95, RD + 0.7, -0.25, 0.1, 0.2, 0.0));
    k.m(cyl(0.05, 0.05, 0.6, 6), 0x5a5a4a, T(0.65, RD + 0.95, 0.2, 0, 0, 0.15)); k.m(cyl(0.05, 0.055, 0.3, 6), 0x8a4a2a, T(0.55, RD + 1.3, 0.2, 0, 0, 0.6)); k.m(cone(0.1, 0.1, 6), 0x5a5a4a, T(0.42, RD + 1.45, 0.2, 0, 0, 0.6));
    crookedPole(k, 1.32, RD, 0, 2.2, L.wood, 0.1);
    sqSail(k, 1.32, 1.3, 2.3, 1.1, (u, v, i, j) => [L.cloth, L.cloth2, 0x8a8a6a, 0x8a4a2a][(i * 3 + j * 5) % 4], { owner: [0.1, 0.22], bil: 0.12, nu: 6, nv: 6, spar: L.wood });
    paddleWheel(k, C, -1.98, 0.36, 0.46, 1.0, { rim: 0x5a4a3a, pad: 0x7a5a36, hub: 0x8a4a2a, n: 7, spoke: L.wood });
    skull(k, bt[0] + 0.02, bt[1] + 0.06, 0, 1.6, 0, BONE); for (let i = 0; i < 7; i++) k.s(cone(0.03, 0.12, 4), BONE, T(bt[0] - 0.06 - i * 0.06, bt[1] - 0.12, (i & 1 ? 0.09 : -0.09) * (1 + i * 0.5), PI));
  }
  for (const sz of [-1, 1]) { k.s(rbox(0.7, 0.08, 0.08, 0.02, 1), sk ? 0x3a342c : L.wood, T(-1.72, 0.44, sz * 0.62, 0, 0, -0.12)); k.m(cyl(0.07, 0.07, 0.1, 8), sk ? BRASS : 0x5a4a3a, T(-1.98, 0.36, sz * 0.62, HP)); }
  k.s(rbox(0.06, 0.6, 0.06, 0.02, 1), sh(L.wood, 0.8), T(-1.62, RD + 0.3, 0.5)); k.m(cyl(0.03, 0.03, 0.5, 6), 0x5a5a4a, T(-1.62, RD + 0.6, 0.25, HP)); k.s(cyl(0.025, 0.025, 0.2, 5), 0x4a3424, T(-1.62, RD + 0.72, 0.0));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1]]) { const p = H.side(sx * 1.6, sz, 0.02, -0.02); k.m(cone(0.03, 0.2, 4), sk ? BRASS : 0x6a5a48, TA(p, [sx * 0.3, 0.5, sz])); }
  flagstaff(k, sk ? 1.35 : -1.45, RD, sk ? 0.42 : -0.55, 1.1, { h: 0.24, w: 0.5, kind: 'rag', col: sk ? 0x3a342c : L.wood, knob: sk ? G : BONE, knobGeo: ball(0.04, 6, 5) });
  lampPost(k, -1.55, RD, -0.62, 0.8, sk ? G : L.glow, 0x3a342c, 1);
  heap(k, 1.6, RD, 0, [['crate', 0, -0.3, 1.4, 0.3, 0x7a5a36], ['barrel', 0.0, 0.3, 1.4, 0, 0x6a5a3a], ['sack', 0.3, 0.0, 1.3, 0.8, 0x8a8a5a], ['crate', 0.0, -0.28, 1.1, -0.3, 0x8a6a42, 0.28]], H);
  heap(k, -1.38, RD, 0, [['barrel', 0, -0.52, 1.2, 0, 0x6a5a3a], ['sack', 0.05, 0.52, 1.1, 0.5, 0x9a8a5a]], H);
}
function goblinRaft(k, C) {
  const L = C.L, sk = C.f === 'skar', G = L.trim;
  if (sk) for (const z of [-0.5, 0.5]) { k.m(cyl(0.22, 0.22, 2.6, 12), COPPER, T(0, 0.1, z, 0, 0, HP)); for (const sx of [-1, 1]) k.m(hemi(0.22, 12, 4), COPPER, T(sx * 1.3, 0.1, z, 0, 0, -sx * HP)); for (const x of [-0.9, 0, 0.9]) k.m(cyl(0.23, 0.23, 0.05, 12, true), BRASS, T(x, 0.1, z, 0, 0, HP)); }
  else for (const [x, z, r] of [[-1.0, -0.5, 0.2], [0.05, -0.55, 0.24], [1.0, -0.45, 0.19], [-0.95, 0.52, 0.23], [0.1, 0.5, 0.2], [1.05, 0.55, 0.22]]) { k.push(T(x, 0.1, z, 0, rnd(x * 7 + z) * 0.4, HP)); k.s(rev([[0, -0.4], [r * 0.85, -0.4], [r, -0.2], [r * 1.05, 0], [r, 0.2], [r * 0.85, 0.4], [0, 0.4]], 10, sh(0x6a5a3a, 0.85 + rnd(x + z) * 0.3)), null); k.m(cyl(r * 1.06, r * 1.06, 0.04, 10, true), 0x5a5a4a, T(0, -0.25, 0)); k.m(cyl(r * 1.06, r * 1.06, 0.04, 10, true), 0x5a5a4a, T(0, 0.25, 0)); k.pop(); }
  for (let i = 0; i < 15; i++) { const w = 1.35 + rnd(i) * 0.35; k.s(box(0.16, 0.04, w), sh(sk ? 0x5a4a3a : L.wood, 0.8 + rnd(i * 3) * 0.35), T(-1.32 + i * 0.19, FD - 0.02 + (rnd(i * 5) - 0.5) * 0.02, (rnd(i * 2) - 0.5) * 0.15, (rnd(i * 4) - 0.5) * 0.06, 0, 0)); }
  k.o(box(1.8, 0.1, 0.012), WHITE, T(0, FD - 0.06, 0.78)); k.o(box(1.8, 0.1, 0.012), WHITE, T(0, FD - 0.06, -0.78));
  if (sk) { k.m(cyl(0.12, 0.12, 0.45, 10), 0x3a342c, T(1.2, FD + 0.22, 0.45)); k.g(cyl(0.08, 0.08, 0.3, 8), G, T(1.2, FD + 0.25, 0.45)); k.m(sweep([[1.2, FD + 0.45, 0.45], [1.2, FD + 0.7, 0.3], [0.8, FD + 0.6, -0.1], [0.6, FD + 0.1, -0.6]], 0.025, 5, 16, COPPER), null); crookedPole(k, -1.4, FD, -0.6, 1.2, 0x3a342c); k.g(ball(0.06, 8, 6), G, T(-1.3, FD + 1.24, -0.6)); k.o(flagGeo(0.4, 0.24, 'rag'), WHITE, T(-1.33, FD + 1.05, -0.6)); }
  else { crookedPole(k, -1.4, FD, -0.6, 1.3, L.wood, 0.1); skull(k, -1.3, FD + 1.34, -0.6, 1.0, 0, BONE); k.o(flagGeo(0.42, 0.26, 'rag'), WHITE, T(-1.33, FD + 1.08, -0.6)); for (const [x, z] of [[1.45, 0.7], [1.45, -0.7], [1.5, 0]]) k.m(cone(0.03, 0.26, 4), 0x6a5a48, T(x, FD + 0.06, z, 0, 0, -1.2)); crookedPole(k, 1.3, FD, 0.65, 0.8, L.wood, -0.12); k.rod('solid', 0x3a3024, [1.18, FD + 0.8, 0.65], [1.18, FD + 0.68, 0.65], 0.006, 3); k.g(cyl(0.05, 0.045, 0.1, 8), L.glow, T(1.18, FD + 0.62, 0.65)); }
  heap(k, 0.8, FD, 0, [['crate', 0, -0.3, 1.4, 0.3, 0x7a5a36], ['barrel', 0.3, 0.2, 1.4, 0, 0x6a5a3a], ['sack', 0.0, 0.25, 1.3, 0.8, 0x8a8a5a], ['crate', 0.02, -0.28, 1.0, -0.3, 0x8a6a42, 0.28]]);
  heap(k, -1.25, FD, 0, [['sack', 0, 0.0, 1.2, 0.4, 0x9a8a5a], ['barrel', 0.12, 0.3, 1.0, 0, 0x6a5a3a]]);
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: sk ? 0x4a4038 : L.wood, shoe: sk ? BRASS : 0x6a5a48 });
}

// =====================================================================================================
// THE SAVAGE PEOPLES: dugouts, skin boats, reed boats, leaves, flesh and floating stone
// =====================================================================================================
const JADE = 0x2ab88a, FEATHER = [0x2a9a5a, 0xc82a2a, 0x2a6ac8, 0xe8c040];
const SV = {
  beasts: { type: 'skin', gType: 'dugout', hide: 0x7a5434, wood: 0x6a4e30, paint: 0xa83a2a, bone: BONE },
  cloven: { type: 'dugout', gType: 'dugout', hide: 0x3a2a22, wood: 0x5a4028, paint: 0x8a1a1a, bone: 0xd8ccb0 },
  fimbul: { type: 'skin', gType: 'skin', hide: 0xc8c0b0, wood: 0x8a8070, paint: 0x4a6a8a, bone: 0xf0ece0 },
  gorge: { type: 'skin', gType: 'skin', hide: 0x8a3a2a, wood: 0x6a5038, paint: 0x2a4a8a, bone: 0xe0d0b0, felt: [0x8a2a1a, 0x2a4a8a, 0xd8c8a0, 0x3a6a3a] },
  dragons: { type: 'scale', gType: 'scale', hide: 0x8a3a2a, wood: 0x4a3024, paint: 0xd8a030, bone: 0xe0d4b8 },
  verdant: { type: 'leaf', gType: 'leaf', hide: 0x4a8a3a, wood: 0x5a4a2a, paint: 0xe8a0c0, bone: 0xf0e8c8 },
  screaming: { type: 'flesh', gType: 'flesh', hide: 0xb86a7a, wood: 0x5a2a3a, paint: 0x6a1a5a, bone: 0xe8d8c0 },
  xibalba: { type: 'reed', gType: 'reed', hide: 0xc8b070, wood: 0x6a4a2a, paint: JADE, bone: GOLD },
  greenhide: { type: 'dugout', gType: 'dugout', hide: 0x4a4238, wood: 0x5a4a32, paint: 0x8a1a14, bone: 0xd8d0b8 },
  mistisles: { type: 'dugout', gType: 'dugout', hide: 0x5a8a9a, wood: 0x7a5a3a, paint: 0x2a8a8a, bone: 0xe8e0c8 },
  elemental: { type: 'stone', gType: 'stone', hide: 0x7a7a82, wood: 0x5a5a62, paint: 0x8ad8ff, bone: 0xc8c8d0 },
};
const svOf = (C) => ({ ...SV[C.f] || SV.beasts, glow: C.L.glow });
function savColor(type, S) {
  switch (type) {
    case 'dugout': return { out: S.wood, strake: 0, fn: (s, dt, y, j, i) => sh(S.wood, 0.8 + 0.35 * rnd(i * 7 + j * 3)), in: sh(S.wood, 0.7), rim: sh(S.wood, 1.15), bottom: sh(S.wood, 0.55) };
    case 'skin': return { out: S.hide, strake: 0, fn: (s, dt, y, j, i) => (Math.floor(s * 44) % 5 === 0 ? sh(S.hide, 0.6) : sh(S.hide, 0.92 + 0.16 * rnd(Math.floor(s * 9) + i * 3))), in: sh(S.hide, 0.7), rim: S.wood, bottom: sh(S.hide, 0.6) };
    case 'scale': return { out: S.hide, strake: 0, fn: (s, dt, y, j, i) => sh(S.hide, ((i + (j & 1)) & 1) ? 0.78 : 1.08 + (dt < 0.1 ? 0.1 : 0)), in: sh(S.hide, 0.6), rim: S.bone, bottom: sh(S.hide, 0.7) };
    case 'leaf': return { out: S.hide, strake: 0, fn: (s, dt, y, j, i) => ((j + Math.abs(i - 8)) % 6 === 0 ? sh(S.hide, 1.35) : sh(S.hide, 0.9 + (dt < 0.05 ? 0.25 : 0))), in: (s, y, j, i) => ((j + Math.abs(i - 25)) % 6 === 0 ? sh(S.hide, 1.4) : sh(S.hide, 1.12)), rim: sh(S.hide, 0.7), bottom: (s, y, j, i) => (i === 7 || i === 8 ? 0xc8d890 : sh(S.hide, 0.8)), wl: -0.02 };
    case 'flesh': return { out: S.hide, strake: 0, fn: (s, dt, y, j, i) => { const r = rnd(i * 13 + j * 7); return r > 0.85 ? 0x8a2a4a : r > 0.6 ? sh(S.hide, 0.85) : S.hide; }, in: 0x6a1a3a, rim: 0x8a3a5a, bottom: sh(S.hide, 0.7), wl: -0.05 };
    default: return { out: S.hide };
  }
}
/** the hull of a savage boat in its people's manner */
function savHull(k, C, S, type, shp, o = {}) {
  if (type === 'reed') { // bundles of reed along the hull's lines, bound with cord
    const H = shape({ ...shp, th: 0.05 });
    const n = o.bundles ?? 5;
    for (let b = 0; b < n; b++) { const a = 0.06 + (0.88 * b) / (n - 1), pts = []; for (let i = 0; i <= 12; i++) pts.push(H.at(0.01 + 0.98 * sv(i / 12), a, 0.05)); reedBundle(k, pts, (v) => (o.r ?? 0.09) * (0.45 + 0.55 * Math.sin(PI * Math.min(1, v * 1.04 + 0.01))), S.hide, 8, sh(S.wood, 0.9), 30); }
    floor(k, H, H.x0 + 0.35, H.x1 - 0.4, C.deck, 0xa89058, { step: 0.12 });
    return H;
  }
  if (type === 'stone') { // a floating slab of rock
    const H = shape({ ...shp, ex: 8, pb: 3, ps: 3, qb: 0.4, qs: 0.4 });
    const top = C.deck;
    for (let i = 0; i < 14; i++) { const x = H.x0 + 0.15 + ((H.x1 - H.x0 - 0.3) * i) / 13, hw = H.hw(H.s(x)); if (hw < 0.08) continue; k.s(rbox(0.3, 0.18 + rnd(i) * 0.06, hw * 2, 0.04, 1), sh(S.hide, 0.8 + rnd(i * 3) * 0.3), T(x, top - 0.1 - rnd(i) * 0.03, 0, 0, 0, (rnd(i * 5) - 0.5) * 0.08), true); k.s(dodec(hw * 0.7), sh(S.hide, 0.7 + rnd(i * 7) * 0.2), T(x, top - 0.26, 0, rnd(i) * 3, rnd(i * 2) * 3, 0, 1.2, 0.5, 1.1), true); }
    for (let i = 0; i < 10; i++) { const x = H.x0 + 0.3 + ((H.x1 - H.x0 - 0.6) * i) / 9, hw = H.hw(H.s(x)); k.s(box(0.2, 0.02, hw * 1.7), sh(S.hide, 1.15 + rnd(i) * 0.1), T(x, top - 0.005, 0), true); }
    for (let i = 0; i < (o.shards ?? 8); i++) { const r = rnd(i * 9.1 + 3), x = H.x0 + 0.2 + (H.x1 - H.x0 - 0.4) * r, sd = i & 1 ? 1 : -1, hw = H.hw(H.s(x)); k.g(oct(0.06 + rnd(i) * 0.05), S.paint, T(x, top - 0.12, sd * (hw + 0.02), 0, 0, sd * 0.9, 0.7, 2.2, 0.7)); }
    k.g(box((H.x1 - H.x0) * 0.8, 0.012, 0.04), S.paint, T((H.x0 + H.x1) / 2, top - 0.2, H.B * 0.42)); k.g(box((H.x1 - H.x0) * 0.8, 0.012, 0.04), S.paint, T((H.x0 + H.x1) / 2, top - 0.2, -H.B * 0.42));
    for (let i = 0; i < 6; i++) k.s(dodec(0.06 + rnd(i) * 0.04), sh(S.hide, 0.9), T(H.x0 + 0.4 + i * (H.x1 - H.x0 - 0.8) / 5, -0.05 - rnd(i) * 0.1, (rnd(i * 3) - 0.5) * H.B * 0.4), true);
    k.o(box((H.x1 - H.x0) * 0.6, 0.05, 0.012), WHITE, T((H.x0 + H.x1) / 2, top - 0.08, H.B / 2 + 0.01)); k.o(box((H.x1 - H.x0) * 0.6, 0.05, 0.012), WHITE, T((H.x0 + H.x1) / 2, top - 0.08, -H.B / 2 - 0.01));
    return { ...H, halfAt: (x) => H.hw(H.s(x)) * 0.9 + 0.12, th: 0 };
  }
  const H = baseHull(k, C, { th: type === 'dugout' ? 0.07 : 0.035, ...shp }, { col: savColor(type, S), owner: o.owner ?? [0.1, 0.15, 0.25, 0.75], gun: type === 'dugout' ? sh(S.wood, 1.1) : type === 'leaf' ? sh(S.hide, 0.75) : type === 'flesh' ? 0x7a2a4a : S.wood, gunR: type === 'dugout' ? 0.03 : 0.024, floor: type === 'leaf' ? sh(S.hide, 1.2) : type === 'flesh' ? 0x8a3a5a : sh(S.wood, 1.2), floorO: { step: 0.14 }, ...o });
  if (type === 'skin' || type === 'scale') ribs(k, H, o.ribs ?? [-1.1, -0.6, -0.1, 0.4, 0.9], S.bone, 0.016);
  if (type === 'skin') for (const sd of [-1, 1]) for (let i = 0; i < 14; i++) { const s = 0.1 + i * 0.058, p = H.at(s, sd > 0 ? 1 : 0, -0.02); k.s(cyl(0.006, 0.006, 0.12, 3), 0x3a2a1a, T(p[0], p[1] - 0.05, p[2], sd * 0.3, 0, 0)); }
  return H;
}
/** a figure at the bow or stern for each people, standing at p facing dir (+1 forward, -1 aft) */
function savFigure(k, C, S, p, s, dir = 1) {
  const f = C.f, [x, y, z] = p;
  k.push(T(x, y, z, 0, dir > 0 ? 0 : PI, 0, s));
  switch (f) {
    case 'beasts': skull(k, 0.02, 0.06, 0, 1.4, 0, S.bone, null, 1.0, 0xd8c8a0); for (let i = 0; i < 6; i++) k.s(box(0.02, 0.18 + rnd(i) * 0.08, 0.05), sh(S.hide, 0.9), T(-0.05, -0.08, -0.12 + i * 0.05, 0, 0, 0.1)); break;
    case 'cloven': for (const sz of [-1, 1]) k.s(sweep([[0, 0, sz * 0.04], [0.04, 0.16, sz * 0.14], [-0.08, 0.32, sz * 0.2], [-0.16, 0.2, sz * 0.22], [-0.08, 0.12, sz * 0.18], [0.0, 0.2, sz * 0.16]], (v) => 0.045 * (1 - v * 0.8), 6, 16, 0x3a2a22), null); skull(k, 0.04, 0.02, 0, 1.0, 0, S.bone); k.s(box(0.03, 0.2, 0.2), S.paint, T(-0.05, -0.12, 0)); break;
    case 'fimbul': for (const sz of [-1, 1]) k.s(sweep([[-0.05, -0.05, sz * 0.06], [0.15, -0.1, sz * 0.12], [0.35, 0.05, sz * 0.12], [0.42, 0.25, sz * 0.05]], (v) => 0.04 * (1 - v * 0.7), 6, 12, 0xf0e8d8), null); k.s(ball(0.1, 8, 6), 0x9a7a5a, T(0, 0.05, 0, 0, 0, 0, 1.2, 1, 1)); k.m(cone(0.02, 0.12, 4), 0xd8f0ff, T(0.04, -0.06, 0.04, PI)); break;
    case 'gorge': k.s(cyl(0.04, 0.04, 0.3, 6), S.wood, T(0, 0.1, 0)); for (const sz of [-1, 1]) k.s(sweep([[0, 0.25, sz * 0.03], [0, 0.28, sz * 0.2], [0.04, 0.4, sz * 0.32], [0.02, 0.5, sz * 0.3]], (v) => 0.04 * (1 - v * 0.8), 6, 12, 0x2a2420), null); k.s(ball(0.07, 8, 6), 0x3a2a20, T(0.02, 0.26, 0, 0, 0, 0, 1.3, 1, 1)); for (let i = 0; i < 4; i++) k.s(cone(0.025, 0.14, 5), S.felt[i], T(-0.02, 0.12, -0.08 + i * 0.05, PI)); break;
    case 'dragons': dragonHead(k, 0.05, 0.1, 0, 1.3, S.bone, { belly: sh(S.bone, 0.85), horn: 0x3a2a22, eye: C.L.glow, whisker: false }); break;
    case 'verdant': k.s(sweep([[-0.1, -0.05, 0], [0.05, 0.1, 0], [0.0, 0.3, 0], [-0.12, 0.32, 0], [-0.08, 0.22, 0]], (v) => 0.05 * (1 - v * 0.6), 6, 14, sh(S.hide, 0.8)), null); lotus(k, 0.02, 0.33, 0, 1.1, S.paint, 0xf8e8f0, 7); k.g(ball(0.04, 8, 6), C.L.glow, T(0.02, 0.4, 0)); for (let i = 0; i < 4; i++) k.s(leaf(0.18, 0.08, 0.2, sh(S.hide, 1.1), { nv: 4 }), null, T(0, 0.05, 0, 0.6, i * HP, 0)); break;
    case 'screaming': k.s(ball(0.14, 10, 8), S.hide, T(0, 0.05, 0, 0, 0, 0, 1.2, 1, 1)); k.s(ball(0.1, 8, 6), 0x4a0a1a, T(0.1, 0.02, 0, 0, 0, 0, 0.7, 0.8, 0.9)); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; k.s(cone(0.018, 0.07, 4), S.bone, T(0.16, 0.02 + Math.sin(a) * 0.07, Math.cos(a) * 0.07, 0, 0, -HP)); } for (let i = 0; i < 5; i++) eyeball(k, [-0.02 + (i % 2) * 0.06, 0.14 + (i % 3) * 0.04, -0.08 + i * 0.04], [0.6, 0.6, (i - 2) * 0.2], 0.035, C.L.glow); for (let i = 0; i < 4; i++) k.s(sweep([[-0.08, -0.02, -0.1 + i * 0.07], [-0.15, -0.12, -0.12 + i * 0.08], [-0.05, -0.22, -0.1 + i * 0.07]], (v) => 0.025 * (1 - v * 0.8), 5, 8, sh(S.hide, 0.8)), null); break;
    case 'xibalba': dragonHead(k, 0.05, 0.1, 0, 1.3, GOLD, { belly: JADE, horn: JADE, mane: 0x2a9a5a, eye: 0x6affd0 }); for (let i = 0; i < 5; i++) k.s(leaf(0.3, 0.07, 0.2, FEATHER[i % 4], { nv: 4 }), null, T(-0.12, 0.12, -0.1 + i * 0.05, 0, HP, 1.3 - i * 0.05)); break;
    case 'greenhide': k.m(cone(0.07, 0.35, 5), 0x5a5a4a, T(0.15, -0.05, 0, 0, 0, -HP)); skull(k, 0.0, 0.12, 0, 1.2, 0, S.bone, null, 0.5, 0x3a3428); for (let i = 0; i < 4; i++) k.m(cone(0.025, 0.16, 4), 0x5a5a4a, T(-0.04, 0.05 - i * 0.05, (i & 1 ? 0.1 : -0.1), (i & 1 ? -1 : 1) * 1.2, 0, 0)); break;
    case 'mistisles': k.s(sweep([[-0.15, -0.08, 0], [0.05, 0.05, 0], [0.0, 0.3, 0], [0.12, 0.5, 0], [0.22, 0.52, 0]], (v) => 0.06 - v * 0.02, 7, 16, S.hide), null); dragonHead(k, 0.24, 0.53, 0, 0.75, S.hide, { belly: 0xe8e0c8, horns: false, whisker: false, mane: S.paint }); k.s(slab([[0, 0], [0.12, 0.22], [0.02, 0.4], [-0.1, 0.25]], 0.01), S.paint, T(-0.05, 0.1, 0)); break;
    case 'elemental': for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; k.g(oct(0.05 + (i % 2) * 0.03), S.paint, T(Math.cos(a) * 0.05, 0.12 + (i % 3) * 0.06, Math.sin(a) * 0.06, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, 0.7, 2.6, 0.7)); } k.g(oct(0.08), mix(S.paint, 0xffffff, 0.4), T(0.02, 0.28, 0, 0, 0, 0, 0.8, 3, 0.8)); break;
    default: break;
  }
  k.pop();
}
/** savage paddles: blade shapes for each people */
const paddleOpts = (S, f) => ({ shaft: f === 'elemental' ? 0x6a6a72 : S.wood, bcol: f === 'screaming' ? S.hide : f === 'dragons' ? S.bone : f === 'xibalba' ? JADE : sh(S.wood, 1.2), lockCol: S.bone, bw: 0.15, bl: 0.32 });
function savGondola(k, C) {
  const L = C.L, f = C.f, S = svOf(C), type = S.gType;
  const shp = { ...G_SHAPE, B: 0.84, bowRise: 0.12, sternRise: 0.1, br: 2, sr: 2, pb: 2.6, ps: 2.6, qb: 0.5, qs: 0.5, ex: 2.3, rocker: 0.04 };
  if (type === 'leaf') Object.assign(shp, { bowRise: 0.55, sternRise: 0.45, br: 2.2, sr: 2.2, pb: 1.6, ps: 1.6, ex: 1.7, rocker: 0.15 });
  if (type === 'reed') Object.assign(shp, { bowRise: 0.5, sternRise: 0.4, br: 2.2, sr: 2.2, pb: 1.8, ps: 1.8, ex: 2.2, rocker: 0.12 });
  if (type === 'skin' || type === 'scale') Object.assign(shp, { bowRise: 0.18, sternRise: 0.12, ex: 2.8, pb: 2.0, ps: 2.0 });
  if (type === 'stone') Object.assign(shp, { B: 0.9 });
  const H = savHull(k, C, S, type, shp, { fx0: -1.45, fx1: 1.32 });
  const bt = type === 'stone' ? [H.x1 - 0.1, GD, 0] : H.at(0.995, 0.5), st = type === 'stone' ? [H.x0 + 0.1, GD, 0] : H.at(0.005, 0.5);
  savFigure(k, C, S, [bt[0] - 0.05, bt[1] - 0.02, 0], 1.0, 1);
  if (f === 'mistisles') { // an outrigger to starboard
    for (const x of [-0.5, 0.5]) k.s(sweep([[x, H.topAt(x), 0.3], [x, H.topAt(x) + 0.08, 0.7], [x, 0.12, 1.1]], 0.025, 5, 8, S.wood), null);
    const O = shape({ x0: -0.95, x1: 0.95, B: 0.18, draft: 0.06, free: 0.08, bowRise: 0.06, ex: 2, th: 0.02 }); k.push(T(0, 0, 1.12)); shell(k, O, hcol(O, { out: S.wood, strake: 0, in: S.wood }), { m: 6, nv: 14 }); k.pop();
    savFigure(k, C, S, [st[0] + 0.1, st[1] - 0.04, 0], 0.7, -1);
  }
  if (f === 'fimbul') icicles(k, H, 12);
  if (f === 'gorge') for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) { const s = 0.2 + i * 0.1, p = H.at(s, H.aAt(s, 0.06, sd), -0.012); k.s(slab([[-0.08, 0], [0.08, 0], [0.05, -0.1], [0, -0.14], [-0.05, -0.1]], 0.006), S.felt[i % 4], T(p[0], p[1], p[2], 0, sd > 0 ? 0 : PI, 0)); }
  if (f === 'cloven' || f === 'beasts') for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) { const s = 0.25 + i * 0.12, p = H.at(s, H.aAt(s, 0.05, sd), -0.015); k.s(box(0.1, 0.03, 0.006), S.paint, T(p[0], p[1], p[2], 0, sd > 0 ? 0 : PI, 0.5)); k.s(box(0.1, 0.03, 0.006), S.paint, T(p[0], p[1] - 0.06, p[2], 0, sd > 0 ? 0 : PI, -0.5)); }
  if (f === 'greenhide') spikes(k, H, 0.03, 0x5a5a4a, 7, 0.16, 0.15, 0.85);
  if (f === 'screaming') for (const sd of [-1, 1]) for (let i = 0; i < 5; i++) { const s = 0.2 + i * 0.14, p = H.side(H.x(s), sd, 0.1, -0.03); eyeball(k, p, [0.2, 0.1, sd], 0.05, L.glow); }
  if (f === 'dragons') for (const sd of [-1, 1]) { const p = H.side(0.1, sd, 0.02, -0.02); wing(k, T(p[0], p[1] + 0.02, p[2], 0, sd > 0 ? 0 : PI, 0.2).multiply(T(0, 0, 0, 0, 0, PI * 0.82)), 0.7, 0.55, 3, sh(S.hide, 0.7), S.bone); }
  if (f === 'verdant') { for (const sd of [-1, 1]) garland(k, [H.side(-1.2, sd, 0, -0.02), [-0.3, H.topAt(-0.3) - 0.06, sd * 0.44], H.side(0.8, sd, 0, -0.02)], 0x3a7a2a, 14, 0.03); for (const x of [-0.9, 0.7]) lotus(k, x, H.topAt(x) - 0.02, (x > 0 ? 1 : -1) * 0.35, 0.6, S.paint, 0xf8e8f0, 6); }
  if (f === 'xibalba') { for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) { const p = H.side(-0.9 + i * 0.5, sd, 0.06, -0.03); k.m(cyl(0.04, 0.04, 0.02, 8), GOLD, TA(p, [0, 0, sd])); k.s(cyl(0.022, 0.022, 0.024, 6), JADE, TA(p, [0, 0, sd])); } savFigure(k, C, S, [st[0] + 0.05, st[1] - 0.04, 0], 0.7, -1); }
  if (f === 'elemental') { for (const [x, z] of [[-1.3, 0.3], [0.9, -0.3], [0.95, 0.32]]) k.g(oct(0.07), S.paint, T(x, GD + 0.1, z, 0, 0, 0, 0.7, 2.4, 0.7)); }
  // the boatman's pole, or a paddle
  pole(k, C, [-1.15, GD + 0.9, 0.3], { col: f === 'elemental' ? 0x6a6a72 : S.wood, shoe: f === 'elemental' ? S.paint : S.bone, deco: f === 'elemental' ? (top) => k.g(oct(0.05), S.paint, T(top[0], top[1], top[2], 0, 0, 0, 1, 1.8, 1)) : null });
  const cg = { beasts: [['hide', 0, -0.1, 1.3, 0.1], ['meat', 0.26, 0.1, 1.2, 0.3], ['gourd', 0.0, 0.18, 1.0]], cloven: [['hide', 0, -0.1, 1.3, 0.1, 0x3a2a22], ['meat', 0.26, 0.1, 1.2, 0.3], ['basket', 0.0, 0.18, 1.0]], fimbul: [['hide', 0, -0.1, 1.3, 0.1, 0xd8d0c0], ['meat', 0.26, 0.1, 1.2, 0.3, 0xb87a6a], ['cask', 0.0, 0.18, 1.0]], gorge: [['bale', 0, -0.1, 1.2, 0.1, 0x8a2a1a], ['gourd', 0.26, 0.1, 1.2], ['hide', 0.0, 0.18, 1.0, 0, 0x2a4a8a]], dragons: [['chest', 0, -0.1, 1.2, 0.1, 0x4a3024], ['meat', 0.26, 0.1, 1.2, 0.3], ['ingot', 0.0, 0.18, 1.0, 0, GOLD]], verdant: [['gourd', 0, -0.1, 1.3, 0, 0x8aa83a], ['basket', 0.26, 0.1, 1.2, 0, 0x8a7a3a], ['bundle', 0.0, 0.18, 1.0, 0, 0x5a8a3a]], screaming: [['meat', 0, -0.1, 1.4, 0.1, 0x9a3a4a], ['jar', 0.26, 0.1, 1.2, 0, 0x5a1a3a], ['meat', 0.0, 0.18, 1.1, 1.2, 0x8a2a4a]], xibalba: [['basket', 0, -0.1, 1.3, 0, 0xc8a050], ['jar', 0.26, 0.1, 1.2, 0, JADE], ['bundle', 0.0, 0.18, 1.0, 0, 0xc82a2a]], greenhide: [['crate', 0, -0.1, 1.2, 0.3, 0x5a4a32], ['meat', 0.26, 0.1, 1.2, 0.3], ['sack', 0.0, 0.18, 1.0, 0.4, 0x7a6a4a]], mistisles: [['basket', 0, -0.1, 1.3, 0, 0xb08a4e], ['gourd', 0.26, 0.1, 1.2, 0, 0x9a8a4a], ['bundle', 0.0, 0.18, 1.0, 0, 0x4a6a5a]], elemental: [['ore', 0, -0.1, 1.3, 0, 0x8ad8ff], ['ore', 0.26, 0.1, 1.2, 0, 0x7a7a82], ['crate', 0.0, 0.18, 1.0, 0.2, 0x6a6a72]] }[f] || [['hide', 0, 0, 1.2]];
  heap(k, 0.9, GD, 0, cg, H); heap(k, -1.5, GD + 0.03, 0, [cg[2]], H);
  flagstaff(k, 0.62, GD, -0.28, 0.85, { h: 0.2, w: 0.42, kind: f === 'greenhide' ? 'rag' : 'point', col: S.wood, knob: S.bone, knobGeo: f === 'elemental' ? oct(0.045) : cone(0.03, 0.1, 5) });
}
/** a ridge tent of hide or felt over the cabin zone */
function tent(k, x0, x1, y, w, h, col, pole) { const cx = (x0 + x1) / 2; for (const sd of [-1, 1]) k.c(surf(6, 4, (u, v, out) => { out[0] = x0 + (x1 - x0) * u; out[1] = y + h - v * h + Math.sin(PI * u) * 0.02 * v; out[2] = sd * (v * w / 2 + 0.02 * Math.sin(PI * v)); }, (u, v, i, j) => sh(col, (i + j) & 1 ? 0.88 : 1))); for (const x of [x0 - 0.02, x1 + 0.02]) for (const sd of [-1, 1]) k.rod('solid', pole, [x, y, sd * w / 2], [x, y + h + 0.12, -sd * 0.08], 0.018, 5); void cx; }
function savRiver(k, C) {
  const L = C.L, f = C.f, S = svOf(C), type = S.type;
  const shp = { ...R_SHAPE, tr: 0, ps: 2.2, pb: 2.2, qs: 0.55, qb: 0.55, bowRise: 0.2, sternRise: 0.16, br: 2, sr: 2, ex: 2.8, dp: 3 };
  if (type === 'leaf') Object.assign(shp, { bowRise: 0.75, sternRise: 0.6, pb: 1.6, ps: 1.6, ex: 1.8, rocker: 0.18 });
  if (type === 'reed') Object.assign(shp, { bowRise: 0.7, sternRise: 0.55, pb: 1.8, ps: 1.8, ex: 2.2, rocker: 0.15 });
  if (type === 'flesh') Object.assign(shp, { ex: 2.4, bowRise: 0.3 });
  if (type === 'dugout') Object.assign(shp, { B: 1.3, ex: 2.4, bowRise: 0.28, sternRise: 0.22 });
  const H = savHull(k, C, S, type, shp, { fx0: -1.85, fx1: 1.82, bundles: 7, r: 0.11, shards: 12, ribs: [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5] });
  const bt = type === 'stone' ? [H.x1 - 0.1, RD, 0] : H.at(0.995, 0.5), st = type === 'stone' ? [H.x0 + 0.1, RD, 0] : H.at(0.005, 0.5), mx = 1.3;
  savFigure(k, C, S, [bt[0] - 0.06, bt[1] - 0.02, 0], 1.45, 1);
  if (['beasts', 'cloven', 'xibalba', 'mistisles', 'dragons', 'greenhide'].includes(f)) savFigure(k, C, S, [st[0] + 0.08, st[1] - 0.04, 0], 1.0, -1);
  // the shelter amidships-forward
  switch (f) {
    case 'beasts': case 'fimbul': tent(k, 0.5, 1.1, RD, 0.95, 0.62, f === 'fimbul' ? 0xd8d0c0 : sh(S.hide, 1.15), S.wood); if (f === 'beasts') skull(k, 1.14, RD + 0.72, 0, 1.0, 0, S.bone, null, 1.0); break;
    case 'cloven': for (const [x, z] of [[0.5, -0.45], [0.5, 0.45], [1.1, -0.45], [1.1, 0.45]]) { k.rod('solid', S.wood, [x, RD, z], [x, RD + 0.95, z], 0.025, 5); for (const sz of [-1, 1]) k.s(sweep([[x, RD + 0.95, z], [x, RD + 1.02, z + sz * 0.1], [x, RD + 0.94, z + sz * 0.16]], 0.02, 4, 6, S.bone), null); } k.c(surf(6, 4, (u, v, out) => { out[0] = 0.46 + u * 0.68; out[1] = RD + 0.95 - Math.sin(PI * v) * 0.08; out[2] = -0.5 + v; }, (u, v, i) => (i & 1 ? S.paint : sh(S.hide, 1.4)))); break;
    case 'gorge': { k.c(rev([[0.44, 0], [0.45, 0.42], [0.42, 0.46], [0.1, 0.72], [0.0, 0.74]], 14, (u, v, i, j) => (j === 1 ? S.felt[i % 4] : j === 0 ? 0xd8c8a0 : 0x8a2a1a)), null, T(0.8, RD, 0)); k.s(box(0.012, 0.36, 0.2), 0x8a2a1a, T(0.8 - 0.452, RD + 0.18, 0)); k.s(cyl(0.08, 0.08, 0.06, 8), S.wood, T(0.8, RD + 0.76, 0)); for (const sz of [-1, 1]) k.s(sweep([[0.8, RD + 0.78, sz * 0.05], [0.8, RD + 0.86, sz * 0.25], [0.84, RD + 1.0, sz * 0.36]], (v) => 0.04 * (1 - v * 0.8), 5, 8, 0x2a2420), null); break; }
    case 'dragons': tent(k, 0.5, 1.1, RD, 0.95, 0.55, sh(S.hide, 0.9), S.bone); break;
    case 'verdant': for (const x of [0.5, 0.8, 1.1]) { k.s(sweep([[x, RD, -0.48], [x, RD + 0.7, -0.42], [x, RD + 1.0, 0], [x, RD + 0.7, 0.42], [x, RD, 0.48]], 0.03, 5, 16, S.wood), null); for (let i = 0; i < 5; i++) { const a = (i / 4) * PI; k.s(leaf(0.24, 0.12, 0.2, i & 1 ? sh(S.hide, 1.1) : S.hide, { nv: 4 }), null, T(x, RD + 0.3 + Math.sin(a) * 0.7, -Math.cos(a) * 0.46, 0, (i * 1.3) % TAU, 0.6)); } } for (const [x, z] of [[0.65, 0.3], [0.95, -0.2], [0.8, 0.0]]) lotus(k, x, RD + 0.95, z, 0.7, S.paint, 0xf8e8f0, 6); k.g(ball(0.06, 8, 6), L.glow, T(0.8, RD + 0.8, 0)); break;
    case 'screaming': cageRibs(k, H, [-1.4, -0.9, -0.4, 0.1], S.bone, 0.3, 0.025); k.s(ball(0.36, 12, 10), S.hide, T(0.8, RD + 0.3, 0, 0, 0, 0, 1.0, 0.9, 1.25)); for (let i = 0; i < 6; i++) eyeball(k, [0.8 + Math.cos(i) * 0.25, RD + 0.4 + (i % 3) * 0.12, (i - 2.5) * 0.14], [Math.cos(i), 0.5, (i - 2.5) * 0.3], 0.07 - (i % 2) * 0.02, L.glow); for (let i = 0; i < 4; i++) k.s(sweep([[0.8, RD + 0.5, (i - 1.5) * 0.15], [0.7 + i * 0.05, RD + 0.9, (i - 1.5) * 0.25], [0.9, RD + 1.15, (i - 1.5) * 0.3]], (v) => 0.04 * (1 - v * 0.8), 5, 8, sh(S.hide, 0.8)), null); break;
    case 'xibalba': for (const [x, z] of [[0.5, -0.45], [0.5, 0.45], [1.1, -0.45], [1.1, 0.45]]) { k.m(cyl(0.03, 0.03, 0.95, 6), GOLD, T(x, RD + 0.475, z)); k.s(cyl(0.035, 0.035, 0.06, 6), JADE, T(x, RD + 0.6, z)); } k.c(surf(6, 4, (u, v, out) => { out[0] = 0.44 + u * 0.72; out[1] = RD + 0.96; out[2] = -0.52 + v * 1.04; }, (u, v, i, j) => ((i + j) & 1 ? 0xc82a2a : 0xe8c040))); for (const sd of [-1, 1]) for (let i = 0; i < 9; i++) k.s(leaf(0.24, 0.06, 0.1, FEATHER[i % 4], { nv: 3 }), null, T(0.44 + i * 0.09, RD + 0.96, sd * 0.53, PI, sd > 0 ? 0 : PI, 0)); k.m(cyl(0.12, 0.12, 0.03, 12), GOLD, T(0.8, RD + 1.0, 0)); break;
    case 'greenhide': for (const [x, z] of [[0.5, -0.42], [0.5, 0.42], [1.1, -0.42], [1.1, 0.42]]) crookedPole(k, x, RD, z, 0.85, S.wood, 0.05); k.c(surf(5, 3, (u, v, out) => { out[0] = 0.45 + u * 0.72; out[1] = RD + 0.85 - v * 0.12 + rnd(u * 9) * 0.04; out[2] = -0.5 + v * 1.0; }, (u, v, i, j) => [0x6a5a3a, 0x4a4238, 0x8a1a14][(i + j * 2) % 3])); for (let i = 0; i < 5; i++) k.m(cone(0.03, 0.22, 4), 0x5a5a4a, T(0.48 + i * 0.16, RD + 0.95, 0, 0, 0, (rnd(i) - 0.5) * 0.4)); break;
    case 'mistisles': cabin(k, 0.5, 1.1, 0.9, 0.5, RD, { wall: 0xb08a4e, trim: S.wood, roof: 'gable', rh: 0.42, roofCol: 0xc8b070, win: false, doorCol: 0x3a2a1a }); for (let i = 0; i < 8; i++) k.s(cone(0.02, 0.12, 4), 0xa89058, T(0.45 + i * 0.1, RD + 0.5, (i & 1 ? 0.55 : -0.55), PI)); break;
    case 'elemental': k.s(rbox(0.6, 0.12, 0.7, 0.03, 1), sh(S.hide, 0.9), T(0.8, RD + 0.06, 0), true); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; k.g(oct(0.08 + (i % 3) * 0.03), i & 1 ? S.paint : mix(S.paint, 0xffffff, 0.4), T(0.8 + Math.cos(a) * 0.15, RD + 0.4 + (i % 3) * 0.12, Math.sin(a) * 0.2, Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, 0.7, 3.0, 0.7)); } k.g(oct(0.14), mix(S.paint, 0xffffff, 0.5), T(0.8, RD + 0.75, 0, 0, 0, 0, 0.8, 3.2, 0.8)); for (let i = 0; i < 3; i++) k.s(dodec(0.08), sh(S.hide, 1.1), T(0.8 + Math.cos(i * 2.1) * 0.5, RD + 1.3 + i * 0.12, Math.sin(i * 2.1) * 0.5), true); break;
    default: break;
  }
  // sails for the peoples that use them
  if (f === 'beasts' || f === 'fimbul' || f === 'greenhide') { k.rod('solid', S.wood, [mx, RD, 0], [mx, 2.55, 0], 0.04, 7); sqSail(k, mx, 1.35, 2.35, 1.2, (u, v, i, j) => { if (f === 'greenhide') return [0x6a5a3a, 0x4a4238, 0x8a1a14, 0x7a6a4a][(i * 3 + j * 5) % 4]; const dx = u - 0.5, dy = v - 0.5, r = dx * dx + dy * dy; return f === 'beasts' && r < 0.04 && Math.abs(dx * 6 - Math.round(dx * 6)) < 0.25 ? S.paint : f === 'fimbul' ? sh(S.hide, (i + j) & 1 ? 0.95 : 1.05) : sh(S.hide, 1.1 + ((i + j) & 1) * 0.1); }, { owner: [0.06, 0.16], bil: 0.12, nu: 8, nv: 6, spar: S.wood, boom: true }); if (f === 'beasts') for (let i = 0; i < 4; i++) k.s(cone(0.02, 0.12, 4), S.bone, T(mx + 0.05, 2.38, -0.6 + i * 0.4, PI)); }
  if (f === 'dragons') { k.rod('solid', S.bone, [mx, RD, 0], [mx, 2.7, 0], 0.04, 7); for (const sz of [-1, 1]) wing(k, T(mx + 0.04, 2.55, 0, 0, sz > 0 ? -HP : HP, -1.25), 1.0, 1.6, 4, sh(S.hide, 0.8), S.bone); k.o(surf(3, 3, (u, v, out) => { out[0] = mx + 0.06; out[1] = 2.5 - v * 0.6; out[2] = (u - 0.5) * 0.3; }, WHITE)); }
  if (f === 'mistisles') { k.rod('solid', S.wood, [mx + 0.25, RD, 0], [mx - 0.05, 2.0, 0], 0.035, 6); const A = [mx + 0.25, RD + 0.2, 0]; k.rod('solid', S.wood, A, [-0.5, 2.9, 0], 0.025, 5); k.rod('solid', S.wood, A, [-0.6, 1.4, 0], 0.025, 5); faSail(k, A, [-0.6, 1.4, 0], [-0.5, 2.9, 0], A, (u, v, i, j) => (j === 3 ? S.paint : sh(0xc8b890, 0.9 + ((i + j) & 1) * 0.1)), { owner: [0.6, 0.72], bil: 0.12 }); }
  if (f === 'fimbul') { icicles(k, H, 18); for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { const p = H.side(-1.4 + i * 0.6, sd, 0.08, -0.012); roundShield(k, p[0], p[1], p[2], sd > 0 ? 0 : PI, 0.14, i & 1 ? S.paint : 0xd8d0c0, 0x6a6a70, 0x8a8a90); } }
  if (f === 'gorge') for (const sd of [-1, 1]) for (let i = 0; i < 9; i++) { const s = 0.12 + i * 0.09, p = H.at(s, H.aAt(s, 0.07, sd), -0.012); k.s(slab([[-0.1, 0], [0.1, 0], [0.06, -0.12], [0, -0.17], [-0.06, -0.12]], 0.006), S.felt[i % 4], T(p[0], p[1], p[2], 0, sd > 0 ? 0 : PI, 0)); }
  if (f === 'cloven' || f === 'beasts') for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) { const p = H.side(-1.4 + i * 0.6, sd, 0.08, -0.012); roundShield(k, p[0], p[1], p[2], sd > 0 ? 0 : PI, 0.14, i & 1 ? S.paint : S.hide, S.wood, S.bone); }
  if (f === 'greenhide') { spikes(k, H, 0.03, 0x5a5a4a, 10, 0.2, 0.1, 0.9); for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) { const p = H.side(-1.2 + i * 0.8, sd, 0.06, -0.02); skull(k, p[0], p[1] - 0.05, p[2], 0.8, sd > 0 ? -HP : HP, S.bone); } }
  if (f === 'screaming') for (const sd of [-1, 1]) for (let i = 0; i < 7; i++) { const p = H.side(-1.6 + i * 0.5, sd, 0.12, -0.03); eyeball(k, p, [0.2, 0.1, sd], 0.06, L.glow); }
  if (f === 'xibalba') for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) { const p = H.side(-1.5 + i * 0.6, sd, 0.08, -0.04); k.m(cyl(0.05, 0.05, 0.02, 8), GOLD, TA(p, [0, 0, sd])); k.s(cyl(0.03, 0.03, 0.024, 6), JADE, TA(p, [0, 0, sd])); }
  if (f === 'verdant') for (const sd of [-1, 1]) garland(k, [H.side(-1.7, sd, 0, -0.02), [-0.6, H.topAt(-0.6) - 0.08, sd * 0.74], H.side(0.4, sd, 0, -0.02)], 0x3a7a2a, 18, 0.035);
  if (f === 'mistisles') for (const sd of [1]) { for (const x of [-0.8, 0.6]) k.s(sweep([[x, H.topAt(x), 0.55], [x, H.topAt(x) + 0.1, 1.0], [x, 0.14, 1.45]], 0.03, 5, 8, S.wood), null); const O = shape({ x0: -1.4, x1: 1.4, B: 0.22, draft: 0.07, free: 0.1, bowRise: 0.08, ex: 2, th: 0.02 }); k.push(T(0, 0, 1.48)); shell(k, O, hcol(O, { out: S.wood, strake: 0, in: S.wood }), { m: 6, nv: 16 }); k.pop(); void sd; }
  // paddles, two pairs (the drakes' folk and the stone-callers pole instead)
  if (type === 'stone') { pole(k, C, [-1.6, RD + 0.9, 0.3], { col: 0x6a6a72, shoe: S.paint }); for (const sd of [-1, 1]) for (const x of [-0.62, -0.06]) { const p = [x, RD + 0.05, sd * 0.75]; oar(k, C, p, sd, { ...paddleOpts(S, f), lock: false, bladeGeo: dodec(0.09) }); } }
  else riverOars(k, C, H, { ...paddleOpts(S, f), inb: 0.3 });
  if (type !== 'stone') { const x = -1.95, y = H.topAt(-1.95); k.rod('solid', S.wood, [x + 0.3, RD, 0.3], [x + 0.3, y + 0.75, 0.3], 0.02, 5); if (f === 'elemental') k.g(oct(0.06), S.paint, T(x + 0.3, y + 0.82, 0.3)); else flame(k, x + 0.3, y + 0.75, 0.3, 0.8, f === 'screaming' ? L.glow : 0xff9a30); }
  const cg = savCargo(f);
  heap(k, 1.58, RD, 0, cg.bow, H); heap(k, -1.75, RD, 0, cg.stern, H);
  flagstaff(k, -1.85, RD, -0.38, 1.0, { h: 0.24, w: 0.5, kind: f === 'greenhide' ? 'rag' : 'point', col: S.wood, knob: S.bone, knobGeo: f === 'elemental' ? oct(0.05) : cone(0.035, 0.12, 5) });
}
function savCargo(f) {
  const t = { beasts: ['hide', 'meat', 'gourd', 0x7a5434], cloven: ['hide', 'meat', 'basket', 0x3a2a22], fimbul: ['hide', 'cask', 'meat', 0xd8d0c0], gorge: ['bale', 'gourd', 'hide', 0x8a2a1a], dragons: ['chest', 'meat', 'ingot', 0x4a3024], verdant: ['gourd', 'basket', 'bundle', 0x8aa83a], screaming: ['meat', 'jar', 'meat', 0x9a3a4a], xibalba: ['basket', 'jar', 'bundle', 0xc8a050], greenhide: ['crate', 'sack', 'meat', 0x5a4a32], mistisles: ['basket', 'gourd', 'bundle', 0xb08a4e], elemental: ['ore', 'ore', 'crate', 0x8ad8ff] }[f] || ['hide', 'meat', 'gourd', 0x7a5434];
  const tint2 = f === 'xibalba' ? JADE : f === 'screaming' ? 0x5a1a3a : f === 'elemental' ? 0x7a7a82 : undefined;
  return { bow: [[t[0], 0, -0.3, 1.5, 0.1, t[3]], [t[1], 0.02, 0.3, 1.4, 0.3, tint2], [t[2], 0.3, 0.0, 1.4, 0.5], [t[0], 0.0, -0.28, 1.2, -0.2, t[3], 0.2]], stern: [[t[1], 0, -0.42, 1.2, 0.2, tint2], [t[2], 0.0, 0.42, 1.2, 0.0]], raft: [[t[0], 0, -0.3, 1.5, 0.1, t[3]], [t[1], 0.25, 0.25, 1.4, 0.3, tint2], [t[2], 0.0, 0.25, 1.3, 0.5], [t[0], 0.3, -0.05, 1.2, -0.2, t[3]]], raftS: [[t[1], 0, -0.3, 1.2, 0.2, tint2], [t[2], 0.15, 0.0, 1.1, 0.0]] };
}
function savRaft(k, C) {
  const L = C.L, f = C.f, S = svOf(C);
  const logs = (n, col, r = 0.12, len = 3.0, jag = 0) => { for (let i = 0; i < n; i++) { const z = -0.8 + r + ((1.6 - 2 * r) * i) / (n - 1), l = len - jag * rnd(i * 3) * 0.5; k.s(cyl(r * (0.92 + rnd(i) * 0.12), r, l, 9), (px, py, pz) => sh(col, 0.85 + rnd(Math.floor(py * 4) + i * 5) * 0.3), T((rnd(i * 7) - 0.5) * jag * 0.3, FD - r, z, 0, 0, HP)); for (const sx of [-1, 1]) k.s(cyl(r * 0.85, r * 0.85, 0.012, 9), mix(col, 0xe8d0a0, 0.6), T(sx * l / 2 + (rnd(i * 7) - 0.5) * jag * 0.3 + sx * 0.006, FD - r, z, 0, 0, HP)); } for (const x of [-1.2, 0, 1.2]) k.s(cyl(0.02, 0.02, 1.65, 4), 0x3a2a1a, T(x, FD - 0.005, 0, HP)); };
  switch (f) {
    case 'gorge': { // a kelek: poles over blown-up skins
      for (const x of [-1.1, -0.37, 0.37, 1.1]) for (const z of [-0.55, 0, 0.55]) k.s(ball(0.2, 10, 8), sh(S.hide, 0.9 + rnd(x * 3 + z) * 0.2), T(x, 0.07, z, 0, 0, 0.3, 1.25, 0.85, 1.0));
      for (let i = 0; i < 12; i++) k.s(cyl(0.035, 0.035, 3.0, 6), sh(S.wood, 0.9 + rnd(i) * 0.2), T(0, FD - 0.04, -0.77 + i * 0.14, 0, 0, HP)); for (const x of [-1.3, -0.65, 0, 0.65, 1.3]) k.s(cyl(0.035, 0.035, 1.65, 6), sh(S.wood, 0.8), T(x, FD - 0.01, 0, HP));
      k.c(surf(6, 4, (u, v, out) => { out[0] = -0.6 + u * 1.0; out[1] = FD + 0.012; out[2] = -0.55 + v * 1.1; }, (u, v, i, j) => S.felt[(i + j) % 4]));
      break;
    }
    case 'verdant': { // a great lily pad with an upturned rim
      k.s(surf(36, 5, (u, v, out) => { const a = 0.18 + u * (TAU - 0.36), r = 0.15 + v * 0.85; out[0] = Math.cos(a) * r * 1.5; out[2] = Math.sin(a) * r * 0.82; out[1] = FD - 0.03 + (v > 0.85 ? (v - 0.85) * 0.8 : 0); }, (u, v, i, j) => (i % 4 === 0 ? sh(S.hide, 1.3) : sh(S.hide, 0.95 + (j === 4 ? 0.2 : 0)))), null);
      k.s(surf(36, 1, (u, v, out) => { const a = 0.18 + u * (TAU - 0.36); out[0] = Math.cos(a) * 1.5 * (1 - v * 0.05); out[2] = Math.sin(a) * 0.82 * (1 - v * 0.05); out[1] = FD - 0.15 + v * 0.0; }, sh(S.hide, 0.6), { flip: true }), null);
      k.s(cyl(1.5, 1.5, 0.14, 30, true), sh(S.hide, 0.7), T(0, FD - 0.1, 0, 0, 0, 0, 1, 1, 0.547));
      for (const [x, z] of [[1.1, 0.35], [-1.25, -0.3], [0.9, -0.45]]) { lotus(k, x, FD, z, 1.0, S.paint, 0xf8e8f0, 7); k.g(ball(0.04, 8, 6), L.glow, T(x, FD + 0.07, z)); }
      for (let i = 0; i < 4; i++) k.s(sweep([[-1.4 + i * 0.1, FD, 0.6 - i * 0.1], [-1.3 + i * 0.2, FD + 0.2, 0.7 - i * 0.1], [-1.0 + i * 0.25, FD + 0.1, 0.75 - i * 0.1]], 0.015, 4, 8, 0x3a7a2a), null);
      break;
    }
    case 'screaming': { // a mat of flesh with eyes on stalks
      k.s(surf(16, 10, (u, v, out) => { out[0] = (u - 0.5) * 3.0; out[2] = (v - 0.5) * 1.6; out[1] = FD - 0.02 + 0.03 * Math.sin(u * 17) * Math.sin(v * 11); }, (u, v, i, j) => { const r = rnd(i * 13 + j * 7); return r > 0.85 ? 0x8a2a4a : r > 0.55 ? sh(S.hide, 0.85) : S.hide; }), null);
      k.s(cyl(0.8, 0.86, 0.3, 24, true), sh(S.hide, 0.7), T(0, FD - 0.16, 0, 0, 0, 0, 1.88, 1, 1));
      for (let i = 0; i < 6; i++) { const x = -1.3 + i * 0.52, z = (i & 1 ? 0.72 : -0.72), hh = 0.3 + rnd(i) * 0.25; k.s(sweep([[x, FD, z], [x + 0.05, FD + hh * 0.5, z * 1.05], [x, FD + hh, z]], (v) => 0.04 - v * 0.02, 5, 8, sh(S.hide, 0.85)), null); eyeball(k, [x, FD + hh + 0.04, z], [1, 0.3, z], 0.06, L.glow); }
      for (let i = 0; i < 5; i++) k.s(sweep([[1.4, FD - 0.05, -0.5 + i * 0.25], [1.65, FD - 0.12, -0.55 + i * 0.27], [1.8, FD - 0.05, -0.5 + i * 0.25]], (v) => 0.04 * (1 - v * 0.8), 5, 8, sh(S.hide, 0.8)), null);
      break;
    }
    case 'xibalba': for (let i = 0; i < 5; i++) { const z = -0.62 + i * 0.31; reedBundle(k, [[-1.5, 0.3, z * 0.85], [-1.25, 0.1, z], [0, 0.08, z], [1.25, 0.1, z], [1.52, 0.38, z * 0.8]], (v) => 0.17 * (0.4 + 0.6 * Math.sin(PI * Math.min(1, v * 1.1 + 0.03))), S.hide, 5, 0x6a4a2a, 28); } for (let i = 0; i < 12; i++) k.s(box(0.14, 0.03, 1.4), sh(0xa89058, 0.9 + rnd(i) * 0.2), T(-1.05 + i * 0.18, FD - 0.01, 0)); break;
    case 'elemental': { // a disc of rock adrift
      for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; k.s(dodec(0.42), sh(S.hide, 0.75 + rnd(i) * 0.3), T(Math.cos(a) * 0.95, FD - 0.25, Math.sin(a) * 0.5, rnd(i) * 3, rnd(i * 2) * 3, 0, 1.2, 0.55, 1.0), true); }
      k.s(dodec(0.7), sh(S.hide, 0.85), T(0, FD - 0.32, 0, 0.3, 0.2, 0, 1.8, 0.48, 1.05), true);
      for (let i = 0; i < 18; i++) k.s(box(0.24, 0.03, 0.24), sh(S.hide, 1.05 + rnd(i) * 0.15), T(-1.2 + (i % 6) * 0.48, FD - 0.015, -0.5 + Math.floor(i / 6) * 0.5, 0, rnd(i * 3) * 0.3, 0), true);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; k.g(oct(0.07 + rnd(i) * 0.04), i & 1 ? S.paint : mix(S.paint, 0xffffff, 0.4), T(Math.cos(a) * 1.45, FD - 0.08, Math.sin(a) * 0.78, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.5, 0.7, 2.4, 0.7)); }
      k.g(cyl(1.55, 1.55, 0.012, 32, true), S.paint, T(0, 0.02, 0, 0, 0, 0, 1, 1, 0.53));
      break;
    }
    case 'mistisles': for (let i = 0; i < 11; i++) { const z = -0.75 + i * 0.15; k.s(sweep([[-1.5, 0.1, z], [0.8, 0.1, z], [1.3, 0.14, z], [1.5, 0.32, z * 0.9]], 0.075, 7, 14, (u, v, ii, j) => (j % 3 === 0 ? 0x6a7a3a : sh(0x9aa050, 0.95 + rnd(i) * 0.15))), null); } for (let i = 0; i < 9; i++) k.s(box(2.7, 0.03, 0.15), sh(0xb8b070, 0.9 + rnd(i * 3) * 0.15), T(-0.2, FD - 0.015, -0.68 + i * 0.17)); break;
    case 'fimbul': logs(8, 0x6a5a48, 0.11); for (let i = 0; i < 7; i++) k.s(box(0.3 + rnd(i) * 0.3, 0.03, 0.25 + rnd(i * 2) * 0.3), 0xf0f4f8, T(-1.2 + rnd(i * 3) * 2.4, FD + 0.01, -0.6 + rnd(i * 5) * 1.2, 0, rnd(i) * 2, 0)); for (const sz of [-1, 1]) for (let i = 0; i < 12; i++) { const l = 0.08 + rnd(i * 3 + sz) * 0.14; k.m(cone(0.016, l, 5), 0xd8f0ff, T(-1.4 + i * 0.25, FD - 0.05 - l / 2, sz * 0.8, PI)); } break;
    case 'dragons': logs(7, 0x4a3024, 0.12); k.c(surf(8, 4, (u, v, out) => { out[0] = -0.6 + u * 1.2; out[1] = FD + 0.01; out[2] = -0.7 + v * 1.4; }, (u, v, i, j) => sh(S.hide, (i + j) & 1 ? 0.8 : 1.05))); break;
    default: logs(f === 'greenhide' ? 7 : 8, S.wood, f === 'greenhide' ? 0.13 : 0.11, 3.0, f === 'greenhide' ? 1 : 0);
  }
  // owner's mark along the edges
  if (f === 'verdant' || f === 'elemental') { k.o(torus(0.84, 0.02, 4, 36), WHITE, T(0, FD - 0.06, 0, HP, 0, 0, 1.78, 0.97, 1)); }
  else { k.o(box(2.2, 0.06, 0.012), WHITE, T(0, FD - 0.06, 0.82)); k.o(box(2.2, 0.06, 0.012), WHITE, T(0, FD - 0.06, -0.82)); }
  // each people's shelter, totem or flourish
  switch (f) {
    case 'beasts': { k.rod('solid', S.wood, [0.6, FD, -0.75], [0.6, FD + 0.75, -0.1], 0.025, 5); k.rod('solid', S.wood, [1.3, FD, -0.75], [1.3, FD + 0.75, -0.1], 0.025, 5); k.rod('solid', S.wood, [0.55, FD + 0.75, -0.1], [1.35, FD + 0.75, -0.1], 0.02, 5); k.c(surf(5, 3, (u, v, out) => { out[0] = 0.58 + u * 0.75; out[1] = FD + 0.75 - v * 0.73; out[2] = -0.1 - v * 0.66; }, (u, v, i, j) => sh(S.hide, (i + j) & 1 ? 0.9 : 1.1))); k.s(cyl(0.03, 0.035, 1.1, 5), S.wood, T(-1.4, FD + 0.55, -0.65)); skull(k, -1.38, FD + 1.15, -0.65, 1.3, 0, S.bone, null, 1.0); break; }
    case 'cloven': for (const [x, z] of [[1.4, 0.7], [1.4, -0.7], [-1.4, -0.7]]) { k.s(cyl(0.035, 0.04, 0.9, 6), S.wood, T(x, FD + 0.45, z)); savFigure(k, C, S, [x, FD + 0.9, z], 0.9, 1); } break;
    case 'fimbul': tent(k, 0.6, 1.35, FD, 0.9, 0.55, 0xd8d0c0, 0x8a8070); for (const sz of [-1, 1]) k.s(sweep([[1.45, FD, sz * 0.2], [1.6, FD + 0.1, sz * 0.3], [1.7, FD + 0.35, sz * 0.25], [1.65, FD + 0.55, sz * 0.12]], (v) => 0.05 * (1 - v * 0.7), 6, 10, 0xf0e8d8), null); break;
    case 'gorge': savFigure(k, C, S, [1.4, FD + 0.15, 0], 1.3, 1); break;
    case 'dragons': savFigure(k, C, S, [1.45, FD + 0.08, 0], 1.6, 1); for (const sz of [-1, 1]) k.s(sweep([[-1.5, FD, sz * 0.4], [-1.2, FD + 0.15, sz * 0.75], [0.0, FD + 0.12, sz * 0.82], [1.2, FD + 0.15, sz * 0.75]], 0.03, 5, 16, S.bone), null); break;
    case 'xibalba': for (const [x, z] of [[1.3, 0.55], [1.3, -0.55]]) { k.m(cyl(0.035, 0.035, 0.9, 6), GOLD, T(x, FD + 0.45, z)); k.s(cyl(0.045, 0.045, 0.06, 6), JADE, T(x, FD + 0.6, z)); for (let i = 0; i < 5; i++) k.s(leaf(0.26, 0.07, 0.2, FEATHER[i % 4], { nv: 3 }), null, T(x, FD + 0.9, z, 0.5, (i / 5) * TAU, 0)); } savFigure(k, C, S, [1.58, 0.42, 0], 0.9, 1); break;
    case 'greenhide': for (const [x, z] of [[1.45, 0.7], [1.45, -0.7], [1.5, 0]]) k.m(cone(0.04, 0.4, 4), 0x5a5a4a, T(x + 0.1, FD + 0.03, z, 0, 0, -1.3)); for (const sz of [-1, 1]) for (let i = 0; i < 5; i++) k.m(cone(0.03, 0.18, 4), 0x5a5a4a, T(-1.2 + i * 0.55, FD - 0.03, sz * 0.86, sz * 1.3, 0, 0)); crookedPole(k, -1.4, FD, -0.62, 1.3, S.wood, 0.1); skull(k, -1.3, FD + 1.34, -0.62, 1.0, 0, S.bone); break;
    case 'mistisles': { k.s(cyl(0.05, 0.06, 1.0, 7), S.wood, T(1.3, FD + 0.5, 0.5)); savFigure(k, C, S, [1.3, FD + 0.95, 0.5], 0.85, 1); for (let i = 0; i < 4; i++) k.s(box(0.13, 0.12, 0.13), [S.paint, 0xc83a2a, 0xe8e0c8, S.paint][i], T(1.3, FD + 0.15 + i * 0.18, 0.5, 0, i * 0.4, 0)); break; }
    case 'screaming': savFigure(k, C, S, [1.4, FD, 0], 1.6, 1); break;
    case 'elemental': for (let i = 0; i < 4; i++) k.g(oct(0.1 + (i % 2) * 0.05), mix(S.paint, 0xffffff, 0.3 * (i & 1)), T(1.15 + Math.cos(i * 1.6) * 0.12, FD + 0.3 + (i % 2) * 0.15, 0.45 + Math.sin(i * 1.6) * 0.12, Math.cos(i) * 0.3, 0, Math.sin(i) * 0.3, 0.7, 2.6, 0.7)); break;
    case 'verdant': { k.s(sweep([[1.2, FD, 0.0], [1.3, FD + 0.5, 0.05], [1.1, FD + 0.9, 0.0], [1.25, FD + 1.1, 0.1]], (v) => 0.05 * (1 - v * 0.6), 6, 12, S.wood), null); for (let i = 0; i < 6; i++) k.s(leaf(0.3, 0.14, 0.2, i & 1 ? sh(S.hide, 1.15) : S.hide, { nv: 4 }), null, T(1.22, FD + 0.5 + i * 0.1, 0.05, 0.7, i * 1.1, 0)); k.g(ball(0.06, 8, 6), L.glow, T(1.25, FD + 1.14, 0.1)); break; }
    default: break;
  }
  const cg = savCargo(f);
  heap(k, 0.85, FD, 0, cg.raft); heap(k, -1.25, FD, 0, cg.raftS);
  flagstaff(k, -1.4, FD, f === 'greenhide' || f === 'beasts' ? 0.62 : -0.62, 1.05, { h: 0.24, w: 0.5, kind: f === 'greenhide' ? 'rag' : 'point', col: f === 'elemental' ? 0x6a6a72 : S.wood, knob: f === 'xibalba' ? GOLD : S.bone, knobGeo: f === 'elemental' ? oct(0.05) : cone(0.035, 0.12, 5) });
  pole(k, C, [-1.0, FD + 0.9, 0.55], { col: f === 'elemental' ? 0x6a6a72 : f === 'xibalba' ? 0x8a6a40 : S.wood, shoe: f === 'xibalba' ? GOLD : f === 'elemental' ? S.paint : S.bone, deco: f === 'elemental' ? (top) => k.g(oct(0.05), S.paint, T(top[0], top[1], top[2], 0, 0, 0, 1, 1.8, 1)) : null });
}
const SAV = {};
for (const f of Object.keys(SV)) SAV[f] = { gondola: savGondola, riverboat: savRiver, raft: savRaft };

// =====================================================================================================
// ASSEMBLY
// =====================================================================================================
const KINDS = ['gondola', 'riverboat', 'raft'];
const FAM = {
  kingdom: { gondola: kingdomGondola, riverboat: kingdomRiver, raft: kingdomRaft },
  elven: { gondola: elvenGondola, riverboat: elvenRiver, raft: elvenRaft },
  dwarf: { gondola: dwarfGondola, riverboat: dwarfRiver, raft: dwarfRaft },
  eastern: { gondola: eastGondola, riverboat: eastRiver, raft: eastRaft },
  desert: { gondola: desertGondola, riverboat: desertRiver, raft: desertRaft },
  north: { gondola: northGondola, riverboat: northRiver, raft: northRaft },
  undead: { gondola: undeadGondola, riverboat: undeadRiver, raft: undeadRaft },
  infernal: { gondola: infernalGondola, riverboat: infernalRiver, raft: infernalRaft },
  goblin: { gondola: goblinGondola, riverboat: goblinRiver, raft: goblinRaft },
};
const LAYOUT = { gondola: { len: 3.4, deck: GD, seats: gSeats }, riverboat: { len: 4.2, deck: RD, seats: rSeats }, raft: { len: 3.0, deck: FD, seats: fSeats } };

export function buildBoat(look, sideColor, kind = 'riverboat') {
  const L = look || { fam: 'kingdom', faction: 'kingdom', cloth: 0x2a5aa8, cloth2: 0xd8b04a, metal: 0x2e2e34, wood: 0x7a5a36, trim: 0xc8a040, glow: 0xffa030 };
  if (!KINDS.includes(kind)) kind = 'riverboat';
  const key = [L.faction, L.fam, kind, L.cloth, L.cloth2, L.metal, L.wood, L.trim, L.glow, L.hide].join(':');
  return assemble(key, sideColor ?? 0xc83a3a, (k) => {
    const lay = LAYOUT[kind], C = { L, f: L.faction, kind, nsw: 0, len: lay.len, deck: lay.deck, seats: null, wheel: false };
    const fam = L.savage ? 'savage' : FAM[L.fam] ? L.fam : 'kingdom';
    const fn = (L.savage && SAV[L.faction]?.[kind]) || FAM[fam]?.[kind] || FAM.kingdom[kind];
    fn(k, C);
    return { len: C.len, deck: C.deck, seats: C.seats || lay.seats(C.deck, C.wheel), kind };
  });
}
