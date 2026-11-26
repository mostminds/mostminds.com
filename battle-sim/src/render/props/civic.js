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
    g.surf(K_PLAIN, 1, 0, 1.8);
    const fl = (x, y) => (y > 0.16 ? [1.0, 0.42, 0.05] : y > 0.07 ? [1.0, 0.62, 0.1] : [1.0, 0.85, 0.3]);
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
function ladder(g, a, b, wide, step, wood, seed) {
  const f = along(a, b);
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
    const hsh = hash1(seed + i * 7, j * 13 + 1), c = o.plain ? mul(o.plain, 0.75 + 0.5 * hsh) : mul(pal[Math.floor(hash1(seed + i * 3, j * 5) * pal.length) % pal.length], 0.7 + 0.6 * hsh);
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
    const c = mul(pal[(i * (k + 2) + k * 3 + seed) % pal.length], 0.8 + 0.4 * hash1(seed + i, k));
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
    g.in(M(Math.cos(a) * d, h * 0.82 + (1 - d / r) * r * 0.36 + rnd() * 0.01, Math.sin(a) * d), () => g.add(new THREE.SphereGeometry(s, 7, 5), mul(c, 0.8 + 0.4 * rnd())));
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
function smoke(g, s = 1, seed = 0) {
  const P = [], rnd = rng(seed + 5);
  for (let i = 0; i < 6; i++) { const t = i / 5; P.push(S.sphere((0.05 + 0.075 * t) * s).at((0.03 + 0.22 * t * t) * s + (rnd() - 0.5) * 0.04 * s, (0.06 + 0.5 * t) * s, (rnd() - 0.5) * 0.08 * s * t).color(i < 2 ? 0x77756f : 0xa9a7a0).pbr(1).blend(0.05 * s)); }
  g.surf(K_PLAIN, 1);
  g.sculpt({ prims: P }, 30, 0.2);
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
      const nb = Math.max(1, Math.round(n / (big === 2 ? 6 : 4))), bx = [], dx = [];
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
        g.in(M(0, top, 0), () => lowWall(g, cl ? x0 + r : x0 + r + 0.012, cr ? x1 - r : x1 - r - 0.012, ps, 1250 + s * 30 + k * 5, { t: PT, h: PH, inL: cl ? PT : 0, inR: cr ? PT : 0, len: big ? [0.4, 0.8] : [0.26, 0.5], capLen: big ? 1.4 : 0.8 }));
      });
    });
  }
  // the top: flags laid in courses, their faces exactly on the level
  const fl = clamp(Math.sqrt((w * h) / 1500), 0.4, 1.3), rows = Math.max(2, Math.round(h / fl));
  const pv = pave(hex, 1290 + level, { course: h / rows, len: [fl * 0.85, fl * 1.6], cell: Math.max(0.16, fl * 0.9) / qual(), chip: big ? 0 : 0.06 });
  g.surf(K_STONE, 0.95);
  g.in(M(-w / 2, top - pv.r, h / 2, -90, 0, 0), () => g.ashlar(w, h, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
}

/** a spindly timber walkway L tiles long and one wide; the tops of its planks are exactly two levels up */
function walkway(g, L, hex) {
  const wood = rgb(hex), tb = tbOf(wood), top = 2 * LEVEL_H, rnd = rng(1300 + L * 7);
  const nb = Math.max(2, Math.round(L / 2) + 1), capY = top - 0.045 - 0.06 - 0.045;
  const pole = { seg: 8, bark: mul(wood, 0.62), amp: 0.09 };
  for (let i = 0; i < nb; i++) {
    const x = lerp(-L / 2 + 0.16, L / 2 - 0.16, i / (nb - 1)), lean = (hash1(i, L + 3) - 0.5) * 0.05;
    for (const e of [-1, 1]) {
      g.surf(K_STONE, 0.95);
      g.in(M(x + lean, -0.06, e * 0.43), () => g.cbox(0.2, 0.18, 0.2, 0.025, stoneTint(rgb(0x85807a), i + e)));
      logTo(g, [x + lean, 0, e * 0.43], [x, capY + 0.02, e * 0.3], 0.042, 0.034, i * 3 + e, pole);
      g.in(M(x, capY - 0.06, e * 0.305), () => lashing(g, 0.045, 3, 0.009));
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
    g.in(M(-L / 2 + pw * (i + 0.5), top - 0.0225, off, 0, 90, 0), () => g.beam(Math.min(len, 1 - 2 * Math.abs(off)), 0.045, pw - 0.012, 0.006, tb(50 + i, 0.85 + 0.3 * rnd()), 2));
    g.surf(K_PLAIN, 0.6, 0.8);
    for (const e of [-1, 1]) g.in(M(-L / 2 + pw * (i + 0.5), top - 0.002, e * 0.3, -90, 0, 0), () => g.stud(0.008, IRON, 5, 0.25));
  }
  // rope handrails on short posts, at the edges only
  for (const e of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= L; i++) {
      const x = clamp(-L / 2 + i, -L / 2 + 0.035, L / 2 - 0.035), hh = 0.32 + 0.02 * hash1(i, e + 5);
      g.surf(K_WOOD, 0.9);
      g.beamTo([x, top - 0.14, e * 0.475], [x + (hash1(i, e + 9) - 0.5) * 0.03, top + hh, e * 0.478], 0.035, 0.035, 0.007, tb(60 + i + e, 0.72), 2);
      g.in(M(x, top - 0.1, e * 0.455, 0, 0, 0), () => g.cbox(0.05, 0.03, 0.05, 0.006, tb(70 + i, 0.7)));
      if (i) for (let k = 1; k <= 5; k++) { const t = k / 6, x0 = clamp(-L / 2 + i - 1, -L / 2 + 0.035, L / 2 - 0.035); pts.push([lerp(x0, x, t), top + 0.29 - 0.085 * Math.sin(Math.PI * t), e * 0.478]); }
      pts.push([x, top + hh - 0.03, e * 0.478]);
    }
    rope(g, pts, 0.009);
  }
  g.shade(-L / 2, top - 0.5, -0.5, L / 2, top - 0.05, 0.5, 0.3, 0.1, [1, 1]);
}

/** an arched stone bridge L tiles long and two wide: deck exactly one level up, a ramp on the first and last tile, piers down to the river bed */
function stoneBridge(g, L, hex) {
  const top = LEVEL_H, bed = -1.4, hz = 1, big = L > 20 ? 2 : L > 9 ? 1 : 0;
  const st = stoneStyle(hex, { seed: 1400, cell: [0.1, 0.15, 0.22][big] / qual(), len: big ? [0.4, 0.75] : [0.32, 0.6], chip: 0.12 });
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
  const pv = pave(hex, 1490, { course: 0.4, len: [0.36, 0.62], cell: (big ? 0.3 : 0.16) / qual() });
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
  const st = stoneStyle(hex, { seed: 1500, cell: [0.1, 0.15, 0.22][big] / qual(), len: [0.3, 0.56] });
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
      g.in(M((a + b) / 2, 0.09, 0.02), () => g.cbox(b - a + (eL ? 0.05 : 0) + (eR ? 0.05 : 0), 0.2, 0.08, 0.014, stoneTint(col, i + s)));
      g.in(M((a + b) / 2, A.spring - 0.035, 0.012), () => g.cbox(b - a + (eL ? 0.06 : 0) + (eR ? 0.06 : 0), 0.07, 0.06, 0.012, stoneTint(col, i + s + 3)));
      footing(g, a - 0.03, b + 0.03, st.pal[0], 0.06);
    }
    band(g, [[0, top - 0.17], [0.045, top - 0.13], [0.045, top - 0.035], [0, top - 0.004]], L, col, 1530 + s, 0, 0, true, true);
    // kerb along the edge of the bed
    for (let k = 0, nk = Math.round(L / 0.5); k < nk; k++) g.in(M(-L / 2 + ((k + 0.5) * L) / nk, top + 0.03, -0.045), () => g.cbox(L / nk - 0.006, 0.06, 0.09, 0.012, stoneTint(mul(col, 0.92 + 0.14 * hash1(k, s)), k)));
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
  const ns = Math.round(L / 0.25), wood = rgb(0x5a4632), tb = tbOf(wood);
  for (let i = 0; i < ns; i++) {
    g.surf(K_WOOD, 0.92);
    g.in(M(-L / 2 + ((i + 0.5) * L) / ns, top - 0.019, 0, 0, 90, 0), () => g.beam(0.72 + 0.04 * hash1(i, 3), 0.04, 0.11, 0.004, tb(i, 0.9), 2));
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
