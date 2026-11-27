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
// ASSEMBLY
// =====================================================================================================
const KINDS = ['gondola', 'riverboat', 'raft'];
const FAM = {
  kingdom: { gondola: kingdomGondola, riverboat: kingdomRiver, raft: kingdomRaft },
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
const SAV = {};
