// Buildings, fortifications, cover and scenery.
//
// Everything here is put together the way the real thing is: walls are laid stone by stone in
// courses, timber is individual beams and planks, roofs are rows of overlapping tiles. A model is
// emitted into one vertex-coloured geometry (class Geo) and drawn with the shared sculpt material,
// so a whole keep is a single draw call. Organic pieces (thatch, sandbags, the statue) are sculpted
// with the kit and merged into the same geometry.
//
//   structures[def.model](def, w, h) -> Object3D centred on its footprint, resting on y = 0
//   rubble(w, h, colorHex)           -> heap of debris for a destroyed structure
import * as THREE from 'three';
import { S, H, rgb, noise3, fbm3, buildPartGeometry, sculptMaterial } from '../sculpt.js';
import { getDetail } from '../rigkit.js';

const LEVEL_H = 0.8;   // height of one walkable level (same value as models.js; importing it would be a cycle)
const COURSE = 0.2;    // castle ashlar course: four to a level, so every walk surface lands on a joint
const DEG = Math.PI / 180, TAU = Math.PI * 2;

// surface kinds: they decide how a vertex weathers (see Geo.weather)
const K_PLAIN = 0, K_STONE = 1, K_WOOD = 2, K_PLASTER = 3, K_ROOF = 4, K_CLOTH = 5, K_LEAF = 6;
// stone edge styles
const GROOVE = 0, CORNER = 1, CUT = 2;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
function hash1(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** seeded random stream: builds must be repeatable, so nothing here ever calls Math.random() */
function rng(seed) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** translate, rotate (degrees, about X then Y then Z axes of the piece), uniform scale */
function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG, 'ZYX')), new THREE.Vector3(s, s, s));
}
/** a frame whose X axis runs from a to b, centred between them */
function along(a, b, up = [0, 1, 0]) {
  const x = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = x.length(); x.normalize();
  const u = new THREE.Vector3(up[0], up[1], up[2]);
  if (Math.abs(x.dot(u)) > 0.985) u.set(1, 0, 0);
  const z = new THREE.Vector3().crossVectors(x, u).normalize(), y = new THREE.Vector3().crossVectors(z, x);
  return { m: new THREE.Matrix4().makeBasis(x, y, z).setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), L };
}
const QUAL = { low: 0.6, medium: 0.8, high: 1, ultra: 1.2 };
const qual = () => QUAL[getDetail()] || 1;

// ---------- geometry accumulator ----------
class Geo {
  constructor() {
    this.P = []; this.N = []; this.C = []; this.A = []; this.K = []; this.I = [];
    this.n = 0; this.st = []; this.seg = { e: null, ne: null, bend: 0, up: null };
    this.rough = 0.9; this.metal = 0; this.glow = 0; this.kind = K_PLAIN; this.shades = [];
  }
  // A vertex passes through a chain of segments, innermost first: each applies its matrix, then (optionally)
  // wraps the result round a vertical drum, then hands on to the segment outside it.
  push(m) {
    this.st.push(this.seg);
    const s = this.seg, c = s.e ? new THREE.Matrix4().fromArray(s.e).multiply(m) : m;
    this.seg = { e: c.elements.slice(), ne: new THREE.Matrix3().getNormalMatrix(c).elements.slice(), bend: s.bend, up: s.up };
    return this;
  }
  pop() { this.seg = this.st.pop(); return this; }
  /** run fn with transform m in effect (nests) */
  in(m, fn) { this.push(m); fn(); this.pop(); return this; }
  /**
   * Run fn with its local XY plane wrapped round a vertical drum of radius R: x becomes arc length, z stays
   * "out". A negative R wraps the other way, so +z faces the axis (the inside of a vault or well).
   */
  bend(R, fn) { this.st.push(this.seg); this.seg = { e: null, ne: null, bend: R, up: this.seg }; fn(); this.seg = this.st.pop(); return this; }
  /** what the following vertices are made of */
  surf(kind, rough = 0.9, metal = 0, glow = 0) { this.kind = kind; this.rough = rough; this.metal = metal; this.glow = glow; return this; }
  v(x, y, z, nx, ny, nz, c) {
    for (let s = this.seg; s; s = s.up) {
      const e = s.e;
      if (e) {
        const px = e[0] * x + e[4] * y + e[8] * z + e[12], py = e[1] * x + e[5] * y + e[9] * z + e[13], pz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const q = s.ne;
        const qx = q[0] * nx + q[3] * ny + q[6] * nz, qy = q[1] * nx + q[4] * ny + q[7] * nz, qz = q[2] * nx + q[5] * ny + q[8] * nz;
        x = px; y = py; z = pz; nx = qx; ny = qy; nz = qz;
      }
      if (s.bend) {
        const th = x / s.bend, si = Math.sin(th), co = Math.cos(th), rr = s.bend + z;
        x = si * rr; z = co * rr;
        const tx = nx * co + nz * si; nz = -nx * si + nz * co; nx = tx;
      }
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    this.P.push(x, y, z); this.N.push(nx / l, ny / l, nz / l); this.C.push(c[0], c[1], c[2]);
    this.A.push(this.rough, this.metal, this.glow); this.K.push(this.kind);
    return this.n++;
  }
  /** vertex whose colour may be a function of its local position and normal */
  vc(x, y, z, nx, ny, nz, c) { return this.v(x, y, z, nx, ny, nz, typeof c === 'function' ? c(x, y, z, nx, ny, nz) : c); }
  /** triangle, wound to agree with its vertex normals (so mirrored and bent pieces need no special care) */
  tri(a, b, c) {
    const P = this.P, N = this.N, a3 = a * 3, b3 = b * 3, c3 = c * 3;
    const ux = P[b3] - P[a3], uy = P[b3 + 1] - P[a3 + 1], uz = P[b3 + 2] - P[a3 + 2];
    const vx = P[c3] - P[a3], vy = P[c3 + 1] - P[a3 + 1], vz = P[c3 + 2] - P[a3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-16) return;
    const d = fx * (N[a3] + N[b3] + N[c3]) + fy * (N[a3 + 1] + N[b3 + 1] + N[c3 + 1]) + fz * (N[a3 + 2] + N[b3 + 2] + N[c3 + 2]);
    if (d < 0) this.I.push(a, c, b); else this.I.push(a, b, c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }

  /** flat polygon (fan) with one normal */
  poly(pts, nx, ny, nz, c) {
    const id = pts.map((p) => this.vc(p[0], p[1], p[2], nx, ny, nz, c));
    for (let i = 1; i < id.length - 1; i++) this.tri(id[0], id[i], id[i + 1]);
  }
  /** box centred on the origin with chamfered edges; normals are shared across each chamfer so it reads as a rounded arris */
  cbox(w, h, d, b, c) {
    b = Math.min(b, w / 2.02, h / 2.02, d / 2.02);
    const X = w / 2, Y = h / 2, Z = d / 2, id = [];
    for (let k = 0; k < 8; k++) {
      const sx = k & 1 ? 1 : -1, sy = k & 2 ? 1 : -1, sz = k & 4 ? 1 : -1;
      id.push([this.vc(sx * X, sy * (Y - b), sz * (Z - b), sx, 0, 0, c), this.vc(sx * (X - b), sy * Y, sz * (Z - b), 0, sy, 0, c), this.vc(sx * (X - b), sy * (Y - b), sz * Z, 0, 0, sz, c)]);
    }
    for (let a = 0; a < 3; a++) {
      const p = (a + 1) % 3, q = (a + 2) % 3;
      for (let s = 0; s < 2; s++) { // the two faces across axis a
        const k = (i, j) => (s << a) | (i << p) | (j << q);
        this.quad(id[k(0, 0)][a], id[k(1, 0)][a], id[k(1, 1)][a], id[k(0, 1)][a]);
      }
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { // the four edges along axis a
        const k0 = (i << p) | (j << q), k1 = k0 | (1 << a);
        this.quad(id[k0][p], id[k1][p], id[k1][q], id[k0][q]);
      }
    }
    for (let k = 0; k < 8; k++) this.tri(id[k][0], id[k][1], id[k][2]);
  }
  /** chamfered beam along X, centred, with `segs` stations so colour and warp can vary along its length */
  beam(L, h, d, b, c, segs = 1, warp = null) {
    b = Math.min(b, h / 2.02, d / 2.02, L / 2.02);
    const Y = h / 2, Z = d / 2, X = L / 2;
    const ring = [[Y - b, Z, 0, 1], [Y, Z - b, 1, 0], [Y, -(Z - b), 1, 0], [Y - b, -Z, 0, -1], [-(Y - b), -Z, 0, -1], [-Y, -(Z - b), -1, 0], [-Y, Z - b, -1, 0], [-(Y - b), Z, 0, 1]];
    const capP = [[Y - b, Z - b], [Y - b, -(Z - b)], [-(Y - b), -(Z - b)], [-(Y - b), Z - b]];
    let prev = null;
    for (let i = 0; i <= segs; i++) {
      const x = -X + b + ((L - 2 * b) * i) / segs;
      const w = warp ? warp(x) : null, oy = w ? w[0] : 0, oz = w ? w[1] : 0;
      const cur = ring.map(([y, z, ny, nz]) => this.vc(x, y + oy, z + oz, 0, ny, nz, c));
      if (prev) for (let k = 0; k < 8; k++) this.quad(prev[k], cur[k], cur[(k + 1) % 8], prev[(k + 1) % 8]);
      if (i === 0 || i === segs) {
        const s = i === 0 ? -1 : 1;
        const cap = capP.map(([y, z]) => this.vc(s * X, y + oy, z + oz, s, 0, 0, c));
        this.quad(cap[0], cap[1], cap[2], cap[3]);
        for (let q = 0; q < 4; q++) { this.tri(cur[2 * q], cur[2 * q + 1], cap[q]); this.quad(cur[2 * q + 1], cur[(2 * q + 2) % 8], cap[(q + 1) % 4], cap[q]); }
      }
      prev = cur;
    }
  }
  /** a beam from point a to point b (h along `up`, d sideways) */
  beamTo(a, b, h, d, bev, c, segs = 1, up = [0, 1, 0]) { const f = along(a, b, up); this.in(f.m, () => this.beam(f.L, h, d, bev, c, segs)); }
  /** surface of revolution about Y: profile [[radius, y], ...] listed bottom to top; sharp profile corners stay sharp */
  lathe(prof, seg, c, a0 = 0, a1 = TAU) {
    const ns = [];
    for (let k = 0; k < prof.length - 1; k++) { const dr = prof[k + 1][0] - prof[k][0], dy = prof[k + 1][1] - prof[k][1], l = Math.hypot(dr, dy) || 1; ns.push([dy / l, -dr / l]); }
    const soft = (i, j) => ns[i][0] * ns[j][0] + ns[i][1] * ns[j][1] > 0.75;
    for (let k = 0; k < ns.length; k++) {
      const n0 = k > 0 && soft(k, k - 1) ? [ns[k][0] + ns[k - 1][0], ns[k][1] + ns[k - 1][1]] : ns[k];
      const n1 = k < ns.length - 1 && soft(k, k + 1) ? [ns[k][0] + ns[k + 1][0], ns[k][1] + ns[k + 1][1]] : ns[k];
      let pa = -1, pb = -1;
      for (let s = 0; s <= seg; s++) {
        const an = lerp(a0, a1, s / seg), co = Math.cos(an), si = Math.sin(an);
        const a = this.vc(prof[k][0] * co, prof[k][1], prof[k][0] * si, n0[0] * co, n0[1], n0[0] * si, c);
        const b = this.vc(prof[k + 1][0] * co, prof[k + 1][1], prof[k + 1][0] * si, n1[0] * co, n1[1], n1[0] * si, c);
        if (s) this.quad(pa, a, b, pb);
        pa = a; pb = b;
      }
    }
  }
  /** frustum up +Y from the origin with optional end discs */
  cyl(r0, r1, h, seg, c, capB = false, capT = true) {
    this.lathe([[r0, 0], [r1, h]], seg, c);
    for (const [on, r, y, ny] of [[capB, r0, 0, -1], [capT, r1, h, 1]]) {
      if (!on || r <= 0) continue;
      const ce = this.vc(0, y, 0, 0, ny, 0, c);
      let p = -1;
      for (let s = 0; s <= seg; s++) { const an = (s / seg) * TAU, q = this.vc(Math.cos(an) * r, y, Math.sin(an) * r, 0, ny, 0, c); if (s) this.tri(ce, p, q); p = q; }
    }
  }
  /**
   * A moulding: profile [[out, y], ...] listed bottom to top, standing out toward +Z and swept along X
   * over -L/2..L/2. mitreL/R = 1 lengthens that end by each point's own projection (outside corner),
   * -1 shortens it (inside corner). capL/R closes a free end.
   */
  mould(prof, L, c, mitreL = 0, mitreR = 0, segs = 1, capL = false, capR = false) {
    const ns = [];
    for (let k = 0; k < prof.length - 1; k++) { const dz = prof[k + 1][0] - prof[k][0], dy = prof[k + 1][1] - prof[k][1], l = Math.hypot(dz, dy) || 1; ns.push([dy / l, -dz / l]); }
    const soft = (i, j) => ns[i][0] * ns[j][0] + ns[i][1] * ns[j][1] > 0.75;
    const xl = (p) => -L / 2 - mitreL * p[0], xr = (p) => L / 2 + mitreR * p[0];
    for (let k = 0; k < ns.length; k++) {
      const n0 = k > 0 && soft(k, k - 1) ? [ns[k][0] + ns[k - 1][0], ns[k][1] + ns[k - 1][1]] : ns[k];
      const n1 = k < ns.length - 1 && soft(k, k + 1) ? [ns[k][0] + ns[k + 1][0], ns[k][1] + ns[k + 1][1]] : ns[k];
      let pa = -1, pb = -1;
      for (let s = 0; s <= segs; s++) {
        const f = s / segs;
        const a = this.vc(lerp(xl(prof[k]), xr(prof[k]), f), prof[k][1], prof[k][0], 0, n0[1], n0[0], c);
        const b = this.vc(lerp(xl(prof[k + 1]), xr(prof[k + 1]), f), prof[k + 1][1], prof[k + 1][0], 0, n1[1], n1[0], c);
        if (s) this.quad(pa, a, b, pb);
        pa = a; pb = b;
      }
    }
    if (capL) this.poly(prof.map((p) => [xl(p), p[1], p[0]]), -1, 0, 0, c);
    if (capR) this.poly(prof.map((p) => [xr(p), p[1], p[0]]), 1, 0, 0, c);
  }
  /** parametric surface fn(u, v) -> [x, y, z] over 0..1 with smooth normals; c may be an rgb or c(x, y, z, nx, ny, nz, u, v) */
  sheet(nu, nv, fn, c, wrapU = false, flip = false) {
    const pts = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pts.push(fn(i / nu, j / nv));
    const at = (i, j) => pts[j * (nu + 1) + i];
    const id = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = at(wrapU ? (i === 0 ? nu - 1 : i - 1) : Math.max(0, i - 1), j), b = at(wrapU ? (i === nu ? 1 : i + 1) : Math.min(nu, i + 1), j);
      const d = at(i, Math.max(0, j - 1)), e = at(i, Math.min(nv, j + 1));
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = e[0] - d[0], vy = e[1] - d[1], vz = e[2] - d[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz < 1e-18) { nx = 0; ny = 1; nz = 0; }
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l; ny /= l; nz /= l;
      const p = at(i, j);
      id.push(this.v(p[0], p[1], p[2], nx, ny, nz, typeof c === 'function' ? c(p[0], p[1], p[2], nx, ny, nz, i / nu, j / nv) : c));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const o = j * (nu + 1) + i; this.quad(id[o], id[o + 1], id[o + nu + 2], id[o + nu + 1]); }
  }
  /** tube through points; rad is a number or one radius per point; c may be c(x, y, z, nx, ny, nz, t) */
  tube(pts, rad, radial, c, caps = true) {
    const n = pts.length, rings = [];
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (i === 0) { if (Math.abs(ty) < 0.9) { nx = 0; ny = 1; nz = 0; } else { nx = 1; ny = 0; nz = 0; } }
      const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz; // carry the frame along without twisting
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const r = typeof rad === 'number' ? rad : rad[i], p = pts[i], ring = [];
      for (let k = 0; k <= radial; k++) {
        const an = (k / radial) * TAU, co = Math.cos(an), si = Math.sin(an);
        const ox = nx * co + bx * si, oy = ny * co + by * si, oz = nz * co + bz * si;
        const x = p[0] + ox * r, y = p[1] + oy * r, z = p[2] + oz * r;
        ring.push(this.v(x, y, z, ox, oy, oz, typeof c === 'function' ? c(x, y, z, ox, oy, oz, i / (n - 1), k) : c));
      }
      if (i) for (let k = 0; k < radial; k++) this.quad(rings[i - 1][k], ring[k], ring[k + 1], rings[i - 1][k + 1]);
      rings.push(ring);
      if (caps && (i === 0 || i === n - 1) && r > 0) {
        const s = i === 0 ? -1 : 1, cc = typeof c === 'function' ? c(p[0], p[1], p[2], tx * s, ty * s, tz * s, i ? 1 : 0, 0) : c;
        const ce = this.v(p[0], p[1], p[2], tx * s, ty * s, tz * s, cc);
        const rim = ring.map((_, k) => { const an = (k / radial) * TAU, co = Math.cos(an), si = Math.sin(an); return this.v(p[0] + (nx * co + bx * si) * r, p[1] + (ny * co + by * si) * r, p[2] + (nz * co + bz * si) * r, tx * s, ty * s, tz * s, cc); });
        for (let k = 0; k < radial; k++) this.tri(ce, rim[k], rim[k + 1]);
      }
    }
  }
  /** small dome standing on the local XY plane toward +Z: nail heads, studs, rivets */
  stud(r, c, seg = 6, hgt = 0.7) {
    const tip = this.vc(0, 0, r * hgt, 0, 0, 1, c);
    let pa = -1, pb = -1;
    for (let s = 0; s <= seg; s++) {
      const an = (s / seg) * TAU, co = Math.cos(an), si = Math.sin(an);
      const a = this.vc(co * r, si * r, 0, co, si, 0.25, c), b = this.vc(co * r * 0.62, si * r * 0.62, r * hgt * 0.72, co * 0.6, si * 0.6, 0.8, c);
      if (s) { this.quad(pa, a, b, pb); this.tri(pb, b, tip); }
      pa = a; pb = b;
    }
  }
  /** merge a BufferGeometry: c = rgb, c(x, y, z, nx, ny, nz), or omitted to keep the geometry's own baked colour and finish */
  add(geo, c) {
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position, nr = geo.attributes.normal, col = geo.attributes.color, pb = geo.attributes.aPbr, base = this.n;
    const keep = [this.rough, this.metal, this.glow];
    for (let i = 0; i < p.count; i++) {
      if (pb && !c) { this.rough = pb.getX(i); this.metal = pb.getY(i); this.glow = pb.getZ(i); }
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = nr.getX(i), ny = nr.getY(i), nz = nr.getZ(i);
      this.v(x, y, z, nx, ny, nz, c ? (typeof c === 'function' ? c(x, y, z, nx, ny, nz) : c) : col ? [col.getX(i), col.getY(i), col.getZ(i)] : [0.6, 0.6, 0.6]);
    }
    [this.rough, this.metal, this.glow] = keep;
    const ix = geo.index, cnt = ix ? ix.count : p.count;
    for (let i = 0; i < cnt; i += 3) this.tri(base + (ix ? ix.getX(i) : i), base + (ix ? ix.getX(i + 1) : i + 1), base + (ix ? ix.getX(i + 2) : i + 2));
  }
  /** mesh a sculpt part ({ prims, hard }) and merge it */
  sculpt(part, res, ao = 0.75) { const geo = buildPartGeometry(part, { res: res * qual(), ao }); if (geo) this.add(geo); }

  /**
   * One dressed stone lying on the local XY plane and facing +Z, filling the cell (u0, v0)-(u1, v1).
   * Its face stands o.r proud; the joint round it is a V groove that bottoms out on the cell edge at
   * z = 0, so neighbouring stones share those edge vertices' positions and the wall is watertight.
   * Edge styles: GROOVE (a joint), CORNER (the face runs o.r past the edge to meet the stone of the face
   * round an outside corner), CUT (sawn off flush at the edge).
   */
  stone(u0, v0, u1, v1, o, eL, eR, eB, eT, sd) {
    const r = o.r, b = Math.min(o.b, (u1 - u0) * 0.3, (v1 - v0) * 0.3);
    const h1 = hash1(sd, 11), h2 = hash1(sd, 23), h3 = hash1(sd, 37);
    const nx = clamp(Math.round((u1 - u0) / o.cell), 1, 7), ny = clamp(Math.round((v1 - v0) / o.cell), 1, 5);
    const a0 = u0 + (eL === GROOVE ? b : eL === CORNER ? -r : 0), a1 = u1 - (eR === GROOVE ? b : eR === CORNER ? -r : 0);
    const c0 = v0 + (eB === GROOVE ? b : eB === CORNER ? -r : 0), c1 = v1 - (eT === GROOVE ? b : eT === CORNER ? -r : 0);
    const rm = o.flat ? 1 : 0.7 + 0.45 * h1;
    const base = mul(o.pal[Math.floor(h2 * o.pal.length) % o.pal.length], 1 + o.var * (h3 * 2 - 1));
    const chipAt = (k, ea, eb) => (ea === GROOVE && eb === GROOVE && hash1(sd, 51 + k) < o.chip ? (0.25 + 0.5 * hash1(sd, 61 + k)) * Math.min(u1 - u0, v1 - v0, 0.22) * 0.5 : 0);
    const chips = [chipAt(0, eL, eB), chipAt(1, eR, eB), chipAt(2, eL, eT), chipAt(3, eR, eT)];
    const nf = o.nf, sx = sd * 0.173, eps = 0.35 / nf, W = nx + 1;
    const id = new Array(W * (ny + 1));
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      let pu = a0 + ((a1 - a0) * i) / nx, pv = c0 + ((c1 - c0) * j) / ny;
      const L = i === 0, R = i === nx, B = j === 0, T = j === ny;
      const n0 = noise3(pu * nf + sx, pv * nf, sx * 0.7), n1 = noise3((pu + eps) * nf + sx, pv * nf, sx * 0.7), n2 = noise3(pu * nf + sx, (pv + eps) * nf, sx * 0.7);
      let d = r * rm - o.rough * n0, lite = 0.9 + 0.2 * n0;
      let nX = ((n0 - n1) / eps) * o.bump * 0.02, nY = ((n0 - n2) / eps) * o.bump * 0.02;
      if ((L && eL === CORNER) || (R && eR === CORNER) || (B && eB === CORNER) || (T && eT === CORNER)) d = r;
      if (L) nX -= eL === CORNER ? 1 : eL === GROOVE ? 0.5 : 0; else if (R) nX += eR === CORNER ? 1 : eR === GROOVE ? 0.5 : 0;
      if (B) nY -= eB === CORNER ? 1 : eB === GROOVE ? 0.5 : 0; else if (T) nY += eT === CORNER ? 1 : eT === GROOVE ? 0.5 : 0;
      if ((L || R) && (B || T)) {
        const cs = chips[(R ? 1 : 0) + (T ? 2 : 0)];
        if (cs) { pu += L ? cs : -cs; pv += B ? cs * 0.8 : -cs * 0.8; d *= 0.25; lite *= 1.1; nX *= 1.6; nY *= 1.6; }
        else lite *= 1.04;
      } else if (L || R || B || T) lite *= 1.03;
      id[j * W + i] = this.v(pu, pv, d, nX, nY, 1, [base[0] * lite, base[1] * lite, base[2] * lite]);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const q = j * W + i; this.quad(id[q], id[q + 1], id[q + W + 1], id[q + W]); }
    // groove walls down to the joint line
    const per = [];
    for (let i = 0; i < nx; i++) per.push([i, 0, eB]);
    for (let j = 0; j < ny; j++) per.push([nx, j, eR]);
    for (let i = nx; i > 0; i--) per.push([i, ny, eT]);
    for (let j = ny; j > 0; j--) per.push([0, j, eL]);
    const m = o.mortar, out = per.map(([i, j]) => this.v(u0 + ((u1 - u0) * i) / nx, v0 + ((v1 - v0) * j) / ny, 0, i === 0 ? -1 : i === nx ? 1 : 0, j === 0 ? -1 : j === ny ? 1 : 0, 0.6, m));
    for (let k = 0; k < per.length; k++) {
      if (per[k][2] === CORNER) continue;
      const k2 = (k + 1) % per.length;
      this.quad(out[k], out[k2], id[per[k2][1] * W + per[k2][0]], id[per[k][1] * W + per[k][0]]);
    }
  }
  /** a dressed stone with any convex outline [[u, v], ...] on the local XY plane: voussoirs, flags, rubble */
  stonePoly(pts, o, sd, relief = o.r) {
    const n = pts.length, h1 = hash1(sd, 11), h2 = hash1(sd, 23), h3 = hash1(sd, 37);
    let cu = 0, cv = 0;
    for (const p of pts) { cu += p[0] / n; cv += p[1] / n; }
    const base = mul(o.pal[Math.floor(h2 * o.pal.length) % o.pal.length], 1 + o.var * (h3 * 2 - 1));
    const rm = o.flat ? 1 : 0.8 + 0.3 * h1, sx = sd * 0.173;
    const ce = this.v(cu, cv, relief * rm, 0, 0, 1, base);
    const inn = [], out = [];
    for (const p of pts) {
      const dx = p[0] - cu, dy = p[1] - cv, l = Math.hypot(dx, dy) || 1, k = Math.min(0.45, (o.b * 1.5) / l);
      const nz = noise3(p[0] * o.nf + sx, p[1] * o.nf, sx), lite = 0.92 + 0.18 * nz;
      inn.push(this.v(p[0] - dx * k, p[1] - dy * k, relief * rm - o.rough * nz, (dx / l) * 0.5, (dy / l) * 0.5, 1, [base[0] * lite, base[1] * lite, base[2] * lite]));
      out.push(this.v(p[0], p[1], 0, dx / l, dy / l, 0.6, o.mortar));
    }
    for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; this.tri(ce, inn[k], inn[k2]); this.quad(out[k], out[k2], inn[k2], inn[k]); }
  }
  /** flat polygon with its own normal and a colour per corner (or one colour) */
  flat(pts, cols) {
    const a = pts[0], b = pts[1], c = pts[2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const id = pts.map((p, i) => this.v(p[0], p[1], p[2], nx, ny, nz, Array.isArray(cols[0]) ? cols[i] : cols));
    for (let i = 1; i < id.length - 1; i++) this.tri(id[0], id[i], id[i + 1]);
  }
  /**
   * A coursed face W x H on the local XY plane. o = stone style plus:
   *   ends [left, right, bottom, top] edge styles, holes [[u0, v0, u1, v1, edgeStyle?], ...] (keep them on course lines),
   *   holeEdge (style of a stone end at a hole), quoin [long, short] (alternating lengths at CORNER ends),
   *   wrap (the face goes right round a drum: courses start at staggered offsets and close on themselves).
   */
  ashlar(W, H, o) {
    const ch = o.course, ends = o.ends || [0, 0, 0, 0], holes = o.holes || [], he = o.holeEdge ?? CORNER;
    const lmin = o.len[0], lmax = o.len[1], rows = Math.ceil(H / ch - 1e-6);
    for (let j = 0; j < rows; j++) {
      const v0 = j * ch, v1 = Math.min(H, v0 + ch);
      if (v1 - v0 < 0.015) continue;
      const rnd = rng(o.seed * 7919 + j * 104729 + 13);
      const off = o.wrap ? rnd() * lmax : 0;
      let runs = [[off, off + W, ends[0], ends[1]]];
      for (const hl of holes) {
        if (hl[1] >= v1 - 1e-4 || hl[3] <= v0 + 1e-4) continue;
        for (const sh of o.wrap ? [0, W] : [0]) {
          const ha = hl[0] + sh, hb = hl[2] + sh, next = [];
          for (const [a, b, sa, sb] of runs) {
            if (hb <= a + 1e-4 || ha >= b - 1e-4) { next.push([a, b, sa, sb]); continue; }
            if (ha > a + 1e-4) next.push([a, ha, sa, hl[4] ?? he]);
            if (hb < b - 1e-4) next.push([hb, b, hl[4] ?? he, sb]);
          }
          runs = next;
        }
      }
      const eB = j === 0 ? ends[2] : GROOVE, eT = v1 >= H - 1e-6 ? ends[3] : GROOVE;
      let ri = 0;
      for (const [a, b, sa, sb] of runs) {
        const rem = b - a, cuts = [a];
        const first = o.quoin && sa === CORNER ? o.quoin[j % 2] : lmin * 0.55 + rnd() * (lmax - lmin * 0.55);
        const last = o.quoin && sb === CORNER ? o.quoin[1 - (j % 2)] : 0;
        if (first + last > rem - lmin * 0.5) { if (rem > lmax * 1.3) cuts.push(a + rem / 2); } else {
          let x = a + first; cuts.push(x);
          const end = b - last;
          while (end - x > lmax * 1.05) { let L = lmin + rnd() * (lmax - lmin); if (end - x - L < lmin * 0.75) L = (end - x) / 2; x += L; cuts.push(x); }
          if (last > 0) cuts.push(end);
        }
        cuts.push(b);
        for (let k = 0; k < cuts.length - 1; k++) {
          this.stone(cuts[k], v0, cuts[k + 1], v1, o, k === 0 ? sa : GROOVE, k === cuts.length - 2 ? sb : GROOVE, eB, eT, (o.seed * 131 + j * 977 + ri * 53 + k * 7 + 1) | 0);
        }
        ri++;
      }
    }
  }
  /** darken everything inside a box, fading over `soft` at its faces; ramp = [axis, sign] makes it strongest toward one face */
  shade(x0, y0, z0, x1, y1, z1, k, soft = 0.1, ramp = null) { this.shades.push([x0, y0, z0, x1, y1, z1, k, soft, ramp]); }

  // Dirt, damp and sun: one pass over the finished model so every piece ages the same way.
  weather() {
    const P = this.P, N = this.N, C = this.C, K = this.K;
    const moss = [0.1, 0.16, 0.045], mud = [0.11, 0.085, 0.05];
    for (let i = 0; i < this.n; i++) {
      const k = K[i], o = i * 3;
      const x = P[o], y = P[o + 1], z = P[o + 2], ny = N[o + 1];
      let r = C[o], g = C[o + 1], b = C[o + 2];
      if (k !== K_PLAIN) {
        let m = 0.9 + 0.2 * fbm3(x * 0.9 + 3.1, y * 0.9 + 1.3, z * 0.9 + 7.7, 2);
        const damp = smooth(0.55, 0, y) * (0.4 + 0.6 * noise3(x * 2.3 + 5, 1.7, z * 2.3));
        if (k === K_STONE) {
          const green = clamp(damp * 0.7 + (ny > 0.4 ? 0.2 * smooth(0.55, 0.8, noise3(x * 3.1, y * 3.1 + 9, z * 3.1)) : 0), 0, 0.65);
          r += (moss[0] - r) * green; g += (moss[1] - g) * green; b += (moss[2] - b) * green;
          m *= 1 - 0.3 * damp;
          m *= 1 - 0.1 * smooth(0.62, 0.9, noise3(x * 7 + 2, y * 0.55, z * 7)); // rain streaks
          if (ny > 0.6) m *= 1.05;
        } else if (k === K_WOOD) {
          r += (mud[0] - r) * damp * 0.5; g += (mud[1] - g) * damp * 0.5; b += (mud[2] - b) * damp * 0.5;
          if (ny > 0.6) { const l = (r + g + b) / 3; r += (l - r) * 0.25; g += (l - g) * 0.25; b += (l - b) * 0.25; m *= 1.06; }
        } else if (k === K_PLASTER) {
          r += (mud[0] * 2 - r) * damp * 0.55; g += (mud[1] * 2 - g) * damp * 0.55; b += (mud[2] * 2 - b) * damp * 0.55;
          m *= 1 - 0.12 * smooth(0.6, 0.9, noise3(x * 5 + 2, y * 0.5, z * 5));
        } else if (k === K_ROOF) {
          const green = ny > 0.2 ? 0.3 * smooth(0.6, 0.85, noise3(x * 2.2, y * 2.2 + 4, z * 2.2)) : 0;
          r += (moss[0] - r) * green; g += (moss[1] - g) * green; b += (moss[2] - b) * green;
        } else if (k === K_CLOTH) {
          r += (mud[0] * 1.5 - r) * damp * 0.6; g += (mud[1] * 1.5 - g) * damp * 0.6; b += (mud[2] * 1.5 - b) * damp * 0.6;
        }
        r *= m; g *= m; b *= m;
      }
      for (const s of this.shades) {
        const sf = s[7];
        const wx = Math.min(x - s[0], s[3] - x) / sf + 1, wy = Math.min(y - s[1], s[4] - y) / sf + 1, wz = Math.min(z - s[2], s[5] - z) / sf + 1;
        if (wx <= 0 || wy <= 0 || wz <= 0) continue;
        let w = Math.min(1, wx) * Math.min(1, wy) * Math.min(1, wz);
        if (s[8]) { const a = s[8][0], t = clamp(((a === 0 ? x : a === 1 ? y : z) - s[a]) / (s[a + 3] - s[a]), 0, 1); w *= s[8][1] > 0 ? t : 1 - t; }
        const f = 1 - s[6] * w;
        r *= f; g *= f; b *= f;
      }
      C[o] = r; C[o + 1] = g; C[o + 2] = b;
    }
  }
  build() {
    this.weather();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.P), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.N), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.C), 3));
    g.setAttribute('aPbr', new THREE.BufferAttribute(new Float32Array(this.A), 3));
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---------- shared construction ----------
const cache = new Map();
/** build once per key, hand out clones that share the geometry */
function cached(key, make) {
  const k = `${key}:${getDetail()}`;
  if (!cache.has(k)) cache.set(k, make());
  return cache.get(k).clone();
}
function meshOf(geo) {
  const m = new THREE.Mesh(geo, sculptMaterial());
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const finish = (g) => meshOf(g.build());
/**
 * Long pieces are modelled along X: make(length, depth) -> Geo. A rotated placement arrives with w < h and
 * gets the same geometry turned a quarter, so the two orientations cost one build between them.
 */
const turned = new Map();
function oriented(def, w, h, make) {
  return cached(`${def.model}:${w}x${h}:${def.color}`, () => {
    const L = Math.max(w, h), D = Math.min(w, h), k = `${def.model}:${L}:${D}:${def.color}:${getDetail()}`;
    if (!turned.has(k)) turned.set(k, make(L, D).build());
    return meshOf(h > w ? turned.get(k).clone().rotateY(Math.PI / 2) : turned.get(k));
  });
}

/**
 * Scenery that should not all look alike: `count` variants are built on demand, and each placement picks
 * one, and a turn about its own axis, from where it stands. The choice is made the first time the object's
 * matrix is updated (by then the game has positioned it), so it is stable across scene rebuilds.
 */
const variantGeo = new Map();
function scattered(name, color, count, make, quarterTurns = false) {
  const geoOf = (v) => { const k = `${name}:${color}:${v}:${getDetail()}`; if (!variantGeo.has(k)) variantGeo.set(k, make(color, v).build()); return variantGeo.get(k); };
  const root = new THREE.Group(), mesh = new THREE.Mesh(geoOf(0), sculptMaterial());
  mesh.castShadow = true; mesh.receiveShadow = true;
  root.add(mesh);
  root.updateMatrixWorld = function (force) {
    delete this.updateMatrixWorld;
    const p = this.position, h = hash1(Math.round(p.x * 2), Math.round(p.z * 2), 7), h2 = hash1(Math.round(p.x * 2), Math.round(p.z * 2), 19);
    mesh.geometry = geoOf(Math.floor(h * count) % count);
    mesh.rotation.y = quarterTurns ? Math.floor(h2 * 4) * (Math.PI / 2) : h2 * TAU;
    if (!quarterTurns) mesh.scale.setScalar(0.92 + 0.2 * hash1(Math.round(p.x * 2), Math.round(p.z * 2), 31));
    return THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
  };
  return root;
}

/** dressed-stone style from a base colour */
function stoneStyle(hex, o = {}) {
  const c = rgb(hex);
  return {
    r: 0.016, b: 0.014, cell: 0.1 / qual(), rough: 0.008, bump: 0.8, nf: 9, var: 0.11, chip: 0.14, course: COURSE, len: [0.3, 0.56], seed: 1,
    pal: [c, c, c, mix(c, rgb(0xbfa67a), 0.34), mix(c, rgb(0x6f7e8e), 0.34), mul(c, 0.84), mul(c, 1.1), mix(c, rgb(0xa98466), 0.3), mul(c, 0.72)],
    mortar: mul(mix(c, rgb(0x4a4238), 0.55), 0.42), ...o,
  };
}
const IRON = [0.035, 0.035, 0.04];
/** streaky timber colour: grain runs along the piece's local X */
const woodTint = (c, seed = 0) => (x, y, z) => mul(c, 0.78 + 0.34 * noise3(x * 1.7 + seed * 1.3, y * 23 + seed, z * 23 + seed * 0.7));
/**
 * The ground under a long building rolls a little, so everything that stands on it is carried a hand's breadth
 * below y = 0: a plain strip of footing under the face z = 0 of the current frame, from x0 to x1.
 */
function footing(g, x0, x1, col, z = 0, depth = 0.16) {
  const k = g.kind;
  g.surf(K_STONE, 0.97);
  const zz = z - 0.004;   // a hair behind the stone faces above it, so the two never fight for the same depth
  g.flat([[x0, 0.003, zz], [x1, 0.003, zz], [x1, -depth, zz], [x0, -depth, zz]], [mul(col, 0.6), mul(col, 0.6), mul(col, 0.4), mul(col, 0.4)]);
  g.kind = k;
}
const stoneTint = (c, seed = 0, f = 2.3) => (x, y, z) => mul(c, 0.9 + 0.2 * noise3(x * f + seed, y * f * 2.1, z * f + seed * 0.37));

/**
 * Rows of overlapping roof tiles on any surface. at(u, v) -> [x, y, z] with u 0..1 along a row and v 0..1 from
 * eave to ridge; count(row) = tiles in that row. o: pal, lift (how far a tile's foot stands off the one below),
 * lap, gap, round (rounded foot), wrap (rows close on themselves), seed.
 */
function tiles(g, rows, count, at, o) {
  const rnd = rng(o.seed * 977 + 5), lap = o.lap ?? 0.4, gap = o.gap ?? 0.07;
  const add = (a, n, k) => [a[0] + n[0] * k, a[1] + n[1] * k, a[2] + n[2] * k];
  for (let j = 0; j < rows; j++) {
    const n = Math.max(1, Math.round(count(j))), v0 = j / rows, v1 = Math.min(1, (j + 1 + lap) / rows), half = j % 2 ? 0.5 : 0;
    for (let i = o.wrap ? 0 : -1; i < n; i++) {
      let u0 = (i + half) / n, u1 = (i + 1 + half) / n;
      if (!o.wrap) { if (u1 <= 0.004 || u0 >= 0.996) continue; u0 = Math.max(0, u0); u1 = Math.min(1, u1); }
      const gp = (gap * 0.5) / n;
      const A = at(u0 + gp, v0), B = at(u1 - gp, v0), C = at(u1 - gp, v1), D = at(u0 + gp, v1);
      let nx = (B[1] - A[1]) * (D[2] - A[2]) - (B[2] - A[2]) * (D[1] - A[1]), ny = (B[2] - A[2]) * (D[0] - A[0]) - (B[0] - A[0]) * (D[2] - A[2]), nz = (B[0] - A[0]) * (D[1] - A[1]) - (B[1] - A[1]) * (D[0] - A[0]);
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) continue;
      const sg = ny < 0 ? -1 / l : 1 / l, N = [nx * sg, ny * sg, nz * sg];
      const lf = o.lift * (0.75 + 0.6 * rnd()), A2 = add(A, N, lf), B2 = add(B, N, lf);
      const base = mul(o.pal[Math.floor(rnd() * o.pal.length) % o.pal.length], 0.85 + 0.3 * rnd());
      const lo = mul(base, 1.08), hi = mul(base, 0.66), dk = mul(base, 0.42);
      if (o.round) {
        const m0 = at((u0 + u1) / 2, v0 - 0.32 / rows), m1 = at((u0 + u1) / 2, v0), Mt = add(m0, N, lf);
        g.flat([D, C, B2, Mt, A2], [hi, hi, lo, lo, lo]);
        g.flat([A2, Mt, m1, A], dk); g.flat([Mt, B2, B, m1], dk);
      } else {
        g.flat([D, C, B2, A2], [hi, hi, lo, lo]);
        g.flat([A2, B2, B, A], dk);
      }
      g.flat([A, A2, D], dk); g.flat([B, B2, C], dk);
    }
  }
}
/** half-round ridge tiles laid along the line a -> b */
function ridge(g, a, b, rad, col, seed) {
  const f = along(a, b), n = Math.max(1, Math.round(f.L / 0.2)), rnd = rng(seed * 13 + 3);
  g.in(f.m.clone().multiply(M(0, 0, 0, 0, 0, -90)), () => {
    for (let i = 0; i < n; i++) {
      const y0 = -f.L / 2 + (i * f.L) / n, c = mul(col, 0.82 + 0.32 * rnd());
      g.in(M(0, y0, 0), () => g.lathe([[rad * 1.12, 0], [rad * 1.12, 0.012], [rad * 0.94, f.L / n + 0.03]], 7, c, Math.PI * 0.42, Math.PI * 1.58));
    }
  });
}
/** a pole with a swallow-tailed pennant flying toward +X; the foot of the pole is the local origin */
function pennant(g, h, len, hgt, c1, c2) {
  g.surf(K_WOOD, 0.8);
  g.cyl(0.022, 0.016, h, 8, woodTint(rgb(0x5a4028), 2), false, true);
  g.surf(K_PLAIN, 0.4, 0.9);
  g.in(M(0, h, 0), () => g.lathe([[0, 0.07], [0.016, 0.05], [0.03, 0.022], [0.018, 0], [0.024, -0.012], [0.024, -0.03]].reverse(), 8, rgb(0xc9a23a)));
  g.surf(K_CLOTH, 0.9);
  g.sheet(12, 4, (u, v) => {
    const fork = u > 0.7 ? (u - 0.7) / 0.3 : 0, w = hgt * (1 - 0.25 * u), y = (v - 0.5) * w;
    const cut = fork * (1 - Math.abs(v - 0.5) * 2) * len * 0.3;
    return [0.02 + u * len - cut, h - 0.05 - hgt * 0.5 + y - u * u * 0.05, Math.sin(u * 7 + v) * 0.035 * u];
  }, (x, y, z, nx, ny, nz, u, v) => (Math.abs(v - 0.5) < 0.17 ? c2 : c1));
}

// ---------- castle ----------
const CASTLE = 0x9f9a8f;          // one stone for walls, towers, gatehouse and stairs
const PAR_T = 0.14, PAR_C = 0.15; // parapet thickness and course height
const PAR_B = 2 * PAR_C, PAR_M = 4 * PAR_C; // breast-wall and merlon tops above the walk
const castleStone = (seed, o) => stoneStyle(CASTLE, { seed, ...o });
const pavingStyle = (seed, o) => stoneStyle(CASTLE, { seed, r: 0.008, b: 0.012, rough: 0.004, bump: 0.3, flat: true, chip: 0.08, len: [0.26, 0.5], pal: stoneStyle(CASTLE).pal.map((c) => mul(c, 0.86)), cell: 0.15 / qual(), ...o });

/**
 * Crenellated parapet along local X from x0 to x1, rising from y = 0 with its outer face on z = 0 (facing +Z).
 * merlons = [[a, b], ...]. q.eL/eR: CORNER where the parapet turns a corner, CUT where it butts the next piece.
 * q.inL/inR shorten the inner face where another run crosses behind; q.capL/capR shorten the corner caps.
 * q.wrap: the run closes on itself (call it inside Geo.bend for a round turret).
 */
function parapet(g, x0, x1, merlons, st, seed, q = {}) {
  const eL = q.eL ?? CORNER, eR = q.eR ?? CORNER, inL = q.inL || 0, inR = q.inR || 0;
  const W = x1 - x0, r = st.r, t = q.t || PAR_T, pc = q.course || PAR_C, hB = q.hB || PAR_B, hM = q.hM || PAR_M;
  const ps = { ...st, course: pc, len: [0.2, 0.38] };
  const capC = stoneTint(mul(st.pal[0], 1.06), seed);
  const cren = [];
  let p = x0;
  for (const [a, b] of merlons) { if (a > p + 1e-4) cren.push([p, a]); p = b; }
  if (p < x1 - 1e-4) cren.push([p, x1]);
  const holesOut = cren.map(([a, b]) => [a - x0, hB, b - x0, hM + 1]);
  const holesIn = cren.map(([a, b]) => [x1 - inR - b, hB, x1 - inR - a, hM + 1]);
  g.surf(K_STONE, 0.93);
  g.in(M(x0, 0, -r), () => g.ashlar(W, hM, { ...ps, seed: seed + 1, holes: holesOut, ends: [eL, eR, 0, 0], wrap: q.wrap }));
  g.in(M(x1 - inR, 0, -t + r, 0, 180, 0), () => g.ashlar(W - inL - inR, hM, { ...ps, seed: seed + 2, holes: holesIn, ends: [inR ? CUT : eR, inL ? CUT : eL, 0, 0], wrap: q.wrap }));
  let mi = 0;
  for (const [a, b] of merlons) {
    const openL = a > x0 + 1e-4, openR = b < x1 - 1e-4;
    if (openL) g.in(M(a, hB, -t + r, 0, -90, 0), () => g.ashlar(t - 2 * r, hM - hB, { ...ps, len: [1, 1], seed: seed + 30 + mi, ends: [CORNER, CORNER, 0, 0] }));
    if (openR) g.in(M(b, hB, -r, 0, 90, 0), () => g.ashlar(t - 2 * r, hM - hB, { ...ps, len: [1, 1], seed: seed + 60 + mi, ends: [CORNER, CORNER, 0, 0] }));
    const o = r + 0.012;
    const xa = openL ? a - o : eL === CORNER ? a - o + (q.capL || 0) : a, xb = openR ? b + o : eR === CORNER ? b + o - (q.capR || 0) : b;
    // copings oversail the outer face only, so the walk keeps its full width between the parapets
    if (q.slope) { // gun-platform merlons shed water outward
      g.in(M((xa + xb) / 2, hM + 0.012, -t / 2 + 0.011, q.slope, 0, 0), () => g.cbox(xb - xa, 0.05, t + 0.022, 0.014, capC));
    } else g.in(M((xa + xb) / 2, hM + 0.02, -t / 2 + 0.0075), () => g.cbox(xb - xa, 0.046, t + 0.015, 0.013, capC));
    mi++;
  }
  for (const [a, b] of cren) {
    const xa = a > x0 + 1e-4 ? a + r : a, xb = b < x1 - 1e-4 ? b - r : b;
    g.in(M((xa + xb) / 2, hB + 0.008, -t / 2 + 0.0075), () => g.cbox(xb - xa, 0.03, t + 0.015, 0.01, capC));
  }
}
/** crenellated rim round a rectangle whose outer faces stand at x = +-hx, z = +-hz, rising from y = 0 */
function rim(g, hx, hz, mx, mz, st, seed, q = {}) {
  const t = q.t || PAR_T, sh = t + st.r + 0.012;   // side runs stop their corner copings against the front and back ones
  g.in(M(0, 0, hz), () => parapet(g, -hx, hx, mx, st, seed, { ...q, inL: t, inR: t }));
  g.in(M(0, 0, -hz, 0, 180, 0), () => parapet(g, -hx, hx, mx, st, seed + 100, { ...q, inL: t, inR: t }));
  g.in(M(hx, 0, 0, 0, 90, 0), () => parapet(g, -hz, hz, mz, st, seed + 200, { ...q, inL: t, inR: t, capL: sh, capR: sh }));
  g.in(M(-hx, 0, 0, 0, -90, 0), () => parapet(g, -hz, hz, mz, st, seed + 300, { ...q, inL: t, inR: t, capL: sh, capR: sh }));
}
/** a moulded band laid as separate lengths of stone with joints between them (profile as Geo.mould) */
function band(g, prof, L, col, seed, mitreL = 0, mitreR = 0, capL = false, capR = false) {
  const rnd = rng(seed * 31 + 7), gap = 0.004;
  let x = -L / 2;
  while (x < L / 2 - 1e-4) {
    let len = 0.45 + rnd() * 0.5;
    if (L / 2 - x - len < 0.3) len = L / 2 - x;
    const first = x <= -L / 2 + 1e-4, last = x + len >= L / 2 - 1e-4;
    const c = mul(col, 0.9 + 0.22 * rnd()), a = x + (first ? 0 : gap), b = x + len - (last ? 0 : gap);
    g.in(M((a + b) / 2, 0, 0), () => g.mould(prof, b - a, c, first ? mitreL : 0, last ? mitreR : 0, 1, first ? capL : true, last ? capR : true));
    x += len;
  }
}
/** arrow loop in a niche: fills a hole w x h whose lower-left corner is the local origin of a face. glazed = a barred window instead */
function arrowLoop(g, w, h, st, depth = 0.17, glazed = false) {
  const r = st.r, c = mul(st.pal[0], 0.5), dk = mul(st.pal[0], glazed ? 0.22 : 0.1), black = [0.004, 0.004, 0.006];
  const f = [[r, 0, r], [w - r, 0, r], [w - r, h, r], [r, h, r]], k = f.map((p) => [p[0] + (p[0] < w / 2 ? 0.02 : -0.02), p[1] + (p[1] < h / 2 ? 0.03 : -0.015), -depth]);
  g.surf(K_PLAIN, 1);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; g.flat([f[i], f[j], k[j], k[i]], [c, c, dk, dk]); }
  if (glazed) {
    g.surf(K_PLAIN, 0.16, 0.2);
    g.flat(k, [[0.012, 0.022, 0.04], [0.012, 0.022, 0.04], [0.03, 0.05, 0.08], [0.03, 0.05, 0.08]]);
    g.surf(K_PLAIN, 0.6, 0.8);
    const z = -depth + 0.02;
    g.in(M(w / 2, h / 2, z), () => g.cbox(0.014, h - 0.02, 0.014, 0.003, IRON));
    for (const fy of [0.3, 0.62]) g.in(M(w / 2, h * fy, z), () => g.cbox(w - 0.05, 0.014, 0.014, 0.003, IRON));
  } else {
    g.flat(k, dk);
    const z = -depth + 0.003, sw = w * 0.17;
    g.flat([[w / 2 - sw, h * 0.1, z], [w / 2 + sw, h * 0.1, z], [w / 2 + sw, h * 0.92, z], [w / 2 - sw, h * 0.92, z]], black);
    g.flat([[w * 0.24, h * 0.6, z], [w * 0.76, h * 0.6, z], [w * 0.76, h * 0.6 + sw * 2, z], [w * 0.24, h * 0.6 + sw * 2, z]], black);
  }
  // dressed sill and head
  g.surf(K_STONE, 0.93);
  const tc = stoneTint(mul(st.pal[0], 1.04), 3);
  g.in(M(w / 2, -0.022, r - 0.022), () => g.cbox(w + 0.1, 0.045, 0.08, 0.012, tc));
  g.in(M(w / 2, h + 0.026, r - 0.022), () => g.cbox(w + 0.12, 0.052, 0.08, 0.012, tc));
}
/** a segmental arch: half width, springing height and rise; ring = depth of its voussoirs */
function archOf(half, spring, rise, ring = 0.2) {
  const ri = (half * half + rise * rise) / (2 * rise), cy = spring + rise - ri, a0 = Math.atan2(spring - cy, half);
  return { half, spring, rise, ri, cy, re: ri + ring, a0, a1: Math.PI - a0, y: (x) => cy + Math.sqrt(Math.max(0, ri * ri - x * x)) };
}
/** holes that clear arch A (centred on u = uc) out of a coursed face whose first course starts at height y0 */
function archHoles(A, uc, y0, rows, r, course = COURSE) {
  const holes = [];
  for (let j = 0; j < rows; j++) {
    const v0 = j * course, y1 = y0 + v0 + course, low = y1 <= A.spring + 1e-4;
    const hwid = low ? A.half + r : y1 - A.cy < A.re - 0.05 ? Math.sqrt((A.re - 0.05) ** 2 - (y1 - A.cy) ** 2) : 0;
    if (hwid > 0) holes.push([uc - hwid, v0, uc + hwid, v0 + course, low ? CORNER : CUT]);
  }
  return holes;
}
/** two leaves of planks closing arch A, with strap hinges, studs and ring pulls on the +Z side; the door's mid plane is z = 0 */
function archDoors(g, A, oak, planks, dz = 0.07, seed = 0) {
  const half = A.half, pw = half / planks;
  g.surf(K_WOOD, 0.82);
  for (const e of [-1, 1]) for (let i = 0; i < planks; i++) {
    const x0 = i * pw, hgt = A.y(x0) + 0.02, c = woodTint(mul(oak, 0.85 + 0.3 * hash1(i + seed, e + 5)), i * 3 + e + seed);
    g.in(M(e * (x0 + pw / 2 + 0.004), hgt / 2 + 0.015, 0, 0, 0, 90), () => g.beam(hgt, pw - 0.006, dz, 0.009, c, 4));
  }
  g.surf(K_PLAIN, 0.5, 0.85);
  const zf = dz / 2, k = half / 1.05, sl = half * 0.74;
  for (const e of [-1, 1]) {
    for (const y of [A.spring * 0.18, A.spring * 0.54, A.spring * 0.9]) {
      g.in(M(e * (half - 0.02 * k - sl / 2), y, zf + 0.006), () => g.cbox(sl, 0.052 * k, 0.014, 0.005, IRON));
      g.in(M(e * (half - 0.04 * k - sl), y, zf + 0.006, 0, 0, 45), () => g.cbox(0.075 * k, 0.075 * k, 0.014, 0.005, IRON));
      for (let i = 0; i < 6; i++) g.in(M(e * (half - 0.07 * k - (i * sl) / 6.2), y, zf + 0.013), () => g.stud(0.014 * Math.sqrt(k), IRON));
      g.in(M(e * (half - 0.012), y - 0.045 * k, zf + 0.012), () => g.cyl(0.02 * k, 0.02 * k, 0.09 * k, 8, IRON, true, true));
    }
    for (let i = 0; i < planks - 1; i++) for (const y of [A.spring * 0.36, A.spring * 0.72]) g.in(M(e * (pw / 2 + i * pw), y, zf), () => g.stud(0.016 * Math.sqrt(k), IRON));
    g.in(M(e * 0.15 * k, A.spring * 0.65, zf + 0.004, 0, 0, 45), () => g.cbox(0.085 * k, 0.085 * k, 0.012, 0.004, IRON));
    g.in(M(e * 0.15 * k, A.spring * 0.65 - 0.045 * k, zf + 0.022), () => g.add(new THREE.TorusGeometry(0.048 * k, 0.01 * k, 6, 16), IRON));
    g.in(M(e * 0.15 * k, A.spring * 0.65, zf + 0.01), () => g.stud(0.02 * k, IRON));
  }
}
/** a buttress standing d proud of z = 0 (the wall face), w wide and h tall, with a sloped weathering on top */
function buttress(g, w, d, h, st, seed, slope = 0.28) {
  const r = st.r, o = { ...st, len: [0.26, 0.46] };
  g.surf(K_STONE, 0.93);
  g.in(M(-(w / 2 - r), 0, d - r), () => g.ashlar(w - 2 * r, h, { ...o, seed, ends: [CORNER, CORNER, 0, 0] }));
  g.in(M(w / 2 - r, 0, d - r, 0, 90, 0), () => g.ashlar(d - r, h, { ...o, seed: seed + 1, ends: [CORNER, CUT, 0, 0] }));
  g.in(M(-(w / 2 - r), 0, 0, 0, -90, 0), () => g.ashlar(d - r, h, { ...o, seed: seed + 2, ends: [CUT, CORNER, 0, 0] }));
  const wf = w / 2 - 0.004, df = d - 0.004;
  g.flat([[-wf, 0.003, df], [wf, 0.003, df], [wf, -0.16, df], [-wf, -0.16, df]], mul(st.pal[0], 0.5));
  for (const sx of [-1, 1]) g.flat([[sx * wf, 0.003, 0], [sx * wf, 0.003, df], [sx * wf, -0.16, df], [sx * wf, -0.16, 0]], mul(st.pal[0], 0.5));
  const f = along([0, h - 0.012, d + 0.025], [0, h + slope, -0.01]);
  g.in(f.m, () => g.cbox(f.L, 0.05, w + 0.045, 0.012, stoneTint(mul(st.pal[0], 1.05), seed)));
  for (const sx of [-1, 1]) g.flat([[sx * (w / 2 - 0.002), h - 0.03, 0], [sx * (w / 2 - 0.002), h - 0.03, d], [sx * (w / 2 - 0.002), h + slope - 0.04, 0]], mul(st.pal[0], 0.8));
}
/** ring of voussoirs on the local XY plane: arch centred on (0, cy), intrados ri, extrados re, between angles a0 and a1 (from +X, anticlockwise) */
function voussoirs(g, cy, ri, re, a0, a1, n, st, seed, proud = 0.012) {
  for (let k = 0; k < n; k++) {
    const b0 = lerp(a0, a1, k / n), b1 = lerp(a0, a1, (k + 1) / n);
    const key = n % 2 === 1 && k === (n - 1) / 2, ro = key ? re + 0.06 : re + (k % 2 ? 0 : 0.03);
    const pts = [];
    for (const t of [0, 0.5, 1]) { const a = lerp(b0, b1, t); pts.push([Math.cos(a) * ri, cy + Math.sin(a) * ri]); }
    for (const t of [1, 0.5, 0]) { const a = lerp(b0, b1, t); pts.push([Math.cos(a) * ro, cy + Math.sin(a) * ro]); }
    g.stonePoly(pts, st, seed + k, st.r + (key ? proud * 2.4 : proud));
  }
}
/** the underside of that arch, running through the wall from z = -hd to +hd in the current frame (stone face at radius ri) */
function soffit(g, cy, ri, a0, a1, n, hd, st, seed) {
  g.in(M(0, cy, 0, 90, 0, 0), () => {
    g.bend(-(ri + st.r), () => {
      for (let k = 0; k < n; k++) {
        const b0 = lerp(a0, a1, k / n), b1 = lerp(a0, a1, (k + 1) / n);
        const u0 = (ri + st.r) * (Math.PI / 2 - b1), u1 = (ri + st.r) * (Math.PI / 2 - b0), sp = (hash1(seed, k) - 0.5) * hd * 0.6;
        g.stone(u0, -hd, u1, sp, st, GROOVE, GROOVE, CORNER, GROOVE, seed * 17 + k * 2);
        g.stone(u0, sp, u1, hd, st, GROOVE, GROOVE, GROOVE, CORNER, seed * 17 + k * 2 + 1);
      }
    });
  });
}
/** the top of a castle wall or gatehouse of length L: string course, wall-walk and both parapets */
function wallTop(g, L, st, seed) {
  const top = 2 * LEVEL_H, hw = 0.5, r = st.r, col = mul(st.pal[0], 1.03);
  // merlons sit on the tile joints so every soldier has a crenel in front of him; the half merlons at
  // the ends complete each other when two pieces butt together
  const merlons = [];
  for (let i = 0; i <= L; i++) merlons.push([Math.max(-L / 2, -L / 2 + i - 0.25), Math.min(L / 2, -L / 2 + i + 0.25)]);
  for (const s of [0, 1]) g.in(M(0, 0, 0, 0, s * 180, 0), () => {
    g.surf(K_STONE, 0.93);
    g.in(M(0, 0, hw), () => band(g, [[0, top - 0.135], [0.034, top - 0.1], [0.034, top - 0.035], [0, top - 0.004]], L, col, seed + s, 0, 0, true, true));
    g.in(M(0, top, hw), () => parapet(g, -L / 2, L / 2, merlons, st, seed + 40 + s * 7, { eL: CUT, eR: CUT }));
    for (const e of [-1, 1]) g.in(M(e * (L / 2 - r), top, e > 0 ? hw - r : hw - PAR_T + r, 0, e * 90, 0), () => g.ashlar(PAR_T - 2 * r, PAR_M, { ...st, course: PAR_C, len: [1, 1], seed: seed + 50 + s + e, ends: [CUT, CUT, 0, 0] }));
  });
  const wide = 1 - 2 * PAR_T + 0.02, pv = pavingStyle(seed + 70, { course: wide / 3 });
  g.in(M(-L / 2, top - pv.r, wide / 2, -90, 0, 0), () => g.ashlar(L, wide, { ...pv, ends: [CUT, CUT, 0, 0] }));
  const zi = hw - PAR_T;
  g.shade(-L / 2 - 1, top - 0.03, zi - 0.16, L / 2 + 1, top + 0.16, zi + 0.03, 0.34, 0.02, [2, 1]);
  g.shade(-L / 2 - 1, top - 0.03, -zi - 0.03, L / 2 + 1, top + 0.16, -zi + 0.16, 0.34, 0.02, [2, -1]);
}
/** castle plinth along X: two courses standing `pl` proud of the face at z = 0 with a weathered top */
function plinth(g, L, st, seed, corner = false, pl = 0.05, plH = 2 * COURSE) {
  const r = st.r, e = corner ? CORNER : CUT, W = corner ? L + 2 * (pl - r) : L;
  g.in(M(-W / 2, 0, pl - r), () => g.ashlar(W, plH - 0.06, { ...st, seed, len: [0.4, 0.72], ends: [e, e, 0, 0], quoin: corner ? [0.62, 0.34] : null }));
  band(g, [[pl, plH - 0.062], [0.004, plH + 0.012]], L, mul(st.pal[0], 1.03), seed + 1, corner ? 1 : 0, corner ? 1 : 0);
  if (!corner) for (const s of [-1, 1]) g.poly([[s * L / 2, -0.16, -r], [s * L / 2, plH - 0.062, -r], [s * L / 2, plH - 0.062, pl], [s * L / 2, -0.16, pl]], s, 0, 0, st.pal[0]);
  footing(g, -L / 2 - (corner ? pl : 0), L / 2 + (corner ? pl : 0), st.pal[0], pl);
}

function castleWall(L) {
  const g = new Geo(), st = castleStone(11, L > 16 ? { cell: 0.16 / qual() } : L > 8 ? { cell: 0.125 / qual() } : {});
  const r = st.r, top = 2 * LEVEL_H, hw = 0.5, plH = 2 * COURSE;
  for (const s of [0, 1]) g.in(M(0, 0, 0, 0, s * 180, 0).multiply(M(0, 0, hw)), () => {
    g.surf(K_STONE, 0.93);
    plinth(g, L, st, 20 + s * 3);
    g.in(M(-L / 2, plH, -r), () => g.ashlar(L, top - plH, { ...st, seed: 30 + s, ends: [CUT, CUT, 0, 0] }));
  });
  // closed ends: only seen where a wall stands free
  for (const e of [-1, 1]) g.in(M(e * (L / 2 - r), 0, e * (hw - r), 0, e * 90, 0), () => { g.ashlar(2 * (hw - r), top, { ...st, seed: 60 + e, cell: 0.2, ends: [CUT, CUT, 0, 0] }); footing(g, 0, 2 * (hw - r), st.pal[0], r); });
  wallTop(g, L, st, 100);
  return g;
}

function castleTower() {
  const g = new Geo(), st = castleStone(21), r = st.r;
  const hw = 1.5, top = 3 * LEVEL_H, plH = 2 * COURSE, ov = 0.09, W = 2 * (hw - r);
  const col = mul(st.pal[0], 1.03), walk = 2 * LEVEL_H;
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, hw)), () => {
    g.surf(K_STONE, 0.93);
    plinth(g, 2 * hw, st, 200 + s * 5, true);
    const holes = [[W / 2 - 0.08, 0.4, W / 2 + 0.08, 1.0], [W / 2 - 0.83, 1.2, W / 2 - 0.69, 1.6], [W / 2 + 0.69, 1.2, W / 2 + 0.83, 1.6]];
    g.in(M(-W / 2, plH, -r), () => {
      g.ashlar(W, top - plH, { ...st, seed: 230 + s, ends: [CORNER, CORNER, 0, 0], quoin: [0.56, 0.3], holes });
      for (const h of holes) g.in(M(h[0], h[1], 0), () => arrowLoop(g, h[2] - h[0], h[3] - h[1], st));
    });
    // string course level with the wall-walks, then the corbel table that carries the parapet
    band(g, [[0, walk - 0.135], [0.034, walk - 0.1], [0.034, walk - 0.035], [0, walk - 0.004]], 2 * hw, col, 240 + s, 1, 1);
    const cc = stoneTint(mul(st.pal[0], 0.97), 9 + s);
    for (let i = 0; i < 12; i++) {
      const x = -hw + 0.125 + i * 0.25;
      g.in(M(x, top - 0.085, 0.045), () => g.cbox(0.11, 0.07, 0.09, 0.012, cc));
      g.in(M(x, top - 0.15, 0.03), () => g.cbox(0.1, 0.07, 0.06, 0.012, cc));
      g.in(M(x, top - 0.21, 0.015), () => g.cbox(0.09, 0.06, 0.03, 0.01, cc));
    }
    band(g, [[0, top - 0.052], [ov + 0.016, top - 0.052], [ov + 0.016, top - 0.014], [ov, top + 0.002]], 2 * hw, col, 250 + s, 1, 1);
    g.shade(-hw - 0.2, top - 0.42, -0.05, hw + 0.2, top - 0.04, ov + 0.02, 0.38, 0.03, [1, 1]);
  });
  const a = hw + ov, ml = [[-a, -1.25], [-0.75, -0.25], [0.25, 0.75], [1.25, a]];
  g.in(M(0, top, 0), () => rim(g, a, a, ml, ml, st, 300));
  const wide = 2 * (a - PAR_T) + 0.02, pv = pavingStyle(71, { course: wide / 9, len: [0.3, 0.6] });
  g.in(M(-wide / 2, top - pv.r, wide / 2, -90, 0, 0), () => g.ashlar(wide, wide, { ...pv, ends: [CUT, CUT, 0, 0] }));
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => g.shade(-a, top - 0.03, a - PAR_T - 0.16, a, top + 0.16, a - PAR_T + 0.03, 0.34, 0.02, [2, 1]));
  // a trapdoor down into the tower, flush with the paving
  g.surf(K_WOOD, 0.85);
  const wood = woodTint(rgb(0x6b4a2e), 4);
  for (let i = 0; i < 4; i++) g.in(M(-0.5, top - 0.016, 0.33 + i * 0.105), () => g.beam(0.44, 0.04, 0.098, 0.006, wood, 2));
  g.surf(K_PLAIN, 0.5, 0.8);
  for (const x of [-0.66, -0.34]) g.in(M(x, top - 0.006, 0.49), () => g.cbox(0.035, 0.02, 0.4, 0.005, IRON));
  // a pennant on the north-east corner merlon, clear of the walk
  g.surf(K_PLAIN, 0.5, 0.85);
  g.in(M(a - 0.07, top + PAR_M + 0.04, -a + 0.07), () => { g.cyl(0.04, 0.03, 0.05, 8, IRON, false, true); pennant(g, 1.05, 0.6, 0.28, rgb(0x2f5a3c), rgb(0xd4b04a)); });
  return g;
}

function castleGate(doorHex) {
  const g = new Geo(), st = castleStone(41), r = st.r, L = 3, hw = 0.5, top = 2 * LEVEL_H, plH = 2 * COURSE;
  const A = archOf(1.05, 0.8, 0.4), half = A.half, NV = 13, pier = L / 2 - half - r;
  for (const s of [0, 1]) g.in(M(0, 0, 0, 0, s * 180, 0).multiply(M(0, 0, hw)), () => {
    g.surf(K_STONE, 0.93);
    for (const e of [-1, 1]) g.in(M(e * (L / 2 - pier / 2), 0, 0), () => plinth(g, pier, st, 400 + s * 9 + e));
    g.in(M(-L / 2, plH, -r), () => g.ashlar(L, top - plH, { ...st, seed: 410 + s, ends: [CUT, CUT, 0, 0], holes: archHoles(A, L / 2, plH, 6, r) }));
    // the lowest two courses of the jamb corners sit behind the plinth
    for (const e of [-1, 1]) g.in(M(e > 0 ? half + r : -L / 2, 0, -r), () => g.ashlar(pier, plH, { ...st, seed: 420 + s + e, ends: e > 0 ? [CORNER, CUT, 0, 0] : [CUT, CORNER, 0, 0] }));
    g.in(M(0, 0, -r), () => voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, NV, st, 430 + s * 20));
  });
  // passage: jambs and the arch soffit
  g.in(M(half + r, 0, -(hw - r), 0, -90, 0), () => { g.ashlar(2 * (hw - r), A.spring, { ...st, seed: 451, ends: [CORNER, CORNER, 0, 0] }); footing(g, -r, 2 * hw - r, st.pal[0], r); });
  g.in(M(-half - r, 0, hw - r, 0, 90, 0), () => { g.ashlar(2 * (hw - r), A.spring, { ...st, seed: 452, ends: [CORNER, CORNER, 0, 0] }); footing(g, -r, 2 * hw - r, st.pal[0], r); });
  soffit(g, A.cy, A.ri, A.a0, A.a1, NV, hw - r, st, 460);
  g.shade(-half - 0.05, 0, -hw + 0.03, half + 0.05, top, hw - 0.03, 0.5, 0.12);
  for (const e of [-1, 1]) g.in(M(e * (L / 2 - r), 0, e * (hw - r), 0, e * 90, 0), () => { g.ashlar(2 * (hw - r), top, { ...st, seed: 470 + e, cell: 0.2, ends: [CUT, CUT, 0, 0] }); footing(g, 0, 2 * (hw - r), st.pal[0], r); });
  wallTop(g, L, st, 480);
  g.surf(K_STONE, 0.95);
  g.in(M(0, -0.06, 0), () => g.cbox(2 * half, 0.17, 0.98, 0.01, stoneTint(mul(st.pal[0], 0.8), 2)));

  // the doors: two leaves of oak planks hung in the middle of the passage
  const oak = rgb(doorHex), dz = 0.07;
  archDoors(g, A, oak, 7, dz);
  // back: ledges, braces and the drawbar in its iron keeps
  g.surf(K_WOOD, 0.82);
  const dark = woodTint(mul(oak, 0.72), 9);
  for (const e of [-1, 1]) {
    for (const y of [0.2, 0.68]) g.in(M(e * (half / 2 + 0.01), y, -dz / 2 - 0.018), () => g.beam(half - 0.06, 0.09, 0.036, 0.008, dark, 3));
    g.beamTo([e * 0.08, 0.25, -dz / 2 - 0.016], [e * (half - 0.08), 0.63, -dz / 2 - 0.016], 0.08, 0.03, 0.008, dark, 3, [0, 0, 1]);
  }
  g.in(M(0, 0.45, -dz / 2 - 0.085), () => g.beam(1.76, 0.1, 0.07, 0.012, woodTint(mul(oak, 0.95), 13), 5));
  g.surf(K_PLAIN, 0.5, 0.85);
  for (const x of [-0.72, -0.24, 0.24, 0.72]) {
    g.in(M(x, 0.45, -dz / 2 - 0.085), () => { g.in(M(0, -0.062, 0), () => g.cbox(0.06, 0.016, 0.1, 0.004, IRON)); g.in(M(0, 0, -0.043), () => g.cbox(0.06, 0.14, 0.016, 0.004, IRON)); g.in(M(0, 0.01, 0.05), () => g.cbox(0.06, 0.16, 0.014, 0.004, IRON)); });
  }
  // the raised portcullis: only its teeth show under the arch
  for (let i = -4; i <= 4; i++) {
    const x = i * 0.21, y = A.y(x) - 0.13;
    g.in(M(x, y + 0.1, 0.3), () => g.cbox(0.04, 0.2, 0.04, 0.006, IRON));
    g.in(M(x, y, 0.3, 180, 0, 0), () => g.cyl(0.028, 0, 0.075, 4, IRON, false, false));
  }
  return g;
}

function castleStairs() {
  const g = new Geo(), st = castleStone(51), r = st.r, hw = 0.5, ct = 0.1;
  const low = [-1, -0.88, -0.76, -0.64];   // risers of the lower flight; the landing starts at the last
  const up = [0.64, 0.73, 0.82, 0.91];     // risers of the upper flight, which tops out level with the wall-walk
  const cheek = [0.16, 0.4, 0.64, 0.82];   // where each course of the stepped cheek walls begins
  const slab = stoneTint(mul(st.pal[0], 0.9), 4), cope = stoneTint(mul(st.pal[0], 1.05), 6);
  for (const s of [1, -1]) g.in(new THREE.Matrix4().makeScale(1, 1, s), () => {
    g.surf(K_STONE, 0.93);
    const holes = [];
    for (let j = 1; j < 4; j++) holes.push([-0.5, j * COURSE, low[j] + 1, (j + 1) * COURSE]);
    for (let i = 0; i < 4; i++) holes.push([-0.5, (i + 4) * COURSE, cheek[i] + 1, (i + 5) * COURSE]);
    g.in(M(-1 + r, 0, hw - r), () => { g.ashlar(2 - r, 8 * COURSE, { ...st, seed: 500 + s, ends: [CORNER, CUT, 0, 0], holes }); footing(g, -r, 2 - r, st.pal[0], r); });
    // cheek wall: inner face, stepped ends and coping
    const hin = [];
    for (let i = 0; i < 4; i++) hin.push([1 - cheek[i] - r, i * COURSE, 3, (i + 1) * COURSE]);
    g.in(M(1, 4 * COURSE, hw - ct + r, 0, 180, 0), () => g.ashlar(1 - cheek[0] - r, 4 * COURSE, { ...st, seed: 510 + s, ends: [CUT, CORNER, 0, 0], holes: hin }));
    for (let i = 0; i < 4; i++) {
      g.in(M(cheek[i] + r, (i + 4) * COURSE, hw - ct + r, 0, -90, 0), () => g.ashlar(ct - 2 * r, COURSE, { ...st, len: [1, 1], seed: 520 + i + s, ends: [CORNER, CORNER, 0, 0] }));
      const x0 = cheek[i] - 0.014, x1 = i < 3 ? cheek[i + 1] : 1;
      g.in(M((x0 + x1) / 2, (i + 5) * COURSE + 0.014, hw - ct / 2), () => g.cbox(x1 - x0, 0.04, ct + 0.026, 0.012, cope));
    }
  });
  g.surf(K_STONE, 0.93);
  for (let j = 0; j < 4; j++) {
    g.in(M(low[j] + r, j * COURSE, -(hw - r), 0, -90, 0), () => { g.ashlar(2 * (hw - r), COURSE, { ...st, seed: 530 + j, ends: [CORNER, CORNER, 0, 0] }); if (!j) footing(g, -r, 2 * hw - r, st.pal[0], r); });
    const x1 = j < 3 ? low[j + 1] : low[3] + 0.14;
    g.in(M((low[j] - 0.014 + x1) / 2, (j + 1) * COURSE - 0.016, 0), () => g.cbox(x1 - low[j] + 0.014, 0.032, 2 * hw + (j < 3 ? 0.02 : -2 * r), 0.01, slab));
  }
  for (let i = 0; i < 4; i++) {
    g.in(M(up[i] + r, (i + 4) * COURSE, -(hw - ct), 0, -90, 0), () => g.ashlar(2 * (hw - ct), COURSE, { ...st, seed: 540 + i, ends: [CUT, CUT, 0, 0] }));
    const x1 = i < 3 ? up[i + 1] : 1;
    g.in(M((up[i] - 0.012 + x1) / 2, (i + 5) * COURSE - 0.016, 0), () => g.cbox(x1 - up[i] + 0.012, 0.032, 2 * (hw - ct), 0.01, slab));
  }
  // the landing where the soldiers stand, exactly one level up
  const pv = pavingStyle(55), y = LEVEL_H - pv.r, xa = low[3] + 0.13;
  g.in(M(xa, y, hw - r, -90, 0, 0), () => g.ashlar(cheek[0] - xa, 2 * (hw - r), { ...pv, course: (hw - r) / 2, ends: [CUT, CUT, CUT, CUT] }));
  g.in(M(cheek[0], y, hw - ct, -90, 0, 0), () => g.ashlar(up[0] - cheek[0], 2 * (hw - ct), { ...pv, seed: 56, course: (hw - ct) / 1.5, ends: [CUT, CUT, CUT, CUT] }));
  g.in(M(1 - r, 0, hw - r, 0, 90, 0), () => { g.ashlar(2 * (hw - r), 8 * COURSE, { ...st, seed: 560, cell: 0.2, ends: [CUT, CUT, 0, 0] }); footing(g, 0, 2 * (hw - r), st.pal[0], r); });
  g.shade(cheek[0], LEVEL_H - 0.03, -hw + ct - 0.02, 1, LEVEL_H + 0.5, hw - ct + 0.02, 0.25, 0.05);
  return g;
}

// ---------- keep ----------
const SLATE = [rgb(0x4a5666), rgb(0x566272), rgb(0x3e4857), rgb(0x5e5c6a), rgb(0x4d5f68)];
function keep(hex) {
  const g = new Geo(), st = stoneStyle(hex, { seed: 61, len: [0.32, 0.6] }), r = st.r;
  const hb = 2.1, walk = 2.8, plH = 2 * COURSE, fw = 1.45, ov = 0.08;
  const tR = 0.62, tc = 1.9, tWalk = 3.4;
  const col = mul(st.pal[0], 1.03), cc = stoneTint(mul(st.pal[0], 0.97), 9);
  const A = archOf(0.42, 0.86, 0.3, 0.16), pw = 0.8, pd = 0.38, ph = 1.6;

  // ---- curtain faces between the corner turrets ----
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, hb)), () => {
    g.surf(K_STONE, 0.93);
    plinth(g, 2 * fw, st, 600 + s * 5);
    const loops = s === 0 ? [[fw - 1.2, 0.4, fw - 1.06, 1.0], [fw + 1.06, 0.4, fw + 1.2, 1.0]] : [[fw - 0.07, 0.4, fw + 0.07, 1.0]];
    const wins = [[fw - 0.56, 1.6, fw - 0.38, 2.0], [fw + 0.38, 1.6, fw + 0.56, 2.0]];
    g.in(M(-fw, plH, -r), () => {
      g.ashlar(2 * fw, walk - plH, { ...st, seed: 610 + s, ends: [CUT, CUT, 0, 0], holes: [...loops, ...wins] });
      for (const h of loops) g.in(M(h[0], h[1], 0), () => arrowLoop(g, h[2] - h[0], h[3] - h[1], st));
      for (const h of wins) g.in(M(h[0], h[1], 0), () => arrowLoop(g, h[2] - h[0], h[3] - h[1], st, 0.14, true));
    });
    band(g, [[0, 1.465], [0.034, 1.5], [0.034, 1.565], [0, 1.596]], 2 * fw, col, 620 + s);
    for (let i = 0; i < 12; i++) {
      const x = -fw + 0.12 + i * ((2 * fw - 0.24) / 11);
      g.in(M(x, walk - 0.085, 0.04), () => g.cbox(0.11, 0.07, 0.08, 0.012, cc));
      g.in(M(x, walk - 0.15, 0.027), () => g.cbox(0.1, 0.07, 0.054, 0.012, cc));
      g.in(M(x, walk - 0.21, 0.014), () => g.cbox(0.09, 0.06, 0.028, 0.01, cc));
    }
    band(g, [[0, walk - 0.052], [ov + 0.016, walk - 0.052], [ov + 0.016, walk - 0.014], [ov, walk + 0.002]], 2 * fw, col, 630 + s);
    g.shade(-fw - 0.2, walk - 0.42, -0.05, fw + 0.2, walk - 0.04, ov + 0.02, 0.38, 0.03, [1, 1]);
    // parapet between the turrets and the walk behind it
    g.in(M(0, walk, ov), () => parapet(g, -fw, fw, [[-fw, -1.16], [-0.87, -0.58], [-0.29, 0.29], [0.58, 0.87], [1.16, fw]], st, 640 + s * 11, { eL: CUT, eR: CUT }));
    const pv = pavingStyle(650 + s, { course: 0.2 });
    g.in(M(s % 2 ? -1.66 : -2.06, walk - pv.r, ov - PAR_T + 0.01, -90, 0, 0), () => g.ashlar(s % 2 ? 3.32 : 4.12, 0.4, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
    if (s === 0) {
      // the forebuilding and the great door
      g.surf(K_STONE, 0.93);
      g.in(M(0, 0, pd), () => {
        g.in(M(-(pw - r), 0, -r), () => g.ashlar(2 * (pw - r), ph, { ...st, seed: 660, ends: [CORNER, CORNER, 0, 0], quoin: [0.34, 0.2], len: [0.24, 0.4], holes: archHoles(A, pw - r, 0, 8, r) }));
        const pf = pw - 0.004;
        g.flat([[-pf, 0.003, -0.004], [pf, 0.003, -0.004], [pf, -0.16, -0.004], [-pf, -0.16, -0.004]], mul(st.pal[0], 0.5));
        for (const sx of [-1, 1]) g.flat([[sx * pf, 0.003, -0.004], [sx * pf, 0.003, -pd], [sx * pf, -0.16, -pd], [sx * pf, -0.16, -0.004]], mul(st.pal[0], 0.5));
        g.in(M(pw - r, 0, -r, 0, 90, 0), () => g.ashlar(pd - r, ph, { ...st, seed: 661, ends: [CORNER, CUT, 0, 0], len: [0.2, 0.4] }));
        g.in(M(-(pw - r), 0, -pd, 0, -90, 0), () => g.ashlar(pd - r, ph, { ...st, seed: 662, ends: [CUT, CORNER, 0, 0], len: [0.2, 0.4] }));
        g.in(M(0, 0, -r), () => voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, 9, st, 663));
        g.in(M(A.half + r, 0, -0.3, 0, -90, 0), () => g.ashlar(0.3 - r, A.spring, { ...st, seed: 664, ends: [CUT, CORNER, 0, 0], len: [0.2, 0.4] }));
        g.in(M(-A.half - r, 0, -r, 0, 90, 0), () => g.ashlar(0.3 - r, A.spring, { ...st, seed: 665, ends: [CORNER, CUT, 0, 0], len: [0.2, 0.4] }));
        g.in(M(0, 0, -(0.3 + r) / 2), () => soffit(g, A.cy, A.ri, A.a0, A.a1, 9, (0.3 - r) / 2, st, 666));
        g.shade(-A.half - 0.03, 0, -0.34, A.half + 0.03, 1.2, -0.03, 0.5, 0.06);
        g.in(M(0, 0, -0.22), () => archDoors(g, A, rgb(0x6a4a2c), 3, 0.06, 7));
        g.surf(K_STONE, 0.95);
        g.in(M(0, -0.06, -0.14), () => g.cbox(2 * A.half, 0.17, 0.3, 0.01, stoneTint(mul(st.pal[0], 0.8), 2)));
        // lean-to roof of slates over the porch
        const ya = ph - 0.02, yb = ph + 0.36;
        g.surf(K_ROOF, 0.8);
        tiles(g, 3, () => 11, (u, v) => [lerp(-pw - 0.06, pw + 0.06, u), lerp(ya, yb, v), lerp(0.07, -pd, v)], { pal: SLATE, lift: 0.02, seed: 67 });
        g.surf(K_STONE, 0.93);
        for (const sx of [-1, 1]) g.flat([[sx * pw, ph - 0.03, 0], [sx * pw, ph - 0.03, -pd], [sx * pw, yb - 0.03, -pd]], mul(st.pal[0], 0.9));
        g.in(M(0, ph - 0.02, 0.01), () => g.cbox(2 * pw + 0.07, 0.05, 0.07, 0.012, cc));
      });
    } else {
      for (const x of [-0.78, 0.78]) g.in(M(x, 0, 0), () => { buttress(g, 0.42, 0.33, 1.05, st, 670 + s * 7 + x * 3, 0.2); buttress(g, 0.34, 0.2, 1.85, st, 680 + s * 7 + x * 3, 0.3); });
    }
  });

  // ---- corner turrets ----
  for (let s = 0; s < 4; s++) {
    const an = 45 + s * 90, d = tc * Math.SQRT2;
    g.in(M(Math.sin(an * DEG) * d, 0, Math.cos(an * DEG) * d, 0, an, 0), () => {
      g.surf(K_STONE, 0.93);
      const arc = (tR - r) * 1.5 * Math.PI * 1.04, full = (tR - r) * TAU;
      const loops = [[arc / 2 - 0.07, 0.4, arc / 2 + 0.07, 1.0], [arc / 2 - 0.07, 1.6, arc / 2 + 0.07, 2.2]];
      g.bend(tR + 0.05 - r, () => g.in(M(-arc / 2, 0, 0), () => g.ashlar(arc, plH - 0.06, { ...st, seed: 700 + s, len: [0.36, 0.6], ends: [CUT, CUT, 0, 0] })));
      g.lathe([[tR + 0.05, plH - 0.062], [tR + 0.004, plH + 0.012]], 28, cc);
      g.lathe([[tR + 0.046, -0.16], [tR + 0.046, 0.003]], 28, mul(st.pal[0], 0.5));
      g.bend(tR - r, () => {
        g.in(M(-arc / 2, plH, 0), () => {
          g.ashlar(arc, walk - plH, { ...st, seed: 710 + s, ends: [CUT, CUT, 0, 0], holes: loops });
          for (const h of loops) g.in(M(h[0], h[1], 0), () => arrowLoop(g, h[2] - h[0], h[3] - h[1], st));
        });
        g.in(M(0, walk, 0), () => g.ashlar(full, tWalk - walk, { ...st, seed: 720 + s, wrap: true }));
      });
      // corbel ring and round parapet
      for (let i = 0; i < 16; i++) g.in(M(0, 0, 0, 0, i * 22.5, 0), () => {
        g.in(M(0, tWalk - 0.085, tR + 0.04), () => g.cbox(0.1, 0.07, 0.08, 0.012, cc));
        g.in(M(0, tWalk - 0.15, tR + 0.022), () => g.cbox(0.09, 0.07, 0.05, 0.012, cc));
      });
      g.lathe([[tR, tWalk - 0.052], [tR + ov + 0.016, tWalk - 0.052], [tR + ov + 0.016, tWalk - 0.014], [tR + ov, tWalk + 0.002], [tR + ov - PAR_T, tWalk + 0.002]], 32, cc);
      const Rp = tR + ov, Wp = Rp * TAU, ml = [];
      for (let i = 0; i < 8; i++) ml.push([((i + 0.24) * Wp) / 8, ((i + 0.76) * Wp) / 8]);
      g.in(M(0, tWalk, 0), () => g.bend(Rp, () => parapet(g, 0, Wp, ml, { ...st, cell: st.cell * 0.7 }, 730 + s * 13, { wrap: true })));
      // conical slate roof with a lead finial
      const rr = Rp - PAR_T - 0.03, y0 = tWalk + 0.1, rh = 1.25;
      g.surf(K_STONE, 0.93);
      g.lathe([[rr - 0.06, tWalk], [rr - 0.06, y0 + 0.02]], 24, cc);
      g.surf(K_ROOF, 0.78);
      tiles(g, 9, (j) => 26 * (1 - (j + 0.4) / 9.6) + 3, (u, v) => { const a = u * TAU, q = (rr + 0.02) * (1 - v * 0.93); return [Math.cos(a) * q, y0 + v * rh * 0.93, Math.sin(a) * q]; }, { pal: SLATE, lift: 0.02, wrap: true, seed: 74 + s });
      g.surf(K_PLAIN, 0.45, 0.75);
      const lead = rgb(0x6f7a80);
      g.in(M(0, y0 + rh * 0.9, 0), () => g.lathe([[0.075, 0], [0.05, 0.1], [0.022, 0.16], [0.034, 0.19], [0.04, 0.215], [0.03, 0.24], [0.012, 0.26], [0.008, 0.4], [0, 0.42]], 10, lead));
    });
  }

  // ---- the great roof: hipped slates over a low attic wall ----
  const aw = 1.66, ey = walk + 0.26, ry = walk + 1.62, e0 = 1.8, rl = 0.55;
  g.surf(K_STONE, 0.93);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-(aw - r), walk, aw - r)), () => g.ashlar(2 * (aw - r), ey - walk, { ...st, seed: 760 + s, course: 0.13, ends: [CORNER, CORNER, 0, 0] }));
  g.surf(K_ROOF, 0.78);
  const rows = 14, tw = 0.17;
  const faces = [
    [[-e0, ey, e0], [e0, ey, e0], [-rl, ry, 0], [rl, ry, 0]], [[e0, ey, -e0], [-e0, ey, -e0], [rl, ry, 0], [-rl, ry, 0]],
    [[e0, ey, e0], [e0, ey, -e0], [rl, ry, 0], [rl, ry, 0]], [[-e0, ey, -e0], [-e0, ey, e0], [-rl, ry, 0], [-rl, ry, 0]],
  ];
  faces.forEach(([a, b, c, d], fi) => {
    const wb = Math.hypot(b[0] - a[0], b[2] - a[2]), wt = Math.hypot(d[0] - c[0], d[2] - c[2]);
    tiles(g, rows, (j) => lerp(wb, wt, (j + 0.5) / rows) / tw, (u, v) => { const k = Math.min(v, 0.985); return [lerp(lerp(a[0], b[0], u), lerp(c[0], d[0], u), k), lerp(a[1], c[1], k), lerp(lerp(a[2], b[2], u), lerp(c[2], d[2], u), k)]; }, { pal: SLATE, lift: 0.02, seed: 77 + fi });
  });
  const lead = rgb(0x66727a);
  g.surf(K_PLAIN, 0.5, 0.7);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) ridge(g, [sx * (e0 + 0.02), ey - 0.01, sz * (e0 + 0.02)], [sx * rl, ry + 0.02, 0], 0.05, lead, 80 + sx + sz * 2);
  ridge(g, [-rl - 0.05, ry + 0.02, 0], [rl + 0.05, ry + 0.02, 0], 0.055, lead, 85);
  for (const sx of [-1, 1]) g.in(M(sx * rl, ry + 0.02, 0), () => g.lathe([[0.05, 0], [0.03, 0.08], [0.045, 0.12], [0.02, 0.17], [0, 0.3]], 8, lead));
  // dark underside so the eaves read as solid
  g.surf(K_PLAIN, 1);
  g.flat([[-e0, ey - 0.012, -e0], [e0, ey - 0.012, -e0], [e0, ey - 0.012, e0], [-e0, ey - 0.012, e0]], [0.03, 0.028, 0.026]);
  g.in(M(rl, ry + 0.2, 0), () => pennant(g, 0.95, 0.62, 0.3, rgb(0x2f5a3c), rgb(0xd4b04a)));
  return g;
}

// ---------- field wall, archway, bastion ----------
/** a face of random rubble on the local XY plane: uneven courses, skewed joints, every stone its own colour */
function rubbleFace(g, W, H, st, seed, taper = 0) {
  const rnd = rng(seed * 91 + 17);
  let v = 0, row = 0, prev = null;
  while (v < H - 1e-4) {
    let ch = 0.11 + rnd() * 0.1;
    if (H - v - ch < 0.09) ch = H - v;
    const v1 = v + ch, in0 = taper * (v / H), in1 = taper * (v1 / H);
    const cuts = [[in0, in1]];
    let x = (0.12 + rnd() * 0.22);
    while (x < W - 0.14) { const sk = (rnd() - 0.5) * 0.05; cuts.push([x - sk, x + sk]); x += 0.16 + rnd() * 0.3; }
    cuts.push([W - in0, W - in1]);
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1], mx0 = (a[0] + b[0]) / 2, mx1 = (a[1] + b[1]) / 2;
      g.stonePoly([[a[0], v], [mx0, v], [b[0], v], [(b[0] + b[1]) / 2, (v + v1) / 2], [b[1], v1], [mx1, v1], [a[1], v1], [(a[0] + a[1]) / 2, (v + v1) / 2]], st, seed * 131 + row * 37 + k, st.r * (0.8 + 0.9 * rnd()));
    }
    v = v1; row++; prev = cuts;
  }
  return prev;
}
function fieldWall(L, hex) {
  const g = new Geo(), c = rgb(hex);
  const st = stoneStyle(hex, { seed: 81, r: 0.026, b: 0.022, rough: 0.012, var: 0.2, nf: 7,
    pal: [c, mix(c, rgb(0x8f7a5c), 0.5), mix(c, rgb(0x5f6870), 0.5), mul(c, 0.78), mul(c, 1.12), mix(c, rgb(0x9a6f4a), 0.35), mix(c, rgb(0x6f7a5a), 0.3)],
    mortar: mul(mix(c, rgb(0x3a352c), 0.6), 0.35) });
  const hb = 0.47, ht = 0.36, H = 1.0, slope = Math.hypot(H, hb - ht), tilt = Math.atan2(hb - ht, H) / DEG;
  g.surf(K_STONE, 0.95);
  for (const s of [0, 1]) g.in(M(0, 0, 0, 0, s * 180, 0).multiply(M(-L / 2, 0, hb, -tilt, 0, 0)), () => { rubbleFace(g, L, slope, st, 810 + s); footing(g, 0, L, st.pal[3]); });
  for (const e of [-1, 1]) g.in(M(e * L / 2, 0, e * hb, 0, e * 90, 0), () => { rubbleFace(g, 2 * hb, H, st, 820 + e, hb - ht); footing(g, 0, 2 * hb, st.pal[3]); });
  // upright coping stones set on edge, the way a dry-stone waller finishes a wall
  const rnd = rng(83);
  let x = -L / 2;
  while (x < L / 2 - 0.02) {
    let w = 0.075 + rnd() * 0.05;
    if (L / 2 - x - w < 0.06) w = L / 2 - x;
    const h = 0.17 + rnd() * 0.1, cc = mul(st.pal[Math.floor(rnd() * st.pal.length)], 0.85 + 0.3 * rnd());
    g.in(M(x + w / 2, H + h / 2 - 0.03, (rnd() - 0.5) * 0.03, (rnd() - 0.5) * 8, 0, (rnd() - 0.5) * 12), () => g.cbox(w - 0.006, h, 2 * ht + 0.05 + rnd() * 0.05, 0.022, stoneTint(cc, x * 7, 6)));
    x += w;
  }
  g.surf(K_PLAIN, 1);
  g.flat([[-L / 2 + 0.02, H - 0.02, -ht + 0.02], [L / 2 - 0.02, H - 0.02, -ht + 0.02], [L / 2 - 0.02, H - 0.02, ht - 0.02], [-L / 2 + 0.02, H - 0.02, ht - 0.02]], st.mortar);
  // stones that have worked loose lie at its foot
  g.surf(K_STONE, 0.95);
  for (let i = 0; i < L * 2.2; i++) {
    const sx = -L / 2 + 0.15 + rnd() * (L - 0.3), sd = rnd() < 0.5 ? -1 : 1, q = 0.05 + rnd() * 0.06;
    g.in(M(sx, q * 0.35, sd * (hb + 0.0 - q * 0.2), rnd() * 40, rnd() * 180, rnd() * 30), () => g.cbox(q * 1.6, q, q * 1.2, q * 0.3, stoneTint(st.pal[Math.floor(rnd() * st.pal.length)], i)));
  }
  return g;
}

function archway(hex) {
  const g = new Geo(), st = stoneStyle(hex, { seed: 91 }), r = st.r;
  const hx = 2, hz = 1, top = 2.2, plH = 2 * COURSE, A = archOf(1.0, 1.1, 0.7, 0.24), NV = 15;
  const col = mul(st.pal[0], 1.04), cc = stoneTint(mul(st.pal[0], 1.0), 9), pier = hx - A.half - r;
  for (const s of [0, 1]) g.in(M(0, 0, 0, 0, s * 180, 0).multiply(M(0, 0, hz)), () => {
    g.surf(K_STONE, 0.93);
    for (const e of [-1, 1]) {
      // the plinth returns round the outer corner of each pier and stops at the passage
      const pl = 0.05, W = hx + pl - r - A.half;
      g.in(M(e > 0 ? A.half : -(hx + pl - r), 0, pl - r), () => g.ashlar(W, plH - 0.06, { ...st, seed: 900 + s * 9 + e, len: [0.4, 0.72], ends: e > 0 ? [CUT, CORNER, 0, 0] : [CORNER, CUT, 0, 0] }));
      g.in(M((e * (A.half + hx)) / 2, 0, 0), () => band(g, [[pl, plH - 0.062], [0.004, plH + 0.012]], hx - A.half, col, 905 + s + e, e < 0 ? 1 : 0, e > 0 ? 1 : 0));
      g.poly([[e * A.half, -0.16, -r], [e * A.half, plH - 0.062, -r], [e * A.half, plH - 0.062, pl], [e * A.half, -0.16, pl]], -e, 0, 0, st.pal[0]);
      footing(g, e > 0 ? A.half : -hx - pl, e > 0 ? hx + pl : -A.half, st.pal[0], pl);
    }
    g.in(M(-(hx - r), plH, -r), () => g.ashlar(2 * (hx - r), top - plH, { ...st, seed: 910 + s, ends: [CORNER, CORNER, 0, 0], quoin: [0.56, 0.3], holes: archHoles(A, hx - r, plH, 9, r) }));
    for (const e of [-1, 1]) g.in(M(e > 0 ? A.half + r : -(hx - r), 0, -r), () => g.ashlar(pier - r, plH, { ...st, seed: 920 + s + e, ends: [CORNER, CORNER, 0, 0] }));
    g.in(M(0, 0, -r), () => voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, NV, st, 930 + s * 20, 0.016));
    // impost blocks at the springing and a carved shield on the keystone
    for (const e of [-1, 1]) g.in(M(e * (A.half + 0.16), A.spring - 0.03, 0.012), () => g.cbox(0.36, 0.075, 0.06, 0.014, cc));
    g.in(M(0, A.cy + A.re - 0.02, 0.05), () => {
      g.add(new THREE.ExtrudeGeometry(new THREE.Shape([[-0.085, 0.11], [0.085, 0.11], [0.085, -0.01], [0, -0.12], [-0.085, -0.01]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }), cc);
      g.in(M(0, 0.03, 0.045), () => g.cbox(0.03, 0.15, 0.012, 0.005, mul(st.pal[0], 0.8)));
      g.in(M(0, 0.05, 0.045), () => g.cbox(0.11, 0.03, 0.012, 0.005, mul(st.pal[0], 0.8)));
    });
    band(g, [[0, top - 0.3], [0.03, top - 0.27], [0.03, top - 0.23], [0, top - 0.2]], 2 * hx, col, 940 + s, 1, 1);
    band(g, [[0, top - 0.06], [0.07, top - 0.06], [0.07, top - 0.014], [0.05, top + 0.002]], 2 * hx, col, 950 + s, 1, 1);
    // iron cressets either side of the arch
    for (const e of [-1, 1]) g.in(M(e * (hx - 0.48), 1.52, 0), () => cresset(g));
  });
  // short sides
  for (const e of [-1, 1]) g.in(M(0, 0, 0, 0, e * 90, 0).multiply(M(0, 0, hx)), () => {
    g.surf(K_STONE, 0.93);
    plinth(g, 2 * hz, st, 960 + e, true);
    const lp = [[hz - r - 0.07, 0.6, hz - r + 0.07, 1.2]];
    g.in(M(-(hz - r), plH, -r), () => {
      g.ashlar(2 * (hz - r), top - plH, { ...st, seed: 965 + e, ends: [CORNER, CORNER, 0, 0], quoin: [0.3, 0.56], holes: lp });
      g.in(M(lp[0][0], lp[0][1], 0), () => arrowLoop(g, 0.14, 0.6, st));
    });
    band(g, [[0, top - 0.3], [0.03, top - 0.27], [0.03, top - 0.23], [0, top - 0.2]], 2 * hz, col, 970 + e, 1, 1);
    band(g, [[0, top - 0.06], [0.07, top - 0.06], [0.07, top - 0.014], [0.05, top + 0.002]], 2 * hz, col, 975 + e, 1, 1);
  });
  // the passage: open from front to back
  g.surf(K_STONE, 0.93);
  g.in(M(A.half + r, 0, -(hz - r), 0, -90, 0), () => { g.ashlar(2 * (hz - r), A.spring, { ...st, seed: 981, ends: [CORNER, CORNER, 0, 0] }); footing(g, -r, 2 * hz - r, st.pal[0], r); });
  g.in(M(-A.half - r, 0, hz - r, 0, 90, 0), () => { g.ashlar(2 * (hz - r), A.spring, { ...st, seed: 982, ends: [CORNER, CORNER, 0, 0] }); footing(g, -r, 2 * hz - r, st.pal[0], r); });
  g.in(M(0, 0, -(hz - r) / 2), () => soffit(g, A.cy, A.ri, A.a0, A.a1, NV, (hz - r) / 2, st, 983));
  g.in(M(0, 0, (hz - r) / 2), () => soffit(g, A.cy, A.ri, A.a0, A.a1, NV, (hz - r) / 2, st, 984));
  g.shade(-A.half - 0.05, 0, -hz + 0.1, A.half + 0.05, top, hz - 0.1, 0.55, 0.3);
  // the portcullis hangs raised in its slot
  g.surf(K_PLAIN, 0.5, 0.85);
  for (let i = -4; i <= 4; i++) {
    const x = i * 0.21, y = A.y(x) - 0.15;
    g.in(M(x, y + 0.12, 0.35), () => g.cbox(0.045, 0.24, 0.045, 0.006, IRON));
    g.in(M(x, y, 0.35, 180, 0, 0), () => g.cyl(0.031, 0, 0.085, 4, IRON, false, false));
  }
  // crenellated top
  const mx = [[-hx, -1.75], [-1.25, -0.75], [-0.25, 0.25], [0.75, 1.25], [1.75, hx]].map(([a, b]) => [a < -1.9 ? a - 0.05 : a, b > 1.9 ? b + 0.05 : b]);
  const mz = [[-hz - 0.05, -0.75], [-0.25, 0.25], [0.75, hz + 0.05]];
  g.in(M(0, top, 0), () => rim(g, hx + 0.05, hz + 0.05, mx, mz, st, 990));
  const pv = pavingStyle(995, { course: 0.3, pal: st.pal.map((q) => mul(q, 0.86)), mortar: st.mortar });
  g.in(M(-hx, top - pv.r, hz, -90, 0, 0), () => g.ashlar(2 * hx, 2 * hz, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
  return g;
}
/** an iron fire basket on a wall bracket: the local origin is on the wall face, +Z out */
function cresset(g) {
  g.surf(K_PLAIN, 0.55, 0.85);
  g.tube([[0, -0.16, 0], [0, -0.14, 0.07], [0, -0.06, 0.13], [0, 0, 0.14]], 0.012, 6, IRON);
  g.in(M(0, -0.16, 0.004), () => g.cbox(0.05, 0.1, 0.012, 0.004, IRON));
  g.in(M(0, 0, 0.14), () => {
    g.lathe([[0.02, 0], [0.05, 0.015], [0.05, 0.03]], 8, IRON);
    for (let i = 0; i < 6; i++) g.in(M(0, 0, 0, 0, i * 60, 0), () => g.tube([[0.045, 0.03, 0], [0.058, 0.07, 0], [0.066, 0.12, 0]], 0.006, 4, IRON));
    g.in(M(0, 0.075, 0), () => g.add(new THREE.TorusGeometry(0.058, 0.006, 4, 12).rotateX(Math.PI / 2), IRON));
    g.in(M(0, 0.12, 0), () => g.add(new THREE.TorusGeometry(0.066, 0.007, 4, 12).rotateX(Math.PI / 2), IRON));
    g.surf(K_PLAIN, 1, 0, 0);
    g.in(M(0, 0.03, 0), () => g.lathe([[0.04, 0], [0.05, 0.04], [0.035, 0.07]], 7, [0.03, 0.02, 0.015]));
    g.surf(K_PLAIN, 1, 0, 1.8);
    const fl = (x, y) => (y > 0.16 ? [1.0, 0.42, 0.05] : y > 0.07 ? [1.0, 0.62, 0.1] : [1.0, 0.85, 0.3]);
    g.in(M(0, 0.07, 0), () => g.lathe([[0.03, 0], [0.045, 0.04], [0.036, 0.09], [0.018, 0.15], [0.006, 0.2], [0, 0.24]], 7, fl));
    g.in(M(0.018, 0.07, 0.01, 0, 40, 8), () => g.lathe([[0.02, 0], [0.026, 0.04], [0.012, 0.1], [0, 0.15]], 6, fl));
  });
}

function bastion(hex) {
  const g = new Geo(), st = stoneStyle(hex, { seed: 95, len: [0.34, 0.62] }), r = st.r, hw = 2, top = LEVEL_H;
  const col = mul(st.pal[0], 1.04), pt = 0.2;
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, hw)), () => {
    g.surf(K_STONE, 0.93);
    // a skirt of big footing stones, then the scarp
    plinth(g, 2 * hw, st, 1000 + s * 5, true, 0.06, COURSE);
    const drains = [[2 * (hw - r) * 0.25 - 0.05, 0.2, 2 * (hw - r) * 0.25 + 0.05, 0.4], [2 * (hw - r) * 0.75 - 0.05, 0.2, 2 * (hw - r) * 0.75 + 0.05, 0.4]];
    g.in(M(-(hw - r), COURSE, -r), () => {
      g.ashlar(2 * (hw - r), top - COURSE, { ...st, seed: 1010 + s, ends: [CORNER, CORNER, 0, 0], quoin: [0.6, 0.32], holes: drains });
      for (const h of drains) {
        g.surf(K_PLAIN, 1);
        g.flat([[h[0], h[1], -0.05], [h[2], h[1], -0.05], [h[2], h[3], -0.05], [h[0], h[3], -0.05]], [0.01, 0.01, 0.012]);
        g.surf(K_STONE, 0.93);
        g.in(M((h[0] + h[2]) / 2, h[1] - 0.012, 0.03), () => g.cbox(0.13, 0.03, 0.12, 0.01, stoneTint(col, 4)));
      }
    });
    // the cordon: a half-round band where scarp meets parapet
    band(g, [[0, top - 0.09], [0.022, top - 0.085], [0.04, top - 0.068], [0.046, top - 0.045], [0.04, top - 0.022], [0.022, top - 0.005], [0, top]], 2 * hw, col, 1020 + s, 1, 1);
  });
  // low parapet with an embrasure in front of every gun position
  const ml = [[-hw, -1.75], [-1.25, -0.75], [-0.25, 0.25], [0.75, 1.25], [1.75, hw]];
  g.in(M(0, top, 0), () => rim(g, hw, hw, ml, ml, st, 1030, { t: pt, course: 0.12, hB: 0.12, hM: 0.36, slope: 9 }));
  const wide = 2 * (hw - pt) + 0.02, pv = pavingStyle(1040, { course: wide / 9, len: [0.32, 0.62], pal: st.pal.map((q) => mul(q, 0.84)), mortar: st.mortar });
  g.in(M(-wide / 2, top - pv.r, wide / 2, -90, 0, 0), () => g.ashlar(wide, wide, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => g.shade(-hw, top - 0.03, hw - pt - 0.16, hw, top + 0.12, hw - pt + 0.03, 0.34, 0.02, [2, 1]));
  return g;
}

// ---------- timber ----------
const OAK = 0x4b3423;
const TERRACOTTA = [rgb(0xb5502f), rgb(0xa8452a), rgb(0xc0603a), rgb(0x9a4830), rgb(0xbb6b42), rgb(0x8f4a38)];
const SHINGLE = [rgb(0x7a6650), rgb(0x8a7862), rgb(0x6a5a4a), rgb(0x94826a), rgb(0x5e5248)];
/** a round log up +Y from the origin: ridged bark, sawn ends that show the heartwood */
function log(g, r0, r1, len, seed, o = {}) {
  const seg = o.seg || 12, vs = o.vseg || Math.max(2, Math.round(len / 0.22)), bark = o.bark || rgb(0x5d4830), heart = o.heart || rgb(0xc8a472), amp = o.amp ?? 0.1;
  const rad = (a, y, t) => lerp(r0, r1, t) * (1 + amp * (noise3(Math.cos(a) * 2.2 + seed, y * 1.6, Math.sin(a) * 2.2) - 0.5) + amp * 0.45 * (Math.abs(Math.sin(a * 5 + seed + y * 0.7)) - 0.5));
  g.surf(K_WOOD, 0.95);
  g.sheet(seg, vs, (u, v) => { const a = u * TAU, rr = rad(a, v * len, v); return [Math.cos(a) * rr, v * len, Math.sin(a) * rr]; }, (x, y, z) => mul(bark, 0.68 + 0.64 * noise3(x * 11 + seed, y * 1.4, z * 11)), true);
  for (const [on, y, t, ny] of [[o.capB, 0, 0, -1], [o.capT !== false, len, 1, 1]]) {
    if (!on) continue;
    const ce = g.v(0, y, 0, 0, ny, 0, mul(heart, 0.7));
    let pa = -1, pb = -1;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * TAU, rr = rad(a, y, t), co = Math.cos(a), si = Math.sin(a);
      const m = g.v(co * rr * 0.5, y, si * rr * 0.5, 0, ny, 0, mul(heart, 1.05)), e = g.v(co * rr, y, si * rr, 0, ny, 0, mul(heart, 0.8));
      if (k) { g.tri(ce, pa, m); g.quad(pa, pb, e, m); }
      pa = m; pb = e;
    }
  }
}
/** a log laid from point a to point b */
function logTo(g, a, b, r0, r1, seed, o) { const f = along(a, b); g.in(f.m.clone().multiply(M(-f.L / 2, 0, 0, 0, 0, -90)), () => log(g, r0, r1, f.L, seed, o)); }
/** rope through points: two-strand twist picked out in the colour */
function rope(g, pts, rad = 0.012, col = rgb(0xb89c68)) {
  g.surf(K_CLOTH, 0.95);
  const L = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) : 0), 0);
  g.tube(pts, rad, 6, (x, y, z, nx, ny, nz, t, k) => mul(col, (k + Math.floor(t * L * 40)) % 2 ? 1.05 : 0.68), false);
}
/** a ring of rope lashed round something of radius R standing along local Y */
function lashing(g, R, turns = 3, rad = 0.011) {
  for (let i = 0; i < turns; i++) { const pts = []; for (let k = 0; k <= 12; k++) { const a = (k / 12) * TAU; pts.push([Math.cos(a) * (R + rad * 0.6), (i - (turns - 1) / 2) * rad * 1.9 + Math.sin(a + i) * rad * 0.4, Math.sin(a) * (R + rad * 0.6)]); } rope(g, pts, rad); }
}
/** a cask standing on the local origin */
function barrel(g, r, h, wood, seed = 0) {
  const n = 14, prof = (v) => r * (0.83 + 0.17 * Math.sin(Math.PI * (0.08 + v * 0.84)));
  g.surf(K_WOOD, 0.85);
  g.sheet(n * 2, 6, (u, v) => { const a = u * TAU, rr = prof(v); return [Math.cos(a) * rr, v * h, Math.sin(a) * rr]; },
    (x, y, z, nx, ny, nz, u) => { const i = Math.round(u * n * 2); return i % 2 ? mul(wood, 0.8 + 0.35 * hash1((i >> 1) % n, seed)) : mul(wood, 0.38); }, true);
  g.in(M(0, h - 0.025, 0), () => g.cyl(prof(1) * 0.9, prof(1) * 0.9, 0.001, 14, woodTint(mul(wood, 0.9), seed), false, true));
  g.lathe([[prof(1) * 0.9, h - 0.025], [prof(1) * 0.93, h], [prof(1), h]], 20, mul(wood, 0.7));
  g.surf(K_PLAIN, 0.5, 0.85);
  for (const v of [0.12, 0.36, 0.64, 0.88]) g.lathe([[prof(v - 0.03) + 0.004, (v - 0.03) * h], [prof(v) + 0.007, v * h], [prof(v + 0.03) + 0.004, (v + 0.03) * h]], 20, IRON);
}
/** ledged door of vertical planks: local origin at the middle of its foot, face on +Z */
function plankDoor(g, w, h, wood, seed, n = 4) {
  g.surf(K_WOOD, 0.85);
  const pw = w / n;
  for (let i = 0; i < n; i++) g.in(M(-w / 2 + pw * (i + 0.5), h / 2, 0.02, 0, 0, 90), () => g.beam(h, pw - 0.006, 0.04, 0.007, woodTint(mul(wood, 0.85 + 0.3 * hash1(seed, i)), seed + i), 3));
  g.surf(K_PLAIN, 0.5, 0.85);
  for (const y of [h * 0.2, h * 0.8]) {
    g.in(M(-w * 0.12, y, 0.045), () => g.cbox(w * 0.7, 0.04, 0.012, 0.004, IRON));
    g.in(M(w * 0.25, y, 0.045, 0, 0, 45), () => g.cbox(0.055, 0.055, 0.012, 0.004, IRON));
    for (let i = 0; i < 4; i++) g.in(M(-w * 0.42 + i * w * 0.2, y, 0.051), () => g.stud(0.011, IRON, 5));
  }
  g.in(M(w * 0.3, h * 0.5, 0.05), () => g.add(new THREE.TorusGeometry(0.036, 0.008, 5, 12), IRON));
  g.in(M(w * 0.3, h * 0.5 + 0.036, 0.046), () => g.stud(0.016, IRON, 6));
}
/** a window: leaded glass in a timber frame, shutters folded back, an optional flower box; local origin at its centre */
function casement(g, w, h, wood, seed, shutters = true, box = false) {
  g.surf(K_PLAIN, 0.12, 0.3);
  g.flat([[-w / 2, -h / 2, 0.012], [w / 2, -h / 2, 0.012], [w / 2, h / 2, 0.012], [-w / 2, h / 2, 0.012]], [[0.015, 0.03, 0.045], [0.015, 0.03, 0.045], [0.06, 0.1, 0.13], [0.06, 0.1, 0.13]]);
  g.surf(K_PLAIN, 0.5, 0.7);
  const lead = [0.12, 0.12, 0.13];
  for (let i = 1; i < 6; i++) if (i !== 3) g.in(M(-w / 2 + (w * i) / 6, 0, 0.016), () => g.cbox(0.008, h, 0.006, 0.002, lead));
  for (let i = 1; i < 4; i++) g.in(M(0, -h / 2 + (h * i) / 4, 0.016), () => g.cbox(w, 0.008, 0.006, 0.002, lead));
  g.surf(K_WOOD, 0.88);
  const fr = woodTint(mul(wood, 1.15), seed);
  for (const e of [-1, 1]) {
    g.in(M(e * (w / 2 + 0.02), 0, 0.03, 0, 0, 90), () => g.beam(h + 0.08, 0.05, 0.06, 0.008, fr, 2));
    g.in(M(0, e * (h / 2 + 0.02), 0.03), () => g.beam(w + 0.08, 0.05, 0.06, 0.008, fr, 2));
  }
  g.in(M(0, 0, 0.026, 0, 0, 90), () => g.beam(h, 0.032, 0.04, 0.006, fr, 2));
  g.in(M(0, -h / 2 - 0.055, 0.06), () => g.beam(w + 0.18, 0.035, 0.1, 0.008, fr, 2));
  if (shutters) for (const e of [-1, 1]) g.in(M(e * (w / 2 + 0.06), 0, 0.045, 0, e * -7, 0), () => {
    const sw = w * 0.48, c0 = rgb(0x3f6a52);
    for (let i = 0; i < 3; i++) g.in(M(e * (sw / 6 + (i * sw) / 3), 0, 0, 0, 0, 90), () => g.beam(h + 0.02, sw / 3 - 0.005, 0.022, 0.005, woodTint(mul(c0, 0.8 + 0.4 * hash1(seed + i, e + 9)), seed + i), 2));
    for (const y of [-h * 0.3, h * 0.3]) g.in(M(e * sw / 2, y, 0.016), () => g.beam(sw - 0.02, 0.04, 0.014, 0.004, woodTint(mul(c0, 0.7), seed + 5), 1));
    g.surf(K_PLAIN, 0.5, 0.85);
    for (const y of [-h * 0.3, h * 0.3]) g.in(M(e * 0.012, y, 0.02), () => g.cbox(0.05, 0.02, 0.012, 0.003, IRON));
    g.surf(K_WOOD, 0.88);
  });
  if (box) {
    g.in(M(0, -h / 2 - 0.13, 0.1), () => {
      g.cbox(w + 0.06, 0.09, 0.11, 0.008, woodTint(mul(wood, 1.3), seed + 7));
      g.surf(K_LEAF, 0.9);
      const rnd = rng(seed * 3 + 1), fl = [rgb(0xd8483a), rgb(0xe8c23a), rgb(0xe9e4d8), rgb(0xc45a9a)];
      for (let i = 0; i < 9; i++) {
        const x = -w / 2 + 0.02 + ((w - 0.04) * (i + 0.5)) / 9 + (rnd() - 0.5) * 0.02, y = 0.06 + rnd() * 0.05, z = (rnd() - 0.5) * 0.05;
        g.in(M(x, y, z, rnd() * 90, rnd() * 90, 0), () => g.cbox(0.06, 0.05, 0.06, 0.02, mul(rgb(0x3f7a34), 0.8 + 0.5 * rnd())));
        if (i % 2 === 0) g.in(M(x + 0.01, y + 0.035, z + 0.02, -60, 0, 0), () => g.stud(0.018, fl[Math.floor(rnd() * fl.length)], 6, 0.5));
      }
      g.surf(K_WOOD, 0.88);
    });
  }
}
/** a small iron lantern hanging from a bracket; local origin on the wall, +Z out */
function lantern(g) {
  g.surf(K_PLAIN, 0.55, 0.85);
  g.tube([[0, 0, 0], [0, 0.03, 0.06], [0, 0.03, 0.12]], 0.009, 5, IRON);
  g.in(M(0, -0.11, 0.12), () => {
    g.lathe([[0.034, 0.1], [0.012, 0.125], [0.006, 0.14]], 6, IRON);
    g.lathe([[0.028, 0], [0.034, 0.008], [0.034, 0.014]], 6, IRON);
    for (let i = 0; i < 6; i++) g.in(M(Math.cos(i * 1.047) * 0.031, 0.055, Math.sin(i * 1.047) * 0.031), () => g.cbox(0.006, 0.09, 0.006, 0.001, IRON));
    g.surf(K_PLAIN, 1, 0, 1.6);
    g.lathe([[0.027, 0.012], [0.027, 0.1]], 6, [1.0, 0.72, 0.28]);
  });
}

function house(hex) {
  const g = new Geo(), plaster = rgb(hex), oak = rgb(OAK);
  const hx = 1.3, hz = 1.2, y0 = 0.2, yp = 1.3, ridgeY = 2.56, eZ = 1.5, eY = 1.16, vx = 1.5;
  const slope = (ridgeY - eY) / eZ, under = (z) => ridgeY - 0.07 - Math.abs(z) * slope;
  const pl = (x, y, z) => mul(plaster, 0.9 + 0.2 * fbm3(x * 5 + 2, y * 5, z * 5, 2));
  const tb = (seed) => woodTint(mul(oak, 0.85 + 0.35 * hash1(seed, 3)), seed);
  const T = (a, b, w, seed, t = 0.085) => g.beamTo([a[0], a[1], 0.022], [b[0], b[1], 0.022], t, w, 0.01, tb(seed), 3, [0, 0, 1]);
  const peg = (x, y) => g.in(M(x, y, 0.064), () => g.stud(0.012, mul(oak, 1.7), 5));
  const c = rgb(0x8a8378);
  const foot = stoneStyle(0x8a8378, { seed: 110, r: 0.022, b: 0.02, rough: 0.01, var: 0.18, nf: 7, pal: [c, mix(c, rgb(0x8f7a5c), 0.5), mix(c, rgb(0x5f6870), 0.4), mul(c, 0.8), mul(c, 1.1)], mortar: mul(c, 0.25) });

  for (let s = 0; s < 4; s++) {
    const gable = s % 2 === 1, W = gable ? hz : hx, D = gable ? hx : hz;
    g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
      g.surf(K_STONE, 0.95);
      g.in(M(-W - 0.05, 0, 0.05), () => { rubbleFace(g, 2 * W + 0.1, y0 + 0.02, foot, 1100 + s); footing(g, 0, 2 * W + 0.1, c); });
      g.surf(K_PLASTER, 0.97);
      g.sheet(14, 6, (u, v) => { const x = lerp(-W, W, u), y = lerp(y0, yp + 0.02, v); return [x, y, 0.01 * (noise3(x * 6 + s * 9, y * 6, 3) - 0.5)]; }, pl);
      if (gable) g.sheet(12, 6, (u, v) => { const x = lerp(-W, W, u), y = lerp(yp, under(x), v); return [x, y, 0.01 * (noise3(x * 6 + s * 9, y * 6, 5) - 0.5)]; }, pl);
      g.surf(K_WOOD, 0.88);
      const sd = s * 40;
      // what stands in this wall
      const door = s === 0 ? -0.5 : null, wins = s === 0 ? [0.55] : s === 2 ? [-0.6, 0.6] : s === 1 ? [0] : [-0.55];
      const posts = [];
      if (door !== null) posts.push(door - 0.32, door + 0.32);
      for (const wx of wins) posts.push(wx - 0.3, wx + 0.3);
      // sill, broken at the door
      if (door !== null) { T([-W, y0 + 0.05], [door - 0.32, y0 + 0.05], 0.1, sd + 1); T([door + 0.32, y0 + 0.05], [W, y0 + 0.05], 0.1, sd + 2); } else T([-W, y0 + 0.05], [W, y0 + 0.05], 0.1, sd + 1);
      T([-W, yp - 0.03], [W, yp - 0.03], 0.12, sd + 3, 0.095);
      for (const px of posts) { T([px, y0 + (door !== null && Math.abs(px - door) < 0.4 ? 0 : 0.1)], [px, yp - 0.09], 0.09, sd + 4 + Math.round(px * 10)); peg(px, yp - 0.03); peg(px, y0 + 0.05); }
      // rails between posts, braces in the end bays
      const all = [-W + 0.06, ...posts.sort((p, q) => p - q), W - 0.06];
      for (let i = 0; i < all.length - 1; i++) {
        const a = all[i], b = all[i + 1], mid = (a + b) / 2;
        const isDoor = door !== null && Math.abs(mid - door) < 0.1, isWin = wins.some((wx) => Math.abs(mid - wx) < 0.1);
        if (isDoor) { T([a, 1.2], [b, 1.2], 0.09, sd + 20 + i); continue; }
        if (isWin) { T([a, 0.66], [b, 0.66], 0.08, sd + 20 + i); T([a, 1.16], [b, 1.16], 0.08, sd + 30 + i); T([mid, y0 + 0.1], [mid, 0.62], 0.07, sd + 35 + i); continue; }
        T([a, 0.76], [b, 0.76], 0.08, sd + 20 + i);
        if (b - a > 0.3) { const up = i === 0 ? 1 : i === all.length - 2 ? -1 : hash1(sd, i) > 0.5 ? 1 : -1; T([up > 0 ? a : b, 0.8], [up > 0 ? b : a, yp - 0.09], 0.075, sd + 40 + i, 0.07); T([up > 0 ? b : a, y0 + 0.1], [up > 0 ? a : b, 0.72], 0.075, sd + 50 + i, 0.07); }
      }
      if (door !== null) {
        g.in(M(door, y0, 0.0), () => plankDoor(g, 0.55, 0.96, mul(oak, 1.5), 3));
        g.surf(K_STONE, 0.95);
        g.in(M(door, 0.03, 0.13), () => g.cbox(0.8, 0.34, 0.24, 0.02, stoneTint(mul(c, 1.05), 3)));
        g.in(M(door + 0.42, 1.12, 0.06), () => lantern(g));
      }
      wins.forEach((wx, i) => g.in(M(wx, 0.91, 0), () => casement(g, 0.5, 0.44, oak, sd + i, true, s === 0)));
      if (gable) {
        // gable frame: king post, collar and struts under the roof line
        g.surf(K_WOOD, 0.88);
        T([-W, yp + 0.03], [0, under(0) + 0.0], 0.11, sd + 60, 0.095); T([W, yp + 0.03], [0, under(0) + 0.0], 0.11, sd + 61, 0.095);
        T([0, yp + 0.03], [0, under(0) - 0.05], 0.1, sd + 62);
        const cy = 1.82, cw = (under(0) - cy) / slope - 0.05;
        T([-cw, cy], [cw, cy], 0.085, sd + 63);
        for (const e of [-1, 1]) { T([e * 0.55, yp + 0.03], [e * 0.55, under(0.55) - 0.06], 0.075, sd + 64 + e); T([e * 0.08, cy - 0.04], [e * 0.5, yp + 0.1], 0.065, sd + 67 + e, 0.07); peg(e * 0.55, yp); }
        peg(0, cy); peg(0, yp);
        if (s === 1) g.in(M(0, cy + 0.27, 0), () => casement(g, 0.2, 0.22, oak, sd + 9, false));
      }
    });
  }
  // corner posts
  g.surf(K_WOOD, 0.88);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * hx, (y0 + yp) / 2 + 0.03, sz * hz, 0, 0, 90), () => g.beam(yp - y0 + 0.06, 0.135, 0.135, 0.012, tb(70 + sx + sz * 2), 4));
  g.shade(-hx - 0.2, yp - 0.35, -hz - 0.2, hx + 0.2, yp + 0.1, hz + 0.2, 0.35, 0.03, [1, 1]);

  // ---- roof ----
  g.surf(K_ROOF, 0.82);
  for (const e of [1, -1]) tiles(g, 13, () => 19, (u, v) => [e * lerp(-vx, vx, u), lerp(eY, ridgeY, v), e * lerp(eZ, 0.0, v)], { pal: TERRACOTTA, round: true, lift: 0.024, seed: 120 + e });
  ridge(g, [-vx - 0.02, ridgeY + 0.015, 0], [vx + 0.02, ridgeY + 0.015, 0], 0.065, rgb(0xa8482c), 123);
  g.surf(K_WOOD, 0.9);
  for (const e of [1, -1]) {
    // boarding seen from below, rafter feet and barge boards
    g.flat([[-vx, eY - 0.012, e * eZ], [vx, eY - 0.012, e * eZ], [vx, ridgeY - 0.012, 0], [-vx, ridgeY - 0.012, 0]], mul(oak, 0.75));
    for (let i = 0; i < 9; i++) { const x = -1.36 + i * 0.34; g.beamTo([x, eY - 0.03, e * (eZ - 0.01)], [x, eY - 0.03 + 0.36 * slope, e * (eZ - 0.37)], 0.07, 0.055, 0.008, tb(130 + i), 1); }
    for (const sx of [-1, 1]) g.beamTo([sx * (vx + 0.012), eY - 0.05, e * (eZ + 0.03)], [sx * (vx + 0.012), ridgeY - 0.03, 0], 0.15, 0.035, 0.008, tb(140 + sx + e), 4);
  }
  for (const sx of [-1, 1]) g.in(M(sx * (vx + 0.012), ridgeY - 0.14, 0), () => g.cbox(0.05, 0.42, 0.06, 0.012, tb(150 + sx)));

  // ---- chimney: a stone stack built against the west gable, breaking through the slope ----
  const cs = stoneStyle(0x8f8778, { seed: 160, course: 0.13, len: [0.16, 0.3], r: 0.014, b: 0.012, var: 0.16, cell: 0.12 / qual() });
  const cz = 0.52, cw = 0.26, cd = 0.13, cx = -hx - 0.07, ch = 3.02;
  g.surf(K_STONE, 0.95);
  for (let f = 0; f < 4; f++) {
    const wide = f % 2 === 0 ? cw : cd, out = f % 2 === 0 ? cd : cw;
    g.in(M(cx, -0.13, cz, 0, f * 90 - 90, 0).multiply(M(-(wide - cs.r), 0, out - cs.r)), () => g.ashlar(2 * (wide - cs.r), ch + 0.13, { ...cs, seed: 161 + f, ends: [CORNER, CORNER, 0, 0] }));
  }
  g.in(M(cx, ch + 0.03, cz), () => g.cbox(2 * cd + 0.09, 0.07, 2 * cw + 0.09, 0.014, stoneTint(mul(cs.pal[0], 1.05), 5)));
  g.surf(K_PLAIN, 0.9);
  for (const dz of [-0.11, 0.11]) g.in(M(cx, ch + 0.06, cz + dz), () => { g.lathe([[0.06, 0], [0.05, 0.06], [0.044, 0.15], [0.056, 0.17], [0.056, 0.19], [0.036, 0.19]], 10, (x, y) => mul(rgb(0xa4553a), y > 0.12 ? 0.55 : 1)); g.cyl(0.036, 0.036, 0.185, 8, [0.01, 0.01, 0.01], false, true); });
  g.shade(cx - 0.3, ch - 0.35, cz - 0.4, cx + 0.3, ch + 0.4, cz + 0.4, 0.4, 0.05, [1, 1]);

  // ---- things left about the yard, all under the eaves ----
  g.in(M(1.08, 0, 1.33), () => barrel(g, 0.15, 0.4, rgb(0x7a5a38), 3));
  const rnd = rng(170);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {
    const x = -1.12 + row * 0.05 + i * 0.1, y = 0.05 + row * 0.088;
    g.in(M(x, y, -hz - 0.24 + (rnd() - 0.5) * 0.03, 90, 0, 0), () => log(g, 0.048, 0.046, 0.22 + rnd() * 0.03, row * 9 + i, { seg: 8, vseg: 1, capB: true, amp: 0.16 }));
  }
  return g;
}

const THATCH = rgb(0xc9a558);
function hut(hex) {
  const g = new Geo(), wood = rgb(hex), hw = 0.8, wallH = 0.86, eaveY = 0.78, ridgeY = 1.74, R = 1.02, rl = 0.3;
  const post = rgb(0x4f3b28);
  // ---- wattle walls: withies woven round upright stakes ----
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, hw)), () => {
    g.surf(K_WOOD, 0.95);
    const stakes = 9, rows = 9;
    g.sheet(stakes * 4, rows * 3, (u, v) => {
      const row = Math.min(rows - 1, Math.floor(v * rows)), fr = v * rows - row, over = Math.sin(u * stakes * Math.PI) * (row % 2 ? 1 : -1);
      return [lerp(-hw, hw, u), v * (wallH + 0.1) - 0.1, 0.012 * over + 0.016 * Math.sqrt(Math.max(0, Math.sin(fr * Math.PI)))];
    }, (x, y, z, nx, ny, nz, u, v) => { const row = Math.min(rows - 1, Math.floor(v * rows)), fr = v * rows - row; return mul(wood, (0.42 + 0.7 * Math.sin(fr * Math.PI)) * (0.8 + 0.4 * hash1(row, s + 3)) * (0.9 + 0.2 * noise3(x * 9, y * 2, s))); });
    for (let i = 1; i < stakes; i += 2) g.in(M(-hw + (2 * hw * i) / stakes, 0, 0.012), () => log(g, 0.02, 0.018, wallH + 0.02, i + s * 7, { seg: 6, vseg: 2, bark: mul(post, 1.2) }));
    if (s === 0) {
      // door: three rough planks on leather hinges, a slab for a step
      g.surf(K_WOOD, 0.9);
      for (const e of [-1, 1]) g.in(M(e * 0.27, 0, 0.03), () => log(g, 0.045, 0.04, wallH + 0.02, 5 + e, { seg: 8, bark: post }));
      logTo(g, [-0.33, wallH - 0.04, 0.035], [0.33, wallH - 0.04, 0.035], 0.04, 0.036, 9, { seg: 8, capB: true, bark: post });
      for (let i = 0; i < 3; i++) g.in(M(-0.15 + i * 0.15, 0.4, 0.03, 0, 0, 90), () => g.beam(0.76, 0.143, 0.035, 0.008, woodTint(mul(rgb(0x7a5c3a), 0.85 + 0.3 * hash1(i, 7)), i), 3));
      for (const y of [0.2, 0.62]) g.in(M(0, y, 0.052), () => g.beam(0.42, 0.06, 0.02, 0.006, woodTint(rgb(0x5a4028), y * 9), 2));
      g.surf(K_PLAIN, 0.6, 0.8);
      g.in(M(0.12, 0.42, 0.065), () => g.add(new THREE.TorusGeometry(0.028, 0.007, 5, 10), IRON));
      g.surf(K_STONE, 0.95);
      g.in(M(0, -0.03, 0.1), () => g.cbox(0.5, 0.15, 0.2, 0.02, stoneTint(rgb(0x8a8378), 3)));
    }
    if (s === 1) {
      // a shuttered window hole
      g.surf(K_PLAIN, 1);
      g.flat([[-0.13, 0.4, 0.034], [0.13, 0.4, 0.034], [0.13, 0.64, 0.034], [-0.13, 0.64, 0.034]], [0.012, 0.01, 0.008]);
      g.surf(K_WOOD, 0.9);
      for (const [a, b] of [[[-0.16, 0.38], [0.16, 0.38]], [[-0.16, 0.66], [0.16, 0.66]], [[-0.15, 0.36], [-0.15, 0.68]], [[0.15, 0.36], [0.15, 0.68]]]) g.beamTo([a[0], a[1], 0.045], [b[0], b[1], 0.045], 0.04, 0.045, 0.008, woodTint(post, a[0] * 5 + a[1]), 1, [0, 0, 1]);
      g.in(M(0.3, 0.52, 0.05, 0, -12, 0), () => { for (let i = 0; i < 2; i++) g.in(M(-0.065 + i * 0.13, 0, 0, 0, 0, 90), () => g.beam(0.28, 0.125, 0.022, 0.005, woodTint(rgb(0x6a5236), i + 3), 2)); });
    }
  });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * hw, -0.12, sz * hw), () => log(g, 0.07, 0.06, wallH + 0.16, sx * 3 + sz, { seg: 10, bark: post }));
  g.shade(-1.1, wallH - 0.4, -1.1, 1.1, wallH + 0.1, 1.1, 0.45, 0.03, [1, 1]);

  // ---- thatch: three coats of reed, each standing proud of the one beneath ----
  const N = 112;
  const sq = (a) => R / Math.pow(Math.cos(a) ** 4 + Math.sin(a) ** 4, 0.25);
  const at = (a, k, out) => {
    const rb = sq(a), bx = Math.cos(a) * rb, bz = Math.sin(a) * rb, rx = clamp(Math.cos(a) * 3, -1, 1) * rl;
    const y = lerp(eaveY, ridgeY, Math.pow(k, 0.86)) + 0.11 * Math.sin(Math.PI * k);
    return [lerp(bx, rx, k) + Math.cos(a) * out, y + out * 0.7, lerp(bz, 0, k) + Math.sin(a) * out];
  };
  const reed = (seedv) => (x, y, z, nx, ny, nz, u, v) => {
    const i = Math.round(u * N), h = hash1(i % N, seedv), grey = smooth(0.45, 0.8, noise3(x * 2.2 + seedv, y * 2.2, z * 2.2));
    const c = mix(mul(THATCH, 0.7 + 0.5 * h), rgb(0x9a8a60), grey * 0.45);
    return mul(c, (i % 2 ? 1 : 0.7) * (0.72 + 0.28 * v));
  };
  g.surf(K_ROOF, 0.98);
  for (const [k0, k1, lift, sd] of [[0, 0.46, 0.05, 1], [0.3, 0.78, 0.05, 2], [0.6, 1, 0.045, 3]]) {
    g.sheet(N, 6, (u, v) => { const i = Math.round(u * N) % N, rag = 0.035 * hash1(i, sd + 20), k = lerp(k0 + rag * (k0 > 0 ? 1 : 0.4), k1, v); return at(u * TAU, k, lift * (1 - v) + (i % 2 ? 0.007 : 0)); }, reed(sd), true);
    // the cut ends of the coat
    g.sheet(N, 1, (u, v) => { const i = Math.round(u * N) % N, rag = 0.035 * hash1(i, sd + 20), k = k0 + rag * (k0 > 0 ? 1 : 0.4); return at(u * TAU, k + v * 0.012, lift * (1 - v * 1.15) + (i % 2 ? 0.007 : 0) - v * 0.012); }, (x, y, z, nx, ny, nz, u) => mul(THATCH, 0.3 + 0.2 * hash1(Math.round(u * N), 5)), true);
  }
  // underside of the eaves
  g.surf(K_PLAIN, 1);
  g.sheet(48, 1, (u, v) => { const a = u * TAU, p = at(a, 0.02, 0.0); return v ? [Math.cos(a) * hw * 1.1, wallH + 0.02, Math.sin(a) * hw * 1.1] : [p[0], p[1] - 0.015, p[2]]; }, mul(THATCH, 0.16), true);
  // ridge roll bound down with hazel rods, crossed spars at each end
  g.surf(K_ROOF, 0.98);
  const rp = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8, x = lerp(-rl - 0.14, rl + 0.14, t); rp.push([x, ridgeY + 0.1 - 0.05 * Math.pow(Math.abs(t - 0.5) * 2, 3), 0]); }
  g.tube(rp, rp.map((_, i) => 0.1 * (0.55 + 0.45 * Math.sin((i / 8) * Math.PI))), 12, (x, y, z, nx, ny, nz, t, k) => mul(THATCH, (k % 2 ? 0.95 : 0.6) * (0.8 + 0.3 * hash1(k, 3))), true);
  g.surf(K_WOOD, 0.9);
  for (const x of [-0.22, 0, 0.22]) { const pts = []; for (let k = 0; k <= 8; k++) { const a = -0.3 + (k / 8) * (Math.PI + 0.6); pts.push([x, ridgeY + 0.09 + Math.sin(a) * 0.105, Math.cos(a) * 0.115]); } g.tube(pts, 0.009, 5, mul(post, 1.3), false); }
  for (const e of [-1, 1]) for (const q of [-1, 1]) g.beamTo([e * (rl + 0.1), ridgeY - 0.06, q * 0.2], [e * (rl + 0.1), ridgeY + 0.34, -q * 0.13], 0.03, 0.03, 0.008, woodTint(post, e + q * 3), 1);

  // ---- about the door ----
  g.in(M(-0.55, 0, 0.9), () => { g.surf(K_PLAIN, 0.8); g.lathe([[0.05, 0], [0.085, 0.05], [0.09, 0.11], [0.06, 0.17], [0.05, 0.2], [0.062, 0.215], [0.04, 0.215]], 12, (x, y) => mul(rgb(0x9a5a3a), 0.8 + 0.3 * noise3(x * 30, y * 30, 1))); });
  const rnd = rng(210);
  for (let row = 0; row < 2; row++) for (let i = 0; i < 4 - row; i++) g.in(M(0.42 + row * 0.045 + i * 0.09, 0.045 + row * 0.08, 0.77, 90, 0, 0), () => log(g, 0.044, 0.042, 0.2 + rnd() * 0.02, row * 9 + i + 40, { seg: 8, vseg: 1, capB: true, amp: 0.16 }));
  return g;
}

/** a ladder from foot a to head b: two poles and round rungs */
function ladder(g, a, b, wide, step, wood, seed) {
  const f = along(a, b);
  g.in(f.m, () => {
    g.surf(K_WOOD, 0.9);
    for (const e of [-1, 1]) g.in(M(0, 0, e * wide / 2), () => g.beam(f.L, 0.05, 0.035, 0.01, woodTint(mul(wood, 0.8), seed + e), 5));
    const n = Math.floor((f.L - 0.2) / step);
    for (let i = 0; i <= n; i++) g.in(M(-f.L / 2 + 0.16 + i * step, 0, -wide / 2 - 0.03, 90, 0, 0), () => g.cyl(0.016, 0.016, wide + 0.06, 6, woodTint(wood, seed + i), true, true));
  });
}
function watchtower(hex) {
  const g = new Geo(), wood = rgb(hex), dark = mul(wood, 0.6), deck = 2 * LEVEL_H, pb = 0.88, pt = 0.82, roofY = 2.74, apex = 3.5, hd = 0.95;
  const tb = (seed, k = 1) => woodTint(mul(wood, k * (0.85 + 0.3 * hash1(seed, 3))), seed);
  const px = (y) => lerp(pb, pt, y / roofY);
  // four whole logs for legs, splayed a little and carried up to hold the roof
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    logTo(g, [sx * pb, 0, sz * pb], [sx * pt, roofY + 0.05, sz * pt], 0.085, 0.07, sx * 3 + sz, { seg: 12, bark: mul(dark, 0.9), amp: 0.07 });
    g.in(M(sx * px(0.02), -0.05, sz * px(0.02)), () => { g.surf(K_STONE, 0.95); g.cbox(0.3, 0.22, 0.3, 0.03, stoneTint(rgb(0x85807a), sx + sz * 2)); });
  }
  // girts and cross braces on three sides; the fourth is left open for the ladder
  g.surf(K_WOOD, 0.9);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    const z = (y) => px(y) - 0.02;
    for (const y of [0.78, deck - 0.2]) g.beamTo([-px(y), y, z(y)], [px(y), y, z(y)], 0.09, 0.06, 0.01, tb(s * 9 + y * 10, 0.8), 3);
    if (s !== 0) {
      g.beamTo([-px(0.12) + 0.03, 0.12, z(0.12) + 0.03], [px(0.72) - 0.03, 0.72, z(0.72) + 0.03], 0.075, 0.045, 0.008, tb(s * 9 + 1, 0.75), 3);
      g.beamTo([px(0.12) - 0.03, 0.12, z(0.12) + 0.075], [-px(0.72) + 0.03, 0.72, z(0.72) + 0.075], 0.075, 0.045, 0.008, tb(s * 9 + 2, 0.75), 3);
      g.beamTo([-px(0.84) + 0.03, 0.84, z(0.84) + 0.03], [px(1.36) - 0.03, 1.36, z(1.36) + 0.03], 0.075, 0.045, 0.008, tb(s * 9 + 3, 0.75), 3);
      g.beamTo([px(0.84) - 0.03, 0.84, z(0.84) + 0.075], [-px(1.36) + 0.03, 1.36, z(1.36) + 0.075], 0.075, 0.045, 0.008, tb(s * 9 + 4, 0.75), 3);
    }
    // knee braces up to the roof plate, and the plate itself
    g.beamTo([-pt, roofY - 0.04, pt], [pt, roofY - 0.04, pt], 0.1, 0.08, 0.012, tb(s * 9 + 5, 0.8), 3);
    for (const e of [-1, 1]) g.beamTo([e * (pt - 0.02), roofY - 0.4, pt], [e * (pt - 0.38), roofY - 0.07, pt], 0.06, 0.05, 0.008, tb(s * 9 + 6 + e, 0.75), 2);
  });
  // ---- the fighting deck: joists, then boards whose tops are exactly two levels up ----
  for (const zz of [-0.74, 0.74]) g.in(M(0, deck - 0.115, zz), () => g.beam(2 * hd + 0.14, 0.1, 0.09, 0.012, tb(50 + zz, 0.7), 4));
  for (let i = 0; i < 5; i++) g.in(M(-0.8 + i * 0.4, deck - 0.0675 - 0.0, 0, 0, 90, 0), () => g.beam(2 * hd + 0.1, 0.045, 0.07, 0.008, tb(60 + i, 0.72), 3));
  const rnd = rng(220);
  for (let i = 0; i < 10; i++) {
    const w = (2 * hd) / 10, len = 2 * hd + (rnd() - 0.3) * 0.06;
    g.in(M((rnd() - 0.5) * 0.03, deck - 0.0225, -hd + w * (i + 0.5)), () => g.beam(len, 0.045, w - 0.008, 0.007, tb(70 + i), 5));
    g.surf(K_PLAIN, 0.6, 0.8);
    for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) g.in(M(x, deck - 0.0025, -hd + w * (i + 0.5), -90, 0, 0), () => g.stud(0.009, IRON, 5, 0.25));
    g.surf(K_WOOD, 0.9);
  }
  // ---- breastwork of upright boards on rails; a gap at the ladder head ----
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    const zr = px(deck + 0.3) - 0.01;
    const spans = s === 0 ? [[-pt + 0.04, -0.24], [0.24, pt - 0.04]] : [[-pt + 0.04, pt - 0.04]];
    for (const [a, b] of spans) {
      g.beamTo([a, deck + 0.44, zr], [b, deck + 0.44, zr], 0.055, 0.05, 0.008, tb(90 + s, 0.8), 3);
      g.beamTo([a, deck + 0.16, zr], [b, deck + 0.16, zr], 0.05, 0.045, 0.008, tb(95 + s, 0.8), 3);
      const n = Math.round((b - a) / 0.165);
      for (let i = 0; i < n; i++) {
        const x = a + ((b - a) * (i + 0.5)) / n, h = 0.5 + 0.06 * hash1(i, s + 30), w = (b - a) / n - 0.02;
        g.in(M(x, deck + h / 2 - 0.03, zr + 0.04, 0, 0, 90), () => g.beam(h, w, 0.025, 0.006, tb(100 + s * 20 + i), 3));
        g.surf(K_PLAIN, 0.6, 0.8);
        for (const y of [deck + 0.16, deck + 0.44]) g.in(M(x, y, zr + 0.053), () => g.stud(0.009, IRON, 5, 0.5));
        g.surf(K_WOOD, 0.9);
      }
    }
    if (s === 0) for (const e of [-1, 1]) g.in(M(e * 0.24, deck, zr, 0, 0, 0), () => g.in(M(0, 0.25, 0, 0, 0, 90), () => g.beam(0.5, 0.055, 0.055, 0.01, tb(110 + e, 0.8), 2)));
  });
  ladder(g, [0, -0.1, 0.99], [0, deck + 0.42, px(deck) + 0.06], 0.36, 0.2, wood, 7);
  // ---- roof: wooden shingles on a pyramid frame ----
  const er = 1.14, ey = roofY - 0.03;
  g.surf(K_ROOF, 0.9);
  for (let s = 0; s < 4; s++) {
    const c = Math.cos(s * Math.PI / 2), si = Math.sin(s * Math.PI / 2), rot = (x, z) => [x * c + z * si, -x * si + z * c];
    tiles(g, 8, (j) => (2 * er * (1 - (j + 0.5) / 8.3)) / 0.15, (u, v) => { const k = Math.min(v, 0.97), [x, z] = rot(lerp(-er, er, u) * (1 - k), er * (1 - k)); return [x, lerp(ey, apex, k), z]; }, { pal: SHINGLE, lift: 0.022, seed: 230 + s, gap: 0.1 });
    g.surf(K_WOOD, 0.9);
    const [x0, z0] = rot(-er, er), [x1, z1] = rot(er, er);
    g.flat([[x0, ey - 0.014, z0], [x1, ey - 0.014, z1], [0, apex - 0.02, 0]], mul(wood, 0.38));
    g.beamTo([x1, ey + 0.012, z1], [0, apex + 0.012, 0], 0.05, 0.06, 0.012, tb(240 + s, 0.62), 4);
    g.beamTo([x0 * 0.98, ey - 0.03, z0 * 0.98], [x1 * 0.98, ey - 0.03, z1 * 0.98], 0.06, 0.035, 0.008, tb(245 + s, 0.7), 4);
    g.surf(K_ROOF, 0.9);
  }
  g.surf(K_WOOD, 0.9);
  g.in(M(0, apex - 0.06, 0), () => g.lathe([[0.05, 0], [0.04, 0.1], [0.022, 0.14], [0.036, 0.18], [0.03, 0.22], [0.01, 0.26], [0, 0.42]], 8, tb(250, 0.6)));
  // a lantern under the roof, a shield and a coil of rope on the breastwork
  g.surf(K_PLAIN, 0.55, 0.85);
  g.tube([[0, apex - 0.3, 0], [0, roofY + 0.2, 0]], 0.006, 4, IRON, false);
  g.in(M(0, roofY + 0.19, -0.12, 0, 0, 0), () => lantern(g));
  g.in(M(px(deck + 0.3) + 0.06, deck + 0.24, 0.1, 0, 90, 0), () => {
    g.surf(K_WOOD, 0.8);
    g.lathe([[0, 0.05], [0.07, 0.045], [0.15, 0.03], [0.2, 0.012], [0.2, 0]].reverse().map(([rr, y]) => [rr, y]), 20, (x, y, z) => (Math.atan2(z, x) + 6.3) % 1.571 < 0.785 ? rgb(0xc9b25a) : rgb(0x3d5a44));
    g.surf(K_PLAIN, 0.45, 0.85);
    g.lathe([[0.2, 0], [0.21, 0.008], [0.2, 0.018], [0.185, 0.016]], 20, IRON);
    g.in(M(0, 0.045, 0), () => g.lathe([[0.055, 0], [0.04, 0.03], [0, 0.045]], 10, rgb(0x8a8f96)));
  });
  return g;
}

function raisedDeck(L, D, hex) {
  const g = new Geo(), wood = rgb(hex), top = LEVEL_H, hx = L / 2, hz = D / 2;
  const tb = (seed, k = 1) => woodTint(mul(wood, k * (0.85 + 0.3 * hash1(seed, 3))), seed);
  const rnd = rng(260), nb = Math.max(2, Math.round(L / 2)) + 1;
  // trestles: posts on pad stones, a bearer along each side, braces every way
  for (let i = 0; i < nb; i++) {
    const x = lerp(-hx + 0.12, hx - 0.12, i / (nb - 1));
    for (const e of [-1, 1]) {
      g.surf(K_STONE, 0.95);
      g.in(M(x, -0.05, e * (hz - 0.14)), () => g.cbox(0.26, 0.21, 0.26, 0.025, stoneTint(rgb(0x85807a), i + e)));
      g.surf(K_WOOD, 0.9);
      g.in(M(x, 0.33, e * (hz - 0.14), 0, 0, 90), () => g.beam(0.56, 0.13, 0.13, 0.014, tb(i * 4 + e, 0.72), 3));
      if (i < nb - 1) g.beamTo([x + 0.07, 0.2, e * (hz - 0.14)], [x + 0.42, 0.56, e * (hz - 0.14)], 0.07, 0.06, 0.008, tb(20 + i + e, 0.7), 2);
      if (i > 0) g.beamTo([x - 0.07, 0.2, e * (hz - 0.14)], [x - 0.42, 0.56, e * (hz - 0.14)], 0.07, 0.06, 0.008, tb(30 + i + e, 0.7), 2);
      g.in(M(x, 0.52, e * (hz - 0.14)), () => lashing(g, 0.095, 3));
    }
    g.surf(K_WOOD, 0.9);
    g.beamTo([x, 0.1, -(hz - 0.16)], [x, 0.56, hz - 0.16], 0.07, 0.045, 0.008, tb(40 + i, 0.68), 3, [1, 0, 0]);
    g.beamTo([x + 0.05, 0.1, hz - 0.16], [x + 0.05, 0.56, -(hz - 0.16)], 0.07, 0.045, 0.008, tb(45 + i, 0.68), 3, [1, 0, 0]);
  }
  for (const e of [-1, 1]) g.in(M(0, 0.655, e * (hz - 0.14)), () => g.beam(L - 0.04, 0.09, 0.14, 0.014, tb(50 + e, 0.75), Math.round(L * 2)));
  const nj = Math.round(L / 0.45);
  for (let i = 0; i <= nj; i++) g.in(M(lerp(-hx + 0.06, hx - 0.06, i / nj), 0.7275, 0, 0, 90, 0), () => g.beam(D - 0.02, 0.055, 0.075, 0.008, tb(60 + i, 0.72), 3));
  // boards: laid across, butted over the joists, their tops exactly one level up
  const nbz = Math.round(D / 0.2), bw = D / nbz;
  for (let j = 0; j < nbz; j++) {
    const z = -hz + bw * (j + 0.5);
    let x = -hx;
    while (x < hx - 1e-4) {
      let len = 1.3 + rnd() * 1.2;
      if (hx - x - len < 0.7) len = hx - x;
      g.surf(K_WOOD, 0.88);
      g.in(M(x + len / 2, top - 0.0225, z), () => g.beam(len - 0.006, 0.045, bw - 0.008, 0.007, tb(80 + j * 7 + Math.round(x * 10)), Math.max(2, Math.round(len * 3))));
      g.surf(K_PLAIN, 0.6, 0.8);
      for (const xx of [x + 0.05, x + len - 0.05]) for (const dz of [-bw * 0.25, bw * 0.25]) g.in(M(xx, top - 0.0025, z + dz, -90, 0, 0), () => g.stud(0.009, IRON, 5, 0.25));
      x += len;
    }
  }
  g.surf(K_WOOD, 0.9);
  ladder(g, [hx - 0.012, 0, hz - 0.45], [hx - 0.06, top - 0.01, hz - 0.45], 0.34, 0.2, wood, 3);
  ladder(g, [-hx + 0.012, 0, -hz + 0.45], [-hx + 0.06, top - 0.01, -hz + 0.45], 0.34, 0.2, wood, 5);
  g.shade(-hx, 0, -hz, hx, top - 0.06, hz, 0.45, 0.1);
  return g;
}

function palisade(L, hex) {
  const g = new Geo(), wood = rgb(hex), rnd = rng(270), n = Math.round(L * 3);
  const pale = rgb(0xd0b07c);
  // an earth bank heaped against the foot of the logs
  g.surf(K_PLAIN, 1);
  g.sheet(Math.round(L * 6), 8, (u, v) => {
    const x = lerp(-L / 2, L / 2, u), z = lerp(-0.47, 0.47, v), e = Math.min(1, (1 - Math.abs(u * 2 - 1)) * L * 4);
    const y = 0.21 * Math.pow(Math.max(0, 1 - (z / 0.47) ** 2), 0.8) * (0.7 + 0.5 * noise3(x * 3, 2, z * 3)) * (0.55 + 0.45 * e);
    return [x, y - 0.03, z];
  }, (x, y, z) => mix(mul(rgb(0x5c4a34), 0.75 + 0.5 * noise3(x * 7, 1, z * 7)), rgb(0x55783a), smooth(0.5, 0.75, noise3(x * 2.5 + 4, 3, z * 2.5)) * 0.8));
  // the stakes: whole trunks, bark left on, tops hewn to a point
  const tops = [];
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (L * (i + 0.5)) / n, r = (L / n) * (0.47 + 0.08 * rnd()), h = 1.42 + rnd() * 0.25, lean = (rnd() - 0.5) * 5, lz = (rnd() - 0.5) * 4, zz = (rnd() - 0.5) * 0.04;
    const bark = mul(wood, 0.62 + 0.3 * rnd());
    g.in(M(x, -0.14, zz, lz, rnd() * 360, lean), () => {
      log(g, r, r * 0.9, h, i * 7 + 3, { seg: Math.round(18 * Math.sqrt(qual())), vseg: 8, bark, capT: false, amp: 0.12 });
      // four or five axe cuts make the point
      const k = 4 + (i % 2), rt = r * 0.9, th = 0.2 + rnd() * 0.1, off = [(rnd() - 0.5) * rt * 0.5, (rnd() - 0.5) * rt * 0.5];
      g.surf(K_WOOD, 0.85);
      for (let q = 0; q < k; q++) {
        const a0 = (q / k) * TAU, a1 = ((q + 1) / k) * TAU, am = (a0 + a1) / 2, c = mul(pale, 0.75 + 0.35 * hash1(i, q));
        g.flat([[Math.cos(a0) * rt, h - 0.005, Math.sin(a0) * rt], [Math.cos(am) * rt * 1.04, h - 0.005, Math.sin(am) * rt * 1.04], [Math.cos(a1) * rt, h - 0.005, Math.sin(a1) * rt], [off[0], h + th, off[1]]], [mul(c, 0.8), mul(c, 0.8), mul(c, 0.8), mul(c, 1.15)]);
      }
    });
    tops.push([x, h - 0.14, r, zz]);
  }
  // split-log rails behind, every stake lashed to them
  for (const y of [0.42, 1.02]) {
    logTo(g, [-L / 2 + 0.02, y, -0.2], [L / 2 - 0.02, y, -0.2], 0.06, 0.055, y * 10, { seg: 8, capB: true, bark: mul(wood, 0.55) });
    for (const [x, , r, zz] of tops) rope(g, [[x - r * 0.75, y - 0.05, -0.25], [x - r * 0.9, y, zz + 0.02], [x - r * 0.3, y + 0.02, zz + r * 0.97], [x + r * 0.3, y - 0.02, zz + r * 0.97], [x + r * 0.9, y, zz + 0.02], [x + r * 0.75, y + 0.05, -0.25]], 0.011);
  }
  // raking shores brace it from both sides
  const ns = Math.max(1, Math.round(L / 1.6));
  for (let i = 0; i < ns; i++) {
    const x = -L / 2 + (L * (i + 0.5)) / ns;
    logTo(g, [x + 0.12, -0.1, -0.48], [x + 0.12, 0.98, -0.24], 0.05, 0.042, i + 30, { seg: 8, capB: true, bark: mul(wood, 0.6) });
    logTo(g, [x - 0.3, -0.1, 0.5], [x - 0.3, 0.62, 0.17], 0.045, 0.04, i + 40, { seg: 8, capB: true, bark: mul(wood, 0.6) });
  }
  return g;
}

/** a cart wheel lying in the local XY plane, hub on the origin */
function wheel(g, R, wood) {
  g.surf(K_WOOD, 0.9);
  g.add(new THREE.TorusGeometry(R, R * 0.085, 6, 28), (x, y, z) => mul(wood, 0.75 + 0.4 * noise3(x * 9, y * 9, z * 9)));
  for (let i = 0; i < 10; i++) g.in(M(0, 0, 0, 0, 0, i * 36), () => g.in(M(R * 0.52, 0, 0), () => g.beam(R * 0.9, R * 0.085, R * 0.075, 0.006, woodTint(mul(wood, 1.1), i), 2)));
  g.in(M(0, 0, -R * 0.14, 90, 0, 0), () => g.cyl(R * 0.17, R * 0.14, R * 0.28, 12, woodTint(mul(wood, 0.8), 3), true, true));
  g.surf(K_PLAIN, 0.5, 0.85);
  g.add(new THREE.TorusGeometry(R * 1.075, R * 0.03, 4, 28), IRON);
  g.in(M(0, 0, R * 0.14, 90, 0, 0), () => g.cyl(R * 0.07, R * 0.06, 0.03, 8, IRON, false, true));
}
function barricade(L, hex) {
  const g = new Geo(), wood = rgb(hex), rnd = rng(280), dark = mul(wood, 0.62), pale = rgb(0xcfae7a);
  // chevaux-de-frise: a spine log with sharpened stakes driven through it crosswise
  logTo(g, [-L / 2 + 0.08, 0.5, 0], [L / 2 - 0.08, 0.5, 0], 0.085, 0.08, 3, { seg: 12, capB: true, bark: dark });
  const n = Math.round(L * 3.3);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.2 + ((L - 0.4) * i) / (n - 1), e = i % 2 ? 1 : -1, len = 1.3 + rnd() * 0.14, tilt = (36 + rnd() * 9) * DEG;
    const foot = [x + (rnd() - 0.5) * 0.06, -0.1, e * 0.5], dir = [0, Math.cos(tilt), -e * Math.sin(tilt)];
    const head = [foot[0] + (rnd() - 0.5) * 0.05, foot[1] + dir[1] * len, foot[2] + dir[2] * len], r = 0.038 + rnd() * 0.01;
    const f = along(foot, head);
    g.in(f.m.clone().multiply(M(-f.L / 2, 0, 0, 0, 0, -90)), () => {
      log(g, r, r * 0.85, f.L - 0.16, i * 5, { seg: 8, capT: false, bark: mul(dark, 0.85 + 0.3 * rnd()), amp: 0.14 });
      g.surf(K_WOOD, 0.85);
      for (let q = 0; q < 4; q++) { const a0 = (q / 4) * TAU, a1 = ((q + 1) / 4) * TAU, c = mul(pale, 0.75 + 0.35 * hash1(i, q)), rt = r * 0.86; g.flat([[Math.cos(a0) * rt, f.L - 0.165, Math.sin(a0) * rt], [Math.cos(a1) * rt, f.L - 0.165, Math.sin(a1) * rt], [0, f.L, 0]], [mul(c, 0.8), mul(c, 0.8), mul(c, 1.15)]); }
    });
    g.in(M(x, 0.5, 0, 0, 0, 90), () => g.in(M(0, 0, 0, e * 20, 0, 0), () => lashing(g, 0.1, 2, 0.011)));
  }
  // rough boards spiked across the front, a wheel and stores thrown in to thicken it
  g.surf(K_WOOD, 0.9);
  for (const [y, z, a] of [[0.2, 0.3, 3], [0.36, 0.19, -4]]) g.in(M((rnd() - 0.5) * 0.1, y, z, -35, 0, a), () => g.beam(L * 0.86, 0.14, 0.03, 0.008, woodTint(mul(wood, 0.9 + 0.2 * rnd()), y * 30), 6, (x) => [0, 0.01 * Math.sin(x * 3)]));
  g.in(M(-L / 2 + 0.46, 0.3, -0.33, 22, 12, 0), () => wheel(g, 0.3, rgb(0x6a4c30)));
  g.in(M(L / 2 - 0.34, 0, -0.26), () => barrel(g, 0.15, 0.38, rgb(0x7a5a38), 5));
  g.in(M(0.05, 0, -0.33), () => sacks(g, 2, 290));
  return g;
}
/** a few stuffed sacks slumped on the local origin */
function sacks(g, n, seed, col = rgb(0xb49a6c)) {
  const prims = [], hard = [], rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.27 + (rnd() - 0.5) * 0.04, ry = (rnd() - 0.5) * 50, c = mul(col, 0.85 + 0.3 * rnd());
    const hexc = (c.map((q) => Math.round(255 * Math.pow(clamp(q, 0, 1), 1 / 2.2))).reduce((a, b) => (a << 8) | b, 0));
    prims.push(S.ellipsoid(0.13, 0.09, 0.18).rot(0, ry, 0).at(x, 0.085 + (i % 2) * 0.012, 0).color(hexc).tint(0.18, 26).bump(0.006, 13, 'weave').blend(0.012));
    prims.push(S.ellipsoid(0.05, 0.035, 0.03).rot(0, ry, 0).at(x + Math.sin(ry * DEG) * 0.17, 0.11, Math.cos(ry * DEG) * 0.17).color(hexc).blend(0.03));
    hard.push(H.torus(0.03, 0.007, 10, 5).rot(90, ry, 0).at(x + Math.sin(ry * DEG) * 0.155, 0.11, Math.cos(ry * DEG) * 0.155).color(0x7a6442));
  }
  g.surf(K_CLOTH, 0.95);
  g.sculpt({ prims, hard }, 44);
}

/** a packing crate w x h x d standing on the local origin: battens round every edge, boarded faces, nails */
function crate(g, w, h, d, wood, seed) {
  const bt = 0.05, tb = (i, k = 1) => woodTint(mul(wood, k * (0.82 + 0.36 * hash1(seed, i))), seed * 3 + i);
  g.surf(K_WOOD, 0.88);
  // boards on the four sides and the lid
  for (let f = 0; f < 4; f++) {
    const fw = f % 2 ? d : w, out = f % 2 ? w : d, nb = Math.max(3, Math.round(h / 0.13));
    g.in(M(0, 0, 0, 0, f * 90, 0).multiply(M(0, 0, out / 2 - 0.02)), () => {
      for (let i = 0; i < nb; i++) g.in(M(0, (h * (i + 0.5)) / nb, 0), () => g.beam(fw - 0.03, h / nb - 0.007, 0.02, 0.005, tb(f * 10 + i), 3));
      // corner battens and a diagonal
      for (const e of [-1, 1]) g.in(M(e * (fw / 2 - bt / 2), h / 2, 0.018, 0, 0, 90), () => g.beam(h, bt, 0.03, 0.007, tb(50 + f * 4 + e, 0.8), 3));
      for (const y of [bt / 2, h - bt / 2]) g.in(M(0, y, 0.018), () => g.beam(fw - 2 * bt, bt, 0.028, 0.007, tb(60 + f * 4 + y, 0.8), 3));
      if (f % 2 === (seed & 1)) g.beamTo([-fw / 2 + bt, bt, 0.016], [fw / 2 - bt, h - bt, 0.016], 0.024, bt * 0.9, 0.006, tb(70 + f, 0.78), 3, [0, 0, 1]);
      g.surf(K_PLAIN, 0.6, 0.8);
      for (const e of [-1, 1]) for (let i = 0; i < nb; i++) g.in(M(e * (fw / 2 - bt / 2), (h * (i + 0.5)) / nb, 0.034), () => g.stud(0.008, IRON, 5, 0.5));
      g.surf(K_WOOD, 0.88);
    });
  }
  const nl = Math.max(3, Math.round(d / 0.14));
  for (let i = 0; i < nl; i++) g.in(M(0, h - 0.012, -d / 2 + (d * (i + 0.5)) / nl), () => g.beam(w - 0.012, 0.024, d / nl - 0.007, 0.005, tb(80 + i), 3));
  for (const e of [-1, 1]) g.in(M(e * (w / 2 - bt / 2), h + 0.004, 0, 0, 90, 0), () => g.beam(d, 0.022, bt, 0.006, tb(90 + e, 0.8), 3));
}
function crates(hex) {
  const g = new Geo(), wood = rgb(hex);
  g.in(M(0, -0.03, 0), () => crate(g, 0.76, 0.55, 0.72, wood, 4));
  g.in(M(0.06, 0.53, -0.04, 0, 24, 0), () => crate(g, 0.46, 0.38, 0.44, mul(wood, 1.12), 7));
  // roped for carrying
  for (const z of [-0.2, 0.2]) { const w = 0.39, h = 0.535; rope(g, [[-w, 0.02, z], [-w, h * 0.5, z + 0.005], [-w + 0.01, h, z], [0, h + 0.004, z], [w - 0.01, h, z], [w, h * 0.5, z - 0.005], [w, 0.02, z]], 0.013); }
  // a coil of rope and a sack on the lid
  const coil = [];
  for (let i = 0; i <= 44; i++) { const a = (i / 44) * TAU * 3.5, rr = 0.075 + 0.006 * Math.sin(i * 1.3); coil.push([-0.22 + Math.cos(a) * rr, 0.548 + (i / 44) * 0.05, 0.2 + Math.sin(a) * rr]); }
  rope(g, coil, 0.012);
  g.in(M(-0.2, 0.53, -0.2, 0, 35, 0), () => sacks(g, 1, 300));
  g.shade(-0.4, 0.5, -0.4, 0.4, 0.62, 0.4, 0.3, 0.04, [1, -1]);
  return g;
}

// ---------- canvas and sandbags ----------
function tent(hex) {
  const g = new Geo(), canvas = rgb(hex), N = 10, Rw = 0.72, Re = 0.8, wallH = 0.54, peak = 1.52, door = TAU / N;
  const stripe = rgb(0xa85c3a), dark = [0.02, 0.016, 0.012];
  const seam = (a) => Math.pow(Math.abs(Math.cos((a * N) / 2)), 6);            // 1 on a seam, 0 between
  const cv = (x, y, z, nx, ny, nz, u, v) => {
    const a = Math.atan2(z, x), panel = Math.floor(((a + TAU) % TAU) / (TAU / N) + 0.5) % 2;
    return mul(canvas, (0.86 + 0.2 * noise3(x * 4, y * 4, z * 4)) * (1 - 0.28 * seam(a)) * (0.94 + 0.06 * panel));
  };
  // roof: canvas pulled tight over the wall poles, sagging a little between them
  g.surf(K_CLOTH, 0.96);
  g.sheet(N * 12, 12, (u, v) => {
    const a = u * TAU, k = Math.pow(v, 0.92), sag = (1 - seam(a)) * 0.05 * Math.sin(Math.PI * Math.min(1, v * 1.15)) + 0.006 * Math.sin(a * 37 + v * 9);
    const r = lerp(Re, 0.035, k) * (1 - sag * 0.6);
    return [Math.cos(a) * r, lerp(wallH + 0.03, peak, Math.pow(v, 1.12)) - sag * 0.5, Math.sin(a) * r];
  }, cv, true);
  // valance: a scalloped strip in a second colour, hanging from the eave
  g.sheet(N * 12, 2, (u, v) => {
    const a = u * TAU, drop = 0.07 + 0.06 * Math.abs(Math.sin((a * N * 2) / 2 + Math.PI / 2));
    return [Math.cos(a) * (Re + 0.004 + 0.012 * (1 - v)), wallH + 0.035 - drop * (1 - v), Math.sin(a) * (Re + 0.004 + 0.012 * (1 - v))];
  }, (x, y, z) => mul(stripe, 0.8 + 0.3 * noise3(x * 9, y * 9, z * 9)), true);
  // wall: hangs in loose folds; the panel facing +Z is the doorway
  const a0 = Math.PI / 2 + door / 2, span = TAU - door;
  g.sheet(N * 8, 6, (u, v) => {
    const a = a0 + u * span, fold = 0.016 * Math.sin(a * 23 + v * 2) * (1 - v * 0.6) + 0.012 * Math.sin(a * N), r = Rw + fold + 0.035 * (1 - v) * (1 - v);
    return [Math.cos(a) * r, v * (wallH + 0.07) - 0.058, Math.sin(a) * r];
  }, cv);
  // door flaps: hanging from the eave, drawn back and tied to the poles either side
  for (const e of [-1, 1]) {
    const ap = Math.PI / 2 + e * (door / 2), ac = Math.PI / 2;
    g.sheet(6, 8, (u, v) => {
      const sv = smooth(0.4, 1, v), ang = lerp(ap, lerp(ap, ac, sv), u), bunch = (1 - sv) * Math.sin(Math.PI * u) * 0.045 + 0.012 * Math.sin(u * 14) * (1 - sv);
      const r = Rw + 0.012 + bunch;
      return [Math.cos(ang) * r, v * wallH + 0.012 + (1 - sv) * u * 0.05 * (1 - v), Math.sin(ang) * r];
    }, cv);
    g.in(M(Math.cos(ap) * (Rw + 0.02), wallH * 0.38, Math.sin(ap) * (Rw + 0.02)), () => lashing(g, 0.035, 2, 0.008));
    g.surf(K_CLOTH, 0.96);
  }
  g.surf(K_PLAIN, 1);
  g.sheet(24, 2, (u, v) => { const a = u * TAU; return [Math.cos(a) * (Rw - 0.04), v * (wallH + 0.05), Math.sin(a) * (Rw - 0.04)]; }, dark, true);
  g.flat([[-Rw, 0.006, -Rw], [Rw, 0.006, -Rw], [Rw, 0.006, Rw], [-Rw, 0.006, Rw]].map(([x, y, z]) => [x * 0.8, y, z * 0.8]), [0.05, 0.04, 0.03]);
  // poles: one at every seam of the wall, the mast through the crown
  g.surf(K_WOOD, 0.9);
  const pole = woodTint(rgb(0x6a4c30), 2);
  for (let i = 0; i < N; i++) { const a = (i + 0.5) * (TAU / N) + Math.PI / 2; g.in(M(Math.cos(a) * (Rw + 0.012), 0, Math.sin(a) * (Rw + 0.012)), () => g.cyl(0.018, 0.016, wallH + 0.05, 6, pole, false, true)); }
  g.cyl(0.03, 0.026, peak + 0.06, 8, pole, false, true);
  g.surf(K_CLOTH, 0.9);
  g.in(M(0, peak - 0.03, 0), () => g.lathe([[0.075, 0], [0.05, 0.035], [0.03, 0.06]], 10, mul(rgb(0x6a4a30), 0.9)));
  g.in(M(0, peak + 0.04, 0), () => pennant(g, 0.42, 0.34, 0.15, rgb(0xa85c3a), rgb(0xe2d2a8)));
  // guy ropes down to pegs
  for (let i = 0; i < N; i++) {
    const a = (i + 0.5) * (TAU / N) + Math.PI / 2, c = Math.cos(a), si = Math.sin(a), lim = 0.985 / Math.max(Math.abs(c), Math.abs(si)), rp = Math.min(1.12, lim);
    rope(g, [[c * Re, wallH + 0.03, si * Re], [c * (Re + rp) / 2, (wallH + 0.03) * 0.47, si * (Re + rp) / 2], [c * rp, 0.035, si * rp]], 0.007);
    g.surf(K_WOOD, 0.9);
    g.beamTo([c * (rp + 0.03), 0.09, si * (rp + 0.03)], [c * (rp - 0.045), -0.03, si * (rp - 0.045)], 0.022, 0.022, 0.005, pole, 1);
  }
  // bedroll and a kettle by the door
  g.surf(K_CLOTH, 0.95);
  g.in(M(0.5, 0.05, 0.84, 0, 20, 90), () => g.cyl(0.05, 0.05, 0.3, 10, (x, y, z) => mul(rgb(0x6a7a52), 0.8 + 0.3 * noise3(x * 30, y * 8, z * 30)), true, true));
  g.surf(K_PLAIN, 0.6, 0.7);
  g.in(M(-0.52, 0, 0.86), () => {
    g.lathe([[0.04, 0], [0.065, 0.03], [0.06, 0.08], [0.04, 0.1], [0.045, 0.108]], 10, [0.03, 0.03, 0.032]);
    g.add(new THREE.TorusGeometry(0.05, 0.005, 4, 12, Math.PI).translate(0, 0.1, 0), [0.03, 0.03, 0.032]);
    for (const e of [-1, 1]) g.in(M(0, 0.02, 0, 0, 0, e * 22), () => g.in(M(e * 0.055, -0.02, 0), () => g.cbox(0.01, 0.05, 0.012, 0.002, [0.03, 0.03, 0.032])));
  });
  return g;
}

function sandbags(L, hex) {
  const g = new Geo(), base = rgb(hex), rnd = rng(310), prims = [], hard = [];
  const toHex = (c) => c.map((q) => Math.round(255 * Math.pow(clamp(q, 0, 1), 1 / 2.2))).reduce((a, b) => (a << 8) | b, 0);
  const bl = 0.5, bh = 0.158, bd = 0.3, n0 = Math.round(L / bl);
  const sewn = [];
  const bag = (x, y, z, len, yaw) => {
    const c = toHex(mul(mix(base, rgb(0x9a8660), rnd() * 0.5), 0.82 + 0.3 * rnd())), dx = (rnd() - 0.5) * 0.02, rx = (rnd() - 0.5) * 5, rz = (rnd() - 0.5) * 4;
    // a stuffed sack: slumped box, a fat belly, the sewn seam standing up along its side, the neck tied off
    prims.push(S.box(len, bh, bd, 0.072).rot(rx, yaw, rz).at(x + dx, y, z).color(c).tint(0.16, 30).bump(0.004, 12, 'weave').blend(0.012));
    if (rnd() < 0.55) prims.push(S.ellipsoid(len * 0.3, bh * 0.44, bd * 0.36).at(x + dx + (rnd() - 0.5) * len * 0.3, y + bh * 0.2, z + (rnd() - 0.5) * 0.04).color(c).blend(0.05));
    prims.push(S.box(len * 0.92, 0.016, bd + 0.03, 0.004).rot(rx, yaw, rz).at(x + dx, y + 0.012, z).color(0x5a4a32).paint(0.006, 0.006));
    const e = rnd() < 0.5 ? -1 : 1, cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG), ex = x + dx + e * cy * (len / 2 + 0.012), ez = z - e * sy * (len / 2 + 0.012);
    prims.push(S.ellipsoid(0.04, 0.032, 0.05).rot(0, yaw, 0).at(ex, y + 0.012, ez).color(c).blend(0.022));
    hard.push(H.torus(0.03, 0.006, 10, 5).rot(0, yaw, 90).at(ex - e * cy * 0.022, y + 0.012, ez + e * sy * 0.022).color(0x5a4a34));
    sewn.push([new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx * DEG, yaw * DEG, rz * DEG, 'XYZ')).setPosition(x + dx, y - 0.008, z), len]);
  };
  // three courses, each breaking joint with the one below: three bags deep at the foot, one at the crest
  for (let i = 0; i < n0; i++) for (const z of [-0.3, 0, 0.3]) bag(-L / 2 + bl * (i + 0.5), bh * 0.48, z + (rnd() - 0.5) * 0.02, bl - 0.015, (rnd() - 0.5) * 6);
  for (let i = 0; i < n0 - 1; i++) for (const z of [-0.155, 0.155]) bag(-L / 2 + bl * (i + 1), bh * 1.36, z + (rnd() - 0.5) * 0.025, bl - 0.015, (rnd() - 0.5) * 8);
  for (const z of [-0.15, 0.15]) for (const e of [-1, 1]) bag(e * (L / 2 - 0.15), bh * 1.34, z, 0.29, 90 + (rnd() - 0.5) * 8);
  for (let i = 0; i < n0; i++) bag(-L / 2 + bl * (i + 0.5) + (i === 0 ? 0.07 : i === n0 - 1 ? -0.07 : 0), bh * 2.22, (rnd() - 0.5) * 0.05, bl - 0.03, (rnd() - 0.5) * 9);
  g.surf(K_CLOTH, 0.97);
  g.in(M(0, -0.02, 0), () => g.sculpt({ prims, hard }, 32, 0.85));
  // whip-stitching in tarred twine along every seam
  g.surf(K_CLOTH, 0.9);
  const twine = rgb(0x4a3a26);
  for (const [m, len] of sewn) g.in(m, () => {
    for (const sd of [-1, 1]) for (let x = -len * 0.4; x <= len * 0.4; x += 0.042) {
      const z = sd * (bd / 2 + 0.0085);
      g.flat([[x - 0.013, -0.014, z], [x - 0.007, -0.016, z], [x + 0.013, 0.014, z], [x + 0.007, 0.016, z]], twine);
    }
  });
  // a shovel left standing in the crest
  g.surf(K_WOOD, 0.9);
  g.beamTo([-L / 2 + 0.42, 0.3, 0.2], [-L / 2 + 0.47, 0.95, 0.12], 0.028, 0.028, 0.008, woodTint(rgb(0x8a6a44), 3), 3);
  g.in(M(-L / 2 + 0.475, 0.97, 0.115, 0, 0, 0), () => g.cbox(0.11, 0.03, 0.03, 0.008, woodTint(rgb(0x8a6a44), 5)));
  g.surf(K_PLAIN, 0.5, 0.8);
  g.in(along([-L / 2 + 0.405, 0.16, 0.225], [-L / 2 + 0.422, 0.33, 0.196]).m, () => g.cbox(0.2, 0.012, 0.13, 0.005, rgb(0x4a4c50)));
  return g;
}

// ---------- trees and rocks ----------
/**
 * A mass of foliage: a dark core with leaves standing off it. Every leaf's normal leans toward the mass's own,
 * so a clump takes the light as one rounded form; `lo`..`hi` is the height range of the whole crown, used to
 * darken its underside.
 */
function foliage(g, cx, cy, cz, rx, ry, rz, n, leaf, seed, size, lo, hi) {
  const rnd = rng(seed * 61 + 9);
  g.surf(K_LEAF, 0.8);
  g.in(M(cx, cy, cz), () => g.sheet(10, 6, (u, v) => { const a = u * TAU, b = (v - 0.5) * Math.PI, k = 0.84 + 0.1 * noise3(a * 2 + seed, b * 2, 1); return [Math.cos(a) * Math.cos(b) * rx * k, Math.sin(b) * ry * k, Math.sin(a) * Math.cos(b) * rz * k]; }, (x, y) => mul(leaf, 0.34 + 0.2 * (y / ry)), true));
  const sun = [leaf[0] * 1.9 + 0.035, leaf[1] * 1.45 + 0.02, leaf[2] * 0.7];
  for (let i = 0; i < n; i++) {
    // points spread evenly over the mass, thinning out underneath
    const t = (i + 0.5) / n, yy = 1 - t * 1.78, rr = Math.sqrt(Math.max(0, 1 - yy * yy)), a = i * 2.399963 + rnd() * 0.6;
    const nx = Math.cos(a) * rr, ny = yy, nz = Math.sin(a) * rr, bulge = 0.94 + 0.16 * rnd();
    const px = cx + nx * rx * bulge, py = cy + ny * ry * bulge, pz = cz + nz * rz * bulge;
    // leaf axes: u along the leaf (lying on the surface, at any angle), v across it
    let tx = -nz, ty = 0, tz = nx;
    if (rr < 0.05) { tx = 1; tz = 0; }
    const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const spin = rnd() * TAU, co = Math.cos(spin), si = Math.sin(spin);
    const ux = tx * co + bx * si, uy = ty * co + by * si, uz = tz * co + bz * si;
    const vx = -tx * si + bx * co, vy = -ty * si + by * co, vz = -tz * si + bz * co;
    const s = size * (0.7 + 0.65 * rnd()), lift = 0.1 + rnd() * 0.5;
    const height = clamp((py - lo) / (hi - lo), 0, 1), up = ny * 0.5 + 0.5;
    const shadeK = (0.42 + 0.58 * Math.pow(height, 0.8)) * (0.6 + 0.4 * up) * (0.85 + 0.3 * rnd());
    const c = mul(mix(leaf, sun, clamp(up * height * (0.35 + 0.65 * rnd()), 0, 1)), shadeK * 1.25);
    const A = (fu, fv, out) => [px + (ux * fu + vx * fv + nx * out) * s, py + (uy * fu + vy * fv + ny * out) * s, pz + (uz * fu + vz * fv + nz * out) * s];
    const p0 = A(-0.55, 0, 0), p1 = A(0, 0.4, lift * 0.5 - 0.12), p2 = A(0.65, 0, lift), p3 = A(0, -0.4, lift * 0.5 - 0.12);
    const k = 0.55;
    const i0 = g.v(p0[0], p0[1], p0[2], nx, ny + 0.2, nz, mul(c, 0.72));
    const i1 = g.v(p1[0], p1[1], p1[2], nx + vx * k, ny + 0.2 + vy * k, nz + vz * k, c);
    const i2 = g.v(p2[0], p2[1], p2[2], nx + ux * 0.3, ny + 0.3 + uy * 0.3, nz + uz * 0.3, mul(c, 1.22));
    const i3 = g.v(p3[0], p3[1], p3[2], nx - vx * k, ny + 0.2 - vy * k, nz - vz * k, c);
    g.tri(i0, i1, i2); g.tri(i0, i2, i3);
  }
}
function tree(hex, variant) {
  const g = new Geo(), leaf = rgb(hex), rnd = rng(400 + variant * 17), bark = 0x5e4a36, q = qual();
  // trunk: flared roots, a lean, three boughs
  const lean = (rnd() - 0.5) * 0.16, tw = rnd() * TAU, prims = [];
  const top = [lean, 0.8 + rnd() * 0.12, (rnd() - 0.5) * 0.12];
  const bk = (p, k = 0.04) => p.color(bark).bump(0.012, 9, 'fur').tint(0.28, 16).blend(k);
  prims.push(bk(S.capsule([0, -0.06, 0], [lean * 0.4, 0.42, top[2] * 0.4], 0.14, 0.1)));
  prims.push(bk(S.capsule([lean * 0.4, 0.42, top[2] * 0.4], top, 0.1, 0.088)));
  for (let i = 0; i < 5; i++) { const a = tw + i * 1.257 + rnd() * 0.4, l = 0.21 + rnd() * 0.08; prims.push(bk(S.capsule([Math.cos(a) * 0.07, 0.17, Math.sin(a) * 0.07], [Math.cos(a) * l, -0.07, Math.sin(a) * l], 0.058, 0.034), 0.07)); }
  const boughs = [];
  for (let i = 0; i < 3; i++) {
    const a = tw + i * 2.094 + (rnd() - 0.5) * 0.5, out = 0.4 + rnd() * 0.16, up = 0.42 + rnd() * 0.2;
    const mid = [top[0] + Math.cos(a) * out * 0.5, top[1] + up * 0.45, top[2] + Math.sin(a) * out * 0.5], end = [top[0] + Math.cos(a) * out, top[1] + up, top[2] + Math.sin(a) * out];
    prims.push(...S.limb([top, mid, end], [0.075, 0.055, 0.036]).map((p) => bk(p, 0.05)));
    boughs.push(end);
  }
  prims.push(bk(S.sphere(0.04).at(lean * 0.5 + 0.095, 0.5, 0.03), 0.03));   // a knot
  g.surf(K_WOOD, 0.95);
  g.sculpt({ prims }, 27, 0.6);
  // crown: one big mass over the fork, a lobe on every bough, small clumps to break the outline
  const ch = top[1] + 0.74, k = 0.95 + rnd() * 0.12, lo = top[1] + 0.05, hi = ch + 0.5;
  foliage(g, top[0], ch, top[2], 0.58 * k, 0.47 * k, 0.58 * k, Math.round(690 * q), leaf, variant * 10 + 1, 0.102, lo, hi);
  boughs.forEach((b, i) => foliage(g, b[0] * 1.12, b[1] + 0.03, b[2] * 1.12, 0.4, 0.31, 0.4, Math.round(350 * q), mul(leaf, 0.92 + 0.16 * rnd()), variant * 10 + 2 + i, 0.097, lo, hi));
  for (let i = 0; i < 4; i++) { const a = rnd() * TAU, r = 0.46 + rnd() * 0.14; foliage(g, top[0] + Math.cos(a) * r, ch - 0.14 + rnd() * 0.42, top[2] + Math.sin(a) * r, 0.25, 0.2, 0.25, Math.round(150 * q), mul(leaf, 0.95 + 0.2 * rnd()), variant * 10 + 6 + i, 0.092, lo, hi); }
  g.shade(-0.25, 0.5, -0.25, 0.25, top[1] + 0.35, 0.25, 0.4, 0.2, [1, 1]);
  return g;
}
function pine(hex, variant) {
  const g = new Geo(), leaf = rgb(hex), rnd = rng(450 + variant * 13), H0 = 2.45 + rnd() * 0.35, bark = rgb(0x5c4030);
  const lean = [(rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.08];
  const axis = (y) => [lean[0] * (y / H0) ** 2 * 3, lean[1] * (y / H0) ** 2 * 3];
  // trunk: straight, scaly, with the snags of dead lower branches
  g.surf(K_WOOD, 0.95);
  g.sheet(10, 12, (u, v) => { const a = u * TAU, y = v * (H0 * 0.93 + 0.1) - 0.1, [ox, oz] = axis(Math.max(0, y)), r = lerp(0.105, 0.012, Math.pow(v, 0.8)) * (1 + 0.12 * (noise3(Math.cos(a) * 3, y * 4, Math.sin(a) * 3) - 0.5)) + (v < 0.06 ? (0.06 - v) * 0.7 : 0); return [ox + Math.cos(a) * r, y, oz + Math.sin(a) * r]; },
    (x, y, z) => mul(bark, 0.65 + 0.7 * noise3(x * 14, y * 5, z * 14)), true);
  for (let i = 0; i < 4; i++) { const a = rnd() * TAU, y = 0.28 + i * 0.12; g.tube([[Math.cos(a) * 0.06, y, Math.sin(a) * 0.06], [Math.cos(a) * 0.2, y + 0.03, Math.sin(a) * 0.2]], [0.02, 0.008], 5, mul(bark, 0.8)); }
  // boughs in whorls, each a drooping spray with a saw-toothed edge
  g.surf(K_LEAF, 0.85);
  const tiers = 9, y0 = 0.5;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1), y = lerp(y0, H0 * 0.9, Math.pow(f, 0.92)), len = lerp(0.56, 0.13, Math.pow(f, 0.85)) * (0.92 + 0.16 * rnd()), nb = Math.round(lerp(11, 5, f) * Math.sqrt(qual()));
    const [ox, oz] = axis(y), rot = rnd() * TAU, droop = lerp(0.34, 0.1, f);
    // a dark cone inside each whorl so the tree is not see-through
    g.in(M(ox, y - droop * len * 0.7, oz), () => g.cyl(len * 0.62, 0.02, droop * len * 0.7 + lerp(0.34, 0.2, f), 8, (px, py) => mul(leaf, 0.22 + 0.1 * py), false, false));
    for (let b = 0; b < nb; b++) {
      const a = rot + (b / nb) * TAU + (rnd() - 0.5) * 0.25, co = Math.cos(a), si = Math.sin(a), bl = len * (0.85 + 0.3 * rnd()), wd = bl * (0.42 + 0.1 * rnd()), up = 0.1 + rnd() * 0.12;
      const tone = (0.78 + 0.4 * rnd()) * lerp(0.82, 1.08, f), warm = rnd() * 0.5;
      const cb = mul(mix(leaf, [leaf[0] * 1.5 + 0.01, leaf[1] * 1.22, leaf[2] * 0.7], warm), tone);
      g.sheet(4, 8, (u, v) => {
        const w = wd * Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * v)), 0.8) * (1 - 0.55 * v) * (Math.round(v * 8) % 2 ? 0.66 : 1), side = (u - 0.5) * w, along = v * bl;
        const yy = y + up * bl * v - droop * bl * v * v * 1.6 - Math.abs(u - 0.5) * w * 0.55;
        return [ox + co * along - si * side, yy, oz + si * along + co * side];
      }, (x, yy, z, nx, ny, nz, u, v) => mul(cb, (0.5 + 0.6 * v) * (1 - 0.35 * Math.abs(u - 0.5) * 2) * (Math.round(v * 8) % 2 ? 0.8 : 1.05)));
    }
  }
  // leader
  const [tx, tz] = axis(H0);
  g.in(M(tx, H0 * 0.86, tz), () => g.cyl(0.07, 0, H0 * 0.16, 7, (x, y) => mul(leaf, 0.7 + 1.5 * y), false, false));
  return g;
}
/** one boulder on the local origin: a lump cut by random planes into facets, bedded in strata, cracked and mossed */
function boulder(g, rx, ry, rz, seed, col, nu = 48) {
  const rnd = rng(seed * 71 + 3), planes = [];
  for (let i = 0; i < 13; i++) { const a = rnd() * TAU, y = rnd() * 1.9 - 0.6, l = Math.hypot(1, y); planes.push([Math.cos(a) / l, y / l, Math.sin(a) / l, 0.66 + rnd() * 0.34]); }
  planes.push([0, 1, 0, 0.8 + rnd() * 0.15]);
  const tiltA = rnd() * TAU, tilt = 0.12 + rnd() * 0.22, beds = 7 + rnd() * 3;
  const bedOf = (x, y, z) => (y / ry) * beds + ((x / rx) * Math.cos(tiltA) + (z / rz) * Math.sin(tiltA)) * tilt * beds;
  const crackOf = (x, y, z) => smooth(0.44, 0.5, 1 - Math.abs(noise3(x * 3.1 + seed * 2, y * 3.1, z * 3.1) - 0.5) * 2);
  const rad = (dx, dy, dz) => {
    let s = 0;
    for (const p of planes) { const d = dx * p[0] + dy * p[1] + dz * p[2]; if (d > 0.05) s += Math.pow(d / p[3], 26); }   // a nearly hard minimum over the cut planes
    let r = Math.min(s > 0 ? Math.pow(s, -1 / 26) : 1.2, 1.2);
    const bed = bedOf(dx * r * rx, dy * r * ry, dz * r * rz), fr = ((bed % 1) + 1) % 1;
    r *= 1 - 0.1 * smooth(0, 0.12, fr) * (1 - smooth(0.12, 0.3, fr)) * hash1(Math.floor(bed), seed)   // ledges where a bed has weathered back
      + 0.06 * (fbm3(dx * 2.6 + seed, dy * 2.6, dz * 2.6, 3) - 0.5) - 0.03 * crackOf(dx, dy, dz);
    return r;
  };
  g.surf(K_STONE, 0.96);
  g.sheet(nu, nu / 2, (u, v) => {
    const a = u * TAU, b = lerp(Math.PI / 2, -0.44 * Math.PI, v), dx = Math.cos(a) * Math.cos(b), dy = Math.sin(b), dz = Math.sin(a) * Math.cos(b), r = rad(dx, dy, dz);
    return [dx * r * rx, Math.max(-0.14, dy * r * ry + ry * 0.34), dz * r * rz];
  }, (x, y, z, nx, ny, nz) => {
    const yy = y - ry * 0.34, bed = bedOf(x, yy, z), band = hash1(Math.floor(bed), seed), lich = smooth(0.7, 0.84, noise3(x * 6 + seed, y * 6, z * 6));
    const l = Math.hypot(x / rx, yy / ry, z / rz) || 1, crack = crackOf(x / rx / l, yy / ry / l, z / rz / l);
    let c = mul(col, (0.74 + 0.4 * band) * (0.84 + 0.3 * fbm3(x * 4, y * 4, z * 4 + seed, 2)) * (1 - 0.45 * crack) * (0.8 + 0.2 * smooth(-0.3, 0.6, ny)));
    c = mix(c, [0.44, 0.45, 0.3], lich * 0.5);
    return mix(c, [0.13, 0.2, 0.055], ny > 0.3 ? smooth(0.4, 0.6, noise3(x * 2.4 + 9, y * 2, z * 2.4 + seed)) * 0.8 * smooth(0.3, 0.7, ny) : 0);
  }, true);
}
/** blades of grass in a tuft on the local origin */
function tuft(g, n, h, seed, col = rgb(0x5d8a3c)) {
  const rnd = rng(seed * 7 + 1);
  g.surf(K_LEAF, 0.9);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, r = rnd() * 0.05, x = Math.cos(a) * r, z = Math.sin(a) * r, hh = h * (0.6 + 0.6 * rnd()), lx = Math.cos(a) * hh * 0.45, lz = Math.sin(a) * hh * 0.45, w = 0.012;
    const c = mul(col, 0.7 + 0.5 * rnd());
    g.flat([[x - Math.sin(a) * w, 0, z + Math.cos(a) * w], [x + Math.sin(a) * w, 0, z - Math.cos(a) * w], [x + lx, hh, z + lz]], [mul(c, 0.6), mul(c, 0.6), mul(c, 1.25)]);
  }
}
function rock(hex, variant) {
  const g = new Geo(), col = rgb(hex), rnd = rng(500 + variant * 19), nu = Math.round(34 * qual()) * 2;
  g.in(M(-0.12, 0, 0.06, 0, rnd() * 360, 0), () => boulder(g, 0.8, 0.74, 0.7, 5 + variant * 3, col, nu));
  g.in(M(0.58, 0, -0.42, 0, rnd() * 360, 0), () => boulder(g, 0.4, 0.42, 0.36, 6 + variant * 3, mul(col, 0.93), Math.round(nu * 0.6 / 2) * 2));
  g.in(M(0.46, 0, 0.62, 0, rnd() * 360, 0), () => boulder(g, 0.3, 0.26, 0.26, 7 + variant * 3, mul(col, 1.06), Math.round(nu * 0.45 / 2) * 2));
  for (let i = 0; i < 5; i++) { const a = rnd() * TAU, r = 0.75 + rnd() * 0.2; g.in(M(Math.cos(a) * r, 0, Math.sin(a) * r * 0.95, 0, rnd() * 360, 0), () => boulder(g, 0.07 + rnd() * 0.05, 0.06 + rnd() * 0.03, 0.06 + rnd() * 0.04, 20 + i + variant * 9, mul(col, 0.85 + 0.3 * rnd()), 12)); }
  for (let i = 0; i < 9; i++) { const a = rnd() * TAU, r = 0.7 + rnd() * 0.25; g.in(M(clamp(Math.cos(a) * r, -0.95, 0.95), 0, clamp(Math.sin(a) * r, -0.95, 0.95)), () => tuft(g, 7, 0.16, i + variant * 5)); }
  return g;
}

// ---------- monuments ----------
function statue(hex) {
  const g = new Geo(), st = stoneStyle(hex, { seed: 600 }), col = st.pal[0], cc = stoneTint(mul(col, 0.96), 4, 5);
  // plinth: step, die with a moulded cap, a bronze plate on the front
  g.surf(K_STONE, 0.93);
  g.in(M(0, -0.01, 0), () => g.cbox(0.86, 0.22, 0.86, 0.015, cc));
  g.in(M(0, 0.135, 0), () => g.cbox(0.76, 0.07, 0.76, 0.02, cc));
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-(0.31 - st.r), 0.17, 0.31 - st.r)), () => g.ashlar(2 * (0.31 - st.r), 0.3, { ...st, course: 0.15, len: [0.3, 0.4], seed: 601 + s, ends: [CORNER, CORNER, 0, 0], quoin: [0.34, 0.28] }));
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, 0.31)), () => g.mould([[0, 0.455], [0.02, 0.46], [0.045, 0.485], [0.05, 0.51], [0.05, 0.535], [0.03, 0.55]], 0.62, cc, 1, 1, 3));
  g.flat([[-0.345, 0.55, -0.345], [0.345, 0.55, -0.345], [0.345, 0.55, 0.345], [-0.345, 0.55, 0.345]], mul(col, 0.95));
  g.surf(K_PLAIN, 0.45, 0.85);
  g.in(M(0, 0.32, 0.316), () => { g.cbox(0.3, 0.16, 0.014, 0.005, rgb(0x6a5a34)); for (const [x, y] of [[-0.13, 0.06], [0.13, 0.06], [-0.13, -0.06], [0.13, -0.06]]) g.in(M(x, y, 0.007), () => g.stud(0.008, rgb(0x9a8650), 5)); g.surf(K_PLAIN, 0.6, 0.6); for (let i = 0; i < 3; i++) g.in(M(0, 0.04 - i * 0.04, 0.008), () => g.cbox(0.2 - i * 0.03, 0.012, 0.004, 0.001, rgb(0x3a321e))); });

  // the figure: an armoured warden, both hands on the pommel of a sword grounded at his feet
  const c = hex, P = [], Hd = [];
  const sk = (p) => p.color(c).tint(0.14, 14).pbr(0.92);
  for (const e of [-1, 1]) {
    P.push(sk(S.capsule([e * 0.07, 0.5, 0], [e * 0.085, 0.27, 0.012], 0.066, 0.05)));                                 // thigh
    P.push(sk(S.capsule([e * 0.085, 0.27, 0.012], [e * 0.09, 0.07, 0], 0.05, 0.04).blend(0.02)));                     // greave
    P.push(sk(S.sphere(0.047).at(e * 0.085, 0.275, 0.03).blend(0.012)));                                               // knee cop
    P.push(sk(S.ellipsoid(0.044, 0.034, 0.085).at(e * 0.092, 0.032, 0.035).blend(0.02)));                              // sabaton
    P.push(sk(S.ellipsoid(0.075, 0.05, 0.085).rot(0, 0, e * -18).at(e * 0.185, 0.875, 0).blend(0.015)));               // pauldron
    P.push(sk(S.ellipsoid(0.062, 0.035, 0.072).rot(0, 0, e * -28).at(e * 0.2, 0.83, 0).blend(0.008)));                 //   its lower lame
    P.push(sk(S.capsule([e * 0.185, 0.84, 0], [e * 0.2, 0.67, 0.06], 0.05, 0.043).blend(0.02)));                      // upper arm
    P.push(sk(S.sphere(0.046).at(e * 0.2, 0.67, 0.06).blend(0.012)));                                                  // couter
    P.push(sk(S.capsule([e * 0.2, 0.67, 0.06], [e * 0.045, 0.725, 0.165], 0.043, 0.036).blend(0.015)));               // forearm
    P.push(sk(S.cone(0.047, 0.04, 0.05, 0.008).rot(62, e * -55, 0).at(e * 0.085, 0.712, 0.14).blend(0.006)));          // gauntlet cuff
    P.push(sk(S.ellipsoid(0.036, 0.03, 0.04).at(e * 0.026, 0.735, 0.178).blend(0.012)));                               // hand
  }
  P.push(sk(S.cone(0.19, 0.125, 0.4, 0.02).at(0, 0.5, 0).bump(0.009, 9, 'fur').blend(0.02)));                          // surcoat skirt, hanging in folds
  P.push(sk(S.ellipsoid(0.15, 0.16, 0.105).at(0, 0.76, 0.005).blend(0.03)));                                           // breastplate
  P.push(sk(S.ellipsoid(0.12, 0.1, 0.095).at(0, 0.64, 0).blend(0.03)));
  P.push(sk(S.torus(0.128, 0.018).at(0, 0.6, 0).blend(0.008)));                                                        // belt
  P.push(sk(S.box(0.05, 0.05, 0.03, 0.008).at(0, 0.6, 0.125).blend(0.004)));
  P.push(sk(S.capsule([0, 0.86, 0], [0, 0.95, 0.005], 0.062, 0.055).blend(0.02)));                                     // gorget
  P.push(sk(S.ellipsoid(0.088, 0.105, 0.096).at(0, 1.03, 0.004).blend(0.012)));                                        // helm
  P.push(sk(S.cone(0.1, 0.075, 0.06, 0.01).at(0, 0.965, 0).blend(0.012)));                                             //   and its neck guard
  P.push(S.box(0.115, 0.02, 0.05, 0.004).at(0, 1.04, 0.085).cut(0.004).color(0x24221f));                              // eye slit
  P.push(S.box(0.016, 0.085, 0.05, 0.004).at(0, 0.995, 0.09).cut(0.004).color(0x24221f));                             // breath slot
  P.push(sk(S.box(0.014, 0.05, 0.19, 0.006).rot(-10, 0, 0).at(0, 1.135, -0.01).blend(0.012)));                         // crest
  P.push(sk(S.box(0.34, 0.74, 0.045, 0.02).rot(7, 0, 0).at(0, 0.5, -0.115).bump(0.012, 8, 'fur').blend(0.025)));       // cloak
  P.push(sk(S.ellipsoid(0.03, 0.03, 0.03).at(0, 0.745, 0.178).blend(0.01)));                                           // pommel under the hands
  P.push(sk(S.box(0.3, 0.03, 0.26, 0.012).at(0, 0.012, 0.01)));                                                        // his own base slab
  // the sword is cut crisp: a broad fullered blade and a straight guard
  Hd.push(H.box(0.05, 0.6, 0.016, 0.004).at(0, 0.33, 0.178).color(c).pbr(0.9));
  Hd.push(H.box(0.012, 0.5, 0.006, 0.002).at(0, 0.36, 0.187).color(c).pbr(0.9));
  Hd.push(H.box(0.19, 0.026, 0.03, 0.006).at(0, 0.64, 0.178).color(c).pbr(0.9));
  Hd.push(H.cyl(0.014, 0.016, 0.085, 8).at(0, 0.69, 0.178).color(c).pbr(0.9));
  g.surf(K_STONE, 0.93);
  g.in(M(0, 0.55, -0.01, 0, 0, 0, 1.3), () => g.sculpt({ prims: P, hard: Hd }, 56, 0.8));
  return g;
}

function pillar(hex) {
  const g = new Geo(), col = rgb(hex), cc = stoneTint(col, 3, 4);
  const flutes = 16, sh0 = 0.42, sh1 = 1.66, r0 = 0.255, r1 = 0.215;
  g.surf(K_STONE, 0.9);
  g.in(M(0, 0.01, 0), () => g.cbox(0.8, 0.26, 0.8, 0.018, cc));
  g.in(M(0, 0.175, 0), () => g.cbox(0.7, 0.07, 0.7, 0.014, cc));
  // base: torus, hollow, torus
  const base = [[0.33, 0.21]];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI; base.push([0.3 + 0.045 * Math.cos(a), 0.255 + 0.045 * Math.sin(a)]); }
  for (let i = 1; i < 5; i++) { const a = (i / 5) * Math.PI; base.push([0.3 - 0.028 * Math.sin(a), 0.3 + (i / 5) * 0.05]); }
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i / 5) * Math.PI; base.push([0.275 + 0.03 * Math.cos(a), 0.38 + 0.03 * Math.sin(a)]); }
  base.push([r0 + 0.012, 0.41], [r0 + 0.012, sh0 + 0.012]);
  g.lathe(base, 40, cc);
  // shaft: fluted, with a gentle swelling, a chip or two knocked out of the arrises
  const seg = flutes * 6;
  g.sheet(seg, 12, (u, v) => {
    const a = u * TAU, y = lerp(sh0, sh1, v), ent = lerp(r0, r1, v) + 0.012 * Math.sin(Math.PI * Math.min(1, v * 1.2));
    const f = (u * flutes) % 1, ends = Math.min(1, Math.min(v, 1 - v) * 14), cut = Math.pow(Math.sin(Math.PI * f), 0.8) * 0.02 * ends;
    const chip = smooth(0.8, 0.93, noise3(Math.cos(a) * 3 + 4, y * 5, Math.sin(a) * 3)) * 0.012 * (1 - Math.sin(Math.PI * f));
    return [Math.cos(a) * (ent - cut - chip), y, Math.sin(a) * (ent - cut - chip)];
  }, (x, y, z, nx, ny, nz, u, v) => { const f = (u * flutes) % 1; return mul(col, (0.8 + 0.2 * (1 - Math.sin(Math.PI * f))) * (0.92 + 0.14 * noise3(x * 4, y * 2, z * 4))); }, true);
  // capital: necking, a flaring bell with upright leaves, a square abacus with corner scrolls
  g.lathe([[r1 + 0.006, sh1 - 0.01], [r1 + 0.03, sh1 + 0.005], [r1 + 0.036, sh1 + 0.025], [r1 + 0.03, sh1 + 0.045], [r1 + 0.008, sh1 + 0.055], [r1 + 0.012, sh1 + 0.1], [r1 + 0.05, sh1 + 0.17], [r1 + 0.11, sh1 + 0.22], [r1 + 0.13, sh1 + 0.24]], 40, cc);
  for (let i = 0; i < 8; i++) g.in(M(0, sh1 + 0.06, 0, 0, i * 45, 0), () => g.sheet(4, 5, (u, v) => {
    const w = 0.085 * Math.sin(Math.PI * (0.12 + 0.88 * (1 - v * 0.85))) , out = r1 + 0.02 + 0.04 * v + 0.07 * v * v * v + 0.012 * (1 - Math.abs(u - 0.5) * 2);
    return [(u - 0.5) * w * 2, v * 0.17 - 0.035 * v * v * v, out];
  }, (x, y, z, nx, ny, nz, u, v) => mul(col, 0.82 + 0.25 * v - 0.12 * Math.abs(u - 0.5))));
  g.in(M(0, sh1 + 0.275, 0), () => g.cbox(0.74, 0.075, 0.74, 0.016, cc));
  g.in(M(0, sh1 + 0.33, 0), () => g.cbox(0.8, 0.04, 0.8, 0.012, cc));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * 0.335, sh1 + 0.2, sz * 0.335, 0, sx * sz > 0 ? 45 : -45, 0), () => g.in(M(0, 0, -0.04, 90, 0, 0), () => g.lathe([[0, 0], [0.03, 0.004], [0.055, 0.02], [0.062, 0.04], [0.055, 0.06], [0.03, 0.076], [0, 0.08]], 12, cc)));
  g.shade(-0.5, sh1 - 0.1, -0.5, 0.5, sh1 + 0.26, 0.5, 0.25, 0.08, [1, 1]);
  // ivy has found its way up one side
  const rnd = rng(77), ivy = [], lf = rgb(0x3f6f33);
  for (let i = 0; i <= 26; i++) { const t = i / 26, a = 0.6 + t * 4.2 + Math.sin(t * 9) * 0.25, y = 0.02 + t * 1.25, r = (y < 0.2 ? 0.42 : y < sh0 ? 0.345 - (y - 0.2) * 0.3 : lerp(r0, r1, (y - sh0) / (sh1 - sh0))) + 0.012; ivy.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  g.surf(K_WOOD, 0.9);
  g.tube(ivy, ivy.map((_, i) => 0.011 * (1 - (i / 26) * 0.7)), 5, rgb(0x4a3a26), false);
  g.surf(K_LEAF, 0.85);
  for (let i = 1; i < 26; i++) for (let k = 0; k < 2; k++) {
    const p = ivy[i], l = Math.hypot(p[0], p[2]), nx = p[0] / l, nz = p[2] / l, s = 0.05 + rnd() * 0.035, sp = (rnd() - 0.5) * 2.4, c = mul(lf, 0.7 + 0.6 * rnd());
    const ux = -nz * Math.cos(sp), uz = nx * Math.cos(sp), uy = Math.sin(sp), o = [p[0] + nx * 0.012 + ux * 0.02, p[1] + uy * 0.02, p[2] + nz * 0.012 + uz * 0.02];
    const wx = uy * nz, wy = uz * nx - ux * nz, wz = -uy * nx;
    g.flat([o, [o[0] + ux * s * 0.5 + wx * s * 0.45 + nx * 0.012, o[1] + uy * s * 0.5 + wy * s * 0.45, o[2] + uz * s * 0.5 + wz * s * 0.45 + nz * 0.012], [o[0] + ux * s + nx * 0.004, o[1] + uy * s, o[2] + uz * s + nz * 0.004], [o[0] + ux * s * 0.5 - wx * s * 0.45 + nx * 0.012, o[1] + uy * s * 0.5 - wy * s * 0.45, o[2] + uz * s * 0.5 - wz * s * 0.45 + nz * 0.012]], [mul(c, 0.7), c, mul(c, 1.2), c]);
  }
  return g;
}

// ---------- rubble ----------
// All the game passes is a footprint and a colour, so the colour decides what the ruin is made of.
function ruinOf(col, area) {
  const mx = Math.max(col[0], col[1], col[2]), mn = Math.min(col[0], col[1], col[2]), sat = (mx - mn) / (mx || 1), lum = (col[0] + col[1] + col[2]) / 3;
  if (sat < 0.28) return 'stone';
  if (lum > 0.33) return area >= 9 ? 'house' : 'soft';
  return 'wood';
}
function rubbleHeap(w, h, hex) {
  const g = new Geo(), col = rgb(hex), rnd = rng(700 + w * 31 + h * 7), hx = w / 2, hz = h / 2, area = w * h, kind = ruinOf(col, area);
  const stone = kind === 'stone' || kind === 'house' ? col : rgb(0x8a857c), timber = kind === 'wood' ? mul(col, 0.8) : rgb(0x4a3828);
  const peak = Math.min(0.2, 0.09 + 0.03 * Math.min(w, h));
  const ground = (x, z) => { const fx = 1 - (x / hx) ** 2, fz = 1 - (z / hz) ** 2; return fx > 0 && fz > 0 ? peak * Math.pow(fx * fz, 0.55) * (0.6 + 0.8 * noise3(x * 1.7 + w, 3, z * 1.7 + h)) : 0; };
  const inside = (m) => [(rnd() * 2 - 1) * Math.max(0.05, hx - m), (rnd() * 2 - 1) * Math.max(0.05, hz - m)];
  const dust = kind === 'soft' ? mul(col, 0.7) : mix(mul(stone, 0.55), rgb(0x6a5a48), 0.5);
  // a bank of dust and small stuff: ragged in outline, dying away into the ground
  g.surf(K_PLAIN, 1);
  const nr = Math.max(16, Math.round((w + h) * 5));
  g.sheet(nr, 5, (u, v) => {
    const a = u * TAU, c = Math.cos(a), si = Math.sin(a), edge = 0.98 / Math.max(Math.abs(c) / hx, Math.abs(si) / hz), rr = edge * (0.8 + 0.2 * noise3(c * 1.7 + w, si * 1.7 + h, 5)) * (1 - v);
    const x = c * rr, z = si * rr;
    return [x, v === 0 ? -0.05 : ground(x, z) - 0.02 * (1 - v), z];
  }, (x, y, z) => mul(dust, 0.7 + 0.5 * noise3(x * 6, 1, z * 6)), true);

  if (kind === 'soft') {
    // canvas and sacking: a crumpled sheet lying where it fell, ridged with sharp folds, its poles and cords across it
    g.surf(K_CLOTH, 0.96);
    const na = Math.max(56, Math.round((w + h) * 16)), ridge = (x, z) => Math.pow(1 - Math.abs(noise3(x * 2.9 + w, 7, z * 2.9) - 0.5) * 2, 2.2) + 0.4 * Math.pow(1 - Math.abs(noise3(x * 6.1, 2, z * 6.1 + h) - 0.5) * 2, 3);
    g.sheet(na, 16, (u, v) => {
      const a = u * TAU, c = Math.cos(a), si = Math.sin(a), edge = 0.9 / Math.max(Math.abs(c) / hx, Math.abs(si) / hz), rr = edge * (0.72 + 0.28 * noise3(c * 2.3 + w, si * 2.3 + h, 9)) * (1 - v);
      const x = c * rr, z = si * rr, e = smooth(0, 0.3, v);
      return [x, v === 0 ? -0.03 : 0.012 + ground(x, z) * 0.6 + e * (0.02 + 0.085 * ridge(x, z)), z];
    }, (x, y, z) => mul(col, (0.55 + 0.4 * Math.min(1, ridge(x, z))) * (0.85 + 0.25 * noise3(x * 7, y * 7, z * 7))), true);
    for (let i = 0; i < 2 + Math.round(area / 2); i++) { const len = Math.min(Math.max(w, h) * 0.9, 0.6 + rnd() * 0.7), [x, z] = inside(len * 0.5), a = rnd() * Math.PI; logTo(g, [x - Math.cos(a) * len / 2, 0.1 + rnd() * 0.05, z - Math.sin(a) * len / 2], [x + Math.cos(a) * len / 2, 0.13 + rnd() * 0.07, z + Math.sin(a) * len / 2], 0.022, 0.018, i, { seg: 6, capB: true, bark: rgb(0x6a4c30) }); }
    for (let i = 0; i < 2; i++) { const [x, z] = inside(0.3), pts = []; for (let k = 0; k <= 10; k++) pts.push([x + k * 0.05 * Math.cos(i * 2 + 1) + 0.03 * Math.sin(k * 1.3), 0.13 + 0.02 * Math.sin(k * 0.9), z + k * 0.05 * Math.sin(i * 2 + 1) + 0.03 * Math.cos(k * 1.7)]); rope(g, pts, 0.008); }
    return g;
  }
  // broken masonry (or lumps of daub from a timber house)
  const nBlocks = Math.round(Math.min(150, area * (kind === 'wood' ? 2.5 : kind === 'house' ? 4.5 : 8)) * qual());
  g.surf(kind === 'house' ? K_PLASTER : K_STONE, 0.95);
  for (let i = 0; i < nBlocks; i++) {
    const big = rnd() < 0.3, s = big ? 0.2 + rnd() * 0.14 : 0.08 + rnd() * 0.1, [x, z] = inside(s * 0.8), c = mul(stone, 0.72 + 0.45 * rnd()), flatish = rnd() < 0.5;
    g.in(M(x, Math.min(0.42 - s * 0.62, ground(x, z) + s * (big ? 0.18 : 0.3)), z, flatish ? (rnd() - 0.5) * 40 : rnd() * 360, rnd() * 360, flatish ? (rnd() - 0.5) * 40 : rnd() * 360), () => g.cbox(s * (1 + rnd() * 0.7), s * (0.5 + rnd() * 0.3), s * (0.7 + rnd() * 0.4), s * (0.03 + rnd() * 0.06), stoneTint(c, i, 9)));
  }
  // splintered timbers
  const nBeams = Math.round(Math.min(40, area * (kind === 'wood' ? 3.2 : kind === 'house' ? 2.2 : 0.9) + 1) * Math.sqrt(qual()));
  for (let i = 0; i < nBeams; i++) {
    const len = Math.min(Math.min(w, h) * 0.9, 0.5 + rnd() * 0.8), [x, z] = inside(len * 0.5 + 0.05), a = rnd() * 180, pitch = (rnd() - 0.5) * 12, t = 0.06 + rnd() * 0.06;
    const c = woodTint(mul(timber, 0.75 + 0.5 * rnd()), i);
    g.in(M(x, Math.min(0.32, ground(x, z) + 0.05 + rnd() * 0.08), z, 0, a, pitch), () => {
      g.surf(K_WOOD, 0.92);
      g.in(M(0, 0, 0, rnd() * 90, 0, 0), () => {
        g.beam(len, t, t * (0.6 + rnd() * 0.5), 0.01, c, 3);
        // the broken end: a brush of splinters
        for (const e of [-1, 1]) if (rnd() < 0.75) for (let k = 0; k < 4; k++) { const oy = (rnd() - 0.5) * t * 0.7, oz = (rnd() - 0.5) * t * 0.6, sl = 0.05 + rnd() * 0.09; g.flat([[e * len / 2, oy - 0.012, oz - 0.012], [e * len / 2, oy + 0.012, oz + 0.012], [e * (len / 2 + sl), oy + (rnd() - 0.5) * 0.03, oz + (rnd() - 0.5) * 0.03]], [mul(timber, 0.9), mul(timber, 0.9), rgb(0xc9a878)]); }
      });
    });
  }
  // snapped planks; roof tiles where a house came down
  g.surf(K_WOOD, 0.92);
  for (let i = 0; i < Math.round(area * (kind === 'wood' ? 2.2 : 0.5)); i++) { const [x, z] = inside(0.25); g.in(M(x, ground(x, z) + 0.03, z, (rnd() - 0.5) * 30, rnd() * 360, (rnd() - 0.5) * 30), () => g.beam(0.25 + rnd() * 0.3, 0.02, 0.1 + rnd() * 0.05, 0.004, woodTint(mul(timber, 0.9 + 0.5 * rnd()), i + 50), 2)); }
  if (kind === 'house') {
    g.surf(K_ROOF, 0.85);
    for (let i = 0; i < area * 7; i++) { const [x, z] = inside(0.1); g.in(M(x, ground(x, z) + 0.02 + rnd() * 0.05, z, (rnd() - 0.5) * 50, rnd() * 360, (rnd() - 0.5) * 50), () => g.cbox(0.1 + rnd() * 0.05, 0.016, 0.13 + rnd() * 0.05, 0.004, mul(TERRACOTTA[i % TERRACOTTA.length], 0.8 + 0.4 * rnd()))); }
  }
  return g;
}

export const structures = {
  castleWall: (def, w, h) => oriented(def, w, h, (L) => castleWall(L)),
  castleTower: (def) => cached('castleTower', () => finish(castleTower())),
  castleGate: (def, w, h) => oriented(def, w, h, () => castleGate(def.color)),
  stairs: (def, w, h) => oriented(def, w, h, () => castleStairs()),
  keep: (def) => cached(`keep:${def.color}`, () => finish(keep(def.color))),
  wall: (def, w, h) => oriented(def, w, h, (L) => fieldWall(L, def.color)),
  gate: (def, w, h) => oriented(def, w, h, () => archway(def.color)),
  bastion: (def) => cached(`bastion:${def.color}`, () => finish(bastion(def.color))),
  house: (def) => cached(`house:${def.color}`, () => finish(house(def.color))),
  hut: (def) => cached(`hut:${def.color}`, () => finish(hut(def.color))),
  tower: (def) => cached(`tower:${def.color}`, () => finish(watchtower(def.color))),
  deck: (def, w, h) => oriented(def, w, h, (L, D) => raisedDeck(L, D, def.color)),
  palisade: (def, w, h) => oriented(def, w, h, (L) => palisade(L, def.color)),
  barricade: (def, w, h) => oriented(def, w, h, (L) => barricade(L, def.color)),
  crates: (def) => cached(`crates:${def.color}`, () => finish(crates(def.color))),
  tent: (def) => cached(`tent:${def.color}`, () => finish(tent(def.color))),
  sandbags: (def, w, h) => oriented(def, w, h, (L) => sandbags(L, def.color)),
  statue: (def) => cached(`statue:${def.color}`, () => finish(statue(def.color))),
  pillar: (def) => cached(`pillar:${def.color}`, () => finish(pillar(def.color))),
  tree: (def) => scattered('tree', def.color, 3, tree),
  pine: (def) => scattered('pine', def.color, 3, pine),
  rock: (def) => scattered('rock', def.color, 3, rock, true),
};

/** rubble(w, h, colorHex) -> heap of debris covering a w x h footprint: broken blocks, splintered beams, dust */
export function rubble(w, h, colorHex) { return cached(`rubble:${w}x${h}:${colorHex}`, () => finish(rubbleHeap(w, h, colorHex))); }
