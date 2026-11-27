// Faction buildings: thirty-three looks for every existing building, and eighteen buildings of the factions' own.
//
//   restyle(model, style, key)              -> the building re-dressed for a faction ('kingdom' returns it unchanged)
//       the six monster styles    goblin undead infernal beasts elemental dragons
//       the twenty-seven realms   graal aurelia aethel kaelneth verdant grom xibalba velikaya tianlong ironbound screaming
//                                 cloven fimbul ashur greenhide skar crimson khemet drowned gorge westmark principalities
//                                 sunkings caliphate shogunate mistisles thousandgods
//   structures[def.model](def, w, h, place) -> Object3D centred on its footprint, resting on y = 0
//       goblin     scrapHut warDrum brewery        undead   crypt boneSpire charnel
//       infernal   forge obelisk pitGate           beasts   yurt totem bonePit
//       elemental  crystalSpire monolith stoneRing dragons  nest perch hoard
//
// Built like civic.js and with the same construction kit (repeated here because that module keeps it private):
// everything is emitted into one vertex-coloured geometry for the shared sculpt material, built once per model,
// size, colour and detail preset; every placement shares it. Nothing is built at module load and nothing here
// calls Math.random(): every shape is seeded.
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

// =====================================================================================================
// Restyle: any finished building re-dressed for a faction
// =====================================================================================================
const LEVELS = [0.8, 1.6, 2.4];
// pieces that butt against their neighbours: no lean, and nothing sideways at their ends
const LINKED = new Set(['wall', 'castleWall', 'castleTower', 'castleGate', 'stairs', 'palisade', 'gate', 'terrace', 'terraceHigh', 'walkway', 'stoneBridge', 'viaduct', 'rail', 'deck', 'dock', 'barricade', 'sandbags', 'bridge']);
// pieces that are all walk surface: no ornaments
const BARE = new Set(['rail', 'walkway', 'stoneBridge', 'viaduct', 'terrace', 'terraceHigh', 'deck', 'dock', 'stairs', 'bridge', 'garden', 'graveyard']);
const C_STONE = 0, C_PLASTER = 1, C_TIMBER = 2, C_RED = 3, C_SLATE = 4, C_MOSS = 5, C_GOLD = 6, C_IRON = 7, C_GLOW = 8, C_GLASS = 9, C_DARK = 10, C_OTHER = 11, C_LIQUID = 12;
/** what a vertex is made of, judged from its baked colour and finish */
function classify(r, g, b, rough, metal, glow) {
  if (glow > 0.3) return C_GLOW;
  const R = Math.sqrt(r), G = Math.sqrt(g), B = Math.sqrt(b), mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, sat = mx > 1e-4 ? d / mx : 0;
  if (metal > 0.5) return mx > 0.4 && sat > 0.3 ? C_GOLD : C_IRON;
  if (rough < 0.3) return mx < 0.5 ? C_GLASS : C_LIQUID;
  if (mx < 0.1) return C_DARK;
  if (sat < 0.16) return C_STONE;
  let hue = mx === R ? (G - B) / d : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  hue *= 60; if (hue < 0) hue += 360;
  if (hue >= 62 && hue < 175) return sat > 0.22 ? C_MOSS : C_STONE;
  if (hue >= 185 && hue < 265) return sat > 0.2 ? C_SLATE : C_STONE;
  if (hue < 22.5 || hue >= 340) return sat > 0.42 ? C_RED : sat > 0.28 ? C_TIMBER : C_STONE;
  if (hue < 62) return sat >= 0.38 || (sat >= 0.28 && mx < 0.6) ? C_TIMBER : sat >= 0.24 && mx >= 0.55 ? C_PLASTER : C_STONE;
  return C_OTHER;
}
const sw = (...hex) => hex.map((h) => rgb(h));
const tri1 = (v) => Math.abs(v - Math.floor(v) - 0.5) * 2;   // triangle wave 0..1: folds a surface into flat facets
/**
 * The looks. pal[class] = [swatches, patch frequency, contrast, floor, ceiling]; trim = stone that stands lighter
 * than the rest (copings, quoins, bands); fx(...) touches up a vertex after the remap; disp(...) moves it; drop(...)
 * tears triangles out of a roof.
 *
 * The realm styles (added to this table further down) may also carry:
 *   pal.roof    the palette of everything found to be roof tile, whatever colour it was
 *   joint       [r, g, b, strength]: mortar colour for the joints of stone (brick reads as brick by its pale joints)
 *   roof        { main, cap }: how the roofs are re-covered. main = the roofs of halls and houses, cap = the cones on
 *               turrets; each is { kind: 'keep' | 'gables' | 'drape' | 'hip' | 'flat' | 'dome' | 'step' | 'hull' |
 *               'shikhara' | 'cap', ... } (see ROOFS); left out or 'keep', the old roof stays and is re-coloured
 *   by          { humble | grand | plain | <model id>: overrides }: the style as it applies to one kind of building
 *               (pal and roof merge key by key): cottages thatched while keeps stay slated, and so on
 * and their fx and disp find more on the context k: k.roof (the vertex is roof tile), k.rel (its brightness within its
 * material: low in joints), k.nx / k.nz (its normal); disp also k.cls, k.vnx, k.vny, k.vnz.
 */
const STYLES = {
  goblin: {
    glow: [1.0, 0.62, 0.12], window: 0.4,
    pal: { [C_STONE]: [sw(0x6e6248, 0x5d5540, 0x7a6a4a, 0x66604e), 1.4, 0.9, 0.4, 1.5], [C_PLASTER]: [sw(0x9c8450, 0x8a7444, 0xa8905a, 0x7d6c40), 1.7, 0.8, 0.5, 1.35], [C_TIMBER]: [sw(0x6b5236, 0x8a7448, 0x4d4230, 0x5c5a34, 0x7a4a2c, 0x94805a), 3.1, 0.9, 0.4, 1.7],
      [C_RED]: [sw(0xa8843e, 0x8f6e36, 0xb89a55, 0x7a5c30, 0x9a7a3a), 2.6, 0.7, 0.5, 1.5], [C_SLATE]: [sw(0x8a6a3a, 0x6e6a40, 0x94502a, 0x7a6038), 2.6, 0.7, 0.5, 1.5], [C_MOSS]: [sw(0x4e5a26, 0x5c5a2a), 2, 0.8, 0.5, 1.5],
      [C_GOLD]: [sw(0x9a5424, 0xa8642c), 3, 0.6, 0.6, 1.4], [C_IRON]: [sw(0x4a2c1a, 0x38281e, 0x5e3a20), 3, 0.5, 0.6, 1.6], [C_OTHER]: [sw(0xa83a2a, 0xc8a83a, 0x2f6a5a), 1.5, 0.6, 0.5, 1.4] },
    fx(cls, x, y, z, ny, c, a, ctx) {
      if (cls === C_PLASTER || cls === C_STONE) { // crude paint: handprints and slashes of red and yellow
        const n = noise3(x * 1.9 + ctx.s1, y * 2.6, z * 1.9 + ctx.s2), m = noise3(x * 7 + 3, y * 7, z * 7);
        if (y > 0.35 && n > 0.66 && m > 0.38) { const p = noise3(x * 0.6 + ctx.s2, y * 0.6, z * 0.6) > 0.5 ? [0.42, 0.045, 0.03] : [0.62, 0.42, 0.05]; c[0] = lerp(c[0], p[0], 0.8); c[1] = lerp(c[1], p[1], 0.8); c[2] = lerp(c[2], p[2], 0.8); }
      } else if (cls === C_IRON || cls === C_GOLD) { a[0] = 0.85; a[1] = 0.45; }
    },
    disp(x, y, z, k, o) {
      const hf = y / k.H, top = smooth(0.42, 1, hf), n1 = noise3(y * 0.85 + k.s1, z * 0.45, 3.3) - 0.5, n2 = noise3(x * 0.45, y * 0.85 + k.s2, 7.1) - 0.5;
      const lean = k.linked ? 0 : 0.085 * (1 + 0.5 * hf) * y * (k.Ha / k.H), tw = k.linked ? 0 : 0.1 * hf * (k.s3 > 0.5 ? 1 : -1), rx = x - k.cx, rz = z - k.cz;
      o[0] = Math.cos(k.th) * lean + n1 * 0.2 * hf - rz * tw;
      o[1] = -0.17 * k.Ha * top * (0.45 + 0.55 * Math.cos(k.ul(x, z) * 1.35)) * (0.5 + noise3(x * 0.6 + k.s1, 2, z * 0.6)) + 0.16 * k.Ha * top * (noise3(x * 1.0 + k.s2, 5, z * 1.0) - 0.5);
      o[2] = Math.sin(k.th) * lean + n2 * 0.2 * hf + rx * tw;
    },
    drop: (cls, x, y, z, k) => (cls === C_RED || cls === C_SLATE) && noise3(x * 2.9 + k.s1, y * 2.9, z * 2.9 + k.s2) > 0.83,
  },
  undead: {
    glow: GHOST, window: 1.1,
    pal: { [C_STONE]: [sw(0x25262c, 0x1e1f25, 0x2c2c33, 0x23282a), 1.2, 1.0, 0.35, 1.7], [C_PLASTER]: [sw(0x7f837a, 0x8a8c80, 0x70766e), 1.3, 0.9, 0.5, 1.3], [C_TIMBER]: [sw(0x464e40, 0x3a4238, 0x525848, 0x40463a), 2.2, 0.9, 0.4, 1.6],
      [C_RED]: [sw(0x1d1b23, 0x27232d, 0x18181d, 0x2a2a30), 2.6, 0.8, 0.5, 1.6], [C_SLATE]: [sw(0x1d1b23, 0x25222c, 0x18181d), 2.6, 0.8, 0.5, 1.6], [C_MOSS]: [sw(0x3c4a30, 0x2e3a2a), 2, 0.8, 0.5, 1.4],
      [C_GOLD]: [sw(0xd0c8ac, 0xbcb294), 3, 0.5, 0.7, 1.3], [C_IRON]: [sw(0x16171a, 0x1e1f22), 3, 0.5, 0.6, 1.6], [C_OTHER]: [sw(0x4a4a50, 0x5a5560, 0x3c4440), 1.5, 0.6, 0.5, 1.3] },
    trim: [mul(BONE, 0.9)],
    fx(cls, x, y, z, ny, c, a, ctx) {
      if (cls === C_GOLD) { a[0] = 0.7; a[1] = 0; }
      if (cls === C_STONE || cls === C_PLASTER) { // green rot creeping up from the ground, pale streaks running down from the top
        const rot = smooth(0.9, 0.1, y) * smooth(0.4, 0.7, noise3(x * 2.4 + ctx.s1, y * 1.5, z * 2.4)) * 0.6;
        c[0] = lerp(c[0], 0.05, rot); c[1] = lerp(c[1], 0.13, rot); c[2] = lerp(c[2], 0.04, rot);
        const st = smooth(0.7, 0.92, noise3(x * 6.5 + 2, y * 0.4, z * 6.5 + ctx.s2)) * smooth(0.3, 0.9, y / ctx.H) * 0.4;
        c[0] = lerp(c[0], 0.42, st); c[1] = lerp(c[1], 0.42, st); c[2] = lerp(c[2], 0.36, st);
      }
    },
    disp(x, y, z, k, o) {
      const hf = y / k.H, top = smooth(0.5, 1, hf), bite = smooth(0.48, 0.74, fbm3(x * 1.25 + k.s1, y * 0.7, z * 1.25 + k.s2, 2));
      const rx = x - k.cx, rz = z - k.cz, lean = k.linked ? 0 : 0.03 * y * (k.Ha / k.H);
      o[0] = Math.cos(k.th) * lean - rx * 0.1 * bite * top;
      o[1] = -k.Ha * top * (0.2 * bite * top + 0.07 * (0.4 + noise3(x * 0.55 + k.s2, 1, z * 0.55)));
      o[2] = Math.sin(k.th) * lean - rz * 0.1 * bite * top;
    },
    drop: (cls, x, y, z, k) => (cls === C_RED || cls === C_SLATE) && fbm3(x * 2.1 + k.s2, y * 2.1, z * 2.1 + k.s1, 2) > 0.63,
  },
  infernal: {
    glow: EMBER, window: 1.2,
    pal: { [C_STONE]: [sw(0x1e181c, 0x191417, 0x40140f, 0x241b1f, 0x521a12), 1.1, 1.0, 0.4, 1.7], [C_PLASTER]: [sw(0x5a1a13, 0x4a1510, 0x66201a), 1.2, 0.9, 0.5, 1.3], [C_TIMBER]: [sw(0x1c1512, 0x241a14, 0x16110f), 2.2, 0.9, 0.5, 1.7],
      [C_RED]: [sw(0x221a1c, 0x1a1416, 0x2c1c1a, 0x3a1612), 2.6, 0.8, 0.5, 1.6], [C_SLATE]: [sw(0x221a1c, 0x1a1416, 0x2c1c1a), 2.6, 0.8, 0.5, 1.6], [C_MOSS]: [sw(0x3a1410, 0x2a1512), 2, 0.8, 0.5, 1.4],
      [C_GOLD]: [sw(0xc89432, 0xb8862e), 3, 0.7, 0.6, 1.4], [C_IRON]: [sw(0x8a6424, 0x9a7028, 0x6e5220), 3, 0.5, 0.7, 1.5], [C_OTHER]: [sw(0x7a1a12, 0x5a1410, 0x2a1a1a), 1.5, 0.6, 0.5, 1.3] },
    fx(cls, x, y, z, ny, c, a, ctx) {
      if (cls === C_IRON) { a[0] = 0.4; a[1] = 0.9; }
      if (cls === C_RED || cls === C_SLATE || cls === C_STONE || cls === C_PLASTER) { // seams of fire
        const roof = cls === C_RED || cls === C_SLATE, v = Math.abs(noise3(x * 1.7 + ctx.s1, y * 1.7, z * 1.7 + ctx.s2) - 0.5), e = smooth(roof ? 0.035 : 0.016, 0.004, v) * (roof ? 1 : smooth(0.2, 0.8, noise3(x * 0.5, y * 0.5 + ctx.s2, z * 0.5)));
        if (e > 0.05) { c[0] = lerp(c[0], 1.0, e); c[1] = lerp(c[1], 0.26, e); c[2] = lerp(c[2], 0.02, e); a[2] = Math.max(a[2], 1.3 * e); }
      }
    },
    disp(x, y, z, k, o) {
      const hf = y / k.H, top = smooth(0.5, 1, hf), n = 1 - Math.abs(2 * noise3(x * 1.5 + k.s1, y * 0.35, z * 1.5 + k.s2) - 1), rx = x - k.cx, rz = z - k.cz, pinch = k.linked ? 0 : 0.13 * top * top;
      o[0] = -rx * pinch + (noise3(y * 1.8 + k.s1, z * 0.6, 1) - 0.5) * 0.07 * hf;
      o[1] = k.Ha * top * top * (0.3 * n * n * n + 0.08);
      o[2] = -rz * pinch + (noise3(x * 0.6, y * 1.8 + k.s2, 4) - 0.5) * 0.07 * hf;
    },
  },
  beasts: {
    glow: [1.0, 0.5, 0.1], window: 0.3,
    pal: { [C_STONE]: [sw(0x7c705c, 0x6e6452, 0x887a60, 0x625a4c), 1.2, 0.9, 0.4, 1.5], [C_PLASTER]: [sw(0xa88a5e, 0x9a7c52, 0xb4986a, 0x8c7048), 1.5, 0.8, 0.5, 1.35], [C_TIMBER]: [sw(0x94744a, 0x846840, 0xa08252, 0x7a5e3a), 2.4, 0.9, 0.4, 1.6],
      [C_RED]: [sw(0x7a5e38, 0x6a5030, 0x886a40, 0x5e4a30, 0x8f7448), 2.3, 0.7, 0.5, 1.5], [C_SLATE]: [sw(0x6e5a3c, 0x5e5034, 0x7a6644), 2.3, 0.7, 0.5, 1.5], [C_MOSS]: [sw(0x4f6a2e, 0x5a7434, 0x445c28), 2, 0.8, 0.5, 1.5],
      [C_GOLD]: [sw(0xe0d6bc, 0xd0c4a4), 3, 0.5, 0.7, 1.25], [C_IRON]: [sw(0xc8bc9c, 0xb4a888, 0x8a7e66), 3, 0.5, 0.6, 1.4], [C_OTHER]: [sw(0x9a3a24, 0x8a6a42, 0xd8cdb0), 1.5, 0.6, 0.5, 1.3] },
    fx(cls, x, y, z, ny, c, a, ctx) {
      if (cls === C_GOLD || cls === C_IRON) { a[0] = 0.75; a[1] = 0; }
      if (ny > 0.15 && cls !== C_GLOW && cls !== C_GLASS) { // moss on everything that faces the sky
        const m = smooth(0.52, 0.72, noise3(x * 1.5 + ctx.s1, y * 1.5, z * 1.5 + ctx.s2)) * smooth(0.15, 0.6, ny) * 0.75;
        c[0] = lerp(c[0], 0.085, m); c[1] = lerp(c[1], 0.15, m); c[2] = lerp(c[2], 0.035, m);
      }
      if (cls === C_PLASTER || cls === C_STONE) { // a painted band of red ochre teeth
        const hf = y / ctx.H, band = smooth(0.34, 0.36, hf) * smooth(0.47, 0.45, hf);
        if (band > 0 && tri1((x + z) * 1.6) > (hf - 0.34) / 0.13) { c[0] = lerp(c[0], 0.3, band * 0.85); c[1] = lerp(c[1], 0.045, band * 0.85); c[2] = lerp(c[2], 0.02, band * 0.85); }
      }
    },
    disp(x, y, z, k, o) {
      const hf = y / k.H, b = 0.13 * Math.sin(Math.PI * clamp(hf * 1.15, 0, 1)) + 0.1 * (noise3(x * 0.8 + k.s1, y * 0.8, z * 0.8 + k.s2) - 0.5), rx = x - k.cx, rz = z - k.cz, top = smooth(0.5, 1, hf);
      const r2 = Math.min(1, (rx * rx) / (k.hx * k.hx) + (rz * rz) / (k.hz * k.hz));
      o[0] = k.linked && !k.ax ? 0 : rx * b; o[2] = k.linked && k.ax ? 0 : rz * b;
      o[1] = -0.12 * k.Ha * top * r2 + 0.07 * k.Ha * top * (noise3(x * 0.9 + k.s2, 3, z * 0.9) - 0.5);
    },
  },
  elemental: {
    glow: FROST, window: 1.0,
    pal: { [C_STONE]: [sw(0x9fb0c2, 0x8ea0b6, 0xaebccc, 0x8496ac, 0x98a8c6), 1.1, 0.9, 0.45, 1.4], [C_PLASTER]: [sw(0xc4d2de, 0xb4c4d4, 0xd0dae4), 1.2, 0.8, 0.5, 1.25], [C_TIMBER]: [sw(0x56687c, 0x4a5c70, 0x627488), 2.2, 0.9, 0.4, 1.6],
      [C_RED]: [sw(0x2f4aa8, 0x3a58b8, 0x28409a, 0x4a4ab0, 0x2f66b4), 2.4, 0.7, 0.5, 1.6], [C_SLATE]: [sw(0x2f4aa8, 0x3a58b8, 0x28409a, 0x4a4ab0), 2.4, 0.7, 0.5, 1.6], [C_MOSS]: [sw(0x4fa8b8, 0x5fb8c4), 2, 0.8, 0.5, 1.4],
      [C_GOLD]: [sw(0xc8e4f0, 0xa8d4ec), 3, 0.6, 0.7, 1.3], [C_IRON]: [sw(0x7a8ea6, 0x8a9eb4), 3, 0.5, 0.7, 1.5], [C_OTHER]: [sw(0x6a5ad0, 0x4a8ad8, 0x9fb0c2), 1.5, 0.6, 0.5, 1.3] },
    fx(cls, x, y, z, ny, c, a, ctx) {
      if (cls === C_RED || cls === C_SLATE) { a[0] = 0.22; a[1] = 0.25; a[2] = Math.max(a[2], 0.22); }
      if (cls === C_STONE || cls === C_PLASTER) { // veins of light running through the stone
        const v = Math.abs(noise3(x * 1.3 + ctx.s1, y * 1.3, z * 1.3 + ctx.s2) - 0.5), e = smooth(0.012, 0.002, v) * smooth(0.3, 0.7, noise3(x * 0.45 + ctx.s2, y * 0.45, z * 0.45));
        if (e > 0.05) { c[0] = lerp(c[0], 0.2, e); c[1] = lerp(c[1], 0.7, e); c[2] = lerp(c[2], 1.0, e); a[2] = Math.max(a[2], 1.4 * e); }
      }
    },
    disp(x, y, z, k, o) {
      const hf = y / k.H, top = smooth(0.45, 1, hf);
      o[0] = 0.07 * (tri1(z * 0.9 + k.s1) + tri1(y * 0.75 + k.s2) - 1) * smooth(0, 0.3, hf);
      o[1] = k.Ha * top * (0.2 * top * tri1((x + z) * 0.55 + k.s1) + 0.05);
      o[2] = 0.07 * (tri1(x * 0.9 + k.s2) + tri1(y * 0.75 + k.s1) - 1) * smooth(0, 0.3, hf);
      if (k.linked) { if (k.ax) o[2] = 0; else o[0] = 0; }
    },
  },
  dragons: {
    glow: DRAKE, window: 0.7,
    pal: { [C_STONE]: [sw(0x36312f, 0x2c2827, 0x3e3632, 0x302a2a), 1.1, 1.0, 0.4, 1.6], [C_PLASTER]: [sw(0x6e5c48, 0x62513f, 0x7a6650), 1.3, 0.8, 0.5, 1.3], [C_TIMBER]: [sw(0x2c2019, 0x241a15, 0x34261d), 2.2, 0.9, 0.45, 1.7],
      [C_RED]: [sw(0x8a2a1a, 0x9a3a1e, 0x6e2216, 0xa84a24, 0x7a2a20), 2.8, 0.7, 0.55, 1.6], [C_SLATE]: [sw(0x8a2a1a, 0x9a3a1e, 0x6e2216, 0x7a2a20), 2.8, 0.7, 0.55, 1.6], [C_MOSS]: [sw(0x4a3a22, 0x3a3020), 2, 0.8, 0.5, 1.4],
      [C_GOLD]: [sw(0xe6b030, 0xd8a028), 3, 0.7, 0.7, 1.4], [C_IRON]: [sw(0xd8a02c, 0xc89028, 0xb07a22), 3, 0.5, 0.75, 1.5], [C_OTHER]: [sw(0x8a2a1a, 0xc89028, 0x3a302c), 1.5, 0.6, 0.5, 1.3] },
    trim: [mul(GOLD, 0.7)],
    fx(cls, x, y, z, ny, c, a, ctx) {
      if (cls === C_IRON) { a[0] = 0.35; a[1] = 0.95; }
      if (cls === C_RED || cls === C_SLATE) { // overlapping scales, each with a bright edge
        const d = cells3(x * 4.2 + ctx.s1, y * 4.2, z * 4.2 + ctx.s2), k = 0.62 + 0.75 * smooth(0.1, 0.5, d);
        c[0] *= k; c[1] *= k; c[2] *= k; a[0] = 0.45;
        if (d > 0.52) { c[0] = lerp(c[0], 0.75, 0.35); c[1] = lerp(c[1], 0.35, 0.35); a[1] = 0.35; }
      }
    },
    disp(x, y, z, k, o) {
      const hf = y / k.H, top = smooth(0.45, 1, hf), u = k.ul(x, z), sweep = k.linked ? 0 : 0.12 * k.Ha * top * top, rx = x - k.cx, rz = z - k.cz, e = Math.pow(Math.abs(u) / 1.5708, 2.2);
      o[0] = (k.ax ? 0 : sweep) - (k.ax || k.linked ? rx * 0.12 * top * top : 0);
      o[1] = k.Ha * top * (0.24 * e + 0.05) - 0.05 * k.Ha * top * (1 - e);
      o[2] = (k.ax ? sweep : 0) - (!k.ax || k.linked ? rz * 0.12 * top * top : 0);
      if (k.linked) { if (k.ax) o[2] *= 0.4; else o[0] *= 0.4; }
    },
  },
};

const restyled = new Map();
/** the meshes of a building with their transforms relative to its root: main (sculpt material) and the rest (side colours) */
function partsOf(model) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert(), main = [], other = [], base = sculptMaterial();
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    (o.material === base && o.name !== 'colours' && o.geometry.attributes.color && o.geometry.attributes.aPbr ? main : other).push({ mesh: o, m });
  });
  return { main, other };
}
/**
 * restyle(model, style, key) -> the building in a faction's look: palette remapped by material, shape pushed about by
 * a smooth seeded field, its roofs re-covered where the style has roofs of its own, the faction's ornaments added.
 * `key` names the source geometry (model id first, then size,
 * colour and detail); results are cached per key and style and every call returns a new object sharing that geometry.
 * 'kingdom' and unknown styles return the model itself, as does scenery that picks its own variant when placed.
 */
export function restyle(model, style, key) {
  const st = STYLES[style];
  if (!st || !model || Object.prototype.hasOwnProperty.call(model, 'updateMatrixWorld')) return model;
  const parts = partsOf(model);
  if (!parts.main.length) return model;
  const ck = `${key}|${style}|${getDetail()}`;
  if (!restyled.has(ck)) restyled.set(ck, buildRestyle(parts, st, style, String(key)));
  const e = restyled.get(ck), root = new THREE.Group();
  root.name = model.name; root.position.copy(model.position); root.quaternion.copy(model.quaternion); root.scale.copy(model.scale);
  Object.assign(root.userData, model.userData);
  root.add(meshOf(e.geo));
  e.others.forEach((geo, i) => {
    const src = parts.other[i];
    if (!src) return;
    const m = new THREE.Mesh(geo, src.mesh.material);
    m.name = src.mesh.name; m.castShadow = src.mesh.castShadow; m.receiveShadow = src.mesh.receiveShadow;
    root.add(m);
  });
  return root;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function buildRestyle(parts, st0, style, key) {
  // ---- gather the main meshes into one set of arrays, in the root's space ----
  let n = 0, ni = 0;
  for (const { mesh } of parts.main) { const g = mesh.geometry; n += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), A = new Float32Array(n * 3), I = new Uint32Array(ni);
  let vo = 0, io = 0;
  const v3 = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { mesh, m } of parts.main) {
    const g = mesh.geometry, p = g.attributes.position, nr = g.attributes.normal, col = g.attributes.color, pb = g.attributes.aPbr, cnt = p.count;
    nm.getNormalMatrix(m);
    for (let i = 0; i < cnt; i++) {
      const o = (vo + i) * 3;
      v3.fromBufferAttribute(p, i).applyMatrix4(m); P[o] = v3.x; P[o + 1] = v3.y; P[o + 2] = v3.z;
      if (nr) { v3.fromBufferAttribute(nr, i).applyMatrix3(nm).normalize(); N[o] = v3.x; N[o + 1] = v3.y; N[o + 2] = v3.z; } else N[o + 1] = 1;
      C[o] = col.getX(i); C[o + 1] = col.getY(i); C[o + 2] = col.getZ(i);
      A[o] = pb.getX(i); A[o + 1] = pb.getY(i); A[o + 2] = pb.getZ(i);
    }
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) I[io + i] = ix[i] + vo; io += ix.length; } else { for (let i = 0; i < cnt; i++) I[io + i] = vo + i; io += cnt; }
    vo += cnt;
  }
  const bb = { x0: 1e9, y0: 1e9, z0: 1e9, x1: -1e9, y1: -1e9, z1: -1e9 };
  for (let i = 0; i < n; i++) { const o = i * 3; bb.x0 = Math.min(bb.x0, P[o]); bb.x1 = Math.max(bb.x1, P[o]); bb.y0 = Math.min(bb.y0, P[o + 1]); bb.y1 = Math.max(bb.y1, P[o + 1]); bb.z0 = Math.min(bb.z0, P[o + 2]); bb.z1 = Math.max(bb.z1, P[o + 2]); }
  const id = (key.match(/^[A-Za-z]+/) || [''])[0], seed = hashStr(`${id}|${style}`), hx = Math.max(0.3, (bb.x1 - bb.x0) / 2), hz = Math.max(0.3, (bb.z1 - bb.z0) / 2), Hh = Math.max(0.4, bb.y1);
  const ax = hz > hx ? 1 : 0, long = Math.max(hx, hz), short = Math.min(hx, hz), st = styleFor(st0, id);
  const linked = LINKED.has(id) || (long > 2.6 && long / short >= 3.4);
  const k = { Ha: Math.min(Hh, 3.2), cx: (bb.x0 + bb.x1) / 2, cz: (bb.z0 + bb.z1) / 2, hx, hz, H: Hh, linked, ax, th: hash1(seed, 1) * TAU, s1: hash1(seed, 2) * 40, s2: hash1(seed, 3) * 40, s3: hash1(seed, 4) };
  k.ul = ax ? (x, z) => ((z - k.cz) / hz) * 1.5708 : (x) => ((x - k.cx) / hx) * 1.5708;   // position along the long axis, -pi/2..pi/2

  // ---- walk surfaces: pinned exactly, and the field dies away smoothly round them so nothing tears ----
  const cell = 0.2, gx0 = bb.x0 - cell * 1.5, gz0 = bb.z0 - cell * 1.5, gw = Math.ceil((bb.x1 - bb.x0) / cell) + 4, gh = Math.ceil((bb.z1 - bb.z0) / cell) + 4;
  const pinned = new Uint8Array(n), fields = [null, null, null], walkCells = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = i * 3, y = P[o + 1];
    if (y < 0.05) { pinned[i] = 1; continue; }
    if (N[o + 1] <= 0.25) continue;
    for (let l = 0; l < 3; l++) if (Math.abs(y - LEVELS[l]) <= 0.02) {
      pinned[i] = 1;
      const f = fields[l] || (fields[l] = new Float32Array(gw * gh).fill(60)), q = Math.floor((P[o + 2] - gz0) / cell) * gw + Math.floor((P[o] - gx0) / cell);
      if (f[q] !== 0) { f[q] = 0; if (N[o + 1] > 0.9) walkCells[l]++; }
    }
  }
  for (const f of fields) {
    if (!f) continue;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const q = j * gw + i; let d = f[q]; if (i) d = Math.min(d, f[q - 1] + 1); if (j) { d = Math.min(d, f[q - gw] + 1); if (i) d = Math.min(d, f[q - gw - 1] + 1.414); if (i < gw - 1) d = Math.min(d, f[q - gw + 1] + 1.414); } f[q] = d; }
    for (let j = gh - 1; j >= 0; j--) for (let i = gw - 1; i >= 0; i--) { const q = j * gw + i; let d = f[q]; if (i < gw - 1) d = Math.min(d, f[q + 1] + 1); if (j < gh - 1) { d = Math.min(d, f[q + gw] + 1); if (i) d = Math.min(d, f[q + gw - 1] + 1.414); if (i < gw - 1) d = Math.min(d, f[q + gw + 1] + 1.414); } f[q] = d; }
  }
  const fieldAt = (f, x, z) => {
    const fx = clamp((x - gx0) / cell - 0.5, 0, gw - 1.001), fz = clamp((z - gz0) / cell - 0.5, 0, gh - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, q = j * gw + i;
    return Math.max(0, lerp(lerp(f[q], f[q + 1], u), lerp(f[q + gw], f[q + gw + 1], u), v) - 1.05) * cell;
  };
  const walkDist = (x, y, z) => { let d = 9; for (let l = 0; l < 3; l++) if (fields[l]) d = Math.min(d, Math.hypot(fieldAt(fields[l], x, z), y - LEVELS[l])); return d; };
  const endFade = linked ? (x, z) => smooth(0.02, 0.7, ax ? Math.min(z - bb.z0, bb.z1 - z) : Math.min(x - bb.x0, bb.x1 - x)) : null;
  const o3 = [0, 0, 0];
  /** where the point (x, y, z) goes: writes o3 */
  const move = (x, y, z) => {
    o3[0] = o3[1] = o3[2] = 0;
    if (y < 0.05) return;
    const w = smooth(0.05, 0.7, y) * smooth(0.03, 0.45, walkDist(x, y, z));
    if (w <= 0) return;
    if (!st.disp) return;
    st.disp(x, y, z, k, o3);
    if (endFade) { const e = endFade(x, z); if (ax) { o3[0] *= 0.6; o3[2] *= e; } else { o3[0] *= e; o3[2] *= 0.6; } o3[1] *= 0.3 + 0.7 * e; }
    o3[0] *= w; o3[1] *= w; o3[2] *= w;
    if (y + o3[1] < 0.05) o3[1] = 0.05 - y;
  };

  // ---- palette: classify every vertex, then repaint class by class keeping its light and shade ----
  const cls = new Uint8Array(n), lum = new Float32Array(n), sum = new Float64Array(13), cnt = new Uint32Array(13);
  for (let i = 0; i < n; i++) {
    const o = i * 3, c = classify(C[o], C[o + 1], C[o + 2], A[o], A[o + 1], A[o + 2]);
    cls[i] = c; lum[i] = 0.3 * C[o] + 0.55 * C[o + 1] + 0.15 * C[o + 2]; sum[c] += lum[i]; cnt[c]++;
  }
  const mean0 = Array.from(sum, (s, c) => (cnt[c] ? Math.max(1e-4, s / cnt[c]) : 1));
  sum.fill(0); cnt.fill(0);   // joints and shadowed grooves drag the average down: measure against the faces only
  for (let i = 0; i < n; i++) if (lum[i] >= 0.6 * mean0[cls[i]]) { sum[cls[i]] += lum[i]; cnt[cls[i]]++; }
  const mean = Array.from(sum, (s, c) => (cnt[c] ? Math.max(1e-4, s / cnt[c]) : 1)), c3 = [0, 0, 0], a3 = [0, 0, 0], glow = st.glow;
  // roofs: found by their tiles, so they can take their own colours and be re-covered (realm styles only)
  const roof = st.roof ? findRoofs(P, N, A, cls, I, ni, n, pinned) : null, vr = roof ? roof.vr : null, rpal = vr && st.pal.roof;
  for (let i = 0; i < n; i++) {
    const o = i * 3, c = cls[i], x = P[o], y = P[o + 1], z = P[o + 2], rel = lum[i] / mean[c];
    a3[0] = A[o]; a3[1] = A[o + 1]; a3[2] = A[o + 2];
    if (c === C_GLOW) { const l = clamp(lum[i] * 1.6, 0.45, 1); c3[0] = glow[0] * l; c3[1] = glow[1] * l; c3[2] = glow[2] * l; }
    else if (c === C_GLASS) { const l = 0.35 + 0.4 * noise3(x * 3 + k.s1, y * 3, z * 3); c3[0] = lerp(C[o], glow[0] * l, st.window); c3[1] = lerp(C[o + 1], glow[1] * l, st.window); c3[2] = lerp(C[o + 2], glow[2] * l, st.window); a3[0] = 0.4; a3[2] = Math.min(1.2, st.window * 1.1); }
    else if (c === C_LIQUID) { const l = clamp(lum[i] * 1.5, 0.3, 0.9); c3[0] = glow[0] * l; c3[1] = glow[1] * l; c3[2] = glow[2] * l; a3[2] = Math.max(a3[2], 0.5 * st.window); }
    else if (c === C_DARK) { c3[0] = C[o]; c3[1] = C[o + 1]; c3[2] = C[o + 2]; }
    else {
      const isRoof = rpal && vr[i], e = isRoof ? rpal : st.pal[c] || st.pal[C_OTHER], sws = e[0], f = e[1];
      const pick = noise3(x * f + k.s1 + c * 7.3, y * f * 1.3, z * f + k.s2) * sws.length * 1.6, s0 = sws[Math.floor(pick) % sws.length], sh = clamp(Math.pow(rel, e[2]), e[3], e[4]);
      c3[0] = s0[0] * sh; c3[1] = s0[1] * sh; c3[2] = s0[2] * sh;
      if (st.joint && c === C_STONE && !isRoof && rel < 0.66) { const t = smooth(0.66, 0.45, rel) * st.joint[3]; c3[0] = lerp(c3[0], st.joint[0], t); c3[1] = lerp(c3[1], st.joint[1], t); c3[2] = lerp(c3[2], st.joint[2], t); }
      if (st.trim && c === C_STONE && !isRoof && y > 0.3 && N[o + 1] > 0.45 && rel > 0.7) { const t = smooth(0.45, 0.75, N[o + 1]) * smooth(0.08, 0.2, walkDist(x, y, z)) * clamp(rel, 0.7, 1.2); if (t > 0) { c3[0] = lerp(c3[0], st.trim[0][0], t); c3[1] = lerp(c3[1], st.trim[0][1], t); c3[2] = lerp(c3[2], st.trim[0][2], t); } }
    }
    if (vr) { k.rel = rel; k.nx = N[o]; k.nz = N[o + 2]; k.roof = vr[i]; }
    if (st.fx) st.fx(c, x, y, z, N[o + 1], c3, a3, k);
    C[o] = c3[0]; C[o + 1] = c3[1]; C[o + 2] = c3[2]; A[o] = a3[0]; A[o + 1] = a3[1]; A[o + 2] = a3[2];
  }
  // ---- roofs to re-cover: which, how, and what has to come off first ----
  const nt = ni / 3, jobs = [];
  let cutv = null, lift = null, liftAt = null;
  if (roof) for (const c of roof.clusters) {
    const spec = c.ok ? roofSpec(st.roof, c, id) : null, mode = spec ? ROOF_MODE[spec.kind] : 0;
    if (!spec || mode === undefined || (mode === 2 && c.type === 'main' && c.fill < 0.7)) continue;
    let clear = 9;   // how far the new roof may reach past the old one before it would hang over a walk
    for (let q = 0; q < 24; q++) { const t = (q % 6 + 0.5) / 6, s = Math.floor(q / 6), x = s === 0 ? c.x0 : s === 1 ? c.x1 : lerp(c.x0, c.x1, t), z = s === 2 ? c.z0 : s === 3 ? c.z1 : lerp(c.z0, c.z1, t); for (let l = 0; l < 3; l++) if (fields[l] && LEVELS[l] < c.rY + 0.5) clear = Math.min(clear, fieldAt(fields[l], x, z)); }
    c.over = clamp(clear - 0.15, 0, 0.7); c.spec = spec; c.mode = mode; c.cutY = c.eY + Math.min(0.2, 0.12 * (c.rY - c.eY));
    jobs.push(c);
    if (mode === 2) cutv = cutv || new Uint8Array(n);
  }
  if (cutv) { // everything that stands on a roof being replaced comes off with it, unless it towers over it (a turret, a spire, a flagpole)
    const cut = jobs.filter((c) => c.mode === 2).sort((a, b) => (a.type === 'cap' ? 0 : 1) - (b.type === 'cap' ? 0 : 1)), col = new Map(), lifted = new Map();
    for (const c of cut) { const gx = c.gable && !c.ax ? 0.6 : 0.006, gz = c.gable && c.ax ? 0.6 : 0.006; c.q = [Math.max(bb.x0 - 0.01, c.x0 - gx), Math.min(bb.x1 + 0.01, c.x1 + gx), Math.max(bb.z0 - 0.01, c.z0 - gz), Math.min(bb.z1 + 0.01, c.z1 + gz)]; }
    const regionOf = (x, z) => { for (const c of cut) if (c.type === 'cap' ? (x - c.cx) * (x - c.cx) + (z - c.cz) * (z - c.cz) < (c.r + 0.006) * (c.r + 0.006) : x > c.q[0] && x < c.q[1] && z > c.q[2] && z < c.q[3]) return c; return null; };
    const seen = (x, y, z, st) => { const c = regionOf(x, z); if (!c) return; const key = cellKey(x, z); let t = col.get(key); if (!t) col.set(key, t = { top: y, stone: false }); else if (y > t.top) t.top = y; if (st && y > c.cutY + 0.05 && y <= c.rY) t.stone = true; };
    for (let i = 0; i < n; i++) seen(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], cls[i] === C_STONE && !vr[i]);
    for (const { mesh, m } of parts.other) { const p = mesh.geometry.attributes.position; for (let i = 0; i < p.count; i++) { v3.fromBufferAttribute(p, i).applyMatrix4(m); seen(v3.x, v3.y, v3.z, false); } }
    lift = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 3, y = P[o + 1];
      if (pinned[i]) continue;
      if (vr[i] && roof.clusters[vr[i] - 1].mode === 2) { cutv[i] = vr[i]; continue; }   // the old tiles themselves
      const c = regionOf(P[o], P[o + 2]);
      if (!c || y <= c.cutY + 0.004) continue;
      const key = cellKey(P[o], P[o + 2]), t = col.get(key);
      if (t.top <= c.rY + 0.75) cutv[i] = c.i + 1;
      else if (t.stone) continue;   // a tower or a chimney stack runs up through the roof here: all of it stays
      else if (y > c.rY + 0.05) { lift[i] = c.i + 1; let q = lifted.get(c.i); if (!q) lifted.set(c.i, q = new Set()); q.add(key); }   // it stood on the ridge: it will ride on the new roof
      else cutv[i] = c.i + 1;
    }
    for (const [ci, q] of lifted) if (q.size > 20) { roof.clusters[ci].noLift = true; for (let i = 0; i < n; i++) if (lift[i] === ci + 1) lift[i] = 0; }   // too big to be a pole or a vane: it stays where it was
    liftAt = (x, y, z) => { const c = regionOf(x, z); if (!c || c.noLift || c.top === undefined || y <= c.rY + 0.05) return 0; const t = col.get(cellKey(x, z)); return t && t.stone ? 0 : c.top - c.rY; };
  }
  // ---- triangles left out: torn roofs (decided where they lay before anything moved), roofs being replaced ----
  // Large dark linings under roofs are left out too: with only a corner here and there they cannot follow the tiles.
  let I2 = I;
  {
    let q = 0; I2 = new Uint32Array(ni);
    for (let t = 0; t < ni; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2], ca = cls[a];
      if (roof) { const f = roof.tf[t / 3]; if (f && roof.clusters[f - 1].mode) continue; if (cutv && cutv[a] && cutv[b] && cutv[c]) continue; }
      if (lum[a] < 0.09 && lum[b] < 0.09 && lum[c] < 0.09 && P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1] > 3 && A[a * 3 + 2] < 0.3) {
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 0.5) continue;
      }
      if (st.drop && ca === cls[b] && ca === cls[c] && N[a * 3 + 1] > 0.2) { const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3; if (y > 0.9 && walkDist(x, y, z) > 0.3 && st.drop(ca, Math.round(x * 5) / 5, Math.round(y * 5) / 5, Math.round(z * 5) / 5, k)) continue; }
      I2[q++] = a; I2[q++] = b; I2[q++] = c;
    }
    I2 = I2.subarray(0, q);
  }
  let alive = null;
  if (jobs.length) { alive = new Uint8Array(n); for (let i = 0; i < I2.length; i++) alive[I2[i]] = 1; }
  // ---- the new roofs, built where the old ones stood ----
  let rg = null;
  if (jobs.length) {
    rg = new Geo(); rg.moss = 0;
    const env = { P, N, n, vr, alive, cls, k, id, seed, st, bb };
    for (const c of jobs) {
      try { ROOFS[c.spec.kind](rg, c, c.spec, env); } catch (err) { console.warn('[factions] roof failed for', key, style, c.spec.kind, err); }
    }
    if (cutv) for (let i = 0; i < n; i++) { // whatever straddled the cut is trimmed to it; what stood on the old ridge moves to the new one
      if (cutv[i]) P[i * 3 + 1] = roof.clusters[cutv[i] - 1].cutY;
      else if (lift[i]) { const c = roof.clusters[lift[i] - 1]; if (c.top !== undefined) P[i * 3 + 1] += c.top - c.rY; }
    }
    if (!rg.n) rg = null;
  }
  // ---- shape ----
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    const o = i * 3;
    k.cls = cls[i]; k.vnx = N[o]; k.vny = N[o + 1]; k.vnz = N[o + 2]; k.roof = vr ? vr[i] : 0;
    move(P[o], P[o + 1], P[o + 2]);
    P[o] += o3[0]; P[o + 1] += o3[1]; P[o + 2] += o3[2];
  }
  k.cls = C_OTHER; k.vnx = k.vnz = 0; k.vny = 1; k.roof = 0;
  if (rg) { const Q = rg.P; k.roof = 255; for (let i = 0; i < rg.n; i++) { const o = i * 3; move(Q[o], Q[o + 1], Q[o + 2]); Q[o] += o3[0]; Q[o + 1] += o3[1]; Q[o + 2] += o3[2]; } k.roof = 0; }
  const others = parts.other.map(({ mesh, m }) => {
    const g = mesh.geometry.clone().applyMatrix4(m), p = g.attributes.position, nr = g.attributes.normal;
    let up = 0;
    if (liftAt) { g.computeBoundingBox(); const b = g.boundingBox; up = liftAt((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2); }
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (nr && nr.getY(i) > 0.25 && LEVELS.some((L) => Math.abs(y - L) <= 0.02)) continue;
      move(x, y, z); p.setXYZ(i, x + o3[0], y + o3[1] + up, z + o3[2]);
    }
    p.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  });
  // ---- ornaments ----
  let og = null;
  if (!BARE.has(id) && Hh >= 1.2 && ORNAMENTS[style]) {
    og = new Geo(); og.moss = 0;
    let bb2 = bb;
    if (rg) { bb2 = { ...bb }; const Q = rg.P; for (let i = 0; i < rg.n; i++) { const o = i * 3; if (Q[o + 1] > bb2.y1) bb2.y1 = Q[o + 1]; if (Q[o] < bb2.x0) bb2.x0 = Q[o]; if (Q[o] > bb2.x1) bb2.x1 = Q[o]; if (Q[o + 2] < bb2.z0) bb2.z0 = Q[o + 2]; if (Q[o + 2] > bb2.z1) bb2.z1 = Q[o + 2]; } }
    try { const sv = survey(P, n, bb2, k, walkDist, walkCells, id, seed, alive, rg ? rg.P : null); sv.roofs = jobs; sv.id = id; sv.st = st; ORNAMENTS[style](og, sv, k); } catch (err) { console.warn('[factions] ornaments failed for', key, style, err); og = null; }
    if (og && !og.n) og = null;
  }
  const geo = new THREE.BufferGeometry(), ex = [rg, og].filter(Boolean), on = ex.reduce((s, g) => s + g.n, 0), oi = ex.reduce((s, g) => s + g.I.length, 0);
  const cat = (a, f) => { if (!on) return a; const r = new Float32Array((n + on) * 3); r.set(a); let q = n * 3; for (const g of ex) { r.set(g[f], q); q += g.n * 3; } return r; };
  let idx = I2;
  if (on) { idx = new Uint32Array(I2.length + oi); idx.set(I2); let q = I2.length, base = n; for (const g of ex) { const J = g.I; for (let i = 0; i < J.length; i++) idx[q + i] = J[i] + base; q += J.length; base += g.n; } }
  geo.setAttribute('position', new THREE.BufferAttribute(cat(P, 'P'), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(cat(N, 'N'), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cat(C, 'C'), 3));
  geo.setAttribute('aPbr', new THREE.BufferAttribute(cat(A, 'A'), 3));
  geo.setIndex(new THREE.BufferAttribute(n + on > 65535 ? idx : Uint16Array.from(idx), 1));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return { geo, others };
}


// ---------- ornaments: placed from a survey of the finished shape ----------
/**
 * Where things can go on a building: its highest point, the two ends of its ridge, the tops of its corners, spots
 * part-way up each face, the top edge of long walls, and the two sides of its door (taken to face +Z). Every anchor
 * is { x, y, z, yaw } with local +Z pointing out of the building. add(est, fn) runs fn while the triangle budget lasts.
 */
function survey(P, n, bb, k, walkDist, walkCells, id, seed, alive = null, extra = null) {
  const cell = 0.125, w = Math.ceil((bb.x1 - bb.x0) / cell) + 1, h = Math.ceil((bb.z1 - bb.z0) / cell) + 1, hm = new Float32Array(w * h).fill(-1);
  const ny = Math.ceil(bb.y1 / cell) + 1, fz = [new Float32Array(w * ny).fill(-1e9), new Float32Array(w * ny).fill(-1e9)], fx = [new Float32Array(h * ny).fill(-1e9), new Float32Array(h * ny).fill(-1e9)];
  for (let pass = 0; pass < 2; pass++) for (let i = 0, Q = pass ? extra : P, m = pass ? (extra ? extra.length / 3 : 0) : n; i < m; i++) {
    const o = i * 3, x = Q[o], y = Q[o + 1], z = Q[o + 2];
    if (y < 0 || (alive && (pass ? x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1 || y > bb.y1 : !alive[i]))) continue;
    const ci = Math.floor((x - bb.x0) / cell), cj = Math.floor((z - bb.z0) / cell), cy = Math.floor(y / cell);
    if (y > hm[cj * w + ci]) hm[cj * w + ci] = y;
    if (z > fz[0][cy * w + ci]) fz[0][cy * w + ci] = z; if (-z > fz[1][cy * w + ci]) fz[1][cy * w + ci] = -z;
    if (x > fx[0][cy * h + cj]) fx[0][cy * h + cj] = x; if (-x > fx[1][cy * h + cj]) fx[1][cy * h + cj] = -x;
  }
  const H = bb.y1, sc = clamp(H / 3, 0.75, 1.45), rnd = rng(seed), cap = H < 2 || (bb.x1 - bb.x0) * (bb.z1 - bb.z0) < 5 ? 2400 : 5600;
  const topAt = (x, z, r = 0.2) => { let best = -1, bx = x, bz = z; const i0 = Math.floor((x - r - bb.x0) / cell), i1 = Math.floor((x + r - bb.x0) / cell), j0 = Math.floor((z - r - bb.z0) / cell), j1 = Math.floor((z + r - bb.z0) / cell); for (let j = Math.max(0, j0); j <= Math.min(h - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(w - 1, i1); i++) if (hm[j * w + i] > best) { best = hm[j * w + i]; bx = bb.x0 + (i + 0.5) * cell; bz = bb.z0 + (j + 0.5) * cell; } return best < 0 ? null : { x: bx, y: best, z: bz }; };
  // dir 0: +Z, 1: +X, 2: -Z, 3: -X. u runs along the face.
  const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const faceAt = (dir, u, y) => {
    const m = dir % 2 ? fx[dir === 1 ? 0 : 1] : fz[dir === 0 ? 0 : 1], len = dir % 2 ? h : w, u0 = dir % 2 ? bb.z0 : bb.x0, ci = Math.floor((u - u0) / cell), cy = Math.floor(y / cell);
    let best = -1e9;
    for (let j = Math.max(0, cy - 1); j <= Math.min(ny - 1, cy + 1); j++) for (let i = Math.max(0, ci - 1); i <= Math.min(len - 1, ci + 1); i++) best = Math.max(best, m[j * len + i]);
    return best < -1e8 ? null : best * (dir < 2 ? 1 : -1);
  };
  const yawOf = (dir) => [0, 90, 180, 270][dir];
  const spot = (dir, u, y, maxIn = 0.75) => {
    const e = faceAt(dir, u, y), edge = dir === 0 ? bb.z1 : dir === 1 ? bb.x1 : dir === 2 ? bb.z0 : bb.x0;
    if (e === null || Math.abs(e - edge) > maxIn) return null;
    return dir % 2 ? { x: e, y, z: u, yaw: yawOf(dir), dir } : { x: u, y, z: e, yaw: yawOf(dir), dir };
  };
  const walky = (walkCells[0] + walkCells[1] + walkCells[2]) * 0.04 > 0.22 * (bb.x1 - bb.x0) * (bb.z1 - bb.z0);
  const slim = k.linked && Math.max(k.hx, k.hz) / Math.min(k.hx, k.hz) > 1.8;
  const sv = { H, sc, rnd, walky, slim, bb, k, apex: null, ridge: [], corners: [], faces: [], edges: [], door: [], topAt, spot };
  // top and ridge
  // (judged on a blurred height map, so a chimney pot, a flagpole or a plume of smoke is not mistaken for the roof)
  const blur = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let s = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < w && b < h) s += Math.max(0, hm[b * w + a]); } blur[j * w + i] = hm[j * w + i] < 0 ? 0 : s / 25; }
  let top = null, tb = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (blur[j * w + i] > tb) { tb = blur[j * w + i]; top = { x: bb.x0 + (i + 0.5) * cell, y: hm[j * w + i], z: bb.z0 + (j + 0.5) * cell }; }
  if (top && !walky && !slim && walkDist(top.x, top.y, top.z) > 0.3) {
    sv.apex = top;
    let a = null, b = null; const thr = tb - Math.max(0.2, 0.07 * H);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (blur[j * w + i] >= thr && Math.abs(hm[j * w + i] - top.y) < 0.5) { const q = { x: bb.x0 + (i + 0.5) * cell, y: hm[j * w + i], z: bb.z0 + (j + 0.5) * cell }, t = k.ax ? q.z : q.x; if (!a || t < (k.ax ? a.z : a.x)) a = q; if (!b || t > (k.ax ? b.z : b.x)) b = q; }
    if (a && b && Math.hypot(a.x - b.x, a.z - b.z) > 0.7) { a.yaw = k.ax ? 180 : 270; b.yaw = k.ax ? 0 : 90; sv.ridge = [a, b]; }
  }
  // corners
  if (!slim) for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const c = topAt(sx > 0 ? bb.x1 - 0.22 : bb.x0 + 0.22, sz > 0 ? bb.z1 - 0.22 : bb.z0 + 0.22, 0.24);
    if (c && c.y > 0.9 && walkDist(c.x, c.y, c.z) > 0.2) { c.yaw = Math.atan2(sx, sz) / DEG; sv.corners.push(c); }
  }
  // faces and top edges
  for (let dir = 0; dir < 4; dir++) {
    const u0 = dir % 2 ? bb.z0 : bb.x0, L = dir % 2 ? bb.z1 - bb.z0 : bb.x1 - bb.x0, isLong = (dir % 2 === 1) === (k.ax === 1);
    if (slim && !isLong) continue;
    const cnt = slim ? clamp(Math.round(L / 3.2), 1, 5) : clamp(Math.round(L / 2.3), 1, 3);
    for (let i = 0; i < cnt; i++) {
      const u = u0 + (L * (i + 0.5 + (cnt > 1 ? 0 : (rnd() - 0.5) * 0.3))) / cnt, ix = dir % 2 ? (dir === 1 ? bb.x1 - 0.3 : bb.x0 + 0.3) : u, iz = dir % 2 ? u : dir === 0 ? bb.z1 - 0.3 : bb.z0 + 0.3;
      const t = topAt(ix, iz, 0.22), hl = t ? t.y : H * 0.5, y = clamp(hl * 0.6, 0.75, Math.min(hl - 0.25, k.linked || walky ? 1.25 : 2.1));
      const s = y > 0.6 ? spot(dir, u, y) : null;
      if (s) { s.i = i; s.wallH = hl; sv.faces.push(s); }
      if (slim || walky) { const e = topAt(dir % 2 ? (dir === 1 ? bb.x1 - 0.1 : bb.x0 + 0.1) : u + L / cnt / 2.6, dir % 2 ? u + L / cnt / 2.6 : dir === 0 ? bb.z1 - 0.1 : bb.z0 + 0.1, 0.14); if (e && e.y > 1 && walkDist(e.x, e.y, e.z) > 0.2) { e.yaw = yawOf(dir); e.dir = dir; sv.edges.push(e); } }
    }
  }
  // the door side: +Z, or the long +X face of a turned piece
  if (!slim && !walky) { const dir = k.ax ? 1 : 0, c = dir ? k.cz : k.cx, hw = dir ? k.hz : k.hx; for (const e of [-1, 1]) { const s = spot(dir, c + e * Math.min(hw * 0.62, 1.25), 1.1, 0.9); if (s) { s.e = e; sv.door.push(s); } } }
  sv.add = (g, est, fn) => { if (g.I.length / 3 + est * Math.max(1, qual() * qual()) <= cap) fn(); };
  sv.cap = cap;
  sv.at = (g, a, fn, lift = 0) => g.in(M(a.x, a.y + lift, a.z, 0, a.yaw, 0), fn);
  return sv;
}
const antler = (g, s, seed = 0) => {
  const c = boneCol(seed, rgb(0xcbbf9c));
  g.surf(K_PLAIN, 0.7);
  limb(g, [[0, 0, 0], [0.06 * s, 0.3 * s, 0.04 * s], [0.2 * s, 0.6 * s, 0.02 * s], [0.42 * s, 0.86 * s, -0.04 * s], [0.5 * s, 1.1 * s, -0.02 * s]], [0.06 * s, 0.05 * s, 0.042 * s, 0.03 * s, 0.006 * s], { nu: nq(8), nv: nq(18), col: c });
  for (const [t, len, a] of [[0.25, 0.34, -30], [0.5, 0.4, -18], [0.74, 0.3, 24]]) g.in(M(0.5 * s * t * t + 0.1 * s * t, 1.0 * s * t, 0, 0, 0, a - 20), () => limb(g, [[0, 0, 0], [-0.03 * s, len * s * 0.5, 0.05 * s], [0.02 * s, len * s, 0.07 * s]], [0.034 * s, 0.026 * s, 0.004 * s], { nu: nq(7), nv: nq(8), col: c }));
};
const ORNAMENTS = {
  goblin(g, sv) {
    const sc = sv.sc, rnd = sv.rnd, paints = [rgb(0xb8342a), rgb(0xd9b83a), rgb(0x2f7a66)];
    const banner = (a, i) => sv.add(g, 700, () => sv.at(g, a, () => g.in(M(0, -0.25, 0, 14 + rnd() * 10, 0, (rnd() - 0.5) * 16), () => {
      stake(g, 0.035 * sc, 1.5 * sc, i + 3, rgb(0x5a4630));
      g.surf(K_WOOD, 0.9); g.in(M(0, 1.3 * sc, 0.03), () => g.beam(0.5 * sc, 0.04, 0.04, 0.008, woodTint(rgb(0x6b5236), i), 2));
      g.in(M(0, 1.28 * sc, 0.05), () => rag(g, 0.42 * sc, 0.75 * sc, paints[i % 3], i * 7 + 1, 0.5, paints[(i + 1) % 3]));
    })));
    sv.ridge.forEach(banner);
    if (sv.apex && !sv.ridge.length) banner({ ...sv.apex, yaw: 0 }, 2);
    [...sv.corners, ...sv.edges].forEach((a, i) => sv.add(g, 800, () => sv.at(g, a, () => { for (const [rx, rz, hh] of [[26, 0, 0.8], [18, 24, 0.55], [20, -22, 0.6]]) g.in(M(rz * 0.004, -0.3, 0, rx + rnd() * 8, 0, rz), () => stake(g, 0.045 * sc, hh * sc * (0.85 + 0.3 * rnd()), i * 5 + rx)); })));
    sv.faces.forEach((a, i) => sv.add(g, 900, () => sv.at(g, a, () => {
      if ((i + a.dir) % 2 === 0) g.in(M(0, 0, 0.045, 0, 0, (rnd() - 0.5) * 30), () => roundShield(g, 0.27 * sc, rgb(0x7a5c38), paints[i % 3], i + 2));
      else { // scrap plates riveted over a hole
        g.surf(K_PLAIN, 0.8, 0.5);
        for (const [x, y, w2, h2, r] of [[0, 0, 0.52, 0.4, 7], [0.2, -0.18, 0.34, 0.3, -11], [-0.16, 0.2, 0.3, 0.22, 4]]) g.in(M(x * sc, y * sc, 0.03 + Math.abs(r) * 0.002, 0, 0, r), () => { g.surf(K_PLAIN, 0.8, 0.5); g.cbox(w2 * sc, h2 * sc, 0.022, 0.008, (px, py, pz) => mul(mix(RUST, [0.16, 0.13, 0.11], noise3(px * 9 + i, py * 9, r)), 0.7 + 0.5 * noise3(px * 25, py * 25, i))); g.surf(K_PLAIN, 0.6, 0.8); for (const ex of [-1, 1]) for (const ey of [-1, 1]) g.in(M(ex * (w2 * sc / 2 - 0.035), ey * (h2 * sc / 2 - 0.035), 0.011), () => g.stud(0.016, IRON, 5)); });
      }
    })));
  },
  undead(g, sv) {
    const sc = sv.sc, rnd = sv.rnd;
    sv.ridge.forEach((a, i) => sv.add(g, 2200, () => sv.at(g, a, () => g.in(M(0, -0.15, 0, 10, 0, 0), () => {
      g.surf(K_PLAIN, 0.6, 0.8); g.cyl(0.022 * sc, 0.012 * sc, 0.75 * sc, 6, IRON);
      g.in(M(0, 0.62 * sc, -0.04 * sc, 8, 0, (i ? -1 : 1) * 6), () => skull(g, 1.9 * sc));
    }))));
    if (sv.apex && !sv.ridge.length) sv.add(g, 1400, () => g.in(M(sv.apex.x, sv.apex.y - 0.12, sv.apex.z), () => { for (let i = 0; i < 5; i++) g.in(M(0, 0, 0, 0, i * 72 + 10, 0), () => rib(g, [0.12 * sc, 0, 0], [0.1 * sc, 0.75 * sc, 0], [0.26 * sc, 0, 0], 0.035 * sc, i)); }));
    [...sv.corners, ...sv.edges].forEach((a, i) => sv.add(g, 700, () => sv.at(g, a, () => {
      horn(g, [[0, -0.25, -0.02], [0, 0.12 * sc, 0.16 * sc], [0, 0.5 * sc, 0.2 * sc], [0, 0.9 * sc, 0.06 * sc]], 0.075 * sc, mul(BONE, 1.05), BONE_OLD, { rings: 30 });
      g.in(M(0.12 * sc, 0, -0.04, 0, 0, -18), () => horn(g, [[0, -0.2, 0], [0, 0.1 * sc, 0.08 * sc], [0, 0.42 * sc, 0.1 * sc]], 0.05 * sc, mul(BONE, 1.05), BONE_OLD, { rings: 30 }));
    })));
    sv.faces.forEach((a, i) => sv.add(g, 1500, () => sv.at(g, a, () => {
      if ((i + a.dir) % 2 === 0) { g.surf(K_PLAIN, 0.6, 0.8); g.in(M(0, 0.02, 0.03), () => g.cbox(0.6 * sc, 0.035, 0.035, 0.008, IRON)); g.in(M(0, 0, 0.03), () => rag(g, 0.52 * sc, Math.min(1.1 * sc, a.y - 0.15), rgb(0x3a3842), i * 3 + 1, 0.7, null)); }
      else { g.in(M(0, -0.1 * sc, 0.02, -8, 0, 0), () => skull(g, 1.7 * sc, true)); bone(g, [-0.28 * sc, -0.3 * sc, 0.04], [0.28 * sc, 0.1 * sc, 0.05], 0.022 * sc, i); bone(g, [0.28 * sc, -0.3 * sc, 0.07], [-0.28 * sc, 0.1 * sc, 0.06], 0.022 * sc, i + 1); }
    })));
    sv.door.forEach((a, i) => sv.add(g, 500, () => sv.at(g, a, () => { // grave lanterns
      g.surf(K_PLAIN, 0.55, 0.85);
      g.tube([[0, 0.1, 0], [0, 0.2, 0.12], [0, 0.18, 0.24]], 0.016, 5, IRON);
      g.in(M(0, -0.12, 0.24), () => {
        g.lathe([[0.075, 0.24], [0.03, 0.3], [0.012, 0.33]], 6, IRON); g.lathe([[0.06, 0], [0.075, 0.016], [0.075, 0.03]], 6, IRON);
        for (let q = 0; q < 6; q++) g.in(M(Math.cos(q * 1.047) * 0.068, 0.135, Math.sin(q * 1.047) * 0.068), () => g.cbox(0.012, 0.22, 0.012, 0.002, IRON));
        g.surf(K_PLAIN, 1, 0, 1.7); g.lathe([[0.058, 0.03], [0.058, 0.24]], 6, GHOST);
      });
    })));
  },
  infernal(g, sv) {
    const sc = sv.sc, tip = [0.5, 0.05, 0.02], root = [0.02, 0.016, 0.016];
    const big = (s, lean = 1) => horn(g, [[0, -0.25, -0.05], [0, 0.2 * s, 0.22 * s * lean], [0, 0.62 * s, 0.38 * s * lean], [0, 1.05 * s, 0.3 * s * lean], [0, 1.3 * s, 0.08 * s * lean]], 0.13 * s, tip, root, { rings: 38, nu: nq(12) });
    sv.ridge.forEach((a) => sv.add(g, 1300, () => sv.at(g, a, () => { for (const e of [-1, 1]) g.in(M(e * 0.1 * sc, 0, -0.1, 0, e * 28, e * -14), () => big(0.95 * sc)); })));
    if (sv.apex && !sv.ridge.length) sv.add(g, 2000, () => g.in(M(sv.apex.x, sv.apex.y - 0.1, sv.apex.z), () => { for (let i = 0; i < 4; i++) g.in(M(0, 0, 0, 0, i * 90 + 45, 0), () => g.in(M(0, -0.15, 0.06 * sc), () => big(0.7 * sc))); }));
    [...sv.corners, ...sv.edges].forEach((a) => sv.add(g, 600, () => sv.at(g, a, () => big(0.8 * sc))));
    const fs = sv.faces;
    fs.forEach((a, i) => {
      sv.add(g, 400, () => sv.at(g, a, () => g.in(M(0, 0.05, 0.012), () => sigil(g, i * 13 + a.dir * 5 + 3, 0.5 * sc, EMBER, 1.6, 0.06))));
      const b = fs[i + 1];
      if (b && b.dir === a.dir && Math.hypot(a.x - b.x, a.z - b.z) < 4.2) sv.add(g, 2600, () => { const pts = []; for (let q = 0; q <= 8; q++) { const t = q / 8; pts.push([lerp(a.x, b.x, t) + [0, 1, 0, -1][a.dir] * 0.06, lerp(a.y, b.y, t) + 0.36 * sc - 0.4 * Math.sin(t * Math.PI), lerp(a.z, b.z, t) + [1, 0, -1, 0][a.dir] * 0.06]); } chain(g, pts, 0.075 * sc, [0.05, 0.045, 0.04]); });
    });
    sv.door.forEach((a, i) => sv.add(g, 1100, () => sv.at(g, a, () => {
      g.surf(K_PLAIN, 0.5, 0.85);
      g.tube([[0, -0.3, 0], [0, -0.22, 0.14], [0, -0.06, 0.24]], 0.022, 5, IRON);
      g.in(M(0, -0.42, 0.26), () => brazier(g, 0.42 * sc, FIRE_HOT, [0.05, 0.04, 0.035], i));
    })));
  },
  beasts(g, sv) {
    const sc = sv.sc, rnd = sv.rnd, tusk = (s) => horn(g, [[0, -0.25, -0.04], [0, 0.15 * s, 0.2 * s], [0, 0.55 * s, 0.3 * s], [0, 0.95 * s, 0.14 * s]], 0.09 * s, mul(BONE, 1.05), rgb(0x8a7a5a), { rings: 22 });
    sv.ridge.forEach((a, i) => sv.add(g, 1200, () => sv.at(g, a, () => { for (const e of [-1, 1]) g.in(M(e * 0.05, -0.12, -0.1, 12, e * 90 - 90, 0), () => g.in(M(0, 0, 0, 0, 0, e * -8), () => antler(g, 0.9 * sc, i + e))); })));
    if (sv.apex && !sv.ridge.length) sv.add(g, 1200, () => g.in(M(sv.apex.x, sv.apex.y - 0.12, sv.apex.z), () => { for (const e of [0, 180]) g.in(M(0, 0, 0, 0, e, 0), () => antler(g, 0.85 * sc, e)); }));
    [...sv.corners, ...sv.edges].forEach((a) => sv.add(g, 500, () => sv.at(g, a, () => tusk(0.85 * sc))));
    sv.faces.forEach((a, i) => sv.add(g, 900, () => sv.at(g, a, () => { // a hide stretched in a frame of poles, painted
      const w2 = 0.62 * sc, h2 = 0.52 * sc, hc = hideCol(rgb(0xb89a68), i, 9);
      g.surf(K_CLOTH, 0.95);
      g.sheet(nq(10), nq(8), (u, v) => [(u - 0.5) * w2 * (0.86 + 0.14 * Math.abs(v - 0.5) * 2), (v - 0.5) * h2 * (0.86 + 0.14 * Math.abs(u - 0.5) * 2), 0.05 + 0.02 * Math.sin(u * 3.1) * Math.sin(v * 3.1)],
        (x, y, z, nx, ny, nz, u, v) => { const d = Math.hypot(u - 0.5, v - 0.5), a2 = Math.atan2(v - 0.5, u - 0.5); return Math.abs(d - 0.06 - 0.03 * (((a2 + i) % TAU + TAU) % TAU)) < 0.028 && d < 0.34 ? [0.3, 0.04, 0.02] : hc(x, y, z); });
      g.surf(K_WOOD, 0.9);
      for (const e of [-1, 1]) { g.in(M(e * w2 * 0.56, 0, 0.04, 0, 0, 90 + e * 3), () => g.beam(h2 * 1.35, 0.045, 0.045, 0.012, woodTint(rgb(0x8a6a42), i + e), 2)); g.in(M(0, e * h2 * 0.56, 0.05, 0, 0, e * 2), () => g.beam(w2 * 1.35, 0.045, 0.045, 0.012, woodTint(rgb(0x8a6a42), i + e + 5), 2)); }
    })));
    sv.door.forEach((a, i) => sv.add(g, 1500, () => sv.at(g, a, () => g.in(M(0, -a.y, 0.16, 0, 0, a.e * -4), () => { // a spirit pole: painted bands, a skull, feathers of bone
      stake(g, 0.06 * sc, 1.7 * sc, i + 9, rgb(0x7a5a38));
      g.surf(K_PLAIN, 0.8);
      for (const [y, c] of [[0.5, 0x9a3a24], [0.62, 0xd8cdb0], [0.74, 0x26221e], [1.05, 0x9a3a24]]) g.in(M(0, y * sc, 0), () => g.lathe([[0.066 * sc, 0], [0.07 * sc, 0.03 * sc], [0.066 * sc, 0.07 * sc]], nq(10), rgb(c)));
      g.in(M(0, 1.2 * sc, 0.05 * sc), () => skull(g, 1.5 * sc, true));
      for (const e of [-1, 1]) g.in(M(e * 0.05 * sc, 1.32 * sc, 0, 0, 0, e * -50), () => horn(g, [[0, 0, 0], [0, 0.16 * sc, 0.03], [0, 0.34 * sc, -0.02]], 0.03 * sc, BONE, BONE_OLD));
    }))));
    void rnd;
  },
  elemental(g, sv) {
    const sc = sv.sc, rnd = sv.rnd, cl = (s, n, spread, sd) => { for (let i = 0; i < n; i++) { const a = (i / n) * TAU + sd, t = i ? 18 + spread * rnd() : 0; g.in(M(i ? Math.cos(a) * 0.09 * s : 0, 0, i ? Math.sin(a) * 0.09 * s : 0, t * Math.sin(a), 0, -t * Math.cos(a)), () => crystal(g, (i ? 0.07 : 0.11) * s, (i ? 0.45 + 0.3 * rnd() : 1) * s, sd * 7 + i, { glow: 1.0 })); } };
    if (sv.apex) sv.add(g, 1200, () => { // crystals hanging in the air over the roof
      const a = sv.apex;
      for (const [dx, dy, dz, s, t] of [[0, 0.5, 0, 0.75, 6], [0.42, 0.3, 0.2, 0.42, -14], [-0.36, 0.62, -0.24, 0.36, 18], [0.1, 0.95, -0.4, 0.26, 30]]) g.in(M(a.x + dx * sc, a.y + dy * sc, a.z + dz * sc, t, dx * 90, t * 0.6), () => { crystal(g, 0.13 * s * sc, 0.8 * s * sc, s * 91, { glow: 1.25 }); g.in(M(0, 0, 0, 180, 0, 0), () => crystal(g, 0.13 * s * sc, 0.42 * s * sc, s * 57, { glow: 1.25 })); });
    });
    sv.ridge.forEach((a, i) => sv.add(g, 900, () => sv.at(g, a, () => g.in(M(0, -0.12, -0.08, 22, 0, 0), () => cl(0.8 * sc, 4, 26, i + 1)))));
    [...sv.corners, ...sv.edges].forEach((a, i) => sv.add(g, 700, () => sv.at(g, a, () => g.in(M(0, -0.15, -0.02, 28, 0, 0), () => cl(0.7 * sc, 3, 22, i + 4)))));
    sv.faces.forEach((a, i) => sv.add(g, 600, () => sv.at(g, a, () => { g.in(M(0, 0.05, 0.014), () => sigil(g, i * 17 + a.dir * 3 + 1, 0.6 * sc, [0.25, 0.7, 1.0], 1.7, 0.055)); if (i % 2 === 0) g.in(M(0.3 * sc, -0.42 * sc, -0.03, 62, 0, -12), () => cl(0.34 * sc, 3, 20, i + 9)); })));
  },
  dragons(g, sv, k) {
    const sc = sv.sc, dark = [0.05, 0.035, 0.03], red = [0.32, 0.05, 0.03];
    const fin = (s) => horn(g, [[0, -0.2, 0.05], [0, 0.2 * s, 0.02 * s], [0, 0.6 * s, -0.16 * s], [0, 0.95 * s, -0.5 * s], [0, 1.1 * s, -0.86 * s]], 0.12 * s, mul(GOLD, 0.8), dark, { rings: 30, flat: [0.55, 1], nu: nq(10), metal: 0.3 });
    if (sv.ridge.length) { // a crest of swept horns along the ridge
      const [a, b] = sv.ridge, L = Math.hypot(b.x - a.x, b.z - a.z), nn = clamp(Math.round(L / 0.5), 3, 8), yaw = Math.atan2(b.x - a.x, b.z - a.z) / DEG;
      for (let i = 0; i < nn; i++) { const t = (i + 0.3) / nn, q = sv.topAt(lerp(a.x, b.x, t), lerp(a.z, b.z, t), 0.16); if (q) sv.add(g, 500, () => g.in(M(q.x, q.y - 0.05, q.z, 0, yaw, 0), () => fin((0.55 + 0.5 * Math.sin((i + 0.5) / nn * Math.PI)) * sc))); }
    } else if (sv.apex) sv.add(g, 1400, () => g.in(M(sv.apex.x, sv.apex.y - 0.1, sv.apex.z), () => { for (let i = 0; i < 3; i++) g.in(M(0, 0, 0, 0, i * 120, 0), () => g.in(M(0, 0, -0.06), () => fin(0.75 * sc))); }));
    [...sv.corners, ...sv.edges].forEach((a) => sv.add(g, 1000, () => sv.at(g, a, () => { // a claw gripping the corner
      for (const ry of [-34, 0, 34]) g.in(M(0, 0.02, -0.05, 0, ry, 0), () => horn(g, [[0, 0.05, -0.12 * sc], [0, 0.26 * sc, 0.1 * sc], [0, 0.2 * sc, 0.34 * sc], [0, -0.08 * sc, 0.42 * sc]], 0.07 * sc, mul(GOLD, 0.9), red, { rings: 20, metal: 0.4 }));
    })));
    sv.faces.forEach((a, i) => sv.add(g, 700, () => sv.at(g, a, () => {
      g.surf(K_PLAIN, 0.35, 0.9); g.in(M(0.3 * sc, 0.3 * sc, 0.05, 0, 0, 90), () => g.cyl(0.022, 0.022, 0.6 * sc, 6, GOLD, true, true));
      g.in(M(0, 0.3 * sc, 0.055), () => rag(g, 0.5 * sc, Math.min(0.95 * sc, a.y + 0.1), rgb(0x8a1c14), i * 5 + 2, 0.35, mul(GOLD, 0.9)));
    })));
    if (sv.door[0]) sv.add(g, 1500, () => { const a = sv.door[sv.door.length - 1]; sv.at(g, a, () => g.in(M(0, -a.y, 0.2), () => goldPile(g, 0.34 * sc, 0.2 * sc, 0.2 * sc, 5, 22))); });
    void k;
  },
};

// =====================================================================================================
// Realm styles: the machinery. A building's roofs are found by their tiles, taken off and re-covered in the
// culture's own way (or kept and re-coloured); what stood under them is rebuilt as that culture builds.
// =====================================================================================================
const R_CELL = 0.2;
const cellKey = (x, z) => (Math.floor(x / R_CELL) + 2048) * 4096 + Math.floor(z / R_CELL) + 2048;
const HUMBLE = new Set(['house', 'hut', 'inn', 'stall', 'tent', 'dockhouse', 'alchemist', 'marketHall', 'tower', 'barracks', 'crates']);
const GRAND = new Set(['keep', 'palace', 'temple', 'bank', 'shrine', 'statue', 'pillar', 'fountain']);
const byCache = new Map();
/** a style as it applies to one building: st.by = { humble | grand | plain | <model id>: overrides } (pal and roof merge key by key) */
function styleFor(st, id) {
  if (!st.by) return st;
  const o1 = st.by[HUMBLE.has(id) ? 'humble' : GRAND.has(id) ? 'grand' : 'plain'], o2 = st.by[id];
  if (!o1 && !o2) return st;
  let m = byCache.get(st);
  if (!m) byCache.set(st, m = new Map());
  if (!m.has(id)) { const r = { ...st, ...o1, ...o2 }; r.pal = { ...st.pal, ...(o1 && o1.pal), ...(o2 && o2.pal) }; r.roof = { ...st.roof, ...(o1 && o1.roof), ...(o2 && o2.roof) }; m.set(id, r); }
  return m.get(id);
}
const roofSpec = (r, c) => { const s = r[c.type]; return s && s.kind && s.kind !== 'keep' ? s : null; };
// 0: the old roof stays and something is added; 1: its tiles come off and a skin is laid over what is left; 2: everything above the eaves goes
const ROOF_MODE = { gables: 0, drape: 1, hip: 2, flat: 2, dome: 2, step: 2, hull: 2, shikhara: 2, cap: 2 };

/**
 * The roofs of a finished building: every run of roof tiles (small flat sloping faces with a roof's finish) or thatch,
 * gathered into clusters by plan position and height. Returns vr (vertex -> cluster + 1, tiles and ridge pieces),
 * tf (triangle -> cluster + 1), clusters [{ x0, x1, z0, z1, eY (eaves), rY (ridge), type 'main' | 'cap', ax, rl, gable, fill, ok }]
 * and the plan cells the tiles lie in.
 */
function findRoofs(P, N, A, cls, I, ni, n, pinned) {
  const rv = new Uint8Array(n), vr = new Uint8Array(n), nt = ni / 3, tf = new Uint8Array(nt), tk = new Float64Array(nt), cells = new Map(), clusters = [];
  for (let i = 0; i < n; i++) {
    const o = i * 3, r = A[o];
    if (A[o + 1] > 0.3 || A[o + 2] > 0.3 || P[o + 1] < 0.6 || pinned[i]) continue;
    if (r > 0.775 && r < 0.855) rv[i] = 1; else if (r > 0.975 && r < 0.985) rv[i] = 2; else if (r > 0.896 && r < 0.904 && (cls[i] === C_TIMBER || cls[i] === C_RED || cls[i] === C_SLATE)) rv[i] = 1;
  }
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], ka = rv[a];
    if (!ka || !rv[b] || !rv[c]) continue;
    const a3 = a * 3, b3 = b * 3, c3 = c * 3;
    if (ka !== 2 && (N[a3] * N[b3] + N[a3 + 1] * N[b3 + 1] + N[a3 + 2] * N[b3 + 2] < 0.999 || N[a3] * N[c3] + N[a3 + 1] * N[c3 + 1] + N[a3 + 2] * N[c3 + 2] < 0.999)) continue;
    const ux = P[b3] - P[a3], uy = P[b3 + 1] - P[a3 + 1], uz = P[b3 + 2] - P[a3 + 2], vx = P[c3] - P[a3], vy = P[c3 + 1] - P[a3 + 1], vz = P[c3 + 2] - P[a3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx, l = Math.hypot(fx, fy, fz);
    if (l < 1e-9 || (ka !== 2 && (l > 0.07 || l < 0.0065))) continue;   // a tile's upper face: not its thin foot and sides, not a big board
    // pitch and downhill direction from the face's own (shared) normal: every triangle of one tile agrees
    let qx = N[a3] + N[b3] + N[c3], qy = N[a3 + 1] + N[b3 + 1] + N[c3 + 1], qz = N[a3 + 2] + N[b3 + 2] + N[c3 + 2];
    const ql = Math.hypot(qx, qy, qz) || 1, qs = qy < 0 ? -1 / ql : 1 / ql; qx *= qs; qy *= qs; qz *= qs;   // (some roofs are wound inside out: only the slope matters)
    const s = qy;
    if (s < 0.2 || (ka !== 2 && s > 0.975) || Math.abs(fy) / l < 0.12) continue;
    const key = cellKey((P[a3] + P[b3] + P[c3]) / 3, (P[a3 + 2] + P[b3 + 2] + P[c3 + 2]) / 3) * 8 + Math.min(4, Math.floor(s * 5));   // cells are kept apart by pitch, so a spire never blurs into the roof beside it
    let e = cells.get(key);
    if (!e) cells.set(key, e = { y0: 9e9, y1: -9e9, n: 0, c: -1, ar: 0, py: 0, hx: 0, hz: 0 });
    e.ar += l; e.py += qy * l; e.hx += qx * l; e.hz += qz * l;
    const lo = Math.min(P[a3 + 1], P[b3 + 1], P[c3 + 1]), hi = Math.max(P[a3 + 1], P[b3 + 1], P[c3 + 1]);
    if (lo < e.y0) e.y0 = lo; if (hi > e.y1) e.y1 = hi; e.n++;
    tf[t] = 255; tk[t] = key;
  }
  if (!cells.size) return { vr, tf, clusters, cells };
  for (const [k0, e0] of cells) {
    if (e0.c >= 0) continue;
    const ci = clusters.length, st = [k0]; e0.c = ci;
    let cnt = 0;
    while (st.length) {
      const key = st.pop(), e = cells.get(key); cnt++;
      const base = Math.floor(key / 8);
      for (let d = 0; d < 45; d++) {
        const q = Math.floor(d / 5), dx = (q % 3) - 1, dz = Math.floor(q / 3) - 1, nk = (base + dx * 4096 + dz) * 8 + (d % 5), f = cells.get(nk);
        if (!f || f.c >= 0 || f.y0 > e.y1 + 0.2 || e.y0 > f.y1 + 0.2) continue;
        if (Math.abs(e.py / e.ar - f.py / f.ar) > 0.16) continue;   // a different pitch: a spire on a nave, a turret by a hall
        const ex = e.hx / e.ar, ez = e.hz / e.ar, gx = f.hx / f.ar, gz = f.hz / f.ar;
        if ((dx || dz) && ex * gx + ez * gz < -0.08 && ex * dx + ez * dz > 0.05 && gx * dx + gz * dz < -0.05) continue;   // a valley between two roofs that face each other
        f.c = ci; st.push(nk);
      }
    }
    clusters.push(cnt);
  }
  { // two slopes parted by a ridge capping are one roof: join clusters of the same height and pitch that lie side by side
    const pre = clusters.map(() => ({ x0: 9e9, x1: -9e9, z0: 9e9, z1: -9e9, y0: 9e9, y1: -9e9, py: 0, ar: 0 })), par = clusters.map((_, i) => i), find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (const [key, e] of cells) { if (e.c < 0) continue; const p = pre[e.c], b = Math.floor(key / 8), x = (Math.floor(b / 4096) - 2048) * R_CELL, z = ((b % 4096) - 2048) * R_CELL; if (x < p.x0) p.x0 = x; if (x + R_CELL > p.x1) p.x1 = x + R_CELL; if (z < p.z0) p.z0 = z; if (z + R_CELL > p.z1) p.z1 = z + R_CELL; if (e.y0 < p.y0) p.y0 = e.y0; if (e.y1 > p.y1) p.y1 = e.y1; p.py += e.py; p.ar += e.ar; }
    const m = Math.min(pre.length, 60);
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      const a = pre[i], b = pre[j];
      if (Math.abs(a.y1 - b.y1) > 0.12 || Math.abs(a.y0 - b.y0) > 0.3 || a.y1 - a.y0 < 0.3 || Math.abs(a.py / a.ar - b.py / b.ar) > 0.1) continue;
      const gx = Math.max(a.x0 - b.x1, b.x0 - a.x1), gz = Math.max(a.z0 - b.z1, b.z0 - a.z1);
      if (Math.max(gx, gz) < 0.45 && Math.min(gx, gz) < -0.5) par[find(j)] = find(i);
    }
    // keep the two hundred largest, renumbered
    const size = clusters.map(() => 0), map = new Map();
    for (const e of cells.values()) { e.c = find(e.c); size[e.c]++; }
    const order = size.map((n, i) => [n, i]).filter((q) => q[0] > 0).sort((p, q) => q[0] - p[0]).slice(0, 200);
    clusters.length = 0;
    order.forEach(([cnt, i], k) => { map.set(i, k); clusters.push({ i: k, cells: cnt, tris: 0, x0: 9e9, x1: -9e9, z0: 9e9, z1: -9e9, eY: 9e9, rY: -9e9, a0: 9e9, a1: -9e9, b0: 9e9, b1: -9e9 }); });
    for (const e of cells.values()) e.c = map.has(e.c) ? map.get(e.c) : -1;
  }
  for (let t = 0; t < nt; t++) {
    if (!tf[t]) continue;
    const e = cells.get(tk[t]);
    if (e.c < 0) { tf[t] = 0; continue; }
    vr[I[t * 3]] = vr[I[t * 3 + 1]] = vr[I[t * 3 + 2]] = e.c + 1;
  }
  const blank = (i) => ({ i, cells: 0, tris: 0, x0: 9e9, x1: -9e9, z0: 9e9, z1: -9e9, eY: 9e9, rY: -9e9, a0: 9e9, a1: -9e9, b0: 9e9, b1: -9e9, corner: 0 });
  const measure = () => { // extents of every cluster from its tile vertices
    for (const c of clusters) Object.assign(c, blank(c.i));
    for (let i = 0; i < n; i++) { if (!vr[i]) continue; const c = clusters[vr[i] - 1], o = i * 3, x = P[o], y = P[o + 1], z = P[o + 2]; c.tris++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (z < c.z0) c.z0 = z; if (z > c.z1) c.z1 = z; if (y < c.eY) c.eY = y; if (y > c.rY) c.rY = y; }
  };
  measure();
  { // a scrap of roof lying wholly inside a larger one (the cut tiles down a hip) is part of it
    const to = clusters.map((_, i) => i);
    for (const b of clusters) { if (!b.tris) continue; let best = null; for (const a of clusters) if (a !== b && a.tris > b.tris && b.x0 > a.x0 - 0.1 && b.x1 < a.x1 + 0.1 && b.z0 > a.z0 - 0.1 && b.z1 < a.z1 + 0.1 && b.eY > a.eY - 0.1 && b.rY < a.rY + 0.1 && (!best || a.tris > best.tris)) best = a; if (best) to[b.i] = best.i; }
    for (let i = 0; i < n; i++) if (vr[i]) { let c = vr[i] - 1, q = 0; while (to[c] !== c && q++ < 8) c = to[c]; vr[i] = c + 1; }
    for (const e of cells.values()) if (e.c >= 0) { let c = e.c, q = 0; while (to[c] !== c && q++ < 8) c = to[c]; e.c = c; }
  }
  { // a cone or spire that runs into a bigger roof is lifted out of it: round a peak, the tiles fall away alike on every side
    const lists = clusters.map(() => []);
    for (let i = 0; i < n; i++) if (vr[i]) lists[vr[i] - 1].push(i);
    const NB = 15, sum = new Float64Array(NB * 8), n0 = clusters.length;
    for (let ci = 0; ci < n0; ci++) {
      let list = lists[ci];
      for (let rep = 0; rep < 6 && list.length > 500 && clusters.length < 250; rep++) {
        let top = -1e9, ti = -1, ax = 0, az = 0, cnt = 0;
        for (const i of list) if (P[i * 3 + 1] > top) { top = P[i * 3 + 1]; ti = i; }
        for (const i of list) if (P[i * 3 + 1] > top - 0.08 && Math.abs(P[i * 3] - P[ti * 3]) < 0.25 && Math.abs(P[i * 3 + 2] - P[ti * 3 + 2]) < 0.25) { ax += P[i * 3]; az += P[i * 3 + 2]; cnt++; }
        ax /= cnt; az /= cnt;
        sum.fill(-1e9);   // the highest tile in each ring and sector: the cone's own skin, whatever lies under its eaves
        for (const i of list) { const dx = P[i * 3] - ax, dz = P[i * 3 + 2] - az, r = Math.hypot(dx, dz); if (r >= NB * 0.1) continue; const q = Math.floor(r / 0.1) * 8 + (Math.floor(((Math.atan2(dz, dx) + Math.PI) / TAU) * 8) & 7); if (P[i * 3 + 1] > sum[q]) sum[q] = P[i * 3 + 1]; }
        let rmax = 0, yR = top;
        for (let b = 0; b < NB; b++) {
          let mean = 0, k = 0, ok = true;
          for (let q = 0; q < 8; q++) if (sum[b * 8 + q] > -1e8) { mean += sum[b * 8 + q]; k++; }
          if (k < (b ? 7 : 2)) break;
          mean /= k;
          for (let q = 0; q < 8; q++) if (sum[b * 8 + q] > -1e8 && Math.abs(sum[b * 8 + q] - mean) > 0.2) ok = false;
          if (!ok || mean > yR + 0.05) break;
          rmax = (b + 1) * 0.1; yR = mean;
        }
        if (rmax < 0.3 || top - yR < 0.45) break;
        const inside = [], rest = [], kk = (top - yR) / rmax;
        let corners = 0;
        for (const i of list) {
          const dx = P[i * 3] - ax, dz = P[i * 3 + 2] - az, r = Math.hypot(dx, dz), y = P[i * 3 + 1];
          if (r <= rmax + 0.05 && y > yR - 0.15) inside.push(i);
          else { rest.push(i); if (r < rmax * 1.5 && y > yR - 0.08 && Math.abs(y - (top - kk * Math.max(Math.abs(dx), Math.abs(dz)))) < 0.14) corners++; }
        }
        if (corners > inside.length * 0.04 || rest.length < 200) break;   // a pyramid (its corners carry on past the circle), or the whole cluster
        const nc = clusters.length; clusters.push(blank(nc));
        for (const i of inside) vr[i] = nc + 1;
        list = rest;
      }
    }
  }
  measure();
  { // the eaves are where the tiles begin in earnest: a stray tile lower down (a hatch, a hood) does not count
    const NBH = 40, hist = clusters.map(() => new Uint32Array(NBH)), tot = clusters.map(() => 0);
    for (let i = 0; i < n; i++) { if (!vr[i]) continue; const c = clusters[vr[i] - 1]; hist[c.i][Math.min(NBH - 1, Math.floor(((P[i * 3 + 1] - c.eY) / Math.max(1e-6, c.rY - c.eY)) * NBH))]++; tot[c.i]++; }
    for (const c of clusters) { let acc = 0, b = 0; while (b < NBH - 1 && acc + hist[c.i][b] < tot[c.i] * 0.02) acc += hist[c.i][b++]; c.eY += ((c.rY - c.eY) * b) / NBH; }
  }
  const occ = clusters.map(() => new Set());
  for (let i = 0; i < n; i++) { // where the ridge runs, how much of its outline a roof fills, whether its corners are tiled
    if (!vr[i]) continue;
    const c = clusters[vr[i] - 1], o = i * 3, x = P[o], z = P[o + 2];
    occ[c.i].add(cellKey(x, z));
    if (Math.abs(x - (c.x0 + c.x1) / 2) > 0.41 * (c.x1 - c.x0) && Math.abs(z - (c.z0 + c.z1) / 2) > 0.41 * (c.z1 - c.z0)) c.corner++;
    if (P[o + 1] < c.rY - Math.max(0.06, 0.08 * (c.rY - c.eY))) continue;
    if (x < c.a0) c.a0 = x; if (x > c.a1) c.a1 = x; if (z < c.b0) c.b0 = z; if (z > c.b1) c.b1 = z;
  }
  for (let t = 0; t < nt; t++) if (tf[t]) tf[t] = vr[I[t * 3]];
  for (const c of clusters) {
    c.tris = Math.round(c.tris / 1.7); c.cells = occ[c.i].size;
    c.w = c.x1 - c.x0; c.d = c.z1 - c.z0; c.cx = (c.x0 + c.x1) / 2; c.cz = (c.z0 + c.z1) / 2; c.r = (c.w + c.d) / 4;
    c.fill = Math.min(1, (c.cells * R_CELL * R_CELL) / Math.max(0.04, (c.w + R_CELL) * (c.d + R_CELL)));
    const rw = c.a1 - c.a0, rd = c.b1 - c.b0, apex = rw < 0.5 && rd < 0.5, big = Math.max(c.w, c.d);
    c.type = apex && Math.abs(c.w - c.d) < 0.35 && (big < 1.35 || (big < 2.7 && c.corner < 4)) ? 'cap' : 'main';
    c.ok = c.tris >= 60 && c.cells >= 5 && c.rY - c.eY > 0.22 && c.i < 254 && (c.type === 'cap' || Math.min(c.w, c.d) > 0.7);
    c.ax = apex ? (c.w >= c.d ? 0 : 1) : rw >= rd ? 0 : 1; c.rl = apex ? 0 : Math.max(rw, rd) / 2;
    c.gable = !apex && (c.ax ? rd > c.d - 0.5 : rw > c.w - 0.5);
  }
  // ridge tiles, finials and flashings ride on the tiles: they go where the tiles go
  for (let t = 0; t < nt; t++) {
    if (tf[t]) continue;
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    if (!(rv[a] || A[a * 3 + 1] > 0.5) || !(rv[b] || A[b * 3 + 1] > 0.5) || !(rv[c] || A[c * 3 + 1] > 0.5) || pinned[a] || pinned[b] || pinned[c]) continue;
    const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3, y = Math.min(P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1]), key = cellKey(x, z);
    let best = null;
    for (let d = 0; d < 45; d++) { const q = Math.floor(d / 5), f = cells.get((key + ((q % 3) - 1) * 4096 + Math.floor(q / 3) - 1) * 8 + (d % 5)); if (f && f.c >= 0 && clusters[f.c].ok && y >= f.y0 - 0.06 && y < f.y1 + 0.7 && (!best || q === 4)) best = f; }
    if (best) { tf[t] = best.c + 1; vr[a] = vr[b] = vr[c] = best.c + 1; }
  }
  return { vr, tf, clusters, cells };
}
/** the walls a roof sat on: for each side, the plane most wall faces stand in (searched just below the eaves) */
function wallRect(c, env) {
  if (c.rect) return c.rect;
  const { P, N, n, vr } = env, y0 = c.eY - 0.9, y1 = c.cutY + 0.02, m = 0.1, B = 0.05, H = [new Map(), new Map(), new Map(), new Map()];
  for (let i = 0; i < n; i++) {
    const o = i * 3, y = P[o + 1], x = P[o], z = P[o + 2];
    if (y < y0 || y > y1 || vr[i] || x < c.x0 - m || x > c.x1 + m || z < c.z0 - m || z > c.z1 + m) continue;
    const nx = N[o], nz = N[o + 2], h = nx > 0.85 ? 0 : nx < -0.85 ? 1 : nz > 0.85 ? 2 : nz < -0.85 ? 3 : -1;
    if (h < 0) continue;
    const q = Math.round((h < 2 ? x : z) / B); H[h].set(q, (H[h].get(q) || 0) + 1);
  }
  const pick = (h, sign, mid, fall) => { let mx = 0; for (const [q, v] of H[h]) if ((q * B - mid) * sign > 0.15 && v > mx) mx = v; if (mx < 10) return fall; let best = null; for (const [q, v] of H[h]) if ((q * B - mid) * sign > 0.15 && v >= mx * 0.4 && (best === null || (q - best) * sign > 0)) best = q; return best * B; };
  const inset = Math.min(0.22, c.w * 0.12, c.d * 0.12);
  const r = { x1: pick(0, 1, c.cx, c.x1 - inset), x0: pick(1, -1, c.cx, c.x0 + inset), z1: pick(2, 1, c.cz, c.z1 - inset), z0: pick(3, -1, c.cz, c.z0 + inset) };
  r.x0 = clamp(r.x0, c.x0, c.cx - 0.12); r.x1 = clamp(r.x1, c.cx + 0.12, c.x1); r.z0 = clamp(r.z0, c.z0, c.cz - 0.12); r.z1 = clamp(r.z1, c.cz + 0.12, c.z1);
  return (c.rect = r);
}
/** the frame a roof is built in: X along its ridge. A, B = half sizes of the walls; EA, EB = how far the old eaves reached */
function roofFrame(c, env) {
  const r = wallRect(c, env), cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, hx = (r.x1 - r.x0) / 2, hz = (r.z1 - r.z0) / 2;
  const ex = Math.min(c.x1 - cx, cx - c.x0), ez = Math.min(c.z1 - cz, cz - c.z0);
  const bb = env.bb, lx = Math.min(bb.x1 - cx, cx - bb.x0) + 0.06, lz = Math.min(bb.z1 - cz, cz - bb.z0) + 0.06;   // nothing new may reach past the building's own outline
  return c.ax ? { m: M(cx, 0, cz, 0, 90, 0), A: hz, B: hx, EA: Math.min(ez, lz), EB: Math.min(ex, lx), LA: lz, LB: lx, cx, cz } : { m: M(cx, 0, cz), A: hx, B: hz, EA: Math.min(ex, lx), EB: Math.min(ez, lz), LA: lx, LB: lz, cx, cz };
}
/** flat polygon facing down whatever order its corners come in */
function flatDown(g, pts, col) {
  const a = pts[0], b = pts[1], c = pts[2];
  if ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0) pts = pts.slice().reverse();
  g.flat(pts, col);
}
/** a wall face W x H on the local XY plane facing +Z (origin at its lower left), fine enough to carry a painted pattern */
function wallFace(g, W, H, col, d = 0.13) { g.sheet(Math.max(1, Math.round(W / d)), Math.max(1, Math.round(H / d)), (u, v) => [u * W, v * H, 0], col); }
/**
 * Four walls round a box A x B (half sizes) from y0 to y1, in the roof frame. w = { stone: hex, st: {...} } for coursed
 * stone, or { col, kind, rough, frame (timber colour), every (post spacing), win: { col, glow, shape, trim } }.
 */
function wallBody(g, A, B, y0, y1, w, seed = 1) {
  const H = y1 - y0;
  if (H < 0.03) return;
  if (w.stone !== undefined) stoneBox(g, A, B, y0, y1, stoneStyle(w.stone, { cell: 0.22 / qual(), chip: 0.08, ...w.st }), seed, { noFoot: true, quoin: w.quoin });
  else {
    g.surf(w.kind ?? K_PLASTER, w.rough ?? 0.92, w.metal || 0);
    for (let s = 0; s < 4; s++) { const W = s % 2 ? B : A, D = s % 2 ? A : B; g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-W, y0, D)), () => wallFace(g, 2 * W, H, w.col)); }
    if (w.frame) { // posts at the corners and between, a rail top and bottom
      g.surf(K_WOOD, 0.88);
      const tc = woodTint(w.frame, seed), t = w.thick || 0.09;
      for (let s = 0; s < 4; s++) {
        const W = s % 2 ? B : A, D = s % 2 ? A : B, np = Math.max(1, Math.round((2 * W) / (w.every || 0.8)));
        g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, y0, D)), () => {
          for (let i = 0; i <= np; i++) g.in(M(-W + (2 * W * i) / np, H / 2, 0.012, 0, 0, 90), () => g.beam(H, t, 0.05, 0.008, tc, 1));
          for (const y of w.rails || [0.04, H - 0.04]) g.in(M(0, y, 0.016), () => g.beam(2 * W + t, t, 0.05, 0.008, tc, 2));
          if (w.brace && H > 0.4) for (let i = 0; i < np; i++) { const xa = -W + (2 * W * i) / np, xb = -W + (2 * W * (i + 1)) / np, f = i % 2 ? 1 : 0; g.beamTo([f ? xb : xa, 0.05, 0.01], [f ? xa : xb, H - 0.05, 0.01], t * 0.8, 0.04, 0.006, tc, 1, [0, 0, 1]); }
        });
      }
    }
  }
  const wn = w.win;
  if (wn && H > 0.42) for (let s = 0; s < 4; s++) {
    const W = s % 2 ? B : A, D = s % 2 ? A : B, nw = Math.max(1, Math.round((2 * W) / (wn.every || 1.05))), ww = wn.w || 0.2, wh = Math.min(wn.h || 0.36, H * 0.6), yc = y0 + H * 0.52;
    g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(0, yc, D + 0.02)), () => { for (let i = 0; i < nw; i++) g.in(M(-W + (2 * W * (i + 0.5)) / nw, 0, 0), () => windowPane(g, ww, wh, wn)); });
  }
}
/** a small window on the local XY plane facing +Z, centred: shape 'sq' | 'round' | 'point' | 'horse' | 'screen' */
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
const CAVETTO = [[0, 0], [0.03, 0.012], [0.03, 0.045], [0, 0.06], [0.02, 0.12], [0.07, 0.19], [0.11, 0.22], [0.11, 0.25], [0, 0.25]];
/** what runs round the edge of a flat roof A x B at height y: o.merlon = 'none' | 'cavetto' | a MERLON shape; returns its height */
function roofEdge(g, A, B, y, o) {
  const col = o.edge || [0.6, 0.58, 0.5], kind = o.merlon || 'none', mh = o.mh || 0.22;
  g.surf(o.edgeKind ?? K_STONE, o.edgeRough ?? 0.9, o.edgeMetal || 0);
  if (kind === 'cavetto') {
    for (let s = 0; s < 4; s++) { const W = s % 2 ? B : A, D = s % 2 ? A : B; g.in(M(0, y - 0.06, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => g.mould(CAVETTO, 2 * W, col, 1, 1, Math.max(2, Math.round((2 * W) / 0.09)))); }
    return 0.19;
  }
  const rim = o.rim ?? 0.09, t = 0.11;
  for (let s = 0; s < 4; s++) {
    const W = s % 2 ? B : A, D = s % 2 ? A : B;
    g.in(M(0, y, 0, 0, s * 90, 0).multiply(M(0, 0, D - t / 2 + 0.02)), () => {
      g.in(M(0, rim / 2 - 0.02, 0), () => g.cbox(2 * W + 0.04, rim + 0.04, t, 0.012, col));
      if (kind === 'none') return;
      const mw = o.mw || 0.24, nm = Math.max(2, Math.round((2 * W) / (mw * (o.gap || 1.9)))), shape = MERLON[kind](mw, mh);
      for (let i = 0; i < nm; i++) g.in(M(-W + (2 * W * (i + 0.5)) / nm, rim, 0), () => prism(g, shape, t, o.merlonCol || col, [0, mh * 0.2]));
    });
  }
  return rim + (kind === 'none' ? 0 : mh);
}
/**
 * One tier of tiled roof in the roof frame: eaves at +-A, +-B (height y0), rising h to a top rectangle +-a, +-b (a ridge when
 * b = 0, a point when both are). o: pal, curve (>1 = concave, the eastern sweep), lift (how far the corners turn up),
 * tw, th (tile size), round, ridge (colour), tip (corner horns), under (soffit colour), wall [Aw, Bw] where the soffit ends.
 */
function hipTier(g, A, B, a, b, y0, h, o, seed = 1) {
  const p = o.curve ?? 1, lift = o.lift || 0, tw = o.tw || 0.2, th = o.th || 0.17;
  const yAt = (k, u) => y0 + h * Math.pow(Math.max(0, k), p) + lift * Math.pow(Math.abs(2 * u - 1), 2.6) * (1 - k) * (1 - k);
  const F = [[[-A, B], [A, B], [-a, b], [a, b]], [[A, -B], [-A, -B], [a, -b], [-a, -b]], [[A, B], [A, -B], [a, b], [a, -b]], [[-A, -B], [-A, B], [-a, -b], [-a, b]]];
  F.forEach(([e0, e1, t0, t1], fi) => {
    const wb = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]), wt = Math.hypot(t1[0] - t0[0], t1[1] - t0[1]), run = fi < 2 ? B - b : A - a;
    if (run < 0.02) return;
    const rows = Math.max(2, Math.round(Math.hypot(h, run) / th));
    g.surf(K_ROOF, o.rough ?? 0.8, o.metal || 0);
    tiles(g, rows, (j) => Math.max(1, lerp(wb, wt, (j + 0.5) / rows) / tw), (u, v) => { const k = Math.min(v, 0.985); return [lerp(lerp(e0[0], e1[0], u), lerp(t0[0], t1[0], u), k), yAt(k, u), lerp(lerp(e0[1], e1[1], u), lerp(t0[1], t1[1], u), k)]; }, { pal: o.pal, lift: o.tlift || 0.02, seed: seed + fi, round: o.round, gap: o.gap });
  });
  const rc = o.ridge || mul(o.pal[0], 0.7), rr = o.ridgeR || 0.055, ns = lift || p !== 1 ? 4 : 1;
  g.surf(K_ROOF, 0.7, o.ridgeMetal || 0);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    let prev = null;
    for (let q = 0; q <= ns; q++) { const k = q / ns, pt = [sx * lerp(A + 0.02, a, k), yAt(k, 1) + 0.012, sz * lerp(B + 0.02, b, k)]; if (prev) ridge(g, prev, pt, rr, rc, seed + sx * 3 + sz + q); prev = pt; }
    if (o.tip) g.in(M(sx * (A + 0.02), yAt(0, 1) - 0.02, sz * (B + 0.02), 0, Math.atan2(sx, sz) / DEG, 0), () => { horn(g, [[0, 0, -0.12], [0, 0.02, 0.06], [0, 0.1, 0.2], [0, 0.24, 0.27]], 0.05, o.tip, mul(o.tip, 0.6), { rings: 0, nu: 6, nv: 8 }); g.surf(K_ROOF, 0.7, o.ridgeMetal || 0); });
  }
  if (b < 0.02 && a > 0.04) ridge(g, [-a - 0.07, y0 + h + 0.02, 0], [a + 0.07, y0 + h + 0.02, 0], rr * 1.25, rc, seed + 9);
  else if (a < 0.02 && b > 0.04) ridge(g, [0, y0 + h + 0.02, -b - 0.07], [0, y0 + h + 0.02, b + 0.07], rr * 1.25, rc, seed + 9);
  // the underside of the eaves
  const [Aw, Bw] = o.wall || [A - 0.25, B - 0.25], dk = o.under || [0.05, 0.04, 0.035], nsf = lift ? 6 : 1;
  g.surf(K_PLAIN, 1);
  for (const [e0, e1, w0, w1] of [[[-A, B], [A, B], [-Aw, Bw], [Aw, Bw]], [[A, -B], [-A, -B], [Aw, -Bw], [-Aw, -Bw]], [[A, B], [A, -B], [Aw, Bw], [Aw, -Bw]], [[-A, -B], [-A, B], [-Aw, -Bw], [-Aw, Bw]]]) {
    for (let i = 0; i < nsf; i++) { const u0 = i / nsf, u1 = (i + 1) / nsf; flatDown(g, [[lerp(e0[0], e1[0], u0), yAt(0, u0) - 0.014, lerp(e0[1], e1[1], u0)], [lerp(e0[0], e1[0], u1), yAt(0, u1) - 0.014, lerp(e0[1], e1[1], u1)], [lerp(w0[0], w1[0], u1), y0 - 0.014, lerp(w0[1], w1[1], u1)], [lerp(w0[0], w1[0], u0), y0 - 0.014, lerp(w0[1], w1[1], u0)]], dk); }
  }
}
// dome and cap outlines: [radius, height] in units of the base radius, bottom to top
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
const ROOFS = {
  /** a tiled hip roof, straight or swept, in one tier or two */
  hip(g, c, o, env) {
    const f = roofFrame(c, env), ov = o.ov ?? 0.26, A = Math.min(f.A + ov, f.EA + c.over, f.LA), B = Math.min(f.B + ov, f.EB + c.over, f.LB), y0 = c.cutY, H = clamp((c.rY - c.eY) * (o.hs ?? 0.85), 0.4, o.maxH || 9), sd = env.seed % 977;
    const top = (a, b, hk) => (a >= b ? [Math.max(0, a - b * hk), 0] : [0, Math.max(0, b - a * hk)]);
    g.in(f.m, () => {
      g.surf(K_WOOD, 0.9); // the wall plate the roof sits on
      for (let s = 0; s < 4; s++) { const W = s % 2 ? f.B : f.A, D = s % 2 ? f.A : f.B; g.in(M(0, y0 - 0.03, 0, 0, s * 90, 0).multiply(M(0, 0, D)), () => g.beam(2 * W + 0.1, 0.1, 0.1, 0.012, o.plate || woodTint(rgb(0x4a3323), s), 2)); }
      if (o.tiers === 2 && Math.min(f.A, f.B) > 1.2 && H > 1.0) {
        const s = o.shrink || 0.62, A2 = f.A * s, B2 = f.B * s, h1 = H * 0.4, hb = clamp(H * 0.24, 0.26, 0.5), h2 = H * 0.62, [a2, b2] = top(A2 + ov * 0.85, B2 + ov * 0.85, o.hipK ?? 1);
        hipTier(g, A, B, A2, B2, y0, h1, { ...o, wall: [f.A, f.B] }, sd);
        wallBody(g, A2, B2, y0 + h1 - 0.04, y0 + h1 + hb, o.band || { col: [0.5, 0.1, 0.07] }, sd + 3);
        hipTier(g, A2 + ov * 0.85, B2 + ov * 0.85, a2, b2, y0 + h1 + hb, h2, { ...o, wall: [A2, B2] }, sd + 20);
        c.top = y0 + h1 + hb + h2;
      } else { const [a, b] = top(A, B, o.hipK ?? 1); hipTier(g, A, B, a, b, y0, H, { ...o, wall: [f.A, f.B] }, sd); c.top = y0 + H; }
    });
  },
  /** a flat roof behind a parapet, on an upper storey of its own */
  flat(g, c, o, env) {
    const f = roofFrame(c, env), y0 = c.cutY - 0.01, y1 = y0 + clamp((c.rY - c.eY) * (o.f ?? 0.45), o.min ?? 0.25, o.max ?? 1.25), out = o.out || 0;
    g.in(f.m, () => {
      wallBody(g, f.A + out, f.B + out, y0, y1, o.wall, env.seed % 911);
      g.surf(K_STONE, 0.95); g.flat([[-f.A, y1 + 0.004, f.B], [f.A, y1 + 0.004, f.B], [f.A, y1 + 0.004, -f.B], [-f.A, y1 + 0.004, -f.B]], o.floor || [0.5, 0.47, 0.4]);
      const eh = roofEdge(g, f.A + out, f.B + out, y1, o);
      c.top = y1 + eh;
      if (o.on) c.top = Math.max(c.top, y1 + (o.on(g, f.A, f.B, y1, c, env) || 0));
    });
  },
  /** a dome on a drum over the middle of a flat roof, lesser domes beside it when the roof is long */
  dome(g, c, o, env) {
    const f = roofFrame(c, env), y0 = c.cutY - 0.01, y1 = y0 + clamp((c.rY - c.eY) * (o.f ?? 0.3), o.min ?? 0.2, o.max ?? 1.0), sd = env.seed % 911;
    g.in(f.m, () => {
      wallBody(g, f.A, f.B, y0, y1, o.wall, sd);
      g.surf(K_STONE, 0.95); g.flat([[-f.A, y1 + 0.004, f.B], [f.A, y1 + 0.004, f.B], [f.A, y1 + 0.004, -f.B], [-f.A, y1 + 0.004, -f.B]], o.floor || [0.5, 0.47, 0.4]);
      roofEdge(g, f.A, f.B, y1, o);
      const R = Math.min(f.A, f.B) * (o.rk ?? 0.78), long = f.A / f.B;
      let top = 0;
      const od = { ...o, kind: o.surf };
      g.in(M(0, y1, 0), () => { top = domeOn(g, R, od, sd); });
      if (long > 1.4) for (const e of [-1, 1]) g.in(M(e * (f.A - R * 0.5 - 0.08), y1, 0), () => domeOn(g, R * 0.5, { ...od, drumWin: null }, sd + e));
      else if (o.four && R > 0.75) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.in(M(sx * (f.A - R * 0.26), y1, sz * (f.B - R * 0.26)), () => domeOn(g, R * 0.24, { ...od, drumWin: null, finS: 0.3 }, sd + sx + sz * 2));
      c.top = y1 + top;
    });
  },
  /** what a round turret wears instead of its cone */
  cap(g, c, o, env) {
    const R = c.r + (o.out || 0), y0 = c.cutY - 0.02;
    g.in(M(c.cx, y0, c.cz), () => {
      if (o.spire) { const H = clamp((c.rY - c.eY) * (o.hs ?? 1.1), R * 1.6, 3); spire(g, R * 1.1, H, { ...o, lite: true }, env.seed % 577 + c.i); c.top = y0 + H * 1.15; return; }
      if (o.merlon) { g.surf(K_STONE, 0.93); g.cyl(R, R, 0.2, nq(16), o.edge || [0.6, 0.58, 0.5], false, true); const nm = Math.max(6, Math.round((TAU * R) / 0.34)), shape = MERLON[o.merlon](0.2, o.mh || 0.22); for (let i = 0; i < nm; i++) g.in(M(0, 0.2, 0, 0, (i * 360) / nm, 0).multiply(M(0, 0, R - 0.06)), () => prism(g, shape, 0.1, o.merlonCol || o.edge || [0.6, 0.58, 0.5], [0, 0.04])); c.top = y0 + 0.42; if (!o.shape) return; }
      const Rd = o.merlon ? R * 0.6 : R * (o.rk ?? 1);
      let top = 0;
      g.in(M(0, o.merlon ? 0.2 : 0, 0), () => { top = domeOn(g, Rd, { drum: 0.12, hk: clamp(((c.rY - c.eY) / (profTop(DOME[o.shape || 'cone']) * Rd)) * (o.hs ?? 1), 0.7, 3.2), ...o, kind: o.surf }, env.seed % 577 + c.i); });
      c.top = y0 + (o.merlon ? 0.2 : 0) + top;
    });
  },
  /** stepped terraces, each smaller than the last */
  step(g, c, o, env) {
    const f = roofFrame(c, env), y0 = c.cutY - 0.01, n = o.n || 3, H = clamp((c.rY - c.eY) * (o.f ?? 0.7), 0.6, o.max ?? 2.2), ins = Math.min(o.inset || 0.26, (Math.min(f.A, f.B) * 0.6) / n), sd = env.seed % 911;
    g.in(f.m, () => {
      let y = y0;
      for (let i = 0; i < n; i++) {
        const A = f.A - i * ins, B = f.B - i * ins, h = (H / n) * (i === 0 ? 1.15 : 0.92);
        wallBody(g, A, B, y, y + h, i === 0 && o.wall0 ? o.wall0 : o.wall, sd + i * 7);
        g.surf(K_STONE, 0.95); g.flat([[-A, y + h + 0.003, B], [A, y + h + 0.003, B], [A, y + h + 0.003, -B], [-A, y + h + 0.003, -B]], o.floor || [0.5, 0.47, 0.4]);
        if (o.band) { g.surf(o.bandKind ?? K_PLAIN, o.bandRough ?? 0.6, o.bandMetal || 0, o.bandGlow || 0); for (let s = 0; s < 4; s++) { const W = s % 2 ? B : A, D = s % 2 ? A : B; g.in(M(0, y + h - 0.045, 0, 0, s * 90, 0).multiply(M(0, 0, D + 0.012)), () => g.beam(2 * W + 0.05, 0.09, 0.05, 0.01, o.band, Math.max(2, Math.round(W * 6)))); } }
        if (i === n - 1) { const eh = o.merlon ? roofEdge(g, A, B, y + h, o) : 0; c.top = y + h + eh; if (o.on) c.top = Math.max(c.top, y + h + (o.on(g, A, B, y + h, c, env) || 0)); }
        y += h;
      }
    });
  },
  /** a ship's hull turned keel up */
  hull(g, c, o, env) {
    const f = roofFrame(c, env), y0 = c.cutY - 0.03, A = Math.min(f.A + 0.4, f.EA + c.over + 0.15, f.LA), B = Math.min(f.B + 0.16, f.EB + c.over, f.LB), H = clamp(Math.min((c.rY - c.eY) * (o.hs ?? 0.8), B * 1.25), 0.45, 2.4), sd = env.seed % 911;
    const wood = o.pal || [rgb(0x4a4438), rgb(0x3e3c34), rgb(0x55503e), rgb(0x3a4038)];
    const pt = (u, v) => { const x = (u * 2 - 1) * A, e = Math.abs(u * 2 - 1), wid = B * Math.pow(Math.max(0, 1 - Math.pow(e, 2.6)), 0.6), w = v * 2 - 1, rise = 0.3 * H * Math.pow(e, 3); return [x * (1 + 0.05 * (1 - Math.abs(w))), y0 + (H + rise) * (1 - Math.pow(Math.abs(w), 1.8)) - 0.02, w * wid]; };
    g.in(f.m, () => {
      g.surf(K_WOOD, 0.9);
      g.sheet(nq(26), 28, pt, (x, y, z, nx, ny, nz, u, v) => {
        const sk = Math.abs(v * 2 - 1) * 7 + 0.5, seam = tri1(sk) > 0.86 ? 0.3 : 1, pl = wood[Math.floor(hash1(Math.floor(sk), Math.floor(u * 5 + hash1(Math.floor(sk), 3) * 5), sd) * wood.length) % wood.length];
        let col = mul(pl, seam * (0.75 + 0.4 * noise3(x * 2, y * 9, z * 9)));
        const weed = smooth(0.55, 0.8, noise3(x * 3.2 + sd, y * 3.2, z * 3.2)) * 0.45 * seam; col = mix(col, [0.1, 0.22, 0.13], weed);
        if (seam === 1 && cells3(x * 9, y * 9, z * 9) < 0.14 && noise3(x * 1.4, y * 1.4 + 5, z * 1.4) > 0.58) col = [0.45, 0.46, 0.4];   // barnacles
        return col;
      });
      // the keel along the top, rising at stem and stern
      const kp = []; for (let i = 0; i <= 10; i++) { const u = i / 10, p = pt(u, 0.5); kp.push([p[0] * 1.04, p[1] + 0.03, 0]); }
      limb(g, kp, kp.map(() => 0.06), { nu: 6, sq: 0.7, col: woodTint(mul(wood[0], 0.7), 3), capA: true, capB: true });
      g.surf(K_PLAIN, 1);
      flatDown(g, [[-f.A, y0 + 0.02, f.B], [f.A, y0 + 0.02, f.B], [f.A, y0 + 0.02, -f.B], [-f.A, y0 + 0.02, -f.B]], [0.04, 0.035, 0.03]);
    });
    c.top = y0 + H;
  },
  /** a curving temple tower over the middle, lesser ones at its shoulders */
  shikhara(g, c, o, env) {
    const f = roofFrame(c, env), y0 = c.cutY - 0.01, hb = clamp((c.rY - c.eY) * 0.22, 0.22, 0.5), R = Math.min(f.A, f.B) * 0.86, sd = env.seed % 911, H = clamp(Math.max((c.rY - c.eY) * 1.15, R * 2.1), 1.2, 4.2);
    g.in(f.m, () => {
      wallBody(g, f.A, f.B, y0, y0 + hb, o.wall, sd);
      g.surf(K_STONE, 0.95); g.flat([[-f.A, y0 + hb + 0.003, f.B], [f.A, y0 + hb + 0.003, f.B], [f.A, y0 + hb + 0.003, -f.B], [-f.A, y0 + hb + 0.003, -f.B]], o.floor || [0.55, 0.42, 0.3]);
      g.in(M(0, y0 + hb, 0), () => spire(g, R, H, o, sd));
      const long = f.A / f.B, sm = long > 1.4 ? [[f.A - R * 0.5, 0], [-(f.A - R * 0.5), 0]] : R > 0.7 ? [[f.A - R * 0.3, f.B - R * 0.3], [-(f.A - R * 0.3), f.B - R * 0.3], [f.A - R * 0.3, -(f.B - R * 0.3)], [-(f.A - R * 0.3), -(f.B - R * 0.3)]] : [];
      for (const [x, z] of sm) g.in(M(x, y0 + hb, z), () => spire(g, long > 1.4 ? R * 0.5 : R * 0.3, long > 1.4 ? H * 0.55 : H * 0.42, { ...o, lite: true }, sd + 5));
    });
    c.top = y0 + hb + H * 1.12;
  },
  /** a skin laid over the old roof's shape: thatch, hides, leaves, turf */
  drape(g, c, o, env) {
    const d = 0.14, { P, n, vr, bb } = env, ci = c.i + 1, ring = Math.round(Math.min(o.over ?? 0.2, c.over) / d), pad = ring + 1, thick = o.thick ?? 0.1;
    const gx0 = c.x0 - pad * d, gz0 = c.z0 - pad * d, w = Math.ceil((c.x1 - c.x0) / d) + 2 * pad + 2, h = Math.ceil((c.z1 - c.z0) / d) + 2 * pad + 2;
    let Hm = new Float32Array(w * h).fill(-1e9);
    for (let i = 0; i < n; i++) {
      if (vr[i] !== ci) continue;
      const o3 = i * 3, i0 = Math.floor((P[o3] - gx0) / d), j0 = Math.floor((P[o3 + 2] - gz0) / d), y = P[o3 + 1];
      for (let q = 0; q < 4; q++) { const k = (j0 + (q >> 1)) * w + i0 + (q & 1); if (y > Hm[k]) Hm[k] = y; }
    }
    for (let r = 0; r < ring; r++) { // reach out past the old eaves, dropping as it goes
      const Hn = Hm.slice();
      for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const k = j * w + i; if (Hm[k] > -1e8) continue; const px = gx0 + i * d, pz = gz0 + j * d; if (px < bb.x0 - 0.06 || px > bb.x1 + 0.06 || pz < bb.z0 - 0.06 || pz > bb.z1 + 0.06) continue; const m = Math.max(Hm[k - 1], Hm[k + 1], Hm[k - w], Hm[k + w]); if (m > -1e8) Hn[k] = m - (o.drop ?? 0.11); }
      Hm = Hn;
    }
    for (let s = 0; s < (o.smooth ?? 1); s++) {
      const Hn = Hm.slice();
      for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const k = j * w + i; if (Hm[k] < -1e8) continue; let sm = Hm[k] * 2, cnt = 2; for (const q of [k - 1, k + 1, k - w, k + w]) if (Hm[q] > -1e8) { sm += Hm[q]; cnt++; } Hn[k] = Math.max(sm / cnt, Hm[k] - 0.04); }
      Hm = Hn;
    }
    const sd = env.seed % 911, lump = o.lump || 0, lf = o.lumpF || 2.4, Y = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i; if (Hm[k] < -1e8) { Y[k] = -1e9; continue; } const x = gx0 + i * d, z = gz0 + j * d; Y[k] = Hm[k] + thick * (1 + lump * (2 * fbm3(x * lf + sd, Hm[k] * lf, z * lf, 2) - 1)) - (o.sag || 0) * noise3(x * 1.7 + sd, 3, z * 1.7); }
    const ok = (i, j) => i >= 0 && j >= 0 && i < w && j < h && Y[j * w + i] > -1e8, id = new Int32Array(w * h).fill(-1), span = Math.max(0.2, c.rY - c.eY);
    g.surf(o.surf ?? K_ROOF, o.rough ?? 0.96, 0, o.glow || 0);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!ok(i, j)) continue;
      const k = j * w + i, y = Y[k], x = gx0 + i * d, z = gz0 + j * d;
      const nx = (ok(i - 1, j) ? Y[k - 1] : y) - (ok(i + 1, j) ? Y[k + 1] : y), nz = (ok(i, j - 1) ? Y[k - w] : y) - (ok(i, j + 1) ? Y[k + w] : y), l = Math.hypot(nx, 2 * d, nz);
      id[k] = g.v(x, y, z, nx / l, (2 * d) / l, nz / l, o.col(x, y, z, nx / l, (2 * d) / l, nz / l, (y - c.eY) / span));
    }
    const cellOn = (i, j) => ok(i, j) && ok(i + 1, j) && ok(i, j + 1) && ok(i + 1, j + 1), sk = o.skirt ?? thick + 0.06, ec = o.edgeCol;
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      if (!cellOn(i, j)) continue;
      const k = j * w + i;
      g.quad(id[k], id[k + 1], id[k + w + 1], id[k + w]);
      for (const [di, dj, a, b, ox, oz] of [[0, -1, k, k + 1, 0, -1], [0, 1, k + w, k + w + 1, 0, 1], [-1, 0, k, k + w, -1, 0], [1, 0, k + 1, k + w + 1, 1, 0]]) {
        if (cellOn(i + di, j + dj)) continue;
        const pa = [gx0 + (a % w) * d, Y[a], gz0 + Math.floor(a / w) * d], pb = [gx0 + (b % w) * d, Y[b], gz0 + Math.floor(b / w) * d];
        const ca = ec ? ec(pa[0], pa[1], pa[2]) : mul(o.col(pa[0], pa[1], pa[2], ox, 0, oz, 0), 0.55), cb = ec ? ec(pb[0], pb[1], pb[2]) : mul(o.col(pb[0], pb[1], pb[2], ox, 0, oz, 0), 0.55);
        g.quad(g.v(pa[0], pa[1], pa[2], ox, 0.3, oz, ca), g.v(pb[0], pb[1], pb[2], ox, 0.3, oz, cb), g.v(pb[0] - ox * 0.04, pb[1] - sk, pb[2] - oz * 0.04, ox, -0.2, oz, mul(cb, 0.6)), g.v(pa[0] - ox * 0.04, pa[1] - sk, pa[2] - oz * 0.04, ox, -0.2, oz, mul(ca, 0.6)));
      }
    }
    c.top = c.rY + thick;
    if (o.on) o.on(g, c, env, (x, z) => { const i = clamp(Math.round((x - gx0) / d), 0, w - 1), j = clamp(Math.round((z - gz0) / d), 0, h - 1); return Y[j * w + i] > -1e8 ? Y[j * w + i] : c.eY; });
  },
  /** the old roof stays; its gable ends are carried up as stepped (or scrolled) parapets */
  gables(g, c, o, env) {
    if (!c.gable || c.type !== 'main') return;
    const f = roofFrame(c, env), n = o.steps || 5, Bq = Math.min(f.B + 0.08, f.EB), yb = c.eY + (c.rY - c.eY) * Math.max(0, 1 - Bq / f.EB) - 0.02, top = c.rY + (o.rise ?? 0.26), th = o.thick || 0.16, sd = env.seed % 911;
    const st = stoneStyle(o.stone, { course: 0.12, len: [0.2, 0.34], cell: 0.4, r: 0.01, b: 0.01, chip: 0.03, ...o.st });
    g.in(f.m, () => {
      for (const e of [-1, 1]) g.in(M(e * (f.EA - th / 2 + 0.03), 0, 0), () => {
        let y = yb - 0.3;
        for (let i = 0; i < n; i++) {
          const y1 = yb + ((i + 1) / n) * (top - yb), w = Bq * (1 - i / n) + (i ? 0.02 : 0.05);
          stoneBox(g, th / 2, w, y, y1, { ...st, course: 0.12 }, sd + i * 5 + e, { noFoot: true, skip: [e > 0 ? 3 : 1] });
          g.surf(K_STONE, 0.85); g.in(M(0, y1 + 0.02, 0), () => g.cbox(th + 0.06, 0.05, 2 * w + 0.06, 0.012, o.cope || [0.82, 0.8, 0.74]));
          y = y1 - 0.01;
        }
        if (o.fin) g.in(M(0, top + 0.03, 0), () => finial(g, o.fin, 0.5, o));
      });
    });
    c.top = top;
  },
};
/** a curving temple tower R wide and H high on the local origin: banded, ribbed, crowned with a fluted disc and a gilded jar */
function spire(g, R, H, o, seed = 1) {
  const c1 = o.c1 || rgb(0xc98a52), c2 = o.c2 || rgb(0xa86a3c), nv = nq(o.lite ? 12 : 22), nu = nq(o.lite ? 16 : 28);
  const rad = (t) => R * (1 - 0.72 * Math.pow(t, 1.7));
  g.surf(K_STONE, 0.9);
  g.sheet(nu, nv, (u, v) => { const a = u * TAU, co = Math.cos(a), si = Math.sin(a), k = Math.pow(Math.pow(Math.abs(co), 5) + Math.pow(Math.abs(si), 5), -1 / 5) * (1 + 0.05 * Math.cos(a * 12)), r = rad(v) * (0.94 + 0.06 * tri1(v * (o.lite ? 5 : 9))); return [co * k * r * 0.86, v * H, si * k * r * 0.86]; },
    (x, y, z, nx, ny, nz, u, v) => { const band = tri1(v * (o.lite ? 5 : 9)), niche = !o.lite && band > 0.55 && tri1(u * 16) > 0.62; return niche ? mul(o.niche || [0.2, 0.1, 0.06], 1) : mul(band < 0.2 ? c2 : c1, 0.82 + 0.3 * noise3(x * 8 + seed, y * 8, z * 8)); }, true);
  g.in(M(0, H, 0), () => {
    g.surf(K_STONE, 0.85);
    const ar = rad(1) * 1.5;
    g.lathe([[ar * 0.6, -0.02], [ar, 0.04], [ar * 1.08, 0.1 * R], [ar, 0.16 * R + 0.04], [ar * 0.5, 0.2 * R + 0.06]], nq(16), (x, y, z) => mul(tri1((Math.atan2(z, x) / TAU) * 12) > 0.5 ? c1 : c2, 1.05));
    g.in(M(0, 0.2 * R + 0.05, 0), () => finial(g, 'bud', clamp(R * 0.9, 0.3, 1), o));
  });
}
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
/** top: a slender pinnacle for a parapet corner: a shaft and one of the DOME caps */
function pinnacle(g, s, shape, o = {}) {
  const sh = o.shaft ?? 0.5, r = Math.min(o.r || 0.11, 0.1 / s);
  g.surf(o.shaftKind ?? K_STONE, 0.9, o.shaftMetal || 0);
  g.lathe([[r * 1.25 * s, -0.04], [r * 1.25 * s, 0.04 * s], [r * s, 0.07 * s], [r * s, sh * s], [r * 1.35 * s, (sh + 0.03) * s], [r * 1.35 * s, (sh + 0.07) * s]], o.sides || nq(8), o.shaftCol || [0.7, 0.68, 0.62]);
  let top = 0;
  const pmax = DOME[shape].reduce((m, p) => Math.max(m, p[0]), 0), capR = Math.min(r * 1.3 * s * (o.capK || 1), 0.13 / pmax);   // never wider than the merlon it stands on, or it would hang over the walk
  g.in(M(0, (sh + 0.07) * s, 0), () => { top = domeOn(g, capR, { drum: 0, shape, col: o.col, kind: o.kind, rough: o.rough, metal: o.metal, glow: o.glow, hk: o.hk, seg: o.sides || 10, finial: o.finial, finS: (o.finS || 0.4) * s, fin: o.fin, deep: o.deep, bright: o.bright, seed: o.seed, flame: o.flame }); });
  return (sh + 0.07) * s + top;
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
/** sv.add, but the building's ornament budget is a hard limit: a piece that turns out to overrun it is taken off again */
function capped(g, sv, est, fn) {
  sv.add(g, est, () => {
    const n0 = g.n, i0 = g.I.length;
    fn();
    if (g.I.length / 3 > sv.cap) { g.n = n0; g.P.length = g.N.length = g.C.length = g.A.length = n0 * 3; g.K.length = n0; g.I.length = i0; }
  });
}
/** the driver: o = { ridge, apex, corner (parapets), eave (roof corners), face, door } each [triangle estimate, fn(a, i)] run in the anchor's frame */
function dress(g, sv, o) {
  const run = (list, e) => { if (e) list.forEach((a, i) => capped(g, sv, e[0], () => sv.at(g, a, () => e[1](a, i)))); };
  run(sv.ridge, o.ridge);
  if (sv.apex && !sv.ridge.length) run([{ ...sv.apex, yaw: 0 }], o.apex || o.ridge);
  if (sv.walky || sv.slim) run([...sv.corners, ...sv.edges], o.corner); else run(sv.corners, o.eave);
  run(sv.door, o.door);
  run(sv.faces, o.face);
}
// ---------- the realm styles ----------
const PAL_KEY = { stone: C_STONE, plaster: C_PLASTER, timber: C_TIMBER, red: C_RED, slate: C_SLATE, moss: C_MOSS, gold: C_GOLD, iron: C_IRON, other: C_OTHER, roof: 'roof' };
const PAL_DEF = { stone: [1.2, 0.95, 0.4, 1.5], plaster: [1.4, 0.85, 0.5, 1.3], timber: [2.3, 0.9, 0.4, 1.6], red: [2.6, 0.75, 0.5, 1.55], slate: [2.6, 0.75, 0.5, 1.55], moss: [2, 0.8, 0.5, 1.4], gold: [3, 0.6, 0.65, 1.35], iron: [3, 0.5, 0.6, 1.5], other: [1.5, 0.6, 0.5, 1.3], roof: [2.6, 0.75, 0.5, 1.55] };
/** a palette from hex lists by material name; red and slate follow `roof` unless given */
function palOf(o) {
  const r = {};
  for (const k in o) r[PAL_KEY[k]] = [sw(...o[k]), ...PAL_DEF[k]];
  if (o.roof) { if (!o.red) r[C_RED] = r.roof; if (!o.slate) r[C_SLATE] = r.roof; }
  return r;
}
/**
 * A shape field from a recipe: lean, twist, wob (crooked), sag, crumble (the top slumps and breaks), batter (walls lean in),
 * pinch and stretch (the top narrows and rises), jag (shards thrust up), squat, bulge, warp, logs (courses swell into logs).
 */
function shapeOf(p) {
  return (x, y, z, k, o) => {
    const hf = y / k.H, top = smooth(0.45, 1, hf), rx = x - k.cx, rz = z - k.cz, freeX = !(k.linked && !k.ax), freeZ = !(k.linked && k.ax);
    let dx = 0, dy = 0, dz = 0;
    if (p.lean && !k.linked) { const l = p.lean * (1 + 0.5 * hf) * y * (k.Ha / k.H); dx += Math.cos(k.th) * l; dz += Math.sin(k.th) * l; }
    if (p.twist && !k.linked) { const t = p.twist * hf * (k.s3 > 0.5 ? 1 : -1); dx -= rz * t; dz += rx * t; }
    if (p.wob) { dx += (noise3(y * 0.85 + k.s1, z * 0.45, 3.3) - 0.5) * p.wob * hf; dz += (noise3(x * 0.45, y * 0.85 + k.s2, 7.1) - 0.5) * p.wob * hf; }
    if (p.sag) dy -= p.sag * k.Ha * top * (0.4 + noise3(x * 0.6 + k.s1, 2, z * 0.6));
    if (p.crumble) dy -= k.Ha * top * p.crumble * smooth(0.5, 0.76, fbm3(x * 1.25 + k.s1, y * 0.7, z * 1.25 + k.s2, 2));
    if (p.batter) { const b = p.batter * Math.min(1, y / k.Ha); if (freeX) dx -= rx * b; if (freeZ) dz -= rz * b; }
    if (p.pinch && !k.linked) { const q = p.pinch * top * top; dx -= rx * q; dz -= rz * q; }
    if (p.bulge) { const b = p.bulge * Math.sin(Math.PI * clamp(hf * 1.12, 0, 1)) + p.bulge * 0.7 * (noise3(x * 0.8 + k.s1, y * 0.8, z * 0.8 + k.s2) - 0.5); if (freeX) dx += rx * b; if (freeZ) dz += rz * b; }
    if (p.stretch) dy += p.stretch * k.Ha * top * top;
    if (p.jag) { const n = 1 - Math.abs(2 * noise3(x * 1.5 + k.s1, y * 0.35, z * 1.5 + k.s2) - 1); dy += k.Ha * top * top * p.jag * (n * n * n + 0.2); }
    if (p.squat && !k.linked) dy -= p.squat * y;
    if (p.warp) { dx += p.warp * Math.sin(y * 2.1 + k.s1) * hf; dz += p.warp * Math.cos(y * 1.7 + k.s2) * hf; dy += p.warp * 0.6 * Math.sin((x + z) * 1.3 + k.s1) * top; }
    if (p.logs && k.cls === C_STONE && !k.roof && Math.abs(k.vny) < 0.5) { const b = p.logs * Math.sin(Math.PI * (((y / COURSE) % 1) + 1) % 1); dx += k.vnx * b; dz += k.vnz * b; }
    o[0] = dx; o[1] = dy; o[2] = dz;
  };
}
const thatchCol = (base, seed = 0, dark = 0.72, moss = 0) => (x, y, z, nx, ny, nz) => { const s = Math.abs(nx) > Math.abs(nz) ? z : x; let c = mul(base, (0.55 + 0.7 * noise3(s * 13 + seed, y * 2.2, 1.5)) * (0.72 + 0.28 * tri1(y * 3.3)) * (ny > 0.95 ? dark : 1)); if (moss) c = mix(c, [0.16, 0.24, 0.07], moss * smooth(0.45, 0.7, noise3(x * 1.6 + seed, y * 1.6, z * 1.6))); return c; };
const leafCol = (pal, seed = 0, bloom = null) => (x, y, z, nx, ny) => { const d = cells3(x * 2.6 + seed, y * 2.6, z * 2.6), q = hash1(Math.round(x * 2.6 + seed), Math.round(y * 2.6), Math.round(z * 2.6)), f = cells3(x * 7 + seed, y * 7, z * 7); if (bloom && f < 0.1 && q > 0.6) return bloom; return mul(pal[Math.floor(q * pal.length) % pal.length], (0.3 + 0.75 * smooth(0.0, 0.5, d)) * (0.55 + 0.6 * smooth(0.05, 0.4, f)) * (0.55 + 0.4 * hash1(Math.round(q * 97), seed)) * (0.7 + 0.35 * (ny || 0.5))); };
const hidePatch = (col, seed = 0) => { const alt = [col, mul(col, 0.7), mix(col, rgb(0x7a5a30), 0.6), mix(col, rgb(0xc8b070), 0.45)]; return (x, y, z) => { const cu = x * 2.3 + 0.4 * noise3(z * 3 + seed, 1, 2), cv = z * 2.3 + 0.4 * noise3(x * 3, seed, 5), iu = Math.floor(cu), iv = Math.floor(cv), e = Math.min(cu - iu, 1 - (cu - iu), cv - iv, 1 - (cv - iv)); return mul(alt[Math.floor(hash1(iu, iv, seed) * 4)], (e < 0.07 ? 0.5 : 1) * (0.75 + 0.4 * noise3(x * 8 + seed, y * 8, z * 8))); }; };
const snowOn = (c, a, x, y, z, ny, k, amt = 0.5) => { if (k.roof) { ny = Math.abs(ny); amt = 0.5 + amt * 0.5; } if (ny > 0.3) { const t = smooth(0.3, 0.7, ny) * smooth(0.62 - amt * 0.6, 0.72 - amt * 0.6, noise3(x * 1.3 + k.s1, y * 0.9, z * 1.3 + k.s2)); tintTo(c, [0.86, 0.9, 0.96], t); a[0] = lerp(a[0], 0.55, t); a[1] *= 1 - t; } };
const mossOn = (c, x, y, z, ny, k, amt = 0.6, col = [0.1, 0.17, 0.045]) => { const t = (ny > 0.15 ? smooth(0.15, 0.6, ny) : 0.35 * smooth(0.9, 0.1, y)) * smooth(0.6 - amt * 0.3, 0.8 - amt * 0.3, noise3(x * 1.5 + k.s1, y * 1.5, z * 1.5 + k.s2)) * amt * 1.3; if (t > 0) tintTo(c, col, Math.min(0.9, t)); };
const STRAW = rgb(0xa8873c), STRAW_OLD = rgb(0x7e7248);
const TILE_GREEN = sw(0x2f7a4a, 0x2a6a40, 0x3a8a55, 0x256038, 0x348050), TILE_GOLD = sw(0xd9a62e, 0xc8962a, 0xe0b440, 0xb88826), TILE_GREY = sw(0x565a62, 0x4a4e56, 0x62666e, 0x50545c);
const TURQ = sw(0x1fa39c, 0x2ab4ae, 0x188c8c, 0x35bdb0, 0x1a98a8), TERRA = sw(0xc8643a, 0xb85830, 0xd47444, 0xa84e2c, 0xbe6a40), RED_TILE = sw(0xb8402a, 0xa83a26, 0xc64e30, 0x9c3422);
const SLATE_BLUE = sw(0x34539a, 0x2d4a8c, 0x3e5fa8, 0x2a4480), SLATE_DARK = sw(0x3c4450, 0x343c48, 0x464e5a, 0x2e3640), BLACK_TILE = sw(0x26242a, 0x1e1c22, 0x2e2a32, 0x22202a), PALE_BLUE = sw(0x8fb4d8, 0x7fa6cc, 0x9fc0e0, 0x86acd4);
const ONION = [[rgb(0x2a5ab0), rgb(0xe0b030)], [rgb(0xb8342a), rgb(0xeee8d8)], [rgb(0x2a8a5a), rgb(0xe0b030)], [rgb(0xe0b030), rgb(0xc8962a)]];
const pagoda = (pal, ridgeC, tipC, band, extra = {}) => ({ kind: 'hip', curve: 1.55, lift: 0.34, ov: 0.36, hs: 0.8, tiers: 2, pal, round: true, ridge: ridgeC, tip: tipC, under: [0.22, 0.06, 0.04], band, ...extra });
const TL_BAND = { col: (x) => (tri1(x * 1.6) > 0.8 ? [0.4, 0.07, 0.05] : [0.78, 0.72, 0.6]), frame: rgb(0x9a2418), every: 0.6 };
const SG_BAND = { col: (x, y) => mul([0.9, 0.88, 0.82], 0.92 + 0.1 * noise3(x * 3, y * 3, 1)), frame: rgb(0x2a2420), every: 0.5, win: { col: [0.95, 0.9, 0.72], glow: 0.5, shape: 'screen', trim: rgb(0x2a2420), trimKind: K_WOOD, every: 1.0, w: 0.26, h: 0.26 } };
const brickSt = { course: 0.1, len: [0.17, 0.3], cell: 0.4, r: 0.008, b: 0.008, chip: 0.03, var: 0.16 };
Object.assign(STYLES, {
  graal: {
    glow: [1.0, 0.72, 0.3], window: 0.55, trim: [rgb(0xf2efe6)],
    pal: palOf({ stone: [0xd9d5c8, 0xcfcabb, 0xe2ded2, 0xc8c6bc], plaster: [0xe6dcc0, 0xdcd0b0], timber: [0x4a3626, 0x3e2e20, 0x574030], roof: [0x34539a, 0x2d4a8c, 0x3e5fa8, 0x2a4480, 0x4666ae], moss: [0x4a6a34, 0x3c5a2c], gold: [0xe0aa2e, 0xd09a26], iron: [0x3a3c44, 0x2e3038], other: [0x2d4a9c, 0xe0aa2e, 0xb8342a] }),
    roof: { cap: { kind: 'cap', shape: 'bell', hs: 1.25, col: domeTiles(SLATE_BLUE), finial: 'spike', finS: 0.5 } },
    by: { humble: { roof: { main: { kind: 'drape', thick: 0.13, over: 0.16, col: thatchCol(STRAW, 3), skirt: 0.2 }, cap: { kind: 'cap', shape: 'tent', hs: 0.8, col: (a, t, x, y, z) => thatchCol(STRAW, 5)(x, y, z, 1, 0.5, 0), rough: 0.96 } },
      pal: palOf({ stone: [0xd8c8a0, 0xcfbd92, 0xe0d2ac, 0xc8b88e], plaster: [0xdccba0, 0xd0be92], timber: [0x5a4632, 0x4a3a2a, 0x66503a] }) } },
    fx(cls, x, y, z, ny, c, a) { // stained glass: every pane its own jewel colour
      if (cls === C_GLOW || cls === C_GLASS) { const h = hash1(Math.round(x * 9), Math.round(y * 9), Math.round(z * 9)), p = h < 0.3 ? [0.85, 0.12, 0.1] : h < 0.6 ? [0.15, 0.3, 0.95] : h < 0.85 ? [1.0, 0.72, 0.15] : [0.15, 0.7, 0.3]; tintTo(c, p, 0.75); a[2] = Math.max(a[2], 0.9); }
    },
  },
  aurelia: {
    glow: [1.0, 0.6, 0.2], window: 0.6, trim: [rgb(0xc8b690)], joint: [0.5, 0.47, 0.42, 0.55],
    pal: palOf({ stone: [0x7a4a38, 0x6e4232, 0x84523c, 0x5e3a2e, 0x744636], plaster: [0xe0d2ac, 0xd6c69c], timber: [0x3e2e22, 0x34261c, 0x4a382a], roof: [0x3c4450, 0x343c48, 0x464e5a, 0x2e3640], moss: [0x44582e, 0x384a28], gold: [0xc89a3a, 0xb88a30], iron: [0x2a2a2e, 0x222226], other: [0x8a2a22, 0xd8b83a, 0x26262a] }),
    roof: { main: { kind: 'gables', stone: 0x7a4a38, st: brickSt, cope: rgb(0xc8b690), steps: 5, fin: 'ball' }, cap: { kind: 'cap', shape: 'bulb', hk: 1.15, drum: 0.2, col: domeTiles(SLATE_DARK), finial: 'ball', finS: 0.5 } },
    by: { humble: { pal: palOf({ stone: [0xd8cba8, 0xcebf98, 0xe0d4b4, 0xc4b690] }), joint: null },
      grand: { pal: palOf({ stone: [0xe2ded6, 0xd8d2c8, 0xeae6de, 0xcfcac2] }), joint: null, trim: [rgb(0xf4f2ec)], roof: { main: { kind: 'gables', stone: 0xe2ded6, cope: rgb(0xf4f2ec), steps: 5, fin: 'ball' } } },
      keep: { pal: palOf({ stone: [0x7a4a38, 0x6e4232, 0x84523c, 0x5e3a2e, 0x744636] }), joint: [0.5, 0.47, 0.42, 0.55], trim: [rgb(0xc8b690)] } },
    fx(cls, x, y, z, ny, c, a, k) { // soot: a grime that thickens toward the eaves and runs down in streaks
      if (cls === C_STONE || cls === C_PLASTER) { const s = (0.25 + 0.5 * smooth(0.3, 1, y / k.H)) * smooth(0.45, 0.8, noise3(x * 5.5 + k.s1, y * 0.5, z * 5.5 + k.s2)); c[0] *= 1 - 0.55 * s; c[1] *= 1 - 0.57 * s; c[2] *= 1 - 0.58 * s; }
    },
  },
  aethel: {
    glow: [0.45, 0.85, 1.0], window: 0.9, trim: [rgb(0xfbf8f0)],
    pal: palOf({ stone: [0xeee8d8, 0xe6e0d0, 0xf4f0e4, 0xe0dccc], plaster: [0xf4f0e6, 0xece8dc], timber: [0xc2c8d2, 0xb4bcc8, 0xd0d4dc], roof: [0x8fb4d8, 0x7fa6cc, 0x9fc0e0, 0x86acd4], moss: [0x7ab08a, 0x6aa07c], gold: [0xdde2ea, 0xcfd6e0], iron: [0xb4bcc8, 0xa4aebc], other: [0x8fb4d8, 0xdde2ea, 0x6ac0d8] }),
    roof: { main: { kind: 'hip', hs: 1.4, curve: 1.3, lift: 0.1, ov: 0.2, pal: PALE_BLUE, ridge: rgb(0xdde2ea), ridgeMetal: 0.8, under: [0.5, 0.52, 0.56], plate: rgb(0xe6e0d0) }, cap: { kind: 'cap', shape: 'bell', hs: 1.9, col: domeTiles(PALE_BLUE), finial: 'crystal', finS: 0.55, fin: rgb(0xdde2ea) } },
    disp: shapeOf({ stretch: 0.07, pinch: 0.035 }),
    fx(cls, x, y, z, ny, c, a) { if (cls === C_GOLD || cls === C_IRON) { a[0] = 0.3; a[1] = 0.9; } if (cls === C_TIMBER) { a[0] = 0.5; a[1] = 0.35; } },
  },
  kaelneth: {
    glow: [1.0, 0.07, 0.05], window: 1.2,
    pal: palOf({ stone: [0x1c1a22, 0x24202c, 0x16151b, 0x201c28], plaster: [0x3a3442, 0x322c3a], timber: [0x18161a, 0x1e1a20, 0x121014], roof: [0x1a181e, 0x221f28, 0x141318, 0x2a2430], moss: [0x2a1a22, 0x22161c], gold: [0x8a8a94, 0x7a7a86], iron: [0x16161a, 0x1e1e24], other: [0x8a1420, 0x6e101a, 0x24202c] }),
    roof: { cap: { kind: 'cap', shape: 'bell', hs: 2.1, col: (a, t, x, y, z) => mul([0.07, 0.06, 0.09], 0.7 + 0.6 * tri1((a / TAU) * 6)), rough: 0.3, metal: 0.4, finial: 'spike', finS: 0.6, fin: [0.2, 0.2, 0.24] } },
    disp: shapeOf({ jag: 0.3, pinch: 0.1 }),
    fx(cls, x, y, z, ny, c, a, k) { // volcanic glass: slick, with a violet sheen along its facets
      if (cls === C_STONE || k.roof) { a[0] = 0.42; const e = smooth(0.66, 0.84, noise3(x * 3.4 + k.s1, y * 3.4, z * 3.4 + k.s2)); tintTo(c, [0.13, 0.09, 0.2], e * 0.45); }
      if (cls === C_IRON || cls === C_GOLD) { a[0] = 0.4; a[1] = 0.9; }
    },
  },
  verdant: {
    glow: [1.0, 0.5, 0.06], window: 0.9,
    pal: palOf({ stone: [0x5e4a32, 0x52402a, 0x6a543a, 0x4a3a26], plaster: [0x8e7852, 0x826c48, 0x9a845c], timber: [0x4a3826, 0x3e2e20, 0x56422c], roof: [0x3f7a2e, 0x4f8a38, 0x2f6a26, 0x5a9440], moss: [0x4a7a30, 0x3c6a28, 0x5a8a38], gold: [0xe0962a, 0xd08622], iron: [0x3a2e22, 0x30261c], other: [0x6a8a3a, 0xe0962a, 0x8a5a3a] }),
    roof: { main: { kind: 'drape', thick: 0.26, lump: 0.85, lumpF: 2.6, over: 0.24, drop: 0.14, smooth: 2, skirt: 0.24, surf: K_LEAF, rough: 0.85, col: leafCol(sw(0x2f6a26, 0x3a7a2c, 0x24581e, 0x4a8a34, 0x1e4c1a), 2, rgb(0xe8c84a)), on: (g, c, env, topAt) => { const rnd = rng(env.seed % 991 + c.i), n = clamp(Math.round(c.w * c.d * 16), 30, 170), lp = sw(0x2f6a26, 0x3a7a2c, 0x4a8a34, 0x5a9a3c, 0x24581e); g.surf(K_LEAF, 0.8); for (let i = 0; i < n; i++) { const x = lerp(c.x0 - 0.15, c.x1 + 0.15, rnd()), z = lerp(c.z0 - 0.15, c.z1 + 0.15, rnd()), y = topAt(x, z), s = 0.1 + 0.12 * rnd(); if (y < c.eY + 0.02) continue; g.in(M(x, y - 0.02, z, (rnd() - 0.5) * 70, rnd() * 360, (rnd() - 0.5) * 70), () => g.poly([[0, 0, -s], [s * 0.6, s * 0.35, 0], [0, s * 0.1, s], [-s * 0.6, s * 0.35, 0]], 0, 1, 0, mul(lp[i % 5], 0.8 + 0.5 * rnd()))); } } },
      cap: { kind: 'cap', shape: 'bulb', rk: 1.25, hk: 1.0, drum: 0, rough: 0.85, col: (a, t, x, y, z) => leafCol(sw(0x2f6a26, 0x3a7a2c, 0x24581e, 0x4a8a34), 4)(x, y, z, 0, 0.5 + 0.5 * t), finial: null } },
    disp: shapeOf({ bulge: 0.07, wob: 0.07 }),
    fx(cls, x, y, z, ny, c, a, k) { // bark: furrowed up and down, mossed wherever it faces the sky
      if (cls === C_STONE || cls === C_TIMBER || cls === C_PLASTER) { const f = 0.72 + 0.5 * noise3(x * 8 + k.s1, y * 0.7, z * 8 + k.s2); c[0] *= f; c[1] *= f; c[2] *= f; }
      if (cls !== C_GLOW && cls !== C_GLASS && !k.roof) mossOn(c, x, y, z, ny, k, 0.5, [0.12, 0.22, 0.05]);
    },
  },
  grom: {
    glow: [1.0, 0.5, 0.1], window: 0.8, trim: [rgb(0x8a8680)],
    pal: palOf({ stone: [0x6e6a66, 0x62605c, 0x7a7672, 0x58544f, 0x747068], plaster: [0x8a8680, 0x7e7a74], timber: [0x9a6a2e, 0x8a5c26, 0xa87834], roof: [0x8a5a2a, 0x9a6830, 0x7a4e26, 0x6e5a3a], moss: [0x4a5a3a, 0x3e4e32], gold: [0xd8a43a, 0xc8942e], iron: [0x3a3632, 0x2e2a28], other: [0x9a6a2e, 0x3a6a8a, 0x8a2a22] }),
    roof: { cap: { kind: 'cap', shape: 'low', hk: 1.1, drum: 0.3, drumCol: rgb(0x6e6a66), col: domeBands(rgb(0x8a5a2a), rgb(0xd8a43a), 3, 0.2), metal: 0.6, rough: 0.45, finial: 'ball', finS: 0.4 } },
    disp: shapeOf({ squat: 0.13, batter: 0.05 }),
    fx(cls, x, y, z, ny, c, a, k) {
      if (cls === C_TIMBER || k.roof) { a[0] = 0.45; a[1] = 0.65; }   // doors, beams and roofs are bronze
      if (cls === C_STONE && !k.roof && ny < 0.4) { // a bronze band of knotwork round the waist of every wall
        const hf = y / k.H, band = smooth(0.4, 0.415, hf) * smooth(0.5, 0.485, hf);
        if (band > 0) { const u = (x + z) * 2.2, kn = tri1(u) > Math.abs(hf - 0.45) * 22 ? 1 : 0.55; tintTo(c, mul([0.6, 0.38, 0.14], kn), band); a[0] = lerp(a[0], 0.45, band); a[1] = lerp(a[1], 0.7, band); }
      }
    },
  },
  xibalba: {
    glow: [1.0, 0.7, 0.2], window: 0.5, trim: [rgb(0xcfc6a6)],
    pal: palOf({ stone: [0xb9af8e, 0xada384, 0xc4ba98, 0xa2987a], plaster: [0xc8be9c, 0xbcb290], timber: [0x5e4028, 0x503622, 0x6a4a30], roof: [0xb8a26a, 0xa8925c, 0xc4ae76], moss: [0x3f7a34, 0x34682c, 0x4c8a3c], gold: [0xe6b430, 0xd8a428], iron: [0x2aa89a, 0x229488], other: [0x2aa89a, 0xb8482e, 0xe6b430] }),
    roof: { main: { kind: 'step', n: 3, f: 0.75, wall: { stone: 0xb9af8e }, floor: rgb(0x9a9278), band: (x, y, z) => (Math.floor(x * 5 + 40) % 3 === 0 ? [0.04, 0.42, 0.4] : [0.5, 0.1, 0.05]), on: (g, A, B, y) => { const s = Math.min(A, B); g.surf(K_STONE, 0.92); g.in(M(0, y + 0.22, 0), () => g.cbox(s * 1.1, 0.44, s * 0.9, 0.02, stoneTint(rgb(0xb9af8e), 3))); g.in(M(0, y + 0.5, 0), () => g.cbox(s * 1.3, 0.12, s * 1.05, 0.02, stoneTint(rgb(0xb8482e), 5))); g.in(M(0, y + 0.56, 0), () => prism(g, MERLON.step(s * 0.9, 0.42), 0.1, stoneTint(rgb(0xb9af8e), 7), [0, 0.08])); for (const e of [0, 180]) g.in(M(0, y + 0.74, 0, 0, e, 0), () => g.in(M(0, 0, 0.055), () => sunDisc(g, 0.55, GOLD, { rays: 0 }))); g.surf(K_PLAIN, 1); g.in(M(0, y + 0.17, s * 0.451), () => g.poly([[-0.1, -0.16, 0], [0.1, -0.16, 0], [0.1, 0.12, 0], [-0.1, 0.12, 0]], 0, 0, 1, [0.03, 0.02, 0.02])); return 1.0; } },
      cap: { kind: 'cap', merlon: 'step', mh: 0.26, edge: rgb(0xb9af8e), shape: 'cone', hk: 0.7, seg: 4, surf: K_STONE, rough: 0.9, col: stoneTint(rgb(0xb9af8e), 5), drum: 0.3, drumCol: rgb(0x8a2a18), finial: 'disc', finS: 0.6 } },
    by: { humble: { roof: { main: { kind: 'step', n: 2, f: 0.55, wall: { stone: 0xb9af8e }, floor: rgb(0x9a9278), band: (x) => (Math.floor(x * 5 + 40) % 3 === 0 ? [0.04, 0.42, 0.4] : [0.5, 0.1, 0.05]), merlon: 'step', mh: 0.2, edge: rgb(0xb9af8e) } } } },
    fx(cls, x, y, z, ny, c, a, k) { // jungle: vines hang from every ledge, the plinth is painted red
      if (cls === C_STONE || cls === C_PLASTER) {
        const v = smooth(0.58, 0.8, noise3(x * 4.5 + k.s1, y * 0.45, z * 4.5 + k.s2)) * smooth(0.25, 0.9, noise3(x * 0.9, y * 0.9 + k.s2, z * 0.9));
        tintTo(c, [0.08, 0.2, 0.05], v * 0.85);
        const b = smooth(0.32, 0.26, y) * 0.8; tintTo(c, [0.36, 0.07, 0.03], b * (1 - v));
      }
    },
  },
  velikaya: {
    glow: [1.0, 0.66, 0.25], window: 0.7, trim: [rgb(0xf0ede4)],
    pal: palOf({ stone: [0xc4beb0, 0xb8b2a4, 0xcec8ba, 0xaea89a], plaster: [0xe6e2d6, 0xdcd8cc], timber: [0x7a5230, 0x6c4828, 0x865c38, 0x8a3226], roof: [0x5a4634, 0x4e3c2c, 0x66503c, 0x44342a], moss: [0x3a5a3a, 0x2e4a30], gold: [0xe6b430, 0xd8a428], iron: [0x3a3a40, 0x2e2e34], other: [0xb8342a, 0x2a5ab0, 0xe6b430] }),
    roof: { main: { kind: 'dome', shape: 'onion', f: 0.3, rk: 0.7, drum: 0.55, drumCol: rgb(0xe8e4d8), drumWin: [0.1, 0.12, 0.2], col: domeSpiral(ONION[0][0], ONION[0][1], 6, 1.4), finial: 'ball', four: true, wall: { stone: 0xc4beb0 }, merlon: 'none', edge: rgb(0xd8d4c8), floor: rgb(0xa8a498) },
      cap: { kind: 'cap', shape: 'onion', hk: 1.0, rk: 0.98, drum: 0.3, drumCol: rgb(0xe8e4d8), col: (a, t, x, y, z, sd) => domeSpiral(ONION[sd % 4][0], ONION[sd % 4][1], 6, 1.4)(a, t, x, y, z), finial: 'ball', finS: 0.5 } },
    by: { humble: { roof: { main: { kind: 'keep' } }, pal: palOf({ stone: [0x94703e, 0x866436, 0xa07a46, 0x7a5a30], plaster: [0xa8834c, 0x9a7642] }), joint: [0.2, 0.14, 0.08, 0.7], trim: null, disp: shapeOf({ logs: 0.035 }) } },
    fx(cls, x, y, z, ny, c, a, k) { if (cls !== C_GLOW && cls !== C_GLASS) snowOn(c, a, x, y, z, ny, k, 0.55); },
  },
  tianlong: {
    glow: [1.0, 0.42, 0.12], window: 0.7, trim: [rgb(0xd8d4c8)],
    pal: palOf({ stone: [0xb9b3a4, 0xaaa596, 0xc4beb0, 0x9e9a8e], plaster: [0xe8e0cc, 0xddd4be], timber: [0x9a2418, 0x8a1e16, 0xa82c1c, 0x7e1a14], roof: [0x2f7a4a, 0x2a6a40, 0x3a8a55, 0x256038], moss: [0x3a6a3a, 0x2f5a30], gold: [0xe6b030, 0xd8a028], iron: [0x5a4a2a, 0x4a3c22], other: [0xb8281c, 0xe6b030, 0x2f7a4a] }),
    roof: { main: pagoda(TILE_GREEN, rgb(0x1f4a2e), GOLD, TL_BAND, { plate: woodTint(rgb(0x9a2418), 2) }), cap: { kind: 'cap', shape: 'sweep', hs: 0.8, out: 0.02, col: domeTiles(TILE_GREEN), finial: 'ball', finS: 0.5 } },
    by: { grand: { pal: palOf({ roof: [0xd9a62e, 0xc8962a, 0xe0b440, 0xb88826] }), roof: { main: pagoda(TILE_GOLD, rgb(0x8a2a1a), rgb(0xb8281c), TL_BAND, { plate: woodTint(rgb(0x9a2418), 2), lift: 0.38 }), cap: { kind: 'cap', shape: 'sweep', hs: 0.8, out: 0.02, col: domeTiles(TILE_GOLD), finial: 'ball', finS: 0.5 } } },
      hut: { pal: palOf({ timber: [0x6a4a30, 0x5c4028, 0x765438] }) } },
  },
  ironbound: {
    glow: [0.95, 0.13, 0.05], window: 0.85,
    pal: palOf({ stone: [0x2e2c2e, 0x262426, 0x363436, 0x2a282c], plaster: [0x4a4444, 0x3e3a3a], timber: [0x1e1c1c, 0x262222, 0x181616], roof: [0x3a2a24, 0x2c2422, 0x44302a, 0x302826], moss: [0x2a2a24, 0x22221e], gold: [0x8a6a34, 0x7a5c2c], iron: [0x1a1a1c, 0x222224], other: [0x6e1a12, 0x3a3436, 0x8a6a34] }),
    roof: { main: { kind: 'flat', f: 0.35, wall: { stone: 0x2e2c2e, st: { len: [0.4, 0.8], course: 0.25 } }, merlon: 'point', mh: 0.36, mw: 0.2, gap: 1.5, merlonCol: [0.07, 0.065, 0.07], edge: [0.09, 0.085, 0.09], edgeKind: K_PLAIN, edgeRough: 0.5, edgeMetal: 0.8, floor: [0.08, 0.075, 0.08] },
      cap: { kind: 'cap', merlon: 'point', mh: 0.34, edge: [0.09, 0.085, 0.09], merlonCol: [0.07, 0.065, 0.07] } },
    by: { humble: { roof: { main: { kind: 'keep' } } } },
    disp: shapeOf({ batter: 0.04 }),
    fx(cls, x, y, z, ny, c, a, k) {
      if (cls === C_TIMBER || cls === C_IRON || k.roof) { a[0] = 0.55; a[1] = 0.75; }   // everything that was wood is iron plate
      if (cls === C_STONE && !k.roof) { const e = smooth(0.02, 0.005, Math.abs(noise3(x * 1.9 + k.s1, y * 1.9, z * 1.9 + k.s2) - 0.5)) * smooth(0.9, 0.2, y) * 0.8; if (e > 0.05) { tintTo(c, [0.9, 0.12, 0.03], e); a[2] = Math.max(a[2], e); } }
    },
  },
  screaming: {
    glow: [0.75, 1.0, 0.25], window: 1.1,
    pal: palOf({ stone: [0x8a6aa0, 0x5aa0a0, 0xb0a890, 0x7a5a94, 0x9a8ab0, 0xa07a40], plaster: [0xb8c090, 0xa8b484, 0xc8c8a0], timber: [0x9a7a34, 0x8a6a2c, 0xa8883c], roof: [0x7a3aa8, 0x2a9a9a, 0xb83a8a, 0x4a6ad0, 0x3ab07a], moss: [0x8ab03a, 0x9ac040], gold: [0xe0b83a, 0xd0a830], iron: [0xd0c8a8, 0xbcb294], other: [0xb83a8a, 0x3ab07a, 0xe0b83a] }),
    roof: { cap: { kind: 'cap', shape: 'bulb', hk: 1.6, rk: 1.0, drum: 0.1, col: domeSpiral(rgb(0x7a3aa8), rgb(0x2a9a9a), 5, 2.6), rough: 0.2, metal: 0.2, glow: 0.3, finial: 'flame', finS: 0.6, flame: [[0.7, 1.0, 0.3], [0.9, 0.3, 0.9], [0.3, 0.9, 0.8]], fin: BRASS } },
    disp: shapeOf({ warp: 0.13, twist: 0.13, stretch: 0.06, jag: 0.1 }),
    fx(cls, x, y, z, ny, c, a, k) {
      if (k.roof) { a[0] = 0.2; a[1] = 0.25; a[2] = Math.max(a[2], 0.3); }   // crystal roofs lit from inside
      if (cls === C_TIMBER) { a[0] = 0.4; a[1] = 0.8; }
      if (cls === C_GLOW || cls === C_GLASS) { const h = noise3(x * 2.2 + k.s1, y * 2.2, z * 2.2); tintTo(c, h < 0.4 ? [1.0, 0.2, 0.85] : h < 0.6 ? [0.3, 1.0, 0.3] : [1.0, 0.9, 0.2], 0.8); }
      if (cls === C_STONE) { const v = smooth(0.014, 0.003, Math.abs(noise3(x * 1.5 + k.s2, y * 1.5, z * 1.5 + k.s1) - 0.5)); if (v > 0.05) { tintTo(c, [0.9, 0.3, 0.9], v); a[2] = Math.max(a[2], v * 1.2); } }
    },
  },
  cloven: {
    glow: [1.0, 0.4, 0.1], window: 0.3,
    pal: palOf({ stone: [0x6a6658, 0x5e5a4e, 0x767262, 0x545046], plaster: [0x857a62, 0x786e58], timber: [0x4a3a2a, 0x3e3024, 0x564432], roof: [0x5a4634, 0x4a3a2c, 0x66503a, 0x3e3228], moss: [0x4a5a2e, 0x3e4e28, 0x566634], gold: [0xc8bc9c, 0xb4a888], iron: [0x3a342e, 0x2e2a26], other: [0x6e1a12, 0x8a6a48, 0x4a6a2e] }),
    roof: { main: { kind: 'drape', thick: 0.06, sag: 0.16, over: 0.2, drop: 0.16, smooth: 1, surf: K_CLOTH, col: hidePatch(rgb(0x6a4a30), 3), skirt: 0.07 }, cap: { kind: 'cap', shape: 'tent', hs: 0.9, rk: 1.05, drum: 0, col: (a, t, x, y, z) => hidePatch(rgb(0x6a4a30), 5)(x, y, z), rough: 0.95, finial: null } },
    by: { grand: { roof: { main: { kind: 'keep' } } }, plain: { roof: { main: { kind: 'keep' } } } },
    disp: shapeOf({ crumble: 0.3, sag: 0.06, lean: 0.03 }),
    drop: (cls, x, y, z, k) => (cls === C_RED || cls === C_SLATE || cls === C_STONE) && fbm3(x * 2.1 + k.s2, y * 2.1, z * 2.1 + k.s1, 2) > 0.6,
    fx(cls, x, y, z, ny, c, a, k) { // overgrown, and daubed with blood: smears and crude rings
      if (cls !== C_GLOW && cls !== C_GLASS && !k.roof) mossOn(c, x, y, z, ny, k, 0.7, [0.13, 0.16, 0.06]);
      if ((cls === C_STONE || cls === C_PLASTER) && ny < 0.5) { const n = noise3(x * 2.3 + k.s1, y * 1.1, z * 2.3 + k.s2), ring = Math.abs(noise3(x * 0.9 + k.s2, y * 0.9, z * 0.9) - 0.5); if (y > 0.3 && (n > 0.8 || ring < 0.009)) tintTo(c, [0.17, 0.02, 0.015], 0.85); }
      if (cls === C_GOLD || cls === C_IRON) { a[0] = 0.8; a[1] = 0; }
    },
  },
  fimbul: {
    glow: [1.0, 0.6, 0.2], window: 0.6,
    pal: palOf({ stone: [0x6c6e72, 0x606266, 0x787a7e, 0x56585c], plaster: [0x8a7a5e, 0x7c6e54], timber: [0x5a4230, 0x4e3828, 0x664c38, 0x44302a], roof: [0x4a3a2c, 0x3e3026, 0x564434, 0x362a22], moss: [0x3a4a34, 0x2e3e2c], gold: [0xc8a44a, 0xb89440], iron: [0x4a4a50, 0x3c3c42], other: [0x8a2a22, 0x2a4a7a, 0xc8a44a] }),
    roof: { cap: { kind: 'cap', shape: 'tent', hs: 1.3, col: domeTiles(sw(0x4a3a2c, 0x3e3026, 0x564434)), finial: 'spike', finS: 0.5, fin: [0.25, 0.25, 0.28] } },
    by: { humble: { pal: palOf({ stone: [0x6a4e36, 0x5e442e, 0x76583e, 0x523c28], plaster: [0x7a5c40, 0x6c5038] }), joint: [0.14, 0.1, 0.07, 0.7], disp: shapeOf({ logs: 0.03, stretch: 0.2 }) } },
    disp: shapeOf({ stretch: 0.12 }),
    fx(cls, x, y, z, ny, c, a, k) { if (cls !== C_GLOW && cls !== C_GLASS) snowOn(c, a, x, y, z, ny, k, 0.5); },
  },
  ashur: {
    glow: [1.0, 0.36, 0.05], window: 1.0, trim: [rgb(0xb08a3a)],
    pal: palOf({ stone: [0x2a2630, 0x3e2a28, 0x22202a, 0x4a2e28, 0x302a34], plaster: [0x1e2a3a, 0x1a2432], timber: [0xb08a3a, 0xa07c32, 0xbc9642], roof: [0x2a2630, 0x22202a, 0x34303a], moss: [0x2a2a26, 0x222220], gold: [0xd0a440, 0xc09436], iron: [0x8a6a30, 0x7a5c28], other: [0x1e3a5a, 0xb08a3a, 0x6e1a12] }),
    roof: { main: { kind: 'step', n: 3, f: 0.8, wall: { stone: 0x3a2c2c, st: { ...brickSt, course: 0.12 } }, floor: [0.07, 0.06, 0.07], band: [0.62, 0.45, 0.14], bandMetal: 0.85, bandRough: 0.35, merlon: 'step', mh: 0.26, mw: 0.26, edge: [0.1, 0.085, 0.09], on: (g, A, B, y, c, env) => { const r = Math.min(A, B) * 0.3; g.surf(K_STONE, 0.9); g.in(M(A * 0.25, y, 0), () => { g.lathe([[r * 1.2, 0], [r, 0.1], [r * 0.8, 0.9], [r * 0.95, 0.95], [r * 0.95, 1.05], [r * 0.6, 1.05]], nq(10), stoneTint([0.09, 0.07, 0.07], 3)); g.surf(K_PLAIN, 1, 0, 1.2); g.in(M(0, 1.03, 0), () => g.cyl(r * 0.6, r * 0.6, 0.001, 8, [1.0, 0.3, 0.04], false, true)); g.in(M(0, 1.0, 0), () => plume(g, 1.5, [0.05, 0.045, 0.045], env.seed % 7)); }); return 1.9; } },
      cap: { kind: 'cap', merlon: 'step', mh: 0.26, edge: [0.12, 0.1, 0.1], shape: 'cone', hk: 0.9, seg: 4, col: rgb(0xb08a3a), metal: 0.85, rough: 0.35, drum: 0.5, drumCol: [0.1, 0.08, 0.08], finial: 'flame', finS: 0.5, fin: rgb(0xb08a3a) } },
    by: { humble: { roof: { main: { kind: 'flat', f: 0.4, wall: { stone: 0x3a2c2c, st: { ...brickSt, course: 0.12 } }, merlon: 'step', mh: 0.24, mw: 0.24, edge: [0.1, 0.085, 0.09], floor: [0.07, 0.06, 0.07], on: (g, A, B, y, c, env) => { g.surf(K_STONE, 0.9); g.in(M(-A * 0.4, y, B * 0.3), () => { g.cyl(0.14, 0.11, 0.7, 8, stoneTint([0.09, 0.07, 0.07], 3), false, true); g.in(M(0, 0.68, 0), () => plume(g, 1.0, [0.05, 0.045, 0.045], env.seed % 5)); }); return 1.3; } } } } },
    fx(cls, x, y, z, ny, c, a, k) {
      if (cls === C_TIMBER || cls === C_GOLD || cls === C_IRON) { a[0] = 0.38; a[1] = 0.85; }   // brass plating
      if (cls === C_STONE && !k.roof) { // glazed brick, and the furnace glow leaking from low vents
        a[0] = lerp(a[0], 0.45, 0.6);
        const vent = smooth(0.34, 0.3, y) * smooth(0.1, 0.14, y) * (tri1((x + z) * 1.3) > 0.72 ? 1 : 0);
        if (vent > 0.3) { tintTo(c, [1.0, 0.3, 0.03], vent); a[2] = Math.max(a[2], 1.2 * vent); }
      }
    },
  },
  greenhide: {
    glow: [1.0, 0.55, 0.12], window: 0.4,
    pal: palOf({ stone: [0x6e5236, 0x62482e, 0x7a5c3e, 0x58402a], plaster: [0x8a6a44, 0x7c5e3c], timber: [0x4e3c28, 0x5a4630, 0x3e3020, 0x665038], roof: [0x7a4a2a, 0x5a5048, 0x8a5a30, 0x4a4440, 0x6a3a22], moss: [0x4a5226, 0x3e4620], gold: [0x8a4a22, 0x7a3e1c], iron: [0x4a3a30, 0x3e3028], other: [0xb8281c, 0xc8bc9c, 0x4a5226] }),
    roof: { cap: { kind: 'cap', shape: 'cone', hs: 0.8, col: domeTiles(sw(0x7a4a2a, 0x5a5048, 0x8a5a30, 0x4a4440)), metal: 0.45, rough: 0.7, finial: 'spike', finS: 0.5, fin: [0.3, 0.2, 0.12] } },
    disp: shapeOf({ lean: 0.055, wob: 0.13, sag: 0.09 }),
    drop: (cls, x, y, z, k) => (cls === C_RED || cls === C_SLATE) && noise3(x * 2.9 + k.s1, y * 2.9, z * 2.9 + k.s2) > 0.86,
    fx(cls, x, y, z, ny, c, a, k) {
      if (k.roof || cls === C_IRON || cls === C_GOLD) { a[0] = 0.75; a[1] = 0.5; }   // roofs of scrap sheet
      if (cls === C_STONE || cls === C_PLASTER) { // a row of red teeth daubed under the eaves, mud splashed up from the ground
        const hf = y / k.H, band = ny > 0.4 ? 0 : smooth(0.52, 0.54, hf) * smooth(0.68, 0.66, hf);
        if (band > 0 && tri1((x + z) * 2.1 + 0.3 * noise3(x, y * 3, z)) > (hf - 0.52) / 0.15) tintTo(c, [0.5, 0.04, 0.025], band * 0.9);
        tintTo(c, [0.2, 0.14, 0.08], smooth(0.5, 0.05, y) * 0.6 * noise3(x * 3 + k.s1, 1, z * 3));
      }
    },
  },
  skar: {
    glow: [0.16, 1.0, 0.1], window: 0.9,
    pal: palOf({ stone: [0x5a5448, 0x4e4a40, 0x666052, 0x464238], plaster: [0x7a7260, 0x6c6454], timber: [0x3e3428, 0x4a3e30, 0x33291f, 0x54463a], roof: [0x4a4038, 0x5a4a3a, 0x3a3a34, 0x6a5a40, 0x7a5236], moss: [0x4a5230, 0x3c4428], gold: [0xb86a3c, 0xa85c32], iron: [0x4f8a74, 0x8a5a3a, 0x3f7a66], other: [0x7a2a22, 0x8a8a5a, 0x4a6a8a] }),
    roof: { cap: { kind: 'cap', shape: 'tent', hs: 0.9, col: domeTiles(sw(0x4a4038, 0x5a4a3a, 0x3a3a34, 0x7a5236)), finial: 'spike', finS: 0.45, fin: rgb(0xb86a3c) } },
    disp: shapeOf({ lean: 0.07, twist: 0.1, wob: 0.17, sag: 0.05 }),
    drop: (cls, x, y, z, k) => (cls === C_RED || cls === C_SLATE) && noise3(x * 2.6 + k.s1, y * 2.6, z * 2.6 + k.s2) > 0.84,
    fx(cls, x, y, z, ny, c, a, k) { // patches of new board over old, verdigris on every bit of copper
      if (cls === C_STONE || cls === C_PLASTER || k.roof) { const p = noise3(x * 1.3 + k.s1, y * 1.6, z * 1.3 + k.s2); if (p > 0.68) tintTo(c, [0.42, 0.3, 0.16], 0.75); else if (p < 0.24) tintTo(c, [0.1, 0.09, 0.08], 0.5); }
      if (cls === C_GOLD || cls === C_IRON) { a[0] = 0.45; a[1] = 0.8; }
    },
  },
  crimson: {
    glow: [0.95, 0.05, 0.07], window: 1.15, trim: [rgb(0x56545c)],
    pal: palOf({ stone: [0x2e2c32, 0x26242a, 0x36343a, 0x2a2a30], plaster: [0x62606a, 0x56545e], timber: [0x221c1c, 0x1a1616, 0x2a2222], roof: [0x2a2228, 0x241c22, 0x32262c, 0x1e181c], moss: [0x2e3430, 0x262c28], gold: [0x9a9aa4, 0x8a8a94], iron: [0x1e1e22, 0x26262a], other: [0x7a0e16, 0x5a0a12, 0x36343a] }),
    roof: { main: { kind: 'hip', hs: 1.9, curve: 1.2, ov: 0.14, pal: BLACK_TILE, ridge: [0.06, 0.06, 0.07], ridgeMetal: 0.7, under: [0.03, 0.03, 0.03], plate: [0.1, 0.09, 0.1], maxH: 3.4 }, cap: { kind: 'cap', shape: 'bell', hs: 2.3, col: domeTiles(BLACK_TILE), finial: 'spike', finS: 0.7, fin: [0.3, 0.3, 0.34] } },
    disp: shapeOf({ crumble: 0.07, pinch: 0.03 }),
    fx(cls, x, y, z, ny, c, a, k) { if (cls === C_STONE && !k.roof) { const e = smooth(0.55, 0.85, noise3(x * 3.2 + k.s1, y * 3.2, z * 3.2 + k.s2)) * smooth(0.5, 1, y / k.H); tintTo(c, [0.3, 0.3, 0.33], e * 0.5); } },
  },
  khemet: {
    glow: [1.0, 0.7, 0.25], window: 0.5, trim: [rgb(0xecd8a4)],
    pal: palOf({ stone: [0xd9b878, 0xcfae6e, 0xe2c488, 0xc6a466], plaster: [0xead8a8, 0xe0cc9a], timber: [0x6a4a2a, 0x5c4024, 0x765432], roof: [0xc8a868, 0xbc9c5e, 0xd4b474], moss: [0x5a7a3a, 0x4c6a30], gold: [0xe8b830, 0xdaa828], iron: [0x2a4aa0, 0x24408c], other: [0x2a4aa0, 0xb8402a, 0xe8b830] }),
    roof: { main: { kind: 'flat', f: 0.4, wall: { stone: 0xd9b878 }, merlon: 'cavetto', edge: (x, y, z) => (y > 0.1 ? [[0.12, 0.25, 0.6], [0.82, 0.62, 0.12], [0.62, 0.16, 0.1], [0.82, 0.62, 0.12]][Math.floor(Math.abs(x) * 9) % 4] : rgb(0xe2c488)), floor: rgb(0xb89a62) },
      cap: { kind: 'cap', shape: 'cone', hk: 0.9, rk: 0.8, drum: 0.5, drumCol: rgb(0xe2c488), col: rgb(0xe8b830), metal: 0.9, rough: 0.3, seg: 4 } },
    disp: shapeOf({ batter: 0.07 }),
    fx(cls, x, y, z, ny, c, a, k) { // a band of picture-writing in blue and gold, a painted dado
      if (cls === C_STONE && !k.roof && ny < 0.4) {
        const hf = y / k.H, band = smooth(0.6, 0.615, hf) * smooth(0.72, 0.705, hf);
        if (band > 0) { const u = Math.floor((x + z) * 7), h = hash1(u, Math.floor(hf * 40)); tintTo(c, h < 0.4 ? [0.1, 0.2, 0.55] : h < 0.6 ? [0.8, 0.6, 0.1] : h < 0.7 ? [0.6, 0.15, 0.08] : [0.9, 0.82, 0.6], band * 0.9); }
        const d = smooth(0.34, 0.3, y) * smooth(0.22, 0.26, y); tintTo(c, [0.1, 0.2, 0.55], d * 0.8);
      }
    },
  },
  drowned: {
    glow: [0.1, 0.95, 0.45], window: 0.9,
    pal: palOf({ stone: [0x5a6058, 0x4e554e, 0x666c62, 0x464c46], plaster: [0x8a9080, 0x7c8274], timber: [0x3a3a30, 0x44443a, 0x2e3028, 0x4e4a3c], roof: [0x4a4438, 0x3e3c34, 0x55503e, 0x3a4038], moss: [0x2e5a40, 0x264c36, 0x3a6a4a], gold: [0x4a9a84, 0x3f8a76], iron: [0x7a4a2a, 0x6a3e22, 0x8a5630], other: [0x2e5a50, 0x8a9080, 0x7a4a2a] }),
    roof: { main: { kind: 'hull', hs: 0.95 }, cap: { kind: 'cap', shape: 'low', hk: 1.5, drum: 0.15, col: (a, t, x, y, z) => mul(tri1(t * 4) > 0.8 ? [0.03, 0.03, 0.025] : [0.13, 0.12, 0.09], 0.8 + 0.4 * noise3(x * 7, y * 7, z * 7)), rough: 0.9, finial: 'lantern', finS: 0.7, lan: [0.14, 0.12, 0.09], lanKind: K_WOOD, lanGlow: [0.1, 0.95, 0.45], capCol: [0.2, 0.3, 0.25], fin: [0.3, 0.2, 0.12] } },
    disp: shapeOf({ sag: 0.06, wob: 0.09, lean: 0.03 }),
    fx(cls, x, y, z, ny, c, a, k) { // sea-wrack: barnacles low down, weed and wet above them
      if (cls === C_GLOW || cls === C_GLASS) return;
      const wet = smooth(1.3, 0.1, y); c[0] *= 1 - 0.3 * wet; c[1] *= 1 - 0.22 * wet; c[2] *= 1 - 0.2 * wet;
      if (!k.roof && cells3(x * 11, y * 11, z * 11) < 0.16 && noise3(x * 1.2 + k.s1, y * 1.2, z * 1.2 + k.s2) > 0.52) tintTo(c, [0.45, 0.46, 0.4], 0.8);
      else tintTo(c, [0.08, 0.2, 0.12], smooth(0.55, 0.8, noise3(x * 2 + k.s2, y * 0.8, z * 2 + k.s1)) * 0.7);
      if (cls === C_IRON) { a[0] = 0.85; a[1] = 0.4; }
    },
  },
  gorge: {
    glow: [1.0, 0.5, 0.12], window: 0.4,
    pal: palOf({ stone: [0x6a5e50, 0x5e5448, 0x766a5a, 0x544a40], plaster: [0xa88a60, 0x9a7c54, 0xb4966c], timber: [0xd9d0b4, 0xcbbf9c, 0xc0b490, 0xe0d8c0], roof: [0x9a7a50, 0x8a6c46, 0xa6865a], moss: [0x4a4a34, 0x3e3e2c], gold: [0xd9d0b4, 0xcbbf9c], iron: [0x3a342e, 0x2e2a26], other: [0x7a2a1a, 0xa88a60, 0xd9d0b4] }),
    roof: { main: { kind: 'drape', thick: 0.07, sag: 0.1, over: 0.22, drop: 0.13, smooth: 2, surf: K_CLOTH, col: hidePatch(rgb(0xa88458), 7), skirt: 0.08, on: (g, c, env, topAt) => { const n = clamp(Math.round((c.ax ? c.d : c.w) / 0.7), 2, 6); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = c.ax ? c.cx : lerp(c.x0, c.x1, t), z = c.ax ? lerp(c.z0, c.z1, t) : c.cz, hw = (c.ax ? c.w : c.d) / 2; for (const e of [-1, 1]) { const ex = c.ax ? e * hw : 0, ez = c.ax ? 0 : e * hw; rib(g, [x + ex * 1.02, topAt(x + ex * 0.9, z + ez * 0.9) - 0.1, z + ez * 1.02], [x + ex * 0.06, c.rY + 0.3, z + ez * 0.06], [ex * 0.3, (c.rY - c.eY) * 0.45, ez * 0.3], 0.05, i + e); } } } },
      cap: { kind: 'cap', shape: 'tent', hs: 0.9, rk: 1.05, drum: 0, col: (a, t, x, y, z) => hidePatch(rgb(0xa88458), 5)(x, y, z), rough: 0.95, finial: null } },
    disp: shapeOf({ bulge: 0.05, sag: 0.04 }),
    fx(cls, x, y, z, ny, c, a, k) { // soot and fat-smoke blacken everything above the fires
      if (cls === C_GLOW || cls === C_GLASS) return;
      const s = smooth(0.35, 1, y / k.H) * smooth(0.4, 0.75, noise3(x * 1.4 + k.s1, y * 0.6, z * 1.4 + k.s2)) * (cls === C_TIMBER ? 0.35 : 0.7); c[0] *= 1 - 0.7 * s; c[1] *= 1 - 0.72 * s; c[2] *= 1 - 0.72 * s;
      if (cls === C_TIMBER || cls === C_GOLD) { a[0] = 0.7; a[1] = 0; }
    },
  },
  westmark: {
    glow: [1.0, 0.8, 0.45], window: 0.45, trim: [rgb(0xeeeae0)], joint: [0.72, 0.68, 0.6, 0.55],
    pal: palOf({ stone: [0xa8482e, 0x9a4028, 0xb45236, 0x8c3a26, 0xa24a32], plaster: [0xeeeae0, 0xe4e0d4], timber: [0x5e3e2a, 0x523424, 0x6a4832, 0x2e4a3a], roof: [0x3a3c44, 0x32343c, 0x44464e, 0x2c2e36], moss: [0x4a6a3a, 0x3c5a30], gold: [0xe0aa2e, 0xd09a26], iron: [0x2a2a2e, 0x222226], other: [0xe07a1e, 0xeeeae0, 0x2a4a8a] }),
    roof: { main: { kind: 'gables', stone: 0xa8482e, st: brickSt, cope: rgb(0xeeeae0), steps: 6, rise: 0.34, fin: 'ball' }, cap: { kind: 'cap', shape: 'bulb', hk: 1.2, drum: 0.25, drumCol: rgb(0xa8482e), col: domeTiles(sw(0x4a9a80, 0x3f8c74, 0x58a88c, 0x449078)), metal: 0.3, rough: 0.6, finial: 'ball', finS: 0.5 } },
    by: { grand: { pal: palOf({ roof: [0x4a9a80, 0x3f8c74, 0x58a88c, 0x449078] }) } },
    fx(cls, x, y, z, ny, c, a, k) { // bands of white stone through the brick
      if (cls === C_STONE && !k.roof && ny < 0.4) { const f = ((y + 0.02) / 0.8) % 1; if (f < 0.11 && y > 0.5) tintTo(c, [0.86, 0.83, 0.76], 0.85); }
    },
  },
  principalities: {
    glow: [1.0, 0.72, 0.35], window: 0.5, trim: [rgb(0xf4efe2)],
    pal: palOf({ stone: [0xe8cfa0, 0xe0c490, 0xf0d8ae, 0xd8bc88], plaster: [0xe0a878, 0xd89c6c, 0xe8b488], timber: [0x5a3e28, 0x4c3420, 0x664830], roof: [0xc8643a, 0xb85830, 0xd47444, 0xa84e2c], moss: [0x4a6a34, 0x3c5a2c], gold: [0xe0aa2e, 0xd09a26], iron: [0x3a3a3e, 0x2e2e32], other: [0x8a2a22, 0xe0aa2e, 0x2a5a3a] }),
    roof: { main: { kind: 'hip', hs: 0.78, curve: 1, ov: 0.24, pal: TERRA, round: true, ridge: rgb(0xb85830), under: [0.3, 0.2, 0.14], plate: rgb(0xe8dcc0) }, cap: { kind: 'cap', shape: 'cone', hs: 0.5, out: 0.06, drum: 0.5, drumCol: rgb(0xe8cfa0), col: domeTiles(TERRA), finial: 'ball', finS: 0.4 } },
    by: { grand: { roof: { main: { kind: 'dome', shape: 'hemi', f: 0.32, rk: 0.76, drum: 0.42, drumCol: stoneTint(rgb(0xf0e6cc), 3), drumWin: [0.1, 0.1, 0.14], col: domeTiles(TERRA, 8), ribs: 8, ribCol: [0.92, 0.88, 0.78], seg: 24, finial: 'lantern', lan: rgb(0xf0e6cc), capCol: TERRA[0], wall: { stone: 0xe8cfa0 }, merlon: 'none', rim: 0.12, edge: rgb(0xf0e6cc), floor: rgb(0xc8a878) } } } },
  },
  sunkings: {
    glow: [1.0, 0.75, 0.35], window: 0.5, trim: [rgb(0xd8a83a)],
    pal: palOf({ stone: [0xf2efe6, 0xe8e4d8, 0xf8f6ee, 0xe0dcd0], plaster: [0xf4f0e6, 0xeae6da], timber: [0x4a3424, 0x3e2a1c, 0x56402e], roof: [0xb8402a, 0xa83a26, 0xc64e30, 0x9c3422], moss: [0x4a6a34, 0x3c5a2c], gold: [0xf0c030, 0xe0b028], iron: [0x1a1a1c, 0x222224], other: [0xb8281c, 0xf0c030, 0x2a4a9a] }),
    roof: { main: { kind: 'hip', hs: 0.8, curve: 1, ov: 0.22, pal: RED_TILE, round: true, ridge: rgb(0x9c3422), under: [0.2, 0.14, 0.1], plate: rgb(0xf2efe6) }, cap: { kind: 'cap', shape: 'hemi', hk: 1.05, rk: 0.95, drum: 0.6, drumCol: rgb(0xf2efe6), col: (a, t, x, y, z) => (Math.floor((a / TAU) * 16 + Math.floor(t * 6) * 0.5) % 2 ? [0.12, 0.25, 0.62] : [0.86, 0.84, 0.78]), rough: 0.35, finial: 'ball', finS: 0.5 } },
    by: { grand: { roof: { main: { kind: 'keep' } } } },
  },
  caliphate: {
    glow: [1.0, 0.66, 0.25], window: 0.5, trim: [rgb(0xeadfc4)],
    pal: palOf({ stone: [0xd6b684, 0xcaa876, 0xdfc292, 0xc4a06e], plaster: [0xead9b4, 0xe0cda6], timber: [0x5e4430, 0x4e3828, 0x6a4e38], roof: [0x1fa39c, 0x2ab4ae, 0x188c8c, 0x35bdb0], moss: [0x5a7a3a, 0x4a6a30], gold: [0xe2b23a, 0xd4a22e], iron: [0x9a7a34, 0x86682a], other: [0x1fa39c, 0xb8342a, 0xeadfc4] }),
    roof: { main: { kind: 'dome', shape: 'point', f: 0.32, rk: 0.74, drum: 0.3, drumCol: stoneTint(rgb(0xd6b684), 3), drumWin: [0.08, 0.2, 0.3], col: domeBands(TURQ[0], rgb(0xe2b23a), 5, 0.12), finial: 'ball', wall: { stone: 0xd6b684 }, merlon: 'round', mh: 0.2, edge: rgb(0xdfc292), floor: rgb(0xb89a6a) },
      cap: { kind: 'cap', shape: 'point', rk: 0.92, drum: 0.5, hk: 1, drumCol: rgb(0xdfc292), col: domeBands(TURQ[1], rgb(0xe2b23a), 4, 0.14), finial: 'ball', finS: 0.45 } },
    by: { humble: { roof: { main: { kind: 'flat', f: 0.42, wall: { stone: 0xd6b684, st: { chip: 0.05 } }, merlon: 'none', rim: 0.14, edge: rgb(0xdfc292), floor: rgb(0xb89a6a), on: (g, A, B, y) => { g.in(M(A * 0.3, y, -B * 0.25), () => domeOn(g, Math.min(A, B) * 0.34, { shape: 'hemi', drum: 0.2, drumCol: rgb(0xdfc292), col: rgb(0xeadfc4), kind: K_PLASTER, rough: 0.9 })); return 0.5; } } } } },
    fx(cls, x, y, z, ny, c, a, k) { // a frieze of glazed tile under the eaves
      if (cls === C_STONE && !k.roof && ny < 0.4) { const hf = y / k.H, band = smooth(0.6, 0.612, hf) * smooth(0.68, 0.668, hf); if (band > 0) { tintTo(c, (Math.floor((x + z) * 6) + Math.floor(hf * 60)) % 2 ? [0.08, 0.5, 0.5] : [0.9, 0.86, 0.74], band * 0.9); a[0] = lerp(a[0], 0.4, band); } }
    },
  },
  shogunate: {
    glow: [1.0, 0.82, 0.5], window: 0.5, trim: [rgb(0x9a9a96)],
    pal: palOf({ stone: [0x7c7c7a, 0x6e6e6c, 0x888886, 0x646462], plaster: [0xf0ede4, 0xe6e2d8], timber: [0x2a2420, 0x221c1a, 0x322a26], roof: [0x565a62, 0x4a4e56, 0x62666e, 0x50545c], moss: [0x3a5a3a, 0x2f4a30], gold: [0xc8a44a, 0xb89440], iron: [0x1e1e20, 0x262628], other: [0xa82a1e, 0xf0ede4, 0x2a2420] }),
    roof: { main: pagoda(TILE_GREY, rgb(0x3a3e46), null, SG_BAND, { curve: 1.35, lift: 0.2, ov: 0.32, under: [0.1, 0.09, 0.08], plate: woodTint(rgb(0x2a2420), 2) }), cap: { kind: 'cap', shape: 'sweep', hs: 0.75, out: 0.02, col: domeTiles(TILE_GREY), finial: 'spike', finS: 0.4, fin: rgb(0xc8a44a) } },
    by: { humble: { pal: palOf({ stone: [0xf0ede4, 0xe6e2d8, 0xf6f4ec, 0xdedad0] }), trim: null }, plain: { disp: shapeOf({ batter: 0.07 }) } },
    fx(cls, x, y, z, ny, c, a, k) { // above the stone base the walls are white plaster
      if (cls === C_STONE && !k.roof) { const t = smooth(0.5, 0.56, y / Math.min(k.H, 3.2)) * 0.9, l = clamp(0.55 + 0.45 * k.rel, 0.6, 1.05); tintTo(c, [0.88 * l, 0.86 * l, 0.8 * l], t); }
    },
  },
  mistisles: {
    glow: [1.0, 0.6, 0.25], window: 0.35,
    pal: palOf({ stone: [0x7d8078, 0x70746c, 0x8a8c84, 0x666a62, 0x767a70], plaster: [0xb8b8a8, 0xacac9c], timber: [0x5e5a4c, 0x524e42, 0x6a6656], roof: [0x8a8058, 0x7c724e, 0x968c62], moss: [0x4a6a34, 0x3c5a2c, 0x5a7a3c], gold: [0xa8a48c, 0x98947c], iron: [0x3a3c3a, 0x2e302e], other: [0x4a6a7a, 0x8a8c84, 0x6a5a3a] }),
    roof: { main: { kind: 'drape', thick: 0.15, over: 0.18, smooth: 2, col: thatchCol(STRAW_OLD, 7, 0.7, 0.55), skirt: 0.22 }, cap: { kind: 'cap', shape: 'tent', hs: 0.95, rk: 1.08, drum: 0, col: (a, t, x, y, z) => thatchCol(STRAW_OLD, 9, 0.7, 0.5)(x, y, z, 1, 0.5, 0), rough: 0.96, finial: null } },
    disp: shapeOf({ bulge: 0.045, wob: 0.05 }),
    fx(cls, x, y, z, ny, c, a, k) { if (cls !== C_GLOW && cls !== C_GLASS && !k.roof) mossOn(c, x, y, z, ny, k, 0.7); },
  },
  thousandgods: {
    glow: [1.0, 0.6, 0.15], window: 0.6, trim: [rgb(0xf0ebe0)],
    pal: palOf({ stone: [0xc88a5a, 0xb87a4c, 0xd49a68, 0xa86c42, 0xc08458], plaster: [0xf0ebe0, 0xe6e0d4], timber: [0x5a3420, 0x4c2a1a, 0x663e28], roof: [0xc88a5a, 0xb87a4c, 0xd49a68], moss: [0x4a7a34, 0x3c6a2c], gold: [0xe8b430, 0xdaa428], iron: [0xb08a3a, 0xa07c32], other: [0xd8287a, 0xf0921e, 0x1a9a8a] }),
    roof: { main: { kind: 'shikhara', wall: { stone: 0xc88a5a }, c1: rgb(0xc88a5a), c2: rgb(0xa86c42), floor: rgb(0xa87a52) }, cap: { kind: 'cap', spire: true, hs: 1.2, c1: rgb(0xc88a5a), c2: rgb(0xa86c42) } },
    by: { humble: { roof: { main: { kind: 'flat', f: 0.4, wall: { stone: 0xc88a5a }, merlon: 'round', mh: 0.16, mw: 0.18, edge: rgb(0xd49a68), floor: rgb(0xa87a52), on: (g, A, B, y, c, env) => { g.in(M(-A * 0.35, y, -B * 0.3), () => spire(g, Math.min(A, B) * 0.36, Math.min(A, B) * 0.9, { lite: true }, env.seed % 9)); return Math.min(A, B) * 1.05; } } } } },
    fx(cls, x, y, z, ny, c, a, k) { // every course carved: rows of little niches, a band of white inlay
      if (cls === C_STONE && !k.roof && ny < 0.5) {
        const row = ((y / 0.4) % 1 + 1) % 1, u = (x + z) * 5;
        if (row > 0.3 && row < 0.8 && tri1(u) > 0.5) { const q = tri1(u) > 0.8 && row > 0.4 && row < 0.7; tintTo(c, q ? [0.78, 0.6, 0.4] : [0.2, 0.1, 0.06], 0.55); }
        const hf = y / k.H, band = smooth(0.5, 0.51, hf) * smooth(0.54, 0.53, hf);
        if (band > 0) tintTo(c, Math.floor(u * 0.8) % 4 === 0 ? [0.6, 0.12, 0.3] : [0.86, 0.82, 0.74], band * 0.8);
      }
    },
  },
});
// ---------- what each realm hangs on its buildings ----------
const facing = (a) => [[0, 1], [1, 0], [0, -1], [-1, 0]][a.dir ?? 0];
/** something standing on the ground in front of the door, midway between the two door anchors; fn(width) runs facing out */
function atDoor(g, sv, est, out, fn) {
  if (sv.door.length < 2) return;
  const [a, b] = sv.door, d = facing(a);
  capped(g, sv, est, () => g.in(M((a.x + b.x) / 2 + d[0] * out, 0, (a.z + b.z) / 2 + d[1] * out, 0, a.yaw, 0), () => fn(Math.hypot(a.x - b.x, a.z - b.z))));
}
const onGround = (g, a, out, fn) => g.in(M(0, -a.y, out), fn);
Object.assign(ORNAMENTS, {
  graal(g, sv) {
    const sc = sv.sc, blue = rgb(0x2d4a9c), gold = rgb(0xe0aa2e);
    dress(g, sv, {
      ridge: [300, (a, i) => g.in(M(0, -0.1, -0.06), () => pennon(g, 0.9 * sc, 0.6 * sc, i ? gold : blue, i ? blue : gold))],
      corner: [420, (a, i) => (i % 2 ? g.in(M(0, -0.05, 0), () => pennon(g, 0.8 * sc, 0.5 * sc, blue, gold)) : pinnacle(g, 0.8 * sc, 'bell', { col: SLATE_BLUE[0], finial: 'spike', shaft: 0.3, hk: 1.3, shaftCol: [0.8, 0.78, 0.72] }))],
      face: [520, (a, i) => ((i + a.dir) % 2 ? g.in(M(0, 0.3 * sc, 0.02), () => hanging(g, 0.42 * sc, Math.min(0.95 * sc, a.y - 0.05), blue, gold, { device: gold, point: true })) : HUMBLE.has(sv.id) ? g.in(M(0, 0.05, 0.02), () => heater(g, 0.7 * sc, blue, gold, { quarter: true })) : g.in(M(0, -0.25 * sc, 0), () => archFrame(g, 0.34 * sc, 0.72 * sc, 'point', [0.86, 0.84, 0.78], { fill: (x, y) => [[0.7, 0.1, 0.08], [0.12, 0.25, 0.8], [0.9, 0.65, 0.12], [0.12, 0.55, 0.25]][(Math.floor(x * 14 + 40) + Math.floor(y * 11 + 40)) % 4], fillGlow: 0.3, t: 0.03 })))],
      door: [300, () => bracketLamp(g, 1.1 * sc, [1.0, 0.62, 0.22])],
    });
  },
  aurelia(g, sv) {
    const sc = sv.sc, holy = sv.id === 'temple' || sv.id === 'shrine';
    const relic = (s) => { g.in(M(0, -0.06 * s, 0.02, -6, 0, 0), () => skull(g, 1.5 * s, true)); g.surf(K_PLAIN, 0.4, 0.85); for (const e of [-1, 1]) g.in(M(0, -0.02 * s, 0.03, 0, 0, e * 42), () => { g.cbox(0.035 * s, 0.7 * s, 0.03, 0.006, rgb(0x5a4030)); g.in(M(0, 0.33 * s, 0.01), () => g.cbox(0.2 * s, 0.11 * s, 0.07, 0.012, [0.5, 0.48, 0.44])); }); };
    dress(g, sv, {
      ridge: [200, () => g.in(M(0, -0.06, -0.1), () => finial(g, 'ball', 0.7 * sc, { fin: BRASS }))],
      corner: [400, () => pinnacle(g, 0.8 * sc, 'bulb', { col: SLATE_DARK[0], finial: 'ball', shaft: 0.26, shaftCol: [0.4, 0.26, 0.2], finS: 0.35 })],
      face: [700, (a, i) => (holy || (i + a.dir) % 3 === 0 ? relic(0.8 * sc) : (i + a.dir) % 3 === 1 ? g.in(M(0, 0.3 * sc, 0.02), () => hanging(g, 0.4 * sc, Math.min(0.85 * sc, a.y - 0.05), rgb(0x1e1e22), rgb(0xd8b83a), { chief: true, point: true })) : g.in(M(0, 0, 0), () => windowPane(g, 0.3 * sc, 0.42 * sc, { col: [1.0, 0.7, 0.3], glow: 0.7, trim: [0.13, 0.1, 0.08], trimKind: K_WOOD, shape: 'screen' })))],
      door: [300, () => bracketLamp(g, 1.1 * sc, [1.0, 0.55, 0.18])],
    });
  },
  aethel(g, sv) {
    const sc = sv.sc, silver = rgb(0xdde2ea), marble = (x, y, z) => mul([0.93, 0.91, 0.86], 0.9 + 0.14 * noise3(x * 4, y * 9, z * 4));
    dress(g, sv, {
      ridge: [500, () => g.in(M(0, -0.05, -0.1), () => finial(g, 'crystal', 0.9 * sc, { fin: silver, cglow: 1.3 }))],
      corner: [600, () => pinnacle(g, 0.9 * sc, 'bell', { col: PALE_BLUE[0], finial: 'crystal', shaft: 0.35, hk: 1.6, shaftCol: [0.94, 0.92, 0.86], finS: 0.45, fin: silver, r: 0.085 })],
      face: [420, (a, i) => g.in(M(0, -0.32 * sc, 0), () => archFrame(g, 0.36 * sc, 0.82 * sc, 'ogee', silver, { kind: K_PLAIN, metal: 0.85, rough: 0.3, fill: [0.35, 0.7, 0.95], fillGlow: 0.55, t: 0.025 }))],
      door: [360, (a) => onGround(g, a, 0.16, () => columnOn(g, Math.min(1.7, a.wallH || 1.6), 0.075, marble, silver, { capMetal: 0.8 }))],
    });
  },
  kaelneth(g, sv) {
    const sc = sv.sc, ob = (x, y, z) => mul([0.06, 0.05, 0.08], 0.6 + 0.9 * noise3(x * 5, y * 5, z * 5)), red = rgb(0x7a0e18), fs = sv.faces;
    const shards = (s, n, lean = 26) => { for (let i = 0; i < n; i++) g.in(M(0, 0, 0, i ? lean : 6, [0, 0, 70, -70][i], 0), () => thorn(g, (i ? 0.55 : 1) * s, (i ? 0.06 : 0.085) * s, ob, { rough: 0.25, metal: 0.5 })); };
    dress(g, sv, {
      ridge: [400, () => g.in(M(0, -0.12, -0.06), () => shards(0.9 * sc, 4))],
      corner: [400, () => g.in(M(0, -0.1, 0), () => shards(0.8 * sc, 4, 9))],
      eave: [300, () => g.in(M(0, -0.12, 0, 20, 0, 0), () => thorn(g, 0.6 * sc, 0.06 * sc, ob, { rough: 0.25, metal: 0.5 }))],
      face: [460, (a, i) => g.in(M(0, 0.32 * sc, 0.02), () => hanging(g, 0.44 * sc, Math.min(1.05 * sc, a.y), red, [0.03, 0.03, 0.04], { point: true, device: [0.03, 0.03, 0.04] }))],
      door: [320, () => bracketLamp(g, 1.1 * sc, [1.0, 0.08, 0.05], { shape: 'cage' })],
    });
    fs.forEach((a, i) => { const b = fs[i + 1]; if (b && b.dir === a.dir && Math.hypot(a.x - b.x, a.z - b.z) < 4.2) capped(g, sv, 2400, () => { const d = facing(a), pts = []; for (let q = 0; q <= 8; q++) { const t = q / 8; pts.push([lerp(a.x, b.x, t) + d[0] * 0.07, lerp(a.y, b.y, t) + 0.36 * sc - 0.38 * Math.sin(t * Math.PI), lerp(a.z, b.z, t) + d[1] * 0.07]); } chain(g, pts, 0.07 * sc, [0.04, 0.04, 0.05]); }); });
  },
  verdant(g, sv) {
    const sc = sv.sc, amber = [1.0, 0.42, 0.04], bark = (x, y, z) => mul([0.3, 0.22, 0.13], 0.7 + 0.6 * noise3(x * 9, y * 2, z * 9));
    const bough = (s, lamp2) => { g.surf(K_WOOD, 0.95); limb(g, [[0, -0.15, 0], [0.04 * s, 0.25 * s, 0.05 * s], [0.02 * s, 0.6 * s, 0.16 * s], [0, 0.78 * s, 0.34 * s]], [0.06 * s, 0.05 * s, 0.035 * s, 0.02 * s], { nu: 6, nv: 8, col: bark }); g.surf(K_LEAF, 0.8); for (let i = 0; i < 5; i++) g.in(M(Math.sin(i * 2.4) * 0.12 * s, (0.5 + 0.08 * i) * s, (0.1 + 0.05 * i) * s, i * 40, i * 77, 0), () => g.poly([[0, -0.09 * s, 0], [0.06 * s, 0, 0.015], [0, 0.09 * s, 0], [-0.06 * s, 0, 0.015]], 0, 0, 1, mul([0.2, 0.42, 0.12], 0.8 + 0.1 * i))); if (lamp2) g.in(M(0, 0.76 * s, 0.34 * s), () => lamp(g, 1.1 * s, amber, { shape: 'orb', frame: [0.2, 0.15, 0.08], glow: 0.9 })); };
    dress(g, sv, {
      ridge: [420, () => g.in(M(0, -0.1, -0.1), () => bough(1.0 * sc, true))],
      corner: [420, (a, i) => g.in(M(0, -0.1, -0.05), () => bough(0.85 * sc, i % 2 === 0))],
      face: [520, (a, i) => { g.in(M(0, -a.y + 0.05, 0), () => creeper(g, 0.9 * sc, Math.min(a.wallH || 1.6, a.y + 0.7), i * 7 + a.dir, { n: 3, leaves: 10, bloom: rgb(0xe8c84a), bloomP: 0.12 })); if (i % 2 === 0) g.in(M(0, 0.2 * sc, 0), () => bracketLamp(g, 0.95 * sc, amber, { shape: 'orb', frame: [0.2, 0.15, 0.08], glow: 0.9 })); }],
      door: [340, (a) => onGround(g, a, 0.12, () => { g.surf(K_WOOD, 0.95); limb(g, [[0, -0.1, 0], [a.e * -0.03, 0.7 * sc, 0.03], [a.e * -0.12, 1.25 * sc, 0.02], [a.e * -0.4, 1.6 * sc, 0]], [0.07 * sc, 0.06 * sc, 0.045 * sc, 0.02 * sc], { nu: 6, nv: 10, amp: 0.1, seed: 3, col: bark }); })],
    });
  },
  grom(g, sv) {
    const sc = sv.sc, bronze = (x, y, z) => mul([0.5, 0.32, 0.12], 0.75 + 0.5 * noise3(x * 11, y * 11, z * 11)), cu = (x, y, z) => mix(mul([0.55, 0.3, 0.14], 0.8 + 0.4 * noise3(x * 9, y * 9, z * 9)), [0.25, 0.5, 0.42], smooth(0.6, 0.8, noise3(x * 4, y * 4 + 3, z * 4)) * 0.6);
    const vent = (s) => { pipe(g, [[0, -0.2, 0], [0, 0.3 * s, 0], [0, 0.5 * s, 0.06 * s]], 0.055 * s, cu); g.in(M(0, 0.5 * s, 0.06 * s), () => plume(g, 0.7 * s, [0.8, 0.8, 0.78], 3)); };
    dress(g, sv, {
      ridge: [520, () => g.in(M(0, -0.12, -0.2), () => vent(1.1 * sc))],
      corner: [300, () => { g.surf(K_STONE, 0.9); g.in(M(0, 0.1 * sc, 0), () => g.cbox(0.26 * sc, 0.2 * sc, 0.26 * sc, 0.03, stoneTint([0.3, 0.29, 0.28], 2))); g.surf(K_PLAIN, 0.4, 0.8); g.in(M(0, 0.22 * sc, 0), () => g.cbox(0.3 * sc, 0.05 * sc, 0.3 * sc, 0.01, bronze)); }],
      face: [620, (a, i) => { if ((i + a.dir) % 2) { g.in(M(0, 0, 0), () => plate(g, 0.5 * sc, 0.6 * sc, bronze, { rivet: [0.7, 0.5, 0.2], metal: 0.75, rough: 0.45 })); g.in(M(0, 0, 0.03), () => sigil(g, i * 11 + a.dir + 2, 0.42 * sc, [1.0, 0.4, 0.06], 0.7, 0.05)); } else pipe(g, [[-0.34 * sc, -0.45 * sc, 0.07], [-0.34 * sc, 0.1 * sc, 0.07], [-0.1 * sc, 0.3 * sc, 0.07], [0.34 * sc, 0.3 * sc, 0.07], [0.34 * sc, 0.55 * sc, 0.07]], 0.04 * sc, cu); }],
      door: [460, (a) => onGround(g, a, 0.16, () => { g.surf(K_STONE, 0.9); g.in(M(0, 0.45 * sc, 0), () => g.cbox(0.26 * sc, 0.9 * sc, 0.26 * sc, 0.03, stoneTint([0.3, 0.29, 0.28], 4))); g.surf(K_PLAIN, 0.4, 0.8); for (const y of [0.2, 0.7]) g.in(M(0, y * sc, 0), () => g.cbox(0.29 * sc, 0.07 * sc, 0.29 * sc, 0.01, bronze)); g.in(M(0, 0.9 * sc, 0), () => finial(g, 'flame', 0.6 * sc, { fin: [0.5, 0.32, 0.12] })); })],
    });
  },
  xibalba(g, sv) {
    const sc = sv.sc, lime = stoneTint(rgb(0xd8d2b8), 3);
    dress(g, sv, {
      ridge: [300, () => g.in(M(0, 0.1 * sc, -0.1), () => sunDisc(g, 0.8 * sc, GOLD, { rays: 12 }))],
      corner: [200, () => { g.surf(K_STONE, 0.92); prism(g, MERLON.step(0.34 * sc, 0.36 * sc), 0.14, lime, [0, 0.06]); g.in(M(0, 0.16 * sc, 0.075), () => g.stud(0.05 * sc, [0.1, 0.55, 0.5], 6)); }],
      face: [480, (a, i) => ((i + a.dir) % 2 ? g.in(M(0, 0.1 * sc, 0.02), () => sunDisc(g, 0.85 * sc, GOLD, { rays: 16, ray: [0.1, 0.5, 0.46] })) : g.in(M(0, (a.wallH || 1.6) - a.y - 0.05, 0), () => creeper(g, 1.0 * sc, -Math.min(1.1, a.y) * sc, i * 5 + a.dir, { n: 4, leaves: 9, size: 0.08 })))],
      door: [520, (a) => onGround(g, a, 0.18, () => megalith(g, 1.15 * sc, 0.17 * sc, a.e + 3, { col: rgb(0xcec8ac), moss: 0.3, sq: 0.9, flat: [1, 0.45], paint: (x, y, z, c) => (y > 0.25 * sc && y < 0.95 * sc && Math.abs(x) < 0.09 * sc && (Math.floor(y * 9) % 2 === 0) ? [0.1, 0.5, 0.46] : c) }))],
    });
  },
  velikaya(g, sv) {
    const sc = sv.sc;
    dress(g, sv, {
      ridge: [560, (a, i) => g.in(M(0, -0.25 * sc, -0.04), () => crossedBeams(g, 0.62 * sc, rgb(0xa83a2a), { head: rgb(0xe6b430) }))],
      corner: [520, (a, i) => pinnacle(g, 0.85 * sc, 'onion', { col: domeSpiral(ONION[i % 4][0], ONION[i % 4][1], 5, 1.4), finial: 'ball', shaft: 0.3, shaftCol: [0.9, 0.88, 0.82], finS: 0.32, r: 0.1, capK: 1.35, sides: 10 })],
      face: [420, (a, i) => { const c1 = [rgb(0x2a5ab0), rgb(0xb8342a), rgb(0x2a8a5a)][(i + a.dir) % 3]; g.in(M(0, -0.22 * sc, 0), () => archFrame(g, 0.36 * sc, 0.6 * sc, 'ogee', c1, { kind: K_WOOD, fill: [1.0, 0.72, 0.3], fillGlow: 0.6, t: 0.04, stripe: rgb(0xeee8d8) })); }],
      door: [300, () => bracketLamp(g, 1.0 * sc, [1.0, 0.62, 0.22])],
    });
  },
  tianlong(g, sv) {
    const sc = sv.sc, red = rgb(0x9a2418), lan = [1.0, 0.16, 0.06];
    dress(g, sv, {
      ridge: [260, () => g.in(M(0, -0.06, -0.1), () => horn(g, [[0, 0, -0.1], [0, 0.04, 0.08], [0, 0.2 * sc, 0.2 * sc], [0, 0.42 * sc, 0.2 * sc], [0, 0.5 * sc, 0.08 * sc]], 0.07 * sc, GOLD, mul(GOLD, 0.6), { metal: 0.6, rings: 12, nu: 6 }))],
      corner: [420, (a, i) => (i % 2 ? null : pinnacle(g, 0.72 * sc, 'sweep', { col: TILE_GREEN[0], finial: 'ball', shaft: 0.42, shaftCol: red, shaftKind: K_WOOD, hk: 0.9, capK: 1.5, sides: 8 }))],
      face: [360, (a, i) => ((i + a.dir) % 2 ? null : g.in(M(0, 0.2 * sc, 0), () => bracketLamp(g, 1.25 * sc, lan, { shape: 'paper', tassel: GOLD, frame: [0.12, 0.08, 0.05], glow: 0.95 })))],
      door: [300, (a) => { onGround(g, a, 0.14, () => columnOn(g, Math.min(1.5, a.wallH || 1.5), 0.07, red, GOLD, { capMetal: 0.8 })); g.in(M(a.e * -0.2, 0.42 * sc, 0), () => bracketLamp(g, 1.1 * sc, lan, { shape: 'paper', tassel: GOLD, frame: [0.12, 0.08, 0.05], glow: 0.95 })); }],
    });
  },
  ironbound(g, sv) {
    const sc = sv.sc, iron = (x, y, z) => mul([0.07, 0.065, 0.065], 0.7 + 0.7 * noise3(x * 12, y * 12, z * 12));
    dress(g, sv, {
      ridge: [900, (a, i) => g.in(M(0, -0.1, -0.08, 8, 0, 0), () => { thorn(g, 0.8 * sc, 0.035 * sc, iron); g.in(M(0, 0.5 * sc, 0.0, 0, 0, 0), () => skull(g, 1.5 * sc, true)); })],
      corner: [330, () => { for (const ry of [-40, 0, 40]) g.in(M(0, -0.1, 0, 34, ry, 0), () => thorn(g, 0.6 * sc, 0.055 * sc, iron)); }],
      eave: [300, () => g.in(M(0, -0.1, 0, 30, 0, 0), () => thorn(g, 0.6 * sc, 0.055 * sc, iron))],
      face: [900, (a, i) => { if ((i + a.dir) % 2) { plate(g, 0.62 * sc, 0.5 * sc, iron, { rivet: [0.25, 0.22, 0.2] }); g.in(M(0.12 * sc, -0.12 * sc, 0), () => plate(g, 0.4 * sc, 0.34 * sc, iron, { rivet: [0.25, 0.22, 0.2] })); } else { chain(g, [[0, 0.5 * sc, 0.05], [0, 0.05 * sc, 0.07]], 0.06 * sc, [0.05, 0.05, 0.05]); g.in(M(0, -0.2 * sc, 0.03, -10, 0, 0), () => skull(g, 1.6 * sc, true)); } }],
      door: [1300, (a) => onGround(g, a, 0.2, () => { skullPile(g, 1.3 * sc, 4, a.e + 2); })],
    });
  },
  screaming(g, sv) {
    const sc = sv.sc, fl = [[[0.7, 1.0, 0.3], [0.9, 0.3, 0.9], [0.3, 0.9, 0.8]], [[1.0, 0.4, 0.9], [0.5, 0.3, 1.0], [0.3, 0.9, 0.5]]];
    const spike = (s, i) => g.in(M(0, 0, 0, (i % 3 - 1) * 14, i * 50, 10), () => crystal(g, 0.09 * s, 0.75 * s, i * 7 + 3, { deep: [rgb(0x5a1a8a), rgb(0x1a7a7a), rgb(0x8a1a5a)][i % 3], bright: [rgb(0xe89aff), rgb(0x9affe8), rgb(0xff9ad8)][i % 3], glow: 1.0 }));
    dress(g, sv, {
      ridge: [500, (a, i) => g.in(M(0, -0.08, -0.1), () => { g.surf(K_PLAIN, 0.4, 0.85); g.lathe([[0.1 * sc, 0], [0.14 * sc, 0.06 * sc], [0.08 * sc, 0.1 * sc]], 8, BRASS); g.in(M(0, 0.06 * sc, 0), () => fire(g, 0.7 * sc, fl[i % 2], i + 1, 1.5)); })],
      corner: [520, (a, i) => g.in(M(0, -0.12, 0), () => { spike(sc, i); g.in(M(0.1 * sc, 0, 0.04, 20, 0, -24), () => spike(0.6 * sc, i + 1)); })],
      eave: [300, (a, i) => g.in(M(0, -0.12, 0, 24, 0, 0), () => spike(0.8 * sc, i))],
      face: [620, (a, i) => ((i + a.dir) % 2 ? g.in(M(0, 0.05, 0.02), () => eyeball(g, 1.5 * sc, [[1.0, 0.85, 0.1], [0.9, 0.2, 0.9], [0.3, 1.0, 0.4]][i % 3])) : g.in(M(0, -0.3 * sc, 0.0, 90, 0, 0), () => g.in(M(0, 0.0, 0.0, 0, 0, 0), () => { for (const [x, r] of [[-0.14, 0.2], [0.1, 0.26], [0.02, 0.15]]) g.in(M(x * sc, 0, -Math.abs(x) * sc - 0.02), () => g.in(M(0, 0, 0, -90, 0, 0), () => mushroom(g, 0.12 * sc, r * sc, [rgb(0x9a3a8a), rgb(0x3a8a7a), rgb(0xb8a03a)][i % 3], i + x * 9, 0.7))); })))],
      door: [900, (a) => onGround(g, a, 0.2, () => fungi(g, 1.3 * sc, [rgb(0x9a3a8a), rgb(0x3a8a7a)][a.e > 0 ? 0 : 1], a.e + 2, 0.7))],
    });
  },
  cloven(g, sv) {
    const sc = sv.sc, blood = [0.16, 0.018, 0.012];
    dress(g, sv, {
      ridge: [700, (a, i) => g.in(M(0, -0.35 * sc, -0.12), () => { for (const e of [-1, 1]) g.in(M(0, 0, 0, 8, 0, e * 24), () => stake(g, 0.03 * sc, 1.1 * sc, i + e, rgb(0x4a3a2a))); g.in(M(0, 0.62 * sc, 0.03), () => skull(g, 1.3 * sc, true)); for (const e of [-1, 1]) g.in(M(e * 0.05 * sc, 0.8 * sc, 0, 0, 0, e * -40), () => horn(g, [[0, 0, 0], [0, 0.2 * sc, 0.04], [0, 0.4 * sc, -0.03]], 0.035 * sc, BONE, BONE_OLD, { nu: 6, nv: 8 })); })],
      corner: [330, () => g.in(M(0, -0.15, 0, 16, 0, 0), () => horn(g, [[0, 0, -0.03], [0, 0.2 * sc, 0.12 * sc], [0, 0.55 * sc, 0.2 * sc], [0, 0.9 * sc, 0.1 * sc]], 0.07 * sc, mul(BONE, 0.9), rgb(0x5a4a3a), { rings: 24 }))],
      face: [650, (a, i) => g.in(M(0, -a.y, 0.14), () => ((i + a.dir) % 2 ? boneRack(g, 0.8 * sc, 1.0 * sc, i + 3) : megalith(g, 0.9 * sc, 0.16 * sc, i * 3 + a.dir, { col: rgb(0x6e6a5e), lean: 0.08, paint: (x, y, z, c, u, v) => (v > 0.45 && v < 0.85 && noise3(x * 9, y * 3, z * 9) > 0.6 ? blood : c) })))],
      door: [600, (a) => onGround(g, a, 0.22, () => megalith(g, 1.5 * sc, 0.2 * sc, a.e * 5 + 7, { col: rgb(0x6e6a5e), lean: a.e * -0.06, paint: (x, y, z, c, u, v) => (v > 0.5 && (noise3(x * 7, y * 2.5, z * 7) > 0.62 || Math.abs(Math.hypot(x, y - 0.9 * sc) - 0.12 * sc) < 0.03) ? blood : c) }))],
    });
  },
  fimbul(g, sv) {
    const sc = sv.sc, paints = [rgb(0x8a2a22), rgb(0x2a4a7a), rgb(0xc8a44a), rgb(0x2e5a3a)];
    dress(g, sv, {
      ridge: [560, () => g.in(M(0, -0.3 * sc, -0.02), () => crossedBeams(g, 0.85 * sc, rgb(0x4e3828), { head: rgb(0x8a6a44) }))],
      corner: [330, () => g.in(M(0, -0.15, 0, 10, 0, 0), () => horn(g, [[0, 0, -0.03], [0, 0.25 * sc, 0.1 * sc], [0, 0.6 * sc, 0.12 * sc], [0, 0.95 * sc, 0.0]], 0.06 * sc, mul(BONE, 1.0), BONE_OLD, { rings: 20, flat: [1, 0.6] }))],
      face: [820, (a, i) => { for (const e of [-1, 1]) g.in(M(e * 0.3 * sc, 0, 0.04, 0, 0, e * 8), () => roundShield(g, 0.24 * sc, rgb(0x6a5236), paints[(i * 2 + (e > 0 ? 1 : 0) + a.dir) % 4], i + e + 3)); }],
      door: [380, (a) => onGround(g, a, 0.14, () => rib(g, [0, 0, 0], [a.e * -0.55 * sc, 1.7 * sc, 0.02], [a.e * 0.22 * sc, 0.25 * sc, 0], 0.06 * sc, a.e + 3))],
    });
  },
  ashur(g, sv) {
    const sc = sv.sc, brass = (x, y, z) => mul([0.62, 0.45, 0.14], 0.75 + 0.45 * noise3(x * 11, y * 11, z * 11)), dark = stoneTint([0.1, 0.08, 0.08], 3);
    dress(g, sv, {
      ridge: [520, () => g.in(M(0, -0.15, -0.25), () => { g.surf(K_STONE, 0.9); g.cyl(0.13 * sc, 0.1 * sc, 0.7 * sc, 8, dark, false, true); g.in(M(0, 0.68 * sc, 0), () => plume(g, 1.0 * sc, [0.05, 0.045, 0.045], 2)); })],
      corner: [200, () => { g.surf(K_STONE, 0.9); prism(g, MERLON.step(0.36 * sc, 0.4 * sc), 0.14, dark, [0, 0.06]); }],
      face: [560, (a, i) => { if ((i + a.dir) % 2) { plate(g, 0.56 * sc, 0.66 * sc, brass, { rivet: [0.8, 0.6, 0.2], metal: 0.85, rough: 0.35 }); g.surf(K_PLAIN, 0.5, 0.3); g.in(M(0, 0, 0.03), () => prism(g, MERLON.step(0.32 * sc, 0.36 * sc).map(([x, y]) => [x, y - 0.18 * sc]), 0.02, [0.06, 0.1, 0.2], [0, 0])); } else { g.surf(K_PLAIN, 0.6, 0, 1.3); g.in(M(0, -0.1 * sc, 0.012), () => g.poly([[-0.16 * sc, -0.2 * sc, 0], [0.16 * sc, -0.2 * sc, 0], [0.16 * sc, 0.1 * sc, 0], [0, 0.22 * sc, 0], [-0.16 * sc, 0.1 * sc, 0]], 0, 0, 1, [1.0, 0.3, 0.04])); g.surf(K_PLAIN, 0.4, 0.85); for (const x of [-0.08, 0, 0.08]) g.in(M(x * sc, -0.05 * sc, 0.02), () => g.cbox(0.025 * sc, 0.44 * sc, 0.025, 0.005, [0.05, 0.045, 0.04])); } }],
      door: [460, (a) => onGround(g, a, 0.18, () => { g.surf(K_STONE, 0.9); g.in(M(0, 0, 0, 0, 45, 0), () => g.lathe([[0.2 * sc, 0], [0.15 * sc, 0.9 * sc], [0.19 * sc, 0.95 * sc], [0.19 * sc, 1.02 * sc]], 4, dark)); g.surf(K_PLAIN, 0.4, 0.85); g.in(M(0, 0.5 * sc, 0, 0, 45, 0), () => g.lathe([[0.19 * sc, 0], [0.18 * sc, 0.09 * sc]], 4, brass)); g.in(M(0, 1.02 * sc, 0), () => finial(g, 'flame', 0.6 * sc, { fin: [0.5, 0.36, 0.12] })); })],
    });
  },
  greenhide(g, sv) {
    const sc = sv.sc, rnd = sv.rnd, red = rgb(0xb8281c), rust = rustCol(3);
    dress(g, sv, {
      ridge: [800, (a, i) => g.in(M(0, -0.3, -0.05, 12 + rnd() * 8, 0, (rnd() - 0.5) * 14), () => { stake(g, 0.045 * sc, 1.4 * sc, i + 5, rgb(0x4e3c28)); g.in(M(0, 1.1 * sc, 0.04), () => skull(g, 1.6 * sc, true)); for (const e of [-1, 1]) g.in(M(e * 0.06 * sc, 1.25 * sc, 0, 0, 0, e * -55), () => horn(g, [[0, 0, 0], [0, 0.2 * sc, 0.05], [0, 0.42 * sc, -0.02]], 0.04 * sc, BONE, BONE_OLD, { nu: 6, nv: 8 })); })],
      corner: [400, (a, i) => g.in(M(0, -0.2, 0, 18 + rnd() * 10, 0, (rnd() - 0.5) * 20), () => horn(g, [[0, 0, -0.04], [0, 0.2 * sc, 0.16 * sc], [0, 0.6 * sc, 0.26 * sc], [0, 1.0 * sc, 0.1 * sc]], 0.085 * sc, mul(BONE, 0.95), rgb(0x6a5a40), { rings: 18 }))],
      face: [760, (a, i) => { g.in(M(0, 0, 0, 0, 0, (rnd() - 0.5) * 14), () => plate(g, 0.7 * sc, 0.5 * sc, rust, { metal: 0.5, rough: 0.8, rivet: [0.12, 0.1, 0.09] })); if ((i + a.dir) % 2) g.in(M(0, -0.06 * sc, 0.03), () => teethGlyph(g, 0.56 * sc, 1.2 * sc, red, 5)); else g.in(M(0.18 * sc, 0.2 * sc, 0.02, 0, 0, -9), () => plate(g, 0.4 * sc, 0.36 * sc, rustCol(9), { metal: 0.5, rough: 0.8, rivet: [0.12, 0.1, 0.09] })); }],
      door: [420, (a) => onGround(g, a, 0.16, () => { for (const [rx, rz, hh] of [[10, a.e * 8, 1.3], [16, a.e * -14, 0.9]]) g.in(M(rz * 0.01, 0, 0, rx, 0, rz), () => stake(g, 0.05 * sc, hh * sc, a.e + rx)); })],
    });
  },
  skar(g, sv) {
    const sc = sv.sc, rnd = sv.rnd, grn = [0.12, 0.95, 0.08], cu = (x, y, z) => mix(mul([0.55, 0.3, 0.14], 0.8 + 0.4 * noise3(x * 9, y * 9, z * 9)), [0.25, 0.5, 0.42], smooth(0.5, 0.75, noise3(x * 4, y * 4 + 3, z * 4)) * 0.7), rags = [rgb(0x7a2a22), rgb(0x8a8a5a), rgb(0x4a6a8a), rgb(0x6a5a40)];
    dress(g, sv, {
      ridge: [560, (a, i) => g.in(M(0, -0.2, -0.2, (rnd() - 0.5) * 16, 0, (rnd() - 0.5) * 16), () => { pipe(g, [[0, 0, 0], [0.02, 0.35 * sc, 0], [0.1 * sc, 0.6 * sc, 0.02], [0.08 * sc, 0.95 * sc, 0]], 0.05 * sc, cu); g.in(M(0.08 * sc, 0.95 * sc, 0), () => plume(g, 0.6 * sc, [0.25, 0.8, 0.2], i, 0.9)); })],
      corner: [420, (a, i) => g.in(M(0, -0.05, 0, (rnd() - 0.5) * 14, 0, (rnd() - 0.5) * 14), () => vessel(g, 1.0 * sc, grn, { metalCol: [0.55, 0.3, 0.14] }))],
      eave: [300, (a, i) => g.in(M(0, -0.25, 0.04, 14, 0, (rnd() - 0.5) * 20), () => stake(g, 0.03 * sc, 0.8 * sc, i + 2, rgb(0x3e3428), rgb(0x3e3428)))],
      face: [560, (a, i) => { const q = (i + a.dir) % 3; if (q === 0) g.in(M(0, -0.1 * sc, 0), () => scaffold(g, 0.9 * sc, Math.min(1.5, a.y + 0.5) * sc, rgb(0x54463a), i + 2)); else if (q === 1) g.in(M(0, 0.3 * sc, 0.02, 0, 0, (rnd() - 0.5) * 12), () => awning(g, 0.8 * sc, 0.4 * sc, rags[i % 4], rags[(i + 1) % 4], { n: 3, scallop: 5 })); else { pipe(g, [[-0.3 * sc, 0.4 * sc, 0.06], [-0.3 * sc, -0.1 * sc, 0.06], [0.1 * sc, -0.2 * sc, 0.06], [0.3 * sc, -0.5 * sc, 0.06]], 0.035 * sc, cu); g.in(M(-0.3 * sc, 0.4 * sc, 0.06), () => vessel(g, 0.7 * sc, grn, { metalCol: [0.55, 0.3, 0.14] })); } }],
      door: [320, () => bracketLamp(g, 1.1 * sc, grn, { shape: 'cage', frame: [0.3, 0.17, 0.08] })],
    });
  },
  crimson(g, sv) {
    const sc = sv.sc, pale = [0.6, 0.8, 1.0], stone = [0.1, 0.1, 0.115];
    dress(g, sv, {
      ridge: [260, () => g.in(M(0, -0.06, -0.08), () => finial(g, 'spike', 0.9 * sc, { fin: [0.2, 0.2, 0.24] }))],
      corner: [520, (a, i) => (i % 2 ? gargoyle(g, 0.9 * sc, stone) : pinnacle(g, 0.85 * sc, 'bell', { col: BLACK_TILE[0], finial: 'spike', shaft: 0.3, hk: 2.2, shaftCol: [0.2, 0.2, 0.22], r: 0.085, finS: 0.4, fin: [0.3, 0.3, 0.34] }))],
      eave: [460, () => g.in(M(0, -0.2, -0.1), () => gargoyle(g, 0.85 * sc, stone))],
      face: [520, (a, i) => { const q = (i + a.dir) % 3; if (q === 0) g.in(M(0, 0.1, 0), () => batMotif(g, 0.8 * sc, [0.05, 0.05, 0.06])); else if (q === 1) g.in(M(0, -0.3 * sc, 0), () => archFrame(g, 0.3 * sc, 0.8 * sc, 'point', [0.25, 0.25, 0.28], { fill: [0.9, 0.05, 0.07], fillGlow: 1.0, t: 0.03 })); else g.in(M(0, 0.25 * sc, 0), () => bracketLamp(g, 1.0 * sc, pale, { shape: 'cage', glow: 0.9 })); }],
      door: [320, () => bracketLamp(g, 1.15 * sc, pale, { shape: 'cage', glow: 0.9 })],
    });
  },
  khemet(g, sv) {
    const sc = sv.sc, sand = stoneTint(rgb(0xe2c488), 3), bands = (x, y, z) => { const b = Math.floor(y * 9 / sc); return y > 0.5 * sc ? [[0.12, 0.25, 0.6], [0.85, 0.8, 0.62], [0.6, 0.16, 0.1], [0.85, 0.8, 0.62], [0.15, 0.45, 0.25]][((b % 5) + 5) % 5] : [0.85, 0.74, 0.5]; };
    dress(g, sv, {
      ridge: [120, () => g.in(M(0, -0.04, -0.12, 0, 45, 0), () => { g.surf(K_PLAIN, 0.3, 0.9); g.lathe([[0.16 * sc, 0], [0, 0.26 * sc]], 4, GOLD); })],
      corner: [160, () => g.in(M(0, -0.02, 0), () => obeliskOn(g, 0.55 * sc, 0.07 * sc, sand, GOLD))],
      face: [360, (a, i) => g.in(M(0, -a.y, 0.11), () => columnOn(g, Math.min((a.wallH || 1.6) - 0.1, 2.0), 0.09 * sc, bands, (x, y, z) => (Math.floor(Math.atan2(z, x) * 2.6 + 9) % 2 ? [0.15, 0.45, 0.25] : [0.85, 0.62, 0.12])))],
      door: [200, (a) => onGround(g, a, 0.24, () => obeliskOn(g, 1.7 * sc, 0.1 * sc, (x, y, z) => (Math.abs(x) < 0.03 && Math.floor(y * 8) % 2 ? [0.4, 0.3, 0.16] : sand(x, y, z)), GOLD))],
    });
  },
  drowned(g, sv) {
    const sc = sv.sc, gh = [0.08, 0.95, 0.4], rusty = rustCol(5), fs = sv.faces;
    dress(g, sv, {
      ridge: [520, (a, i) => g.in(M(0, -0.25, -0.15, i ? -8 : 10, 0, i ? 7 : -9), () => { g.surf(K_WOOD, 0.95); g.cyl(0.04 * sc, 0.028 * sc, 1.3 * sc, 6, [0.16, 0.15, 0.12], false, true); g.in(M(0, 1.05 * sc, 0.03), () => g.beam(0.7 * sc, 0.035, 0.035, 0.008, [0.14, 0.13, 0.1], 2)); g.in(M(0, 1.04 * sc, 0.05), () => rag(g, 0.6 * sc, 0.7 * sc, [0.42, 0.45, 0.38], i * 5 + 1, 0.8)); })],
      corner: [330, (a, i) => g.in(M(0, -0.1, 0), () => { g.surf(K_WOOD, 0.95); g.cyl(0.03 * sc, 0.025 * sc, 0.75 * sc, 5, [0.16, 0.15, 0.12], false, true); g.surf(K_PLAIN, 0.6, 0.6); g.tube([[0, 0.72 * sc, 0], [0, 0.8 * sc, 0.08 * sc], [0, 0.74 * sc, 0.16 * sc]], 0.012, 4, rusty); g.in(M(0, 0.74 * sc, 0.16 * sc), () => lamp(g, 0.95 * sc, gh, { shape: 'cage', frame: [0.25, 0.14, 0.08], glow: 0.95 })); })],
      face: [520, (a, i) => { seaCrust(g, 1.3 * sc, i * 3 + a.dir); if (i % 2 === 0) g.in(M(0.25 * sc, 0.3 * sc, 0), () => bracketLamp(g, 0.95 * sc, gh, { shape: 'cage', frame: [0.25, 0.14, 0.08], glow: 0.95 })); }],
      door: [300, () => bracketLamp(g, 1.1 * sc, gh, { shape: 'cage', frame: [0.25, 0.14, 0.08], glow: 0.95 })],
    });
    fs.forEach((a, i) => { const b = fs[i + 1]; if (b && b.dir === a.dir && Math.hypot(a.x - b.x, a.z - b.z) < 4.2) capped(g, sv, 2400, () => { const d = facing(a), pts = []; for (let q = 0; q <= 8; q++) { const t = q / 8; pts.push([lerp(a.x, b.x, t) + d[0] * 0.07, lerp(a.y, b.y, t) + 0.2 * sc - 0.45 * Math.sin(t * Math.PI), lerp(a.z, b.z, t) + d[1] * 0.07]); } chain(g, pts, 0.07 * sc, mul(RUST, 0.6), 0.5); }); });
  },
  gorge(g, sv) {
    const sc = sv.sc, tusk = (s, e = 1) => horn(g, [[0, -0.2, 0], [e * 0.1 * s, 0.3 * s, 0.1 * s], [e * 0.3 * s, 0.75 * s, 0.22 * s], [e * 0.34 * s, 1.2 * s, 0.14 * s], [e * 0.2 * s, 1.5 * s, -0.04 * s]], 0.1 * s, mul(BONE, 1.05), rgb(0x8a7a5a), { rings: 26, nu: nq(10) });
    dress(g, sv, {
      ridge: [800, (a, i) => g.in(M(0, -0.2, -0.15), () => { for (const e of [-1, 1]) g.in(M(e * 0.08 * sc, 0, 0), () => tusk(0.8 * sc, e)); })],
      corner: [420, (a, i) => g.in(M(0, -0.1, 0), () => tusk(0.6 * sc, i % 2 ? 1 : -1))],
      face: [700, (a, i) => g.in(M(0, -a.y, 0.12), () => { if ((i + a.dir) % 2) { for (let q = 0; q < 5; q++) rib(g, [(q - 2) * 0.17 * sc, 0, 0], [(q - 2) * 0.17 * sc, 0.75 * sc, 0.02], [0, 0.1, 0.12 * sc], 0.028 * sc, q + i); logTo(g, [-0.45 * sc, 0.4 * sc, 0.06], [0.45 * sc, 0.42 * sc, 0.06], 0.02, 0.02, i, { seg: 5, capB: true }); } else boneRack(g, 0.8 * sc, 1.1 * sc, i + 5); })],
      door: [1300, (a) => onGround(g, a, 0.22, () => { megalith(g, 0.5 * sc, 0.22 * sc, a.e + 5, { col: rgb(0x5e5448), flat: [1, 0.9], moss: 0 }); g.in(M(0, 0.46 * sc, 0), () => skullPile(g, 1.1 * sc, 3, a.e + 4)); })],
    });
  },
  westmark(g, sv) {
    const sc = sv.sc, or = rgb(0xe07a1e), wh = rgb(0xeeeae0), bl = rgb(0x2a4a8a);
    dress(g, sv, {
      ridge: [300, (a, i) => g.in(M(0, -0.1, -0.06), () => pennon(g, 0.85 * sc, 0.55 * sc, i ? bl : or, wh, { bars: 3 }))],
      corner: [420, (a, i) => (i % 2 ? g.in(M(0, -0.05, 0), () => pennon(g, 0.8 * sc, 0.5 * sc, or, wh, { bars: 3 })) : pinnacle(g, 0.8 * sc, 'bulb', { col: rgb(0x4a9a80), finial: 'ball', shaft: 0.26, shaftCol: [0.4, 0.14, 0.09], finS: 0.32 }))],
      face: [420, (a, i) => ((i + a.dir) % 2 ? g.in(M(0, 0.05, 0), () => windowPane(g, 0.36 * sc, 0.56 * sc, { col: [0.75, 0.86, 0.95], glow: 0.45, trim: wh, shape: 'screen' })) : g.in(M(0, 0.35 * sc, 0), () => { g.surf(K_WOOD, 0.9); g.beamTo([0, 0, 0], [0, 0.04, 0.36 * sc], 0.06, 0.06, 0.01, woodTint(rgb(0x3a2a20), 2), 1); rope(g, [[0, 0, 0.32 * sc], [0, -0.4 * sc, 0.32 * sc]], 0.01); g.surf(K_PLAIN, 0.5, 0.8); g.in(M(0, -0.44 * sc, 0.32 * sc), () => g.add(new THREE.TorusGeometry(0.04 * sc, 0.012, 4, 8), IRON)); }))],
      door: [300, () => bracketLamp(g, 1.05 * sc, [1.0, 0.75, 0.4])],
    });
  },
  principalities(g, sv) {
    const sc = sv.sc, marble = [0.94, 0.91, 0.84];
    dress(g, sv, {
      ridge: [200, () => g.in(M(0, -0.06, -0.1), () => finial(g, 'ball', 0.6 * sc))],
      corner: [200, () => { g.surf(K_STONE, 0.9); prism(g, MERLON.swallow(0.3 * sc, 0.38 * sc), 0.14, stoneTint(rgb(0xe8cfa0), 2), [0, 0.06]); }],
      face: [330, (a, i) => g.in(M(0, -a.y + 0.04, 0), () => { for (const e of [-1, 1]) g.in(M(e * 0.3 * sc, 0, 0), () => archFrame(g, 0.48 * sc, Math.min(1.15 * sc, a.y + 0.35), 'round', marble, { fill: [0.09, 0.07, 0.06], t: 0.045 })); })],
      door: [300, (a) => onGround(g, a, 0.15, () => columnOn(g, Math.min(1.6, a.wallH || 1.5), 0.075, (x, y, z) => mul(marble, 0.9 + 0.15 * noise3(x * 5, y * 8, z * 5)), marble))],
    });
  },
  sunkings(g, sv) {
    const sc = sv.sc, white = [0.93, 0.92, 0.87], gold = rgb(0xf0c030), black = [0.03, 0.03, 0.035];
    const balcony = (w, s) => { g.surf(K_PLAIN, 0.5, 0.8); for (const y of [0, 0.22 * s]) g.in(M(0, y, 0.16 * s), () => g.cbox(w, 0.02, 0.02, 0.004, black)); for (let i = 0; i <= 6; i++) g.in(M(-w / 2 + (w * i) / 6, 0.11 * s, 0.16 * s), () => g.cbox(0.014, 0.22 * s, 0.014, 0.003, black)); for (const e of [-1, 1]) g.in(M(e * w / 2, 0, 0.08 * s), () => g.cbox(0.02, 0.02, 0.16 * s, 0.004, black)); g.in(M(0, -0.02, 0.08 * s), () => g.cbox(w, 0.03, 0.17 * s, 0.006, white)); g.in(M(0, 0.3 * s, 0.012), () => windowPane(g, 0.24 * s, 0.5 * s, { col: [0.2, 0.16, 0.12], glow: 0.0, shape: 'round', trim: gold, trimKind: K_PLAIN, trimMetal: 0.9 })); };
    dress(g, sv, {
      ridge: [300, (a, i) => (i === 0 ? g.in(M(0, -0.3 * sc, -0.12), () => bellFrame(g, 1.0 * sc, white)) : g.in(M(0, -0.06, -0.1), () => finial(g, 'ball', 0.6 * sc, { fin: gold })))],
      apex: [300, () => g.in(M(0, -0.06, 0), () => finial(g, 'ball', 0.7 * sc, { fin: gold }))],
      corner: [420, () => pinnacle(g, 0.8 * sc, 'hemi', { col: (a2, t) => (Math.floor((a2 / TAU) * 12) % 2 ? [0.12, 0.25, 0.62] : [0.86, 0.84, 0.78]), rough: 0.35, finial: 'ball', shaft: 0.3, shaftCol: white, finS: 0.3, fin: gold })],
      face: [420, (a, i) => g.in(M(0, -0.1 * sc, 0), () => balcony(0.6 * sc, sc))],
      door: [420, (a) => g.in(M(a.e * -0.12, -0.55 * sc, 0), () => { g.surf(K_PLAIN, 0.3, 0.9); g.in(M(0, 0.5 * sc, 0.03), () => g.cbox(0.09 * sc, 1.0 * sc, 0.06, 0.012, gold)); g.in(M(0, 1.06 * sc, 0.03, 0, 0, a.e * 30), () => g.add(new THREE.TorusGeometry(0.09 * sc, 0.03 * sc, 5, 10, 4.2), gold)); g.in(M(0, 1.02 * sc, 0.04), () => g.stud(0.06 * sc, gold, 6)); })],
    });
  },
  caliphate(g, sv) {
    const sc = sv.sc, sand = rgb(0xdfc292);
    dress(g, sv, {
      ridge: [200, () => g.in(M(0, -0.1, -0.06), () => pennon(g, 0.8 * sc, 0.5 * sc, rgb(0x1f8a5a), null))],
      corner: [460, (a, i) => (i % 2 ? null : pinnacle(g, 0.85 * sc, 'point', { col: TURQ[0], finial: 'ball', shaft: 0.55, shaftCol: sand, r: 0.085, capK: 1.25, finS: 0.3 }))],
      face: [420, (a, i) => ((i + a.dir) % 2 ? g.in(M(0, 0.25 * sc, 0.02), () => awning(g, 0.8 * sc, 0.42 * sc, rgb(0xc8402c), rgb(0xeadfc4))) : g.in(M(0, -0.3 * sc, 0), () => archFrame(g, 0.4 * sc, 0.7 * sc, 'horse', rgb(0xeadfc4), { stripe: rgb(0xb8402c), fill: [0.05, 0.12, 0.18], t: 0.04 })))],
      door: [340, (a) => g.in(M(0, -0.5 * sc, 0), () => archFrame(g, 0.5 * sc, 0.95 * sc, 'horse', rgb(0xeadfc4), { stripe: rgb(0xb8402c), fill: [0.1, 0.3, 0.34], fillGlow: 0.3, t: 0.045 }))],
    });
  },
  shogunate(g, sv) {
    const sc = sv.sc, dark = rgb(0x2a2420), red = rgb(0xb42a1c);
    dress(g, sv, {
      ridge: [260, () => g.in(M(0, -0.06, -0.1), () => horn(g, [[0, 0, -0.1], [0, 0.03, 0.06], [0, 0.16 * sc, 0.16 * sc], [0, 0.36 * sc, 0.12 * sc]], 0.065 * sc, rgb(0xc8a44a), rgb(0x5a5e66), { metal: 0.5, rings: 10, nu: 6, flat: [0.5, 1] }))],
      corner: [420, (a, i) => (i % 2 ? null : pinnacle(g, 0.7 * sc, 'sweep', { col: TILE_GREY[0], finial: 'spike', shaft: 0.36, shaftCol: [0.9, 0.88, 0.82], hk: 0.9, capK: 1.5, sides: 8, finS: 0.3, fin: rgb(0xc8a44a) }))],
      face: [300, (a, i) => g.in(M(0, 0.02, 0), () => windowPane(g, 0.46 * sc, 0.42 * sc, { col: [0.96, 0.9, 0.72], glow: 0.55, shape: 'screen', trim: dark, trimKind: K_WOOD }))],
    });
    if (sv.bb.x1 - sv.bb.x0 > 1.8 && !sv.slim) atDoor(g, sv, 700, 0.42, (w) => gateFrame(g, clamp(w * 0.62, 0.8, 1.5), 1.45 * sc, red, { curve: 0.12, cap: [0.08, 0.08, 0.09], foot: [0.3, 0.3, 0.3], r: 0.06 }));
  },
  mistisles(g, sv) {
    const sc = sv.sc, spiral = (x, y, z, c, u, v) => { const yy = v - 0.6, xx = (u - 0.5) * 1.6, d = Math.hypot(xx, yy * 1.4), an = Math.atan2(yy, xx); return u > 0.3 && u < 0.7 && d < 0.3 && tri1(d * 7 - an / TAU) > 0.62 ? mul(c, 1.7) : c; };
    const wicker = (w, h, sd) => { g.surf(K_WOOD, 0.95); g.sheet(nq(12), nq(8), (u, v) => [(u - 0.5) * w, v * h, 0.05 + 0.012 * Math.sin(u * 40 + Math.floor(v * 8) * Math.PI)], (x, y, z, nx, ny, nz, u, v) => mul([0.42, 0.33, 0.18], (Math.floor(u * 13) + Math.floor(v * 8)) % 2 ? 1.05 : 0.6)); for (let i = 0; i <= 4; i++) g.in(M(-w / 2 + (w * i) / 4, 0, 0.05), () => stake(g, 0.018, h * 1.15, sd + i, rgb(0x5e5a4c), rgb(0x5e5a4c))); };
    dress(g, sv, {
      ridge: [300, () => g.in(M(0, -0.12, -0.12, 0, 0, 0), () => { g.surf(K_ROOF, 0.96); g.lathe([[0.11 * sc, 0], [0.13 * sc, 0.1 * sc], [0.05 * sc, 0.2 * sc], [0.07 * sc, 0.26 * sc], [0, 0.36 * sc]], 7, thatchCol(STRAW_OLD, 3)); })],
      corner: [330, (a, i) => g.in(M(0, -0.1, 0), () => megalith(g, 0.5 * sc, 0.09 * sc, i + 3, { moss: 0.7 }))],
      face: [520, (a, i) => g.in(M(0, -a.y, 0.1), () => ((i + a.dir) % 2 ? wicker(0.9 * sc, 0.6 * sc, i) : megalith(g, 1.0 * sc, 0.17 * sc, i * 3 + a.dir + 1, { moss: 0.75, lean: 0.04, paint: spiral })))],
      door: [620, (a) => onGround(g, a, 0.26, () => megalith(g, 1.8 * sc, 0.2 * sc, a.e * 3 + 9, { moss: 0.8, lean: a.e * -0.04, paint: spiral }))],
    });
  },
  thousandgods(g, sv) {
    const sc = sv.sc, mari = rgb(0xf0921e), yel = rgb(0xf0c81e), pens = [rgb(0xd8287a), rgb(0xf0921e), rgb(0x1a9a8a), rgb(0xf0c81e)], sandC = [0.62, 0.36, 0.2];
    dress(g, sv, {
      ridge: [300, (a, i) => g.in(M(0, -0.1, -0.06), () => pennon(g, 0.85 * sc, 0.5 * sc, pens[i % 4], pens[(i + 1) % 4], { bars: 4, hgt: 0.2 * sc }))],
      corner: [420, (a, i) => (i % 2 ? g.in(M(0, -0.05, 0), () => pennon(g, 0.7 * sc, 0.42 * sc, pens[(i + 1) % 4], null, { hgt: 0.18 * sc })) : pinnacle(g, 0.8 * sc, 'bulb', { col: domeBands(rgb(0xc88a5a), rgb(0xa86c42), 6, 0.3), finial: 'bud', shaft: 0.26, shaftCol: sandC, hk: 1.4, finS: 0.32 }))],
      face: [620, (a, i) => { for (let q = -1; q <= 1; q++) g.in(M(q * 0.26 * sc, -0.05, 0), () => nicheFigure(g, 0.95 * sc, [0.78, 0.6, 0.42], { sill: sandC })); g.in(M(0, 0.36 * sc, 0), () => garland(g, 0.95 * sc, 0.16 * sc, mari, yel)); }],
      door: [460, (a) => { g.in(M(0, 0.1 * sc, 0), () => nicheFigure(g, 1.5 * sc, [0.9, 0.86, 0.78], { sill: sandC, back: [0.3, 0.08, 0.1] })); g.in(M(0, 0.6 * sc, 0), () => garland(g, 0.6 * sc, 0.14 * sc, mari, rgb(0xd8287a))); }],
    });
  },
});

// =====================================================================================================
// Goblin: scrap, hide and stolen timber
// =====================================================================================================
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
function scrapHut(g) {
  pad(g, 2, 2, 0.08, rgb(0x5a4a34), 11);
  const hx = 0.72, hz = 0.66;
  g.in(M(0.03, 0, 0.02, -2, 7, 3.5), () => {
    // four walls of whatever planks came to hand
    for (let s = 0; s < 4; s++) {
      const W = s % 2 ? hz : hx, D = s % 2 ? hx : hz;
      g.in(M(0, 0, 0, 0, s * 90, 0).multiply(M(-W, 0, D)), () => {
        plankWall(g, 2 * W, s === 0 ? 1.12 : 1.02 + 0.1 * (s % 2), GOB_WOOD, 20 + s, { tilt: 7, skip: s === 0 ? (x) => Math.abs(x - W + 0.12) < 0.24 : null });
        g.surf(K_WOOD, 0.9);
        for (const y of [0.22, 0.86]) g.in(M(W, y, 0.03, 0, 0, (s - 1.5) * 1.6), () => g.beam(2 * W + 0.1, 0.07, 0.04, 0.01, woodTint(GOB_WOOD[(s + 2) % 6], s * 3 + y), 5));
        if (s === 1) g.in(M(W + 0.1, 0.62, 0.04, 0, 0, -6), () => scrapPlate(g, 0.62, 0.46, 3));
        if (s === 2) { g.in(M(W - 0.25, 0.55, 0.04, 0, 0, 9), () => scrapPlate(g, 0.5, 0.56, 5)); g.in(M(W + 0.38, 0.7, 0.07, 0, 0, 20), () => roundShield(g, 0.26, rgb(0x7a5c38), GOB_PAINT[0], 4)); }
        if (s === 3) { // a round window, lit, barred with two bent nails
          g.in(M(W, 0.68, 0.04), () => { g.surf(K_PLAIN, 0.5, 0, 1.0); g.in(M(0, 0, 0, 90, 0, 0), () => g.cyl(0.16, 0.16, 0.012, nq(16), [1.0, 0.55, 0.12], false, true)); g.surf(K_PLAIN, 0.7, 0.6); g.add(new THREE.TorusGeometry(0.17, 0.035, 6, nq(18)), rustCol(7)); g.in(M(0, 0, 0.02), () => g.cbox(0.3, 0.025, 0.02, 0.005, IRON)); g.in(M(0, 0, 0.02, 0, 0, 80), () => g.cbox(0.3, 0.025, 0.02, 0.005, IRON)); });
        }
      });
    }
    // corner posts, lashed
    for (const [sx, sz, hh] of [[1, 1, 1.5], [1, -1, 1.38], [-1, -1, 1.46], [-1, 1, 1.62]]) g.in(M(sx * (hx + 0.03), 0, sz * (hz + 0.03), sz * -3, 0, sx * 3), () => { stake(g, 0.065, hh, sx * 3 + sz); g.in(M(0, 1.0, 0), () => lashing(g, 0.065, 3)); });
    // the door: three planks and a strap, hanging off one hinge
    g.in(M(-0.12, 0.02, hz + 0.03, 0, -14, -3), () => {
      g.surf(K_WOOD, 0.9);
      for (let i = 0; i < 3; i++) g.in(M(-0.15 + i * 0.15, 0.45 - (i % 2) * 0.03, 0, 0, 0, 90 + (i - 1) * 2), () => g.beam(0.9 - i * 0.05, 0.14, 0.035, 0.008, woodTint(GOB_WOOD[i + 1], i + 40), 4));
      g.in(M(0, 0.62, 0.024, 0, 0, 12), () => g.beam(0.46, 0.07, 0.02, 0.006, woodTint(GOB_WOOD[4], 44), 2));
      g.in(M(0, 0.26, 0.024, 0, 0, -9), () => g.beam(0.46, 0.07, 0.02, 0.006, woodTint(GOB_WOOD[0], 45), 2));
      g.in(M(0.02, 0.86, 0.03, 0, 0, 0, 0.9), () => g.in(M(0, 0, 0, -8, 0, 0), () => skull(g, 0.9, true)));
    });
    // roof: a ridge pole, rafters, and hides thrown over them
    const rY = 1.86, eY = 1.02, eZ = 0.93, x0 = -0.9, x1 = 0.9;
    logTo(g, [x0 - 0.22, rY - 0.02, 0.06], [x1 + 0.3, rY + 0.08, 0.0], 0.06, 0.05, 31, { capB: true });
    for (let i = 0; i < 5; i++) for (const e of [-1, 1]) { const x = lerp(x0 + 0.1, x1 - 0.1, i / 4) + 0.03 * e; logTo(g, [x, rY - 0.1, 0.03], [x + 0.04 * (i - 2), eY - 0.16, e * (eZ + 0.06)], 0.04, 0.032, 50 + i * 2 + e, { capB: true, seg: 8 }); }
    const roof = (e) => (u, v) => {
      const x = lerp(x0, x1, u), sag = Math.sin(u * Math.PI * 4) * 0.02 - 0.09 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI), tat = v < 0.02 ? 0.07 * noise3(u * 9, e, 3) : 0;
      return [x + (u - 0.5) * 0.1 * (1 - v), lerp(eY - tat, rY + 0.045, Math.pow(v, 0.85)) + sag + 0.04 * (u - 0.5), e * lerp(eZ, -0.02, v)];
    };
    hideSheet(g, 34, 20, roof(1), rgb(0xa8843e), 61, false);
    hideSheet(g, 34, 20, roof(-1), rgb(0x9a7a3a), 62, true);
    g.surf(K_PLAIN, 1);
    g.flat([[x0 + 0.05, eY + 0.02, -hz], [x1 - 0.05, eY + 0.02, -hz], [x1 - 0.05, eY + 0.02, hz], [x0 + 0.05, eY + 0.02, hz]], [0.03, 0.025, 0.02]);
    for (const e of [-1, 1]) g.flat([[e * (hx + 0.01), eY - 0.02, -hz], [e * (hx + 0.01), eY - 0.02, hz], [e * (hx + 0.01), rY - 0.06, 0]], mul(GOB_WOOD[2], 0.6));
    // stitched patches, a scrap plate and stones holding the hides down
    for (const [u, v, e, c] of [[0.3, 0.45, 1, 0], [0.72, 0.6, 1, 2], [0.5, 0.4, -1, 1]]) { const f = roof(e), p = f(u, v), q = f(u + 0.14, v), r = f(u, v + 0.2); g.surf(K_CLOTH, 0.95); g.sheet(6, 6, (a, b) => [p[0] + (q[0] - p[0]) * (a - 0.5) * 1.7 + (r[0] - p[0]) * (b - 0.5) * 2, p[1] + (q[1] - p[1]) * (a - 0.5) * 1.7 + (r[1] - p[1]) * (b - 0.5) * 2 + 0.022, p[2] + (r[2] - p[2]) * (b - 0.5) * 2 + e * 0.012], (x, y, z, nx, ny, nz, a, b) => (Math.min(a, 1 - a, b, 1 - b) < 0.1 ? [0.05, 0.04, 0.03] : mul(GOB_PAINT[c], 0.55 + 0.3 * noise3(x * 12, y * 12, z * 12))), false, e < 0); }
    for (const [u, v, e] of [[0.12, 0.2, 1], [0.86, 0.3, 1], [0.6, 0.15, -1], [0.2, 0.3, -1]]) { const p = roof(e)(u, v); g.in(M(p[0], p[1] - 0.01, p[2]), () => boulder(g, 0.09, 0.06, 0.08, u * 50, rgb(0x77736a), nq(16))); }
    // stovepipe: three lengths that nearly line up, a rain cap
    const pipe = [[0.42, 1.2, -0.3], [0.44, 1.62, -0.32], [0.52, 1.95, -0.3], [0.5, 2.3, -0.36]];
    g.surf(K_PLAIN, 0.75, 0.6);
    g.tube(pipe, 0.075, nq(12), rustCol(9), false);
    for (const p of pipe.slice(1)) g.in(M(p[0], p[1], p[2], 90, 0, 0), () => g.add(new THREE.TorusGeometry(0.08, 0.016, 6, nq(14)), mul(RUST, 0.5)));
    g.in(M(0.5, 2.3, -0.36, -6, 0, 4), () => { for (let i = 0; i < 3; i++) g.in(M(Math.cos(i * 2.1) * 0.06, 0, Math.sin(i * 2.1) * 0.06), () => g.cbox(0.012, 0.1, 0.012, 0.002, IRON)); g.in(M(0, 0.05, 0), () => g.lathe([[0.15, 0], [0.1, 0.04], [0, 0.09]], nq(12), rustCol(4))); });
    g.surf(K_PLAIN, 1);
    g.in(M(0.5, 2.27, -0.36), () => g.cyl(0.07, 0.07, 0.001, 10, [0.01, 0.01, 0.01], false, true));
    // spikes along the ridge ends, a banner
    for (const [x, rz2] of [[x0 - 0.12, 24], [x1 + 0.2, -30]]) g.in(M(x, rY - 0.1, 0.03, 0, 0, rz2), () => stake(g, 0.04, 0.55, x * 7));
    g.in(M(x0 + 0.2, rY - 0.2, -0.1, -6, 0, 10), () => { stake(g, 0.03, 1.0, 71, rgb(0x4d4230)); g.in(M(0, 0.9, 0.03), () => rag(g, 0.3, 0.5, GOB_PAINT[0], 5, 0.5, GOB_PAINT[1])); });
  });
  // junk outside: a cask, a heap of sacks' worth of scrap, bones
  g.in(M(0.74, 0.03, 0.8), () => barrel(g, 0.15, 0.36, rgb(0x6b4a2e), 3));
  g.in(M(-0.78, 0.05, 0.82, 0, 30, 0), () => { g.in(M(0, 0.02, 0, 80, 0, 0), () => scrapPlate(g, 0.34, 0.26, 8)); bone(g, [-0.1, 0.08, 0.1], [0.14, 0.05, 0.16], 0.022, 2); g.in(M(0.05, 0.02, -0.08), () => boulder(g, 0.1, 0.07, 0.09, 6, rgb(0x6f6a60), nq(16))); });
  g.in(M(0.86, 0, -0.84, 0, 0, -6), () => { stake(g, 0.035, 1.25, 81); g.in(M(0, 1.2, 0, 0, 200, 0), () => skull(g, 1.0, true)); });
}
function warDrum(g) {
  pad(g, 2, 2, 0.07, rgb(0x5a4a34), 13);
  const dk = 0.66, wood = rgb(0x6b5236);
  // platform: six posts, bearers and a deck of split logs
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8], [0, -0.84], [0, 0.84]]) g.in(M(x, 0, z, z * 3, 0, -x * 4), () => { log(g, 0.085, 0.075, dk + 0.12, x * 5 + z, { seg: nq(12) }); g.in(M(0, dk - 0.14, 0), () => lashing(g, 0.085, 3, 0.013)); });
  for (const z of [-0.8, 0.8]) logTo(g, [-0.98, dk - 0.14, z], [0.98, dk - 0.14, z], 0.065, 0.06, z * 9, { capB: true });
  for (let i = 0; i < 11; i++) { const x = -0.86 + i * 0.172; logTo(g, [x, dk - 0.03, -0.96 + 0.04 * hash1(i, 3)], [x + 0.02 * (hash1(i, 5) - 0.5), dk - 0.03, 0.96 - 0.05 * hash1(i, 4)], 0.082, 0.078, 100 + i, { capB: true, seg: nq(10), bark: mul(GOB_WOOD[i % 6], 0.9) }); }
  // the drum: a great tub leaning toward the drummer
  const R = 0.66, Hd = 0.78;
  g.in(M(0.08, dk + 0.05, -0.12, 16, 0, 0), () => {
    const prof = (v) => R * (0.86 + 0.14 * Math.sin(Math.PI * (0.12 + v * 0.8)));
    g.surf(K_WOOD, 0.85);
    const ns = 22;
    g.sheet(nq(ns * 2), nq(8), (u, v) => { const a = u * TAU, rr = prof(v); return [Math.cos(a) * rr, v * Hd, Math.sin(a) * rr]; }, (x, y, z, nx, ny, nz, u) => { const i = Math.round(u * ns * 2); return i % 2 ? mul(GOB_WOOD[(i >> 1) % 6], 0.75 + 0.35 * hash1(i, 9)) : mul(wood, 0.3); }, true, true);
    g.surf(K_PLAIN, 0.6, 0.7);
    for (const v of [0.1, 0.5]) g.lathe([[prof(v - 0.04) + 0.006, (v - 0.04) * Hd], [prof(v) + 0.014, v * Hd], [prof(v + 0.04) + 0.006, (v + 0.04) * Hd]], nq(28), rustCol(v * 10));
    // the head: hide pulled over the rim, painted with a red hand, laced down to a hoop
    g.surf(K_CLOTH, 0.9);
    g.sheet(nq(36), nq(10), (u, v) => { const a = u * TAU, t = v * 1.18, rr = t < 1 ? t * (prof(1) + 0.02) : prof(1) + 0.03, y = t < 1 ? Hd + 0.03 - 0.035 * t * t * t : Hd + 0.03 - 0.035 - (t - 1) * 0.75; return [Math.cos(a) * rr, y, Math.sin(a) * rr]; },
      (x, y, z) => { const d = Math.hypot(x, z) / R, a = Math.atan2(z, x), palm = Math.hypot(x, (z + 0.06) * 1.2) < 0.17, fing = d > 0.2 && d < 0.5 && z < 0.08 && Math.abs(Math.sin(a * 4.2 + 0.4)) > 0.7 && a < 0, ring = Math.abs(d - 0.8) < 0.04;
        return palm || fing || ring ? mul(GOB_PAINT[0], 0.75 + 0.3 * noise3(x * 20, 1, z * 20)) : mul(rgb(0xc8a868), (0.8 + 0.3 * noise3(x * 6, 2, z * 6)) * (1 - 0.3 * smooth(0.25, 0, d))); }, true);
    g.in(M(0, Hd - 0.11, 0), () => { const pts = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * TAU; pts.push([Math.cos(a) * (prof(0.86) + 0.035), 0, Math.sin(a) * (prof(0.86) + 0.035)]); } rope(g, pts, 0.022, rgb(0xb89c68), 6); });
    g.in(M(0, Hd * 0.28, 0), () => { const pts = []; for (let i = 0; i <= 24; i++) { const a = (i / 24) * TAU; pts.push([Math.cos(a) * (prof(0.28) + 0.03), 0, Math.sin(a) * (prof(0.28) + 0.03)]); } rope(g, pts, 0.022, rgb(0xa88c58), 6); });
    for (let i = 0; i < 18; i++) { const a0 = (i / 18) * TAU, a1 = ((i + 0.5) / 18) * TAU, a2 = ((i + 1) / 18) * TAU, r1 = prof(0.86) + 0.04, r0 = prof(0.28) + 0.035; rope(g, [[Math.cos(a0) * r1, Hd - 0.11, Math.sin(a0) * r1], [Math.cos(a1) * r0, Hd * 0.28, Math.sin(a1) * r0], [Math.cos(a2) * r1, Hd - 0.11, Math.sin(a2) * r1]], 0.012, rgb(0xb89c68), 5); }
    // two thigh bones for sticks
    bone(g, [-0.3, Hd + 0.07, 0.25], [0.2, Hd + 0.06, 0.42], 0.03, 5);
    bone(g, [0.34, Hd + 0.07, -0.1], [0.1, Hd + 0.2, 0.52], 0.03, 6);
  });
  // chocks under the drum
  for (const e of [-1, 1]) g.in(M(e * 0.5 + 0.08, dk + 0.05, 0.42, 0, e * 20, 0), () => { g.surf(K_WOOD, 0.9); g.cbox(0.22, 0.14, 0.34, 0.03, woodTint(GOB_WOOD[2], e)); });
  // the war horn on its forked rest
  g.in(M(-0.72, dk + 0.02, 0.7, 0, 35, 0), () => {
    for (const e of [-1, 1]) g.in(M(0, 0, e * 0.1, e * 14, 0, 0), () => stake(g, 0.04, 0.62, e + 20));
    g.in(M(0, 0.45, 0), () => lashing(g, 0.06, 3));
    horn(g, [[-0.5, 1.02, 0], [-0.22, 0.62, 0], [0.06, 0.5, 0], [0.4, 0.62, 0], [0.62, 0.92, 0]].reverse(), 0.17, rgb(0xd8c8a0), rgb(0x4a3a28), { rings: 30, nu: nq(14), nv: nq(24), pow: 0.7 });
    g.surf(K_PLAIN, 0.5, 0.85);
    for (const [x, y, r, t] of [[0.56, 0.84, 0.17, 35], [0.2, 0.53, 0.115, 78], [-0.3, 0.72, 0.065, -35]]) g.in(M(x, y, 0, 0, 0, t), () => g.add(new THREE.TorusGeometry(r, 0.02, 6, nq(16)).rotateX(Math.PI / 2), BRASS));
  });
  // totems of ownership: spikes round the edge, shields on the sides, two banners behind
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU + 0.3, x = Math.cos(a) * 0.86, z = Math.sin(a) * 0.86; if (z > 0.55 && Math.abs(x) < 0.5) continue; g.in(M(x, 0, z, 0, -a / DEG + 90, 0), () => g.in(M(0, 0, 0, 24, 0, 0), () => stake(g, 0.04, 0.72 + 0.2 * hash1(i, 2), i + 30))); }
  g.in(M(0.99, 0.36, 0.1, 0, 90, 8), () => roundShield(g, 0.28, rgb(0x7a5c38), GOB_PAINT[1], 2));
  g.in(M(-0.99, 0.36, -0.2, 0, -90, -12), () => roundShield(g, 0.26, rgb(0x6b5236), GOB_PAINT[2], 5));
  g.in(M(0.3, 0.33, 0.97, 0, 0, 5), () => scrapPlate(g, 0.5, 0.36, 12));
  for (const [x, rz2, c, hh] of [[-0.62, 5, 0, 2.2], [0.74, -6, 1, 1.95]]) g.in(M(x, 0, -0.86, -5, 0, rz2), () => {
    stake(g, 0.045, hh, x * 11, rgb(0x4d4230));
    g.surf(K_WOOD, 0.9); g.in(M(0, hh - 0.25, 0.04), () => g.beam(0.62, 0.05, 0.05, 0.01, woodTint(wood, 5), 2));
    g.in(M(0, hh - 0.27, 0.07), () => rag(g, 0.52, 0.95, GOB_PAINT[c], c * 9 + 3, 0.45, GOB_PAINT[(c + 1) % 3]));
    g.in(M(0, hh - 0.06, 0, 0, 0, 0), () => skull(g, 1.0, true));
  });
}
function brewery(g) {
  pad(g, 3, 3, 0.09, rgb(0x4e4630), 17);
  // the mushroom the whole works grows round
  g.in(M(-0.2, 0, -0.3, 0, 0, 4), () => mushroom(g, 1.75, 1.05, rgb(0x8a2f3a), 3, 0.5));
  for (const [x, z, h2, r, c, sd] of [[-1.2, -1.05, 0.5, 0.26, 0x8a5a2a, 1], [-1.25, 0.2, 0.34, 0.2, 0x9a3a4a, 2], [0.95, -1.15, 0.62, 0.3, 0x7a6a2a, 4], [1.25, -0.5, 0.3, 0.17, 0x8a2f3a, 5], [-0.75, -1.25, 0.26, 0.14, 0x9a3a4a, 6], [0.45, -1.3, 0.22, 0.12, 0x8a5a2a, 7]]) g.in(M(x, 0, z, 0, sd * 50, 0), () => mushroom(g, h2, r, rgb(c), sd, sd % 2 ? 0.5 : 0));
  // three open vats on a staging of planks, their brew glowing and bubbling
  const brew = [[0.35, 1.0, 0.2], [0.55, 1.0, 0.12], [0.2, 0.75, 0.1]];
  const vat = (r, h2, seed) => {
    barrel(g, r, h2, GOB_WOOD[seed % 6], seed);
    g.in(M(0, h2 - 0.022, 0), () => { pool(g, r * 0.84, brew, seed, 1.2, [0.03, 0.12, 0.02]); g.surf(K_PLAIN, 0.3, 0, 1.3); const rnd = rng(seed * 9); for (let i = 0; i < 9; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.7; g.in(M(Math.cos(a) * d, 0, Math.sin(a) * d), () => g.add(new THREE.SphereGeometry(0.02 + 0.035 * rnd(), nq(8), nq(5), 0, TAU, 0, 1.5), brew[i % 2])); } });
  };
  g.surf(K_WOOD, 0.9);
  for (let i = 0; i < 9; i++) g.in(M(0.25, 0.14, 0.42 + i * 0.118, 0, (hash1(i, 7) - 0.5) * 5, 0), () => g.beam(2.3 - 0.2 * hash1(i, 3), 0.045, 0.11, 0.01, woodTint(GOB_WOOD[i % 6], i), 5));
  for (const x of [-0.75, 0.25, 1.25]) logTo(g, [x, 0.07, 0.34], [x, 0.07, 1.42], 0.06, 0.055, x * 7 + 3, { capB: true });
  g.in(M(-0.42, 0.165, 0.86), () => vat(0.36, 0.62, 2));
  g.in(M(0.42, 0.165, 0.98), () => vat(0.33, 0.5, 3));
  g.in(M(1.08, 0.165, 0.7), () => vat(0.27, 0.7, 5));
  // the still: a copper pot on a firebox of field stones, a swan neck, a worm coiling down into a cask
  g.in(M(0.98, 0, -0.38), () => {
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; if (Math.abs(a - 1.57) < 0.5) continue; g.in(M(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3, 0, -a / DEG, 0), () => boulder(g, 0.13, 0.13, 0.1, i + 60, rgb(0x6f6a60), nq(18))); }
    g.in(M(0, 0.03, 0), () => pool(g, 0.24, FIRE_HOT, 4, 1.3));
    g.in(M(0, 0.04, 0.16), () => fire(g, 0.26, FIRE_HOT, 2, 1.3));
    g.surf(K_PLAIN, 0.32, 0.9);
    const cu = (x, y, z) => mix(mul(rgb(0xb86a3c), 0.7 + 0.5 * noise3(x * 9, y * 9, z * 9)), rgb(0x4f9a84), smooth(0.62, 0.8, noise3(x * 4 + 3, y * 4, z * 4)) * 0.7);
    g.lathe([[0.2, 0.2], [0.34, 0.28], [0.4, 0.46], [0.36, 0.66], [0.22, 0.82], [0.12, 0.9], [0.1, 1.02], [0.13, 1.1], [0.07, 1.2], [0.05, 1.3]], nq(24), cu);
    g.in(M(0, 0.46, 0), () => g.add(new THREE.TorusGeometry(0.405, 0.016, 6, nq(24)).rotateX(Math.PI / 2), mul(BRASS, 0.8)));
    for (let i = 0; i < 12; i++) g.in(M(Math.cos(i * 0.5236) * 0.4, 0.46, Math.sin(i * 0.5236) * 0.4, 0, -i * 30 + 90, 0), () => g.stud(0.018, BRASS, 6));
    g.tube([[0, 1.28, 0], [0, 1.44, 0], [-0.1, 1.54, 0.06], [-0.32, 1.5, 0.2], [-0.5, 1.3, 0.3]], [0.05, 0.045, 0.04, 0.035, 0.03], nq(10), cu, false);
    const worm = []; for (let i = 0; i <= 44; i++) { const t = i / 44, a = t * TAU * 3.5; worm.push([-0.56 + Math.cos(a) * 0.13, 1.3 - t * 0.72, 0.34 + Math.sin(a) * 0.13]); }
    g.tube(worm, 0.026, nq(8), cu, false);
  });
  g.in(M(0.42, 0.02, -0.04), () => barrel(g, 0.2, 0.52, GOB_WOOD[1], 8));
  // a pipe tapping the cap, dripping into the first vat; a crooked ladder; jugs; a lantern on a pole
  g.surf(K_PLAIN, 0.7, 0.6);
  g.tube([[-0.5, 1.62, 0.2], [-0.56, 1.5, 0.62], [-0.5, 1.2, 0.84], [-0.44, 0.95, 0.86]], 0.04, nq(10), rustCol(3), false);
  g.surf(K_PLAIN, 0.3, 0, 1.2);
  g.tube([[-0.44, 0.95, 0.86], [-0.43, 0.85, 0.86], [-0.43, 0.8, 0.86]], [0.018, 0.012, 0.004], 6, brew[0], false);
  g.in(M(-1.1, 0, 0.9, 0, 20, 0), () => { for (const e of [-1, 1]) g.in(M(e * 0.16, 0, 0, -22, 0, e * 2), () => stake(g, 0.03, 1.25, e + 50, rgb(0x5a4630), rgb(0x5a4630))); g.surf(K_WOOD, 0.9); for (let i = 0; i < 5; i++) g.in(M(0, 0.2 + i * 0.2, 0.09 + i * 0.083, 0, 0, (hash1(i, 1) - 0.5) * 12), () => g.beam(0.42, 0.035, 0.035, 0.008, woodTint(GOB_WOOD[i], i), 2)); });
  for (const [x, z, s] of [[-0.05, 1.3, 1], [0.12, 1.36, 0.7], [1.34, 0.2, 0.9], [-1.3, -0.4, 1.1]]) g.in(M(x, z > 1 ? 0.19 : 0.03, z, 0, x * 90, 0, s), () => { g.surf(K_PLAIN, 0.75); g.lathe([[0.06, 0], [0.1, 0.05], [0.11, 0.13], [0.06, 0.21], [0.04, 0.26], [0.055, 0.29], [0.04, 0.29]], nq(12), (px, py, pz) => mul(rgb(0x6a5a3a), 0.7 + 0.5 * noise3(px * 30, py * 30, pz * 30))); g.surf(K_PLAIN, 0.7); g.in(M(0.07, 0.2, 0), () => g.add(new THREE.TorusGeometry(0.045, 0.012, 5, 10), rgb(0x5a4a30))); });
  g.in(M(1.3, 0, 1.28, 3, 0, -5), () => { stake(g, 0.04, 1.6, 77, rgb(0x4d4230)); g.surf(K_PLAIN, 0.6, 0.8); g.tube([[0, 1.5, 0], [-0.1, 1.58, 0], [-0.22, 1.52, 0]], 0.012, 5, IRON); g.in(M(-0.22, 1.34, 0), () => { g.lathe([[0.06, 0.14], [0.02, 0.19]], 6, IRON); g.lathe([[0.05, 0], [0.06, 0.02]], 6, IRON); g.surf(K_PLAIN, 1, 0, 1.5); g.lathe([[0.05, 0.02], [0.05, 0.14]], 6, brew[1]); }); });
  g.in(M(-1.3, 0, 1.3, 0, 40, 0), () => { g.surf(K_WOOD, 0.9); g.in(M(0, 0.55, 0, 0, 0, 6), () => g.cbox(0.5, 0.34, 0.03, 0.008, woodTint(GOB_WOOD[1], 3))); stake(g, 0.035, 0.75, 91); g.surf(K_PLAIN, 0.3, 0, 0.9); g.in(M(0, 0.56, 0.02, 0, 0, 6), () => sigil(g, 5, 0.3, brew[0], 0.9, 0.07)); });
}

// =====================================================================================================
// Undead: soot-black stone, bone, grave light
// =====================================================================================================
const TOMB = 0x3d3d47, TOMB_SLATE = [rgb(0x24222c), rgb(0x2e2a36), rgb(0x1c1b22), rgb(0x333340), rgb(0x2a3038)];
const ROT_WOOD = [rgb(0x5a6452), rgb(0x4c5648), rgb(0x687058), rgb(0x5e5848)];
const tombStone = (seed, o) => stoneStyle(TOMB, { seed, chip: 0.3, ...o });
/** an iron lantern with a grave light in it, hanging below the local origin */
function ghostLamp(g, s = 1) {
  g.surf(K_PLAIN, 0.55, 0.85);
  g.in(M(0, -0.36 * s, 0), () => {
    g.lathe([[0.085 * s, 0.26 * s], [0.035 * s, 0.32 * s], [0.012 * s, 0.36 * s]], 6, IRON);
    g.lathe([[0.07 * s, 0], [0.085 * s, 0.018 * s], [0.085 * s, 0.035 * s]], 6, IRON);
    for (let q = 0; q < 6; q++) g.in(M(Math.cos(q * 1.047) * 0.078 * s, 0.148 * s, Math.sin(q * 1.047) * 0.078 * s), () => g.cbox(0.014 * s, 0.24 * s, 0.014 * s, 0.003, IRON));
    g.surf(K_PLAIN, 1, 0, 1.8);
    g.lathe([[0.066 * s, 0.035 * s], [0.066 * s, 0.26 * s]], 6, (x, y) => (y > 0.16 * s ? [0.12, 0.8, 0.1] : GHOST));
  });
}
/** a candle with a grave flame standing on the local origin */
function ghostCandle(g, h, seed = 0) {
  g.surf(K_PLAIN, 0.6);
  g.lathe([[0.034, 0], [0.026, 0.008], [0.02, 0.016], [0.019, h], [0.005, h + 0.005]], nq(8), mul(rgb(0xd8d0b0), 0.8 + 0.2 * hash1(seed, 3)));
  g.surf(K_PLAIN, 1, 0, 1.9);
  g.in(M(0, h + 0.005, 0), () => g.lathe([[0.004, 0], [0.016, 0.016], [0.012, 0.036], [0, 0.07]], 6, (x, y) => (y > 0.04 ? [0.1, 0.75, 0.1] : [0.5, 1.0, 0.3])));
}
/** a headstone standing on the local origin, facing +Z */
function graveSlab(g, w, h, seed) {
  const c = stoneTint(mul(rgb(TOMB), 1.15), seed, 4);
  g.surf(K_STONE, 0.95);
  g.in(M(0, h * 0.4 - 0.06, 0), () => g.cbox(w, h * 0.8 + 0.12, 0.09, 0.016, c));
  g.in(M(0, h * 0.8, 0, 90, 0, 0), () => g.in(M(0, -0.045, 0), () => g.cyl(w / 2, w / 2, 0.09, nq(14), c, true, true)));
  g.surf(K_PLAIN, 0.4, 0, 0.7);
  g.in(M(0, h * 0.62, 0.047), () => sigil(g, seed, w * 0.62, [0.14, 0.6, 0.1], 0.7, 0.07));
}
function crypt(g) {
  const st = tombStone(4100), col = st.pal[0], cc = stoneTint(mul(col, 1.08), 3, 4), r = st.r;
  // the mound it is sunk into: earth heaped up the sides and over the back
  pad(g, 3, 3, 0.1, (x, y, z) => mix(mul(rgb(0x3a3428), 0.7 + 0.5 * fbm3(x * 3, y * 5, z * 3, 3)), [0.08, 0.13, 0.04], 0.5 * smooth(0.45, 0.7, noise3(x * 2.2, 3, z * 2.2))), 21, {
    top: (x, z) => 0.85 * smooth(1.0, -0.6, z) * smooth(0.5, 1.15, Math.max(Math.abs(x), -z * 0.9)) * smooth(1.5, 1.2, Math.abs(x)) * smooth(-1.5, -1.2, z) + 0.05 });
  const hx = 0.92, hz = 0.98, wy = 1.22, dw = 0.36, dh = 0.95;
  g.in(M(0, 0, -0.1), () => {
    stoneBox(g, hx, hz, 0, wy, st, 4110, { quoin: [0.5, 0.28], holes: [[[hx - r - dw, 0, hx - r + dw, dh]], null, null, null], each: (s) => {
      if (s) return;
      g.in(M(hx - r, 0, r), () => {
        // the doorway: a deep black throat with grave light welling up in it, behind an iron gate
        g.surf(K_PLAIN, 1);
        const zb = -0.42, bl = [0.004, 0.006, 0.004];
        for (const e of [-1, 1]) g.flat([[e * dw, 0, 0], [e * dw, dh, 0], [e * dw, dh, zb], [e * dw, 0, zb]], [mul(col, 0.5), mul(col, 0.5), bl, bl]);
        g.flat([[-dw, dh, 0], [dw, dh, 0], [dw, dh, zb], [-dw, dh, zb]], [mul(col, 0.4), mul(col, 0.4), bl, bl]);
        g.surf(K_PLAIN, 1, 0, 1.0);
        g.flat([[-dw, 0, zb], [dw, 0, zb], [dw, dh, zb], [-dw, dh, zb]], [[0.1, 0.5, 0.06], [0.1, 0.5, 0.06], bl, bl]);
        g.flat([[-dw, 0.004, 0], [dw, 0.004, 0], [dw, 0.004, zb], [-dw, 0.004, zb]], [[0.02, 0.1, 0.02], [0.02, 0.1, 0.02], [0.14, 0.6, 0.08], [0.14, 0.6, 0.08]]);
        g.surf(K_PLAIN, 0.6, 0.85);
        for (let i = 0; i < 7; i++) { const x = -dw + 0.045 + (i * (2 * dw - 0.09)) / 6, top = dh - 0.1 + 0.06 * Math.cos((x / dw) * 1.4); g.in(M(x, 0, -0.06), () => { g.cyl(0.016, 0.016, top, 6, IRON); g.in(M(0, top, 0), () => g.lathe([[0.016, 0], [0.03, 0.03], [0, 0.1]], 6, IRON)); }); }
        for (const y of [0.16, 0.56, 0.78]) g.in(M(0, y, -0.06), () => g.cbox(2 * dw - 0.03, 0.03, 0.022, 0.006, IRON));
        g.in(M(0.1, 0.5, -0.04), () => g.add(new THREE.TorusGeometry(0.045, 0.012, 5, 12), IRON));
        // lintel, and a skull for a keystone
        g.surf(K_STONE, 0.93);
        g.in(M(0, dh + 0.09, 0.03), () => g.cbox(2 * dw + 0.34, 0.18, 0.16, 0.02, cc));
        g.in(M(0, dh + 0.02, 0.1, -6, 0, 0), () => skull(g, 1.5));
      });
    } });
    // roof: three great slabs stepping in, cracked across; an urn with a grave flame
    g.surf(K_STONE, 0.94);
    for (const [y, a, b, h2, sd] of [[wy, hx + 0.12, hz + 0.12, 0.16, 1], [wy + 0.16, hx - 0.12, hz - 0.14, 0.15, 2], [wy + 0.31, hx - 0.42, hz - 0.46, 0.14, 3]]) {
      for (const e of [-1, 1]) g.in(M(e * a * 0.5 + 0.004 * e, y + h2 / 2, 0, 0, 0, e * (sd === 1 ? 0.8 : 0)), () => g.cbox(a - 0.008, h2, 2 * b, 0.022, stoneTint(mul(col, 1.0 + 0.06 * e), sd * 3 + e, 3)));
    }
    g.in(M(0, wy + 0.45, 0), () => {
      g.lathe([[0.1, 0], [0.16, 0.03], [0.16, 0.07], [0.07, 0.11], [0.06, 0.16], [0.17, 0.26], [0.2, 0.38], [0.15, 0.48], [0.11, 0.5], [0.13, 0.54], [0.1, 0.54], [0, 0.5]], nq(16), cc);
      g.in(M(0, 0.5, 0), () => fire(g, 0.34, FIRE_GHOST, 3, 1.5));
    });
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) g.in(M(sx * (hx - 0.02), wy + 0.16, sz * (hz - 0.02)), () => { g.surf(K_STONE, 0.93); g.lathe([[0.07, 0], [0.11, 0.02], [0.11, 0.05], [0.05, 0.08], [0.045, 0.12], [0.11, 0.2], [0.13, 0.3], [0.09, 0.38], [0.04, 0.42], [0, 0.46]], nq(14), cc); });
    // pediment over the door
    g.in(M(0, wy, hz + 0.04), () => { g.surf(K_STONE, 0.93); for (const e of [-1, 1]) g.beamTo([e * (hx + 0.1), 0.03, 0.02], [0, 0.42, 0.02], 0.09, 0.16, 0.016, cc, 3); g.flat([[-hx, 0, 0], [hx, 0, 0], [0, 0.4, 0]], mul(col, 0.7)); g.surf(K_PLAIN, 0.4, 0, 0.9); g.in(M(0, 0.16, 0.012), () => sigil(g, 7, 0.26, [0.14, 0.7, 0.1], 0.9, 0.07)); });
    // two lamp pillars flanking the door
    for (const e of [-1, 1]) g.in(M(e * (hx - 0.08), 0, hz + 0.26), () => {
      g.surf(K_STONE, 0.93);
      g.lathe([[0.17, -0.1], [0.17, 0.08], [0.13, 0.12], [0.11, 0.2], [0.1, 0.95], [0.13, 1.02], [0.16, 1.05], [0.16, 1.1], [0, 1.1]], nq(12), cc);
      g.surf(K_PLAIN, 0.55, 0.85);
      g.tube([[0, 1.1, 0], [0, 1.42, 0], [-e * 0.1, 1.52, 0.02], [-e * 0.2, 1.46, 0.02]], 0.014, 5, IRON);
      g.in(M(-e * 0.2, 1.46, 0.02), () => ghostLamp(g, 1.1));
    });
  });
  // steps down to the door, worn; leaning headstones, bones, candles
  g.surf(K_STONE, 0.95);
  for (let i = 0; i < 3; i++) g.in(M(0, 0.02 + i * 0.012, 1.34 - i * 0.2), () => g.cbox(0.95 - i * 0.07, 0.1, 0.24, 0.02, stoneTint(mul(col, 0.9 + 0.08 * i), i + 9, 4)));
  for (const [x, z, w2, h2, ry, rz2, sd] of [[-1.2, 1.15, 0.3, 0.55, 14, 7, 1], [1.22, 1.22, 0.26, 0.48, -20, -9, 2], [-1.3, 0.55, 0.24, 0.4, 60, 4, 3], [1.3, 0.3, 0.3, 0.6, -70, 6, 5]]) g.in(M(x, 0, z, -5, ry, rz2), () => graveSlab(g, w2, h2, sd));
  bone(g, [-0.75, 0.07, 1.25], [-0.5, 0.06, 1.34], 0.022, 3); bone(g, [0.62, 0.06, 1.3], [0.85, 0.07, 1.16], 0.02, 4);
  g.in(M(-0.66, 0.05, 1.12, 0, 40, 12), () => skull(g, 1.0, true));
  for (const [x, z, h2] of [[-0.55, 1.2, 0.1], [0.56, 1.24, 0.14], [0.66, 1.34, 0.07], [-0.44, 1.36, 0.06], [0.36, 0.95, 0.09], [-0.36, 0.98, 0.12]]) g.in(M(x, 0.06, z), () => ghostCandle(g, h2, x * 20));
  for (const [x, z, sd] of [[-1.26, -0.2, 1], [1.3, -0.5, 2]]) g.in(M(x, 0.0, z, 0, sd * 60, 0), () => { for (let i = 0; i < 4; i++) g.in(M((i % 2) * 0.17 - 0.08, 0.05 + (i > 2 ? 0.13 : 0), (i >> 1) * 0.15 - 0.07, (i % 3) * 9, sd * 90 + i * 70, 0), () => skull(g, 1.0, true)); });
  g.moss = 1.4;
}
function boneSpire(g) {
  pad(g, 2, 2, 0.1, (x, y, z) => mul(rgb(0x2e2a26), 0.6 + 0.7 * fbm3(x * 4, y * 5, z * 4, 3)), 23);
  // the core: bone run together like wax, dark in its hollows
  const axis = [[0, -0.05, 0], [0.06, 1.2, 0.02], [-0.05, 2.5, 0.04], [0.03, 3.8, -0.02], [0, 4.75, 0]], rad = [0.6, 0.42, 0.3, 0.19, 0.06];
  const rAt = (y) => { const t = clamp(y / 4.75, 0, 1) * 4, i = Math.min(3, Math.floor(t)); return lerp(rad[i], rad[i + 1], t - i); };
  const xAt = (y) => { const t = clamp(y / 4.75, 0, 1) * 4, i = Math.min(3, Math.floor(t)); return [lerp(axis[i][0], axis[i + 1][0], t - i), lerp(axis[i][2], axis[i + 1][2], t - i)]; };
  g.surf(K_PLAIN, 0.75);
  limb(g, axis, rad, { nu: nq(30), nv: nq(64), amp: 0.3, nf: 2.4, seed: 5, col: (x, y, z) => { const n = fbm3(x * 5, y * 2.2, z * 5, 3); return mix(mul(BONE_OLD, 0.25), mul(BONE, 0.95), smooth(0.3, 0.62, n)); } });
  // long bones climbing it in a spiral
  for (let i = 0; i < 26; i++) {
    const y0 = 0.15 + i * 0.155, a0 = i * 2.1, len = 0.66 - i * 0.01, y1 = y0 + len * 0.86, a1 = a0 + 0.55, c0 = xAt(y0), c1 = xAt(y1), r0 = rAt(y0) * 0.96 + 0.03, r1 = rAt(y1) * 0.96 + 0.03;
    bone(g, [c0[0] + Math.cos(a0) * r0, y0, c0[1] + Math.sin(a0) * r0], [c1[0] + Math.cos(a1) * r1, y1, c1[1] + Math.sin(a1) * r1], 0.034 - i * 0.0004, i);
  }
  // tiers of ribs opening like cages, a ring of skulls under each
  [[0.7, 9, 0.62, 0.95], [1.9, 8, 0.5, 0.8], [3.0, 7, 0.4, 0.62], [3.85, 6, 0.28, 0.46]].forEach(([y, n2, out, up], t) => {
    const c = xAt(y), r = rAt(y);
    for (let i = 0; i < n2; i++) { const a = (i / n2) * TAU + t * 0.4, co = Math.cos(a), si = Math.sin(a); rib(g, [c[0] + co * r * 0.8, y, c[1] + si * r * 0.8], [c[0] + co * (r + out * 0.5), y + up, c[1] + si * (r + out * 0.5)], [co * out * 0.62, -up * 0.12, si * out * 0.62], 0.04 - t * 0.005, i + t * 10); }
    if (t < 3) for (let i = 0; i < n2 - 2; i++) { const a = ((i + 0.5) / (n2 - 2)) * TAU + t, co = Math.cos(a), si = Math.sin(a), rr = rAt(y - 0.28) * 0.9; g.in(M(c[0] + co * rr, y - 0.4, c[1] + si * rr, -6, 90 - a / DEG, 0), () => skull(g, 1.25 - t * 0.12, true)); }
  });
  // the crown: finger bones closed round a grave light
  g.in(M(0, 4.55, 0), () => {
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU, co = Math.cos(a), si = Math.sin(a); horn(g, [[co * 0.07, -0.1, si * 0.07], [co * 0.3, 0.14, si * 0.3], [co * 0.3, 0.42, si * 0.3], [co * 0.1, 0.66, si * 0.1]], 0.045, mul(BONE, 1.05), BONE_OLD, { rings: 24 }); }
    g.surf(K_PLAIN, 0.4, 0, 1.8);
    g.in(M(0, 0.32, 0), () => g.add(new THREE.SphereGeometry(0.17, nq(18), nq(12)), (x, y, z) => mix(GHOST, [0.7, 1.0, 0.5], smooth(0.5, 0.8, noise3(x * 9, y * 9, z * 9)))));
  });
  // grave lights caught in the hollows, and the heap the spire grew out of
  g.surf(K_PLAIN, 0.4, 0, 1.6);
  for (let i = 0; i < 9; i++) { const y = 0.5 + i * 0.43, a = i * 2.4 + 1, c = xAt(y), r = rAt(y) * 0.86; g.in(M(c[0] + Math.cos(a) * r, y, c[1] + Math.sin(a) * r), () => g.add(new THREE.SphereGeometry(0.05, 8, 6), GHOST)); }
  const rnd = rng(77);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + rnd() * 0.3, d = 0.62 + rnd() * 0.24; g.in(M(Math.cos(a) * d, 0.04 + rnd() * 0.06, Math.sin(a) * d, (rnd() - 0.5) * 50, rnd() * 360, (rnd() - 0.5) * 40), () => skull(g, 0.95 + rnd() * 0.3, true)); }
  for (let i = 0; i < 12; i++) { const a = rnd() * TAU, d = 0.55 + rnd() * 0.36, b = a + 1.2 + rnd(); bone(g, [Math.cos(a) * d, 0.06 + rnd() * 0.05, Math.sin(a) * d], [Math.cos(a) * d + Math.cos(b) * 0.3, 0.1 + rnd() * 0.12, Math.sin(a) * d + Math.sin(b) * 0.3], 0.022, i + 40); }
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) horn(g, [[sx * 0.9, -0.1, sz * 0.9], [sx * 0.86, 0.5, sz * 0.86], [sx * 0.7, 1.0, sz * 0.7], [sx * 0.48, 1.3, sz * 0.48]], 0.1, mul(BONE, 1.05), BONE_OLD, { rings: 30, nu: nq(12) });
}
/** a coffin lying on the local origin, head toward +X: L long, W across the shoulders; lid = how far the lid has slid */
function coffin(g, L, W, H, seed, lid = 0, glow = false) {
  const out = [[-L / 2, -W * 0.3], [L * 0.2, -W / 2], [L / 2, -W * 0.3], [L / 2, W * 0.3], [L * 0.2, W / 2], [-L / 2, W * 0.3]], wood = ROT_WOOD[seed % 4], tb = (i) => woodTint(mul(wood, 0.8 + 0.4 * hash1(seed, i)), seed + i);
  g.surf(K_WOOD, 0.9);
  for (let i = 0; i < 6; i++) { const a = out[i], b = out[(i + 1) % 6]; for (let k = 0; k < 2; k++) g.beamTo([a[0], H * (0.25 + 0.5 * k), a[1]], [b[0], H * (0.25 + 0.5 * k), b[1]], H / 2 - 0.004, 0.03, 0.008, tb(i * 2 + k), 3); }
  g.surf(K_PLAIN, 1, 0, glow ? 1.1 : 0);
  g.poly(out.map((p) => [p[0] * 0.94, H * 0.5, p[1] * 0.9]), 0, 1, 0, glow ? [0.1, 0.55, 0.07] : [0.012, 0.012, 0.012]);
  g.in(M(lid * L * 0.3, H, lid * W * 0.55, 0, lid * 14, lid * 4), () => {
    g.surf(K_WOOD, 0.9);
    for (let i = 0; i < 3; i++) { const z0 = -W / 2 + (W * (i + 0.5)) / 3, edge = i !== 1; g.in(M(edge ? L * 0.02 : 0, 0.016, z0 * (edge ? 0.86 : 1)), () => g.beam(L * (edge ? 0.86 : 1.0), 0.032, W / 3 - 0.006, 0.008, tb(20 + i), 4)); }
    g.surf(K_PLAIN, 0.6, 0.85);
    for (const x of [-L * 0.3, L * 0.22]) { g.in(M(x, 0.036, 0), () => g.cbox(0.06, 0.014, W * 0.92, 0.004, IRON)); for (const e of [-1, 0, 1]) g.in(M(x, 0.043, e * W * 0.3, -90, 0, 0), () => g.stud(0.012, IRON, 5)); }
  });
  g.surf(K_PLAIN, 0.6, 0.85);
  for (const e of [-1, 1]) for (const x of [-L * 0.2, L * 0.28]) g.in(M(x, H * 0.55, e * (W * 0.42 + 0.02), 0, 0, 0), () => g.add(new THREE.TorusGeometry(0.04, 0.009, 5, 10), IRON));
}
function charnel(g) {
  const st = tombStone(4300, { course: 0.15 }), col = st.pal[0], cc = stoneTint(mul(col, 1.08), 5, 4);
  // a low platform of dark stone, flagged
  stoneBox(g, 1.44, 1.44, 0, 0.3, st, 4310);
  const pv = stoneStyle(TOMB, { seed: 4320, r: 0.008, b: 0.012, rough: 0.003, bump: 0.3, flat: true, chip: 0.2, course: 0.36, len: [0.3, 0.6], cell: 0.15 / qual() });
  g.surf(K_STONE, 0.95);
  g.in(M(-1.44, 0.3 - pv.r, 1.44, -90, 0, 0), () => g.ashlar(2.88, 2.88, { ...pv, ends: [CUT, CUT, CUT, CUT] }));
  // six piers and a ring of rotten beams
  const py0 = 0.3, py1 = 1.62;
  for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2], [0, -1.2], [-1.2, 0], [1.2, 0]]) g.in(M(x, 0, z), () => { stoneBox(g, 0.17, 0.17, py0, py1 - 0.1, st, 4330 + x * 7 + z * 3, { noFoot: true }); g.surf(K_STONE, 0.93); g.in(M(0, py1 - 0.05, 0), () => g.cbox(0.44, 0.1, 0.44, 0.02, cc)); g.in(M(0, py0 + 0.04, 0), () => g.cbox(0.42, 0.08, 0.42, 0.02, cc)); });
  g.surf(K_WOOD, 0.9);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => g.in(M(0, py1 + 0.07, 1.2), () => g.beam(2.75, 0.14, 0.16, 0.02, woodTint(ROT_WOOD[s], s + 3), 8, (x) => [0.02 * Math.sin(x * 2.3 + s), 0])));
  hipRoof(g, 1.5, 1.5, py1 + 0.12, 2.62, 0.3, TOMB_SLATE, 4340, { th: 0.14, tw: 0.16, ridgeCol: mul(LEAD, 0.5) });
  g.in(M(0, 2.6, 0), () => { g.surf(K_PLAIN, 0.6, 0.85); g.cyl(0.02, 0.012, 0.5, 6, IRON); g.in(M(0, 0.42, 0, 10, 0, 0), () => skull(g, 1.5)); });
  // coffins stacked three deep, the top one forced open from inside
  g.in(M(0.1, 0.3, -0.25), () => {
    for (let i = 0; i < 3; i++) g.in(M(0, 0.01, -0.5 + i * 0.5, 0, (i - 1) * 3, 0), () => coffin(g, 1.7, 0.46, 0.3, i));
    for (let i = 0; i < 2; i++) g.in(M(-0.06 + i * 0.5 - 0.25, 0.36, 0, 0, 90 + (i ? 5 : -4), 0), () => coffin(g, 1.5, 0.44, 0.28, i + 3));
    g.in(M(0.02, 0.7, 0.02, 0, 12, 0), () => { coffin(g, 1.6, 0.46, 0.3, 6, 1, true); g.in(M(0.5, 0.2, 0.05, -20, 80, 0), () => skull(g, 1.2)); rib(g, [0.2, 0.2, 0.12], [0.26, 0.5, 0.3], [0, 0.1, 0.14], 0.022, 3); });
  });
  g.in(M(-1.0, 0.3, 0.72, -12, 14, 0), () => g.in(M(0, 0.9, 0, 0, 0, 90), () => coffin(g, 1.7, 0.46, 0.28, 8)));
  // the bone heap, candles round it
  g.in(M(0.72, 0.3, 0.82), () => {
    g.surf(K_PLAIN, 0.8);
    g.sheet(nq(30), nq(10), (u, v) => { const a = u * TAU, d = v * 0.55, n = noise3(Math.cos(a) * 3, d * 6, Math.sin(a) * 3); return [Math.cos(a) * d * 1.1, 0.42 * Math.pow(1 - v * v, 0.9) * (0.75 + 0.5 * n), Math.sin(a) * d]; }, (x, y, z) => mix(mul(BONE_OLD, 0.2), BONE, smooth(0.35, 0.6, noise3(x * 16, y * 16, z * 16))), true);
    const rnd = rng(431);
    for (let i = 0; i < 9; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.42, y = 0.4 * (1 - (d / 0.55) ** 2); g.in(M(Math.cos(a) * d * 1.1, y - 0.02, Math.sin(a) * d, (rnd() - 0.5) * 60, rnd() * 360, (rnd() - 0.5) * 60), () => skull(g, 1.0 + rnd() * 0.25, true)); }
    for (let i = 0; i < 12; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * 0.5, y = 0.4 * (1 - (d / 0.55) ** 2) + 0.03, b = rnd() * TAU; bone(g, [Math.cos(a) * d, y, Math.sin(a) * d], [Math.cos(a) * d + Math.cos(b) * 0.28, y + (rnd() - 0.3) * 0.16, Math.sin(a) * d + Math.sin(b) * 0.28], 0.022, i + 9); }
  });
  for (const [x, z, h2] of [[0.1, 1.3, 0.12], [0.24, 1.36, 0.08], [1.36, 0.36, 0.1], [-0.4, 1.34, 0.14], [-0.3, 1.26, 0.07], [1.34, -0.5, 0.11], [-1.34, -0.6, 0.09], [0.6, -1.36, 0.1]]) g.in(M(x, 0.3, z), () => ghostCandle(g, h2, x * 30));
  // shrouds hung between the piers, lamps at the front
  for (const [x, z, ry, w2, sd] of [[-0.6, -1.2, 180, 0.9, 1], [0.6, -1.2, 180, 0.8, 2], [1.2, -0.6, 90, 0.85, 3], [-1.2, -0.6, 270, 0.8, 4]]) g.in(M(x, py1, z, 0, ry, 0), () => rag(g, w2, 0.95, rgb(0x4a4850), sd, 0.7));
  for (const e of [-1, 1]) g.in(M(e * 1.2, py1 - 0.1, 1.4), () => { g.surf(K_PLAIN, 0.55, 0.85); g.tube([[0, 0.02, -0.04], [0, 0.08, 0.1], [0, 0.02, 0.16]], 0.014, 5, IRON); g.in(M(0, 0.02, 0.16), () => ghostLamp(g, 1.2)); });
  g.shade(-1.3, 0.3, -1.3, 1.3, 1.7, 1.3, 0.18, 0.3, [1, -1]);
}

// =====================================================================================================
// Infernal: obsidian, brimstone, brass and fire
// =====================================================================================================
const OBSIDIAN = rgb(0x1e181c), BRIMSTONE = rgb(0x4a1814), HORN_TIP = [0.5, 0.05, 0.02], HORN_ROOT = [0.02, 0.016, 0.016];
const hellStone = (seed, o) => stoneStyle(0x2c2022, { seed, chip: 0.3, pal: [OBSIDIAN, OBSIDIAN, mul(OBSIDIAN, 1.4), BRIMSTONE, mul(BRIMSTONE, 0.7), mul(OBSIDIAN, 0.7), rgb(0x5e1d16), rgb(0x2a2024)], mortar: [0.02, 0.008, 0.006], ...o });
/** rock shot through with seams of fire: sets the glow of each vertex as it colours it (follow with g.surf) */
const magma = (g, col, seed = 0, thr = 0.022, glow = 1.4) => { const rc = rockCol(col, seed, 0, 4); return (x, y, z, nx, ny) => { const v = Math.abs(noise3(x * 1.9 + seed, y * 1.9, z * 1.9 + seed * 0.7) - 0.5), e = smooth(thr, thr * 0.25, v) * smooth(0.3, 0.6, noise3(x * 0.7 + 3, y * 0.7, z * 0.7 + seed)); g.glow = glow * e; const c = rc(x, y, z, nx, ny); return e > 0.02 ? mix(c, [1.0, 0.28, 0.03], e) : c; }; };
/** a great horn rising from the local origin and curling toward +Z, s tall */
const hellHorn = (g, s, curl = 1) => horn(g, [[0, -0.2 * s, -0.05], [0, 0.2 * s, 0.2 * s * curl], [0, 0.58 * s, 0.36 * s * curl], [0, 0.95 * s, 0.28 * s * curl], [0, 1.2 * s, 0.06 * s * curl]], 0.12 * s, HORN_TIP, HORN_ROOT, { rings: 38, nu: nq(12), nv: nq(22) });
function forge(g) {
  g.moss = 0;
  pad(g, 3, 3, 0.07, (x, y, z) => mul(mix(rgb(0x1e1a1a), rgb(0x3a2a26), fbm3(x * 4, 1, z * 4, 3)), 0.7 + 0.5 * noise3(x * 13, y * 9, z * 13)), 31);
  const st = hellStone(5100), col = st.pal[0], cc = stoneTint(mul(OBSIDIAN, 1.5), 3, 4), r = st.r;
  const hx = 1.0, hz = 0.86, wy = 1.5, mw = 0.42, mh = 0.9;
  g.in(M(-0.3, 0, -0.42), () => {
    stoneBox(g, hx, hz, 0, wy, st, 5110, { quoin: [0.52, 0.3], holes: [[[hx - r - mw, 0.2, hx - r + mw, 0.2 + mh]], null, null, null], each: (s) => {
      if (s !== 0) { if (s === 3) g.in(M(hz - r, 0.9, r + 0.01), () => sigil(g, 3, 0.55, EMBER, 1.5, 0.06)); return; }
      g.in(M(hx - r, 0.2, r), () => {
        // the furnace mouth: a throat of fire
        const zb = -0.5;
        g.surf(K_PLAIN, 1, 0, 1.3);
        for (const e of [-1, 1]) g.flat([[e * mw, 0, 0], [e * mw, mh, 0], [e * mw, mh, zb], [e * mw, 0, zb]], [[0.3, 0.04, 0.01], [0.12, 0.012, 0.004], [1.0, 0.3, 0.03], [1.0, 0.4, 0.05]]);
        g.flat([[-mw, mh, 0], [mw, mh, 0], [mw, mh, zb], [-mw, mh, zb]], [[0.1, 0.01, 0.004], [0.1, 0.01, 0.004], [0.9, 0.2, 0.02], [0.9, 0.2, 0.02]]);
        g.flat([[-mw, 0, zb], [mw, 0, zb], [mw, mh, zb], [-mw, mh, zb]], [[1.0, 0.5, 0.08], [1.0, 0.5, 0.08], [1.0, 0.22, 0.02], [1.0, 0.22, 0.02]]);
        g.in(M(0, 0.02, -0.22), () => { g.in(M(0, 0, 0, 0, 0, 0, 1), () => pool(g, 0.4, FIRE_HOT, 3, 1.5)); for (const x of [-0.2, 0.04, 0.24]) g.in(M(x, 0, 0.02 + 0.1 * Math.abs(x)), () => fire(g, 0.5 - Math.abs(x) * 0.6, FIRE_HOT, x * 9, 1.5)); });
        // brass-bound arch of obsidian blocks, a fanged keystone
        g.surf(K_STONE, 0.6);
        for (const e of [-1, 1]) g.in(M(e * (mw + 0.09), mh / 2 - 0.1, 0.05), () => g.cbox(0.18, mh + 0.2, 0.2, 0.02, cc));
        g.in(M(0, mh + 0.1, 0.05), () => g.cbox(2 * mw + 0.42, 0.2, 0.22, 0.02, cc));
        g.surf(K_PLAIN, 0.4, 0.9);
        for (const e of [-1, 1]) for (const y of [0.1, 0.5]) g.in(M(e * (mw + 0.09), y, 0.156), () => { g.cbox(0.2, 0.06, 0.016, 0.005, BRASS); for (const q of [-1, 1]) g.in(M(q * 0.06, 0, 0.008), () => g.stud(0.016, BRASS, 6)); });
        for (const e of [-1, 0, 1]) g.in(M(e * 0.2, mh + 0.02, 0.1, 150 - Math.abs(e) * 10, 0, 0), () => horn(g, [[0, 0, 0], [0, 0.12, 0.02], [0, 0.26 - Math.abs(e) * 0.06, 0]], 0.05, mul(BONE, 0.9), [0.2, 0.15, 0.1]));
      });
    } });
    // a heavy cornice, a horn at each corner
    g.surf(K_STONE, 0.7);
    g.in(M(0, wy + 0.09, 0), () => g.cbox(2 * hx + 0.22, 0.18, 2 * hz + 0.22, 0.03, stoneTint(mul(OBSIDIAN, 1.3), 5, 3)));
    g.in(M(0, wy + 0.23, 0), () => g.cbox(2 * hx - 0.1, 0.12, 2 * hz - 0.1, 0.03, stoneTint(mul(BRIMSTONE, 0.9), 6, 3)));
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) g.in(M(sx * (hx + 0.02), wy + 0.12, sz * (hz + 0.02), 0, Math.atan2(sx, sz) / DEG, 0), () => hellHorn(g, 0.8));
    // the great chimney: square, tapering, banded in brass, a crown of fire
    g.in(M(0.3, 0, -0.2), () => {
      g.surf(K_STONE, 0.75);
      limb(g, [[0, wy + 0.1, 0], [0, 2.2, 0], [0.02, 2.9, 0], [0, 3.5, 0]], [0.5, 0.42, 0.36, 0.34], { nu: nq(40), nv: nq(40), sq: 0.8, amp: 0.05, nf: 3, seed: 3, col: magma(g, mul(OBSIDIAN, 1.3), 5, 0.03) });
      g.surf(K_PLAIN, 0.4, 0.9);
      for (const [y, rr] of [[1.95, 0.46], [2.7, 0.385], [3.42, 0.36]]) limb(g, [[0, y - 0.05, 0], [0, y + 0.05, 0]], [rr, rr * 0.99], { nu: nq(32), nv: 2, sq: 0.8, col: (x, y2, z) => mul(BRASS, 0.6 + 0.5 * noise3(x * 9, y2 * 9, z * 9)), capA: true, capB: true });
      for (let i = 0; i < 4; i++) g.in(M(0, 3.44, 0, 0, i * 90 + 45, 0), () => g.in(M(0, 0, 0.3), () => hellHorn(g, 0.42, 0.8)));
      g.in(M(0, 3.5, 0), () => { pool(g, 0.3, FIRE_HOT, 7, 1.6); fire(g, 0.7, FIRE_HOT, 5, 1.5); });
      g.surf(K_PLAIN, 1, 0, 1.5);
      const rnd = rng(51); for (let i = 0; i < 14; i++) g.in(M((rnd() - 0.5) * 0.5, 3.9 + rnd() * 0.9, (rnd() - 0.5) * 0.5), () => g.add(new THREE.OctahedronGeometry(0.02 + 0.02 * rnd(), 0), [1.0, 0.4, 0.05]));
    });
  });
  // the pour: a channel of molten metal running from the mouth to a quenching basin
  g.in(M(-0.3, 0, 0.44), () => {
    g.surf(K_STONE, 0.8);
    for (const e of [-1, 1]) g.in(M(e * 0.15, 0.13, 0.2), () => g.cbox(0.09, 0.2, 0.42, 0.02, cc));
    g.surf(K_PLAIN, 0.6, 0, 1.5);
    g.sheet(4, nq(14), (u, v) => [(u - 0.5) * 0.2, 0.2 - v * 0.05 + 0.006 * Math.sin(v * 30), v * 0.46], (x, y, z) => mix([1.0, 0.5, 0.08], [1.0, 0.2, 0.02], noise3(x * 20, 1, z * 9)));
    g.in(M(0, 0, 0.7), () => { g.surf(K_STONE, 0.8); g.lathe([[0.34, -0.06], [0.36, 0.12], [0.33, 0.24], [0.27, 0.26], [0.24, 0.2], [0.24, 0.1]], nq(24), cc); g.in(M(0, 0.17, 0), () => pool(g, 0.25, FIRE_HOT, 9, 1.4)); });
  });
  // anvil on a stump, hammer and tongs
  g.in(M(0.92, 0, 0.88, 0, -25, 0), () => {
    log(g, 0.2, 0.18, 0.36, 5, { seg: nq(14), bark: rgb(0x2a201a), heart: rgb(0x6a5440) });
    g.surf(K_PLAIN, 0.4, 0.85);
    g.sculpt({ prims: [S.box(0.3, 0.08, 0.16, 0.012).at(0, 0.4, 0).color(0x2a2a2e), S.box(0.14, 0.12, 0.1, 0.02).at(0, 0.49, 0).color(0x2a2a2e).blend(0.03), S.box(0.4, 0.1, 0.17, 0.012).at(0.02, 0.6, 0).color(0x34343a).blend(0.02), S.cone(0.075, 0.01, 0.26, 0.004).rot(0, 0, -90).at(0.33, 0.6, 0).color(0x34343a).blend(0.02)] }, 90, 0.7);
    g.surf(K_PLAIN, 0.5, 0.85);
    g.in(M(-0.02, 0.68, 0.02, 0, 30, 90), () => g.cbox(0.07, 0.36, 0.03, 0.01, woodTint(rgb(0x3a2a1e), 2)));
    g.in(M(0.15, 0.69, -0.07, 0, 30, 0), () => g.cbox(0.16, 0.08, 0.08, 0.012, [0.07, 0.07, 0.08]));
    g.surf(K_PLAIN, 0.5, 0.2, 1.3);
    g.in(M(-0.05, 0.665, -0.03, 0, -40, 0), () => g.cbox(0.3, 0.03, 0.05, 0.008, [1.0, 0.36, 0.04]));
  });
  // bellows worked by a chain, coal, a rack of ingots still hot
  g.in(M(1.02, 0, -0.5, 0, -90, 0), () => {
    g.surf(K_WOOD, 0.85);
    for (const [y, rz2] of [[0.32, 0], [0.62, 16]]) g.in(M(0, y, 0, 0, 0, rz2), () => g.in(M(0.3, 0, 0), () => g.cbox(0.72, 0.04, 0.5, 0.012, woodTint(rgb(0x2a1e16), y * 9))));
    g.surf(K_CLOTH, 0.9);
    g.sheet(nq(20), 6, (u, v) => { const a = u * TAU, sx = 0.3 + Math.cos(a) * 0.34, sz = Math.sin(a) * 0.24, open = sx / 0.64 * 0.3, pleat = 0.02 * Math.sin(v * Math.PI * 5); return [sx + pleat * Math.cos(a), 0.34 + v * open, sz + pleat * Math.sin(a)]; }, (x, y, z, nx, ny, nz, u, v) => mul(rgb(0x4a2a1e), 0.6 + 0.5 * Math.abs(Math.sin(v * Math.PI * 5))), true, true);
    g.surf(K_PLAIN, 0.4, 0.9);
    g.in(M(-0.1, 0.33, 0, 0, 0, 90), () => g.cyl(0.035, 0.05, 0.4, nq(10), BRASS, true, true));
    for (const z of [-0.2, 0.2]) g.in(M(0.3, 0, z), () => g.cbox(0.6, 0.6, 0.05, 0.012, woodTint(rgb(0x241a14), z * 9)));
  });
  for (const [x, z, s] of [[1.18, 0.2, 1], [0.98, 0.34, 0.7], [1.26, 0.42, 0.6]]) g.in(M(x, 0.02, z), () => { g.surf(K_STONE, 0.9); g.sheet(nq(20), nq(8), (u, v) => { const a = u * TAU, d = v * 0.24 * s; return [Math.cos(a) * d, 0.2 * s * (1 - v * v) * (0.7 + 0.6 * noise3(Math.cos(a) * 4 + x, d * 9, Math.sin(a) * 4)), Math.sin(a) * d]; }, (px, py, pz) => { const e = smooth(0.7, 0.85, noise3(px * 14, py * 14, pz * 14)); g.glow = e * 1.3; return mix([0.02, 0.02, 0.022], [1.0, 0.3, 0.03], e); }, true); g.glow = 0; });
  g.in(M(-1.22, 0, 0.9, 0, 20, 0), () => {
    g.surf(K_PLAIN, 0.6, 0.85);
    for (const e of [-1, 1]) { g.in(M(e * 0.22, 0, 0), () => g.cbox(0.04, 0.5, 0.3, 0.008, IRON)); }
    for (const y of [0.16, 0.36]) { g.surf(K_PLAIN, 0.6, 0.85); g.in(M(0, y, 0), () => g.cbox(0.46, 0.02, 0.3, 0.006, IRON)); for (let i = 0; i < 3; i++) { const hot = (i + (y > 0.2 ? 1 : 0)) % 2; g.surf(K_PLAIN, 0.4, hot ? 0.2 : 0.9, hot ? 1.2 : 0); g.in(M(-0.13 + i * 0.13, y + 0.04, 0), () => g.cbox(0.09, 0.05, 0.24, 0.012, hot ? [1.0, 0.34, 0.04] : mul(BRASS, 0.8))); } }
  });
  // chains from the cornice, a brazier by the door side
  chain(g, [[-1.28, wy + 0.04, 0.44], [-1.34, 1.0, 0.5], [-1.3, 0.62, 0.52]], 0.07, [0.05, 0.045, 0.04]);
  chain(g, [[0.66, wy + 0.04, 0.46], [0.5, 1.12, 0.56], [0.2, 1.2, 0.5], [0.12, wy + 0.04, 0.46]], 0.06, [0.05, 0.045, 0.04]);
  g.in(M(-1.16, 0, -1.1), () => brazier(g, 0.62, FIRE_HOT, [0.05, 0.04, 0.035], 3));
}
function obelisk(g) {
  g.moss = 0;
  const ob = (x, y, z) => mul(OBSIDIAN, 0.8 + 0.6 * noise3(x * 5, y * 5, z * 5));
  // three steps of obsidian studded with brass
  g.surf(K_STONE, 0.5, 0.2);
  for (const [w2, y, h2] of [[0.94, 0.07, 0.22], [0.76, 0.24, 0.14], [0.6, 0.37, 0.12]]) g.in(M(0, y, 0), () => g.cbox(w2, h2, w2, 0.03, ob));
  g.surf(K_PLAIN, 0.4, 0.9);
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => { for (let i = 0; i < 5; i++) g.in(M(-0.36 + i * 0.18, 0.1, 0.47), () => g.stud(0.024, BRASS, 7)); });
  // the shaft: glass-black, veined with fire
  g.surf(K_STONE, 0.3, 0.25);
  const vein = magma(g, mul(OBSIDIAN, 1.2), 8, 0.02, 1.5);
  limb(g, [[0, 0.4, 0], [0, 1.4, 0], [0, 2.5, 0], [0, 3.42, 0], [0, 4.0, 0]], [0.27, 0.235, 0.195, 0.16, 0.004], { nu: nq(48), nv: nq(72), sq: 0.9, col: vein });
  g.surf(K_PLAIN, 0.35, 0.9);
  limb(g, [[0, 3.34, 0], [0, 3.44, 0]], [0.172, 0.165], { nu: nq(32), nv: 2, sq: 0.9, col: BRASS, capA: true, capB: true });
  limb(g, [[0, 0.42, 0], [0, 0.52, 0]], [0.29, 0.275], { nu: nq(32), nv: 2, sq: 0.9, col: BRASS, capA: true, capB: true });
  // sigils burning on every face
  for (let s = 0; s < 4; s++) g.in(M(0, 0, 0, 0, s * 90, 0), () => { for (const [y, sz2, off] of [[0.95, 0.34, 0.252], [1.72, 0.3, 0.225], [2.45, 0.26, 0.198], [3.05, 0.2, 0.178]]) g.in(M(0, y, off, -2, 0, 0), () => sigil(g, s * 7 + y * 10, sz2, EMBER, 1.7, 0.07)); });
  // horns: a great pair near the top, a lesser pair below and crosswise
  for (const e of [0, 180]) g.in(M(0, 3.0, 0, 0, e + 90, 0), () => g.in(M(0, 0, 0.12, 38, 0, 0), () => hellHorn(g, 0.95, 1.2)));
  for (const e of [0, 180]) g.in(M(0, 2.2, 0, 0, e, 0), () => g.in(M(0, 0, 0.16, 48, 0, 0), () => hellHorn(g, 0.6, 1.1)));
  // chains slung from the horns to the base, small fires at two corners, skulls
  for (const e of [-1, 1]) chain(g, [[e * 0.56, 3.36, 0], [e * 0.5, 2.4, 0.1], [e * 0.44, 1.2, 0.2], [e * 0.4, 0.5, 0.28]], 0.06, [0.05, 0.045, 0.04]);
  for (const [x, z] of [[0.36, 0.36], [-0.36, -0.36]]) g.in(M(x, 0.18, z), () => brazier(g, 0.3, FIRE_HOT, [0.05, 0.04, 0.035], x * 9));
  for (const [x, z, ry] of [[-0.36, 0.36, -40], [0.36, -0.36, 140]]) g.in(M(x, 0.18, z, 0, ry, 0), () => skull(g, 1.0));
}
function pitGate(g) {
  g.moss = 0;
  pad(g, 3, 3, 0.06, (x, y, z) => mul(mix(rgb(0x1e1a1a), rgb(0x3a2220), fbm3(x * 4, 1, z * 4, 3)), 0.7 + 0.5 * noise3(x * 13, y * 9, z * 13)), 33);
  const R = 0.98;
  // the rim: a ring of slag heaved up round the pit
  g.surf(K_STONE, 0.8);
  g.sheet(nq(96), nq(18), (u, v) => {
    const a = u * TAU, b = v * Math.PI * 1.25 - 0.2, n = fbm3(Math.cos(a) * 3.2, v * 3, Math.sin(a) * 3.2, 3), rr = 0.3 * (0.75 + 0.6 * n), d = R + 0.16 - Math.cos(b) * rr * 1.1;
    return [Math.cos(a) * d, Math.max(-0.05, Math.sin(b) * rr * 1.25 + 0.04), Math.sin(a) * d];
  }, magma(g, mul(OBSIDIAN, 1.5), 4, 0.03), true, true);
  g.surf(K_PLAIN, 1);
  // the pit itself: a lake of fire, tongues standing in it
  g.in(M(0, 0.1, 0), () => pool(g, R, FIRE_HOT, 6, 1.6));
  for (const [x, z, s] of [[0.2, 0.1, 0.7], [-0.4, 0.3, 0.5], [0.3, -0.5, 0.55], [-0.2, -0.3, 0.45], [0.6, 0.4, 0.4]]) g.in(M(x, 0.1, z), () => fire(g, s, FIRE_HOT, x * 7 + z, 1.5));
  // five arches of fanged rock leaning in over it
  const N5 = 5, feet = [];
  for (let i = 0; i < N5; i++) {
    const a = (i / N5) * TAU + 0.3, h2 = 2.5 + 0.5 * hash1(i, 7), half = 0.5;
    const P = (da, rr, y) => [Math.cos(a + da) * rr, y, Math.sin(a + da) * rr];
    const pts = [P(-half, 1.2, -0.1), P(-half * 0.92, 1.16, 0.8), P(-half * 0.55, 1.0, h2 * 0.72), P(0, 0.78, h2), P(half * 0.55, 1.0, h2 * 0.72), P(half * 0.92, 1.16, 0.8), P(half, 1.2, -0.1)];
    g.surf(K_STONE, 0.7);
    limb(g, pts, [0.24, 0.2, 0.15, 0.09, 0.15, 0.2, 0.24], { nu: nq(18), nv: nq(54), amp: 0.3, nf: 2.2, seed: i * 3 + 1, col: magma(g, mul(i % 2 ? BRIMSTONE : OBSIDIAN, 1.3), i + 10, 0.03) });
    g.surf(K_PLAIN, 1);
    // a fang at the crown, barbs down the haunches
    const top = P(0, 0.78, h2);
    g.in(M(top[0], top[1] - 0.05, top[2], 0, 90 - a / DEG - 90, 0), () => g.in(M(0, 0, 0, 0, 180, 0), () => hellHorn(g, 0.85, 0.5)));
    for (const e of [-1, 1]) for (const [k, s] of [[2, 0.5], [1, 0.42]]) { const q = pts[e < 0 ? k : 6 - k]; g.in(M(q[0], q[1], q[2], 0, -a / DEG + 90 + e * 40, 0), () => g.in(M(0, 0, 0.1, 55, 0, 0), () => hellHorn(g, s, 1))); }
    g.in(M(top[0], top[1] - 0.34, top[2], 0, -a / DEG + 90 + 180, 0), () => g.in(M(0, 0, -0.1, 0, 180, 0), () => sigil(g, i + 3, 0.3, EMBER, 1.7, 0.08)));
    feet.push(P(-half, 1.2, 0.5), top);
  }
  // chains swagged from crown to crown, and one hanging over the fire with a hook
  for (let i = 0; i < N5; i++) { const a = feet[i * 2 + 1], b = feet[((i + 1) % N5) * 2 + 1], pts = []; for (let q = 0; q <= 8; q++) { const t = q / 8; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - 0.32 - 0.5 * Math.sin(t * Math.PI), lerp(a[2], b[2], t)]); } chain(g, pts, 0.075, [0.05, 0.045, 0.04]); }
  g.surf(K_PLAIN, 1, 0, 1.5);
  const rnd = rng(533); for (let i = 0; i < 16; i++) { const a = rnd() * TAU, d = rnd() * 0.8; g.in(M(Math.cos(a) * d, 0.5 + rnd() * 1.6, Math.sin(a) * d), () => g.add(new THREE.OctahedronGeometry(0.018 + 0.02 * rnd(), 0), [1.0, 0.4, 0.05])); }
  // skull heaps and a brazier in the corners
  for (const [sx, sz, sd] of [[1, 1, 1], [-1, 1, 2], [-1, -1, 3], [1, -1, 4]]) g.in(M(sx * 1.24, 0.04, sz * 1.24), () => { if (sd % 2) { for (let i = 0; i < 4; i++) g.in(M((i % 2) * 0.16 - 0.08, i > 2 ? 0.14 : 0, (i >> 1) * 0.14 - 0.07, 0, sd * 90 + i * 50, 0), () => skull(g, 1.0, true)); } else brazier(g, 0.5, FIRE_HOT, [0.05, 0.04, 0.035], sd); });
}

// =====================================================================================================
// Beasts: hide, bone, raw timber and red ochre
// =====================================================================================================
const HIDE = rgb(0xb0905e), HIDE_DARK = rgb(0x7a5a3a), OCHRE = rgb(0x9a3a24), RAW_WOOD = rgb(0x8a6a42);
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
    return buildPartGeometry({ prims: P }, { res: 46 * qual(), ao: 0.8 });
  });
}
function beastSkull(g, s = 1) {
  g.surf(K_PLAIN, 0.75);
  g.in(M(0, 0, 0, 0, 0, 0, s), () => {
    g.add(beastSkullGeo());
    for (const e of [-1, 1]) horn(g, [[e * 0.24, 0.5, -0.22], [e * 0.52, 0.62, -0.3], [e * 0.74, 0.86, -0.16], [e * 0.72, 1.12, 0.1], [e * 0.56, 1.24, 0.32]], 0.1, rgb(0x3a3028), rgb(0xa89878), { rings: 40, nu: nq(12), nv: nq(26) });
  });
}
function yurt(g) {
  pad(g, 3, 3, 0.07, rgb(0x6a5238), 41);
  const R = 1.13, wy = 1.02, NP = 16, cr = 0.26, cy = 2.02, door = Math.PI / 2;   // the door faces +Z
  // wall: hides laced to a lattice, bulging between the poles; a band of ochre teeth painted round it
  const hc = hideCol(HIDE, 3, 1 / NP), hc2 = hideCol(mix(HIDE, HIDE_DARK, 0.5), 5, 1 / NP);
  g.surf(K_CLOTH, 0.95);
  g.sheet(nq(96), nq(12), (u, v) => { const a = u * TAU, rr = R + 0.035 * Math.abs(Math.sin(u * NP * Math.PI)) * Math.sin(v * Math.PI) - 0.04 * v; return [Math.cos(a) * rr, v * wy - 0.03, Math.sin(a) * rr]; },
    (x, y, z, nx, ny, nz, u, v) => { const t = tri1(u * NP * 2), band = v > 0.62 && v < 0.86, teeth = band && t > (v - 0.62) / 0.24, low = v < 0.2; return teeth ? mul(OCHRE, 0.8 + 0.3 * noise3(x * 20, y * 20, z * 20)) : band ? mul([0.75, 0.7, 0.58], 0.8 + 0.25 * noise3(x * 20, y * 20, z * 20)) : low ? hc2(x, y, z, nx, ny, nz, u, v) : hc(x, y, z, nx, ny, nz, u, v); }, true, true);
  for (const y of [0.24, 0.94]) { const pts = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU; pts.push([Math.cos(a) * (R + 0.03), y + 0.012 * Math.sin(a * 9), Math.sin(a) * (R + 0.03)]); } rope(g, pts, 0.022, rgb(0xb89c68), 6); }
  // roof: hides over sixteen poles, sagging between them, weighted with stones on ropes
  g.sheet(nq(96), nq(18), (u, v) => { const a = u * TAU, sag = Math.abs(Math.sin(u * NP * Math.PI)), rr = lerp(R + 0.12, cr, v), y = lerp(wy - 0.03, cy, Math.pow(v, 0.9)) - 0.07 * (1 - sag) * Math.sin(v * Math.PI) + 0.012; return [Math.cos(a) * rr, y, Math.sin(a) * rr]; },
    (x, y, z, nx, ny, nz, u, v) => { const ring = v > 0.42 && v < 0.5, t = tri1(u * NP), patch = hash1(Math.floor(u * NP), Math.floor(v * 3), 4); return ring && t > 0.3 ? mul(OCHRE, 0.85) : v > 0.9 ? mul(HIDE_DARK, 0.5 + 0.3 * noise3(x * 9, y * 9, z * 9)) : (patch > 0.62 ? hc2 : hc)(x, y, z, nx, ny, nz, u, v * 0.3); }, true, true);
  for (let i = 0; i < NP; i++) {
    const a = ((i + 0.5) / NP) * TAU, co = Math.cos(a), si = Math.sin(a);
    logTo(g, [co * (R + 0.2), wy - 0.08, si * (R + 0.2)], [co * -0.16, cy + 0.42, si * -0.16], 0.03, 0.022, i + 3, { seg: 7, capB: true, bark: mul(RAW_WOOD, 0.8) });
    if (i % 2 === 0 && Math.abs(a - door) > 0.5) { rope(g, [[co * 0.5, cy - 0.38, si * 0.5], [co * (R + 0.14), wy + 0.02, si * (R + 0.14)], [co * (R + 0.2), 0.5, si * (R + 0.2)]], 0.013, rgb(0xb89c68), 5); g.in(M(co * (R + 0.2), 0.36, si * (R + 0.2)), () => boulder(g, 0.1, 0.12, 0.09, i + 7, rgb(0x77736a), nq(16))); }
  }
  g.surf(K_PLAIN, 1);
  g.in(M(0, cy - 0.02, 0), () => g.cyl(cr, cr, 0.001, nq(16), [0.02, 0.012, 0.008], false, true));
  g.in(M(0, cy, 0), () => g.add(new THREE.TorusGeometry(cr + 0.01, 0.035, 6, nq(20)).rotateX(Math.PI / 2), woodTint(RAW_WOOD, 3)));
  g.surf(K_PLAIN, 1, 0, 0.9); g.in(M(0, cy - 0.015, 0), () => g.cyl(cr * 0.6, cr * 0.6, 0.001, nq(12), [1.0, 0.4, 0.06], false, true));
  // the lattice showing at the foot of the wall
  g.surf(K_WOOD, 0.9);
  for (let i = 0; i < 40; i++) for (const e of [-1, 1]) { const a0 = (i / 40) * TAU, a1 = a0 + e * 0.16; if (Math.abs(((a0 - door + Math.PI * 3) % TAU) - Math.PI) < 0.3) continue; g.beamTo([Math.cos(a0) * (R + 0.04), 0.0, Math.sin(a0) * (R + 0.04)], [Math.cos(a1) * (R + 0.045), 0.22, Math.sin(a1) * (R + 0.045)], 0.022, 0.012, 0.004, woodTint(RAW_WOOD, i), 1); }
  // the door: a dark mouth between two tusks, a flap tied back, a skull and antlers over it
  g.in(M(0, 0, R - 0.02), () => {
    g.surf(K_PLAIN, 1);
    g.sheet(8, 6, (u, v) => { const x = (u - 0.5) * 0.62 * (1 - 0.25 * v * v); return [x, v * 0.98, 0.05 - x * x * 0.4]; }, (x, y) => mix([0.25, 0.1, 0.03], [0.012, 0.01, 0.008], smooth(0, 0.5, y)));
    for (const e of [-1, 1]) g.in(M(e * 0.42, 0, 0.12, 0, e * -90, 0), () => g.in(M(0, 0, 0, -4, 0, 0), () => tusk(g, 1.05, 1)));
    g.in(M(0.3, 1.0, 0.07, 0, 0, -8), () => rag(g, 0.34, 0.9, mix(HIDE, OCHRE, 0.35), 4, 0.2));
    g.in(M(0, 1.06, 0.1, 20, 0, 0, 0.42), () => beastSkull(g, 1));
  });
  // a drying rack with a hide on it, firewood, a cooking tripod
  g.in(M(-1.08, 0, 1.08, 0, 45, 0), () => {
    for (const e of [-1, 1]) for (const q of [-1, 1]) g.in(M(e * 0.3, 0, 0, q * 14, 0, 0), () => stake(g, 0.025, 0.86, e + q * 3, RAW_WOOD, RAW_WOOD));
    logTo(g, [-0.38, 0.8, 0], [0.38, 0.8, 0], 0.025, 0.022, 9, { seg: 7, capB: true });
    g.in(M(0, 0.8, 0.0, 12, 0, 0), () => rag(g, 0.5, 0.62, HIDE_DARK, 9, 0.25, OCHRE));
  });
  for (let i = 0; i < 6; i++) g.in(M(1.18 + (i % 3) * 0.085 - 0.08, 0.06 + Math.floor(i / 3) * 0.09, 1.0 + (i % 2) * 0.02, 90, 30, 0), () => g.in(M(0, -0.22, 0), () => log(g, 0.045, 0.04, 0.44, i + 30, { seg: 8, capB: true })));
  for (const [x, z, ry] of [[1.2, -1.15, 30], [-1.18, -1.12, -50]]) g.in(M(x, 0, z, 0, ry, 0), () => g.in(M(0, 0, 0, 8, 0, 0), () => tusk(g, 0.8, 1)));
}
function totem(g) {
  // a ring of field stones and offerings at its foot
  pad(g, 1, 1, 0.06, rgb(0x6a5238), 43);
  for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU + 0.2; g.in(M(Math.cos(a) * 0.36, 0.02, Math.sin(a) * 0.36, 0, i * 77, 0), () => boulder(g, 0.1, 0.08, 0.085, i + 80, rgb(0x7d7a70), nq(16))); }
  g.in(M(0.3, 0.07, 0.34, 0, 30, 0), () => skull(g, 0.8, true));
  bone(g, [-0.36, 0.09, 0.3], [-0.14, 0.08, 0.4], 0.018, 3);
  // the pole: three spirits carved one above another and painted. Sculpted once.
  g.surf(K_WOOD, 0.85);
  g.in(M(0, 0, 0, 0, 0, 0, 1.09), () => g.add(geoOnce('totemPole', () => {
    const wood = 0x94744a, red = 0xa8361e, teal = 0x2f8a7a, white = 0xe6dcc0, black = 0x1e1a16, yel = 0xd8a62a, P = [];
    const grain = (p) => p.color(wood).tint(0.14, 9).bump(0.005, 26, 'fur');
    P.push(grain(S.cyl(0.25, 3.0, 0.04).at(0, 1.45, 0)));
    // -- the bottom spirit: a wide-mouthed toad-bear with tusks --
    P.push(grain(S.ellipsoid(0.34, 0.42, 0.32).at(0, 0.52, 0.02).blend(0.03)));
    P.push(S.box(0.56, 0.1, 0.2, 0.04).at(0, 0.8, 0.2).color(red).blend(0.02));
    P.push(...S.mirrorX([S.sphere(0.095).at(0.15, 0.66, 0.26).color(white).blend(0.008), S.sphere(0.045).at(0.15, 0.66, 0.34).color(black).blend(0.004)]));
    P.push(S.ellipsoid(0.11, 0.08, 0.1).at(0, 0.52, 0.32).color(teal).blend(0.02));
    P.push(S.box(0.46, 0.09, 0.2, 0.03).at(0, 0.3, 0.26).color(0x5a160e).cut(0.02));
    for (let i = -3; i <= 3; i++) P.push(S.box(0.045, 0.06, 0.03, 0.008).at(i * 0.062, 0.335, 0.27).color(white).blend(0.004));
    P.push(...S.mirrorX([S.cone(0.04, 0.008, 0.2, 0.004).rot(0, 0, -12).at(0.25, 0.4, 0.28).color(white).blend(0.008)]));
    P.push(...S.mirrorX([S.ellipsoid(0.1, 0.16, 0.12).at(0.33, 0.3, 0.1).color(red).blend(0.03)]));          // paws
    // -- the middle spirit: a horned watcher with great round eyes --
    P.push(grain(S.ellipsoid(0.3, 0.4, 0.3).at(0, 1.5, 0.02).blend(0.03)));
    P.push(...S.mirrorX([S.torus(0.12, 0.03).rot(90, 0, 0).at(0.14, 1.62, 0.26).color(teal).blend(0.006), S.sphere(0.1).at(0.14, 1.62, 0.22).color(yel).blend(0.006), S.sphere(0.045).at(0.14, 1.62, 0.31).color(black).blend(0.004)]));
    P.push(S.cone(0.07, 0.015, 0.22, 0.01).rot(110, 0, 0).at(0, 1.47, 0.34).color(red).blend(0.012));           // hooked nose
    P.push(S.box(0.3, 0.04, 0.1, 0.01).at(0, 1.27, 0.26).color(black).cut(0.01));
    P.push(...S.mirrorX(S.limb([[0.22, 1.8, 0], [0.42, 1.95, 0.02], [0.52, 2.2, 0.04], [0.44, 2.42, 0.08]], [0.075, 0.06, 0.04, 0.012]).map((p) => p.color(white).blend(0.015))));
    P.push(S.cyl(0.275, 0.07, 0.01).at(0, 1.06, 0).color(teal).paint(0.004, 0.006));
    P.push(S.cyl(0.275, 0.07, 0.01).at(0, 1.98, 0).color(red).paint(0.004, 0.006));
    // -- the top spirit: a storm bird with its wings out --
    P.push(grain(S.ellipsoid(0.26, 0.36, 0.26).at(0, 2.5, 0.02).blend(0.03)));
    P.push(S.capsule([0, 2.6, 0.2], [0, 2.4, 0.52], 0.09, 0.02).color(yel).blend(0.012));
    P.push(...S.mirrorX([S.sphere(0.07).at(0.12, 2.7, 0.2).color(white).blend(0.006), S.sphere(0.034).at(0.125, 2.7, 0.265).color(black).blend(0.004)]));
    P.push(S.box(0.44, 0.07, 0.16, 0.03).at(0, 2.8, 0.14).color(black).blend(0.015));
    for (const e of [-1, 1]) {
      P.push(S.box(0.62, 0.5, 0.07, 0.03).rot(0, 0, e * 14).at(e * 0.5, 2.52, -0.04).color(wood).tint(0.14, 9).blend(0.02));
      for (let i = 0; i < 5; i++) P.push(S.box(0.022, 0.42, 0.1, 0.005).rot(0, 0, e * (14 + i * 5)).at(e * (0.3 + i * 0.105), 2.44 + i * 0.02, 0).color(black).cut(0.008));
      P.push(S.box(0.64, 0.12, 0.08, 0.02).rot(0, 0, e * 14).at(e * 0.5, 2.76, -0.04).color(red).paint(0.004, 0.006));
      P.push(S.box(0.64, 0.1, 0.08, 0.02).rot(0, 0, e * 14).at(e * 0.48, 2.42, -0.04).color(teal).paint(0.004, 0.004));
    }
    for (let i = -2; i <= 2; i++) P.push(S.cone(0.05, 0.01, 0.42 - Math.abs(i) * 0.07, 0.006).rot(0, 0, -i * 16).at(i * 0.09, 3.02 - Math.abs(i) * 0.04, 0).color(i % 2 ? white : red).blend(0.012));
    return buildPartGeometry({ prims: P }, { res: 36 * qual(), ao: 0.8 });
  })));
  // lashings, a charm of bones and feathers hung from the wings
  for (const y of [1.06, 1.98]) g.in(M(0, (y + 0.07) * 1.09, 0), () => lashing(g, 0.3, 2, 0.012));
  for (const e of [-1, 1]) { rope(g, [[e * 0.8, 2.7, 0], [e * 0.81, 2.4, 0.01], [e * 0.8, 2.15, 0]], 0.008, rgb(0xb89c68), 4); bone(g, [e * 0.8, 2.16, 0], [e * 0.8, 1.92, 0.02], 0.016, e + 5); g.in(M(e * 0.62, 2.62, 0.04, 0, 0, e * 6), () => rag(g, 0.07, 0.3, OCHRE, e + 4, 0.2)); }
}
function bonePit(g) {
  // a banked ring of trodden earth, dark and stained in the middle
  pad(g, 3, 3, 0.3, (x, y, z) => { const d = Math.hypot(x, z), e = mul(rgb(0x5e4a34), 0.65 + 0.6 * fbm3(x * 3.3, y * 5, z * 3.3, 3)); return mix(e, [0.16, 0.025, 0.02], smooth(0.9, 0.2, d) * smooth(0.35, 0.65, noise3(x * 2.6, 1, z * 2.6)) * 0.85); }, 45, { top: (x, z) => -0.26 * smooth(1.0, 0.55, Math.hypot(x, z)) });
  // the fence: sharpened stakes leaning out, lashed to two rails, ribs woven between
  const R = 1.12, NS = 28;
  for (let i = 0; i < NS; i++) {
    const a = (i / NS) * TAU + 0.1, co = Math.cos(a), si = Math.sin(a), hh = 1.0 + 0.4 * hash1(i, 3), big = i % 5 === 0;
    g.in(M(co * R, 0.1, si * R, 0, -a / DEG + 90, 0), () => g.in(M(0, 0, 0, 9 + 7 * hash1(i, 5), 0, (hash1(i, 9) - 0.5) * 14), () => stake(g, big ? 0.07 : 0.05, big ? 1.5 : hh, i + 60, mul(RAW_WOOD, 0.7))));
    if (i % 3 === 1) rib(g, [co * (R + 0.06), 0.2, si * (R + 0.06)], [Math.cos(a + 0.34) * (R + 0.16), 1.1, Math.sin(a + 0.34) * (R + 0.16)], [co * 0.3, 0.1, si * 0.3], 0.036, i);
  }
  for (const [y, rr] of [[0.45, R + 0.09], [0.85, R + 0.16]]) { const pts = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * TAU; pts.push([Math.cos(a) * rr, y + 0.03 * Math.sin(a * 7), Math.sin(a) * rr]); } rope(g, pts, 0.02, rgb(0xb89c68), 6); }
  for (const e of [-1, 1]) g.in(M(e * 0.5, 0.1, R + 0.02, 0, e * -90, 0), () => tusk(g, 1.2, 1.1));
  // the great skull on a heap in the middle
  g.in(M(0, 0, -0.1), () => {
    g.surf(K_STONE, 0.95);
    g.sheet(nq(30), nq(10), (u, v) => { const a = u * TAU, d = v * 0.7; return [Math.cos(a) * d, 0.02 + 0.3 * Math.pow(1 - v * v, 0.9) * (0.75 + 0.5 * noise3(Math.cos(a) * 3, d * 5, Math.sin(a) * 3)), Math.sin(a) * d * 0.8]; }, (x, y, z) => mix(mul(rgb(0x4a3a2a), 0.6 + 0.7 * noise3(x * 9, y * 9, z * 9)), BONE_OLD, smooth(0.6, 0.75, noise3(x * 17, y * 17, z * 17))), true);
    g.in(M(0.02, 0.22, 0.0, -14, 18, 5), () => beastSkull(g, 1.0));
  });
  // a rib cage half sunk in the mud, a jawbone, loose bones, picked skulls
  g.in(M(-0.72, 0.0, 0.5, 0, 50, 0), () => {
    g.surf(K_PLAIN, 0.7);
    limb(g, [[-0.5, 0.12, 0], [-0.2, 0.2, 0], [0.2, 0.2, 0], [0.5, 0.1, 0]], [0.04, 0.05, 0.05, 0.03], { nu: nq(8), nv: nq(16), col: boneCol(3), capA: true, capB: true });
    for (let i = 0; i < 7; i++) for (const e of [-1, 1]) { const x = -0.4 + i * 0.13, s = 0.3 - Math.abs(i - 3) * 0.03; rib(g, [x, 0.2, e * 0.03], [x + 0.03, 0.06, e * s * 0.9], [0, s * 0.9, e * s * 0.5], 0.02, i + e); }
  });
  const rnd = rng(611);
  for (let i = 0; i < 16; i++) { const a = rnd() * TAU, d = 0.35 + rnd() * 0.75, b = rnd() * TAU, x = Math.cos(a) * d, z = Math.sin(a) * d, y = 0.07 + 0.2 * smooth(0.7, 1.1, d); bone(g, [x, y, z], [x + Math.cos(b) * 0.3, y + rnd() * 0.06, z + Math.sin(b) * 0.3], 0.02 + 0.012 * rnd(), i + 20); }
  for (const [x, z, ry] of [[0.8, 0.6, 30], [0.62, -0.72, 200], [-0.5, -0.8, 120], [0.95, -0.1, 80]]) g.in(M(x, 0.08, z, (ry % 7) * 4, ry, (ry % 5) * 5), () => skull(g, 1.1, true));
  // the meat post: a hooked chain and what is left of a haunch
  g.in(M(0.78, 0.15, 0.7, 0, 0, -4), () => {
    stake(g, 0.06, 1.9, 91, mul(RAW_WOOD, 0.7));
    logTo(g, [-0.05, 1.62, 0], [-0.62, 1.74, -0.1], 0.04, 0.03, 93, { seg: 8, capB: true });
    g.in(M(-0.04, 1.62, 0), () => lashing(g, 0.065, 3));
    chain(g, [[-0.55, 1.7, -0.09], [-0.55, 1.25, -0.09]], 0.06, [0.06, 0.05, 0.045]);
    g.surf(K_PLAIN, 0.7);
    g.sculpt({ prims: [S.ellipsoid(0.13, 0.2, 0.11).at(-0.55, 1.02, -0.09).color(0x7a2018).tint(0.2, 14), S.capsule([-0.55, 0.86, -0.09], [-0.55, 0.66, -0.09], 0.03, 0.045).color(0xd9d0b4).blend(0.02), S.ellipsoid(0.07, 0.1, 0.06).at(-0.5, 1.1, -0.02).color(0xc8b89a).blend(0.02)] }, 60, 0.7);
  });
}

// =====================================================================================================
// Elemental: pale rune stone and living crystal
// =====================================================================================================
const RUNE_STONE = rgb(0x9fb0c2), RUNE_GLOW = [0.25, 0.7, 1.0];
/** rune stone: pale, bedded, with threads of light in it (sets each vertex's glow; follow with g.surf) */
const runeRock = (g, seed = 0, veins = 1, moss = 0) => { const rc = rockCol(mul(RUNE_STONE, 1.5), seed, moss, 4); return (x, y, z, nx, ny) => { const v = Math.abs(noise3(x * 1.6 + seed, y * 1.6, z * 1.6 + seed * 0.7) - 0.5), e = veins * smooth(0.016, 0.003, v) * smooth(0.3, 0.6, noise3(x * 0.6 + 3, y * 0.6, z * 0.6 + seed)); g.glow = 1.5 * e; const c = rc(x, y, z, nx, ny); return e > 0.02 ? mix(c, RUNE_GLOW, e) : c; }; };
/** a crystal with a point at both ends, hanging in the air about the local origin */
function shard(g, r, h, seed, glow = 1.2) { g.in(M(0, -h * 0.18, 0), () => { crystal(g, r, h * 0.82, seed, { glow, ns: 4 }); g.in(M(0, 0, 0, 180, 0, 0), () => crystal(g, r, h * 0.4, seed + 3, { glow, ns: 3 })); }); }
/** a clump of small crystals growing from the local origin */
function crystalClump(g, s, n, seed, o = {}) { const rnd = rng(seed * 53 + 1); for (let i = 0; i < n; i++) { const a = rnd() * TAU, t = i ? 14 + 26 * rnd() : 4; g.in(M(i ? Math.cos(a) * 0.1 * s : 0, -0.03, i ? Math.sin(a) * 0.1 * s : 0, t * Math.sin(a), rnd() * 60, -t * Math.cos(a)), () => crystal(g, (i ? 0.05 + 0.03 * rnd() : 0.1) * s, (i ? 0.3 + 0.4 * rnd() : 1) * s, seed * 9 + i, { ns: 4, ...o })); } }
function crystalSpire(g) {
  g.moss = 0.3;
  pad(g, 2, 2, 0.1, runeRock(g, 3, 1), 51); g.surf(K_STONE, 0.9);
  // the bed rock the crystals broke out of
  const rnd = rng(701);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + 0.5, d = 0.52 + 0.1 * rnd(); g.in(M(Math.cos(a) * d, 0.02, Math.sin(a) * d, 0, rnd() * 360, 0), () => boulder(g, 0.34 + 0.08 * rnd(), 0.24 + 0.1 * rnd(), 0.3 + 0.06 * rnd(), i + 70, mul(RUNE_STONE, 1.25), nq(40))); }
  // the great crystal and its court
  g.in(M(0.02, 0.05, 0, 2, 0, -2), () => crystal(g, 0.34, 4.95, 5, { ns: 26, glow: 1.0, m: 7 }));
  for (const [a, d, h2, r, t] of [[0.4, 0.3, 3.5, 0.22, 10], [1.7, 0.34, 2.8, 0.2, 16], [2.9, 0.3, 3.9, 0.21, 8], [4.0, 0.36, 2.3, 0.19, 22], [5.2, 0.33, 3.1, 0.2, 14], [0.95, 0.5, 1.7, 0.15, 24], [3.5, 0.52, 1.5, 0.15, 26], [5.75, 0.5, 1.9, 0.14, 22]]) g.in(M(Math.cos(a) * d, 0.05, Math.sin(a) * d, t * Math.sin(a), a * 40, -t * Math.cos(a)), () => crystal(g, r, h2, a * 31, { ns: 14, glow: 0.95, deep: h2 > 3 ? rgb(0x1f58c8) : rgb(0x3a3ad0), bright: h2 > 3 ? rgb(0x9fe8ff) : rgb(0xc0b8ff) }));
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU + rnd() * 0.3, d = 0.62 + 0.24 * rnd(), t = 20 + 30 * rnd(); g.in(M(Math.cos(a) * d, 0.12, Math.sin(a) * d, t * Math.sin(a), rnd() * 90, -t * Math.cos(a)), () => crystal(g, 0.06 + 0.05 * rnd(), 0.4 + 0.6 * rnd(), i + 200, { ns: 5, glow: 1.0 })); }
  // splinters hanging in the air round it
  for (const [a, d, y, s] of [[0.2, 0.74, 2.2, 0.5], [1.5, 0.8, 3.3, 0.38], [2.6, 0.7, 2.7, 0.44], [3.8, 0.78, 3.9, 0.34], [4.9, 0.72, 1.8, 0.46], [5.8, 0.66, 4.3, 0.3], [2.1, 0.5, 4.6, 0.26]]) g.in(M(Math.cos(a) * d, y, Math.sin(a) * d, 12 * Math.sin(a * 3), a * 57, 14 * Math.cos(a * 2)), () => shard(g, 0.1 * s + 0.03, 0.9 * s + 0.1, a * 17, 1.3));
  // four rune stones standing guard at the corners, channels of light running in to the crystal
  for (const [sx, sz, i] of [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]]) {
    g.in(M(sx * 0.78, 0, sz * 0.78, 0, Math.atan2(-sx, -sz) / DEG, 0), () => {
      g.surf(K_STONE, 0.9);
      limb(g, [[0, -0.05, 0], [0.01, 0.4, 0], [0, 0.8, 0.02], [0, 0.98, 0.03]], [0.17, 0.16, 0.13, 0.03], { nu: nq(22), nv: nq(18), sq: 0.6, flat: [1, 0.6], amp: 0.1, nf: 3, seed: i + 5, col: runeRock(g, i + 9, 0) });
      g.in(M(0, 0.52, 0.105, -3, 0, 0), () => sigil(g, i + 31, 0.36, RUNE_GLOW, 1.7, 0.06));
    });
    g.surf(K_PLAIN, 0.4, 0, 1.5);
    g.tube([[sx * 0.7, 0.07, sz * 0.7], [sx * 0.52, 0.2, sz * 0.5], [sx * 0.3, 0.3, sz * 0.32]], 0.02, 5, RUNE_GLOW, false);
  }
}
function monolith(g) {
  g.moss = 0.6;
  pad(g, 1, 1, 0.07, rockCol(mul(RUNE_STONE, 1.2), 5, 0.6), 53);
  for (const [x, z, s, sd] of [[0.3, 0.3, 0.15, 1], [-0.33, 0.22, 0.12, 2], [-0.2, -0.34, 0.14, 3], [0.34, -0.26, 0.1, 4]]) g.in(M(x, 0.02, z, 0, sd * 80, 0), () => boulder(g, s, s * 0.7, s * 0.9, sd + 90, mul(RUNE_STONE, 1.2), nq(24)));
  // the stone: a tall slab, weathered round, runes cut deep and still burning
  g.surf(K_STONE, 0.92);
  const lean = M(0, 0, 0, 2, 12, -3);
  g.in(lean, () => {
    limb(g, [[0, -0.1, 0], [0.02, 0.9, 0], [-0.02, 1.9, 0.01], [0.03, 2.65, 0], [0.06, 3.02, 0]], [0.4, 0.39, 0.35, 0.27, 0.05], { nu: nq(60), nv: nq(88), sq: 0.55, flat: [1, 0.55], amp: 0.1, nf: 2.2, seed: 7, col: runeRock(g, 13, 1, 0.5) });
    g.surf(K_PLAIN, 1);
    for (const e of [1, -1]) g.in(M(0, 0, 0, 0, e > 0 ? 0 : 180, 0), () => {
      for (const [y, s, zo] of [[0.62, 0.42, 0.212], [1.3, 0.4, 0.2], [1.95, 0.36, 0.182], [2.5, 0.26, 0.15]]) g.in(M(e * 0.015, y, zo, -1.5, 0, 0), () => sigil(g, y * 13 + e * 3 + 20, s, RUNE_GLOW, 1.8, 0.07));
      // a ring cut round the topmost rune
      g.surf(K_PLAIN, 0.4, 0, 1.6); g.in(M(e * 0.02, 2.5, 0.148), () => g.add(new THREE.TorusGeometry(0.19, 0.014, 5, nq(24)), RUNE_GLOW));
    });
    // a band of small marks round its waist
    g.surf(K_PLAIN, 0.4, 0, 1.5);
    for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU, co = Math.cos(a), si = Math.sin(a), k = Math.pow(Math.pow(Math.abs(co), 6.4) + Math.pow(Math.abs(si), 6.4), -1 / 6.4), rr = 0.39 * k; g.in(M(co * rr, 0.98, si * rr * 0.55, 0, 90 - a / DEG, 0), () => g.in(M(0, 0, 0.012), () => (i % 3 ? g.cbox(0.02, 0.1 + 0.04 * (i % 2), 0.02, 0.006, RUNE_GLOW) : g.stud(0.03, RUNE_GLOW, 6, 0.5)))); }
  });
  // crystals at its foot, chips of stone and light drifting near its head
  for (const [x, z, s, sd] of [[0.26, 0.36, 0.36, 1], [-0.36, -0.1, 0.3, 2], [0.1, -0.38, 0.26, 3]]) g.in(M(x, 0.05, z), () => crystalClump(g, s, 4, sd));
  for (const [x, y, z, s, sd] of [[0.42, 2.5, 0.2, 0.09, 1], [-0.4, 2.9, -0.1, 0.07, 2], [0.2, 3.3, -0.2, 0.06, 3], [-0.25, 2.2, 0.32, 0.06, 4]]) g.in(M(x, y, z, sd * 30, sd * 70, sd * 20), () => { g.surf(K_STONE, 0.9); boulder(g, s, s * 0.8, s * 0.7, sd + 40, RUNE_STONE, nq(14)); });
  for (const [x, y, z, s, sd] of [[-0.38, 2.6, 0.15, 0.3, 5], [0.36, 3.05, -0.05, 0.24, 6], [0.05, 3.4, 0.1, 0.34, 7]]) g.in(M(x, y, z, sd * 11, sd * 50, sd * 9), () => shard(g, 0.05, s, sd * 3, 1.4));
}
function stoneRing(g) {
  g.moss = 0.35;
  const dais = stoneTint(RUNE_STONE, 3, 3), R = 1.42;
  // the dais: two steps, its top cut with rings and spokes that carry light out from the core
  g.surf(K_STONE, 0.9);
  g.lathe([[R, -0.08], [R, 0.1], [R - 0.03, 0.14], [R - 0.2, 0.14], [R - 0.2, 0.24], [R - 0.23, 0.28]], nq(64), dais);
  g.sheet(nq(72), nq(22), (u, v) => { const a = u * TAU, d = v * (R - 0.23), groove = Math.abs(d - 0.5) < 0.03 || Math.abs(d - 0.95) < 0.03 ? 0.012 : 0; return [Math.cos(a) * d, 0.28 - groove, Math.sin(a) * d]; }, (x, y, z) => {
    const d = Math.hypot(x, z), a = Math.atan2(z, x), ring = Math.abs(d - 0.5) < 0.035 || Math.abs(d - 0.95) < 0.035, spoke = d > 0.5 && d < 0.95 && tri1((a / TAU) * 7 + 0.25) < 0.07, hot = ring || spoke;
    g.glow = hot ? 1.5 : 0;
    return hot ? RUNE_GLOW : mul(RUNE_STONE, (0.82 + 0.3 * noise3(x * 5, 1, z * 5)) * (Math.floor(d * 5 + 0.2) % 2 ? 0.92 : 1.02));
  }, true);
  g.surf(K_STONE, 0.9);
  for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU; g.in(M(Math.cos(a) * (R - 0.1), 0.14, Math.sin(a) * (R - 0.1), 0, -a / DEG, 0), () => g.cbox(0.16, 0.012, 0.012, 0.004, mul(RUNE_STONE, 0.5))); }
  // seven carved stones hanging in a ring, each with its rune turned to the core
  const N7 = 7, RR = 1.0;
  for (let i = 0; i < N7; i++) {
    const a = (i / N7) * TAU + 0.2, co = Math.cos(a), si = Math.sin(a), y = 1.0 + 0.3 * Math.sin(i * 2.4) + (i % 2) * 0.12, hh = 0.95 + 0.25 * hash1(i, 3);
    g.in(M(co * RR, y, si * RR, 6 * Math.sin(i * 1.7), 90 - a / DEG, 8 * Math.cos(i * 2.9)), () => {
      g.surf(K_STONE, 0.9);
      limb(g, [[0, -hh / 2, 0], [0, -hh * 0.36, 0], [0, 0, 0], [0, hh * 0.36, 0], [0, hh / 2, 0]], [0.04, 0.2, 0.25, 0.21, 0.05], { nu: nq(28), nv: nq(24), sq: 0.8, flat: [1, 0.5], amp: 0.07, nf: 3, seed: i + 3, col: runeRock(g, i + 21, 0.6) });
      for (const e of [1, -1]) g.in(M(0, 0, e * 0.128, 0, e > 0 ? 0 : 180, 0), () => sigil(g, i * 5 + (e > 0 ? 0 : 50) + 60, 0.36, RUNE_GLOW, 1.8, 0.065));
      // grit that fell away from it when it rose
      for (let q = 0; q < 3; q++) g.in(M((q - 1) * 0.12, -hh / 2 - 0.12 - q * 0.08, (q % 2) * 0.06), () => { g.surf(K_STONE, 0.9); boulder(g, 0.05 - q * 0.008, 0.04, 0.04, i * 4 + q, RUNE_STONE, nq(12)); });
    });
    // a thread of light from the core to the stone
    g.surf(K_PLAIN, 0.4, 0, 1.4);
    const pts = []; for (let q = 0; q <= 6; q++) { const t = q / 6; pts.push([co * RR * t * 0.9, lerp(1.45, y, t) + 0.16 * Math.sin(t * Math.PI), si * RR * t * 0.9]); }
    g.tube(pts, 0.012, 4, [0.4, 0.8, 1.0], false);
    g.in(M(co * (R - 0.36), 0.28, si * (R - 0.36)), () => crystalClump(g, 0.3, 3, i + 3));
  }
  // the core: a crystal turning in rings of light
  g.in(M(0, 1.45, 0), () => {
    g.in(M(0, 0, 0, 8, 0, 6), () => { crystal(g, 0.24, 0.7, 3, { glow: 1.5, ns: 8, m: 8, bright: rgb(0xd8f4ff) }); g.in(M(0, 0, 0, 180, 0, 0), () => crystal(g, 0.24, 0.55, 4, { glow: 1.5, ns: 8, m: 8, bright: rgb(0xd8f4ff) })); });
    g.surf(K_PLAIN, 0.3, 0, 1.6);
    for (const [rx, rz, rr] of [[70, 10, 0.46], [20, 60, 0.54], [-40, -30, 0.62]]) g.in(M(0, 0.05, 0, rx, 0, rz), () => g.add(new THREE.TorusGeometry(rr, 0.014, 5, nq(40)), [0.45, 0.82, 1.0]));
    for (let i = 0; i < 6; i++) { const a = i * 1.047; g.in(M(Math.cos(a) * 0.5, 0.25 * Math.sin(a * 2), Math.sin(a) * 0.5, i * 40, i * 70, 0), () => shard(g, 0.035, 0.2, i + 7, 1.5)); }
  });
  g.surf(K_PLAIN, 0.4, 0, 1.3);
  g.in(M(0, 0.28, 0), () => g.lathe([[0.2, 0], [0.09, 0.05], [0.03, 0.4], [0.012, 0.8]], nq(12), [0.4, 0.8, 1.0]));
}

// =====================================================================================================
// Dragons: charred rock, burnt timber, gold
// =====================================================================================================
const CHAR_ROCK = rgb(0x74625a), SCALE_RED = rgb(0x8a2a1a);
/** charred rock with a few claw gouges raked across it between heights y0 and y1 on the side facing angle `at` */
const clawRock = (seed, y0 = 0, y1 = 0, at = 0, col = CHAR_ROCK) => { const rc = rockCol(col, seed, 0, 5); return (x, y, z, nx, ny) => {
  let c = rc(x, y, z, nx, ny);
  if (y > y0 && y < y1) { const a = Math.atan2(z, x), da = Math.abs(((a - at + Math.PI * 3) % TAU) - Math.PI); if (da < 0.75) { const s = (a - at) * 0.5 + (y - y0) * 0.5, q = tri1(s * 3.2 + 0.25), band = Math.abs(s) < 0.42; if (band && q < 0.22) c = mix(c, [0.012, 0.01, 0.01], 0.85 * smooth(0.22, 0.1, q) * smooth(y0, y0 + 0.1, y) * smooth(y1, y1 - 0.15, y)); else if (band && q < 0.3) c = mul(c, 1.5); } }
  return c;
}; };
/** a charred log from a to b, here and there still alight inside */
function charLog(g, a, b, r, seed) { logTo(g, a, b, r, r * 0.86, seed, { seg: nq(10), capB: true, bark: hash1(seed, 3) > 0.6 ? [0.16, 0.13, 0.11] : [0.07, 0.06, 0.055], heart: hash1(seed, 5) > 0.75 ? [0.6, 0.16, 0.03] : [0.2, 0.17, 0.15], amp: 0.16 }); }
function nest(g) {
  g.moss = 0;
  pad(g, 3, 3, 0.08, (x, y, z) => mul(mix(rgb(0x26211f), rgb(0x4a4038), fbm3(x * 3.3, 1, z * 3.3, 3)), 0.7 + 0.5 * noise3(x * 11, y * 9, z * 11)), 61);
  // the wall of the nest: whole trunks torn up, burnt hard and wedged together, layer on layer
  const rnd = rng(811);
  for (let L = 0; L < 4; L++) {
    const n = 13 - L, RR = 1.16 + 0.07 * Math.sin(L * 1.3) - L * 0.02, y = 0.14 + L * 0.2;
    for (let i = 0; i < n; i++) {
      const a = ((i + (L % 2) * 0.5) / n) * TAU + rnd() * 0.12, sp = 0.4 + 0.2 * rnd(), a0 = a - sp, a1 = a + sp, r0 = RR + (rnd() - 0.5) * 0.14, r1 = RR + (rnd() - 0.5) * 0.14, k = 1 / Math.cos(sp) * 0.93;
      charLog(g, [Math.cos(a0) * r0 * k, y + (rnd() - 0.5) * 0.14, Math.sin(a0) * r0 * k], [Math.cos(a1) * r1 * k, y + (rnd() - 0.5) * 0.14, Math.sin(a1) * r1 * k], 0.1 + 0.035 * rnd() - L * 0.008, L * 20 + i);
    }
  }
  // splintered limbs jammed in upright, their ends still glowing
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + rnd() * 0.2, r0 = 1.0 + 0.2 * rnd(), out = 0.1 + 0.2 * rnd(), hh = 0.5 + 0.7 * rnd(), tw = (rnd() - 0.5) * 0.7, co = Math.cos(a), si = Math.sin(a);
    const hot = i % 4 === 0;
    g.surf(K_WOOD, 0.95);
    limb(g, [[co * r0, 0.3, si * r0], [co * (r0 + out * 0.5) - si * tw * 0.3, 0.3 + hh * 0.55, si * (r0 + out * 0.5) + co * tw * 0.3], [co * (r0 + out) - si * tw, 0.3 + hh, si * (r0 + out) + co * tw]], [0.045, 0.034, 0.008], { nu: nq(7), nv: nq(10), amp: 0.2, nf: 4, seed: i, col: (x, y, z, nx, ny, nz, u, v) => { g.glow = hot ? 1.4 * smooth(0.7, 0.95, v) : 0; return hot && v > 0.7 ? mix([0.05, 0.04, 0.035], [1.0, 0.3, 0.03], smooth(0.7, 0.95, v)) : charCol(i)(x, y, z); } });
    g.glow = 0;
  }
  // the bowl: ash, cinders and old scales trodden flat
  g.surf(K_PLAIN, 0.95);
  g.sheet(nq(48), nq(12), (u, v) => { const a = u * TAU, d = v * 1.08; return [Math.cos(a) * d, 0.2 + 0.5 * v * v * v + 0.03 * noise3(Math.cos(a) * d * 4, 1, Math.sin(a) * d * 4), Math.sin(a) * d]; }, (x, y, z) => { const e = smooth(0.74, 0.86, noise3(x * 6, 3, z * 6)), s = cells3(x * 7, 0.5, z * 7) < 0.16; g.glow = e * 1.2; return e > 0.1 ? mix([0.06, 0.05, 0.05], [1.0, 0.3, 0.03], e) : s ? mul(SCALE_RED, 0.5) : mul([0.1, 0.09, 0.085], 0.5 + 0.8 * noise3(x * 12, 1, z * 12)); }, true);
  g.glow = 0;
  // the clutch
  for (const [x, z, r, h2, c, lean, sd, glow] of [[-0.2, 0.1, 0.24, 0.6, 0x7a1e16, 8, 1, 0], [0.3, -0.1, 0.22, 0.55, 0x1e4a4a, -14, 2, 0], [0.05, 0.42, 0.2, 0.5, 0xb8862e, 20, 3, 0], [-0.4, -0.34, 0.21, 0.52, 0x3a2a4a, -10, 4, 0], [0.42, 0.36, 0.2, 0.5, 0xd8742a, 12, 5, 0.5]]) g.in(M(x, 0.2, z, lean, sd * 70, lean * 0.6), () => egg(g, r, h2, rgb(c), sd, glow));
  // what was brought back for them: gold among the ashes, bones, a helm
  g.in(M(-0.52, 0.22, 0.52), () => goldPile(g, 0.36, 0.3, 0.14, 7, 34));
  g.in(M(0.62, 0.24, -0.5), () => goldPile(g, 0.28, 0.24, 0.1, 9, 22));
  for (let i = 0; i < 8; i++) { const a = rnd() * TAU, d = 0.4 + 0.5 * rnd(), b = rnd() * TAU, x = Math.cos(a) * d, z = Math.sin(a) * d, y = 0.24 + 0.4 * (d / 1.08) ** 3; bone(g, [x, y, z], [x + Math.cos(b) * 0.3, y + 0.04, z + Math.sin(b) * 0.3], 0.024, i + 30, mul(BONE, 0.7)); }
  g.in(M(0.75, 0.42, 0.3, 20, 120, 30), () => skull(g, 1.2));
  g.in(M(-0.7, 0.36, -0.2, 0, 40, 100), () => { g.surf(K_PLAIN, 0.4, 0.9); g.lathe([[0.1, 0], [0.11, 0.08], [0.09, 0.15], [0.04, 0.2], [0, 0.22]], nq(12), (x, y, z) => mul([0.3, 0.3, 0.32], 0.6 + 0.6 * noise3(x * 20, y * 20, z * 20))); g.in(M(0, 0.2, 0), () => g.lathe([[0.012, 0], [0.006, 0.1], [0, 0.12]], 6, GOLD)); });
  // four great ribs of some earlier meal arching over the rim
  for (const [a, s] of [[0.5, 1], [2.3, 0.9], [3.6, 1.05], [5.3, 0.85]]) { const co = Math.cos(a), si = Math.sin(a); horn(g, [[co * 1.3, 0.05, si * 1.3], [co * 1.38, 0.6 * s, si * 1.38], [co * 1.26, 1.1 * s, si * 1.26], [co * 1.0, 1.42 * s, si * 1.0]], 0.085, mul(BONE, 0.95), mul(BONE_OLD, 0.5), { rings: 30, nu: nq(10), nv: nq(20) }); }
}
function perch(g) {
  g.moss = 0;
  pad(g, 2, 2, 0.1, rockCol(mul(CHAR_ROCK, 0.9), 3, 0, 6), 63);
  // the spire: a crag splitting toward the top, raked by claws where the beast climbs
  g.surf(K_STONE, 0.95);
  limb(g, [[0, -0.1, 0], [0.08, 1.1, 0.04], [-0.06, 2.3, 0], [0.06, 3.3, -0.06], [-0.04, 4.2, -0.12], [-0.1, 5.05, -0.1]], [0.84, 0.7, 0.56, 0.5, 0.3, 0.03], { nu: nq(60), nv: nq(100), amp: 0.38, nf: 1.5, seed: 11, col: clawRock(7, 1.3, 2.7, 1.2) });
  limb(g, [[0.2, 3.0, 0], [0.42, 3.6, 0.1], [0.5, 4.2, 0.12], [0.62, 4.62, 0.2]], [0.36, 0.26, 0.17, 0.02], { nu: nq(24), nv: nq(30), amp: 0.36, nf: 2, seed: 5, col: rockCol(CHAR_ROCK, 9, 0, 6) });
  // the ledge it lands on: a tongue of rock thrust out over the drop, scorched black on top
  limb(g, [[0, 3.12, 0.1], [0.1, 3.2, 0.5], [0.16, 3.26, 0.86], [0.18, 3.3, 1.04]], [0.56, 0.56, 0.44, 0.05], { nu: nq(32), nv: nq(26), flat: [0.34, 1], amp: 0.22, nf: 2.4, seed: 13, up: [0, 1, 0], col: (x, y, z, nx, ny) => { const c = clawRock(15, 0, 0)(x, y, z, nx, ny); return ny > 0.5 ? mix(c, [0.015, 0.013, 0.012], 0.75 * smooth(0.3, 0.6, noise3(x * 3, 1, z * 3))) : c; } });
  limb(g, [[0.1, 2.3, 0.3], [0.12, 2.8, 0.52], [0.14, 3.16, 0.62]], [0.22, 0.24, 0.3], { nu: nq(20), nv: nq(12), amp: 0.3, nf: 2.5, seed: 17, col: rockCol(mul(CHAR_ROCK, 0.85), 19, 0, 6) });
  // lesser crags crowding its foot
  for (const [x, z, hh, r, sd, lx, lz] of [[0.66, 0.6, 1.9, 0.3, 1, 0.14, 0.1], [-0.68, 0.56, 1.3, 0.3, 2, -0.12, 0.1], [-0.62, -0.62, 2.3, 0.32, 3, -0.1, -0.16], [0.7, -0.56, 1.5, 0.28, 4, 0.16, -0.1], [0.05, 0.84, 0.8, 0.22, 5, 0, 0.1], [-0.86, 0, 0.9, 0.2, 6, -0.1, 0]]) limb(g, [[x, -0.1, z], [x + lx * 0.4, hh * 0.45, z + lz * 0.4], [x + lx, hh * 0.85, z + lz], [x + lx * 1.2, hh, z + lz * 1.2]], [r, r * 0.8, r * 0.45, 0.02], { nu: nq(24), nv: nq(26), amp: 0.36, nf: 2.2, seed: sd * 7, col: clawRock(sd + 20, sd === 3 ? 0.9 : 0, sd === 3 ? 1.9 : 0, -2.4) });
  g.surf(K_PLAIN, 1);
  // on the ledge: the remains of a meal and a few bright things carried up
  g.in(M(0.14, 3.42, 0.62), () => {
    bone(g, [-0.2, 0.03, 0.02], [0.1, 0.04, 0.16], 0.024, 3, mul(BONE, 0.8)); bone(g, [0.12, 0.03, -0.1], [-0.06, 0.05, -0.26], 0.02, 4, mul(BONE, 0.8));
    g.in(M(-0.12, 0.02, -0.12, 0, 60, 14), () => skull(g, 1.0));
    for (let i = 0; i < 4; i++) rib(g, [-0.02 + i * 0.07, 0.02, 0.24], [0.0 + i * 0.07, 0.03, 0.02], [0, 0.18, 0], 0.014, i);
    g.in(M(0.14, -0.02, 0.2), () => goldPile(g, 0.14, 0.12, 0.06, 5, 9));
  });
  // scorch and a seam of fire where its breath has cracked the rock; a hoop of chain it broke long ago
  g.surf(K_PLAIN, 0.6, 0, 1.4);
  for (const [pts] of [[[[0.5, 1.0, 0.56], [0.46, 1.5, 0.5], [0.52, 1.9, 0.4], [0.44, 2.3, 0.38]]], [[[-0.6, 0.6, 0.4], [-0.56, 1.0, 0.4], [-0.5, 1.5, 0.3]]]]) g.tube(pts, [0.008, 0.02, 0.016, 0.006].slice(0, pts.length), 5, [1.0, 0.32, 0.03], false);
  g.in(M(-0.05, 2.0, 0), () => { const pts = []; for (let i = 0; i <= 22; i++) { const a = (i / 22) * 4.4 + 2.2; pts.push([Math.cos(a) * 0.66, 0.1 * Math.sin(a * 2) - 0.18 * (i / 22), Math.sin(a) * 0.66]); } chain(g, pts, 0.09, [0.07, 0.06, 0.055]); });
  chain(g, [[-0.36, 1.86, 0.5], [-0.42, 1.4, 0.6], [-0.45, 1.0, 0.64]], 0.09, [0.07, 0.06, 0.055]);
  // horns of rock at the summit
  for (const [x, y, z, rx, rz2, s] of [[-0.1, 4.75, -0.1, -10, 14, 0.5], [0.58, 4.4, 0.18, 10, -22, 0.4]]) g.in(M(x, y, z, rx, 0, rz2), () => horn(g, [[0, 0, 0], [0.02, 0.3 * s, 0], [0.08, 0.6 * s, 0.02], [0.2, 0.86 * s, 0.03]], 0.09 * s + 0.03, mul(CHAR_ROCK, 0.5), CHAR_ROCK, { rings: 12, rough: 0.9 }));
}
function hoard(g) {
  g.moss = 0;
  pad(g, 3, 3, 0.07, rockCol(mul(CHAR_ROCK, 0.85), 5, 0, 6), 65);
  // the hill: a hump of burnt rock with its mouth open to the south, something still glowing far inside
  const at = Math.PI / 2, mouth = (a, el) => { const da = Math.abs(((a - at + Math.PI * 3) % TAU) - Math.PI); return smooth(0.62, 0.36, da) * smooth(0.62, 0.48, el + 0.12 * da); };
  const rc = clawRock(9, 1.25, 2.0, at + 0.9);
  g.surf(K_STONE, 0.95);
  g.sheet(nq(110), nq(44), (u, v) => {
    const a = u * TAU, el = (1 - v) * 0.5 * Math.PI, co = Math.cos(a), si = Math.sin(a), ce = Math.cos(el), se = Math.sin(el);
    const k = Math.pow(Math.pow(Math.abs(co), 3.4) + Math.pow(Math.abs(si), 3.4), -1 / 3.4), n = fbm3(co * ce * 2.1 + 5, se * 2.4, si * ce * 2.1, 3), m = mouth(a, el / (0.5 * Math.PI));
    const rr = lerp(1.36 * (0.86 + 0.14 * k) * (0.8 + 0.4 * n), 0.36, m * 0.92), hh = 2.2 * (0.82 + 0.36 * n) * (1 - 0.1 * m);
    return [co * ce * rr, v > 0.995 ? -0.06 : se * hh, si * ce * rr - 0.12];
  }, (x, y, z, nx, ny) => {
    const a = Math.atan2(z + 0.12, x), el = Math.atan2(y / 2.2, Math.hypot(x, z + 0.12) / 1.36) / (0.5 * Math.PI), m = mouth(a, el);
    g.glow = m > 0.75 ? 1.2 * smooth(0.75, 1, m) * smooth(1.0, 0.2, y) : 0;
    return m > 0.3 ? mix(rc(x, y, z, nx, ny), m > 0.75 ? mix([0.02, 0.012, 0.01], [1.0, 0.36, 0.04], smooth(0.8, 1, m) * smooth(1.0, 0.2, y)) : [0.02, 0.014, 0.012], smooth(0.3, 0.62, m)) : rc(x, y, z, nx, ny);
  }, true);
  g.surf(K_STONE, 0.95);
  // fangs of rock round the mouth, two horns of it standing guard
  for (let i = 0; i < 7; i++) { const t = (i - 3) / 3, x = t * 0.56, y = 1.24 - t * t * 0.42, len = 0.34 - Math.abs(t) * 0.1; g.in(M(x, y, 0.86 - Math.abs(t) * 0.1, 172, 0, t * -14), () => horn(g, [[0, -0.1, 0], [0, len * 0.5, 0.02], [0.01, len, 0.03]], 0.085 - Math.abs(t) * 0.02, mul(CHAR_ROCK, 0.7), mul(CHAR_ROCK, 1.2), { rings: 10, rough: 0.9 })); }
  for (const e of [-1, 1]) limb(g, [[e * 0.86, -0.1, 0.9], [e * 0.9, 0.7, 0.98], [e * 0.8, 1.4, 1.02], [e * 0.66, 1.86, 0.98]], [0.3, 0.24, 0.15, 0.02], { nu: nq(24), nv: nq(28), amp: 0.34, nf: 2.2, seed: e + 5, col: rockCol(CHAR_ROCK, e + 9, 0, 6) });
  for (const [x, z, hh, r, sd] of [[-1.22, -1.1, 1.3, 0.26, 1], [1.2, -1.14, 1.0, 0.24, 2], [0.2, -1.3, 0.8, 0.2, 3]]) limb(g, [[x, -0.1, z], [x * 1.02, hh * 0.5, z * 1.02], [x * 1.05, hh, z * 1.05]], [r, r * 0.7, 0.02], { nu: nq(20), nv: nq(18), amp: 0.36, nf: 2.2, seed: sd * 5, col: rockCol(CHAR_ROCK, sd, 0, 6) });
  g.surf(K_PLAIN, 1);
  // the hoard pouring out of it
  g.in(M(0, 0.03, 0.82), () => {
    const hgt = goldPile(g, 0.74, 0.62, 0.46, 3, 130);
    g.in(M(0.0, 0.0, -0.5), () => goldPile(g, 0.5, 0.5, 0.6, 5, 40));
    // an iron-bound chest burst open
    g.in(M(-0.36, hgt(-0.36, 0.1) - 0.06, 0.1, 6, 30, -8), () => {
      g.surf(K_WOOD, 0.85); g.in(M(0, 0.12, 0), () => g.cbox(0.44, 0.24, 0.3, 0.015, woodTint(rgb(0x4a3020), 3)));
      g.in(M(0, 0.24, -0.15, -70, 0, 0), () => g.in(M(0, 0.0, 0.15, 0, 0, 90), () => { g.in(M(0, 0, 0, 0, 0, 0), () => g.lathe([[0.15, -0.22], [0.15, 0.22]], nq(12), woodTint(rgb(0x4a3020), 5), 0, Math.PI)); }));
      g.surf(K_PLAIN, 0.5, 0.85);
      for (const x of [-0.16, 0.16]) g.in(M(x, 0.12, 0), () => g.cbox(0.045, 0.25, 0.31, 0.006, IRON));
      g.surf(K_PLAIN, 0.3, 0.9, 0.08);
      g.in(M(0, 0.22, 0), () => g.add(new THREE.SphereGeometry(0.2, nq(12), 5, 0, TAU, 0, 1.2).scale(1, 0.4, 0.7), (x, y, z) => mul(GOLD, 0.5 + 0.8 * hash1(Math.round(x * 60), Math.round(z * 60), 3))));
    });
    // cups, a crown, a blade, a shield
    g.surf(K_PLAIN, 0.3, 0.9, 0.06);
    for (const [x, z, rz2, s] of [[0.3, 0.3, 70, 1], [0.5, -0.1, 20, 0.8], [-0.1, 0.46, -80, 0.9]]) g.in(M(x, hgt(x, z) + 0.03, z, 0, x * 200, rz2), () => g.lathe([[0.05, 0], [0.015, 0.02], [0.012, 0.08], [0.03, 0.1], [0.06, 0.16], [0.065, 0.22], [0.055, 0.22], [0.045, 0.12]].map(([r, y]) => [r * s, y * s]), nq(12), mul(GOLD, 1.05)));
    g.in(M(0.12, hgt(0.12, 0.05) + 0.02, 0.05, 14, 0, -10), () => { g.lathe([[0.1, 0], [0.105, 0.05], [0.1, 0.06], [0.095, 0]], nq(16), GOLD); for (let i = 0; i < 8; i++) g.in(M(Math.cos(i * 0.785) * 0.1, 0.05, Math.sin(i * 0.785) * 0.1), () => g.lathe([[0.016, 0], [0.01, 0.04], [0, 0.07]], 5, GOLD)); g.surf(K_PLAIN, 0.1, 0.1, 0.6); for (let i = 0; i < 4; i++) g.in(M(Math.cos(i * 1.57) * 0.105, 0.03, Math.sin(i * 1.57) * 0.105), () => g.add(new THREE.OctahedronGeometry(0.018, 0), rgb(0xd8283a))); });
    g.in(M(-0.05, hgt(-0.05, -0.2) - 0.05, -0.2, 16, 30, 12), () => { g.surf(K_PLAIN, 0.25, 0.95); g.in(M(0, 0.45, 0), () => g.cbox(0.06, 0.74, 0.012, 0.005, [0.6, 0.62, 0.66])); g.surf(K_PLAIN, 0.3, 0.9, 0.06); g.in(M(0, 0.82, 0), () => g.cbox(0.26, 0.035, 0.04, 0.01, GOLD)); g.in(M(0, 0.84, 0), () => g.cyl(0.02, 0.02, 0.16, 8, mul(GOLD, 0.6))); g.in(M(0, 1.02, 0), () => g.add(new THREE.SphereGeometry(0.035, 8, 6), GOLD)); });
    g.in(M(0.52, hgt(0.52, 0.3) + 0.05, 0.3, -60, 30, 0), () => roundShield(g, 0.24, SCALE_RED, GOLD, 3));
  });
  // bones of those who came for it
  g.in(M(-1.1, 0.06, 1.14, 0, 30, 0), () => { skull(g, 1.1); bone(g, [0.2, 0.03, 0.05], [0.44, 0.04, -0.08], 0.022, 3); bone(g, [0.1, 0.03, 0.18], [0.36, 0.03, 0.22], 0.02, 4); });
  g.in(M(1.14, 0.05, 1.2, 0, -50, 0), () => { for (let i = 0; i < 5; i++) rib(g, [-0.2 + i * 0.09, 0.02, 0.12], [-0.2 + i * 0.09, 0.03, -0.12], [0, 0.2, 0], 0.016, i); });
}

// =====================================================================================================
// exports
// =====================================================================================================
const BUILDERS = { scrapHut, warDrum, brewery, crypt, boneSpire, charnel, forge, obelisk, pitGate, yurt, totem, bonePit, crystalSpire, monolith, stoneRing, nest, perch, hoard };
/** every faction building: square footprints, so a turned placement is the same piece */
export const structures = Object.fromEntries(Object.entries(BUILDERS).map(([id, make]) => [id, (def, w, h, place) => struct(id, make)]));
