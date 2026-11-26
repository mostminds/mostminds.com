// Crewed siege weapons, naval forts and the landing craft.
//
// siege[model](w, h, def) -> THREE.Object3D resting on y = 0, centred on its footprint, with
// userData.turret: a Group at x = 0, z = 0 that the game yaws about Y (barrel along +X at yaw 0)
// and nudges in x / z for recoil. Everything that traverses lives in the turret; bases, parapets
// and ready-use stores stay fixed.
// craft(sideColorHex) -> landing craft, bow toward +X, with userData.ramp hinged at the bow.
//
// These are constructed objects, so almost nothing here goes through the voxel sculptor: the
// small kit below makes bevelled timber, turned (lathed) metal, laid ropes and coursed masonry
// directly, then bakes colour, contact shadow and per-vertex roughness / metalness into one
// geometry per moving part for the shared sculpt shader.
import * as THREE from 'three';
import { toCreasedNormals, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rgb, noise3, fbm3, sculptMaterial } from '../sculpt.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _n3 = new THREE.Matrix3();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lin = (c) => (Array.isArray(c) ? c : rgb(c));
const mixc = (a, b, t) => { a = lin(a); b = lin(b); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; };
const mulc = (a, k) => { a = lin(a); return [a[0] * k, a[1] * k, a[2] * k]; };
/** deterministic 0..1 from an integer */
function hash1(n) { let h = Math.imul((n | 0) ^ 0x9e3779b9, 374761393); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
/** deterministic random stream */
function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** a colour nudged in brightness and warmth by a seed: no two planks or stones quite alike */
function vary(c, seed, amt = 0.12) { c = lin(c); const k = 1 + (hash1(seed) - 0.5) * 2 * amt, w = (hash1(seed + 77) - 0.5) * amt * 0.5; return [c[0] * k * (1 + w), c[1] * k, c[2] * k * (1 - w)]; }

// ---------- pieces ----------
const bboxOf = new WeakMap();
function localBox(P) {
  let b = bboxOf.get(P);
  if (!b) {
    b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; }
    bboxOf.set(P, b);
  }
  return b;
}

/** one piece of geometry: positions, normals, indices, an optional per-vertex colour (C) and brightness (K) */
class Pc {
  constructor(P, N, I) {
    this.P = P; this.N = N; this.I = I; this.C = null; this.K = null;
    this.m = new THREE.Matrix4(); this.col = [0.6, 0.6, 0.6]; this.rough = 0.8; this.metal = 0; this.glowV = 0;
    this.fn = null; this.occT = 'box'; this.aoK = 1; this.aoWide = false;
  }
  at(x, y, z) { this.m.premultiply(_m.makeTranslation(x, y, z)); return this; }
  /** DEGREES about X, then Y, then Z */
  rot(rx = 0, ry = 0, rz = 0) { this.m.premultiply(_m.makeRotationFromEuler(_e.set(rx * DEG, ry * DEG, rz * DEG, 'XYZ'))); return this; }
  scale(sx, sy = sx, sz = sx) { this.m.premultiply(_m.makeScale(sx, sy, sz)); return this; }
  xf(mat) { this.m.premultiply(mat); return this; }
  color(c) { this.col = lin(c); return this; }
  pbr(r, m = 0) { this.rough = r; this.metal = m; return this; }
  glow(v = 1) { this.glowV = v; return this; }
  /** fn(x, y, z, nx, ny, nz, c) in the piece's own space -> hex | [r,g,b] | [r,g,b,rough,metal] | null */
  shade(fn) { this.fn = fn; return this; }
  /** how this piece shadows its neighbours: 'box' | 'cyl' (about its own Y) | 'sph' | null */
  occ(t) { this.occT = t; return this; }
  /** how much contact shadow it receives (0 = none) */
  ao(k) { this.aoK = k; return this; }
  /** a big skin (a wall face, a floor): shadowed only by the broad masses named in shadowFrom(), which keeps baking fast */
  wide() { this.aoWide = true; return this; }
  clone() { const c = Object.assign(new Pc(this.P, this.N, this.I), this); c.m = this.m.clone(); c.col = this.col.slice(); return c; }
  /** evaluate the shade function now, in the piece's present space (so grain survives a later bend) */
  paint() {
    if (!this.fn) return this;
    const n = this.P.length / 3, C = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let col = this.C ? [this.C[i * 3], this.C[i * 3 + 1], this.C[i * 3 + 2]] : this.col;
      const r = this.fn(this.P[i * 3], this.P[i * 3 + 1], this.P[i * 3 + 2], this.N[i * 3], this.N[i * 3 + 1], this.N[i * 3 + 2], col);
      if (r != null) col = lin(r);
      C[i * 3] = col[0]; C[i * 3 + 1] = col[1]; C[i * 3 + 2] = col[2];
    }
    this.C = C; this.fn = null;
    return this;
  }
  /** apply the transform so far to the vertices (so a bend or warp can follow) */
  bake() {
    this.paint();
    const n = this.P.length / 3, P = new Float32Array(n * 3), N = new Float32Array(n * 3), e = this.m.elements, q = _n3.getNormalMatrix(this.m).elements;
    for (let i = 0; i < n; i++) {
      const x = this.P[i * 3], y = this.P[i * 3 + 1], z = this.P[i * 3 + 2], a = this.N[i * 3], b = this.N[i * 3 + 1], c = this.N[i * 3 + 2];
      P[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c, l = Math.hypot(nx, ny, nz) || 1;
      N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l;
    }
    this.P = P; this.N = N; this.m = new THREE.Matrix4();
    return this;
  }
  /** split triangles until no edge is longer than maxEdge, so vertex colour (grain, stains) has something to live on */
  subdiv(maxEdge, passes = 6) {
    let P = Array.from(this.P), N = Array.from(this.N), I = Array.from(this.I), K = this.K ? Array.from(this.K) : null, C = this.C ? Array.from(this.C) : null;
    const m2 = maxEdge * maxEdge;
    for (let it = 0; it < passes; it++) {
      const out = [], mids = new Map();
      let split = false;
      const d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
      const mid = (a, b) => {
        const key = a < b ? a * 4194304 + b : b * 4194304 + a;
        let m = mids.get(key);
        if (m === undefined) {
          m = P.length / 3;
          for (let k = 0; k < 3; k++) P.push((P[a * 3 + k] + P[b * 3 + k]) / 2);
          const nx = N[a * 3] + N[b * 3], ny = N[a * 3 + 1] + N[b * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2], l = Math.hypot(nx, ny, nz) || 1;
          N.push(nx / l, ny / l, nz / l);
          if (K) K.push((K[a] + K[b]) / 2);
          if (C) for (let k = 0; k < 3; k++) C.push((C[a * 3 + k] + C[b * 3 + k]) / 2);
          mids.set(key, m);
        }
        return m;
      };
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t], b = I[t + 1], c = I[t + 2], ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), mx = Math.max(ab, bc, ca);
        if (mx <= m2) { out.push(a, b, c); continue; }
        split = true;
        if (mx === ab) { const m = mid(a, b); out.push(a, m, c, m, b, c); } else if (mx === bc) { const m = mid(b, c); out.push(a, b, m, a, m, c); } else { const m = mid(c, a); out.push(a, b, m, m, b, c); }
      }
      I = out;
      if (!split) break;
    }
    this.P = P; this.N = N; this.I = I; this.K = K; this.C = C;
    return this;
  }
  /** curl the piece (lying along X) around a centre at (0, -R, 0): +Y becomes the outside of the arc */
  bend(R) {
    this.bake();
    const P = this.P, N = this.N;
    for (let i = 0; i < P.length; i += 3) {
      const a = P[i] / R, s = Math.sin(a), c = Math.cos(a), r = R + P[i + 1];
      P[i] = r * s; P[i + 1] = r * c - R;
      const nx = N[i], ny = N[i + 1];
      N[i] = nx * c + ny * s; N[i + 1] = -nx * s + ny * c;
    }
    return this;
  }
}

/** a list of pieces that moves as one */
class Grp {
  constructor(...list) { this.list = flat(list); }
  add(...list) { this.list.push(...flat(list)); return this; }
  at(x, y, z) { for (const p of this.list) p.at(x, y, z); return this; }
  rot(rx, ry, rz) { for (const p of this.list) p.rot(rx, ry, rz); return this; }
  scale(sx, sy, sz) { for (const p of this.list) p.scale(sx, sy, sz); return this; }
}
function flat(list, out = []) { for (const x of list) { if (!x) continue; if (Array.isArray(x)) flat(x, out); else if (x instanceof Grp) flat(x.list, out); else out.push(x); } return out; }
const grp = (...list) => new Grp(...list);
/** the pieces plus copies mirrored across Z = 0 (the two sides of a gun) */
const mirZ = (...list) => { const a = flat(list); return new Grp(a, a.map((p) => p.clone().scale(1, 1, -1))); };

function creased(g, deg) {
  // toCreasedNormals welds on a 0.01 grid, far too coarse for parts this small: work at 100x
  g.scale(100, 100, 100);
  const out = toCreasedNormals(g, deg * DEG);
  out.scale(0.01, 0.01, 0.01);
  return out;
}
function fromGeo(g) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position.array, N = g.attributes.normal.array;
  let I;
  if (g.index) I = g.index.array; else { I = new Uint32Array(P.length / 3); for (let i = 0; i < I.length; i++) I[i] = i; }
  return new Pc(P, N, I);
}

// ---------- shapes ----------
const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** any six-sided block from its 8 corners (index = ix + 2 iy + 4 iz) with chamfered edges: 44 triangles */
function hexa(c, b = 0.008) {
  const P = [], N = [], I = [];
  const cen = [0, 0, 0];
  for (const p of c) { cen[0] += p[0] / 8; cen[1] += p[1] / 8; cen[2] += p[2] / 8; }
  const fnrm = [[0, 0], [0, 0], [0, 0]];
  for (let a = 0; a < 3; a++) for (let s = 0; s < 2; s++) {
    const a1 = (a + 1) % 3, a2 = (a + 2) % 3;
    const q = [0, 1 << a1, (1 << a1) | (1 << a2), 1 << a2].map((k) => c[k | (s << a)]);
    let n = v3norm(v3cross(v3sub(q[2], q[0]), v3sub(q[3], q[1])));
    const fc = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
    if (v3dot(n, v3sub(fc, cen)) < 0) n = [-n[0], -n[1], -n[2]];
    fnrm[a][s] = n;
  }
  for (let i = 0; i < 8; i++) {
    const e = [0, 1, 2].map((a) => { const d = v3sub(c[i ^ (1 << a)], c[i]), l = Math.hypot(d[0], d[1], d[2]) || 1; return { u: [d[0] / l, d[1] / l, d[2] / l], l }; });
    for (let a = 0; a < 3; a++) {
      const e1 = e[(a + 1) % 3], e2 = e[(a + 2) % 3], b1 = Math.min(b, e1.l * 0.45), b2 = Math.min(b, e2.l * 0.45);
      P.push(c[i][0] + e1.u[0] * b1 + e2.u[0] * b2, c[i][1] + e1.u[1] * b1 + e2.u[1] * b2, c[i][2] + e1.u[2] * b1 + e2.u[2] * b2);
      N.push(...fnrm[a][(i >> a) & 1]);
    }
  }
  for (let a = 0; a < 3; a++) {
    const a1 = (a + 1) % 3, a2 = (a + 2) % 3;
    for (let s = 0; s < 2; s++) { const q = [0, 1 << a1, (1 << a1) | (1 << a2), 1 << a2].map((k) => (k | (s << a)) * 3 + a); I.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
    for (let i = 0; i < 8; i++) if (!((i >> a) & 1)) { const j = i | (1 << a); I.push(i * 3 + a1, j * 3 + a1, j * 3 + a2, i * 3 + a1, j * 3 + a2, i * 3 + a2); }
  }
  for (let i = 0; i < 8; i++) I.push(i * 3, i * 3 + 1, i * 3 + 2);
  return new Pc(P, N, I);
}
/** chamfered box, full sizes, centred */
function cbox(w, h, d, b = 0.006) {
  const c = [];
  for (let i = 0; i < 8; i++) c.push([(i & 1 ? 0.5 : -0.5) * w, (i & 2 ? 0.5 : -0.5) * h, (i & 4 ? 0.5 : -0.5) * d]);
  return hexa(c, Math.min(b, w * 0.4, h * 0.4, d * 0.4));
}
/** box whose top (+Y) face is scaled by (tx, tz) and shifted by (sx, sz): wedges, battered plinths, caps */
function taperBox(w, h, d, tx = 1, tz = 1, sx = 0, sz = 0, b = 0.006) {
  const c = [];
  for (let i = 0; i < 8; i++) { const top = i & 2; c.push([(i & 1 ? 0.5 : -0.5) * w * (top ? tx : 1) + (top ? sx : 0), (top ? 0.5 : -0.5) * h, (i & 4 ? 0.5 : -0.5) * d * (top ? tz : 1) + (top ? sz : 0)]); }
  return hexa(c, b);
}

/**
 * A timber lying along X: chamfered section, subdivided so grain colour and a hand-hewn wobble show.
 * o: b (chamfer), n (stations), kh / kd (strips across each face), taper [h, d] at the +X end,
 * bow (sag in Y at mid-span), rough (hewn wobble), seed
 */
function beam(L, H, D, o = {}) {
  const b = Math.min(o.b ?? 0.007, H * 0.3, D * 0.3);
  const n = o.n ?? Math.max(2, Math.min(14, Math.round(L / 0.08)));
  const kh = o.kh ?? Math.max(1, Math.min(4, Math.round(H / 0.032))), kd = o.kd ?? Math.max(1, Math.min(4, Math.round(D / 0.032)));
  const rough = o.rough ?? 0.0022, seed = o.seed ?? 0, bow = o.bow ?? 0, tp = o.taper || [1, 1];
  const ring = [];
  const hy = H / 2, hz = D / 2;
  for (let i = 0; i <= kd; i++) ring.push([hy, -hz + b + ((D - 2 * b) * i) / kd, 1, 0]);
  for (let i = 0; i <= kh; i++) ring.push([hy - b - ((H - 2 * b) * i) / kh, hz, 0, 1]);
  for (let i = 0; i <= kd; i++) ring.push([-hy, hz - b - ((D - 2 * b) * i) / kd, -1, 0]);
  for (let i = 0; i <= kh; i++) ring.push([-hy + b + ((H - 2 * b) * i) / kh, -hz, 0, -1]);
  const K = ring.length, xs = [-L / 2, -L / 2 + b];
  for (let i = 1; i < n; i++) xs.push(-L / 2 + (L * i) / n);
  xs.push(L / 2 - b, L / 2);
  const S = xs.length, P = [], N = [], I = [];
  for (let s = 0; s < S; s++) {
    const x = xs[s], t = x / L + 0.5, cap = s === 0 ? -1 : s === S - 1 ? 1 : 0;
    const sy = lerp(1, tp[0], t) * (cap ? (H - 2 * b) / H : 1), sz = lerp(1, tp[1], t) * (cap ? (D - 2 * b) / D : 1);
    const oy = bow * Math.sin(Math.PI * t);
    for (const [ry, rz, ny, nz] of ring) {
      const w = cap ? 0 : rough * (noise3(x * 6 + seed * 3.1, ry * 40 + seed, rz * 40) - 0.5) * 2;
      P.push(x, ry * sy + oy + ny * w, rz * sz + nz * w);
      if (cap) N.push(cap, 0, 0); else N.push(0, ny, nz);
    }
  }
  for (let s = 0; s < S - 1; s++) for (let k = 0; k < K; k++) { const a = s * K + k, c = s * K + ((k + 1) % K), d = a + K, e = c + K; I.push(a, c, e, a, e, d); }
  for (const s of [0, S - 1]) {
    const ci = P.length / 3, x = xs[s], t = x / L + 0.5;
    P.push(x, bow * Math.sin(Math.PI * t), 0); N.push(s ? 1 : -1, 0, 0);
    for (let k = 0; k < K; k++) I.push(ci, s * K + k, s * K + ((k + 1) % K));
  }
  return new Pc(P, N, I);
}

/**
 * Surface of revolution about Y from a profile [[radius, y, brightness?], ...]. Walk the profile so the
 * outside is on your right (bottom to top up the outside, top to bottom down a bore). Repeat a point for
 * a sharp edge. o: arc, a0, colK(j) brightness per column (staves, flutes)
 */
function lathe(prof, seg = 24, o = {}) {
  const arc = o.arc ?? TAU, a0 = o.a0 ?? 0, n = prof.length, nr = [];
  for (let i = 0; i < n; i++) {
    let ax = 0, ay = 0;
    for (const j of [i - 1, i]) {
      if (j < 0 || j >= n - 1) continue;
      const dr = prof[j + 1][0] - prof[j][0], dy = prof[j + 1][1] - prof[j][1], l = Math.hypot(dr, dy);
      if (l > 1e-7) { ax += dy / l; ay += -dr / l; }
    }
    const l = Math.hypot(ax, ay) || 1;
    nr.push([ax / l, ay / l]);
  }
  const P = [], N = [], I = [], K = [];
  for (let j = 0; j <= seg; j++) {
    const a = a0 + (arc * j) / seg, c = Math.cos(a), s = Math.sin(a), ck = o.colK ? o.colK(j % seg) : 1;
    for (let i = 0; i < n; i++) { P.push(prof[i][0] * c, prof[i][1], prof[i][0] * s); N.push(nr[i][0] * c, nr[i][1], nr[i][0] * s); K.push((prof[i][2] ?? 1) * ck); }
  }
  for (let j = 0; j < seg; j++) for (let i = 0; i < n - 1; i++) {
    if (Math.abs(prof[i][0] - prof[i + 1][0]) + Math.abs(prof[i][1] - prof[i + 1][1]) < 1e-7) continue;
    const a = j * n + i, b = a + n;
    if (prof[i][0] > 1e-7) I.push(a, b, a + 1);
    if (prof[i + 1][0] > 1e-7) I.push(b, b + 1, a + 1);
  }
  const p = new Pc(P, N, I);
  p.K = K; p.occT = 'cyl';
  return p;
}
/** plain closed cylinder along Y with a small edge chamfer */
function cyl(r, h, seg = 16, b = 0.004, rt = r) {
  b = Math.min(b, r * 0.4, h * 0.4);
  return lathe([[0, -h / 2], [r - b, -h / 2], [r, -h / 2 + b], [rt, h / 2 - b], [rt - b, h / 2], [0, h / 2]], seg);
}

/**
 * Tube through points. rad: number or one radius per input point. o: smooth (subdivisions per span),
 * closed, caps, rope (strand count: lobed, twisted section that reads as laid rope), twist (turns per unit)
 */
function tube(pts, rad, radial = 8, o = {}) {
  let p = pts.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
  const closed = !!o.closed;
  let rAt = (t) => rad;
  if (typeof rad !== 'number') rAt = (t) => { const f = t * (rad.length - 1), i = Math.min(rad.length - 2, Math.floor(f)); return rad[i] + (rad[i + 1] - rad[i]) * (f - i); };
  if (o.smooth && p.length > 2) {
    const cv = new THREE.CatmullRomCurve3(p, closed, 'catmullrom', 0.5);
    p = cv.getPoints(o.smooth * (closed ? p.length : p.length - 1));
    if (closed) p.pop();
  }
  const n = p.length, P = [], N = [], I = [], K = [];
  const tan = new THREE.Vector3(), nor = new THREE.Vector3(), bin = new THREE.Vector3(), tmp = new THREE.Vector3();
  let len = 0;
  const strands = o.rope || 0, tw = (o.twist ?? 14) * TAU;
  for (let i = 0; i < n; i++) {
    const a = p[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = p[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    tan.subVectors(b, a).normalize();
    if (i === 0) { tmp.set(Math.abs(tan.y) < 0.9 ? 0 : 1, Math.abs(tan.y) < 0.9 ? 1 : 0, 0); nor.crossVectors(tan, tmp).normalize(); }
    else { nor.addScaledVector(tan, -nor.dot(tan)).normalize(); len += p[i].distanceTo(p[i - 1]); }
    bin.crossVectors(tan, nor);
    const r = rAt(n > 1 ? i / (n - 1) : 0);
    for (let j = 0; j < radial; j++) {
      const th = (TAU * j) / radial, c = Math.cos(th), s = Math.sin(th);
      let rr = r, k = 1;
      if (strands) { const lobe = 0.5 + 0.5 * Math.cos(strands * (th - len * tw)); rr = r * (0.8 + 0.2 * lobe); k = 0.62 + 0.46 * lobe; }
      const dx = nor.x * c + bin.x * s, dy = nor.y * c + bin.y * s, dz = nor.z * c + bin.z * s;
      P.push(p[i].x + dx * rr, p[i].y + dy * rr, p[i].z + dz * rr); N.push(dx, dy, dz); K.push(k);
    }
  }
  const rings = closed ? n : n - 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = ((i + 1) % n) * radial + j, d = ((i + 1) % n) * radial + ((j + 1) % radial);
    I.push(a, b, d, a, d, c);
  }
  if (!closed && o.caps !== false) for (const i of [0, n - 1]) {
    const a = p[i === 0 ? 0 : n - 2], b = p[i === 0 ? 1 : n - 1];
    tan.subVectors(b, a).normalize().multiplyScalar(i === 0 ? -1 : 1);
    const ci = P.length / 3;
    P.push(p[i].x, p[i].y, p[i].z); N.push(tan.x, tan.y, tan.z); K.push(0.8);
    for (let j = 0; j < radial; j++) {
      // cap ring gets its own vertices so the end reads flat
      P.push(P[(i * radial + j) * 3], P[(i * radial + j) * 3 + 1], P[(i * radial + j) * 3 + 2]); N.push(tan.x, tan.y, tan.z); K.push(0.8);
    }
    for (let j = 0; j < radial; j++) I.push(ci, ci + 1 + j, ci + 1 + ((j + 1) % radial));
  }
  const pc = new Pc(P, N, I);
  pc.K = K; pc.occT = null;
  return pc;
}
/** a laid rope */
const rope = (pts, r, o = {}) => tube(pts, r, o.radial ?? 9, { smooth: o.smooth ?? 6, rope: 3, twist: o.twist ?? 0.35 / r, ...o }).pbr(0.95);

/** flat outline [[x, y], ...] extruded along Z (centred) with chamfered edges */
function extrude(outline, depth, bevel = 0.004, holes = []) {
  const sh = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const bv = Math.min(bevel, depth * 0.4);
  const g = new THREE.ExtrudeGeometry(sh, { depth: depth - 2 * bv, bevelEnabled: bv > 0, bevelSize: bv, bevelThickness: bv, bevelOffset: -bv, bevelSegments: 1, curveSegments: 10, steps: 1 });
  g.translate(0, 0, -(depth - 2 * bv) / 2);
  g.deleteAttribute('uv');
  return fromGeo(creased(g, 38));
}
const geoCache = new Map();
function cachedGeo(key, make) { if (!geoCache.has(key)) { const g = make(); geoCache.set(key, [g.attributes.position.array, g.attributes.normal.array, g.index.array]); } const a = geoCache.get(key); return new Pc(a[0], a[1], a[2]); }
function ball(r, seg = 14) { const p = cachedGeo(`s${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.6)))).scale(r); p.occT = 'sph'; return p; }
/** rounded stud: rivet heads, nail heads, bolt ends (dome toward +Y) */
function stud(r, h = r * 0.7, seg = 7) { const p = cachedGeo(`d${seg}`, () => new THREE.SphereGeometry(1, seg, 3, 0, TAU, 0, Math.PI / 2)).scale(r, h, r); p.occT = null; return p; }
/** ring around Y: major radius R, section radius r */
function ring(R, r, seg = 28, sec = 8, arc = TAU) { const p = fromGeo(new THREE.TorusGeometry(R, r, sec, seg, arc)).rot(90, 0, 0); p.occT = null; return p; }
/** an arc of points in the XY plane */
function arcPts(cx, cy, r, a0, a1, n) { const out = []; for (let i = 0; i <= n; i++) { const a = (a0 + ((a1 - a0) * i) / n) * DEG; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; }

/**
 * A flat bar swept along points: `wid` across the up direction, `thk` through it. wid / thk may be arrays
 * (one per input point). o: up ([x,y,z] or fn(t) -> [x,y,z]), smooth, caps
 */
function strip(pts, wid, thk, o = {}) {
  let p = pts.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
  if (o.smooth && p.length > 2) p = new THREE.CatmullRomCurve3(p, false, 'catmullrom', 0.5).getPoints(o.smooth * (p.length - 1));
  const at = (a, t) => { if (typeof a === 'number') return a; const f = t * (a.length - 1), i = Math.min(a.length - 2, Math.floor(f)); return a[i] + (a[i + 1] - a[i]) * (f - i); };
  const upF = typeof o.up === 'function' ? o.up : () => o.up || [0, 1, 0];
  const n = p.length, P = [], N = [], I = [];
  const tan = new THREE.Vector3(), up = new THREE.Vector3(), sd = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    tan.subVectors(p[Math.min(n - 1, i + 1)], p[Math.max(0, i - 1)]).normalize();
    const u0 = upF(t); up.set(u0[0], u0[1], u0[2]);
    sd.crossVectors(tan, up).normalize(); up.crossVectors(sd, tan).normalize();
    const w = at(wid, t) / 2, h = at(thk, t) / 2;
    const cs = [[w, h], [-w, h], [-w, -h], [w, -h]];
    for (let k = 0; k < 4; k++) {
      const a = cs[k], b = cs[(k + 1) % 4];
      const nn = k === 0 ? [sd.x, sd.y, sd.z] : k === 1 ? [-up.x, -up.y, -up.z] : k === 2 ? [-sd.x, -sd.y, -sd.z] : [up.x, up.y, up.z];
      for (const c of [a, b]) { P.push(p[i].x + up.x * c[0] + sd.x * c[1], p[i].y + up.y * c[0] + sd.y * c[1], p[i].z + up.z * c[0] + sd.z * c[1]); N.push(nn[0], nn[1], nn[2]); }
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 4; k++) { const a = i * 8 + k * 2, b = a + 1, c = a + 8, d = b + 8; I.push(a, b, d, a, d, c); }
  if (o.caps !== false) for (const i of [0, n - 1]) {
    tan.subVectors(p[i === 0 ? 0 : n - 1], p[i === 0 ? 1 : n - 2]).normalize();
    const ci = P.length / 3;
    for (let k = 0; k < 4; k++) { const a = (i * 8 + k * 2) * 3; P.push(P[a], P[a + 1], P[a + 2]); N.push(tan.x, tan.y, tan.z); }
    I.push(ci, ci + 1, ci + 2, ci, ci + 2, ci + 3);
  }
  const pc = new Pc(P, N, I);
  pc.occT = null;
  return pc;
}

/**
 * Coursed stonework laid over a surface: every stone is its own pillowed block with a dark joint round it.
 * pos(u, v) -> [x, y, z], nrm(u, v) -> unit normal; u runs along the courses over [0, U], v across them over [0, V].
 * o: course (height), len (stone length), joint, bevel, raise, proud (random extra projection), rough,
 * wrap (u closes on itself), uScale(v) (world length of one u unit on that course), color, accents [[colour, share], ...],
 * tint(x, y, z, c, u, v) -> colour (stains), seed, seg (longest flat face along u), keep(u0, u1, v0, v1) -> false to leave a stone out
 */
function masonry(o) {
  const { U, V, pos, nrm } = o;
  const course = o.course ?? 0.2, len = o.len ?? 0.42, joint = o.joint ?? 0.012, bevel = o.bevel ?? 0.02, raise = o.raise ?? 0.02, proud = o.proud ?? 0.012;
  const rough = o.rough ?? 0.004, seg = o.seg ?? 0.3, wrap = !!o.wrap, seed = o.seed ?? 1, r = rng(seed), base = lin(o.color ?? STONE), jointK = o.jointK ?? 0.42;
  const uScale = o.uScale || (() => 1), accents = o.accents || [[STONE_WARM, 0.22], [0x6f716f, 0.14]];
  const P = [], N = [], I = [], C = [];
  const rows = [];
  {
    const n = Math.max(1, Math.round(V / course)), hs = [];
    let s = 0;
    for (let i = 0; i < n; i++) { const h = 1 + (r() - 0.5) * (o.rowVar ?? 0.3); hs.push(h); s += h; }
    let v = 0;
    for (const h of hs) { rows.push([v, v + (h / s) * V]); v += (h / s) * V; }
  }
  let stoneId = seed * 1000;
  const stone = (u0, u1, v0, v1, us) => {
    stoneId++;
    if (o.keep && !o.keep(u0, u1, v0, v1)) return;
    const j = joint / 2, a0 = u0 + j / us, a1 = u1 - j / us, b0 = v0 + j, b1 = v1 - j;
    if (a1 - a0 < 0.01 / us || b1 - b0 < 0.01) return;
    const bu = Math.min(bevel, (a1 - a0) * us * 0.3) / us, bv = Math.min(bevel, (b1 - b0) * 0.3);
    const nu = Math.max(1, Math.ceil(((a1 - a0 - 2 * bu) * us) / seg)), nv = Math.max(1, Math.ceil((b1 - b0 - 2 * bv) / (o.segV ?? 9)));
    const gu = [a0], gv = [b0];
    for (let i = 0; i <= nu; i++) gu.push(a0 + bu + ((a1 - a0 - 2 * bu) * i) / nu);
    for (let i = 0; i <= nv; i++) gv.push(b0 + bv + ((b1 - b0 - 2 * bv) * i) / nv);
    gu.push(a1); gv.push(b1);
    const hgt = raise + proud * hash1(stoneId) ** 2;
    let tone = vary(base, stoneId, o.toneVar ?? 0.13);
    let acc = hash1(stoneId + 500);
    for (const [ac, share] of accents) { if (acc < share) { tone = mixc(tone, vary(ac, stoneId + 9, 0.08), 0.7); break; } acc -= share; }
    const v0i = P.length / 3, W = gu.length, Hh = gv.length;
    for (let jv = 0; jv < Hh; jv++) for (let iu = 0; iu < W; iu++) {
      const border = iu === 0 || iu === W - 1 || jv === 0 || jv === Hh - 1;
      const p = pos(gu[iu], gv[jv]), n = nrm(gu[iu], gv[jv]);
      const nz = noise3(p[0] * 9 + seed, p[1] * 9, p[2] * 9 - seed);
      const h = border ? 0 : hgt + rough * (nz - 0.5) * 2;
      const x = p[0] + n[0] * h, y = p[1] + n[1] * h, z = p[2] + n[2] * h;
      P.push(x, y, z); N.push(0, 0, 0);
      let c = mulc(tone, border ? jointK : 0.9 + 0.2 * nz);
      if (o.tint) c = lin(o.tint(x, y, z, c, gu[iu], gv[jv]) || c);
      C.push(c[0], c[1], c[2]);
    }
    const nref = nrm((a0 + a1) / 2, (b0 + b1) / 2);
    for (let jv = 0; jv < Hh - 1; jv++) for (let iu = 0; iu < W - 1; iu++) {
      const a = v0i + jv * W + iu, b = a + 1, c = a + W, d = c + 1;
      for (const [i0, i1, i2] of [[a, b, d], [a, d, c]]) {
        const e1 = [P[i1 * 3] - P[i0 * 3], P[i1 * 3 + 1] - P[i0 * 3 + 1], P[i1 * 3 + 2] - P[i0 * 3 + 2]], e2 = [P[i2 * 3] - P[i0 * 3], P[i2 * 3 + 1] - P[i0 * 3 + 1], P[i2 * 3 + 2] - P[i0 * 3 + 2]];
        let f = v3cross(e1, e2);
        if (v3dot(f, nref) < 0) f = [-f[0], -f[1], -f[2]];
        for (const i of [i0, i1, i2]) { N[i * 3] += f[0]; N[i * 3 + 1] += f[1]; N[i * 3 + 2] += f[2]; }
        I.push(i0, i1, i2);
      }
    }
    for (let i = v0i; i < P.length / 3; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
  };
  rows.forEach(([v0, v1], ri) => {
    const us = uScale((v0 + v1) / 2), cnt = Math.max(wrap ? 3 : 1, Math.round((U * us) / len)), ws = [];
    let s = 0;
    for (let i = 0; i < cnt; i++) { let w = 1 + (r() - 0.5) * (o.lenVar ?? 0.5); if (!wrap && cnt > 1 && i === 0 && ri % 2) w *= 0.5; ws.push(w); s += w; }
    let u = wrap ? (r() * U) / cnt : 0;
    for (const w of ws) { stone(u, u + (w / s) * U, v0, v1, us); u += (w / s) * U; }
  });
  // mortar bed behind the joints
  if (o.backing !== false) {
    const nu = Math.max(2, Math.ceil(U / (seg * 0.6))), nv = o.backV ?? 2, v0i = P.length / 3, mc = lin(o.mortar ?? MORTAR);
    for (let jv = 0; jv <= nv; jv++) for (let iu = 0; iu <= nu; iu++) {
      const p = pos((U * iu) / nu, (V * jv) / nv), n = nrm((U * iu) / nu, (V * jv) / nv);
      P.push(p[0] - n[0] * 0.004, p[1] - n[1] * 0.004, p[2] - n[2] * 0.004); N.push(n[0], n[1], n[2]); C.push(mc[0] * 0.7, mc[1] * 0.7, mc[2] * 0.7);
    }
    for (let jv = 0; jv < nv; jv++) for (let iu = 0; iu < nu; iu++) { const a = v0i + jv * (nu + 1) + iu, b = a + 1, c = a + nu + 1, d = c + 1; I.push(a, b, d, a, d, c); }
  }
  const pc = new Pc(P, N, I);
  pc.C = C; pc.occT = null; pc.rough = 0.95; pc.aoWide = true;
  return pc;
}
/** a round (optionally battered) wall face for masonry(): radius Rb at the foot, Rt at the top, over `arc` radians from a0 */
function drumSurf(Rb, Rt, y0, H, arc = TAU, a0 = 0, inward = false) {
  const sl = (Rb - Rt) / H, nl = Math.hypot(1, sl), Rref = (Rb + Rt) / 2, sg = inward ? -1 : 1;
  return {
    U: arc * Rref, V: H, wrap: arc >= TAU - 1e-6,
    pos: (u, v) => { const a = a0 + u / Rref, rr = Rb + ((Rt - Rb) * v) / H; return [Math.cos(a) * rr, y0 + v, Math.sin(a) * rr]; },
    nrm: (u) => { const a = a0 + u / Rref; return [(sg * Math.cos(a)) / nl, sl / nl, (sg * Math.sin(a)) / nl]; },
    uScale: (v) => (Rb + ((Rt - Rb) * v) / H) / Rref,
  };
}
/** a flat annulus (or sector) of paving for masonry(): radius r0 to r1 at height y */
function ringFloor(r0, r1, y, arc = TAU, a0 = 0) {
  const Rref = (r0 + r1) / 2;
  return {
    U: arc * Rref, V: r1 - r0, wrap: arc >= TAU - 1e-6,
    pos: (u, v) => { const a = a0 + u / Rref; return [Math.cos(a) * (r0 + v), y, Math.sin(a) * (r0 + v)]; },
    nrm: () => [0, 1, 0],
    uScale: (v) => (r0 + v) / Rref,
  };
}
/** a flat rectangle for masonry(): origin o, u along du, v along dv (unit vectors), normal n */
function planeSurf(o, du, dv, n, U, V) {
  return { U, V, pos: (u, v) => [o[0] + du[0] * u + dv[0] * v, o[1] + du[1] * u + dv[1] * v, o[2] + du[2] * u + dv[2] * v], nrm: () => n };
}

/**
 * Sweep a changing polygon through stations: sect[i] = [[x, y, z], ...] (same count each, convex, closed).
 * Faces are flat across the section and smooth along the sweep: strakes, rails, ribs.
 * o: K (per section point brightness, e.g. to darken an edge tucked under a lap), caps
 */
function loft(sect, o = {}) {
  const S = sect.length, K = sect[0].length, P = [], N = [], I = [], Kb = [];
  const cen = sect.map((st) => { const c = [0, 0, 0]; for (const p of st) { c[0] += p[0] / K; c[1] += p[1] / K; c[2] += p[2] / K; } return c; });
  for (let i = 0; i < S; i++) for (let f = 0; f < K; f++) {
    const a = sect[i][f], b = sect[i][(f + 1) % K];
    P.push(a[0], a[1], a[2], b[0], b[1], b[2]); N.push(0, 0, 0, 0, 0, 0);
    Kb.push(o.K ? o.K[f][0] : 1, o.K ? o.K[f][1] : 1);
  }
  for (let i = 0; i < S - 1; i++) for (let f = 0; f < K; f++) {
    const a = (i * K + f) * 2, b = a + 1, c = ((i + 1) * K + f) * 2, d = c + 1;
    for (const [i0, i1, i2] of [[a, b, d], [a, d, c]]) {
      const e1 = [P[i1 * 3] - P[i0 * 3], P[i1 * 3 + 1] - P[i0 * 3 + 1], P[i1 * 3 + 2] - P[i0 * 3 + 2]], e2 = [P[i2 * 3] - P[i0 * 3], P[i2 * 3 + 1] - P[i0 * 3 + 1], P[i2 * 3 + 2] - P[i0 * 3 + 2]];
      let fn = v3cross(e1, e2);
      const m = [(P[a * 3] + P[b * 3]) / 2 - cen[i][0], (P[a * 3 + 1] + P[b * 3 + 1]) / 2 - cen[i][1], (P[a * 3 + 2] + P[b * 3 + 2]) / 2 - cen[i][2]];
      if (v3dot(fn, m) < 0) fn = [-fn[0], -fn[1], -fn[2]];
      for (const q of [i0, i1, i2]) { N[q * 3] += fn[0]; N[q * 3 + 1] += fn[1]; N[q * 3 + 2] += fn[2]; }
      I.push(i0, i1, i2);
    }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  if (o.caps !== false) for (const i of [0, S - 1]) {
    const j = i === 0 ? 1 : S - 2, nn = v3norm(v3sub(cen[i], cen[j])), ci = P.length / 3;
    for (const p of sect[i]) { P.push(p[0], p[1], p[2]); N.push(nn[0], nn[1], nn[2]); Kb.push(0.85); }
    for (let f = 1; f < K - 1; f++) I.push(ci, ci + f, ci + f + 1);
  }
  const pc = new Pc(P, N, I);
  pc.K = Kb; pc.occT = null;
  return pc;
}
/** matrix turning +Y to the direction n (for seating studs and fittings on a curved hull) */
function alongY(n) { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], n[1], n[2]).normalize()); return new THREE.Matrix4().makeRotationFromQuaternion(q); }

// ---------- surface colour ----------
/** oak-like grain for a timber lying along `axis`: streaks, a few dark checks, ringed end grain */
function wood(base, seed = 0, axis = 'x') {
  const c0 = lin(base);
  return (x, y, z, nx, ny, nz) => {
    let l = x, a = y, b = z, ne = nx;
    if (axis === 'y') { l = y; a = x; b = z; ne = ny; } else if (axis === 'z') { l = z; a = x; b = y; ne = nz; }
    if (Math.abs(ne) > 0.8) { const r = Math.hypot(a * 1.3 + 0.004, b); const k = 0.86 + 0.16 * Math.sin(r * 420 + seed); return [c0[0] * k * 1.1, c0[1] * k * 1.06, c0[2] * k]; }
    const g = noise3(l * 2.4 + seed * 1.3, a * 48 + seed, b * 48 - seed), g2 = noise3(l * 11 + 5.1, a * 120 + seed, b * 120);
    const k = 0.66 + 0.56 * g * g * (3 - 2 * g) + 0.16 * (g2 - 0.5), warm = 1 + (g - 0.5) * 0.14;
    return [c0[0] * k * warm, c0[1] * k, c0[2] * k / warm];
  };
}
/** cast or wrought metal with a little mottle and rust in the hollows */
function metalShade(base, seed = 0, rustCol = 0x6b3a22, rustAmt = 0.25) {
  const c0 = lin(base), rc = lin(rustCol);
  return (x, y, z, nx, ny, nz, c) => {
    const n = fbm3(x * 14 + seed, y * 14 + seed * 0.7, z * 14 - seed, 3), r = smooth(0.58, 0.8, n) * rustAmt;
    const k = 0.88 + 0.24 * noise3(x * 40 + seed, y * 40, z * 40);
    return [lerp(c0[0] * k, rc[0], r), lerp(c0[1] * k, rc[1], r), lerp(c0[2] * k, rc[2], r)];
  };
}

// ---------- assembly: bake colour, contact shadow and finish into one geometry ----------
class Asm {
  /** o: ground (y of the ground plane for contact shadow, or null), ao (strength), post(x, y, z, nx, ny, nz, c) world-space colour pass */
  constructor(o = {}) { this.list = []; this.ground = o.ground === undefined ? 0 : o.ground; this.aoS = o.ao ?? 0.72; this.post = o.post || null; this.ghost = []; }
  add(...p) { flat(p, this.list); return this; }
  /** pieces that only cast contact shadow (the fixed base under a turret, say) */
  shadowFrom(...p) { flat(p, this.ghost); return this; }
  build() {
    const list = this.list;
    let nv = 0, ni = 0;
    for (const p of list) { nv += p.P.length / 3; ni += p.I.length; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), M = new Float32Array(nv * 3), I = new Uint32Array(ni);
    const occ = [], spans = [];
    const occOf = (p, id) => {
      const b = localBox(p.P), inv = p.m.clone().invert().elements, s = Math.cbrt(Math.abs(p.m.determinant())) || 1;
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h = [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2];
      const e = p.m.elements;
      const wc = [e[0] * c[0] + e[4] * c[1] + e[8] * c[2] + e[12], e[1] * c[0] + e[5] * c[1] + e[9] * c[2] + e[13], e[2] * c[0] + e[6] * c[1] + e[10] * c[2] + e[14]];
      return { id, inv, s, c, h, wc, wr: Math.hypot(h[0], h[1], h[2]) * p.m.getMaxScaleOnAxis(), type: p.occT === 'cyl' ? 1 : p.occT === 'sph' ? 2 : 0, on: !!p.occT };
    };
    let vo = 0, io = 0;
    list.forEach((p, pi) => {
      const n = p.P.length / 3, e = p.m.elements, q = _n3.getNormalMatrix(p.m).elements;
      for (let i = 0; i < n; i++) {
        const x = p.P[i * 3], y = p.P[i * 3 + 1], z = p.P[i * 3 + 2], a = p.N[i * 3], b = p.N[i * 3 + 1], c = p.N[i * 3 + 2];
        let col = p.C ? [p.C[i * 3], p.C[i * 3 + 1], p.C[i * 3 + 2]] : p.col, ro = p.rough, me = p.metal;
        if (p.fn) { const r = p.fn(x, y, z, a, b, c, col); if (r != null) { col = lin(r); if (col.length > 3) { ro = col[3]; me = col[4]; } } }
        const k = p.K ? p.K[i] : 1, o = (vo + i) * 3;
        C[o] = col[0] * k; C[o + 1] = col[1] * k; C[o + 2] = col[2] * k;
        M[o] = ro; M[o + 1] = me; M[o + 2] = p.glowV;
        P[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c, l = Math.hypot(nx, ny, nz) || 1;
        N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
      }
      for (let k = 0; k < p.I.length; k++) I[io + k] = p.I[k] + vo;
      const oc = occOf(p, pi);
      occ.push(oc);
      spans.push([vo, n, oc, p.aoK, p.aoWide]);
      vo += n; io += p.I.length;
    });
    const casters = occ.filter((o) => o.on), broad = [];
    this.ghost.forEach((p, i) => { if (p.occT) { const o = occOf(p, -1 - i); casters.push(o); broad.push(o); } });

    // contact shadow: how close is the nearest neighbouring piece, a little way out along the normal?
    const R1 = 0.028, R2 = 0.1, gy = this.ground, aoS = this.aoS;
    const sdf = (o, x, y, z) => {
      const e = o.inv;
      const px = e[0] * x + e[4] * y + e[8] * z + e[12] - o.c[0], py = e[1] * x + e[5] * y + e[9] * z + e[13] - o.c[1], pz = e[2] * x + e[6] * y + e[10] * z + e[14] - o.c[2];
      let d;
      if (o.type === 0) {
        const ax = Math.abs(px) - o.h[0], ay = Math.abs(py) - o.h[1], az = Math.abs(pz) - o.h[2];
        const ox = Math.max(ax, 0), oy = Math.max(ay, 0), oz = Math.max(az, 0);
        d = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(ax, ay, az), 0);
      } else if (o.type === 1) {
        const dr = Math.sqrt(px * px + pz * pz) - Math.max(o.h[0], o.h[2]), dy = Math.abs(py) - o.h[1];
        const ox = Math.max(dr, 0), oy = Math.max(dy, 0);
        d = Math.min(Math.max(dr, dy), 0) + Math.sqrt(ox * ox + oy * oy);
      } else {
        const k = Math.sqrt((px * px) / (o.h[0] * o.h[0]) + (py * py) / (o.h[1] * o.h[1]) + (pz * pz) / (o.h[2] * o.h[2]));
        d = (k - 1) * Math.min(o.h[0], o.h[1], o.h[2]);
      }
      return d * o.s;
    };
    for (const [v0, n, self, aoK, wide] of spans) {
      if (!aoK || aoS <= 0) continue;
      const near = (wide ? broad : casters).filter((o) => o.id !== self.id && Math.hypot(o.wc[0] - self.wc[0], o.wc[1] - self.wc[1], o.wc[2] - self.wc[2]) < o.wr + self.wr + R2 + 0.02);
      if (!near.length && gy === null) continue;
      for (let i = v0; i < v0 + n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
        const x1 = x + nx * R1, y1 = y + ny * R1, z1 = z + nz * R1, x2 = x + nx * R2, y2 = y + ny * R2, z2 = z + nz * R2;
        let d1 = gy === null ? 9 : y1 - gy, d2 = gy === null ? 9 : y2 - gy;
        for (const o of near) {
          const bx = x2 - o.wc[0], by = y2 - o.wc[1], bz = z2 - o.wc[2];
          if (bx * bx + by * by + bz * bz > (o.wr + R2) * (o.wr + R2)) continue;
          const a = sdf(o, x1, y1, z1), b = sdf(o, x2, y2, z2);
          if (a < d1) d1 = a; if (b < d2) d2 = b;
        }
        const k = 1 - (clamp01((R1 - d1) / R1) * 0.5 + clamp01((R2 - d2) / R2) * 0.5) * aoS * aoK;
        C[i * 3] *= k; C[i * 3 + 1] *= k; C[i * 3 + 2] *= k;
      }
    }
    if (this.post) {
      const c = [0, 0, 0];
      for (let i = 0; i < nv; i++) {
        c[0] = C[i * 3]; c[1] = C[i * 3 + 1]; c[2] = C[i * 3 + 2];
        const r = this.post(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], c, M, i * 3);
        if (r) { C[i * 3] = r[0]; C[i * 3 + 1] = r[1]; C[i * 3 + 2] = r[2]; }
      }
    }
    // triangles wound to agree with their normals (the shader flips lighting on back faces)
    for (let t = 0; t < ni; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (fx * (N[a] + N[b] + N[c]) + fy * (N[a + 1] + N[b + 1] + N[c + 1]) + fz * (N[a + 2] + N[b + 2] + N[c + 2]) < 0) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? I : Uint16Array.from(I), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// The sculpt shader, on a material whose clones keep the per-vertex finish (the game clones
// materials to darken a wrecked gun, and a plain clone would drop the shader hook).
let _mat = null;
function siegeMaterial() {
  if (_mat) return _mat;
  const base = sculptMaterial(), proto = THREE.MeshStandardMaterial.prototype;
  const keep = (m) => { m.onBeforeCompile = base.onBeforeCompile; m.customProgramCacheKey = base.customProgramCacheKey; m.clone = function () { return keep(proto.clone.call(this)); }; return m; };
  _mat = keep(proto.clone.call(base));
  return _mat;
}
const built = new Map();
/** geometry is built once per key; every placement gets fresh meshes and a fresh turret group */
function cached(key, make) { if (!built.has(key)) built.set(key, make()); return built.get(key); }
function meshOf(geo) { const m = new THREE.Mesh(geo, siegeMaterial()); m.castShadow = true; m.receiveShadow = true; return m; }
function gunModel(key, make, foot = null) {
  const { base, turret } = cached(key, make);
  const g = new THREE.Group(), t = new THREE.Group();
  if (base) g.add(meshOf(base));
  if (foot) g.add(meshOf(cached(`foot:${foot[0]}:${foot[1]}`, () => buildFooting(foot[0], foot[1]))));
  if (turret) t.add(meshOf(turret));
  g.add(t);
  g.userData.turret = t;
  return g;
}
// Naval forts reuse the land guns: the game calls them without a structure definition (or, in the
// preview, with a fort definition, which has a garrison) and stands them on a plain stone drum.
const isFort = (def) => !def || def.garrison !== undefined;

// ---------- palette ----------
const IRON = 0x3d4048, IRON_DK = 0x2a2c32, STEEL = 0x8a909a, BRONZE = 0xb5843a, BRASS = 0xc9a24a;
const OAK = 0x8e6336, OAK_DK = 0x664424, ELM = 0xa87c48, PINE = 0xbd9458, TAR = 0x3e2c1e;
const HEMP = 0xc4a368, STONE = 0x97948c, STONE_WARM = 0xa89c84, MORTAR = 0x4e4a42;
const iron = (p, seed = 0) => p.color(IRON).pbr(0.5, 0.78).shade(metalShade(IRON, seed, 0x6b3a22, 0.22));
const blackIron = (p) => p.color(IRON_DK).pbr(0.55, 0.7);
const timber = (p, col = OAK, seed = 0, axis = 'x') => p.color(col).pbr(0.86).shade(wood(vary(col, seed * 13 + 5, 0.1), seed, axis));

// ---------- shared parts ----------
/**
 * A cast gun tube lying along +X with its trunnion axis through the origin.
 * o: len, rb (breech radius), rm (muzzle neck radius), bore, tr (trunnions from the breech face, 0..1),
 * trunLen (half length of a trunnion from the axis), col, finish [rough, metal], seed, dolphins, seg
 */
function gunTube(o) {
  const L = o.len, rb = o.rb, rm = o.rm, bore = o.bore, seg = o.seg ?? 32, tr = (o.tr ?? 0.42) * L;
  const col = o.col ?? IRON, fin = o.finish ?? [0.48, 0.8];
  const rAt = (s) => { // stepped reinforces, then a tapering chase
    const t = s / L;
    if (t < 0.3) return lerp(rb, rb * 0.965, t / 0.3);
    if (t < 0.52) return lerp(rb * 0.9, rb * 0.87, (t - 0.3) / 0.22);
    return lerp(rb * 0.8, rm, (t - 0.52) / 0.48);
  };
  const pr = [];
  const put = (r, s, k = 1) => pr.push([r, s, k]);
  // cascabel: button, neck, breech curve
  const kb = rb * 0.42;
  put(0, -rb * 1.42, 1.1); put(kb * 0.7, -rb * 1.38, 1.15); put(kb, -rb * 1.16, 1.1); put(kb * 0.86, -rb * 0.92, 0.9); put(kb * 0.55, -rb * 0.76, 0.6);
  put(kb * 0.62, -rb * 0.62, 0.62); put(rb * 0.62, -rb * 0.36, 0.85); put(rb * 0.92, -rb * 0.12, 1); put(rb * 1.0, 0, 0.7);
  // a raised moulding: fillet, half-round, fillet
  const band = (s, w, h, r0 = rAt(s)) => {
    put(r0, s - w / 2 - 0.0001, 0.62); put(r0 + h * 0.5, s - w / 2, 0.9); put(r0 + h, s - w * 0.2, 1.22); put(r0 + h, s + w * 0.2, 1.22); put(r0 + h * 0.5, s + w / 2, 0.9); put(rAt(s + w / 2), s + w / 2 + 0.0001, 0.62);
  };
  band(L * 0.012 + 0.006, L * 0.035, rb * 0.13, rb);          // base ring
  put(rAt(L * 0.06), L * 0.06, 0.95);
  band(L * 0.12, L * 0.016, rb * 0.06);                        // vent astragal
  put(rAt(L * 0.2), L * 0.2, 1.05);
  put(rAt(L * 0.29), L * 0.29, 0.95);
  band(L * 0.31, L * 0.026, rb * 0.1, rb * 0.93);              // first reinforce ring
  put(rAt(L * 0.34), L * 0.34, 0.9); put(rAt(L * 0.42), L * 0.42, 1.05); put(rAt(L * 0.5), L * 0.5, 0.95);
  band(L * 0.53, L * 0.024, rb * 0.09, rb * 0.84);             // second reinforce ring
  put(rAt(L * 0.56), L * 0.56, 0.9); put(rAt(L * 0.68), L * 0.68, 1.06);
  band(L * 0.74, L * 0.014, rb * 0.05);                        // chase astragal
  put(rAt(L * 0.8), L * 0.8, 1.0); put(rm, L * 0.895, 0.9);
  band(L * 0.905, L * 0.012, rm * 0.07, rm);                   // muzzle astragal
  // muzzle swell, lip, face and bore
  const sw = o.swell ?? 1.32;
  put(rm * 1.0, L * 0.92, 0.75); put(rm * 1.08, L * 0.945, 0.95); put(rm * sw * 0.96, L * 0.972, 1.12); put(rm * sw, L * 0.985, 1.25); put(rm * sw, L * 0.993, 1.2);
  put(rm * sw * 0.94, L, 1.05); put(rm * sw * 0.94, L, 1.0); put(bore * 1.12, L, 0.8); put(bore, L - bore * 0.12, 0.4); put(bore, L - bore * 1.2, 0.12); put(bore, L * 0.6, 0.02); put(0, L * 0.6, 0.02);
  const sd = o.seed ?? 0;
  const shade = o.shade ?? metalShade(col, sd, o.rust ?? 0x6b3a22, o.rustAmt ?? 0.2);
  const fin2 = (p) => p.color(col).pbr(fin[0], fin[1]).shade(shade);
  const g = grp(fin2(lathe(pr, seg)).rot(0, 0, -90).at(-tr, 0, 0));
  // trunnions with rimbases
  const tl = o.trunLen ?? rb * 1.75, rt = o.trunR ?? rb * 0.36, rAtT = rAt(tr);
  g.add(mirZ(fin2(lathe([[0, 0], [rt * 1.45, 0, 0.7], [rt * 1.45, rAtT * 0.99 + rt * 0.25, 0.9], [rt * 1.3, rAtT + rt * 0.4, 1.1], [rt, rAtT + rt * 0.45, 0.7], [rt, tl - rt * 0.12, 1.05], [rt * 0.86, tl, 1.15], [rt * 0.86, tl, 1], [0, tl, 0.9]], 16)).rot(90, 0, 0)));
  // vent: a raised pan with a dark touch-hole
  const vs = L * 0.085 - tr, rv = rAt(L * 0.085);
  g.add(fin2(cbox(rb * 0.34, rb * 0.1, rb * 0.3, 0.003)).at(vs, rv + rb * 0.03, 0));
  g.add(cyl(rb * 0.055, 0.004, 8, 0.0005).color(0x0a0a0a).pbr(0.9).at(vs, rv + rb * 0.082, 0).ao(0));
  if (o.sight !== false) g.add(fin2(taperBox(rm * 0.2, rm * 0.3, rm * 0.12, 0.3, 1, 0, 0, 0.002)).at(L * 0.975 - tr, rm * sw + rm * 0.1, 0));
  if (o.dolphins) {
    // lifting handles over the trunnions
    for (const sz of [-1, 1]) {
      const z = sz * rAtT * 0.42, y0 = Math.sqrt(Math.max(0, rAtT * rAtT - z * z)) - rb * 0.05, a = rb * 0.42, hh = rb * 0.42;
      g.add(fin2(tube([[-a, y0, z], [-a * 0.8, y0 + hh * 0.8, z], [-a * 0.25, y0 + hh, z], [a * 0.25, y0 + hh, z], [a * 0.8, y0 + hh * 0.8, z], [a, y0, z]], rb * 0.085, 7, { smooth: 4 })).at(rb * 0.2, 0, 0));
    }
  }
  return g;
}

/** a spoked cart wheel: axis along Z, outer face toward +Z */
function wheel(R, o = {}) {
  const ns = o.spokes ?? 12, wd = o.width ?? R * 0.2, tyre = R * 0.05, fel = R * 0.17, hubR = R * 0.2, hubL = wd * 2.3, seed = o.seed ?? 0;
  const col = o.col ?? OAK;
  const g = grp();
  const Rm = R - tyre - fel / 2, nf = ns / 2, arc = (TAU / nf) * Rm;
  for (let i = 0; i < nf; i++) {
    const a = ((i + 0.5) / nf) * 360;
    g.add(timber(beam(arc - 0.006, fel, wd, { n: 7, kh: 2, kd: 2, b: 0.006, seed: seed + i }), col, seed + i).bend(Rm).at(0, Rm, 0).rot(0, 0, a));
  }
  // iron tyre shrunk on, with a nail through each felloe joint
  g.add(lathe([[R - tyre, -wd / 2 - 0.003, 0.6], [R, -wd / 2 - 0.003, 1.1], [R, -wd / 2 - 0.003], [R, wd / 2 + 0.003], [R, wd / 2 + 0.003, 1.1], [R - tyre, wd / 2 + 0.003, 0.6]], 40).color(IRON).pbr(0.5, 0.8).shade(metalShade(IRON, seed + 3, 0x7a4426, 0.35)).rot(90, 0, 0).occ(null));
  for (let i = 0; i < ns; i++) {
    const a = (i / ns) * TAU + 0.12;
    for (const s of [-1, 1]) g.add(blackIron(stud(R * 0.035, R * 0.02, 5)).rot(s * 90, 0, 0).at(Math.cos(a) * Rm, Math.sin(a) * Rm, s * wd / 2));
  }
  const sl = Rm - fel / 2 - hubR * 0.8 + 0.01;
  for (let i = 0; i < ns; i++) {
    const a = (i / ns) * 360;
    g.add(timber(beam(sl, R * 0.11, R * 0.13, { n: 3, kh: 1, kd: 1, b: 0.005, taper: [0.72, 0.8], seed: seed + 20 + i }), col, seed + 20 + i).at(hubR * 0.8 + sl / 2, 0, 0).rot(0, 0, a));
  }
  // nave: turned elm with iron bands, the axle end and its linchpin on the outer face
  const h2 = hubL / 2;
  g.add(timber(lathe([[0, -h2], [hubR * 0.72, -h2, 0.8], [hubR * 0.78, -h2 + 0.004], [hubR, -h2 * 0.45, 1.05], [hubR, h2 * 0.45, 1.05], [hubR * 0.78, h2 - 0.004], [hubR * 0.72, h2, 0.8], [0, h2]], 18), ELM, seed + 40, 'y').rot(90, 0, 0));
  for (const s of [-1, 1]) g.add(blackIron(lathe([[hubR * 0.76, -0.008, 0.7], [hubR * 0.86, -0.008], [hubR * 0.86, 0.008], [hubR * 0.76, 0.008, 0.7]], 18)).rot(90, 0, 0).at(0, 0, s * h2 * 0.8).occ(null));
  g.add(blackIron(cyl(hubR * 0.36, 0.03, 12, 0.004)).rot(90, 0, 0).at(0, 0, h2 + 0.012));
  g.add(blackIron(cbox(hubR * 1.1, 0.012, 0.01, 0.002)).at(0, 0, h2 + 0.016));
  return g;
}

/** round shot stacked in a pyramid on a wooden garland; n = balls along the bottom edge */
function shotPile(r, n = 3, seed = 0, col = IRON_DK, seg = 12) {
  const g = grp(), d = r * 2.02;
  for (let l = 0; l < n; l++) {
    const m = n - l, off = -(m - 1) / 2;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      g.add(ball(r, seg).color(col).pbr(0.55, 0.7).shade(metalShade(col, seed + l * 9 + i * 3 + j, 0x7a4426, 0.4)).at((off + i) * d, r + 0.012 + l * d * 0.72, (off + j) * d));
    }
  }
  const s = n * d + r * 0.9;
  for (const [x, z, w, dd] of [[0, s / 2, s + 0.03, 0.028], [0, -s / 2, s + 0.03, 0.028], [s / 2, 0, 0.028, s - 0.02], [-s / 2, 0, 0.028, s - 0.02]]) {
    const along = w > dd;
    g.add(timber(beam(along ? w : dd, 0.03, 0.028, { n: 3, seed: seed + x * 50 + z * 31 }), OAK_DK, seed + 2).rot(0, along ? 0 : 90, 0).at(x, 0.015, z));
  }
  return g;
}

/** coopered keg standing on its end, radius r, height h */
function keg(r, h, o = {}) {
  const staves = o.staves ?? 12, seed = o.seed ?? 0, col = o.col ?? OAK, g = grp();
  const pr = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pr.push([r * (0.84 + 0.16 * Math.sin(Math.PI * t)), h * t]); }
  const top = o.open ? [[r * 0.75, h, 1.05], [r * 0.75, h, 0.7], [r * 0.73, h * 0.3, 0.35], [0, h * 0.3, 0.3]] : [[r * 0.8, h, 0.6], [r * 0.8, h - 0.014, 0.6], [0, h - 0.014, 0.9]];
  const body = lathe([[0, 0.012], [r * 0.8, 0.012, 0.7], [r * 0.8, 0, 0.6], ...pr, ...top], staves * 3, { colK: (j) => (j % 3 === 0 ? 0.55 : 0.92 + 0.16 * hash1(seed + ((j / 3) | 0))) });
  g.add(body.color(col).pbr(0.85).shade(wood(col, seed, 'y')));
  for (const t of o.hoops ?? [0.1, 0.3, 0.7, 0.9]) {
    const rr = r * (0.84 + 0.16 * Math.sin(Math.PI * t)) + 0.002, hw = h * 0.035;
    g.add(blackIron(lathe([[rr - 0.004, -hw, 0.6], [rr + 0.003, -hw], [rr + 0.004, 0, 1.15], [rr + 0.003, hw], [rr - 0.004, hw, 0.6]], staves * 2)).at(0, h * t, 0).occ(null));
  }
  if (o.bung !== false) g.add(timber(cyl(r * 0.12, 0.02, 8, 0.003), ELM, seed + 9, 'y').rot(0, 0, -90).at(r * 0.99, h * 0.5, 0));
  return g;
}

// ====================================================================================
// cannon: a cast field gun on a bracket-trail carriage
// ====================================================================================
function buildCannon() {
  const T = new Asm(), B = new Asm();
  const AX = 0.04, AY = 0.245, WR = 0.24, WZ = 0.315;   // axle and wheels
  const TX = 0.075, TY = 0.468;                         // trunnion axis
  // --- wheels and axletree ---
  for (const s of [-1, 1]) T.add(wheel(WR, { seed: s > 0 ? 3 : 31 }).scale(1, 1, s).at(AX, AY, s * WZ));
  T.add(timber(beam(0.5, 0.075, 0.085, { n: 5, seed: 7 }), OAK_DK, 7).rot(0, 90, 0).at(AX, AY + 0.006, 0));
  T.add(blackIron(cyl(0.022, 0.78, 10)).rot(90, 0, 0).at(AX, AY, 0));
  // --- cheeks: two bracket sides swept back into the trail ---
  const tr = arcPts(TX, TY + 0.012, 0.034, 0, -180, 8);
  const cheek = [[0.265, 0.3], [0.275, 0.33], [0.275, 0.455], [0.262, 0.48], ...tr, [-0.02, 0.48], [-0.045, 0.462], [-0.07, 0.43], [-0.17, 0.42], [-0.2, 0.39],
    [-0.42, 0.135], [-0.47, 0.1], [-0.482, 0.07], [-0.47, 0.04], [-0.44, 0.03], [-0.4, 0.04], [-0.12, 0.255], [0.0, 0.285], [0.15, 0.285]];
  for (const s of [-1, 1]) {
    T.add(extrude(cheek, 0.042, 0.005).subdiv(0.042).color(OAK).pbr(0.85).shade(wood(vary(OAK, s * 5 + 9, 0.08), s * 4 + 6)).at(0, 0, s * 0.108));
    // iron: capsquare over the trunnion, strap along the top edge, through-bolts
    T.add(blackIron(extrude([...arcPts(TX, TY + 0.012, 0.047, 0, 180, 8), ...arcPts(TX, TY + 0.012, 0.035, 180, 0, 8)], 0.046, 0.003)).at(0, 0, s * 0.108));
    T.add(blackIron(cbox(0.05, 0.008, 0.046, 0.002)).at(TX + 0.068, 0.484, s * 0.108), blackIron(cbox(0.05, 0.008, 0.046, 0.002)).at(TX - 0.068, 0.484, s * 0.108));
    T.add(blackIron(cyl(0.007, 0.03, 6)).at(TX + 0.075, 0.492, s * 0.108), blackIron(cyl(0.007, 0.03, 6)).at(TX - 0.075, 0.492, s * 0.108));
    for (const [x, y] of [[0.24, 0.33], [0.24, 0.44], [0.0, 0.33], [-0.03, 0.43], [-0.15, 0.39], [-0.24, 0.3], [-0.33, 0.2], [-0.42, 0.09], [0.14, 0.32]]) {
      T.add(blackIron(stud(0.011, 0.007)).rot(s * 90, 0, 0).at(x, y, s * 0.13));
    }
    // strap wrapped under the axletree, bands over the cheek
    T.add(blackIron(cbox(0.03, 0.105, 0.008, 0.002)).at(AX, AY + 0.012, s * 0.134));
    T.add(blackIron(cbox(0.026, 0.19, 0.007, 0.002)).at(0.2, 0.385, s * 0.1305), blackIron(cbox(0.026, 0.008, 0.05, 0.002)).at(0.2, 0.483, s * 0.108));
    T.add(blackIron(cbox(0.026, 0.14, 0.007, 0.002)).rot(0, 0, 41).at(-0.285, 0.255, s * 0.1305));
  }
  // transoms tie the cheeks together; the bed carries the elevating quoin
  T.add(timber(beam(0.172, 0.11, 0.05, { n: 2, seed: 11 }), OAK_DK, 11).rot(0, 90, 0).at(0.235, 0.37, 0));
  T.add(timber(beam(0.172, 0.04, 0.2, { n: 2, seed: 12 }), OAK_DK, 12).rot(0, 90, 0).at(-0.15, 0.385, 0));
  T.add(timber(beam(0.172, 0.06, 0.07, { n: 2, seed: 13 }), OAK_DK, 13).rot(0, 90, 0).at(-0.41, 0.11, 0));
  T.add(timber(taperBox(0.19, 0.045, 0.09, 0.9, 0.9, -0.02, 0, 0.005), ELM, 14).rot(0, 0, -10).at(-0.17, 0.425, 0));
  T.add(timber(cyl(0.012, 0.09, 8, 0.003), ELM, 15, 'y').rot(0, 0, 82).at(-0.3, 0.432, 0));
  // trail fittings: iron shoe, lunette ring, two handspike loops
  T.add(blackIron(cbox(0.09, 0.012, 0.236, 0.003)).rot(0, 0, 14).at(-0.44, 0.03, 0));
  T.add(blackIron(ring(0.03, 0.008, 16, 6)).at(-0.505, 0.07, 0));
  for (const s of [-1, 1]) T.add(blackIron(ring(0.022, 0.005, 12, 5)).rot(90, 0, 0).rot(0, 0, 40).at(-0.36, 0.2, s * 0.135));
  // --- the gun ---
  const gun = gunTube({ len: 0.98, rb: 0.088, rm: 0.058, bore: 0.036, tr: 0.4, trunLen: 0.15, trunR: 0.031, seed: 2, seg: 32 });
  T.add(gun.rot(0, 0, 5).at(TX, TY + 0.012, 0));

  // --- fixed: ready shot, rammer and sponge on forked rests, water bucket, linstock ---
  B.add(shotPile(0.046, 3, 4, IRON_DK, 10).rot(0, 12, 0).at(0.36, 0, -0.37));
  const rest = (x, z, sd) => grp(
    timber(beam(0.25, 0.026, 0.026, { n: 3, seed: sd, taper: [0.8, 0.8] }), OAK_DK, sd).rot(0, 0, 90).at(0, 0.125, 0),
    timber(beam(0.07, 0.02, 0.02, { n: 2, seed: sd + 1 }), OAK_DK, sd + 1).rot(0, 0, 50).at(0.018, 0.262, 0),
    timber(beam(0.07, 0.02, 0.02, { n: 2, seed: sd + 2 }), OAK_DK, sd + 2).rot(0, 0, 130).at(-0.018, 0.262, 0),
  ).rot(0, 90, 0).at(x, 0, z);
  B.add(rest(-0.3, 0.46, 21), rest(0.3, 0.46, 24));
  // rammer one end, sheepskin sponge the other
  B.add(timber(cyl(0.011, 0.84, 8, 0.003), PINE, 26, 'y').rot(0, 0, 90).at(0, 0.262, 0.46));
  B.add(timber(cyl(0.032, 0.07, 12, 0.006), ELM, 27, 'y').rot(0, 0, 90).at(0.43, 0.262, 0.46));
  B.add(lathe([[0, -0.06], [0.03, -0.055, 0.8], [0.04, -0.03], [0.041, 0.03], [0.03, 0.055, 0.8], [0, 0.06]], 12).color(0xd8cfb4).pbr(1).shade((x, y, z) => mulc(0xd8cfb4, 0.75 + 0.4 * noise3(x * 160, y * 160, z * 160))).rot(0, 0, 90).at(-0.42, 0.262, 0.46));
  // bucket of water
  B.add(keg(0.062, 0.1, { staves: 10, hoops: [0.18, 0.82], bung: false, open: true, seed: 5, col: ELM }).at(0.4, 0, 0.3));
  B.add(cyl(0.05, 0.006, 12, 0.001).color(0x2f4a5a).pbr(0.15, 0.2).at(0.4, 0.078, 0.3).ao(0.4));
  B.add(blackIron(tube([[-0.058, 0.09, 0], [-0.04, 0.14, 0], [0, 0.158, 0], [0.04, 0.14, 0], [0.058, 0.09, 0]], 0.004, 5, { smooth: 4 })).at(0.4, 0, 0.3));
  // linstock stuck in the turf, slow match smouldering
  B.add(timber(cyl(0.01, 0.52, 7, 0.003), OAK_DK, 31, 'y').rot(0, 0, 6).at(-0.44, 0.26, 0.12));
  B.add(blackIron(taperBox(0.05, 0.035, 0.012, 1.5, 1, 0, 0, 0.002)).rot(0, 0, 6).at(-0.468, 0.535, 0.12));
  B.add(rope([[-0.44, 0.4, 0.12], [-0.425, 0.46, 0.132], [-0.46, 0.5, 0.11], [-0.47, 0.545, 0.125], [-0.49, 0.57, 0.12]], 0.006, { radial: 6 }).color(0x8a7a5a));
  B.add(ball(0.008, 6).color(0xff7a2a).glow(1.6).at(-0.492, 0.574, 0.12).ao(0));
  return { base: B.build(), turret: T.build() };
}

/** points along a straight run, for ropes that need stations to show their lay */
function run(a, b, n = 8) { const out = []; for (let i = 0; i <= n; i++) out.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n), lerp(a[2], b[2], i / n)]); return out; }
/** a timber between two points (section h x d) */
function strut(a, b, h, d, o = {}, col = OAK, seed = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(-dz, dx) / DEG, pitch = Math.asin(dy / L) / DEG;
  return timber(beam(L, h, d, { seed, ...o }), col, seed).rot(0, 0, pitch).rot(0, yaw, 0).at((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}
/** an open wooden bucket with a rope or iron bail */
function bucket(r, h, seed = 0, water = true) {
  const g = grp(keg(r, h, { staves: 10, hoops: [0.18, 0.82], bung: false, open: true, seed, col: ELM }));
  if (water) g.add(cyl(r * 0.76, 0.004, 12, 0.001).color(0x2f4a5a).pbr(0.12, 0.3).at(0, h * 0.8, 0).ao(0.3));
  g.add(blackIron(tube([[-r * 0.95, h * 0.92, 0], [-r * 0.7, h * 1.42, 0], [0, h * 1.6, 0], [r * 0.7, h * 1.42, 0], [r * 0.95, h * 0.92, 0]], 0.004, 5, { smooth: 4 })));
  return g;
}

// ====================================================================================
// mortar: a squat bomb-thrower in a timber bed, on a plank platform
// ====================================================================================
function buildMortar() {
  const T = new Asm(), B = new Asm();
  const DY = 0.085;
  // --- platform: sleepers under six planks, nailed ---
  for (const x of [-0.34, 0, 0.34]) B.add(timber(beam(0.95, 0.05, 0.075, { seed: 40 + x * 10 }), OAK_DK, 40 + x * 10).rot(0, 90, 0).at(x, 0.025, 0));
  for (let i = 0; i < 6; i++) {
    const z = -0.39 + i * 0.156;
    B.add(timber(beam(0.9 + (hash1(i + 3) - 0.5) * 0.06, 0.038, 0.148, { seed: 50 + i, n: 10, kd: 4, rough: 0.003 }), i % 2 ? PINE : ELM, 50 + i).rot(0, (hash1(i) - 0.5) * 1.6, 0).at((hash1(i + 9) - 0.5) * 0.02, 0.066, z));
    for (const x of [-0.34, 0, 0.34]) for (const dz of [-0.04, 0.04]) B.add(blackIron(stud(0.008, 0.004)).at(x, 0.0845, z + dz));
  }
  // --- bed: two heavy cheeks, transoms, a bolster under the chase ---
  const TXm = -0.05, TYm = DY + 0.2;
  const prof = [[-0.31, DY], [0.33, DY], [0.33, DY + 0.1], [0.3, DY + 0.135], [0.09, DY + 0.135], [0.03, DY + 0.205], ...arcPts(TXm, TYm + 0.008, 0.05, 0, -180, 8), [-0.17, DY + 0.205], [-0.21, DY + 0.165], [-0.31, DY + 0.165]];
  for (const s of [-1, 1]) {
    T.add(extrude(prof, 0.1, 0.007).subdiv(0.035).color(OAK).pbr(0.86).shade(wood(vary(OAK, s * 3 + 70, 0.08), 70 + s)).at(0, 0, s * 0.165));
    // iron: straps over the top, capsquare, corner plates, lifting rings
    for (const x of [0.2, -0.24]) {
      const yt = x > 0 ? DY + 0.135 : DY + 0.165;
      T.add(blackIron(cbox(0.034, yt - DY + 0.006, 0.008, 0.002)).at(x, (yt + DY) / 2, s * 0.218));
      T.add(blackIron(cbox(0.034, 0.008, 0.112, 0.002)).at(x, yt + 0.003, s * 0.165));
      for (const y of [DY + 0.03, yt - 0.03]) T.add(blackIron(stud(0.009, 0.006)).rot(s * 90, 0, 0).at(x, y, s * 0.222));
    }
    T.add(blackIron(extrude([...arcPts(TXm, TYm + 0.008, 0.064, 0, 180, 8), ...arcPts(TXm, TYm + 0.008, 0.051, 180, 0, 8)], 0.104, 0.003)).at(0, 0, s * 0.165));
    for (const dx of [-0.085, 0.085]) T.add(blackIron(cbox(0.05, 0.01, 0.104, 0.002)).at(TXm + dx, TYm + 0.012, s * 0.165), blackIron(cyl(0.008, 0.03, 6)).at(TXm + dx * 1.05, TYm + 0.02, s * 0.165));
    for (const x of [0.27, -0.26]) {
      T.add(blackIron(cyl(0.012, 0.02, 8)).rot(s * 90, 0, 0).at(x, DY + 0.085, s * 0.222));
      T.add(blackIron(ring(0.026, 0.006, 14, 6)).rot(90, 0, 0).rot(s * 12, 0, 0).at(x, DY + 0.06, s * 0.232));
    }
  }
  T.add(timber(beam(0.24, 0.1, 0.1, { seed: 75 }), OAK_DK, 75).rot(0, 90, 0).at(0.27, DY + 0.052, 0));
  T.add(timber(beam(0.24, 0.12, 0.1, { seed: 76 }), OAK_DK, 76).rot(0, 90, 0).at(-0.25, DY + 0.062, 0));
  T.add(timber(beam(0.24, 0.03, 0.34, { seed: 77 }), OAK_DK, 77).rot(0, 90, 0).at(0, DY + 0.016, 0));
  T.add(timber(beam(0.34, 0.085, 0.1, { seed: 78, n: 4 }), OAK_DK, 78).rot(0, 90, 0).rot(0, 0, 40).at(0.205, DY + 0.172, 0));
  for (const s of [-1, 1]) T.add(blackIron(cbox(0.1, 0.012, 0.03, 0.002)).rot(0, 0, 40).at(0.178, DY + 0.208, s * 0.12));
  // --- the mortar: chambered breech, reinforce, wide chase, heavy muzzle band ---
  const L = 0.42, pr = [];
  const put = (r, y, k = 1) => pr.push([r, y, k]);
  put(0, -0.085, 1); put(0.045, -0.078, 1.05); put(0.082, -0.052, 1); put(0.102, -0.012, 0.95); put(0.106, 0.02, 0.9);
  put(0.106, 0.1, 1.0); put(0.106, 0.118, 0.6); put(0.122, 0.124, 0.9); put(0.136, 0.136, 1.2); put(0.136, 0.152, 1.2); put(0.13, 0.162, 0.7);
  put(0.13, 0.2, 1.0); put(0.133, 0.3, 1.05); put(0.134, 0.335, 0.62); put(0.148, 0.342, 0.95); put(0.158, 0.356, 1.22); put(0.158, 0.392, 1.22); put(0.15, 0.405, 0.9);
  put(0.143, L, 1.1); put(0.143, L, 1); put(0.1, L, 0.85); put(0.092, L - 0.012, 0.45); put(0.092, L - 0.07, 0.14); put(0.09, 0.16, 0.03); put(0, 0.16, 0.03);
  const mcol = 0x474a52, msh = metalShade(mcol, 8, 0x7a4426, 0.26);
  const fin = (p) => p.color(mcol).pbr(0.5, 0.78).shade(msh);
  const gun = grp(fin(lathe(pr, 36)).rot(0, 0, -90));
  gun.add(mirZ(fin(lathe([[0, 0], [0.066, 0, 0.7], [0.066, 0.108, 0.9], [0.058, 0.116, 1.1], [0.046, 0.118, 0.7], [0.046, 0.21, 1.05], [0.04, 0.218, 1.15], [0.04, 0.218, 1], [0, 0.218, 0.9]], 18)).rot(90, 0, 0)));
  gun.add(fin(cbox(0.04, 0.014, 0.04, 0.003)).at(0.05, 0.11, 0), cyl(0.007, 0.004, 8, 0.0005).color(0x0a0a0a).pbr(0.9).at(0.05, 0.118, 0).ao(0));
  // lifting ring on the reinforce, cast lugs either side of it
  gun.add(fin(cbox(0.03, 0.03, 0.02, 0.004)).at(0.235, 0.138, 0), blackIron(ring(0.03, 0.007, 16, 6)).rot(90, 0, 0).rot(0, 0, 25).at(0.24, 0.17, 0));
  // brass band let into the muzzle, the founder's pride
  gun.add(lathe([[0.1585, -0.011, 0.7], [0.161, -0.008, 1.1], [0.161, 0.008, 1.1], [0.1585, 0.011, 0.7]], 36).color(BRASS).pbr(0.35, 0.9).rot(0, 0, -90).at(0.374, 0, 0).occ(null));
  T.add(gun.rot(0, 0, 50).at(TXm, TYm + 0.008, 0));

  // --- fixed stores on the platform corners ---
  const shell = (sd) => grp(
    ball(0.076, 16).color(IRON_DK).pbr(0.6, 0.65).shade(metalShade(IRON_DK, sd, 0x7a4426, 0.45)),
    timber(cyl(0.014, 0.03, 8, 0.003), PINE, sd, 'y').at(0, 0.082, 0),
    blackIron(ring(0.012, 0.004, 8, 5)).rot(90, 0, 0).at(0.034, 0.072, 0), blackIron(ring(0.012, 0.004, 8, 5)).rot(90, 0, 0).at(-0.034, 0.072, 0),
  );
  B.add(shell(1).rot(12, 0, -8).at(0.41, DY + 0.076, 0.29), shell(2).rot(-10, 40, 14).at(0.29, DY + 0.076, 0.41), shell(3).rot(8, 80, 6).at(0.39, DY + 0.19, 0.39));
  for (const [x, z, a] of [[0.35, 0.21, 45], [0.21, 0.35, 45]]) B.add(timber(beam(0.2, 0.026, 0.03, { n: 2, seed: 80 + x * 9 }), OAK_DK, 80).rot(0, a + 90, 0).at(x, DY + 0.013, z));
  // powder: a keg with copper hoops (no sparks), a scoop on its lid
  B.add(keg(0.088, 0.2, { seed: 9, col: OAK, hoops: [] }).at(-0.37, DY, 0.37));
  for (const t of [0.12, 0.32, 0.68, 0.88]) { const rr = 0.088 * (0.84 + 0.16 * Math.sin(Math.PI * t)) + 0.002; B.add(lathe([[rr - 0.004, -0.008, 0.6], [rr + 0.003, -0.008], [rr + 0.004, 0, 1.2], [rr + 0.003, 0.008], [rr - 0.004, 0.008, 0.6]], 24).color(0xb0683a).pbr(0.4, 0.85).at(-0.37, DY + 0.2 * t, 0.37).occ(null)); }
  B.add(lathe([[0, 0], [0.022, 0, 0.8], [0.026, 0.05, 1.1], [0.023, 0.05, 0.6], [0.02, 0.006, 0.4], [0, 0.006, 0.4]], 10).color(0xb0683a).pbr(0.4, 0.85).rot(0, 0, 78).at(-0.35, DY + 0.214, 0.36));
  B.add(timber(cyl(0.007, 0.1, 6, 0.002), PINE, 4, 'y').rot(0, 0, 80).rot(0, 20, 0).at(-0.41, DY + 0.212, 0.385));
  // sponge bucket and a handspike
  B.add(bucket(0.062, 0.1, 6).at(0.39, DY, -0.38));
  B.add(timber(beam(0.5, 0.026, 0.03, { n: 6, taper: [0.6, 0.6], seed: 12 }), ELM, 12).rot(0, 86, 0).at(0.425, DY + 0.014, -0.02));
  return { base: B.build(), turret: T.build() };
}

// ====================================================================================
// ballista: a two-armed torsion engine on a braced swivel post
// ====================================================================================
function buildBallista() {
  const T = new Asm(), B = new Asm();
  // --- stand: crossed sleepers, post, four braces, iron cap and pivot plate ---
  B.add(timber(beam(0.88, 0.07, 0.09, { seed: 60 }), OAK_DK, 60).at(0, 0.036, 0));
  B.add(timber(beam(0.88, 0.07, 0.09, { seed: 61 }), OAK_DK, 61).rot(0, 90, 0).at(0, 0.05, 0));
  B.add(timber(beam(0.42, 0.1, 0.1, { seed: 62, n: 5 }), OAK, 62).rot(0, 0, 90).at(0, 0.285, 0));
  for (let i = 0; i < 4; i++) {
    B.add(strut([0.34, 0.085, 0], [0.045, 0.39, 0], 0.05, 0.055, { n: 4 }, OAK, 63 + i).rot(0, i * 90, 0));
    B.add(blackIron(cyl(0.011, 0.05, 6)).at(0.39, 0.09, 0).rot(0, i * 90, 0), blackIron(stud(0.018, 0.01)).at(0.39, 0.112, 0).rot(0, i * 90, 0));
    B.add(blackIron(stud(0.01, 0.006)).rot(0, 0, -44).at(0.3, 0.14, 0).rot(0, i * 90, 0));
  }
  B.add(blackIron(cbox(0.118, 0.05, 0.118, 0.004)).at(0, 0.472, 0));
  B.add(blackIron(lathe([[0, 0.497], [0.075, 0.497, 0.8], [0.075, 0.497], [0.075, 0.508], [0.075, 0.508, 1.1], [0, 0.508, 1]], 20)));
  // spare bolts laid ready on two billets
  for (const x of [-0.18, 0.2]) B.add(timber(beam(0.16, 0.03, 0.035, { n: 2, seed: 66 + x }), OAK_DK, 66).rot(0, 90, 0).at(x, 0.015, 0.41));
  const bolt = (sd) => {
    const g = grp(timber(cyl(0.0105, 0.6, 8, 0.002), PINE, sd, 'y').rot(0, 0, -90));
    g.add(iron(lathe([[0, -0.01], [0.015, -0.01, 0.8], [0.016, 0.02], [0.027, 0.034, 1.1], [0.02, 0.07], [0, 0.15, 1.2]], 8), sd).rot(0, 0, -90).at(0.3, 0, 0));
    for (let k = 0; k < 3; k++) g.add(cbox(0.13, 0.034, 0.003, 0.001).color(0xd9cfae).pbr(0.9).at(-0.21, 0.027, 0).rot(k * 120 + 30, 0, 0));
    return g;
  };
  for (let k = 0; k < 3; k++) B.add(bolt(k + 1).rot(k * 37, 0, 0).rot(0, (k - 1) * 3, 0).at(0.02 + k * 0.012, 0.045, 0.375 + k * 0.034));

  // --- yoke on the pivot ---
  const PY = 0.508, SY = 0.578;
  T.add(blackIron(cyl(0.062, 0.014, 18, 0.003)).at(0, PY + 0.007, 0));
  for (const s of [-1, 1]) T.add(blackIron(extrude([[-0.04, 0], [0.04, 0], [0.036, 0.07], [0.02, 0.095], [-0.02, 0.095], [-0.036, 0.07]], 0.012, 0.003)).at(0, PY + 0.008, s * 0.052));
  T.add(blackIron(cyl(0.011, 0.14, 8)).rot(90, 0, 0).at(0, SY, 0));
  // --- everything that tilts: built along X about the tilt pin, then raised 7 degrees ---
  const U = grp();
  U.add(timber(beam(0.94, 0.08, 0.095, { seed: 100, n: 12 }), OAK, 100).at(-0.03, -0.004, 0));
  for (const s of [-1, 1]) U.add(timber(beam(0.8, 0.014, 0.016, { seed: 101, n: 6, kh: 1, kd: 1 }), OAK_DK, 101 + s).at(0.02, 0.041, s * 0.03));
  // slider drawn back, with its claw and trigger
  U.add(timber(beam(0.52, 0.02, 0.04, { seed: 103, n: 5 }), ELM, 103).at(-0.12, 0.045, 0));
  U.add(blackIron(cbox(0.04, 0.03, 0.05, 0.004)).at(-0.36, 0.062, 0));
  for (const s of [-1, 1]) U.add(blackIron(extrude([[0, 0], [0.012, 0], [0.012, 0.03], [0.03, 0.036], [0.03, 0.046], [0, 0.046]], 0.008, 0.002)).at(-0.375, 0.066, s * 0.014));
  U.add(blackIron(tube([[-0.36, 0.03, 0], [-0.4, -0.05, 0], [-0.45, -0.075, 0], [-0.5, -0.07, 0]], [0.008, 0.007, 0.006, 0.006], 6, { smooth: 4 })));
  // the bolt
  U.add(timber(cyl(0.0115, 0.9, 8, 0.002), PINE, 104, 'y').rot(0, 0, -90).at(0.1, 0.067, 0));
  U.add(iron(lathe([[0, -0.012], [0.016, -0.012, 0.8], [0.017, 0.025], [0.032, 0.042, 1.15], [0.024, 0.085], [0, 0.19, 1.25]], 8), 5).rot(0, 0, -90).at(0.55, 0.067, 0));
  for (let k = 0; k < 3; k++) U.add(cbox(0.15, 0.04, 0.003, 0.001).color(0xd9cfae).pbr(0.9).at(0, 0.031, 0).rot(k * 120 + 90, 0, 0).at(-0.24, 0.067, 0));
  // torsion frame: hole-carriers top and bottom, four stanchions, iron-plated
  const FX = 0.345, FH = 0.132;
  for (const sy of [-1, 1]) {
    U.add(timber(beam(0.57, 0.046, 0.135, { seed: 110 + sy, n: 7 }), OAK, 110 + sy).rot(0, 90, 0).at(FX, sy * FH, 0));
    for (const z of [-0.18, 0.18]) {
      U.add(blackIron(cbox(0.142, 0.007, 0.15, 0.002)).at(FX, sy * (FH + 0.026), z));
      for (const dz of [-0.06, 0.06]) for (const dx of [-0.056, 0.056]) U.add(blackIron(stud(0.008, 0.005, 5)).rot(sy > 0 ? 0 : 180, 0, 0).at(FX + dx, sy * (FH + 0.03), z + dz));
    }
    U.add(blackIron(cbox(0.05, 0.05, 0.012, 0.002)).at(FX + 0.066, sy * FH, 0), blackIron(cbox(0.142, 0.052, 0.01, 0.002)).at(FX, sy * FH, 0.288), blackIron(cbox(0.142, 0.052, 0.01, 0.002)).at(FX, sy * FH, -0.288));
  }
  for (const s of [-1, 1]) {
    const zc = s * 0.18;
    U.add(timber(beam(0.24, 0.05, 0.04, { seed: 114 + s, n: 3 }), OAK_DK, 114 + s).rot(0, 0, 90).at(FX, 0, s * 0.092));
    U.add(timber(beam(0.24, 0.07, 0.042, { seed: 116 + s, n: 3 }), OAK_DK, 116 + s).rot(0, 0, 90).at(FX + 0.025, 0, s * 0.262));
    for (const y of [-0.06, 0.06]) U.add(blackIron(cbox(0.076, 0.022, 0.006, 0.002)).at(FX + 0.025, y, s * 0.285));
    // rope skein, bronze washers, iron tightening bars
    U.add(tube(run([FX, -FH - 0.03, zc], [FX, FH + 0.03, zc], 30), 0.046, 14, { rope: 7, twist: 2.2 }).color(HEMP).pbr(0.95).occ('cyl'));
    for (const sy of [-1, 1]) {
      U.add(lathe([[0.03, -0.013, 0.6], [0.062, -0.013, 0.85], [0.062, 0.004, 1.15], [0.054, 0.013, 1.1], [0.03, 0.013, 0.7]], 20).color(BRONZE).pbr(0.38, 0.9).scale(1, sy, 1).at(FX, sy * (FH + 0.043), zc));
      U.add(blackIron(cbox(0.15, 0.015, 0.022, 0.003)).rot(0, 25 + s * 20 + sy * 30, 0).at(FX, sy * (FH + 0.062), zc));
    }
    // the arm, drawn back
    const d = [-0.5, 0, s * 0.866], tip = [FX + d[0] * 0.33, 0, zc + d[2] * 0.33];
    U.add(timber(beam(0.38, 0.052, 0.058, { seed: 120 + s, n: 6, taper: [0.55, 0.6], bow: 0 }), ELM, 120 + s).rot(0, -s * 120, 0).at(FX + d[0] * 0.14, 0, zc + d[2] * 0.14));
    U.add(blackIron(cbox(0.034, 0.04, 0.042, 0.004)).rot(0, -s * 120, 0).at(tip[0], 0, tip[2]));
    for (const t of [0.12, 0.2]) U.add(blackIron(cbox(0.012, 0.06, 0.066, 0.002)).rot(0, -s * 120, 0).at(FX + d[0] * t, 0, zc + d[2] * t));
    // bowstring to the claw
    U.add(rope(run([tip[0] - 0.004, 0, tip[2]], [-0.362, 0.082, s * 0.012], 14), 0.0095, { smooth: 0, radial: 7 }).color(0xe2d2a4));
    // iron stays from the frame back to the stock
    for (const sy of [-1, 1]) U.add(blackIron(tube([[FX - 0.055, sy * (FH - 0.012), s * 0.255], [-0.1, sy * 0.03, s * 0.05]], 0.009, 6)), blackIron(stud(0.014, 0.009)).rot(s * 90, 0, 0).at(-0.1, sy * 0.022, s * 0.05));
  }
  // --- windlass at the tail: side plates, drum, handspikes, ratchet and pawl ---
  const WX = -0.52;
  for (const s of [-1, 1]) {
    U.add(timber(beam(0.17, 0.06, 0.022, { seed: 130 + s, n: 2 }), OAK_DK, 130 + s).at(-0.475, 0, s * 0.051));
    U.add(blackIron(stud(0.008, 0.005)).rot(s * 90, 0, 0).at(-0.43, 0.012, s * 0.063), blackIron(stud(0.008, 0.005)).rot(s * 90, 0, 0).at(-0.43, -0.014, s * 0.063));
    U.add(timber(cyl(0.03, 0.04, 10, 0.004), ELM, 132 + s, 'y').rot(90, 0, 0).at(WX, 0, s * 0.105));
    for (const a of [20, 110]) U.add(timber(cyl(0.0105, 0.23, 6, 0.003), PINE, 134 + a, 'y').rot(0, 0, a).at(WX, 0, s * 0.105));
  }
  U.add(blackIron(cyl(0.01, 0.26, 8)).rot(90, 0, 0).at(WX, 0, 0));
  U.add(timber(cyl(0.024, 0.074, 12, 0.002), ELM, 136, 'y').rot(90, 0, 0).at(WX, 0, 0));
  { // rope wound on the drum, led forward to the slider
    const pts = [];
    for (let i = 0; i <= 60; i++) { const a = (i / 60) * TAU * 5; pts.push([WX + Math.cos(a) * 0.03, Math.sin(a) * 0.03, -0.03 + (i / 60) * 0.06]); }
    U.add(tube(pts, 0.006, 6, {}).color(HEMP).pbr(0.95));
    U.add(rope(run([WX, 0.031, 0.03], [-0.38, 0.062, 0], 6), 0.006, { smooth: 0, radial: 6 }).color(HEMP));
  }
  const teeth = [];
  for (let i = 0; i < 12; i++) { const a0 = (i / 12) * TAU, a1 = ((i + 0.85) / 12) * TAU; teeth.push([Math.cos(a0) * 0.03, Math.sin(a0) * 0.03], [Math.cos(a1) * 0.044, Math.sin(a1) * 0.044]); }
  U.add(blackIron(extrude(teeth, 0.012, 0.002)).at(WX, 0, 0.078));
  U.add(blackIron(cbox(0.06, 0.01, 0.01, 0.002)).rot(0, 0, 28).at(WX + 0.045, 0.05, 0.078));
  T.add(U.rot(0, 0, 7).at(0, SY, 0));
  T.shadowFrom(cbox(0.1, 0.42, 0.1).at(0, 0.285, 0));
  return { base: B.build(), turret: T.build() };
}

/** dressed stone for turned or blocky pieces: mottled, a little lichen */
function stoneShade(base, seed = 0, mossAmt = 0) {
  const c0 = lin(base), moss = lin(0x6f7a3e);
  return (x, y, z) => {
    const n = fbm3(x * 9 + seed, y * 9 - seed, z * 9 + seed * 0.5, 3), k = 0.82 + 0.36 * n, m = mossAmt * smooth(0.55, 0.75, noise3(x * 5 - seed, y * 5, z * 5 + seed));
    return [lerp(c0[0] * k, moss[0], m), lerp(c0[1] * k, moss[1], m), lerp(c0[2] * k, moss[2], m)];
  };
}
/** damp and moss creeping up from the ground, for masonry({ tint }) */
const groundStain = (h = 0.14, y0 = 0) => (x, y, z, c) => {
  const n = noise3(x * 7, y * 3, z * 7), t = clamp01(1 - (y - y0) / (h * (0.6 + 0.9 * n)));
  if (t <= 0) return c;
  return mixc(mulc(c, 1 - 0.3 * t), 0x5f6e38, t * 0.55 * smooth(0.25, 0.7, noise3(x * 13 + 4, y * 13, z * 13)));
};
/** one course of wedge-shaped blocks round an arc (angles in radians), each a real six-sided stone */
function arcCourse(r0, r1, y0, y1, a0, a1, n, o = {}) {
  const g = grp(), seed = o.seed ?? 0, gap = o.gap ?? 0.006, col = o.color ?? STONE;
  for (let i = 0; i < n; i++) {
    if (o.skip && o.skip(i)) continue;
    const b0 = a0 + ((a1 - a0) * i) / n + gap / r1 / 2, b1 = a0 + ((a1 - a0) * (i + 1)) / n - gap / r1 / 2;
    const jr = (hash1(seed + i * 7) - 0.5) * (o.jitter ?? 0.012), jy = (hash1(seed + i * 7 + 3) - 0.5) * (o.jitterY ?? 0.008);
    const c = [];
    for (let k = 0; k < 8; k++) { const a = k & 4 ? b1 : b0, r = (k & 1 ? r1 + jr : r0), y = k & 2 ? y1 + jy + (k & 1 ? (o.slope ?? 0) : 0) : y0; c.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
    const tone = vary(hash1(seed + i * 13) < 0.25 ? STONE_WARM : col, seed + i * 3, 0.12);
    g.add(hexa(c, o.bevel ?? 0.012).color(tone).pbr(0.95).shade(stoneShade(tone, seed + i, o.moss ?? 0)));
  }
  return g;
}
/** a straight course of blocks from point a to b (in XZ), `wid` across, laid between y0 and y1 */
function rowCourse(a, b, wid, y0, y1, n, o = {}) {
  const g = grp(), seed = o.seed ?? 0, gap = o.gap ?? 0.006, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = -uz, pz = ux;
  const cuts = [0];
  for (let i = 1; i < n; i++) cuts.push((i + (hash1(seed + i * 5) - 0.5) * 0.3) / n);
  cuts.push(1);
  for (let i = 0; i < n; i++) {
    const t0 = cuts[i] * L + gap / 2, t1 = cuts[i + 1] * L - gap / 2, jw = (hash1(seed + i * 7) - 0.5) * (o.jitter ?? 0.01), jy = (hash1(seed + i * 7 + 3) - 0.5) * (o.jitterY ?? 0.008);
    const c = [];
    for (let k = 0; k < 8; k++) { const t = k & 1 ? t1 : t0, w = (k & 4 ? 0.5 : -0.5) * wid + (k & 4 ? jw : 0), y = k & 2 ? y1 + jy : y0; c.push([a[0] + ux * t + px * w, y, a[1] + uz * t + pz * w]); }
    const tone = vary(hash1(seed + i * 13) < 0.25 ? STONE_WARM : (o.color ?? STONE), seed + i * 3, 0.12);
    g.add(hexa(c, o.bevel ?? 0.012).color(tone).pbr(0.95).shade(stoneShade(tone, seed + i, o.moss ?? 0)));
  }
  return g;
}
/** a single dressed block */
function block(w, h, d, seed = 0, col = STONE, bevel = 0.012, tx = 1, tz = 1) { const tone = vary(col, seed, 0.1); return taperBox(w, h, d, tx, tz, 0, 0, bevel).color(tone).pbr(0.95).shade(stoneShade(tone, seed)); }

/** a barbed harpoon lying along +X, butt at the origin, about `len` long */
function harpoonBolt(len, seed = 0) {
  const g = grp(), hl = len * 0.26;
  g.add(iron(cyl(0.0115, len - hl * 0.8, 8, 0.002), seed).rot(0, 0, -90).at((len - hl * 0.8) / 2, 0, 0));
  const head = [[hl, 0], [hl * 0.36, 0.05], [-hl * 0.18, 0.074], [hl * 0.12, 0.02], [0, 0.013], [0, -0.013], [hl * 0.12, -0.02], [-hl * 0.18, -0.074], [hl * 0.36, -0.05]];
  for (const a of [0, 90]) g.add(extrude(head, 0.011, 0.0045).color(STEEL).pbr(0.32, 0.92).rot(a, 0, 0).at(len - hl, 0, 0));
  g.add(iron(lathe([[0.012, 0, 0.7], [0.019, 0.004], [0.019, 0.03, 1.1], [0.012, 0.04, 0.8]], 8), seed).rot(0, 0, -90).at(len - hl - 0.03, 0, 0));
  g.add(blackIron(ring(0.016, 0.005, 12, 5)).rot(90, 0, 0).at(-0.014, 0, 0));
  return g;
}

// ====================================================================================
// harpoon: a steel-bowed launcher on a swivel, on a round stone pedestal
// ====================================================================================
function buildHarpoon() {
  const T = new Asm(), B = new Asm();
  // --- pedestal: plinth course, two courses of ashlar, moulded cap, iron socket ---
  const stain = groundStain(0.16);
  B.add(masonry({ ...drumSurf(0.4, 0.39, 0, 0.085), course: 0.085, len: 0.3, seed: 3, tint: stain, raise: 0.014, bevel: 0.016, seg: 0.12 }));
  B.add(lathe([[0.32, 0.089, 0.6], [0.385, 0.089, 0.95], [0.398, 0.08, 0.8]], 28).color(STONE).pbr(0.95).shade(stoneShade(STONE, 2, 0.4)));
  B.add(masonry({ ...drumSurf(0.335, 0.3, 0.085, 0.235), course: 0.118, len: 0.24, seed: 5, tint: stain, raise: 0.014, bevel: 0.016, seg: 0.1 }));
  B.add(lathe([[0.29, 0.315, 0.55], [0.335, 0.322, 0.9], [0.352, 0.338, 1.1], [0.352, 0.37, 1.08], [0.338, 0.386, 1]], 32).color(STONE_WARM).pbr(0.95).shade(stoneShade(STONE_WARM, 7, 0.15)));
  B.add(masonry({ ...ringFloor(0.1, 0.342, 0.384), course: 0.24, len: 0.26, seed: 8, raise: 0.008, bevel: 0.014, proud: 0.003, color: STONE_WARM, seg: 0.1, lenVar: 0.2 }));
  B.shadowFrom(cyl(0.34, 0.39, 12).at(0, 0.195, 0));
  B.add(blackIron(cyl(0.105, 0.012, 20, 0.003)).at(0, 0.398, 0));
  for (let i = 0; i < 6; i++) B.add(blackIron(stud(0.011, 0.007)).at(Math.cos(i * 1.047) * 0.083, 0.404, Math.sin(i * 1.047) * 0.083));
  // --- spare harpoons leaning on the pedestal, a tub of line ---
  for (const x of [-0.2, 0.16]) B.add(timber(beam(0.13, 0.03, 0.035, { n: 2, seed: 16 + x }), OAK_DK, 16).rot(0, 90, 0).at(x, 0.015, 0.452));
  B.add(harpoonBolt(0.84, 4).rot(20, 0, 0).rot(0, 2, 0).at(-0.4, 0.043, 0.432), harpoonBolt(0.84, 5).rot(70, 0, 0).rot(0, -3, 0).at(-0.37, 0.043, 0.474));
  B.add(keg(0.12, 0.13, { staves: 12, hoops: [0.2, 0.8], bung: false, open: true, seed: 12, col: OAK_DK }).at(0.36, 0, -0.33));
  { const pts = []; for (let i = 0; i <= 90; i++) { const a = (i / 90) * TAU * 5.2, rr = 0.086 - (i / 90) * 0.066; pts.push([0.36 + Math.cos(a) * rr, 0.085 + (i / 90) * 0.034, -0.33 + Math.sin(a) * rr]); } pts.push([0.36, 0.14, -0.33], [0.4, 0.15, -0.3], [0.46, 0.125, -0.26], [0.475, 0.05, -0.24], [0.47, 0.012, -0.2]);
    B.add(rope(pts, 0.0085, { smooth: 0, radial: 7 }).color(HEMP)); }

  // --- swivel yoke ---
  const SY = 0.592;
  T.add(blackIron(lathe([[0, 0.404], [0.06, 0.404, 0.8], [0.06, 0.418, 1.1], [0.036, 0.432, 0.8], [0.034, 0.462], [0.05, 0.47, 1.1], [0.05, 0.488], [0, 0.488]], 18)));
  T.add(blackIron(cbox(0.06, 0.028, 0.23, 0.005)).at(0, 0.49, 0));
  for (const s of [-1, 1]) T.add(blackIron(extrude([[-0.03, 0], [0.03, 0], [0.026, 0.1], [0.012, 0.125], [-0.012, 0.125], [-0.026, 0.1]], 0.02, 0.004)).at(0, 0.495, s * 0.105), blackIron(stud(0.014, 0.008)).rot(s * 90, 0, 0).at(0, SY, s * 0.116));
  T.add(blackIron(cyl(0.011, 0.23, 8)).rot(90, 0, 0).at(0, SY, 0));
  // --- the launcher, built along X about the tilt pin ---
  const U = grp();
  U.add(timber(beam(0.86, 0.085, 0.1, { seed: 140, n: 12, taper: [1, 1] }), OAK, 140).at(-0.03, 0, 0));
  for (const s of [-1, 1]) {
    U.add(timber(beam(0.5, 0.018, 0.022, { seed: 141, n: 5, kh: 1, kd: 1 }), OAK_DK, 141 + s).at(0.12, 0.05, s * 0.036));
    U.add(blackIron(cbox(0.34, 0.06, 0.008, 0.002)).at(-0.02, -0.004, s * 0.052));
    for (const x of [-0.16, -0.06, 0.04, 0.12]) U.add(blackIron(stud(0.008, 0.005)).rot(s * 90, 0, 0).at(x, 0.012, s * 0.056), blackIron(stud(0.008, 0.005)).rot(s * 90, 0, 0).at(x, -0.022, s * 0.056));
  }
  // steel bow: three leaves bound to the stock head, stirrup in front
  const steel = (p) => p.color(0x77818e).pbr(0.34, 0.92).shade(metalShade(0x77818e, 6, 0x7a4a2a, 0.18));
  const leaf = (k, dx, w0) => {
    const pts = [[0.17, 0, -0.46], [0.215, 0, -0.4], [0.3, 0, -0.24], [0.345, 0, -0.1], [0.355, 0, 0], [0.345, 0, 0.1], [0.3, 0, 0.24], [0.215, 0, 0.4], [0.17, 0, 0.46]].map(([x, y, z]) => [0.355 + (x - 0.355) * k * k + dx, y, z * k]);
    return steel(strip(pts, [w0 * 0.5, w0 * 0.7, w0 * 0.9, w0, w0, w0, w0 * 0.9, w0 * 0.7, w0 * 0.5], 0.012, { smooth: 5 }));
  };
  U.add(leaf(1, 0.012, 0.062), leaf(0.66, 0.025, 0.058), leaf(0.36, 0.038, 0.054));
  for (const s of [-1, 1]) U.add(steel(tube([[0.184, 0, s * 0.455], [0.168, 0, s * 0.468], [0.176, 0, s * 0.492], [0.2, 0, s * 0.5]], 0.009, 6, { smooth: 3 })));
  U.add(blackIron(cbox(0.075, 0.105, 0.12, 0.006)).at(0.385, 0, 0));
  for (const z of [-0.035, 0.035]) U.add(blackIron(cbox(0.085, 0.118, 0.014, 0.003)).at(0.385, 0, z));
  U.add(blackIron(tube([[0.42, 0, -0.045], [0.47, 0, -0.045], [0.5, 0, -0.025], [0.5, 0, 0.025], [0.47, 0, 0.045], [0.42, 0, 0.045]], 0.009, 6, { smooth: 3 })));
  // string drawn to the lock, lock and trigger
  for (const s of [-1, 1]) U.add(rope(run([0.186, 0, s * 0.462], [-0.15, 0.058, s * 0.01], 14), 0.0085, { smooth: 0, radial: 7 }).color(0xe2d2a4));
  U.add(blackIron(cbox(0.05, 0.036, 0.07, 0.005)).at(-0.16, 0.058, 0), blackIron(cyl(0.02, 0.05, 10)).rot(90, 0, 0).at(-0.15, 0.07, 0));
  U.add(blackIron(tube([[-0.16, -0.04, 0], [-0.22, -0.085, 0], [-0.3, -0.1, 0], [-0.36, -0.092, 0]], [0.009, 0.008, 0.007, 0.007], 6, { smooth: 4 })));
  // the harpoon in its trough, line bent to the eye
  U.add(harpoonBolt(0.98, 9).at(-0.12, 0.074, 0));
  // line drum slung under the stock behind the yoke, with a crank
  const DX = -0.27, DYd = -0.135;
  for (const s of [-1, 1]) {
    U.add(blackIron(cbox(0.03, 0.15, 0.008, 0.002)).at(DX, DYd + 0.06, s * 0.082));
    U.add(timber(cyl(0.085, 0.014, 20, 0.003), ELM, 150 + s, 'y').rot(90, 0, 0).at(DX, DYd, s * 0.068));
  }
  U.add(timber(cyl(0.04, 0.13, 12, 0.002), ELM, 152, 'y').rot(90, 0, 0).at(DX, DYd, 0));
  U.add(blackIron(cyl(0.01, 0.22, 8)).rot(90, 0, 0).at(DX, DYd, 0));
  { const pts = []; for (let i = 0; i <= 150; i++) { const t = i / 150, a = t * TAU * 12, lay = t < 0.5 ? 0 : 1, zz = lay ? 0.052 - (t - 0.5) * 2 * 0.104 : -0.052 + t * 2 * 0.104, rr = 0.049 + lay * 0.014; pts.push([DX + Math.cos(a) * rr, DYd + Math.sin(a) * rr, zz]); }
    U.add(tube(pts, 0.0085, 6, {}).color(HEMP).pbr(0.95));
    U.add(rope([[DX + 0.02, DYd + 0.06, -0.04], [DX + 0.08, DYd + 0.11, -0.07], [-0.14, 0.02, -0.075], [-0.134, 0.074, -0.012]], 0.0075, { smooth: 6, radial: 7 }).color(HEMP)); }
  U.add(blackIron(cbox(0.016, 0.085, 0.01, 0.003)).at(DX, DYd - 0.03, 0.114), timber(cyl(0.011, 0.06, 8, 0.003), PINE, 153, 'y').rot(90, 0, 0).at(DX, DYd - 0.066, 0.146));
  // cocking levers: a pair of long iron arms with wooden grips, joined by the claw bar
  for (const s of [-1, 1]) {
    U.add(blackIron(strip([[0.06, 0.0, s * 0.064], [-0.08, 0.06, s * 0.068], [-0.24, 0.15, s * 0.082], [-0.36, 0.2, s * 0.095]], 0.022, 0.009, { smooth: 4, up: [0, 0, 1] })));
    U.add(blackIron(stud(0.014, 0.008)).rot(s * 90, 0, 0).at(0.06, 0, s * 0.07));
    U.add(timber(lathe([[0, -0.055], [0.011, -0.055, 0.8], [0.015, -0.03], [0.013, 0.03], [0.017, 0.05, 1.1], [0, 0.058]], 10), ELM, 154 + s, 'y').rot(0, 0, 66).at(-0.4, 0.218, s * 0.098));
  }
  U.add(blackIron(cyl(0.007, 0.15, 6)).rot(90, 0, 0).at(-0.1, 0.073, 0));
  // tiller: a turned grip and cross-handle at the tail
  U.add(timber(lathe([[0, 0], [0.03, 0, 0.8], [0.036, 0.02], [0.024, 0.05], [0.03, 0.08, 1.1], [0.022, 0.1], [0, 0.106]], 12), ELM, 157, 'y').rot(0, 0, 90).at(-0.455, 0, 0));
  U.add(timber(cyl(0.012, 0.24, 8, 0.004), ELM, 158, 'y').rot(90, 0, 0).at(-0.42, -0.052, 0), blackIron(cbox(0.02, 0.05, 0.03, 0.003)).at(-0.42, -0.04, 0));
  T.add(U.rot(0, 0, 5).at(0, SY, 0));
  T.shadowFrom(cyl(0.34, 0.39, 12).at(0, 0.195, 0));
  return { base: B.build(), turret: T.build() };
}

// ====================================================================================
// battery: a stone emplacement with a bronze coast gun on a traversing carriage
// ====================================================================================
function buildBattery() {
  const T = new Asm(), B = new Asm();
  const FY = 0.3, PI = Math.PI, stain = groundStain(0.2);
  // --- retaining wall: battered ashlar round the front, straight flanks and gorge ---
  B.add(masonry({ ...drumSurf(1.0, 0.985, 0, FY, PI, -PI / 2), course: 0.15, len: 0.34, seed: 21, tint: stain, seg: 0.14, raise: 0.018 }));
  for (const sz of [-1, 1]) {
    B.add(masonry({ ...planeSurf([sz > 0 ? 0 : -1, 0, sz], [sz > 0 ? -1 : 1, 0, 0], [0, 1, 0], [0, 0, sz], 1, FY), course: 0.15, len: 0.34, seed: 23 + sz, tint: stain, raise: 0.018 }));
    B.add(masonry({ ...planeSurf([-1, 0, sz > 0 ? 0.36 : -1], [0, 0, 1], [0, 1, 0], [-1, 0, 0], 0.64, FY), course: 0.15, len: 0.3, seed: 26 + sz, tint: stain, raise: 0.018 }));
  }
  // --- paved gun floor ---
  const inPlan = (x, z) => (x > 0 ? Math.hypot(x, z) < 0.8 : Math.abs(z) < 0.97 && x > -0.97 && !(x < -0.82 && Math.abs(z) < 0.3));
  B.add(masonry({ ...planeSurf([-1, FY, -1], [1, 0, 0], [0, 0, 1], [0, 1, 0], 2, 2), course: 0.25, len: 0.36, seed: 29, raise: 0.01, proud: 0.006, bevel: 0.016, lenVar: 0.6, rowVar: 0.2, color: 0xa29c8e, backing: false, keep: (u0, u1, v0, v1) => inPlan((u0 + u1) / 2 - 1, (v0 + v1) / 2 - 1) }));
  // the bed the flags are laid on, run out to the wall head so nothing shows between wall and parapet
  B.add(cbox(1.0, 0.03, 1.996, 0.002).color(MORTAR).at(-0.5, FY - 0.016, 0).ao(0).occ(null), lathe([[0, FY - 0.001], [0.998, FY - 0.001], [0.998, FY - 0.03]], 48, { arc: PI, a0: -PI / 2 }).color(MORTAR).ao(0).occ(null));
  B.shadowFrom(cbox(2, FY, 2).at(0, FY / 2, 0));
  // --- parapet: two courses of wedge blocks and a weathered coping, notched for the embrasure ---
  const R0 = 0.74, R1 = 0.975, emb = (n, k) => (i) => Math.abs(i - (n - 1) / 2) < k;
  B.add(arcCourse(R0, R1, FY, 0.5, -PI / 2, PI / 2, 15, { seed: 31 }));
  B.add(arcCourse(R0 + 0.006, R1 - 0.008, 0.5, 0.685, -PI / 2, PI / 2, 16, { seed: 33, skip: emb(16, 1.2) }));
  B.add(arcCourse(R0 - 0.02, R1 + 0.014, 0.685, 0.75, -PI / 2, PI / 2, 12, { seed: 35, skip: emb(12, 0.9), slope: -0.03, bevel: 0.018, color: STONE_WARM, moss: 0.25 }));
  // embrasure cheeks and sole
  for (const s of [-1, 1]) B.add(block(0.25, 0.25, 0.05, 37 + s, STONE_WARM).rot(0, -s * 14, 0).at(0.855, 0.625, s * 0.155));
  B.add(block(0.27, 0.03, 0.3, 39, STONE_WARM).at(0.86, 0.505, 0));
  for (const sz of [-1, 1]) {
    const zc = sz * (R0 + R1) / 2, wd = R1 - R0;
    B.add(rowCourse([0, zc], [-0.5, zc], wd, FY, 0.5, 3, { seed: 41 + sz }));
    B.add(rowCourse([0, zc], [-0.5, zc], wd - 0.014, 0.5, 0.685, 2, { seed: 43 + sz }));
    B.add(rowCourse([0.0, zc], [-0.5, zc], wd + 0.034, 0.685, 0.75, 2, { seed: 45 + sz, bevel: 0.018, color: STONE_WARM, moss: 0.25 }));
    // end pier with a pyramid cap
    for (let k = 0; k < 3; k++) B.add(block(0.26 - (k % 2) * 0.012, 0.177, 0.3 - (k % 2) * 0.012, 47 + sz + k * 4, k === 1 ? STONE_WARM : STONE).at(-0.63, FY + 0.0885 + k * 0.177, zc));
    B.add(block(0.3, 0.035, 0.34, 49 + sz, STONE_WARM).at(-0.63, FY + 0.547, zc), block(0.26, 0.07, 0.3, 51 + sz, STONE_WARM, 0.01, 0.25, 0.25).at(-0.63, FY + 0.6, zc));
    // gorge kerb and corner post
    B.add(rowCourse([-0.76, sz * 0.93], [-1.0, sz * 0.93], 0.14, FY - 0.02, FY + 0.07, 1, { seed: 53 + sz }));
    B.add(rowCourse([-0.93, sz * 0.36], [-0.93, sz * 0.8], 0.14, FY - 0.02, FY + 0.07, 2, { seed: 55 + sz }));
    for (let k = 0; k < 3; k++) B.add(block(0.2 - (k % 2) * 0.01, 0.187, 0.2 - (k % 2) * 0.01, 57 + sz + k * 4, k === 1 ? STONE_WARM : STONE).at(-0.9, 0.0935 + k * 0.187, sz * 0.9));
    B.add(block(0.235, 0.03, 0.235, 59 + sz, STONE_WARM).at(-0.9, 0.573, sz * 0.9));
    // step jambs
    B.add(block(0.18, FY + 0.03, 0.07, 61 + sz).at(-0.91, FY / 2 + 0.014, sz * 0.335));
  }
  B.add(blackIron(lathe([[0.028, 0.588, 0.7], [0.04, 0.588], [0.04, 0.62, 1.1], [0.028, 0.62]], 10)).at(-0.9, 0, -0.9));
  B.add(block(0.24, 0.07, 0.24, 62, STONE_WARM, 0.01, 0.3, 0.3).at(-0.9, 0.623, 0.9));
  // steps up the gorge
  B.add(block(0.17, 0.15, 0.6, 63, 0xa29c8e).at(-0.915, 0.075, 0), block(0.16, 0.155, 0.6, 64, 0xa29c8e).at(-0.76, FY - 0.0775, 0));
  // --- racer ring and pivot block ---
  B.add(lathe([[0.575, FY + 0.012, 0.6], [0.583, FY + 0.034, 0.9], [0.594, FY + 0.04, 1.15], [0.606, FY + 0.04, 1.15], [0.617, FY + 0.034, 0.9], [0.625, FY + 0.012, 0.6]], 64).color(IRON).pbr(0.42, 0.85).shade(metalShade(IRON, 4, 0x7a4426, 0.3)).occ(null));
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; B.add(blackIron(cbox(0.085, 0.012, 0.03, 0.002)).rot(0, -a / DEG, 0).at(Math.cos(a) * 0.6, FY + 0.018, Math.sin(a) * 0.6)); }
  B.add(lathe([[0.2, FY + 0.008, 0.6], [0.205, FY + 0.05, 0.95], [0.19, FY + 0.066, 1.08], [0, FY + 0.066, 1]], 24).color(STONE_WARM).pbr(0.95).shade(stoneShade(STONE_WARM, 12)));
  B.add(blackIron(cyl(0.1, 0.012, 18, 0.003)).at(0, FY + 0.072, 0));
  // --- ready-use stores in the gorge: shot, powder under a tarred cover, tools on the wall ---
  B.add(shotPile(0.062, 3, 14, IRON_DK, 10).rot(0, 8, 0).at(-0.72, FY + 0.012, 0.6));
  B.add(keg(0.085, 0.19, { seed: 15, col: OAK_DK, staves: 9 }).at(-0.76, FY + 0.012, -0.52), keg(0.085, 0.19, { seed: 16, col: OAK, staves: 9 }).rot(0, 50, 0).at(-0.63, FY + 0.012, -0.68), keg(0.075, 0.17, { seed: 17, col: OAK, staves: 9 }).rot(90, 0, 0).rot(0, 20, 0).at(-0.8, FY + 0.09, -0.74));
  for (const [y, len, hd] of [[0.52, 0.5, 0], [0.6, 0.46, 1]]) {
    B.add(timber(cyl(0.012, len, 8, 0.003), PINE, 18 + hd, 'y').rot(0, 0, 90).at(-0.26, y, 0.722));
    if (hd) B.add(timber(cyl(0.034, 0.07, 12, 0.006), ELM, 19, 'y').rot(0, 0, 90).at(-0.02, y, 0.715));
    else B.add(lathe([[0, -0.06], [0.03, -0.055, 0.8], [0.042, -0.03], [0.042, 0.03], [0.03, 0.055, 0.8], [0, 0.06]], 12).color(0xd8cfb4).pbr(1).shade((x, y2, z) => mulc(0xd8cfb4, 0.75 + 0.4 * noise3(x * 160, y2 * 160, z * 160))).rot(0, 0, 90).at(-0.02, y, 0.712));
  }
  for (const x of [-0.44, -0.1]) B.add(blackIron(extrude([[0, 0], [0.012, 0], [0.012, 0.19], [0, 0.19]], 0.03, 0.002)).at(x, 0.48, 0.735), blackIron(cbox(0.012, 0.01, 0.04, 0.002)).at(x, 0.5, 0.715), blackIron(cbox(0.012, 0.01, 0.04, 0.002)).at(x, 0.58, 0.715));
  B.add(bucket(0.07, 0.11, 22).at(-0.28, FY + 0.012, -0.66));

  // --- traversing carriage: chassis on four trucks riding the racer ---
  const RY = FY + 0.04, slope = 2.5;
  for (const s of [-1, 1]) {
    T.add(timber(beam(1.24, 0.095, 0.075, { seed: 160 + s, n: 14 }), OAK_DK, 160 + s).rot(0, 0, -slope).at(-0.02, RY + 0.215, s * 0.15));
    T.add(blackIron(cbox(1.2, 0.008, 0.05, 0.002)).rot(0, 0, -slope).at(-0.02, RY + 0.266, s * 0.15));
    for (const sx of [-1, 1]) {
      const tx = sx * 0.585, tz = s * 0.132, yr = RY + 0.215 - sx * 0.026;
      T.add(iron(lathe([[0, -0.02], [0.03, -0.02, 0.7], [0.064, -0.016, 0.95], [0.068, -0.01, 1.1], [0.068, 0.01, 1.1], [0.064, 0.016, 0.95], [0.03, 0.02, 0.7], [0, 0.02]], 18), 9 + sx).rot(0, 0, 90).at(tx, RY + 0.068, tz));
      T.add(blackIron(cyl(0.012, 0.075, 8)).rot(0, 0, 90).at(tx, RY + 0.068, tz));
      for (const e of [-1, 1]) T.add(blackIron(cbox(0.01, yr - RY - 0.075, 0.05, 0.002)).at(tx + e * 0.03, (yr + RY + 0.02) / 2 + 0.012, tz));
    }
  }
  for (const [x, hh, dd] of [[0.5, 0.08, 0.07], [0, 0.11, 0.16], [-0.52, 0.08, 0.07]]) T.add(timber(beam(0.24, hh, dd, { seed: 164 + x, n: 3 }), OAK_DK, 164 + x * 9).rot(0, 90, 0).at(x, RY + 0.2 - x * 0.044, 0));
  T.add(blackIron(lathe([[0, RY + 0.035], [0.06, RY + 0.035, 0.8], [0.06, RY + 0.06], [0.04, RY + 0.075], [0.04, RY + 0.15], [0, RY + 0.15]], 14)));
  // gunner's footboard and traversing handspikes at the tail
  for (let i = 0; i < 3; i++) T.add(timber(beam(0.2, 0.02, 0.073, { seed: 170 + i, n: 2 }), PINE, 170 + i).at(-0.5, RY + 0.29, (i - 1) * 0.076).rot(0, 0, 0));
  for (const s of [-1, 1]) {
    T.add(blackIron(cbox(0.05, 0.05, 0.02, 0.003)).at(-0.6, RY + 0.24, s * 0.196));
    T.add(timber(beam(0.36, 0.028, 0.028, { seed: 173 + s, n: 4, taper: [0.6, 0.6] }), ELM, 173 + s).rot(0, 0, 150).rot(0, s * 20, 0).at(-0.73, RY + 0.32, s * 0.24));
  }
  // --- top carriage: stepped cheeks on rollers ---
  const TX = 0.2, TY = 0.925;
  const y0 = RY + 0.27, ck = [[-0.2, y0 + 0.012], [0.4, y0 - 0.014], [0.4, TY - 0.02], [0.375, TY + 0.008], ...arcPts(TX, TY + 0.008, 0.05, 0, -180, 8), [TX - 0.09, TY + 0.008], [TX - 0.11, TY - 0.03], [TX - 0.19, TY - 0.04], [TX - 0.2, TY - 0.11], [TX - 0.29, TY - 0.12], [TX - 0.3, TY - 0.19], [-0.2, TY - 0.2]];
  for (const s of [-1, 1]) {
    T.add(extrude(ck, 0.06, 0.006).subdiv(0.06).color(OAK).pbr(0.86).shade(wood(vary(OAK, s * 3 + 180, 0.08), 180 + s)).at(0, 0, s * 0.155));
    T.add(blackIron(extrude([...arcPts(TX, TY + 0.008, 0.066, 0, 180, 8), ...arcPts(TX, TY + 0.008, 0.051, 180, 0, 8)], 0.064, 0.003)).at(0, 0, s * 0.155));
    for (const dx of [-0.085, 0.085]) T.add(blackIron(cbox(0.055, 0.01, 0.064, 0.002)).at(TX + dx, TY + 0.013, s * 0.155), blackIron(cyl(0.008, 0.03, 6)).at(TX + dx * 1.06, TY + 0.022, s * 0.155));
    for (const [x, y] of [[0.36, y0 + 0.04], [0.36, TY - 0.06], [0.06, TY - 0.07], [0.06, y0 + 0.05], [-0.06, TY - 0.15], [-0.15, y0 + 0.06], [0.2, y0 + 0.12]]) T.add(blackIron(stud(0.012, 0.008)).rot(s * 90, 0, 0).at(x, y, s * 0.186));
    for (const x of [-0.12, 0.32]) T.add(iron(lathe([[0, -0.03], [0.026, -0.03, 0.7], [0.034, -0.024, 1.1], [0.034, 0.024, 1.1], [0.026, 0.03, 0.7], [0, 0.03]], 12), x).rot(90, 0, 0).at(x, y0 + 0.005 - x * 0.044, s * 0.155));
  }
  for (const [x, y, hh, dd] of [[0.36, y0 + 0.12, 0.2, 0.05], [0.02, y0 + 0.07, 0.05, 0.2], [-0.16, y0 + 0.06, 0.08, 0.05]]) T.add(timber(beam(0.25, hh, dd, { seed: 184 + x, n: 3 }), OAK_DK, 184 + x * 7).rot(0, 90, 0).at(x, y, 0));
  // elevating screw and handwheel under the breech
  T.add(lathe([[0.016, 0], [0.016, 0.2]], 8, { colK: (j) => (j % 2 ? 0.7 : 1.15) }).color(BRASS).pbr(0.35, 0.9).at(-0.12, y0 + 0.07, 0));
  T.add(lathe([[0, 0], [0.04, 0, 0.7], [0.045, 0.02, 1.1], [0.03, 0.03, 0.8], [0, 0.03]], 12).color(BRASS).pbr(0.35, 0.9).at(-0.12, y0 + 0.095, 0));
  for (let i = 0; i < 4; i++) T.add(blackIron(cyl(0.006, 0.13, 6)).rot(0, 0, 90).rot(0, i * 45, 0).at(-0.12, y0 + 0.14, 0));
  T.add(blackIron(ring(0.065, 0.007, 20, 6)).at(-0.12, y0 + 0.14, 0));
  // --- the gun: bronze, long gone green in the hollows ---
  const verd = lin(0x4f9a84), bz = lin(BRONZE);
  const bronze = (x, y, z, nx, ny, nz, c) => {
    const n = fbm3(x * 11 + 3, y * 11, z * 11 - 3, 3), v = smooth(0.4, 0.66, n) * 0.6, k = 0.86 + 0.28 * noise3(x * 30, y * 30, z * 30);
    return [lerp(bz[0] * k, verd[0], v), lerp(bz[1] * k, verd[1], v), lerp(bz[2] * k, verd[2], v), lerp(0.36, 0.8, v), lerp(0.92, 0.25, v)];
  };
  const gun = gunTube({ len: 1.52, rb: 0.136, rm: 0.092, bore: 0.058, tr: 0.415, trunLen: 0.2, trunR: 0.047, col: BRONZE, finish: [0.36, 0.92], shade: bronze, dolphins: true, seg: 32, swell: 1.3 });
  T.add(gun.rot(0, 0, 4).at(TX, TY + 0.008, 0));
  // breeching rope from the cascabel to ring bolts on the chassis
  for (const s of [-1, 1]) {
    T.add(rope([[TX - 0.66, TY - 0.065, s * 0.02], [TX - 0.62, TY - 0.09, s * 0.1], [-0.3, RY + 0.36, s * 0.2], [-0.12, RY + 0.31, s * 0.215], [0.02, RY + 0.27, s * 0.2]], 0.011, { radial: 8 }).color(HEMP));
    T.add(blackIron(ring(0.02, 0.006, 12, 5)).rot(90, 0, 0).at(0.03, RY + 0.25, s * 0.196));
  }
  T.shadowFrom(cbox(2, FY, 2).at(0, FY / 2, 0));
  return { base: B.build(), turret: T.build() };
}

/**
 * Natural rock as a ring of displaced grid: prof = [[radius, y, roughness], ...] from the inner top edge
 * down and out. Displacement is outward only, so the ring never dips inside its own profile.
 */
function rockRing(prof, seg, o = {}) {
  const n = prof.length, seed = o.seed ?? 0, f = o.freq ?? 0.9, P = [], N = [], I = [], C = [];
  const base = lin(o.color ?? 0x7d7468);
  for (let j = 0; j <= seg; j++) {
    const a = ((j % seg) / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < n; i++) {
      const [r, y, amp = 0.2, lift = 0] = prof[i];
      const d = amp * (0.1 + fbm3(ca * r * f + seed, y * f * 1.6 + seed * 0.3, sa * r * f - seed, 4) * 1.5 + 0.35 * noise3(ca * r * f * 4.1, y * 5 + seed, sa * r * f * 4.1));
      const rr = r + d, yy = y + d * 0.25 * (i === 0 ? 0 : 1) + lift * fbm3(ca * r * 2.6 + seed * 2, 1.7, sa * r * 2.6 - seed, 3);
      P.push(ca * rr, yy, sa * rr); N.push(0, 0, 0);
      const k = 0.72 + 0.5 * fbm3(ca * rr * 2.2 + seed, yy * 2.2, sa * rr * 2.2, 3);
      C.push(base[0] * k, base[1] * k, base[2] * k * 0.98);
    }
  }
  for (let j = 0; j < seg; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + n, c = a + 1, d = b + 1;
    for (const [i0, i1, i2] of [[a, b, d], [a, d, c]]) {
      const e1 = [P[i1 * 3] - P[i0 * 3], P[i1 * 3 + 1] - P[i0 * 3 + 1], P[i1 * 3 + 2] - P[i0 * 3 + 2]], e2 = [P[i2 * 3] - P[i0 * 3], P[i2 * 3 + 1] - P[i0 * 3 + 1], P[i2 * 3 + 2] - P[i0 * 3 + 2]];
      let fn = v3cross(e1, e2);
      const mx = (P[i0 * 3] + P[i1 * 3] + P[i2 * 3]) / 3, mz = (P[i0 * 3 + 2] + P[i1 * 3 + 2] + P[i2 * 3 + 2]) / 3;
      if (fn[0] * mx + fn[2] * mz + fn[1] * 2 < 0) fn = [-fn[0], -fn[1], -fn[2]];
      for (const k of [i0, i1, i2]) { N[k * 3] += fn[0]; N[k * 3 + 1] += fn[1]; N[k * 3 + 2] += fn[2]; }
      I.push(i0, i1, i2);
    }
  }
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = N[i * 3 + k] + N[(seg * n + i) * 3 + k]; N[i * 3 + k] = v; N[(seg * n + i) * 3 + k] = v; }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  const pc = new Pc(P, N, I);
  pc.C = C; pc.occT = null; pc.rough = 0.97; pc.aoWide = true;
  return pc;
}
/** a weathered boulder with radii (rx, ry, rz) */
function boulder(rx, ry, rz, seed = 0, col = 0x7d7468, detail = 3) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 0.72 + 0.5 * fbm3(x * 1.3 + seed, y * 1.3 - seed, z * 1.3 + seed * 0.7, 3) + 0.1 * noise3(x * 5 + seed, y * 5, z * 5);
    p.setXYZ(i, x * d * rx, Math.max(-0.55, y * d) * ry, z * d * rz);
  }
  g.computeVertexNormals();
  const base = lin(col);
  const pc = fromGeo(g).pbr(0.97).shade((x, y, z) => mulc(base, 0.7 + 0.55 * fbm3(x * 2.4 + seed, y * 2.4, z * 2.4, 3)));
  pc.occT = 'sph';
  return pc;
}
/**
 * Conical roof of overlapping scale tiles: eave radius rE at yE, apex at yA.
 * o: tile (width), show (exposed length), color, seed, moss
 */
function tiledCone(rE, yE, yA, o = {}) {
  const tw = o.tile ?? 0.2, ex = o.show ?? 0.2, seed = o.seed ?? 0, thick = o.thick ?? 0.028, base = lin(o.color ?? 0xa8482e);
  const H = yA - yE, S = Math.hypot(rE, H), rows = Math.max(3, Math.floor((S - 0.06) / ex));
  const P = [], N = [], I = [], C = [], nl = Math.hypot(H, rE);
  const at = (a, s, lift) => { const r = rE * (1 - s / S), ca = Math.cos(a), sa = Math.sin(a); return [ca * r + (ca * H / nl) * lift, yE + (s / S) * H + (rE / nl) * lift, sa * r + (sa * H / nl) * lift]; };
  const moss = lin(0x66763c);
  for (let k = 0; k < rows; k++) {
    const s0 = k * ex, s1 = Math.min(S - 0.01, s0 + ex * 1.75), rm = rE * (1 - (s0 + ex / 2) / S), n = Math.max(5, Math.round((TAU * rm) / tw)), off = (k % 2) * 0.5 + hash1(seed + k) * 0.2;
    for (let i = 0; i < n; i++) {
      const a0 = ((i + off) / n) * TAU, a1 = ((i + off + 0.94) / n) * TAU, am = (a0 + a1) / 2, id = seed * 131 + k * 97 + i;
      const lift = thick * (0.8 + 0.5 * hash1(id)), dr = (hash1(id + 5) - 0.5) * 0.02;
      const UL = at(a0, s1, 0.004), UR = at(a1, s1, 0.004), LR = at(a1, s0 + 0.035 + dr, lift), LM = at(am, s0 - 0.022 + dr, lift * 1.1), LL = at(a0, s0 + 0.035 + dr, lift);
      const LRb = at(a1, s0 + 0.035 + dr, 0), LMb = at(am, s0 - 0.022 + dr, 0), LLb = at(a0, s0 + 0.035 + dr, 0);
      let tone = vary(base, id, 0.2);
      const hv = hash1(id + 11);
      if (hv < 0.14) tone = mulc(tone, 0.68); else if (hv > 0.92) tone = mixc(tone, 0xc27a46, 0.35);
      const ms = (o.moss ?? 0.5) * smooth(0.5, 0.8, noise3(Math.cos(am) * rm * 1.6 + seed, s0 * 1.3, Math.sin(am) * rm * 1.6)) * smooth(S * 0.9, 0, s0);
      tone = mixc(tone, moss, ms * 0.7);
      const v0 = P.length / 3, fnm = v3norm(v3cross(v3sub(UR, UL), v3sub(LM, UL)));
      const up = fnm[1] < 0 ? [-fnm[0], -fnm[1], -fnm[2]] : fnm;
      for (const q of [UL, UR, LR, LM, LL]) { P.push(q[0], q[1], q[2]); N.push(up[0], up[1], up[2]); }
      C.push(...mulc(tone, 0.62), ...mulc(tone, 0.62), ...mulc(tone, 1.08), ...mulc(tone, 1.14), ...mulc(tone, 1.08));
      I.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3, v0, v0 + 3, v0 + 4);
      // the butt edge of the tile
      const dn = v3norm(v3sub(LMb, at(am, s0 + 0.2, 0)));
      const e0 = P.length / 3;
      for (const q of [LL, LM, LR, LLb, LMb, LRb]) { P.push(q[0], q[1], q[2]); N.push(dn[0], dn[1], dn[2]); }
      C.push(...mulc(tone, 0.8), ...mulc(tone, 0.8), ...mulc(tone, 0.8), ...mulc(tone, 0.4), ...mulc(tone, 0.4), ...mulc(tone, 0.4));
      I.push(e0, e0 + 1, e0 + 4, e0, e0 + 4, e0 + 3, e0 + 1, e0 + 2, e0 + 5, e0 + 1, e0 + 5, e0 + 4);
    }
  }
  const pc = new Pc(P, N, I);
  pc.C = C; pc.occT = null; pc.rough = 0.82; pc.aoWide = true;
  const under = lathe([[rE, yE, 0.5], [0.02, yA - 0.02, 0.5]], 48).color(mulc(base, 0.3)).pbr(0.9).occ(null).ao(0);
  return grp(pc, under);
}
/** an arched opening framed in dressed stone, facing +X from the origin (sill centre on the wall face) */
function stoneArch(wd, jamb, depth, seed, o = {}) {
  const g = grp(), r0 = wd / 2, r1 = r0 + (o.ring ?? 0.13), col = o.color ?? STONE_WARM;
  g.add(cbox(0.02, jamb + r0 + 0.04, wd + 0.06, 0.002).color(o.dark ?? 0x0c0c0f).pbr(1).at(o.back ?? 0.04, (jamb + r0) / 2, 0).ao(0).occ(null));
  if (o.sill !== false) g.add(block(depth + 0.05, 0.07, wd + (r1 - r0) * 2 + 0.06, seed, col).at(depth / 2 - 0.01, -0.033, 0));
  const nj = Math.max(1, Math.round(jamb / 0.2));
  for (const s of [-1, 1]) for (let k = 0; k < nj; k++) g.add(block(depth - (k % 2) * 0.012, jamb / nj - 0.006, r1 - r0 + (k % 2 ? 0.03 : 0), seed + 3 + s + k * 5, col).at(depth / 2 - 0.02, (jamb / nj) * (k + 0.5), s * (r0 + (r1 - r0) / 2 + (k % 2 ? 0.015 : 0))));
  const nv = o.voussoirs ?? 5;
  for (let i = 0; i < nv; i++) {
    const b0 = (i / nv) * Math.PI + 0.012, b1 = ((i + 1) / nv) * Math.PI - 0.012, key = i === (nv - 1) / 2, c = [];
    for (let k = 0; k < 8; k++) { const b = k & 4 ? b1 : b0, r = k & 1 ? r1 + (key ? 0.03 : 0) : r0, x = k & 2 ? depth - 0.02 + (key ? 0.02 : 0) : -0.02; c.push([x, jamb + Math.sin(b) * r, Math.cos(b) * r]); }
    const tone = vary(col, seed + 20 + i, 0.1);
    g.add(hexa(c, 0.012).color(tone).pbr(0.95).shade(stoneShade(tone, seed + i)));
  }
  return g;
}
/** a streaming swallow-tailed banner in the XY plane, hoist at x = 0, flying toward +X */
function banner(len, hgt, colA, colB, seed = 0) {
  const nx = 16, ny = 6, P = [], N = [], I = [], C = [], a = lin(colA), b = lin(colB);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny, tail = u > 0.72 ? ((u - 0.72) / 0.28) * (0.5 - Math.abs(v - 0.5)) * 1.5 : 0;
    const x = u * len * (1 - tail * 0.45), wave = Math.sin(u * 7.5 + seed) * 0.09 * u * len + Math.sin(u * 13 + v * 3) * 0.02 * u;
    P.push(x, (v - 0.5) * hgt * (1 - u * 0.25) - u * u * 0.12 * len, wave); N.push(0, 0, 1);
    const stripe = Math.abs(v - 0.5) < 0.17 ? 1 : 0, k = 0.82 + 0.3 * Math.cos(u * 7.5 + seed);
    C.push(lerp(a[0], b[0], stripe) * k, lerp(a[1], b[1], stripe) * k, lerp(a[2], b[2], stripe) * k);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * (nx + 1) + i; I.push(q, q + 1, q + nx + 2, q, q + nx + 2, q + nx + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setIndex(I); g.computeVertexNormals();
  const pc = new Pc(P, Array.from(g.attributes.normal.array), I);
  pc.C = C; pc.occT = null; pc.rough = 0.9; pc.aoK = 0;
  return pc;
}

/** the stain the sea leaves: wet rock, weed, a pale barnacle line, damp and algae above. s = the scale the model is shown at */
function tideStain(s = 1) {
  const weed = lin(0x46582a), wetc = lin(0x2c2a26), barn = lin(0xb9b29a);
  return (x0, y0, z0, nx, ny, nz, c) => {
    const x = x0 * s, y = y0 * s, z = z0 * s;
    if (y > 1.0) return null;
    const n = noise3(x * 1.3, y * 2.2, z * 1.3), n2 = noise3(x * 6.1, y * 6.1, z * 6.1);
    const wet = smooth(-0.2 + 0.3 * n, -0.62, y), wd = smooth(-0.22 + 0.25 * n, -0.5, y) * smooth(0.25, 0.6, n2 * 0.6 + n * 0.5), bn = smooth(-0.5, -0.3, y) * smooth(-0.05, -0.25, y) * smooth(0.62, 0.8, n2);
    const damp = smooth(0.9, 0.05, y) * (0.14 + 0.24 * smooth(0.4, 0.8, noise3(x * 2.3 + 9, 0.3, z * 2.3))), alg = smooth(0.75, 0.0, y) * smooth(0.42, 0.78, noise3(x * 3.1, y * 1.1, z * 3.1)) * 0.62;
    let r = c[0] * (1 - damp), g = c[1] * (1 - damp), b = c[2] * (1 - damp);
    r = lerp(r, weed[0] * 1.1, alg); g = lerp(g, weed[1] * 1.25, alg); b = lerp(b, weed[2], alg);
    r = lerp(r, r * 0.45 + wetc[0] * 0.3, wet); g = lerp(g, g * 0.45 + wetc[1] * 0.3, wet); b = lerp(b, b * 0.45 + wetc[2] * 0.3, wet);
    r = lerp(r, weed[0], wd * 0.8); g = lerp(g, weed[1], wd * 0.8); b = lerp(b, weed[2], wd * 0.8);
    r = lerp(r, barn[0], bn * 0.6); g = lerp(g, barn[1], bn * 0.6); b = lerp(b, barn[2], bn * 0.6);
    return [r, g, b];
  };
}

/**
 * What a gun stands on when it is a fort at sea. The game puts a plain nine-sided drum under every fort
 * (top radius size x 1.05, flaring to x 1.25 a unit lower); this rock is built just outside that drum so it
 * disappears, and the single guns get a walled, paved platform so they read as a fort rather than a prop.
 * kind 'battery': built at 1:1 round the 2 x 2 emplacement. kind 'gun': in the units of a 1 x 1 gun shown at scale s.
 */
function buildFooting(kind, s) {
  const F = new Asm({ ground: null, post: tideStain(s) });
  if (kind === 'battery') {
    F.add(rockRing([[0.9, 0.04, 0.01], [1.15, 0.04, 0.02, 0.05], [1.4, 0.04, 0.04, 0.14], [1.65, 0.04, 0.05, 0.2], [1.9, 0.04, 0.06, 0.2], [2.12, 0.04, 0.08, 0.16], [2.3, 0.03, 0.1, 0.1], [2.42, 0.0, 0.14], [2.52, -0.15, 0.2], [2.64, -0.4, 0.22], [2.8, -0.7, 0.2], [2.92, -0.95, 0.16], [2.97, -1.3, 0.1]], 96, { seed: 11, freq: 1.0 }));
    // a rough causeway of flags from the gorge steps to the water's edge
    for (let i = 0; i < 6; i++) F.add(block(0.3 + hash1(i + 80) * 0.1, 0.1, 0.44 + hash1(i + 90) * 0.16, 70 + i, i % 2 ? 0x99917f : 0x8f887a, 0.02).rot(0, (hash1(i + 75) - 0.5) * 16, 0).at(-1.22 - i * 0.25, 0.11 - Math.max(0, i - 3) * 0.07, (hash1(i + 85) - 0.5) * 0.12));
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + hash1(i + 20) * 0.6, sz = 0.22 + hash1(i + 30) * 0.26; F.add(boulder(sz * 1.3, sz, sz * 1.1, i * 7 + 2).rot(0, hash1(i + 9) * 360, 0).at(Math.cos(a) * (2.72 + hash1(i + 60) * 0.2), -0.62 + hash1(i + 70) * 0.4, Math.sin(a) * (2.72 + hash1(i + 60) * 0.2))); }
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + hash1(i + 120) * 0.5, sz = 0.07 + hash1(i + 130) * 0.1; F.add(boulder(sz * 1.3, sz * 0.8, sz, i * 5 + 50, 0x857b6c, 2).rot(0, hash1(i + 19) * 360, 0).at(Math.cos(a) * (1.7 + hash1(i + 160) * 0.45), 0.09, Math.sin(a) * (1.7 + hash1(i + 160) * 0.45))); }
  } else {
    F.add(rockRing([[0.98, 0.03, 0.01], [1.1, 0.035, 0.03], [1.2, 0.0, 0.05], [1.26, -0.1, 0.08], [1.32, -0.25, 0.1], [1.4, -0.42, 0.1], [1.46, -0.6, 0.08], [1.5, -0.85, 0.05]], 80, { seed: 13, freq: 2.0 }));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + hash1(i + 20) * 0.7, sz = 0.11 + hash1(i + 30) * 0.13; F.add(boulder(sz * 1.3, sz, sz * 1.1, i * 7 + 3, 0x7d7468, 2).rot(0, hash1(i + 9) * 360, 0).at(Math.cos(a) * (1.4 + hash1(i + 60) * 0.08), -0.34 + hash1(i + 70) * 0.2, Math.sin(a) * (1.4 + hash1(i + 60) * 0.08))); }
    // paved platform inside a low ring wall, open at the back
    F.add(masonry({ ...ringFloor(0.3, 0.88, 0.004), course: 0.15, len: 0.2, seed: 15, raise: 0.006, proud: 0.004, bevel: 0.01, joint: 0.008, color: 0xa29c8e, seg: 0.1 }));
    F.add(lathe([[0, 0.002], [0.9, 0.002]], 40).color(MORTAR).ao(0).occ(null));
    const gate = (n) => (i) => Math.abs(((i + 0.5) / n) * TAU - Math.PI) < 0.24;
    F.add(arcCourse(0.865, 1.005, 0, 0.125, 0, TAU, 26, { seed: 17, skip: gate(26), jitter: 0.008, bevel: 0.008, gap: 0.004 }));
    F.add(arcCourse(0.872, 0.998, 0.125, 0.245, TAU / 52, TAU + TAU / 52, 26, { seed: 19, skip: (i) => Math.abs(((i + 1) / 26) * TAU - Math.PI) < 0.24, jitter: 0.008, bevel: 0.008, gap: 0.004 }));
    F.add(arcCourse(0.85, 1.02, 0.245, 0.282, 0, TAU, 18, { seed: 21, skip: gate(18), color: STONE_WARM, moss: 0.25, jitter: 0.006, bevel: 0.01, slope: -0.012, gap: 0.004 }));
    for (const sg of [-1, 1]) {
      const a = Math.PI + sg * 0.27;
      for (let q = 0; q < 3; q++) F.add(block(0.17 - (q % 2) * 0.01, 0.115, 0.15 - (q % 2) * 0.01, 23 + sg + q * 3, q % 2 ? STONE_WARM : STONE, 0.008).rot(0, -a / DEG, 0).at(Math.cos(a) * 0.935, 0.0575 + q * 0.115, Math.sin(a) * 0.935));
      F.add(block(0.15, 0.05, 0.13, 27 + sg, STONE_WARM, 0.008, 0.3, 0.3).rot(0, -a / DEG, 0).at(Math.cos(a) * 0.935, 0.37, Math.sin(a) * 0.935));
    }
    F.shadowFrom(cyl(1.0, 0.25, 16).at(0, 0.125, 0));
  }
  return F.build();
}

// ====================================================================================
// sea fort: a round gun tower rising from a rock, with an inner keep under a tiled lantern
// ====================================================================================
function buildSeaFort(R) {
  const k = R / 3.6;
  // the game seats the fort 0.6 above the sea, so the water works between about y = -1.05 and -0.45
  const B = new Asm({ ground: null, post: tideStain(1) }), T = new Asm({ ground: null });
  const TALY = 0.75, Rb = R * 0.95, Rt = R * 0.9, WY = 1.6, Po = Rt + 0.2, Pi = Po - 0.3;
  const Tb = R * 0.43, Tt = R * 0.4, PODY = WY + 0.36, TY = 3.45;
  const polar = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
  const place = (g, a, r, y, tilt = 0) => g.rot(0, 0, tilt).rot(0, -a / DEG, 0).at(Math.cos(a) * r, y, Math.sin(a) * r);

  // --- the rock it stands on (this also swallows the plain footing the game puts under every fort) ---
  B.add(rockRing([[R * 0.95, 0.1, 0.02], [R * 1.05, 0.08, 0.05, 0.1], [R * 1.14, 0.05, 0.08, 0.12], [R * 1.2, 0.02, 0.12], [R * 1.25, -0.12, 0.2], [R * 1.3, -0.35, 0.24], [R * 1.37, -0.62, 0.22], [R * 1.43, -0.9, 0.2], [R * 1.48, -1.15, 0.18], [R * 1.5, -1.4, 0.1]], 120, { seed: 3, freq: 0.8 }));
  const aGate = 0.6, gateHalf = 0.42 / Po, nst = 9, da = 0.335 / R, aTop = aGate + gateHalf - da * 0.2, aFoot = aTop + (nst - 0.5) * da, aDock = aFoot + 0.2;
  const nearDock = (a) => { let d = (a - aDock) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return Math.abs(d) < 0.45; };
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + hash1(i + 40) * 0.5, sz = 0.3 + hash1(i + 50) * 0.38;
    if (nearDock(a)) continue; // keep the landing clear
    B.add(boulder(sz * 1.3, sz, sz * 1.1, i * 7 + 1).rot(hash1(i) * 20, hash1(i + 9) * 360, 0).at(Math.cos(a) * R * (1.36 + hash1(i + 60) * 0.12), -0.72 + hash1(i + 70) * 0.5, Math.sin(a) * R * (1.36 + hash1(i + 60) * 0.12)));
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + hash1(i + 140) * 0.4, sz = 0.1 + hash1(i + 150) * 0.12;
    if (nearDock(a)) continue;
    B.add(boulder(sz * 1.3, sz * 0.8, sz, i * 5 + 100, 0x857b6c, 2).rot(0, hash1(i + 109) * 360, 0).at(Math.cos(a) * R * (1.09 + hash1(i + 160) * 0.1), 0.1, Math.sin(a) * R * (1.09 + hash1(i + 160) * 0.1)));
  }
  // --- talus, then the battered drum ---
  B.add(masonry({ ...drumSurf(R * 1.035, R * 0.968, 0.04, TALY - 0.04), course: 0.24, len: 0.6, seed: 61, seg: 0.22, raise: 0.03, bevel: 0.03, proud: 0.02 }));
  B.add(lathe([[Rb, TALY + 0.075, 0.55], [R * 0.968 + 0.02, TALY + 0.055, 0.95], [R * 0.968 + 0.04, TALY + 0.025, 1.1], [R * 0.968 + 0.03, TALY - 0.005, 0.85], [R * 0.968, TALY - 0.02, 0.6]], 120).color(STONE_WARM).pbr(0.95).shade(stoneShade(STONE_WARM, 5, 0.3)).occ(null).wide());
  const DY0 = TALY + 0.06;
  B.add(masonry({ ...drumSurf(Rb, Rt, DY0, WY - DY0), course: 0.185, len: 0.5, seed: 63, seg: 0.22, raise: 0.024, bevel: 0.022, proud: 0.016, backV: 3 }));
  B.shadowFrom(cyl(Rb, WY, 24).at(0, WY / 2, 0), cyl(Tb, 3, 16).at(0, 2.6, 0), cyl(2.5 * k, 0.18, 16).at(0, WY + 0.09, 0), cyl(2.05 * k, 0.36, 16).at(0, WY + 0.18, 0));
  // string course and corbel table carrying the parapet
  B.add(lathe([[Rt - 0.01, 1.4, 0.55], [Rt + 0.04, 1.425, 0.95], [Rt + 0.06, 1.45, 1.1], [Rt + 0.06, 1.475, 1.05], [Rt + 0.02, 1.5, 0.6]], 120).color(STONE_WARM).pbr(0.95).shade(stoneShade(STONE_WARM, 6, 0.2)).occ(null).wide());
  const nc = Math.round(44 * k);
  for (let i = 0; i < nc; i++) {
    const a0 = ((i + 0.22) / nc) * TAU, a1 = ((i + 0.78) / nc) * TAU, c = [];
    for (let q = 0; q < 8; q++) { const a = q & 4 ? a1 : a0, top = q & 2, r = q & 1 ? (top ? Po + 0.01 : Rt + 0.05) : Rt - 0.04; c.push(polar(a, r, top ? WY : 1.45)); }
    const tone = vary(STONE_WARM, i + 300, 0.1);
    B.add(hexa(c, 0.012).color(tone).pbr(0.95).shade(stoneShade(tone, i)).occ(null));
  }
  // --- parapet: two courses of real blocks, merlons with weathered caps; a gap at the stair head ---
  const np = Math.round(54 * k), nm = Math.round(26 * k);
  const inGate = (a) => { let d = (a - aGate) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return Math.abs(d) < gateHalf; };
  B.add(arcCourse(Pi, Po, WY, 1.82, 0, TAU, np, { seed: 71, skip: (i) => inGate(((i + 0.5) / np) * TAU) }));
  B.add(arcCourse(Pi + 0.012, Po - 0.012, 1.82, 2.03, TAU / np / 2, TAU + TAU / np / 2, np, { seed: 73, skip: (i) => inGate(((i + 1) / np) * TAU) }));
  for (let i = 0; i < nm; i++) {
    const a0 = ((i + 0.2) / nm) * TAU, a1 = ((i + 0.8) / nm) * TAU;
    if (inGate((a0 + a1) / 2) || inGate(a0) || inGate(a1)) continue;
    B.add(arcCourse(Pi, Po, 2.03, 2.38, a0, a1, 1, { seed: 75 + i * 3 }));
    B.add(arcCourse(Pi - 0.03, Po + 0.03, 2.38, 2.44, a0 - 0.03 / Po, a1 + 0.03 / Po, 1, { seed: 77 + i * 3, color: STONE_WARM, moss: 0.3, slope: -0.02, bevel: 0.018 }));
  }
  for (const s of [-1, 1]) { // gate piers
    const a = aGate + s * (gateHalf + 0.13 / Po);
    for (let q = 0; q < 4; q++) B.add(place(block(0.34 - (q % 2) * 0.014, 0.235, 0.24 - (q % 2) * 0.014, 80 + s + q * 3, q % 2 ? STONE_WARM : STONE), a, (Pi + Po) / 2, WY + 0.1175 + q * 0.235));
    B.add(place(block(0.4, 0.04, 0.3, 84 + s, STONE_WARM), a, (Pi + Po) / 2, WY + 0.96), place(block(0.34, 0.1, 0.24, 86 + s, STONE_WARM, 0.012, 0.3, 0.3), a, (Pi + Po) / 2, WY + 1.03));
  }
  // --- terreplein paving, and the stepped podium the keep stands on ---
  B.add(masonry({ ...ringFloor(2.4 * k, Pi + 0.03, WY), course: 0.36, len: 0.5, seed: 65, raise: 0.012, proud: 0.008, bevel: 0.018, color: 0xa29c8e, lenVar: 0.5, seg: 0.3 }));
  B.add(lathe([[2.3 * k, WY - 0.004], [Po - 0.02, WY - 0.004]], 72).color(MORTAR).ao(0).occ(null));
  B.add(arcCourse(2.0 * k, 2.5 * k, WY - 0.02, WY + 0.18, 0, TAU, Math.round(30 * k), { seed: 101, color: 0xa29c8e, jitter: 0.02, jitterY: 0.006, bevel: 0.016 }));
  B.add(arcCourse(Tb - 0.06, 2.05 * k, WY + 0.16, PODY, 0.1, TAU + 0.1, Math.round(24 * k), { seed: 103, color: 0xa8a294, jitter: 0.02, jitterY: 0.006, bevel: 0.016 }));
  // --- gun ports all round: framed arches, muzzles run out, lids triced up ---
  const batter = Math.atan((Rb - Rt) / (WY - DY0)) / DEG, rAt = (y) => Rb + ((Rt - Rb) * (y - DY0)) / (WY - DY0);
  for (let i = 0; i < 8; i++) {
    const a = aDock + 0.42 + (i / 7) * (TAU - (aDock - aGate) - 0.84 + 0.0), g = grp(stoneArch(0.4, 0.16, 0.14, 400 + i * 9, { back: 0.035, ring: 0.12 }));
    const mz = lathe([[0.058, -0.06, 0.6], [0.058, 0.16, 1], [0.058, 0.162, 0.6], [0.066, 0.168, 1.2], [0.066, 0.18, 1.2], [0.058, 0.19, 0.7], [0.056, 0.24, 0.9], [0.062, 0.27, 1], [0.076, 0.3, 1.2], [0.076, 0.315, 1.15], [0.07, 0.325, 1], [0.07, 0.325, 0.9], [0.044, 0.325, 0.6], [0.038, 0.31, 0.2], [0.038, 0.2, 0.03], [0, 0.2, 0.03]], 12);
    g.add(mz.color(IRON).pbr(0.48, 0.8).shade(metalShade(IRON, i, 0x7a4426, 0.35)).rot(0, 0, -90).at(0.02, 0.17, 0));
    // lid: three planks on two strap hinges, propped open
    const lid = grp();
    for (let q = 0; q < 3; q++) lid.add(timber(beam(0.46, 0.03, 0.15, { seed: 420 + i * 5 + q, n: 2, kh: 1, kd: 2 }), q === 1 ? OAK : OAK_DK, 420 + i * 5 + q).rot(0, 90, 0).at((q - 1) * 0.155 + 0.24, 0, 0));
    for (const z of [-0.14, 0.14]) lid.add(blackIron(cbox(0.44, 0.012, 0.04, 0.003)).at(0.24, 0.02, z), blackIron(stud(0.012, 0.007, 5)).at(0.1, 0.027, z), blackIron(stud(0.012, 0.007, 5)).at(0.38, 0.027, z));
    g.add(lid.rot(0, 0, 16).at(0.11, 0.5, 0));
    for (const z of [-0.19, 0.19]) g.add(blackIron(tube([[0.05, 0.66, z * 0.8], [0.5, 0.63, z]], 0.006, 5)));
    B.add(place(g, a, rAt(0.9) + 0.012, 0.9, batter));
  }
  // --- stone stair winding up the drum to the gate ---
  for (let i = 0; i < nst; i++) {
    const yT = 0.3 + ((WY - 0.3) * i) / (nst - 1), a1 = aTop + (nst - 1 - i) * da, a0 = a1 - da * (i === nst - 1 ? 2.4 : 1), r1 = R * 0.965 + 0.62;
    const nb = Math.max(1, Math.round((yT - 0.02) / 0.23));
    for (let q = 0; q < nb; q++) {
      const y0 = 0.02 + ((yT - 0.02) * q) / nb, y1 = 0.02 + ((yT - 0.02) * (q + 1)) / nb, tread = q === nb - 1;
      B.add(arcCourse(Rt - 0.08, r1 - (tread ? 0 : 0.02 + 0.012 * (q % 2)), y0, y1, a0, a1 + (i === nst - 1 ? 0 : 0.002), i === nst - 1 ? 2 + (q % 2) : 1, { seed: 500 + i * 7 + q, jitter: 0.006, jitterY: 0, color: tread ? 0xa8a294 : STONE, gap: 0.004 }));
    }
  }
  // --- landing stage: piles, bearers, deck planks, mooring posts, a lamp; rock-cut steps up to the stair foot ---
  {
    const D = grp(), x0 = R * 1.36 + 0.12, x1 = x0 + 2.0, yd = -0.42, wdk = 1.1, zp = wdk / 2 - 0.02;
    const pile = (x, z, top, sd) => timber(lathe([[0, -1.7], [0.075, -1.7, 0.7], [0.07, top - 0.02, 1], [0.06, top, 1.05], [0, top, 1]], 10), OAK_DK, sd, 'y').at(x, 0, z);
    for (const [x, tall] of [[x0 + 0.25, 0], [x0 + 1.05, 0], [x1 - 0.12, 1]]) for (const s of [-1, 1]) {
      D.add(pile(x, s * zp, tall ? yd + 0.5 : yd - 0.02, 600 + x * 3 + s));
      if (tall) D.add(blackIron(lathe([[0.071, -0.02, 0.7], [0.078, -0.02], [0.078, 0.02], [0.071, 0.02, 0.7]], 10)).at(x, yd + 0.42, s * zp).occ(null));
    }
    for (const x of [x0 + 0.25, x0 + 1.05, x1 - 0.12]) D.add(timber(beam(wdk + 0.1, 0.1, 0.09, { seed: 610 + x, n: 4, kh: 2, kd: 2 }), OAK_DK, 610 + x * 7).rot(0, 90, 0).at(x - 0.085, yd - 0.1, 0));
    for (const s of [-1, 1]) {
      D.add(timber(beam(2.0, 0.09, 0.07, { seed: 615 + s, n: 8, kh: 2, kd: 2 }), OAK_DK, 615 + s).at((x0 + x1) / 2, yd - 0.065, s * 0.33));
      D.add(strut([x0 + 0.25, -1.15, s * zp], [x0 + 1.05, yd - 0.2, s * zp], 0.05, 0.035, { n: 4, kh: 1, kd: 1 }, OAK_DK, 618 + s));
    }
    const npl = 14;
    for (let i = 0; i < npl; i++) D.add(timber(beam(wdk + (hash1(i + 620) - 0.5) * 0.08, 0.035, 2.0 / npl - 0.012, { seed: 620 + i, n: 4, kh: 1, kd: 3, rough: 0.003 }), i % 3 ? PINE : ELM, 620 + i).rot(0, 90 + (hash1(i + 640) - 0.5) * 2, 0).at(x0 + (i + 0.5) * (2.0 / npl), yd + 0.0175, (hash1(i + 660) - 0.5) * 0.03));
    // mooring line round a post, a coil on the deck
    { const pts = []; for (let i = 0; i <= 36; i++) { const a = (i / 36) * TAU * 3; pts.push([x1 - 0.12 + Math.cos(a) * 0.082, yd + 0.2 + (i / 36) * 0.07, zp + Math.sin(a) * 0.082]); } pts.push([x1 - 0.3, yd + 0.12, zp - 0.18], [x1 - 0.5, yd + 0.05, zp - 0.3]);
      D.add(rope(pts, 0.014, { smooth: 0, radial: 6 }).color(HEMP));
      const c2 = []; for (let i = 0; i <= 56; i++) { const a = (i / 56) * TAU * 4, rr = 0.2 - (i / 56) * 0.13; c2.push([x1 - 0.62 + Math.cos(a) * rr, yd + 0.05 + (i / 56) * 0.02, 0.2 + Math.sin(a) * rr]); }
      D.add(rope(c2, 0.014, { smooth: 0, radial: 6 }).color(HEMP)); }
    // lamp post at the head of the stage
    const lz = -zp - 0.085;
    D.add(timber(beam(1.0, 0.07, 0.07, { seed: 630, n: 5, kh: 2, kd: 2 }), OAK_DK, 630).rot(0, 0, 90).at(x1 - 0.12, yd + 0.5, lz));
    D.add(timber(beam(0.3, 0.05, 0.05, { seed: 631, n: 2, kh: 1, kd: 1 }), OAK_DK, 631).at(x1 - 0.02, yd + 0.96, lz));
    D.add(blackIron(lathe([[0, 0], [0.05, 0.005, 0.8], [0.055, 0.02], [0.012, 0.05], [0, 0.05]], 8)).at(x1 + 0.08, yd + 0.84, lz), blackIron(lathe([[0, 0], [0.045, 0, 0.8], [0.05, 0.012], [0, 0.012]], 8)).at(x1 + 0.08, yd + 0.72, lz));
    D.add(cyl(0.036, 0.1, 8, 0.002).color(0xffc060).glow(1.5).pbr(0.4).at(x1 + 0.08, yd + 0.785, lz).ao(0));
    for (let q = 0; q < 4; q++) D.add(blackIron(cyl(0.004, 0.11, 4)).at(x1 + 0.08 + Math.cos(q * 1.571) * 0.042, yd + 0.785, lz + Math.sin(q * 1.571) * 0.042));
    D.add(blackIron(cyl(0.004, 0.07, 4)).at(x1 + 0.08, yd + 0.92, lz));
    // steps hewn up the rock from the stage to the foot of the stair
    const tops = [-0.34, -0.2, -0.06, 0.07, 0.17, 0.22];
    tops.forEach((yt, i) => D.add(block(0.27, 0.46, 0.7 - i * 0.02, 650 + i, i % 2 ? 0x8f887a : 0x99917f, 0.02).rot(0, (hash1(i + 655) - 0.5) * 8, 0).at(x0 + 0.02 - i * 0.2, yt - 0.23, -0.06 * i)));
    B.add(D.rot(0, -aDock / DEG, 0));
  }
  // --- inner tower ---
  B.add(lathe([[Tb + 0.07, PODY, 0.6], [Tb + 0.07, PODY + 0.1, 1], [Tb + 0.02, PODY + 0.16, 0.9], [Tb - 0.01, PODY + 0.17, 0.6]], 72).color(STONE_WARM).pbr(0.95).shade(stoneShade(STONE_WARM, 9, 0.2)).occ(null).wide());
  B.add(masonry({ ...drumSurf(Tb, Tt, PODY + 0.14, TY - PODY - 0.14), course: 0.185, len: 0.44, seed: 67, seg: 0.16, raise: 0.022, bevel: 0.02, proud: 0.014, color: 0x9d9a90 }));
  // door toward the landing, arrow loops round the wall
  {
    // a man is 1.0 tall: the door stands a full 1.0 to the crown of its arch
    const a = aDock - 0.1, g = grp(stoneArch(0.5, 0.75, 0.12, 700, { ring: 0.12, back: 0.03, dark: 0x1a120c, sill: false }));
    for (let q = 0; q < 5; q++) g.add(timber(beam(0.99 - Math.abs(q - 2) * 0.05, 0.025, 0.098, { seed: 710 + q, n: 5, kh: 1, kd: 3 }), q % 2 ? OAK : OAK_DK, 710 + q).rot(0, 0, 90).at(0.05, 0.495 - Math.abs(q - 2) * 0.025, (q - 2) * 0.1));
    for (const y of [0.16, 0.46, 0.74]) { g.add(blackIron(cbox(0.012, 0.045, 0.48, 0.003)).at(0.066, y, 0)); for (const z of [-0.18, -0.06, 0.06, 0.18]) g.add(blackIron(stud(0.011, 0.007, 5)).rot(0, 0, -90).at(0.072, y, z)); }
    g.add(blackIron(ring(0.04, 0.008, 14, 6)).rot(0, 0, 90).at(0.077, 0.44, 0.15));
    B.add(place(g, a, Tb - 0.01, PODY + 0.01, 1.2));
    for (const ad of [1.3, 2.9, 4.5]) {
      const sl = grp(cbox(0.02, 0.4, 0.05, 0.002).color(0x0c0c0f).pbr(1).at(0.03, 0.2, 0).ao(0).occ(null));
      for (const s of [-1, 1]) sl.add(block(0.07, 0.44, 0.09, 730 + ad * 9 + s, STONE_WARM).at(0.03, 0.2, s * 0.07));
      sl.add(block(0.08, 0.06, 0.26, 740 + ad * 9, STONE_WARM).at(0.03, 0.45, 0), block(0.09, 0.05, 0.26, 745 + ad * 9, STONE_WARM).at(0.035, -0.04, 0));
      B.add(place(sl, a + ad, (Tb + Tt) / 2, PODY + 0.55, 1.2));
    }
  }
  // cornice, corbels and low parapet of the lantern floor
  B.add(lathe([[Tt - 0.01, TY - 0.2, 0.55], [Tt + 0.05, TY - 0.17, 0.95], [Tt + 0.07, TY - 0.14, 1.1], [Tt + 0.07, TY - 0.11, 1], [Tt + 0.02, TY - 0.09, 0.6]], 72).color(STONE_WARM).pbr(0.95).shade(stoneShade(STONE_WARM, 11, 0.2)).occ(null).wide());
  const nc2 = Math.round(22 * k);
  for (let i = 0; i < nc2; i++) {
    const a0 = ((i + 0.24) / nc2) * TAU, a1 = ((i + 0.76) / nc2) * TAU, c = [];
    for (let q = 0; q < 8; q++) { const a = q & 4 ? a1 : a0, top = q & 2, r = q & 1 ? (top ? Tt + 0.2 : Tt + 0.05) : Tt - 0.04; c.push(polar(a, r, top ? TY : TY - 0.13)); }
    const tone = vary(STONE_WARM, i + 800, 0.1);
    B.add(hexa(c, 0.01).color(tone).pbr(0.95).shade(stoneShade(tone, i)).occ(null));
  }
  const LPo = Tt + 0.2, LPi = Tt - 0.06, nlp = Math.round(24 * k);
  B.add(arcCourse(LPi, LPo, TY, TY + 0.17, 0, TAU, nlp, { seed: 91 }), arcCourse(LPi + 0.01, LPo - 0.01, TY + 0.17, TY + 0.32, TAU / nlp / 2, TAU + TAU / nlp / 2, nlp, { seed: 93 }));
  B.add(arcCourse(LPi - 0.025, LPo + 0.025, TY + 0.32, TY + 0.37, 0, TAU, Math.round(16 * k), { seed: 95, color: STONE_WARM, moss: 0.25, bevel: 0.016 }));
  B.add(masonry({ ...ringFloor(0.12, LPi + 0.03, TY), course: 0.3, len: 0.42, seed: 97, raise: 0.01, proud: 0.006, bevel: 0.016, color: 0xa29c8e, seg: 0.2 }));
  B.add(lathe([[0, TY - 0.004], [LPo - 0.02, TY - 0.004]], 40).color(MORTAR).ao(0).occ(null));
  // --- timber lantern: eight braced posts under a wall plate ---
  const np8 = 8, PR = (LPi + LPo) / 2, PY0 = TY + 0.37, PY1 = PY0 + 0.68, lite = { kh: 2, kd: 2 };
  for (let i = 0; i < np8; i++) {
    const a = ((i + 0.5) / np8) * TAU, p = polar(a, PR, 0), an = (((i + 1.5) / np8) * TAU), pn = polar(an, PR, 0);
    B.add(place(timber(beam(PY1 - PY0, 0.13, 0.13, { seed: 900 + i, n: 4, ...lite }), OAK_DK, 900 + i).rot(0, 0, 90), a, PR, (PY0 + PY1) / 2));
    B.add(strut([p[0], PY1 + 0.05, p[2]], [pn[0], PY1 + 0.05, pn[2]], 0.1, 0.13, { n: 5, ...lite }, OAK, 910 + i));
    for (const [q, t] of [[p, 0.3], [pn, 0.7]]) B.add(strut([q[0], PY1 - 0.28, q[2]], [lerp(p[0], pn[0], t), PY1 + 0.01, lerp(p[2], pn[2], t)], 0.06, 0.07, { n: 2, kh: 1, kd: 1 }, OAK, 920 + i + t * 10));
  }
  // --- roof: scale tiles on a steep cone, rafter feet, lead cap, staff and banner ---
  const RE = LPo + 0.28, EY = PY1 + 0.02, AY = EY + 1.62 * k + 0.1;
  B.add(tiledCone(RE, EY, AY, { tile: 0.21, show: 0.2, seed: 5, color: 0x9c452c }));
  B.add(lathe([[PR - 0.08, PY1 + 0.1, 0.5], [RE - 0.01, EY - 0.012, 0.75]], 48).color(OAK_DK).pbr(0.9).occ(null).ao(0));
  for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU, p0 = polar(a, PR - 0.02, PY1 + 0.12), p1 = polar(a, RE + 0.015, EY - 0.03); B.add(strut(p0, p1, 0.06, 0.05, { n: 1, kh: 1, kd: 1 }, OAK_DK, 940 + i).occ(null)); }
  B.add(lathe([[0.2, AY - 0.2, 0.6], [0.17, AY - 0.12, 1], [0.08, AY - 0.02, 1.1], [0.05, AY + 0.03, 0.8], [0.075, AY + 0.07, 1.15], [0.05, AY + 0.12, 0.9], [0, AY + 0.13, 1]], 16).color(0x6f7880).pbr(0.5, 0.6).shade(metalShade(0x6f7880, 3, 0x8a968c, 0.3)));
  B.add(timber(lathe([[0.03, AY + 0.1], [0.022, AY + 1.3], [0, AY + 1.3]], 8), OAK_DK, 950, 'y'));
  B.add(ball(0.045, 10).color(BRASS).pbr(0.3, 0.9).at(0, AY + 1.32, 0));
  B.add(banner(1.15, 0.42, 0xe9dfc3, 0x2a6a5a, 2).rot(0, -35, 0).at(0.022, AY + 1.03, 0));
  // --- stores on the walk between the podium and the parapet ---
  const walk = (2.5 * k + Pi) / 2, tp = (a, r) => [Math.cos(a) * r, WY + 0.014, Math.sin(a) * r];
  { const q = tp(2.9, walk + 0.03); B.add(shotPile(0.062, 3, 31, IRON_DK, 10).rot(0, 20, 0).at(q[0], q[1], q[2])); }
  { const q = tp(4.6, walk + 0.03); B.add(shotPile(0.062, 3, 33, IRON_DK, 10).rot(0, 50, 0).at(q[0], q[1], q[2])); }
  { const q = tp(0.1, walk + 0.03); B.add(shotPile(0.062, 2, 35, IRON_DK, 10).at(q[0], q[1], q[2])); }
  { const q = tp(aDock - 0.6, walk - 0.02); B.add(keg(0.13, 0.3, { seed: 41, col: OAK_DK, staves: 9 }).at(q[0], q[1], q[2])); const q2 = tp(aDock - 0.5, walk + 0.02); B.add(keg(0.12, 0.28, { seed: 42, staves: 9 }).at(q2[0], q2[1], q2[2])); const q3 = tp(aDock - 0.71, walk); B.add(keg(0.11, 0.26, { seed: 43, staves: 9 }).rot(90, 0, 0).rot(0, 40, 0).at(q3[0], q3[1] + 0.11, q3[2])); }
  for (const [aa, dr, dy, sz, ry] of [[3.8, 0, 0, 0.32, 10], [3.93, 0.02, 0, 0.28, -14], [3.86, 0.01, 0.3, 0.24, 28]]) {
    const q = tp(aa, walk + dr), cr = grp();
    for (let f = 0; f < 3; f++) cr.add(timber(beam(sz, sz, sz / 3 - 0.006, { seed: 50 + f + aa * 9, n: 2, kd: 1, kh: 3 }), f === 1 ? PINE : ELM, 50 + f + aa * 9).at(0, 0, (f - 1) * sz / 3));
    for (const s of [-1, 1]) for (const e of [-1, 1]) cr.add(timber(beam(sz + 0.02, 0.04, 0.02, { n: 1, kh: 1, kd: 1, seed: 55 }), OAK_DK, 55 + s).rot(0, 90, 0).at(s * (sz / 2 + 0.008), e * (sz / 2 - 0.03), 0), timber(beam(sz + 0.02, 0.04, 0.02, { n: 1, kh: 1, kd: 1, seed: 56 }), OAK_DK, 56 + s).rot(0, 90, 90).at(s * (sz / 2 + 0.008), 0, e * (sz / 2 - 0.03)));
    B.add(cr.rot(0, ry - aa / DEG, 0).at(q[0], q[1] + sz / 2 + dy, q[2]));
  }

  // --- the turret: a bronze chase gun on a pivot under the lantern roof ---
  const verd = lin(0x4f9a84), bz = lin(BRONZE);
  const bronze = (x, y, z) => { const n = fbm3(x * 9 + 3, y * 9, z * 9 - 3, 3), v = smooth(0.4, 0.66, n) * 0.6, kk = 0.86 + 0.28 * noise3(x * 30, y * 30, z * 30); return [lerp(bz[0] * kk, verd[0], v), lerp(bz[1] * kk, verd[1], v), lerp(bz[2] * kk, verd[2], v), lerp(0.36, 0.8, v), lerp(0.92, 0.25, v)]; };
  const G = grp();
  G.add(blackIron(lathe([[0, 0.012], [0.2, 0.012, 0.8], [0.2, 0.04], [0.09, 0.07], [0.07, 0.26], [0.1, 0.3], [0, 0.3]], 16)));
  for (const s of [-1, 1]) {
    G.add(timber(beam(0.98, 0.09, 0.07, { seed: 960 + s, n: 8 }), OAK_DK, 960 + s).at(-0.05, 0.33, s * 0.14));
    G.add(extrude([[-0.2, 0.37], [0.34, 0.37], [0.34, 0.5], [0.3, 0.55], ...arcPts(0.2, 0.565, 0.045, 0, -180, 6), [0.08, 0.55], [0.0, 0.5], [-0.1, 0.48], [-0.2, 0.42]], 0.05, 0.005).subdiv(0.06).color(OAK).pbr(0.86).shade(wood(vary(OAK, 964 + s, 0.08), 964 + s)).at(0, 0, s * 0.14));
    G.add(blackIron(extrude([...arcPts(0.2, 0.565, 0.058, 0, 180, 6), ...arcPts(0.2, 0.565, 0.046, 180, 0, 6)], 0.054, 0.003)).at(0, 0, s * 0.14));
  }
  for (const x of [-0.45, 0.0, 0.38]) G.add(timber(beam(0.24, 0.08, 0.07, { seed: 970 + x, n: 2 }), OAK_DK, 970 + x * 5).rot(0, 90, 0).at(x, 0.33, 0));
  G.add(gunTube({ len: 1.36, rb: 0.118, rm: 0.08, bore: 0.05, tr: 0.4, trunLen: 0.18, trunR: 0.042, col: BRONZE, finish: [0.36, 0.92], shade: bronze, dolphins: true, seg: 28 }).rot(0, 0, 3).at(0.2, 0.565, 0));
  T.add(G.scale(k).at(0, TY + 0.012, 0));
  return { base: B.build(), turret: T.build() };
}

export const siege = {
  cannon: () => gunModel('cannon', buildCannon),
  seaFort: (w = 3.6) => { const R = Math.round(w * 20) / 20; return gunModel(`seaFort:${R}`, () => buildSeaFort(R)); },
  battery: (w = 2, h = 2, def = null) => { const g = gunModel('battery', buildBattery, isFort(def) ? ['battery', 1] : null); g.scale.setScalar(Math.min(w, h) / 2); return g; },
  harpoon: (w = 1, h = 1, def = null) => gunModel('harpoon', buildHarpoon, isFort(def) ? ['gun', Math.round(Math.max(1, w) * 10) / 10] : null),
  mortar: (w = 1, h = 1, def = null) => gunModel('mortar', buildMortar, isFort(def) ? ['gun', Math.round(Math.max(1, w) * 10) / 10] : null),
  ballista: () => gunModel('ballista', buildBallista),
};
// ====================================================================================
// landing craft: a beamy clinker-built barge with a drop ramp in the bow
// ====================================================================================
function buildCraft(sideHex) {
  const H = new Asm({ ground: null }), Rm = new Asm({ ground: null });
  const side = lin(sideHex), sideDk = mulc(side, 0.6), cream = lin(0xe6dcc0);
  const RAKE = 20, tanR = Math.tan(RAKE * DEG), DECK = 0.14;
  // hull form: t runs stern (0) to bow (1), s from the chine (0) up to the sheer (1); z is the half-breadth
  const sheerB = (t) => lerp(0.5, 0.62, t) + 0.19 * Math.sin(Math.PI * t);
  const chineB = (t) => lerp(0.33, 0.5, t) + 0.13 * Math.sin(Math.PI * t);
  const botY = (t) => -0.2 + 0.11 * (1 - t) ** 3 + 0.16 * t ** 4;
  const sheerY = (t) => 0.5 + 0.07 * (2 * t - 1) ** 2;
  const hull = (t, s) => {
    const y = lerp(botY(t), sheerY(t), s), z = lerp(chineB(t), sheerB(t), s ** 0.75);
    const x = -1.1 + 2.2 * t + smooth(0.78, 1, t) * Math.max(0, y - 0.2) * tanR - (1 - smooth(0, 0.2, t)) * s * 0.05;
    return [x, y, z];
  };
  const hullN = (t, s) => { // outward normal on the +Z side
    const e = 0.004, a = hull(Math.min(1, t + e), s), b = hull(Math.max(0, t - e), s), c = hull(t, Math.min(1, s + e)), d = hull(t, Math.max(0, s - e));
    let n = v3norm(v3cross(v3sub(c, d), v3sub(a, b)));
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  };
  const off = (p, n, d) => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
  const TH = 0.024, NS = 5, NT = 22, lap = 0.035;
  const paintWear = (base, seed) => (x, y, z) => {
    const n = fbm3(x * 9 + seed, y * 30, z * 9, 3), chip = smooth(0.7, 0.76, n) * 0.85, k = 0.84 + 0.32 * noise3(x * 4 + seed, y * 4, z * 4);
    return [lerp(base[0] * k, 0.22, chip), lerp(base[1] * k, 0.15, chip), lerp(base[2] * k, 0.09, chip)];
  };
  for (const sg of [1, -1]) {
    // --- clinker strakes: each plank laps over the one below ---
    for (let k = 0; k < NS; k++) {
      const s0 = Math.max(0, k / NS - (k ? lap : 0)), s1 = (k + 1) / NS, sect = [];
      for (let i = 0; i <= NT; i++) {
        const t = i / NT, n0 = hullN(t, s0), n1 = hullN(t, s1), lo = hull(t, s0), hi = hull(t, s1);
        const q = [off(lo, n0, k ? TH : 0), off(hi, n1, 0), off(hi, n1, -TH), off(lo, n0, k ? 0 : -TH)];
        sect.push(q.map((p) => [p[0], p[1], p[2] * sg]));
      }
      const top = k === NS - 1, tone = top ? side : vary(k % 2 ? OAK : OAK_DK, 200 + k * 7 + sg, 0.1);
      const pc = loft(sect, { K: [[1.08, 0.66], [0.6, 0.6], [0.78, 0.95], [0.45, 0.45]] }).pbr(top ? 0.7 : 0.88);
      H.add(top ? pc.color(side).shade(paintWear(side, k + sg)) : pc.color(tone).shade(wood(tone, 200 + k * 3 + sg)));
    }
    // copper rivets through the laps at every frame
    for (let r = 0; r < 9; r++) for (let k = 1; k < NS; k++) {
      const t = 0.08 + r * 0.105, s0 = k / NS - lap * 0.5, p = hull(t, s0), n = hullN(t, s0), q = off(p, n, TH * 1.02);
      H.add(stud(0.011, 0.007, 5).color(0xb0683a).pbr(0.4, 0.85).xf(alongY([n[0], n[1], n[2] * sg])).at(q[0], q[1], q[2] * sg));
    }
    // rubbing strake under the sheer, cap rail on top (painted)
    {
      const wale = [], rail = [];
      for (let i = 0; i <= NT; i++) {
        const t = i / NT, s0 = 0.79, n = hullN(t, s0), a = hull(t, s0), b = hull(t, s0 + 0.045);
        wale.push([off(a, n, TH), off(a, n, TH + 0.022), off(b, n, TH + 0.022), off(b, n, 0)].map((p) => [p[0], p[1], p[2] * sg]));
        const h = hull(t, 1), nn = hullN(t, 1);
        rail.push([[h[0], h[1] - 0.004, h[2] - 0.045], [h[0] + nn[0] * 0.03, h[1] - 0.004, h[2] + 0.03], [h[0] + nn[0] * 0.03, h[1] + 0.032, h[2] + 0.03], [h[0], h[1] + 0.032, h[2] - 0.045]].map((p) => [p[0], p[1], p[2] * sg]));
      }
      H.add(loft(wale).color(OAK_DK).pbr(0.85).shade(wood(vary(OAK_DK, 230 + sg, 0.08), 230 + sg)));
      H.add(loft(rail).color(sideDk).pbr(0.7).shade(paintWear(sideDk, 9 + sg)));
    }
    // --- frames: ribs against the planking, one at each rivet line ---
    for (let r = 0; r < 9; r++) {
      const t = 0.08 + r * 0.105, sect = [];
      for (let j = 0; j <= 8; j++) {
        const s = j / 8, p = off(hull(t, s), hullN(t, s), -TH * 0.9), n = hullN(t, s), w = 0.022, dp = 0.05 - 0.018 * s;
        sect.push([[p[0] + w, p[1], p[2]], [p[0] - w, p[1], p[2]], [p[0] - w - n[0] * dp, p[1] - n[1] * dp, p[2] - n[2] * dp], [p[0] + w - n[0] * dp, p[1] - n[1] * dp, p[2] - n[2] * dp]].map((q) => [q[0], q[1], q[2] * sg]));
      }
      const tone = vary(ELM, 240 + r + sg * 3, 0.1);
      H.add(loft(sect).color(tone).pbr(0.88).shade(wood(tone, 240 + r, 'y')));
    }
    // bow post, raked with the ramp, iron-capped
    H.add(strut([1.075, -0.08, sg * 0.56], [1.075 + 0.84 * tanR, 0.76, sg * 0.56], 0.11, 0.11, { n: 5, kh: 2, kd: 2 }, OAK_DK, 250 + sg));
    H.add(blackIron(cbox(0.12, 0.035, 0.125, 0.004)).rot(0, 0, 90 - RAKE).at(1.075 + 0.82 * tanR, 0.742, sg * 0.56));
    H.add(blackIron(ring(0.028, 0.007, 12, 5)).rot(0, 0, 90).rot(0, 0, -RAKE).at(1.075 + 0.66 * tanR - 0.06, 0.58, sg * 0.5));
    // thole pins and shipped oars along the side
    for (const t of [0.3, 0.56]) { const h = hull(t, 1); for (const dx of [-0.035, 0.035]) H.add(timber(cyl(0.011, 0.075, 6, 0.003), ELM, 260, 'y').at(h[0] + dx, h[1] + 0.06, sg * (h[2] - 0.008))); }
    for (let q = 0; q < 2; q++) {
      const oar = grp(timber(lathe([[0, -0.6], [0.013, -0.6, 0.8], [0.018, -0.45], [0.016, 0.1], [0.012, 0.36], [0, 0.36]], 8), PINE, 262 + q, 'y').rot(0, 0, -90));
      oar.add(timber(beam(0.4, 0.012, 0.085, { n: 5, taper: [1, 0.55], seed: 264 + q }), PINE, 264 + q).at(0.52, 0, 0));
      H.add(oar.rot(20 + q * 50, 0, 0).rot(0, sg * (2.2 - q * 1.2), 1.4).at(-0.12 + q * 0.03, 0.385 + q * 0.03, sg * (0.6 - q * 0.045)));
    }
    // round shields slung outboard in the side's colour
    for (const t of [0.27, 0.43, 0.59]) {
      const p = hull(t, 0.72), n = hullN(t, 0.72), nn = [n[0], n[1], n[2] * sg], sh = grp();
      for (let q = 0; q < 4; q++) { const c = q % 2 ? cream : side; sh.add(lathe([[0, 0.014], [0.07, 0.011, 1.05], [0.118, 0.005, 0.92], [0.13, 0, 0.75]], 5, { arc: Math.PI / 2, a0: q * Math.PI / 2 + 0.6 }).color(c).pbr(0.62).shade((x, y, z) => mulc(c, 0.84 + 0.3 * noise3(x * 30 + t * 9, 3, z * 30))).occ(null)); }
      sh.add(lathe([[0.118, 0.004, 0.7], [0.122, 0.014, 1.15], [0.134, 0.012, 1.15], [0.138, 0, 0.7], [0.118, -0.006, 0.6], [0, -0.006, 0.6]], 20).color(IRON).pbr(0.5, 0.8).occ(null));
      sh.add(lathe([[0.042, 0.008, 0.7], [0.037, 0.024, 1], [0.019, 0.038, 1.15], [0, 0.042, 1.2]], 10).color(BRASS).pbr(0.35, 0.9).occ(null));
      for (let q = 0; q < 6; q++) sh.add(stud(0.008, 0.005, 5).color(IRON_DK).pbr(0.5, 0.7).at(Math.cos(q * 1.047) * 0.128, 0.012, Math.sin(q * 1.047) * 0.128));
      const m = alongY(nn), q2 = off(p, n, TH + 0.03);
      for (const pc of sh.list) pc.xf(m).at(q2[0], q2[1], q2[2] * sg);
      H.add(sh);
    }
  }
  // --- bottom, keel, floors, transom and bow sill ---
  {
    const bot = [], keel = [];
    for (let i = 0; i <= NT; i++) { const t = i / NT, x = -1.1 + 2.2 * t, c = chineB(t) + 0.01, y = botY(t); bot.push([[x, y + 0.012, c], [x, y + 0.012, -c], [x, y - 0.03, -c], [x, y - 0.03, c]]); keel.push([[x, y - 0.03, 0.035], [x, y - 0.03, -0.035], [x, y - 0.085, -0.025], [x, y - 0.085, 0.025]]); }
    H.add(loft(bot).color(TAR).pbr(0.8).shade(wood(TAR, 270)), loft(keel).color(OAK_DK).pbr(0.85).shade(wood(OAK_DK, 271)));
    for (let r = 0; r < 9; r++) { const t = 0.08 + r * 0.105, x = -1.1 + 2.2 * t; H.add(timber(beam(chineB(t) * 2 - 0.02, DECK - 0.036 - botY(t) - 0.012, 0.05, { n: 2, kh: 1, kd: 1, seed: 272 + r }), ELM, 272 + r).rot(0, 90, 0).at(x, (DECK - 0.036 + botY(t) + 0.012) / 2, 0)); }
    // transom: three planks, the top one painted, knees inside
    const tr = (y0, y1, x0, x1, col, sd, painted) => {
      const zs = (y) => { const sv = clamp01((y - botY(0)) / (sheerY(0) - botY(0))); return lerp(chineB(0), sheerB(0), sv ** 0.75) + 0.012; };
      const xs = (y) => -1.1 - clamp01((y - botY(0)) / (sheerY(0) - botY(0))) * 0.05, c = [];
      for (let q = 0; q < 8; q++) { const y = q & 2 ? y1 : y0, z = (q & 4 ? 1 : -1) * zs(y); c.push([xs(y) + (q & 1 ? x1 : x0), y, z]); }
      const h = hexa(c, 0.006).subdiv(0.07).pbr(painted ? 0.7 : 0.88);
      return painted ? h.color(side).shade(paintWear(side, sd)) : h.color(col).shade(wood(vary(col, sd, 0.08), sd, 'z'));
    };
    const y0 = botY(0) - 0.03, y3 = sheerY(0) + 0.03, dy = (y3 - y0) / 3;
    H.add(tr(y0, y0 + dy - 0.004, -0.03, 0.02, OAK_DK, 280), tr(y0 + dy, y0 + 2 * dy - 0.004, -0.032, 0.02, OAK, 281), tr(y0 + 2 * dy, y3, -0.034, 0.02, OAK, 282, true));
    H.add(timber(beam(0.82, 0.07, 0.05, { n: 6, seed: 283 }), OAK_DK, 283).rot(0, 0, 86).at(-1.16, 0.2, 0));
    // bow sill under the ramp hinge
    { const c = []; for (let q = 0; q < 8; q++) { const y = q & 2 ? 0.2 : botY(1) - 0.03, z = (q & 4 ? 1 : -1) * 0.52; c.push([1.1 + (q & 1 ? 0.035 : -0.035), y, z]); } H.add(timber(hexa(c, 0.008).subdiv(0.08), OAK_DK, 285, 'z')); }
    H.add(blackIron(cbox(0.02, 0.012, 1.02, 0.003)).at(1.135, 0.188, 0));
  }
  // --- bottom boards: the deck the soldiers stand on ---
  const sDeck = (t) => clamp01((DECK - botY(t)) / (sheerY(t) - botY(t)));
  const inner = (t) => lerp(chineB(t), sheerB(t), sDeck(t) ** 0.75) - TH - 0.05;
  for (let i = 0; i < 9; i++) {
    const z = (i - 4) * 0.148, zo = Math.abs(z) + 0.07;
    let t0 = 0.12, t1 = 0.985;
    while (t0 < 0.5 && inner(t0) < zo) t0 += 0.01;
    while (t1 > 0.5 && inner(t1) < zo) t1 -= 0.01;
    if (t1 - t0 < 0.1) continue;
    const xa = -1.1 + 2.2 * t0 + (hash1(i + 290) * 0.03), xb = -1.1 + 2.2 * t1;
    H.add(timber(beam(xb - xa, 0.03, 0.14, { n: 9, kd: 3, kh: 1, seed: 290 + i, rough: 0.003 }), i % 2 ? PINE : ELM, 290 + i).at((xa + xb) / 2, DECK - 0.015, z));
    for (const x of [xa + 0.05, -0.3, 0.25, xb - 0.05]) if (x > xa + 0.02 && x < xb - 0.02) H.add(blackIron(stud(0.007, 0.003, 5)).at(x, DECK, z - 0.04), blackIron(stud(0.007, 0.003, 5)).at(x, DECK, z + 0.04));
  }
  // --- thwarts with knees, clear of where the soldiers stand ---
  for (const x of [-0.33, 0.22]) {
    const t = (x + 1.1) / 2.2, s = 0.66, w = lerp(chineB(t), sheerB(t), s ** 0.75) - TH - 0.01, y = lerp(botY(t), sheerY(t), s);
    H.add(timber(beam(w * 2, 0.03, 0.13, { n: 8, kh: 1, kd: 3, seed: 300 + x * 9, bow: -0.006 }), OAK, 300 + x * 9).rot(0, 90, 0).at(x, y, 0));
    for (const sg of [-1, 1]) {
      H.add(timber(extrude([[0, 0], [0.13, 0], [0.13, 0.02], [0.03, 0.1], [0, 0.1]], 0.03, 0.004), ELM, 302).rot(0, sg > 0 ? 90 : -90, 0).at(x, y + 0.015, sg * (w - 0.005)));
      H.add(timber(beam(0.2, 0.035, 0.035, { n: 2, seed: 304 }), OAK_DK, 304).rot(0, 0, 90).at(x, y - 0.115, sg * (w - 0.22)));
    }
  }
  // --- stern sheets, steering sweep in its crutch, stern lantern ---
  for (let i = 0; i < 2; i++) H.add(timber(beam(0.92 - i * 0.1, 0.028, 0.115, { n: 6, seed: 310 + i }), ELM, 310 + i).rot(0, 90, 0).at(-0.88 - i * 0.12, 0.36, 0));
  H.add(timber(beam(0.84, 0.05, 0.04, { n: 5, seed: 312 }), OAK_DK, 312).rot(0, 90, 0).at(-0.82, 0.33, 0));
  H.add(blackIron(cyl(0.012, 0.1, 6)).at(-1.165, 0.62, 0.2));
  for (const dz of [-0.03, 0.03]) H.add(blackIron(tube([[-1.165, 0.66, 0.2], [-1.165, 0.685, 0.2 + dz], [-1.165, 0.74, 0.2 + dz * 1.2]], 0.007, 5, { smooth: 3 })));
  {
    const sw = grp(timber(lathe([[0, -0.9], [0.014, -0.9, 0.8], [0.02, -0.6], [0.02, 0.2], [0.015, 0.6], [0.019, 0.68, 1.1], [0, 0.7]], 8), PINE, 314, 'y'));
    sw.add(timber(beam(0.5, 0.014, 0.12, { n: 6, taper: [1, 0.6], seed: 315 }), PINE, 315).rot(0, 0, 90).at(0, -1.08, 0));
    H.add(sw.rot(0, 0, 58).rot(0, 6, 0).at(-1.165, 0.7, 0.2));
  }
  H.add(timber(beam(0.5, 0.035, 0.035, { n: 4, seed: 316 }), OAK_DK, 316).rot(0, 0, 90).at(-1.14, 0.78, -0.3));
  H.add(blackIron(tube([[-1.14, 1.02, -0.3], [-1.14, 1.06, -0.3], [-1.2, 1.07, -0.3], [-1.24, 1.03, -0.3]], 0.006, 5, { smooth: 3 })));
  H.add(blackIron(lathe([[0, 0.085], [0.012, 0.08], [0.045, 0.055, 1.1], [0.04, 0.048, 0.7]], 8)).at(-1.24, 0.94, -0.3), blackIron(lathe([[0, 0], [0.036, 0, 0.8], [0.04, 0.012], [0, 0.012]], 8)).at(-1.24, 0.9, -0.3));
  H.add(cyl(0.028, 0.08, 8, 0.002).color(0xffc060).glow(1.5).pbr(0.4).at(-1.24, 0.955, -0.3).ao(0));
  for (let q = 0; q < 4; q++) H.add(blackIron(cyl(0.0035, 0.09, 4)).at(-1.24 + Math.cos(q * 1.571 + 0.78) * 0.033, 0.955, -0.3 + Math.sin(q * 1.571 + 0.78) * 0.033));
  // --- in the bows: a coil of line, a grapnel ---
  { const pts = []; for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU * 4.3, rr = 0.15 - (i / 64) * 0.09; pts.push([0.86 + Math.cos(a) * rr, DECK + 0.014 + (i / 64) * 0.022, 0.3 + Math.sin(a) * rr]); } H.add(rope(pts, 0.012, { smooth: 0, radial: 6 }).color(HEMP)); }
  {
    const gp = grp(iron(cyl(0.012, 0.3, 8), 3).rot(0, 0, 90), blackIron(ring(0.022, 0.006, 12, 5)).rot(90, 0, 0).at(-0.165, 0, 0));
    for (let q = 0; q < 4; q++) gp.add(iron(tube([[0.14, 0, 0], [0.17, 0.03, 0], [0.16, 0.085, 0], [0.11, 0.11, 0]], [0.011, 0.011, 0.009, 0.004], 6, { smooth: 4 }), q).rot(q * 90 + 45, 0, 0));
    H.add(gp.rot(0, -35, 0).at(0.88, DECK + 0.085, -0.3));
  }

  // --- the ramp (in its own space: hinge along Z through the origin, raised and raked forward) ---
  const RP = grp(), RH = 0.63, RW = 1.0;
  for (let i = 0; i < 6; i++) RP.add(timber(beam(RH, 0.045, RW / 6 - 0.006, { n: 5, kh: 1, kd: 3, seed: 330 + i, rough: 0.003 }), i % 2 ? OAK : OAK_DK, 330 + i).rot(0, 0, 90).at(-0.0225, RH / 2 + 0.01, (i - 2.5) * (RW / 6)));
  for (const y of [0.13, 0.47]) {
    RP.add(timber(beam(RW + 0.02, 0.075, 0.03, { n: 8, seed: 340 + y * 9 }), OAK_DK, 340 + y * 9).rot(0, 90, 0).at(0.015, y, 0));
    for (let i = 0; i < 6; i++) RP.add(blackIron(stud(0.012, 0.008)).rot(0, 0, -90).at(0.03, y, (i - 2.5) * (RW / 6)));
  }
  RP.add(strut([0.016, 0.17, -0.44], [0.016, 0.43, 0.44], 0.06, 0.028, { n: 8 }, OAK_DK, 344));
  RP.add(beam(RW + 0.03, 0.055, 0.075, { n: 8, seed: 346 }).color(side).pbr(0.7).shade(paintWear(side, 4)).rot(0, 90, 0).at(-0.022, RH + 0.03, 0));
  for (let i = 0; i < 5; i++) RP.add(timber(beam(RW - 0.08, 0.02, 0.02, { n: 5, seed: 350 + i, kh: 1, kd: 1 }), ELM, 350 + i).rot(0, 90, 0).at(-0.055, 0.09 + i * 0.115, 0));
  for (const z of [-0.36, 0, 0.36]) {
    RP.add(iron(cyl(0.024, 0.14, 10), z * 9).rot(90, 0, 0).at(-0.012, 0.004, z));
    RP.add(blackIron(cbox(0.008, 0.26, 0.045, 0.002)).at(0.034, 0.15, z), blackIron(stud(0.01, 0.006)).rot(0, 0, -90).at(0.038, 0.06, z), blackIron(stud(0.01, 0.006)).rot(0, 0, -90).at(0.038, 0.24, z));
  }
  for (const z of [-0.43, 0.43]) RP.add(blackIron(ring(0.028, 0.007, 14, 6)).rot(0, 0, 90).at(-0.06, RH - 0.06, z), blackIron(cyl(0.008, 0.03, 6)).rot(0, 0, 90).at(-0.05, RH - 0.035, z));
  Rm.add(RP.rot(0, 0, -RAKE));
  return { hull: H.build(), ramp: Rm.build() };
}

/** craft(sideColorHex) -> landing craft with userData.ramp: a Group hinged at the bow, rotated about Z by the game (0 raised, -1.4 dropped) */
export function craft(sideColorHex = 0x3d7bd9) {
  const { hull, ramp } = cached(`craft:${sideColorHex}`, () => buildCraft(sideColorHex));
  const g = new THREE.Group(), r = new THREE.Group();
  g.add(meshOf(hull));
  r.position.set(1.1, 0.2, 0);
  r.add(meshOf(ramp));
  g.add(r);
  g.userData.ramp = r;
  return g;
}
