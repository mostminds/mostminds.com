// Landmark buildings of the ruinous realms: twenty showpieces, two for each of ten realms.
//
//   structures[def.model](def, w, h, place) -> Mesh centred on its footprint, resting on y = 0
//       ironbound  ironbound_basaltMonolith ironbound_skullAltar      screaming  screaming_warpSpire screaming_fungalGarden
//       cloven     cloven_herdstone cloven_hideTent                   fimbul     fimbul_longhouse fimbul_whaleShrine
//       ashur      ashur_forgeZiggurat ashur_blastFurnace             greenhide  greenhide_idol greenhide_boneTower
//       skar       skar_reactor skar_scaffoldWarren                   crimson    crimson_mausoleum crimson_gallows
//       khemet     khemet_pyramid khemet_sphinxStatue                 drowned    drowned_hullHouse drowned_lighthouse
//
// Built like factions.js and with the same construction kit (repeated here because that module keeps it private):
// everything is emitted into one vertex-coloured geometry for the shared sculpt material, built once per model and
// detail preset; every placement shares it (a piece placed turned shares a turned copy). Nothing is built at module
// load and nothing here calls Math.random(): every shape is seeded.
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

// =====================================================================================================
// Landmark kit: the pieces the twenty buildings below share
// =====================================================================================================
const HIDE = rgb(0xb0905e), HIDE_DARK = rgb(0x7a5a3a), OCHRE = rgb(0x9a3a24), RAW_WOOD = rgb(0x8a6a42), COPPER = rgb(0xb5683a), VERDIGRIS = rgb(0x4f9a84);
const BLOOD = [0.3, 0.02, 0.015], SNOW = [0.86, 0.9, 0.96], BLIGHT = [0.3, 1.0, 0.12];
const FIRE_RED = [[1.0, 0.4, 0.06], [1.0, 0.16, 0.02], [0.8, 0.05, 0.02]];
const v3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a flat facet whose face looks away from the point `from` */
function facet(g, pts, cols, from) {
  const a = pts[0], b = pts[1], c = pts[2];
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (nx * (a[0] - from[0]) + ny * (a[1] - from[1]) + nz * (a[2] - from[2]) < 0) { pts = pts.slice().reverse(); if (Array.isArray(cols[0])) cols = cols.slice().reverse(); }
  g.flat(pts, cols);
}
/**
 * A column of n flat sides standing on the local origin, h high. o: r1 (top radius), a0 (turn), vs (stations),
 * tip (height of a point on top, 0 = a flat cap), slant (tilt of the cap), col(x, y, z, side, edge) -> rgb.
 */
function facetCol(g, n, r, h, o = {}) {
  const vs = o.vs || Math.max(1, Math.round(h / 0.4)), a0 = o.a0 || 0, tip = o.tip || 0, r1 = o.r1 ?? r, sl = o.slant || 0, sa = o.slantA || 0;
  const col = o.col || (() => [0.3, 0.3, 0.3]);
  const P = (i, j) => { const a = a0 + (i / n) * TAU, t = j / vs, rr = lerp(r, r1, t); return [Math.cos(a) * rr, t * h + (j === vs ? sl * Math.cos(a - sa) * r1 : 0), Math.sin(a) * rr]; };
  for (let i = 0; i < n; i++) {
    const am = a0 + ((i + 0.5) / n) * TAU, N = [Math.cos(am), (r - r1) / h, Math.sin(am)];
    let pa = null;
    for (let j = 0; j <= vs; j++) {
      const A = P(i, j), B = P(i + 1, j), Mi = v3(A, B, 0.5);
      const cur = [g.v(A[0], A[1], A[2], N[0], N[1], N[2], col(A[0], A[1], A[2], i, 1)), g.v(Mi[0], Mi[1], Mi[2], N[0], N[1], N[2], col(Mi[0], Mi[1], Mi[2], i, 0)), g.v(B[0], B[1], B[2], N[0], N[1], N[2], col(B[0], B[1], B[2], i, 1))];
      if (pa) { g.quad(pa[0], pa[1], cur[1], cur[0]); g.quad(pa[1], pa[2], cur[2], cur[1]); }
      pa = cur;
    }
    const A = P(i, vs), B = P(i + 1, vs), top = [o.tipX || 0, h + tip, o.tipZ || 0];
    if (tip > 0) facet(g, [A, B, top], [col(A[0], A[1], A[2], i, 1), col(B[0], B[1], B[2], i, 1), mul(col(top[0], top[1], top[2], i, 1), 1.15)], [0, h * 0.5, 0]);
    else if (r1 > 0) facet(g, [A, B, [0, h, 0]], mul(col(0, h, 0, i, 0), 1.1), [0, 0, 0]);
  }
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
/** pale ground mist: flattened puffs lying round the inside edge of a footprint w x h */
function mist(g, w, h, seed = 0, n = 10, col = [0.6, 0.65, 0.7]) {
  const rnd = rng(seed * 61 + 3);
  g.surf(K_PLAIN, 1, 0, 0.1);
  for (let i = 0; i < n; i++) {
    const a = ((i + rnd() * 0.7) / n) * TAU, k = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))), rx = 0.22 + 0.2 * rnd(), d = 0.82 + 0.1 * rnd();
    const x = clamp(Math.cos(a) * k * (w / 2) * d, -w / 2 + rx, w / 2 - rx), z = clamp(Math.sin(a) * k * (h / 2) * d, -h / 2 + rx * 0.8, h / 2 - rx * 0.8);
    g.in(M(x, 0.05 + 0.08 * rnd(), z, 0, rnd() * 180, 0), () => g.add(new THREE.IcosahedronGeometry(1, 1).scale(rx, 0.06 + 0.07 * rnd(), rx * 0.75), (px, py, pz) => mul(col, 0.85 + 0.25 * noise3(px * 5 + seed, py * 9, pz * 5))));
  }
}
/** a deck of planks running along X: x0..x1 by z0..z1, top face at height y. o: pw (plank width), rag (how uneven the ends are), skip(z) */
function deck(g, x0, x1, z0, z1, y, pal, seed, o = {}) {
  const rnd = rng(seed * 91 + 3), pw = o.pw || 0.17, rg = o.rag ?? 0.1;
  let z = z0, i = 0;
  g.surf(K_WOOD, 0.9);
  while (z < z1 - 0.03) {
    const w = Math.min(z1 - z, pw * (0.75 + 0.5 * rnd())), e0 = (rnd() - 0.5) * rg, e1 = (rnd() - 0.5) * rg, c = mul(pal[Math.floor(rnd() * pal.length) % pal.length], 0.8 + 0.4 * rnd());
    if (!(o.skip && o.skip(z + w / 2))) g.in(M((x0 + e0 + x1 + e1) / 2, y - 0.02 + (rnd() - 0.5) * 0.012, z + w / 2, 0, (rnd() - 0.5) * (o.skew ?? 1.5), 0), () => g.beam(x1 + e1 - x0 - e0, 0.04, w - 0.012, 0.007, woodTint(c, seed + i), 2));
    z += w; i++;
  }
}
/** a ladder from point a (foot) to point b (head) */
function ladder(g, a, b, wide, seed, wood = RAW_WOOD) {
  const f = along(a, b);
  g.surf(K_WOOD, 0.9);
  g.in(f.m, () => {
    for (const e of [-1, 1]) g.in(M(0, 0, e * wide / 2, e * 3, 0, 0), () => g.beam(f.L, 0.04, 0.035, 0.008, woodTint(mul(wood, 0.85), seed + e), 3));
    const n = Math.max(2, Math.round(f.L / 0.22));
    for (let i = 0; i < n; i++) g.in(M(-f.L / 2 + ((i + 0.5) * f.L) / n, 0, 0, 0, 90, (hash1(i, seed) - 0.5) * 10), () => g.beam(wide + 0.07, 0.03, 0.03, 0.006, woodTint(wood, seed + i * 3), 1));
  });
}
/** a crooked plank shack on the local origin, w x d x h to its eaves, its door toward +Z: lean-to roof, a lit window */
function shack(g, w, d, h, pal, seed, o = {}) {
  const rnd = rng(seed * 37 + 11), lit = o.lit || BLIGHT, door = o.door ?? true;
  for (let s = 0; s < 4; s++) {
    const W = s % 2 ? d : w, D = s % 2 ? w : d, hh = h + (s === 2 ? 0.22 : s === 0 ? 0 : 0.11);
    g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-W / 2, 0, D / 2)), () => {
      plankWall(g, W, hh, pal, seed + s * 5, { tilt: 6, pw: o.pw || 0.15, skip: s === 0 && door ? (x) => Math.abs(x - W * 0.35) < 0.13 : null });
      g.surf(K_WOOD, 0.9);
      g.in(M(W / 2, hh * 0.78, 0.03, 0, 0, (rnd() - 0.5) * 5), () => g.beam(W + 0.08, 0.05, 0.035, 0.008, woodTint(pal[s % pal.length], seed + s), 2));
      if (s === 0 && door) { g.surf(K_PLAIN, 1); g.flat([[W * 0.35 - 0.14, 0, -0.03], [W * 0.35 + 0.14, 0, -0.03], [W * 0.35 + 0.14, h * 0.8, -0.03], [W * 0.35 - 0.14, h * 0.8, -0.03]], [0.015, 0.012, 0.01]); }
      if ((s === 0 || s === 1 || s === 3) && W > 0.5) {
        const wx = s === 0 ? W * 0.75 : W * 0.5, wy = h * 0.55, ws = Math.min(0.11, W * 0.14);
        g.surf(K_PLAIN, 0.5, 0, 1.25);
        g.flat([[wx - ws, wy - ws, 0.022], [wx + ws, wy - ws, 0.022], [wx + ws, wy + ws, 0.022], [wx - ws, wy + ws, 0.022]], mul(lit, 0.9));
        g.surf(K_WOOD, 0.9);
        for (const [dx, dy, L, rz] of [[0, ws, 2 * ws + 0.06, 0], [0, -ws, 2 * ws + 0.06, 0], [-ws, 0, 2 * ws + 0.03, 90], [ws, 0, 2 * ws + 0.03, 90], [0, 0, 2 * ws, 90]]) g.in(M(wx + dx, wy + dy, 0.03, 0, 0, rz + (rnd() - 0.5) * 6), () => g.beam(L, 0.03, 0.025, 0.006, woodTint(pal[0], seed + dx * 9), 1));
      }
    });
  }
  // the lean-to roof: planks falling toward the door, overhanging all round
  const n = Math.max(3, Math.round((w + 0.2) / 0.16));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 - 0.1 + ((w + 0.2) * (i + 0.5)) / n, c = mul(pal[Math.floor(rnd() * pal.length) % pal.length], 0.7 + 0.35 * rnd());
    g.surf(K_WOOD, 0.92);
    g.in(M(x, h + 0.14 + (i % 2) * 0.016, 0, 0, 90 + (rnd() - 0.5) * 4, 0).multiply(M(0, 0, 0, 0, 0, Math.atan2(0.22, d) / DEG)), () => g.beam(d + 0.3 + 0.08 * rnd(), 0.03, (w + 0.2) / n + 0.012, 0.006, woodTint(c, seed + i * 7), 2));
  }
  if (o.pipe) { g.surf(K_PLAIN, 0.75, 0.6); g.tube([[w * 0.25, h, -d * 0.2], [w * 0.27, h + 0.35, -d * 0.22], [w * 0.33, h + 0.6, -d * 0.2]], 0.045, nq(8), rustCol(seed), true); }
}
/** a hangman's noose dropping from the local origin: l of rope, then the knot and the loop */
function noose(g, l, seed = 0) {
  const col = rgb(0xa89264);
  rope(g, [[0, 0.02, 0], [0.005, -l * 0.5, 0.004 * seed], [0, -l, 0]], 0.014, col);
  g.surf(K_CLOTH, 0.95);
  g.in(M(0, -l - 0.07, 0), () => g.cyl(0.026, 0.026, 0.14, 7, (x, y) => mul(col, Math.floor(y * 60) % 2 ? 1 : 0.62), true, true));
  g.in(M(0, -l - 0.2, 0, 0, 20 + seed * 30, 0), () => g.add(new THREE.TorusGeometry(0.1, 0.014, 5, nq(14)).scale(0.8, 1.25, 1), (x, y, z) => mul(col, 0.7 + 0.4 * noise3(x * 60, y * 60, z * 60))));
}
/** a net of knotted cord slung between four corner points (a, b along the top; d, c below them), sagging by `sag` */
function net(g, a, b, c, d, nu, nv, sag = 0.1, col = rgb(0x6a6248)) {
  const P = (u, v) => { const p = v3(v3(a, b, u), v3(d, c, u), v), s = Math.sin(u * Math.PI) * Math.sin(v * Math.PI * 0.9); return [p[0], p[1] - sag * s, p[2] + sag * 0.5 * s]; };
  g.surf(K_CLOTH, 0.95);
  for (let i = 0; i <= nu; i++) { const pts = []; for (let j = 0; j <= nv; j++) pts.push(P(i / nu, j / nv)); g.tube(pts, 0.006, 3, mul(col, 0.8 + 0.3 * hash1(i, 3)), false); }
  for (let j = 0; j <= nv; j++) { const pts = []; for (let i = 0; i <= nu; i++) pts.push(P(i / nu, j / nv)); g.tube(pts, 0.006, 3, mul(col, 0.8 + 0.3 * hash1(j, 5)), false); }
}
/** a low dome of a skull for paving: crown up, face toward +Z; sculpted once, a couple of hundred triangles */
function paveSkull(g, s = 1) {
  const geo = geoOnce('paveSkull', () => {
    const c = 0xcfc6a8, d = 0x15110e, P = [];
    P.push(S.ellipsoid(0.085, 0.075, 0.1).at(0, 0.02, -0.01).color(c).tint(0.16, 26));
    P.push(S.box(0.1, 0.07, 0.06, 0.028).at(0, -0.005, 0.07).color(0xbdb292).blend(0.03));
    P.push(...S.mirrorX([S.ellipsoid(0.03, 0.028, 0.03).at(0.038, 0.03, 0.092).color(d).cut(0.008)]));
    P.push(S.cone(0.016, 0.004, 0.04, 0.004).rot(20, 0, 0).at(0, -0.005, 0.105).color(d).cut(0.005));
    P.push(S.box(0.4, 0.1, 0.4, 0).at(0, -0.075, 0).color(d).cut(0.002));
    return buildPartGeometry({ prims: P }, { res: 44 * qual(), ao: 0.8 });
  });
  const k = g.kind; g.surf(K_PLAIN, 0.75);
  g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(geo));
  g.kind = k;
}
/** a band of little painted signs on the local XY plane facing +Z: L long, h high, centred; pal = the paints */
function glyphBand(g, L, h, seed, pal, back = null) {
  const rnd = rng(seed * 211 + 5), n = Math.max(2, Math.round(L / (h * 0.62))), cw = L / n;
  if (back) { g.surf(K_PLAIN, 0.85); g.flat([[-L / 2, -h / 2, 0.004], [L / 2, -h / 2, 0.004], [L / 2, h / 2, 0.004], [-L / 2, h / 2, 0.004]], back); }
  g.surf(K_PLAIN, 0.6, 0.2);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * cw, c = mul(pal[Math.floor(rnd() * pal.length) % pal.length], 0.85 + 0.3 * rnd()), k = Math.floor(rnd() * 6), a = cw * 0.34, b = h * 0.36, z = 0.008;
    const q = (pts) => g.flat(pts.map(([px, py]) => [x + px, py, z]), c);
    if (k === 0) { q([[-a, -b], [a, -b], [a, -b * 0.4], [-a, -b * 0.4]]); q([[-a * 0.3, -b * 0.4], [a * 0.3, -b * 0.4], [a * 0.3, b], [-a * 0.3, b]]); }
    else if (k === 1) q([[-a, -b], [a, -b], [0, b]]);
    else if (k === 2) { q([[-a, b * 0.3], [a, b * 0.3], [a, b], [-a, b]]); q([[-a, -b], [a, -b], [a, -b * 0.3], [-a, -b * 0.3]]); }
    else if (k === 3) q([[0, -b], [a, 0], [0, b], [-a, 0]]);
    else if (k === 4) { q([[-a, -b], [-a * 0.3, -b], [-a * 0.3, b], [-a, b]]); q([[a * 0.3, -b], [a, -b], [a, b * 0.2], [a * 0.3, b * 0.2]]); }
    else { q([[-a, -b * 0.2], [a, -b * 0.2], [a * 0.5, b], [-a * 0.5, b]]); q([[-a * 0.2, -b], [a * 0.2, -b], [a * 0.2, -b * 0.2], [-a * 0.2, -b * 0.2]]); }
  }
}
/** an iron stake with a skull spiked on it, standing on the local origin */
function skullStake(g, h, seed = 0, wood = null) {
  if (wood) stake(g, 0.03, h, seed, wood); else { g.surf(K_PLAIN, 0.5, 0.85); g.cyl(0.022, 0.008, h + 0.12, 5, IRON, false, true); }
  g.in(M(0, h - 0.14, 0, -10, seed * 70, 0), () => skull(g, 0.95, true));
}
/** a weathered wooden door on the local XY plane facing +Z, standing on y = 0: planks, two iron straps, a ring */
function plankDoor(g, w, h, wood, seed = 0) {
  const n = Math.max(2, Math.round(w / 0.13));
  g.surf(K_WOOD, 0.9);
  for (let i = 0; i < n; i++) g.in(M(-w / 2 + ((i + 0.5) * w) / n, h / 2, 0.012, 0, 0, 90), () => g.beam(h, w / n - 0.006, 0.03, 0.006, woodTint(mul(wood, 0.8 + 0.35 * hash1(i, seed)), seed + i), 3));
  g.surf(K_PLAIN, 0.55, 0.8);
  for (const y of [0.22, 0.78]) g.in(M(0, h * y, 0.03), () => g.cbox(w * 0.96, 0.045, 0.012, 0.004, IRON));
  g.in(M(w * 0.3, h * 0.5, 0.04), () => g.add(new THREE.TorusGeometry(0.035, 0.008, 4, 10), IRON));
}

// =====================================================================================================
// Ironbound: basalt, black iron and skulls
// =====================================================================================================
const BASALT = rgb(0x2c2d33), RUNE_RED = [0.95, 0.1, 0.03];
const basaltCol = (seed) => (x, y, z, i, edge) => mul(BASALT, (0.62 + 0.3 * hash1(Math.floor(y * 2.3 + seed * 0.7), i, seed) + 0.4 * noise3(x * 6 + seed, y * 2.4, z * 6)) * (edge ? 1.45 : 1));
/** an iron band round something of radius R at the local origin, riveted; spikes = how many thorns stand out of it */
function ironBand(g, R, hgt = 0.16, spikes = 0, spikeL = 0.3, seed = 0) {
  g.surf(K_PLAIN, 0.55, 0.85);
  g.lathe([[R - 0.01, -hgt / 2], [R + 0.035, -hgt / 2 + 0.015], [R + 0.035, hgt / 2 - 0.015], [R - 0.01, hgt / 2]], nq(20), (x, y, z) => mul([0.05, 0.048, 0.052], 0.7 + 0.7 * noise3(x * 9 + seed, y * 9, z * 9)));
  const nr = Math.max(8, Math.round(R * 22));
  for (let k = 0; k < nr; k++) g.in(M(0, 0, 0, 0, (k * 360) / nr, 0).multiply(M(0, 0, R + 0.034)), () => g.stud(0.02, [0.09, 0.085, 0.09], 5));
  for (let k = 0; k < spikes; k++) g.in(M(0, 0, 0, 0, ((k + 0.5) * 360) / spikes + seed * 20, 0).multiply(M(0, 0, R, 62 + 16 * hash1(k, seed), 0, 0)), () => thorn(g, spikeL * (0.8 + 0.4 * hash1(k, seed + 3)), 0.04, [0.06, 0.058, 0.064]));
}
function basaltMonolith(g) {
  g.moss = 0.12;
  pad(g, 2, 2, 0.1, rgb(0x2b2726), 301);
  const d = 0.3, cols = [];
  for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) { if (Math.abs(q + r) > 2) continue; cols.push({ x: d * (q + r / 2), z: d * r * 0.866, ring: Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)), i: cols.length }); }
  for (const c of cols) {
    const a = Math.atan2(c.z, c.x), h1 = hash1(c.i, 5), h2 = hash1(c.i, 9);
    const hh = c.ring === 0 ? 6.0 : c.ring === 1 ? 4.5 + 0.9 * h1 : 1.3 + 1.25 * h1, tip = c.ring === 0 ? 1.0 : c.ring === 1 ? 0.45 + 0.5 * h2 : h2 > 0.45 ? 0.2 + 0.3 * h2 : 0;
    g.surf(K_STONE, 0.5);
    g.in(M(c.x, -0.12, c.z, c.ring === 2 ? Math.sin(a) * 2.5 : 0, 0, c.ring === 2 ? -Math.cos(a) * 2.5 : 0), () => facetCol(g, 6, 0.172, hh + 0.12, { a0: Math.PI / 6, tip, tipX: (h1 - 0.5) * 0.12, tipZ: (h2 - 0.5) * 0.12, slant: 0.4 * h2, slantA: h1 * TAU, col: basaltCol(c.i + 1), vs: Math.max(2, Math.round(hh / 0.45)) }));
  }
  // bound in iron: a spiked girdle round the whole clump, two round the inner columns, a collar on the tallest
  g.in(M(0, 0.95, 0), () => ironBand(g, 0.8, 0.2, 9, 0.42, 1));
  g.in(M(0, 3.05, 0), () => ironBand(g, 0.5, 0.18, 6, 0.5, 2));
  g.in(M(0, 4.25, 0), () => ironBand(g, 0.5, 0.16, 6, 0.4, 3));
  g.in(M(0, 5.55, 0), () => ironBand(g, 0.205, 0.14, 5, 0.34, 4));
  // crown spikes of iron between the points
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.52; g.in(M(Math.cos(a) * 0.3, 4.5 + 0.5 * hash1(k, 31), Math.sin(a) * 0.3, Math.sin(a) * 14, 0, -Math.cos(a) * 14), () => thorn(g, 0.9 + 0.3 * hash1(k, 33), 0.045, [0.05, 0.05, 0.055])); }
  // runes down the inner columns, alight
  for (let k = 0; k < 6; k++) for (let j = 0; j < 3; j++) g.in(M(0, 3.42 + j * 0.27 + (k % 2) * 0.1, 0, 0, 90 - k * 60, 0).multiply(M(0, 0, 0.452)), () => sigil(g, 300 + k * 5 + j, 0.27, RUNE_RED, 1.25, 0.085));
  for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) g.in(M(0, 4.86 + j * 0.26, 0, 0, 30 + k * 120, 0).multiply(M(0, 0, 0.152)), () => sigil(g, 340 + k * 3 + j, 0.25, RUNE_RED, 1.3, 0.085));
  for (let k = 0; k < 6; k++) g.in(M(0, 0.42, 0, 0, 30 + k * 60, 0).multiply(M(0, 0, 0.672)), () => sigil(g, 360 + k, 0.3, RUNE_RED, 1.0, 0.085));
  // skulls on chains from the bands
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + 0.3, R = 0.56, l = 0.75 + 0.45 * hash1(k, 41), x = Math.cos(a) * R, z = Math.sin(a) * R;
    chain(g, [[x, 3.0, z], [x * 1.05, 3.0 - l, z * 1.05]], 0.05);
    g.in(M(x * 1.08, 2.8 - l, z * 1.08, 8, 90 - a / DEG, 0), () => skull(g, 0.85, true));
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 1.0, R = 0.86, x = Math.cos(a) * R, z = Math.sin(a) * R, a2 = a + 0.8, x2 = Math.cos(a2) * R, z2 = Math.sin(a2) * R, am = a + 0.4;
    chain(g, [[x, 0.95, z], [Math.cos(am) * (R + 0.04), 0.62, Math.sin(am) * (R + 0.04)], [x2, 0.95, z2]], 0.055);
    g.in(M(Math.cos(am) * (R + 0.06), 0.4, Math.sin(am) * (R + 0.06), 6, 90 - am / DEG, 0), () => skull(g, 0.9, true));
  }
  // at its foot: fallen lengths of column, heaped skulls, stakes
  for (const [x, z, ry, L, sd] of [[0.74, 0.72, 35, 0.55, 3], [-0.78, 0.66, -50, 0.42, 5], [-0.7, -0.76, 20, 0.6, 7]]) { g.surf(K_STONE, 0.5); g.in(M(x, 0.14, z, 90, ry, 0), () => g.in(M(0, -L / 2, 0), () => facetCol(g, 6, 0.15, L, { col: basaltCol(sd + 40), slant: 0.3, vs: 1 }))); }
  g.in(M(0.3, 0.07, 0.84, 0, 20, 0), () => skullPile(g, 0.9, 4, 3));
  g.in(M(0.82, 0.06, -0.5, 0, -70, 0), () => skullPile(g, 0.85, 3, 5));
  for (const [x, z, h, sd] of [[-0.86, 0.1, 1.3, 1], [0.88, 0.18, 1.1, 2], [-0.2, -0.9, 1.2, 3]]) g.in(M(x, 0, z, (hash1(sd, 1) - 0.5) * 12, 0, (hash1(sd, 2) - 0.5) * 12), () => skullStake(g, h, sd));
}
function skullAltar(g) {
  g.moss = 0.1;
  const st = stoneStyle(0x38322f, { seed: 320, chip: 0.3, course: 0.14, cell: 0.16 / qual(), len: [0.3, 0.55] }), dark = [0.07, 0.06, 0.055];
  pad(g, 3, 3, 0.04, rgb(0x2a2423), 321);
  stoneBox(g, 1.38, 1.38, 0, 0.28, st, 322);
  stoneBox(g, 1.04, 1.04, 0.28, 0.56, st, 330, { noFoot: true });
  g.surf(K_STONE, 0.95);
  for (const [hx, y] of [[1.38, 0.278], [1.04, 0.558]]) g.flat([[-hx, y, -hx], [-hx, y, hx], [hx, y, hx], [hx, y, -hx]], dark);
  // the paving: skulls set crown-up in the mortar, every one looking out from the middle
  const sp = 0.215 / Math.sqrt(qual()), rnd = rng(3201);
  const pave = (hx, y, skip) => { const n = Math.floor((2 * hx - 0.1) / sp); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = -hx + 0.05 + (i + 0.5) * ((2 * hx - 0.1) / n), z = -hx + 0.05 + (j + 0.5) * ((2 * hx - 0.1) / n); const r1 = rnd(), r2 = rnd(), r3 = rnd(); if (skip(x, z)) continue; g.in(M(x + (r1 - 0.5) * 0.03, y + 0.045 + r2 * 0.012, z + (r3 - 0.5) * 0.03, -28 + r2 * 14, Math.atan2(x, z) / DEG + (r1 - 0.5) * 50, (r3 - 0.5) * 16, 1.02 + 0.2 * r2), () => paveSkull(g)); } };
  pave(1.04, 0.56, (x, z) => (Math.abs(x) < 0.5 && Math.abs(z) < 0.34) || (z < -0.62 && Math.abs(x) < 0.82));
  pave(1.38, 0.28, (x, z) => Math.max(Math.abs(x), Math.abs(z)) < 1.1 || (Math.abs(x) > 0.92 && Math.abs(z) > 0.92) || (z > 1.0 && Math.abs(x) < 0.4));
  // steps up the front
  g.surf(K_STONE, 0.93);
  for (const [y, z, hgt] of [[0.14, 1.16, 0.28], [0.35, 1.02, 0.42]]) g.in(M(0, y - hgt / 2 + (y === 0.14 ? 0.07 : 0.07), z + 0.11), () => g.cbox(0.74, hgt, 0.26, 0.015, stoneTint(mul(st.pal[0], 0.85), z * 7, 4)));
  // the slab: polished black stone on two blocks, runes on its face, blood on its top
  g.surf(K_STONE, 0.9);
  for (const e of [-1, 1]) g.in(M(e * 0.36, 0.56 + 0.2, 0), () => g.cbox(0.26, 0.4, 0.48, 0.02, stoneTint(mul(st.pal[0], 0.7), e + 3, 5)));
  g.surf(K_PLAIN, 0.22, 0.15);
  g.in(M(0, 1.05, 0), () => g.beam(1.34, 0.18, 0.66, 0.035, (x, y, z) => mul([0.03, 0.03, 0.036], 0.6 + 0.9 * noise3(x * 5, y * 5, z * 5)), 8));
  for (let k = 0; k < 4; k++) g.in(M(-0.42 + k * 0.28, 1.05, 0.332), () => sigil(g, 380 + k, 0.2, RUNE_RED, 1.3, 0.09));
  g.surf(K_PLAIN, 0.12, 0.1);
  g.in(M(0.08, 1.143, 0.02), () => g.sheet(nq(18), 3, (u, v) => { const a = u * TAU, r = v * (0.26 + 0.13 * noise3(Math.cos(a) * 1.4, 5, Math.sin(a) * 1.4)); return [Math.cos(a) * r * 1.7, 0, Math.sin(a) * r]; }, (x, y, z) => mul([0.36, 0.02, 0.015], 0.7 + 0.5 * noise3(x * 12, 1, z * 12)), true));
  for (const [x, l] of [[-0.2, 0.3], [0.1, 0.42], [0.34, 0.22], [0.46, 0.34]]) g.tube([[x, 1.142, 0.3], [x, 1.14, 0.338], [x + 0.005, 1.14 - l * 0.6, 0.342], [x, 1.14 - l, 0.33]], [0.014, 0.014, 0.012, 0.004], 5, [0.33, 0.02, 0.015], false);
  // shackles at the corners
  for (const e of [-1, 1]) for (const f of [-1, 1]) { chain(g, [[e * 0.6, 1.1, f * 0.26], [e * 0.74, 0.86, f * 0.3], [e * 0.72, 0.62, f * 0.34]], 0.04); g.surf(K_PLAIN, 0.5, 0.85); g.in(M(e * 0.6, 1.14, f * 0.26, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.035, 0.012, 5, 10), IRON)); }
  // four spiked braziers on pedestals at the corners
  for (const e of [-1, 1]) for (const f of [-1, 1]) g.in(M(e * 1.15, 0.28, f * 1.15), () => {
    g.surf(K_STONE, 0.93);
    g.in(M(0, 0.38, 0), () => g.cbox(0.36, 0.78, 0.36, 0.03, stoneTint(mul(st.pal[0], 0.8), e * 3 + f, 5)));
    g.in(M(0, 0.8, 0), () => g.cbox(0.44, 0.08, 0.44, 0.02, stoneTint(mul(st.pal[0], 0.6), e + f * 3, 5)));
    for (let k = 0; k < 4; k++) g.in(M(0, 0.48, 0, 0, k * 90, 0).multiply(M(0, 0, 0.181)), () => { g.in(M(0, 0, 0, 0, 0, 180), () => skull(g, 0.9, true)); });
    g.in(M(0, 0.84, 0), () => {
      brazier(g, 0.72, FIRE_RED, [0.045, 0.043, 0.048], e * 2 + f);
      for (let k = 0; k < 6; k++) g.in(M(0, 0.72, 0, 0, k * 60 + 30, 0).multiply(M(0, 0, 0.25, 50, 0, 0)), () => thorn(g, 0.26, 0.03, [0.06, 0.058, 0.064]));
    });
  });
  // trophy racks behind the slab, and the standard between them
  for (const e of [-1, 1]) g.in(M(e * 0.58, 0.56, -0.84, 0, e * -14, 0), () => {
    const wd = [0.06, 0.05, 0.045];
    for (const s of [-1, 1]) g.in(M(s * 0.3, 0, 0, 0, 0, s * -3), () => stake(g, 0.035, 2.2, e * 3 + s, wd, [0.12, 0.1, 0.09]));
    g.surf(K_WOOD, 0.9);
    for (const y of [1.2, 1.85]) g.in(M(0, y, 0.03, 0, 0, e * 2), () => g.beam(0.8, 0.05, 0.05, 0.01, woodTint([0.09, 0.075, 0.06], y * 5), 2));
    g.in(M(0, 1.5, 0.07, 0, 0, e * 12), () => roundShield(g, 0.26, rgb(0x3a2a22), [0.5, 0.05, 0.03], e + 5));
    for (let k = 0; k < 3; k++) { const x = -0.26 + k * 0.26; rope(g, [[x, 1.85, 0.04], [x, 1.85 - 0.12 - 0.05 * k, 0.05]], 0.008, rgb(0x6a5a40), 4); g.in(M(x, 1.56 - 0.05 * k + 0.02, 0.06, 6, (k - 1) * 20, 0), () => skull(g, 0.8, true)); }
    // a crossed axe and blade under the shield
    g.surf(K_WOOD, 0.85); g.in(M(0, 0.82, 0.06, 0, 0, 62), () => g.beam(0.85, 0.03, 0.03, 0.008, woodTint(rgb(0x4a3626), 4), 1));
    g.surf(K_PLAIN, 0.4, 0.9); g.in(M(0.16, 1.14, 0.06, 0, 0, 62 - 90), () => prism(g, [[-0.03, -0.02], [0.2, -0.1], [0.24, 0.08], [0.2, 0.2], [-0.03, 0.1]], 0.02, [0.2, 0.2, 0.22]));
    g.in(M(0, 0.84, 0.065, 0, 0, -58), () => prism(g, [[-0.42, -0.012], [-0.3, -0.03], [0.34, -0.035], [0.46, 0], [0.34, 0.035], [-0.3, 0.03], [-0.42, 0.012]], 0.014, [0.22, 0.22, 0.24]));
  });
  g.in(M(0, 0.56, -0.92), () => {
    g.surf(K_PLAIN, 0.5, 0.85);
    g.cyl(0.04, 0.03, 2.75, 7, [0.05, 0.048, 0.052], false, true);
    g.in(M(0, 2.95, 0), () => { g.add(new THREE.TorusGeometry(0.22, 0.035, 6, nq(18)), [0.06, 0.058, 0.064]); for (const a of [-40, 0, 40]) g.in(M(0, 0, 0, 0, 0, a), () => g.in(M(0, 0.2, 0), () => thorn(g, a ? 0.4 : 0.6, 0.04, [0.06, 0.058, 0.064]))); for (const a of [140, 180, 220]) g.in(M(0, 0, 0, 0, 0, a), () => g.in(M(0, 0.2, 0), () => thorn(g, 0.22, 0.035, [0.06, 0.058, 0.064]))); g.in(M(0, -0.12, 0.0), () => skull(g, 1.25, false)); });
    g.surf(K_WOOD, 0.9); g.in(M(0, 2.5, 0.02), () => g.beam(0.9, 0.045, 0.045, 0.01, woodTint([0.09, 0.075, 0.06], 9), 2));
    for (const e of [-1, 1]) g.in(M(e * 0.3, 2.48, 0.03), () => rag(g, 0.26, 1.05, [0.4, 0.035, 0.03], e + 3, 0.5, [0.03, 0.03, 0.03]));
  });
}

// =====================================================================================================
// Screaming: warped crystal and rot
// =====================================================================================================
const WARP = [rgb(0xd838c8), rgb(0x7a3cf0), rgb(0x30d8e8), rgb(0x8cf03c), rgb(0xff6aa8), rgb(0x3868f0), rgb(0xd8e838)];
const warpAt = (f, pal = WARP) => { f = ((f % 1) + 1) % 1 * pal.length; const i = Math.floor(f); return mix(pal[i % pal.length], pal[(i + 1) % pal.length], f - i); };
/**
 * A twisted crystal shard standing on the local origin: m flat sides turning as they climb, colours sliding like oil.
 * o: m, twist (radians over its height), bend (sideways sweep), fat (0 = widest low, 1 = widest high), glow, ns
 */
function warpShard(g, r, h, seed, o = {}) {
  const m = o.m || 5, ns = nq(o.ns || 10), tw = o.twist ?? 1.2, glow = o.glow ?? 0.6, rnd = rng(seed * 173 + 9), ph = rnd() * TAU, fat = o.fat ?? 0.3, bend = o.bend || 0;
  const rv = []; for (let i = 0; i < m; i++) rv.push(0.78 + 0.44 * rnd());
  const keep = [g.rough, g.metal, g.glow, g.kind];
  g.kind = K_PLAIN; g.rough = 0.12; g.metal = 0.3;
  const prof = (t) => r * (0.62 + 0.38 * Math.exp(-Math.pow((t - fat) / 0.42, 2))) * (t > 0.7 ? Math.pow((1 - t) / 0.3, 0.8) : 1);
  const P = (i, j) => { const t = j / ns, a = ph + (i / m) * TAU + tw * t, rr = prof(t) * rv[i % m]; return [bend * h * t * t + Math.cos(a) * rr, t * h, Math.sin(a) * rr]; };
  const C = (i, j) => mul(warpAt(seed * 0.137 + i * 0.19 + j * 0.085 + 0.25 * hash1(i, j, seed)), 0.5 + 0.75 * hash1(j, i, seed + 5));
  for (let i = 0; i < m; i++) for (let j = 0; j < ns; j++) {
    const t = (j + 0.5) / ns, ce = [bend * h * t * t, t * h, 0];
    g.glow = glow * (0.35 + 0.9 * hash1(i, j, seed + 2));
    const c0 = C(i, j), c1 = C(i, j + 1);
    if (j === ns - 1) facet(g, [P(i, j), P(i + 1, j), P(i, j + 1)], [c0, c0, mul(c1, 1.4)], ce);
    else { // each side is folded along one diagonal, so the twist shows as hard facets
      const A = P(i, j), B = P(i + 1, j), D = P(i, j + 1), E = P(i + 1, j + 1);
      facet(g, [A, B, E], [c0, c0, c1], ce); g.glow *= 0.6; facet(g, [A, E, D], [mul(c0, 0.7), mul(c1, 0.7), mul(c1, 0.7)], ce);
    }
  }
  [g.rough, g.metal, g.glow, g.kind] = keep;
  return prof;
}
/** a brass clamp round a shard of radius R */
function brassBand(g, R, hgt = 0.14, seed = 0) {
  g.surf(K_PLAIN, 0.35, 0.9);
  g.lathe([[R - 0.02, -hgt / 2], [R + 0.03, -hgt / 2 + 0.012], [R + 0.045, 0], [R + 0.03, hgt / 2 - 0.012], [R - 0.02, hgt / 2]], nq(18), (x, y, z) => mul(BRASS, 0.7 + 0.5 * noise3(x * 8 + seed, y * 8, z * 8)));
  const nr = Math.max(6, Math.round(R * 18));
  for (let k = 0; k < nr; k++) g.in(M(0, 0, 0, 0, (k * 360) / nr, 0).multiply(M(0, 0, R + 0.044)), () => g.stud(0.022, mul(BRASS, 1.3), 5));
}
/** an eye of flame on the local XY plane facing +Z */
function flameEye(g, s, iris, seed = 0) {
  eyeball(g, s, iris, { lid: BRASS });
  g.in(M(0, 0.07 * s, 0.05 * s, 20, 0, 0), () => fire(g, 0.34 * s, [mul(iris, 1.2), iris, mul(iris, 0.6)], seed, 1.5));
}
function warpSpire(g) {
  g.moss = 0;
  const crackC = (x, y, z) => { const v = Math.abs(noise3(x * 2.3 + 7, 1, z * 2.3) - 0.5), e = smooth(0.03, 0.006, v) * smooth(1.45, 0.5, Math.hypot(x, z)); g.glow = 1.2 * e; return mix(mul(rgb(0x2a2032), 0.6 + 0.6 * fbm3(x * 3, y * 5, z * 3, 3)), warpAt(x * 0.3 + z * 0.2 + 0.4), e); };
  pad(g, 3, 3, 0.14, crackC, 401, { nu: 72, nv: 16 });
  g.glow = 0;
  // the spire: three great shards that lean through one another, and a fourth run through them like a skewer
  let pA, pC;
  g.in(M(-0.18, -0.15, 0.1, 2, 0, -6), () => { pA = warpShard(g, 0.68, 5.6, 1, { m: 5, twist: 1.5, fat: 0.22, ns: 12 }); g.in(M(0, 1.25, 0), () => brassBand(g, pA(1.25 / 5.6) * 0.98, 0.18, 1)); g.in(M(0, 2.9, 0, 0, 0, 3), () => brassBand(g, pA(2.9 / 5.6) * 0.98, 0.15, 2)); g.in(M(0, 2.05, 0, 0, -25, 0).multiply(M(0, 0, pA(2.05 / 5.6) * 0.86, -4, 0, 0)), () => flameEye(g, 2.0, [1.0, 0.25, 0.7], 1)); });
  g.in(M(0.55, -0.15, -0.4, -5, 0, 15), () => { const p = warpShard(g, 0.44, 4.5, 2, { m: 4, twist: -1.1, fat: 0.35, ns: 10 }); g.in(M(0, 1.7, 0), () => brassBand(g, p(1.7 / 4.5) * 0.98, 0.14, 3)); g.in(M(0, 2.5, 0, 0, 75, 0).multiply(M(0, 0, p(2.5 / 4.5) * 0.84)), () => flameEye(g, 1.3, [0.5, 1.0, 0.25], 2)); });
  g.in(M(0.3, 3.1, 0.02, 4, 0, 7), () => { pC = warpShard(g, 0.46, 5.6, 3, { m: 5, twist: 2.4, fat: 0.5, ns: 12, bend: -0.04 }); g.in(M(-0.04 * 5.6 * 0.2, 2.5, 0), () => brassBand(g, pC(2.5 / 5.6) * 0.98, 0.14, 4)); g.in(M(-0.05, 3.1, 0, 0, 10, 0).multiply(M(0, 0, pC(3.1 / 5.6) * 0.86)), () => flameEye(g, 1.5, [0.3, 0.9, 1.0], 3)); });
  g.in(M(-0.95, 2.1, -0.15, 0, 20, -68), () => warpShard(g, 0.2, 2.5, 4, { m: 4, twist: 0.8, fat: 0.5, ns: 7 }));
  g.in(M(0.5, 4.5, 0.35, 60, 0, -32), () => warpShard(g, 0.15, 1.7, 5, { m: 4, twist: 1.0, fat: 0.45, ns: 6 }));
  // lesser shards round the foot
  const rnd = rng(4011);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU + 0.5, d = 0.85 + 0.3 * rnd(), t = 12 + 22 * rnd(); g.in(M(Math.cos(a) * d, -0.05, Math.sin(a) * d, Math.sin(a) * t, rnd() * 90, -Math.cos(a) * t), () => warpShard(g, 0.1 + 0.1 * rnd(), 0.6 + 1.0 * rnd(), 10 + i, { m: 4, twist: 0.7, ns: 5, glow: 0.7 })); }
  // bone buttresses: great ribs springing from the ground to hold the thing up, propped with lesser bones
  for (const [a, R, y1, r1, sd] of [[0.6, 1.3, 2.5, 0.42, 1], [2.3, 1.32, 2.2, 0.5, 2], [3.7, 1.3, 2.7, 0.45, 3], [5.2, 1.28, 2.0, 0.55, 4]]) {
    const co = Math.cos(a), si = Math.sin(a), A = [co * R, -0.05, si * R], B = [co * r1, y1, si * r1];
    rib(g, A, B, [co * 0.42, 0.85, si * 0.42], 0.075, sd);
    bone(g, [co * (R - 0.06), 0.02, si * (R - 0.06) + 0.14], [co * (R * 0.78 + 0.18), y1 * 0.56, si * (R * 0.78 + 0.18)], 0.03, sd + 7);
    g.in(M(A[0], 0.02, A[2]), () => g.in(M(0, 0, 0, 0, 0, 0, 0.6), () => boulder(g, 0.2, 0.14, 0.18, sd + 60, rgb(0x3a3040), nq(16))));
  }
  // fragments that hang in the air round the top, and will not fall
  for (let i = 0; i < 12; i++) {
    const t = i / 11, a = i * 2.4 + 0.7, R = 0.75 + 0.5 * hash1(i, 61), y = 4.3 + 4.0 * t, s = 0.07 + 0.09 * hash1(i, 63);
    g.surf(K_PLAIN, 0.12, 0.3, 0.8 + 0.5 * hash1(i, 65));
    g.in(M(Math.cos(a) * R, y, Math.sin(a) * R, hash1(i, 67) * 180, i * 40, hash1(i, 69) * 180), () => g.add(new THREE.OctahedronGeometry(s, 0).scale(1, 2.2 + hash1(i, 71), 0.8), (x, yy) => mul(warpAt(i * 0.21 + yy * 1.5), 0.7 + 0.5 * hash1(Math.round(x * 90), i))));
  }
  // a brass ring that turns round the top, studded with eyes
  g.in(M(0.52, 6.6, 0.3, 14, 0, 8), () => { g.surf(K_PLAIN, 0.35, 0.9); g.in(M(0, 0, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.72, 0.035, 6, nq(30)), (x, y, z) => mul(BRASS, 0.75 + 0.5 * noise3(x * 6, y * 6, z * 6)))); for (let k = 0; k < 3; k++) g.in(M(0, 0, 0, 0, k * 120 + 20, 0).multiply(M(0, 0, 0.74)), () => eyeball(g, 0.9, warpAt(k * 0.3 + 0.1), { lid: BRASS })); });
}
/** a bloated puffball on the local origin; burst > 0 leaves it split open and smoking spores */
function puffball(g, r, seed = 0, burst = 0, col = rgb(0xc9c08a)) {
  const keep = g.glow;
  g.surf(K_PLAIN, 0.8);
  g.sheet(nq(22), nq(14), (u, v) => { const a = u * TAU, b = lerp(-0.35 * Math.PI, Math.PI / 2, v), k = 1 + 0.13 * noise3(Math.cos(a) * 1.8 + seed, Math.sin(b) * 1.8, Math.sin(a) * 1.8) + 0.05 * Math.sin(a * 7 + seed) * Math.cos(b); const top = burst && v > 0.86 ? 1 - (v - 0.86) * 1.8 : 1; return [Math.cos(a) * Math.cos(b) * r * k * 1.12, (Math.sin(b) * r * k + r * 0.55) * top * 0.9, Math.sin(a) * Math.cos(b) * r * k * 1.12]; },
    (x, y, z, nx, ny, nz, u, v) => { const pore = cells3(x * 5 / r * 0.35 + seed, y * 5 / r * 0.35, z * 5 / r * 0.35) < 0.2; if (burst && v > 0.84) { g.glow = 1.2 * smooth(0.84, 0.95, v); return mix([0.1, 0.12, 0.03], [0.5, 1.0, 0.15], smooth(0.84, 0.97, v)); } g.glow = 0; return pore ? mul(col, 0.42) : mul(mix(col, [0.45, 0.5, 0.2], smooth(0.5, 0.0, v) * 0.7), 0.75 + 0.35 * noise3(x * 9, y * 9, z * 9)); }, true);
  g.glow = keep;
  if (burst) { g.surf(K_PLAIN, 1, 0, 1.6); for (let i = 0; i < 7; i++) g.in(M(Math.sin(seed + i * 2.1) * r * (0.2 + 0.12 * i), r * 1.5 + i * r * 0.36, Math.cos(seed + i * 1.3) * r * (0.2 + 0.12 * i)), () => g.add(new THREE.OctahedronGeometry(0.018 + 0.012 * hash1(i, seed), 0), [0.6, 1.0, 0.2])); }
}
function fungalGarden(g) {
  g.moss = 1.4;
  pad(g, 3, 3, 0.07, (x, y, z) => mix(mul(rgb(0x2e3220), 0.6 + 0.7 * fbm3(x * 3, y * 5, z * 3, 3)), [0.3, 0.12, 0.3], 0.4 * smooth(0.55, 0.75, noise3(x * 1.9 + 3, 2, z * 1.9))), 411, { nu: 64, nv: 12 });
  const SLIME = [[0.7, 1.0, 0.25], [0.3, 0.85, 0.1], [0.06, 0.3, 0.05]], PURPLE = rgb(0x8a3a9a), BILE = rgb(0xb8a832), FLESH = rgb(0xc86a7a), TEAL = rgb(0x2f8a82), LIVID = rgb(0x6a4ab0);
  // slime pools
  for (const [x, z, R, sd] of [[0.35, 0.55, 0.56, 1], [-0.95, 0.75, 0.34, 2], [0.95, -0.1, 0.3, 3]]) {
    g.in(M(x, 0.085, z, 0, sd * 50, 0), () => pool(g, R, SLIME, sd, 1.25, [0.03, 0.08, 0.02]));
    g.surf(K_PLAIN, 0.85);
    g.in(M(x, 0.07, z, 90, 0, 0), () => g.add(new THREE.TorusGeometry(R, 0.05, 5, nq(22)), (px, py, pz) => mul([0.16, 0.18, 0.08], 0.6 + 0.8 * noise3(px * 6, py * 6, pz * 6))));
    g.surf(K_PLAIN, 0.2, 0, 1.0);
    for (let i = 0; i < 3; i++) g.in(M(x + Math.cos(i * 2.3 + sd) * R * 0.45, 0.085, z + Math.sin(i * 2.3 + sd) * R * 0.45), () => g.add(new THREE.SphereGeometry(0.035 + 0.025 * hash1(i, sd), 8, 5, 0, TAU, 0, Math.PI / 2), [0.55, 1.0, 0.2]));
  }
  // the giants
  for (const [x, z, h, R, cap, sd, glow, rx, rz] of [[-0.6, -0.5, 2.05, 0.82, PURPLE, 1, 0.8, 3, 4], [0.72, -0.78, 1.45, 0.6, FLESH, 2, 0.6, -5, -6], [0.0, -1.05, 2.75, 0.5, LIVID, 3, 0.9, 4, -2], [-1.02, 0.2, 1.1, 0.4, BILE, 4, 0.5, 0, 9], [1.02, 0.72, 0.9, 0.36, TEAL, 5, 0.9, 6, -8]])
    g.in(M(x, 0, z, rx, sd * 70, rz), () => mushroom(g, h, R, cap, sd * 3, glow));
  // lesser toadstools in clumps
  for (const [x, z, s, cap, sd] of [[-0.3, 1.15, 1.3, FLESH, 1], [1.2, -1.15, 1.2, BILE, 2], [-1.2, -1.15, 1.5, TEAL, 3], [0.25, -0.2, 1.1, PURPLE, 4], [-0.62, 0.42, 0.9, BILE, 5], [1.25, 0.2, 0.9, LIVID, 6]]) g.in(M(x, 0.03, z, 0, sd * 60, 0), () => fungi(g, s, cap, sd, 0.7));
  // puffballs, two of them burst
  for (const [x, z, r, sd, b] of [[0.2, 1.1, 0.3, 1, 0], [-1.12, -0.55, 0.36, 2, 1], [1.08, -0.52, 0.24, 3, 0], [-0.1, 0.25, 0.2, 4, 1], [0.78, 1.18, 0.17, 5, 0], [-0.75, 1.2, 0.14, 6, 0]]) g.in(M(x, 0.02, z, 0, sd * 80, 0), () => puffball(g, r, sd, b, sd % 2 ? rgb(0xc9c08a) : rgb(0xb89aa0)));
  // rotting stumps hung with bracket fungus, a fallen log
  const rot = { bark: rgb(0x34382a), heart: rgb(0x5a5234), amp: 0.2 };
  for (const [x, z, r, h, sd] of [[-0.25, 0.72, 0.24, 0.5, 1], [1.12, -0.86, 0.17, 0.36, 2]]) g.in(M(x, -0.04, z, 4, sd * 40, -3), () => {
    log(g, r * 1.2, r, h, sd + 20, { ...rot, seg: nq(14) });
    for (let k = 0; k < 4; k++) { g.surf(K_PLAIN, 0.8, 0, k % 2 ? 0.25 : 0); g.in(M(0, h * (0.3 + 0.17 * k), 0, 0, k * 100 + sd * 30, 0).multiply(M(r * 0.9, 0, 0, 0, 90, 0)), () => g.lathe([[0, -0.02], [0.12, -0.015], [0.15, 0.01], [0.1, 0.035], [0, 0.05]], nq(10), (px, py, pz) => mul(k % 2 ? [0.75, 0.6, 0.2] : FLESH, 0.6 + 0.5 * tri1(Math.hypot(px, pz) * 22)), Math.PI, TAU)); }
    for (let k = 0; k < 5; k++) { const a = k * 1.3; g.in(M(Math.cos(a) * r * 0.8, h - 0.02, Math.sin(a) * r * 0.8, Math.sin(a) * 12, 0, -Math.cos(a) * 12), () => stake(g, 0.035, 0.14 + 0.16 * hash1(k, sd), sd + k, rot.bark, rot.heart)); }
  });
  g.in(M(0.55, 0.1, 1.28, 0, 8, 0), () => g.in(M(-0.5, 0, 0, 0, 0, -90), () => log(g, 0.13, 0.11, 1.0, 27, { ...rot, seg: nq(12), capB: true })));
  for (let k = 0; k < 4; k++) g.in(M(0.2 + k * 0.22, 0.2, 1.26 + (k % 2) * 0.04, (k % 2 ? 10 : -10), 0, 0), () => mushroom(g, 0.1 + 0.05 * (k % 3), 0.06 + 0.02 * (k % 2), k % 2 ? BILE : TEAL, k + 30, 0.8));
  // tendrils feeling upward
  for (const [x, z, h, sd] of [[-1.25, 1.0, 1.1, 1], [1.28, 1.15, 0.8, 2], [0.5, -1.3, 0.9, 3]]) { g.surf(K_PLAIN, 0.35); limb(g, [[x, -0.05, z], [x + 0.1 * Math.sin(sd), h * 0.4, z + 0.08], [x - 0.12 * Math.cos(sd), h * 0.75, z - 0.05], [x + 0.06, h, z + 0.1 * Math.sin(sd * 2)], [x + 0.16, h * 0.9, z + 0.14]], [0.07, 0.055, 0.04, 0.025, 0.006], { nu: nq(8), nv: nq(18), col: (px, py, pz) => mul(mix([0.22, 0.3, 0.1], [0.5, 0.2, 0.45], smooth(0.2, 1, py / h)), 0.7 + 0.5 * noise3(px * 14, py * 14, pz * 14)) }); }
  // spore motes adrift
  g.surf(K_PLAIN, 1, 0, 1.7);
  const rnd = rng(4177);
  for (let i = 0; i < nq(46); i++) { const x = (rnd() - 0.5) * 2.7, z = (rnd() - 0.5) * 2.7, y = 0.4 + 2.6 * rnd() * rnd(); g.in(M(x, y, z, rnd() * 90, rnd() * 90, 0), () => g.add(new THREE.OctahedronGeometry(0.014 + 0.016 * rnd(), 0), i % 4 ? [0.65, 1.0, 0.22] : [1.0, 0.5, 0.9])); }
}

// =====================================================================================================
// exports
// =====================================================================================================
// id: [footprint along X, along Z, builder]. A piece that arrives with its footprint the other way round is the
// same geometry turned a quarter (as civic.js turns its long pieces).
const BUILDERS = {
  ironbound_basaltMonolith: [2, 2, basaltMonolith], ironbound_skullAltar: [3, 3, skullAltar],
  screaming_warpSpire: [3, 3, warpSpire], screaming_fungalGarden: [3, 3, fungalGarden],
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
/** every landmark of the ruinous realms */
export const structures = Object.fromEntries(Object.keys(BUILDERS).map((id) => [id, (def, w, h, place) => landmark(id, w, h)]));
