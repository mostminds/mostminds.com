// Faction buildings: six looks for every existing building, and eighteen buildings of the factions' own.
//
//   restyle(model, style, key)              -> the building re-dressed for a faction ('kingdom' returns it unchanged)
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
 * The six looks. pal[class] = [swatches, patch frequency, contrast, floor, ceiling]; trim = stone that stands lighter
 * than the rest (copings, quoins, bands); fx(...) touches up a vertex after the remap; disp(...) moves it; drop(...)
 * tears triangles out of a roof.
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
 * a smooth seeded field, the faction's ornaments added. `key` names the source geometry (model id first, then size,
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

function buildRestyle(parts, st, style, key) {
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
  const ax = hz > hx ? 1 : 0, long = Math.max(hx, hz), short = Math.min(hx, hz);
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
  for (let i = 0; i < n; i++) {
    const o = i * 3, c = cls[i], x = P[o], y = P[o + 1], z = P[o + 2], rel = lum[i] / mean[c];
    a3[0] = A[o]; a3[1] = A[o + 1]; a3[2] = A[o + 2];
    if (c === C_GLOW) { const l = clamp(lum[i] * 1.6, 0.45, 1); c3[0] = glow[0] * l; c3[1] = glow[1] * l; c3[2] = glow[2] * l; }
    else if (c === C_GLASS) { const l = 0.35 + 0.4 * noise3(x * 3 + k.s1, y * 3, z * 3); c3[0] = lerp(C[o], glow[0] * l, st.window); c3[1] = lerp(C[o + 1], glow[1] * l, st.window); c3[2] = lerp(C[o + 2], glow[2] * l, st.window); a3[0] = 0.4; a3[2] = Math.min(1.2, st.window * 1.1); }
    else if (c === C_LIQUID) { const l = clamp(lum[i] * 1.5, 0.3, 0.9); c3[0] = glow[0] * l; c3[1] = glow[1] * l; c3[2] = glow[2] * l; a3[2] = Math.max(a3[2], 0.5 * st.window); }
    else if (c === C_DARK) { c3[0] = C[o]; c3[1] = C[o + 1]; c3[2] = C[o + 2]; }
    else {
      const e = st.pal[c] || st.pal[C_OTHER], sws = e[0], f = e[1];
      const pick = noise3(x * f + k.s1 + c * 7.3, y * f * 1.3, z * f + k.s2) * sws.length * 1.6, s0 = sws[Math.floor(pick) % sws.length], sh = clamp(Math.pow(rel, e[2]), e[3], e[4]);
      c3[0] = s0[0] * sh; c3[1] = s0[1] * sh; c3[2] = s0[2] * sh;
      if (st.trim && c === C_STONE && y > 0.3 && N[o + 1] > 0.45 && rel > 0.7) { const t = smooth(0.45, 0.75, N[o + 1]) * smooth(0.08, 0.2, walkDist(x, y, z)) * clamp(rel, 0.7, 1.2); if (t > 0) { c3[0] = lerp(c3[0], st.trim[0][0], t); c3[1] = lerp(c3[1], st.trim[0][1], t); c3[2] = lerp(c3[2], st.trim[0][2], t); } }
    }
    st.fx(c, x, y, z, N[o + 1], c3, a3, k);
    C[o] = c3[0]; C[o + 1] = c3[1]; C[o + 2] = c3[2]; A[o] = a3[0]; A[o + 1] = a3[1]; A[o + 2] = a3[2];
  }
  // ---- torn roofs: triangles left out (decided where they lay before anything moved) ----
  // Large dark linings under roofs are left out too: with only a corner here and there they cannot follow the tiles.
  let I2 = I;
  {
    let q = 0; I2 = new Uint32Array(ni);
    for (let t = 0; t < ni; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2], ca = cls[a];
      if (lum[a] < 0.09 && lum[b] < 0.09 && lum[c] < 0.09 && P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1] > 3 && A[a * 3 + 2] < 0.3) {
        const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
        if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 0.5) continue;
      }
      if (st.drop && ca === cls[b] && ca === cls[c] && N[a * 3 + 1] > 0.2) { const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3; if (y > 0.9 && walkDist(x, y, z) > 0.3 && st.drop(ca, Math.round(x * 5) / 5, Math.round(y * 5) / 5, Math.round(z * 5) / 5, k)) continue; }
      I2[q++] = a; I2[q++] = b; I2[q++] = c;
    }
    I2 = I2.subarray(0, q);
  }
  // ---- shape ----
  for (let i = 0; i < n; i++) {
    if (pinned[i]) continue;
    const o = i * 3;
    move(P[o], P[o + 1], P[o + 2]);
    P[o] += o3[0]; P[o + 1] += o3[1]; P[o + 2] += o3[2];
  }
  const others = parts.other.map(({ mesh, m }) => {
    const g = mesh.geometry.clone().applyMatrix4(m), p = g.attributes.position, nr = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (nr && nr.getY(i) > 0.25 && LEVELS.some((L) => Math.abs(y - L) <= 0.02)) continue;
      move(x, y, z); p.setXYZ(i, x + o3[0], y + o3[1], z + o3[2]);
    }
    p.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  });
  // ---- ornaments ----
  let og = null;
  if (!BARE.has(id) && Hh >= 1.2 && ORNAMENTS[style]) {
    og = new Geo(); og.moss = 0;
    try { ORNAMENTS[style](og, survey(P, n, bb, k, walkDist, walkCells, id, seed), k); } catch (err) { console.warn('[factions] ornaments failed for', key, style, err); og = null; }
    if (og && !og.n) og = null;
  }
  const geo = new THREE.BufferGeometry(), on = og ? og.n : 0, oi = og ? og.I.length : 0;
  const cat = (a, b) => { if (!on) return a; const r = new Float32Array((n + on) * 3); r.set(a); r.set(b, n * 3); return r; };
  let idx = I2;
  if (on) { idx = new Uint32Array(I2.length + oi); idx.set(I2); for (let i = 0; i < oi; i++) idx[I2.length + i] = og.I[i] + n; }
  geo.setAttribute('position', new THREE.BufferAttribute(cat(P, og && og.P), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(cat(N, og && og.N), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cat(C, og && og.C), 3));
  geo.setAttribute('aPbr', new THREE.BufferAttribute(cat(A, og && og.A), 3));
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
function survey(P, n, bb, k, walkDist, walkCells, id, seed) {
  const cell = 0.125, w = Math.ceil((bb.x1 - bb.x0) / cell) + 1, h = Math.ceil((bb.z1 - bb.z0) / cell) + 1, hm = new Float32Array(w * h).fill(-1);
  const ny = Math.ceil(bb.y1 / cell) + 1, fz = [new Float32Array(w * ny).fill(-1e9), new Float32Array(w * ny).fill(-1e9)], fx = [new Float32Array(h * ny).fill(-1e9), new Float32Array(h * ny).fill(-1e9)];
  for (let i = 0; i < n; i++) {
    const o = i * 3, x = P[o], y = P[o + 1], z = P[o + 2];
    if (y < 0) continue;
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
