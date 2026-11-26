// Civic buildings, districts and the pieces of a city built on levels.
//
//   structures[def.model](def, w, h, place) -> Object3D centred on its footprint, resting on y = 0
//       marketHall stall bank inn garden fountain barracks temple shrine alchemist dockhouse palace graveyard
//       terrace terraceHigh walkway stoneBridge viaduct cableTower
//   cableCar(sideColorHex)                  -> hanging gondola, origin where its grip meets the cable
//
// Built the same way as buildings.js (and with the same construction kit, repeated here because that module
// keeps it private): stone laid in courses, timber as individual beams and planks, roofs as rows of tiles,
// everything emitted into one vertex-coloured geometry for the shared sculpt material. A building is one mesh,
// plus a second small one for whatever flies the owning side's colour (baked in greys, drawn with a tinted
// clone of the material, so changing sides never rebuilds geometry). Geometry is built once per model, size,
// colour and detail preset; every placement shares it.
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
const pave = (hex, seed, o) => { const st = stoneStyle(hex); return stoneStyle(hex, { seed, r: 0.008, b: 0.012, rough: 0, bump: 0.3, flat: true, chip: 0.06, len: [0.26, 0.5], pal: st.pal.map((c) => mul(c, 0.86)), cell: 0.15 / qual(), ...o }); };

/** a raised platform w x h tiles whose flagged top is exactly `level` levels up; a low parapet with gaps runs round its edge */
function terrace(g, w, h, level, hex) {
  const top = level * LEVEL_H, per = 2 * (w + h), big = per > 60 ? 2 : per > 26 ? 1 : 0, plH = level > 1 ? 2 * COURSE : COURSE;
  const st = stoneStyle(hex, { seed: 1200 + level, cell: [0.1, 0.17, 0.5][big] / qual(), len: [[0.32, 0.6], [0.46, 0.84], [0.8, 1.4]][big], chip: big === 2 ? 0.04 : 0.14, course: big === 2 && level > 1 ? 2 * COURSE : COURSE });
  const r = st.r, col = mul(st.pal[0], 1.04), PT = 0.15, PH = 0.25;
  for (let s = 0; s < 4; s++) {
    const n = s % 2 ? h : w, W = n / 2, D = (s % 2 ? w : h) / 2;
    g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
      g.surf(K_STONE, 0.93);
      plinth(g, 2 * W, { ...st, course: COURSE }, 1210 + s * 5, true, 0.05, plH);
      // buttresses, and a drain between each pair
      const nb = Math.max(1, Math.round(n / (big === 2 ? 8 : 4))), bx = [], dx = [];
      for (let k = 0; k < nb; k++) { const x = -W + ((k + 0.5) * n) / nb; bx.push(x); dx.push(x - n / nb / 4, x + n / nb / 4); }
      const dv = top - plH - 2 * COURSE;
      const drains = dx.map((x) => [x + W - r - 0.06, dv, x + W - r + 0.06, dv + COURSE]);
      g.in(M(-(W - r), plH, -r), () => {
        g.ashlar(2 * (W - r), top - plH, { ...st, seed: 1220 + s, ends: [CORNER, CORNER, 0, 0], quoin: [st.len[1] * 1.05, st.len[0]], holes: drains });
        for (const d of drains) {
          g.surf(K_PLAIN, 1);
          g.flat([[d[0], d[1], -0.05], [d[2], d[1], -0.05], [d[2], d[3], -0.05], [d[0], d[3], -0.05]], [0.01, 0.01, 0.012]);
          for (const e of [0, 2]) g.flat([[d[e], d[1], r], [d[e], d[3], r], [d[e], d[3], -0.05], [d[e], d[1], -0.05]], mul(st.pal[0], 0.3));
          g.surf(K_STONE, 0.93);
          const cx = (d[0] + d[2]) / 2;
          g.in(M(cx, d[1] - 0.016, 0.055), () => g.cbox(0.17, 0.045, 0.17, 0.012, stoneTint(col, 4 + s)));
          for (const e of [-1, 1]) g.in(M(cx + e * 0.07, d[1] + 0.022, 0.055), () => g.cbox(0.03, 0.05, 0.17, 0.01, stoneTint(col, 6 + e)));
        }
      });
      for (const x of dx) g.shade(x - 0.09, 0, -0.02, x + 0.09, top - 2 * COURSE, 0.08, 0.3, 0.06, [1, 1]);   // the stain under each spout
      bx.forEach((x, k) => g.in(M(x, 0, 0), () => buttress(g, big === 2 ? 0.5 : 0.38, 0.13, top - 0.34, { ...st, course: COURSE }, 1230 + s * 20 + k, 0.16)));
      band(g, [[0, top - 0.135], [0.034, top - 0.1], [0.034, top - 0.035], [0, top - 0.004]], 2 * W, col, 1240 + s, 1, 1);
      // parapet: a gap one tile wide in every fourth tile, never at a corner
      const runs = [];
      let a = -W;
      for (let i = 0; i < n; i++) if (i % 4 === 2 && i < n - 1) { runs.push([a, -W + i]); a = -W + i + 1; }
      runs.push([a, W]);
      const ps = { ...st, cell: st.cell * 0.8, chip: 0.08 };
      runs.forEach(([x0, x1], k) => {
        const cl = x0 <= -W + 1e-6, cr = x1 >= W - 1e-6;
        g.in(M(0, top, 0), () => lowWall(g, cl ? x0 + r : x0 + r + 0.012, cr ? x1 - r : x1 - r - 0.012, ps, 1250 + s * 30 + k * 5, { t: PT, h: PH, inL: cl ? PT : 0, inR: cr ? PT : 0, len: big === 2 ? [0.7, 1.3] : big ? [0.4, 0.8] : [0.26, 0.5], capLen: big === 2 ? 3 : big ? 1.4 : 0.8 }));
      });
    });
  }
  // the top: flags laid in courses, their faces exactly on the level
  const fl = clamp(Math.sqrt((w * h) / 1100), 0.4, 1.8), rows = Math.max(2, Math.round(h / fl));
  const pv = pave(hex, 1290 + level, { course: h / rows, len: [fl * 0.85, fl * 1.6], cell: (fl > 0.6 ? fl * 2 : Math.max(0.16, fl * 0.9)) / qual(), chip: big ? 0 : 0.06 });
  g.surf(K_STONE, 0.95);
  g.in(M(-w / 2, top - pv.r, h / 2, -90, 0, 0), () => g.ashlar(w, h, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
}

/** a spindly timber walkway L tiles long and one wide; the tops of its planks are exactly two levels up */
function walkway(g, L, hex) {
  const wood = rgb(hex), tb = tbOf(wood), top = 2 * LEVEL_H, rnd = rng(1300 + L * 7);
  const long = L > 12, nb = Math.max(2, Math.round(L / 2) + 1), capY = top - 0.045 - 0.06 - 0.045;
  const pole = { seg: long ? 6 : 8, vseg: long ? 3 : 0, bark: mul(wood, 0.62), amp: 0.09 };
  for (let i = 0; i < nb; i++) {
    const x = lerp(-L / 2 + 0.16, L / 2 - 0.16, i / (nb - 1)), lean = (hash1(i, L + 3) - 0.5) * 0.05;
    for (const e of [-1, 1]) {
      g.surf(K_STONE, 0.95);
      g.in(M(x + lean, -0.06, e * 0.43), () => g.cbox(0.2, 0.18, 0.2, 0.025, stoneTint(rgb(0x85807a), i + e)));
      logTo(g, [x + lean, 0, e * 0.43], [x, capY + 0.02, e * 0.3], 0.042, 0.034, i * 3 + e, pole);
      if (!long) g.in(M(x, capY - 0.06, e * 0.305), () => lashing(g, 0.045, 3, 0.009));
    }
    // cross-bracing and the cap piece the stringers sit on
    g.surf(K_WOOD, 0.9);
    const zb = (y) => lerp(0.43, 0.3, y / capY) - 0.02;
    g.beamTo([x + lean * 0.8 + 0.03, 0.14, -zb(0.14)], [x + 0.03, capY - 0.16, zb(capY - 0.16)], 0.05, 0.028, 0.006, tb(i * 5 + 1, 0.74), 3, [1, 0, 0]);
    g.beamTo([x + lean * 0.8 - 0.03, 0.14, zb(0.14)], [x - 0.03, capY - 0.16, -zb(capY - 0.16)], 0.05, 0.028, 0.006, tb(i * 5 + 2, 0.74), 3, [1, 0, 0]);
    g.in(M(x, 0.72, 0, 0, 90, 0), () => g.beam(0.82, 0.045, 0.03, 0.006, tb(i * 5 + 3, 0.7), 2));
    g.in(M(x, capY, 0, 0, 90, 0), () => g.beam(0.86, 0.075, 0.07, 0.01, tb(i * 5 + 4, 0.8), 2));
    // raking struts along the walk, to the next trestle
    if (i < nb - 1) {
      const x2 = lerp(-L / 2 + 0.16, L / 2 - 0.16, (i + 1) / (nb - 1)), e = i % 2 ? 1 : -1;
      g.beamTo([x + 0.03, 0.2, e * 0.42], [x2 - 0.03, capY - 0.1, e * 0.33], 0.045, 0.026, 0.006, tb(i * 5 + 6, 0.7), 4);
      for (const s of [-1, 1]) { g.beamTo([x + 0.04, capY - 0.42, s * 0.325], [x + 0.42, capY + 0.045, s * 0.3], 0.04, 0.03, 0.006, tb(i * 9 + s, 0.72), 2); g.beamTo([x2 - 0.04, capY - 0.42, s * 0.325], [x2 - 0.42, capY + 0.045, s * 0.3], 0.04, 0.03, 0.006, tb(i * 9 + s + 3, 0.72), 2); }
    }
  }
  // stringers, then the planks
  for (const e of [-1, 1]) g.in(M(0, top - 0.045 - 0.03, e * 0.3), () => g.beam(L - 0.02, 0.06, 0.055, 0.008, tb(40 + e, 0.78), Math.max(2, Math.round(L * 2))));
  const np = Math.round(L / 0.2), pw = L / np;
  for (let i = 0; i < np; i++) {
    const len = 0.94 + (rnd() - 0.5) * 0.08, off = (rnd() - 0.5) * 0.03;
    g.surf(K_WOOD, 0.9);
    g.in(M(-L / 2 + pw * (i + 0.5), top - 0.0225, off, 0, 90, 0), () => g.beam(Math.min(len, 1 - 2 * Math.abs(off)), 0.045, pw - 0.012, 0.006, tb(50 + i, 0.85 + 0.3 * rnd()), long ? 1 : 2));
    g.surf(K_PLAIN, 0.6, 0.8);
    if (!long) for (const e of [-1, 1]) g.in(M(-L / 2 + pw * (i + 0.5), top - 0.002, e * 0.3, -90, 0, 0), () => g.stud(0.008, IRON, 5, 0.25));
  }
  // rope handrails on short posts, at the edges only
  for (const e of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= L; i++) {
      const x = clamp(-L / 2 + i, -L / 2 + 0.035, L / 2 - 0.035), hh = 0.32 + 0.02 * hash1(i, e + 5);
      g.surf(K_WOOD, 0.9);
      g.beamTo([x, top - 0.14, e * 0.475], [x + (hash1(i, e + 9) - 0.5) * 0.03, top + hh, e * 0.478], 0.035, 0.035, 0.007, tb(60 + i + e, 0.72), 2);
      if (!long) g.in(M(x, top - 0.1, e * 0.455, 0, 0, 0), () => g.cbox(0.05, 0.03, 0.05, 0.006, tb(70 + i, 0.7)));
      if (i) for (let k = long ? 2 : 1; k <= 5; k += long ? 2 : 1) { const t = k / 6, x0 = clamp(-L / 2 + i - 1, -L / 2 + 0.035, L / 2 - 0.035); pts.push([lerp(x0, x, t), top + 0.29 - 0.085 * Math.sin(Math.PI * t), e * 0.478]); }
      pts.push([x, top + hh - 0.03, e * 0.478]);
    }
    rope(g, pts, 0.009, rgb(0xb89c68), long ? 4 : 6);
  }
  g.shade(-L / 2, top - 0.5, -0.5, L / 2, top - 0.05, 0.5, 0.3, 0.1, [1, 1]);
}

/** an arched stone bridge L tiles long and two wide: deck exactly one level up, a ramp on the first and last tile, piers down to the river bed */
function stoneBridge(g, L, hex) {
  const top = LEVEL_H, bed = -1.4, hz = 1, big = L > 20 ? 2 : L > 9 ? 1 : 0;
  const st = stoneStyle(hex, { seed: 1400, cell: [0.1, 0.15, 0.3][big] / qual(), len: big === 2 ? [0.5, 0.9] : big ? [0.4, 0.75] : [0.32, 0.6], chip: 0.12 });
  const r = st.r, col = mul(st.pal[0], 1.04), rows = Math.round((top - bed) / COURSE), PT = 0.15, PH = 0.3;
  const mid = L - 2, n = Math.max(1, Math.round(mid / 4.5)), span = mid / n, pw = Math.min(0.8, span * 0.24), half = (span - pw) / 2;
  const rise = Math.min(half * 0.7, 0.62), ring = 0.18, A = archOf(half, top - 0.16 - ring - rise, rise, ring), NV = 2 * Math.round(half * 5) + 1;
  const uc = (i) => -L / 2 + 1 + (i + 0.5) * span;
  for (const s of [0, 1]) g.in(M(0, 0, 0, 0, s * 180, 0).multiply(M(0, 0, hz)), () => {
    g.surf(K_STONE, 0.93);
    const holes = [];
    for (let i = 0; i < n; i++) holes.push(...archHoles(A, uc(i) + L / 2, bed, rows, r));
    for (let j = 0; j < rows; j++) { const y0 = bed + j * COURSE, c = y0 / top; if (c > 0.01) { holes.push([-1, j * COURSE, c, (j + 1) * COURSE, CUT]); holes.push([L - c, j * COURSE, L + 1, (j + 1) * COURSE, CUT]); } }
    g.in(M(-L / 2, bed, -r), () => g.ashlar(L, top - bed, { ...st, seed: 1410 + s, ends: [CUT, CUT, 0, 0], holes }));
    for (let i = 0; i < n; i++) g.in(M(uc(i), 0, -r), () => voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, NV, st, 1420 + s * 40 + i * 3, 0.014));
    band(g, [[0, top - 0.135], [0.034, top - 0.1], [0.034, top - 0.035], [0, top - 0.004]], mid, col, 1430 + s, 0, 0, true, true);
    // parapets: level over the arches, raking down the ramps, a pier block where they meet
    const ps = { ...st, cell: st.cell * 0.8 };
    g.in(M(0, top, 0), () => lowWall(g, -mid / 2 + 0.1, mid / 2 - 0.1, ps, 1440 + s, { eL: CUT, eR: CUT, t: PT, h: PH, capLen: 1.1 }));
    for (const e of [-1, 1]) {
      g.in(shearY(e * L / 2, 0, 0.004, -e * top), () => lowWall(g, e < 0 ? 0.03 : -0.9, e < 0 ? 0.9 : -0.03, ps, 1450 + s * 4 + e, { eL: e < 0 ? CORNER : CUT, eR: e < 0 ? CUT : CORNER, t: PT + 0.004, h: PH, capLen: 0.5 }));
      g.surf(K_STONE, 0.93);
      g.in(M(e * mid / 2, top + 0.17, -PT / 2 + 0.008), () => g.cbox(0.22, 0.345, PT + 0.05, 0.016, stoneTint(col, 8 + e + s * 3)));
      g.in(M(e * mid / 2, top + 0.345, -PT / 2 + 0.008), () => g.add(new THREE.SphereGeometry(0.07, 10, 5, 0, TAU, 0, Math.PI / 2).scale(1, 0.0714, 1), stoneTint(col, 5)));
    }
    // cutwaters on the piers
    for (let i = 0; i <= n; i++) {
      const x = -L / 2 + 1 + i * span, out = 0.36, ct = A.spring + 0.22 - bed, len = Math.hypot(pw / 2, out), an = Math.atan2(out, pw / 2) / DEG;
      const cs = { ...st, len: [0.26, 0.44] };
      g.surf(K_STONE, 0.93);
      g.in(M(x - pw / 2, bed, 0, 0, -an, 0), () => g.ashlar(len, ct, { ...cs, seed: 1460 + i * 4 + s, ends: [CUT, CORNER, 0, 0] }));
      g.in(M(x, bed, out, 0, an, 0), () => g.ashlar(len, ct, { ...cs, seed: 1462 + i * 4 + s, ends: [CORNER, CUT, 0, 0] }));
      const yt = bed + ct, c1 = mul(st.pal[0], 1.0), c2 = mul(st.pal[0], 0.8);
      g.flat([[x - pw / 2 - 0.02, yt, 0], [x, yt, out + 0.03], [x, yt + 0.34, 0]], [c1, c1, c2]);
      g.flat([[x, yt, out + 0.03], [x + pw / 2 + 0.02, yt, 0], [x, yt + 0.34, 0]], [c2, c2, c1]);
    }
  });
  // under the arches: pier sides and soffits
  const js = { ...st, cell: Math.max(st.cell, 0.16 / qual()) };
  for (let i = 0; i < n; i++) {
    g.surf(K_STONE, 0.93);
    g.in(M(uc(i) + half + r, bed, -(hz - r), 0, -90, 0), () => g.ashlar(2 * (hz - r), A.spring - bed, { ...js, seed: 1470 + i * 2, ends: [CORNER, CORNER, 0, 0] }));
    g.in(M(uc(i) - half - r, bed, hz - r, 0, 90, 0), () => g.ashlar(2 * (hz - r), A.spring - bed, { ...js, seed: 1471 + i * 2, ends: [CORNER, CORNER, 0, 0] }));
    g.in(M(uc(i), 0, -(hz - r) / 2), () => soffit(g, A.cy, A.ri, A.a0, A.a1, NV, (hz - r) / 2, js, 1480 + i * 2));
    g.in(M(uc(i), 0, (hz - r) / 2), () => soffit(g, A.cy, A.ri, A.a0, A.a1, NV, (hz - r) / 2, js, 1481 + i * 2));
    g.shade(uc(i) - half - 0.05, bed, -hz + 0.12, uc(i) + half + 0.05, top - 0.1, hz - 0.12, 0.5, 0.3);
  }
  // deck and ramps
  const pv = pave(hex, 1490, { course: big === 2 ? 0.5 : 0.4, len: big === 2 ? [0.5, 0.9] : [0.36, 0.62], cell: (big === 2 ? 0.6 : big ? 0.3 : 0.16) / qual() });
  g.surf(K_STONE, 0.95);
  g.in(M(-mid / 2, top - pv.r, hz, -90, 0, 0), () => g.ashlar(mid, 2 * hz, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
  for (const e of [0, 1]) g.in(M(0, 0, 0, 0, e * 180, 0), () => {
    g.in(shearY(-L / 2, 0, 0, top), () => {
      g.in(M(0, -pv.r, hz, -90, 0, 0), () => g.ashlar(1, 2 * hz, { ...pv, seed: 1492 + e, course: 0.25, len: [0.2, 0.3], ends: [CUT, CUT, CUT, CUT] }));
      // raised setts across the ramp for footing
      for (let k = 1; k < 5; k++) g.in(M(k * 0.2, 0.004, 0), () => g.cbox(0.045, 0.03, 2 * (hz - PT) - 0.02, 0.012, stoneTint(mul(st.pal[0], 0.82), k + e)));
    });
    g.surf(K_STONE, 0.93);
    g.in(M(-(L / 2 - r), bed, -(hz - r), 0, -90, 0), () => g.ashlar(2 * (hz - r), -bed, { ...js, seed: 1495 + e, ends: [CUT, CUT, 0, 0] }));
  });
}

/** a railway on stone arches, L tiles long and one wide: its bed is exactly two levels up, with two rails on sleepers */
function viaduct(g, L, hex) {
  const top = 2 * LEVEL_H, hz = 0.5, big = L > 20 ? 2 : L > 9 ? 1 : 0;
  const st = stoneStyle(hex, { seed: 1500, cell: [0.1, 0.15, 0.3][big] / qual(), len: big === 2 ? [0.38, 0.68] : [0.3, 0.56] });
  const r = st.r, col = mul(st.pal[0], 1.04), rows = Math.round(top / COURSE);
  const n = Math.max(1, Math.round(L / 3)), span = L / n, pw = 0.56, half = (span - pw) / 2, ring = 0.16;
  const rise = Math.min(half * 0.82, 0.86), A = archOf(half, top - 0.2 - ring - rise, rise, ring), NV = 2 * Math.round(half * 5.5) + 1;
  const uc = (i) => -L / 2 + (i + 0.5) * span;
  for (const s of [0, 1]) g.in(M(0, 0, 0, 0, s * 180, 0).multiply(M(0, 0, hz)), () => {
    g.surf(K_STONE, 0.93);
    const holes = [];
    for (let i = 0; i < n; i++) holes.push(...archHoles(A, uc(i) + L / 2, 0, rows, r));
    g.in(M(-L / 2, 0, -r), () => g.ashlar(L, top, { ...st, seed: 1510 + s, ends: [CUT, CUT, 0, 0], holes }));
    for (let i = 0; i < n; i++) g.in(M(uc(i), 0, -r), () => voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, NV, st, 1520 + s * 40 + i * 3, 0.012));
    for (let i = 0; i <= n; i++) {
      // each pier: a footing course, an impost at the springing, a pilaster up to the string course
      const x = -L / 2 + i * span, a = Math.max(-L / 2, x - pw / 2), b = Math.min(L / 2, x + pw / 2), eL = a > -L / 2 + 1e-6, eR = b < L / 2 - 1e-6;
      g.in(M((a + b) / 2 + ((eR ? 0.025 : 0) - (eL ? 0.025 : 0)), 0.09, 0.02), () => g.cbox(b - a + (eL ? 0.05 : 0) + (eR ? 0.05 : 0), 0.2, 0.08, 0.014, stoneTint(col, i + s)));
      g.in(M((a + b) / 2 + ((eR ? 0.03 : 0) - (eL ? 0.03 : 0)), A.spring - 0.035, 0.012), () => g.cbox(b - a + (eL ? 0.06 : 0) + (eR ? 0.06 : 0), 0.07, 0.06, 0.012, stoneTint(col, i + s + 3)));
      footing(g, a - (eL ? 0.03 : 0), b + (eR ? 0.03 : 0), st.pal[0], 0.06);
    }
    band(g, [[0, top - 0.17], [0.045, top - 0.13], [0.045, top - 0.035], [0, top - 0.004]], L, col, 1530 + s, 0, 0, true, true);
    // kerb along the edge of the bed
    for (let k = 0, nk = Math.round(L / (big === 2 ? 1 : 0.5)); k < nk; k++) g.in(M(-L / 2 + ((k + 0.5) * L) / nk, top + 0.03, -0.045), () => g.cbox(L / nk - 0.006, 0.06, 0.09, 0.012, stoneTint(mul(col, 0.92 + 0.14 * hash1(k, s)), k)));
  });
  const js = { ...st, cell: Math.max(st.cell, 0.16 / qual()) };
  for (let i = 0; i < n; i++) {
    g.surf(K_STONE, 0.93);
    g.in(M(uc(i) + half + r, 0, -(hz - r), 0, -90, 0), () => { g.ashlar(2 * (hz - r), A.spring, { ...js, seed: 1540 + i * 2, ends: [CORNER, CORNER, 0, 0] }); footing(g, -r, 2 * hz - r, st.pal[0], r); });
    g.in(M(uc(i) - half - r, 0, hz - r, 0, 90, 0), () => { g.ashlar(2 * (hz - r), A.spring, { ...js, seed: 1541 + i * 2, ends: [CORNER, CORNER, 0, 0] }); footing(g, -r, 2 * hz - r, st.pal[0], r); });
    g.in(M(uc(i), 0, 0), () => soffit(g, A.cy, A.ri, A.a0, A.a1, NV, hz - r, js, 1550 + i * 2));
    g.shade(uc(i) - half - 0.05, 0, -hz + 0.1, uc(i) + half + 0.05, top - 0.1, hz - 0.1, 0.45, 0.25);
  }
  for (const e of [-1, 1]) g.in(M(e * (L / 2 - r), 0, e * (hz - r), 0, e * 90, 0), () => { g.surf(K_STONE, 0.93); g.ashlar(2 * (hz - r), top, { ...st, seed: 1560 + e, cell: 0.2, ends: [CUT, CUT, 0, 0] }); footing(g, 0, 2 * (hz - r), st.pal[0], r); });
  // the bed: packed ballast with the sleepers bedded flush in it, then the rails
  const bal = rgb(0x6f6a62);
  g.surf(K_STONE, 0.98);
  g.sheet(Math.max(2, Math.round(L * 3)), 3, (u, v) => [lerp(-L / 2, L / 2, u), top, lerp(-hz, hz, v)], (x, y, z) => mul(bal, 0.75 + 0.5 * noise3(x * 13, 3, z * 13)));
  const ns = Math.round(L / (big === 2 ? 0.3334 : 0.25)), wood = rgb(0x5a4632), tb = tbOf(wood);
  for (let i = 0; i < ns; i++) {
    g.surf(K_WOOD, 0.92);
    g.in(M(-L / 2 + ((i + 0.5) * L) / ns, top - 0.018, 0, 0, 90, 0), () => g.beam(0.72 + 0.04 * hash1(i, 3), 0.04, 0.11, 0.004, tb(i, 0.9), big ? 1 : 2));
  }
  for (const e of [-1, 1]) {
    g.surf(K_PLAIN, 0.42, 0.85);
    // rail: foot, web and a polished head
    g.in(M(0, top + 0.004, e * 0.25), () => g.beam(L, 0.008, 0.05, 0.002, IRON, Math.max(1, Math.round(L / 2))));
    g.in(M(0, top + 0.02, e * 0.25), () => g.beam(L, 0.03, 0.014, 0.002, mul(rgb(0x4a3a30), 0.9), Math.max(1, Math.round(L / 2))));
    g.surf(K_PLAIN, 0.28, 0.95);
    g.in(M(0, top + 0.037, e * 0.25), () => g.beam(L, 0.016, 0.03, 0.005, rgb(0x8a8f96), Math.max(1, Math.round(L / 2))));
    g.surf(K_PLAIN, 0.5, 0.85);
    for (let i = 0; i < ns; i += 2) for (const q of [-1, 1]) g.in(M(-L / 2 + ((i + 0.5) * L) / ns, top + 0.002, e * 0.25 + q * 0.034, -90, 0, 0), () => g.stud(0.011, IRON, 5, 0.7));
  }
}

/** a wheel with a grooved rim lying flat on the local origin (axis +Y): felloes, spokes, an iron-bound hub */
function sheave(g, R, wood, spokes = 8, t = 0.05) {
  g.surf(K_WOOD, 0.85);
  const ri = R * 0.8;
  g.lathe([[ri, -t * 0.7], [R * 0.97, -t], [R * 1.04, -t * 0.85], [R * 0.9, 0], [R * 1.04, t * 0.85], [R * 0.97, t], [ri, t * 0.7], [ri, -t * 0.7]], 32, (x, y, z) => mul(wood, 0.8 + 0.3 * noise3(x * 9, y * 9, z * 9)));
  for (let i = 0; i < spokes; i++) g.in(M(0, 0, 0, 0, (i * 360) / spokes, 0), () => g.in(M((ri + R * 0.14) / 2, 0, 0), () => g.beam(ri - R * 0.1, t * 0.9, R * 0.09, 0.006, woodTint(mul(wood, 0.9), i), 1)));
  g.surf(K_PLAIN, 0.45, 0.85);
  g.lathe([[0, -t * 1.5], [R * 0.2, -t * 1.5], [R * 0.2, t * 1.5], [0, t * 1.5]], 12, IRON);
  for (const y of [-t * 0.86, t * 0.86]) g.lathe([[R * 1.035, y - 0.008], [R * 1.05, y], [R * 1.035, y + 0.008]], 32, IRON);
}
/** a pylon for the cable car: braced timber on a stone base, a boarding platform, a bull wheel on top. Returns { cableAt } */
function cableTower(g, f, hex) {
  const wood = rgb(hex), tb = tbOf(wood), st = stoneStyle(0x8f8a80, { seed: 1600 }), col = st.pal[0];
  const baseH = 0.8, hb = 0.84, y0 = baseH + 0.06, yT = 3.95, lb = 0.6, lt = 0.3, py = 3.2, hub = 4.28;
  const px = (y) => lerp(lb, lt, (y - y0) / (yT - y0));
  stoneBox(g, hb, hb, 0, baseH, st, 1601, { quoin: [0.5, 0.28] });
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, hb)), () => band(g, [[0, baseH - 0.02], [0.05, baseH - 0.02], [0.05, baseH + 0.04], [0.02, baseH + 0.06]], 2 * hb, mul(col, 1.05), 1605 + s, 1, 1));
  const pvt = pave(0x8f8a80, 1609, { course: 0.42 });
  g.in(M(-hb, baseH + 0.06 - pvt.r, hb, -90, 0, 0), () => g.ashlar(2 * hb, 2 * hb, { ...pvt, ends: [CUT, CUT, CUT, CUT] }));
  // legs in iron shoes
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.surf(K_WOOD, 0.9);
    g.beamTo([sx * lb, y0, sz * lb], [sx * lt, yT + 0.12, sz * lt], 0.13, 0.13, 0.014, tb(sx * 3 + sz, 0.8), 8);
    g.surf(K_PLAIN, 0.5, 0.85);
    g.in(M(sx * lb, y0 + 0.06, sz * lb), () => g.cbox(0.19, 0.14, 0.19, 0.012, IRON));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) g.in(M(sx * lb + dx * 0.1, y0 + 0.07, sz * lb + dz * 0.1, 0, dx ? dx * 90 : dz < 0 ? 180 : 0, 0), () => g.stud(0.016, IRON, 5));
  }
  const ys = [y0 + 0.2, 1.62, 2.4, py - 0.06, yT];
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    for (let k = 0; k < ys.length; k++) {
      const y = ys[k], p = px(y);
      g.surf(K_WOOD, 0.9);
      if (k) g.beamTo([-p, y, p + 0.005], [p, y, p + 0.005], 0.09, 0.07, 0.01, tb(s * 11 + k, 0.74), 2);
      if (k < ys.length - 1) {
        const yb = ys[k + 1], a = y + 0.07, b = yb - 0.07;
        g.beamTo([-px(a) + 0.03, a, px(a) + 0.045], [px(b) - 0.03, b, px(b) + 0.045], 0.065, 0.035, 0.007, tb(s * 11 + k + 20, 0.66), 3);
        g.beamTo([px(a) - 0.03, a, px(a) + 0.082], [-px(b) + 0.03, b, px(b) + 0.082], 0.065, 0.035, 0.007, tb(s * 11 + k + 30, 0.66), 3);
        g.surf(K_PLAIN, 0.5, 0.85);
        const ym = (a + b) / 2;
        g.in(M(0, ym, px(ym) + 0.102), () => { g.cbox(0.11, 0.11, 0.012, 0.004, IRON); g.in(M(0, 0, 0.006), () => g.stud(0.018, IRON, 6)); });
      }
      if (k) { g.surf(K_PLAIN, 0.5, 0.85); for (const e of [-1, 1]) g.in(M(e * p, y, p + 0.068), () => { g.cbox(0.16, 0.12, 0.012, 0.004, IRON); for (const [ax, ay] of [[-0.05, 0.03], [0.05, 0.03], [-0.05, -0.03], [0.05, -0.03]]) g.in(M(ax, ay, 0.006), () => g.stud(0.011, IRON, 5)); }); }
    }
  });
  // boarding platform: bearers, boards, a rail with a gap at the ladder head
  const hd = 0.78;
  g.surf(K_WOOD, 0.9);
  for (const z of [-0.42, 0.42]) g.in(M(0, py - 0.05, z), () => g.beam(2 * hd, 0.09, 0.07, 0.01, tb(80 + z, 0.72), 3));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.beamTo([sx * px(2.62), 2.62, sz * px(2.62)], [sx * (hd - 0.06), py - 0.1, sz * (hd - 0.06)], 0.07, 0.06, 0.008, tb(85 + sx + sz * 2, 0.7), 2);
  for (let i = 0; i < 8; i++) {
    const z = -hd + (2 * hd * (i + 0.5)) / 8;
    g.surf(K_WOOD, 0.9);
    g.in(M(0, py + 0.0225, z), () => g.beam(2 * hd - 0.02 * hash1(i, 5), 0.045, (2 * hd) / 8 - 0.01, 0.007, tb(90 + i), 4));
  }
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    const spans = s === 2 ? [[-hd + 0.03, -0.24], [0.24, hd - 0.03]] : [[-hd + 0.03, hd - 0.03]];
    g.surf(K_WOOD, 0.9);
    for (const [a, b] of spans) {
      g.beamTo([a, py + 0.5, hd - 0.04], [b, py + 0.5, hd - 0.04], 0.05, 0.05, 0.008, tb(100 + s, 0.8), 2);
      g.beamTo([a, py + 0.27, hd - 0.04], [b, py + 0.27, hd - 0.04], 0.04, 0.035, 0.006, tb(104 + s, 0.75), 2);
      for (const x of [a + 0.025, b - 0.025]) g.in(M(x, py + 0.27, hd - 0.04, 0, 0, 90), () => g.beam(0.5, 0.055, 0.055, 0.008, tb(108 + s + x, 0.78), 2));
    }
  });
  ladder(g, [0, 0.02, -0.965], [0, py + 0.46, -hd - 0.04], 0.34, 0.2, wood, 7, [0, 0, 1]);
  // head frame, axle and the bull wheel the cable runs round
  g.surf(K_WOOD, 0.9);
  for (const z of [-0.2, 0.2]) g.in(M(0, yT + 0.1, z), () => g.beam(0.95, 0.1, 0.1, 0.012, tb(120 + z, 0.75), 2));
  for (const x of [-0.2, 0.2]) g.in(M(x, yT + 0.19, 0, 0, 90, 0), () => g.beam(0.95, 0.08, 0.1, 0.012, tb(124 + x, 0.75), 2));
  g.surf(K_PLAIN, 0.45, 0.85);
  g.in(M(0, yT + 0.2, 0), () => g.cyl(0.035, 0.03, 4.56 - yT - 0.2, 10, IRON, false, true));
  g.in(M(0, yT + 0.23, 0), () => g.cyl(0.1, 0.08, 0.05, 12, IRON, false, true));
  g.in(M(0, hub, 0), () => sheave(g, 0.52, mul(wood, 1.15), 8, 0.05));
  g.in(M(0, 4.52, 0), () => finial(g, 0.12));
  // winch on the platform: a drum between two cheeks, a crank, the hauling rope up to the wheel
  g.in(M(0.42, py + 0.045, 0.3), () => {
    g.surf(K_WOOD, 0.9);
    for (const z of [-0.17, 0.17]) { g.in(M(0, 0.17, z), () => g.cbox(0.2, 0.34, 0.04, 0.008, tb(130 + z, 0.8))); }
    g.in(M(0, 0.22, -0.15, 90, 0, 0), () => g.cyl(0.07, 0.07, 0.3, 12, tb(133, 0.95), true, true));
    for (let i = 0; i < 8; i++) g.in(M(0, 0.22, -0.11 + i * 0.03, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.078, 0.013, 5, 14).rotateX(Math.PI / 2), mul(rgb(0xb89c68), 0.8 + 0.3 * hash1(i, 4))));
    g.surf(K_PLAIN, 0.5, 0.85);
    g.tube([[0, 0.22, 0.17], [0, 0.22, 0.25], [0.01, 0.1, 0.25], [0.01, 0.1, 0.33]], 0.011, 5, IRON);
    rope(g, [[-0.03, 0.29, 0], [-0.2, 0.6, -0.12], [-0.38, 1.02, -0.26]], 0.011);
  });
  g.in(M(-px(3.6) - 0.0, 3.62, px(3.6) + 0.07, 0, 0, 0), () => lantern(g));
  g.in(M(hd - 0.05, py + 0.52, hd - 0.05), () => sidePennant(g, f, 0.85, 0.5, 0.22));
  g.shade(-hd, py - 0.5, -hd, hd, py - 0.03, hd, 0.35, 0.1, [1, 1]);
  return { cableAt: [0, hub, 0] };
}

/** the gondola: origin where its grip meets the cable (which runs along X); the cabin hangs below */
function gondola(g, sideHex) {
  const wood = rgb(0x8a6a44), tb = tbOf(wood), side = rgb(sideHex), hx = 0.45, hz = 0.3, yf = -1.03, ye = -0.45, yw = yf + 0.34;
  // grip: two sheaves riding the cable, cheek plates, the hanger arm
  for (const x of [-0.13, 0.13]) g.in(M(x, 0.075, 0, 90, 0, 0), () => sheave(g, 0.068, rgb(0x6a5a48), 6, 0.022));
  g.surf(K_PLAIN, 0.45, 0.85);
  for (const z of [-0.036, 0.036]) g.in(M(0, 0.07, z), () => g.cbox(0.42, 0.07, 0.01, 0.004, IRON));
  for (const x of [-0.13, 0.13]) g.in(M(x, 0.075, -0.045, 90, 0, 0), () => g.cyl(0.014, 0.014, 0.09, 6, IRON, true, true));
  g.in(M(0, 0.02, 0), () => g.cbox(0.1, 0.05, 0.085, 0.006, IRON));
  g.tube([[0, 0.0, 0.045], [0, -0.04, 0.09], [0, -0.16, 0.1], [0, -0.26, 0.05], [0, -0.3, 0]], 0.02, 7, IRON);
  g.in(M(0, -0.32, 0), () => g.cbox(0.3, 0.035, 0.06, 0.008, IRON));
  // roof: a bowed lid of boards under painted canvas, a brass rail round it
  const roofY = (z) => -0.33 - 0.1 * (z / (hz + 0.05)) ** 2;
  g.surf(K_CLOTH, 0.85);
  g.sheet(10, 8, (u, v) => { const z = lerp(-hz - 0.05, hz + 0.05, v); return [lerp(-hx - 0.06, hx + 0.06, u), roofY(z), z]; }, (x, y, z) => (Math.abs(Math.abs(x) - 0.3) < 0.07 ? mul(side, 0.95) : mul(CREAM, 0.85 + 0.15 * noise3(x * 9, 1, z * 9))));
  g.surf(K_PLAIN, 1);
  g.sheet(2, 8, (u, v) => { const z = lerp(-hz - 0.05, hz + 0.05, v); return [lerp(-hx - 0.06, hx + 0.06, u), roofY(z) - 0.022, z]; }, mul(wood, 0.4));
  g.surf(K_WOOD, 0.88);
  for (const e of [-1, 1]) {
    g.in(M(0, roofY(hz + 0.05) - 0.012, e * (hz + 0.05)), () => g.beam(2 * hx + 0.14, 0.035, 0.03, 0.006, tb(3 + e, 0.7), 2));
    const pts = []; for (let k = 0; k <= 8; k++) { const z = lerp(-hz - 0.05, hz + 0.05, k / 8); pts.push([e * (hx + 0.06), roofY(z) - 0.011, z]); }
    g.tube(pts, 0.016, 5, woodTint(mul(wood, 0.7), e), true);
  }
  // body: floor, corner posts, boarded lower sides with the side's stripe, a top rail
  g.in(M(0, yf + 0.02, 0), () => g.cbox(2 * hx, 0.04, 2 * hz, 0.008, tb(10, 0.7)));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * (hx - 0.02), (yf + ye) / 2, sz * (hz - 0.02), 0, 0, 90), () => g.beam(ye - yf, 0.04, 0.04, 0.007, tb(12 + sx + sz * 2, 0.75), 2));
  for (let s = 0; s < 4; s++) {
    const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz;
    g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
      const door = s === 0;
      const spans = door ? [[-W + 0.03, -0.15], [0.15, W - 0.03]] : [[-W + 0.03, W - 0.03]];
      for (const [a, b] of spans) {
        const n = Math.max(1, Math.round((b - a) / 0.085)), bw = (b - a) / n;
        for (let i = 0; i < n; i++) { g.surf(K_WOOD, 0.88); g.in(M(a + bw * (i + 0.5), (yf + yw) / 2, -0.012, 0, 0, 90), () => g.beam(yw - yf, bw - 0.006, 0.018, 0.004, tb(20 + s * 9 + i, 0.95), 1)); }
        g.surf(K_CLOTH, 0.8);
        g.in(M((a + b) / 2, yw - 0.1, 0.001), () => g.cbox(b - a, 0.075, 0.012, 0.003, side));
        g.surf(K_WOOD, 0.88);
        g.in(M((a + b) / 2, yw + 0.012, -0.008), () => g.beam(b - a + 0.02, 0.03, 0.04, 0.006, tb(40 + s, 0.72), 1));
        g.in(M((a + b) / 2, yf + 0.05, 0.002), () => g.beam(b - a, 0.035, 0.02, 0.005, tb(44 + s, 0.68), 1));
      }
      if (door) for (const x of [-0.15, 0.15]) g.in(M(x, (yf + ye) / 2, -0.012, 0, 0, 90), () => g.beam(ye - yf, 0.03, 0.03, 0.006, tb(50 + x, 0.75), 2));
      g.in(M(0, ye + 0.012, -0.012), () => g.beam(2 * W - 0.02, 0.04, 0.035, 0.006, tb(54 + s, 0.72), 2));
      if (s % 2) { g.surf(K_PLAIN, 0.4, 0.9); g.in(M(0, yw - 0.1, 0.009), () => g.stud(0.03, GILT, 8, 0.4)); }
    });
  }
  // a crate and a sack riding inside, a lantern at one end, a pennant at the other
  g.in(M(0.14, yf + 0.04, -0.03, 0, 12, 0), () => crate(g, 0.3, 0.3, 0.28, rgb(0xa07a48), 5));
  g.in(M(-0.22, yf + 0.04, 0.04, 0, 70, 0), () => g.in(M(0, 0, 0, 0, 0, 0, 0.8), () => sacks(g, 1, 31)));
  g.in(M(hx + 0.06, -0.47, 0, 0, 90, 0), () => g.in(M(0, 0, 0, 0, 0, 0, 0.8), () => lantern(g)));
  g.surf(K_WOOD, 0.8);
  g.in(M(-hx - 0.03, -0.42, 0), () => { g.cyl(0.01, 0.008, 0.3, 6, woodTint(rgb(0x5a4028), 2), false, true); g.surf(K_CLOTH, 0.85); g.sheet(6, 2, (u, v) => [-0.008 - u * 0.2, 0.29 - v * 0.09 * (1 - u * 0.8) - u * 0.03, Math.sin(u * 6) * 0.015], side); });
  g.shade(-hx, yf, -hz, hx, yw, hz, 0.3, 0.05);
}

// =====================================================================================================
// Market, garden, fountain, shrine, graveyard
// =====================================================================================================
const PRODUCE = { apple: rgb(0xc8322a), pear: rgb(0xc9b83a), cabbage: rgb(0x6fa04a), plum: rgb(0x6a3a7a), orange: rgb(0xe08a2a), turnip: rgb(0xd8c8b0), bread: rgb(0xb8843e) };
/** a trestle table along X standing on the local origin: planked top at height h */
function trestleTable(g, L, D, h, wood, seed) {
  const tb = tbOf(wood);
  g.surf(K_WOOD, 0.88);
  const n = Math.max(2, Math.round(D / 0.14));
  for (let i = 0; i < n; i++) g.in(M(0, h - 0.02, -D / 2 + (D * (i + 0.5)) / n), () => g.beam(L - 0.02 * hash1(seed, i), 0.04, D / n - 0.008, 0.006, tb(seed + i), 3));
  for (const e of [-1, 1]) {
    const x = e * (L / 2 - 0.2);
    for (const q of [-1, 1]) g.beamTo([x, 0, q * (D / 2 - 0.02)], [x, h - 0.06, q * -0.04], 0.05, 0.035, 0.007, tb(seed + 10 + e + q * 3, 0.75), 2, [1, 0, 0]);
    g.in(M(x, h - 0.065, 0, 0, 90, 0), () => g.beam(D - 0.06, 0.05, 0.045, 0.007, tb(seed + 20 + e, 0.75), 1));
  }
  g.beamTo([-(L / 2 - 0.2), h * 0.42, 0], [L / 2 - 0.2, h * 0.42, 0], 0.04, 0.03, 0.006, tb(seed + 30, 0.7), 2);
}
/** a striped awning: rows of posts at z = zb (height yb) and z = zf (height yf), cloth sagging between, a scalloped valance along the front */
function awning(g, x0, x1, zb, yb, zf, yf, c1, c2, seed, stripes = 8) {
  const nu = stripes * 2;
  const col = (x, y, z, nx, ny, nz, u) => mul(Math.floor(Math.min(0.999, u) * stripes) % 2 ? c2 : c1, 0.86 + 0.2 * noise3(x * 5 + seed, y * 5, z * 5));
  g.surf(K_CLOTH, 0.9);
  g.sheet(nu, 6, (u, v) => { const sag = 0.05 * Math.sin(Math.PI * v) * (0.6 + 0.4 * Math.sin(Math.PI * u)) + 0.018 * Math.sin(Math.PI * v) * Math.cos(u * stripes * Math.PI); return [lerp(x0, x1, u), lerp(yb, yf, v) - sag, lerp(zb, zf, v)]; }, col);
  g.sheet(nu * 2, 2, (u, v) => { const sc = 0.03 * Math.abs(Math.sin(u * stripes * Math.PI)); return [lerp(x0, x1, u), yf - v * (0.1 + sc) + 0.002, zf + 0.004 + v * 0.02]; }, (x, y, z, nx, ny, nz, u) => mul(Math.floor(Math.min(0.999, u) * stripes) % 2 ? c1 : c2, 0.8 + 0.2 * noise3(x * 5, y * 5, seed)));
}
function stall(g, hex) {
  const cloth = rgb(hex), wood = rgb(0x8a6a44), tb = tbOf(wood);
  // frame: four poles, rails front and back
  g.surf(K_WOOD, 0.9);
  for (const [x, z, h] of [[-0.93, 0.43, 1.3], [0.93, 0.43, 1.3], [-0.93, -0.43, 1.52], [0.93, -0.43, 1.52]]) {
    g.in(M(x, h / 2, z, 0, 0, 90), () => g.beam(h, 0.05, 0.05, 0.01, tb(x * 3 + z, 0.78), 3));
    g.surf(K_STONE, 0.95); g.in(M(x, 0.0, z), () => g.cbox(0.13, 0.08, 0.13, 0.02, stoneTint(rgb(0x85807a), x + z))); g.surf(K_WOOD, 0.9);
  }
  g.in(M(0, 1.27, 0.43), () => g.beam(1.94, 0.04, 0.04, 0.008, tb(5, 0.75), 3));
  g.in(M(0, 1.49, -0.43), () => g.beam(1.94, 0.04, 0.04, 0.008, tb(6, 0.75), 3));
  for (const x of [-0.93, 0.93]) g.beamTo([x, 1.5, -0.43], [x, 1.28, 0.43], 0.04, 0.035, 0.007, tb(7 + x, 0.75), 2);
  awning(g, -1.0, 1.0, -0.5, 1.56, 0.5, 1.3, [cloth[0] * 1.3, cloth[1] * 0.72, cloth[2] * 0.66], CREAM, 3, 8);
  g.surf(K_CLOTH, 0.92);
  g.sheet(8, 3, (u, v) => [lerp(-0.93, 0.93, u), lerp(1.47, 0.62, v), -0.45 + 0.012 * Math.sin(u * 9 + v * 3)], (x, y, z, nx, ny, nz, u, v) => mul(Math.floor(u * 8) % 2 ? mix(CREAM, cloth, 0.55) : mix(CREAM, cloth, 0.1), 0.72 + 0.2 * v));
  // counter and what is on it
  g.in(M(0, 0, 0.14), () => trestleTable(g, 1.72, 0.56, 0.56, rgb(0x9a7648), 40));
  const top = 0.56;
  g.in(M(-0.62, top, 0.1), () => basket(g, 0.15, 0.13, PRODUCE.apple, 1, 12, 0.27));
  g.in(M(-0.24, top, 0.2), () => basket(g, 0.14, 0.11, PRODUCE.pear, 2, 11, 0.27));
  g.in(M(0.14, top, 0.08), () => basket(g, 0.16, 0.12, PRODUCE.cabbage, 3, 6, 0.42));
  g.surf(K_PLAIN, 0.65);
  for (const [x, z, s] of [[0.5, 0.22, 0.085], [0.68, 0.06, 0.1], [0.74, 0.27, 0.07]]) g.in(M(x, top + s * 0.72, z), () => g.add(new THREE.SphereGeometry(s, 12, 8).scale(1, 0.74, 1), (px, py, pz) => mul(PRODUCE.orange, (0.82 + 0.25 * Math.abs(Math.sin(Math.atan2(pz, px) * 5))) * (0.8 + 0.3 * py / s))));
  for (let i = 0; i < 4; i++) g.in(M(-0.42 + i * 0.1, top + 0.035, -0.06, 0, 20 + i * 7, 0), () => g.add(new THREE.SphereGeometry(0.05, 8, 6).scale(1.5, 0.7, 0.9), mul(PRODUCE.bread, 0.85 + 0.3 * hash1(i, 3))));
  g.in(M(0.44, top, -0.04), () => { g.cyl(0.1, 0.1, 0.06, 16, rgb(0xd8b04a), false, true); g.surf(K_PLAIN, 0.7); });
  // strings of onions and a ham hang from the back rail
  for (const [x, c, n] of [[-0.55, rgb(0xc9a05a), 5], [-0.2, rgb(0x9a3a4a), 5], [0.62, rgb(0xd8d0b0), 6]]) for (let i = 0; i < n; i++) g.in(M(x + 0.022 * Math.sin(i * 2.4), 1.42 - i * 0.055, -0.34 + 0.022 * Math.cos(i * 2.4)), () => g.add(new THREE.SphereGeometry(0.032, 7, 5), mul(c, 0.85 + 0.3 * hash1(i, x * 10))));
  g.in(M(0.22, 1.2, -0.33), () => g.lathe([[0, 0], [0.05, 0.03], [0.075, 0.1], [0.06, 0.2], [0.025, 0.27], [0.012, 0.3]], 10, (x, y) => mul(rgb(0x9a4a3a), 0.8 + y)));
  // crates, a sack and a cask at the ends
  g.in(M(-0.72, -0.02, -0.2, 0, 8, 0), () => crate(g, 0.36, 0.3, 0.34, rgb(0xa07a48), 11));
  g.surf(K_PLAIN, 0.6);
  for (let i = 0; i < 6; i++) g.in(M(-0.8 + (i % 3) * 0.085, 0.31, -0.26 + Math.floor(i / 3) * 0.1), () => g.add(new THREE.SphereGeometry(0.045, 6, 4), mul(PRODUCE.turnip, 0.85 + 0.3 * hash1(i, 9))));
  g.in(M(0.74, 0, -0.22), () => barrel(g, 0.14, 0.36, rgb(0x7a5a38), 5));
  g.shade(-0.95, 0, -0.45, 0.95, 1.25, 0.45, 0.22, 0.2, [1, 1]);
}

/** a robed figure in stone, about 1 tall before scaling, standing on the local origin and facing +Z */
function carvedFigure(hex, pose) {
  const P = [], sk = (p) => p.color(hex).tint(0.12, 14).pbr(0.9);
  P.push(sk(S.cone(0.2, 0.1, 0.62, 0.03).at(0, 0.31, 0).bump(0.008, 9, 'fur')));                       // robe, hanging in folds
  P.push(sk(S.ellipsoid(0.13, 0.15, 0.1).at(0, 0.68, 0).blend(0.04)));                                  // chest
  P.push(sk(S.capsule([0, 0.8, 0], [0, 0.87, 0.005], 0.045, 0.04).blend(0.02)));                        // neck
  P.push(sk(S.ellipsoid(0.07, 0.085, 0.078).at(0, 0.94, 0.01).blend(0.012)));                           // head
  P.push(sk(S.ellipsoid(0.095, 0.1, 0.1).at(0, 0.95, -0.025).blend(0.02)));                             // hood
  P.push(sk(S.ellipsoid(0.11, 0.2, 0.06).at(0, 0.7, -0.07).blend(0.05)));                               //   falling down the back
  if (pose === 'pour') {
    // a water-bearer tipping a jar from the shoulder
    P.push(sk(S.limb([[0.13, 0.78, 0], [0.2, 0.9, 0.06], [0.12, 0.99, 0.12]], [0.046, 0.04, 0.034])[0].blend(0.03)), sk(S.limb([[0.13, 0.78, 0], [0.2, 0.9, 0.06], [0.12, 0.99, 0.12]], [0.046, 0.04, 0.034])[1].blend(0.03)));
    P.push(...S.limb([[-0.13, 0.78, 0], [-0.17, 0.66, 0.1], [-0.02, 0.74, 0.19]], [0.046, 0.04, 0.034]).map((p) => sk(p).blend(0.03)));
    P.push(sk(S.ellipsoid(0.085, 0.11, 0.085).rot(62, 0, -8).at(0.06, 0.88, 0.2).blend(0.01)));       // the jar
    P.push(sk(S.cone(0.04, 0.055, 0.07, 0.01).rot(62, 0, -8).at(0.07, 0.83, 0.3).blend(0.012)));      //   its neck
  } else {
    // hands together at the breast
    for (const e of [-1, 1]) P.push(...S.limb([[e * 0.13, 0.78, 0], [e * 0.16, 0.62, 0.07], [e * 0.015, 0.7, 0.13]], [0.046, 0.04, 0.032]).map((p) => sk(p).blend(0.03)));
    P.push(sk(S.ellipsoid(0.035, 0.05, 0.03).rot(-20, 0, 0).at(0, 0.72, 0.14).blend(0.012)));
  }
  P.push(sk(S.box(0.3, 0.04, 0.3, 0.012).at(0, 0.015, 0)));
  return { prims: P };
}
function fountain(g, hex) {
  const st = stoneStyle(hex, { seed: 1700, course: 0.15, len: [0.26, 0.42] }), col = st.pal[0], cc = stoneTint(mul(col, 1.03), 4, 5), R = 0.93, r = st.r;
  // the basin: a step, a coursed drum, a moulded coping
  g.surf(K_STONE, 0.93);
  g.lathe([[R + 0.06, -0.14], [R + 0.06, 0.05], [R + 0.03, 0.07], [R - 0.01, 0.07]], 40, cc);
  g.in(M(0, 0.07, 0), () => g.bend(R - 0.04 - r, () => g.ashlar((R - 0.04 - r) * TAU, 0.3, { ...st, wrap: true })));
  g.lathe([[R - 0.04, 0.35], [R + 0.01, 0.36], [R + 0.025, 0.385], [R + 0.01, 0.41], [R - 0.03, 0.42], [R - 0.14, 0.42], [R - 0.16, 0.4], [R - 0.17, 0.2]], 40, cc);
  const water = (x, y, z) => { const d = Math.hypot(x, z); return mix(rgb(0x2f7f9a), rgb(0x9fd8e0), clamp(0.35 + 0.3 * Math.sin(d * 34) * (0.4 + 0.6 * noise3(x * 4, 1, z * 4)) + 0.3 * smooth(0.5, 0.0, d), 0, 1)); };
  g.surf(K_PLAIN, 0.08, 0.2, 0.1);
  g.sheet(40, 10, (u, v) => { const a = u * TAU, d = v * (R - 0.165); return [Math.cos(a) * d, 0.31 + 0.006 * Math.sin(d * 34), Math.sin(a) * d]; }, water, true);
  // stem, the upper bowl with its spouts, the figure
  g.surf(K_STONE, 0.9);
  g.lathe([[0.3, 0.2], [0.3, 0.36], [0.26, 0.4], [0.17, 0.44], [0.13, 0.52], [0.16, 0.6], [0.12, 0.68], [0.1, 0.8], [0.14, 0.86], [0.3, 0.92], [0.44, 1.0], [0.5, 1.07], [0.5, 1.1], [0.46, 1.11], [0.44, 1.09], [0.3, 1.02], [0, 1.0]], 36, cc);
  g.surf(K_PLAIN, 0.08, 0.2, 0.1);
  g.sheet(24, 4, (u, v) => { const a = u * TAU, d = v * 0.445; return [Math.cos(a) * d, 1.085 + 0.004 * Math.sin(d * 50), Math.sin(a) * d]; }, water, true);
  g.surf(K_STONE, 0.9);
  g.lathe([[0.15, 1.0], [0.13, 1.12], [0.09, 1.16], [0.11, 1.22], [0.15, 1.25], [0.15, 1.28], [0, 1.28]], 20, cc);
  g.in(M(0, 1.27, 0, 0, 0, 0, 0.62), () => g.sculpt(carvedFigure(hex, 'pour'), 54, 0.8));
  // sculpted water: a thread from the jar, six jets from the bowl's lip, rings where they land
  const wc = (x, y, z, nx, ny, nz, t) => mix(rgb(0xd8f2f6), rgb(0x6fb8d0), 0.3 + 0.5 * t);
  const jet = (pts, r0, r1) => { g.surf(K_PLAIN, 0.1, 0.1, 0.35); g.tube(pts, pts.map((_, i) => lerp(r0, r1, i / (pts.length - 1))), 6, wc, false); };
  const jar = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; jar.push([0.045 + 0.02 * t, 1.79 - 0.7 * t * t - 0.01 * t, 0.2 + 0.17 * t]); }
  jet(jar, 0.012, 0.02);
  for (let i = 0; i < 6; i++) {
    const a = (i + 0.5) * (TAU / 6), co = Math.cos(a), si = Math.sin(a), pts = [];
    g.surf(K_STONE, 0.9);
    g.in(M(co * 0.5, 1.04, si * 0.5), () => g.add(new THREE.SphereGeometry(0.05, 10, 8).scale(1, 0.9, 1), cc));
    for (let k = 0; k <= 8; k++) { const t = k / 8, d = 0.54 + 0.16 * t; pts.push([co * d, 1.03 - 0.71 * t * t, si * d]); }
    jet(pts, 0.014, 0.024);
    g.surf(K_PLAIN, 0.1, 0.1, 0.3);
    g.in(M(co * 0.7, 0.318, si * 0.7), () => { g.add(new THREE.TorusGeometry(0.055, 0.012, 4, 14).rotateX(Math.PI / 2), rgb(0xd8f2f6)); g.add(new THREE.TorusGeometry(0.1, 0.008, 4, 16).rotateX(Math.PI / 2), rgb(0xb8e4ec)); });
  }
  g.in(M(0.062, 1.09, 0.37), () => g.add(new THREE.TorusGeometry(0.04, 0.01, 4, 12).rotateX(Math.PI / 2), rgb(0xd8f2f6)));
  g.shade(-0.5, 0.86, -0.5, 0.5, 1.06, 0.5, 0.25, 0.08, [1, 1]);
}

function shrine(g, hex) {
  const st = stoneStyle(hex, { seed: 1800, course: 0.14, len: [0.24, 0.42] }), col = st.pal[0], cc = stoneTint(mul(col, 1.03), 4, 5), r = st.r;
  // two steps
  stoneBox(g, 0.9, 0.8, 0, 0.14, st, 1801);
  let pv = pave(hex, 1805, { course: 0.4 });
  g.in(M(-0.9, 0.14 - pv.r, 0.8, -90, 0, 0), () => g.ashlar(1.8, 1.6, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
  g.in(M(0, 0, -0.08), () => { stoneBox(g, 0.7, 0.6, 0.14, 0.28, st, 1811, { noFoot: true }); pv = pave(hex, 1815, { course: 0.4 }); g.in(M(-0.7, 0.28 - pv.r, 0.6, -90, 0, 0), () => g.ashlar(1.4, 1.2, { ...pv, ends: [CUT, CUT, CUT, CUT] })); });
  // the back wall with its niche
  const wz = -0.38, wh = 0.2, wx = 0.52, y0 = 0.28, y1 = 1.4;
  g.in(M(0, 0, wz), () => stoneBox(g, wx, wh, y0, y1, st, 1821, { noFoot: true, holes: [[[wx - r - 0.2, 0.28, wx - r + 0.2, 0.98]], null, null, null], each: (s) => {
    if (s) return;
    g.in(M(wx - r, 0.28, r), () => {
      // niche: a round-headed recess lined in blue and gold
      const zb = -0.17, w = 0.4, h = 0.7, top = (x) => h - 0.2 + Math.sqrt(Math.max(0, 0.04 - x * x));
      g.surf(K_PLAIN, 0.8);
      const out = [[-w / 2, 0]]; for (let k = 0; k <= 10; k++) { const x = -w / 2 + (w * k) / 10; out.push([x, top(x)]); } out.push([w / 2, 0]);
      for (let k = 0; k < out.length - 1; k++) { const a = out[k], b = out[k + 1]; g.flat([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], zb], [a[0], a[1], zb]], [mul(col, 0.8), mul(col, 0.8), mul(rgb(0x2f4a8a), 0.7), mul(rgb(0x2f4a8a), 0.7)]); }
      for (let k = 1; k < out.length - 2; k++) { const a = out[k], b = out[k + 1]; g.flat([[a[0], a[1], zb], [b[0], b[1], zb], [0, 0, zb]], rgb(0x2f4a8a)); g.flat([[a[0], a[1], 0.002], [b[0], b[1], 0.002], [(a[0] + b[0]) / 2 < 0 ? -w / 2 : w / 2, h, 0.002]], mul(col, 0.95)); }
      g.flat([[-w / 2, 0, zb], [w / 2, 0, zb], [w / 2, 0, 0.02], [-w / 2, 0, 0.02]], mul(col, 0.9));
      g.surf(K_PLAIN, 0.35, 0.9);
      g.tube(out.map(([x, y]) => [x, y, 0.008]), 0.016, 5, GILT, true);
      for (let i = 0; i < 7; i++) g.in(M(-0.12 + (i % 4) * 0.08 + (i > 3 ? 0.04 : 0), 0.52 + (i > 3 ? 0.09 : 0), zb + 0.002), () => g.stud(0.012, GILT, 5, 0.4));
    });
  } }));
  // the figure in the niche, a gilt ring behind its head
  g.in(M(0, 0.56, wz + wh - 0.1, 0, 0, 0, 0.6), () => g.sculpt(carvedFigure(0xe8e2d2, 'pray'), 38, 0.8));
  g.surf(K_PLAIN, 0.3, 0.9, 0.15);
  g.in(M(0, 1.13, wz + wh - 0.14), () => g.add(new THREE.TorusGeometry(0.085, 0.01, 5, 20), GILT));
  // canopy: two columns in front, a little tiled gable roof, a sun on the pediment
  for (const e of [-1, 1]) g.in(M(e * 0.5, 0.28, 0.2), () => column(g, 0.065, 1.08, mul(col, 1.04), e + 3));
  g.surf(K_STONE, 0.93);
  g.in(M(0, 1.4, -0.1), () => g.cbox(1.24, 0.09, 0.84, 0.016, cc));
  const eY = 1.42, rY = 1.86, eX = 0.72;
  g.in(M(0, 0, -0.1, 0, -90, 0), () => gableRoof(g, { x0: -0.52, x1: 0.52, eZ: eX, eY, rY, pal: BLUE_SLATE, seed: 1830, tw: 0.13, th: 0.12, ridgeR: 0.05, ridgeCol: LEAD }));
  for (const z of [0.4, -0.6]) {
    g.surf(K_STONE, 0.93);
    g.flat([[-eX + 0.06, eY + 0.02, z], [eX - 0.06, eY + 0.02, z], [0, rY - 0.03, z]], [mul(col, 0.95), mul(col, 0.95), mul(col, 1.05)]);
    const f = z > 0 ? 1 : -1;
    for (const e of [-1, 1]) g.beamTo([e * (eX + 0.01), eY - 0.02, z + f * 0.02], [0, rY + 0.0, z + f * 0.02], 0.07, 0.05, 0.012, cc, 2);
  }
  g.surf(K_PLAIN, 0.3, 0.9);
  g.in(M(0, 1.58, 0.425, 90, 0, 0), () => { g.lathe([[0, 0.022], [0.05, 0.016], [0.07, 0]].reverse(), 14, GILT); for (let i = 0; i < 10; i++) g.in(M(0, 0, 0, 0, i * 36, 0), () => g.flat([[0.075, 0.004, -0.012], [0.075, 0.004, 0.012], [0.125, 0.004, 0]], GILT)); });
  g.in(M(0, rY + 0.02, 0.42), () => finial(g, 0.16));
  // candles and offerings on the steps
  const rnd = rng(1840);
  for (const [x, z, h, y] of [[-0.3, 0.2, 0.1, 0.28], [-0.2, 0.3, 0.07, 0.28], [-0.36, 0.34, 0.05, 0.28], [0.26, 0.22, 0.11, 0.28], [0.36, 0.32, 0.06, 0.28], [0.18, 0.36, 0.08, 0.28], [-0.62, 0.6, 0.08, 0.14], [0.6, 0.62, 0.06, 0.14], [0.05, 0.02, 0.09, 0.28], [-0.07, 0.03, 0.06, 0.28]]) g.in(M(x, y, z), () => {
    g.surf(K_PLAIN, 0.6);
    g.lathe([[0.026, 0], [0.02, 0.006], [0.016, 0.012], [0.015, h], [0.004, h + 0.004]], 8, (px, py) => mul(rgb(0xe8dcc0), 0.85 + 0.15 * rnd()));
    g.surf(K_PLAIN, 1, 0, 1.9);
    g.in(M(0, h + 0.004, 0), () => g.lathe([[0.003, 0], [0.011, 0.012], [0.009, 0.026], [0, 0.05]], 6, (px, py) => (py > 0.03 ? [1.0, 0.4, 0.05] : [1.0, 0.68, 0.16])));
  });
  g.in(M(0.02, 0.28, 0.34), () => basket(g, 0.1, 0.07, PRODUCE.apple, 7, 7, 0.3));
  g.surf(K_PLAIN, 0.7);
  g.in(M(-0.52, 0.28, 0.02), () => g.lathe([[0.04, 0], [0.065, 0.04], [0.07, 0.09], [0.04, 0.14], [0.03, 0.18], [0.045, 0.2], [0.03, 0.2]], 12, (x, y) => mul(rgb(0x3f6a8a), 0.8 + 0.3 * noise3(x * 30, y * 30, 1))));
  // a wreath of flowers laid against the step
  g.in(M(0.42, 0.25, 0.56, -62, 0, 0), () => { g.surf(K_LEAF, 0.9); g.add(new THREE.TorusGeometry(0.11, 0.028, 6, 18), (x, y, z) => mul(rgb(0x3f7a34), 0.7 + 0.5 * noise3(x * 30, y * 30, z * 30))); g.surf(K_PLAIN, 0.7); const fl = [rgb(0xe9e4d8), rgb(0xd8483a), rgb(0xe8c23a), rgb(0xc45a9a)]; for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.in(M(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.024), () => g.stud(0.022, fl[i % 4], 6, 0.6)); } });
  g.surf(K_PLAIN, 0.3, 0.9);
  for (let i = 0; i < 8; i++) g.in(M(-0.25 + rnd() * 0.18, 0.282 + (i % 2) * 0.004, 0.42 + rnd() * 0.12, -90, 0, 0), () => g.stud(0.016, GILT, 7, 0.2));
  g.shade(-0.7, 1.0, -0.7, 0.7, 1.42, 0.5, 0.3, 0.1, [1, 1]);
}

/** a clipped hedge along local X from x0 to x1, centred on z = 0: a rounded bank of leaves */
function hedge(g, x0, x1, ht, th, leaf, seed) {
  const L = x1 - x0, nu = Math.max(4, Math.round(L * 10)), rnd = rng(seed * 13 + 1);
  const prof = (u, v) => {
    const a = v * Math.PI, end = Math.min(1, Math.min(u, 1 - u) * L / 0.07), k = Math.pow(Math.sin(Math.acos(1 - Math.min(1, end))), 0.6) || 0;
    const x = lerp(x0, x1, u), sq = (t) => Math.sign(t) * Math.pow(Math.abs(t), 0.42);
    const bump = 1 + 0.1 * (noise3(x * 7 + seed, Math.cos(a) * 3, Math.sin(a) * 3) - 0.5);
    return [x, Math.max(-0.02, ht * sq(Math.sin(a)) * (0.55 + 0.45 * k) * bump), -sq(Math.cos(a)) * (th / 2) * (0.5 + 0.5 * k) * bump];
  };
  g.surf(K_LEAF, 0.85);
  g.sheet(nu, 10, prof, (x, y, z) => mul(leaf, (0.5 + 0.55 * (y / ht)) * (0.8 + 0.4 * noise3(x * 11 + seed, y * 11, z * 11))));
  const sun = [leaf[0] * 1.7 + 0.03, leaf[1] * 1.4 + 0.02, leaf[2] * 0.7], n = Math.round(L * 150 * qual());
  for (let i = 0; i < n; i++) {
    const u = 0.03 + rnd() * 0.94, v = 0.12 + rnd() * 0.76, p = prof(u, v), a = v * Math.PI;
    const ny = Math.sin(a), nz = -Math.cos(a), s = 0.045 + rnd() * 0.035, sp = rnd() * TAU, c = mul(mix(leaf, sun, rnd() * ny), 0.75 + 0.5 * rnd());
    const ux = Math.cos(sp), uy = Math.sin(sp) * -nz, uz = Math.sin(sp) * ny;
    const vx = -Math.sin(sp), vy = Math.cos(sp) * -nz, vz = Math.cos(sp) * ny;
    const A = (fu, fv, o) => [p[0] + (ux * fu + vx * fv) * s, p[1] + (uy * fu + vy * fv + ny * o) * s, p[2] + (uz * fu + vz * fv + nz * o) * s];
    const i0 = g.v(...A(-0.5, 0, 0.05), 0, ny + 0.2, nz, mul(c, 0.7)), i1 = g.v(...A(0, 0.4, 0.2), vx * 0.5, ny + 0.2, nz, c), i2 = g.v(...A(0.6, 0, 0.45), ux * 0.3, ny + 0.3, nz, mul(c, 1.2)), i3 = g.v(...A(0, -0.4, 0.2), -vx * 0.5, ny + 0.2, nz, c);
    g.tri(i0, i1, i2); g.tri(i0, i2, i3);
  }
}
/** a low mound of earth on the local origin, rx x rz, h high */
function mound(g, rx, rz, h, col, seed, grass = 0.5) {
  g.surf(K_PLAIN, 1);
  g.sheet(14, 5, (u, v) => { const a = u * TAU, d = 1 - v, k = 1 + 0.1 * (noise3(Math.cos(a) * 2 + seed, 2, Math.sin(a) * 2) - 0.5); return [Math.cos(a) * rx * d * k, h * (1 - d * d) * (0.8 + 0.4 * noise3(Math.cos(a) * d * 3, seed, Math.sin(a) * d * 3)) + (v === 0 ? -0.02 : 0), Math.sin(a) * rz * d * k]; },
    (x, y, z) => mix(mul(col, 0.75 + 0.5 * noise3(x * 9, seed, z * 9)), rgb(0x4f7a3a), grass * smooth(0.45, 0.7, noise3(x * 4 + seed, 3, z * 4))), true);
}
function garden(g, hex) {
  const leaf = mul(rgb(hex), 0.8), rnd = rng(1900);
  // lawn, then the gravel cross with its edging
  g.surf(K_LEAF, 1);
  g.sheet(12, 12, (u, v) => [lerp(-1.5, 1.5, u), 0.012, lerp(-1.5, 1.5, v)], (x, y, z) => mul(mix(rgb(0x5f9440), rgb(0x79a84a), noise3(x * 3, 1, z * 3)), 0.85 + 0.3 * noise3(x * 13, 2, z * 13)));
  const gravel = (x, y, z) => mul(mix(rgb(0xc9b894), rgb(0xa89878), noise3(x * 6, 4, z * 6)), 0.8 + 0.4 * noise3(x * 40, 5, z * 40));
  g.surf(K_PLAIN, 1);
  g.sheet(20, 4, (u, v) => [lerp(-1.5, 1.5, u), 0.024, lerp(-0.3, 0.3, v)], gravel);
  for (const e of [-1, 1]) g.sheet(8, 4, (u, v) => [lerp(-0.3, 0.3, v), 0.024, e * lerp(0.3, 1.5, u)], gravel);
  g.sheet(16, 3, (u, v) => { const a = u * TAU, d = 0.3 + v * 0.26; return [Math.cos(a) * d, 0.025, Math.sin(a) * d]; }, gravel, true);
  g.surf(K_STONE, 0.95);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    for (const e of [-1, 1]) for (let i = 0; i < 5; i++) { const x = 0.6 + i * 0.185; g.in(M(x, 0.03, e * 0.33, 0, (rnd() - 0.5) * 8, 0), () => g.cbox(0.17, 0.06, 0.07, 0.016, stoneTint(mul(rgb(0xa8a296), 0.85 + 0.3 * rnd()), i + s * 9, 7))); }
    // hedges either side of the gate in this side, and the bed in this quarter
    for (const e of [-1, 1]) g.in(M(e * 0.92, 0, 1.345), () => hedge(g, -0.5, 0.5, 0.36, 0.26, mul(leaf, 0.9 + 0.2 * rnd()), 1910 + s * 4 + e));
    g.in(M(0.92, 0, 0.92), () => {
      mound(g, 0.4, 0.4, 0.07, rgb(0x4a3626), 1920 + s, 0);
      g.surf(K_STONE, 0.95);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.in(M(Math.cos(a) * 0.41, 0.025, Math.sin(a) * 0.41, 0, -a / DEG + 90, 0), () => g.cbox(0.19, 0.06, 0.055, 0.016, stoneTint(mul(rgb(0xa8a296), 0.85 + 0.3 * rnd()), i + s * 5, 7))); }
      const fl = [[rgb(0xd8383a), rgb(0xe8a03a)], [rgb(0xe8d03a), rgb(0xf0ece0)], [rgb(0x8a4ac8), rgb(0xd86aa8)], [rgb(0xf0ece0), rgb(0x4a7ad8)]][s];
      for (let i = 0; i < 26; i++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.33, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.13 + rnd() * 0.13, lx = (rnd() - 0.5) * 0.04, lz = (rnd() - 0.5) * 0.04;
        g.surf(K_LEAF, 0.9);
        const gc = mul(rgb(0x3f7a34), 0.8 + 0.4 * rnd());
        g.flat([[x - 0.008, 0.05, z], [x + 0.008, 0.05, z], [x + lx, h, z + lz]], gc);
        for (const q of [0, 1.6, 3.2, 4.8]) g.flat([[x, 0.05, z], [x + Math.cos(q + i) * 0.06, 0.1 + rnd() * 0.04, z + Math.sin(q + i) * 0.06], [x + Math.cos(q + i + 0.7) * 0.035, 0.06, z + Math.sin(q + i + 0.7) * 0.035]], [mul(gc, 0.7), mul(gc, 1.2), gc]);
        g.surf(K_PLAIN, 0.7);
        g.in(M(x + lx, h, z + lz), () => g.add(new THREE.SphereGeometry(0.026 + rnd() * 0.012, 6, 4).scale(1, 0.7, 1), mul(fl[i % 2], 0.85 + 0.3 * rnd())));
      }
    });
    // an ornamental tree in the corner: a clipped ball on a slim trunk, in blossom
    g.in(M(1.22, 0, 1.22), () => {
      const prims = [S.capsule([0, -0.04, 0], [0.01, 0.62, 0.01], 0.05, 0.036).color(0x5e4a36).bump(0.008, 12, 'fur').tint(0.25, 16)];
      for (let i = 0; i < 4; i++) { const a = i * 1.57 + s; prims.push(S.capsule([0.01, 0.56, 0.01], [Math.cos(a) * 0.15, 0.82, Math.sin(a) * 0.15], 0.03, 0.018).color(0x5e4a36).blend(0.03)); }
      g.surf(K_WOOD, 0.95);
      g.sculpt({ prims }, 34, 0.6);
      const bl = s % 2 ? rgb(0xe89ab8) : mul(leaf, 1.05);
      foliage(g, 0, 0.98, 0, 0.36, 0.33, 0.36, Math.round(300 * qual()), bl, 1930 + s, 0.085, 0.66, 1.34);
      if (s % 2 === 0) { g.surf(K_PLAIN, 0.7); for (let i = 0; i < 16; i++) { const yy = 1 - (i + 0.5) / 9, rr = Math.sqrt(Math.max(0, 1 - yy * yy)), a = i * 2.4; g.in(M(Math.cos(a) * rr * 0.37, 0.98 + yy * 0.34, Math.sin(a) * rr * 0.37), () => g.add(new THREE.SphereGeometry(0.03, 6, 4), rgb(0xe8a03a))); } }
    });
  });
  // sundial
  const sc = stoneTint(rgb(0xc8c2b4), 3, 6);
  g.surf(K_STONE, 0.9);
  g.in(M(0, 0.03, 0), () => g.cbox(0.4, 0.06, 0.4, 0.014, sc));
  g.lathe([[0.15, 0.06], [0.15, 0.09], [0.11, 0.11], [0.075, 0.14], [0.06, 0.2], [0.07, 0.27], [0.055, 0.31], [0.07, 0.33], [0.13, 0.35], [0.14, 0.37], [0.14, 0.385], [0, 0.385]], 20, sc);
  g.surf(K_PLAIN, 0.35, 0.9);
  g.in(M(0, 0.386, 0), () => { g.cyl(0.115, 0.115, 0.006, 20, rgb(0xa8843a), false, true); g.flat([[0, 0.006, -0.085], [0, 0.006, 0.07], [0, 0.058, -0.085]], GILT); for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.in(M(Math.cos(a) * 0.095, 0.006, Math.sin(a) * 0.095, -90, 0, 0), () => g.stud(0.008, GILT, 4, 0.5)); } });
}

/** a dry-stone wall along local X from x0 to x1, centred on z = 0 */
function rubbleWall(g, x0, x1, H, hb, ht, st, seed) {
  const L = x1 - x0, slope = Math.hypot(H, hb - ht), tilt = Math.atan2(hb - ht, H) / DEG, rnd = rng(seed * 7 + 3);
  g.surf(K_STONE, 0.95);
  g.in(M((x0 + x1) / 2, 0, 0), () => {
    for (const s of [0, 1]) g.in(M(0, 0, 0, 0, s * 180, 0).multiply(M(-L / 2, 0, hb, -tilt, 0, 0)), () => { rubbleFace(g, L, slope, st, seed + s); footing(g, 0, L, st.pal[3]); });
    for (const e of [-1, 1]) g.in(M(e * L / 2, 0, e * hb, 0, e * 90, 0), () => { rubbleFace(g, 2 * hb, H, st, seed + 5 + e, hb - ht); footing(g, 0, 2 * hb, st.pal[3]); });
    let x = -L / 2;
    while (x < L / 2 - 0.02) {
      let w = 0.07 + rnd() * 0.05;
      if (L / 2 - x - w < 0.06) w = L / 2 - x;
      const h = 0.085 + rnd() * 0.04, cc = mul(st.pal[Math.floor(rnd() * st.pal.length)], 0.85 + 0.3 * rnd());
      g.in(M(x + w / 2, H + h / 2 - 0.025, (rnd() - 0.5) * 0.02, (rnd() - 0.5) * 8, 0, (rnd() - 0.5) * 12), () => g.cbox(w - 0.006, h, 2 * ht + 0.04 + rnd() * 0.03, 0.02, stoneTint(cc, x * 7, 6)));
      x += w;
    }
    g.surf(K_PLAIN, 1);
    g.flat([[-L / 2 + 0.02, H - 0.02, -ht + 0.02], [L / 2 - 0.02, H - 0.02, -ht + 0.02], [L / 2 - 0.02, H - 0.02, ht - 0.02], [-L / 2 + 0.02, H - 0.02, ht - 0.02]], st.mortar);
  });
}
/** a headstone standing on the local origin and facing +Z; kind 0..4, under 0.6 tall */
function headstone(g, kind, col, seed) {
  const c = stoneTint(col, seed, 7), ext = (pts, d) => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: d, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 8 }).translate(0, 0, -d / 2);
  g.surf(K_STONE, 0.95);
  if (kind === 0 || kind === 4) {
    // round-topped slab (4: with shoulders)
    const w = 0.13 + 0.03 * hash1(seed, 1), h = 0.3 + 0.1 * hash1(seed, 2), pts = [[-w, -0.06], [w, -0.06], [w, h]];
    if (kind === 4) pts.push([w * 0.62, h], [w * 0.62, h + 0.04]);
    const rr = kind === 4 ? w * 0.62 : w, yb = kind === 4 ? h + 0.04 : h;
    for (let k = 1; k < 8; k++) { const a = (k / 8) * Math.PI; pts.push([Math.cos(a) * rr, yb + Math.sin(a) * rr]); }
    if (kind === 4) pts.push([-w * 0.62, h + 0.04], [-w * 0.62, h]);
    pts.push([-w, h]);
    g.add(ext(pts, 0.05), c);
    g.surf(K_PLAIN, 0.95);
    for (let i = 0; i < 3; i++) g.in(M(0, h * (0.78 - i * 0.2), 0.038), () => g.cbox(w * (1.3 - i * 0.2), 0.014, 0.004, 0.001, mul(col, 0.45)));
  } else if (kind === 1) {
    // a cross on a stepped base
    g.in(M(0, 0.02, 0), () => g.cbox(0.3, 0.1, 0.2, 0.015, c));
    g.in(M(0, 0.3, 0), () => g.cbox(0.08, 0.5, 0.07, 0.012, c));
    g.in(M(0, 0.4, 0), () => g.cbox(0.28, 0.08, 0.07, 0.012, c));
    g.in(M(0, 0.4, 0.036), () => g.add(new THREE.TorusGeometry(0.085, 0.016, 5, 18), c));
  } else if (kind === 2) {
    // pointed slab
    const w = 0.13, h = 0.34;
    g.add(ext([[-w, -0.06], [w, -0.06], [w, h], [w * 0.5, h + 0.1], [0, h + 0.16], [-w * 0.5, h + 0.1], [-w, h]], 0.055), c);
    g.surf(K_PLAIN, 0.95);
    g.in(M(0, h * 0.7, 0.04), () => { g.cbox(0.02, 0.12, 0.004, 0.001, mul(col, 0.45)); g.in(M(0, 0.02, 0), () => g.cbox(0.08, 0.02, 0.004, 0.001, mul(col, 0.45))); });
  } else {
    // a stubby obelisk on a plinth
    g.in(M(0, 0.04, 0), () => g.cbox(0.26, 0.14, 0.26, 0.015, c));
    g.in(M(0, 0.11, 0), () => g.lathe([[0.1, 0], [0.065, 0.36], [0, 0.44]], 4, c));
  }
}
function graveyard(g, hex) {
  const c = rgb(hex), rnd = rng(2000);
  const st = stoneStyle(hex, { seed: 2001, r: 0.022, b: 0.02, rough: 0.012, var: 0.2, nf: 7,
    pal: [c, mix(c, rgb(0x8f7a5c), 0.5), mix(c, rgb(0x5f6870), 0.5), mul(c, 0.78), mul(c, 1.12), mix(c, rgb(0x9a6f4a), 0.35), mix(c, rgb(0x6f7a5a), 0.3)],
    mortar: mul(mix(c, rgb(0x3a352c), 0.6), 0.35) });
  // worn turf with a beaten path between the gates
  g.surf(K_PLAIN, 1);
  g.sheet(20, 20, (u, v) => { const x = lerp(-2, 2, u), z = lerp(-2, 2, v); return [x, 0.012 + 0.014 * noise3(x * 2, 5, z * 2), z]; }, (x, y, z) => {
    const path = smooth(0.42, 0.2, Math.min(Math.abs(x), Math.abs(z)) + 0.12 * (noise3(x * 3, 9, z * 3) - 0.5));
    return mix(mul(mix(rgb(0x4f6a3a), rgb(0x6a7a48), noise3(x * 2.5, 1, z * 2.5)), 0.8 + 0.4 * noise3(x * 12, 2, z * 12)), mul(rgb(0x7a6a52), 0.8 + 0.3 * noise3(x * 15, 3, z * 15)), path * 0.85);
  });
  // the wall: two lengths a side with a gate gap between low piers
  const H = 0.25, hb = 0.16, ht = 0.12, gap = 0.5, cl = 2 - hb - 0.01;
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, cl)), () => {
    const end = s % 2 ? cl - hb : cl + hb;
    rubbleWall(g, -end, -gap - 0.1, H, hb, ht, st, 2010 + s * 20);
    rubbleWall(g, gap + 0.1, end, H, hb, ht, st, 2020 + s * 20);
    for (const e of [-1, 1]) g.in(M(e * gap, 0, 0), () => {
      g.surf(K_STONE, 0.95);
      const ps = stoneStyle(hex, { seed: 2030 + s + e, course: 0.16, len: [0.2, 0.3] });
      stoneBox(g, 0.13, 0.17, 0, 0.32, ps, 2030 + s * 3 + e);
      g.in(M(0, 0.32, 0), () => g.lathe([[0.2, 0], [0.2, 0.025], [0, 0.075]], 4, stoneTint(mul(c, 1.08), s + e, 6), Math.PI / 4, TAU + Math.PI / 4));
    });
  });
  // rows of stones, a mound before some of them
  const spots = [];
  for (const qx of [-1, 1]) for (const qz of [-1, 1]) for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) {
    const x = qx * (0.72 + i * 0.6), z = qz * (0.62 + j * 0.42);
    if (qx > 0 && qz < 0 && i === 1 && j > 0) continue;           // the tomb's corner
    if (qx < 0 && qz < 0 && i === 1 && j === 2) continue;         // the tree's corner
    spots.push([x + (rnd() - 0.5) * 0.12, z + (rnd() - 0.5) * 0.08]);
  }
  spots.forEach(([x, z], i) => {
    const kind = Math.floor(rnd() * 5), col = mul(mix(c, rgb(0x9a968c), 0.4 + 0.4 * rnd()), 0.85 + 0.3 * rnd());
    if (i % 3 !== 2) g.in(M(x + 0.0, 0.0, z + 0.0), () => g.in(M(0.3, 0, 0, 0, (rnd() - 0.5) * 10, 0), () => mound(g, 0.3, 0.14, 0.055 + rnd() * 0.03, rgb(0x5a4632), 2040 + i, 0.7)));
    g.in(M(x, 0, z, (rnd() - 0.5) * 14, 90 + (rnd() - 0.5) * 24, (rnd() - 0.5) * 12, 0.9), () => headstone(g, kind, col, 2050 + i));
    if (rnd() < 0.6) g.in(M(x - 0.06, 0, z + 0.12), () => tuft(g, 7, 0.14, i + 3, rgb(0x5a7a3a)));
  });
  // a chest tomb in one corner
  g.in(M(1.3, 0, -1.22, 0, 12, 0), () => {
    const ts = stoneStyle(0xa8a498, { seed: 2070, course: 0.17, len: [0.22, 0.36] });
    g.surf(K_STONE, 0.93);
    g.in(M(0, 0.025, 0), () => g.cbox(0.62, 0.09, 1.0, 0.016, stoneTint(mul(c, 1.1), 3, 5)));
    stoneBox(g, 0.25, 0.44, 0.07, 0.41, ts, 2071, { noFoot: true });
    g.in(M(0, 0.435, 0), () => g.cbox(0.6, 0.06, 0.98, 0.016, stoneTint(ts.pal[0], 4, 5)));
    const lc = stoneTint(mul(ts.pal[0], 0.96), 6, 5);
    for (const e of [-1, 1]) g.beamTo([e * 0.29, 0.465, 0], [0, 0.6, 0], 0.94, 0.035, 0.012, lc, 2, [0, 0, 1]);
    for (const e of [-1, 1]) g.flat([[-0.26, 0.465, e * 0.468], [0.26, 0.465, e * 0.468], [0, 0.59, e * 0.468]], ts.pal[0]);
    g.in(M(0, 0.25, 0.445), () => { g.cbox(0.045, 0.2, 0.014, 0.004, lc); g.in(M(0, 0.03, 0), () => g.cbox(0.14, 0.045, 0.014, 0.004, lc)); });
  });
  // a dead tree in another
  g.in(M(-1.36, 0, -1.3), () => {
    const P = [], bk = (p, k = 0.04) => p.color(0x4a4038).bump(0.012, 9, 'fur').tint(0.3, 14).blend(k);
    P.push(bk(S.capsule([0, -0.06, 0], [0.05, 0.5, 0.02], 0.13, 0.095)), bk(S.capsule([0.05, 0.5, 0.02], [0.0, 1.05, -0.03], 0.095, 0.07)));
    for (let i = 0; i < 5; i++) { const a = i * 1.257 + 0.4, l = 0.2 + rnd() * 0.08; P.push(bk(S.capsule([Math.cos(a) * 0.06, 0.15, Math.sin(a) * 0.06], [Math.cos(a) * l, -0.07, Math.sin(a) * l], 0.055, 0.03), 0.07)); }
    const limb = (pts, radii) => P.push(...S.limb(pts, radii).map((p) => bk(p, 0.04)));
    limb([[0, 1.05, -0.03], [0.18, 1.42, 0.08], [0.36, 1.66, 0.2], [0.42, 1.98, 0.22]], [0.065, 0.045, 0.03, 0.014]);
    limb([[0, 1.05, -0.03], [-0.2, 1.5, -0.12], [-0.22, 1.95, -0.3], [-0.42, 2.25, -0.34]], [0.07, 0.05, 0.03, 0.012]);
    limb([[0.18, 1.42, 0.08], [0.24, 1.75, -0.12], [0.18, 2.05, -0.22]], [0.035, 0.025, 0.01]);
    limb([[-0.2, 1.5, -0.12], [-0.5, 1.62, 0.1], [-0.72, 1.86, 0.16]], [0.04, 0.028, 0.011]);
    limb([[0.02, 0.78, 0], [-0.24, 0.98, -0.2], [-0.36, 1.26, -0.3]], [0.045, 0.028, 0.01]);
    limb([[0.36, 1.66, 0.2], [0.56, 1.74, 0.16], [0.64, 1.9, 0.1]], [0.022, 0.016, 0.008]);
    P.push(S.sphere(0.035).at(0.1, 0.62, 0.08).cut(0.01).color(0x1a1612));
    g.surf(K_WOOD, 0.95);
    g.sculpt({ prims: P }, 30, 0.6);
  });
  for (let i = 0; i < 22; i++) { const s = Math.floor(rnd() * 4), t = (rnd() * 2 - 1) * 1.6, d = 1.62 - rnd() * 0.1, x = s % 2 ? (s === 1 ? d : -d) : t, z = s % 2 ? t : s === 0 ? d : -d; if (Math.abs(t) > 0.65) g.in(M(x, 0.01, z), () => tuft(g, 8, 0.17, 100 + i, rgb(0x5a7a3a))); }
}

// =====================================================================================================
// Market hall, bank, inn, dock house
// =====================================================================================================
/** the triangle of a timber-framed gable on the local XY plane: base from -W to W at y0, apex at `peak` */
function framedGable(g, W, y0, peak, plaster, oak, seed, win = null) {
  const sl = (peak - y0) / W, under = (x) => peak - Math.abs(x) * sl;
  g.surf(K_PLASTER, 0.97);
  g.sheet(12, 5, (u, v) => { const x = lerp(-W, W, u), y = lerp(y0, under(x), v); return [x, y, 0.008 * (noise3(x * 6 + seed, y * 6, 5) - 0.5)]; }, (x, y, z) => mul(plaster, 0.9 + 0.2 * fbm3(x * 5 + seed, y * 5, z * 5, 2)));
  g.surf(K_WOOD, 0.88);
  const tb = (s) => woodTint(mul(oak, 0.85 + 0.35 * hash1(seed + s, 3)), seed + s);
  const T = (a, b, w, s, t = 0.075) => g.beamTo([a[0], a[1], 0.02], [b[0], b[1], 0.02], t, w, 0.01, tb(s), 2, [0, 0, 1]);
  T([-W, y0 + 0.02], [0, peak - 0.02], 0.1, 1, 0.085); T([W, y0 + 0.02], [0, peak - 0.02], 0.1, 2, 0.085);
  T([-W, y0 + 0.04], [W, y0 + 0.04], 0.1, 9, 0.085);
  const cy = y0 + (peak - y0) * 0.5, cw = (peak - cy) / sl - 0.04;
  T([-cw, cy], [cw, cy], 0.08, 4);
  if (win) { for (const e of [-1, 1]) T([e * (win.w / 2 + 0.05), y0 + 0.08], [e * (win.w / 2 + 0.05), cy - 0.04], 0.07, 5 + e); }
  else T([0, y0 + 0.08], [0, cy - 0.04], 0.09, 3);
  T([0, cy + 0.04], [0, peak - 0.1], 0.08, 12);
  for (const e of [-1, 1]) { const x = e * W * 0.56; T([x, y0 + 0.08], [x, under(x) - 0.08], 0.07, 6 + e); T([e * (win ? win.w / 2 + 0.1 : 0.06), cy - 0.05], [e * W * 0.5, y0 + 0.1], 0.06, 8 + e, 0.06); }
  if (win) g.in(M(0, (y0 + 0.08 + cy - 0.04) / 2, 0), () => casement(g, win.w, Math.min(win.h, cy - y0 - 0.25), oak, seed + 3, false, false, !!win.lit));
}
/** a clock face on the local XY plane, radius R, facing +Z; the hands stand at ten past ten */
function clockFace(g, R) {
  g.surf(K_PLAIN, 0.6);
  g.in(M(0, 0, 0, 90, 0, 0), () => g.lathe([[0, 0.012], [R * 0.9, 0.012], [R * 0.9, 0]].reverse(), 24, rgb(0xeee6d0)));
  g.surf(K_PLAIN, 0.35, 0.9);
  g.add(new THREE.TorusGeometry(R * 0.95, R * 0.09, 6, 28), GILT);
  g.surf(K_PLAIN, 0.5, 0.6);
  const dk = [0.06, 0.05, 0.05];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.in(M(Math.sin(a) * R * 0.74, Math.cos(a) * R * 0.74, 0.014, 0, 0, -a / DEG), () => g.cbox(R * 0.05, R * (i % 3 ? 0.11 : 0.2), 0.006, 0.002, dk)); }
  g.in(M(0, 0, 0.02, 0, 0, 55), () => g.in(M(0, R * 0.22, 0), () => g.cbox(R * 0.08, R * 0.5, 0.008, 0.003, dk)));
  g.in(M(0, 0, 0.026, 0, 0, -62), () => g.in(M(0, R * 0.32, 0), () => g.cbox(R * 0.06, R * 0.7, 0.008, 0.003, dk)));
  g.in(M(0, 0, 0.03), () => g.stud(R * 0.09, GILT, 8));
}
function marketHall(g, hex) {
  const wood = mul(rgb(hex), 0.78), tb = tbOf(wood), fs = stoneStyle(0x9a958b, { seed: 2100, course: 0.1, len: [0.3, 0.5] });
  const xs = [-1.7, -0.57, 0.57, 1.7], pz = 1.2, f0 = 0.1, pt = 1.44;
  // a flagged floor one step up
  stoneBox(g, 1.92, 1.42, 0, f0, fs, 2101);
  const pv = pave(0x9a958b, 2105, { course: 0.355, len: [0.3, 0.55] });
  g.in(M(-1.92, f0 - pv.r, 1.42, -90, 0, 0), () => g.ashlar(3.84, 2.84, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
  // stout posts on pad stones, plates, tie beams and braces
  const posts = [];
  for (const x of xs) for (const z of [-pz, pz]) posts.push([x, z]);
  posts.push([-1.7, 0], [1.7, 0]);
  posts.forEach(([x, z], i) => {
    g.surf(K_STONE, 0.93);
    g.in(M(x, f0 + 0.07, z), () => g.cbox(0.32, 0.14, 0.32, 0.03, stoneTint(mul(fs.pal[0], 1.05), i, 5)));
    g.surf(K_WOOD, 0.88);
    g.in(M(x, (f0 + 0.14 + pt) / 2, z, 0, 0, 90), () => g.beam(pt - f0 - 0.14, 0.17, 0.17, 0.028, tb(i, 0.9), 4));
    g.in(M(x, pt - 0.05, z), () => g.cbox(0.24, 0.07, 0.24, 0.015, tb(i + 20, 0.8)));
  });
  for (const z of [-pz, pz]) {
    g.in(M(0, pt + 0.06, z), () => g.beam(3.7, 0.13, 0.15, 0.018, tb(30 + z, 0.82), 8));
    xs.forEach((x, i) => { for (const e of [-1, 1]) if (xs[i + e] !== undefined) { const pts = []; for (let k = 0; k <= 5; k++) { const t = k / 5; pts.push([x + e * (0.09 + 0.36 * t), 0.98 + 0.42 * Math.pow(t, 0.55), z]); } for (let k = 0; k < 5; k++) g.beamTo(pts[k], pts[k + 1], 0.09, 0.07, 0.012, tb(40 + i * 4 + e + k, 0.76), 1, [0, 0, 1]); } });
  }
  xs.forEach((x, i) => {
    g.in(M(x, pt + 0.06, 0, 0, 90, 0), () => g.beam(2 * pz + 0.2, 0.13, 0.13, 0.018, tb(50 + i, 0.8), 5));
    for (const e of [-1, 1]) g.beamTo([x, 1.02, e * (pz - 0.09)], [x, pt, e * (pz - 0.5)], 0.08, 0.07, 0.012, tb(55 + i + e, 0.76), 2, [1, 0, 0]);
    if (i === 1 || i === 2) { g.in(M(x, pt + 0.48, 0, 0, 0, 90), () => g.beam(0.72, 0.11, 0.11, 0.014, tb(60 + i, 0.8), 2)); for (const e of [-1, 1]) g.beamTo([x, pt + 0.14, e * 0.62], [x, pt + 0.74, e * 0.04], 0.07, 0.06, 0.01, tb(64 + i + e, 0.76), 2, [1, 0, 0]); }
  });
  // the great roof
  const eY = 1.5, rY = 2.82, rl = 0.78;
  hipRoof(g, 2.0, 1.5, eY, rY, rl, TERRACOTTA, 2110, { round: true, tw: 0.17, th: 0.155, lift: 0.024, ridgeCol: rgb(0xa8482c), ridgeMetal: 0 });
  // clock turret astride the ridge: boarded, a face each way, a bell under a leaded cap
  const ty = rY - 0.22, th = 0.86, hw = 0.3;
  g.in(M(0, 0, 0), () => {
    for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, hw)), () => {
      boarded(g, hw, ty, ty + th * 0.62, mul(wood, 1.15), 2120 + s, 0.12);
      g.surf(K_WOOD, 0.88);
      for (const e of [-1, 1]) g.in(M(e * hw, ty + th / 2, 0, 0, 0, 90), () => g.beam(th, 0.075, 0.075, 0.012, tb(80 + s + e, 0.74), 2));
      g.in(M(0, ty + th * 0.62, 0.012), () => g.beam(2 * hw + 0.08, 0.06, 0.07, 0.01, tb(84 + s, 0.74), 2));
      g.in(M(0, ty + th - 0.03, 0.012), () => g.beam(2 * hw + 0.1, 0.07, 0.08, 0.01, tb(88 + s, 0.74), 2));
      if (s % 2 === 0) g.in(M(0, ty + th * 0.36, 0.035), () => clockFace(g, 0.2));
    });
    g.surf(K_PLAIN, 0.4, 0.85);
    g.in(M(0, ty + th * 0.64, 0), () => g.lathe([[0.15, 0], [0.155, 0.02], [0.12, 0.06], [0.09, 0.14], [0.06, 0.19], [0.02, 0.21], [0, 0.21]], 14, rgb(0xb08a3a)));
    g.in(M(0, ty + th, 0), () => { pyramidRoof(g, hw + 0.14, 0.52, SLATE, 2130, { tw: 0.11, th: 0.11 }); g.in(M(0, 0.48, 0), () => finial(g, 0.3)); });
    // weathervane
    g.surf(K_PLAIN, 0.4, 0.9);
    g.in(M(0, ty + th + 0.86, 0), () => { g.in(M(0, 0, 0), () => g.cbox(0.34, 0.012, 0.012, 0.004, GILT)); g.flat([[0.17, 0.04, 0], [0.26, 0, 0], [0.17, -0.04, 0]], GILT); g.flat([[-0.17, 0.05, 0], [-0.08, 0, 0], [-0.17, -0.05, 0], [-0.21, 0, 0]], GILT); });
  });
  // beneath: trestles heaped with goods, crates, casks and sacks
  g.in(M(-0.95, f0, 0.35), () => { trestleTable(g, 1.3, 0.55, 0.54, rgb(0x9a7648), 60); g.in(M(-0.4, 0.54, 0), () => basket(g, 0.15, 0.12, PRODUCE.apple, 21, 11, 0.27)); g.in(M(0, 0.54, 0.06), () => basket(g, 0.15, 0.12, PRODUCE.orange, 22, 10, 0.28)); g.in(M(0.4, 0.54, -0.02), () => basket(g, 0.15, 0.12, PRODUCE.plum, 23, 9, 0.27)); });
  g.in(M(0.85, f0, -0.45, 0, 90, 0), () => { trestleTable(g, 1.2, 0.55, 0.54, rgb(0x9a7648), 70); g.in(M(-0.35, 0.54, 0), () => basket(g, 0.16, 0.12, PRODUCE.cabbage, 24, 6, 0.42)); g.in(M(0.1, 0.54, 0.05), () => basket(g, 0.15, 0.12, PRODUCE.pear, 25, 11, 0.27)); g.surf(K_PLAIN, 0.7); g.in(M(0.44, 0.54, 0), () => g.cyl(0.11, 0.11, 0.07, 14, rgb(0xd8b04a), false, true)); });
  g.in(M(1.25, f0, 0.75, 0, 12, 0), () => crate(g, 0.46, 0.36, 0.42, rgb(0xa07a48), 31));
  g.in(M(1.28, f0 + 0.36, 0.74, 0, -20, 0), () => crate(g, 0.3, 0.24, 0.3, rgb(0xb08a54), 32));
  g.in(M(0.75, f0, 0.82), () => basket(g, 0.2, 0.2, PRODUCE.turnip, 26, 7, 0.3));
  g.in(M(-1.3, f0, -0.7), () => barrel(g, 0.17, 0.44, rgb(0x7a5a38), 7));
  g.in(M(-0.92, f0, -0.78), () => barrel(g, 0.15, 0.4, rgb(0x86643c), 8));
  g.in(M(-0.25, f0, -0.72, 0, 20, 0), () => sacks(g, 3, 51));
  g.shade(-1.9, f0, -1.4, 1.9, eY, 1.4, 0.3, 0.3, [1, 1]);
}

function bank(g, hex) {
  const st = stoneStyle(hex, { seed: 2200, r: 0.03, b: 0.026, rough: 0.014, bump: 1.1, len: [0.42, 0.74], chip: 0.2 });
  const col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 5), r = st.r, hx = 1.3, hz = 1.0, cz = -0.26, top = 1.8;
  const win = (W, xs) => xs.map((x) => [W - r + x - 0.13, 0.8, W - r + x + 0.13, 1.2]);
  g.in(M(0, 0, cz), () => {
    stoneBox(g, hx, hz, 0, top, st, 2210, { quoin: [0.7, 0.4], holes: [[...win(hx, [-0.86, 0.86]), [hx - r - 0.34, 0, hx - r + 0.34, 1.2]], win(hz, [-0.45, 0.45]), win(hx, [-0.7, 0.7]), win(hz, [-0.45, 0.45])], each: (s, W) => {
      const xs = s === 0 ? [-0.86, 0.86] : s === 2 ? [-0.7, 0.7] : [-0.45, 0.45];
      for (const x of xs) g.in(M(W - r + x - 0.13, 0.8, 0), () => { arrowLoop(g, 0.26, 0.4, st, 0.16, true); g.surf(K_PLAIN, 0.5, 0.85); for (const bx of [0.07, 0.19]) g.in(M(bx, 0.2, 0.0), () => g.cbox(0.018, 0.4, 0.018, 0.004, IRON)); for (const by of [0.1, 0.3]) g.in(M(0.13, by, 0.004), () => g.cbox(0.26, 0.016, 0.016, 0.004, IRON)); });
      if (s === 0) g.in(M(W - r, 0, 0), () => {
        // the door: deep in its opening, bound and studded with iron
        g.surf(K_PLAIN, 1);
        for (const e of [-1, 1]) g.flat([[e * 0.34, 0, r], [e * 0.34, 1.2, r], [e * 0.31, 1.2, -0.13], [e * 0.31, 0, -0.13]], [mul(col, 0.6), mul(col, 0.6), mul(col, 0.25), mul(col, 0.25)]);
        g.flat([[-0.34, 1.2, r], [0.34, 1.2, r], [0.31, 1.2, -0.13], [-0.31, 1.2, -0.13]], mul(col, 0.3));
        g.in(M(0, 0, -0.13), () => { plankDoor(g, 0.62, 1.2, rgb(0x4a3524), 9, 5); for (const y of [0.42, 0.62, 0.98]) g.in(M(0, y, 0.046), () => strap(g, 0.6, 0.05, 6)); g.surf(K_PLAIN, 0.4, 0.9); g.in(M(-0.16, 0.62, 0.056), () => { g.cbox(0.11, 0.15, 0.016, 0.005, IRON); g.in(M(0, -0.01, 0.01), () => g.stud(0.02, GILT, 8)); }); });
        g.surf(K_STONE, 0.93);
        g.in(M(0, 1.27, 0.02), () => g.cbox(0.94, 0.14, 0.1, 0.02, cc));
        g.in(M(0, 1.3, 0.075, 0, 0, 0), () => g.cbox(0.2, 0.2, 0.05, 0.02, cc));
      });
    } });
    for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, s % 2 ? hx : hz)), () => {
      const W = s % 2 ? hz : hx;
      g.surf(K_STONE, 0.93);
      band(g, [[0.03, 0.2], [0.07, 0.2], [0.07, 0.25], [0.03, 0.29]], 2 * W, mul(col, 1.03), 2220 + s, 1, 1);
      band(g, [[0, top - 0.12], [0.045, top - 0.08], [0.05, top - 0.03], [0.11, top + 0.01], [0.12, top + 0.07], [0.1, top + 0.09]], 2 * W, mul(col, 1.06), 2230 + s, 1, 1);
      for (let i = 0, n = Math.round(W * 2 / 0.2); i < n; i++) g.in(M(-W + 0.1 + i * ((2 * W - 0.2) / (n - 1)), top - 0.16, 0.03), () => g.cbox(0.085, 0.07, 0.06, 0.012, cc));
    });
    hipRoof(g, hx + 0.13, hz + 0.13, top + 0.09, top + 0.68, 0.36, SLATE, 2240, { tw: 0.16, th: 0.14 });
    // the strongroom flue: a square stack with an iron cowl
    g.in(M(-0.78, 0, -0.52), () => { chimney(g, 0.19, 0.19, top + 0.2, top + 1.12, hex, 2250, 0); g.surf(K_PLAIN, 0.5, 0.85); g.in(M(0, top + 1.18, 0), () => { for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(dx * 0.12, 0, dz * 0.12), () => g.cyl(0.014, 0.014, 0.12, 5, IRON)); g.in(M(0, 0.12, 0), () => g.lathe([[0.24, 0], [0.22, 0.03], [0.06, 0.11], [0, 0.12]], 4, IRON, Math.PI / 4, TAU + Math.PI / 4)); }); });
  });
  // portico: steps, four columns, an entablature and a pediment with a gilded coin
  const fz = cz + hz, pzc = fz + 0.3;
  g.surf(K_STONE, 0.93);
  g.in(M(0, 0.0, fz + 0.36), () => g.cbox(2.72, 0.14, 0.76, 0.02, cc));
  g.in(M(0, 0.1, fz + 0.28), () => g.cbox(2.5, 0.12, 0.58, 0.02, stoneTint(mul(col, 1.0), 7, 5)));
  for (const x of [-1.05, -0.5, 0.5, 1.05]) g.in(M(x, 0.16, pzc + 0.12), () => column(g, 0.09, 1.3, mul(col, 1.06), x * 3, 16));
  const ey = 1.46, eh = 0.22, pw = 1.3;
  g.in(M(0, ey + eh / 2, fz + 0.27), () => g.cbox(2 * pw, eh, 0.5, 0.02, cc));
  g.in(M(0, ey + 0.07, fz + 0.535), () => g.cbox(2 * pw - 0.1, 0.03, 0.02, 0.008, mul(col, 0.8)));
  band(g, [[0, 0], [0.04, 0.02], [0.05, 0.06]].map(([o, y]) => [o, y + ey + eh]), 2 * pw, mul(col, 1.06), 2260, 1, 1);
  const py0 = ey + eh + 0.05, apex = py0 + 0.52, zf = fz + 0.5;
  g.surf(K_STONE, 0.93);
  g.flat([[-pw, py0, zf], [pw, py0, zf], [0, apex, zf]], [mul(col, 0.92), mul(col, 0.92), mul(col, 1.02)]);
  for (const e of [-1, 1]) {
    g.beamTo([e * (pw + 0.06), py0 - 0.02, zf - 0.05], [0, apex + 0.03, zf - 0.05], 0.09, 0.16, 0.016, cc, 3);
    g.surf(K_ROOF, 0.8);
    tiles(g, 5, () => 8, (u, v) => [e * lerp(pw + 0.04, 0, v), lerp(py0 + 0.0, apex + 0.04, v), e > 0 ? lerp(zf - 0.1, fz - 0.9, u) : lerp(fz - 0.9, zf - 0.1, u)], { pal: SLATE, lift: 0.018, seed: 2265 + e });
    g.surf(K_STONE, 0.93);
  }
  for (let i = 0; i < 15; i++) g.in(M(-pw + 0.12 + i * ((2 * pw - 0.24) / 14), ey + eh - 0.035, fz + 0.535), () => g.cbox(0.07, 0.06, 0.05, 0.01, cc));
  g.surf(K_PLAIN, 0.3, 0.92);
  for (const [x, y] of [[-pw - 0.02, py0 + 0.05], [pw + 0.02, py0 + 0.05], [0, apex + 0.1]]) g.in(M(x, y, zf - 0.05), () => { g.surf(K_STONE, 0.93); g.in(M(0, 0.03, 0), () => g.cbox(0.12, 0.06, 0.12, 0.012, cc)); g.in(M(0, 0.06, 0), () => finial(g, 0.2)); });
  g.in(M(0, py0 + 0.2, zf + 0.004, 90, 0, 0), () => {
    g.surf(K_PLAIN, 0.3, 0.92);
    g.lathe([[0, 0.03], [0.1, 0.03], [0.12, 0.045], [0.15, 0.045], [0.165, 0.03], [0.165, 0]].reverse(), 24, GILT);
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.in(M(Math.cos(a) * 0.135, 0.045, Math.sin(a) * 0.135, -90, 0, 0), () => g.stud(0.012, GILT, 5)); }
    // a crown struck on the coin
    g.in(M(0, 0.03, 0.02), () => g.cbox(0.11, 0.012, 0.03, 0.004, GILT));
    for (const x of [-0.045, 0, 0.045]) g.flat([[x - 0.02, 0.036, 0.008], [x + 0.02, 0.036, 0.008], [x, 0.036, -0.06]], GILT);
  });
  for (const e of [-1, 1]) g.in(M(e * 0.56, 1.12, fz), () => lantern(g));
  // strongboxes waiting to be carried in, a sack of coin spilling beside one
  for (const [x, ry, sd] of [[-0.86, 8, 1], [0.82, -12, 2]]) g.in(M(x, 0.16, fz + 0.2, 0, ry, 0), () => {
    g.surf(K_WOOD, 0.85);
    g.in(M(0, 0.11, 0), () => g.cbox(0.4, 0.22, 0.26, 0.012, woodTint(rgb(0x4a3524), sd)));
    g.in(M(0, 0.235, 0, 0, 0, 0), () => g.in(M(-0.2, 0, 0, 0, 0, -90), () => g.lathe([[0.13, 0], [0.13, 0.4]], 10, woodTint(rgb(0x54402c), sd + 3), 0, Math.PI)));
    g.surf(K_PLAIN, 0.5, 0.85);
    for (const bx of [-0.15, 0, 0.15]) { g.in(M(bx, 0.11, 0.132), () => g.cbox(0.04, 0.22, 0.01, 0.003, IRON)); g.in(M(bx, 0.235, 0, 0, 0, 0), () => g.in(M(-0.02, 0, 0, 0, 0, -90), () => g.lathe([[0.136, 0], [0.136, 0.04]], 10, IRON, 0, Math.PI))); for (const y of [0.04, 0.18]) g.in(M(bx, y, 0.137), () => g.stud(0.012, IRON, 5)); }
    g.surf(K_PLAIN, 0.35, 0.9);
    g.in(M(0.075, 0.2, 0.138), () => { g.cbox(0.06, 0.07, 0.012, 0.004, GILT); });
  });
  g.in(M(0.5, 0.16, fz + 0.36, 0, 40, 0), () => g.in(M(0, 0, 0, 0, 0, 0, 0.8), () => sacks(g, 1, 61, rgb(0xa89068))));
  g.surf(K_PLAIN, 0.3, 0.92);
  for (let i = 0; i < 9; i++) g.in(M(0.36 + hash1(i, 61) * 0.2, 0.162 + (i % 3) * 0.004, fz + 0.46 + hash1(i, 67) * 0.12, -90, 0, 0), () => g.stud(0.017, GILT, 7, 0.22));
  g.shade(-pw, 0.2, fz, pw, ey, fz + 0.5, 0.3, 0.1, [1, 1]);
}

function inn(g, hex) {
  const plaster = rgb(hex), oak = rgb(OAK), tb = (seed, k = 1) => woodTint(mul(oak, k * (0.85 + 0.35 * hash1(seed, 3))), seed);
  const cx = -0.56, cz = -0.18, hx = 1.28, hz = 1.0, y0 = 0.2, y1 = 1.28, jt = 0.13, u0 = y1 + 0.1, u1 = 2.2, ux = hx + jt, uz = hz + jt;
  const c = rgb(0x8a8378), foot = stoneStyle(0x8a8378, { seed: 2300, r: 0.022, b: 0.02, rough: 0.01, var: 0.18, nf: 7, pal: [c, mix(c, rgb(0x8f7a5c), 0.5), mix(c, rgb(0x5f6870), 0.4), mul(c, 0.8), mul(c, 1.1)], mortar: mul(c, 0.25) });
  g.in(M(cx, 0, cz), () => {
    for (let s = 0; s < 4; s++) {
      const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz, UW = s % 2 ? uz : ux, UD = s % 2 ? ux : uz;
      g.in(M(0, 0, 0, 0, s * 90, 0), () => {
        g.in(M(0, 0, D), () => {
          g.surf(K_STONE, 0.95);
          g.in(M(-W - 0.05, 0, 0.05), () => { rubbleFace(g, 2 * W + 0.1, y0 + 0.02, foot, 2310 + s); footing(g, 0, 2 * W + 0.1, c); });
          const items = s === 0 ? [{ kind: 'door', x: 0.38, w: 0.56, h: 0.98 }, { kind: 'win', x: -0.6, y: 0.82, w: 0.56, h: 0.46, lit: true, box: true }] : s === 2 ? [{ kind: 'win', x: -0.55, y: 0.84, w: 0.46, h: 0.42 }, { kind: 'win', x: 0.6, y: 0.84, w: 0.46, h: 0.42, lit: true }] : s === 3 ? [{ kind: 'win', x: -0.5, y: 0.84, w: 0.4, h: 0.4, lit: true }] : [];
          framed(g, W, y0, y1, plaster, oak, 2320 + s * 30, items);
          if (s === 0) { g.surf(K_STONE, 0.95); g.in(M(0.38, 0.03, 0.14), () => g.cbox(0.84, 0.32, 0.26, 0.02, stoneTint(mul(c, 1.05), 3))); g.in(M(0.82, 1.1, 0.06), () => lantern(g)); }
        });
        // the jetty: joist ends under a bressummer, then the upper storey
        g.surf(K_WOOD, 0.88);
        for (let i = 0, n = Math.round(UW * 2 / 0.26); i <= n; i++) g.in(M(-UW + 0.04 + (i * (2 * UW - 0.08)) / n, y1 + 0.02, UD - 0.11), () => g.cbox(0.075, 0.09, 0.26, 0.012, tb(s * 20 + i, 0.8)));
        g.in(M(0, 0, UD), () => {
          g.in(M(0, y1 + 0.085, -0.01), () => g.beam(2 * UW + 0.04, 0.1, 0.11, 0.014, tb(90 + s, 0.85), 5));
          const ups = s === 0 ? [{ kind: 'win', x: -0.75, y: 1.8, w: 0.5, h: 0.44, lit: true }, { kind: 'win', x: 0.72, y: 1.8, w: 0.5, h: 0.44, lit: true }] : s === 2 ? [{ kind: 'win', x: 0, y: 1.8, w: 0.5, h: 0.44 }] : s === 1 ? [{ kind: 'win', x: 0.3, y: 1.8, w: 0.44, h: 0.42, lit: true }] : [];
          framed(g, UW, u0 + 0.04, u1, plaster, oak, 2340 + s * 30, ups);
        });
      });
    }
    g.surf(K_WOOD, 0.88);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      g.in(M(sx * hx, (y0 + y1) / 2, sz * hz, 0, 0, 90), () => g.beam(y1 - y0 + 0.04, 0.14, 0.14, 0.012, tb(70 + sx + sz * 2), 3));
      g.in(M(sx * ux, (u0 + u1) / 2 + 0.02, sz * uz, 0, 0, 90), () => g.beam(u1 - u0, 0.13, 0.13, 0.012, tb(75 + sx + sz * 2), 3));
      g.beamTo([sx * hx, y1 - 0.34, sz * hz], [sx * (ux + 0.01), y1 + 0.03, sz * (uz + 0.01)], 0.07, 0.07, 0.01, tb(78 + sx + sz * 2, 0.8), 2);
    }
    g.shade(-ux - 0.1, y1 - 0.3, -uz - 0.1, ux + 0.1, y1 + 0.06, uz + 0.1, 0.35, 0.03, [1, 1]);
    g.shade(-ux - 0.2, u1 - 0.35, -uz - 0.2, ux + 0.2, u1 + 0.1, uz + 0.2, 0.35, 0.03, [1, 1]);
    // roof and gables
    const eZ = uz + 0.2, eY = u1 - 0.1, rY = 3.3, vx = ux + 0.12, sl = (rY - eY) / eZ;
    gableRoof(g, { x0: -vx, x1: vx, eZ, eY, rY, pal: TERRACOTTA, round: true, seed: 2360, lift: 0.024, barge: mul(oak, 0.9), ridgeCol: rgb(0xa8482c), ridgeR: 0.065 });
    for (const e of [1, -1]) g.in(M(e * ux, 0, 0, 0, e * 90, 0), () => framedGable(g, uz, u1 - 0.02, rY - 0.07 - 0.0, plaster, oak, 2370 + e, e > 0 ? { w: 0.3, h: 0.3, lit: true } : null));
    // a gabled dormer breaking the front eaves
    const dx = -0.72, dw = 0.44, dy0 = u1 - 0.02, dpk = dy0 + 0.72;
    g.in(M(dx, 0, uz + 0.012), () => {
      framed(g, dw, u1 - 0.04, dy0 + 0.02, plaster, oak, 2380, []);
      framedGable(g, dw, dy0, dpk, plaster, oak, 2381, { w: 0.3, h: 0.34, lit: true });
    });
    const dzb = eZ - (dpk + 0.05 - eY) / sl;
    g.in(M(dx, 0, 0, 0, -90, 0), () => gableRoof(g, { x0: dzb - 0.05, x1: uz + 0.14, eZ: dw + 0.13, eY: dy0 - 0.04, rY: dpk + 0.06, pal: TERRACOTTA, round: true, seed: 2385, lift: 0.022, tw: 0.15, th: 0.14, barge: mul(oak, 0.9), ridgeCol: rgb(0xa8482c) }));
    // chimney on the far gable, smoking
    g.in(M(-ux - 0.1, 0, 0.3, 0, 90, 0), () => { chimney(g, 0.27, 0.15, -0.13, 3.72, 0x8f8778, 2390, 2); g.in(M(0, 3.9, 0, 0, -90, 0), () => smoke(g, 1.15, 3)); });
    // the sign: a bracket from the jetty, a painted board on two chains
    g.in(M(0.98, 0, uz), () => {
      g.surf(K_WOOD, 0.88);
      g.in(M(0, 2.02, 0.33, 0, 90, 0), () => g.beam(0.66, 0.07, 0.07, 0.012, tb(140, 0.75), 2));
      g.surf(K_PLAIN, 0.5, 0.85);
      g.tube([[0, 1.66, 0.02], [0, 1.72, 0.2], [0, 1.86, 0.34], [0, 1.985, 0.4]], 0.012, 5, IRON);
      for (const z of [0.2, 0.52]) g.tube([[0, 1.985, z], [0, 1.86, z]], 0.008, 4, IRON, false);
      g.in(M(0, 1.63, 0.36, 0, 90, 0), () => {
        g.surf(K_WOOD, 0.8);
        g.cbox(0.46, 0.46, 0.04, 0.012, tb(141, 0.7));
        for (const f of [-1, 1]) g.in(M(0, 0, f * 0.021, 0, f > 0 ? 0 : 180, 0), () => {
          g.surf(K_PLAIN, 0.7);
          g.flat([[-0.19, -0.19, 0.001], [0.19, -0.19, 0.001], [0.19, 0.19, 0.001], [-0.19, 0.19, 0.001]], rgb(0x2f6a4a));
          g.surf(K_PLAIN, 0.35, 0.9);
          // a brimming tankard in gold
          g.in(M(-0.02, -0.11, 0.002, 0, 0, 0), () => { g.lathe([[0.075, 0], [0.07, 0.17], [0.078, 0.2]], 10, GILT, 0, Math.PI); g.in(M(0, 0.2, 0), () => g.add(new THREE.SphereGeometry(0.075, 10, 5, 0, Math.PI, 0, Math.PI / 2).scale(1, 0.55, 0.5), rgb(0xf4ecd8))); });
          g.in(M(0.08, -0.02, 0.006), () => g.add(new THREE.TorusGeometry(0.045, 0.012, 5, 12, Math.PI).rotateZ(-Math.PI / 2), GILT));
        });
      });
    });
  });
  // the stable: a lean-to against the end wall, open to the yard
  const sx0 = cx + hx, sx1 = 1.95, szb = -1.08, szf = 0.76;
  g.surf(K_WOOD, 0.9);
  for (const z of [szb + 0.05, (szb + szf) / 2, szf - 0.05]) {
    g.in(M(sx1 - 0.12, 0.6, z, 0, 0, 90), () => g.beam(1.2, 0.12, 0.12, 0.014, tb(150 + z * 3, 0.8), 3));
    g.in(M(sx1 - 0.12, -0.02, z), () => { g.surf(K_STONE, 0.95); g.cbox(0.24, 0.14, 0.24, 0.025, stoneTint(c, z * 5)); g.surf(K_WOOD, 0.9); });
    g.beamTo([sx0 + 0.04, 1.62, z], [sx1 - 0.02, 1.2, z], 0.08, 0.07, 0.01, tb(154 + z * 3, 0.75), 3);
    if (z < szf - 0.2) g.beamTo([sx1 - 0.12, 0.85, z + 0.07], [sx1 - 0.12, 1.16, z + 0.4], 0.06, 0.05, 0.008, tb(158 + z * 3, 0.75), 1, [1, 0, 0]);
  }
  g.in(M(sx1 - 0.12, 1.2, (szb + szf) / 2, 0, 90, 0), () => g.beam(szf - szb + 0.1, 0.1, 0.1, 0.012, tb(160, 0.8), 4));
  g.in(M((sx0 + sx1) / 2, 0, szb, 0, 180, 0), () => boarded(g, (sx1 - sx0) / 2 - 0.06, 0.04, (x) => 1.38 + x * 0.36, mul(oak, 1.25), 2395, 0.14));
  g.in(M(sx0, 0, (szb + szf) / 2, 0, -90, 0), () => gableRoof(g, { x0: szb - 0.1, x1: szf + 0.1, eZ: sx1 - sx0 + 0.05, eY: 1.22, rY: 1.75, only: -1, ridge: false, pal: SHINGLE, seed: 2396, tw: 0.16, th: 0.15 }));
  // hay, a trough, a hitching rail, casks by the door
  g.in(M(1.36, 0, -0.62), () => { g.surf(K_ROOF, 0.98); g.sheet(18, 6, (u, v) => { const a = u * TAU, d = 1 - v, k = 1 + 0.2 * (noise3(Math.cos(a) * 3, 2, Math.sin(a) * 3) - 0.5); return [Math.cos(a) * 0.42 * d * k, 0.42 * (1 - d * d) * (0.8 + 0.4 * noise3(Math.cos(a) * d * 4, 7, Math.sin(a) * d * 4)) - (v ? 0 : 0.02), Math.sin(a) * 0.36 * d * k]; }, (x, y, z) => mul(rgb(0xd0aa54), (0.6 + 0.9 * y) * (0.75 + 0.5 * noise3(x * 40, y * 12, z * 40))), true); });
  g.in(M(1.36, 0, 0.18), () => {
    g.surf(K_WOOD, 0.9);
    for (const e of [-1, 1]) { g.in(M(0, 0.16, e * 0.13), () => g.beam(0.62, 0.2, 0.03, 0.008, tb(170 + e, 1.2), 2)); g.in(M(e * 0.3, 0.14, 0, 0, 90, 0), () => g.beam(0.28, 0.26, 0.035, 0.008, tb(173 + e, 1.1), 1)); }
    g.surf(K_PLAIN, 0.1, 0.2, 0.05);
    g.flat([[-0.29, 0.22, -0.12], [0.29, 0.22, -0.12], [0.29, 0.22, 0.12], [-0.29, 0.22, 0.12]], rgb(0x3f7f9a));
  });
  g.surf(K_WOOD, 0.9);
  for (const x of [0.92, 1.72]) g.in(M(x, 0.25, 1.08, 0, 0, 90), () => g.beam(0.56, 0.07, 0.07, 0.012, tb(180 + x, 0.75), 2));
  g.in(M(1.32, 0.46, 1.08), () => g.beam(1.0, 0.06, 0.06, 0.012, tb(184, 0.8), 3));
  g.in(M(cx + 1.0, 0, cz + hz + 0.22), () => barrel(g, 0.15, 0.4, rgb(0x7a5a38), 3));
  g.in(M(cx + 1.05, 0.4, cz + hz + 0.21, 0, 0, 0), () => { g.surf(K_PLAIN, 0.6); g.lathe([[0.03, 0], [0.045, 0.01], [0.04, 0.09], [0.047, 0.1]], 10, rgb(0x8a8f96)); });
  g.in(M(cx - 1.02, 0, cz + hz + 0.24), () => barrel(g, 0.16, 0.42, rgb(0x86643c), 4));
  g.shade(sx0, 0, szb, sx1, 1.3, szf, 0.3, 0.2, [1, 1]);
}

function dockhouse(g, f, hex) {
  const tar = mul(rgb(hex), 0.62), tb = tbOf(tar), pale = rgb(0x9a7a52);
  const cx = -0.32, hx = 1.6, hz = 1.22, y0 = 0.24, y1 = 1.66, eZ = 1.5, eY = 1.58, rY = 2.74, sl = (rY - eY) / eZ, roofY = (z) => rY - 0.06 - Math.abs(z) * sl;
  const fs = stoneStyle(0x7d7a73, { seed: 2400, course: 0.12, len: [0.22, 0.4], r: 0.02, b: 0.018, var: 0.18 });
  g.in(M(cx, 0, 0), () => {
    stoneBox(g, hx + 0.04, hz + 0.04, 0, y0, fs, 2401);
    for (let s = 0; s < 4; s++) {
      const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz, gable = s % 2 === 1;
      g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
        boarded(g, W, y0, gable ? roofY : y1, tar, 2410 + s * 50, 0.15);
        g.surf(K_WOOD, 0.9);
        for (const y of [y0 + 0.05, 0.95, y1 - 0.02]) g.in(M(0, y, 0.035), () => g.beam(2 * W, 0.08, 0.04, 0.008, tb(s * 9 + y * 5, 0.8), 4));
        if (gable) { g.in(M(0, 2.2, 0.035), () => g.beam(2 * (W - (2.2 + 0.1 - eY) / sl), 0.07, 0.04, 0.008, tb(s * 9 + 7, 0.8), 2)); }
        if (s === 0) {
          // loading doors: two big leaves on strap hinges under a heavy lintel, a sill of worn stone
          const dx = -0.42, dw = 0.74, dh = 1.26;
          g.surf(K_PLAIN, 1);
          g.flat([[dx - dw, y0, 0.03], [dx + dw, y0, 0.03], [dx + dw, y0 + dh, 0.03], [dx - dw, y0 + dh, 0.03]], [0.02, 0.016, 0.012]);
          for (const e of [-1, 1]) g.in(M(dx + e * dw, y0, 0.04, 0, e * 14, 0), () => g.in(M(-e * dw / 2, 0, 0), () => {
            g.surf(K_WOOD, 0.88);
            for (let i = 0; i < 5; i++) g.in(M(-dw / 2 + (dw * (i + 0.5)) / 5, dh / 2, 0.02, 0, 0, 90), () => g.beam(dh, dw / 5 - 0.006, 0.035, 0.006, woodTint(mul(pale, 0.8 + 0.3 * hash1(i, e + 4)), i + e * 7), 3));
            for (const y of [0.16, dh - 0.16]) g.in(M(0, y, 0.045), () => g.beam(dw - 0.03, 0.09, 0.025, 0.006, woodTint(mul(pale, 0.7), y * 9 + e), 2));
            g.beamTo([-e * (dw / 2 - 0.04), 0.2, 0.045], [e * (dw / 2 - 0.04), dh - 0.2, 0.045], 0.025, 0.08, 0.006, woodTint(mul(pale, 0.7), e + 3), 2, [0, 0, 1]);
            for (const y of [0.16, dh - 0.16]) g.in(M(e * 0.08, y, 0.064), () => strap(g, dw * 0.7, 0.04, 5));
          }));
          g.surf(K_WOOD, 0.9);
          g.in(M(dx, y0 + dh + 0.07, 0.05), () => g.beam(2 * dw + 0.3, 0.14, 0.09, 0.014, tb(30, 0.9), 4));
          for (const e of [-1, 1]) g.in(M(dx + e * (dw + 0.07), y0 + dh / 2, 0.05, 0, 0, 90), () => g.beam(dh, 0.12, 0.09, 0.012, tb(32 + e, 0.9), 3));
          g.surf(K_STONE, 0.95);
          g.in(M(dx, 0.07, 0.16), () => g.cbox(2 * dw + 0.2, 0.3, 0.26, 0.02, stoneTint(mul(fs.pal[0], 1.1), 3)));
          g.in(M(dx + dw + 0.3, y0 + 1.08, 0.04), () => lantern(g));
          // a shuttered hatch, and nets hung up to dry on pegs
          g.in(M(1.1, y0 + 0.9, 0.03), () => { casement(g, 0.36, 0.34, tar, 5, false); });
          const nx0 = 0.48, nx1 = 1.5, ny = 0.98, nz = 0.07, net = rgb(0x9a8a62);
          g.surf(K_WOOD, 0.9);
          for (const x of [nx0, (nx0 + nx1) / 2, nx1]) g.in(M(x, ny + 0.02, 0.03, 90, 0, 0), () => g.cyl(0.014, 0.012, 0.08, 6, tb(40 + x, 1.2), false, true));
          const sag = (u, v) => [lerp(nx0, nx1, u), ny - v * 0.62 - 0.07 * Math.sin(Math.PI * ((u * 2) % 1)) * (1 - v * 0.6), nz + 0.03 * Math.sin(u * 9 + v * 4) + 0.03 * v];
          for (let i = 0; i <= 14; i++) { const pts = []; for (let k = 0; k <= 5; k++) pts.push(sag(clamp(i / 14 + (k % 2 ? 0.036 : 0), 0, 1), k / 5)); g.surf(K_CLOTH, 0.95); g.tube(pts, 0.006, 3, mul(net, 0.8 + 0.3 * hash1(i, 3)), false); const p2 = []; for (let k = 0; k <= 5; k++) p2.push(sag(clamp(i / 14 + (k % 2 ? 0 : 0.036), 0, 1), k / 5)); g.tube(p2, 0.006, 3, mul(net, 0.8 + 0.3 * hash1(i, 5)), false); }
          g.surf(K_PLAIN, 0.8);
          for (let i = 0; i < 7; i++) { const p = sag(i / 6, 0.02); g.in(M(p[0], p[1] + 0.01, p[2] + 0.012), () => g.add(new THREE.SphereGeometry(0.028, 7, 5), i % 2 ? rgb(0xb8432e) : rgb(0xd8c8a0))); }
        }
        if (s === 2) for (const x of [-0.8, 0.8]) g.in(M(x, y0 + 0.92, 0.03), () => casement(g, 0.36, 0.34, tar, 7 + x, false));
        if (s === 1) {
          // the loft door under the hoist
          g.surf(K_WOOD, 0.88);
          for (let i = 0; i < 4; i++) g.in(M(-0.24 + i * 0.16, 2.02, 0.05, 0, 0, 90), () => g.beam(0.6, 0.154, 0.03, 0.006, woodTint(mul(pale, 0.85 + 0.25 * hash1(i, 8)), i + 50), 2));
          for (const y of [1.84, 2.2]) g.in(M(0, y, 0.07), () => strap(g, 0.6, 0.035, 5));
          g.surf(K_WOOD, 0.9);
          for (const e of [-1, 1]) g.in(M(e * 0.36, 2.02, 0.05, 0, 0, 90), () => g.beam(0.72, 0.07, 0.07, 0.01, tb(60 + e, 0.9), 2));
          g.in(M(0, 1.69, 0.08), () => g.beam(0.9, 0.06, 0.14, 0.01, tb(63, 0.9), 2));
        }
      });
    }
    g.surf(K_WOOD, 0.9);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * hx, (y0 + y1) / 2, sz * hz, 0, 0, 90), () => g.beam(y1 - y0, 0.14, 0.14, 0.014, tb(70 + sx + sz * 2, 0.85), 3));
    g.shade(-hx - 0.2, y1 - 0.3, -hz - 0.3, hx + 0.2, y1 + 0.1, hz + 0.3, 0.35, 0.03, [1, 1]);
    gableRoof(g, { x0: -hx - 0.08, x1: hx + 0.12, eZ, eY, rY, pal: SHINGLE, seed: 2440, tw: 0.17, th: 0.15, barge: mul(tar, 1.1), ridgeCol: mul(SHINGLE[2], 0.8), gap: 0.1 });
    g.surf(K_WOOD, 0.9);
    for (const e of [1, -1]) for (let i = 0; i < 11; i++) { const x = -hx + 0.04 + i * ((2 * hx) / 10); g.beamTo([x, eY - 0.03, e * (eZ - 0.01)], [x, eY - 0.03 + 0.26 * sl, e * (eZ - 0.27)], 0.07, 0.055, 0.008, tb(80 + i, 0.8), 1); }
    // the hoist: a beam run out from under the ridge, strutted from the wall, a block and fall with a cask in a sling
    const hy = 2.52, hx1 = hx + 0.68;
    g.in(M(hx - 0.4 + (hx1 - hx + 0.4) / 2, hy, 0), () => g.beam(hx1 - hx + 0.4, 0.12, 0.11, 0.016, tb(90, 0.95), 4));
    g.beamTo([hx + 0.03, 2.44 - 0.5, 0], [hx + 0.46, hy - 0.06, 0], 0.07, 0.07, 0.012, tb(91, 0.9), 2);
    g.surf(K_PLAIN, 0.5, 0.85);
    g.in(M(hx1 - 0.02, hy, 0), () => g.cbox(0.05, 0.16, 0.15, 0.008, IRON));
    const bx = hx1 - 0.16;
    g.in(M(bx, hy - 0.06, 0), () => g.cbox(0.03, 0.1, 0.03, 0.006, IRON));
    g.in(M(bx, hy - 0.2, 0), () => { g.surf(K_WOOD, 0.85); g.cbox(0.13, 0.19, 0.075, 0.03, tb(92, 1.1)); g.in(M(0, 0, -0.045, 90, 0, 0), () => g.cyl(0.05, 0.05, 0.09, 12, mul(pale, 0.9), true, true)); g.surf(K_PLAIN, 0.5, 0.85); g.in(M(0, 0, -0.05, 90, 0, 0), () => g.cyl(0.014, 0.014, 0.1, 6, IRON, true, true)); });
    rope(g, [[bx + 0.03, hy - 0.26, 0], [bx + 0.03, 1.3, 0]], 0.012);
    rope(g, [[bx - 0.04, hy - 0.24, 0], [bx - 0.12, 1.9, 0.05], [hx + 0.06, 1.1, 0.5], [hx + 0.04, 0.95, 0.52]], 0.011);
    g.surf(K_PLAIN, 0.5, 0.85);
    g.tube([[bx + 0.03, 1.3, 0], [bx + 0.03, 1.24, 0], [bx + 0.06, 1.2, 0], [bx + 0.03, 1.16, 0], [bx, 1.19, 0]], 0.011, 5, IRON);
    g.in(M(hx + 0.035, 0.98, 0.52, 0, 90, 0), () => g.cbox(0.16, 0.03, 0.04, 0.008, IRON));
    g.in(M(bx + 0.03, 0.72, 0), () => {
      barrel(g, 0.15, 0.4, rgb(0x86643c), 9);
      for (const a of [0, 90]) g.in(M(0, 0, 0, 0, a, 0), () => rope(g, [[0, 0.5, 0], [0.11, 0.42, 0], [0.165, 0.3, 0], [0.165, 0.1, 0], [0.13, -0.01, 0], [0, -0.02, 0], [-0.13, -0.01, 0], [-0.165, 0.1, 0], [-0.165, 0.3, 0], [-0.11, 0.42, 0], [0, 0.5, 0]], 0.01));
    });
  });
  // the yard: casks stacked under the hoist, a coil of rope, an anchor against the wall
  const yx = cx + hx;
  for (const [x, z, r, h, sd] of [[yx + 0.24, -0.62, 0.17, 0.44, 1], [yx + 0.52, -0.9, 0.16, 0.42, 2], [yx + 0.22, -1.02, 0.16, 0.42, 3], [yx + 0.5, -0.5, 0.15, 0.4, 4]]) g.in(M(x, 0, z), () => barrel(g, r, h, rgb(sd % 2 ? 0x7a5a38 : 0x86643c), sd));
  g.in(M(yx + 0.36, 0.44, -0.78, 0, 30, 0), () => barrel(g, 0.15, 0.4, rgb(0x8a6a44), 5));
  g.in(M(yx + 0.3, 0.16, 0.86, 90, 0, 20), () => barrel(g, 0.16, 0.42, rgb(0x7a5a38), 6));
  const coil = [];
  for (let i = 0; i <= 50; i++) { const a = (i / 50) * TAU * 4, rr = 0.13 + 0.008 * Math.sin(i * 1.3); coil.push([yx + 0.42 + Math.cos(a) * rr, 0.02 + (i / 50) * 0.07, 0.3 + Math.sin(a) * rr]); }
  rope(g, coil, 0.014);
  g.in(M(cx - 1.25, 0, hz + 0.12, -8, 0, 0), () => {
    g.surf(K_PLAIN, 0.6, 0.8);
    const ir = (x, y, z) => mul(rgb(0x2a2a2e), 0.8 + 0.5 * noise3(x * 20, y * 20, z * 20));
    g.tube([[0, 0.06, 0], [0, 0.82, 0]], 0.022, 6, ir);
    g.in(M(0, 0.7, 0, 0, 0, 90), () => g.in(M(0, -0.16, 0), () => g.cyl(0.016, 0.016, 0.32, 6, ir, true, true)));
    const arm = []; for (let k = 0; k <= 10; k++) { const a = Math.PI * (1.08 + 0.84 * (k / 10)); arm.push([Math.cos(a) * 0.24, 0.3 + Math.sin(a) * 0.24, 0]); }
    g.tube(arm, 0.022, 6, ir);
    for (const e of [-1, 1]) g.flat([[e * 0.3, 0.2, 0], [e * 0.2, 0.14, 0], [e * 0.2, 0.32, 0]], rgb(0x2a2a2e));
    g.in(M(0, 0.86, 0, 0, 90, 0), () => g.add(new THREE.TorusGeometry(0.045, 0.012, 5, 12), rgb(0x2a2a2e)));
  });
  g.in(M(cx - hx + 0.3, rY + 0.0, 0), () => sidePennant(g, f, 0.7, 0.5, 0.22));
}

// =====================================================================================================
// Barracks, alchemist, temple, palace
// =====================================================================================================
/** the sides and head of an arched opening, running back `depth` from the wall face (local z = 0) into shadow */
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

function barracks(g, f, hex) {
  const st = stoneStyle(hex, { seed: 2500, len: [0.3, 0.56] }), r = st.r, col = st.pal[0], cc = stoneTint(mul(col, 1.06), 4, 5);
  const plaster = rgb(0xd6c8a6), oak = rgb(OAK), tb = (seed, k = 1) => woodTint(mul(oak, k * (0.85 + 0.35 * hash1(seed, 3))), seed);
  const hx = 2.28, cz = -0.32, hz = 0.95, y1 = 1.2, y2 = 2.1, fz = cz + hz, eZ = hz + 0.22, eY = y2 - 0.06, rY = 3.02, sl = (rY - eY) / eZ;
  const slit = (W, xs) => xs.map((x) => [W - r + x - 0.07, 0.4, W - r + x + 0.07, 1.0]);
  const fr = [-1.8, -1.25, -0.05], bk = [-1.7, -0.85, 0, 0.85, 1.7], sd = [0], dx = -0.62;
  g.in(M(0, 0, cz), () => {
    stoneBox(g, hx, hz, 0, y1, st, 2510, { quoin: [0.56, 0.3], holes: [[...slit(hx, fr), [hx - r + dx - 0.3, 0, hx - r + dx + 0.3, 1.0]], slit(hz, sd), slit(hx, bk), slit(hz, sd)], each: (s, W) => {
      for (const x of s === 0 ? fr : s === 2 ? bk : sd) g.in(M(W - r + x - 0.07, 0.4, 0), () => arrowLoop(g, 0.14, 0.6, st));
      if (s === 0) g.in(M(W - r + dx, 0, 0), () => {
        g.surf(K_PLAIN, 1);
        for (const e of [-1, 1]) g.flat([[e * 0.3, 0, r], [e * 0.3, 1.0, r], [e * 0.28, 1.0, -0.12], [e * 0.28, 0, -0.12]], [mul(col, 0.6), mul(col, 0.6), mul(col, 0.25), mul(col, 0.25)]);
        g.flat([[-0.3, 1.0, r], [0.3, 1.0, r], [0.28, 1.0, -0.12], [-0.28, 1.0, -0.12]], mul(col, 0.3));
        g.in(M(0, 0, -0.12), () => { plankDoor(g, 0.56, 1.0, rgb(0x5a4028), 9, 4); for (const y of [0.5]) g.in(M(0, y, 0.046), () => strap(g, 0.54, 0.045, 5)); });
        g.surf(K_STONE, 0.93);
        g.in(M(0, 1.07, 0.02), () => g.cbox(0.84, 0.14, 0.09, 0.02, cc));
        g.in(M(0, 0.02, 0.14), () => g.cbox(0.8, 0.12, 0.26, 0.02, cc));
      });
    } });
    for (let s = 0; s < 4; s++) {
      const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz;
      g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
        g.surf(K_STONE, 0.93);
        band(g, [[0.0, y1 - 0.1], [0.04, y1 - 0.07], [0.04, y1 - 0.01], [0.012, y1 + 0.03]], 2 * W, mul(col, 1.05), 2520 + s, 1, 1);
        const items = s === 0 ? [{ kind: 'win', x: -1.75, y: 1.68, w: 0.42, h: 0.4 }, { kind: 'win', x: -0.25, y: 1.68, w: 0.42, h: 0.4, lit: true }, { kind: 'door', x: 1.86, w: 0.48, h: 0.76, wood: rgb(0x6a4a2c) }]
          : s === 2 ? [-1.6, -0.55, 0.55, 1.6].map((x, i) => ({ kind: 'win', x, y: 1.68, w: 0.42, h: 0.4, lit: i === 2, shutters: false })) : [{ kind: 'win', x: 0, y: 1.68, w: 0.42, h: 0.4 }];
        g.in(M(0, 0, 0.012), () => framed(g, W, y1 + 0.03, y2, plaster, oak, 2530 + s * 30, items));
      });
    }
    g.surf(K_WOOD, 0.88);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * hx, (y1 + y2) / 2 + 0.02, sz * hz, 0, 0, 90), () => g.beam(y2 - y1, 0.14, 0.14, 0.012, tb(70 + sx + sz * 2), 3));
    g.shade(-hx - 0.2, y2 - 0.3, -hz - 0.25, hx + 0.2, y2 + 0.1, hz + 0.25, 0.35, 0.03, [1, 1]);
    gableRoof(g, { x0: -hx - 0.15, x1: hx + 0.15, eZ, eY, rY, pal: SLATE, seed: 2560, tw: 0.17, th: 0.15, barge: mul(oak, 0.9), ridgeCol: LEAD });
    for (const e of [1, -1]) g.in(M(e * (hx + 0.012), 0, 0, 0, e * 90, 0), () => framedGable(g, hz, y2 - 0.02, rY - 0.07, plaster, oak, 2570 + e, { w: 0.3, h: 0.3 }));
    for (const x of [-1.4, 0, 1.4]) g.in(M(x, eY + 0.34 * sl, eZ - 0.34), () => dormer(g, 0.54, 0.38, 0.66, 0.74, SLATE, oak, 2580 + x * 3, x === 0));
    g.in(M(1.1, 0, -hz - 0.14), () => chimney(g, 0.24, 0.15, -0.13, 3.3, 0x8f8778, 2590, 2));
    g.in(M(-hx + 0.25, rY, 0), () => sidePennant(g, f, 0.8, 0.55, 0.24));
  });
  // the outside stair up to the dormitory door
  const sx0 = 0.32, sx1 = 1.52, sxe = 2.26, sw = 0.5, run = (sx1 - sx0) / 6;
  g.surf(K_STONE, 0.93);
  const holes = [];
  for (let j = 1; j < 6; j++) holes.push([-1, j * COURSE, j * run, (j + 1) * COURSE, CUT]);
  g.in(M(sx0, 0, fz + sw - r), () => { g.ashlar(sxe - r - sx0, y1, { ...st, seed: 2600, ends: [CUT, CORNER, 0, 0], holes }); footing(g, 0, sxe - sx0, col, r); });
  g.in(M(sxe - r, 0, fz + sw - r, 0, 90, 0), () => { g.ashlar(sw - r, y1, { ...st, seed: 2601, ends: [CORNER, CUT, 0, 0] }); footing(g, -r, sw, col, r); });
  const slab = stoneTint(mul(col, 0.92), 4);
  for (let k = 0; k < 6; k++) {
    g.in(M(sx0 + k * run + r, k * COURSE, fz, 0, -90, 0), () => g.ashlar(sw - r, COURSE, { ...st, seed: 2602 + k, len: [0.2, 0.3], ends: [CUT, CORNER, 0, 0] }));
    const xb = k < 5 ? sx0 + (k + 1) * run : sxe;
    g.in(M((sx0 + k * run - 0.014 + xb) / 2, (k + 1) * COURSE - 0.016, fz + sw / 2), () => g.cbox(xb - sx0 - k * run + 0.014, 0.032, sw + 0.02, 0.01, slab));
  }
  g.surf(K_WOOD, 0.9);
  const rz = fz + sw - 0.05, rail = [[sx0 + run * 0.5, COURSE], [sx0 + run * 3.5, 4 * COURSE], [sx1 + 0.05, y1], [sxe - 0.05, y1]];
  rail.forEach(([x, y], i) => g.in(M(x, y + 0.26, rz, 0, 0, 90), () => g.beam(0.52, 0.055, 0.055, 0.01, tb(200 + i, 0.8), 2)));
  for (let i = 0; i < 3; i++) g.beamTo([rail[i][0], rail[i][1] + 0.5, rz], [rail[i + 1][0], rail[i + 1][1] + 0.5, rz], 0.05, 0.05, 0.008, tb(205 + i, 0.85), 2);
  g.beamTo([sxe - 0.05, y1 + 0.5, rz], [sxe - 0.05, y1 + 0.5, fz + 0.03], 0.05, 0.05, 0.008, tb(209, 0.85), 1);
  // weapon rack: spears leaning in a row, shields in the side's colour hung below
  const rx0 = -2.2, rx1 = -1.28, rzz = fz + 0.42;
  g.surf(K_WOOD, 0.9);
  for (const x of [rx0, rx1]) { g.in(M(x, 0.5, rzz, 0, 0, 90), () => g.beam(1.0, 0.07, 0.07, 0.012, tb(210 + x, 0.85), 2)); g.in(M(x, 0.03, rzz, 0, 90, 0), () => g.beam(0.5, 0.06, 0.08, 0.01, tb(213 + x, 0.8), 1)); g.beamTo([x, 0.06, rzz + 0.2], [x, 0.45, rzz + 0.02], 0.045, 0.045, 0.008, tb(215 + x, 0.8), 1); }
  for (const y of [0.34, 0.9]) g.in(M((rx0 + rx1) / 2, y, rzz), () => g.beam(rx1 - rx0 + 0.12, 0.06, 0.05, 0.01, tb(217 + y, 0.9), 2));
  for (let i = 0; i < 5; i++) {
    const x = rx0 + 0.12 + i * 0.17, a = [x, 0.02, rzz + 0.2], b = [x + (hash1(i, 3) - 0.5) * 0.04, 1.5 + hash1(i, 5) * 0.12, rzz - 0.07];
    g.surf(K_WOOD, 0.85);
    g.tube([a, b], 0.013, 6, woodTint(rgb(0x8a6a44), i));
    const fm = along(a, b);
    g.surf(K_PLAIN, 0.35, 0.9);
    g.in(fm.m.clone().multiply(M(fm.L / 2, 0, 0, 0, 0, -90)), () => { g.lathe([[0.017, -0.06], [0.014, 0], [0.03, 0.03], [0.022, 0.1], [0, 0.2]], 4, rgb(0x9aa0a8)); });
  }
  for (const [x, sd] of [[-1.96, 1], [-1.54, 2]]) g.in(M(x, 0.62, rzz + 0.045, 0, 0, sd * 9), () => {
    f.seg = g.seg; f.surf(K_PLAIN, 0.85);
    f.in(M(0, 0, 0, 90, 0, 0), () => f.lathe([[0, 0.045], [0.08, 0.04], [0.17, 0.022], [0.2, 0.008], [0.2, 0]].reverse(), 20, (px, py, pz) => (((Math.atan2(pz, px) + 7) % (Math.PI)) < Math.PI / 2 ? [1.25, 1.25, 1.25] : [0.8, 0.8, 0.8])));
    f.seg = { e: null, ne: null, bend: 0, up: null };
    g.surf(K_PLAIN, 0.4, 0.85);
    g.add(new THREE.TorusGeometry(0.2, 0.012, 5, 22), IRON);
    g.in(M(0, 0, 0.04), () => g.stud(0.05, rgb(0x9aa0a8), 10, 0.7));
  });
  // drill post: a pell hacked by practice swords, a straw man lashed to it
  g.in(M(-0.7, 0, fz + 0.72), () => {
    log(g, 0.075, 0.06, 1.25, 5, { seg: 10, bark: rgb(0x6a5236), amp: 0.12 });
    g.surf(K_WOOD, 0.9);
    g.in(M(0, 0.98, 0.0), () => g.beam(0.74, 0.07, 0.06, 0.012, tb(230, 1.2), 2));
    g.surf(K_ROOF, 0.98);
    const straw = (x, y, z) => mul(rgb(0xcfa858), 0.7 + 0.5 * noise3(x * 30, y * 8, z * 30));
    g.in(M(0, 0.48, 0.02), () => g.lathe([[0.08, 0], [0.15, 0.06], [0.16, 0.3], [0.13, 0.42], [0.07, 0.46]], 12, straw));
    g.in(M(0, 1.02, 0.02), () => g.add(new THREE.SphereGeometry(0.11, 10, 8), straw));
    for (const y of [0.56, 0.86]) g.in(M(0, y, 0.02), () => lashing(g, 0.15, 2, 0.011));
    g.surf(K_PLAIN, 0.5, 0.85);
    g.in(M(0, 1.1, 0.02), () => g.lathe([[0.125, -0.04], [0.118, 0.02], [0.08, 0.075], [0, 0.1]], 12, rgb(0x7a8088)));
    g.surf(K_PLAIN, 0.8);
    g.in(M(0, 0.74, 0.185), () => g.add(new THREE.TorusGeometry(0.06, 0.014, 4, 14), rgb(0xb8322a)));
  });
  g.in(M(dx, 2.02, fz + 0.2), () => { g.surf(K_PLAIN, 0.5, 0.85); g.tube([[0, 0, -0.2], [0, 0, 0.02]], 0.012, 5, IRON); g.tube([[0, -0.2, -0.2], [0, -0.06, -0.06], [0, 0, 0]], 0.009, 4, IRON); sideBanner(g, f, 0.44, 0.78, 3); });
  g.in(M(0.02, 0, fz + 0.2), () => barrel(g, 0.14, 0.38, rgb(0x7a5a38), 3));
}

/** a glass vessel standing on the local origin: round body of radius r holding glowing liquid, a tall neck */
function flask(g, r, liquid) {
  g.surf(K_PLAIN, 0.2, 0, 1.25);
  g.lathe([[r * 0.45, 0], [r * 0.9, r * 0.25], [r, r * 0.75], [r * 0.93, r * 1.05], [0, r * 1.05]], 12, (x, y) => mul(liquid, 0.75 + 0.4 * (y / r)));
  g.surf(K_PLAIN, 0.08, 0.2, 0.12);
  g.lathe([[r * 0.93, r * 1.05], [r * 0.78, r * 1.42], [r * 0.3, r * 1.8], [r * 0.26, r * 2.5], [r * 0.36, r * 2.58], [r * 0.3, r * 2.62]], 12, mix(rgb(0xbfe6e0), liquid, 0.15));
  g.surf(K_WOOD, 0.9);
  g.in(M(0, r * 2.58, 0), () => g.cyl(r * 0.26, r * 0.22, r * 0.2, 8, rgb(0x9a7a52), false, true));
}
function alchemist(g, hex) {
  const pc = rgb(hex), PURPLE = [pc, mul(pc, 1.25), mul(pc, 0.78), mix(pc, rgb(0x4a6aaa), 0.35), mix(pc, rgb(0x9a4a8a), 0.35), mul(pc, 1.1)];
  const plaster = rgb(0xcfc8a4), oak = rgb(0x3a2a26), tb = (seed, k = 1) => woodTint(mul(oak, k * (0.85 + 0.35 * hash1(seed, 3))), seed);
  const hx = 0.86, hz = 0.98, cx = -0.42, cz = -0.22, y0 = 0.2, y1 = 1.3, pk = 2.8, copper = (x, y, z) => mix(COPPER, VERDIGRIS, smooth(0.35, 0.7, noise3(x * 5, y * 5, z * 5)) * 0.9);
  const c = rgb(0x7d766c), foot = stoneStyle(0x7d766c, { seed: 2700, r: 0.022, b: 0.02, rough: 0.01, var: 0.18, nf: 7, pal: [c, mix(c, rgb(0x8f7a5c), 0.5), mix(c, rgb(0x5f6870), 0.4), mul(c, 0.8), mul(c, 1.1)], mortar: mul(c, 0.25) });
  // the house leans one way as it rises...
  g.in(new THREE.Matrix4().set(1, -0.075, 0, cx, 0, 1, 0, 0, 0, 0.03, 1, cz, 0, 0, 0, 1), () => {
    for (let s = 0; s < 4; s++) {
      const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz;
      g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
        g.surf(K_STONE, 0.95);
        g.in(M(-W - 0.05, 0, 0.05), () => { rubbleFace(g, 2 * W + 0.1, y0 + 0.02, foot, 2710 + s); footing(g, 0, 2 * W + 0.1, c); });
        const items = s === 0 ? [{ kind: 'door', x: -0.3, w: 0.5, h: 0.94, wood: mul(pc, 0.9) }, { kind: 'win', x: 0.42, y: 0.86, w: 0.32, h: 0.4, lit: true, shutters: false }] : s === 3 ? [{ kind: 'win', x: 0.1, y: 0.86, w: 0.44, h: 0.42, lit: true }] : s === 2 ? [{ kind: 'win', x: 0, y: 0.86, w: 0.4, h: 0.4 }] : [];
        framed(g, W, y0, y1, plaster, oak, 2720 + s * 30, items);
        if (s % 2 === 0) framedGable(g, hx, y1 - 0.02, pk - 0.08, plaster, oak, 2730 + s, s === 0 ? { w: 0.34, h: 0.36, lit: true } : null);
        if (s === 0) { g.surf(K_STONE, 0.95); g.in(M(-0.3, 0.03, 0.13), () => g.cbox(0.76, 0.3, 0.24, 0.02, stoneTint(mul(c, 1.05), 3))); g.in(M(0.04, 1.14, 0.06), () => lantern(g)); }
      });
    }
    g.surf(K_WOOD, 0.88);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * hx, (y0 + y1) / 2 + 0.03, sz * hz, 0, 0, 90), () => g.beam(y1 - y0 + 0.06, 0.135, 0.135, 0.012, tb(70 + sx + sz * 2), 4));
    const eY = y1 - 0.1, eX = hx + 0.2;
    g.in(M(0, 0, 0, 0, -90, 0), () => gableRoof(g, { x0: -hz - 0.2, x1: hz + 0.2, eZ: eX, eY, rY: pk, pal: PURPLE, round: true, seed: 2740, lift: 0.024, tw: 0.16, th: 0.15, barge: mul(oak, 1.2), ridgeCol: mul(pc, 0.7), ridgeR: 0.06 }));
    g.shade(-hx - 0.25, y1 - 0.35, -hz - 0.2, hx + 0.25, y1 + 0.05, hz + 0.2, 0.3, 0.03, [1, 1]);
    // a bent chimney, streaked where the fumes have run down it
    g.in(M(-0.3, 0, -0.42, 0, 0, 4.5), () => {
      chimney(g, 0.17, 0.17, 1.75, 3.25, 0x7a7068, 2750, 1);
      g.surf(K_PLAIN, 0.5, 0, 0.25);
      for (const [x, w, l, sd] of [[-0.05, 0.05, 0.62, 1], [0.07, 0.035, 0.4, 2], [-0.12, 0.03, 0.3, 3]]) for (const fz of [1, -1]) g.flat([[x - w, 3.3, fz * 0.176], [x + w, 3.3, fz * 0.176], [x + w * 0.4, 3.3 - l * (0.8 + 0.2 * sd / 3), fz * 0.176], [x - w * 0.3, 3.3 - l, fz * 0.176]], [rgb(0x6fd84a), rgb(0x6fd84a), rgb(0x3f8a3a), rgb(0x3f8a3a)]);
      g.in(M(0, 3.46, 0), () => smoke(g, 0.9, 7, 0x5fae4a, 0xa8e08a));
    });
  });
  // ...and the tower the other
  const tx = 0.78, tz = -0.62, R = 0.5, ts = stoneStyle(0x8a8478, { seed: 2760, len: [0.24, 0.42] }), r = ts.r, th = 2.6;
  g.in(M(tx, 0, tz, 3, 0, -5), () => {
    const circ = (R - r) * TAU, wins = [[0.1, 1.6], [0.36, 0.8], [0.62, 2.0], [0.86, 1.2]].map(([u, v]) => [circ * u - 0.09, v, circ * u + 0.09, v + 0.4]);
    g.surf(K_STONE, 0.93);
    g.bend(R - r, () => {
      g.in(M(0, -0.1, 0), () => g.ashlar(circ, th + 0.1, { ...ts, wrap: true, holes: wins.map((w) => [w[0], w[1] + 0.1, w[2], w[3] + 0.1]) }));
      for (const w of wins) {
        g.surf(K_PLAIN, 0.3, 0, 1.0);
        g.flat([[w[0], w[1], -0.03], [w[2], w[1], -0.03], [w[2], w[3], -0.03], [w[0], w[3], -0.03]], [rgb(0x4fd86a), rgb(0x4fd86a), rgb(0xb8f08a), rgb(0xb8f08a)]);
        g.surf(K_PLAIN, 0.5, 0.8);
        g.in(M((w[0] + w[2]) / 2, (w[1] + w[3]) / 2, -0.02), () => { g.cbox(0.012, 0.4, 0.012, 0.003, IRON); g.cbox(0.18, 0.012, 0.012, 0.003, IRON); });
        g.surf(K_STONE, 0.93);
        g.in(M((w[0] + w[2]) / 2, w[1] - 0.02, 0.02), () => g.cbox(0.26, 0.045, 0.07, 0.012, stoneTint(mul(ts.pal[0], 1.06), 3)));
        g.in(M((w[0] + w[2]) / 2, w[3] + 0.025, 0.02), () => g.cbox(0.28, 0.05, 0.07, 0.012, stoneTint(mul(ts.pal[0], 1.06), 5)));
      }
    });
    g.lathe([[R + 0.05, -0.16], [R + 0.05, 0.18], [R + 0.01, 0.24]], 28, stoneTint(mul(ts.pal[0], 0.95), 2));
    g.lathe([[R, th - 0.14], [R + 0.05, th - 0.1], [R + 0.11, th], [R + 0.11, th + 0.08], [R + 0.07, th + 0.1]], 28, stoneTint(mul(ts.pal[0], 1.05), 4));
    // dome of copper gone green, seamed, with a slot for the telescope
    g.surf(K_PLAIN, 0.5, 0.6);
    const dp = [[R + 0.07, th + 0.1]];
    for (let k = 1; k <= 9; k++) { const a = (k / 9) * Math.PI * 0.5; dp.push([(R + 0.1) * Math.cos(a) * (1 + 0.1 * Math.sin(a * 2)), th + 0.1 + 0.62 * Math.sin(a)]); }
    g.lathe(dp, 28, copper);
    for (let i = 0; i < 8; i++) g.in(M(0, 0, 0, 0, i * 45, 0), () => g.tube(dp.map(([rr, y]) => [rr + 0.006, y, 0]), 0.014, 5, mul(COPPER, 0.9), false));
    g.in(M(0, th + 0.7, 0), () => g.lathe([[0.09, 0], [0.05, 0.05], [0.03, 0.1], [0.06, 0.15], [0.03, 0.2], [0.012, 0.24], [0, 0.42]], 10, copper));
    const ta = [0.1, th + 0.42, 0.22], tb2 = [0.34, th + 0.98, 0.78], fm = along(ta, tb2);
    g.surf(K_PLAIN, 0.3, 0.9);
    g.in(fm.m.clone().multiply(M(-fm.L / 2, 0, 0, 0, 0, -90)), () => {
      g.lathe([[0.085, 0], [0.085, 0.3], [0.07, 0.31], [0.07, 0.56], [0.058, 0.57], [0.058, fm.L - 0.04], [0.07, fm.L - 0.035], [0.07, fm.L], [0.05, fm.L]], 14, rgb(0xc9a04a));
      g.surf(K_PLAIN, 0.05, 0.3, 0.2);
      g.in(M(0, fm.L - 0.012, 0), () => g.cyl(0.052, 0.052, 0.001, 12, rgb(0x8fd0e8), false, true));
    });
    g.surf(K_PLAIN, 1);
    g.in(M(0.1, th + 0.44, 0.24, -52, 20, 0), () => g.cbox(0.24, 0.02, 0.34, 0.006, [0.02, 0.02, 0.02]));
    // a creeper with glowing pods winds up the wall
    const vine = [];
    for (let i = 0; i <= 30; i++) { const t = i / 30, a = 2.2 + t * 5.2 + Math.sin(t * 9) * 0.2; vine.push([Math.sin(a) * (R + 0.012), 0.02 + t * 2.25, Math.cos(a) * (R + 0.012)]); }
    g.surf(K_WOOD, 0.9);
    g.tube(vine, vine.map((_, i) => 0.016 * (1 - (i / 30) * 0.6)), 5, rgb(0x3a4a2a), false);
    for (let i = 2; i < 30; i += 2) { const p = vine[i], l = Math.hypot(p[0], p[2]), nx = p[0] / l, nz = p[2] / l; g.surf(K_LEAF, 0.85); g.flat([[p[0], p[1], p[2]], [p[0] + nx * 0.03 - nz * 0.07, p[1] + 0.05, p[2] + nz * 0.03 + nx * 0.07], [p[0] + nx * 0.02, p[1] + 0.13, p[2] + nz * 0.02], [p[0] + nx * 0.03 + nz * 0.07, p[1] + 0.05, p[2] + nz * 0.03 - nx * 0.07]], [rgb(0x2f5a3a), rgb(0x4a8a4a), rgb(0x5aa85a), rgb(0x4a8a4a)]); if (i % 4 === 0) { g.surf(K_PLAIN, 0.4, 0, 1.3); g.in(M(p[0] + nx * 0.05, p[1] - 0.02, p[2] + nz * 0.05), () => g.add(new THREE.SphereGeometry(0.04, 8, 6).scale(1, 1.3, 1), rgb(0xc85ae8))); } }
  });
  // pipes from the house to the tower
  const pipe = (pts, rr = 0.032) => { g.surf(K_PLAIN, 0.4, 0.8); g.tube(pts, rr, 8, (x, y, z) => mix(COPPER, VERDIGRIS, smooth(0.55, 0.8, noise3(x * 9, y * 9, z * 9)) * 0.8), true); for (const p of [pts[0], pts[pts.length - 1]]) g.in(M(p[0], p[1], p[2]), () => g.add(new THREE.SphereGeometry(rr * 1.7, 8, 6), mul(COPPER, 0.8))); };
  pipe([[cx + hx - 0.08, 0.72, 0.2], [0.62, 0.72, 0.2], [0.72, 0.8, 0.12], [0.76, 1.3, -0.02], [0.78, 1.4, -0.12]]);
  pipe([[0.76, 1.1, 0.74], [0.74, 1.3, 0.5], [0.66, 1.36, 0.3], [cx + hx - 0.12, 1.36, 0.3]], 0.024);
  pipe([[cx + hx - 0.1, 1.08, -0.5], [0.3, 1.1, -0.5], [0.4, 1.12, -0.52]], 0.026);
  pipe([[1.16, 0.3, -0.22], [1.22, 0.34, -0.16], [1.24, 1.3, -0.22], [1.27, 2.0, -0.28], [1.34, 2.12, -0.22], [1.36, 2.36, -0.22]], 0.028);
  g.surf(K_PLAIN, 0.4, 0.8);
  g.in(M(1.24, 1.2, -0.16, 0, 20, 0), () => g.add(new THREE.TorusGeometry(0.06, 0.012, 5, 14), rgb(0x9a2a2a)));
  // the still: a firebox, the copper pot, its swan neck over to the worm tub, a flask catching what drips
  g.in(M(0.76, 0, 0.96, 0, -22, 0), () => {
    const bs = stoneStyle(0x9a5a44, { seed: 2770, course: 0.085, len: [0.14, 0.2], r: 0.01, b: 0.01, var: 0.16, cell: 0.1 / qual() });
    stoneBox(g, 0.26, 0.24, 0, 0.34, bs, 2771, { holes: [[[0.26 - 0.01 - 0.09, 0.085, 0.26 - 0.01 + 0.09, 0.255]], null, null, null], each: (s) => { if (s) return; g.surf(K_PLAIN, 1, 0, 1.6); g.flat([[0.16, 0.085, -0.04], [0.34, 0.085, -0.04], [0.34, 0.255, -0.04], [0.16, 0.255, -0.04]], [[1, 0.75, 0.2], [1, 0.75, 0.2], [1, 0.3, 0.04], [1, 0.3, 0.04]]); } });
    g.surf(K_STONE, 0.93);
    g.in(M(0, 0.36, 0), () => g.cbox(0.58, 0.05, 0.54, 0.012, stoneTint(rgb(0x7d766c), 3)));
    g.surf(K_PLAIN, 0.35, 0.85);
    g.lathe([[0.17, 0.385], [0.25, 0.46], [0.27, 0.6], [0.22, 0.74], [0.12, 0.83], [0.09, 0.9], [0.13, 0.97], [0.11, 1.05], [0.04, 1.1], [0, 1.1]], 20, (x, y, z) => mix(COPPER, VERDIGRIS, smooth(0.6, 0.85, noise3(x * 7, y * 7, z * 7)) * 0.7));
    for (const y of [0.5, 0.7]) g.lathe([[0.268 - (y > 0.6 ? 0.03 : 0.01), y - 0.012], [0.28 - (y > 0.6 ? 0.03 : 0.01), y], [0.268 - (y > 0.6 ? 0.03 : 0.01), y + 0.012]], 20, mul(COPPER, 0.7));
    g.tube([[0, 1.08, 0], [0.03, 1.2, 0], [0.16, 1.27, 0], [0.34, 1.2, 0], [0.47, 1.0, 0], [0.5, 0.86, 0]], [0.04, 0.036, 0.032, 0.028, 0.024, 0.022], 8, mul(COPPER, 1.05), false);
    g.in(M(0.5, 0, 0), () => {
      barrel(g, 0.17, 0.42, rgb(0x7a5a38), 4);
      const worm = [];
      for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU * 4; worm.push([Math.cos(a) * 0.1, 0.86 - (i / 40) * 0.44, Math.sin(a) * 0.1]); }
      g.surf(K_PLAIN, 0.35, 0.85);
      g.tube(worm, 0.02, 6, mul(COPPER, 1.05), false);
      g.tube([[0.15, 0.24, 0.02], [0.21, 0.24, 0.07], [0.22, 0.2, 0.09]], 0.016, 6, mul(COPPER, 0.9), false);
    });
    g.in(M(0.72, 0, 0.1), () => flask(g, 0.085, rgb(0x5ae84a)));
  });
  // a bench of flasks and a big alembic by the door
  g.in(M(cx + 0.47, 0, cz + hz + 0.3), () => {
    trestleTable(g, 0.82, 0.3, 0.44, rgb(0x6a5236), 80);
    g.in(M(-0.28, 0.44, 0), () => flask(g, 0.07, rgb(0xe84ac8)));
    g.in(M(-0.1, 0.44, 0.04), () => flask(g, 0.055, rgb(0x4ad8e8)));
    g.in(M(0.2, 0.44, 0), () => {
      // alembic: a fat glass belly on a tripod, its beak drooping to a little receiver
      g.surf(K_PLAIN, 0.2, 0, 1.1);
      g.in(M(0, 0.15, 0), () => g.add(new THREE.SphereGeometry(0.115, 14, 10, 0, TAU, Math.PI * 0.45, Math.PI * 0.55), rgb(0xe8a02a)));
      g.surf(K_PLAIN, 0.08, 0.2, 0.15);
      g.in(M(0, 0.15, 0), () => g.add(new THREE.SphereGeometry(0.118, 14, 10, 0, TAU, 0, Math.PI * 0.46), rgb(0xcfeee6)));
      g.tube([[0, 0.26, 0], [0.02, 0.33, 0], [0.09, 0.35, 0], [0.17, 0.27, 0.01], [0.21, 0.13, 0.02]], [0.04, 0.035, 0.03, 0.02, 0.012], 7, rgb(0xcfeee6), false);
      g.surf(K_PLAIN, 0.5, 0.85);
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; g.tube([[Math.cos(a) * 0.1, 0.1, Math.sin(a) * 0.1], [Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13]], 0.008, 4, IRON); }
      g.add(new THREE.TorusGeometry(0.1, 0.008, 4, 14).rotateX(Math.PI / 2).translate(0, 0.1, 0), IRON);
      g.in(M(0.22, 0, 0.02), () => flask(g, 0.045, rgb(0xe8a02a)));
    });
  });
  g.in(M(cx - 0.62, 0, cz + hz + 0.2), () => flask(g, 0.11, rgb(0x5ae84a)));
  // strange plants: glowing toadstools, a corkscrew vine in a pot, stalks with lantern fruit
  const rnd = rng(2790);
  for (const [x, z, sc] of [[-1.22, 1.12, 1], [-1.06, 1.26, 0.7], [-1.34, 1.3, 0.55], [-1.14, 0.96, 0.45], [1.26, -1.26, 0.8], [1.1, -1.34, 0.5]]) g.in(M(x, 0, z, (rnd() - 0.5) * 16, 0, (rnd() - 0.5) * 16, sc), () => {
    g.surf(K_PLAIN, 0.8);
    g.lathe([[0.035, 0], [0.026, 0.1], [0.022, 0.22]], 8, rgb(0xd8d0b8));
    g.surf(K_PLAIN, 0.5, 0, 0.9);
    g.lathe([[0.03, 0.2], [0.13, 0.21], [0.12, 0.26], [0.07, 0.32], [0, 0.34]], 12, (px, py, pz) => (noise3(px * 40, py * 40, pz * 40) > 0.68 ? rgb(0xf0f8f0) : mix(rgb(0x2ab8c8), rgb(0x4ae8d8), (py - 0.2) * 7)));
  });
  g.in(M(-0.2, 0, 1.2), () => {
    g.surf(K_PLAIN, 0.85);
    g.lathe([[0.07, 0], [0.11, 0.05], [0.12, 0.14], [0.1, 0.17], [0.11, 0.19], [0.08, 0.19]], 12, (x, y) => mul(rgb(0x9a5a3a), 0.8 + 0.3 * noise3(x * 30, y * 30, 1)));
    const cork = [];
    for (let i = 0; i <= 36; i++) { const t = i / 36, a = t * TAU * 3; cork.push([Math.cos(a) * 0.07 * (1 - t * 0.5), 0.17 + t * 0.62, Math.sin(a) * 0.07 * (1 - t * 0.5)]); }
    g.surf(K_LEAF, 0.8);
    g.tube(cork, cork.map((_, i) => 0.02 * (1 - (i / 36) * 0.7)), 6, (x, y) => mix(rgb(0x3a7a4a), rgb(0x8a4ac8), smooth(0.4, 0.8, y)), false);
    g.surf(K_PLAIN, 0.4, 0, 1.3);
    g.in(M(cork[36][0], cork[36][1] + 0.03, cork[36][2]), () => g.add(new THREE.SphereGeometry(0.045, 8, 6), rgb(0xe8c84a)));
  });
  for (const [x, z, h, lx] of [[1.3, 0.22, 0.75, 0.08], [1.2, 0.4, 0.55, -0.1], [1.36, 0.46, 0.42, 0.05]]) {
    g.surf(K_LEAF, 0.85);
    g.tube([[x, 0, z], [x + lx * 0.2, h * 0.5, z], [x + lx * 0.7, h * 0.9, z], [x + lx * 1.3, h, z], [x + lx * 1.7, h * 0.9, z]], [0.018, 0.015, 0.012, 0.01, 0.008], 5, rgb(0x3a6a3a), false);
    for (const q of [0.3, 0.55]) g.flat([[x + lx * 0.2 * q * 2, h * q, z], [x + lx * 0.2 + 0.1, h * q + 0.08, z + 0.07], [x + lx * 0.2 + 0.03, h * q + 0.16, z + 0.02]], [rgb(0x2f5a3a), rgb(0x4a8a4a), rgb(0x5aa85a)]);
    g.surf(K_PLAIN, 0.4, 0, 1.4);
    g.in(M(x + lx * 1.7, h * 0.9 - 0.06, z), () => g.add(new THREE.SphereGeometry(0.055, 8, 6).scale(1, 1.25, 1), rgb(0xff8a2a)));
  }
}

function temple(g, hex) {
  const st = stoneStyle(hex, { seed: 2800, len: [0.32, 0.58] }), r = st.r, col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 5), frame = mul(col, 0.98);
  const ncx = -0.7, nhx = 1.6, hz = 1.12, wallH = 2.0, eZ = hz + 0.2, eY = wallH - 0.02, rY = 3.5, plH = 2 * COURSE;
  const tcx = 1.5, thw = 0.66, tH = 3.9, oak = rgb(0x5a4028);
  const bays = [-1.065, -0.355, 0.355, 1.065], wW = 0.3, wV0 = 0.4, wH = 1.2;
  // ---- nave ----
  g.in(M(ncx, 0, 0), () => {
    const sideHoles = bays.map((x) => [nhx - r + x - wW / 2, wV0, nhx - r + x + wW / 2, wV0 + wH]);
    const eastHoles = [[hz - r - 0.14, 0.4, hz - r + 0.14, 1.6], [hz - r - 0.56, 0.4, hz - r - 0.32, 1.2], [hz - r + 0.32, 0.4, hz - r + 0.56, 1.2]];
    for (let s = 0; s < 4; s++) {
      const W = s % 2 ? hz : nhx, D = s % 2 ? nhx : hz;
      g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
        g.surf(K_STONE, 0.93);
        plinth(g, 2 * W, st, 2810 + s * 5, s % 2 === 1, 0.05, plH);
        g.in(M(-(W - r), plH, -r), () => {
          g.ashlar(2 * (W - r), wallH - plH, { ...st, seed: 2820 + s, ends: [CORNER, CORNER, 0, 0], quoin: [0.56, 0.3], holes: s === 3 ? eastHoles : s === 1 ? null : sideHoles });
          if (s === 3) {
            eastHoles.forEach((h, i) => g.in(M((h[0] + h[2]) / 2, h[1], 0), () => glassWindow(g, h[2] - h[0], h[3] - h[1], 2830 + i, { frame, glow: 0.6, nx: 4 })));
            g.in(M(0, wallH - plH, 0), () => { g.surf(K_STONE, 0.93); gableStone(g, W - r, rY - 0.1 - wallH, st, 2835); });
            g.in(M(W - r, wallH - plH + 0.5, r + 0.004), () => roseWindow(g, 0.24, 3, { frame, petals: 8 }));
          } else if (s === 1) { g.in(M(0, wallH - plH, 0), () => { g.surf(K_STONE, 0.93); gableStone(g, W - r, rY - 0.1 - wallH, st, 2836); }); }
          else sideHoles.forEach((h, i) => g.in(M((h[0] + h[2]) / 2, h[1], 0), () => glassWindow(g, wW, wH, 2840 + s * 9 + i, { frame, glow: 0.6, nx: 4 })));
        });
        g.surf(K_STONE, 0.93);
        if (s % 2 === 0) {
          // buttresses between the windows, in two stages; a corbel table under the eaves
          for (const x of [-1.42, -0.71, 0, 0.71, 1.4]) g.in(M(x, 0, 0), () => { buttress(g, 0.34, 0.34, 1.0, st, 2850 + s * 20 + x * 3, 0.22); buttress(g, 0.28, 0.2, 1.72, st, 2860 + s * 20 + x * 3, 0.26); });
          for (let i = 0; i < 16; i++) g.in(M(-nhx + 0.12 + i * ((2 * nhx - 0.24) / 15), wallH - 0.1, 0.03), () => g.cbox(0.09, 0.09, 0.06, 0.012, cc));
          band(g, [[0, wallH - 0.05], [0.07, wallH - 0.05], [0.07, wallH - 0.01], [0.05, wallH + 0.0]], 2 * W, mul(col, 1.05), 2870 + s);
        } else if (s === 3) for (const e of [-1, 1]) g.in(M(e * (hz - 0.14), 0, 0), () => buttress(g, 0.3, 0.15, 1.7, st, 2880 + e, 0.2));
      });
    }
    gableRoof(g, { x0: -nhx - 0.1, x1: nhx + 0.04, eZ, eY, rY, pal: SLATE, seed: 2890, tw: 0.17, th: 0.15, ridgeCol: LEAD });
    g.surf(K_STONE, 0.93);
    for (const e of [-1, 1]) g.beamTo([-nhx - 0.06, eY - 0.02, e * (eZ + 0.01)], [-nhx - 0.06, rY + 0.02, 0], 0.1, 0.14, 0.02, cc, 4);
    g.in(M(-nhx - 0.06, rY + 0.02, 0), () => { g.surf(K_STONE, 0.93); g.cbox(0.16, 0.12, 0.16, 0.02, cc); g.surf(K_PLAIN, 0.3, 0.92); g.in(M(0, 0.06, 0), () => { g.in(M(0, 0.17, 0), () => g.cbox(0.035, 0.34, 0.035, 0.008, GILT)); g.in(M(0, 0.22, 0), () => g.cbox(0.035, 0.035, 0.2, 0.008, GILT)); }); });
  });
  // ---- tower ----
  const A = archOf(0.3, 0.84, 0.36, 0.14), W2 = 2 * (thw - r), belfry = [[thw - r - 0.26, 3.0, thw - r - 0.06, 3.6], [thw - r + 0.06, 3.0, thw - r + 0.26, 3.6]];
  g.in(M(tcx, 0, 0), () => {
    stoneBox(g, thw, thw, 0, tH, st, 2900, { quoin: [0.5, 0.28], holes: [[[thw - r - 0.09, 1.6, thw - r + 0.09, 2.4], ...belfry], [...archHoles(A, thw - r, 0, 7, r), ...belfry], [[thw - r - 0.09, 1.6, thw - r + 0.09, 2.4], ...belfry], belfry], each: (s, W) => {
      for (const h of belfry) g.in(M((h[0] + h[2]) / 2, h[1], 0), () => {
        glassWindow(g, 0.2, 0.6, 5, { frame, glow: 0, plain: [0.03, 0.03, 0.035], nx: 1, mould: 0.016 });
        g.surf(K_WOOD, 0.9);
        for (let k = 0; k < 5; k++) g.in(M(0, 0.06 + k * 0.085, -0.012, 38, 0, 0), () => g.cbox(0.19, 0.012, 0.07, 0.003, mul(rgb(0x6a6258), 0.9 + 0.2 * hash1(k, s))));
      });
      if (s % 2 === 0) g.in(M(W - r, 1.6, 0), () => glassWindow(g, 0.18, 0.8, 2910 + s, { frame, glow: 0.6, nx: 2, mould: 0.018 }));
      if (s === 1) {
        // the west door under its rose
        g.in(M(W - r, 0, 0), () => {
          g.surf(K_STONE, 0.93);
          voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, 9, st, 2920, 0.016);
          archReveal(g, A, 0.16, col);
          g.in(M(0, 0, -0.13), () => archDoors(g, A, oak, 3, 0.05, 5));
          g.surf(K_STONE, 0.93);
          for (const e of [-1, 1]) g.in(M(e * (A.half + 0.1), 0, 0.03), () => column(g, 0.05, A.spring + 0.02, mul(col, 1.05), e, 10));
          g.in(M(0, 2.02, r + 0.004), () => roseWindow(g, 0.34, 1, { frame }));
        });
      }
      g.surf(K_STONE, 0.93);
    } });
    for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, thw)), () => {
      g.surf(K_STONE, 0.93);
      if (s !== 3 && s !== 1) band(g, [[0.05, plH - 0.062], [0.05, plH - 0.02], [0.004, plH + 0.03]], 2 * thw, mul(col, 1.03), 2930 + s, 1, 1);
      for (const y of [2.72, tH - 0.06]) band(g, [[0, y - 0.09], [0.04, y - 0.05], [0.05, y], [0.03, y + 0.03], [0, y + 0.04]], 2 * thw, mul(col, 1.05), 2940 + s + y, 1, 1);
      for (let i = 0; i < 7; i++) g.in(M(-thw + 0.1 + i * ((2 * thw - 0.2) / 6), tH - 0.18, 0.025), () => g.cbox(0.08, 0.08, 0.05, 0.012, cc));
      // low pierced parapet between the corner pinnacles
      g.in(M(0, tH, -0.05), () => { g.in(M(0, 0.1, 0), () => g.cbox(2 * thw - 0.3, 0.2, 0.08, 0.014, cc)); for (let i = 0; i < 4; i++) g.in(M(-0.36 + i * 0.24, 0.26, 0), () => g.cbox(0.1, 0.13, 0.08, 0.014, cc)); });
    });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * (thw - 0.05), tH, sz * (thw - 0.05)), () => {
      g.surf(K_STONE, 0.93);
      g.in(M(0, 0.2, 0), () => g.cbox(0.2, 0.4, 0.2, 0.016, cc));
      g.in(M(0, 0.4, 0), () => g.lathe([[0.15, 0], [0.15, 0.03], [0.1, 0.06], [0, 0.5]], 4, cc, Math.PI / 4, TAU + Math.PI / 4));
      g.in(M(0, 0.86, 0), () => finial(g, 0.16));
    });
    // spire
    g.in(M(0, tH + 0.06, 0), () => { pyramidRoof(g, thw - 0.1, 1.5, SLATE, 2950, { tw: 0.13, th: 0.14 }); g.in(M(0, 1.44, 0), () => { finial(g, 0.3); g.surf(K_PLAIN, 0.3, 0.92); g.in(M(0, 0.4, 0), () => g.cbox(0.03, 0.26, 0.03, 0.008, GILT)); g.in(M(0, 0.44, 0), () => g.cbox(0.16, 0.03, 0.03, 0.008, GILT)); }); });
    // steps up to the door
    g.surf(K_STONE, 0.93);
    for (let k = 0; k < 3; k++) g.in(M(thw + 0.06 + k * 0.1, -0.05 + (2 - k) * 0.035, 0), () => g.cbox(0.12 + 0.0, 0.1 + (2 - k) * 0.07, 1.2 - k * 0.0, 0.014, stoneTint(mul(col, 0.92 + k * 0.04), k + 3, 5)));
    for (const e of [-1, 1]) g.in(M(thw + 0.02, 1.25, e * 0.5, 0, 90, 0, 0.7), () => cresset(g));
  });
}

function palace(g, f, hex) {
  const st = stoneStyle(hex, { seed: 3000, len: [0.34, 0.62], cell: 0.15 / qual(), var: 0.08, chip: 0.05, r: 0.011, b: 0.011, rough: 0.005, bump: 0.5 }), r = st.r, col = st.pal[0], cc = stoneTint(mul(col, 1.05), 4, 5), trim = mul(col, 1.08);
  const hx = 2.72, cz = -0.56, hz = 1.7, top = 3.0, plH = 2 * COURSE, fz = cz + hz, az = fz + 0.72, ax = 2.2, bal = 1.8;
  const glass = [rgb(0x7fb0d8), rgb(0x9fc8e8), rgb(0x6f9ac8), rgb(0xe8c880), rgb(0x8fb8d8)], frame = mul(col, 1.04);
  const WG = { frame, pointed: false, pal: glass, glow: 0.3, nx: 2, mould: 0.02 };
  const sideX = [-0.74, 0, 0.74], backX = [-1.85, -1.11, -0.37, 0.37, 1.11, 1.85], bayX = [-1.68, -0.84, 0, 0.84, 1.68];
  const A2 = archOf(0.36, 1.0, 0.3, 0.12);
  const winHoles = (W, xs, lo = true) => xs.flatMap((x) => [...(lo ? [[W - r + x - 0.18, 0.4, W - r + x + 0.18, 1.2]] : []), [W - r + x - 0.18, 1.4, W - r + x + 0.18, 2.4]]);
  // ---- main block ----
  g.in(M(0, 0, cz), () => {
    for (let s = 0; s < 4; s++) {
      const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz, xs = s === 0 ? bayX : s === 2 ? backX : sideX;
      g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
        g.surf(K_STONE, 0.93);
        if (s) plinth(g, 2 * W, st, 3010 + s * 5, false, 0.05, plH);
        const holes = s === 0 ? [...winHoles(W, bayX, false), ...winHoles(W, [-1.68, -0.84, 0.84, 1.68]).filter((h) => h[1] < 1), ...archHoles(A2, W - r, plH, 6, r)] : winHoles(W, xs);
        g.in(M(-(W - r), plH, -r), () => {
          g.ashlar(2 * (W - r), top - plH, { ...st, seed: 3020 + s, ends: [CUT, CUT, 0, 0], holes });
          for (const h of holes) if (h.length === 4) g.in(M((h[0] + h[2]) / 2, h[1], 0), () => glassWindow(g, 0.36, h[3] - h[1], 3030 + s * 40 + Math.round(h[0] * 7) + Math.round(h[1] * 3), WG));
          if (s === 0) g.in(M(W - r, -plH, 0), () => {
            g.surf(K_STONE, 0.93);
            voussoirs(g, A2.cy, A2.ri, A2.re, A2.a0, A2.a1, 9, st, 3040, 0.014);
            archReveal(g, A2, 0.16, col, plH);
            g.in(M(0, plH, -0.12), () => g.in(new THREE.Matrix4().makeScale(1, (A2.spring - plH) / A2.spring, 1), () => archDoors(g, { ...A2, y: (x) => A2.y(x) * A2.spring / (A2.spring - plH) - plH * A2.spring / (A2.spring - plH) }, rgb(0x6a4428), 3, 0.05, 5)));
          });
        });
        g.surf(K_STONE, 0.93);
        band(g, [[0, 1.6], [0.035, 1.63], [0.035, 1.7], [0, 1.73]], 2 * W, trim, 3050 + s);
        band(g, [[0, top - 0.16], [0.05, top - 0.1], [0.06, top - 0.04], [0.13, top], [0.14, top + 0.06], [0.12, top + 0.08]], 2 * W, trim, 3060 + s);
        for (let i = 0, n = Math.round(W / 0.11); i < n; i++) g.in(M(-W + 0.1 + i * ((2 * W - 0.2) / (n - 1)), top - 0.2, 0.03), () => g.cbox(0.08, 0.07, 0.06, 0.012, cc));
      });
    }
    hipRoof(g, hx + 0.16, hz + 0.16, top + 0.08, 3.98, hx - hz, BLUE_SLATE, 3070, { tw: 0.2, th: 0.17, ridgeCol: GILT, ridgeMetal: 0.9 });
    for (const e of [-1, 1]) g.in(M(e * 2.0, 0, 0), () => chimney(g, 0.2, 0.14, 3.3, 4.5, hex, 3080 + e, 2));
    // ---- the great hall: a square lantern storey carrying the dome ----
    const dh = 1.2, d0 = 3.3, d1 = 4.42, DR = 1.24;
    stoneBox(g, dh, dh, d0, d1, st, 3090, { noFoot: true, quoin: [0.5, 0.3], holes: [0, 1, 2, 3].map(() => [-0.62, 0, 0.62].map((x) => [dh - r + x - 0.14, 0.4, dh - r + x + 0.14, 1.0])), each: (s, W) => {
      for (const x of [-0.62, 0, 0.62]) g.in(M(W - r + x, 0.4, 0), () => glassWindow(g, 0.28, 0.6, 3100 + s * 5 + x * 3, { ...WG, glow: 0.5 }));
      g.surf(K_STONE, 0.93);
    } });
    for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, dh)), () => {
      g.surf(K_STONE, 0.93);
      band(g, [[0, d1 - 0.12], [0.05, d1 - 0.07], [0.06, d1 - 0.02], [0.12, d1 + 0.02], [0.12, d1 + 0.07], [0.09, d1 + 0.09]], 2 * dh, trim, 3110 + s, 1, 1);
      for (const x of [-0.93, -0.31, 0.31, 0.93]) g.in(M(x, (d0 + d1) / 2 + 0.2, 0.02), () => g.cbox(0.14, d1 - d0 - 0.52, 0.05, 0.014, cc));
    });
    g.surf(K_STONE, 0.93);
    g.lathe([[DR + 0.0, d1 + 0.09], [DR + 0.0, d1 + 0.2], [DR - 0.04, d1 + 0.22]], 40, cc);
    const dy = d1 + 0.2, dH = 1.2, dome = (v) => { const a = v * Math.PI * 0.48; return [(DR - 0.06) * Math.cos(a) * (1 + 0.07 * Math.sin(2 * a)), dy + dH * Math.sin(a) / Math.sin(Math.PI * 0.48)]; };
    g.surf(K_ROOF, 0.6);
    tiles(g, 10, (j) => 46 * (dome((j + 0.5) / 10)[0] / DR) + 3, (u, v) => { const [rr, y] = dome(Math.min(v, 0.99)), a = u * TAU; return [Math.cos(a) * rr, y, Math.sin(a) * rr]; }, { pal: BLUE_SLATE, lift: 0.02, wrap: true, seed: 3120 });
    g.surf(K_PLAIN, 0.3, 0.92);
    for (let i = 0; i < 8; i++) g.in(M(0, 0, 0, 0, i * 45 + 22.5, 0), () => { const pts = []; for (let k = 0; k <= 10; k++) { const [rr, y] = dome(k / 10); pts.push([rr + 0.02, y + 0.01, 0]); } g.tube(pts, 0.03, 6, GILT, false); });
    // cupola and finial
    g.in(M(0, dy + dH - 0.03, 0), () => {
      g.surf(K_STONE, 0.9);
      g.lathe([[0.3, 0], [0.3, 0.05], [0.22, 0.07], [0.22, 0.34], [0.3, 0.37], [0.3, 0.41]], 16, cc);
      g.surf(K_PLAIN, 0.3, 0, 0.9);
      for (let i = 0; i < 8; i++) g.in(M(0, 0, 0, 0, i * 45, 0), () => g.flat([[-0.055, 0.1, 0.224], [0.055, 0.1, 0.224], [0.055, 0.28, 0.224], [0, 0.32, 0.224], [-0.055, 0.28, 0.224]], [1.0, 0.78, 0.36]));
      g.surf(K_PLAIN, 0.3, 0.92);
      g.lathe([[0.31, 0.41], [0.26, 0.5], [0.14, 0.6], [0.05, 0.64]], 16, GILT);
      g.in(M(0, 0.62, 0), () => finial(g, 0.34));
    });
  });
  // a gabled frontispiece over the middle of the front, the arms of the house in gold; dormers either side
  g.in(M(0, 0, fz + 0.06), () => {
    const pw = 0.86, py = top + 0.1, pa = py + 0.62;
    g.surf(K_STONE, 0.93);
    g.flat([[-pw, py, 0.1], [pw, py, 0.1], [0, pa, 0.1]], [mul(col, 0.95), mul(col, 0.95), mul(col, 1.05)]);
    for (const e of [-1, 1]) { g.beamTo([e * (pw + 0.07), py - 0.03, 0.06], [0, pa + 0.04, 0.06], 0.09, 0.2, 0.016, cc, 3); g.surf(K_ROOF, 0.8); tiles(g, 4, () => 6, (u, v) => [e * lerp(pw + 0.04, 0, v), lerp(py, pa + 0.03, v), e > 0 ? lerp(0.0, -0.95, u) : lerp(-0.95, 0.0, u)], { pal: BLUE_SLATE, lift: 0.018, seed: 3085 + e }); g.surf(K_STONE, 0.93); }
    g.in(M(0, py - 0.03, 0.08), () => g.cbox(2 * pw + 0.16, 0.08, 0.16, 0.016, cc));
    g.in(M(0, py + 0.24, 0.104), () => {
      g.surf(K_PLAIN, 0.3, 0.92);
      g.add(new THREE.ExtrudeGeometry(new THREE.Shape([[-0.13, 0.15], [0.13, 0.15], [0.13, -0.02], [0, -0.17], [-0.13, -0.02]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.03, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014, bevelSegments: 2 }), GILT);
      g.surf(K_PLAIN, 0.5);
      g.in(M(0, 0.0, 0.05), () => { g.cbox(0.19, 0.045, 0.012, 0.004, rgb(0x2f4a9a)); g.cbox(0.045, 0.24, 0.012, 0.004, rgb(0x2f4a9a)); });
    });
    g.in(M(0, pa + 0.05, 0.06), () => finial(g, 0.26));
  });
  for (const x of [-1.75, 1.75]) g.in(M(x, top + 0.08 + 0.3 * ((3.98 - top - 0.08) / (hz + 0.16)), fz + 0.16 - 0.3), () => dormer(g, 0.46, 0.36, 0.6, 0.75, BLUE_SLATE, rgb(0x8a8272), 3087 + x, true));
  // ---- corner turrets ----
  const TR = 0.62, tT = 4.0;
  [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(([sx, sz], ti) => g.in(M(sx * hx, 0, cz + sz * hz, 0, Math.atan2(sx, sz) / DEG, 0), () => {
    const circ = (TR - r) * TAU, loops = [[circ * 0.0 - 0.07, 0.8, circ * 0.0 + 0.07, 1.4], [circ * 0.12 - 0.07, 2.0, circ * 0.12 + 0.07, 2.6], [circ * 0.88 - 0.07, 2.0, circ * 0.88 + 0.07, 2.6], [-0.09, 3.0, 0.09, 3.6]];
    const wrapH = loops.map((h) => (h[0] < 0 ? [h[0] + circ, h[1], h[2] + circ, h[3]] : h));
    g.surf(K_STONE, 0.93);
    g.bend(TR - r, () => {
      g.in(M(0, plH, 0), () => g.ashlar(circ, tT - plH, { ...st, seed: 3200 + ti, wrap: true, holes: wrapH.map((h) => [h[0], h[1] - plH, h[2], h[3] - plH]) }));
      loops.forEach((h, i) => { if (i === 3) g.in(M(0, h[1], 0), () => glassWindow(g, 0.18, 0.6, 7, { ...WG, nx: 1, glow: 0.5 })); else g.in(M(h[0], h[1], 0), () => arrowLoop(g, 0.14, 0.6, st)); });
    });
    g.bend(TR + 0.05 - r, () => g.ashlar((TR + 0.05 - r) * TAU, plH - 0.06, { ...st, seed: 3210 + ti, len: [0.4, 0.7], wrap: true }));
    g.lathe([[TR + 0.05, plH - 0.062], [TR + 0.004, plH + 0.012]], 32, cc);
    g.lathe([[TR + 0.046, -0.16], [TR + 0.046, 0.003]], 32, mul(col, 0.5));
    g.lathe([[TR, 1.6], [TR + 0.035, 1.63], [TR + 0.035, 1.7], [TR, 1.73]], 32, stoneTint(trim, 3));
    for (let i = 0; i < 16; i++) g.in(M(0, 0, 0, 0, i * 22.5, 0), () => { g.in(M(0, tT - 0.085, TR + 0.045), () => g.cbox(0.1, 0.07, 0.09, 0.012, cc)); g.in(M(0, tT - 0.15, TR + 0.025), () => g.cbox(0.09, 0.07, 0.05, 0.012, cc)); });
    g.lathe([[TR, tT - 0.052], [TR + 0.11, tT - 0.052], [TR + 0.12, tT + 0.02], [TR + 0.1, tT + 0.05], [TR + 0.02, tT + 0.07]], 36, stoneTint(trim, 5));
    g.in(M(0, tT + 0.07, 0), () => coneRoof(g, TR + 0.14, 1.62, BLUE_SLATE, 3220 + ti, { bell: 0.12, tw: 0.16 }));
    g.in(M(0, tT + 0.07 + 1.5, 0), () => { finial(g, 0.34); if (sz > 0) g.in(M(0, 0.3, 0, 0, -Math.atan2(sx, sz) / DEG, 0), () => sidePennant(g, f, 0.75, 0.62, 0.26)); });
  }));
  // ---- arcade, balcony and the stair ----
  const A = archOf(0.29, 1.12, 0.29, 0.1), aw = 2 * (ax - r);
  g.in(M(0, 0, az), () => {
    g.surf(K_STONE, 0.93);
    plinth(g, 2 * ax, st, 3300, true, 0.05, plH);
    g.in(M(-(ax - r), plH, -r), () => g.ashlar(aw, bal - plH, { ...st, seed: 3310, ends: [CORNER, CORNER, 0, 0], quoin: [0.3, 0.2], holes: bayX.flatMap((x) => archHoles(A, ax - r + x, plH, 7, r)) }));
    for (const x of bayX) g.in(M(x, 0, 0), () => {
      g.surf(K_STONE, 0.93);
      g.in(M(0, 0, -r), () => voussoirs(g, A.cy, A.ri, A.re, A.a0, A.a1, 9, st, 3320 + x * 5, 0.012));
      archReveal(g, A, 0.2, col, plH, true);
    });
    for (let i = 0; i <= 5; i++) g.in(M(-2.1 + i * 0.84, plH, 0.06), () => column(g, 0.07, A.spring - plH + 0.06, trim, i, 12));
    band(g, [[0, bal - 0.14], [0.05, bal - 0.1], [0.08, bal - 0.03], [0.08, bal + 0.02], [0.06, bal + 0.04]], 2 * ax, trim, 3330, 1, 1);
    g.in(M(0, bal + 0.04, -0.02), () => balustrade(g, -ax + 0.04, ax - 0.04, 0.34, trim, 3));
    for (const x of [-ax + 0.02, -0.84 - 0.42, 0.84 + 0.42, ax - 0.02]) g.in(M(x, bal + 0.04, -0.02), () => { g.surf(K_STONE, 0.9); g.in(M(0, 0.2, 0), () => g.cbox(0.15, 0.4, 0.15, 0.014, cc)); g.in(M(0, 0.4, 0), () => finial(g, 0.2)); });
  });
  for (const e of [-1, 1]) g.in(M(e * ax, 0, (fz + az) / 2, 0, e * 90, 0), () => {
    g.surf(K_STONE, 0.93);
    g.in(M(-(az - fz) / 2 + (e > 0 ? r : 0), plH, -r), () => g.ashlar(az - fz - r, bal - plH, { ...st, seed: 3340 + e, ends: e > 0 ? [CORNER, CUT, 0, 0] : [CUT, CORNER, 0, 0] }));
    plinth(g, az - fz, st, 3345 + e, false, 0.05, plH);
    band(g, [[0, bal - 0.14], [0.05, bal - 0.1], [0.08, bal - 0.03], [0.08, bal + 0.02], [0.06, bal + 0.04]], az - fz, trim, 3350 + e);
    g.in(M(0, bal + 0.04, -0.02), () => balustrade(g, -(az - fz) / 2 + 0.02, (az - fz) / 2 - 0.1, 0.34, trim, 5 + e));
  });
  const pv = pave(hex, 3360, { course: 0.36, len: [0.3, 0.5] });
  g.surf(K_STONE, 0.95);
  g.in(M(-ax, bal + 0.04 - pv.r, az, -90, 0, 0), () => g.ashlar(2 * ax, az - fz, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
  g.in(M(-ax, plH - pv.r, az, -90, 0, 0), () => g.ashlar(2 * ax, az - fz, { ...pv, seed: 3361, ends: [CUT, CUT, CUT, CUT] }));
  g.surf(K_PLAIN, 1);
  g.flat([[-ax, bal - 0.16, fz], [ax, bal - 0.16, fz], [ax, bal - 0.16, az - 0.02], [-ax, bal - 0.16, az - 0.02]], mul(col, 0.22));
  g.shade(-ax, plH, fz - 0.05, ax, bal - 0.1, az - 0.1, 0.3, 0.15, [1, 1]);
  // the stair: broad flights between cheek blocks
  const sw = 1.34, steps = 5, rise = plH / (steps + 1), run = 0.185;
  for (let k = 0; k < steps; k++) { const y = plH - (k + 1) * rise, z0 = az + 0.05 + k * run; g.surf(K_STONE, 0.93); g.in(M(0, (y - 0.12) / 2, z0 + run / 2 + 0.02), () => g.cbox(2 * sw, y + 0.12, run + 0.04, 0.012, stoneTint(mul(col, 0.9 + 0.03 * (k % 2)), k, 4))); }
  for (const e of [-1, 1]) g.in(M(e * (sw + 0.14), 0, az + 0.5), () => {
    g.surf(K_STONE, 0.93);
    g.in(M(0, 0.2, 0), () => g.cbox(0.3, 0.64, 1.0, 0.02, cc));
    g.in(M(0, 0.54, 0), () => g.cbox(0.36, 0.06, 1.06, 0.016, stoneTint(trim, 3)));
    g.in(M(0, 0.57, 0.36), () => { g.lathe([[0.07, 0], [0.1, 0.03], [0.05, 0.08], [0.11, 0.16], [0.13, 0.24], [0.11, 0.3], [0.13, 0.32], [0.1, 0.34], [0, 0.34]], 14, cc); g.in(M(0, 0.33, 0), () => finial(g, 0.2)); });
  });
  // banners in the side's colour hang from the balcony
  for (const x of [-1.26, 1.26]) g.in(M(x, bal + 0.02, az + 0.1), () => sideBanner(g, f, 0.46, 1.0, x));
  for (const e of [-1, 1]) g.in(M(e * 0.6, 1.25, fz), () => lantern(g));
}

// =====================================================================================================
// exports
// =====================================================================================================
export const structures = {
  /** raised platforms w x h tiles (each 4 to 60): flagged top flat and clear at exactly y = 0.8 (terrace) or 1.6 (terraceHigh) */
  terrace: (def, w, h, place) => struct(`terrace|${w}|${h}|${def.color}`, false, place, (g) => terrace(g, w, h, 1, def.color)),
  terraceHigh: (def, w, h, place) => struct(`terraceHigh|${w}|${h}|${def.color}`, false, place, (g) => terrace(g, w, h, 2, def.color)),
  /** timber walkway, 1 wide, 2 to 40 long: plank tops exactly at y = 1.6, ends flush with the footprint */
  walkway: (def, w, h, place) => longways(def, w, h, place, (g, f, L) => walkway(g, L, def.color)),
  /** stone bridge, 2 wide, 4 to 40 long: deck exactly at y = 0.8, a ramp on the first and last tile, piers down to y = -1.4 */
  stoneBridge: (def, w, h, place) => longways(def, w, h, place, (g, f, L) => stoneBridge(g, L, def.color)),
  /** rail viaduct, 1 wide, 4 to 40 long: bed exactly at y = 1.6 */
  viaduct: (def, w, h, place) => longways(def, w, h, place, (g, f, L) => viaduct(g, L, def.color)),
  /** cable car pylon, 2 x 2; userData.cableAt = [0, height of the wheel hub, 0] */
  cableTower: (def, w, h, place) => struct(`cableTower|${def.color}`, false, place, (g, f) => cableTower(g, f, def.color)),
  /** open-sided market hall, 4 x 3 */
  marketHall: (def, w, h, place) => longways(def, w, h, place, (g) => marketHall(g, def.color)),
  /** bank, 3 x 3: portico and door toward +Z */
  bank: (def, w, h, place) => struct(`bank|${def.color}`, false, place, (g) => bank(g, def.color)),
  /** inn, 4 x 3: door and sign toward +Z, stable lean-to at the +X end */
  inn: (def, w, h, place) => longways(def, w, h, place, (g) => inn(g, def.color)),
  /** dock house, 4 x 3: loading doors toward +Z, hoist over the yard at the +X end */
  dockhouse: (def, w, h, place) => longways(def, w, h, place, (g, f) => dockhouse(g, f, def.color)),
  /** barracks, 5 x 3: door, stair, rack and drill post toward +Z */
  barracks: (def, w, h, place) => longways(def, w, h, place, (g, f) => barracks(g, f, def.color)),
  /** alchemist's laboratory, 3 x 3, facing +Z */
  alchemist: (def, w, h, place) => struct(`alchemist|${def.color}`, false, place, (g) => alchemist(g, def.color)),
  /** temple, 4 x 5 (modelled 5 long along X and turned): nave, tower and spire at the door end */
  temple: (def, w, h, place) => longways(def, w, h, place, (g) => temple(g, def.color)),
  /** palace, 7 x 6: arcade, balcony and stair toward +Z */
  palace: (def, w, h, place) => longways(def, w, h, place, (g, f) => palace(g, f, def.color)),
  /** market stall, 2 x 1: awning in def.color, open toward +Z (+X when turned) */
  stall: (def, w, h, place) => longways(def, w, h, place, (g) => stall(g, def.color)),
  /** tiered fountain, 2 x 2 */
  fountain: (def, w, h, place) => struct(`fountain|${def.color}`, false, place, (g) => fountain(g, def.color)),
  /** wayside shrine, 2 x 2, facing +Z */
  shrine: (def, w, h, place) => struct(`shrine|${def.color}`, false, place, (g) => shrine(g, def.color)),
  /** garden, 3 x 3: everything under 0.45 except the four corner trees */
  garden: (def, w, h, place) => struct(`garden|${def.color}`, false, place, (g) => garden(g, def.color)),
  /** graveyard, 4 x 4: low wall, stones under 0.6, a tomb and a dead tree in two corners */
  graveyard: (def, w, h, place) => struct(`graveyard|${def.color}`, false, place, (g) => graveyard(g, def.color)),
};

/** cableCar(sideColorHex) -> the gondola, origin where its grip meets the cable (cable along X), cabin hanging below */
export function cableCar(sideColorHex = 0x3d7bd9) { return cached(`cableCar:${sideColorHex}`, () => finish((() => { const g = new Geo(); gondola(g, sideColorHex); return g; })())); }
