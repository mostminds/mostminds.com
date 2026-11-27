// Sailing ships, from a lashed-log raft to a ship of the line.
//
// ship(def, sideColorHex) -> THREE.Object3D: bow toward +X, centred on the origin, waterline at
// y = 0, hull def.len long and def.beam wide. Everything is derived from the numbers in the class
// (length, beam, masts, guns per broadside, colours), so imported classes work too; the eight
// stock classes add character on top (see styleFor below).
//
// A ship is constructed the way a shipwright would: a hull lofted from cross-section stations
// and skinned strake by strake (each plank its own strip, with butts, seams, wales and real gun
// ports cut through the planking), decks laid plank by plank inside the bulwarks, then the stern,
// the head, deck furniture, guns, spars, sails and rigging. It all bakes into one geometry with
// vertex colour and per-vertex roughness / metalness for the shared sculpt shader, plus one small
// geometry for everything in the side colour (ensign, pennant, vanes and the device painted on
// the sails): two draw calls per ship.
//
// Each class is built at up to three tiers (see TIERS), the lighter ones only when a ship is first
// seen from far enough away; the returned group carries userData.lod so rigkit.setLod can swap
// them, and userData.setSide(hex) to change her colours when she is taken.
import * as THREE from 'three';
import { S, H as HP, rgb, noise3, fbm3, buildPartGeometry, sculptMaterial } from '../sculpt.js';
import { getDetail, setLod } from '../rigkit.js';
import { fleetKind, buildFleet, FLEET_DEVICES } from './fleets.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = (c) => (Array.isArray(c) ? c : rgb(c));
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** deterministic 0..1 from integers */
function hash1(n) { let h = Math.imul((n | 0) ^ 0x9e3779b9, 374761393); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const hash2 = (a, b) => hash1(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
/** a colour nudged in brightness and warmth by a seed, so no two planks are quite alike */
function vary(c, seed, amt = 0.1) { const k = 1 + (hash1(seed) - 0.5) * 2 * amt, w = (hash1(seed + 77) - 0.5) * amt * 0.6; return [c[0] * k * (1 + w), c[1] * k, c[2] * k * (1 - w)]; }

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _pm = new THREE.Matrix4(), _nm = new THREE.Matrix3();
/** a placement: translate, rotate (DEGREES, three's XYZ order), scale */
function X(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx * DEG, ry * DEG, rz * DEG, 'XYZ')), _s.set(sx, sy, sz));
}
/** a placement from an origin and two axes: local X -> ax, local Y -> ay (made square to ax), local Z -> ax x ay */
function frame(o, ax, ay) {
  const x = norm3(ax), z = norm3(cross(x, ay)), y = cross(z, x);
  return new THREE.Matrix4().set(x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2], 0, 0, 0, 1);
}
/** a placement whose local +Y runs from a toward b */
function aim(a, b) {
  const y = norm3(sub3(b, a));
  const ref = Math.abs(y[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const x = norm3(cross(ref, y)), z = cross(x, y);
  return new THREE.Matrix4().set(x[0], y[0], z[0], a[0], x[1], y[1], z[1], a[1], x[2], y[2], z[2], a[2], 0, 0, 0, 1);
}

// ---------- the pen: draws shapes straight into one growing vertex buffer ----------
class Pen {
  constructor() {
    this.P = []; this.N = []; this.C = []; this.M = []; this.I = []; this.n = 0;
    this.base = new THREE.Matrix4(); this.stack = []; this.loc = null;
    this.col = [0.6, 0.6, 0.6]; this.ro = 0.8; this.me = 0; this.gl = 0; this.fn = null;
    this.e = null; this.k = null; this.flip = false;
    this.q = 1;   // mesh quality: below 1 the round shapes get fewer sides and small boxes lose their rounded edges (the distant builds)
  }
  /** colour (linear rgb), roughness, metalness, glow for what follows */
  ink(c, ro = 0.85, me = 0, gl = 0) { this.col = c; this.ro = ro; this.me = me; this.gl = gl; return this; }
  /** per-vertex colour in ship space: fn(x, y, z, nx, ny, nz, colour) -> colour | null */
  shade(fn) { this.fn = fn || null; return this; }
  push(m) { this.stack.push(this.base.clone()); this.base.multiply(m); return this; }
  pop() { this.base.copy(this.stack.pop()); return this; }
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
  v(x, y, z, nx, ny, nz, c) {
    const e = this.e, k = this.k;
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    let ax = k[0] * nx + k[3] * ny + k[6] * nz, ay = k[1] * nx + k[4] * ny + k[7] * nz, az = k[2] * nx + k[5] * ny + k[8] * nz;
    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    let col = c || this.col;
    if (this.fn) { const r = this.fn(wx, wy, wz, ax, ay, az, col); if (r) col = r; }
    this.P.push(wx, wy, wz); this.N.push(ax, ay, az); this.C.push(col[0], col[1], col[2]); this.M.push(this.ro, this.me, this.gl);
    return this.n++;
  }
  tri(a, b, c) { if (this.flip) this.I.push(a, c, b); else this.I.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  /** (nu+1) x (nv+1) lattice: f(i, j, out) writes a position; normals come from the lattice, so it shades smoothly */
  grid(nu, nv, f, colFn = null, flip = false) {
    this.begin();
    const W = nu + 1, R = nv + 1, pos = new Float64Array(W * R * 3), o = [0, 0, 0];
    for (let j = 0; j < R; j++) for (let i = 0; i < W; i++) { f(i, j, o); const q = (j * W + i) * 3; pos[q] = o[0]; pos[q + 1] = o[1]; pos[q + 2] = o[2]; }
    const start = this.n, sg = flip ? -1 : 1;
    const diff = (a, b, out) => { out[0] = pos[b * 3] - pos[a * 3]; out[1] = pos[b * 3 + 1] - pos[a * 3 + 1]; out[2] = pos[b * 3 + 2] - pos[a * 3 + 2]; return out[0] * out[0] + out[1] * out[1] + out[2] * out[2]; };
    const du = [0, 0, 0], dv = [0, 0, 0];
    for (let j = 0; j < R; j++) for (let i = 0; i < W; i++) {
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, nu), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, nv);
      if (diff(j * W + i0, j * W + i1, du) < 1e-14) { const jj = j > 0 ? j - 1 : Math.min(j + 1, nv); diff(jj * W + i0, jj * W + i1, du); }
      if (diff(j0 * W + i, j1 * W + i, dv) < 1e-14) { const ii = i > 0 ? i - 1 : Math.min(i + 1, nu); diff(j0 * W + ii, j1 * W + ii, dv); }
      const q = (j * W + i) * 3;
      this.v(pos[q], pos[q + 1], pos[q + 2], sg * (du[1] * dv[2] - du[2] * dv[1]), sg * (du[2] * dv[0] - du[0] * dv[2]), sg * (du[0] * dv[1] - du[1] * dv[0]), colFn ? colFn(i, j) : null);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = start + j * W + i, b = a + 1, c = a + W + 1, d = a + W;
      if (flip) this.quad(a, d, c, b); else this.quad(a, b, c, d);
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
  /** box of full size w, h, d centred on the origin; ch > 0 rounds the edges (44 triangles) */
  box(w, h, d, ch = 0) {
    this.begin();
    if (this.q < 1 && (this.q < 0.6 || Math.max(w, h, d) < 0.3)) ch = 0;
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
      // id[a*2 + (sg>0)] = corners ordered (u,v) = (-,-) (+,-) (+,+) (-,+) over axes a1, a2; edges and corners reuse them, so they shade as rounds
      const vtx = (a, sg, u, v) => id[a * 2 + (sg > 0 ? 1 : 0)][v < 0 ? (u < 0 ? 0 : 1) : (u < 0 ? 3 : 2)];
      for (let a = 0; a < 3; a++) {
        const a1 = (a + 1) % 3, a2 = (a + 2) % 3;
        for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
          // edge along axis a, between the face on a1 (sign s1) and the face on a2 (sign s2)
          const p0 = vtx(a1, s1, s2, -1), p1 = vtx(a1, s1, s2, 1);   // on face a1: its axes are (a2, a)
          const q0 = vtx(a2, s2, -1, s1), q1 = vtx(a2, s2, 1, s1);   // on face a2: its axes are (a, a1)
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
  /** surface of revolution about Y from a profile [[r, y], ...]; repeat a point to make a crease */
  lathe(prof, seg = 16, arc = TAU, a0 = 0) {
    this.begin();
    if (this.q < 1 && seg > 5) seg = Math.max(this.q < 0.6 ? 4 : 5, Math.round(seg * this.q));
    const n = prof.length, nr = [];
    const segN = (i) => { const dr = prof[i + 1][0] - prof[i][0], dy = prof[i + 1][1] - prof[i][1], l = Math.hypot(dr, dy); return l < 1e-9 ? null : [dy / l, -dr / l]; };
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? segN(i - 1) : null, b = i < n - 1 ? segN(i) : null;
      if (a && b) { const l = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1; nr.push([(a[0] + b[0]) / l, (a[1] + b[1]) / l]); } else nr.push(a || b || [1, 0]);
    }
    const s = this.n, W = seg + 1;
    for (let i = 0; i < n; i++) for (let j = 0; j <= seg; j++) {
      const a = a0 + (arc * j) / seg, c = Math.cos(a), sn = Math.sin(a);
      this.v(prof[i][0] * c, prof[i][1], prof[i][0] * sn, nr[i][0] * c, nr[i][1], nr[i][0] * sn);
    }
    for (let i = 0; i < n - 1; i++) {
      if (Math.hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]) < 1e-9) continue;
      for (let j = 0; j < seg; j++) { const a = s + i * W + j; this.quad(a, a + W, a + W + 1, a + 1); }
    }
    return this;
  }
  /** cylinder along Y, centred; caps: 1 = top, 2 = bottom, 3 = both */
  cyl(rt, rb, h, seg = 12, caps = 3) {
    const pr = [];
    if (caps & 2) pr.push([0, -h / 2], [rb, -h / 2]);
    pr.push([rb, -h / 2], [rt, h / 2]);
    if (caps & 1) pr.push([rt, h / 2], [0, h / 2]);
    return this.lathe(pr, seg);
  }
  /** round bar between two points */
  bar(a, b, ra, rb = ra, seg = 8, caps = 3) {
    const len = dist3(a, b);
    if (len < 1e-6) return this;
    const m = aim(a, b);
    this.loc = this.loc ? this.loc.multiply(m) : m;
    const pr = [];
    if (caps & 2) pr.push([0, 0], [ra, 0]);
    pr.push([ra, 0], [rb, len]);
    if (caps & 1) pr.push([rb, len], [0, len]);
    return this.lathe(pr, seg);
  }
  /** tube through points; r = number or one radius per point */
  tube(pts, r, radial = 6, caps = 0) {
    this.begin();
    if (this.q < 1 && radial > 3) radial = Math.max(3, Math.round(radial * this.q));
    const n = pts.length, s = this.n, W = radial + 1;
    let nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const t = norm3(sub3(b, a));
      if (i === 0) { const ref = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]; [nx, ny, nz] = norm3(cross(t, ref)); } else {
        // carry the frame along: drop the component along the new tangent
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
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) { const a = s + i * W + j; this.quad(a, a + 1, a + W + 1, a + W); }
    if (caps) for (const end of [0, n - 1]) {
      const t = norm3(sub3(pts[end === 0 ? 0 : n - 1], pts[end === 0 ? 1 : n - 2]));
      const c = this.v(pts[end][0], pts[end][1], pts[end][2], t[0], t[1], t[2]);
      const ring = [];
      for (let j = 0; j <= radial; j++) { const q = (s + end * W + j) * 3; ring.push(this.vraw(this.P[q], this.P[q + 1], this.P[q + 2], t)); }
      for (let j = 0; j < radial; j++) { if (end === 0) this.tri(c, ring[j + 1], ring[j]); else this.tri(c, ring[j], ring[j + 1]); }
    }
    return this;
  }
  /** a vertex already in ship space (normal given in local space) */
  vraw(wx, wy, wz, nl) {
    const k = this.k;
    let ax = k[0] * nl[0] + k[3] * nl[1] + k[6] * nl[2], ay = k[1] * nl[0] + k[4] * nl[1] + k[7] * nl[2], az = k[2] * nl[0] + k[5] * nl[1] + k[8] * nl[2];
    const l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    const col = this.col;
    this.P.push(wx, wy, wz); this.N.push(ax, ay, az); this.C.push(col[0], col[1], col[2]); this.M.push(this.ro, this.me, this.gl);
    return this.n++;
  }
  sphere(r, ws = 10, hs = 7) {
    if (this.q < 1) { ws = Math.max(5, Math.round(ws * this.q)); hs = Math.max(3, Math.round(hs * this.q)); }
    const pr = [];
    for (let i = 0; i <= hs; i++) { const a = -Math.PI / 2 + (Math.PI * i) / hs; pr.push([Math.cos(a) * r, Math.sin(a) * r]); }
    pr[0][0] = 0; pr[hs][0] = 0;
    return this.lathe(pr, ws);
  }
  /** outline [[x, y], ...] in the local XY plane, extruded along Z (centred), flat caps and flat sides */
  extrude(outline, depth, smoothSides = false) {
    this.begin();
    let area = 0;
    for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const pts = area < 0 ? outline.slice().reverse() : outline;
    const tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), []);
    const n = pts.length, hz = depth / 2;
    for (const sg of [1, -1]) {
      const s = this.n;
      for (const q of pts) this.v(q[0], q[1], sg * hz, 0, 0, sg);
      for (const t of tris) {
        const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
        const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
        if (ccw === sg > 0) this.tri(s + t[0], s + t[1], s + t[2]); else this.tri(s + t[0], s + t[2], s + t[1]);
      }
    }
    const en = (i) => { const a = pts[i], b = pts[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; };
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      let na = en(i), nb = na;
      if (smoothSides) { const p0 = en((i + n - 1) % n), p1 = en((i + 1) % n); na = [na[0] + p0[0], na[1] + p0[1]]; nb = [nb[0] + p1[0], nb[1] + p1[1]]; }
      const v0 = this.v(a[0], a[1], hz, na[0], na[1], 0), v1 = this.v(b[0], b[1], hz, nb[0], nb[1], 0), v2 = this.v(b[0], b[1], -hz, nb[0], nb[1], 0), v3 = this.v(a[0], a[1], -hz, na[0], na[1], 0);
      this.quad(v0, v3, v2, v1);
    }
    return this;
  }
  /** any BufferGeometry (keeps its own colour / pbr attributes when present) */
  geo(g) {
    this.begin();
    const P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color, M = g.attributes.aPbr, s = this.n;
    const keep = [this.ro, this.me, this.gl];
    for (let i = 0; i < P.count; i++) {
      if (M) { this.ro = M.getX(i); this.me = M.getY(i); this.gl = M.getZ(i); }
      this.v(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), C ? [C.getX(i), C.getY(i), C.getZ(i)] : null);
    }
    [this.ro, this.me, this.gl] = keep;
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) this.tri(s + ix[i], s + ix[i + 1], s + ix[i + 2]); } else for (let i = 0; i < P.count; i += 3) this.tri(s + i, s + i + 1, s + i + 2);
    return this;
  }
  /** multiply the colour of every vertex from index `from` on by k(x, y, z) */
  dim(from, k) {
    for (let i = from; i < this.n; i++) { const f = k(this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2]); if (f !== 1) { this.C[i * 3] *= f; this.C[i * 3 + 1] *= f; this.C[i * 3 + 2] *= f; } }
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

// ---------- palette ----------
const hex = (h) => rgb(h);
const TAR = hex(0x231d18), HEMP = hex(0xb39a68), IRON = hex(0x2c2c30), GILT = hex(0xd9a83a), BRASS = hex(0xc9a04a);
const DECK = hex(0xb39468), SPAR = hex(0x9a6a38), OAK = hex(0x7a5632), PITCH = hex(0x15110e), GLASS = hex(0x2c4a66);
const WHITE = hex(0xe9e2cf), OCHRE = hex(0xcf9a3c), RED = hex(0x9c2f22), LAMP = hex(0xffd58a);
/** wood grain running along X (planking, decks) or Y (masts): a shade function for the pen */
const grainX = (amt = 0.16, f = 1) => (x, y, z, nx, ny, nz, c) => mul(c, 1 - amt * 0.5 + amt * noise3(x * 2.3 * f, y * 37 * f + 11, z * 37 * f));
const grainY = (amt = 0.16, f = 1) => (x, y, z, nx, ny, nz, c) => mul(c, 1 - amt * 0.5 + amt * noise3(x * 37 * f, y * 2.3 * f + 5, z * 37 * f));
const mottle = (amt = 0.14, f = 9) => (x, y, z, nx, ny, nz, c) => mul(c, 1 - amt * 0.5 + amt * fbm3(x * f, y * f, z * f, 2));

// ---------- the hull: a surface lofted from stations ----------
// s runs 0 (stern) .. 1 (stem). At each station the section is: an underwater curve from the keel
// to the boot-top (yS), a topside curve that swells out to the wale and leans back in (tumblehome)
// or flares up to the planksheer yGun(s), and above that the upperworks (bulwarks, castles).
function makeHull(o) {
  const { L, B } = o, hw = B / 2, d = o.draft, yS = o.yS, sMid = o.sMid;
  const planF = (s, pw, e) => Math.pow(Math.max(0, 1 - Math.pow(clamp((s - sMid) / (1 - sMid), 0, 1), pw)), e);
  const planA = (s, end, pw) => 1 - (1 - end) * Math.pow(Math.max(0, (sMid - s) / sMid), pw);
  const H = { o, L, B, hw, d, yS, yP: o.yP, segs: o.segs };
  H.yGun = (s) => o.fb + (s > sMid ? o.sheerF * Math.pow((s - sMid) / (1 - sMid), 2.3) : o.sheerA * Math.pow((sMid - s) / sMid, 2));
  const zW = (s) => hw * o.wlMid * (s >= sMid ? planF(s, o.wlP, o.wlE) : planA(s, o.tWl, 1.6));
  const zM = (s) => hw * o.midK * (s >= sMid ? planF(s, o.midP, o.midE) : planA(s, o.tMid, 2.1));
  const zR = (s) => hw * (1 - o.tumble * (1 - smooth(0.55, 0.92, s))) * (s >= sMid ? planF(s, o.deckP, o.deckE) : planA(s, o.tDeck, 2.6));
  const kOf = (s) => lerp(o.kEnd, o.kMid, Math.max(0, 1 - Math.pow(Math.abs((s - sMid) / (s > sMid ? 1 - sMid : sMid)), 1.7)));
  /** half-breadth of the outside of the planking at station s, height y */
  H.z = (s, y) => {
    s = clamp(s, 0, 1);
    if (y <= yS) { const h = clamp((y + d) / (d + yS), 0, 1); return zW(s) * Math.pow(h, 1 / kOf(s)); }
    const yg = H.yGun(s), a = zW(s), c = zR(s), ctl = 2 * zM(s) - 0.5 * (a + c);
    if (y <= yg) { const v = (y - yS) / (yg - yS); return (1 - v) * (1 - v) * a + 2 * v * (1 - v) * ctl + v * v * c; }
    const lean = clamp((2 * (c - ctl)) / (yg - yS), o.leanMin, o.leanMax) * smooth(0, 0.3 * hw, c);
    return Math.max(0, c + lean * (y - yg));
  };
  const yTopF = H.yGun(1) + o.topF, yTopA = H.yGun(0) + o.topA;
  H.yTopA = yTopA; H.yTopF = yTopF;
  /** fore-and-aft position: stations lean with the raked stem and the overhanging stern */
  H.x = (s, y) => {
    let x = (s - 0.5) * L;
    if (s > o.fwdFrom) { const a = 1 - (y + d) / (yTopF + d); x -= o.rakeF * (a > 0 ? Math.pow(a, o.stemE) : a * 0.35) * Math.pow(smooth(o.fwdFrom, 1, s), 1.2); }
    if (s < o.aftTo) x += o.rakeA * (yTopA - y) * (1 - smooth(0, o.aftTo, s));
    return x;
  };
  /** outward horizontal unit normal [nx, nz] of the starboard (+Z) side */
  H.nh = (s, y) => {
    const ds = 0.004, s0 = Math.max(0, s - ds), s1 = Math.min(1, s + ds);
    const dx = H.x(s1, y) - H.x(s0, y), dz = H.z(s1, y) - H.z(s0, y), l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  };
  /** a point on the starboard side, pushed `off` out along the horizontal normal */
  H.pt = (s, y, off = 0) => {
    const z = H.z(s, y), x = H.x(s, y);
    if (!off) return [x, y, z];
    const n = H.nh(s, y);
    return [x + n[0] * off, y, Math.max(0, z + n[1] * off)];
  };
  /** station whose side is at fore-and-aft position x at height y */
  H.sOf = (x, y) => { let a = 0, b = 1; for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (H.x(m, y) < x) a = m; else b = m; } return (a + b) / 2; };
  /** placement on the starboard skin: local X forward along the planking, Y up the side, Z out */
  H.frame = (s, y, off = 0) => {
    const o0 = H.pt(s, y, off), ps = sub3(H.pt(Math.min(1, s + 0.004), y), H.pt(Math.max(0, s - 0.004), y)), py = sub3(H.pt(s, y + 0.01), H.pt(s, y - 0.01));
    return frame(o0, ps, py);
  };
  // decks
  H.seg = (s) => { for (const g of H.segs) if (s <= g.s1 + 1e-9) return g; return H.segs[H.segs.length - 1]; };
  H.deckEdge = (s, g = H.seg(s)) => H.yGun(s) + g.lift;
  H.railY = (s, g = H.seg(s)) => H.yGun(s) + g.lift + g.bul;
  H.deckY = (s, z = 0, g = H.seg(s)) => H.deckEdge(s, g) + o.camber * (1 - (z / hw) * (z / hw));
  H.zIn = (s, y) => Math.max(0, H.z(s, y) - o.thick);
  /** a point on deck: station s, breadth as a fraction (-1..1) of the clear deck there */
  H.on = (s, zf = 0, g = H.seg(s), up = 0) => { const ye = H.deckEdge(s, g), z = zf * H.zIn(s, ye + 0.05); return [H.x(s, ye), H.deckY(s, z, g) + up, z]; };
  // stations: even along the body, crowding toward the stem where the plan curls in
  const sts = [], n = Math.max(8, Math.ceil((0.86 * L) / o.step));
  for (let i = 0; i <= n; i++) sts.push((0.86 * i) / n);
  for (const s of o.coarse ? [0.905, 0.95, 0.982, 1] : [0.895, 0.925, 0.95, 0.968, 0.982, 0.992, 1]) sts.push(s);
  H.sts = sts;
  H.stsDeck = sts.filter((s, i) => i % 2 === 0 || s > 0.86);
  H.between = (a, b, list = sts) => [a, ...list.filter((s) => s > a + 2e-3 && s < b - 2e-3), b];
  return H;
}

const MIRROR = new THREE.Matrix4().makeScale(1, 1, -1);
/** draw something on the starboard side and again mirrored to port; fn(side) with side = 1 | -1 */
function bothSides(p, fn) { fn(1); p.push(MIRROR); fn(-1); p.pop(); }

/** how grimy the topsides are at height y (waterline scum, clean higher up) */
const weather = (x, y, seed) => lerp(0.7, 1, smooth(0.02, 0.5, y)) * (1 - 0.1 * (1 - smooth(0.1, 0.9, y)) * noise3(x * 5, 1.3, seed));

/**
 * One strake of planking on the starboard side between heights yLo(s) and yHi(s), from station sA to sB.
 * Each plank is its own strip: faces stand proud, edges and butts sink into caulked seams.
 * st: { col(k), seed, proud, groove, lap, plank (length), holes [[s0, s1], ...], ro }
 */
function strake(p, H, sA, sB, yLo, yHi, st) {
  const L = H.L, es = 0.014 / L, groove = st.groove ?? 0.007, proud = st.proud || 0, lap = st.lap || 0;
  const holes = st.holes || [];
  const inHole = (s) => holes.some((h) => s > h[0] + 1e-6 && s < h[1] - 1e-6);
  const cuts = new Map([[sA, 1], [sB, 1]]);   // station -> 1 flush end, 0 butt joint
  const pl = (st.plank || 2) / L;
  if (!far) for (let c = sA - hash2(st.seed, 3) * pl, k = 0; c < sB; k++) { c += pl * (0.75 + 0.5 * hash2(st.seed, k + 9)); if (c > sA + pl * 0.3 && c < sB - pl * 0.3 && !holes.some((h) => c > h[0] - 3 * es && c < h[1] + 3 * es)) cuts.set(c, 0); }
  for (const h of holes) { if (h[0] > sA && h[0] < sB) cuts.set(h[0], 1); if (h[1] > sA && h[1] < sB) cuts.set(h[1], 1); }
  const list = [...cuts.keys()].sort((a, b) => a - b);
  p.ink(st.col(0), st.ro ?? 0.82);
  for (let k = 0; k < list.length - 1; k++) {
    const a = list[k], b = list[k + 1];
    if (inHole((a + b) / 2) || b - a < 1e-5) continue;
    const fa = cuts.get(a), fb = cuts.get(b);
    const cols = [[a, fa ? 0 : 1]];
    if (!fa) cols.push([a + es, 0]);
    for (const s of H.sts) if (s > a + 2.2 * es && s < b - 2.2 * es) cols.push([s, 0]);
    if (!fb) cols.push([b - es, 0]);
    cols.push([b, fb ? 0 : 1]);
    const base = vary(st.col(k), st.seed * 131 + k * 17, st.vary ?? 0.09), seam = mul(base, 0.36), sd = st.seed * 0.37 + k * 1.9;
    const rows = far ? [[0, 0, lap, 0.3], [1, 0, 0, 0]] : lap ? [[0, 0, 0, 1], [0, 0.005, lap, 0], [1, 0, 0, 0]] : proud > 0.004 ? [[0, 0, -groove, 1], [0, 1, 0, 0], [1, -1, 0, 0], [1, 0, -groove, 1]] : [[0, 0, -groove, 1], [0, 1, 0, 0], [1, 0, 0, 0]];
    p.grid(cols.length - 1, rows.length - 1, (i, j, out) => {
      const s = cols[i][0], lo = yLo(s), hi = yHi(s), e = Math.min(0.012, (hi - lo) * 0.22), r = rows[j];
      const y = (r[0] ? hi : lo) + r[1] * (lap ? 1 : e);
      const q = H.pt(s, y, proud + (cols[i][1] ? -groove : r[2]));
      out[0] = q[0]; out[1] = q[1]; out[2] = q[2];
    }, (i, j) => {
      const s = cols[i][0], x = (s - 0.5) * L, y = rows[j][0] ? yHi(s) : yLo(s);
      const g = (0.9 + 0.2 * noise3(x * 2.6, sd, y * 9)) * (st.clean ? 1 : weather(x, y, st.seed));
      const sk = cols[i][1] ? 1 : rows[j][3];
      return mul(sk === 1 ? seam : sk ? mix(base, seam, sk) : base, g);
    });
  }
}

/** a moulding / rail / wale swept along the side: prof = [[out, up], ...] relative to the skin at height yAt(s) */
function sweep(p, H, cols, yAt, prof, closed = false, flip = false) {
  const n = prof.length - (closed ? 0 : 1);
  p.grid(cols.length - 1, n, (i, j, out) => {
    const s = cols[i], pr = prof[j % prof.length], q = H.pt(s, yAt(s), pr[0]);
    out[0] = q[0]; out[1] = q[1] + pr[1]; out[2] = q[2];
  }, null, flip);
}
/** the same with flat faces between profile points (a squared timber) */
function sweepHard(p, H, cols, yAt, prof, closed = true) {
  const n = prof.length;
  for (let k = 0; k < (closed ? n : n - 1); k++) sweep(p, H, cols, yAt, [prof[k], prof[(k + 1) % n]]);
}
/** close the end of a swept squared timber at station s */
function sweepCap(p, H, s, yAt, prof, facingAft) {
  const pts = prof.map((pr) => { const q = H.pt(s, yAt(s), pr[0]); return [q[0], q[1] + pr[1], q[2]]; });
  p.poly(facingAft ? pts : pts.slice().reverse());
}

/** the planked skin of the starboard side: bottom, boot-top, topside strakes and wales, upperworks */
function shell(p, H, st, side) {
  const sts = H.sts, n = sts.length - 1, d = H.d, sd = side > 0 ? 1 : 2, C = st.col;
  const nu = far ? 3 : 6;
  p.shade(null).ink(C.bottom, 0.92);
  p.grid(n, nu, (i, j, out) => { const q = H.pt(sts[i], -d + Math.pow(j / nu, 1.7) * (H.yP + d)); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
    (i, j) => mul(C.bottom, 0.78 + 0.34 * fbm3(sts[i] * H.L * 2.2, j * 0.7, sd * 3.3, 2)));
  p.ink(C.stripe, 0.8);
  p.grid(n, 1, (i, j, out) => { const q = H.pt(sts[i], j ? H.yS : H.yP, 0.002); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
    (i, j) => mul(C.stripe, (j ? 1 : 0.72) * (0.88 + 0.18 * noise3(sts[i] * H.L * 4, sd, 0.5))));
  const nC = st.nC;
  for (let j = 0; j < nC; j++) {
    const r = st.rowC(j), a = j / nC, b = (j + 1) / nC;
    strake(p, H, 0, 1, (s) => lerp(H.yS, H.yGun(s), a), (s) => lerp(H.yS, H.yGun(s), b),
      { col: r.col, proud: r.proud, lap: st.lap, groove: r.groove, plank: st.plank, seed: sd * 1000 + j, holes: st.holes[`C${j}`], vary: r.vary });
  }
  const sw = st.sw;
  for (const g of H.segs) {
    const top = g.lift + g.bul;
    if (top < 0.03) continue;
    for (let j = 0; j * sw < top - 0.03; j++) {
      const lo = j * sw, hi = (j + 1) * sw > top - 0.035 ? top : (j + 1) * sw, r = st.rowD(j, g, hi >= top);
      strake(p, H, g.s0, g.s1, (s) => H.yGun(s) + lo, (s) => H.yGun(s) + hi,
        { col: r.col, proud: r.proud, groove: r.groove, plank: st.plank, seed: sd * 1000 + 100 + j, holes: st.holes[`D${j}`], vary: r.vary, clean: true });
    }
  }
  // where the rail steps up at a break, the end of the taller bulwark shows its thickness
  for (let k = 0; k < H.segs.length - 1; k++) {
    const a = H.segs[k], b = H.segs[k + 1], ta = a.lift + a.bul, tb = b.lift + b.bul, s = a.s1;
    if (Math.abs(ta - tb) < 0.02) continue;
    const y0 = H.yGun(s) + Math.min(ta, tb), y1 = H.yGun(s) + Math.max(ta, tb);
    const pts = [H.pt(s, y0), [H.x(s, y0), y0, H.zIn(s, y0)], [H.x(s, y1), y1, H.zIn(s, y1)], H.pt(s, y1)];
    p.ink(C.rail, 0.8).poly(ta > tb ? pts : pts.reverse());
  }
}

/** inside face of the bulwarks of one deck, with gaps where guns fire through it */
function bulwarkInside(p, H, st, g) {
  if (g.bul < 0.03) return;
  const C = st.col, open = st.openPorts.filter((q) => q.s > g.s0 && q.s < g.s1);
  const bands = [];
  if (open.length) { const q = open[0]; bands.push([g.lift, q.h0, null], [q.h0, q.h1, open.map((o) => [o.s - o.hw, o.s + o.hw])], [q.h1, g.lift + g.bul, null]); } else bands.push([g.lift, g.lift + g.bul, null]);
  p.shade(null).ink(C.inner, 0.85);
  for (const [h0, h1, gaps] of bands) {
    if (h1 - h0 < 0.004) continue;
    const cuts = [g.s0, ...(gaps || []).flat(), g.s1];
    for (let k = 0; k < cuts.length - 1; k += 2) {
      const cols = H.between(cuts[k], cuts[k + 1]), nr = far ? 1 : Math.max(1, Math.round((h1 - h0) / 0.11));
      p.grid(cols.length - 1, nr, (i, j, out) => { const s = cols[i], y = H.yGun(s) + lerp(h0, h1, j / nr); out[0] = H.x(s, y); out[1] = y; out[2] = H.zIn(s, y); },
        (i, j) => { const s = cols[i], h = lerp(h0, h1, j / nr) - g.lift; return mul(C.inner, (0.62 + 0.38 * smooth(0, 0.22, h)) * (0.88 + 0.2 * noise3(s * H.L * 3, h * 30, 7))); }, true);
    }
  }
}

/** rail cap along the top of one deck's bulwarks (starboard) */
function railCap(p, H, st, g, s0 = g.s0, s1 = g.s1) {
  const t = H.o.thick, ov = st.capOv, h = st.capH, c = h * 0.35, cols = H.between(s0, s1);
  const yAt = (s) => H.railY(s, g) - 0.002;
  p.shade(grainX(0.14)).ink(st.col.rail, 0.7);
  if (far) sweep(p, H, cols, yAt, [[ov, 0], [ov * 0.5, h], [-t - ov * 0.5, h], [-t - ov, 0]]);
  else {
    sweep(p, H, cols, yAt, [[ov, 0], [ov, h - c], [-t / 2, h + c * 0.4], [-t - ov, h - c], [-t - ov, 0]]);
    sweep(p, H, cols, yAt, [[0, 0], [ov, 0]]); sweep(p, H, cols, yAt, [[-t - ov, 0], [-t, 0]]);
  }
  const prof = [[ov, 0], [ov, h], [-t - ov, h], [-t - ov, 0]];
  if (s0 > 0.001) sweepCap(p, H, s0, yAt, prof, true);
  if (s1 < 0.999) sweepCap(p, H, s1, yAt, prof, false);
  p.shade(null);
}

/** one deck laid plank by plank between the bulwarks, with a waterway along each side */
function deckPlanks(p, H, st, g, gi) {
  const w = st.deckW * st.eco, C = st.col, L = H.L, es = 0.012 / L;
  const zi = (s) => H.zIn(s, H.deckEdge(s, g) + 0.03) - 0.003;
  const cols0 = H.between(g.s0, g.s1, H.sts);
  const zmax = Math.max(...cols0.map(zi));
  const prev = H.segs[gi - 1], next = H.segs[gi + 1];
  // shade under the bulwarks and under the break of a higher deck
  const ao = (s, z, zs) => (0.6 + 0.4 * smooth(0, 0.24, zs - Math.abs(z))) * (prev && prev.lift > g.lift + 0.2 ? 0.62 + 0.38 * smooth(0, 0.35, (s - g.s0) * L) : 1) * (next && next.lift > g.lift + 0.2 ? 0.62 + 0.38 * smooth(0, 0.35, (g.s1 - s) * L) : 1);
  if (far) {
    // far off: one surface per deck, striped a little so it still reads as planking
    const nz = 6;
    p.shade(null).ink(C.deck, 0.88);
    p.grid(cols0.length - 1, nz, (i, j, out) => { const s = cols0[i], z = (j / nz * 2 - 1) * (zi(s) + 0.004); out[0] = H.x(s, H.deckEdge(s, g)); out[1] = H.deckY(s, z, g); out[2] = z; },
      (i, j) => { const s = cols0[i], z = (j / nz * 2 - 1) * zi(s); return mul(C.deck, ao(s, z, zi(s) + 0.02) * (0.88 + 0.12 * ((i + j) % 2)) * (0.92 + 0.14 * noise3(s * L * 2.4, j * 1.7, gi))); }, true);
    return;
  }
  // dark underlay so no ragged plank end ever shows daylight
  p.shade(null).ink(mul(C.deck, 0.3), 0.95);
  p.grid(cols0.length - 1, 2, (i, j, out) => { const s = cols0[i], z = (j - 1) * (zi(s) + 0.004); out[0] = H.x(s, H.deckEdge(s, g)); out[1] = H.deckY(s, z, g) - 0.012; out[2] = z; }, null, true);
  const pl = st.deckLen / L;
  for (let j = 0; (j - 0.5) * w < zmax; j++) for (const sgn of j === 0 ? [1] : [1, -1]) {
    const z0 = j === 0 ? -w / 2 : (j - 0.5) * w, z1 = z0 + w, seed = gi * 500 + j * 2 + (sgn > 0 ? 0 : 1);
    const ok = (s) => zi(s) > Math.max(z0, 0) + 0.012;
    // butts: staggered from plank to plank
    const cuts = [g.s0];
    for (let c = g.s0 - hash2(seed, 5) * pl, k = 0; c < g.s1; k++) { c += pl * (0.8 + 0.4 * hash2(seed, k + 3)); if (c > g.s0 + pl * 0.25 && c < g.s1 - pl * 0.25) cuts.push(c); }
    cuts.push(g.s1);
    if (sgn < 0) p.push(MIRROR);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1], cols = [];
      const cand = [a, a + es, ...H.stsDeck.filter((s) => s > a + 2.5 * es && s < b - 2.5 * es), b - es, b];
      for (const s of cand) if (ok(s)) cols.push(s);
      if (cols.length < 2) continue;
      const base = vary(C.deck, seed * 31 + k * 7, 0.085), seam = mul(base, 0.34), sd = seed * 0.71 + k;
      const endA = cols[0] === a && k > 0, endB = cols[cols.length - 1] === b && k < cuts.length - 2;
      p.ink(base, 0.88);
      p.grid(cols.length - 1, 2, (i, jj, out) => {
        const s = cols[i], lim = zi(s), e = 0.01;
        const zA = j === 0 ? -Math.min(w / 2, lim) : Math.min(z0, lim), zB = Math.min(z1, lim);
        const z = jj === 0 ? zA : jj === 1 ? Math.min(zA + e, zB) : zB;
        const low = jj === 0 || (i === 0 && endA) || (i === cols.length - 1 && endB);
        out[0] = H.x(s, H.deckEdge(s, g)); out[1] = H.deckY(s, z, g) - (low ? 0.006 : 0); out[2] = z;
      }, (i, jj) => {
        const s = cols[i], lim = zi(s), z = jj < 2 ? Math.min(z0, lim) : Math.min(z1, lim);
        const low = jj === 0 || (i === 0 && endA) || (i === cols.length - 1 && endB);
        return mul(low ? seam : base, ao(s, z, lim) * (0.9 + 0.2 * noise3((s - 0.5) * L * 2.4, sd, jj * 0.3)));
      }, true);
    }
    if (sgn < 0) p.pop();
  }
  // waterway: the covering board that runs along the foot of the bulwark
  if (g.bul > 0.03 && !st.open) {
    const t = H.o.thick, cols = cols0.filter((s) => zi(s) > 0.1 || s === g.s0);
    if (cols.length > 1) bothSides(p, () => {
      p.shade(grainX(0.14)).ink(mul(C.rail, 0.8), 0.85);
      sweep(p, H, cols, (s) => H.deckEdge(s, g) + H.o.camber * (1 - Math.pow(zi(s) / H.hw, 2)), [[-t + 0.002, 0.018], [-t - 0.075, 0.018], [-t - 0.085, 0.0]]);
    });
    p.shade(null);
  }
}

// ---------- class styles ----------
const KINDS = ['raft', 'skiff', 'sloop', 'cutter', 'brigantine', 'frigate', 'galleon', 'manowar'];
// Every class is built at up to three tiers, each a complete ship in one geometry:
//   0 the full model: every plank seam, ratline, reef point and belaying pin
//   1 for the middle distance (and the close model of the 'low' preset): the fiddly bits left out, coarser cloth and decks
//   2 far off: flat strakes, one surface per deck, standing rigging only
// lite / far switch detail off in the builders, eco stretches the mesh of cloth, decks and rails, step spaces the hull
// stations, q thins the round shapes drawn by the pen, fig scales the sculpt resolution of the figurehead.
const TIERS = [
  { lite: false, far: false, eco: 1, step: 1, q: 1, fig: 1 },
  { lite: true, far: false, eco: 1.5, step: 1.6, q: 0.7, fig: 0.5 },
  { lite: true, far: true, eco: 2.6, step: 2.6, q: 0.45, fig: 0.3 },
];
/** everything the builders need, derived from the class numbers; the stock ids add their own character */
function styleFor(def, tier = 0, over = null) {
  const T = TIERS[tier];
  const L = def.len, B = def.beam, per = Math.max(0, def.cannons?.perSide | 0), masts = over ? Math.max(0, def.sails | 0) : Math.max(1, def.sails | 0 || 1);
  const kind = over ? over.base : KINDS.includes(def.id) ? def.id
    : per === 0 && L < 2.9 ? 'raft' : L < 4 ? 'skiff' : L < 4.8 ? 'sloop' : L < 5.7 ? 'cutter' : L < 7 ? 'brigantine' : L < 8.1 ? 'frigate' : per >= 9 || L >= 9.3 ? 'manowar' : 'galleon';
  const hullC = hex(def.color ?? 0x6b4a2e), sailC = hex(def.sail ?? 0xe8e2d0);
  const lum = hullC[0] * 0.3 + hullC[1] * 0.6 + hullC[2] * 0.1;
  const st = { kind, L, B, per, masts, def, tier, lite: T.lite, far: T.far, eco: (kind === 'frigate' ? 1.2 : 1) * T.eco, sw: 0.085, plank: 2.1, deckW: 0.085, deckLen: 1.7, capOv: 0.022, capH: 0.035, lap: 0, open: false, holes: {}, openPorts: [], ports: [] };
  const o = { L, B, yP: 0.035, yS: 0.1, sMid: 0.46, midK: 1, wlMid: 0.92, wlP: 2.0, wlE: 1.1, midP: 2.3, midE: 0.8, deckP: 2.6, deckE: 0.58,
    tWl: 0.3, tMid: 0.68, tDeck: 0.74, kMid: 3, kEnd: 0.9, tumble: 0.02, leanMin: -0.3, leanMax: 0.3,
    fwdFrom: 0.6, aftTo: 0.3, stemE: 1.9, thick: 0.05, camber: 0.03, step: { sloop: 0.15, cutter: 0.16, brigantine: 0.19, frigate: 0.27, galleon: 0.21 }[kind] || 0.22, rakeF: 0.1 * L, rakeA: 0.18 };
  const wale = mul(hullC, 0.42), dark = mul(hullC, 0.6);
  const C = st.col = { hull: hullC, wale, bottom: hex(0x2c231c), stripe: hex(0xe2d8bc), accent: lum < 0.05 ? OCHRE : mix(hullC, WHITE, 0.55), upper: dark, top: wale,
    inner: mul(mix(hullC, OAK, 0.6), 1.15), deck: DECK, rail: mul(mix(hullC, OAK, 0.5), 0.9), sail: sailC, spar: SPAR, trim: GILT, transom: hullC };
  // the device each class wears on her mainsail, painted in the colour of her side
  st.device = { raft: 'daub', skiff: 'disc', sloop: 'lozenge', cutter: 'roundel', brigantine: 'saltire', frigate: 'cross', galleon: 'sun', manowar: 'star' }[kind];
  if (kind === 'raft') return st;
  let portRows = [2, 4], walesC = [], portsC = null, spread = [0.2, 0.8];
  switch (kind) {
    case 'skiff':
      Object.assign(o, { draft: 0.2, fb: 0.42, sheerF: 0.2, sheerA: 0.08, wlMid: 0.76, midK: 0.92, tumble: 0, deckE: 0.62, wlE: 1.0, tWl: 0.42, tMid: 0.68, tDeck: 0.74, kMid: 2.2, kEnd: 1,
        rakeF: 0.085 * L, rakeA: 0.1, thick: 0.03, camber: 0, yS: 0.08, yP: 0.03, step: 0.13, segs: [{ s0: 0, s1: 1, lift: -0.41, bul: 0.41 }] });
      st.open = true; st.lap = 0.014; st.sw = 0.075; st.plank = 9; st.deckW = 0.1; st.capOv = 0.016; st.capH = 0.03;
      C.accent = mix(hullC, WHITE, 0.7); C.inner = mul(hullC, 1.0); C.deck = mix(hex(0x8a7c66), hullC, 0.25); C.thwart = mul(mix(hullC, DECK, 0.7), 1.08);
      break;
    case 'sloop':
      Object.assign(o, { draft: 0.35, fb: 0.5, sheerF: 0.22, sheerA: 0.1, tumble: 0.015, rakeA: 0.16, segs: [{ s0: 0, s1: 0.3, lift: 0.2, bul: 0.34 }, { s0: 0.3, s1: 1, lift: 0, bul: 0.4 }] });
      walesC = [3]; portRows = [2, 3]; spread = [0.38, 0.78];
      C.upper = hex(0x2c4a3c); C.top = mul(hullC, 0.5);
      break;
    case 'cutter':
      Object.assign(o, { draft: 0.4, fb: 0.5, sheerF: 0.26, sheerA: 0.08, tumble: 0.01, rakeF: 0.13 * L, stemE: 1.5, rakeA: 0.26, wlE: 1.25, deckE: 0.7, midE: 0.86, tDeck: 0.62, tMid: 0.56,
        segs: [{ s0: 0, s1: 0.24, lift: 0.16, bul: 0.3 }, { s0: 0.24, s1: 1, lift: 0, bul: 0.4 }] });
      walesC = [4]; portRows = [2, 3]; spread = [0.34, 0.74];
      C.rail = hex(0x8a6238); C.wale = hex(0x16161a); C.accent = WHITE; C.upper = hullC; C.top = hex(0x16161a); C.bottom = hex(0x5a2a22); C.stripe = hex(0xf0ece0); C.inner = hex(0xb9a78a);
      break;
    case 'brigantine':
      Object.assign(o, { draft: 0.5, fb: 0.62, sheerF: 0.26, sheerA: 0.14, tumble: 0.03, rakeA: 0.2, segs: [{ s0: 0, s1: 0.3, lift: 0.5, bul: 0.42 }, { s0: 0.3, s1: 1, lift: 0, bul: 0.42 }] });
      walesC = [3, 4]; portRows = [2, 3]; spread = [0.2, 0.78];
      C.accent = OCHRE; C.upper = mul(hullC, 0.7); C.top = hex(0x1a1512); C.bottom = hex(0x3a2a22);
      break;
    case 'frigate':
      Object.assign(o, { draft: 0.6, fb: 0.78, sheerF: 0.26, sheerA: 0.18, tumble: 0.045, rakeA: 0.2, deckE: 0.55,
        segs: [{ s0: 0, s1: 0.34, lift: 0.78, bul: 0.45 }, { s0: 0.34, s1: 0.84, lift: 0, bul: 0.51 }, { s0: 0.84, s1: 1, lift: 0.42, bul: 0.36 }] });
      walesC = [4, 5]; spread = [0.16, 0.82];
      C.accent = hex(0xd8c79a); C.upper = hex(0x1d4a3a); C.top = hex(0x14110f); C.bottom = hex(0x4a3528); C.inner = hex(0x8c2e22); C.wale = hex(0x14110f);
      break;
    case 'galleon':
      Object.assign(o, { draft: 0.7, fb: 0.9, sheerF: 0.3, sheerA: 0.4, tumble: 0.09, rakeF: 0.08 * L, rakeA: 0.2, deckE: 0.5, midE: 0.72, tDeck: 0.7, leanMin: -0.34,
        segs: [{ s0: 0, s1: 0.2, lift: 1.5, bul: 0.45 }, { s0: 0.2, s1: 0.43, lift: 0.85, bul: 0.45 }, { s0: 0.43, s1: 0.79, lift: 0, bul: 0.51 }, { s0: 0.79, s1: 1, lift: 0.7, bul: 0.42 }] });
      walesC = [1, 2, 7]; portsC = [3, 5]; spread = [0.2, 0.8];
      C.accent = hex(0xd0a040); C.upper = hex(0x8a2a1e); C.top = hex(0x1f1611); C.bottom = hex(0x3b2a20); C.inner = mul(hullC, 1.1); C.wale = hex(0x2a1a10);
      break;
    default: // manowar
      Object.assign(o, { draft: 0.8, fb: 0.95, sheerF: 0.26, sheerA: 0.28, tumble: 0.07, rakeF: 0.09 * L, rakeA: 0.2, deckE: 0.5, midE: 0.72,
        segs: [{ s0: 0, s1: 0.15, lift: 1.52, bul: 0.45 }, { s0: 0.15, s1: 0.36, lift: 0.88, bul: 0.47 }, { s0: 0.36, s1: 0.8, lift: 0, bul: 0.51 }, { s0: 0.8, s1: 1, lift: 0.5, bul: 0.4 }] });
      walesC = [1, 2, 7]; portsC = [3, 5]; spread = [0.19, 0.8]; st.chequer = true;
      C.accent = OCHRE; C.upper = hex(0x1c2c50); C.top = hex(0x121216); C.bottom = hex(0x4f3a2c); C.inner = hex(0x8c2e22); C.wale = hex(0x101014);
  }
  if (over && over.pre) { const v = { portRows, walesC, portsC, spread }; over.pre(st, o, C, v); ({ portRows, walesC, portsC, spread } = v); }   // fleets.js: a design of its own on this base
  st.stern = {
    sloop: { tiers: [[0.06, 0.36, 2]], trim: C.accent, frame: WHITE, pilaster: C.upper, lanterns: 0, quarterPieces: [0.0, 0.5] },
    cutter: { trim: WHITE, quarterPieces: [0.0, 0.42] },
    brigantine: { tiers: [[0.1, 0.44, 3]], trim: C.accent, frame: WHITE, pilaster: C.upper, lanterns: 1, lanternH: 0.24, quarterPieces: [0.0, 0.9], badge: 0.68 },
    frigate: { tiers: [[0.14, 0.66, 5]], arch: 0.16, lanterns: 1, lanternH: 0.34, quarter: [0.06, 0.7, 0.62, 0.15], quarterPieces: [0.0, 1.2], pilaster: C.accent, badge: 0.95 },
    galleon: { tiers: [[0.16, 0.72, 4], [1.02, 1.42, 4]], balcony: 0.86, arch: 0.24, lanterns: 1, lanternH: 0.44, quarter: [0.08, 0.76, 0.8, 0.2], quarterPieces: [0.0, 1.95], pilaster: C.upper, balCol: C.accent, badge: 1.68 },
    manowar: { tiers: [[0.16, 0.74, 6], [1.06, 1.44, 6]], balcony: 0.9, arch: 0.2, lanterns: 3, lanternH: 0.36, quarter: [0.08, 1.44, 0.9, 0.19], quarterTiers: [[0.12, 0.62], [0.98, 1.34]], quarterPieces: [0.0, 1.95], pilaster: C.accent, badge: 1.7 },
  }[kind];
  st.head = {
    cutter: { type: 'scroll', len: 0.26, tip: 0.3, e: 1.5, scroll: 0.05, trail: 0.3 },
    brigantine: { type: 'scroll', len: 0.34, tip: 0.3, scroll: 0.07, trail: 0.4, rails: 1, railY: 0.36, railCol: C.accent },
    frigate: { type: 'scroll', len: 0.52, tip: 0.5, scroll: 0.09, trail: 0.5, rails: 2, railY: 0.6, drop: 0.28, platform: true },
    galleon: { type: 'ram', len: 1.0, tip: 0.1, e: 1.25, rails: 2, railY: 0.5, drop: 0.3, bow: -0.03, platform: true, railCol: C.upper, size: 1.25, railS: 0.9 },
    manowar: { type: 'drake', len: 0.72, tip: 0.36, rails: 2, railY: 0.62, drop: 0.3, platform: true, size: 1.15, trail: 0.6 },
  }[kind];
  if (over && over.mid) over.mid(st, o, C);
  o.step *= T.step; o.coarse = T.far;
  st.chW = { brigantine: 0.1, frigate: 0.13, galleon: 0.16, manowar: 0.16 }[kind] || 0;
  st.rig = rigPlan(st);
  if (over && over.rig) over.rig(st.rig, st);
  st.transomCol = (y) => (y > o.fb + o.sheerA + 0.03 ? C.upper : C.hull);
  o.topF = o.segs[o.segs.length - 1].lift + o.segs[o.segs.length - 1].bul;
  o.topA = o.segs[0].lift + o.segs[0].bul;
  st.hull = o;
  st.nC = Math.max(3, Math.round((o.fb - o.yS) / st.sw));
  // gun ports: which strakes they pierce and where along the side
  const two = !!portsC && per >= 4;
  const nLow = two ? Math.ceil(per / 2) : 0, nUp = per - nLow;
  const tiers = [];
  if (kind !== 'skiff' && kind !== 'raft') {
    if (nLow) tiers.push({ band: 'C', rows: portsC, n: nLow, shift: 0.5 });
    if (nUp) tiers.push({ band: 'D', rows: portRows, n: nUp, shift: two ? 0 : 0.5, div: two ? nLow : nUp });
  }
  st.portRows = portRows; st.portsC = portsC; st.walesC = walesC;
  st.gunLen = { sloop: 0.42, cutter: 0.42, brigantine: 0.48, frigate: 0.54, galleon: 0.58 }[kind] || 0.62; st.gunOut = st.gunLen * 0.36;
  for (const t of tiers) {
    const dS = (spread[1] - spread[0]) / (t.div || t.n), pw = Math.min(kind === 'sloop' || kind === 'cutter' ? 0.2 : 0.26, dS * L * 0.5);
    for (let i = 0; i < t.n; i++) {
      const s = spread[0] + (i + t.shift) * dS, hwS = pw / 2 / L, g = o.segs.find((q) => s <= q.s1);
      const port = { band: t.band, s, hw: hwS, w: pw, rows: t.rows };
      if (t.band === 'D') { port.h0 = t.rows[0] * st.sw; port.h1 = (t.rows[1] + 1) * st.sw; port.open = port.h0 >= g.lift + 0.08 && port.h1 <= g.lift + g.bul + 0.01; if (port.open) st.openPorts.push(port); }
      for (let j = t.rows[0]; j <= t.rows[1]; j++) (st.holes[`${t.band}${j}`] ||= []).push([s - hwS, s + hwS]);
      st.ports.push(port);
    }
  }
  for (const k of Object.keys(st.holes)) st.holes[k].sort((a, b) => a[0] - b[0]);
  // paint, strake by strake
  const inPortC = (j) => portsC && j >= portsC[0] && j <= portsC[1];
  st.rowC = (j) => walesC.includes(j) ? { col: () => C.wale, proud: 0.02, groove: 0.008, vary: 0.05 }
    : inPortC(j) && st.chequer ? { col: () => C.accent, proud: 0, vary: 0.05 } : { col: () => C.hull, proud: 0 };
  st.rowD = (j, g, last) => {
    if (kind === 'galleon' && j > 5) return { col: () => [C.upper, C.accent, hex(0x1f4a44)][((j - 6) >> 1) % 3], proud: 0, vary: 0.05 };
    if (j > 5) return { col: () => C.upper, proud: 0, vary: 0.05 };
    if (last && g.lift + g.bul < 0.7) return { col: () => C.top, proud: 0.006, vary: 0.05 };
    if (j >= portRows[0] && j <= portRows[1]) return { col: () => (kind === 'sloop' ? C.upper : C.accent), proud: 0, vary: 0.05 };
    return { col: () => (kind === 'sloop' ? C.upper : j < portRows[0] ? C.hull : C.top), proud: 0, vary: 0.06 };
  };
  if (kind === 'skiff') { st.rowC = (j) => ({ col: () => (j === st.nC - 1 ? C.accent : C.hull), proud: 0 }); }
  if (over && over.post) over.post(st, o, C);
  return st;
}

// ---------- side works: mouldings, hances, cabin lights, entry steps ----------
function sideWorks(p, H, st) {
  const C = st.col, L = H.L, t = H.o.thick, k = st.kind;
  if (st.open) return;
  const gilt = k === 'frigate' || k === 'manowar', trimC = gilt ? C.trim : C.accent, trimP = gilt ? [0.4, 0.85] : [0.75, 0];
  const half = [[0.003, -0.017], [0.02, -0.01], [0.02, 0.01], [0.003, 0.017]];
  // a moulded rail along the side at the level of every raised deck, and one under the rail of the castles
  H.segs.forEach((g) => {
    if (g.lift < 0.3) return;
    const cols = H.between(g.s0, Math.min(g.s1, 0.985));
    p.shade(null).ink(trimC, ...trimP);
    sweep(p, H, cols, (s) => H.yGun(s) + g.lift - 0.03, half);
    if (g.bul > 0.3 && (k === 'manowar' || k === 'galleon')) sweep(p, H, cols, (s) => H.railY(s, g) - 0.07, half.map(([o, u]) => [o * 0.8, u * 0.7]));
  });
  // hances: where the rail steps down, a carved bracket eases the drop
  for (let i = 0; i < H.segs.length - 1; i++) {
    const a = H.segs[i], b = H.segs[i + 1], ta = a.lift + a.bul, tb = b.lift + b.bul, d = Math.abs(ta - tb);
    if (d < 0.14) continue;
    const s = a.s1, lowFwd = ta > tb, y0 = H.yGun(s) + Math.min(ta, tb) + st.capH - 0.004, hh = Math.min(d, 0.5), ll = Math.min(0.5, hh * 1.15);
    const out = [[0, 0], [ll, 0]];
    for (let j = 0; j <= 8; j++) { const q = (j / 8) * Math.PI / 2; out.push([ll * (1 - Math.sin(q)) * 0.96 + 0.0, hh * (1 - Math.cos(q)) * 0.96]); }
    out.push([0, hh]);
    p.push(H.frame(s + (lowFwd ? 0.004 : -0.004) / L, y0, -t / 2)); p.push(X(0, 0, 0, 0, 0, 0, lowFwd ? 1 : -1, 1, 1));
    p.shade(null).ink(st.rowD(8, lowFwd ? a : b, false).col(), 0.8).extrude(out, t + 0.012);
    if (!far) { p.push(X(ll * 0.2, hh * 0.24, t / 2 + 0.012)); scroll(p, Math.min(ll, hh) * 0.2, 0.012, 1.4, C.trim); p.pop(); }
    p.pop(); p.pop();
  }
  // small lights in the sides of the cabins under the quarterdeck and the poop
  H.segs.forEach((g, gi) => {
    if (g.lift < 0.74 || g.s0 > 0.5) return;
    const fwd = H.segs[gi + 1], below = fwd && fwd.lift < g.lift ? fwd.lift : 0;
    const h0 = below < 0.05 ? Math.max(0.5, st.sw * (st.portRows[1] + 1) + 0.07) : below + 0.22, wh = Math.min(0.26, g.lift - 0.13 - h0);
    if (wh < 0.1) return;
    const sA = gi === 0 ? (st.stern && st.stern.quarter ? st.stern.quarter[2] / L + 0.03 : 0.035) : g.s0 + 0.22 / L, sB = g.s1 - 0.2 / L;
    const n = Math.max(1, Math.floor(((sB - sA) * L) / 0.62) + 1);
    for (let j = 0; j < n; j++) {
      const ss = n === 1 ? (sA + sB) / 2 : lerp(sA, sB, j / (n - 1));
      if (ss <= sA - 1e-6 || sB < sA) continue;
      p.push(H.frame(ss, H.yGun(ss) + h0, 0.002)); windowLight(p, 0.15, wh, gilt ? C.trim : WHITE, { metal: gilt ? 0.6 : 0, nx: 2, ny: wh > 0.19 ? 2 : 1, fr: 0.018 }); p.pop();
    }
  });
  // entry steps up the side amidships, between two guns
  const waist = H.segs.find((g) => Math.abs(g.lift) < 0.01 && g.s1 - g.s0 > 0.2);
  if (waist && k !== 'sloop' && k !== 'cutter' && !far) {
    const ups = st.ports.filter((q) => q.s > waist.s0 && q.s < waist.s1).map((q) => q.s).sort((x, y) => x - y);
    let ss = (waist.s0 + waist.s1) / 2;
    for (let j = 0; j < ups.length - 1; j++) if (ups[j + 1] - ups[j] > 0.5 / L && ups[j] < 0.56) ss = (ups[j] + ups[j + 1]) / 2;
    if (!st.ports.some((q) => Math.abs(q.s - ss) < q.hw + 0.09 / L)) {
      const y1 = H.railY(ss, waist) - 0.1;
      p.shade(grainX(0.12)).ink(C.rail, 0.8);
      for (let y = H.yS + 0.2; y < y1; y += 0.16) p.TM(H.frame(ss, y, 0.02)).box(0.17, 0.026, 0.045, 0.006);
      p.shade(null);
    }
  }
}

// ---------- stern and stem ----------
function transom(p, H, st) {
  const C = st.col, g0 = H.segs[0], top = H.railY(0, g0), y0 = -H.d, ph = 0.09;
  const nP = Math.max(2, Math.round((top - y0) / ph));
  p.shade(null);
  for (let k = 0; k < nP; k++) {
    const ya = lerp(y0, top, k / nP), yb = lerp(y0, top, (k + 1) / nP), ym = (ya + yb) / 2;
    const base = vary(ym < H.yP ? C.bottom : ym < H.yS ? C.stripe : st.transomCol ? st.transomCol(ym) : C.transom, 900 + k, 0.08), seam = mul(base, 0.4);
    const rows = [[ya, 1], [ya + 0.011, 0], [yb - 0.011, 0], [yb, 1]];
    p.ink(base, 0.84);
    p.grid(4, 3, (i, j, out) => { const y = rows[j][0], u = (i - 2) / 2; out[0] = H.x(0, y) - (rows[j][1] ? 0 : 0.006); out[1] = y; out[2] = u * H.z(0, y); },
      (i, j) => mul(rows[j][1] ? seam : base, (0.9 + 0.2 * noise3(i * 1.7, k * 3.1, 2.2)) * weather(i, rows[j][0], 5)));
  }
  // inside of the stern bulwark, and the taffrail across the top
  const yd = H.deckEdge(0, g0), t = H.o.thick;
  if (g0.bul > 0.03 && !st.open) {
    p.ink(C.inner, 0.85);
    p.grid(4, 2, (i, j, out) => { const y = lerp(yd, top, j / 2), u = (i - 2) / 2; out[0] = H.x(0, y) + t; out[1] = y; out[2] = u * H.zIn(0, y); },
      (i, j) => mul(C.inner, 0.62 + 0.19 * j), true);
  }
  const zt = H.z(0, top);
  p.shade(grainX(0.14)).ink(C.rail, 0.7).T(H.x(0, top) + t / 2, top + st.capH / 2 - 0.002, 0, 0, 0, 0).box(t + 2 * st.capOv, st.capH, 2 * zt + 2 * st.capOv, st.capH * 0.35);
  p.shade(null);
}

/** keel, stem post and stern post with the rudder hung on it */
function backbone(p, H, st) {
  const C = st.col, d = H.d, o = H.o, w = st.stemW ?? clamp(H.B * 0.035, 0.05, 0.11);
  const topY = H.railY(1) + (st.stemHead ?? 0.06);
  // stem: follows the rake of the bow from the forefoot to above the rail
  const front = [], back = [];
  for (let i = 0; i <= 14; i++) { const y = lerp(-d - 0.04, topY, i / 14); front.push([H.x(1, y) + (st.cutwater ? st.cutwater(y) : 0.05), y]); back.push([H.x(1, y) - 0.05, y]); }
  const tone = (x, y, z, nx, ny, nz, c) => mul(y < H.yP ? C.bottom : c, 0.85 + 0.25 * noise3(x * 9, y * 9, z * 9));
  p.shade(tone).ink(C.wale, 0.85).extrude([...front, ...back.reverse()], w, false);
  // keel
  p.T(-0.02 * H.L, -d - 0.03, 0).box(H.L * 0.86, 0.09, w, 0.01);
  // stern post and rudder
  const yr = st.rudderTop ?? H.yS + 0.24, post = [], blade = [];
  for (let i = 0; i <= 6; i++) { const y = lerp(-d - 0.04, yr, i / 6); post.push([H.x(0, y) + 0.03, y]); blade.push([H.x(0, y) - 0.05, y]); }
  p.extrude([...blade, ...post.reverse()], w, false);
  const rb = [], rf = [];
  for (let i = 0; i <= 6; i++) { const y = lerp(-d - 0.02, yr + 0.05, i / 6), k = i / 6; rf.push([H.x(0, y) - 0.06, y]); rb.push([H.x(0, y) - 0.06 - lerp(0.22, 0.1, k) * clamp(H.L / 6, 0.6, 1.5), y]); }
  p.extrude([...rb, ...rf.reverse()], w * 0.7, false);
  p.shade(null);
  // pintle straps
  p.ink(IRON, 0.5, 0.8);
  for (const y of [H.yS + 0.1, -d * 0.45]) if (y < yr) p.T(H.x(0, y) - 0.1, y, 0).box(0.2, 0.03, w * 0.7 + 0.014, 0.004);
}

// ---------- joinery shared by decks and castles ----------
const BALUSTER = [[0.5, 0], [0.42, 0.12], [0.95, 0.34], [0.78, 0.54], [0.42, 0.74], [0.6, 0.86], [0.42, 1]];
const BALUSTER_MID = [[0.5, 0], [0.95, 0.34], [0.42, 0.74], [0.42, 1]], BALUSTER_FAR = [[0.62, 0], [0.62, 1]];
/** a rail on turned stanchions from a to b (points at deck level), h high */
function balustrade(p, a, b, h, col, o = {}) {
  const len = dist3(a, b);
  if (len < 0.08) return;
  const up = o.up || [0, 1, 0], r = o.r ?? 0.026, hr = 0.034, n = Math.max(1, Math.round(len / ((o.pitch ?? 0.14) * eco)));
  const m = frame(a, sub3(b, a), up);
  p.push(m);
  p.shade(null).ink(col, 0.72);
  const prof = (far ? BALUSTER_FAR : lite ? BALUSTER_MID : BALUSTER).map(([rr, y]) => [rr * r, y * (h - hr)]);
  for (let i = 0; i <= n; i++) {
    const x = (len * i) / n;
    if (i === 0 || i === n) { if (!o.noPosts) p.T(x, h / 2, 0).box(0.05, h, 0.05, 0.008); } else p.T(x, 0, 0, 0, 45, 0).lathe(prof, 4);
  }
  p.T(len / 2, h - hr / 2, 0).box(len + 0.04, hr, 0.062, 0.01);
  p.T(len / 2, 0.012, 0).box(len, 0.024, 0.045);
  p.pop();
}
/** a steep ship's ladder from the foot (on the lower deck) to the head (at the edge of the upper deck) */
function ladder(p, foot, head, w, col) {
  const rise = head[1] - foot[1], n = Math.max(2, Math.round(rise / 0.15)), d = sub3(head, foot), len = Math.hypot(d[0], d[1], d[2]);
  const side = norm3(cross(d, [0, 1, 0]));
  p.shade(grainX(0.12)).ink(col, 0.8);
  for (const sg of [-1, 1]) { const o = add3(foot, side, (sg * w) / 2); p.TM(frame(o, d, [0, 1, 0])).T2(len / 2, 0, 0).box(len + 0.04, 0.09, 0.024, 0.005); }
  for (let i = 1; i <= n; i++) { const q = lerp3(foot, head, (i - 0.3) / n); p.TM(frame(q, side, [0, 1, 0])).box(w, 0.02, 0.1); }
  p.shade(null);
}
/** a framed plank door flat on a wall: placed with its foot at the origin, facing +Z */
function door(p, w, h, col, o = {}) {
  const fr = 0.035;
  p.ink(mul(col, 0.55), 0.8).T2(0, h / 2, 0.004).box(w + 2 * fr, h + fr, 0.02, 0.004);
  const nb = lite ? 1 : Math.max(2, Math.round(w / 0.085));
  for (let i = 0; i < nb; i++) p.ink(vary(col, 77 + i + (o.seed || 0), 0.1), 0.8).T2(-w / 2 + ((i + 0.5) * w) / nb, h / 2 - fr / 4, 0.016).box(w / nb - 0.006, h - fr / 2, 0.014);
  if (far) return;
  p.ink(IRON, 0.5, 0.8);
  for (const y of [h * 0.2, h * 0.78]) p.T2(-w * 0.12, y, 0.025).box(w * 0.7, 0.022, 0.008);
  if (!lite) p.T2(w * 0.32, h * 0.5, 0.03, 90).lathe([[0.0, -0.004], [0.022, -0.004], [0.022, 0.004], [0, 0.004]], 8);
  if (o.light) { p.ink(GLASS, 0.15, 0.5, 0.15).T2(0, h * 0.74, 0.024).box(w * 0.42, h * 0.16, 0.006, 0.002); p.ink(mul(col, 0.5)).T2(0, h * 0.74, 0.027).box(0.012, h * 0.16, 0.006); }
}
Pen.prototype.T2 = function (x, y, z, rx, ry, rz, sx, sy, sz) { const m = X(x, y, z, rx, ry, rz, sx, sy, sz); this.loc = this.loc ? this.loc.multiply(m) : m; return this; };
/** a small leaded window flat on a wall, foot at the origin, facing +Z */
function windowLight(p, w, h, frameCol, o = {}) {
  const fr = o.fr ?? 0.022, nx = o.nx ?? Math.max(1, Math.round(w / 0.085)), ny = o.ny ?? Math.max(1, Math.round(h / 0.1));
  if (far) {
    p.ink(frameCol, 0.6, o.metal || 0).T2(0, h / 2, 0.008).box(w + 2 * fr, h + 2 * fr, 0.016);
    p.ink(GLASS, 0.14, 0.55, o.glow ?? 0.22).T2(0, h / 2, 0.012).box(w, h, 0.014);
    return;
  }
  p.ink(GLASS, 0.14, 0.55, o.glow ?? 0.22).T2(0, h / 2, 0.006).box(w, h, 0.008);
  p.ink(frameCol, 0.6, o.metal || 0);
  p.T2(0, h + fr / 2, 0.01).box(w + 2 * fr, fr, 0.03); p.T2(0, -fr / 2, 0.01).box(w + 2.6 * fr, fr * 1.1, 0.04);
  for (const sg of [-1, 1]) p.T2((sg * (w + fr)) / 2, h / 2, 0.01).box(fr, h, 0.03);
  if (lite && w * h < 0.03) return;
  for (let i = 1; i < nx; i++) p.T2(-w / 2 + (i * w) / nx, h / 2, 0.012).box(0.009, h, 0.01);
  for (let i = 1; i < ny; i++) p.T2(0, (i * h) / ny, 0.012).box(w, 0.009, 0.01);
}

/** the wall across the ship where a higher deck breaks down to a lower one, with its doors, rail and ladders */
function bulkhead(p, H, st, k) {
  const a = H.segs[k], b = H.segs[k + 1];
  if (Math.abs(a.lift - b.lift) < 0.03) return;
  const hi = a.lift > b.lift ? a : b, lo = hi === a ? b : a, s = a.s1, dir = hi === a ? 1 : -1;   // dir: which way the wall faces along X
  const C = st.col, y0 = H.deckEdge(s, lo) - 0.01, y1 = H.deckEdge(s, hi), ht = y1 - y0;
  const zi = (y) => H.zIn(s, y), bw = far ? 0.32 : lite ? 0.21 : 0.105, zMax = zi(y1) + 0.01, nb = Math.ceil(zMax / bw);
  const cam = (z, g) => H.o.camber * (1 - (z / H.hw) * (z / H.hw));
  const colB = st.bulkCol || C.inner;
  p.shade(null);
  for (let i = -nb; i < nb; i++) {
    const base = vary(colB, 4000 + k * 97 + i, 0.07), seam = mul(base, 0.4);
    p.ink(base, 0.82);
    p.grid(3, 2, (ii, j, out) => {
      const zc = [i * bw, i * bw + 0.01, (i + 1) * bw - 0.01, (i + 1) * bw][ii];
      const yy = j === 0 ? y0 : j === 1 ? (y0 + y1) / 2 : y1, lim = zi(yy), z = clamp(zc, -lim, lim);
      out[0] = H.x(s, yy) + dir * (ii === 0 || ii === 3 ? -0.006 : 0); out[1] = yy + (j ? cam(z) : cam(z)); out[2] = z;
    }, (ii, j) => mul(ii === 0 || ii === 3 ? seam : base, 0.66 + 0.17 * j), dir < 0);
  }
  // breast beam along the top edge
  const zt = zi(y1 + 0.02);
  p.shade(grainX(0.12)).ink(C.rail, 0.75).T(H.x(s, y1) + dir * 0.012, y1 + H.o.camber * 0.5 - 0.03, 0).box(0.07, 0.09, 2 * zt, 0.01);
  p.shade(null);
  const M = (z, y) => X(H.x(s, y) + dir * 0.004, y, z, 0, dir > 0 ? 90 : -90, 0);
  const wide = zt * 2;
  const stairs = ht > 0.3, twoLadders = wide > 1.9 && ht > 0.45;
  const lw = clamp(wide * 0.2, 0.3, 0.44), lz = twoLadders ? zt - lw / 2 - 0.1 : 0;
  if (ht > 0.66 && !far) {
    const dh = Math.min(0.86, ht - 0.07), dw = clamp(wide * 0.16, 0.28, 0.4);
    const doors = twoLadders ? (wide > 2.6 ? [-dw * 0.9, dw * 0.9] : [0]) : [zt * 0.55];
    for (const z of doors) { p.push(M(z, y0 + 0.012 + cam(z))); door(p, dw, dh, st.doorCol || mul(C.rail, 0.9), { seed: k * 9, light: st.kind !== 'brigantine' }); p.pop(); }
    if (wide > 2.2) for (const sg of [-1, 1]) { const z = sg * (twoLadders ? (doors.length > 1 ? dw * 2.3 : dw * 1.5) : zt * 0.5); p.push(M(z, y0 + ht * 0.42)); windowLight(p, 0.2, ht * 0.3, C.trim); p.pop(); }
  }
  if (stairs && far) {
    // far off a ladder is one sloping board
    const run = Math.min(0.55, ht * 0.62);
    for (const sg of twoLadders ? [-1, 1] : [1]) {
      const z = sg * lz, a = [H.x(s, y0) + dir * (run + 0.05), y0 + cam(z) + 0.01, z], b = [H.x(s, y1) + dir * 0.05, y1 + cam(z), z];
      p.shade(null).ink(mul(C.rail, 0.9), 0.8).TM(frame(lerp3(a, b, 0.5), sub3(b, a), [0, 1, 0])).box(dist3(a, b), 0.05, lw);
    }
  } else if (stairs) {
    const run = Math.min(0.55, ht * 0.62);
    for (const sg of twoLadders ? [-1, 1] : [1]) {
      const z = sg * lz;
      ladder(p, [H.x(s, y0) + dir * (run + 0.05), y0 + cam(z) + 0.01, z], [H.x(s, y1) + dir * 0.05, y1 + cam(z), z], lw, mul(C.rail, 1.05));
    }
  } else if (ht > 0.12) {
    p.shade(grainX(0.12)).ink(C.rail, 0.8).T(H.x(s, y0) + dir * 0.08, y0 + ht / 2 - 0.02, 0).box(0.14, 0.03, Math.min(0.6, wide * 0.4), 0.006); p.shade(null);
  }
  // rail along the edge of the upper deck, with a gap at the head of each ladder
  if (ht > 0.4) {
    const yr = (z) => y1 + cam(z) + 0.005, xr = H.x(s, y1) + dir * 0.0, e = zt - 0.02, rh = Math.min(0.42, hi.bul);
    const gaps = stairs ? (twoLadders ? [[-lz - lw / 2 - 0.03, -lz + lw / 2 + 0.03], [lz - lw / 2 - 0.03, lz + lw / 2 + 0.03]] : [[lz - lw / 2 - 0.03, lz + lw / 2 + 0.03]]) : [];
    const cuts = [-e, ...gaps.flat(), e];
    for (let i = 0; i < cuts.length - 1; i += 2) if (cuts[i + 1] - cuts[i] > 0.1) balustrade(p, [xr, yr(cuts[i]), cuts[i]], [xr, yr(cuts[i + 1]), cuts[i + 1]], rh, st.balCol || C.rail);
  }
}

// ---------- guns ----------
const GUN_PROFILE = [[0, -0.66], [0.38, -0.63], [0.3, -0.585], [0.9, -0.55], [1, -0.5], [1, -0.44], [0.92, -0.43], [0.89, -0.2], [0.98, -0.19], [0.88, -0.15], [0.8, 0.12], [0.87, 0.135], [0.78, 0.15], [0.66, 0.4], [0.83, 0.45], [0.7, 0.5], [0.42, 0.5], [0.42, 0.3]];
/** a muzzle-loading gun lying along +Z, trunnions at the origin; len overall, from = how much of the breech end to leave out (0 = whole gun) */
const GUN_FAR = [[0, -0.62], [0.95, -0.55], [0.9, -0.2], [0.86, -0.08], [0.68, 0.42], [0.82, 0.47], [0.42, 0.5]];
const GUN_MID = [[0, -0.66], [0.38, -0.63], [0.3, -0.585], [0.9, -0.55], [1, -0.47], [0.9, -0.2], [0.98, -0.19], [0.88, -0.08], [0.8, 0.12], [0.87, 0.135], [0.66, 0.4], [0.83, 0.45], [0.7, 0.5], [0.42, 0.5], [0.42, 0.3]];
function gunBarrel(p, len, r, from = -1) {
  const pr = (far ? GUN_FAR : lite ? GUN_MID : GUN_PROFILE).filter((q) => q[1] >= from).map(([rr, y]) => [rr * r, y * len]);
  if (from > -0.6) pr.unshift([0, pr[0][1]]);
  p.shade(mottle(0.25, 30)).ink(IRON, 0.42, 0.85);
  p.T2(0, 0, 0, 90).lathe(pr, 8);
  p.shade(null);
}
/** truck carriage under a gun whose trunnions are h above the deck; +Z is outboard */
function gunCarriage(p, len, r, h, col) {
  const cl = len * 0.6, z0 = -len * 0.5, wd = r * 2.5;
  const cheek = [[z0, -h + 0.045], [z0 + cl, -h + 0.045], [z0 + cl, 0.01], [z0 + cl * 0.72, 0.01], [z0 + cl * 0.72, -0.012], [z0 + cl * 0.5, -0.012], [z0 + cl * 0.5, -0.05], [z0 + cl * 0.3, -0.05], [z0 + cl * 0.3, -0.09], [z0 + cl * 0.12, -0.09], [z0 + cl * 0.12, -0.13], [z0, -0.13]];
  p.shade(grainY(0.14)).ink(col, 0.8);
  if (far) { p.T2(0, (0.01 - h + 0.045) / 2, z0 + cl * 0.5).box(wd + 0.03, h - 0.035, cl); p.shade(null); return; }
  for (const sg of [-1, 1]) p.T2((sg * wd) / 2, 0, 0, 0, -90, 0).extrude(cheek, 0.03);
  p.T2(0, -h + 0.06, z0 + cl * 0.5).box(wd, 0.025, cl * 0.92);
  p.shade(null).ink(mul(col, 0.55), 0.8);
  const tr = Math.min(0.055, h * 0.24);
  for (const z of [z0 + cl * 0.2, z0 + cl * 0.82]) {
    p.T2(0, -h + tr, z, 0, 0, 90).cyl(0.014, 0.014, wd + 0.1, 4);
    for (const sg of [-1, 1]) p.T2(sg * (wd / 2 + 0.035), -h + tr, z, 0, 0, 90).cyl(tr, tr, 0.03, 7);
  }
  p.ink(IRON, 0.5, 0.8).T2(0, 0.004, 0, 0, 0, 90).cyl(r * 0.28, r * 0.28, wd + 0.04, 6);
}

function portGeom(H, st, port) {
  const nC = st.nC;
  const lo = port.band === 'C' ? (s) => lerp(H.yS, H.yGun(s), port.rows[0] / nC) : (s) => H.yGun(s) + port.h0;
  const hi = port.band === 'C' ? (s) => lerp(H.yS, H.yGun(s), (port.rows[1] + 1) / nC) : (s) => H.yGun(s) + port.h1;
  return { lo, hi, s0: port.s - port.hw, s1: port.s + port.hw };
}
/** linings, lids and guns for every port on the starboard side */
function gunPorts(p, H, st) {
  const C = st.col, t = H.o.thick;
  const gl = st.gunLen, gr = gl * 0.088;
  for (const port of st.ports) {
    const { lo, hi, s0, s1 } = portGeom(H, st, port), s = port.s;
    const O = (ss, y) => H.pt(ss, y), I = (ss, y, dp = t) => { const n = H.nh(ss, y); return [H.x(ss, y) - n[0] * dp, y, H.z(ss, y) - n[1] * dp]; };
    const ring = (dp) => [I(s0, lo(s0), dp), I(s1, lo(s1), dp), I(s1, hi(s1), dp), I(s0, hi(s0), dp)];
    const tunnel = (r0, r1, col) => {
      p.ink(col, 0.85);
      p.poly([r0[0], r0[1], r1[1], r1[0]]); p.poly([r0[3], r1[3], r1[2], r0[2]]);
      p.poly([r0[0], r1[0], r1[3], r0[3]]); p.poly([r0[1], r0[2], r1[2], r1[1]]);
    };
    const lining = port.open ? C.inner : mix(C.inner, RED, 0.5);
    p.shade(null);
    tunnel(ring(0), ring(t), lining);
    if (!port.open) { const back = ring(0.2); tunnel(ring(t), back, PITCH); p.ink(PITCH, 1).poly(back); }
    const yc = (lo(s) + hi(s)) / 2, hgt = hi(s) - lo(s), n = H.nh(s, yc), o = H.pt(s, yc);
    // the lid, triced up on its lanyard
    {
      p.push(H.frame(s, hi(s) + 0.004, 0.006)); p.push(X(0, 0, 0, -(96 + 14 * hash1(port.s * 977)), 0, 0));
      const lw = port.w - 0.012, lh = hgt - 0.012;
      p.ink(mul(port.band === 'C' ? (st.chequer ? C.wale : C.hull) : st.rowD(port.rows[0], H.seg(s), false).col(), 0.9), 0.82).T(0, -lh / 2, 0.012).box(lw, lh, 0.024);
      p.ink(RED, 0.8).T(0, -lh / 2, -0.003).box(lw - 0.03, lh - 0.03, 0.008);
      if (!lite) {
        p.ink(IRON, 0.5, 0.8);
        for (const sg of [-1, 1]) p.T(sg * lw * 0.28, -lh * 0.45, 0.026).box(0.02, lh * 0.9, 0.006);
        p.T(0, -lh * 0.8, 0.03).sphere(0.012, 5, 3);
      }
      p.pop(); p.pop();
    }
    // the gun: run out through the port
    const G = frame([o[0], yc - hgt * 0.06, o[2]], [n[1], 0, -n[0]], [0, 1, 0]);
    p.push(G);
    if (port.open) {
      const deckY = H.deckY(s, o[2] - 0.3, H.seg(s)), h = yc - hgt * 0.06 - deckY;
      p.push(X(0, 0, -gl * 0.5 + st.gunOut));
      gunBarrel(p, gl, gr);
      gunCarriage(p, gl, gr, h, st.kind === 'manowar' || st.kind === 'frigate' ? hex(0x8a2f22) : mul(OAK, 0.9));
      // breeching rope from the bulwark round the cascabel
      p.ink(HEMP, 0.95);
      const zb = gl * 0.5 - st.gunOut - t - 0.02;
      if (!lite) for (const sg of [-1, 1]) p.tube([[sg * (port.w / 2 + 0.07), -0.02, zb], [sg * gr * 2.2, -0.07, zb - gl * 0.5], [sg * gr * 0.6, 0, -gl * 0.6]], 0.011, 5);
      p.pop();
    } else {
      p.push(X(0, 0, -gl * 0.5 + st.gunOut)); gunBarrel(p, gl, gr, -0.1); p.pop();
    }
    p.pop();
  }
}

// ---------- stern works ----------
/** a stern lantern standing on the origin: iron cage, horn panes lit from within, a little spire */
function lantern(p, h, col = BRASS) {
  const r = h * 0.2;
  if (far) {
    p.ink(LAMP, 0.3, 0, 1.15).T2(0, h * 0.2, 0).lathe([[r * 0.5, 0], [r * 0.9, h * 0.07], [r * 0.9, h * 0.47]], 5);
    p.ink(col, 0.35, 0.9).T2(0, h * 0.67, 0).lathe([[r * 1.0, 0], [r * 0.4, h * 0.16], [0, h * 0.33]], 5);
    return;
  }
  p.ink(IRON, 0.5, 0.8).T2(0, h * 0.1, 0).cyl(r * 0.16, r * 0.22, h * 0.2, 6, 0);
  p.ink(col, 0.35, 0.9).T2(0, h * 0.2, 0).lathe([[0, 0], [r * 0.55, 0], [r * 0.9, h * 0.05], [r * 0.9, h * 0.07], [0, h * 0.07]], 8);
  p.ink(LAMP, 0.3, 0, 1.15).T2(0, h * 0.27, 0).lathe([[r * 0.74, 0], [r * 0.86, h * 0.34], [r * 0.74, h * 0.4]], 6);
  p.ink(col, 0.35, 0.9);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; p.T2(Math.cos(a) * r * 0.84, h * 0.47, Math.sin(a) * r * 0.84, 0, -a / DEG, 0).box(0.012 * (h / 0.3), h * 0.42, 0.012 * (h / 0.3)); }
  p.T2(0, h * 0.67, 0).lathe([[r * 0.95, 0], [r * 1.02, h * 0.02], [r * 0.5, h * 0.14], [r * 0.16, h * 0.2], [r * 0.2, h * 0.24], [r * 0.06, h * 0.27], [0, h * 0.33]], 8);
}
/** a carved scroll: a gilt volute coiling in the local XY plane about the origin */
function scroll(p, R, r, turns = 1.6, col = GILT) {
  const pts = [], rad = [], n = Math.round(turns * (far ? 5 : lite ? 7 : 9));
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * TAU, rr = R * (1 - 0.82 * t); pts.push([Math.cos(a) * rr, Math.sin(a) * rr, 0]); rad.push(r * (1 - 0.55 * t)); }
  p.ink(col, 0.38, 0.85).tube(pts, rad, 4, 1);
}
/** a gilt rosette / sun boss facing +Z */
function boss(p, R, col = GILT) {
  p.ink(col, 0.36, 0.85).T2(0, 0, 0, 90).lathe([[0, 0], [R, 0], [R, R * 0.12], [R * 0.72, R * 0.2], [R * 0.6, R * 0.12], [R * 0.4, R * 0.34], [0, R * 0.42]], 12);
}

function sternWorks(p, H, st) {
  const sn = st.stern;
  if (!sn) return;
  const C = st.col, r = H.o.rakeA, yg = H.yGun(0), U = norm3([-r, 1, 0]), sl = Math.hypot(1, r), g0 = H.segs[0];
  const TS = (y) => frame([H.x(0, y), y, 0], [0, 0, 1], U);          // on the raked transom: X across, Y up it, Z aft
  const TV = (y, dx = 0) => frame([H.x(0, y) + dx, y, 0], [0, 0, 1], [0, 1, 0]);  // plumb: X across, Y up, Z aft
  const zAt = (y) => H.z(0, y);
  const trim = sn.trim || C.trim, trimPbr = sn.trim ? [0.7, 0] : [0.38, 0.85];
  for (const [ya, yb, nWin] of sn.tiers || []) {
    const yA = yg + ya, yB = yg + yb, h = (yB - yA) * sl, W = 2 * Math.min(zAt(yA), zAt(yB)) - 0.1;
    p.push(TS(yA));
    p.shade(null).ink(trim, ...trimPbr);
    p.T(0, -0.022, 0.014).box(W + 0.12, 0.04, 0.05, 0.008);
    p.T(0, h + 0.022, 0.018).box(W + 0.16, 0.045, 0.06, 0.01);
    const n = nWin || Math.max(2, Math.round(W / 0.3)), pitch = W / n;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (i + 0.5) * pitch;
      p.push(X(x, h * 0.1, 0)); windowLight(p, pitch * 0.64, h * 0.78, sn.frame || C.trim, { metal: sn.frame ? 0 : 0.6, glow: 0.3 }); p.pop();
    }
    p.ink(sn.pilaster || C.accent, 0.7);
    for (let i = 0; i <= n; i++) { const x = -W / 2 + i * pitch; p.T(x, h / 2, 0.012).box(pitch * 0.16, h, 0.03); p.T(x, h * 0.93, 0.02).box(pitch * 0.22, h * 0.07, 0.04); }
    p.pop();
  }
  // a carved badge on the upper stern
  if (sn.badge) {
    const y = yg + sn.badge, W = 2 * zAt(y);
    p.push(TS(y));
    p.shade(null).ink(trim, ...trimPbr).T(0, -0.09, 0.012).box(W * 0.94, 0.022, 0.03, 0.006); p.T(0, 0.09, 0.012).box(W * 0.94, 0.022, 0.03, 0.006);
    p.push(X(0, 0, 0.014)); boss(p, 0.06, C.trim); p.pop();
    if (!far) for (const sg of [-1, 1]) { p.push(X(sg * 0.2, 0, 0.018, 0, 0, 0, sg, 1, 1)); scroll(p, 0.055, 0.013, 1.5, C.trim); p.pop(); p.push(X(sg * Math.min(W * 0.36, 0.5), 0, 0.018, 0, 0, 0, -sg, 1, 1)); scroll(p, 0.04, 0.011, 1.3, C.trim); p.pop(); }
    p.pop();
  }
  // open gallery: a walk across the stern with a balustrade
  if (sn.balcony !== undefined) {
    const y = yg + sn.balcony, W = 2 * zAt(y) + 0.06, dp = 0.24;
    p.push(TV(y));
    p.shade(grainX(0.12)).ink(C.rail, 0.8).T(0, -0.02, dp / 2 - 0.02).box(W, 0.04, dp + 0.04, 0.008);
    p.shade(null).ink(trim, ...trimPbr).T(0, -0.05, dp).box(W + 0.02, 0.03, 0.03, 0.006);
    for (let i = 0; i < 5; i++) { const x = lerp(-W / 2 + 0.08, W / 2 - 0.08, i / 4); p.ink(C.rail, 0.8).T(x, -0.04, 0, 0, -90, 0).extrude([[0, 0], [dp - 0.03, 0], [0, -0.16]], 0.035); }
    balustrade(p, [-W / 2 + 0.02, 0, dp - 0.03], [W / 2 - 0.02, 0, dp - 0.03], 0.34, sn.balCol || WHITE, { pitch: 0.1 });
    for (const sg of [-1, 1]) balustrade(p, [sg * (W / 2 - 0.02), 0, 0.02], [sg * (W / 2 - 0.02), 0, dp - 0.03], 0.34, sn.balCol || WHITE, { pitch: 0.1, noPosts: true });
    p.pop();
  }
  // taffrail: a carved board arching over the stern
  const top = H.railY(0, g0), zt = zAt(top);
  if (sn.arch) {
    const ah = sn.arch, out = [[-zt - 0.02, 0], [zt + 0.02, 0]];
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI; out.push([Math.cos(a) * (zt + 0.02), 0.045 + Math.pow(Math.sin(a), 0.8) * ah]); }
    p.push(TV(top + st.capH - 0.004, H.o.thick / 2));
    p.shade(null).ink(C.upper, 0.75).extrude(out, 0.06);
    const edge = [];
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI; edge.push([Math.cos(a) * (zt + 0.02), 0.045 + Math.pow(Math.sin(a), 0.8) * ah, 0]); }
    p.ink(trim, ...trimPbr).tube(edge, 0.022, 5, 1);
    p.push(X(0, 0.03 + ah * 0.48, 0.03)); boss(p, ah * 0.3, C.trim); p.pop();
    if (!far) for (const sg of [-1, 1]) { p.push(X(sg * zt * 0.5, 0.04 + ah * 0.33, 0.034, 0, 0, 0, sg, 1, 1)); scroll(p, ah * 0.22, 0.016, 1.5, C.trim); p.pop(); }
    const lp = sn.lanterns === 3 ? [[0, 1], [-0.66, 0.78], [0.66, 0.78]] : sn.lanterns ? [[0, 1]] : [];
    for (const [f, k] of lp) {
      const x = f * zt, y = 0.045 + Math.pow(Math.cos(Math.asin(clamp(Math.abs(f), 0, 1))), 0.8) * ah, lh = sn.lanternH * k;
      p.ink(IRON, 0.5, 0.8).tube([[x, y - 0.02, 0], [x, y + 0.06, 0.03], [x, y + 0.1, 0.1], [x, y + 0.16, 0.13]], 0.012, 5);
      p.push(X(x, y + 0.15, 0.13)); lantern(p, lh); p.pop();
    }
    p.pop();
  } else if (sn.lanterns) {
    p.push(TV(top + st.capH, 0));
    p.ink(IRON, 0.5, 0.8).tube([[0, -0.03, 0], [0, 0.12, 0.02], [0, 0.2, 0.08]], 0.011, 5);
    p.push(X(0, 0.19, 0.08)); lantern(p, sn.lanternH); p.pop();
    p.pop();
  }
  // carved quarter pieces down the corners of the stern
  if (sn.quarterPieces) bothSides(p, () => {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const y = lerp(yg + sn.quarterPieces[0], yg + sn.quarterPieces[1], i / 8); pts.push([H.x(0, y) - 0.012, y, zAt(y) + 0.004]); }
    p.ink(trim, ...trimPbr).tube(pts, 0.024, 6, 1);
  });
  // quarter galleries: glazed bays swelling out of each quarter
  if (sn.quarter) bothSides(p, () => {
    const [qa, qb, len, dep] = sn.quarter, sC = len / H.L * 0.55, yA = yg + qa, yB = yg + qb, h = yB - yA;
    p.push(H.frame(sC, yA, -0.01)); p.push(X(0, 0, 0, 0, 0, 0, len / (2 * dep), 1, 1));
    const body = (prof, col, ro = 0.75, me = 0, gl = 0) => p.ink(col, ro, me, gl).lathe(prof.map(([rr, y]) => [rr * dep, y]), 10, Math.PI, 0);
    p.shade(null);
    body([[0, -0.3], [0.2, -0.24], [0.5, -0.12], [0.86, -0.03], [0.98, 0]], C.upper);
    body([[0.98, 0], [1.06, 0.012], [1.06, 0.04], [0.98, 0.05]], trim, ...trimPbr);
    const wz = sn.quarterTiers || [[0.1, h - 0.08]];
    let y = 0.05;
    for (const [wa, wb] of wz) {
      body([[0.98, y], [0.97, wa]], C.upper);
      body([[0.955, wa], [0.94, wb]], GLASS, 0.14, 0.55, 0.28);
      p.ink(sn.frame || C.trim, 0.5, sn.frame ? 0 : 0.6);
      for (let i = 0; i <= 6; i += far ? 2 : 1) { const a = (i / 6) * Math.PI; p.T(Math.cos(a) * dep * 0.955, (wa + wb) / 2, Math.sin(a) * dep * 0.955, 0, -a / DEG, 0).box(0.018, wb - wa, 0.012 * (2 * dep / len) + 0.012); }
      body([[0.95, (wa + wb) / 2 - 0.006], [0.965, (wa + wb) / 2], [0.95, (wa + wb) / 2 + 0.006]], sn.frame || C.trim, 0.5, sn.frame ? 0 : 0.6);
      body([[0.97, wb], [1.04, wb + 0.012], [1.04, wb + 0.035], [0.97, wb + 0.045]], trim, ...trimPbr);
      y = wb + 0.045;
    }
    body([[0.97, y], [0.98, h]], C.upper);
    body([[0.98, h], [1.08, h + 0.015], [1.08, h + 0.04], [0.96, h + 0.05]], trim, ...trimPbr);
    body([[0.96, h + 0.05], [0.8, h + 0.13], [0.5, h + 0.2], [0.16, h + 0.24], [0, h + 0.25]], sn.roof || hex(0x3a3d46), 0.6, 0.2);
    p.pop(); p.pop();
  });
}

// ---------- the head: knee, rails and figurehead ----------
const sculptCache = new Map();
function sculpted(name, make, res, tier = 0) {
  const key = `${name}|${tier}`;
  if (!sculptCache.has(key)) sculptCache.set(key, buildPartGeometry(make(), { res: res * TIERS[tier].fig, ao: 0.8, lod: tier }));
  return sculptCache.get(key);
}
// Figureheads face +Z (X across), then are turned to face the bow. The flesh is sculpted;
// horns, fins, crest, crown and teeth are crisp hard pieces set into it.
const GILD = 0xd9a83a, GILD_HI = 0xf0cf6a;
/** a flat carved plate from an outline in the (z, y) plane, standing in the fore-and-aft plane */
const plateZY = (outline, thick) => HP.extrude(outline, thick, 0.003).rot(0, -90, 0);
/** a crowned sea-drake rearing out of the stem: the ship of the line's figurehead */
function drakeFigure() {
  const g = (pr) => pr.color(GILD).pbr(0.32, 0.92);
  const prims = [
    ...S.limb([[0, -0.22, -0.3], [0, -0.03, -0.07], [0, 0.2, 0.09], [0, 0.42, 0.07], [0, 0.58, 0.15]], [0.12, 0.11, 0.09, 0.075, 0.07]).map((c) => g(c).blend(0.05).tint(0.2, 24)),
    g(S.ellipsoid(0.12, 0.15, 0.12)).at(0, 0.0, -0.03).blend(0.06),                                             // breast
    g(S.ellipsoid(0.088, 0.078, 0.12)).at(0, 0.63, 0.25).blend(0.035),                                          // skull
    g(S.capsule([0, 0.64, 0.32], [0, 0.61, 0.52], 0.058, 0.04)).blend(0.03),                                    // upper jaw
    g(S.capsule([0, 0.565, 0.27], [0, 0.49, 0.46], 0.036, 0.022)).blend(0.012),                                 // lower jaw, open
    S.ellipsoid(0.028, 0.012, 0.075).rot(22, 0, 0).at(0, 0.538, 0.39).color(0x9c2f22).pbr(0.6).blend(0.004),     // tongue
    ...S.mirrorX([
      g(S.capsule([0.036, 0.7, 0.29], [0.052, 0.69, 0.41], 0.024, 0.015)).blend(0.015),                          // brow
      S.sphere(0.032).at(0.068, 0.668, 0.365).cut(0.01),                                                         // eye socket
      S.sphere(0.012).at(0.03, 0.635, 0.535).cut(0.006),                                                         // nostril
      g(S.ellipsoid(0.03, 0.045, 0.06)).at(0.07, 0.6, 0.24).blend(0.03),                                         // cheek
    ]),
    // belly plates: raised bands across the throat
    ...[[0.0, 0.1], [0.09, 0.135], [0.18, 0.17], [0.27, 0.165], [0.36, 0.15], [0.45, 0.155]].map(([y, z]) => S.ellipsoid(0.075, 0.032, 0.04).at(0, y, z).color(GILD_HI).pbr(0.3, 0.92).paint(0.012, 0.012)),
  ];
  const hard = [];
  hard.push(...HP.mirrorX([
    HP.sphere(0.018, 12).color(0xff5a2a).pbr(0.25).glow(0.7).at(0.062, 0.668, 0.368),
    HP.tube([[0.045, 0.69, 0.2], [0.09, 0.79, 0.1], [0.105, 0.86, -0.03], [0.09, 0.885, -0.15]], [0.026, 0.019, 0.011, 0.003], 12, 7).color(0xf4e6b8).pbr(0.4, 0.3),
    // cheek fins and the great fins swept back along the bow
    plateZY([[0, 0], [-0.12, 0.09], [-0.085, 0.02], [-0.15, 0.0], [-0.08, -0.03], [-0.11, -0.09], [0, -0.05]], 0.012).rot(0, 28, 0).at(0.082, 0.62, 0.2).color(GILD_HI).pbr(0.32, 0.92),
    plateZY([[0.02, -0.06], [0.0, 0.1], [-0.2, 0.3], [-0.2, 0.17], [-0.34, 0.2], [-0.27, 0.08], [-0.4, 0.04], [-0.27, -0.03], [-0.34, -0.12], [-0.14, -0.1]], 0.014).rot(0, 20, 0).at(0.115, 0.1, -0.06).color(GILD).pbr(0.32, 0.92),
    ...[[-0.2, 0.3], [-0.34, 0.2], [-0.4, 0.04], [-0.34, -0.12]].map(([z, y]) => HP.tube([[0, 0.02, 0], [0, y * 0.55, z * 0.55], [0, y, z]], [0.014, 0.01, 0.004], 6, 5).rot(0, 20, 0).at(0.124, 0.1, -0.06).color(GILD_HI).pbr(0.3, 0.92)),
  ]));
  // crest of spines down the nape
  { const base = [[0.16, 0.74], [0.08, 0.67], [0.01, 0.56], [-0.02, 0.44], [-0.02, 0.32], [-0.07, 0.2], [-0.16, 0.08], [-0.27, -0.02]], out = [];
    for (let i = 0; i < base.length - 1; i++) { const a2 = base[i], b2 = base[i + 1], nx = -(b2[1] - a2[1]), ny = b2[0] - a2[0], l = Math.hypot(nx, ny), h = 0.075 - i * 0.004; out.push(a2, [(a2[0] + b2[0]) / 2 - (nx / l) * h + 0.02, (a2[1] + b2[1]) / 2 - (ny / l) * h + 0.03]); }
    out.push(base[base.length - 1]);
    for (let i = base.length - 1; i >= 0; i--) out.push([base[i][0] + 0.03, base[i][1] - 0.012]);
    hard.push(plateZY(out, 0.012).color(GILD_HI).pbr(0.32, 0.92)); }
  // the crown
  hard.push(HP.torus(0.062, 0.012, 16, 6).rot(90, 0, 0).rot(-12, 0, 0).at(0, 0.722, 0.24).color(GILD_HI).pbr(0.28, 0.95));
  for (let i = 0; i < 6; i++) { const a2 = (i / 6) * TAU; hard.push(HP.cone(0.015, 0.055, 6).color(GILD_HI).pbr(0.28, 0.95).at(Math.cos(a2) * 0.062, 0.034, Math.sin(a2) * 0.062).rot(-12, 0, 0).at(0, 0.722, 0.24)); hard.push(HP.sphere(0.008, 6).color(i % 2 ? 0xb3261e : 0x2f6fb5).pbr(0.2).glow(0.2).at(Math.cos(a2 + 0.52) * 0.064, 0.004, Math.sin(a2 + 0.52) * 0.064).rot(-12, 0, 0).at(0, 0.722, 0.24).lod(0)); }
  for (let i = 0; i < 5; i++) for (const up of [1, -1]) hard.push(HP.cone(0.007, 0.024, 5).color(0xf4eedc).pbr(0.3).rot(up > 0 ? 180 : 0, 0, 0).at((i - 2) * 0.014, up > 0 ? 0.6 : 0.51, 0.43 + (2 - Math.abs(i - 2)) * 0.022 - (up > 0 ? 0 : 0.02)).lod(0));
  return { prims, hard };
}
/** a ram's head with curling ridged horns over a fleeced breast: the galleon's beak */
function ramFigure() {
  const g = (pr) => pr.color(GILD).pbr(0.32, 0.92), fleece = (pr) => pr.color(0xb9862a).pbr(0.48, 0.8).bump(0.024, 10, 'scales').tint(0.22, 16);   // the fleece is gilt too, a deeper gold cut into tight curls, so the head reads as one carving
  const prims = [
    fleece(S.capsule([0, -0.14, -0.36], [0, 0.08, 0.04], 0.15, 0.12)).blend(0.04),
    fleece(S.ellipsoid(0.15, 0.14, 0.11)).at(0, 0.0, 0.03).blend(0.05),
    fleece(S.ellipsoid(0.1, 0.07, 0.09)).at(0, 0.27, 0.1).blend(0.04),                                          // poll
    g(S.ellipsoid(0.08, 0.088, 0.105)).at(0, 0.2, 0.18).blend(0.03),                                            // skull
    g(S.capsule([0, 0.205, 0.23], [0, 0.128, 0.375], 0.066, 0.05)).blend(0.03),                                 // muzzle, with a ram's arched nose
    g(S.ellipsoid(0.05, 0.03, 0.06)).rot(-28, 0, 0).at(0, 0.215, 0.3).blend(0.025),
    g(S.ellipsoid(0.036, 0.02, 0.028)).at(0, 0.104, 0.408).color(0x3a2a1c).pbr(0.6).paint(0.006),               // nose
    g(S.capsule([0, 0.262, 0.16], [0, 0.215, 0.31], 0.03, 0.02)).blend(0.03),                                    // brow ridge
    ...S.mirrorX([
      S.sphere(0.024).at(0.062, 0.212, 0.27).cut(0.008),
      S.sphere(0.009).at(0.022, 0.116, 0.422).cut(0.004),
      g(S.ellipsoid(0.022, 0.05, 0.014)).rot(0, 0, -66).at(0.118, 0.165, 0.09).blend(0.012),                     // ear
    ]),
    S.capsule([0, 0.09, 0.33], [0, 0.078, 0.4], 0.012, 0.01).cut(0.006),                                         // mouth line
  ];
  const hornPts = [], hornRad = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14, a2 = (115 + t * 350) * DEG, r = 0.14 * (1 - 0.45 * t); hornPts.push([0.09 + 0.13 * t, 0.2 + Math.sin(a2) * r, 0.1 + Math.cos(a2) * r]); hornRad.push(0.054 * (1 - 0.8 * t)); }
  const hard = HP.mirrorX([
    HP.sphere(0.015, 12).color(0x2a1a10).pbr(0.2).at(0.058, 0.213, 0.272),
    HP.tube(hornPts, hornRad, 28, 8).color(GILD_HI).pbr(0.3, 0.92),
    ...hornPts.slice(1, 12).map((q, i) => { const n = norm3(sub3(hornPts[i + 2], hornPts[i])), yaw = Math.atan2(n[0], n[2]) / DEG, pitch = -Math.asin(n[1]) / DEG; return HP.torus(hornRad[i + 1] + 0.004, 0.006, 8, 4).rot(pitch, yaw, 0).at(q[0], q[1], q[2]).color(GILD).pbr(0.36, 0.9).lod(1); }),
  ]);
  return { prims, hard };
}

function headWorks(p, H, st) {
  const hd = st.head;
  if (!hd) return;
  const C = st.col, w = st.stemW ?? clamp(H.B * 0.035, 0.05, 0.11), yg = H.yGun(1), yTip = yg + hd.tip, d = H.d;
  const fwd = (y) => 0.04 + hd.len * Math.pow(smooth(hd.foot ?? -d * 0.3, yTip, y), hd.e ?? 1.7);
  // the knee of the head: a deep curved timber standing out from the stem
  const front = [], back = [], n = 18;
  for (let i = 0; i <= n; i++) { const y = lerp(-d - 0.04, yTip + 0.05, i / n); front.push([H.x(1, y) + fwd(y), y]); back.push([H.x(1, y) + 0.02, y]); }
  const tone = (x, y, z, nx, ny, nz, c) => mul(y < H.yP ? C.bottom : c, 0.85 + 0.25 * noise3(x * 9, y * 9, z * 9));
  p.shade(tone).ink(hd.col || C.wale, 0.85).extrude([...front, ...back.reverse()], w * 0.8, false);
  p.shade(null);
  const tip = [H.x(1, yTip) + fwd(yTip), yTip, 0];
  // trailboard: a gilt line following the curve of the knee
  if (hd.trail) for (const sg of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const y = lerp(yTip - hd.trail, yTip - 0.03, i / 10); pts.push([H.x(1, y) + fwd(y) * 0.72 + 0.02, y, sg * (w * 0.4 + 0.004)]); }
    p.ink(C.trim, 0.38, 0.85).tube(pts, 0.012, 4);
  }
  // head rails sweeping from the bow to the tip, with the timbers between them
  const railPts = (s0, y0, y1, bow, k) => { const a = H.pt(s0, y0, 0.01), b = [tip[0] - 0.06, y1, w * 0.4 + 0.02], pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10, q = lerp3(a, b, t); q[1] -= bow * Math.sin(Math.PI * t); q[2] = lerp(a[2], b[2], Math.pow(t, k)); pts.push(q); } return pts; };
  if (hd.rails) bothSides(p, () => {
    const up = railPts(hd.railS ?? 0.93, yg + hd.railY, yTip + 0.03, hd.bow ?? 0.06, 0.8), lo = hd.rails > 1 ? railPts((hd.railS ?? 0.93) + 0.025, yg + hd.railY - hd.drop, yTip - hd.drop * 0.5, 0.02, 1.1) : null;
    p.shade(null).ink(hd.railCol || C.trim, ...(hd.railCol ? [0.75, 0] : [0.38, 0.85])).tube(up, hd.railR ?? 0.022, 6, 1);
    if (lo) { p.tube(lo, (hd.railR ?? 0.022) * 0.9, 6, 1); p.ink(C.upper, 0.8); for (const t of [3, 5, 7]) p.bar(lo[t], up[t], 0.016, 0.016, 5, 0); }
  });
  if (hd.rails && hd.platform) {
    // the grating between the rails: only forward of the planking of the bow
    const L0 = railPts(hd.railS ?? 0.93, yg + hd.railY, yTip + 0.03, hd.bow ?? 0.06, 0.8).filter((q) => { const sq = H.sOf(q[0], q[1] - 0.03); return sq > 0.995 || H.z(sq, q[1] - 0.03) < q[2] * 0.6; });
    p.shade(grainX(0.14)).ink(mul(C.deck, 0.8), 0.9);
    if (L0.length > 1) p.grid(L0.length - 1, 2, (i, j, out) => { const q = L0[i]; out[0] = q[0]; out[1] = q[1] - 0.03; out[2] = q[2] * (j - 1) * 0.92; }, (i, j) => mul(C.deck, 0.62 + 0.1 * ((i + j) % 2)), true);
    p.shade(null);
  }
  // the figure itself
  if (hd.type === 'scroll') { p.push(X(tip[0] - hd.scroll * 0.75, tip[1] - hd.scroll * 0.2, 0)); p.ink(C.wale, 0.8).T(0, 0, 0, 90).cyl(hd.scroll * 0.92, hd.scroll * 0.92, w * 0.7, 14); for (const sg of [-1, 1]) { p.push(X(0, 0, sg * (w * 0.35 + 0.006), 0, 0, 0, 1, 1, sg)); scroll(p, hd.scroll, hd.scroll * 0.2, 1.7, C.trim); p.pop(); } p.pop(); }
  if (hd.type === 'drake') p.TM(X(tip[0] - 0.1, tip[1] - 0.02, 0, 0, 90, 0, hd.size)).geo(sculpted('drake', drakeFigure, 48, st.tier));
  if (hd.type === 'ram') p.TM(X(tip[0] - 0.16, tip[1] - 0.06, 0, 0, 90, 0, hd.size)).geo(sculpted('ram', ramFigure, 46, st.tier));
}

// ---------- deck furniture ----------
// Each piece is drawn about the origin, resting on y = 0, long axis fore-and-aft (X) unless noted.
function hatch(p, l, w, col, grating = true) {
  const t = 0.045, hc = 0.075;
  if (far) {
    p.shade(null).ink(mul(col, 0.8), 0.8).T(0, hc / 2, 0).box(l, hc, w);
    p.ink(grating ? mul(col, 0.42) : mul(col, 0.95), 0.9).T(0, hc + 0.003, 0).box(l - 2 * t, 0.006, w - 2 * t);
    return;
  }
  p.shade(grainX(0.12)).ink(mul(col, 0.8), 0.8);
  for (const sg of [-1, 1]) { p.T(0, hc / 2, sg * (w / 2 - t / 2)).box(l, hc, t, 0.008); p.T(sg * (l / 2 - t / 2), hc / 2, 0).box(t, hc, w - 2 * t, 0.008); }
  p.shade(null);
  if (!grating) {
    const n = Math.max(2, Math.round((w - 2 * t) / 0.1));
    for (let i = 0; i < n; i++) p.ink(vary(mul(col, 0.95), 310 + i, 0.1), 0.85).T(0, hc + 0.004, -w / 2 + t + ((i + 0.5) * (w - 2 * t)) / n).box(l - 2 * t + 0.02, 0.02, (w - 2 * t) / n - 0.006, 0.004);
    p.ink(IRON, 0.5, 0.8); for (const sg of [-1, 1]) p.T(sg * l * 0.28, hc + 0.016, 0).box(0.03, 0.008, w - 2 * t);
    return;
  }
  p.ink(PITCH, 1).T(0, 0.03, 0).box(l - 2 * t, 0.02, w - 2 * t);
  p.ink(mul(col, 0.92), 0.85);
  const nx = Math.max(3, Math.round((w - 2 * t) / 0.075)), nz = Math.max(3, Math.round((l - 2 * t) / 0.075));
  for (let i = 0; i < nx; i++) p.T(0, hc - 0.012, -w / 2 + t + ((i + 0.5) * (w - 2 * t)) / nx).box(l - 2 * t, 0.016, 0.028);
  for (let i = 0; i < nz; i++) p.T(-l / 2 + t + ((i + 0.5) * (l - 2 * t)) / nz, hc - 0.02, 0).box(0.028, 0.016, w - 2 * t);
}
function capstan(p, h, col) {
  const k = h / 0.46;
  p.shade(grainY(0.14)).ink(col, 0.8);
  p.lathe([[0, 0], [0.17 * k, 0], [0.17 * k, 0.025 * k], [0.1 * k, 0.05 * k], [0.085 * k, 0.07 * k], [0.068 * k, 0.3 * k]], 12);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; p.T(Math.cos(a) * 0.088 * k, 0.185 * k, Math.sin(a) * 0.088 * k, 0, -a / DEG, 6).box(0.05 * k, 0.24 * k, 0.034 * k); }
  p.lathe([[0.068 * k, 0.3 * k], [0.17 * k, 0.315 * k], [0.175 * k, 0.33 * k], [0.175 * k, 0.385 * k], [0.16 * k, 0.4 * k], [0, 0.41 * k]], 14);
  p.shade(null).ink(PITCH, 1);
  if (!lite) for (let i = 0; i < 8; i++) { const a = ((i + 0.5) / 8) * TAU; p.T(Math.cos(a) * 0.172 * k, 0.357 * k, Math.sin(a) * 0.172 * k, 0, -a / DEG, 0).box(0.012, 0.03 * k, 0.03 * k); }
  p.ink(IRON, 0.5, 0.8).T(0, 0.412 * k, 0).cyl(0.03 * k, 0.04 * k, 0.012, 8);
}
/** the ship's wheel on its standards; the helmsman stands aft (-X) of it. dbl = a second wheel forward */
function shipWheel(p, R, col, dbl = false) {
  const hA = R + 0.3;
  p.shade(grainY(0.14)).ink(col, 0.75);
  for (const sg of [-1, 1]) { p.T(sg * 0.09, hA / 2, 0).box(0.035, hA + 0.03, 0.12, 0.008); p.T(sg * 0.09, 0.015, 0).box(0.07, 0.03, 0.24); }
  p.T(0, hA, 0, 0, 0, 90).cyl(0.055, 0.055, 0.15, 10);
  p.shade(null).ink(HEMP, 0.95);
  for (let i = -1; i <= 1; i++) p.T(i * 0.03, hA, 0, 0, 0, 90).lathe([[0.056, -0.014], [0.064, 0], [0.056, 0.014]], 8);
  for (const x of dbl ? [-0.15, 0.15] : [-0.15]) {
    p.push(X(x, hA, 0, 0, 0, -90));
    p.shade(grainY(0.1)).ink(mul(col, 0.9), 0.6);
    p.lathe([[R - 0.02, -0.014], [R + 0.016, -0.014], [R + 0.016, 0.014], [R - 0.02, 0.014], [R - 0.02, -0.014]], 16);
    p.lathe([[0, -0.03], [0.045, -0.03], [0.05, 0], [0.045, 0.03], [0, 0.03]], 10);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, c = Math.cos(a), sn = Math.sin(a);
      p.bar([c * 0.04, 0, sn * 0.04], [c * (R - 0.02), 0, sn * (R - 0.02)], 0.011, 0.009, 4, 0);
      p.bar([c * (R + 0.016), 0, sn * (R + 0.016)], [c * (R + 0.085), 0, sn * (R + 0.085)], 0.011, 0.014, 4, 1);
    }
    p.shade(null).ink(BRASS, 0.35, 0.9).T(0, x < 0 ? -0.034 : 0.034, 0).cyl(0.02, 0.02, 0.012, 8);
    p.pop();
  }
}
function binnacle(p, col) {
  p.shade(grainY(0.12)).ink(col, 0.75).T(0, 0.15, 0).box(0.14, 0.3, 0.26, 0.01);
  p.shade(null).ink(GLASS, 0.15, 0.5, 0.25).T(-0.071, 0.21, 0).box(0.006, 0.08, 0.16);
  p.ink(BRASS, 0.35, 0.9).T(0, 0.3, 0).lathe([[0.07, 0], [0.065, 0.02], [0.04, 0.05], [0.012, 0.062], [0, 0.075]], 10);
}
function barrel(p, r, h, col, seed = 0) {
  const pr = [[0, 0.012], [r * 0.74, 0.012], [r * 0.78, 0], [r * 0.93, h * 0.22], [r, h * 0.5], [r * 0.93, h * 0.78], [r * 0.78, h], [r * 0.74, h - 0.012], [0, h - 0.012]];
  p.shade((x, y, z, nx, ny, nz, c) => mul(c, 0.82 + 0.3 * noise3(Math.atan2(nz, nx) * 4.2 + seed, seed * 3.1, 0.5))).ink(col, 0.8).lathe(pr, 10);
  p.shade(null).ink(IRON, 0.5, 0.75);
  if (!far) for (const f of [0.12, 0.32, 0.68, 0.88]) { const rr = r * (0.78 + 0.22 * Math.sin(Math.PI * f)) + 0.004; p.T(0, h * f, 0).lathe([[rr - 0.003, -0.012], [rr, 0.012]], 10); }
}
function crate(p, w, h, d, col, seed = 0) {
  p.shade(grainX(0.2, 2)).ink(vary(col, seed, 0.12), 0.88).T(0, h / 2, 0).box(w - 0.016, h - 0.016, d - 0.016, 0.004);
  if (far) { p.shade(null); return; }
  p.ink(mul(col, 0.72), 0.88);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.T(sx * (w / 2 - 0.016), h / 2, sz * (d / 2 - 0.016)).box(0.032, h, 0.032);
  for (const sy of [0.016, h - 0.016]) { for (const sz of [-1, 1]) p.T(0, sy, sz * (d / 2 - 0.012)).box(w, 0.032, 0.024); for (const sx of [-1, 1]) p.T(sx * (w / 2 - 0.012), sy, 0).box(0.024, 0.032, d); }
  p.shade(null);
}
/** rope coiled down flat on deck */
function coil(p, R, turns = 3, r = 0.016, col = HEMP) {
  if (lite) return;
  const pts = [], n = turns * 10;
  for (let i = 0; i <= n; i++) { const t = i / n, a = t * turns * TAU, rr = R * (1 - 0.6 * t); pts.push([Math.cos(a) * rr, r + t * r * 1.2, Math.sin(a) * rr]); }
  p.shade(null).ink(col, 0.95).tube(pts, r, 4, 1);
}
/** two stout posts and a cross-piece for making cables fast; across the ship */
function bitts(p, w, h, col) {
  p.shade(grainY(0.14)).ink(col, 0.82);
  for (const sg of [-1, 1]) p.T(0, h / 2, (sg * w) / 2).box(0.075, h, 0.075, 0.012);
  p.T(-0.045, h * 0.62, 0).box(0.06, 0.07, w + 0.2, 0.012);
  p.shade(null);
}
const PIN = [[0.006, -0.04], [0.006, 0.006], [0.012, 0.014], [0.009, 0.052], [0, 0.06]];
/** a pin rail of length l along X with belaying pins and a few coils hung on them */
function pinRail(p, l, col, n = Math.max(2, Math.round(l / 0.12)), ropes = true) {
  if (lite) { n = far ? 0 : Math.min(n, 2); ropes = false; }
  p.shade(grainX(0.12)).ink(col, 0.8).box(l, 0.03, 0.06);
  p.shade(null);
  for (let i = 0; i < n; i++) {
    const x = -l / 2 + ((i + 0.5) * l) / n;
    p.ink(mul(SPAR, 1.1), 0.7).T(x, 0.016, 0).lathe(PIN, 3);
    if (ropes && hash1(i * 7 + Math.round(l * 100)) > 0.4) { p.ink(HEMP, 0.95).T(x, -0.075, 0.0, 0, 0, 0).lathe([[0.016, -0.06], [0.027, -0.05], [0.027, 0.04], [0.016, 0.06]], 4); }
  }
}
/** a U-shaped fife rail on turned posts, open aft, around the foot of a mast at the origin */
function fifeRail(p, w, col) {
  const d = w * 0.7, h = 0.3;
  p.shade(null).ink(col, 0.78);
  for (const [x, z] of [[d, w / 2], [d, -w / 2], [-d * 0.2, w / 2], [-d * 0.2, -w / 2]]) { p.T(x, h / 2, z).box(0.045, h, 0.045, 0.008); }
  p.push(X(d, h + 0.015, 0, 0, 90, 0)); pinRail(p, w + 0.06, col, Math.round(w / 0.11)); p.pop();
  for (const sg of [-1, 1]) { p.push(X(d * 0.4, h + 0.015, (sg * w) / 2)); pinRail(p, d * 1.26, col, 2); p.pop(); }
}
/** a glazed skylight with a pitched top over the cabin */
function skylight(p, l, w, col) {
  const hb = 0.11, hr = 0.1;
  p.shade(grainX(0.12)).ink(col, 0.78).T(0, hb / 2, 0).box(l, hb, w, 0.008);
  p.shade(null);
  for (const sg of [-1, 1]) {
    const a = Math.atan2(hr, w / 2) / DEG, sl = Math.hypot(hr, w / 2);
    p.push(X(0, hb + hr / 2, (sg * w) / 4, sg * a, 0, 0));
    p.ink(GLASS, 0.14, 0.55, 0.25).box(l - 0.03, 0.008, sl - 0.01);
    p.ink(col, 0.78);
    const n = Math.max(2, Math.round(l / 0.13));
    for (let i = 0; i <= n; i++) p.T(-l / 2 + 0.012 + (i * (l - 0.024)) / n, 0.004, 0).box(0.022, 0.016, sl);
    p.T(0, 0.004, (-sg * sl) / 2 + sg * 0.008).box(l, 0.016, 0.02); p.T(0, 0.004, (sg * sl) / 2).box(l, 0.02, 0.024);
    p.ink(BRASS, 0.4, 0.9); for (let i = 0; i < 3; i++) p.T(0, 0.016, -sl * 0.3 + i * sl * 0.3).box(l - 0.04, 0.005, 0.005);
    p.pop();
  }
  p.ink(col, 0.78);
  for (const sg of [-1, 1]) p.T((sg * (l - 0.02)) / 2, hb, 0, 0, 90, 0).extrude([[-w / 2, 0], [w / 2, 0], [0, hr]], 0.02);
}
/** a companion: the little house over the ladder to the cabin, sliding hatch on top, doors facing aft */
function companion(p, l, w, h, col) {
  p.shade(grainX(0.12)).ink(col, 0.78).T(0, h / 2, 0).box(l, h, w, 0.01);
  p.ink(mul(col, 0.8), 0.78).T(0.03, h + 0.014, 0).box(l * 0.86, 0.028, w + 0.03, 0.008);
  p.T(l * 0.25, h + 0.034, 0).box(l * 0.6, 0.02, w - 0.06, 0.006);
  p.shade(null);
  p.push(X(-l / 2, 0.02, 0, 0, -90, 0)); door(p, w * 0.62, h - 0.06, mul(col, 0.85), { seed: 5 }); p.pop();
  for (const sg of [-1, 1]) { p.push(X(0, h * 0.5, (sg * w) / 2, 0, sg > 0 ? 0 : 180, 0)); p.ink(BRASS, 0.4, 0.9).T(0, 0, 0.004, 90).lathe([[0.045, 0], [0.05, 0.008], [0.036, 0.012], [0.036, 0.004]], 10); p.ink(GLASS, 0.14, 0.55, 0.25).T(0, 0, 0.007).cyl(0.036, 0.036, 0.004, 10); p.pop(); }
}
/** a low deckhouse with a row of small lights down each side and a planked top */
function deckhouse(p, l, w, h, col, roofCol) {
  p.shade(grainX(0.12)).ink(col, 0.8).T(0, h / 2, 0).box(l, h, w, 0.01);
  p.shade(null);
  const n = Math.max(1, Math.round(l / 0.3));
  for (const sg of [-1, 1]) for (let i = 0; i < n; i++) { p.push(X(-l / 2 + ((i + 0.5) * l) / n, h * 0.36, (sg * w) / 2, 0, sg > 0 ? 0 : 180, 0)); windowLight(p, Math.min(0.16, (l / n) * 0.6), h * 0.36, WHITE, { nx: 2, ny: 1, fr: 0.014 }); p.pop(); }
  const np = Math.max(3, Math.round(w / 0.1));
  for (let i = 0; i < np; i++) { const z = -w / 2 - 0.02 + ((i + 0.5) * (w + 0.04)) / np, cam = 0.03 * (1 - Math.pow(z / (w / 2), 2)); p.ink(vary(roofCol, 620 + i, 0.08), 0.85).T(0, h + 0.012 + cam, z, (-z / (w / 2)) * 4, 0, 0).box(l + 0.06, 0.024, (w + 0.04) / np - 0.005, 0.005); }
}
/** an iron anchor with a wooden stock, hanging by its ring from the origin; overall length len */
function anchor(p, len) {
  const k = len / 0.6;
  p.shade(mottle(0.3, 26)).ink(IRON, 0.55, 0.8);
  if (far) {
    p.T(0, -0.33 * k, 0).box(0.03 * k, 0.56 * k, 0.03 * k);
    p.T(0, -0.52 * k, 0).box(0.36 * k, 0.04 * k, 0.03 * k);
    p.shade(null).ink(mul(OAK, 0.75), 0.85).T(0, -0.1 * k, 0).box(0.05 * k, 0.05 * k, 0.5 * k);
    return;
  }
  p.T(0, -0.035 * k, 0, 90).lathe([[0.03 * k, -0.008 * k], [0.04 * k, 0], [0.03 * k, 0.008 * k], [0.03 * k, -0.008 * k]], 7);
  p.T(0, -0.33 * k, 0).box(0.03 * k, 0.56 * k, 0.03 * k, 0.006);
  const arm = [];
  for (let i = 0; i <= 10; i++) { const a = (-150 + i * 12) * DEG; arm.push([Math.cos(a) * 0.19 * k, -0.47 * k + Math.sin(a) * 0.17 * k * 1.0 + 0.03 * k, 0]); }
  p.tube(arm, arm.map((q, i) => (0.012 + 0.008 * Math.sin((Math.PI * i) / 10)) * k), 5, 1);
  for (const sg of [-1, 1]) { const e = arm[sg < 0 ? 0 : 10]; p.T(e[0] + sg * 0.005 * k, e[1] + 0.02 * k, 0, 0, 0, sg * 30).extrude([[-0.045 * k, 0], [0.045 * k, 0], [0, 0.085 * k]], 0.012 * k); }
  p.shade(grainX(0.16)).ink(mul(OAK, 0.75), 0.85).T(0, -0.1 * k, 0).box(0.05 * k, 0.05 * k, 0.5 * k, 0.01);
  p.shade(null).ink(IRON, 0.5, 0.8);
  for (const sg of [-1, 1]) p.T(0, -0.1 * k, sg * 0.14 * k).box(0.056 * k, 0.056 * k, 0.02 * k);
}
/** the ship's bell in its belfry, athwartships */
function belfry(p, col) {
  p.shade(grainY(0.12)).ink(col, 0.78);
  for (const sg of [-1, 1]) p.T(0, 0.21, sg * 0.11).box(0.05, 0.42, 0.05, 0.008);
  p.T(0, 0.44, 0, 0, 90, 0).extrude([[-0.16, -0.03], [0.16, -0.03], [0.16, 0.0], [0.08, 0.05], [-0.08, 0.05], [-0.16, 0.0]], 0.07);
  p.shade(null).ink(BRASS, 0.3, 0.95).T(0, 0.24, 0).lathe([[0.075, 0], [0.07, 0.012], [0.052, 0.04], [0.042, 0.1], [0.03, 0.135], [0.012, 0.15], [0, 0.152]], 12);
  p.ink(IRON, 0.5, 0.8).T(0, 0.25, 0).sphere(0.014, 6, 4); p.T(0, 0.39 + 0.02, 0).cyl(0.008, 0.008, 0.04, 5, 0);
}
/** the galley chimney */
function stovePipe(p, h) {
  p.shade(mottle(0.25, 20)).ink(IRON, 0.6, 0.7).lathe([[0.05, 0], [0.05, 0.02], [0.036, 0.03], [0.036, h * 0.75], [0.042, h * 0.75], [0.042, h * 0.8], [0.036, h * 0.8]], 8);
  p.T(0.02, h * 0.86, 0, 0, 0, -60).cyl(0.036, 0.036, h * 0.22, 8, 1);
  p.shade(null);
}
function bucket(p, col) {
  p.shade(null).ink(col, 0.85).lathe([[0, 0.006], [0.036, 0.006], [0.038, 0], [0.05, 0.085], [0.045, 0.085], [0.036, 0.016], [0, 0.016]], 7);
  p.ink(IRON, 0.5, 0.8); for (const y of [0.02, 0.07]) p.T(0, y, 0).lathe([[0.041 + y * 0.13, -0.005], [0.043 + y * 0.13, 0], [0.041 + y * 0.13, 0.005]], 9);
  p.ink(HEMP, 0.95).tube([[-0.046, 0.08, 0], [-0.03, 0.12, 0], [0, 0.135, 0], [0.03, 0.12, 0], [0.046, 0.08, 0]], 0.005, 4);
}
/** a swivel gun on its stock, pivot at the origin, muzzle toward +Z */
function swivelGun(p, len) {
  p.shade(grainY(0.12)).ink(OAK, 0.8).T(0, -0.09, 0).box(0.05, 0.2, 0.05, 0.008);
  p.shade(null).ink(IRON, 0.5, 0.8).T(0, 0.02, 0).cyl(0.01, 0.012, 0.06, 6);
  for (const sg of [-1, 1]) p.bar([0, 0.045, 0], [sg * 0.032, 0.085, 0], 0.007, 0.007, 4, 0);
  p.push(X(0, 0.09, 0.02, -6, 0, 0));
  gunBarrel(p, len, len * 0.075);
  p.ink(IRON, 0.5, 0.8).tube([[0, 0, -len * 0.62], [0, -0.02, -len * 0.8], [0, -0.06, -len * 0.92]], 0.008, 5, 1);
  p.pop();
}
/** a stack of round shot in a rack */
function shotRack(p, n) {
  if (lite) return;
  p.shade(grainX(0.12)).ink(mul(OAK, 0.8), 0.85).T(0, 0.012, 0).box(n * 0.055 + 0.03, 0.024, 0.07, 0.005);
  p.shade(null).ink(IRON, 0.45, 0.85);
  for (let i = 0; i < n; i++) p.T((i - (n - 1) / 2) * 0.055, 0.045, 0).sphere(0.025, 5, 3);
}

/** a ship's boat (open, clinker-built) on the origin, keel at y = 0, bow toward +X */
function shipsBoat(p, len, beam, col, inner, seed = 0) {
  const o = { L: len, B: beam, yP: -9, yS: 0.02, sMid: 0.46, midK: 0.93, wlMid: 0.5, wlP: 2, wlE: 1, midP: 2.2, midE: 0.8, deckP: 2.4, deckE: 0.62, tWl: 0.5, tMid: 0.7, tDeck: 0.76,
    kMid: 1.6, kEnd: 1, tumble: 0, leanMin: 0, leanMax: 0, fwdFrom: 0.6, aftTo: 0.3, stemE: 1.8, thick: 0.018, camber: 0, step: 0.14, rakeF: 0.1 * len, rakeA: 0.08,
    draft: 0.0, fb: beam * 0.42, sheerF: beam * 0.14, sheerA: beam * 0.06, topF: 0, topA: 0, segs: [{ s0: 0, s1: 1, lift: 0, bul: 0 }] };
  o.yS = o.fb * 0.3; o.draft = 0;
  o.step *= TIERS[far ? 2 : lite ? 1 : 0].step; o.coarse = far;
  const B = makeHull(o), nS = far ? 3 : 5, y0 = 0.004;
  bothSides(p, (side) => {
    p.shade(null);
    for (let j = 0; j < nS; j++) strake(p, B, 0, 1, (ss) => lerp(y0, B.yGun(ss), j / nS), (ss) => lerp(y0, B.yGun(ss), (j + 1) / nS), { col: () => (j === nS - 1 ? mix(col, WHITE, 0.6) : col), lap: 0.008, plank: 99, seed: seed + j * 3 + (side > 0 ? 0 : 50), clean: true });
    const cols = B.sts;
    p.ink(inner, 0.85).grid(cols.length - 1, 4, (i, j, out) => { const ss = cols[i], y = lerp(y0 + 0.02, B.yGun(ss), j / 4); out[0] = B.x(ss, y); out[1] = y; out[2] = B.zIn(ss, y); }, (i, j) => mul(inner, 0.5 + 0.12 * j), true);
    p.shade(grainX(0.12)).ink(mul(col, 0.7), 0.75);
    sweep(p, B, cols, (ss) => B.yGun(ss), [[0.01, -0.012], [0.01, 0.014], [-o.thick - 0.01, 0.014], [-o.thick - 0.01, -0.012]]);
    p.shade(null);
  });
  // transom, keel and stem, thwarts
  const yt = B.yGun(0);
  p.ink(col, 0.85).grid(4, 3, (i, j, out) => { const y = lerp(y0, yt, j / 3), u = (i - 2) / 2; out[0] = B.x(0, y); out[1] = y; out[2] = u * B.z(0, y); }, (i, j) => mul(col, 0.8 + 0.07 * j));
  const fr = [], bk = [];
  for (let i = 0; i <= 8; i++) { const y = lerp(-0.012, B.yGun(1) + 0.03, i / 8); fr.push([B.x(1, y) + 0.02, y]); bk.push([B.x(1, y) - 0.02, y]); }
  p.ink(mul(col, 0.6), 0.85).extrude([...fr, ...bk.reverse()], 0.024);
  p.T(-0.02 * len, -0.004, 0).box(len * 0.88, 0.024, 0.024);
  p.shade(grainX(0.14)).ink(mul(inner, 1.1), 0.85);
  for (const ss of [0.14, 0.34, 0.54, 0.74]) { const y = B.yGun(ss) - beam * 0.1; p.T(B.x(ss, y), y, 0).box(len * 0.07, 0.014, 2 * B.zIn(ss, y), 0.003); }
  if (!far) for (const sg of [-1, 1]) { const y = B.yGun(0.45) - beam * 0.1 + 0.02; p.ink(mul(SPAR, 1.1), 0.75).bar([-len * 0.28, y, sg * beam * 0.14], [len * 0.3, y + 0.01, sg * beam * 0.1], 0.011, 0.009, 5); p.T(-len * 0.32, y, sg * beam * 0.14).box(len * 0.16, 0.008, 0.04); }
  p.shade(null);
  return B;
}
/** chocks (or skid beams) for a boat to sit on */
function chocks(p, len, beam, col) {
  p.shade(grainY(0.12)).ink(col, 0.82);
  for (const sg of [-1, 1]) p.T(sg * len * 0.26, 0.05, 0, 0, 90, 0).extrude([[-beam * 0.42, -0.05], [beam * 0.42, -0.05], [beam * 0.42, 0.09], [beam * 0.2, 0.01], [-beam * 0.2, 0.01], [-beam * 0.42, 0.09]], 0.05);
  p.shade(null);
}

// ---------- sails ----------
const WIND = 13 * DEG;   // the wind comes over the starboard quarter: sails belly to port and ahead, flags stream the same way
/** cloth colour for a vertex: panel tone, seams, hems, weather stains */
function clothTone(base, seedPanel, seam, edge, x, y, z) {
  const k = (0.93 + 0.1 * hash1(seedPanel)) * (seam ? 0.83 : 1.02) * (1 - 0.14 * edge) * (0.9 + 0.16 * fbm3(x * 1.7, y * 1.1, z * 1.7 + seedPanel * 0.01, 2));
  return [base[0] * k * 1.05, base[1] * k, base[2] * k * 0.88];
}
/**
 * A square sail bent to a yard. o: { c: head centre, beta: brace angle (rad), wHead, wFoot, drop, belly, roach, col, seed, reefs: [v...] }
 * It bellies forward of the yard, each cloth puffing a little between its seams, with reef bands and reef points.
 */
function squareSail(p, o) { return stage(p, 'sails', () => squareSail0(p, o)); }
function squareSail0(p, o) {
  const A = [Math.sin(o.beta), 0, Math.cos(o.beta)], N = [Math.cos(o.beta), 0, -Math.sin(o.beta)];
  // o.fine: the sail carries a painted device, so even the distant builds keep it smooth enough for the patch to lie on it
  const panels = Math.max(o.fine ? 8 : 3, Math.round(Math.max(o.wHead, o.wFoot) / ((o.cloth || 0.3) * eco))), nu = panels * 2;
  const reefs = o.reefs || [], vs = new Set();
  const nr = Math.max(o.fine ? 10 : far ? 4 : 6, Math.round(o.drop / (0.16 * eco)));
  for (let j = 0; j <= nr; j++) vs.add(+(j / nr).toFixed(4));
  if (!far) for (const r of reefs) { vs.add(+(r - 0.012).toFixed(4)); vs.add(+(r + 0.012).toFixed(4)); }
  const rows = [...vs].sort((a, b) => a - b), nv = rows.length - 1;
  const isReef = (v) => reefs.some((r) => Math.abs(v - r) < 0.0125);
  // pk: how much each cloth puffs between its seams (only the full model shows it; a device painted on the sail asks for it either way)
  const pk0 = lite ? 0 : 1, wAt = (v) => lerp(o.wHead, o.wFoot, v) - (o.hollow ?? 0.04) * Math.sin(Math.PI * v) * o.wHead;
  const P = (u, v, pk = pk0) => {
    const w = wAt(v), su = Math.sin(Math.PI * u);
    const bell = o.belly * Math.pow(su, 0.72) * (Math.sin(Math.PI * Math.pow(v, 0.8) * 0.82) + 0.12 * v) + pk * 0.014 * Math.abs(Math.sin(Math.PI * u * panels)) * Math.min(1, v * 6) + 0.03 * o.belly * Math.sin(Math.PI * v);
    const a = (u - 0.5) * w, dn = v * o.drop - (o.roach ?? 0.08) * o.drop * su * v * v;
    return [o.c[0] + A[0] * a + N[0] * bell, o.c[1] - dn, o.c[2] + A[2] * a + N[2] * bell];
  };
  p.shade(null).ink(o.col, 0.94, 0, 0.14);
  p.grid(nu, nv, (i, j, out) => { const q = P(i / nu, rows[j]); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
    (i, j) => { const q = P(i / nu, rows[j]), pan = Math.min(panels - 1, Math.floor(i / 2)), tint = o.stripe && pan % 2 ? o.stripe : o.col; return clothTone(isReef(rows[j]) ? mul(tint, 0.9) : tint, o.seed * 31 + pan, i % 2 === 0, (i === 0 || i === nu || j === 0 || j === nv) ? 1 : 0, q[0], q[1], q[2]); });
  // reef points: short cords hanging on the fore side
  p.ink(mul(HEMP, 0.75), 0.95);
  if (!lite) for (const r of reefs) for (let k = 0; k < panels * 2; k++) for (const e of [1, -1]) { const q = P((k + 0.5) / (panels * 2), r), a = add3(q, N, e * 0.007), b = [a[0] + N[0] * e * 0.008, a[1] - 0.078, a[2] + N[2] * e * 0.008], w = [A[0] * 0.005, 0, A[2] * 0.005]; p.poly([add3(a, w, -1), add3(a, w), add3(b, w), add3(b, w, -1)]); }
  /** a point on the cloth x across and y up (model units) from the middle of the sail at height fraction vc */
  const on = (x, y, vc = 0.5, pk = pk0) => { const v = clamp(vc - y / o.drop, 0.03, 0.97); return P(clamp(0.5 + x / wAt(v), 0.03, 0.97), v, pk); };
  return { P, N, on, size: Math.min(wAt(0.5), o.drop), clews: [P(0, 1), P(1, 1)], heads: [P(0, 0), P(1, 0)] };
}
/** a four-cornered fore-and-aft sail (gaff, lug): tack and clew along the foot, throat and peak along the head */
function gaffSail(p, o) { return stage(p, 'sails', () => gaffSail0(p, o)); }
function gaffSail0(p, o) {
  const { tack, clew, throat, peak } = o;
  let N = norm3(cross(sub3(clew, tack), sub3(throat, tack)));
  if (N[2] > 0) N = [-N[0], -N[1], -N[2]];
  const wFoot = dist3(tack, clew), panels = Math.max(o.fine ? 8 : 3, Math.round(wFoot / ((o.cloth || 0.3) * eco))), nu = panels * 2;
  const reefs = o.reefs || [], vs = new Set(), nr = Math.max(o.fine ? 10 : far ? 4 : 6, Math.round(dist3(tack, throat) / (0.17 * eco)));
  for (let j = 0; j <= nr; j++) vs.add(+(j / nr).toFixed(4));
  if (!far) for (const r of reefs) { vs.add(+(r - 0.012).toFixed(4)); vs.add(+(r + 0.012).toFixed(4)); }
  const rows = [...vs].sort((a, b) => a - b), nv = rows.length - 1;
  const isReef = (v) => reefs.some((r) => Math.abs(v - r) < 0.0125);
  const pk0 = lite ? 0 : 1;
  const P = (u, v, pk = pk0) => {
    const q = lerp3(lerp3(tack, clew, u), lerp3(throat, peak, u), v);
    const bell = o.belly * Math.sin(Math.PI * Math.pow(u, 0.8)) * Math.pow(Math.sin(Math.PI * (0.08 + 0.92 * v) ), 0.7) * (1 - 0.5 * v * (o.flatHead ?? 1)) + pk * 0.012 * Math.abs(Math.sin(Math.PI * u * panels)) * Math.sin(Math.PI * v);
    // the leech hollows a little between peak and clew
    const hol = (o.hollow ?? 0.03) * wFoot * Math.sin(Math.PI * v) * u * u;
    return [q[0] + N[0] * bell + (tack[0] - clew[0]) / wFoot * hol, q[1], q[2] + N[2] * bell + (tack[2] - clew[2]) / wFoot * hol];
  };
  p.shade(null).ink(o.col, 0.94, 0, 0.14);
  p.grid(nu, nv, (i, j, out) => { const q = P(i / nu, rows[j]); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
    (i, j) => { const q = P(i / nu, rows[j]), pan = Math.min(panels - 1, Math.floor(i / 2)); return clothTone(isReef(rows[j]) ? mul(o.col, 0.9) : o.col, o.seed * 31 + pan, i % 2 === 0, (i === 0 || i === nu || j === 0 || j === nv) ? 1 : 0, q[0], q[1], q[2]); });
  p.ink(mul(HEMP, 0.75), 0.95);
  if (!lite) { const A = norm3(sub3(clew, tack)); for (const r of reefs) for (let k = 0; k < panels * 2; k++) for (const e of [1, -1]) { const q = P((k + 0.5) / (panels * 2), r), a = add3(q, N, e * 0.007), b = [a[0] + N[0] * e * 0.008, a[1] - 0.074, a[2] + N[2] * e * 0.008], w = [A[0] * 0.005, 0, A[2] * 0.005]; p.poly([add3(a, w, -1), add3(a, w), add3(b, w), add3(b, w, -1)]); } }
  const uc = o.uc ?? 0.46, vc0 = o.vc ?? 0.5, wMid = dist3(lerp3(tack, throat, vc0), lerp3(clew, peak, vc0)), hMid = dist3(lerp3(tack, clew, uc), lerp3(throat, peak, uc));
  /** a point on the cloth x toward the leech and y toward the head (model units) from the middle of the sail */
  const on = (x, y, vc = vc0, pk = pk0) => P(clamp(uc + x / wMid, 0.03, 0.97), clamp(vc + y / hMid, 0.03, 0.97), pk);
  return { P, N, on, size: Math.min(wMid, hMid) };
}
/** a three-cornered sail (jib, staysail, lateen): luff from tack to head, clew hauled aft */
function triSail(p, o) { return stage(p, 'sails', () => triSail0(p, o)); }
function triSail0(p, o) {
  const { tack, head, clew } = o;
  let N = norm3(cross(sub3(head, tack), sub3(clew, tack)));
  if (N[2] > 0) N = [-N[0], -N[1], -N[2]];
  const luff = dist3(tack, head), panels = Math.max(3, Math.round(luff / ((o.cloth || 0.32) * eco))), nu = panels * 2, nv = Math.max(far ? 3 : 5, Math.round(dist3(lerp3(tack, head, 0.5), clew) / (0.2 * eco)));
  const P = (u, v) => {
    const l = lerp3(tack, head, u), q = lerp3(l, clew, v);
    const bell = o.belly * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.pow(v, 0.85)) + 0.01 * Math.abs(Math.sin(Math.PI * u * panels)) * Math.sin(Math.PI * v);
    return [q[0] + N[0] * bell, q[1] + N[1] * bell, q[2] + N[2] * bell];
  };
  p.shade(null).ink(o.col, 0.94, 0, 0.14);
  p.grid(nu, nv, (i, j, out) => { const q = P(i / nu, j / nv); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
    (i, j) => { const q = P(i / nu, j / nv), pan = Math.min(panels - 1, Math.floor(i / 2)); return clothTone(o.col, o.seed * 31 + pan, i % 2 === 0, (i === 0 || i === nu || j === 0) ? 1 : 0, q[0], q[1], q[2]); });
  return { P, N };
}

// ---------- spars and cordage ----------
/** a rope from a to b; sag > 0 lets it hang */
let ropeK = 1, eco = 1, lite = false, far = false;   // per-build settings: rope weight, mesh economy, and the two cut-down tiers (see TIERS)
function rope(p, a, b, r = 0.008, col = TAR, sag = 0, sides = 4) {
  if (far && r < 0.0075) return p;
  if (lite) sides = 3;
  r *= ropeK;
  const T = globalThis.__shipTally, t0 = p.tris;
  p.shade(null).ink(col, 0.95);
  if (!sag) p.bar(a, b, r, r, sides, 0);
  else {
    const pts = [], n = far ? 2 : 4;
    for (let i = 0; i <= n; i++) { const t = i / n, q = lerp3(a, b, t); q[1] -= sag * 4 * t * (1 - t); pts.push(q); }
    p.tube(pts, r, sides);
  }
  if (T) T.ropes = (T.ropes || 0) + p.tris - t0;
  return p;
}
/** a block (pulley) at q */
function block(p, q, k = 1) { if (lite) return; p.shade(null).ink(mul(OAK, 0.8), 0.8).T(q[0], q[1], q[2], 0, 0, 0, 0.022 * k, 0.034 * k, 0.018 * k).sphere(1, 5, 3); }
/** a yard: a spar tapering to both arms, with its sling band and yardarm cleats */
function yard(p, c, len, r, dir, col) {
  const a = add3(c, dir, -len / 2), b = add3(c, dir, len / 2), m1 = add3(c, dir, -len * 0.14), m2 = add3(c, dir, len * 0.14);
  p.shade(grainX(0.12)).ink(col, 0.72);
  const sg8 = r > 0.03 ? 8 : 6;
  p.bar(m1, a, r, r * 0.5, sg8, 1); p.bar(m2, b, r, r * 0.5, sg8, 1); p.bar(m1, m2, r * 1.06, r * 1.06, sg8, 0);
  if (far) { p.shade(null); return; }
  p.shade(null).ink(IRON, 0.5, 0.8);
  p.bar(add3(c, dir, -0.02), add3(c, dir, 0.02), r * 1.16, r * 1.16, sg8, 0);
  for (const e of [-1, 1]) p.bar(add3(c, dir, e * len * 0.46), add3(c, dir, e * (len * 0.46 + 0.02)), r * 0.72, r * 0.72, 6, 0);
}
/** foot ropes slung under a yard for the topmen */
function footRopes(p, c, len, dir) {
  if (lite) return;
  for (const e of [-1, 1]) {
    const a = add3(c, dir, e * 0.06), b = add3(c, dir, e * len * 0.47), m = lerp3(a, b, 0.5);
    rope(p, [a[0] - 0.04, a[1] - 0.02, a[2]], [b[0] - 0.04, b[1] - 0.02, b[2]], 0.006, TAR, 0.11, 3);
    rope(p, [m[0] - 0.03, m[1], m[2]], [m[0] - 0.04, m[1] - 0.13, m[2]], 0.005, TAR, 0, 3);
  }
}
/** a fighting top: the platform at the head of a lower mast, on its trestle-trees and cross-trees */
function fightingTop(p, c, R, col, style) {
  p.push(X(c[0], c[1], c[2]));
  p.shade(grainX(0.12)).ink(col, 0.8);
  for (const sg of [-1, 1]) { p.T(0.02, -0.03, sg * R * 0.3).box(R * 1.7, 0.05, 0.035); p.T(sg * R * 0.42 + 0.02, -0.065, 0).box(0.035, 0.04, R * 1.9); }
  if (style === 'basket') {
    p.lathe([[R * 0.3, 0], [R * 0.82, 0], [R * 1.05, 0.2], [R * 1.1, 0.26], [R * 1.02, 0.26], [R * 0.96, 0.2], [R * 0.74, 0.03], [R * 0.3, 0.03]], 14);
    p.shade(null).ink(IRON, 0.5, 0.8);
    for (const [rr, y] of [[R * 0.86, 0.03], [R * 1.07, 0.2]]) p.T(0, y, 0).lathe([[rr, -0.012], [rr + 0.006, 0], [rr, 0.012]], 14);
  } else {
    const out = [[-R * 0.75, -R], [R * 0.35, -R]];
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; out.push([R * 0.35 + Math.cos(a) * R * 0.5, Math.sin(a) * R]); }
    out.push([-R * 0.75, R]);
    p.T(0, 0.012, 0, 90, 0, 0).extrude(out.map(([x, z]) => [x, z]), 0.026);
    p.ink(mul(col, 0.8), 0.8).T(-R * 0.72, 0.035, 0).box(0.035, 0.03, R * 2, 0.005);
    if (style === 'railed') { p.shade(null).ink(col, 0.8); for (let i = 0; i < 4; i++) p.T(-R * 0.72, 0.16, lerp(-R * 0.92, R * 0.92, i / 3)).box(0.022, 0.26, 0.022); p.T(-R * 0.72, 0.29, 0).box(0.03, 0.024, R * 1.92, 0.005); }
  }
  p.shade(null);
  p.pop();
}

// ---------- flags ----------
/** flags fly from anchors left by the rigger; drawn into their own pen in the side colour */
function drawFlags(fp, flags, sideHex) {
  const side = hex(sideHex), pale = mix(side, WHITE, 0.85), dk = mul(side, 0.5);
  const W = [Math.cos(WIND), 0, -Math.sin(WIND)], Q = [Math.sin(WIND), 0, Math.cos(WIND)];
  // each flag is cut into panels of one colour, so the device keeps hard edges however it ripples
  const DEVICE = {
    ensign: { us: [0, 0.07, 0.22, 0.3, 0.36, 0.44, 1], vs: [0, 1], col: (i) => (i === 0 ? dk : i === 2 || i === 4 ? pale : side) },
    flag: { us: [0, 0.14, 0.7, 1], vs: [0, 1], col: (i) => (i === 0 ? dk : i === 2 ? pale : side) },
    pennant: { us: [0, 0.06, 0.16, 0.22, 1], vs: [0, 1], col: (i) => (i === 0 ? dk : i === 2 ? pale : side) },
  };
  for (const f of flags) {
    if (f.kind === 'device') { sailDevice(fp, f, side, pale); continue; }
    if (f.kind === 'panel') { fp.shade(null).ink(side, f.ro ?? 0.9, f.me ?? 0, 0.08).grid(f.nu, f.nv, (i, j, out) => { const q = f.P(i / f.nu, j / f.nv); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; }, (i, j) => (f.col ? f.col(i / f.nu, j / f.nv, side, pale, dk) : side), !!f.flip); continue; }   // fleets.js: any patch of cloth or paint in the side colour
    const len = f.len, hg = f.hgt, ph = f.seed * 1.7, pen = f.kind === 'pennant', D = DEVICE[f.kind] || DEVICE.flag;
    const waves = pen ? 1.3 + len * 0.9 : 1.6;
    const P = (u, v) => {
      const taper = pen ? 1 - 0.88 * Math.pow(u, 0.8) : 1;
      const wob = (pen ? 0.05 + 0.05 * len : 0.075 * len) * Math.sin(u * waves * TAU - ph + v * 0.9) * Math.pow(u, 0.75);
      const droop = (pen ? 0.16 : 0.15) * len * u * u - 0.03 * len * Math.sin(u * waves * TAU - ph + 1.3) * u;
      return [f.at[0] + W[0] * u * len * 0.96 + Q[0] * wob, f.at[1] - hg / 2 - (v - 0.5) * hg * taper - droop, f.at[2] + W[2] * u * len * 0.96 + Q[2] * wob];
    };
    fp.shade(null).ink(side, 0.9, 0, 0.1);
    for (let i = 0; i < D.us.length - 1; i++) for (let j = 0; j < D.vs.length - 1; j++) {
      const u0 = D.us[i], u1 = D.us[i + 1], v0 = D.vs[j], v1 = D.vs[j + 1], c = D.col(i, j);
      const nu = Math.max(1, Math.round(((u1 - u0) * len) / 0.065)), nv = Math.max(1, Math.round(((v1 - v0) * hg) / 0.09));
      fp.grid(nu, nv, (a2, b2, out) => { const q = P(lerp(u0, u1, a2 / nu), lerp(v0, v1, b2 / nv)); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
        (a2) => { const u = lerp(u0, u1, a2 / nu); return mul(c, 0.84 + 0.22 * Math.sin(u * waves * TAU - ph + 0.6) * Math.min(1, u * 3)); });
    }
  }
}

// ---------- devices painted on a sail in the side colour ----------
// outlines about the origin, radius about 1, anticlockwise; each is star-shaped about its middle
const ringPts = (n, r = 1, wob = 0) => Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU, k = r * (1 + wob * (noise3(Math.cos(a) * 1.9 + 3.1, Math.sin(a) * 1.9, 7.7) - 0.5)); return [Math.cos(a) * k, Math.sin(a) * k]; });
const starPts = (n, r0, r1) => Array.from({ length: n * 2 }, (_, i) => { const a = Math.PI / 2 + (i / (n * 2)) * TAU, r = i % 2 ? r1 : r0; return [Math.cos(a) * r, Math.sin(a) * r]; });
const crossPts = (w, turn = 0) => { const a = w / 2, c = Math.cos(turn), sn = Math.sin(turn); return [[1, -a], [1, a], [a, a], [a, 1], [-a, 1], [-a, a], [-1, a], [-1, -a], [-a, -a], [-a, -1], [a, -1], [a, -a]].map(([x, y]) => [x * c - y * sn, x * sn + y * c]); };
/** extra points along the long edges, so the painted patch follows the belly of the cloth */
const densify = (pts, maxSeg = 0.3) => pts.flatMap((a, i) => { const b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg)); return Array.from({ length: n }, (_, k) => [lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n)]); });
const DEVICES = {
  daub: () => [{ pts: ringPts(18, 0.9, 0.5) }],
  disc: () => [{ pts: ringPts(28) }],
  roundel: () => [{ pts: ringPts(28) }, { pts: ringPts(22, 0.56), pale: true }, { pts: ringPts(16, 0.24) }],
  lozenge: () => [{ pts: densify([[0.8, 0], [0, 1.12], [-0.8, 0], [0, -1.12]]) }, { pts: densify([[0.36, 0], [0, 0.5], [-0.36, 0], [0, -0.5]]), pale: true }],
  saltire: () => [{ pts: densify(crossPts(0.4, Math.PI / 4).map(([x, y]) => [x * 1.1, y * 1.1])) }],
  cross: () => [{ pts: densify(crossPts(0.44)) }],
  sun: () => [{ pts: starPts(12, 1.08, 0.7) }, { pts: ringPts(22, 0.46), pale: true }],
  star: () => [{ pts: densify(starPts(8, 1.12, 0.5)) }, { pts: ringPts(14, 0.22), pale: true }],
  ...FLEET_DEVICES({ ringPts, starPts, crossPts, densify }),
};
/** f: { shape, on(x, y, puff) -> point on the cloth, N: the way the sail bellies, r } */
function sailDevice(fp, f, side, pale) {
  const o0 = f.on(0, 0, 1), ex = sub3(f.on(0.02, 0, 1), o0), ey = sub3(f.on(0, 0.02, 1), o0), z = cross(ex, ey);
  const frontFlip = z[0] * f.N[0] + z[1] * (f.N[1] || 0) + z[2] * f.N[2] > 0, m = 3;
  (DEVICES[f.shape] || DEVICES.disc)().forEach((L, li) => {
    const col = L.pale ? pale : side, n = L.pts.length;
    for (const e of [1, -1]) {
      // one skin just in front of the cloth and one just behind, so the device shows from both sides
      const off = (0.011 + li * 0.004) * e;
      fp.shade(null).ink(col, 0.92, 0, 0.1);
      const cx = L.at ? L.at[0] * f.r : 0, cy = L.at ? L.at[1] * f.r : 0;
      fp.grid(n, m, (i, j, out) => { const q = L.pts[i % n], k = (j / m) * f.r, s = f.on(cx + q[0] * k, cy + q[1] * k, e > 0 ? 1 : 0); out[0] = s[0] + f.N[0] * off; out[1] = s[1]; out[2] = s[2] + f.N[2] * off; },
        (i, j) => { const q = L.pts[i % n]; return mul(col, (e > 0 ? 1 : 0.88) * (0.9 + 0.16 * noise3(q[0] * 2.2 * j, q[1] * 2.2 * j, 4.4 + li))); }, e > 0 ? frontFlip : !frontFlip);
    }
  });
}

// ---------- the rig ----------
function rigPlan(st) {
  const k = st.kind, n = st.masts, L = st.L;
  const small = k === 'skiff' || k === 'sloop' || k === 'cutter';
  const R = { truck: k === 'skiff' ? 1.95 + 0.28 * L : 2.2 + 0.44 * L, mastR: 0.0075 * L + 0.026, jibs: 0, shrouds: { skiff: 1, sloop: 3, cutter: 3, brigantine: 4, frigate: 4, galleon: 5 }[k] || 5, topR: 0.2 + 0.012 * L };
  const sq3 = (s, hf, rake) => ({ s, hf, rake, type: 'square', parts: 3, sq: 3 });
  const stock = {
    skiff: [{ s: 0.62, hf: 1, rake: 3, type: 'lug', parts: 1 }],
    sloop: [{ s: 0.6, hf: 1, rake: 3, type: 'gaff', parts: 2 }],
    cutter: [{ s: 0.69, hf: 0.93, rake: 5, type: 'gaff', parts: 2 }, { s: 0.38, hf: 1, rake: 6, type: 'gaff', parts: 2 }],
    brigantine: [sq3(0.71, 0.95, 2), { s: 0.37, hf: 1, rake: 3, type: 'gaff', parts: 2 }],
    frigate: [sq3(0.865, 0.92, 1), sq3(0.52, 1, 2), { s: 0.17, hf: 0.8, rake: 3, type: 'mizzen', parts: 3, sq: 1 }],
    galleon: [{ s: 0.85, hf: 0.86, rake: -1, type: 'square', parts: 2, sq: 2 }, { s: 0.54, hf: 1, rake: 1, type: 'square', parts: 2, sq: 2 }, { s: 0.27, hf: 0.74, rake: 3, type: 'lateen', parts: 1 }],
    manowar: [sq3(0.84, 0.92, 1), sq3(0.5, 1, 2), { s: 0.22, hf: 0.82, rake: 3, type: 'mizzen', parts: 3, sq: 2 }],
  }[k];
  if (n === 0) R.masts = [];
  else if (stock.length === n) R.masts = stock;
  else if (n === 1) R.masts = small ? [stock[stock.length - 1]] : [sq3(0.56, 1, 2)];
  else {
    R.masts = [];
    for (let i = 0; i < n; i++) {
      const s = lerp(small ? 0.7 : 0.85, small ? 0.34 : 0.19, i / (n - 1)), last = i === n - 1;
      R.masts.push(small || (last && n === 2) ? { s, hf: last ? 1 : 0.93, rake: 4, type: 'gaff', parts: 2 } : last ? { s, hf: 0.8, rake: 3, type: 'mizzen', parts: 3, sq: 1 } : sq3(s, i === 0 ? 0.92 : 1 - 0.04 * Math.abs(i - 1), 1 + i));
    }
  }
  R.sprit = { sloop: { len: 0.27 * L, steeve: 11 }, cutter: { len: 0.3 * L, steeve: 7 }, brigantine: { len: 0.2 * L, steeve: 17, jib: 0.14 * L }, frigate: { len: 0.19 * L, steeve: 21, jib: 0.15 * L, striker: true },
    galleon: { len: 0.27 * L, steeve: 29, spritsail: true, inboard: 0.12 * L }, manowar: { len: 0.19 * L, steeve: 23, jib: 0.15 * L, striker: true } }[k];
  R.jibs = { sloop: 2, cutter: 2, brigantine: 2, frigate: 3, galleon: 0, manowar: 3 }[k] || 0;
  if (n === 0) { R.jibs = 0; R.sprit = null; }
  R.tops = { frigate: 'flat', manowar: 'railed', galleon: 'basket', brigantine: 'flat' }[k];
  return R;
}
/** how far forward the stem (and the knee of the head on it) reaches at height y */
function stemFront(H, st, y) {
  const hd = st.head;
  return H.x(1, y) + (hd ? 0.04 + hd.len * Math.pow(smooth(hd.foot ?? -H.d * 0.3, H.yGun(1) + hd.tip, y), hd.e ?? 1.7) : 0.05);
}

function rig(p, H, st) {
  const R = st.rig, C = st.col, L = H.L, flags = [];
  const sparC = C.spar, yardC = C.yard || C.spar, sailC = C.sail;
  const big = st.kind === 'frigate' || st.kind === 'manowar' || st.kind === 'galleon';
  const Ms = R.masts.map((m, mi) => {
    const g = H.seg(m.s), base = H.on(m.s, 0, g), top = base[1] + (R.truck - base[1]) * m.hf, tan = Math.tan(m.rake * DEG);
    const r0 = R.mastR * (0.55 + 0.45 * m.hf), yb = base[1], hgt = top - yb;
    const y1 = m.parts === 1 ? null : yb + hgt * (m.parts === 3 ? 0.44 : 0.6), y2 = m.parts === 3 ? yb + hgt * 0.76 : null;
    const secs = m.parts === 1 ? [[yb - 0.04, top, r0, r0 * 0.5, 0]]
      : m.parts === 2 ? [[yb - 0.04, y1 + 0.1, r0, r0 * 0.82, 0], [y1 - 0.18, top, r0 * 0.66, r0 * 0.4, r0 * 1.45]]
        : [[yb - 0.04, y1 + 0.1, r0, r0 * 0.84, 0], [y1 - 0.2, y2 + 0.08, r0 * 0.68, r0 * 0.52, r0 * 1.5], [y2 - 0.14, top, r0 * 0.46, r0 * 0.3, r0 * 2.45]];
    const sec = (y) => (m.parts === 3 && y > y2 ? secs[2] : m.parts >= 2 && y > y1 ? secs[1] : secs[0]);
    const at = (y, q = sec(y)) => [base[0] - tan * (y - yb) + q[4], y, 0];
    const rad = (y, q = sec(y)) => lerp(q[2], q[3], clamp((y - q[0]) / (q[1] - q[0]), 0, 1));
    return { ...m, mi, g, base, top, r0, yb, hgt, y1, y2, secs, at, rad, fwd: (y) => at(y)[0] + rad(y), xb: base[0] };
  });
  // --- bowsprit
  let sprit = null;
  if (R.sprit) {
    const sp = R.sprit, yTop = H.railY(1) + 0.01, a = sp.steeve * DEG, dir = [Math.cos(a), Math.sin(a), 0], up = [-Math.sin(a), Math.cos(a), 0], r = R.mastR * 0.82;
    const SH = [H.x(1, yTop) - 0.03, yTop + r, 0], B0 = add3(SH, dir, -(sp.inboard ?? 0.09 * L)), E = add3(SH, dir, sp.len);
    p.shade(grainX(0.12)).ink(sparC, 0.72).bar(B0, E, r, r * 0.74, 10, 3);
    let tip = E;
    if (sp.jib) {
      const j0 = add3(add3(SH, dir, sp.len * 0.5), up, r * 1.3), j1 = add3(add3(SH, dir, sp.len + sp.jib), up, r * 1.0);
      p.bar(j0, j1, r * 0.46, r * 0.3, 8, 3);
      p.shade(null).ink(IRON, 0.5, 0.8).TM(frame(add3(add3(E, dir, -0.03), up, r * 0.75), dir, up)).box(0.05, r * 3.6, r * 2.2, 0.008);
      tip = j1;
    }
    // gammoning lashing the bowsprit down to the knee, bobstay to the cutwater
    p.shade(null);
    const gm = add3(SH, dir, sp.len * 0.16);
    if (!far) for (let i = 0; i < 5; i++) { const q = add3(gm, dir, (i - 2) * 0.024); p.ink(HEMP, 0.95).TM(frame(q, up, dir)).lathe([[r * 0.92, -0.012], [r * 0.92 + 0.011, 0], [r * 0.92, 0.012]], 8); }
    if (!far) for (const sg of [-1, 1]) for (const e of [-1, 1]) { const q = add3(gm, dir, e * 0.05); rope(p, [q[0], q[1] - r * 0.6, sg * r * 0.7], [Math.min(stemFront(H, st, q[1] - 0.3) - 0.04, q[0] + 0.02), q[1] - 0.3, sg * 0.035], 0.011, HEMP); }
    const yBob = H.yS + 0.12, stemPt = [stemFront(H, st, yBob), yBob, 0];
    rope(p, add3(E, up, -r * 0.7), stemPt, 0.014, TAR, 0, 5);
    if (sp.striker) {
      const sE = add3(add3(E, dir, -0.02), up, -0.36 - r);
      p.shade(grainY(0.1)).ink(sparC, 0.72).bar(add3(E, up, -r * 0.6), sE, r * 0.34, r * 0.24, 6, 3);
      rope(p, tip, sE, 0.009, TAR); rope(p, sE, [stemFront(H, st, yBob + 0.2), yBob + 0.2, 0], 0.009, TAR);
    }
    if (sp.spritsail) {
      const c = add3(add3(SH, dir, sp.len * 0.66), up, -r - 0.03), yl = H.B * 0.5;
      yard(p, c, yl, r * 0.5, [0.14, 0, 1], yardC);
      const drop = clamp(c[1] - 0.8, 0.3, 0.16 * H.B + 0.28);
      squareSail(p, { c: [c[0], c[1] - r * 0.5 - 0.01, 0], beta: 8 * DEG, wHead: yl * 0.9, wFoot: yl * 0.84, drop, belly: 0.16 * drop + 0.05, col: sailC, seed: 71, roach: 0.1 });
      for (const sg of [-1, 1]) rope(p, [c[0] + 0.14 * sg * yl * 0.47, c[1], sg * yl * 0.47], add3(SH, dir, sp.len * 0.98), 0.006, HEMP, 0, 3);
    }
    sprit = { SH, E, tip, dir, up, r, pt: (f) => (f <= 1 ? add3(add3(SH, dir, sp.len * f), up, r) : add3(lerp3(E, tip, f - 1), up, r * 0.5)) };
  }
  const railAt = (s, out = 0.02) => { const g = H.seg(s), q = H.pt(s, H.railY(s, g), out); return q; };
  // the sail that wears the device: the mainsail of a fore-and-after, the topsails of a square-rigger
  let devMast = Math.min(1, Ms.length - 1);
  for (let i = 0; i < Ms.length; i++) if (Ms[i].type === 'gaff' || Ms[i].type === 'lug') devMast = i;
  const device = (sl, k, vc) => flags.push({ kind: 'device', shape: st.device, on: (x, y, pk) => sl.on(x, y, vc, pk), N: sl.N, r: k * sl.size });
  Ms.forEach((M, mi) => {
    const { r0, yb, top, hgt, y1, y2 } = M, prev = Ms[mi - 1], next = Ms[mi + 1];
    // --- the spars of the mast itself
    M.secs.forEach((q, k) => {
      p.shade(grainY(0.14)).ink(k === 0 && C.mastLower ? C.mastLower : sparC, 0.72).bar(M.at(q[0], q), M.at(q[1], q), q[2], q[3], k === 0 ? 12 : 8, 3);
    });
    p.shade(null);
    // mast coat, iron hoops and rope wooldings on the lower mast
    p.ink(mul(WHITE, 0.8), 0.9).TM(X(M.xb, yb, 0, 0, 0, M.rake)).lathe([[r0 * 1.7, 0], [r0 * 1.25, 0.05], [r0 * 1.04, 0.075]], 12);
    const lowTop = (y1 ?? top) - 0.15;
    if (!far) for (let y = yb + 0.38, k = 0; y < lowTop; y += 0.42, k++) { const c = M.at(y), rr = M.rad(y) + 0.003; if (k % 2 && big) p.ink(HEMP, 0.95).TM(X(c[0], c[1], 0, 0, 0, M.rake)).lathe([[rr, -0.03], [rr + 0.008, -0.015], [rr + 0.004, 0], [rr + 0.008, 0.015], [rr, 0.03]], 10); else p.ink(IRON, 0.5, 0.8).TM(X(c[0], c[1], 0, 0, 0, M.rake)).lathe([[rr, -0.014], [rr + 0.005, 0], [rr, 0.014]], 10); }
    // top, cap and cross-trees
    if (y1) {
      const c1 = M.at(y1, M.secs[0]), tR = R.tops ? R.topR * (0.7 + 0.3 * M.hf) : 0;
      if (R.tops) fightingTop(p, [c1[0] + r0 * 0.7, y1, 0], tR, C.topCol || mul(sparC, 0.85), R.tops);
      else { p.shade(grainX(0.1)).ink(mul(sparC, 0.8), 0.8); for (const sg of [-1, 1]) { p.T(c1[0] + r0 * 0.7 + sg * r0 * 1.3, y1, 0).box(0.03, 0.035, 0.5 * (0.6 + 0.4 * M.hf) + r0 * 2); p.T(c1[0] + r0 * 0.7, y1 - 0.03, sg * r0 * 1.1).box(r0 * 4.6, 0.04, 0.026); } p.shade(null); }
      p.ink(big ? IRON : mul(sparC, 0.7), 0.6, big ? 0.7 : 0).T(c1[0] + r0 * 0.75, y1 + 0.085, 0).box(r0 * 3.9, 0.04, r0 * 2.3, 0.008);
      M.topR = tR || 0.25 * (0.6 + 0.4 * M.hf) + r0;
    }
    if (y2) { const c2 = M.at(y2, M.secs[1]); p.shade(grainX(0.1)).ink(mul(sparC, 0.8), 0.8); for (const sg of [-1, 1]) { p.T(c2[0] + r0 * 0.5 + sg * r0 * 0.9, y2, 0).box(0.024, 0.028, 0.46 * M.hf); p.T(c2[0] + r0 * 0.5, y2 - 0.024, sg * r0 * 0.7).box(r0 * 3.4, 0.03, 0.02); } p.shade(null); p.ink(IRON, 0.6, 0.7).T(c2[0] + r0 * 0.5, y2 + 0.06, 0).box(r0 * 2.6, 0.03, r0 * 1.5, 0.006); M.crossR = 0.23 * M.hf; }
    const tk = M.at(top);
    p.ink(GILT, 0.4, 0.8).T(tk[0], top + 0.012, 0, 0, 0, 0, 1, 0.6, 1).sphere(M.rad(top) * 1.7, 7, 4);
    p.ink(sparC, 0.75).bar([tk[0], top, 0], [tk[0], top + (st.kind === 'skiff' ? 0.2 : 0.34), 0], 0.009, 0.006, 5, 1);
    flags.push({ kind: mi === (Ms.length > 2 ? 1 : Ms.length - 1) || Ms.length === 1 ? 'pennant' : 'vane', at: [tk[0], top + (st.kind === 'skiff' ? 0.2 : 0.34), 0], mast: mi });

    // --- shrouds, deadeyes and ratlines (starboard, mirrored to port)
    const hasCh = st.chW > 0.05, nS = Math.max(1, R.shrouds - (M.hf < 0.85 ? 1 : 0)), span = Math.min(0.2 * hgt, 0.95), yH = (y1 ?? yb + hgt * 0.8) - 0.05;
    const shr = [];
    {
      const g = M.g, yref = H.railY(M.s, g);
      for (let k = 0; k < nS; k++) {
        const x = M.xb - 0.03 - (nS > 1 ? (span * k) / (nS - 1) : span * 0.4), ss = H.sOf(x, yref), yCh = H.railY(ss, g) - (hasCh ? 0.055 : 0.03);
        const d0 = H.pt(ss, yCh, hasCh ? st.chW - 0.025 : 0.012); d0[1] += hasCh ? 0.028 : 0.0;
        const hd = M.at(yH, M.secs[0]); hd[2] = r0 * 0.6;
        const dirU = norm3(sub3(hd, d0)), d1 = add3(d0, dirU, 0.13);
        shr.push({ ss, yCh, d0, d1, hd, foot: H.pt(ss, yCh - (hasCh ? 0.3 : 0.16), 0.006) });
      }
      M.ch = { sa: shr[shr.length - 1].ss, sb: shr[0].ss, yCh: (s) => H.railY(s, g) - 0.055 };
    }
    bothSides(p, () => {
      if (hasCh) {
        const cols = H.between(M.ch.sa - 0.05 / L, M.ch.sb + 0.05 / L), prof = [[st.chW, -0.014], [st.chW, 0.014], [0, 0.014], [0, -0.014]];
        p.shade(grainX(0.12)).ink(C.wale, 0.82);
        sweepHard(p, H, cols, M.ch.yCh, prof); sweepCap(p, H, cols[0], M.ch.yCh, prof, true); sweepCap(p, H, cols[cols.length - 1], M.ch.yCh, prof, false);
        p.shade(null);
      }
      for (const q of shr) {
        if (far) { rope(p, q.d0, q.hd, 0.011, TAR, 0, 3); continue; }
        p.ink(IRON, 0.5, 0.8).bar(q.foot, q.d0, 0.008, 0.008, 4, 0);
        p.ink(mul(OAK, 0.5), 0.7);
        for (const d of [q.d0, q.d1]) p.T(d[0], d[1], d[2], 90, 0, 0).cyl(0.027, 0.027, 0.02, 6);
        rope(p, q.d0, q.d1, 0.009, HEMP, 0, 3);
        rope(p, q.d1, q.hd, 0.011, TAR, 0, 5);
      }
      if (nS > 1 && !lite) {
        const a = shr[0], b = shr[nS - 1], on = (q, y) => lerp3(q.d1, q.hd, (y - q.d1[1]) / (q.hd[1] - q.d1[1]));
        for (let y = Math.max(a.d1[1], b.d1[1]) + 0.13; y < yH - 0.22; y += 0.15 * eco) rope(p, on(a, y), on(b, y), 0.0048, TAR, 0, 3);
      }
      // futtock shrouds under the top, topmast shrouds above it, with their ratlines
      if (y1 && M.parts >= 2) {
        const tR = M.topR, cx = M.at(y1, M.secs[0])[0] + r0 * 0.7, yT = (y2 ?? top) - 0.06, n2 = M.parts === 3 ? 3 : 2;
        const feet = [], heads = [];
        for (let k = 0; k < n2; k++) { const f = [cx + 0.1 - k * 0.11, y1 + 0.03, tR * 0.96]; feet.push(f); const hq = M.at(yT, M.secs[1]); hq[2] = r0 * 0.3; heads.push(hq); rope(p, f, hq, 0.008, TAR, 0, 4); if (R.tops && !far) rope(p, f, [M.at(y1 - 0.34)[0], y1 - 0.34, r0 * 0.8], 0.008, TAR, 0, 3); }
        if ((M.parts === 3 || st.kind === 'galleon') && !lite) { const on = (k, y) => lerp3(feet[k], heads[k], (y - feet[k][1]) / (heads[k][1] - feet[k][1])); for (let y = y1 + 0.2; y < yT - 0.18; y += 0.13 * eco) rope(p, on(0, y), on(n2 - 1, y), 0.0042, TAR, 0, 3); }
        if (y2) { const f = [M.at(y2, M.secs[1])[0] + r0 * 0.5, y2 + 0.02, M.crossR], hq = M.at(top - 0.2); rope(p, f, [hq[0], hq[1], 0.01], 0.006, TAR, 0, 3); }
        // backstays to the channel abaft the shrouds
        const bs = shr[nS - 1], ssb = Math.max(0.005, bs.ss - 0.16 / L), foot = H.pt(ssb, H.railY(ssb, M.g) - 0.03, hasCh ? st.chW * 0.5 : 0.012);
        const hq = M.at(yT, M.secs[1]); rope(p, foot, [hq[0], hq[1], 0.02], 0.009, TAR, 0, 4);
        if (y2) { const h3 = M.at(top - 0.12); const f3 = H.pt(Math.max(0.004, ssb - 0.1 / L), H.railY(Math.max(0.004, ssb - 0.1 / L), M.g) - 0.03, hasCh ? st.chW * 0.5 : 0.012); rope(p, f3, [h3[0], h3[1], 0.012], 0.007, TAR, 0, 3); }
      }
    });

    // --- stays leading forward
    const fwdPt = (lvl) => {
      if (prev) return lvl === 0 ? prev.at(prev.yb + prev.hgt * 0.16) : lvl === 1 ? prev.at((prev.y1 ?? prev.yb + prev.hgt * 0.6) + 0.02) : prev.at((prev.y2 ?? prev.top) - 0.05);
      if (sprit) return sprit.pt(lvl === 0 ? 0.42 : lvl === 1 ? 0.97 : 1.96);
      return [stemFront(H, st, H.railY(1)) - 0.03, H.railY(1) + 0.03, 0];
    };
    M.stays = [];
    const stay = (y, lvl, r) => { const a = M.at(y), b = fwdPt(lvl); rope(p, a, b, r, TAR, 0, 5); M.stays.push([b, a]); };
    stay((y1 ?? top - hgt * 0.14) - 0.03, 0, 0.014);
    if (y1) stay((y2 ?? top) - 0.08, 1, 0.011);
    if (y2) stay(top - 0.1, 2, 0.008);

    // --- yards and square sails
    if (M.type === 'square' || M.type === 'mizzen') {
      const beta = (8 + 2.5 * mi) * DEG, dirY = [Math.sin(beta), 0, Math.cos(beta)];
      const wC = (1.28 * H.B + 0.35) * (0.62 + 0.38 * M.hf) * (M.type === 'mizzen' ? 0.8 : 1);
      const clear = big ? 0.72 : 0.6;
      const yC = (y1 ?? yb + hgt * 0.55) - 0.16, yT = y2 ? y2 - 0.1 : top - Math.max(0.2, 0.06 * hgt), yG = top - Math.max(0.16, 0.05 * hgt);
      const plan = [];   // [yard height, yard length, sail?]
      if (M.type === 'square') { plan.push([yC, wC, true]); if (M.sq >= 2) plan.push([yT, wC * 0.78, true]); if (M.sq >= 3 && y2) plan.push([yG, wC * 0.55, true]); }
      else { plan.push([yC, wC, false]); plan.push([yT, wC * 0.76, true]); if (M.sq >= 2 && y2) plan.push([yG, wC * 0.54, true]); }
      plan.forEach(([y, len, set], k) => {
        const ry = r0 * (k === 0 ? 0.56 : k === 1 ? 0.42 : 0.32), c = [M.fwd(y) + ry + 0.012, y, 0];
        yard(p, c, len, ry, dirY, yardC);
        if (k === 0 || (st.kind === 'manowar' && k === 1)) footRopes(p, c, len, dirY);
        // lifts to the masthead, braces led aft (or forward from the mizzen)
        const up = M.at(Math.min(top - 0.02, y + (k === 0 ? 0.42 : 0.3)));
        for (const e of [-1, 1]) {
          const arm = add3(c, dirY, e * len * 0.47);
          rope(p, arm, up, 0.0055, HEMP, 0, 3);
          const tgt = M.type === 'mizzen' && prev ? prev.at(Math.min(prev.top - 0.1, y + 0.1)) : next ? next.at(Math.min(next.top - 0.15, y - 0.12)) : (() => { const q = railAt(0.03); return [q[0], q[1], e * q[2]]; })();
          rope(p, arm, [tgt[0], tgt[1], tgt[2] || e * 0.03], 0.0055, HEMP, 0.03 * dist3(arm, tgt), 3);
        }
        if (!set) return;
        const below = k === 0 ? null : plan[k - 1];
        const drop = k === 0 ? y - ry - (yb + clear) : y - below[0] - ry - 0.07;
        const wHead = len * 0.9, wFoot = k === 0 ? len * 0.92 : below[1] * 0.9, wears = !!st.device && (mi === devMast || (mi === 0 && Ms.length > 2 && Ms[devMast].type === 'square')) && k === (plan.length > 1 ? 1 : 0);   // a three-master shows it on the fore topsail too, to ships ahead
        const sl = (st.sqSail || squareSail)(p, { mi, k, c: [c[0], y - ry - 0.012, 0], beta, wHead, wFoot, drop, belly: 0.17 * drop + 0.045 * wHead, col: sailC, seed: mi * 10 + k, reefs: k === 0 ? [0.2] : k === 1 ? [0.14, 0.28] : [], stripe: C.sailStripe, roach: k === 0 ? 0.1 : 0.06, fine: wears });
        if (wears) device(sl, 0.34, 0.53);
        // robands: the lashings that bend the head of the sail to its yard
        p.ink(mul(HEMP, 0.8), 0.95);
        if (!lite) for (let i = 0; i <= 8; i++) { const q = add3(c, dirY, (i / 8 - 0.5) * wHead); p.TM(frame(q, dirY, [0, 1, 0])).T2(0, 0, 0, 0, 0, 90).lathe([[ry * 0.9 + 0.003, -0.008], [ry * 0.9 + 0.01, 0.008]], 5); }
        if (k === 0) {
          // sheets aft and tacks forward from the clews of a course
          for (const e of [0, 1]) { const cl = sl.clews[e], sg = e ? 1 : -1, sA = clamp(M.s - 0.75 / L, 0.01, 0.98), sF = clamp(M.s + 0.5 / L, 0.01, 0.985), a = railAt(sA), f = railAt(sF); rope(p, cl, [a[0], a[1], sg * a[2]], 0.007, HEMP, 0.06, 3); rope(p, cl, [f[0], f[1], sg * f[2]], 0.007, HEMP, 0.04, 3); block(p, cl, 1.2); }
        } else for (const e of [0, 1]) block(p, sl.clews[e], 1);
      });
    }
    // --- fore-and-aft sails: gaff, spanker, lug, lateen
    if (M.type === 'gaff' || M.type === 'mizzen') {
      const gam = (M.type === 'mizzen' ? 12 : 17) * DEG, isLast = !next;
      const yBoom = yb + (st.kind === 'sloop' || st.kind === 'cutter' ? 0.52 : 0.62), g0 = M.at(yBoom); g0[0] -= M.rad(yBoom) + 0.02;
      const room = isLast ? g0[0] - H.x(0, yBoom) : g0[0] - next.xb - next.r0 * 2 - 0.1;
      const Lb = Math.max(0.5, room * (isLast ? (M.type === 'mizzen' ? 1.02 : 1.0) : 0.92)), db = [-Math.cos(gam), 0.03, -Math.sin(gam)];
      const bEnd = add3(g0, db, Lb), yTh = (y1 ?? yb + hgt * 0.72) - 0.2, th = M.at(yTh); th[0] -= M.rad(yTh) + 0.02;
      const wearsG = !!st.device && mi === devMast && M.type === 'gaff';
      const pk = 34 * DEG, dg = [-Math.cos(gam) * Math.cos(pk), Math.sin(pk), -Math.sin(gam) * Math.cos(pk)], Lg = Lb * (M.type === 'mizzen' ? 0.66 : 0.6), gEnd = add3(th, dg, Lg);
      p.shade(grainX(0.12)).ink(yardC, 0.72).bar(g0, bEnd, r0 * 0.5, r0 * 0.38, 8, 3); p.bar(th, gEnd, r0 * 0.44, r0 * 0.28, 8, 3);
      p.shade(null).ink(IRON, 0.5, 0.8);
      if (!far) for (const q of [g0, th]) p.T(q[0] + 0.02, q[1], 0).cyl(M.rad(q[1]) + 0.012, M.rad(q[1]) + 0.012, 0.045, 10, 0);
      const gs = (st.gaffSail || gaffSail)(p, { tack: add3(g0, [-0.02, 0.05, 0]), clew: add3(g0, db, Lb * 0.95), throat: add3(th, [-0.02, -0.04, 0]), peak: add3(th, dg, Lg * 0.95), belly: 0.11 * Lb + 0.05, col: sailC, seed: 40 + mi, reefs: [0.16, 0.3], uc: 0.4, vc: 0.56, fine: wearsG });
      if (wearsG) device(gs, 0.27);
      // mast hoops up the luff
      p.ink(mul(sparC, 0.7), 0.8);
      if (!far) for (let y = yBoom + 0.2; y < yTh - 0.1; y += 0.2) { const c = M.at(y), rr = M.rad(y) + 0.008; p.TM(X(c[0], y, 0, 0, 0, M.rake)).lathe([[rr, -0.008], [rr + 0.008, 0], [rr, 0.008]], 8); }
      // topping lift, peak halyard, sheet and vangs
      const mh = M.at(Math.min(top - 0.05, (y1 ?? top) + 0.25));
      rope(p, bEnd, M.at(Math.min(top - 0.05, (y1 ?? top) + 0.05)), 0.006, HEMP, 0, 3);
      rope(p, lerp3(th, gEnd, 0.6), mh, 0.006, HEMP, 0, 3); rope(p, gEnd, mh, 0.006, HEMP, 0, 3);
      const sh = isLast ? [Math.max(H.x(0, yBoom) + 0.12, bEnd[0] + 0.05), H.deckY(clamp(H.sOf(bEnd[0], yb), 0, 1), 0) + 0.08, 0] : [bEnd[0] + 0.1, yb + 0.08, 0];
      if (isLast) sh[1] = Math.max(sh[1], H.railY(0) - 0.25);
      rope(p, add3(g0, db, Lb * 0.9), sh, 0.008, HEMP, 0, 3); rope(p, add3(g0, db, Lb * 0.84), [sh[0] + 0.06, sh[1], sh[2]], 0.008, HEMP, 0, 3); block(p, add3(add3(g0, db, Lb * 0.9), [0, -0.05, 0]), 1.3);
      // a gaff topsail above
      if (M.type === 'gaff' && M.parts >= 2) triSail(p, { tack: add3(th, [0.0, 0.1, 0]), head: (() => { const q = M.at(top - 0.14); q[0] -= M.rad(top - 0.14) + 0.012; return q; })(), clew: add3(th, dg, Lg * 0.93), belly: 0.06 * Lg, col: sailC, seed: 50 + mi });
      if (isLast && M.type === 'gaff') flags.push({ kind: 'ensign', at: add3(gEnd, [0, 0.02, 0]), gaff: true });
      M.boomEnd = bEnd; M.gaffEnd = gEnd;
    }
    if (M.type === 'lug') {
      const yY = yb + hgt * 0.86, c = M.at(yY), lenY = hgt * 0.72, sl = 24 * DEG, gam = 10 * DEG;
      const dY = [-Math.cos(sl) * Math.cos(gam), Math.sin(sl), -Math.sin(gam) * Math.cos(sl)];
      const yc = [c[0] - 0.05, yY - 0.08, -(M.rad(yY) + 0.03)], a = add3(yc, dY, -lenY * 0.36), b = add3(yc, dY, lenY * 0.64);
      p.shade(grainX(0.12)).ink(yardC, 0.72).bar(yc, a, r0 * 0.44, r0 * 0.3, 7, 1); p.bar(yc, b, r0 * 0.44, r0 * 0.28, 7, 1);
      const tack = [M.xb + 0.42, yb + 0.56, -0.05], clew = [M.xb - lenY * 0.86, yb + 0.66, -0.3];
      const gs = gaffSail(p, { tack, clew, throat: add3(a, [0, -0.03, 0]), peak: add3(b, [0, -0.03, 0]), belly: 0.1 * lenY + 0.04, col: sailC, seed: 60, reefs: [0.2], flatHead: 0.4, uc: 0.5, vc: 0.58, fine: !!st.device && mi === devMast });
      if (mi === devMast && st.device) device(gs, 0.25);
      rope(p, tack, [M.xb + 0.42, yb + 0.1, 0.02], 0.007, HEMP, 0, 3); rope(p, clew, [H.x(0.04, yb + 0.4), H.railY(0.04) - 0.02, 0.0], 0.007, HEMP, 0.03, 3);
      rope(p, yc, M.at(top - 0.04), 0.006, HEMP, 0, 3);
    }
    if (M.type === 'lateen') {
      const gam = 14 * DEG, sl = 50 * DEG, lenY = hgt * 1.12, yH2 = yb + hgt * 0.72, c = M.at(yH2);
      const dY = [-Math.cos(sl) * Math.cos(gam), Math.sin(sl), -Math.sin(gam) * Math.cos(sl)];
      const yc = [c[0], yH2, -(M.rad(yH2) + 0.03)], a = add3(yc, dY, -lenY * 0.46), b = add3(yc, dY, lenY * 0.54);
      p.shade(grainX(0.12)).ink(yardC, 0.72).bar(yc, a, r0 * 0.5, r0 * 0.34, 8, 1); p.bar(yc, b, r0 * 0.5, r0 * 0.26, 8, 1);
      const clew = [Math.max(H.x(0, yb) + 0.25, M.xb - lenY * 0.62), yb + 0.72, -0.34];
      (st.triSail || triSail)(p, { tack: add3(a, [0, -0.02, 0]), head: add3(b, [0, -0.03, 0]), clew, belly: 0.1 * lenY, col: sailC, seed: 65 });
      rope(p, clew, [H.x(0, yb) + 0.1, H.railY(0) - 0.05, -0.1], 0.007, HEMP, 0.02, 3); rope(p, a, [a[0] + 0.1, yb + 0.1, 0.25], 0.007, HEMP, 0, 3);
      rope(p, yc, M.at(top - 0.04), 0.007, HEMP, 0, 3); rope(p, b, M.at(top - 0.02), 0.005, HEMP, 0, 3);
      flags.push({ kind: 'vane', at: add3(b, [0, 0.03, 0]), mast: 9 });
    }
  });
  // --- headsails on the stays of the foremast
  const F = Ms[0];
  if (sprit && R.jibs && F.stays) {
    const stays = F.stays.slice(0, R.jibs);
    stays.forEach(([a, b], k) => {
      const len = dist3(a, b), tack = lerp3(a, b, 0.05), head = lerp3(a, b, k === 0 && F.type !== 'gaff' ? 0.86 : 0.8), foot = len * (0.36 - 0.03 * k);
      const clew = [tack[0] - foot * 0.82, tack[1] + 0.12 + 0.1 * k, -(0.2 + 0.08 * k) - foot * 0.16];
      triSail(p, { tack, head, clew, belly: 0.07 * len, col: sailC, seed: 80 + k });
      const q = railAt(clamp(H.sOf(clew[0] - 0.5, H.railY(0.9)), 0.3, 0.97)); rope(p, clew, [q[0], q[1], -q[2]], 0.006, HEMP, 0.04, 3); block(p, clew, 1);
    });
  }
  // --- the ensign: on the gaff of a fore-and-after, on its own staff over the taffrail otherwise.
  // Colours are worn large, as they were: they are how a ship is told from her enemy across the water.
  const eh = clamp(0.115 * L, 0.36, 1.15);
  if (!flags.some((f) => f.kind === 'ensign') && st.kind !== 'raft') {
    const y0 = H.railY(0) + (st.stern && st.stern.arch ? st.stern.arch + 0.02 : 0), x0 = H.x(0, y0) + 0.02, hS = st.kind === 'skiff' ? 0.62 : Math.max(clamp(0.16 * L, 0.8, 1.5), eh + 0.42);
    const z0 = st.stern && st.stern.lanterns ? Math.min(0.3, H.z(0, y0) * 0.4) : 0;
    p.shade(grainY(0.1)).ink(sparC, 0.72).bar([x0, y0 - 0.25, z0], [x0 - hS * 0.2, y0 + hS, z0], 0.016, 0.01, 6, 1);
    p.ink(GILT, 0.4, 0.8).T(x0 - hS * 0.2, y0 + hS + 0.01, z0).sphere(0.02, 6, 4);
    flags.push({ kind: 'ensign', at: [x0 - hS * 0.2, y0 + hS - 0.01, z0], staff: true });
  }
  // sizes: pennants long at the main, short vanes elsewhere; the ensign scales with the ship
  flags.forEach((f, i) => { f.seed = i + 1; if (f.kind === 'device') return; if (f.kind === 'ensign') { f.hgt = f.gaff ? eh * 0.85 : eh; f.len = f.hgt * 1.6; } else if (f.kind === 'pennant') { f.hgt = 0.17 + 0.012 * L; f.len = clamp(0.32 * L, 0.8, 3.2); } else { f.kind = 'flag'; f.hgt = 0.24 + 0.014 * L; f.len = f.hgt * 1.7; } });
  return flags;
}

// ---------- fitting out: what stands on the decks of each class ----------
function fitOut(p, H, st) {
  const C = st.col, k = st.kind, L = H.L, R = st.rig, wood = mul(C.rail, 1.05), t = H.o.thick;
  /** run fn with the origin on deck at station s, zf of the way out to the bulwark, turned ry degrees */
  const on = (s, zf, fn, ry = 0, g = H.seg(s)) => { const q = H.on(s, zf, g); p.push(X(q[0], q[1], q[2], 0, ry, 0)); fn(); p.pop(); };
  const onS = far ? () => {} : on;   // small things that are left ashore on the distant build
  const from = p.n;
  const segOf = (s) => H.seg(s);
  // timberheads: the frame tops standing inside the bulwarks, and a pin rail abreast each mast
  if (!st.open && !lite) bothSides(p, () => {
    H.segs.forEach((g) => {
      if (g.bul < 0.25) return;
      const n = Math.max(1, Math.round(((g.s1 - g.s0) * L) / 0.46));
      for (let i = 0; i <= n; i++) {
        const ss = clamp(lerp(g.s0, g.s1, i / n), g.s0 + 0.03 / L, Math.min(g.s1, 0.975) - 0.03 / L);
        if (st.openPorts.some((q) => Math.abs(q.s - ss) < q.hw + 0.035 / L)) continue;
        const y0 = H.deckEdge(ss, g), y1 = H.railY(ss, g) - 0.01, ym = (y0 + y1) / 2, n2 = H.nh(ss, ym), zi = H.zIn(ss, ym);
        if (zi < 0.12) continue;
        p.shade(grainY(0.12)).ink(mul(C.inner, 0.82), 0.85).TM(frame([H.x(ss, ym) - n2[0] * 0.018, ym, zi - n2[1] * 0.018], [n2[1], 0, -n2[0]], [0, 1, 0])).box(0.05, y1 - y0, 0.04);
      }
    });
    for (const m of R.masts) {
      const g = segOf(m.s);
      if (g.bul < 0.3 || k === 'sloop' || k === 'cutter') continue;
      const ss = m.s - 0.3 / L, y = H.railY(ss, g) - 0.11, n2 = H.nh(ss, y), zi = H.zIn(ss, y);
      p.push(frame([H.x(ss, y) - n2[0] * 0.035, y, zi - n2[1] * 0.035], [n2[1], 0, -n2[0]], [0, 1, 0])); pinRail(p, 0.5, mul(C.rail, 0.9)); p.pop();
    }
    p.shade(null);
  });
  // around the foot of each mast
  R.masts.forEach((m) => { if (k !== 'skiff' && (m.type === 'square' || k === 'manowar' || k === 'galleon')) onS(m.s, 0, () => fifeRail(p, 0.36 + 0.02 * L, wood)); });
  const kegs = (s, zf, n, seed = 0) => { if (!far) for (let i = 0; i < n; i++) on(s + (i * 0.26) / L, zf, () => barrel(p, 0.105, 0.3, mul(OAK, 1.05), seed + i)); };
  const tiller = (len, yUp) => {
    const g = H.segs[0], y0 = H.railY(0, g) + 0.03, x0 = H.x(0, y0) - 0.03, q = H.on(len / L, 0, g);
    p.shade(grainX(0.12)).ink(wood, 0.72).tube([[x0 - 0.02, y0 - 0.3, 0], [x0, y0 + 0.02, 0], [x0 + len * 0.3, y0 + 0.05, 0], [x0 + len * 0.7, q[1] + yUp + 0.03, 0], [q[0], q[1] + yUp, 0]], [0.03, 0.03, 0.028, 0.022, 0.018], 7, 1);
    p.shade(null).ink(BRASS, 0.4, 0.9).T(q[0], q[1] + yUp, 0).sphere(0.024, 7, 5);
  };
  const cathead = (s, len = 0.3) => bothSides(p, () => {
    const g = segOf(s), y = H.railY(s, g) - 0.02, a = H.pt(s, y, -0.12), n2 = H.nh(s, y), dir = norm3([n2[0] + 0.5, 0.12, n2[1]]), b = add3(a, dir, len + 0.12);
    p.shade(grainX(0.12)).ink(C.wale, 0.82).TM(frame(lerp3(a, b, 0.5), dir, [0, 1, 0])).box(len + 0.12, 0.085, 0.085, 0.012);
    p.shade(null).ink(GILT, 0.4, 0.8).TM(frame(add3(b, dir, 0.004), [0, 1, 0], [0, 0, 1])).T2(0, 0, 0, 0, 0, 0).box(0.07, 0.07, 0.012, 0.004);
    const top = add3(b, dir, -0.05);
    rope(p, [top[0], top[1] - 0.04, top[2]], [top[0], top[1] - 0.12, top[2]], 0.01, HEMP);
    p.push(X(top[0], top[1] - 0.12, top[2], 0, 90 - Math.atan2(n2[1], n2[0]) / DEG, 0)); anchor(p, clamp(0.08 * L, 0.36, 0.78)); p.pop();
  });
  const boatAt = (s, zf, len, beam, seed, up = 0.1) => on(s, zf, () => { chocks(p, len, beam, wood); p.push(X(0, up, 0)); shipsBoat(p, len, beam, hex(0xd8d2c0), hex(0x9a8560), seed); p.pop(); });
  switch (st.fitAs || k) {
    case 'none': break;   // fleets.js furnishes its own decks
    case 'skiff': {
      const g = H.segs[0];
      // ribs, thwarts and stern sheets of an open boat
      bothSides(p, () => {
        p.shade(grainY(0.12)).ink(mul(C.inner, 0.78), 0.85);
        if (!far) for (let ss = 0.08; ss < 0.95; ss += 0.26 / L) { const pts = []; for (let i = 0; i <= 5; i++) { const y = lerp(H.deckEdge(ss, g) - 0.01, H.railY(ss, g) - 0.01, i / 5); pts.push([H.x(ss, y), y, H.zIn(ss, y) - 0.012]); } p.tube(pts, 0.016, 4); }
        const cols = H.between(0.03, 0.97);
        p.shade(grainX(0.12)).ink(mul(C.inner, 0.9), 0.85);
        sweep(p, H, cols, (ss) => H.railY(ss, g) - 0.13, [[-t - 0.03, -0.02], [-t - 0.03, 0.02], [-t, 0.02]]);
        // thole pins for the oars
        p.shade(null).ink(mul(SPAR, 0.8), 0.8);
        if (!far) for (const ss of [0.36, 0.56]) for (const dx of [-0.035, 0.035]) { const q = H.pt(ss + dx / L, H.railY(ss, g) + st.capH, -t / 2); p.T(q[0], q[1] + 0.03, q[2]).cyl(0.009, 0.011, 0.07, 5); }
      });
      const thwart = (ss, w = 0.2) => { const y = H.railY(ss, g) - 0.13; p.shade(grainX(0.14, 2)).ink(vary(C.thwart, ss * 100, 0.08), 0.8).T(H.x(ss, y), y + 0.012, 0).box(w, 0.028, 2 * H.zIn(ss, y) - 0.02, 0.006); if (!far) for (const sg of [-1, 1]) p.ink(mul(C.inner, 0.8), 0.85).T(H.x(ss, y), y - 0.03, sg * (H.zIn(ss, y) - 0.07), sg * 35, 0, 0).box(0.05, 0.1, 0.03); };
      for (const ss of [0.3, 0.5, 0.63, 0.8]) thwart(ss, ss === 0.63 ? 0.26 : 0.2);
      { const y = H.railY(0.07, g) - 0.13; p.T(H.x(0.07, y), y + 0.012, 0).box(0.42, 0.028, 2 * H.zIn(0.09, y) - 0.02, 0.006); }
      p.shade(null);
      tiller(0.55, 0.36);
      // oars stowed along the thwarts
      for (const sg of [-1, 1]) for (const dz of [0, 0.07]) {
        const y = H.railY(0.5, g) - 0.085, z = sg * (0.3 + dz), a = [H.x(0.26, y), y + dz * 0.3, z], b = [H.x(0.86, y), y + 0.05, z * 0.55];
        p.shade(grainX(0.1)).ink(mul(SPAR, 1.15), 0.75).bar(a, b, 0.017, 0.014, 6);
        p.TM(frame(lerp3(a, b, 0.08), sub3(a, b), [0, 1, 0])).box(0.34, 0.012, 0.075, 0.004);
      }
      // one swivel gun on the gunwale for each gun of the broadside
      bothSides(p, () => { for (let i = 0; i < st.per; i++) { const ss = st.per === 1 ? 0.44 : lerp(0.26, 0.76, i / (st.per - 1)), q = H.pt(ss, H.railY(ss, g) + st.capH, -t / 2); p.push(X(q[0], q[1] + 0.1, q[2])); swivelGun(p, 0.34); p.pop(); } });
      on(0.9, 0, () => { coil(p, 0.11, 3, 0.013); }, 0, g);
      on(0.83, 0.3, () => { p.push(X(0, 0.24, 0, 0, 0, 78)); anchor(p, 0.36); p.pop(); }, 20, g);
      onS(0.4, -0.3, () => bucket(p, mul(OAK, 1.1)), 0, g);
      onS(0.18, 0.4, () => barrel(p, 0.08, 0.22, mul(OAK, 1.05), 3), 0, g);
      onS(0.72, -0.35, () => crate(p, 0.22, 0.16, 0.2, mul(OAK, 1.2), 4), 12, g);
      { const y = H.railY(1, g) + 0.1, x = stemFront(H, st, y) - 0.02; p.push(X(x, y, 0)); p.ink(IRON, 0.5, 0.8).tube([[0, -0.04, 0], [0.05, 0.02, 0], [0.09, 0.0, 0]], 0.008, 4); p.push(X(0.09, -0.19, 0)); lantern(p, 0.17); p.pop(); p.pop(); }
      break;
    }
    case 'sloop': case 'cutter': {
      const aft = H.segs[0];
      tiller(k === 'sloop' ? 0.62 : 0.56, 0.4);
      on(aft.s1 - 0.36 / L, 0, () => companion(p, 0.4, 0.42, 0.36, wood), 0, aft);
      if (k === 'sloop') { on(0.41, 0, () => skylight(p, 0.4, 0.34, wood)); on(0.515, 0, () => hatch(p, 0.36, 0.44, wood, false)); on(0.74, 0, () => hatch(p, 0.34, 0.4, wood)); }
      else { on(0.53, 0, () => deckhouse(p, 0.74, 0.62, 0.3, hex(0xd8d0bc), DECK)); on(0.8, 0, () => hatch(p, 0.32, 0.36, wood)); on(0.3, 0, () => hatch(p, 0.26, 0.36, wood, false)); }
      onS(0.87, 0, () => bitts(p, 0.26, 0.3, wood));
      on(0.845, 0, () => { p.shade(grainX(0.12)).ink(wood, 0.8).T(0, 0.13, 0, 90, 0, 0).cyl(0.07, 0.07, 0.5, 8); p.shade(null).ink(IRON, 0.5, 0.8); for (const sg of [-1, 1]) p.T(0, 0.13, sg * 0.26, 90).cyl(0.085, 0.085, 0.02, 8); for (const sg of [-1, 1]) p.ink(wood, 0.8).T(0, 0.1, sg * 0.3).box(0.08, 0.2, 0.05, 0.008); });
      cathead(0.9, 0.2);
      kegs(k === 'sloop' ? 0.34 : 0.27, -0.72, 2, 11);
      on(k === 'sloop' ? 0.56 : 0.42, 0.62, () => coil(p, 0.1, 3, 0.012));
      onS(k === 'sloop' ? 0.66 : 0.6, -0.66, () => crate(p, 0.24, 0.2, 0.22, mul(OAK, 1.15), 8), 14);
      onS(k === 'sloop' ? 0.36 : 0.76, 0.7, () => bucket(p, mul(OAK, 1.1)));
      break;
    }
    case 'brigantine': {
      const qd = H.segs[0];
      on(0.15, 0, () => shipWheel(p, 0.2, wood), 0, qd); onS(0.195, 0, () => binnacle(p, wood), 0, qd);
      on(0.25, 0, () => skylight(p, 0.34, 0.4, wood), 0, qd);
      on(0.5, 0, () => hatch(p, 0.56, 0.64, wood)); on(0.6, 0, () => capstan(p, 0.4, wood));
      on(0.8, 0, () => hatch(p, 0.3, 0.4, wood, false)); onS(0.865, 0, () => bitts(p, 0.3, 0.32, wood));
      onS(0.78, -0.6, () => stovePipe(p, 0.42));
      cathead(0.915, 0.24);
      kegs(0.43, -0.74, 2, 21); on(0.56, 0.72, () => coil(p, 0.11, 3, 0.013)); onS(0.66, 0.7, () => crate(p, 0.26, 0.22, 0.26, mul(OAK, 1.15), 9), 8);
      on(0.44, 0.74, () => shotRack(p, 4)); onS(0.1, -0.6, () => bucket(p, mul(OAK, 1.1)), 0, qd);
      break;
    }
    case 'frigate': {
      const qd = H.segs[0], fc = H.segs[2];
      on(0.225, 0, () => shipWheel(p, 0.22, wood), 0, qd); onS(0.262, 0, () => binnacle(p, wood), 0, qd);
      on(0.3, 0, () => skylight(p, 0.3, 0.44, wood), 0, qd); on(0.07, 0, () => hatch(p, 0.3, 0.4, wood, false), 0, qd);
      on(0.435, 0, () => capstan(p, 0.44, wood));
      on(0.6, 0, () => hatch(p, 0.36, 0.7, wood));
      boatAt(0.715, 0, 1.25, 0.46, 30);
      onS(0.9, -0.4, () => stovePipe(p, 0.44), 0, fc); onS(0.93, 0, () => bitts(p, 0.34, 0.34, wood), 0, fc);
      onS(fc.s0 + 0.14 / L, 0.0, () => belfry(p, wood), 0, fc);
      cathead(0.935, 0.28);
      kegs(0.46, -0.8, 2, 31); on(0.65, 0.8, () => shotRack(p, 5)); on(0.65, -0.8, () => shotRack(p, 5)); on(0.4, 0.56, () => coil(p, 0.12, 3, 0.014));
      onS(0.1, -0.66, () => bucket(p, mul(OAK, 1.1)), 0, qd);
      break;
    }
    case 'galleon': {
      const poop = H.segs[0], hd = H.segs[1], fc = H.segs[3];
      on(0.1, 0, () => skylight(p, 0.34, 0.4, wood), 0, poop);
      on(0.36, 0, () => capstan(p, 0.44, wood), 0, hd); on(0.4, 0, () => hatch(p, 0.2, 0.44, wood), 0, hd); onS(0.225, 0.5, () => binnacle(p, wood), 0, hd);
      boatAt(0.675, 0, 1.5, 0.56, 40);
      on(0.47, 0, () => hatch(p, 0.24, 0.6, wood)); on(0.76, 0, () => hatch(p, 0.2, 0.6, wood));
      kegs(0.46, -0.78, 3, 41); kegs(0.47, 0.78, 2, 47); onS(0.6, 0.84, () => crate(p, 0.3, 0.26, 0.28, mul(OAK, 1.15), 12), 6); onS(0.61, -0.84, () => crate(p, 0.26, 0.22, 0.26, mul(OAK, 1.1), 13), -8);
      onS(fc.s0 + 0.14 / L, 0, () => belfry(p, wood), 0, fc); onS(0.9, 0, () => bitts(p, 0.4, 0.36, wood), 0, fc); onS(0.83, 0.5, () => stovePipe(p, 0.46), 0, fc);
      on(0.93, 0, () => coil(p, 0.13, 3, 0.015), 0, fc);
      cathead(0.925, 0.3);
      on(0.3, -0.66, () => coil(p, 0.11, 3, 0.013), 0, hd);
      break;
    }
    default: {
      const poop = H.segs[0], qd = H.segs[1], fc = H.segs[H.segs.length - 1];
      on(0.075, 0, () => skylight(p, 0.4, 0.5, wood), 0, poop); onS(0.02, 0.5, () => crate(p, 0.34, 0.2, 0.26, hex(0x8a2f22), 14), 0, poop); onS(0.02, -0.5, () => crate(p, 0.34, 0.2, 0.26, hex(0x8a2f22), 15), 0, poop);
      on(0.275, 0, () => shipWheel(p, 0.24, wood, true), 0, qd); onS(0.315, 0, () => binnacle(p, wood), 0, qd); on(0.175, 0, () => hatch(p, 0.26, 0.5, wood), 0, qd);
      on(0.445, 0, () => capstan(p, 0.46, wood));
      boatAt(0.635, 0.3, 1.6, 0.56, 50); boatAt(0.635, -0.3, 1.45, 0.5, 60);
      on(0.76, 0, () => hatch(p, 0.34, 0.9, wood));
      on(0.455, 0.8, () => shotRack(p, 6)); on(0.455, -0.8, () => shotRack(p, 6)); kegs(0.73, -0.86, 2, 51); kegs(0.73, 0.86, 2, 55);
      onS(fc.s0 + 0.14 / L, 0, () => belfry(p, wood), 0, fc); onS(0.9, 0, () => bitts(p, 0.44, 0.38, wood), 0, fc); onS(0.87, -0.45, () => stovePipe(p, 0.5), 0, fc); on(0.945, 0, () => coil(p, 0.14, 3, 0.016), 0, fc);
      cathead(0.925, 0.32);
      on(0.2, 0.66, () => coil(p, 0.12, 3, 0.014), 0, qd); onS(0.3, -0.7, () => bucket(p, mul(OAK, 1.1)), 0, qd);
    }
  }
  // hammock nettings along the waist rails of a warship
  if (k === 'manowar' || k === 'frigate') bothSides(p, () => {
    const g = H.segs.find((q) => Math.abs(q.lift) < 0.01);
    const cols = H.between(g.s0 + 0.05 / L, g.s1 - 0.05 / L), pts = cols.map((ss) => { const q = H.pt(ss, H.railY(ss, g) + st.capH, -t / 2); return [q[0], q[1] + 0.055, q[2]]; });
    const sub = far ? 1 : 2, fine = []; for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < sub; j++) fine.push(lerp3(pts[i], pts[i + 1], j / sub)); fine.push(pts[pts.length - 1]);
    p.shade((x, y, z, nx, ny, nz, c) => mul(c, 0.72 + 0.4 * noise3(x * 11, y * 11, z * 11) - (ny < -0.2 ? 0.2 : 0))).ink(hex(0xb9b19c), 0.95).tube(fine, fine.map((q, i) => (i % 2 ? 0.052 : 0.04)), k === 'manowar' ? 5 : 4, 1);
    p.shade(null).ink(IRON, 0.5, 0.8);
    if (!lite) for (let i = 0; i < pts.length; i += 3) { const q = pts[i]; p.T(q[0], q[1] - 0.012, q[2], 0, 0, 90).lathe([[0.058, -0.01], [0.062, 0.01]], 6); }
  });
  p.shade(null);
  // everything on deck sits in a little pool of its own shadow
  p.dim(from, (x, y, z) => {
    if (Math.abs(z) > H.hw) return 1;
    const ss = clamp(x / L + 0.5, 0, 1), g = H.seg(ss), dy = y - H.deckEdge(ss, g);
    return dy > 0.3 || dy < -0.1 ? 1 : 0.62 + 0.38 * smooth(0, 0.16, dy);
  });
}

// ---------- the raft ----------
/** a log lying along local X, centred on the origin: bark with furrows and knots, pale cut ends with growth rings */
function logTimber(p, len, r, seed, bark = hex(0x5e4a33), o = {}) {
  const nu = Math.max(far ? 3 : 6, Math.round(len / (0.14 * eco))), nv = Math.max(6, Math.round((o.sides || 16) * (far ? 0.5 : lite ? 0.75 : 1)));
  const bend = (hash1(seed * 3 + 1) - 0.5) * 0.05 * len, taper = 0.84 + 0.12 * hash1(seed + 5);
  const rad = (t, a) => r * lerp(1, taper, t) * (1 + 0.1 * noise3(t * len * 3.1 + seed, Math.cos(a) * 1.7, Math.sin(a) * 1.7 + seed) + 0.05 * Math.sin(a * 3 + seed) + 0.035 * Math.sin(a * 11 + t * len * 4 + seed * 2));
  const P = (t, a) => { const rr = rad(t, a); return [(t - 0.5) * len, Math.cos(a) * rr + bend * Math.sin(Math.PI * t), Math.sin(a) * rr]; };
  const tone = vary(bark, seed * 13, 0.16), grey = hash1(seed + 9) > 0.6 ? 0.35 : 0.1;
  p.shade(null).ink(tone, 0.95);
  p.grid(nu, nv, (i, j, out) => { const q = P(i / nu, (j / nv) * TAU); out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; },
    (i, j) => { const t = i / nu, a = (j / nv) * TAU, f = noise3(t * len * 1.4 + seed, Math.cos(a) * 5, Math.sin(a) * 5), fur = 0.5 + 0.5 * Math.sin(a * 11 + t * len * 4 + seed * 2); return mul(mix(tone, hex(0x8a8474), grey * f), (0.58 + 0.5 * f) * (0.8 + 0.3 * fur)); }, true);
  // cut ends: heartwood, rings, sapwood, bark rim
  const cut = hex(0xb9965f);
  for (const e of [0, 1]) {
    const x = (e - 0.5) * len, rings = far ? [0, 0.8, 1] : [0, 0.3, 0.55, 0.8, 0.94, 1], ids = [];
    p.begin();
    for (let k = 0; k < rings.length; k++) { const row = []; for (let j = 0; j <= nv; j++) { const a = (j / nv) * TAU, q = P(e, a), f = rings[k]; row.push(p.v(x + (e ? 1 : -1) * 0.012 * (1 - f * f), lerp(bend * 0, q[1], f), q[2] * f, e ? 1 : -1, 0, 0, mul(k === rings.length - 1 ? tone : mix(cut, hex(0x7a5a34), k % 2 ? 0.4 : 0.05), 0.85 + 0.2 * hash2(seed, k)))); } ids.push(row); }
    for (let k = 0; k < rings.length - 1; k++) for (let j = 0; j < nv; j++) { const a = ids[k][j], b = ids[k][j + 1], c = ids[k + 1][j + 1], d = ids[k + 1][j]; if (e) p.quad(a, b, c, d); else p.quad(a, d, c, b); }
  }
}
/** a rope lashing seized round a crossing of two timbers at the origin: turns about local Z */
function lashing(p, r, turns = 3, col = HEMP) {
  p.shade(null).ink(col, 0.95);
  for (let i = 0; i < turns; i++) p.T2((i - (turns - 1) / 2) * 0.022, 0, 0, 0, 0, 90).lathe([[r, -0.011], [r + 0.01, 0], [r, 0.011]], 7);
}
/** a flintlock musket lying along local X, butt at the origin */
function musket(p, len = 0.72) {
  p.shade(grainX(0.14)).ink(hex(0x5a3b22), 0.75).T2(len * 0.36, 0, 0).box(len * 0.72, 0.03, 0.022, 0.006);
  p.T2(0.05, -0.012, 0, 0, 0, -12).box(0.14, 0.055, 0.024, 0.008);
  p.shade(null).ink(IRON, 0.4, 0.85).bar([len * 0.2, 0.02, 0], [len, 0.02, 0], 0.008, 0.007, 6);
  p.T2(len * 0.24, 0.03, 0.012).box(0.05, 0.03, 0.012);
  p.ink(BRASS, 0.4, 0.9); for (const f of [0.45, 0.7]) p.T2(len * f, 0.008, 0).box(0.016, 0.042, 0.03);
}
function buildRaft(def, st, p) {
  const L = st.L, B = st.B, C = st.col, flags = [];
  const nL = Math.max(5, Math.round(B / 0.2)), rL = B / nL / 2, yL = rL * 0.25, top = yL + rL;
  // the logs, butts toward the bow, ragged at the ends
  const logs = [];
  for (let i = 0; i < nL; i++) {
    const z = -B / 2 + (i + 0.5) * (B / nL), len = L * (0.9 + 0.1 * hash1(i * 7 + 1)), x = (hash1(i * 5 + 2) - 0.5) * L * 0.06, r = rL * (0.94 + 0.12 * hash1(i * 11));
    logs.push({ z, x, r });
    p.push(X(x, yL + (r - rL) * 0.3, z, hash1(i) * 360, 0, 0)); logTimber(p, len, r, i + 1, mix(C.hull, hex(0x4e3d2b), 0.5)); p.pop();
  }
  // cross-beams over them, lashed at every log
  const rB = rL * 0.52, beams = [-0.36, 0, 0.36].map((f) => f * L);
  for (const [k, x] of beams.entries()) {
    p.push(X(x, top + rB * 0.8, 0, 0, 90, 0)); p.push(X(0, 0, 0, 40 * k, 0, 0)); logTimber(p, B * 1.04, rB, 20 + k, mix(C.hull, hex(0x6a5236), 0.5), { sides: 10 }); p.pop(); p.pop();
    if (!far) for (const g of logs) { p.push(X(x, top + rB * 0.5, g.z, 0, 0, 0)); p.push(X(0, 0, 0, 0, 45, 0)); lashing(p, rB * 1.25, 2); p.pop(); p.push(X(0, 0, 0, 0, -45, 0)); lashing(p, rB * 1.25, 2); p.pop(); p.pop(); }
  }
  // a rough deck of split planks amidships
  const yD = top + rB * 1.75, x0 = -0.4 * L, x1 = 0.4 * L, nP = Math.round((x1 - x0) / 0.15);
  for (let i = 0; i < nP; i++) {
    const x = lerp(x0, x1, (i + 0.5) / nP), w = B * (0.78 + 0.14 * hash1(i * 3 + 40)), dz = (hash1(i * 9 + 41) - 0.5) * 0.08;
    p.shade(grainX(0.22, 2)).ink(vary(mul(DECK, 0.78), 300 + i, 0.14), 0.92).T(x, yD + (hash1(i + 60) - 0.5) * 0.008, dz, 0, 90 + (hash1(i + 50) - 0.5) * 4, 0).box(w, 0.026, (x1 - x0) / nP - 0.012, 0.006);
  }
  const deckY = yD + 0.014;
  p.shade(null);
  // mast: a pole stepped in a chock, stayed to the corners
  const mx = 0.14 * L, mh = clamp(1.25 + 0.34 * L, 1.6, 2.6), mr = 0.036 + 0.004 * L, mastTop = deckY + mh;
  p.shade(grainY(0.16)).ink(mul(SPAR, 0.9), 0.8).bar([mx, top, 0], [mx - 0.02, mastTop, 0], mr, mr * 0.62, 9, 1);
  p.shade(grainX(0.14)).ink(mul(OAK, 0.8), 0.85); for (const sg of [-1, 1]) p.T(mx, deckY + 0.04, sg * (mr + 0.04)).box(0.26, 0.08, 0.07, 0.01);
  p.push(X(mx, deckY + 0.05, 0)); p.shade(null).ink(HEMP, 0.95); for (let i = 0; i < 3; i++) p.T(0, 0.06 + i * 0.022, 0).lathe([[mr + 0.002, -0.011], [mr + 0.012, 0], [mr + 0.002, 0.011]], 8); p.pop();
  const hounds = [mx - 0.018, mastTop - 0.12, 0];
  for (const q of [[L * 0.44, top + 0.02, 0], [-L * 0.34, top + 0.04, B * 0.44], [-L * 0.34, top + 0.04, -B * 0.44], [L * 0.1, top + 0.04, B * 0.47], [L * 0.1, top + 0.04, -B * 0.47]]) rope(p, q, hounds, 0.008, mul(HEMP, 0.8), 0, 4);
  // the yard (a crooked bough) and a patched square sail
  const yY = mastTop - 0.22, beta = 9 * DEG, wS = Math.min(B * 0.86, 1.5), dirY = [Math.sin(beta), 0, Math.cos(beta)], cY = [mx + mr + 0.03, yY, 0];
  p.shade(grainX(0.14)).ink(mul(SPAR, 0.8), 0.8).tube([add3(cY, dirY, -wS * 0.56), add3(add3(cY, dirY, -wS * 0.2), [0, 0.02, 0]), add3(cY, [0, -0.01, 0]), add3(add3(cY, dirY, wS * 0.25), [0, 0.025, 0]), add3(cY, dirY, wS * 0.56)], [0.014, 0.022, 0.026, 0.022, 0.013], 7, 1);
  rope(p, add3(cY, [0, 0.03, 0]), [mx - 0.02, mastTop - 0.03, 0], 0.007, HEMP, 0, 3);
  const drop = yY - (deckY + 0.5), sl = squareSail(p, { c: [cY[0], yY - 0.03, 0], beta, wHead: wS * 0.96, wFoot: wS * 0.9, drop, belly: 0.16 * drop + 0.05, col: mul(C.sail, 0.92), seed: 3, cloth: 0.24, roach: 0.14, hollow: 0.06, fine: true });
  // patches sewn on, a shade darker, standing just proud of the cloth
  const N = [Math.cos(beta), 0, -Math.sin(beta)];
  for (const [u0, v0, du, dv, k] of [[0.18, 0.5, 0.2, 0.2, 0.8], [0.6, 0.22, 0.17, 0.16, 0.86], [0.62, 0.66, 0.22, 0.14, 0.74]]) {
    for (const e of [1, -1]) p.ink(mul(C.sail, k), 0.95).grid(4, 4, (i, j, out) => { const q = sl.P(u0 + (du * i) / 4, v0 + (dv * j) / 4); out[0] = q[0] + N[0] * 0.006 * e; out[1] = q[1]; out[2] = q[2] + N[2] * 0.006 * e; }, (i, j) => mul(C.sail, k * (i === 0 || i === 4 || j === 0 || j === 4 ? 0.7 : 1)));
  }
  for (const e of [0, 1]) { const cl = sl.clews[e]; rope(p, cl, [-L * 0.2, top + 0.05, (e ? 1 : -1) * B * 0.46], 0.007, HEMP, 0.04, 3); }
  flags.push({ kind: 'device', shape: st.device, on: (x, y, pk) => sl.on(x, y, 0.47, pk), N: sl.N, r: 0.17 * sl.size });
  for (const e of [-1, 1]) rope(p, add3(cY, dirY, e * wS * 0.54), [-L * 0.36, top + 0.05, e * B * 0.4], 0.006, HEMP, 0.05, 3);
  // lean-to: poles and a sagging tarpaulin over the after end
  const lx0 = -0.42 * L, lx1 = -0.1 * L, lh = 0.62, lw = B * 0.62, pole = mul(SPAR, 0.75), ridgeY = deckY + lh;
  p.shade(grainY(0.14)).ink(pole, 0.85);
  for (const sg of [-1, 1]) { p.bar([lx0, deckY - 0.02, (sg * lw) / 2], [lx0 + 0.03, ridgeY + 0.05, (sg * lw) / 2 * 0.96], 0.022, 0.018, 6, 1); p.bar([lx1 + 0.06, deckY - 0.02, (sg * lw) / 2], [lx0 - 0.03, ridgeY + 0.02, (sg * lw) / 2 * 0.96], 0.016, 0.014, 5, 1); }
  p.bar([lx0 + 0.02, ridgeY, -lw / 2 - 0.08], [lx0 + 0.02, ridgeY, lw / 2 + 0.08], 0.02, 0.018, 6, 3);
  const tarp = mul(mix(C.sail, hex(0x7a6a4e), 0.55), 0.85);
  for (const e of [1, -1]) p.shade(null).ink(tarp, 0.95).grid(8, 8, (i, j, out) => { const u = i / 8, v = j / 8; out[0] = lerp(lx0 - 0.02, lx1 + 0.1, v) ; out[1] = lerp(ridgeY + 0.03, deckY + 0.03, Math.pow(v, 0.9)) - 0.05 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + 0.012 * Math.sin(u * 19) * v + e * 0.004; out[2] = (u - 0.5) * (lw + 0.1) * (1 + 0.06 * v); },
    (i, j) => mul(tarp, (0.8 + 0.3 * fbm3(i * 0.6, j * 0.6, 4.2, 2)) * (i === 0 || i === 8 || j === 8 ? 0.72 : 1) * (e > 0 ? 1 : 0.6)));
  for (const sg of [-1, 1]) for (const q of [[lx0 + 0.02, ridgeY, (sg * lw) / 2 * 0.96]]) { p.push(X(q[0], q[1], q[2], 0, 0, 0)); lashing(p, 0.026, 2); p.pop(); }
  // a bedroll and stores under it
  p.shade(mottle(0.2, 14)).ink(hex(0x7d4a3a), 0.95).T(lx0 + 0.16, deckY + 0.055, lw * 0.18, 90, 0, 0).cyl(0.055, 0.055, 0.42, 9);
  p.shade(null).ink(HEMP, 0.95); for (const dz of [-0.12, 0.12]) p.T(lx0 + 0.16, deckY + 0.055, lw * 0.18 + dz, 90, 0, 0).lathe([[0.056, -0.01], [0.062, 0], [0.056, 0.01]], 8);
  p.push(X(lx0 + 0.2, deckY, -lw * 0.2, 0, 8, 0)); crate(p, 0.26, 0.2, 0.24, mul(OAK, 1.15), 2); p.pop();
  // steering oar on a crutch at the stern
  const piv = [-0.46 * L, deckY + 0.34, B * 0.1];
  p.shade(grainY(0.14)).ink(pole, 0.85).bar([piv[0], top, piv[2]], [piv[0], piv[1] - 0.02, piv[2]], 0.03, 0.026, 7, 1);
  for (const sg of [-1, 1]) p.bar([piv[0], piv[1] - 0.04, piv[2]], [piv[0], piv[1] + 0.07, piv[2] + sg * 0.05], 0.018, 0.012, 5, 1);
  const od = norm3([1, 0.36, -0.1]), oa = add3(piv, od, -0.95), ob = add3(piv, od, 0.9);
  p.shade(grainX(0.12)).ink(mul(SPAR, 1.05), 0.8).bar(add3(piv, od, -0.6), ob, 0.024, 0.02, 7, 3);
  p.TM(frame(lerp3(oa, add3(piv, od, -0.6), 0.5), od, [0, 1, 0])).box(0.4, 0.14, 0.016, 0.006);
  p.push(X(piv[0], piv[1] + 0.012, piv[2], 0, 90, 0)); lashing(p, 0.03, 2); p.pop();
  // stores forward: a keg, crates, a coil, muskets leaning ready, an anchor stone
  p.shade(null);
  p.push(X(0.3 * L, deckY, -B * 0.22)); barrel(p, 0.1, 0.28, mul(OAK, 1.05), 7); p.pop();
  p.push(X(0.27 * L, deckY, B * 0.2, 0, -14, 0)); crate(p, 0.3, 0.24, 0.26, mul(OAK, 1.2), 5); p.pop();
  p.push(X(0.27 * L + 0.02, deckY + 0.24, B * 0.2 + 0.02, 0, 20, 0)); crate(p, 0.2, 0.15, 0.18, mul(OAK, 1.05), 6); p.pop();
  for (const [dz, tilt] of [[0.17, 66], [0.24, 70]]) { p.push(X(0.27 * L - 0.2, deckY + 0.01, B * 0.2 + dz - 0.34, 0, 12, tilt)); musket(p, 0.7); p.pop(); }
  p.push(X(0.0, deckY, B * 0.3)); coil(p, 0.11, 3, 0.013); p.pop();
  p.shade(mottle(0.3, 9)).ink(hex(0x77736a), 0.95).T(0.41 * L, top + 0.06, B * 0.16, 0, 30, 0, 0.11, 0.075, 0.09).sphere(1, 8, 6);
  rope(p, [0.41 * L, top + 0.12, B * 0.16], [0.36 * L, top + 0.02, B * 0.05], 0.009, HEMP, 0.01, 4);
  p.shade(null);
  // a fire pot on a bed of stones, and a paddle
  { const fx = 0.36 * L, fz = -B * 0.02;
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; p.shade(mottle(0.3, 11)).ink(vary(hex(0x7d786e), 70 + i, 0.14), 0.95).T(fx + Math.cos(a) * 0.085, deckY + 0.025, fz + Math.sin(a) * 0.085, 0, i * 50, 0, 0.05, 0.035, 0.04).sphere(1, 6, 4); }
    p.shade(mottle(0.3, 20)).ink(IRON, 0.7, 0.6).T(fx, deckY + 0.04, fz).lathe([[0.03, 0], [0.075, 0.03], [0.085, 0.09], [0.075, 0.1], [0.065, 0.09], [0.06, 0.04], [0, 0.03]], 9);
    p.shade(null).ink(hex(0xff7a2a), 0.8, 0, 1.6).T(fx, deckY + 0.085, fz, 0, 0, 0, 0.06, 0.02, 0.06).sphere(1, 7, 4);
    for (let i = 0; i < 3; i++) p.ink(hex(0x2a1c14), 0.95).T(fx + (i - 1) * 0.022, deckY + 0.105, fz, 0, i * 60, 12 + i * 9).box(0.1, 0.016, 0.018);
    const pa = [-0.02 * L, deckY + 0.03, -B * 0.3], pb = [0.24 * L, deckY + 0.05, -B * 0.36];
    p.shade(grainX(0.12)).ink(mul(SPAR, 1.1), 0.8).bar(pa, pb, 0.015, 0.013, 6); p.TM(frame(lerp3(pa, pb, 0.1), sub3(pa, pb), [0, 1, 0])).box(0.26, 0.012, 0.09, 0.004); p.shade(null); }
  { const h = [mx - 0.06, deckY + 0.9, 0.05]; p.ink(IRON, 0.5, 0.8).tube([[mx - 0.03, deckY + 1.02, 0.02], [mx - 0.08, deckY + 1.08, 0.05], h], 0.006, 4); p.push(X(h[0], h[1] - 0.17, h[2])); lantern(p, 0.17); p.pop(); }
  // colours: a pennant at the masthead and a rag of an ensign on a pole aft
  p.ink(pole, 0.85).bar([mx - 0.02, mastTop, 0], [mx - 0.02, mastTop + 0.22, 0], 0.008, 0.006, 5, 1);
  flags.push({ kind: 'pennant', at: [mx - 0.02, mastTop + 0.22, 0], len: 0.62, hgt: 0.14, seed: 1 });
  const ep = [-0.45 * L, deckY, -B * 0.36];
  p.shade(grainY(0.14)).ink(pole, 0.85).bar([ep[0], top, ep[2]], [ep[0] - 0.08, deckY + 0.95, ep[2]], 0.016, 0.01, 5, 1);
  flags.push({ kind: 'ensign', at: [ep[0] - 0.08, deckY + 0.94, ep[2]], len: 0.42, hgt: 0.26, seed: 2 });
  p.shade(null);
  return flags;
}

// ---------- assembly ----------
/** run one stage of a build; with globalThis.__shipTally = {} set (previews only) it records the triangles each stage adds */
function stage(p, name, fn) {
  const T = globalThis.__shipTally, t0 = p.tris, r = fn();
  if (T) T[name] = (T[name] || 0) + p.tris - t0;
  return r;
}
function buildSailingShip(def, st, p, sk = null) {   // sk (fleets.js only): stages to leave out
  const H = st.H = makeHull(st.hull);
  bothSides(p, (side) => {
    stage(p, 'shell', () => shell(p, H, st, side));
    stage(p, 'bulwarks', () => H.segs.forEach((g) => { bulwarkInside(p, H, st, g); if (g.bul > 0.03) railCap(p, H, st, g); }));
  });
  if (!(sk && sk.decks)) stage(p, 'decks', () => H.segs.forEach((g, gi) => deckPlanks(p, H, st, g, gi)));
  stage(p, 'bulkheads', () => { for (let k = 0; k < H.segs.length - 1; k++) bulkhead(p, H, st, k); });
  stage(p, 'stern', () => { if (!(sk && sk.transom)) transom(p, H, st); if (!(sk && sk.stern)) sternWorks(p, H, st); });
  if (!(sk && sk.backbone)) stage(p, 'backbone', () => backbone(p, H, st));
  if (!(sk && sk.head)) stage(p, 'head', () => headWorks(p, H, st));
  bothSides(p, () => { stage(p, 'guns', () => gunPorts(p, H, st)); if (!(sk && sk.sideWorks)) stage(p, 'sideWorks', () => sideWorks(p, H, st)); });
  if (!(sk && sk.fitOut)) stage(p, 'fitOut', () => fitOut(p, H, st));
  // where the muzzles of the starboard broadside are, for whoever wants to put the smoke there
  st.muzzles = st.ports.map((port) => { const { lo, hi } = portGeom(H, st, port), s = port.s, yc = (lo(s) + hi(s)) / 2, n = H.nh(s, yc), o = H.pt(s, yc); return [o[0] + n[0] * st.gunOut, yc - (hi(s) - lo(s)) * 0.06, o[2] + n[1] * st.gunOut]; });
  if (st.kind === 'skiff' && !sk) for (let i = 0; i < st.per; i++) { const ss = st.per === 1 ? 0.44 : lerp(0.26, 0.76, i / (st.per - 1)), q = H.pt(ss, H.railY(ss) + st.capH, -H.o.thick / 2); st.muzzles.push([q[0], q[1] + 0.19, q[2] + 0.2]); }
  if (sk && sk.rig) return [];
  return stage(p, 'rig', () => rig(p, H, st));
}

// everything fleets.js builds its own designs from (it cannot import this module back: it is handed the kit instead)
const KIT = { THREE, Pen, X, frame, aim, clamp, lerp, smooth, mul, mix, add3, sub3, lerp3, cross, norm3, dist3, hash1, hash2, vary, hex, DEG, TAU, noise3, fbm3, S, HP,
  PAL: { TAR, HEMP, IRON, GILT, BRASS, DECK, SPAR, OAK, PITCH, GLASS, WHITE, OCHRE, RED, LAMP },
  grainX, grainY, mottle, makeHull, bothSides, MIRROR, strake, sweep, sweepHard, sweepCap, shell, bulwarkInside, railCap, deckPlanks, transom, backbone, balustrade, ladder, door, windowLight, bulkhead,
  gunBarrel, gunCarriage, portGeom, gunPorts, lantern, scroll, boss, sternWorks, headWorks, sculpted, hatch, capstan, shipWheel, barrel, crate, coil, bitts, skylight, deckhouse, anchor, swivelGun,
  shipsBoat, chocks, binnacle, belfry, stovePipe, bucket, shotRack, fifeRail, pinRail,
  squareSail, gaffSail, triSail, clothTone, rope, block, yard, fightingTop, logTimber, lashing, styleFor, buildSailingShip, stage, rig, fitOut, sideWorks, WIND,
  get far() { return far; }, get lite() { return lite; }, get eco() { return eco; } };

const built = new Map(), flagGeo = new Map();
function buildMain(def, tier) {
  const st = styleFor(def, tier), p = new Pen();
  eco = st.eco; lite = st.lite; far = st.far; p.q = TIERS[tier].q; ropeK = clamp(0.45 + st.L * 0.075, 0.6, 1.15);
  const flags = st.kind === 'raft' ? buildRaft(def, st, p) : buildSailingShip(def, st, p);
  eco = 1; lite = false; far = false;
  const geo = p.toGeometry();
  return { geo, flags, st, muzzles: st.muzzles || [], top: geo.boundingBox.max.y };
}
/** one of the designs of fleets.js (def.kind): the same tiers, the same two geometries */
function buildFleetMain(def, tier) {
  const T = TIERS[tier], p = new Pen();
  eco = T.eco; lite = T.lite; far = T.far; p.q = T.q; ropeK = clamp(0.45 + def.len * 0.075, 0.6, 1.15);
  let r;
  try { r = buildFleet(KIT, def, tier, p); } finally { eco = 1; lite = false; far = false; }
  const geo = p.toGeometry();
  return { geo, flags: r.flags || [], muzzles: r.muzzles || [], top: r.top ?? geo.boundingBox.max.y };
}
/** one tier of a class, built on first use and shared by every ship of that class */
function tierOf(def, key, tier) {
  const k = `${key}|${tier}`;
  if (!built.has(k)) built.set(k, fleetKind(def) ? buildFleetMain(def, tier) : buildMain(def, tier));
  return built.get(k);
}
function flagsOf(key, flags, sideHex) {
  const fk = `${key}|${sideHex}`;
  if (!flagGeo.has(fk)) { const fp = new Pen(); drawFlags(fp, flags, sideHex); flagGeo.set(fk, fp.n ? fp.toGeometry() : null); }
  return flagGeo.get(fk);
}
// which tier each detail level of the game shows (rigkit.setLod levels 0..5; the naval view picks the level from the
// camera distance, changing at about 21, 45, 90, 165 and 300 tiles for a ship): the full model close to, the middle
// tier at the usual battle distance, the far tier once a ship is under about two hundred pixels long.
const LOD_PLAN = { low: [1, 1, 1, 2, 2, 2], ultra: [0, 0, 0, 1, 2, 2] }, LOD_DEFAULT = [0, 0, 1, 2, 2, 2], LOD_STEPS = [14, 30, 60, 110, 200], NOOP = () => {};

/**
 * ship(def, sideColorHex) -> THREE.Group: bow toward +X, waterline at y = 0, length def.len, beam def.beam.
 * Two meshes: the ship (one merged geometry per tier, shared by every ship of the class) and its flags in the side colour.
 * userData.lod lets rigkit.setLod(ship, n) swap tiers; userData.setSide(hex) re-dyes the flags (they also follow the
 * colour of a userData.ring the game hangs on the ship, so a captured prize changes her colours);
 * userData.muzzles and userData.top tell the game where the guns and the mastheads are (and a userData.bar the game
 * hangs on the ship is lifted clear of the mastheads the first time she is drawn).
 */
export function ship(def, sideColorHex = 0x3d7bd9) {
  const fk = fleetKind(def);
  const key = (fk ? [fk, def.id, def.len, def.beam, def.sails, def.cannons?.perSide, def.color, def.sail, def.sail2, def.trim, def.emblem, def.ghost, def.oars] : [def.id, def.len, def.beam, def.sails, def.cannons?.perSide, def.color, def.sail]).join('|');
  const plan = LOD_PLAN[getDetail()] || LOD_DEFAULT, base = tierOf(def, key, plan[0]);
  const g = new THREE.Group(), mat = sculptMaterial();
  const hull = new THREE.Mesh(base.geo, mat);
  hull.castShadow = true; hull.receiveShadow = true; hull.name = 'ship';
  g.add(hull);
  g.userData.muzzles = base.muzzles;   // [x, y, z] of each gun muzzle of the starboard (+Z) broadside; the port side mirrors z
  g.userData.top = base.top;           // height of the mastheads above the waterline
  // the other tiers are only built when a ship is first seen from that far away
  const geos = [];
  plan.forEach((t, i) => Object.defineProperty(geos, i, { enumerable: true, get: () => tierOf(def, key, t).geo }));
  g.userData.lod = { meshes: [{ mesh: hull, geos }], far: null, level: 0, levels: plan.length, toJSON: () => undefined };   // toJSON: Object3D.clone() must not serialise (and so build) every tier
  // A ship in a battle (the views hang a selection ring on her) that nobody calls setLod on looks after her own level,
  // by the same rule the naval view uses; the first time someone else sets a level she leaves it to them.
  let own = 0;
  hull.onBeforeRender = (renderer, scene, camera) => {
    const lod = g.userData.lod;
    if (!lod || lod.level !== own) { hull.onBeforeRender = NOOP; return; }
    if (!g.userData.ring) return;
    const e = hull.matrixWorld.elements, c = camera.matrixWorld.elements, ratio = Math.hypot(c[12] - e[12], c[13] - e[13], c[14] - e[14]) / 1.5;
    let lv = 0;
    while (lv < LOD_STEPS.length && ratio > LOD_STEPS[lv]) lv++;
    if (lv !== own) { setLod(g, lv); own = g.userData.lod.level; }
  };
  const fg = flagsOf(key, base.flags, sideColorHex);
  if (fg) {
    const fm = new THREE.Mesh(fg, mat);
    fm.castShadow = true; fm.receiveShadow = true; fm.name = 'flags';
    let side = sideColorHex;
    g.userData.setSide = (hexCol) => { if (hexCol === side) return; side = hexCol; const ng = flagsOf(key, base.flags, hexCol); if (ng) fm.geometry = ng; };
    let barUp = false;
    fm.onBeforeRender = () => {
      const ring = g.userData.ring, bar = g.userData.bar;
      if (ring && ring.material && ring.material.color) g.userData.setSide(ring.material.color.getHex());
      // the views hang the health bar at 2 + 0.35 x length, which is among the upper sails of anything bigger than a skiff: lift it clear of the mastheads
      if (bar && !barUp) { barUp = true; if (bar.position) bar.position.y = Math.max(bar.position.y, base.top + 0.3); }
    };
    g.add(fm);
  }
  return g;
}
