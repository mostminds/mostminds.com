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
/** pale ground mist: thin wisps lying along the inside edge of a footprint w x h, in two layers */
function mist(g, w, h, seed = 0, n = 10, col = [0.5, 0.55, 0.6]) {
  const rnd = rng(seed * 61 + 3);
  g.surf(K_PLAIN, 1, 0, 0.06);
  for (let i = 0; i < n; i++) {
    const side = i % 4, L = side % 2 ? h : w, len = Math.min(L * 0.48, 0.35 + 0.5 * rnd()), wid = 0.1 + 0.1 * rnd(), t = (rnd() - 0.5) * (L - 2 * len), d = (side % 2 ? w : h) / 2 - wid - 0.02 - 0.12 * rnd(), y = i % 3 === 0 ? 0.2 + 0.12 * rnd() : 0.06 + 0.05 * rnd();
    const x = side === 0 ? t : side === 2 ? -t : side === 1 ? d : -d, z = side === 0 ? d : side === 2 ? -d : side === 1 ? t : -t;
    g.in(M(x, y, z, 0, side % 2 ? 90 : 0, 0), () => g.add(new THREE.IcosahedronGeometry(1, 1).scale(len, 0.025 + 0.03 * rnd(), wid), (px, py, pz) => mul(col, 0.8 + 0.35 * noise3(px * 4 + seed, py * 9, pz * 4))));
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
    const c = 0xb3a888, d = 0x0c0907, P = [];
    P.push(S.ellipsoid(0.085, 0.075, 0.1).at(0, 0.02, -0.01).color(c).tint(0.16, 26));
    P.push(S.box(0.1, 0.07, 0.06, 0.028).at(0, -0.005, 0.07).color(0x9c9072).blend(0.03));
    P.push(...S.mirrorX([S.ellipsoid(0.036, 0.034, 0.04).at(0.04, 0.032, 0.09).color(d).cut(0.006)]));
    P.push(S.cone(0.016, 0.004, 0.04, 0.004).rot(20, 0, 0).at(0, -0.005, 0.105).color(d).cut(0.005));
    P.push(S.box(0.4, 0.1, 0.4, 0).at(0, -0.075, 0).color(d).cut(0.002));
    return buildPartGeometry({ prims: P }, { res: 30 * qual(), ao: 0.85 });
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
/** the kit's fire bowl with the heat of its flame set by hand (bright fire washes to cream under the tone mapping) */
function fireBowl(g, s, cols, metal = IRON, seed = 0, glow = 0.9) {
  g.surf(K_PLAIN, 0.5, 0.85);
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.4; g.tube([[Math.cos(a) * 0.3 * s, 0, Math.sin(a) * 0.3 * s], [Math.cos(a) * 0.1 * s, 0.45 * s, Math.sin(a) * 0.1 * s], [Math.cos(a) * 0.22 * s, 0.82 * s, Math.sin(a) * 0.22 * s]], 0.03 * s, 5, metal); }
  g.lathe([[0.04, 0.62], [0.2, 0.68], [0.3, 0.82], [0.33, 1], [0.36, 1.02], [0.36, 1.06], [0.3, 1.06], [0.27, 0.9], [0, 0.84]].map(([r, y]) => [r * s, y * s]), nq(14), metal);
  g.surf(K_PLAIN, 1, 0, glow * 0.8);
  g.in(M(0, 0.93 * s, 0), () => g.add(new THREE.SphereGeometry(0.27 * s, nq(10), 5, 0, TAU, 0, 1.4).scale(1, 0.45, 1), (x, y, z) => mix(mul(cols[2], 0.35), cols[0], smooth(0.4, 0.7, noise3(x * 30 + seed, y * 30, z * 30)))));
  g.in(M(0, 0.98 * s, 0), () => fire(g, 0.75 * s, cols, seed, glow));
}

// =====================================================================================================
// Ironbound: basalt, black iron and skulls
// =====================================================================================================
const FIRE_DEEP = [[1.0, 0.2, 0.02], [0.85, 0.06, 0.015], [0.5, 0.015, 0.01]];
const BASALT = rgb(0x2c2d33), RUNE_RED = [0.8, 0.04, 0.02];
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
  g.in(M(0, 0.95, 0), () => ironBand(g, 0.8, 0.2, 9, 0.3, 1));
  g.in(M(0, 3.05, 0), () => ironBand(g, 0.5, 0.18, 6, 0.5, 2));
  g.in(M(0, 4.25, 0), () => ironBand(g, 0.5, 0.16, 6, 0.4, 3));
  g.in(M(0, 5.55, 0), () => ironBand(g, 0.205, 0.14, 5, 0.34, 4));
  // crown spikes of iron between the points
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.52; g.in(M(Math.cos(a) * 0.3, 4.5 + 0.5 * hash1(k, 31), Math.sin(a) * 0.3, Math.sin(a) * 14, 0, -Math.cos(a) * 14), () => thorn(g, 0.9 + 0.3 * hash1(k, 33), 0.045, [0.05, 0.05, 0.055])); }
  // runes down the inner columns, alight
  for (let k = 0; k < 6; k++) for (let j = 0; j < 3; j++) g.in(M(0, 3.42 + j * 0.27 + (k % 2) * 0.1, 0, 0, 90 - k * 60, 0).multiply(M(0, 0, 0.452)), () => sigil(g, 300 + k * 5 + j, 0.27, RUNE_RED, 0.7, 0.07));
  for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) g.in(M(0, 4.86 + j * 0.26, 0, 0, 30 + k * 120, 0).multiply(M(0, 0, 0.152)), () => sigil(g, 340 + k * 3 + j, 0.25, RUNE_RED, 0.75, 0.07));
  for (let k = 0; k < 6; k++) g.in(M(0, 0.42, 0, 0, 30 + k * 60, 0).multiply(M(0, 0, 0.672)), () => sigil(g, 360 + k, 0.3, RUNE_RED, 0.6, 0.07));
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
  const st = stoneStyle(0x38322f, { seed: 320, chip: 0.3, course: 0.14, cell: 0.16 / qual(), len: [0.3, 0.55] }), dark = [0.035, 0.03, 0.028];
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
  for (let k = 0; k < 4; k++) g.in(M(-0.42 + k * 0.28, 1.05, 0.332), () => sigil(g, 380 + k, 0.2, RUNE_RED, 0.8, 0.08));
  g.surf(K_PLAIN, 0.12, 0.1);
  g.in(M(0.08, 1.143, 0.02), () => g.sheet(nq(18), 3, (u, v) => { const a = u * TAU, r = v * (0.17 + 0.1 * noise3(Math.cos(a) * 1.4, 5, Math.sin(a) * 1.4)); return [Math.cos(a) * r * 1.7, 0, Math.sin(a) * r]; }, (x, y, z) => mul([0.2, 0.012, 0.01], 0.6 + 0.6 * noise3(x * 12, 1, z * 12)), true));
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
      fireBowl(g, 0.72, FIRE_DEEP, [0.045, 0.043, 0.048], e * 2 + f, 0.85);
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
  const m = o.m || 5, ns = nq(o.ns || 10), tw = o.twist ?? 1.2, glow = o.glow ?? 0.32, rnd = rng(seed * 173 + 9), ph = rnd() * TAU, fat = o.fat ?? 0.3, bend = o.bend || 0;
  const rv = []; for (let i = 0; i < m; i++) rv.push(0.78 + 0.44 * rnd());
  const keep = [g.rough, g.metal, g.glow, g.kind];
  g.kind = K_PLAIN; g.rough = 0.12; g.metal = 0.3;
  const prof = (t) => r * (0.62 + 0.38 * Math.exp(-Math.pow((t - fat) / 0.42, 2))) * (t > 0.7 ? Math.pow((1 - t) / 0.3, 0.8) : 1);
  const P = (i, j) => { const t = j / ns, a = ph + (i / m) * TAU + tw * t, rr = prof(t) * rv[i % m]; return [bend * h * t * t + Math.cos(a) * rr, t * h, Math.sin(a) * rr]; };
  const C = (i, j) => mul(warpAt(seed * 0.137 + i * 0.19 + j * 0.085 + 0.25 * hash1(i, j, seed)), 0.3 + 0.6 * hash1(j, i, seed + 5));
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
  g.in(M(-0.18, -0.15, 0.1, 2, 0, -6), () => { pA = warpShard(g, 0.68, 5.6, 1, { m: 6, twist: 1.5, fat: 0.22, ns: 22 }); g.in(M(0, 1.25, 0), () => brassBand(g, pA(1.25 / 5.6) * 0.98, 0.18, 1)); g.in(M(0, 2.9, 0, 0, 0, 3), () => brassBand(g, pA(2.9 / 5.6) * 0.98, 0.15, 2)); g.in(M(0, 2.05, 0, 0, -25, 0).multiply(M(0, 0, pA(2.05 / 5.6) * 0.86, -4, 0, 0)), () => flameEye(g, 2.0, [1.0, 0.25, 0.7], 1)); });
  g.in(M(0.55, -0.15, -0.4, -5, 0, 15), () => { const p = warpShard(g, 0.44, 4.5, 2, { m: 5, twist: -1.1, fat: 0.35, ns: 16 }); g.in(M(0, 1.7, 0), () => brassBand(g, p(1.7 / 4.5) * 0.98, 0.14, 3)); g.in(M(0, 2.5, 0, 0, 75, 0).multiply(M(0, 0, p(2.5 / 4.5) * 0.84)), () => flameEye(g, 1.3, [0.5, 1.0, 0.25], 2)); });
  g.in(M(0.3, 3.1, 0.02, 4, 0, 7), () => { pC = warpShard(g, 0.46, 5.6, 3, { m: 5, twist: 2.4, fat: 0.5, ns: 22, bend: -0.04 }); g.in(M(-0.04 * 5.6 * 0.2, 2.5, 0), () => brassBand(g, pC(2.5 / 5.6) * 0.98, 0.14, 4)); g.in(M(-0.05, 3.1, 0, 0, 10, 0).multiply(M(0, 0, pC(3.1 / 5.6) * 0.86)), () => flameEye(g, 1.5, [0.3, 0.9, 1.0], 3)); });
  g.in(M(-0.95, 2.1, -0.15, 0, 20, -68), () => warpShard(g, 0.2, 2.5, 4, { m: 4, twist: 0.8, fat: 0.5, ns: 7 }));
  g.in(M(0.5, 4.5, 0.35, 60, 0, -32), () => warpShard(g, 0.15, 1.7, 5, { m: 4, twist: 1.0, fat: 0.45, ns: 6 }));
  g.in(M(-0.5, -0.1, -0.55, -14, 0, 10), () => warpShard(g, 0.3, 3.0, 6, { m: 4, twist: 1.3, fat: 0.3, ns: 8 }));
  g.in(M(0.1, 5.2, -0.1, -30, 40, 50), () => warpShard(g, 0.14, 1.5, 7, { m: 3, twist: 0.6, fat: 0.4, ns: 5 }));
  g.in(M(-0.35, 3.6, 0.3, 40, 0, 48), () => warpShard(g, 0.16, 1.6, 8, { m: 4, twist: 0.9, fat: 0.4, ns: 6 }));
  // lesser shards round the foot
  const rnd = rng(4011);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU + 0.5, d = 0.85 + 0.3 * rnd(), t = 12 + 22 * rnd(); g.in(M(Math.cos(a) * d, -0.05, Math.sin(a) * d, Math.sin(a) * t, rnd() * 90, -Math.cos(a) * t), () => warpShard(g, 0.1 + 0.1 * rnd(), 0.6 + 1.0 * rnd(), 10 + i, { m: 5, twist: 0.7, ns: 8, glow: 0.45 })); }
  // bone buttresses: great ribs springing from the ground to hold the thing up, propped with lesser bones
  for (const [a, R, y1, r1, sd] of [[0.6, 1.3, 2.5, 0.42, 1], [2.3, 1.32, 2.2, 0.5, 2], [3.7, 1.3, 2.7, 0.45, 3], [5.2, 1.28, 2.0, 0.55, 4]]) {
    const co = Math.cos(a), si = Math.sin(a), A = [co * R, -0.05, si * R], B = [co * r1, y1, si * r1];
    rib(g, A, B, [co * 0.42, 0.85, si * 0.42], 0.075, sd);
    bone(g, [co * (R - 0.06), 0.02, si * (R - 0.06) + 0.14], [co * (R * 0.78 + 0.18), y1 * 0.56, si * (R * 0.78 + 0.18)], 0.03, sd + 7);
    g.in(M(A[0], 0.02, A[2]), () => g.in(M(0, 0, 0, 0, 0, 0, 0.6), () => boulder(g, 0.2, 0.14, 0.18, sd + 60, rgb(0x3a3040), nq(16))));
  }
  // fragments that hang in the air round the top, and will not fall
  for (let i = 0; i < 26; i++) {
    const t = i / 25, a = i * 2.4 + 0.7, R = 0.75 + 0.5 * hash1(i, 61), y = 4.3 + 4.0 * t, s = 0.07 + 0.09 * hash1(i, 63);
    g.surf(K_PLAIN, 0.12, 0.3, 0.45 + 0.3 * hash1(i, 65));
    g.in(M(Math.cos(a) * R, y, Math.sin(a) * R, hash1(i, 67) * 180, i * 40, hash1(i, 69) * 180), () => g.add(new THREE.OctahedronGeometry(s, 0).scale(1, 2.2 + hash1(i, 71), 0.8), (x, yy) => mul(warpAt(i * 0.21 + yy * 1.5), 0.45 + 0.4 * hash1(Math.round(x * 90), i))));
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
  const SLIME = [[0.35, 0.9, 0.08], [0.14, 0.6, 0.04], [0.03, 0.2, 0.03]], PURPLE = rgb(0x6e3470), BILE = rgb(0x9a8f2c), FLESH = rgb(0xa86a66), TEAL = rgb(0x3a7868), LIVID = rgb(0x4e3c86);
  // slime pools
  for (const [x, z, R, sd] of [[0.35, 0.55, 0.56, 1], [-0.95, 0.75, 0.34, 2], [0.95, -0.1, 0.3, 3]]) {
    g.in(M(x, 0.085, z, 0, sd * 50, 0), () => pool(g, R, SLIME, sd, 0.32, [0.03, 0.08, 0.02]));
    g.surf(K_PLAIN, 0.85);
    g.in(M(x, 0.07, z, 90, 0, 0), () => g.add(new THREE.TorusGeometry(R, 0.05, 5, nq(22)), (px, py, pz) => mul([0.16, 0.18, 0.08], 0.6 + 0.8 * noise3(px * 6, py * 6, pz * 6))));
    g.surf(K_PLAIN, 0.2, 0, 0.5);
    for (let i = 0; i < 3; i++) g.in(M(x + Math.cos(i * 2.3 + sd) * R * 0.45, 0.085, z + Math.sin(i * 2.3 + sd) * R * 0.45), () => g.add(new THREE.SphereGeometry(0.035 + 0.025 * hash1(i, sd), 8, 5, 0, TAU, 0, Math.PI / 2), [0.3, 0.8, 0.1]));
  }
  // the giants
  for (const [x, z, h, R, cap, sd, glow, rx, rz] of [[-0.6, -0.5, 2.05, 0.82, PURPLE, 1, 0.8, 3, 4], [0.72, -0.78, 1.45, 0.6, FLESH, 2, 0.6, -5, -6], [0.0, -1.05, 2.75, 0.5, LIVID, 3, 0.9, 4, -2], [-1.02, 0.2, 1.1, 0.4, BILE, 4, 0.5, 0, 9], [1.02, 0.72, 0.9, 0.36, TEAL, 5, 0.9, 6, -8]])
    g.in(M(x, 0, z, rx, sd * 70, rz), () => mushroom(g, h, R, cap, sd * 3, glow));
  // lesser toadstools in clumps
  for (const [x, z, s, cap, sd] of [[1.2, -1.15, 1.2, BILE, 2], [-1.2, -1.15, 1.5, TEAL, 3], [-0.62, 0.42, 0.9, FLESH, 5]]) g.in(M(x, 0.03, z, 0, sd * 60, 0), () => fungi(g, s, cap, sd, 0.7));
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
// Cloven: raw stone, hide and antler
// =====================================================================================================
const horned = (g, s, seed = 0) => { skull(g, s, true); for (const e of [-1, 1]) horn(g, [[e * 0.07 * s, 0.17 * s, -0.02 * s], [e * 0.2 * s, 0.22 * s, -0.05 * s], [e * 0.3 * s, 0.36 * s, 0.0], [e * 0.26 * s, 0.52 * s, 0.08 * s]], 0.04 * s, rgb(0x3a3028), rgb(0xa89878), { rings: 30, nu: 7, nv: 12 }); };
function herdstone(g) {
  g.moss = 0.5;
  pad(g, 2, 2, 0.1, (x, y, z) => mix(mul(rgb(0x4e3e2c), 0.65 + 0.6 * fbm3(x * 3, y * 5, z * 3, 3)), [0.2, 0.03, 0.02], 0.6 * smooth(0.75, 0.2, Math.hypot(x, z - 0.3)) * smooth(0.4, 0.6, noise3(x * 3, 1, z * 3))), 501);
  const rc = rockCol(rgb(0x6f6a60), 51, 0.35, 6);
  const stoneC = (x, y, z, nx, ny) => {
    const c = rc(x, y, z, nx, ny);
    const streak = smooth(0.6, 0.8, noise3(x * 8 + 3, y * 0.5, z * 8)) * smooth(1.0, 3.8, y), daub = smooth(0.6, 0.74, noise3(x * 2.4, y * 2.4 + 5, z * 2.4)) * smooth(2.4, 1.4, y) * smooth(0.3, 0.9, y);
    return mix(c, [0.17, 0.02, 0.016], Math.min(0.8, streak * 0.7 + daub * 0.55));
  };
  // the stone: a leaning fang of rock, split at the top, two lesser fangs against it
  g.surf(K_STONE, 0.96);
  limb(g, [[0, -0.15, -0.1], [0.04, 1.3, -0.08], [-0.08, 2.8, -0.1], [0.06, 3.9, -0.06], [0.2, 4.75, -0.05]], [0.62, 0.58, 0.48, 0.36, 0.05], { nu: nq(22), nv: nq(28), amp: 0.14, seed: 51, nf: 1.7, sq: 0.6, flat: [1, 0.6], col: stoneC, capB: true });
  limb(g, [[-0.2, 3.0, -0.12], [-0.34, 3.7, -0.1], [-0.36, 4.3, -0.12]], [0.3, 0.2, 0.03], { nu: nq(12), nv: nq(10), amp: 0.16, seed: 53, nf: 2.2, sq: 0.5, flat: [1, 0.6], col: stoneC, capB: true });
  limb(g, [[-0.62, -0.1, -0.3], [-0.66, 1.0, -0.3], [-0.78, 2.1, -0.34]], [0.32, 0.27, 0.04], { nu: nq(14), nv: nq(12), amp: 0.15, seed: 55, nf: 2, sq: 0.5, flat: [1, 0.7], col: stoneC, capB: true });
  limb(g, [[0.6, -0.1, -0.36], [0.66, 0.8, -0.38], [0.74, 1.5, -0.36]], [0.28, 0.22, 0.04], { nu: nq(14), nv: nq(10), amp: 0.15, seed: 57, nf: 2, sq: 0.5, flat: [1, 0.7], col: stoneC, capB: true });
  // crude glyphs scratched and daubed on its face
  for (const [x, y, s, sd, c] of [[-0.18, 1.25, 0.5, 1, [0.78, 0.74, 0.62]], [0.2, 1.75, 0.42, 2, [0.5, 0.06, 0.04]], [-0.12, 2.35, 0.44, 3, [0.78, 0.74, 0.62]], [0.12, 0.72, 0.36, 4, [0.5, 0.06, 0.04]], [0.02, 2.95, 0.34, 5, [0.78, 0.74, 0.62]]])
    g.in(M(x, y, lerp(0.3, 0.2, y / 3) + 0.0, -3, x * 30, sd * 7 - 14), () => sigil(g, 500 + sd, s, c, 0, 0.055));
  // antlers lashed to it, a horned skull at its brow
  for (const e of [-1, 1]) g.in(M(e * 0.3, 3.05, -0.02, 0, e > 0 ? 0 : 180, e * -18), () => antler(g, 0.95, e + 2));
  g.in(M(0, 2.55, 0.12), () => lashing(g, 0.5, 3, 0.016));
  g.in(M(0.02, 3.2, 0.22, -6, 0, 4), () => horned(g, 1.5, 1));
  // the heap at its foot: skulls, bones, antlers, bowls of blood, spears
  g.in(M(-0.15, 0.08, 0.5, 0, 10, 0), () => skullPile(g, 1.0, 5, 3));
  g.in(M(0.45, 0.07, 0.42, 0, -40, 0), () => skullPile(g, 0.9, 4, 5));
  g.in(M(-0.62, 0.07, 0.3, 0, 60, 0), () => horned(g, 1.2, 2));
  g.in(M(0.75, 0.05, 0.05, -70, 30, 0), () => antler(g, 0.7, 5));
  g.in(M(-0.4, 0.06, 0.78, -80, -50, 0), () => antler(g, 0.6, 6));
  for (const [a, b, sd] of [[[-0.5, 0.08, 0.75], [-0.05, 0.1, 0.9], 1], [[0.2, 0.08, 0.8], [0.6, 0.07, 0.7], 2], [[0.3, 0.12, 0.62], [0.1, 0.3, 0.4], 3], [[-0.3, 0.1, 0.62], [-0.48, 0.34, 0.36], 4]]) bone(g, a, b, 0.024, sd);
  for (let k = 0; k < 5; k++) rib(g, [0.62 + k * 0.07, 0.03, 0.72 - k * 0.02], [0.62 + k * 0.07, 0.03, 0.42 - k * 0.02], [0, 0.2, 0], 0.014, k);
  for (const [x, z, sd] of [[0.1, 0.78, 1], [-0.8, 0.62, 2]]) g.in(M(x, 0.05, z), () => {
    g.surf(K_PLAIN, 0.9); g.lathe([[0.05, 0], [0.11, 0.03], [0.14, 0.09], [0.13, 0.1], [0.1, 0.04], [0, 0.03]], nq(12), mul(rgb(0x7a5a42), 0.8 + 0.2 * sd));
    g.surf(K_PLAIN, 0.15); g.in(M(0, 0.075, 0), () => g.cyl(0.115, 0.115, 0.001, nq(12), [0.22, 0.015, 0.012], false, true));
  });
  // ragged hide banners on crooked poles
  for (const [x, z, h, ry, sd] of [[-0.82, -0.72, 3.3, 20, 1], [0.84, -0.7, 2.8, -25, 2], [0.86, 0.72, 2.1, -60, 3]]) g.in(M(x, 0, z, (hash1(sd, 1) - 0.5) * 9, ry, (hash1(sd, 2) - 0.5) * 9), () => {
    stake(g, 0.04, h, sd + 60, rgb(0x4a3a28));
    logTo(g, [-0.3, h - 0.32, 0.02], [0.3, h - 0.26, 0.02], 0.022, 0.018, sd + 3, { seg: 6, capB: true });
    g.in(M(0, h - 0.3, 0), () => lashing(g, 0.045, 3));
    g.in(M(0, h - 0.3, 0.035), () => rag(g, 0.52, h * 0.36, sd % 2 ? HIDE : HIDE_DARK, sd + 8, 0.6, OCHRE));
    g.in(M(0, h - 0.1, 0, 0, 0, 0), () => horned(g, 0.9, sd));
    for (const e of [-1, 1]) { rope(g, [[e * 0.28, h - 0.3, 0.02], [e * 0.29, h - 0.6, 0.03]], 0.007, rgb(0x8a7450), 4); bone(g, [e * 0.29, h - 0.6, 0.03], [e * 0.3, h - 0.85, 0.03], 0.015, sd + e); }
  });
  for (const [x, z, rz, sd] of [[-0.3, -0.85, 8, 1], [0.35, -0.88, -6, 2]]) g.in(M(x, 0, z, -8, 0, rz), () => { stake(g, 0.02, 2.0, sd + 70, rgb(0x5a4630)); g.surf(K_PLAIN, 0.5, 0.6); g.in(M(0, 1.92, 0), () => g.lathe([[0.012, 0], [0.04, 0.06], [0, 0.26]], 4, [0.3, 0.3, 0.32])); g.in(M(0, 1.8, 0.02), () => rag(g, 0.08, 0.35, OCHRE, sd, 0.5)); });
}
function hideTent(g) {
  g.moss = 0.5;
  pad(g, 2, 2, 0.06, rgb(0x54432e), 511);
  const B = [-0.2, 1.38, -0.86], F = [-0.14, 1.86, 0.3], W = (u) => lerp(0.6, 0.78, u), wood = rgb(0x5a4630);
  const R = (u) => v3(B, F, u);
  const side = (k) => (u, v) => {
    const s = v < 0.5 ? -1 : 1, t = Math.abs(2 * v - 1), r = R(u), sag = 0.11 * Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(u * 9.4 + 1));
    return [r[0] + s * W(u) * Math.pow(t, 0.92) * k, Math.max(0.02 + 0.05 * Math.abs(Math.sin(u * 14)) * (t > 0.98 ? 1 : 0), (r[1] + 0.04) * (1 - t) - sag) * (k < 1 ? 0.97 : 1), r[2] - (1 - u) * 0.1 * t];
  };
  hideSheet(g, 30, 34, side(1), HIDE, 61);
  g.surf(K_PLAIN, 1);
  g.sheet(8, 12, side(0.97), (x, y) => mul([0.06, 0.045, 0.03], 0.4 + 0.5 * y), false, true);
  // the back is closed with one pelt, the front with two that hang apart
  hideSheet(g, 12, 10, (u, v) => { const gx = B[0] + (u * 2 - 1) * 0.6, p = v3([B[0], B[1], B[2] - 0.02], [gx, 0.02, B[2] - 0.1 - 0.1 * Math.sin(Math.PI * u)], v); return [p[0], p[1] - 0.05 * Math.sin(Math.PI * v), p[2]]; }, HIDE_DARK, 63, true);
  for (const s of [-1, 1]) hideSheet(g, 8, 12, (u, v) => { const o = v3(F, [F[0] + s * 0.78, 0.02, F[2]], v), i = v3(F, [F[0] + s * (0.2 + 0.1 * s), 0.02, F[2] + 0.12], v), p = v3(o, i, u); return [p[0], p[1] - 0.04 * Math.sin(Math.PI * v) * u, p[2] + 0.05 * Math.sin(u * Math.PI) * v]; }, s > 0 ? HIDE : mix(HIDE, HIDE_DARK, 0.5), 64 + s, s > 0);
  g.surf(K_PLAIN, 1);
  g.flat([[F[0] - 0.3, 0.01, F[2] - 0.04], [F[0] + 0.4, 0.01, F[2] - 0.04], [F[0], F[1] - 0.2, F[2] - 0.04]], [0.012, 0.01, 0.008]);
  // crooked poles: two pairs crossed, the ridge pole through their crotches, more leaning on
  for (const [P0, sd] of [[F, 1], [B, 2]]) for (const s of [-1, 1]) { const foot = [P0[0] + s * (W(sd === 1 ? 1 : 0) + 0.1), -0.05, P0[2] + (sd === 1 ? 0.06 : -0.06)], top = v3(foot, [P0[0], P0[1] + 0.03, P0[2]], 1.24); logTo(g, foot, top, 0.045, 0.03, sd * 5 + s, { seg: 8, bark: wood, amp: 0.2 }); }
  logTo(g, v3(B, F, -0.2), v3(B, F, 1.22), 0.04, 0.035, 9, { seg: 8, bark: wood, capB: true });
  for (const p of [F, B]) g.in(M(p[0], p[1] + 0.05, p[2]), () => lashing(g, 0.08, 3, 0.014));
  for (const [u, s, sd] of [[0.35, -1, 1], [0.7, 1, 2], [0.5, 1, 3]]) { const r = R(u); logTo(g, [r[0] + s * (W(u) + 0.04), -0.05, r[2]], [r[0] - s * 0.1, r[1] + 0.2, r[2] + 0.03], 0.03, 0.022, 20 + sd, { seg: 7, bark: wood, amp: 0.2 }); }
  // stones on the skirts, a horned skull over the door, tusks at the threshold
  for (let k = 0; k < 9; k++) { const u = hash1(k, 71), s = k % 2 ? 1 : -1, r = R(u); g.in(M(r[0] + s * (W(u) + 0.02), 0.03, r[2], 0, k * 70, 0), () => boulder(g, 0.09, 0.06, 0.08, 80 + k, rgb(0x77736a), nq(14))); }
  g.in(M(F[0], F[1] - 0.26, F[2] + 0.07, -12, 0, 0), () => horned(g, 1.25, 4));
  for (const s of [-1, 1]) g.in(M(F[0] + s * 0.36, 0, F[2] + 0.16, 0, s > 0 ? 180 : 0, 0), () => g.in(M(0, 0, 0, 0, 0, -8), () => horn(g, [[0, -0.1, 0], [0.02, 0.2, 0], [0.1, 0.45, 0], [0.22, 0.62, 0]], 0.05, mul(BONE, 1.05), rgb(0x8a7a5a), { rings: 20, nu: 8, nv: 12 })));
  // the bone rack and a pelt on a stretching frame
  g.in(M(0.82, 0, -0.42, 0, 82, 0), () => boneRack(g, 0.8, 1.25, 7));
  // the fire pit, smoking
  g.in(M(0.52, 0.04, 0.68), () => {
    for (let k = 0; k < 8; k++) g.in(M(Math.cos(k * 0.785) * 0.24, 0, Math.sin(k * 0.785) * 0.24, 0, k * 50, 0), () => boulder(g, 0.08, 0.06, 0.07, 90 + k, rgb(0x6a665e), nq(14)));
    g.surf(K_PLAIN, 1, 0, 0.9); g.in(M(0, 0.03, 0), () => g.cyl(0.19, 0.19, 0.001, nq(12), (x, y, z) => mix([0.03, 0.02, 0.02], [1.0, 0.25, 0.03], smooth(0.5, 0.8, noise3(x * 30, 1, z * 30))), false, true));
    for (let k = 0; k < 3; k++) { const a = k * 2.1 + 0.3; logTo(g, [Math.cos(a) * 0.18, 0.05, Math.sin(a) * 0.18], [-Math.cos(a) * 0.1, 0.13, -Math.sin(a) * 0.1], 0.035, 0.03, 40 + k, { seg: 7, capB: true, bark: [0.06, 0.05, 0.045], heart: [0.5, 0.12, 0.03] }); }
    g.in(M(0, 0.06, 0), () => fire(g, 0.26, FIRE_RED, 3, 0.9));
    g.in(M(0, 0.3, 0), () => smoke(g, 0.07, 1.3, 5, [0.2, 0.2, 0.21], [0.45, 0.45, 0.46], 6, 0.2));
    // a spit over it
    for (const s of [-1, 1]) g.in(M(s * 0.3, 0, 0, 0, 0, s * 4), () => stake(g, 0.02, 0.5, s + 5, wood));
    logTo(g, [-0.36, 0.46, 0], [0.36, 0.47, 0], 0.014, 0.012, 8, { seg: 5, capB: true });
    g.surf(K_PLAIN, 0.7); g.in(M(0, 0.45, 0, 0, 0, 90), () => g.add(new THREE.SphereGeometry(0.07, nq(10), nq(7)).scale(1, 1.9, 1), (x, y, z) => mul([0.36, 0.14, 0.07], 0.7 + 0.5 * noise3(x * 20, y * 20, z * 20))));
  });
}

// =====================================================================================================
// Fimbul: timber, whalebone and snow
// =====================================================================================================
const FIM_WOOD = [rgb(0x5a4632), rgb(0x6a5238), rgb(0x4c3a2a), rgb(0x705a40)], FIM_PAINT = [[rgb(0xa82a22), rgb(0xe6dcc0)], [rgb(0x2a4a8a), rgb(0xd8b23a)], [rgb(0x1e1c1a), rgb(0xd8b23a)], [rgb(0x2f6a3e), rgb(0xe6dcc0)], [rgb(0xe6dcc0), rgb(0xa82a22)]];
const snowCol = (seed = 0) => (x, y, z, nx, ny) => mul(mix([0.6, 0.7, 0.86], SNOW, smooth(0.2, 0.8, ny ?? 1)), 0.9 + 0.14 * noise3(x * 4 + seed, y * 4, z * 4));
const snowGround = (earth, seed, amt = 0.5) => (x, y, z) => mix(mul(earth, 0.65 + 0.6 * fbm3(x * 3, y * 5, z * 3, 3)), SNOW, smooth(0.62 - amt * 0.4, 0.72 - amt * 0.4, noise3(x * 1.3 + seed, 2, z * 1.3)));
/** a drift of snow on the local origin */
function drift(g, rx, ry, rz, seed = 0) { g.surf(K_PLAIN, 0.6); g.sheet(nq(14), nq(5), (u, v) => { const a = u * TAU, k = 1 + 0.25 * noise3(Math.cos(a) * 1.3 + seed, 1, Math.sin(a) * 1.3); return [Math.cos(a) * rx * v * k, v > 0.99 ? -0.03 : ry * Math.pow(1 - v * v, 0.7), Math.sin(a) * rz * v * k]; }, snowCol(seed), true); }
/** a carved dragon's head for a gable or a prow: its neck rises from the local origin, it looks toward +X. Sculpted once. */
function dragonHead(g, s = 1) {
  const geo = geoOnce('dragonHead', () => {
    const w = 0x5e4630, red = 0x9a2a1e, gold = 0xd8a62a, P = [];
    P.push(...S.limb([[-0.14, -0.14, 0], [-0.02, 0.1, 0], [0.06, 0.3, 0], [0.16, 0.42, 0]], [0.075, 0.07, 0.065, 0.075]).map((p) => p.color(w).tint(0.16, 14).bump(0.004, 30, 'scales')));
    P.push(S.ellipsoid(0.13, 0.085, 0.075).rot(0, 0, 12).at(0.25, 0.46, 0).color(w).tint(0.16, 14).blend(0.04));
    P.push(S.capsule([0.3, 0.48, 0], [0.5, 0.5, 0], 0.06, 0.045).color(w).blend(0.04));
    P.push(S.sphere(0.05).at(0.52, 0.53, 0).color(w).blend(0.03));
    P.push(S.capsule([0.24, 0.39, 0], [0.47, 0.36, 0], 0.04, 0.028).color(w).blend(0.02));
    P.push(S.box(0.26, 0.035, 0.2, 0.01).rot(0, 0, 4).at(0.4, 0.425, 0).color(red).cut(0.012));
    for (let i = 0; i < 4; i++) for (const e of [-1, 1]) P.push(S.cone(0.014, 0.003, 0.05, 0.002).rot(180, 0, 0).at(0.33 + i * 0.05, 0.45, e * 0.04).color(0xe8e0c8).blend(0.004));
    P.push(...[-1, 1].map((e) => S.sphere(0.024).at(0.29, 0.5, e * 0.06).color(gold).blend(0.006)));
    P.push(...[-1, 1].map((e) => S.sphere(0.011).at(0.3, 0.502, e * 0.08).color(0x111111).blend(0.003)));
    P.push(...S.limb([[0.14, 0.52, 0], [0.04, 0.62, 0], [-0.06, 0.6, 0], [-0.08, 0.52, 0]], [0.04, 0.035, 0.028, 0.014]).map((p) => p.color(red).blend(0.02)));
    P.push(S.torus(0.078, 0.014).rot(0, 0, 80).at(-0.02, 0.1, 0).color(gold).paint(0.004, 0.005));
    P.push(S.torus(0.072, 0.014).rot(0, 0, 68).at(0.06, 0.3, 0).color(red).paint(0.004, 0.005));
    return buildPartGeometry({ prims: P }, { res: 52 * qual(), ao: 0.8 });
  });
  const k = g.kind; g.surf(K_WOOD, 0.8);
  g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(geo));
  g.kind = k;
}
/** a carved and painted post standing on the local origin */
function carvedPost(g, r, h, seed = 0) {
  g.surf(K_WOOD, 0.8);
  g.sheet(nq(12), nq(16), (u, v) => { const a = u * TAU, k = 1 + 0.1 * Math.sin(v * 18) * smooth(0.1, 0.2, v) * smooth(0.95, 0.85, v) + (v < 0.08 || v > 0.92 ? 0.25 : 0); return [Math.cos(a) * r * k, v * h, Math.sin(a) * r * k]; },
    (x, y, z, nx, ny, nz, u, v) => { const s = tri1(u * 2 + v * 5 + seed * 0.3); return v < 0.08 || v > 0.92 ? mul(FIM_WOOD[2], 0.8) : s > 0.72 ? rgb(0xa82a22) : s < 0.2 ? rgb(0xd8b23a) : mul(FIM_WOOD[0], 0.7 + 0.4 * noise3(x * 30, y * 4, z * 30)); }, true);
}
function longhouse(g) {
  g.moss = 0.3;
  const hl = 2.12, hz = 0.98, w0 = 0.16, wy = 1.24, eZ = 1.3, eY = 1.1, rY = 3.0, xl = hl + 0.26;
  const ridgeY = (x) => rY + 0.17 * Math.pow(Math.abs(x) / xl, 2);
  pad(g, 5, 3, 0.05, snowGround(rgb(0x4e4232), 3, 0.6), 601, { nu: 70 });
  const st = stoneStyle(0x77736a, { seed: 602, course: w0, len: [0.25, 0.5], chip: 0.25 });
  stoneBox(g, hl + 0.05, hz + 0.05, 0, w0, st, 603);
  // stave walls between stout posts
  for (let s = 0; s < 4; s++) {
    const W = s % 2 ? hz : hl, D = s % 2 ? hl : hz;
    g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-W, w0, D)), () => {
      plankWall(g, 2 * W, wy - w0 + 0.04, FIM_WOOD, 610 + s, { even: true, tilt: 1.2, pw: 0.17, skip: s === 0 ? (x) => Math.abs(x - W) < 0.3 : null });
      const np = s % 2 ? 2 : 6;
      for (let i = 0; i <= np; i++) { if (s === 0 && i === np / 2) continue; g.in(M((2 * W * i) / np, -w0, 0.02), () => log(g, 0.075, 0.07, wy + 0.02, s * 9 + i, { seg: nq(9), bark: mul(FIM_WOOD[2], 0.9) })); }
      g.surf(K_WOOD, 0.9);
      g.in(M(W, wy - w0 - 0.03, 0.035), () => g.beam(2 * W + 0.1, 0.1, 0.06, 0.012, woodTint(FIM_WOOD[2], s), 6));
      // round shields hung along the wall
      const n = s % 2 ? 2 : 7;
      for (let i = 0; i < n; i++) { const x = s % 2 ? W + (i - 0.5) * 0.8 : (2 * W * (i + 0.5)) / n; if (s === 0 && Math.abs(x - W) < 0.5) continue; const pc = FIM_PAINT[(i + s * 2) % FIM_PAINT.length]; g.in(M(x, 0.56, 0.075, -6, 0, (hash1(i, s) - 0.5) * 30), () => roundShield(g, 0.205, pc[0], pc[1], i + s * 7)); }
    });
  }
  // gable ends: boards up to the roof, a smoke vent
  for (const e of [-1, 1]) {
    g.surf(K_WOOD, 0.9);
    const n = 9;
    for (let i = 0; i < n; i++) { const z = -hz + ((i + 0.5) * 2 * hz) / n, top = lerp(eY + 0.1, ridgeY(hl) - 0.06, 1 - Math.abs(z) / eZ); g.in(M(e * (hl - 0.01), (wy + top) / 2 - 0.02, z, 0, 0, 90), () => g.beam(top - wy + 0.1, 0.035, (2 * hz) / n - 0.008, 0.006, woodTint(FIM_WOOD[(i + (e > 0 ? 1 : 0)) % 4], i + e * 5), 3)); }
    g.surf(K_PLAIN, 1);
    g.in(M(e * (hl + 0.012), 2.2, 0, 0, e * 90, 0), () => g.flat([[-0.12, -0.14, 0], [0.12, -0.14, 0], [0, 0.16, 0]], [0.015, 0.012, 0.01]));
  }
  // the roof: steep, shingled, its ridge rising toward the gables like a ship's sheer
  const roof = (s) => (u, v) => { const x = lerp(-xl, xl, u), k = Math.min(v, 0.99); return [x, lerp(eY, ridgeY(x), k) - 0.1 * Math.sin(Math.PI * k), s * lerp(eZ, 0, k)]; };
  g.surf(K_ROOF, 0.9);
  for (const s of [1, -1]) tiles(g, nq(15), () => 5 / 0.19, roof(s), { pal: SHINGLE, lift: 0.028, seed: 620 + s });
  g.surf(K_PLAIN, 1);
  for (const s of [1, -1]) g.sheet(6, 4, (u, v) => { const p = roof(s)(u, v * 0.98); return [p[0] * 0.985, p[1] - 0.03, p[2] * 0.985]; }, [0.035, 0.028, 0.022], false, s > 0);
  // snow lying on the upper slopes and along the ridge
  g.surf(K_PLAIN, 0.6);
  for (const s of [1, -1]) g.sheet(nq(44), nq(7), (u, v) => { const v0 = 0.46 + 0.34 * noise3(u * 6 + s, 3, 1) + 0.07 * Math.sin(u * 40 + s), p = roof(s)(u * 0.98 + 0.01, lerp(v0, 1.0, v)), th = 0.06 * Math.sin(Math.PI * Math.min(1, v * 1.6 + 0.12)) + 0.05 * v; return [p[0], p[1] + th + 0.045 + (v > 0.98 ? 0.03 : 0), p[2] + s * th * 0.6]; }, snowCol(s), false, s < 0);
  // ridge beam, bargeboards crossed at the gables and carved into dragons
  g.surf(K_WOOD, 0.9);
  g.in(M(0, rY + 0.02, 0), () => g.beam(2 * xl + 0.1, 0.1, 0.1, 0.02, woodTint(FIM_WOOD[2], 31), 14, (x) => [0.17 * Math.pow(Math.abs(x) / xl, 2), 0]));
  for (const e of [-1, 1]) for (const s of [-1, 1]) {
    const x = e * (xl + 0.03), a = [x, eY - 0.1, s * (eZ + 0.04)], top = [x + e * 0.02 * s, ridgeY(xl), 0], b = v3(a, top, 1.13);
    g.surf(K_WOOD, 0.9);
    g.beamTo(a, b, 0.05, 0.17, 0.012, (px, py, pz) => (tri1(px * 3.2) > 0.8 ? rgb(0xa82a22) : mul(FIM_WOOD[1], 0.75 + 0.4 * noise3(px * 2, py * 20, pz * 20))), 8, [e, 0, 0]);
    g.in(M(b[0], b[1] - 0.06, b[2], 0, s > 0 ? 90 : -90, 0), () => dragonHead(g, 1.5));
  }
  // the smoke hole: a little louvred roof astride the ridge, smoke climbing out
  g.in(M(0.5, rY + 0.02, 0), () => {
    g.surf(K_WOOD, 0.9);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.in(M(sx * 0.2, 0.12, sz * 0.1), () => g.cbox(0.045, 0.3, 0.045, 0.008, woodTint(FIM_WOOD[2], sx + sz * 3)));
    for (const sz of [-1, 1]) g.in(M(0, 0.34, sz * 0.12, sz * 52, 0, 0), () => g.cbox(0.56, 0.03, 0.34, 0.008, woodTint(FIM_WOOD[0], sz + 9)));
    g.in(M(0, 0.44, 0), () => drift(g, 0.3, 0.07, 0.12, 4));
    g.surf(K_PLAIN, 1); g.in(M(0, 0.2, 0), () => g.cbox(0.34, 0.2, 0.16, 0.01, [0.012, 0.01, 0.01]));
    for (const sz of [-1, 1]) g.in(M(0.02, 0.26, sz * 0.14), () => smoke(g, 0.1, 1.5, 3 + sz, [0.25, 0.25, 0.26], [0.62, 0.62, 0.64], 5, 0.3));
  });
  // the door under its own gabled porch, between carved posts
  g.in(M(0, w0, hz + 0.02), () => {
    plankDoor(g, 0.56, 1.02, rgb(0x4c3626), 5);
    g.surf(K_WOOD, 0.9);
    g.in(M(0, 1.06, 0.03), () => g.beam(0.78, 0.09, 0.07, 0.014, (x, y, z) => (tri1(x * 5) > 0.7 ? rgb(0xd8b23a) : mul(FIM_WOOD[2], 0.8 + 0.3 * noise3(x * 3, y * 20, z * 20))), 8));
    for (const e of [-1, 1]) g.in(M(e * 0.34, -w0, 0.03), () => carvedPost(g, 0.05, 1.22, e + 1));
  });
  for (const e of [-1, 1]) g.in(M(e * 0.46, 0, hz + 0.4), () => carvedPost(g, 0.065, 1.38, e + 4));
  g.surf(K_WOOD, 0.9);
  const pr = (s) => (u, v) => [s * lerp(0.62, 0, v), lerp(1.36, 1.84, v) - 0.03 * Math.sin(Math.PI * v), lerp(hz + 0.5, 0.8, u)];
  g.surf(K_ROOF, 0.9);
  for (const s of [1, -1]) tiles(g, 4, () => 4, (u, v) => pr(s)(u, Math.min(v, 0.98)), { pal: SHINGLE, lift: 0.025, seed: 640 + s });
  g.surf(K_WOOD, 0.9);
  for (const s of [-1, 1]) g.beamTo([s * 0.66, 1.32, hz + 0.52], [s * -0.1, 1.94, hz + 0.52], 0.04, 0.12, 0.01, woodTint(FIM_WOOD[1], s + 12), 3, [0, 0, 1]);
  g.in(M(0, 1.86, hz + 0.5, 0, -90, 0), () => dragonHead(g, 0.6));
  g.in(M(0, 1.85, hz + 0.44), () => drift(g, 0.3, 0.07, 0.12, 5));
  g.surf(K_PLAIN, 1);
  g.flat([[-0.58, 1.34, hz + 0.47], [0.58, 1.34, hz + 0.47], [0, 1.8, hz + 0.47]], mul(FIM_WOOD[2], 0.5));
  // outside: a woodpile, casks, drifts against the walls
  for (let i = 0; i < 9; i++) g.in(M(-1.95 + (i % 4) * 0.12 + (i > 3 ? 0.06 : 0) + (i > 6 ? 0.06 : 0), 0.08 + (i > 6 ? 0.2 : i > 3 ? 0.1 : 0), hz + 0.34, 90, 0, 0), () => g.in(M(0, -0.2, 0), () => log(g, 0.055, 0.05, 0.4, i + 30, { seg: 7, capB: true })));
  g.in(M(1.7, 0.02, hz + 0.3), () => barrel(g, 0.14, 0.34, rgb(0x6b4a2e), 3));
  g.in(M(1.98, 0.02, hz + 0.24), () => barrel(g, 0.11, 0.28, rgb(0x5b3f28), 4));
  for (const [x, z, rx, rz, sd] of [[-1.1, hz + 0.3, 0.5, 0.2, 1], [1.0, hz + 0.26, 0.4, 0.16, 2], [-0.6, -hz - 0.28, 0.7, 0.2, 3], [1.4, -hz - 0.26, 0.6, 0.2, 4], [-2.3, 0.3, 0.14, 0.5, 5], [2.3, -0.4, 0.14, 0.4, 6]]) g.in(M(x, 0.02, z), () => drift(g, rx, 0.12, rz, sd));
}
function whaleShrine(g) {
  g.moss = 0.2;
  pad(g, 2, 2, 0.06, snowGround(rgb(0x4a4438), 7, 0.75), 651);
  const old = rgb(0xcfc8ae);
  const great = (a, b, bow, r, seed) => { const pts = []; for (let k = 0; k <= 6; k++) { const t = k / 6, s = Math.sin(t * Math.PI * 0.9); pts.push([lerp(a[0], b[0], t) + bow[0] * s, lerp(a[1], b[1], t) + bow[1] * s, lerp(a[2], b[2], t) + bow[2] * s]); } g.surf(K_PLAIN, 0.7); limb(g, pts, [r * 1.35, r * 1.2, r * 1.05, r, r * 0.85, r * 0.62, r * 0.34], { nu: nq(10), nv: nq(26), flat: [1, 0.6], amp: 0.05, nf: 5, seed, col: boneCol(seed, old), capA: true, capB: true }); };
  // the two jawbones make the front arch; three pairs of ribs behind them carry the spine
  for (const e of [-1, 1]) great([e * 0.82, -0.1, 0.62], [e * 0.03, 3.7, 0.52], [e * 0.34, 0.25, 0.04], 0.085, e + 2);
  const sp = (t) => [0, lerp(3.35, 2.05, t), lerp(0.5, -0.82, t)];
  [[0.22, 0.78], [0.55, 0.72], [0.88, 0.62]].forEach(([t, bx], i) => { const p = sp(t); for (const e of [-1, 1]) great([e * bx, -0.1, p[2] - 0.02], [e * 0.03, p[1] + 0.04, p[2]], [e * 0.3, 0.2, 0], 0.055, i * 3 + e + 9); });
  for (let i = 0; i < 9; i++) {
    const p = sp(i / 8), c = boneCol(i + 20, old);
    g.surf(K_PLAIN, 0.7);
    g.in(M(p[0], p[1], p[2], 90 - 44.5, 0, 0), () => {
      g.in(M(0, -0.065, 0), () => g.lathe([[0, 0], [0.07, 0], [0.085, 0.02], [0.065, 0.065], [0.085, 0.11], [0.07, 0.13], [0, 0.13]], nq(9), c));
      g.in(M(0, 0, 0, -90, 0, 0), () => g.in(M(0, 0.06, 0), () => g.cyl(0.03, 0.012, 0.14, 5, c, false, true)));
      for (const e of [-1, 1]) g.in(M(0, 0, 0, -90, 0, e * 80), () => g.in(M(0, 0.06, 0), () => g.cyl(0.026, 0.01, 0.12, 5, c, false, true)));
    });
  }
  // lashed where they meet; charms hang from the arch
  g.in(M(0, 3.42, 0.52), () => lashing(g, 0.12, 4, 0.018));
  for (const [x, l, kind, sd] of [[-0.3, 0.7, 0, 1], [-0.12, 1.05, 1, 2], [0.1, 0.85, 2, 3], [0.3, 0.6, 0, 4], [0.0, 0.5, 1, 5]]) {
    const y0 = 3.2 - Math.abs(x) * 1.6, z = 0.54;
    rope(g, [[x, y0, z], [x + 0.01, y0 - l * 0.5, z + 0.01], [x, y0 - l, z]], 0.007, rgb(0x8a7450), 4);
    if (kind === 0) bone(g, [x, y0 - l, z], [x + 0.02, y0 - l - 0.24, z], 0.016, sd);
    else if (kind === 1) { g.surf(K_PLAIN, 0.4, 0.8); g.in(M(x, y0 - l - 0.07, z, 0, sd * 40, 0), () => { g.in(M(0, 0, 0, 90, 0, 0), () => g.cyl(0.07, 0.07, 0.012, nq(10), mul(BRASS, 0.8), true, true)); g.in(M(0, 0, 0.008), () => sigil(g, 660 + sd, 0.1, [0.3, 0.75, 1.0], 0.9, 0.09)); }); }
    else { g.in(M(x, y0 - l, z), () => rag(g, 0.07, 0.3, rgb(0x2a3a5a), sd, 0.3)); g.in(M(x + 0.05, y0 - l, z), () => rag(g, 0.05, 0.24, rgb(0xd8d2c0), sd + 1, 0.3)); }
  }
  // the rune stone: a slab carved with a serpent band, the runes coloured red, some of them alight
  g.surf(K_STONE, 0.95);
  const rc = rockCol(rgb(0x7a7e84), 61, 0.3, 6);
  limb(g, [[0, -0.12, -0.2], [0.02, 0.7, -0.2], [-0.02, 1.35, -0.21], [0.03, 1.72, -0.22]], [0.4, 0.38, 0.33, 0.14], { nu: nq(18), nv: nq(16), amp: 0.07, seed: 61, nf: 2.2, sq: 0.6, flat: [1, 0.36], capB: true,
    col: rc });
  for (const [x, y, s, sd, lit] of [[-0.1, 1.12, 0.3, 1, 1], [0.1, 0.84, 0.3, 2, 0], [-0.08, 0.54, 0.3, 3, 0], [0.1, 0.3, 0.26, 4, 1]]) g.in(M(x, y, -0.2 + 0.125, 0, 0, 0), () => sigil(g, 670 + sd, s, lit ? [0.3, 0.75, 1.0] : [0.55, 0.07, 0.04], lit ? 1.0 : 0, 0.07));
  g.in(M(0, 1.72, -0.2), () => drift(g, 0.16, 0.07, 0.08, 9));
  // the offering bowl on a flat stone, a lamp of whale oil, vertebrae for seats, a harpoon
  g.in(M(0, 0.02, 0.36), () => {
    boulder(g, 0.26, 0.1, 0.2, 71, rgb(0x6f7074), nq(20));
    g.surf(K_PLAIN, 0.4, 0.85); g.in(M(0, 0.12, 0), () => g.lathe([[0.04, 0], [0.07, 0.015], [0.05, 0.04], [0.13, 0.1], [0.16, 0.13], [0.15, 0.135], [0.11, 0.09], [0, 0.07]], nq(14), (x, y, z) => mul(mix(BRASS, VERDIGRIS, 0.35 * smooth(0.4, 0.7, noise3(x * 20, y * 20, z * 20))), 0.8)));
    g.surf(K_PLAIN, 0.3, 0.6); g.in(M(0, 0.21, 0), () => g.add(new THREE.SphereGeometry(0.11, nq(10), 4, 0, TAU, 0, 1.2).scale(1, 0.35, 1), (x, y, z) => mul(hash1(Math.round(x * 60), Math.round(z * 60)) > 0.5 ? [0.75, 0.55, 0.12] : [0.6, 0.62, 0.66], 0.9)));
    g.in(M(0.02, 0.24, 0.01), () => fire(g, 0.16, FIRE_FROST, 2, 0.9));
  });
  for (const [x, z, sd] of [[-0.62, 0.3, 1], [0.66, 0.1, 2]]) g.in(M(x, 0.02, z, 0, sd * 40, 0), () => { g.surf(K_PLAIN, 0.7); g.lathe([[0.15, 0], [0.19, 0.03], [0.15, 0.12], [0.19, 0.21], [0.16, 0.24], [0, 0.24]], nq(12), boneCol(sd + 40, old)); g.in(M(0, 0.24, 0), () => drift(g, 0.13, 0.04, 0.11, sd)); });
  g.in(M(0.84, 0, -0.5, -10, 0, 7), () => { stake(g, 0.018, 1.9, 5, rgb(0x5a4630)); g.surf(K_PLAIN, 0.4, 0.85); g.in(M(0, 1.84, 0), () => g.lathe([[0.012, 0], [0.045, 0.05], [0.016, 0.1], [0, 0.34]], 4, [0.3, 0.3, 0.33])); rope(g, [[0, 1.5, 0.02], [0.03, 1.0, 0.04], [0.0, 0.5, 0.02], [0.08, 0.05, 0.1]], 0.008, rgb(0x8a7450), 4); });
  for (const [x, z, rx, rz, sd] of [[-0.75, -0.7, 0.3, 0.25, 1], [0.6, 0.78, 0.36, 0.18, 2], [-0.7, 0.8, 0.22, 0.16, 3]]) g.in(M(x, 0.03, z), () => drift(g, rx, 0.1, rz, sd + 20));
}

// =====================================================================================================
// Ashur: glazed black brick, brass and fire
// =====================================================================================================
const ASH_BRICK = [rgb(0x2a2630), rgb(0x2a2630), rgb(0x221f28), rgb(0x34303a), rgb(0x3e1c1e), rgb(0x1c2c34), rgb(0x2e2a26), rgb(0x1a181e)];
const ashBrick = (seed, o) => stoneStyle(0x2a2630, { seed, pal: ASH_BRICK, mortar: [0.012, 0.011, 0.012], chip: 0.1, r: 0.012, ...o });
const brassC = (seed = 0, k = 1) => (x, y, z) => mul(BRASS, k * (0.65 + 0.6 * noise3(x * 7 + seed, y * 7, z * 7)));
const lavaC = (g, seed = 0, glow = 0.9) => (x, y, z) => { const n = noise3(x * 4 + seed, y * 4, z * 4), hot = smooth(0.3, 0.62, n); g.glow = glow * (0.25 + 0.5 * hot); return mix([0.2, 0.015, 0.01], [1.0, 0.2, 0.015], hot); };
/** set the finish of everything added since vertex n0 (the coursed-stone pieces always come out matt) */
const refinish = (g, n0, rough, metal = null) => { for (let i = n0; i < g.n; i++) { g.A[i * 3] = rough; if (metal !== null) g.A[i * 3 + 1] = metal; } };
/** a square smoke stack on the local origin: battered brick, a brass crown, soot inside */
function stack(g, hw, h, seed, smog = 0) {
  const c = (x, y, z) => mul(ASH_BRICK[Math.floor(hash1(Math.floor(y / 0.14), Math.floor((x + z) * 4 + (Math.floor(y / 0.14) % 2) * 0.5), seed) * 8)], (y % 0.14) < 0.02 ? 0.4 : 0.9 + 0.3 * noise3(x * 9, y * 9, z * 9));
  g.surf(K_STONE, 0.5);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => { const nv = Math.max(2, Math.round(h / 0.07)); g.sheet(3, nv, (u, v) => { const w = lerp(hw, hw * 0.72, v); return [(u * 2 - 1) * w, v * h, w + 0.002]; }, c); });
  g.surf(K_PLAIN, 0.35, 0.9);
  g.in(M(0, h, 0, 0, 45, 0), () => g.lathe([[hw * 0.72 * 1.42, -0.12], [hw * 0.72 * 1.6, -0.1], [hw * 0.72 * 1.72, 0.02], [hw * 0.72 * 1.6, 0.08], [hw * 0.72 * 1.2, 0.08], [hw * 0.72 * 1.1, -0.02]], 4, brassC(seed)));
  g.in(M(0, h * 0.55, 0, 0, 45, 0), () => g.lathe([[lerp(hw, hw * 0.72, 0.55) * 1.42, -0.05], [lerp(hw, hw * 0.72, 0.55) * 1.5, -0.03], [lerp(hw, hw * 0.72, 0.55) * 1.5, 0.03], [lerp(hw, hw * 0.72, 0.55) * 1.42, 0.05]], 4, brassC(seed + 1, 0.85)));
  g.surf(K_PLAIN, 1, 0, 0.5);
  g.flat([[-hw * 0.7, h + 0.02, -hw * 0.7], [-hw * 0.7, h + 0.02, hw * 0.7], [hw * 0.7, h + 0.02, hw * 0.7], [hw * 0.7, h + 0.02, -hw * 0.7]], [0.5, 0.08, 0.01]);
  if (smog) g.in(M(0, h + 0.05, 0), () => smoke(g, hw * 1.15 * smog, 1.3 + hw * 2.2 * smog, seed, [0.025, 0.025, 0.03], [0.11, 0.11, 0.12], 6, 0.3));
}
/** a winged bull with a king's head, in low relief on the local XY plane, striding toward +X: about 1.1 long. Sculpted once. */
function wingedBull(g, s = 1, flip = false) {
  const geo = geoOnce('wingedBull', () => {
    const b = 0xb8862e, P = [], Q = (p) => p.color(b).pbr(0.42, 0.85).tint(0.2, 16);
    P.push(Q(S.ellipsoid(0.33, 0.17, 0.07).at(-0.02, 0.52, 0.02)));
    P.push(Q(S.sphere(0.19).scale(1).at(0.26, 0.58, 0)).blend(0.05));
    for (const [x, x2] of [[-0.3, -0.34], [-0.17, -0.14], [0.2, 0.17], [0.33, 0.37]]) { P.push(Q(S.capsule([x, 0.45, 0.02], [x2, 0.06, 0.03], 0.062, 0.045)).blend(0.03)); P.push(Q(S.box(0.11, 0.06, 0.08, 0.015).at(x2 + 0.01, 0.03, 0.03)).blend(0.01)); }
    P.push(Q(S.capsule([0.3, 0.7, 0.01], [0.34, 0.88, 0.02], 0.1, 0.085)).blend(0.04));
    P.push(Q(S.sphere(0.1).at(0.36, 0.96, 0.02)).blend(0.03));
    P.push(Q(S.box(0.13, 0.2, 0.07, 0.03).at(0.42, 0.8, 0.03)).blend(0.02).bump(0.006, 40, 'ridges'));
    P.push(Q(S.cyl(0.095, 0.2, 0.02).at(0.35, 1.11, 0.02)).blend(0.015));
    P.push(Q(S.torus(0.097, 0.018).at(0.35, 1.03, 0.02)).blend(0.006));
    P.push(S.sphere(0.014).at(0.43, 0.98, 0.085).color(0x1a1408).cut(0.004));
    P.push(Q(S.capsule([0.4, 1.0, 0.03], [0.46, 0.93, 0.04], 0.022, 0.016)).blend(0.01));
    // the wing: three tiers of feathers swept back and up
    for (let i = 0; i < 3; i++) P.push(Q(S.ellipsoid(0.36 - i * 0.05, 0.085, 0.035).rot(0, 0, -16 - i * 9).at(-0.1 - i * 0.03, 0.78 + i * 0.13, 0.05 - i * 0.012)).blend(0.012));
    for (let i = 0; i < 9; i++) P.push(S.box(0.012, 0.5, 0.1, 0.002).rot(0, 0, 62 - i * 3).at(-0.34 + i * 0.065, 0.92, 0.07).color(0x4a3410).cut(0.006));
    P.push(...S.limb([[-0.33, 0.56, 0.02], [-0.42, 0.42, 0.02], [-0.4, 0.2, 0.03]], [0.035, 0.028, 0.04]).map((p) => Q(p).blend(0.015)));
    P.push(S.box(1.4, 1.4, 0.2, 0).at(0, 0.6, -0.1).color(0x3a2a10).cut(0.004));
    return buildPartGeometry({ prims: P }, { res: 60 * qual(), ao: 0.85 });
  });
  const k = [g.kind, g.rough, g.metal]; g.kind = K_PLAIN;
  g.in(new THREE.Matrix4().makeScale(flip ? -s : s, s, s), () => g.add(geo));
  [g.kind, g.rough, g.metal] = k;
}
function forgeZiggurat(g) {
  g.moss = 0;
  const T = [[2.72, 0, 1.6], [2.12, 1.6, 3.0], [1.52, 3.0, 4.2], [0.98, 4.2, 5.2]], floor = [0.03, 0.028, 0.032];
  pad(g, 6, 6, 0.04, rgb(0x262224), 801, { nu: 48, nv: 6 });
  T.forEach(([hw, y0, y1], k) => {
    const st = ashBrick(810 + k * 9, { cell: 0.36 / qual(), len: [0.42, 0.74] }), n0 = g.n, r = st.r;
    stoneBox(g, hw, hw, y0, y1, st, 811 + k * 9, { noFoot: k > 0, holes: k === 0 ? [[[hw - r - 0.9, 0, hw - r + 0.9, 1.2]], null, null, null] : null });
    refinish(g, n0, 0.42);
    g.surf(K_STONE, 0.6);
    g.flat([[-hw, y1 - 0.004, -hw], [-hw, y1 - 0.004, hw], [hw, y1 - 0.004, hw], [hw, y1 - 0.004, -hw]], floor);
    // a brass band below the battlements, and the stepped battlements themselves
    for (let s = 0; s < 4; s++) g.in(M(0, y1, 0, 0, s * 90, 0).multiply(M(0, 0, hw)), () => {
      g.surf(K_PLAIN, 0.38, 0.9);
      g.in(M(0, -0.13, 0.012), () => g.beam(2 * hw + 0.05, 0.11, 0.03, 0.01, brassC(k + s), Math.round(hw * 5)));
      g.surf(K_STONE, 0.45);
      const nm = Math.round((2 * hw) / 0.44), skip = s === 0 && k < 3;
      for (let i = 0; i < nm; i++) { const x = -hw + ((i + 0.5) * 2 * hw) / nm; if (skip && Math.abs(x) < 0.62) continue; g.in(M(x, 0, -0.07), () => prism(g, MERLON.step(0.3, 0.32), 0.13, mul(ASH_BRICK[(i + s + k) % 8], 1.1), [0, 0.1])); }
      // glowing vents with brass surrounds on the upper tiers; brass plates between them
      if (k > 0 && k < 3) { const nv = k === 1 ? 4 : 2; for (let i = 0; i < nv; i++) { const x = (i - (nv - 1) / 2) * (k === 1 ? 0.98 : 1.5); if (s === 0 && Math.abs(x) < 0.7) continue; g.in(M(x, -(y1 - y0) + 0.3, 0.01), () => archFrame(g, 0.3, 0.62, 'round', brassC(i), { kind: K_PLAIN, rough: 0.38, metal: 0.9, t: 0.04, fill: [0.85, 0.13, 0.012], fillGlow: 0.55 })); } }
      if (k === 1 && s > 0) for (const x of [0]) g.in(M(x, -0.74, 0.004), () => plate(g, 0.36, 0.7, brassC(s, 0.9), { rough: 0.4, metal: 0.9, rivet: mul(BRASS, 1.3) }));
    });
  });
  // the furnace mouth in the lowest tier: a brass-jawed maw, fire far back in it
  const hw = T[0][0];
  g.in(M(0, 0, hw), () => {
    g.surf(K_PLAIN, 1);
    for (const e of [-1, 1]) g.flat([[e * 0.9, 0, 0], [e * 0.9, 1.2, 0], [e * 0.8, 1.2, -0.7], [e * 0.8, 0, -0.7]], [[0.25, 0.04, 0.01], [0.08, 0.02, 0.01], [0.3, 0.05, 0.01], [0.5, 0.08, 0.01]]);
    g.flat([[-0.9, 1.2, 0], [0.9, 1.2, 0], [0.8, 1.2, -0.7], [-0.8, 1.2, -0.7]], [0.06, 0.015, 0.01]);
    g.surf(K_PLAIN, 1, 0, 0.9);
    g.in(M(0, 0, -0.7), () => g.sheet(nq(14), nq(10), (u, v) => [(u - 0.5) * 1.6, v * 1.2, 0], lavaC(g, 5, 0.95)));
    g.in(M(0, 0.03, -0.7), () => g.sheet(nq(12), nq(6), (u, v) => [(u - 0.5) * lerp(1.6, 1.3, v), 0.02 * Math.sin(u * 20), v * 0.92], lavaC(g, 9, 0.85)));
    g.glow = 0;
    // jambs, lintel and teeth of brass
    g.surf(K_PLAIN, 0.38, 0.9);
    for (const e of [-1, 1]) g.in(M(e * 0.98, 0.66, 0.05), () => g.beam(0.2, 1.36, 0.16, 0.025, brassC(e + 2), 1));
    g.in(M(0, 1.36, 0.06), () => g.beam(2.3, 0.26, 0.18, 0.03, brassC(7), 10));
    g.in(M(0, 1.52, 0.07), () => g.beam(2.5, 0.08, 0.22, 0.02, brassC(8, 1.15), 10));
    for (let i = 0; i < 7; i++) g.in(M((i - 3) * 0.24, 1.24, 0.06, 0, 0, 180), () => prism(g, [[-0.09, 0], [0.09, 0], [0, 0.34 - 0.06 * (i % 2)]], 0.1, brassC(i, 1.1), [0, 0.08]));
    for (let i = 0; i < 6; i++) g.in(M((i - 2.5) * 0.28, 0, 0.1), () => prism(g, [[-0.08, 0], [0.08, 0], [0, 0.22]], 0.1, brassC(i + 9, 1.05), [0, 0.06]));
    // the winged bulls that guard it
    for (const e of [-1, 1]) g.in(M(e * 1.9, 0.14, 0.0), () => {
      g.surf(K_STONE, 0.5); g.in(M(0, 0.62, 0.02), () => g.cbox(1.36, 1.34, 0.05, 0.015, stoneTint([0.035, 0.03, 0.035], e, 5)));
      g.surf(K_PLAIN, 0.38, 0.9); for (const y of [-0.06, 1.3]) g.in(M(0, y, 0.05), () => g.beam(1.44, 0.07, 0.07, 0.014, brassC(y + e), 6));
      g.in(M(e * 0.02, -0.02, 0.045), () => wingedBull(g, 1.05, e > 0));
    });
  });
  // lava runs down the middle of the front in a brass-kerbed chute, a flight of steps either side of it
  for (let k = 0; k < 3; k++) {
    const [h0, , y0] = T[k], [h1, , y1] = T[k + 1], run = h0 - h1, rise = y1 - y0, n = 6;
    for (const e of [-1, 1]) for (let i = 0; i < n; i++) { g.surf(K_STONE, 0.5); g.in(M(e * 0.38, y0 + ((i + 1) * rise) / n / 2, h0 - ((i + 0.5) * run) / n), () => g.cbox(0.4, ((i + 1) * rise) / n, run / n + 0.004, 0.012, mul(ASH_BRICK[(i + k) % 8], 1.25))); }
    g.surf(K_PLAIN, 0.38, 0.9);
    for (const e of [-1, 1]) for (const x of [0.15, 0.6]) g.beamTo([e * x, y0 + 0.1, h0 + 0.02], [e * x, y1 + 0.1, h1 + 0.02], 0.2, 0.06, 0.012, brassC(k + e + x), 3);
    g.surf(K_PLAIN, 0.8, 0, 0.9);
    g.sheet(4, nq(10), (u, v) => [(u - 0.5) * 0.26, lerp(y0 + 0.06, y1 + 0.06, v) + 0.02 * Math.sin(v * 15), lerp(h0 + 0.03, h1 + 0.03, v)], lavaC(g, k * 3 + 1, 0.9));
    g.glow = 0;
  }
  g.surf(K_PLAIN, 0.8, 0, 0.9);
  g.sheet(4, 4, (u, v) => [(u - 0.5) * 0.26, lerp(1.66, 1.5, v), lerp(2.75, 2.92, v * v)], lavaC(g, 2, 0.9));
  g.glow = 0;
  // the forge-shrine on top: a brick block with a fiery arch in each face, the great stack rising out of it
  const top = T[3][2];
  { const st = ashBrick(880, { cell: 0.36 / qual(), len: [0.3, 0.5] }), n0 = g.n; stoneBox(g, 0.62, 0.62, top, top + 0.8, st, 881, { noFoot: true }); refinish(g, n0, 0.42); }
  for (let s = 0; s < 4; s++) g.in(M(0, top, 0, 0, s * 90, 0).multiply(M(0, 0, 0.63)), () => { archFrame(g, 0.5, 0.64, 'round', brassC(s), { kind: K_PLAIN, rough: 0.38, metal: 0.9, t: 0.05, fill: [0.9, 0.14, 0.012], fillGlow: 0.6 }); g.surf(K_PLAIN, 0.5, 0.85); for (const x of [-0.12, 0, 0.12]) g.in(M(x, 0.26, 0.02), () => g.cbox(0.025, 0.5, 0.025, 0.005, IRON)); });
  g.surf(K_PLAIN, 0.38, 0.9);
  g.in(M(0, top + 0.8, 0, 0, 45, 0), () => g.lathe([[0.86, 0], [0.98, 0.04], [0.98, 0.1], [0.7, 0.2], [0.56, 0.2]], 4, brassC(3)));
  g.in(M(0, top + 0.98, 0), () => stack(g, 0.4, 1.75, 5, 1.0));
  T.slice(1, 3).forEach(([hw2, , y1], k) => { for (const e of [-1, 1]) for (const f of [-1, 1]) g.in(M(e * (hw2 - 0.3), y1, f * (hw2 - 0.3)), () => stack(g, 0.2 - k * 0.03, 1.5 - k * 0.3, e * 2 + f + k * 5, f < 0 || k ? 1 : 0.8)); });
  // braziers and slag at the foot
  for (const e of [-1, 1]) g.in(M(e * 1.15, 0.03, 2.86), () => g.in(M(0, 0, 0, 0, 0, 0, 0.5), () => fireBowl(g, 1, FIRE_DEEP, mul(BRASS, 0.6), e, 0.8)));
}
function blastFurnace(g) {
  g.moss = 0;
  pad(g, 3, 3, 0.05, (x, y, z) => mul(rgb(0x2a2524), 0.6 + 0.7 * fbm3(x * 3, y * 5, z * 3, 3)), 901);
  const cx = -0.36, cz = -0.38, D = [[0.96, 0, 1.4], [0.82, 1.4, 2.8], [0.68, 2.8, 4.0]];
  g.in(M(cx, 0, cz), () => {
    D.forEach(([R, y0, y1], k) => {
      const st = ashBrick(910 + k, { course: 0.14, len: [0.24, 0.38], cell: 0.3 / qual(), pal: [...ASH_BRICK, rgb(0x4a2a20), rgb(0x3a2420)] }), n0 = g.n;
      g.surf(K_STONE, 0.9);
      g.in(M(0, y0, 0), () => g.bend(R - st.r, () => g.ashlar((R - st.r) * TAU, y1 - y0, { ...st, wrap: true })));
      refinish(g, n0, 0.55);
      if (k === 0) footing(g, 0, 0, st.pal[0]);
      // the ledge where it steps in is cased in brass
      g.surf(K_PLAIN, 0.38, 0.9);
      if (k < 2) g.lathe([[R + 0.03, y1 - 0.1], [R + 0.05, y1 - 0.06], [R + 0.03, y1], [D[k + 1][0] + 0.03, y1 + 0.12], [D[k + 1][0], y1 + 0.14]], nq(28), brassC(k));
      g.in(M(0, lerp(y0, y1, 0.42), 0), () => brassBand(g, R, 0.16, k));
      for (let i = 0; i < 6; i++) g.in(M(0, 0, 0, 0, i * 60 + k * 30, 0).multiply(M(0, (y0 + y1) / 2, R + 0.02)), () => g.cbox(0.09, y1 - y0 - 0.1, 0.035, 0.01, brassC(i + k * 6, 0.85)));
    });
    // the throat: a brass crown, fire in it, smoke out of it
    g.surf(K_PLAIN, 0.38, 0.9);
    g.lathe([[0.7, 3.92], [0.78, 4.0], [0.8, 4.2], [0.72, 4.32], [0.56, 4.32], [0.5, 4.1]], nq(24), brassC(5));
    for (let i = 0; i < 8; i++) g.in(M(0, 4.3, 0, 0, i * 45, 0).multiply(M(0, 0, 0.66, 30, 0, 0)), () => thorn(g, 0.34, 0.05, brassC(i), { metal: 0.9, rough: 0.38, m: 4 }));
    g.surf(K_PLAIN, 1, 0, 0.9);
    g.in(M(0, 4.14, 0), () => g.sheet(nq(16), 3, (u, v) => { const a = u * TAU; return [Math.cos(a) * 0.52 * v, 0.03 * Math.sin(a * 5), Math.sin(a) * 0.52 * v]; }, lavaC(g, 3, 0.9), true));
    g.glow = 0;
    g.in(M(0, 4.1, 0), () => fire(g, 0.9, FIRE_DEEP, 2, 0.8));
    g.in(M(0, 4.75, 0), () => smoke(g, 0.34, 1.7, 4, [0.025, 0.025, 0.03], [0.12, 0.12, 0.13], 6, 0.3));
    // a blast main of copper round its waist, dropping to the tuyeres
    g.surf(K_PLAIN, 0.4, 0.85);
    g.in(M(0, 1.02, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(1.12, 0.06, nq(8), nq(36)), (x, y, z) => mul(mix(COPPER, VERDIGRIS, 0.5 * smooth(0.5, 0.75, noise3(x * 5, y * 5, z * 5))), 0.8)));
    for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.5; pipe(g, [[Math.cos(a) * 1.12, 1.02, Math.sin(a) * 1.12], [Math.cos(a) * 1.1, 0.6, Math.sin(a) * 1.1], [Math.cos(a) * 0.95, 0.4, Math.sin(a) * 0.95]], 0.04, mul(COPPER, 0.8), { every: 2 }); }
    // tapping arches at its foot
    for (const ang of [0]) g.in(M(0, 0, 0, 0, ang, 0).multiply(M(0, 0, 0.975)), () => { archFrame(g, 0.5, 0.62, 'round', brassC(ang), { kind: K_PLAIN, rough: 0.38, metal: 0.9, t: 0.055, fill: [0.9, 0.14, 0.012], fillGlow: 0.6 }); });
  });
  // the runner: molten iron down a stone channel to the casting bed
  const runner = (a, b, seed) => { const f = along(a, b); g.in(f.m, () => { g.surf(K_STONE, 0.9); for (const e of [-1, 1]) g.in(M(0, 0, e * 0.11), () => g.beam(f.L, 0.12, 0.07, 0.015, stoneTint([0.1, 0.09, 0.09], seed + e, 6), 3)); g.surf(K_PLAIN, 0.6, 0, 0.9); g.in(M(0, 0.03, 0), () => g.sheet(nq(8), 2, (u, v) => [(u - 0.5) * f.L, 0.006 * Math.sin(u * 30), (v - 0.5) * 0.16], lavaC(g, seed, 0.9))); g.glow = 0; }); };
  runner([cx, 0.07, cz + 0.95], [cx + 0.02, 0.05, 0.98], 1);
  g.in(M(cx + 0.02, 0.02, 1.2), () => {
    g.surf(K_STONE, 0.95); g.in(M(0, 0.03, 0), () => g.cbox(1.0, 0.1, 0.46, 0.02, stoneTint([0.16, 0.13, 0.1], 3, 6)));
    g.surf(K_PLAIN, 0.6, 0, 0.9);
    g.in(M(0, 0.085, -0.17), () => g.sheet(nq(8), 1, (u, v) => [(u - 0.5) * 0.9, 0, (v - 0.5) * 0.08], lavaC(g, 4, 0.9)));
    for (let i = 0; i < 5; i++) g.in(M(-0.36 + i * 0.18, 0.085, 0.03), () => { const cool = i / 4; g.glow = 0.9 * (1 - cool * 0.8); g.sheet(1, 3, (u, v) => [(u - 0.5) * 0.1, 0, (v - 0.5) * 0.32], mix([1.0, 0.3, 0.03], [0.2, 0.05, 0.03], cool)); });
    g.glow = 0;
  });
  // the bellows: boards, pleated hide, a brass nozzle into the furnace, a pole to work it
  g.in(M(cx + 0.78, 0, cz + 0.1, 0, 8, 0, 0.66), () => {
    const wd = woodTint(rgb(0x5a4026), 3);
    g.surf(K_WOOD, 0.9);
    for (const [x, z] of [[0.35, 0.2], [0.35, -0.2], [0.95, 0.22], [0.95, -0.22]]) g.in(M(x, 0.3, z), () => g.cbox(0.07, 0.62, 0.07, 0.012, wd));
    g.in(M(0.65, 0.5, 0), () => g.cbox(0.8, 0.05, 0.56, 0.012, wd));
    const board = (y, tilt) => g.in(M(0.34, y, 0, 0, 0, tilt), () => g.in(M(0.36, 0, 0), () => prism3(g, 0.72, 0.035, 0.5, wd)));
    board(0.55, 0); board(0.57, 24);
    g.surf(K_CLOTH, 0.9);
    g.sheet(nq(20), 8, (u, v) => { const a = u * TAU, t = Math.max(0, Math.cos(a) * 0.5 + 0.5), px = 0.36 + 0.72 * (0.5 + 0.5 * Math.cos(a)) * 0.98, pz = Math.sin(a) * 0.25 * (0.4 + 0.6 * (px - 0.34) / 0.72 + 0.2), open = (px - 0.34) * Math.tan(24 * DEG); return [px + (v % 0.25 > 0.12 ? 0.02 : -0.01) * Math.cos(a), 0.57 + v * open, pz * (1 + (Math.round(v * 8) % 2 ? 0.14 : 0))]; }, (x, y, z, nx, ny, nz, u, v) => mul(HIDE_DARK, (Math.round(v * 8) % 2 ? 1.0 : 0.6) * (0.8 + 0.3 * noise3(x * 9, y * 9, z * 9))), true);
    g.surf(K_PLAIN, 0.38, 0.9);
    g.in(M(0.3, 0.56, 0, 0, 0, 90), () => g.lathe([[0.07, 0], [0.05, 0.12], [0.03, 0.4], [0.035, 0.42]], nq(10), brassC(3)));
    g.surf(K_WOOD, 0.9);
    g.beamTo([1.02, 0.9, 0], [1.5, 1.25, 0.0], 0.05, 0.05, 0.01, wd, 2);
    for (const z of [-1, 1]) g.in(M(1.2, 0.5, z * 0.3), () => g.cbox(0.06, 1.1, 0.06, 0.01, wd));
  });
  // a slag heap, still warm in places
  g.in(M(1.02, 0, -1.08), () => { const hot = (x, y, z) => { const e = smooth(0.7, 0.82, noise3(x * 6, y * 6, z * 6)); g.glow = 0.8 * e; return mix(mul([0.09, 0.085, 0.09], 0.5 + 0.9 * fbm3(x * 5, y * 5, z * 5, 2)), [0.9, 0.2, 0.02], e); }; pad(g, 0.9, 0.8, 0.34, hot, 9, { kind: K_PLAIN, nu: 30, nv: 8, sq: 2.4 }); g.glow = 0; for (let i = 0; i < 5; i++) g.in(M(Math.cos(i * 1.4) * 0.3, 0.05 + 0.05 * (i % 2), Math.sin(i * 1.4) * 0.26, i * 30, i * 50, 0), () => boulder(g, 0.1, 0.08, 0.09, 30 + i, [0.07, 0.065, 0.07], nq(12))); });
  // a length of brass-plated rail and an ore cart on it
  g.in(M(0.72, 0.03, 1.22), () => {
    g.surf(K_WOOD, 0.9);
    for (let i = 0; i < 6; i++) g.in(M(-0.62 + i * 0.25, 0.025, 0, 0, 90 + (hash1(i, 3) - 0.5) * 6, 0), () => g.beam(0.44, 0.05, 0.1, 0.01, woodTint(rgb(0x3a2a1e), i), 1));
    g.surf(K_PLAIN, 0.38, 0.9);
    for (const e of [-1, 1]) { g.in(M(0, 0.085, e * 0.15), () => g.beam(1.5, 0.07, 0.045, 0.012, brassC(e, 1.1), 8)); for (let i = 0; i < 6; i++) g.in(M(-0.62 + i * 0.25, 0.06, e * 0.185, -90, 0, 0), () => g.stud(0.016, IRON, 5)); }
    g.in(M(0.12, 0.12, 0), () => {
      g.surf(K_PLAIN, 0.5, 0.85);
      for (const x of [-0.17, 0.17]) { g.in(M(x, 0.08, 0, 90, 0, 0), () => g.in(M(0, -0.19, 0), () => g.cyl(0.018, 0.018, 0.38, 6, IRON, true, true))); for (const e of [-1, 1]) g.in(M(x, 0.08, e * 0.15, 90, 0, 0), () => g.in(M(0, -0.02, 0), () => g.lathe([[0, 0], [0.085, 0], [0.085, 0.03], [0.1, 0.03], [0.1, 0.04], [0, 0.04]], nq(12), [0.06, 0.058, 0.06]))); }
      g.surf(K_PLAIN, 0.6, 0.7);
      g.in(M(0, 0.17, 0, 0, 45, 0), () => g.lathe([[0.2, 0], [0.33, 0.3], [0.35, 0.3], [0.35, 0.33], [0.3, 0.33], [0.18, 0.04], [0, 0.04]], 4, (x, y, z) => mul(mix([0.07, 0.065, 0.07], RUST, 0.5 * smooth(0.4, 0.7, noise3(x * 9, y * 9, z * 9))), 0.9)));
      g.surf(K_PLAIN, 0.38, 0.9); g.in(M(0, 0.49, 0, 0, 45, 0), () => g.lathe([[0.345, -0.02], [0.37, 0], [0.345, 0.02]], 4, brassC(4)));
      for (let i = 0; i < 9; i++) g.in(M((hash1(i, 5) - 0.5) * 0.34, 0.47 + 0.07 * hash1(i, 9), (hash1(i, 7) - 0.5) * 0.3, i * 40, i * 70, 0), () => { g.surf(K_PLAIN, 0.6, 0.3); g.add(new THREE.IcosahedronGeometry(0.07 + 0.03 * hash1(i, 11), 0), mul(i % 3 ? [0.16, 0.1, 0.08] : [0.35, 0.16, 0.08], 0.8 + 0.4 * hash1(i, 13))); });
    });
  });
}
/** a plain board along X: L x h x d, centred */
function prism3(g, L, h, d, c) { g.beam(L, h, d, 0.008, c, 3); }

// =====================================================================================================
// Greenhide: hacked timber, scrap iron and trophies
// =====================================================================================================
const GH_WOOD = [rgb(0x6b5236), rgb(0x7a6040), rgb(0x54422c), rgb(0x5c5434), rgb(0x7a4a2c)], GH_RED = rgb(0xa8281c), GH_WHITE = rgb(0xe6dcc0);
function idol(g) {
  g.moss = 0.6;
  pad(g, 2, 2, 0.08, rgb(0x54432e), 1001);
  g.surf(K_WOOD, 0.9);
  g.add(geoOnce('ghIdol', () => {
    const wood = 0x6e5234, red = 0xa8281c, white = 0xe6dcc0, dark = 0x1a120c, P = [];
    const W = (p) => p.color(wood).tint(0.18, 7);
    P.push(W(S.cone(0.68, 0.52, 4.5, 0.1).at(0, 2.25, 0)).bump(0.012, 14, 'ridges'));
    for (let i = 0; i < 5; i++) { const a = i * 1.257 + 0.9; P.push(W(S.capsule([Math.cos(a) * 0.4, 0.55, Math.sin(a) * 0.4], [Math.cos(a) * 0.86, -0.02, Math.sin(a) * 0.86], 0.24, 0.12)).blend(0.12)); }
    // the face: an overhanging brow, sunk eyes, a slab of a nose, a leering mouth with a jutting jaw
    P.push(W(S.box(1.16, 0.34, 0.5, 0.12).rot(-12, 0, 0).at(0, 3.42, 0.4)).blend(0.07));
    P.push(...S.mirrorX([W(S.ellipsoid(0.24, 0.3, 0.18).at(0.44, 2.6, 0.36)).blend(0.09)]));
    P.push(W(S.box(1.12, 0.3, 0.42, 0.1).at(0, 1.5, 0.46)).blend(0.07));
    P.push(...S.mirrorX([S.ellipsoid(0.2, 0.15, 0.2).at(0.27, 3.08, 0.52).color(dark).cut(0.03)]));
    P.push(...S.mirrorX([S.sphere(0.1).at(0.27, 3.06, 0.46).color(white).blend(0.006), S.sphere(0.045).at(0.275, 3.05, 0.545).color(0xc81e10).glow(0.5).blend(0.004)]));
    P.push(W(S.capsule([0, 3.2, 0.48], [0, 2.62, 0.74], 0.12, 0.2)).blend(0.05));
    P.push(...S.mirrorX([S.sphere(0.055).at(0.09, 2.52, 0.86).color(dark).cut(0.015)]));
    P.push(S.box(0.98, 0.5, 0.5, 0.1).at(0, 2.02, 0.55).color(0x2a0c08).cut(0.04));
    P.push(...S.mirrorX([S.ellipsoid(0.16, 0.2, 0.3).rot(0, 0, -30).at(0.52, 2.28, 0.5).color(0x2a0c08).cut(0.04)]));
    P.push(...S.mirrorX([S.cone(0.1, 0.02, 0.66, 0.01).rot(0, 0, -7).at(0.4, 2.08, 0.66).color(0xe2d8b8).blend(0.01)]));
    P.push(...S.mirrorX([W(S.box(0.12, 0.62, 0.36, 0.05).rot(0, 20, -14).at(0.68, 2.95, 0.02)).blend(0.04)]));
    // stub arms
    P.push(...S.mirrorX([W(S.capsule([0.5, 2.1, 0], [0.98, 2.5, 0.12], 0.17, 0.12)).blend(0.08).bump(0.01, 14, 'ridges')]));
    // splintered crown
    for (let i = 0; i < 5; i++) { const a = i * 1.257 + 0.3; P.push(W(S.cone(0.17, 0.03, 0.7 + 0.25 * (i % 2), 0.02).rot(Math.sin(a) * 10, 0, -Math.cos(a) * 10).at(Math.cos(a) * 0.3, 4.7 + 0.1 * (i % 2), Math.sin(a) * 0.3)).blend(0.05)); }
    // war paint: a red mask, white slashes on the cheeks, a ring and teeth on the belly, red hands on the roots
    P.push(S.box(1.5, 0.3, 1.2, 0.05).at(0, 3.08, 0.3).color(red).paint(0.02, 0));
    for (const e of [-1, 1]) for (let i = 0; i < 3; i++) P.push(S.box(0.06, 0.36, 0.5, 0.01).rot(0, 0, e * -24).at(e * (0.3 + i * 0.12), 2.62, 0.5).color(white).paint(0.008, 0));
    P.push(S.torus(0.3, 0.06).rot(90, 0, 0).at(0, 0.98, 0.62).color(white).paint(0.01, 0));
    P.push(S.sphere(0.13).at(0, 0.98, 0.64).color(red).paint(0.01, 0));
    P.push(S.box(1.6, 0.1, 1.6, 0.02).at(0, 3.75, 0).color(white).paint(0.01, 0));
    P.push(S.box(1.6, 0.12, 1.6, 0.02).at(0, 0.5, 0).color(red).paint(0.01, 0));
    for (let i = 0; i < 6; i++) P.push(S.cone(0.07, 0.01, 0.2, 0.005).rot(0, 0, i % 2 ? 180 : 0).at(-0.4 + i * 0.16, 4.05, 0.5).scale(1).color(i % 2 ? red : white).paint(0.012, 0));
    return buildPartGeometry({ prims: P }, { res: 21 * qual(), ao: 0.85 });
  }));
  // scrap-iron teeth nailed into the mouth
  g.surf(K_PLAIN, 0.7, 0.6);
  for (let i = 0; i < 6; i++) { const x = (i - 2.5) * 0.14; g.in(M(x, 2.26, 0.58 + 0.03 * Math.cos(x * 3), 0, 0, 180 + (hash1(i, 3) - 0.5) * 16), () => prism(g, [[-0.065, 0], [0.065, 0], [0.01, 0.2 + 0.1 * hash1(i, 5)]], 0.025, rustCol(i), [0, 0.06])); }
  for (let i = 0; i < 5; i++) { const x = (i - 2) * 0.13; g.in(M(x, 1.66, 0.66, 0, 0, (hash1(i, 7) - 0.5) * 16), () => prism(g, [[-0.06, 0], [0.06, 0], [-0.01, 0.16 + 0.1 * hash1(i, 9)]], 0.025, rustCol(i + 9), [0, 0.05])); }
  // great horns, scrap plates on the brow and the back of the skull
  for (const e of [-1, 1]) horn(g, [[e * 0.5, 3.55, 0.05], [e * 0.86, 3.6, 0.0], [e * 1.12, 3.95, 0.02], [e * 1.12, 4.5, 0.1], [e * 0.9, 4.95, 0.2]], 0.17, rgb(0x3a3028), rgb(0xa89878), { rings: 44, nu: nq(12), nv: nq(24) });
  g.in(M(0, 3.78, 0.6, -14, 0, 3), () => scrapPlate(g, 0.62, 0.3, 3));
  g.in(M(-0.36, 1.42, 0.66, 0, -8, -6), () => scrapPlate(g, 0.34, 0.3, 5));
  for (const e of [-1, 1]) g.in(M(e * 0.58, 4.1, 0, 0, e * 90, e * 6), () => g.in(M(0, 0, 0.04), () => scrapPlate(g, 0.5, 0.44, 7 + e)));
  // a string of skulls round its neck, trophies on its arms
  const neck = []; for (let k = 0; k <= 12; k++) { const th = -0.25 + (k / 12) * (Math.PI + 0.5); neck.push([Math.cos(th) * 0.72, 1.36 - 0.2 * Math.sin((k / 12) * Math.PI), Math.sin(th) * 0.66 + 0.06]); }
  rope(g, neck, 0.016, rgb(0x8a7450));
  for (let k = 1; k < 12; k += 2) { const p = neck[k]; g.in(M(p[0] * 1.04, p[1] - 0.2, p[2] * 1.04, 4, 90 - Math.atan2(p[2], p[0]) / DEG, 0), () => skull(g, 0.95, true)); }
  for (const e of [-1, 1]) {
    g.in(M(e * 0.92, 2.3, 0.3, 0, e * 20, e * -8), () => roundShield(g, 0.3, e > 0 ? rgb(0x7a5c38) : rgb(0x5c5434), e > 0 ? GH_RED : GH_WHITE, e + 5));
    chain(g, [[e * 0.98, 2.42, 0.0], [e * 1.02, 1.9, 0.02], [e * 1.0, 1.5, 0.0]], 0.06, [0.07, 0.06, 0.055], 0.7);
    g.in(M(e * 1.0, 1.24, 0.0, 0, e * 60, 0), () => skull(g, 1.1, true));
  }
  g.in(M(-0.98, 2.46, -0.2), () => rag(g, 0.34, 0.9, GH_RED, 3, 0.5, GH_WHITE));
  // at its feet: skulls, stakes, a loot of shields
  g.in(M(0.5, 0.08, 0.8, 0, 20, 0), () => skullPile(g, 0.95, 4, 3));
  g.in(M(-0.6, 0.08, 0.78, 0, -30, 0), () => skullPile(g, 0.9, 3, 4));
  for (const [x, z, h, sd] of [[-0.88, 0.2, 1.2, 1], [0.9, 0.0, 1.0, 2], [0.86, -0.8, 1.35, 3], [-0.85, -0.82, 1.1, 4]]) g.in(M(x, 0, z, (hash1(sd, 1) - 0.5) * 14, 0, (hash1(sd, 2) - 0.5) * 14), () => skullStake(g, h, sd, rgb(0x5a4630)));
  g.in(M(0.05, 0.16, 0.9, -68, 10, 0), () => roundShield(g, 0.24, rgb(0x6b5236), GH_RED, 9));
}
function boneTower(g) {
  g.moss = 0.6;
  pad(g, 2, 2, 0.07, rgb(0x54432e), 1011);
  const feet = [[-0.74, -0.72], [0.76, -0.7], [0.72, 0.74], [-0.78, 0.72]], py = 3.3, bark = rgb(0x5a4630);
  const at = (i, y) => { const f = feet[i], t = y / 4.0; return [f[0] * (1 - 0.3 * t) + 0.05 * Math.sin(i * 2 + y), y, f[1] * (1 - 0.3 * t) + 0.05 * Math.cos(i * 3 + y)]; };
  // four wonky legs, lashed rails and braces
  for (let i = 0; i < 4; i++) {
    const f = feet[i];
    logTo(g, [f[0], -0.1, f[1]], at(i, 2.0), 0.085, 0.075, i * 3 + 1, { seg: nq(9), bark, amp: 0.16 });
    logTo(g, at(i, 1.9), at(i, 4.1 + 0.3 * hash1(i, 3)), 0.075, 0.055, i * 3 + 2, { seg: nq(9), bark, amp: 0.16 });
    g.in(M(...at(i, 1.95)), () => lashing(g, 0.09, 4, 0.016));
    const j = (i + 1) % 4;
    for (const [y, dy] of [[1.0, 0.12], [2.25, -0.1], [3.12, 0.02]]) { const a = at(i, y + dy * 0.5), b = at(j, y - dy * 0.5); logTo(g, v3(a, b, -0.1), v3(a, b, 1.1), 0.05, 0.04, i * 7 + y * 3, { seg: 7, bark, capB: true, amp: 0.16 }); g.in(M(...a), () => lashing(g, 0.085, 2, 0.013)); }
    if (i !== 2) logTo(g, at(i, 0.35), at(j, 2.2), 0.04, 0.035, i * 11 + 5, { seg: 7, bark, capB: true, amp: 0.16 });
  }
  // the ribcage of some great beast braces it: backbone up the rear, ribs wrapping round to the front
  for (let k = 0; k < 11; k++) { const y = 0.4 + k * 0.25, z = -0.66 + 0.02 * k, c = boneCol(k); g.surf(K_PLAIN, 0.7); g.in(M(0, y, z), () => { g.lathe([[0, 0], [0.085, 0], [0.1, 0.03], [0.075, 0.1], [0.1, 0.17], [0.085, 0.2], [0, 0.2]], nq(9), c); g.in(M(0, 0.1, -0.05, -75, 0, 0), () => g.cyl(0.04, 0.012, 0.22, 5, c, false, true)); }); }
  for (let k = 0; k < 5; k++) { const y = 0.95 + k * 0.48, w = 0.86 - 0.07 * k; for (const e of [-1, 1]) rib(g, [e * 0.06, y, -0.62 + 0.04 * k], [e * 0.22, y - 0.34, 0.6 - 0.05 * k], [e * w, 0.2, 0.25], 0.055, k * 2 + e); }
  // the platform and its shields of scrap
  for (const z of [-0.5, 0.5]) logTo(g, [-0.78, py - 0.09, z], [0.78, py - 0.07, z], 0.05, 0.045, z * 9 + 60, { seg: 7, bark, capB: true });
  g.in(M(0, 0, 0, 0, 90, 0), () => deck(g, -0.68, 0.68, -0.72, 0.72, py, GH_WOOD, 31, { rag: 0.16, skew: 3 }));
  const rnd = rng(1013);
  for (let s = 0; s < 4; s++) g.in(M(0, py, 0, 0, s * 90, 0).multiply(M(0, 0, 0.72)), () => {
    let x = -0.7;
    while (x < 0.55) { const w = 0.36 + 0.26 * rnd(), h = 0.46 + 0.3 * rnd(); if (s === 0 && x < -0.1 && x + w > -0.35) { x += 0.42; continue; } g.in(M(x + w / 2, h / 2 - 0.08 + 0.1 * rnd(), 0.02 * rnd(), (rnd() - 0.5) * 8, 0, (rnd() - 0.5) * 12), () => scrapPlate(g, w, h, s * 10 + x * 7)); x += w * 0.92; }
    g.surf(K_WOOD, 0.9); g.in(M(0, 0.4, -0.03, 0, 0, (rnd() - 0.5) * 4), () => g.beam(1.5, 0.05, 0.04, 0.01, woodTint(GH_WOOD[s], s), 3));
    if (s === 1) g.in(M(0.1, 0.36, 0.06, 0, 0, 14), () => roundShield(g, 0.27, rgb(0x6b5236), GH_RED, 5));
    if (s === 3) g.in(M(-0.1, 0.34, 0.06, 0, 0, -10), () => roundShield(g, 0.25, rgb(0x5c5434), GH_WHITE, 6));
    for (let i = 0; i < 3; i++) g.in(M(-0.5 + i * 0.5, -0.06, 0.02, 115 + 20 * rnd(), 0, (rnd() - 0.5) * 20), () => stake(g, 0.03, 0.4 + 0.15 * rnd(), s * 5 + i, bark));
  });
  // a hide awning on the leg tops, a horned skull and tusks over the front
  hideSheet(g, 14, 14, (u, v) => { const a = v3(at(3, 4.2), at(2, 4.05), u), b = v3(at(0, 4.3), at(1, 4.15), u), p = v3(a, b, v); return [p[0] * 1.25, p[1] - 0.22 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + 0.03 * Math.sin(u * 20), p[2] * 1.25]; }, HIDE, 71);
  g.in(M(0.0, py + 0.78, 0.74, -8, 0, 0), () => horned(g, 1.5, 3));
  for (const e of [-1, 1]) g.in(M(e * 0.5, py + 0.1, 0.76, 0, e > 0 ? 180 : 0, 0), () => g.in(M(0, 0, 0, -10, 0, -12), () => horn(g, [[0, -0.1, 0], [0.03, 0.3, 0], [0.14, 0.62, 0], [0.32, 0.86, 0]], 0.07, mul(BONE, 1.05), rgb(0x8a7a5a), { rings: 24, nu: 8, nv: 14 })));
  // the glyph banner on its own long pole
  g.in(M(-0.56, py - 0.3, -0.5, -3, 0, 5), () => {
    stake(g, 0.035, 2.95, 77, bark);
    logTo(g, [-0.05, 2.6, 0.04], [0.62, 2.66, 0.04], 0.022, 0.018, 78, { seg: 6, capB: true });
    g.in(M(0.3, 2.62, 0.05), () => rag(g, 0.54, 1.15, GH_RED, 6, 0.45));
    g.in(M(0.3, 2.2, 0.1), () => { teethGlyph(g, 0.36, 1.0, GH_WHITE, 4); g.in(M(0, -0.34, 0.02), () => sigil(g, 1020, 0.34, [0.9, 0.86, 0.75], 0, 0.07)); });
    g.in(M(0, 2.82, 0), () => skull(g, 1.0, true));
  });
  // the ladder, skulls on stakes
  ladder(g, [0.3, 0.02, 0.98], [0.26, py + 0.2, 0.74], 0.32, 5, RAW_WOOD);
  for (const [x, z, h, sd] of [[-0.9, 0.9, 1.1, 1], [0.92, 0.92, 0.9, 2], [0.9, -0.2, 1.2, 3]]) g.in(M(x, 0, z, (hash1(sd, 1) - 0.5) * 14, 0, (hash1(sd, 2) - 0.5) * 14), () => skullStake(g, h, sd + 5, bark));
  g.in(M(-0.4, 0.07, 0.86, 0, 30, 0), () => skullPile(g, 0.9, 3, 9));
}

// =====================================================================================================
// Skar: scavenged timber, patched copper and blight-stone
// =====================================================================================================
const SKAR_WOOD = [rgb(0x5a4a36), rgb(0x6a5a40), rgb(0x4a3e2e), rgb(0x54502f), rgb(0x6e5038)], SKAR_RAG = [rgb(0x7a2a22), rgb(0x8a7a34), rgb(0x4a5a44), rgb(0x5a4a5a)];
const blightLamp = (g, s = 1) => lamp(g, s, [0.14, 0.85, 0.05], { shape: 'cage', glow: 0.75, frame: [0.07, 0.06, 0.05] });
/** a crooked pole from a to b */
const pole = (g, a, b, r, seed) => logTo(g, a, b, r, r * 0.8, seed, { seg: 7, bark: mul(SKAR_WOOD[Math.floor(hash1(seed, 3) * 5)], 0.85), amp: 0.16, capB: true });
function reactor(g) {
  g.moss = 0.2;
  pad(g, 3, 3, 0.06, (x, y, z) => mix(mul(rgb(0x3a3428), 0.6 + 0.7 * fbm3(x * 3, y * 5, z * 3, 3)), [0.1, 0.3, 0.05], 0.6 * smooth(0.9, 0.2, Math.hypot(x, z))), 1101);
  const cy = 2.4, R = 1.0;
  // the boiler: a ball of patched plate, the blight showing green through its cracks
  const plateC = (x, y, z, nx, ny, nz, u, v) => {
    const row = Math.floor(v * 7), cu = u * (row === 0 || row === 6 ? 5 : 10) + hash1(row, 3), col = Math.floor(cu), h = hash1(col, row, 7), fu = cu - col, fv = v * 7 - row, edge = Math.min(fu, 1 - fu, fv, 1 - fv);
    const base = h < 0.42 ? COPPER : h < 0.62 ? mix(COPPER, VERDIGRIS, 0.7) : h < 0.85 ? [0.09, 0.085, 0.09] : RUST;
    const crack = smooth(0.016, 0.004, Math.abs(noise3(x * 2.1 + 3, y * 2.1, z * 2.1) - 0.5)) * smooth(0.4, 0.6, noise3(x * 0.8, y * 0.8 + 7, z * 0.8));
    g.glow = 0.8 * crack; g.metal = h < 0.62 ? 0.85 : 0.6; g.rough = h < 0.42 ? 0.4 : 0.65;
    return crack > 0.05 ? mix(mul(base, 0.5), [0.15, 0.85, 0.06], crack) : mul(base, (edge < 0.035 ? 0.4 : 1) * (0.7 + 0.5 * noise3(x * 9, y * 9, z * 9)));
  };
  g.surf(K_PLAIN, 0.5, 0.8);
  g.in(M(0, cy, 0), () => g.sheet(nq(48), nq(28), (u, v) => { const a = u * TAU, b = (v - 0.5) * Math.PI, row = Math.floor(v * 7), cu = u * (row === 0 || row === 6 ? 5 : 10) + hash1(row, 3), lift = 0.012 * hash1(Math.floor(cu), row, 9); const r = R + lift; return [Math.cos(a) * Math.cos(b) * r, Math.sin(b) * r, Math.sin(a) * Math.cos(b) * r]; }, plateC, true));
  g.surf(K_PLAIN, 0.5, 0.85);
  for (let row = 1; row < 7; row++) { const b = (row / 7 - 0.5) * Math.PI, n = nq(22); for (let i = 0; i < n; i++) { const a = (i / n) * TAU + row; g.in(M(0, cy, 0, 0, 90 - a / DEG, 0).multiply(M(0, Math.sin(b) * (R + 0.012), Math.cos(b) * (R + 0.012), -b / DEG, 0, 0)), () => g.stud(0.02, [0.12, 0.1, 0.08], 5)); } }
  // portholes
  for (const [ang, el] of [[10, 8], [100, 14], [190, 6], [275, 16]]) g.in(M(0, cy, 0, 0, ang, 0).multiply(M(0, Math.sin(el * DEG) * R, Math.cos(el * DEG) * R * 0.99, -el, 0, 0)), () => {
    g.surf(K_PLAIN, 0.35, 0.9); g.add(new THREE.TorusGeometry(0.2, 0.045, 6, nq(18)), brassC(ang));
    for (let k = 0; k < 8; k++) g.in(M(Math.cos(k * 0.785) * 0.2, Math.sin(k * 0.785) * 0.2, 0.04), () => g.stud(0.018, mul(BRASS, 1.3), 5));
    g.surf(K_PLAIN, 0.15, 0, 0.6); g.in(M(0, 0, 0.0, 90, 0, 0), () => g.lathe([[0.17, 0.02], [0.12, 0.05], [0, 0.065]], nq(14), (x, y, z) => mul([0.12, 0.8, 0.05], 0.6 + 0.5 * noise3(x * 20, y * 20, z * 20 + ang))));
    g.surf(K_PLAIN, 0.5, 0.85); for (const rz of [0, 90]) g.in(M(0, 0, 0.06, 0, 0, rz), () => g.cbox(0.36, 0.022, 0.02, 0.005, IRON));
  });
  // the firebox under it, a green pool below that
  g.surf(K_PLAIN, 0.6, 0.75);
  g.lathe([[0.3, 0.72], [0.36, 0.78], [0.4, 1.2], [0.6, 1.62]], nq(14), (x, y, z) => mul(mix([0.08, 0.075, 0.08], RUST, 0.6 * smooth(0.4, 0.7, noise3(x * 6, y * 6, z * 6))), 0.9));
  g.surf(K_PLAIN, 1, 0, 1.0);
  for (let k = 0; k < 6; k++) g.in(M(0, 1.02, 0, 0, k * 60, 0).multiply(M(0, 0, 0.385, -8, 0, 0)), () => g.flat([[-0.05, -0.16, 0], [0.05, -0.16, 0], [0.05, 0.16, 0], [-0.05, 0.16, 0]], [0.12, 0.8, 0.05]));
  g.in(M(0, 0.72, 0), () => g.cyl(0.29, 0.29, 0.001, nq(12), [0.12, 0.8, 0.05], true, false));
  g.in(M(0, 0.1, 0), () => pool(g, 0.55, [[0.35, 0.9, 0.08], [0.14, 0.6, 0.04], [0.03, 0.2, 0.03]], 5, 0.6, [0.03, 0.08, 0.02]));
  // the cradle: six legs, two rings of rails, braces, all of it out of true
  const leg = (i, y) => { const a = (i * 60 + 30) * DEG + 0.06 * Math.sin(i * 5), t = y / (cy - 0.1), r = lerp(1.36, 1.07, t) + 0.03 * Math.sin(i * 3 + y * 2); return [Math.cos(a) * r, y, Math.sin(a) * r]; };
  for (let i = 0; i < 6; i++) {
    pole(g, leg(i, -0.1), leg(i, cy + 0.25 + 0.3 * hash1(i, 5)), 0.075, i + 1);
    const j = (i + 1) % 6;
    for (const [y, dy] of [[1.15, 0.1], [cy - 0.2, -0.08]]) { const a = leg(i, y + dy * 0.5), b = leg(j, y - dy * 0.5); pole(g, v3(a, b, -0.12), v3(a, b, 1.12), 0.048, i * 7 + y * 3); g.in(M(...a), () => lashing(g, 0.085, 3, 0.014)); }
    if (i % 2 === 0) pole(g, leg(i, 0.2), leg(j, cy - 0.3), 0.04, i * 11 + 5); else pole(g, leg(j, 0.3), leg(i, 1.1), 0.04, i * 11 + 6);
    // struts in to the boiler
    const s = leg(i, cy - 0.1); pole(g, s, [s[0] * 0.86, cy - 0.25, s[2] * 0.86], 0.045, i * 13 + 2);
  }
  // a plank walk round the front of it, a ladder up
  for (let k = 0; k < 9; k++) { const a = (-18 + k * 14.5) * DEG, r0 = 1.0, r1 = 1.5, c = mul(SKAR_WOOD[k % 5], 0.8 + 0.4 * hash1(k, 3)); g.surf(K_WOOD, 0.9); g.in(M(Math.cos(a) * (r0 + r1) / 2, 1.24 + 0.02 * (k % 2), Math.sin(a) * (r0 + r1) / 2, 0, -a / DEG + (hash1(k, 5) - 0.5) * 8, 0), () => g.beam(r1 - r0 + 0.1 * hash1(k, 7), 0.04, 0.24, 0.008, woodTint(c, k), 2)); }
  ladder(g, [1.02, 0.02, 1.34], [0.92, 1.36, 1.08], 0.3, 7, SKAR_WOOD[1]);
  g.in(M(0.2, 1.26, 1.36, 0, 10, 0), () => { for (const e of [-1, 1]) g.in(M(e * 0.3, 0, 0), () => stake(g, 0.025, 0.6, e + 5, SKAR_WOOD[2])); logTo(g, [-0.36, 0.52, 0], [0.36, 0.5, 0], 0.02, 0.018, 9, { seg: 6, capB: true }); });
  // copper pipes: one over the top and down to a condenser, one round the waist with a valve wheel
  const cop = (x, y, z) => mul(mix(COPPER, VERDIGRIS, 0.6 * smooth(0.5, 0.72, noise3(x * 4, y * 4, z * 4))), 0.85);
  pipe(g, [[-0.25, cy + 0.94, 0.2], [-0.5, cy + 1.25, 0.42], [-0.95, cy + 1.05, 0.75], [-1.16, cy + 0.3, 0.98], [-1.12, 1.5, 1.04], [-1.1, 0.78, 1.06]], 0.065, cop, { every: 1 });
  g.in(M(-1.1, 0, 1.06), () => { g.surf(K_PLAIN, 0.4, 0.85); g.lathe([[0.2, 0], [0.24, 0.05], [0.24, 0.62], [0.16, 0.76], [0.07, 0.8]], nq(14), cop); for (const y of [0.12, 0.56]) g.lathe([[0.245, y - 0.03], [0.26, y], [0.245, y + 0.03]], nq(14), brassC(y)); g.surf(K_PLAIN, 0.15, 0, 1.0); g.in(M(0, 0.36, 0.238), () => g.flat([[-0.035, -0.12, 0], [0.035, -0.12, 0], [0.035, 0.12, 0], [-0.035, 0.12, 0]], [0.12, 0.8, 0.05])); });
  g.surf(K_PLAIN, 0.4, 0.85);
  g.in(M(0, cy - 0.42, 0, 90 + 7, 0, 4), () => g.add(new THREE.TorusGeometry(R * 0.93, 0.05, nq(8), nq(40)), cop));
  g.in(M(0, cy - 0.42, 0, 0, -50, 0).multiply(M(0, 0.04, R * 0.98)), () => { g.surf(K_PLAIN, 0.5, 0.8); g.in(M(0, 0, 0.1), () => { g.add(new THREE.TorusGeometry(0.13, 0.018, 5, nq(14)), [0.5, 0.06, 0.04]); for (const rz of [0, 60, 120]) g.in(M(0, 0, 0, 0, 0, rz), () => g.cbox(0.25, 0.018, 0.018, 0.004, [0.5, 0.06, 0.04])); }); g.in(M(0, 0, 0.05, 90, 0, 0), () => g.in(M(0, -0.05, 0), () => g.cyl(0.02, 0.02, 0.1, 6, IRON))); });
  pipe(g, [[0.7, cy - 0.66, -0.3], [1.0, cy - 0.9, -0.5], [1.12, 0.9, -0.62], [1.1, 0.0, -0.66]], 0.05, cop, { every: 1 });
  // lightning rods with coils; sparks jump between them
  const tips = [];
  for (const [ang, lean, h, sd] of [[20, 9, 2.0, 1], [150, 13, 1.6, 2], [260, 11, 1.35, 3]]) {
    const a = ang * DEG, b = [Math.cos(a) * 0.36, cy + R * 0.93, Math.sin(a) * 0.36], t = [b[0] + Math.cos(a) * Math.sin(lean * DEG) * h, b[1] + Math.cos(lean * DEG) * h, b[2] + Math.sin(a) * Math.sin(lean * DEG) * h];
    tips.push(t);
    g.surf(K_PLAIN, 0.45, 0.85);
    g.tube([b, v3(b, t, 0.5), t], [0.035, 0.028, 0.012], 6, [0.07, 0.065, 0.07]);
    g.in(M(b[0], b[1] - 0.03, b[2]), () => g.lathe([[0.1, 0], [0.1, 0.05], [0.05, 0.09]], 8, brassC(sd)));
    for (let k = 0; k < 5; k++) { const p = v3(b, t, 0.2 + k * 0.09); g.in(M(p[0], p[1], p[2], 90 + (hash1(k, sd) - 0.5) * 16, 0, 0), () => g.add(new THREE.TorusGeometry(0.075 - k * 0.006, 0.016, 5, nq(12)), cop)); }
    g.surf(K_PLAIN, 0.3, 0, 0.9); g.in(M(...t), () => g.add(new THREE.IcosahedronGeometry(0.06, 1), [0.2, 1.0, 0.08]));
  }
  g.surf(K_PLAIN, 1, 0, 1.0);
  for (let k = 0; k < 3; k++) { const a = tips[k], b = tips[(k + 1) % 3], pts = [a]; for (let q = 1; q < 6; q++) { const p = v3(a, b, q / 6); pts.push([p[0] + (hash1(q, k, 3) - 0.5) * 0.3, p[1] + (hash1(q, k, 5) - 0.5) * 0.3, p[2] + (hash1(q, k, 7) - 0.5) * 0.3]); } pts.push(b); for (let q = 0; q < pts.length - 1; q++) g.tube([pts[q], pts[q + 1]], 0.013, 4, [0.2, 1.0, 0.08], false); }
  for (let k = 0; k < 3; k++) { const t = tips[k]; for (let q = 0; q < 2; q++) { const d = [(hash1(k, q, 11) - 0.5) * 0.7, (hash1(k, q, 13) - 0.7) * 0.6, (hash1(k, q, 15) - 0.5) * 0.7], m = [t[0] + d[0] * 0.5 + 0.08, t[1] + d[1] * 0.5 + 0.06, t[2] + d[2] * 0.5]; g.tube([t, m], 0.01, 4, [0.2, 1.0, 0.08], false); g.tube([m, [t[0] + d[0], t[1] + d[1], t[2] + d[2]]], 0.008, 4, [0.2, 1.0, 0.08], false); } }
  // lamps, a warning rag, lumps of the stone lying about
  for (const i of [0, 2, 4]) { const p = leg(i, cy - 0.3); g.in(M(p[0] * 1.06, p[1], p[2] * 1.06), () => blightLamp(g, 1.1)); }
  g.in(M(...leg(5, cy + 0.2), 0, -60, 0), () => g.in(M(0, 0, 0.06), () => rag(g, 0.3, 0.7, SKAR_RAG[0], 3, 0.6, SKAR_RAG[1])));
  for (const [x, z, s, sd] of [[-1.15, -1.0, 0.24, 1], [1.2, 0.5, 0.16, 2], [-0.5, 1.25, 0.13, 3]]) g.in(M(x, 0.0, z, sd * 9, sd * 40, 0), () => crystal(g, s * 0.6, s * 1.8, sd + 30, { deep: rgb(0x0f4a12), bright: rgb(0x8cf03c), glow: 0.5, m: 5, ns: 3 }));
}
function scaffoldWarren(g) {
  g.moss = 0.5;
  const earth = (x, y, z) => mul(rgb(0x4a3c2a), 0.6 + 0.7 * fbm3(x * 3, y * 5, z * 3, 3));
  pad(g, 4, 3, 0.07, earth, 1151, { nu: 60 });
  const xs = [-1.76, -0.6, 0.56, 1.72], zs = [-1.22, 0, 1.2], hs = [[5.0, 4.0, 2.9], [5.3, 4.2, 2.8], [4.2, 4.6, 2.75], [4.0, 3.9, 2.95]];
  const P = (i, j, y) => [xs[i] + 0.1 * Math.sin(i * 3 + j * 5 + y * 0.8) + (i - 1.5) * -0.02 * y, y, zs[j] + 0.08 * Math.cos(i * 7 + j * 2 + y * 0.9)];
  // the frame: crooked posts spliced at each storey
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const H = hs[i][j]; let y = -0.1, k = 0; while (y < H - 0.05) { const y1 = Math.min(H, y + 1.55); pole(g, P(i, j, y), P(i, j, y1 + 0.12), 0.07 - k * 0.006, i * 20 + j * 5 + k); if (k) g.in(M(...P(i, j, y + 0.06)), () => lashing(g, 0.075, 3, 0.014)); y = y1; k++; } }
  // storeys: [height, x0, x1, z0, z1]
  const decks = [[1.25, -1.9, 1.86, -0.12, 1.34], [2.45, -1.9, 1.86, -1.36, 0.16], [2.5, 0.45, 1.86, 0.16, 0.86], [3.62, -1.9, 0.72, -1.36, -0.08], [4.62, -1.92, -0.44, -1.38, -0.5]];
  decks.forEach(([y, x0, x1, z0, z1], k) => {
    for (const z of [z0 + 0.08, z1 - 0.08]) pole(g, [x0 - 0.1, y - 0.1 + 0.03 * Math.sin(k), z], [x1 + 0.1, y - 0.1 - 0.03 * Math.sin(k), z], 0.05, k * 9 + z * 5);
    for (const x of xs) if (x > x0 - 0.2 && x < x1 + 0.2) pole(g, [x + 0.07, y - 0.17, z0 - 0.08], [x + 0.07, y - 0.17, z1 + 0.08], 0.045, k * 13 + x * 3);
    g.in(M(0, 0, 0, 0, 0, Math.sin(k * 2.1) * 1.2), () => deck(g, x0, x1, z0, z1, y, SKAR_WOOD, 50 + k, { rag: 0.2, skew: 2.5, pw: 0.19, skip: (z) => hash1(Math.round(z * 31), k) < 0.07 }));
  });
  // braces
  for (const [a, b, sd] of [[P(0, 2, 0.2), P(1, 2, 1.15), 1], [P(2, 2, 1.2), P(3, 2, 0.15), 2], [P(3, 1, 1.3), P(3, 0, 2.35), 3], [P(0, 0, 0.3), P(0, 1, 1.2), 4], [P(1, 0, 2.5), P(2, 0, 3.55), 5], [P(0, 1, 2.5), P(0, 0, 3.55), 6], [P(3, 0, 2.5), P(2, 0, 3.6), 7], [P(0, 0, 3.7), P(1, 0, 4.55), 8], [P(1, 1, 1.3), P(2, 1, 2.4), 9], [P(3, 2, 1.3), P(3, 1, 2.4), 10]]) pole(g, a, b, 0.04, 70 + sd);
  // shacks on the storeys
  for (const [x, y, z, w, d, h, ry, sd, pp] of [[-1.15, 1.25, 0.62, 1.0, 0.8, 0.74, 4, 1, 0], [0.98, 1.25, 0.66, 0.84, 0.7, 0.68, -7, 2, 1], [-0.42, 2.45, -0.66, 1.1, 0.86, 0.78, -3, 3, 0], [1.26, 2.45, -0.7, 0.82, 0.8, 0.66, 6, 4, 1], [-0.1, 3.62, -0.74, 0.92, 0.78, 0.7, 5, 5, 1], [1.26, 0.03, -0.5, 0.9, 0.8, 0.8, -5, 6, 0]])
    g.in(M(x, y, z, (hash1(sd, 1) - 0.5) * 4, ry, (hash1(sd, 2) - 0.5) * 5), () => shack(g, w, d, h, SKAR_WOOD, 1160 + sd * 7, { pipe: pp, lit: [0.14, 0.8, 0.05], pw: 0.19 }));
  // the crow's nest: a rail, a bell, a ragged flag
  g.in(M(-1.18, 4.62, -0.94), () => {
    for (const [x, z] of [[-0.7, 0.42], [0.7, 0.42], [0.7, -0.42], [-0.7, -0.42]]) g.in(M(x, 0, z), () => stake(g, 0.025, 0.5, x * 3 + z, SKAR_WOOD[2]));
    for (const [a, b] of [[[-0.74, 0.4, 0.42], [0.74, 0.44, 0.42]], [[0.7, 0.42, 0.46], [0.7, 0.4, -0.46]], [[-0.7, 0.42, 0.46], [-0.7, 0.44, -0.46]]]) pole(g, a, b, 0.022, a[0] * 5 + 80);
    g.in(M(0.3, 0, -0.3, 2, 0, -4), () => { stake(g, 0.03, 1.5, 91, SKAR_WOOD[0]); g.in(M(0, 1.4, 0), () => pennon(g, 0.0, 0.62, SKAR_RAG[0], SKAR_RAG[1], { knob: false, hgt: 0.36 })); });
    g.surf(K_PLAIN, 0.4, 0.9); g.in(M(-0.4, 0.5, 0.42), () => { g.cyl(0.006, 0.006, 0.1, 4, IRON); g.in(M(0, -0.2, 0), () => g.lathe([[0.1, 0], [0.09, 0.03], [0.06, 0.12], [0.03, 0.2], [0, 0.22]], nq(10), brassC(3))); });
  });
  // ladders between the storeys
  ladder(g, [0.02, 0.02, 1.46], [0.06, 1.42, 1.3], 0.3, 1, SKAR_WOOD[1]);
  ladder(g, [-0.2, 1.25, 0.8], [-0.26, 2.6, 0.14], 0.28, 2, SKAR_WOOD[0]);
  ladder(g, [1.0, 2.45, -0.1], [0.6, 3.74, -0.2], 0.28, 3, SKAR_WOOD[3]);
  ladder(g, [-0.7, 3.62, -0.2], [-0.8, 4.74, -0.52], 0.26, 4, SKAR_WOOD[1]);
  // rag awnings and washing
  g.in(M(-1.15, 1.25 + 0.82, 0.62 + 0.42), () => awning(g, 0.9, 0.36, SKAR_RAG[0], SKAR_RAG[1], { n: 5 }));
  g.in(M(-0.42, 2.45 + 0.86, -0.66 + 0.45), () => awning(g, 1.0, 0.4, SKAR_RAG[2], SKAR_RAG[3], { n: 4 }));
  g.in(M(1.26, 2.5 + 0.74, 0.86, 0, 0, 0), () => awning(g, 0.9, 0.3, SKAR_RAG[1], SKAR_RAG[0], { n: 6, props: false }));
  for (const [x, y, z, w, l, c, sd, ry] of [[0.2, 1.14, 1.36, 0.3, 0.5, 0, 1, 0], [1.5, 1.14, 1.36, 0.26, 0.42, 1, 2, 0], [-1.5, 2.34, 0.18, 0.3, 0.52, 2, 3, 0], [0.1, 2.34, 0.18, 0.24, 0.44, 3, 4, 0], [-1.2, 3.5, -0.06, 0.3, 0.5, 1, 5, 0], [1.9, 2.34, -0.6, 0.3, 0.5, 0, 6, 90], [-1.94, 1.14, 0.6, 0.3, 0.45, 2, 7, -90]]) g.in(M(x, y, z, 0, ry, 0), () => rag(g, w, l, SKAR_RAG[c], sd, 0.6));
  rope(g, [P(2, 2, 2.6), [1.1, 2.4, 1.1], P(3, 2, 2.7)], 0.008, rgb(0x8a7450), 4);
  for (let k = 0; k < 3; k++) g.in(M(0.8 + k * 0.28, 2.44 - 0.03 * (k === 1 ? 2 : 1), 1.13 - 0.03 * k), () => rag(g, 0.14, 0.26, SKAR_RAG[k + 1], k + 9, 0.4));
  // green lamps
  for (const [x, y, z] of [[-0.6, 1.1, 1.38], [1.2, 1.1, 1.38], [-1.92, 2.3, -0.5], [0.3, 2.3, 0.2], [1.3, 2.36, 0.9], [-0.9, 3.48, -0.04], [0.74, 3.48, -0.8], [-0.44, 4.5, -0.9]]) g.in(M(x, y, z), () => blightLamp(g, 1.0));
  // burrow mouths at the foot: mounds of spoil, holes shored with timber
  for (const [mx, mz, mw, md, mh, holes, sd] of [[-1.0, 0.98, 1.8, 0.95, 0.55, [-0.42, 0.36], 1], [0.72, 1.06, 1.0, 0.8, 0.42, [0], 2]]) g.in(M(mx, 0, mz), () => {
    pad(g, mw, md, mh, earth, 1170 + sd, { sq: 2.4, nu: 36, nv: 8, kind: K_PLAIN });
    for (const hx of holes) g.in(M(hx, 0.02, md * 0.3, -14, hx * 20, 0), () => {
      g.surf(K_PLAIN, 1);
      g.poly(Array.from({ length: 12 }, (_, k) => [Math.cos(k * 0.5236) * 0.2, 0.2 + Math.sin(k * 0.5236) * 0.24, 0.05]), 0, 0, 1, [0.008, 0.007, 0.006]);
      for (const e of [-1, 1]) pole(g, [e * 0.24, -0.05, 0.07], [e * 0.2, 0.46, 0.07], 0.04, sd * 5 + e + hx * 9);
      pole(g, [-0.3, 0.47, 0.08], [0.3, 0.45, 0.08], 0.045, sd * 7 + hx * 5);
      g.surf(K_PLAIN, 0.3, 0, 0.9); for (const e of [-1, 1]) g.in(M(e * 0.05, 0.22, 0.055), () => g.add(new THREE.SphereGeometry(0.014, 6, 4), [0.4, 1.0, 0.15]));
    });
  });
  g.in(M(1.75, 0.03, 0.9), () => barrel(g, 0.13, 0.32, rgb(0x5a4026), 5));
  for (let i = 0; i < 5; i++) g.in(M(-0.2 + i * 0.1, 0.07 + (i > 2 ? 0.1 : 0), -1.3 + (i > 2 ? 0.05 : 0), 0, 90, 0), () => g.in(M(0, 0, 0, 0, 0, 90), () => g.in(M(0, -0.3, 0), () => log(g, 0.05, 0.045, 0.6, i + 50, { seg: 7, capB: true }))));
}

// =====================================================================================================
// Crimson: black stone, iron and blood-red glass
// =====================================================================================================
const TOMB_SLATE = [rgb(0x24222c), rgb(0x2e2a36), rgb(0x1c1b22), rgb(0x333340), rgb(0x2a3038)], BLOOD_GLASS = [0.75, 0.03, 0.03];
const tombStone = (seed, o) => stoneStyle(0x2f2f38, { seed, chip: 0.4, cell: 0.17 / qual(), ...o });
const grey = [rgb(0x5a5850), rgb(0x6a665c), rgb(0x4c4a44), rgb(0x55504a)];
/** the outline of a true pointed arch standing on the local origin, on the XY plane: two arcs struck from the springing points */
function ogive(g, w, h, col, o = {}) {
  const sp = Math.max(0.02, h - w * 0.866), pts = [[-w / 2, 0], [-w / 2, sp]], n = 6;
  for (let i = 1; i <= n; i++) { const a = Math.PI - (i / n) * (Math.PI / 3); pts.push([w / 2 + Math.cos(a) * w, sp + Math.sin(a) * w]); }
  for (let i = n - 1; i >= 0; i--) { const a = (i / n) * (Math.PI / 3); pts.push([-w / 2 + Math.cos(a) * w, sp + Math.sin(a) * w]); }
  pts.push([w / 2, 0]);
  if (o.fill) { g.surf(K_PLAIN, o.fillRough ?? 0.5, 0, o.fillGlow || 0); g.in(M(0, 0, 0.008), () => g.poly(pts.map((p) => [p[0], p[1], 0]), 0, 0, 1, o.fill)); }
  g.surf(K_STONE, 0.85);
  g.tube(pts.map((p) => [p[0], p[1], 0.02]), o.t || 0.035, 5, col, true);
}
/** a lancet of blood-red glass in a stone surround on the local XY plane: tracery bars across it */
function lancet(g, w, h, col, glow = 0.6) {
  ogive(g, w, h, col, { t: 0.04, fill: BLOOD_GLASS, fillGlow: glow, fillRough: 0.2 });
  g.surf(K_PLAIN, 0.5, 0.8);
  g.in(M(0, h * 0.42, 0.014), () => g.cbox(0.02, h * 0.84, 0.012, 0.003, IRON));
  for (const y of [0.3, 0.58]) g.in(M(0, h * y, 0.014), () => g.cbox(w * 0.9, 0.018, 0.012, 0.003, IRON));
}
/** a crow perched on the local origin, looking toward +Z. Sculpted once. */
function crow(g, s = 1) {
  const geo = geoOnce('crow', () => {
    const c = 0x0d0d12, P = [];
    P.push(S.ellipsoid(0.055, 0.06, 0.1).rot(-28, 0, 0).at(0, 0.11, 0).color(c).tint(0.3, 40));
    P.push(S.sphere(0.042).at(0, 0.18, 0.07).color(c).blend(0.03));
    P.push(S.cone(0.02, 0.004, 0.07, 0.003).rot(98, 0, 0).at(0, 0.172, 0.13).color(0x2a2a30).blend(0.006));
    P.push(S.box(0.07, 0.014, 0.14, 0.006).rot(-40, 0, 0).at(0, 0.06, -0.11).color(c).blend(0.02));
    P.push(...S.mirrorX([S.ellipsoid(0.02, 0.05, 0.09).rot(-30, 0, 0).at(0.052, 0.115, -0.01).color(0x15151c).blend(0.012)]));
    P.push(...S.mirrorX([S.capsule([0.022, 0.07, 0.01], [0.024, 0.0, 0.02], 0.008, 0.007).color(0x2a2a30).blend(0.004)]));
    P.push(...S.mirrorX([S.sphere(0.008).at(0.03, 0.19, 0.095).color(0x9a9aa0).blend(0.002)]));
    return buildPartGeometry({ prims: P }, { res: 96 * qual(), ao: 0.7 });
  });
  const k = g.kind; g.surf(K_PLAIN, 0.6);
  g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(geo));
  g.kind = k;
}
/** a leaning headstone on the local origin, facing +Z */
function headstone(g, w, h, seed) {
  const c = stoneTint(mul(rgb(0x3d3d47), 1.1), seed, 4);
  g.surf(K_STONE, 0.95);
  g.in(M(0, h * 0.4 - 0.06, 0), () => g.cbox(w, h * 0.8 + 0.12, 0.09, 0.016, c));
  g.in(M(0, h * 0.8, 0, 90, 0, 0), () => g.in(M(0, -0.045, 0), () => g.cyl(w / 2, w / 2, 0.09, nq(12), c, true, true)));
}
function mausoleum(g) {
  g.moss = 0.9;
  pad(g, 3, 4, 0.05, (x, y, z) => mul(rgb(0x2a2a24), 0.6 + 0.7 * fbm3(x * 3, y * 5, z * 3, 3)), 1201, { nu: 56 });
  const st = tombStone(1202), col = st.pal[0], trim = mul(col, 1.5), hx = 1.1, hz = 1.42, cz = -0.2, p0 = 0.3, wy = 2.3, fz = hz;
  g.in(M(0, 0, cz), () => {
    stoneBox(g, hx + 0.14, hz + 0.14, 0, p0, tombStone(1203, { course: 0.15 }), 1204);
    g.surf(K_STONE, 0.95); g.flat([[-hx - 0.14, p0 - 0.003, -hz - 0.14], [-hx - 0.14, p0 - 0.003, hz + 0.14], [hx + 0.14, p0 - 0.003, hz + 0.14], [hx + 0.14, p0 - 0.003, -hz - 0.14]], mul(col, 0.5));
    stoneBox(g, hx, hz, p0, wy, st, 1210, { noFoot: true, each: (s, W) => {
      if (s % 2) for (const u of [0.5, 1.25, 2.0]) g.in(M(u * (2 * W - 0.03) / 2.5, 0.5, 0.012), () => lancet(g, 0.3, 1.15, stoneTint(trim, s + u, 5)));
      if (s === 2) g.in(M(W - 0.016, 0.9, 0.012), () => { g.surf(K_PLAIN, 0.2, 0, 0.6); g.in(M(0, 0, 0, 90, 0, 0), () => g.cyl(0.36, 0.36, 0.01, nq(20), (x, y, z) => mul(BLOOD_GLASS, 0.6 + 0.5 * tri1(Math.atan2(z, x) / TAU * 8)), false, true)); g.surf(K_STONE, 0.9); g.add(new THREE.TorusGeometry(0.38, 0.05, 6, nq(22)), stoneTint(trim, 4, 5)); g.surf(K_PLAIN, 0.5, 0.8); for (let k = 0; k < 4; k++) g.in(M(0, 0, 0.02, 0, 0, k * 45), () => g.cbox(0.74, 0.02, 0.012, 0.003, IRON)); });
    } });
    // cornice
    for (let s = 0; s < 4; s++) { const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz; g.surf(K_STONE, 0.9); g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, wy - 0.12, D)), () => g.mould([[0, 0], [0.05, 0.03], [0.05, 0.07], [0.1, 0.11], [0.1, 0.17], [0, 0.17]], 2 * W, stoneTint(trim, s, 4), 1, 1, 6)); }
    // the front: iron doors under a pointed arch, a gable over with a bat spread on it
    g.in(M(0, p0, fz + 0.012), () => {
      ogive(g, 0.96, 1.66, stoneTint(trim, 7, 5), { t: 0.075, fill: [0.045, 0.043, 0.05], fillRough: 0.5 });
      ogive(g, 1.24, 1.92, stoneTint(mul(col, 1.2), 8, 5), { t: 0.05 });
      g.surf(K_PLAIN, 0.5, 0.85);
      g.in(M(0, 0.7, 0.014), () => g.cbox(0.02, 1.4, 0.014, 0.004, [0.02, 0.02, 0.022]));
      for (const e of [-1, 1]) { for (const y of [0.25, 0.75, 1.15]) g.in(M(e * 0.24, y, 0.014), () => g.cbox(0.4, 0.045, 0.014, 0.004, [0.09, 0.085, 0.09])); for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) g.in(M(e * (0.1 + i * 0.13), 0.12 + j * 0.3, 0.012), () => g.stud(0.016, [0.14, 0.13, 0.13], 5)); g.in(M(e * 0.09, 0.62, 0.03), () => g.add(new THREE.TorusGeometry(0.05, 0.011, 4, 10), [0.14, 0.13, 0.13])); }
      for (const e of [-1, 1]) g.in(M(e * 0.82, 1.2, 0), () => bracketLamp(g, 0.9, [0.9, 0.08, 0.04], { glow: 0.8, shape: 'cage' }));
    });
    g.surf(K_STONE, 0.93);
    g.in(M(0, wy + 0.05, fz - 0.08), () => prism(g, [[-hx - 0.04, 0], [hx + 0.04, 0], [0.12, 1.05], [0, 1.28], [-0.12, 1.05]], 0.2, (x, y, z) => mul(col, (0.85 + 0.3 * noise3(x * 3, y * 9, z * 3)) * (Math.abs((y % 0.2) - 0.1) > 0.085 ? 0.55 : 1)), [0, 0.3]));
    for (const e of [-1, 1]) g.beamTo([e * (hx + 0.1), wy + 0.04, fz + 0.03], [0, wy + 1.4, fz + 0.03], 0.1, 0.12, 0.015, stoneTint(trim, e + 9, 4), 6, [0, 0, 1]);
    g.in(M(0, wy + 0.5, fz + 0.03), () => batMotif(g, 1.1, [0.05, 0.048, 0.055], { metal: 0.8 }));
    g.in(M(0, wy + 1.36, fz + 0.03), () => { g.surf(K_PLAIN, 0.5, 0.85); g.cyl(0.02, 0.008, 0.6, 5, IRON); g.in(M(0, 0.36, 0.0), () => batMotif(g, 0.5, [0.05, 0.048, 0.055], { metal: 0.8 })); });
    // buttresses with pinnacles (one has fallen), gargoyles at the eaves
    const but = [[-1, 1, 0], [1, 1, 0], [-1, -1, 0], [1, -1, 1], [-1, 0, 0], [1, 0, 0]];
    for (const [ex, ez, broken] of but) g.in(M(ex * (hx + 0.06), 0, ez * (hz - 0.14)), () => {
      g.surf(K_STONE, 0.93);
      g.in(M(0, (wy + 0.2) / 2, 0), () => g.cbox(0.3, wy + 0.2, 0.32, 0.02, stoneTint(mul(col, 1.1), ex + ez * 3, 4)));
      g.in(M(ex * 0.07, 0.55, 0), () => g.cbox(0.34, 1.1, 0.38, 0.03, stoneTint(col, ex * 2 + ez, 4)));
      g.in(M(0, wy + 0.2, 0), () => { g.cbox(0.36, 0.08, 0.38, 0.02, stoneTint(trim, ex + ez, 4)); if (broken) { g.in(M(0, 0.04, 0, 0, 45, 0), () => g.lathe([[0.13, 0], [0.11, 0.2], [0.04, 0.26]], 4, mul(col, 1.2))); } else obeliskOn(g, 1.0, 0.1, stoneTint(mul(col, 1.25), ex, 4), [0.05, 0.05, 0.055], {}); });
      if (ez !== 0) g.in(M(0, wy - 0.02, 0, 0, Math.atan2(ex, ez) / DEG, 0).multiply(M(0, 0, 0.14)), () => gargoyle(g, 1.25, mul(col, 1.5)));
    });
    for (const e of [-1, 1]) g.in(M(e * (hx + 0.06), wy - 0.1, 0.72, 0, e * 90, 0).multiply(M(0, 0, 0.0)), () => gargoyle(g, 1.0, mul(col, 1.5)));
    // the roof, and on it a drum of red lancets under a cracked dome
    hipRoof(g, hx + 0.12, hz + 0.12, wy + 0.04, wy + 0.85, 0.02, TOMB_SLATE, 1220, { ridgeCol: [0.05, 0.05, 0.055] });
    const dy = wy + 0.42, dr = 0.66, dh = 0.8;
    g.surf(K_STONE, 0.93);
    g.in(M(0, dy, 0, 0, 22.5, 0), () => { g.lathe([[dr * 1.08, 0], [dr * 1.08, 0.12], [dr, 0.16], [dr, dh - 0.1], [dr * 1.1, dh - 0.04], [dr * 1.1, dh + 0.04], [dr * 0.96, dh + 0.06]], 8, (x, y, z) => mul(col, 1.05 + 0.3 * noise3(x * 4, y * 9, z * 4))); });
    for (let k = 0; k < 8; k++) g.in(M(0, dy + 0.18, 0, 0, k * 45, 0).multiply(M(0, 0, dr * 0.925 + 0.004)), () => lancet(g, 0.22, 0.52, stoneTint(trim, k, 5), 0.7));
    const dome = (v) => { const t = v * Math.PI / 2; return [dr * 0.98 * Math.pow(Math.cos(t), 0.75), dy + dh + 0.06 + 0.95 * Math.sin(t) * (0.85 + 0.15 * v)]; };
    const crackAt = (a, v) => Math.abs(((a - (1.1 + 0.5 * Math.sin(v * 9) + 0.25 * Math.sin(v * 23)) + Math.PI * 3) % TAU) - Math.PI) * (0.4 + 0.6 * v);
    g.surf(K_ROOF, 0.6, 0.3);
    g.sheet(nq(48), nq(16), (u, v) => { const a = u * TAU, [r, y] = dome(v), rib = 1 + 0.035 * Math.pow(Math.abs(Math.cos(a * 4)), 6), ck = crackAt(a, v) < 0.06 && v > 0.1 && v < 0.9 ? 0.93 : 1; return [Math.cos(a) * r * rib * ck, y - (ck < 1 ? 0.03 : 0), Math.sin(a) * r * rib * ck]; },
      (x, y, z, nx, ny, nz, u, v) => { const a = u * TAU, ck = crackAt(a, v), inC = ck < 0.06 && v > 0.1 && v < 0.9; g.glow = inC ? 0.5 : 0; return inC ? [0.5, 0.02, 0.015] : mul(mix([0.12, 0.13, 0.15], [0.2, 0.32, 0.28], 0.5 * smooth(0.45, 0.7, noise3(x * 3, y * 3, z * 3))), (0.7 + 0.4 * noise3(x * 9, y * 9, z * 9)) * (ck < 0.11 ? 0.5 : 1)); }, true);
    g.glow = 0;
    g.surf(K_PLAIN, 0.5, 0.85);
    g.in(M(0, dy + dh + 0.98, 0), () => { g.lathe([[0.1, 0], [0.12, 0.05], [0.05, 0.12], [0.07, 0.2], [0.03, 0.3], [0.012, 0.95], [0, 1.0]], 8, [0.05, 0.048, 0.055]); g.in(M(0, 0.6, 0), () => batMotif(g, 0.62, [0.05, 0.048, 0.055], { metal: 0.8 })); });
    // dead creeper on the walls
    const dead = { leaf: [rgb(0x3a2e22), rgb(0x4a3020), rgb(0x2a2a1e)], stem: [0.1, 0.08, 0.06], n: 4, leaves: 12 };
    for (const e of [-1, 1]) g.in(M(e * (hx + 0.02), p0, -0.5, 0, e * 90, 0), () => creeper(g, 1.0, 1.7, e + 3, dead));
    g.in(M(0.3, p0, -hz - 0.02, 0, 180, 0), () => creeper(g, 1.3, 1.5, 6, dead));
  });
  // steps, the fallen pinnacle, headstones, mist
  g.surf(K_STONE, 0.93);
  for (let k = 0; k < 3; k++) g.in(M(0, p0 - 0.05 - k * 0.1 - 0.06, cz + fz + 0.22 + k * 0.13), () => g.cbox(1.36 + k * 0.1, 0.22, 0.2, 0.014, stoneTint(mul(col, 0.9 + 0.1 * (k % 2)), k, 4)));
  g.in(M(1.3, 0.1, -1.78, 80, 30, 0), () => g.in(M(0, 0, 0, 0, 45, 0), () => g.lathe([[0.11, 0], [0.075, 0.6], [0, 0.74]], 4, mul(col, 1.25))));
  for (const [x, z, w, h, rx, rz, sd] of [[-1.22, 1.62, 0.3, 0.6, -8, 6, 1], [1.2, 1.7, 0.26, 0.5, 6, -10, 2], [-0.85, 1.78, 0.22, 0.4, 10, 4, 3]]) g.in(M(x, 0, z, rx, sd * 9 - 10, rz), () => headstone(g, w, h, sd));
  for (const e of [-1, 1]) g.in(M(e * 0.86, 0, cz + fz + 0.36), () => { g.surf(K_STONE, 0.93); g.in(M(0, 0.2, 0), () => g.cbox(0.24, 0.4, 0.24, 0.02, stoneTint(col, e, 4))); g.surf(K_STONE, 0.9); g.in(M(0, 0.4, 0), () => g.lathe([[0.06, 0], [0.09, 0.03], [0.05, 0.08], [0.11, 0.2], [0.12, 0.3], [0.09, 0.34], [0, 0.34]], nq(10), stoneTint(trim, e + 2, 5))); });
  mist(g, 3, 4, 5, 16);
}
function gallows(g) {
  g.moss = 0.5;
  pad(g, 2, 1, 0.04, rgb(0x3e382c), 1251, { nu: 30, nv: 5 });
  const tb = (sd) => woodTint(mul(grey[((Math.round(sd) % 4) + 4) % 4], 0.85 + 0.25 * hash1(Math.round(sd), 3)), sd), py = 0.5, x0 = -0.5, x1 = 0.92, hz = 0.4;
  // the platform: six posts, bearers, a plank deck with a trap in it, steps at one end
  g.surf(K_WOOD, 0.95);
  for (const x of [x0 + 0.05, (x0 + x1) / 2, x1 - 0.05]) for (const z of [-hz + 0.05, hz - 0.05]) g.in(M(x, py / 2 - 0.05, z, 0, 0, (hash1(x * 9, z * 9) - 0.5) * 4), () => g.cbox(0.09, py + 0.06, 0.09, 0.012, tb(Math.round(x * 7 + z * 3))));
  for (const z of [-hz + 0.05, hz - 0.05]) { g.in(M((x0 + x1) / 2, py - 0.1, z), () => g.beam(x1 - x0 + 0.06, 0.09, 0.07, 0.012, tb(7), 4)); g.beamTo([x0 + 0.08, 0.06, z], [(x0 + x1) / 2 - 0.05, py - 0.14, z], 0.05, 0.04, 0.008, tb(9), 2); g.beamTo([x1 - 0.08, 0.06, z], [(x0 + x1) / 2 + 0.05, py - 0.14, z], 0.05, 0.04, 0.008, tb(11), 2); }
  g.in(M(0, 0, 0, 0, 90, 0), () => deck(g, -hz - 0.03, hz + 0.03, x0 - 0.02, x1 + 0.02, py, grey, 21, { rag: 0.05, pw: 0.15, skew: 1 }));
  g.surf(K_PLAIN, 1);
  g.in(M(0.3, py + 0.004, 0.02), () => { for (const [a, b] of [[[-0.3, -0.24], [0.3, -0.24]], [[0.3, -0.24], [0.3, 0.24]], [[0.3, 0.24], [-0.3, 0.24]], [[-0.3, 0.24], [-0.3, -0.24]]]) g.beamTo([a[0], 0, a[1]], [b[0], 0, b[1]], 0.006, 0.02, 0.001, [0.02, 0.018, 0.015], 1); });
  g.surf(K_PLAIN, 0.55, 0.8); for (const z of [-0.12, 0.14]) g.in(M(0.0, py + 0.006, z, -90, 0, 0), () => g.cbox(0.16, 0.04, 0.01, 0.003, IRON));
  g.surf(K_WOOD, 0.95);
  for (let k = 0; k < 3; k++) { const x = -0.92 + k * 0.15, y = 0.12 + k * 0.125; g.in(M(x, y, 0, 0, 90, 0), () => g.beam(2 * hz - 0.1, 0.04, 0.15, 0.008, tb(30 + k), 2)); for (const z of [-hz + 0.1, hz - 0.1]) g.in(M(x, y / 2 - 0.03, z), () => g.cbox(0.05, y + 0.02, 0.05, 0.008, tb(33 + k))); }
  // the gibbet: two posts through the deck, the beam, braces
  const bz = -0.08, by = 3.05;
  for (const [x, sd] of [[-0.36, 1], [0.8, 2]]) { g.in(M(x, by / 2 - 0.06, bz, 0, 0, (sd - 1.5) * 1.6), () => g.in(M(0, 0, 0, 0, 0, 90), () => g.beam(by + 0.12, 0.12, 0.12, 0.016, tb(40 + sd), 10))); }
  g.in(M(0.0, by + 0.04, bz, 0, 0, -1), () => g.beam(1.98, 0.13, 0.13, 0.018, tb(45), 10));
  for (const [x, e] of [[-0.36, 1], [0.8, -1], [-0.36, -1]]) g.beamTo([x, by - 0.6, bz], [x + e * 0.5, by - 0.03, bz], 0.07, 0.07, 0.01, tb(50 + x * 3 + e), 3);
  g.surf(K_PLAIN, 0.55, 0.8);
  for (const x of [-0.36, 0.8]) for (const y of [by - 0.02, py + 0.06]) g.in(M(x, y, bz + 0.065), () => { g.cbox(0.2, 0.05, 0.012, 0.004, IRON); for (const e of [-1, 1]) g.in(M(e * 0.07, 0, 0.006), () => g.stud(0.012, [0.12, 0.11, 0.11], 5)); });
  // two nooses
  for (const [x, l, sd] of [[0.14, 0.72, 1], [0.48, 0.62, 2]]) { g.in(M(x, by + 0.04, bz), () => { g.in(M(0, 0, 0, 0, 90, 0), () => lashing(g, 0.075, 4, 0.014)); }); g.in(M(x, by - 0.03, bz), () => noose(g, l, sd)); }
  // the cage on a chain from the long end of the beam: iron hoops and bars, what is left of someone inside
  g.in(M(-0.78, by - 0.03, bz), () => {
    chain(g, [[0, 0.0, 0], [0, -0.48, 0]], 0.055);
    g.in(M(0, -0.5, 0), () => {
      g.surf(K_PLAIN, 0.6, 0.8);
      const prof = (t) => 0.2 * (0.55 + 0.45 * Math.sin(Math.PI * (0.12 + 0.8 * t))), col = rustCol(3);
      for (let k = 0; k < 8; k++) { const a = k * 0.785, pts = []; for (let q = 0; q <= 8; q++) { const t = q / 8; pts.push([Math.cos(a) * prof(t), -t * 1.05, Math.sin(a) * prof(t)]); } g.tube(pts, 0.011, 4, col, false); }
      for (const t of [0.08, 0.36, 0.66, 0.96]) g.in(M(0, -t * 1.05, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(prof(t), 0.014, 4, nq(14)), col));
      g.in(M(0, -1.06, 0), () => g.cyl(prof(1), prof(1), 0.02, 8, col, true, true));
      g.in(M(0, 0.02, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.04, 0.012, 4, 8), IRON));
      g.in(M(0.0, -0.62, 0.02, 20, 30, 10), () => skull(g, 0.85, true));
      bone(g, [-0.05, -1.0, 0.0], [0.08, -0.72, 0.04], 0.016, 1); bone(g, [0.06, -1.02, -0.05], [-0.07, -1.0, 0.07], 0.014, 2);
      for (let k = 0; k < 4; k++) rib(g, [0, -0.7 - k * 0.05, -0.06], [0.0, -0.74 - k * 0.05, 0.08], [0.09 * (k % 2 ? 1 : -1), 0, 0.02], 0.009, k);
    });
  });
  // crows
  g.in(M(0.66, by + 0.105, bz, 0, 200, 0), () => crow(g, 1.25));
  g.in(M(-0.56, by + 0.105, bz + 0.01, 0, 20, 0), () => crow(g, 1.2));
  g.in(M(0.8, by + 0.11, bz, 0, -40, 0), () => crow(g, 1.15));
  g.in(M(0.86, py + 0.01, 0.26, 0, 70, 0), () => crow(g, 1.2));
  // a lantern on the post, a stool of a barrel, mist
  g.in(M(0.8, 1.7, bz + 0.07), () => bracketLamp(g, 0.9, [0.9, 0.5, 0.15], { glow: 0.6 }));
  mist(g, 2, 1, 9, 9, [0.62, 0.66, 0.7]);
}

// =====================================================================================================
// Khemet: sandstone, gold and lapis
// =====================================================================================================
const SANDSTONE = 0xd2b47e, LAPIS = rgb(0x1f4fa8), KH_PAINT = [rgb(0x1f4fa8), rgb(0xe0aa2e), rgb(0x1f4fa8), rgb(0xe0aa2e), rgb(0xb8342a), rgb(0x1f8a7a)], KH_BACK = rgb(0xe8dcb8);
const sandStone = (seed, o) => stoneStyle(SANDSTONE, { seed, chip: 0.1, var: 0.07, cell: 0.3 / qual(), len: [0.42, 0.8], pal: [rgb(0xd2b47e), rgb(0xd2b47e), rgb(0xc8a870), rgb(0xdcc08c), rgb(0xc4a268), rgb(0xd8b884)], ...o });
const sandC = (seed = 0, k = 1) => (x, y, z) => mul(rgb(SANDSTONE), k * (0.88 + 0.2 * noise3(x * 2.3 + seed, y * 5, z * 2.3)));
const goldC = (seed = 0) => (x, y, z) => mul(GOLD, 0.75 + 0.4 * noise3(x * 6 + seed, y * 6, z * 6));
const GORGE = [[0, 0], [0.025, 0.01], [0.025, 0.04], [0, 0.055], [0.02, 0.11], [0.07, 0.18], [0.1, 0.2], [0.1, 0.235], [0, 0.235]];
/** a cavetto cornice round a box of half sizes hx, hz at height y, with a painted roll under it */
function gorge(g, hx, hz, y, col, cx = 0, cz = 0, s = 1) {
  for (let f = 0; f < 4; f++) { const W = f % 2 ? hz : hx, D = f % 2 ? hx : hz; g.surf(K_STONE, 0.9); g.in(M(cx, y, cz, 0, f * 90, 0).multiply(M(0, 0, D)), () => g.mould(GORGE.map(([o, v]) => [o * s, v * s]), 2 * W, (x, yy, z) => (yy > 0.06 * s && yy < 0.19 * s ? mul(KH_PAINT[(Math.floor(x / (0.09 * s)) % 3 + 3) % 3 === 0 ? 0 : (Math.floor(x / (0.09 * s)) % 3 + 3) % 3 === 1 ? 1 : 4], 0.9) : col(x, yy, z)), 1, 1, Math.max(2, Math.round((2 * W) / (0.09 * s))))); }
}
/** a lotus column standing on the local origin, h high: banded shaft, an open-flower capital painted petal by petal */
function lotusColumn(g, r, h, seed = 0) {
  const cap = h - r * 2.6, sc = sandC(seed, 1.08);
  g.surf(K_STONE, 0.85);
  g.lathe([[r * 1.55, -0.03], [r * 1.55, 0.05], [r * 1.25, 0.09]], nq(14), sc);
  const bands = [[0.1, 4], [0.14, 1], [0.18, 0], [0.22, 1]], prof = [];
  const rad = (y) => r * (1.12 - 0.2 * Math.pow((y - 0.09) / (cap - 0.09), 1.5)) * (y < 0.4 ? 0.88 + 0.12 * (y - 0.09) / 0.31 : 1);
  const ys = [0.09, 0.099, 0.1, 0.139, 0.14, 0.179, 0.18, 0.219, 0.22, 0.259, 0.26, 0.6, cap * 0.5, cap - 0.3, cap - 0.291, cap - 0.24, cap - 0.231, cap - 0.18, cap - 0.171, cap - 0.12, cap - 0.111, cap - 0.06, cap - 0.051, cap].sort((a, b) => a - b);
  for (const y of ys) prof.push([rad(y), y]);
  g.lathe(prof, nq(14), (x, y, z) => { for (const [y0, c] of bands) if (y > y0 - 0.0005 && y < y0 + 0.0395) return mul(KH_PAINT[c], 0.9); const k = (cap - y) / 0.06; if (k > 0.8 && k < 5) return mul(KH_PAINT[[1, 0, 4, 0, 1][Math.floor(k - 0.01) % 5]], 0.9); return sc(x, y, z); });
  g.sheet(nq(32), nq(8), (u, v) => { const a = u * TAU, pet = 1 + 0.07 * v * Math.abs(Math.sin(a * 6)), rr = r * lerp(0.92, 2.15, Math.pow(v, 1.5)) * pet; return [Math.cos(a) * rr, cap + v * r * 2.0, Math.sin(a) * rr]; },
    (x, y, z, nx, ny, nz, u, v) => { const p = tri1(u * 12); return mul(p > 0.72 ? KH_PAINT[1] : v > 0.72 ? KH_PAINT[4] : v < 0.3 ? KH_PAINT[5] : KH_PAINT[0], 0.85 + 0.2 * v); }, true);
  g.lathe([[r * 2.15, cap + r * 2.0], [r * 1.5, cap + r * 2.1], [0, cap + r * 2.1]], nq(14), mul(rgb(SANDSTONE), 0.7));
  g.in(M(0, h - r * 0.25, 0), () => g.cbox(r * 2.7, r * 0.5, r * 2.7, 0.012, sc));
}
/** a winged sun on the local XY plane, facing +Z */
function wingedSun(g, s) {
  g.surf(K_PLAIN, 0.3, 0.9, 0.15);
  g.in(M(0, 0, 0.02, 90, 0, 0), () => g.lathe([[0, 0.05], [0.1, 0.045], [0.16, 0.02], [0.17, 0], [0, 0]].reverse().map(([r, y]) => [r * s, y * s]), nq(14), goldC(1)));
  for (const e of [-1, 1]) for (let k = 0; k < 3; k++) { g.surf(K_PLAIN, 0.5, 0.3); g.in(M(e * 0.16 * s, (0.06 - k * 0.07) * s, 0.012 + k * 0.004), () => prism(g, [[0, -0.035 * s], [e * (0.74 - k * 0.14) * s, -0.02 * s], [e * (0.8 - k * 0.14) * s, 0.03 * s], [0, 0.04 * s]], 0.02, mul(KH_PAINT[[1, 0, 4][k]], 0.9), [e * 0.2 * s, 0])); }
}
function pyramid(g) {
  g.moss = 0;
  const sandy = (x, y, z) => mul(rgb(0xc8a86a), 0.8 + 0.3 * fbm3(x * 2, y * 5, z * 2, 3));
  pad(g, 7, 7, 0.04, sandy, 1301, { nu: 48, nv: 6 });
  const cz = -0.72, hb = 2.68, plH = 0.5, apex = 7.35, capY = 6.25, st = sandStone(1302);
  const wAt = (y) => (hb * (apex - y)) / (apex - plH);
  // the plinth, a band of signs round it
  g.in(M(0, 0, cz), () => {
    stoneBox(g, hb + 0.1, hb + 0.1, 0, plH, st, 1303);
    g.surf(K_STONE, 0.9); g.flat([[-hb - 0.1, plH - 0.003, -hb - 0.1], [-hb - 0.1, plH - 0.003, hb + 0.1], [hb + 0.1, plH - 0.003, hb + 0.1], [hb + 0.1, plH - 0.003, -hb - 0.1]], mul(rgb(SANDSTONE), 0.8));
    for (let f = 0; f < 4; f++) g.in(M(0, 0.3, 0, 0, f * 90, 0).multiply(M(0, 0, hb + 0.1 + 0.014)), () => glyphBand(g, 2 * hb - 0.1, 0.17, 1310 + f, KH_PAINT, KH_BACK));
    // the courses: each a low battered riser and a narrow tread, the blocks picked out one by one
    const n = Math.round((capY - plH) / 0.2), rnd = rng(1320), base = rgb(SANDSTONE), GB = 8;
    for (let f = 0; f < 4; f++) g.in(M(0, 0, 0, 0, f * 90, 0), () => {
      for (let k = 0; k < n; k++) {
        const y0 = plH + (k * (capY - plH)) / n, y1 = plH + ((k + 1) * (capY - plH)) / n, w0 = wAt(y0), w1 = wAt(y1), wm = w0 - (w0 - w1) * 0.45, nb = Math.max(1, Math.round((2 * w0) / 0.62)), off = rnd() * 0.6;
        const band = k === GB || k === GB + 1;
        g.surf(K_STONE, 0.9);
        let xa = -w0;
        for (let b = 0; b <= nb; b++) {
          const xb = b === nb ? w0 : Math.min(w0, -w0 + ((b + off) * 2 * w0) / nb);
          if (xb - xa < 0.01) { xa = xb; continue; }
          const c = band ? mul(LAPIS, 0.75 + 0.3 * rnd()) : mul(base, 0.82 + 0.3 * rnd()), k0 = wm / w0, k1 = w1 / w0;
          g.flat([[xa, y0, w0], [xb, y0, w0], [xb * k0, y1, wm], [xa * k0, y1, wm]], [mul(c, 0.86), mul(c, 0.86), c, c]);
          g.flat([[xa * k0, y1, wm], [xb * k0, y1, wm], [xb * k1, y1, w1], [xa * k1, y1, w1]], mul(c, 1.16));
          xa = xb;
        }
        if (k === GB) { g.in(M(0, (y0 + y1) / 2, (w0 + wm) / 2 + 0.006, -Math.atan2(w0 - wm, y1 - y0) / DEG, 0, 0), () => glyphBand(g, 2 * wm - 0.2, 0.15, 1330 + f, [GOLD, mul(GOLD, 1.15), rgb(0xe8dcb8)], null)); }
        if (k === GB + 1) { g.surf(K_PLAIN, 0.3, 0.9, 0.1); g.flat([[-wm, y1 - 0.05, wm + 0.004], [wm, y1 - 0.05, wm + 0.004], [wm, y1 - 0.012, wm + 0.004], [-wm, y1 - 0.012, wm + 0.004]], mul(GOLD, 0.95)); g.flat([[-w0, y0 + 0.01, w0 + 0.004 - (w0 - wm) * 0.05], [w0, y0 + 0.01, w0 + 0.004 - (w0 - wm) * 0.05], [w0, y0 + 0.045, w0 + 0.004 - (w0 - wm) * 0.2], [-w0, y0 + 0.045, w0 + 0.004 - (w0 - wm) * 0.2]], mul(GOLD, 0.95)); }
      }
      // the gold cap
      const wc = wAt(capY) + 0.02;
      g.surf(K_PLAIN, 0.22, 0.95, 0.14);
      g.flat([[-wc, capY, wc], [wc, capY, wc], [0, apex + 0.05, 0]], [mul(GOLD, 0.85), mul(GOLD, 0.85), mul(GOLD, 1.25)]);
      g.flat([[-wc - 0.02, capY - 0.07, wc + 0.02], [wc + 0.02, capY - 0.07, wc + 0.02], [wc, capY, wc], [-wc, capY, wc]], mul(GOLD, 0.7));
    });
  });
  // the chapel against the south face: a battered block with a gorge cornice, its door under a winged sun
  const fz = cz + hb + 0.1, chz = 1.82, chx = 1.42, chd = 0.5, chT = 2.55;
  { const stc = sandStone(1340); stoneBox2(g, chx, chd, plH - 0.02, chT, stc, 1341, chz); }
  g.surf(K_STONE, 0.9); g.flat([[-chx, chT, chz - chd], [-chx, chT, chz + chd], [chx, chT, chz + chd], [chx, chT, chz - chd]], mul(rgb(SANDSTONE), 0.85));
  gorge(g, chx, chd, chT - 0.01, sandC(4, 1.05), 0, chz, 1.15);
  g.in(M(0, plH, chz + chd + 0.012), () => {
    g.surf(K_PLAIN, 1); g.flat([[-0.3, 0, 0], [0.3, 0, 0], [0.3, 1.3, 0], [-0.3, 1.3, 0]], [0.015, 0.012, 0.01]);
    g.surf(K_STONE, 0.9);
    for (const e of [-1, 1]) g.in(M(e * 0.36, 0.68, 0.02), () => g.cbox(0.12, 1.36, 0.06, 0.012, sandC(e, 1.1)));
    g.surf(K_PLAIN, 0.3, 0.9, 0.1); g.in(M(0, 1.4, 0.03), () => g.beam(0.9, 0.12, 0.07, 0.014, goldC(3), 4));
    g.in(M(0, 1.64, 0.0), () => wingedSun(g, 0.62));
    g.in(M(0, 1.9, 0.004), () => glyphBand(g, 2 * chx - 0.2, 0.15, 1350, KH_PAINT, KH_BACK));
    for (const e of [-1, 1]) g.in(M(e * 0.92, 0.75, 0.004, 0, 0, 90), () => glyphBand(g, 1.3, 0.15, 1352 + e, KH_PAINT, KH_BACK));
  });
  // the portico before it: four lotus columns on a podium, an architrave with a gorge, a stair down to the causeway
  const pz0 = chz + chd, pz1 = 2.98, colZ = 2.74, colH = 1.72;
  { const stp = sandStone(1360); stoneBox2(g, 1.5, (pz1 - pz0) / 2 + 0.02, 0, plH, stp, 1361, (pz0 + pz1) / 2); }
  g.surf(K_STONE, 0.9); g.flat([[-1.5, plH - 0.002, pz0], [-1.5, plH - 0.002, pz1 + 0.02], [1.5, plH - 0.002, pz1 + 0.02], [1.5, plH - 0.002, pz0]], mul(rgb(SANDSTONE), 0.9));
  for (const x of [-1.24, -0.44, 0.44, 1.24]) g.in(M(x, plH, colZ), () => lotusColumn(g, 0.105, colH, x * 5));
  g.surf(K_STONE, 0.9);
  g.in(M(0, plH + colH + 0.1, colZ), () => g.beam(2.94, 0.2, 0.3, 0.015, sandC(7, 1.06), 8));
  g.in(M(0, plH + colH + 0.1, colZ + 0.156), () => glyphBand(g, 2.8, 0.13, 1370, KH_PAINT, KH_BACK));
  for (const e of [-1, 1]) g.in(M(e * 1.32, plH + colH + 0.1, (pz0 + colZ) / 2), () => g.cbox(0.3, 0.2, colZ - pz0 + 0.3, 0.015, sandC(e + 8, 1.03)));
  g.in(M(0, plH + colH + 0.215, (pz0 + colZ) / 2 + 0.07), () => g.cbox(2.94, 0.05, colZ - pz0 + 0.44, 0.012, sandC(11, 0.95)));
  gorge(g, 1.47, (colZ - pz0) / 2 + 0.22, plH + colH + 0.23, sandC(5, 1.05), 0, (pz0 + colZ) / 2 + 0.07, 0.9);
  g.surf(K_PLAIN, 1); g.flat([[-1.45, plH + colH - 0.004, pz0], [1.45, plH + colH - 0.004, pz0], [1.45, plH + colH - 0.004, colZ + 0.14], [-1.45, plH + colH - 0.004, colZ + 0.14]], [0.2, 0.16, 0.1]);
  for (let k = 0; k < 5; k++) { g.surf(K_STONE, 0.92); g.in(M(0, plH - (k + 1) * 0.1 + 0.05 - 0.1, pz1 + 0.06 + k * 0.088), () => g.cbox(1.24, 0.3, 0.1, 0.01, sandC(k, 0.96 + 0.05 * (k % 2)))); }
  for (const e of [-1, 1]) { g.surf(K_STONE, 0.92); g.in(M(e * 0.74, 0.22, pz1 + 0.24), () => g.cbox(0.22, 0.52, 0.5, 0.02, sandC(e + 20, 1.04))); g.in(M(e * 0.74, 0.48, pz1 + 0.24), () => { g.surf(K_PLAIN, 0.3, 0.9, 0.08); g.lathe([[0.05, 0], [0.1, 0.03], [0.13, 0.1], [0.12, 0.11], [0.08, 0.05], [0, 0.04]], nq(10), goldC(e)); g.in(M(0, 0.08, 0), () => fire(g, 0.22, FIRE_RED, e, 0.85)); }); }
  // cedar masts with pennons against the chapel
  for (const e of [-1, 1]) g.in(M(e * 1.12, plH, pz0 + 0.07, 0, e > 0 ? 0 : 0, 0), () => pennon(g, 3.5, 0.62, KH_PAINT[e > 0 ? 4 : 0], GOLD, { pole: rgb(0x6a4026), hgt: 0.2 }));
  // obelisks flanking the stair, capped in gold, signs down their faces
  for (const e of [-1, 1]) g.in(M(e * 2.42, 0, 2.86), () => {
    g.surf(K_STONE, 0.9); g.in(M(0, 0.16, 0), () => g.cbox(0.5, 0.34, 0.5, 0.02, sandC(e + 30, 1.0)));
    g.in(M(0, 0.33, 0), () => { obeliskOn(g, 2.75, 0.19, sandC(e + 32, 1.1), mul(GOLD, 1.0), { capGlow: 0.14 }); for (let f = 0; f < 4; f++) g.in(M(0, 1.22, 0, 0, f * 90, 0).multiply(M(0, 0, 0.123, -0.75, 0, 0)), () => g.in(M(0, 0, 0, 0, 0, 90), () => glyphBand(g, 1.9, 0.12, 1380 + f + e, KH_PAINT, null))); });
  });
  // sand drifted against the plinth
  for (const [x, z, rx, rz, sd] of [[-2.9, 1.9, 0.5, 0.9, 1], [3.0, -1.0, 0.42, 1.1, 2], [-3.0, -2.2, 0.4, 0.8, 3], [1.6, 3.0, 0.5, 0.3, 4], [-1.7, 3.05, 0.45, 0.3, 5]]) { g.surf(K_PLAIN, 0.95); g.in(M(x, 0.02, z), () => g.sheet(nq(14), 4, (u, v) => { const a = u * TAU; return [Math.cos(a) * rx * v, v > 0.99 ? -0.03 : 0.18 * Math.pow(1 - v * v, 0.8), Math.sin(a) * rz * v]; }, sandy, true)); }
}
/** stoneBox centred at z = cz */
function stoneBox2(g, hx, hz, y0, y1, st, seed, cz) { g.in(M(0, 0, cz), () => stoneBox(g, hx, hz, y0, y1, st, seed, { noFoot: y0 > 0.02 })); }
/** repaint the parts of a sculpted geometry that were given a marker colour: fn(x, y, z) -> [rgb, roughness, metalness] */
function repaint(geo, test, fn) {
  const c = geo.attributes.color, p = geo.attributes.position, a = geo.attributes.aPbr;
  for (let i = 0; i < c.count; i++) { const r = c.getX(i), gg = c.getY(i), b = c.getZ(i); const k = test(r, gg, b); if (k <= 0) continue; const [col, rough, metal] = fn(p.getX(i), p.getY(i), p.getZ(i)); c.setXYZ(i, col[0] * k, col[1] * k, col[2] * k); if (a) { a.setX(i, rough); a.setY(i, metal); } }
  return geo;
}
function sphinxStatue(g) {
  g.moss = 0;
  const sandy = (x, y, z) => mul(rgb(0xc8a86a), 0.8 + 0.3 * fbm3(x * 2, y * 5, z * 2, 3));
  pad(g, 2, 4, 0.04, sandy, 1401, { nu: 40, nv: 6 });
  const st = sandStone(1402, { len: [0.36, 0.62] }), px = 0.84, pz = 1.86, ph = 0.86, up = 0.3;
  stoneBox(g, px, pz, 0, ph, st, 1403);
  g.surf(K_STONE, 0.9); g.flat([[-px, ph - 0.002, -pz], [-px, ph - 0.002, pz], [px, ph - 0.002, pz], [px, ph - 0.002, -pz]], mul(rgb(SANDSTONE), 0.9));
  gorge(g, px, pz, ph - 0.2, sandC(3, 1.06), 0, 0, 0.85);
  for (const e of [-1, 1]) g.in(M(e * (px + 0.014), 0.45, 0, 0, e * 90, 0), () => glyphBand(g, 2 * pz - 0.3, 0.13, 1420 + e, [GOLD, LAPIS], null));
  for (const e of [-1, 1]) g.in(M(e * (px + 0.014), 0.2, 0, 0, e * 90, 0), () => glyphBand(g, 2 * pz - 0.3, 0.16, 1410 + e, KH_PAINT, KH_BACK));
  g.in(M(0, 0.2, pz + 0.014), () => glyphBand(g, 2 * px - 0.24, 0.16, 1413, KH_PAINT, KH_BACK));
  // the lion body, sculpted once
  const sand = 0xcfa868, marker = 0xff00ff, marker2 = 0x00ffff;
  g.surf(K_STONE, 0.85);
  g.in(M(0, up, 0), () => g.add(geoOnce('sphinxBody', () => {
    const P = [], Q = (p) => p.color(sand).tint(0.1, 5);
    P.push(Q(S.capsule([0, 1.06, -1.2], [0, 1.1, 0.3], 0.4, 0.42)));
    P.push(...S.mirrorX([Q(S.ellipsoid(0.27, 0.42, 0.5).at(0.34, 0.97, -1.08)).blend(0.08)]));
    P.push(...S.mirrorX([Q(S.capsule([0.44, 0.67, -0.95], [0.48, 0.65, -0.4], 0.12, 0.11)).blend(0.05)]));
    P.push(Q(S.ellipsoid(0.42, 0.52, 0.4).at(0, 1.2, 0.36)).blend(0.1));
    P.push(...S.mirrorX([Q(S.ellipsoid(0.2, 0.36, 0.3).at(0.33, 1.02, 0.42)).blend(0.07)]));
    P.push(...S.mirrorX([Q(S.capsule([0.32, 0.72, 0.4], [0.32, 0.68, 1.5], 0.15, 0.135)).blend(0.06)]));
    P.push(...S.mirrorX([Q(S.box(0.3, 0.2, 0.34, 0.08).at(0.32, 0.66, 1.58)).blend(0.04)]));
    for (const dx of [-0.07, 0.07]) P.push(...S.mirrorX([S.box(0.012, 0.16, 0.18, 0.003).at(0.32 + dx, 0.7, 1.7).color(0x8a6a3a).cut(0.01)]));
    P.push(...S.mirrorX([S.box(0.012, 0.12, 0.14, 0.003).at(0.5, 0.66, -0.33).color(0x8a6a3a).cut(0.01)]));
    P.push(...S.limb([[0.1, 0.82, -1.62], [0.5, 0.72, -1.56], [0.7, 0.7, -1.1], [0.66, 0.74, -0.62]], [0.07, 0.06, 0.055, 0.075]).map((p) => Q(p).blend(0.03)));
    P.push(Q(S.capsule([0, 1.5, 0.48], [0, 1.95, 0.6], 0.25, 0.2)).blend(0.08));
    for (let i = 0; i < 5; i++) P.push(...S.mirrorX([S.capsule([0.2, 1.3 - i * 0.02, -0.9 + i * 0.22], [0.42, 0.95, -0.86 + i * 0.22], 0.012, 0.012).color(0x9a7a44).paint(0.01, -0.004)]));
    // the broad collar on its chest
    P.push(S.ellipsoid(0.36, 0.3, 0.2).at(0, 1.55, 0.72).color(marker2).paint(0.006, 0.006));
    return repaint(buildPartGeometry({ prims: P }, { res: 22 * qual(), ao: 0.8 }), (r, gg, b) => (r < 0.3 * gg && b > 0.5 * gg ? gg : 0), (x, y, z) => { const d = Math.hypot(x, y - 1.9) * 20; const k = Math.floor(d) % 3; return k === 0 ? [GOLD, 0.3, 0.9] : k === 1 ? [LAPIS, 0.5, 0.2] : [rgb(0xb8342a), 0.5, 0.2]; });
  })));
  // the head: a king's face in the striped headcloth
  g.in(M(0, up, 0), () => g.add(geoOnce('sphinxHead', () => {
    const P = [], Q = (p) => p.color(sand).tint(0.08, 9), N = (p) => p.color(marker);
    P.push(N(S.ellipsoid(0.3, 0.26, 0.3).at(0, 2.44, 0.62)));
    P.push(...S.mirrorX([N(S.box(0.2, 0.66, 0.36, 0.07).rot(0, 0, -15).at(0.34, 2.14, 0.6)).blend(0.05)]));
    P.push(...S.mirrorX([N(S.box(0.17, 0.5, 0.1, 0.04).rot(8, 0, 0).at(0.2, 1.74, 0.84)).blend(0.03)]));
    P.push(N(S.capsule([0, 2.3, 0.4], [0, 1.66, 0.26], 0.15, 0.1)).blend(0.05));
    P.push(Q(S.ellipsoid(0.235, 0.29, 0.25).at(0, 2.25, 0.74)).blend(0.012));
    P.push(Q(S.ellipsoid(0.17, 0.15, 0.16).at(0, 2.06, 0.82)).blend(0.05));
    P.push(...S.mirrorX([Q(S.ellipsoid(0.09, 0.07, 0.07).at(0.12, 2.2, 0.9)).blend(0.05)]));
    P.push(Q(S.capsule([0, 2.33, 0.97], [0, 2.19, 1.02], 0.035, 0.055)).blend(0.025));
    P.push(Q(S.ellipsoid(0.085, 0.03, 0.045).at(0, 2.09, 0.975)).blend(0.015));
    P.push(S.box(0.13, 0.008, 0.06, 0.002).at(0, 2.09, 1.0).color(0x7a5a34).cut(0.004));
    P.push(...S.mirrorX([S.ellipsoid(0.058, 0.026, 0.03).at(0.1, 2.3, 0.955).color(0xf0ead8).paint(0.003, 0.002), S.sphere(0.022).at(0.1, 2.3, 0.975).color(0x15100c).paint(0.002, 0.002)]));
    P.push(...S.mirrorX([S.capsule([0.04, 2.3, 0.97], [0.2, 2.31, 0.9], 0.012, 0.01).color(0x15203a).paint(0.004, 0.003)]));
    P.push(...S.mirrorX([S.capsule([0.04, 2.37, 0.96], [0.19, 2.385, 0.9], 0.016, 0.012).color(0x1f4fa8).paint(0.004, 0.006)]));
    P.push(...S.mirrorX([Q(S.ellipsoid(0.03, 0.085, 0.05).at(0.245, 2.26, 0.74)).blend(0.01)]));
    P.push(N(S.box(0.09, 0.3, 0.09, 0.03).rot(10, 0, 0).at(0, 1.86, 0.9)).blend(0.01));
    P.push(S.box(0.62, 0.06, 0.2, 0.02).at(0, 2.47, 0.84).color(0xe0aa2e).pbr(0.3, 0.9).paint(0.004, 0.008));
    P.push(...S.limb([[0, 2.47, 0.94], [0, 2.56, 1.0], [0, 2.63, 0.97]], [0.03, 0.035, 0.022]).map((p) => p.color(0xe0aa2e).pbr(0.3, 0.9).blend(0.008)));
    return repaint(buildPartGeometry({ prims: P }, { res: 42 * qual(), ao: 0.8 }), (r, gg, b) => (gg < 0.3 * r && b > 0.5 * r ? r : 0), (x, y, z) => (Math.floor(y * 25 + (Math.abs(x) > 0.24 && y < 2.3 ? Math.abs(x) * 9 : 0)) % 2 ? [GOLD, 0.3, 0.9] : [LAPIS, 0.45, 0.25]));
  })));
  // offerings between its paws, gold bowls of fire on the plinth, sand against the base
  g.in(M(0, ph, 1.55), () => { g.surf(K_STONE, 0.9); g.in(M(0, 0.08, 0), () => g.cbox(0.26, 0.16, 0.3, 0.015, sandC(9, 1.1))); g.in(M(0, 0.165, 0.152), () => wingedSun(g, 0.14)); g.surf(K_PLAIN, 0.3, 0.9, 0.08); g.in(M(0, 0.16, 0), () => g.lathe([[0.04, 0], [0.09, 0.03], [0.1, 0.07], [0.08, 0.04], [0, 0.03]], nq(10), goldC(2))); });
  for (const e of [-1, 1]) g.in(M(e * 0.68, ph, 1.68), () => { g.surf(K_PLAIN, 0.3, 0.9, 0.08); g.lathe([[0.07, 0], [0.04, 0.04], [0.04, 0.2], [0.1, 0.26], [0.13, 0.34], [0.12, 0.35], [0.08, 0.28], [0, 0.27]], nq(10), goldC(e)); g.in(M(0, 0.3, 0), () => fire(g, 0.26, FIRE_RED, e, 0.85)); });
  for (const [x, z, rx, rz, sd] of [[-0.85, 1.2, 0.14, 0.6, 1], [0.86, -1.0, 0.13, 0.7, 2], [0.2, -1.88, 0.6, 0.11, 3]]) { g.surf(K_PLAIN, 0.95); g.in(M(x, 0.02, z), () => g.sheet(nq(12), 4, (u, v) => { const a = u * TAU; return [Math.cos(a) * rx * v, v > 0.99 ? -0.03 : 0.16 * Math.pow(1 - v * v, 0.8), Math.sin(a) * rz * v]; }, sandy, true)); }
}

// =====================================================================================================
// Drowned: wrecked timber, barnacles and ghost light
// =====================================================================================================
const WRECK = [rgb(0x6e6858), rgb(0x7e745e), rgb(0x5a5c50), rgb(0x767052), rgb(0x64594c)], GHOST_LIT = [0.06, 0.8, 0.22];
/** barnacles scattered on the local XY plane (they stand toward +Z): n of them within radius s */
function barnacles(g, s, n, seed = 0) {
  const rnd = rng(seed * 17 + 5);
  g.surf(K_PLAIN, 0.9);
  for (let i = 0; i < n; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * s, r = 0.02 + 0.03 * rnd(); g.in(M(Math.cos(a) * d, Math.sin(a) * d, 0, 90, 0, 0), () => g.lathe([[r, -0.01], [r * 0.62, r * 0.9], [r * 0.36, r * 0.9], [r * 0.3, r * 0.3]], 6, mul([0.5, 0.5, 0.44], 0.65 + 0.5 * rnd()))); }
}
/** a hank of sea-weed hanging from the local origin */
function weed(g, l, seed = 0, n = 3) {
  g.surf(K_CLOTH, 0.6);
  for (let i = 0; i < n; i++) { const ll = l * (0.6 + 0.4 * hash1(i, seed)); g.in(M((i - (n - 1) / 2) * 0.05, 0, 0), () => g.sheet(2, 6, (u, v) => [(u - 0.5) * 0.06 * (1 - 0.5 * v) + 0.04 * Math.sin(v * 5 + i * 2 + seed), -v * ll, 0.02 + 0.02 * Math.sin(v * 7 + i)], (x, y, z, nx, ny, nz, u, v) => mul([0.1, 0.26, 0.13], 0.6 + 0.6 * v))); }
}
/** the ghost lantern: an iron cage with a green flame in it, hanging from the local origin */
function ghostLantern(g, s = 1) { lamp(g, s, GHOST_LIT, { shape: 'cage', glow: 0.65, frame: [0.05, 0.06, 0.05] }); g.in(M(0, -0.3 * s, 0), () => fire(g, 0.2 * s, [[0.2, 0.95, 0.4], [0.06, 0.8, 0.22], [0.03, 0.45, 0.2]], 3, 0.7)); }
function hullHouse(g) {
  g.moss = 0.8;
  pad(g, 4, 2, 0.05, (x, y, z) => mul(rgb(0x5a5648), 0.6 + 0.6 * fbm3(x * 3, y * 5, z * 3, 3)), 1501, { nu: 44 });
  const xs = -1.72, xb = 1.88, HT = 2.0, BM = 0.84;
  const beamAt = (x) => BM * (x > 0 ? Math.pow(Math.max(0, 1 - Math.pow(x / xb, 2.2)), 0.8) : 1 - 0.34 * Math.pow(-x / -xs, 3));
  const keelY = (x) => HT * (x < 0.75 ? 1 - 0.05 * Math.pow(Math.max(0, -x) / 1.72, 2) : Math.sqrt(Math.max(0, 1 - Math.pow((x - 0.75) / (xb - 0.75), 2.4))));
  const hull = (x, t, s) => { const a = t * Math.PI / 2; return [x, keelY(x) * Math.pow(Math.sin(a), 0.86), s * beamAt(x) * Math.pow(Math.cos(a), 0.5)]; };
  const NS = 13;
  const plankC = (s) => (x, y, z, nx, ny, nz, u, v) => {
    const band = Math.floor(v * NS), fr = v * NS - band, pl = Math.floor(x * 1.1 + band * 0.37 + 9), h = hash1(band, pl, s + 3), bx = (x * 1.1 + band * 0.37 + 9) - pl;
    let c = mul(WRECK[Math.floor(h * 5)], (0.75 + 0.4 * hash1(pl, band, 7)) * (0.8 + 0.3 * noise3(x * 2.5, y * 30, z * 3)));
    if (fr < 0.1 || bx < 0.03) c = mul(c, 0.4);
    c = mix(c, [0.16, 0.3, 0.17], 0.6 * smooth(0.45, 0.05, v) * smooth(0.35, 0.65, noise3(x * 2.1, y * 2.1, z * 2.1 + s)));
    c = mix(c, [0.55, 0.55, 0.48], smooth(0.3, 0.0, v) * smooth(0.6, 0.72, noise3(x * 11, y * 11, z * 11)) * 0.9);
    return mix(c, [0.03, 0.03, 0.035], 0.6 * smooth(0.66, 0.78, noise3(x * 1.3 + 4, y * 1.3, z * 1.3 + s)) * smooth(0.5, 0.8, v));
  };
  g.surf(K_WOOD, 0.9);
  for (const s of [1, -1]) g.sheet(nq(72), NS * 2, (u, v) => { const x = lerp(xs, xb, u), p = hull(x, v, s), fr = v * NS - Math.floor(v * NS - 1e-6), k = 1 + 0.02 * (1 - fr) * (v < 0.999 ? 1 : 0); return [p[0], p[1] + (v < 0.01 ? -0.05 : 0), p[2] * k]; }, plankC(s), false, s > 0);
  // the transom: boards, the old stern lights still glazed, the rudder standing up behind
  g.surf(K_WOOD, 0.9);
  { const n = 12, pts = []; for (let k = 0; k <= n; k++) { const p = hull(xs, k / n, 1); pts.push([p[2], p[1]]); } for (let k = n - 1; k >= 0; k--) { const p = hull(xs, k / n, -1); pts.push([p[2], p[1]]); }
    g.in(M(xs, 0, 0, 0, -90, 0), () => { g.poly(pts.map((p) => [p[0], p[1], 0]), 0, 0, 1, (x, y) => mul(WRECK[(Math.floor(y * 6) % 5 + 5) % 5], 0.8 + 0.3 * noise3(x * 30, y * 3, 1))); for (const y of [0.5, 1.05, 1.6]) g.in(M(0, y, 0.02), () => g.beam(2 * beamAt(xs) * (y > 1.4 ? 0.62 : 0.98), 0.06, 0.04, 0.01, woodTint(WRECK[2], y * 5), 3));
      for (const e of [-1, 1]) g.in(M(e * 0.3, 1.22, 0.012), () => { g.surf(K_PLAIN, 0.4, 0, 0.6); g.flat([[-0.14, -0.15, 0], [0.14, -0.15, 0], [0.14, 0.15, 0], [-0.14, 0.15, 0]], [0.6, 0.75, 0.3]); g.surf(K_WOOD, 0.9); for (const [dx, dy, L, rz] of [[0, 0.15, 0.34, 0], [0, -0.15, 0.34, 0], [-0.14, 0, 0.3, 90], [0.14, 0, 0.3, 90], [0, 0, 0.3, 90], [0, 0, 0.28, 0]]) g.in(M(dx, dy, 0.016, 0, 0, rz), () => g.beam(L, 0.03, 0.025, 0.006, woodTint(WRECK[4], dx * 9 + dy * 5), 1)); g.surf(K_WOOD, 0.9); });
    });
  }
  g.surf(K_WOOD, 0.9);
  g.in(M(xs - 0.07, 0, 0), () => { g.in(M(0, 1.25, 0, 0, 0, 90), () => g.beam(2.5, 0.1, 0.1, 0.014, woodTint(WRECK[2], 3), 6)); prismX(g, [[-0.34, 1.2], [-0.02, 1.2], [-0.02, 2.4], [-0.2, 2.44], [-0.4, 2.2]], 0.05, (x, y) => mul(WRECK[1], 0.75 + 0.35 * noise3(x * 4, y * 22, 2))); g.surf(K_PLAIN, 0.6, 0.8); for (const y of [1.4, 1.9, 2.3]) g.in(M(-0.1, y, 0), () => g.cbox(0.26, 0.05, 0.07, 0.008, rustCol(y * 3))); });
  // the keel uppermost, shod with rusty iron at the stem
  g.surf(K_WOOD, 0.9);
  { const pts = [], rr = []; for (let k = 0; k <= 22; k++) { const x = lerp(xs - 0.04, xb + 0.02, k / 22); pts.push([x, keelY(Math.min(x, xb - 0.001)) + 0.05 - (k === 22 ? 0.15 : 0), 0]); rr.push(0.065); } limb(g, pts, rr, { nu: 4, nv: nq(40), facets: 4, col: (x, y, z) => mul(WRECK[2], 0.7 + 0.5 * noise3(x * 3, y * 20, z * 20)), capA: true, capB: true, up: [0, 1, 0] }); }
  g.surf(K_PLAIN, 0.7, 0.7);
  for (const x of [1.15, 1.45, 1.7]) g.in(M(x, keelY(x) + 0.05, 0, 0, 0, Math.atan2(keelY(x + 0.05) - keelY(x - 0.05), 0.1) / DEG), () => g.cbox(0.07, 0.17, 0.17, 0.01, rustCol(x * 5)));
  // put a frame onto the hull at (x, t) on side s: local +Z looks outward
  const onHull = (x, t, s, fn, out = 0) => { const p = hull(x, t, s), a = hull(x + 0.02, t, s), b = hull(x, t + 0.02, s); const u = [a[0] - p[0], a[1] - p[1], a[2] - p[2]], w = [b[0] - p[0], b[1] - p[1], b[2] - p[2]]; let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((q) => (q / l) * (n[2] * s < 0 ? -1 : 1)); g.in(M(p[0] + n[0] * out, p[1] + n[1] * out, p[2] + n[2] * out, -Math.asin(clamp(n[1], -1, 1)) / DEG, Math.atan2(n[0], n[2]) / DEG, 0), fn); };
  // the door cut in the side, a hood of boards over it, steps of flat stones
  g.in(M(0.18, 0, beamAt(0.18) + 0.02), () => {
    g.surf(K_PLAIN, 1); g.in(M(0, 0.5, -0.03), () => g.cbox(0.6, 1.0, 0.1, 0.01, [0.015, 0.012, 0.01]));
    g.in(M(0.02, 0.02, 0.02, 0, -8, 0), () => plankDoor(g, 0.5, 0.98, rgb(0x4a4438), 3));
    g.surf(K_WOOD, 0.9);
    for (const e of [-1, 1]) g.in(M(e * 0.32, 0.54, 0.02, 0, 0, e * 1.5), () => g.cbox(0.09, 1.12, 0.1, 0.012, woodTint(WRECK[2], e + 4)));
    g.in(M(0, 1.1, 0.03, 0, 0, -2), () => g.beam(0.82, 0.1, 0.12, 0.014, woodTint(WRECK[4], 6), 3));
    for (let i = 0; i < 6; i++) g.in(M(-0.36 + i * 0.145, 1.24 + (i % 2) * 0.012, 0.06, 32, 0, (hash1(i, 3) - 0.5) * 5), () => g.cbox(0.15, 0.03, 0.3, 0.006, woodTint(WRECK[i % 5], i + 7)));
    for (const e of [-1, 1]) g.beamTo([e * 0.4, 0.9, 0.04], [e * 0.4, 1.14, 0.17], 0.04, 0.04, 0.008, woodTint(WRECK[1], e + 12), 1);
    g.in(M(0, 0.0, 0.09), () => boulder(g, 0.28, 0.06, 0.06, 15, rgb(0x6f6e66), nq(18)));
  });
  // windows let into the planking, lit a sickly yellow-green
  for (const [x, t, s, sd] of [[-0.95, 0.42, 1, 1], [1.02, 0.42, 1, 2], [-0.6, 0.45, -1, 3], [0.7, 0.45, -1, 4]]) onHull(x, t, s, () => {
    g.surf(K_PLAIN, 0.4, 0, 0.6); g.in(M(0, 0, 0, 90, 0, 0), () => g.cyl(0.15, 0.15, 0.012, nq(14), [0.6, 0.75, 0.3], false, true));
    g.surf(K_PLAIN, 0.6, 0.8); g.add(new THREE.TorusGeometry(0.16, 0.035, 6, nq(16)), rustCol(sd)); for (const rz of [0, 90]) g.in(M(0, 0, 0.02, 0, 0, rz), () => g.cbox(0.3, 0.022, 0.02, 0.005, IRON));
  }, 0.03);
  // barnacles and weed round the old waterline
  for (let i = 0; i < 14; i++) { const s = i % 2 ? 1 : -1, x = lerp(xs + 0.2, xb - 0.35, hash1(i, 21)), t = 0.06 + 0.24 * hash1(i, 23); if (s > 0 && Math.abs(x - 0.18) < 0.5) continue; onHull(x, t, s, () => { barnacles(g, 0.16, 9, i); if (i % 3 === 0) g.in(M(0, 0.05, 0.02), () => weed(g, 0.35, i)); }, 0.005); }
  // a crooked stovepipe through the planking, smoking
  { const b = hull(-0.75, 0.86, 1), pp = [[b[0], b[1] - 0.1, b[2]], [b[0] + 0.02, b[1] + 0.4, b[2] + 0.04], [b[0] - 0.08, b[1] + 0.75, b[2] + 0.02], [b[0] - 0.04, b[1] + 1.15, b[2] + 0.06]];
    g.surf(K_PLAIN, 0.75, 0.6); g.tube(pp, 0.07, nq(10), rustCol(9), false);
    for (const p of pp.slice(1)) g.in(M(p[0], p[1], p[2], 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.076, 0.016, 5, nq(12)), mul(RUST, 0.5)));
    const tp = pp[3]; g.in(M(tp[0], tp[1], tp[2], -5, 0, 6), () => { for (let i = 0; i < 3; i++) g.in(M(Math.cos(i * 2.1) * 0.055, 0.04, Math.sin(i * 2.1) * 0.055), () => g.cbox(0.012, 0.1, 0.012, 0.002, IRON)); g.in(M(0, 0.09, 0), () => g.lathe([[0.14, 0], [0.09, 0.04], [0, 0.085]], nq(10), rustCol(4))); });
    g.in(M(tp[0], tp[1] + 0.2, tp[2]), () => smoke(g, 0.08, 1.0, 3, [0.2, 0.21, 0.2], [0.45, 0.47, 0.45], 5, 0.35)); }
  // props under the bilge, nets drying, the ghost lantern by the door
  for (const [x, s, sd] of [[-1.3, 1, 1], [1.2, 1, 2], [-1.0, -1, 3], [0.9, -1, 4], [0.0, -1, 5]]) { const p = hull(x, 0.4, s); pole(g, [x + 0.05 * sd - 0.1, -0.05, s * 0.97], [p[0], p[1], p[2] - s * 0.02], 0.04, 1510 + sd); }
  { const a = hull(-1.5, 0.62, 1), b = hull(-0.5, 0.66, 1); net(g, a, b, [-0.45, 0.04, 0.98], [-1.5, 0.04, 0.98], 12, 9, 0.12);
    g.surf(K_PLAIN, 0.7); for (let k = 0; k <= 5; k++) { const p = v3(a, b, k / 5); g.in(M(p[0], p[1] + 0.01, p[2] + 0.02), () => g.add(new THREE.SphereGeometry(0.04, 7, 5).scale(1, 0.7, 1), k % 2 ? [0.5, 0.36, 0.2] : [0.15, 0.4, 0.3])); } }
  g.in(M(0.74, 0, 0.9, 0, 0, -3), () => { stake(g, 0.035, 1.6, 31, WRECK[2], WRECK[1]); g.surf(K_PLAIN, 0.55, 0.85); g.tube([[0, 1.5, 0], [0.1, 1.62, 0.02], [0.24, 1.58, 0.03]], 0.014, 5, IRON); g.in(M(0.24, 1.58, 0.03), () => ghostLantern(g, 1.15)); });
  // an anchor against the bow, a cask, a lobster pot
  g.in(M(1.55, 0.02, 0.62, -12, 40, 8), () => { g.surf(K_PLAIN, 0.7, 0.75); g.in(M(0, 0.42, 0), () => g.cbox(0.06, 0.84, 0.05, 0.01, rustCol(1))); g.in(M(0, 0.78, 0), () => g.cbox(0.44, 0.05, 0.05, 0.01, woodTint(WRECK[2], 3))); g.tube([[-0.28, 0.24, 0], [-0.2, 0.06, 0], [0, 0.0, 0], [0.2, 0.06, 0], [0.28, 0.24, 0]], 0.03, 6, rustCol(2)); for (const e of [-1, 1]) g.in(M(e * 0.28, 0.24, 0, 0, 0, e * -30), () => prism(g, [[-0.06, -0.05], [0.06, -0.05], [0, 0.1]], 0.02, rustCol(e + 5))); g.in(M(0, 0.89, 0), () => g.add(new THREE.TorusGeometry(0.06, 0.014, 5, 10), rustCol(7))); });
  g.in(M(-1.78, 0.02, 0.74), () => barrel(g, 0.14, 0.34, rgb(0x4e4a40), 3));
  g.in(M(1.2, 0.03, -0.84), () => { g.surf(K_WOOD, 0.9); for (let k = 0; k < 5; k++) g.in(M(-0.2 + k * 0.1, 0, 0, 0, 0, 0), () => g.tube([[0, 0, -0.14], [0, 0.2, -0.1], [0, 0.24, 0], [0, 0.2, 0.1], [0, 0, 0.14]], 0.012, 4, mul(WRECK[1], 1.1), false)); for (const [y, z] of [[0.02, -0.14], [0.02, 0.14], [0.21, -0.09], [0.21, 0.09], [0.25, 0]]) g.in(M(0, y, z), () => g.beam(0.46, 0.02, 0.02, 0.004, mul(WRECK[3], 1.1), 1)); });
}
/** a slab with outline [[x, y], ...] on the local XY plane, depth along Z, centred on z = 0 */
function prismX(g, pts, depth, col) { prism(g, pts, depth, col); }
/** a ship's figurehead: a sea-maiden leaning out over the local origin toward +Z, about 0.9 tall. Sculpted once. */
function figurehead(g, s = 1) {
  const geo = geoOnce('figurehead', () => {
    const skin = 0xa8b49c, hair = 0x8a7a3a, dress = 0x2f6a6a, gold = 0xa88a3a, P = [];
    P.push(...S.limb([[0, -0.52, -0.42], [0, -0.3, -0.16], [0, 0.0, 0.0], [0, 0.3, 0.14]], [0.07, 0.12, 0.13, 0.11]).map((p) => p.color(dress).tint(0.2, 14)));
    P.push(S.ellipsoid(0.13, 0.11, 0.1).at(0, 0.32, 0.17).color(dress).blend(0.04));
    P.push(...S.mirrorX([S.sphere(0.05).at(0.055, 0.34, 0.25).color(dress).blend(0.02)]));
    P.push(S.capsule([0, 0.42, 0.2], [0, 0.5, 0.25], 0.045, 0.04).color(skin).blend(0.02));
    P.push(S.ellipsoid(0.07, 0.085, 0.08).at(0, 0.58, 0.29).color(skin).tint(0.15, 20).blend(0.015));
    P.push(S.capsule([0, 0.59, 0.36], [0, 0.555, 0.375], 0.012, 0.016).color(skin).blend(0.008));
    P.push(...S.mirrorX([S.sphere(0.012).at(0.028, 0.6, 0.355).color(0x1a2018).cut(0.004)]));
    P.push(S.ellipsoid(0.085, 0.09, 0.09).at(0, 0.61, 0.24).color(hair).blend(0.01));
    P.push(...S.mirrorX(S.limb([[0.06, 0.62, 0.2], [0.11, 0.45, 0.08], [0.1, 0.25, -0.04], [0.13, 0.08, -0.14]], [0.05, 0.05, 0.04, 0.02]).map((p) => p.color(hair).blend(0.02).bump(0.004, 40, 'ridges'))));
    P.push(...S.mirrorX(S.limb([[0.13, 0.36, 0.14], [0.17, 0.2, 0.0], [0.15, 0.02, -0.12]], [0.04, 0.035, 0.03]).map((p) => p.color(skin).blend(0.02))));
    P.push(S.torus(0.115, 0.018).rot(25, 0, 0).at(0, 0.1, 0.045).color(gold).pbr(0.4, 0.8).paint(0.004, 0.005));
    P.push(...S.limb([[0, -0.5, -0.4], [0, -0.62, -0.5], [0, -0.6, -0.62]], [0.07, 0.05, 0.02]).map((p) => p.color(gold).blend(0.02)));
    return buildPartGeometry({ prims: P }, { res: 48 * qual(), ao: 0.8 });
  });
  const k = g.kind; g.surf(K_WOOD, 0.8);
  g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(geo));
  g.kind = k;
}
function lighthouse(g) {
  g.moss = 1.3;
  const rockC = rockCol(rgb(0x5e6260), 71, 0.5, 5);
  pad(g, 2, 2, 0.22, rockC, 1551, { sq: 3.2 });
  for (const [x, z, rx, ry, rz, sd] of [[-0.74, 0.7, 0.24, 0.2, 0.2, 1], [0.78, 0.74, 0.2, 0.16, 0.2, 2], [0.76, -0.76, 0.22, 0.22, 0.2, 3], [-0.72, -0.72, 0.2, 0.15, 0.22, 4]]) g.in(M(x, 0.02, z, 0, sd * 40, 0), () => boulder(g, rx, ry, rz, 1560 + sd, rgb(0x62665f), nq(24)));
  const st = stoneStyle(0x8c8e84, { seed: 1570, chip: 0.3, cell: 0.2 / qual(), len: [0.28, 0.5], pal: [rgb(0x8c8e84), rgb(0x8c8e84), rgb(0x7a8078), rgb(0x9a9a8c), rgb(0x6e766e), rgb(0x84887a)] });
  const D = [[0.7, 0.1, 1.7], [0.61, 1.7, 3.3], [0.53, 3.3, 4.7], [0.46, 4.7, 5.9]], lean = 3.6;
  g.in(M(-0.3, 0, 0.0, 0, 0, -lean), () => {
    D.forEach(([R, y0, y1], k) => {
      g.surf(K_STONE, 0.93);
      g.in(M(0, y0 - (k ? 0 : 0.3), 0, 0, k * 37, 0), () => g.bend(R - st.r, () => g.ashlar((R - st.r) * TAU, y1 - y0 + (k ? 0 : 0.3), { ...st, seed: 1571 + k, wrap: true })));
      g.lathe([[R + 0.02, y1 - 0.1], [R + 0.06, y1 - 0.06], [R + 0.06, y1], [(D[k + 1] ? D[k + 1][0] : R) + 0.01, y1 + 0.06]], nq(22), (x, y, z) => mul(st.pal[2], 0.85 + 0.3 * noise3(x * 5, y * 5, z * 5)));
    });
    // sea-growth up the lowest drum, weed hanging from the string courses
    for (let i = 0; i < 16; i++) { const a = hash1(i, 3) * 360, y = 0.3 + 1.6 * hash1(i, 5) * hash1(i, 7); g.in(M(0, y, 0, 0, a, 0).multiply(M(0, 0, D[0][0] + 0.004)), () => barnacles(g, 0.17, 8, i + 40)); }
    for (let i = 0; i < 12; i++) { const k = i % 3, a = i * 97 + 20; g.in(M(0, D[k][2] - 0.07, 0, 0, a, 0).multiply(M(0, 0, D[k][0] + 0.07)), () => weed(g, 0.5 + 0.4 * hash1(i, 9), i, 3)); }
    // the door, slit windows with a green light behind them
    g.in(M(0, 0.2, 0, 0, 14, 0).multiply(M(0, 0, D[0][0] + 0.004)), () => { archFrame(g, 0.5, 1.0, 'round', (x, y, z) => mul(st.pal[3], 0.9 + 0.2 * noise3(x * 9, y * 9, z)), { t: 0.055, fill: [0.02, 0.02, 0.018] }); g.in(M(0, 0, 0.012), () => plankDoor(g, 0.4, 0.72, rgb(0x46423a), 5)); g.in(M(0, -0.1, 0.12), () => { g.surf(K_STONE, 0.93); g.cbox(0.6, 0.14, 0.26, 0.02, stoneTint(st.pal[2], 3, 5)); }); });
    for (const [k, a, y] of [[0, 110, 1.15], [1, 20, 2.4], [1, 200, 2.7], [2, -60, 3.85], [2, 120, 4.1], [3, 30, 5.2]]) g.in(M(0, y, 0, 0, a, 0).multiply(M(0, 0, D[k][0] + 0.004)), () => { g.surf(K_PLAIN, 0.4, 0, 0.45); g.flat([[-0.045, -0.17, 0.004], [0.045, -0.17, 0.004], [0.045, 0.17, 0.004], [-0.045, 0.17, 0.004]], GHOST_LIT); g.surf(K_STONE, 0.9); for (const [dx, dy, w2, h2] of [[0, 0.2, 0.2, 0.06], [0, -0.2, 0.2, 0.06], [-0.075, 0, 0.05, 0.36], [0.075, 0, 0.05, 0.36]]) g.in(M(dx, dy, 0.015), () => g.cbox(w2, h2, 0.04, 0.008, stoneTint(st.pal[3], dx * 9 + dy, 6))); });
    // the gallery: corbelled stone, an iron rail with a gap torn in it
    const gy = D[3][2] + 0.06;
    g.surf(K_STONE, 0.93);
    g.lathe([[0.47, gy - 0.02], [0.6, gy + 0.08], [0.76, gy + 0.14], [0.78, gy + 0.2], [0.78, gy + 0.26], [0, gy + 0.26]], nq(22), (x, y, z) => mul(st.pal[0], 0.85 + 0.3 * noise3(x * 5, y * 5, z * 5)));
    for (let k = 0; k < 10; k++) g.in(M(0, gy + 0.02, 0, 0, k * 36, 0).multiply(M(0, 0, 0.55)), () => g.cbox(0.1, 0.14, 0.26, 0.015, stoneTint(st.pal[4], k, 5)));
    g.surf(K_PLAIN, 0.6, 0.8);
    const railC = rustCol(5);
    for (let k = 0; k < 14; k++) { if (k === 4 || k === 5) continue; g.in(M(0, gy + 0.26, 0, 0, k * (360 / 14), 0).multiply(M(0, 0, 0.73, (k === 3 || k === 6) ? 24 : 0, 0, 0)), () => g.cyl(0.016, 0.014, 0.42, 5, railC, false, true)); }
    for (const y of [0.24, 0.42]) g.in(M(0, gy + 0.26 + y, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.73, 0.014, 4, nq(30), TAU * (12 / 14)).rotateZ(TAU * (6.3 / 14) - Math.PI / 2), railC));
    // the lantern room: an iron cage, the ghost light burning in it, a cap of green copper
    const ly = gy + 0.26;
    g.surf(K_STONE, 0.9); g.in(M(0, ly, 0), () => g.cyl(0.46, 0.44, 0.2, nq(16), (x, y, z) => mul(st.pal[2], 0.85 + 0.3 * noise3(x * 5, y * 5, z * 5)), false, true));
    g.surf(K_PLAIN, 0.55, 0.85);
    for (let k = 0; k < 8; k++) g.in(M(0, ly + 0.2, 0, 0, k * 45, 0).multiply(M(0, 0, 0.4)), () => g.cbox(0.035, 0.9, 0.035, 0.006, [0.05, 0.06, 0.055]));
    for (const y of [0.2, 0.62, 1.08]) g.in(M(0, ly + y, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.4, 0.022, 5, nq(20)), [0.05, 0.06, 0.055]));
    g.surf(K_PLAIN, 0.3, 0, 0.7);
    g.in(M(0, ly + 0.62, 0), () => g.add(new THREE.IcosahedronGeometry(0.2, 2).scale(1, 1.25, 1), (x, y, z) => mul(GHOST_LIT, 0.8 + 0.4 * noise3(x * 9, y * 9, z * 9))));
    g.in(M(0, ly + 0.3, 0), () => fire(g, 0.7, [[0.2, 0.95, 0.4], [0.06, 0.8, 0.22], [0.03, 0.45, 0.2]], 4, 0.7));
    g.surf(K_PLAIN, 0.35, 0.9);
    for (const y of [0.42, 0.62, 0.82]) g.in(M(0, ly + y, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.27, 0.014, 4, nq(18)), mul(BRASS, 0.8)));
    g.surf(K_ROOF, 0.6, 0.5);
    g.sheet(nq(24), 6, (u, v) => { const a = u * TAU, r = 0.56 * Math.pow(1 - v, 0.8) * (1 + 0.04 * Math.abs(Math.sin(a * 4))); return [Math.cos(a) * r, ly + 1.1 + v * 0.62 - 0.08 * Math.sin(Math.PI * v), Math.sin(a) * r]; }, (x, y, z) => mul(mix(VERDIGRIS, COPPER, 0.35 * smooth(0.5, 0.75, noise3(x * 5, y * 5, z * 5))), 0.6 + 0.4 * noise3(x * 12, y * 12, z * 12)), true);
    g.surf(K_PLAIN, 0.5, 0.85);
    g.in(M(0, ly + 1.68, 0), () => { g.add(new THREE.SphereGeometry(0.07, 8, 6), mul(VERDIGRIS, 0.8)); g.cyl(0.012, 0.006, 0.6, 5, IRON, false, true); g.in(M(0, 0.4, 0, 0, 30, 14), () => prism(g, [[-0.22, -0.02], [0.1, -0.02], [0.24, 0.0], [0.1, 0.02], [-0.22, 0.02], [-0.3, 0.07], [-0.3, -0.07]], 0.012, rustCol(3))); });
    // the wreck's figurehead bolted to the tower on a stump of bowsprit, chains to hold it
    g.in(M(0, 3.05, 0, 0, 32, 0).multiply(M(0, 0, D[1][0] - 0.06, 24, 0, 0)), () => {
      g.surf(K_WOOD, 0.9);
      g.in(M(0, -0.05, 0.42, 0, 90, 0), () => g.in(M(0, 0, 0, 0, 0, 0), () => g.beam(1.1, 0.13, 0.13, 0.02, woodTint(WRECK[2], 7), 5)));
      for (const e of [-1, 1]) g.in(M(e * 0.12, -0.2, 0.2, 0, e * 14, 0), () => prism(g, [[-0.3, -0.25], [0.34, -0.1], [0.4, 0.2], [-0.3, 0.3]].map(([a, b]) => [b, a]), 0.03, (x, y) => mul(WRECK[(Math.floor(y * 9) % 5 + 5) % 5], 0.8 + 0.3 * noise3(x * 5, y * 30, 3))));
      g.in(M(0, -0.12, 0.72, 40, 0, 0), () => figurehead(g, 1.05));
      g.surf(K_PLAIN, 0.6, 0.8); g.in(M(0, -0.05, 0.3, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.1, 0.02, 5, 10), rustCol(2)));
    });
    { const a0 = 32 * DEG, top = [Math.sin(a0 + 0.5) * 0.76, gy + 0.2, Math.cos(a0 + 0.5) * 0.76], mid = [Math.sin(a0) * 1.0, 3.55, Math.cos(a0) * 1.0]; chain(g, [top, v3(top, mid, 0.5).map((q, i) => (i === 1 ? q - 0.25 : q)), mid], 0.065, [0.09, 0.07, 0.06], 0.7); }
    chain(g, [[-0.62, gy + 0.2, 0.4], [-0.72, 3.4, 0.5], [-0.66, 1.9, 0.55], [-0.8, 0.5, 0.62]], 0.075, [0.09, 0.07, 0.06], 0.7);
    g.in(M(-0.8, 0.42, 0.62, 0, 30, 20), () => { g.surf(K_PLAIN, 0.7, 0.7); g.add(new THREE.TorusGeometry(0.12, 0.03, 5, 12), rustCol(8)); });
  });
  // wreckage at its foot: ribs of a boat, a spar, a ghost lantern on a crooked post
  for (let k = 0; k < 4; k++) g.in(M(0.5 + k * 0.13, 0.12, 0.72 - k * 0.04, 0, 20, 0), () => { g.surf(K_WOOD, 0.9); g.tube([[0, 0, -0.2], [0.0, 0.2, -0.24], [0.02, 0.5 - 0.06 * k, -0.2]], 0.025, 5, mul(WRECK[k % 5], 0.9), true); });
  pole(g, [0.3, 0.14, 0.9], [0.98, 0.2, 0.55], 0.035, 1580);
  g.in(M(-0.86, 0.1, 0.84, 4, 0, 8), () => { stake(g, 0.035, 1.5, 33, WRECK[2], WRECK[1]); g.surf(K_PLAIN, 0.55, 0.85); g.tube([[0, 1.42, 0], [0.08, 1.54, 0.03], [0.2, 1.5, 0.05]], 0.014, 5, IRON); g.in(M(0.2, 1.5, 0.05), () => ghostLantern(g, 1.1)); });
}

// =====================================================================================================
// exports
// =====================================================================================================
// id: [footprint along X, along Z, builder]. A piece that arrives with its footprint the other way round is the
// same geometry turned a quarter (as civic.js turns its long pieces).
const BUILDERS = {
  ironbound_basaltMonolith: [2, 2, basaltMonolith], ironbound_skullAltar: [3, 3, skullAltar],
  screaming_warpSpire: [3, 3, warpSpire], screaming_fungalGarden: [3, 3, fungalGarden],
  cloven_herdstone: [2, 2, herdstone], cloven_hideTent: [2, 2, hideTent], fimbul_longhouse: [5, 3, longhouse], fimbul_whaleShrine: [2, 2, whaleShrine],
  ashur_forgeZiggurat: [6, 6, forgeZiggurat], ashur_blastFurnace: [3, 3, blastFurnace], greenhide_idol: [2, 2, idol], greenhide_boneTower: [2, 2, boneTower],
  skar_reactor: [3, 3, reactor], skar_scaffoldWarren: [4, 3, scaffoldWarren], crimson_mausoleum: [3, 4, mausoleum], crimson_gallows: [2, 1, gallows],
  khemet_pyramid: [7, 7, pyramid], khemet_sphinxStatue: [2, 4, sphinxStatue], drowned_hullHouse: [4, 2, hullHouse], drowned_lighthouse: [2, 2, lighthouse],
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
