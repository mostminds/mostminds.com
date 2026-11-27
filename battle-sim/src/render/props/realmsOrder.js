// Landmark buildings of the realms of Order: Graal, Aurelia, Aethel, Kael'neth, the Verdant, Grom, Xibalba,
// Velikaya and Tianlong (two each).
//
//   structures[def.model](def, w, h, place) -> Object3D centred on its footprint, resting on y = 0
//
// Built the same way as civic.js, with the same construction kit (repeated here because that module keeps it
// private): everything is emitted into one vertex-coloured geometry for the shared sculpt material, plus a
// second small mesh named 'colours' for whatever flies the owning side's colour. Geometry is built once per
// model and detail preset; every placement shares it.
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
    const gt = o.tilt ?? 0.5;   // how far a stone's face rolls over into its joints (large coarse blocks want less)
    const id = new Array(W * (ny + 1));
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      let pu = a0 + ((a1 - a0) * i) / nx, pv = c0 + ((c1 - c0) * j) / ny;
      const L = i === 0, R = i === nx, B = j === 0, T = j === ny;
      const n0 = noise3(pu * nf + sx, pv * nf, sx * 0.7), n1 = noise3((pu + eps) * nf + sx, pv * nf, sx * 0.7), n2 = noise3(pu * nf + sx, (pv + eps) * nf, sx * 0.7);
      let d = r * rm - o.rough * n0, lite = 0.9 + 0.2 * n0;
      let nX = ((n0 - n1) / eps) * o.bump * 0.02, nY = ((n0 - n2) / eps) * o.bump * 0.02;
      if ((L && eL === CORNER) || (R && eR === CORNER) || (B && eB === CORNER) || (T && eT === CORNER)) d = r;
      if (L) nX -= eL === CORNER ? 1 : eL === GROOVE ? gt : 0; else if (R) nX += eR === CORNER ? 1 : eR === GROOVE ? gt : 0;
      if (B) nY -= eB === CORNER ? 1 : eB === GROOVE ? gt : 0; else if (T) nY += eT === CORNER ? 1 : eT === GROOVE ? gt : 0;
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


const CASTLE = 0x9f9a8f;          // one stone for walls, towers, gatehouse and stairs
const PAR_T = 0.14, PAR_C = 0.15; // parapet thickness and course height
const PAR_B = 2 * PAR_C, PAR_M = 4 * PAR_C; // breast-wall and merlon tops above the walk
const castleStone = (seed, o) => stoneStyle(CASTLE, { seed, ...o });
const pavingStyle = (seed, o) => stoneStyle(CASTLE, { seed, r: 0.008, b: 0.012, rough: 0.004, bump: 0.3, flat: true, chip: 0.08, len: [0.26, 0.5], pal: stoneStyle(CASTLE).pal.map((c) => mul(c, 0.86)), cell: 0.15 / qual(), ...o });
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
/** castle plinth along X: two courses standing `pl` proud of the face at z = 0 with a weathered top */
function plinth(g, L, st, seed, corner = false, pl = 0.05, plH = 2 * COURSE) {
  const r = st.r, e = corner ? CORNER : CUT, W = corner ? L + 2 * (pl - r) : L;
  g.in(M(-W / 2, 0, pl - r), () => g.ashlar(W, plH - 0.06, { ...st, seed, len: [0.4, 0.72], ends: [e, e, 0, 0], quoin: corner ? [0.62, 0.34] : null }));
  band(g, [[pl, plH - 0.062], [0.004, plH + 0.012]], L, mul(st.pal[0], 1.03), seed + 1, corner ? 1 : 0, corner ? 1 : 0);
  if (!corner) for (const s of [-1, 1]) g.poly([[s * L / 2, -0.16, -r], [s * L / 2, plH - 0.062, -r], [s * L / 2, plH - 0.062, pl], [s * L / 2, -0.16, pl]], s, 0, 0, st.pal[0]);
  footing(g, -L / 2 - (corner ? pl : 0), L / 2 + (corner ? pl : 0), st.pal[0], pl);
}
const SLATE = [rgb(0x4a5666), rgb(0x566272), rgb(0x3e4857), rgb(0x5e5c6a), rgb(0x4d5f68)];
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
    g.surf(K_PLAIN, 1, 0, 1.35);
    const fl = (x, y) => (y > 0.16 ? [1.0, 0.2, 0.02] : y > 0.07 ? [1.0, 0.34, 0.04] : [1.0, 0.5, 0.08]);
    g.in(M(0, 0.07, 0), () => g.lathe([[0.03, 0], [0.045, 0.04], [0.036, 0.09], [0.018, 0.15], [0.006, 0.2], [0, 0.24]], 7, fl));
    g.in(M(0.018, 0.07, 0.01, 0, 40, 8), () => g.lathe([[0.02, 0], [0.026, 0.04], [0.012, 0.1], [0, 0.15]], 6, fl));
  });
}

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
function rope(g, pts, rad = 0.012, col = rgb(0xb89c68), radial = 6) {
  g.surf(K_CLOTH, 0.95);
  const L = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) : 0), 0);
  g.tube(pts, rad, radial, (x, y, z, nx, ny, nz, t, k) => mul(col, (k + Math.floor(t * L * 40)) % 2 ? 1.05 : 0.68), false);
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
/** a window: leaded glass in a timber frame, shutters folded back, an optional flower box; lit = lamplight behind the glass; local origin at its centre */
function casement(g, w, h, wood, seed, shutters = true, box = false, lit = false) {
  if (lit) g.surf(K_PLAIN, 0.4, 0, 0.95); else g.surf(K_PLAIN, 0.12, 0.3);
  const gl = lit ? [[1.0, 0.5, 0.12], [1.0, 0.5, 0.12], [1.0, 0.72, 0.3], [1.0, 0.72, 0.3]] : [[0.015, 0.03, 0.045], [0.015, 0.03, 0.045], [0.06, 0.1, 0.13], [0.06, 0.1, 0.13]];
  g.flat([[-w / 2, -h / 2, 0.012], [w / 2, -h / 2, 0.012], [w / 2, h / 2, 0.012], [-w / 2, h / 2, 0.012]], gl);
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
/** a ladder from foot a to head b: two poles and round rungs */
function ladder(g, a, b, wide, step, wood, seed, up = [0, 1, 0]) {
  const f = along(a, b, up);
  g.in(f.m, () => {
    g.surf(K_WOOD, 0.9);
    for (const e of [-1, 1]) g.in(M(0, 0, e * wide / 2), () => g.beam(f.L, 0.05, 0.035, 0.01, woodTint(mul(wood, 0.8), seed + e), 5));
    const n = Math.floor((f.L - 0.2) / step);
    for (let i = 0; i <= n; i++) g.in(M(-f.L / 2 + 0.16 + i * step, 0, -wide / 2 - 0.03, 90, 0, 0), () => g.cyl(0.016, 0.016, wide + 0.06, 6, woodTint(wood, seed + i), true, true));
  });
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

// =====================================================================================================
// Civic kit
// =====================================================================================================
const SIDE_HEX = [0x3d7bd9, 0xd9463d], NEUTRAL = 0xcdbf9a;
const GILT = rgb(0xd9a83a), COPPER = rgb(0xb86a3c), VERDIGRIS = rgb(0x5fae9a), LEAD = rgb(0x6f7a80), CREAM = rgb(0xe9dfc4);
const BLUE_SLATE = [rgb(0x3f5f8a), rgb(0x4a6c98), rgb(0x35527a), rgb(0x566f96), rgb(0x3d6488)];
const JEWEL = [rgb(0xc8323a), rgb(0x2f58c8), rgb(0xe0b02c), rgb(0x2f9a58), rgb(0x8a3fb8), rgb(0xe07a28), rgb(0x38a8c8)];
const sideMats = new Map(), structCache = new Map();
/** the shared material tinted to a side's colour (side-coloured geometry is baked in greys) */
function sideMaterial(hexCol) {
  if (!sideMats.has(hexCol)) { const m = sculptMaterial().clone(); m.color.setHex(hexCol); sideMats.set(hexCol, m); }
  return sideMats.get(hexCol);
}
/**
 * Build once per key and detail preset: make(g, f) draws the building into g and anything that takes the owning
 * side's colour into f (in greys). Returns a group of one or two meshes sharing that geometry; `turn` gives the
 * quarter-turned copy for rotated placements. Whatever make returns is copied onto userData.
 */
function struct(key, turn, place, make) {
  const k = `${key}|${getDetail()}`;
  if (!structCache.has(k)) {
    const g = new Geo(), f = new Geo(), info = make(g, f) || null;
    structCache.set(k, { geo: g.build(), side: f.n ? f.build() : null, turned: null, sideTurned: null, info });
  }
  const c = structCache.get(k);
  if (turn && !c.turned) { c.turned = c.geo.clone().rotateY(Math.PI / 2); c.sideTurned = c.side ? c.side.clone().rotateY(Math.PI / 2) : null; }
  const root = new THREE.Group(), m = meshOf(turn ? c.turned : c.geo);
  root.add(m);
  const sg = turn ? c.sideTurned : c.side;
  if (sg) { const sm = new THREE.Mesh(sg, sideMaterial(place && SIDE_HEX[place.side] !== undefined ? SIDE_HEX[place.side] : NEUTRAL)); sm.castShadow = true; sm.receiveShadow = true; sm.name = 'colours'; root.add(sm); }
  if (c.info) Object.assign(root.userData, JSON.parse(JSON.stringify(c.info)));
  return root;
}
/** long pieces are modelled along X; a placement with h > w gets the quarter-turned copy */
const longways = (def, w, h, place, make) => { const L = Math.max(w, h), D = Math.min(w, h); return struct(`${def.model}|${L}|${D}|${def.color}`, h > w, place, (g, f) => make(g, f, L, D)); };
/** y' = y + k x: lays whatever is drawn along X up a slope without tipping its uprights */
const shearY = (x, y, z, k) => new THREE.Matrix4().set(1, 0, 0, x, k, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
const tbOf = (wood) => (seed, k = 1) => woodTint(mul(wood, k * (0.85 + 0.3 * hash1(seed, 3))), seed);

/** four coursed faces round a box hx x hz (half sizes) from y0 to y1. o.holes[s] = holes of face s (0: +Z, 1: +X, 2: -Z, 3: -X), o.each(s, W) runs in each face's frame (origin at its lower left) */
function stoneBox(g, hx, hz, y0, y1, st, seed, o = {}) {
  const r = st.r;
  g.surf(K_STONE, 0.93);
  for (let s = 0; s < 4; s++) {
    if (o.skip && o.skip.includes(s)) continue;
    const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz;
    g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-(W - r), y0, D - r)), () => {
      g.ashlar(2 * (W - r), y1 - y0, { ...st, seed: seed + s * 7, ends: [CORNER, CORNER, 0, 0], quoin: o.quoin, holes: o.holes ? o.holes[s] : null });
      if (y0 < 0.02 && !o.noFoot) footing(g, -r, 2 * W - r, st.pal[0], r);
      if (o.each) { o.each(s, W); g.surf(K_STONE, 0.93); }
    });
  }
}
/** a stone gable on the local XY plane: base 2W wide at y = 0, apex H up; its stepped edge is meant to sit under a roof verge */
function gableStone(g, W, H, st, seed, holes = []) {
  const rows = Math.ceil(H / st.course - 1e-6), hs = holes.slice();
  for (let j = 0; j < rows; j++) {
    const v0 = j * st.course, v1 = Math.min(H, v0 + st.course), x = W * Math.min(1, (v0 + st.course * 0.25) / H);
    if (x > 0.01) { hs.push([-1, v0, x, v1, CUT]); hs.push([2 * W - x, v0, 2 * W + 1, v1, CUT]); }
  }
  g.ashlar(2 * W, H, { ...st, seed, ends: [CUT, CUT, 0, 0], holes: hs });
}
/** low parapet along local X from x0 to x1 rising from y = 0, outer face on z = 0: stone both sides, a coping on top */
function lowWall(g, x0, x1, st, seed, q = {}) {
  const eL = q.eL ?? CORNER, eR = q.eR ?? CORNER, inL = q.inL || 0, inR = q.inR || 0, t = q.t || 0.15, cp = 0.05, hh = (q.h || 0.25) - cp, r = st.r;
  const ps = { ...st, course: hh, len: q.len || [0.24, 0.46] };
  g.surf(K_STONE, 0.93);
  g.in(M(x0, 0, -r), () => g.ashlar(x1 - x0, hh, { ...ps, seed: seed + 1, ends: [eL, eR, 0, 0] }));
  g.in(M(x1 - inR, 0, -t + r, 0, 180, 0), () => g.ashlar(x1 - x0 - inL - inR, hh, { ...ps, seed: seed + 2, ends: [inR ? CUT : eR, inL ? CUT : eL, 0, 0] }));
  if (eL === CORNER && !inL) g.in(M(x0, 0, -t + r, 0, -90, 0), () => g.ashlar(t - 2 * r, hh, { ...ps, len: [1, 1], seed: seed + 3, ends: [CORNER, CORNER, 0, 0] }));
  if (eR === CORNER && !inR) g.in(M(x1, 0, -r, 0, 90, 0), () => g.ashlar(t - 2 * r, hh, { ...ps, len: [1, 1], seed: seed + 4, ends: [CORNER, CORNER, 0, 0] }));
  const o = r + 0.01, xa = x0 - (eL === CORNER && !inL ? o : 0), xb = x1 + (eR === CORNER && !inR ? o : 0);
  const capC = stoneTint(mul(st.pal[0], 1.07), seed);
  const n = Math.max(1, Math.round((xb - xa) / (q.capLen || 0.9)));
  for (let i = 0; i < n; i++) { const a = lerp(xa, xb, i / n) + (i ? 0.003 : 0), b = lerp(xa, xb, (i + 1) / n) - (i < n - 1 ? 0.003 : 0); g.in(M((a + b) / 2, hh + cp / 2, -t / 2 + 0.006), () => g.cbox(b - a, cp, t + 0.012, 0.012, capC)); }
}
/** tiled gable roof, ridge along X from o.x0 to o.x1 at height o.rY over z = o.zc, eaves o.eZ out at height o.eY */
function gableRoof(g, o) {
  const { x0, x1, eZ, eY, rY } = o, zc = o.zc || 0, sl = Math.hypot(eZ, rY - eY);
  const rows = Math.max(3, Math.round(sl / (o.th || 0.15))), n = Math.max(2, Math.round((x1 - x0) / (o.tw || 0.17)));
  g.surf(K_ROOF, o.rough ?? 0.82);
  for (const e of [1, -1]) {
    if (o.only && o.only !== e) continue;
    tiles(g, rows, () => n, (u, v) => [e > 0 ? lerp(x0, x1, u) : lerp(x1, x0, u), lerp(eY, rY, v), zc + e * lerp(eZ, 0, v)], { pal: o.pal, round: o.round, lift: o.lift || 0.022, seed: o.seed + e, gap: o.gap });
  }
  if (o.ridge !== false) { g.surf(K_ROOF, 0.8); ridge(g, [x0 - 0.02, rY + 0.015, zc], [x1 + 0.02, rY + 0.015, zc], o.ridgeR || 0.06, o.ridgeCol || mul(o.pal[0], 0.85), o.seed + 3); }
  g.surf(K_WOOD, 0.9);
  const dk = o.under || [0.1, 0.07, 0.05];
  for (const e of [1, -1]) {
    if (o.only && o.only !== e) continue;
    g.flat([[x0, eY - 0.012, zc + e * eZ], [x1, eY - 0.012, zc + e * eZ], [x1, rY - 0.012, zc], [x0, rY - 0.012, zc]], dk);
    if (o.barge) for (const x of [x0 - 0.012, x1 + 0.012]) g.beamTo([x, eY - 0.05, zc + e * (eZ + 0.03)], [x, rY - 0.03, zc], 0.14, 0.035, 0.008, woodTint(o.barge, x * 3 + e), 3);
  }
}
/** tiled hipped roof over a rectangle: eaves at +-ex, +-ez (height eY) about (cx, cz), ridge of half length rl at rY */
function hipRoof(g, ex, ez, eY, rY, rl, pal, seed, o = {}) {
  const cx = o.cx || 0, cz = o.cz || 0, tw = o.tw || 0.17, th = o.th || 0.15;
  g.surf(K_ROOF, o.rough ?? 0.8);
  const faces = [
    [[-ex, ez], [ex, ez], [-rl, 0], [rl, 0]], [[ex, -ez], [-ex, -ez], [rl, 0], [-rl, 0]],
    [[ex, ez], [ex, -ez], [rl, 0], [rl, 0]], [[-ex, -ez], [-ex, ez], [-rl, 0], [-rl, 0]],
  ];
  faces.forEach(([a, b, c, d], fi) => {
    const wb = Math.hypot(b[0] - a[0], b[1] - a[1]), wt = Math.hypot(d[0] - c[0], d[1] - c[1]);
    const sl = Math.hypot(rY - eY, fi < 2 ? ez : ex - rl), rows = Math.max(3, Math.round(sl / th));
    tiles(g, rows, (j) => Math.max(1, lerp(wb, wt, (j + 0.5) / rows) / tw), (u, v) => { const k = Math.min(v, 0.985); return [cx + lerp(lerp(a[0], b[0], u), lerp(c[0], d[0], u), k), lerp(eY, rY, k), cz + lerp(lerp(a[1], b[1], u), lerp(c[1], d[1], u), k)]; }, { pal, lift: o.lift || 0.02, seed: seed + fi, round: o.round });
  });
  const rc = o.ridgeCol || LEAD;
  g.surf(K_PLAIN, 0.5, o.ridgeMetal ?? 0.7);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) ridge(g, [cx + sx * (ex + 0.02), eY - 0.01, cz + sz * (ez + 0.02)], [cx + sx * rl, rY + 0.02, cz], 0.05, rc, seed + 10 + sx + sz * 2);
  if (rl > 0.03) ridge(g, [cx - rl - 0.05, rY + 0.02, cz], [cx + rl + 0.05, rY + 0.02, cz], 0.055, rc, seed + 15);
  g.surf(K_PLAIN, 1);
  g.flat([[cx - ex, eY - 0.012, cz - ez], [cx + ex, eY - 0.012, cz - ez], [cx + ex, eY - 0.012, cz + ez], [cx - ex, eY - 0.012, cz + ez]], [0.035, 0.03, 0.026]);
}
/** conical tiled roof standing on the local origin */
function coneRoof(g, R, h, pal, seed, o = {}) {
  const rows = o.rows || Math.max(5, Math.round(Math.hypot(R, h) / 0.15)), n0 = (R * TAU) / (o.tw || 0.15);
  g.surf(K_ROOF, 0.78);
  tiles(g, rows, (j) => n0 * (1 - (j + 0.4) / (rows + 0.6)) + 3, (u, v) => { const a = u * TAU, q = R * (1 - v * 0.94) * (1 + (o.bell || 0) * (1 - v) * (1 - v)); return [Math.cos(a) * q, v * h * 0.94, Math.sin(a) * q]; }, { pal, lift: 0.02, wrap: true, seed });
  g.surf(K_PLAIN, 1);
  g.cyl(R * 0.98, R * 0.98, 0.001, 20, [0.035, 0.03, 0.026], true, false);
}
/** a turned finial standing on the local origin, s = its height */
function finial(g, s, col = GILT, metal = 0.9) {
  g.surf(K_PLAIN, 0.35, metal);
  g.lathe([[0.2, 0], [0.13, 0.22], [0.055, 0.34], [0.085, 0.4], [0.105, 0.47], [0.085, 0.54], [0.035, 0.6], [0.02, 0.9], [0, 1]].map(([r, y]) => [r * s, y * s]), 10, col);
}
/** pyramid of tiles on a square of half size er, from y = 0 to the apex */
function pyramidRoof(g, er, apex, pal, seed, o = {}) {
  const rows = Math.max(3, Math.round(Math.hypot(er, apex) / (o.th || 0.15)));
  for (let s = 0; s < 4; s++) {
    const c = Math.cos(s * Math.PI / 2), si = Math.sin(s * Math.PI / 2), rot = (x, z) => [x * c + z * si, -x * si + z * c];
    g.surf(K_ROOF, 0.85);
    tiles(g, rows, (j) => Math.max(1, (2 * er * (1 - (j + 0.5) / (rows + 0.3))) / (o.tw || 0.15)), (u, v) => { const k = Math.min(v, 0.97), [x, z] = rot(lerp(-er, er, u) * (1 - k), er * (1 - k)); return [x, lerp(0, apex, k), z]; }, { pal, lift: 0.02, seed: seed + s, gap: 0.08 });
    const [x1, z1] = rot(er, er);
    g.surf(K_PLAIN, 0.5, 0.6);
    ridge(g, [x1 * 1.01, -0.01, z1 * 1.01], [0, apex + 0.01, 0], 0.035, o.ridgeCol || LEAD, seed + 9 + s);
  }
  g.surf(K_PLAIN, 1);
  g.flat([[-er, -0.012, -er], [er, -0.012, -er], [er, -0.012, er], [-er, -0.012, er]], [0.035, 0.03, 0.026]);
}
/**
 * A window of coloured glass in a wall: local origin at the middle of its sill on the wall face, +Z out.
 * o.pointed (two-centred head, default) or round; o.glow; o.pal (glass colours); o.frame (surround colour); o.plain (clear glass, lit from within)
 */
function glassWindow(g, w, h, seed, o = {}) {
  const R = o.pointed === false ? w / 2 : w * 0.95, rise = Math.sqrt(Math.max(0, R * R - (R - w / 2) ** 2)), spring = h - rise;
  const top = (x) => spring + Math.sqrt(Math.max(0, R * R - (Math.abs(x) + R - w / 2) ** 2));
  const pal = o.pal || JEWEL, frame = o.frame || rgb(0xb8b0a0), zg = -0.035;
  // glass: a mosaic of small panes
  const nx = o.nx || 4, ny = Math.max(3, Math.round(h / (w / nx) / 1.3));
  g.surf(K_PLAIN, 0.3, 0.1, o.glow ?? 0.55);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const xa = -w / 2 + (w * i) / nx, xb = xa + w / nx, ya = (h * j) / ny, yb = ya + h / ny;
    const ta = Math.min(yb, top(xa)), tb = Math.min(yb, top(xb));
    if (ta <= ya + 1e-4 && tb <= ya + 1e-4) continue;
    const hsh = hash1(seed + i * 7, j * 13 + 1), sym = Math.min(i, nx - 1 - i), main = pal[Math.abs(Math.round(seed)) % pal.length];
    const c = o.plain ? mul(o.plain, 0.75 + 0.5 * hsh) : mul(mix(pal[Math.floor(hash1(seed + sym * 3, j * 5) * pal.length) % pal.length], main, sym === 0 && !o.pal ? 0.55 : 0.15), 0.75 + 0.5 * hash1(seed + sym * 7, j * 13 + 1));
    const pts = [[xa, ya, zg], [xb, ya, zg], [xb, Math.max(ya, tb), zg], [xa, Math.max(ya, ta), zg]];
    if (yb > ta + 1e-4 && yb > tb + 1e-4 && top((xa + xb) / 2) > Math.max(ta, tb)) pts.splice(3, 0, [(xa + xb) / 2, Math.min(yb, top((xa + xb) / 2)), zg]);
    g.flat(pts, c);
  }
  // reveal and the stone between the head and the square of the opening
  const out = [];
  const na = 8;
  out.push([-w / 2, 0]);
  for (let k = 0; k <= na; k++) { const x = -w / 2 + (w * k) / na; out.push([x, top(x)]); }
  out.push([w / 2, 0]);
  g.surf(K_STONE, 0.93);
  for (let k = 0; k < out.length - 1; k++) { const a = out[k], b = out[k + 1]; g.flat([[a[0], a[1], 0.012], [b[0], b[1], 0.012], [b[0], b[1], zg], [a[0], a[1], zg]], [frame, frame, mul(frame, 0.5), mul(frame, 0.5)]); }
  g.flat([[-w / 2, 0, zg], [w / 2, 0, zg], [w / 2, 0, 0.03], [-w / 2, 0, 0.03]], mul(frame, 0.9));
  if (o.infill !== false) for (let k = 1; k < out.length - 2; k++) { const a = out[k], b = out[k + 1], sx = (a[0] + b[0]) / 2 < 0 ? -1 : 1; g.flat([[a[0], a[1], 0.006], [b[0], b[1], 0.006], [sx * w / 2, h, 0.006]], mul(frame, 0.92)); }
  g.tube(out.map(([x, y]) => [x, y, 0.014]), o.mould || 0.022, 5, stoneTint(mul(frame, 1.08), seed, 6), true);
  g.in(M(0, -0.02, 0.02), () => g.cbox(w + 0.1, 0.045, 0.07, 0.012, stoneTint(mul(frame, 1.05), seed + 1, 6)));
  // leads
  g.surf(K_PLAIN, 0.5, 0.7);
  const lead = o.lead || [0.1, 0.1, 0.11];
  if (nx % 2 === 0) g.in(M(0, top(0) / 2, zg + 0.008), () => g.cbox(0.016, top(0), 0.012, 0.003, lead));
  for (let j = 1; j < ny; j += 2) { const y = (h * j) / ny, hw = y < spring ? w / 2 : Math.max(0, w / 2 - R + Math.sqrt(Math.max(0, R * R - (y - spring) ** 2))); if (hw > 0.03) g.in(M(0, y, zg + 0.008), () => g.cbox(2 * hw, 0.012, 0.01, 0.003, lead)); }
}
/** a round window of coloured glass with stone tracery: local origin at its centre on the wall face, +Z out */
function roseWindow(g, R, seed, o = {}) {
  const frame = o.frame || rgb(0xb8b0a0), petals = o.petals || 12, pal = o.pal || JEWEL;
  g.surf(K_PLAIN, 0.3, 0.1, o.glow ?? 0.6);
  for (let i = 0; i < petals; i++) for (let k = 0; k < 2; k++) {
    const a0 = (i / petals) * TAU, a1 = ((i + 1) / petals) * TAU, r0 = k ? R * 0.55 : R * 0.16, r1 = k ? R : R * 0.55;
    const c = mul(pal[k ? [1, 0, 1, 2][i % 4] : [2, 3][i % 2]], 0.8 + 0.4 * hash1(seed + i, k));
    const am = (a0 + a1) / 2;
    g.flat([[Math.cos(a0) * r0, Math.sin(a0) * r0, 0.01], [Math.cos(am) * r0, Math.sin(am) * r0, 0.01], [Math.cos(a1) * r0, Math.sin(a1) * r0, 0.01], [Math.cos(a1) * r1, Math.sin(a1) * r1, 0.01], [Math.cos(am) * r1, Math.sin(am) * r1, 0.01], [Math.cos(a0) * r1, Math.sin(a0) * r1, 0.01]], c);
  }
  g.surf(K_STONE, 0.93);
  const fc = stoneTint(mul(frame, 1.06), seed, 6);
  g.add(new THREE.TorusGeometry(R + 0.03, 0.05, 6, 28), fc);
  g.in(M(0, 0, 0.012), () => g.add(new THREE.TorusGeometry(R * 0.55, 0.018, 5, 24), fc));
  for (let i = 0; i < petals; i++) { const a = (i / petals) * TAU; g.beamTo([Math.cos(a) * R * 0.17, Math.sin(a) * R * 0.17, 0.014], [Math.cos(a) * R, Math.sin(a) * R, 0.014], 0.024, 0.024, 0.006, frame, 1, [0, 0, 1]); }
  g.in(M(0, 0, 0.012, 90, 0, 0), () => g.lathe([[R * 0.18, 0], [R * 0.16, 0.02], [0, 0.035]], 12, fc));
}
/** a stone column standing on the local origin: base, tapering shaft, moulded capital with a square abacus */
function column(g, r, h, col, seed = 0, seg = 14) {
  const c = stoneTint(col, seed, 5);
  g.surf(K_STONE, 0.9);
  g.in(M(0, r * 0.25, 0), () => g.cbox(r * 2.9, r * 0.5, r * 2.9, r * 0.1, c));
  g.lathe([[r * 1.35, r * 0.5], [r * 1.4, r * 0.66], [r * 1.3, r * 0.82], [r * 1.08, r * 0.9], [r * 1.12, r * 1.04], [r * 1.02, r * 1.14], [r, r * 1.3], [r * 1.03, h * 0.4], [r * 0.86, h - r * 1.5], [r * 0.98, h - r * 1.42], [r * 1.0, h - r * 1.26], [r * 0.86, h - r * 1.18], [r * 0.9, h - r * 0.95], [r * 1.32, h - r * 0.5]], seg, c);
  g.in(M(0, h - r * 0.25, 0), () => g.cbox(r * 2.8, r * 0.5, r * 2.8, r * 0.1, c));
}
/** a pole with a swallow-tailed pennant flying toward +X, the cloth drawn into the side-colour geometry f; foot of the pole at the local origin of g */
function sidePennant(g, f, h, len, hgt) {
  g.surf(K_WOOD, 0.8);
  g.cyl(0.022, 0.016, h, 8, woodTint(rgb(0x5a4028), 2), false, true);
  g.in(M(0, h, 0), () => finial(g, 0.09));
  f.seg = g.seg;
  f.surf(K_PLAIN, 0.9);
  f.sheet(12, 4, (u, v) => {
    const fork = u > 0.7 ? (u - 0.7) / 0.3 : 0, w = hgt * (1 - 0.25 * u), y = (v - 0.5) * w;
    const cut = fork * (1 - Math.abs(v - 0.5) * 2) * len * 0.3;
    return [0.02 + u * len - cut, h - 0.05 - hgt * 0.5 + y - u * u * 0.05, Math.sin(u * 7 + v) * 0.035 * u];
  }, (x, y, z, nx, ny, nz, u, v) => (Math.abs(v - 0.5) < 0.15 ? [1.25, 1.25, 1.25] : mul([0.8, 0.8, 0.8], 0.85 + 0.3 * Math.sin(u * 7 + 1))));
  f.seg = { e: null, ne: null, bend: 0, up: null };
}
/** a long banner hanging down from a bar: local origin at the middle of the bar, cloth facing +Z; drawn into f in the current frame of g */
function sideBanner(g, f, w, len, seed = 0) {
  g.surf(K_WOOD, 0.8);
  g.in(M(-w / 2 - 0.05, 0, 0.012, 0, 0, -90), () => g.cyl(0.016, 0.016, w + 0.1, 6, woodTint(rgb(0x4a3524), seed), true, true));
  g.surf(K_PLAIN, 0.4, 0.9);
  for (const e of [-1, 1]) g.in(M(e * (w / 2 + 0.05), 0, 0.012), () => g.add(new THREE.SphereGeometry(0.026, 8, 6), GILT));
  f.seg = g.seg;
  f.surf(K_PLAIN, 0.9);
  f.sheet(6, 12, (u, v) => {
    const tail = v > 0.82 ? (v - 0.82) / 0.18 : 0, cut = tail * (1 - Math.abs(u - 0.5) * 2) * len * 0.16;
    return [(u - 0.5) * w * (1 - 0.06 * v), -v * len + cut, 0.014 + 0.03 * Math.sin(v * 5 + seed + u * 2) * v];
  }, (x, y, z, nx, ny, nz, u, v) => {
    const band = Math.abs(u - 0.5) > 0.36 || (v > 0.3 && v < 0.5 && Math.hypot((u - 0.5) * w, (v - 0.4) * len) < w * 0.26);
    return band ? [1.3, 1.3, 1.3] : mul([0.78, 0.78, 0.78], 0.9 + 0.2 * Math.sin(v * 9 + seed));
  });
  f.seg = { e: null, ne: null, bend: 0, up: null };
}
/** a round woven basket standing on the local origin, heaped with `n` pieces of produce in colour c */
function basket(g, r, h, c, seed, n = 9, pr = 0.3) {
  g.surf(K_WOOD, 0.95);
  const wk = rgb(0xb08a4c);
  g.sheet(20, 5, (u, v) => { const a = u * TAU, rr = r * (0.72 + 0.28 * v) + 0.006 * (((Math.round(u * 20) + Math.round(v * 5)) % 2) ? 1 : -1); return [Math.cos(a) * rr, v * h, Math.sin(a) * rr]; },
    (x, y, z, nx, ny, nz, u, v) => mul(wk, ((Math.round(u * 20) + Math.round(v * 5)) % 2 ? 1.05 : 0.62) * (0.85 + 0.3 * hash1(seed, Math.round(v * 5)))), true);
  g.in(M(0, h, 0), () => g.add(new THREE.TorusGeometry(r * 1.0, 0.012, 5, 16).rotateX(Math.PI / 2), mul(wk, 0.8)));
  if (!c) return;
  const rnd = rng(seed * 17 + 3);
  g.surf(K_PLAIN, 0.6);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.62, s = r * pr * (0.85 + 0.3 * rnd());
    g.in(M(Math.cos(a) * d, h * 0.82 + (1 - d / r) * r * 0.36 + rnd() * 0.01, Math.sin(a) * d), () => g.add(new THREE.SphereGeometry(s, 6, 4), mul(c, 0.8 + 0.4 * rnd())));
  }
}
/** an iron strap along local X with studs, lying on the XY plane facing +Z */
function strap(g, L, wd = 0.04, n = 4) {
  g.surf(K_PLAIN, 0.5, 0.85);
  g.cbox(L, wd, 0.012, 0.004, IRON);
  for (let i = 0; i < n; i++) g.in(M(-L / 2 + (L * (i + 0.5)) / n, 0, 0.006), () => g.stud(wd * 0.3, IRON, 5));
}
/** timber-framed wall on the local XY plane from x = -W to W, y0 to y1, facing +Z: plaster panels, sill, plate, posts, rails and braces. items = [{ x, y, w, h, kind: 'win' | 'door', lit, shutters, box }] */
function framed(g, W, y0, y1, plaster, oak, seed, items = [], o = {}) {
  const pl = (x, y, z) => mul(plaster, 0.9 + 0.2 * fbm3(x * 5 + seed, y * 5, z * 5, 2));
  g.surf(K_PLASTER, 0.97);
  g.sheet(Math.max(4, Math.round(W * 8)), 4, (u, v) => { const x = lerp(-W, W, u), y = lerp(y0, y1, v); return [x, y, 0.008 * (noise3(x * 6 + seed, y * 6, 3) - 0.5)]; }, pl);
  g.surf(K_WOOD, 0.88);
  const tb = (s) => woodTint(mul(oak, 0.85 + 0.35 * hash1(seed + s, 3)), seed + s);
  const T = (a, b, w, s, t = 0.075) => g.beamTo([a[0], a[1], 0.02], [b[0], b[1], 0.02], t, w, 0.01, tb(s), 2, [0, 0, 1]);
  const doors = items.filter((it) => it.kind === 'door').sort((a, b) => a.x - b.x);
  let sx = -W;
  for (const d of doors) { if (d.x - d.w / 2 - 0.05 > sx + 0.05) T([sx, y0 + 0.05], [d.x - d.w / 2 - 0.05, y0 + 0.05], 0.1, 1 + d.x); sx = d.x + d.w / 2 + 0.05; }
  if (W > sx + 0.05) T([sx, y0 + 0.05], [W, y0 + 0.05], 0.1, 2);
  T([-W, y1 - 0.05], [W, y1 - 0.05], 0.1, 3, 0.085);
  let posts = [-W + 0.05, W - 0.05];
  for (const it of items) posts.push(it.x - it.w / 2 - 0.05, it.x + it.w / 2 + 0.05);
  posts.sort((a, b) => a - b);
  const isItem = (a, b) => items.find((it) => Math.abs((a + b) / 2 - it.x) < 0.04);
  const all = [];
  for (let i = 0; i < posts.length; i++) {
    all.push(posts[i]);
    if (i < posts.length - 1) { const gap = posts[i + 1] - posts[i]; if (!isItem(posts[i], posts[i + 1]) && gap > 0.8) { const n = Math.round(gap / (o.bay || 0.55)); for (let k = 1; k < n; k++) all.push(posts[i] + (gap * k) / n); } }
  }
  all.sort((a, b) => a - b);
  all.forEach((px, i) => T([px, y0 + (doors.some((d) => Math.abs(Math.abs(px - d.x) - d.w / 2 - 0.05) < 0.01) ? 0 : 0.1)], [px, y1 - 0.1], 0.085, 10 + i));
  const tall = y1 - y0 > 0.95, ym = (y0 + y1) / 2;
  for (let i = 0; i < all.length - 1; i++) {
    const a = all[i], b = all[i + 1], it = isItem(a, b);
    if (it) {
      if (it.kind === 'door') { T([a, y0 + it.h + 0.05], [b, y0 + it.h + 0.05], 0.08, 30 + i); continue; }
      T([a, it.y - it.h / 2 - 0.1], [b, it.y - it.h / 2 - 0.1], 0.07, 30 + i); T([a, it.y + it.h / 2 + 0.07], [b, it.y + it.h / 2 + 0.07], 0.07, 40 + i);
      if (it.y - it.h / 2 - 0.1 - y0 > 0.3) T([(a + b) / 2, y0 + 0.1], [(a + b) / 2, it.y - it.h / 2 - 0.13], 0.06, 50 + i);
      continue;
    }
    if (b - a < 0.22) continue;
    const up = i === 0 ? 1 : i === all.length - 2 ? -1 : hash1(seed, i) > 0.5 ? 1 : -1;
    if (tall) { T([a, ym], [b, ym], 0.075, 60 + i); T([up > 0 ? a : b, ym + 0.04], [up > 0 ? b : a, y1 - 0.1], 0.065, 70 + i, 0.06); T([up > 0 ? b : a, y0 + 0.1], [up > 0 ? a : b, ym - 0.04], 0.065, 80 + i, 0.06); }
    else T([up > 0 ? a : b, y0 + 0.1], [up > 0 ? b : a, y1 - 0.1], 0.065, 70 + i, 0.06);
  }
  for (const it of items) {
    if (it.kind === 'door') { g.in(M(it.x, y0, 0), () => plankDoor(g, it.w, it.h, it.wood || mul(oak, 1.5), seed + 5, 4)); }
    else g.in(M(it.x, it.y, 0), () => casement(g, it.w, it.h, oak, seed + Math.round(it.x * 10), it.shutters !== false, !!it.box, !!it.lit));
    g.surf(K_WOOD, 0.88);
  }
}
/** a wall of upright boards on the local XY plane from x = -W to W, y0 to y1, facing +Z */
function boarded(g, W, y0, y1, wood, seed, bw = 0.15) {
  const n = Math.max(1, Math.round((2 * W) / bw)), w = (2 * W) / n;
  g.surf(K_WOOD, 0.9);
  for (let i = 0; i < n; i++) {
    const top = typeof y1 === 'function' ? y1(-W + w * (i + 0.5)) : y1;
    if (top - y0 < 0.03) continue;
    g.in(M(-W + w * (i + 0.5), (y0 + top) / 2, 0.012, 0, 0, 90), () => g.beam(top - y0, w - 0.008, 0.03, 0.006, woodTint(mul(wood, 0.8 + 0.4 * hash1(seed, i)), seed + i), 2));
  }
}
/** a square stone chimney stack rising from y0 to y1 about the local origin, with pots */
function chimney(g, cw, cd, y0, y1, hex, seed, pots = 2) {
  const cs = stoneStyle(hex, { seed, course: 0.13, len: [0.16, 0.3], r: 0.014, b: 0.012, var: 0.16, cell: 0.12 / qual() });
  g.surf(K_STONE, 0.95);
  for (let f = 0; f < 4; f++) {
    const wide = f % 2 === 0 ? cw : cd, out = f % 2 === 0 ? cd : cw;
    g.in(M(0, y0, 0, 0, f * 90, 0).multiply(M(-(wide - cs.r), 0, out - cs.r)), () => g.ashlar(2 * (wide - cs.r), y1 - y0, { ...cs, seed: seed + f, ends: [CORNER, CORNER, 0, 0] }));
  }
  g.in(M(0, y1 + 0.03, 0), () => g.cbox(2 * cw + 0.09, 0.07, 2 * cd + 0.09, 0.014, stoneTint(mul(cs.pal[0], 1.05), 5)));
  g.surf(K_PLAIN, 0.9);
  for (let i = 0; i < pots; i++) g.in(M(pots > 1 ? (i - (pots - 1) / 2) * cw * 0.95 : 0, y1 + 0.06, 0), () => { g.lathe([[0.06, 0], [0.05, 0.06], [0.044, 0.15], [0.056, 0.17], [0.056, 0.19], [0.036, 0.19]], 10, (x, y) => mul(rgb(0xa4553a), y > 0.12 ? 0.55 : 1)); g.cyl(0.036, 0.036, 0.185, 8, [0.01, 0.01, 0.01], false, true); });
  g.shade(-cw - 0.1, y1 - 0.3, -cd - 0.1, cw + 0.1, y1 + 0.3, cd + 0.1, 0.35, 0.05, [1, 1]);
}
/** a drift of smoke rising from the local origin */
function smoke(g, s = 1, seed = 0, hexA = 0x6f6d68, hexB = 0xb4b2ab) {
  const P = [], rnd = rng(seed + 5);
  for (let i = 0; i < 7; i++) {
    const t = i / 6, x = (0.02 + 0.3 * t * t) * s, y = (0.05 + 0.62 * t) * s, r = (0.045 + 0.07 * Math.sin(t * 2.6)) * s;
    P.push(S.sphere(r).at(x + (rnd() - 0.5) * 0.05 * s, y, (rnd() - 0.5) * 0.09 * s).color(i < 2 ? hexA : hexB).pbr(1).blend(0.012 * s));
    P.push(S.sphere(r * 0.62).at(x + (rnd() - 0.5) * 0.12 * s, y + (rnd() - 0.3) * 0.08 * s, (rnd() - 0.5) * 0.14 * s).color(hexB).pbr(1).blend(0.01 * s));
  }
  g.surf(K_PLAIN, 1);
  g.sculpt({ prims: P }, 30 / s, 0.25);
}

// =====================================================================================================
// A city on levels
// =====================================================================================================
function archReveal(g, A, depth, col, y0 = 0, open = false) {
  const out = [[-A.half, y0]], n = 10;
  for (let k = 0; k <= n; k++) { const x = -A.half + (2 * A.half * k) / n; out.push([x, A.y(x)]); }
  out.push([A.half, y0]);
  g.surf(K_PLAIN, 1);
  for (let k = 0; k < out.length - 1; k++) { const a = out[k], b = out[k + 1]; g.flat([[a[0], a[1], 0.01], [b[0], b[1], 0.01], [b[0], b[1], -depth], [a[0], a[1], -depth]], [mul(col, 0.7), mul(col, 0.7), mul(col, 0.2), mul(col, 0.2)]); }
  const dk = [0.015, 0.013, 0.012];
  if (!open) for (let k = 1; k < out.length - 2; k++) g.flat([[out[k][0], out[k][1], -depth], [out[k + 1][0], out[k + 1][1], -depth], [out[k + 1][0], y0, -depth], [out[k][0], y0, -depth]], dk);
}
/** a small gabled dormer: its face stands on the local XY plane (sill at y = 0, facing +Z), its roof runs back `depth` into the slope behind */
function dormer(g, w, h, pk, depth, pal, wood, seed, lit) {
  const tb = tbOf(wood);
  g.in(M(0, h / 2 + 0.02, 0), () => casement(g, w - 0.14, h - 0.1, wood, seed, false, false, lit));
  g.surf(K_WOOD, 0.88);
  for (const e of [-1, 1]) {
    g.in(M(e * (w / 2 - 0.03), h / 2, 0.01, 0, 0, 90), () => g.beam(h, 0.06, 0.07, 0.01, tb(seed + e, 0.8), 1));
    g.flat([[e * w / 2, -0.02, 0], [e * w / 2, h, 0], [e * w / 2, h, -depth], [e * w / 2, -0.02, -depth * 0.02]], mul(wood, 0.55));
  }
  g.flat([[-w / 2, h, 0.012], [w / 2, h, 0.012], [0, pk, 0.012]], [mul(wood, 0.8), mul(wood, 0.8), mul(wood, 1.0)]);
  g.in(M(0, h, 0.03), () => g.beam(w + 0.04, 0.05, 0.05, 0.008, tb(seed + 3, 0.75), 1));
  g.in(M(0, 0, 0, 0, -90, 0), () => gableRoof(g, { x0: -depth, x1: 0.09, eZ: w / 2 + 0.08, eY: h - 0.03, rY: pk + 0.04, pal, seed: seed + 5, tw: 0.12, th: 0.11, ridgeR: 0.04, ridgeCol: LEAD, barge: mul(wood, 0.9) }));
}
/** a row of turned balusters between rails along local X from x0 to x1, standing on y = 0 and `h` tall */
function balustrade(g, x0, x1, h, col, seed = 0) {
  const c = stoneTint(col, seed, 6), n = Math.max(1, Math.round((x1 - x0) / 0.14));
  g.surf(K_STONE, 0.9);
  g.in(M((x0 + x1) / 2, 0.02, 0), () => g.cbox(x1 - x0, 0.04, 0.1, 0.01, c));
  g.in(M((x0 + x1) / 2, h - 0.025, 0), () => g.cbox(x1 - x0 + 0.02, 0.05, 0.12, 0.014, c));
  for (let i = 0; i < n; i++) g.in(M(x0 + ((i + 0.5) * (x1 - x0)) / n, 0, 0), () => g.lathe([[0.03, 0.04], [0.02, 0.07], [0.04, 0.12], [0.042, 0.15], [0.022, 0.21], [0.018, h - 0.09], [0.03, h - 0.05]], 7, c));
}

// =====================================================================================================
// Landmark kit
// =====================================================================================================
const nq = (n) => Math.max(3, Math.round(n * qual()));   // a segment count scaled with the detail preset
const nqe = (n) => 2 * Math.max(2, Math.round((n * qual()) / 2));   // the same, kept even
const RY = (deg) => M(0, 0, 0, 0, deg, 0);
const geoCache = new Map();
/** a geometry built once per detail preset */
function geoOnce(key, make) { const k = `${key}|${getDetail()}`; if (!geoCache.has(k)) geoCache.set(k, make()); return geoCache.get(k); }
const GOLD = rgb(0xe0aa2e), BRONZE = rgb(0xa8743a), SILVER = rgb(0xc9d2dc), BRASS = rgb(0xb8862e), BONE = rgb(0xd9d0b4), SNOW = [0.9, 0.93, 0.98], ICE = [0.62, 0.8, 0.95];
const FIRE_HOT = [[1.0, 0.55, 0.1], [1.0, 0.32, 0.04], [0.95, 0.14, 0.02]], FIRE_BLOOD = [[1.0, 0.3, 0.08], [0.95, 0.1, 0.03], [0.6, 0.02, 0.02]];
/** big-block masonry: fewer, larger stones than the castle ashlar, so a monument stays inside its budget */
const bigStone = (hex, seed, o = {}) => stoneStyle(hex, { seed, course: 0.25, len: [0.42, 0.78], cell: 0.24 / qual(), tilt: 0.16, ...o });
/** the same with an explicit palette (for stone the stock tints would spoil: obsidian, marble, brick) */
const palStone = (cols, seed, o = {}) => { const c = cols[0]; return stoneStyle(0x808080, { seed, course: 0.25, len: [0.42, 0.78], cell: 0.24 / qual(), tilt: 0.16, pal: cols, mortar: mul(c, 0.35), ...o }); };
const shades = (hex, ks = [1, 1, 0.86, 1.12, 0.74, 0.94, 1.06]) => ks.map((k) => mul(rgb(hex), k));

/**
 * A limb: a round (or squared) section carried along a curve through pts, radii one per point (the same piece as in
 * the faction kit). o: nu, nv, seed, amp (roughness), sq (squareness 0..1), flat [a, b] (section scale), facets,
 * col (rgb or fn(x, y, z, nx, ny, nz, u, v)), capA / capB (close the ends), up (first frame normal).
 */
function limb(g, pts, radii, o = {}) {
  const n = pts.length, nv = o.nv || nq((n - 1) * 5), nu = o.nu || nq(12), seed = o.seed || 0, amp = o.amp || 0, sq = o.sq || 0, fl = o.flat || [1, 1], nf = o.nf || 1.6;
  const curve = n > 2 ? new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5) : null;
  const fr = [], tmp = new THREE.Vector3();
  const at = (t) => { if (curve) { curve.getPoint(clamp(t, 0, 1), tmp); return [tmp.x, tmp.y, tmp.z]; } return [lerp(pts[0][0], pts[1][0], t), lerp(pts[0][1], pts[1][1], t), lerp(pts[0][2], pts[1][2], t)]; };
  const radAt = (t) => { const f = clamp(t, 0, 1) * (n - 1), i = Math.min(n - 2, Math.floor(f)); return lerp(radii[i], radii[i + 1], f - i); };
  let nx = 0, ny = 0, nz = 0, len = 0, prev = null;
  for (let j = 0; j <= nv; j++) {
    const t = j / nv, p = at(t), a = at(t - 0.5 / nv), b = at(t + 0.5 / nv);
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (j === 0) { if (o.up) { nx = o.up[0]; ny = o.up[1]; nz = o.up[2]; } else if (Math.abs(ty) < 0.9) { nx = 0; ny = 1; nz = 0; } else { nx = 1; ny = 0; nz = 0; } }
    const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (prev) len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
    fr.push({ p, t: [tx, ty, tz], n: [nx, ny, nz], b: [ty * nz - tz * ny, tz * nx - tx * nz, tx * ny - ty * nx], r: radAt(t), s: len });
  }
  const pw = 2 + sq * 8, fac = o.facets || 0;
  const point = (u, v) => {
    const f = fr[Math.round(v * nv)], a = u * TAU, co = Math.cos(a), si = Math.sin(a);
    let k = 1;
    if (sq) k = Math.pow(Math.pow(Math.abs(co), pw) + Math.pow(Math.abs(si), pw), -1 / pw);
    if (fac) { const w = TAU / fac, m = ((a % w) + w) % w - w / 2; k *= Math.cos(w / 2) / Math.cos(m); }
    if (amp) {
      const q = f.s * nf;
      k *= 1 + amp * (2 * fbm3(co * nf * 1.3 + seed * 1.7, q, si * nf * 1.3 + seed, 3) - 1) + amp * 0.35 * (Math.abs(Math.sin(a * 3 + seed + q * 2.2)) - 0.6);
    }
    const r = f.r * k;
    return [f.p[0] + (f.n[0] * co * fl[0] + f.b[0] * si * fl[1]) * r, f.p[1] + (f.n[1] * co * fl[0] + f.b[1] * si * fl[1]) * r, f.p[2] + (f.n[2] * co * fl[0] + f.b[2] * si * fl[1]) * r];
  };
  g.sheet(nu, nv, point, o.col || [0.5, 0.5, 0.5], true);
  for (const [on, j, s] of [[o.capA, 0, -1], [o.capB, nv, 1]]) {
    if (!on || fr[j].r <= 0) continue;
    const f = fr[j], cc = typeof o.col === 'function' ? o.col(f.p[0], f.p[1], f.p[2], f.t[0] * s, f.t[1] * s, f.t[2] * s, 0, j / nv) : o.col || [0.5, 0.5, 0.5];
    const ce = g.v(f.p[0], f.p[1], f.p[2], f.t[0] * s, f.t[1] * s, f.t[2] * s, on === true ? cc : on);
    let pa = -1;
    for (let k = 0; k <= nu; k++) { const p = point(k / nu, j / nv), q = g.v(p[0], p[1], p[2], f.t[0] * s, f.t[1] * s, f.t[2] * s, on === true ? cc : on); if (k) g.tri(ce, pa, q); pa = q; }
  }
}
/** layered rock: beds, cracks and lichen (moss = how green its upward faces go) */
const rockCol = (col, seed = 0, moss = 0, beds = 5) => (x, y, z, nx, ny) => {
  const bed = (y + 0.13 * noise3(x * 1.3 + seed, 0.5, z * 1.3)) * beds, band = hash1(Math.floor(bed), seed | 0);
  const crack = smooth(0.42, 0.5, 1 - Math.abs(noise3(x * 2.7 + seed * 2, y * 2.7, z * 2.7) - 0.5) * 2);
  let c = mul(col, (0.76 + 0.36 * band) * (0.82 + 0.34 * fbm3(x * 3.6, y * 3.6, z * 3.6 + seed, 2)) * (1 - 0.5 * crack) * (0.78 + 0.22 * smooth(-0.4, 0.6, ny)));
  if (moss && ny > 0.25) c = mix(c, [0.13, 0.2, 0.055], moss * smooth(0.4, 0.62, noise3(x * 2.1 + 9, y * 2, z * 2.1 + seed)) * smooth(0.25, 0.7, ny));
  return c;
};
const barkCol = (col, seed = 0) => (x, y, z) => mul(col, (0.6 + 0.7 * noise3(x * 9 + seed, y * 1.5, z * 9)) * (0.8 + 0.4 * noise3(x * 2 + seed, y * 2, z * 2)));
/** points along a smooth curve through pts */
function curvePts(pts, n) { const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5), out = []; for (let i = 0; i <= n; i++) { const p = c.getPoint(i / n); out.push([p.x, p.y, p.z]); } return out; }
/** run fn(s, W, D) in the frame of each face of a box hx x hz: origin at the middle of the face's foot, x along it, +Z out (0: +Z, 1: +X, 2: -Z, 3: -X) */
function faces4(g, hx, hz, fn, only = null) { for (let s = 0; s < 4; s++) { if (only && !only.includes(s)) continue; const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz; g.in(RY(s * 90).multiply(M(0, 0, D)), () => fn(s, W, D)); } }
/** four coursed faces round a box in any finish (stoneBox is always weathering stone); holes[s] as stoneBox */
function blockBox(g, hx, hz, y0, y1, st, seed, o = {}) {
  const r = st.r, kind = o.kind ?? K_STONE, rough = o.rough ?? 0.93, metal = o.metal || 0;
  faces4(g, hx, hz, (s, W) => {
    g.surf(kind, rough, metal);
    g.in(M(-(W - r), y0, -r), () => { g.ashlar(2 * (W - r), y1 - y0, { ...st, seed: seed + s * 7, ends: [CORNER, CORNER, 0, 0], quoin: o.quoin, holes: o.holes ? o.holes[s] : null }); if (o.each) o.each(s, W); });
    if (y0 < 0.02) { const k = g.kind; footing(g, -W, W, st.pal[0], 0); g.kind = k; }
  }, o.only);
  if (o.top !== false) { g.surf(kind, rough, metal); slab(g, hx - 0.01, hz - 0.01, y1 - 0.004, o.topCol || mul(st.pal[0], 0.9), seed); }
}
/** a flat paved top: joints drawn in the colour */
function slab(g, hx, hz, y, col, seed = 0, cell = 0.5) {
  const nx = Math.max(1, Math.round((2 * hx) / cell)), nz = Math.max(1, Math.round((2 * hz) / cell));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x0 = -hx + (2 * hx * i) / nx, x1 = x0 + (2 * hx) / nx, z0 = -hz + (2 * hz * j) / nz, z1 = z0 + (2 * hz) / nz, c = mul(col, 0.84 + 0.3 * hash1(i + seed, j, 5)), e = 0.012, d = mul(c, 0.55);
    g.flat([[x0 + e, y, z0 + e], [x0 + e, y, z1 - e], [x1 - e, y, z1 - e], [x1 - e, y, z0 + e]], c);
    g.flat([[x0, y - 0.006, z0], [x0, y - 0.006, z1], [x0 + e, y, z1 - e], [x0 + e, y, z0 + e]], d); g.flat([[x1, y - 0.006, z0], [x1, y - 0.006, z1], [x1 - e, y, z1 - e], [x1 - e, y, z0 + e]], d);
    g.flat([[x0, y - 0.006, z0], [x1, y - 0.006, z0], [x1 - e, y, z0 + e], [x0 + e, y, z0 + e]], d); g.flat([[x0, y - 0.006, z1], [x1, y - 0.006, z1], [x1 - e, y, z1 - e], [x0 + e, y, z1 - e]], d);
  }
}
/** a round coursed wall about the local Y axis */
function drum(g, R, y0, H, st, seed, o = {}) {
  const r = st.r;
  g.surf(o.kind ?? K_STONE, o.rough ?? 0.93, o.metal || 0);
  g.in(M(0, y0, 0), () => g.bend(R - r, () => { g.ashlar((R - r) * TAU, H, { ...st, seed, wrap: true, holes: o.holes || null }); if (o.each) o.each((R - r) * TAU); }));
}
/** a flight of steps w wide climbing from (z0, y0) at its foot to (z1, y1) at its head (running along local Z) */
function flight(g, w, z0, y0, z1, y1, n, col, seed = 0, deep = 0.4) {
  const dz = (z1 - z0) / n, dy = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const top = y0 + (i + 1) * dy, hgt = Math.min(top, dy + deep);
    g.in(M(0, top - hgt / 2, z0 + (i + 0.5) * dz), () => g.cbox(w, hgt, Math.abs(dz) + 0.006, 0.012, typeof col === 'function' ? col : mul(col, 0.88 + 0.22 * hash1(i, seed))));
  }
}
/** a solid wedge between x0 and x1 whose top runs from (z0, y0) to (z1, y1) and whose sides go down to yb: stair cheeks, ramps */
function wedge(g, x0, x1, z0, y0, z1, y1, yb, col, dark = 0.7) {
  const c2 = mul(col, dark);
  g.flat([[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]], col);
  for (const x of [x0, x1]) g.flat([[x, yb, z0], [x, y0, z0], [x, y1, z1], [x, yb, z1]], [c2, col, col, c2]);
  g.flat([[x0, yb, z0], [x1, yb, z0], [x1, y0, z0], [x0, y0, z0]], [c2, c2, col, col]);
  g.flat([[x0, yb, z1], [x1, yb, z1], [x1, y1, z1], [x0, y1, z1]], [c2, c2, col, col]);
}
/** a tongue of flame standing on the local origin, s high */
function fire(g, s, cols = FIRE_HOT, seed = 0, glow = 1.4) {
  g.surf(K_PLAIN, 1, 0, glow);
  const fl = (x, y) => (y > s * 0.62 ? cols[2] : y > s * 0.28 ? cols[1] : cols[0]);
  g.lathe([[0.13, 0], [0.2, 0.16], [0.16, 0.38], [0.08, 0.62], [0.03, 0.84], [0, 1]].map(([r, y]) => [r * s, y * s]), nq(8), fl);
  for (let i = 0; i < 3; i++) { const a = seed + i * 2.2; g.in(M(Math.cos(a) * 0.1 * s, 0, Math.sin(a) * 0.1 * s, 12 * Math.cos(a + 1), a * 57, 12 * Math.sin(a)), () => g.lathe([[0.09, 0], [0.12, 0.14], [0.06, 0.4], [0, 0.62 + 0.1 * i]].map(([r, y]) => [r * s, y * s]), nq(6), fl)); }
}
/** a fire bowl on three legs standing on the local origin, s high to its rim */
function brazier(g, s, cols = FIRE_HOT, metal = IRON, seed = 0) {
  g.surf(K_PLAIN, 0.5, 0.85);
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.4; g.tube([[Math.cos(a) * 0.3 * s, 0, Math.sin(a) * 0.3 * s], [Math.cos(a) * 0.1 * s, 0.45 * s, Math.sin(a) * 0.1 * s], [Math.cos(a) * 0.22 * s, 0.82 * s, Math.sin(a) * 0.22 * s]], 0.03 * s, 5, metal); }
  g.lathe([[0.04, 0.62], [0.2, 0.68], [0.3, 0.82], [0.33, 1], [0.36, 1.02], [0.36, 1.06], [0.3, 1.06], [0.27, 0.9], [0, 0.84]].map(([r, y]) => [r * s, y * s]), nq(14), metal);
  g.surf(K_PLAIN, 1, 0, 1.1);
  g.in(M(0, 0.93 * s, 0), () => g.add(new THREE.SphereGeometry(0.27 * s, nq(10), 5, 0, TAU, 0, 1.4).scale(1, 0.45, 1), (x, y, z) => mix(mul(cols[2], 0.35), cols[0], smooth(0.4, 0.7, noise3(x * 30 + seed, y * 30, z * 30)))));
  g.in(M(0, 0.98 * s, 0), () => fire(g, 0.75 * s, cols, seed));
}
/** chain hanging through pts: links s across, every other one turned */
function chain(g, pts, s = 0.045, col = IRON, metal = 0.85) {
  g.surf(K_PLAIN, 0.5, metal);
  let acc = 0, i = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const f = along(pts[k], pts[k + 1]), step = s * 1.45;
    let x = -f.L / 2 + acc;
    for (; x <= f.L / 2; x += step, i++) g.in(f.m.clone().multiply(M(x, 0, 0, i % 2 ? 90 : 0, 0, 0)), () => g.add(new THREE.TorusGeometry(s * 0.5, s * 0.15, 4, nq(8)).scale(1.35, 1, 1), col));
    acc = x - f.L / 2;
  }
}
/** a chain sagging between two points */
function swag(g, a, b, sag, s = 0.045, col = IRON, n = 8) { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t)]); } chain(g, pts, s, col); }
/** a cut gem standing point-down on the local origin, h tall: crisp facets lit from within */
function gem(g, r, h, deep, bright, glow = 1.2, m = 6, seed = 0) {
  const keep = [g.rough, g.metal, g.glow, g.kind];
  g.kind = K_PLAIN; g.rough = 0.12; g.metal = 0.1;
  const A = [], B = [], y1 = h * 0.3, y2 = h * 0.7;
  for (let i = 0; i < m; i++) { const a = (i / m) * TAU + seed; A.push([Math.cos(a) * r, y1, Math.sin(a) * r]); B.push([Math.cos(a) * r * 0.86, y2, Math.sin(a) * r * 0.86]); }
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m, k = 0.7 + 0.6 * hash1(i, Math.round(seed * 7) + 3), lo = mul(mix(deep, bright, 0.35), k), hi = mul(bright, k), dp = mul(deep, k);
    g.glow = glow * k;
    g.flat([[0, 0, 0], A[j], A[i]], [hi, lo, lo]); g.flat([A[i], A[j], B[j], B[i]], [lo, lo, dp, dp]); g.flat([B[i], B[j], [0, h, 0]], [dp, dp, hi]);
  }
  [g.rough, g.metal, g.glow, g.kind] = keep;
}
const ball = (g, r, c, ws = 10, hs = 7) => g.add(new THREE.SphereGeometry(r, nq(ws), nq(hs)), c);
/** tiny lights hanging in the air: fireflies, sparks, motes */
function motes(g, pts, r, col, glow = 1.6) { g.surf(K_PLAIN, 1, 0, glow); for (const p of pts) g.in(M(p[0], p[1], p[2]), () => g.add(new THREE.OctahedronGeometry(r * (p[3] || 1), 1), col)); }
/** a cloth banner hanging from a bar in fixed colours: local origin at the middle of the bar, cloth facing +Z */
function hangBanner(g, w, len, c1, c2, seed = 0) {
  g.surf(K_WOOD, 0.8);
  g.in(M(-w / 2 - 0.05, 0, 0.012, 0, 0, -90), () => g.cyl(0.016, 0.016, w + 0.1, 6, woodTint(rgb(0x4a3524), seed), true, true));
  g.surf(K_PLAIN, 0.4, 0.9);
  for (const e of [-1, 1]) g.in(M(e * (w / 2 + 0.05), 0, 0.012), () => g.add(new THREE.SphereGeometry(0.026, 8, 6), GOLD));
  g.surf(K_CLOTH, 0.9);
  g.sheet(8, 14, (u, v) => {
    const tail = v > 0.82 ? (v - 0.82) / 0.18 : 0, cut = tail * (1 - Math.abs(u - 0.5) * 2) * len * 0.16;
    return [(u - 0.5) * w * (1 - 0.06 * v), -v * len + cut, 0.014 + 0.03 * Math.sin(v * 5 + seed + u * 2) * v];
  }, (x, y, z, nx, ny, nz, u, v) => {
    const band = Math.abs(u - 0.5) > 0.34 || (v > 0.28 && v < 0.52 && Math.hypot((u - 0.5) * w, (v - 0.4) * len) < w * 0.27);
    return band ? c2 : mul(c1, 0.9 + 0.2 * Math.sin(v * 9 + seed));
  });
}
/** a pennant in fixed colours flying toward +X from a pole standing on the local origin */
function flagPole(g, h, len, hgt, c1, c2, pole = rgb(0x5a4028)) {
  g.surf(K_WOOD, 0.8); g.cyl(0.022, 0.016, h, 8, pole, false, true);
  g.surf(K_CLOTH, 0.9);
  g.sheet(12, 4, (u, v) => { const fork = u > 0.7 ? (u - 0.7) / 0.3 : 0, w = hgt * (1 - 0.25 * u), y = (v - 0.5) * w, cut = fork * (1 - Math.abs(v - 0.5) * 2) * len * 0.3; return [0.02 + u * len - cut, h - 0.05 - hgt * 0.5 + y - u * u * 0.05, Math.sin(u * 7 + v) * 0.035 * u]; }, (x, y, z, nx, ny, nz, u, v) => (Math.abs(v - 0.5) < 0.17 ? c2 : c1));
}
/** a glyph of straight strokes on the local XY plane, about s high, facing +Z; glow 0 gives a carved (dark) mark */
function rune(g, seed, s, col, glow = 1.3, wd = 0.1) {
  const rnd = rng(seed * 577 + 11), keep = [g.rough, g.metal, g.glow, g.kind];
  g.surf(K_PLAIN, 0.5, 0, glow);
  const P = (i) => [((i % 3) - 1) * 0.28 * s, (Math.floor(i / 3) - 1.5) * 0.3 * s, 0.004];
  const strokes = [[1, 10]], n = 2 + Math.floor(rnd() * 2);
  for (let k = 0; k < n; k++) { const a = [1, 4, 7, 10][Math.floor(rnd() * 4)], side = rnd() < 0.5 ? -1 : 1, dy = [-3, 0, 3][Math.floor(rnd() * 3)]; const b = clamp(a + side + dy, 0, 11); if ((b % 3) !== 1) strokes.push([a, b]); }
  for (const [a, b] of strokes) g.beamTo(P(a), P(b), 0.008, wd * s, 0.002, col, 1, [0, 0, 1]);
  [g.rough, g.metal, g.glow, g.kind] = keep;
}
/** a slim pinnacle standing on the local origin: square shaft, pyramid, ball */
function pinnacle(g, w, h, c, tip = GOLD) {
  g.in(M(0, h * 0.2, 0), () => g.cbox(w, h * 0.4, w, w * 0.08, c));
  g.in(M(0, h * 0.42, 0), () => g.cbox(w * 1.25, h * 0.05, w * 1.25, w * 0.06, c));
  g.in(M(0, h * 0.44, 0), () => g.lathe([[w * 0.66, 0], [0.012, h * 0.5]], 4, c, Math.PI / 4, TAU + Math.PI / 4));
  const k = [g.kind, g.rough, g.metal]; g.surf(K_PLAIN, 0.35, 0.9);
  g.in(M(0, h * 0.95, 0), () => g.add(new THREE.SphereGeometry(w * 0.16, 6, 5), tip));
  [g.kind, g.rough, g.metal] = k;
}
/** a turned spear-point finial (neutral: ball, collar, leaf blade) standing on the local origin, s tall */
function spear(g, s, col = GOLD) {
  g.surf(K_PLAIN, 0.3, 0.92);
  g.lathe([[0.1, 0], [0.06, 0.06], [0.03, 0.1], [0.11, 0.2], [0.13, 0.27], [0.1, 0.34], [0.03, 0.4], [0.025, 0.55], [0.06, 0.58], [0.025, 0.61]].map(([r, y]) => [r * s, y * s]), nq(10), col);
  g.in(M(0, 0.6 * s, 0), () => g.lathe([[0.02, 0], [0.085, 0.12], [0.06, 0.24], [0, 0.4]].map(([r, y]) => [r * s, y * s]), 4, col));
}
/**
 * An onion dome standing on the local origin: R at its widest, H tall. It is laid as na x nv patches so a pattern
 * stays crisp: col(i, j) -> rgb for each. o: twist (turns of swirl over the height), su / sv (quads per patch), neck.
 */
function onion(g, R, H, na, nv, col, o = {}) {
  const tw = (o.twist || 0) * TAU, su = o.su || nq(2), sv = o.sv || Math.max(1, nq(18 / nv)), neck = o.neck ?? 0.6;
  const cur = new THREE.SplineCurve([[neck, 0], [0.82, 0.1], [1, 0.27], [0.9, 0.44], [0.6, 0.6], [0.3, 0.75], [0.12, 0.88], [0.02, 1]].map(([r, y]) => new THREE.Vector2(r, y)));
  const P = (a, t) => { const p = cur.getPoint(clamp(t, 0, 1)), an = a + tw * t; return [Math.cos(an) * p.x * R, p.y * H, Math.sin(an) * p.x * R]; };
  g.surf(o.kind ?? K_PLAIN, o.rough ?? 0.4, o.metal ?? 0.25);
  for (let i = 0; i < na; i++) for (let j = 0; j < nv; j++) {
    const c = col(i, j);
    g.sheet(su, sv, (u, v) => P(((i + u) / na) * TAU, (j + v) / nv), typeof c === 'function' ? c : (x, y, z) => mul(c, 0.9 + 0.2 * noise3(x * 6, y * 6, z * 6)));
  }
}
/**
 * A curved, upturned roof of glazed tiles on a square: eaves at half size E on the local y = 0, running up H to half
 * size I (0 = to a point). o: up (how far the corners lift), ridge (hip colour), tw / th (tile size), soffit (colour).
 */
function eaveRoof(g, E, I, H, pal, seed, o = {}) {
  const q = Math.min(1, qual()), up = o.up ?? 0.2, rows = Math.max(3, Math.round((Math.hypot(E - I, H) / (o.th || 0.14)) * q)), tw = (o.tw || 0.14) / q, pw = o.pow || 1.7;
  const at4 = (s) => { const c = Math.cos(s * Math.PI / 2), si = Math.sin(s * Math.PI / 2); return (u, v) => { const k = Math.min(v, 0.995), hw = lerp(E, I, k), t = u * 2 - 1, x = t * hw, y = H * Math.pow(Math.max(0, k), pw) + (k < 0 ? k * H * 0.3 : 0) + up * Math.pow(Math.abs(t), 3) * (1 - k) * (1 - k); return [x * c + hw * si, y, -x * si + hw * c]; }; };
  for (let s = 0; s < 4; s++) {
    g.surf(K_ROOF, o.rough ?? 0.42, 0.1);
    tiles(g, rows, (j) => Math.max(2, (2 * lerp(E, I, (j + 0.5) / rows)) / tw), at4(s), { pal, lift: 0.022, seed: seed + s, round: true, gap: 0.12 });
    const f = at4(s), rc = o.ridge || mul(pal[0], 0.7);
    // the hip, turning up into a horn at the corner; a rolled edge along the eave
    const hip = []; for (let k = 0; k <= 8; k++) { const p = f(1, k / 8); hip.push([p[0], p[1] + 0.03, p[2]]); }
    const c0 = f(1, 0), dx = Math.sign(c0[0]), dz = Math.sign(c0[2]);
    hip.unshift([c0[0] + dx * 0.08, c0[1] + 0.1, c0[2] + dz * 0.08]); hip.unshift([c0[0] + dx * 0.13, c0[1] + 0.22, c0[2] + dz * 0.13]);
    g.surf(K_PLAIN, 0.4, o.ridgeMetal ?? 0.3);
    g.tube(hip, hip.map((_, k) => (k === 0 ? 0.012 : k === 1 ? 0.03 : 0.045)), 6, rc, true);
    const ev = []; for (let k = 0; k <= 10; k++) { const p = f(k / 10, 0); ev.push([p[0], p[1] + 0.005, p[2]]); }
    g.tube(ev, 0.028, 5, o.eave || rc, false);
  }
  g.surf(K_WOOD, 0.9);
  g.flat([[-E, -0.012, -E], [E, -0.012, -E], [E, -0.012, E], [-E, -0.012, E]], o.soffit || [0.16, 0.035, 0.03]);
}
/** a toothed wheel lying on the local XY plane (axis Z), centred on the origin */
function gear(g, R, t, teeth, col, spokes = 6) {
  const rim = R * 0.86, tw = (TAU * R) / teeth * 0.5;
  g.in(M(0, 0, -t / 2, 90, 0, 0), () => { g.lathe([[rim * 0.76, 0], [rim, 0], [rim, t], [rim * 0.76, t], [rim * 0.76, 0]], nq(28), col); g.in(M(0, -t * 0.2, 0), () => g.cyl(R * 0.2, R * 0.2, t * 1.4, nq(12), col, true, true)); g.in(M(0, -t * 0.35, 0), () => g.cyl(R * 0.08, R * 0.08, t * 1.7, 8, mul(col, 0.5), true, true)); });
  for (let i = 0; i < teeth; i++) g.in(M(0, 0, 0, 0, 0, (i * 360) / teeth), () => g.in(M(R * 0.92, 0, 0), () => g.cbox(R * 0.2, tw, t, tw * 0.18, col)));
  for (let i = 0; i < spokes; i++) g.in(M(0, 0, 0, 0, 0, (i * 360) / spokes + 15), () => g.in(M(rim * 0.48, 0, 0), () => g.cbox(rim * 0.62, R * 0.11, t * 0.6, 0.01, mul(col, 0.9))));
}
/** a pipe through points with a collar at each end */
function pipe(g, pts, r, col, n = 0) {
  const P = n ? curvePts(pts, n) : pts;
  g.surf(K_PLAIN, 0.35, 0.9);
  g.tube(P, r, nq(8), (x, y, z) => mul(col, 0.85 + 0.3 * noise3(x * 7, y * 7, z * 7)), true);
  for (const [a, b] of [[P[0], P[1]], [P[P.length - 1], P[P.length - 2]]]) { const f = along(a, [lerp(a[0], b[0], 0.2), lerp(a[1], b[1], 0.2), lerp(a[2], b[2], 0.2)]); g.in(f.m.clone().multiply(M(0, 0, 0, 0, 0, -90)), () => g.cyl(r * 1.45, r * 1.45, r * 0.7, nq(8), mul(col, 0.8), true, true)); }
}
/** hanging ice along local X from x0 to x1 (the eave line is y = 0) */
function icicles(g, x0, x1, n, len, seed = 0) {
  const rnd = rng(seed * 7 + 3);
  g.surf(K_PLAIN, 0.15, 0.1);
  for (let i = 0; i < n; i++) { const x = lerp(x0, x1, (i + rnd()) / n), l = len * (0.35 + 0.9 * rnd()), r = 0.012 + l * 0.07; g.in(M(x, 0, (rnd() - 0.5) * 0.02, 180, 0, 0), () => g.cyl(r, 0, l, 5, (px, py) => mix(SNOW, ICE, clamp(py / l, 0, 1)), false, false)); }
}
/** a pillow of snow lying on the local origin: 2rx x 2rz, h deep */
function snow(g, rx, rz, h, seed = 0) {
  g.surf(K_PLAIN, 0.85);
  g.sheet(nq(12), nq(4), (u, v) => { const a = u * TAU, d = 1 - v, k = Math.pow(Math.pow(Math.abs(Math.cos(a)), 4) + Math.pow(Math.abs(Math.sin(a)), 4), -0.25); return [Math.cos(a) * rx * d * k, h * (1 - d * d * d) * (0.75 + 0.5 * noise3(Math.cos(a) * d * 2 + seed, 1, Math.sin(a) * d * 2)) - (v === 0 ? 0.01 : 0), Math.sin(a) * rz * d * k]; }, (x, y, z) => mul(SNOW, 0.9 + 0.14 * noise3(x * 5 + seed, y * 9, z * 5)), true);
}
/** a human skull about 0.24 high, sculpted once: jaw toward +Z, resting on y = 0 */
function skull(g, s = 1) {
  const geo = geoOnce('skull', () => {
    const c = 0xd9d0b4, d = 0x1a1612, P = [];
    P.push(S.ellipsoid(0.085, 0.082, 0.1).at(0, 0.155, -0.01).color(c).tint(0.14, 30));
    P.push(S.box(0.105, 0.075, 0.07, 0.03).at(0, 0.085, 0.055).color(c).blend(0.03));
    P.push(S.box(0.085, 0.045, 0.06, 0.018).at(0, 0.03, 0.05).color(0xc8bc9c).blend(0.012));
    P.push(...S.mirrorX([S.ellipsoid(0.027, 0.026, 0.03).at(0.036, 0.112, 0.088).color(d).cut(0.008)]));
    P.push(S.cone(0.016, 0.004, 0.04, 0.004).at(0, 0.078, 0.095).color(d).cut(0.005));
    return buildPartGeometry({ prims: P }, { res: 44 * qual(), ao: 0.8 });
  });
  const k = [g.kind, g.rough, g.metal, g.glow]; g.surf(K_PLAIN, 0.75);
  if (geo) g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(geo));
  [g.kind, g.rough, g.metal, g.glow] = k;
}
/** a candle standing on the local origin with a lit flame */
function candle(g, h, r = 0.018) {
  g.surf(K_PLAIN, 0.6); g.cyl(r, r * 0.9, h, 6, [0.85, 0.8, 0.62], false, true);
  g.surf(K_PLAIN, 1, 0, 1.8); g.in(M(0, h, 0), () => g.lathe([[0.004, 0], [r * 0.8, r * 1.2], [0, r * 4]], 5, [1.0, 0.55, 0.12]));
}
/** a paper lantern hanging from the local origin: s is its height */
function paperLantern(g, s, col, glow = 1.3, seed = 0) {
  g.surf(K_PLAIN, 0.4, 0.85);
  g.in(M(0, -0.12 * s, 0), () => g.cyl(0.006, 0.006, 0.12 * s, 4, IRON));
  for (const y of [-0.16, -1.0]) g.in(M(0, y * s, 0), () => g.cyl(0.16 * s, 0.16 * s, 0.05 * s, nq(10), GOLD, true, true));
  g.surf(K_PLAIN, 0.8, 0, glow);
  g.in(M(0, -0.96 * s, 0), () => g.lathe([[0.16, 0], [0.3, 0.14], [0.37, 0.4], [0.3, 0.68], [0.16, 0.82]].map(([r, y]) => [r * s, y * s]), nq(12), (x, y, z) => mul(col, (0.7 + 0.5 * smooth(0.1, 0.5, y / s) * smooth(0.82, 0.5, y / s)) * (Math.abs(Math.sin(Math.atan2(z, x) * 6 + seed)) > 0.25 ? 1 : 0.6))));
  g.surf(K_CLOTH, 0.9);
  g.in(M(0, -1.22 * s, 0), () => g.cyl(0.02 * s, 0.04 * s, 0.22 * s, 5, mul(col, 0.5), true, false));
}
/** a stout dressed-stone or timber post with a cap */
function post(g, w, h, c) { g.in(M(0, h / 2, 0), () => g.cbox(w, h, w, w * 0.1, c)); g.in(M(0, h + w * 0.12, 0), () => g.cbox(w * 1.3, w * 0.24, w * 1.3, w * 0.08, c)); }
/** a builder table entry: natural footprint nw x nd (front toward +Z); a placement with the sides swapped gets the quarter-turned copy */
const landmark = (id, nw, nd, make) => (def, w, h, place) => struct(id, nw !== nd && +w === nd && +h === nw, place && typeof place === 'object' ? place : null, make);

/** a coursed wall face from plan point a to b ([x, z], left to right as seen from outside) between y0 and y1. o: holes (measured from a and y0), ends, each(L) run in the face's frame */
function wall(g, a, b, y0, y1, st, seed, o = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), th = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) / DEG;
  g.in(M(a[0], y0, a[1], 0, th, 0), () => {
    g.surf(o.kind ?? K_STONE, o.rough ?? 0.93, o.metal || 0);
    g.ashlar(L, y1 - y0, { ...st, seed, ends: o.ends || [CORNER, CORNER, 0, 0], holes: o.holes || null, quoin: o.quoin });
    if (y0 < 0.02) { const k = g.kind; footing(g, 0, L, st.pal[0], 0); g.kind = k; }
    if (o.each) o.each(L);
  });
}
/** a flying buttress in the local YZ plane: from the pier head a up to the wall at b, an arch underneath */
function flyer(g, a, b, col, t = 0.14, n = 8) {
  const top = [], bot = [], c2 = mul(col, 0.72);
  for (let i = 0; i <= n; i++) { const k = i / n, z = lerp(a[2], b[2], k), y = lerp(a[1], b[1], k); top.push([z, y + 0.1]); bot.push([z, y - 0.12 - 0.55 * (1 - k) * (1 - k)]); }
  for (let i = 0; i < n; i++) {
    for (const x of [-t / 2, t / 2]) g.flat([[x, bot[i][1], bot[i][0]], [x, bot[i + 1][1], bot[i + 1][0]], [x, top[i + 1][1], top[i + 1][0]], [x, top[i][1], top[i][0]]], [c2, c2, col, col]);
    g.flat([[-t / 2 - 0.02, top[i][1], top[i][0]], [t / 2 + 0.02, top[i][1], top[i][0]], [t / 2 + 0.02, top[i + 1][1], top[i + 1][0]], [-t / 2 - 0.02, top[i + 1][1], top[i + 1][0]]], mul(col, 1.08));
    g.flat([[-t / 2, bot[i][1], bot[i][0]], [t / 2, bot[i][1], bot[i][0]], [t / 2, bot[i + 1][1], bot[i + 1][0]], [-t / 2, bot[i + 1][1], bot[i + 1][0]]], mul(col, 0.55));
  }
}
const ROYAL = rgb(0x2446a8);

// ---------------------------------------------------------------------------------------------------
// Graal: Gothic cathedral, 4 x 6. Modelled along X (west front at +X) and stood with its front to +Z.
// ---------------------------------------------------------------------------------------------------
function graalCathedral(g) {
  const st = bigStone(0xe2ddd0, 100, { var: 0.07, chip: 0.06 }), r = st.r, col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 5), ca = mul(col, 1.05), frame = mul(col, 1.02);
  const GL = { frame, glow: 1.0, nx: 3 };
  const nx0 = -2.2, nx1 = 1.86, nhz = 0.75, ahz = 1.35, aH = 1.75, nH = 4.25, rY = 5.4, tx = 2.4, tz = 1.3, th = 0.55, tH = 6.0;
  const bays = [-1.7, -0.75, 0.2, 1.15], piers = [-2.14, -1.225, -0.275, 0.675, 1.6], L = nx1 - nx0;
  g.in(RY(-90), () => {
    for (const e of [1, -1]) {
      const U = (x) => (e > 0 ? x - nx0 : nx1 - x), A = e > 0 ? [nx0, e * ahz] : [nx1, e * ahz], B = e > 0 ? [nx1, e * ahz] : [nx0, e * ahz];
      // aisle: a lancet in every bay
      wall(g, A, B, 0, aH, st, 110 + e, { holes: bays.map((x) => [U(x) - 0.17, 0.5, U(x) + 0.17, 1.5]), each: () => {
        bays.forEach((x, i) => g.in(M(U(x), 0.5, 0), () => glassWindow(g, 0.34, 1.0, 120 + i + e * 5, GL)));
        g.surf(K_STONE, 0.93); g.in(M(L / 2, 0, 0), () => band(g, [[0.05, 0.3], [0.05, 0.36], [0, 0.42]], L, ca, 125 + e));
      } });
      // clerestory: tall windows between the flyers
      wall(g, [A[0], e * nhz], [B[0], e * nhz], 2.25, nH, st, 130 + e, { holes: bays.map((x) => [U(x) - 0.21, 0.25, U(x) + 0.21, 1.75]), each: () => {
        bays.forEach((x, i) => g.in(M(U(x), 0.25, 0), () => glassWindow(g, 0.42, 1.5, 140 + i + e * 5, GL)));
        g.surf(K_STONE, 0.93); g.in(M(L / 2, nH - 2.25, 0), () => band(g, [[0, -0.1], [0.06, -0.06], [0.07, 0], [0, 0.02]], L, ca, 150 + e));
      } });
      gableRoof(g, { x0: nx0, x1: nx1, zc: e * nhz, eZ: ahz - nhz + 0.08, eY: aH - 0.02, rY: 2.3, pal: BLUE_SLATE, seed: 160 + e, only: e, ridge: false, tw: 0.18, th: 0.16 });
      g.surf(K_STONE, 0.93);
      g.flat([[nx0 - 0.005, aH, e * ahz], [nx0 - 0.005, aH, e * nhz], [nx0 - 0.005, 2.3, e * nhz]], mul(col, 0.9));
      // piers, pinnacles and flyers
      for (const x of piers) g.in(M(x, 0, e * ahz, 0, e > 0 ? 0 : 180, 0), () => {
        buttress(g, 0.3, 0.52, 2.75, st, 170 + Math.round(x * 7) + e, 0.25);
        g.surf(K_STONE, 0.93);
        g.in(M(0, 2.95, 0.22), () => pinnacle(g, 0.2, 1.15, ca));
        flyer(g, [0, 2.7, 0.36], [0, 3.8, -(ahz - nhz) + 0.02], ca);
        g.in(M(0, 3.86, -(ahz - nhz) + 0.05), () => g.cbox(0.2, 0.5, 0.1, 0.02, cc));
      });
    }
    // east end: aisle ends, the nave gable, and the apse with its ring of lancets
    for (const e of [-1, 1]) wall(g, e < 0 ? [nx0, -ahz] : [nx0, nhz], e < 0 ? [nx0, -nhz] : [nx0, ahz], 0, aH, st, 180 + e);
    wall(g, [nx0, -nhz], [nx0, nhz], 3.25, nH, st, 185, { each: () => { g.in(M(0, nH - 3.25, 0), () => { g.surf(K_STONE, 0.93); gableStone(g, nhz, rY - 0.1 - nH, st, 186); }); } });
    const aR = nhz, aL = Math.PI * (aR - r);
    g.in(M(nx0, 0, 0, 0, -90, 0), () => {
      g.surf(K_STONE, 0.93);
      g.bend(aR - r, () => g.in(M(-aL / 2, 0, 0), () => {
        const us = [0.17, 0.5, 0.83].map((k) => k * aL);
        g.ashlar(aL, 3.25, { ...st, seed: 190, ends: [CUT, CUT, 0, 0], holes: us.map((u) => [u - 0.17, 0.75, u + 0.17, 2.5]) });
        us.forEach((u, i) => g.in(M(u, 0.75, 0), () => glassWindow(g, 0.34, 1.75, 195 + i, GL)));
        g.surf(K_STONE, 0.93);
        for (const k of [0.335, 0.665]) g.in(M(k * aL, 0, 0), () => { g.in(M(0, 1.5, 0.08), () => g.cbox(0.2, 3.0, 0.2, 0.02, cc)); g.in(M(0, 3.0, 0.08), () => pinnacle(g, 0.16, 0.8, ca)); });
      }));
      g.in(M(0, 3.22, 0), () => {
        g.surf(K_ROOF, 0.8);
        tiles(g, 8, (j) => 26 * (1 - (j + 0.4) / 8.6) + 2, (u, v) => { const a = lerp(-Math.PI / 2, Math.PI / 2, u), q = (aR + 0.1) * (1 - v * 0.95); return [Math.sin(a) * q, v * 1.5, Math.cos(a) * q]; }, { pal: BLUE_SLATE, lift: 0.02, seed: 197 });
      });
    });
    // nave roof and the fleche over the crossing
    gableRoof(g, { x0: nx0 - 0.03, x1: 2.68, eZ: nhz + 0.12, eY: nH - 0.02, rY, pal: BLUE_SLATE, seed: 320, tw: 0.18, th: 0.16, ridgeCol: LEAD });
    g.in(M(-0.5, rY - 0.12, 0), () => {
      g.surf(K_PLAIN, 0.5, 0.6);
      g.lathe([[0.24, 0], [0.2, 0.2], [0.17, 0.5], [0.22, 0.56], [0.2, 0.62], [0.12, 0.8], [0.015, 2.7]], 8, (x, y, z) => mul(LEAD, 0.85 + 0.3 * noise3(x * 9, y * 3, z * 9)));
      g.surf(K_PLAIN, 0.3, 0.1, 0.9);
      for (let i = 0; i < 8; i += 2) g.in(RY(i * 45 + 22.5).multiply(M(0, 0.24, 0.17)), () => g.flat([[-0.045, 0, 0.012], [0.045, 0, 0.012], [0.045, 0.2, 0.012], [0, 0.27, 0.012], [-0.045, 0.2, 0.012]], [1.0, 0.72, 0.3]));
      g.in(M(0, 2.66, 0), () => spear(g, 0.5));
    });
    // the twin west towers
    for (const e of [1, -1]) g.in(M(tx, 0, e * tz), () => {
      const c0 = th - r, H3 = [[c0 - 0.14, 2.5, c0 + 0.14, 3.75], [c0 - 0.3, 4.5, c0 - 0.05, 5.75], [c0 + 0.05, 4.5, c0 + 0.3, 5.75]];
      stoneBox(g, th, th, 0, tH, st, 200 + e * 10, { quoin: [0.5, 0.3], holes: [H3, H3, H3, H3], each: (s, W) => {
        g.in(M(W - r, 2.5, 0), () => glassWindow(g, 0.28, 1.25, 210 + s, GL));
        for (const dx of [-0.175, 0.175]) g.in(M(W - r + dx, 4.5, 0), () => {
          glassWindow(g, 0.25, 1.25, 5, { frame, glow: 0, plain: [0.03, 0.03, 0.035], nx: 1, mould: 0.016 });
          g.surf(K_WOOD, 0.9);
          for (let k = 0; k < 9; k++) g.in(M(0, 0.07 + k * 0.105, -0.012, 38, 0, 0), () => g.cbox(0.24, 0.012, 0.075, 0.003, mul(rgb(0x6a6258), 0.9 + 0.2 * hash1(k, s))));
        });
      } });
      faces4(g, th, th, (s, W) => {
        g.surf(K_STONE, 0.93);
        for (const y of [2.22, 4.22, tH - 0.03]) band(g, [[0, y - 0.09], [0.04, y - 0.05], [0.055, y], [0.03, y + 0.03], [0, y + 0.04]], 2 * W, ca, 220 + s + y * 3, 1, 1);
        for (let i = 0; i < 6; i++) g.in(M(-W + 0.1 + i * ((2 * W - 0.2) / 5), tH - 0.16, 0.025), () => g.cbox(0.08, 0.08, 0.05, 0.012, cc));
        g.in(M(0, tH + 0.11, -0.05), () => g.cbox(2 * W - 0.3, 0.2, 0.08, 0.014, cc));
        for (const sx of [-1, 1]) g.in(M(sx * (W - 0.1), 0, 0), () => { buttress(g, 0.2, 0.09, 2.2, st, 225 + s * 3 + sx, 0.12); });
      });
      g.surf(K_STONE, 0.93);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * (th - 0.07), tH, sz * (th - 0.07)), () => pinnacle(g, 0.2, 1.3, ca));
      g.in(M(0, tH + 0.06, 0), () => { pyramidRoof(g, th - 0.13, 2.7, BLUE_SLATE, 230 + e, { tw: 0.13, th: 0.15 }); g.in(M(0, 2.66, 0), () => spear(g, 0.62)); });
      // the banner of the realm on the west face
      g.in(M(th + 0.03, 2.12, 0, 0, 90, 0), () => hangBanner(g, 0.52, 1.4, ROYAL, GOLD, e + 2));
    });
    // west front between the towers: the great door under its gablet, the rose, the gable
    const A = archOf(0.42, 1.0, 0.42, 0.16), fw = 2 * (tz - th);
    wall(g, [2.7, fw / 2], [2.7, -fw / 2], 0, 4.5, st, 300, { ends: [CUT, CUT, 0, 0], holes: archHoles(A, fw / 2, 0, 7, r, st.course), each: () => g.in(M(fw / 2, 0, 0), () => {
      g.surf(K_STONE, 0.93);
      voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, 11, st, 310, 0.016);
      archReveal(g, A, 0.18, col);
      g.in(M(0, 0, -0.14), () => archDoors(g, A, rgb(0x5a4028), 3, 0.05, 5));
      g.surf(K_STONE, 0.93);
      for (const e of [-1, 1]) {
        g.in(M(e * (A.half + 0.12), 0, 0.05), () => column(g, 0.055, A.spring + 0.02, ca, e, 10));
        g.beamTo([e * 0.68, 1.5, 0.05], [0, 2.32, 0.05], 0.1, 0.09, 0.02, cc, 2, [0, 0, 1]);
        g.in(M(e * 0.66, 1.5, 0.06), () => pinnacle(g, 0.1, 0.5, ca));
      }
      g.in(M(0, 2.3, 0.05), () => pinnacle(g, 0.11, 0.55, ca));
      g.in(M(0, 3.42, r + 0.004), () => roseWindow(g, 0.58, 1, { frame, glow: 1.0 }));
      g.surf(K_STONE, 0.93);
      g.in(M(-fw / 2, 4.5, 0), () => gableStone(g, fw / 2, 1.25, st, 315));
      for (const e of [-1, 1]) g.beamTo([e * (fw / 2 + 0.02), 4.48, 0.02], [0, 5.78, 0.02], 0.1, 0.12, 0.02, cc, 3, [0, 0, 1]);
      g.in(M(0, 5.74, 0), () => pinnacle(g, 0.14, 0.7, ca));
      band(g, [[0, 4.4], [0.05, 4.44], [0.06, 4.5], [0, 4.53]], fw, ca, 317);
    }) });
    g.surf(K_STONE, 0.93);
    g.in(M(2.7, 0, 0, 0, 90, 0), () => flight(g, 1.3, 0.28, 0, 0.02, 0.15, 2, cc));
  });
}

// ---------------------------------------------------------------------------------------------------
// Graal: serf hovel, 2 x 2
// ---------------------------------------------------------------------------------------------------
function pig(g) {
  const geo = geoOnce('pig', () => {
    const c = 0xd49a8c, P = [];
    P.push(S.ellipsoid(0.17, 0.105, 0.1).at(0, 0.17, 0).color(c).tint(0.2, 14));
    P.push(S.ellipsoid(0.075, 0.075, 0.07).at(0.2, 0.17, 0).color(c).blend(0.04));
    P.push(S.cyl(0.035, 0.05, 0.008).rot(0, 0, 90).at(0.275, 0.155, 0).color(0xc07a70).blend(0.012));
    P.push(...S.mirrorX([S.cone(0.03, 0.006, 0.06, 0.005).rot(20, 0, 0).at(0.03, 0.245, 0)]).map((p) => p.rot(0, 90, 0).at(0.18, 0, 0).color(0xc48878).blend(0.012)));
    for (const [x, z] of [[0.1, 0.055], [0.1, -0.055], [-0.1, 0.055], [-0.1, -0.055]]) P.push(S.capsule([x, 0.12, z], [x, 0.02, z], 0.03, 0.022).color(c).blend(0.02));
    P.push(S.capsule([-0.17, 0.2, 0], [-0.21, 0.24, 0.02], 0.012, 0.008).color(c).blend(0.01));
    return buildPartGeometry({ prims: P }, { res: 60 * qual(), ao: 0.7 });
  });
  g.surf(K_PLAIN, 0.8); if (geo) g.add(geo);
}
function graalHovel(g) {
  const mud = rgb(0x9c8462), oak = rgb(0x4a3826), straw = [0xb89a54, 0xa88844, 0xc4a860, 0x8f7438, 0x9a8a5a, 0x7d6a3a].map((h) => rgb(h));
  const hx = 0.66, hz = 0.5, cz = -0.24, wh = 0.78, rY = 1.72, eY = 0.6, eZ = hz + 0.26, x0 = -hx - 0.2, x1 = hx + 0.2;
  // trodden earth
  g.surf(K_PLAIN, 1);
  g.sheet(nq(24), 3, (u, v) => { const a = u * TAU, k = Math.pow(Math.pow(Math.abs(Math.cos(a)), 6) + Math.pow(Math.abs(Math.sin(a)), 6), -1 / 6); return [Math.cos(a) * 0.97 * k * v, v > 0.99 ? -0.04 : 0.035 * (1 - v * v), Math.sin(a) * 0.97 * k * v]; }, (x, y, z) => mul(rgb(0x5a4a34), 0.7 + 0.6 * noise3(x * 5, 1, z * 5)), true);
  g.in(new THREE.Matrix4().set(1, 0.07, 0, 0, 0, 1, 0, 0, 0, -0.05, 1, cz, 0, 0, 0, 1), () => {   // the whole hut leans
    faces4(g, hx, hz, (s, W) => {
      const items = s === 0 ? [{ kind: 'door', x: -0.22, w: 0.36, h: 0.6, wood: rgb(0x6a5236) }, { kind: 'win', x: 0.34, y: 0.48, w: 0.17, h: 0.15, shutters: false }] : s === 1 ? [{ kind: 'win', x: 0, y: 0.46, w: 0.17, h: 0.15 }] : [];
      framed(g, W, 0, wh, mud, oak, 400 + s, items, { bay: 0.42 });
      if (s % 2 === 1) {
        // wattle gable under the thatch
        g.surf(K_WOOD, 0.95);
        const n = 10;
        for (let i = 0; i < n; i++) { const x = -W + (2 * W * (i + 0.5)) / n, top = wh + (1 - Math.abs(x) / W) * (rY - wh) - 0.1; if (top > wh + 0.04) g.in(M(x, (wh + top) / 2, 0.01, 0, 0, 90), () => g.beam(top - wh, 0.085, 0.03, 0.01, woodTint(mul(rgb(0x7a6444), 0.8 + 0.4 * hash1(i, s)), i + s), 2)); }
        g.in(M(0, wh + 0.02, 0.03), () => g.beam(2 * W + 0.1, 0.08, 0.07, 0.012, woodTint(oak, 7), 2));
      }
    });
    // sagging thatch, thick at the eaves
    const sagAt = (x) => 0.12 * Math.sin(Math.PI * clamp((x - x0) / (x1 - x0), 0, 1));
    const roofAt = (e, x, v) => [x, lerp(eY, rY, v) - sagAt(x) * (0.3 + 0.7 * v) + 0.07 * Math.sin(Math.PI * v), e * lerp(eZ, 0.0, v)];
    g.surf(K_ROOF, 1);
    for (const e of [1, -1]) {
      tiles(g, 10, () => 30, (u, v) => roofAt(e, e > 0 ? lerp(x0, x1, u) : lerp(x1, x0, u), v), { pal: straw, lift: 0.045, seed: 420 + e, gap: 0.25, lap: 0.7 });
      const ev = []; for (let i = 0; i <= 10; i++) { const p = roofAt(e, lerp(x0, x1, i / 10), 0); ev.push([p[0], p[1] - 0.03, p[2]]); }
      g.tube(ev, 0.055, 6, (x, y, z) => mul(straw[3], 0.6 + 0.6 * noise3(x * 40, y * 9, z * 9)), true);
      for (const x of [x0, x1]) { const vg = []; for (let i = 0; i <= 6; i++) { const p = roofAt(e, x, i / 6); vg.push([p[0], p[1] - 0.03, p[2]]); } g.tube(vg, 0.05, 6, (px, py, pz) => mul(straw[1], 0.6 + 0.6 * noise3(px * 9, py * 40, pz * 40)), true); }
      g.surf(K_PLAIN, 1);
      g.flat([[x0 + 0.03, eY - 0.06, e * (eZ - 0.03)], [x1 - 0.03, eY - 0.06, e * (eZ - 0.03)], [x1 - 0.03, rY - 0.2, 0], [x0 + 0.03, rY - 0.2, 0]], [0.06, 0.045, 0.03]);
      g.surf(K_ROOF, 1);
    }
    const rd = []; for (let i = 0; i <= 12; i++) { const x = lerp(x0 - 0.02, x1 + 0.02, i / 12); rd.push([x, rY - sagAt(x) + 0.03, 0]); }
    g.tube(rd, 0.075, 7, (x, y, z) => mul(straw[0], 0.65 + 0.5 * noise3(x * 30, y * 30, z * 30)), true);
    g.surf(K_WOOD, 0.9);
    for (let i = 1; i < 12; i += 2) { const p = rd[i]; for (const e of [-1, 1]) g.beamTo([p[0], p[1] - 0.12, e * 0.16], [p[0] + 0.04, p[1] + 0.16, -e * 0.07], 0.022, 0.022, 0.005, woodTint(rgb(0x5a4630), i), 1); }
    g.in(M(0.2, rY - 0.05, 0), () => smoke(g, 0.7, 3));
  });
  // woodpile and chopping block
  const tw = rgb(0x6a5236);
  [[0, 0], [1, 0], [2, 0], [0.5, 1], [1.5, 1], [1, 2]].forEach(([i, j], k) => g.in(M(-0.93, 0.07 + j * 0.105, 0.36 + i * 0.125, 0, 8 * hash1(k, 3) - 4, -90), () => log(g, 0.058, 0.055, 0.5 + 0.06 * hash1(k, 9), 430 + k, { capB: true, seg: nq(9), vseg: 2 })));
  g.in(M(-0.25, 0, 0.7), () => {
    log(g, 0.12, 0.11, 0.2, 440, { seg: nq(12), vseg: 2 });
    g.in(M(0.02, 0.2, 0, 0, 30, 58), () => { g.surf(K_WOOD, 0.85); g.in(M(0.2, 0, 0), () => g.beam(0.42, 0.025, 0.022, 0.006, woodTint(tw, 3), 2)); g.surf(K_PLAIN, 0.45, 0.85); g.in(M(0.02, -0.03, 0), () => g.cbox(0.06, 0.14, 0.02, 0.006, [0.3, 0.3, 0.32])); });
  });
  // the sty: wattle hurdles round a wallow, and the pig
  const px0 = 0.2, px1 = 0.93, pz0 = 0.3, pz1 = 0.93, posts = [];
  for (const [a, b] of [[[px0, pz0], [px1, pz0]], [[px1, pz0], [px1, pz1]], [[px1, pz1], [px0, pz1]], [[px0, pz1], [px0, pz0]]]) for (let i = 0; i < 4; i++) posts.push([lerp(a[0], b[0], i / 4), lerp(a[1], b[1], i / 4)]);
  posts.forEach(([x, z], i) => g.in(M(x, -0.03, z, 3 * Math.sin(i * 2.1), 0, 3 * Math.cos(i * 1.7)), () => log(g, 0.022, 0.018, 0.42 + 0.05 * hash1(i, 2), 450 + i, { seg: 6, vseg: 2 })));
  g.surf(K_WOOD, 0.95);
  for (let k = 0; k < 4; k++) {
    const pts = posts.map(([x, z], i) => { const cxp = (px0 + px1) / 2, czp = (pz0 + pz1) / 2, d = Math.hypot(x - cxp, z - czp), o = ((i + k) % 2 ? 1 : -1) * 0.022; return [x + ((x - cxp) / d) * o, 0.06 + k * 0.085 + 0.01 * Math.sin(i * 3 + k), z + ((z - czp) / d) * o]; });
    pts.push(pts[0]);
    g.tube(pts, 0.012, 5, (x, y, z) => mul(rgb(0x7a6444), 0.6 + 0.7 * noise3(x * 25 + k, y * 25, z * 25)), false);
  }
  g.surf(K_PLAIN, 0.6);
  g.flat([[px0 + 0.03, 0.036, pz0 + 0.03], [px0 + 0.03, 0.036, pz1 - 0.03], [px1 - 0.03, 0.036, pz1 - 0.03], [px1 - 0.03, 0.036, pz0 + 0.03]], [0.07, 0.05, 0.035]);
  g.in(M(0.55, 0.03, 0.6, 0, 200, 0, 0.95), () => pig(g));
  g.surf(K_WOOD, 0.9);
  g.in(M(0.6, 0.08, 0.83), () => { g.cbox(0.34, 0.07, 0.1, 0.01, woodTint(tw, 5)); g.surf(K_PLAIN, 0.5); g.in(M(0, 0.036, 0), () => g.cbox(0.3, 0.004, 0.07, 0.001, [0.2, 0.17, 0.1])); });
  g.in(M(-0.72, 0.0, 0.84), () => tuft(g, 9, 0.16, 5));
  g.in(M(0.05, 0.0, 0.92), () => tuft(g, 7, 0.13, 6));
}

// ---------------------------------------------------------------------------------------------------
// Aurelia: foundry, 4 x 3
// ---------------------------------------------------------------------------------------------------
const BRICK = [0x8a4a34, 0x7a4030, 0x94553a, 0x6e3a2c, 0x80503c, 0x5e3830, 0x9a6046].map((h) => rgb(h));
const brickStyle = (seed, o = {}) => palStone(BRICK, seed, { course: 0.11, len: [0.2, 0.3], cell: 0.3 / qual(), r: 0.01, b: 0.01, var: 0.14, chip: 0.05, mortar: [0.14, 0.12, 0.1], ...o });
/** the triangle of a timber-framed gable on the local XY plane: base 2W at y = 0, apex H up, facing +Z */
function timberGable(g, W, H, plaster, oak, seed, lit = true) {
  g.surf(K_PLASTER, 0.97);
  g.sheet(6, 4, (u, v) => { const y = v * H, hw = W * (1 - v); return [(u * 2 - 1) * hw, y, 0.006 * (noise3(u * 9 + seed, y * 6, 3) - 0.5)]; }, (x, y, z) => mul(plaster, 0.86 + 0.24 * fbm3(x * 5 + seed, y * 5, 2, 2)));
  g.surf(K_WOOD, 0.88);
  const tb = (s) => woodTint(mul(oak, 0.85 + 0.35 * hash1(seed + s, 3)), seed + s), T = (a, b, w, s) => g.beamTo([a[0], a[1], 0.025], [b[0], b[1], 0.025], 0.07, w, 0.01, tb(s), 2, [0, 0, 1]);
  T([-W - 0.04, 0.05], [W + 0.04, 0.05], 0.12, 1);
  for (const e of [-1, 1]) { T([e * W, 0.03], [0, H], 0.1, 2 + e); T([e * W * 0.5, 0.1], [e * W * 0.5, H * 0.46], 0.08, 4 + e); T([e * W * 0.5, 0.1], [e * W * 0.12, H * 0.5], 0.065, 6 + e); T([e * W * 0.86, 0.1], [e * W * 0.55, H * 0.4], 0.065, 9 + e); }
  T([-W * 0.5, H * 0.5], [W * 0.5, H * 0.5], 0.09, 8);
  T([0, H * 0.5], [0, H - 0.05], 0.085, 12);
  g.in(M(0, H * 0.27, 0.01), () => casement(g, W * 0.24, H * 0.22, oak, seed, false, false, lit));
}
function coalHeap(g, rx, rz, h, seed) {
  const rnd = rng(seed * 5 + 1), hgt = (x, z) => { const d = Math.hypot(x / rx, z / rz); return d >= 1 ? 0 : h * Math.pow(1 - d * d, 0.7); };
  g.surf(K_PLAIN, 0.55, 0.1);
  g.sheet(nq(16), nq(5), (u, v) => { const a = u * TAU, d = 1 - v; return [Math.cos(a) * rx * d, hgt(Math.cos(a) * rx * d, Math.sin(a) * rz * d) - (v === 0 ? 0.03 : 0), Math.sin(a) * rz * d]; }, (x, y, z) => mul([0.03, 0.03, 0.035], 0.5 + 1.2 * noise3(x * 14 + seed, y * 14, z * 14)), true);
  for (let i = 0; i < nq(46); i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.95, x = Math.cos(a) * rx * d, z = Math.sin(a) * rz * d, s = 0.04 + 0.05 * rnd(); g.in(M(x, hgt(x, z) + s * 0.2, z, rnd() * 90, rnd() * 90, rnd() * 90), () => g.cbox(s * 1.3, s, s * 1.1, s * 0.3, mul([0.035, 0.035, 0.042], 0.5 + 1.6 * rnd()))); }
}
/** a bronze gun barrel lying along local X, centred, len long */
function gunBarrel(g, len, r, col = BRONZE) {
  g.surf(K_PLAIN, 0.32, 0.9);
  const k = (x, y, z) => mul(col, 0.82 + 0.3 * noise3(x * 9, y * 9, z * 9));
  g.in(M(-len / 2, 0, 0, 0, 0, -90), () => {
    g.lathe([[0, -r * 0.9], [r * 0.5, -r * 0.8], [r * 0.45, -r * 0.3], [r * 0.8, -r * 0.1], [r * 1.25, 0], [r * 1.3, len * 0.05], [r * 1.12, len * 0.07], [r * 1.1, len * 0.3], [r * 1.22, len * 0.32], [r * 1.22, len * 0.35], [r * 1.0, len * 0.37], [r * 0.84, len * 0.88], [r * 1.05, len * 0.92], [r * 1.1, len * 0.97], [r * 0.95, len], [r * 0.55, len], [r * 0.55, len * 0.9]], nq(14), k);
    g.in(M(0, len * 0.9, 0), () => g.cyl(r * 0.55, r * 0.55, 0.001, nq(10), [0.01, 0.01, 0.01], false, true));
  });
  for (const e of [-1, 1]) g.in(M(-len * 0.08, 0, e * r * 0.9, e * 90, 0, 0), () => g.cyl(r * 0.36, r * 0.36, r * 0.75, 8, mul(col, 0.9), false, true));
}
function aureliaFoundry(g) {
  const st = brickStyle(500), r = st.r, oak = rgb(0x3e2c1e), plaster = rgb(0xb8aa8c), tb = (s, k = 1) => woodTint(mul(oak, k * (0.85 + 0.35 * hash1(s, 3))), s);
  const cx = -0.65, hx = 1.25, cz = -0.3, hz = 1.05, wH = 1.76, rY = 3.3, SOOT_TILE = [0x5a3a30, 0x4a322c, 0x63453a, 0x3e2c28, 0x55403a].map((h) => rgb(h));
  // cinder yard
  g.surf(K_PLAIN, 1);
  g.sheet(nq(14), nq(10), (u, v) => [lerp(-1.96, 1.96, u), 0.012 + 0.02 * noise3(u * 9, 2, v * 7) - (u === 0 || u === 1 || v === 0 || v === 1 ? 0.05 : 0), lerp(-1.46, 1.46, v)], (x, y, z) => mul([0.1, 0.09, 0.085], 0.6 + 0.9 * noise3(x * 6, 3, z * 6)));
  g.in(M(cx, 0, cz), () => {
    const A = archOf(0.44, 0.66, 0.36, 0.13), c0 = hx - r, uc = c0 - 0.3;
    const win = (u) => [u - 0.165, 0.77, u + 0.165, 1.32];
    blockBox(g, hx, hz, 0, wH, st, 510, { top: false, quoin: [0.32, 0.2], holes: [[...archHoles(A, uc, 0, 11, r, st.course), win(c0 + 0.75)], [win(hz - r - 0.45), win(hz - r + 0.45)], [win(c0 - 0.6), win(c0 + 0.6)], [win(hz - r - 0.45), win(hz - r + 0.45)]], each: (s, W) => {
      const us = s === 0 ? [c0 + 0.75] : s === 2 ? [c0 - 0.6, c0 + 0.6] : [W - r - 0.45, W - r + 0.45];
      for (const u of us) g.in(M(u, 0.77, 0), () => {
        // a barred window, the fire behind it
        g.surf(K_PLAIN, 0.6, 0, 1.0);
        g.flat([[-0.165, 0, -0.06], [0.165, 0, -0.06], [0.165, 0.55, -0.06], [-0.165, 0.55, -0.06]], [[1.0, 0.36, 0.06], [1.0, 0.36, 0.06], [0.7, 0.12, 0.03], [0.7, 0.12, 0.03]]);
        g.surf(K_PLAIN, 1);
        for (const [a, b] of [[[-0.165, 0], [0.165, 0]], [[0.165, 0], [0.165, 0.55]], [[0.165, 0.55], [-0.165, 0.55]], [[-0.165, 0.55], [-0.165, 0]]]) g.flat([[a[0], a[1], r], [b[0], b[1], r], [b[0], b[1], -0.06], [a[0], a[1], -0.06]], mul(BRICK[3], 0.5));
        g.surf(K_PLAIN, 0.6, 0.8);
        for (const x of [-0.08, 0, 0.08]) g.in(M(x, 0.275, -0.03), () => g.cbox(0.018, 0.55, 0.018, 0.004, IRON));
        g.in(M(0, 0.275, -0.03), () => g.cbox(0.33, 0.018, 0.018, 0.004, IRON));
        g.surf(K_STONE, 0.9);
        g.in(M(0, -0.03, 0.02), () => g.cbox(0.44, 0.06, 0.08, 0.012, stoneTint(rgb(0x8a8478), 3)));
        g.in(M(0, 0.59, 0.02), () => g.cbox(0.46, 0.08, 0.07, 0.012, stoneTint(rgb(0x8a8478), 4)));
      });
      if (s === 0) g.in(M(uc, 0, 0), () => {
        // the furnace mouth
        g.surf(K_STONE, 0.93); voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, 13, st, 520, 0.014);
        const n = 12, out = [];
        for (let k = 0; k <= n; k++) { const x = -A.half + (2 * A.half * k) / n; out.push([x, A.y(x)]); }
        g.surf(K_PLAIN, 1, 0, 0.5);
        for (let k = 0; k < n; k++) g.flat([[out[k][0], out[k][1], 0.01], [out[k + 1][0], out[k + 1][1], 0.01], [out[k + 1][0], out[k + 1][1], -0.3], [out[k][0], out[k][1], -0.3]], [[0.5, 0.12, 0.03], [0.5, 0.12, 0.03], [1.0, 0.3, 0.05], [1.0, 0.3, 0.05]]);
        for (const e of [-1, 1]) g.flat([[e * A.half, 0, 0.01], [e * A.half, A.spring, 0.01], [e * A.half, A.spring, -0.3], [e * A.half, 0, -0.3]], [[0.5, 0.12, 0.03], [0.5, 0.12, 0.03], [1.0, 0.3, 0.05], [1.0, 0.3, 0.05]]);
        g.surf(K_PLAIN, 1, 0, 1.0);
        for (let k = 0; k < n; k++) g.flat([[out[k][0], 0, -0.3], [out[k + 1][0], 0, -0.3], [out[k + 1][0], out[k + 1][1], -0.3], [out[k][0], out[k][1], -0.3]], [[1.0, 0.42, 0.06], [1.0, 0.42, 0.06], [0.9, 0.16, 0.02], [0.9, 0.16, 0.02]]);
        g.in(M(0, 0.02, -0.16), () => fire(g, 0.5, FIRE_HOT, 2, 1.7));
        g.surf(K_PLAIN, 0.55, 0.85);
        g.tube([[-A.half - 0.03, 0, 0.03], ...out.map(([x, y]) => [x * 1.06, y + 0.03, 0.03]), [A.half + 0.03, 0, 0.03]], 0.028, 6, IRON, true);
        for (let k = -3; k <= 3; k++) g.in(M(k * 0.11, 0.17, 0.04), () => g.cbox(0.022, 0.34, 0.022, 0.005, IRON));
        g.in(M(0, 0.34, 0.04), () => g.cbox(0.8, 0.03, 0.03, 0.006, IRON));
        // hood
        g.in(M(0, A.spring + A.rise + 0.16, 0.02), () => g.lathe([[0.62, 0], [0.5, 0.2], [0.2, 0.48], [0.16, 0.9]], nq(12), (x, y, z) => mul([0.07, 0.065, 0.065], 0.7 + 0.6 * noise3(x * 9, y * 9, z * 9)), 0, Math.PI));
      });
    } });
    g.shade(-0.95, 0.9, hz - 0.1, 0.35, wH + 0.2, hz + 0.3, 0.6, 0.15);
    // jettied timber gables front and back, a tiled roof black with soot
    for (const s of [0, 2]) g.in(RY(s * 90).multiply(M(0, wH, hz + 0.05)), () => { g.surf(K_WOOD, 0.88); for (let i = 0; i < 9; i++) g.in(M(-hx + 0.1 + i * ((2 * hx - 0.2) / 8), -0.04, -0.02), () => g.cbox(0.09, 0.1, 0.16, 0.012, tb(i + s))); timberGable(g, hx + 0.04, rY - wH - 0.06, plaster, oak, 530 + s, s === 0); });
    g.in(RY(90), () => gableRoof(g, { x0: -hz - 0.16, x1: hz + 0.16, eZ: hx + 0.16, eY: wH - 0.04, rY, pal: SOOT_TILE, seed: 540, barge: mul(oak, 0.9), tw: 0.17, th: 0.15 }));
    g.shade(0.2, wH, -hz - 0.3, hx + 0.4, rY + 0.3, 0.4, 0.45, 0.4);
    // door on the yard side
    g.in(M(hx + 0.012, 0, 0.0, 0, 90, 0), () => { g.surf(K_STONE, 0.9); g.in(M(0, 0.73, -0.005), () => g.cbox(0.6, 1.46, 0.03, 0.01, stoneTint(rgb(0x6a645c), 3))); plankDoor(g, 0.46, 1.36, rgb(0x54402c), 7, 4); });
  });
  // two great stacks
  const stack = (x, z, R1, R2, H1, H, seed) => g.in(M(x, 0, z), () => {
    const sq = R1 + 0.07;
    blockBox(g, sq, sq, 0, 0.66, st, seed, { topCol: mul(BRICK[0], 0.7) });
    drum(g, R1, 0.66, H1 - 0.66, st, seed + 1);
    drum(g, R2, H1, H - H1, st, seed + 2);
    g.surf(K_STONE, 0.93);
    g.lathe([[R1, H1 - 0.06], [R1 + 0.03, H1 - 0.02], [R2 + 0.01, H1 + 0.1]], nq(16), mul(BRICK[2], 0.9));
    g.lathe([[R2, H - 0.3], [R2 + 0.05, H - 0.24], [R2 + 0.05, H - 0.14], [R2 + 0.02, H - 0.1], [R2 + 0.07, H - 0.04], [R2 + 0.07, H], [R2 - 0.07, H], [R2 - 0.07, H - 0.3]], nq(16), mul(BRICK[5], 0.55));
    g.surf(K_PLAIN, 0.5, 0.85);
    for (const y of [1.2, H1 + 0.6, H1 + 1.5, H - 0.6]) if (y < H - 0.4) { const R = y < H1 ? R1 : R2; g.in(M(0, y, 0), () => g.lathe([[R + 0.004, -0.03], [R + 0.016, 0], [R + 0.004, 0.03]], nq(16), IRON)); }
    g.shade(-R2 - 0.2, H - 1.6, -R2 - 0.2, R2 + 0.2, H + 0.1, R2 + 0.2, 0.75, 0.2, [1, 1]);
    g.in(M(0, H - 0.08, 0), () => smoke(g, 1.7 * (R2 / 0.26), seed, 0x3a3836, 0x7a7872));
  });
  stack(1.06, -0.96, 0.33, 0.27, 2.4, 5.3, 550);
  stack(1.66, -0.44, 0.25, 0.2, 1.8, 4.0, 560);
  g.surf(K_STONE, 0.93);
  g.in(M(0.75, 1.1, -0.96), () => g.cbox(0.5, 0.44, 0.4, 0.02, (x, y, z) => mul(BRICK[Math.floor(hash1(Math.round(y * 9), Math.round(x * 5)) * 6)], 0.75)));
  // the hoist, a new gun swinging from it
  const hz0 = 0.62, hy = 2.2;
  g.surf(K_WOOD, 0.88);
  for (const x of [0.86, 1.86]) {
    g.in(M(x, hy / 2, hz0, 0, 0, 90), () => g.beam(hy, 0.11, 0.11, 0.014, tb(x * 5), 4));
    g.beamTo([x, 0.02, hz0 - 0.5], [x, 1.3, hz0 - 0.03], 0.08, 0.08, 0.012, tb(x * 7), 2);
    g.beamTo([x + (x < 1.3 ? 0.03 : -0.03), hy - 0.55, hz0], [x + (x < 1.3 ? 0.5 : -0.5), hy - 0.06, hz0], 0.07, 0.07, 0.01, tb(x * 9), 2);
    g.in(M(x, 0.04, hz0 - 0.2), () => g.cbox(0.16, 0.08, 0.8, 0.014, tb(x * 3, 0.8)));
  }
  g.in(M(1.36, hy + 0.06, hz0), () => g.beam(1.3, 0.14, 0.13, 0.016, tb(21), 4));
  g.surf(K_PLAIN, 0.5, 0.85);
  for (const x of [1.12, 1.6]) { g.in(M(x, hy - 0.06, hz0), () => g.cbox(0.06, 0.12, 0.16, 0.01, IRON)); chain(g, [[x, hy - 0.1, hz0], [x, 1.13, hz0]], 0.05); g.in(M(x, 1.0, hz0, 0, 90, 0), () => g.add(new THREE.TorusGeometry(0.125, 0.014, 5, nq(14)), IRON)); }
  g.in(M(1.36, 1.0, hz0), () => gunBarrel(g, 0.95, 0.085));
  // coal, a quenching butt, shot, an anvil on its block
  g.in(M(1.36, 0.02, 1.12), () => coalHeap(g, 0.52, 0.3, 0.3, 3));
  g.in(M(0.2, 0.02, 1.24), () => coalHeap(g, 0.3, 0.2, 0.18, 5));
  g.in(M(0.86, 0, -0.1), () => barrel(g, 0.17, 0.42, rgb(0x6a4a30), 3));
  g.surf(K_PLAIN, 0.45, 0.85);
  [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0.5, 0, 0.87], [1.5, 0, 0.87], [1, 0, 1.73], [0.5, 0.8, 0.3], [1.5, 0.8, 0.3], [1, 0.8, 1.15], [1, 1.6, 0.6]].forEach(([i, j, k]) => g.in(M(1.62 + i * 0.1, 0.06 + j * 0.1, 0.02 + k * 0.1), () => ball(g, 0.05, [0.06, 0.06, 0.065], 8, 6)));
  g.in(M(-1.6, 0, 1.12), () => {
    log(g, 0.15, 0.14, 0.3, 571, { seg: nq(12), vseg: 2 });
    g.surf(K_PLAIN, 0.4, 0.85);
    g.in(M(0, 0.34, 0), () => g.cbox(0.2, 0.08, 0.14, 0.015, [0.09, 0.09, 0.1])); g.in(M(0, 0.4, 0), () => g.cbox(0.12, 0.06, 0.1, 0.01, [0.09, 0.09, 0.1])); g.in(M(0.02, 0.47, 0), () => g.cbox(0.34, 0.09, 0.13, 0.015, [0.1, 0.1, 0.11]));
    g.in(M(0.21, 0.48, 0, 0, 0, -90), () => g.lathe([[0.045, 0], [0, 0.12]], 6, [0.1, 0.1, 0.11]));
  });
}

// ---------------------------------------------------------------------------------------------------
// Aurelia: Temple of the Hammer-Saint, 4 x 5 (front toward +Z)
// ---------------------------------------------------------------------------------------------------
/** the hammer and the twin-tailed comet in gold on the local XY plane, about s high, facing +Z */
function hammerComet(g, s) {
  g.surf(K_PLAIN, 0.3, 0.92, 0.12);
  const c = (x, y, z) => mul(GOLD, 0.9 + 0.25 * noise3(x * 12, y * 12, z * 12));
  g.in(M(0, -0.06 * s, 0.03 * s), () => g.cbox(0.07 * s, 0.86 * s, 0.05 * s, 0.012 * s, c));
  g.in(M(0, 0.3 * s, 0.045 * s), () => { g.cbox(0.44 * s, 0.22 * s, 0.11 * s, 0.025 * s, c); for (const e of [-1, 1]) g.in(M(e * 0.2 * s, 0, 0), () => g.cbox(0.06 * s, 0.27 * s, 0.14 * s, 0.02 * s, c)); });
  g.in(M(0, -0.5 * s, 0.03 * s), () => ball(g, 0.055 * s, GOLD, 8, 6));
  g.in(M(-0.4 * s, 0.42 * s, 0.03 * s), () => ball(g, 0.085 * s, GOLD, 10, 7));
  for (const [dx, dy] of [[0.72, -0.62], [0.86, -0.4]]) g.tube(curvePts([[-0.4 * s, 0.42 * s, 0.02 * s], [-0.1 * s, (0.42 + dy * 0.45) * s, 0.01 * s], [(-0.4 + dx) * s, (0.42 + dy) * s, 0.012 * s]], 8), [0.07, 0.062, 0.054, 0.046, 0.038, 0.03, 0.022, 0.014, 0.004].map((q) => q * s), 6, c, true);
}
/** a reliquary niche cut d deep into a wall face: local origin at the middle of its sill; a skull between two candles */
function reliquary(g, w, h, d, col, seed) {
  g.surf(K_PLAIN, 1);
  const dk = mul(col, 0.16), md = mul(col, 0.6), n = 6, out = [[-w / 2, 0]];
  for (let k = 0; k <= n; k++) { const a = Math.PI - (k / n) * Math.PI; out.push([Math.cos(a) * w / 2, h - w / 2 + Math.sin(a) * w / 2]); }
  out.push([w / 2, 0]);
  for (let k = 0; k < out.length - 1; k++) g.flat([[out[k][0], out[k][1], 0.012], [out[k + 1][0], out[k + 1][1], 0.012], [out[k + 1][0], out[k + 1][1], -d], [out[k][0], out[k][1], -d]], [md, md, dk, dk]);
  for (let k = 1; k < out.length - 2; k++) g.flat([[out[k][0], out[k][1], -d], [out[k + 1][0], out[k + 1][1], -d], [out[k + 1][0], 0, -d], [out[k][0], 0, -d]], dk);
  g.flat([[-w / 2, 0.001, 0.03], [w / 2, 0.001, 0.03], [w / 2, 0.001, -d], [-w / 2, 0.001, -d]], md);
  g.surf(K_STONE, 0.9);
  g.tube(out.map(([x, y]) => [x * 1.08, y + 0.01, 0.02]), 0.024, 5, stoneTint(mul(col, 1.1), seed, 6), true);
  g.in(M(0, -0.03, 0.03), () => g.cbox(w + 0.14, 0.06, 0.1, 0.014, stoneTint(mul(col, 1.08), seed + 1, 6)));
  g.in(M(0, 0.0, -d * 0.45, 0, 0, 0), () => skull(g, Math.min(1.25, (w / 0.24) * 0.62)));
  for (const e of [-1, 1]) g.in(M(e * w * 0.36, 0, -d * 0.2), () => candle(g, 0.1 + 0.05 * hash1(seed, e + 2), 0.014));
}
/** a baroque urn with a flame, standing on the local origin */
function urn(g, s, col, lit = true) {
  g.surf(K_STONE, 0.85);
  g.lathe([[0.2, 0], [0.2, 0.08], [0.08, 0.14], [0.07, 0.24], [0.22, 0.4], [0.27, 0.56], [0.22, 0.72], [0.1, 0.8], [0.14, 0.86], [0.1, 0.9]].map(([r, y]) => [r * s, y * s]), nq(12), col);
  if (lit) g.in(M(0, 0.88 * s, 0), () => fire(g, 0.4 * s, FIRE_HOT, 1, 1.4));
}
function aureliaHammerTemple(g) {
  const st = bigStone(0xc9b891, 600, { var: 0.08 }), r = st.r, col = st.pal[0], cc = stoneTint(mul(col, 1.06), 4, 5), trim = mul(col, 1.12);
  const hx = 1.45, cz = -0.55, hz = 1.8, wH = 2.75, fz = cz + hz, COPPER_G = rgb(0x4f9c86);
  const A = archOf(0.4, 1.25, 0.4, 0.16);
  g.in(M(0, 0, cz), () => {
    const c0s = hz - r, nich = [-1.12, 0, 1.12];
    stoneBox(g, hx, hz, 0, wH, st, 610, { quoin: [0.62, 0.34], holes: [[...archHoles(A, hx - r, 0, 8, r, st.course), [hx - r - 1.14, 0.75, hx - r - 0.78, 1.5], [hx - r + 0.78, 0.75, hx - r + 1.14, 1.5]], nich.map((x) => [c0s + x - 0.2, 0.75, c0s + x + 0.2, 1.5]), null, nich.map((x) => [c0s + x - 0.2, 0.75, c0s + x + 0.2, 1.5])], each: (s, W) => {
      if (s % 2 === 1) for (const x of nich) { g.in(M(W - r + x, 0.75, 0), () => reliquary(g, 0.4, 0.75, 0.2, col, 620 + s + x)); g.in(M(W - r + x, 2.12, r + 0.004), () => roseWindow(g, 0.17, 3 + s, { frame: trim, petals: 6, glow: 0.9 })); }
      if (s === 0) g.in(M(W - r, 0, 0), () => {
        for (const e of [-1, 1]) g.in(M(e * 0.96, 0.75, 0), () => reliquary(g, 0.36, 0.75, 0.2, col, 630 + e));
        g.surf(K_STONE, 0.93); voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, 11, st, 640, 0.018);
        archReveal(g, A, 0.18, col); g.in(M(0, 0, -0.14), () => archDoors(g, A, rgb(0x4a3020), 3, 0.05, 9));
      });
    } });
    // pilasters, a heavy entablature, urns at the corners
    faces4(g, hx, hz, (s, W) => {
      g.surf(K_STONE, 0.93);
      const xs = s % 2 === 1 ? [-1.68, -0.56, 0.56, 1.68] : s === 2 ? [-1.3, -0.45, 0.45, 1.3] : [];
      for (const x of xs) { g.in(M(x, wH / 2 - 0.1, 0.035), () => g.cbox(0.24, wH - 0.2, 0.07, 0.014, cc)); g.in(M(x, wH - 0.28, 0.05), () => g.cbox(0.3, 0.14, 0.1, 0.02, cc)); g.in(M(x, 0.16, 0.05), () => g.cbox(0.3, 0.32, 0.1, 0.02, cc)); }
      band(g, [[0, wH - 0.16], [0.06, wH - 0.14], [0.06, wH - 0.05], [0.14, wH], [0.16, wH + 0.08], [0.1, wH + 0.12], [0, wH + 0.14]], 2 * W, trim, 650 + s, 1, 1);
      band(g, [[0.06, 0.3], [0.06, 0.36], [0, 0.44]], 2 * W, trim, 655 + s, 1, 1);
    });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * (hx - 0.05), wH + 0.14, sz * (hz - 0.05)), () => urn(g, 0.62, cc));
    hipRoof(g, hx + 0.06, hz + 0.06, wH + 0.14, wH + 0.62, 0.03, SLATE, 660, { tw: 0.2, th: 0.18 });
    // attic, drum and the green copper dome
    const dY = wH + 0.25, dR = 0.98;
    stoneBox(g, 1.12, 1.12, dY, dY + 0.5, st, 670, { noFoot: true });
    faces4(g, 1.12, 1.12, (s, W) => { g.surf(K_STONE, 0.93); band(g, [[0, dY + 0.42], [0.06, dY + 0.46], [0.07, dY + 0.52], [0, dY + 0.55]], 2 * W, trim, 675 + s, 1, 1); });
    const circ = (dR - r) * TAU, wn = 8;
    drum(g, dR, dY + 0.5, 1.0, st, 680, { holes: Array.from({ length: wn }, (_, i) => [((i + 0.5) / wn) * circ - 0.13, 0.25, ((i + 0.5) / wn) * circ + 0.13, 0.75]), each: () => {
      for (let i = 0; i < wn; i++) {
        g.in(M(((i + 0.5) / wn) * circ, 0.25, 0), () => glassWindow(g, 0.26, 0.5, 690 + i, { frame: trim, pointed: false, glow: 1.0, nx: 2, pal: [rgb(0xe8b040), rgb(0xd87828), rgb(0xf0d070), rgb(0xc04828)] }));
        g.surf(K_STONE, 0.93);
        g.in(M((i / wn) * circ, 0.5, 0.04), () => g.cbox(0.16, 1.0, 0.09, 0.016, cc));
      }
    } });
    g.surf(K_STONE, 0.93);
    g.lathe([[dR, dY + 1.42], [dR + 0.1, dY + 1.46], [dR + 0.12, dY + 1.56], [dR + 0.02, dY + 1.6]], nq(28), trim);
    const dmY = dY + 1.58, dmH = 1.35, dome = (v) => [dR * 1.02 * Math.cos(v * Math.PI * 0.5), dmH * Math.pow(Math.sin(v * Math.PI * 0.5), 0.92)];
    g.surf(K_PLAIN, 0.55, 0.45);
    g.in(M(0, dmY, 0), () => {
      g.sheet(nq(48), nq(14), (u, v) => { const [rr, y] = dome(v * 0.93), a = u * TAU; return [Math.cos(a) * rr, y, Math.sin(a) * rr]; }, (x, y, z) => { const a = Math.atan2(z, x); return mul(mix(COPPER_G, rgb(0x2f6e62), smooth(0.4, 0.8, noise3(a * 5, y * 1.2, 3))), (0.8 + 0.3 * noise3(x * 6, y * 6, z * 6)) * (1 - 0.18 * smooth(0.5, 0.9, noise3(a * 14, y * 0.6, 9)))); }, true);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU, pts = []; for (let k = 0; k <= 8; k++) { const [rr, y] = dome((k / 8) * 0.93); pts.push([Math.cos(a) * (rr + 0.01), y + 0.005, Math.sin(a) * (rr + 0.01)]); } g.tube(pts, 0.03, 5, mul(COPPER_G, 0.7), false); }
      // lantern and the hammer on top
      const ly = dome(0.93)[1] - 0.02;
      g.surf(K_STONE, 0.9);
      g.in(M(0, ly, 0), () => {
        g.lathe([[0.3, 0], [0.3, 0.06], [0.22, 0.1], [0.22, 0.5], [0.3, 0.54], [0.3, 0.6]], nq(12), cc);
        g.surf(K_PLAIN, 0.3, 0, 1.3);
        for (let i = 0; i < 6; i++) g.in(RY(i * 60).multiply(M(0, 0.14, 0.225)), () => g.flat([[-0.05, 0, 0], [0.05, 0, 0], [0.05, 0.24, 0], [0, 0.3, 0], [-0.05, 0.24, 0]], [1.0, 0.6, 0.18]));
        g.surf(K_PLAIN, 0.55, 0.45);
        g.in(M(0, 0.6, 0), () => g.lathe([[0.3, 0], [0.26, 0.12], [0.14, 0.24], [0.05, 0.3], [0.04, 0.42]], nq(12), COPPER_G));
        g.in(M(0, 1.0, 0), () => { g.surf(K_PLAIN, 0.3, 0.92, 0.1); g.in(M(0, 0.15, 0), () => g.cbox(0.05, 0.62, 0.05, 0.01, GOLD)); g.in(M(0, 0.44, 0), () => { g.cbox(0.36, 0.2, 0.16, 0.025, GOLD); for (const e of [-1, 1]) g.in(M(e * 0.17, 0, 0), () => g.cbox(0.05, 0.25, 0.2, 0.02, GOLD)); }); g.in(M(0, -0.14, 0), () => ball(g, 0.07, GOLD, 8, 6)); });
      });
    });
  });
  // portico: four heavy columns, a curved pediment with the emblem of the saint
  const pz = fz + 0.56, pH = 2.3, by = 0.3;
  g.surf(K_STONE, 0.93);
  g.in(M(0, by / 2, fz + 0.42), () => g.cbox(3.2, by, 0.9, 0.02, stoneTint(mul(col, 0.95), 2, 4)));
  g.in(M(0, 0, 0), () => flight(g, 2.2, fz + 1.2, 0, fz + 0.86, by, 3, mul(col, 0.98), 3));
  for (const x of [-1.32, -0.6, 0.6, 1.32]) g.in(M(x, by, pz), () => column(g, 0.165, pH, mul(col, 1.08), x * 3, nq(16)));
  g.in(M(0, by + pH + 0.14, pz - 0.02), () => g.cbox(3.16, 0.28, 0.5, 0.02, cc));
  g.in(M(0, by + pH + 0.33, pz - 0.02), () => g.cbox(3.34, 0.1, 0.62, 0.02, stoneTint(trim, 3, 5)));
  g.flat([[-1.6, by + pH + 0.38, pz + 0.26], [1.6, by + pH + 0.38, pz + 0.26], [1.6, by + pH + 0.38, fz], [-1.6, by + pH + 0.38, fz]], mul(col, 0.8));
  g.in(M(0, by + pH + 0.38, pz + 0.2), () => {
    const R = 1.9, hw = 1.56, y0 = -Math.sqrt(R * R - hw * hw), top = (x) => y0 + Math.sqrt(R * R - x * x), n = 14, pts = [];
    for (let k = 0; k <= n; k++) { const x = lerp(-hw, hw, k / n); pts.push([x, top(x)]); }
    g.surf(K_STONE, 0.93);
    for (let k = 0; k < n; k++) { g.flat([[pts[k][0], 0, 0], [pts[k + 1][0], 0, 0], [pts[k + 1][0], pts[k + 1][1], 0], [pts[k][0], pts[k][1], 0]], mul(col, 0.92)); g.flat([[pts[k][0], pts[k][1], 0.06], [pts[k + 1][0], pts[k + 1][1], 0.06], [pts[k + 1][0], pts[k + 1][1], -0.75], [pts[k][0], pts[k][1], -0.75]], mul(rgb(0x6f7a80), 0.9 + 0.1 * (k % 2))); }
    g.tube(pts.map(([x, y]) => [x, y, 0.04]), 0.07, 6, stoneTint(trim, 5, 5), true);
    g.in(M(0, 0.03, 0.04), () => g.cbox(3.3, 0.08, 0.14, 0.02, stoneTint(trim, 6, 5)));
    g.in(M(0, 0.86, 0.02), () => urn(g, 0.5, cc));
    for (const e of [-1, 1]) g.in(M(e * 1.5, 0.06, 0), () => urn(g, 0.45, cc));
    g.surf(K_PLAIN, 0.6); g.in(M(0, 0.36, 0.012, 90, 0, 0), () => g.cyl(0.36, 0.36, 0.02, nq(20), [0.05, 0.07, 0.16], false, true));
    g.in(M(0, 0.36, 0.03), () => hammerComet(g, 0.56));
  });
  // candles on the steps and before the door
  for (const [x, z, n] of [[-1.0, fz + 0.62, 5], [1.0, fz + 0.62, 5], [-0.42, fz + 0.2, 3], [0.42, fz + 0.2, 3]]) for (let i = 0; i < n; i++) g.in(M(x + 0.07 * Math.cos(i * 2.4) * (1 + i * 0.2), by, z + 0.07 * Math.sin(i * 2.4) * (1 + i * 0.2)), () => candle(g, 0.07 + 0.09 * hash1(i, Math.round(x * 9))));
  for (const e of [-1, 1]) g.in(M(e * 1.32, by + 1.45, pz + 0.17), () => hangBanner(g, 0.3, 0.95, rgb(0x8a1c1c), GOLD, e));
}

/** a flat plate with outline pts ([x, y] on the local XY plane, star-shaped about its centroid), t thick */
function plate(g, pts, t, col, edge = null) {
  const n = pts.length, e = edge || mul(col, 0.65); let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0] / n; cy += p[1] / n; }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    g.flat([[cx, cy, t / 2], [a[0], a[1], t / 2], [b[0], b[1], t / 2]], col); g.flat([[cx, cy, -t / 2], [a[0], a[1], -t / 2], [b[0], b[1], -t / 2]], col);
    g.flat([[a[0], a[1], t / 2], [b[0], b[1], t / 2], [b[0], b[1], -t / 2], [a[0], a[1], -t / 2]], e);
  }
}
/** a railing of fine metalwork round a circle of radius R on the local y = 0: posts, two rails, a lattice between */
function filigree(g, R, h, col, n = 18) {
  g.surf(K_PLAIN, 0.25, 0.92);
  for (const [y, t] of [[0.02, 0.012], [h, 0.016], [h * 0.52, 0.008]]) g.in(M(0, y, 0), () => g.add(new THREE.TorusGeometry(R, t, 5, nq(36)).rotateX(Math.PI / 2), col));
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU, P = (a, y) => [Math.cos(a) * R, y, Math.sin(a) * R];
    g.in(M(Math.cos(a0) * R, 0, Math.sin(a0) * R), () => { g.cyl(0.012, 0.01, h + 0.04, 5, col, false, true); g.in(M(0, h + 0.04, 0), () => g.add(new THREE.OctahedronGeometry(0.02, 0), col)); });
    g.tube([P(a0, 0.03), P((a0 + a1) / 2, h * 0.52), P(a1, h - 0.01)], 0.006, 4, col, false);
    g.tube([P(a1, 0.03), P((a0 + a1) / 2, h * 0.52), P(a0, h - 0.01)], 0.006, 4, col, false);
  }
}

// ---------------------------------------------------------------------------------------------------
// Aethel: ivory tower, 3 x 3
// ---------------------------------------------------------------------------------------------------
function aethelIvoryTower(g) {
  const IV = 0xf2ead8, ivory = rgb(IV), st = palStone(shades(IV, [1, 1, 0.95, 1.03, 0.9, 0.98]), 700, { mortar: mul(ivory, 0.5), var: 0.04, chip: 0.03 });
  const iv = (x, y, z) => mul(ivory, 0.9 + 0.16 * noise3(x * 3, y * 3, z * 3)), SKY = [0x7fb4e4, 0x6aa2dc, 0x94c4ec, 0x5c94d0, 0x88b8ea].map((h) => rgb(h)), GLASS = [rgb(0x3f9cff), rgb(0x6fc0ff), rgb(0x2f7ae0), rgb(0x9fd8ff)];
  const Rs = (y) => lerp(0.62, 0.42, clamp((y - 2.4) / 4.6, 0, 1)), GW = { frame: mul(ivory, 1.02), glow: 1.1, nx: 2, pal: GLASS, mould: 0.02 };
  // stepped base, cella, colonnade
  g.surf(K_STONE, 0.9);
  g.lathe([[1.44, -0.1], [1.44, 0.12], [1.31, 0.12], [1.31, 0.24], [1.18, 0.24], [1.18, 0.36], [0, 0.36]], nq(40), iv);
  drum(g, 0.72, 0.36, 1.5, st, 710);
  g.in(M(0, 0.36, 0.72), () => { glassWindow(g, 0.42, 1.1, 712, { ...GW, nx: 3, mould: 0.03 }); g.surf(K_PLAIN, 0.25, 0.92); for (const e of [-1, 1]) g.in(M(e * 0.3, 0, 0.03), () => g.cyl(0.02, 0.014, 1.15, 6, SILVER, false, true)); });
  for (let i = 1; i < 4; i++) g.in(RY(i * 90).multiply(M(0, 0.86, 0.72)), () => glassWindow(g, 0.2, 0.7, 713 + i, GW));
  for (let i = 0; i < 10; i++) { const a = ((i + 0.5) / 10) * TAU; g.in(M(Math.sin(a) * 1.03, 0.36, Math.cos(a) * 1.03), () => column(g, 0.07, 1.5, mul(ivory, 1.03), i, nq(10))); }
  g.surf(K_STONE, 0.9);
  g.lathe([[0.7, 1.84], [1.13, 1.84], [1.13, 1.9], [1.17, 1.93], [1.17, 2.0], [1.21, 2.05], [1.21, 2.09], [0.66, 2.09]], nq(40), iv);
  g.in(M(0, 2.09, 0), () => { g.surf(K_ROOF, 0.6); tiles(g, 3, (j) => 44 - j * 8, (u, v) => { const a = u * TAU, q = lerp(1.22, 0.64, v); return [Math.cos(a) * q, v * 0.4, Math.sin(a) * q]; }, { pal: SKY, lift: 0.02, wrap: true, seed: 715, round: true }); });
  g.surf(K_STONE, 0.9);
  g.lathe([[0.66, 2.4], [0.7, 2.46], [0.7, 2.52], [0.64, 2.56]], nq(32), iv);
  // the fluted shaft
  g.sheet(nq(80), nq(24), (u, v) => { const a = u * TAU, y = 2.5 + v * 4.3, R = Rs(y) * (1 + 0.03 * Math.cos(16 * a)); return [Math.cos(a) * R, y, Math.sin(a) * R]; }, (x, y, z) => mul(ivory, (0.93 + 0.1 * Math.cos(16 * Math.atan2(z, x))) * (0.97 + 0.08 * noise3(x * 4, y * 2, z * 4))), true);
  g.surf(K_PLAIN, 0.25, 0.92);
  for (const y of [3.2, 5.05, 6.55]) g.in(M(0, y, 0), () => g.lathe([[Rs(y) + 0.005, -0.05], [Rs(y) + 0.03, -0.02], [Rs(y) + 0.03, 0.02], [Rs(y) + 0.005, 0.05]], nq(28), SILVER));
  for (let i = 0; i < 4; i++) g.in(RY(i * 90 + 45).multiply(M(0, 2.75, Rs(2.9) + 0.02)), () => glassWindow(g, 0.14, 0.5, 720 + i, { ...GW, nx: 1 }));
  // balconies of silver filigree, a door of light onto each
  const balcony = (y, Ro, seed, turn) => {
    const R0 = Rs(y);
    g.surf(K_STONE, 0.9);
    g.lathe([[R0 - 0.02, y - 0.3], [R0 + 0.06, y - 0.22], [Ro - 0.12, y - 0.07], [Ro, y - 0.05], [Ro + 0.02, y - 0.02], [Ro, y], [R0, y]], nq(36), iv);
    for (let i = 0; i < 8; i++) g.in(RY(i * 45).multiply(M(0, y - 0.3, R0 + 0.02)), () => g.tube([[0, 0, 0], [0, 0.04, (Ro - R0) * 0.45], [0, 0.2, Ro - R0 - 0.08]], [0.03, 0.04, 0.025], 5, mul(ivory, 0.92), true));
    g.in(M(0, y, 0), () => filigree(g, Ro - 0.03, 0.3, SILVER, nq(20)));
    for (let i = 0; i < 4; i++) g.in(RY(i * 90 + turn).multiply(M(0, y + 0.02, Rs(y + 0.3) + 0.02)), () => glassWindow(g, 0.24, 0.72, seed + i, GW));
  };
  balcony(3.7, 0.98, 730, 0); balcony(5.5, 0.86, 740, 45);
  // gallery and the pale spire, a crystal burning at its tip
  g.surf(K_STONE, 0.9);
  g.lathe([[0.43, 6.7], [0.46, 6.8], [0.6, 6.98], [0.68, 7.04], [0.68, 7.1], [0.4, 7.1]], nq(32), iv);
  g.in(M(0, 7.1, 0), () => filigree(g, 0.66, 0.2, SILVER, nq(16)));
  g.surf(K_STONE, 0.9);
  g.lathe([[0.45, 7.1], [0.45, 7.42], [0.56, 7.5], [0.56, 7.55]], nq(24), iv);
  for (let i = 0; i < 8; i++) g.in(RY(i * 45).multiply(M(0, 7.14, 0.455)), () => { g.surf(K_PLAIN, 0.3, 0.1, 1.1); g.flat([[-0.06, 0, 0], [0.06, 0, 0], [0.06, 0.16, 0], [0, 0.24, 0], [-0.06, 0.16, 0]], GLASS[i % 4]); });
  g.in(M(0, 7.53, 0), () => {
    coneRoof(g, 0.62, 2.5, SKY, 750, { bell: 0.35, tw: 0.12 });
    g.surf(K_PLAIN, 0.25, 0.92);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, pts = []; for (let k = 0; k <= 6; k++) { const v = k / 6, q = 0.62 * (1 - v * 0.94) * (1 + 0.35 * (1 - v) * (1 - v)) + 0.02; pts.push([Math.cos(a) * q, v * 2.35 + 0.01, Math.sin(a) * q]); } g.tube(pts, 0.014, 4, SILVER, false); g.in(M(Math.cos(a) * 0.84, 0, Math.sin(a) * 0.84), () => g.add(new THREE.OctahedronGeometry(0.035, 0).scale(1, 2, 1), SILVER)); }
    g.in(M(0, 2.3, 0), () => {
      g.lathe([[0.06, 0], [0.04, 0.1], [0.07, 0.16], [0.03, 0.22]], 8, SILVER);
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; g.tube(curvePts([[Math.cos(a) * 0.03, 0.2, Math.sin(a) * 0.03], [Math.cos(a) * 0.2, 0.36, Math.sin(a) * 0.2], [Math.cos(a) * 0.19, 0.6, Math.sin(a) * 0.19], [Math.cos(a) * 0.06, 0.82, Math.sin(a) * 0.06]], 8), 0.012, 4, SILVER, true); }
      g.in(M(0, 0.26, 0), () => gem(g, 0.13, 0.5, rgb(0x2a6ae0), rgb(0xbfeaff), 1.7, 6, 0.3));
      motes(g, [[0.3, 0.6, 0.1], [-0.26, 0.4, 0.2], [0.1, 0.95, -0.25], [-0.15, 0.8, -0.2, 0.7], [0.22, 0.2, -0.3, 0.7]], 0.022, rgb(0xbfeaff), 1.8);
    });
  });
}

// ---------------------------------------------------------------------------------------------------
// Aethel: crystal waystone, 1 x 1
// ---------------------------------------------------------------------------------------------------
function aethelWaystone(g) {
  const marble = rgb(0xe6e4dc), CY = [0.1, 0.5, 1.0], rad = (y) => lerp(0.2, 0.12, clamp((y - 0.3) / 1.95, 0, 1)), pw = 2 + 0.55 * 8;
  const sup = (a) => Math.pow(Math.pow(Math.abs(Math.cos(a)), pw) + Math.pow(Math.abs(Math.sin(a)), pw), -1 / pw);
  g.surf(K_STONE, 0.85);
  g.lathe([[0.47, -0.08], [0.47, 0.1], [0.4, 0.1], [0.4, 0.2], [0.32, 0.2], [0.32, 0.3], [0, 0.3]], nq(28), (x, y, z) => mul(marble, 0.72 + 0.22 * noise3(x * 8, y * 8, z * 8)));
  for (let i = 0; i < 8; i++) g.in(RY(i * 45).multiply(M(0, 0.15, 0.4)), () => rune(g, 760 + i, 0.09, [0.1, 0.12, 0.14], 0));
  // the monolith: polished marble, knotwork cut into every face
  g.surf(K_STONE, 0.45);
  limb(g, [[0, 0.3, 0], [0, 1.25, 0], [0, 2.25, 0]], [0.2, 0.16, 0.12], { sq: 0.55, nu: nq(48), nv: nq(64), col: (x, y, z) => {
    const a = Math.atan2(z, x), k = Math.sin(y * 16 + 5 * Math.sin(a * 4)) * Math.sin(a * 4 + Math.PI / 2), cut = smooth(0.55, 0.8, Math.abs(k)) * smooth(0.5, 0.2, Math.abs(Math.cos(a * 2)));
    return mul(mix(marble, mul(marble, 0.45), cut * 0.8), 0.9 + 0.16 * noise3(x * 5, y * 2, z * 5));
  } });
  g.surf(K_PLAIN, 0.22, 0.92, 0.25);
  for (const ph of [0, Math.PI]) { const pts = []; for (let i = 0; i <= 70; i++) { const t = i / 70, a = t * TAU * 2.25 + ph + 0.4, y = 0.36 + t * 1.84, R = rad(y) * sup(a) + 0.008; pts.push([Math.cos(a) * R, y, Math.sin(a) * R]); } g.tube(pts, 0.017, 5, (x, y, z) => mix(SILVER, CY, 0.25 + 0.2 * Math.sin(y * 30)), true); }
  for (let i = 0; i < 4; i++) for (const [y, s] of [[0.72, 0.2], [1.3, 0.17], [1.85, 0.13]]) g.in(RY(i * 90).multiply(M(0, y, rad(y) + 0.004)), () => rune(g, 770 + i * 5 + Math.round(y * 9), s, CY, 1.7, 0.13));
  // silver crown and the crystal that floats over it
  g.surf(K_PLAIN, 0.22, 0.92);
  g.lathe([[0.125, 2.2], [0.16, 2.25], [0.13, 2.31], [0.05, 2.35]], nq(16), SILVER);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Math.PI / 4; g.tube(curvePts([[Math.cos(a) * 0.1, 2.3, Math.sin(a) * 0.1], [Math.cos(a) * 0.25, 2.42, Math.sin(a) * 0.25], [Math.cos(a) * 0.27, 2.66, Math.sin(a) * 0.27], [Math.cos(a) * 0.2, 2.86, Math.sin(a) * 0.2]], 10), [0.022, 0.02, 0.018, 0.016, 0.014, 0.012, 0.01, 0.009, 0.008, 0.006, 0.003], 5, SILVER, true); }
  g.in(M(0, 2.5, 0), () => gem(g, 0.15, 0.62, rgb(0x1f6ae0), rgb(0xbfeeff), 1.7, 6, 0.2));
  g.in(M(0, 2.82, 0, 18, 0, 10), () => { g.surf(K_PLAIN, 0.22, 0.92, 0.3); g.add(new THREE.TorusGeometry(0.3, 0.008, 4, nq(36)).rotateX(Math.PI / 2), SILVER); });
  for (const [a, y, s] of [[0.5, 2.75, 0.5], [2.4, 3.0, 0.4], [4.4, 2.6, 0.45], [5.6, 3.08, 0.3]]) g.in(M(Math.cos(a) * 0.3, y, Math.sin(a) * 0.3, 20 * Math.sin(a * 3), a * 57, 15), () => gem(g, 0.07 * s, 0.3 * s, rgb(0x1f6ae0), rgb(0xbfeeff), 1.6, 4, a));
  motes(g, [[0.25, 1.4, 0.3], [-0.33, 1.9, 0.1, 0.8], [0.1, 2.3, -0.36], [-0.2, 0.9, -0.33, 0.8], [0.36, 2.2, -0.1, 0.7], [-0.1, 3.25, 0.12, 0.7]], 0.018, rgb(0xbfeeff), 1.8);
  // shards sprouting at its foot, grass
  for (const [a, d, s, t] of [[0.3, 0.36, 1, 20], [1.9, 0.38, 0.7, 28], [3.4, 0.36, 0.9, 22], [4.9, 0.39, 0.6, 30], [5.6, 0.4, 0.5, 34]]) g.in(M(Math.cos(a) * d, 0.06, Math.sin(a) * d, t * Math.sin(a), 0, -t * Math.cos(a)), () => gem(g, 0.045 * s, 0.3 * s, rgb(0x1f6ae0), rgb(0xbfeeff), 1.3, 5, a));
  for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.6; g.in(M(Math.cos(a) * 0.44, 0, Math.sin(a) * 0.44), () => tuft(g, 7, 0.14, 780 + i)); }
}

// ---------------------------------------------------------------------------------------------------
// Kael'neth: sacrificial ziggurat, 5 x 5
// ---------------------------------------------------------------------------------------------------
const OBSIDIAN = [0x2b2638, 0x322a40, 0x221f2e, 0x3a2f46, 0x27232f, 0x33263a].map((h) => rgb(h)), DARK_IRON = [0.05, 0.05, 0.06], CRIMSON = [0.85, 0.03, 0.04];
/** a four-sided spike standing on the local origin */
function spike(g, h, w = 0.1, col = DARK_IRON) { g.lathe([[w * 0.9, 0], [w * 1.15, h * 0.1], [w * 0.5, h * 0.2], [w * 0.62, h * 0.26], [0, h]], 4, col, Math.PI / 4, TAU + Math.PI / 4); }
function kaelnethBloodZiggurat(g) {
  const st = palStone(OBSIDIAN, 800, { len: [0.5, 0.9], var: 0.12, chip: 0.1, mortar: [0.01, 0.008, 0.014], r: 0.014 }), fin = { kind: K_PLAIN, rough: 0.3, metal: 0.3 };
  const T = [[2.05, 0, 1.0], [1.65, 1.0, 2.0], [1.25, 2.0, 3.0], [0.95, 3.0, 3.75]], topY = 3.75, sz0 = 2.46, sz1 = 0.93, sw = 0.46;
  const obs = (x, y, z) => mul(OBSIDIAN[0], 0.7 + 0.6 * noise3(x * 3, y * 3, z * 3));
  T.forEach(([hx, y0, y1], i) => {
    blockBox(g, hx, hx, y0, y1, st, 810 + i * 30, { ...fin, topCol: mul(OBSIDIAN[0], 1.1) });
    faces4(g, hx, hx, (s, W) => {
      // a lip of polished stone, a thread of blood-light under it, runes either side of the stair
      g.surf(K_PLAIN, 0.3, 0.3); g.in(M(0, y1 - 0.045, 0.02), () => g.cbox(2 * W + 0.04, 0.09, 0.06, 0.012, obs));
      g.surf(K_PLAIN, 0.5, 0, 1.3); g.in(M(0, y1 - 0.125, 0.012), () => g.cbox(2 * W - 0.02, 0.03, 0.02, 0.004, CRIMSON));
      if (i < 3) for (const e of [-1, 1]) for (let k = 0; k < (i === 0 ? 2 : 1); k++) g.in(M(e * (0.95 + k * 0.6 - i * 0.12), (y0 + y1) / 2 - 0.05, 0.02), () => rune(g, 820 + i * 9 + s * 3 + e + k, 0.42, CRIMSON, 1.3, 0.12));
      g.surf(K_PLAIN, 0.4, 0.8);
      for (const e of [-1, 1]) g.in(M(e * (W - 0.1), y1, -0.1), () => spike(g, 0.85 - i * 0.08, 0.085));
    });
  });
  // a steep stair up every side between spiked cheeks; down the front one the blood runs
  faces4(g, 0, 0, (s) => {
    g.surf(K_PLAIN, 0.35, 0.25);
    flight(g, 2 * sw, sz0, 0, sz1, topY, 25, (x, y, z) => mul(OBSIDIAN[3], 0.8 + 0.5 * noise3(x * 5, y * 9, z * 5)), 0, 0.5);
    for (const e of [-1, 1]) {
      wedge(g, e * sw, e * (sw + 0.2), sz0 + 0.02, 0.22, sz1, topY + 0.2, 0, mul(OBSIDIAN[1], 1.1), 0.6);
      g.surf(K_PLAIN, 0.4, 0.8);
      for (let k = 0; k < 5; k++) { const t = (k + 0.5) / 5; g.in(M(e * (sw + 0.1), lerp(0.22, topY + 0.2, t) - 0.02, lerp(sz0, sz1, t)), () => spike(g, 0.42, 0.055)); }
      g.surf(K_PLAIN, 0.35, 0.25);
    }
    const n = 25, dz = (sz1 - sz0) / n, dy = topY / n, wd = s === 0 ? 0.09 : 0.05, c = s === 0 ? CRIMSON : [0.2, 0.012, 0.016];
    g.surf(K_PLAIN, 0.25, 0.1, s === 0 ? 1.1 : 0);
    for (let k = 0; k < n; k++) { const z = sz0 + k * dz, y = k * dy; g.flat([[-wd, y, z + 0.006], [wd, y, z + 0.006], [wd, y + dy, z + 0.006], [-wd, y + dy, z + 0.006]], c); g.flat([[-wd, y + dy + 0.004, z], [wd, y + dy + 0.004, z], [wd, y + dy + 0.004, z + dz], [-wd, y + dy + 0.004, z + dz]], c); }
  });
  g.surf(K_PLAIN, 0.2, 0.1, 0.8);
  g.in(M(0, 0.012, sz0 - 0.02), () => g.sheet(nq(14), 2, (u, v) => { const a = u * TAU, k = 0.8 + 0.4 * noise3(Math.cos(a) * 2, 3, Math.sin(a) * 2); return [Math.cos(a) * 0.3 * v * k, 0, Math.min(0.03, Math.sin(a) * 0.14 * v * k)]; }, CRIMSON, true));
  // the altar, four fire bowls, the horns of the temple and their chains
  g.in(M(0, topY, 0), () => {
    g.surf(K_PLAIN, 0.3, 0.3);
    g.in(M(0, 0.07, 0.05), () => g.cbox(1.0, 0.14, 0.7, 0.02, obs));
    g.in(M(0, 0.3, 0.05), () => g.cbox(0.8, 0.32, 0.44, 0.03, obs));
    g.in(M(0, 0.49, 0.05), () => g.cbox(0.9, 0.07, 0.52, 0.02, obs));
    g.surf(K_PLAIN, 0.2, 0.1, 0.7);
    g.in(M(0, 0.527, 0.05), () => g.sheet(nq(12), 2, (u, v) => { const a = u * TAU, k = 0.7 + 0.6 * noise3(Math.cos(a) * 2, 7, Math.sin(a) * 2); return [Math.cos(a) * 0.36 * v * k, 0, Math.sin(a) * 0.2 * v * k]; }, CRIMSON, true));
    g.flat([[-0.07, 0.527, 0.2], [0.07, 0.527, 0.2], [0.07, 0.527, 0.312], [-0.07, 0.527, 0.312]], CRIMSON); g.flat([[-0.07, 0.527, 0.312], [0.07, 0.527, 0.312], [0.09, 0.0, 0.33], [-0.09, 0.0, 0.33]], CRIMSON);
    g.flat([[-0.09, 0.004, 0.33], [0.09, 0.004, 0.33], [0.09, 0.004, sz1], [-0.09, 0.004, sz1]], CRIMSON);
    g.in(M(0.2, 0.527, 0.0, 0, 30, 0), () => skull(g, 0.9));
    g.surf(K_PLAIN, 0.3, 0.9); g.in(M(-0.2, 0.545, 0.08, 0, 40, 0), () => { g.cbox(0.3, 0.012, 0.04, 0.004, [0.5, 0.5, 0.55]); g.in(M(-0.2, 0, 0), () => g.cbox(0.12, 0.022, 0.03, 0.006, DARK_IRON)); });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * 0.68, 0, sz * 0.68), () => brazier(g, 0.62, FIRE_BLOOD, DARK_IRON, sx + sz * 2));
    for (const e of [-1, 1]) {
      g.surf(K_PLAIN, 0.28, 0.35);
      limb(g, [[e * 0.6, -0.1, -0.5], [e * 0.86, 1.0, -0.56], [e * 0.66, 2.0, -0.52], [e * 0.16, 2.7, -0.46]], [0.2, 0.16, 0.1, 0.012], { facets: 4, nu: 8, nv: nq(22), col: (x, y, z) => mul(OBSIDIAN[3], 0.7 + 0.8 * noise3(x * 4, y * 4, z * 4)) });
      g.surf(K_PLAIN, 0.4, 0.8);
      for (const [y, k] of [[0.7, 0.86], [1.4, 0.92], [2.0, 0.8]]) g.in(M(e * (k + 0.05), y, -0.54, 0, 0, -e * 70), () => spike(g, 0.3, 0.05));
      swag(g, [e * 0.3, 2.56, -0.46], [e * 0.68, 0.72, 0.6], 0.35, 0.05, DARK_IRON, 10);
      swag(g, [e * 0.72, 1.7, -0.52], [e * 0.7, 0.72, -0.62], 0.1, 0.045, DARK_IRON, 5);
    }
    swag(g, [-0.3, 2.56, -0.46], [0.3, 2.56, -0.46], 0.3, 0.05, DARK_IRON, 8);
    g.in(M(0, 2.1, -0.46), () => { g.surf(K_PLAIN, 0.4, 0.8); g.tube(curvePts([[0, 0.17, 0], [0, 0, 0], [0.06, -0.08, 0], [0.1, -0.02, 0]], 6), 0.012, 4, DARK_IRON, true); });
  });
  // spiked pylons at the corners of the precinct
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * 2.22, 0, sz * 2.22), () => {
    blockBox(g, 0.2, 0.2, 0, 1.25, st, 880 + sx + sz * 2, { ...fin, topCol: OBSIDIAN[0] });
    g.surf(K_PLAIN, 0.4, 0.8); g.in(M(0, 1.25, 0), () => spike(g, 1.0, 0.13));
    for (let s = 0; s < 4; s++) g.in(RY(s * 90).multiply(M(0, 0.7, 0.206)), () => rune(g, 890 + s + sx * 3 + sz, 0.36, CRIMSON, 1.3, 0.12));
  });
}

// ---------------------------------------------------------------------------------------------------
// Kael'neth: spiked iron watchtower, 2 x 2
// ---------------------------------------------------------------------------------------------------
function cage(g, r, h, col = DARK_IRON) {
  g.surf(K_PLAIN, 0.5, 0.85);
  for (const y of [0, -h]) g.in(M(0, y, 0), () => g.add(new THREE.TorusGeometry(r * 0.6, 0.012, 4, nq(12)).rotateX(Math.PI / 2), col));
  g.in(M(0, -h * 0.5, 0), () => g.add(new THREE.TorusGeometry(r, 0.012, 4, nq(14)).rotateX(Math.PI / 2), col));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, c = Math.cos(a), s = Math.sin(a); g.tube([[c * r * 0.6, 0, s * r * 0.6], [c * r * 0.95, -h * 0.25, s * r * 0.95], [c * r, -h * 0.5, s * r], [c * r * 0.95, -h * 0.75, s * r * 0.95], [c * r * 0.6, -h, s * r * 0.6]], 0.008, 4, col, false); }
  g.in(M(0, -h, 0), () => g.cyl(r * 0.6, r * 0.6, 0.012, 8, col, true, true));
  g.in(M(0, 0, 0), () => g.lathe([[r * 0.6, 0], [0.02, 0.1]], 8, col));
}
function kaelnethSpikeTower(g) {
  const iron = (k = 1) => (x, y, z) => mul(DARK_IRON, k * (0.6 + 0.9 * noise3(x * 5, y * 5, z * 5))), y0 = 0.45, y1 = 4.7, N = 8, rows = 9, rad = (y) => lerp(0.72, 0.5, Math.pow(clamp((y - y0) / (y1 - y0), 0, 1), 0.8));
  const SIDE = Math.tan(Math.PI / N);
  // footing of black rock, the plated shaft
  g.surf(K_STONE, 0.9);
  g.lathe([[0.97, -0.1], [0.95, 0.16], [0.84, 0.3], [0.8, 0.46], [0, 0.46]], N, rockCol(mul(OBSIDIAN[0], 0.8), 3, 0, 8), Math.PI / N, TAU + Math.PI / N);
  g.surf(K_PLAIN, 0.6, 0.6);
  g.lathe([[rad(y0) - 0.012, y0], [rad(y1) - 0.012, y1]], N, [0.012, 0.012, 0.016], Math.PI / N, TAU + Math.PI / N);
  for (let j = 0; j < rows; j++) for (let i = 0; i < N; i++) {
    const ya = lerp(y0, y1, j / rows), yb = lerp(y0, y1, (j + 1) / rows), ra = rad(ya), rb = rad(yb), wa = ra * SIDE, wb = rb * SIDE, e = 0.016, k = 0.75 + 0.5 * hash1(i, j, 5);
    g.in(RY(i * 45), () => {
      g.surf(K_PLAIN, 0.42, 0.8);
      const c = (x, y, z) => mul(DARK_IRON, k * (0.7 + 0.7 * noise3(x * 9 + i, y * 9, j)));
      const q = [[-wa + e, ya + e, ra], [wa - e, ya + e, ra], [wb - e, yb - e, rb], [-wb + e, yb - e, rb]];
      g.poly(q, 0, 0.05, 1, c);
      for (let m = 0; m < 4; m++) { const a = q[m], b = q[(m + 1) % 4]; g.flat([a, b, [b[0] * 1.02, b[1], b[2] - 0.012], [a[0] * 1.02, a[1], a[2] - 0.012]], mul(DARK_IRON, 0.45)); }
      const slit = i % 2 === 0 && (j === 2 || j === 4 || j === 6) && !(i === 0 && j < 3);
      if (slit) {
        const ym = (ya + yb) / 2, rm = (ra + rb) / 2 + 0.004;
        g.surf(K_PLAIN, 0.5, 0, 1.5); g.flat([[-0.035, ym - 0.15, rm], [0.035, ym - 0.15, rm], [0.035, ym + 0.12, rm], [0, ym + 0.19, rm], [-0.035, ym + 0.12, rm]], [0.9, 0.04, 0.02]);
        g.surf(K_PLAIN, 0.42, 0.8); for (const ex of [-1, 1]) g.in(M(ex * 0.055, ym, rm), () => g.cbox(0.025, 0.4, 0.03, 0.006, iron(0.8)));
      } else for (const [fx, fy] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) g.in(M(fx * (lerp(wa, wb, fy) - 0.05), lerp(ya + 0.05, yb - 0.05, fy), lerp(ra, rb, fy)), () => g.stud(0.016, mul(DARK_IRON, 1.5), 5));
    });
  }
  g.surf(K_PLAIN, 0.42, 0.8);
  for (const y of [1.87, 3.28]) g.in(M(0, y, 0), () => g.lathe([[rad(y) + 0.005, -0.05], [rad(y) + 0.035, -0.02], [rad(y) + 0.035, 0.02], [rad(y) + 0.005, 0.05]], N, iron(1.2), Math.PI / N, TAU + Math.PI / N));
  // the door: a tall slit of red light behind bars
  g.in(M(0, y0, rad(y0) + 0.01), () => {
    g.surf(K_PLAIN, 0.42, 0.8);
    plate(g, [[-0.26, 0], [0.26, 0], [0.26, 0.74], [0.14, 1.0], [0, 1.2], [-0.14, 1.0], [-0.26, 0.74]], 0.06, mul(DARK_IRON, 1.3));
    g.surf(K_PLAIN, 0.5, 0, 1.4);
    g.flat([[-0.15, 0.03, 0.034], [0.15, 0.03, 0.034], [0.15, 0.68, 0.034], [0, 0.98, 0.034], [-0.15, 0.68, 0.034]], [[0.85, 0.04, 0.02], [0.85, 0.04, 0.02], [0.4, 0.01, 0.01], [0.2, 0.005, 0.005], [0.4, 0.01, 0.01]]);
    g.surf(K_PLAIN, 0.42, 0.8);
    for (const x of [-0.075, 0, 0.075]) g.in(M(x, 0.42, 0.045), () => g.cbox(0.02, 0.84, 0.02, 0.004, DARK_IRON));
    for (const y of [0.25, 0.55]) g.in(M(0, y, 0.045), () => g.cbox(0.3, 0.02, 0.02, 0.004, DARK_IRON));
    g.in(M(0, 1.2, 0.02), () => spike(g, 0.34, 0.045));
  });
  // bladed fins bracing the foot
  for (let i = 0; i < 4; i++) g.in(RY(i * 90 + 45).multiply(M(0, 0, 0, 0, -90, 0)), () => {
    g.surf(K_PLAIN, 0.42, 0.8);
    plate(g, [[0.6, 0.1], [0.98, 0.1], [0.94, 0.5], [1.0, 0.62], [0.86, 0.95], [0.92, 1.1], [0.78, 1.5], [0.8, 1.72], [0.66, 2.3], [0.6, 2.9]], 0.05, mul(DARK_IRON, 1.2), mul(DARK_IRON, 2.2));
  });
  // crown: a ring of blades, the spire and its pennant
  g.surf(K_PLAIN, 0.42, 0.8);
  g.lathe([[0.5, y1 - 0.12], [0.8, y1 + 0.05], [0.87, y1 + 0.14], [0.87, y1 + 0.26], [0.62, y1 + 0.26]], N, iron(1.1), Math.PI / N, TAU + Math.PI / N);
  g.surf(K_PLAIN, 0.5, 0, 1.3); g.lathe([[0.875, y1 + 0.17], [0.875, y1 + 0.21]], N, [0.9, 0.04, 0.02], Math.PI / N, TAU + Math.PI / N);
  for (let i = 0; i < N; i++) g.in(RY(i * 45).multiply(M(0, y1 + 0.22, 0.8, 14, 0, 0)), () => {
    g.surf(K_PLAIN, 0.42, 0.8);
    const s = i % 2 ? 0.72 : 1;
    plate(g, [[-0.15, 0], [0.15, 0], [0.11, 0.5 * s], [0.18, 0.62 * s], [0.05, 1.25 * s], [0, 1.8 * s], [-0.05, 1.25 * s], [-0.18, 0.62 * s], [-0.11, 0.5 * s]], 0.045, mul(DARK_IRON, 1.15), mul(DARK_IRON, 2.4));
  });
  g.in(M(0, y1 + 0.26, 0), () => {
    g.surf(K_PLAIN, 0.42, 0.8);
    g.lathe([[0.5, 0], [0.42, 0.12], [0.3, 0.6], [0.34, 0.66], [0.26, 0.74], [0.12, 1.5], [0.02, 2.75]], N, iron(1), Math.PI / N, TAU + Math.PI / N);
    for (let i = 0; i < 4; i++) g.in(RY(i * 90 + 22.5).multiply(M(0, 0.7, 0.28, 60, 0, 0)), () => spike(g, 0.5, 0.05));
    g.in(M(0, 2.6, 0), () => flagPole(g, 0.95, 0.8, 0.34, [0.6, 0.02, 0.04], [0.06, 0.02, 0.03], DARK_IRON));
  });
  // gibbet arms with their cages
  [[60, 0.9, 1], [185, 1.15, 0], [300, 0.7, 0]].forEach(([deg, drop, bones], i) => g.in(RY(deg), () => {
    g.surf(K_PLAIN, 0.42, 0.8);
    g.beamTo([0, 4.25, 0.5], [0, 4.4, 1.0], 0.05, 0.05, 0.01, DARK_IRON, 1);
    g.beamTo([0, 3.85, 0.52], [0, 4.33, 0.86], 0.035, 0.035, 0.008, DARK_IRON, 1);
    chain(g, [[0, 4.38, 0.96], [0, 4.38 - drop, 0.96]], 0.045, DARK_IRON);
    g.in(M(0, 4.3 - drop, 0.96), () => { cage(g, 0.17, 0.5); if (bones) g.in(M(0, -0.49, 0, 0, 40, 0), () => skull(g, 0.75)); });
  }));
}

// ---------------------------------------------------------------------------------------------------
// The Verdant: tree-palace, 5 x 5
// ---------------------------------------------------------------------------------------------------
const AMBER = [1.0, 0.52, 0.08];
/** a gourd of glowing sap hanging from the local origin, about 1.25 s to its foot */
function gourd(g, s, glow = 1.5, seed = 0) {
  g.surf(K_CLOTH, 0.9); g.in(M(0, -0.27 * s, 0), () => g.cyl(0.012 * s + 0.003, 0.012 * s + 0.003, 0.27 * s, 4, [0.12, 0.16, 0.05]));
  g.surf(K_PLAIN, 0.5, 0, glow);
  g.in(M(0, -1.25 * s, 0), () => g.lathe([[0.02, 0], [0.2, 0.08], [0.33, 0.3], [0.3, 0.55], [0.16, 0.78], [0.09, 0.92], [0.07, 1.0]].map(([r, y]) => [r * s, y * s]), nq(12), (x, y, z) => { const t = y / s; return Math.abs(Math.sin(Math.atan2(z, x) * 4 + seed)) < 0.2 ? [0.75, 0.26, 0.03] : mix([1.0, 0.42, 0.05], [1.0, 0.66, 0.2], smooth(0.1, 0.45, t) * smooth(0.9, 0.5, t)); }));
  g.surf(K_WOOD, 0.9);
  g.in(M(0, -0.29 * s, 0), () => g.lathe([[0.1, -0.03], [0.09, 0.02], [0.03, 0.06]].map(([r, y]) => [r * s, y * s]), 8, [0.16, 0.11, 0.06]));
}
/** a round window grown into bark: amber light behind a twig lattice; local +Z out */
function knotWindow(g, r, seed = 0) {
  g.surf(K_PLAIN, 0.4, 0, 1.2);
  const n = nq(14), ce = [0, 0, 0.02];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, b = ((i + 1) / n) * TAU; g.flat([ce, [Math.cos(a) * r, Math.sin(a) * r, 0.02], [Math.cos(b) * r, Math.sin(b) * r, 0.02]], [[1.0, 0.68, 0.22], [1.0, 0.42, 0.06], [1.0, 0.42, 0.06]]); }
  g.surf(K_WOOD, 0.9);
  g.add(new THREE.TorusGeometry(r * 1.08, r * 0.3, 6, nq(16)), barkCol(rgb(0x6a5236), seed));
  g.tube([[-r, 0.02 * r, 0.04], [0, -0.06 * r, 0.06], [r, 0.03 * r, 0.04]], r * 0.07, 4, [0.1, 0.07, 0.04], false);
  g.tube([[0.05 * r, -r, 0.04], [-0.05 * r, 0, 0.06], [0.04 * r, r, 0.04]], r * 0.07, 4, [0.1, 0.07, 0.04], false);
}
/** a hanging bridge of planks between a and b with rope rails */
function ropeBridge(g, a, b, sag, wide, wood, seed = 0) {
  const n = Math.max(4, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.13)), dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, sx = -dz / l, sz = dx / l, yaw = Math.atan2(-dz, dx) / DEG;
  const P = (t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t)];
  g.surf(K_WOOD, 0.9);
  for (let i = 0; i < n; i++) { const p = P((i + 0.5) / n); g.in(M(p[0], p[1], p[2], 0, yaw, 0), () => g.cbox(0.1, 0.025, wide, 0.006, woodTint(mul(wood, 0.8 + 0.4 * hash1(i, seed)), i + seed))); }
  for (const e of [-1, 1]) {
    const lo = [], hi = [];
    for (let i = 0; i <= n; i += 1) { const p = P(i / n); lo.push([p[0] + sx * e * wide * 0.5, p[1] - 0.01, p[2] + sz * e * wide * 0.5]); hi.push([p[0] + sx * e * wide * 0.56, p[1] + 0.34 + 0.06 * Math.cos((i / n) * TAU), p[2] + sz * e * wide * 0.56]); }
    rope(g, lo, 0.014, rgb(0xa08a58), 5); rope(g, hi, 0.014, rgb(0xa08a58), 5);
    for (let i = 0; i <= n; i += 3) rope(g, [lo[i], hi[i]], 0.008, rgb(0x8a7648), 4);
  }
}
function verdantTreePalace(g) {
  const bark = rgb(0x86683f), leaf = rgb(0x3f7a2e), wood = rgb(0x7a5c3a), HT = 4.3, FR = Math.PI / 2;
  const doorW = (a) => { const d = Math.abs(((a - FR + Math.PI * 3) % TAU) - Math.PI); return smooth(0.62, 0.22, d); };
  const Rt = (a, y) => {
    const aa = a + y * 0.1, fl = Math.exp(-y * 1.5) * (1 - 0.8 * doorW(a));
    return (1.25 + 0.65 * fl) * (1 + 0.24 * fl * Math.cos(6 * aa + 0.5 * Math.sin(2 * aa))) + 0.06 * Math.sin(20 * aa + 2 * Math.sin(y * 1.3)) + 0.12 * (fbm3(Math.cos(a) * 1.5, y * 0.7, Math.sin(a) * 1.5, 3) - 0.5) + 0.1 * smooth(3.2, HT, y);
  };
  const at = (a, y, out = 0) => { const R = Rt(a, y) + out; return [Math.cos(a) * R, y, Math.sin(a) * R]; };
  // mossy ground
  g.surf(K_PLAIN, 1);
  g.sheet(nq(40), nq(5), (u, v) => { const a = u * TAU, k = Math.pow(Math.pow(Math.abs(Math.cos(a)), 5) + Math.pow(Math.abs(Math.sin(a)), 5), -0.2); return [Math.cos(a) * 2.46 * k * v, v > 0.99 ? -0.06 : 0.1 * (1 - v * v * v) * (0.6 + 0.8 * noise3(Math.cos(a) * v * 3, 1, Math.sin(a) * v * 3)), Math.sin(a) * 2.46 * k * v]; }, (x, y, z) => mix(mul(rgb(0x4a3c28), 0.7 + 0.5 * noise3(x * 4, 1, z * 4)), rgb(0x3f6a2c), smooth(0.35, 0.6, noise3(x * 2.2, 5, z * 2.2))), true);
  // the trunk
  g.surf(K_WOOD, 0.95);
  g.sheet(nq(110), nq(46), (u, v) => { const a = u * TAU, y = v * v * 0.35 * HT + v * 0.65 * HT - 0.1; return at(a, Math.max(0, y)).map((q, i) => (i === 1 ? y : q)); }, (x, y, z, nx, ny) => {
    const a = Math.atan2(z, x), c = mul(bark, (0.55 + 0.7 * noise3(Math.cos(a) * 9, y * 1.2, Math.sin(a) * 9)) * (0.8 + 0.4 * noise3(x * 2, y * 2, z * 2)) * (0.55 + 0.5 * smooth(-0.6, 0.6, Math.sin(20 * (a + y * 0.1) + 2 * Math.sin(y * 1.3)))));
    return mix(c, [0.16, 0.26, 0.07], 0.75 * smooth(0.45, 0.7, noise3(x * 1.7 + 4, y * 1.3, z * 1.7)) * smooth(2.6, 0.2, y) + (ny > 0.35 ? 0.5 : 0));
  }, true);
  g.in(M(0, HT - 0.12, 0), () => g.add(new THREE.SphereGeometry(1.4, nq(24), nq(8), 0, TAU, 0, Math.PI / 2).scale(1, 0.5, 1), barkCol(bark, 4)));
  // five great boughs and the leader
  const BA = [54, 126, 198, 270, 342].map((d) => d * DEG), tips = [];
  BA.forEach((a, k) => {
    const c = Math.cos(a), s = Math.sin(a), w = 0.12 * Math.sin(k * 2.3), top = 6.3 + 0.35 * Math.cos(k * 1.9);
    limb(g, [[0.5 * c, 3.6, 0.5 * s], [1.1 * c - w * s, 4.7, 1.1 * s + w * c], [1.5 * c + w * s, 5.6, 1.5 * s - w * c], [1.75 * c, top, 1.75 * s]], [0.62, 0.46, 0.32, 0.14], { nu: nq(16), nv: nq(26), amp: 0.14, seed: k, col: barkCol(bark, k) });
    tips.push([1.72 * c, top, 1.72 * s]);
    limb(g, [[1.15 * c, 5.15, 1.15 * s], [1.3 * c - 0.5 * s, 5.9, 1.3 * s + 0.5 * c], [1.1 * c - 0.9 * s, 6.7, 1.1 * s + 0.9 * c]], [0.2, 0.14, 0.05], { nu: nq(8), nv: nq(10), amp: 0.12, seed: k + 9, col: barkCol(bark, k + 5) });
  });
  limb(g, [[0, 3.9, 0], [0.12, 5.4, 0.06], [-0.06, 6.6, -0.04], [0.02, 7.6, 0]], [0.8, 0.5, 0.3, 0.1], { nu: nq(16), nv: nq(24), amp: 0.14, seed: 7, col: barkCol(bark, 8) });
  // the crown
  foliage(g, 0, 8.15, 0, 1.6, 1.15, 1.6, nq(520), leaf, 900, 0.3, 5.6, 9.2);
  tips.forEach((p, k) => foliage(g, p[0] * 0.92, p[1] + 0.55, p[2] * 0.92, 1.0, 0.85, 1.0, nq(400), mul(leaf, 0.9 + 0.2 * hash1(k, 3)), 901 + k, 0.28, 5.6, 9.2));
  BA.forEach((a, k) => { const b = a + 36 * DEG; foliage(g, Math.cos(b) * 1.25, 7.45 + 0.2 * Math.sin(k * 3), Math.sin(b) * 1.25, 0.95, 0.7, 0.95, nq(260), mul(leaf, 1.08), 910 + k, 0.26, 5.6, 9.2); });
  // the door between two buttress roots
  const dz = Rt(FR, 0.7) + 0.1, A = archOf(0.34, 0.86, 0.34, 0.1);
  g.in(M(0, 0.04, dz), () => {
    g.surf(K_PLAIN, 1); for (const e of [-1, 1]) g.flat([[e * 0.5, 0, -0.5], [e * 0.5, 1.5, -0.5], [0, 1.5, -0.02], [0, 0, -0.02]], [0.02, 0.016, 0.012]);
    archDoors(g, A, rgb(0x7a5a34), 3, 0.05, 3);
    g.surf(K_PLAIN, 0.4, 0, 1.3);
    for (const e of [-1, 1]) g.in(M(e * 0.16, 0.74, 0.03), () => { const n = 8; for (let i = 0; i < n; i++) { const a = (i / n) * TAU, b = ((i + 1) / n) * TAU; g.flat([[0, 0, 0], [Math.cos(a) * 0.07, Math.sin(a) * 0.09, 0], [Math.cos(b) * 0.07, Math.sin(b) * 0.09, 0]], [[1.0, 0.66, 0.2], AMBER, AMBER]); } });
    g.surf(K_WOOD, 0.95);
    for (const e of [-1, 1]) limb(g, [[e * 0.62, -0.1, 0.16], [e * 0.5, 0.75, 0.08], [e * 0.3, 1.28, 0.06], [0, 1.5, 0.1]], [0.17, 0.12, 0.1, 0.09], { nu: nq(10), nv: nq(16), amp: 0.14, seed: e + 3, col: barkCol(mul(bark, 1.1), e + 20) });
    for (const e of [-1, 1]) g.in(M(e * 0.66, 1.42, 0.2), () => { g.surf(K_WOOD, 0.9); g.tube([[-e * 0.2, 0.1, -0.1], [0, 0.08, 0], [0, 0, 0]], 0.02, 5, mul(bark, 0.8), true); gourd(g, 0.3, 1.5, e); });
    g.surf(K_WOOD, 0.9);
    for (let k = 0; k < 2; k++) g.in(M(0, 0.0 - k * 0.05, 0.22 + k * 0.2), () => g.cbox(0.9 + k * 0.14, 0.07, 0.24, 0.02, woodTint(mul(wood, 0.8), k)));
  });
  // windows grown into the bark
  for (const [a, y, r] of [[FR - 0.72, 1.9, 0.17], [FR + 0.7, 2.5, 0.19], [FR + 0.05, 2.55, 0.22], [FR - 0.4, 3.3, 0.15], [0.15, 2.1, 0.18], [Math.PI - 0.2, 1.8, 0.17], [Math.PI + 0.5, 2.9, 0.16], [-FR, 2.3, 0.2], [-0.6, 3.1, 0.15]]) { const p = at(a, y, 0.07); g.in(M(p[0], p[1], p[2], 0, 90 - a / DEG, 0).multiply(M(0, 0, 0, -6, 0, 0)), () => knotWindow(g, r, a * 7)); }
  // shelf fungus
  g.surf(K_PLAIN, 0.8);
  for (const [a, y, s] of [[FR + 1.1, 1.0, 1], [FR + 1.2, 1.25, 0.7], [FR - 1.3, 1.6, 0.9], [2.9, 0.9, 1.1], [4.2, 1.4, 0.9], [5.6, 1.1, 1]]) { const p = at(a, y, -0.04); g.in(M(p[0], p[1], p[2], 0, 90 - a / DEG, 0), () => g.add(new THREE.SphereGeometry(0.2 * s, nq(10), 4, 0, Math.PI, 0, Math.PI / 2).rotateY(-Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.3, 1), (x, yy, z) => mix(rgb(0xc8843a), rgb(0xe8d8a8), smooth(0.1, 0.2, Math.hypot(x, z))))); }
  // the stair winding up the trunk to the great deck
  const DY = 4.42, steps = nq(30) < 30 ? 22 : 30, a0 = FR + 0.85, sweep = 4.6, rail = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps, a = a0 + t * sweep, y = 0.25 + t * (DY - 0.3), R = Rt(a, y);
    g.in(M(Math.cos(a) * (R + 0.2), y, Math.sin(a) * (R + 0.2), 0, -a / DEG, 0), () => {
      g.surf(K_WOOD, 0.9); g.cbox(0.6, 0.05, 0.3, 0.012, woodTint(mul(wood, 0.8 + 0.4 * hash1(i, 7)), i));
      g.in(M(-0.1, -0.12, 0, 0, 0, 30), () => g.cbox(0.4, 0.05, 0.06, 0.01, mul(bark, 0.8)));
      if (i % 3 === 0) g.in(M(0.26, 0, 0), () => g.cyl(0.02, 0.016, 0.46, 5, mul(bark, 0.9), false, true));
    });
    if (i % 3 === 0) rail.push([Math.cos(a) * (R + 0.46), y + 0.44, Math.sin(a) * (R + 0.46)]);
  }
  rope(g, curvePts(rail, rail.length * 3), 0.016, rgb(0xa08a58), 5);
  // the great deck round the head of the trunk
  const DR = 2.2, NB = nq(34);
  for (let i = 0; i < NB; i++) g.in(RY((i * 360) / NB).multiply(M(0, DY, (DR + 1.15) / 2)), () => { g.surf(K_WOOD, 0.9); g.cbox(((DR * TAU) / NB) * 0.8, 0.05, DR - 1.1, 0.012, woodTint(mul(wood, 0.78 + 0.44 * hash1(i, 11)), i)); });
  g.surf(K_WOOD, 0.9);
  g.in(M(0, DY - 0.05, 0), () => g.add(new THREE.TorusGeometry(DR - 0.04, 0.05, 6, nq(40)).rotateX(Math.PI / 2), barkCol(bark, 12)));
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + 0.2, c = Math.cos(a), s = Math.sin(a); limb(g, [[c * 1.2, 3.5, s * 1.2], [c * 1.75, 3.95, s * 1.75], [c * (DR - 0.15), DY - 0.06, s * (DR - 0.15)]], [0.1, 0.075, 0.06], { nu: 6, nv: nq(8), col: barkCol(bark, i) }); }
  const posts = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU, c = Math.cos(a), s = Math.sin(a); g.in(M(c * (DR - 0.06), DY, s * (DR - 0.06)), () => g.cyl(0.03, 0.022, 0.48, 6, mul(bark, 0.9), false, true)); posts.push([c * (DR - 0.06), DY + 0.44, s * (DR - 0.06)]); if (i % 2 === 0) g.in(M(c * (DR + 0.02), DY - 0.06, s * (DR + 0.02)), () => gourd(g, 0.22, 1.5, i)); }
  for (let i = 0; i < 16; i++) { const a = posts[i], b = posts[(i + 1) % 16]; rope(g, [a, [(a[0] + b[0]) / 2, a[1] - 0.09, (a[2] + b[2]) / 2], b], 0.014, rgb(0xa08a58), 5); rope(g, [[a[0], a[1] - 0.24, a[2]], [(a[0] + b[0]) / 2, a[1] - 0.3, (a[2] + b[2]) / 2], [b[0], b[1] - 0.24, b[2]]], 0.01, rgb(0xa08a58), 4); }
  // two nests in the front boughs, a bridge slung between them, a ladder up
  const nest = (k) => { const a = BA[k], c = Math.cos(a), s = Math.sin(a); return [1.38 * c, 5.75, 1.38 * s]; }, N0 = nest(0), N1 = nest(1);
  for (const [n, sd] of [[N0, 1], [N1, 2]]) g.in(M(n[0], n[1], n[2]), () => {
    const nb = nq(14);
    for (let i = 0; i < nb; i++) g.in(RY((i * 360) / nb).multiply(M(0, 0, 0.42)), () => { g.surf(K_WOOD, 0.9); g.cbox(0.3, 0.045, 0.56, 0.01, woodTint(mul(wood, 0.8 + 0.4 * hash1(i, sd)), i + sd)); });
    g.surf(K_WOOD, 0.95);
    for (let j = 0; j < 4; j++) { const pts = []; for (let i = 0; i <= 14; i++) { const a = (i / 14) * TAU; pts.push([Math.cos(a) * (0.68 + 0.02 * ((i + j) % 2)), 0.06 + j * 0.1, Math.sin(a) * (0.68 + 0.02 * ((i + j) % 2))]); } g.tube(pts, 0.022, 5, (x, y, z) => mul(rgb(0x7a6444), 0.6 + 0.7 * noise3(x * 20 + j, y * 20, z * 20)), false); }
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; g.in(M(Math.cos(a) * 0.68, 0, Math.sin(a) * 0.68), () => g.cyl(0.024, 0.02, 0.44, 5, mul(bark, 0.9), false, true)); }
    g.in(M(0, -0.03, 0.66 * (sd === 1 ? 1 : -1) * 0), () => 0);
    for (const a of [1.0, 3.3, 5.2]) g.in(M(Math.cos(a) * 0.7, 0.0, Math.sin(a) * 0.7), () => gourd(g, 0.2, 1.5, a));
  });
  ropeBridge(g, [N0[0] - 0.5, N0[1] + 0.03, N0[2] + 0.2], [N1[0] + 0.5, N1[1] + 0.03, N1[2] + 0.2], 0.16, 0.36, wood, 5);
  ladder(g, [2.0, DY, 0.6], [N0[0] + 0.5, N0[1] + 0.05, N0[2] - 0.3], 0.3, 0.16, wood, 3);
  ropeBridge(g, [N1[0] - 0.45, N1[1] + 0.03, N1[2] - 0.35], [-2.0, DY + 0.03, -0.6], 0.12, 0.34, wood, 9);
  // lanterns in the boughs, ferns at the roots
  for (const [x, y, z, s] of [[1.5, 6.1, -0.9, 0.26], [-0.3, 6.2, -1.5, 0.24], [-1.55, 6.0, -0.5, 0.26], [0.4, 6.4, 1.5, 0.22], [0.9, 5.2, -1.2, 0.2], [-0.2, 6.9, 0.3, 0.2]]) g.in(M(x, y, z), () => gourd(g, s, 1.5, x * 5));
  for (let i = 0; i < 14; i++) { const a = i * 0.47 + 0.2, d = 2.05 + 0.3 * hash1(i, 5); if (Math.abs(a % TAU - FR) > 0.5) g.in(M(Math.cos(a) * d, 0.04, Math.sin(a) * d, 0, i * 50, 0, 1.6), () => tuft(g, 9, 0.22, 920 + i, mul(leaf, 1.2))); }
  motes(g, [[1.2, 1.2, 1.9], [-1.4, 0.8, 1.8, 0.8], [2.1, 2.2, 0.4], [-2.2, 1.6, -0.3, 0.8], [0.6, 3.4, 2.0], [-0.9, 5.2, 1.9, 0.8], [1.9, 5.0, 1.2], [-2.0, 3.6, 1.0]], 0.03, [1.0, 0.8, 0.3], 2);
}

// ---------------------------------------------------------------------------------------------------
// The Verdant: sap-lantern, 1 x 1
// ---------------------------------------------------------------------------------------------------
function verdantSapLantern(g) {
  const bark = rgb(0x6a5238), leaf = rgb(0x3f7a2e);
  g.surf(K_PLAIN, 1);
  g.sheet(nq(20), 3, (u, v) => { const a = u * TAU; return [Math.cos(a) * 0.47 * v, v > 0.99 ? -0.04 : 0.07 * (1 - v * v), Math.sin(a) * 0.47 * v]; }, (x, y, z) => mix(mul(rgb(0x4a3c28), 0.8), rgb(0x3f6a2c), smooth(0.3, 0.6, noise3(x * 5, 5, z * 5))), true);
  // a mossy standing stone, half swallowed by the roots
  g.in(M(-0.17, 0.1, -0.12, 4, 30, 8), () => boulder(g, 0.19, 0.52, 0.15, 931, rgb(0x7f8078), nqe(40)));
  g.in(M(0.26, 0.03, -0.2, 0, 70, 0), () => boulder(g, 0.13, 0.1, 0.11, 932, rgb(0x7f8078), nqe(24)));
  // the living post: two stems wound round each other, crooked over at the top
  const spine = new THREE.CatmullRomCurve3([[0.08, -0.05, 0.06], [0.0, 0.5, 0.02], [0.08, 1.1, 0.05], [0.0, 1.7, 0.0], [0.04, 2.08, 0.03], [0.22, 2.24, 0.08], [0.36, 2.14, 0.11], [0.38, 1.98, 0.12]].map((p) => new THREE.Vector3(...p)));
  for (const k of [0, 1]) {
    const pts = [], rr = [], n = 26;
    for (let i = 0; i <= n; i++) { const t = i / n, p = spine.getPoint(t), a = t * 13 + k * Math.PI, h = 0.062 * (1 - t) + 0.012; pts.push([p.x + Math.cos(a) * h, p.y, p.z + Math.sin(a) * h]); rr.push(lerp(0.08, 0.026, t) * (k ? 0.85 : 1)); }
    g.surf(K_WOOD, 0.95);
    limb(g, pts, rr, { nu: nq(12), nv: nq(90), amp: 0.14, nf: 3, seed: k * 5 + 1, col: (x, y, z, nx, ny) => mix(barkCol(mul(bark, k ? 1.15 : 0.95), k)(x, y, z), [0.16, 0.26, 0.07], 0.7 * smooth(0.5, 0.72, noise3(x * 6 + 4, y * 3, z * 6))) });
  }
  for (const [a, l] of [[0.4, 0.34], [1.9, 0.3], [3.3, 0.36], [4.7, 0.3], [5.6, 0.26]]) limb(g, [[0.05, 0.16, 0.04], [0.05 + Math.cos(a) * l * 0.5, 0.07, 0.04 + Math.sin(a) * l * 0.5], [0.05 + Math.cos(a) * l, -0.04, 0.04 + Math.sin(a) * l]], [0.06, 0.04, 0.015], { nu: nq(8), nv: nq(8), amp: 0.14, seed: a, col: barkCol(bark, a) });
  // a twig, leaves, the gourd of sap
  limb(g, [[0.02, 1.62, 0], [-0.14, 1.86, -0.05], [-0.26, 2.0, -0.06]], [0.028, 0.02, 0.008], { nu: 6, nv: nq(8), col: barkCol(bark, 3) });
  foliage(g, -0.25, 2.05, -0.06, 0.16, 0.11, 0.15, nq(46), leaf, 933, 0.11, 1.9, 2.3);
  foliage(g, 0.18, 2.3, 0.07, 0.2, 0.1, 0.17, nq(60), leaf, 934, 0.11, 2.15, 2.45);
  g.in(M(0.38, 1.99, 0.12), () => {
    gourd(g, 0.4, 1.6, 2);
    g.surf(K_CLOTH, 0.9);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.3, pts = []; for (let k = 0; k <= 6; k++) { const t = k / 6, r = [0.03, 0.07, 0.125, 0.135, 0.11, 0.06, 0.012][k] + 0.006; pts.push([Math.cos(a + t * 1.2) * r, -0.1 - t * 0.4, Math.sin(a + t * 1.2) * r]); } g.tube(pts, 0.006, 4, [0.1, 0.14, 0.04], false); }
  });
  // toadstools, grass, fireflies
  for (const [x, z, s, c] of [[0.3, 0.22, 1, 0xc0462e], [0.36, 0.14, 0.7, 0xc0462e], [-0.3, 0.26, 0.85, 0xd8b070], [-0.05, 0.37, 0.6, 0xd8b070]]) g.in(M(x, 0.03, z), () => { g.surf(K_PLAIN, 0.8); g.cyl(0.012 * s, 0.01 * s, 0.09 * s, 5, [0.8, 0.76, 0.62], false, false); g.in(M(0, 0.08 * s, 0), () => g.lathe([[0.05 * s, 0], [0.045 * s, 0.015 * s], [0.025 * s, 0.035 * s], [0, 0.042 * s]], nq(8), rgb(c))); });
  for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3; g.in(M(Math.cos(a) * 0.38, 0.02, Math.sin(a) * 0.38), () => tuft(g, 8, 0.16, 940 + i)); }
  const rnd = rng(945), fl = [];
  for (let i = 0; i < 16; i++) { const a = rnd() * TAU, d = 0.18 + rnd() * 0.3; fl.push([Math.cos(a) * d, 0.3 + rnd() * 2.0, Math.sin(a) * d, 0.6 + 0.7 * rnd()]); }
  motes(g, fl, 0.014, [1.0, 0.85, 0.3], 2.2);
}

const RUNE_BLUE = [0.12, 0.5, 1.0], GRANITE = 0x8f8a84, STEAM = [0xdfe6ea, 0xf4f8fa];
/** a creeper through pts with leaves along it */
function vine(g, pts, seed, leafCol, size = 0.075) {
  const P = curvePts(pts, pts.length * 4), rnd = rng(seed * 37 + 5);
  g.surf(K_LEAF, 0.9); g.tube(P, 0.013, 4, mul(leafCol, 0.45), false);
  for (let i = 1; i < P.length; i++) for (let k = 0; k < 2; k++) {
    const p = P[i], a = rnd() * TAU, s = size * (0.7 + 0.7 * rnd()), dx = Math.cos(a), dz = Math.sin(a), c = mul(leafCol, 0.65 + 0.7 * rnd());
    g.flat([[p[0], p[1], p[2]], [p[0] + dx * s - dz * s * 0.45, p[1] - s * 0.5, p[2] + dz * s + dx * s * 0.45], [p[0] + dx * s * 1.5, p[1] - s * 0.9, p[2] + dz * s * 1.5], [p[0] + dx * s + dz * s * 0.45, p[1] - s * 0.35, p[2] + dz * s - dx * s * 0.45]], [mul(c, 0.7), c, mul(c, 1.2), c]);
  }
}
/** a square carved panel on the local XY plane, s across: a stepped fret cut into it */
function glyphPanel(g, s, seed, col) {
  const k = hash1(seed, 3) > 0.5 ? 1 : -1, dk = mul(col, 0.42);
  g.in(M(0, 0, 0.012), () => g.cbox(s, s, 0.024, 0.006, mul(col, 1.06)));
  g.flat([[-s * 0.36, -s * 0.36, 0.026], [s * 0.36, -s * 0.36, 0.026], [s * 0.36, s * 0.36, 0.026], [-s * 0.36, s * 0.36, 0.026]], dk);
  g.in(M(k * s * 0.1, -s * 0.1, 0.03), () => g.cbox(s * 0.34, s * 0.34, 0.02, 0.005, col));
  g.in(M(-k * s * 0.17, s * 0.17, 0.03), () => g.cbox(s * 0.2, s * 0.2, 0.02, 0.005, col));
  g.in(M(k * s * 0.2, s * 0.22, 0.03), () => g.cbox(s * 0.1, s * 0.1, 0.02, 0.004, col));
}
/** a puff of steam */
const steam = (g, s, seed) => smoke(g, s, seed, STEAM[0], STEAM[1]);

// ---------------------------------------------------------------------------------------------------
// Grom: rune-gate hall, 5 x 4 (the gate toward +Z, the mountain behind)
// ---------------------------------------------------------------------------------------------------
/** an ancestor in stone, 1 high: helm, beard to the belt, both hands on a hammer grounded before him; faces +Z */
function ancestorGeo() {
  return geoOnce('ancestor', () => {
    const c = 0x9a958e, P = [], sk = (p) => p.color(c).tint(0.14, 12).pbr(0.9);
    P.push(sk(S.box(0.56, 0.06, 0.5, 0.012).at(0, 0.03, 0.04)));
    P.push(sk(S.cone(0.25, 0.2, 0.44, 0.04).at(0, 0.27, 0)));
    P.push(sk(S.ellipsoid(0.23, 0.2, 0.18).at(0, 0.58, 0).blend(0.04)));
    P.push(sk(S.box(0.5, 0.06, 0.36, 0.02).at(0, 0.45, 0)).blend(0.01));
    for (const e of [-1, 1]) {
      P.push(sk(S.ellipsoid(0.1, 0.08, 0.11).at(e * 0.25, 0.7, 0).blend(0.02)));
      P.push(...S.limb([[e * 0.25, 0.66, 0], [e * 0.24, 0.52, 0.12], [e * 0.08, 0.44, 0.22]], [0.066, 0.058, 0.052]).map((p) => sk(p).blend(0.03)));
    }
    P.push(sk(S.ellipsoid(0.11, 0.07, 0.08).at(0, 0.43, 0.24).blend(0.02)));
    P.push(sk(S.capsule([0, 0.44, 0.26], [0, 0.1, 0.26], 0.03, 0.03).blend(0.005)));
    P.push(sk(S.box(0.3, 0.15, 0.17, 0.02).at(0, 0.13, 0.26).blend(0.005)));
    P.push(sk(S.ellipsoid(0.12, 0.13, 0.12).at(0, 0.83, 0.03).blend(0.02)));
    P.push(sk(S.cone(0.06, 0.17, 0.36, 0.03).at(0, 0.6, 0.14).blend(0.02)));
    for (const e of [-1, 0, 1]) P.push(sk(S.capsule([e * 0.07, 0.72, 0.22], [e * 0.05, 0.47, 0.2], 0.04, 0.03).blend(0.008)));
    P.push(sk(S.sphere(0.035).at(0, 0.84, 0.15).blend(0.015)));
    P.push(sk(S.box(0.21, 0.035, 0.06, 0.01).at(0, 0.885, 0.11).blend(0.01)));
    P.push(sk(S.ellipsoid(0.14, 0.11, 0.14).at(0, 0.92, 0.02).blend(0.008)));
    P.push(sk(S.box(0.035, 0.1, 0.28, 0.012).at(0, 1.0, 0.02).blend(0.01)));
    P.push(sk(S.torus(0.137, 0.02).at(0, 0.89, 0.02).blend(0.006)));
    P.push(sk(S.box(0.03, 0.12, 0.03, 0.008).at(0, 0.86, 0.155).blend(0.006)));
    return buildPartGeometry({ prims: P }, { res: 46 * qual(), ao: 0.8 });
  });
}
function gromRuneGate(g) {
  const st = bigStone(GRANITE, 1000, { course: 0.3, len: [0.5, 0.92] }), r = st.r, col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 4), gran = rgb(0x7a766f);
  const bz = (x, y, z) => mul(BRONZE, 0.8 + 0.35 * noise3(x * 8, y * 8, z * 8));
  // the mountain
  g.surf(K_STONE, 0.96);
  g.sheet(nq(96), nq(40), (u, v) => {
    const a = u * TAU, el = (1 - v) * 0.5 * Math.PI, co = Math.cos(a), si = Math.sin(a), ce = Math.pow(Math.cos(el), 0.42), se = Math.sin(el);
    const k = Math.pow(Math.pow(Math.abs(co), 4) + Math.pow(Math.abs(si), 4), -0.25), n = fbm3(co * ce * 1.9 + 5, se * 2.2, si * ce * 1.9, 3), crag = 0.5 + 0.5 * Math.sin(a * 3 + 1.2);
    const rr = Math.min(1.045, k * (0.84 + 0.26 * n));
    return [co * ce * 2.32 * rr, v > 0.995 ? -0.08 : se * (4.5 + 1.3 * crag) * (0.8 + 0.4 * n), Math.min(0.42, si * ce * 1.37 * rr - 0.56)];
  }, rockCol(mul(gran, 1.25), 3, 0.45, 3), true);
  for (const [x, z, s, sd] of [[-2.1, 1.2, 0.36, 1], [2.15, 1.0, 0.3, 2], [-1.75, 1.7, 0.2, 3], [2.2, 1.6, 0.22, 4]]) g.in(M(x, 0.02, z, 0, sd * 70, 0), () => boulder(g, s, s * 0.8, s * 0.85, 1010 + sd, gran, nqe(30)));
  // forecourt
  g.surf(K_STONE, 0.95);
  g.in(M(0, 0, 1.4), () => slab(g, 2.42, 0.56, 0.03, mul(col, 0.8), 1015, 0.55));
  // the carved front
  const fz = 0.92, fhx = 1.86, A = archOf(0.86, 2.1, 0.46, 0.3), c0 = fhx - r;
  g.in(M(0, 0, fz - 0.4), () => {
    blockBox(g, fhx, 0.4, 0, 4.5, st, 1020, { only: [0, 1, 3], quoin: [0.7, 0.4], holes: [archHoles(A, c0, 0, 10, r, st.course), null, null, null], topCol: mul(col, 0.85), each: (s) => {
      if (s !== 0) return;
      g.in(M(c0, 0, 0), () => {
        g.surf(K_STONE, 0.93); voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, 9, st, 1030, 0.04);
        archReveal(g, A, 0.3, col);
        // bronze leaves: panels, studs, runes
        g.in(M(0, 0, -0.24), () => {
          for (const e of [-1, 1]) {
            g.surf(K_PLAIN, 0.38, 0.9);
            g.sheet(nq(8), nq(12), (u, v) => { const x = e * (0.012 + u * (A.half - 0.012)); return [x, v * A.y(x), 0]; }, (x, y) => { const px = (Math.abs(x) / A.half) * 2, py = y / 0.62, fx = Math.abs(px - Math.round(px)), fy = Math.abs(py - Math.round(py)); return mul(BRONZE, (fx < 0.07 || fy < 0.06 ? 0.45 : 0.85 + 0.3 * noise3(x * 9, y * 9, 2))); });
            for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) { const x = e * (A.half * (i + 0.5)) / 2, y = 0.31 + j * 0.62; if (y < A.y(x) - 0.2) { g.in(M(x, y, 0.004), () => rune(g, 1040 + i * 4 + j + e * 9, 0.34, RUNE_BLUE, 1.5, 0.13)); } }
            g.surf(K_PLAIN, 0.38, 0.9);
            for (let j = 0; j <= 4; j++) for (let i = 0; i <= 2; i++) { const x = e * (0.04 + (A.half - 0.08) * i / 2), y = 0.04 + j * 0.62; if (y < A.y(x) - 0.05) g.in(M(x, y, 0.004), () => g.stud(0.035, mul(BRONZE, 1.2), 6)); }
            g.in(M(e * 0.2, 1.15, 0.03), () => { g.add(new THREE.TorusGeometry(0.11, 0.022, 6, nq(16)), mul(BRONZE, 1.1)); g.in(M(0, 0.11, 0), () => g.stud(0.05, mul(BRONZE, 1.2), 6)); });
          }
          g.surf(K_PLAIN, 0.5, 0.6); g.in(M(0, A.y(0) / 2, 0.006), () => g.cbox(0.03, A.y(0), 0.02, 0.004, mul(BRONZE, 0.3)));
        });
        // square piers, a rune frieze, a stepped attic with the hall's seal
        g.surf(K_STONE, 0.93);
        for (const e of [-1, 1]) g.in(M(e * 1.3, 0, 0.14), () => {
          g.in(M(0, 1.8, 0), () => g.cbox(0.46, 3.6, 0.3, 0.03, cc));
          for (const [y, w, h] of [[0.2, 0.6, 0.4], [3.33, 0.56, 0.14], [3.5, 0.66, 0.2]]) g.in(M(0, y, 0.02), () => g.cbox(w, h, 0.38, 0.03, cc));
          g.surf(K_PLAIN, 0.38, 0.9);
          for (const y of [0.9, 2.7]) g.in(M(0, y, 0), () => g.cbox(0.5, 0.12, 0.34, 0.015, bz));
          for (let k = 0; k < 3; k++) g.in(M(0, 1.35 + k * 0.45, 0.152), () => rune(g, 1050 + k + e * 5, 0.3, RUNE_BLUE, 1.5, 0.13));
          g.surf(K_STONE, 0.93);
        });
        g.in(M(0, 3.92, 0.08), () => g.cbox(3.76, 0.56, 0.2, 0.03, cc));
        g.surf(K_PLAIN, 0.38, 0.9);
        for (const y of [3.62, 4.22]) g.in(M(0, y, 0.1), () => g.cbox(3.8, 0.07, 0.24, 0.012, bz));
        for (let k = 0; k < 9; k++) g.in(M(-1.6 + k * 0.4, 3.92, 0.182), () => rune(g, 1060 + k, 0.36, RUNE_BLUE, 1.6, 0.13));
      });
    } });
    blockBox(g, 1.3, 0.34, 4.5, 5.1, st, 1070, { only: [0, 1, 3], topCol: mul(col, 0.85) });
    blockBox(g, 0.7, 0.3, 5.1, 5.55, st, 1075, { only: [0, 1, 3], topCol: mul(col, 0.85) });
    g.in(M(0, 4.86, 0.36), () => {
      g.surf(K_PLAIN, 0.38, 0.9);
      g.in(M(0, 0, 0, 90, 0, 0), () => g.lathe([[0, 0.07], [0.12, 0.06], [0.3, 0.03], [0.42, 0.03], [0.44, 0], [0.44, -0.02]].reverse(), 8, bz, Math.PI / 8, TAU + Math.PI / 8));
      g.in(M(0, 0, 0.066), () => rune(g, 1077, 0.34, RUNE_BLUE, 1.7, 0.16));
    });
  });
  // the ancestors on their plinths, fire bowls before them
  const anc = ancestorGeo();
  for (const e of [-1, 1]) {
    g.in(M(e * 1.96, 0, 1.36), () => {
      blockBox(g, 0.4, 0.36, 0, 0.6, st, 1080 + e, { topCol: mul(col, 0.9) });
      g.surf(K_STONE, 0.92);
      if (anc) g.in(M(0, 0.6, -0.02, 0, -e * 12, 0, 2.3), () => g.add(anc));
    });
    g.in(M(e * 1.12, 0, 1.62), () => {
      g.surf(K_STONE, 0.93); g.in(M(0, 0.25, 0), () => g.cbox(0.4, 0.5, 0.4, 0.04, cc));
      g.in(M(0, 0.5, 0), () => brazier(g, 0.62, FIRE_HOT, mul(BRONZE, 0.9), e + 3));
    });
  }
  // vents steaming on the rock above
  for (const [x, y, z, h, s, sd] of [[-1.35, 4.2, -0.5, 1.2, 1.3, 1], [1.0, 4.7, -0.9, 1.1, 1.5, 2], [1.75, 3.5, -0.2, 0.9, 1.0, 3], [-0.3, 5.0, -1.2, 0.9, 1.1, 4]]) g.in(M(x, y, z, sd * 3 - 6, 0, 5 - sd * 3), () => {
    g.surf(K_PLAIN, 0.38, 0.9);
    g.lathe([[0.13, 0], [0.13, h - 0.2], [0.17, h - 0.16], [0.17, h - 0.08], [0.13, h - 0.04], [0.19, h], [0.1, h], [0.1, h - 0.3]], nq(12), bz);
    for (const yy of [h * 0.3, h * 0.6]) g.in(M(0, yy, 0), () => g.lathe([[0.135, -0.03], [0.155, 0], [0.135, 0.03]], nq(12), mul(BRONZE, 0.75)));
    g.in(M(0, h - 0.1, 0), () => steam(g, s, 1090 + sd));
  });
}

// ---------------------------------------------------------------------------------------------------
// Grom: steam works, 3 x 3
// ---------------------------------------------------------------------------------------------------
function gromSteamWorks(g) {
  const st = bigStone(GRANITE, 1100, { course: 0.3, len: [0.45, 0.8] }), r = st.r, col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 4), COPPER_C = rgb(0xb8663a);
  const bz = (x, y, z) => mul(BRONZE, 0.8 + 0.35 * noise3(x * 8, y * 8, z * 8)), cu = (x, y, z) => mul(COPPER_C, 0.8 + 0.35 * noise3(x * 8, y * 8, z * 8));
  const cx = -0.36, cz = -0.3, hx = 1.0, hz = 1.0, H = 2.1, fz = cz + hz;
  g.in(M(cx, 0, cz), () => {
    blockBox(g, hx, hz, 0, H, st, 1110, { quoin: [0.6, 0.36], topCol: mul(col, 0.8) });
    faces4(g, hx, hz, (s, W) => {
      g.surf(K_STONE, 0.93);
      g.in(M(0, 0.17, 0.03), () => g.cbox(2 * W + 0.12, 0.34, 0.1, 0.03, cc));
      for (const e of [-1, 1]) g.in(M(e * (W - 0.02), H / 2 + 0.08, 0.0), () => g.cbox(0.3, H + 0.16, 0.2, 0.03, cc));
      g.in(M(0, H + 0.12, -0.08), () => g.cbox(2 * W - 0.2, 0.24, 0.16, 0.03, cc));
      // rune band in bronze
      g.surf(K_PLAIN, 0.38, 0.9); g.in(M(0, 1.74, 0.012), () => g.cbox(2 * W - 0.3, 0.26, 0.03, 0.008, bz));
      const n = Math.round((2 * W - 0.5) / 0.3);
      for (let k = 0; k < n; k++) g.in(M(-W + 0.3 + (k + 0.5) * ((2 * W - 0.6) / n), 1.74, 0.03), () => rune(g, 1120 + s * 9 + k, 0.24, RUNE_BLUE, 1.6, 0.13));
      if (s === 3) g.in(M(0, 0.34, 0.02), () => {
        // the door: a bronze plate
        g.surf(K_PLAIN, 0.38, 0.9);
        plate(g, [[-0.3, 0], [0.3, 0], [0.3, 0.9], [0.18, 1.1], [-0.18, 1.1], [-0.3, 0.9]], 0.05, mul(BRONZE, 0.85));
        for (const [x, y] of [[-0.22, 0.1], [0.22, 0.1], [-0.22, 0.8], [0.22, 0.8], [0, 1.02]]) g.in(M(x, y, 0.026), () => g.stud(0.03, mul(BRONZE, 1.2), 6));
        g.in(M(0, 0.5, 0.03), () => rune(g, 1130, 0.4, RUNE_BLUE, 1.5, 0.13));
      });
    });
    // on the roof: vents, a pressure dome with its wheel
    for (const [x, z, R, h, sd] of [[-0.5, -0.45, 0.17, 1.9, 1], [0.35, -0.5, 0.21, 2.5, 2]]) g.in(M(x, H, z), () => {
      g.surf(K_STONE, 0.93); g.in(M(0, 0.1, 0), () => g.cbox(R * 3, 0.2, R * 3, 0.03, cc));
      g.surf(K_PLAIN, 0.38, 0.9);
      g.lathe([[R * 1.2, 0.2], [R, 0.3], [R * 0.92, h - 0.3], [R * 1.25, h - 0.22], [R * 1.25, h - 0.12], [R * 0.95, h - 0.08], [R * 1.4, h], [R * 0.7, h], [R * 0.7, h - 0.3]], nq(14), bz);
      for (const yy of [0.7, 1.2, 1.7]) if (yy < h - 0.4) g.in(M(0, yy, 0), () => g.lathe([[R + 0.004, -0.035], [R + 0.03, 0], [R + 0.004, 0.035]], nq(14), mul(BRONZE, 0.7)));
      g.in(M(0, h - 0.08, 0), () => steam(g, R * 9, 1140 + sd));
    });
    g.in(M(-0.3, H, 0.42), () => {
      g.surf(K_PLAIN, 0.36, 0.9);
      g.lathe([[0.36, 0], [0.36, 0.1], [0.33, 0.14], [0.3, 0.3], [0.2, 0.44], [0.06, 0.5], [0.05, 0.62]], nq(16), cu);
      g.in(M(0, 0.1, 0), () => g.lathe([[0.365, -0.03], [0.39, 0], [0.365, 0.03]], nq(16), bz));
      for (let i = 0; i < 12; i++) g.in(RY(i * 30).multiply(M(0, 0.1, 0.39)), () => g.stud(0.022, mul(BRONZE, 1.2), 5));
      g.in(M(0, 0.66, 0), () => { g.add(new THREE.TorusGeometry(0.13, 0.016, 5, nq(14)).rotateX(Math.PI / 2), mul(BRONZE, 0.6)); for (let i = 0; i < 3; i++) g.in(RY(i * 60), () => g.cbox(0.26, 0.016, 0.02, 0.004, mul(BRONZE, 0.6))); });
    });
    g.shade(-hx, H - 0.02, -hz, hx, H + 0.2, hz, 0.25, 0.1);
  });
  // the works on the front wall: a great wheel driven by a piston, a pinion above it
  const gz = fz + 0.2, gx = 0.0, gy = 1.13, GR = 0.72, pa = -0.6, pin = [gx + Math.cos(pa) * 0.42, gy + Math.sin(pa) * 0.42];
  g.surf(K_PLAIN, 0.42, 0.88);
  g.in(M(gx, gy, gz), () => gear(g, GR, 0.15, 22, bz, 6));
  g.in(M(gx - 0.95, gy + 0.44, gz - 0.02, 0, 0, 8), () => gear(g, 0.34, 0.12, 10, (x, y, z) => mul([0.3, 0.3, 0.33], 0.8 + 0.4 * noise3(x * 9, y * 9, z * 9)), 4));
  for (const [x, y] of [[gx, gy], [gx - 0.95, gy + 0.44]]) g.in(M(x, y, fz - 0.02, 90, 0, 0), () => { g.surf(K_STONE, 0.93); g.cyl(0.16, 0.13, 0.12, 8, cc, false, true); });
  g.surf(K_PLAIN, 0.35, 0.9);
  g.in(M(pin[0], pin[1], gz + 0.07, 90, 0, 0), () => g.cyl(0.05, 0.05, 0.12, 8, [0.4, 0.4, 0.44], false, true));
  const py = 0.42, pz = gz + 0.14;
  g.beamTo([-0.62, py, pz], [pin[0], pin[1], pz], 0.035, 0.07, 0.01, [0.4, 0.4, 0.44], 1, [0, 0, 1]);
  g.in(M(-1.34, py, pz, 0, 0, -90), () => {
    g.lathe([[0, -0.03], [0.14, 0], [0.19, 0.02], [0.19, 0.08], [0.165, 0.1], [0.165, 0.5], [0.19, 0.52], [0.19, 0.58], [0.14, 0.6], [0.05, 0.62]], nq(14), cu);
    g.in(M(0, 0.6, 0), () => g.cyl(0.028, 0.028, 0.24, 6, [0.5, 0.5, 0.55], false, true));
    for (const y of [0.05, 0.55]) for (let i = 0; i < 8; i++) g.in(M(Math.cos(i * 0.785) * 0.19, y, Math.sin(i * 0.785) * 0.19), () => g.add(new THREE.OctahedronGeometry(0.018, 0), mul(BRONZE, 1.2)));
  });
  g.in(M(-0.62, py, pz), () => g.cbox(0.12, 0.12, 0.08, 0.015, [0.3, 0.3, 0.33]));
  g.surf(K_STONE, 0.93);
  for (const x of [-1.2, -0.86]) g.in(M(x, 0.12, pz), () => g.cbox(0.16, 0.26, 0.34, 0.03, cc));
  g.in(M(-0.4, 0.1, pz), () => g.cbox(0.7, 0.2, 0.2, 0.03, cc));
  // the boiler along the side: riveted copper on stone cradles, a fire door glowing at its end
  const bx = 1.04, by = 0.66, BR = 0.39, bz0 = -1.12, bz1 = 0.72;
  g.in(M(bx, by, bz0, 90, 0, 0), () => {
    g.surf(K_PLAIN, 0.36, 0.9);
    const L = bz1 - bz0;
    g.lathe([[0, -0.14], [BR * 0.6, -0.1], [BR * 0.94, 0], [BR, 0.06], [BR, L - 0.06], [BR * 1.04, L - 0.04], [BR * 1.04, L], [0, L]], nq(20), cu);
    for (let k = 0; k <= 4; k++) { const y = 0.08 + k * ((L - 0.16) / 4); g.in(M(0, y, 0), () => g.lathe([[BR + 0.004, -0.04], [BR + 0.025, -0.02], [BR + 0.025, 0.02], [BR + 0.004, 0.04]], nq(20), bz)); for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.in(M(Math.cos(a) * (BR + 0.025), y, Math.sin(a) * (BR + 0.025)), () => g.add(new THREE.OctahedronGeometry(0.016, 0), mul(BRONZE, 1.3))); } }
    // fire door
    g.in(M(0, L + 0.004, 0, -90, 0, 0), () => {
      g.surf(K_PLAIN, 0.4, 0.85); g.in(M(0, -0.04, 0.012), () => g.cbox(0.4, 0.36, 0.03, 0.01, [0.1, 0.1, 0.11]));
      g.surf(K_PLAIN, 0.5, 0, 1.4);
      for (let k = 0; k < 4; k++) g.flat([[-0.13, -0.16 + k * 0.065, 0.03], [0.13, -0.16 + k * 0.065, 0.03], [0.13, -0.12 + k * 0.065, 0.03], [-0.13, -0.12 + k * 0.065, 0.03]], [1.0, 0.4, 0.06]);
      g.surf(K_PLAIN, 0.36, 0.9);
      g.in(M(0, 0.24, 0.01, 90, 0, 0), () => g.lathe([[0.075, 0], [0.085, 0.015], [0.085, 0.03], [0, 0.03]], nq(12), bz));
      g.surf(K_PLAIN, 0.6); g.in(M(0, 0.24, 0.042), () => { g.cbox(0.012, 0.11, 0.006, 0.002, [0.03, 0.03, 0.03]); });
    });
  });
  g.surf(K_STONE, 0.93);
  for (const z of [bz0 + 0.3, bz1 - 0.35]) g.in(M(bx, 0.17, z), () => { g.cbox(0.86, 0.34, 0.3, 0.03, cc); for (const e of [-1, 1]) g.in(M(e * 0.36, 0.26, 0), () => g.cbox(0.14, 0.24, 0.3, 0.03, cc)); });
  // its stack, its pipes
  g.in(M(bx, by + BR - 0.03, bz0 + 0.5), () => {
    g.surf(K_PLAIN, 0.38, 0.9);
    g.lathe([[0.2, 0], [0.14, 0.12], [0.13, 2.1], [0.19, 2.2], [0.19, 2.3], [0.14, 2.34], [0.22, 2.42], [0.11, 2.42], [0.11, 2.1]], nq(12), bz);
    for (const yy of [0.7, 1.4]) g.in(M(0, yy, 0), () => g.lathe([[0.137, -0.03], [0.16, 0], [0.137, 0.03]], nq(12), mul(BRONZE, 0.7)));
    g.in(M(0, 2.34, 0), () => steam(g, 1.5, 1151));
  });
  pipe(g, [[bx, by + BR - 0.02, 0.2], [bx, 1.5, 0.2], [bx - 0.12, 1.66, 0.2], [cx + hx - 0.02, 1.66, 0.2]], 0.055, COPPER_C);
  pipe(g, [[bx - 0.1, by + BR - 0.04, -0.3], [bx - 0.1, 1.2, -0.3], [bx - 0.2, 1.3, -0.3], [cx + hx - 0.02, 1.3, -0.3]], 0.04, COPPER_C);
  pipe(g, [[bx - 0.2, by + 0.2, bz1 - 0.12], [bx - 0.4, 0.42, fz + 0.5], [0.3, 0.2, fz + 0.52], [-0.5, 0.2, fz + 0.52], [-0.9, 0.28, pz + 0.04], [-1.0, py - 0.14, pz]], 0.04, COPPER_C, 20);
  g.in(M(1.2, 0, 1.15), () => barrel(g, 0.15, 0.36, rgb(0x6a4a30), 4));
  g.in(M(0.6, 0.02, 1.2), () => coalHeap(g, 0.3, 0.22, 0.2, 9));
}

// ---------------------------------------------------------------------------------------------------
// Xibalba: stepped temple, 6 x 6 (stair toward +Z)
// ---------------------------------------------------------------------------------------------------
const TURQ = rgb(0x2fc0b0), LIME = 0xcfc7a6, JUNGLE = rgb(0x3a7a2a);
/** a feathered serpent's head, about 0.6 long, jaws open toward +Z; resting on y = 0 */
function serpentGeo() {
  return geoOnce('serpent', () => {
    const c = 0xcbc3a2, P = [], H2 = [], sk = (p) => p.color(c).tint(0.14, 14).pbr(0.9);
    P.push(sk(S.box(0.3, 0.22, 0.3, 0.06).at(0, 0.3, 0)));
    P.push(sk(S.box(0.24, 0.13, 0.3, 0.04).rot(-8, 0, 0).at(0, 0.33, 0.24).blend(0.03)));
    P.push(sk(S.box(0.22, 0.06, 0.34, 0.025).rot(16, 0, 0).at(0, 0.14, 0.2).blend(0.01)));
    P.push(sk(S.box(0.2, 0.05, 0.3, 0.01).rot(4, 0, 0).at(0, 0.24, 0.22)).color(0x8a2a22).blend(0.004));
    P.push(...S.mirrorX([sk(S.box(0.07, 0.06, 0.16, 0.025).rot(0, 0, -14).at(0.1, 0.43, 0.06).blend(0.02))]));
    P.push(...S.mirrorX([sk(S.sphere(0.03).at(0.07, 0.39, 0.39).blend(0.02))]));
    for (let i = 0; i < 7; i++) { const a = (-90 + (i - 3) * 34) * DEG; P.push(sk(S.ellipsoid(0.06, 0.15, 0.03).rot(0, 0, (i - 3) * 34).at(Math.cos(a + Math.PI) * 0.0 + Math.sin((i - 3) * 34 * DEG) * -0.2, 0.3 + Math.cos((i - 3) * 34 * DEG) * 0.2, -0.13).color(i % 2 ? 0x4aa08c : 0xb8a45a).blend(0.012))); }
    P.push(sk(S.box(0.34, 0.12, 0.3, 0.03).at(0, 0.06, -0.02)));
    H2.push(...H.mirrorX([H.sphere(0.034, 8).at(0.14, 0.36, 0.1).color(0x2fc0b0).pbr(0.25, 0.1).glow(0.5)]));
    for (const x of [-0.08, 0.08]) { H2.push(H.cone(0.022, 0.09, 6).rot(180, 0, 0).at(x, 0.24, 0.35).color(0xf0ead8)); H2.push(H.cone(0.018, 0.07, 6).at(x, 0.21, 0.33).color(0xf0ead8)); }
    return buildPartGeometry({ prims: P, hard: H2 }, { res: 56 * qual(), ao: 0.8 });
  });
}
function xibalbaStepPyramid(g) {
  const st = bigStone(LIME, 1200, { len: [0.45, 0.8], var: 0.1, chip: 0.14 }), r = st.r, col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 4);
  const T = [2.57, 2.19, 1.81, 1.43, 1.05], TH = 0.75, topY = TH * T.length, sz0 = 2.97, sw = 0.62, slope = topY / (sz0 - T[4]);
  // apron
  g.surf(K_STONE, 0.95);
  g.in(M(0, 0, 0), () => { for (let s = 0; s < 4; s++) g.in(RY(s * 90).multiply(M(0, 0, 2.74)), () => slab(g, s % 2 ? 2.55 : 2.93, 0.19, 0.035, mul(col, 0.78), 1205 + s, 0.5)); });
  T.forEach((hx, i) => {
    const y0 = i * TH, y1 = y0 + TH;
    blockBox(g, hx, hx, y0, y1 - 0.25, st, 1210 + i * 30, { top: false });
    faces4(g, hx, hx, (s, W) => {
      // tablero: a framed band round the head of every stage, turquoise set into it
      g.surf(K_STONE, 0.93);
      g.in(M(0, y1 - 0.125, -0.0), () => g.cbox(2 * W + 0.14, 0.25, 0.14, 0.02, cc));
      const n = Math.max(3, Math.round((2 * W) / 0.42));
      for (let k = 0; k < n; k++) {
        const x = -W + (k + 0.5) * ((2 * W) / n);
        if (s === 0 && Math.abs(x) < sw + 0.3) continue;
        g.surf(K_STONE, 0.93);
        if (k % 2 === 0) g.in(M(x, y0 + 0.26, 0.004), () => glyphPanel(g, 0.3, 1220 + i * 40 + s * 10 + k, mul(col, 0.98)));
        g.surf(K_PLAIN, 0.25, 0.15, 0.25); g.in(M(x, y1 - 0.125, 0.072), () => g.cbox(0.1, 0.1, 0.02, 0.006, mul(TURQ, 0.8 + 0.4 * hash1(k, s, i))));
      }
    });
    g.surf(K_STONE, 0.95); g.in(M(0, 0, 0), () => slab(g, hx + 0.06, hx + 0.06, y1, mul(col, 0.86), 1215 + i, 0.6));
  });
  // the stair, its cheeks ending in serpents' heads
  g.surf(K_STONE, 0.93);
  flight(g, 2 * sw, sz0, 0, T[4] + 0.02, topY, 26, mul(col, 0.94), 3, 0.5);
  const sg = serpentGeo();
  for (const e of [-1, 1]) {
    const zc = 2.62, yc = (sz0 - zc) * slope + 0.16;
    wedge(g, e * sw, e * (sw + 0.24), zc, yc, T[4] - 0.02, topY + 0.16, 0, mul(col, 1.02), 0.72);
    g.surf(K_STONE, 0.93);
    g.in(M(e * (sw + 0.12), yc / 2 - 0.1, zc + 0.14), () => g.cbox(0.34, yc - 0.2, 0.36, 0.02, cc));
    if (sg) g.in(M(e * (sw + 0.12), yc - 0.24, zc + 0.08, 0, 0, 0, 0.82), () => g.add(sg));
    g.surf(K_PLAIN, 0.25, 0.15, 0.25);
    for (let k = 1; k < 6; k++) { const t = k / 6; g.in(M(e * (sw + 0.12), lerp(yc, topY + 0.16, t) + 0.012, lerp(zc, T[4] - 0.02, t), -Math.atan(slope) / DEG + 90, 0, 0), () => g.cbox(0.1, 0.1, 0.02, 0.006, TURQ)); }
    g.surf(K_STONE, 0.93);
  }
  // the shrine: a dark door, a sloped roof, a tall comb carrying the sun
  g.in(M(0, topY, -0.22), () => {
    const shx = 0.74, shz = 0.5, sH = 1.25, c0 = shx - r;
    blockBox(g, shx, shz, 0, sH, st, 1300, { top: false, holes: [[[c0 - 0.24, 0, c0 + 0.24, 0.75]], null, null, null], each: (s) => {
      if (s !== 0) return;
      g.surf(K_PLAIN, 1);
      const dk = [0.012, 0.01, 0.008];
      g.flat([[c0 - 0.24, 0, -0.2], [c0 + 0.24, 0, -0.2], [c0 + 0.24, 0.75, -0.2], [c0 - 0.24, 0.75, -0.2]], dk);
      for (const e of [-1, 1]) g.flat([[c0 + e * 0.24, 0, r], [c0 + e * 0.24, 0.75, r], [c0 + e * 0.24, 0.75, -0.2], [c0 + e * 0.24, 0, -0.2]], [mul(col, 0.5), mul(col, 0.5), dk, dk]);
      g.surf(K_STONE, 0.93);
      g.in(M(c0, 0.84, 0.03), () => g.cbox(0.74, 0.18, 0.1, 0.02, cc));
      for (const e of [-1, 1]) g.in(M(c0 + e * 0.52, 0.5, 0.004), () => glyphPanel(g, 0.3, 1310 + e, mul(col, 0.98)));
    } });
    g.surf(K_STONE, 0.93);
    g.in(M(0, sH + 0.05, 0), () => g.cbox(2 * shx + 0.16, 0.1, 2 * shz + 0.16, 0.02, cc));
    for (const [e, sgn] of [[0, 1], [0, -1]]) g.flat([[-shx - 0.06, sH + 0.1, sgn * (shz + 0.06)], [shx + 0.06, sH + 0.1, sgn * (shz + 0.06)], [shx - 0.1, sH + 0.5, sgn * (shz - 0.24)], [-shx + 0.1, sH + 0.5, sgn * (shz - 0.24)]], mul(col, 0.95));
    for (const sgn of [1, -1]) g.flat([[sgn * (shx + 0.06), sH + 0.1, shz + 0.06], [sgn * (shx + 0.06), sH + 0.1, -shz - 0.06], [sgn * (shx - 0.1), sH + 0.5, -shz + 0.24], [sgn * (shx - 0.1), sH + 0.5, shz - 0.24]], mul(col, 0.85));
    g.in(M(0, sH + 0.54, 0), () => g.cbox(2 * shx - 0.14, 0.08, 2 * shz - 0.42, 0.02, cc));
    // roof comb
    g.in(M(0, sH + 0.58, 0), () => {
      g.in(M(0, 0.65, 0), () => g.cbox(1.16, 1.3, 0.24, 0.03, cc));
      g.in(M(0, 1.34, 0), () => g.cbox(1.3, 0.1, 0.32, 0.02, cc));
      for (const x of [-0.5, -0.25, 0.25, 0.5]) g.in(M(x, 1.47, 0), () => g.cbox(0.14, 0.18, 0.24, 0.02, cc));
      g.surf(K_PLAIN, 1);
      for (const sgn of [1, -1]) for (const [x, y] of [[-0.44, 0.24], [0.44, 0.24], [-0.44, 1.06], [0.44, 1.06]]) g.flat([[x - 0.07, y - 0.1, sgn * 0.123], [x + 0.07, y - 0.1, sgn * 0.123], [x + 0.07, y + 0.1, sgn * 0.123], [x - 0.07, y + 0.1, sgn * 0.123]], [0.02, 0.018, 0.014]);
      // the sun
      g.in(M(0, 0.66, 0.125), () => {
        g.surf(K_PLAIN, 0.25, 0.95, 0.15);
        const gd = (x, y, z) => mul(GOLD, 0.9 + 0.25 * noise3(x * 9, y * 9, z * 9));
        g.in(M(0, 0, 0, 90, 0, 0), () => g.lathe([[0, 0.07], [0.1, 0.065], [0.14, 0.04], [0.2, 0.05], [0.26, 0.03], [0.31, 0.04], [0.33, 0.01], [0.33, 0]].reverse(), nq(24), gd));
        for (let i = 0; i < 16; i++) g.in(M(0, 0, 0.01, 0, 0, i * 22.5), () => plate(g, [[0.31, -0.045], [0.31, 0.045], [i % 2 ? 0.44 : 0.52, 0]], 0.02, GOLD, mul(GOLD, 0.7)));
        g.surf(K_PLAIN, 0.6); for (const e of [-1, 1]) g.in(M(e * 0.04, 0.02, 0.07), () => g.add(new THREE.SphereGeometry(0.014, 6, 4), [0.05, 0.03, 0.01]));
        g.in(M(0, -0.04, 0.066), () => g.cbox(0.07, 0.012, 0.008, 0.002, [0.05, 0.03, 0.01]));
      });
      // the crystal in its golden claw
      g.in(M(0, 1.56, 0), () => {
        g.surf(K_PLAIN, 0.25, 0.95);
        g.lathe([[0.12, -0.04], [0.09, 0.02], [0.05, 0.06]], 8, GOLD);
        for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.8; g.tube(curvePts([[Math.cos(a) * 0.05, 0.04, Math.sin(a) * 0.05], [Math.cos(a) * 0.2, 0.2, Math.sin(a) * 0.2], [Math.cos(a) * 0.17, 0.42, Math.sin(a) * 0.17]], 6), [0.02, 0.018, 0.016, 0.014, 0.012, 0.009, 0.004], 5, GOLD, true); }
        g.in(M(0, 0.08, 0), () => gem(g, 0.15, 0.6, rgb(0x0f8a8a), rgb(0xb0fff0), 1.7, 6, 0.4));
        motes(g, [[0.26, 0.5, 0.1], [-0.24, 0.3, 0.15, 0.8], [0.05, 0.8, -0.2, 0.8]], 0.022, rgb(0xb0fff0), 1.8);
      });
    });
  });
  // censers on the top stage
  for (const e of [-1, 1]) g.in(M(e * 0.8, topY, 0.72), () => { g.surf(K_STONE, 0.9); g.lathe([[0.13, 0], [0.08, 0.1], [0.07, 0.28], [0.17, 0.4], [0.19, 0.5], [0.12, 0.5]], nq(10), cc); g.in(M(0, 0.44, 0), () => fire(g, 0.32, FIRE_HOT, e, 1.4)); });
  // the jungle taking it back
  const V = [[-2.0, 0, 1], [1.7, 0, 2], [2.2, 1, 1], [-1.2, 1, 2], [1.0, 2, 1], [-1.5, 2, 1], [0.9, 3, 1]];
  V.forEach(([x, i, drop], k) => { for (const s of [0, 1, 2, 3]) { if ((k + s) % 2) continue; const hx = T[i], xx = clamp(x * (s % 2 ? -1 : 1), -hx + 0.2, hx - 0.2), y1 = (i + 1) * TH; if (s === 0 && Math.abs(xx) < sw + 0.4) continue; g.in(RY(s * 90), () => vine(g, [[xx, y1 + 0.02, hx - 0.25], [xx + 0.04, y1 + 0.03, hx + 0.08], [xx + 0.1, y1 - TH * 0.5, hx + 0.1], [xx - 0.06, y1 - TH + 0.02, hx + (drop > 1 ? 0.1 : 0.3)], ...(drop > 1 && i > 0 ? [[xx + 0.05, y1 - TH - 0.3, T[i - 1] + 0.1], [xx + 0.12, y1 - TH * 2 + 0.1, T[i - 1] + 0.12]] : [])], 1400 + k * 4 + s, JUNGLE)); } });
  for (const [x, y, z, s, sd] of [[-2.35, 0.25, -2.35, 0.46, 1], [2.4, 0.2, -2.3, 0.42, 2], [-2.2, 0.95, -2.2, 0.38, 3], [2.45, 0.2, 2.45, 0.34, 4], [-2.42, 0.2, 2.42, 0.38, 5], [1.7, 1.7, -1.9, 0.34, 6], [-1.2, 3.2, -1.3, 0.3, 7], [1.75, 0.95, 2.1, 0.26, 8], [0.75, 4.1, -0.75, 0.26, 9]]) foliage(g, x, y, z, s, s * 0.7, s, nq(Math.round(150 * s / 0.4)), mul(JUNGLE, 0.9 + 0.25 * hash1(sd, 2)), 1450 + sd, 0.17, y - s, y + s);
}

// ---------------------------------------------------------------------------------------------------
// Xibalba: solar mirror, 2 x 2
// ---------------------------------------------------------------------------------------------------
function xibalbaSunMirror(g) {
  const st = bigStone(LIME, 1500, { len: [0.4, 0.7], var: 0.1, chip: 0.12 }), col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 4);
  const gd = (k = 1) => (x, y, z) => mul(GOLD, k * (0.85 + 0.3 * noise3(x * 9, y * 9, z * 9)));
  blockBox(g, 0.9, 0.9, 0, 0.25, st, 1510, { topCol: mul(col, 0.86) });
  blockBox(g, 0.66, 0.66, 0.25, 0.75, st, 1520, { topCol: mul(col, 0.86) });
  faces4(g, 0.66, 0.66, (s, W) => {
    g.surf(K_STONE, 0.93);
    g.in(M(0, 0.7, 0), () => g.cbox(2 * W + 0.1, 0.12, 0.1, 0.02, cc));
    for (const x of [-0.36, 0, 0.36]) { g.surf(K_STONE, 0.93); g.in(M(x, 0.45, 0.004), () => glyphPanel(g, 0.28, 1530 + s * 5 + x * 9, mul(col, 0.98))); }
    g.surf(K_PLAIN, 0.25, 0.15, 0.25);
    for (const x of [-0.54, -0.18, 0.18, 0.54]) g.in(M(x, 0.7, 0.052), () => g.cbox(0.08, 0.07, 0.02, 0.006, TURQ));
  });
  g.surf(K_STONE, 0.93);
  g.in(M(0, 0, 0), () => flight(g, 0.5, 0.98, 0, 0.7, 0.25, 2, mul(col, 0.95), 5, 0.2));
  // carved drum and the turning table
  g.surf(K_STONE, 0.9);
  g.lathe([[0.44, 0.75], [0.44, 0.83], [0.37, 0.87], [0.37, 1.2], [0.43, 1.24], [0.43, 1.3], [0, 1.3]], nq(24), (x, y, z) => { const a = Math.atan2(z, x), band = y > 0.9 && y < 1.18, k = band ? (Math.sin(a * 12) * Math.sin((y - 0.9) * 34) > 0.15 ? 0.5 : 1) : 1; return mul(col, k * (0.9 + 0.18 * noise3(x * 6, y * 6, z * 6))); });
  g.surf(K_PLAIN, 0.3, 0.92);
  g.lathe([[0.4, 1.3], [0.4, 1.36], [0.3, 1.4], [0.16, 1.42], [0, 1.42]], nq(24), gd(0.9));
  for (let i = 0; i < 12; i++) g.in(RY(i * 30).multiply(M(0, 1.33, 0.4)), () => g.stud(0.022, GOLD, 5));
  // the yoke
  const py = 2.16, yx = 0.88;
  for (const e of [-1, 1]) {
    g.surf(K_PLAIN, 0.32, 0.92);
    limb(g, [[e * 0.2, 1.38, 0], [e * 0.6, 1.44, 0], [e * 0.84, 1.62, 0], [e * yx, 1.9, 0], [e * yx, py + 0.1, 0]], [0.1, 0.09, 0.085, 0.08, 0.075], { sq: 0.7, nu: nq(12), nv: nq(20), col: gd(0.85), capB: true });
    g.in(M(e * (yx - 0.1), py, 0, 0, 0, -e * 90), () => { g.lathe([[0.1, 0], [0.12, 0.03], [0.12, 0.17], [0.08, 0.2], [0, 0.21]], nq(12), gd(1)); });
    g.surf(K_PLAIN, 0.25, 0.15, 0.3); g.in(M(e * (yx + 0.105), py, 0, 0, e * 90, 0), () => g.stud(0.05, TURQ, 8));
  }
  // the dish, tipped to the noon sun
  const R = 0.76, D = 0.2, f = (R * R) / (4 * D), par = (q) => [q * R, D * q * q];
  g.in(M(0, py, 0, 38, 0, 0).multiply(M(0, -0.1, 0)), () => {
    g.surf(K_PLAIN, 0.1, 1.0, 0.08);
    g.lathe([0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map(par), nq(40), (x, y, z) => mul([1.0, 0.8, 0.34], 0.92 + 0.12 * Math.sin(Math.hypot(x, z) * 60)));
    g.surf(K_PLAIN, 0.4, 0.9);
    g.lathe([0, 0.25, 0.5, 0.75, 1].map((q) => [q * R, D * q * q - 0.035]), nq(40), gd(0.6));
    g.lathe([[R, D - 0.035], [R + 0.04, D - 0.02], [R + 0.04, D + 0.02], [R, D + 0.012]], nq(40), gd(1));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.tube([0.12, 0.4, 0.7, 1].map((q) => [Math.cos(a) * q * R, D * q * q - 0.045, Math.sin(a) * q * R]), 0.02, 4, gd(0.8), false); g.surf(K_PLAIN, 0.25, 0.15, 0.3); g.in(M(Math.cos(a + 0.26) * (R + 0.04), D, Math.sin(a + 0.26) * (R + 0.04)), () => g.add(new THREE.OctahedronGeometry(0.028, 0), TURQ)); g.surf(K_PLAIN, 0.4, 0.9); }
    g.in(M(0, -0.05, 0), () => g.lathe([[0, -0.09], [0.1, -0.07], [0.16, 0], [0.2, 0.03]], nq(12), gd(0.8)));
    // the focus: three struts and the point of fire they hold
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU + 0.5; g.tube([[Math.cos(a) * R * 0.98, D, Math.sin(a) * R * 0.98], [Math.cos(a) * 0.05, f, Math.sin(a) * 0.05]], 0.012, 4, GOLD, false); }
    g.in(M(0, f, 0), () => {
      g.surf(K_PLAIN, 0.3, 0.9); g.add(new THREE.TorusGeometry(0.075, 0.012, 4, nq(12)).rotateX(Math.PI / 2), GOLD);
      g.surf(K_PLAIN, 1, 0, 2.4); ball(g, 0.06, [1.0, 0.72, 0.28], 10, 8);
      g.surf(K_PLAIN, 1, 0, 1.6);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; g.flat([[Math.cos(a - 0.2) * 0.05, 0, Math.sin(a - 0.2) * 0.05], [Math.cos(a + 0.2) * 0.05, 0, Math.sin(a + 0.2) * 0.05], [Math.cos(a) * (i % 2 ? 0.14 : 0.2), 0, Math.sin(a) * (i % 2 ? 0.14 : 0.2)]], [1.0, 0.6, 0.15]); }
      g.flat([[-0.012, 0, 0], [0.012, 0, 0], [0.004, 0.75, 0], [-0.004, 0.75, 0]], [[1.0, 0.7, 0.25], [1.0, 0.7, 0.25], [1.0, 0.45, 0.1], [1.0, 0.45, 0.1]]);
      g.flat([[0, 0, -0.012], [0, 0, 0.012], [0, 0.75, 0.004], [0, 0.75, -0.004]], [[1.0, 0.7, 0.25], [1.0, 0.7, 0.25], [1.0, 0.45, 0.1], [1.0, 0.45, 0.1]]);
    });
  });
  // creepers at its foot
  vine(g, [[-0.6, 0.76, 0.5], [-0.72, 0.6, 0.68], [-0.75, 0.3, 0.7], [-0.84, 0.26, 0.84], [-0.88, 0.05, 0.88]], 1540, JUNGLE);
  vine(g, [[0.5, 0.76, -0.6], [0.69, 0.6, -0.66], [0.7, 0.28, -0.75], [0.88, 0.24, -0.8], [0.88, 0.04, -0.88]], 1541, JUNGLE);
  for (let i = 0; i < 5; i++) { const a = i * 1.3 + 0.4; g.in(M(Math.cos(a) * 0.84, 0, Math.sin(a) * 0.84), () => tuft(g, 7, 0.15, 1550 + i, mul(JUNGLE, 1.3))); }
}

// ---------------------------------------------------------------------------------------------------
// Velikaya: onion-domed cathedral, 4 x 5 (porch toward +Z)
// ---------------------------------------------------------------------------------------------------
/** a keel-arched gable (kokoshnik) on the local XY plane: base 2R wide on y = 0, facing +Z */
function kokoshnik(g, R, col, paint, seed = 0) {
  const n = 12, pts = [];
  for (let k = 0; k <= n; k++) { const t = (k / n) * Math.PI, s = Math.sin(t); pts.push([Math.cos(t) * R, s * R * (0.95 + 0.4 * Math.pow(s, 8))]); }
  g.surf(K_PLASTER, 0.9);
  plate(g, pts, 0.14, col, mul(col, 0.85));
  g.surf(K_PLAIN, 0.7);
  const q = pts.map(([x, y]) => [x * 0.72, 0.06 + y * 0.72]);
  for (let k = 0; k < n; k++) g.flat([[0, 0.06, 0.074], [q[k][0], q[k][1], 0.074], [q[k + 1][0], q[k + 1][1], 0.074]], mul(paint, 0.85 + 0.3 * hash1(k, seed)));
  g.surf(K_PLAIN, 0.4, 0.8);
  g.tube(q.map(([x, y]) => [x, y, 0.078]), 0.022, 4, GOLD, false);
  g.in(M(0, R * 0.34, 0.08), () => g.add(new THREE.OctahedronGeometry(R * 0.13, 0).scale(1, 1.3, 0.4), GOLD));
  g.in(M(0, pts[n / 2][1] - 0.06, 0), () => snow(g, R * 0.5, 0.1, 0.08, seed));
}
function velikayaOnionCathedral(g) {
  const WH = 0xeeeae2, white = rgb(WH), st = palStone(shades(WH, [1, 1, 0.96, 1.02, 0.93]), 1600, { mortar: mul(white, 0.6), var: 0.03, chip: 0.02, r: 0.008, tilt: 0.08 }), r = st.r;
  const wc = (x, y, z) => mul(white, 0.92 + 0.12 * noise3(x * 3, y * 3, z * 3)), RED = rgb(0xa8382a), GREEN = [0x2f7a5a, 0x27704e, 0x3a8a66, 0x1f6444].map((h) => rgb(h));
  const AMB = [rgb(0xf0b040), rgb(0xe88a28), rgb(0xf8d470), rgb(0xd86a20)], cz = -0.45, hx = 1.4, hz = 1.45, wH = 2.75;
  const win = (seed, w = 0.22, h = 0.75) => { glassWindow(g, w, h, seed, { pointed: false, glow: 1.0, pal: AMB, frame: mul(RED, 1.1), nx: 2, mould: 0.026 }); g.in(M(0, h + 0.02, 0.02), () => snow(g, w * 0.6, 0.05, 0.035, seed)); };
  g.in(M(0, 0, cz), () => {
    const bay = [-0.86, 0, 0.86];
    stoneBox(g, hx, hz, 0, wH, st, 1610, { holes: [0, 1, 2, 3].map((s) => { const c0 = (s % 2 ? hz : hx) - r; return (s === 0 ? [-0.86, 0.86] : bay).map((x) => [c0 + x - 0.11, 1.0, c0 + x + 0.11, 1.75]); }), each: (s, W) => { for (const x of s === 0 ? [-0.86, 0.86] : bay) g.in(M(W - r + x, 1.0, 0), () => win(1620 + s * 5 + x * 3)); } });
    faces4(g, hx, hz, (s, W) => {
      g.surf(K_PLASTER, 0.9);
      for (const x of [-W + 0.09, -W / 3 - 0.02, W / 3 + 0.02, W - 0.09]) g.in(M(x, wH / 2, 0.03), () => g.cbox(0.16, wH, 0.07, 0.014, wc));
      band(g, [[0.07, 0.32], [0.07, 0.4], [0, 0.48]], 2 * W, mul(white, 0.95), 1630 + s, 1, 1);
      g.surf(K_PLAIN, 0.8);
      g.in(M(0, wH - 0.3, 0.03), () => g.cbox(2 * W + 0.04, 0.07, 0.06, 0.012, RED));
      for (let k = 0; k < 12; k++) g.in(M(-W + (k + 0.5) * ((2 * W) / 12), wH - 0.2, 0.03, 0, 0, 45), () => g.cbox(0.07, 0.07, 0.05, 0.01, k % 2 ? RED : mul(GREEN[0], 1.2)));
      g.surf(K_PLASTER, 0.9);
      band(g, [[0, wH - 0.14], [0.08, wH - 0.1], [0.1, wH - 0.02], [0, wH + 0.02]], 2 * W, white, 1635 + s, 1, 1);
      // a row of kokoshniks along the head of the wall
      const R = W / 3 - 0.01, paints = [rgb(0x2a4a9a), RED, rgb(0x2f7a5a)];
      for (let k = 0; k < 3; k++) g.in(M((k - 1) * (2 * W / 3), wH, -0.05), () => kokoshnik(g, R, white, paints[(k + s) % 3], 1640 + s * 3 + k));
      for (const e of [-1, 1]) g.in(M(e * (W - 0.3), 0, 0.2), () => snow(g, 0.34, 0.16, 0.1, s + e));
    });
    hipRoof(g, hx - 0.06, hz - 0.06, wH + 0.05, wH + 0.72, 0.03, GREEN, 1650, { tw: 0.18, th: 0.16, ridgeCol: mul(GREEN[0], 0.6) });
    // drums and domes: gold in the middle, four painted ones round it
    const dom = (x, z, R, y0, y1, pat, seed) => g.in(M(x, 0, z), () => {
      const circ = (R - r) * TAU, nw = R > 0.4 ? 8 : 4;
      drum(g, R, y0, y1 - y0, st, seed, { each: () => {
        for (let i = 0; i < nw; i++) g.in(M(((i + 0.5) / nw) * circ, (y1 - y0) * 0.3, r + 0.002), () => { g.surf(K_PLAIN, 0.3, 0, 1.1); const w = R * 0.16, h = (y1 - y0) * 0.42; g.flat([[-w, 0, 0], [w, 0, 0], [w, h, 0], [0, h + w * 1.2, 0], [-w, h, 0]], [[1.0, 0.6, 0.16], [1.0, 0.6, 0.16], [1.0, 0.42, 0.08], [1.0, 0.42, 0.08], [1.0, 0.42, 0.08]]); g.surf(K_PLAIN, 0.8); g.tube([[-w - 0.015, 0, 0.004], [-w - 0.015, h, 0.004], [0, h + w * 1.5, 0.004], [w + 0.015, h, 0.004], [w + 0.015, 0, 0.004]], 0.016, 4, RED, false); });
      } });
      g.surf(K_PLASTER, 0.9);
      g.lathe([[R, y1 - 0.2], [R + 0.05, y1 - 0.16], [R + 0.05, y1 - 0.1], [R + 0.02, y1 - 0.06], [R + 0.08, y1], [R * 0.9, y1 + 0.04]], nq(20), wc);
      g.lathe([[R + 0.06, y0 - 0.02], [R + 0.06, y0 + 0.08], [R, y0 + 0.14]], nq(20), wc);
      for (let i = 0; i < nw * 2; i++) g.in(RY((i + 0.5) * (360 / (nw * 2))).multiply(M(0, y1 - 0.28, R + 0.01)), () => { g.surf(K_PLAIN, 0.8); g.cbox(R * 0.2, 0.06, 0.03, 0.008, i % 2 ? RED : mul(GREEN[0], 1.2)); });
      const Ro = R / 0.6, Ho = Ro * 2.05;
      g.in(M(0, y1 + 0.02, 0), () => { pat(Ro, Ho); g.in(M(0, Ho - 0.03, 0), () => spear(g, Ro * 1.15)); g.in(M(0, Ho * 0.66, 0), () => snow(g, Ro * 0.26, Ro * 0.26, 0.05, seed)); });
    });
    const gold = (i) => mul(GOLD, i % 2 ? 1.0 : 0.82), BL = rgb(0x1f4aa8), GR2 = rgb(0x2f9a4a), YL = rgb(0xe8c030), RD = rgb(0xc02a22), TQ = rgb(0x2fb0b8), OR = rgb(0xe07a20), WT = rgb(0xf0ece4);
    dom(0, 0, 0.52, wH + 0.5, 5.0, (R, H) => onion(g, R, H, 16, 1, gold, { rough: 0.25, metal: 0.92, su: nq(3) }), 1660);
    dom(0.94, 0.98, 0.3, wH + 0.3, 3.95, (R, H) => onion(g, R, H, 12, 1, (i) => (i % 2 ? GR2 : YL), { twist: 0.5 }), 1670);
    dom(-0.94, 0.98, 0.3, wH + 0.3, 3.95, (R, H) => onion(g, R, H, 12, 8, (i, j) => (i % 3 === 0 && j % 2 === 1 && j < 7 ? mul(GOLD, 1.1) : mul(BL, 0.85 + 0.3 * hash1(i, j)))), 1680);
    dom(0.94, -0.98, 0.3, wH + 0.3, 4.15, (R, H) => onion(g, R, H, 14, 1, (i) => (i % 2 ? RD : WT), { twist: -0.35 }), 1690);
    dom(-0.94, -0.98, 0.3, wH + 0.3, 4.15, (R, H) => onion(g, R, H, 12, 9, (i, j) => ((i + j) % 2 ? TQ : OR), { twist: 0.12 }), 1700);
    for (let i = 0; i < 8; i++) g.in(RY(i * 45 + 22.5).multiply(M(0, wH + 0.42, 0.56)), () => kokoshnik(g, 0.2, white, i % 2 ? RED : rgb(0x2a4a9a), 1710 + i));
    // three apses at the east end
    for (const [x, R, h] of [[0, 0.46, 2.1], [-0.82, 0.34, 1.7], [0.82, 0.34, 1.7]]) g.in(M(x, 0, -hz, 0, 180, 0), () => {
      g.surf(K_STONE, 0.93);
      const L = Math.PI * (R - r);
      g.bend(R - r, () => g.in(M(-L / 2, 0, 0), () => { g.ashlar(L, h, { ...st, seed: 1720 + x * 5, ends: [CUT, CUT, 0, 0], holes: [[L / 2 - 0.08, 0.75, L / 2 + 0.08, 1.25]] }); g.in(M(L / 2, 0.75, 0), () => win(1725 + x * 3, 0.16, 0.5)); }));
      g.surf(K_ROOF, 0.6);
      g.in(M(0, h, 0), () => g.sheet(nq(14), nq(6), (u, v) => { const a = lerp(-Math.PI / 2, Math.PI / 2, u), q = (R + 0.05) * Math.cos(v * Math.PI / 2); return [Math.sin(a) * q, R * 0.8 * Math.sin(v * Math.PI / 2), Math.cos(a) * q]; }, (px, py, pz) => mul(GREEN[0], 0.85 + 0.3 * noise3(px * 8, py * 8, pz * 8))));
      g.in(M(0, h + R * 0.7, R * 0.3), () => snow(g, R * 0.5, R * 0.4, 0.07, x));
    });
  });
  // the porch under its tent roof
  const pz = 1.5, ph = 0.56, pH = 1.9, A = archOf(0.3, 1.0, 0.3, 0.12);
  g.in(M(0, 0, pz), () => {
    stoneBox(g, ph, 0.5, 0, pH, st, 1740, { skip: [2], holes: [archHoles(A, ph - r, 0, 6, r, st.course), [[0.5 - r - 0.1, 0.75, 0.5 - r + 0.1, 1.25]], null, [[0.5 - r - 0.1, 0.75, 0.5 - r + 0.1, 1.25]]], each: (s, W) => {
      if (s === 0) g.in(M(W - r, 0, 0), () => { g.surf(K_PLAIN, 0.8); g.tube([[-A.half - 0.04, 0, 0.02], ...Array.from({ length: 9 }, (_, k) => { const x = -A.half + (k / 8) * 2 * A.half; return [x * 1.12, A.y(x) + 0.05, 0.02]; }), [A.half + 0.04, 0, 0.02]], 0.04, 5, RED, true); archReveal(g, A, 0.14, white); g.in(M(0, 0, -0.1), () => archDoors(g, A, rgb(0x5a3a24), 3, 0.05, 4)); });
      else if (s % 2) g.in(M(W - r, 0.75, 0), () => win(1745 + s, 0.2, 0.5));
    } });
    faces4(g, ph, 0.5, (s, W) => { if (s === 2) return; g.surf(K_PLASTER, 0.9); band(g, [[0, pH - 0.12], [0.07, pH - 0.08], [0.09, pH], [0, pH + 0.03]], 2 * W, white, 1750 + s, 1, 1); if (s === 0) g.in(M(0, pH, -0.04), () => kokoshnik(g, 0.42, white, rgb(0x2a4a9a), 1755)); else g.in(M(0, pH, -0.04), () => kokoshnik(g, 0.36, white, RED, 1756 + s)); });
    g.in(M(0, pH + 0.3, 0), () => {
      g.surf(K_PLASTER, 0.9); g.lathe([[0.44, -0.3], [0.44, 0.12], [0.5, 0.16], [0.5, 0.22]], 8, wc, Math.PI / 8, TAU + Math.PI / 8);
      g.surf(K_ROOF, 0.6);
      g.lathe([[0.56, 0.2], [0.5, 0.3], [0.12, 1.7], [0.1, 1.8]], 8, (x, y, z) => mul(GREEN[Math.floor(y * 9) % 4], 0.9 + 0.2 * noise3(x * 9, y * 9, z * 9)), Math.PI / 8, TAU + Math.PI / 8);
      g.surf(K_PLASTER, 0.9);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; g.tube([[Math.cos(a) * 0.57, 0.2, Math.sin(a) * 0.57], [Math.cos(a) * 0.51, 0.3, Math.sin(a) * 0.51], [Math.cos(a) * 0.125, 1.7, Math.sin(a) * 0.125]], 0.022, 4, white, false); }
      for (let i = 0; i < 4; i++) g.in(RY(i * 90).multiply(M(0, 0.62, 0.4, -15, 0, 0)), () => { g.surf(K_PLAIN, 0.3, 0, 1.0); g.flat([[-0.05, 0, 0], [0.05, 0, 0], [0.05, 0.13, 0], [0, 0.2, 0], [-0.05, 0.13, 0]], [1.0, 0.5, 0.1]); g.surf(K_PLASTER, 0.9); g.in(M(0, 0.1, -0.05), () => g.cbox(0.16, 0.26, 0.1, 0.014, white)); });
      g.in(M(0, 1.78, 0), () => { onion(g, 0.24, 0.5, 10, 6, (i, j) => (i % 2 === 0 && j % 2 === 1 ? mul(GOLD, 1.1) : rgb(0x1f4aa8))); g.in(M(0, 0.48, 0), () => spear(g, 0.34)); });
      g.in(M(0.2, 0.34, 0.3), () => snow(g, 0.2, 0.14, 0.06, 5));
    });
    g.surf(K_STONE, 0.93);
    flight(g, 0.9, 0.96, 0, 0.5, 0.2, 3, mul(white, 0.86), 4, 0.2);
    for (const e of [-1, 1]) g.in(M(e * 0.56, 0.2, 0.74), () => { g.cbox(0.2, 0.4, 0.44, 0.03, wc); g.in(M(0, 0.2, 0), () => snow(g, 0.1, 0.2, 0.06, e)); });
  });
  // drifts against the walls
  for (const [x, z, rx, rz, sd] of [[-1.62, 0.7, 0.3, 0.6, 1], [1.64, -0.6, 0.28, 0.7, 2], [-1.1, 1.3, 0.45, 0.3, 3], [1.15, 1.32, 0.42, 0.3, 4], [-1.6, -1.5, 0.32, 0.5, 5], [0.45, -2.3, 0.4, 0.16, 6]]) g.in(M(x, 0, z), () => snow(g, rx, rz, 0.16, sd));
}

// ---------------------------------------------------------------------------------------------------
// Velikaya: boyar manor, 4 x 3 (front and porch stair toward +Z)
// ---------------------------------------------------------------------------------------------------
/** a carved and painted window surround (nalichnik) with shutters: local origin at the middle of the window, +Z out */
function nalichnik(g, w, h, seed, c1, c2, lit = true) {
  if (lit) g.surf(K_PLAIN, 0.4, 0, 1.0); else g.surf(K_PLAIN, 0.12, 0.3);
  g.flat([[-w / 2, -h / 2, 0.02], [w / 2, -h / 2, 0.02], [w / 2, h / 2, 0.02], [-w / 2, h / 2, 0.02]], lit ? [[1.0, 0.5, 0.12], [1.0, 0.5, 0.12], [1.0, 0.7, 0.28], [1.0, 0.7, 0.28]] : [0.03, 0.05, 0.08]);
  g.surf(K_WOOD, 0.8);
  g.in(M(0, 0, 0.03), () => { g.cbox(0.02, h, 0.02, 0.004, c1); g.cbox(w, 0.02, 0.02, 0.004, c1); });
  for (const e of [-1, 1]) g.in(M(e * (w / 2 + 0.035), 0, 0.03), () => g.cbox(0.07, h + 0.14, 0.05, 0.01, c1));
  g.in(M(0, -h / 2 - 0.045, 0.035), () => g.cbox(w + 0.22, 0.07, 0.07, 0.012, c1));
  for (let k = 0; k < 5; k++) g.in(M((k - 2) * (w + 0.1) / 5, -h / 2 - 0.1, 0.03, 0, 0, 45), () => g.cbox(0.05, 0.05, 0.03, 0.006, k % 2 ? c2 : c1));
  g.in(M(0, h / 2 + 0.05, 0.035), () => g.cbox(w + 0.24, 0.06, 0.08, 0.012, c1));
  g.in(M(0, h / 2 + 0.08, 0.03), () => plate(g, [[-w / 2 - 0.1, 0], [w / 2 + 0.1, 0], [w / 2 + 0.04, 0.06], [w * 0.2, 0.09], [0, 0.2], [-w * 0.2, 0.09], [-w / 2 - 0.04, 0.06]], 0.04, c1, mul(c1, 0.8)));
  g.surf(K_PLAIN, 0.7);
  g.in(M(0, h / 2 + 0.14, 0.052, 0, 0, 45), () => g.cbox(0.06, 0.06, 0.012, 0.003, rgb(0xc03a2a)));
  g.surf(K_WOOD, 0.8);
  for (const e of [-1, 1]) g.in(M(e * (w / 2 + 0.07 + w * 0.25), 0, 0.02), () => { g.cbox(w * 0.46, h + 0.04, 0.03, 0.008, woodTint(c2, seed + e)); g.surf(K_PLAIN, 0.7); for (const y of [-h * 0.22, h * 0.22]) g.in(M(0, y, 0.017, 0, 0, 45), () => g.cbox(w * 0.2, w * 0.2, 0.008, 0.002, rgb(0xc03a2a))); g.surf(K_WOOD, 0.8); });
  g.in(M(0, h / 2 + 0.27, 0.05), () => snow(g, w * 0.4, 0.05, 0.035, seed));
}
/** the carved horse's head that ends a ridge log: on the local XY plane, the neck rising from the origin and looking toward +X */
function horseHead(g, s, col) {
  const P = [[-0.5, -0.12], [0.0, -0.14], [0.22, 0.1], [0.3, 0.5], [0.46, 0.62], [0.74, 0.5], [0.86, 0.36], [0.82, 0.28], [0.6, 0.34], [0.5, 0.3], [0.42, 0.06], [0.2, -0.2], [0.0, -0.3], [-0.5, -0.28]];
  // mane and ear side: mirror so the back of the neck is a clean curve
  const top = [[-0.5, 0.02], [-0.1, 0.06], [0.08, 0.3], [0.14, 0.62], [0.26, 0.8], [0.3, 0.92], [0.36, 0.78], [0.5, 0.74], [0.74, 0.6], [0.88, 0.46], [0.86, 0.36], [0.8, 0.32], [0.62, 0.4], [0.5, 0.36], [0.4, 0.14], [0.2, -0.1], [0.0, -0.14], [-0.5, -0.14]];
  g.surf(K_WOOD, 0.85);
  plate(g, top.map(([x, y]) => [x * s, y * s]), 0.09 * s + 0.03, col, mul(col, 0.75));
  g.surf(K_PLAIN, 0.6); for (const e of [-1, 1]) g.in(M(0.5 * s, 0.62 * s, e * (0.045 * s + 0.016)), () => g.add(new THREE.SphereGeometry(0.03 * s, 6, 4), [0.03, 0.02, 0.015]));
}
function velikayaBoyarManor(g) {
  const logc = rgb(0x8a6844), dark = rgb(0x4a3624), WHT = rgb(0xe8e2d4), BLU = rgb(0x2a5aa8), shing = [0x6a5846, 0x7a6852, 0x5a4a3c, 0x84705a, 0x4e4238].map((h) => rgb(h));
  const x0 = -1.78, x1 = 0.9, zb = -1.25, zf = 0.45, cz = (zb + zf) / 2, R = 0.088, dY = 0.166, N = 12, wH = 0.12 + N * dY, eZ = (zf - zb) / 2 + 0.3, eY = wH - 0.08, rY = 3.85;
  const lg = (seed) => ({ bark: mul(logc, 0.85 + 0.3 * hash1(seed, 3)), amp: 0.05, seg: nq(9), vseg: 3, capB: true, heart: rgb(0xd8b888) });
  // snowy ground
  g.surf(K_PLAIN, 0.9);
  g.sheet(nq(16), nq(12), (u, v) => [lerp(-1.97, 1.97, u), 0.03 + 0.05 * noise3(u * 5, 2, v * 4) - (u === 0 || u === 1 || v === 0 || v === 1 ? 0.08 : 0), lerp(-1.47, 1.47, v)], (x, y, z) => mix(mul(SNOW, 0.86 + 0.14 * noise3(x * 3, 1, z * 3)), rgb(0x6a5a44), smooth(0.62, 0.8, noise3(x * 2.5 + 3, 4, z * 2.5)) * 0.7));
  // walls of stacked logs, crossed at the corners
  for (let j = 0; j < N; j++) {
    const y = 0.12 + R + j * dY;
    for (const z of [zf - R, zb + R]) g.in(M(x0 - 0.16, y, z, 0, 0, -90), () => log(g, R, R, x1 - x0 + 0.32, 1800 + j * 4 + (z > 0 ? 1 : 0), lg(j * 7 + (z > 0 ? 1 : 3))));
    for (const x of [x0 + R, x1 - R]) g.in(M(x, y + dY / 2, zb - 0.16, 90, 0, 0), () => log(g, R, R, zf - zb + 0.32, 1850 + j * 4 + (x > 0 ? 1 : 0), lg(j * 5 + (x > 0 ? 2 : 4))));
  }
  g.surf(K_PLAIN, 1);
  for (const [a, b] of [[[x0 + R, zf - R], [x1 - R, zf - R]], [[x1 - R, zf - R], [x1 - R, zb + R]], [[x1 - R, zb + R], [x0 + R, zb + R]], [[x0 + R, zb + R], [x0 + R, zf - R]]]) g.flat([[a[0], 0.05, a[1]], [b[0], 0.05, b[1]], [b[0], wH + 0.1, b[1]], [a[0], wH + 0.1, a[1]]], [0.03, 0.022, 0.016]);
  g.surf(K_STONE, 0.95);
  g.in(M((x0 + x1) / 2, 0.06, cz), () => g.cbox(x1 - x0 + 0.06, 0.16, zf - zb + 0.06, 0.03, stoneTint(rgb(0x7a766e), 3, 5)));
  // windows: plain below, carved and painted above; a low door to the undercroft
  for (const x of [-1.38, -0.44, 0.5]) g.in(M(x, 1.5, zf + 0.012), () => nalichnik(g, 0.26, 0.36, 1900 + x * 9, WHT, BLU));
  for (const x of [-1.38, 0.5]) g.in(M(x, 0.62, zf + 0.012), () => nalichnik(g, 0.2, 0.2, 1910 + x * 9, WHT, BLU, false));
  g.in(M(-0.44, 0.14, zf + 0.004), () => { g.surf(K_WOOD, 0.85); g.in(M(0, 0.38, 0.02), () => g.cbox(0.5, 0.82, 0.05, 0.012, woodTint(dark, 3))); plankDoor(g, 0.38, 0.7, rgb(0x5a4028), 7, 3); });
  for (const x of [-1.2, -0.3]) g.in(M(x, 1.5, zb - 0.012, 0, 180, 0), () => nalichnik(g, 0.26, 0.36, 1920 + x * 9, WHT, BLU));
  g.in(M(x0 - 0.012, 1.5, cz, 0, -90, 0), () => nalichnik(g, 0.26, 0.36, 1930, WHT, BLU));
  // the steep shingled roof, boarded gables, the ridge log with its horses
  const rx0 = x0 - 0.2, rx1 = x1 + 0.2;
  gableRoof(g, { x0: rx0, x1: rx1, zc: cz, eZ, eY, rY, pal: shing, seed: 1940, tw: 0.15, th: 0.15, ridge: false, round: true });
  for (const e of [-1, 1]) {
    const gx = e > 0 ? x1 - 0.02 : x0 + 0.02;
    g.in(M(gx, 0, cz, 0, e * 90, 0), () => {
      boarded(g, (zf - zb) / 2, wH, (x) => eY + (1 - Math.abs(x) / eZ) * (rY - eY) - 0.06, mul(logc, 0.9), 1950 + e, 0.13);
      g.in(M(0, wH + 0.55, 0.03), () => nalichnik(g, 0.2, 0.26, 1955 + e, WHT, BLU));
      g.surf(K_WOOD, 0.8);
      g.in(M(0, wH + 1.1, 0.04), () => { g.in(M(0, 0, 0, 90, 0, 0), () => g.cyl(0.11, 0.11, 0.02, nq(12), WHT, false, true)); for (let i = 0; i < 8; i++) g.in(M(0, 0, 0.024, 0, 0, i * 45), () => g.cbox(0.2, 0.02, 0.008, 0.002, rgb(0xc03a2a))); });
    });
    // carved barge boards, the towel board at the apex
    const bx = e > 0 ? rx1 + 0.012 : rx0 - 0.012;
    g.surf(K_WOOD, 0.8);
    for (const s of [-1, 1]) { g.beamTo([bx, eY - 0.1, cz + s * (eZ + 0.02)], [bx, rY - 0.04, cz], 0.16, 0.04, 0.008, woodTint(WHT, e + s), 3); for (let k = 0; k < 9; k++) { const t = (k + 0.5) / 9; g.in(M(bx, lerp(eY - 0.1, rY - 0.04, t) - 0.1, cz + s * lerp(eZ + 0.02, 0, t), 45, 0, 0), () => g.cbox(0.036, 0.07, 0.07, 0.008, k % 2 ? BLU : WHT)); } }
    g.in(M(bx, rY - 0.34, cz), () => g.cbox(0.04, 0.5, 0.12, 0.01, woodTint(WHT, 5)));
    g.in(M(bx, rY - 0.62, cz, 45, 0, 0), () => g.cbox(0.045, 0.12, 0.12, 0.01, BLU));
  }
  g.in(M(rx0 - 0.02, rY + 0.03, cz, 0, 0, -90), () => log(g, 0.075, 0.075, rx1 - rx0 + 0.04, 1960, { bark: dark, amp: 0.04, seg: nq(9), vseg: 4, capB: true }));
  g.in(M(rx1 - 0.12, rY + 0.06, cz), () => horseHead(g, 0.42, mul(dark, 1.2)));
  g.in(M(rx0 + 0.12, rY + 0.06, cz, 0, 180, 0), () => horseHead(g, 0.42, mul(dark, 1.2)));
  // snow lying on the slopes, ice along the eaves
  for (const e of [1, -1]) {
    g.surf(K_PLAIN, 0.85);
    g.sheet(nq(26), nq(6), (u, v) => { const x = lerp(rx0 + 0.02, rx1 - 0.02, u), lo = 0.42 + 0.42 * noise3(x * 1.7 + e * 5, 3, 1) + (e > 0 ? 0.1 : 0), k = lerp(lo, 0.985, v), th = 0.05 * Math.sin(Math.PI * Math.min(1, v * 1.4 + 0.12)) + 0.025; return [x, lerp(eY, rY, k) + th * 0.8 + 0.02, cz + e * (lerp(eZ, 0, k) + th * 0.6)]; }, (x, y, z) => mul(SNOW, 0.9 + 0.12 * noise3(x * 4, y * 4, z * 4)));
    g.in(M(0, eY - 0.02, cz + e * (eZ + 0.01)), () => icicles(g, rx0 + 0.05, rx1 - 0.05, nq(30), 0.3, 1970 + e));
    g.in(M((rx0 + rx1) / 2, eY + 0.03, cz + e * (eZ - 0.07)), () => { for (let k = 0; k < 5; k++) g.in(M(-1.3 + k * 0.66 + 0.1 * Math.sin(k * 5 + e), 0, 0), () => snow(g, 0.24, 0.09, 0.07, k + e)); });
  }
  // chimney
  g.in(M(-0.95, 0, cz - 0.35), () => { chimney(g, 0.16, 0.14, 2.8, 4.25, 0xd8d2c4, 1980, 1); g.in(M(0, 4.3, 0), () => snow(g, 0.14, 0.1, 0.05, 2)); g.in(M(0, 4.4, 0), () => smoke(g, 1.0, 1981)); });
  // the covered porch and its stair
  const px0 = x1 + 0.04, px1 = 1.92, pz0 = -0.35, pz1 = zf + 0.05, pY = 1.02, pcx = (px0 + px1) / 2, tb = (s, k = 1) => woodTint(mul(logc, k * (0.8 + 0.4 * hash1(s, 5))), s);
  g.surf(K_WOOD, 0.88);
  for (let i = 0; i < 6; i++) g.in(M(px0 + (i + 0.5) * ((px1 - px0) / 6), pY - 0.025, (pz0 + pz1) / 2, 0, 90, 0), () => g.beam(pz1 - pz0, 0.05, (px1 - px0) / 6 - 0.008, 0.008, tb(i), 2));
  for (const [x, z] of [[px0 + 0.06, pz0 + 0.06], [px1 - 0.06, pz0 + 0.06], [px0 + 0.06, pz1 - 0.06], [px1 - 0.06, pz1 - 0.06]]) g.in(M(x, 0, z), () => {
    g.cyl(0.07, 0.065, pY - 0.05, 8, tb(x * 9 + z, 0.8), false, false);
    g.in(M(0, pY, 0), () => g.lathe([[0.05, 0], [0.05, 0.1], [0.07, 0.16], [0.04, 0.3], [0.055, 0.55], [0.075, 0.66], [0.045, 0.74], [0.05, 0.95], [0.07, 1.0]], 8, (px, py) => (py > 0.12 && py < 0.2) || (py > 0.62 && py < 0.7) ? BLU : mul(WHT, 0.95)));
  });
  g.in(M(pcx, pY + 1.0, 0), () => { for (const z of [pz0 + 0.06, pz1 - 0.06]) g.in(M(0, 0.03, z), () => g.beam(px1 - px0 + 0.1, 0.07, 0.08, 0.01, tb(z * 7, 0.9), 2)); });
  g.in(M(pcx, 0, 0, 0, 90, 0), () => gableRoof(g, { x0: -pz1 - 0.16, x1: -pz0 + 0.1, eZ: (px1 - px0) / 2 + 0.12, eY: pY + 1.04, rY: pY + 1.72, pal: shing, seed: 1990, tw: 0.13, th: 0.13, ridgeR: 0.045, ridgeCol: dark, barge: WHT, round: true }));
  g.in(M(pcx, pY + 1.06, pz1 + 0.17), () => { g.surf(K_WOOD, 0.8); plate(g, [[-0.55, 0], [0.55, 0], [0, 0.6]], 0.03, WHT, mul(WHT, 0.8)); g.surf(K_PLAIN, 0.7); g.in(M(0, 0.2, 0.02, 0, 0, 45), () => g.cbox(0.12, 0.12, 0.01, 0.002, rgb(0xc03a2a))); icicles(g, -0.5, 0.5, 8, 0.16, 7); });
  g.in(M(pcx, pY + 1.5, 0.05), () => snow(g, 0.3, 0.42, 0.1, 9));
  // rails round the landing, the upper door
  g.surf(K_WOOD, 0.85);
  g.in(M(px1 - 0.05, pY + 0.42, (pz0 + pz1) / 2, 0, 90, 0), () => g.beam(pz1 - pz0 - 0.1, 0.05, 0.05, 0.01, WHT, 2));
  for (let k = 0; k < 5; k++) g.in(M(px1 - 0.05, pY, pz0 + 0.14 + k * ((pz1 - pz0 - 0.28) / 4)), () => g.lathe([[0.02, 0], [0.035, 0.12], [0.018, 0.22], [0.03, 0.34], [0.02, 0.42]], 6, k % 2 ? BLU : WHT));
  g.in(M(pcx, pY + 0.42, pz0 + 0.05), () => g.beam(px1 - px0 - 0.1, 0.05, 0.05, 0.01, WHT, 2));
  g.in(M(x1 + 0.004, pY, 0.02, 0, 90, 0), () => { g.surf(K_WOOD, 0.85); g.in(M(0, 0.42, 0.02), () => g.cbox(0.52, 0.9, 0.05, 0.012, WHT)); plankDoor(g, 0.4, 0.8, BLU, 9, 3); });
  // stair down to the yard
  const sn = 7, sz1 = 1.42;
  g.surf(K_WOOD, 0.88);
  for (let i = 0; i < sn; i++) { const t = (i + 0.5) / sn; g.in(M(pcx, pY - (i + 1) * (pY / (sn + 1)), lerp(pz1, sz1, t)), () => g.cbox(px1 - px0 - 0.16, 0.045, (sz1 - pz1) / sn + 0.03, 0.008, tb(i + 20))); }
  for (const x of [px0 + 0.07, px1 - 0.07]) {
    g.beamTo([x, pY - 0.08, pz1], [x, 0.02, sz1 + 0.02], 0.14, 0.04, 0.008, tb(x * 3, 0.8), 2);
    g.beamTo([x, pY + 0.42, pz1], [x, 0.5, sz1], 0.045, 0.045, 0.01, WHT, 2);
    g.in(M(x, 0, sz1), () => g.lathe([[0.04, 0], [0.04, 0.3], [0.05, 0.4], [0.03, 0.46], [0.045, 0.56]], 6, WHT));
    for (let k = 1; k < 4; k++) { const t = k / 4; g.in(M(x, lerp(pY, 0.06, t), lerp(pz1, sz1, t)), () => g.cyl(0.016, 0.016, 0.42, 5, k % 2 ? BLU : WHT, false, false)); }
  }
  // drifts, a woodpile under the eaves
  for (const [x, z, rx, rz, sd] of [[-1.5, 0.75, 0.4, 0.26, 1], [0.2, 0.7, 0.5, 0.22, 2], [-1.9, -0.4, 0.14, 0.6, 3], [1.4, -0.9, 0.5, 0.4, 4], [-0.6, -1.38, 0.8, 0.12, 5]]) g.in(M(x, 0.02, z), () => snow(g, rx, rz, 0.16, sd));
  [[0, 0], [1, 0], [2, 0], [3, 0], [0.5, 1], [1.5, 1], [2.5, 1]].forEach(([i, j], k) => g.in(M(-1.1 + i * 0.12, 0.2 + j * 0.105, zf + 0.06, 90, 0, 4 * hash1(k, 2) - 2), () => log(g, 0.056, 0.054, 0.36, 1995 + k, { capB: true, seg: nq(8), vseg: 2 })));
  g.in(M(-0.92, 0.42, zf + 0.24), () => snow(g, 0.22, 0.17, 0.05, 8));
}

// ---------------------------------------------------------------------------------------------------
// Tianlong: pagoda palace, 4 x 4 (stair toward +Z)
// ---------------------------------------------------------------------------------------------------
const LACQUER = rgb(0xa8201c), JADE = [0x2f8a5c, 0x278052, 0x3a9868, 0x1f7048, 0x34906a].map((h) => rgb(h));
/** a low railing between posts along local X from x0 to x1 */
function lacquerRail(g, x0, x1, h, col = LACQUER, capc = GOLD) {
  const n = Math.max(1, Math.round((x1 - x0) / 0.5));
  g.surf(K_WOOD, 0.5);
  for (const y of [h * 0.45, h * 0.9]) g.in(M((x0 + x1) / 2, y, 0), () => g.cbox(x1 - x0, 0.035, 0.035, 0.008, col));
  for (let i = 0; i <= n; i++) g.in(M(lerp(x0, x1, i / n), 0, 0), () => { g.surf(K_WOOD, 0.5); g.in(M(0, h / 2 + 0.02, 0), () => g.cbox(0.055, h + 0.04, 0.055, 0.01, col)); g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, h + 0.06, 0), () => g.add(new THREE.OctahedronGeometry(0.035, 0), capc)); });
}
/** a latticed window lit from within on the local XY plane: w x h about the origin */
function lattice(g, w, h, col = LACQUER, n = 4) {
  g.surf(K_PLAIN, 0.5, 0, 1.0);
  g.flat([[-w / 2, -h / 2, 0.006], [w / 2, -h / 2, 0.006], [w / 2, h / 2, 0.006], [-w / 2, h / 2, 0.006]], [[1.0, 0.56, 0.14], [1.0, 0.56, 0.14], [1.0, 0.74, 0.3], [1.0, 0.74, 0.3]]);
  g.surf(K_WOOD, 0.5);
  for (let i = 0; i <= n; i++) g.in(M(-w / 2 + (w * i) / n, 0, 0.014), () => g.cbox(i === 0 || i === n ? 0.03 : 0.014, h + 0.03, 0.016, 0.003, col));
  const m = Math.max(2, Math.round((h / w) * n));
  for (let j = 0; j <= m; j++) g.in(M(0, -h / 2 + (h * j) / m, 0.014), () => g.cbox(w + 0.03, j === 0 || j === m ? 0.03 : 0.014, 0.016, 0.003, col));
}
function tianlongPagoda(g) {
  const st = bigStone(0xb4b0a6, 2000, { len: [0.4, 0.75] }), col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 4), cream = rgb(0xe6dcc0);
  const B = [1.12, 0.96, 0.8, 0.66, 0.52], TY = 0.5, SH = 1.22, WH2 = 0.8, lac = (x, y, z) => mul(LACQUER, 0.85 + 0.3 * noise3(x * 6, y * 2, z * 6));
  const gd = (x, y, z) => mul(GOLD, 0.85 + 0.3 * noise3(x * 9, y * 9, z * 9));
  // stone terrace, its balustrade and stair
  blockBox(g, 1.76, 1.76, 0, TY, st, 2010, { topCol: mul(col, 0.85) });
  faces4(g, 1.76, 1.76, (s, W) => {
    g.surf(K_STONE, 0.93); g.in(M(0, TY - 0.04, 0.02), () => g.cbox(2 * W + 0.1, 0.09, 0.1, 0.02, cc));
    g.in(M(0, TY, -0.1), () => { if (s === 0) { lacquerRail(g, -W + 0.1, -0.56, 0.3, mul(col, 1.1), mul(col, 1.2)); lacquerRail(g, 0.56, W - 0.1, 0.3, mul(col, 1.1), mul(col, 1.2)); } else lacquerRail(g, -W + 0.1, W - 0.1, 0.3, mul(col, 1.1), mul(col, 1.2)); });
  });
  g.surf(K_STONE, 0.93);
  flight(g, 0.92, 1.98, 0, 1.66, TY, 4, mul(col, 0.95), 2, 0.3);
  for (const e of [-1, 1]) { wedge(g, e * 0.46, e * 0.62, 1.99, 0.12, 1.7, TY + 0.14, 0, mul(col, 1.05), 0.75); g.in(M(e * 0.54, 0, 1.92), () => { g.surf(K_STONE, 0.93); post(g, 0.15, 0.34, cc); }); }
  // five storeys
  B.forEach((b, k) => g.in(M(0, TY + k * SH, 0), () => {
    const E = b + 0.52, I = k < 4 ? B[k + 1] + 0.05 : 0.05, vr = b + 0.2;
    if (k > 0) {
      // gallery floor and rail
      g.surf(K_WOOD, 0.6); g.in(M(0, 0.0, 0), () => g.cbox(2 * vr + 0.06, 0.06, 2 * vr + 0.06, 0.012, woodTint(rgb(0x5a2a1c), k)));
      faces4(g, vr, vr, (s, W) => lacquerRail(g, -W, W, 0.2));
    }
    faces4(g, b, b, (s, W) => {
      // wall: cream plaster between lacquered frames, a lattice window (the door on the ground floor)
      g.surf(K_PLASTER, 0.9);
      g.flat([[-W, 0, 0], [W, 0, 0], [W, WH2, 0], [-W, WH2, 0]], cream);
      g.surf(K_WOOD, 0.5);
      g.in(M(0, 0.05, 0.012), () => g.cbox(2 * W, 0.1, 0.03, 0.008, lac));
      g.in(M(0, WH2 - 0.2, 0.012), () => g.cbox(2 * W, 0.06, 0.03, 0.008, lac));
      if (k === 0 && s === 0) {
        g.in(M(0, 0.33, 0.01), () => { g.surf(K_WOOD, 0.5); g.cbox(0.62, 0.66, 0.03, 0.008, mul(LACQUER, 0.6)); for (const e of [-1, 1]) g.in(M(e * 0.15, 0, 0.012), () => { g.surf(K_WOOD, 0.5); g.cbox(0.27, 0.6, 0.02, 0.006, lac); g.in(M(0, 0.12, 0.012), () => lattice(g, 0.2, 0.26, mul(LACQUER, 0.5), 3)); g.surf(K_PLAIN, 0.3, 0.9); g.in(M(-e * 0.09, -0.06, 0.014), () => g.stud(0.02, GOLD, 6)); }); });
        for (const e of [-1, 1]) g.in(M(e * 0.72, 0.36, 0.006), () => lattice(g, 0.3, 0.34));
      } else g.in(M(0, 0.34, 0.006), () => lattice(g, Math.min(0.6, W * 1.0), 0.36, LACQUER, W > 0.7 ? 6 : 4));
      // painted beam and bracket sets under the eave
      g.surf(K_WOOD, 0.5);
      g.in(M(0, WH2 - 0.1, 0.09), () => g.cbox(2 * W + 0.26, 0.1, 0.06, 0.012, (x, y, z) => (Math.floor(x * 9 + 20) % 2 ? rgb(0x1f5aa0) : rgb(0x2f8a5c))));
      const nb = Math.max(3, Math.round((2 * W + 0.3) / 0.22));
      for (let i = 0; i < nb; i++) { const x = -W - 0.15 + (i + 0.5) * ((2 * W + 0.3) / nb); g.in(M(x, WH2 - 0.02, 0.16), () => { g.cbox(0.07, 0.06, 0.2, 0.01, rgb(0x1f5aa0)); g.in(M(0, 0.04, 0.06), () => g.cbox(0.13, 0.04, 0.06, 0.008, rgb(0x2f8a5c))); }); }
      g.surf(K_PLAIN, 0.3, 0.9);
      for (let i = 0; i < nb; i++) g.in(M(-W - 0.1 + (i + 0.5) * ((2 * W + 0.2) / nb), WH2 - 0.1, 0.122), () => g.stud(0.016, GOLD, 5));
    });
    // lacquered columns
    const cs = b + 0.1, cols = [[cs, cs], [cs, -cs], [-cs, cs], [-cs, -cs]];
    if (b > 0.7) for (const q of [-0.36, 0.36]) cols.push([q, cs], [q, -cs], [cs, q], [-cs, q]);
    for (const [x, z] of cols) g.in(M(x, 0, z), () => { g.surf(K_STONE, 0.9); g.cyl(0.075, 0.065, 0.05, 8, cc, false, true); g.surf(K_WOOD, 0.4); g.in(M(0, 0.05, 0), () => g.cyl(0.05, 0.046, WH2 - 0.05, nq(10), lac, false, false)); });
    // the roof, lanterns at its corners
    g.in(M(0, WH2, 0), () => {
      eaveRoof(g, E, I, k < 4 ? SH - WH2 + 0.03 : 1.0, JADE, 2020 + k * 9, { up: 0.2 + 0.02 * (4 - k), ridge: mul(GOLD, 0.85), ridgeMetal: 0.85, eave: mul(JADE[3], 0.7), pow: k < 4 ? 1.7 : 1.45, tw: 0.13, th: 0.13 });
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * (E + 0.1), 0.22 + 0.2 + 0.02 * (4 - k), sz * (E + 0.1)), () => paperLantern(g, 0.2 - k * 0.012, [1.0, 0.2, 0.06], 1.3, k + sx));
    });
  }));
  // the finial: a lotus, nine rings and a flaming jewel
  g.in(M(0, TY + 4 * SH + WH2 + 0.94, 0), () => {
    g.surf(K_PLAIN, 0.28, 0.92, 0.06);
    g.lathe([[0.2, 0], [0.22, 0.05], [0.12, 0.1], [0.17, 0.18], [0.15, 0.26], [0.05, 0.3], [0.035, 1.3], [0, 1.32]], nq(12), gd);
    for (let i = 0; i < 7; i++) g.in(M(0, 0.4 + i * 0.12, 0), () => g.lathe([[0.04, -0.02], [0.17 - i * 0.017, -0.012], [0.19 - i * 0.017, 0], [0.17 - i * 0.017, 0.012], [0.04, 0.02]], nq(12), gd));
    g.in(M(0, 1.3, 0), () => { ball(g, 0.07, GOLD, 8, 6); g.surf(K_PLAIN, 0.3, 0.3, 1.2); g.in(M(0, 0.05, 0), () => g.lathe([[0.05, 0], [0.07, 0.06], [0.03, 0.16], [0, 0.26]], 6, [1.0, 0.5, 0.1])); });
  });
  // stone lanterns at the head of the stair
  for (const e of [-1, 1]) g.in(M(e * 0.86, TY, 1.38), () => { g.surf(K_STONE, 0.9); g.lathe([[0.1, 0], [0.1, 0.04], [0.045, 0.08], [0.045, 0.3], [0.1, 0.34], [0.1, 0.36]], 6, cc); g.surf(K_PLAIN, 0.5, 0, 1.3); g.in(M(0, 0.36, 0), () => g.lathe([[0.07, 0], [0.07, 0.12]], 6, [1.0, 0.6, 0.18])); g.surf(K_STONE, 0.9); g.in(M(0, 0.48, 0), () => g.lathe([[0.15, 0], [0.13, 0.03], [0.03, 0.12], [0.03, 0.16], [0, 0.18]], 6, cc)); for (let i = 0; i < 6; i++) g.in(RY(i * 60 + 30).multiply(M(0, 0.42, 0.065)), () => g.cbox(0.012, 0.12, 0.012, 0.003, cc)); });
}

// ---------------------------------------------------------------------------------------------------
// Tianlong: sky-lantern observatory, 2 x 2
// ---------------------------------------------------------------------------------------------------
/** a sky lantern: paper over a bamboo hoop, its flame inside; the local origin is the mouth, s its height */
function skyLantern(g, s, col, seed = 0) {
  g.surf(K_PLAIN, 0.85, 0, 0.8);
  g.lathe([[0.3, 0], [0.4, 0.28], [0.48, 0.66], [0.45, 0.88], [0.3, 1.0], [0, 1.05]].map(([r, y]) => [r * s, y * s]), nq(12), (x, y, z) => { const t = y / s; return mul(col, (0.62 + 0.55 * smooth(0.9, 0.1, t)) * (Math.abs(Math.sin(Math.atan2(z, x) * 4 + seed)) < 0.1 ? 0.6 : 1)); });
  g.surf(K_WOOD, 0.8); g.add(new THREE.TorusGeometry(0.3 * s, 0.012, 4, nq(12)).rotateX(Math.PI / 2), rgb(0x6a4a24));
  g.surf(K_PLAIN, 1, 0, 2.2); g.in(M(0, 0.02 * s, 0), () => g.lathe([[0.05 * s, 0], [0.07 * s, 0.06 * s], [0, 0.2 * s]], 5, [1.0, 0.62, 0.15]));
}
function tianlongSkyLantern(g) {
  const stc = rgb(0xb4b0a6), cc = stoneTint(mul(stc, 1.02), 4, 4), bzc = rgb(0x9a7038), bz = (x, y, z) => mul(bzc, 0.8 + 0.4 * noise3(x * 9, y * 9, z * 9)), lac = (x, y, z) => mul(LACQUER, 0.85 + 0.3 * noise3(x * 6, y * 2, z * 6));
  const O8 = [Math.PI / 8, TAU + Math.PI / 8];
  // eight-sided terrace, rail and a short stair
  g.surf(K_STONE, 0.93);
  g.lathe([[0.99, -0.12], [0.99, 0.14], [0.92, 0.14], [0.92, 0.5], [0.97, 0.54], [0.97, 0.6], [0, 0.6]], 8, (x, y, z) => { const row = Math.floor(y / 0.12), a = Math.atan2(z, x) * 5 + row * 0.5, joint = Math.abs(y / 0.12 - Math.round(y / 0.12)) < 0.08 || Math.abs(a - Math.round(a)) < 0.06; return mul(stc, (joint && y < 0.5 ? 0.6 : 1) * (0.85 + 0.25 * hash1(row, Math.floor(a)))); }, ...O8);
  for (let i = 0; i < 8; i++) g.in(RY(i * 45).multiply(M(0, 0.6, 0.86)), () => { if (i !== 0) lacquerRail(g, -0.34, 0.34, 0.24); else for (const e of [-1, 1]) g.in(M(e * 0.34, 0, 0), () => { g.surf(K_WOOD, 0.5); g.in(M(0, 0.14, 0), () => g.cbox(0.055, 0.28, 0.055, 0.01, LACQUER)); }); });
  g.surf(K_STONE, 0.93);
  g.in(M(0, 0, 0), () => flight(g, 0.5, 0.995, 0.3, 0.9, 0.6, 2, mul(stc, 0.95), 1, 0.3));
  // the lacquered stand under a little tiled skirt
  g.in(M(0, 0.6, 0), () => {
    g.surf(K_STONE, 0.93); g.in(M(0, 0.06, 0), () => g.cbox(0.9, 0.12, 0.9, 0.02, cc));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * 0.34, 0.12, sz * 0.34), () => { g.surf(K_WOOD, 0.4); g.cyl(0.05, 0.045, 1.2, nq(10), lac, false, false); });
    faces4(g, 0.3, 0.3, (s, W) => { g.in(M(0, 0.72, 0), () => lattice(g, 0.5, 0.9, LACQUER, 5)); g.surf(K_WOOD, 0.5); g.in(M(0, 0.2, 0.01), () => g.cbox(0.6, 0.14, 0.03, 0.008, lac)); g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, 0.2, 0.026, 0, 0, 45), () => g.cbox(0.07, 0.07, 0.01, 0.002, GOLD)); });
    g.surf(K_WOOD, 0.5); g.in(M(0, 1.3, 0), () => g.cbox(0.86, 0.1, 0.86, 0.015, (x, y, z) => (Math.floor((x + z) * 9 + 20) % 2 ? rgb(0x1f5aa0) : rgb(0x2f8a5c))));
    g.in(M(0, 1.35, 0), () => eaveRoof(g, 0.74, 0.3, 0.26, JADE, 2100, { up: 0.16, ridge: mul(GOLD, 0.85), ridgeMetal: 0.85, eave: mul(JADE[3], 0.7), tw: 0.11, th: 0.11 }));
    g.surf(K_STONE, 0.93); g.in(M(0, 1.66, 0), () => g.cbox(0.66, 0.12, 0.66, 0.02, cc));
    g.in(M(0, 1.72, 0), () => { for (let s = 0; s < 4; s++) g.in(RY(s * 90).multiply(M(0, 0, 0.33)), () => lacquerRail(g, -0.3, 0.3, 0.14)); });
  });
  // the armillary sphere on its dragon stand
  const ay = 3.0, AR = 0.44;
  g.in(M(0, 2.32, 0), () => {
    g.surf(K_PLAIN, 0.38, 0.9);
    g.lathe([[0.26, 0], [0.26, 0.04], [0.1, 0.08], [0.06, 0.2], [0.09, 0.24], [0.05, 0.3]], nq(12), bz);
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + Math.PI / 4, c = Math.cos(a), s = Math.sin(a); g.tube(curvePts([[c * 0.24, 0.02, s * 0.24], [c * 0.34, 0.12, s * 0.34], [c * 0.2, 0.3, s * 0.2], [c * 0.34, 0.5, s * 0.34], [c * AR, ay - 2.32, s * AR]], 12), [0.04, 0.038, 0.036, 0.034, 0.032, 0.03, 0.028, 0.026, 0.026, 0.028, 0.03, 0.034, 0.03], 6, bz, true); g.in(M(c * 0.36, 0.52, s * 0.36), () => g.add(new THREE.OctahedronGeometry(0.035, 0), mul(bzc, 1.2))); }
  });
  g.in(M(0, ay, 0), () => {
    g.surf(K_PLAIN, 0.36, 0.92);
    const ring = (R, t, rx, ry, rz, c = bz) => g.in(M(0, 0, 0, rx, ry, rz), () => { g.add(new THREE.TorusGeometry(R, t, 5, nq(36)).rotateX(Math.PI / 2), c); for (let i = 0; i < 12; i++) g.in(RY(i * 30).multiply(M(0, 0, R)), () => g.cbox(0.012, t * 2.6, 0.03, 0.003, mul(bzc, 0.5))); });
    ring(AR, 0.024, 0, 0, 0); ring(AR - 0.01, 0.022, 90, 0, 0); ring(AR - 0.02, 0.02, 90, 90, 0);
    ring(AR - 0.07, 0.018, 0, 0, 34, mul(GOLD, 0.9)); ring(AR - 0.12, 0.016, 0, 0, 34 - 23.5, mul(GOLD, 0.9)); ring(AR - 0.07, 0.014, 90, 0, 34, mul(GOLD, 0.9));
    g.in(M(0, 0, 0, 0, 0, 34 - 90), () => g.in(M(0, -AR + 0.05, 0), () => g.cyl(0.012, 0.012, 2 * AR - 0.1, 5, mul(bzc, 0.7), true, true)));
    g.surf(K_PLAIN, 0.3, 0.3, 0.2); ball(g, 0.09, (x, y, z) => (noise3(x * 14, y * 14, z * 14) > 0.52 ? mul(GOLD, 0.9) : rgb(0x1f5aa0)), 12, 8);
  });
  // the lanterns riding on their tethers
  const L = [[0.05, 5.4, 0.0, 0.52, [1.0, 0.16, 0.04]], [0.56, 4.7, 0.34, 0.42, [1.0, 0.3, 0.04]], [-0.52, 4.9, 0.3, 0.4, [0.95, 0.1, 0.06]], [0.3, 4.25, -0.56, 0.4, [1.0, 0.4, 0.06]], [-0.5, 4.1, -0.42, 0.36, [1.0, 0.22, 0.04]], [0.68, 3.85, -0.12, 0.3, [0.95, 0.1, 0.08]], [-0.7, 3.7, 0.08, 0.32, [1.0, 0.36, 0.05]], [0.08, 4.4, 0.62, 0.34, [1.0, 0.16, 0.04]]];
  L.forEach(([x, y, z, s, c], i) => {
    g.in(M(x, y, z, 5 * Math.sin(i * 2.1), i * 40, 5 * Math.cos(i * 1.7)), () => skyLantern(g, s, c, i));
    const a = Math.atan2(z, x) + 0.3 * Math.sin(i * 3), anchor = i === 0 ? [0, ay + AR, 0] : [Math.cos(a) * 0.32, 2.46, Math.sin(a) * 0.32];
    g.surf(K_CLOTH, 0.9);
    g.tube(curvePts([anchor, [lerp(anchor[0], x, 0.45) + 0.08 * Math.sin(i * 5), lerp(anchor[1], y, 0.5) - 0.12, lerp(anchor[2], z, 0.45) + 0.08 * Math.cos(i * 4)], [x, y, z]], 8), 0.006, 4, [0.12, 0.09, 0.06], false);
  });
  motes(g, [[0.4, 5.6, 0.3], [-0.3, 5.2, -0.3, 0.8], [0.7, 4.4, 0.6, 0.7], [-0.75, 4.5, -0.1, 0.8], [0.1, 3.75, 0.7, 0.7]], 0.018, [1.0, 0.7, 0.25], 2);
}

// =====================================================================================================
// exports
// =====================================================================================================
/** every landmark of the realms of Order, by model id; each faces +Z in its natural footprint */
export const structures = {
  /** Gothic cathedral, 4 x 6: west front and twin towers toward +Z */
  graal_cathedral: landmark('graal_cathedral', 4, 6, graalCathedral),
  /** serf hovel, 2 x 2 */
  graal_hovel: landmark('graal_hovel', 2, 2, graalHovel),
  /** foundry, 4 x 3: furnace mouth toward +Z, stacks and hoist at the +X end */
  aurelia_foundry: landmark('aurelia_foundry', 4, 3, aureliaFoundry),
  /** temple of the hammer-saint, 4 x 5: portico toward +Z */
  aurelia_hammerTemple: landmark('aurelia_hammerTemple', 4, 5, aureliaHammerTemple),
  /** ivory tower, 3 x 3: door of light toward +Z */
  aethel_ivoryTower: landmark('aethel_ivoryTower', 3, 3, aethelIvoryTower),
  /** crystal waystone, 1 x 1 */
  aethel_waystone: landmark('aethel_waystone', 1, 1, aethelWaystone),
  /** sacrificial ziggurat, 5 x 5: the blood stair toward +Z */
  kaelneth_bloodZiggurat: landmark('kaelneth_bloodZiggurat', 5, 5, kaelnethBloodZiggurat),
  /** spiked iron watchtower, 2 x 2 */
  kaelneth_spikeTower: landmark('kaelneth_spikeTower', 2, 2, kaelnethSpikeTower),
  /** tree-palace, 5 x 5: door toward +Z */
  verdant_treePalace: landmark('verdant_treePalace', 5, 5, verdantTreePalace),
  /** sap-lantern, 1 x 1 */
  verdant_sapLantern: landmark('verdant_sapLantern', 1, 1, verdantSapLantern),
  /** rune-gate hall, 5 x 4: bronze gate toward +Z, the mountain behind */
  grom_runeGate: landmark('grom_runeGate', 5, 4, gromRuneGate),
  /** steam works, 3 x 3: gearing toward +Z, boiler along the +X side */
  grom_steamWorks: landmark('grom_steamWorks', 3, 3, gromSteamWorks),
  /** stepped temple, 6 x 6: stair toward +Z */
  xibalba_stepPyramid: landmark('xibalba_stepPyramid', 6, 6, xibalbaStepPyramid),
  /** solar mirror, 2 x 2: dish tipped toward +Z */
  xibalba_sunMirror: landmark('xibalba_sunMirror', 2, 2, xibalbaSunMirror),
  /** onion-domed cathedral, 4 x 5: tent-roofed porch toward +Z, apses at the back */
  velikaya_onionCathedral: landmark('velikaya_onionCathedral', 4, 5, velikayaOnionCathedral),
  /** boyar manor, 4 x 3: windows toward +Z, covered porch and stair at the +X end */
  velikaya_boyarManor: landmark('velikaya_boyarManor', 4, 3, velikayaBoyarManor),
  /** pagoda palace, 4 x 4: stair toward +Z */
  tianlong_pagoda: landmark('tianlong_pagoda', 4, 4, tianlongPagoda),
  /** sky-lantern observatory, 2 x 2 */
  tianlong_skyLantern: landmark('tianlong_skyLantern', 2, 2, tianlongSkyLantern),
};
