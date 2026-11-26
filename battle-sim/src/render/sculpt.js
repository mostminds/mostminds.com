// Sculpting kit: describe a model part as blended volumes ("prims") plus crisp
// hard-surface pieces ("hard"), and get back one dense, smooth-shaded mesh with
// baked colour, ambient occlusion and per-vertex roughness / metalness / glow.
//
//   prims  S.sphere / S.ellipsoid / S.capsule / S.box / S.cyl / S.cone / S.torus
//          chained with .at() .rot() .color() .blend() .cut() .paint() .bump() ...
//          They are unioned in order with smooth blending, so muscles flow into
//          each other the way sculpted clay does.
//   hard   H.box / H.lathe / H.extrude / H.tube / H.sheet / ... for blades, plates,
//          planks: ordinary geometry that keeps sharp edges.
//
// buildPartGeometry({ prims, hard }, { res }) meshes the prims with surface nets
// at `res` cells per model unit and merges the hard pieces in.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const BIG = 1e9;
const DEG = Math.PI / 180;
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _c = new THREE.Color();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** sRGB hex -> linear [r, g, b] */
export function rgb(hex) { _c.set(hex); return [_c.r, _c.g, _c.b]; }
const asRgb = (c) => (Array.isArray(c) ? c : rgb(c));

// ---------- noise ----------
function hash(ix, iy, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** smooth value noise, 0..1 */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v), w);
}
/** fractal noise, 0..1 */
export function fbm3(x, y, z, oct = 3) {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x, y, z); n += a; a *= 0.5; x *= 2.03; y *= 2.03; z *= 2.03; }
  return s / n;
}
/** cellular noise: distance to the nearest feature point, 0..~1 */
export function cells3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz;
    const px = cx + hash(cx, cy, cz) - x, py = cy + hash(cy, cz, cx + 7) - y, pz = cz + hash(cz, cx, cy + 13) - z;
    const d = px * px + py * py + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
const BUMPS = { noise: 0, scales: 1, ridges: 2, fur: 3, rock: 4, weave: 5 };
function bumpPattern(kind, x, y, z) {
  switch (kind) {
    case 1: return 1 - Math.min(1, cells3(x, y, z) * 1.25);              // rounded scales / pebbles
    case 2: return 0.5 + 0.5 * Math.sin(y * 6.2832);                       // rings along local Y
    case 3: return noise3(x, y * 0.22, z);                                  // strands running along local Y
    case 4: return fbm3(x, y, z, 4) * 0.7 + (1 - Math.min(1, cells3(x * 0.6, y * 0.6, z * 0.6))) * 0.3; // craggy stone
    case 5: return 0.5 + 0.25 * (Math.sin(x * 6.2832) + Math.sin(y * 6.2832)); // cloth / mail weave
    default: return fbm3(x, y, z, 2);
  }
}

// ---------- prims ----------
class Prim {
  constructor(type, p) {
    this.type = type; this.p = p; this.m = new THREE.Matrix4();
    this.col = [0.7, 0.7, 0.7]; this.hasCol = false; this.rough = 0.8; this.metal = 0; this.glowV = 0;
    this.k = 0.025; this.op = 0; this.soft = 0.008; this.raise = 0;
    this.bAmp = 0; this.bFreq = 10; this.bKind = 0; this.tAmp = 0; this.tFreq = 20;
  }
  /** move (applied after anything already set) */
  at(x, y, z) { this.m.premultiply(_m.makeTranslation(x, y, z)); return this; }
  /** rotate in DEGREES about X, then Y, then Z (applied after anything already set) */
  rot(rx = 0, ry = 0, rz = 0) { this.m.premultiply(_m.makeRotationFromEuler(_e.set(rx * DEG, ry * DEG, rz * DEG, 'XYZ'))); return this; }
  /** uniform scale */
  scale(s) { this.m.premultiply(_m.makeScale(s, s, s)); return this; }
  color(hex) { this.col = asRgb(hex); this.hasCol = true; return this; }
  /** surface finish: roughness 0..1, metalness 0..1 */
  pbr(rough, metal = 0) { this.rough = rough; this.metal = metal; return this; }
  /** self-illumination 0..2 (fire, eyes, magic) */
  glow(v = 1) { this.glowV = v; return this; }
  /** blend radius with what came before: 0 = crisp seam, 0.02-0.08 = fleshy */
  blend(k) { this.k = k; return this; }
  /** carve this volume out of everything before it (mouths, sockets, grooves) */
  cut(k = 0.006) { this.op = 1; this.k = k; return this; }
  /** recolour the surface inside this volume without changing shape; raise > 0 embosses it outward (trim, straps), < 0 engraves */
  paint(soft = 0.006, raise = 0) { this.op = 2; this.soft = soft; this.raise = raise; return this; }
  /** surface relief: amp in model units, freq = features per unit, kind: noise | scales | ridges | fur | rock | weave */
  bump(amp, freq = 12, kind = 'noise') { this.bAmp = amp; this.bFreq = freq; this.bKind = BUMPS[kind] ?? 0; return this; }
  /** mottle the colour: amp 0..1, freq = blotches per unit */
  tint(amp, freq = 20) { this.tAmp = amp; this.tFreq = freq; return this; }
  clone() { const c = Object.assign(new Prim(this.type, this.p), this); c.m = this.m.clone(); c.col = this.col.slice(); return c; }
  /** mirrored copy across the X = 0 plane */
  mirrorX() { const c = this.clone(); c.m.premultiply(_m.makeScale(-1, 1, 1)); return c; }
}

export const S = {
  sphere: (r) => new Prim(0, { r }),
  ellipsoid: (rx, ry, rz) => new Prim(1, { rx, ry, rz }),
  /** tapered capsule from point a to point b with end radii ra, rb */
  capsule: (a, b, ra, rb = ra) => new Prim(2, { a, b, ra, rb }),
  /** box of full size w,h,d with edge rounding r */
  box: (w, h, d, r = 0.01) => new Prim(3, { w, h, d, r }),
  /** cylinder along Y, centred, radius r, height h, edge rounding */
  cyl: (r, h, round = 0) => new Prim(4, { r, h, round }),
  /** capped cone along Y, centred: bottom radius r1, top radius r2, height h */
  cone: (r1, r2, h, round = 0) => new Prim(5, { r1, r2, h, round }),
  /** ring around the Y axis: major radius R, tube radius r */
  torus: (R, r) => new Prim(6, { R, r }),
  /** chain of tapered capsules through points with a radius per point (tails, horns, tentacles, arms) */
  limb: (pts, radii) => {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) out.push(S.capsule(pts[i], pts[i + 1], radii[i], radii[i + 1]));
    return out;
  },
  /** returns the list plus a mirrored copy of each prim across X = 0 */
  mirrorX: (list) => [...list, ...list.map((p) => p.mirrorX())],
};

function compile(prims) {
  const out = [];
  for (const p of prims.flat(Infinity)) {
    if (!p) continue;
    const inv = p.m.clone().invert().elements;
    const det = Math.abs(p.m.determinant());
    const s = Math.cbrt(det) || 1;
    const q = p.p;
    let lc = [0, 0, 0], R = 0, pre = null;
    switch (p.type) {
      case 0: R = q.r; break;
      case 1: R = Math.max(q.rx, q.ry, q.rz); break;
      case 2: {
        const [ax, ay, az] = q.a, [bx, by, bz] = q.b;
        const bax = bx - ax, bay = by - ay, baz = bz - az, l2 = bax * bax + bay * bay + baz * baz;
        const rr = q.ra - q.rb;
        pre = { ax, ay, az, bax, bay, baz, l2, rr, a2: l2 - rr * rr, il2: l2 > 1e-12 ? 1 / l2 : 0, ra: q.ra, rb: q.rb };
        lc = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]; R = Math.sqrt(l2) / 2 + Math.max(q.ra, q.rb); break;
      }
      case 3: R = Math.hypot(q.w, q.h, q.d) / 2; break;
      case 4: R = Math.hypot(q.r, q.h / 2); break;
      case 5: R = Math.hypot(Math.max(q.r1, q.r2), q.h / 2); break;
      case 6: R = q.R + q.r; break;
    }
    const c = new THREE.Vector3(...lc).applyMatrix4(p.m);
    out.push({
      type: p.type, q, pre, e: inv, s, cx: c.x, cy: c.y, cz: c.z,
      R: R * s + Math.max(0, p.bAmp) + Math.max(0, p.raise),
      col: p.col, hasCol: p.hasCol, rough: p.rough, metal: p.metal, glow: p.glowV,
      k: p.k, op: p.op, soft: p.soft, raise: p.raise,
      bAmp: p.bAmp, bFreq: p.bFreq, bKind: p.bKind, tAmp: p.tAmp, tFreq: p.tFreq,
    });
  }
  return out;
}

let _qx = 0, _qy = 0, _qz = 0; // local-space point of the last primD call
function primD(c, x, y, z) {
  const e = c.e;
  const px = e[0] * x + e[4] * y + e[8] * z + e[12];
  const py = e[1] * x + e[5] * y + e[9] * z + e[13];
  const pz = e[2] * x + e[6] * y + e[10] * z + e[14];
  _qx = px; _qy = py; _qz = pz;
  const q = c.q;
  let d;
  switch (c.type) {
    case 0: d = Math.sqrt(px * px + py * py + pz * pz) - q.r; break;
    case 1: {
      const ax = px / q.rx, ay = py / q.ry, az = pz / q.rz;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      const bx = ax / q.rx, by = ay / q.ry, bz = az / q.rz;
      const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
      d = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(q.rx, q.ry, q.rz); break;
    }
    case 2: {
      const r = c.pre;
      const ax = px - r.ax, ay = py - r.ay, az = pz - r.az;
      if (r.l2 < 1e-12) { d = Math.sqrt(ax * ax + ay * ay + az * az) - Math.max(r.ra, r.rb); break; }
      const yy = ax * r.bax + ay * r.bay + az * r.baz, zz = yy - r.l2;
      const vx = ax * r.l2 - r.bax * yy, vy = ay * r.l2 - r.bay * yy, vz = az * r.l2 - r.baz * yy;
      const x2 = vx * vx + vy * vy + vz * vz, y2 = yy * yy * r.l2, z2 = zz * zz * r.l2;
      const k = Math.sign(r.rr) * r.rr * r.rr * x2;
      if (Math.sign(zz) * r.a2 * z2 > k) d = Math.sqrt(x2 + z2) * r.il2 - r.rb;
      else if (Math.sign(yy) * r.a2 * y2 < k) d = Math.sqrt(x2 + y2) * r.il2 - r.ra;
      else d = (Math.sqrt(x2 * r.a2 * r.il2) + yy * r.rr) * r.il2 - r.ra;
      break;
    }
    case 3: {
      const rr = Math.min(q.r, q.w / 2, q.h / 2, q.d / 2);
      const ax = Math.abs(px) - q.w / 2 + rr, ay = Math.abs(py) - q.h / 2 + rr, az = Math.abs(pz) - q.d / 2 + rr;
      const ox = Math.max(ax, 0), oy = Math.max(ay, 0), oz = Math.max(az, 0);
      d = Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(ax, ay, az), 0) - rr; break;
    }
    case 4: {
      const rd = Math.min(q.round, q.r, q.h / 2);
      const dx = Math.sqrt(px * px + pz * pz) - q.r + rd, dy = Math.abs(py) - q.h / 2 + rd;
      const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
      d = Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy) - rd; break;
    }
    case 5: {
      const rd = Math.min(q.round, Math.min(q.r1, q.r2) > 0 ? Math.min(q.r1, q.r2) : q.round, q.h / 2);
      const h = q.h / 2 - rd, r1 = Math.max(0, q.r1 - rd), r2 = Math.max(0, q.r2 - rd);
      const qx = Math.sqrt(px * px + pz * pz), qy = py;
      const k2x = r2 - r1, k2y = 2 * h;
      const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
      const t = clamp01(((r2 - qx) * k2x + (h - qy) * k2y) / (k2x * k2x + k2y * k2y));
      const cbx = qx - r2 + k2x * t, cby = qy - h + k2y * t;
      const sgn = cbx < 0 && cay < 0 ? -1 : 1;
      d = sgn * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby)) - rd; break;
    }
    default: {
      const l = Math.sqrt(px * px + pz * pz) - q.R;
      d = Math.sqrt(l * l + py * py) - q.r;
    }
  }
  d *= c.s;
  if (c.bAmp !== 0 && d < Math.abs(c.bAmp) * 4 && d > -Math.abs(c.bAmp) * 4) {
    d -= c.bAmp * bumpPattern(c.bKind, px * c.bFreq, py * c.bFreq, pz * c.bFreq);
  }
  return d;
}

// distance only: the hot loop for the voxel grid
function evalD(cs, x, y, z) {
  let d = BIG;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.op === 2 && c.raise === 0) continue;
    const bx = x - c.cx, by = y - c.cy, bz = z - c.cz;
    const bd = Math.sqrt(bx * bx + by * by + bz * bz) - c.R;
    if (c.op === 0) {
      if (bd > d + c.k) continue;
      const dp = primD(c, x, y, z);
      if (c.k > 0 && d < BIG) { const h = clamp01(0.5 + (0.5 * (dp - d)) / c.k); d = dp + (d - dp) * h - c.k * h * (1 - h); } else if (dp < d) d = dp;
    } else if (c.op === 1) {
      if (bd > c.k + 0.001) continue;
      const dp = primD(c, x, y, z);
      if (c.k > 0) { const h = clamp01(0.5 - (0.5 * (d + dp)) / c.k); d = d + (-dp - d) * h + c.k * h * (1 - h); } else d = Math.max(d, -dp);
    } else {
      if (bd > c.soft) continue;
      const dp = primD(c, x, y, z);
      const w = clamp01(0.5 - dp / (2 * c.soft));
      d -= c.raise * w * w * (3 - 2 * w);
    }
  }
  return d;
}

// distance plus surface attributes, used once per output vertex
const _a = new Float64Array(6); // r g b rough metal glow
function evalA(cs, x, y, z) {
  let d = BIG;
  _a[0] = _a[1] = _a[2] = 0.7; _a[3] = 0.8; _a[4] = 0; _a[5] = 0;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    const bx = x - c.cx, by = y - c.cy, bz = z - c.cz;
    const bd = Math.sqrt(bx * bx + by * by + bz * bz) - c.R;
    let w = -1; // weight of this prim's attributes
    if (c.op === 0) {
      if (bd > d + c.k) continue;
      const dp = primD(c, x, y, z);
      if (c.k > 0 && d < BIG) {
        const h = clamp01(0.5 + (0.5 * (dp - d)) / c.k);
        d = dp + (d - dp) * h - c.k * h * (1 - h);
        const hs = clamp01((h - 0.3) / 0.4); w = 1 - hs * hs * (3 - 2 * hs); // colours meet more sharply than shapes
      } else if (dp < d) { d = dp; w = 1; }
    } else if (c.op === 1) {
      if (bd > c.k + 0.001) continue;
      const dp = primD(c, x, y, z);
      let h;
      if (c.k > 0) { h = clamp01(0.5 - (0.5 * (d + dp)) / c.k); d = d + (-dp - d) * h + c.k * h * (1 - h); } else { h = -dp > d ? 1 : 0; d = Math.max(d, -dp); }
      if (c.hasCol) w = h;
    } else {
      if (bd > c.soft) continue;
      const dp = primD(c, x, y, z);
      const t = clamp01(0.5 - dp / (2 * c.soft));
      w = t * t * (3 - 2 * t);
      d -= c.raise * w;
    }
    if (w > 0) {
      let m = 1;
      if (c.tAmp) m = 1 + c.tAmp * (fbm3(_qx * c.tFreq, _qy * c.tFreq, _qz * c.tFreq, 2) - 0.5) * 2;
      _a[0] += (c.col[0] * m - _a[0]) * w; _a[1] += (c.col[1] * m - _a[1]) * w; _a[2] += (c.col[2] * m - _a[2]) * w;
      _a[3] += (c.rough - _a[3]) * w; _a[4] += (c.metal - _a[4]) * w; _a[5] += (c.glow - _a[5]) * w;
    }
  }
  return d;
}

// ---------- surface nets ----------
const CUBE_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const MAX_POINTS = 9e6;

function meshPrims(cs, res, aoStrength) {
  let x0 = BIG, y0 = BIG, z0 = BIG, x1 = -BIG, y1 = -BIG, z1 = -BIG, maxK = 0;
  for (const c of cs) {
    if (c.op !== 0) continue;
    x0 = Math.min(x0, c.cx - c.R); y0 = Math.min(y0, c.cy - c.R); z0 = Math.min(z0, c.cz - c.R);
    x1 = Math.max(x1, c.cx + c.R); y1 = Math.max(y1, c.cy + c.R); z1 = Math.max(z1, c.cz + c.R);
    maxK = Math.max(maxK, c.k);
  }
  if (x0 > x1) return null;
  let h = 1 / res;
  const pad = 2.5 * h;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  let nx, ny, nz;
  for (;;) {
    nx = Math.ceil((x1 - x0) / h) + 1; ny = Math.ceil((y1 - y0) / h) + 1; nz = Math.ceil((z1 - z0) / h) + 1;
    if (nx * ny * nz <= MAX_POINTS) break;
    h *= 1.15;
  }
  const vals = new Float32Array(nx * ny * nz);
  const sxy = nx * ny;
  // coarse blocks far from the surface are filled without sampling every point
  const B = 4, reach = (B + 1) * h * 0.87 * 1.25 + maxK * 0.5;
  for (let bz = 0; bz < nz; bz += B) for (let by = 0; by < ny; by += B) for (let bx = 0; bx < nx; bx += B) {
    const ex = Math.min(nx, bx + B), ey = Math.min(ny, by + B), ez = Math.min(nz, bz + B);
    const dc = evalD(cs, x0 + (bx + ex - 1) * 0.5 * h, y0 + (by + ey - 1) * 0.5 * h, z0 + (bz + ez - 1) * 0.5 * h);
    const far = Math.abs(dc) > reach;
    for (let k = bz; k < ez; k++) for (let j = by; j < ey; j++) {
      let o = k * sxy + j * nx + bx;
      for (let i = bx; i < ex; i++, o++) vals[o] = far ? dc : evalD(cs, x0 + i * h, y0 + j * h, z0 + k * h);
    }
  }

  const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
  const cellV = new Int32Array(cnx * cny * cnz).fill(-1);
  const pos = [];
  const corner = new Float32Array(8);
  const off = [0, 1, nx, nx + 1, sxy, sxy + 1, sxy + nx, sxy + nx + 1];
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
    const o = k * sxy + j * nx + i;
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = vals[o + off[c]]; corner[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = CUBE_EDGES[e][0], b = CUBE_EDGES[e][1];
      if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
      const t = corner[a] / (corner[a] - corner[b]);
      px += (a & 1) + t * ((b & 1) - (a & 1));
      py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
      pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
      n++;
    }
    cellV[k * cnx * cny + j * cnx + i] = pos.length / 3;
    pos.push(x0 + (i + px / n) * h, y0 + (j + py / n) * h, z0 + (k + pz / n) * h);
  }
  if (!pos.length) return null;

  const idx = [];
  const cstep = [1, cnx, cnx * cny];
  const dim = [cnx, cny, cnz], gstep = [1, nx, sxy];
  const ijk = [0, 0, 0];
  for (ijk[2] = 0; ijk[2] < cnz; ijk[2]++) for (ijk[1] = 0; ijk[1] < cny; ijk[1]++) for (ijk[0] = 0; ijk[0] < cnx; ijk[0]++) {
    const ci = ijk[2] * cstep[2] + ijk[1] * cstep[1] + ijk[0];
    if (cellV[ci] < 0) continue;
    const o = ijk[2] * sxy + ijk[1] * nx + ijk[0];
    const in0 = vals[o] < 0;
    for (let ax = 0; ax < 3; ax++) {
      const u = (ax + 1) % 3, v = (ax + 2) % 3;
      if (ijk[u] === 0 || ijk[v] === 0) continue;
      const in1 = vals[o + gstep[ax]] < 0;
      if (in0 === in1) continue;
      const a = cellV[ci], b = cellV[ci - cstep[u]], c = cellV[ci - cstep[u] - cstep[v]], d = cellV[ci - cstep[v]];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      if (in0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    }
  }
  void dim;

  const nv = pos.length / 3;
  const P = new Float32Array(pos), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3), M = new Float32Array(nv * 3);
  const eps = h * 0.5;
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    let gx = evalD(cs, x + eps, y, z) - evalD(cs, x - eps, y, z);
    let gy = evalD(cs, x, y + eps, z) - evalD(cs, x, y - eps, z);
    let gz = evalD(cs, x, y, z + eps) - evalD(cs, x, y, z - eps);
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    N[i * 3] = gx; N[i * 3 + 1] = gy; N[i * 3 + 2] = gz;
    evalA(cs, x, y, z);
    let ao = 1;
    if (aoStrength > 0) {
      // creases and armpits read darker: how much closer is the surface than open air would be?
      const d1 = evalD(cs, x + gx * 0.02, y + gy * 0.02, z + gz * 0.02);
      const d2 = evalD(cs, x + gx * 0.055, y + gy * 0.055, z + gz * 0.055);
      const d3 = evalD(cs, x + gx * 0.12, y + gy * 0.12, z + gz * 0.12);
      const occ = clamp01(((0.02 - d1) / 0.02) * 0.45 + ((0.055 - d2) / 0.055) * 0.35 + ((0.12 - d3) / 0.12) * 0.2);
      ao = 1 - occ * aoStrength;
    }
    C[i * 3] = _a[0] * ao; C[i * 3 + 1] = _a[1] * ao; C[i * 3 + 2] = _a[2] * ao;
    M[i * 3] = _a[3]; M[i * 3 + 1] = _a[4]; M[i * 3 + 2] = _a[5];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
  g.setIndex(nv > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

// ---------- hard-surface pieces ----------
class Hard {
  constructor(geo) {
    this.geo = geo; this.m = new THREE.Matrix4();
    this.col = [0.6, 0.6, 0.6]; this.rough = 0.6; this.metal = 0; this.glowV = 0; this.maxLod = 99; this.fn = null;
  }
  at(x, y, z) { this.m.premultiply(_m.makeTranslation(x, y, z)); return this; }
  /** DEGREES about X, then Y, then Z */
  rot(rx = 0, ry = 0, rz = 0) { this.m.premultiply(_m.makeRotationFromEuler(_e.set(rx * DEG, ry * DEG, rz * DEG, 'XYZ'))); return this; }
  scale(sx, sy = sx, sz = sx) { this.m.premultiply(_m.makeScale(sx, sy, sz)); return this; }
  color(hex) { this.col = asRgb(hex); return this; }
  pbr(rough, metal = 0) { this.rough = rough; this.metal = metal; return this; }
  glow(v = 1) { this.glowV = v; return this; }
  /** keep this piece only on detail levels <= n (0 = closest). Use for rivets, stitching, small trim. */
  lod(n) { this.maxLod = n; return this; }
  /** per-vertex colour: fn(x, y, z, nx, ny, nz) in the piece's own space -> hex | [r,g,b] | null (keep base) */
  shade(fn) { this.fn = fn; return this; }
  clone() { const c = Object.assign(new Hard(this.geo), this); c.m = this.m.clone(); c.col = this.col.slice(); return c; }
  mirrorX() { const c = this.clone(); c.m.premultiply(_m.makeScale(-1, 1, 1)); return c; }
}

const v2 = (pts) => pts.map(([x, y]) => new THREE.Vector2(x, y));
const v3 = (pts) => pts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
export const H = {
  /** box of full size w,h,d with bevelled edges */
  box: (w, h, d, bevel = 0.006) => new Hard(new RoundedBoxGeometry(w, h, d, 2, Math.min(bevel, w / 2, h / 2, d / 2))),
  sphere: (r, seg = 24) => new Hard(new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.66)))),
  /** cylinder along Y: top radius, bottom radius, height */
  cyl: (rt, rb, h, seg = 24, open = false) => new Hard(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  cone: (r, h, seg = 24) => new Hard(new THREE.ConeGeometry(r, h, seg)),
  capsule: (r, len, seg = 16) => new Hard(new THREE.CapsuleGeometry(r, Math.max(1e-4, len - 2 * r), 6, seg)),
  torus: (R, r, seg = 36, tube = 12, arc = Math.PI * 2) => new Hard(new THREE.TorusGeometry(R, r, tube, seg, arc)),
  /** surface of revolution about Y from a profile [[radius, y], ...] */
  lathe: (profile, seg = 36) => new Hard(new THREE.LatheGeometry(v2(profile), seg)),
  /** flat outline [[x, y], ...] extruded along Z by depth (centred), with a small bevel */
  extrude: (outline, depth, bevel = 0.004, holes = []) => {
    const sh = new THREE.Shape(v2(outline));
    for (const hole of holes) sh.holes.push(new THREE.Path(v2(hole)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 12 });
    g.translate(0, 0, -depth / 2);
    return new Hard(g);
  },
  /** tube through 3D points; radius may be a number or one radius per point (horns, ropes, tentacles) */
  tube: (pts, radius, tubular = Math.max(8, pts.length * 6), radial = 10, closed = false) => {
    const curve = new THREE.CatmullRomCurve3(v3(pts), closed);
    const g = new THREE.TubeGeometry(curve, tubular, 1, radial, closed);
    const rAt = (t) => {
      if (typeof radius === 'number') return radius;
      const f = t * (radius.length - 1), i = Math.min(radius.length - 2, Math.floor(f));
      return radius[i] + (radius[i + 1] - radius[i]) * (f - i);
    };
    const p = g.attributes.position, c = new THREE.Vector3();
    for (let i = 0; i <= tubular; i++) {
      curve.getPointAt(i / tubular, c);
      const r = rAt(i / tubular);
      for (let j = 0; j <= radial; j++) {
        const o = i * (radial + 1) + j;
        p.setXYZ(o, c.x + (p.getX(o) - c.x) * r, c.y + (p.getY(o) - c.y) * r, c.z + (p.getZ(o) - c.z) * r);
      }
    }
    return new Hard(g);
  },
  /** flexible sheet in the XY plane, w x h with sx x sy quads; warp(u, v) -> [dx, dy, dz] bends it (capes, sails, wings, banners) */
  sheet: (w, h, sx = 12, sy = 12, warp = null) => {
    const g = new THREE.PlaneGeometry(w, h, sx, sy);
    if (warp) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / w + 0.5, v = p.getY(i) / h + 0.5;
        const d = warp(u, v);
        p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
      }
      g.computeVertexNormals();
    }
    return new Hard(g);
  },
  /** any BufferGeometry you built yourself */
  geo: (g) => new Hard(g),
  mirrorX: (list) => [...list, ...list.map((p) => p.mirrorX())],
};

function bakeHard(hd, cs, aoStrength) {
  let g = hd.geo.index ? hd.geo.clone() : hd.geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const C = new Float32Array(n * 3), M = new Float32Array(n * 3);
  const p = g.attributes.position, nr = g.attributes.normal;
  for (let i = 0; i < n; i++) {
    let c = hd.col;
    if (hd.fn) { const r = hd.fn(p.getX(i), p.getY(i), p.getZ(i), nr.getX(i), nr.getY(i), nr.getZ(i)); if (r != null) c = asRgb(r); }
    C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2];
    M[i * 3] = hd.rough; M[i * 3 + 1] = hd.metal; M[i * 3 + 2] = hd.glowV;
  }
  g.applyMatrix4(hd.m);
  if (hd.m.determinant() < 0) { // mirrored: restore outward winding
    if (!g.index) { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  }
  if (cs && cs.length && aoStrength > 0) {
    // gear picks up contact shadow from the body it sits on
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      const d = evalD(cs, x + nx * 0.04, y + ny * 0.04, z + nz * 0.04);
      const ao = 1 - clamp01((0.03 - d) / 0.06) * aoStrength * 0.8;
      C[i * 3] *= ao; C[i * 3 + 1] *= ao; C[i * 3 + 2] *= ao;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
  if (!g.index) { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
  else if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
  return g;
}

/**
 * Mesh one part. part = { prims: [...], hard: [...] } (nested arrays are fine).
 * opts: res = cells per model unit for the sculpt (default 96), lod = detail level being built
 * (hard pieces with .lod(n) < lod are dropped), ao = crease darkening 0..1 (default 0.75).
 * Returns an indexed BufferGeometry with position, normal, color, aPbr; or null if the part is empty.
 */
export function buildPartGeometry(part, opts = {}) {
  const res = opts.res ?? 96, lod = opts.lod ?? 0, ao = opts.ao ?? 0.75;
  const cs = compile(part.prims || []);
  const list = [];
  if (cs.some((c) => c.op === 0)) {
    const g = meshPrims(cs, res, ao);
    if (g) { if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1)); list.push(g); }
  }
  for (const hd of (part.hard || []).flat(Infinity)) {
    if (!hd || hd.maxLod < lod) continue;
    if (lod >= 2 && hd.maxLod === 99 && hardRadius(hd) < 0.011 * lod) continue; // too small to see from this far
    list.push(bakeHard(hd, cs, ao));
  }
  if (!list.length) return null;
  const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (merged && merged.index && merged.attributes.position.count <= 65535) merged.setIndex(new THREE.BufferAttribute(Uint16Array.from(merged.index.array), 1));
  return merged;
}

function hardRadius(hd) {
  if (!hd.geo.boundingSphere) hd.geo.computeBoundingSphere();
  return hd.geo.boundingSphere.radius * hd.m.getMaxScaleOnAxis();
}

/** signed distance of a prim list at a point: handy for placing gear on a body */
export function distanceTo(prims, x, y, z) { return evalD(compile(prims), x, y, z); }

let _mat = null;
/** the one material every sculpted mesh shares: vertex colours with per-vertex roughness, metalness and glow */
export function sculptMaterial() {
  if (_mat) return _mat;
  _mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, side: THREE.DoubleSide, envMapIntensity: 0.75 });
  _mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPbr;\nvarying vec3 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = aPbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPbr;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vPbr.x, 0.05, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(vPbr.y, 0.0, 1.0);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vPbr.z;');
  };
  _mat.customProgramCacheKey = () => 'sculpt-pbr';
  return _mat;
}

/** convenience for static props: one mesh from a part */
export function sculptMesh(part, opts = {}) {
  const g = buildPartGeometry(part, opts);
  if (!g) return new THREE.Group();
  const m = new THREE.Mesh(g, sculptMaterial());
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
