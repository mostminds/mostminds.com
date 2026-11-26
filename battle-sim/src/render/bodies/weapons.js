// Hand-held weapons and shields, modelled as hard-surface geometry.
//
// Frame: the grip is at the origin; the business end (blade tip, spear head,
// staff top, upper bow limb) points along +Y; the cutting edge / front faces +Z.
// A shield's outer face points +Z, its top is +Y, and its centre is the origin.
// Two kinds bend the rule so the generic holds work: the crossbow follows the bow
// (bolt flies along +Z, top +Y, prod across X, a turned grip through the fist) and
// claws sit on an open hand (fingers along +Y, back of the hand +Z).
//
// Every model is assembled from small closed meshes ("prims") built by the mesh
// kit below: lofts, lathes, tubes and bevelled plates with creased normals and
// per-facet colour. Prims are merged into one hard piece per surface finish and
// detail flag, so a weapon costs a handful of pieces however ornate it is:
//   .lod(0)      rivets, studs, inlay
//   .lod(1)      dense shells: wood grain, wear, wraps, pierced and bevelled plates
//   core         the lean silhouette the shells hide, a few hundred triangles: kept on every level but
//                the last one of the current detail preset (and its merged far mesh)
//   un-flagged   a far twin of the core (four-sided poles, diamond blades, flat plates), tucked
//                inside it, which is all that is left on those farthest levels
import * as THREE from 'three';
import { H, rgb, noise3, fbm3 } from '../sculpt.js';
import { DETAIL, getDetail } from '../rigkit.js';

const DEG = Math.PI / 180;
const lin = (c) => (Array.isArray(c) ? c : rgb(c));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const WHITE = [1, 1, 1];
let FAR = false; // true while a far-level twin is being built: every shape below then takes its leanest form

/** samples to keep so that straight spans between them stay within tol of the rest (ends always kept) */
function keepers(n, par, dev, tol, maxN = 1e9) {
  const keep = [0, n - 1];
  for (;;) {
    let worst = -1, wd = tol;
    for (let k = 0; k < keep.length - 1; k++) {
      const a = keep[k], b = keep[k + 1], span = par[b] - par[a] || 1;
      for (let i = a + 1; i < b; i++) { const d = dev(i, a, b, (par[i] - par[a]) / span); if (d > wd) { wd = d; worst = i; } }
    }
    if (worst < 0 || keep.length >= maxN) break;
    keep.push(worst); keep.sort((p, q) => p - q);
  }
  return keep;
}
/** deviation of point i from the span a-b, for lists of equal-length number tuples */
const devOf = (P) => (i, a, b, t) => { let d = 0; for (let c = 0; c < P[i].length; c++) d = Math.max(d, Math.abs(P[i][c] - lerp(P[a][c], P[b][c], t))); return d; };
const cumLen = (P, dims = 3) => { const out = [0]; for (let i = 1; i < P.length; i++) { let d = 0; for (let c = 0; c < dims; c++) d += (P[i][c] - P[i - 1][c]) ** 2; out.push(out[i - 1] + Math.sqrt(d)); } return out; };

// ---------------------------------------------------------------- mesh kit
/** Mesh builder: positions, triangles and a tag per triangle (the tag picks the facet colour). */
class MB {
  constructor() { this.p = []; this.t = []; this.g = []; }
  v(x, y, z) { this.p.push(x, y, z); return this.p.length / 3 - 1; }
  tri(a, b, c, tag = 0) { this.t.push(a, b, c); this.g.push(tag); }
  quad(a, b, c, d, tag = 0) { this.t.push(a, b, c, a, c, d); this.g.push(tag, tag); }
  ring(pts) { const out = new Array(pts.length); for (let i = 0; i < pts.length; i++) out[i] = this.v(pts[i][0], pts[i][1], pts[i][2]); return out; }
  /** quads between two index rings; tag may be a number, an array per column or fn(column) */
  bridge(A, B, tag = 0, closed = true) {
    const n = A.length, m = closed ? n : n - 1;
    for (let j = 0; j < m; j++) {
      const k = (j + 1) % n;
      this.quad(A[j], A[k], B[k], B[j], typeof tag === 'function' ? tag(j) : Array.isArray(tag) ? tag[j] : tag);
    }
  }
  /** close a ring with a fan about its centroid */
  cap(R, tag = 0, flip = false) {
    let x = 0, y = 0, z = 0;
    for (const i of R) { x += this.p[i * 3]; y += this.p[i * 3 + 1]; z += this.p[i * 3 + 2]; }
    const c = this.v(x / R.length, y / R.length, z / R.length);
    for (let j = 0; j < R.length; j++) { const k = (j + 1) % R.length; if (flip) this.tri(c, R[k], R[j], tag); else this.tri(c, R[j], R[k], tag); }
  }
  /** move every vertex: fn(x, y, z) -> [x, y, z] */
  warp(fn) { const p = this.p; for (let i = 0; i < p.length; i += 3) { const r = fn(p[i], p[i + 1], p[i + 2]); p[i] = r[0]; p[i + 1] = r[1]; p[i + 2] = r[2]; } return this; }
  /** split every edge longer than maxLen at its midpoint (no T-junctions: the rule only looks at edge length) */
  sub(maxLen) {
    const p = this.p, mid = new Map(), m2 = maxLen * maxLen;
    const d2 = (a, b) => { const x = p[a * 3] - p[b * 3], y = p[a * 3 + 1] - p[b * 3 + 1], z = p[a * 3 + 2] - p[b * 3 + 2]; return x * x + y * y + z * z; };
    const midOf = (a, b) => {
      const k = a < b ? a * 1e6 + b : b * 1e6 + a;
      let m = mid.get(k);
      if (m === undefined) { m = this.v((p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, (p[a * 3 + 2] + p[b * 3 + 2]) / 2); mid.set(k, m); }
      return m;
    };
    let t = this.t, g = this.g;
    for (let pass = 0; pass < 12; pass++) {
      const nt = [], ng = [];
      let any = false;
      for (let f = 0; f < t.length; f += 3) {
        const a = t[f], b = t[f + 1], c = t[f + 2], tag = g[f / 3];
        const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), mx = Math.max(ab, bc, ca);
        if (mx <= m2) { nt.push(a, b, c); ng.push(tag); continue; }
        any = true;
        if (mx === ab) { const m = midOf(a, b); nt.push(a, m, c, m, b, c); } else if (mx === bc) { const m = midOf(b, c); nt.push(a, b, m, a, m, c); } else { const m = midOf(c, a); nt.push(a, b, m, m, b, c); }
        ng.push(tag, tag);
      }
      t = nt; g = ng;
      if (!any) break;
    }
    this.t = t; this.g = g;
    return this;
  }
  /** append a three.js geometry (optionally transformed) */
  geo(geom, m = null, tag = 0) {
    const g = m ? geom.clone().applyMatrix4(m) : geom, pos = g.attributes.position, base = this.p.length / 3;
    for (let i = 0; i < pos.count; i++) this.p.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) this.tri(base + ix[i], base + ix[i + 1], base + ix[i + 2], tag); } else for (let i = 0; i < pos.count; i += 3) this.tri(base + i, base + i + 1, base + i + 2, tag);
    return this;
  }
}

/**
 * Finish a builder into a prim { P, N, C, I }: weld, orient outward, crease the normals and
 * colour every corner. o: crease (degrees), shade (colour | fn(x,y,z,nx,ny,nz,tag) -> colour),
 * open (true for sheets: skip the outward fix), deflate (shrink along the normal, for a core
 * that hides inside a detailed shell), farDeflate (the extra shrink a far twin gets, default 1.2 mm).
 */
function fin(mb, o = {}) {
  if (typeof o !== 'object' || Array.isArray(o)) o = { shade: o };
  const cosC = Math.cos((o.crease ?? 46) * DEG);
  const p = mb.p, t = mb.t, g = mb.g, nv = p.length / 3;
  const pid = new Int32Array(nv), wm = new Map();
  let np = 0;
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(p[i * 3] * 1e5)},${Math.round(p[i * 3 + 1] * 1e5)},${Math.round(p[i * 3 + 2] * 1e5)}`;
    let id = wm.get(k);
    if (id === undefined) { id = np++; wm.set(k, id); }
    pid[i] = id;
  }
  const fa = [], fb = [], fc = [], ft = [], fx = [], fy = [], fz = [], ux = [], uy = [], uz = [];
  let vol = 0;
  for (let f = 0; f < t.length; f += 3) {
    const a = t[f], b = t[f + 1], c = t[f + 2];
    if (pid[a] === pid[b] || pid[b] === pid[c] || pid[a] === pid[c]) continue;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az, e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, l = Math.hypot(nx, ny, nz);
    if (l < 1e-13) continue;
    vol += ax * nx + ay * ny + az * nz;
    fa.push(a); fb.push(b); fc.push(c); ft.push(g[f / 3]); fx.push(nx); fy.push(ny); fz.push(nz); ux.push(nx / l); uy.push(ny / l); uz.push(nz / l);
  }
  const nf = fa.length;
  if (!o.open && vol < 0) for (let f = 0; f < nf; f++) { const s = fb[f]; fb[f] = fc[f]; fc[f] = s; fx[f] = -fx[f]; fy[f] = -fy[f]; fz[f] = -fz[f]; ux[f] = -ux[f]; uy[f] = -uy[f]; uz[f] = -uz[f]; }
  const adj = Array.from({ length: np }, () => []);
  for (let f = 0; f < nf; f++) { adj[pid[fa[f]]].push(f); adj[pid[fb[f]]].push(f); adj[pid[fc[f]]].push(f); }
  const P = [], N = [], C = [], I = [], own = [], seen = new Map();
  const sh = o.shade, isFn = typeof sh === 'function', flat = isFn ? null : lin(sh ?? 0x999999);
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? fa[f] : k === 1 ? fb[f] : fc[f], id = pid[v];
      let nx = 0, ny = 0, nz = 0;
      for (const h of adj[id]) if (ux[f] * ux[h] + uy[f] * uy[h] + uz[f] * uz[h] >= cosC) { nx += fx[h]; ny += fy[h]; nz += fz[h]; }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const key = `${id},${ft[f]},${Math.round(nx * 300)},${Math.round(ny * 300)},${Math.round(nz * 300)}`;
      let j = seen.get(key);
      if (j === undefined) {
        j = P.length / 3; seen.set(key, j);
        const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
        P.push(x, y, z); N.push(nx, ny, nz); own.push(id);
        const c = isFn ? lin(sh(x, y, z, nx, ny, nz, ft[f]) ?? 0x999999) : flat;
        C.push(c[0], c[1], c[2]);
      }
      I.push(j);
    }
  }
  const deflate = (o.deflate ?? 0) + (FAR ? o.farDeflate ?? 0.0012 : 0);
  if (deflate) {
    const sx = new Float32Array(np), sy = new Float32Array(np), sz = new Float32Array(np);
    for (let id = 0; id < np; id++) { let x = 0, y = 0, z = 0; for (const h of adj[id]) { x += ux[h]; y += uy[h]; z += uz[h]; } const l = Math.hypot(x, y, z) || 1; sx[id] = x / l; sy[id] = y / l; sz[id] = z / l; }
    for (let j = 0; j < own.length; j++) { P[j * 3] -= sx[own[j]] * deflate; P[j * 3 + 1] -= sy[own[j]] * deflate; P[j * 3 + 2] -= sz[own[j]] * deflate; }
  }
  return { P, N, C, I };
}

/** rotate (degrees, XYZ order) about the prim's own origin, then scale, then move */
function X(rx = 0, ry = 0, rz = 0, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG, 'XYZ')), new THREE.Vector3(1, 1, 1))
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sz));
}
const AT = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1), MIRROR_Z = new THREE.Matrix4().makeScale(1, 1, -1);
const _n3 = new THREE.Matrix3();

// surface finishes: [roughness, metalness, glow]
const FINISH = {
  metal: [0.3, 1, 0], iron: [0.55, 0.9, 0], wood: [0.75, 0, 0], leather: [0.6, 0, 0], cloth: [0.85, 0, 0],
  bone: [0.45, 0, 0], stone: [0.9, 0, 0], paint: [0.55, 0, 0], cord: [0.8, 0, 0], gem: [0.12, 0, 0.6], glass: [0.1, 0, 0.55],
};

/** a weapon under construction: prims grouped by finish and detail flag */
class Model {
  constructor() { this.layers = new Map(); }
  /**
   * Add a prim. Pass a function returning the prim for anything un-flagged: it is built twice, once as the
   * lean core (layer 2: every level but the farthest) and once as a far twin (FAR set, every shape at its
   * leanest) that is all the farthest level keeps. Layers 0 and 1 are the usual .lod() flags.
   */
  add(finish, prim, m = null, lod = 99) {
    if (typeof prim !== 'function') return this.put(finish, prim, m, lod);
    if (lod < 99) return this.put(finish, prim(), m, lod);
    this.put(finish, prim(), m, 2);
    FAR = true;
    try { this.put(finish, prim(), m, 99); } finally { FAR = false; }
    return this;
  }
  put(finish, prim, m, lod) {
    if (!prim) return this;
    const key = `${finish}:${lod}`;
    let L = this.layers.get(key);
    if (!L) this.layers.set(key, L = { finish, lod, P: [], N: [], C: [], I: [] });
    const off = L.P.length / 3, { P, N, C, I } = prim;
    if (!m) { for (let i = 0; i < P.length; i++) { L.P.push(P[i]); L.N.push(N[i]); } } else {
      const e = m.elements, q = _n3.getNormalMatrix(m).elements;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2], a = N[i], b = N[i + 1], c = N[i + 2];
        L.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        const nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c, l = Math.hypot(nx, ny, nz) || 1;
        L.N.push(nx / l, ny / l, nz / l);
      }
    }
    for (let i = 0; i < C.length; i++) L.C.push(C[i]);
    if (m && m.determinant() < 0) for (let i = 0; i < I.length; i += 3) L.I.push(off + I[i], off + I[i + 2], off + I[i + 1]);
    else for (let i = 0; i < I.length; i++) L.I.push(off + I[i]);
    return this;
  }
  /** the same prim on both sides of the X = 0 plane (or Z = 0 with axis 'z') */
  both(finish, prim, m = null, lod = 99, axis = 'x') {
    this.add(finish, prim, m, lod);
    const mm = (axis === 'z' ? MIRROR_Z : MIRROR_X).clone();
    return this.add(finish, prim, m ? mm.multiply(m) : mm, lod);
  }
  parts() {
    const out = [];
    for (const L of this.layers.values()) {
      if (!L.I.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(L.P), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(L.N), 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(L.I), 1));
      out.push({ geo, col: new Float32Array(L.C), fin: FINISH[L.finish], lod: L.lod });
    }
    return out;
  }
}

/** one hard piece from a finished layer; the baked colours are handed back through .shade() */
function toHard(part, scale) {
  const P = part.geo.attributes.position.array, C = part.col, n = P.length / 3;
  let i = 0, slow = null;
  const h = H.geo(part.geo).pbr(part.fin[0], part.fin[1]).shade((x, y, z, nx, ny, nz) => {
    let j = i; i = (i + 1) % n;
    if (P[j * 3] !== x || P[j * 3 + 1] !== y || P[j * 3 + 2] !== z) {
      // not walking the vertices in order: look the vertex up instead
      if (!slow) { slow = new Map(); const Nn = part.geo.attributes.normal.array; for (let k = 0; k < n; k++) slow.set(`${P[k * 3]},${P[k * 3 + 1]},${P[k * 3 + 2]},${Nn[k * 3]},${Nn[k * 3 + 1]},${Nn[k * 3 + 2]}`, k); }
      j = slow.get(`${x},${y},${z},${nx},${ny},${nz}`) ?? j;
    }
    return [C[j * 3], C[j * 3 + 1], C[j * 3 + 2]];
  });
  if (part.fin[2]) h.glow(part.fin[2]);
  // layer 2 is the core: everything but the last sculpt level, however many levels this detail preset has
  if (part.lod < 99) h.lod(part.lod === 2 ? Math.max(1, (DETAIL[getDetail()] || DETAIL.high).length - 2) : part.lod);
  if (scale && scale !== 1) h.scale(scale);
  return h;
}

// ---------------------------------------------------------------- shapes
/** surface of revolution about Y from [[radius, y], ...]; o.tags(segment) picks the tag per profile segment; o.asIs keeps a far twin exactly as given */
function lathe(profile, seg = 16, o = {}) {
  if (FAR && !o.asIs) {
    const keep = keepers(profile.length, cumLen(profile, 2), devOf(profile), 0.0016), tags = o.tags;
    profile = keep.map((i) => profile[i]);
    if (tags) o = { ...o, tags: (k) => tags(Math.floor((keep[k] + keep[k + 1]) / 2)) };
    seg = seg >= 14 ? 6 : seg >= 8 ? 5 : Math.min(seg, 4);
  }
  const mb = new MB(), rings = [];
  for (const [r, y] of profile) {
    if (r < 1e-6) { rings.push([mb.v(0, y, 0)]); continue; }
    const R = [];
    for (let j = 0; j < seg; j++) { const a = (j / seg) * Math.PI * 2; R.push(mb.v(Math.cos(a) * r, y, Math.sin(a) * r)); }
    rings.push(R);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1], tag = o.tags ? o.tags(i) : 0;
    if (A.length === 1 && B.length === 1) continue;
    if (A.length === 1) for (let j = 0; j < seg; j++) mb.tri(A[0], B[(j + 1) % seg], B[j], tag);
    else if (B.length === 1) for (let j = 0; j < seg; j++) mb.tri(A[j], A[(j + 1) % seg], B[0], tag);
    else mb.bridge(A, B, tag);
  }
  if (rings[0].length > 1 && o.cap !== false) mb.cap(rings[0], o.capTag ?? 0, true);
  if (rings[rings.length - 1].length > 1 && o.cap !== false) mb.cap(rings[rings.length - 1], o.capTag ?? 0);
  return mb;
}
/** skin a list of point rings (same count each) into a closed solid; o.tags(column, span) */
function loft(rings, o = {}) {
  if (FAR) {
    const n0 = rings[0].length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    if (n0 === 16) rings = rings.map((r) => [r[0], r[4], r[8], r[12]]);
    else if (n0 === 8) rings = rings.map((r) => [mid(r[0], r[1]), mid(r[2], r[3]), mid(r[4], r[5]), mid(r[6], r[7])]);
    const flat = rings.map((r) => r.flat()), cen = rings.map((r) => { const c = [0, 0, 0]; for (const q of r) { c[0] += q[0] / r.length; c[1] += q[1] / r.length; c[2] += q[2] / r.length; } return c; });
    const keep = keepers(rings.length, cumLen(cen), devOf(flat), 0.002), tags = o.tags;
    rings = keep.map((i) => rings[i]);
    o = { ...o, tags: tags && rings[0].length === n0 ? (j, k) => tags(j, keep[k]) : null };
  }
  const mb = new MB(), R = rings.map((r) => mb.ring(r));
  for (let i = 0; i < R.length - 1; i++) mb.bridge(R[i], R[i + 1], o.tags ? (j) => o.tags(j, i) : 0);
  if (o.cap0 !== false) mb.cap(R[0], o.capTag ?? 0, true);
  if (o.cap1 !== false) mb.cap(R[R.length - 1], o.capTag ?? 0);
  return mb;
}
/** an eight-sided bar section in the plane z = const: half sizes hx, hy, chamfer ch */
function oct(cx, cy, z, hx, hy, ch) {
  const c = Math.min(ch, hx * 0.7, hy * 0.7);
  return [[cx + hx - c, cy + hy, z], [cx + hx, cy + hy - c, z], [cx + hx, cy - hy + c, z], [cx + hx - c, cy - hy, z], [cx - hx + c, cy - hy, z], [cx - hx, cy - hy + c, z], [cx - hx, cy + hy - c, z], [cx - hx + c, cy + hy, z]];
}
/** the same section lying in the plane y = const: half sizes hx, hz */
const octY = (y, hx, hz, ch) => oct(0, 0, 0, hx, hz, ch).map(([a, b]) => [a, y, b]);
const OCT_TAGS = (j) => (j % 2 === 0 ? 1 : 0); // chamfers are tag 1, flats tag 0

/**
 * Sweep a round section along a path. radius: number | per-point array | fn(t).
 * o.radial, o.rfn(t, angle) -> radius multiplier (knots, flutes), o.squash [a, b] section scale along the
 * frame's two axes, o.up reference vector for the frame, o.caps ('flat' | 'none'), o.tags(t, column).
 */
function tube(path, radius, o = {}) {
  let radial = o.radial ?? 8;
  if (FAR) {
    // fewer sides, no knots, and only the path points the silhouette needs
    const c0 = cumLen(path), L0 = c0[c0.length - 1] || 1, r0 = (i) => (o.radii ? o.radii[i] : typeof radius === 'number' ? radius : typeof radius === 'function' ? radius(c0[i] / L0) : radius[Math.min(radius.length - 1, Math.round((c0[i] / L0) * (radius.length - 1)))]);
    const P4 = path.map((q, i) => [q[0], q[1], q[2], r0(i)]), keep = o.twist ? path.map((q, i) => i) : keepers(path.length, c0, devOf(P4), 0.002);
    const maxR = Math.max(...P4.map((q) => q[3] * Math.max(o.squash ? Math.max(o.squash[0], o.squash[1]) : 1, 1))), full = radial, tags = o.tags;
    radial = Math.min(radial, maxR > 0.03 ? 6 : maxR < 0.0045 ? 3 : 4);
    path = keep.map((i) => path[i]);
    o = { ...o, radii: keep.map((i) => P4[i][3]), rfn: null, tags: tags ? (t, j) => tags(t, Math.round((j * full) / radial)) : null };
  }
  const n = path.length, mb = new MB();
  const rAt = (t) => {
    if (typeof radius === 'number') return radius;
    if (typeof radius === 'function') return radius(t);
    const f = t * (radius.length - 1), i = Math.min(radius.length - 2, Math.floor(f));
    return radius[i] + (radius[i + 1] - radius[i]) * (f - i);
  };
  const T = new THREE.Vector3(), U = new THREE.Vector3(...(o.up || [1, 0, 0])), V = new THREE.Vector3(), prevT = new THREE.Vector3(), q = new THREE.Quaternion();
  const rings = [];
  let len = 0;
  const cum = [0];
  for (let i = 1; i < n; i++) { len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]); cum.push(len); }
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    if (i === 0) { if (Math.abs(U.dot(T)) > 0.95) U.set(0, 0, 1); U.addScaledVector(T, -U.dot(T)).normalize(); } else { q.setFromUnitVectors(prevT, T); U.applyQuaternion(q); U.addScaledVector(T, -U.dot(T)).normalize(); }
    prevT.copy(T);
    V.crossVectors(T, U);
    const t = len > 0 ? cum[i] / len : 0, r = o.radii ? o.radii[i] : rAt(t), R = [];
    for (let j = 0; j < radial; j++) {
      const an = (j / radial) * Math.PI * 2 + (o.phase ?? 0) + (o.twist ? o.twist * t : 0), k = o.rfn ? o.rfn(t, an) : 1;
      const cu = Math.cos(an) * r * k * (o.squash ? o.squash[0] : 1), cv = Math.sin(an) * r * k * (o.squash ? o.squash[1] : 1);
      R.push(mb.v(path[i][0] + U.x * cu + V.x * cv, path[i][1] + U.y * cu + V.y * cv, path[i][2] + U.z * cu + V.z * cv));
    }
    rings.push(R);
  }
  for (let i = 0; i < n - 1; i++) mb.bridge(rings[i], rings[i + 1], o.tags ? (j) => o.tags(cum[i] / (len || 1), j) : 0);
  if (o.caps !== 'none') { mb.cap(rings[0], o.capTag ?? 0, true); mb.cap(rings[n - 1], o.capTag ?? 0); }
  return mb;
}
/** resample a polyline as a smooth curve with `count` points */
function smooth(pts, count, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])), closed, 'centripetal');
  const out = [], v = new THREE.Vector3(), m = closed ? count : count - 1;
  for (let i = 0; i < count; i++) { c.getPoint(i / m, v); out.push([v.x, v.y, v.z]); }
  return out;
}
const area2 = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i][0] * q[1] - q[0] * pts[i][1]; } return a / 2; };
const ccw = (pts) => (area2(pts) < 0 ? pts.slice().reverse() : pts);
/** offset a closed counter-clockwise outline inward; d(i) is the offset of the edge from point i to i + 1 */
function inset(pts, d) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n], da = d((i + n - 1) % n), dc = d(i);
    let ax = b[0] - a[0], ay = b[1] - a[1], cx = c[0] - b[0], cy = c[1] - b[1];
    const la = Math.hypot(ax, ay) || 1, lc = Math.hypot(cx, cy) || 1;
    ax /= la; ay /= la; cx /= lc; cy /= lc;
    const n1x = -ay, n1y = ax, n2x = -cy, n2y = cx, det = n1x * n2y - n1y * n2x; // inward normals of the two edges
    let ox, oy;
    if (Math.abs(det) < 0.25) { const mx = n1x + n2x, my = n1y + n2y, ml = Math.hypot(mx, my) || 1, k = (da + dc) / 2 / Math.max(0.5, (mx * n1x + my * n1y) / ml); ox = (mx / ml) * k; oy = (my / ml) * k; } else { ox = (da * n2y - dc * n1y) / det; oy = (dc * n1x - da * n2x) / det; }
    const l = Math.hypot(ox, oy), lim = 2.6 * Math.max(Math.abs(da), Math.abs(dc));
    if (l > lim) { ox *= lim / l; oy *= lim / l; }
    out.push([b[0] + ox, b[1] + oy]);
  }
  return out;
}
/**
 * A flat plate in the XY plane, thickness along Z, with a bevelled rim: the workhorse for axe heads,
 * lugs and fittings. outline [[x, y], ...]; o.th half thickness of the body (number | fn(x, y));
 * o.bevel width of the rim bevel (number | fn(i)); o.edge half thickness at the very rim
 * (number | fn(i); 0 = sharpened); o.holes [[...], ...] pierced openings.
 * Tags: 0 faces, 1 bevels, 2 rim, 3 hole walls.
 */
function plate(outline, o = {}) {
  if (FAR) return farPlate(outline, o);
  let O = outline.slice();
  const fnOf = (v, d) => (typeof v === 'function' ? v : () => v ?? d);
  let bev = fnOf(o.bevel, 0.003), edge = fnOf(o.edge, 0);
  const th = typeof o.th === 'function' ? o.th : () => o.th ?? 0.004;
  if (area2(O) < 0) { O.reverse(); const n = O.length, b0 = bev, e0 = edge; bev = (i) => b0(n - 1 - i); edge = (i) => e0(n - 1 - i); }
  const n = O.length, In = inset(O, (i) => Math.min(bev(i), bev((i + 1) % n))), mb = new MB();
  const holes = (o.holes || []).map((h) => (area2(h) > 0 ? h.slice().reverse() : h));
  const top = [], bot = [], rt = [], rb = [];
  for (let i = 0; i < n; i++) { const h = th(In[i][0], In[i][1]); top.push(mb.v(In[i][0], In[i][1], h)); bot.push(mb.v(In[i][0], In[i][1], -h)); }
  for (let i = 0; i < n; i++) { const e = Math.min(edge(i), th(In[i][0], In[i][1])); rt.push(mb.v(O[i][0], O[i][1], e)); rb.push(e > 1e-6 ? mb.v(O[i][0], O[i][1], -e) : rt[i]); }
  const ht = [], hb = [];
  for (const h of holes) { const a = [], b = []; for (const q of h) { const hh = th(q[0], q[1]); a.push(mb.v(q[0], q[1], hh)); b.push(mb.v(q[0], q[1], -hh)); } ht.push(a); hb.push(b); }
  const v2 = (pts) => pts.map((q) => new THREE.Vector2(q[0], q[1]));
  const tris = THREE.ShapeUtils.triangulateShape(v2(In), holes.map(v2));
  const flatT = [...top, ...ht.flat()], flatB = [...bot, ...hb.flat()], all = [...In, ...holes.flat()];
  for (const [a, b, c] of tris) {
    const ccw = (all[b][0] - all[a][0]) * (all[c][1] - all[a][1]) - (all[c][0] - all[a][0]) * (all[b][1] - all[a][1]) > 0;
    if (ccw) { mb.tri(flatT[a], flatT[b], flatT[c], 0); mb.tri(flatB[a], flatB[c], flatB[b], 0); } else { mb.tri(flatT[a], flatT[c], flatT[b], 0); mb.tri(flatB[a], flatB[b], flatB[c], 0); }
  }
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    mb.quad(rt[j], rt[k], top[k], top[j], 1);
    mb.quad(rb[k], rb[j], bot[j], bot[k], 1);
    if (rt[j] !== rb[j] || rt[k] !== rb[k]) mb.quad(rb[j], rb[k], rt[k], rt[j], 2);
  }
  holes.forEach((h, hi) => { for (let j = 0; j < h.length; j++) { const k = (j + 1) % h.length; mb.quad(hb[hi][j], hb[hi][k], ht[hi][k], ht[hi][j], 3); } });
  if (o.sub) {
    // finer faces, so a thickness that varies across the plate is followed everywhere inside the bevel line
    mb.sub(o.sub);
    const p = mb.p;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i + 2]) > 1e-9 && inOrOn(In, p[i], p[i + 1])) p[i + 2] = Math.sign(p[i + 2]) * th(p[i], p[i + 1]);
  }
  return mb;
}
/**
 * The far twin of a plate. It has to hide inside the real one at close range, bevels and all, so it is a thin
 * sheet pulled back from the rim: simplified outline, two faces, a wall, and only the large openings.
 */
function farPlate(outline, o) {
  const O = ccw(outline), n = O.length, th = typeof o.th === 'function' ? o.th : () => o.th ?? 0.004;
  let far = 0, h = 1;
  for (let i = 1; i < n; i++) if (Math.hypot(O[i][0] - O[0][0], O[i][1] - O[0][1]) > Math.hypot(O[far][0] - O[0][0], O[far][1] - O[0][1])) far = i;
  const chain = (a, b) => { const idx = []; for (let i = a; ; i = (i + 1) % n) { idx.push(i); if (i === b) break; } const P = idx.map((i) => O[i]); return keepers(P.length, cumLen(P, 2), devOf(P), o.farTol ?? 0.004).map((k) => idx[k]); };
  const S = inset([...chain(0, far).slice(0, -1), ...chain(far, 0).slice(0, -1)].map((i) => O[i]), () => o.farInset ?? 0.005), mb = new MB();
  for (const q of S) h = Math.min(h, th(q[0], q[1]) * 0.45);
  const holes = (o.holes || []).filter((q) => Math.abs(area2(q)) > 2e-4).map((q) => (area2(q) > 0 ? q.slice().reverse() : q)), all = [...S, ...holes.flat()];
  const top = all.map((q) => mb.v(q[0], q[1], h)), bot = all.map((q) => mb.v(q[0], q[1], -h)), v2 = (pts) => pts.map((q) => new THREE.Vector2(q[0], q[1]));
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(v2(S), holes.map(v2))) {
    if ((all[b][0] - all[a][0]) * (all[c][1] - all[a][1]) - (all[c][0] - all[a][0]) * (all[b][1] - all[a][1]) > 0) { mb.tri(top[a], top[b], top[c]); mb.tri(bot[a], bot[c], bot[b]); } else { mb.tri(top[a], top[c], top[b]); mb.tri(bot[a], bot[b], bot[c]); }
  }
  let off = 0;
  for (const ring of [S, ...holes]) { for (let j = 0; j < ring.length; j++) { const k = (j + 1) % ring.length; mb.quad(bot[off + j], bot[off + k], top[off + k], top[off + j], 2); } off += ring.length; }
  return mb;
}
/** is the point inside the polygon, or within a hair of its boundary? */
function inOrOn(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[i][0], ay = poly[i][1], bx = poly[j][0], by = poly[j][1];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay, t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1));
    if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < 2e-5) return true;
  }
  return inside;
}
/** a chamfered block centred on the origin */
function block(w, h, d, ch = 0.002) {
  return loft([oct(0, 0, -d / 2, w / 2 - ch, h / 2 - ch, ch), oct(0, 0, -d / 2 + ch, w / 2, h / 2, ch), oct(0, 0, d / 2 - ch, w / 2, h / 2, ch), oct(0, 0, d / 2, w / 2 - ch, h / 2 - ch, ch)], { tags: (j, i) => (i !== 1 || j % 2 === 0 ? 1 : 0) });
}
/** a domed rivet head, flat side at y = 0 */
function rivet(r, seg = 8) { return lathe([[r, 0], [r * 0.92, r * 0.3], [r * 0.6, r * 0.62], [0, r * 0.75]], seg, { cap: false }); }

// ---------------------------------------------------------------- palette
const STEEL = 0xc2cad2, IRON = 0x5a5f68, BRASS = 0xd9a441, GOLD = 0xe6b84a, ASH = 0xa88a5c, WALNUT = 0x4a3020;
const OXBLOOD = 0x6a281c, BONE = 0xe6dcc0, CORD = 0xcdbb8e;

/** a metal ramp from one colour: body, bright worn edge, dark recess */
function metalRamp(hex) {
  const b = lin(hex);
  return { b, hi: mix(mul(b, 1.25), WHITE, 0.3), lo: mul(b, 0.5), mid: mul(b, 0.78) };
}
/** blotchy wear: 0..1 noise at a point */
const wear = (x, y, z, f = 60) => fbm3(x * f + 3.1, y * f + 7.7, z * f + 1.3, 3);
/** leather with scuffs */
const leatherShade = (hex, f = 90) => { const c = lin(hex); return (x, y, z) => mul(c, 0.78 + 0.45 * wear(x, y, z, f)); };
/** wood with grain running along Y: broad figure, streaks and thin dark growth lines */
function woodShade(hex, o = {}) {
  const c = lin(hex), dark = mul(c, 0.38), pale = mul(c, 1.12), f = o.f ?? 70, ox = o.seed ?? 0;
  return (x, y, z) => {
    const g = noise3(x * f + ox, y * f * 0.07 + ox * 0.3, z * f + 5.2), st = noise3(x * f * 2.7 + 9, y * f * 0.16, z * f * 2.7 + ox);
    const line = 1 - sstep(0, 0.11, Math.abs(st - 0.5));
    return mix(dark, pale, clamp(0.32 + g * 0.7 - line * 0.34));
  };
}

// ---------------------------------------------------------------- blades
const BEV = 1, FUL = 2;
const BLADE_TAGS = [BEV, 0, FUL, FUL, FUL, FUL, 0, BEV, BEV, 0, FUL, FUL, FUL, FUL, 0, BEV];
/**
 * A double-edged blade along +Y, edges at +-Z. s: y0, y1, w(t) half width, th(t) -> [shoulder, rim, centre]
 * half thicknesses (centre below rim = fuller, above = midrib), bw(t) edge bevel width, fw(t) fuller half width.
 */
function bladeMB(s, stops) {
  const rings = [];
  for (const t of stops) {
    const y = lerp(s.y0, s.y1, t), W = Math.max(s.w(t), 0.0002), B = Math.min(s.bw(t), W * 0.7), F = Math.min(s.fw(t), (W - B) * 0.85);
    let [xs, xr, xc] = s.th(t);
    const k = Math.min(1, W / 0.004); xs *= k; xr *= k; xc *= k; // thin out into the point
    const xm = xr + (xc - xr) * 0.72;
    rings.push([[0, y, W], [xs, y, W - B], [xr, y, F], [xm, y, F * 0.5], [xc, y, 0], [xm, y, -F * 0.5], [xr, y, -F], [xs, y, -(W - B)],
      [0, y, -W], [-xs, y, -(W - B)], [-xr, y, -F], [-xm, y, -F * 0.5], [-xc, y, 0], [-xm, y, F * 0.5], [-xr, y, F], [-xs, y, W - B]]);
  }
  return loft(rings, { tags: (j) => BLADE_TAGS[j] });
}
const tipf = (t, t0, p) => (t < t0 ? 1 : Math.max(0, 1 - ((t - t0) / (1 - t0)) ** p));
const stopsOf = (n, t0, tipN) => { const out = []; for (let i = 0; i < n; i++) out.push((i / n) * t0); for (let i = 0; i <= tipN; i++) out.push(t0 + (1 - t0) * (1 - (1 - i / tipN) ** 1.6)); return out; };
/** steel that is bright on the edge bevels, dark in the fuller and mottled on the flats */
function bladeShade(M, s) {
  return (x, y, z, nx, ny, nz, tag) => {
    const t = (y - s.y0) / (s.y1 - s.y0);
    if (tag === BEV) return mix(M.hi, M.b, 0.25 * wear(x, y, z, 120));
    const n = wear(x * 0.3, y, z, 45);
    if (tag === FUL) { const [, xr, xc] = s.th(t); const d = clamp((xr - xc) / 0.0025); return mix(mul(M.b, 0.92 + 0.14 * n), mul(M.lo, 0.9 + 0.3 * n), d); }
    return mul(M.b, 0.86 + 0.22 * n);
  };
}
function addBlade(m, s, M, nLo, nHi) {
  m.add('metal', fin(bladeMB(s, stopsOf(nHi, s.tip ?? 0.8, 9)), { crease: 13, shade: bladeShade(M, s) }), null, 1);
  m.add('metal', () => fin(bladeMB(s, stopsOf(FAR ? 2 : nLo, s.tip ?? 0.8, FAR ? 2 : 4)), { crease: 13, shade: bladeShade(M, s), deflate: 0.0006 }));
}

/** a straight or curved crossguard along Z from mirrored stations [z, yc, hx, hy] */
function guardMB(st, ch = 0.0022) {
  const full = [...st.slice().reverse().map(([z, y, hx, hy]) => [-z, y, hx, hy]), ...st.filter((q) => q[0] > 1e-6)];
  return loft(full.map(([z, y, hx, hy]) => oct(0, y, z, hx, hy, ch)), { tags: OCT_TAGS });
}
const fitShade = (M) => (x, y, z, nx, ny, nz, tag) => (tag === 1 ? mix(M.hi, M.b, 0.3) : mul(M.b, 0.8 + 0.3 * wear(x, y, z, 80)));

// ---------------------------------------------------------------- hilts
/** radius as a function of y from a lathe profile [[r, y], ...] sorted by y */
const profFn = (pts) => (y) => {
  if (y <= pts[0][1]) return pts[0][0];
  for (let i = 1; i < pts.length; i++) if (y <= pts[i][1]) return lerp(pts[i - 1][0], pts[i][0], (y - pts[i - 1][1]) / (pts[i][1] - pts[i - 1][1]));
  return pts[pts.length - 1][0];
};
/** a strip wound around the Y axis like a leather grip wrap: each turn laps over the one below */
function wrapMB(y0, y1, turns, rfn, o = {}) {
  const per = o.per ?? 10, steps = Math.round(turns * per), mb = new MB(), sx = o.sx ?? 1, th = o.th ?? 0.0015;
  const w = ((y1 - y0) / turns) * 0.52, rings = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = t * turns * Math.PI * 2, y = lerp(y0, y1, t), c = Math.cos(a) * sx, s = Math.sin(a);
    const ya = clamp(y - w, y0, y1), yb = clamp(y + w, y0, y1), ra = rfn(ya), rb = rfn(yb);
    rings.push([[c * (ra + th * 0.1), ya, s * (ra + th * 0.1)], [c * (rb + th), yb, s * (rb + th)], [c * (rb - th), yb, s * (rb - th)], [c * (ra - th), ya, s * (ra - th)]]);
  }
  const R = rings.map((r) => mb.ring(r));
  for (let i = 0; i < R.length - 1; i++) mb.bridge(R[i], R[i + 1], (j) => j);
  mb.cap(R[0], 1, true); mb.cap(R[R.length - 1], 1);
  return mb;
}
/** a wrapped grip between two heights: smooth core everywhere, the lapped wrap up close */
function addGrip(m, prof, hex, o = {}) {
  const sx = o.sx ?? 0.85, rf = profFn(prof), y0 = prof[0][1], y1 = prof[prof.length - 1][1], lea = leatherShade(hex), c = lin(hex);
  m.add('leather', () => fin(lathe(prof, o.seg ?? 10), { shade: lea }), X(0, 0, 0, 0, 0, 0, sx, 1, 1));
  const turns = o.turns ?? Math.round((y1 - y0) / 0.0135);
  m.add('leather', fin(wrapMB(y0 + 0.001, y1 - 0.001, turns, rf, { sx, th: o.th ?? 0.0015 }), {
    crease: 40, shade: (x, y, z, nx, ny, nz, tag) => (tag === 1 ? mul(c, 0.3) : mul(c, 0.85 + 0.55 * wear(x, y, z, 110))),
  }), null, 1);
}
/** a thin collar around the Y axis (ferrule, riser ring) */
const collar = (r, y, h, bulge = 0.0012, seg = 12) => lathe([[r, y - h], [r + bulge, y - h * 0.4], [r + bulge, y + h * 0.4], [r, y + h]], seg, { cap: false });

// ---------------------------------------------------------------- swords
const YZ = X(0, -90, 0); // plate space -> weapon space: plate x -> +Z (edge side), plate y -> +Y, thickness along X

function sword(kind, o) {
  const m = new Model(), M = metalRamp(o.tint ?? STEEL), Br = metalRamp(BRASS), Ir = metalRamp(o.tint ? mul(lin(o.tint), 0.6) : IRON);
  const brass = (x, y, z, nx, ny, nz, tag) => (tag === 1 ? mix(Br.hi, Br.b, 0.3) : mul(Br.b, 0.78 + 0.34 * wear(x, y, z, 80)));
  if (kind === 'sword') {
    // arming sword: broad fullered blade, straight guard, wheel pommel
    const s = {
      y0: 0.05, y1: 0.5, tip: 0.8,
      w: (t) => 0.0235 * (1 - 0.2 * t) * tipf(t, 0.8, 1.7),
      th: (t) => { const T = 0.0046 * (1 - 0.42 * t), f = 1 - sstep(0.55, 0.68, t); return [T * 0.5, T, T - 0.0026 * f + 0.0006 * (1 - f)]; },
      bw: (t) => 0.0052 * (1 - 0.2 * t), fw: (t) => 0.0072 * (1 - 0.35 * t),
    };
    addBlade(m, s, M, 5, 20);
    const gy = (z) => 0.047 + 0.005 * (z / 0.088) ** 2;
    m.add('metal', () => fin(guardMB([[0, 0.047, 0.0118, 0.0108], [0.013, 0.047, 0.0118, 0.0108], [0.017, gy(0.017), 0.0082, 0.0072], [0.06, gy(0.06), 0.007, 0.006], [0.078, gy(0.078), 0.0076, 0.0084], [0.086, gy(0.086), 0.007, 0.0092], [0.0895, gy(0.0895), 0.0035, 0.0055]]), { crease: 28, shade: fitShade(M) }));
    addGrip(m, [[0.0098, -0.043], [0.0112, -0.03], [0.0128, 0], [0.012, 0.028], [0.0112, 0.04]], OXBLOOD, { sx: 0.84 });
    // wheel pommel with a brass boss on each face
    const R = 0.0245, h = 0.0078;
    m.add('metal', () => fin(lathe([[0, -h - 0.0042], [0.0075, -h - 0.0042], [0.0105, -h - 0.0005], [0.0125, -h], [R - 0.006, -h], [R, -h + 0.0052], [R, h - 0.0052], [R - 0.006, h], [0.0125, h], [0.0105, h + 0.0005], [0.0075, h + 0.0042], [0, h + 0.0042]], 16, { tags: (i) => (i < 2 || i > 8 ? 2 : i === 4 || i === 6 ? 1 : 0) }),
      { crease: 30, shade: (x, y, z, nx, ny, nz, tag) => (tag === 2 ? mix(Br.b, Br.hi, 0.3 * wear(x, y, z, 150)) : tag === 1 ? M.hi : mul(M.b, 0.8 + 0.3 * wear(x, y, z, 90))) }), X(0, 0, 90, 0, -0.0665, 0));
    m.add('metal', fin(block(0.007, 0.006, 0.007, 0.0012), { shade: M.mid }), AT(0, -0.0925, 0), 1);
    m.both('metal', fin(rivet(0.0034, 8), { shade: Br.b }), X(0, 0, -90, 0.0118, 0.047, 0), 1);
    for (const z of [-0.072, 0.072]) m.both('metal', fin(rivet(0.0022, 6), { shade: M.hi }), X(0, 0, -90, 0.0072, gy(z), z), 0);
    const mark = fin(plate([[0, -0.006], [0.0032, 0], [0, 0.006], [-0.0032, 0]], { th: 0.0005, bevel: 0.0004, edge: 0.0003 }), { shade: Br.b });
    for (const y of [0.094, 0.112, 0.13]) m.both('metal', mark, AT(0.002, y, 0).multiply(YZ), 0);
  } else if (kind === 'longsword') {
    // hand-and-a-half sword: acute diamond blade, gilt guard with knobbed arms, scent-stopper pommel
    const s = {
      y0: 0.058, y1: 0.62, tip: 0.84,
      w: (t) => 0.0218 * (1 - 0.4 * t) * tipf(t, 0.84, 1.35),
      th: (t) => { const T = 0.005 * (1 - 0.4 * t), f = 1 - sstep(0.26, 0.4, t); return [T * 0.36, T * 0.82, lerp(T, T * 0.82 - 0.0022, f)]; },
      bw: (t) => 0.0046 * (1 - 0.3 * t), fw: (t) => 0.0056 * (1 - 0.45 * t),
    };
    addBlade(m, s, M, 6, 24);
    const gy = (z) => 0.055 + 0.013 * (z / 0.116) ** 2;
    m.add('metal', () => fin(guardMB([[0, 0.055, 0.0122, 0.0115], [0.012, 0.055, 0.0122, 0.011], [0.016, gy(0.016), 0.0072, 0.0066], [0.07, gy(0.07), 0.006, 0.0054], [0.096, gy(0.096), 0.005, 0.0046], [0.103, gy(0.103), 0.0078, 0.0078], [0.111, gy(0.111), 0.0078, 0.0078], [0.1165, gy(0.1165), 0.003, 0.003]]), { crease: 28, shade: brass }));
    m.both('gem', fin(lathe([[0.0056, 0], [0.0052, 0.0016], [0.0034, 0.0032], [0, 0.004]], 10, { cap: false }), { shade: (x, y, z) => mix(lin(0x6a0c14), lin(0xd82a3c), sstep(0, 0.004, y)) }), X(0, 0, -90, 0.0122, 0.0552, 0), 1);
    m.both('metal', fin(lathe([[0.0074, 0], [0.0074, 0.0012], [0.0056, 0.0018]], 10, { cap: false }), { shade: Br.hi }), X(0, 0, -90, 0.0122, 0.0552, 0), 1);
    // langet lapping onto the blade
    m.add('metal', () => fin(plate([[-0.0125, 0.064], [0.0125, 0.064], [0.0125, 0.074], [0, 0.097], [-0.0125, 0.074]], { th: 0.0058, bevel: 0.002, edge: 0.0044 }), { crease: 25, shade: brass }), YZ);
    addGrip(m, [[0.0096, -0.09], [0.0106, -0.07], [0.0122, -0.03], [0.013, 0], [0.0122, 0.03], [0.0115, 0.045]], 0x1c2a4a, { sx: 0.85 });
    for (const y of [-0.088, -0.024, 0.043]) m.add('metal', fin(collar(profFn([[0.0096, -0.09], [0.0122, -0.03], [0.013, 0], [0.0115, 0.045]])(y) + 0.0006, y, 0.0028), { shade: brass }), X(0, 0, 0, 0, 0, 0, 0.87, 1, 1), 1);
    m.add('metal', () => fin(lathe([[0.0086, -0.088], [0.011, -0.0925], [0.0088, -0.097], [0.0125, -0.106], [0.018, -0.123], [0.0168, -0.135], [0.0092, -0.142], [0.0042, -0.1455], [0.0048, -0.15], [0, -0.151]], 8, { tags: (i) => (i === 1 || i === 7 ? 1 : 0) }), { crease: 20, shade: brass }), X(0, 22.5, 0));
  } else if (kind === 'greatsword') {
    // two-hander: leather-bound ricasso, parrying lugs, long grip, pear pommel
    const s = {
      y0: 0.078, y1: 0.85, tip: 0.86,
      w: (t) => lerp(0.0165, 0.0272 * (1 - 0.24 * t), sstep(0.15, 0.2, t)) * tipf(t, 0.86, 1.5),
      th: (t) => { const T = 0.0058 * (1 - 0.42 * t), f = sstep(0.17, 0.23, t) * (1 - sstep(0.46, 0.6, t)), r = sstep(0.14, 0.2, t); return [lerp(T, T * 0.48, r), T, T - 0.0028 * f + 0.0007 * sstep(0.5, 0.7, t)]; },
      bw: (t) => lerp(0.0014, 0.006, sstep(0.15, 0.2, t)), fw: () => 0.0078,
    };
    addBlade(m, s, M, 8, 30);
    m.add('metal', () => fin(plate([[-0.053, 0.207], [-0.03, 0.19], [0, 0.184], [0.03, 0.19], [0.053, 0.207], [0.031, 0.2135], [0, 0.226], [-0.031, 0.2135]], { th: 0.0054, bevel: 0.0045, edge: 0.0007 }), { crease: 20, shade: (x, y, z, nx, ny, nz, tag) => (tag ? M.hi : mul(M.b, 0.85)) }), YZ);
    // ricasso sleeve
    const lea = leatherShade(0x3a2618);
    m.add('leather', () => fin(loft([octY(0.088, 0.0068, 0.0176, 0.003), octY(0.091, 0.0077, 0.0186, 0.003), octY(0.167, 0.0077, 0.0186, 0.003), octY(0.17, 0.0068, 0.0176, 0.003)]), { crease: 30, shade: lea }));
    const gy = (z) => 0.068 + 0.008 * (z / 0.142) ** 2;
    m.add('iron', () => fin(guardMB([[0, 0.068, 0.0135, 0.0125], [0.015, 0.068, 0.0135, 0.012], [0.019, gy(0.019), 0.0088, 0.0078], [0.09, gy(0.09), 0.0076, 0.0066], [0.118, gy(0.118), 0.0068, 0.006], [0.126, gy(0.126), 0.0098, 0.0108], [0.136, gy(0.136), 0.0098, 0.0108], [0.1425, gy(0.1425), 0.004, 0.005]]), { crease: 28, shade: fitShade(Ir) }));
    const gp = [[0.0102, -0.146], [0.0112, -0.12], [0.0124, -0.05], [0.013, 0], [0.0124, 0.04], [0.0118, 0.057]];
    addGrip(m, gp, 0x2e2018, { sx: 0.86 });
    for (const y of [-0.144, -0.046, 0.054]) m.add('iron', fin(collar(profFn(gp)(y) + 0.0006, y, 0.0034, 0.0016), { shade: fitShade(Ir) }), X(0, 0, 0, 0, 0, 0, 0.88, 1, 1), y === -0.046 ? 99 : 1);
    m.add('iron', () => fin(lathe([[0.0092, -0.143], [0.0115, -0.148], [0.0092, -0.153], [0.0168, -0.166], [0.0215, -0.181], [0.019, -0.195], [0.0112, -0.204], [0.005, -0.2075], [0, -0.208]], 12), { crease: 40, shade: fitShade(Ir) }));
    m.add('metal', fin(lathe([[0.0056, -0.2065], [0.0062, -0.2095], [0.0038, -0.2125], [0, -0.2135]], 8), { shade: brass }), null, 1);
    m.both('metal', fin(rivet(0.0038, 8), { shade: Br.b }), X(0, 0, -90, 0.0135, 0.068, 0), 1);
    for (const z of [-0.131, 0.131]) m.both('metal', fin(rivet(0.0026, 6), { shade: Br.b }), X(0, 0, -90, 0.0098, gy(z), z), 0);
  } else {
    // dagger: stiff diamond blade, crescent guard, acorn pommel
    const s = {
      y0: 0.046, y1: 0.22, tip: 0.5,
      w: (t) => 0.0158 * (1 - 0.3 * t) * tipf(t, 0.5, 1.2),
      th: (t) => { const T = 0.0043 * (1 - 0.35 * t); return [T * 0.3, T * 0.66, T]; },
      bw: (t) => 0.0042 * (1 - 0.3 * t), fw: () => 0.0032,
    };
    addBlade(m, s, M, 4, 12);
    const gy = (z) => 0.043 + 0.013 * (z / 0.041) ** 2;
    m.add('metal', () => fin(guardMB([[0, 0.043, 0.0095, 0.0075], [0.009, 0.0435, 0.0095, 0.0075], [0.012, gy(0.012), 0.006, 0.0052], [0.03, gy(0.03), 0.0052, 0.0046], [0.036, gy(0.036), 0.0064, 0.0064], [0.0405, gy(0.0405), 0.0028, 0.003]], 0.0018), { crease: 28, shade: fitShade(M) }));
    const gp = [[0.0092, -0.04], [0.0108, -0.02], [0.0114, 0], [0.0104, 0.025], [0.0098, 0.037]];
    addGrip(m, gp, 0x2a2420, { sx: 0.86 });
    for (const y of [-0.038, 0.035]) m.add('metal', fin(collar(profFn(gp)(y) + 0.0005, y, 0.0024), { shade: brass }), X(0, 0, 0, 0, 0, 0, 0.88, 1, 1), 1);
    m.add('metal', () => fin(lathe([[0.0088, -0.039], [0.0128, -0.044], [0.0138, -0.05], [0.0112, -0.057], [0.005, -0.0612], [0, -0.062]], 10), { crease: 40, shade: brass }));
  }
  return m;
}

// ---------------------------------------------------------------- hafts, poles and heads
/** the few heights a lean pole needs so that straight spans between them stay within tol of f(y) -> [r, x, z] */
function leanStops(y0, y1, f, tol, maxN) {
  const ys = [], vals = [];
  for (let i = 0; i <= 72; i++) { ys.push(lerp(y0, y1, i / 72)); vals.push(f(ys[i])); }
  return keepers(73, ys, devOf(vals), tol, maxN).map((i) => ys[i]);
}
/** a wooden pole from y0 to y1: dense grain shell up close, lean core behind it. rfn(y) radius, o.path(y) centre line */
function addShaft(m, y0, y1, rfn, hex, o = {}) {
  const sh = o.shade ?? woodShade(hex, { seed: o.seed ?? 0, f: o.f ?? 70 }), at = (y) => (o.path ? o.path(y) : [0, y, 0]);
  const mk = (ys, radial) => tube(ys.map(at), 0, { radial, squash: o.squash, radii: ys.map(rfn), rfn: o.rfn ? (t, a) => o.rfn(lerp(y0, y1, t), a) : null });
  const n = o.hi ?? Math.ceil((y1 - y0) / 0.025), dense = [];
  for (let i = 0; i <= n; i++) dense.push(lerp(y0, y1, i / n));
  m.add('wood', fin(mk(dense, o.radial ?? 10), { crease: 50, shade: sh }), null, 1);
  const lean = (tol, n) => leanStops(y0, y1, (y) => { const c = at(y); return [rfn(y), c[0], c[2]]; }, tol, n);
  m.add('wood', () => fin(mk(FAR ? lean(0.003, 7) : lean(o.tol ?? 0.0012, o.lo ?? 12), o.radialLo ?? 6), { crease: 50, shade: sh, deflate: o.deflate ?? 0.0008 }));
}
/** points along a quadratic curve a -> c bending toward b (first point skipped so curves chain) */
const bez = (a, b, c, n, flag = 0) => { const out = []; for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1], flag]); } return out; };
const ngon = (cx, cy, r, n, rot = 0) => { const out = []; for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; };
/** a plate whose flagged outline points [x, y, 1] are ground to a cutting edge and the rest chamfered */
function bladePlate(pts, o = {}) {
  const thAt = typeof o.th === 'function' ? o.th : () => o.th ?? 0.004, ch = o.chamfer ?? 0.0022, n = pts.length, full = o.bevel ?? 0.014;
  // the ground bevel narrows toward the ends of each sharpened run, so horns and toes stay solid
  const w = pts.map((q, i) => {
    if (!q[2]) return ch;
    let d = 1; while (d < 4 && pts[(i + d) % n][2] && pts[(i - d + n * 4) % n][2]) d++;
    return Math.max(ch, full * [0, 0.4, 0.72, 0.92, 1][d]);
  });
  return plate(pts.map((q) => [q[0], q[1]]), {
    th: o.th, holes: o.holes, sub: o.sub, bevel: (i) => w[i],
    edge: (i) => (pts[i][2] ? 0 : Math.max(0.0006, thAt(pts[i][0], pts[i][1]) - ch * 0.8)),
  });
}
/** forged head: dark scale near the eye, satin cheeks, bright ground edge. sharp(x, y) says where the cutting bevel is */
function headShade(M, D, sharp, cheek) {
  return (x, y, z, nx, ny, nz, tag) => {
    const n = wear(x, y, z * 0.2, 55);
    if (tag === 3) return D.lo;
    if (tag === 1 && sharp(x, y)) return mix(M.hi, M.b, 0.3 * n);
    const k = cheek(x, y);
    const body = mix(mul(D.b, 0.7 + 0.5 * n), mul(M.b, 0.78 + 0.25 * n), k);
    return tag ? mix(body, M.hi, 0.35) : body;
  };
}
/** a four-sided spike along +Y from y0 (half sizes hx, hz) to a point at y1 */
function spike4(y0, y1, hx, hz, bend = 0) {
  const R = [];
  for (const t of [0, 0.5, 0.82, 1]) { const k = Math.max(0.03, 1 - t ** 1.25), y = lerp(y0, y1, t), z = bend * t * t; R.push([[hx * k, y, z], [0, y, z + hz * k], [-hx * k, y, z], [0, y, z - hz * k]]); }
  return loft(R);
}
/** thin strap of steel lying on a shaft's side (langet), rivets added up close */
function addLangets(m, finish, y0, y1, r, w, M, rivetHex, n = 3) {
  const th = 0.0016, bar = () => fin(block(th * 2, y1 - y0, w, 0.0008), { shade: (x, y, z, nx, ny, nz, tag) => (tag ? M.hi : mul(M.b, 0.8 + 0.3 * wear(x, y, z, 70))) });
  m.both(finish, bar, AT(r + th * 0.4, (y0 + y1) / 2, 0));
  const rv = fin(rivet(0.0026, 6), { shade: rivetHex });
  for (let i = 0; i < n; i++) m.both('metal', rv, X(0, 0, -90, r + th * 1.3, lerp(y0, y1, (i + 0.5) / n), 0), 1);
}
/** butt shoe / ferrule from a lathe profile */
const addLathe = (m, finish, prof, seg, shade, mat = null, lod = 99, crease = 35) => m.add(finish, () => fin(lathe(prof, seg), { crease, shade }), mat, lod);

function axe(kind, o) {
  const m = new Model(), M = metalRamp(o.tint ?? STEEL), D = metalRamp(o.tint ? mul(lin(o.tint), 0.5) : 0x3e4148), Br = metalRamp(BRASS);
  const dark = fitShade(metalRamp(o.tint ? mul(lin(o.tint), 0.6) : IRON));
  if (kind === 'axe') {
    // bearded hand axe on a curved hickory haft
    const zc = (y) => -0.005 * Math.sin((y * Math.PI * 2) / 0.44) * sstep(0.05, 0.12, Math.abs(y));
    const rf = (y) => 0.0126 + 0.0052 * (1 - sstep(-0.102, -0.062, y)) + 0.001 * sstep(0.36, 0.42, y);
    addShaft(m, -0.102, 0.49, rf, 0x80592f, { path: (y) => [0, y, zc(y)], squash: [0.82, 1.12], seed: 3 });
    const pts = [[-0.024, 0.413, 0], [-0.024, 0.463, 0], [0, 0.471, 0], [0.03, 0.469, 0], ...bez([0.03, 0.469], [0.078, 0.468], [0.122, 0.502], 4), ...bez([0.122, 0.502], [0.146, 0.42], [0.108, 0.312], 9, 1), ...bez([0.108, 0.312], [0.086, 0.362], [0.04, 0.398], 4), [0.018, 0.406, 0], [0, 0.406, 0]];
    pts[7][2] = 1;
    const th = (x) => (x < 0 ? lerp(0.0166, 0.0135, clamp(-x / 0.024)) : lerp(0.0166, 0.0034, sstep(0.008, 0.07, x)));
    const hs = headShade(M, D, (x) => x > 0.085, (x) => sstep(0.035, 0.1, x));
    m.add('iron', fin(bladePlate(pts, { th, bevel: 0.017, sub: 0.016 }), { crease: 22, shade: hs }), YZ, 1);
    m.add('iron', () => fin(bladePlate(pts, { th, bevel: 0.017, sub: 0.045 }), { crease: 22, shade: hs, deflate: 0.0006 }), YZ);
    m.add('iron', () => fin(lathe([[0.0172, 0.402], [0.0192, 0.406], [0.0192, 0.47], [0.0172, 0.474]], 10), { shade: dark }), X(0, 0, 0, 0, 0, 0, 0.92, 1, 1.06));
    m.add('iron', fin(block(0.004, 0.003, 0.02, 0.0008), { shade: M.b }), AT(0, 0.4905, 0), 1);
    addGrip(m, [[0.0152, -0.052], [0.0152, 0.05]], 0x3a2a1e, { sx: 0.76, turns: 8 });
    for (const y of [0.372, 0.381, 0.39]) m.add('cord', fin(collar(0.0148, y, 0.004, 0.0016, 8), { shade: mul(lin(CORD), 0.8 + 0.2 * Math.sin(y * 900)) }), X(0, 0, 0, 0, 0, zc(y), 0.8, 1, 1.05), 1);
  } else {
    // double-bitted great axe: pierced crescent blades, spiked finial, shod butt
    addShaft(m, -0.215, 0.875, () => 0.0155, WALNUT, { squash: [0.92, 1.04], seed: 7 });
    const half = [[0, 0.868, 0], [0.02, 0.868, 0], [0.036, 0.852, 0], ...bez([0.036, 0.852], [0.078, 0.858], [0.136, 0.936], 5), ...bez([0.136, 0.936], [0.218, 0.8], [0.136, 0.664], 12, 1), ...bez([0.136, 0.664], [0.078, 0.742], [0.036, 0.748], 5), [0.02, 0.732, 0], [0, 0.732, 0]];
    half[7][2] = 1;
    const pts = [...half, ...half.slice(1, -1).reverse().map(([x, y, f]) => [-x, y, f])];
    const th = (x) => lerp(0.0078, 0.0038, sstep(0.02, 0.1, Math.abs(x)));
    const holes = [ngon(0.086, 0.8, 0.0125, 10), ngon(-0.086, 0.8, 0.0125, 10), ngon(0.06, 0.83, 0.0052, 6), ngon(0.06, 0.77, 0.0052, 6), ngon(-0.06, 0.83, 0.0052, 6), ngon(-0.06, 0.77, 0.0052, 6)];
    const hs = headShade(M, D, (x) => Math.abs(x) > 0.118, (x) => sstep(0.04, 0.13, Math.abs(x)));
    m.add('iron', fin(bladePlate(pts, { th, bevel: 0.02, holes, sub: 0.038 }), { crease: 22, shade: hs }), YZ, 1);
    m.add('iron', () => fin(bladePlate(pts, { th, bevel: 0.02, holes, sub: 0.07 }), { crease: 22, shade: hs, deflate: 0.0006 }), YZ);
    m.add('iron', () => fin(lathe([[0.0185, 0.722], [0.0225, 0.727], [0.0225, 0.737], [0.0205, 0.741], [0.0205, 0.861], [0.0225, 0.865], [0.0225, 0.874], [0.0165, 0.88]], 12), { shade: dark }));
    m.add('iron', () => fin(spike4(0.876, 0.957, 0.0105, 0.0125), { crease: 20, shade: (x, y, z, nx, ny, nz) => mix(M.b, M.hi, sstep(0.9, 0.95, y)) }));
    const med = fin(lathe([[0.0185, 0], [0.0185, 0.0018], [0.0145, 0.004], [0.0075, 0.0045], [0.0058, 0.0075], [0, 0.0082]], 12, { cap: false, tags: (i) => (i > 2 ? 1 : 0) }), { shade: (x, y, z, nx, ny, nz, tag) => (tag ? M.b : mix(Br.b, Br.hi, 0.3 * wear(x, y, z, 200))) });
    m.both('metal', med, X(0, 0, -90, 0.0198, 0.8, 0), 1);
    addLangets(m, 'iron', 0.6, 0.724, 0.0143, 0.012, metalRamp(o.tint ? mul(lin(o.tint), 0.6) : IRON), Br.b, 3);
    addLathe(m, 'iron', [[0.0168, -0.2], [0.0188, -0.204], [0.0188, -0.238], [0.0135, -0.25], [0.0085, -0.256], [0.0058, -0.282], [0, -0.305]], 10, dark);
    for (const y of [0.1, 0.27, 0.46]) m.add('iron', fin(collar(0.0162, y, 0.0045, 0.0018, 10), { shade: dark }), null, y === 0.27 ? 99 : 1);
    addGrip(m, [[0.0172, -0.19], [0.0172, 0.085]], 0x33231a, { sx: 0.9, turns: 20 });
    addGrip(m, [[0.0172, 0.295], [0.0172, 0.435]], 0x33231a, { sx: 0.9, turns: 10 });
  }
  return m;
}

function halberd(kind, o) {
  const m = new Model(), M = metalRamp(o.tint ?? STEEL), D = metalRamp(o.tint ? mul(lin(o.tint), 0.5) : 0x3e4148), Br = metalRamp(BRASS);
  const Ir = metalRamp(o.tint ? mul(lin(o.tint), 0.6) : IRON), dark = fitShade(Ir);
  addShaft(m, -0.37, 0.91, () => 0.0122, ASH, { seed: 11 });
  const pts = [[0.011, 1.092, 0], ...bez([0.011, 1.092], [0.052, 1.098], [0.118, 1.172], 5), ...bez([0.118, 1.172], [0.146, 1.07], [0.104, 0.952], 10, 1), ...bez([0.104, 0.952], [0.07, 1.004], [0.011, 0.976], 5),
    [-0.011, 0.976, 0], ...bez([-0.011, 0.976], [-0.062, 1.012], [-0.11, 0.936], 5), ...bez([-0.11, 0.936], [-0.072, 1.062], [-0.011, 1.078], 5), [-0.011, 1.092, 0]];
  pts[5][2] = 1;
  const holes = [ngon(0.068, 1.058, 0.0108, 10), ngon(0.047, 1.088, 0.0048, 6), ngon(0.047, 1.026, 0.0048, 6)];
  const hs = headShade(M, D, (x, y) => x > 0.09 || (x < -0.07 && y < 0.99), (x) => sstep(0.03, 0.1, Math.abs(x)));
  const th = (x) => lerp(0.0046, 0.0032, sstep(0.02, 0.09, Math.abs(x)));
  m.add('iron', fin(bladePlate(pts, { th, bevel: 0.016, holes, sub: 0.02 }), { crease: 22, shade: hs }), YZ, 1);
  m.add('iron', () => fin(bladePlate(pts, { th, bevel: 0.016, holes, sub: 0.07 }), { crease: 22, shade: hs, deflate: 0.0006 }), YZ);
  m.add('iron', () => fin(lathe([[0.0138, 0.9], [0.0168, 0.904], [0.0168, 0.914], [0.0152, 0.918], [0.0138, 1.07], [0.0158, 1.075], [0.0158, 1.086], [0.011, 1.092]], 10), { shade: dark }));
  m.add('iron', () => fin(spike4(1.088, 1.25, 0.0068, 0.0125), { crease: 20, shade: (x, y) => mix(mul(M.b, 0.85), M.hi, sstep(1.12, 1.24, y) * 0.8) }));
  addLangets(m, 'iron', 0.7, 0.902, 0.0112, 0.011, Ir, Br.b, 4);
  addLathe(m, 'iron', [[0.0122, -0.33], [0.0146, -0.335], [0.0146, -0.372], [0.0102, -0.4], [0.0042, -0.428], [0, -0.433]], 10, dark);
  addGrip(m, [[0.0136, -0.06], [0.0136, 0.07]], 0x4a2f1c, { sx: 1, turns: 10 });
  return m;
}

function warhammer(kind, o) {
  const m = new Model(), M = metalRamp(o.tint ?? STEEL), Br = metalRamp(GOLD), yh = 0.549;
  const steel = fitShade(M), brass = (x, y, z, nx, ny, nz, tag) => (tag === 1 ? mix(Br.hi, Br.b, 0.3) : mul(Br.b, 0.78 + 0.34 * wear(x, y, z, 80)));
  addShaft(m, -0.105, 0.59, () => 0.0124, WALNUT, { seed: 5 });
  // socket block, face and beak
  m.add('metal', () => fin(loft([octY(0.492, 0.016, 0.018, 0.0045), octY(0.497, 0.0192, 0.0212, 0.0055), octY(0.6, 0.0192, 0.0212, 0.0055), octY(0.605, 0.016, 0.018, 0.0045)], { tags: OCT_TAGS }), { crease: 25, shade: steel }));
  m.add('metal', () => fin(loft([oct(0, yh, 0.014, 0.0142, 0.0162, 0.0045), oct(0, yh, 0.03, 0.0126, 0.0142, 0.004), oct(0, yh, 0.041, 0.0138, 0.0154, 0.0044), oct(0, yh, 0.047, 0.0238, 0.0258, 0.007), oct(0, yh, 0.087, 0.0256, 0.0276, 0.0075), oct(0, yh, 0.0935, 0.0205, 0.0225, 0.006)], { tags: OCT_TAGS }), { crease: 25, shade: steel }));
  const dia = (cy, z, hx, hy) => [[0, cy + hy, z], [hx, cy, z], [0, cy - hy, z], [-hx, cy, z]];
  m.add('metal', () => fin(loft([dia(yh, -0.014, 0.0135, 0.0172), dia(yh, -0.034, 0.0106, 0.0136), dia(yh - 0.003, -0.066, 0.0074, 0.0096), dia(yh - 0.012, -0.1, 0.0042, 0.0056), dia(yh - 0.029, -0.128, 0.0005, 0.0007)]), { crease: 20, shade: (x, y, z) => mix(mul(M.b, 0.85), M.hi, sstep(-0.05, -0.12, z) * 0.8) }));
  m.add('metal', () => fin(spike4(0.603, 0.652, 0.0092, 0.0092), { crease: 20, shade: M.b }));
  for (const y of [0.4905, 0.6065]) m.add('metal', () => fin(collar(0.0196, y, 0.0038, 0.0024, 12), { shade: brass }), X(0, 0, 0, 0, 0, 0, 1, 1, 1.09));
  const stud = fin(lathe([[0.0074, 0], [0, 0.0085]], 4, { cap: false }), { crease: 20, shade: M.hi });
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) m.add('metal', stud, X(90, 0, 0, sx * 0.0096, yh + sy * 0.0105, 0.0932), 1);
  // gilt inlay on the cheeks of the socket
  m.both('metal', fin(plate([[-0.006, -0.036], [0.006, -0.036], [0.009, 0], [0.006, 0.036], [-0.006, 0.036], [-0.009, 0]], { th: 0.0012, bevel: 0.001, edge: 0.0006 }), { shade: brass }), X(0, -90, 0, 0.0196, yh, 0), 1);
  m.both('metal', fin(rivet(0.003, 6), { shade: M.hi }), X(0, 0, -90, 0.0206, yh, 0), 0);
  addLangets(m, 'metal', 0.35, 0.494, 0.0114, 0.011, M, Br.b, 3);
  addLathe(m, 'metal', [[0.0124, -0.09], [0.0148, -0.094], [0.0148, -0.106], [0.0165, -0.11], [0.0165, -0.118], [0.0095, -0.126], [0, -0.128]], 12, brass);
  addGrip(m, [[0.0138, -0.088], [0.0138, 0.075]], 0x5a2a1e, { sx: 1, turns: 13 });
  m.add('metal', fin(collar(0.0142, 0.079, 0.003, 0.0016, 12), { shade: brass }), null, 1);
  return m;
}

/** bumps on a gnarled pole: [angle, y, height, angular width, length] */
const knotFn = (list) => (y, ang) => {
  let s = 0;
  for (const [a, ky, A, wa = 0.7, wy = 0.03] of list) { let d = Math.abs(ang - a) % (Math.PI * 2); if (d > Math.PI) d = Math.PI * 2 - d; s += A * Math.exp(-(d * d) / (wa * wa) - ((y - ky) * (y - ky)) / (wy * wy)); }
  return s;
};
/** gnarled wood: grain plus dark furrows, worn-pale ridges and a dark eye in every knot (kn(y, angle) from knotFn) */
function gnarlShade(hex, path, rfn, seed = 0, kn = null) {
  const g = woodShade(hex, { seed, f: 60 });
  return (x, y, z) => {
    const c = path(y), dx = x - c[0], dz = z - c[2], k = Math.hypot(dx, dz) / rfn(y);
    const eye = kn ? sstep(0.1, 0.22, kn(y, Math.atan2(-dz, dx) + Math.PI * 2)) : 0;
    return mul(g(x, y, z), clamp(0.5 + (k - 0.88) * 2.6, 0.42, 1.4) * (1 - 0.5 * eye));
  };
}

function club(kind, o) {
  const m = new Model(), Ir = metalRamp(o.tint ?? 0x565a62), dark = fitShade(Ir);
  const env = (y) => sstep(0.08, 0.3, y);
  const path = (y) => [0.005 * Math.sin(y * 7 + 1) * env(y), y, 0.007 * Math.sin(y * 5.3) * env(y)];
  const rf = (y) => (0.0136 + 0.0056 * (1 - sstep(-0.088, -0.058, y)) + 0.039 * sstep(0.08, 0.5, y)) * (y > 0.56 ? Math.sqrt(Math.max(0.02, 1 - ((y - 0.56) / 0.068) ** 2)) : 1) * (y < -0.08 ? Math.sqrt(Math.max(0.05, 1 - ((-0.08 - y) / 0.012) ** 2)) : 1);
  const bands = [0.36, 0.515];
  const kn = knotFn([[0.6, 0.3, 0.2], [2.5, 0.44, 0.24], [4.3, 0.27, 0.16], [5.4, 0.45, 0.2], [1.5, 0.59, 0.2, 0.8, 0.03], [3.6, 0.585, 0.22, 0.7, 0.03], [0.2, 0.17, 0.14, 0.9, 0.02]]);
  const rfn = (y, a) => {
    const h = 0.2 + 0.8 * env(y);
    let k = 1 + h * (0.36 * (fbm3(Math.cos(a) * 1.6 + 5, y * 8, Math.sin(a) * 1.6 + 2, 3) - 0.5) + 0.07 * Math.sin(a * 7 + y * 26) * sstep(0.2, 0.5, y)) + kn(y, a);
    for (const b of bands) k = lerp(k, 1, 1 - sstep(0.012, 0.022, Math.abs(y - b)));
    return k;
  };
  addShaft(m, -0.092, 0.628, rf, 0x6f4d2e, { path, rfn, hi: 56, radial: 16, lo: 12, radialLo: 8, deflate: 0.0012, shade: gnarlShade(0x7a5532, path, rf, 2, kn) });
  for (const b of bands) {
    const c = path(b), r = rf(b) + 0.0022;
    m.add('iron', () => fin(lathe([[r - 0.003, b - 0.0135], [r, b - 0.011], [r + 0.0012, b], [r, b + 0.011], [r - 0.003, b + 0.0135]], 14, { cap: false, tags: (i) => (i === 0 || i === 3 ? 1 : 0) }), { crease: 30, shade: dark }), AT(c[0], 0, c[2]));
    const st = () => fin(lathe([[0.0078, 0], [0.0078, 0.002], [0, 0.021]], 4, { cap: false }), { crease: 20, shade: (x, y) => mix(Ir.b, Ir.hi, sstep(0.004, 0.02, y)) });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + b * 9; m.add('iron', st, X(0, (a / DEG), -90, c[0] + Math.cos(a) * r, b, c[2] - Math.sin(a) * r)); }
  }
  addGrip(m, [[0.0149, -0.056], [0.0149, 0.062]], 0x3b2a1f, { sx: 1, turns: 9 });
  m.add('leather', fin(tube(smooth([[0, -0.07, 0.014], [0.004, -0.1, 0.03], [0, -0.135, 0.016], [-0.004, -0.1, 0.002], [0, -0.07, -0.014]], 14), 0.0026, { radial: 5 }), { shade: 0x4a3324 }), null, 1);
  return m;
}

function spear(kind, o) {
  const m = new Model(), M = metalRamp(o.tint ?? STEEL), Br = metalRamp(BRASS), Ir = metalRamp(o.tint ? mul(lin(o.tint), 0.6) : IRON), dark = fitShade(Ir);
  addShaft(m, -0.365, 0.84, () => 0.0118, ASH, { seed: 1 });
  const s = {
    y0: 0.944, y1: 1.15, tip: 0.3,
    w: (t) => (t < 0.3 ? lerp(0.0088, 0.031, sstep(0, 0.3, t)) : 0.031 * Math.max(0, 1 - ((t - 0.3) / 0.7) ** 1.55)),
    th: (t) => { const T = 0.0088 * (1 - 0.72 * t); return [T * 0.2, T * 0.5, T]; },
    bw: (t) => 0.0066 * (1 - 0.4 * t), fw: (t) => 0.0036 * (1 - 0.5 * t),
  };
  m.add('metal', fin(bladeMB(s, stopsOf(5, 0.3, 12)), { crease: 13, shade: bladeShade(M, s) }), null, 1);
  m.add('metal', () => fin(bladeMB(s, stopsOf(2, 0.3, 5)), { crease: 13, shade: bladeShade(M, s), deflate: 0.0005 }));
  m.add('metal', () => fin(lathe([[0.0125, 0.83], [0.0152, 0.834], [0.0152, 0.843], [0.0138, 0.847], [0.0104, 0.93], [0.0126, 0.935], [0.0126, 0.943], [0.0088, 0.95]], 10, { tags: (i) => (i === 1 || i === 5 ? 1 : 0) }), { shade: fitShade(M) }));
  addLangets(m, 'metal', 0.655, 0.833, 0.0108, 0.0095, M, Br.b, 4);
  addLathe(m, 'iron', [[0.0118, -0.335], [0.0142, -0.34], [0.0142, -0.37], [0.0124, -0.375], [0.008, -0.41], [0, -0.455]], 10, dark);
  addGrip(m, [[0.0132, -0.06], [0.0132, 0.075]], 0x4a2f1c, { sx: 1, turns: 10 });
  // horsehair tassel under the socket
  const red = lin(o.color ?? 0xa32a20);
  m.add('cloth', () => fin(tube([[0, 0.85, 0], [0, 0.838, 0], [0, 0.812, 0], [0, 0.786, 0], [0, 0.772, 0]], [0.0158, 0.02, 0.0235, 0.0225, 0.015], { radial: 12, rfn: (t, a) => 1 + 0.3 * t * Math.cos(a * 6) }), { crease: 60, shade: (x, y, z) => mul(red, (0.5 + 0.65 * noise3(x * 400, y * 30, z * 400)) * (0.7 + 0.3 * sstep(0.85, 0.78, y))) }));
  m.add('cord', fin(collar(0.0162, 0.848, 0.0042, 0.0014, 8), { shade: CORD }), null, 1);
  return m;
}

function lance(kind, o) {
  const m = new Model(), M = metalRamp(o.tint ?? STEEL), Br = metalRamp(GOLD);
  const A = lin(o.color ?? 0xa62a22), B = lin(0xe9dfc6);
  // spiral-painted shaft: the quads follow the twist so the stripes stay crisp
  const y0 = 0.118, y1 = 1.478, rAt = (y) => lerp(0.0285, 0.0118, ((y - y0) / (y1 - y0)) ** 0.8);
  const mk = (n) => { const pts = []; for (let i = 0; i <= n; i++) pts.push([0, lerp(y0, y1, i / n), 0]); return tube(pts, (t) => rAt(lerp(y0, y1, t)), { radial: 8, twist: FAR ? 0 : Math.PI * 2 * 4.5, tags: (t, j) => (j % 4 < 2 ? 0 : 1) }); };
  const paint = (x, y, z, nx, ny, nz, tag) => mul(tag ? B : A, 0.82 + 0.3 * wear(x, y * 0.3, z, 50));
  m.add('paint', fin(mk(64), { crease: 60, shade: paint }), null, 1);
  m.add('paint', () => fin(mk(FAR ? 4 : 40), { crease: 60, shade: paint, deflate: FAR ? 0.004 : 0.002 }));
  m.add('paint', () => fin(lathe([[0, -0.372], [0.0115, -0.37], [0.0165, -0.36], [0.0178, -0.3], [0.0258, -0.13], [0.028, -0.088], [0.0245, -0.064], [0.0136, -0.052], [0.0136, 0.05], [0.0215, 0.062], [0.0285, 0.088], [0.0285, 0.12]], 10), { shade: (x, y, z) => mul(A, 0.8 + 0.32 * wear(x, y * 0.3, z, 50)) }));
  m.add('metal', fin(collar(0.0182, -0.3, 0.004, 0.0016, 10), { shade: fitShade(Br) }), null, 1);
  addGrip(m, [[0.0146, -0.05], [0.0146, 0.048]], 0x33231a, { sx: 1, turns: 8 });
  // vamplate: a steel cone guarding the hand, brass rolled rim
  m.add('metal', fin(lathe([[0.0292, 0.146], [0.032, 0.146], [0.074, 0.083], [0.0795, 0.08], [0.0808, 0.0755], [0.0782, 0.0715], [0.0735, 0.0725], [0.0292, 0.132]], 14, { cap: false, tags: (i) => (i >= 2 && i <= 5 ? 1 : 0) }),
    { crease: 40, shade: (x, y, z, nx, ny, nz, tag) => (tag ? mix(Br.b, Br.hi, 0.3) : mul(M.b, 0.8 + 0.3 * wear(x, y, z, 60))) }));
  const rv = fin(rivet(0.0028, 6), { shade: Br.b });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, r = 0.058; m.add('metal', rv, X(0, a / DEG, -56, Math.cos(a) * r, 0.1085, -Math.sin(a) * r), 0); }
  // head
  m.add('metal', () => fin(lathe([[0.0118, 1.47], [0.014, 1.474], [0.014, 1.483], [0.0118, 1.487], [0.0092, 1.528]], 10), { shade: fitShade(M) }));
  m.add('metal', () => fin(spike4(1.522, 1.6, 0.0105, 0.0105), { crease: 20, shade: (x, y) => mix(mul(M.b, 0.9), M.hi, sstep(1.54, 1.6, y) * 0.7) }));
  // pennon: two tongues streaming back from the shaft
  const tongue = (sgn) => {
    const mb = new MB(), nu = 12, nv = 3, yc = 1.36, h = 0.062, L = 0.3, rows = [];
    for (let j = 0; j <= nv; j++) {
      const row = [];
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv, split = sstep(0.5, 1, u);
        const inner = sgn * split * h * 0.55, outer = sgn * h * (1 - 0.28 * u);
        const y = yc + lerp(inner, outer, v) - 0.03 * u * u;
        row.push(mb.v(0.014 * Math.sin(u * 8.5 + 0.6) * u + 0.004 * Math.sin(u * 21) * u, y, -(rAt(yc) * 0.6 + u * L * (1 - 0.06 * Math.abs(v - 0.3)))));
      }
      rows.push(row);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) mb.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i], j === nv - 1 ? 1 : 0);
    return mb;
  };
  const cloth = (x, y, z, nx, ny, nz, tag) => mul(tag ? B : A, 0.72 + 0.4 * noise3(z * 26, y * 9, x * 40));
  m.add('cloth', () => fin(tongue(1), { open: true, crease: 80, shade: cloth }));
  m.add('cloth', () => fin(tongue(-1), { open: true, crease: 80, shade: cloth }));
  for (const y of [1.305, 1.36, 1.415]) m.add('cord', fin(collar(rAt(y) + 0.0004, y, 0.003, 0.0012, 8), { shade: CORD }), null, 1);
  return m;
}

function staff(kind, o) {
  const m = new Model(), Br = metalRamp(BRASS), gem = lin(o.gem ?? 0x2a8fe6);
  const env = (y) => sstep(0.08, 0.25, Math.abs(y));
  const path = (y) => [0.007 * Math.sin(y * 6 + 0.5) * env(y), y, 0.008 * Math.sin(y * 4.4 + 2) * env(y)];
  const rf = (y) => lerp(0.0128, 0.0165, sstep(-0.4, 0.8, y));
  const kn = knotFn([[1, -0.22, 0.42, 0.7, 0.022], [4, 0.2, 0.5, 0.7, 0.024], [2.4, 0.42, 0.42, 0.6, 0.02], [5.5, 0.6, 0.46, 0.7, 0.024], [0.7, 0.74, 0.4, 0.7, 0.02], [3.2, -0.08, 0.3, 0.6, 0.018]]);
  const rfn = (y, a) => 1 + (0.25 + 0.75 * env(y)) * (0.26 * (fbm3(Math.cos(a) * 1.5 + 1, y * 7, Math.sin(a) * 1.5 + 8, 3) - 0.5) + 0.09 * Math.sin(a * 4 + y * 22)) + kn(y, a);
  const top = path(0.86);
  addShaft(m, -0.4, 0.845, rf, 0x5c4028, { path, rfn, hi: 62, radial: 12, lo: 12, radialLo: 6, deflate: 0.0012, shade: gnarlShade(0x6a4a2c, path, rf, 4, kn) });
  // burl where the shaft opens into the cage
  const burl = (seg, n) => { const pr = []; for (let i = 0; i <= n; i++) { const u = i / n; pr.push([0.0165 + 0.0105 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.9 - 0.006 * u, 0.835 + 0.07 * u]); } return lathe(pr, seg); };
  const bsh = gnarlShade(0x6a4a2c, () => top, () => 0.022, 4);
  m.add('wood', fin(burl(12, 6).warp((x, y, z) => { const k = 1 + 0.2 * (fbm3(x * 60, y * 40, z * 60, 2) - 0.5); return [x * k, y, z * k]; }), { crease: 60, shade: bsh }), AT(top[0], 0, top[2]), 1);
  m.add('wood', () => fin(burl(6, 3), { crease: 60, shade: bsh, deflate: 0.0012 }), AT(top[0], 0, top[2]));
  // four root-like prongs twist up around the crystal and close above it
  const wsh = woodShade(0x7a5a36, { seed: 9, f: 90 });
  for (let k = 0; k < 4; k++) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10, a = (k * 90 + 20 + 70 * u) * DEG, rho = 0.008 + 0.035 * Math.sin(Math.PI * Math.min(1, u * 1.08)) ** 0.8;
      pts.push([top[0] + Math.cos(a) * rho, 0.878 + 0.185 * u ** 0.92, top[2] + Math.sin(a) * rho]);
    }
    const rad = [0.0112, 0.0102, 0.0092, 0.0082, 0.0073, 0.0064, 0.0056, 0.0048, 0.004, 0.0032, 0.0018];
    m.add('wood', fin(tube(smooth(pts, 22), rad, { radial: 7, rfn: (t, a) => 1 + 0.18 * Math.sin(a * 3 + t * 20) }), { crease: 50, shade: wsh }), null, 1);
    m.add('wood', () => fin(tube(smooth(pts, 7), rad, { radial: 4 }), { crease: 50, shade: wsh, deflate: 0.0008 }));
  }
  // crystal: a long faceted point, lit from within
  const cy = 0.968, cr = 0.0255;
  const ring6 = (y, r, rot) => ngon(0, 0, r, 6, rot).map(([x, z]) => [top[0] + x, y, top[2] + z]);
  m.add('gem', () => fin(loft([ring6(cy - 0.056, 0.0004, 0.3), ring6(cy - 0.024, cr * 0.9, 0.3), ring6(cy + 0.016, cr, 0.3), ring6(cy + 0.062, 0.0004, 0.3)]), {
    crease: 1, shade: (x, y, z, nx, ny, nz) => mix(mul(gem, 0.3), mix(gem, WHITE, 0.12), clamp(0.5 + 0.5 * (nx * 0.5 + ny * 0.8 + nz * 0.3)) ** 1.4),
  }));
  m.add('metal', () => fin(lathe([[0.0178, 0.826], [0.0204, 0.829], [0.0204, 0.84], [0.0178, 0.843]], 12, { cap: false }), { shade: fitShade(Br) }), AT(top[0], 0, top[2]));
  m.add('metal', () => fin(lathe([[0.0126, -0.4], [0.015, -0.396], [0.015, -0.415], [0.0125, -0.432], [0.008, -0.44], [0, -0.441]], 10), { shade: fitShade(metalRamp(IRON)) }), AT(path(-0.4)[0], 0, path(-0.4)[2]));
  addGrip(m, [[0.0158, -0.062], [0.0162, 0.075]], 0x47301f, { sx: 1, turns: 9 });
  // charms on a cord below the cage
  m.add('cord', fin(collar(0.0182, 0.812, 0.0034, 0.0014, 8), { shade: CORD }), AT(top[0], 0, top[2]), 1);
  for (const [a, len, col] of [[0.6, 0.05, BONE], [2.4, 0.07, 0x9a2d24], [4.3, 0.04, BONE]]) {
    const px = top[0] + Math.cos(a) * 0.019, pz = top[2] + Math.sin(a) * 0.019;
    m.add('cord', fin(tube([[px, 0.812, pz], [px + Math.cos(a) * 0.004, 0.812 - len, pz + Math.sin(a) * 0.004]], 0.0012, { radial: 4 }), { shade: CORD }), null, 1);
    m.add('bone', fin(lathe([[0, -0.007], [0.0042, -0.004], [0.0048, 0], [0.0036, 0.004], [0, 0.0065]], 6), { shade: col }), AT(px + Math.cos(a) * 0.004, 0.812 - len - 0.004, pz + Math.sin(a) * 0.004), 1);
  }
  return m;
}

// ---------------------------------------------------------------- bows, sling, claws
function longbow(kind, o) {
  const m = new Model();
  // a strung self bow seen from the side: back toward +Z (the target), string behind the grip
  const half = [[0, 0, 0], [0, 0.06, 0], [0, 0.14, -0.007], [0, 0.24, -0.03], [0, 0.33, -0.064], [0, 0.4, -0.097], [0, 0.44, -0.113], [0, 0.462, -0.112], [0, 0.48, -0.1]];
  const pts = [...half.slice(1).reverse().map(([x, y, z]) => [x, -y, z]), ...half];
  const rAt = (y) => { const a = Math.abs(y); return (a < 0.05 ? 0.0128 : lerp(0.0122, 0.0048, sstep(0.05, 0.48, a) ** 0.9 * 0.5 + 0.5 * ((a - 0.05) / 0.43))) * (1 - 0.55 * sstep(0.468, 0.48, a)); };
  const heart = lin(0x8a4f26), sap = lin(0xd9b77c), horn = lin(0x2c2622), hornTip = lin(0xd8cdb0), lea = lin(0x3c2a1c);
  const mk = (n, radial) => {
    const path = smooth(pts, n);
    return { path, mb: tube(path, path.map((q) => rAt(q[1])), { radial, squash: [1.12, 0.84], tags: (t) => { const y = Math.abs(t - 0.5) * 2; return y > 0.945 ? 2 : y < 0.105 ? 1 : 0; } }) };
  };
  const shade = (x, y, z, nx, ny, nz, tag) => {
    if (tag === 2) return mix(horn, hornTip, sstep(0.455, 0.478, Math.abs(y)));
    if (tag === 1) return mul(lea, 0.8 + 0.4 * wear(x, y, z, 100));
    const g = 0.72 + 0.4 * noise3(x * 150 + 4, y * 5, z * 150);
    return mul(mix(heart, sap, sstep(-0.1, 0.45, nz)), g);
  };
  m.add('wood', fin(mk(73, 10).mb, { crease: 60, shade }), null, 1);
  m.add('wood', () => fin(mk(21, 6).mb, { crease: 60, shade, deflate: 0.0007 }));
  // nock grooves, grip wrap, arrow pass
  for (const sg of [1, -1]) m.add('wood', fin(collar(0.0058, 0, 0.0022, 0.0012, 8), { shade: horn }), X(sg * -32, 0, 0, 0, sg * 0.463, -0.1115), 1);
  m.add('leather', fin(wrapMB(-0.05, 0.05, 9, () => 0.0122, { sx: 1.12 / 0.84, th: 0.0009 }), { crease: 40, shade: (x, y, z, nx, ny, nz, tag) => (tag === 1 ? mul(lea, 0.5) : mul(lea, 0.85 + 0.5 * wear(x, y, z, 110))) }), X(0, 0, 0, 0, 0, 0, 0.84, 1, 0.84), 1);
  m.add('bone', fin(block(0.004, 0.02, 0.012, 0.0012), { shade: BONE }), AT(-0.0142, 0.062, 0.001), 1);
  // string with a served centre
  const top = [0, 0.4655, -0.1125], sc = lin(0xe4d9b8);
  m.add('cord', fin(tube([[0, -top[1], top[2]], [0, -0.05, top[2]], [0, 0.05, top[2]], top], 0.0019, { radial: 5 }), { shade: sc }), null, 2);
  m.add('cord', fin(tube([[0, -0.048, top[2]], [0, 0.048, top[2]]], 0.0027, { radial: 6 }), { shade: mul(sc, 0.45) }), null, 1);
  return m;
}

function crossbow(kind, o) {
  // Held like a bow: the bolt flies along +Z, the top is +Y and the prod spans X, so the same
  // hand pose aims both. A turned grip drops from the tiller through the fist at the origin.
  const m = new Model(), M = metalRamp(o.tint ?? STEEL), Br = metalRamp(BRASS), Ir = metalRamp(o.tint ? mul(lin(o.tint), 0.6) : IRON);
  const steel = fitShade(M), brass = fitShade(Br), yt = 0.052; // tiller centre height
  const grainZ = woodShade(WALNUT, { seed: 6, f: 80 }), wood = (x, y, z) => mul(grainZ(x, z, y), 1.25);
  // tiller
  const st = [[-0.2, 0.0105, 0.021, yt - 0.009], [-0.192, 0.0125, 0.0238, yt - 0.009], [-0.16, 0.013, 0.0225, yt - 0.007], [-0.09, 0.0132, 0.017, yt - 0.001], [-0.02, 0.0138, 0.016, yt], [0.1, 0.0138, 0.0155, yt], [0.24, 0.0128, 0.0148, yt], [0.292, 0.012, 0.014, yt], [0.3, 0.0095, 0.0115, yt]];
  m.add('wood', () => fin(loft(st.map(([z, hx, hy, cy]) => oct(0, cy, z, hx, hy, 0.0042)), { tags: OCT_TAGS }), { crease: 30, shade: wood }));
  // bolt groove and lock plates
  m.add('metal', fin(block(0.0276, 0.014, 0.07, 0.0012), { shade: brass }), AT(0, yt + 0.001, 0.052), 1);
  m.add('wood', fin(block(0.006, 0.002, 0.2, 0.0006), { shade: mul(lin(WALNUT), 0.45) }), AT(0, yt + 0.0152, 0.185), 1);
  // grip, with a brass cap
  const gp = [[0.0105, -0.046], [0.0125, -0.034], [0.012, -0.008], [0.0128, 0.012], [0.0145, 0.036]];
  m.add('wood', () => fin(lathe(gp, 10), { shade: wood }), X(0, 0, 0, 0, 0, 0, 0.86, 1, 1.05));
  m.add('metal', () => fin(lathe([[0.0108, -0.044], [0.0136, -0.047], [0.0136, -0.053], [0.009, -0.058], [0, -0.0595]], 10), { shade: brass }), X(0, 0, 0, 0, 0, 0, 0.86, 1, 1.05));
  for (const y of [-0.03, -0.012, 0.006, 0.024]) m.add('wood', fin(collar(profFn(gp)(y) - 0.0003, y, 0.0022, 0.0011, 10), { shade: mul(lin(WALNUT), 0.7) }), X(0, 0, 0, 0, 0, 0, 0.86, 1, 1.05), 1);
  // trigger and its guard
  m.add('metal', () => fin(tube(smooth([[0, 0.037, 0.03], [0, 0.022, 0.033], [0, 0.008, 0.028], [0, -0.002, 0.021]], 8), [0.0034, 0.003, 0.0026, 0.002], { radial: 5, squash: [0.7, 1] }), { shade: steel }));
  m.add('metal', fin(tube(smooth([[0, 0.037, 0.058], [0, 0.012, 0.056], [0, -0.012, 0.04], [0, -0.016, 0.018]], 10), 0.0022, { radial: 4 }), { shade: brass }), null, 1);
  // prod: a spanned steel bow lashed to the front of the tiller
  const pz = 0.262, prodPath = (n) => { const out = []; for (let i = 0; i <= n; i++) { const u = (i / n) * 2 - 1, a = Math.abs(u); out.push([u * 0.205, yt + 0.001, pz - 0.085 * a ** 1.9 + 0.012 * sstep(0.86, 1, a)]); } return out; };
  const prodR = (t) => lerp(0.0165, 0.0075, Math.abs(t - 0.5) * 2);
  const pshade = (x, y, z, nx, ny, nz) => mix(mul(M.b, 0.8 + 0.25 * wear(x, y, z, 60)), M.hi, 0.6 * sstep(0.6, 0.95, Math.abs(ny)));
  m.add('metal', fin(tube(prodPath(28), prodR, { radial: 4, phase: Math.PI / 4, squash: [1, 0.5], up: [0, 1, 0] }), { crease: 30, shade: pshade }), null, 1);
  m.add('metal', () => fin(tube(prodPath(10), prodR, { radial: 4, phase: Math.PI / 4, squash: [1, 0.5], up: [0, 1, 0] }), { crease: 30, shade: pshade, deflate: 0.0006 }));
  const lash = (dz) => fin(tube(smooth([[0.0145, yt + 0.0175, pz + 0.006 + dz], [0.0235, yt, pz + 0.011 + dz], [0.0145, yt - 0.0175, pz + 0.004 + dz], [0.0125, yt - 0.0185, pz - 0.02 + dz], [0.0145, yt, pz - 0.03 + dz], [0.0125, yt + 0.0185, pz - 0.02 + dz], [0.0145, yt + 0.0175, pz + 0.006 + dz]], 18), 0.0024, { radial: 4 }), { shade: (x, y, z) => mul(lin(CORD), 0.62 + 0.5 * noise3(x * 300, y * 300, z * 300)) });
  for (const dz of [0, -0.0052, 0.0052]) m.both('cord', lash(dz), X(0, 0, 0, dz * 0.25, 0, 0), 1);
  // nut, string and loaded bolt
  m.add('bone', () => fin(lathe([[0, -0.0085], [0.0088, -0.0085], [0.0095, -0.006], [0.0095, 0.006], [0.0088, 0.0085], [0, 0.0085]], 10), { shade: BONE }), X(0, 0, 90, 0, yt + 0.0118, 0.06));
  const tip = prodPath(2)[2], sc = lin(0xe4d9b8), nock = [0, yt + 0.0185, 0.064];
  const str = fin(tube([[tip[0] - 0.004, tip[1], tip[2] + 0.002], [nock[0] + 0.012, nock[1], nock[2]], nock], [0.0022, 0.0026, 0.0026], { radial: 5 }), { shade: sc });
  m.both('cord', str, null, 2);
  const by = yt + 0.0195;
  m.add('wood', () => fin(tube([[0, by, 0.068], [0, by, 0.345]], 0.0036, { radial: 6 }), { shade: lin(0xb89868) }));
  m.add('metal', () => fin(spike4(0, 0.045, 0.0062, 0.0062), { crease: 20, shade: (x, y) => mix(M.b, M.hi, sstep(0.01, 0.045, y)) }), X(90, 0, 0, 0, by, 0.342));
  const vane = fin(plate([[0, 0], [0.012, 0.004], [0.012, 0.03], [0, 0.046]], { th: 0.0007, bevel: 0.0008, edge: 0.0004 }), { shade: 0x8a2c22 });
  for (const a of [35, 145]) m.add('leather', vane, new THREE.Matrix4().makeTranslation(0, by, 0.074).multiply(X(0, 0, a)).multiply(X(90, 0, 0, 0.0028, 0, 0)), 1);
  // stirrup
  m.add('iron', () => fin(tube(smooth([[-0.0105, yt, 0.292], [-0.03, yt, 0.31], [-0.034, yt, 0.345], [0, yt, 0.372], [0.034, yt, 0.345], [0.03, yt, 0.31], [0.0105, yt, 0.292]], 16), 0.0042, { radial: 5, up: [0, 1, 0] }), { shade: fitShade(Ir) }));
  // butt plate and rivets
  m.add('metal', () => fin(loft([oct(0, yt - 0.009, -0.2045, 0.0098, 0.0205, 0.004), oct(0, yt - 0.009, -0.201, 0.0118, 0.0225, 0.004), oct(0, yt - 0.009, -0.1965, 0.0131, 0.0242, 0.0042)], { tags: OCT_TAGS }), { crease: 30, shade: brass }));
  const inlay = fin(plate([[-0.013, 0], [0, 0.0048], [0.013, 0], [0, -0.0048]], { th: 0.0007, bevel: 0.0006, edge: 0.0004 }), { shade: BONE });
  for (const z of [-0.13, -0.075, 0.135, 0.2]) m.both('bone', inlay, AT(0.0137, yt - (z < 0 ? 0.004 : 0), z).multiply(YZ), 1);
  m.add('metal', fin(tube(smooth([[-0.0085, yt + 0.0152, 0.118], [-0.006, yt + 0.0248, 0.126], [0.006, yt + 0.0248, 0.126], [0.0085, yt + 0.0152, 0.118]], 8), 0.5, { radial: 4, phase: Math.PI / 4, squash: [0.0052, 0.0016], up: [0, 0, 1] }), { shade: steel }), null, 1);
  const rv = fin(rivet(0.0024, 6), { shade: Br.hi });
  for (const z of [0.028, 0.076]) m.both('metal', rv, X(0, 0, -90, 0.0139, yt + 0.001, z), 0);
  return m;
}

function sling(kind, o) {
  // drawn taut mid-swing: retention cord through the fist, two cords, and a leather cradle around a river stone
  const m = new Model(), lea = lin(0x6a4a2c), cordC = lin(0xbfae84);
  const braid = (x, y, z) => mul(cordC, 0.7 + 0.45 * (0.5 + 0.5 * Math.sin(y * 900 + x * 700)));
  m.add('cord', () => fin(tube([[0, -0.04, 0], [0, 0.034, 0]], 0.0052, { radial: 6 }), { shade: braid }));
  m.add('cord', () => fin(lathe([[0, -0.052], [0.0068, -0.049], [0.0078, -0.043], [0.005, -0.037]], 8), { shade: mul(cordC, 0.8) }));
  const sc = [0, 0.262, 0.03], R = 0.0186, end = 100 * DEG;
  // cradle: a band hooked around the far side of the stone, widest at the fold
  const rings = [];
  for (let i = 0; i <= 12; i++) {
    const u = (i / 12) * 2 - 1, a = u * end, w = 0.0165 * (1 - 0.78 * Math.abs(u) ** 1.6), cx = sc[0] + Math.sin(a) * R, cy = sc[1] + Math.cos(a) * R, ox = Math.sin(a) * 0.0018, oy = Math.cos(a) * 0.0018;
    rings.push([[cx - ox, cy - oy, sc[2] + w], [cx + ox, cy + oy, sc[2] + w * 0.9], [cx + ox, cy + oy, sc[2] - w * 0.9], [cx - ox, cy - oy, sc[2] - w]]);
  }
  m.add('cord', () => fin(loft(rings), { crease: 40, shade: (x, y, z) => mul(lea, 0.75 + 0.5 * wear(x, y, z, 120)) }));
  for (const sx of [1, -1]) {
    const ex = sc[0] + sx * Math.sin(end) * R, ey = sc[1] + Math.cos(end) * R;
    const path = smooth([[sx * 0.0025, 0.03, 0], [sx * 0.008, 0.1, 0.006], [sx * 0.014, 0.18, 0.018], [sx * 0.018, 0.235, 0.028], [ex, ey, sc[2]]], 16);
    m.add('cord', fin(tube(path, 0.0031, { radial: 5 }), { shade: braid }), null, 2);
    m.add('cord', fin(lathe([[0.0032, -0.004], [0.0056, -0.0015], [0.0056, 0.0015], [0.0032, 0.004]], 6), { shade: mul(cordC, 0.75) }), X(12, 0, sx * -6, sx * 0.0181, 0.2385, 0.0287), 1);
  }
  const stone = () => lathe([[0, -0.016], [0.0085, -0.0135], [0.0145, -0.007], [0.0165, 0.001], [0.0142, 0.009], [0.0082, 0.0145], [0, 0.016]], 10).warp((x, y, z) => { const k = 1 + 0.16 * (noise3(x * 90 + 3, y * 90, z * 90 + 7) - 0.5); return [x * k, y * k * 0.94, z * k * 1.06]; });
  m.add('cord', () => fin(stone(), { crease: 50, shade: (x, y, z) => mul(lin(0x8d8a84), 0.75 + 0.5 * wear(x, y, z, 160)) }), X(20, 30, 0, sc[0], sc[1], sc[2]));
  return m;
}

function claws(kind, o) {
  // hand at the origin, fingers along +Y, back of the hand toward +Z
  const m = new Model(), Ir = metalRamp(o.tint ?? 0x4c4f56), lea = leatherShade(0x3a2a1e);
  const boneA = lin(0x8f8468), boneB = lin(0xece3c8), tipC = o.tint ? metalRamp(o.tint) : null;
  // palm strap and riveted knuckle plate
  m.add('leather', () => fin(lathe([[0.97, -0.014], [1, -0.011], [1, 0.011], [0.97, 0.014], [0.9, 0.011], [0.9, -0.011]], 14, { cap: false }), { crease: 40, shade: lea }), X(0, 0, 0, 0, 0, 0.002, 0.037, 1, 0.027));
  const kp = () => plate([[-0.034, -0.013], [0.034, -0.013], [0.036, 0.012], [0.027, 0.033], [0.018, 0.027], [0.009, 0.036], [0, 0.029], [-0.009, 0.036], [-0.018, 0.027], [-0.027, 0.033], [-0.036, 0.012]], { th: 0.0022, bevel: 0.0018, edge: 0.0012, sub: 0.022, farTol: 0.002 }).sub(0.03).warp((x, y, z) => [x, y, z + 0.0312 - 9.5 * x * x - 0.06 * y]);
  m.add('iron', () => fin(kp(), { crease: 28, shade: fitShade(Ir) }));
  const rv = fin(rivet(0.0028, 6), { shade: Ir.hi });
  for (const x of [-0.027, 0.027]) m.add('iron', rv, X(90, 0, 0, x, -0.004, 0.0265), 1);
  // four hooked claws
  [-0.027, -0.009, 0.009, 0.027].forEach((x, i) => {
    const len = [0.9, 1.04, 1, 0.86][i], sp = x * 0.35;
    const path = smooth([[x, 0.014, 0.0295 - 9.5 * x * x], [x + sp * 0.2, 0.014 + 0.04 * len, 0.036 - 9.5 * x * x], [x + sp * 0.6, 0.014 + 0.078 * len, 0.03 - 9.5 * x * x], [x + sp, 0.014 + 0.104 * len, 0.011 - 9.5 * x * x]], 10);
    const rad = [0.0076, 0.0073, 0.0067, 0.006, 0.0052, 0.0043, 0.0033, 0.0023, 0.0012, 0.0003];
    const sh = (px, py) => { const k = sstep(0.02, 0.11, py); return tipC ? mix(tipC.b, tipC.hi, k) : mix(boneA, boneB, k * (0.75 + 0.3 * noise3(px * 500, py * 60, 3))); };
    m.add(tipC ? 'metal' : 'bone', () => fin(tube(path, rad, { radial: 6, squash: [0.62, 1], up: [1, 0, 0] }), { crease: 50, shade: sh }));
    m.add('iron', fin(collar(0.0082, 0, 0.004, 0.0014, 8), { shade: fitShade(Ir) }), X(8, 0, 0, x, 0.018, 0.0305 - 9.5 * x * x, 0.66, 1, 1), 1);
  });
  return m;
}

// ---------------------------------------------------------------- catalogue
const META = {
  sword: ['one', 'swing', 0.5], longsword: ['one', 'swing', 0.62], greatsword: ['two', 'swing', 0.85], dagger: ['one', 'thrust', 0.22],
  claws: ['none', 'claw', 0.115], spear: ['pole', 'thrust', 1.15], lance: ['pole', 'thrust', 1.6], halberd: ['pole', 'swing', 1.25],
  axe: ['one', 'swing', 0.5], greataxe: ['two', 'slam', 0.95], club: ['one', 'swing', 0.62], warhammer: ['one', 'swing', 0.62],
  staff: ['staff', 'cast', 1.05], longbow: ['bow', 'shoot', 0.85], sling: ['one', 'shoot', 0.3], crossbow: ['bow', 'shoot', 0.45],
};
const BUILD = { sword, longsword: sword, greatsword: sword, dagger: sword, axe, greataxe: axe, halberd, warhammer, club, spear, lance, staff, longbow, crossbow, sling, claws };

const CACHE = new Map();
/**
 * weapon(kind, opts) -> { prims: [], hard: [], hold, attack, length } or null for 'none'.
 * hold: one | two | pole | staff | bow | none.  attack: the animation style (see animate.js).
 * length: reach from the grip to the tip, model units.
 * opts: tint (hex: recolours the steel, e.g. rust or black iron), scale (about the grip),
 * gem (hex: the staff's crystal), color (hex: the lance's paint and pennon, the spear's tassel).
 * Every call returns fresh pieces, so the caller may move them; the geometry behind them is cached.
 */
export function weapon(kind, opts = {}) {
  const meta = META[kind];
  if (!meta) return null;
  const [hold, attack, length] = meta, scale = opts.scale ?? 1;
  const o = { ...opts }; delete o.scale;
  const key = `${kind}|${JSON.stringify(o)}`;
  let parts = CACHE.get(key);
  if (!parts) { parts = BUILD[kind](kind, o).parts(); CACHE.set(key, parts); }
  return { prims: [], hard: parts.map((p) => toHard(p, scale)), hold, attack, length: length * scale };
}

// ---------------------------------------------------------------- shields
/** clip a polygon to a convex counter-clockwise outline */
function clipPoly(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], inp = out;
    const side = (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const q = inp[j], r = inp[(j + 1) % inp.length], sq = side(q), sr = side(r);
      if (sq >= 0) out.push(q);
      if ((sq >= 0) !== (sr >= 0)) { const t = sq / (sq - sr); out.push([q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t]); }
    }
  }
  return out.filter((q, i) => { const r = out[(i + 1) % out.length]; return Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-6; });
}
/**
 * A curved board: outline in XY, front surface at z = zf(x, y), thickness T behind it. Faces are split to
 * `len` across X and len / ky along Y (ky < 1 for boards that only curve around the Y axis).
 */
function boardMB(outline, zf, T, len, ky = 1, bevel = 0.0025) {
  // far twin: a skin just behind the painted face, thick enough that tucking it inside the core cannot turn it inside out
  if (FAR) return plate(outline, { th: 0.0067, farInset: 0.004 }).warp((x, y, z) => [x, y * ky, z]).sub(len * 1.5).warp((x, y, z) => [x, y / ky, z + zf(x, y / ky) - 0.0035]);
  const mb = plate(outline, { th: T / 2, bevel, edge: T / 2 - bevel * 0.7 });
  return mb.warp((x, y, z) => [x, y * ky, z]).sub(len).warp((x, y, z) => [x, y / ky, z + zf(x, y / ky) - T / 2]);
}
/** edging swept around an outline: section points [inward distance, height above the front surface] */
function rimMB(outline, zf, section) {
  const off = section.map(([d]) => inset(outline, () => d));
  const rings = outline.map((_, i) => section.map(([, h], k) => { const q = off[k][i]; return [q[0], q[1], zf(q[0], q[1]) + h]; }));
  return loft([...rings, rings[0]], { cap0: false, cap1: false, tags: (j) => j });
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** heraldic charges as polygons in shield space; B = { w, top, bot, cx, cy } (half width, extents, centre of the charge) */
const CHARGES = {
  cross: (B) => [[[-B.w * 0.17, B.bot], [B.w * 0.17, B.bot], [B.w * 0.17, B.top], [-B.w * 0.17, B.top]], [[-B.w, B.cy - B.w * 0.17], [B.w, B.cy - B.w * 0.17], [B.w, B.cy + B.w * 0.17], [-B.w, B.cy + B.w * 0.17]]],
  pale: (B) => [[[-B.w * 0.3, B.bot], [B.w * 0.3, B.bot], [B.w * 0.3, B.top], [-B.w * 0.3, B.top]]],
  fess: (B) => [[[-B.w, B.cy - B.w * 0.3], [B.w, B.cy - B.w * 0.3], [B.w, B.cy + B.w * 0.3], [-B.w, B.cy + B.w * 0.3]]],
  chief: (B) => [[[-B.w, B.top - (B.top - B.bot) * 0.3], [B.w, B.top - (B.top - B.bot) * 0.3], [B.w, B.top], [-B.w, B.top]]],
  bend: (B) => { const t = B.w * 0.24, h = B.w * 1.25; return [[[-B.w - t, B.cy + h], [-B.w + t, B.cy + h + t], [B.w + t, B.cy - h], [B.w - t, B.cy - h - t]]]; },
  saltire: (B) => { const t = B.w * 0.2, h = B.w * 1.25; return [[[-B.w - t, B.cy + h], [-B.w + t, B.cy + h + t], [B.w + t, B.cy - h], [B.w - t, B.cy - h - t]], [[B.w + t, B.cy + h], [B.w - t, B.cy + h + t], [-B.w - t, B.cy - h], [-B.w + t, B.cy - h - t]]]; },
  chevron: (B) => { const t = B.w * 0.42, a = B.cy + B.w * 0.55; return [[[0, a], [B.w * 1.1, a - B.w * 1.1], [B.w * 1.1, a - B.w * 1.1 - t], [0, a - t], [-B.w * 1.1, a - B.w * 1.1 - t], [-B.w * 1.1, a - B.w * 1.1]]]; },
  pile: (B) => [[[-B.w * 0.62, B.top], [0, B.bot + (B.top - B.bot) * 0.22], [B.w * 0.62, B.top]]],
  quarter: (B) => [[[-B.w, B.cy], [0, B.cy], [0, B.top], [-B.w, B.top]], [[0, B.bot], [B.w, B.bot], [B.w, B.cy], [0, B.cy]]],
  lozenge: (B) => [[[0, B.cy - B.w * 0.8], [B.w * 0.55, B.cy], [0, B.cy + B.w * 0.8], [-B.w * 0.55, B.cy]]],
  roundel: (B) => [ngon(B.cx, B.cy, B.w * 0.5, 20)],
  sun: (B) => { const out = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2 + Math.PI / 2, r = B.w * (i % 2 ? 0.34 : i % 4 ? 0.56 : 0.72); out.push([B.cx + Math.cos(a) * r, B.cy + Math.sin(a) * r]); } return [out]; },
  star: (B) => { const out = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = B.w * (i % 2 ? 0.27 : 0.68); out.push([B.cx + Math.cos(a) * r, B.cy + Math.sin(a) * r]); } return [out]; },
};
function deviceOf(opts, field, fallback) {
  let d = opts.device, kind = fallback, color = null;
  if (d === false || d === 'none' || d === 'plain') kind = null;
  else if (typeof d === 'string' && CHARGES[d]) kind = d;
  else if (typeof d === 'number') color = d;
  else if (d && typeof d === 'object') { if (d.kind === 'none' || d.kind === false) kind = null; else if (CHARGES[d.kind]) kind = d.kind; color = d.color ?? null; }
  if (color == null && opts.deviceColor != null) color = opts.deviceColor;
  if (color == null) {
    const mx = Math.max(...field), mn = Math.min(...field), sat = mx > 0 ? (mx - mn) / mx : 0;
    color = lum(field) > 0.32 ? 0x8a1d1a : sat > 0.45 ? 0xe2b43c : 0xe8dfc4; // colour on metal, metal on colour
  }
  return { kind, color: lin(color) };
}
/** painted boards: the field colour, scuffed and chipped back to bare wood toward the edges; planks on the back */
function boardShade(field, o) {
  const woodC = lin(o.wood ?? 0x8a6a44), backC = lin(o.back ?? 0x6e5234), dist = o.dist, pw = o.plank ?? 0.052;
  return (x, y, z, nx, ny, nz, tag) => {
    if (tag) return mul(backC, 0.7);
    const pl = x / pw + 31.5, pi = Math.floor(pl), pf = pl - pi, pv = 0.86 + 0.28 * noise3(pi * 7.3, 2.1, o.seed ?? 0), seam = Math.min(pf, 1 - pf) < 0.06 ? 0.55 : 1;
    if (nz < 0) return mul(backC, pv * seam * (0.8 + 0.35 * noise3(x * 160, y * 9, 4)));
    const n = wear(x, y, 0.3, 30), fine = wear(x, y, 1.7, 110), edge = dist ? 1 - sstep(0.004, 0.06, dist(x, y)) : 0;
    const chip = sstep(0.7, 0.74, n * 0.55 + fine * 0.45 + 0.2 * edge * edge - 0.06 * (1 - edge));
    const paint = mul(field, (0.74 + 0.42 * n) * (0.86 + 0.16 * sstep(-0.3, 0.2, y)) * (1 - 0.3 * edge) * (o.planked ? pv * (seam < 1 ? 0.7 : 1) : 1));
    return mix(paint, mul(woodC, 0.7 + 0.45 * fine), chip * 0.6);
  };
}
/** points spaced evenly along a closed outline */
function walk(O, step) {
  let total = 0;
  for (let i = 0; i < O.length; i++) { const q = O[(i + 1) % O.length]; total += Math.hypot(q[0] - O[i][0], q[1] - O[i][1]); }
  const n = Math.max(3, Math.round(total / step)), out = [];
  let acc = 0, next = 0;
  for (let i = 0; i < O.length && out.length < n; i++) {
    const a = O[i], b = O[(i + 1) % O.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next <= acc + d && out.length < n) { const t = (next - acc) / (d || 1); out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); next += total / n; }
    acc += d;
  }
  return out;
}
/** distance from a point to a closed outline */
const outlineDist = (O) => (x, y) => {
  let best = 1e9;
  for (let i = 0, j = O.length - 1; i < O.length; j = i++) { const ax = O[j][0], ay = O[j][1], dx = O[i][0] - ax, dy = O[i][1] - ay, t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)); best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t)); }
  return best;
};
/** raised painted charges over a board: a face and a skirt, no underside */
function addDevice(m, dev, B, clip, zf, len, ky = 1) {
  if (!dev.kind) return;
  for (const poly of CHARGES[dev.kind](B)) {
    const c = clipPoly(ccw(poly), clip);
    if (c.length < 3 || Math.abs(area2(c)) < 1e-5) continue;
    m.add('paint', () => {
      const mb = new MB(), top = c.map((q) => mb.v(q[0], q[1] * ky, 0.004)), low = c.map((q) => mb.v(q[0], q[1] * ky, -0.002));
      for (const [a, b, d] of THREE.ShapeUtils.triangulateShape(c.map((q) => new THREE.Vector2(q[0], q[1])), [])) {
        if ((c[b][0] - c[a][0]) * (c[d][1] - c[a][1]) - (c[d][0] - c[a][0]) * (c[b][1] - c[a][1]) > 0) mb.tri(top[a], top[b], top[d]); else mb.tri(top[a], top[d], top[b]);
      }
      if (!FAR) for (let j = 0; j < c.length; j++) { const k = (j + 1) % c.length; mb.quad(low[j], low[k], top[k], top[j], 1); }
      mb.sub(len * (FAR ? 2.4 : 1)).warp((x, y, z) => [x, y / ky, z + zf(x, y / ky)]);
      return fin(mb, { open: true, crease: 50, shade: (x, y, z, nx, ny, nz, tag) => mul(dev.color, (tag ? 0.6 : 0.82) + 0.28 * wear(x, y, 0.5, 30)) });
    });
  }
}
/** a boss: lathe profile [[radius, height], ...] standing on the board at (x, y) */
const bossAt = (prof, seg, x, y, zf, o = {}) => ({ mb: () => lathe(prof, seg, { cap: false, ...o }), m: X(90, 0, 0, x, y, zf(x, y)) });
/** rivet heads standing on a curved board */
function studs(m, finish, pts, zf, r, shade, lod = 1, seg = 6, lift = 0) {
  const rv = fin(rivet(r, seg), { shade });
  for (const [x, y] of pts) { const e = 1e-3, sl = (zf(x + e, y) - zf(x - e, y)) / (2 * e); m.add(finish, rv, X(90, 0, Math.atan(sl) / DEG, x, y, zf(x, y) + lift), lod); }
}
/** leather strap arching off the back of the board between two anchor points */
function strapMB(a, b, zf, T, rise, w = 0.013) {
  const pts = [];
  for (let i = 0; i <= 8; i++) { const u = i / 8, x = lerp(a[0], b[0], u), y = lerp(a[1], b[1], u); pts.push([x, y, zf(x, y) - T - 0.001 - rise * Math.sin(Math.PI * u) ** 0.7]); }
  return tube(pts, 0.5, { radial: 4, phase: Math.PI / 4, squash: [w, 0.0032], up: [b[1] - a[1], -(b[0] - a[0]), 0] });
}

function buildShield(shape, o) {
  const m = new Model(), field = lin(o.color ?? 0x7a5a3a), M = metalRamp(o.metal ?? 0xb4bac2), Br = metalRamp(BRASS), Ir = metalRamp(o.metal ?? 0x565a62);
  const steel = (x, y, z, nx, ny, nz, tag) => mul(tag % 2 ? M.hi : M.b, 0.82 + 0.3 * wear(x, y, z, 60));
  const iron = (x, y, z, nx, ny, nz, tag) => mul(tag % 2 ? mix(Ir.b, Ir.hi, 0.6) : Ir.b, 0.8 + 0.34 * wear(x, y, z, 60));
  const brass = (x, y, z) => mul(Br.b, 0.8 + 0.34 * wear(x, y, z, 90));
  const lea = leatherShade(0x4a3020);
  const T = 0.012;
  if (shape === 'buckler') {
    // all steel: domed boss, painted fluted field, rolled rim
    const R = 0.108, prof = [[0, 0.046], [0.012, 0.0445], [0.024, 0.04], [0.034, 0.032], [0.041, 0.021], [0.044, 0.011], [0.05, 0.008], [0.056, 0.0085], [0.06, 0.0115], [0.092, 0.0065], [0.097, 0.0085], [0.103, 0.0098], [R, 0.007], [R, 0.002], [0.1, -0.002], [0.05, 0.001], [0, 0.003]];
    const sh = (x, y, z, nx, ny, nz, tag) => (tag === 1 ? mul(field, 0.8 + 0.34 * wear(x, y, z, 50)) : tag === 2 ? Br.b : steel(x, y, z, 0, 0, 0, 0));
    m.add('metal', fin(lathe(prof, 32, { cap: false, tags: (i) => (i === 8 ? 1 : i === 5 || i === 6 ? 2 : 0) }), { crease: 32, shade: sh }), X(90, 0, 0), 1);
    // its far twin is a plain disc and cone drawn well inside the dished core, since a coarse copy of a raised rim would show through
    m.add('metal', () => (FAR
      ? fin(lathe([[0, 0.038], [0.03, 0.029], [0.04, 0.013], [0.046, 0.0052], [0.05, 0.0048], [0.086, 0.0042], [0.098, 0.0036], [0.098, 0.0022], [0, 0.0036]], 8, { cap: false, asIs: true, tags: (i) => (i === 4 ? 1 : 0) }), { crease: 32, shade: sh, farDeflate: 0 })
      : fin(lathe(prof, 16, { cap: false, tags: (i) => (i === 8 ? 1 : 0) }), { crease: 32, shade: sh, deflate: 0.0012 })), X(90, 0, 0));
    studs(m, 'metal', ngon(0, 0, 0.076, 8, 0.39), (x, y) => 0.0092 - 0.16 * (Math.hypot(x, y) - 0.06), 0.004, Br.hi, 1);
    m.add('leather', fin(tube([[0, -0.07, -0.004], [0, -0.03, -0.03], [0, 0.03, -0.03], [0, 0.07, -0.004]], 0.5, { radial: 6, squash: [0.011, 0.0075], up: [1, 0, 0] }), { shade: lea }), null, 1);
    return m;
  }
  let O, zf, dflt, B, bossY = 0, pw = 0.052;
  if (shape === 'round') {
    O = ngon(0, 0, 0.2, 44); zf = (x, y) => -0.5 * (x * x + y * y); dflt = 'quarter'; B = { w: 0.2, top: 0.2, bot: -0.2, cx: 0, cy: 0 }; pw = 0.4 / 7;
  } else if (shape === 'tower') {
    const r = 0.035, w = 0.152, h = 0.31, pts = [];
    for (const [cx, cy, a0] of [[w - r, -h + r, -90], [w - r, h - r, 0], [-w + r, h - r, 90], [-w + r, -h + r, 180]]) for (let i = 0; i <= 5; i++) { const a = (a0 + i * 18) * DEG; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    const ex = [];
    pts.forEach((q, i) => { const n = pts[(i + 1) % pts.length]; ex.push(q); const d = Math.hypot(n[0] - q[0], n[1] - q[1]), k = Math.floor(d / 0.07); for (let j = 1; j <= k; j++) ex.push([lerp(q[0], n[0], j / (k + 1)), lerp(q[1], n[1], j / (k + 1))]); });
    O = ex; zf = (x) => -3 * x * x; dflt = 'saltire'; B = { w: 0.152, top: 0.31, bot: -0.31, cx: 0, cy: 0 };
  } else {
    const half = smooth([[0, -0.3, 0], [0.046, -0.212, 0], [0.093, -0.1, 0], [0.129, 0.002, 0], [0.147, 0.092, 0], [0.147, 0.158, 0], [0.136, 0.193, 0], [0.1, 0.206, 0], [0.05, 0.212, 0], [0, 0.214, 0]], 23);
    O = [...half.map(([x, y]) => [x, y]), ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])];
    zf = (x) => -1.75 * x * x; dflt = 'sun'; B = { w: 0.15, top: 0.214, bot: -0.3, cx: 0, cy: 0.02 }; bossY = 0.02;
  }
  O = ccw(O);
  const dist = outlineDist(O), dev = deviceOf(o, field, dflt), lip = shape === 'tower' ? 0.019 : 0.015;
  const bs = boardShade(field, { dist, plank: pw, planked: shape === 'round', seed: shape.length });
  const lean = O.filter((q, i) => i % 2 === 0 || (shape === 'kite' && Math.abs(q[0]) < 1e-6));
  if (shape === 'round') {
    // seven butted planks, each with its own chamfer so the joints read as grooves
    for (let k = 0; k < 7; k++) {
      const x0 = -0.2 + k * pw, pl = clipPoly([[x0 + 0.0006, -0.21], [x0 + pw - 0.0006, -0.21], [x0 + pw - 0.0006, 0.21], [x0 + 0.0006, 0.21]], O);
      m.add('paint', fin(boardMB(pl, zf, T, 0.05, 1, 0.0016), { crease: 40, shade: bs }), null, 1);
    }
    m.add('paint', () => fin(boardMB(lean, zf, T, 0.12), { crease: 40, shade: bs, deflate: 0.0012 }));
  } else {
    m.add('paint', fin(boardMB(O, zf, T, shape === 'tower' ? 0.026 : 0.024, 0.7), { crease: 40, shade: bs }), null, 1);
    m.add('paint', () => fin(boardMB(lean, zf, T, 0.06, 0.2), { crease: 40, shade: bs, deflate: 0.0012 }));
  }
  addDevice(m, dev, B, inset(O, () => lip * 0.6), zf, shape === 'round' ? 0.09 : 0.034, shape === 'round' ? 1 : 0.2);
  // metal edging wrapped over the rim
  const rimFin = shape === 'kite' ? 'metal' : 'iron', rimSh = shape === 'kite' ? steel : iron;
  m.add(rimFin, fin(rimMB(O, zf, [[lip, 0.0006], [lip - 0.0025, 0.0042], [0.0035, 0.0052], [-0.003, 0.0034], [-0.0045, -T / 2], [-0.003, -T - 0.0034], [0.0035, -T - 0.005], [lip * 0.7, -T - 0.0006]]), { crease: 38, shade: rimSh }), null, 1);
  m.add(rimFin, () => fin(rimMB(lean, zf, [[lip, 0.0004], [0.002, 0.0046], [-0.0042, -T / 2], [0.002, -T - 0.0046], [lip * 0.7, -T - 0.0004]]), { crease: 38, shade: rimSh, deflate: 0.0007 }));
  const mid = inset(O, () => lip * 0.52);
  if (shape === 'kite') {
    studs(m, 'metal', walk(mid, 0.05), zf, 0.0036, Br.hi, 1, 6, 0.0044);
    // brass boss on a scalloped flange
    const b = bossAt([[0.05, 0.001], [0.05, 0.004], [0.043, 0.0058], [0.04, 0.0105], [0.036, 0.021], [0.028, 0.0305], [0.016, 0.0365], [0.0075, 0.0385], [0.006, 0.043], [0, 0.0445]], 16, 0, bossY, zf, { tags: (i) => (i < 2 ? 1 : 0) });
    m.add('metal', () => fin(b.mb(), { crease: 35, shade: (x, y, z, nx, ny, nz, tag) => (tag ? mix(Br.b, Br.lo, 0.3) : mix(mul(Br.b, 0.8 + 0.3 * wear(x, y, z, 90)), Br.hi, sstep(0.02, 0.04, y) * 0.5)) }), b.m);
    studs(m, 'metal', ngon(0, bossY, 0.0455, 8, 0.39), zf, 0.0032, M.hi, 1, 6, 0.004);
    // enarmes and arm pad on the back
    m.add('leather', fin(strapMB([-0.085, 0.07], [0.03, 0.07], zf, T, 0.034), { crease: 40, shade: lea }), null, 1);
    m.add('leather', fin(strapMB([-0.08, -0.075], [0.025, -0.075], zf, T, 0.03, 0.011), { crease: 40, shade: lea }), null, 1);
    m.add('leather', fin(plate([[-0.07, -0.11], [0.02, -0.11], [0.02, 0.1], [-0.07, 0.1]], { th: 0.003, bevel: 0.003, edge: 0.001, sub: 0.03 }).warp((x, y, z) => [x, y, z + zf(x, y) - T - 0.003]), { shade: leatherShade(0x6a4a30) }), null, 1);
  } else if (shape === 'round') {
    const b = bossAt([[0.062, 0.001], [0.062, 0.0045], [0.05, 0.0062], [0.046, 0.012], [0.042, 0.024], [0.033, 0.035], [0.019, 0.042], [0, 0.0445]], 16, 0, 0, zf, { tags: (i) => (i < 2 ? 1 : 0) });
    m.add('iron', () => fin(b.mb(), { crease: 35, shade: iron }), b.m);
    studs(m, 'iron', ngon(0, 0, 0.056, 6, 0.26), zf, 0.004, Ir.hi, 1, 6, 0.0044);
    // clamps pinching the rim, and a grip bar across the back
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.39, c = Math.cos(a), sn = Math.sin(a), r = 0.186; m.add('iron', fin(block(0.034, 0.02, T + 0.014, 0.002), { shade: iron }), X(0, 0, a / DEG, c * r, sn * r, zf(c * r, sn * r) - T / 2), 1); }
    m.add('wood', fin(block(0.03, 0.34, 0.012, 0.003), { shade: woodShade(0x5c4028) }), AT(0, 0, zf(0, 0) - T - 0.006), 1);
    m.add('leather', fin(strapMB([-0.1, 0.03], [-0.02, 0.03], zf, T, 0.03), { crease: 40, shade: lea }), null, 1);
  } else {
    // studded border, spine and a long central boss
    studs(m, 'metal', walk(inset(O, () => lip + 0.016), 0.058), zf, 0.0058, brass, 1, 6);
    m.add('iron', () => fin(plate([[-0.011, -0.288], [0.011, -0.288], [0.011, 0.288], [-0.011, 0.288]], { th: 0.003, bevel: 0.0025, edge: 0.001 }), { crease: 30, shade: iron }), AT(0, 0, 0.0025));
    const ub = [];
    for (const [y, hx, hz] of [[-0.085, 0.004, 0.001], [-0.06, 0.02, 0.014], [-0.03, 0.03, 0.03], [0, 0.033, 0.036], [0.03, 0.03, 0.03], [0.06, 0.02, 0.014], [0.085, 0.004, 0.001]]) ub.push([[-hx, y, zf(hx) + 0.002], [-hx * 0.6, y, hz * 0.75], [0, y, hz], [hx * 0.6, y, hz * 0.75], [hx, y, zf(hx) + 0.002], [0, y, -0.002]]);
    m.add('iron', () => fin(loft(ub), { crease: 30, shade: (x, y, z) => mix(mul(Ir.b, 0.85 + 0.3 * wear(x, y, z, 60)), Ir.hi, sstep(0.02, 0.036, z) * 0.6) }));
    studs(m, 'metal', [[0, -0.12], [0, 0.12], [0, -0.2], [0, 0.2], [0, -0.27], [0, 0.27]], () => 0.0055, 0.0048, brass, 1, 6);
    m.add('leather', fin(strapMB([-0.085, 0.08], [0.03, 0.08], zf, T, 0.028), { crease: 40, shade: lea }), null, 1);
    m.add('leather', fin(strapMB([-0.08, -0.07], [0.025, -0.07], zf, T, 0.026, 0.011), { crease: 40, shade: lea }), null, 1);
  }
  return m;
}

/**
 * shield(opts) -> { prims: [], hard: [] }: centre at the origin, outer face +Z, top +Y.
 * opts: color (heraldic field), shape ('kite' | 'round' | 'tower' | 'buckler'), size (scale, default 1),
 * device (charge name from CHARGES | 'none' | hex colour for the default charge | { kind, color }), metal (hex for rim and boss).
 */
export function shield(opts = {}) {
  const shape = ['kite', 'round', 'tower', 'buckler'].includes(opts.shape) ? opts.shape : 'kite';
  const o = { ...opts }; delete o.size; delete o.shape;
  const key = `shield:${shape}|${JSON.stringify(o)}`;
  let parts = CACHE.get(key);
  if (!parts) { parts = buildShield(shape, o).parts(); CACHE.set(key, parts); }
  return { prims: [], hard: parts.map((p) => toHard(p, opts.size ?? 1)) };
}
