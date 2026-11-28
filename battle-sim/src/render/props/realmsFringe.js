// Landmark buildings of the fringe realms: twenty-two showpieces, two for each of eleven realms.
//
//   structures[def.model](def, w, h, place) -> Mesh centred on its footprint, resting on y = 0
//       balor       balor_basaltCrag balor_fogStones                 kurgan      kurgan_wagonYurt kurgan_burialMound
//       hearthmoot  hearthmoot_burrow hearthmoot_watermill           baobab      baobab_baobabTree baobab_grassDome
//       nagavar     nagavar_serpentTemple nagavar_bloodWell          pearlfleet  pearlfleet_lighthouse pearlfleet_amphitheatre
//       glimmer     glimmer_observatory glimmer_windmillLab          khanate     khanate_skullTower khanate_winterCamp
//       emerald     emerald_sunTemple emerald_riverCitadel           deeproot    deeproot_nestTree deeproot_spiritTotem
//       goldsands   goldsands_palace goldsands_souk
//
// Built like realmsRuin.js and with the same construction kit (repeated here because that module keeps it private):
// everything is emitted into one vertex-coloured geometry for the shared sculpt material, built once per model and
// detail preset; every placement shares it (a piece placed turned shares a turned copy). Fog and spray that should
// read as soft and see-through go into a second geometry drawn with a translucent copy of the material, hung on the
// main mesh as a child that casts no shadow. Nothing is built at module load and nothing here calls Math.random():
// every shape is seeded. Fronts face +Z.
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
function mist(g, w, h, seed = 0, n = 10, col = [0.33, 0.37, 0.42]) {
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
// Fringe kit: pieces the twenty-two buildings below share
// =====================================================================================================
const P = {
  balor: rgb(0x6a7a5a), bronze: rgb(0x8a6a3a), bone: rgb(0xd8c8a0),
  kFelt: rgb(0x6a4a2a), kRed: rgb(0x8a2a1a), kGold: rgb(0xc8a060),
  hGreen: rgb(0x4a7a3a), hCream: rgb(0xd8b880),
  raffia: rgb(0xc8a050), beads: rgb(0xe8e0d0), ochre: rgb(0xc87a3a),
  nGreen: rgb(0x3a7a4a), nRed: rgb(0x6a1a1a), nGold: rgb(0xd8b03a),
  turq: rgb(0x2aa8b8), pWhite: rgb(0xe8f0f0), silver: rgb(0xc0d0d8), pearl: rgb(0xf0e8d8),
  velvet: rgb(0x6a2a5a), teal: rgb(0x2a5a6a), brass: rgb(0xc8a040),
  khDark: rgb(0x2a2a3a), khRed: rgb(0x8a1a1a), lacquer: rgb(0x6a2a1a), khGold: rgb(0xc8a040),
  eGold: rgb(0xd8b03a), jade: rgb(0x2a8a5a),
  leaf: rgb(0x3a6a2a), poison: rgb(0xe83a3a), yellow: rgb(0xe8d83a),
  gWhite: rgb(0xe8e0d0), gTurq: rgb(0x2a8a9a), gGold: rgb(0xd8b03a),
};
const GRASS = [rgb(0x527a32), rgb(0x68903e), rgb(0x4a722c), rgb(0x7a8a44)];
/** turf: blotched greens with a little earth showing where it is steep */
const grassCol = (seed = 0, earth = rgb(0x5a4630)) => (x, y, z, nx, ny) => {
  const n = noise3(x * 2.3 + seed, y * 2.3, z * 2.3), f = noise3(x * 11 + seed, y * 11, z * 11);
  const c = mix(GRASS[0], GRASS[1], smooth(0.3, 0.7, n));
  return mul(mix(c, earth, smooth(0.4, 0.05, ny ?? 1) * 0.6 + smooth(0.78, 0.88, f) * 0.2), 0.78 + 0.3 * f);
};
/** straw thatch: streaks running down the slope (local v) */
const thatchCol = (base = rgb(0xb89a58), seed = 0) => (x, y, z, nx, ny, nz, u = 0, v = 0) => {
  const s = noise3(x * 37 + seed, (y + z) * 2.5, (x - z) * 9), n = noise3(x * 3 + seed, y * 3, z * 3);
  return mul(mix(base, mul(base, 0.5), smooth(0.5, 0.85, n) * 0.6), 0.6 + 0.6 * s);
};
function water(g, x0, x1, z0, z1, y, seed = 0, col = [0.1, 0.36, 0.42], glow = 0.14) {
  g.surf(K_PLAIN, 0.12, 0.25, glow);
  const nu = Math.max(2, Math.round((x1 - x0) / 0.14)), nv = Math.max(2, Math.round((z1 - z0) / 0.14));
  g.sheet(nu, nv, (u, v) => { const x = lerp(x0, x1, u), z = lerp(z0, z1, v); return [x, y + 0.006 * Math.sin(x * 19 + seed) * Math.sin(z * 17 + seed * 2), z]; }, (x, yy, z) => mix(mul(col, 0.65), mul(col, 1.7), smooth(0.45, 0.75, noise3(x * 5 + seed, 1, z * 5))), false, true);
}
/** a round pool of water on the local origin, radius R (or rx, rz) */
function pond(g, rx, rz, y, seed = 0, col = [0.1, 0.36, 0.42], glow = 0.14) {
  g.surf(K_PLAIN, 0.1, 0.25, glow);
  g.sheet(nq(36), nq(8), (u, v) => { const a = u * TAU; return [Math.cos(a) * rx * v, y + 0.005 * Math.sin(u * 40 + v * 9 + seed), Math.sin(a) * rz * v]; }, (x, yy, z) => mix(mul(col, 0.6), mul(col, 1.6), smooth(0.45, 0.75, noise3(x * 5 + seed, 1, z * 5))), true);
}
/** a soft bank of fog: overlapping flattened puffs around the local origin (drawn into the translucent geometry) */
function fogBank(f, rx, ry, rz, seed = 0, n = 6, col = [0.66, 0.71, 0.68], glow = 0.1) {
  if (!f) return;
  const rnd = rng(seed * 113 + 7);
  f.surf(K_PLAIN, 1, 0, glow);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.7, s = 0.45 + 0.55 * rnd();
    f.in(M(Math.cos(a) * rx * d, ry * (0.2 + 0.5 * rnd()), Math.sin(a) * rz * d, 0, rnd() * 360, 0), () =>
      f.add(new THREE.IcosahedronGeometry(1, 1).scale(rx * 0.6 * s, ry * (0.35 + 0.3 * rnd()), rz * 0.6 * s), (x, y, z) => mul(col, 0.85 + 0.25 * noise3(x * 2 + seed, y * 4, z * 2) + 0.1 * smooth(-0.2, 0.5, y))));
  }
}
/** a cartwheel standing in the local XY plane (axle along Z) on its centre: rim, felloes, spokes, hub */
function wheel(g, R, wd, spokes, wood, seed = 0, iron = IRON) {
  g.surf(K_WOOD, 0.85);
  g.add(new THREE.TorusGeometry(R - 0.035, 0.045, 6, nq(28)).scale(1, 1, wd / 0.09), woodTint(wood, seed));
  g.surf(K_PLAIN, 0.55, 0.8);
  g.add(new THREE.TorusGeometry(R, 0.018, 4, nq(28)).scale(1, 1, wd / 0.036), iron);
  g.surf(K_WOOD, 0.85);
  for (let i = 0; i < spokes; i++) g.in(M(0, 0, 0, 0, 0, (i * 360) / spokes), () => g.in(M(0, R * 0.5, 0, 0, 0, 90), () => g.beam(R - 0.06, 0.035, 0.03, 0.006, woodTint(mul(wood, 0.9), seed + i), 1)));
  g.in(M(0, 0, -wd * 0.9, 90, 0, 0), () => g.lathe([[0.04, 0], [0.09, 0.05], [0.1, wd * 0.9], [0.09, wd * 1.8 - 0.05], [0.05, wd * 1.8]], nq(10), mul(wood, 0.75)));
  g.surf(K_PLAIN, 0.5, 0.8); g.in(M(0, 0, wd * 0.9 + 0.01), () => g.stud(0.05, iron, 6));
}
/** a toothed gear standing in the local XY plane facing +Z */
function gear(g, R, teeth, th, col, o = {}) {
  g.surf(K_PLAIN, o.rough ?? 0.35, o.metal ?? 0.9);
  g.add(new THREE.TorusGeometry(R * 0.82, R * 0.1, 5, nq(teeth * 2)).scale(1, 1, th / (R * 0.2)), col);
  for (let i = 0; i < teeth; i++) g.in(M(0, 0, 0, 0, 0, (i * 360) / teeth), () => g.in(M(0, R * 0.94, 0), () => g.cbox(R * 0.16, R * 0.18, th, 0.004, col)));
  const sp = o.spokes ?? 5;
  for (let i = 0; i < sp; i++) g.in(M(0, 0, 0, 0, 0, (i * 360) / sp + 10), () => g.in(M(0, R * 0.42, 0), () => g.cbox(R * 0.12, R * 0.78, th * 0.7, 0.004, mul(col, 0.85))));
  g.in(M(0, 0, 0, 90, 0, 0), () => g.cyl(R * 0.18, R * 0.18, th * 1.3, nq(10), mul(col, 0.7), true, true));
}
/** a round porthole window on the local XY plane facing +Z: a metal ring, cross bars and glass alight */
function porthole(g, r, ring, glass, glow = 0.8, bars = true) {
  g.surf(K_PLAIN, 0.3, 0, glow);
  g.in(M(0, 0, 0.012, 90, 0, 0), () => g.cyl(r, r, 0.001, nq(14), glass, false, true));
  g.surf(K_PLAIN, 0.35, 0.85);
  g.in(M(0, 0, 0.02), () => g.add(new THREE.TorusGeometry(r, r * 0.16, 5, nq(16)), ring));
  if (bars) for (const a of [0, 90]) g.in(M(0, 0, 0.018, 0, 0, a), () => g.cbox(r * 2, r * 0.1, 0.012, 0.002, ring));
}
/** a sack of flour or grain sitting on the local origin */
function sack(g, s, col, seed = 0) {
  g.surf(K_CLOTH, 0.95);
  g.sheet(nq(14), nq(8), (u, v) => {
    const a = u * TAU, t = v, sl = 1 + 0.08 * noise3(Math.cos(a) * 2 + seed, t * 3, Math.sin(a) * 2);
    const r = (t < 0.75 ? 0.2 * Math.sin(Math.PI * (0.15 + t * 0.95)) + 0.04 : lerp(0.13, 0.03, (t - 0.75) / 0.25)) * sl * s;
    return [Math.cos(a) * r * 1.15, (t < 0.75 ? t * 0.4 : 0.3 + (t - 0.75) * 0.5) * s, Math.sin(a) * r];
  }, (x, y, z) => mul(col, 0.75 + 0.3 * noise3(x * 20 + seed, y * 20, z * 20)), true, true);
  g.in(M(0, 0.38 * s, 0, 0, 0, 0), () => rope(g, [[-0.04 * s, 0, 0.03 * s], [0.04 * s, 0.005, 0.035 * s], [0.05 * s, -0.01, -0.03 * s], [-0.05 * s, 0, -0.02 * s]], 0.008 * s, rgb(0x8a7040), 4));
}
/** a clay pot or jar standing on the local origin, h high; stripe paints a band */
function jar(g, h, col, o = {}) {
  g.surf(K_PLAIN, o.rough ?? 0.75, 0, o.glow || 0);
  const p = (o.prof || [[0.0, 0], [0.22, 0.02], [0.34, 0.25], [0.36, 0.45], [0.26, 0.75], [0.14, 0.86], [0.15, 0.95], [0.19, 1], [0.15, 1]]).map(([r, y]) => [r * h, y * h]);
  g.lathe(p, nq(o.seg || 12), (x, y, z) => mul(o.stripe && Math.abs(y / h - 0.5) < 0.07 ? o.stripe : o.stripe2 && Math.abs(y / h - 0.66) < 0.03 ? o.stripe2 : col, 0.8 + 0.3 * noise3(x * 13, y * 13, z * 13)));
}
/** tug: a pole topped with a metal disc and spear point, long hair hanging from under it */
function tug(g, h, hair, metal, seed = 0) {
  g.surf(K_WOOD, 0.85); g.cyl(0.025, 0.02, h, 6, woodTint(rgb(0x5a4028), seed), false, true);
  g.surf(K_PLAIN, 0.35, 0.9);
  g.in(M(0, h, 0), () => { g.cyl(0.03, 0.012, 0.28, 5, metal, false, true); g.in(M(0, 0.07, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.1, 0.012, 4, 12), metal)); });
  g.surf(K_CLOTH, 0.95);
  const rnd = rng(seed * 31 + 5), n = nq(14);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, l = 0.45 + 0.25 * rnd(), sw = 0.05 + 0.06 * rnd();
    g.tube([[Math.cos(a) * 0.035, h - 0.02, Math.sin(a) * 0.035], [Math.cos(a) * 0.08, h - 0.12, Math.sin(a) * 0.08], [Math.cos(a) * 0.1 + sw, h - l * 0.6, Math.sin(a) * 0.1], [Math.cos(a) * 0.09 + sw * 1.8, h - l, Math.sin(a) * 0.09]], [0.018, 0.02, 0.016, 0.004], 4, mul(hair, 0.7 + 0.45 * rnd()), false);
  }
}
/** a coral growth on the local origin: branching tubes (fan = flat lattice instead) */
function coral(g, s, col, seed = 0, fan = false) {
  const rnd = rng(seed * 41 + 9);
  g.surf(K_PLAIN, 0.8);
  if (fan) {
    g.sheet(nq(10), nq(6), (u, v) => { const a = (u - 0.5) * 2.2; return [Math.sin(a) * v * 0.32 * s, Math.cos(a) * v * 0.36 * s, 0.03 * Math.sin(u * 9 + v * 5) * s]; }, (x, y, z, nx, ny, nz, u, v) => mul(col, (Math.abs(Math.sin(u * 50)) < 0.4 || Math.abs(Math.sin(v * 30)) < 0.4 ? 1.05 : 0.55)));
    return;
  }
  const branch = (p, dir, len, r, depth) => {
    const e = [p[0] + dir[0] * len, p[1] + dir[1] * len, p[2] + dir[2] * len], m = v3(p, e, 0.5);
    g.tube([p, [m[0] + (rnd() - 0.5) * 0.03 * s, m[1], m[2] + (rnd() - 0.5) * 0.03 * s], e], [r, r * 0.85, r * 0.7], 5, (x, y, z) => mul(col, 0.75 + 0.35 * (y / s)), true);
    if (depth > 0) for (let k = 0; k < 2; k++) { const a = rnd() * TAU, d = [dir[0] * 0.6 + Math.cos(a) * 0.5, dir[1] * 0.8, dir[2] * 0.6 + Math.sin(a) * 0.5], l = Math.hypot(...d); branch(e, d.map((q) => q / l), len * 0.72, r * 0.72, depth - 1); }
  };
  for (let k = 0; k < 3; k++) { const a = k * 2.1 + rnd(); branch([0, -0.02, 0], [Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35].map((q) => q / 1.12), 0.16 * s, 0.03 * s, 2); }
}
/** a string of bone talismans hanging from the local origin: little bones, a ring, a skull at the foot */
function talisman(g, l, seed = 0, withSkull = true) {
  const rnd = rng(seed * 17 + 3);
  rope(g, [[0, 0, 0], [0.01, -l * 0.5, 0.01], [0, -l, 0]], 0.008, rgb(0x6a5a40), 4);
  g.surf(K_PLAIN, 0.7);
  for (let i = 0; i < 3; i++) { const y = -l * (0.25 + i * 0.22), d = (rnd() - 0.5) * 0.04; g.tube([[-0.07, y + d, 0.01], [-0.06, y + d * 0.5, 0.012], [0.06, y - d * 0.5, 0.012], [0.07, y - d, 0.01]], [0.016, 0.009, 0.009, 0.016], 4, boneCol(seed + i), true); }
  g.surf(K_PLAIN, 0.4, 0.85);
  g.in(M(0, -l * 0.12, 0.01), () => g.add(new THREE.TorusGeometry(0.05, 0.008, 4, 10), P.bronze));
  if (withSkull) g.in(M(0, -l - 0.2, 0, 0, rnd() * 40 - 20, 0), () => skull(g, 0.75, true));
  else { g.surf(K_PLAIN, 0.6); g.in(M(0, -l - 0.04, 0), () => g.add(new THREE.OctahedronGeometry(0.045, 0).scale(0.6, 1.3, 0.3), P.bone)); }
}
/** a carved stone or wood serpent head rearing from the origin toward +Z, s ~ its length */
function serpentHead(g, s, col, eye = [0.9, 0.7, 0.1]) {
  const geo = geoOnce('serpentHead', () => {
    const c = 0x8a8a8a, Pp = [];
    Pp.push(S.ellipsoid(0.09, 0.06, 0.15).at(0, 0, 0.1).color(c).tint(0.12, 20));
    Pp.push(S.ellipsoid(0.07, 0.035, 0.1).at(0, -0.035, 0.16).color(c).blend(0.02));
    Pp.push(...S.mirrorX([S.ellipsoid(0.025, 0.02, 0.03).at(0.06, 0.035, 0.13).color(c).blend(0.012)]));
    Pp.push(S.box(0.12, 0.01, 0.12, 0.004).at(0, -0.012, 0.2).color(0x222222).cut(0.004));
    Pp.push(S.capsule([0, -0.02, -0.15], [0, 0, 0.06], 0.05, 0.065).color(c).blend(0.04));
    for (let i = 0; i < 5; i++) Pp.push(S.ellipsoid(0.04, 0.012, 0.02).at(0, 0.055 - i * 0.002, 0.06 - i * 0.04).color(c).blend(0.01));
    return buildPartGeometry({ prims: Pp }, { res: 17 * qual(), ao: 0.8 });
  });
  const k = g.kind; g.surf(K_STONE, 0.85);
  g.in(M(0, 0, 0, 0, 0, 0, s / 0.3), () => g.add(geo, (x, y, z) => mul(col, 0.75 + 0.35 * noise3(x * 20, y * 20, z * 20))));
  g.surf(K_PLAIN, 0.3, 0, 0.6);
  for (const e of [-1, 1]) g.in(M(e * 0.07 * s / 0.3, 0.035 * s / 0.3, 0.145 * s / 0.3), () => g.add(new THREE.SphereGeometry(0.012 * s / 0.3, 6, 4), eye));
  g.kind = k;
}
/** a hood of seven serpent heads fanned on the local XY plane (facing +Z), standing on the origin, s high */
function sevenHeads(g, s, col) {
  const tint = (x, y, z) => mul(col, 0.8 + 0.3 * noise3(x * 9 / s, y * 9 / s, z * 9 / s));
  // the hood: a thick fan of ribbed scales spread behind the heads
  const fan = [[0, -0.1 * s]];
  for (let i = 0; i <= 14; i++) { const a = (i / 14 - 0.5) * 2.5, r = s * (0.78 + 0.08 * Math.cos(i * Math.PI)); fan.push([Math.sin(a) * r, Math.cos(a) * r * 0.95]); }
  g.surf(K_STONE, 0.85);
  g.in(M(0, 0, -0.02 * s), () => prism(g, fan, 0.09 * s, (x, y) => mul(col, (0.72 + 0.25 * Math.abs(Math.sin(Math.atan2(x, y) * 14))) * (0.85 + 0.2 * noise3(x * 9 / s, y * 9 / s, 1))), [0, 0.2 * s]));
  g.in(M(0, 0.1 * s, 0.03 * s), () => prism(g, fan.map(([x, y]) => [x * 0.55, y * 0.55]), 0.06 * s, mul(col, 1.1), [0, 0.1 * s]));
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.36, r = s * (i === 3 ? 0.86 : 0.76);
    g.in(M(Math.sin(a) * r, Math.cos(a) * r * 0.95, 0.05 * s, 18, a * 20, 0), () => serpentHead(g, (i === 3 ? 0.5 : 0.42) * s, col));
  }
  g.surf(K_STONE, 0.85);
  limb(g, [[0, -0.12 * s, 0], [0, 0.1 * s, 0.05 * s], [0, 0.3 * s, 0.06 * s]], [0.11 * s, 0.1 * s, 0.07 * s], { nu: nq(8), nv: nq(5), col: tint });
}
/** a hanging vine from the origin down -Y, n strands with leaves */
function vines(g, w, l, seed = 0, o = {}) { creeper(g, w, -l, seed, { n: o.n || 3, leaves: o.leaves ?? 7, size: o.size || 0.06, leaf: o.leaf, bloom: o.bloom, bloomP: o.bloomP }); }
/** a clump of leaves (a bush or a branch-end cluster) around the origin, r across */
function leafClump(g, r, seed = 0, pal = [rgb(0x3a6a2a), rgb(0x4a7a32), rgb(0x2f5a24)], n = 5, o = {}) {
  const rnd = rng(seed * 59 + 1);
  g.surf(K_LEAF, 0.85, 0, o.glow || 0);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, d = r * 0.5 * Math.sqrt(rnd()), s = r * (0.4 + 0.35 * rnd()), c = pal[Math.floor(rnd() * pal.length)];
    g.in(M(Math.cos(a) * d, (rnd() - 0.3) * r * 0.4, Math.sin(a) * d, rnd() * 60, rnd() * 360, 0), () => g.add(new THREE.IcosahedronGeometry(s, 1).scale(1, o.flat ?? 0.6, 1), (x, y, z, nx, ny) => mul(c, (0.6 + 0.4 * smooth(-0.6, 0.8, ny)) * (0.8 + 0.4 * noise3(x * 9 + seed, y * 9, z * 9)))));
  }
}
/** a round-topped door on the local XY plane facing +Z (planks, two metal bands, a ring); w wide, h to the crown */
function roundDoor(g, w, h, wood, band, seed = 0, o = {}) {
  const sp = h - w / 2, n = Math.max(3, Math.round(w / 0.12)), out = [];
  for (let i = 0; i <= 12; i++) { const a = Math.PI * (i / 12); out.push([Math.cos(a) * w / 2, sp + Math.sin(a) * w / 2]); }
  g.surf(K_PLAIN, 1); g.in(M(0, 0, -0.01), () => g.poly([[-w / 2, 0, 0], [w / 2, 0, 0], ...out.map(([x, y]) => [x, y, 0])], 0, 0, 1, [0.02, 0.018, 0.015]));
  g.surf(K_WOOD, 0.9);
  for (let i = 0; i < n; i++) { const x = -w / 2 + ((i + 0.5) * w) / n, top = sp + Math.sqrt(Math.max(0, (w / 2) ** 2 - x * x)) - 0.015; g.in(M(x, top / 2, 0.015, 0, 0, 90), () => g.beam(top, w / n - 0.008, 0.03, 0.006, woodTint(mul(wood, 0.8 + 0.35 * hash1(i, seed)), seed + i), 3)); }
  g.surf(K_PLAIN, 0.45, 0.85);
  for (const y of o.bands || [0.2, 0.6]) g.in(M(0, h * y, 0.035), () => g.cbox(w * 0.98, 0.05, 0.012, 0.004, band));
  if (o.studs !== false) for (const y of o.bands || [0.2, 0.6]) for (let i = 0; i < 5; i++) g.in(M(-w * 0.4 + i * w * 0.2, h * y, 0.042), () => g.stud(0.012, mul(band, 1.2), 5));
  g.in(M(w * (o.ringX ?? 0.28), h * 0.42, 0.05), () => g.add(new THREE.TorusGeometry(0.04, 0.009, 4, 10), band));
}
/** a striped awning or canopy cloth sheet between four corners (a b along the top, d c the front), sagging */
function canopy(g, a, b, c, d, c1, c2, n = 6, sag = 0.06, seed = 0) {
  g.surf(K_CLOTH, 0.9);
  const at = (u, v) => { const p = v3(v3(a, b, u), v3(d, c, u), v); return [p[0], p[1] - sag * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) - 0.01 * Math.sin(u * 30 + seed), p[2]]; };
  // one strip per stripe, so the colours stay crisp
  for (let i = 0; i < n; i++) g.sheet(2, nq(6), (u, v) => at((i + u) / n, v), (x, y, z) => mul(i % 2 ? c1 : c2, 0.85 + 0.2 * noise3(x * 6 + seed, y * 6, z * 6)));
  // scalloped valance along the front edge
  for (let i = 0; i < n * 2; i++) { const u0 = i / (n * 2), u1 = (i + 1) / (n * 2), p0 = v3(d, c, u0), p1 = v3(d, c, u1), pm = v3(d, c, (u0 + u1) / 2); g.flat([p0, p1, [pm[0], pm[1] - 0.09, pm[2]]], mul(Math.floor(((u0 + u1) / 2) * n) % 2 ? c1 : c2, 0.8)); }
}

// snow (as the frozen realms lay it)
const snowCol = (seed = 0) => (x, y, z, nx, ny) => mul(mix([0.6, 0.7, 0.86], SNOW, smooth(0.2, 0.8, ny ?? 1)), 0.9 + 0.14 * noise3(x * 4 + seed, y * 4, z * 4));
const snowGround = (earth, seed, amt = 0.5) => (x, y, z) => mix(mul(earth, 0.65 + 0.6 * fbm3(x * 3, y * 5, z * 3, 3)), SNOW, smooth(0.62 - amt * 0.4, 0.72 - amt * 0.4, noise3(x * 1.3 + seed, 2, z * 1.3)));
function drift(g, rx, ry, rz, seed = 0) { g.surf(K_PLAIN, 0.6); g.sheet(nq(14), nq(5), (u, v) => { const a = u * TAU, k = 1 + 0.25 * noise3(Math.cos(a) * 1.3 + seed, 1, Math.sin(a) * 1.3); return [Math.cos(a) * rx * v * k, v > 0.99 ? -0.03 : ry * Math.pow(1 - v * v, 0.7), Math.sin(a) * rz * v * k]; }, snowCol(seed), true); }

// =====================================================================================================
// Balor: bog basalt, bronze, bone and fog
// =====================================================================================================
const BOG_ROCK = rgb(0x45483f), PEAT = rgb(0x3a2e22), FOG = [0.7, 0.77, 0.72], WITCH = [0.45, 0.95, 0.55];
const bogRock = (seed, moss = 0.75) => (x, y, z, nx, ny) => {
  const c = rockCol(mix(BOG_ROCK, P.balor, 0.1 + 0.3 * noise3(x * 0.8 + seed, y * 0.5, z * 0.8)), seed, moss, 4)(x, y, z, nx, ny);
  return mix(c, [0.06, 0.07, 0.05], smooth(0.9, 0.2, y) * 0.35);   // wet and dark toward the bog
};
const peatCol = (seed = 0) => (x, y, z, nx, ny) => mix(mul(PEAT, 0.7 + 0.5 * fbm3(x * 3 + seed, y * 5, z * 3, 2)), [0.16, 0.24, 0.08], smooth(0.45, 0.7, noise3(x * 1.9 + seed, 2, z * 1.9)) * smooth(0.2, 0.8, ny ?? 1) * 0.8);
/** a basalt pillar standing on the local origin: few crisp sides, jagged top */
function crag(g, r, h, seed, o = {}) {
  g.surf(K_STONE, 0.9);
  const tw = o.twist ?? 0.5, lean = o.lean || [0, 0];
  const pts = [], radii = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5, a = seed + t * tw * 3; pts.push([lean[0] * t * t * h + Math.cos(a) * r * 0.25 * t, -0.25 + t * (h + 0.25), lean[1] * t * t * h + Math.sin(a) * r * 0.25 * t]); radii.push(r * (1 - 0.82 * Math.pow(t, 1.3)) + (i === 5 ? 0.01 : 0)); }
  limb(g, pts, radii, { nu: o.facets || 6, nv: nq(o.nv || 14), facets: o.facets || 6, amp: o.amp ?? 0.16, seed, nf: 2.2, flat: o.flat || [1, 0.85], col: bogRock(seed, o.moss ?? 0.7), capB: true });
}
// the core of the crag: [height, radius] stations, and its section's squash
const CORE = [[-0.5, 1.62], [1.05, 1.38], [2.6, 1.02], [4.15, 0.6], [5.7, 0.08]], CORE_F = [1.15, 0.84];
/** about where the crag's face is at height y, looking out at azimuth a (degrees, 0 = +Z) */
function coreR(y, a) {
  let r = CORE[CORE.length - 1][1];
  for (let i = 0; i < CORE.length - 1; i++) if (y <= CORE[i + 1][0]) { r = lerp(CORE[i][1], CORE[i + 1][1], (y - CORE[i][0]) / (CORE[i + 1][0] - CORE[i][0])); break; }
  const s = Math.sin(a * DEG), c = Math.cos(a * DEG);
  return (r * 0.95) / Math.hypot(s / CORE_F[0], c / CORE_F[1]);
}
function basaltCrag(g, fog) {
  g.moss = 0.3;
  pad(g, 5, 4, 0.14, peatCol(3), 401, { sq: 3 });
  // the crag: a great twisted knuckle of basalt, sunk to its shoulders in the bog
  g.surf(K_STONE, 0.92);
  limb(g, CORE.map(([y], i) => [0.08 * Math.sin(i * 1.9), y, 0.08 * Math.cos(i * 2.3)]), CORE.map((c) => c[1]), { nu: 8, nv: nq(18), facets: 8, amp: 0.2, seed: 7, nf: 2.4, flat: CORE_F, col: bogRock(7, 0.35), capB: true });
  // spurs winding round it like the strands of a rope
  const spurs = [[0.4, 1.5, 4.3, 0.6], [1.5, 1.6, 3.2, 0.62], [2.6, 1.5, 4.8, 0.6], [3.7, 1.65, 2.8, 0.64], [4.7, 1.5, 3.9, 0.56], [5.6, 1.6, 2.4, 0.55]];
  spurs.forEach(([a0, R, hh, r], k) => {
    const pts = [], radii = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6, a = a0 + t * 2.1, rr = R * (1 - 0.6 * t); pts.push([Math.cos(a) * rr * 1.22, -0.3 + t * hh, Math.sin(a) * rr * 0.9]); radii.push(r * (1 - 0.85 * Math.pow(t, 1.2)) + (i === 6 ? 0.01 : 0)); }
    limb(g, pts, radii, { nu: 5, nv: nq(14), facets: 5, amp: 0.2, seed: 20 + k, nf: 2.6, flat: [1, 0.7], col: bogRock(20 + k, 0.35), capB: true });
  });
  // lesser fangs and fallen blocks round the foot
  for (const [x, z, r, h, sd] of [[-2.05, 1.2, 0.3, 1.3, 1], [2.1, -1.25, 0.34, 1.6, 2], [-1.9, -1.35, 0.26, 1.0, 3], [2.15, 1.1, 0.22, 0.8, 4], [-0.9, -1.75, 0.22, 0.9, 5]]) g.in(M(x, 0, z, (hash1(sd, 1) - 0.5) * 16, sd * 50, (hash1(sd, 2) - 0.5) * 16), () => crag(g, r, h, 40 + sd));
  for (const [x, z, sd] of [[1.5, 1.55, 1], [-1.45, 1.65, 2], [0.8, -1.7, 3]]) g.in(M(x, 0, z, 0, sd * 70, 0), () => boulder(g, 0.26, 0.2, 0.22, 450 + sd, BOG_ROCK, nq(24)));
  // the gate: a portal of dressed basalt pushed out of the rock, bronze-bound doors, a bone lintel
  const st = stoneStyle(0x4a5446, { seed: 410, chip: 0.3, course: 0.16, len: [0.22, 0.4], pal: [rgb(0x4a5446), rgb(0x434c40), rgb(0x55604f), rgb(0x3c4438)] });
  g.in(M(0, 0, 1.28), () => {
    stoneBox(g, 0.72, 0.42, 0, 1.6, st, 411, { holes: [[[0.2, 0, 1.24, 1.12]], null, null, null] });
    g.in(M(0, 0, 0.43), () => {
      g.in(M(0, 0, -0.06), () => archFrame(g, 0.84, 1.12, 'round', (x, y, z) => mul(st.pal[2], 0.85 + 0.3 * noise3(x * 9, y * 9, 1)), { t: 0.07, fill: [0.02, 0.02, 0.018] }));
      for (const e of [-1, 1]) g.in(M(e * 0.2, 0, -0.03), () => roundDoor(g, 0.38, e ? 0.9 : 0.9, rgb(0x3a3024), P.bronze, 412 + e, { bands: [0.16, 0.48, 0.78], ringX: -e * 0.12 }));
      // bronze boss plates and a horned skull over the door
      g.in(M(0, 1.36, 0.02), () => { g.surf(K_PLAIN, 0.4, 0.85); g.cbox(0.6, 0.12, 0.04, 0.01, P.bronze); });
      g.in(M(0, 1.28, 0.04, -10, 0, 0), () => { skull(g, 1.1, false); for (const e of [-1, 1]) horn(g, [[e * 0.07, 0.2, -0.02], [e * 0.22, 0.24, 0], [e * 0.32, 0.38, 0.04], [e * 0.28, 0.54, 0.1]], 0.04, P.bone, mul(P.bone, 0.5), { rings: 30, nu: 7, nv: 12 }); });
      for (const e of [-1, 1]) g.in(M(e * 0.56, 0.95, 0.02), () => { g.surf(K_PLAIN, 0.4, 0.85); g.tube([[0, 0, 0], [0, 0.08, 0.1], [0, 0.06, 0.18]], 0.014, 5, P.bronze); g.in(M(0, 0.06, 0.18), () => lamp(g, 0.8, WITCH, { shape: 'cage', frame: P.bronze, glow: 0.8 })); });
    });
    // a short flight of slabs down into the bog
    g.surf(K_STONE, 0.93);
    for (let q = 0; q < 3; q++) g.in(M(0, 0.04 + q * -0.02, 0.6 + q * 0.18), () => g.cbox(1.0 - q * 0.08, 0.12, 0.2, 0.02, stoneTint(mul(st.pal[q % 4], 0.9), q, 4)));
    // parapet of the gate tower
    g.in(M(0, 1.6, 0), () => { g.surf(K_STONE, 0.9); for (let i = 0; i < 4; i++) g.in(M(-0.54 + i * 0.36, 0.13, 0.33), () => prism(g, MERLON.point(0.24, 0.3), 0.16, stoneTint(st.pal[1], i, 5), [0, 0.1])); });
  });
  // slit windows lit witch-green, set in bronze frames high in the rock
  for (const [a, y] of [[60, 2.1], [15, 3.1], [150, 2.7], [-40, 3.7], [250, 1.7], [200, 3.8], [-100, 2.3], [110, 4.4]]) g.in(M(0, y, 0, 0, a, 0).multiply(M(0, 0, coreR(y, a) * 1.04)), () => {
    g.surf(K_STONE, 0.9); g.in(M(0, 0, -0.2), () => g.cbox(0.3, 0.62, 0.5, 0.03, stoneTint(rgb(0x4a5446), a, 5)));
    g.surf(K_PLAIN, 0.4, 0, 0.9); g.flat([[-0.05, -0.2, 0.055], [0.05, -0.2, 0.055], [0.05, 0.16, 0.055], [0, 0.22, 0.055], [-0.05, 0.16, 0.055]], WITCH);
    g.surf(K_PLAIN, 0.45, 0.85); for (const [dx, dy, w2, h2] of [[0, -0.23, 0.2, 0.05], [-0.08, 0, 0.04, 0.46], [0.08, 0, 0.04, 0.46], [0, 0.25, 0.14, 0.05]]) g.in(M(dx, dy, 0.07), () => g.cbox(w2, h2, 0.04, 0.008, P.bronze));
  });
  // a bronze-railed ledge round the shoulder, a watch platform of black timber on the far side
  g.in(M(0, 2.35, 0), () => {
    g.surf(K_WOOD, 0.9);
    for (let k = 0; k < 7; k++) { const a = -0.3 + k * 0.32; g.in(M(Math.cos(a) * 1.52, 0, Math.sin(a) * 1.15, 0, -a / DEG, 0), () => g.cbox(0.12, 0.08, 0.5, 0.01, woodTint(rgb(0x2e2820), k))); }
    deck(g, 1.05, 1.75, -0.6, 0.7, 0.06, [rgb(0x3a3024), rgb(0x2e2820), rgb(0x46382a)], 420, { pw: 0.14 });
    g.surf(K_PLAIN, 0.45, 0.85);
    for (let k = 0; k < 5; k++) g.in(M(1.72, 0.06, -0.55 + k * 0.3), () => g.cyl(0.018, 0.018, 0.4, 5, P.bronze, false, true));
    g.in(M(1.72, 0.44, 0.05, 90, 0, 0), () => g.cyl(0.02, 0.02, 1.25, 5, P.bronze, true, true));
    for (const z of [-0.45, 0.0, 0.45]) g.in(M(1.75, 0.44, z), () => talisman(g, 0.35 + 0.15 * hash1(z * 10, 3), 30 + z * 10, z === 0));
  });
  // bone talismans: antlered poles in the bog and hanging strings from the rock
  for (const [x, z, h, sd] of [[-1.85, 0.4, 2.0, 1], [1.95, 0.35, 1.7, 2], [-0.6, 1.75, 1.5, 3], [0.9, 1.72, 1.6, 4]]) g.in(M(x, 0, z, (hash1(sd, 4) - 0.5) * 10, sd * 40, 0), () => {
    stake(g, 0.04, h, sd, rgb(0x3a3024));
    g.in(M(0, h - 0.18, 0), () => antler(g, 0.42, sd));
    g.in(M(0, h - 0.25, 0, 0, 0, 0), () => g.in(M(0, 0, 0, 0, 180, 0), () => antler(g, 0.38, sd + 3)));
    g.in(M(0.03, h - 0.3, 0.04), () => talisman(g, 0.35, sd + 7, sd % 2 === 0));
  });
  for (const [a, y] of [[60, 3.3], [120, 3.0], [-20, 2.9], [190, 3.2]]) g.in(M(0, y, 0, 0, a, 0).multiply(M(0, 0, coreR(y, a))), () => { g.surf(K_PLAIN, 0.45, 0.85); g.in(M(0, 0, 0, 90, 0, 0), () => g.cyl(0.012, 0.012, 0.16, 5, P.bronze, true, true)); g.in(M(0, -0.02, 0.14), () => talisman(g, 0.3 + 0.2 * hash1(a, 5), a, a % 120 === 0)); });
  // a bronze brazier crown on the peak and a witch-light in it
  g.in(M(0.05, 5.55, 0.05), () => { fireBowl(g, 0.5, [[0.6, 1.0, 0.6], [0.3, 0.95, 0.45], [0.1, 0.6, 0.3]], P.bronze, 4, 0.8); });
  // pools of black water at the foot
  for (const [x, z, rx, rz, sd] of [[-1.5, 1.45, 0.4, 0.22, 1], [1.7, 0.95, 0.3, 0.2, 2], [0.4, -1.75, 0.4, 0.16, 3]]) g.in(M(x, 0.06, z), () => pond(g, rx, rz, 0, sd, [0.05, 0.1, 0.08], 0.05));
  // the fog: banks lying on the bog, wisps clinging to the shoulders
  for (const [x, y, z, rx, ry, rz, sd] of [[-1.8, 0, 0.9, 0.8, 0.45, 0.7, 1], [1.7, 0, 1.0, 0.9, 0.4, 0.6, 2], [1.8, 0, -1.1, 0.8, 0.5, 0.6, 3], [-1.7, 0, -1.1, 0.8, 0.45, 0.6, 4], [0.2, 0, 1.6, 1.1, 0.3, 0.35, 5], [0, 0, -1.6, 1.3, 0.35, 0.35, 6]]) fog.in(M(x, y, z), () => fogBank(fog, rx, ry, rz, sd, 6, FOG));
  for (const [a, y, sd] of [[30, 2.6, 7], [200, 3.4, 8], [120, 4.4, 9], [300, 1.8, 10]]) fog.in(M(0, y, 0, 0, a, 0).multiply(M(0, 0, coreR(y, a) + 0.2)), () => fogBank(fog, 0.6, 0.25, 0.4, sd, 4, FOG, 0.12));
}
function fogStones(g, fog) {
  g.moss = 0.7;
  const SC = rgb(0x6f7868);
  pad(g, 3, 3, 0.12, peatCol(9), 431, { sq: 2.2 });
  // the ring: tall slabs, a few leaning, one fallen, spirals pecked into their faces
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + 0.25, R = 1.12, h = 1.65 + 0.7 * hash1(k, 3), sd = 440 + k;
    if (k === 4) { g.in(M(Math.cos(a) * 1.0, 0.14, Math.sin(a) * 1.0, 0, -a / DEG, 0).multiply(M(0, 0, 0, 86, 0, 0)).multiply(M(0, -0.62, 0)), () => megalith(g, 1.3, 0.26, sd, { col: SC, moss: 0.6, flat: [1, 0.5] })); continue; }
    g.in(M(Math.cos(a) * R, 0, Math.sin(a) * R, (hash1(k, 5) - 0.5) * 8, -a / DEG + 90, (hash1(k, 7) - 0.5) * 6), () => {
      megalith(g, h, 0.24 + 0.1 * hash1(k, 11), sd, { col: mix(SC, P.balor, hash1(k, 2) * 0.5), moss: 0.45, flat: [1, 0.36], sq: 0.8, lean: (hash1(k, 9) - 0.5) * 0.08 });
      g.in(M(0, h * 0.55, -0.13, 0, 180, 0), () => { g.surf(K_PLAIN, 0.6, 0, 0.35); for (let s = 0; s < 3; s++) { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14, r = 0.02 + t * 0.07; pts.push([Math.cos(t * 9 + s * 2.1) * r + (s - 1) * 0.1, Math.sin(t * 9 + s * 2.1) * r + (s === 1 ? 0.12 : 0), 0.01]); } g.tube(pts, 0.008, 3, WITCH, false); } });
    });
  }
  // the altar: a heap of cut peat blocks, moss on top, a bronze bowl and bone offerings
  const turf = (x, y, z, w2, h2, d2, ry, sd) => { g.surf(K_PLAIN, 0.95); g.in(M(x, y, z, 0, ry, (hash1(sd, 1) - 0.5) * 4), () => g.cbox(w2, h2, d2, 0.03, (px, py, pz, nx, ny) => (ny > 0.6 ? mix([0.16, 0.26, 0.08], [0.24, 0.34, 0.1], noise3(px * 9 + sd, 1, pz * 9)) : mul(PEAT, 0.65 + 0.5 * noise3(px * 14, py * 40 + sd, pz * 14))))); };
  let sd = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) turf(-0.34 + i * 0.34, 0.1, -0.15 + j * 0.3, 0.32, 0.2, 0.28, (hash1(i, j) - 0.5) * 8, sd++);
  for (let i = 0; i < 2; i++) turf(-0.17 + i * 0.34, 0.3, 0, 0.32, 0.2, 0.5, (hash1(i, 9) - 0.5) * 8, sd++);
  turf(0, 0.48, 0, 0.62, 0.16, 0.4, 3, sd++);
  g.in(M(0, 0.56, 0), () => { g.surf(K_PLAIN, 0.4, 0.85); g.lathe([[0.04, 0], [0.14, 0.03], [0.17, 0.08], [0.15, 0.08], [0.12, 0.04], [0, 0.04]], nq(12), P.bronze); g.surf(K_PLAIN, 0.6, 0, 0.8); g.in(M(0, 0.05, 0), () => g.cyl(0.13, 0.13, 0.002, nq(12), WITCH)); g.in(M(0, 0.06, 0), () => fire(g, 0.22, [[0.7, 1.0, 0.7], [0.3, 0.95, 0.5], [0.1, 0.6, 0.3]], 2, 0.6)); });
  for (const [x, z, ry] of [[0.22, 0.12, 30], [-0.24, -0.1, -20]]) g.in(M(x, 0.56, z, 0, ry, 0), () => skull(g, 0.6, true));
  bone(g, [-0.3, 0.58, 0.14], [-0.05, 0.57, 0.18], 0.012, 2);
  bone(g, [0.05, 0.58, -0.17], [0.3, 0.57, -0.12], 0.012, 3);
  for (const [x, z, sd2] of [[0.45, 0.55, 1], [-0.5, 0.5, 2], [0.1, -0.6, 3]]) g.in(M(x, 0, z, 0, sd2 * 60, 0), () => { stake(g, 0.025, 0.75, sd2, rgb(0x3a3024)); g.in(M(0.02, 0.7, 0.02), () => talisman(g, 0.25, sd2 + 50, false)); });
  // standing pools between the stones
  g.in(M(0.6, 0.07, -0.65), () => pond(g, 0.32, 0.2, 0, 4, [0.05, 0.1, 0.08], 0.05));
  // boiling fog: thick in the ring, lapping out between the stones
  fog.in(M(0, 0, 0), () => fogBank(fog, 1.3, 0.55, 1.3, 11, 10, FOG, 0.12));
  for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU + 0.7; fog.in(M(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2), () => fogBank(fog, 0.55, 0.4, 0.5, 20 + k, 4, FOG, 0.12)); }
  for (const [x, y, z, sd2] of [[0.3, 1.1, 0.2, 31], [-0.4, 1.5, -0.3, 32]]) fog.in(M(x, y, z), () => fogBank(fog, 0.5, 0.22, 0.4, sd2, 3, FOG, 0.12));
}

// =====================================================================================================
// Kurgan: felt, horse-hair, red and gold on the open steppe
// =====================================================================================================
const STEPPE_WOOD = [rgb(0x6a4e30), rgb(0x7a5a38), rgb(0x5a4228), rgb(0x84643e)], FELT_PALE = rgb(0xc8b48a);
/** a horse skull about 0.5 long, sculpted once: muzzle toward +Z, resting on y = 0 */
function horseSkullGeo() {
  return geoOnce('horseSkull', () => {
    const c = 0xd8ccaa, d = 0x1a1612, Pp = [];
    Pp.push(S.ellipsoid(0.085, 0.08, 0.11).at(0, 0.11, -0.12).color(c).tint(0.14, 24));
    Pp.push(S.capsule([0, 0.1, -0.06], [0, 0.07, 0.26], 0.07, 0.045).color(c).blend(0.04));
    Pp.push(S.box(0.07, 0.04, 0.3, 0.02).at(0, 0.03, 0.1).color(0xc8bc98).blend(0.03));
    Pp.push(...S.mirrorX([S.ellipsoid(0.035, 0.03, 0.035).at(0.07, 0.12, -0.05).color(d).cut(0.008)]));
    Pp.push(...S.mirrorX([S.ellipsoid(0.02, 0.015, 0.06).at(0.03, 0.115, 0.18).color(d).cut(0.006)]));
    Pp.push(S.box(0.08, 0.008, 0.2, 0.002).at(0, 0.045, 0.14).color(d).cut(0.003));
    return buildPartGeometry({ prims: Pp }, { res: 44 * qual(), ao: 0.8 });
  });
}
function horseSkull(g, s = 1) { const k = g.kind; g.surf(K_PLAIN, 0.75); g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(horseSkullGeo(), boneCol(3, P.bone))); g.kind = k; }
/** a felt yurt standing on the local origin: lattice wall radius R, h high, a roof to `top`, door toward +Z */
function yurt(g, R, h, top, seed, o = {}) {
  const wall = o.wall || FELT_PALE, roof = o.roof || mul(P.kFelt, 0.8), red = o.red || P.kRed, gold = o.gold || P.kGold;
  hideSheet(g, 40, 4, (u, v) => { const a = u * TAU, rr = R * (1 + 0.012 * Math.sin(a * 9)); return [Math.cos(a) * rr, v * h, Math.sin(a) * rr]; }, wall, seed, true);
  // the girth bands: red with a gold running pattern
  g.surf(K_CLOTH, 0.85);
  for (const [y, hh] of [[h * 0.28, 0.12], [h * 0.82, 0.1]]) g.lathe([[R + 0.012, y - hh / 2], [R + 0.022, y - hh / 2 + 0.01], [R + 0.022, y + hh / 2 - 0.01], [R + 0.012, y + hh / 2]], nq(40), (x, yy, z) => { const a = Math.atan2(z, x), t = tri1(a * 12 / TAU * 2 + (yy - y) / hh * 1.5); return Math.abs(t - 0.5) < 0.12 ? gold : red; });
  // the roof: felt over radiating poles, a crown ring with its smoke flap, rope girdles
  hideSheet(g, 40, 6, (u, v) => { const a = u * TAU, r = lerp(R + 0.08, 0.2, v), sag = 0.03 * Math.abs(Math.sin(a * 12)) * (1 - v); return [Math.cos(a) * r, h + (top - h) * Math.pow(v, 0.85) - sag - 0.04, Math.sin(a) * r]; }, roof, seed + 5, true);
  g.surf(K_WOOD, 0.8);
  g.in(M(0, top - 0.04, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.2, 0.03, 5, nq(16)), woodTint(red, seed)));
  for (let k = 0; k < 4; k++) g.in(M(0, top + 0.02, 0, 0, k * 45, 0), () => g.cbox(0.42, 0.025, 0.025, 0.004, mul(red, 0.8)));
  g.in(M(0, top + 0.03, 0), () => { g.surf(K_PLAIN, 0.35, 0.9); g.lathe([[0.05, 0], [0.06, 0.04], [0.025, 0.12], [0, 0.18]], nq(8), gold); });
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; rope(g, [[Math.cos(a) * 0.22, top - 0.02, Math.sin(a) * 0.22], [Math.cos(a) * (R * 0.6), h + (top - h) * 0.48, Math.sin(a) * (R * 0.6)], [Math.cos(a) * (R + 0.1), h - 0.02, Math.sin(a) * (R + 0.1)]], 0.009, rgb(0x6a5a40), 4); }
  for (const y of [h * 0.55, h * 0.12]) g.in(M(0, y, 0, 90, 0, 0), () => { g.surf(K_CLOTH, 0.95); g.add(new THREE.TorusGeometry(R + 0.02, 0.012, 4, nq(36)), rgb(0x6a5a40)); });
  // the door: a painted frame with a felt flap rolled up over it
  g.in(M(0, 0, R - 0.01), () => {
    g.surf(K_WOOD, 0.7);
    for (const e of [-1, 1]) g.in(M(e * 0.22, h * 0.45, 0.03), () => g.cbox(0.06, h * 0.9, 0.06, 0.01, woodTint(red, seed + e)));
    g.in(M(0, h * 0.9, 0.03), () => g.cbox(0.56, 0.08, 0.07, 0.01, woodTint(red, seed + 3)));
    g.surf(K_PLAIN, 0.5); g.flat([[-0.19, 0, 0.02], [0.19, 0, 0.02], [0.19, h * 0.86, 0.02], [-0.19, h * 0.86, 0.02]], (x, y) => (Math.abs(tri1(x * 6 + y * 3) - 0.5) < 0.12 ? gold : mul(red, 0.85)));
    g.surf(K_CLOTH, 0.9); g.in(M(0, h * 0.97, 0.06, 0, 0, 90), () => g.in(M(0, -0.25, 0), () => g.cyl(0.06, 0.06, 0.5, 8, roof, true, true)));
  });
}
function wagonYurt(g) {
  g.moss = 0.2;
  pad(g, 4, 3, 0.03, (x, y, z) => mul(mix(rgb(0x8a7a4a), rgb(0x6a7a3a), noise3(x * 2, 1, z * 2)), 0.75 + 0.4 * fbm3(x * 4, y * 4, z * 4, 2)), 451, { sq: 3 });
  const dy = 0.74, X0 = -1.55, X1 = 1.3, Z = 1.1;
  // running gear: two axles, four big spoked wheels
  for (const x of [-0.95, 0.75]) {
    g.surf(K_WOOD, 0.85); g.in(M(x, 0.5, 0, 90, 0, 0), () => g.in(M(0, -1.25, 0), () => g.cyl(0.05, 0.05, 2.5, 6, woodTint(STEPPE_WOOD[2], x * 9), true, true)));
    for (const e of [-1, 1]) g.in(M(x, 0.52, e * 1.2), () => wheel(g, 0.52, 0.09, 12, STEPPE_WOOD[1], x * 7 + e));
  }
  // the bed: two long sills, cross bearers, a plank floor with a raised rail
  g.surf(K_WOOD, 0.9);
  for (const z of [-0.75, 0.75]) g.in(M((X0 + X1) / 2, dy - 0.12, z), () => g.beam(X1 - X0 + 0.2, 0.12, 0.12, 0.015, woodTint(STEPPE_WOOD[0], z * 5), 4));
  for (let i = 0; i < 6; i++) g.in(M(X0 + 0.15 + i * 0.5, dy - 0.04, 0, 0, 90, 0), () => g.beam(2 * Z, 0.06, 0.08, 0.01, woodTint(STEPPE_WOOD[3], i), 2));
  deck(g, X0, X1, -Z, Z, dy, STEPPE_WOOD, 452, { pw: 0.18, rag: 0.05 });
  g.surf(K_WOOD, 0.85);
  for (const e of [-1, 1]) g.in(M((X0 + X1) / 2 + 0.25, dy + 0.06, e * (Z - 0.03)), () => g.beam(X1 - X0 - 0.5, 0.1, 0.05, 0.01, (x, y, z) => mul(Math.abs(tri1(x * 3) - 0.5) < 0.1 ? P.kGold : P.kRed, 0.85 + 0.2 * noise3(x * 9, y * 9, z * 9)), 6));
  // the draught pole and a yoke for two oxen
  g.surf(K_WOOD, 0.9);
  g.beamTo([X1 - 0.3, dy - 0.15, 0], [2.32, 0.5, 0], 0.09, 0.09, 0.015, woodTint(STEPPE_WOOD[2], 4), 3);
  for (const e of [-1, 1]) g.beamTo([X1 - 0.2, dy - 0.15, e * 0.6], [1.75, 0.55, 0], 0.06, 0.06, 0.01, woodTint(STEPPE_WOOD[0], e), 2);
  g.in(M(2.15, 0.62, 0, 0, 90, 0), () => g.beam(1.4, 0.09, 0.1, 0.02, woodTint(STEPPE_WOOD[1], 6), 6, (x) => [0.05 * Math.cos((x / 0.7) * Math.PI / 2) - 0.05 * Math.abs(Math.sin((x / 0.7) * Math.PI)), 0]));
  for (const e of [-1, 1]) for (const f of [-1, 1]) { g.surf(K_WOOD, 0.85); g.tube([[2.15 + f * 0.11, 0.6, e * 0.42], [2.15 + f * 0.12, 0.38, e * 0.42], [2.15, 0.28, e * 0.42], [2.15 - f * 0.0, 0.28, e * 0.42]], 0.018, 5, woodTint(STEPPE_WOOD[3], e + f), true); }
  for (const e of [-1, 1]) { g.surf(K_PLAIN, 0.35, 0.9); g.in(M(2.15, 0.7, e * 0.42), () => g.add(new THREE.TorusGeometry(0.04, 0.01, 4, 8), P.kGold)); g.in(M(2.15, 0.72, e * 0.62), () => { g.surf(K_CLOTH, 0.9); rag(g, 0.06, 0.25, P.kRed, e + 3, 0.3); }); }
  // the yurt
  g.in(M(-0.35, dy, 0), () => yurt(g, 0.96, 0.9, 2.05, 455));
  // cargo forward of the yurt: a lacquered chest, sacks, a water butt and a tied bundle of poles
  g.in(M(0.92, dy, -0.45), () => { g.surf(K_WOOD, 0.6); g.in(M(0, 0.17, 0), () => g.cbox(0.5, 0.34, 0.36, 0.02, woodTint(P.kRed, 7))); g.surf(K_PLAIN, 0.35, 0.9); for (const x of [-0.2, 0.2]) g.in(M(x, 0.17, 0.19), () => g.cbox(0.05, 0.3, 0.012, 0.004, P.kGold)); g.in(M(0, 0.24, 0.19), () => g.stud(0.035, P.kGold, 8)); g.in(M(0, 0.36, 0), () => g.cbox(0.52, 0.04, 0.38, 0.01, mul(P.kRed, 0.7))); });
  for (const [x, z, sd] of [[0.95, 0.3, 1], [1.12, 0.6, 2], [0.75, 0.65, 3]]) g.in(M(x, dy, z, 0, sd * 50, 0), () => sack(g, 0.9, mix(FELT_PALE, P.kFelt, 0.3 * sd), sd));
  g.in(M(1.12, dy, -0.02), () => barrel(g, 0.16, 0.42, STEPPE_WOOD[1], 4));
  // horse-hair standards at the tail of the wagon, a red-and-gold pennant on the yurt crown
  for (const e of [-1, 1]) g.in(M(X0 + 0.12, dy - 0.1, e * (Z - 0.1)), () => tug(g, 2.4, e > 0 ? rgb(0x1a1612) : rgb(0xd8d0c0), P.kGold, 456 + e));
  g.in(M(-0.35, dy + 2.2, 0), () => pennon(g, 0.7, 0.8, P.kRed, P.kGold, { knob: P.kGold }));
  // a step at the tail, a cooking kettle hung beside it
  g.surf(K_WOOD, 0.9);
  for (let q = 0; q < 2; q++) g.in(M(X0 - 0.14 - q * 0.0, 0.2 + q * 0.26, 0.35, 0, 0, 0), () => g.cbox(0.22, 0.06, 0.5, 0.01, woodTint(STEPPE_WOOD[q], q)));
  for (const e of [-1, 1]) g.beamTo([X0 - 0.25, 0, 0.35 + e * 0.25], [X0 - 0.02, dy - 0.05, 0.35 + e * 0.25], 0.05, 0.05, 0.01, woodTint(STEPPE_WOOD[2], e), 1);
  g.in(M(X0 - 0.12, dy - 0.08, -0.55), () => { chain(g, [[0, 0, 0], [0, -0.2, 0]], 0.03); g.surf(K_PLAIN, 0.5, 0.8); g.in(M(0, -0.42, 0), () => g.lathe([[0, 0], [0.1, 0.02], [0.13, 0.1], [0.11, 0.18], [0.12, 0.2]], nq(10), [0.12, 0.1, 0.09])); });
}
/** a carved stone steppe idol standing on the local origin, ~1.1 high, face toward +Z */
function steppeIdol(g, s = 1, col = rgb(0x8a8478)) {
  const geo = geoOnce('steppeIdol', () => {
    const c = 0x8a8478, d = 0x3a3630, Pp = [];
    Pp.push(S.box(0.34, 0.62, 0.24, 0.08).at(0, 0.31, 0).color(c).bump(0.006, 10, 'stone').tint(0.12, 8));
    Pp.push(S.ellipsoid(0.15, 0.17, 0.14).at(0, 0.76, 0.01).color(c).blend(0.05));
    Pp.push(S.cone(0.16, 0.05, 0.16, 0.02).at(0, 0.94, 0).color(c).blend(0.03));
    Pp.push(S.box(0.2, 0.025, 0.04, 0.01).at(0, 0.8, 0.12).color(c).blend(0.015));
    Pp.push(S.cone(0.03, 0.015, 0.08, 0.01).rot(20, 0, 0).at(0, 0.75, 0.14).color(c).blend(0.01));
    Pp.push(...S.mirrorX([S.ellipsoid(0.03, 0.012, 0.02).at(0.055, 0.775, 0.13).color(d).cut(0.006)]));
    Pp.push(...S.mirrorX([S.capsule([0.02, 0.715, 0.135], [0.08, 0.67, 0.12], 0.012, 0.008).color(c).blend(0.008)]));
    Pp.push(...S.mirrorX([S.capsule([0.17, 0.56, 0.02], [0.16, 0.38, 0.1], 0.04, 0.035).color(c).blend(0.03), S.capsule([0.16, 0.38, 0.1], [0.04, 0.34, 0.14], 0.035, 0.03).color(c).blend(0.03)]));
    Pp.push(S.cyl(0.045, 0.1, 0.01).at(0, 0.36, 0.15).color(c).blend(0.01));
    Pp.push(S.box(0.36, 0.035, 0.26, 0.01).at(0, 0.24, 0).color(c).blend(0.01));
    return buildPartGeometry({ prims: Pp }, { res: 40 * qual(), ao: 0.8 });
  });
  const k = g.kind; g.surf(K_STONE, 0.9);
  g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(geo, (x, y, z, nx, ny) => mix(mul(col, 0.8 + 0.3 * noise3(x * 6, y * 6, z * 6)), [0.5, 0.55, 0.32], smooth(0.6, 0.85, noise3(x * 3, y * 3 + 5, z * 3)) * 0.5)));
  g.kind = k;
}
const MOUND_R = 1.86, MOUND_H = 1.3;
const moundY = (x, z) => { const d = Math.hypot(x, z) / MOUND_R; return d >= 1 ? 0 : MOUND_H * Math.pow(1 - d * d, 0.75); };
function burialMound(g) {
  g.moss = 0.4;
  pad(g, 4, 4, 0.03, grassCol(5, rgb(0x6a5a3a)), 461, { sq: 2 });
  // the mound: turf over earth, a grassy swell with a few bare scars
  g.surf(K_LEAF, 0.95);
  g.sheet(nq(48), nq(16), (u, v) => { const a = u * TAU, d = v * MOUND_R * 1.03, wob = 1 + 0.03 * noise3(Math.cos(a) * 2, 1, Math.sin(a) * 2); const x = Math.cos(a) * d * wob, z = Math.sin(a) * d * wob; return [x, v > 0.985 ? -0.04 : moundY(x, z) + 0.03 * (fbm3(x * 2, 0, z * 2, 2) - 0.5), z]; }, grassCol(7, rgb(0x6a5236)), true);
  // a kerb of boulders round its foot
  for (let k = 0; k < 18; k++) { const a = (k / 18) * TAU + 0.1, r = MOUND_R + 0.02; if (Math.abs(a - Math.PI / 2) < 0.22) continue; g.in(M(Math.cos(a) * r, 0, Math.sin(a) * r, 0, k * 47, 0), () => boulder(g, 0.13 + 0.05 * hash1(k, 1), 0.11, 0.12, 470 + k, rgb(0x8a8270), nq(14))); }
  // the entrance: two orthostats and a capstone, a dark passage, a slab rolled half aside
  g.in(M(0, 0, 1.38), () => {
    g.surf(K_PLAIN, 1); g.flat([[-0.24, 0, 0.2], [0.24, 0, 0.2], [0.24, 0.66, 0.2], [-0.24, 0.66, 0.2]], [0.02, 0.018, 0.014]);
    for (const e of [-1, 1]) g.in(M(e * 0.33, 0, 0.22, 0, 0, e * 3), () => megalith(g, 0.74, 0.12, 480 + e, { col: rgb(0x8a8270), moss: 0.3, flat: [0.8, 1.2], sq: 0.8 }));
    g.in(M(0, 0.72, 0.22, 0, 0, 90), () => g.in(M(0, -0.48, 0), () => megalith(g, 0.96, 0.12, 483, { col: rgb(0x8a8270), moss: 0.3, flat: [1.1, 0.9], sq: 0.8 })));
    g.in(M(0.5, 0, 0.32, 0, 30, 8), () => megalith(g, 0.62, 0.2, 484, { col: rgb(0x7a7466), moss: 0.4, flat: [1, 0.35], sq: 0.8 }));
    for (const [x, z] of [[-0.12, 0.42], [0.15, 0.55], [-0.05, 0.68]]) { g.surf(K_STONE, 0.9); g.in(M(x, 0.0, z, 0, x * 300, 0), () => g.cbox(0.24, 0.04, 0.16, 0.02, stoneTint(rgb(0x8a8270), x * 9, 5))); }
  });
  // the crown: a ring of posts, each with a skull, ribbons of red and gold; the idol in the middle
  const top = moundY(0, 0);
  g.in(M(0, top - 0.06, 0), () => {
    g.surf(K_STONE, 0.9);
    g.in(M(0, 0, 0), () => g.cyl(0.36, 0.3, 0.14, nq(12), stoneTint(rgb(0x8a8270), 3, 5), false, true));
    g.in(M(0, 0.14, 0), () => steppeIdol(g, 1.05));
    // offerings at its foot: a bowl, a little heap of gold, a horse skull
    g.in(M(0.12, 0.14, 0.24), () => { g.surf(K_PLAIN, 0.35, 0.9); g.lathe([[0, 0], [0.06, 0.005], [0.08, 0.04], [0.07, 0.04], [0, 0.01]], nq(10), P.kGold); });
    g.in(M(-0.2, 0.12, 0.3, 0, -20, 0), () => horseSkull(g, 0.55));
  });
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + 0.35, r = 0.78, x = Math.cos(a) * r, z = Math.sin(a) * r, y = moundY(x, z), h = 0.95 + 0.2 * hash1(k, 4);
    g.in(M(x, y - 0.05, z, (hash1(k, 5) - 0.5) * 8, 0, (hash1(k, 6) - 0.5) * 8), () => {
      stake(g, 0.04, h, 490 + k, rgb(0x5a4430), rgb(0x8a6a48));
      g.in(M(0, h - 0.17, 0.0, 0, -a / DEG + 90, 0), () => (k % 3 === 0 ? g.in(M(0, 0.02, -0.12, -60, 0, 0), () => horseSkull(g, 0.55)) : skull(g, 0.85, true)));
      g.in(M(0, h * 0.62, 0.04, 0, -a / DEG + 90, 0), () => { g.surf(K_CLOTH, 0.9); rag(g, 0.05, 0.3 + 0.1 * hash1(k, 8), k % 2 ? P.kRed : P.kGold, k, 0.35); });
    });
  }
  // rope with ribbons strung post to post
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * TAU + 0.35, a1 = ((k + 1) / n) * TAU + 0.35, r = 0.78, p0 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
    p0[1] = moundY(p0[0], p0[2]) + 0.62; p1[1] = moundY(p1[0], p1[2]) + 0.62;
    const m = v3(p0, p1, 0.5); m[1] -= 0.12;
    rope(g, [p0, m, p1], 0.007, rgb(0x8a6a40), 4);
    g.in(M(m[0], m[1], m[2], 0, -((a0 + a1) / 2) / DEG + 90, 0), () => { g.surf(K_CLOTH, 0.9); rag(g, 0.04, 0.16, k % 2 ? P.kGold : P.kRed, k + 20, 0.3); });
  }
  // grave goods heaped by the entrance: a broken wheel, a spear in the turf
  g.in(M(-0.95, 0.12, 1.45, 70, 20, 0), () => g.in(M(0, 0, 0, 0, 0, 0), () => wheel(g, 0.32, 0.06, 8, STEPPE_WOOD[0], 9)));
  g.in(M(1.0, moundY(1.0, 0.9), 0.9, -12, 0, 10), () => { g.surf(K_WOOD, 0.8); g.cyl(0.018, 0.016, 1.3, 5, woodTint(rgb(0x5a4430), 3), false, true); g.surf(K_PLAIN, 0.35, 0.85); g.in(M(0, 1.3, 0), () => g.cyl(0.025, 0.002, 0.22, 4, [0.5, 0.5, 0.52], false, true)); g.in(M(0, 1.18, 0), () => tug(g, 0.12, rgb(0x1a1612), P.kGold, 7)); });
}

// =====================================================================================================
// Hearthmoot: turf, painted doors, brick, thatch and flour
// =====================================================================================================
const WARM = [1.0, 0.72, 0.32], HM_STONE = rgb(0xa89a80), HM_BRICK = sw(0x9a4a32, 0x8a4430, 0xa85a3a, 0x7a3e2c, 0xb0644a, 0x924a36), HM_OAK = rgb(0x4a3422);
const FLOWERS = sw(0xd84a4a, 0xe8c83a, 0xe8e0f0, 0xb85ad8, 0xe87a3a, 0x5a8ae8);
/** a bed of flowers: leafy clumps dotted with blooms, around the origin, w x d */
function flowerBed(g, w, d, seed, n = 6) {
  const rnd = rng(seed * 19 + 3);
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * w, z = (rnd() - 0.5) * d, s = 0.08 + 0.05 * rnd();
    g.in(M(x, s * 0.4, z), () => leafClump(g, s * 1.6, seed + i, [rgb(0x3f7a2a), rgb(0x4f8a32)], 2));
    g.surf(K_LEAF, 0.7);
    for (let k = 0; k < 4; k++) { const c = FLOWERS[Math.floor(rnd() * FLOWERS.length)]; g.in(M(x + (rnd() - 0.5) * s * 1.6, s * 0.75 + rnd() * 0.04, z + (rnd() - 0.5) * s * 1.6), () => g.add(new THREE.IcosahedronGeometry(0.022, 0), c)); }
  }
}
/** a picket fence from a to b (on the ground), pickets ~0.42 high */
function picketFence(g, a, b, col, seed = 0) {
  const f = along(a, b), n = Math.max(2, Math.round(f.L / 0.09));
  g.in(f.m, () => {
    g.surf(K_WOOD, 0.8);
    for (let i = 0; i <= n; i++) { const x = -f.L / 2 + (i * f.L) / n, hh = 0.4 + 0.03 * hash1(i, seed); g.in(M(x, hh / 2 - 0.03, 0, 0, 0, (hash1(i, seed + 1) - 0.5) * 6), () => { g.cbox(0.045, hh, 0.02, 0.006, woodTint(mul(col, 0.85 + 0.25 * hash1(i, seed + 2)), i)); g.in(M(0, hh / 2, 0, 0, 0, 45), () => g.cbox(0.032, 0.032, 0.02, 0.004, col)); }); }
    for (const y of [0.1, 0.3]) g.in(M(0, y, -0.02), () => g.beam(f.L + 0.04, 0.04, 0.02, 0.006, woodTint(mul(col, 0.8), seed + y * 9), 2));
  });
}
const BUR_R = 1.6, BUR_Z = 0.55;
const burWallZ = (x) => BUR_Z - BUR_R + Math.sqrt(Math.max(0, BUR_R * BUR_R - x * x));
const burH = (x, z) => { const q = 1 - (x / 1.45) ** 2 - ((z + 0.25) / 1.25) ** 2; return q <= 0 ? 0 : 1.6 * Math.pow(q, 0.75); };
function burrow(g, fog) {
  g.moss = 0.6;
  pad(g, 3, 3, 0.03, grassCol(21), 501, { sq: 3 });
  // the hill: turf over the whole house, cut back to the face of the front wall
  g.surf(K_LEAF, 0.95);
  g.sheet(nq(48), nq(18), (u, v) => {
    const a = u * TAU, x = Math.cos(a) * 1.47 * v, z0 = -0.25 + Math.sin(a) * 1.27 * v, wz = burWallZ(x) - 0.05, z = Math.min(z0, wz);
    return [x, v > 0.985 ? -0.04 : burH(x, z0) + 0.025 * (fbm3(x * 3, 1, z0 * 3, 2) - 0.5), z];
  }, grassCol(23), true);
  // the front wall: coursed stone curving round the door, a turf lip over it
  const st = stoneStyle(0xa89a80, { seed: 502, course: 0.14, len: [0.18, 0.34], chip: 0.2, pal: [rgb(0xa89a80), rgb(0xb0a288), rgb(0x9a8c74), rgb(0xb8aa8c), rgb(0x8e826c)] });
  const WH = 0.98, Hh = [-0.33, 0, 0.33, 0.84];
  g.in(M(0, 0, BUR_Z - BUR_R), () => g.bend(BUR_R, () => {
    g.surf(K_STONE, 0.93);
    g.in(M(-1.05, 0, -st.r), () => { g.ashlar(2.1, WH, { ...st, ends: [CUT, CUT, 0, 0], holes: [[Hh[0] + 1.05, 0, Hh[2] + 1.05, Hh[3]], [0.48, 0.42, 0.72, 0.7], [1.38, 0.42, 1.62, 0.7]] }); footing(g, 0, 2.1, st.pal[0], st.r); });
    // the round door in a ring of voussoirs, painted green with a brass knob in the middle
    g.in(M(0, 0.43, 0.0), () => {
      g.surf(K_STONE, 0.9); g.flat([[-0.34, -0.43, -0.01], [0.34, -0.43, -0.01], [0.34, 0.42, -0.01], [-0.34, 0.42, -0.01]], mul(st.pal[2], 0.8));
      const nv = 15;
      for (let i = 0; i < nv; i++) { const a0 = (i / nv) * TAU + 0.02, a1 = ((i + 1) / nv) * TAU - 0.02; g.stonePoly([[Math.cos(a0) * 0.33, Math.sin(a0) * 0.33], [Math.cos(a0) * 0.46, Math.sin(a0) * 0.46], [Math.cos(a1) * 0.46, Math.sin(a1) * 0.46], [Math.cos(a1) * 0.33, Math.sin(a1) * 0.33]], st, 510 + i, 0.03); }
      g.surf(K_WOOD, 0.6);
      g.in(M(0, 0, 0.0, 90, 0, 0), () => g.lathe([[0.335, -0.01], [0.33, 0.025], [0.3, 0.035], [0, 0.035]].map(([r, y]) => [r, y]), nq(28), (x, y, z) => { const a = Math.atan2(z, x), pl = Math.floor(x / 0.075 + 20); return mul(P.hGreen, (0.78 + 0.3 * hash1(pl, 3)) * (Math.abs(((x / 0.075) % 1 + 1) % 1 - 0.5) > 0.46 ? 0.6 : 1) * (0.9 + 0.15 * noise3(x * 30, y, z * 4))); }));
      g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, 0, 0.04), () => g.stud(0.04, P.brass, 8, 0.9));
      for (const y of [-0.16, 0.16]) g.in(M(-0.12, y, 0.04), () => g.cbox(0.36, 0.035, 0.01, 0.004, mul(P.brass, 0.8)));
      g.in(M(0, -0.47, 0.12), () => { g.surf(K_STONE, 0.9); g.cbox(0.8, 0.08, 0.3, 0.02, stoneTint(st.pal[3], 4, 5)); });
    });
    // round windows lit warm, flower boxes under them
    for (const x of [-0.45, 0.45]) g.in(M(x, 0.56, 0), () => {
      g.surf(K_STONE, 0.9); g.flat([[-0.13, -0.15, -0.01], [0.13, -0.15, -0.01], [0.13, 0.15, -0.01], [-0.13, 0.15, -0.01]], mul(st.pal[2], 0.8));
      porthole(g, 0.16, woodTint(P.hGreen, x * 9), WARM, 0.85);
      g.in(M(0, 0, 0.02), () => { g.surf(K_WOOD, 0.8); g.add(new THREE.TorusGeometry(0.18, 0.035, 5, nq(16)), woodTint(P.hCream, 3)); });
      g.in(M(0, -0.24, 0.1), () => { g.surf(K_WOOD, 0.85); g.cbox(0.36, 0.08, 0.14, 0.01, woodTint(P.hGreen, x * 5)); g.in(M(0, 0.04, 0), () => flowerBed(g, 0.28, 0.08, 520 + x * 10, 3)); });
    });
    g.in(M(0.5, 0.95, 0.02), () => bracketLamp(g, 0.7, WARM, { frame: P.brass }));
    // the turf lip hanging over the wall top
    for (let i = 0; i < 9; i++) { const x = -1.0 + i * 0.25; g.in(M(x, WH + 0.03, 0.03), () => leafClump(g, 0.2, 530 + i, [GRASS[0], GRASS[1], GRASS[2]], 2, { flat: 0.5 })); }
  }));
  // the chimney: brick, rising out of the turf, a pot and a wisp of smoke
  const br = stoneStyle(0x9a4a32, { seed: 540, course: 0.07, len: [0.12, 0.2], pal: HM_BRICK, mortar: [0.32, 0.29, 0.25], r: 0.008, b: 0.008 });
  g.in(M(0.55, 0, -0.5), () => { stoneBox(g, 0.15, 0.15, 1.25, 2.28, br, 541, { noFoot: true }); g.surf(K_STONE, 0.9); g.in(M(0, 2.3, 0), () => g.cbox(0.38, 0.06, 0.38, 0.01, stoneTint(HM_STONE, 2, 5))); g.surf(K_PLAIN, 0.8); g.in(M(0, 2.32, 0), () => g.lathe([[0.08, 0], [0.09, 0.1], [0.07, 0.16], [0.08, 0.18]], nq(10), rgb(0xa8583a))); fog.in(M(0.55, 2.45, -0.5), () => smoke(fog, 0.08, 0.9, 5, [0.5, 0.5, 0.52], [0.85, 0.85, 0.87], 5, 0.3)); });
  // the garden: a flagged path to a gate in a picket fence, flower beds, a bench and a barrel
  for (let i = 0; i < 5; i++) { g.surf(K_STONE, 0.9); g.in(M((hash1(i, 3) - 0.5) * 0.08, 0.02, 0.78 + i * 0.15, 0, hash1(i, 5) * 40, 0), () => g.cbox(0.3, 0.04, 0.12, 0.02, stoneTint(mul(HM_STONE, 0.9 + 0.15 * hash1(i, 7)), i, 5))); }
  const fz = 1.38;
  picketFence(g, [-1.38, 0, fz - 0.25], [-0.28, 0, fz], P.hCream, 550);
  picketFence(g, [0.28, 0, fz], [1.38, 0, fz - 0.25], P.hCream, 551);
  for (const e of [-1, 1]) g.in(M(e * 0.28, 0, fz), () => { g.surf(K_WOOD, 0.8); g.in(M(0, 0.28, 0), () => g.cbox(0.07, 0.56, 0.07, 0.01, woodTint(P.hCream, e))); g.in(M(0, 0.58, 0), () => g.lathe([[0.04, 0], [0.05, 0.03], [0, 0.07]], 6, P.hGreen)); });
  g.in(M(-0.12, 0, fz + 0.05, 0, -50, 0), () => picketFence(g, [0, 0, 0], [0.42, 0, 0], P.hGreen, 552));
  flowerBed(g, 0.6, 0.25, 560, 6); g.in(M(-0.8, 0, 0.95), () => flowerBed(g, 0.7, 0.3, 561, 7)); g.in(M(0.8, 0, 0.95), () => flowerBed(g, 0.7, 0.3, 562, 7));
  for (let i = 0; i < 9; i++) { const a = hash1(i, 41) * TAU, d = 0.35 + 0.85 * hash1(i, 43), x = Math.cos(a) * d * 1.3, z = -0.25 + Math.sin(a) * d * 1.0; if (z > burWallZ(x) - 0.2) continue; g.in(M(x, burH(x, z) - 0.03, z), () => (i % 3 ? leafClump(g, 0.16, 580 + i, [GRASS[1], GRASS[3], rgb(0x6a8a3a)], 3, { flat: 0.45 }) : boulder(g, 0.09, 0.06, 0.08, 590 + i, HM_STONE, 12))); }
  g.in(M(-0.75, 0, 0.55, 0, 12, 0), () => { g.surf(K_WOOD, 0.85); g.in(M(0, 0.22, 0), () => g.cbox(0.5, 0.04, 0.14, 0.01, woodTint(HM_OAK, 3))); for (const e of [-1, 1]) g.in(M(e * 0.2, 0.1, 0), () => g.cbox(0.05, 0.2, 0.12, 0.01, woodTint(HM_OAK, e))); });
  g.in(M(0.82, 0, 0.5), () => barrel(g, 0.14, 0.34, rgb(0x7a5a38), 5));
  g.in(M(1.05, 0, 0.75), () => fungi(g, 0.35, rgb(0xc84a2a), 3, 0));
  // a vegetable patch round the side
  for (let i = 0; i < 6; i++) g.in(M(-1.15 + (i % 3) * 0.16, 0.05, -0.95 + Math.floor(i / 3) * 0.2), () => leafClump(g, 0.12, 570 + i, [rgb(0x4a8a2a), rgb(0x5a9a32)], 2));
}
function watermill(g, fog) {
  g.moss = 0.8;
  pad(g, 3, 3, 0.03, grassCol(31), 581, { sq: 3 });
  const cx = -0.3, hx = 0.78, hz = 0.75, y1 = 1.0, y2 = 2.0;
  const st = stoneStyle(0xa89a80, { seed: 582, course: 0.125, len: [0.2, 0.4], pal: [HM_STONE, rgb(0xb0a288), rgb(0x9a8c74), ...HM_BRICK.slice(0, 2)] });
  // the ground storey: stone and brick, a door and a window in front
  g.in(M(cx, 0, 0), () => {
    stoneBox(g, hx, hz, 0, y1, st, 583, { holes: [[[0.3, 0, 0.82, 0.875], [1.05, 0.375, 1.35, 0.75]], null, null, [[0.6, 0.375, 0.9, 0.75]]], each: (s, W) => {
      if (s === 0) { g.in(M(0.56, 0, st.r), () => { plankDoor(g, 0.48, 0.86, HM_OAK, 3); g.surf(K_WOOD, 0.85); g.in(M(0, 0.9, 0.03), () => g.cbox(0.62, 0.08, 0.08, 0.01, woodTint(HM_OAK, 4))); }); g.in(M(1.2, 0.56, st.r), () => { g.surf(K_PLAIN, 0.4, 0, 0.8); g.flat([[-0.15, -0.19, 0], [0.15, -0.19, 0], [0.15, 0.19, 0], [-0.15, 0.19, 0]], WARM); g.surf(K_WOOD, 0.85); for (const [dx, dy, w2, h2] of [[0, 0, 0.03, 0.38], [0, 0, 0.3, 0.03]]) g.in(M(dx, dy, 0.01), () => g.cbox(w2, h2, 0.02, 0.004, HM_OAK)); for (const e of [-1, 1]) g.in(M(e * 0.24, 0, 0.03, 0, e * 30, 0), () => g.cbox(0.16, 0.4, 0.025, 0.006, woodTint(P.hGreen, e))); }); }
      if (s === 3) g.in(M(0.75, 0.56, st.r), () => { g.surf(K_PLAIN, 0.4, 0, 0.7); g.flat([[-0.15, -0.19, 0], [0.15, -0.19, 0], [0.15, 0.19, 0], [-0.15, 0.19, 0]], WARM); });
    } });
    // the upper storey: cream plaster between oak posts, rails and braces, jettied out a hand
    const ux = hx + 0.06, uz = hz + 0.06;
    g.surf(K_PLASTER, 0.95);
    g.in(M(0, (y1 + y2) / 2, 0), () => g.cbox(2 * ux - 0.04, y2 - y1, 2 * uz - 0.04, 0.01, (x, y, z) => mul(P.hCream, 0.85 + 0.2 * noise3(x * 4, y * 4, z * 4))));
    g.surf(K_WOOD, 0.85);
    for (let s = 0; s < 4; s++) { const W = s % 2 ? uz : ux, D = s % 2 ? ux : uz; g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => {
      const n = Math.max(2, Math.round((2 * W) / 0.45));
      for (let i = 0; i <= n; i++) g.in(M(-W + (2 * W * i) / n, (y1 + y2) / 2, 0), () => g.cbox(0.07, y2 - y1, 0.05, 0.01, woodTint(HM_OAK, s * 10 + i)));
      for (const y of [y1 + 0.03, y2 - 0.03, (y1 + y2) / 2 + 0.1]) g.in(M(0, y, 0.005), () => g.beam(2 * W + 0.06, 0.06, 0.05, 0.01, woodTint(HM_OAK, s + y * 7), 3));
      for (let i = 0; i < n; i++) if (i % 2 === 0) g.beamTo([-W + (2 * W * i) / n + 0.03, y1 + 0.05, 0.01], [-W + (2 * W * (i + 1)) / n - 0.03, (y1 + y2) / 2 + 0.08, 0.01], 0.05, 0.04, 0.008, woodTint(HM_OAK, s * 3 + i), 1);
      if (s !== 1) for (let i = 1; i < n; i += 2) g.in(M(-W + (2 * W * (i + 0.5)) / n, (y1 + y2) / 2 + 0.33, 0.02), () => { g.surf(K_PLAIN, 0.4, 0, 0.6); g.flat([[-0.1, -0.12, 0], [0.1, -0.12, 0], [0.1, 0.12, 0], [-0.1, 0.12, 0]], WARM); g.surf(K_WOOD, 0.85); g.in(M(0, 0, 0.01), () => { g.cbox(0.22, 0.025, 0.02, 0.004, HM_OAK); g.cbox(0.025, 0.26, 0.02, 0.004, HM_OAK); }); });
    }); }
    // the thatch: a deep, rounded coat over a steep gable, ridge along X
    const ex = ux + 0.22, ez = uz + 0.3, ry = 3.25;
    g.surf(K_ROOF, 0.95);
    const TH = rgb(0xa88a4c), thAt = (e, u, v) => { const x = (u - 0.5) * 2 * ex * (1 - 0.04 * v), round = 0.07 * Math.sin(v * Math.PI); return [x, lerp(y2 - 0.12, ry, v) + round, e * lerp(ez, 0.02, v) + e * round * 0.6]; };
    for (const e of [-1, 1]) {
      g.sheet(nq(22), nq(10), (u, v) => thAt(e, u, v), thatchCol(TH, e + 3), false, e < 0);
      // the coat is a hand thick: rolled verges up each gable edge and a bullnosed eave
      for (const u of [0, 1]) { const pts = []; for (let k = 0; k <= 8; k++) { const p = thAt(e, u, k / 8); pts.push([p[0] + (u ? 0.02 : -0.02), p[1] - 0.06, p[2]]); } g.tube(pts, 0.09, nq(7), thatchCol(mul(TH, 0.85), 5 + u), true); }
      const pe = []; for (let k = 0; k <= 10; k++) { const p = thAt(e, k / 10, 0); pe.push([p[0] * 1.02, p[1] - 0.05, p[2]]); } g.tube(pe, 0.1, nq(7), thatchCol(mul(TH, 0.8), 7 + e), true);
    }
    // gable ends (plaster triangles with an oak king post), a ridge roll of sedge
    for (const e of [-1, 1]) g.in(M(e * (ux - 0.01), 0, 0, 0, e * 90, 0), () => { g.surf(K_PLASTER, 0.95); g.flat([[-uz, y2, 0], [uz, y2, 0], [0, ry - 0.1, 0]], mul(P.hCream, 0.92)); g.surf(K_WOOD, 0.85); g.in(M(0, (y2 + ry - 0.1) / 2, 0.02), () => g.cbox(0.06, ry - 0.1 - y2, 0.04, 0.01, woodTint(HM_OAK, e))); });
    g.surf(K_ROOF, 0.9); g.in(M(0, ry + 0.02, 0, 0, 0, 90), () => g.in(M(0, -ex - 0.02, 0), () => g.cyl(0.11, 0.11, 2 * ex + 0.04, nq(10), thatchCol(rgb(0x9a8048), 9), true, true)));
    for (let i = 0; i < 7; i++) { const x = -ex + 0.1 + i * ((2 * ex - 0.2) / 6); for (const e of [-1, 1]) rope(g, [[x, ry + 0.1, 0], [x, ry - 0.1, e * 0.16]], 0.008, rgb(0x6a5030), 4); }
    // the baker's sign: a gilded loaf on a bracket
    g.in(M(0.2, 1.5, uz + 0.02), () => { g.surf(K_PLAIN, 0.5, 0.8); g.tube([[0, 0, 0], [0, 0.02, 0.32]], 0.014, 5, IRON); g.in(M(0, -0.02, 0.28), () => { chain(g, [[0, 0, 0], [0, -0.1, 0]], 0.025); g.surf(K_WOOD, 0.7); g.in(M(0, -0.24, 0), () => g.cbox(0.34, 0.24, 0.03, 0.01, woodTint(P.hGreen, 4))); g.surf(K_PLAIN, 0.45, 0.6); g.in(M(0, -0.24, 0.025), () => g.add(new THREE.SphereGeometry(0.1, 10, 6).scale(1.2, 0.55, 0.4), P.brass)); }); });
  });
  // the oven chimney on the west gable: a fat stone stack on a domed bread oven
  g.in(M(cx - hx - 0.2, 0, -0.1), () => {
    stoneBox(g, 0.22, 0.32, 0, 2.6, st, 590, { quoin: [0.3, 0.18] });
    stoneBox(g, 0.16, 0.2, 2.6, 3.75, st, 591, { noFoot: true });
    g.surf(K_STONE, 0.9); g.in(M(0, 3.78, 0), () => g.cbox(0.4, 0.07, 0.48, 0.01, stoneTint(HM_STONE, 3, 5)));
    g.surf(K_PLAIN, 0.8); for (const z of [-0.08, 0.08]) g.in(M(0, 3.8, z), () => g.lathe([[0.06, 0], [0.07, 0.12], [0.05, 0.18], [0.06, 0.2]], nq(8), rgb(0xa8583a)));
    fog.in(M(cx - hx - 0.2, 4.0, -0.1), () => smoke(fog, 0.1, 1.0, 7, [0.45, 0.45, 0.47], [0.85, 0.85, 0.87], 5, 0.3));
    g.in(M(-0.12, 0, 0.42), () => { g.surf(K_STONE, 0.9); g.sheet(nq(16), nq(6), (u, v) => { const a = u * Math.PI, r = 0.36 * Math.cos(v * Math.PI / 2); return [Math.cos(a) * r, 0.25 + Math.sin(v * Math.PI / 2) * 0.32, Math.sin(a) * r * 0.9]; }, stoneTint(mix(HM_STONE, HM_BRICK[0], 0.4), 5, 6)); g.in(M(0, 0.12, 0), () => g.cbox(0.74, 0.26, 0.66, 0.02, stoneTint(HM_STONE, 6, 5))); g.in(M(0, 0.3, 0.33), () => { g.surf(K_PLAIN, 0.8, 0, 0.9); g.flat([[-0.1, -0.06, 0], [0.1, -0.06, 0], [0.1, 0.06, 0], [0, 0.11, 0], [-0.1, 0.06, 0]], [1.0, 0.45, 0.1]); }); });
  });
  // the mill race: a stone-lined channel down the east side, the wheel turning in it, a flume from the hill
  const wx = 1.08;
  g.surf(K_STONE, 0.9);
  for (const x of [wx - 0.32, wx + 0.32]) g.in(M(x, 0.08, 0), () => g.cbox(0.12, 0.2, 2.96, 0.02, stoneTint(HM_STONE, x * 7, 5)));
  water(g, wx - 0.26, wx + 0.26, -1.48, 1.48, 0.1, 5, [0.12, 0.3, 0.36], 0.12);
  g.in(M(wx, 0.92, 0.0, 0, 90, 0), () => {
    for (const e of [-1, 1]) g.in(M(0, 0, e * 0.13), () => wheel(g, 0.84, 0.05, 8, rgb(0x6a4a2c), 600 + e));
    g.surf(K_WOOD, 0.88);
    for (let i = 0; i < 16; i++) g.in(M(0, 0, 0, 0, 0, i * 22.5), () => g.in(M(0, 0.8, 0, 0, 0, 12), () => g.cbox(0.04, 0.2, 0.3, 0.008, woodTint(rgb(0x5a4028), i))));
    g.in(M(0, 0, -0.1, 90, 0, 0), () => g.in(M(0, -0.5, 0), () => g.cyl(0.06, 0.06, 0.62, 8, woodTint(HM_OAK, 3), true, true)));
  });
  g.surf(K_WOOD, 0.88);
  g.in(M(wx, 1.86, -0.9), () => g.in(M(0, 0, 0, 0, 90, 0), () => { g.beam(1.2, 0.05, 0.3, 0.01, woodTint(rgb(0x6a4a2c), 1), 3); for (const e of [-1, 1]) g.in(M(0, 0.09, e * 0.14), () => g.beam(1.2, 0.18, 0.04, 0.008, woodTint(rgb(0x6a4a2c), e + 3), 3)); }));
  water(g, wx - 0.11, wx + 0.11, -1.48, -0.32, 1.92, 7, [0.14, 0.34, 0.4], 0.14);
  for (const z of [-1.35, -0.75]) for (const e of [-1, 1]) g.beamTo([wx + e * 0.2, 0, z], [wx + e * 0.13, 1.82, z], 0.06, 0.06, 0.01, woodTint(HM_OAK, z * 9 + e), 2);
  // spray off the wheel and a little foam where the race runs on
  fog.in(M(wx, 0.2, 0.3), () => fogBank(fog, 0.45, 0.35, 0.6, 3, 5, [0.8, 0.9, 0.95], 0.15));
  fog.in(M(wx, 1.7, -0.3), () => fogBank(fog, 0.2, 0.2, 0.25, 4, 3, [0.8, 0.9, 0.95], 0.15));
  // flour sacks by the door, a cart, a spare millstone leaning on the wall
  for (const [x, z, s, sd] of [[0.5, 0.95, 0.9, 1], [0.3, 1.1, 0.85, 2], [0.48, 1.25, 0.8, 3], [0.65, 1.12, 0.75, 4], [0.42, 1.0, 0.7, 5]]) g.in(M(x, sd === 5 ? 0.3 : 0, z, sd === 5 ? 70 : 0, sd * 60, 0), () => sack(g, s, rgb(0xe8dcc0), sd));
  g.in(M(-1.05, 0, 1.15, 0, 30, 0), () => { g.surf(K_WOOD, 0.88); g.in(M(0, 0.34, 0), () => g.cbox(0.7, 0.06, 0.4, 0.01, woodTint(rgb(0x7a5a38), 2))); for (const e of [-1, 1]) g.in(M(0, 0.22, e * 0.24), () => wheel(g, 0.22, 0.04, 6, rgb(0x6a4a2c), e)); g.beamTo([0.35, 0.34, 0], [0.75, 0.1, 0.1], 0.04, 0.04, 0.01, woodTint(HM_OAK, 5), 1); g.in(M(-0.1, 0.37, 0), () => sack(g, 0.7, rgb(0xe8dcc0), 7)); g.in(M(0.15, 0.37, 0.05, 0, 40, 0), () => sack(g, 0.65, rgb(0xd8c8a0), 8)); });
  g.in(M(0.25, 0.32, -hz - 0.1, 76, 0, 0), () => { g.surf(K_STONE, 0.9); g.cyl(0.32, 0.32, 0.12, nq(16), stoneTint(rgb(0x8a8478), 3, 5), true, true); });
  g.in(M(-1.1, 0, 0.45), () => flowerBed(g, 0.3, 0.3, 610, 3));
}

// =====================================================================================================
// Baobab: great trees, raffia, white beads and ochre
// =====================================================================================================
const DUST = rgb(0xa88a5a), BARK_B = rgb(0x9a8a7e), DARKIN = [0.03, 0.025, 0.02];
const dustCol = (seed = 0) => (x, y, z) => mul(mix(DUST, rgb(0xb8783e), 0.35 * noise3(x * 1.4 + seed, 1, z * 1.4)), 0.78 + 0.32 * fbm3(x * 4 + seed, y * 4, z * 4, 2));
/** woven raffia: an over-under check in two shades */
const weaveCol = (base, k = 14) => (x, y, z, nx, ny, nz, u = 0, v = 0) => { const a = Math.floor(x * k) + Math.floor(z * k), b = ((x * k) % 1 + 1) % 1; return mul(base, (a % 2 ? 1.05 : 0.72) * (0.85 + 0.2 * Math.abs(b - 0.5)) * (0.9 + 0.2 * noise3(x * 20, y * 20, z * 20))); };
/** a ring of geometric paint: zigzags of ochre, white and soot round a wall of radius R between y0 and y1 */
const zigzagCol = (y0, y1, base, seed = 0) => (x, y, z) => {
  const a = Math.atan2(z, x) / TAU, t = (y - y0) / (y1 - y0);
  if (t < 0.12 || t > 0.88) return mul(rgb(0x2a1e16), 0.9 + 0.2 * noise3(x * 20, y * 20, z * 20));
  const zz = tri1(a * 18) * 0.76 + 0.12, row = t > zz;
  const dots = Math.abs(t - 0.5) < 0.06 && Math.abs(((a * 36) % 1 + 1) % 1 - 0.5) < 0.18;
  return mul(dots ? rgb(0x2a1e16) : row ? P.beads : P.ochre, 0.85 + 0.2 * noise3(x * 14 + seed, y * 14, z * 14));
};
/** a string of beads hanging from the origin */
function beadString(g, l, seed = 0, cols = [P.beads, P.ochre, rgb(0x2a6a8a)]) {
  const n = Math.max(3, Math.round(l / 0.045));
  g.surf(K_PLAIN, 0.35);
  for (let i = 0; i < n; i++) g.in(M(0.006 * Math.sin(i + seed), -i * 0.045, 0), () => g.add(new THREE.IcosahedronGeometry(0.019, 0), i % 5 === 4 ? cols[1 + ((seed + i) % (cols.length - 1))] : cols[0]));
}
/** painted triangles round a wall of radius R from y0 to y1: white teeth up, ochre teeth down, a row of soot dots between */
function zigzagRing(g, R, y0, y1, n, keep = () => true) {
  g.surf(K_PLAIN, 0.85);
  const at = (a, y) => [Math.cos(a) * R, y, Math.sin(a) * R], h = y1 - y0;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU, am = (a0 + a1) / 2;
    if (!keep(am)) continue;
    facet(g, [at(a0, y0), at(a1, y0), at(am, y1 - h * 0.1)], P.beads, [0, y0 + h / 2, 0]);
    facet(g, [at(a1 - 0.001, y1), at(am + 0.002, y1), at((am + a1) / 2, y0 + h * 0.45)], P.ochre, [0, y0 + h / 2, 0]);
    facet(g, [at(am - 0.002, y1), at(a0 + 0.001, y1), at((a0 + am) / 2, y0 + h * 0.45)], P.ochre, [0, y0 + h / 2, 0]);
  }
}
const baoR = (y) => (y < 0.4 ? lerp(1.32, 1.16, y / 0.4) : y < 1.9 ? lerp(1.16, 1.2, Math.sin(((y - 0.4) / 1.5) * Math.PI / 2)) : y < 3.6 ? lerp(1.2, 0.95, (y - 1.9) / 1.7) : lerp(0.95, 0.62, Math.min(1, (y - 3.6) / 0.7)));
function baobabTree(g) {
  g.moss = 0.1;
  pad(g, 3, 3, 0.03, dustCol(3), 601, { sq: 2.4 });
  // the trunk: a fat fluted bottle of grey-pink bark, a doorway carved into its belly
  const TOP = 4.3, door = (a, y) => { const da = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)) * 1.18; const w = 0.27; return y < 0.75 ? Math.abs(da) < w : (da / w) ** 2 + ((y - 0.75) / 0.32) ** 2 < 1; };
  g.surf(K_WOOD, 0.95);
  g.sheet(nq(56), nq(36), (u, v) => {
    const a = u * TAU, y = -0.1 + v * (TOP + 0.1), fl = 1 + 0.045 * Math.sin(a * 13 + 0.6 * noise3(Math.cos(a), y * 0.7, Math.sin(a))) + 0.06 * (noise3(Math.cos(a) * 1.6, y * 0.5, Math.sin(a) * 1.6) - 0.5);
    let r = baoR(y) * fl;
    if (door(a, y)) r -= 0.3;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  }, (x, y, z) => {
    const a = Math.atan2(z, x);
    if (door(a, y)) return mul(DARKIN, 1 + 2 * (y / 1.1));
    const strk = noise3(x * 2, y * 7, z * 2), c = mul(mix(BARK_B, rgb(0xb09080), 0.5 * noise3(x * 1.3, y * 0.6, z * 1.3)), (0.74 + 0.36 * strk) * (0.82 + 0.22 * Math.abs(Math.sin(a * 13))));
    // a band of ochre handprints and white dots round the trunk at shoulder height
    if (y > 1.35 && y < 1.55 && Math.abs(Math.sin(a * 9)) > 0.75) return mul(P.ochre, 0.9);
    if (Math.abs(y - 1.65) < 0.03 && Math.abs(Math.sin(a * 24)) > 0.6) return P.beads;
    return c;
  }, true, true);
  // the lip of the doorway, worn smooth, a hide hanging half across it
  { const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16, ang = Math.PI * (1 - t); const lx = Math.cos(ang) * 0.27 / 1.18 * 1.0, ly = 0.75 + Math.sin(ang) * 0.32; pts.push([lx * baoR(ly) * 1.0, ly, 0]); }
    const full = [[-0.27 / 1.18 * baoR(0.05), 0.0, 0], [-0.27 / 1.18 * baoR(0.4), 0.4, 0], ...pts, [0.27 / 1.18 * baoR(0.4), 0.4, 0], [0.27 / 1.18 * baoR(0.05), 0.0, 0]];
    g.surf(K_WOOD, 0.9); g.tube(full.map(([lx, ly]) => { const a = Math.PI / 2 - lx / baoR(ly); return [Math.cos(a) * baoR(ly) * 0.97, ly, Math.sin(a) * baoR(ly) * 0.97]; }), 0.05, 5, (x, y, z) => mul(BARK_B, 0.6 + 0.3 * noise3(x * 9, y * 9, z * 9)), true); }
  g.in(M(0.12, 1.06, baoR(1.0) - 0.12, 0, 6, 0), () => hideSheet(g, 6, 6, (u, v) => [(u - 0.5) * 0.3, -v * 0.85, 0.02 * Math.sin(u * 7 + v * 3)], rgb(0xa8784a), 3));
  // the crown: a cap of bark and stubby branches spreading like roots in the sky
  g.surf(K_WOOD, 0.95);
  g.in(M(0, TOP - 0.02, 0), () => g.sheet(nq(24), 4, (u, v) => { const a = u * TAU, r = baoR(TOP) * Math.cos(v * Math.PI / 2); return [Math.cos(a) * r, Math.sin(v * Math.PI / 2) * 0.25, Math.sin(a) * r]; }, (x, y, z) => mul(BARK_B, 0.8 + 0.3 * noise3(x * 5, y * 5, z * 5)), true));
  g.in(M(0, TOP + 0.2, 0), () => leafClump(g, 0.4, 619, [rgb(0x5a7a2a), rgb(0x6a8a32)], 3, { flat: 0.4 }));
  const tips = [], rnd = rng(611);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + rnd() * 0.4, L = 1.25 + 0.35 * rnd(), rise = 1.0 + 0.7 * rnd();
    const p0 = [Math.cos(a) * 0.35, TOP - 0.1, Math.sin(a) * 0.35], p1 = [Math.cos(a) * 0.8, TOP + rise * 0.45, Math.sin(a) * 0.8], p2 = [Math.cos(a + 0.15) * L, TOP + rise, Math.sin(a + 0.15) * L];
    limb(g, [p0, p1, p2], [0.26, 0.17, 0.05], { nu: nq(8), nv: nq(10), amp: 0.08, seed: k, col: (x, y, z) => mul(BARK_B, 0.7 + 0.35 * noise3(x * 6, y * 6, z * 6)), capB: true });
    for (const s of [-1, 1]) { const b = [p2[0] + Math.cos(a + s * 0.7) * 0.4, p2[1] + 0.25 + 0.15 * rnd(), p2[2] + Math.sin(a + s * 0.7) * 0.4]; limb(g, [v3(p1, p2, 0.6), b], [0.06, 0.02], { nu: 5, nv: 3, col: mul(BARK_B, 0.8) }); tips.push(b); }
    tips.push(p2);
  }
  for (const [i, t] of tips.entries()) if (i % 2 === 0) g.in(M(t[0], t[1] + 0.06, t[2]), () => leafClump(g, 0.34, 620 + i, [rgb(0x5a7a2a), rgb(0x6a8a32), rgb(0x4a6a24)], 3, { flat: 0.45 }));
  // the platform: a woven deck round the crown on lashed poles, a rail of sticks, a little grass hut
  const PY = TOP + 0.12, R0 = 0.55, R1 = 1.55;
  g.surf(K_CLOTH, 0.95);
  g.sheet(nq(40), 3, (u, v) => { const a = u * TAU, r = lerp(R0, R1, v); return [Math.cos(a) * r, PY + 0.02 * Math.sin(a * 9), Math.sin(a) * r]; }, weaveCol(P.raffia, 11), true);
  g.sheet(nq(40), 1, (u, v) => { const a = u * TAU; return [Math.cos(a) * R1, PY - v * 0.08, Math.sin(a) * R1]; }, mul(P.raffia, 0.6), true);
  g.surf(K_WOOD, 0.9);
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU + 0.2; logTo(g, [Math.cos(a) * 0.5, PY - 0.06, Math.sin(a) * 0.5], [Math.cos(a) * (R1 + 0.05), PY - 0.06, Math.sin(a) * (R1 + 0.05)], 0.035, 0.03, k, { seg: 6, capB: true }); }
  const rails = 22;
  for (let k = 0; k < rails; k++) { const a = (k / rails) * TAU; if (Math.abs(a - 0.45) < 0.14) continue; g.in(M(Math.cos(a) * (R1 - 0.04), PY, Math.sin(a) * (R1 - 0.04), (hash1(k, 3) - 0.5) * 8, 0, (hash1(k, 4) - 0.5) * 8), () => g.cyl(0.018, 0.014, 0.42, 5, woodTint(rgb(0x6a5032), k), false, true)); }
  rope(g, Array.from({ length: 29 }, (_, i) => { const a = (i / 28) * TAU; return [Math.cos(a) * (R1 - 0.04), PY + 0.38 - 0.03 * Math.abs(Math.sin(a * rails / 2)), Math.sin(a) * (R1 - 0.04)]; }), 0.012, rgb(0xb89c68), 4);
  g.in(M(-0.95, PY, -0.55), () => {
    g.surf(K_PLAIN, 0.9); g.in(M(0, 0, 0), () => g.lathe([[0.36, 0], [0.36, 0.3]], nq(14), zigzagCol(0, 0.3, P.ochre, 4)));
    g.surf(K_ROOF, 0.95); g.sheet(nq(18), nq(5), (u, v) => { const a = u * TAU, r = lerp(0.48, 0.02, v); return [Math.cos(a) * r, 0.24 + v * 0.62 - 0.05 * Math.sin(v * Math.PI), Math.sin(a) * r]; }, thatchCol(rgb(0xc8a050), 6), true, true);
    g.in(M(0, 0.86, 0), () => { g.surf(K_PLAIN, 0.3); g.add(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 1.3, 1), P.beads); });
  });
  // ladders: a pole ladder up the front, a rope ladder down the back
  ladder(g, [1.45, 0, 0.62], [1.22, PY + 0.05, 0.56], 0.36, 630, rgb(0x7a5a38));
  g.in(M(-0.2, PY, -R1 + 0.02), () => { for (const e of [-1, 1]) rope(g, [[e * 0.15, 0, 0], [e * 0.15, -PY * 0.5, -0.06], [e * 0.15, -PY + 0.1, -0.02]], 0.012, rgb(0xb89c68), 4); g.surf(K_WOOD, 0.9); for (let i = 1; i < 14; i++) { const t = i / 14, y = -t * (PY - 0.1); g.in(M(0, y, -0.06 * Math.sin(t * Math.PI)), () => g.cbox(0.34, 0.025, 0.04, 0.006, woodTint(rgb(0x7a5a38), i))); } });
  // bead strings off the platform rim, pots and baskets round the foot, a fire ring
  for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU + 0.1; g.in(M(Math.cos(a) * (R1 + 0.01), PY - 0.08, Math.sin(a) * (R1 + 0.01)), () => beadString(g, 0.3 + 0.25 * hash1(k, 9), k)); }
  for (const [x, z, h, c, sd] of [[-1.2, 1.05, 0.34, rgb(0x9a5a32), 1], [-0.95, 1.25, 0.26, rgb(0x8a4a2a), 2], [1.15, -1.1, 0.3, rgb(0xa86a3a), 3]]) g.in(M(x, 0, z), () => jar(g, h, c, { stripe: P.beads, stripe2: rgb(0x2a1e16) }));
  for (const [x, z, sd] of [[-1.3, 0.75, 1], [0.5, 1.35, 2]]) g.in(M(x, 0, z), () => { g.surf(K_CLOTH, 0.9); g.lathe([[0.1, 0], [0.17, 0.08], [0.19, 0.16], [0.17, 0.17]], nq(12), weaveCol(P.raffia, 30)); });
  g.in(M(0.55, 0, 1.25), () => { for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU; g.in(M(Math.cos(a) * 0.17, 0.03, Math.sin(a) * 0.17), () => boulder(g, 0.05, 0.04, 0.05, 640 + k, rgb(0x6a5a4a), 10)); } g.surf(K_WOOD, 0.9); for (let k = 0; k < 3; k++) g.in(M(0, 0.04, 0, 0, k * 60, 0), () => g.cbox(0.26, 0.035, 0.035, 0.006, charCol(k))); });
}
function grassDome(g) {
  g.moss = 0.1;
  pad(g, 2, 2, 0.03, dustCol(9), 651, { sq: 2.4 });
  const R = 0.8, PH = 0.3, TOP = 1.5;
  const dome = (t) => { const r = R * Math.pow(Math.sin(Math.min(1, t) * Math.PI / 2 + Math.PI / 2), 0.9); return r; };
  const door = (a, y) => { const da = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)) * R; return y < 0.62 ? Math.abs(da) < 0.22 && y > 0.0 : (da / 0.22) ** 2 + ((y - 0.62) / 0.2) ** 2 < 1; };
  // the plinth: a mud wall painted round in zigzags of ochre, white and soot
  g.surf(K_PLASTER, 0.9);
  g.sheet(nq(48), 3, (u, v) => { const a = u * TAU, y = -0.04 + v * (PH + 0.04), r = (R + 0.06) * (1 + 0.01 * Math.sin(a * 7)) - (door(a, y + 0.02) ? 0.12 : 0); return [Math.cos(a) * r, y, Math.sin(a) * r]; }, (x, y, z) => (door(Math.atan2(z, x), y + 0.02) ? DARKIN : mul(rgb(0x7a3a22), 0.8 + 0.3 * noise3(x * 12, y * 12, z * 12))), true, true);
  zigzagRing(g, R + 0.075, 0.05, PH - 0.03, 30, (a) => !door(a, 0.15));
  g.lathe([[R + 0.06, PH], [R + 0.03, PH + 0.03], [R - 0.05, PH + 0.04]], nq(40), mul(rgb(0x8a5a36), 0.9));
  // the dome: bent saplings under a coat of savanna grass laid in overlapping skirts
  const rings = 7;
  for (let j = 0; j < rings; j++) {
    const t0 = j / rings, t1 = Math.min(1, (j + 1.6) / rings), y0 = PH + t0 * (TOP - PH) - 0.04, y1 = PH + t1 * (TOP - PH);
    g.surf(K_ROOF, 0.95);
    g.sheet(nq(68), 3, (u, v) => {
      const a = u * TAU, rag = v < 0.01 ? 0.04 * Math.abs(Math.sin(a * 37 + j)) + 0.03 * noise3(Math.cos(a) * 9, j, Math.sin(a) * 9) : 0, t = lerp(t0, t1, v), y = lerp(y0, y1, v) - rag;
      let r = (R * Math.cos(t * Math.PI / 2 * 0.98) + 0.04 * (1 - v) + 0.015) * (1 + 0.025 * Math.abs(Math.sin(a * 34 + j * 1.7)));
      if (door(a, y)) r *= 0.6;
      return [Math.cos(a) * r, y, Math.sin(a) * r];
    }, (x, y, z) => (door(Math.atan2(z, x), y) ? DARKIN : mul(thatchCol(mix(P.raffia, rgb(0x9a7a40), 0.5 * hash1(j, 5)), j)(x, y, z), 0.8 + 0.25 * Math.abs(Math.sin(Math.atan2(z, x) * 34 + j * 1.7)))), true, true);
  }
  // bent saplings over the grass, binding it down, lashed where they cross
  for (let k = 0; k < 4; k++) { const az = (k / 4) * Math.PI + 0.39, pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16, th = (t - 0.5) * Math.PI * 0.94, y = PH + Math.cos(th) * (TOP - PH) * 0.98, rr = (R + 0.05) * Math.sin(Math.abs(th)) * Math.sign(th) * 1.0; const q = Math.abs(th) / (Math.PI / 2), r2 = (R * Math.cos((1 - q) * Math.PI / 2 * 0.98) + 0.05) * Math.sign(th); pts.push([Math.cos(az) * r2, PH + (1 - q) * (TOP - PH) * 0.97 + 0.02, Math.sin(az) * r2]); } g.surf(K_WOOD, 0.85); g.tube(pts, 0.018, 5, woodTint(rgb(0x6a4a2c), k), true); }
  g.in(M(0, PH + 0.42, 0), () => { g.surf(K_CLOTH, 0.9); g.lathe([[R * 0.86, -0.02], [R * 0.86 + 0.03, 0], [R * 0.86, 0.02]], nq(40), rgb(0x8a6a3a)); });
  // the door: a bent-sapling arch, lashed, a woven screen leaning beside it
  g.surf(K_WOOD, 0.85);
  for (const s of [0, 0.05]) { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14, ang = Math.PI * (1 - t); pts.push([Math.cos(ang) * (0.24 + s), 0.62 + Math.sin(ang) * (0.24 + s), 0]); } g.tube([[-(0.24 + s), 0, 0], ...pts, [0.24 + s, 0, 0]].map(([x, y]) => { const a = Math.PI / 2 - x / R, rr = (y < PH ? R + 0.07 : R * Math.cos(((y - PH) / (TOP - PH)) * Math.PI / 2 * 0.98) + 0.06) + s * 0.4; return [Math.cos(a) * rr, y, Math.sin(a) * rr]; }), 0.025, 5, woodTint(rgb(0x7a5a38), s * 99), true); }
  g.in(M(0.42, 0, R + 0.12, -8, -20, 0), () => { g.surf(K_CLOTH, 0.95); g.in(M(0, 0.38, 0), () => g.cbox(0.4, 0.76, 0.03, 0.01, weaveCol(P.raffia, 22))); });
  // the top knot: grass tied off with a ring of beads, an ostrich egg on a spike
  g.surf(K_ROOF, 0.9); g.in(M(0, TOP - 0.05, 0), () => g.lathe([[0.16, 0], [0.08, 0.08], [0.05, 0.18], [0.09, 0.26], [0, 0.3]], nq(12), thatchCol(P.raffia, 8)));
  g.in(M(0, TOP + 0.06, 0), () => { for (let k = 0; k < 14; k++) { g.surf(K_PLAIN, 0.35); g.in(M(Math.cos(k * 0.449) * 0.075, 0, Math.sin(k * 0.449) * 0.075), () => g.add(new THREE.IcosahedronGeometry(0.02, 0), k % 3 ? P.beads : P.ochre)); } });
  g.in(M(0, TOP + 0.26, 0), () => { g.surf(K_PLAIN, 0.4); g.add(new THREE.SphereGeometry(0.07, 10, 8).scale(1, 1.25, 1), mul(P.beads, 1.02)); });
  // pots and a calabash by the door, a sleeping mat airing on the dome, a grinding stone
  for (const [x, z, h, sd] of [[-0.5, 0.75, 0.28, 1], [-0.68, 0.55, 0.2, 2]]) g.in(M(x, 0, z), () => jar(g, h, rgb(0x9a5a32), { stripe: P.beads, stripe2: rgb(0x2a1e16) }));
  g.in(M(0.7, 0, 0.6), () => { g.surf(K_PLAIN, 0.6); g.add(new THREE.SphereGeometry(0.12, 10, 8).scale(1, 0.85, 1).translate(0, 0.1, 0), (x, y, z) => mul(rgb(0xc8a050), 0.8 + 0.3 * noise3(x * 20, y * 20, z * 20))); g.in(M(0, 0.2, 0), () => g.cyl(0.03, 0.02, 0.08, 6, rgb(0x8a6a3a), false, true)); });
  g.in(M(0.25, 0, 0.88), () => { g.surf(K_STONE, 0.9); g.cbox(0.3, 0.07, 0.18, 0.03, stoneTint(rgb(0x7a6a5a), 3, 6)); g.in(M(0.02, 0.09, 0), () => g.add(new THREE.SphereGeometry(0.05, 8, 6).scale(1.3, 0.7, 1), rgb(0x6a5a4a))); });
}

// =====================================================================================================
// Nagavar: sandstone towers like lotus buds, serpents, jungle and blood-dark water
// =====================================================================================================
const SAND = rgb(0xa48a62), SAND_PAL = sw(0xa48a62, 0x9a8058, 0xb09468, 0x8e7652, 0xb89c70, 0x84724f), JUNGLE = sw(0x2f5a24, 0x3a6a2a, 0x4a7a32, 0x2a4e20);
const sandSt = (seed, o) => stoneStyle(0xb09468, { seed, pal: SAND_PAL, chip: 0.35, course: 0.167, len: [0.3, 0.56], cell: 0.3 / qual(), ...o });
const sandTint = (seed = 0, k = 1) => (x, y, z, nx, ny) => mix(mul(SAND, k * (0.75 + 0.35 * noise3(x * 4 + seed, y * 4, z * 4)) * (1 - 0.25 * smooth(0.6, 0.85, noise3(x * 9, y * 1.5 + seed, z * 9)))), [0.16, 0.26, 0.1], smooth(0.55, 0.78, noise3(x * 2.6 + seed, y * 2.6 + 3, z * 2.6)) * 0.7);
/** a carved serpent undulating along a wall face (local XY, facing +Z) from x0 to x1 at height y, head at the x1 end */
function serpentRelief(g, x0, x1, y, amp, r, col, seed = 0) {
  const n = 16, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([lerp(x0, x1, t), y + amp * Math.sin(t * Math.PI * 3 + seed), r * 0.6]); }
  g.surf(K_STONE, 0.85);
  g.tube(pts, pts.map((_, i) => r * (i === 0 ? 0.2 : 0.7 + 0.3 * (i / n))), 6, (x, yy, z, nx, ny, nz, t) => mul(col, (0.85 + 0.2 * noise3(x * 9, yy * 9, z * 9)) * (Math.abs(Math.sin(t * 90)) > 0.3 ? 1 : 0.82)), true);
  g.in(M(x1 + r * 0.6, pts[n][1], r * 0.6, 0, 90, 0), () => serpentHead(g, r * 4, col));
}
/** the bud of a temple tower standing on the local origin: redented square plan R across, H high, n tiers with flame antefixes */
function lotusTower(g, R, H, tiers, seed, o = {}) {
  const col = o.col || sandTint(seed), plan = (a) => { const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), q = Math.pow(Math.pow(c, 5) + Math.pow(s, 5), -1 / 5); return q * (1 - 0.08 * smooth(0.7, 0.95, Math.abs(Math.sin(2 * a)))); };
  const env = (t) => R * (1 - 0.8 * Math.pow(t, 1.35)), prof = (t) => { const f = (t * tiers) % 1; return env(t) * (0.9 + 0.12 * Math.pow(Math.sin(Math.PI * Math.min(1, f * 1.15)), 0.6) - (f > 0.9 ? 0.06 : 0)); };
  g.surf(K_STONE, 0.9);
  g.sheet(nq(o.nu || 32), nq(tiers * 5), (u, v) => { const a = u * TAU + Math.PI / 4, r = prof(v) * plan(a); return [Math.cos(a) * r, v * H, Math.sin(a) * r]; }, col, true, true);
  // antefixes: little flame-shaped leaves standing out at the foot of each tier
  for (let i = 1; i < tiers; i += o.anteEvery || 1) {
    const t = i / tiers, y = t * H, r = env(t) * 0.98, s = 0.32 * env(t) / R + 0.12;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU, rr = r * plan(a + Math.PI / 4); g.in(M(Math.sin(a) * rr, y - 0.01, Math.cos(a) * rr, 0, a / DEG, 0), () => { g.surf(K_STONE, 0.85); g.in(M(0, 0, 0, -14, 0, 0), () => prism(g, MERLON.point(0.2 * s, 0.34 * s), 0.05, o.ante || mul(SAND, 0.95), [0, 0.1 * s])); }); }
  }
  // the crown: a cushion and a gilded spike
  g.surf(K_STONE, 0.85); g.in(M(0, H - 0.02, 0), () => g.lathe([[env(1) * 1.4, 0], [env(1) * 1.9, 0.06], [env(1) * 1.4, 0.14], [0.02, 0.16]], nq(12), col));
  g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, H + 0.12, 0), () => g.lathe([[0.05, 0], [0.07, 0.05], [0.04, 0.1], [0.06, 0.16], [0.02, 0.3], [0, 0.42 * (o.spike || 1)]].map(([r, y]) => [r * (o.spike || 1), y]), nq(10), P.nGold));
}
/** a naga balustrade: a serpent body on stubby posts from a (tail) to b, rearing at b into a seven-headed hood toward `face` */
function nagaRail(g, a, b, hood, col, seed = 0) {
  const n = 5, pts = [];
  for (let i = 0; i <= n; i++) pts.push(v3(a, b, i / n));
  g.surf(K_STONE, 0.85);
  for (let i = 0; i < n; i++) { const p = v3(a, b, (i + 0.5) / n); g.in(M(p[0], 0, p[2]), () => g.cbox(0.08, p[1] * 2 - 0.02, 0.08, 0.01, sandTint(seed + i, 0.9))); }
  g.tube(pts.map((p) => [p[0], p[1] + 0.06, p[2]]), 0.06, 7, (x, y, z, nx, ny, nz, t) => mul(col, (0.85 + 0.2 * noise3(x * 9, y * 9, z * 9)) * (Math.abs(Math.sin(t * 60)) > 0.35 ? 1 : 0.8)), true);
  const d = [b[0] - a[0], 0, b[2] - a[2]], ang = Math.atan2(d[0], d[2]) / DEG;
  g.in(M(b[0], b[1] + 0.02, b[2], 0, ang, 0), () => { limb(g, [[0, 0.04, -0.06], [0, 0.12, 0.04], [0, hood * 0.35, 0.06]], [0.07, 0.07, 0.065], { nu: nq(8), nv: nq(6), col: sandTint(seed, 0.95) }); g.in(M(0, hood * 0.3, 0.06), () => sevenHeads(g, hood, mul(col, 1.02))); });
}
function serpentTemple(g) {
  g.moss = 1.5;
  pad(g, 5, 5, 0.04, (x, y, z) => mix(mul(rgb(0x4a3a28), 0.7 + 0.4 * fbm3(x * 3, y * 3, z * 3, 2)), JUNGLE[1], smooth(0.4, 0.65, noise3(x * 1.3, 2, z * 1.3)) * 0.7), 701, { sq: 4 });
  const T = [[2.3, 0, 0.5], [1.82, 0.5, 1.0], [1.38, 1.0, 1.5]];
  // three terraces of sandstone, a lotus moulding round each lip, serpents carved winding along the faces
  T.forEach(([hx, y0, y1], k) => {
    const st = sandSt(710 + k);
    stoneBox(g, hx, hx, y0, y1, st, 711 + k * 7, { noFoot: k > 0, quoin: [0.4, 0.24], each: (s, W) => {
      if (k === 0) for (const e of [0, 1]) { const x0 = e ? W + 0.5 : 0.25, x1 = e ? 2 * W - 0.3 : W - 0.5; if (s === 0 && e === 0) { serpentRelief(g, x0, x1 - 0.1, (y1 - y0) * 0.45, 0.07, 0.035, mul(SAND, 0.9), s * 3 + e); continue; } serpentRelief(g, x0, x1, (y1 - y0) * 0.45, 0.07, 0.035, mul(SAND, 0.9), s * 3 + e); }
    } });
    g.surf(K_STONE, 0.9);
    for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, y1 - 0.06, hx)), () => g.mould([[0, 0], [0.04, 0.02], [0.07, 0.06], [0.06, 0.08], [0.02, 0.1], [0, 0.1]], 2 * hx, sandTint(s + k * 4), 1, 1));
    g.sheet(6, 6, (u, v) => [lerp(-hx, hx, u), y1 + 0.003, lerp(hx, -hx, v)], (x, y, z) => mix(mul(SAND, 0.7 + 0.25 * noise3(x * 3, k, z * 3)), JUNGLE[0], smooth(0.4, 0.7, noise3(x * 1.7 + k, 1, z * 1.7)) * 0.7));
  });
  // a steep stair up the middle of each face, cheeks carved with lotus
  g.surf(K_STONE, 0.9);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    for (let k = 0; k < 3; k++) { const [hx, y0, y1] = T[k], n = 4, run = k === 0 ? 0.3 : 0.42, w = s === 0 ? 0.72 : 0.5; for (let q = 0; q < n; q++) { const h = ((q + 1) * (y1 - y0)) / n; g.in(M(0, y0 + h / 2 - 0.02, hx + run - (q + 0.5) * (run / n)), () => g.cbox(w, h + 0.04, run / n + 0.01, 0.01, sandTint(q + k * 5 + s, 0.95 - q * 0.02))); }
      for (const e of [-1, 1]) g.in(M(e * (w / 2 + 0.06), y0, hx + run / 2), () => g.in(M(0, 0, 0, 0, 90, 0), () => prism(g, [[run / 2 + 0.02, 0], [-run / 2, 0], [-run / 2, y1 - y0 + 0.08], [-run / 2 + 0.08, y1 - y0 + 0.08], [run / 2 + 0.02, 0.14]], 0.12, sandTint(e + k, 0.9)))); }
  });
  // the naga balustrades up the front stair, hoods raised at its foot
  for (const e of [-1, 1]) nagaRail(g, [e * 0.5, 0.56, T[0][0] + 0.02], [e * 0.5, 0.2, T[0][0] + 0.26], 0.62, mul(SAND, 0.95), 720 + e);
  // the central sanctuary: a square cella with porches, the great bud tower over it
  const st = sandSt(730, { course: 0.11 });
  stoneBox(g, 0.72, 0.72, 1.5, 2.7, st, 731, { noFoot: true, holes: [[[0.5, 0, 0.94, 0.77]], [[0.5, 0, 0.94, 0.77]], [[0.5, 0, 0.94, 0.77]], [[0.5, 0, 0.94, 0.77]]], each: (s) => {
    g.in(M(0.72, 0, st.r), () => { archFrame(g, 0.44, 0.77, 'point', sandTint(s), { t: 0.05, fill: [0.03, 0.02, 0.015] }); if (s === 0) g.in(M(0, 0.76, 0.05), () => hanging(g, 0.36, 0.55, P.nRed, P.nGold, { bar: P.nGold, point: true })); });
    for (const x of [0.12, 1.32]) g.in(M(x, 0.45, st.r), () => nicheFigure(g, 0.9, mul(SAND, 0.92), { back: [0.08, 0.06, 0.04] }));
  } });
  for (let s = 0; s < 4; s++) g.in(M(0, 1.5, 0, 0, s * 90, 0), () => { g.surf(K_STONE, 0.9); g.in(M(0, 0.6, 0.86), () => g.cbox(0.7, 1.2, 0.24, 0.02, sandTint(s + 3, 0.95))); g.in(M(0, 0.4, 0.99), () => { archFrame(g, 0.36, 0.7, 'point', sandTint(s), { t: 0.05, fill: [0.03, 0.02, 0.015] }); }); g.in(M(0, 1.2, 0.86), () => g.in(M(0, 0, 0, 0, 0, 0), () => prism(g, [[-0.42, 0], [0.42, 0], [0.3, 0.2], [0.1, 0.38], [0, 0.55], [-0.1, 0.38], [-0.3, 0.2]], 0.24, sandTint(s + 9, 0.95), [0, 0.15]))); });
  g.in(M(0, 2.7, 0), () => lotusTower(g, 0.82, 3.5, 7, 740));
  // the four corner towers on the top terrace
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.in(M(x * 1.06, 1.5, z * 1.06), () => { stoneBox(g, 0.26, 0.26, 0, 0.62, sandSt(750 + x + z * 3), 751 + x * 2 + z, { noFoot: true }); g.in(M(0, 0.62, 0), () => lotusTower(g, 0.32, 1.5, 4, 760 + x + z * 3, { spike: 0.6, nu: 20, anteEvery: 2 })); });
  // the jungle taking it back: a strangler fig over the back corner, creepers, hanging vines, ferns on the ledges
  g.in(M(-1.95, 0, -1.95), () => {
    const bark = (x, y, z) => mul(rgb(0x6a5a44), 0.7 + 0.4 * noise3(x * 6, y * 3, z * 6));
    g.surf(K_WOOD, 0.95);
    limb(g, [[0, -0.1, 0], [0.05, 1.2, 0.05], [0.1, 2.4, 0.0], [0.0, 3.4, -0.05]], [0.22, 0.18, 0.15, 0.1], { nu: nq(8), nv: nq(10), amp: 0.12, seed: 3, col: bark, capB: true });
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 0.5 + 0.1, L = 0.8 + 0.5 * hash1(k, 3); limb(g, [[0, 1.0 + 0.3 * k, 0], [Math.cos(a) * L * 0.5, 0.8 + 0.2 * k, Math.sin(a) * L * 0.5], [Math.cos(a) * L, 0.45 + 0.1 * k, Math.sin(a) * L], [Math.cos(a) * L * 1.1, -0.05, Math.sin(a) * L * 1.1]], [0.07, 0.06, 0.05, 0.06], { nu: 5, nv: nq(7), col: bark }); }
    for (const [x, y, z, r, sd] of [[0.0, 3.5, 0.0, 0.9, 1], [0.5, 3.1, 0.4, 0.6, 2], [-0.3, 3.0, 0.5, 0.55, 3]]) g.in(M(x, y, z), () => leafClump(g, r, 770 + sd, JUNGLE, 4));
  });
  for (let s = 0; s < 4; s++) for (let k = 0; k < 3; k++) { const [hx, , y1] = T[k], x = (hash1(s, k) - 0.5) * hx * 1.4; if (Math.abs(x) < 0.6) continue; g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(x, y1 - 0.02, hx + 0.03)), () => vines(g, 0.35, 0.3 + 0.25 * hash1(s, k + 3), s * 7 + k, { leaf: JUNGLE, n: 2, leaves: 6 })); }
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90 + 45, 0).multiply(M(0, 0, 3.15)), () => g.in(M(0, 0, 0, 0, 0, 0), () => creeper(g, 0.5, 1.2, 780 + s, { leaf: JUNGLE, n: 3, leaves: 10 })));
  for (const [x, y, z, r, sd] of [[1.95, 0.5, 1.4, 0.35, 1], [-1.7, 0.5, 1.95, 0.3, 2], [1.55, 1.0, -1.5, 0.3, 3], [-1.5, 1.0, -0.6, 0.25, 4], [2.1, 0.04, -2.1, 0.5, 5], [-2.15, 0.04, 2.15, 0.45, 6], [2.2, 0.04, 2.2, 0.4, 7], [1.05, 1.5, 0.3, 0.22, 8]]) g.in(M(x, y + r * 0.3, z), () => leafClump(g, r, 790 + sd, JUNGLE, 4));
  // gilded bowls of offerings at the foot of the stair, red cloth on the rails
  for (const e of [-1, 1]) g.in(M(e * 0.95, 0.5, 2.0), () => fireBowl(g, 0.32, FIRE_HOT, P.nGold, e + 3, 0.8));
}
function bloodWell(g) {
  g.moss = 1.3;
  pad(g, 3, 3, 0.03, (x, y, z) => mix(mul(rgb(0x4a3a28), 0.7 + 0.4 * fbm3(x * 3, y * 3, z * 3, 2)), JUNGLE[1], smooth(0.45, 0.7, noise3(x * 1.6, 2, z * 1.6)) * 0.6), 801, { sq: 4 });
  const K = 1.4, ky = 0.56, st = sandSt(802, { course: 0.14 });
  // the kerb: a coursed wall round the well, a serpent winding along each face
  stoneBox(g, K, K, 0, ky, st, 803, { each: (s, W) => serpentRelief(g, 0.35, 2 * W - 0.5, ky * 0.48, 0.06, 0.03, mul(SAND, 0.88), s) });
  g.surf(K_STONE, 0.9);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, ky - 0.04, K)), () => g.mould([[0, 0], [0.05, 0.02], [0.07, 0.06], [0.04, 0.08], [0, 0.08]], 2 * K, sandTint(s), 1, 1));
  // the steps: square rings of sandstone stepping down on all four sides to the water
  const n = 6, tread = 0.15, rise = (ky - 0.1) / n;
  for (let k = 0; k < n; k++) {
    const o = K - 0.08 - k * tread, i2 = o - tread, y = ky - (k + 1) * rise;
    g.surf(K_STONE, 0.88);
    for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
      g.in(M(-tread / 2, y / 2, (o + i2) / 2), () => g.cbox(2 * o - tread, y, tread + 0.004, 0.008, sandTint(k * 4 + s, 0.95 - k * 0.05)));
    });
  }
  const wr = K - 0.08 - n * tread;
  // the water: still and dark as old blood, a rim of scum, petals floating on it
  g.in(M(0, 0, 0), () => water(g, -wr - 0.01, wr + 0.01, -wr - 0.01, wr + 0.01, 0.12, 5, [0.13, 0.008, 0.012], 0.06));
  const rnd = rng(811);
  for (let i = 0; i < 14; i++) { const x = (rnd() - 0.5) * 2 * (wr - 0.06), z = (rnd() - 0.5) * 2 * (wr - 0.06); g.surf(K_LEAF, 0.6, 0, 0.1); g.in(M(x, 0.125, z, 0, rnd() * 360, 0), () => (i % 3 ? g.add(new THREE.IcosahedronGeometry(0.025, 0).scale(1, 0.4, 1), i % 2 ? rgb(0xe8a030) : rgb(0xd84a2a)) : g.cyl(0.07, 0.07, 0.004, 8, rgb(0x3a6a3a), false, true))); }
  // serpents coiled on the four corners, hoods spread, gilt eyes
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.in(M(x * (K - 0.16), ky, z * (K - 0.16), 0, Math.atan2(x, z) / DEG, 0), () => {
    g.surf(K_STONE, 0.9); g.cbox(0.34, 0.12, 0.34, 0.02, sandTint(x + z * 3, 0.85));
    const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20, a = t * TAU * 1.6, r = 0.13 * (1 - t * 0.45); pts.push([Math.cos(a) * r, 0.1 + t * 0.16, Math.sin(a) * r]); }
    pts.push([0, 0.36, -0.02], [0, 0.5, 0.02]);
    g.surf(K_STONE, 0.85); g.tube(pts, pts.map((_, i) => 0.055 - i * 0.0012), 7, (px, py, pz, nx, ny, nz, t) => mul(mix(P.nGreen, SAND, 0.4), (0.8 + 0.25 * noise3(px * 12, py * 12, pz * 12)) * (Math.abs(Math.sin(t * 70)) > 0.3 ? 1 : 0.75)), true);
    g.in(M(0, 0.48, 0.02), () => sevenHeads(g, 0.36, mix(P.nGreen, SAND, 0.4)));
  });
  // a low parapet of short balusters, broken at the middle of each side, little oil lamps on the kerb
  g.surf(K_STONE, 0.9);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    for (const e of [-1, 1]) { g.in(M(e * 0.75, ky + 0.22, K - 0.06), () => g.cbox(0.62, 0.05, 0.1, 0.012, sandTint(s + e, 1.02))); for (let q = 0; q < 4; q++) g.in(M(e * (0.5 + q * 0.17), ky + 0.04, K - 0.06), () => g.lathe([[0.035, 0], [0.04, 0.03], [0.025, 0.07], [0.04, 0.11], [0.03, 0.15], [0.035, 0.16]], 6, sandTint(q))); }
    for (const x of [-0.3, 0.3]) g.in(M(x, ky + 0.02, K - 0.06), () => { g.surf(K_PLAIN, 0.6); g.lathe([[0.012, 0], [0.04, 0.012], [0.035, 0.024]], 6, rgb(0xa8583a)); g.surf(K_PLAIN, 1, 0, 1.2); g.in(M(0, 0.022, 0), () => g.lathe([[0.012, 0], [0.014, 0.015], [0, 0.05]], 5, [1.0, 0.5, 0.1])); });
    for (const e of [-1, 1]) g.in(M(e * 1.15, ky + 0.25, K - 0.02), () => garland(g, 0.5, 0.12, rgb(0xe8a030), P.nRed, { r: 0.022 }));
    g.in(M(0, ky - 0.1, K + 0.02), () => vines(g, 0.4, 0.35, s * 5 + 3, { leaf: JUNGLE, n: 2, leaves: 5 }));
  });
  for (const [x, z, r, sd] of [[1.3, 0.2, 0.25, 1], [-1.3, -0.5, 0.3, 2], [0.5, -1.35, 0.22, 3]]) g.in(M(x, 0.05, z), () => leafClump(g, r, 820 + sd, JUNGLE, 4));
}

// =====================================================================================================
// Pearlfleet: white marble, turquoise, silver and mother-of-pearl by the sea
// =====================================================================================================
const MARBLE = rgb(0xccd2cc), MARBLE_PAL = sw(0xccd2cc, 0xc2c8c4, 0xd6d8d0, 0xbcc4c2, 0xd2cec4), SEA = [0.05, 0.3, 0.36], LAMP = [0.6, 1.0, 0.95];
const marbleCol = (seed = 0, k = 1) => (x, y, z) => { const v = Math.abs(noise3(x * 3 + seed, y * 3, z * 3) - 0.5); return mul(mix(mix(MARBLE, rgb(0xb8b0a0), smooth(0.4, 0.8, noise3(x * 1.3 + 7, y * 1.3, z * 1.3)) * 0.4), rgb(0x8a9aa0), smooth(0.05, 0, v) * 0.6), k * (0.86 + 0.18 * noise3(x * 11, y * 11, z * 11))); };
/** mother-of-pearl: shifting pink, green and blue sheen */
const nacre = (x, y, z) => { const t = noise3(x * 7, y * 7, z * 7) * 3 + Math.atan2(z, x); return mix(P.pearl, [0.72 + 0.2 * Math.sin(t), 0.82 + 0.12 * Math.sin(t + 2.1), 0.86 + 0.12 * Math.sin(t + 4.2)], 0.7); };
const marbleSt = (seed, o) => stoneStyle(0xe4e8e4, { seed, pal: MARBLE_PAL, chip: 0.08, var: 0.05, rough: 0.004, course: 0.2, len: [0.35, 0.6], cell: 0.25 / qual(), mortar: [0.55, 0.6, 0.6], ...o });
/** a scallop shell on the local XY plane facing +Z, s across */
function scallop(g, s, col) {
  g.surf(K_PLAIN, 0.3, 0.2);
  g.sheet(nq(12), 3, (u, v) => { const a = (u - 0.5) * 2.6, r = s * 0.5 * v * (1 + 0.06 * Math.abs(Math.sin(u * 12 * Math.PI))); return [Math.sin(a) * r, Math.cos(a) * r - s * 0.1, 0.02 * s + 0.12 * s * v * (1 - v)]; }, (x, y, z, nx, ny, nz, u) => mul(typeof col === 'function' ? col(x, y, z) : col, 0.8 + 0.25 * Math.abs(Math.sin(u * 12 * Math.PI))));
  g.in(M(0, -s * 0.12, 0.02 * s), () => g.cbox(s * 0.22, s * 0.1, 0.03 * s, 0.01, typeof col === 'function' ? col(0, 0, 0) : col));
}
function pearlLighthouse(g, fog) {
  g.moss = 0.2;
  pad(g, 2, 2, 0.03, (x, y, z) => mul(rgb(0xc8b890), 0.8 + 0.3 * fbm3(x * 4, y * 4, z * 4, 2)), 901, { sq: 4 });
  // the plinth: two marble steps, a turquoise band, scallops at the corners
  const st = marbleSt(902);
  stoneBox(g, 0.94, 0.94, 0, 0.24, st, 903);
  stoneBox(g, 0.8, 0.8, 0.24, 0.48, st, 904, { noFoot: true });
  g.surf(K_PLAIN, 0.3, 0.3);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, 0.44, 0.8)), () => g.mould([[0, 0], [0.03, 0.01], [0.03, 0.05], [0, 0.06]], 1.6, P.turq, 1, 1));
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90 + 45, 0).multiply(M(0, 0.3, 1.13)), () => scallop(g, 0.22, nacre));
  // the shaft: a fluted marble column tapering away, banded in turquoise and pearl
  const H0 = 0.48, H1 = 6.0, rAt = (y) => lerp(0.6, 0.42, (y - H0) / (H1 - H0));
  g.surf(K_STONE, 0.35, 0.05);
  g.sheet(nq(64), nq(24), (u, v) => { const a = u * TAU, y = lerp(H0, H1, v), r = rAt(y) * (1 - 0.035 * Math.pow(Math.abs(Math.sin(a * 8)), 0.6)); return [Math.cos(a) * r, y, Math.sin(a) * r]; }, marbleCol(3), true, true);
  for (const y of [0.62, 2.0, 3.4, 4.8]) {
    g.surf(K_PLAIN, 0.25, 0.3); g.in(M(0, y, 0), () => g.lathe([[rAt(y) + 0.0, -0.06], [rAt(y) + 0.035, -0.04], [rAt(y) + 0.035, 0.04], [rAt(y), 0.06]], nq(28), P.turq));
    g.surf(K_PLAIN, 0.15, 0.4); g.in(M(0, y + 0.1, 0), () => g.lathe([[rAt(y) - 0.005, -0.025], [rAt(y) + 0.018, 0], [rAt(y) - 0.005, 0.025]], nq(28), nacre));
    g.surf(K_PLAIN, 0.2, 0.9); for (let k = 0; k < 12; k++) g.in(M(0, y, 0, 0, k * 30 + 15, 0).multiply(M(0, 0, rAt(y) + 0.036)), () => g.stud(0.018, P.silver, 6));
  }
  // windows climbing the shaft in a spiral, arched in turquoise, lit within
  for (let i = 0; i < 7; i++) { const y = 1.2 + i * 0.68, a = i * 115 + 20; g.in(M(0, y - 0.18, 0, 0, a, 0).multiply(M(0, 0, rAt(y) - 0.006)), () => { archFrame(g, 0.2, 0.42, 'round', P.turq, { t: 0.03, fill: mul(LAMP, 0.75), fillGlow: 0.7, kind: K_PLAIN }); g.in(M(0, -0.03, 0.03), () => { g.surf(K_STONE, 0.4); g.cbox(0.3, 0.05, 0.08, 0.01, marbleCol(i)); }); }); }
  // a spiral of pearl inlay winding up the shaft between the windows
  { const pts = []; for (let i = 0; i <= 120; i++) { const t = i / 120, y = lerp(0.75, 5.85, t), a = t * TAU * 3.5 + 1.0; pts.push([Math.cos(a) * (rAt(y) - 0.012), y, Math.sin(a) * (rAt(y) - 0.012)]); } g.surf(K_PLAIN, 0.15, 0.4); g.tube(pts, 0.022, 4, nacre, false); }
  // the door: a tall arch, turquoise doors with silver studs, a pearl shell over it
  g.in(M(0, H0, rAt(0.9) - 0.03), () => { archFrame(g, 0.46, 0.95, 'round', P.turq, { t: 0.04, fill: [0.02, 0.05, 0.06], kind: K_PLAIN }); for (const e of [-1, 1]) g.in(M(e * 0.105, 0, 0.012), () => roundDoor(g, 0.2, 0.82, mix(P.turq, rgb(0x1a5a64), 0.5), P.silver, 3 + e, { bands: [0.3, 0.7], ringX: -e * 0.25 })); g.in(M(0, 1.1, 0.04), () => scallop(g, 0.32, nacre)); });
  for (let q = 0; q < 3; q++) g.in(M(0, 0.06 + q * 0.08, 0.98 + q * -0.0 + 0.12 - q * 0.06), () => { g.surf(K_STONE, 0.4); g.cbox(0.6, 0.08, 0.14, 0.01, marbleCol(q, 0.95)); });
  // the gallery: corbels, a silver rail, scallops on the brackets
  const gy = H1;
  g.surf(K_STONE, 0.4);
  g.lathe([[rAt(H1) - 0.02, gy - 0.25], [0.55, gy - 0.12], [0.74, gy - 0.02], [0.76, gy + 0.06], [0, gy + 0.06]], nq(32), marbleCol(5));
  for (let k = 0; k < 12; k++) g.in(M(0, gy - 0.18, 0, 0, k * 30, 0).multiply(M(0, 0, 0.5)), () => { g.surf(K_STONE, 0.4); g.cbox(0.08, 0.2, 0.2, 0.02, marbleCol(k)); g.in(M(0, -0.04, 0.1), () => scallop(g, 0.1, nacre)); });
  g.surf(K_PLAIN, 0.2, 0.9);
  for (let k = 0; k < 20; k++) g.in(M(0, gy + 0.06, 0, 0, k * 18, 0).multiply(M(0, 0, 0.72)), () => g.cyl(0.012, 0.012, 0.34, 5, P.silver, false, true));
  g.in(M(0, gy + 0.4, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.72, 0.018, 5, nq(36)), P.silver));
  g.in(M(0, gy + 0.22, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.72, 0.01, 4, nq(36)), P.silver));
  // the lantern room: slender columns round the great crystal, a turquoise dome and a silver finial
  const ly = gy + 0.06;
  g.surf(K_STONE, 0.4); g.in(M(0, ly, 0), () => g.cyl(0.48, 0.46, 0.14, nq(20), marbleCol(6), false, true));
  for (let k = 0; k < 8; k++) g.in(M(0, ly + 0.14, 0, 0, k * 45, 0).multiply(M(0, 0, 0.42)), () => columnOn(g, 0.86, 0.035, marbleCol(k), P.turq));
  g.in(M(0, ly + 0.14, 0), () => { g.surf(K_PLAIN, 0.3, 0.9); g.cyl(0.12, 0.08, 0.12, nq(10), P.silver, false, true); g.in(M(0, 0.1, 0), () => crystal(g, 0.13, 0.7, 7, { deep: rgb(0x1a8a9a), bright: rgb(0xc8fff8), glow: 1.3, m: 6 })); for (let k = 0; k < 5; k++) { const a = k * 1.26; g.in(M(Math.cos(a) * 0.12, 0.1, Math.sin(a) * 0.12, Math.sin(a) * 22, 0, -Math.cos(a) * 22), () => crystal(g, 0.06, 0.34, 20 + k, { deep: rgb(0x1a8a9a), bright: rgb(0xc8fff8), glow: 1.1, m: 5 })); } });
  fog.surf(K_PLAIN, 1, 0, 1.4); fog.in(M(0, ly + 0.5, 0), () => { fog.add(new THREE.IcosahedronGeometry(0.36, 2), (x, y, z) => mul(LAMP, 0.7 + 0.2 * noise3(x * 9, y * 9, z * 9))); fog.add(new THREE.IcosahedronGeometry(0.22, 2), LAMP); });
  const dy = ly + 1.0;
  g.surf(K_STONE, 0.4); g.in(M(0, dy, 0), () => g.lathe([[0.5, 0], [0.54, 0.04], [0.54, 0.1], [0.48, 0.12]], nq(24), marbleCol(8)));
  g.surf(K_ROOF, 0.25, 0.35);
  g.in(M(0, dy + 0.12, 0), () => g.sheet(nq(32), nq(10), (u, v) => { const a = u * TAU, t = v * Math.PI / 2, r = 0.5 * Math.cos(t) * (1 - 0.04 * Math.abs(Math.sin(a * 8))); return [Math.cos(a) * r, Math.sin(t) * 0.55, Math.sin(a) * r]; }, (x, y, z) => mul(mix(P.turq, rgb(0x1a6a78), Math.abs(Math.sin(Math.atan2(z, x) * 8)) * 0.4), 0.85 + 0.2 * noise3(x * 9, y * 9, z * 9)), true, true));
  g.surf(K_PLAIN, 0.2, 0.9);
  g.in(M(0, dy + 0.64, 0), () => { g.lathe([[0.08, 0], [0.1, 0.04], [0.04, 0.1], [0.06, 0.16], [0.02, 0.28], [0.012, 0.5], [0, 0.56]], nq(12), P.silver); g.in(M(0, 0.24, 0), () => g.add(new THREE.SphereGeometry(0.05, 10, 8), nacre)); });
  // at the foot: a mooring bollard with a coil of rope, an anchor leaning on the plinth
  g.in(M(0.72, 0, 0.72), () => { g.surf(K_PLAIN, 0.3, 0.9); g.lathe([[0.08, 0], [0.08, 0.2], [0.11, 0.24], [0.06, 0.26], [0, 0.27]], nq(10), P.silver); g.in(M(0, 0.12, 0, 90, 0, 0), () => { g.surf(K_CLOTH, 0.9); g.add(new THREE.TorusGeometry(0.11, 0.025, 5, nq(14)), rgb(0xc8b080)); }); });
  g.in(M(-0.98, 0.0, 0.3, 0, 90, 14), () => { g.surf(K_PLAIN, 0.4, 0.85); g.in(M(0, 0.35, 0), () => g.cbox(0.05, 0.7, 0.05, 0.01, P.silver)); g.in(M(0, 0.68, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.06, 0.012, 4, 10), P.silver)); g.in(M(0, 0.08, 0), () => g.add(new THREE.TorusGeometry(0.24, 0.025, 5, nq(14), Math.PI).rotateZ(Math.PI), P.silver)); g.in(M(0, 0.55, 0, 0, 0, 90), () => g.in(M(0, -0.15, 0), () => g.cyl(0.02, 0.02, 0.3, 5, P.silver, true, true))); });
}
function amphitheatre(g, fog) {
  g.moss = 0.6;
  pad(g, 4, 4, 0.03, (x, y, z) => mul(rgb(0xc8b890), 0.8 + 0.3 * fbm3(x * 4, y * 4, z * 4, 2)), 911, { sq: 4 });
  const C = [0, 0, 0.35], R0 = 0.8, tw = 0.17, th = 0.15, nT = 7, WL = 0.3;
  // the cavea: curved tiers of marble seats stepping up from the water, aisles of steps between wedges
  g.in(M(C[0], 0, C[2]), () => {
    for (let k = 0; k < nT; k++) {
      const r = R0 + k * tw, y = 0.08 + (k + 1) * th, c = (x, yy, z) => mix(marbleCol(k)(x, yy, z), [0.5, 0.58, 0.5], yy < WL + 0.12 ? 0.35 : 0);
      g.surf(K_STONE, 0.4);
      g.lathe([[r, -0.05], [r, y - 0.015], [r + 0.012, y], [r + tw + 0.01, y]], nq(40), c, Math.PI, TAU);
      g.surf(K_PLAIN, 0.3, 0.3); if (k % 3 === 1) g.lathe([[r + 0.005, y - 0.05], [r + 0.012, y - 0.04], [r + 0.012, y - 0.025], [r + 0.005, y - 0.02]], nq(40), P.turq, Math.PI, TAU);
    }
    // the back wall: an arcade of arches with turquoise keystones
    const RB = R0 + nT * tw, top = 0.08 + nT * th;
    g.surf(K_STONE, 0.4);
    g.lathe([[RB, 0], [RB + 0.14, 0], [RB + 0.14, top + 0.36], [RB, top + 0.36]], nq(40), marbleCol(30), Math.PI, TAU);
    g.lathe([[RB - 0.02, top + 0.36], [RB + 0.17, top + 0.36], [RB + 0.17, top + 0.42], [RB - 0.02, top + 0.42]], nq(40), marbleCol(31, 1.04), Math.PI, TAU);
    for (let k = 0; k < 9; k++) { const a = Math.PI + ((k + 0.5) / 9) * Math.PI; g.in(M(Math.cos(a) * (RB + 0.15), top - 0.1, Math.sin(a) * (RB + 0.15), 0, 90 - a / DEG, 0), () => { archFrame(g, 0.26, 0.4, 'round', marbleCol(k), { t: 0.03, fill: [0.12, 0.2, 0.22] }); g.in(M(0, 0.4, 0.03), () => { g.surf(K_PLAIN, 0.3, 0.3); g.cbox(0.06, 0.08, 0.03, 0.006, P.turq); }); }); }
    for (let k = 0; k < 10; k++) { const a = Math.PI + (k / 9) * Math.PI; g.in(M(Math.cos(a) * (RB + 0.14), 0, Math.sin(a) * (RB + 0.14), 0, 90 - a / DEG, 0), () => { g.surf(K_STONE, 0.4); g.in(M(0, (top + 0.36) / 2, 0.03), () => g.cbox(0.12, top + 0.36, 0.08, 0.01, marbleCol(k + 90))); g.in(M(0, top + 0.2, 0.08), () => scallop(g, 0.14, nacre)); }); }
    g.surf(K_PLAIN, 0.3, 0.3); g.lathe([[RB + 0.14, top * 0.45], [RB + 0.165, top * 0.45 + 0.02], [RB + 0.165, top * 0.45 + 0.07], [RB + 0.14, top * 0.45 + 0.09]], nq(40), P.turq, Math.PI, TAU);
    // ends of the cavea: walls closing the tiers, a pearl-inlaid pilaster on each
    for (const e of [-1, 1]) {
      g.surf(K_STONE, 0.4);
      const pts = [[R0, 0], [RB + 0.14, 0], [RB + 0.14, top + 0.42]];
      for (let k = nT - 1; k >= 0; k--) pts.push([R0 + (k + 1) * tw, 0.08 + (k + 1) * th], [R0 + k * tw, 0.08 + (k + 1) * th]);
      g.in(M(0, 0, e > 0 ? -0.002 : 0.002), () => facet(g, pts.map(([x, y]) => [e * x, y, -0.001]), marbleCol(40 + e)(1, 1, 1), [e * 1, 0.5, 1]));
      g.in(M(e * (RB + 0.07), 0, 0.06), () => { g.surf(K_STONE, 0.4); g.in(M(0, (top + 0.5) / 2, 0), () => g.cbox(0.2, top + 0.5, 0.12, 0.01, marbleCol(50 + e))); g.in(M(0, top + 0.5, 0.07), () => scallop(g, 0.18, nacre)); g.surf(K_PLAIN, 0.15, 0.4); g.in(M(0, top * 0.5, 0.061), () => g.cbox(0.08, top * 0.7, 0.006, 0.002, nacre)); });
    }
    // aisles: little steps cut up the middle of each wedge
    for (const a of [Math.PI * 1.25, Math.PI * 1.5, Math.PI * 1.75]) for (let k = 0; k < nT * 2; k++) { const r = R0 + (k + 0.5) * tw / 2, y = 0.08 + (Math.floor(k / 2) + (k % 2 ? 1 : 0.5)) * th; g.in(M(Math.cos(a) * r, y - th * 0.25 + 0.004, Math.sin(a) * r, 0, 90 - a / DEG, 0), () => { g.surf(K_STONE, 0.45); g.cbox(0.22, th * 0.5, tw / 2, 0.006, marbleCol(k, 0.9)); }); }
    // the flood: sea water over the orchestra and the lowest seats, coral and weed growing on the marble
    pond(g, R0 + 2 * tw - 0.01, R0 + 2 * tw - 0.01, WL, 3, SEA, 0.08);
    const rnd = rng(921), CORAL = sw(0xe86a7a, 0xf0904a, 0xb05ad0, 0xe8c050, 0xe84a5a);
    for (let i = 0; i < 16; i++) { const a = Math.PI + rnd() * Math.PI, r = R0 + (rnd() < 0.6 ? 0.25 + rnd() * 0.15 : 0.45 + rnd() * 0.12), y = r < R0 + 2 * tw ? WL - 0.04 : 0.08 + (Math.floor((r - R0) / tw) + 1) * th; g.in(M(Math.cos(a) * r, y, Math.sin(a) * r, 0, rnd() * 360, 0), () => coral(g, 0.6 + 0.5 * rnd(), CORAL[i % 5], 930 + i, i % 4 === 3)); }
    for (let i = 0; i < 10; i++) { const a = Math.PI + rnd() * Math.PI, r = R0 + 2 * tw + rnd() * 0.3, k = Math.floor((r - R0) / tw), y = 0.08 + (k + 1) * th; g.in(M(Math.cos(a) * r, y, Math.sin(a) * r, 0, -a / DEG + 90, 0), () => seaCrust(g, 0.35, 950 + i)); }
  });
  // the stage: a marble platform half under the tide, a broken colonnade, a shell niche
  const sz = 1.35;
  water(g, -1.95, 1.95, C[2], 1.95, WL, 7, SEA, 0.08);
  g.surf(K_STONE, 0.4);
  for (const [x0, x1, z0, z1] of [[-1.98, 1.98, 1.86, 1.98], [-1.98, -1.86, C[2], 1.98], [1.86, 1.98, C[2], 1.98]]) g.in(M((x0 + x1) / 2, (WL + 0.06) / 2, (z0 + z1) / 2), () => g.cbox(x1 - x0, WL + 0.06, z1 - z0, 0.01, marbleCol(x0 * 3)));
  g.in(M(0, 0.2, sz), () => g.cbox(2.6, 0.4, 0.62, 0.02, marbleCol(60)));
  g.surf(K_PLAIN, 0.3, 0.3); g.in(M(0, 0.36, sz + 0.312), () => g.cbox(2.6, 0.05, 0.01, 0.002, P.turq));
  g.flat([[-1.3, 0.401, sz - 0.31], [-1.3, 0.401, sz + 0.31], [1.3, 0.401, sz + 0.31], [1.3, 0.401, sz - 0.31]], mix(MARBLE, [0.5, 0.6, 0.55], 0.25));
  for (let i = 0; i < 6; i++) { const x = -1.1 + i * 0.44, h = [1.3, 0.7, 1.45, 0.35, 1.2, 0.9][i]; g.in(M(x, 0.4, sz + 0.12), () => { columnOn(g, h, 0.07, marbleCol(i), h > 1.1 ? P.turq : marbleCol(i, 0.95)); if (h < 1.0) { g.surf(K_STONE, 0.4); g.in(M(0.25, -0.0, 0.2 - i * 0.03, 90, 30 * i, 0), () => g.in(M(0, -0.25, 0), () => g.cyl(0.065, 0.065, 0.5, nq(10), marbleCol(i + 9), true, true))); } }); }
  g.in(M(-0.44 * 0.5 - 0.22, 1.85, sz + 0.12), () => { g.surf(K_STONE, 0.4); g.cbox(1.4, 0.14, 0.2, 0.02, marbleCol(70)); g.surf(K_PLAIN, 0.3, 0.3); g.in(M(0, 0, 0.101), () => g.cbox(1.3, 0.04, 0.006, 0.002, P.turq)); });
  g.in(M(0, 0.4, sz - 0.2), () => { g.surf(K_STONE, 0.4); g.in(M(0, 0.45, 0), () => g.cbox(0.6, 0.9, 0.12, 0.02, marbleCol(80))); g.in(M(0, 0.55, 0.07), () => scallop(g, 0.45, nacre)); g.in(M(0, 0.0, 0.1), () => { g.surf(K_PLAIN, 0.2, 0.9); g.lathe([[0.1, 0], [0.12, 0.05], [0.06, 0.12], [0.1, 0.24], [0.14, 0.3]], nq(12), P.silver); }); });
  // coral and weed on the stage, spray where the tide slaps over it
  for (const [x, z, s, c, sd] of [[-0.9, 1.0, 0.7, rgb(0xe86a7a), 1], [1.15, 1.05, 0.8, rgb(0xf0904a), 2], [0.5, 1.7, 0.6, rgb(0xb05ad0), 3], [-1.5, 1.6, 0.9, rgb(0xe8c050), 4]]) g.in(M(x, WL - 0.04, z), () => coral(g, s, c, 960 + sd, sd === 3));
  fog.in(M(0, WL, 1.9), () => fogBank(fog, 1.4, 0.18, 0.25, 5, 6, [0.85, 0.95, 0.98], 0.15));
}

// =====================================================================================================
// Glimmer: brass, velvet and teal, telescopes and lightning
// =====================================================================================================
const BRASS_C = (seed = 0, k = 1) => (x, y, z) => mul(P.brass, k * (0.72 + 0.4 * noise3(x * 6 + seed, y * 6, z * 6)));
const ELIX = [[0.4, 1.0, 0.5], [0.3, 0.9, 1.0], [1.0, 0.45, 0.9], [1.0, 0.8, 0.3]];
const velvetCol = (seed = 0) => (x, y, z) => mul(P.velvet, 0.8 + 0.3 * noise3(x * 5 + seed, y * 5, z * 5));
function observatory(g, fog) {
  g.moss = 1.0;
  // the hill: a mossy knoll with rocks breaking through, a stair of slabs up the front
  const HH = 0.62, hill = (x, z) => { const d = Math.hypot(x / 1.45, z / 1.45); return d >= 1 ? 0 : HH * Math.pow(1 - d * d, 0.5); };
  pad(g, 3, 3, 0.03, grassCol(41), 1001, { sq: 3 });
  g.surf(K_LEAF, 0.95);
  g.sheet(nq(40), nq(10), (u, v) => { const a = u * TAU, d = v * 1.47, x = Math.cos(a) * d, z = Math.sin(a) * d; return [x, v > 0.98 ? -0.04 : Math.max(hill(x, z), d < 1.0 ? HH : 0) + 0.03 * (fbm3(x * 3, 0, z * 3, 2) - 0.5), z]; }, grassCol(43), true);
  for (const [x, z, sd] of [[-1.05, 0.55, 1], [0.95, -0.85, 2], [-0.8, -0.95, 3], [1.15, 0.4, 4]]) g.in(M(x, hill(x, z) - 0.08, z, 0, sd * 60, 0), () => boulder(g, 0.2, 0.16, 0.18, 1010 + sd, rgb(0x7a7a70), nq(18)));
  for (let q = 0; q < 4; q++) { const z = 1.4 - q * 0.13; g.surf(K_STONE, 0.9); g.in(M(0, hill(0, z) + 0.02, z), () => g.cbox(0.5, 0.1 + q * 0.03, 0.16, 0.02, stoneTint(rgb(0x8a8478), q, 5))); }
  // the drum: a stone footing, velvet-plastered wall banded in teal, round brass portholes
  const y0 = HH - 0.05, R = 0.92, y1 = y0 + 1.55;
  g.in(M(0, y0, 0), () => {
    g.surf(K_STONE, 0.9); g.cyl(R + 0.08, R + 0.06, 0.25, nq(28), stoneTint(rgb(0x8a8478), 3, 4), false, true);
    g.surf(K_PLASTER, 0.9); g.in(M(0, 0.25, 0), () => g.lathe([[R, 0], [R, y1 - y0 - 0.25]], nq(32), velvetCol(3)));
    g.surf(K_PLAIN, 0.4, 0.3);
    for (const y of [0.3, 0.95, y1 - y0 - 0.06]) g.in(M(0, y, 0), () => g.lathe([[R, -0.04], [R + 0.03, -0.03], [R + 0.03, 0.03], [R, 0.04]], nq(32), P.teal));
    for (let k = 0; k < 7; k++) { const a = (k / 7) * 360 + 25; g.in(M(0, 1.22, 0, 0, a, 0).multiply(M(0, 0, R)), () => porthole(g, 0.13, BRASS_C(k), [0.6, 0.95, 0.9], 0.7)); }
    // the door: an arched brass-studded door in a teal frame, a lamp beside it
    g.in(M(0, 0.22, R - 0.02), () => { archFrame(g, 0.46, 0.66, 'round', P.teal, { t: 0.04, fill: [0.02, 0.02, 0.03], kind: K_PLAIN }); g.in(M(0, 0, 0.01), () => roundDoor(g, 0.4, 0.62, rgb(0x4a2a40), P.brass, 7, { bands: [0.25, 0.7] })); });
    g.in(M(0.4, 0.95, R - 0.02, 0, 0, 0), () => bracketLamp(g, 0.6, [1.0, 0.75, 0.4], { frame: P.brass }));
    // exposed clockwork on the east wall: two meshing gears and a crank
    g.in(M(0, 0.7, 0, 0, 90, 0).multiply(M(0, 0, R + 0.06)), () => { g.in(M(-0.12, 0.05, 0), () => gear(g, 0.36, 16, 0.05, P.brass)); g.in(M(0.34, 0.33, 0.03), () => gear(g, 0.2, 10, 0.05, mul(P.brass, 0.85))); g.in(M(0.3, -0.25, 0.02), () => gear(g, 0.14, 8, 0.04, mul(P.brass, 0.95))); });
  });
  // the dome: ribbed brass plates, a shutter slit turned to the sky, a cupola ring
  const dy = y1, DR = R + 0.06, slitA = 0.25, slit = (a, v) => Math.abs(Math.atan2(Math.sin(a - (Math.PI / 2 + slitA)), Math.cos(a - (Math.PI / 2 + slitA)))) < 0.17 && v > 0.12;
  g.surf(K_PLAIN, 0.35, 0.85);
  g.sheet(nq(48), nq(14), (u, v) => { const a = u * TAU, t = v * Math.PI / 2, r = DR * Math.cos(t) - (slit(a, v) ? 0.06 : 0); return [Math.cos(a) * r, dy + Math.sin(t) * DR * 0.95, Math.sin(a) * r]; }, (x, y, z) => { const a = Math.atan2(z, x), v = (y - dy) / (DR * 0.95); return slit(a, v) ? [0.03, 0.03, 0.04] : mul(BRASS_C(5)(x, y, z), 0.8 + 0.25 * Math.abs(Math.sin(a * 12))); }, true, true);
  for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; if (Math.abs(Math.atan2(Math.sin(a - (Math.PI / 2 + slitA)), Math.cos(a - (Math.PI / 2 + slitA)))) < 0.25) continue; const pts = []; for (let i = 0; i <= 8; i++) { const t = (i / 8) * Math.PI / 2 * 0.93; pts.push([Math.cos(a) * (DR * Math.cos(t) + 0.015), dy + Math.sin(t) * DR * 0.95, Math.sin(a) * (DR * Math.cos(t) + 0.015)]); } g.tube(pts, 0.022, 4, mul(P.brass, 0.7), false); }
  g.in(M(0, dy, 0), () => { g.surf(K_PLAIN, 0.4, 0.85); g.lathe([[DR + 0.02, -0.04], [DR + 0.06, 0], [DR + 0.02, 0.05]], nq(36), mul(P.brass, 0.75)); for (let k = 0; k < 24; k++) g.in(M(0, 0, 0, 0, k * 15, 0).multiply(M(0, 0.0, DR + 0.055)), () => g.stud(0.016, P.brass, 5)); });
  // the telescope: a great brass tube through the slit, ringed, on a trunnion; a finder scope alongside
  const ta = Math.PI / 2 + slitA, el = 34;
  g.in(M(0, dy + 0.35, 0, 0, 90 - ta / DEG, 0).multiply(M(0, 0, 0, -el, 0, 0, 1.35)), () => {
    g.surf(K_PLAIN, 0.3, 0.9);
    g.in(M(0, 0, -0.5, 90, 0, 0), () => g.lathe([[0.1, 0], [0.13, 0.05], [0.13, 0.4], [0.17, 0.9], [0.19, 1.6], [0.22, 1.66], [0.22, 1.82], [0.19, 1.84], [0.17, 1.84]], nq(16), BRASS_C(9)));
    g.surf(K_PLAIN, 0.1, 0.2, 0.5); g.in(M(0, 0, 1.33, 90, 0, 0), () => g.cyl(0.17, 0.17, 0.002, nq(14), [0.4, 0.7, 0.9]));
    g.surf(K_PLAIN, 0.35, 0.85);
    for (const z of [0.0, 0.5, 0.95]) g.in(M(0, 0, z, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.16 + z * 0.03, 0.022, 5, nq(16)), P.teal));
    g.in(M(0.2, 0.08, 0.2, 90, 0, 0), () => g.lathe([[0.03, 0], [0.04, 0.05], [0.04, 0.55], [0.05, 0.6]], nq(8), BRASS_C(3)));
    g.in(M(0, -0.04, -0.6, 90, 0, 0), () => g.lathe([[0.02, 0], [0.04, 0.05], [0.035, 0.18]], nq(8), [0.1, 0.1, 0.1]));
  });
  // the cupola on top: a teal lantern ring, a brass orrery spinning in the open air
  g.in(M(0, dy + DR * 0.95 - 0.02, 0), () => {
    g.surf(K_PLAIN, 0.4, 0.4); g.cyl(0.2, 0.18, 0.14, nq(14), P.teal, false, true);
    g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, 0.14, 0), () => { g.cyl(0.015, 0.012, 0.7, 6, P.brass, false, true); g.in(M(0, 0.55, 0), () => { g.add(new THREE.SphereGeometry(0.08, 10, 8), P.brass); for (const [r, t, s2] of [[0.22, 20, 0.035], [0.34, -15, 0.05]]) g.in(M(0, 0, 0, t, 0, 0), () => { g.add(new THREE.TorusGeometry(r, 0.008, 4, nq(20)), P.brass); g.in(M(r, 0, 0), () => { g.surf(K_PLAIN, 0.4, 0.2, 0.3); g.add(new THREE.SphereGeometry(s2, 8, 6), r < 0.3 ? P.teal : P.velvet); g.surf(K_PLAIN, 0.3, 0.9); }); }); }); });
  });
  // chimney pipes off the back of the drum, puffing
  for (const [a, h, sd] of [[200, 3.75, 1], [235, 3.45, 2]]) { const x = Math.cos(a * DEG) * (R + 0.12), z = -Math.sin(a * DEG) * (R + 0.12) * -1; pipe(g, [[x, y0 + 0.4, z], [x * 1.05, y0 + 1.2, z * 1.05], [x * 1.04, dy + 0.5, z * 1.04], [x * 0.98, h, z * 0.98]], 0.07, BRASS_C(sd), { every: 1 }); g.in(M(x * 0.98, h, z * 0.98), () => { g.surf(K_PLAIN, 0.4, 0.85); g.lathe([[0.07, 0], [0.12, 0.06], [0.12, 0.12], [0.04, 0.14]], nq(10), mul(P.brass, 0.8)); }); fog.in(M(x * 0.98, h + 0.12, z * 0.98), () => smoke(fog, 0.08, 0.7, sd, [0.6, 0.6, 0.65], [0.88, 0.88, 0.9], 4, 0.2)); }
  // a brass weathervane spike, a little brass bench and a crate of lenses by the door
  g.in(M(0.75, hill(0.75, 0.9), 0.9, 0, -30, 0), () => { g.surf(K_WOOD, 0.8); g.in(M(0, 0.12, 0), () => g.cbox(0.3, 0.22, 0.22, 0.01, woodTint(rgb(0x6a4a2c), 3))); g.surf(K_PLAIN, 0.15, 0.2, 0.3); for (let k = 0; k < 3; k++) g.in(M(-0.08 + k * 0.08, 0.25, 0), () => g.add(new THREE.SphereGeometry(0.035, 8, 6).scale(1, 0.4, 1), [0.6, 0.9, 1.0])); });
}
function windmillLab(g, fog) {
  g.moss = 0.7;
  pad(g, 3, 3, 0.04, grassCol(51), 1101, { sq: 3 });
  const plank = (seed) => (x, y, z, i, edge) => mul(i % 2 ? P.teal : mix(P.teal, rgb(0x3a6a7a), 0.4), (edge ? 0.62 : 1) * (0.8 + 0.3 * noise3(x * 4 + seed, y * 18, z * 4)) * (Math.abs(((y * 7) % 1 + 1) % 1 - 0.5) > 0.45 ? 0.7 : 1));
  // the footing: rough stone, a stair round to the door
  g.surf(K_STONE, 0.9); g.cyl(1.0, 0.94, 0.3, 8, stoneTint(rgb(0x8a8478), 2, 4), false, true);
  // the crooked tower: three stages of teal clapboard, each set a little askew on the last
  const stages = [[0.86, 0.74, 1.5, 3, 0], [0.72, 0.6, 1.25, -4, 12], [0.58, 0.5, 0.95, 5, -8]];
  let fr = M(0, 0.3, 0);
  const frames = [];
  stages.forEach(([r0, r1, h, tilt, turn], k) => {
    const m = fr.clone().multiply(M(0, 0, 0, 0, turn, tilt));
    frames.push(m.clone());
    g.in(m, () => {
      g.surf(K_WOOD, 0.85); facetCol(g, 8, r0, h, { r1, vs: Math.max(2, Math.round(h / 0.15)), col: plank(k) });
      g.surf(K_PLAIN, 0.45, 0.3); g.in(M(0, h - 0.04, 0), () => g.lathe([[r1 + 0.04, -0.04], [r1 + 0.07, 0], [r1 + 0.04, 0.06], [0, 0.06]], 8, P.velvet));
      // round windows in brass rims on each stage
      for (let q = 0; q < 3; q++) { const a = (q * 120 + k * 50 + 20) * DEG, y = h * 0.55; g.in(M(0, y, 0, 0, 90 - a / DEG, 0).multiply(M(0, 0, lerp(r0, r1, 0.55) * Math.cos(Math.PI / 8) + 0.005)), () => porthole(g, 0.1, BRASS_C(q), ELIX[(q + k) % 4], 0.8)); }
    });
    fr = m.multiply(M(0, h, 0));
  });
  // the door at the foot, a step and a shelf of glowing jars beside it
  g.in(frames[0], () => g.in(M(0, 0, 0, 0, 0, 0).multiply(M(0, 0, 0.86 * Math.cos(Math.PI / 8) - 0.02)), () => { g.in(M(0, 0, 0.0), () => roundDoor(g, 0.4, 0.8, rgb(0x4a2a40), P.brass, 11, { bands: [0.25, 0.7] })); g.surf(K_PLAIN, 0.4, 0.4); g.in(M(0, 0.84, 0.03), () => g.cbox(0.5, 0.06, 0.06, 0.01, P.velvet)); }));
  g.surf(K_STONE, 0.9); g.in(M(0, 0.06, 1.02), () => g.cbox(0.6, 0.12, 0.26, 0.02, stoneTint(rgb(0x8a8478), 5, 5)));
  g.in(M(0.75, 0.3, 0.72, 0, 45, 0), () => { g.surf(K_WOOD, 0.85); for (const y of [0.3, 0.7]) g.in(M(0, y, 0), () => g.cbox(0.5, 0.04, 0.16, 0.01, woodTint(rgb(0x5a3a2a), y * 9))); for (const e of [-1, 1]) g.in(M(e * 0.24, 0.45, 0), () => g.cbox(0.04, 0.9, 0.16, 0.01, woodTint(rgb(0x5a3a2a), e))); for (const [y, n] of [[0.32, 3], [0.72, 2]]) for (let q = 0; q < n; q++) g.in(M(-0.15 + q * 0.15, y, 0), () => vessel(g, 0.5, ELIX[(q + n) % 4], { glow: 0.9 })); });
  // a gallery round the second stage: brackets, a brass rail, jars and retorts bubbling on it
  g.in(frames[1], () => {
    const R2 = 1.02;
    g.surf(K_WOOD, 0.88);
    g.sheet(nq(24), 1, (u, v) => { const a = u * TAU, r = lerp(0.68, R2, v); return [Math.cos(a) * r, 0.02, Math.sin(a) * r]; }, (x, y, z) => mul(rgb(0x6a4a2c), 0.7 + 0.4 * Math.abs(Math.sin(Math.atan2(z, x) * 20))), true);
    for (let k = 0; k < 8; k++) g.in(M(0, -0.12, 0, 0, k * 45 + 22.5, 0).multiply(M(0, 0, 0.8)), () => g.beamTo([0, -0.2, -0.1], [0, 0.1, 0.22], 0.05, 0.05, 0.01, woodTint(rgb(0x5a3a2a), k), 1));
    g.surf(K_PLAIN, 0.3, 0.9);
    for (let k = 0; k < 16; k++) g.in(M(0, 0.02, 0, 0, k * 22.5, 0).multiply(M(0, 0, R2 - 0.03)), () => g.cyl(0.012, 0.012, 0.36, 5, P.brass, false, true));
    g.in(M(0, 0.38, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(R2 - 0.03, 0.016, 4, nq(28)), P.brass));
    for (let k = 0; k < 7; k++) { const a = k * 51 + 10; g.in(M(0, 0.03, 0, 0, a, 0).multiply(M(0, 0, 0.88)), () => (k % 3 === 2 ? g.in(M(0, 0, 0), () => { g.surf(K_PLAIN, 0.1, 0.1, 0.8); g.lathe([[0, 0], [0.08, 0.03], [0.1, 0.1], [0.06, 0.16], [0.025, 0.2], [0.025, 0.32]], nq(10), ELIX[k % 4]); }) : vessel(g, 0.55 + 0.2 * hash1(k, 3), ELIX[k % 4], { glow: 0.95 }))); }
  });
  // brass pipes winding up the tower from a boiler at its foot
  g.in(M(-0.92, 0.3, 0.3), () => { g.surf(K_PLAIN, 0.4, 0.85); g.lathe([[0.22, 0], [0.24, 0.05], [0.24, 0.5], [0.2, 0.6], [0.08, 0.66], [0.05, 0.75]], nq(14), BRASS_C(4)); for (const y of [0.15, 0.45]) g.in(M(0, y, 0), () => g.lathe([[0.245, -0.02], [0.26, 0], [0.245, 0.02]], nq(14), mul(P.brass, 0.7))); g.in(M(0, 0.2, 0.22), () => { g.surf(K_PLAIN, 0.6, 0, 1.0); g.flat([[-0.07, -0.05, 0], [0.07, -0.05, 0], [0.07, 0.05, 0], [-0.07, 0.05, 0]], [1.0, 0.5, 0.15]); }); });
  { const pts = []; for (let i = 0; i <= 18; i++) { const t = i / 18, a = 2.5 + t * TAU * 1.15, y = 1.0 + t * 2.6, r = lerp(0.95, 0.66, t); pts.push([Math.cos(a) * r - 0.04 * t, y, Math.sin(a) * r]); } pipe(g, [[-0.92, 1.05, 0.3], ...pts], 0.045, BRASS_C(7), { every: 3 }); }
  pipe(g, [[-0.8, 0.9, 0.15], [-0.85, 1.4, -0.3], [-0.78, 2.0, -0.55]], 0.035, BRASS_C(8), { every: 1 });
  fog.in(M(-0.92, 1.1, 0.3), () => smoke(fog, 0.07, 0.6, 3, [0.8, 0.8, 0.82], [0.92, 0.92, 0.95], 4, 0.15));
  // the cap: a velvet-shingled cone, a little crooked, the sails on its face
  g.in(fr, () => {
    g.surf(K_ROOF, 0.8);
    g.sheet(nq(24), nq(8), (u, v) => { const a = u * TAU, r = lerp(0.66, 0.02, v) * (1 + 0.04 * Math.sin(v * Math.PI)); return [Math.cos(a) * r + 0.12 * v * v, v * 1.05, Math.sin(a) * r]; }, (x, y, z) => mul(P.velvet, (0.72 + 0.3 * noise3(x * 9, y * 9, z * 9)) * (Math.abs(((y * 10) % 1 + 1) % 1 - 0.5) > 0.42 ? 0.7 : 1)), true, true);
    g.surf(K_PLAIN, 0.4, 0.4); g.lathe([[0.66, -0.04], [0.7, 0], [0.66, 0.04]], nq(24), P.teal);
    // the lightning rod: an iron spike wound with copper, a spark caught at its tip
    g.in(M(0.12, 1.02, 0), () => { g.surf(K_PLAIN, 0.4, 0.85); g.cyl(0.02, 0.008, 1.1, 6, IRON, false, true); g.surf(K_PLAIN, 0.3, 0.9); const c = []; for (let i = 0; i <= 30; i++) { const t = i / 30; c.push([Math.cos(t * TAU * 5) * 0.04, 0.1 + t * 0.45, Math.sin(t * TAU * 5) * 0.04]); } g.tube(c, 0.01, 4, COPPER, false); for (const y of [0.15, 0.6]) g.in(M(0, y, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.06, 0.012, 4, 10), P.brass)); g.in(M(0, 1.1, 0), () => crystal(g, 0.05, 0.18, 3, { deep: rgb(0x4a6aff), bright: rgb(0xe0f0ff), glow: 1.4, m: 4 })); });
    g.in(M(0.12, 2.12, 0), () => { fog.in(new THREE.Matrix4().copy(fr).multiply(M(0.12, 2.12, 0)), () => { fog.surf(K_PLAIN, 1, 0, 1.4); fog.add(new THREE.IcosahedronGeometry(0.12, 1), [0.6, 0.75, 1.0]); }); });
    // the sails: four lattice arms with velvet cloth, on a brass hub turned to the front
    g.in(M(0, 0.42, 0.64, -8, 0, 0), () => {
      g.surf(K_PLAIN, 0.35, 0.9); g.in(M(0, 0, -0.2, 90, 0, 0), () => g.cyl(0.07, 0.09, 0.3, nq(10), P.brass, false, true)); g.in(M(0, 0, 0.1), () => g.stud(0.1, P.brass, 10, 0.8));
      for (let k = 0; k < 4; k++) g.in(M(0, 0, 0.05, 0, 0, k * 90 + 20), () => {
        g.surf(K_WOOD, 0.85); g.in(M(0, 0.85, 0), () => g.cbox(0.05, 1.6, 0.04, 0.008, woodTint(rgb(0x5a3a2a), k)));
        for (let i = 0; i < 6; i++) g.in(M(0.12, 0.42 + i * 0.22, -0.01), () => g.cbox(0.26, 0.025, 0.02, 0.004, woodTint(rgb(0x6a4a2c), k + i)));
        g.in(M(0.25, 0.97, -0.01), () => g.cbox(0.025, 1.15, 0.02, 0.004, woodTint(rgb(0x6a4a2c), k + 9)));
        g.surf(K_CLOTH, 0.9); g.sheet(3, nq(6), (u, v) => [0.03 + u * 0.21, 0.42 + v * 1.1, -0.02 - 0.03 * Math.sin(u * Math.PI)], (x, y, z, nx, ny, nz, u, v) => mul(v > 0.85 ? P.brass : P.velvet, 0.8 + 0.2 * noise3(x * 9, y * 9, k)));
      });
    });
  });
  // a lean-to workshop on the west side with its own stovepipe
  g.in(M(-0.85, 0.0, -0.75, 0, 40, 0), () => { shack(g, 0.7, 0.55, 0.62, [rgb(0x5a3a2a), rgb(0x4a3020), rgb(0x6a4a30)], 1120, { lit: ELIX[1], door: false }); pipe(g, [[0.15, 0.7, -0.1], [0.15, 1.3, -0.1]], 0.04, BRASS_C(2), { every: 1 }); });
}

// =====================================================================================================
// Khanate: dark felt, lacquered red, gold, horse-skulls and timber
// =====================================================================================================
const KH_WOOD = sw(0x5a4632, 0x4a3a2a, 0x6a523a, 0x3e3226);
/** a coarse horse skull for building with: about 0.36 long, muzzle toward +Z */
function horseSkullLo(g, s = 1) {
  const geo = geoOnce('horseSkullLo', () => {
    const c = 0xd8ccaa, d = 0x1a1612, Pp = [];
    Pp.push(S.ellipsoid(0.085, 0.08, 0.11).at(0, 0.11, -0.12).color(c));
    Pp.push(S.capsule([0, 0.1, -0.06], [0, 0.07, 0.26], 0.07, 0.045).color(c).blend(0.04));
    Pp.push(...S.mirrorX([S.ellipsoid(0.04, 0.035, 0.04).at(0.075, 0.125, -0.05).color(d).cut(0.008)]));
    Pp.push(...S.mirrorX([S.ellipsoid(0.02, 0.015, 0.05).at(0.03, 0.11, 0.2).color(d).cut(0.006)]));
    return buildPartGeometry({ prims: Pp }, { res: 21 * qual(), ao: 0.8 });
  });
  const k = g.kind; g.surf(K_PLAIN, 0.75); g.in(M(0, 0, 0, 0, 0, 0, s), () => g.add(geo, boneCol(5, P.bone))); g.kind = k;
}
const snowy = (base, seed = 0) => (x, y, z, nx, ny) => mix(typeof base === 'function' ? base(x, y, z, nx, ny) : base, SNOW, smooth(0.75, 0.95, ny ?? 0) * smooth(0.5, 0.72, noise3(x * 2.5 + seed, y * 2.5, z * 2.5)));
function skullTower(g) {
  g.moss = 0.2;
  pad(g, 2, 2, 0.03, snowGround(rgb(0x6a6048), 7, 0.5), 1201, { sq: 4 });
  const TOP = 4.1, b0 = 0.76, b1 = 0.6, at = (y) => lerp(b0, b1, y / TOP);
  g.surf(K_STONE, 0.9); g.in(M(0, 0.1, 0), () => g.cbox(1.86, 0.24, 1.86, 0.03, stoneTint(rgb(0x6a6a66), 3, 4)));
  // corner posts leaning in, crib logs between them, bands of horse skulls stacked muzzle-out
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) logTo(g, [x * b0, 0.1, z * b0], [x * b1, TOP + 0.35, z * b1], 0.09, 0.075, x + z * 3, { seg: 8, vseg: 8, bark: KH_WOOD[0] });
  const bands = [[0.3, 0.98], [1.5, 2.18], [2.7, 3.38]];
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    // timber courses where there are no skulls
    for (let y = 0.24; y < TOP; y += 0.15) {
      if (bands.some(([a, b]) => y > a - 0.05 && y < b + 0.02)) continue;
      const hw = at(y);
      logTo(g, [-hw - 0.05, y, hw], [hw + 0.05, y, hw], 0.065, 0.06, s * 31 + Math.round(y * 20), { seg: 5, vseg: 3, bark: KH_WOOD[Math.round(y * 7) % 4], capB: true });
    }
    for (const [a, b] of bands) {
      g.surf(K_PLAIN, 1); g.flat([[-at(a) + 0.05, a, at(a) - 0.06], [at(a) - 0.05, a, at(a) - 0.06], [at(b) - 0.05, b, at(b) - 0.06], [-at(b) + 0.05, b, at(b) - 0.06]], [0.05, 0.045, 0.04]);
      for (let r = 0; r < 3; r++) { const y = a + 0.02 + r * 0.22, hw = at(y), n = 2; for (let i = 0; i < n; i++) { const x = (i - 0.5) * hw * 0.95 + (r % 2 ? 0.12 : -0.12); g.in(M(x, y, hw - 0.06, -6 + 10 * hash1(i, r, s), ((i + r) % 2 ? 80 : -80) + (hash1(i, r) - 0.5) * 20, (hash1(r, i) - 0.5) * 10), () => horseSkullLo(g, 1.15)); } }
      logTo(g, [-at(b) - 0.05, b + 0.06, at(b)], [at(b) + 0.05, b + 0.06, at(b)], 0.07, 0.065, s * 7 + a * 10, { seg: 5, vseg: 3, bark: KH_WOOD[2], capB: true });
    }
  });
  // the lookout: a plank floor on outriggers, a red-lacquered rail, a felt roof on four posts
  const LY = TOP + 0.05, LW = 0.88;
  g.surf(K_WOOD, 0.85);
  for (const e of [-1, 1]) { g.in(M(e * 0.5, LY - 0.08, 0), () => g.cbox(0.1, 0.1, 2 * LW + 0.1, 0.01, woodTint(KH_WOOD[1], e))); g.in(M(0, LY - 0.18, e * 0.5), () => g.cbox(2 * LW + 0.1, 0.1, 0.1, 0.01, woodTint(KH_WOOD[1], e + 4))); }
  deck(g, -LW, LW, -LW, LW, LY, KH_WOOD, 1210, { pw: 0.15, rag: 0.04 });
  g.surf(K_WOOD, 0.5);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    for (let i = 0; i < 6; i++) g.in(M(-LW + 0.05 + i * ((2 * LW - 0.1) / 5), LY + 0.22, LW - 0.03), () => g.cbox(0.04, 0.44, 0.04, 0.008, woodTint(P.khRed, i)));
    g.in(M(0, LY + 0.46, LW - 0.03), () => g.cbox(2 * LW, 0.06, 0.07, 0.01, woodTint(P.lacquer, s)));
    g.surf(K_PLAIN, 0.3, 0.9); for (let i = 0; i < 6; i++) g.in(M(-LW + 0.15 + i * 0.3, LY + 0.46, LW + 0.006), () => g.stud(0.016, P.khGold, 5)); g.surf(K_WOOD, 0.5);
    // a red banner with a gold border hanging off two of the sides
    if (s % 2 === 0) g.in(M(0, LY - 0.05, LW + 0.06), () => hanging(g, 0.5, 1.1, P.khRed, P.khGold, { bar: P.khGold, point: true, device: P.khGold }));
  });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.in(M(x * (LW - 0.06), LY, z * (LW - 0.06)), () => { g.surf(K_WOOD, 0.5); g.cyl(0.04, 0.035, 0.9, 6, woodTint(P.khRed, x + z), false, true); });
  g.in(M(0, LY + 0.88, 0), () => {
    g.surf(K_CLOTH, 0.95);
    g.sheet(nq(24), nq(6), (u, v) => { const a = u * TAU + Math.PI / 4, sq = Math.pow(Math.pow(Math.abs(Math.cos(a)), 3) + Math.pow(Math.abs(Math.sin(a)), 3), -1 / 3), r = lerp(1.18, 0.05, v) * sq * (1 - 0.06 * Math.sin(v * Math.PI)); return [Math.cos(a) * r, v * 0.78 - 0.08 * (1 - v) * Math.abs(Math.sin(a * 2)), Math.sin(a) * r]; }, snowy((x, y, z) => mul(P.khDark, 0.85 + 0.3 * noise3(x * 6, y * 6, z * 6)), 3), true, true);
    g.surf(K_CLOTH, 0.9); g.sheet(nq(24), 1, (u, v) => { const a = u * TAU + Math.PI / 4, sq = Math.pow(Math.pow(Math.abs(Math.cos(a)), 3) + Math.pow(Math.abs(Math.sin(a)), 3), -1 / 3), r = 1.2 * sq; return [Math.cos(a) * r, -0.08 * Math.abs(Math.sin(a * 2)) - v * 0.12, Math.sin(a) * r]; }, (x, y, z) => (Math.abs(tri1(Math.atan2(z, x) * 6) - 0.5) < 0.15 ? P.khGold : P.khRed), true, true);
    g.in(M(0, 0.76, 0), () => { g.surf(K_PLAIN, 0.3, 0.9); g.lathe([[0.08, 0], [0.1, 0.05], [0.05, 0.12], [0.07, 0.2], [0, 0.28]], nq(10), P.khGold); g.in(M(0, 0.2, 0), () => tug(g, 0.55, rgb(0x1a1612), P.khGold, 3)); });
  });
  // a ladder up the back, horse-hair standards at the foot, a brazier on the lookout
  ladder(g, [0.3, 0, -1.08], [0.3, LY + 0.05, -0.86], 0.34, 1220, KH_WOOD[2]);
  for (const e of [-1, 1]) g.in(M(e * 0.9, 0, 0.92), () => tug(g, 2.2, e > 0 ? rgb(0x1a1612) : rgb(0xd8d0c0), P.khGold, 1230 + e));
  g.in(M(-0.45, LY, -0.45), () => fireBowl(g, 0.35, FIRE_HOT, IRON, 3, 0.8));
}
function winterCamp(g) {
  g.moss = 0.2;
  pad(g, 4, 4, 0.03, snowGround(rgb(0x6a6048), 11, 0.6), 1301, { sq: 4 });
  const SK = 1.82;
  // the stockade: sharpened logs, lashed rails, a gap for the gate
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => {
    const n = 22;
    for (let i = 0; i <= n; i++) { const x = -SK + (2 * SK * i) / n; if (s === 0 && Math.abs(x) < 0.55) continue; g.in(M(x, 0, SK, (hash1(i, s) - 0.5) * 5, 0, (hash1(s, i) - 0.5) * 5), () => stake(g, 0.075, 0.95 + 0.15 * hash1(i, s + 9), s * 40 + i, KH_WOOD[i % 4], rgb(0xb89a70))); }
    g.surf(K_WOOD, 0.9);
    for (const y of [0.3, 0.7]) { if (s === 0) { for (const e of [-1, 1]) g.in(M(e * (SK + 0.55) / 2, y, SK - 0.08), () => g.beam(SK - 0.55, 0.06, 0.05, 0.01, woodTint(KH_WOOD[1], y * 9 + e), 3)); } else g.in(M(0, y, SK - 0.08), () => g.beam(2 * SK, 0.06, 0.05, 0.01, woodTint(KH_WOOD[1], y * 9 + s), 4)); }
  });
  // the gate: two tall posts, a lacquered lintel with gold studs and a felt-roofed cap, the doors swung open
  g.in(M(0, 0, SK), () => {
    for (const e of [-1, 1]) g.in(M(e * 0.58, 0, 0), () => { log(g, 0.1, 0.09, 1.75, 1310 + e, { bark: KH_WOOD[3] }); g.in(M(0, 1.75, 0), () => { g.surf(K_PLAIN, 0.3, 0.9); g.lathe([[0.1, 0], [0.12, 0.04], [0.04, 0.14], [0, 0.22]], nq(8), P.khGold); }); });
    g.surf(K_WOOD, 0.45);
    g.in(M(0, 1.5, 0.02), () => g.beam(1.5, 0.16, 0.12, 0.02, woodTint(P.lacquer, 3), 6, (x) => [0.05 * Math.pow(Math.abs(x) / 0.75, 3), 0]));
    g.in(M(0, 1.26, 0.02), () => g.beam(1.2, 0.08, 0.1, 0.01, woodTint(P.khRed, 4), 4));
    g.surf(K_PLAIN, 0.3, 0.9); for (let i = 0; i < 7; i++) g.in(M(-0.54 + i * 0.18, 1.5, 0.085), () => g.stud(0.025, P.khGold, 6));
    g.in(M(0, 1.38, 0.09), () => { g.surf(K_PLAIN, 0.4, 0.8); g.cbox(0.34, 0.16, 0.02, 0.01, P.khGold); g.surf(K_PLAIN, 0.5); g.in(M(0, 0, 0.012), () => g.cbox(0.26, 0.09, 0.01, 0.004, P.khDark)); });
    g.surf(K_CLOTH, 0.9); g.in(M(0, 1.62, 0), () => g.sheet(nq(10), 3, (u, v) => [(u - 0.5) * 1.7, 0.18 * Math.sin(v * Math.PI) + 0.04 * Math.pow(Math.abs(u - 0.5) * 2, 3), (v - 0.5) * 0.4], snowy(mul(P.khDark, 0.9), 5)));
    for (const e of [-1, 1]) g.in(M(e * 0.52, 0, 0.02, 0, e * -65, 0), () => g.in(M(-e * 0.25, 0, 0), () => { g.surf(K_WOOD, 0.5); for (let i = 0; i < 4; i++) g.in(M(-0.19 + i * 0.125, 0.55, 0), () => g.cbox(0.12, 1.1, 0.05, 0.01, woodTint(P.khRed, i + e))); g.surf(K_PLAIN, 0.3, 0.9); for (const y of [0.25, 0.85]) g.in(M(0, y, 0.03), () => g.cbox(0.5, 0.05, 0.01, 0.004, P.khGold)); }));
    for (const e of [-1, 1]) g.in(M(e * 0.82, 0, 0.25), () => tug(g, 2.0, e > 0 ? rgb(0x1a1612) : rgb(0xd8d0c0), P.khGold, 1320 + e));
  });
  // the hall: a log-walled long room under a vaulted felt roof, lacquered beam ends and a gilt crest
  const HX = 1.05, HZ = 0.72, HC = -0.35, WH = 0.95;
  g.in(M(0, 0, HC), () => {
    for (let s = 0; s < 4; s++) { const W = s % 2 ? HZ : HX, D = s % 2 ? HX : HZ; g.in(M(0, 0, 0, 0, s * 90, 0), () => { for (let y = 0.07, i = 0; y < WH; y += 0.13, i++) { if (s === 0 && Math.abs(0) < 1 && y < 0.78 && false) continue; logTo(g, [-W - 0.12 * (i % 2), y, D], [W + 0.12 * ((i + 1) % 2), y, D], 0.068, 0.062, s * 50 + i, { seg: 6, vseg: 3, bark: KH_WOOD[(i + s) % 4], capB: true }); } }); }
    // the door: lacquered red, gold bosses, a felt curtain looped up
    g.in(M(0, 0, HZ + 0.07), () => { g.surf(K_WOOD, 0.45); for (const e of [-1, 1]) g.in(M(e * 0.17, 0.4, 0), () => { g.cbox(0.32, 0.8, 0.05, 0.01, woodTint(P.khRed, e)); g.surf(K_PLAIN, 0.3, 0.9); for (const y of [-0.22, 0.0, 0.22]) g.in(M(0, y, 0.03), () => g.stud(0.03, P.khGold, 6)); g.surf(K_WOOD, 0.45); }); for (const e of [-1, 1]) g.in(M(e * 0.38, 0.45, 0.01), () => g.cbox(0.08, 0.9, 0.08, 0.01, woodTint(P.lacquer, e))); g.in(M(0, 0.92, 0.01), () => g.cbox(0.9, 0.1, 0.1, 0.01, woodTint(P.lacquer, 5))); });
    // the roof: a barrel of dark felt, ribbed with lashed ropes, snow lying along its back
    const RR = HZ + 0.18;
    g.surf(K_CLOTH, 0.95);
    g.sheet(nq(20), nq(14), (u, v) => { const x = (u - 0.5) * 2 * (HX + 0.22), a = v * Math.PI, sag = 0.03 * Math.abs(Math.sin(u * Math.PI * 6)); return [x, WH - 0.05 + Math.sin(a) * (0.72 - sag), Math.cos(a) * RR]; }, snowy((x, y, z) => mul(P.khDark, 0.85 + 0.3 * noise3(x * 5, y * 5, z * 5)), 9), false);
    for (const e of [-1, 1]) g.in(M(e * (HX + 0.22), 0, 0), () => { g.surf(K_CLOTH, 0.95); g.sheet(nq(14), 1, (u, v) => { const a = u * Math.PI; return [0, WH - 0.05 + Math.sin(a) * 0.72 * v, Math.cos(a) * RR * v]; }, (x, y, z) => mul(P.khDark, 0.8)); });
    for (let i = 0; i < 6; i++) { const x = -HX + (i * 2 * HX) / 5, pts = []; for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI; pts.push([x, WH - 0.05 + Math.sin(a) * 0.74, Math.cos(a) * (RR + 0.02)]); } rope(g, pts, 0.016, rgb(0x8a6a40), 5); }
    g.surf(K_WOOD, 0.45); g.in(M(0, WH + 0.72, 0), () => g.beam(2 * HX + 0.8, 0.1, 0.1, 0.02, woodTint(P.lacquer, 9), 6, (x) => [0.12 * Math.pow(Math.abs(x) / (HX + 0.4), 3), 0]));
    for (const e of [-1, 1]) g.in(M(e * (HX + 0.42), WH + 0.82, 0, 0, e > 0 ? 0 : 180, 0), () => { g.surf(K_PLAIN, 0.3, 0.9); horn(g, [[0, 0, 0], [0.06, 0.08, 0], [0.04, 0.2, 0], [-0.04, 0.26, 0]], 0.04, P.khGold, mul(P.khGold, 0.7), { rings: 8, rough: 0.3, metal: 0.9 }); });
    g.in(M(0, WH + 0.82, 0), () => { g.surf(K_PLAIN, 0.3, 0.9); g.lathe([[0.07, 0], [0.09, 0.05], [0.04, 0.14], [0.06, 0.2], [0, 0.3]], nq(10), P.khGold); });
    for (const z of [-1, 1]) for (const x of [-1, 1]) g.in(M(x * (HX + 0.06), WH + 0.04, z * (HZ + 0.06)), () => { g.surf(K_WOOD, 0.45); g.cbox(0.12, 0.12, 0.12, 0.02, woodTint(P.khRed, x + z * 2)); });
  });
  // a white-felt yurt in the back corner, a fire ring, a weapon rack, a hitching rail with hay
  g.in(M(1.15, 0, -1.2), () => yurt(g, 0.42, 0.42, 0.95, 1330, { wall: rgb(0xd8d0c0), roof: rgb(0xc8c0b0), red: P.khRed, gold: P.khGold }));
  g.in(M(-0.9, 0, 0.95), () => { for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; g.in(M(Math.cos(a) * 0.22, 0.03, Math.sin(a) * 0.22), () => boulder(g, 0.06, 0.05, 0.06, 1340 + k, rgb(0x6a6a66), 10)); } g.surf(K_WOOD, 0.9); for (let k = 0; k < 3; k++) g.in(M(0, 0.05, 0, 0, k * 60, 0), () => g.cbox(0.34, 0.04, 0.04, 0.006, charCol(k))); g.in(M(0, 0.06, 0), () => fire(g, 0.32, FIRE_HOT, 3, 0.9)); });
  g.in(M(0.95, 0, 0.95, 0, -30, 0), () => { for (const e of [-1, 1]) g.in(M(e * 0.3, 0, 0), () => stake(g, 0.035, 0.75, e + 7, KH_WOOD[2])); g.surf(K_WOOD, 0.8); g.in(M(0, 0.62, 0), () => g.beam(0.7, 0.05, 0.05, 0.01, woodTint(KH_WOOD[1], 3), 2)); for (let i = 0; i < 4; i++) g.in(M(-0.22 + i * 0.15, 0.32, 0.04, 0, 0, (i - 1.5) * 4), () => { g.surf(K_WOOD, 0.8); g.cyl(0.012, 0.012, 1.05, 5, woodTint(rgb(0x6a4a30), i), false, true); g.surf(K_PLAIN, 0.35, 0.85); g.in(M(0, 1.05, 0), () => g.cyl(0.02, 0.002, 0.14, 4, [0.5, 0.5, 0.52], false, true)); }); });
  g.in(M(-1.2, 0, -1.25), () => { g.surf(K_PLAIN, 0.95); g.add(new THREE.SphereGeometry(0.28, 10, 8).scale(1, 0.75, 1).translate(0, 0.12, 0), (x, y, z) => mix(mul(rgb(0xc8a860), 0.7 + 0.4 * noise3(x * 20, y * 20, z * 20)), SNOW, smooth(0.15, 0.3, y) * 0.8)); });
  for (const [x, z, sd] of [[1.3, 0.3, 1], [-1.35, -0.3, 2], [0.2, -1.45, 3]]) g.in(M(x, 0, z, 0, sd * 70, 0), () => drift(g, 0.35, 0.1, 0.22, sd));
}

// =====================================================================================================
// Emerald: white limestone, gold suns, jade and feathered serpents
// =====================================================================================================
const LIME = rgb(0xd0c6a8), LIME_PAL = sw(0xd0c6a8, 0xc4ba9a, 0xdad0b4, 0xbcb294, 0xd6caa6, 0xc8c0a4), FEATHER = sw(0x2a8a5a, 0x3aa86a, 0xd8b03a, 0x2a6a8a);
const limeSt = (seed, o) => stoneStyle(0xd0c6a8, { seed, pal: LIME_PAL, chip: 0.25, course: 0.15, len: [0.3, 0.55], cell: 0.26 / qual(), ...o });
const limeTint = (seed = 0, k = 1) => (x, y, z) => mix(mul(LIME, k * (0.82 + 0.25 * noise3(x * 4 + seed, y * 4, z * 4))), [0.3, 0.38, 0.2], smooth(0.62, 0.82, noise3(x * 2.4 + seed, y * 2.4 + 5, z * 2.4)) * 0.45);
/** a coursed drum of stone, radius R from y0 to y1 */
function drumWall(g, R, y0, y1, st, seed) { g.surf(K_STONE, 0.9); g.in(M(0, y0, 0, 0, seed * 23, 0), () => g.bend(R - st.r, () => g.ashlar((R - st.r) * TAU, y1 - y0, { ...st, seed, wrap: true }))); }
/** a feathered serpent body: a tube through pts with a ruff of feathers along its back */
function featherSerpent(g, pts, r, col, seed = 0) {
  g.surf(K_STONE, 0.6);
  g.tube(pts, r, 6, (x, y, z, nx, ny, nz, t) => mul(col, (0.8 + 0.2 * noise3(x * 9, y * 9, z * 9)) * (Math.abs(Math.sin(t * 80)) > 0.3 ? 1 : 0.72)), true);
  g.surf(K_PLAIN, 0.5, 0.2);
  for (let i = 1; i < pts.length - 1; i += 1) { const a = pts[i - 1], b = pts[i + 1], f = along(a, b); g.in(new THREE.Matrix4().copy(f.m).setPosition(pts[i][0], pts[i][1], pts[i][2]), () => g.in(M(0, r * 0.7, 0, 0, 0, -25), () => prism(g, [[-r * 0.8, 0], [r * 0.8, 0], [r * 0.4, r * 2.4], [0, r * 2.9], [-r * 0.4, r * 2.4]], r * 0.4, FEATHER[(i + seed) % 4], [0, r]))); }
}
function sunTemple(g) {
  g.moss = 0.5;
  pad(g, 4, 4, 0.03, (x, y, z) => mix(mul(rgb(0x7a6a48), 0.7 + 0.4 * fbm3(x * 3, y * 3, z * 3, 2)), [0.3, 0.42, 0.18], smooth(0.4, 0.7, noise3(x * 1.3, 2, z * 1.3)) * 0.6), 1401, { sq: 2 });
  // the stepped round platform
  const steps = [[1.92, 0, 0.3], [1.62, 0.3, 0.6], [1.34, 0.6, 0.9]];
  steps.forEach(([R, y0, y1], k) => { drumWall(g, R, y0, y1, limeSt(1410 + k), 1411 + k); g.surf(K_STONE, 0.85); g.in(M(0, y1, 0), () => g.lathe([[R + 0.03, -0.04], [R + 0.03, 0.0], [0, 0.0]], nq(48), limeTint(k, 0.95))); g.surf(K_PLAIN, 0.5, 0.2); g.in(M(0, y1 - 0.09, 0), () => g.lathe([[R + 0.005, -0.03], [R + 0.02, -0.02], [R + 0.02, 0.02], [R + 0.005, 0.03]], nq(48), P.jade)); });
  // the front stair, its cheeks ending in feathered serpent heads
  g.surf(K_STONE, 0.88);
  for (let q = 0; q < 6; q++) { const h = (q + 1) * 0.15; g.in(M(0, h / 2 - 0.02, 1.98 - q * 0.13), () => g.cbox(0.7, h + 0.04, 0.14, 0.01, limeTint(q, 0.97))); }
  for (const e of [-1, 1]) {
    g.in(M(e * 0.43, 0, 1.6), () => g.in(M(0, 0, 0, 0, 90, 0), () => prism(g, [[0.42, 0], [-0.42, 0], [-0.42, 0.98], [-0.32, 0.98], [0.42, 0.2]], 0.16, limeTint(e, 0.9))));
    g.in(M(e * 0.43, 0.2, 2.02), () => { g.in(M(0, 0, 0, -10, 0, 0), () => serpentHead(g, 0.4, mix(P.jade, LIME, 0.3), [0.95, 0.75, 0.2])); g.surf(K_PLAIN, 0.5, 0.2); for (let k = 0; k < 5; k++) g.in(M(0, 0.12, -0.08, 0, 0, (k - 2) * 28), () => prism(g, [[-0.03, 0], [0.03, 0], [0.02, 0.2], [0, 0.24], [-0.02, 0.2]], 0.02, FEATHER[k % 4], [0, 0.08])); });
  }
  // the sanctuary drum: limestone ashlar, jade inlay bands, a feathered serpent coiling round it
  const R = 1.08, y0 = 0.9, y1 = 3.05;
  drumWall(g, R, y0, y1, limeSt(1420, { course: 0.143 }), 1421);
  g.surf(K_PLAIN, 0.4, 0.2);
  for (const y of [y0 + 0.62, y1 - 0.12]) g.in(M(0, y, 0), () => g.lathe([[R + 0.005, -0.05], [R + 0.03, -0.035], [R + 0.03, 0.035], [R + 0.005, 0.05]], nq(48), (x, yy, z) => (Math.abs(Math.sin(Math.atan2(z, x) * 18)) > 0.85 ? P.eGold : P.jade)));
  g.surf(K_PLAIN, 0.35, 0.85); for (let k = 0; k < 24; k++) g.in(M(0, y0 + 0.62, 0, 0, k * 15 + 7.5, 0).multiply(M(0, 0, R + 0.03)), () => g.stud(0.02, P.eGold, 6));
  { const pts = []; for (let i = 0; i <= 64; i++) { const t = i / 64, a = Math.PI / 2 + 0.35 + t * TAU * 0.92, y = y0 + 1.0 + 0.16 * Math.sin(t * TAU * 5) + t * 0.5; pts.push([Math.cos(a) * (R + 0.05), y, Math.sin(a) * (R + 0.05)]); } featherSerpent(g, pts, 0.05, mix(P.jade, LIME, 0.25), 2); const e = pts[pts.length - 1], d = pts[pts.length - 2]; g.in(M(e[0], e[1], e[2], 0, Math.atan2(e[0] - d[0], e[2] - d[2]) / DEG, 0), () => serpentHead(g, 0.3, mix(P.jade, LIME, 0.25), [0.95, 0.75, 0.2])); }
  // the door: a stepped corbel arch framed in gold, a jade mask over it
  g.in(M(0, y0, R - 0.03), () => {
    g.surf(K_PLAIN, 1); g.in(M(0, 0, 0.02), () => g.poly([[-0.28, 0, 0], [0.28, 0, 0], [0.28, 0.62, 0], [0.18, 0.75, 0], [0.1, 0.88, 0], [-0.1, 0.88, 0], [-0.18, 0.75, 0], [-0.28, 0.62, 0]], 0, 0, 1, [0.03, 0.025, 0.02]));
    g.surf(K_PLAIN, 0.3, 0.9); g.tube([[-0.31, 0, 0.04], [-0.31, 0.64, 0.04], [-0.2, 0.78, 0.04], [-0.12, 0.91, 0.04], [0.12, 0.91, 0.04], [0.2, 0.78, 0.04], [0.31, 0.64, 0.04], [0.31, 0, 0.04]], 0.03, 5, P.eGold, true);
    g.in(M(0, 1.08, 0.04), () => { g.surf(K_PLAIN, 0.4, 0.3); g.cbox(0.4, 0.26, 0.06, 0.02, P.jade); g.surf(K_PLAIN, 0.3, 0.9); for (const e of [-1, 1]) g.in(M(e * 0.09, 0.03, 0.035), () => g.stud(0.035, P.eGold, 6)); g.in(M(0, -0.08, 0.035), () => g.cbox(0.16, 0.03, 0.01, 0.004, P.eGold)); });
    for (const e of [-1, 1]) g.in(M(e * 0.62, 0, 0.12), () => fireBowl(g, 0.4, FIRE_HOT, P.eGold, e + 5, 0.8));
  });
  // the roof: tiers stepping in, gold-edged, a drum carrying the sun disc crown
  const tiers = [[R + 0.12, 0.16], [0.88, 0.22], [0.66, 0.24], [0.45, 0.26]];
  let y = y1;
  tiers.forEach(([r, h], k) => { g.surf(K_STONE, 0.85); g.in(M(0, y, 0), () => g.cyl(r, r - 0.04, h, nq(40), limeTint(k + 30), false, true)); g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, y + h - 0.02, 0), () => g.lathe([[r - 0.04, -0.02], [r - 0.01, 0.0], [r - 0.04, 0.03]], nq(40), P.eGold)); if (k === 1) for (let q = 0; q < 16; q++) g.in(M(0, y + h * 0.5, 0, 0, q * 22.5, 0).multiply(M(0, 0, r - 0.02)), () => { g.surf(K_PLAIN, 0.4, 0.2); g.stud(0.035, P.jade, 6); }); y += h; });
  g.in(M(0, y, 0), () => {
    g.surf(K_STONE, 0.85); g.cyl(0.22, 0.2, 0.3, nq(16), limeTint(40), false, true);
    for (const r of [0, 180]) g.in(M(0, 0.95, 0, 0, r, 0).multiply(M(0, 0, 0.04)), () => sunDisc(g, 3.0, P.eGold, { rays: 16, ray: mul(P.eGold, 1.1), glow: 0.08 }));
    g.in(M(0, 0.95, 0.12), () => { g.surf(K_PLAIN, 0.3, 0.5); g.in(M(0, 0, 0, 90, 0, 0), () => g.cyl(0.18, 0.18, 0.03, nq(16), P.jade, true, true)); g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, 0, 0.035), () => g.stud(0.08, P.eGold, 10, 0.6)); });
    g.in(M(0, 0.3, 0), () => { g.surf(K_PLAIN, 0.3, 0.9); g.cyl(0.06, 0.06, 0.3, 8, P.eGold, false, true); });
  });
  // jungle at the foot: a few broad-leaved plants and a flowering vine up the stair cheek
  for (const [x, z, r, sd] of [[1.7, 1.0, 0.3, 1], [-1.75, 0.9, 0.28, 2], [1.3, -1.45, 0.32, 3], [-1.2, -1.55, 0.3, 4]]) g.in(M(x, 0.08, z), () => leafClump(g, r, 1440 + sd, sw(0x2f6a2a, 0x3a7a32, 0x4a8a3a), 4));
  for (const a of [40, 140, 220, 320]) g.in(M(0, 0, 0, 0, a, 0).multiply(M(0, 0.9, 1.34)), () => vines(g, 0.4, 0.6, a, { leaf: sw(0x2f6a2a, 0x3a7a32), bloom: rgb(0xe84a6a), bloomP: 0.3 }));
}
function riverCitadel(g) {
  g.moss = 1.1;
  pad(g, 5, 5, 0.03, (x, y, z) => mix(mul(rgb(0x6a5a40), 0.7 + 0.4 * fbm3(x * 3, y * 3, z * 3, 2)), [0.28, 0.42, 0.18], smooth(0.35, 0.65, noise3(x * 1.3, 2, z * 1.3)) * 0.7), 1501, { sq: 4 });
  // the river along the front: banks of stone, reeds, a causeway to the gate
  water(g, -2.48, 2.48, 1.72, 2.48, 0.06, 4, [0.1, 0.32, 0.3], 0.12);
  g.surf(K_STONE, 0.9);
  for (const e of [-1, 1]) g.in(M(e * 1.45, 0.08, 1.66), () => g.cbox(2.0, 0.16, 0.12, 0.02, limeTint(e + 50, 0.9)));
  g.in(M(0, 0.1, 2.08), () => g.cbox(0.82, 0.2, 0.92, 0.02, limeTint(51, 0.92)));
  g.surf(K_STONE, 0.9); for (const e of [-1, 1]) g.in(M(e * 0.36, 0.24, 2.08), () => g.cbox(0.1, 0.12, 0.9, 0.01, limeTint(52 + e, 0.95)));
  for (let i = 0; i < 12; i++) { const x = (hash1(i, 3) - 0.5) * 4.6, z = 1.85 + hash1(i, 5) * 0.55; if (Math.abs(x) < 0.55) continue; g.surf(K_LEAF, 0.8); for (let k = 0; k < 4; k++) g.tube([[x + k * 0.02, 0.0, z], [x + k * 0.02 + 0.03 * Math.sin(i + k), 0.3 + 0.1 * hash1(i, k), z + 0.02 * k]], [0.01, 0.003], 3, sw(0x5a7a3a, 0x6a8a3a)[k % 2], false); }
  // three stepped tiers of limestone, each a hanging garden
  const CZ = -0.3, T = [[2.25, 1.95, 0, 1.35], [1.62, 1.38, 1.35, 2.55], [0.95, 0.82, 2.55, 3.6]];
  T.forEach(([hx, hz, y0, y1], k) => {
    const st = limeSt(1510 + k, { course: 0.2, len: [0.36, 0.62] });
    g.in(M(0, 0, CZ), () => {
      stoneBox(g, hx, hz, y0, y1, st, 1511 + k * 5, { noFoot: k > 0, quoin: [0.4, 0.22], holes: k === 0 ? [[[hx - 0.36, 0, hx + 0.36, 0.9]], null, null, null] : null });
      g.surf(K_STONE, 0.9);
      for (let s = 0; s < 4; s++) { const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz; g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, y1 - 0.08, D)), () => g.mould([[0, 0], [0.05, 0.02], [0.06, 0.08], [0, 0.1]], 2 * W, limeTint(s + k * 4), 1, 1)); }
      g.flat([[-hx, y1 + 0.003, -hz], [-hx, y1 + 0.003, hz], [hx, y1 + 0.003, hz], [hx, y1 + 0.003, -hz]], mix(LIME, [0.3, 0.4, 0.2], 0.35));
      // a parapet of stepped merlons round the lower two tiers
      if (k < 2) for (let s = 0; s < 4; s++) { const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz, n = Math.round((2 * W) / 0.42); g.in(M(0, 0, 0, 0, s * 90, 0), () => { for (let i = 0; i < n; i++) { const x = -W + (i + 0.5) * (2 * W / n); if (s === 0 && Math.abs(x) < 0.45) continue; g.in(M(x, y1, D - 0.06), () => prism(g, MERLON.step(0.3, 0.3), 0.1, limeTint(i + s, 0.95), [0, 0.1])); } }); }
      // garden beds along the inner edge: shrubs, flowers, vines spilling over the wall below
      if (k > 0) for (let s = 0; s < 4; s++) { const [phx, phz] = T[k - 1], W = s % 2 ? phz : phx, D = s % 2 ? hx : hz, pD = s % 2 ? phx : phz; g.in(M(0, 0, 0, 0, s * 90, 0), () => { const n = Math.round((2 * W) / 0.62); for (let i = 0; i < n; i++) { const x = -W + 0.25 + i * ((2 * W - 0.5) / Math.max(1, n - 1)); if (s === 0 && Math.abs(x) < 0.5) continue; g.in(M(x, y0 + 0.12, (D + pD) / 2 + 0.05), () => leafClump(g, 0.24, 1520 + k * 40 + s * 10 + i, sw(0x2f6a2a, 0x3a7a32, 0x4a8a3a), 3)); if (i % 2 === 0) g.in(M(x + 0.12, y0 + 0.02, pD - 0.02), () => vines(g, 0.3, 0.55 + 0.3 * hash1(i, s), k * 30 + s * 7 + i, { leaf: sw(0x2f6a2a, 0x3a7a32), bloom: [rgb(0xe84a6a), rgb(0xe8c83a), rgb(0xd84ad8)][(i + s) % 3], bloomP: 0.35 })); } }); }
    });
  });
  // vines down the outer wall too
  for (let s = 0; s < 4; s++) for (let i = 0; i < 3; i++) { const W = s % 2 ? T[0][1] : T[0][0], D = s % 2 ? T[0][0] : T[0][1], x = -W + 0.4 + i * (2 * W - 0.8) / 2; if (s === 0 && Math.abs(x) < 0.6) continue; g.in(M(0, 0, CZ).multiply(M(0, 0, 0, 0, s * 90, 0)).multiply(M(x, T[0][3] - 0.02, D + 0.02)), () => vines(g, 0.4, 0.7, s * 9 + i, { leaf: sw(0x2f6a2a, 0x3a7a32), bloom: rgb(0xe84a6a), bloomP: 0.25 })); }
  // the gate in the river wall: a corbelled arch, jade-and-gold lintel, timber doors
  g.in(M(0, 0, CZ + T[0][1] + 0.02), () => {
    g.surf(K_PLAIN, 1); g.in(M(0, 0, -0.04), () => g.poly([[-0.36, 0, 0], [0.36, 0, 0], [0.36, 0.7, 0], [0.22, 0.85, 0], [0.12, 0.98, 0], [-0.12, 0.98, 0], [-0.22, 0.85, 0], [-0.36, 0.7, 0]], 0, 0, 1, [0.03, 0.025, 0.02]));
    for (const e of [-1, 1]) g.in(M(e * 0.17, 0, -0.02), () => roundDoor(g, 0.32, 0.7, rgb(0x5a4028), P.eGold, 1530 + e, { bands: [0.25, 0.7], ringX: -e * 0.25 }));
    g.surf(K_STONE, 0.85); g.in(M(0, 1.06, 0.03), () => g.cbox(1.0, 0.16, 0.1, 0.02, limeTint(60)));
    g.surf(K_PLAIN, 0.4, 0.3); g.in(M(0, 1.06, 0.085), () => g.cbox(0.8, 0.08, 0.02, 0.006, (x) => (Math.abs(tri1(x * 5) - 0.5) < 0.15 ? P.eGold : P.jade)));
    for (const e of [-1, 1]) g.in(M(e * 0.5, 1.15, 0.05), () => { g.in(M(0, 0, 0, 0, e * 90, 0), () => serpentHead(g, 0.34, mix(P.jade, LIME, 0.3), [0.95, 0.75, 0.2])); });
  });
  // the stair up the front of the upper tiers, and the shrine on top with its roof comb
  g.surf(K_STONE, 0.88);
  for (let k = 1; k < 3; k++) { const [hx, hz, y0, y1] = T[k], pz = T[k - 1][1]; const n = 5; for (let q = 0; q < n; q++) { const h = ((q + 1) * (y1 - y0)) / n, z = CZ + hz + (pz - hz) * (1 - (q + 0.5) / n); g.in(M(0, y0 + h / 2 - 0.02, z), () => g.cbox(0.7, h + 0.04, (pz - hz) / n + 0.01, 0.01, limeTint(q + k * 6, 0.97))); } }
  g.in(M(0, T[2][3], CZ), () => {
    stoneBox(g, 0.62, 0.5, 0, 0.95, limeSt(1540), 1541, { noFoot: true, holes: [[[0.42, 0, 0.82, 0.6]], null, null, null] });
    g.in(M(0, 0, 0.51), () => { g.surf(K_PLAIN, 1); g.flat([[-0.2, 0, 0], [0.2, 0, 0], [0.2, 0.6, 0], [-0.2, 0.6, 0]], [0.03, 0.025, 0.02]); });
    g.surf(K_STONE, 0.85); g.in(M(0, 0.95, 0), () => g.cbox(1.36, 0.12, 1.12, 0.02, limeTint(61)));
    g.surf(K_PLAIN, 0.4, 0.3); g.in(M(0, 0.85, 0.505), () => g.cbox(1.2, 0.1, 0.02, 0.004, (x) => (Math.abs(tri1(x * 6) - 0.5) < 0.15 ? P.eGold : P.jade)));
    // the comb: a pierced crest of stone, gilded suns set in it
    g.in(M(0, 1.01, -0.05), () => { g.surf(K_STONE, 0.85); prism(g, [[-0.55, 0], [0.55, 0], [0.42, 0.7], [0.28, 0.75], [0.25, 1.05], [0.0, 1.2], [-0.25, 1.05], [-0.28, 0.75], [-0.42, 0.7]], 0.14, limeTint(62), [0, 0.4]); g.surf(K_PLAIN, 1); for (const [x, y] of [[-0.25, 0.3], [0.25, 0.3], [0, 0.62]]) g.in(M(x, y, 0.072), () => g.poly([[-0.07, -0.1, 0], [0.07, -0.1, 0], [0.07, 0.1, 0], [-0.07, 0.1, 0]], 0, 0, 1, [0.08, 0.1, 0.06])); g.in(M(0, 0.95, 0.075), () => sunDisc(g, 0.9, P.eGold, { rays: 12, glow: 0.05 })); for (const e of [-1, 1]) g.in(M(e * 0.38, 0.62, 0.075), () => { g.surf(K_PLAIN, 0.4, 0.3); g.stud(0.05, P.jade, 8); }); });
  });
  // flowering trees on the corners of the middle tier
  for (const [x, z] of [[-1, -1], [1, -1]]) g.in(M(x * 1.35, T[1][3], CZ + z * 1.1), () => { g.surf(K_WOOD, 0.9); limb(g, [[0, 0, 0], [0.05, 0.4, 0], [0, 0.7, 0.05]], [0.06, 0.05, 0.04], { nu: 6, nv: 6, col: rgb(0x5a4a34) }); g.in(M(0, 0.85, 0), () => leafClump(g, 0.42, 1550 + x, sw(0x2f6a2a, 0x3a7a32, 0xe84a6a), 5)); });
}

// =====================================================================================================
// Deeproot: titanic rainforest trees, woven nests, poison colours
// =====================================================================================================
const RF_LEAF = sw(0x2f5a22, 0x3a6a2a, 0x4a7a2e, 0x284e1e), RF_BARK = rgb(0x5a4c3a), VINE_W = rgb(0xa08a58);
const rfBark = (seed = 0) => (x, y, z) => mix(mul(RF_BARK, 0.65 + 0.45 * noise3(x * 5 + seed, y * 1.5, z * 5)), [0.2, 0.32, 0.12], smooth(0.55, 0.75, noise3(x * 2 + seed, y * 1.2 + 4, z * 2)) * 0.6);
/** a woven nest-hut sitting on the local origin: a basket ball, a door hole toward +Z, a cone of leaf thatch */
function nestHut(g, r, seed, o = {}) {
  g.surf(K_WOOD, 0.9);
  g.in(M(0, -0.04, 0), () => g.cyl(r * 1.05, r * 1.15, 0.06, nq(14), woodTint(VINE_W, seed), true, true));
  const door = (a, y) => Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.4 && y > 0.04 && y < r * 1.0;
  g.surf(K_CLOTH, 0.95);
  g.sheet(nq(28), nq(10), (u, v) => { const a = u * TAU, t = v * Math.PI * 0.82, rr = Math.sin(t + 0.25) * r * (1 + 0.04 * Math.sin(a * 9)), y = (1 - Math.cos(t + 0.25)) * r * 0.82; const d = door(a, y) ? 0.75 : 1; return [Math.cos(a) * rr * d, y, Math.sin(a) * rr * d]; }, (x, y, z) => { const a = Math.atan2(z, x); if (door(a, y)) return [0.04, 0.03, 0.02]; const band = Math.abs(y - r * 0.6) < r * 0.08; return band ? (Math.floor(a * 8 / Math.PI) % 2 ? P.poison : P.yellow) : weaveCol(VINE_W, 20)(x, y, z); }, true, true);
  g.surf(K_LEAF, 0.85);
  g.sheet(nq(24), nq(6), (u, v) => { const a = u * TAU, rr = lerp(r * 1.25, 0.02, v) * (1 + 0.1 * Math.abs(Math.sin(a * 7 + v * 3))), y = r * 1.25 + v * r * 1.1 - 0.12 * (1 - v) * Math.abs(Math.sin(a * 7)); return [Math.cos(a) * rr, y, Math.sin(a) * rr]; }, (x, y, z) => mul(RF_LEAF[Math.floor(Math.abs(Math.atan2(z, x)) * 4.5 + y * 7) % 4], 0.8 + 0.35 * noise3(x * 9, y * 9, z * 9)), true, true);
  if (o.lamp) g.in(M(r * 0.7, r * 1.15, r * 0.6), () => lamp(g, 0.6, [1.0, 0.85, 0.3], { shape: 'paper', frame: VINE_W, tassel: P.poison }));
  g.in(M(0, r * 2.35, 0), () => { g.surf(K_WOOD, 0.8); g.cyl(0.015, 0.012, 0.35, 5, woodTint(VINE_W, seed), false, true); g.in(M(0, 0.33, 0), () => { g.surf(K_CLOTH, 0.9); pennon(g, 0.02, 0.3, seed % 2 ? P.poison : P.yellow, rgb(0x1a1a1a), { knob: false, pole: VINE_W }); }); });
}
/** a rope-and-plank walkway slung from a to b */
function walkway(g, a, b, sag = 0.25, seed = 0) {
  const n = Math.max(4, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.12)), at = (t, dy = 0, side = 0) => { const d = [b[0] - a[0], 0, b[2] - a[2]], l = Math.hypot(d[0], d[2]) || 1, sx = -d[2] / l, sz = d[0] / l; return [lerp(a[0], b[0], t) + sx * side, lerp(a[1], b[1], t) - sag * Math.sin(t * Math.PI) + dy, lerp(a[2], b[2], t) + sz * side]; };
  g.surf(K_WOOD, 0.9);
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, p = at(t), q = at(t + 0.01), ang = Math.atan2(b[0] - a[0], b[2] - a[2]) / DEG; g.in(M(p[0], p[1], p[2], 0, ang, 0).multiply(M(0, 0, 0, -Math.atan2(q[1] - p[1], 0.01 * Math.hypot(b[0] - a[0], b[2] - a[2])) / DEG, 0, (hash1(i, seed) - 0.5) * 8)), () => g.cbox(0.3, 0.025, 0.08, 0.006, woodTint(mul(VINE_W, 0.6 + 0.3 * hash1(i, seed + 1)), i))); }
  for (const side of [-0.17, 0.17]) { const pts = []; for (let i = 0; i <= 12; i++) pts.push(at(i / 12, 0.36, side)); rope(g, pts, 0.012, rgb(0x8a7a50), 4); for (let i = 1; i < 12; i += 2) rope(g, [at(i / 12, 0.36, side), at(i / 12, 0.0, side)], 0.006, rgb(0x8a7a50), 3); }
  for (const side of [-0.15, 0.15]) { const pts = []; for (let i = 0; i <= 12; i++) pts.push(at(i / 12, -0.02, side)); rope(g, pts, 0.01, rgb(0x7a6a40), 4); }
}
function nestTree(g, fog) {
  g.moss = 1.3;
  pad(g, 3, 3, 0.04, (x, y, z) => mix(mul(rgb(0x3a2e22), 0.7 + 0.4 * fbm3(x * 3, y * 3, z * 3, 2)), RF_LEAF[1], smooth(0.35, 0.65, noise3(x * 1.6, 2, z * 1.6)) * 0.7), 1601, { sq: 3 });
  // the trunk and its great plank buttresses
  const trunk = [[0, -0.1, 0], [0.05, 1.5, -0.05], [-0.05, 3.2, 0.05], [0.08, 4.8, -0.02], [0, 6.0, 0]];
  g.surf(K_WOOD, 0.95);
  limb(g, trunk, [0.62, 0.48, 0.42, 0.34, 0.18], { nu: nq(14), nv: nq(24), amp: 0.12, seed: 2, nf: 1.8, col: rfBark(2), capB: true });
  for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU + 0.3, L = 1.25 + 0.15 * hash1(k, 3); limb(g, [[Math.cos(a) * 0.2, 1.7, Math.sin(a) * 0.2], [Math.cos(a) * 0.55, 0.8, Math.sin(a) * 0.55], [Math.cos(a) * 0.95, 0.25, Math.sin(a) * 0.95], [Math.cos(a) * L, -0.08, Math.sin(a) * L]], [0.32, 0.26, 0.16, 0.08], { nu: nq(8), nv: nq(10), flat: [1, 0.28], up: [-Math.sin(a), 0, Math.cos(a)], amp: 0.08, seed: k, col: rfBark(k), capB: true }); }
  // branches
  const br = [[0.4, 4.2, 1.45, 5.3], [2.2, 4.5, 1.5, 5.6], [4.1, 4.9, 1.4, 5.9], [5.4, 4.3, 1.4, 5.2], [1.2, 5.3, 1.1, 6.3], [3.3, 5.5, 1.0, 6.5]], tips = [];
  br.forEach(([a, y, L, ye], k) => { const p0 = [Math.cos(a) * 0.25, y, Math.sin(a) * 0.25], p1 = [Math.cos(a) * L * 0.55, (y + ye) / 2 + 0.1, Math.sin(a) * L * 0.55], p2 = [Math.cos(a + 0.2) * L, ye, Math.sin(a + 0.2) * L]; limb(g, [p0, p1, p2], [0.2, 0.13, 0.06], { nu: nq(8), nv: nq(10), amp: 0.08, seed: k + 10, col: rfBark(k + 10), capB: true }); tips.push(p2); });
  // the canopy: heavy clumps of leaves over the branch ends and the crown
  for (const [i, t] of tips.entries()) g.in(M(t[0], t[1] + 0.25, t[2]), () => leafClump(g, 0.9, 1610 + i, RF_LEAF, 5, { flat: 0.5 }));
  g.in(M(0, 6.3, 0), () => leafClump(g, 1.3, 1620, RF_LEAF, 6, { flat: 0.6 }));
  // the nest-huts: on platforms in the forks, joined by walkways to each other and to the trunk
  const huts = [[0.78, 2.2, 0.72, 0.4], [-0.92, 3.1, -0.3, 0.38], [0.3, 4.0, -0.9, 0.34]];
  huts.forEach(([x, y, z, r], k) => {
    g.in(M(x, y, z), () => { g.surf(K_WOOD, 0.9); g.cyl(r + 0.2, r + 0.18, 0.06, nq(14), woodTint(rgb(0x6a5032), k), true, true); for (let q = 0; q < 4; q++) { const a = q * 1.57 + k; logTo(g, [Math.cos(a) * (r + 0.1), -0.02, Math.sin(a) * (r + 0.1)], [-x * 0.7, -0.5, -z * 0.7], 0.035, 0.03, k * 4 + q, { seg: 5 }); } });
    g.in(M(x, y + 0.06, z, 0, Math.atan2(x, z) / DEG, 0), () => nestHut(g, r, 1630 + k, { lamp: k !== 1 }));
  });
  walkway(g, [huts[0][0] - 0.25, huts[0][1] + 0.06, huts[0][2] - 0.2], [-0.25, 2.6, 0.38], 0.12, 1);
  walkway(g, [huts[1][0] + 0.32, huts[1][1] + 0.06, huts[1][2] + 0.1], [0.55, 2.3, 0.5], 0.3, 2);
  walkway(g, [huts[2][0] - 0.2, huts[2][1] + 0.06, huts[2][2] + 0.25], [huts[1][0] + 0.25, huts[1][1] + 0.08, huts[1][2] - 0.25], 0.28, 3);
  // a rope ladder from the ground to the lowest hut, vines hanging off every branch, painted frog shields on the trunk
  g.in(M(huts[0][0] + 0.2, huts[0][1], huts[0][2] + 0.45), () => { for (const e of [-1, 1]) rope(g, [[e * 0.14, 0, 0], [e * 0.14, -huts[0][1] * 0.5, 0.05], [e * 0.14, -huts[0][1] + 0.05, 0.02]], 0.012, rgb(0x8a7a50), 4); g.surf(K_WOOD, 0.9); for (let i = 1; i < 11; i++) { const t = i / 11; g.in(M(0, -t * (huts[0][1] - 0.05), 0.05 * Math.sin(t * Math.PI)), () => g.cbox(0.32, 0.025, 0.04, 0.006, woodTint(VINE_W, i))); } });
  for (const [i, t] of tips.entries()) g.in(M(t[0] * 0.8, t[1] - 0.05, t[2] * 0.8), () => vines(g, 0.5, 1.0 + 0.8 * hash1(i, 5), 1640 + i, { leaf: RF_LEAF, n: 3, leaves: 6, bloom: P.poison, bloomP: 0.15 }));
  for (const [a, y] of [[30, 1.5], [150, 1.9], [260, 1.3]]) g.in(M(0, y, 0, 0, a, 0).multiply(M(0, 0, 0.5)), () => { g.surf(K_PLAIN, 0.6); g.in(M(0, 0, 0.02, 90, 0, 0), () => g.cyl(0.16, 0.16, 0.04, nq(12), P.yellow, true, true)); g.in(M(0, 0, 0.045), () => { g.surf(K_PLAIN, 0.5); g.add(new THREE.SphereGeometry(0.1, 8, 6).scale(1, 0.75, 0.3), P.poison); for (const e of [-1, 1]) g.in(M(e * 0.05, 0.05, 0.02), () => g.add(new THREE.SphereGeometry(0.03, 6, 4), [0.05, 0.05, 0.05])); }); });
  // mist in the undergrowth
  fog.in(M(0, 0, 0), () => fogBank(fog, 1.4, 0.35, 1.4, 5, 7, [0.66, 0.74, 0.66], 0.1));
  for (const [x, z, r, sd] of [[1.2, -0.9, 0.32, 1], [-1.15, 1.05, 0.3, 2], [-0.2, 1.3, 0.26, 3]]) g.in(M(x, 0.06, z), () => leafClump(g, r, 1650 + sd, RF_LEAF, 4));
}
function spiritTotem(g) {
  g.moss = 0.6;
  pad(g, 1, 1, 0.03, (x, y, z) => mix(mul(rgb(0x3a2e22), 0.7 + 0.4 * fbm3(x * 3, y * 3, z * 3, 2)), RF_LEAF[1], 0.4), 1701, { sq: 3 });
  const geo = geoOnce('spiritTotem', () => {
    const W = 0x7a5a3a, G = 0x3a6a2a, R = 0xe83a3a, Y = 0xe8d83a, K = 0x141414, Wh = 0xe8e0d0, Pp = [];
    // the pole
    Pp.push(S.cyl(0.2, 2.3, 0.03).at(0, 1.15, 0).color(W).bump(0.004, 14).tint(0.1, 10));
    // the frog at the foot: a squat green head, bulging yellow eyes, a wide red mouth
    Pp.push(S.ellipsoid(0.3, 0.28, 0.27).at(0, 0.42, 0.03).color(G).blend(0.06));
    Pp.push(...S.mirrorX([S.sphere(0.1).at(0.14, 0.64, 0.16).color(Y).blend(0.03), S.ellipsoid(0.05, 0.025, 0.03).at(0.15, 0.66, 0.25).color(K).blend(0.005)]));
    Pp.push(S.box(0.42, 0.04, 0.1, 0.02).at(0, 0.36, 0.27).color(R).blend(0.02));
    Pp.push(...S.mirrorX([S.capsule([0.22, 0.18, 0.12], [0.3, 0.05, 0.24], 0.06, 0.05).color(G).blend(0.04), S.ellipsoid(0.08, 0.03, 0.07).at(0.32, 0.03, 0.28).color(Y).blend(0.02)]));
    // the jaguar in the middle: a yellow head with black rosettes, ears, a muzzle and white fangs
    Pp.push(S.ellipsoid(0.27, 0.3, 0.25).at(0, 1.22, 0.04).color(Y).blend(0.06));
    Pp.push(...S.mirrorX([S.cone(0.08, 0.02, 0.14, 0.02).rot(0, 0, -20).at(0.18, 1.5, 0.02).color(Y).blend(0.03), S.ellipsoid(0.07, 0.05, 0.03).at(0.11, 1.28, 0.24).color(Wh).blend(0.02), S.sphere(0.03).at(0.11, 1.28, 0.27).color(K).blend(0.005)]));
    Pp.push(S.ellipsoid(0.15, 0.1, 0.12).at(0, 1.12, 0.22).color(0xd8b870).blend(0.04));
    Pp.push(S.ellipsoid(0.05, 0.035, 0.03).at(0, 1.17, 0.33).color(K).blend(0.01));
    Pp.push(...S.mirrorX([S.cone(0.025, 0.004, 0.09, 0.004).rot(180, 0, 0).at(0.06, 1.02, 0.3).color(Wh).blend(0.006)]));
    Pp.push(S.box(0.18, 0.02, 0.06, 0.01).at(0, 1.05, 0.28).color(R).blend(0.01));
    for (let i = 0; i < 7; i++) { const a = i * 0.9 - 2.7, y = 1.05 + (i % 3) * 0.14; Pp.push(S.sphere(0.035).at(Math.sin(a) * 0.26, y + 0.12, Math.cos(a) * 0.23).color(K).blend(0.006)); }
    // a band of red and black chevrons between the beasts
    Pp.push(S.cyl(0.215, 0.1, 0.02).at(0, 0.82, 0).color(R).blend(0.02));
    Pp.push(S.cyl(0.215, 0.1, 0.02).at(0, 1.66, 0).color(R).blend(0.02));
    // the bird at the top: a hooked yellow beak, eyes ringed white, a crest of feathers
    Pp.push(S.ellipsoid(0.24, 0.3, 0.24).at(0, 2.05, 0.02).color(G).blend(0.06));
    Pp.push(S.capsule([0, 2.08, 0.18], [0, 1.92, 0.42], 0.1, 0.03).color(Y).blend(0.03));
    Pp.push(S.capsule([0, 1.92, 0.42], [0, 1.8, 0.4], 0.03, 0.01).color(Y).blend(0.02));
    Pp.push(...S.mirrorX([S.sphere(0.06).at(0.12, 2.16, 0.18).color(Wh).blend(0.01), S.sphere(0.03).at(0.13, 2.17, 0.23).color(K).blend(0.004)]));
    Pp.push(S.ellipsoid(0.22, 0.12, 0.22).at(0, 2.35, 0).color(R).blend(0.04));
    return buildPartGeometry({ prims: Pp }, { res: 34 * qual(), ao: 0.75 });
  });
  g.surf(K_WOOD, 0.75);
  g.add(geo);
  // the bird's wings: carved planks spread wide, painted in bands, feathers hanging from their tips
  for (const e of [-1, 1]) g.in(M(e * 0.16, 1.98, -0.02, 0, 0, e * -12), () => {
    g.surf(K_WOOD, 0.75);
    const pts = [[0, -0.12], [0.18, -0.1], [0.36, -0.04], [0.48, 0.06], [0.52, 0.2], [0.4, 0.18], [0.22, 0.14], [0, 0.12]].map(([x, y]) => [e * x, y]);
    prism(g, pts, 0.06, (x, y) => { const t = Math.abs(x) / 0.52; return t > 0.75 ? P.yellow : t > 0.45 ? P.poison : P.leaf; }, [e * 0.2, 0.02]);
    for (let k = 0; k < 4; k++) g.in(M(e * (0.22 + k * 0.08), -0.08 + k * 0.03, 0.0), () => { g.surf(K_PLAIN, 0.8); rag(g, 0.035, 0.22 + 0.04 * k, [P.poison, P.yellow, P.leaf, rgb(0x2a6aa8)][k], k + (e > 0 ? 4 : 0), 0.15); });
  });
  // the crest: long feathers fanned up out of the bird's head
  for (let k = 0; k < 7; k++) { const a = (k - 3) * 14; g.in(M(0, 2.36, -0.04, -12, 0, a * 1.4), () => { g.surf(K_PLAIN, 0.8); g.sheet(2, 6, (u, v) => [(u - 0.5) * 0.16 * Math.sin(v * Math.PI * 0.9 + 0.25), v * (0.6 + 0.2 * (3 - Math.abs(k - 3)) / 3), 0.04 * Math.sin(v * 3)], (x, y, z, nx, ny, nz, u, v) => (v > 0.75 ? rgb(0x1a1a1a) : [P.poison, P.yellow, rgb(0x2aa860), rgb(0x2a6aa8)][k % 4])); }); }
  // the foot: a ring of stones, offerings of fruit and little clay bowls
  for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU; g.in(M(Math.cos(a) * 0.36, 0.02, Math.sin(a) * 0.36), () => boulder(g, 0.07, 0.05, 0.06, 1710 + k, rgb(0x6a6a5a), 10)); }
  for (const [x, z, c] of [[0.24, 0.22, P.poison], [-0.22, 0.24, P.yellow], [0.05, 0.32, rgb(0xe87a2a)]]) g.in(M(x, 0.05, z), () => { g.surf(K_PLAIN, 0.5); g.add(new THREE.SphereGeometry(0.045, 8, 6), c); });
  g.in(M(-0.3, 0, -0.05), () => jar(g, 0.12, rgb(0x9a5a32), { stripe: P.yellow }));
}

// =====================================================================================================
// Goldsands: white marble and sandstone, turquoise domes, gold and silk
// =====================================================================================================
const GS_SAND = rgb(0xd8b888), GS_PAL = sw(0xe8e0d0, 0xe2d8c4, 0xece6da, 0xd8ccb4, 0xe4dccc), GS_BAND = rgb(0xc89a68);
const gsSt = (seed, o) => stoneStyle(0xe8e0d0, { seed, pal: GS_PAL, chip: 0.12, var: 0.06, course: 0.2, len: [0.32, 0.56], cell: 0.26 / qual(), mortar: [0.5, 0.44, 0.36], ...o });
const tileCol = (base = P.gTurq, seed = 0) => (x, y, z) => { const a = Math.atan2(z, x) * 8, b = y * 9, d = Math.abs(tri1((a + b) / 2) - 0.5) < 0.08 || Math.abs(tri1((a - b) / 2) - 0.5) < 0.08; return d ? mul(P.gGold, 0.9) : mul(base, 0.8 + 0.3 * noise3(x * 12 + seed, y * 12, z * 12)); };
const sandCol = (seed = 0) => (x, y, z) => mul(mix(rgb(0xd8c090), rgb(0xc8a070), noise3(x * 1.6 + seed, 1, z * 1.6)), 0.82 + 0.25 * fbm3(x * 4 + seed, y * 4, z * 4, 2));
/** an onion dome standing on the local origin: radius R at its widest, H tall, tiled; a gilt crescent finial */
function onionDome(g, R, H, seed, col = tileCol(P.gTurq, seed)) {
  g.surf(K_ROOF, 0.3, 0.3);
  const prof = (t) => (t < 0.45 ? R * (0.82 + 0.18 * Math.sin((t / 0.45) * Math.PI / 2)) : R * Math.pow(Math.cos(((t - 0.45) / 0.55) * Math.PI / 2), 1.6) * (1 - 0.1 * Math.sin(((t - 0.45) / 0.55) * Math.PI)));
  g.sheet(nq(32), nq(16), (u, v) => { const a = u * TAU, r = prof(v) * (1 + 0.025 * Math.abs(Math.sin(a * 8))); return [Math.cos(a) * r, v * H, Math.sin(a) * r]; }, col, true, true);
  g.surf(K_PLAIN, 0.25, 0.9);
  g.lathe([[R * 0.84, -0.02], [R * 0.88, 0.02], [R * 0.84, 0.05]], nq(28), P.gGold);
  g.in(M(0, H - 0.02, 0), () => { g.lathe([[0.05, 0], [0.07, 0.04], [0.03, 0.1], [0.06, 0.16], [0.03, 0.22], [0.015, 0.36]].map(([r, y]) => [r * R * 2.2, y * R * 2.2]), nq(10), P.gGold); g.in(M(0, 0.4 * R * 2.2, 0, 0, 0, 0), () => g.add(new THREE.TorusGeometry(0.07 * R * 2.2, 0.018 * R * 2.2, 5, 12, Math.PI * 1.4).rotateZ(Math.PI * 0.8), P.gGold)); });
}
/** a palm tree standing on the local origin */
function palm(g, h, seed) {
  const rnd = rng(seed * 13 + 1), lean = (rnd() - 0.5) * 0.4, pts = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([lean * t * t * h, t * h, 0.1 * Math.sin(t * 3 + seed) * t]); }
  g.surf(K_WOOD, 0.9);
  limb(g, pts, pts.map((_, i) => 0.09 - i * 0.008), { nu: nq(8), nv: nq(14), col: (x, y, z) => mul(rgb(0x8a6a48), Math.abs(((y * 9) % 1 + 1) % 1 - 0.5) > 0.38 ? 0.6 : 0.95) });
  const top = pts[6];
  g.surf(K_LEAF, 0.8);
  for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU + rnd(), L = 0.75 + 0.25 * rnd(); g.in(M(top[0], top[1], top[2], 0, -a / DEG, 0), () => g.sheet(nq(8), 2, (u, v) => { const x = u * L, y = 0.25 * Math.sin(u * 2.2) - 0.55 * u * u; return [x, y, (v - 0.5) * 0.26 * Math.sin(u * Math.PI) * (1 + 0.3 * Math.abs(Math.sin(u * 30)))]; }, (x, y, z, nx, ny, nz, u, v) => mul(mix(rgb(0x4a7a2a), rgb(0x8a9a3a), u * 0.5), 0.8 + 0.3 * Math.abs(Math.sin(u * 40 + v * 3))))); }
  g.surf(K_PLAIN, 0.6); for (let k = 0; k < 5; k++) g.in(M(top[0] + Math.cos(k * 1.3) * 0.08, top[1] - 0.08, top[2] + Math.sin(k * 1.3) * 0.08), () => g.add(new THREE.SphereGeometry(0.045, 6, 5), rgb(0x8a5a2a)));
}
function palace(g, fog) {
  g.moss = 0.1;
  pad(g, 5, 5, 0.03, sandCol(3), 1801, { sq: 4 });
  // the plinth and the court: a marble platform, a long pool with a fountain, palms
  const st = gsSt(1802);
  stoneBox(g, 2.38, 2.38, 0, 0.26, st, 1803);
  g.surf(K_STONE, 0.5); g.flat([[-2.38, 0.262, -2.38], [-2.38, 0.262, 2.38], [2.38, 0.262, 2.38], [2.38, 0.262, -2.38]], mix(GS_PAL[0], GS_BAND, 0.25));
  for (let q = 0; q < 2; q++) g.in(M(0, 0.065 + q * 0.065, 2.5 - q * 0.1), () => { g.surf(K_STONE, 0.5); g.cbox(1.2, 0.13 + q * 0.13, 0.12, 0.01, stoneTint(GS_PAL[q], q, 4)); });
  g.surf(K_STONE, 0.5); for (const [x, z, w, d] of [[0, 0.77, 1.0, 0.08], [0, 2.13, 1.0, 0.08], [-0.46, 1.45, 0.08, 1.44], [0.46, 1.45, 0.08, 1.44]]) g.in(M(x, 0.33, z), () => g.cbox(w, 0.14, d, 0.015, stoneTint(GS_BAND, x * 9 + z, 4)));
  g.surf(K_PLAIN, 0.3, 0.2); g.flat([[-0.42, 0.27, 0.81], [-0.42, 0.27, 2.09], [0.42, 0.27, 2.09], [0.42, 0.27, 0.81]], mul(P.gTurq, 0.6));
  water(g, -0.42, 0.42, 0.81, 2.09, 0.35, 3, [0.08, 0.4, 0.45], 0.12);
  g.in(M(0, 0.37, 1.45), () => { g.surf(K_STONE, 0.5); g.lathe([[0.18, 0], [0.18, 0.1], [0.08, 0.14], [0.05, 0.3], [0.14, 0.36], [0.16, 0.4], [0.03, 0.42], [0.02, 0.55]], nq(12), stoneTint(GS_PAL[0], 5, 6)); });
  fog.in(M(0, 0.92, 1.45), () => { fog.surf(K_PLAIN, 1, 0, 0.2); for (let k = 0; k < 6; k++) { const a = k * 1.05; fog.tube([[0, 0, 0], [Math.cos(a) * 0.12, 0.08, Math.sin(a) * 0.12], [Math.cos(a) * 0.24, -0.1, Math.sin(a) * 0.24], [Math.cos(a) * 0.28, -0.5, Math.sin(a) * 0.28]], [0.01, 0.014, 0.018, 0.024], 4, [0.8, 0.95, 1.0], false); } });
  for (const [x, z, h, sd] of [[-1.6, 1.85, 2.1, 1], [1.65, 1.8, 2.4, 2], [-1.95, 0.9, 1.7, 3]]) g.in(M(x, 0.26, z), () => { g.surf(K_STONE, 0.5); g.cyl(0.2, 0.18, 0.2, nq(10), stoneTint(GS_BAND, sd, 5), false, true); g.in(M(0, 0.2, 0), () => palm(g, h, 1810 + sd)); });
  // the palace block: white marble banded in sandstone, a horseshoe arcade along its front
  const HX = 1.55, HZ = 1.0, CZ = -0.55, Y0 = 0.26, Y1 = 2.46;
  g.in(M(0, 0, CZ), () => {
    stoneBox(g, HX, HZ, Y0, Y1, gsSt(1820), 1821, { noFoot: true, holes: [[[0.5, 0, 2.6, 1.4]], [[0.6, 1.0, 0.95, 1.6], [1.05, 1.0, 1.4, 1.6]], [[0.8, 1.0, 1.15, 1.6], [1.95, 1.0, 2.3, 1.6]], [[0.6, 1.0, 0.95, 1.6], [1.05, 1.0, 1.4, 1.6]]], each: (s, W) => {
      if (s === 0) return;
      for (const x of s === 2 ? [0.975, 2.125] : [0.775, 1.225]) g.in(M(x, 1.0, 0.02), () => archFrame(g, 0.34, 0.58, 'horse', P.gTurq, { t: 0.03, fill: [0.06, 0.05, 0.05], kind: K_PLAIN }));
    } });
    g.surf(K_STONE, 0.5);
    for (const y of [Y0 + 0.6, Y0 + 1.75]) for (let s = 0; s < 4; s++) { const W = s % 2 ? HZ : HX, D = s % 2 ? HX : HZ; g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, y, D)), () => g.mould([[0, 0], [0.025, 0], [0.025, 0.1], [0, 0.1]], 2 * W, (x) => mul(GS_BAND, 0.9 + 0.15 * hash1(Math.floor(x * 8), s)), 1, 1)); }
    // the arcade: slender columns, horseshoe arches with turquoise spandrels, a dark loggia behind
    g.in(M(0, Y0, HZ), () => {
      g.surf(K_PLAIN, 1); g.flat([[-1.1, 0, -0.06], [1.1, 0, -0.06], [1.1, 1.4, -0.06], [-1.1, 1.4, -0.06]], [0.07, 0.055, 0.045]);
      for (let i = 0; i < 5; i++) { const x = -0.84 + i * 0.42; g.in(M(x, 0, 0.03), () => archFrame(g, 0.36, 1.25, 'horse', (px, py) => (Math.floor(py * 7) % 2 ? GS_BAND : GS_PAL[0]), { t: 0.04 })); g.in(M(x, 1.32, 0.035), () => { g.surf(K_PLAIN, 0.3, 0.2); g.cbox(0.36, 0.14, 0.02, 0.004, tileCol(P.gTurq, i)); }); }
      for (let i = 0; i < 6; i++) g.in(M(-1.05 + i * 0.42, 0, 0.06), () => columnOn(g, 0.95, 0.04, stoneTint(GS_PAL[0], i, 6), P.gGold));
      g.in(M(0, 1.5, 0.04), () => glyphBand(g, 2.4, 0.16, 1830, [P.gGold], P.gTurq));
    });
    // stepped merlons and a gilt band along the parapet
    for (let s = 0; s < 4; s++) { const W = s % 2 ? HZ : HX, D = s % 2 ? HX : HZ, n = Math.round((2 * W) / 0.28); g.in(M(0, 0, 0, 0, s * 90, 0), () => { for (let i = 0; i < n; i++) g.in(M(-W + (i + 0.5) * (2 * W / n), Y1, D - 0.05), () => { g.surf(K_STONE, 0.5); prism(g, MERLON.step(0.2, 0.26), 0.08, stoneTint(GS_PAL[i % 3], i, 6), [0, 0.1]); }); g.surf(K_PLAIN, 0.25, 0.9); g.in(M(0, Y1 - 0.05, D + 0.01), () => g.cbox(2 * W, 0.04, 0.02, 0.004, P.gGold)); }); }
    g.surf(K_STONE, 0.5); g.flat([[-HX, Y1 + 0.003, -HZ], [-HX, Y1 + 0.003, HZ], [HX, Y1 + 0.003, HZ], [HX, Y1 + 0.003, -HZ]], GS_PAL[1]);
    // the great dome on its drum, two lesser domes on the front corners
    g.in(M(0, Y1, -0.05), () => { g.surf(K_STONE, 0.5); g.cyl(0.74, 0.72, 0.5, nq(28), stoneTint(GS_PAL[0], 7, 6), false, true); for (let k = 0; k < 12; k++) g.in(M(0, 0.25, 0, 0, k * 30, 0).multiply(M(0, -0.13, 0.715)), () => archFrame(g, 0.12, 0.26, 'horse', P.gTurq, { t: 0.02, fill: [0.06, 0.05, 0.05], kind: K_PLAIN })); g.surf(K_PLAIN, 0.3, 0.3); g.in(M(0, 0.44, 0), () => g.lathe([[0.73, -0.04], [0.76, -0.02], [0.76, 0.04], [0.73, 0.06]], nq(28), tileCol(P.gTurq, 2))); g.in(M(0, 0.5, 0), () => onionDome(g, 0.84, 1.75, 3)); });
    for (const e of [-1, 1]) g.in(M(e * (HX - 0.3), Y1, HZ - 0.3), () => { g.surf(K_STONE, 0.5); g.cyl(0.3, 0.29, 0.34, nq(16), stoneTint(GS_PAL[0], e, 6), false, true); g.in(M(0, 0.34, 0), () => onionDome(g, 0.34, 0.75, 5 + e)); });
  });
  // the minaret: an octagonal shaft, carved bands of gilt script, two balconies, a little onion dome
  g.in(M(-1.9, 0.26, -1.9), () => {
    const st2 = gsSt(1840, { course: 0.2 });
    g.surf(K_STONE, 0.5); g.cyl(0.42, 0.4, 0.5, 8, stoneTint(GS_PAL[0], 3, 6), false, true);
    g.in(M(0, 0.5, 0), () => facetCol(g, 8, 0.3, 4.2, { r1: 0.24, vs: 21, a0: Math.PI / 8, col: (x, y, z, i, edge) => mul(Math.floor(y / 0.2) % 3 === 2 ? GS_BAND : GS_PAL[i % 3], edge ? 0.92 : 1) }));
    for (const y of [1.1, 2.3, 3.4]) g.in(M(0, 0.5 + y, 0), () => { const r = lerp(0.3, 0.24, y / 4.2) + 0.006; for (let k = 0; k < 8; k++) g.in(M(0, 0, 0, 0, k * 45 + 22.5, 0).multiply(M(0, 0, r * Math.cos(Math.PI / 8))), () => glyphBand(g, 2 * r * Math.sin(Math.PI / 8) * 0.98, 0.18, 1850 + k + y * 10, [P.gGold], P.gTurq)); });
    for (const [y, r] of [[2.75, 0.44], [4.4, 0.38]]) g.in(M(0, 0.5 + y, 0), () => { g.surf(K_STONE, 0.5); g.lathe([[0.27, -0.2], [r * 0.8, -0.06], [r, 0], [r, 0.06], [0, 0.06]], nq(16), stoneTint(GS_PAL[0], y, 6)); for (let k = 0; k < 16; k++) g.in(M(0, 0.06, 0, 0, k * 22.5, 0).multiply(M(0, 0, r - 0.03)), () => { g.surf(K_PLAIN, 0.3, 0.9); g.cyl(0.012, 0.012, 0.22, 5, P.gGold, false, true); }); g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, 0.28, 0, 90, 0, 0), () => g.add(new THREE.TorusGeometry(r - 0.03, 0.014, 4, nq(18)), P.gGold)); });
    g.in(M(0, 4.96, 0), () => { g.surf(K_STONE, 0.5); g.cyl(0.2, 0.2, 0.36, 8, stoneTint(GS_PAL[0], 9, 6), false, true); for (let k = 0; k < 4; k++) g.in(M(0, 0.18, 0, 0, k * 90, 0).multiply(M(0, -0.1, 0.19)), () => archFrame(g, 0.1, 0.22, 'horse', P.gTurq, { t: 0.015, fill: [0.06, 0.05, 0.05], kind: K_PLAIN })); g.in(M(0, 0.36, 0), () => onionDome(g, 0.26, 0.62, 11)); });
  });
  // gilt lamps at the arcade, a carpet laid on the steps
  for (const e of [-1, 1]) g.in(M(e * 1.25, 1.9, CZ + HZ + 0.02), () => bracketLamp(g, 0.7, [1.0, 0.7, 0.3], { frame: P.gGold }));
  g.in(M(0, 0.27, 0.6), () => { g.surf(K_CLOTH, 0.95); g.cbox(0.7, 0.01, 0.6, 0.002, (x, y, z) => { const b = Math.abs(x) > 0.28 || Math.abs(z) > 0.24; return b ? P.gGold : Math.abs(tri1(x * 5 + z * 5) - 0.5) < 0.12 ? P.gTurq : rgb(0x8a1a2a); }); });
}
/** a carpet hanging over a rail: field, border and a lozenge medallion */
const carpetCol = (field, border, med) => (x, y, z, nx, ny, nz, u = 0, v = 0) => { const bx = Math.min(u, 1 - u), by = Math.min(v, 1 - v); if (bx < 0.1 || by < 0.08) return Math.abs(tri1((u + v) * 12) - 0.5) < 0.15 ? med : border; return Math.abs(u - 0.5) * 1.6 + Math.abs(v - 0.5) < 0.32 ? med : mul(field, 0.85 + 0.2 * Math.abs(Math.sin((u + v) * 30))); };
function souk(g) {
  g.moss = 0.1;
  pad(g, 4, 3, 0.02, sandCol(7), 1901, { sq: 4 });
  // the back wall: whitewashed mud-brick with horseshoe doorways and little latticed windows
  const BZ = -1.32;
  g.surf(K_PLASTER, 0.95);
  g.in(M(0, 0.95, BZ - 0.1), () => g.cbox(3.9, 1.9, 0.22, 0.04, (x, y, z) => mix(mul(P.gWhite, 0.85 + 0.15 * noise3(x * 3, y * 3, z * 3)), rgb(0xb89a70), smooth(-0.6, -0.95, y) * 0.6)));
  for (const x of [-1.25, 1.25]) g.in(M(x, 0, BZ + 0.02), () => archFrame(g, 0.5, 1.15, 'horse', P.gTurq, { t: 0.04, fill: [0.07, 0.05, 0.04], kind: K_PLAIN }));
  for (const x of [-0.45, 0.45]) g.in(M(x, 1.45, BZ + 0.02), () => { archFrame(g, 0.2, 0.3, 'horse', P.gTurq, { t: 0.025, fill: [0.05, 0.04, 0.03], kind: K_PLAIN }); g.surf(K_WOOD, 0.8); for (let k = -2; k <= 2; k++) for (const a of [45, -45]) g.in(M(k * 0.035, 0.12, 0.03, 0, 0, a), () => g.cbox(0.012, 0.22, 0.01, 0.002, rgb(0x5a3a22))); });
  g.surf(K_PLASTER, 0.95); for (let i = 0; i < 9; i++) g.in(M(-1.8 + i * 0.45, 1.93, BZ - 0.1), () => g.cbox(0.22, 0.12, 0.24, 0.02, mul(P.gWhite, 0.9)));
  // three stalls: timber frames under striped silk awnings
  const stalls = [[-1.3, sw(0xc82a3a, 0xe8d8a0)], [0, sw(0x2a8a9a, 0xe8d8a0)], [1.3, sw(0xd8a03a, 0x7a2a6a)]];
  stalls.forEach(([sx, [c1, c2]], k) => {
    g.in(M(sx, 0, -0.55), () => {
      g.surf(K_WOOD, 0.85);
      for (const [x, z, h] of [[-0.58, -0.6, 1.7], [0.58, -0.6, 1.7], [-0.58, 0.55, 1.35], [0.58, 0.55, 1.35]]) g.in(M(x, h / 2, z), () => g.cbox(0.06, h, 0.06, 0.01, woodTint(rgb(0x6a4a2c), x * 9 + z + k)));
      for (const [z, h] of [[-0.6, 1.66], [0.55, 1.31]]) g.in(M(0, h, z), () => g.beam(1.22, 0.06, 0.06, 0.01, woodTint(rgb(0x5a3a22), z + k), 2));
      canopy(g, [-0.66, 1.74, -0.66], [0.66, 1.74, -0.66], [0.66, 1.38, 0.7], [-0.66, 1.38, 0.7], c1, c2, 6, 0.06, k);
      // the counter
      g.surf(K_WOOD, 0.85); g.in(M(0, 0.36, 0.42), () => g.cbox(1.1, 0.06, 0.34, 0.01, woodTint(rgb(0x7a5a38), k))); g.in(M(0, 0.17, 0.42), () => g.cbox(1.06, 0.34, 0.3, 0.01, woodTint(rgb(0x5a3a22), k + 5)));
      g.surf(K_CLOTH, 0.9); g.in(M(0, 0.25, 0.58), () => g.cbox(1.08, 0.3, 0.01, 0.002, (x, y) => (Math.abs(tri1(x * 6) - 0.5) < 0.12 ? c2 : c1)));
      if (k === 0) {
        // carpets: hanging over the back rail, folded on the counter, rolled in a stack
        for (let i = 0; i < 3; i++) g.in(M(-0.36 + i * 0.36, 1.6, -0.56), () => { g.surf(K_CLOTH, 0.95); g.sheet(4, 8, (u, v) => [(u - 0.5) * 0.32, -v * 1.2, 0.02 + 0.015 * Math.sin(v * 9 + i)], carpetCol([rgb(0x8a1a2a), rgb(0x2a3a7a), rgb(0x6a2a1a)][i], [rgb(0xd8b03a), rgb(0xe8d8b0), rgb(0x2a6a5a)][i], [rgb(0x2a6a8a), rgb(0xc82a3a), rgb(0xd8b03a)][i])); });
        for (let i = 0; i < 3; i++) g.in(M(-0.3 + i * 0.03, 0.42 + i * 0.03, 0.42, 0, 0, 0), () => { g.surf(K_CLOTH, 0.95); g.cbox(0.42, 0.03, 0.3, 0.008, (x, y, z) => mul([rgb(0xa82a3a), rgb(0x2a4a8a), rgb(0xc88a3a)][i], 0.8 + 0.2 * Math.abs(Math.sin(x * 40)))); });
        for (let i = 0; i < 4; i++) g.in(M(0.3, 0.42 + (i < 3 ? 0.06 : 0.17), 0.3 + (i % 3) * 0.11 - (i === 3 ? -0.05 : 0), 0, 0, 90), () => g.in(M(0, -0.25, 0), () => { g.surf(K_CLOTH, 0.95); g.cyl(0.055, 0.055, 0.5, nq(10), (x, y, z) => mul([rgb(0x8a1a2a), rgb(0xd8b03a), rgb(0x2a6a5a), rgb(0x6a2a6a)][i], 0.8 + 0.25 * Math.abs(Math.sin(y * 30))), true, true); }));
      } else if (k === 1) {
        // spices: baskets heaped with coloured powder, sacks with their mouths rolled down
        const SPICE = sw(0xc83a1a, 0xe8b02a, 0xd87a2a, 0x7a4a2a, 0x8a9a3a, 0xa82a5a);
        for (let i = 0; i < 6; i++) { const x = -0.42 + (i % 3) * 0.42, z = 0.32 + Math.floor(i / 3) * 0.16; g.in(M(x, 0.39, z), () => { g.surf(K_CLOTH, 0.9); g.lathe([[0.06, 0], [0.12, 0.04], [0.13, 0.08]], nq(10), weaveCol(P.raffia, 40)); g.surf(K_PLAIN, 1); g.lathe([[0.125, 0.07], [0.08, 0.12], [0, 0.17]], nq(10), (px, py, pz) => mul(SPICE[i], 0.85 + 0.25 * noise3(px * 40, py * 40, pz * 40))); }); }
        for (let i = 0; i < 4; i++) g.in(M(-0.45 + i * 0.3, 0, -0.25), () => { sack(g, 0.85, rgb(0xc8b080), i); g.surf(K_PLAIN, 1); g.in(M(0, 0.32, 0), () => g.cyl(0.11, 0.0, 0.07, nq(8), SPICE[(i + 2) % 6], false, false)); });
        g.in(M(0.45, 1.2, 0.35), () => { chain(g, [[0, 0.35, 0], [0, 0.05, 0]], 0.025, P.gGold); g.surf(K_PLAIN, 0.3, 0.9); g.cbox(0.3, 0.012, 0.012, 0.002, P.gGold); for (const e of [-1, 1]) g.in(M(e * 0.14, -0.14, 0), () => { rope(g, [[0, 0.14, 0], [0, 0, 0]], 0.004, P.gGold, 3); g.surf(K_PLAIN, 0.3, 0.9); g.lathe([[0, 0], [0.06, 0.02], [0.07, 0.03]], nq(10), P.gGold); }); });
      } else {
        // lamps and pottery: brass lanterns lit on the rail, jars and dishes on the counter and floor
        for (let i = 0; i < 4; i++) g.in(M(-0.45 + i * 0.3, 1.36 + (i % 2) * 0.12, -0.1 + (i % 2) * 0.2), () => { chain(g, [[0, 0.3 - (i % 2) * 0.12, 0], [0, 0.0, 0]], 0.02, P.gGold); lamp(g, 0.65, [1.0, 0.75, 0.35], { shape: i % 2 ? 'cage' : 'orb', frame: P.gGold, glow: 0.9 }); });
        for (let i = 0; i < 4; i++) g.in(M(-0.4 + i * 0.26, 0.39, 0.42), () => jar(g, 0.18 + 0.06 * (i % 2), [rgb(0xb86a3a), P.gTurq, rgb(0xd8c8a0), rgb(0x2a5a8a)][i], { stripe: P.gGold, rough: 0.4 }));
        for (let i = 0; i < 3; i++) g.in(M(-0.3 + i * 0.32, 0, -0.2), () => jar(g, 0.38 - 0.06 * i, rgb(0xa8643a), { stripe: rgb(0x3a2a1a), stripe2: P.gTurq }));
      }
    });
  });
  // the shade over the lane: a long silk sheet slung between tall poles at the front and the stall roofs
  g.surf(K_WOOD, 0.85);
  for (const x of [-1.9, 0, 1.9]) g.in(M(x, 1.0, 1.35), () => g.cbox(0.07, 2.0, 0.07, 0.01, woodTint(rgb(0x6a4a2c), x)));
  for (const x of [-1.9, 0, 1.9]) g.in(M(x, 2.02, 1.35), () => { g.surf(K_PLAIN, 0.3, 0.9); g.lathe([[0.05, 0], [0.06, 0.04], [0, 0.12]], 8, P.gGold); });
  for (const e of [-1, 1]) canopy(g, [e * 1.9, 2.0, 1.35], [0, 2.0, 1.35], [0, 1.72, 0.12], [e * 1.9, 1.72, 0.12], e > 0 ? rgb(0xe8d8a0) : rgb(0xc82a3a), e > 0 ? P.gTurq : rgb(0xe8d8a0), 5, 0.12, e + 9);
  // a bench, a brass coffee pot and cups on a tray; a cushion
  g.in(M(-0.7, 0, 1.0, 0, 10, 0), () => { g.surf(K_WOOD, 0.85); g.in(M(0, 0.2, 0), () => g.cbox(0.6, 0.05, 0.24, 0.01, woodTint(rgb(0x6a4a2c), 2))); for (const e of [-1, 1]) g.in(M(e * 0.25, 0.1, 0), () => g.cbox(0.05, 0.2, 0.2, 0.01, woodTint(rgb(0x5a3a22), e))); g.in(M(-0.1, 0.27, 0), () => { g.surf(K_CLOTH, 0.95); g.add(new THREE.SphereGeometry(0.13, 10, 6).scale(1, 0.35, 0.8), rgb(0x8a1a2a)); }); });
  g.in(M(0.7, 0, 0.95), () => { g.surf(K_PLAIN, 0.3, 0.9); g.cyl(0.24, 0.24, 0.02, nq(16), P.gGold, true, true); g.in(M(0, 0.02, 0), () => { g.lathe([[0.06, 0], [0.07, 0.06], [0.04, 0.12], [0.03, 0.16], [0.05, 0.2], [0, 0.24]], nq(10), P.gGold); g.tube([[0.05, 0.08, 0], [0.12, 0.14, 0], [0.15, 0.18, 0]], 0.008, 4, P.gGold); for (let k = 0; k < 4; k++) g.in(M(Math.cos(k * 1.57 + 0.6) * 0.15, 0, Math.sin(k * 1.57 + 0.6) * 0.15), () => { g.surf(K_PLAIN, 0.4); g.lathe([[0, 0], [0.025, 0.004], [0.03, 0.04]], 8, P.gWhite); }); }); });
}

// =====================================================================================================
// exports
// =====================================================================================================
// id: [footprint along X, along Z, builder]. A piece that arrives with its footprint the other way round is the
// same geometry turned a quarter. A builder is make(g, fog): fog takes the soft see-through parts.
const BUILDERS = {
  balor_basaltCrag: [5, 4, basaltCrag], balor_fogStones: [3, 3, fogStones],
  kurgan_wagonYurt: [4, 3, wagonYurt], kurgan_burialMound: [4, 4, burialMound],
  hearthmoot_burrow: [3, 3, burrow], hearthmoot_watermill: [3, 3, watermill],
  baobab_baobabTree: [3, 3, baobabTree], baobab_grassDome: [2, 2, grassDome],
  nagavar_serpentTemple: [5, 5, serpentTemple], nagavar_bloodWell: [3, 3, bloodWell],
  pearlfleet_lighthouse: [2, 2, pearlLighthouse], pearlfleet_amphitheatre: [4, 4, amphitheatre],
  glimmer_observatory: [3, 3, observatory], glimmer_windmillLab: [3, 3, windmillLab],
  khanate_skullTower: [2, 2, skullTower], khanate_winterCamp: [4, 4, winterCamp],
  emerald_sunTemple: [4, 4, sunTemple], emerald_riverCitadel: [5, 5, riverCitadel],
  deeproot_nestTree: [3, 3, nestTree], deeproot_spiritTotem: [1, 1, spiritTotem],
  goldsands_palace: [5, 5, palace], goldsands_souk: [4, 3, souk],
};
let fogMat = null, fogDepth = null;
/** the translucent copy of the sculpt material that fog and spray are drawn with (and a depth material that casts no shadow) */
function fogMaterial() {
  if (!fogMat) {
    fogMat = sculptMaterial().clone();
    fogMat.transparent = true; fogMat.opacity = 0.3; fogMat.depthWrite = false;
    fogDepth = new THREE.MeshDepthMaterial({ transparent: true, opacity: 0, alphaTest: 0.5 });
  }
  return fogMat;
}
const built = new Map();
function landmark(id, w, h) {
  const [W, H, make] = BUILDERS[id], turn = W !== H && Number.isFinite(w) && Number.isFinite(h) && w !== h && (w < h) !== (W < H);
  const k = `${id}|${getDetail()}`;
  if (!built.has(k)) {
    const g = new Geo(), f = new Geo();
    make(g, f);
    built.set(k, { geo: g.build(), fog: f.n ? f.build() : null, turned: null });
  }
  const c = built.get(k);
  if (turn && !c.turned) c.turned = { geo: c.geo.clone().rotateY(Math.PI / 2), fog: c.fog ? c.fog.clone().rotateY(Math.PI / 2) : null };
  const src = turn ? c.turned : c;
  const m = meshOf(src.geo);
  if (src.fog) {
    const fm = new THREE.Mesh(src.fog, fogMaterial());
    fm.customDepthMaterial = fogDepth; fm.castShadow = false; fm.receiveShadow = false; fm.renderOrder = 2;
    m.add(fm);
  }
  return m;
}
/** every landmark of the fringe realms */
export const structures = Object.fromEntries(Object.keys(BUILDERS).map((id) => [id, (def, w, h, place) => landmark(id, w, h)]));
