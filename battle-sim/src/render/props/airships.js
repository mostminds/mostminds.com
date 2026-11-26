// War zeppelins, their aircraft and drop pods, and the airfield buildings that serve them.
//
//   airship(def, sideColorHex)          -> THREE.Group, bow toward +X, gondola deck at y = 0 (the game lifts it to its height)
//   aircraft(kind, sideColorHex, style) -> 'glider' | 'gyro', nose toward +X, origin at the craft's centre
//   dropPod(style, sideColorHex)        -> armoured pod, origin at its base
//   structures.{dock, zeppelinTower, hangar, workshop}(def, w, h, place) -> Object3D centred on its footprint, on y = 0
//
// Everything is drawn with a pen (class Pen) straight into one vertex-coloured geometry for the shared sculpt
// shader: lofted skins, lathed metalwork, bevelled timber, laid ropes; the few organic pieces (skulls, pilots)
// are sculpted with the kit and merged in. An airship is two meshes (the ship, and everything dyed in the side
// colour) plus one small mesh per propeller. Seven faction designs share one construction: an envelope lofted
// from a profile, an inner frame, a planked gondola with guns, bomb bay, stern hangar, pod racks and ladders.
// Each design is built per damage level (0..3) and per detail tier, on first use, and cached per class.
import * as THREE from 'three';
import { S, H as HP, rgb, noise3, fbm3, buildPartGeometry, sculptMaterial } from '../sculpt.js';
import { getDetail } from '../rigkit.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** deterministic 0..1 from integers (nothing here ever calls Math.random) */
function hash1(n) { let h = Math.imul((n | 0) ^ 0x9e3779b9, 374761393); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const hash2 = (a, b) => hash1(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
/** a colour nudged in brightness and warmth by a seed */
function vary(c, seed, amt = 0.1) { const k = 1 + (hash1(seed) - 0.5) * 2 * amt, w = (hash1(seed + 77) - 0.5) * amt * 0.6; return [c[0] * k * (1 + w), c[1] * k, c[2] * k * (1 - w)]; }
/** 2D cell noise: [distance to the nearest point, distance to the second nearest, id of the nearest] */
function vor2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, h = Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(seed + 1, 83492791);
    const px = cx + 0.15 + 0.7 * hash1(h) - x, py = cy + 0.15 + 0.7 * hash1(h + 5) - y, d = Math.hypot(px, py);
    if (d < d1) { d2 = d1; d1 = d; id = h; } else if (d < d2) d2 = d;
  }
  return [d1, d2, id];
}
/** shortest signed difference between two angles */
const dAng = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; };

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _pm = new THREE.Matrix4(), _nm = new THREE.Matrix3();
/** a placement: translate, rotate (DEGREES, three's XYZ order), scale */
function X(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx * DEG, ry * DEG, rz * DEG, 'XYZ')), _s.set(sx, sy, sz));
}
/** a placement whose local +Y runs from a toward b */
function aim(a, b) {
  const y = norm3(sub3(b, a));
  const ref = Math.abs(y[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const x = norm3(cross(ref, y)), z = cross(x, y);
  return new THREE.Matrix4().set(x[0], y[0], z[0], a[0], x[1], y[1], z[1], a[1], x[2], y[2], z[2], a[2], 0, 0, 0, 1);
}
/** a placement from an origin and two axes: local X -> ax, local Y -> ay (squared to ax), local Z -> ax x ay */
function frame(o, ax, ay) {
  const x = norm3(ax), z = norm3(cross(x, ay)), y = cross(z, x);
  return new THREE.Matrix4().set(x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2], 0, 0, 0, 1);
}
const MIRROR = new THREE.Matrix4().makeScale(1, 1, -1);
/** points on a Catmull-Rom curve through pts (`per` steps a span); radii, when given, are interpolated alongside */
function spline(pts, per = 5, radii = null, closed = false) {
  const n = pts.length, out = [], rr = radii ? [] : null, spans = closed ? n : n - 1;
  const P = (i) => (closed ? pts[((i % n) + n) % n] : pts[clamp(i, 0, n - 1)]);
  for (let i = 0; i < spans; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t, q = [];
      for (let k = 0; k < p1.length; k++) q.push(0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3));
      out.push(q);
      if (rr) rr.push(lerp(radii[i], radii[(i + 1) % n], t * t * (3 - 2 * t)));
    }
  }
  if (!closed) { out.push(pts[n - 1].slice()); if (rr) rr.push(radii[n - 1]); }
  return { pts: out, rr };
}
/** a closed outline [[x, y], ...] with its corners rounded off */
const rounded = (outline, per = 4) => spline(outline, per, null, true).pts;

// per-build mesh economy: Q scales segment counts, TIER (0 full, 1 middle, 2 far) drops small parts
let Q = 1, TIER = 0;
const TIERS = [{ q: 1 }, { q: 0.58 }, { q: 0.34 }];
const seg = (n, min = 3) => Math.max(min, Math.round(n * Q));

// ---------- the pen: draws shapes straight into one growing vertex buffer ----------
class Pen {
  constructor() {
    this.P = []; this.N = []; this.C = []; this.M = []; this.I = []; this.n = 0;
    this.base = new THREE.Matrix4(); this.stack = []; this.loc = null;
    this.col = [0.6, 0.6, 0.6]; this.ro = 0.8; this.me = 0; this.gl = 0; this.fn = null;
    this.warp = null;   // (pt) moves a finished vertex in model space (buckled and broken ships)
    this.post = null;   // (x, y, z, colour6) last word on every vertex's colour (scorching)
    this.e = null; this.k = null; this.flip = false;
  }
  /** colour (linear rgb), roughness, metalness, glow for what follows */
  ink(c, ro = 0.85, me = 0, gl = 0) { this.col = c; this.ro = ro; this.me = me; this.gl = gl; return this; }
  /** per-vertex colour in model space: fn(x, y, z, nx, ny, nz, colour) -> colour | null */
  shade(fn) { this.fn = fn || null; return this; }
  push(m) { this.stack.push(this.base.clone()); this.base.multiply(m); return this; }
  pop() { this.base.copy(this.stack.pop()); return this; }
  /** run fn with placement m in effect */
  in(m, fn) { this.push(m); fn(); this.pop(); return this; }
  /** placement of the next shape only */
  T(x, y, z, rx, ry, rz, sx, sy, sz) { this.loc = X(x, y, z, rx, ry, rz, sx, sy, sz); return this; }
  TM(m) { this.loc = m; return this; }
  begin() {
    const m = _pm.copy(this.base);
    if (this.loc) { m.multiply(this.loc); this.loc = null; }
    this.e = m.elements.slice();
    this.k = _nm.getNormalMatrix(m).elements.slice();
    this.flip = m.determinant() < 0;
  }
  /** a vertex already in model space; c may be [r, g, b] or [r, g, b, rough, metal, glow] */
  raw(wx, wy, wz, ax, ay, az, c) {
    let col = c || this.col, ro = this.ro, me = this.me, gl = this.gl;
    if (col.length > 3) { ro = col[3]; me = col[4]; gl = col[5]; }
    if (this.fn) { const r = this.fn(wx, wy, wz, ax, ay, az, col); if (r) col = r; }
    if (this.post) { const r = this.post(wx, wy, wz, col, ro, me, gl); if (r) { col = r; ro = r[3]; me = r[4]; gl = r[5]; } }
    this.P.push(wx, wy, wz); this.N.push(ax, ay, az); this.C.push(col[0], col[1], col[2]); this.M.push(ro, me, gl);
    return this.n++;
  }
  v(x, y, z, nx, ny, nz, c) {
    const e = this.e, k = this.k;
    let wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    let ax = k[0] * nx + k[3] * ny + k[6] * nz, ay = k[1] * nx + k[4] * ny + k[7] * nz, az = k[2] * nx + k[5] * ny + k[8] * nz;
    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    if (this.warp) { _w[0] = wx; _w[1] = wy; _w[2] = wz; this.warp(_w); const sx = wx, sy = wy, sz = wz; wx = _w[0]; wy = _w[1]; wz = _w[2]; return this.rawAt(sx, sy, sz, wx, wy, wz, ax, ay, az, c); }
    return this.raw(wx, wy, wz, ax, ay, az, c);
  }
  /** like raw, but shaded where the vertex was before it was warped (so patterns stay put on a bent ship) */
  rawAt(sx, sy, sz, wx, wy, wz, ax, ay, az, c) {
    const i = this.raw(sx, sy, sz, ax, ay, az, c), q = i * 3;
    this.P[q] = wx; this.P[q + 1] = wy; this.P[q + 2] = wz;
    return i;
  }
  tri(a, b, c) { if (this.flip) this.I.push(a, c, b); else this.I.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  /**
   * (nu+1) x (nv+1) lattice: f(i, j, out) writes a position; normals come from the finished lattice, so it shades
   * smoothly. colFn(i, j) -> colour. o: { flip, away: [x, y, z] (normals point away from this local point),
   * skip(i, j) (leave that quad out), wrapU, wrapV (the lattice closes on itself: no shading seam) }
   */
  grid(nu, nv, f, colFn = null, o = null) {
    this.begin();
    const W = nu + 1, R = nv + 1, e = this.e, wp = this.warp, pos = new Float64Array(W * R * 3), src = wp ? new Float64Array(W * R * 3) : pos, t = [0, 0, 0];
    for (let j = 0; j < R; j++) for (let i = 0; i < W; i++) {
      f(i, j, t);
      const x = t[0], y = t[1], z = t[2], q = (j * W + i) * 3;
      t[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; t[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; t[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (wp) { src[q] = t[0]; src[q + 1] = t[1]; src[q + 2] = t[2]; wp(t); }
      pos[q] = t[0]; pos[q + 1] = t[1]; pos[q + 2] = t[2];
    }
    const wu = o && o.wrapU, wv = o && o.wrapV, nrm = new Float64Array(W * R * 3);
    const diff = (a, b, out) => { out[0] = pos[b * 3] - pos[a * 3]; out[1] = pos[b * 3 + 1] - pos[a * 3 + 1]; out[2] = pos[b * 3 + 2] - pos[a * 3 + 2]; return out[0] * out[0] + out[1] * out[1] + out[2] * out[2]; };
    const du = [0, 0, 0], dv = [0, 0, 0];
    let sum = 0, ax = 0, ay = 0, az = 0;
    if (o && o.away) { const a = o.away; ax = e[0] * a[0] + e[4] * a[1] + e[8] * a[2] + e[12]; ay = e[1] * a[0] + e[5] * a[1] + e[9] * a[2] + e[13]; az = e[2] * a[0] + e[6] * a[1] + e[10] * a[2] + e[14]; }
    for (let j = 0; j < R; j++) for (let i = 0; i < W; i++) {
      const i0 = i > 0 ? i - 1 : wu ? nu - 1 : 0, i1 = i < nu ? i + 1 : wu ? 1 : nu, j0 = j > 0 ? j - 1 : wv ? nv - 1 : 0, j1 = j < nv ? j + 1 : wv ? 1 : nv;
      if (diff(j * W + i0, j * W + i1, du) < 1e-14) { const jj = j > 0 ? j - 1 : Math.min(j + 1, nv); diff(jj * W + i0, jj * W + i1, du); }
      if (diff(j0 * W + i, j1 * W + i, dv) < 1e-14) { const ii = i > 0 ? i - 1 : Math.min(i + 1, nu); diff(j0 * W + ii, j1 * W + ii, dv); }
      const q = (j * W + i) * 3;
      let nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0];
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      nrm[q] = nx; nrm[q + 1] = ny; nrm[q + 2] = nz;
      if (o && o.away) sum += nx * (pos[q] - ax) + ny * (pos[q + 1] - ay) + nz * (pos[q + 2] - az);
    }
    let sg = o && o.away ? (sum < 0 ? -1 : 1) : (o && o.flip ? -1 : 1) * (this.flip ? -1 : 1);
    const start = this.n;
    for (let j = 0; j < R; j++) for (let i = 0; i < W; i++) {
      const q = (j * W + i) * 3, c = colFn ? colFn(i, j) : null;
      if (wp) this.rawAt(src[q], src[q + 1], src[q + 2], pos[q], pos[q + 1], pos[q + 2], sg * nrm[q], sg * nrm[q + 1], sg * nrm[q + 2], c);
      else this.raw(pos[q], pos[q + 1], pos[q + 2], sg * nrm[q], sg * nrm[q + 1], sg * nrm[q + 2], c);
    }
    const skip = o && o.skip;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      if (skip && skip(i, j)) continue;
      const a = start + j * W + i, b = a + 1, c = a + W + 1, d = a + W;
      if (sg < 0) this.I.push(a, d, c, a, c, b); else this.I.push(a, b, c, a, c, d);
    }
    return this;
  }
  /** flat polygon from points in order (a fan from the first), one normal */
  poly(pts, colFn = null) {
    this.begin();
    const a = pts[0], b = pts[1], c = pts[pts.length - 1];
    const n = cross(sub3(b, a), sub3(c, a));
    const s = this.n;
    for (let i = 0; i < pts.length; i++) this.v(pts[i][0], pts[i][1], pts[i][2], n[0], n[1], n[2], colFn ? colFn(i) : null);
    for (let i = 1; i < pts.length - 1; i++) this.tri(s, s + i, s + i + 1);
    return this;
  }
  /** box of full size w, h, d centred on the origin; ch > 0 rounds the edges (shared normals, so it shades as a round) */
  box(w, h, d, ch = 0) {
    this.begin();
    if (TIER >= 2 || (TIER === 1 && Math.max(w, h, d) < 0.3)) ch = 0;
    const hx = w / 2, hy = h / 2, hz = d / 2;
    ch = Math.min(ch, hx * 0.9, hy * 0.9, hz * 0.9);
    const hs = [hx, hy, hz], id = [];
    for (let a = 0; a < 3; a++) for (let sg = -1; sg <= 1; sg += 2) {
      const a1 = (a + 1) % 3, a2 = (a + 2) % 3, n = [0, 0, 0]; n[a] = sg;
      const q = [];
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const pt = [0, 0, 0]; pt[a] = sg * hs[a]; pt[a1] = u * (hs[a1] - ch); pt[a2] = v * (hs[a2] - ch);
        q.push(this.v(pt[0], pt[1], pt[2], n[0], n[1], n[2]));
      }
      if (sg > 0) this.quad(q[0], q[1], q[2], q[3]); else this.quad(q[0], q[3], q[2], q[1]);
      id.push(q);
    }
    if (ch > 0) {
      const vtx = (a, sg, u, v) => id[a * 2 + (sg > 0 ? 1 : 0)][v < 0 ? (u < 0 ? 0 : 1) : (u < 0 ? 3 : 2)];
      for (let a = 0; a < 3; a++) {
        const a1 = (a + 1) % 3, a2 = (a + 2) % 3;
        for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
          const p0 = vtx(a1, s1, s2, -1), p1 = vtx(a1, s1, s2, 1), q0 = vtx(a2, s2, -1, s1), q1 = vtx(a2, s2, 1, s1);
          if (s1 * s2 > 0) this.quad(p0, q0, q1, p1); else this.quad(p0, p1, q1, q0);
        }
      }
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const a = vtx(0, sx, sy, sz), b = vtx(1, sy, sz, sx), c = vtx(2, sz, sx, sy);
        if (sx * sy * sz > 0) this.tri(a, b, c); else this.tri(a, c, b);
      }
    }
    return this;
  }
  /** a squared timber between two points (w across, h deep) */
  beam(a, b, w, h = w, ch = 0.008) {
    const len = dist3(a, b);
    if (len < 1e-6) return this;
    const m = aim(a, b);
    this.loc = (this.loc ? this.loc.multiply(m) : m).multiply(_bm.makeTranslation(0, len / 2, 0));
    return this.box(w, len, h, ch);
  }
  /** surface of revolution about Y from a profile [[r, y], ...]; repeat a point to make a crease */
  lathe(prof, sides = 16, arc = TAU, a0 = 0) {
    this.begin();
    if (Q < 1 && sides > 5) sides = Math.max(5, Math.round(sides * Math.max(Q, 0.45)));
    const n = prof.length, nr = [];
    const segN = (i) => { const dr = prof[i + 1][0] - prof[i][0], dy = prof[i + 1][1] - prof[i][1], l = Math.hypot(dr, dy); return l < 1e-9 ? null : [dy / l, -dr / l]; };
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? segN(i - 1) : null, b = i < n - 1 ? segN(i) : null;
      if (a && b) { const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1; nr.push([(a[0] + b[0]) / l, (a[1] + b[1]) / l]); } else nr.push(a || b || [1, 0]);
    }
    const s = this.n, W = sides + 1;
    for (let i = 0; i < n; i++) for (let j = 0; j <= sides; j++) {
      const a = a0 + (arc * j) / sides, c = Math.cos(a), sn = Math.sin(a);
      this.v(prof[i][0] * c, prof[i][1], prof[i][0] * sn, nr[i][0] * c, nr[i][1], nr[i][0] * sn);
    }
    for (let i = 0; i < n - 1; i++) {
      if (Math.hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]) < 1e-9) continue;
      for (let j = 0; j < sides; j++) { const a = s + i * W + j; this.quad(a, a + W, a + W + 1, a + 1); }
    }
    return this;
  }
  /** cylinder along Y, centred; caps: 1 = top, 2 = bottom, 3 = both */
  cyl(rt, rb, h, sides = 12, caps = 3) {
    const pr = [];
    if (caps & 2) pr.push([0, -h / 2], [rb, -h / 2]);
    pr.push([rb, -h / 2], [rt, h / 2]);
    if (caps & 1) pr.push([rt, h / 2], [0, h / 2]);
    return this.lathe(pr, sides);
  }
  /** round bar between two points */
  bar(a, b, ra, rb = ra, sides = 8, caps = 3) {
    const len = dist3(a, b);
    if (len < 1e-6) return this;
    const m = aim(a, b);
    this.loc = this.loc ? this.loc.multiply(m) : m;
    const pr = [];
    if (caps & 2) pr.push([0, 0], [ra, 0]);
    pr.push([ra, 0], [rb, len]);
    if (caps & 1) pr.push([rb, len], [0, len]);
    return this.lathe(pr, sides);
  }
  /** tube through points; r = number or one radius per point; caps close the ends; closed joins last to first */
  tube(pts, r, radial = 6, caps = 0, closed = false) {
    if (!closed && pts.length >= 3 && pts.length <= 6) { const sp = spline(pts, TIER >= 2 ? 2 : TIER === 1 ? 3 : 5, typeof r === 'number' ? null : r); pts = sp.pts; if (sp.rr) r = sp.rr; }   // a few control points mean a curve
    this.begin();
    if (Q < 1 && radial > 3) radial = Math.max(3, Math.round(radial * Q));
    const n = pts.length, s = this.n, W = radial + 1;
    let nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0;
    const rows = closed ? n + 1 : n;
    for (let ii = 0; ii < rows; ii++) {
      const i = ii % n;
      const a = closed ? pts[(i + n - 1) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
      const t = norm3(sub3(b, a));
      if (ii === 0) { const ref = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]; [nx, ny, nz] = norm3(cross(t, ref)); } else {
        const d = nx * t[0] + ny * t[1] + nz * t[2];
        [nx, ny, nz] = norm3([nx - d * t[0], ny - d * t[1], nz - d * t[2]]);
      }
      [px, py, pz] = cross(t, [nx, ny, nz]);
      const rr = typeof r === 'number' ? r : r[i];
      for (let j = 0; j <= radial; j++) {
        const a2 = (TAU * j) / radial, c = Math.cos(a2), sn = Math.sin(a2);
        const ox = nx * c + px * sn, oy = ny * c + py * sn, oz = nz * c + pz * sn;
        this.v(pts[i][0] + ox * rr, pts[i][1] + oy * rr, pts[i][2] + oz * rr, ox, oy, oz);
      }
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < radial; j++) { const a = s + i * W + j; this.quad(a, a + 1, a + W + 1, a + W); }
    if (caps && !closed) for (const end of [0, n - 1]) {
      const t = norm3(sub3(pts[end === 0 ? 0 : n - 1], pts[end === 0 ? 1 : n - 2]));
      const c = this.v(pts[end][0], pts[end][1], pts[end][2], t[0], t[1], t[2]);
      for (let j = 0; j < radial; j++) { const a = s + end * W + j; if (end === 0) this.tri(c, a + 1, a); else this.tri(c, a, a + 1); }
    }
    return this;
  }
  sphere(r, ws = 12, hs = 8) {
    ws = seg(ws, 5); hs = seg(hs, 3);
    const pr = [];
    for (let i = 0; i <= hs; i++) { const a = -PI / 2 + (PI * i) / hs; pr.push([Math.cos(a) * r, Math.sin(a) * r]); }
    pr[0][0] = 0; pr[hs][0] = 0;
    return this.lathe(pr, ws);
  }
  /** ring about the local Y axis: major radius R, tube radius r */
  ring(R, r, sides = 24, radial = 6, arc = TAU, a0 = 0) {
    const n = seg(sides, 8), pts = [], full = arc >= TAU - 1e-6;
    for (let i = 0; i < (full ? n : n + 1); i++) { const a = a0 + (arc * i) / n; pts.push([Math.cos(a) * R, 0, Math.sin(a) * R]); }
    return this.tube(pts, r, radial, full ? 0 : 1, full);
  }
  /** outline [[x, y], ...] in the local XY plane, extruded along Z (centred); holes = [[[x, y], ...], ...] */
  extrude(outline, depth, smoothSides = false, holes = []) {
    this.begin();
    let area = 0;
    for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const pts = area < 0 ? outline.slice().reverse() : outline;
    const all = pts.concat(...holes);
    const tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), holes.map((h) => h.map((q) => new THREE.Vector2(q[0], q[1]))));
    const hz = depth / 2;
    for (const sg of depth > 0 ? [1, -1] : [1]) {
      const s = this.n;
      for (const q of all) this.v(q[0], q[1], sg * hz, 0, 0, sg);
      for (const t of tris) {
        const a = all[t[0]], b = all[t[1]], c = all[t[2]];
        const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
        if (ccw === sg > 0) this.tri(s + t[0], s + t[1], s + t[2]); else this.tri(s + t[0], s + t[2], s + t[1]);
      }
    }
    if (depth <= 0) return this;
    for (const loop of [pts, ...holes]) {
      const n = loop.length;
      let ar = 0;
      for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n]; ar += a[0] * b[1] - b[0] * a[1]; }
      const sgn = loop === pts ? 1 : ar < 0 ? 1 : -1;   // hole walls face into the hole
      const en = (i) => { const a = loop[i], b = loop[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(sgn * (b[1] - a[1])) / l, (-sgn * (b[0] - a[0])) / l]; };
      for (let i = 0; i < n; i++) {
        const a = loop[i], b = loop[(i + 1) % n];
        let na = en(i), nb = na;
        if (smoothSides) { const p0 = en((i + n - 1) % n), p1 = en((i + 1) % n); na = [na[0] + p0[0], na[1] + p0[1]]; nb = [nb[0] + p1[0], nb[1] + p1[1]]; }
        const v0 = this.v(a[0], a[1], hz, na[0], na[1], 0), v1 = this.v(b[0], b[1], hz, nb[0], nb[1], 0), v2 = this.v(b[0], b[1], -hz, nb[0], nb[1], 0), v3 = this.v(a[0], a[1], -hz, na[0], na[1], 0);
        if (sgn > 0) this.quad(v0, v3, v2, v1); else this.quad(v0, v1, v2, v3);
      }
    }
    return this;
  }
  /** any BufferGeometry (keeps its own colour / pbr attributes when present) */
  geo(g, tint = null) {
    this.begin();
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, M = g.attributes.aPbr, s = this.n;
    for (let i = 0; i < P.count; i++) {
      let c = C ? [C.getX(i), C.getY(i), C.getZ(i)] : this.col.slice(0, 3);
      if (tint) c = [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2]];
      if (M) c.push(M.getX(i), M.getY(i), M.getZ(i));
      this.v(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), c);
    }
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) this.tri(s + ix[i], s + ix[i + 1], s + ix[i + 2]); } else for (let i = 0; i < P.count; i += 3) this.tri(s + i, s + i + 1, s + i + 2);
    return this;
  }
  get tris() { return this.I.length / 3; }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.P), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.N), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.C), 3));
    g.setAttribute('aPbr', new THREE.BufferAttribute(new Float32Array(this.M), 3));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const _w = [0, 0, 0], _bm = new THREE.Matrix4();
/** draw something on the starboard side and again mirrored to port; fn(side) with side = 1 | -1 */
function bothSides(p, fn) { fn(1); p.push(MIRROR); fn(-1); p.pop(); }

// ---------- palette and surface tones ----------
const hex = (h) => rgb(h);
const TAR = hex(0x231d18), HEMP = hex(0xb39a68), IRON = hex(0x34353a), STEEL = hex(0x8a9099), GILT = hex(0xd9a83a), BRASS = hex(0xc9a04a), COPPER = hex(0xb86a3c);
const OAK = hex(0x7a5632), PINE = hex(0xb39468), DARKWOOD = hex(0x4a3524), BONE = hex(0xd8cfb4), IVORY = hex(0xe8dfc4), CHAR = hex(0x16120f), RUST = hex(0x7a3d22);
const STONE = hex(0x8d8a84), SLATE = hex(0x565a66), CREAM = hex(0xe6dcc0), EMBER = hex(0xff5a14), GHOST = hex(0x6dffa0), LAMP = hex(0xffb45a);
/** grain running along X (planking) or Y (posts): shade functions for the pen */
const grainX = (amt = 0.16, f = 1) => (x, y, z, nx, ny, nz, c) => mul(c, 1 - amt * 0.5 + amt * noise3(x * 2.3 * f, y * 37 * f + 11, z * 37 * f));
const grainY = (amt = 0.16, f = 1) => (x, y, z, nx, ny, nz, c) => mul(c, 1 - amt * 0.5 + amt * noise3(x * 37 * f, y * 2.3 * f + 5, z * 37 * f));
const grainZ = (amt = 0.16, f = 1) => (x, y, z, nx, ny, nz, c) => mul(c, 1 - amt * 0.5 + amt * noise3(x * 37 * f, y * 37 * f + 5, z * 2.3 * f));
const mottle = (amt = 0.14, f = 9) => (x, y, z, nx, ny, nz, c) => mul(c, 1 - amt * 0.5 + amt * fbm3(x * f, y * f, z * f, 2));

const sculptCache = new Map();
/** a sculpted piece (kit prims), meshed once per resolution */
function sculpted(name, make, res) {
  const k = `${name}|${res}`;
  if (!sculptCache.has(k)) sculptCache.set(k, buildPartGeometry(make(), { res }));
  return sculptCache.get(k);
}
const sculptRes = (r) => Math.round(r * (TIER === 0 ? 1 : TIER === 1 ? 0.62 : 0.4));

// ---------- small shared pieces ----------
/** a rope between two points, sagging by `sag` */
function rope(p, a, b, r = 0.012, col = HEMP, sag = 0, sides = 5) {
  p.shade(null).ink(col, 0.95);
  if (!sag || TIER >= 2) { p.bar(a, b, r, r, TIER >= 2 ? 3 : sides, 0); return; }
  const n = seg(8, 3), pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, q = lerp3(a, b, t); q[1] -= sag * 4 * t * (1 - t); pts.push(q); }
  p.tube(pts, r, sides);
}
/** a chain drawn as a beaded rod (links read as beads from any real distance) */
function chain(p, a, b, r = 0.02, col = IRON, sag = 0) {
  const len = dist3(a, b), n = TIER >= 1 ? 0 : Math.round(len / (r * 3.2));
  p.shade(null).ink(col, 0.5, 0.8);
  const at = (t) => { const q = lerp3(a, b, t); q[1] -= sag * 4 * t * (1 - t); return q; };
  if (!n) { const pts = []; for (let i = 0; i <= 6; i++) pts.push(at(i / 6)); p.tube(pts, r * 0.7, 4); return; }
  for (let i = 0; i < n; i++) { const q0 = at(i / n), q1 = at((i + 1) / n); p.TM(aim(q0, q1).multiply(X(0, dist3(q0, q1) / 2, 0, 0, i % 2 ? 90 : 0, 0, r * 1.5, dist3(q0, q1) * 0.62, r * 0.7))).sphere(1, 6, 4); }
}
/** a lantern hanging from the local origin; the glass glows in `glowCol` */
function lantern(p, s = 1, glowCol = LAMP, metal = BRASS) {
  p.shade(null).ink(metal, 0.4, 0.85);
  p.T(0, -0.02 * s, 0).ring(0.02 * s, 0.005 * s, 10, 4);
  p.T(0, -0.09 * s, 0).lathe([[0, 0.05 * s], [0.035 * s, 0.035 * s], [0.06 * s, 0.01 * s], [0.062 * s, 0], [0.05 * s, 0]], 10);
  p.T(0, -0.25 * s, 0).lathe([[0.05 * s, 0.02 * s], [0.06 * s, 0.012 * s], [0.06 * s, 0], [0.03 * s, -0.012 * s], [0, -0.02 * s]], 10);
  if (TIER < 2) for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; p.bar([Math.cos(a) * 0.05 * s, -0.24 * s, Math.sin(a) * 0.05 * s], [Math.cos(a) * 0.05 * s, -0.09 * s, Math.sin(a) * 0.05 * s], 0.006 * s, 0.006 * s, 4, 0); }
  p.ink(glowCol, 0.3, 0, 1.6).T(0, -0.165 * s, 0).lathe([[0, -0.07 * s], [0.04 * s, -0.06 * s], [0.046 * s, 0], [0.04 * s, 0.06 * s], [0, 0.07 * s]], 10);
}
const GUN = [[0, -0.5], [0.5, -0.48], [0.42, -0.44], [0.9, -0.4], [1, -0.34], [1, -0.28], [0.9, -0.26], [0.86, 0], [0.94, 0.02], [0.84, 0.05], [0.74, 0.36], [0.82, 0.38], [0.72, 0.41], [0.66, 0.6], [0.86, 0.64], [0.74, 0.7], [0.46, 0.7], [0.46, 0.5]];
/** a gun barrel along the local +Y of placement m (breech at -0.5 len, muzzle at +0.7 len) */
function gunBarrel(p, m, len, r, col = IRON, me = 0.8) {
  p.push(m).shade(null).ink(col, 0.45, me);
  const prof = TIER >= 2 ? [[0, -0.5], [0.95, -0.42], [0.84, 0.05], [0.68, 0.6], [0.84, 0.66], [0.46, 0.7]] : GUN;
  p.lathe(prof.map(([a, b]) => [a * r, b * len]), 12);
  if (TIER < 2) p.ink(hex(0x050505), 1).T(0, len * 0.696, 0).cyl(r * 0.45, r * 0.45, 0.002, 8, 1);
  p.pop();
}
/** a flag streaming toward -X from a hoist at the local origin (the top of the hoist), in the side mesh; torn > 0 frays its fly */
function flag(fp, len, hgt, o = {}) {
  const torn = o.torn || 0, nu = seg(o.nu || 16, 4), nv = seg(torn ? 12 : o.nv || 6, 2), tail = o.tail ?? 0.25, wave = o.wave ?? 0.06, ph = o.phase || 0;
  fp.shade(null).ink([1, 1, 1], 0.9);
  fp.grid(nu, nv, (i, j, out) => {
    const u = i / nu, v = j / nv, w = hgt * (1 - (o.taper ?? 0.15) * u);
    const fork = tail && u > 0.6 ? ((u - 0.6) / 0.4) * (1 - Math.abs(v - 0.5) * 2) * len * tail : 0;
    const fray = torn ? 1 - Math.min(0.6, 0.16 * torn) * (0.3 + noise3(v * 6.3 + ph * 2, torn * 3.1, 0.5)) * (0.5 + 0.5 * Math.abs(Math.sin(v * 17 + torn))) : 1;
    out[0] = -(u * len * fray - fork * fray); out[1] = -hgt / 2 + (v - 0.5) * w - u * u * hgt * 0.18; out[2] = Math.sin(u * 7 + v * 1.3 + ph) * wave * u * (1 + len);
  }, (i, j) => { const u = i / nu, v = j / nv, k = (o.band && Math.abs(v - 0.5) < 0.14 ? 0.55 : 1) * (0.86 + 0.14 * Math.cos(u * 7 + ph)) * (torn ? 1 - 0.3 * u * Math.min(1, torn / 3) : 1); return [k, k, k]; });
}
/** a staff from a to b with a finial, in the main mesh */
function staff(p, a, b, r = 0.016, col = DARKWOOD, finial = GILT) {
  p.shade(null).ink(col, 0.8).bar(a, b, r * 1.2, r * 0.8, 6);
  if (TIER < 2) p.ink(finial, 0.35, 0.9).T(b[0], b[1], b[2]).sphere(r * 2, 8, 6);
}
/** a row of rivets / studs along a list of points */
function studs(p, pts, r = 0.014, col = IRON) {
  if (TIER >= 1) return;
  p.shade(null).ink(col, 0.45, 0.8);
  for (const q of pts) p.T(q[0], q[1], q[2]).sphere(r, 5, 3);
}

// =====================================================================================================
// AIRSHIPS
// =====================================================================================================
const STYLES = ['kingdom', 'goblin', 'undead', 'infernal', 'beasts', 'elemental', 'dragons'];
// gondola forms: sm = widest station, ts = transom breadth, pb/eb = bow plan, bowW = square bow breadth (coffin),
// ez/ey = section fullness (small = boxy, 1 = a V), bowRise/sternRise = how far the keel sweeps up, rake = stem rake
const HULLS = {
  kingdom: { sm: 0.45, ts: 0.82, pb: 2.2, eb: 0.75, ez: 0.55, ey: 0.7, bowRise: 0.45, sternRise: 0.2, rake: 0.3, strakes: 9 },
  goblin: { sm: 0.5, ts: 0.92, pb: 3, eb: 0.6, ez: 0.4, ey: 0.5, bowRise: 0.2, sternRise: 0.1, rake: 0.1, strakes: 6 },
  undead: { sm: 0.66, ts: 0.66, bowW: 0.46, pb: 1, eb: 1, ez: 0.28, ey: 0.3, bowRise: 0.1, sternRise: 0.05, rake: 0, strakes: 7 },
  infernal: { sm: 0.42, ts: 0.76, pb: 1.35, eb: 1, ez: 0.75, ey: 0.95, bowRise: 0.5, sternRise: 0.12, rake: 0.6, strakes: 7 },
  beasts: { sm: 0.5, ts: 0.86, pb: 2.6, eb: 0.5, ez: 0.45, ey: 0.5, bowRise: 0.15, sternRise: 0.1, rake: 0, strakes: 9 },
  elemental: { sm: 0.5, ts: 0.78, pb: 1.5, eb: 0.9, ez: 0.32, ey: 0.36, bowRise: 0.3, sternRise: 0.1, rake: 0.2, strakes: 5 },
  dragons: { sm: 0.42, ts: 0.7, pb: 1.9, eb: 0.8, ez: 0.6, ey: 0.8, bowRise: 0.5, sternRise: 0.18, rake: 0.45, strakes: 8 },
};

function styleOf(def) {
  const style = STYLES.includes(def.style) ? def.style : 'kingdom', len = clamp(+def.len || 10, 6, 14);
  const hullC = rgb(def.color ?? 0x7a5230), envC = rgb(def.envelope ?? 0xd8c8a0);
  const st = { style, len, k: len / 10, per: clamp(def.cannons?.perSide ?? 3, 0, 8) | 0, hullC, envC, Lg: 0.55 * len, hb: 0.3 };
  const base = {
    kingdom: { rig: 'rope', rail: 'baluster', frameC: OAK, trim: GILT, metal: BRASS, glowC: LAMP, deckC: PINE, blades: 4 },
    goblin: { rig: 'rope', rail: 'scrap', frameC: DARKWOOD, trim: RUST, metal: hex(0x6a6258), glowC: EMBER, deckC: hex(0x8a7450), blades: 3 },
    undead: { rig: 'chain', rail: 'bone', frameC: BONE, trim: BONE, metal: hex(0x3a3a44), glowC: GHOST, deckC: hex(0x3a3540), blades: 4 },
    infernal: { rig: 'chain', rail: 'spike', frameC: IRON, trim: hex(0x5a2a22), metal: IRON, glowC: EMBER, deckC: hex(0x3a2c2a), blades: 6 },
    beasts: { rig: 'rope', rail: 'basket', frameC: hex(0x9a7a4a), trim: IVORY, metal: hex(0x6a4a2e), glowC: LAMP, deckC: hex(0xa88a5a), blades: 2 },
    elemental: { rig: 'beam', rail: 'stone', frameC: STONE, trim: SLATE, metal: SLATE, glowC: mix(envC, hex(0x2fb8ff), 0.75), deckC: hex(0x9a9890), blades: 4 },
    dragons: { rig: 'chain', rail: 'claw', frameC: BONE, trim: GILT, metal: BRASS, glowC: hex(0xff8a2a), deckC: hex(0x8a5a3a), blades: 4 },
  }[style];
  return Object.assign(st, base);
}

// ---------- damage ----------
/** what a damage level does: holes in the skin, scorching, missing planks, and how the ship is bent */
function damageOf(lvl, st, E, G) {
  const dm = { lvl, blobs: [], chars: [], patches: [] };
  const L = E.L, R = E.R;
  if (lvl === 1) { dm.blobs = [[0.62, 0.55, 0.03, 0.26], [0.36, -0.95, 0.028, 0.24], [0.76, -0.35, 0.022, 0.2]]; dm.patches = [[0.5, -0.5, 0.035, 0.26], [0.28, 0.5, 0.03, 0.22], [0.7, 1.1, 0.03, 0.22]]; }
  if (lvl === 2) { dm.blobs = [[0.6, 0.6, 0.085, 0.75], [0.33, -0.7, 0.1, 0.8], [0.8, -1.2, 0.05, 0.42], [0.46, -0.1, 0.045, 0.34], [0.18, 0.9, 0.05, 0.5]]; dm.patches = [[0.7, 1.4, 0.03, 0.22]]; }
  if (lvl === 3) dm.blobs = [[0.82, 0.5, 0.06, 0.5], [0.72, -0.9, 0.07, 0.6], [0.9, -1.6, 0.04, 0.4]];
  /** > 0 inside a hole; climbs from about -1 well outside it */
  dm.hole = (u, th) => {
    if (!lvl) return -1;
    let h = -1;
    for (const b of dm.blobs) { const a = (u - b[0]) / b[2], c = dAng(th, b[1]) / b[3]; h = Math.max(h, 1 - Math.sqrt(a * a + c * c)); }
    const n = fbm3(u * 22, Math.cos(th) * 3.1 + 5, Math.sin(th) * 3.1, 3) - 0.5;
    if (lvl === 3) h = Math.max(h, (0.6 - u) * 5.5 + (fbm3(u * 7, Math.cos(th) * 1.6, Math.sin(th) * 1.6 + 3, 2) - 0.5) * 3.2 - 0.9 * smooth(2.2, 2.9, Math.abs(th)));
    return h + n * 0.7;
  };
  dm.patch = (u, th) => { let h = -1; for (const b of dm.patches) h = Math.max(h, 1 - Math.max(Math.abs(u - b[0]) / b[2], Math.abs(dAng(th, b[1])) / b[3])); return h; };
  // scorch blobs in model space [x, y, z, radius, strength]: around every hole, and on the gondola
  const tmp = [0, 0, 0];
  for (const b of dm.blobs) { E.pt(b[0], b[1], 0, tmp); dm.chars.push([tmp[0], tmp[1], tmp[2], (b[2] * L + b[3] * R) * 1.25 + 0.3, 0.9]); }
  const Lg = G.Lg;
  if (lvl >= 1) dm.chars.push([Lg * 0.2, -0.3, 0.7, 0.55, 0.85], [-Lg * 0.3, -0.5, -0.7, 0.6, 0.85], [E.L * 0.1, E.cy, R, 0.7, 0.6]);
  if (lvl >= 2) dm.chars.push([Lg * 0.05, -0.2, -0.7, 0.9, 0.95], [-Lg * 0.36, -0.2, 0.75, 1.0, 0.95], [Lg * 0.38, -0.3, 0.3, 0.7, 0.9], [-Lg * 0.1, 0, 0, 0.8, 0.8]);
  if (lvl >= 3) dm.chars.push([-Lg * 0.1, -0.4, 0, 1.5, 1], [-E.L * 0.25, E.cy, 0, R * 2.6, 1], [Lg * 0.3, -0.3, -0.5, 1.1, 0.95]);
  dm.char = (x, y, z) => {
    let k = lvl >= 3 ? 0.42 : 0;
    const j = 0.7 + 0.6 * fbm3(x * 2.6, y * 2.6, z * 2.6, 3);
    for (const c of dm.chars) { const d = Math.hypot(x - c[0], y - c[1], z - c[2]) * j; if (d < c[3]) k = Math.max(k, c[4] * smooth(c[3], c[3] * 0.4, d)); }
    return k;
  };
  dm.post = !lvl ? null : (x, y, z, col, ro, me, gl) => {
    const k = dm.char(x, y, z);
    if (k < 0.02) return null;
    if (lvl >= 2 && k > 0.5 && k < 0.9 && noise3(x * 13, y * 13, z * 13) > 0.8) return [EMBER[0], EMBER[1] * 0.8, EMBER[2], 0.9, 0, 1.5];
    const t = k * 0.94, f = 0.7 + 0.6 * noise3(x * 17, y * 17, z * 17);
    return [lerp(col[0], CHAR[0] * f, t), lerp(col[1], CHAR[1] * f, t), lerp(col[2], CHAR[2] * f, t), lerp(ro, 0.96, k), me * (1 - k), gl * (1 - k) * (1 - k)];
  };
  // missing planks: (x along the hull, strake, side) -> gone
  const xb = -0.1 * Lg;
  dm.xb = xb;
  dm.gone = lvl < 2 ? null : (x, k, side) => {
    if (lvl >= 3 && Math.abs(x - xb) < 0.16 + 0.26 * hash2(k * 3 + (side > 0 ? 1 : 2), 5)) return true;
    return hash2(Math.floor(x * 1.9 + k * 0.37), k * 7 + (side > 0 ? 1 : 40)) > (lvl >= 3 ? 0.8 : 0.9);
  };
  // the bend: the tail of the envelope droops (2), then the whole bag settles and the gondola breaks its back (3)
  const rotZ = (pt, px, py, a) => { const c = Math.cos(a), s = Math.sin(a), dx = pt[0] - px, dy = pt[1] - py; pt[0] = px + dx * c - dy * s; pt[1] = py + dx * s + dy * c; };
  const cyE = E.cy;
  dm.warp = lvl < 2 ? null : (pt) => {
    const y0 = pt[1], w = smooth(0.3, 1.1, y0), x0 = pt[0];
    if (w > 0) {     // envelope and its works
      const e = [x0, y0, pt[2]];
      const xk = -0.2 * L, a = (lvl >= 3 ? 0.3 : 0.17) * smooth(xk + 0.5, xk - 0.6, x0);
      if (a) rotZ(e, xk, cyE - R * 0.5, a);
      if (lvl >= 3) {
        const t = clamp((y0 - cyE) / R, -1, 1), burnt = smooth(0.15 * L, -0.3 * L, x0);
        e[1] -= 0.28 + R * 0.5 * burnt * Math.max(0, t) * (0.6 + 0.8 * noise3(x0 * 1.3, 2, pt[2] * 1.3));
        e[2] *= 1 + 0.12 * burnt;
        rotZ(e, 0.2 * L, cyE - R, -0.07 * smooth(0, 0.4 * L, x0));
      } else e[1] -= 0.16 * R * Math.exp(-Math.pow((x0 - 0.1 * L) / (0.07 * L), 2)) * Math.max(0, (y0 - cyE) / R);
      pt[0] = lerp(pt[0], e[0], w); pt[1] = lerp(pt[1], e[1], w); pt[2] = lerp(pt[2], e[2], w);
    }
    if (lvl >= 3 && w < 1) {   // the gondola breaks abaft the middle: stern and bow both sag
      const g = [x0, y0, pt[2]], aft = smooth(xb + 0.12, xb - 0.12, x0);
      rotZ(g, xb, 0.05, lerp(-0.075, 0.17, aft));
      g[1] -= 0.1 * aft;
      pt[0] = lerp(g[0], pt[0], w); pt[1] = lerp(g[1], pt[1], w); pt[2] = lerp(g[2], pt[2], w);
    }
  };
  return dm;
}

// ---------- the envelope: a skin lofted from a profile ----------
function makeEnv(st) {
  const len = st.len, style = st.style, envC = st.envC;
  const E = { L: 0.92 * len, R: 0.14 * len, x0: 0, nu: 124, nv: 80, uBias: 0.5, skinned: style !== 'elemental' };
  const nose = (t, n) => Math.pow(Math.max(0, 1 - Math.pow(t, n)), 1 / n);
  let um = 0.58, prof, relief = () => 0, skin, open = null, yc = null;
  const two = (um2, fn, ft) => (u) => (u >= um2 ? fn((u - um2) / (1 - um2)) : ft((um2 - u) / um2));
  switch (style) {
    case 'goblin': {
      E.R = 0.15 * len; E.L = 0.9 * len;
      const lobe = (t) => Math.sqrt(Math.max(0, 1 - t * t));
      prof = (u) => { const a = lobe((u - 0.655) / 0.345), b = 0.8 * lobe((u - 0.26) / 0.26), k = 0.14, h = clamp(0.5 + (0.5 * (a - b)) / k, 0, 1); return (lerp(b, a, h) + k * h * (1 - h)) * Math.sqrt(clamp(u / 0.03, 0, 1) * clamp((1 - u) / 0.03, 0, 1)); };
      yc = (u) => -0.1 * E.R * smooth(0.5, 0.2, u);
      const PAL = [envC, mul(envC, 0.8), vary(envC, 3, 0.3), hex(0x7a5a3a), hex(0x5a6a3a), hex(0x8a4a2a), hex(0x6a5a6a), hex(0x9a8a5a)];
      const cell = (u, th) => vor2(u * 10, th * 2.3, 11);
      relief = (u, th) => { const p = prof(u), c = cell(u, th); return E.R * p * (0.1 * (fbm3(u * 6, Math.cos(th) * 1.4, Math.sin(th) * 1.4, 2) - 0.5) + 0.028 * smooth(0, 0.3, c[1] - c[0])); };
      skin = (u, th) => {
        const c = cell(u, th), h = hash1(c[2]), edge = c[1] - c[0];
        const plate = h > 0.84, col = plate ? vary(RUST, c[2], 0.25) : vary(PAL[Math.floor(h * 9.5) % PAL.length], c[2], 0.12);
        const k = (0.82 + 0.3 * fbm3(u * 30, th * 6, 3, 2)) * (0.06 + 0.94 * smooth(0.03, 0.2, edge));
        return [col[0] * k, col[1] * k, col[2] * k, plate ? 0.6 : 0.9, plate ? 0.7 : 0, 0];
      };
      break;
    }
    case 'undead': {
      um = 0.66; E.L = 0.94 * len;
      prof = two(um, (t) => nose(t, 2), (t) => Math.pow(Math.max(0, 1 - Math.pow(t, 1.25)), 1.0) * 0.96 + 0.04 * (1 - t));
      const r0 = 0.17, dr = 0.062, nr = 11, rib = (u) => { const ph = (u - r0) / dr, k = Math.round(ph); return k < 0 || k > nr ? [9, ph] : [Math.abs(ph - k), ph]; };
      const hem = (u) => 2.2 + 0.35 * noise3(u * 24, 1.5, 0.5) - 0.5 * smooth(0.82, 1, u) + 0.5 * smooth(0.14, 0.02, u);
      E.ribs = { r0, dr, nr, hem };
      relief = (u, th) => {
        const p = prof(u), [d, ph] = rib(u), a = Math.abs(th);
        let r = 0.08 * Math.exp(-Math.pow(d / 0.17, 2)) * smooth(hem(u) + 0.25, hem(u) - 0.1, a);
        if (ph > -0.5 && ph < nr + 0.5) r -= 0.045 * (0.5 - 0.5 * Math.cos(TAU * ph)) * smooth(0.25, 0.6, a);
        r += 0.1 * Math.exp(-Math.pow(th / 0.2, 2)) * (0.75 + 0.25 * Math.cos(TAU * ph)) * smooth(0.02, 0.12, u) * smooth(1, 0.9, u);
        return E.R * Math.max(p, 0.25 * smooth(0, 0.05, u) * smooth(1, 0.95, u)) * r;
      };
      open = (u, th) => { const a = Math.abs(th), [d] = rib(u); return Math.max((a - hem(u)) * 2, Math.min((fbm3(u * 11, Math.cos(th) * 2.6, Math.sin(th) * 2.6 + 9, 2) - 0.69) * 6, (d - 0.24) * 4, (a - 0.5) * 2)); };
      skin = (u, th) => {
        const [d] = rib(u), a = Math.abs(th), bone = Math.max(Math.exp(-Math.pow(d / 0.15, 2)) * smooth(hem(u) + 0.2, hem(u), a), Math.exp(-Math.pow(th / 0.17, 2)));
        const m = 0.62 + 0.5 * fbm3(u * 16, Math.cos(th) * 4, Math.sin(th) * 4, 3), vein = smooth(0.48, 0.52, noise3(u * 40, th * 9, 2)) * 0.12;
        const mem = mul(envC, (m - vein) * (0.75 + 0.25 * smooth(2.6, 1, a)));
        return bone > 0.45 ? [...mul(BONE, 0.8 + 0.25 * noise3(u * 50, th * 20, 1)), 0.6, 0, 0] : [...mix(mem, mul(BONE, 0.6), bone), 0.7, 0, 0];
      };
      break;
    }
    case 'infernal': {
      um = 0.55; E.R = 0.132 * len; E.nu = 132;
      prof = two(um, (t) => Math.pow(Math.max(0, 1 - Math.pow(t, 1.75)), 0.92), (t) => Math.pow(Math.max(0, 1 - Math.pow(t, 1.6)), 0.95));
      const NR = 12, NP = 10;
      const seam = (u, th) => { const fu = u * NR, row = Math.floor(fu), a = fu - row, ft = ((th + PI) / TAU) * NP + (row % 2) * 0.5, b = ft - Math.floor(ft); return [Math.min(a, 1 - a), Math.min(b, 1 - b), row, Math.floor(ft)]; };
      relief = (u, th) => { const s = seam(u, th), band = s[2] % 3 === 0 ? Math.exp(-Math.pow(Math.min(u * NR - s[2], 1) / 0.13, 2)) : (s[2] % 3 === 2 ? Math.exp(-Math.pow((1 - (u * NR - s[2])) / 0.13, 2)) : 0); return E.R * prof(u) * (0.035 * band - 0.014 * (smooth(0.1, 0, s[0]) + smooth(0.1, 0, s[1])) * (1 - band)); };
      skin = (u, th) => {
        const s = seam(u, th), fu = u * NR - s[2], band = (s[2] % 3 === 0 && fu < 0.16) || (s[2] % 3 === 2 && fu > 0.84);
        if (band) return [...mul(STEEL, 0.34 + 0.12 * noise3(u * 60, th * 9, 4)), 0.42, 0.85, 0];
        const g = Math.max(smooth(0.11, 0.02, s[0]), smooth(0.11, 0.02, s[1])), hot = smooth(0.3, 0.6, fbm3(u * 6, Math.cos(th) * 1.7, Math.sin(th) * 1.7 + 1, 2));
        const base = mul(vary(envC, s[2] * 31 + s[3], 0.22), 0.75 + 0.4 * fbm3(u * 40, th * 9, 0, 2));
        if (g > 0.25) { const k = g * (0.35 + 0.65 * hot); return [lerp(base[0], EMBER[0], k), lerp(base[1], EMBER[1] * 0.75, k), lerp(base[2], EMBER[2], k), 0.6, 0.3, 1.5 * k * hot]; }
        return [...base, 0.5, 0.75, 0];
      };
      break;
    }
    case 'beasts': {
      um = 0.52; E.R = 0.165 * len; E.L = 0.8 * len; E.nu = 104;
      prof = two(um, (t) => nose(t, 2.3), (t) => nose(t, 2.1));
      const NU = 8, NT = 10;
      E.net = { NU, NT };
      const cell = (u, th) => vor2(u * 6.5, th * 1.7, 23);
      relief = (u, th) => { const p = prof(u), a = Math.abs(Math.sin(PI * u * NU)), b = Math.abs(Math.sin((th * NT) / 2)); return E.R * p * 0.05 * (Math.sqrt(a * b) - 0.6) * smooth(0.04, 0.14, u) * smooth(0.99, 0.9, u); };
      skin = (u, th) => {
        const c = cell(u, th), h = hash1(c[2]), edge = c[1] - c[0];
        let col = h > 0.75 ? mul(envC, 0.62) : h > 0.5 ? mix(envC, hex(0x8a5a36), 0.5) : h > 0.2 ? envC : mix(envC, CREAM, 0.4);
        if (h > 0.9) col = mul(col, noise3(u * 60, th * 14, 5) > 0.62 ? 0.35 : 1.1);   // a spotted pelt
        const k = (0.8 + 0.34 * fbm3(u * 26, th * 6, 7, 3)) * (0.12 + 0.88 * smooth(0.02, 0.17, edge));
        return [col[0] * k, col[1] * k, col[2] * k, 0.92, 0, 0];
      };
      break;
    }
    case 'dragons': {
      um = 0.7; E.L = 0.9 * len; E.R = 0.138 * len; E.x0 = -0.01 * len; E.nu = 150; E.nv = 104; E.uBias = 0.25;
      prof = two(um, (t) => nose(t, 2.3), (t) => Math.pow(Math.max(0, 1 - Math.pow(t, 1.2)), 1.3) * 0.94 + 0.06 * (1 - t) * (1 - t));
      yc = (u) => 0.5 * E.R * Math.pow(Math.max(0, (0.34 - u) / 0.34), 2);
      const NU = Math.round(E.L / 0.3), NT = 26;
      const scale = (u, th) => { const fu = u * NU, row = Math.floor(fu), a = fu - row, ft = ((th + PI) / TAU) * NT + (row % 2) * 0.5, b = ft - Math.floor(ft); return Math.pow(1 - a, 1.1) * (1 - Math.pow(Math.abs(2 * b - 1), 2.6)); };
      relief = (u, th) => E.R * prof(u) * 0.06 * (scale(u, th) - 0.4) * smooth(0, 0.06, u) * smooth(1, 0.94, u);
      const belly = mix(CREAM, GILT, 0.35);
      skin = (u, th) => {
        const h = scale(u, th), a = Math.abs(th), k = (0.5 + 0.75 * h) * (0.88 + 0.24 * noise3(u * 30, th * 7, 2));
        const c = mix(mix(mul(envC, 0.72), envC, smooth(0.2, 1.3, a)), belly, smooth(2.05, 2.5, a));
        return [c[0] * k, c[1] * k, c[2] * k, 0.5, 0.15, 0];
      };
      break;
    }
    case 'elemental':
      prof = two(0.5, (t) => nose(t, 2), (t) => nose(t, 2));
      skin = () => [...envC, 0.5, 0, 0];
      break;
    default: {   // kingdom: sixteen gores, cream and ochre, gilded caps
      E.nv = 96;
      prof = two(um, (t) => nose(t, 2.35), (t) => Math.pow(Math.max(0, 1 - Math.pow(t, 1.85)), 0.74));
      const NG = 16, c2 = mix(envC, hex(0xb07a24), 0.72);
      relief = (u, th) => E.R * prof(u) * 0.034 * (Math.sqrt(Math.abs(Math.cos((NG / 2) * th))) - 1);
      skin = (u, th) => {
        if (u > 0.945 || u < 0.035) return [...mul(GILT, 0.8 + 0.3 * noise3(u * 90, th * 5, 1)), 0.36, 0.9, 0];
        const g = Math.abs(Math.cos((NG / 2) * th)), gi = Math.round(th / (TAU / NG)), fu = u * 13, ring = Math.exp(-Math.pow((fu - Math.round(fu)) / 0.07, 2));
        const band = Math.abs(u - 0.5) < 0.012 || Math.abs(u - 0.93) < 0.012 || Math.abs(u - 0.05) < 0.012;
        const base = band ? hex(0x7a2a2a) : ((gi % 2) + 2) % 2 ? c2 : envC;
        const k = (0.6 + 0.4 * smooth(0, 0.3, g)) * (1 - 0.2 * ring) * (0.92 + 0.14 * fbm3(u * 30, th * 6, 1, 2));
        return [base[0] * k, base[1] * k, base[2] * k, 0.82, 0, 0];
      };
    }
  }
  E.cy = 1.2 + E.R;
  E.prof = prof; E.skin = skin; E.open = open;
  E.yc = (u) => E.cy + (yc ? yc(u) : 0);
  E.rBase = (u) => E.R * prof(u);
  E.r = (u, th) => E.R * prof(u) + relief(u, th);
  /** a point on the skin (u 0 tail .. 1 nose, th 0 on top, +Z at +90 degrees), pushed `off` outward */
  E.pt = (u, th, off = 0, out = [0, 0, 0]) => { const r = Math.max(0, E.r(u, th) + off); out[0] = E.x0 + (u - 0.5) * E.L; out[1] = E.yc(u) + r * Math.cos(th); out[2] = r * Math.sin(th); return out; };
  /** the same without surface relief (the frame, bands and ropes follow this) */
  E.pb = (u, th, off = 0, out = [0, 0, 0]) => { const r = Math.max(0, E.R * prof(u) + off); out[0] = E.x0 + (u - 0.5) * E.L; out[1] = E.yc(u) + r * Math.cos(th); out[2] = r * Math.sin(th); return out; };
  return E;
}

/**
 * Holes with clean edges. hv holds a value per lattice vertex (> 0 inside a hole); U and T hold each vertex's
 * surface parameters. Vertices just inside a hole slide along the lattice to where the value crosses zero, so
 * the rim follows the contour instead of stair-stepping; a quad is dropped only when all four corners are inside.
 */
function snapHoles(hv, W, R, U, T, wrapV = false) {
  const nU = U.slice(), nT = T.slice(), edge = new Uint8Array(hv.length), nv = R - 1;
  for (let j = 0; j < R; j++) for (let i = 0; i < W; i++) {
    const a = j * W + i, h = hv[a];
    if (h <= 0) continue;
    let hn = 0, b = -1;
    const look = (ii, jj) => { if (ii < 0 || ii >= W) return; if (jj < 0) { if (!wrapV) return; jj = nv - 1; } else if (jj > nv) { if (!wrapV) return; jj = 1; } const q = jj * W + ii; if (hv[q] < hn) { hn = hv[q]; b = q; } };
    look(i - 1, j); look(i + 1, j); look(i, j - 1); look(i, j + 1);
    if (b < 0) continue;
    const t = (h / (h - hn)) * 0.97;
    let dT = T[b] - T[a];
    if (wrapV) { if (dT > PI) dT -= TAU; else if (dT < -PI) dT += TAU; }
    nU[a] = U[a] + (U[b] - U[a]) * t; nT[a] = T[a] + dT * t; edge[a] = 1;
  }
  return { U: nU, T: nT, edge, skip: (i, j) => { const a = j * W + i; return hv[a] > 0 && hv[a + 1] > 0 && hv[a + W] > 0 && hv[a + W + 1] > 0; } };
}
function drawEnvelope(p, E, st, dm) {
  const nvMul = st.style === 'kingdom' ? 16 : 4;
  const qe = [1, 0.78, 0.56][TIER];   // the skin's pattern is most of what is seen from afar: it keeps more of its mesh than the fittings do
  const nu = Math.round(E.nu * qe), nv = Math.max(nvMul * 2, Math.round((E.nv * qe) / nvMul) * nvMul), W = nu + 1, R = nv + 1, lvl = dm.lvl;
  const U = new Float32Array(W * R), T = new Float32Array(W * R), hv = new Float32Array(W * R);
  for (let j = 0; j < R; j++) for (let i = 0; i < W; i++) {
    const t = i / nu, u = lerp(t, 0.5 - 0.5 * Math.cos(PI * t), E.uBias), th = -PI + (TAU * j) / nv, a = j * W + i;
    U[a] = u; T[a] = th;
    let h = dm.hole(u, th);
    if (E.open) h = Math.max(h, E.open(u, th));
    hv[a] = h;
  }
  const holes = lvl > 0 || E.open ? snapHoles(hv, W, R, U, T, true) : null, Us = holes ? holes.U : U, Ts = holes ? holes.T : T;
  p.shade(null).ink(st.envC, 0.85);
  p.grid(nu, nv, (i, j, out) => E.pt(Us[j * W + i], Ts[j * W + i], 0, out), (i, j) => {
    const a = j * W + i, u = Us[a], th = Ts[a];
    let c = E.skin(u, th);
    if (!lvl) return c;
    const pa = dm.patch(u, th);
    if (pa > 0) { const edge = pa < 0.16, k = edge ? 0.3 : 1.12; c = [lerp(c[0], 0.5, 0.35) * k, lerp(c[1], 0.44, 0.35) * k, lerp(c[2], 0.34, 0.35) * k, 0.9, 0, 0]; }
    const h = holes.edge[a] ? 0 : dm.hole(u, th);
    if (h > -0.75) { const k = smooth(-0.75, -0.05, h) * 0.95; c = [lerp(c[0], CHAR[0], k), lerp(c[1], CHAR[1], k), lerp(c[2], CHAR[2], k), 0.95, 0, 0]; if (lvl >= 2 && h > -0.1 && noise3(i * 0.9, j * 0.9, 3) > 0.7) c = [EMBER[0], EMBER[1] * 0.8, EMBER[2], 0.9, 0, 1.5]; }
    return c;
  }, { wrapV: true, away: [E.x0, E.cy, 0], skip: holes ? holes.skip : null });
}
/** the frame inside the bag: rings and stringers (seen through tears, and all that is left of a wreck) */
function drawFrame(p, E, st, dm, rings = 9, strs = 8) {
  const c = st.frameC, me = st.style === 'infernal' ? 0.7 : 0, r = 0.032 * st.k, n = seg(28, 10), off = (st.style === 'undead' ? -0.16 : st.style === 'dragons' ? -0.1 : -0.06) * st.k;
  p.shade(null).ink(c, 0.8, me);
  for (let k = 0; k < rings; k++) {
    const u = (k + 1) / (rings + 1), pts = [];
    if (E.rBase(u) < 0.25) continue;
    for (let i = 0; i < n; i++) pts.push(E.pb(u, (i / n) * TAU, off));
    p.tube(pts, r * 1.25, 6, 0, true);
  }
  for (let k = 0; k < strs; k++) {
    const th = ((k + 0.5) / strs) * TAU, pts = [];
    for (let i = 0; i <= n; i++) pts.push(E.pb(lerp(0.03, 0.97, i / n), th, off));
    p.tube(pts, r, 5);
  }
}
/** a cloth laid over the top of the bag in the side colour: u0..u1 along, half-angle a across; it tears where the bag is holed */
function saddle(fp, E, dm, u0, u1, a, o = {}) {
  const nu = seg(o.nu || 40, 8), nv = seg(o.nv || 24, 6), off = o.off ?? 0.02, lvl = dm.lvl, W = nu + 1, R = nv + 1;
  const U = new Float32Array(W * R), T = new Float32Array(W * R), hv = new Float32Array(W * R).fill(-1);
  for (let j = 0; j < R; j++) for (let i = 0; i < W; i++) { const q = j * W + i; U[q] = lerp(u0, u1, i / nu); T[q] = lerp(-a, a, j / nv) * (o.shape ? o.shape(i / nu) : 1); if (lvl) hv[q] = dm.hole(U[q], T[q]) + 0.1; }
  const holes = lvl ? snapHoles(hv, W, R, U, T) : null, Us = holes ? holes.U : U, Ts = holes ? holes.T : T;
  fp.shade(null).ink([1, 1, 1], 0.88);
  fp.grid(nu, nv, (i, j, out) => E.pt(Us[j * W + i], Ts[j * W + i], off, out), (i, j) => {
    const eu = Math.min(i, nu - i) / nu, ev = Math.min(j, nv - j) / nv, e = Math.min(eu * (u1 - u0) * E.L, ev * 2 * a * E.R);
    let k = e < 0.07 ? 0.5 : e < 0.13 ? 1.25 : 1;
    if (o.device && o.device(i / nu, j / nv)) k = 0.42;
    if (lvl) { const h = holes.edge[j * W + i] ? 0 : hv[j * W + i]; if (h > -0.6) k *= 1 - 0.85 * smooth(-0.6, 0, h); }
    k *= 0.9 + 0.2 * fbm3(i * 0.4, j * 0.4, 1, 2);
    return [k, k, k];
  }, { away: [E.x0, E.cy, 0], skip: holes ? holes.skip : null });
}
/** a rope or band lying on the skin: a line of (u, th) points */
function onSkin(p, E, pts, r, col, o = {}) {
  p.shade(null).ink(col, o.ro ?? 0.92, o.me ?? 0);
  p.tube(pts.map(([u, th]) => (o.base ? E.pb(u, th, o.off ?? r * 0.6) : E.pt(u, th, o.off ?? r * 0.6))), r, o.sides || 5, 0, !!o.closed);
}

/**
 * A membrane wing in the local XY plane: bone fingers fan out from the origin, skin stretched between them.
 * fingers = [[angle in degrees from +X toward +Y, length], ...]; mp is the pen that takes the membrane.
 */
function batWing(p, mp, fingers, o = {}) {
  const bone = o.bone || BONE, r = o.r || 0.03, n = seg(10, 4), nw = seg(o.torn ? 10 : 6, 2), curl = o.curl ?? 0.12, torn = o.torn || 0;
  const tip = (k, t) => { const [a, l] = fingers[k], an = (a + curl * 60 * t * t) * DEG; return [Math.cos(an) * l * t, Math.sin(an) * l * t, (o.dish ?? 0.1) * l * t * t]; };
  p.shade(null).ink(bone, 0.6);
  for (let k = 0; k < fingers.length; k++) { const pts = [], rr = []; for (let i = 0; i <= n; i++) { pts.push(tip(k, i / n)); rr.push(r * lerp(1, 0.25, i / n)); } p.tube(pts, rr, 6, 1); }
  if (TIER < 2) p.T(0, 0, 0).sphere(r * 1.5, 8, 6);
  mp.shade(null);
  for (let k = 0; k < fingers.length - 1; k++) {
    mp.grid(n, nw, (i, j, out) => {
      const t = i / n, w = j / nw, rag = torn ? 1 - Math.min(0.5, 0.11 * torn) * (0.2 + noise3(w * 5 + k * 3.7, torn * 1.9, 0.5)) * Math.sin(PI * w) : 1;
      const te = t * (1 - (o.scallop ?? 0.24) * Math.sin(PI * w) * t) * rag, a = tip(k, te), b = tip(k + 1, te);
      out[0] = lerp(a[0], b[0], w); out[1] = lerp(a[1], b[1], w); out[2] = lerp(a[2], b[2], w) - 0.05 * Math.sin(PI * w) * t * fingers[k][1];
    }, (i, j) => (o.col ? o.col(i / n, (k + j / nw) / (fingers.length - 1)) : null));
  }
}
/** a flat fin: outline [[x, y], ...] in the local XY plane, t thick */
function finSlab(p, outline, t, col, ro = 0.85, me = 0, shade = null) {
  p.shade(shade).ink(col, ro, me).extrude(outline, t, true);
}

// ---------- the gondola: a hull lofted from sections ----------
function makeHull(st) {
  const o = HULLS[st.style], Lg = st.Lg, Bh = 0.7, D = 0.9;
  const G = { o, Lg, Bh, D };
  G.half = (s) => {
    s = clamp(s, 0, 1);
    if (s >= o.sm) { const t = (s - o.sm) / (1 - o.sm); return Bh * (o.bowW ? 1 - (1 - o.bowW) * t : Math.pow(Math.max(0, 1 - Math.pow(t, o.pb)), o.eb)); }
    const t = (o.sm - s) / o.sm;
    return Bh * (1 - (1 - o.ts) * (o.bowW ? t : t * t));
  };
  G.depth = (s) => D * (1 - o.bowRise * Math.pow(smooth(0.5, 1, s), 1.5) - o.sternRise * Math.pow(Math.max(0, (0.3 - s) / 0.3), 2));
  G.x = (s, y = 0) => (s - 0.5) * Lg + o.rake * smooth(0.6, 1, s) * (Math.min(y, 0) / D);
  /** a point on the starboard side: v 0 keel .. 1 sheer (deck edge); above 1, v - 1 is the height above the deck */
  // v runs evenly along the girth of the midship section, so strakes come out the same width on a boxy hull as on a round one
  const lut = [0];
  for (let i = 1; i <= 64; i++) { const a = ((i - 1) / 64) * (PI / 2), b = (i / 64) * (PI / 2); lut.push(lut[i - 1] + Math.hypot(Bh * (Math.pow(Math.sin(b), o.ez) - Math.pow(Math.sin(a), o.ez)), D * (Math.pow(Math.cos(b), o.ey) - Math.pow(Math.cos(a), o.ey)))); }
  const tOf = (v) => { const g = clamp(v, 0, 1) * lut[64]; let i = 1; while (i < 64 && lut[i] < g) i++; return ((i - 1 + (g - lut[i - 1]) / (lut[i] - lut[i - 1] || 1)) / 64) * (PI / 2); };
  G.pt = (s, v, off = 0) => {
    const t = tOf(v), h = G.half(s), d = G.depth(s), sn = Math.sin(t), cs = Math.cos(t);
    let z = h * Math.pow(sn, o.ez), y = v > 1 ? v - 1 : -d * Math.pow(cs, o.ey);
    if (off) {
      let nz = 1, ny = 0;
      if (v < 1) { const dz = h * o.ez * Math.pow(Math.max(sn, 0.02), o.ez - 1) * cs, dy = d * o.ey * Math.pow(Math.max(cs, 0.02), o.ey - 1) * sn, l = Math.hypot(dz, dy) || 1; nz = dy / l; ny = -dz / l; }
      z += nz * off; y += ny * off;
    }
    return [G.x(s, y), y, Math.max(0, z)];
  };
  /** half-breadth of the hull at station s and height y (y <= 0) */
  G.zAt = (s, y) => { const d = G.depth(s), c = Math.pow(clamp(-y / d, 0, 1), 1 / o.ey), t = Math.acos(c); return G.half(s) * Math.pow(Math.sin(t), o.ez); };
  G.sOf = (x) => clamp(x / Lg + 0.5, 0, 1);
  return G;
}

/** colour of a plank / plate / block: strake k of n, piece index i, side seed */
function plankTone(st, k, n, i, sd) {
  const hC = st.hullC, seed = k * 131 + i * 17 + sd * 977;
  switch (st.style) {
    case 'goblin': { const h = hash1(seed), c = h > 0.78 ? vary(RUST, seed, 0.2) : h > 0.6 ? vary(hex(0x6f6a60), seed, 0.15) : h > 0.48 ? vary(hex(0x55683a), seed, 0.15) : vary(hC, seed, 0.2); return [...c, h > 0.6 ? 0.6 : 0.88, h > 0.6 ? 0.65 : 0, 0]; }
    case 'undead': return k === n - 1 ? [...vary(BONE, seed, 0.08), 0.6, 0, 0] : [...vary(mix(hC, hex(0x3a2a4a), hash1(seed + 3) * 0.4), seed, 0.14), 0.55, 0.1, 0];
    case 'infernal': return [...vary(hC, seed, 0.2), 0.5, 0.72, 0];
    case 'elemental': return [...vary(k === n - 1 ? mul(hC, 0.8) : hC, seed, 0.1), 0.92, 0, 0];
    case 'dragons': return k === n - 1 ? [...GILT, 0.4, 0.85, 0] : k === 0 ? [...vary(BONE, seed, 0.06), 0.6, 0, 0] : [...vary(hC, seed, 0.12), 0.45, 0.1, 0];
    default: return k === n - 1 ? [...GILT, 0.42, 0.8, 0] : k === n - 3 ? [...vary(hex(0x1f4a44), seed, 0.08), 0.6, 0, 0] : k < 2 ? [...vary(mul(hC, 0.5), seed, 0.1), 0.9, 0, 0] : [...vary(hC, seed, 0.11), 0.8, 0, 0];
  }
}
/** the starboard skin, piece by piece: each plank stands proud of caulked (or glowing) seams */
function planking(p, G, st, dm, side) {
  const o = G.o, n = o.strakes, sd = side > 0 ? 1 : 2, ns = seg(44, 12), Lg = G.Lg;
  if (st.style === 'beasts') return basketSide(p, G, st, dm, side);
  const pl = { goblin: 0.5, elemental: 0.62, infernal: 0.9, undead: 1.5 }[st.style] || 1.7, g = TIER >= 2 ? 0 : st.style === 'elemental' ? 0.012 : 0.008, es = 0.012 / Lg;
  const sTop = o.bowW ? 1 : 0.999;
  const wood = st.style === 'kingdom' || st.style === 'dragons' || st.style === 'undead';
  p.shade(wood ? grainX(0.2) : mottle(0.18, 7));
  for (let k = 0; k < n; k++) {
    const va = k / n, vb = (k + 1) / n, ev = Math.min(0.012, 0.2 / n);
    const cuts = [0];
    for (let c = -hash2(k, 3) * pl, i = 0; c < Lg; i++) { c += pl * (0.7 + 0.6 * hash2(k * 7 + sd, i)); if (c > 0.15 && c < Lg - 0.15) cuts.push(c / Lg); }
    cuts.push(sTop);
    for (let i = 0; i < cuts.length - 1; i++) {
      const sa = cuts[i], sb = cuts[i + 1], xm = ((sa + sb) / 2 - 0.5) * Lg;
      if (dm.gone && dm.gone(xm, k, side)) continue;
      const base = plankTone(st, k, n, i, sd), seamC = st.style === 'infernal' && (k + i) % 2 ? [EMBER[0], EMBER[1] * 0.7, EMBER[2], 0.7, 0, 1.3] : [base[0] * 0.3, base[1] * 0.3, base[2] * 0.3, 0.95, 0, 0];
      const cols = TIER >= 2 ? [[sa, 0]] : [[sa, 1], [Math.min(sa + es, (sa + sb) / 2), 0]];
      for (let j = 1; j < ns; j++) { const s = j / ns; if (s > sa + 2.5 * es && s < sb - 2.5 * es) cols.push([s, 0]); }
      if (TIER >= 2) cols.push([sb, 0]); else cols.push([Math.max(sb - es, (sa + sb) / 2), 0], [sb, 1]);
      const rows = TIER >= 2 ? [[va, 0], [vb, 0]] : [[va, 1], [va + ev, 0], [vb - ev, 0], [vb, 1]];
      p.grid(cols.length - 1, rows.length - 1, (ci, ri, out) => { const q = G.pt(cols[ci][0], rows[ri][0], cols[ci][1] || rows[ri][1] ? -g : 0); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
        (ci, ri) => (cols[ci][1] || rows[ri][1] ? seamC : base), { away: [0, -0.3, 0] });
      if (TIER < 1 && (st.style === 'goblin' || st.style === 'infernal') && sb - sa > 0.06) { const sh = p.fn; p.shade(null); const ink = [p.col, p.ro, p.me, p.gl]; p.ink(mul(IRON, 1.2), 0.5, 0.8); for (const [ss, vv] of [[sa + 0.03 / Lg * 1.4, va + 0.25 / n], [sb - 0.03 / Lg * 1.4, vb - 0.25 / n]]) { const q = G.pt(ss, vv, 0.004); p.T(q[0], q[1], q[2]).sphere(0.017, 5, 3); } p.ink(...ink); p.shade(sh); }
    }
  }
  // rune course of the stone hull
  if (st.style === 'elemental' && TIER < 2) {
    const v = 0.8, gc = null;
    p.shade(null).ink(st.glowC, 0.4, 0, 1.6);
    for (let i = 0; i < 26; i++) { const s = 0.06 + i * 0.034, q = G.pt(s, v, 0.006), h = hash2(i, 7); if (h < 0.25) continue; p.T(q[0], q[1], q[2], 0, 0, h * 90 - 45).box(0.05 + 0.05 * h, 0.018, 0.012, 0); if (h > 0.6) p.T(q[0], q[1] + 0.03, q[2], 0, 0, 90 - h * 60).box(0.045, 0.016, 0.012, 0); }
    void gc;
  }
}
/** woven basket side: weavers passing over and under upright stakes */
function basketSide(p, G, st, dm, side) {
  const NS = Math.round(G.Lg / 0.17), NR = 9, nu = seg(NS * 4, NS), nv = seg(NR * 4, NR), sd = side > 0 ? 0 : 3;
  const straw = hex(0xc2a264), dark = mul(st.hullC, 0.8);
  const wv = (s, v) => { const row = Math.floor(v * NR), fr = v * NR - row; return [(0.5 - 0.5 * Math.cos(TAU * fr)) * (0.5 + 0.5 * Math.sin(TAU * s * NS * 0.5 + PI * row)), row, fr]; };
  p.shade(null).ink(straw, 0.92);
  p.grid(nu, nv, (i, j, out) => { const s = (i / nu) * 0.999, v = 0.03 + 0.97 * (j / nv), q = G.pt(s, v, 0.03 * wv(s, v)[0] - 0.012); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
    (i, j) => { const s = i / nu, v = 0.03 + 0.97 * (j / nv), w = wv(s, v), base = w[1] === 6 || w[1] === 2 ? dark : vary(straw, w[1] * 7 + sd, 0.12), k = 0.38 + 0.75 * w[0]; return [base[0] * k, base[1] * k, base[2] * k]; },
    { away: [0, -0.3, 0], skip: dm.gone ? (i, j) => dm.gone(((i / nu) - 0.5) * G.Lg, Math.floor((j / nv) * NR), side) : null });
}
/** the deck: planks laid fore and aft, dead flat at y = 0 */
function deckPlanks(p, G, st, dm) {
  const w = st.style === 'elemental' ? 0.3 : 0.14, n = Math.ceil(G.Bh / w), ns = seg(30, 8), o = G.o, stone = st.style === 'elemental';
  p.shade(stone ? mottle(0.2, 8) : grainX(0.2));
  for (let m = -n; m < n; m++) {
    const base = vary(st.deckC, m * 13 + 5, 0.1);
    p.ink(base, stone ? 0.95 : 0.85);
    p.grid(ns, 2, (i, j, out) => { const s = (i / ns) * (o.bowW ? 1 : 0.998), h = Math.max(0, G.half(s) - 0.02); out[0] = G.x(s, 0); out[1] = 0; out[2] = clamp((m + j / 2) * w, -h, h); },
      (i, j) => (j === 1 ? mul(base, stone && Math.floor((i / ns) * G.Lg / 0.5 + (m & 1) * 0.5) !== Math.floor(((i + 1) / ns) * G.Lg / 0.5 + (m & 1) * 0.5) ? 0.5 : 1.04) : mul(base, 0.5)), { away: [0, -1, 0] });
  }
  // a low grating hatch amidships and the helm aft: both lie flat or stand at the very ends
  if (TIER < 2 && dm.lvl < 3) {
    p.shade(null).ink(mul(st.deckC, 0.45), 0.9);
    p.T(0.1 * G.Lg, 0.002, 0).box(0.7, 0.004, 0.5, 0);
    p.ink(mul(st.deckC, 0.75), 0.85);
    for (let i = 0; i <= 6; i++) p.T(0.1 * G.Lg - 0.35 + (i * 0.7) / 6, 0.006, 0).box(0.03, 0.01, 0.5, 0);
    for (let i = 0; i <= 4; i++) p.T(0.1 * G.Lg, 0.008, -0.25 + i * 0.125).box(0.7, 0.01, 0.03, 0);
  }
}
/** rails along the deck edge (starboard): each faction fences its deck its own way */
function railing(p, G, st, dm, side) {
  const hb = st.hb, kind = st.rail, o = G.o, lvl = dm.lvl;
  const s0 = 0.02, s1 = o.bowW ? 0.98 : 0.95;
  let gaps = [[st.sLad - 0.2 / G.Lg, st.sLad + 0.2 / G.Lg]];
  if (lvl === 1 && side > 0) gaps.push([0.6, 0.72]);
  if (lvl === 2) gaps.push(side > 0 ? [0.58, 0.8] : [0.14, 0.34]);
  if (lvl >= 3) gaps = side > 0 ? [[s0, 0.74]] : [[0.3, s1]];
  gaps.sort((a, b) => a[0] - b[0]);
  const runs = [];
  let a = s0;
  for (const g of gaps) { if (g[0] > a + 0.02) runs.push([a, g[0]]); a = Math.max(a, g[1]); }
  if (s1 > a + 0.02) runs.push([a, s1]);
  const edge = (s, up = 0, inn = 0.04) => [G.x(s, 0), up, Math.max(0, G.half(s) - inn)];
  for (const [ra, rb] of runs) {
    const len = (rb - ra) * G.Lg, np = Math.max(1, Math.round(len / (kind === 'stone' ? 0.32 : kind === 'basket' ? 0.5 : 0.26)));
    const line = (up, inn, m = 3) => { const pts = []; for (let i = 0; i <= np * m; i++) pts.push(edge(lerp(ra, rb, i / (np * m)), up, inn)); return pts; };
    if (kind === 'basket') {
      const nu = seg(np * 8, np * 2), straw = hex(0xc2a264);
      p.shade(null).ink(straw, 0.92);
      p.grid(nu, seg(8, 3), (i, j, out) => { const s = lerp(ra, rb, i / nu), v = j / seg(8, 3), q = edge(s, v * hb, -0.01 - 0.02 * Math.sin(v * 9) * Math.sin(s * G.Lg * 18)); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
        (i, j) => mul(j % 4 === 2 ? mul(st.hullC, 0.8) : straw, 0.55 + 0.45 * Math.abs(Math.sin((i / nu) * (rb - ra) * G.Lg * 18 + j))), { away: [0, 0.1, 0] });
      p.ink(mul(straw, 0.8), 0.9).tube(line(hb, -0.015), 0.045, 7, 1);
      continue;
    }
    for (let i = 0; i <= np; i++) {
      const s = lerp(ra, rb, i / np), q = edge(s), hsh = hash2(i + (side > 0 ? 0 : 50), Math.round(ra * 100));
      p.push(X(q[0], 0, q[2]));
      if (kind === 'baluster') { p.shade(null).ink(i % 4 === 0 ? st.trim : mul(st.hullC, 1.25), i % 4 === 0 ? 0.4 : 0.75, i % 4 === 0 ? 0.8 : 0); p.lathe([[0.03, 0], [0.03, 0.03], [0.016, 0.05], [0.034, 0.12], [0.02, 0.2], [0.028, 0.24], [0.02, hb - 0.02]].map(([r, y]) => [r, (y * hb) / 0.3]), 8); }
      else if (kind === 'scrap') { p.shade(null).ink(vary(RUST, i * 7, 0.2), 0.7, 0.6).T(0, hb * 0.5 * (0.8 + 0.5 * hsh), 0, 0, 0, (hsh - 0.5) * 12).box(0.035, hb * (0.8 + 0.5 * hsh), 0.035, 0.006); }
      else if (kind === 'bone') { p.shade(null).ink(vary(BONE, i * 3, 0.08), 0.6).tube([[0, 0, 0], [0, hb * 0.5, 0.05], [0, hb * 1.05, 0.03], [0, hb * 1.3, -0.05]], [0.026, 0.02, 0.016, 0.006], 6, 1); }
      else if (kind === 'spike') { p.shade(null).ink(IRON, 0.5, 0.8).T(0, hb * 0.55, 0).cyl(0.016, 0.02, hb * 1.1, 6); p.T(0, hb * 1.1 + 0.07, 0).cyl(0, 0.028, 0.14, 6, 2); }
      else if (kind === 'stone') { const tall = i % 2 === 0; p.shade(mottle(0.2, 9)).ink(vary(st.hullC, i * 5 + 9, 0.1), 0.95).T(0, (tall ? hb * 1.15 : hb * 0.6) / 2, 0.01).box(Math.min(0.3, len / np + 0.01), tall ? hb * 1.15 : hb * 0.6, 0.1, 0.012); if (tall && TIER < 2) p.shade(null).ink(st.glowC, 0.4, 0, 1.5).T(0, hb * 0.75, 0.064).box(0.07, 0.07, 0.012, 0.004); }
      else if (kind === 'claw') { p.shade(null).ink(vary(BONE, i * 3, 0.08), 0.55).tube([[0, 0, 0], [0, hb * 0.6, 0.06], [0, hb * 1.15, 0.02], [0, hb * 1.35, -0.08]], [0.03, 0.024, 0.016, 0.004], 6, 1); }
      p.pop();
    }
    if (kind === 'baluster') { p.shade(grainX(0.15)).ink(st.trim, 0.42, 0.8).tube(line(hb, 0.04), 0.03, 7, 1); if (TIER < 2) p.ink(mul(st.hullC, 1.2), 0.8).tube(line(0.035 * (hb / 0.3), 0.04), 0.02, 5, 1); }
    else if (kind === 'scrap') {
      p.shade(null).ink(vary(RUST, 4, 0.1), 0.6, 0.7).tube(line(hb * 0.95, 0.04, 1).map((q, i) => [q[0], q[1] + 0.04 * (hash1(i * 5 + (side > 0 ? 1 : 9)) - 0.5), q[2]]), 0.022, 6, 1);
      for (let i = 0; i < np; i++) { if (hash2(i, side > 0 ? 3 : 8) < 0.3) continue; const s = lerp(ra, rb, (i + 0.5) / np), q = edge(s, 0, 0.035), h = hb * (0.55 + 0.4 * hash1(i * 13 + 1)); const c = plankTone(st, 1, 6, i, side > 0 ? 5 : 6); p.ink(c, c[3], c[4]).T(q[0], h / 2 + 0.02, q[2], 0, 0, (hash1(i * 3) - 0.5) * 10).box(len / np - 0.03, h, 0.018, 0.004); }
    }
    else if (kind === 'bone') p.shade(null).ink(mul(BONE, 0.9), 0.6).tube(line(hb * 1.02, 0.01), 0.02, 6, 1);
    else if (kind === 'spike') { p.shade(null).ink(IRON, 0.5, 0.8).tube(line(hb * 0.92, 0.04, 1), 0.014, 5); p.tube(line(hb * 0.45, 0.04, 1), 0.012, 5); }
    else if (kind === 'claw') { const pts = line(hb, 0.02, 4).map((q, i) => [q[0], q[1] - 0.07 * Math.abs(Math.sin((PI * i) / 4)), q[2]]); p.shade(null).ink(HEMP, 0.95).tube(pts, 0.016, 5); }
  }
  // a broken length hangs outboard where a rail was shot away
  if ((lvl === 1 && side > 0) || lvl === 2) { const q = edge(side > 0 ? 0.6 : 0.34, 0, 0.02); p.shade(null).ink(mul(st.trim, 0.6), 0.8).beam([q[0], hb * 0.9, q[2]], [q[0] + 0.3, -0.12, q[2] + 0.22], 0.04, 0.04, 0.006); }
}

/** broadside guns behind framed ports; returns the starboard muzzle positions */
function guns(p, G, st, dm) {
  const n = st.per, out = [], y = -0.4, span = Math.min(0.42 * G.Lg, n * 0.75) / 2;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : lerp(-span, span, i / (n - 1)), s = G.sOf(x), z = G.zAt(s, y);
    out.push([+x.toFixed(3), y, +(z + 0.3).toFixed(3)]);
    bothSides(p, () => {
      const fc = st.style === 'kingdom' || st.style === 'dragons' ? st.trim : st.style === 'elemental' ? mul(st.hullC, 0.7) : st.metal, me = st.style === 'elemental' || st.style === 'beasts' ? 0 : 0.75;
      p.shade(null).ink(fc, 0.5, me);
      p.push(X(x, y, z + 0.005));
      p.T(0, 0.13, 0).box(0.32, 0.045, 0.07, 0.01); p.T(0, -0.13, 0).box(0.32, 0.045, 0.07, 0.01); p.T(-0.14, 0, 0).box(0.045, 0.3, 0.07, 0.01); p.T(0.14, 0, 0).box(0.045, 0.3, 0.07, 0.01);
      p.ink(hex(0x070605), 1).T(0, 0, 0.012).box(0.25, 0.23, 0.02, 0);
      if (TIER < 2) { p.ink(mul(fc, 0.8), 0.6, me).T(0, 0.2, 0.05, -38, 0, 0).box(0.3, 0.02, 0.2, 0.004); }   // the port lid, triced up
      p.pop();
      gunBarrel(p, X(x, y, z + 0.02, 90, 0, 0), 0.4, 0.075, st.style === 'elemental' ? SLATE : st.style === 'beasts' ? hex(0x4a3a2e) : IRON);
    });
  }
  return out;
}
/** the bomb bay under the keel: a framed hatch, its doors hanging open on the bombs */
function bombBay(p, G, st) {
  const y = -G.D - 0.012, x = 0.02 * G.Lg, fc = st.style === 'elemental' ? mul(st.hullC, 0.7) : st.metal, me = st.style === 'elemental' ? 0 : 0.75;
  p.shade(null).ink(fc, 0.5, me);
  p.T(x, y, 0.24).box(1.08, 0.05, 0.05, 0.008); p.T(x, y, -0.24).box(1.08, 0.05, 0.05, 0.008); p.T(x - 0.52, y, 0).box(0.05, 0.05, 0.5, 0.008); p.T(x + 0.52, y, 0).box(0.05, 0.05, 0.5, 0.008);
  p.ink(hex(0x060505), 1).T(x, y + 0.012, 0).box(1.0, 0.012, 0.44, 0);
  for (const sg of [1, -1]) p.shade(null).ink(mul(st.hullC, 0.7), 0.8).T(x, y - 0.085, sg * 0.3, sg * 62, 0, 0).box(0.98, 0.022, 0.22, 0.004);
  const n = TIER >= 2 ? 2 : 4;
  for (let i = 0; i < n; i++) {
    p.push(X(x - 0.36 + (i * 0.72) / Math.max(1, n - 1), y - 0.02, 0, 180, 0, 0));
    p.ink(IRON, 0.45, 0.8).lathe([[0, -0.06], [0.04, -0.05], [0.07, 0], [0.085, 0.07], [0.07, 0.15], [0.03, 0.2], [0, 0.21]], 10);
    if (TIER < 2) { p.ink(st.style === 'undead' ? GHOST : hex(0xb02a1a), 0.6, 0, st.style === 'undead' ? 1 : 0).T(0, 0.1, 0).cyl(0.082, 0.086, 0.02, 10, 0); }
    p.pop();
  }
  return [+x.toFixed(3), +(y - 0.1).toFixed(3), 0];
}
/** the stern: a transom with the hangar opening framed in it, the bay inside and the launch rail run out aft */
function sternWorks(p, G, st, dm) {
  const x0 = G.x(0, 0), d0 = G.depth(0), h0 = G.half(0), o = G.o;
  const ow = Math.min(0.42, h0 * 0.76), yT = -0.12, yB = -Math.min(d0 * 0.82, 0.74), db = 1.25;
  const out = [], nv = seg(12, 5);
  for (let i = 0; i <= nv; i++) { const q = G.pt(0, i / nv); out.push([q[2], q[1]]); }
  for (let i = nv; i > 0; i--) { const q = G.pt(0, i / nv); out.push([-q[2], q[1]]); }
  const tc = plankTone(st, 3, o.strakes, 2, 3);
  p.push(X(x0, 0, 0, 0, -90, 0));
  p.shade(st.style === 'kingdom' || st.style === 'dragons' ? grainX(0.2) : mottle(0.16, 8)).ink(tc, tc[3], tc[4]);
  p.T(0, 0, -0.02).extrude(out, 0.05, false, [[[-ow, yB], [ow, yB], [ow, yT], [-ow, yT]]]);
  // the frame of the opening
  const fc = st.style === 'elemental' ? mul(st.hullC, 0.65) : st.trim, me = st.trim === GILT ? 0.8 : st.style === 'infernal' || st.style === 'goblin' ? 0.6 : 0;
  p.shade(null).ink(fc, 0.45, me);
  p.T(0, yT + 0.03, 0.03).box(ow * 2 + 0.16, 0.07, 0.09, 0.012); p.T(0, yB - 0.03, 0.03).box(ow * 2 + 0.16, 0.07, 0.09, 0.012);
  p.T(ow + 0.04, (yT + yB) / 2, 0.03).box(0.08, yT - yB, 0.09, 0.012); p.T(-ow - 0.04, (yT + yB) / 2, 0.03).box(0.08, yT - yB, 0.09, 0.012);
  if (TIER < 2) { p.T(0, yT + 0.1, 0.05).box(0.2, 0.1, 0.06, 0.02); lanternAt(p, [ow + 0.14, yT + 0.2, 0.1], st, 0.9); lanternAt(p, [-ow - 0.14, yT + 0.2, 0.1], st, 0.9); }
  p.pop();
  // the bay: floor, deckhead, sides and the end wall, dark inside
  const xi = x0 + db, wall = mul(st.hullC, 0.42), deep = mul(st.hullC, 0.12);
  const cf = (pts) => p.poly(pts, (i) => (pts[i][0] > x0 + 0.1 ? deep : wall));
  p.shade(null).ink(wall, 0.95);
  cf([[x0, yB, -ow], [x0, yB, ow], [xi, yB, ow], [xi, yB, -ow]]); cf([[x0, yT, -ow], [xi, yT, -ow], [xi, yT, ow], [x0, yT, ow]]);
  cf([[x0, yB, ow], [x0, yT, ow], [xi, yT, ow], [xi, yB, ow]]); cf([[x0, yB, -ow], [xi, yB, -ow], [xi, yT, -ow], [x0, yT, -ow]]);
  cf([[xi, yB, -ow], [xi, yB, ow], [xi, yT, ow], [xi, yT, -ow]]);
  // the launch rail: two rails on ties, run out past the transom on a braced outrigger, with a cradle waiting on it
  const xr0 = x0 + db - 0.25, xr1 = x0 - 0.72, yr = yB + 0.045, zr = Math.min(0.17, ow * 0.5);
  if (dm.lvl < 3) {
    p.shade(null).ink(st.style === 'elemental' ? [...st.glowC, 0.4, 0, 1.2] : mul(STEEL, 0.8), 0.4, 0.85);
    for (const sg of [1, -1]) { p.T((xr0 + xr1) / 2, yr, sg * zr).box(xr0 - xr1, 0.04, 0.035, 0.006); p.T(xr1 - 0.01, yr + 0.05, sg * zr).box(0.04, 0.1, 0.05, 0.008); }
    p.shade(grainZ(0.15)).ink(st.style === 'elemental' ? mul(st.hullC, 0.7) : mul(st.hullC, 0.8), 0.85);
    const nt = seg(9, 4);
    for (let i = 0; i < nt; i++) p.T(lerp(xr1 + 0.06, xr0 - 0.05, i / (nt - 1)), yr - 0.03, 0).box(0.06, 0.03, zr * 2 + 0.14, 0.006);
    for (const sg of [1, -1]) { p.beam([xr1 + 0.05, yr - 0.04, sg * zr], [x0 + 0.02, yB - 0.34 + (d0 + yB) * 0.5, sg * zr * 0.8], 0.045, 0.045, 0.008); p.beam([xr1 + 0.4, yr - 0.04, sg * zr], [x0 + 0.02, yB - 0.2 + (d0 + yB) * 0.5, sg * zr * 0.8], 0.035, 0.035, 0.006); }
    if (TIER < 2) { p.shade(null).ink(mul(st.metal, 0.9), 0.5, 0.7).T(x0 + 0.3, yr + 0.05, 0).box(0.3, 0.035, zr * 2 + 0.1, 0.008); for (const sg of [1, -1]) for (const dx of [-0.1, 0.1]) p.T(x0 + 0.3 + dx, yr + 0.035, sg * zr, 90, 0, 0).cyl(0.03, 0.03, 0.03, 8); }
  }
  return { hangar: [+(x0 - 0.75).toFixed(3), +(yB + 0.32).toFixed(3), 0], yB, yT, ow };
}
function lanternAt(p, q, st, s = 1) { p.push(X(q[0], q[1], q[2])); lantern(p, s, st.glowC, st.metal); p.pop(); }

/** a rolled rope ladder lashed on the rail, its axis fore and aft */
function ladderRoll(p, st) {
  const rc = st.style === 'undead' || st.style === 'infernal' ? IRON : HEMP, wood = st.style === 'undead' ? BONE : OAK;
  p.shade(null).ink(wood, 0.8);
  const n = seg(11, 5);
  for (let i = 0; i < n; i++) { const a = i * 2.1, r = 0.035 + 0.075 * (i / n); p.T(0, Math.sin(a) * r, Math.cos(a) * r, 0, 0, 90).cyl(0.014, 0.014, 0.34, 5); }
  p.ink(rc, 0.95, rc === IRON ? 0.7 : 0);
  for (const sg of [1, -1]) for (const r of [0.05, 0.085, 0.118]) p.T(sg * 0.15, 0, 0, 0, 0, 90).ring(r, 0.016, 12, 4);
  if (TIER < 2) for (const sg of [1, -1]) p.T(sg * 0.07, 0, 0, 0, 0, 90).ring(0.128, 0.011, 12, 4);
}
/** a davit over the side with a drop pod hanging from it (starboard); returns where the pod's base is */
function podRack(p, fp, G, st, x, dm) {
  const s = G.sOf(x), h = G.half(s), zp = 1.06, sc = 0.7, yb = -0.84;
  const wood = st.style === 'infernal' || st.style === 'goblin' || st.style === 'undead' ? st.metal : st.style === 'elemental' ? st.hullC : st.style === 'beasts' || st.style === 'dragons' ? BONE : OAK, me = wood === st.metal ? 0.7 : 0;
  p.shade(null).ink(wood, 0.7, me);
  p.tube([[x, -0.05, h - 0.06], [x, 0.3, h + 0.02], [x, 0.5, h + 0.2], [x, 0.44, zp - 0.1], [x, 0.36, zp]], [0.045, 0.042, 0.036, 0.03, 0.026], 7, 1);
  if (TIER < 2) p.beam([x, 0.02, h - 0.02], [x, 0.3, h + 0.16], 0.03, 0.03, 0.005);
  if (dm.lvl >= 3) return [x, yb, zp];
  if (st.rig === 'chain') chain(p, [x, 0.36, zp], [x, yb + 1.1 * sc - 0.02, zp], 0.016); else rope(p, [x, 0.36, zp], [x, yb + 1.1 * sc - 0.02, zp], 0.014, st.style === 'elemental' ? st.glowC : HEMP);
  const m = X(x, yb, zp, 0, 0, 0, sc);
  p.push(m); fp.push(m); drawPod(p, fp, st.style, true); p.pop(); fp.pop();
  return [x, yb, zp];
}

/** lines from the gondola up to the bag: rope, chain or strut by faction; a wreck keeps few */
function rigging(p, E, G, st, dm) {
  if (!E.skinned) return;
  const K = 5, lvl = dm.lvl;
  bothSides(p, (side) => {
    for (let k = 0; k < K; k++) {
      if (lvl >= 3 && (k + (side > 0 ? 0 : 1)) % 3 !== 0) continue;
      if (lvl === 2 && k === 3 && side > 0) continue;
      const s = lerp(0.07, 0.9, k / (K - 1)), a = [G.x(s, 0), st.rail === 'basket' ? st.hb : 0.02, Math.max(0.05, G.half(s) - 0.05)];
      const u = clamp(0.5 + ((a[0] - E.x0) / E.L) * 1.55, 0.2, 0.84), b = E.pb(u, PI - 0.78, -0.02);
      if (st.rig === 'chain') chain(p, a, b, 0.02, st.style === 'dragons' ? mul(BRASS, 0.7) : IRON);
      else rope(p, a, b, 0.016, HEMP);
      if (st.rig === 'rope' && TIER < 2 && lvl < 3 && k < K - 1) { const s2 = lerp(0.07, 0.9, (k + 1) / (K - 1)), a2 = [G.x(s2, 0), a[1], Math.max(0.05, G.half(s2) - 0.05)]; rope(p, a2, b, 0.011, HEMP); }
    }
    // the catenary band the lines hang from
    if (TIER < 2 && lvl < 3) { const pts = []; for (let i = 0; i <= 20; i++) pts.push([lerp(0.2, 0.84, i / 20), PI - 0.78]); onSkin(p, E, pts, 0.022, st.rig === 'chain' ? IRON : mul(HEMP, 0.8), { me: st.rig === 'chain' ? 0.7 : 0 }); }
  });
}

/** engine pods on outriggers at the quarters; returns the hub position of each propeller */
function engines(p, G, st, dm) {
  const xe = -G.Lg / 2 + 0.5, ye = -0.32, ze = 1.22, se = G.sOf(xe), style = st.style, hubs = [];
  const body = { kingdom: OAK, goblin: vary(RUST, 2, 0.1), undead: hex(0x34303c), infernal: IRON, beasts: hex(0x8a6a44), elemental: st.hullC, dragons: st.hullC }[style];
  const me = style === 'goblin' || style === 'infernal' ? 0.7 : style === 'undead' ? 0.4 : 0;
  bothSides(p, () => {
    const zh = G.zAt(se, ye);
    if (style !== 'elemental') {
      p.shade(null).ink(style === 'beasts' || style === 'undead' || style === 'dragons' ? BONE : style === 'kingdom' ? OAK : st.metal, 0.7, style === 'kingdom' || style === 'beasts' || style === 'undead' || style === 'dragons' ? 0 : 0.7);
      p.beam([xe + 0.18, ye + 0.06, zh - 0.05], [xe + 0.12, ye + 0.02, ze], 0.07, 0.05, 0.01);
      p.beam([xe - 0.2, ye + 0.06, zh - 0.05], [xe - 0.12, ye + 0.02, ze], 0.07, 0.05, 0.01);
      if (TIER < 2) p.beam([xe, -0.02, zh - 0.03], [xe, ye + 0.12, ze - 0.05], 0.035, 0.035, 0.006);
    } else { p.shade(null).ink(st.glowC, 0.4, 0, 1.4).bar([xe, ye, zh - 0.02], [xe, ye, ze - 0.2], 0.02, 0.02, 6, 0); }
    p.push(X(xe, ye, ze, 0, 0, -90));
    p.shade(style === 'kingdom' || style === 'beasts' ? grainY(0.2) : mottle(0.2, 8)).ink(body, style === 'elemental' ? 0.95 : 0.6, me);
    p.lathe([[0, -0.36], [0.07, -0.35], [0.13, -0.28], [0.19, -0.1], [0.2, 0.08], [0.17, 0.25], [0.1, 0.38], [0, 0.43]], 16);
    p.shade(null).ink(st.style === 'elemental' ? st.glowC : st.metal === IRON ? STEEL : st.metal, 0.4, style === 'elemental' ? 0 : 0.85, style === 'elemental' ? 1.4 : 0);
    for (const y of [-0.2, 0.02, 0.22]) p.T(0, y, 0).ring(y === 0.02 ? 0.203 : y < 0 ? 0.165 : 0.185, 0.014, 18, 5);
    if (style === 'goblin' || style === 'infernal') { p.ink(IRON, 0.6, 0.7).tube([[0.12, 0.1, 0], [0.26, 0.12, 0], [0.34, 0.02, 0], [0.5, -0.02, 0.03]], 0.035, 7, 0); p.ink(EMBER, 0.5, 0, 1.5); for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; p.T(Math.cos(a) * 0.196, 0.12, Math.sin(a) * 0.196, 0, -a / DEG, 0).box(0.012, 0.09, 0.04, 0); } }
    if (style === 'undead') { p.ink(GHOST, 0.4, 0, 1.6).T(0, 0.12, 0).ring(0.19, 0.016, 18, 5); }
    if (style === 'dragons' || style === 'kingdom') { p.ink(st.trim, 0.4, 0.85).T(0, 0.43, 0).sphere(0.03, 8, 6); }
    p.pop();
  });
  hubs.push([xe - 0.4, ye, ze], [xe - 0.4, ye, -ze]);
  return hubs;
}
/** one propeller about the origin, axis along X, boss pointing aft; broken = a wrecked one (blades gone or snapped) */
function drawProp(p, st, broken) {
  const style = st.style, n = st.blades, R = { beasts: 0.6, infernal: 0.5, goblin: 0.5 }[style] || 0.54;
  p.push(X(0, 0, 0, 0, 0, 90));    // local +Y -> -X (aft)
  p.shade(null).ink(style === 'elemental' ? st.hullC : st.metal, 0.4, style === 'elemental' ? 0 : 0.85);
  p.lathe([[0.06, -0.06], [0.075, -0.04], [0.075, 0.03], [0.05, 0.1], [0, 0.15]], 12);
  p.pop();
  const shapes = {
    kingdom: [[-0.035, 0.04], [0.035, 0.04], [0.08, 0.3], [0.085, 0.75], [0.05, 0.96], [0, 1], [-0.05, 0.96], [-0.085, 0.75], [-0.08, 0.3]],
    goblin: [[-0.04, 0.04], [0.04, 0.04], [0.12, 0.5], [0.16, 0.92], [0.02, 1], [-0.14, 0.9], [-0.1, 0.5]],
    undead: [[-0.03, 0.04], [0.03, 0.04], [0.05, 0.5], [0.16, 0.8], [0.3, 0.92], [0.12, 1], [-0.05, 0.9], [-0.08, 0.5]],
    infernal: [[-0.04, 0.04], [0.04, 0.04], [0.1, 0.45], [0.05, 0.6], [0.12, 0.8], [0, 1], [-0.07, 0.7], [-0.06, 0.3]],
    beasts: [[-0.03, 0.04], [0.03, 0.04], [0.05, 0.35], [0.2, 0.5], [0.22, 0.9], [0.1, 1], [-0.1, 1], [-0.22, 0.9], [-0.2, 0.5], [-0.05, 0.35]],
    elemental: [[-0.02, 0.2], [0.02, 0.2], [0.1, 0.55], [0.06, 0.85], [0, 1], [-0.06, 0.85], [-0.1, 0.55]],
    dragons: [[-0.03, 0.04], [0.03, 0.04], [0.06, 0.4], [0.2, 0.62], [0.12, 0.72], [0.18, 0.86], [0.02, 1], [-0.08, 0.8], [-0.07, 0.4]],
  }[style];
  const col = { kingdom: OAK, goblin: vary(RUST, 5, 0.1), undead: BONE, infernal: IRON, beasts: hex(0xa88a5a), elemental: st.glowC, dragons: mul(st.envC, 0.9) }[style];
  const me = style === 'goblin' || style === 'infernal' ? 0.75 : 0, gl = style === 'elemental' && !broken ? 1.2 : 0;
  for (let i = 0; i < n; i++) {
    if (broken && i % 2 === 1) continue;
    const cut = broken && i === 0 ? 0.5 : 1;
    p.push(X(0, 0, 0, (i / n) * 360 + (broken ? 17 : 0), 0, 0));
    p.shade(style === 'kingdom' || style === 'beasts' ? grainY(0.2) : null).ink(broken ? mix(col, CHAR, 0.7) : col, 0.6, me, gl);
    p.T(0, 0, 0, 0, 62, 0).extrude(shapes.filter((q) => q[1] <= cut + 0.01).map(([a, b]) => [a * R * 1.1, b * R]), 0.024, true);
    if (style === 'kingdom' && !broken && TIER < 2) p.shade(null).ink(BRASS, 0.4, 0.85).T(0, R * 0.9, 0, 0, 62, 0).box(0.09 * R * 1.4, 0.16 * R, 0.03, 0.006);
    p.pop();
  }
}

// ---------- drop pods ----------
const POD = {
  kingdom: { body: hex(0x8a8f96), me: 0.45, band: BRASS, bme: 0.85, glow: LAMP, f: [1, 1, 1] },
  goblin: { body: hex(0x7a4a2c), me: 0.6, band: hex(0x55524c), bme: 0.7, glow: EMBER, f: [1.04, 1.02, 0.9] },
  undead: { body: hex(0x2c2a34), me: 0.5, band: BONE, bme: 0, glow: GHOST, f: [0.9, 1, 0.92] },
  infernal: { body: hex(0x2a2022), me: 0.75, band: hex(0x5a2a22), bme: 0.6, glow: EMBER, f: [0.95, 1.04, 0.9] },
  beasts: { body: hex(0x8a6238), me: 0, band: hex(0x4a3524), bme: 0, glow: LAMP, f: [1, 1.04, 1.02] },
  elemental: { body: hex(0x85838c), me: 0, band: hex(0x5a5e6c), bme: 0, glow: hex(0x7ad0ff), f: [0.94, 1.04, 0.8] },
  dragons: { body: hex(0x7a2a22), me: 0.25, band: GILT, bme: 0.85, glow: hex(0xff8a2a), f: [1, 1, 0.86] },
};
const POD_PROF = [[0.2, 0.06], [0.31, 0.12], [0.385, 0.3], [0.4, 0.5], [0.365, 0.7], [0.27, 0.86], [0.2, 0.92]];
/** an armoured drop pod, 0.8 wide and 1.1 tall, base at the origin; rack = the lighter copy hung on an airship */
function drawPod(p, fp, style, rack = false) {
  const P = POD[style] || POD.kingdom, f = P.f, lite = rack || TIER >= 1;
  const prof = POD_PROF.map(([r, y]) => [r * (y < 0.25 ? f[0] : y < 0.6 ? f[1] : f[2]), y]);
  const rAt = (y) => { for (let i = 0; i < prof.length - 1; i++) if (y <= prof[i + 1][1]) return lerp(prof[i][0], prof[i + 1][0], (y - prof[i][1]) / (prof[i + 1][1] - prof[i][1])); return prof[prof.length - 1][0]; };
  const sm = [];   // the profile, rounded
  for (let i = 0; i <= 14; i++) { const y = lerp(0.06, 0.92, i / 14), t = (i / 14) * (prof.length - 1), a = Math.min(prof.length - 2, Math.floor(t)), w = t - a; void y; const q0 = prof[Math.max(0, a - 1)], q1 = prof[a], q2 = prof[a + 1], q3 = prof[Math.min(prof.length - 1, a + 2)]; const cr = (k) => 0.5 * (2 * q1[k] + (q2[k] - q0[k]) * w + (2 * q0[k] - 5 * q1[k] + 4 * q2[k] - q3[k]) * w * w + (3 * q1[k] - q0[k] - 3 * q2[k] + q3[k]) * w * w * w); sm.push([cr(0), cr(1)]); }
  const rs = (y) => { for (let i = 0; i < sm.length - 1; i++) if (y <= sm[i + 1][1]) return lerp(sm[i][0], sm[i + 1][0], (y - sm[i][1]) / (sm[i + 1][1] - sm[i][1])); return sm[sm.length - 1][0]; };
  void rAt;
  const stone = style === 'elemental', hide = style === 'beasts';
  p.shade(mottle(stone ? 0.25 : 0.18, 9)).ink(P.body, stone || hide ? 0.9 : 0.5, P.me);
  p.lathe([[0, 0.05], [0.12, 0.045], ...sm, [0.2, 0.93], [0.13, 0.945], [0, 0.95]], rack ? 14 : 28);
  // plate ribs up the sides, and the hoops that bind them
  const nr = lite ? 6 : 8;
  p.shade(null).ink(mul(P.body, 0.7), 0.6, P.me);
  for (let i = 0; i < nr; i++) { const a = ((i + 0.5) / nr) * TAU, c = Math.cos(a), s = Math.sin(a); p.tube(sm.filter((q, k) => k % 2 === 0).map(([r, y]) => [c * (r + 0.004), y, s * (r + 0.004)]), 0.016, lite ? 4 : 6, 1); }
  p.ink(P.band, 0.42, P.bme);
  for (const y of [0.2, 0.46, 0.76]) {
    p.T(0, y, 0).lathe([[rs(y - 0.03) + 0.004, -0.03], [rs(y) + 0.02, -0.022], [rs(y) + 0.022, 0.022], [rs(y + 0.03) + 0.004, 0.03]], rack ? 14 : 28);
    if (!lite) for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; p.T(Math.cos(a) * (rs(y) + 0.022), y, Math.sin(a) * (rs(y) + 0.022)).sphere(0.012, 5, 3); }
  }
  // the door, facing +Z, with a slit of light
  p.push(X(0, 0.47, rs(0.47) - 0.012));
  p.ink(mul(P.body, 1.25), 0.5, P.me).box(0.25, 0.4, 0.05, 0.02);
  p.ink(P.band, 0.42, P.bme).T(0, 0.19, 0.008).box(0.28, 0.035, 0.05, 0.008); p.T(0, -0.19, 0.008).box(0.28, 0.035, 0.05, 0.008);
  p.ink(P.glow, 0.4, 0, 1.6).T(0, 0.09, 0.022).box(0.13, 0.035, 0.012, 0.004);
  if (!lite) { p.ink(P.band, 0.42, P.bme).T(0.08, -0.04, 0.035, 0, 0, 90).ring(0.03, 0.007, 10, 4); for (const sx of [-1, 1]) for (const sy of [-1, 1]) p.T(sx * 0.1, sy * 0.19, 0.036).sphere(0.012, 5, 3); }
  p.pop();
  // three sprung feet
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5, c = Math.cos(a), s = Math.sin(a);
    p.ink(P.band, 0.45, P.bme).beam([c * 0.26, 0.2, s * 0.26], [c * 0.37, 0.03, s * 0.37], 0.045, 0.035, 0.008);
    p.T(c * 0.375, 0.015, s * 0.375).cyl(0.05, 0.06, 0.03, 8);
  }
  // the drogue pack on top: a strapped canister, its cap and four fins in the side colour
  p.shade(null).ink(hide ? hex(0xb89a6a) : CREAM, 0.9).T(0, 1.0, 0).lathe([[0.14, -0.07], [0.165, -0.04], [0.165, 0.03], [0.12, 0.075], [0, 0.085]], rack ? 10 : 18);
  if (!lite) { p.ink(HEMP, 0.95); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; p.tube([[Math.cos(a) * 0.168, 0.93, Math.sin(a) * 0.168], [Math.cos(a) * 0.17, 1.03, Math.sin(a) * 0.17], [Math.cos(a) * 0.08, 1.085, Math.sin(a) * 0.08]], 0.008, 4); } p.ink(P.band, 0.42, P.bme).T(0, 1.095, 0, 90, 0, 0).ring(0.03, 0.008, 10, 4); }
  fp.shade(null).ink([1, 1, 1], 0.7);
  fp.T(0, 0.61, 0).lathe([[rs(0.56) + 0.008, -0.05], [rs(0.61) + 0.01, 0], [rs(0.66) + 0.008, 0.05]], rack ? 14 : 28);
  fp.T(0, 0.985, 0).lathe([[0.169, -0.03], [0.169, 0.02]], rack ? 10 : 18);
  for (let i = 0; i < 4; i++) fp.T(0, 0, 0, 0, i * 90 + 45, 0).extrude([[0.2, 0.74], [0.4, 0.8], [0.45, 1.08], [0.38, 1.1], [0.17, 0.97]], 0.022, true);
}

// ---------- sculpted figureheads ----------
/** a great fanged skull facing +Z, about 0.7 across */
const skullPart = () => {
  const c = 0xd6ccb0;
  return {
    prims: [
      S.ellipsoid(0.3, 0.29, 0.33).at(0, 0.1, -0.02).color(c).bump(0.006, 30).tint(0.2, 14),
      S.ellipsoid(0.2, 0.15, 0.17).at(0, -0.13, 0.2).color(c).blend(0.07),
      S.mirrorX([S.ellipsoid(0.07, 0.05, 0.12).at(0.2, -0.06, 0.12).color(c).blend(0.05)]),
      S.ellipsoid(0.24, 0.045, 0.06).at(0, 0.13, 0.29).color(c).blend(0.04),
      S.mirrorX([S.sphere(0.092).at(0.125, 0.04, 0.275).color(0x0a0c0a).cut(0.02)]),
      S.ellipsoid(0.04, 0.07, 0.06).at(0, -0.08, 0.36).rot(0, 0, 0).color(0x15120e).cut(0.012),
      S.box(0.3, 0.02, 0.2, 0.01).at(0, -0.215, 0.26).color(0x221c14).cut(0.006),
    ],
    hard: [
      ...HP.mirrorX([HP.sphere(0.055, 14).at(0.125, 0.04, 0.24).color(0x6dffa0).glow(1.8)]),
      ...[-3, -2, -1, 0, 1, 2, 3].flatMap((i) => [HP.cone(0.022, i % 3 === 0 ? 0.12 : 0.07, 8).rot(180, 0, 0).at(i * 0.045, -0.26 - (i % 3 === 0 ? 0.02 : 0), 0.33 - Math.abs(i) * 0.012).color(0xe8e0c8)]),
    ],
  };
};
/** a horned dragon skull, snout toward +Z, about 1.1 long */
const drakeSkullPart = () => {
  const c = 0xd9cfb2;
  return {
    prims: [
      S.ellipsoid(0.21, 0.17, 0.26).at(0, 0.06, -0.1).color(c).bump(0.006, 26).tint(0.2, 12),
      S.capsule([0, 0.02, 0.08], [0, -0.05, 0.6], 0.15, 0.085).color(c).blend(0.06),
      S.mirrorX([S.ellipsoid(0.05, 0.035, 0.07).at(0.05, 0.0, 0.64).color(c).blend(0.03)]),
      S.mirrorX([S.ellipsoid(0.06, 0.05, 0.14).at(0.15, 0.13, 0.02).rot(0, 12, 0).color(c).blend(0.04)]),
      S.mirrorX(S.limb([[0.13, 0.17, -0.22], [0.2, 0.3, -0.42], [0.25, 0.48, -0.56], [0.24, 0.66, -0.6]], [0.075, 0.06, 0.04, 0.012]).map((q) => q.color(0x6a5a44).blend(0.03).bump(0.006, 40, 'ridges'))),
      S.mirrorX(S.limb([[0.17, -0.02, -0.16], [0.3, -0.04, -0.3], [0.36, 0.0, -0.44]], [0.05, 0.035, 0.01]).map((q) => q.color(c).blend(0.03))),
      S.capsule([0, -0.14, -0.02], [0, -0.2, 0.5], 0.1, 0.06).color(c).blend(0.01),
      S.box(0.5, 0.035, 0.7, 0.015).at(0, -0.1, 0.36).rot(6, 0, 0).color(0x1c1610).cut(0.01),
      S.mirrorX([S.ellipsoid(0.07, 0.055, 0.08).at(0.15, 0.06, 0.06).color(0x0c0a08).cut(0.02)]),
      S.mirrorX([S.ellipsoid(0.02, 0.014, 0.03).at(0.045, 0.02, 0.69).color(0x15120e).cut(0.008)]),
    ],
    hard: [
      ...HP.mirrorX([HP.sphere(0.04, 12).at(0.14, 0.06, 0.05).color(0xff7a1a).glow(1.8)]),
      ...[0, 1, 2, 3, 4, 5].flatMap((i) => HP.mirrorX([HP.cone(0.018, i === 4 ? 0.11 : 0.065, 7).rot(180, 0, 0).at(0.115 - i * 0.012, -0.105 - i * 0.008, 0.18 + i * 0.08).color(0xf0e8d0)])),
      ...[0, 1, 2, 3].flatMap((i) => HP.mirrorX([HP.cone(0.016, 0.06, 7).at(0.085 - i * 0.008, -0.155 - i * 0.012, 0.2 + i * 0.085).color(0xf0e8d0)])),
    ],
  };
};

// ---------- what each faction adds ----------
/** placement on the bag: origin on the bare skin at (u, th), local X forward, local Y straight out */
const onBag = (E, u, th, off = 0) => frame(E.pb(u, th, off), [1, 0, 0], [0, Math.cos(th), Math.sin(th)]);
const stripes = (c1, c2, w = 0.3) => (x, y, z, nx, ny, nz, c) => (Math.floor(x / w + 100) % 2 ? c2 : c1);

const DECOR = {
  kingdom(p, fp, E, G, st, dm) {
    const k = st.k, lvl = dm.lvl, cream = st.envC, ochre = mix(st.envC, hex(0xb07a24), 0.72);
    const fin = rounded([[0.4, -0.05], [-0.1, 0.5], [-0.55, 0.86], [-1.2, 0.94], [-1.46, 0.6], [-1.48, 0], [-1.45, -0.6], [-0.6, -0.3]].map(([a, b]) => [a * k, b * k]), 4);
    const rud = rounded([[0.02, -0.55], [0.02, 0.5], [-0.3, 0.52], [-0.5, 0.2], [-0.52, -0.2], [-0.36, -0.52]].map(([a, b]) => [a * k, b * k]), 3);
    for (let i = 0; i < 4; i++) {
      const th = i * (PI / 2);
      if (lvl >= 3 && i !== 2) continue;
      p.push(onBag(E, 0.165, th, -0.04));
      finSlab(p, fin, 0.07 * k, cream, 0.85, 0, (x, y, z, nx, ny, nz, c) => (Math.floor(x / (0.3 * k) + 100) % 2 ? ochre : c));
      p.shade(null).ink(GILT, 0.4, 0.85);
      if (TIER < 2) p.tube(fin.map(([a, b]) => [a, b, 0]), 0.03 * k, 6, 0, true);
      p.push(X(-1.5 * k, 0, 0, 0, i === 0 || i === 2 ? 14 : -10, 0));
      finSlab(p, rud, 0.05 * k, i % 2 ? cream : hex(0x7a2a2a), 0.85);
      p.pop();
      if (i === 0) { fp.push(onBag(E, 0.165, th, -0.04)); fp.shade(null).ink([1, 1, 1], 0.85).extrude(rounded([[-0.12, 0.2], [-0.5, 0.7], [-1.12, 0.8], [-1.32, 0.5], [-1.32, 0.12]].map(([a, b]) => [a * k, b * k]), 4), 0.09 * k, true); fp.pop(); }
      p.pop();
    }
    // nose spike and its pennant staff
    p.push(X(E.x0 + E.L / 2 - 0.06, E.cy, 0, 0, 0, -90));
    p.shade(null).ink(GILT, 0.35, 0.9).lathe([[0.16, 0], [0.17, 0.03], [0.1, 0.07], [0.06, 0.2], [0.075, 0.23], [0.03, 0.3], [0, 0.5]].map(([a, b]) => [a * k, b * k]), 14);
    p.pop();
    // the saddle cloth with a gold rope border, and a cream roundel on it
    if (lvl < 3) {
      saddle(fp, E, dm, 0.36, 0.72, 0.66, { device: (a, b) => Math.hypot((a - 0.5) * 1.7, b - 0.5) < 0.2 && Math.hypot((a - 0.5) * 1.7, b - 0.5) > 0.13 });
      if (TIER < 2) for (const th of [-0.66, 0.66]) onSkin(p, E, Array.from({ length: 19 }, (_, i) => [lerp(0.36, 0.72, i / 18), th]), 0.022, GILT, { me: 0.8, ro: 0.45, off: 0.03 });
    }
    // top-fin pennant, stern ensign, bow pennant
    const top = E.pb(0.165, 0, 0.9 * k);
    if (lvl < 3) { staff(p, [top[0] - 0.9 * k, top[1] - 0.1, 0], [top[0] - 0.9 * k, top[1] + 0.55, 0]); fp.push(X(top[0] - 0.9 * k, top[1] + 0.53, 0)); flag(fp, 1.1 * k, 0.26, { tail: 0.5, torn: lvl >= 2 ? 2 : 0 }); fp.pop(); }
    const xs = -G.Lg / 2, xb = G.Lg / 2;
    if (lvl < 3) {
      staff(p, [xs + 0.05, 0, 0], [xs - 0.3, 1.0, 0], 0.02);
      fp.push(X(xs - 0.29, 0.98, 0)); flag(fp, 0.95, 0.56, { band: true, tail: 0.3, torn: lvl >= 2 ? 3 : 0 }); fp.pop();
    }
    p.shade(grainX(0.2)).ink(OAK, 0.8).bar([xb - 0.3, -0.05, 0], [xb + 0.62, 0.22, 0], 0.045, 0.02, 8);
    p.shade(null).ink(GILT, 0.35, 0.9).T(xb + 0.64, 0.225, 0).sphere(0.04, 10, 7);
    if (lvl < 2) { staff(p, [xb - 0.12, 0, 0], [xb - 0.12, 0.8, 0], 0.014); fp.push(X(xb - 0.12, 0.78, 0)); flag(fp, 0.6, 0.2, { tail: 0.5 }); fp.pop(); }
    // gilded scrollwork under the bowsprit and lanterns on the quarters
    p.ink(GILT, 0.38, 0.9).tube([[xb - 0.25, -0.12, 0], [xb + 0.1, -0.1, 0], [xb + 0.26, -0.22, 0], [xb + 0.2, -0.36, 0], [xb + 0.08, -0.33, 0], [xb + 0.1, -0.24, 0]], [0.05, 0.05, 0.045, 0.035, 0.025, 0.015], 8, 1);
    if (lvl < 3) for (const sg of [1, -1]) { p.shade(null).ink(BRASS, 0.4, 0.85).bar([xs + 0.08, 0, sg * (G.half(0) - 0.06)], [xs + 0.04, 0.62, sg * (G.half(0) - 0.02)], 0.016, 0.012, 6); lanternAt(p, [xs + 0.04, 0.64, sg * (G.half(0) - 0.02)], st, 1.25); }
  },

  goblin(p, fp, E, G, st, dm) {
    const k = st.k, lvl = dm.lvl;
    const fins = [[0.25, [[0.2, 0], [-0.3, 0.75], [-0.95, 0.8], [-1.2, 0.2], [-1.1, -0.4], [-0.4, -0.2]], 0.16], [2.25, [[0.2, 0], [-0.5, 0.55], [-1.2, 0.7], [-1.0, -0.3], [-0.4, -0.2]], 0.15], [-2.0, [[0.3, 0], [-0.2, 0.9], [-0.8, 0.75], [-1.3, 0.25], [-1.15, -0.4], [-0.5, -0.25]], 0.17]];
    fins.forEach(([th, out, u], i) => {
      if (lvl >= 3 && i !== 1) return;
      p.push(onBag(E, u, th, -0.05));
      finSlab(p, rounded(out.map(([a, b]) => [a * k, b * k]), 2), 0.06 * k, hex(0x7a6a4a), 0.9, 0, (x, y, z, nx, ny, nz, c) => { const h = hash2(Math.floor(x * 3.1 + 50), Math.floor(y * 2.7 + i * 9)); return h > 0.7 ? vary(RUST, Math.floor(x * 3.1), 0.2) : h > 0.4 ? mul(c, 0.7) : c; });
      if (TIER < 2) { p.shade(null).ink(IRON, 0.6, 0.7); p.beam([out[0][0] * k, out[0][1] * k, 0], [out[2][0] * k, out[2][1] * k, 0], 0.05, 0.09 * k, 0.006); p.beam([out[1][0] * k, out[1][1] * k, 0], [out[out.length - 1][0] * k, out[out.length - 1][1] * k, 0], 0.05, 0.09 * k, 0.006); }
      p.pop();
    });
    // a rope cinched round the waist between the lobes, and iron hoops
    onSkin(p, E, Array.from({ length: 40 }, (_, i) => [0.455, (i / 40) * TAU]), 0.045 * k, mul(HEMP, 0.8), { closed: true, sides: 6 });
    onSkin(p, E, Array.from({ length: 40 }, (_, i) => [0.7, (i / 40) * TAU]), 0.03 * k, IRON, { closed: true, me: 0.7, ro: 0.55 });
    // the boiler on the after deck with its crooked stack
    const xbo = -G.Lg / 2 + 0.62;
    if (lvl < 3) {
      p.push(X(xbo, 0, 0));
      p.shade(mottle(0.25, 8)).ink(vary(COPPER, 3, 0.1), 0.5, 0.75).lathe([[0.3, 0], [0.31, 0.04], [0.31, 0.55], [0.26, 0.68], [0.12, 0.76], [0, 0.78]], 18);
      p.shade(null).ink(IRON, 0.55, 0.75);
      for (const y of [0.08, 0.32, 0.54]) p.T(0, y, 0).ring(0.314, 0.016, 20, 5);
      if (TIER < 1) for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; p.T(Math.cos(a) * 0.318, 0.32, Math.sin(a) * 0.318).sphere(0.016, 5, 3); }
      p.ink(IRON, 0.6, 0.7).T(0.3, 0.2, 0).box(0.06, 0.22, 0.24, 0.01); p.ink(EMBER, 0.5, 0, 1.7).T(0.325, 0.2, 0).box(0.02, 0.14, 0.16, 0.004);
      p.pop();
      const stack = [[xbo, 0.74, 0.05], [xbo - 0.04, 1.0, 0.42], [xbo - 0.2, 1.15, 0.95], [xbo - 0.16, 1.8, E.R * 0.8 * 0.9 + 0.32], [xbo - 0.38, 2.5 * k + 0.2, E.R * 0.8 + 0.34], [xbo - 0.3, 3.05 * k + 0.2, E.R * 0.8 + 0.3]];
      p.ink(vary(RUST, 9, 0.15), 0.7, 0.6).tube(stack, [0.1, 0.1, 0.105, 0.1, 0.11, 0.13], 10, 0);
      p.ink(IRON, 0.6, 0.7); for (const i of [1, 3, 4]) p.TM(aim(stack[i], stack[i + 1])).ring(0.118, 0.018, 12, 4);
      p.ink(hex(0x050505), 1).T(stack[5][0], stack[5][1] - 0.01, stack[5][2], 0, 0, -9).cyl(0.105, 0.105, 0.01, 10);
    }
    // the ram: an iron beak on the bow, ringed with spikes
    const xb = G.Lg / 2;
    p.push(X(xb - 0.32, -0.3, 0, 0, 0, -90));
    p.shade(mottle(0.3, 9)).ink(vary(hex(0x4a4640), 4, 0.1), 0.55, 0.8).lathe([[0.36, 0], [0.38, 0.1], [0.3, 0.3], [0.2, 0.62], [0.09, 0.95], [0, 1.2]], 14);
    p.shade(null).ink(IRON, 0.5, 0.8).T(0, 0.12, 0).ring(0.385, 0.03, 16, 5);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; p.T(Math.cos(a) * 0.3, 0.34, Math.sin(a) * 0.3, 0, -a / DEG, -62).cyl(0, 0.05, 0.3, 6, 2); }
    p.pop();
    // rough paint on top and ragged flags on crooked poles
    if (lvl < 3) saddle(fp, E, dm, 0.5, 0.86, 0.7, { shape: (t) => (0.72 + 0.2 * Math.sin(t * 9) + 0.1 * Math.sin(t * 23)) * Math.min(1, 6 * t, 6 * (1 - t) + 0.3) });
    const tp = E.pb(0.66, 0, 0);
    if (lvl < 3) { staff(p, [tp[0], tp[1] - 0.1, 0.1], [tp[0] - 0.25, tp[1] + 0.85, 0.2], 0.022, DARKWOOD, RUST); fp.push(X(tp[0] - 0.25, tp[1] + 0.83, 0.2)); flag(fp, 0.9, 0.42, { torn: 2 + lvl, tail: 0.1 }); fp.pop(); }
    if (lvl < 2) { staff(p, [xb - 0.9, 0, -0.3], [xb - 1.0, 0.9, -0.36], 0.02, DARKWOOD, RUST); fp.push(X(xb - 1.0, 0.88, -0.36)); flag(fp, 0.6, 0.3, { torn: 2, tail: 0 }); fp.pop(); }
    // a third engine on the tail
    const tail = E.pb(0.01, 0, 0);
    p.push(X(tail[0] + 0.1, tail[1], 0, 0, 0, -90)); p.shade(mottle(0.25, 8)).ink(vary(RUST, 7, 0.1), 0.6, 0.7).lathe([[0, -0.3], [0.1, -0.28], [0.17, -0.1], [0.2, 0.15], [0.26, 0.4]], 12); p.pop();
    return { hubs: [[tail[0] - 0.24, tail[1], 0]] };
  },

  undead(p, fp, E, G, st, dm) {
    const k = st.k, lvl = dm.lvl, mem = (t, w) => mul(st.envC, 0.55 + 0.3 * noise3(t * 6, w * 9, 3));
    // tattered wings on the tail: two to the sides, one above, one below (the rudder)
    [[PI / 2, 1], [-PI / 2, -1], [0, 1], [PI, 1]].forEach(([th, sg], i) => {
      if (lvl >= 3 && i < 2) return;
      p.push(onBag(E, 0.13, th, -0.05).multiply(X(0, 0, 0, 0, 180, 0)));
      batWing(p, p, [[14, 1.45 * k], [44, 1.6 * k], [76, 1.15 * k]], { r: 0.045 * k, torn: 2.5 + lvl, scallop: 0.34, col: mem, dish: 0.08 * sg });
      p.pop();
    });
    // a shroud laid along the spine, and a torn banner at the stern
    if (lvl < 3) saddle(fp, E, dm, 0.3, 0.78, 0.4, { off: 0.06, nv: 16, shape: (t) => (0.7 + 0.2 * Math.sin(t * 14) + 0.12 * Math.sin(t * 37)) * Math.min(1, 5 * t + 0.2, 5 * (1 - t) + 0.2) });
    const xs = -G.Lg / 2, xb = G.Lg / 2;
    if (lvl < 3) { staff(p, [xs + 0.1, 0, 0], [xs - 0.25, 1.0, 0], 0.022, BONE, BONE); fp.push(X(xs - 0.24, 0.98, 0)); flag(fp, 1.0, 0.5, { torn: 3 + lvl, tail: 0.4 }); fp.pop(); }
    // the figurehead: a great skull on the square bow, horns swept back
    const sk = sculpted('skull', skullPart, sculptRes(72));
    p.T(xb + 0.14, -0.26, 0, 0, 90, 0, 1.15).geo(sk);
    p.shade(null).ink(mul(BONE, 0.8), 0.6);
    for (const sg of [1, -1]) p.tube([[xb + 0.1, 0.0, sg * 0.26], [xb - 0.1, 0.3, sg * 0.45], [xb - 0.45, 0.5, sg * 0.52], [xb - 0.8, 0.52, sg * 0.4]], [0.09, 0.075, 0.05, 0.012], 8, 1);
    // ghost lanterns: under the bag along both flanks, on the bow and the quarters
    if (lvl < 3) {
      for (const sg of [1, -1]) for (const u of [0.3, 0.48, 0.66]) { const q = E.pb(u, sg * 2.2, -0.02); chain(p, q, [q[0], q[1] - 0.25, q[2]], 0.012); lanternAt(p, [q[0], q[1] - 0.25, q[2]], st, 1.5); }
      for (const sg of [1, -1]) { p.shade(null).ink(BONE, 0.6).tube([[xs + 0.1, 0, sg * (G.half(0) - 0.05)], [xs + 0.05, 0.5, sg * G.half(0)], [xs - 0.1, 0.62, sg * G.half(0)]], [0.03, 0.022, 0.012], 6, 1); lanternAt(p, [xs - 0.1, 0.62, sg * G.half(0)], st, 1.4); }
    }
    // rib bones clasping the coffin hull
    if (TIER < 2) bothSides(p, () => { for (const s of [0.12, 0.3, 0.48, 0.84]) { const pts = []; for (let i = 0; i <= 8; i++) pts.push(G.pt(s, 0.12 + 0.88 * (i / 8), 0.035)); p.shade(null).ink(vary(BONE, s * 100, 0.08), 0.6).tube(pts, pts.map((_, i) => 0.03 + 0.012 * Math.sin((PI * i) / 8)), 6, 1); } });
  },

  infernal(p, fp, E, G, st, dm) {
    const k = st.k, lvl = dm.lvl, ir = [...mul(st.envC, 0.8), 0.5, 0.75, 0];
    const fin = [[0.5, 0], [0.1, 0.5], [-0.25, 0.55], [-0.5, 1.15], [-0.9, 0.7], [-1.25, 0.85], [-1.4, 0.25], [-1.3, -0.5], [-0.5, -0.3]].map(([a, b]) => [a * k, b * k]);
    for (let i = 0; i < 4; i++) {
      const th = PI / 4 + i * (PI / 2);
      if (lvl >= 3 && i % 2) continue;
      p.push(onBag(E, 0.17, th, -0.05));
      finSlab(p, fin, 0.06 * k, ir, 0.5, 0.75, mottle(0.3, 6));
      p.shade(null).ink(EMBER, 0.5, 0, 1.5);
      if (TIER < 2) for (let j = 0; j < 3; j++) p.T((-0.35 - j * 0.3) * k, (0.25 + (j % 2) * 0.12) * k, 0, 0, 0, 62).box(0.3 * k, 0.03 * k, 0.07 * k, 0);
      p.pop();
    }
    // a rudder blade under the tail
    p.push(onBag(E, 0.09, PI, -0.05)); finSlab(p, [[0.3, 0], [0.1, 0.75], [-0.5, 0.9], [-0.8, 0.3], [-0.7, -0.4]].map(([a, b]) => [a * k, b * k]), 0.05 * k, ir, 0.5, 0.75); p.pop();
    // spikes along the spine, a long nose spike
    const ns = seg(11, 5);
    for (let i = 0; i < ns; i++) { const u = lerp(0.2, 0.9, i / (ns - 1)), h = (0.3 + 0.22 * Math.sin(i * 1.9)) * k; if (lvl < 3 && u > 0.38 && u < 0.7) continue; p.TM(onBag(E, u, 0, -0.03).multiply(X(0, h / 2, 0, 0, 0, 12))); p.shade(null).ink(IRON, 0.45, 0.85).cyl(0, 0.07 * k, h + 0.06, 8, 2); }
    p.push(X(E.x0 + E.L / 2 - 0.25 * k, E.cy, 0, 0, 0, -90)); p.shade(null).ink(IRON, 0.42, 0.85).lathe([[0.3, 0], [0.31, 0.06], [0.2, 0.14], [0.1, 0.4], [0, 0.95]].map(([a, b]) => [a * k, b * k]), 14); p.ink(EMBER, 0.5, 0, 1.5).T(0, 0.1 * k, 0).ring(0.262 * k, 0.02 * k, 18, 5); p.pop();
    // the horned prow, and a keel blade under it
    const xb = G.Lg / 2;
    for (const sg of [1, -1]) {
      const pts = [[xb - 0.7, -0.05, sg * 0.42], [xb - 0.2, 0.05, sg * 0.62], [xb + 0.4, 0.3, sg * 0.6], [xb + 0.85, 0.72, sg * 0.36], [xb + 0.95, 1.05, sg * 0.2]];
      p.shade((x, y, z, nx, ny, nz, c) => mul(c, 0.75 + 0.35 * Math.abs(Math.sin(x * 26 + y * 9)))).ink(hex(0x3a2c26), 0.55, 0.1).tube(pts, [0.15, 0.135, 0.1, 0.055, 0.008], 10, 1);
      p.shade(null).ink(IRON, 0.5, 0.8).TM(aim(pts[0], pts[1])).ring(0.16, 0.035, 14, 5);
    }
    p.push(X(xb - 0.1, -0.5, 0)); finSlab(p, [[-0.9, 0.2], [0.2, 0.42], [0.95, 0.5], [0.3, 0.1], [-0.2, -0.3], [-0.9, -0.3]], 0.06, IRON, 0.45, 0.85); p.pop();
    // braziers at the corners of the deck
    if (lvl < 3) for (const [s, sg] of [[0.04, 1], [0.04, -1], [0.8, 1], [0.8, -1]]) {
      const q = [G.x(s, 0), 0, sg * (G.half(s) - 0.1)];
      p.push(X(q[0], 0, q[2]));
      p.shade(null).ink(IRON, 0.5, 0.8).T(0, 0.22, 0).cyl(0.02, 0.035, 0.44, 6); p.T(0, 0.44, 0).lathe([[0.02, 0], [0.09, 0.03], [0.12, 0.1], [0.11, 0.12], [0.08, 0.06], [0, 0.05]], 10);
      p.ink(EMBER, 0.6, 0, 1.8).T(0, 0.53, 0).sphere(0.075, 8, 6); p.ink(hex(0xffa040), 0.6, 0, 1.8).T(0, 0.62, 0).cyl(0, 0.05, 0.16, 7, 0);
      p.pop();
    }
    // an armour plate in the side colour on the back of the bag, and banners at the stern
    if (lvl < 3) saddle(fp, E, dm, 0.38, 0.7, 0.6, { off: 0.045, shape: (t) => 0.45 + 0.55 * (1 - Math.abs(t - 0.5) * 2), device: (a, b) => Math.abs(b - 0.5) < 0.05 });
    const xs = -G.Lg / 2;
    if (lvl < 3) for (const sg of [1, -1]) { staff(p, [xs + 0.3, 0, sg * 0.38], [xs + 0.1, 1.05, sg * 0.5], 0.02, IRON, IRON); fp.push(X(xs + 0.1, 1.03, sg * 0.5)); flag(fp, 0.8, 0.34, { torn: lvl >= 2 ? 3 : 0, tail: 0.6, phase: sg }); fp.pop(); }
  },

  beasts(p, fp, E, G, st, dm) {
    const k = st.k, lvl = dm.lvl, { NU, NT } = E.net;
    // the rope net over the hide
    if (lvl < 3) {
      const nn = seg(36, 12);
      for (let i = 1; i < NU; i++) onSkin(p, E, Array.from({ length: nn }, (_, j) => [i / NU, (j / nn) * TAU]), 0.028 * k, HEMP, { closed: true, off: 0.0, base: true });
      if (TIER < 2) for (let m = 0; m < NT; m++) onSkin(p, E, Array.from({ length: nn + 1 }, (_, j) => [lerp(0.06, 0.94, j / nn), (m / NT) * TAU]), 0.022 * k, mul(HEMP, 0.85), { base: true, off: 0.0 });
    }
    // great tusks at the nose, smaller ones on the basket's bow
    const xn = E.x0 + E.L / 2;
    for (const sg of [1, -1]) {
      const a = E.pb(0.9, sg * 2.0, -0.1), r = 0.1 * st.len;
      p.shade((x, y, z, nx, ny, nz, c) => mul(c, 0.85 + 0.2 * noise3(x * 5, y * 18, z * 18))).ink(IVORY, 0.4);
      p.tube([a, [a[0] + r * 0.5, a[1] - r * 0.32, a[2] * 1.35], [xn + r * 0.35, a[1] - r * 0.3, a[2] * 1.45], [xn + r * 0.78, a[1] + r * 0.12, a[2] * 1.15], [xn + r * 0.92, a[1] + r * 0.62, a[2] * 0.8]], [0.19, 0.18, 0.15, 0.09, 0.012].map((v) => v * k), 12, 1);
      p.shade(null).ink(hex(0x4a3524), 0.9).TM(aim(a, [a[0] + r * 0.5, a[1] - r * 0.32, a[2] * 1.35]).multiply(X(0, 0.2, 0))).ring(0.2 * k, 0.045 * k, 14, 5);
      const xb = G.Lg / 2;
      p.ink(IVORY, 0.4).tube([[xb - 0.35, -0.2, sg * 0.3], [xb + 0.15, -0.35, sg * 0.42], [xb + 0.55, -0.15, sg * 0.36], [xb + 0.68, 0.22, sg * 0.24]], [0.09, 0.08, 0.05, 0.008], 8, 1);
    }
    // hide fins on bent poles, and a bundle of feathers at the tail
    [[PI / 2, 1], [-PI / 2, -1], [0, 1]].forEach(([th, sg], i) => {
      if (lvl >= 3 && i < 2) return;
      p.push(onBag(E, 0.14, th, -0.05).multiply(X(0, 0, 0, 0, 180, 0)));
      batWing(p, p, [[25, 1.25 * k], [52, 1.35 * k], [80, 1.05 * k]], { bone: hex(0x6a4a2e), r: 0.04 * k, scallop: 0.1, dish: 0.05 * sg, curl: 0.05, torn: lvl >= 2 ? 3 : 0, col: (t, w) => mul(mix(st.envC, hex(0x8a5a36), Math.floor(w * 4) % 2 ? 0.5 : 0.1), 0.7 + 0.3 * noise3(t * 8, w * 8, 2)) });
      p.pop();
    });
    const tl = E.pb(0.02, 0, 0);
    if (TIER < 2 && lvl < 3) for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; p.push(X(tl[0], tl[1], 0, a / DEG, 0, 25 + (i % 2) * 12)); finSlab(p, [[0, -0.03], [-0.5, -0.07], [-0.75, 0], [-0.5, 0.07], [0, 0.03]].map(([x, y]) => [x * k, y * k]), 0.012, i % 2 ? hex(0x8a2a22) : CREAM, 0.9); p.pop(); }
    // totem poles on the quarters
    const xs = -G.Lg / 2;
    if (lvl < 3) for (const sg of [1, -1]) {
      p.push(X(xs + 0.14, 0, sg * (G.half(0.03) - 0.08)));
      p.shade(grainY(0.25)).ink(hex(0x7a5632), 0.85).lathe([[0.075, 0], [0.075, 0.26], [0.1, 0.3], [0.1, 0.52], [0.07, 0.56], [0.095, 0.62], [0.095, 0.84], [0.06, 0.9], [0.085, 0.96], [0.07, 1.12], [0, 1.16]], 10);
      p.shade(null).ink(hex(0x8a2a22), 0.8).T(0, 0.28, 0).ring(0.1, 0.02, 12, 4); p.ink(CREAM, 0.8).T(0, 0.59, 0).ring(0.092, 0.02, 12, 4); p.ink(hex(0x2a5a5a), 0.8).T(0, 0.93, 0).ring(0.082, 0.02, 12, 4);
      p.ink(IVORY, 0.45); for (const s2 of [1, -1]) { p.tube([[0, 0.76, s2 * 0.08], [0, 0.82, s2 * 0.22], [0, 0.98, s2 * 0.27]], [0.035, 0.028, 0.006], 6, 1); p.tube([[0, 0.42, s2 * 0.09], [0.0, 0.4, s2 * 0.2], [0, 0.5, s2 * 0.25]], [0.03, 0.022, 0.006], 6, 1); }
      p.ink(hex(0x15100c), 1); for (const y of [0.42, 0.74]) for (const s2 of [1, -1]) p.T(-0.09, y, s2 * 0.035).sphere(0.018, 6, 4);
      p.pop();
    }
    // a painted blanket on the back, and war banners at the bow
    if (lvl < 3) saddle(fp, E, dm, 0.3, 0.72, 0.72, { off: 0.05, device: (a, b) => Math.abs(((a * 6 + Math.abs(b - 0.5) * 2.4) % 1) - 0.5) < 0.12 && Math.abs(b - 0.5) < 0.42 });
    if (lvl < 3) for (const sg of [1, -1]) { const s = 0.86, q = [G.x(s, 0), 0, sg * (G.half(s) - 0.06)]; staff(p, q, [q[0] + 0.1, 1.15, q[2] * 1.3], 0.022, hex(0x6a4a2e), IVORY); fp.push(X(q[0] + 0.1, 1.13, q[2] * 1.3)); flag(fp, 0.7, 0.36, { torn: lvl >= 2 ? 3 : 0, tail: 0.5, phase: sg * 2 }); fp.pop(); }
  },

  dragons(p, fp, E, G, st, dm) {
    const k = st.k, lvl = dm.lvl;
    // the dorsal sail: bone spines with the side's colours stretched between them
    const ns = 10, sp = [];
    for (let i = 0; i < ns; i++) { const u = lerp(0.8, 0.14, i / (ns - 1)), a = E.pb(u, 0, -0.05), h = (0.5 + 0.55 * Math.sin((PI * (i + 0.6)) / (ns + 0.4))) * k; sp.push([a, [a[0] - 0.42 * k, a[1] + h + 0.05, 0]]); }
    p.shade(null).ink(BONE, 0.55);
    for (const [a, b] of sp) p.tube([a, lerp3(a, b, 0.5).map((v, j) => v + (j === 0 ? 0.06 * k : 0)), b], [0.055 * k, 0.04 * k, 0.008], 7, 1);
    for (let i = 0; i < ns - 1; i++) {
      if (lvl >= 3 && i > 2) continue;
      const nu = seg(8, 3), nw = seg(6, 2);
      fp.shade(null).ink([1, 1, 1], 0.85).grid(nu, nw, (ii, j, out) => { const t = ii / nu, w = j / nw, te = t * (1 - 0.2 * Math.sin(PI * w) * t), a = lerp3(sp[i][0], sp[i][1], te), b = lerp3(sp[i + 1][0], sp[i + 1][1], te); out[0] = lerp(a[0], b[0], w); out[1] = lerp(a[1], b[1], w); out[2] = 0.03 * k * Math.sin(PI * w) * t * (i % 2 ? 1 : -1); },
        (ii) => { const v = 0.62 + 0.38 * (ii / nu); return [v, v, v]; }, lvl >= 2 ? { skip: (ii, j) => noise3(ii * 0.9 + i * 3, j, 4.4) > 0.62 } : null);
    }
    // wing fins amidships: membranes in the side's colours, seen plainly from above
    for (const sg of [1, -1]) {
      if (lvl >= 3 && sg > 0) continue;
      const m = frame(E.pb(0.5, sg * 1.45, -0.1), [-1, 0, 0.0], [0, 0.32, sg]);
      p.push(m); fp.push(m);
      fp.ink([1, 1, 1], 0.85);
      batWing(p, fp, [[8, 2.9 * k], [26, 2.7 * k], [46, 2.1 * k], [70, 1.5 * k], [96, 0.9 * k]], { r: 0.06 * k, dish: 0.06 * sg, scallop: 0.26, torn: lvl >= 2 ? 3 : 0, col: (t) => { const v = 0.55 + 0.45 * t; return [v, v, v]; } });
      p.pop(); fp.pop();
    }
    // the tail spade: a vertical fin above and below (the rudder)
    for (const [th, sg] of [[0, 1], [PI, -1]]) {
      p.push(onBag(E, 0.07, th, -0.03).multiply(X(0, 0, 0, 0, 180, 0)));
      batWing(p, p, [[12, 1.0 * k], [40, 1.05 * k], [72, 0.8 * k]], { r: 0.035 * k, dish: 0, scallop: 0.2, col: (t) => mul(st.envC, 0.6 + 0.4 * t), torn: lvl >= 2 ? 2 : 0 });
      p.pop(); void sg;
    }
    // horn crown at the nose
    for (let i = 0; i < 5; i++) { const th = (i - 2) * 0.55, a = E.pb(0.9, th, -0.04); p.shade(null).ink(mul(BONE, 0.85), 0.5).tube([a, [a[0] + 0.3 * k, a[1] + 0.35 * k * Math.cos(th), a[2] + 0.35 * k * Math.sin(th)], [a[0] - 0.1 * k, a[1] + 0.8 * k * Math.cos(th), a[2] + 0.8 * k * Math.sin(th)]], [0.08 * k, 0.055 * k, 0.008], 8, 1); }
    // the skull prow, bone ribs on the hull
    const xb = G.Lg / 2;
    p.T(xb - 0.28, -0.12, 0, 0, 90, 0, 1.25).geo(sculpted('drake', drakeSkullPart, sculptRes(64)));
    if (TIER < 2) bothSides(p, () => { for (const s of [0.1, 0.28, 0.46, 0.64]) { const pts = []; for (let i = 0; i <= 8; i++) pts.push(G.pt(s, 0.05 + 0.95 * (i / 8), 0.03)); p.shade(null).ink(vary(BONE, s * 90, 0.08), 0.6).tube(pts, pts.map((_, i) => 0.022 + 0.014 * Math.sin((PI * i) / 8)), 6, 1); } });
    const xs = -G.Lg / 2;
    if (lvl < 3) { staff(p, [xs + 0.1, 0, 0], [xs - 0.28, 1.0, 0], 0.022, DARKWOOD, GILT); fp.push(X(xs - 0.27, 0.98, 0)); flag(fp, 0.95, 0.5, { torn: lvl >= 2 ? 3 : 0, tail: 0.5 }); fp.pop(); }
    if (lvl < 3) for (const sg of [1, -1]) lanternAt(p, [xs + 0.02, 0.55, sg * (G.half(0) - 0.02)], st, 1.2), p.shade(null).ink(BRASS, 0.4, 0.85).bar([xs + 0.06, 0, sg * (G.half(0) - 0.05)], [xs + 0.02, 0.55, sg * (G.half(0) - 0.02)], 0.014, 0.01, 5);
  },
};

// ---------- the rune skyship: no gas bag, but a crystal core held in carved stone rings ----------
/** a crystal along local +Y, centred: flat facets, pointed at both ends; cA colours the waist, cB the points */
function crystal(p, len, r, sides = 6, tip = 0.3, cA = null, cB = null) {
  const yb = len * (0.5 - tip);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU, A = [Math.cos(a0) * r, Math.sin(a0) * r], B = [Math.cos(a1) * r, Math.sin(a1) * r];
    const f = cA ? 0.8 + 0.4 * hash1(i * 7 + sides) : 1, ca = cA ? [cA[0] * f, cA[1] * f, cA[2] * f, cA[3], cA[4], cA[5]] : null;
    p.poly([[A[0], -yb, A[1]], [A[0], yb, A[1]], [B[0], yb, B[1]], [B[0], -yb, B[1]]], cA ? () => ca : null);
    p.poly([[A[0], yb, A[1]], [0, len / 2, 0], [B[0], yb, B[1]]], cA ? (j) => (j === 1 ? cB : ca) : null);
    p.poly([[B[0], -yb, B[1]], [0, -len / 2, 0], [A[0], -yb, A[1]]], cA ? (j) => (j === 1 ? cB : ca) : null);
  }
}
/** a rough boulder of radius about r */
function boulder(p, r, seed, col) {
  const nu = seg(14, 6), nv = seg(9, 4);
  p.shade(mottle(0.3, 5 / r)).ink(col, 0.95);
  p.grid(nu, nv, (i, j, out) => { const a = (i / nu) * TAU, b = -PI / 2 + (j / nv) * PI, c = Math.cos(b), x = Math.cos(a) * c, y = Math.sin(b), z = Math.sin(a) * c, k = r * (0.72 + 0.5 * fbm3(x * 1.3 + seed, y * 1.3, z * 1.3 + seed * 0.7, 2)); out[0] = x * k; out[1] = y * k * 0.8; out[2] = z * k; }, null, { wrapU: true, away: [0, 0, 0] });
}
function runeCore(p, fp, E, G, st, dm) {
  const k = st.k, lvl = dm.lvl, L = E.L, R = E.R, cy = E.cy, stone = st.hullC, glowC = st.glowC, lit = lvl >= 3 ? 0 : 1;
  const gcol = lit ? [...glowC, 0.3, 0, 1.3] : [...mul(st.envC, 0.25), 0.5, 0, 0];
  // the core: a cluster of crystals, bright at the heart and deep at the points, in two gimbal rings
  const cA = lit ? [...mix(st.envC, [0.45, 0.85, 1], 0.6), 0.15, 0.1, 0.5] : [...mul(st.envC, 0.22), 0.4, 0.1, 0], cB = lit ? [...mul(mix(st.envC, glowC, 0.7), 0.5), 0.15, 0.1, 0.25] : [...mul(st.envC, 0.12), 0.4, 0.1, 0];
  p.shade(null).ink(cA, 0.15, 0.1, cA[5]);
  p.push(X(E.x0, cy, 0, 22, 0, -90)); crystal(p, 0.5 * L, 0.4 * R, 8, 0.3, cA, cB); p.pop();
  for (let i = 0; i < 6; i++) {
    if (lvl >= 2 && i % 3 === 0) continue;
    const a = (i / 6) * 360 + 20, fwd = i % 2 ? 1 : -1;
    p.push(X(E.x0 + fwd * 0.05 * L, cy, 0, a, 0, 0).multiply(X(0, 0.3 * R, 0, 0, 0, -fwd * 52))); crystal(p, (0.75 + 0.3 * hash1(i)) * R, 0.17 * R, 6, 0.36, cA, cB); p.pop();
  }
  const sats = [[0.31, 0.4, 0.3, 0.5, 40], [0.3, -0.34, -0.36, 0.42, -30], [-0.31, 0.34, -0.3, 0.46, 15], [-0.3, -0.38, 0.34, 0.4, -50], [0.4, -0.05, 0.1, 0.36, 10], [-0.4, 0.02, -0.06, 0.34, -8]];
  sats.forEach(([fx, fy, fz, sz, tilt], i) => { if (lvl >= 2 && i % 2) return; p.push(X(E.x0 + fx * L, cy + fy * R, fz * R, tilt, i * 37, -90 + tilt * 0.4)); crystal(p, sz * R * 1.5, sz * R * 0.3, 6, 0.36, cA, cB); p.pop(); });
  if (lvl < 3) { p.shade(null).ink(BRASS, 0.35, 0.9); p.T(E.x0, cy, 0, 0, 0, 90 - 28).ring(0.6 * R, 0.035 * k, 48, 7); p.T(E.x0, cy, 0, 62, 0, 90 + 24).ring(0.66 * R, 0.03 * k, 48, 7); }
  // boulders caught in the field, each with a shard of the crystal in it
  if (TIER < 2 && lvl < 3) [[-0.43, -0.3, 0.5, 0.2], [-0.47, 0.25, -0.45, 0.15], [0.44, -0.45, -0.4, 0.17], [-0.38, 0.75, 0.35, 0.12], [0.33, -0.8, 0.5, 0.13]].forEach(([fx, fy, fz, r], i) => {
    p.push(X(E.x0 + fx * L, cy + fy * R, fz * R, i * 50, i * 70, 0)); boulder(p, r * k, i * 3.3 + 1, vary(stone, i * 5, 0.12)); p.shade(null).ink(cA, 0.15, 0.1, cA[5]); p.push(X(0, r * k * 0.5, 0, 15, 0, 20)); crystal(p, r * k * 1.6, r * k * 0.28, 5, 0.4, cA, cB); p.pop(); p.pop();
  });
  // three carved rings about the long axis: voussoirs with a rune cut in every other stone
  const rings = [[0.2, 0.8], [0.5, 1], [0.8, 0.8]], NV = 18;
  const sect = [[-0.17, -0.1], [-0.15, -0.12], [0.15, -0.12], [0.17, -0.1], [0.17, 0.1], [0.15, 0.12], [0.06, 0.12], [0.05, 0.135], [-0.05, 0.135], [-0.06, 0.12], [-0.15, 0.12], [-0.17, 0.1]].map(([a, b]) => [a * k, b * k]);
  rings.forEach(([u, rf], ri) => {
    const xr = E.x0 + (u - 0.5) * L, Rr = R * rf - 0.12 * k, nu = seg(NV * 8, NV * 2), ns = sect.length;
    const gone = (a) => (lvl === 1 && ri === 0 && a > 0.2 && a < 0.5) || (lvl === 2 && ((ri === 2 && a > -0.4 && a < 2.4) || (ri === 0 && a > 0.2 && a < 0.5))) || (lvl >= 3 && ((ri !== 1 && Math.abs(a) < 2.3) || (ri === 1 && a > -1.2 && a < 0.9)));
    p.shade(mottle(0.22, 7)).ink(stone, 0.95);
    p.grid(nu, ns, (i, j, out) => { const a = -PI + (i / nu) * TAU, q = sect[j % ns], r = Rr + q[1]; out[0] = xr + q[0]; out[1] = cy + r * Math.cos(a); out[2] = r * Math.sin(a); },
      (i, j) => { const f = (i / nu) * NV, vi = Math.floor(f), fr = f - vi, jj = j % ns; if (jj >= 7 && jj <= 8 && vi % 2 === 0 && fr > 0.25 && fr < 0.75) return gcol; const c = vary(stone, vi * 7 + ri * 31, 0.12), d = fr < 0.06 || fr > 0.94 ? 0.45 : 1; return [c[0] * d, c[1] * d, c[2] * d, 0.95, 0, 0]; },
      { wrapV: true, away: [xr, cy, 0], skip: (i) => gone(-PI + ((i + 0.5) / nu) * TAU) });
    if (TIER < 2) for (let v = 0; v < NV; v++) {
      const a = -PI + ((v + 0.5) / NV) * TAU;
      if (gone(a)) continue;
      for (const sx of [1, -1]) { p.push(X(xr + sx * 0.172 * k, cy + Rr * Math.cos(a), Rr * Math.sin(a), a / DEG, 0, 0)); if (v % 2) { p.shade(null).ink(gcol, 0.3, 0, lit * 1.3).T(0, 0, 0, 0, 0, 90).cyl(0.05 * k, 0.05 * k, 0.012, 6); } else { p.shade(mottle(0.2, 9)).ink(mul(stone, 0.72), 0.95).box(0.012, 0.13 * k, 0.2 * k, 0.004); } p.pop(); }
    }
  });
  // a spine over the top and two longerons below tie the rings together; an obelisk prow, stone vanes aft
  const yTop = (x) => cy + R * (0.8 + 0.2 * Math.cos(clamp((x - E.x0) / (0.3 * L), -1, 1) * PI * 0.5)) + 0.02 * k;
  const line = (f, n = 16, x0 = -0.36, x1 = 0.36) => Array.from({ length: n + 1 }, (_, i) => f(E.x0 + lerp(x0, x1, i / n) * L));
  p.shade(mottle(0.22, 7)).ink(mul(stone, 0.9), 0.95);
  if (lvl < 3) p.tube(line((x) => [x, yTop(x), 0]), 0.1 * k, 8, 1);
  for (const sg of [1, -1]) p.tube(line((x) => { const r = yTop(x) - cy - 0.1 * k; return [x, cy - r * 0.72, sg * r * 0.69]; }, 16, lvl >= 3 ? -0.05 : -0.36), 0.085 * k, 8, 1);
  p.push(X(E.x0 + 0.385 * L, yTop(E.x0 + 0.36 * L) - 0.12 * k, 0, 0, 0, -84)); p.shade(mottle(0.2, 6)).ink(vary(stone, 5, 0.1), 0.95); crystal(p, 0.17 * L, 0.2 * k, 4, 0.42); p.pop();
  p.push(X(E.x0 + 0.33 * L, yTop(E.x0 + 0.33 * L), 0)); p.shade(null).ink(gcol, 0.3, 0, lit * 1.5).box(0.5 * k, 0.03, 0.22 * k, 0.004); p.pop();
  if (lvl < 3) {
    const xt = E.x0 - 0.36 * L, yt = yTop(xt);
    p.push(X(xt, yt, 0)); finSlab(p, [[0.3, -0.1], [-0.1, 0.75], [-0.75, 0.9], [-1.0, 0.3], [-0.9, -0.2]].map(([a, b]) => [a * k, b * k]), 0.1 * k, vary(stone, 8, 0.1), 0.95, 0, mottle(0.22, 7));
    p.shade(null).ink(gcol, 0.3, 0, lit * 1.5).T(-0.45 * k, 0.4 * k, 0).box(0.07 * k, 0.4 * k, 0.11 * k, 0.004); p.T(-0.45 * k, 0.45 * k, 0, 0, 0, 55).box(0.07 * k, 0.26 * k, 0.11 * k, 0.004);
    p.pop();
    for (const sg of [1, -1]) { p.push(X(xt, cy - R * 0.5, sg * R * 0.55, sg * 115, 0, 0)); finSlab(p, [[0.3, -0.1], [-0.2, 0.7], [-0.8, 0.8], [-1.0, 0.25], [-0.85, -0.2]].map(([a, b]) => [a * k, b * k]), 0.09 * k, vary(stone, 9 + sg, 0.1), 0.95, 0, mottle(0.22, 7)); p.pop(); }
    // the rudder: a slab hung under the tail
    p.push(X(xt - 0.1 * k, cy - R * 0.62, 0, 0, 12, 0)); finSlab(p, [[0.2, 0.15], [-0.7, 0.2], [-0.85, -0.5], [-0.3, -0.75], [0.15, -0.4]].map(([a, b]) => [a * k, b * k]), 0.08 * k, vary(stone, 12, 0.1), 0.95, 0, mottle(0.22, 7)); p.pop();
  }
  // tethers of light hold the gondola
  bothSides(p, (side) => {
    for (let i = 0; i < 4; i++) {
      if (lvl >= 3 && i !== 2) continue;
      if (lvl === 2 && i === 1 && side > 0) continue;
      const s = lerp(0.1, 0.86, i / 3), a = [G.x(s, 0), 0.02, G.half(s) - 0.06], x = E.x0 + lerp(-0.3, 0.3, i / 3) * L, r = yTop(x) - cy - 0.1 * k;
      p.shade(null).ink(glowC, 0.3, 0, 1.3).bar(a, [x, cy - r * 0.72, r * 0.69], 0.022, 0.022, 6, 0);
      if (TIER < 2) { p.ink(mul(stone, 0.8), 0.95).T(a[0], 0.04, a[2]).cyl(0.05, 0.06, 0.08, 8); }
    }
  });
  // banners in the side colour draped over the spine between the rings, and a standard on the vane
  if (lvl < 3) for (const [x0, x1] of [[-0.24, -0.06], [0.06, 0.24]]) {
    const nu = seg(14, 5), nv = seg(14, 5), w = 0.62 * R;
    fp.shade(null).ink([1, 1, 1], 0.88).grid(nu, nv, (i, j, out) => { const x = E.x0 + lerp(x0, x1, i / nu) * L, t = (j / nv) * 2 - 1, a = Math.abs(t); out[0] = x; out[1] = yTop(x) + 0.115 * k - (a < 0.25 ? a * a * 0.6 : 0.0375 + (a - 0.25) * 0.95) * w * 1.1; out[2] = t * w * (a < 0.25 ? 1 : 0.25 / a + 0.5 * (a - 0.25)); },
      (i, j) => { const e = Math.min(i, nu - i) / nu, t = Math.abs((j / nv) * 2 - 1), v = (e < 0.08 || t > 0.9 ? 0.5 : 1) * (0.85 + 0.15 * Math.cos(j * 0.9)); return [v, v, v]; },
      { skip: lvl >= 2 ? (i, j) => noise3(i * 0.8, j * 0.8, x0 * 9) > 0.64 : null });
  }
  const xs = -G.Lg / 2;
  if (lvl < 3) { staff(p, [xs + 0.1, 0, 0], [xs - 0.28, 1.0, 0], 0.024, SLATE, glowC); fp.push(X(xs - 0.27, 0.98, 0)); flag(fp, 0.95, 0.5, { torn: lvl >= 2 ? 3 : 0, tail: 0.3, band: true }); fp.pop(); }
  // a carved prow stone on the gondola with a rune eye
  const xb = G.Lg / 2;
  p.push(X(xb - 0.05, -0.2, 0, 0, 0, -78)); p.shade(mottle(0.2, 6)).ink(vary(stone, 3, 0.1), 0.95); crystal(p, 1.3, 0.2, 4, 0.4); p.pop();
  p.shade(null).ink(gcol, 0.3, 0, lit * 1.6); for (const sg of [1, -1]) p.T(xb - 0.3, -0.2, sg * 0.3, 0, sg * 30, 0).box(0.14, 0.14, 0.03, 0.01);
}

// ---------- assembly ----------
function buildAirship(def, lvl, tier) {
  Q = TIERS[tier].q; TIER = tier;
  try {
    const st = styleOf(def), E = makeEnv(st), G = makeHull(st), dm = damageOf(lvl, st, E, G);
    st.sLad = 0.5;
    const p = new Pen(), fp = new Pen(), o = G.o;
    p.warp = fp.warp = dm.warp; p.post = dm.post;
    fp.post = dm.post ? (x, y, z, col, ro, me, gl) => { const k = dm.char(x, y, z); return k < 0.02 ? null : [col[0] * (1 - 0.88 * k), col[1] * (1 - 0.88 * k), col[2] * (1 - 0.88 * k), ro, me, gl]; } : null;
    let extra = null;
    // the bag (or the rune core) and its frame
    if (E.skinned) {
      drawEnvelope(p, E, st, dm);
      if ((lvl >= 1 || st.style === 'undead') && (tier < 2 || lvl >= 2)) drawFrame(p, E, st, dm, tier >= 2 ? 6 : 9, tier >= 2 ? 6 : 8);
    } else runeCore(p, fp, E, G, st, dm);
    // the gondola
    bothSides(p, (side) => {
      planking(p, G, st, dm, side);
      if (lvl >= 2) { const ns = seg(24, 8); p.shade(null).ink(mul(CHAR, 0.8), 1).grid(ns, 5, (i, j, out) => { const q = G.pt((i / ns) * 0.995, j / 5, -0.05); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; }, null, { away: [0, -0.3, 0] }); }
      railing(p, G, st, dm, side);
    });
    if (o.bowW) {
      const out = [], nv = seg(10, 5), tc = plankTone(st, 3, o.strakes, 5, 1);
      for (let i = 0; i <= nv; i++) { const q = G.pt(1, i / nv); out.push([q[2], q[1]]); }
      for (let i = nv; i > 0; i--) { const q = G.pt(1, i / nv); out.push([-q[2], q[1]]); }
      p.push(X(G.x(1, 0), 0, 0, 0, 90, 0)); p.shade(mottle(0.16, 8)).ink(tc, tc[3], tc[4]).T(0, 0, -0.02).extrude(out, 0.05, false); p.pop();
    }
    deckPlanks(p, G, st, dm);
    const stern = sternWorks(p, G, st, dm);
    const muzzles = guns(p, G, st, dm), bay = bombBay(p, G, st);
    rigging(p, E, G, st, dm);
    const hubs = engines(p, G, st, dm);
    // pod racks at the shoulders and quarters, a rolled ladder each side amidships
    const xp = 0.31 * G.Lg, pods = [];
    for (const x of [xp, -xp]) { let q = null; for (const sg of [1, -1]) { if (sg < 0) { p.push(MIRROR); fp.push(MIRROR); } q = podRack(p, fp, G, st, x, dm); if (sg < 0) { p.pop(); fp.pop(); } pods.push([+q[0].toFixed(3), q[1], sg * q[2]]); } }
    const hl = G.half(st.sLad), yl = st.rail === 'basket' ? st.hb + 0.1 : 0.14;
    if (lvl < 3) bothSides(p, () => { p.push(X(0, yl, hl + 0.01)); ladderRoll(p, st); p.pop(); if (TIER < 2) for (const dx of [-0.1, 0.1]) rope(p, [dx, yl + 0.13, hl], [dx, 0.01, hl - 0.16], 0.01, HEMP); });
    const r = DECOR[st.style] ? DECOR[st.style](p, fp, E, G, st, dm) : null;
    if (r && r.hubs) hubs.push(...r.hubs);
    void extra;
    // where things are, for the game (hub positions follow the bend of a damaged ship)
    const wp = (q) => { const t = q.slice(); if (dm.warp) dm.warp(t); return t.map((v) => +v.toFixed(3)); };
    const geo = p.toGeometry(), side = fp.n ? fp.toGeometry() : null;
    const info = {
      props: hubs.map(wp), muzzles, bombBay: bay, hangar: stern.hangar, pods: [pods[0], pods[2], pods[1], pods[3]],
      ladders: [[0, 0, +(-hl).toFixed(3)], [0, 0, +hl.toFixed(3)]],
      top: +Math.max(geo.boundingBox.max.y, side ? side.boundingBox.max.y : 0).toFixed(3), radius: st.len / 2, st,
    };
    return { geo, side, info };
  } finally { Q = 1; TIER = 0; }
}

const shipCache = new Map(), propCache = new Map(), sideMats = new Map();
let EMPTY = null;
const emptyGeo = () => { if (!EMPTY) { EMPTY = new THREE.BufferGeometry(); EMPTY.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3)); } return EMPTY; };
/** the shared material tinted to a side's colour (side-coloured geometry is baked in greys) */
function sideMaterial(hexCol) {
  if (!sideMats.has(hexCol)) { const m = sculptMaterial().clone(); m.color.setHex(hexCol); sideMats.set(hexCol, m); }
  return sideMats.get(hexCol);
}
function shipOf(def, key, lvl, tier) {
  const k = `${key}|${lvl}|${tier}`;
  if (!shipCache.has(k)) shipCache.set(k, buildAirship(def, lvl, tier));
  return shipCache.get(k);
}
function propOf(st, broken) {
  const k = `${st.style}|${broken ? 1 : 0}|${getDetail()}`;
  if (!propCache.has(k)) { const p = new Pen(); Q = getDetail() === 'low' ? 0.6 : 1; try { drawProp(p, st, broken); } finally { Q = 1; } propCache.set(k, p.toGeometry()); }
  return propCache.get(k);
}
// which tier each detail level of the game shows (rigkit.setLod levels 0..5, as for ships)
const LOD_PLAN = { low: [1, 1, 1, 2, 2, 2], ultra: [0, 0, 0, 1, 2, 2] }, LOD_DEFAULT = [0, 0, 1, 2, 2, 2];

/**
 * airship(def, sideColorHex) -> THREE.Group: bow toward +X, gondola deck at y = 0, hull hanging to y = -0.9, the bag above.
 * def: { id, style, len, color, envelope, cannons: { perSide } }.
 * userData: props (Groups to spin about their local X), muzzles, bombBay, hangar, pods, ladders, top, radius,
 * setSide(hex), setDamage(0..3), lod (for rigkit.setLod).
 */
export function airship(def, sideColorHex = 0x3d7bd9) {
  const key = [def.id, def.style, def.len, def.color, def.envelope, def.cannons?.perSide, getDetail()].join('|');
  const plan = LOD_PLAN[getDetail()] || LOD_DEFAULT, base = shipOf(def, key, 0, plan[0]), st = base.info.st;
  const g = new THREE.Group(), mat = sculptMaterial();
  let level = 0, side = sideColorHex;
  const main = new THREE.Mesh(base.geo, mat);
  main.castShadow = true; main.receiveShadow = true; main.name = 'airship';
  const cols = new THREE.Mesh(base.side || emptyGeo(), sideMaterial(side));
  cols.castShadow = true; cols.receiveShadow = true; cols.name = 'colours';
  g.add(main, cols);
  // propellers: a spinning group at each hub, and a wrecked stand-in that takes its place when the engine dies
  const dead = [];
  const props = base.info.props.map((q) => {
    const grp = new THREE.Group(); grp.position.set(q[0], q[1], q[2]); grp.name = 'prop';
    const m = new THREE.Mesh(propOf(st, false), mat); m.castShadow = true;
    grp.add(m);
    const d = new THREE.Mesh(propOf(st, true), mat); d.castShadow = true; d.visible = false; d.position.copy(grp.position); d.name = 'deadProp';
    g.add(grp, d); dead.push(d);
    return grp;
  });
  const u = g.userData;
  u.props = props;
  u.muzzles = base.info.muzzles; u.bombBay = base.info.bombBay; u.hangar = base.info.hangar; u.pods = base.info.pods; u.ladders = base.info.ladders;
  u.top = base.info.top; u.radius = base.info.radius; u.damage = 0;
  // detail tiers and damage levels both swap geometry: the tiers of the current damage level are built on first use
  const geos = [], sgeos = [];
  plan.forEach((t, i) => {
    Object.defineProperty(geos, i, { enumerable: true, get: () => shipOf(def, key, level, t).geo });
    Object.defineProperty(sgeos, i, { enumerable: true, get: () => shipOf(def, key, level, t).side || emptyGeo() });
  });
  u.lod = { meshes: [{ mesh: main, geos }, { mesh: cols, geos: sgeos }], far: null, level: 0, levels: plan.length, toJSON: () => undefined };
  u.setSide = (hexCol) => { if (hexCol === side) return; side = hexCol; cols.material = sideMaterial(hexCol); };
  u.setDamage = (lv) => {
    lv = clamp(Math.round(+lv || 0), 0, 3);
    if (lv === level) return;
    level = lv; u.damage = lv;
    const d = shipOf(def, key, lv, plan[u.lod.level]);
    main.geometry = d.geo; cols.geometry = d.side || emptyGeo();
    props.forEach((grp, i) => {
      const q = d.info.props[i], gone = lv >= 3 || (lv === 2 && i === 0);
      grp.position.set(q[0], q[1], q[2]); dead[i].position.set(q[0], q[1], q[2]);
      grp.visible = !gone; dead[i].visible = gone;
    });
  };
  return g;
}

// =====================================================================================================
// DROP POD (standalone) AND AIRCRAFT
// =====================================================================================================
const smallCache = new Map();
/** two meshes sharing cached geometry: the model, and its parts in the side colour */
function twoMesh(key, sideHex, make) {
  const k = `${key}|${getDetail()}`;
  if (!smallCache.has(k)) {
    const p = new Pen(), fp = new Pen(), d = getDetail();
    Q = d === 'low' ? 0.6 : d === 'medium' ? 0.8 : 1; TIER = 0;
    let extra;
    try { extra = make(p, fp); } finally { Q = 1; }
    smallCache.set(k, { geo: p.toGeometry(), side: fp.n ? fp.toGeometry() : null, extra });
  }
  const c = smallCache.get(k), g = new THREE.Group(), m = new THREE.Mesh(c.geo, sculptMaterial());
  m.castShadow = true; m.receiveShadow = true; g.add(m);
  let sm = null;
  if (c.side) { sm = new THREE.Mesh(c.side, sideMaterial(sideHex)); sm.castShadow = true; sm.receiveShadow = true; sm.name = 'colours'; g.add(sm); }
  g.userData.setSide = (hexCol) => { if (sm) sm.material = sideMaterial(hexCol); };
  return { g, c };
}
const styleKey = (style) => (STYLES.includes(style) ? style : 'kingdom');

/** dropPod(style, sideColorHex) -> THREE.Group: an armoured pod 0.8 wide and 1.1 tall, origin at its base, fins and drogue pack in the side colour */
export function dropPod(style, sideColorHex = 0x3d7bd9) {
  const sk = styleKey(style);
  return twoMesh(`pod|${sk}`, sideColorHex, (p, fp) => drawPod(p, fp, sk, false)).g;
}

const PILOT = {
  kingdom: { skin: 0xd9a77c, cloth: 0x6a5238, cap: 0x7a4a2a, frame: OAK, metal: BRASS, body: hex(0x8a6238) },
  goblin: { skin: 0x6f9a48, cloth: 0x5a3f2a, cap: 0x3a2a1c, frame: DARKWOOD, metal: RUST, body: hex(0x7a4a2c) },
  undead: { skin: 0xd8cfb4, cloth: 0x2c2a34, cap: 0x35303c, frame: BONE, metal: hex(0x3a3a44), body: hex(0x2c2a34) },
  infernal: { skin: 0xb0382a, cloth: 0x2a2022, cap: 0x1a1414, frame: IRON, metal: IRON, body: hex(0x2a2022) },
  beasts: { skin: 0x8a6238, cloth: 0x6a4a2e, cap: 0x4a3524, frame: hex(0x6a4a2e), metal: hex(0x6a4a2e), body: hex(0xa88a5a) },
  elemental: { skin: 0x8a8f9a, cloth: 0x4a5a7a, cap: 0x5a5e6c, frame: SLATE, metal: STEEL, body: hex(0x85838c) },
  dragons: { skin: 0xa8482e, cloth: 0x5a2a22, cap: 0x3a1c18, frame: BONE, metal: BRASS, body: hex(0x7a2a22) },
};
/** a small airman: prone under a glider, or seated in a gyrocopter (craft frame: nose +X) */
function pilotPart(pose, style) {
  const c = PILOT[style], prone = pose === 'prone';
  const J = prone
    ? { hip: [-0.08, -0.3, 0], chest: [0.15, -0.275, 0], head: [0.3, -0.25, 0], sh: [0.17, -0.28, 0.1], el: [0.26, -0.38, 0.18], hand: [0.21, -0.455, 0.2], hj: [-0.08, -0.3, 0.06], knee: [-0.3, -0.3, 0.075], foot: [-0.52, -0.275, 0.07], toe: [-0.6, -0.3, 0.07] }
    : { hip: [-0.03, 0.1, 0], chest: [-0.06, 0.32, 0], head: [-0.035, 0.475, 0], sh: [-0.055, 0.335, 0.1], el: [0.07, 0.23, 0.135], hand: [0.2, 0.25, 0.07], hj: [-0.01, 0.1, 0.06], knee: [0.2, 0.15, 0.085], foot: [0.36, 0.03, 0.075], toe: [0.43, 0.035, 0.075] };
  const mz = (q) => [q[0], q[1], -q[2]], limbs = [];
  for (const m of [(q) => q, mz]) {
    limbs.push(...S.limb([m(J.sh), m(J.el), m(J.hand)], [0.042, 0.035, 0.03]).map((q) => q.color(c.cloth).blend(0.02)));
    limbs.push(S.sphere(0.034).at(...m(J.hand)).color(c.skin).blend(0.01));
    limbs.push(...S.limb([m(J.hj), m(J.knee), m(J.foot)], [0.055, 0.045, 0.038]).map((q) => q.color(c.cloth).blend(0.02)));
    limbs.push(S.capsule(m(J.foot), m(J.toe), 0.04, 0.034).color(0x2a1c12).blend(0.01));
  }
  const up = prone ? [1, 0.12, 0] : [0.1, 1, 0], hd = J.head;
  return {
    prims: [
      S.capsule(J.hip, J.chest, 0.085, 0.1).color(c.cloth).tint(0.15, 30),
      S.sphere(0.086).at(...J.hip).color(c.cloth).blend(0.03),
      S.capsule(J.chest, hd, 0.04, 0.04).color(c.skin).blend(0.02),
      S.sphere(0.082).at(...hd).color(c.skin).blend(0.015),
      S.ellipsoid(0.088, 0.075, 0.09).at(hd[0] - up[0] * 0.012 + (prone ? 0 : -0.012), hd[1] + (prone ? 0.02 : 0.025), 0).color(c.cap).blend(0.004),
      S.capsule([J.chest[0] + up[0] * 0.1, J.chest[1] + up[1] * 0.1, -0.06], [J.chest[0] + up[0] * 0.1, J.chest[1] + up[1] * 0.1, 0.06], 0.048).color(0xe6dcc0).blend(0.01),
      ...limbs,
    ],
    hard: [
      ...[1, -1].flatMap((sg) => { const f = prone ? [hd[0] + 0.045, hd[1] - 0.055, sg * 0.034] : [hd[0] + 0.07, hd[1] + 0.01, sg * 0.034]; return [HP.cyl(0.026, 0.026, 0.03, 12).rot(0, 0, prone ? 40 : 90).at(...f).color(0xc9a04a).pbr(0.4, 0.85), HP.sphere(0.021, 10).at(f[0] + (prone ? 0.008 : 0.012), f[1] - (prone ? 0.01 : 0), f[2]).color(0x1a2a3a).pbr(0.15, 0.3)]; }),
    ],
  };
}

/** a one-man glider: a kite wing on spars, the pilot slung prone beneath; the sail and tail go to fp */
function drawGlider(p, fp, style, pilot = true) {
  const c = PILOT[style], bone = c.frame, me = c.frame === IRON || c.frame === SLATE ? 0.6 : 0;
  const N = [0.52, 0, 0], K = [-0.5, -0.02, 0], tip = (sg) => [-0.22, 0.1, sg * 0.8];
  p.shade(null).ink(bone, 0.6, me);
  p.bar(K, N, 0.016, 0.016, 8);
  p.T(N[0], N[1], N[2]).sphere(0.026, 8, 6);
  for (const sg of [1, -1]) {
    const T = tip(sg), mid = [lerp(N[0], T[0], 0.5) + 0.03, lerp(N[1], T[1], 0.5) + 0.02, lerp(N[2], T[2], 0.5)];
    p.ink(bone, 0.6, me).tube([N, mid, T, [T[0] - 0.08, T[1] + 0.01, T[2] + sg * 0.03]], [0.017, 0.016, 0.012, 0.004], 7, 1);
    p.bar([0.06, 0.0, 0], [0.085, 0.04, sg * 0.5], 0.012, 0.01, 6);
    // the sail: three panels a side, scalloped between the battens, bellied by the wind
    const nu = seg(12, 5), nv = seg(18, 6);
    fp.shade(null).ink([1, 1, 1], 0.85).grid(nu, nv, (i, j, out) => {
      const b = j / nv, a = (i / nu) * (1 - 0.13 * Math.abs(Math.sin(3 * PI * b)) * (i / nu)), kp = lerp3(N, K, a), sp = lerp3(N, [T[0], T[1], T[2]], a), bow = 0.03 * Math.sin(PI * a) * b;
      out[0] = lerp(kp[0], sp[0], b) + bow; out[1] = lerp(kp[1], sp[1], b) + 0.075 * Math.sin(PI * b) * a + 0.012; out[2] = lerp(kp[2], sp[2], b);
    }, (i, j) => { const b = j / nv, pn = Math.floor(b * 3), v = (pn % 2 ? 0.62 : 1) * (Math.abs(b * 3 - Math.round(b * 3)) < 0.04 ? 0.5 : 1) * (0.85 + 0.15 * (i / nu)); return [v, v, v]; }, { away: [0, -5, 0] });
    for (let k = 1; k < 3; k++) { const b = k / 3; p.ink(mul(bone, 0.8), 0.7, me).bar([lerp(N[0], lerp(N[0], T[0], 0.2), b), 0.02, lerp(0, T[2] * 0.2, b)], [lerp(K[0], T[0], b), lerp(K[1], T[1], b) + 0.02, lerp(0, T[2], b)], 0.007, 0.006, 5); }
    // tail vanes
    fp.push(X(K[0] + 0.04, K[1], 0, sg * 38, 0, 0)); fp.ink([0.8, 0.8, 0.8], 0.85).extrude(rounded([[0.1, 0], [-0.05, 0.2], [-0.24, 0.26], [-0.22, 0.04], [-0.1, -0.01]], 3), 0.012, true); fp.pop();
    // control frame: down-tubes to the bar the pilot holds
    p.ink(bone, 0.6, me).bar([0.13, 0, 0], [0.21, -0.47, sg * 0.25], 0.012, 0.012, 6);
    if (TIER < 2) { p.ink(TAR, 0.9).bar([0.03, 0.2, 0], [T[0] + 0.1, T[1] + 0.012, T[2] * 0.85], 0.004, 0.004, 4, 0); p.bar([0.21, -0.47, sg * 0.25], [T[0] + 0.2, T[1], T[2] * 0.7], 0.004, 0.004, 4, 0); }
  }
  p.ink(bone, 0.6, me).bar([0.21, -0.47, -0.27], [0.21, -0.47, 0.27], 0.013, 0.013, 6);
  p.bar([0.03, 0, 0], [0.03, 0.21, 0], 0.012, 0.008, 6);
  p.ink(TAR, 0.9).bar([0.03, 0.2, 0], N, 0.004, 0.004, 4, 0); p.bar([0.03, 0.2, 0], K, 0.004, 0.004, 4, 0);
  if (pilot) {
    p.T(0, 0, 0).geo(sculpted(`pilot-prone-${style}`, () => pilotPart('prone', style), 66));
    p.shade(null).ink(HEMP, 0.95); p.bar([0.1, -0.2, 0], [0.06, 0, 0], 0.008, 0.008, 4, 0); p.bar([-0.06, -0.22, 0], [-0.02, 0, 0], 0.008, 0.008, 4, 0); p.bar([-0.42, -0.23, 0], [-0.3, -0.01, 0], 0.006, 0.006, 4, 0);
    p.ink(hex(0x4a3524), 0.85).T(0.04, -0.285, 0, 0, 0, 90).cyl(0.105, 0.1, 0.07, 12, 0);
  }
}
/** a one-man gyrocopter: an open tub, a rotor mast, a pusher screw and a little gun; returns nothing (the rotor is drawn by drawRotor) */
function drawGyro(p, fp, style) {
  const c = PILOT[style], me = style === 'goblin' || style === 'infernal' ? 0.6 : 0, wood = style === 'kingdom' || style === 'beasts' || style === 'dragons';
  // the tub: lofted, open on top
  const nu = seg(18, 8), nv = seg(14, 6), xr = (t) => lerp(-0.4, 0.5, t), rr = (t) => 0.2 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t - 0.45) / 0.56, 2.4)), 0.6);
  p.shade(wood ? grainX(0.22, 2) : mottle(0.2, 12)).ink(c.body, wood ? 0.75 : 0.55, me);
  p.grid(nu, nv, (i, j, out) => { const t = i / nu, a = lerp(-1.9, 1.9, j / nv), r = rr(t); out[0] = xr(t); out[1] = 0.1 - r * 1.05 * Math.cos(a) + 0.05 * Math.pow(t, 3); out[2] = r * Math.sin(a); },
    (i, j) => { const pl = Math.floor((j / nv) * 7); return mul(vary(c.body, pl * 7, 0.1), Math.abs((j / nv) * 7 - Math.round((j / nv) * 7)) < 0.07 ? 0.5 : 1); }, { away: [0, 0.3, 0] });
  for (const sg of [1, -1]) { const pts = []; for (let i = 0; i <= nu; i++) { const t = i / nu, r = rr(t); pts.push([xr(t), 0.1 - r * 1.05 * Math.cos(1.9) + 0.05 * Math.pow(t, 3), sg * r * Math.sin(1.9)]); } p.shade(null).ink(c.metal, 0.4, 0.85).tube(pts, 0.013, 6, 1); }
  p.shade(null).ink(c.metal, 0.38, 0.85); p.push(X(0.47, 0.135, 0, 0, 0, -90)); p.lathe([[0.075, 0], [0.08, 0.02], [0.06, 0.06], [0.03, 0.1], [0, 0.12]], 12); p.pop();
  p.ink(mul(c.body, 0.6), 0.85).T(-0.13, 0.2, 0, 0, 0, -12).box(0.03, 0.26, 0.24, 0.01);   // seat back
  p.T(0, 0.0, 0).box(0.5, 0.02, 0.24, 0.006);
  // engine behind the seat, its screw, and the tail
  p.push(X(-0.3, 0.2, 0, 0, 0, -90)); p.shade(mottle(0.2, 14)).ink(style === 'kingdom' ? COPPER : c.metal, 0.45, 0.8).lathe([[0, -0.1], [0.07, -0.09], [0.085, -0.05], [0.085, 0.08], [0.06, 0.12], [0, 0.13]], 14); p.shade(null).ink(IRON, 0.5, 0.8); for (const y of [-0.04, 0.02, 0.07]) p.T(0, y, 0).ring(0.088, 0.008, 14, 4); p.pop();
  p.ink(IRON, 0.6, 0.7).tube([[-0.3, 0.28, 0.05], [-0.34, 0.36, 0.08], [-0.44, 0.38, 0.09]], 0.016, 6, 1);
  p.ink(style === 'undead' ? GHOST : EMBER, 0.5, 0, 1.4).T(-0.26, 0.2, 0.086).box(0.05, 0.03, 0.01, 0);
  p.push(X(-0.43, 0.2, 0)); p.push(X(0, 0, 0, 0, 0, 90)); p.shade(null).ink(c.metal, 0.4, 0.85).lathe([[0.03, -0.03], [0.035, 0], [0.02, 0.05], [0, 0.07]], 10); p.pop();
  for (let i = 0; i < 3; i++) { p.push(X(0, 0, 0, i * 120 + 20, 0, 0)); p.shade(wood ? grainY(0.2) : null).ink(wood ? OAK : c.metal, 0.6, wood ? 0 : 0.7).T(0, 0, 0, 0, 62, 0).extrude([[-0.012, 0.02], [0.012, 0.02], [0.035, 0.1], [0.03, 0.19], [0, 0.21], [-0.03, 0.19], [-0.035, 0.1]], 0.01, true); p.pop(); }
  p.pop();
  p.shade(null).ink(c.frame, 0.6, c.frame === IRON ? 0.6 : 0).tube([[-0.36, 0.08, 0], [-0.6, 0.1, 0], [-0.86, 0.2, 0]], [0.035, 0.026, 0.016], 8, 1);
  fp.shade(null).ink([1, 1, 1], 0.85);
  fp.push(X(-0.8, 0.2, 0)); fp.extrude(rounded([[0.14, -0.02], [0.06, 0.2], [-0.08, 0.3], [-0.16, 0.26], [-0.12, -0.04], [-0.02, -0.08]], 3), 0.014, true); fp.pop();
  for (const sg of [1, -1]) { fp.push(X(-0.78, 0.2, 0, sg * 90, 0, 0)); fp.ink([0.75, 0.75, 0.75], 0.85).extrude(rounded([[0.1, 0], [0.04, 0.2], [-0.08, 0.23], [-0.1, 0]], 3), 0.012, true); fp.pop(); }
  for (const sg of [1, -1]) fp.ink([1, 1, 1], 0.8).T(0.14, 0.02, sg * (rr(0.6) * Math.sin(1.25) + 0.004), 0, 0, 0).box(0.2, 0.07, 0.006, 0.002);
  // mast and stays
  p.ink(c.frame, 0.6, c.frame === IRON ? 0.6 : 0).bar([-0.15, 0.05, 0], [-0.1, 0.74, 0], 0.022, 0.016, 8);
  p.bar([0.28, 0.14, 0.1], [-0.105, 0.66, 0], 0.008, 0.008, 5); p.bar([0.28, 0.14, -0.1], [-0.105, 0.66, 0], 0.008, 0.008, 5); p.bar([-0.38, 0.12, 0], [-0.105, 0.6, 0], 0.01, 0.01, 5);
  // wheels and a tail skid
  for (const sg of [1, -1]) {
    p.ink(c.frame, 0.6, c.frame === IRON ? 0.6 : 0).bar([0.1, -0.02, sg * 0.1], [0.14, -0.2, sg * 0.24], 0.014, 0.012, 6); p.bar([-0.08, -0.04, sg * 0.1], [0.14, -0.2, sg * 0.24], 0.01, 0.01, 5);
    p.push(X(0.14, -0.2, sg * 0.25, 90, 0, 0)); p.shade(null).ink(hex(0x2a221c), 0.9).ring(0.07, 0.022, 16, 6); p.ink(c.metal, 0.4, 0.85).cyl(0.02, 0.02, 0.05, 8); if (TIER < 2) for (let i = 0; i < 6; i++) p.bar([0, 0, 0], [Math.cos(i * 1.047) * 0.07, 0, Math.sin(i * 1.047) * 0.07], 0.005, 0.005, 4, 0); p.pop();
  }
  p.ink(c.frame, 0.6).tube([[-0.7, 0.13, 0], [-0.78, 0.0, 0], [-0.86, -0.04, 0]], 0.01, 5, 1);
  // the gun under the nose, with its drum
  gunBarrel(p, X(0.42, -0.03, 0, 0, 0, -90), 0.3, 0.03, IRON);
  p.shade(null).ink(mul(c.metal, 0.8), 0.45, 0.8).T(0.33, -0.04, 0.05, 90, 0, 0).cyl(0.045, 0.045, 0.03, 12);
  p.ink(IRON, 0.5, 0.8).bar([0.3, 0.02, 0], [0.34, -0.03, 0], 0.012, 0.012, 5);
  // stick
  p.ink(c.metal, 0.4, 0.85).bar([0.2, 0.01, 0], [0.2, 0.26, 0], 0.008, 0.008, 5); p.T(0.2, 0.26, 0).sphere(0.018, 8, 6);
  p.T(0, 0, 0).geo(sculpted(`pilot-seat-${style}`, () => pilotPart('seated', style), 66));
}
/** the gyrocopter's rotor about the origin: hub and three blades in the XZ plane */
function drawRotor(p, style) {
  const c = PILOT[style], wood = style !== 'goblin' && style !== 'infernal' && style !== 'elemental';
  p.shade(null).ink(c.metal, 0.4, 0.85).lathe([[0.02, -0.05], [0.05, -0.03], [0.055, 0.01], [0.03, 0.03], [0.012, 0.07], [0, 0.075]], 12);
  for (let i = 0; i < 3; i++) {
    p.push(X(0, 0.0, 0, 0, i * 120, 0));
    p.shade(wood ? grainX(0.2, 2) : null).ink(wood ? (style === 'undead' ? BONE : PINE) : c.metal, 0.6, wood ? 0 : 0.7);
    p.push(X(0, 0, 0, 90, 0, 0)); p.T(0, 0, 0, 0, 0, 0).extrude(rounded([[0.04, -0.02], [0.3, -0.05], [0.72, -0.045], [0.8, 0], [0.72, 0.04], [0.3, 0.035], [0.04, 0.02]], 3), 0.012, true); p.pop();
    p.shade(null).ink(c.metal, 0.4, 0.85).T(0.09, 0, 0).box(0.1, 0.02, 0.05, 0.006);
    p.pop();
  }
}

/**
 * aircraft(kind, sideColorHex, style) -> THREE.Group: 'glider' | 'gyro', nose toward +X, origin at the craft's centre.
 * userData.rotor (gyro only): the main rotor, to spin about its local Y. Wings and tail are in the side colour.
 */
export function aircraft(kind, sideColorHex = 0x3d7bd9, style = 'kingdom') {
  const sk = styleKey(style);
  if (kind === 'gyro') {
    const { g } = twoMesh(`gyro|${sk}`, sideColorHex, (p, fp) => drawGyro(p, fp, sk));
    const rk = `rotor|${sk}`;
    if (!smallCache.has(rk)) { const p = new Pen(); drawRotor(p, sk); smallCache.set(rk, p.toGeometry()); }
    const rotor = new THREE.Group(), rm = new THREE.Mesh(smallCache.get(rk), sculptMaterial());
    rm.castShadow = true; rotor.add(rm); rotor.position.set(-0.1, 0.75, 0); rotor.name = 'rotor';
    g.add(rotor); g.userData.rotor = rotor;
    return g;
  }
  return twoMesh(`glider|${sk}`, sideColorHex, (p, fp) => drawGlider(p, fp, sk, true)).g;
}

// =====================================================================================================
// AIRFIELD BUILDINGS
// =====================================================================================================
const WEATHERED = hex(0x8f7a5c), TIMBER = hex(0x7a5a38), TIMBER_DK = hex(0x5a4028), VERDIGRIS = hex(0x5f9c8c), PLASTER = hex(0xd8ccb0), FLAG = hex(0x8a8478);
/** a squared timber between two points, grain running along it */
function timber(p, a, b, w, h = w, col = TIMBER, seed = 0, ch = 0.012) {
  const d = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])];
  p.shade(d[0] >= d[1] && d[0] >= d[2] ? grainX(0.22) : d[1] >= d[2] ? grainY(0.22) : grainZ(0.22)).ink(vary(col, seed * 13 + 3, 0.1), 0.85);
  p.beam(a, b, w, h, ch);
}
/** an iron strap plate with studs, lying in the local XY plane */
function gusset(p, m, w, h, studsN = 4) {
  p.push(m); p.shade(null).ink(IRON, 0.5, 0.8).box(w, h, 0.016, 0.004);
  if (TIER < 1) for (let i = 0; i < studsN; i++) { const a = (i / studsN) * TAU + 0.78; p.T(Math.cos(a) * w * 0.33, Math.sin(a) * h * 0.33, 0.009).sphere(0.012, 5, 3); }
  p.pop();
}
/**
 * Coursed blocks on a surface S(a, b) -> [x, y, z] (a along 0..1, b up 0..1) with outward normal Nf(a, b):
 * la, hb = its size in tiles. Every block is its own piece, sunk at the joints. o: { course, len, col, seed, closed, sub }
 */
function masonry(p, S, Nf, la, hb, o = {}) {
  const courses = Math.max(1, Math.round(hb / (o.course || 0.2))), col = o.col || STONE, g = o.groove ?? 0.014, seed = o.seed || 0, sub = seg(o.sub || 1, 1);
  p.shade(mottle(0.22, 11));
  for (let c = 0; c < courses; c++) {
    const b0 = c / courses, b1 = (c + 1) / courses, nb = Math.max(1, Math.round(la / (o.len || 0.4))), offs = (c % 2) * 0.5;
    for (let k = 0; k < nb + (offs && !o.closed ? 1 : 0); k++) {
      let a0 = (k - offs) / nb, a1 = (k + 1 - offs) / nb;
      if (!o.closed) { a0 = Math.max(0, a0); a1 = Math.min(1, a1); if (a1 - a0 < 1e-4) continue; }
      const base = vary(col, seed + c * 37 + k * 11, o.vary ?? 0.13), dark = mul(base, 0.38), ea = Math.min(0.022 / la, (a1 - a0) * 0.2), eb = Math.min(0.022 / hb, (b1 - b0) * 0.2);
      const as = [[a0, 1], [a0 + ea, 0]];
      for (let i = 1; i < sub; i++) as.push([lerp(a0, a1, i / sub), 0]);
      as.push([a1 - ea, 0], [a1, 1]);
      const bs = [[b0, 1], [b0 + eb, 0], [b1 - eb, 0], [b1, 1]];
      p.ink(base, 0.95).grid(as.length - 1, 3, (i, j, out) => { const a = as[i][0], b = bs[j][0], q = S(a, b); if (as[i][1] || bs[j][1]) { const n = Nf(a, b); q[0] -= n[0] * g; q[1] -= n[1] * g; q[2] -= n[2] * g; } out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
        (i, j) => (as[i][1] || bs[j][1] ? dark : base), o.flip ? { flip: true } : null);
    }
  }
}
/** a flat wall of blocks from corner o along ux (length la) and up (height hb), facing n */
function stoneWall(p, o, ux, la, hb, n, opt = {}) {
  masonry(p, (a, b) => [o[0] + ux[0] * a * la, o[1] + b * hb, o[2] + ux[2] * a * la], () => n, la, hb, { ...opt, flip: cross(ux, [0, 1, 0])[0] * n[0] + cross(ux, [0, 1, 0])[2] * n[2] < 0 });
}
/** a cask standing on the local origin */
function barrel(p, r, h, seed = 0) {
  const prof = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push([r * (0.82 + 0.18 * Math.sin(PI * t)), t * h]); }
  p.shade((x, y, z, nx, ny, nz, c) => mul(c, (0.8 + 0.3 * noise3(x * 30, y * 2, z * 30)) * (Math.abs(Math.sin(Math.atan2(nz, nx) * 7)) < 0.12 ? 0.55 : 1))).ink(vary(OAK, seed, 0.12), 0.8);
  p.lathe([[0, 0], [prof[0][0], 0], ...prof, [prof[8][0], h], [prof[8][0] - 0.02, h], [prof[8][0] - 0.025, h - 0.03], [0, h - 0.03]], 16);
  p.shade(null).ink(IRON, 0.5, 0.8);
  for (const t of [0.12, 0.36, 0.64, 0.88]) p.T(0, t * h, 0).lathe([[r * (0.82 + 0.18 * Math.sin(PI * t)) + 0.006, -0.02], [r * (0.82 + 0.18 * Math.sin(PI * t)) + 0.01, 0], [r * (0.82 + 0.18 * Math.sin(PI * t)) + 0.006, 0.02]], 16);
}
/** rows of shingles on a slope: o = eave corner, ux along the eave (length w), uy up the slope (length len) */
function shingles(p, o, ux, uy, w, len, col, seed = 0) {
  const n = norm3(cross(ux, uy)), up = n[1] < 0 ? [-n[0], -n[1], -n[2]] : n, rows = Math.max(2, Math.round(len / 0.2)), rh = len / rows, t = 0.035;
  const P = (a, b, h) => [o[0] + ux[0] * a + uy[0] * b + up[0] * h, o[1] + ux[1] * a + uy[1] * b + up[1] * h, o[2] + ux[2] * a + uy[2] * b + up[2] * h];
  p.shade(mottle(0.25, 14));
  for (let r = 0; r < rows; r++) {
    const cnt = Math.max(2, Math.round(w / 0.18)), offs = (r % 2) * 0.5;
    for (let k = -1; k < cnt; k++) {
      const a0 = Math.max(0, ((k + offs) / cnt) * w + 0.006), a1 = Math.min(w, ((k + 1 + offs) / cnt) * w - 0.006);
      if (a1 - a0 < 0.02) continue;
      const b0 = r * rh - (r ? 0.02 : 0.05) - 0.03 * hash2(r * 31 + k, seed), b1 = Math.min(len, (r + 1.25) * rh);
      const c = vary(col, seed + r * 53 + k * 7, 0.16), f = mul(c, 0.55);
      p.ink(c, 0.9).poly([P(a0, b0, t), P(a1, b0, t), P(a1, b1, 0.004), P(a0, b1, 0.004)]);
      p.ink(f, 0.9).poly([P(a0, b0, 0), P(a1, b0, 0), P(a1, b0, t), P(a0, b0, t)]);
      if (TIER < 1) { p.poly([P(a0, b0, 0), P(a0, b0, t), P(a0, b1, 0.004)]); p.poly([P(a1, b0, 0), P(a1, b1, 0.004), P(a1, b0, t)]); }
    }
  }
}
/** a pole with a pennant in the side colour at its head */
function pennantPole(p, fp, foot, head, len = 0.7, hgt = 0.26) {
  staff(p, foot, head, 0.02, TIMBER_DK, BRASS);
  fp.push(X(head[0], head[1] - 0.03, head[2])); flag(fp, len, hgt, { tail: 0.45 }); fp.pop();
}
/** a coil of rope lying flat on the local origin */
function coil(p, R = 0.12, turns = 3, r = 0.018) {
  p.shade(null).ink(HEMP, 0.95);
  for (let i = 0; i < turns; i++) p.T(0, r + i * r * 1.7, 0).ring(R - (i % 2) * r * 0.6, r, 16, 5);
}

// ---------- the dock: a timber pier, its walk exactly one level up ----------
function buildDock(p, fp, L, D) {
  const hw = D / 2, Y = 0.8, zp = hw - 0.1, ze = hw - 0.205, np = Math.max(2, Math.round(L / 1.45) + 1);
  // the walk: planks athwart, all dead level at Y
  const n = Math.round(L / 0.2), pw = L / n;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * pw, c = vary(WEATHERED, i * 17 + 3, 0.14), h1 = hash1(i * 7 + 1);
    p.shade(grainZ(0.24)).ink(c, 0.9).T(x, Y - 0.03, (h1 - 0.5) * 0.02).box(pw - 0.012, 0.06, 2 * ze - 0.02 * h1, 0.01);
    if (TIER < 1) { p.shade(null).ink(IRON, 0.55, 0.8); for (const z of [-ze + 0.1, 0, ze - 0.1]) p.T(x, Y - 0.001, z + (hash1(i * 3 + 5) - 0.5) * 0.02).sphere(0.011, 5, 3); }
  }
  for (const z of [-ze + 0.1, 0, ze - 0.1]) timber(p, [-L / 2 + 0.05, 0.68, z], [L / 2 - 0.05, 0.68, z], 0.1, 0.12, TIMBER_DK, z * 10);
  const xs = Array.from({ length: np }, (_, k) => lerp(-L / 2 + 0.3, L / 2 - 0.3, k / (np - 1)));
  xs.forEach((x, k) => {
    timber(p, [x, 0.56, -hw + 0.03], [x, 0.56, hw - 0.03], 0.14, 0.12, TIMBER, k);
    for (const sg of [1, -1]) {
      // piles: round logs driven into the ground; every other one stands proud as a bollard
      const tall = (k + (sg > 0 ? 0 : 1)) % 2 === 0, top = tall ? 1.14 : 0.74, nu = seg(14, 7), nvv = seg(7, 3), sd = k * 5 + (sg > 0 ? 1 : 2);
      p.shade(grainY(0.3)).ink(vary(TIMBER_DK, sd * 9, 0.12), 0.92);
      p.grid(nu, nvv, (i, j, out) => { const a = (i / nu) * TAU, y = lerp(-0.06, top, j / nvv), r = 0.1 * (1.08 - 0.1 * (j / nvv)) * (0.94 + 0.12 * noise3(Math.cos(a) * 2 + sd, y * 1.5, Math.sin(a) * 2)); out[0] = x + Math.cos(a) * r; out[1] = y; out[2] = sg * zp + Math.sin(a) * r; }, null, { wrapU: true, away: [x, 0.4, sg * zp] });
      p.T(x, top, sg * zp).lathe([[0.092, 0], [0.085, 0.02], [0, 0.03]], 12);
      p.shade(null).ink(IRON, 0.5, 0.8).T(x, top - 0.06, sg * zp).ring(0.1, 0.012, 14, 4);
      if (tall) { p.ink(HEMP, 0.95); for (let i = 0; i < 3; i++) p.T(x, 0.9 + i * 0.03, sg * zp).ring(0.108, 0.016, 14, 5); }
      timber(p, [x, 0.12, sg * (zp - 0.02)], [x, 0.5, -sg * (zp - 0.3)], 0.05, 0.08, TIMBER, sd);
      if (k < np - 1) { const x2 = xs[k + 1], up = (k + (sg > 0 ? 0 : 1)) % 2; timber(p, [x + 0.06, up ? 0.14 : 0.52, sg * (zp + 0.02)], [x2 - 0.06, up ? 0.52 : 0.14, sg * (zp + 0.02)], 0.05, 0.08, TIMBER, sd + 3); }
      if (k < np - 1 && TIER < 2) {   // the rope along the edge, bollard to pile
        const x2 = xs[k + 1], y0 = tall ? 0.96 : 0.76, y1 = tall ? 0.76 : 0.96;
        rope(p, [x, y0, sg * zp], [x2, y1, sg * zp], 0.017, HEMP, 0.07);
      }
    }
  });
  // rope fenders down the sides and a ladder at the landward end
  for (const sg of [1, -1]) for (let k = 0; k < np - 1; k++) { const x = (xs[k] + xs[k + 1]) / 2; p.shade(null).ink(mul(HEMP, 0.8), 0.95).T(x, 0.5, sg * (hw - 0.03)).lathe([[0, -0.14], [0.045, -0.12], [0.06, 0], [0.045, 0.12], [0, 0.14]], 10); rope(p, [x, 0.62, sg * (hw - 0.03)], [x, 0.76, sg * (ze + 0.0)], 0.01); }
  const xl = -L / 2 + 0.75;
  for (const dx of [-0.16, 0.16]) timber(p, [xl + dx, 0, hw + 0.03], [xl + dx, 0.84, hw - 0.14], 0.05, 0.06, TIMBER, 4);
  for (let i = 1; i <= 5; i++) timber(p, [xl - 0.16, i * 0.135, hw + 0.03 - i * 0.027], [xl + 0.16, i * 0.135, hw + 0.03 - i * 0.027], 0.035, 0.045, TIMBER, i);
  // the crane at the seaward end: post, jib, brace, tackle and hook, a pennant at its head
  const cx = L / 2 - 0.3, cz = -zp;
  timber(p, [cx, 0.55, cz + 0.02], [cx, 2.55, cz + 0.02], 0.13, 0.13, TIMBER_DK, 9);
  const jib = [cx - 1.05, 2.72, cz + 0.62];
  timber(p, [cx, 2.2, cz], jib, 0.09, 0.11, TIMBER, 10);
  timber(p, [cx, 1.55, cz], lerp3([cx, 2.2, cz], jib, 0.55), 0.06, 0.08, TIMBER, 11);
  gusset(p, X(cx, 2.2, cz + 0.07), 0.2, 0.2); gusset(p, X(cx, 1.55, cz + 0.07), 0.16, 0.16);
  p.shade(null).ink(IRON, 0.5, 0.8).T(jib[0], jib[1] - 0.06, jib[2], 0, 30, 90).ring(0.05, 0.014, 12, 5);
  rope(p, [cx, 2.5, cz], jib, 0.012, HEMP, 0.03); rope(p, [jib[0], jib[1] - 0.1, jib[2]], [jib[0], 1.95, jib[2]], 0.012);
  p.shade(null).ink(OAK, 0.8).T(jib[0], 1.9, jib[2]).box(0.07, 0.12, 0.05, 0.015);
  p.ink(IRON, 0.5, 0.8).tube([[jib[0], 1.84, jib[2]], [jib[0], 1.76, jib[2]], [jib[0] + 0.05, 1.71, jib[2]], [jib[0] + 0.06, 1.78, jib[2]]], 0.012, 6, 1);
  p.T(cx, 1.5, cz + 0.1, 90, 0, 0).cyl(0.07, 0.07, 0.1, 12); p.bar([cx, 1.5, cz + 0.15], [cx + 0.14, 1.5, cz + 0.17], 0.01, 0.01, 5);
  pennantPole(p, fp, [cx, 2.5, cz], [cx, 3.1, cz], 0.7, 0.26);
  // a lantern post on the opposite corner, and coils on the bollards
  const lx = -L / 2 + 0.3, lz = zp;
  timber(p, [lx, 0.5, lz], [lx, 2.0, lz], 0.09, 0.09, TIMBER_DK, 12);
  p.shade(null).ink(IRON, 0.5, 0.8).tube([[lx, 1.9, lz], [lx + 0.08, 2.02, lz - 0.1], [lx + 0.2, 1.98, lz - 0.2]], 0.012, 5, 1);
  p.push(X(lx + 0.2, 1.98, lz - 0.2)); lantern(p, 1.5); p.pop();
}

// ---------- the mooring mast ----------
function buildTower(p, fp) {
  // stone base: a battered drum on a plinth, capped with flags, steps up one side
  const r0 = 1.34, r1 = 1.22, hB = 0.9;
  masonry(p, (a, b) => { const r = lerp(r0, r1, b), t = a * TAU; return [Math.cos(t) * r, 0.1 + b * (hB - 0.16), Math.sin(t) * r]; }, (a) => [Math.cos(a * TAU), 0.1, Math.sin(a * TAU)], TAU * 1.28, hB - 0.16, { course: 0.185, len: 0.46, closed: true, sub: 4, seed: 3, col: hex(0x9a958a) });
  p.shade(mottle(0.2, 9)).ink(hex(0x86827a), 0.95).lathe([[0, 0], [1.42, 0], [1.42, 0.07], [1.36, 0.11], [1.34, 0.11]], 40);
  p.ink(hex(0xa39e92), 0.95).lathe([[1.2, hB - 0.07], [1.29, hB - 0.06], [1.3, hB - 0.02], [1.27, hB], [0, hB]], 40);
  if (TIER < 2) for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; p.shade(null).ink(mul(STONE, 0.5), 1).T(Math.cos(a) * 0.9, hB + 0.001, Math.sin(a) * 0.9, 0, -a / DEG, 0).box(0.74, 0.004, 0.012, 0); }
  for (let i = 0; i < 4; i++) { p.shade(mottle(0.2, 9)).ink(vary(hex(0x9a958a), i * 7, 0.1), 0.95).T(-1.22 - (3 - i) * 0.09 + 0.1, (i + 0.5) * 0.225, 0).box(0.5 + (3 - i) * 0.18, 0.225, 0.7, 0.015); }
  // the lattice: four posts leaning in, girts, crossed braces, iron at every joint
  const yT = 5.05, post = (sx, sz, y) => { const t = (y - hB) / (yT - hB), h = lerp(0.84, 0.54, t); return [sx * h, y, sz * h]; };
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]], lv = [hB + 0.02, 1.75, 2.55, 3.3, 4.0, 4.62, yT];
  corners.forEach(([sx, sz], i) => {
    timber(p, post(sx, sz, hB), post(sx, sz, yT), 0.14, 0.14, TIMBER_DK, i);
    p.shade(mottle(0.2, 9)).ink(hex(0x8a857a), 0.95).T(sx * 0.84, hB + 0.05, sz * 0.84).box(0.26, 0.1, 0.26, 0.02);
    p.shade(null).ink(IRON, 0.5, 0.8).T(sx * 0.836, hB + 0.16, sz * 0.836).box(0.16, 0.08, 0.16, 0.01);
  });
  for (let f = 0; f < 4; f++) {
    const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4], out = [(ax + bx) / 2, 0, (az + bz) / 2];
    for (let k = 1; k < lv.length; k++) {
      const a0 = post(ax, az, lv[k - 1]), b0 = post(bx, bz, lv[k - 1]), a1 = post(ax, az, lv[k]), b1 = post(bx, bz, lv[k]);
      timber(p, a1, b1, 0.085, 0.1, TIMBER, f * 7 + k);
      if (k === lv.length - 1) continue;
      if (lv[k] - lv[k - 1] > 0.5) { timber(p, add3(a0, out, 0.02), add3(b1, out, 0.02), 0.045, 0.07, TIMBER, f * 9 + k); timber(p, add3(b0, out, -0.02), add3(a1, out, -0.02), 0.045, 0.07, TIMBER, f * 9 + k + 3); }
      const ry = out[0] ? (out[0] > 0 ? 90 : -90) : out[2] > 0 ? 0 : 180;
      gusset(p, X(a1[0] + out[0] * 0.08, a1[1], a1[2] + out[2] * 0.08, 0, ry, 0), 0.17, 0.17); gusset(p, X(b1[0] + out[0] * 0.08, b1[1], b1[2] + out[2] * 0.08, 0, ry, 0), 0.17, 0.17);
      if (lv[k] - lv[k - 1] > 0.5) { const c = lerp3(lerp3(a0, b0, 0.5), lerp3(a1, b1, 0.5), 0.5); gusset(p, X(c[0] + out[0] * 0.05, c[1], c[2] + out[2] * 0.05, 0, ry, 45), 0.12, 0.12, 1); }
    }
  }
  // the spiral stair round a newel, with a handrail
  const yP = 4.62, ns = 31, rise = (yP - hB - 0.02) / ns, rail = [];
  p.shade(grainY(0.2)).ink(TIMBER_DK, 0.85).T(0, (hB + 6.05) / 2, 0).cyl(0.065, 0.075, 6.05 - hB, 12);
  for (let i = 0; i < ns; i++) {
    const a = i * 31 * DEG + 0.6, y = hB + (i + 1) * rise, rr = Math.min(0.5, post(1, 1, y)[0] - 0.07);
    p.push(X(0, y - 0.018, 0, 0, -a / DEG, 0));
    p.shade(grainX(0.22)).ink(vary(PINE, i * 5, 0.12), 0.85).T(rr / 2 + 0.03, 0, 0).box(rr, 0.035, 0.17, 0.008);
    if (TIER < 2) p.shade(null).ink(IRON, 0.5, 0.8).T(0.08, -0.03, 0).box(0.12, 0.03, 0.05, 0.004);
    p.shade(null).ink(IRON, 0.5, 0.8).bar([rr - 0.01, 0.01, 0], [rr - 0.01, 0.52, 0], 0.01, 0.01, 6, 0); p.T(rr - 0.01, 0.26, 0).sphere(0.018, 6, 4);
    p.pop();
    rail.push([Math.cos(a) * (rr - 0.01), y + 0.5, Math.sin(a) * (rr - 0.01)]);
  }
  p.shade(null).ink(mul(BRASS, 0.8), 0.45, 0.8).tube(spline(rail, seg(3, 1)).pts, 0.016, 6, 1);
  // the docking platform: joists on brackets, a planked deck with a stair well, rails with a boarding gap toward the arm
  const hp = 1.12;
  for (const z of [-0.62, 0.62]) timber(p, [-hp, yP - 0.1, z], [hp, yP - 0.1, z], 0.09, 0.12, TIMBER_DK, z * 5);
  for (const x of [-0.62, 0.62]) timber(p, [x, yP - 0.2, -hp], [x, yP - 0.2, hp], 0.09, 0.1, TIMBER_DK, x * 3);
  corners.forEach(([sx, sz], i) => { const q = post(sx, sz, 3.95); timber(p, q, [sx * (hp - 0.08), yP - 0.2, sz * (hp - 0.08)], 0.07, 0.09, TIMBER, i + 20); });
  const npk = 11, pwk = (2 * hp) / npk;
  for (let i = 0; i < npk; i++) {
    const x = -hp + (i + 0.5) * pwk, c = vary(WEATHERED, i * 13 + 1, 0.13), well = x > -0.52 && x < 0.2;
    p.shade(grainZ(0.24)).ink(c, 0.9);
    if (well) { p.T(x, yP - 0.02, (hp + 0.5) / 2).box(pwk - 0.012, 0.045, hp - 0.5, 0.008); p.T(x, yP - 0.02, -(hp + 0.5) / 2).box(pwk - 0.012, 0.045, hp - 0.5, 0.008); }
    else p.T(x, yP - 0.02, 0).box(pwk - 0.012, 0.045, 2 * hp, 0.008);
  }
  const rp = [];
  for (let i = 0; i < 16; i++) { const t = i / 16, s4 = Math.floor(t * 4), f = t * 4 - s4, c0 = corners[s4], c1 = corners[(s4 + 1) % 4]; rp.push([lerp(c0[0], c1[0], f) * (hp - 0.05), lerp(c0[1], c1[1], f) * (hp - 0.05)]); }
  rp.forEach(([x, z], i) => { if (x > hp - 0.2 && Math.abs(z) < 0.3) return; timber(p, [x, yP, z], [x, yP + 0.5, z], 0.055, 0.055, TIMBER, i); p.shade(null).ink(BRASS, 0.4, 0.85).T(x, yP + 0.52, z).sphere(0.03, 8, 6); });
  for (const [a, b] of [[[hp - 0.05, hp - 0.05], [-hp + 0.05, hp - 0.05]], [[-hp + 0.05, hp - 0.05], [-hp + 0.05, -hp + 0.05]], [[-hp + 0.05, -hp + 0.05], [hp - 0.05, -hp + 0.05]], [[hp - 0.05, -hp + 0.05], [hp - 0.05, -0.53]], [[hp - 0.05, 0.53], [hp - 0.05, hp - 0.05]]]) {
    timber(p, [a[0], yP + 0.47, a[1]], [b[0], yP + 0.47, b[1]], 0.05, 0.045, TIMBER_DK, a[0] * 3 + b[1]);
    rope(p, [a[0], yP + 0.26, a[1]], [b[0], yP + 0.26, b[1]], 0.014, HEMP, 0.04);
  }
  // the mast head: mooring arm with its brace and ring, a coiled line, a lantern, and the windsock
  const yA = 5.5, tip = [1.72, yA + 0.12, 0];
  timber(p, [-0.35, yA - 0.04, 0], tip, 0.1, 0.12, TIMBER_DK, 31);
  timber(p, [0.04, yT + 0.02, 0], [1.05, yA + 0.02, 0], 0.06, 0.08, TIMBER, 32);
  gusset(p, X(0.02, yA, 0.065), 0.24, 0.2); gusset(p, X(1.05, yA + 0.06, 0.065), 0.16, 0.14);
  p.shade(null).ink(IRON, 0.45, 0.85).T(tip[0] - 0.02, tip[1] - 0.02, 0, 0, 0, 90).ring(0.075, 0.016, 14, 5);
  p.T(tip[0] + 0.02, tip[1] - 0.24, 0, 90, 0, 0).ring(0.16, 0.028, 22, 7);
  p.ink(IRON, 0.5, 0.8).tube([[0.62, yA - 0.02, 0.07], [0.62, yA - 0.12, 0.1], [0.62, yA - 0.1, 0.16]], 0.014, 5, 1);
  p.shade(null).ink(HEMP, 0.95); for (let i = 0; i < 4; i++) p.T(0.62, yA - 0.27 - i * 0.012, 0.12 + i * 0.008, 90, 0, 8 * i).ring(0.15 - i * 0.008, 0.018, 18, 5);
  rope(p, [tip[0] + 0.02, tip[1] - 0.4, 0], [hp - 0.05, yP + 0.5, 0.53], 0.016, HEMP, 0.22);
  p.push(X(1.2, yA - 0.03, 0)); lantern(p, 1.5); p.pop();
  p.shade(null).ink(BRASS, 0.4, 0.85).T(0, 6.06, 0).sphere(0.05, 10, 7);
  const ys = 5.9;
  p.shade(null).ink(IRON, 0.5, 0.8).T(-0.2, ys, 0, 0, 0, 90).ring(0.13, 0.012, 16, 5); p.bar([0, ys + 0.1, 0], [-0.2, ys + 0.13, 0], 0.008, 0.008, 4, 0); p.bar([0, ys - 0.1, 0], [-0.2, ys - 0.13, 0], 0.008, 0.008, 4, 0);
  const nu = seg(16, 6), nvv = seg(12, 6);
  fp.shade(null).ink([1, 1, 1], 0.9).grid(nu, nvv, (i, j, out) => { const t = i / nu, a = (j / nvv) * TAU, r = lerp(0.13, 0.055, t) * (1 + 0.06 * Math.sin(t * 9)); out[0] = -0.2 - t * 0.95; out[1] = ys - 0.16 * t * t + Math.cos(a) * r; out[2] = Math.sin(a) * r + 0.05 * Math.sin(t * 5) * t; },
    (i) => { const v = Math.floor((i / nu) * 5) % 2 ? 0.5 : 1; return [v, v, v]; }, { wrapV: true });
}

// ---------- the hangar: an arched shed, open along its front ----------
function buildHangar(p, fp, W, Dp) {
  const a = W / 2 - 0.15, Ht = 2.75, zb = -Dp / 2 + 0.06, zf = Dp / 2 - 0.46, wallH = 0.42;
  const arch = (t, off = 0) => { const c = Math.cos(t), s = Math.sin(t), x = a * Math.sign(c) * Math.pow(Math.abs(c), 0.82), y = Ht * Math.pow(s, 0.9), l = Math.hypot(Ht * c, a * s) || 1; return [x + (off * Ht * c) / l, y + (off * a * s) / l]; };
  const t0 = Math.asin(Math.pow(wallH / Ht, 1 / 0.9));   // where the vault lands on the knee walls
  const yAt = (x) => { const c = clamp(Math.abs(x) / a, 0, 1), t = Math.acos(Math.pow(c, 1 / 0.82)); return Ht * Math.pow(Math.sin(t), 0.9); };
  // floor: boards laid front to back on a packed pad
  p.shade(mottle(0.2, 6)).ink(hex(0x7a6a52), 1).T(0, 0.012, (zb + zf) / 2).box(W - 0.3, 0.024, zf - zb + 0.2, 0);
  const nf = Math.round((2 * a - 0.5) / 0.24);
  for (let i = 0; i < nf; i++) p.shade(grainZ(0.22)).ink(vary(WEATHERED, i * 11, 0.12), 0.9).T(-a + 0.25 + (i + 0.5) * ((2 * a - 0.5) / nf), 0.035, (zb + zf) / 2 + 0.1).box((2 * a - 0.5) / nf - 0.012, 0.03, zf - zb + 0.25, 0.006);
  // knee walls of dressed stone down both sides
  for (const sg of [1, -1]) {
    const xo = sg * (a + 0.1), xi = sg * (a - 0.16), la = zf - zb + 0.1;
    stoneWall(p, [xo, 0, zb - 0.02], [0, 0, 1], la, wallH, [sg, 0, 0], { len: 0.48, course: 0.21, seed: sg * 5 + 9 });
    stoneWall(p, [xi, 0, zb - 0.02], [0, 0, 1], la, wallH, [-sg, 0, 0], { len: 0.48, course: 0.21, seed: sg * 5 + 19 });
    p.shade(mottle(0.2, 9)).ink(hex(0x9a958a), 0.95).T((xo + xi) / 2, wallH + 0.02, zb - 0.02 + la / 2).box(0.32, 0.05, la + 0.04, 0.012);
    p.T((xo + xi) / 2, wallH / 2, zf + 0.08).box(0.26, wallH, 0.04, 0.01);
  }
  // ribs: laminated arches, strapped with iron
  const nr = 5, zs = Array.from({ length: nr }, (_, i) => lerp(zb + 0.07, zf, i / (nr - 1))), na = seg(60, 16);
  const sect = [[-0.08, -0.07], [-0.07, -0.08], [0.07, -0.08], [0.08, -0.07], [0.08, 0.07], [0.07, 0.08], [-0.07, 0.08], [-0.08, 0.07]];
  zs.forEach((z, ri) => {
    const big = ri === nr - 1 ? 1.25 : 1;
    p.shade(mottle(0.18, 10)).ink(vary(TIMBER_DK, ri * 7, 0.08), 0.85);
    p.grid(na, sect.length, (i, j, out) => { const t = lerp(t0 * 0.6, PI - t0 * 0.6, i / na), q = sect[j % sect.length], pt = arch(t, q[1] * big - 0.02); out[0] = pt[0]; out[1] = pt[1]; out[2] = z + q[0] * big; },
      (i, j) => mul(vary(TIMBER_DK, ri * 7 + Math.floor((i / na) * 7), 0.12), (i % Math.round(na / 7) === 0 ? 0.55 : 1)), { wrapV: true });
    if (TIER < 2) for (let k = 1; k < 7; k++) { const t = lerp(t0, PI - t0, k / 7), q = arch(t, 0.065 * big), q2 = arch(t + 0.01, 0.065 * big); p.push(frame([q[0], q[1], z], [q2[0] - q[0], q2[1] - q[1], 0], [0, 0, 1])); p.shade(null).ink(IRON, 0.5, 0.8).box(0.09, 0.19 * big, 0.016, 0.004); if (TIER < 1) for (const s2 of [-1, 1]) p.T(0, s2 * 0.06, 0.01).sphere(0.012, 5, 3); p.pop(); }
  });
  // the roof: copper sheets lapped like clinker between the ribs, green with weather
  const nsr = seg(34, 14), nz = seg(8, 3);
  for (let k = 0; k < nsr; k++) {
    const ta = lerp(t0 * 0.75, PI - t0 * 0.75, k / nsr), tb = lerp(t0 * 0.75, PI - t0 * 0.75, (k + 1) / nsr), up = (ta + tb) / 2 < PI / 2;
    const c = vary(VERDIGRIS, k * 23 + 5, 0.13), lo = up ? ta : tb, hi = up ? tb : ta;
    p.shade(mottle(0.3, 5)).ink(c, 0.6, 0.35);
    p.grid(nz, 2, (i, j, out) => { const z = lerp(zb + 0.02, zf - 0.02, i / nz), q = arch(j === 0 ? lerp(lo, hi, -0.22) : j === 1 ? lerp(lo, hi, 0.5) : hi, j === 0 ? 0.066 : j === 1 ? 0.052 : 0.04); out[0] = q[0]; out[1] = q[1]; out[2] = z; },
      (i, j) => { const k2 = (j === 0 ? 0.6 : 1) * (0.82 + 0.3 * noise3(i * 0.9 + k, k * 0.7, 3)) * (i > 0 && i < nz && i % 2 === 0 ? 0.72 : 1); return [c[0] * k2 + 0.02 * (j === 2 ? 1 : 0), c[1] * k2, c[2] * k2, 0.6, 0.35, 0]; }, { away: [0, 0.5, 0] });
  }
  if (TIER < 1) { p.shade(null).ink(mul(COPPER, 0.8), 0.45, 0.8); zs.forEach((z, ri) => { for (let k = 0; k < nsr; k++) for (const dz of ri === 0 ? [0.13] : ri === nr - 1 ? [-0.14] : [-0.13, 0.13]) { const q = arch(lerp(t0 * 0.75, PI - t0 * 0.75, (k + 0.5) / nsr), 0.062); p.T(q[0], q[1], z + dz).sphere(0.014, 5, 3); } }); }
  for (const sg of [1, -1]) for (const tq of [0.62, 1.05]) { const q = arch(sg > 0 ? tq : PI - tq, -0.13); timber(p, [q[0], q[1], zb + 0.1], [q[0], q[1], zf], 0.07, 0.09, TIMBER, tq * 10 + sg); }
  for (const sg of [1, -1]) for (const z of [zs[1], zs[3]]) { const q = arch(sg > 0 ? 0.55 : PI - 0.55, -0.2); p.push(X(q[0], q[1], z)); lantern(p, 1.3); p.pop(); }
  // a ridge board, and the back wall: upright boards under the arch, a round window
  timber(p, [0, Ht + 0.07, zb], [0, Ht + 0.07, zf + 0.12], 0.1, 0.08, TIMBER_DK, 3);
  const yIn = (x) => Math.max(0, yAt(Math.min(a, (Math.abs(x) * a) / (a - 0.1))) - 0.09), zw = zb + 0.07;
  const nb = Math.round((2 * a - 0.2) / 0.23);
  for (let i = 0; i < nb; i++) {
    const x0 = -a + 0.1 + (i * (2 * a - 0.2)) / nb + 0.006, x1 = -a + 0.1 + ((i + 1) * (2 * a - 0.2)) / nb - 0.006, c = vary(WEATHERED, i * 19 + 7, 0.14);
    p.shade(grainY(0.24)).ink(c, 0.9).T(0, 0, zw).extrude([[x0, 0.02], [x1, 0.02], [x1, yIn(x1)], [(x0 + x1) / 2, yIn((x0 + x1) / 2)], [x0, yIn(x0)]], 0.05);
  }
  p.shade(null).ink(hex(0x24384a), 0.2, 0.3).T(0, 1.55, zw, 90, 0, 0).cyl(0.44, 0.44, 0.07, 24);
  p.ink(TIMBER_DK, 0.85).T(0, 1.55, zw, 90, 0, 0).ring(0.45, 0.06, 28, 7); p.T(0, 1.55, zw).box(0.9, 0.045, 0.09, 0.008); p.T(0, 1.55, zw).box(0.045, 0.9, 0.09, 0.008);
  timber(p, [-a + 0.1, 0.98, zw], [a - 0.1, 0.98, zw], 0.08, 0.12, TIMBER_DK, 5);
  // the front: a header beam, boards in the gable above it, folding doors standing open at both sides
  const yH = 2.12, zd = zf + 0.1;
  timber(p, [-arch(Math.asin(Math.pow(yH / Ht, 1 / 0.9)))[0] - 0.05, yH, zd], [arch(Math.asin(Math.pow(yH / Ht, 1 / 0.9)))[0] + 0.05, yH, zd], 0.14, 0.16, TIMBER_DK, 6);
  const xg = arch(Math.asin(Math.pow((yH + 0.2) / Ht, 1 / 0.9)))[0] - 0.12, ng = Math.round((2 * xg) / 0.24);
  for (let i = 0; i < ng; i++) { const x0 = -xg + (i * 2 * xg) / ng + 0.006, x1 = -xg + ((i + 1) * 2 * xg) / ng - 0.006; p.shade(grainY(0.24)).ink(vary(WEATHERED, i * 29 + 3, 0.14), 0.9).T(0, 0, zd - 0.05).extrude([[x0, yH + 0.05], [x1, yH + 0.05], [x1, Math.max(yH + 0.06, yIn(x1) - 0.02)], [(x0 + x1) / 2, yIn((x0 + x1) / 2) - 0.02], [x0, Math.max(yH + 0.06, yIn(x0) - 0.02)]], 0.045); }
  p.push(X(0, yH - 0.08, zd + 0.02)); lantern(p, 1.7); p.pop();
  for (const sg of [1, -1]) {
    const hx = sg * (a - 0.2), leaf = (m, w, seed) => { p.push(m); for (let i = 0; i < 3; i++) p.shade(grainY(0.24)).ink(vary(TIMBER, seed + i * 7, 0.12), 0.88).T((i + 0.5) * (w / 3), 1.0, 0).box(w / 3 - 0.01, 1.96, 0.05, 0.008); p.shade(null).ink(IRON, 0.5, 0.8); for (const y of [0.3, 1.0, 1.7]) { p.T(w / 2, y, 0.03).box(w - 0.04, 0.06, 0.014, 0.004); p.T(w / 2, y, -0.03).box(w - 0.04, 0.06, 0.014, 0.004); } p.pop(); };
    timber(p, [hx, 0, zd], [hx, yH, zd], 0.14, 0.14, TIMBER_DK, sg + 8);
    leaf(X(hx, 0.04, zd + 0.06, 0, sg > 0 ? -72 : -108, 0), 0.5, 3);
    const e = [hx + Math.cos(sg > 0 ? 72 * DEG : 108 * DEG) * 0.5, zd + 0.06 + Math.sin(72 * DEG) * 0.5];
    leaf(X(e[0], 0.04, e[1], 0, sg > 0 ? 112 : 68, 0), 0.46, 11);
  }
  // inside: a glider on trestles, a bench, casks and a spare screw on the wall
  const gz = (zb + zf) / 2 - 0.25;
  for (const dx of [-0.42, 0.3]) { for (const dz of [-0.5, 0.5]) { timber(p, [dx - 0.16, 0.05, gz + dz], [dx, 0.72, gz + dz], 0.05, 0.05, TIMBER, 3); timber(p, [dx + 0.16, 0.05, gz + dz], [dx, 0.72, gz + dz], 0.05, 0.05, TIMBER, 4); } timber(p, [dx, 0.72, gz - 0.56], [dx, 0.72, gz + 0.56], 0.06, 0.06, TIMBER_DK, 5); }
  const wing = new Pen(), q0 = Q; drawGlider(p.push(X(0.12, 0.79, gz, 0, 0, 0, 1.25)), wing, 'kingdom', false); p.pop(); Q = q0;
  p.T(0.12, 0.79, gz, 0, 0, 0, 1.25).geo(wing.toGeometry(), mul(CREAM, 0.95));
  const bx = -a + 0.5;
  timber(p, [bx, 0.62, zb + 0.35], [bx, 0.62, zb + 1.6], 0.42, 0.05, PINE, 2, 0.006);
  for (const z of [zb + 0.42, zb + 1.53]) for (const dx of [-0.17, 0.17]) timber(p, [bx + dx, 0.04, z], [bx + dx, 0.6, z], 0.05, 0.05, TIMBER, 6);
  p.shade(null).ink(IRON, 0.5, 0.8).T(bx, 0.69, zb + 0.6).box(0.12, 0.09, 0.14, 0.01); p.ink(OAK, 0.8).T(bx + 0.05, 0.67, zb + 1.2, 0, 30, 0).box(0.06, 0.05, 0.3, 0.01);
  p.push(X(a - 0.55, 0.04, zb + 0.45)); barrel(p, 0.2, 0.52, 3); p.pop(); p.push(X(a - 0.52, 0.04, zb + 0.95)); barrel(p, 0.18, 0.48, 5); p.pop();
  p.push(X(a - 0.5, 0.05, zb + 1.5)); coil(p, 0.16, 4, 0.022); p.pop();
  p.push(X(1.25, 1.3, zb + 0.24, 0, 90, 0, 0.8)); drawProp(p, styleOf({ style: 'kingdom' }), false); p.pop();
  for (const [x, z, w, s2] of [[-a + 0.55, zf - 0.5, 0.42, 3], [-a + 0.5, zf - 1.0, 0.36, 5], [a - 0.6, zf - 0.45, 0.4, 7]]) { p.shade(grainX(0.24)).ink(vary(PINE, s2, 0.12), 0.88).T(x, 0.05 + w * 0.4, z, 0, s2 * 9, 0).box(w, w * 0.8, w, 0.012); p.shade(null).ink(TIMBER_DK, 0.9); for (const sy of [-1, 1]) for (const sz of [-1, 1]) p.T(x, 0.05 + w * 0.4 + sy * w * 0.33, z, 0, s2 * 9, 0).box(w + 0.02, 0.05, w + 0.02, 0.006); void 0; }
  // the pennant over the doors
  pennantPole(p, fp, [0, Ht + 0.05, zf + 0.1], [0, Ht + 0.95, zf + 0.16], 0.85, 0.3);
}

// ---------- the workshop: a forge under a shingled roof ----------
function buildWorkshop(p, fp) {
  const hp = 1.2, yE = 1.78, yR = 2.78, ov = 1.46;
  // flagged floor
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) { const w = 2.8 / 7, o = (j % 2) * 0.12; p.shade(mottle(0.25, 9)).ink(vary(FLAG, i * 7 + j * 31, 0.13), 0.95).T(clamp(-1.4 + (i + 0.5) * w + o, -1.4 + w / 2, 1.4 - w / 2), 0.025, -1.4 + (j + 0.5) * w).box(w - 0.02, 0.05, w - 0.02, 0.012); }
  // frame: posts on pads, plates, braces, tie beams, king posts, ridge and rafters
  const posts = [[hp, hp], [-hp, hp], [-hp, -hp], [hp, -hp], [0, -hp]];
  posts.forEach(([x, z], i) => { p.shade(mottle(0.2, 9)).ink(hex(0x8a857a), 0.95).T(x, 0.1, z).box(0.3, 0.12, 0.3, 0.02); timber(p, [x, 0.16, z], [x, yE, z], 0.16, 0.16, TIMBER_DK, i); });
  for (const z of [hp, -hp]) { timber(p, [-ov + 0.05, yE + 0.06, z], [ov - 0.05, yE + 0.06, z], 0.15, 0.14, TIMBER_DK, z + 7); for (const sx of [1, -1]) timber(p, [sx * hp, yE - 0.55, z], [sx * (hp - 0.5), yE, z], 0.08, 0.1, TIMBER, sx + 9); }
  for (const x of [hp, -hp]) {
    timber(p, [x, yE + 0.06, -hp], [x, yE + 0.06, hp], 0.13, 0.14, TIMBER_DK, x + 11);
    timber(p, [x, yE + 0.12, 0], [x, yR - 0.05, 0], 0.11, 0.11, TIMBER_DK, x + 12);
    for (const sz of [1, -1]) { timber(p, [x, yE - 0.5, sz * hp], [x, yE, sz * (hp - 0.45)], 0.08, 0.1, TIMBER, sz + 13); timber(p, [x, yE + 0.14, sz * 0.75], [x, yR - 0.4, 0], 0.07, 0.08, TIMBER, sz + 15); }
  }
  timber(p, [-ov, yR, 0], [ov, yR, 0], 0.11, 0.13, TIMBER_DK, 17);
  for (let i = 0; i < 7; i++) { const x = lerp(-ov + 0.06, ov - 0.06, i / 6); for (const sz of [1, -1]) timber(p, [x, yR + 0.02, 0], [x, yE + 0.02 - 0.2, sz * (ov + 0.02)], 0.06, 0.08, TIMBER, i + sz * 3 + 20); }
  // the roof: two slopes of shingles, a ridge roll
  const sl = Math.hypot(ov + 0.06, yR - yE + 0.26) + 0.02, uy = [0, (yR - yE + 0.26) / sl, -(ov + 0.06) / sl];
  shingles(p, [-ov - 0.04, yE - 0.2 + 0.14, ov + 0.06], [1, 0, 0], uy, 2 * ov + 0.08, sl, hex(0x7a4a34), 3);
  shingles(p, [ov + 0.04, yE - 0.2 + 0.14, -ov - 0.06], [-1, 0, 0], [0, uy[1], -uy[2]], 2 * ov + 0.08, sl, hex(0x7a4a34), 41);
  p.shade(mottle(0.2, 12)).ink(hex(0x5a3626), 0.9).T(0, yR + 0.2, 0, 0, 0, 90).cyl(0.065, 0.065, 2 * ov + 0.1, 10);
  // back wall: half-timber and plaster with a shuttered window; a boarded half wall on the left
  for (const [x0, x1] of [[-hp + 0.08, -0.08], [0.08, hp - 0.08]]) {
    p.shade(mottle(0.14, 8)).ink(PLASTER, 0.95).T((x0 + x1) / 2, (0.16 + yE) / 2, -hp).box(x1 - x0, yE - 0.16, 0.08, 0.004);
    timber(p, [x0, 0.95, -hp], [x1, 0.95, -hp], 0.09, 0.13, TIMBER_DK, x0 + 30);
    timber(p, [x0 + 0.02, 0.2, -hp], [x1 - 0.02, 0.9, -hp], 0.07, 0.125, TIMBER, x0 + 31);
    timber(p, [x0, 0.19, -hp], [x1, 0.19, -hp], 0.09, 0.13, TIMBER_DK, x0 + 32);
  }
  p.shade(null).ink(hex(0x22303c), 0.3, 0.2).T(-0.62, 1.36, -hp + 0.045).box(0.46, 0.5, 0.02, 0);
  for (const dx of [-0.25, 0, 0.25]) timber(p, [-0.62 + dx, 1.1, -hp + 0.06], [-0.62 + dx, 1.62, -hp + 0.06], 0.045, 0.04, TIMBER_DK, dx + 33);
  timber(p, [-0.9, 1.09, -hp + 0.06], [-0.34, 1.09, -hp + 0.06], 0.06, 0.06, TIMBER_DK, 34); timber(p, [-0.9, 1.63, -hp + 0.06], [-0.34, 1.63, -hp + 0.06], 0.05, 0.05, TIMBER_DK, 35);
  for (let i = 0; i < 9; i++) p.shade(grainY(0.24)).ink(vary(WEATHERED, i * 13 + 2, 0.13), 0.9).T(-hp, 0.55, -hp + 0.16 + (i + 0.5) * ((2 * hp - 0.32) / 9)).box(0.05, 0.85, (2 * hp - 0.32) / 9 - 0.012, 0.008);
  timber(p, [-hp, 1.0, -hp + 0.1], [-hp, 1.0, hp - 0.1], 0.1, 0.07, TIMBER_DK, 36);
  // the forge: a stone hearth with an arched mouth full of fire, a hood and a stack through the roof
  const fx = 0.62, fz = -0.72, fw = 0.98, fd = 0.8, fh = 0.78;
  const faces = [[[fx - fw / 2, 0.05, fz + fd / 2], [1, 0, 0], fw, [0, 0, 1]], [[fx + fw / 2, 0.05, fz + fd / 2], [0, 0, -1], fd, [1, 0, 0]], [[fx - fw / 2, 0.05, fz - fd / 2], [0, 0, 1], fd, [-1, 0, 0]]];
  faces.forEach(([o, ux, la, n], i) => stoneWall(p, o, ux, la, fh, n, { len: 0.3, course: 0.195, seed: i * 9 + 50, col: hex(0x8f8a80) }));
  p.shade(mottle(0.2, 9)).ink(hex(0x9a958a), 0.95).T(fx, 0.05 + fh + 0.03, fz).box(fw + 0.08, 0.07, fd + 0.08, 0.015);
  p.shade(null).ink(hex(0x0a0706), 1).T(fx, 0.05 + fh + 0.068, fz + 0.02).box(fw - 0.24, 0.006, fd - 0.26, 0);
  p.ink(hex(0x070505), 1).T(fx, 0.42, fz + fd / 2 + 0.006).box(0.44, 0.4, 0.012, 0);
  p.ink(EMBER, 0.7, 0, 1.7).T(fx, 0.3, fz + fd / 2 + 0.012).box(0.36, 0.14, 0.012, 0);
  p.ink(hex(0xffa040), 0.7, 0, 1.8); for (let i = 0; i < 9; i++) p.T(fx - 0.26 + (i % 5) * 0.13 + (i > 4 ? 0.06 : 0), 0.05 + fh + 0.09, fz - 0.08 + (i > 4 ? 0.16 : 0)).sphere(0.055 + 0.02 * hash1(i), 7, 5);
  p.ink(EMBER, 0.7, 0, 1.4); for (let i = 0; i < 6; i++) p.T(fx - 0.2 + i * 0.085, 0.05 + fh + 0.1, fz + 0.2 - (i % 2) * 0.1).sphere(0.05, 7, 5);
  // the hood, of riveted iron, drawing up into a stone stack
  p.shade(mottle(0.25, 8)).ink(hex(0x3a3836), 0.55, 0.7);
  const hb = 0.05 + fh + 0.55, ht = 1.75, sw = 0.25;
  p.grid(4, 1, (i, j, out) => { const cnr = [[1, 1], [-1, 1], [-1, -1], [1, -1], [1, 1]][i], w = j ? sw : fw / 2 + 0.02, d = j ? sw : fd / 2 + 0.02; out[0] = fx + cnr[0] * w; out[1] = j ? ht : hb; out[2] = fz - (j ? 0.12 : 0) + cnr[1] * d; });
  const sx0 = fx - sw - 0.03, sz0 = fz - 0.12, sH = 3.42 - ht;
  [[[sx0, ht, sz0 + sw + 0.03], [1, 0, 0], [0, 0, 1]], [[sx0 + 2 * sw + 0.06, ht, sz0 + sw + 0.03], [0, 0, -1], [1, 0, 0]], [[sx0 + 2 * sw + 0.06, ht, sz0 - sw - 0.03], [-1, 0, 0], [0, 0, -1]], [[sx0, ht, sz0 - sw - 0.03], [0, 0, 1], [-1, 0, 0]]].forEach(([o, ux, n], i) => stoneWall(p, o, ux, 2 * sw + 0.06, sH, n, { len: 0.28, course: 0.19, seed: i * 7 + 80, col: hex(0x8f8a80) }));
  p.shade(mottle(0.2, 9)).ink(hex(0x9a958a), 0.95).T(fx, 3.45, sz0).box(2 * sw + 0.2, 0.08, 2 * sw + 0.2, 0.015);
  p.shade(null).ink(hex(0x050404), 1).T(fx, 3.492, sz0).box(2 * sw - 0.1, 0.004, 2 * sw - 0.1, 0); p.ink(EMBER, 0.8, 0, 0.9).T(fx, 3.47, sz0).box(0.2, 0.004, 0.2, 0);
  // bellows beside the hearth
  p.push(X(fx - fw / 2 - 0.32, 0.5, fz + 0.1, 0, 0, 0));
  p.shade(grainX(0.2)).ink(OAK, 0.8).T(0, 0.09, 0, 0, 0, 8).box(0.5, 0.03, 0.3, 0.01); p.T(0, -0.09, 0, 0, 0, -8).box(0.5, 0.03, 0.3, 0.01);
  p.shade(null).ink(hex(0x5a3a26), 0.9).grid(6, 4, (i, j, out) => { const t = i / 6, a = (j / 4) * TAU, w = 0.22 - 0.2 * t; out[0] = -0.22 + t * 0.46; out[1] = Math.cos(a) * (0.085 - 0.07 * t) * (1 + 0.15 * (i % 2)); out[2] = Math.sin(a) * w * 0.62 * (1 + 0.1 * (i % 2)); }, null, { wrapV: true });
  p.ink(IRON, 0.5, 0.8).bar([0.22, 0, 0], [0.4, -0.04, 0.02], 0.022, 0.014, 6);
  for (const dz of [-0.1, 0.1]) timber(p, [-0.05, -0.45, dz], [-0.05, -0.1, dz], 0.05, 0.05, TIMBER, 3);
  p.pop();
  // the anvil on its block, a hammer lying on it; a quench tub
  const ax = 0.15, az = 0.35;
  p.shade(grainY(0.3)).ink(vary(TIMBER_DK, 3, 0.1), 0.9).T(ax, 0.05 + 0.2, az).cyl(0.2, 0.23, 0.4, 14);
  p.shade(null).ink(IRON, 0.5, 0.8).T(ax, 0.38, az).ring(0.215, 0.014, 18, 4);
  p.push(X(ax, 0.45, az)); p.shade(mottle(0.2, 16)).ink(hex(0x3c3d42), 0.38, 0.85).extrude(rounded([[-0.16, 0], [0.16, 0], [0.13, 0.05], [0.07, 0.08], [0.07, 0.15], [0.2, 0.17], [0.36, 0.22], [0.2, 0.25], [-0.2, 0.25], [-0.2, 0.18], [-0.07, 0.15], [-0.07, 0.08], [-0.13, 0.05]], 2), 0.15, true); p.pop();
  p.shade(grainX(0.2)).ink(OAK, 0.8).T(ax - 0.02, 0.725, az + 0.02, 0, 35, 0).box(0.3, 0.025, 0.03, 0.008); p.shade(null).ink(IRON, 0.45, 0.85).T(ax + 0.1, 0.735, az - 0.065, 0, 35, 0).box(0.06, 0.055, 0.12, 0.012);
  p.push(X(ax + 0.52, 0.05, az + 0.22)); barrel(p, 0.17, 0.34, 9); p.shade(null).ink(hex(0x1c2c34), 0.15, 0.2).T(0, 0.3, 0).cyl(0.14, 0.14, 0.01, 14); p.pop();
  // the grindstone in its frame, with crank and trough
  const gx = -0.62, gzz = 0.55;
  for (const dz of [-0.14, 0.14]) { timber(p, [gx - 0.26, 0.05, gzz + dz], [gx - 0.04, 0.6, gzz + dz], 0.05, 0.05, TIMBER, 5); timber(p, [gx + 0.26, 0.05, gzz + dz], [gx + 0.04, 0.6, gzz + dz], 0.05, 0.05, TIMBER, 6); timber(p, [gx - 0.2, 0.2, gzz + dz], [gx + 0.2, 0.2, gzz + dz], 0.04, 0.05, TIMBER, 7); }
  p.push(X(gx, 0.6, gzz, 90, 0, 0)); p.shade(mottle(0.25, 12)).ink(hex(0xb0a898), 0.95).lathe([[0, -0.05], [0.05, -0.05], [0.27, -0.045], [0.285, -0.03], [0.285, 0.03], [0.27, 0.045], [0.05, 0.05], [0, 0.05]], 26); p.shade(null).ink(IRON, 0.5, 0.8).cyl(0.022, 0.022, 0.42, 8); p.pop();
  p.ink(IRON, 0.5, 0.8).tube([[gx, 0.6, gzz + 0.2], [gx, 0.6, gzz + 0.26], [gx + 0.02, 0.5, gzz + 0.26], [gx + 0.02, 0.5, gzz + 0.34]], 0.012, 5, 1);
  p.shade(grainX(0.2)).ink(OAK, 0.8).T(gx, 0.27, gzz).box(0.5, 0.1, 0.16, 0.012); p.shade(null).ink(hex(0x1c2c34), 0.15, 0.2).T(gx, 0.321, gzz).box(0.44, 0.004, 0.1, 0);
  // a bench along the left wall with a vice and a saw
  timber(p, [-hp + 0.3, 0.72, -hp + 0.25], [-hp + 0.3, 0.72, -0.1], 0.4, 0.06, PINE, 2, 0.006);
  for (const z of [-hp + 0.32, -0.17]) for (const dx of [-0.15, 0.15]) timber(p, [-hp + 0.3 + dx, 0.05, z], [-hp + 0.3 + dx, 0.7, z], 0.06, 0.06, TIMBER, 8);
  p.shade(null).ink(IRON, 0.5, 0.8).T(-hp + 0.42, 0.8, -0.3).box(0.1, 0.1, 0.14, 0.012); p.bar([-hp + 0.42, 0.8, -0.22], [-hp + 0.42, 0.8, -0.1], 0.01, 0.01, 5);
  p.ink(STEEL, 0.35, 0.85).T(-hp + 0.26, 0.757, -0.75, 0, 12, 0).box(0.09, 0.006, 0.42, 0); p.shade(null).ink(OAK, 0.8).T(-hp + 0.3, 0.765, -0.5, 0, 12, 0).box(0.1, 0.03, 0.1, 0.01);
  // outside, in front: boards stacked on stickers, and casks at the corner
  for (let l = 0; l < 4; l++) { for (let i = 0; i < 4; i++) p.shade(grainX(0.24)).ink(vary(PINE, l * 9 + i * 3, 0.13), 0.88).T(-0.72 + (hash2(l, i) - 0.5) * 0.06, 0.09 + l * 0.075, 1.02 + i * 0.105).box(1.25, 0.04, 0.095, 0.006); if (l < 3) for (const dx of [-0.45, 0.1, 0.5]) p.shade(null).ink(TIMBER_DK, 0.9).T(-0.72 + dx, 0.127 + l * 0.075, 1.18).box(0.04, 0.03, 0.44, 0.004); }
  p.push(X(1.05, 0.05, 1.22)); barrel(p, 0.19, 0.5, 2); p.pop(); p.push(X(0.62, 0.05, 1.28)); barrel(p, 0.17, 0.46, 6); p.pop();
  p.push(X(0.9, 0.05 + 0.17, 0.86, 90, 0, 35)); barrel(p, 0.17, 0.44, 8); p.pop();
  p.push(X(hp + 0.02, 1.25, 0.6, 0, 90, 0)); lantern(p, 1.5); p.pop(); p.shade(null).ink(IRON, 0.5, 0.8).bar([hp, 1.3, hp - 0.05], [hp + 0.02, 1.26, 0.6], 0.01, 0.01, 5);
  for (const [x, z] of [[-0.2, 0.9], [0.9, 0.1], [-0.9, -0.3]]) { p.push(X(x, 0.05, z)); p.shade(grainY(0.2)).ink(vary(OAK, x * 9, 0.1), 0.85).lathe([[0, 0], [0.1, 0], [0.12, 0.22], [0.11, 0.22], [0.095, 0.02], [0, 0.02]], 14); p.shade(null).ink(IRON, 0.5, 0.8).T(0, 0.08, 0).ring(0.108, 0.008, 14, 4); p.T(0, 0.19, 0).ring(0.119, 0.008, 14, 4); p.tube([[0.11, 0.2, 0], [0.06, 0.34, 0], [-0.06, 0.34, 0], [-0.11, 0.2, 0]], 0.007, 5); p.pop(); }
  // tools on a rack on the back wall, a cart wheel against the side, a heap of coal by the hearth
  timber(p, [-0.28, 1.52, -hp + 0.07], [0.02, 1.52, -hp + 0.07], 0.05, 0.035, TIMBER_DK, 41);
  for (let i = 0; i < 3; i++) { const x = -0.24 + i * 0.11; p.shade(grainY(0.2)).ink(OAK, 0.8).T(x, 1.3, -hp + 0.09).box(0.022, 0.4, 0.022, 0.005); p.shade(null).ink(IRON, 0.45, 0.85).T(x, 1.12 - (i % 2) * 0.03, -hp + 0.09).box(i === 1 ? 0.03 : 0.085, i === 1 ? 0.12 : 0.05, 0.04, 0.008); }
  p.push(X(-hp - 0.1, 0.42, 0.55, 0, 0, 78)); p.shade(grainX(0.2)).ink(OAK, 0.8).ring(0.36, 0.035, 26, 7); p.T(0, 0, 0).cyl(0.07, 0.07, 0.1, 10); for (let i = 0; i < 8; i++) p.bar([0, 0, 0], [Math.cos(i * 0.785) * 0.35, 0, Math.sin(i * 0.785) * 0.35], 0.02, 0.016, 5, 0); p.shade(null).ink(IRON, 0.5, 0.8).ring(0.385, 0.012, 26, 4); p.pop();
  for (let i = 0; i < 7; i++) { p.push(X(fx + 0.72 + (hash1(i) - 0.5) * 0.3, 0.07 + 0.05 * (i % 3), fz + 0.55 + (hash1(i + 9) - 0.5) * 0.3)); boulder(p, 0.07 + 0.03 * hash1(i * 3), i + 20, hex(0x1c1a1c)); p.pop(); }
  pennantPole(p, fp, [ov - 0.12, yR + 0.1, 0], [ov - 0.05, yR + 0.95, 0], 0.75, 0.28);
}

const structCache = new Map();
const SIDE_HEX = [0x3d7bd9, 0xd9463d], NEUTRAL = 0xcdbf9a;
/** build once (per size and detail), hand out a group of two meshes sharing the geometry: the building, and its pennant in the side colour */
function structure(key, turn, place, make) {
  const k = `${key}|${getDetail()}`;
  if (!structCache.has(k)) {
    const p = new Pen(), fp = new Pen(), d = getDetail();
    Q = d === 'low' ? 0.6 : d === 'medium' ? 0.8 : 1; TIER = 0;
    try { make(p, fp); } finally { Q = 1; TIER = 0; }
    structCache.set(k, { geo: p.toGeometry(), side: fp.n ? fp.toGeometry() : null, turned: null, sideTurned: null });
  }
  const c = structCache.get(k);
  if (turn && !c.turned) { c.turned = c.geo.clone().rotateY(PI / 2); c.sideTurned = c.side ? c.side.clone().rotateY(PI / 2) : null; }
  const g = new THREE.Group(), m = new THREE.Mesh(turn ? c.turned : c.geo, sculptMaterial());
  m.castShadow = true; m.receiveShadow = true; g.add(m);
  const sg = turn ? c.sideTurned : c.side;
  if (sg) { const sm = new THREE.Mesh(sg, sideMaterial(place && SIDE_HEX[place.side] !== undefined ? SIDE_HEX[place.side] : NEUTRAL)); sm.castShadow = true; sm.receiveShadow = true; sm.name = 'colours'; g.add(sm); }
  return g;
}

/**
 * structures[def.model](def, w, h, place) -> Object3D centred on its footprint, resting on y = 0.
 * place = { x, y, side } or null; side 0 / 1 flies the pennant (or windsock) in that side's colour.
 */
export const structures = {
  /** a timber pier, 6 x 2 (or 2 x 6): its plank walk is flat, clear and exactly at y = 0.8 */
  dock: (def, w, h, place) => { const L = Math.max(w, h), D = Math.min(w, h); return structure(`dock|${L}|${D}`, h > w, place, (p, fp) => buildDock(p, fp, L, D)); },
  /** a mooring mast for airships, 3 x 3: stone base, lattice tower with a spiral stair, platform, mooring arm (toward +X), windsock */
  zeppelinTower: (def, w, h, place) => structure('zeppelinTower', false, place, (p, fp) => buildTower(p, fp)),
  /** an arched airship shed, 5 x 4 (or 4 x 5): the doors stand open on the +Z long side (+X when turned) */
  hangar: (def, w, h, place) => { const L = Math.max(w, h), D = Math.min(w, h); return structure(`hangar|${L}|${D}`, h > w, place, (p, fp) => buildHangar(p, fp, L, D)); },
  /** a repair workshop and forge, 3 x 3, open to the front (+Z) */
  workshop: (def, w, h, place) => structure('workshop', false, place, (p, fp) => buildWorkshop(p, fp)),
};
