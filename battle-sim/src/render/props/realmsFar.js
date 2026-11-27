// Landmark buildings of the far realms: sixteen showpieces, two for each of eight realms.
//
//   structures[def.model](def, w, h, place) -> Mesh centred on its footprint, resting on y = 0
//       gorge           gorge_mammothYurt gorge_gorgeAltar                westmark      westmark_canalHouse westmark_exchange
//       principalities  principalities_villa principalities_bellTower     sunkings      sunkings_baroqueChurch sunkings_aqueduct
//       caliphate       caliphate_minaret caliphate_bazaar                shogunate     shogunate_tenshu shogunate_torii
//       mistisles       mistisles_megaliths mistisles_roundHut            thousandgods  thousandgods_carvedTemple thousandgods_stepwell
//
// Built like factions.js and with the same construction kit (repeated here because that module keeps it private):
// everything is emitted into one vertex-coloured geometry for the shared sculpt material, built once per model and
// detail preset; every placement shares it (a piece placed turned shares a turned copy). Nothing is built at module
// load and nothing here calls Math.random(): every shape is seeded. Fronts face +Z.
import * as THREE from 'three';
import { S, H, rgb, noise3, fbm3, cells3, buildPartGeometry, sculptMaterial } from '../sculpt.js';
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
    this.rough = 0.9; this.metal = 0; this.glow = 0; this.kind = K_PLAIN; this.shades = []; this.moss = 1;
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
          const green = clamp(damp * 0.7 + (ny > 0.4 ? 0.2 * smooth(0.55, 0.8, noise3(x * 3.1, y * 3.1 + 9, z * 3.1)) : 0), 0, 0.65) * this.moss;
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
          const green = ny > 0.2 ? 0.3 * smooth(0.6, 0.85, noise3(x * 2.2, y * 2.2 + 4, z * 2.2)) * this.moss : 0;
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
function meshOf(geo) {
  const m = new THREE.Mesh(geo, sculptMaterial());
  m.castShadow = true; m.receiveShadow = true;
  return m;
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
/** one boulder on the local origin: a lump cut by random planes into facets, bedded in strata, cracked and mossed */
function boulder(g, rx, ry, rz, seed, col, nu = 48) {
  nu = Math.max(8, Math.round(nu / 2) * 2);
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

// =====================================================================================================
// Faction kit: the pieces every family below is made of
// =====================================================================================================
const BONE = rgb(0xd9d0b4), BONE_OLD = rgb(0xa89a78), GOLD = rgb(0xe0aa2e), BRASS = rgb(0xb8862e), RUST = rgb(0x8a4520), SOOT = rgb(0x1a1a1e);
const EMBER = [1.0, 0.3, 0.03], GHOST = [0.22, 1.0, 0.12], FROST = [0.2, 0.62, 1.0], DRAKE = [1.0, 0.42, 0.04];
const geoCache = new Map();
/** a geometry built once per detail preset */
function geoOnce(key, make) { const k = `${key}|${getDetail()}`; if (!geoCache.has(k)) geoCache.set(k, make()); return geoCache.get(k); }
const structCache = new Map();
/** build once per key and detail preset; make(g) draws the building. Placements share the geometry. */
function struct(key, make) {
  const k = `${key}|${getDetail()}`;
  if (!structCache.has(k)) { const g = new Geo(); make(g); structCache.set(k, g.build()); }
  return meshOf(structCache.get(k));
}
const nq = (n) => Math.max(3, Math.round(n * qual()));   // a segment count scaled with the detail preset

/**
 * A limb: a round (or squared) section carried along a curve through pts, radii one per point. Horns, tusks, bones,
 * crags, standing stones, stems and pipes are all this. o: nu, nv, seed, amp (rock roughness), sq (squareness 0..1),
 * flat [a, b] (section scale), facets (cut the section to a polygon), col (rgb or fn(x, y, z, nx, ny, nz, u, v)),
 * capA / capB (close the ends), up (first frame normal).
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
const boneCol = (seed = 0, base = BONE) => (x, y, z) => mix(mul(base, 0.72 + 0.4 * noise3(x * 9 + seed, y * 9, z * 9)), BONE_OLD, 0.55 * smooth(0.5, 0.8, noise3(x * 3.3 + seed, y * 3.3 + 4, z * 3.3)));
/** tanned hide: blotched, darker along the seams of its panels */
const hideCol = (col, seed = 0, panel = 0.5) => (x, y, z, nx, ny, nz, u = 0, v = 0) => {
  const pu = u / panel * 2, seam = Math.min(Math.abs(pu - Math.round(pu)), 0.5) * panel;
  return mul(mix(col, mul(col, 0.55), smooth(0.45, 0.75, noise3(x * 2.6 + seed, y * 2.6, z * 2.6 + seed * 0.3))), (0.82 + 0.3 * noise3(x * 11, y * 11 + seed, z * 11)) * (0.6 + 0.4 * smooth(0, 0.02, seam)));
};
const charCol = (seed = 0) => (x, y, z) => { const n = noise3(x * 5 + seed, y * 5, z * 5), a = noise3(x * 19 + seed, y * 19, z * 19); return mix(mul([0.035, 0.03, 0.028], 0.6 + 0.9 * a), [0.24, 0.23, 0.22], smooth(0.62, 0.8, n) * 0.6); };

/** a mound of earth or rock that fills a footprint w x h: its skirt runs just under the ground */
function pad(g, w, h, hgt, col, seed = 0, o = {}) {
  const hx = w / 2 - (o.inset ?? 0.03), hz = h / 2 - (o.inset ?? 0.03), pw = o.sq ?? 5, nu = nq(o.nu || 56), nv = nq(o.nv || 10);
  g.surf(o.kind ?? K_STONE, 0.97);
  g.sheet(nu, nv, (u, v) => {
    const a = u * TAU, co = Math.cos(a), si = Math.sin(a), k = Math.pow(Math.pow(Math.abs(co), pw) + Math.pow(Math.abs(si), pw), -1 / pw);
    const x = co * k * hx * v, z = si * k * hz * v, edge = smooth(1, 0.72, v), n = fbm3(x * 1.7 + seed, 0.3, z * 1.7, 3);
    return [x * (1 + 0.03 * (n - 0.5) * (v > 0.99 ? 0 : 1)), v > 0.995 ? -0.06 : edge * (hgt * (0.75 + 0.5 * n) + (o.top ? o.top(x, z) : 0)), z];
  }, typeof col === 'function' ? col : (x, y, z) => mul(col, 0.72 + 0.5 * fbm3(x * 3.1 + seed, y * 6, z * 3.1, 3)), true);
}
/** a horn, tusk or claw: curved, tapering to a point, ringed toward the root */
function horn(g, pts, r0, c0 = BONE, c1 = mul(BONE, 0.45), o = {}) {
  const n = pts.length, radii = pts.map((_, i) => r0 * Math.pow(1 - i / (n - 1), o.pow || 0.85) + (i === n - 1 ? 0 : r0 * 0.04));
  g.surf(K_PLAIN, o.rough ?? 0.55, o.metal || 0);
  limb(g, pts, radii, { nu: o.nu || nq(10), nv: o.nv || nq(n * 4), flat: o.flat, col: (x, y, z, nx, ny, nz, u, v) => mul(mix(c1, c0, smooth(0, 0.55, v)), (0.82 + 0.2 * Math.sin(v * (o.rings || 46)) * (1 - v)) * (0.9 + 0.2 * noise3(x * 14, y * 14, z * 14))), capA: mul(c1, 0.7) });
}
/** a long bone from a to b: shaft and two knuckled ends */
function bone(g, a, b, r, seed = 0, base = BONE) {
  const f = along(a, b), c = boneCol(seed, base);
  g.surf(K_PLAIN, 0.7);
  g.in(f.m, () => {
    const L = f.L, pr = [[-L / 2, 0.6], [-L / 2 + r * 0.7, 1.55], [-L / 2 + r * 2.2, 1.25], [-L / 2 + r * 4, 0.8], [0, 0.72], [L / 2 - r * 4, 0.8], [L / 2 - r * 2.2, 1.25], [L / 2 - r * 0.7, 1.55], [L / 2, 0.6]];
    g.in(M(0, 0, 0, 0, 0, -90), () => g.lathe(pr.map(([x, k]) => [r * k, x]), nq(8), c));
    for (const e of [-1, 1]) for (const s of [-1, 1]) g.in(M(e * (L / 2 - r * 0.5), 0, s * r * 0.7), () => g.add(new THREE.SphereGeometry(r * 1.05, nq(7), nq(4)), c));
  });
}
/** a curved rib springing from `a`, bowing by `bow` and ending at `b` */
function rib(g, a, b, bow, r, seed = 0) {
  const pts = [];
  for (let k = 0; k <= 5; k++) { const t = k / 5, s = Math.sin(t * Math.PI); pts.push([lerp(a[0], b[0], t) + bow[0] * s, lerp(a[1], b[1], t) + bow[1] * s, lerp(a[2], b[2], t) + bow[2] * s]); }
  g.surf(K_PLAIN, 0.7);
  limb(g, pts, [r * 1.3, r * 1.1, r, r * 0.9, r * 0.7, r * 0.25], { nu: nq(8), nv: nq(16), flat: [1, 0.62], col: boneCol(seed), capA: true });
}
/** a human skull about 0.24 high, sculpted once: jaw toward +Z, resting on y = 0 */
function skullGeo(coarse = false) {
  return geoOnce(coarse ? 'skullLo' : 'skull', () => {
    const c = 0xd9d0b4, d = 0x1a1612, P = [];
    P.push(S.ellipsoid(0.085, 0.082, 0.1).at(0, 0.155, -0.01).color(c).tint(0.14, 30));
    P.push(S.box(0.105, 0.075, 0.07, 0.03).at(0, 0.085, 0.055).color(c).blend(0.03));
    P.push(S.box(0.085, 0.045, 0.06, 0.018).at(0, 0.03, 0.05).color(0xc8bc9c).blend(0.012));
    P.push(...S.mirrorX([S.ellipsoid(0.024, 0.014, 0.02).rot(0, 0, -14).at(0.04, 0.142, 0.085).color(c).blend(0.014)]));
    P.push(...S.mirrorX([S.ellipsoid(0.027, 0.026, 0.03).at(0.036, 0.112, 0.088).color(d).cut(0.008)]));
    P.push(S.cone(0.016, 0.004, 0.04, 0.004).at(0, 0.078, 0.095).color(d).cut(0.005));
    P.push(S.box(0.07, 0.006, 0.03, 0.002).at(0, 0.052, 0.085).color(d).cut(0.003));
    for (let i = -3; i <= 3; i++) P.push(S.box(0.003, 0.03, 0.02, 0.001).at(i * 0.0115, 0.05, 0.09).color(d).cut(0.002));
    return buildPartGeometry({ prims: P }, { res: (coarse ? 40 : 80) * qual(), ao: 0.8 });
  });
}
function skull(g, s = 1, coarse = false) { const k = g.kind; g.surf(K_PLAIN, 0.75); g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(skullGeo(coarse))); g.kind = k; }
/** chain hanging through pts: links s across, every other one turned */
function chain(g, pts, s = 0.045, col = IRON, metal = 0.85) {
  g.surf(K_PLAIN, 0.5, metal);
  let acc = 0, i = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], f = along(a, b), step = s * 1.45;
    let x = -f.L / 2 + acc;
    for (; x <= f.L / 2; x += step, i++) g.in(f.m.clone().multiply(M(x, 0, 0, i % 2 ? 90 : 0, 0, 0)), () => g.add(new THREE.TorusGeometry(s * 0.5, s * 0.15, 5, nq(9)).scale(1.35, 1, 1), col));
    acc = x - f.L / 2;
  }
}
/** a seeded glyph of glowing strokes on the local XY plane, about s high, facing +Z */
function sigil(g, seed, s, col, glow = 1.5, rad = 0.05) {
  const rnd = rng(seed * 577 + 11), P = (i) => [((i % 3) - 1) * 0.3 * s, (Math.floor(i / 3) - 1.5) * 0.3 * s, 0.006];
  g.surf(K_PLAIN, 0.4, 0, glow);
  const path = [Math.floor(rnd() * 3)];
  for (let k = 0; k < 4 + Math.floor(rnd() * 3); k++) { let nx; do { nx = Math.floor(rnd() * 12); } while (nx === path[path.length - 1]); path.push(nx); }
  for (let k = 0; k < path.length - 1; k++) { const a = P(path[k]), b = P(path[k + 1]); g.tube([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.012 * s + 0.006], b], rad * s, 5, col, true); }
  const d = P(Math.floor(rnd() * 12));
  g.in(M(d[0], d[1], 0.004), () => g.add(new THREE.TorusGeometry(0.1 * s, rad * s * 0.8, 4, 12), col));
  if (rnd() < 0.6) { const e = P(Math.floor(rnd() * 12)); g.in(M(e[0] + 0.15 * s, e[1] + 0.15 * s, 0.004), () => g.stud(rad * s * 1.6, col, 6, 0.6)); }
}
/** flames standing on the local origin, s high: cols = [core, mid, tip] */
function fire(g, s, cols, seed = 0, glow = 1.4) {
  g.surf(K_PLAIN, 1, 0, glow);
  const fl = (x, y) => (y > s * 0.62 ? cols[2] : y > s * 0.28 ? cols[1] : cols[0]);
  g.lathe([[0.13, 0], [0.2, 0.16], [0.16, 0.38], [0.08, 0.62], [0.03, 0.84], [0, 1]].map(([r, y]) => [r * s, y * s]), nq(8), fl);
  for (let i = 0; i < 3; i++) { const a = seed + i * 2.2; g.in(M(Math.cos(a) * 0.1 * s, 0, Math.sin(a) * 0.1 * s, 12 * Math.cos(a + 1), a * 57, 12 * Math.sin(a)), () => g.lathe([[0.09, 0], [0.12, 0.14], [0.06, 0.4], [0, 0.62 + 0.1 * i]].map(([r, y]) => [r * s, y * s]), nq(6), fl)); }
}
const FIRE_HOT = [[1.0, 0.55, 0.1], [1.0, 0.32, 0.04], [0.95, 0.14, 0.02]], FIRE_GHOST = [[0.6, 1.0, 0.35], [0.25, 1.0, 0.14], [0.08, 0.7, 0.1]], FIRE_FROST = [[0.6, 0.9, 1.0], [0.25, 0.65, 1.0], [0.12, 0.35, 0.95]];
/** an iron fire bowl on three legs standing on the local origin, s high to its rim */
function brazier(g, s, cols = FIRE_HOT, metal = IRON, seed = 0) {
  g.surf(K_PLAIN, 0.5, 0.85);
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.4; g.tube([[Math.cos(a) * 0.3 * s, 0, Math.sin(a) * 0.3 * s], [Math.cos(a) * 0.1 * s, 0.45 * s, Math.sin(a) * 0.1 * s], [Math.cos(a) * 0.22 * s, 0.82 * s, Math.sin(a) * 0.22 * s]], 0.03 * s, 5, metal); }
  g.lathe([[0.04, 0.62], [0.2, 0.68], [0.3, 0.82], [0.33, 1], [0.36, 1.02], [0.36, 1.06], [0.3, 1.06], [0.27, 0.9], [0, 0.84]].map(([r, y]) => [r * s, y * s]), nq(14), metal);
  g.surf(K_PLAIN, 1, 0, 1.1);
  g.in(M(0, 0.93 * s, 0), () => g.add(new THREE.SphereGeometry(0.27 * s, nq(10), 5, 0, TAU, 0, 1.4).scale(1, 0.45, 1), (x, y, z) => mix(mul(cols[2], 0.35), cols[0], smooth(0.4, 0.7, noise3(x * 30 + seed, y * 30, z * 30)))));
  g.in(M(0, 0.98 * s, 0), () => fire(g, 0.75 * s, cols, seed));
}
/** a round shield lying on the local XY plane facing +Z: planks or hide, iron rim and boss, a daub of paint */
function roundShield(g, r, col, paint, seed = 0) {
  g.surf(K_WOOD, 0.85);
  g.in(M(0, 0, 0, 90, 0, 0), () => g.lathe([[0, 0.05], [r * 0.5, 0.042], [r * 0.93, 0.02], [r, 0], [r * 0.93, -0.02], [0, -0.02]].reverse(), nq(18), (x, y, z) => {
    const a = Math.atan2(z, x), d = Math.hypot(x, z) / r, plank = Math.floor((x / r) * 3 + 9 + seed);
    const daub = paint && d < 0.82 && (Math.abs(Math.sin(a * 2 + seed)) < 0.22 + 0.1 * noise3(x * 20, seed, z * 20) || (d > 0.5 && d < 0.64));
    return daub ? mul(paint, 0.8 + 0.3 * noise3(x * 30, 2, z * 30)) : mul(col, (0.75 + 0.4 * hash1(plank, seed)) * (0.85 + 0.2 * noise3(x * 4, 1, z * 30)));
  }));
  g.surf(K_PLAIN, 0.55, 0.8);
  g.in(M(0, 0, 0.012), () => g.add(new THREE.TorusGeometry(r * 0.97, r * 0.055, 5, nq(18)), mul(RUST, 0.6)));
  g.in(M(0, 0, 0.04, 90, 0, 0), () => g.lathe([[r * 0.3, 0], [r * 0.24, 0.03], [r * 0.1, 0.07], [0, 0.085]], nq(10), [0.1, 0.09, 0.085]));
  for (let i = 0; i < 8; i++) g.in(M(Math.cos(i * 0.785) * r * 0.8, Math.sin(i * 0.785) * r * 0.8, 0.026), () => g.stud(r * 0.05, [0.1, 0.09, 0.085], 5));
}
/** cloth hanging from the local origin (middle of its top edge) down -Y, facing +Z: torn = how ragged its foot is */
function rag(g, w, h, col, seed = 0, torn = 0.4, stripe = null) {
  g.surf(K_CLOTH, 0.95);
  const nu = nq(12), nv = nq(10);
  g.sheet(nu, nv, (u, v) => {
    const tear = torn * h * (0.5 * Math.abs(Math.sin(u * 9 + seed * 3)) + 0.5 * noise3(u * 7 + seed, 3, seed)), y = -v * (h - tear * v);
    return [(u - 0.5) * w * (1 - 0.12 * v * Math.sin(u * 5 + seed)), y, 0.02 + 0.05 * v * Math.sin(u * 8 + seed + v * 3) * w + 0.03 * v];
  }, (x, y, z, nx, ny, nz, u, v) => mul(stripe && Math.abs(u - 0.5) < 0.16 && v > 0.12 && v < 0.8 ? stripe : col, (0.72 + 0.4 * noise3(x * 9 + seed, y * 9, 1)) * (1 - 0.35 * v)));
}
/** a sharpened stake standing on the local origin */
function stake(g, r, h, seed = 0, bark = rgb(0x5d4830), tipC = rgb(0xc8a472)) {
  g.surf(K_WOOD, 0.95);
  const tip = Math.min(h * 0.3, r * 4.5);
  limb(g, [[0, -0.08, 0], [0, (h - tip) * 0.5, 0], [0, h - tip, 0], [0, h, 0]], [r * 1.05, r, r * 0.92, 0.004], { nu: nq(10), nv: nq(12), amp: 0.08, seed, nf: 3,
    col: (x, y, z) => (y > h - tip ? mul(tipC, 0.75 + 0.4 * noise3(x * 30, y * 6, z * 30)) : mul(bark, 0.66 + 0.6 * noise3(x * 13 + seed, y * 1.6, z * 13))) });
}
/** a crystal standing on the local origin: m crisp sides with chamfered arrises, lit from within. o: deep, bright, glow, lean */
function crystal(g, r, h, seed = 0, o = {}) {
  const m = o.m || 6, rnd = rng(seed * 311 + 7), deep = o.deep || rgb(0x1f58c8), bright = o.bright || rgb(0x9fe8ff), glow = o.glow ?? 0.9, ns = nq(o.ns || 6);
  const tipH = h * (0.16 + 0.14 * rnd()), ring = [], cut = 0.16;
  for (let i = 0; i < m; i++) { const a = (i / m) * TAU + (rnd() - 0.5) * 0.3, rr = r * (0.8 + 0.4 * rnd()); ring.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  const tip = [(rnd() - 0.5) * r * 0.5, h, (rnd() - 0.5) * r * 0.5], ys = [];
  for (let j = 0; j <= ns; j++) ys.push(((h - tipH) * j) / ns);
  const wid = (y) => 0.86 + 0.14 * Math.sin((y / h) * 2.6 + 0.4), keep = [g.rough, g.metal, g.glow, g.kind];
  g.kind = K_PLAIN; g.rough = 0.12; g.metal = 0.15;
  const put = (x, y, z, n, k) => { const t = clamp(y / h, 0, 1), e = 0.35 + 0.65 * Math.pow(Math.abs(1 - 2 * t), 1.5); g.glow = glow * (0.45 + 0.75 * e) * k; return g.v(x, y, z, n[0], n[1], n[2], mul(mix(deep, bright, clamp(e * 0.8 + 0.25 * (k - 1), 0, 1)), k)); };
  for (let i = 0; i < m; i++) {
    const a = ring[i], b = ring[(i + 1) % m], c = ring[(i + 2) % m];
    const a2 = [lerp(a[0], b[0], cut), lerp(a[1], b[1], cut)], b1 = [lerp(a[0], b[0], 1 - cut), lerp(a[1], b[1], 1 - cut)], b2 = [lerp(b[0], c[0], cut), lerp(b[1], c[1], cut)];
    const fn = [b[1] - a[1], 0.12 * r, -(b[0] - a[0])], sg = fn[0] * (a[0] + b[0]) + fn[2] * (a[1] + b[1]) < 0 ? -1 : 1, N = [fn[0] * sg, Math.abs(fn[1]), fn[2] * sg];
    const en = [b[0], 0.1 * r, b[1]], sh = 0.8 + 0.4 * hash1(i, seed);
    let pA = -1, pB = -1, pC = -1, pD = -1;
    for (let j = 0; j <= ns; j++) {
      const y = ys[j], k = wid(y);
      const A = put(a2[0] * k, y, a2[1] * k, N, sh), B = put(b1[0] * k, y, b1[1] * k, N, sh), C = put(b1[0] * k, y, b1[1] * k, en, 1.25), D = put(b2[0] * k, y, b2[1] * k, en, 1.25);
      if (j) { g.quad(pA, pB, B, A); g.quad(pC, pD, D, C); }
      pA = A; pB = B; pC = C; pD = D;
    }
    // the point: each side and each chamfer runs up to the tip
    const k = wid(h - tipH), tn = [N[0], Math.hypot(N[0], N[2]) * 0.6 + 0.2, N[2]], T1 = put(tip[0], tip[1], tip[2], tn, sh * 1.2), T2 = put(tip[0], tip[1], tip[2], en, 1.3);
    g.tri(put(a2[0] * k, h - tipH, a2[1] * k, tn, sh * 1.1), put(b1[0] * k, h - tipH, b1[1] * k, tn, sh * 1.1), T1);
    g.tri(put(b1[0] * k, h - tipH, b1[1] * k, en, 1.3), put(b2[0] * k, h - tipH, b2[1] * k, en, 1.3), T2);
  }
  [g.rough, g.metal, g.glow, g.kind] = keep;
}
/** a heap of gold: a glittering mound with coins lying on it and a few gems; returns height(x, z) */
function goldPile(g, rx, rz, h, seed = 0, coins = 60) {
  const hgt = (x, z) => { const d = Math.hypot(x / rx, z / rz); return d >= 1 ? 0 : h * Math.pow(1 - d * d, 0.8) * (0.8 + 0.35 * noise3(x * 4 + seed, 1, z * 4)); };
  g.surf(K_PLAIN, 0.38, 0.85, 0.06);
  g.sheet(nq(40), nq(12), (u, v) => { const a = u * TAU, x = Math.cos(a) * rx * v, z = Math.sin(a) * rz * v; return [x, v > 0.995 ? -0.03 : hgt(x, z), z]; },
    (x, y, z) => { const n = hash1(Math.round(x * 55), Math.round(z * 55), seed); return mul(GOLD, 0.45 + 0.9 * n * n); }, true);
  const rnd = rng(seed * 97 + 3), gems = [rgb(0xd8283a), rgb(0x2fa8e8), rgb(0x3ad86a), rgb(0xb048e8)];
  for (let i = 0; i < coins; i++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.96, x = Math.cos(a) * rx * d, z = Math.sin(a) * rz * d, y = hgt(x, z);
    if (i % 11 === 5) { g.surf(K_PLAIN, 0.1, 0.1, 0.5); g.in(M(x, y - 0.01, z, rnd() * 60, rnd() * 360, rnd() * 60), () => g.add(new THREE.OctahedronGeometry(0.035 + 0.02 * rnd(), 0).scale(1, 1.3, 1), gems[i % 4])); g.surf(K_PLAIN, 0.3, 0.9, 0.06); }
    else { g.surf(K_PLAIN, 0.3, 0.9, 0.06); g.in(M(x, y + 0.003, z, (rnd() - 0.5) * 70, rnd() * 360, (rnd() - 0.5) * 70), () => g.cyl(0.03, 0.03, 0.008, nq(8), mul(GOLD, 0.8 + 0.5 * rnd()), false, true)); }
  }
  return hgt;
}
/** a wall of crooked planks W x H on the local XY plane facing +Z: uneven tops, gaps, nails. skip(x) leaves a hole */
function plankWall(g, W, H, pal, seed = 0, o = {}) {
  const rnd = rng(seed * 131 + 5), pw = o.pw || 0.14;
  let x = 0, i = 0;
  while (x < W - 0.02) {
    const w = Math.min(W - x, pw * (0.7 + 0.6 * rnd())), hh = H * (o.even ? 1 : 0.86 + 0.2 * rnd()), tilt = (rnd() - 0.5) * (o.tilt ?? 5), c = mul(pal[Math.floor(rnd() * pal.length)], 0.8 + 0.4 * rnd());
    if (!(o.skip && o.skip(x + w / 2))) {
      g.surf(K_WOOD, 0.9);
      g.in(M(x + w / 2, hh / 2 - 0.04, 0, 0, 0, 90 + tilt), () => g.beam(hh + 0.08, w - 0.008, 0.035, 0.008, woodTint(c, seed + i), 4));
      g.surf(K_PLAIN, 0.6, 0.8);
      for (const fy of [0.16, 0.78]) g.in(M(x + w / 2, hh * fy, 0.018), () => g.stud(0.01, IRON, 5, 0.5));
    }
    x += w; i++;
  }
}
/** a mushroom standing on the local origin: stem h tall, cap R across, spots that may glow */
function mushroom(g, h, R, cap, seed = 0, glow = 0) {
  const stem = rgb(0xd8cfae);
  g.surf(K_PLAIN, 0.85);
  limb(g, [[0, -0.03, 0], [R * 0.08, h * 0.4, R * 0.03], [0.02 * R, h * 0.8, 0], [0, h, 0]], [R * 0.3, R * 0.2, R * 0.17, R * 0.22], { nu: nq(12), nv: nq(10), col: (x, y, z) => mul(stem, 0.7 + 0.35 * noise3(x * 30, y * 3, z * 30)) });
  const nu = nq(44), nv = nq(18), keep = g.glow;
  g.sheet(nu, nv, (u, v) => {
    const a = u * TAU, t = v * 1.25, wob = 1 + 0.07 * Math.sin(a * 5 + seed) + 0.05 * noise3(Math.cos(a) * 2 + seed, 1, Math.sin(a) * 2);
    const rr = t <= 1 ? Math.sin(t * Math.PI / 2) * R * wob : R * wob * (1 - (t - 1) * 3.2), y = t <= 1 ? h + R * 0.55 * Math.cos(t * Math.PI / 2) : h - (t - 1) * R * 0.2;
    return [Math.cos(a) * rr, y - R * 0.12 * Math.sin(t * Math.PI / 2) * (0.5 + 0.5 * Math.sin(a * 3 + seed)), Math.sin(a) * rr];
  }, (x, y, z, nx, ny, nz, u, v) => {
    if (v * 1.25 > 1) { g.glow = 0; return mul(stem, 0.35 + 0.3 * Math.abs(Math.sin(u * TAU * 22))); }
    const spot = cells3(x * 3.4 / R + seed, y * 3.4 / R, z * 3.4 / R) < 0.24;
    g.glow = spot ? glow : 0;
    return spot ? mul(rgb(0xe8e2c8), glow ? 1.1 : 0.95) : mul(cap, 0.7 + 0.4 * noise3(x * 6, y * 6, z * 6));
  }, true);
  g.glow = keep;
}
/** an egg standing on the local origin */
function egg(g, r, h, col, seed = 0, glow = 0) {
  g.surf(K_PLAIN, 0.42, 0.05, glow);
  g.sheet(nq(22), nq(16), (u, v) => { const a = u * TAU, t = v * Math.PI, rr = Math.sin(t) * r * (1 - 0.22 * v + 0.1); return [Math.cos(a) * rr, h * 0.5 * (1 - Math.cos(t)), Math.sin(a) * rr]; },
    (x, y, z) => { const c = cells3(x * 9 / r * 0.3 + seed, y * 9 / r * 0.3, z * 9 / r * 0.3); return mul(mix(col, mul(col, 0.4), smooth(0.34, 0.2, c)), 0.85 + 0.3 * noise3(x * 5 + seed, y * 5, z * 5)); }, true, true);
}
/** a molten or glowing pool: a disc on the local origin, crusted dark between bright seams */
function pool(g, R, cols, seed = 0, glow = 1.3, crust = [0.03, 0.02, 0.02]) {
  const keep = g.glow;
  g.surf(K_PLAIN, 0.6, 0, glow);
  g.sheet(nq(36), nq(10), (u, v) => { const a = u * TAU, d = v * R; return [Math.cos(a) * d, 0.012 * Math.sin(d * 23 + seed), Math.sin(a) * d]; }, (x, y, z) => {
    const c = cells3(x * 3.4 + seed, 0.5, z * 3.4), hot = smooth(0.2, 0.5, c) * (0.6 + 0.4 * noise3(x * 2 + seed, 1, z * 2));
    g.glow = glow * (0.25 + 0.75 * hot);
    return mix(mix(crust, cols[2], 0.5), hot > 0.7 ? cols[0] : cols[1], hot);
  }, true);
  g.glow = keep;
}

const LEAD = rgb(0x6f7a80);
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
const sw = (...hex) => hex.map((h) => rgb(h));
const tri1 = (v) => Math.abs(v - Math.floor(v) - 0.5) * 2;   // triangle wave 0..1: folds a surface into flat facets
/** a solid slice: outline [[x, y], ...] (star-shaped about `hub`) on the local XY plane, `depth` thick about z = 0 */
function prism(g, pts, depth, col, hub = null) {
  const n = pts.length, h = hub || [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  for (const s of [1, -1]) { const ce = g.vc(h[0], h[1], (s * depth) / 2, 0, 0, s, col), id = pts.map((p) => g.vc(p[0], p[1], (s * depth) / 2, 0, 0, s, col)); for (let i = 0; i < n; i++) g.tri(ce, id[i], id[(i + 1) % n]); }
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; let nx = dy / l, ny = -dx / l; if (nx * ((a[0] + b[0]) / 2 - h[0]) + ny * ((a[1] + b[1]) / 2 - h[1]) < 0) { nx = -nx; ny = -ny; } g.quad(g.vc(a[0], a[1], depth / 2, nx, ny, 0, col), g.vc(b[0], b[1], depth / 2, nx, ny, 0, col), g.vc(b[0], b[1], -depth / 2, nx, ny, 0, col), g.vc(a[0], a[1], -depth / 2, nx, ny, 0, col)); }
}
const MERLON = {
  square: (w, h) => [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]],
  step: (w, h) => [[-w / 2, 0], [w / 2, 0], [w / 2, h * 0.36], [w * 0.3, h * 0.36], [w * 0.3, h * 0.7], [w * 0.12, h * 0.7], [w * 0.12, h], [-w * 0.12, h], [-w * 0.12, h * 0.7], [-w * 0.3, h * 0.7], [-w * 0.3, h * 0.36], [-w / 2, h * 0.36]],
  round: (w, h) => [[-w / 2, 0], [w / 2, 0], [w / 2, h * 0.5], [w * 0.36, h * 0.8], [0, h], [-w * 0.36, h * 0.8], [-w / 2, h * 0.5]],
  point: (w, h) => [[-w / 2, 0], [w / 2, 0], [w / 2, h * 0.45], [0, h], [-w / 2, h * 0.45]],
  swallow: (w, h) => [[-w / 2, 0], [w / 2, 0], [w / 2, h], [w * 0.2, h * 0.72], [0, h * 0.6], [-w * 0.2, h * 0.72], [-w / 2, h]],
};
// ---------- the realm ornament kit: "wall" pieces lie on the local XY plane facing +Z, "top" pieces stand on the origin ----------
const tintTo = (c, p, t) => { c[0] += (p[0] - c[0]) * t; c[1] += (p[1] - c[1]) * t; c[2] += (p[2] - c[2]) * t; };
/** top: a pole with a swallow-tailed pennant flying toward +X */
function pennon(g, h, len, c1, c2, o = {}) {
  g.surf(K_WOOD, 0.8); g.cyl(0.02, 0.014, h, 6, o.pole || rgb(0x4a3626), false, true);
  if (o.knob !== false) { g.surf(K_PLAIN, 0.4, 0.9); g.in(M(0, h, 0), () => g.lathe([[0.02, -0.01], [0.035, 0.02], [0.02, 0.05], [0, 0.09]], 6, o.knob || GOLD)); }
  const hg = o.hgt || len * 0.42;
  g.surf(K_CLOTH, 0.9);
  g.sheet(nq(10), 3, (u, v) => { const fork = o.square ? 0 : u > 0.6 ? (u - 0.6) / 0.4 : 0, wd = hg * (1 - (o.square ? 0 : 0.3) * u); return [0.02 + u * len - fork * (1 - Math.abs(v - 0.5) * 2) * len * 0.3, h - 0.04 - hg * 0.5 + (v - 0.5) * wd - u * u * 0.06, Math.sin(u * 7 + v + h) * 0.04 * u]; },
    (x, y, z, nx, ny, nz, u, v) => (c2 && (o.bars ? Math.floor(u * o.bars) % 2 : Math.abs(v - 0.5) < 0.18) ? c2 : c1));
}
/** wall: a long banner hanging from a bar; device = [colour] paints a lozenge on it */
function hanging(g, w, h, c1, c2, o = {}) {
  g.surf(K_PLAIN, 0.5, 0.8); g.in(M(0, 0.02, 0.035), () => g.cbox(w + 0.12, 0.03, 0.03, 0.006, o.bar || IRON));
  g.surf(K_CLOTH, 0.92);
  g.sheet(nq(8), nq(8), (u, v) => { const tail = o.point ? Math.abs(u - 0.5) * 2 * 0.16 * h * v * v : 0; return [(u - 0.5) * w, -v * h + tail * (v > 0.9 ? 1 : 0.4), 0.03 + 0.03 * v * Math.sin(u * 6 + v * 3 + w * 9)]; },
    (x, y, z, nx, ny, nz, u, v) => { const dv = Math.abs(u - 0.5) + Math.abs(v - 0.42) * 0.8; return mul(o.device && dv < 0.24 ? o.device : c2 && (Math.abs(u - 0.5) > 0.36 || (o.chief && v < 0.16)) ? c2 : c1, 0.82 + 0.25 * noise3(x * 7, y * 7, 2) - 0.2 * v); });
}
/** wall: a heater shield, parted in two colours with a boss */
function heater(g, s, c1, c2, o = {}) {
  const pts = [[-0.3, 0.36], [0.3, 0.36], [0.31, 0.05], [0.22, -0.2], [0, -0.42], [-0.22, -0.2], [-0.31, 0.05]].map(([x, y]) => [x * s, y * s]);
  g.surf(K_PLAIN, 0.55, o.metal ?? 0.3);
  g.in(M(0, 0, 0.03), () => prism(g, pts, 0.04, (x, y) => mul(o.quarter ? ((x > 0) === (y > 0) ? c1 : c2) : o.bend ? (y > x * 1.2 ? c1 : c2) : x > 0 ? c1 : c2, 0.9 + 0.2 * noise3(x * 20, y * 20, 1)), [0, 0]));
  g.surf(K_PLAIN, 0.4, 0.9); g.in(M(0, 0, 0.05), () => g.stud(0.06 * s, o.boss || GOLD, 6));
}
/** a lantern hanging at the local origin (its top): shape 'box' | 'paper' | 'orb' | 'cage' */
function lamp(g, s, glowCol, o = {}) {
  const fr = o.frame || IRON, sh = o.shape || 'box', gl = o.glow ?? 1.0;
  g.surf(K_PLAIN, 0.5, o.frameMetal ?? 0.8);
  if (sh === 'paper') {
    g.cyl(0.012 * s, 0.012 * s, 0.08 * s, 5, fr); g.in(M(0, -0.31 * s, 0), () => { g.lathe([[0.07, 0.26], [0.09, 0.3], [0.07, 0.31]].map(([r, y]) => [r * s, y * s]), nq(8), fr); g.lathe([[0.07, 0], [0.09, 0.012], [0.07, 0.03]].map(([r, y]) => [r * s, y * s]), nq(8), fr);
      g.surf(K_PLAIN, 0.8, 0, gl); g.lathe([[0.075, 0.03], [0.13, 0.09], [0.15, 0.15], [0.13, 0.21], [0.075, 0.27]].map(([r, y]) => [r * s, y * s]), nq(10), (x, y, z) => mul(glowCol, 0.75 + 0.25 * tri1((Math.atan2(z, x) / TAU) * 8)));
      if (o.tassel) { g.surf(K_CLOTH, 0.9); g.in(M(0, -0.12 * s, 0), () => g.cyl(0.008 * s, 0.02 * s, 0.12 * s, 5, o.tassel)); } });
  } else if (sh === 'orb') { g.cyl(0.01 * s, 0.01 * s, 0.1 * s, 5, fr); g.surf(K_PLAIN, 0.3, 0, gl); g.in(M(0, -0.1 * s, 0), () => g.add(new THREE.SphereGeometry(0.1 * s, nq(10), nq(7)), glowCol)); }
  else {
    g.in(M(0, -0.34 * s, 0), () => { g.lathe([[0.085, 0.25], [0.03, 0.31], [0.012, 0.34]].map(([r, y]) => [r * s, y * s]), 6, fr); g.lathe([[0.065, 0], [0.085, 0.016], [0.085, 0.03]].map(([r, y]) => [r * s, y * s]), 6, fr);
      for (let q = 0; q < (sh === 'cage' ? 6 : 4); q++) { const a = q * (sh === 'cage' ? 1.047 : 1.5708) + 0.5; g.in(M(Math.cos(a) * 0.075 * s, 0.14 * s, Math.sin(a) * 0.075 * s), () => g.cbox(0.012 * s, 0.23 * s, 0.012 * s, 0.002, fr)); }
      g.surf(K_PLAIN, 1, 0, gl); g.lathe([[0.062 * s, 0.03 * s], [0.062 * s, 0.25 * s]], 6, glowCol); });
  }
}
/** wall: a lantern on a bracket */
function bracketLamp(g, s, glowCol, o = {}) {
  s = Math.min(s, 1.2);
  g.surf(K_PLAIN, 0.55, 0.85); g.tube([[0, 0.02, 0], [0, 0.12 * s, 0.1 * s], [0, 0.1 * s, 0.24 * s]], 0.014 * s, 5, o.frame || IRON);
  g.in(M(0, 0.1 * s, 0.24 * s), () => lamp(g, s, glowCol, o));
}
/** top: a plain spike (iron thorn, obsidian shard, icicle turned up) */
function thorn(g, h, r, col, o = {}) {
  g.surf(K_PLAIN, o.rough ?? 0.45, o.metal ?? 0.7, o.glow || 0);
  const m = o.m || 5, bend = o.bend || 0;
  limb(g, [[0, -0.1, 0], [bend * h * 0.2, h * 0.4, 0], [bend * h * 0.5, h * 0.75, 0], [bend * h, h, 0]], [r, r * 0.8, r * 0.45, 0.003], { nu: m, nv: 6, facets: o.round ? 0 : m, col });
}
/** wall: a round disc with rays (a sun, a mirror, a gong) */
function sunDisc(g, s, col, o = {}) {
  g.surf(K_PLAIN, o.rough ?? 0.3, o.metal ?? 0.9, o.glow || 0);
  g.in(M(0, 0, 0.02, 90, 0, 0), () => g.lathe([[0, 0.05], [0.12, 0.045], [0.2, 0.03], [0.24, 0], [0, 0]].reverse().map(([r, y]) => [r * s, y * s]), nq(16), (x, y, z) => mul(col, Math.hypot(x, z) < 0.1 * s ? 1.15 : 0.8 + 0.3 * tri1((Math.atan2(z, x) / TAU) * 12))));
  const nr = o.rays ?? 12;
  for (let i = 0; i < nr; i++) g.in(M(0, 0, 0.02, 0, 0, (i * 360) / nr), () => g.in(M(0, 0.25 * s, 0), () => prism(g, [[-0.035 * s, 0], [0.035 * s, 0], [0, (i % 2 ? 0.1 : 0.17) * s]], 0.02, o.ray || col, [0, 0.03 * s])));
}
/** top: a heap of skulls */
function skullPile(g, s, n = 4, seed = 0) {
  const rnd = rng(seed * 31 + 7);
  for (let i = 0; i < n; i++) { const a = (i / Math.max(1, n - 1)) * TAU + rnd(), d = i === n - 1 ? 0 : 0.13 * s; g.in(M(Math.cos(a) * d, i === n - 1 && n > 2 ? 0.16 * s : 0, Math.sin(a) * d, (rnd() - 0.5) * 30, a / DEG + 90 + (rnd() - 0.5) * 60, (rnd() - 0.5) * 30), () => skull(g, s, true)); }
}
/** wall: a crouching beast jutting from the wall (+Z), sculpted once */
function gargoyle(g, s, col) {
  const geo = geoOnce('gargoyle', () => {
    const c = 0x8a8a8a, P = [];
    P.push(S.ellipsoid(0.1, 0.11, 0.2).at(0, 0, 0.14).color(c).tint(0.15, 20));
    P.push(S.capsule([0, 0.04, 0.26], [0, 0.0, 0.42], 0.07, 0.055).color(c).blend(0.04));
    P.push(S.ellipsoid(0.075, 0.07, 0.1).at(0, -0.02, 0.5).color(c).blend(0.03));
    P.push(S.box(0.07, 0.05, 0.12, 0.02).at(0, -0.06, 0.58).color(c).blend(0.02));
    P.push(...S.mirrorX([S.cone(0.022, 0.004, 0.12, 0.004).rot(-50, 0, -22).at(0.045, 0.06, 0.47).color(c).blend(0.01)]));
    P.push(...S.mirrorX([S.ellipsoid(0.03, 0.14, 0.11).rot(18, 0, -38).at(0.14, 0.1, 0.14).color(c).blend(0.03)]));
    P.push(...S.mirrorX([S.capsule([0.07, -0.06, 0.2], [0.09, -0.15, 0.3], 0.035, 0.03).color(c).blend(0.03)]));
    P.push(...S.mirrorX([S.sphere(0.014).at(0.035, 0.005, 0.585).color(0x111111).cut(0.004)]));
    return buildPartGeometry({ prims: P }, { res: 56 * qual(), ao: 0.8 });
  });
  const keep = g.kind; g.surf(K_STONE, 0.9);
  g.in(M(0, 0, -0.04, 0, 0, 0, s), () => g.add(geo, (x, y, z) => mul(col, 0.75 + 0.4 * noise3(x * 14, y * 14, z * 14) + 0.1 * y)));
  g.kind = keep;
}
/** wall: a bat spread flat (a carved or cut-out motif) */
function batMotif(g, s, col, o = {}) {
  const half = [[0, 0.1], [0.05, 0.16], [0.07, 0.08], [0.2, 0.16], [0.42, 0.1], [0.5, -0.02], [0.4, 0.0], [0.34, -0.08], [0.26, -0.02], [0.2, -0.1], [0.12, -0.03], [0.05, -0.12], [0, -0.14]];
  const pts = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x * s, y * s]);
  g.surf(K_PLAIN, o.rough ?? 0.5, o.metal ?? 0.6, o.glow || 0);
  g.in(M(0, 0, 0.025), () => prism(g, pts, 0.03, col, [0, 0]));
}
/** top: a gateway of two posts and two lintels standing across local X (the torii-like gate, a trilithon, a gallows frame) */
function gateFrame(g, w, h, col, o = {}) {
  const r = o.r || 0.07, tc = typeof col === 'function' ? col : woodTint(col, 3);
  g.surf(o.kind ?? K_WOOD, o.rough ?? 0.7);
  for (const e of [-1, 1]) g.in(M(e * w / 2, 0, 0, 0, 0, e * -(o.lean ?? 3)), () => { g.cyl(r, r * 0.9, h, nq(8), tc, false, true); if (o.foot) { g.surf(K_STONE, 0.9); g.cyl(r * 1.5, r * 1.3, 0.12, nq(8), o.foot, false, true); g.surf(o.kind ?? K_WOOD, o.rough ?? 0.7); } });
  g.in(M(0, h * 0.8, 0), () => g.beam(w + 0.16, 0.09, 0.07, 0.01, tc, 2));
  const cur = o.curve ?? 0.1;
  g.in(M(0, h + 0.02, 0), () => g.beam(w * 1.4, 0.12, 0.12, 0.014, tc, 8, (x) => [cur * Math.pow(Math.abs(x) / (w * 0.7), 2.2), 0]));
  if (o.cap) { g.surf(K_ROOF, 0.6); g.in(M(0, h + 0.1, 0), () => g.beam(w * 1.5, 0.05, 0.2, 0.012, o.cap, 8, (x) => [cur * 1.15 * Math.pow(Math.abs(x) / (w * 0.75), 2.2), 0])); }
}
/** a run of pipe through pts with flanged joints */
function pipe(g, pts, r, col, o = {}) {
  g.surf(K_PLAIN, o.rough ?? 0.4, o.metal ?? 0.85, o.glow || 0);
  g.tube(pts, r, nq(8), col, true);
  for (let i = 0; i < pts.length; i += o.every || 1) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], f = along(a, b); g.in(new THREE.Matrix4().copy(f.m).setPosition(pts[i][0], pts[i][1], pts[i][2]).multiply(M(0, 0, 0, 0, 0, 90)), () => g.lathe([[r * 1.5, -r * 0.4], [r * 1.5, r * 0.4]], nq(8), typeof col === 'function' ? col(pts[i][0], pts[i][1], pts[i][2]) : mul(col, 0.8))); }
}
/** top: a puff of smoke or steam rising from the origin */
function plume(g, s, col, seed = 0, glow = 0) {
  g.surf(K_PLAIN, 1, 0, glow);
  for (let i = 0; i < 4; i++) { const t = i / 3; g.in(M(Math.sin(seed + i * 1.7) * 0.1 * s * t, (0.1 + t * 0.55) * s, Math.cos(seed + i * 2.3) * 0.08 * s * t), () => g.add(new THREE.IcosahedronGeometry((0.09 + 0.1 * t) * s, 1), (x, y, z) => mul(col, 0.8 + 0.3 * noise3(x * 9 + seed, y * 9, z * 9) + 0.2 * t))); }
}
/** wall: rickety scaffolding: poles, a cross-brace and a plank walk */
function scaffold(g, w, h, wood, seed = 0) {
  const rnd = rng(seed * 53 + 3), tc = (i) => woodTint(mul(wood, 0.8 + 0.4 * rnd()), seed + i);
  g.surf(K_WOOD, 0.92);
  for (const e of [-1, 1]) g.in(M(e * w / 2, -h * 0.5, 0.2, (rnd() - 0.5) * 6, 0, (rnd() - 0.5) * 8), () => g.in(M(0, h * 0.55, 0, 0, 0, 90), () => g.beam(h * 1.15, 0.045, 0.045, 0.01, tc(e), 2)));
  g.beamTo([-w / 2, -h * 0.4, 0.2], [w / 2, h * 0.3, 0.21], 0.035, 0.03, 0.006, tc(3), 2);
  for (const y of [-0.05, 0.42]) { if (y * h > h * 0.5) continue; g.in(M(0, y * h, 0.12, (rnd() - 0.5) * 5, 0, (rnd() - 0.5) * 6), () => g.beam(w * 1.15, 0.03, 0.22, 0.006, tc(5 + y), 3)); for (const e of [-1, 1]) g.beamTo([e * w / 2, y * h - 0.03, 0], [e * w / 2, y * h - 0.03, 0.24], 0.04, 0.04, 0.006, tc(7), 1); }
}
/** wall: an awning in two colours on two props */
function awning(g, w, d, c1, c2, o = {}) {
  g.surf(K_CLOTH, 0.9);
  g.sheet(nq(10), 3, (u, v) => [(u - 0.5) * w, -v * d * 0.45 - 0.03 * Math.sin(u * Math.PI * (o.scallop || 3)) * v, 0.02 + v * d], (x, y, z, nx, ny, nz, u) => mul(Math.floor(u * (o.n || 6)) % 2 ? c1 : c2, 0.85 + 0.2 * noise3(x * 6, y * 6, z * 6)));
  g.surf(K_WOOD, 0.9);
  if (o.props !== false) for (const e of [-1, 1]) g.beamTo([e * w * 0.48, -d * 0.45, d], [e * w * 0.48, -d * 0.45 - 0.5, d * 0.25], 0.03, 0.03, 0.006, woodTint(rgb(0x5a4630), e), 1);
}
/** wall: a creeper climbing h up from the origin (or hanging when h < 0): stems and leaves */
function creeper(g, w, h, seed = 0, o = {}) {
  const rnd = rng(seed * 71 + 9), leaf = o.leaf || [rgb(0x3f6a2a), rgb(0x55803a), rgb(0x2f5524)], n = o.n || 3, nl = o.leaves ?? 9;
  for (let s = 0; s < n; s++) {
    const x0 = (s / Math.max(1, n - 1) - 0.5) * w * 0.7, pts = [];
    for (let q = 0; q <= 5; q++) { const t = q / 5; pts.push([x0 + (noise3(seed + s * 3.1, t * 2.2, 1) - 0.5) * w * 0.7 * t + (rnd() - 0.5) * 0.04, h * t * (0.75 + 0.25 * hash1(s, seed)), 0.02 + 0.015 * Math.sin(t * 9 + s)]); }
    g.surf(K_WOOD, 0.95); g.tube(pts, 0.014, 4, o.stem || [0.2, 0.17, 0.09], false);
    g.surf(K_LEAF, 0.8, 0, o.glow || 0);
    for (let q = 0; q < nl; q++) { const t = (q + rnd()) / nl, i = Math.min(4, Math.floor(t * 5)), f = t * 5 - i, x = lerp(pts[i][0], pts[i + 1][0], f) + (rnd() - 0.5) * 0.12, y = lerp(pts[i][1], pts[i + 1][1], f) + (rnd() - 0.5) * 0.08, sz = (o.size || 0.07) * (0.7 + 0.6 * rnd()), c = mul(o.bloom && rnd() < o.bloomP ? o.bloom : leaf[Math.floor(rnd() * leaf.length)], 0.8 + 0.4 * rnd());
      g.in(M(x, y, 0.035 + rnd() * 0.02, -20 + rnd() * 40, 0, rnd() * 360), () => g.poly([[0, -sz, 0], [sz * 0.6, 0, 0.012], [0, sz, 0], [-sz * 0.6, 0, 0.012]], 0, 0, 1, c)); }
  }
}
/** wall: a garland slung between two points w apart, beads of two colours */
function garland(g, w, sag, c1, c2, o = {}) {
  const n = Math.max(6, Math.round(w / 0.07));
  g.surf(K_LEAF, 0.8, 0, o.glow || 0);
  for (let i = 0; i <= n; i++) { const t = i / n, x = (t - 0.5) * w, y = -sag * Math.sin(t * Math.PI); g.in(M(x, y, 0.04), () => g.add(new THREE.IcosahedronGeometry(o.r || 0.035, 0), i % 3 === 0 ? c2 : mul(c1, 0.85 + 0.3 * hash1(i, 7)))); }
}
/** wall: a staring eye, lidded, its iris alight */
function eyeball(g, s, iris, o = {}) {
  g.surf(K_PLAIN, 0.3, 0, 0.25); g.in(M(0, 0, 0.02), () => g.add(new THREE.SphereGeometry(0.14 * s, nq(12), nq(8)).scale(1.25, 0.8, 0.6), (x, y, z) => (Math.hypot(x, y) < 0.02 * s && z > 0 ? [0.01, 0.01, 0.01] : Math.hypot(x, y) < 0.075 * s && z > 0 ? iris : mix([0.85, 0.8, 0.7], [0.6, 0.15, 0.1], smooth(0.08, 0.2, Math.hypot(x, y) / s)))));
  g.surf(K_PLAIN, 0.1, 0, 1.6); g.in(M(0, 0, 0.1 * s), () => g.add(new THREE.TorusGeometry(0.05 * s, 0.018 * s, 4, 10), iris));
  g.surf(K_PLAIN, 0.6, o.lidMetal ?? 0.7);
  for (const e of [-1, 1]) g.tube([[-0.2 * s, 0, 0.02], [-0.1 * s, e * 0.1 * s, 0.07 * s], [0.1 * s, e * 0.1 * s, 0.07 * s], [0.2 * s, 0, 0.02]], 0.022 * s, 5, o.lid || BRASS);
}
/** wall: a crust of barnacles and a hank of weed */
function seaCrust(g, s, seed = 0) {
  const rnd = rng(seed * 17 + 5);
  g.surf(K_PLAIN, 0.9);
  for (let i = 0; i < 9; i++) { const x = (rnd() - 0.5) * 0.5 * s, y = (rnd() - 0.5) * 0.4 * s, r = (0.018 + 0.024 * rnd()) * s; g.in(M(x, y, 0.01, 90, 0, 0), () => g.lathe([[r, 0], [r * 0.6, r * 0.9], [r * 0.35, r * 0.9], [r * 0.3, r * 0.3]], 6, mul([0.4, 0.41, 0.36], 0.7 + 0.5 * rnd()))); }
  g.surf(K_CLOTH, 0.7);
  for (let i = 0; i < 3; i++) g.in(M((i - 1) * 0.14 * s, -0.1 * s, 0.03), () => g.sheet(2, 6, (u, v) => [(u - 0.5) * 0.07 * s + 0.04 * s * Math.sin(v * 5 + i * 2), -v * (0.5 + 0.3 * rnd()) * s, 0.02 * Math.sin(v * 7 + i)], (x, y, z, nx, ny, nz, u, v) => mul([0.12, 0.3, 0.16], 0.7 + 0.6 * v)));
}
/** top: a standing stone h high: o.col, o.flat (slab), o.lean */
function megalith(g, h, r, seed = 0, o = {}) {
  g.surf(K_STONE, 0.96);
  const col = rockCol(o.col || rgb(0x7d8078), seed, o.moss ?? 0.6, 6);
  limb(g, [[0, -0.12, 0], [0.03 * h, h * 0.35, 0.02 * h], [(o.lean || 0) * h * 0.5, h * 0.75, 0], [(o.lean || 0) * h, h, 0]], [r * 1.1, r, r * 0.86, r * 0.5], { nu: nq(12), nv: nq(10), amp: 0.13, seed, nf: 2.2, sq: o.sq ?? 0.5, flat: o.flat || [1, 0.6], col: o.paint ? (x, y, z, nx, ny, nz, u, v) => o.paint(x, y, z, col(x, y, z, nx, ny), u, v) : col, capB: true });
}
/** top: a tapering obelisk with a capped point */
function obeliskOn(g, h, r, col, cap, o = {}) {
  g.surf(K_STONE, 0.85);
  g.in(M(0, 0, 0, 0, 45, 0), () => { g.lathe([[r * 1.5, -0.05], [r * 1.5, 0.08], [r * 1.05, 0.1], [r * 0.72, h * 0.86]], 4, col); g.surf(K_PLAIN, 0.3, o.capMetal ?? 0.9, o.capGlow || 0); g.lathe([[r * 0.72, h * 0.86], [0, h]], 4, cap); });
}
/** top: a column h high: a drum base, a shaft (plain or painted in bands) and a spreading capital */
function columnOn(g, h, r, col, cap, o = {}) {
  g.surf(K_STONE, 0.85);
  const sh = [[r * 1.4, -0.03], [r * 1.4, 0.05], [r * 1.05, 0.08]], ns = Math.max(1, Math.round((h - r * 1.6 - 0.1) / 0.11));
  for (let i = 0; i <= ns; i++) sh.push([lerp(r, r * 0.9, i / ns), lerp(0.1, h - r * 1.6, i / ns)]);
  g.lathe(sh, nq(10), col);
  g.surf(K_STONE, 0.8, o.capMetal || 0);
  g.lathe([[r * 0.9, h - r * 1.6], [r * 1.0, h - r * 1.2], [r * 1.5, h - r * 0.4], [r * 1.6, h - r * 0.1], [r * 1.6, h], [0, h]], nq(10), cap);
}
/** wall: the outline of an arch standing on the origin: shape 'point' | 'horse' | 'round' | 'ogee'; fill paints the opening */
function archFrame(g, w, h, shape, col, o = {}) {
  const pts = [], n = 12, sp = h - (shape === 'horse' ? w * 0.56 : shape === 'point' || shape === 'ogee' ? w * 0.8 : w * 0.5);
  pts.push([-w / 2, 0], [-w / 2, sp]);
  for (let i = 1; i < n; i++) { const t = i / n; let x, y;
    if (shape === 'horse') { const a = Math.PI * (1.18 - t * 1.36); x = Math.cos(a) * w * 0.56; y = sp + w * 0.1 + Math.sin(a) * w * 0.56; }
    else if (shape === 'point') { const e = t < 0.5 ? -1 : 1, q = t < 0.5 ? t * 2 : (1 - t) * 2; x = e * (w / 2) * (1 - q * q); y = sp + w * 0.8 * Math.sin(q * Math.PI / 2); }
    else if (shape === 'ogee') { const e = t < 0.5 ? -1 : 1, q = t < 0.5 ? t * 2 : (1 - t) * 2; x = e * (w / 2) * (1 - q) * (1 + 0.25 * Math.sin(q * Math.PI)); y = sp + w * 0.8 * (q * q * (3 - 2 * q)); }
    else { const a = Math.PI * (1 - t); x = Math.cos(a) * w / 2; y = sp + Math.sin(a) * w / 2; }
    pts.push([x, y]); }
  pts.push([w / 2, sp], [w / 2, 0]);
  if (o.fill) { g.surf(K_PLAIN, o.fillRough ?? 0.5, 0, o.fillGlow || 0); g.in(M(0, 0, 0.008), () => g.poly(pts.map((p) => [p[0], p[1], 0]), 0, 0, 1, o.fill)); }
  g.surf(o.kind ?? K_STONE, o.rough ?? 0.85, o.metal || 0);
  g.tube(pts.map((p) => [p[0], p[1], 0.02]), o.t || 0.035, 5, typeof col === 'function' ? col : (x, y, z, nx, ny, nz, t) => (o.stripe && Math.floor(t * 14) % 2 ? o.stripe : col), true);
}
/** wall: a small figure standing in a niche */
function nicheFigure(g, s, col, o = {}) {
  g.surf(K_PLAIN, 1); g.poly([[-0.1 * s, -0.16 * s, 0.004], [0.1 * s, -0.16 * s, 0.004], [0.1 * s, 0.12 * s, 0.004], [0, 0.22 * s, 0.004], [-0.1 * s, 0.12 * s, 0.004]], 0, 0, 1, o.back || [0.12, 0.06, 0.04]);
  g.surf(K_STONE, 0.8, o.metal || 0);
  g.in(M(0, -0.16 * s, 0.03), () => { g.lathe([[0.06, 0], [0.07, 0.03], [0.035, 0.09], [0.05, 0.16], [0.055, 0.22], [0.03, 0.25]].map(([r, y]) => [r * s, y * s]), 6, col); g.in(M(0, 0.29 * s, 0), () => g.add(new THREE.IcosahedronGeometry(0.04 * s, 0), col)); });
  g.surf(K_STONE, 0.85); g.in(M(0, -0.18 * s, 0.03), () => g.cbox(0.26 * s, 0.04 * s, 0.07, 0.008, o.sill || col));
}
/** top: a glass-and-brass lamp or reactor vessel alight inside */
function vessel(g, s, glowCol, o = {}) {
  const m = o.metalCol || BRASS;
  g.surf(K_PLAIN, 0.4, 0.85); g.lathe([[0.1, 0], [0.12, 0.03], [0.09, 0.07]].map(([r, y]) => [r * s, y * s]), nq(8), m);
  g.surf(K_PLAIN, 0.15, 0, o.glow ?? 0.95); g.lathe([[0.08, 0.07], [0.1, 0.16], [0.1, 0.34], [0.08, 0.43]].map(([r, y]) => [r * s, y * s]), nq(8), (x, y, z) => mul(glowCol, 0.7 + 0.5 * noise3(x * 30, y * 30, z * 30)));
  g.surf(K_PLAIN, 0.4, 0.85); g.lathe([[0.09, 0.43], [0.12, 0.46], [0.06, 0.52], [0.03, 0.6], [0, 0.62]].map(([r, y]) => [r * s, y * s]), nq(8), m);
  for (let i = 0; i < 3; i++) g.in(M(Math.cos(i * 2.09) * 0.1 * s, 0.25 * s, Math.sin(i * 2.09) * 0.1 * s), () => g.cbox(0.014 * s, 0.38 * s, 0.014 * s, 0.003, m));
}
/** top: crossed gable beams ending in beast heads (set across local X at a ridge end) */
function crossedBeams(g, s, col, o = {}) {
  const tc = woodTint(col, 5);
  for (const e of [-1, 1]) g.in(M(0, 0, 0, 0, 0, e * 32), () => {
    g.surf(K_WOOD, 0.88); g.in(M(0, 0.25 * s, 0, 0, 0, 90), () => g.beam(1.1 * s, 0.07 * s, 0.06 * s, 0.01, tc, 2));
    g.in(M(0, 0.8 * s, 0), () => horn(g, [[0, -0.05 * s, 0], [e * -0.03 * s, 0.12 * s, 0], [e * -0.16 * s, 0.24 * s, 0], [e * -0.3 * s, 0.22 * s, 0], [e * -0.36 * s, 0.14 * s, 0]], 0.05 * s, o.head || mul(col, 1.3), mul(col, 0.8), { rings: 18, nu: 6, nv: 10, rough: 0.8 }));
  });
}
/** top: a rack of poles hung with bones and scraps of hide */
function boneRack(g, w, h, seed = 0) {
  for (const e of [-1, 1]) g.in(M(e * w / 2, 0, 0, 0, 0, e * -5), () => stake(g, 0.03, h, seed + e, rgb(0x5a4630)));
  logTo(g, [-w / 2 - 0.06, h * 0.88, 0], [w / 2 + 0.06, h * 0.9, 0], 0.022, 0.02, seed + 3, { seg: 6, capB: true });
  const n = Math.max(2, Math.round(w / 0.16));
  for (let i = 0; i < n; i++) { const x = -w / 2 + (w * (i + 0.5)) / n, l = h * (0.25 + 0.3 * hash1(i, seed)); if (i % 3 === 1) { g.in(M(x, h * 0.88, 0.01), () => rag(g, 0.13, l, rgb(0x8a6a48), seed + i, 0.5)); } else bone(g, [x, h * 0.86, 0.01], [x + 0.02, h * 0.86 - l, 0.02], 0.016, seed + i); }
}
/** a daub of paint in the shape of a row of teeth, on a wall */
function teethGlyph(g, w, s, col, n = 5) {
  g.surf(K_PLAIN, 0.9);
  for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * (w / n), up = i % 2 === 0; g.in(M(x, 0, 0.012 + 0.002 * i), () => g.poly(up ? [[-w / n * 0.5, -0.02 * s, 0], [w / n * 0.5, -0.02 * s, 0], [0.01 * s, 0.2 * s, 0]] : [[-w / n * 0.5, 0.2 * s, 0], [w / n * 0.5, 0.2 * s, 0], [-0.01 * s, -0.02 * s, 0]], 0, 0, 1, mul(col, 0.8 + 0.4 * hash1(i, 3)))); }
}
/** wall: an iron plate, riveted (basalt keeps, scrap forts) */
function plate(g, w, h, col, o = {}) {
  g.surf(K_PLAIN, o.rough ?? 0.6, o.metal ?? 0.8);
  g.in(M(0, 0, 0.014), () => g.cbox(w, h, 0.026, 0.008, typeof col === 'function' ? col : (x, y, z) => mul(col, 0.75 + 0.45 * noise3(x * 13, y * 13, 3))));
  const nx = Math.max(2, Math.round(w / 0.16)), ny = Math.max(2, Math.round(h / 0.16));
  for (let i = 0; i < nx; i++) for (const e of [-1, 1]) g.in(M(-w / 2 + 0.035 + ((w - 0.07) * i) / (nx - 1), e * (h / 2 - 0.035), 0.027), () => g.stud(0.014, o.rivet || mul(typeof col === 'function' ? [0.2, 0.2, 0.2] : col, 1.5), 5));
  for (let j = 1; j < ny - 1; j++) for (const e of [-1, 1]) g.in(M(e * (w / 2 - 0.035), -h / 2 + 0.035 + ((h - 0.07) * j) / (ny - 1), 0.027), () => g.stud(0.014, o.rivet || mul(typeof col === 'function' ? [0.2, 0.2, 0.2] : col, 1.5), 5));
}
/** wall: a bell in a little arched frame (set on top of a front) */
function bellFrame(g, s, wall, bellCol = BRASS) {
  g.surf(K_PLASTER, 0.9);
  for (const e of [-1, 1]) g.in(M(e * 0.2 * s, 0.25 * s, 0), () => g.cbox(0.1 * s, 0.5 * s, 0.14, 0.012, wall));
  g.in(M(0, 0.56 * s, 0), () => prism(g, [[-0.27 * s, -0.06 * s], [0.27 * s, -0.06 * s], [0.27 * s, 0.02 * s], [0.14 * s, 0.14 * s], [0, 0.2 * s], [-0.14 * s, 0.14 * s], [-0.27 * s, 0.02 * s]], 0.15, wall, [0, 0]));
  g.surf(K_PLAIN, 0.35, 0.9); g.in(M(0, 0.18 * s, 0), () => g.lathe([[0.11, 0], [0.1, 0.03], [0.07, 0.12], [0.05, 0.2], [0.02, 0.24], [0, 0.3]].map(([r, y]) => [r * s, y * s]), nq(10), bellCol));
}
/** top: a fungus shelf cluster or toadstools in sickly colours */
function fungi(g, s, cap, seed = 0, glow = 0.6) { for (const [x, z, h, r] of [[0, 0, 0.34, 0.2], [0.16, 0.05, 0.2, 0.12], [-0.12, 0.1, 0.15, 0.1]]) g.in(M(x * s, 0, z * s, 0, seed * 40 + x * 200, 0), () => mushroom(g, h * s, r * s, cap, seed + x * 9, glow)); }
const antler = (g, s, seed = 0) => {
  const c = boneCol(seed, rgb(0xcbbf9c));
  g.surf(K_PLAIN, 0.7);
  limb(g, [[0, 0, 0], [0.06 * s, 0.3 * s, 0.04 * s], [0.2 * s, 0.6 * s, 0.02 * s], [0.42 * s, 0.86 * s, -0.04 * s], [0.5 * s, 1.1 * s, -0.02 * s]], [0.06 * s, 0.05 * s, 0.042 * s, 0.03 * s, 0.006 * s], { nu: nq(8), nv: nq(18), col: c });
  for (const [t, len, a] of [[0.25, 0.34, -30], [0.5, 0.4, -18], [0.74, 0.3, 24]]) g.in(M(0.5 * s * t * t + 0.1 * s * t, 1.0 * s * t, 0, 0, 0, a - 20), () => limb(g, [[0, 0, 0], [-0.03 * s, len * s * 0.5, 0.05 * s], [0.02 * s, len * s, 0.07 * s]], [0.034 * s, 0.026 * s, 0.004 * s], { nu: nq(7), nv: nq(8), col: c }));
};
const GOB_WOOD = [rgb(0x6b5236), rgb(0x8a7448), rgb(0x4d4230), rgb(0x5c5a34), rgb(0x7a4a2c), rgb(0x94805a)];
const GOB_PAINT = [rgb(0xb8342a), rgb(0xd9b83a), rgb(0x2f7a66)];
const rustCol = (seed = 0) => (x, y, z) => mul(mix(RUST, [0.13, 0.11, 0.1], smooth(0.35, 0.7, noise3(x * 7 + seed, y * 7, z * 7))), 0.65 + 0.6 * noise3(x * 23, y * 23 + seed, z * 23));
/** a patch of scrap plate on the local XY plane facing +Z */
function scrapPlate(g, w, h, seed) {
  g.surf(K_PLAIN, 0.8, 0.5);
  g.in(M(0, 0, 0.012), () => g.cbox(w, h, 0.022, 0.008, rustCol(seed)));
  g.surf(K_PLAIN, 0.6, 0.8);
  const nx = Math.max(2, Math.round(w / 0.14)), ny = Math.max(2, Math.round(h / 0.14));
  for (let i = 0; i < nx; i++) for (const e of [-1, 1]) g.in(M(-w / 2 + 0.035 + ((w - 0.07) * i) / (nx - 1), e * (h / 2 - 0.035), 0.023), () => g.stud(0.014, IRON, 6));
  for (let j = 1; j < ny - 1; j++) for (const e of [-1, 1]) g.in(M(e * (w / 2 - 0.035), -h / 2 + 0.035 + ((h - 0.07) * j) / (ny - 1), 0.023), () => g.stud(0.014, IRON, 6));
}
/** a hide stretched over something: fn(u, v) -> point; patches of other hides are stitched on by colour */
function hideSheet(g, nu, nv, fn, col, seed, flip = false) {
  const alt = [mul(col, 0.72), mix(col, rgb(0x7a5a30), 0.6), mix(col, rgb(0xc8b070), 0.5)];
  g.surf(K_CLOTH, 0.95);
  g.sheet(nq(nu), nq(nv), fn, (x, y, z, nx, ny, nz, u, v) => {
    const cu = u * 3.3 + 0.35 * noise3(v * 3 + seed, 1, 2), cv = v * 2.6 + 0.35 * noise3(u * 3, seed, 5), iu = Math.floor(cu), iv = Math.floor(cv), h = hash1(iu, iv, seed);
    const edge = Math.min(cu - iu, 1 - (cu - iu), cv - iv, 1 - (cv - iv)), base = h < 0.45 ? col : alt[Math.floor(h * 3) % 3];
    const stitch = edge < 0.05 ? (Math.floor((cu + cv) * 24) % 2 ? 0.35 : 0.6) : 1;
    return mul(base, stitch * (0.75 + 0.4 * noise3(x * 8 + seed, y * 8, z * 8)));
  }, false, flip);
}
// ---------- more of the factions.js kit: windows, domes, finials ----------
function flatDown(g, pts, col) {
  const a = pts[0], b = pts[1], c = pts[2];
  if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0) pts = pts.slice().reverse();
  g.flat(pts, col);
}
/** a wall face W x H on the local XY plane facing +Z (origin at its lower left), fine enough to carry a painted pattern */
function wallFace(g, W, H, col, d = 0.13) { g.sheet(Math.max(1, Math.round(W / d)), Math.max(1, Math.round(H / d)), (u, v) => [u * W, v * H, 0], col); }
function windowPane(g, w, h, o) {
  const sh = o.shape || 'sq', pts = [[-w / 2, -h / 2], [w / 2, -h / 2]], y1 = h / 2 - (sh === 'sq' || sh === 'screen' ? 0 : w / 2);
  if (sh === 'sq' || sh === 'screen') pts.push([w / 2, h / 2], [-w / 2, h / 2]);
  else if (sh === 'point') pts.push([w / 2, y1], [w * 0.28, y1 + w * 0.42], [0, y1 + w * 0.8], [-w * 0.28, y1 + w * 0.42], [-w / 2, y1]);
  else { const k = sh === 'horse' ? 1.22 : 1; for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * (sh === 'horse' ? 1.3 : 1) - (sh === 'horse' ? 0.15 * Math.PI : 0); pts.push([Math.cos(a) * w * 0.5 * k, y1 + (sh === 'horse' ? w * 0.12 : 0) + Math.sin(a) * w * 0.5 * k]); } }
  g.surf(K_PLAIN, 0.4, 0, o.glow ?? 0.9);
  if (sh === 'screen') { g.sheet(4, 4, (u, v) => [(u - 0.5) * w, (v - 0.5) * h, 0], (x, y, z, nx, ny, nz, u, v) => ((Math.round(u * 4) % 2 === 0 && u > 0.01 && u < 0.99) || Math.abs(v - 0.5) < 0.01 ? mul(o.col, 0.82) : o.col)); }
  else g.poly(pts.map((p) => [p[0], p[1], 0]), 0, 0, 1, o.col);
  if (o.trim) {
    g.surf(o.trimKind ?? K_STONE, 0.85, o.trimMetal || 0);
    g.in(M(0, -h / 2 - 0.025, 0.01), () => g.cbox(w + 0.1, 0.045, 0.06, 0.008, o.trim));
    if (sh === 'sq' || sh === 'screen') { g.in(M(0, h / 2 + 0.025, 0.01), () => g.cbox(w + 0.1, 0.045, 0.06, 0.008, o.trim)); for (const e of [-1, 1]) g.in(M(e * (w / 2 + 0.02), 0, 0.008), () => g.cbox(0.04, h, 0.04, 0.006, o.trim)); }
    if (sh === 'screen') { g.in(M(0, 0, 0.006), () => g.cbox(0.025, h, 0.02, 0.004, o.trim)); g.in(M(0, 0, 0.006), () => g.cbox(w, 0.025, 0.02, 0.004, o.trim)); }
  }
}
const DOME = {
  hemi: [[1, 0], [0.985, 0.17], [0.93, 0.36], [0.82, 0.57], [0.66, 0.75], [0.45, 0.89], [0.22, 0.975], [0, 1]],
  low: [[1, 0], [0.97, 0.12], [0.88, 0.26], [0.72, 0.4], [0.5, 0.52], [0.25, 0.6], [0, 0.63]],
  point: [[1, 0], [1.0, 0.2], [0.95, 0.45], [0.83, 0.72], [0.64, 0.98], [0.42, 1.2], [0.2, 1.37], [0.06, 1.47], [0, 1.5]],
  onion: [[0.62, 0], [0.74, 0.08], [0.92, 0.24], [1.0, 0.44], [0.98, 0.64], [0.86, 0.85], [0.66, 1.05], [0.44, 1.24], [0.25, 1.42], [0.11, 1.6], [0.04, 1.8], [0, 1.92]],
  bulb: [[0.8, 0], [0.95, 0.14], [1.0, 0.36], [0.92, 0.6], [0.72, 0.82], [0.46, 1.0], [0.22, 1.14], [0.08, 1.3], [0, 1.4]],
  cone: [[1, 0], [0, 1]],
  bell: [[1.08, 0], [0.86, 0.1], [0.62, 0.3], [0.42, 0.56], [0.26, 0.86], [0.13, 1.2], [0.04, 1.55], [0, 1.7]],
  tent: [[1.04, 0], [0.96, 0.06], [0.66, 0.5], [0.36, 1.0], [0.1, 1.5], [0, 1.7]],
  sweep: [[1.2, 0.1], [1.05, 0.02], [0.84, 0.08], [0.6, 0.24], [0.4, 0.46], [0.24, 0.72], [0.1, 1.0], [0, 1.12]],
};
const profTop = (p) => p[p.length - 1][1];
/** what stands on the very top: o.finial = 'ball' | 'spike' | 'crystal' | 'lantern' | 'disc' | 'flame' | 'bud'; s = size */
function finial(g, kind, s, o = {}) {
  const col = o.fin || GOLD, keep = [g.kind, g.rough, g.metal, g.glow];
  g.surf(K_PLAIN, 0.35, o.finMetal ?? 0.9);
  if (kind === 'ball') g.lathe([[0.05, -0.04], [0.035, 0.03], [0.1, 0.1], [0.11, 0.18], [0.07, 0.26], [0.02, 0.3], [0.05, 0.36], [0.02, 0.42], [0.012, 0.6], [0, 0.66]].map(([r, y]) => [r * s, y * s]), nq(10), col);
  else if (kind === 'spike') g.lathe([[0.06, -0.04], [0.04, 0.04], [0.07, 0.1], [0.03, 0.18], [0.02, 0.6], [0, 0.95]].map(([r, y]) => [r * s, y * s]), nq(8), col);
  else if (kind === 'bud') g.lathe([[0.05, -0.04], [0.04, 0.05], [0.12, 0.12], [0.15, 0.24], [0.1, 0.4], [0.03, 0.56], [0, 0.62]].map(([r, y]) => [r * s, y * s]), nq(10), col);
  else if (kind === 'disc') { g.lathe([[0.04, -0.04], [0.03, 0.2]].map(([r, y]) => [r * s, y * s]), 6, col); g.in(M(0, 0.42 * s, 0, 90, 0, 0), () => g.lathe([[0, 0.03], [0.2, 0.025], [0.24, 0], [0.2, -0.025], [0, -0.03]].reverse().map(([r, y]) => [r * s, y * s]), nq(14), col)); }
  else if (kind === 'crystal') { g.lathe([[0.07, -0.04], [0.05, 0.06], [0.09, 0.1], [0.05, 0.14]].map(([r, y]) => [r * s, y * s]), nq(8), col); g.in(M(0, 0.12 * s, 0), () => crystal(g, 0.085 * s, 0.7 * s, o.seed || 3, { deep: o.deep, bright: o.bright, glow: o.cglow ?? 1.2 })); }
  else if (kind === 'lantern') { g.surf(o.lanKind ?? K_STONE, 0.85); g.cyl(0.16 * s, 0.16 * s, 0.26 * s, nq(10), o.lan || [0.8, 0.78, 0.7], false, true); g.surf(K_PLAIN, 0.4, 0, 0.9); for (let i = 0; i < 4; i++) g.in(M(0, 0.13 * s, 0, 0, i * 90, 0).multiply(M(0, 0, 0.162 * s)), () => g.poly([[-0.04 * s, -0.08 * s, 0], [0.04 * s, -0.08 * s, 0], [0.04 * s, 0.06 * s, 0], [0, 0.1 * s, 0], [-0.04 * s, 0.06 * s, 0]], 0, 0, 1, o.lanGlow || [1, 0.7, 0.3])); g.surf(K_ROOF, 0.7, o.capMetal || 0); g.in(M(0, 0.26 * s, 0), () => g.lathe(DOME.hemi.map(([r, y]) => [r * 0.2 * s, y * 0.2 * s]), nq(10), o.capCol || col)); g.surf(K_PLAIN, 0.35, 0.9); g.in(M(0, 0.46 * s, 0), () => g.lathe([[0.03, 0], [0.045, 0.05], [0.012, 0.1], [0, 0.3]].map(([r, y]) => [r * s, y * s]), 6, col)); }
  else if (kind === 'flame') { g.lathe([[0.1, -0.04], [0.14, 0.04], [0.16, 0.1], [0.1, 0.12]].map(([r, y]) => [r * s, y * s]), nq(8), col); g.in(M(0, 0.1 * s, 0), () => fire(g, 0.6 * s, o.flame || FIRE_HOT, o.seed || 1, o.fglow ?? 1.4)); }
  [g.kind, g.rough, g.metal, g.glow] = keep;
}
/** a dome (or any DOME outline) of base radius R standing on the local origin, on a drum; returns its top */
function domeOn(g, R, o, seed = 1) {
  const prof = DOME[o.shape || 'hemi'], dh = R * (o.drum ?? 0.28), seg = nq(o.seg || 22), dc = o.drumCol || [0.75, 0.72, 0.65], top = dh + profTop(prof) * R * (o.hk || 1);
  if (dh > 0.01) {
    g.surf(o.drumKind ?? K_STONE, 0.9);
    g.lathe([[R * 0.97, 0], [R * 0.97, dh * 0.82], [R * 1.03, dh * 0.86], [R * 1.03, dh]], seg, dc);
    if (o.drumWin) { g.surf(K_PLAIN, 0.4, 0, o.drumGlow ?? 0.8); const nw = o.drumN || 8; for (let i = 0; i < nw; i++) g.in(M(0, dh * 0.42, 0, 0, (i + 0.5) * (360 / nw), 0).multiply(M(0, 0, R * 0.975)), () => g.poly([[-0.05 * R, -dh * 0.3, 0], [0.05 * R, -dh * 0.3, 0], [0.05 * R, dh * 0.16, 0], [0, dh * 0.3, 0], [-0.05 * R, dh * 0.16, 0]], 0, 0, 1, o.drumWin)); }
  }
  g.surf(o.kind ?? K_ROOF, o.rough ?? 0.6, o.metal || 0, o.glow || 0);
  const H = profTop(prof) * R * (o.hk || 1), col = o.col;
  g.in(M(0, dh, 0), () => g.lathe(prof.map(([r, y]) => [r * R, y * R * (o.hk || 1)]), seg, typeof col === 'function' ? (x, y, z) => col(Math.atan2(z, x), y / H, x, y, z, seed) : col));
  if (o.ribs) { g.surf(K_STONE, 0.8); const hk = o.hk || 1; for (let i = 0; i < o.ribs; i++) { const a = ((i + 0.5) / o.ribs) * TAU; g.tube(prof.map(([r, y]) => [Math.cos(a) * (r * R + 0.012), dh + y * R * hk + 0.006, Math.sin(a) * (r * R + 0.012)]), Math.max(0.022, R * 0.035), 4, o.ribCol || [0.9, 0.88, 0.8], false); } }
  if (o.finial) g.in(M(0, top - 0.01, 0), () => finial(g, o.finial, o.finS || clamp(R * 0.9, 0.35, 1.3), o));
  return top + (o.finial ? 0.4 * (o.finS || clamp(R * 0.9, 0.35, 1.3)) : 0);
}
// dome and roof colourings: (angle, t 0..1 up the dome, x, y, z, seed) -> rgb
const domeSpiral = (c1, c2, n = 6, tw = 1.6) => (a, t, x, y, z) => mul(tri1((a / TAU) * n + t * tw) > 0.5 ? c1 : c2, 0.86 + 0.22 * noise3(x * 6, y * 6, z * 6));
const domeBands = (c1, c2, n = 5, w = 0.25) => (a, t, x, y, z) => mul(tri1(t * n) < w ? c2 : c1, 0.88 + 0.2 * noise3(x * 7, y * 7, z * 7));
const domeTiles = (pal, f = 9) => (a, t, x, y, z) => mul(pal[Math.floor(hash1(Math.round((a / TAU) * f * 4 * (1.1 - t)), Math.round(t * f * 2)) * pal.length) % pal.length], 0.82 + 0.3 * tri1(t * f * 2));
const thatchCol = (base, seed = 0, dark = 0.72, moss = 0) => (x, y, z, nx, ny, nz) => { const s = Math.abs(nx) > Math.abs(nz) ? z : x; let c = mul(base, (0.55 + 0.7 * noise3(s * 13 + seed, y * 2.2, 1.5)) * (0.72 + 0.28 * tri1(y * 3.3)) * (ny > 0.95 ? dark : 1)); if (moss) c = mix(c, [0.16, 0.24, 0.07], moss * smooth(0.45, 0.7, noise3(x * 1.6 + seed, y * 1.6, z * 1.6))); return c; };
const leafCol = (pal, seed = 0, bloom = null) => (x, y, z, nx, ny) => { const d = cells3(x * 2.6 + seed, y * 2.6, z * 2.6), q = hash1(Math.round(x * 2.6 + seed), Math.round(y * 2.6), Math.round(z * 2.6)), f = cells3(x * 7 + seed, y * 7, z * 7); if (bloom && f < 0.1 && q > 0.6) return bloom; return mul(pal[Math.floor(q * pal.length) % pal.length], (0.3 + 0.75 * smooth(0.0, 0.5, d)) * (0.55 + 0.6 * smooth(0.05, 0.4, f)) * (0.55 + 0.4 * hash1(Math.round(q * 97), seed)) * (0.7 + 0.35 * (ny || 0.5))); };
const tusk = (g, s, curl = 1) => horn(g, [[0, -0.2 * s, -0.04], [0, 0.2 * s, 0.16 * s * curl], [0, 0.6 * s, 0.26 * s * curl], [0, 1.0 * s, 0.14 * s * curl], [0, 1.25 * s, -0.08 * s * curl]], 0.1 * s, mul(BONE, 1.05), rgb(0x8a7a5a), { rings: 26, nu: nq(12), nv: nq(22) });
/** the skull of some great horned beast, about 1.3 long, snout toward +Z, resting on y = 0 (sculpted once) */
function beastSkullGeo() {
  return geoOnce('beastSkull', () => {
    const c = 0xd9d0b4, d = 0x1a1612, P = [];
    P.push(S.ellipsoid(0.3, 0.26, 0.32).at(0, 0.36, -0.2).color(c).tint(0.14, 12).bump(0.006, 16, 'noise'));
    P.push(S.capsule([0, 0.3, 0], [0, 0.2, 0.62], 0.2, 0.12).color(c).blend(0.08));
    P.push(S.ellipsoid(0.17, 0.1, 0.16).at(0, 0.2, 0.68).color(0xcfc4a4).blend(0.05));
    P.push(...S.mirrorX([S.ellipsoid(0.12, 0.07, 0.2).rot(0, 12, 0).at(0.24, 0.26, 0.02).color(c).blend(0.05)]));          // cheek arches
    P.push(...S.mirrorX([S.ellipsoid(0.1, 0.06, 0.1).at(0.2, 0.5, -0.02).color(c).blend(0.04)]));                             // brow bosses
    P.push(...S.mirrorX([S.ellipsoid(0.1, 0.095, 0.11).at(0.19, 0.36, 0.08).color(d).cut(0.02)]));                            // eye sockets
    P.push(...S.mirrorX([S.ellipsoid(0.05, 0.05, 0.1).rot(-20, 0, 0).at(0.06, 0.27, 0.72).color(d).cut(0.014)]));             // nostrils
    P.push(S.box(0.5, 0.1, 0.9, 0.03).at(0, 0.06, 0.34).color(d).cut(0.02));                                                 // hollow underneath
    for (let i = 0; i < 6; i++) P.push(...S.mirrorX([S.cone(0.028, 0.006, 0.12 - (i > 3 ? 0.03 : 0), 0.004).rot(180, 0, 0).at(0.1 + (i < 2 ? i * 0.03 : 0.05), 0.09, 0.74 - i * 0.1).color(0xe8e0c8).blend(0.006)]));
    P.push(...S.mirrorX([S.cone(0.05, 0.008, 0.26, 0.004).rot(170, 0, 8).at(0.13, 0.05, 0.66).color(0xe8e0c8).blend(0.008)]));  // fangs
    P.push(S.capsule([0, 0.5, -0.3], [0, 0.42, 0.3], 0.03, 0.02).color(0xb8ac8c).paint(0.01, 0.008));                         // ridge along the crown
    return buildPartGeometry({ prims: P }, { res: 25 * qual(), ao: 0.8 });
  });
}
function beastSkull(g, s = 1) {
  g.surf(K_PLAIN, 0.75);
  g.in(M(0, 0, 0, 0, 0, 0, s), () => {
    g.add(beastSkullGeo());
    for (const e of [-1, 1]) horn(g, [[e * 0.24, 0.5, -0.22], [e * 0.52, 0.62, -0.3], [e * 0.74, 0.86, -0.16], [e * 0.72, 1.12, 0.1], [e * 0.56, 1.24, 0.32]], 0.1, rgb(0x3a3028), rgb(0xa89878), { rings: 40, nu: nq(12), nv: nq(26) });
  });
}

// =====================================================================================================
// Landmark kit: the pieces the sixteen buildings below share
// =====================================================================================================
const HIDE = rgb(0xb0905e), HIDE_DARK = rgb(0x7a5a3a), OCHRE = rgb(0x9a3a24), RAW_WOOD = rgb(0x8a6a42), COPPER = rgb(0xb5683a), VERDIGRIS = rgb(0x4f9a84);
const MARBLE = rgb(0xe4ded0), SANDSTONE = rgb(0xc9a06a), WHITEWASH = rgb(0xe9e3d4), GLASS = [0.07, 0.1, 0.15], LAMPLIT = [1.0, 0.72, 0.32];
const TILE_GREY = sw(0x565a62, 0x4a4e56, 0x62666e, 0x50545c), TURQ = sw(0x1fa39c, 0x2ab4ae, 0x188c8c, 0x35bdb0, 0x1a98a8), TERRA = sw(0xc8643a, 0xb85830, 0xd47444, 0xa84e2c, 0xbe6a40), RED_TILE = sw(0xb8402a, 0xa83a26, 0xc64e30, 0x9c3422);
const SLATE_DARK = sw(0x3c4450, 0x343c48, 0x464e5a, 0x2e3640), COPPER_GREEN = sw(0x4f9a84, 0x458c78, 0x5aa890, 0x3f8270, 0x62ac98);
const v3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a flat facet whose face looks along `dir` (so the order its corners are listed in does not matter) */
function facet(g, pts, cols, dir = [0, 0, 1]) {
  const a = pts[0], b = pts[1], c = pts[2];
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (nx * dir[0] + ny * dir[1] + nz * dir[2] < 0) { pts = pts.slice().reverse(); if (Array.isArray(cols[0])) cols = cols.slice().reverse(); }
  g.flat(pts, cols);
}
/** a plain box (no chamfer): 12 triangles */
const bx = (g, w, h, d, c) => g.cbox(w, h, d, 0, c);
/** brick: the kit's coursed stone at brick size, one face per brick. The courses coarsen on the lower presets. */
function brickStyle(hex, seed, o = {}) {
  const c = rgb(hex);
  return stoneStyle(hex, { course: 0.11 / qual(), len: [0.2 / qual(), 0.34 / qual()], cell: 9, r: 0.008, b: 0.012, chip: 0.02, var: 0.14, rough: 0.002, bump: 0.3, seed,
    pal: [c, c, mul(c, 0.8), mul(c, 1.15), mix(c, rgb(0x4a2420), 0.45), mix(c, rgb(0xc8703a), 0.35), mix(c, rgb(0x6a5a52), 0.3)], mortar: [0.4, 0.36, 0.3], ...o });
}
/** rough field stone laid dry: deep joints, uneven faces */
const dryStone = (hex, seed, o = {}) => stoneStyle(hex, { course: 0.13 / qual(), len: [0.14 / qual(), 0.36 / qual()], cell: 0.16 / qual(), r: 0.035, b: 0.03, chip: 0.4, var: 0.22, rough: 0.02, bump: 1.6, nf: 14, seed, mortar: [0.03, 0.03, 0.028], ...o });
/** big dressed blocks for bases and piers */
const blockStyle = (hex, seed, o = {}) => stoneStyle(hex, { course: 0.2, len: [0.34, 0.62], cell: 0.2 / qual(), chip: 0.2, seed, ...o });

/** the outline of an arch over an opening w wide springing at height sp, left to right: 'round' | 'horse' | 'point' */
function archPts(w, sp, shape = 'round', n = 10) {
  const pts = [], h = w / 2;
  if (shape === 'point') {
    const rho = w * 0.8, cx = rho - h, aE = Math.acos(-cx / rho), m = Math.max(2, n >> 1);
    for (let i = 0; i <= m; i++) { const a = lerp(Math.PI, aE, i / m); pts.push([cx + rho * Math.cos(a), sp + rho * Math.sin(a)]); }
    for (let i = m - 1; i >= 0; i--) pts.push([-pts[i][0], pts[i][1]]);
  } else {
    const k = shape === 'horse' ? 0.36 * h : 0, R = Math.hypot(h, k), d = Math.asin(k / R);
    for (let i = 0; i <= n; i++) { const a = lerp(Math.PI + d, -d, i / n); pts.push([R * Math.cos(a), sp + k + R * Math.sin(a)]); }
  }
  return pts;
}
const archTop = (w, sp, shape) => archPts(w, sp, shape, 8).reduce((m, p) => Math.max(m, p[1]), 0);
/**
 * A wall pierced by arches: W x H on the local XY plane (origin at its lower left), front face at z = 0 looking +Z,
 * o.t thick behind it. opens = [{ x (centre), w, sp (spring height), shape, y0 (sill) }]. o: col, inCol (the
 * reveals), back (false = no rear face), cap (close the top), d (face grid size, for painted patterns).
 */
function archWall(g, W, H, opens, o = {}) {
  const t = o.t ?? 0.3, col = o.col || [0.7, 0.7, 0.7], inC = o.inCol || col, d = o.d || 0.3;
  const faces = o.back === false ? [[0, 1]] : [[0, 1], [-t, -1]];
  const rect = (x0, x1, y0, y1, z, nz) => {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return;
    const nu = Math.max(1, Math.round((x1 - x0) / d)), nv = Math.max(1, Math.round((y1 - y0) / d)), id = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) id.push(g.vc(lerp(x0, x1, i / nu), lerp(y0, y1, j / nv), z, 0, 0, nz, col));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = j * (nu + 1) + i; g.quad(id[q], id[q + 1], id[q + nu + 2], id[q + nu + 1]); }
  };
  let x = 0;
  for (const op of opens.slice().sort((p, q) => p.x - q.x)) {
    const pts = archPts(op.w, op.sp, op.shape, op.n || nq(10)).map((p) => [p[0] + op.x, p[1]]);
    const xl = op.x - op.w / 2, xr = op.x + op.w / 2, y0 = op.y0 || 0;
    let iL = 0, iR = pts.length - 1;
    pts.forEach((p, i) => { if (p[0] < pts[iL][0] - 1e-9) iL = i; if (p[0] > pts[iR][0] + 1e-9) iR = i; });
    const a = pts[iL][0], b = pts[iR][0];
    for (const [z, nz] of faces) {
      const V = (px, py) => g.vc(px, py, z, 0, 0, nz, col);
      rect(x, a, 0, H, z, nz); rect(a, xl, 0, op.sp, z, nz); rect(xr, b, 0, op.sp, z, nz);
      if (y0 > 0) rect(xl, xr, 0, y0, z, nz);
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        if (i < iL) g.quad(V(p[0], p[1]), V(q[0], q[1]), V(a, q[1]), V(a, p[1]));
        else if (i >= iR) g.quad(V(p[0], p[1]), V(q[0], q[1]), V(b, q[1]), V(b, p[1]));
        else g.quad(V(p[0], p[1]), V(q[0], q[1]), V(q[0], H), V(p[0], H));
      }
    }
    // the reveals: jambs, the soffit of the arch, the sill
    const cy = (pts[iL][1] + pts[iR][1]) / 2, I = (px, py, z, nx, ny) => g.vc(px, py, z, nx, ny, 0, inC);
    if (op.sp - y0 > 1e-4) for (const [xx, nx] of [[xl, 1], [xr, -1]]) g.quad(I(xx, y0, 0, nx, 0), I(xx, op.sp, 0, nx, 0), I(xx, op.sp, -t, nx, 0), I(xx, y0, -t, nx, 0));
    let pa = -1, pb = -1;
    for (const p of pts) {
      const dx = op.x - p[0], dy = cy - p[1], l = Math.hypot(dx, dy) || 1, qa = I(p[0], p[1], 0, dx / l, dy / l), qb = I(p[0], p[1], -t, dx / l, dy / l);
      if (pa >= 0) g.quad(pa, qa, qb, pb);
      pa = qa; pb = qb;
    }
    if (y0 > 0) g.quad(I(xl, y0, 0, 0, 1), I(xr, y0, 0, 0, 1), I(xr, y0, -t, 0, 1), I(xl, y0, -t, 0, 1));
    x = b;
  }
  for (const [z, nz] of faces) rect(x, W, 0, H, z, nz);
  if (o.cap) g.quad(g.vc(0, H, 0, 0, 1, 0, col), g.vc(W, H, 0, 0, 1, 0, col), g.vc(W, H, -t, 0, 1, 0, col), g.vc(0, H, -t, 0, 1, 0, col));
  if (o.ends) for (const [xx, nx] of [[0, -1], [W, 1]]) g.quad(g.vc(xx, 0, 0, nx, 0, 0, col), g.vc(xx, H, 0, nx, 0, 0, col), g.vc(xx, H, -t, nx, 0, 0, col), g.vc(xx, 0, -t, nx, 0, 0, col));
}
/** the ring of arch stones round an opening (same fields as archWall's), alternating two colours, standing `z` proud */
function voussoirs(g, op, band, c1, c2, z = 0.012, n = 9) {
  const pts = archPts(op.w, op.sp, op.shape, n);
  let cy = 0; for (const p of pts) cy += p[1] / pts.length;
  cy = Math.min(cy, (pts[0][1] + Math.max(...pts.map((p) => p[1]))) / 2);
  const out = pts.map((p) => { const dx = p[0], dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + (dx / l) * band, p[1] + (dy / l) * band]; });
  for (let i = 0; i < pts.length - 1; i++) {
    const c = i % 2 ? c1 : c2, k = (i === (pts.length - 1) >> 1) ? 1.5 : 1;
    facet(g, [[op.x + pts[i][0], pts[i][1], z * k], [op.x + pts[i + 1][0], pts[i + 1][1], z * k], [op.x + out[i + 1][0], out[i + 1][1], z * k], [op.x + out[i][0], out[i][1], z * k]], c);
    facet(g, [[op.x + out[i][0], out[i][1], z * k], [op.x + out[i + 1][0], out[i + 1][1], z * k], [op.x + out[i + 1][0], out[i + 1][1], 0], [op.x + out[i][0], out[i][1], 0]], mul(c, 0.7), [out[i][0], out[i][1] - cy, 0.2]);
  }
}
/**
 * A window on the local XY plane facing +Z, centred. o: arch (round head), glass, glow, frame (colour), ft (frame
 * width), bars [across, up], sill, shutters (colour), z (how far the frame stands out), kind (frame surface).
 */
function win(g, w, h, o = {}) {
  const fr = o.frame || [0.88, 0.86, 0.8], gl = o.glass || GLASS, ft = o.ft || 0.035, zf = o.z || 0.03, hs = o.arch ? h - w / 2 : h, yb = -h / 2, ys = yb + hs;
  const pts = [[-w / 2, yb], [w / 2, yb], [w / 2, ys]];
  if (o.arch) for (let i = 1; i < 8; i++) { const a = (i / 8) * Math.PI; pts.push([Math.cos(a) * w / 2, ys + Math.sin(a) * w / 2]); }
  pts.push([-w / 2, ys]);
  g.surf(K_PLAIN, 0.2, 0.1, o.glow || 0);
  g.poly(pts.map((p) => [p[0], p[1], zf * 0.5]), 0, 0, 1, typeof gl === 'function' ? gl : (x, y) => mul(gl, 0.75 + 0.6 * smooth(yb, -yb, y + x * 0.5)));
  g.surf(o.kind ?? K_STONE, 0.8);
  for (const e of [-1, 1]) g.in(M(e * (w / 2 + ft / 2), yb + hs / 2, zf / 2), () => bx(g, ft, hs, zf, fr));
  g.in(M(0, yb - ft / 2, zf * 0.75), () => g.cbox(w + ft * (o.sill ? 4 : 2), ft, zf * 1.5 + (o.sill ? 0.03 : 0), 0.006, fr));
  if (o.arch) { const ap = []; for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; ap.push([Math.cos(a) * (w / 2 + ft / 2), ys + Math.sin(a) * (w / 2 + ft / 2), zf * 0.6]); } g.tube(ap, ft * 0.6, 4, fr, true); }
  else g.in(M(0, ys + ft / 2, zf * 0.6), () => g.cbox(w + ft * 2.6, ft * 1.1, zf * 1.2, 0.006, fr));
  const bars = o.bars || [1, 2], bc = o.barCol || fr;
  for (let i = 1; i <= bars[0]; i++) g.in(M(-w / 2 + (w * i) / (bars[0] + 1), yb + hs / 2, zf * 0.55), () => bx(g, 0.016, hs, 0.012, bc));
  for (let j = 1; j <= bars[1]; j++) g.in(M(0, yb + (hs * j) / (bars[1] + 1), zf * 0.55), () => bx(g, w, 0.016, 0.012, bc));
  if (o.shutters) {
    const sw2 = o.sw || w * 0.48, sc = o.shutters;
    g.surf(K_WOOD, 0.8);
    for (const e of [-1, 1]) g.in(M(e * (w / 2 + ft + sw2 / 2 + 0.004), yb + hs / 2, 0.016), () => { g.cbox(sw2, hs, 0.022, 0.005, (x, y) => mul(sc, 0.72 + 0.4 * tri1(y * 13))); g.in(M(0, 0, 0.012), () => { for (const yy of [-hs * 0.3, hs * 0.3]) g.in(M(0, yy, 0), () => bx(g, sw2 * 0.9, 0.02, 0.008, IRON)); }); });
  }
}
/** a tiled gable roof: ridge along Z at height rY, eaves at x = +-ex (height eY), running from z = -ez to ez. o.sag hollows the slopes */
function gableRoof(g, ex, ez, eY, rY, pal, seed, o = {}) {
  const tw = o.tw || 0.17, th = o.th || 0.15, sl = Math.hypot(ex, rY - eY), rows = Math.max(3, Math.round(sl / th)), sag = o.sag || 0;
  g.surf(K_ROOF, o.rough ?? 0.8, o.metal || 0);
  for (const e of [-1, 1]) tiles(g, rows, () => (2 * ez) / tw, (u, v) => { const k = Math.min(v, 0.99); return [e * lerp(ex, 0, k), lerp(eY, rY, k) - sag * Math.sin(k * Math.PI), e * (1 - 2 * u) * ez]; }, { pal, lift: o.lift || 0.02, seed: seed + e + 2, round: o.round });
  g.surf(K_PLAIN, 0.5, o.ridgeMetal ?? 0.6);
  ridge(g, [0, rY + 0.02, -ez - 0.03], [0, rY + 0.02, ez + 0.03], o.ridgeR || 0.055, o.ridgeCol || LEAD, seed + 5);
  g.surf(K_PLAIN, 1);
  for (const e of [-1, 1]) facet(g, [[e * ex, eY - 0.012, -ez], [e * ex, eY - 0.012, ez], [0, rY - 0.015, ez], [0, rY - 0.015, -ez]], [0.035, 0.03, 0.026], [e, -1, 0]);
}
/**
 * A skirt of tiled roof round a rectangle: eaves at +-ex, +-ez (height eY) rising to +-ix, +-iz (height iY).
 * o: lift (how far the corners turn up), sag (hollow of the slope), pal, round, hips (colour of the hip ridges, null = none)
 */
function skirtRoof(g, ex, ez, eY, ix, iz, iY, pal, seed, o = {}) {
  const lift = o.lift || 0, sag = o.sag || 0, tw = o.tw || 0.18, th = o.th || 0.16;
  const P = (s, u, v) => {
    const A = s % 2 ? ez : ex, B = s % 2 ? ex : ez, a = s % 2 ? iz : ix, b = s % 2 ? ix : iz, k = Math.min(v, 0.995);
    const al = lerp(lerp(-A, A, u), lerp(-a, a, u), k), out = lerp(B, b, k), y = lerp(eY, iY, k) - sag * Math.sin(k * Math.PI) + lift * Math.pow(Math.abs(2 * u - 1), 3) * (1 - k) * (1 - k);
    return s === 0 ? [al, y, out] : s === 1 ? [out, y, -al] : s === 2 ? [-al, y, -out] : [-out, y, al];
  };
  g.surf(K_ROOF, o.rough ?? 0.75, o.metal || 0);
  for (let s = 0; s < 4; s++) {
    const A = s % 2 ? ez : ex, a = s % 2 ? iz : ix, B = s % 2 ? ex : ez, b = s % 2 ? ix : iz, rows = Math.max(2, Math.round(Math.hypot(B - b, iY - eY) / th));
    tiles(g, rows, (j) => Math.max(1, (2 * lerp(A, a, (j + 0.5) / rows)) / tw), (u, v) => P(s, u, v), { pal, lift: o.tileLift || 0.02, seed: seed + s, round: o.round });
  }
  // dark underside, and the hip ridges
  g.surf(K_PLAIN, 1);
  for (let s = 0; s < 4; s++) g.sheet(nq(8), 2, (u, v) => { const p = P(s, u, v); return [p[0], p[1] - 0.025, p[2]]; }, o.under || [0.05, 0.04, 0.035]);
  if (o.hips !== null) {
    g.surf(K_ROOF, 0.6, o.hipMetal || 0);
    for (let s = 0; s < 4; s++) { const pts = []; for (let i = 0; i <= 6; i++) { const p = P(s, 1, i / 6); pts.push([p[0], p[1] + 0.03, p[2]]); } g.tube(pts, o.hipR || 0.04, 5, o.hips || mul(pal[0], 0.7), true); if (o.tip) g.in(M(pts[0][0], pts[0][1], pts[0][2]), () => { g.surf(K_PLAIN, 0.35, 0.9); g.add(new THREE.IcosahedronGeometry(o.tipR || 0.055, 0), o.tip); g.surf(K_ROOF, 0.6, o.hipMetal || 0); }); }
  }
}
/** a stone face that leans back as it rises (a battered base), in four sides round a square: half width w0 at y0, w1 at y1; curve > 0 hollows it */
function batterBase(g, w0, w1, y0, y1, st, seed, o = {}) {
  const rows = Math.max(2, Math.round((y1 - y0) / st.course)), curve = o.curve || 0, d0 = o.d0 ?? w0, d1 = o.d1 ?? w1;
  const wAt = (t, a, b) => lerp(a, b, t) - curve * Math.sin(t * Math.PI) * (a - b);
  g.surf(K_STONE, 0.94);
  for (let s = 0; s < 4; s++) {
    const A0 = s % 2 ? d0 : w0, A1 = s % 2 ? d1 : w1, B0 = s % 2 ? w0 : d0, B1 = s % 2 ? w1 : d1;
    for (let j = 0; j < rows; j++) {
      const t0 = j / rows, t1 = (j + 1) / rows, ya = lerp(y0, y1, t0), yb = lerp(y0, y1, t1), a0 = wAt(t0, A0, A1), a1 = wAt(t1, A0, A1), b0 = wAt(t0, B0, B1), b1 = wAt(t1, B0, B1);
      const hgt = Math.hypot(yb - ya, b0 - b1), tilt = Math.atan2(b0 - b1, yb - ya) / DEG, rnd = rng(seed * 331 + s * 71 + j * 13);
      g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, ya, b0, -tilt, 0, 0)), () => {
        const cuts = [0]; let x = 0; const L = 2 * a0;
        while (L - x > st.len[1] * 1.2) { x += lerp(st.len[0], st.len[1], rnd()); cuts.push(x); }
        cuts.push(L);
        for (let k = 0; k < cuts.length - 1; k++) {
          const u0 = cuts[k] / L, u1 = cuts[k + 1] / L;
          g.stonePoly([[lerp(-a0, a0, u0), 0], [lerp(-a0, a0, u1), 0], [lerp(-a1, a1, u1), hgt], [lerp(-a1, a1, u0), hgt]], st, (seed * 131 + s * 977 + j * 53 + k * 7) | 0);
        }
      });
    }
  }
}
/** a draped figure s tall standing on the local origin, facing +Z */
function statue(g, s, col, seed = 0, o = {}) {
  const c = typeof col === 'function' ? col : stoneTint(col, seed, 9), a = hash1(seed, 7) > 0.5 ? 1 : -1;
  g.surf(o.kind ?? K_STONE, o.rough ?? 0.7, o.metal || 0);
  g.lathe([[0.16, 0], [0.17, 0.04], [0.13, 0.06], [0.12, 0.3], [0.1, 0.52], [0.13, 0.66], [0.15, 0.76], [0.06, 0.82], [0.05, 0.86]].map(([r, y]) => [r * s, y * s]), nq(8), c);
  g.in(M(0, 0.92 * s, 0.01 * s), () => g.add(new THREE.SphereGeometry(0.07 * s, nq(8), nq(6)), c));
  g.tube([[a * 0.13 * s, 0.74 * s, 0], [a * 0.2 * s, 0.6 * s, 0.06 * s], [a * 0.12 * s, 0.5 * s, 0.13 * s]], 0.035 * s, 5, c);
  g.tube([[-a * 0.13 * s, 0.74 * s, 0], [-a * 0.22 * s, 0.86 * s, 0.04 * s], [-a * 0.2 * s, 1.04 * s, 0.06 * s]], 0.032 * s, 5, c);
}
/** a cypress: a dark flame of foliage on a short trunk */
function cypress(g, h, r, seed = 0) {
  g.surf(K_WOOD, 0.95); g.cyl(r * 0.2, r * 0.14, h * 0.16, 6, rgb(0x4a3a28), false, false);
  g.surf(K_LEAF, 0.9);
  const c0 = rgb(0x18331c), c1 = rgb(0x3a5e2e);
  g.sheet(nq(16), nq(16), (u, v) => { const a = u * TAU, pr = Math.pow(Math.sin(Math.PI * Math.pow(v, 0.58)), 0.75), rr = r * pr * (0.8 + 0.35 * noise3(Math.cos(a) * 2 + seed, v * 9, Math.sin(a) * 2)); return [Math.cos(a) * rr + 0.04 * h * v * v * Math.sin(seed), h * (0.1 + 0.9 * v), Math.sin(a) * rr]; },
    (x, y, z) => mul(mix(c0, c1, smooth(0.35, 0.7, noise3(x * 9 + seed, y * 6, z * 9))), 0.65 + 0.6 * noise3(x * 25, y * 25 + seed, z * 25)), true, true);
}
/** still water filling a rectangle at height y */
function water(g, x0, x1, z0, z1, y, seed = 0, col = [0.1, 0.36, 0.42], glow = 0.14) {
  g.surf(K_PLAIN, 0.12, 0.25, glow);
  const nu = Math.max(2, Math.round((x1 - x0) / 0.14)), nv = Math.max(2, Math.round((z1 - z0) / 0.14));
  g.sheet(nu, nv, (u, v) => { const x = lerp(x0, x1, u), z = lerp(z0, z1, v); return [x, y + 0.006 * Math.sin(x * 19 + seed) * Math.sin(z * 17 + seed * 2), z]; }, (x, yy, z) => mix(mul(col, 0.65), mul(col, 1.7), smooth(0.45, 0.75, noise3(x * 5 + seed, 1, z * 5))), false, true);
}
/** a column of smoke rising from the origin: puffs that swell and drift toward +X as they climb */
function smoke(g, s, h, seed = 0, c0 = [0.07, 0.07, 0.08], c1 = [0.36, 0.36, 0.38], n = 6, drift = 0.25) {
  g.surf(K_PLAIN, 1);
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0, r = s * (0.55 + 0.95 * t), cc = mix(c0, c1, t);
    g.in(M(drift * h * t * t + Math.sin(seed + i * 1.7) * 0.25 * s, h * (0.04 + 0.96 * t), Math.cos(seed + i * 2.3) * 0.25 * s, seed * 40 + i * 70, i * 50, 0), () =>
      g.add(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.82, 1), (x, y, z) => mul(cc, 0.75 + 0.4 * noise3(x * 3 / s + seed, y * 3 / s, z * 3 / s) + 0.15 * (y / r))));
  }
}
/** a pale flat wisp of ground mist lying on the local origin */
function wisp(g, rx, rz, seed = 0, col = [0.74, 0.8, 0.82]) {
  g.surf(K_PLAIN, 1, 0, 0.14);
  g.add(new THREE.IcosahedronGeometry(1, 1).scale(rx, 0.03 + 0.02 * hash1(seed, 3), rz), (x, y, z) => mul(col, 0.85 + 0.25 * noise3(x * 4 + seed, y * 9, z * 4)));
}
/** a packing crate s across standing on the local origin */
function crate(g, s, seed = 0, wood = RAW_WOOD) {
  g.surf(K_WOOD, 0.9);
  g.in(M(0, s / 2, 0), () => {
    g.cbox(s, s, s, 0.008, (x, y, z) => mul(wood, (0.72 + 0.35 * hash1(Math.floor((y / s + 0.5) * 4), seed)) * (0.85 + 0.25 * noise3(x * 3 + seed, y * 30, z * 3))));
    const c2 = mul(wood, 0.62);
    for (const e of [-1, 1]) { g.in(M(0, e * s * 0.44, 0), () => g.cbox(s * 1.05, s * 0.12, s * 1.05, 0.006, c2)); for (const q of [-1, 1]) g.in(M(e * s * 0.47, 0, q * s * 0.47), () => bx(g, s * 0.11, s * 0.8, s * 0.11, c2)); }
  });
}
/** a tied sack slumped on the local origin */
function sack(g, s, seed = 0, col = rgb(0xb49a6a)) {
  g.surf(K_CLOTH, 0.95);
  g.lathe([[0.02, 0], [0.26, 0.03], [0.32, 0.2], [0.28, 0.42], [0.15, 0.56], [0.07, 0.6], [0.11, 0.68], [0, 0.66]].map(([r, y]) => [r * s, y * s]), nq(9), (x, y, z) => mul(col, 0.75 + 0.4 * noise3(x * 14 + seed, y * 14, z * 14)));
}
/** a jar or pot standing on the local origin, s high */
function pot(g, s, col, o = {}) {
  g.surf(K_PLAIN, o.rough ?? 0.6, o.metal || 0);
  g.lathe([[0.16, 0], [0.3, 0.14], [0.36, 0.38], [0.3, 0.64], [0.17, 0.8], [0.15, 0.9], [0.2, 0.98], [0.16, 1], [0.12, 0.9], [0, 0.88]].map(([r, y]) => [r * s, y * s]), nq(10), typeof col === 'function' ? col : (x, y, z) => mul(o.band && tri1(y / s * 2.5) < 0.2 ? o.band : col, 0.85 + 0.25 * noise3(x * 12, y * 12, z * 12)));
}
/** a flight of n steps w wide climbing toward -Z from the local origin (the foot of the first riser at z = 0) */
function steps(g, w, n, rise, run, col, seed = 0) {
  g.surf(K_STONE, 0.94);
  for (let i = 0; i < n; i++) g.in(M(0, ((i + 1) * rise) / 2 - 0.04, -(i + 0.5) * run), () => g.cbox(w, (i + 1) * rise + 0.08, run + 0.012, 0.012, stoneTint(mul(col, 0.92 + 0.12 * hash1(i, seed)), seed + i, 5)));
}
/** a balustrade along X, centred on the local origin and standing on it: rail, plinth and turned balusters */
function balustrade(g, L, h, col, o = {}) {
  const c = typeof col === 'function' ? col : stoneTint(col, 3, 7), n = Math.max(2, Math.round(L / (o.every || 0.13)));
  g.surf(K_STONE, 0.75);
  g.in(M(0, h - 0.025, 0), () => g.cbox(L, 0.05, 0.1, 0.012, c));
  g.in(M(0, 0.02, 0), () => g.cbox(L, 0.04, 0.09, 0.008, c));
  for (let i = 0; i < n; i++) g.in(M(-L / 2 + ((i + 0.5) * L) / n, 0.04, 0), () => g.lathe([[0.022, 0], [0.034, (h - 0.09) * 0.3], [0.016, (h - 0.09) * 0.7], [0.026, h - 0.09]], 5, c));
}
/** a moulded band (cornice or string course) right round a box of half sizes hx, hz at height y, standing `out` proud */
function band(g, hx, hz, y, hgt, out, col, kind = K_STONE) {
  g.surf(kind, 0.85);
  for (let s = 0; s < 4; s++) { const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz; g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, y, D)), () => g.mould([[0, 0], [out * 0.5, hgt * 0.15], [out * 0.6, hgt * 0.5], [out, hgt * 0.7], [out, hgt], [0, hgt]], 2 * W, col, 1, 1)); }
}
/** four plain plastered or painted walls round a box of half sizes hx, hz from y0 to y1; each(s, W) runs in each face's frame (origin at the middle of its foot) */
function plainBox(g, hx, hz, y0, y1, col, o = {}) {
  for (let s = 0; s < 4; s++) {
    if (o.skip && o.skip.includes(s)) continue;
    const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz;
    g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, y0, D)), () => {
      g.surf(o.kind ?? K_PLASTER, o.rough ?? 0.92);
      g.in(M(-W, 0, 0), () => wallFace(g, 2 * W, y1 - y0, col, o.d || 0.2));
      if (o.each) o.each(s, W);
    });
  }
}
/** a flat lid (roof deck, floor, ceiling) over a rectangle at height y */
function lid(g, x0, x1, z0, z1, y, col, up = 1) { facet(g, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], col, [0, up, 0]); }
/** a bright triangular flag on a pole, flying toward +X */
function flag(g, h, len, col, seed = 0) { pennon(g, h, len, col, null, { hgt: len * 0.5, knob: GOLD }); }
/** stitched hides: patches of several tans and furs with dark seams between them (ku patches round, kv up); .lift(u, v) = how proud a patch lies */
function stitched(col, seed, ku, kv) {
  const alt = [mul(col, 0.62), rgb(0x5a3a26), rgb(0x8a5a38), mix(col, rgb(0xd8c8a0), 0.6), rgb(0x76664e), mix(col, rgb(0x9a3a24), 0.25)];
  const cell = (u, v) => { const cu = u * ku + 0.3 * noise3(v * 3 + seed, 1, 2), cv = v * kv + 0.3 * noise3(u * ku, seed, 5), iu = Math.floor(cu), iv = Math.floor(cv); return [hash1(((iu % ku) + ku) % ku, iv, seed), Math.min(cu - iu, 1 - (cu - iu), cv - iv, 1 - (cv - iv))]; };
  const f = (x, y, z, nx, ny, nz, u, v) => { const [h, edge] = cell(u, v), base = h < 0.3 ? col : alt[Math.floor(h * 6) % 6]; return mul(base, (edge < 0.1 ? 0.34 : 1) * (0.75 + 0.4 * noise3(x * 8 + seed, y * 8, z * 8))); };
  f.lift = (u, v) => { const [h, edge] = cell(u, v); return (h - 0.5) * smooth(0.0, 0.12, edge); };
  return f;
}
/** a low-detail skull with its sockets and nose picked out dark, so that it still reads as a skull from the battle camera */
function skullP(g, s = 1) {
  skull(g, s, true);
  const k = g.kind; g.surf(K_PLAIN, 1);
  g.in(M(0, 0, 0, 0, 0, 0, s), () => { for (const e of [-1, 1]) g.in(M(e * 0.038, 0.113, 0.074), () => g.add(new THREE.IcosahedronGeometry(0.03, 0), [0.03, 0.025, 0.02])); g.in(M(0, 0.074, 0.092), () => g.add(new THREE.IcosahedronGeometry(0.016, 0), [0.03, 0.025, 0.02])); });
  g.kind = k;
}
function skullHeap(g, s, n = 4, seed = 0) {
  const rnd = rng(seed * 31 + 7);
  for (let i = 0; i < n; i++) { const a = (i / Math.max(1, n - 1)) * TAU + rnd(), d = i === n - 1 ? 0 : 0.13 * s; g.in(M(Math.cos(a) * d, i === n - 1 && n > 2 ? 0.16 * s : 0, Math.sin(a) * d, (rnd() - 0.5) * 30, a / DEG + 90 + (rnd() - 0.5) * 60, (rnd() - 0.5) * 30), () => skullP(g, s)); }
}
/** a rough standing stone on the local origin: h high, r thick; o: lean, moss, sq, flat, amp, nu, nv, paint(x, y, z, c, u, v) */
function crag(g, h, r, seed, col, o = {}) {
  g.surf(K_STONE, 0.96);
  const c = rockCol(col, seed, o.moss ?? 0.15, 6), ln = o.lean || 0;
  limb(g, [[0, -0.12, 0], [0.03 * h, h * 0.35, 0.02 * h], [ln * h * 0.5, h * 0.75, 0], [ln * h, h, 0]], [r * 1.15, r, r * 0.86, r * (o.top ?? 0.5)], { nu: nq(o.nu || 20), nv: nq(o.nv || 16), amp: o.amp ?? 0.15, seed, nf: 2.4, sq: o.sq ?? 0.45, flat: o.flat || [1, 0.7], col: o.paint ? (x, y, z, nx, ny, nz, u, v) => o.paint(x, y, z, c(x, y, z, nx, ny), u, v) : c, capB: true });
}

// =====================================================================================================
// The Gorge: mammoth hide, tusk and bone, soot and grease
// =====================================================================================================
const FUR = rgb(0x5a3a26), GREASE = [[0.09, 0.08, 0.05], [0.4, 0.38, 0.3]];
/** a shaggy fringe of mammoth wool hanging round a ring of radius R at the local origin */
function furRing(g, R, h, seed, a0 = 0, a1 = TAU) {
  g.surf(K_CLOTH, 1);
  g.sheet(nq(70), 3, (u, v) => { const a = lerp(a0, a1, u), tuft = hash1(Math.floor(u * 120), seed), rr = R + 0.035 * Math.sin(v * Math.PI) + 0.02 * tuft; return [Math.cos(a) * rr, -v * h * (0.55 + 0.75 * tuft), Math.sin(a) * rr]; },
    (x, y, z, nx, ny, nz, u, v) => mul(mix(FUR, rgb(0x8a6238), hash1(Math.floor(u * 60), seed + 3)), (0.55 + 0.6 * hash1(Math.floor(u * 240), seed)) * (1 - 0.3 * v)), false, true);
}
/** a trophy pole on the local origin: skulls, horns, rags and a crossbar */
function trophyPole(g, h, seed) {
  stake(g, 0.05, h, seed, mul(RAW_WOOD, 0.8), BONE);
  logTo(g, [-0.42, h * 0.74, 0], [0.42, h * 0.76, 0], 0.028, 0.024, seed + 2, { seg: 7, capB: true });
  g.in(M(0, h * 0.75, 0.03), () => lashing(g, 0.06, 4, 0.012));
  g.in(M(0, h * 0.8, 0.04, 20, 0, 0, 0.36), () => beastSkull(g, 1));
  for (const e of [-1, 1]) {
    rope(g, [[e * 0.36, h * 0.75, 0], [e * 0.37, h * 0.62, 0.01]], 0.008);
    g.in(M(e * 0.37, h * 0.62 - 0.2, 0, 0, e * 25 + seed * 30, 0), () => skullP(g, 0.9));
    g.in(M(e * 0.2, h * 0.75, 0.01), () => rag(g, 0.13, 0.42 + 0.1 * e, e > 0 ? OCHRE : mix(HIDE, OCHRE, 0.3), seed + e, 0.5));
  }
  for (const e of [-1, 1]) g.in(M(0, h * 0.5, 0, 0, e * 90, 0), () => g.in(M(0, 0, 0.03, -50, 0, 0), () => horn(g, [[0, 0, 0], [0, 0.16, 0.05], [0, 0.34, 0.03]], 0.035, BONE, rgb(0x6a5a40), { nu: nq(7), nv: nq(8) })));
}
function mammothYurt(g) {
  pad(g, 4, 4, 0.06, (x, y, z) => mul(mix(rgb(0x6a5a40), rgb(0x4a4030), smooth(0.4, 0.7, noise3(x * 1.7, 2, z * 1.7))), 0.7 + 0.5 * fbm3(x * 3, y * 5, z * 3, 3)), 11);
  const cx = -0.48, cz = -0.38, R = 1.3, wy = 1.12, NT = 10, cr = 0.3, cy = 2.5, door = Math.PI / 2;
  const sagK = (a) => Math.abs(Math.sin(((a - door) * NT) / 2));   // 1 on a tusk, 0 midway between two
  const roofR = (v) => lerp(R + 0.16, cr, Math.pow(v, 1.2)), roofY = (v) => lerp(wy - 0.05, cy, Math.sin((v * Math.PI) / 2));
  g.in(M(cx, 0, cz), () => {
    // the wall: stitched hides laced to the frame, bulging between the ribs
    g.surf(K_CLOTH, 0.96);
    const wc = stitched(mul(HIDE, 0.92), 3, 13, 2.2);
    g.sheet(nq(120), nq(10), (u, v) => { const a = u * TAU, rr = R + 0.045 * Math.sin(v * Math.PI) * (1 - sagK(a)) - 0.05 * v + 0.03 * wc.lift(u, v); return [Math.cos(a) * rr, v * wy - 0.04, Math.sin(a) * rr]; }, wc, true, true);
    // the roof: more hides sagging between ten great tusks; a ring of ochre hand-daubs half way up
    const rc = stitched(HIDE, 7, 10, 4);
    g.sheet(nq(120), nq(22), (u, v) => { const a = u * TAU, y = roofY(v) - 0.1 * (1 - sagK(a)) * Math.sin(v * Math.PI) + 0.035 * rc.lift(u, v) * (v < 0.9 ? 1 : 0); return [Math.cos(a) * roofR(v), y, Math.sin(a) * roofR(v)]; },
      (x, y, z, nx, ny, nz, u, v) => (v > 0.4 && v < 0.47 && tri1(u * NT * 2) > 0.45 ? mul(OCHRE, 0.9) : v > 0.9 ? mul(SOOT, 1.5 + noise3(x * 9, y * 9, z * 9)) : rc(x, y, z, nx, ny, nz, u, v)), true, true);
    g.in(M(0, wy + 0.02, 0), () => furRing(g, R + 0.17, 0.22, 5));
    for (let i = 0; i < NT; i++) {
      const a = door + ((i + 0.5) / NT) * TAU, co = Math.cos(a), si = Math.sin(a), pts = [[co * (R + 0.26), -0.1, si * (R + 0.26)], [co * (R + 0.3), 0.55, si * (R + 0.3)]];
      for (const v of [0.08, 0.3, 0.52, 0.72, 0.9]) pts.push([co * (roofR(v) + 0.07), roofY(v) + 0.06, si * (roofR(v) + 0.07)]);
      pts.push([co * (cr + 0.16), cy + 0.3, si * (cr + 0.16)], [co * (cr + 0.36), cy + 0.62 + 0.12 * (i % 2), si * (cr + 0.36)]);
      horn(g, pts, 0.105, mul(BONE, 1.05), rgb(0x8a7a5a), { pow: 0.55, rings: 60, nu: nq(10), nv: nq(34) });
      g.in(M(co * (R + 0.21), wy + 0.04, si * (R + 0.21)), () => lashing(g, 0.1, 3, 0.014));
      // a lesser rib between each pair of tusks, and a stone on a rope to hold the hides down
      const b = a + Math.PI / NT, cb = Math.cos(b), sb = Math.sin(b);
      if (Math.abs(((b - door + Math.PI * 3) % TAU) - Math.PI) > 0.4) {
        rib(g, [cb * (R + 0.1), -0.05, sb * (R + 0.1)], [cb * (R + 0.04), wy + 0.12, sb * (R + 0.04)], [cb * 0.12, 0, sb * 0.12], 0.04, i + 3);
        if (i % 2) { rope(g, [[cb * roofR(0.5), roofY(0.5) - 0.08, sb * roofR(0.5)], [cb * (R + 0.2), wy, sb * (R + 0.2)], [cb * (R + 0.24), 0.5, sb * (R + 0.24)]], 0.013, rgb(0xb89c68), 5); g.in(M(cb * (R + 0.24), 0.36, sb * (R + 0.24)), () => boulder(g, 0.1, 0.12, 0.09, i + 7, rgb(0x77736a), nq(16))); }
      }
    }
    // the smoke hole: a bone ring, soot, the glow of the hearth, greasy smoke
    g.surf(K_PLAIN, 1); g.in(M(0, cy - 0.03, 0), () => g.cyl(cr, cr, 0.001, nq(16), [0.02, 0.012, 0.008], false, true));
    g.surf(K_PLAIN, 0.7); g.in(M(0, cy, 0), () => g.add(new THREE.TorusGeometry(cr + 0.01, 0.045, 6, nq(22)).rotateX(Math.PI / 2), boneCol(3)));
    g.surf(K_PLAIN, 1, 0, 0.8); g.in(M(0, cy - 0.025, 0), () => g.cyl(cr * 0.6, cr * 0.6, 0.001, nq(12), [1.0, 0.36, 0.05], false, true));
    g.in(M(0, cy, 0), () => smoke(g, 0.2, 1.05, 3, GREASE[0], GREASE[1], 6, 0.3));
    // the door: a dark mouth under a beast's skull, between two tusks that cross above it
    g.in(M(0, 0, R - 0.02), () => {
      g.surf(K_PLAIN, 1);
      g.sheet(8, 6, (u, v) => { const x = (u - 0.5) * 0.7 * (1 - 0.3 * v * v); return [x, v * 1.02, 0.06 - x * x * 0.4]; }, (x, y) => mix([0.3, 0.11, 0.03], [0.012, 0.01, 0.008], smooth(0, 0.5, y)));
      for (const e of [-1, 1]) g.in(M(e * 0.5, 0, 0.14, 0, e * -90, 0), () => g.in(M(0, 0, 0, -3, 0, 0), () => tusk(g, 1.35, 1.25)));
      g.in(M(0.34, 1.04, 0.09, 0, 0, -8), () => rag(g, 0.36, 0.94, mix(HIDE, FUR, 0.45), 4, 0.25, OCHRE));
      g.in(M(0, 1.18, 0.12, 24, 0, 0, 0.5), () => beastSkull(g, 1));
      g.in(M(0, 1.08, 0.1), () => furRing(g, 0.45, 0.16, 9, 0.5, Math.PI - 0.5));
    });
  });
  // the corral: a fence of great bones and ribs lashed with sinew, a trough and fodder inside
  const fence = [[1.02, -1.78], [1.84, -1.78], [1.84, -0.9], [1.84, 0.0], [1.84, 0.86], [1.42, 0.86]];
  for (let i = 0; i < fence.length; i++) {
    const [x, z] = fence[i], hh = 0.78 + 0.16 * hash1(i, 5);
    bone(g, [x, -0.06, z], [x + 0.03 * Math.sin(i), hh, z + 0.02], 0.045, i + 20);
    if (i < fence.length - 1) {
      const [x2, z2] = fence[i + 1];
      for (const [y, k] of [[0.3, 0], [0.58, 1]]) { logTo(g, [x, y + 0.02 * k, z], [x2, y - 0.02 * k, z2], 0.026, 0.022, i * 3 + k, { seg: 6, capB: true, bark: mul(RAW_WOOD, 0.75) }); }
      const n = Math.max(1, Math.round(Math.hypot(x2 - x, z2 - z) / 0.21));
      for (let q = 1; q < n; q++) { const t = q / n, px = lerp(x, x2, t), pz = lerp(z, z2, t), ox = (z2 - z) * 0.08, oz = -(x2 - x) * 0.08; rib(g, [px, -0.04, pz], [px + ox * 0.6, 0.62 + 0.2 * hash1(i, q), pz + oz * 0.6], [ox * 1.4, 0, oz * 1.4], 0.03, i * 7 + q); }
      g.in(M(x, 0.44, z), () => lashing(g, 0.05, 3, 0.011));
    }
  }
  g.in(M(1.45, 0, -1.25), () => { g.surf(K_CLOTH, 1); g.add(new THREE.SphereGeometry(0.32, nq(14), nq(8), 0, TAU, 0, Math.PI / 2).scale(1, 0.6, 0.9), (x, y, z) => mul(rgb(0xa8873c), 0.5 + 0.8 * noise3(x * 30, y * 9, z * 30))); });
  g.in(M(1.5, 0.1, -0.2, 90, 0, 0), () => g.in(M(0, -0.32, 0), () => { log(g, 0.12, 0.11, 0.64, 31, { seg: 9, capB: true }); }));
  g.surf(K_PLAIN, 0.2, 0.2); g.flat([[1.43, 0.215, -0.48], [1.57, 0.215, -0.48], [1.57, 0.215, 0.08], [1.43, 0.215, 0.08]], [0.1, 0.16, 0.18]);
  bone(g, [1.25, 0.05, 0.45], [1.6, 0.06, 0.55], 0.03, 41); bone(g, [1.2, 0.05, -0.75], [1.4, 0.05, -0.55], 0.026, 42);
  // trophy poles before the door, a hide stretched to dry, firewood
  g.in(M(-1.72, 0, 1.62, 0, 12, 0), () => trophyPole(g, 2.5, 1));
  g.in(M(0.72, 0, 1.7, 0, -14, 0), () => trophyPole(g, 2.15, 2));
  g.in(M(-1.62, 0, 0.9, 0, 78, 0), () => {
    for (const e of [-1, 1]) for (const q of [-1, 1]) g.in(M(e * 0.34, 0, 0, q * 13, 0, 0), () => stake(g, 0.028, 0.95, e + q * 3, RAW_WOOD, RAW_WOOD));
    logTo(g, [-0.42, 0.89, 0], [0.42, 0.89, 0], 0.026, 0.022, 9, { seg: 7, capB: true });
    g.in(M(0, 0.89, 0, 12, 0, 0), () => rag(g, 0.58, 0.7, mix(HIDE_DARK, FUR, 0.4), 9, 0.25, OCHRE));
  });
  for (let i = 0; i < 6; i++) g.in(M(1.3 + (i % 3) * 0.09, 0.06 + Math.floor(i / 3) * 0.09, 1.55 + (i % 2) * 0.02, 90, 20, 0), () => g.in(M(0, -0.22, 0), () => log(g, 0.045, 0.04, 0.44, i + 30, { seg: 8, capB: true })));
  for (const [x, z, ry] of [[-1.72, -1.72, 30], [0.75, -1.8, -40]]) g.in(M(x, 0, z, 0, ry, 0), () => g.in(M(0, 0, 0, 8, 0, 0), () => tusk(g, 0.8, 1)));
}
function gorgeAltar(g) {
  pad(g, 3, 3, 0.07, (x, y, z) => { const d = Math.hypot(x, z); return mix(mul(rgb(0x5a4a38), 0.7 + 0.5 * fbm3(x * 3, y * 5, z * 3, 3)), [0.04, 0.035, 0.03], smooth(1.0, 0.3, d) * 0.85); }, 5);
  // the ring of boulders, open toward the front
  const N = 9, RR = 1.14, grey = rgb(0x78746c);
  for (let i = 0; i < N; i++) {
    const a = Math.PI / 2 + ((i + 1) / (N + 1)) * TAU, rx = 0.26 + 0.1 * hash1(i, 3), ry = 0.34 + 0.34 * hash1(i, 5);
    const ch = 0.55 + 0.5 * (1 - Math.sin(a)) + 0.3 * hash1(i, 5);
    g.in(M(Math.cos(a) * RR, 0, Math.sin(a) * RR, 0, -a / DEG + 90 + 30 * (hash1(i, 9) - 0.5), 0), () => crag(g, ch, rx * 1.1, i + 60, mul(grey, 0.75 + 0.3 * hash1(i, 11)), { lean: 0.12 * (hash1(i, 13) - 0.5), moss: 0.12, top: 0.6 }));
    if (i % 3 === 1) { g.surf(K_PLAIN, 0.9); g.in(M(Math.cos(a) * RR, ch - 0.02, Math.sin(a) * RR, 0, -a / DEG - 90, 0), () => skullP(g, 1.3)); }
  }
  // the fire under the cauldron: charred logs on a bed of embers
  g.in(M(0, 0.07, 0.05), () => {
    pool(g, 0.62, FIRE_HOT, 3, 1.0);
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3; logTo(g, [Math.cos(a) * 0.72, 0.03, Math.sin(a) * 0.72], [Math.cos(a) * 0.12, 0.16, Math.sin(a) * 0.12], 0.055, 0.05, i + 4, { seg: nq(8), capB: true, bark: [0.07, 0.06, 0.055], heart: i % 2 ? [0.7, 0.2, 0.04] : [0.2, 0.17, 0.15], amp: 0.16 }); }
    for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.7; g.in(M(Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5), () => fire(g, 0.3 + 0.08 * (i % 2), FIRE_HOT, i, 1.0)); }
    // the great toothed cauldron: black iron on three stones, tusks for teeth round its lip
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; g.in(M(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5), () => boulder(g, 0.16, 0.2, 0.14, i + 80, mul(grey, 0.5), nq(14))); }
    g.surf(K_PLAIN, 0.62, 0.8);
    const ic = (x, y, z) => mul(mix([0.05, 0.048, 0.05], RUST, 0.35 * smooth(0.55, 0.8, noise3(x * 6, y * 6, z * 6))), 0.7 + 0.6 * noise3(x * 21, y * 21, z * 21));
    g.lathe([[0.1, 0.2], [0.38, 0.24], [0.58, 0.38], [0.68, 0.6], [0.66, 0.82], [0.6, 0.9], [0.67, 0.95], [0.67, 1.0], [0.56, 1.0], [0.56, 0.9]], nq(30), ic);
    for (const y of [0.5, 0.74]) g.in(M(0, y, 0), () => g.add(new THREE.TorusGeometry(y < 0.6 ? 0.645 : 0.675, 0.022, 5, nq(30)).rotateX(Math.PI / 2), ic));
    for (const e of [-1, 1]) g.in(M(e * 0.7, 0.8, 0, 0, 0, 0), () => g.add(new THREE.TorusGeometry(0.11, 0.022, 5, nq(12)).rotateY(Math.PI / 2), ic));
    g.surf(K_PLAIN, 0.25, 0, 0.1);
    g.in(M(0, 0.9, 0), () => g.sheet(nq(24), nq(6), (u, v) => { const a = u * TAU, d = v * 0.565; return [Math.cos(a) * d, 0.012 * Math.sin(d * 30) + (cells3(Math.cos(a) * d * 7, 1, Math.sin(a) * d * 7) < 0.2 ? 0.03 : 0), Math.sin(a) * d]; }, (x, y, z) => mix([0.16, 0.045, 0.02], [0.4, 0.2, 0.06], smooth(0.4, 0.75, noise3(x * 6, 2, z * 6))), true));
    bone(g, [-0.2, 0.86, 0.1], [-0.42, 1.16, 0.26], 0.03, 5); bone(g, [0.16, 0.86, -0.2], [0.4, 1.12, -0.34], 0.026, 6);
    g.in(M(0.12, 0.86, 0.22, -20, 30, 10), () => skullP(g, 1.3));
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.in(M(Math.cos(a) * 0.615, 0.98, Math.sin(a) * 0.615, 0, -a / DEG + 90, 0), () => horn(g, [[0, 0, 0], [0, 0.12, 0.02], [0, (i % 2 ? 0.2 : 0.34), -0.05]], i % 2 ? 0.04 : 0.055, mul(BONE, 1.05), rgb(0x8a7a5a), { nu: nq(7), nv: nq(8), rings: 20 })); }
  });
  // the roasting spit behind it: forked posts, an iron bar, a whole haunch dripping
  for (const e of [-1, 1]) {
    g.in(M(e * 0.92, 0, -0.74, 0, 0, e * -4), () => stake(g, 0.05, 1.42, e + 4, mul(RAW_WOOD, 0.7), mul(RAW_WOOD, 0.7)));
    for (const q of [-1, 1]) logTo(g, [e * 0.97, 1.3, -0.74], [e * 0.99 + 0.02 * q, 1.56, -0.74 + q * 0.12], 0.03, 0.02, e * 3 + q, { seg: 6, capB: true, bark: mul(RAW_WOOD, 0.7) });
  }
  g.surf(K_PLAIN, 0.5, 0.85); g.tube([[-1.2, 1.46, -0.74], [1.12, 1.46, -0.74], [1.16, 1.36, -0.74], [1.28, 1.36, -0.74]], 0.018, 5, IRON);
  g.surf(K_PLAIN, 0.45);
  const meat = (x, y, z) => mix(mul(rgb(0x7a3418), 0.7 + 0.5 * noise3(x * 9, y * 9, z * 9)), [0.1, 0.05, 0.03], smooth(0.5, 0.8, noise3(x * 4 + 3, y * 4, z * 4)));
  limb(g, [[-0.5, 1.46, -0.74], [-0.3, 1.44, -0.74], [0, 1.43, -0.74], [0.3, 1.45, -0.74], [0.52, 1.46, -0.74]], [0.06, 0.2, 0.24, 0.17, 0.05], { nu: nq(14), nv: nq(16), amp: 0.1, nf: 5, seed: 3, col: meat, capA: true, capB: true });
  for (const [x, dz] of [[-0.3, 1], [0.28, 1], [-0.26, -1], [0.3, -1]]) { limb(g, [[x, 1.36, -0.74 + dz * 0.12], [x * 1.3, 1.2, -0.74 + dz * 0.22], [x * 1.5, 1.06, -0.74 + dz * 0.2]], [0.08, 0.05, 0.03], { nu: nq(8), nv: nq(6), col: meat }); bone(g, [x * 1.5, 1.08, -0.74 + dz * 0.2], [x * 1.62, 0.94, -0.74 + dz * 0.2], 0.018, 3); }
  // two giant tusks crossing over the spit
  for (const e of [-1, 1]) horn(g, [[e * 1.22, -0.1, -1.18], [e * 1.3, 0.7, -1.2], [e * 1.05, 1.45, -1.16], [e * 0.5, 2.0, -1.1 - e * 0.05], [e * -0.12, 2.3, -1.06 - e * 0.05]], 0.13, mul(BONE, 1.05), rgb(0x8a7a5a), { pow: 0.6, rings: 50, nu: nq(12), nv: nq(30) });
  // heaped skulls and bones, the feasting slab, two braziers
  g.in(M(-0.92, 0.02, 0.98, 0, 28, 0, 0.72), () => beastSkull(g, 1));
  g.in(M(0.3, 0.04, 1.02, 0, -10, 0), () => { boulder(g, 0.46, 0.2, 0.28, 91, mul(grey, 0.8), nq(26)); g.in(M(-0.1, 0.23, 0), () => skullHeap(g, 1.25, 5, 3)); bone(g, [0.12, 0.26, 0.1], [0.4, 0.25, -0.02], 0.024, 9); });
  g.in(M(0.98, 0.03, 0.62, 0, -50, 0, 0.5), () => beastSkull(g, 1));
  g.in(M(-0.45, 0.04, 1.28), () => skullHeap(g, 1.25, 4, 5));
  for (const [a, b, sd] of [[[-0.2, 0.06, 1.3], [0.05, 0.05, 1.38], 1], [[0.7, 0.06, 1.34], [0.95, 0.05, 1.22], 2], [[-1.3, 0.06, 0.5], [-1.2, 0.05, 0.76], 3], [[1.28, 0.05, 0.1], [1.34, 0.06, 0.4], 4]]) bone(g, a, b, 0.024, sd);
  for (let i = 0; i < 4; i++) rib(g, [-1.25 + i * 0.07, 0.02, -0.25 + i * 0.1], [-1.12 + i * 0.07, 0.03, -0.3 + i * 0.1 + 0.3], [0, 0.26, 0], 0.022, i);
  for (const e of [-1, 1]) g.in(M(e * 1.24, 0.03, 1.24), () => brazier(g, 0.74, FIRE_HOT, IRON, e));
  g.moss = 0.5;
}

// =====================================================================================================
// Westmark: red brick, white stone, tall glass, copper green
// =====================================================================================================
const W_BRICK = 0x96483a, W_WHITE = rgb(0xe8e2d2), W_GREEN = rgb(0x2c5a3c), W_OAK = rgb(0x4b3423);
/** a stepped brick gable standing on the local origin (its foot), facing +Z: n steps, each `sw` narrower and `sh` high, capped in white stone */
function stepGable(g, half, n, sw, sh, st, seed, thick = 0.2) {
  const col = st.pal[0], wc = stoneTint(W_WHITE, seed, 6);
  for (let i = 0; i < n; i++) {
    const hw = half - i * sw, y = i * sh;
    g.surf(K_STONE, 0.93);
    g.in(M(0, y + sh / 2, -thick / 2 - 0.002), () => bx(g, 2 * hw - 0.004, sh, thick, mul(col, 0.72)));
    g.in(M(-hw + st.r, y, -st.r), () => g.ashlar(2 * (hw - st.r), sh, { ...st, seed: seed + i * 5, ends: [CORNER, CORNER, 0, 0] }));
    g.surf(K_STONE, 0.85);
    if (i < n - 1) for (const e of [-1, 1]) g.in(M(e * (hw - sw / 2 + 0.012), y + sh + 0.026, -thick / 2 + 0.01), () => g.cbox(sw + 0.035, 0.052, thick + 0.07, 0.01, wc));
    else g.in(M(0, y + sh + 0.03, -thick / 2 + 0.01), () => g.cbox(2 * hw + 0.06, 0.06, thick + 0.07, 0.012, wc));
  }
  return n * sh + 0.06;
}
function canalHouse(g) {
  const hx = 0.86, z0 = -1.4, z1 = 1.0, cz = (z0 + z1) / 2, hz = (z1 - z0) / 2, wy = 2.7, st = brickStyle(W_BRICK, 310), r = st.r, wc = stoneTint(W_WHITE, 3, 6);
  const F1 = 1.02, F2 = 1.9, wo = { frame: W_WHITE, glass: GLASS, bars: [1, 3], sill: true };
  g.in(M(0, 0, cz), () => {
    stoneBox(g, hx, hz, 0, wy, st, 311, { each: (s, W) => {
      const fw = 2 * (W - r);
      g.surf(K_STONE, 0.9);
      g.in(M(fw / 2, 0.07, 0.016), () => g.cbox(fw + 0.06, 0.16, 0.05, 0.012, stoneTint(rgb(0x8a8880), s, 5)));
      for (const y of [F1, F2, wy - 0.035]) g.in(M(fw / 2, y, 0.012), () => g.cbox(fw + 0.05, y > 2.5 ? 0.07 : 0.05, 0.045, 0.01, wc));
      if (s === 0) {
        const bays = [fw / 6, fw / 2, (fw * 5) / 6];
        // ground floor: two tall windows and the door at the head of the stoop
        for (const x of bays.slice(0, 2)) g.in(M(x, 0.62, 0), () => win(g, 0.32, 0.6, { ...wo, glass: [0.5, 0.36, 0.16], glow: 0.35 }));
        g.in(M(bays[2], 0.26, 0), () => {
          g.surf(K_WOOD, 0.75); g.in(M(0, 0.31, 0.012), () => g.cbox(0.3, 0.62, 0.03, 0.006, (x, y) => mul(W_GREEN, (Math.abs(x) < 0.01 ? 0.5 : 1) * (0.8 + 0.3 * tri1(y * 5)))));
          g.surf(K_PLAIN, 0.4, 0.9); g.in(M(0.09, 0.3, 0.03), () => g.stud(0.016, BRASS, 6));
          g.in(M(0, 0.7, 0), () => win(g, 0.3, 0.13, { frame: W_WHITE, glass: [0.6, 0.45, 0.2], glow: 0.4, bars: [2, 0] }));
          g.surf(K_STONE, 0.85); for (const e of [-1, 1]) g.in(M(e * 0.19, 0.38, 0.02), () => g.cbox(0.05, 0.78, 0.05, 0.008, wc));
          g.in(M(0, 0.81, 0.03), () => g.cbox(0.5, 0.07, 0.08, 0.012, wc));
          g.in(M(0.26, 0.6, 0.01), () => bracketLamp(g, 0.6, LAMPLIT, {}));
        });
        for (const x of bays) {
          g.in(M(x, 1.47, 0), () => win(g, 0.24, 0.6, { ...wo, shutters: W_GREEN, sw: 0.1 }));
          g.in(M(x, 2.27, 0), () => win(g, 0.24, 0.5, { ...wo, arch: true, bars: [1, 2] }));
          g.surf(K_STONE, 0.85); g.in(M(x, 2.56, 0.02), () => prism(g, [[-0.035, -0.04], [0.035, -0.04], [0.05, 0.05], [-0.05, 0.05]], 0.05, wc));
        }
        g.surf(K_PLAIN, 0.5, 0.85);
        for (const y of [F1 + 0.14, F2 + 0.12]) for (const x of [fw / 3, (fw * 2) / 3]) g.in(M(x, y, 0.012), () => { for (const a of [45, -45]) g.in(M(0, 0, 0, 0, 0, a), () => bx(g, 0.1, 0.016, 0.012, IRON)); });
      } else if (s === 2) {
        for (const [y, hh] of [[0.62, 0.56], [1.47, 0.56], [2.27, 0.46]]) for (const x of [fw * 0.28, fw * 0.72]) g.in(M(x, y, 0), () => win(g, 0.26, hh, { ...wo, bars: [1, 2] }));
      } else {
        for (const [y, hh] of [[0.62, 0.56], [1.47, 0.56], [2.27, 0.46]]) for (const x of [fw * 0.18, fw * 0.5, fw * 0.82]) g.in(M(x, y, 0), () => win(g, 0.24, hh, { ...wo, bars: [1, 2], glass: hash1(Math.round(x * 9), Math.round(y * 9), s) > 0.7 ? [0.5, 0.36, 0.16] : GLASS, glow: hash1(Math.round(x * 9), Math.round(y * 9), s) > 0.7 ? 0.35 : 0 }));
      }
    } });
    // the steep roof, and a stepped gable at each end
    gableRoof(g, hx - 0.01, hz - 0.17, wy - 0.02, wy + 1.16, SLATE_DARK, 320, { tw: 0.15, th: 0.13 });
    let top = 0;
    g.in(M(0, wy, hz), () => {
      top = stepGable(g, hx, 5, 0.165, 0.275, st, 330);
      // the loft door, the hoist beam with its hook and a bale on the rope, a round window, the crowning urn
      g.surf(K_WOOD, 0.8); g.in(M(0, 0.33, 0.012), () => g.cbox(0.3, 0.5, 0.03, 0.006, (x, y) => mul(W_GREEN, (Math.abs(x) < 0.012 ? 0.5 : 1) * (0.75 + 0.3 * tri1(y * 6)))));
      g.surf(K_STONE, 0.85); g.in(M(0, 0.61, 0.02), () => g.cbox(0.4, 0.055, 0.06, 0.01, wc)); g.in(M(0, 0.06, 0.02), () => g.cbox(0.4, 0.045, 0.07, 0.01, wc));
      g.surf(K_WOOD, 0.85); g.in(M(0, 0.78, 0.22, 0, 90, 0), () => g.beam(0.62, 0.075, 0.065, 0.01, woodTint(W_OAK, 3), 2));
      g.surf(K_PLAIN, 0.5, 0.85); g.in(M(0, 0.72, 0.47), () => g.add(new THREE.TorusGeometry(0.03, 0.01, 4, 8), IRON));
      rope(g, [[0, 0.7, 0.47], [0.004, 0.2, 0.47], [0, -0.42, 0.47]], 0.009);
      g.in(M(0, -0.72, 0.47, 0, 20, 0), () => { crate(g, 0.26, 4); rope(g, [[-0.14, 0.14, 0], [0, 0.32, 0], [0.14, 0.14, 0]], 0.008); });
      g.surf(K_STONE, 0.85); g.in(M(0, 1.0, 0.016), () => g.add(new THREE.TorusGeometry(0.085, 0.022, 5, nq(14)), wc));
      g.surf(K_PLAIN, 0.2, 0.1); g.in(M(0, 1.0, 0.012), () => g.poly([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [Math.cos(i * 0.785) * 0.075, Math.sin(i * 0.785) * 0.075, 0]), 0, 0, 1, GLASS));
      g.surf(K_STONE, 0.85); g.in(M(0, top, -0.09), () => g.lathe([[0.07, 0], [0.09, 0.03], [0.05, 0.06], [0.04, 0.1], [0.085, 0.17], [0.09, 0.24], [0.05, 0.3], [0.02, 0.33], [0.03, 0.37], [0, 0.42]], nq(10), wc));
    });
    g.in(M(0, wy, -hz, 0, 180, 0), () => { stepGable(g, hx, 5, 0.165, 0.275, st, 340); g.in(M(0, 0.4, 0), () => win(g, 0.24, 0.4, { ...wo, bars: [1, 1] })); });
    // a chimney stack on the ridge
    g.in(M(0.3, 0, -0.55), () => { stoneBox(g, 0.13, 0.17, wy + 0.5, wy + 1.5, st, 350, { noFoot: true }); g.surf(K_STONE, 0.85); g.in(M(0, wy + 1.52, 0), () => g.cbox(0.32, 0.06, 0.4, 0.012, wc)); g.surf(K_ROOF, 0.8); for (const e of [-1, 1]) g.in(M(0, wy + 1.55, e * 0.08), () => g.cyl(0.045, 0.036, 0.16, 7, TERRA[0], false, false)); });
  });
  // the stoop: a landing at the door and steps down along the wall, an iron rail
  const sx = hx - r - (2 * (hx - r)) / 6, sc = stoneTint(rgb(0x9a968c), 5, 5);
  g.surf(K_STONE, 0.93);
  g.in(M(sx, 0.11, z1 + 0.2), () => g.cbox(0.56, 0.3, 0.38, 0.014, sc));
  for (let i = 0; i < 2; i++) g.in(M(sx - 0.28 - 0.085 - i * 0.17, 0.08 - i * 0.045 - 0.04, z1 + 0.2), () => g.cbox(0.17, 0.17 - i * 0.09 + 0.08, 0.38, 0.012, sc));
  g.surf(K_PLAIN, 0.5, 0.85);
  g.tube([[sx - 0.6, 0.5, z1 + 0.37], [sx - 0.26, 0.72, z1 + 0.37], [sx + 0.26, 0.72, z1 + 0.37], [sx + 0.26, 0.26, z1 + 0.37]], 0.014, 5, IRON, true);
  for (const x of [sx - 0.6, sx - 0.26, sx]) g.in(M(x, x < sx - 0.4 ? 0.02 : 0.24, z1 + 0.37), () => g.cyl(0.012, 0.012, x < sx - 0.4 ? 0.48 : 0.48, 5, IRON));
  // by the door: a barrel, a couple of crates off the barge
  g.in(M(-0.62, 0, z1 + 0.22), () => barrel(g, 0.13, 0.34, rgb(0x7a5a36), 3));
  g.in(M(-0.3, 0, z1 + 0.2, 0, 14, 0), () => crate(g, 0.24, 6));
  g.in(M(-0.33, 0.24, z1 + 0.19, 0, -8, 0), () => crate(g, 0.17, 7));
}
/** a clock face on the local XY plane facing +Z, radius R */
function clockFace(g, R, seed = 0) {
  g.surf(K_PLAIN, 0.5);
  g.in(M(0, 0, 0.012, 90, 0, 0), () => g.cyl(R, R, 0.001, nq(20), (x, y, z) => mul([0.92, 0.9, 0.82], 0.92 + 0.1 * noise3(x * 9, 1, z * 9)), false, true));
  g.surf(K_PLAIN, 0.35, 0.9);
  g.in(M(0, 0, 0.012), () => g.add(new THREE.TorusGeometry(R, R * 0.09, 5, nq(22)), GOLD));
  for (let i = 0; i < 12; i++) g.in(M(0, 0, 0.016, 0, 0, i * 30), () => g.in(M(0, R * 0.78, 0), () => bx(g, R * (i % 3 ? 0.035 : 0.07), R * 0.16, 0.006, i % 3 ? [0.1, 0.09, 0.08] : GOLD)));
  g.surf(K_PLAIN, 0.5, 0.6);
  g.in(M(0, 0, 0.02, 0, 0, -55 - seed * 40), () => g.in(M(0, R * 0.22, 0), () => bx(g, R * 0.07, R * 0.5, 0.006, [0.05, 0.05, 0.06])));
  g.in(M(0, 0, 0.024, 0, 0, 100 + seed * 70), () => g.in(M(0, R * 0.32, 0), () => bx(g, R * 0.045, R * 0.72, 0.006, [0.05, 0.05, 0.06])));
  g.in(M(0, 0, 0.028), () => g.stud(R * 0.07, GOLD, 6));
}
function exchange(g) {
  const hx = 2.3, z0 = -1.85, z1 = 1.3, cz = (z0 + z1) / 2, hz = (z1 - z0) / 2, gy = 1.25, wy = 2.35, st = brickStyle(W_BRICK, 410), r = st.r;
  const wc = stoneTint(W_WHITE, 3, 6), stone = (x, y, z) => mul(W_WHITE, (0.86 + 0.16 * noise3(x * 5, y * 5, z * 5)) * (0.9 + 0.1 * hash1(Math.floor(y / 0.21), Math.floor(x / 0.42 + (Math.floor(y / 0.21) % 2) * 0.5))));
  const wo = { frame: W_WHITE, bars: [1, 3], sill: true };
  // a paved terrace along the front
  g.surf(K_STONE, 0.95);
  g.in(M(0, 0.02, 1.62), () => g.cbox(4.86, 0.1, 0.7, 0.014, (x, y, z) => mul(rgb(0x9a968c), (0.85 + 0.25 * hash1(Math.floor(x / 0.3), Math.floor(z / 0.3))) * (0.9 + 0.15 * noise3(x * 7, 1, z * 7)))));
  g.in(M(0, 0, cz), () => {
    // sides and back: brick over a stone plinth, tall arched windows above, barred ones below
    stoneBox(g, hx, hz, 0, wy, st, 411, { skip: [0], each: (s, W) => {
      const fw = 2 * (W - r), n = Math.round(fw / 0.78);
      g.surf(K_STONE, 0.9);
      g.in(M(fw / 2, 0.08, 0.016), () => g.cbox(fw + 0.06, 0.18, 0.05, 0.012, stoneTint(rgb(0x8a8880), s, 5)));
      g.in(M(fw / 2, gy, 0.012), () => g.cbox(fw + 0.05, 0.06, 0.045, 0.01, wc));
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) * fw) / n;
        g.in(M(x, 1.82, 0), () => win(g, 0.3, 0.66, { ...wo, arch: true, glass: i % 3 === 1 ? [0.5, 0.36, 0.16] : GLASS, glow: i % 3 === 1 ? 0.35 : 0 }));
        g.in(M(x, 0.7, 0), () => win(g, 0.3, 0.5, { ...wo, bars: [2, 2], barCol: IRON }));
        if (i) { g.surf(K_STONE, 0.88); g.in(M((i * fw) / n, wy / 2, 0.01), () => bx(g, 0.09, wy, 0.03, wc)); }
      }
    } });
    // the front: a stone arcade below, brick and tall windows above, either side of the clock tower
    for (const e of [-1, 1]) g.in(M(e > 0 ? 0.5 : -hx, 0, hz), () => {
      const L = hx - 0.5, ops = [{ x: L * 0.27, w: 0.62, sp: 0.66 }, { x: L * 0.73, w: 0.62, sp: 0.66 }];
      g.surf(K_STONE, 0.9);
      archWall(g, L, gy, ops, { t: 0.2, col: stone, inCol: (x, y, z) => mul(W_WHITE, 0.6 + 0.1 * noise3(x * 5, y * 5, z * 5)), d: 0.14 });
      for (const op of ops) { voussoirs(g, op, 0.1, mul(W_WHITE, 1.04), rgb(0xa85a44), 0.014, 9); for (const q of [-1, 1]) g.in(M(op.x + q * 0.31, op.sp - 0.03, 0.012), () => g.cbox(0.13, 0.06, 0.05, 0.01, wc)); }
      g.in(M(L / 2, gy, 0.012), () => g.cbox(L + 0.04, 0.07, 0.06, 0.012, wc));
      g.in(M(st.r, gy + 0.035, -r), () => { g.surf(K_STONE, 0.93); g.ashlar(L - 2 * st.r, wy - gy - 0.035, { ...st, seed: 420 + e, ends: [e > 0 ? CUT : CORNER, e > 0 ? CORNER : CUT, 0, 0] }); });
      for (const op of ops) g.in(M(op.x, 1.84, 0), () => win(g, 0.34, 0.7, { ...wo, arch: true, glass: [0.5, 0.36, 0.16], glow: 0.3 }));
      // inside the arcade: a shadowed walk, doors in the back wall
      g.surf(K_PLASTER, 1);
      g.flat([[0, 0, -0.62], [L, 0, -0.62], [L, gy, -0.62], [0, gy, -0.62]], [[0.2, 0.17, 0.14], [0.2, 0.17, 0.14], [0.07, 0.06, 0.05], [0.07, 0.06, 0.05]]);
      lid(g, 0, L, -0.62, -0.2, gy - 0.01, [0.06, 0.05, 0.045], -1); lid(g, 0, L, -0.62, 0.0, 0.03, [0.3, 0.28, 0.25]);
      g.surf(K_WOOD, 0.8); for (const op of ops) g.in(M(op.x, 0.4, -0.6), () => g.cbox(0.4, 0.78, 0.03, 0.006, woodTint(W_OAK, op.x * 5)));
    });
    band(g, hx + 0.01, hz + 0.01, wy - 0.02, 0.13, 0.09, wc);
    // the roof: copper gone green, a ring round the open court
    skirtRoof(g, hx + 0.1, hz + 0.1, wy + 0.1, hx - 0.62, hz - 0.62, wy + 0.78, COPPER_GREEN, 430, { metal: 0.35, rough: 0.55, hips: mul(COPPER_GREEN[3], 0.8), hipMetal: 0.4 });
    skirtRoof(g, hx - 1.08, hz - 1.08, wy + 0.42, hx - 0.62, hz - 0.62, wy + 0.78, COPPER_GREEN, 440, { metal: 0.35, rough: 0.55, hips: null, under: mul(COPPER_GREEN[3], 0.5) });
    g.surf(K_PLAIN, 0.5, 0.5);
    for (let s = 0; s < 4; s++) { const W = (s % 2 ? hz : hx) - 0.62, D = (s % 2 ? hx : hz) - 0.62; g.in(M(0, 0, 0, 0, s * 90, 0), () => ridge(g, [-W - 0.04, wy + 0.8, D], [W + 0.04, wy + 0.8, D], 0.05, COPPER_GREEN[3], 450 + s)); }
    const cxh = hx - 1.08, czh = hz - 1.08;
    plainBox(g, cxh, czh, 0.04, wy + 0.44, (x, y) => { const bay = 0.5, lx = ((x % bay) + bay) % bay - bay / 2, up = y > 1.3, yy = up ? y - 1.3 : y, dark = Math.abs(lx) < 0.15 && yy < 0.75 || (Math.hypot(lx, yy - 0.75) < 0.15); return dark ? [0.05, 0.045, 0.04] : mul(rgb(W_BRICK), 0.6 + 0.2 * noise3(x * 8, y * 8, 1)); }, { d: 0.06, kind: K_PLAIN });
    g.surf(K_STONE, 0.95); lid(g, -cxh, cxh, -czh, czh, 0.05, [0.4, 0.38, 0.34]);
    // chimneys, and a pennant at each corner of the ridge
    for (const [x, z] of [[-1.3, -hz + 0.62], [1.3, -hz + 0.62]]) g.in(M(x, 0, z), () => { stoneBox(g, 0.12, 0.12, wy + 0.6, wy + 1.25, st, 460, { noFoot: true }); g.surf(K_STONE, 0.85); g.in(M(0, wy + 1.27, 0), () => g.cbox(0.3, 0.06, 0.3, 0.012, wc)); });
    for (const [sx, sz, c] of [[1, 1, 0xd9822e], [-1, 1, 0x2a5aa8], [1, -1, 0x2a5aa8], [-1, -1, 0xd9822e]]) g.in(M(sx * (hx - 0.62), wy + 0.78, sz * (hz - 0.62), 0, sx > 0 ? 0 : 180, 0), () => pennon(g, 0.85, 0.55, rgb(c), null, {}));
  });
  // the clock tower: stone gate, brick stages, the clock, an open cupola and a green copper cap
  const th = 0.52, tz = 0.98, ty = 3.55, bs = blockStyle(0xd8d0bc, 470, { course: 0.21, len: [0.3, 0.5] });
  g.in(M(0, 0, tz), () => {
    stoneBox(g, th, th, 0, gy, bs, 471, { holes: [[[th - bs.r - 0.28, 0, th - bs.r + 0.28, 0.63]], null, null, null], each: (s) => {
      if (s) return;
      g.in(M(th - bs.r, 0, 0), () => {
        g.surf(K_WOOD, 0.8);
        for (const e of [-1, 1]) g.in(M(e * 0.14, 0.32, -0.08), () => { g.cbox(0.27, 0.64, 0.04, 0.008, woodTint(W_OAK, e)); g.surf(K_PLAIN, 0.5, 0.85); for (const y of [-0.2, 0.2]) g.in(M(0, y, 0.022), () => bx(g, 0.24, 0.03, 0.008, IRON)); g.in(M(-e * 0.08, 0, 0.026), () => g.add(new THREE.TorusGeometry(0.03, 0.008, 4, 10), BRASS)); g.surf(K_WOOD, 0.8); });
        g.surf(K_PLAIN, 1); for (const e of [-1, 1]) g.flat([[e * 0.28, 0, 0], [e * 0.28, 0.63, 0], [e * 0.28, 0.63, -0.1], [e * 0.28, 0, -0.1]], mul(W_WHITE, 0.5));
        g.surf(K_STONE, 0.85);
        g.in(M(0, 0.66, 0.03), () => prism(g, [[-0.36, 0], [0.36, 0], [0.33, 0.14], [0.2, 0.27], [0, 0.32], [-0.2, 0.27], [-0.33, 0.14]], 0.07, wc, [0, 0.05]));
        g.in(M(0, 0.78, 0.07), () => sunDisc(g, 0.42, GOLD, { rays: 10 }));
        for (const e of [-1, 1]) g.in(M(e * 0.36, 0, 0.06), () => columnOn(g, 0.66, 0.045, wc, wc));
      });
    } });
    band(g, th + 0.01, th + 0.01, gy - 0.02, 0.09, 0.06, wc);
    stoneBox(g, th - 0.02, th - 0.02, gy + 0.05, ty, st, 472, { noFoot: true, each: (s, W) => {
      const fw = 2 * (W - r);
      g.surf(K_STONE, 0.88); for (const x of [0.03, fw - 0.03]) g.in(M(x, (ty - gy) / 2, 0.012), () => bx(g, 0.1, ty - gy - 0.05, 0.03, wc));
      if (s === 0) { g.in(M(fw / 2, 0.62, 0), () => win(g, 0.34, 0.72, { ...wo, arch: true, glass: [0.5, 0.36, 0.16], glow: 0.35 })); g.in(M(fw / 2, 0.2, 0.06), () => balustrade(g, 0.56, 0.2, W_WHITE, { every: 0.09 })); g.surf(K_STONE, 0.88); g.in(M(fw / 2, 0.19, 0.04), () => g.cbox(0.62, 0.04, 0.14, 0.008, wc)); }
      g.in(M(fw / 2, wy + 0.62 - gy - 0.05, 0.02), () => clockFace(g, 0.33, s));
    } });
    band(g, th - 0.01, th - 0.01, wy - gy + gy - 0.02, 0.08, 0.05, wc);
    band(g, th - 0.01, th - 0.01, ty - 0.02, 0.14, 0.11, wc);
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) g.in(M(sx * (th + 0.02), ty + 0.12, sz * (th + 0.02)), () => { g.surf(K_STONE, 0.85); g.lathe([[0.05, 0], [0.065, 0.03], [0.035, 0.06], [0.07, 0.14], [0.06, 0.22], [0.02, 0.26], [0, 0.32]], nq(8), wc); });
    // the cupola: eight posts, a bell, the cap
    g.in(M(0, ty + 0.12, 0), () => {
      g.surf(K_STONE, 0.88); g.cyl(0.44, 0.44, 0.07, 8, wc, false, true);
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) * 0.785; g.in(M(Math.cos(a) * 0.36, 0.07, Math.sin(a) * 0.36), () => columnOn(g, 0.52, 0.03, wc, wc)); }
      g.surf(K_PLAIN, 0.35, 0.9); g.in(M(0, 0.2, 0), () => g.lathe([[0.17, 0], [0.16, 0.03], [0.11, 0.13], [0.08, 0.24], [0.03, 0.28], [0, 0.34]], nq(12), BRASS));
      g.surf(K_STONE, 0.88); g.in(M(0, 0.59, 0), () => g.lathe([[0.4, 0], [0.46, 0.03], [0.46, 0.08], [0.4, 0.1], [0, 0.1]], 8, wc));
      g.in(M(0, 0.68, 0), () => {
        const top = domeOn(g, 0.42, { shape: 'bulb', drum: 0.16, drumCol: mul(W_WHITE, 0.95), col: (a, t, x, y, z) => mul(COPPER_GREEN[Math.floor(tri1((a / TAU) * 8) * 2.99) % 5], 0.8 + 0.3 * noise3(x * 8, y * 8, z * 8)), metal: 0.4, rough: 0.5, seg: 24, finial: 'spike', finS: 0.55 });
        g.in(M(0, top + 0.1, 0), () => pennon(g, 0.42, 0.42, rgb(0xd9822e), null, { pole: IRON }));
      });
    });
  });
  // at the gate: bales and crates off the barges, barrels, a merchant's great scales
  for (const [x, z, s, ry, y] of [[-1.72, 1.66, 0.34, 8, 0.07], [-1.36, 1.72, 0.28, -12, 0.07], [-1.68, 1.64, 0.26, 30, 0.41], [-2.08, 1.62, 0.3, 4, 0.07]]) g.in(M(x, y, z, 0, ry, 0), () => crate(g, s, x * 7));
  g.in(M(-0.98, 0.07, 1.72), () => barrel(g, 0.14, 0.36, rgb(0x7a5a36), 5));
  g.in(M(-0.8, 0.07, 1.48), () => sack(g, 0.5, 2)); g.in(M(2.05, 0.07, 1.62), () => sack(g, 0.55, 3)); g.in(M(1.85, 0.07, 1.78, 0, 60, 0), () => sack(g, 0.45, 4));
  g.in(M(1.35, 0.07, 1.68), () => {
    g.surf(K_WOOD, 0.85); g.in(M(0, 0.36, 0), () => g.cbox(0.7, 0.05, 0.36, 0.01, woodTint(W_OAK, 5), 2)); for (const e of [-1, 1]) for (const q of [-1, 1]) g.in(M(e * 0.3, 0.17, q * 0.14), () => bx(g, 0.05, 0.34, 0.05, mul(W_OAK, 0.9)));
    g.surf(K_PLAIN, 0.35, 0.9);
    g.in(M(0, 0.385, 0), () => { g.lathe([[0.1, 0], [0.11, 0.02], [0.03, 0.05], [0.022, 0.5], [0.04, 0.54], [0, 0.58]], nq(8), BRASS); g.in(M(0, 0.5, 0, 0, 0, 7), () => { bx(g, 0.56, 0.022, 0.022, BRASS); for (const e of [-1, 1]) g.in(M(e * 0.27, 0, 0), () => { for (const q of [-1, 0, 1]) g.tube([[0, 0, 0], [q * 0.07, -0.26 + e * 0.0, q ? 0 : 0.07]], 0.004, 3, IRON, false); g.in(M(0, -0.28, 0.02), () => g.lathe([[0, 0], [0.09, 0.012], [0.11, 0.04]], nq(10), BRASS)); }); }); });
    g.surf(K_PLAIN, 0.3, 0.9, 0.05); g.in(M(-0.2, 0.385, 0.08), () => g.cyl(0.035, 0.035, 0.06, 7, GOLD, false, true)); g.in(M(-0.12, 0.385, 0.1), () => g.cyl(0.035, 0.035, 0.035, 7, GOLD, false, true));
  });
}

// =====================================================================================================
// The Principalities: marble, brick and terracotta, cypress and running water
// =====================================================================================================
const P_STUCCO = rgb(0xe9dcc0), P_BRICK = 0xa8583e, P_SHUTTER = rgb(0x4a6a52);
const marbleCol = (seed = 0, base = MARBLE) => (x, y, z) => { const v = Math.abs(noise3(x * 2.3 + seed, y * 2.3 + x, z * 2.3) - 0.5); return mul(mix(base, [0.6, 0.6, 0.62], smooth(0.035, 0.0, v) * 0.5), 0.92 + 0.12 * noise3(x * 7, y * 7 + seed, z * 7)); };
const stuccoCol = (base, seed = 0) => (x, y, z) => mul(base, 0.9 + 0.14 * fbm3(x * 2.1 + seed, y * 2.1, z * 2.1, 2));
/** a fountain on the local origin: an eight-sided basin, a stem carrying a bowl, water spilling from it */
function fountain(g, s, col, seed = 0) {
  const c = typeof col === 'function' ? col : stoneTint(col, seed, 7), wcol = [0.16, 0.5, 0.56];
  g.surf(K_STONE, 0.8);
  g.lathe([[0.52, -0.03], [0.52, 0.04], [0.48, 0.07], [0.47, 0.2], [0.5, 0.23], [0.5, 0.27], [0.42, 0.27], [0.42, 0.14]].map(([r, y]) => [r * s, y * s]), 8, c);
  g.lathe([[0.1, 0.1], [0.07, 0.2], [0.05, 0.44], [0.09, 0.5], [0.26, 0.58], [0.28, 0.62], [0.22, 0.62], [0.06, 0.56]].map(([r, y]) => [r * s, y * s]), nq(14), c);
  g.lathe([[0.04, 0.56], [0.03, 0.74], [0.06, 0.78], [0.03, 0.84], [0, 0.88]].map(([r, y]) => [r * s, y * s]), nq(8), c);
  g.surf(K_PLAIN, 0.1, 0.25, 0.16);
  g.in(M(0, 0.21 * s, 0), () => g.cyl(0.42 * s, 0.42 * s, 0.001, 8, (x, y, z) => mul(wcol, 0.7 + 0.6 * noise3(x * 9, 1, z * 9)), false, true));
  g.in(M(0, 0.605 * s, 0), () => g.cyl(0.22 * s, 0.22 * s, 0.001, nq(12), wcol, false, true));
  g.surf(K_PLAIN, 0.2, 0, 0.3);
  for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3; g.tube([[Math.cos(a) * 0.25 * s, 0.61 * s, Math.sin(a) * 0.25 * s], [Math.cos(a) * 0.31 * s, 0.52 * s, Math.sin(a) * 0.31 * s], [Math.cos(a) * 0.33 * s, 0.22 * s, Math.sin(a) * 0.33 * s]], [0.012 * s, 0.014 * s, 0.02 * s], 4, [0.62, 0.84, 0.9], false); }
  g.tube([[0, 0.86 * s, 0], [0, 1.0 * s, 0]], [0.012 * s, 0.004 * s], 4, [0.7, 0.9, 0.95], false);
}
function villa(g) {
  const mc = marbleCol(3), wall = stuccoCol(P_STUCCO, 3), wy = 2.1, gy = 1.15, y0 = 0.06;
  // the terrace it stands on
  g.surf(K_STONE, 0.95);
  g.in(M(0, 0, 0), () => g.cbox(3.92, 0.12, 3.92, 0.02, (x, y, z) => mul(rgb(0xb8ad98), (0.82 + 0.22 * hash1(Math.floor(x / 0.33), Math.floor(z / 0.33))) * (0.9 + 0.14 * noise3(x * 7, 1, z * 7)))));
  const wo = { frame: MARBLE, bars: [1, 2], sill: true, kind: K_STONE };
  // the main block across the back: two storeys, a hipped terracotta roof
  g.in(M(0, 0, -1.2), () => {
    plainBox(g, 1.85, 0.65, y0, wy, wall, { skip: [0], each: (s, W) => {
      const n = Math.max(1, Math.round((2 * W) / 0.72));
      for (let i = 0; i < n; i++) { const x = -W + ((i + 0.5) * 2 * W) / n; g.in(M(x, 1.62 - y0, 0), () => win(g, 0.26, 0.56, { ...wo, arch: true, shutters: P_SHUTTER, sw: 0.1 })); g.in(M(x, 0.62 - y0, 0), () => win(g, 0.26, 0.5, { ...wo, bars: [1, 1] })); }
      g.surf(K_STONE, 0.85); g.in(M(0, gy - y0, 0.012), () => g.cbox(2 * W + 0.05, 0.06, 0.04, 0.01, mc));
      for (const e of [-1, 1]) g.in(M(e * (W - 0.05), (wy - y0) / 2, 0.012), () => bx(g, 0.11, wy - y0, 0.03, mc));
    } });
    // its face to the court: an arcaded loggia on marble columns, tall shuttered windows above
    g.in(M(-1.05, y0, 0.65), () => {
      const ops = [0.35, 1.05, 1.75].map((x) => ({ x, w: 0.56, sp: 0.66 }));
      g.surf(K_STONE, 0.85);
      archWall(g, 2.1, gy - y0, ops, { t: 0.16, col: mc, inCol: (x, y, z) => mul(MARBLE, 0.62 + 0.1 * noise3(x * 5, y * 5, z * 5)), d: 0.18 });
      for (const op of ops) voussoirs(g, op, 0.07, mul(MARBLE, 1.04), rgb(0xc9b89a), 0.012, 9);
      for (const x of [0, 0.7, 1.4, 2.1]) g.in(M(x, 0, 0.05), () => columnOn(g, 0.68, 0.055, mc, mc));
      g.surf(K_PLASTER, 0.95);
      const back = (x, y) => mul(rgb(0xb8643c), 0.45 + 0.25 * noise3(x * 4, y * 4, 1) + 0.25 * smooth(0.9, 0, y));
      g.in(M(0, 0, -0.55), () => wallFace(g, 2.1, gy - y0, back, 0.2));
      lid(g, 0, 2.1, -0.55, -0.16, gy - y0 - 0.01, [0.08, 0.07, 0.06], -1);
      g.surf(K_WOOD, 0.8); g.in(M(1.05, 0.38, -0.53), () => g.cbox(0.4, 0.76, 0.03, 0.006, woodTint(rgb(0x5a3a22), 3)));
      for (const x of [0.35, 1.75]) g.in(M(x, 0.5, -0.545), () => win(g, 0.24, 0.44, { ...wo, glass: [0.5, 0.36, 0.16], glow: 0.3 }));
    });
    g.in(M(-1.85, gy, 0.65), () => { g.surf(K_PLASTER, 0.92); wallFace(g, 3.7, wy - gy, wall, 0.2); for (let i = 0; i < 5; i++) g.in(M(0.37 + i * 0.74, 0.5, 0), () => win(g, 0.26, 0.58, { ...wo, arch: true, shutters: P_SHUTTER, sw: 0.1, glass: i % 2 ? GLASS : [0.5, 0.36, 0.16], glow: i % 2 ? 0 : 0.3 })); g.surf(K_STONE, 0.85); g.in(M(1.85, 0.02, 0.014), () => g.cbox(3.74, 0.07, 0.05, 0.012, mc)); });
    band(g, 1.86, 0.66, wy - 0.02, 0.14, 0.1, mc);
    hipRoof(g, 1.9, 0.72, wy + 0.1, wy + 0.68, 1.22, TERRA, 510, { round: true, ridgeCol: TERRA[3], ridgeMetal: 0 });
    // the roofline: a balustrade and four marble figures looking down into the court
    g.in(M(0, wy + 0.12, 0.7), () => {
      balustrade(g, 3.7, 0.2, mc);
      for (const [x, sd] of [[-1.78, 1], [-0.6, 2], [0.6, 3], [1.78, 4]]) g.in(M(x, 0, 0), () => { g.surf(K_STONE, 0.8); g.in(M(0, 0.13, 0), () => g.cbox(0.2, 0.26, 0.2, 0.014, mc)); g.in(M(0, 0.26, 0), () => statue(g, 0.56, MARBLE, sd)); });
    });
  });
  // two wings reaching forward either side of the court
  for (const e of [-1, 1]) g.in(M(e * 1.45, 0, 0.225), () => {
    plainBox(g, 0.4, 0.775, y0, 1.3, wall, { each: (s, W) => {
      g.surf(K_STONE, 0.85); g.in(M(0, 1.3 - y0 - 0.03, 0.012), () => g.cbox(2 * W + 0.05, 0.07, 0.045, 0.01, mc));
      if (s === 0) { g.in(M(0, 0.62, 0), () => win(g, 0.3, 0.6, { ...wo, arch: true, glass: [0.5, 0.36, 0.16], glow: 0.3 })); return; }
      if (s === 2) return;
      const court = (s === 1) === (e < 0);
      for (const x of [-0.42, 0.3]) g.in(M(x * (s === 1 ? 1 : -1), 0.6, 0), () => win(g, 0.26, court ? 0.62 : 0.5, { ...wo, arch: court, shutters: court ? null : P_SHUTTER, sw: 0.1 }));
    } });
    gableRoof(g, 0.47, 0.82, 1.28, 1.7, TERRA, 520 + e, { round: true, ridgeCol: TERRA[3], ridgeMetal: 0 });
    g.surf(K_PLASTER, 0.92); for (const q of [-1, 1]) facet(g, [[-0.4, 1.28, q * 0.775], [0.4, 1.28, q * 0.775], [0, 1.66, q * 0.775]], P_STUCCO, [0, 0, q]);
    g.surf(K_STONE, 0.85); g.in(M(0, 1.46, 0.79), () => g.add(new THREE.TorusGeometry(0.07, 0.02, 5, nq(12)), mc));
  });
  // the court: chequered paving, the fountain, potted lemon trees by the loggia
  g.surf(K_STONE, 0.7);
  for (let i = 0; i < 7; i++) for (let j = 0; j < 6; j++) { const x = -1.05 + i * 0.3, z = -0.55 + j * 0.3; lid(g, x + 0.005, x + 0.295, z + 0.005, z + 0.295, y0 + 0.004, mul((i + j) % 2 ? rgb(0xd9d2c2) : rgb(0xb0705a), 0.9 + 0.15 * hash1(i, j))); }
  g.in(M(0, y0, 0.4), () => fountain(g, 0.95, mc, 3));
  for (const e of [-1, 1]) g.in(M(e * 0.82, y0, -0.36), () => { pot(g, 0.22, TERRA[0]); g.surf(K_WOOD, 0.9); g.in(M(0, 0.2, 0), () => g.cyl(0.015, 0.012, 0.22, 5, rgb(0x4a3a28))); g.surf(K_LEAF, 0.9); g.in(M(0, 0.52, 0), () => g.add(new THREE.IcosahedronGeometry(0.17, 1), (x, y, z) => (cells3(x * 9, y * 9, z * 9) < 0.16 ? [0.95, 0.8, 0.15] : mul(rgb(0x2f5a2a), 0.7 + 0.6 * noise3(x * 14, y * 14, z * 14))))); });
  // the front of the court: a balustrade, gate piers with urns; cypresses standing guard
  for (const e of [-1, 1]) {
    g.in(M(e * 0.68, y0, 1.42), () => balustrade(g, 0.74, 0.3, mc));
    g.in(M(e * 0.28, y0, 1.42), () => { g.surf(K_STONE, 0.8); g.in(M(0, 0.24, 0), () => g.cbox(0.17, 0.48, 0.17, 0.014, mc)); g.in(M(0, 0.48, 0), () => g.lathe([[0.1, 0], [0.1, 0.03], [0.04, 0.06], [0.03, 0.1], [0.09, 0.17], [0.1, 0.25], [0.07, 0.3], [0.085, 0.33], [0, 0.34]], nq(10), mc)); });
    g.in(M(e * 1.55, y0, 1.56), () => cypress(g, 2.5, 0.25, e + 2));
    g.in(M(e * 1.5, y0, 1.14), () => cypress(g, 1.7, 0.2, e + 5));
  }
}
function bellTower(g) {
  const hx = 0.62, st = brickStyle(P_BRICK, 530), r = st.r, mc = marbleCol(5), ms = blockStyle(0xe2dccc, 531, { course: 0.15, len: [0.26, 0.44] });
  const y1 = 0.3, y5 = 4.7, y6 = 6.2;
  // the marble foot and its steps
  stoneBox(g, 0.74, 0.74, 0, y1, ms, 532);
  g.in(M(0, 0, 0.95), () => steps(g, 0.5, 2, 0.1, 0.11, MARBLE, 3));
  band(g, 0.74, 0.74, y1 - 0.02, 0.07, 0.04, mc);
  // the brick shaft: marble strips at the corners, string courses, more and wider lights the higher it climbs
  const cuts = [1.5, 2.6, 3.7];
  stoneBox(g, hx, hx, y1, y5, st, 533, { noFoot: true, each: (s, W) => {
    const fw = 2 * (W - r), H = y5 - y1;
    g.surf(K_STONE, 0.85);
    for (const x of [0.045, fw - 0.045]) g.in(M(x, H / 2, 0.014), () => bx(g, 0.13, H, 0.035, mc));
    for (const y of [...cuts, y5 - 0.1]) { for (let i = 0; i < 7; i++) g.in(M(0.2 + (i * (fw - 0.4)) / 6, y - y1 - 0.07, 0.012), () => g.cbox(0.07, 0.07, 0.03, 0.01, mc)); }
    if (s === 0) {
      g.surf(K_WOOD, 0.8); g.in(M(fw / 2, 0.36, 0.014), () => g.cbox(0.3, 0.72, 0.03, 0.006, woodTint(rgb(0x4b3423), 3)));
      g.in(M(fw / 2, 0, 0.012), () => archFrame(g, 0.36, 0.9, 'round', MARBLE, { t: 0.04, fill: [0.05, 0.04, 0.035] }));
    } else g.in(M(fw / 2, 0.75, 0), () => win(g, 0.1, 0.42, { frame: MARBLE, bars: [0, 0], arch: true }));
    g.in(M(fw / 2, 1.65, 0), () => win(g, 0.13, 0.5, { frame: MARBLE, bars: [0, 0], arch: true, sill: true }));
    for (const e of [-1, 1]) g.in(M(fw / 2 + e * 0.11, 2.75, 0), () => win(g, 0.14, 0.52, { frame: MARBLE, bars: [0, 0], arch: true, sill: true, ft: 0.03 }));
    for (const e of [-1, 0, 1]) g.in(M(fw / 2 + e * 0.21, 3.86, 0), () => win(g, 0.14, 0.56, { frame: MARBLE, bars: [0, 0], arch: true, sill: true, ft: 0.03, glass: e ? GLASS : [0.5, 0.36, 0.16], glow: e ? 0 : 0.3 }));
    g.in(M(fw / 2, 1.05, 0.012), () => { g.surf(K_PLAIN, 0.5, 0.85); for (const a of [45, -45]) g.in(M(0, 0, 0, 0, 0, a), () => bx(g, 0.1, 0.016, 0.012, IRON)); });
  } });
  for (const y of cuts) band(g, hx + 0.005, hx + 0.005, y - 0.03, 0.07, 0.045, mc);
  band(g, hx + 0.01, hx + 0.01, y5 - 0.04, 0.13, 0.1, mc);
  // the belfry: twin marble arches on each face, the great bell hanging in the dark behind them
  const bw = 0.6;
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-bw, y5 + 0.09, bw)), () => {
    const ops = [{ x: 0.34, w: 0.38, sp: 0.84, y0: 0.2 }, { x: 0.86, w: 0.38, sp: 0.84, y0: 0.2 }];
    g.surf(K_STONE, 0.82);
    archWall(g, 2 * bw, y6 - y5 - 0.09, ops, { t: 0.13, col: mc, inCol: (x, y, z) => mul(MARBLE, 0.6 + 0.1 * noise3(x * 5, y * 5, z * 5)), d: 0.2 });
    for (const op of ops) voussoirs(g, op, 0.06, rgb(P_BRICK), mul(MARBLE, 1.04), 0.012, 8);
    g.in(M(bw, 0.2, 0.03), () => columnOn(g, 0.66, 0.04, mc, mc));
    for (const op of ops) g.in(M(op.x, 0.2, -0.05), () => balustrade(g, 0.36, 0.17, mc, { every: 0.08 }));
  });
  g.surf(K_PLAIN, 1);
  lid(g, -bw, bw, -bw, bw, y5 + 0.1, [0.07, 0.06, 0.055]); lid(g, -bw, bw, -bw, bw, y6 - 0.02, [0.04, 0.035, 0.03], -1);
  g.surf(K_WOOD, 0.85); g.in(M(0, y6 - 0.2, 0), () => g.beam(1.1, 0.09, 0.09, 0.012, woodTint(rgb(0x4b3423), 4), 2));
  g.surf(K_PLAIN, 0.32, 0.9);
  g.in(M(0, y5 + 0.52, 0), () => g.lathe([[0.34, 0], [0.33, 0.03], [0.27, 0.08], [0.22, 0.2], [0.19, 0.36], [0.16, 0.46], [0.09, 0.52], [0.05, 0.54], [0.05, 0.62], [0, 0.62]], nq(18), (x, y, z) => mul(BRASS, 0.8 + 0.3 * noise3(x * 9, y * 9, z * 9))));
  g.in(M(0, y5 + 0.46, 0), () => g.add(new THREE.SphereGeometry(0.05, 8, 6), IRON));
  band(g, hx + 0.01, hx + 0.01, y6 - 0.03, 0.15, 0.13, mc);
  // the cap: a low marble drum and a tiled pyramid, a gilded ball, a pinnacle at each corner
  g.surf(K_STONE, 0.85); g.in(M(0, y6 + 0.22, 0), () => g.cbox(1.0, 0.24, 1.0, 0.014, mc));
  for (let s = 0; s < 4; s++) g.in(M(0, y6 + 0.22, 0, 0, s * 90, 0).multiply(M(0, 0, 0.502)), () => { g.surf(K_PLAIN, 0.3); g.poly([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [Math.cos(i * 0.785) * 0.07, Math.sin(i * 0.785) * 0.07, 0.004]), 0, 0, 1, GLASS); g.surf(K_STONE, 0.85); g.in(M(0, 0, 0.004), () => g.add(new THREE.TorusGeometry(0.075, 0.016, 4, nq(12)), MARBLE)); });
  hipRoof(g, 0.56, 0.56, y6 + 0.34, y6 + 1.42, 0, TERRA, 540, { round: true, ridgeCol: TERRA[3], ridgeMetal: 0, tw: 0.14, th: 0.13 });
  g.in(M(0, y6 + 1.4, 0), () => finial(g, 'ball', 0.62, {}));
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) g.in(M(sx * 0.64, y6 + 0.12, sz * 0.64), () => obeliskOn(g, 0.5, 0.055, mc, GOLD, {}));
}

// =====================================================================================================
// The Sun Kings: whitewash and red tile, gilding thick as bark
// =====================================================================================================
const S_WHITE = rgb(0xefe9da), S_GOLD = rgb(0xe2ac30), S_DOOR = rgb(0x4a2c1a);
const limeCol = (seed = 0) => (x, y, z) => mul(S_WHITE, 0.9 + 0.12 * fbm3(x * 1.9 + seed, y * 1.9, z * 1.9, 2));
const gilt = (x, y, z) => mul(S_GOLD, 0.72 + 0.5 * noise3(x * 24, y * 24, z * 24));
/** a twisted gilded column h high standing on the local origin */
function twistColumn(g, h, r) {
  g.surf(K_PLAIN, 0.35, 0.85);
  g.cyl(r * 1.5, r * 1.5, r * 1.2, 8, gilt, false, true);
  g.sheet(nq(10), nq(Math.round(h / 0.035)), (u, v) => { const a = u * TAU, tw = v * h * 26, rr = r * (0.82 + 0.26 * Math.cos(a - tw)); return [Math.cos(a) * rr + 0.25 * r * Math.cos(tw), r * 1.2 + v * (h - r * 3), Math.sin(a) * rr + 0.25 * r * Math.sin(tw)]; }, gilt, true, true);
  g.in(M(0, h - r * 1.8, 0), () => g.lathe([[r, 0], [r * 1.25, r * 0.5], [r * 1.7, r * 1.4], [r * 1.7, r * 1.8], [0, r * 1.8]], 8, gilt));
}
function baroqueChurch(g) {
  const lime = limeCol(3), hx = 1.3, z0 = -2.3, z1 = 1.5, cz = (z0 + z1) / 2, hz = (z1 - z0) / 2, wy = 2.5, tz = -1.35, wo = { frame: S_WHITE, bars: [1, 3], arch: true, kind: K_PLASTER, glass: [0.5, 0.36, 0.16], glow: 0.3 };
  const plinth = (W) => { g.surf(K_STONE, 0.92); g.in(M(0, 0.1, 0.014), () => g.cbox(2 * W + 0.06, 0.22, 0.05, 0.012, stoneTint(rgb(0xa39a88), 3, 5))); };
  // the nave and the short arms of the crossing
  g.in(M(0, 0, cz), () => {
    plainBox(g, hx, hz, 0, wy, lime, { skip: [0], each: (s, W) => {
      plinth(W);
      if (s === 2) return;
      for (const x of [-1.3, 1.25]) { g.in(M(x * (s === 1 ? -1 : 1), 1.5, 0), () => win(g, 0.3, 0.8, wo)); }
      for (const x of [-1.9, -0.55, 0.55, 1.9]) { g.surf(K_PLASTER, 0.92); g.in(M(x, wy / 2, 0.05), () => g.cbox(0.16, wy, 0.12, 0.014, lime)); g.in(M(x, 0.4, 0.1, -12, 0, 0), () => g.cbox(0.16, 0.9, 0.14, 0.014, lime)); }
    } });
    band(g, hx + 0.005, hz + 0.005, wy - 0.06, 0.1, 0.07, lime, K_PLASTER);
    gableRoof(g, hx + 0.1, hz - 0.02, wy + 0.02, wy + 0.9, RED_TILE, 610, { round: true, ridgeCol: RED_TILE[3], ridgeMetal: 0 });
    g.surf(K_PLASTER, 0.92); facet(g, [[-hx, wy, -hz], [hx, wy, -hz], [0, wy + 0.86, -hz]], S_WHITE, [0, 0, -1]);
  });
  g.in(M(0, 0, tz), () => {
    plainBox(g, 1.8, 0.55, 0, wy - 0.25, lime, { each: (s, W) => { plinth(W); if (s % 2) { g.in(M(0, 1.4, 0), () => win(g, 0.34, 0.9, wo)); g.surf(K_PLASTER, 0.92); facet(g, [[-W, wy - 0.25, 0], [W, wy - 0.25, 0], [0, wy + 0.32, 0]], S_WHITE); g.surf(K_PLAIN, 0.35, 0.85); g.in(M(0, wy - 0.02, 0.014), () => sunDisc(g, 0.5, S_GOLD, { rays: 12 })); } } });
    g.in(M(0, 0, 0, 0, 90, 0), () => gableRoof(g, 0.63, 1.86, wy - 0.25, wy + 0.36, RED_TILE, 620, { round: true, ridgeCol: RED_TILE[3], ridgeMetal: 0 }));
    // the dome over the crossing: a windowed drum, red tile between white ribs, a gilded lantern
    g.surf(K_PLASTER, 0.92); g.in(M(0, wy + 0.5, 0), () => g.cbox(2.0, 1.1, 2.0, 0.02, lime));
    band(g, 1.0, 1.0, wy + 0.98, 0.1, 0.07, lime, K_PLASTER);
    g.in(M(0, wy + 1.05, 0), () => domeOn(g, 0.95, { shape: 'hemi', drum: 0.62, drumCol: lime, drumKind: K_PLASTER, drumWin: [0.95, 0.72, 0.32], drumN: 8, drumGlow: 0.5, col: domeTiles(RED_TILE, 10), ribs: 8, ribCol: S_WHITE, seg: 32, finial: 'lantern', finS: 1.15, lan: S_WHITE, lanKind: K_PLASTER, capCol: RED_TILE[0], fin: S_GOLD }));
  });
  // the apse behind the altar
  g.in(M(0, 0, z0), () => { g.surf(K_PLASTER, 0.92); g.lathe([[0.7, -0.1], [0.7, 1.95], [0.76, 2.0], [0.76, 2.08]], nq(20), lime, Math.PI, TAU); g.surf(K_ROOF, 0.7); g.in(M(0, 2.08, 0), () => g.lathe(DOME.low.map(([rr, y]) => [rr * 0.78, y * 0.78]), nq(20), (x, y, z) => domeTiles(RED_TILE, 8)(Math.atan2(z, x), y / 0.5, x, y, z), Math.PI, TAU)); });
  // the twin bell towers
  const tx = 1.4, tzc = 1.72, th = 0.56, ty = 3.9, by = 4.9;
  for (const e of [-1, 1]) g.in(M(e * tx, 0, tzc), () => {
    plainBox(g, th, th, 0, ty, lime, { each: (s, W) => {
      plinth(W);
      g.surf(K_PLASTER, 0.92); for (const q of [-1, 1]) g.in(M(q * (W - 0.06), ty / 2, 0.016), () => bx(g, 0.13, ty, 0.04, lime));
      for (const [y, hh] of [[1.75, 0.5], [3.05, 0.6]]) g.in(M(0, y, 0), () => win(g, 0.2, hh, { ...wo, bars: [0, 2], glass: s === 0 ? wo.glass : GLASS, glow: s === 0 ? 0.3 : 0 }));
      if (s === 0) { g.surf(K_PLAIN, 0.35, 0.85); g.in(M(0, 0.95, 0.016), () => sunDisc(g, 0.6, S_GOLD, { rays: 8 })); }
    } });
    for (const y of [1.3, 2.5]) band(g, th + 0.004, th + 0.004, y - 0.04, 0.08, 0.05, lime, K_PLASTER);
    band(g, th + 0.01, th + 0.01, ty - 0.06, 0.14, 0.11, lime, K_PLASTER);
    for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-0.5, ty + 0.08, 0.5)), () => {
      const op = { x: 0.5, w: 0.46, sp: 0.5, y0: 0.14 };
      g.surf(K_PLASTER, 0.92);
      archWall(g, 1.0, by - ty - 0.08, [op], { t: 0.13, col: lime, inCol: (x, y, z) => mul(S_WHITE, 0.6), d: 0.2 });
      g.surf(K_PLAIN, 0.35, 0.85); voussoirs(g, op, 0.06, S_GOLD, mul(S_GOLD, 0.8), 0.014, 9);
      for (const q of [-1, 1]) g.in(M(0.5 + q * 0.37, 0, 0.03), () => { g.surf(K_PLASTER, 0.9); columnOn(g, 0.86, 0.04, S_WHITE, S_GOLD, { capMetal: 0.85 }); });
    });
    g.surf(K_PLAIN, 1); lid(g, -0.5, 0.5, -0.5, 0.5, ty + 0.2, [0.07, 0.06, 0.055]); lid(g, -0.5, 0.5, -0.5, 0.5, by - 0.03, [0.04, 0.035, 0.03], -1);
    g.surf(K_PLAIN, 0.32, 0.9); g.in(M(0, ty + 0.36, 0), () => g.lathe([[0.2, 0], [0.19, 0.02], [0.15, 0.08], [0.12, 0.24], [0.08, 0.32], [0.03, 0.36], [0.03, 0.56], [0, 0.56]], nq(14), BRASS));
    band(g, 0.505, 0.505, by - 0.04, 0.13, 0.1, lime, K_PLASTER);
    g.in(M(0, by + 0.09, 0), () => domeOn(g, 0.43, { shape: 'hemi', drum: 0.5, drumCol: lime, drumKind: K_PLASTER, drumWin: [0.2, 0.16, 0.12], drumN: 8, drumGlow: 0, col: domeTiles(RED_TILE, 8), ribs: 8, ribCol: S_WHITE, seg: 24, finial: 'ball', finS: 0.6, fin: S_GOLD }));
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) g.in(M(sx * 0.5, by + 0.09, sz * 0.5), () => { g.surf(K_PLAIN, 0.35, 0.85); g.lathe([[0.05, 0], [0.065, 0.03], [0.03, 0.06], [0.06, 0.14], [0.05, 0.2], [0.012, 0.26], [0, 0.36]], nq(8), gilt); });
  });
  // the front between the towers: whitewash buried in gilded carving, a scrolled gable, heavy doors
  const fz = 2.12, fw = tx - th, fh = 3.3;
  g.in(M(0, 0, fz), () => {
    g.surf(K_PLAIN, 0.5, 0.5);
    // carved and gilded field: scrollwork thick about the door and window, thinning toward the edges
    const nu = nq(46), nv = nq(84), orn = (x, y) => { const ax = Math.abs(x), f = Math.sin(ax * 23 + 2.6 * Math.sin(y * 9)) * Math.cos(y * 17 + 2.2 * Math.cos(ax * 13)), zone = smooth(0.84, 0.5, ax) * (0.55 + 0.45 * smooth(0.2, 0.6, Math.abs(Math.sin(y * 1.9 + 0.6)))); return Math.abs(f) < 0.34 * zone ? 1 : 0; };
    g.sheet(nu, nv, (u, v) => { const x = (u - 0.5) * 2 * fw, y = v * fh; return [x, y, orn(x, y) * 0.016]; }, (x, y, z) => { const o = z > 0.008; g.metal = o ? 0.85 : 0; g.rough = o ? 0.35 : 0.92; return o ? gilt(x, y, z) : lime(x, y, z); });
    g.surf(K_STONE, 0.92); g.in(M(0, 0.1, 0.02), () => g.cbox(2 * fw, 0.22, 0.06, 0.012, stoneTint(rgb(0xa39a88), 3, 5)));
    // the door: iron-studded oak under a gilded arch, twisted columns either side
    g.in(M(0, 0.2, 0.02), () => {
      g.surf(K_PLAIN, 1); g.poly(archPts(0.7, 1.05, 'round', 10).concat([[0.35, 0], [-0.35, 0]]).map((p) => [p[0], p[1], 0.004]), 0, 0, 1, [0.03, 0.025, 0.02]);
      g.surf(K_WOOD, 0.75);
      for (const e of [-1, 1]) g.in(M(e * 0.172, 0.6, 0.02), () => { g.cbox(0.33, 1.2, 0.05, 0.01, (x, y) => mul(S_DOOR, (0.8 + 0.3 * hash1(Math.floor((x + 0.2) / 0.085), 3)) * (0.85 + 0.2 * noise3(x * 30, y * 3, 1)))); for (const yy of [-0.36, 0.0, 0.36]) g.in(M(0, yy, 0.03), () => g.cbox(0.24, 0.26, 0.02, 0.008, mul(S_DOOR, 0.75))); g.surf(K_PLAIN, 0.4, 0.9); for (let i = 0; i < 4; i++) for (let j = 0; j < 7; j++) g.in(M(-0.135 + i * 0.09, -0.54 + j * 0.18, 0.027), () => g.stud(0.014, S_GOLD, 5)); g.in(M(-e * 0.11, -0.05, 0.045), () => g.add(new THREE.TorusGeometry(0.04, 0.01, 4, 10), S_GOLD)); g.surf(K_WOOD, 0.75); });
      g.surf(K_PLAIN, 0.35, 0.85);
      const ap = archPts(0.76, 1.05, 'round', 12).map((p) => [p[0], p[1], 0.05]); g.tube([[-0.38, 0, 0.05], ...ap, [0.38, 0, 0.05]], 0.045, 6, gilt, true);
      g.in(M(0, 1.2, 0.03), () => prism(g, archPts(0.68, 0, 'round', 8), 0.03, [0.3, 0.07, 0.05], [0, 0.1]));
      g.in(M(0, 1.3, 0.06), () => sunDisc(g, 0.5, S_GOLD, { rays: 10 }));
      for (const x of [-0.72, -0.52, 0.52, 0.72]) g.in(M(x, 0, 0.1), () => { g.surf(K_PLASTER, 0.9); g.in(M(0, 0.15, 0), () => g.cbox(0.15, 0.3, 0.15, 0.012, lime)); g.in(M(0, 0.3, 0), () => twistColumn(g, 1.3, 0.05)); });
      g.surf(K_PLASTER, 0.9); g.in(M(0, 1.68, 0.07), () => g.mould([[0, 0], [0.04, 0.02], [0.05, 0.07], [0.1, 0.1], [0.1, 0.15], [0, 0.15]], 2 * fw, lime, 0, 0, 2, true, true));
      g.surf(K_PLAIN, 0.35, 0.85); g.in(M(0, 1.7, 0.175), () => bx(g, 2 * fw, 0.03, 0.012, S_GOLD));
    });
    // above the door: a tall window in a gilded frame, a figure in a niche either side, the second cornice
    g.in(M(0, 2.55, 0.02), () => { win(g, 0.4, 0.85, { ...wo, frame: S_GOLD, kind: K_PLAIN, bars: [1, 3], ft: 0.05, z: 0.05 }); });
    for (const e of [-1, 1]) g.in(M(e * 0.56, 2.42, 0.02), () => { g.surf(K_PLAIN, 1); g.poly(archPts(0.26, 0.42, 'round', 8).concat([[0.13, -0.3], [-0.13, -0.3]]).map((p) => [p[0], p[1], 0.018]), 0, 0, 1, [0.32, 0.1, 0.07]); g.in(M(0, -0.3, 0.06), () => { g.surf(K_PLASTER, 0.9); bx(g, 0.3, 0.05, 0.12, S_WHITE); statue(g, 0.62, S_WHITE, e + 4, { kind: K_PLASTER }); }); g.surf(K_PLAIN, 0.35, 0.85); g.tube([[-0.13, -0.3, 0.03], ...archPts(0.26, 0.42, 'round', 8).map((p) => [p[0], p[1], 0.03]), [0.13, -0.3, 0.03]], 0.022, 5, gilt, true); });
    g.surf(K_PLASTER, 0.9); g.in(M(0, fh - 0.06, 0.02), () => g.mould([[0, 0], [0.04, 0.02], [0.05, 0.07], [0.1, 0.1], [0.1, 0.15], [0, 0.15]], 2 * fw, lime, 0, 0, 2, true, true));
    // the scrolled gable: volutes rolling up to a sunburst, gilded along its edge, urns on its shoulders
    const half = [[fw, 0], [fw, 0.2], [fw - 0.16, 0.26], [fw - 0.3, 0.42], [fw - 0.27, 0.62], [fw - 0.4, 0.72], [0.34, 0.78], [0.3, 0.98], [0.16, 1.14], [0, 1.2]], out = [...half.slice(0, -1).map(([x, y]) => [-x, y]), ...half.slice().reverse()];
    g.in(M(0, fh + 0.08, -0.06), () => {
      g.surf(K_PLASTER, 0.92); prism(g, out, 0.22, lime, [0, 0.3]);
      g.surf(K_PLAIN, 0.35, 0.85); g.tube(out.map(([x, y]) => [x, y, 0.115]), 0.03, 5, gilt, false);
      g.in(M(0, 0.58, 0.115), () => sunDisc(g, 1.15, S_GOLD, { rays: 16 }));
      for (const e of [-1, 1]) { g.in(M(e * (fw - 0.34), 0.5, 0.115), () => g.add(new THREE.TorusGeometry(0.075, 0.024, 5, nq(12)), gilt)); g.in(M(e * (fw - 0.08), 0.2, 0), () => g.lathe([[0.06, 0], [0.08, 0.03], [0.035, 0.07], [0.075, 0.16], [0.06, 0.24], [0.02, 0.3], [0, 0.4]], nq(8), gilt)); }
      g.in(M(0, 1.18, 0), () => finial(g, 'ball', 0.6, { fin: S_GOLD }));
    });
    // the wall behind the gable
    g.surf(K_PLASTER, 0.92);
  });
  // steps up to the door
  g.in(M(0, 0, 2.95), () => steps(g, 1.5, 3, 0.07, 0.19, rgb(0xb5ab98), 5));
  g.moss = 0.5;
}
function aqueduct(g) {
  const hz = 0.36, sp = 1.42, H = 2.2, st = blockStyle(0xb5a88c, 630, { chip: 0.3, var: 0.16, r: 0.02 }), base = rgb(0xb5a88c);
  const blocks = (x, y, z) => { const j = Math.floor(y / 0.2), i = Math.floor(x / 0.46 + (j % 2) * 0.5), h = hash1(i, j, 7); return mul(mix(base, h > 0.8 ? rgb(0x9a8a70) : rgb(0xc4b596), h), (0.8 + 0.3 * h) * (0.88 + 0.2 * noise3(x * 6, y * 6, z * 6))); };
  const dark = (x, y, z) => mul(blocks(x, y, z), 0.62);
  // five piers (the end ones halved, to meet the next length), each on a wider foot
  for (let i = 0; i < 5; i++) {
    const end = i === 0 || i === 4, x = end ? (i ? 2.87 : -2.87) : -3 + i * 1.5, hw = end ? 0.13 : 0.26;
    g.in(M(x, 0, 0), () => {
      stoneBox(g, hw, hz, 0, sp, st, 631 + i, { noFoot: false });
      g.surf(K_STONE, 0.94);
      g.in(M(0, 0.06, 0), () => g.cbox(2 * hw + (end ? 0 : 0.14), 0.2, 2 * hz + 0.14, 0.02, stoneTint(mul(base, 0.85), i, 4)));
      g.in(M(0, sp - 0.04, 0), () => g.cbox(2 * hw + (end ? 0 : 0.08), 0.09, 2 * hz + 0.08, 0.016, stoneTint(mul(base, 1.05), i + 3, 4)));
    });
  }
  // the great arches and the wall they carry; a second tier of little arches under the channel
  const ops = [0, 1, 2, 3].map((i) => ({ x: 0.75 + i * 1.5, w: 0.98, sp }));
  g.surf(K_STONE, 0.94);
  g.in(M(-3, 0, hz - 0.022), () => archWall(g, 6, H, ops, { t: 2 * hz - 0.044, col: blocks, inCol: dark, d: 0.1 }));
  for (const e of [-1, 1]) g.in(M(-3 * e, 0, e * (hz - 0.022), 0, e > 0 ? 0 : 180, 0), () => { for (const op of ops) voussoirs(g, op, 0.17, mul(base, 1.08), mul(base, 0.8), 0.026, 11); });
  const rnd = rng(641);
  for (let i = 0; i < 130; i++) { const e = i % 2 ? 1 : -1, x = -2.9 + rnd() * 5.8, y = 1.45 + rnd() * 0.7, bay = ((x + 3) % 1.5) - 0.75; if (Math.hypot(bay, Math.floor(y / 0.2) * 0.2 + 0.1 - sp) < 0.78) continue; g.in(M(x, Math.floor(y / 0.2) * 0.2 + 0.1, e * (hz - 0.012)), () => g.cbox(0.2 + 0.2 * rnd(), 0.17, 0.03, 0.012, stoneTint(mul(base, 0.8 + 0.4 * rnd()), i, 5))); }
  g.in(M(0, H + 0.04, 0), () => g.cbox(6, 0.1, 2 * hz + 0.12, 0.016, stoneTint(mul(base, 1.04), 9, 4)));
  const ops2 = []; for (let i = 0; i < 12; i++) ops2.push({ x: 0.25 + i * 0.5, w: 0.3, sp: 0.3, n: 7 });
  g.in(M(-3, H + 0.09, hz - 0.06), () => archWall(g, 6, 0.62, ops2, { t: 2 * hz - 0.12, col: blocks, inCol: dark, d: 0.1 }));
  for (const e of [-1, 1]) g.in(M(-3 * e, H + 0.09, e * (hz - 0.06), 0, e > 0 ? 0 : 180, 0), () => { for (const op of ops2) voussoirs(g, op, 0.06, mul(base, 1.08), mul(base, 0.8), 0.014, 5); });
  // the channel on top: a stone trough brim-full of running water
  const cy = H + 0.71;
  g.in(M(0, cy + 0.04, 0), () => g.cbox(6, 0.09, 2 * hz + 0.1, 0.016, stoneTint(mul(base, 1.04), 11, 4)));
  for (const e of [-1, 1]) g.in(M(0, cy + 0.17, e * (hz - 0.07)), () => g.cbox(6, 0.2, 0.13, 0.016, stoneTint(mul(base, 0.95), 13 + e, 4)));
  water(g, -3, 3, -hz + 0.13, hz - 0.13, cy + 0.2, 3, [0.12, 0.4, 0.5], 0.16);
  // age: a leak down one pier, a green stain under it, creepers
  g.in(M(-1.5, 0, hz + 0.02), () => creeper(g, 0.44, 1.5, 5, { leaves: 16, size: 0.06 }));
  g.in(M(1.6, H, hz + 0.01), () => creeper(g, 0.5, -0.7, 7, { leaves: 12, size: 0.055 }));
  g.in(M(-2.2, H + 0.6, -hz - 0.01, 0, 180, 0), () => creeper(g, 0.5, -0.9, 9, { leaves: 12, size: 0.055 }));
  g.moss = 1.5;
}

// =====================================================================================================
// The Caliphate: sandstone and turquoise tile, horseshoe arches, striped awnings
// =====================================================================================================
const C_SAND = rgb(0xd2a971), C_PLASTER = rgb(0xdcc096), C_COBALT = rgb(0x1c3f8f), C_WHITE = rgb(0xeee8d8), C_RED = rgb(0xb03a2a);
/** glazed tilework: diamonds of turquoise, cobalt and white (u along the band, v up it) */
const tileCol = (n = 8, seed = 0) => (x, y, z, nx, ny, nz, u = 0, v = 0) => {
  const a = Math.abs(tri1(u * n) - 0.5) * 2, b = Math.abs(v - 0.5) * 2, d = a + b, k = 0.85 + 0.25 * noise3(x * 30 + seed, y * 30, z * 30);
  if (v < 0.1 || v > 0.9) return mul(C_WHITE, k);
  return mul(d < 0.42 ? C_WHITE : d < 0.8 ? C_COBALT : d < 1.2 ? TURQ[1] : TURQ[3], k);
};
/** a band of tilework round a drum of radius r: from y0, h high, standing a little proud */
function tileBand(g, r, y0, h, n = 8, seed = 0) {
  g.surf(K_PLAIN, 0.3, 0.1);
  g.sheet(nq(72), 6, (u, v) => { const a = u * TAU; return [Math.cos(a) * (r + 0.012), y0 + v * h, Math.sin(a) * (r + 0.012)]; }, tileCol(n, seed), true, true);
  for (const y of [y0, y0 + h]) g.in(M(0, y, 0), () => g.add(new THREE.TorusGeometry(r + 0.012, 0.016, 4, nq(28)).rotateX(Math.PI / 2), C_WHITE));
}
/** a flat panel of tilework W x H on the local XY plane facing +Z (origin at its lower left) */
function tilePanel(g, W, H, n, seed = 0) { g.surf(K_PLAIN, 0.3, 0.1); g.sheet(Math.max(4, Math.round(W / 0.035)), 6, (u, v) => [u * W, v * H, 0], tileCol(n, seed)); }
/** a balcony corbelled out in tiers of little scalloped niches: from radius r0 at y0 out to r1, h high; returns nothing */
function corbel(g, r0, r1, y0, h, n, col) {
  g.surf(K_STONE, 0.85);
  const T = 3;
  for (let k = 0; k < T; k++) {
    const ra = lerp(r0, r1, k / T), rb = lerp(r0, r1, (k + 1) / T), ya = y0 + (h * k) / T, yb = y0 + (h * (k + 1)) / T, ph = k % 2 ? 0.5 : 0;
    g.sheet(nq(n * 6), 3, (u, v) => { const a = u * TAU, sc = Math.abs(Math.sin((u * n + ph) * Math.PI)), rr = lerp(ra, rb, Math.pow(v, 0.6)) * (1 - 0.1 * sc * (1 - v * 0.5)); return [Math.cos(a) * rr, lerp(ya, yb, v), Math.sin(a) * rr]; },
      (x, y, z, nx, ny, nz, u, v) => mul(col, (0.55 + 0.5 * (1 - Math.abs(Math.sin((u * n + ph) * Math.PI)))) * (0.8 + 0.3 * v)), true, true);
    g.lathe([[rb * 0.9, yb - 0.004], [rb, yb]], nq(n * 3), mul(col, 0.6));
  }
}
/** a round balcony: deck of radius R at height y, a pierced parapet and its rail */
function balcony(g, R, y, col) {
  g.surf(K_STONE, 0.85);
  g.lathe([[0, y], [R, y], [R + 0.02, y + 0.02], [R + 0.02, y + 0.05], [R, y + 0.06]], nq(28), col);
  g.sheet(nq(64), 3, (u, v) => { const a = u * TAU; return [Math.cos(a) * R, y + 0.06 + v * 0.22, Math.sin(a) * R]; }, (x, yy, z, nx, ny, nz, u, v) => (Math.abs(tri1(u * 14) - 0.5) * 2 + Math.abs(v - 0.5) * 2 < 0.62 ? [0.05, 0.04, 0.035] : mul(col, 0.9 + 0.2 * noise3(x * 20, yy * 20, z * 20))), true, true);
  g.in(M(0, y + 0.29, 0), () => g.add(new THREE.TorusGeometry(R, 0.022, 5, nq(28)).rotateX(Math.PI / 2), mul(col, 1.08)));
  for (let i = 0; i < 8; i++) { const a = i * 0.785; g.in(M(Math.cos(a) * R, y + 0.06, Math.sin(a) * R), () => g.lathe([[0.03, 0], [0.03, 0.26], [0.045, 0.28], [0.02, 0.33], [0, 0.37]], 6, mul(col, 1.05))); }
}
function minaret(g) {
  const ss = blockStyle(0xd2a971, 710, { course: 0.16, len: [0.26, 0.46] }), r = ss.r, sc = stoneTint(C_SAND, 3, 5), by = 1.3;
  const shaft = (r0, r1, y0, y1, seed) => { g.surf(K_STONE, 0.9); g.sheet(nq(40), Math.max(4, Math.round((y1 - y0) / 0.08)), (u, v) => { const a = u * TAU, rr = lerp(r0, r1, v); return [Math.cos(a) * rr, lerp(y0, y1, v), Math.sin(a) * rr]; },
    (x, y, z) => { const j = Math.floor(y / 0.08), a = Math.atan2(z, x) / TAU + (j % 2) * 0.5 / 14; return mul(C_SAND, (0.84 + 0.2 * hash1(Math.floor(a * 14 + 40), j, seed)) * (0.9 + 0.14 * noise3(x * 9, y * 9, z * 9))); }, true, true); };
  // the square foot: coursed sandstone, a horseshoe door, blind arches on the other faces, a belt of tile
  stoneBox(g, 0.72, 0.72, 0, by, ss, 711, { each: (s, W) => {
    const fw = 2 * (W - r);
    g.in(M(0.02, by - 0.3, 0.02), () => tilePanel(g, fw - 0.04, 0.2, 9, s));
    g.in(M(fw / 2, 0, 0.012), () => {
      if (s === 0) { g.surf(K_WOOD, 0.8); g.in(M(0, 0.33, 0.01), () => g.cbox(0.34, 0.66, 0.03, 0.006, woodTint(rgb(0x5a3a22), 3))); g.surf(K_PLAIN, 0.4, 0.9); for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) g.in(M(-0.1 + i * 0.1, 0.12 + j * 0.14, 0.027), () => g.stud(0.012, BRASS, 5)); }
      archFrame(g, 0.4, 0.92, 'horse', C_WHITE, { t: 0.04, stripe: C_RED, fill: s === 0 ? [0.05, 0.04, 0.03] : mul(TURQ[2], 0.55) });
    });
  } });
  band(g, 0.725, 0.725, by - 0.04, 0.1, 0.06, sc);
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) g.in(M(sx * 0.6, by + 0.06, sz * 0.6, 0, 45 * sx * sz, 0), () => { g.surf(K_STONE, 0.9); prism(g, MERLON.step(0.26, 0.3), 0.1, sc); });
  g.surf(K_STONE, 0.9); g.in(M(0, 0, 0, 0, 22.5, 0), () => g.lathe([[0.74, by + 0.05], [0.56, by + 0.3], [0.5, by + 0.34]], 8, sc));
  // the lower shaft, belted with tile, slit windows winding up it
  shaft(0.47, 0.42, by + 0.3, 4.5, 1);
  tileBand(g, 0.462, 1.95, 0.24, 8, 1); tileBand(g, 0.445, 2.95, 0.42, 6, 2); tileBand(g, 0.426, 4.02, 0.2, 8, 3);
  for (let i = 0; i < 6; i++) { const a = i * 1.9 + 0.4, y = 2.4 + (i % 3) * 0.62 + (i > 2 ? 0.12 : 0), rr = lerp(0.47, 0.42, (y - by - 0.3) / (4.2 - by)) + 0.004; g.in(M(Math.cos(a) * rr, y, Math.sin(a) * rr, 0, 90 - a / DEG, 0), () => windowPane(g, 0.07, 0.3, { shape: 'round', col: [0.05, 0.04, 0.03], glow: 0, trim: C_WHITE })); }
  // first balcony
  corbel(g, 0.43, 0.78, 4.26, 0.3, 14, C_SAND); balcony(g, 0.78, 4.56, mul(C_SAND, 1.05));
  // the upper shaft and the second balcony
  shaft(0.34, 0.31, 4.6, 6.0, 2);
  tileBand(g, 0.338, 5.0, 0.22, 7, 4); tileBand(g, 0.322, 5.6, 0.14, 9, 5);
  for (let i = 0; i < 2; i++) { const a = i * Math.PI + Math.PI / 2; g.in(M(Math.cos(a) * 0.342, 4.8, Math.sin(a) * 0.342, 0, 90 - a / DEG, 0), () => { g.surf(K_PLAIN, 1); g.poly(archPts(0.18, 0.28, 'horse', 8).concat([[0.09, -0.12], [-0.09, -0.12]]).map((p) => [p[0], p[1], 0.006]), 0, 0, 1, [0.04, 0.03, 0.025]); }); }
  corbel(g, 0.315, 0.58, 5.8, 0.24, 12, C_SAND); balcony(g, 0.58, 6.04, mul(C_SAND, 1.05));
  // the lantern: six lit arches, and a small ribbed dome with a gilded finial of balls
  g.surf(K_STONE, 0.9);
  g.sheet(nq(48), 8, (u, v) => { const a = u * TAU; return [Math.cos(a) * 0.25, 6.08 + v * 0.62, Math.sin(a) * 0.25]; }, (x, y, z, nx, ny, nz, u, v) => { const lu = (((u * 6) % 1) + 1) % 1 - 0.5, open = v > 0.14 && (v < 0.6 ? Math.abs(lu) < 0.28 : Math.hypot(lu, (v - 0.6) * 0.9) < 0.28); g.glow = open ? 0.55 : 0; return open ? [0.9, 0.6, 0.22] : mul(C_SAND, 0.9 + 0.15 * noise3(x * 12, y * 12, z * 12)); }, true, true);
  g.glow = 0;
  g.lathe([[0.25, 6.68], [0.33, 6.72], [0.33, 6.78], [0.27, 6.8]], nq(24), sc);
  g.in(M(0, 6.8, 0), () => domeOn(g, 0.27, { shape: 'bulb', drum: 0.3, drumCol: sc, col: (a, t, x, y, z) => mul(tri1((a / TAU) * 10) > 0.72 ? C_WHITE : TURQ[Math.floor(hash1(Math.round((a / TAU) * 10), Math.round(t * 5)) * 5) % 5], 0.85 + 0.25 * noise3(x * 12, y * 12, z * 12)), rough: 0.3, seg: 30, finial: 'ball', finS: 0.75 }));
  g.moss = 0.2;
}
/** a carpet hanging on the local XY plane facing +Z (origin at the middle of its top edge): border, field and medallion */
function carpet(g, w, h, seed = 0) {
  const pal = [[rgb(0xa8281e), rgb(0xe2c27a), rgb(0x1c3f8f)], [rgb(0x1c3f8f), rgb(0xe8dcc0), rgb(0xb03a2a)], [rgb(0x2a7a6a), rgb(0xe2c27a), rgb(0x8a2a3a)], [rgb(0xc8822a), rgb(0x3a2a5a), rgb(0xeee0c0)]][seed % 4];
  g.surf(K_CLOTH, 0.95);
  g.sheet(nq(10), nq(14), (u, v) => [(u - 0.5) * w, -v * h, 0.012 + 0.012 * Math.sin(u * 7 + seed) * v], (x, y, z, nx, ny, nz, u, v) => { const bu = Math.min(u, 1 - u) * w, bv = Math.min(v, 1 - v) * h, b = Math.min(bu, bv), d = Math.abs(u - 0.5) * 2 + Math.abs(v - 0.5) * 2.4; return mul(b < 0.03 ? pal[1] : b < 0.07 ? pal[2] : d < 0.5 ? pal[1] : d < 0.72 ? pal[2] : tri1(u * 5) + tri1(v * 9) > 1.5 ? pal[1] : pal[0], 0.82 + 0.25 * noise3(x * 30, y * 30, seed)); });
}
/** a market stall's worth of goods on the local origin (facing +Z): kind 0 spices, 1 pots, 2 carpets, 3 lamps and brass */
function goods(g, kind, seed = 0) {
  const SP = [rgb(0xd8a21e), rgb(0xc8481e), rgb(0x8a2a1a), rgb(0x9a7a2a), rgb(0x5a7a2a), rgb(0xe8d8a0)];
  if (kind === 0) {
    g.surf(K_WOOD, 0.9); g.in(M(0, 0.14, 0), () => g.cbox(0.62, 0.05, 0.3, 0.008, woodTint(rgb(0x6a4a2c), seed)));
    for (const e of [-1, 1]) g.in(M(e * 0.26, 0.06, 0), () => bx(g, 0.04, 0.13, 0.26, rgb(0x5a3e24)));
    for (let i = 0; i < 6; i++) g.in(M(-0.2 + (i % 3) * 0.2, 0.165, -0.07 + Math.floor(i / 3) * 0.14), () => { g.surf(K_CLOTH, 0.95); g.lathe([[0.05, 0], [0.085, 0.05], [0.075, 0.09]], nq(8), rgb(0xb49a6a)); g.surf(K_PLAIN, 0.95); g.lathe([[0.072, 0.085], [0.04, 0.13], [0, 0.16]], nq(8), SP[(i + seed) % 6]); });
  } else if (kind === 1) {
    for (const [x, z, s, c] of [[-0.2, 0, 0.34, TURQ[1]], [0.05, 0.05, 0.26, TERRA[0]], [0.24, -0.04, 0.4, C_COBALT], [-0.02, -0.14, 0.2, TERRA[2]], [0.16, 0.16, 0.16, TURQ[3]]]) g.in(M(x, 0, z), () => pot(g, s, c, { band: C_WHITE, rough: 0.35 }));
  } else if (kind === 2) {
    for (let i = 0; i < 3; i++) g.in(M(-0.16 + i * 0.16, 0.07 + (i === 1 ? 0.11 : 0), 0, 90, 0, 0), () => { g.surf(K_CLOTH, 0.95); g.in(M(0, -0.3, 0), () => g.cyl(0.07, 0.07, 0.6, nq(9), (x, y, z) => mul([rgb(0xa8281e), rgb(0x1c3f8f), rgb(0x2a7a6a)][(i + seed) % 3], 0.75 + 0.3 * tri1(Math.atan2(z, x) * 3)), true, true)); });
  } else {
    g.surf(K_WOOD, 0.9); g.in(M(0, 0.12, 0), () => g.cbox(0.5, 0.24, 0.26, 0.01, woodTint(rgb(0x6a4a2c), seed)));
    for (const [x, s] of [[-0.15, 0.2], [0.02, 0.26], [0.17, 0.17]]) g.in(M(x, 0.24, 0), () => pot(g, s, BRASS, { rough: 0.3, metal: 0.9 }));
  }
}
function bazaar(g) {
  const hx = 2.4, c = 1.45, wy = 1.72, wall = stuccoCol(C_PLASTER, 5), sc = stoneTint(C_SAND, 3, 5);
  // the floor: flags under the arcades, a tiled court
  g.surf(K_STONE, 0.95);
  g.in(M(0, 0, 0), () => g.cbox(4.86, 0.1, 4.86, 0.016, (x, y, z) => mul(rgb(0xb8a684), (0.84 + 0.2 * hash1(Math.floor(x / 0.3), Math.floor(z / 0.3))) * (0.9 + 0.14 * noise3(x * 7, 1, z * 7)))));
  g.surf(K_STONE, 0.6);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const x = -c + i * 0.3625, z = -c + j * 0.3625, k = (i + j) % 2; lid(g, x + 0.005, x + 0.3575, z + 0.005, z + 0.3575, 0.054, mul(k ? rgb(0xe2d6b8) : (i * 3 + j) % 4 === 0 ? TURQ[1] : rgb(0xb8643c), 0.9 + 0.15 * hash1(i, j))); }
  // the outer walls: blank but for small high windows, a toothed parapet; the gate breaks the front
  const face = (W) => { g.surf(K_PLASTER, 0.92); wallFace(g, W, wy, wall, 0.2); g.surf(K_STONE, 0.92); g.in(M(W / 2, 0.11, 0.012), () => g.cbox(W, 0.22, 0.04, 0.01, sc)); const n = Math.max(1, Math.round(W / 0.9)); for (let i = 0; i < n; i++) g.in(M(((i + 0.5) * W) / n, 1.15, 0.01), () => windowPane(g, 0.16, 0.34, { shape: 'horse', col: [0.06, 0.05, 0.04], glow: 0, trim: C_WHITE })); g.surf(K_PLASTER, 0.92); const m = Math.max(1, Math.round(W / 0.3)); for (let i = 0; i < m; i++) g.in(M(((i + 0.5) * W) / m, wy, -0.06), () => prism(g, MERLON.step((W / m) * 0.72, 0.22), 0.12, wall)); };
  for (let s = 1; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-hx, 0, hx)), () => face(2 * hx));
  for (const e of [-1, 1]) g.in(M(e > 0 ? 0.8 : -hx, 0, hx), () => face(hx - 0.8));
  g.surf(K_PLASTER, 0.95);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => { lid(g, -hx, hx, c, hx, wy - 0.1, mul(C_PLASTER, 0.95)); lid(g, -hx, hx, c + 0.01, hx - 0.01, wy - 0.13, [0.07, 0.06, 0.05], -1); g.shade(-c, 0, c + 0.08, c, wy - 0.12, hx - 0.06, 0.5, 0.1); });
  // the arcades round the court: horseshoe arches in red and white on slim columns, a lamp in each
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(c, 0, c, 0, 180, 0)), () => {
    const ops = s === 0 ? [{ x: 0.45, w: 0.5, sp: 0.72 }, { x: 1.45, w: 0.84, sp: 0.86 }, { x: 2.45, w: 0.5, sp: 0.72 }] : [0, 1, 2, 3].map((i) => ({ x: 0.3625 + i * 0.725, w: 0.5, sp: 0.72 }));
    for (const op of ops) op.shape = 'horse';
    g.surf(K_PLASTER, 0.92);
    archWall(g, 2 * c, wy, ops, { t: 0.14, col: wall, inCol: (x, y, z) => mul(C_PLASTER, 0.62), d: 0.2, back: false });
    for (const op of ops) {
      voussoirs(g, op, 0.09, C_RED, C_WHITE, 0.012, 11);
      for (const q of [-1, 1]) g.in(M(op.x + q * (op.w / 2 + 0.03), 0.05, 0.03), () => columnOn(g, op.sp - 0.03, 0.035, C_WHITE, sc));
      g.in(M(op.x, archTop(op.w, op.sp, 'horse') - 0.02, -0.08), () => lamp(g, 0.62, LAMPLIT, { shape: 'cage', frame: BRASS, glow: 0.8 }));
    }
    g.in(M(0.03, wy - 0.3, 0.012), () => tilePanel(g, 2 * c - 0.06, 0.16, 16, s));
    g.surf(K_PLASTER, 0.92); g.in(M(c, wy + 0.06, -0.06), () => g.cbox(2 * c + 0.1, 0.12, 0.14, 0.012, wall));
  });
  // awnings over the court, and under them the stalls: spices, pots, carpets, brass and lamps
  const AW = [[rgb(0xb03a2a), C_WHITE], [rgb(0x1c5f9f), C_WHITE], [rgb(0xd9a22e), rgb(0xb03a2a)]];
  for (let s = 1; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, c, 0, 180, 0)), () => {
    g.in(M(0, 1.36, 0.02), () => awning(g, 2.3, 0.62, AW[s - 1][0], AW[s - 1][1], { n: 9, scallop: 5 }));
    for (const [x, k] of [[-0.78, s % 4], [0, (s + 1) % 4], [0.78, (s + 2) % 4]]) g.in(M(x, 0.05, 0.26), () => goods(g, k, s * 3 + Math.round(x * 3)));
    for (const x of [-1.09, 0.36]) g.in(M(x, 1.22, -0.2), () => carpet(g, 0.42, 0.8, s + (x > 0 ? 2 : 0)));
    g.in(M(-0.36, 0.05, -0.5), () => goods(g, (s + 3) % 4, s)); g.in(M(1.0, 0.05, -0.55), () => goods(g, (s + 1) % 4, s + 5));
  });
  g.in(M(-0.9, 0.05, 1.0, 0, 30, 0), () => goods(g, 1, 2)); g.in(M(0.95, 0.05, 1.02, 0, -20, 0), () => goods(g, 0, 4));
  // the fountain in the middle of the court: a tiled basin
  g.in(M(0, 0.05, 0), () => fountain(g, 0.9, (x, y, z) => mul(y < 0.3 && Math.hypot(x, z) > 0.36 ? (Math.floor(Math.atan2(z, x) * 5.1 + 20) % 2 ? TURQ[1] : C_WHITE) : TURQ[3], 0.85 + 0.25 * noise3(x * 12, y * 12, z * 12)), 3));
  // the gate: a tall block with a horseshoe arch right through it, tile round the arch, a turquoise dome above
  const gz = 2.17, gh = 2.4;
  g.in(M(0, 0, gz), () => {
    const op = { x: 0.8, w: 0.84, sp: 0.98, shape: 'horse', n: nq(14) };
    g.surf(K_PLASTER, 0.92);
    g.in(M(-0.8, 0, 0.3), () => { archWall(g, 1.6, gh, [op], { t: 0.6, col: wall, inCol: (x, y, z) => mul(C_PLASTER, 0.75 - 0.3 * smooth(0, -0.4, z)), d: 0.2, cap: true, ends: true });
      voussoirs(g, op, 0.13, C_RED, C_WHITE, 0.016, 13);
      g.in(M(0.2, 1.72, 0.012), () => tilePanel(g, 1.2, 0.3, 7, 3));
      for (const e of [-1, 1]) g.in(M(0.8 + e * 0.64, 0.24, 0.012), () => { g.in(M(-0.07, 0, 0), () => { g.surf(K_PLAIN, 0.3, 0.1); g.sheet(3, nq(30), (u, v) => [u * 0.14, v * 1.4, 0], (x, y, z, nx, ny, nz, u, v) => tileCol(1, e)(x, y, z, 0, 0, 0, v * 9, u)); }); });
      g.surf(K_STONE, 0.92); g.in(M(0.8, 0.11, 0.014), () => { for (const e of [-1, 1]) g.in(M(e * 0.6, 0, 0), () => g.cbox(0.4, 0.22, 0.04, 0.01, sc)); });
      for (let i = 0; i < 6; i++) g.in(M(((i + 0.5) * 1.6) / 6, gh, -0.06), () => { g.surf(K_PLASTER, 0.92); prism(g, MERLON.step(0.2, 0.24), 0.12, wall); });
      for (let i = 0; i < 6; i++) g.in(M(((i + 0.5) * 1.6) / 6, gh, -0.54), () => prism(g, MERLON.step(0.2, 0.24), 0.12, wall));
    });
    g.in(M(0, gh, 0), () => domeOn(g, 0.52, { shape: 'point', drum: 0.5, drumCol: wall, drumKind: K_PLASTER, drumWin: [0.06, 0.05, 0.04], drumN: 8, drumGlow: 0, col: (a, t, x, y, z) => mul(TURQ[Math.floor(hash1(Math.round((a / TAU) * 26 * (1.15 - t)), Math.round(t * 12)) * 5) % 5], 0.8 + 0.3 * tri1(t * 12)), rough: 0.3, seg: 32, finial: 'ball', finS: 0.8 }));
  });
  // a little dome on each corner
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) g.in(M(sx * (hx - 0.28), wy - 0.1, sz * (hx - 0.28)), () => domeOn(g, 0.24, { shape: 'hemi', drum: 0.9, drumCol: wall, drumKind: K_PLASTER, col: (a, t, x, y, z) => mul(TURQ[1], 0.8 + 0.3 * noise3(x * 12, y * 12, z * 12)), rough: 0.3, seg: 18, finial: 'spike', finS: 0.4 }));
  g.moss = 0.2;
}

// =====================================================================================================
// The Shogunate: white plaster, black timber, grey tile, a little gold
// =====================================================================================================
const J_PLASTER = rgb(0xeeeae0), J_WOOD = rgb(0x2a2420), J_RED = rgb(0xb5281a), J_STONE = 0x7d7b74;
const jPlaster = (x, y, z) => mul(J_PLASTER, 0.9 + 0.12 * fbm3(x * 1.7, y * 1.7, z * 1.7, 2));
const jWood = (x, y, z) => mul(J_WOOD, 0.75 + 0.5 * noise3(x * 3, y * 31, z * 31));
/** one storey of the keep: white plaster over black boarding, posts, barred windows */
function keepStorey(g, hx, hz, y0, y1, seed) {
  const H = y1 - y0;
  plainBox(g, hx, hz, y0, y1, jPlaster, { each: (s, W) => {
    const n = Math.max(2, Math.round((2 * W) / 0.52));
    g.surf(K_WOOD, 0.85);
    g.in(M(0, H * 0.16, 0.014), () => g.cbox(2 * W, H * 0.32, 0.03, 0.006, (x, y) => mul(J_WOOD, (0.7 + 0.5 * hash1(Math.floor(x / 0.09), seed)) * (0.85 + 0.3 * noise3(x * 3, y * 20, 1)))));
    for (let i = 0; i <= n; i++) g.in(M(-W + (2 * W * i) / n, H / 2, 0.02), () => bx(g, 0.055, H, 0.045, J_WOOD));
    g.in(M(0, H - 0.035, 0.02), () => bx(g, 2 * W + 0.05, 0.07, 0.05, J_WOOD));
    for (let i = 0; i < n; i++) g.in(M(-W + (2 * W * (i + 0.5)) / n, H * 0.62, 0.012), () => {
      const lit = hash1(i, s, seed) > 0.6;
      g.surf(K_PLAIN, 0.5, 0, lit ? 0.4 : 0); g.flat([[-0.13, -0.12, 0], [0.13, -0.12, 0], [0.13, 0.12, 0], [-0.13, 0.12, 0]], lit ? [0.85, 0.62, 0.3] : [0.05, 0.045, 0.04]);
      g.surf(K_WOOD, 0.85); for (const x of [-0.13, -0.065, 0, 0.065, 0.13]) g.in(M(x, 0, 0.008), () => bx(g, 0.018, 0.27, 0.016, J_WOOD)); for (const y of [-0.13, 0.13]) g.in(M(0, y, 0.008), () => bx(g, 0.3, 0.025, 0.02, J_WOOD));
    });
  } });
}
/** a triangular dormer gable standing on a roof slope at the local origin, facing +Z: w wide, h high, running d back */
function dormer(g, w, h, d, seed) {
  g.surf(K_ROOF, 0.75);
  for (const e of [-1, 1]) tiles(g, 3, () => Math.max(2, d / 0.16), (u, v) => [e * lerp(w / 2 + 0.07, 0, v), lerp(-0.03, h + 0.04, v) + 0.05 * (1 - v) * (1 - v), lerp(0.08, -d, e > 0 ? u : 1 - u)], { pal: TILE_GREY, lift: 0.02, seed: seed + e + 2, round: true });
  g.surf(K_ROOF, 0.6); g.tube([[0, h + 0.06, 0.1], [0, h + 0.06, -d]], 0.04, 5, mul(TILE_GREY[1], 0.7), true);
  g.surf(K_PLASTER, 0.92); facet(g, [[-w / 2 + 0.04, 0, 0.02], [w / 2 - 0.04, 0, 0.02], [0, h - 0.03, 0.02]], J_PLASTER);
  g.surf(K_WOOD, 0.85); for (const e of [-1, 1]) g.beamTo([e * (w / 2 + 0.05), -0.01, 0.06], [0, h + 0.02, 0.06], 0.06, 0.05, 0.008, J_WOOD, 1, [0, 0, 1]);
  g.surf(K_PLAIN, 0.35, 0.9); g.in(M(0, h * 0.42, 0.04), () => { g.stud(0.06, GOLD, 7, 0.5); g.in(M(0, -0.1, 0), () => prism(g, [[-0.035, 0.05], [0.035, 0.05], [0, -0.08]], 0.02, GOLD)); });
  g.in(M(0, h + 0.06, 0.12), () => g.add(new THREE.IcosahedronGeometry(0.05, 0), GOLD));
}
/** a ridge-end fish: a gilded tail curling up from the local origin, facing along +X */
function ridgeFish(g, s) {
  g.surf(K_PLAIN, 0.35, 0.9);
  const c = (x, y, z) => mul(GOLD, 0.7 + 0.5 * tri1(y * 14 / s + x * 9 / s));
  limb(g, [[0.02 * s, -0.04 * s, 0], [0.06 * s, 0.14 * s, 0], [0, 0.3 * s, 0], [-0.1 * s, 0.4 * s, 0]], [0.1 * s, 0.085 * s, 0.055 * s, 0.02 * s], { nu: nq(10), nv: nq(12), flat: [1, 0.7], col: c, capA: true });
  for (const a of [-35, 0, 35]) g.in(M(-0.1 * s, 0.4 * s, 0, a, 0, 28), () => prism(g, [[0, -0.02 * s], [0.05 * s, 0.14 * s], [0, 0.2 * s], [-0.05 * s, 0.14 * s]], 0.012, GOLD));
  for (const e of [-1, 1]) g.in(M(0.05 * s, 0.12 * s, e * 0.065 * s, e * 60, 0, -30), () => prism(g, [[0, 0], [0.07 * s, 0.05 * s], [0.02 * s, 0.11 * s]], 0.01, GOLD));
  g.in(M(0.1 * s, 0.03 * s, 0), () => g.add(new THREE.SphereGeometry(0.075 * s, nq(8), nq(6)), c));
}
function tenshu(g) {
  const st = stoneStyle(J_STONE, { seed: 810, course: 0.22, len: [0.3, 0.62], r: 0.03, b: 0.022, rough: 0.012, var: 0.2, chip: 0 }), TR = { pal: TILE_GREY, round: true, lift: 0.3, sag: 0.07, hips: mul(TILE_GREY[1], 0.75), tip: GOLD, tipR: 0.06 };
  // the great stone base, its faces curving in as they rise
  batterBase(g, 2.44, 2.0, -0.1, 1.5, st, 811, { curve: 0.2 });
  g.surf(K_STONE, 0.95); lid(g, -2.0, 2.0, -2.0, 2.0, 1.5, mul(rgb(J_STONE), 0.7));
  // the gate in the base: iron-bound doors under a small tiled hood
  g.in(M(0, 0, 2.36), () => {
    g.surf(K_STONE, 0.9); g.in(M(0, 0.5, -0.1), () => g.cbox(0.92, 1.0, 0.36, 0.02, stoneTint(mul(rgb(J_STONE), 0.9), 3, 4)));
    g.surf(K_WOOD, 0.85); g.in(M(0, 0.42, 0.09), () => g.cbox(0.64, 0.84, 0.03, 0.006, jWood));
    g.surf(K_PLAIN, 0.5, 0.85); for (const y of [0.2, 0.62]) g.in(M(0, y, 0.11), () => bx(g, 0.64, 0.045, 0.01, IRON)); for (const e of [-1, 1]) for (const y of [0.2, 0.62]) for (const x of [0.08, 0.26]) g.in(M(e * x, y, 0.118), () => g.stud(0.016, GOLD, 5));
    g.in(M(0, 0.42, 0.11), () => bx(g, 0.02, 0.84, 0.01, IRON));
  });
  // four storeys, each smaller than the one below, each skirted with a curved roof
  keepStorey(g, 1.82, 1.82, 1.5, 2.48, 1);
  skirtRoof(g, 2.46, 2.46, 2.3, 1.48, 1.48, 2.98, TILE_GREY, 820, TR);
  keepStorey(g, 1.46, 1.46, 2.86, 3.78, 2);
  skirtRoof(g, 2.02, 2.02, 3.62, 1.12, 1.12, 4.24, TILE_GREY, 830, TR);
  keepStorey(g, 1.1, 1.1, 4.12, 4.98, 3);
  skirtRoof(g, 1.62, 1.62, 4.84, 0.8, 0.8, 5.38, TILE_GREY, 840, { ...TR, lift: 0.26 });
  keepStorey(g, 0.78, 0.7, 5.28, 6.06, 4);
  // dormer gables breaking the two lower roofs
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => { g.in(M(0, 2.44, 2.2), () => dormer(g, 1.2, 0.58, 0.9, 850 + s)); if (s % 2 === 0) g.in(M(0, 3.76, 1.78), () => dormer(g, 0.86, 0.44, 0.7, 860 + s)); else g.in(M(0, 4.98, 1.4), () => dormer(g, 0.66, 0.34, 0.55, 870 + s)); });
  // the veranda round the top storey: a red rail with black caps
  g.surf(K_WOOD, 0.85); g.in(M(0, 5.34, 0), () => g.cbox(2.06, 0.05, 1.92, 0.01, jWood));
  for (let s = 0; s < 4; s++) { const W = s % 2 ? 0.94 : 1.01, D = s % 2 ? 1.01 : 0.94; g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 5.36, D)), () => { g.surf(K_WOOD, 0.6); for (const y of [0.1, 0.22]) g.in(M(0, y, 0), () => bx(g, 2 * W, 0.025, 0.025, J_RED)); for (let i = 0; i <= 6; i++) g.in(M(-W + (2 * W * i) / 6, 0.13, 0), () => { bx(g, 0.035, 0.26, 0.035, J_RED); g.in(M(0, 0.15, 0), () => bx(g, 0.05, 0.04, 0.05, J_WOOD)); }); }); }
  // the crowning roof: a hipped skirt under a gable, gilded fish at the ends of the ridge
  skirtRoof(g, 1.36, 1.22, 5.96, 0.66, 0.36, 6.42, TILE_GREY, 880, { ...TR, lift: 0.24 });
  g.in(M(0, 0, 0, 0, 90, 0), () => gableRoof(g, 0.4, 0.7, 6.38, 6.86, TILE_GREY, 890, { round: true, sag: 0.04, ridgeCol: mul(TILE_GREY[1], 0.7), ridgeMetal: 0, ridgeR: 0.07 }));
  for (const e of [-1, 1]) {
    g.surf(K_PLASTER, 0.92); facet(g, [[e * 0.66, 6.4, -0.36], [e * 0.66, 6.4, 0.36], [e * 0.66, 6.82, 0]], J_PLASTER, [e, 0, 0]);
    g.surf(K_WOOD, 0.85); for (const q of [-1, 1]) g.beamTo([e * 0.69, 6.38, q * 0.42], [e * 0.69, 6.86, 0], 0.06, 0.05, 0.008, J_WOOD, 1, [e, 0, 0]);
    g.surf(K_PLAIN, 0.35, 0.9); g.in(M(e * 0.7, 6.6, 0, 0, e * 90, 0), () => { g.stud(0.07, GOLD, 7, 0.5); g.in(M(0, -0.11, 0), () => prism(g, [[-0.04, 0.05], [0.04, 0.05], [0, -0.08]], 0.02, GOLD)); });
    g.in(M(e * 0.68, 6.9, 0, 0, e > 0 ? 0 : 180, 0), () => ridgeFish(g, 0.95));
  }
  g.moss = 0.5;
}
/** a stone lantern standing on the local origin, s high */
function stoneLantern(g, s, seed = 0) {
  const c = rockCol(rgb(0x8d8b84), seed, 0.5, 9);
  g.surf(K_STONE, 0.95);
  g.lathe([[0.22, -0.04], [0.22, 0.05], [0.16, 0.09], [0.09, 0.12], [0.075, 0.2], [0.07, 0.48], [0.09, 0.52], [0.2, 0.56], [0.2, 0.6]].map(([r, y]) => [r * s, y * s]), 6, c);
  for (let i = 0; i < 6; i++) { const a = (i + 0.5) * 1.047; g.in(M(Math.cos(a) * 0.15 * s, 0.6 * s, Math.sin(a) * 0.15 * s), () => g.cyl(0.022 * s, 0.022 * s, 0.17 * s, 5, c, false, false)); }
  g.surf(K_PLAIN, 0.6, 0, 0.75); g.in(M(0, 0.6 * s, 0), () => g.cyl(0.12 * s, 0.12 * s, 0.17 * s, 6, (x, y, z) => mul([1.0, 0.7, 0.3], 0.75 + 0.3 * noise3(x * 40, y * 40, z * 40)), false, false));
  g.surf(K_STONE, 0.95);
  g.sheet(6, 5, (u, v) => { const a = u * TAU, t = v, rr = (0.34 * (1 - t) * (1 - t) + 0.05 * (1 - t) + 0.02) * s, k = 1 + 0.12 * Math.cos(a * 6) * (1 - t); return [Math.cos(a) * rr * k, (0.76 + 0.2 * t + 0.05 * (1 - t) * (1 - t) * (Math.cos(a * 6) > 0 ? 1 : 0)) * s, Math.sin(a) * rr * k]; }, c, true, true);
  g.lathe([[0.3, 0.75], [0.31, 0.77]].map(([r, y]) => [r * s, y * s]), 6, c);
  g.in(M(0, 0.95 * s, 0), () => g.lathe([[0.03, 0], [0.06, 0.04], [0.05, 0.09], [0, 0.14]].map(([r, y]) => [r * s, y * s]), 6, c));
}
function torii(g) {
  const px = 0.86, H = 2.72, red = (x, y, z) => mul(J_RED, 0.82 + 0.3 * noise3(x * 3, y * 26, z * 26)), blk = (x, y, z) => mul([0.05, 0.045, 0.045], 0.8 + 0.5 * noise3(x * 9, y * 9, z * 9));
  // worn flags under the gate
  g.surf(K_STONE, 0.95);
  for (let i = 0; i < 7; i++) for (let j = 0; j < 2; j++) g.in(M(-1.26 + i * 0.42, 0.0, -0.2 + j * 0.4), () => g.cbox(0.4, 0.07, 0.38, 0.016, stoneTint(mul(rgb(0x8d8b84), 0.85 + 0.25 * hash1(i, j)), i + j * 9, 5)));
  // the two posts: red lacquer on black feet and stone drums, leaning a little toward each other
  for (const e of [-1, 1]) g.in(M(e * px, 0, 0, 0, 0, e * 2.2), () => {
    g.surf(K_STONE, 0.95); g.lathe([[0.25, -0.05], [0.25, 0.1], [0.2, 0.15], [0.17, 0.16]], nq(16), rockCol(rgb(0x8d8b84), e + 3, 0.4, 9));
    g.surf(K_WOOD, 0.5); g.lathe([[0.15, 0.14], [0.155, 0.2], [0.14, 0.42], [0.125, 0.45]], nq(18), blk);
    g.sheet(nq(18), nq(14), (u, v) => { const a = u * TAU, rr = lerp(0.125, 0.105, v) * (1 + 0.04 * Math.sin(v * Math.PI)); return [Math.cos(a) * rr, lerp(0.44, H, v), Math.sin(a) * rr]; }, (x, y, z) => mul(J_RED, 0.82 + 0.3 * noise3(x * 26, y * 3, z * 26)), true, true);
    g.surf(K_WOOD, 0.5); g.in(M(0, H - 0.5, 0), () => g.add(new THREE.TorusGeometry(0.118, 0.02, 5, nq(16)).rotateX(Math.PI / 2), blk));
  });
  // the tie beam through the posts, wedged; the tablet between it and the lintels
  g.surf(K_WOOD, 0.5);
  g.in(M(0, 2.12, 0), () => g.beam(2.42, 0.17, 0.11, 0.014, red, 6));
  for (const e of [-1, 1]) for (const q of [-1, 1]) g.in(M(e * (px - 0.02) + q * 0.16, 2.12, 0), () => g.cbox(0.05, 0.22, 0.15, 0.01, blk));
  g.in(M(0, 2.4, 0), () => { g.cbox(0.3, 0.42, 0.09, 0.012, blk); g.surf(K_PLAIN, 0.35, 0.9); for (const q of [-1, 1]) g.in(M(0, 0, q * 0.046, 0, q > 0 ? 0 : 180, 0), () => { g.add(new THREE.TorusGeometry(0.1, 0.014, 4, nq(14)), GOLD); for (let i = 0; i < 4; i++) g.in(M(((i % 2) * 2 - 1) * 0.12, (Math.floor(i / 2) * 2 - 1) * 0.17, 0), () => g.stud(0.014, GOLD, 5)); }); });
  // the lintels: red below, black above, sweeping up at the ends
  g.surf(K_WOOD, 0.5);
  const sweep = (x) => 0.1 * Math.pow(Math.abs(x) / 1.6, 2.4);
  g.in(M(0, H - 0.03, 0), () => g.beam(2.94, 0.2, 0.15, 0.014, red, 14, (x) => [sweep(x), 0]));
  g.in(M(0, H + 0.13, 0), () => g.beam(3.2, 0.13, 0.26, 0.014, blk, 14, (x) => [sweep(x) * 1.6, 0]));
  g.in(M(0, H + 0.21, 0), () => g.beam(3.26, 0.045, 0.32, 0.01, (x, y, z) => mul([0.1, 0.1, 0.11], 0.8 + 0.4 * noise3(x * 9, y * 9, z * 9)), 14, (x) => [sweep(x) * 1.8, 0]));
  // the rope: thick twisted straw sagging between the posts, paper streamers and straw tassels hanging from it
  const rp = (t) => [lerp(-px + 0.1, px - 0.1, t), 1.86 - 0.2 * Math.sin(t * Math.PI), 0.13], pts = [];
  for (let i = 0; i <= 16; i++) pts.push(rp(i / 16));
  g.surf(K_CLOTH, 0.95);
  g.tube(pts, pts.map((_, i) => 0.03 + 0.03 * Math.sin((i / 16) * Math.PI)), nq(8), (x, y, z, nx, ny, nz, t, k) => mul(rgb(0xc8aa62), (k + Math.floor(t * 46)) % 2 ? 1.05 : 0.6), true);
  for (const e of [-1, 1]) g.in(M(e * px, 1.86, 0.02), () => g.add(new THREE.TorusGeometry(0.135, 0.03, 5, nq(14)).rotateX(Math.PI / 2), mul(rgb(0xc8aa62), 0.85)));
  for (let i = 0; i < 4; i++) {
    const p = rp((i + 0.5) / 4);
    g.surf(K_CLOTH, 0.9);
    let x = p[0], y = p[1] - 0.05;
    for (let k = 0; k < 4; k++) { const dx = (k % 2 ? -1 : 1) * 0.07; facet(g, [[x - 0.035, y, p[2] + 0.01], [x + 0.035, y, p[2] + 0.01], [x + 0.035 + dx, y - 0.1, p[2] + 0.02], [x - 0.035 + dx, y - 0.1, p[2] + 0.02]], [0.95, 0.95, 0.92]); x += dx; y -= 0.1; }
  }
  for (let i = 0; i < 3; i++) { const p = rp((i + 1) / 4); g.surf(K_CLOTH, 0.95); g.in(M(p[0], p[1] - 0.3, p[2]), () => g.cyl(0.05, 0.012, 0.28, 7, (x, y, z) => mul(rgb(0xc8aa62), 0.6 + 0.5 * tri1(Math.atan2(z, x) * 2.5)), true, false)); }
  // two stone lanterns at its feet
  for (const e of [-1, 1]) g.in(M(e * 1.2, 0.03, 0.3, 0, e * 20, 0), () => stoneLantern(g, 0.9, e + 2));
  g.moss = 1.2;
}

// =====================================================================================================
// exports
// =====================================================================================================
// id: [footprint along X, along Z, builder]. A piece that arrives with its footprint the other way round is the
// same geometry turned a quarter (as civic.js turns its long pieces).
const BUILDERS = {
  gorge_mammothYurt: [4, 4, mammothYurt], gorge_gorgeAltar: [3, 3, gorgeAltar],
  westmark_canalHouse: [2, 3, canalHouse], westmark_exchange: [5, 4, exchange],
  principalities_villa: [4, 4, villa], principalities_bellTower: [2, 2, bellTower],
  sunkings_baroqueChurch: [4, 6, baroqueChurch], sunkings_aqueduct: [6, 1, aqueduct],
  caliphate_minaret: [2, 2, minaret], caliphate_bazaar: [5, 5, bazaar],
  shogunate_tenshu: [5, 5, tenshu], shogunate_torii: [3, 1, torii],
};
const built = new Map();
function landmark(id, w, h) {
  const [W, H, make] = BUILDERS[id], turn = W !== H && Number.isFinite(w) && Number.isFinite(h) && w !== h && (w < h) !== (W < H);
  const k = `${id}|${getDetail()}`;
  if (!built.has(k)) { const g = new Geo(); make(g); built.set(k, { geo: g.build(), turned: null }); }
  const c = built.get(k);
  if (turn && !c.turned) c.turned = c.geo.clone().rotateY(Math.PI / 2);
  return meshOf(turn ? c.turned : c.geo);
}
/** every landmark of the far realms */
export const structures = Object.fromEntries(Object.keys(BUILDERS).map((id) => [id, (def, w, h, place) => landmark(id, w, h)]));
