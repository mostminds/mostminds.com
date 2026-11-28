// Hero work for the deck parts: the living and dead things sculpted through the sculpt pipeline (../sculpt.js), at
// three resolutions for the near detail levels and cached by shape, size and realm, so every ship of a design (and
// every design that shares the shape) meshes it once. deck.js draws its own simple shapes for the far levels.
//   const g3 = HI.trunk({ h, k, fat, bark }) -> [lv0, lv1, lv2] geometries in the part's local frame
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { S, H, noise3, cells3, rgb } from '../sculpt.js';
import { sculptL } from './deckKit.js';
import { getDetail } from '../rigkit.js';

// ---- hand-built organic forms (far cheaper than meshing a field for long, spread-out work) ----
const GEO = new Map();
const detailK = () => ({ low: 0.7, medium: 0.85, high: 1, ultra: 1.2 })[getDetail()] ?? 1;
/** cached three-level hand-built geometry: make(q) for q = 0, 1, 2 */
function handL(key, make) {
  const k = `${key}|${getDetail()}`;
  if (!GEO.has(k)) GEO.set(k, [0, 1, 2].map((q) => make(q)));
  return GEO.get(k);
}
const merge = (gs) => { const l = gs.filter(Boolean); return l.length === 1 ? l[0] : mergeGeometries(l.map((g) => (g.index ? g.toNonIndexed() : g)), false); };
/** finish attributes: colour per vertex from fn(i, x, y, z) -> [r, g, b], plus [rough, metal, glow] */
function paint(g, fn, pbr = [0.9, 0, 0]) {
  const P = g.attributes.position, n = P.count, C = new Float32Array(n * 3), M = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const c = fn(i, P.getX(i), P.getY(i), P.getZ(i)); C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2]; M[i * 3] = pbr[0]; M[i * 3 + 1] = pbr[1]; M[i * 3 + 2] = pbr[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
  return g;
}
/**
 * a barked limb along pts with a radius per point: furrowed bark (ridges running along it), knots, darker furrows.
 * q: 0 near .. 2 far. o: { col, amp (furrow depth as a fraction of the radius), nf (furrows per unit of girth), seed }
 */
function limbGeo(pts, radii, q, o) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const len = curve.getLength(), rmax = Math.max(...radii), dk = detailK();
  const tub = Math.max(4, Math.min(80, Math.round((len / ([0.035, 0.07, 0.15][q])) * dk)));
  const rs = Math.max(5, Math.min(36, Math.round(((2 * Math.PI * rmax) / [0.025, 0.05, 0.1][q]) * dk)));
  const g = new THREE.TubeGeometry(curve, tub, 1, rs, false);
  g.deleteAttribute('uv');
  const P = g.attributes.position, c = new THREE.Vector3(), base = rgb(o.col), seed = o.seed || 0, amp = o.amp ?? 0.12, nf = o.nf ?? 9;
  const rAt = (t) => { const f = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f)); return radii[i] + (radii[i + 1] - radii[i]) * (f - i); };
  const K = new Float32Array(P.count);
  for (let i = 0; i <= tub; i++) {
    const t = i / tub; curve.getPointAt(t, c);
    const r = rAt(t), nfur = Math.max(4, Math.round(nf * 2 * Math.PI * r));
    for (let j = 0; j <= rs; j++) {
      const k = i * (rs + 1) + j, th = (j / rs) * 2 * Math.PI;
      const w = noise3(t * len * 1.6 + seed, Math.cos(th) * 0.7, Math.sin(th) * 0.7);
      const fur = Math.pow(Math.abs(Math.sin(th * nfur * 0.5 + w * 3.2)), 0.6);
      const knot = noise3(t * len * 3 - seed, Math.cos(th) * 2, Math.sin(th) * 2);
      const rr = r * (1 - amp * (1 - fur) + (knot > 0.72 ? (knot - 0.72) * 0.6 : 0));
      P.setXYZ(k, c.x + (P.getX(k) - c.x) * rr, c.y + (P.getY(k) - c.y) * rr, c.z + (P.getZ(k) - c.z) * rr);
      K[k] = (0.62 + 0.42 * fur) * (0.9 + 0.2 * noise3(t * len * 5, th, seed)) * (knot > 0.75 ? 0.75 : 1);
    }
  }
  g.computeVertexNormals();
  // the seam column is doubled in a tube: give both copies the same normal
  const N = g.attributes.normal;
  for (let i = 0; i <= tub; i++) {
    const a = i * (rs + 1), b = a + rs;
    const x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b), l = Math.hypot(x, y, z) || 1;
    N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l);
  }
  return paint(g, (i) => [base[0] * K[i], base[1] * K[i], base[2] * K[i]], [0.95, 0, 0]);
}
/** a lumpy mass (leaf clump, flesh, stone) of radii rx, ry, rz: clumped relief, dark underside */
function blobGeo(rx, ry, rz, q, o) {
  const R = Math.max(rx, ry, rz), dk = detailK();
  const det = Math.max(1, Math.min(5, Math.round(Math.log2(Math.max(2, (R / [0.025, 0.05, 0.1][q]) * dk)))));
  let g = new THREE.IcosahedronGeometry(1, det); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-6);
  const P = g.attributes.position, base = rgb(o.col), seed = o.seed || 0, amp = o.amp ?? 0.12, f = o.freq ?? 3;
  const K = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const cl = 1 - Math.min(1, cells3(x * f + seed, y * f, z * f) * 1.3), n = noise3(x * f * 3 + seed, y * f * 3, z * f * 3);
    const d = 1 + amp * (cl - 0.5) + amp * 0.3 * (n - 0.5);
    P.setXYZ(i, x * rx * d, y * ry * d, z * rz * d);
    K[i] = (0.6 + 0.45 * cl + 0.1 * n) * (y < 0 ? 1 + y * 0.45 : 1);
  }
  g.computeVertexNormals();
  return paint(g, (i) => [base[0] * K[i], base[1] * K[i], base[2] * K[i]], o.pbr || [0.85, 0, 0]);
}
/** a rough-hewn stone of w x h x d (foot at y = 0, top narrowed by taper): chisel facets, weathering, lichen */
function rockGeo(w, h, d, q, o) {
  const st = [0.035, 0.07, 0.14][q] / detailK();
  let g = new THREE.BoxGeometry(1, 1, 1, Math.max(2, Math.ceil(w / st)), Math.max(2, Math.ceil(h / st)), Math.max(2, Math.ceil(d / st)));
  g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-6);
  const P = g.attributes.position, base = rgb(o.col), lich = rgb(o.lichen ?? 0x5a7a3a), seed = o.seed || 0, taper = o.taper ?? 0.2;
  const K = [];
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    // round the box a little (a pillow of stone), narrow it toward the top
    const l = Math.hypot(x * 1.2, y, z * 1.2), r = 0.5 + 0.12 * (1 - Math.min(1, l * 1.4));
    const t = 1 - taper * (y + 0.5);
    let X = x * w * t, Y = (y + 0.5) * h, Z = z * d * t;
    const cl = cells3(X * 4 + seed, Y * 4, Z * 4), n = noise3(X * 9 + seed, Y * 9, Z * 9);
    const dd = (Math.min(1, cl * 1.4) - 0.5) * 0.05 + (n - 0.5) * 0.025;
    const nx = x * 2, nz = z * 2, ny = y * 2, nl = Math.hypot(nx, ny, nz) || 1;
    if (Y > 0.01) { X += (nx / nl) * dd; Y += (ny / nl) * dd * 0.5; Z += (nz / nl) * dd; }
    P.setXYZ(i, X, Y, Z);
    const lk = Math.max(0, noise3(X * 3 - seed, Y * 2, Z * 3) - 0.58) * 3 * (1 - Math.min(1, Y / h));
    const k = 0.68 + 0.4 * (1 - Math.min(1, cl * 1.3)) + 0.12 * (n - 0.5);
    K.push([base[0] * k * (1 - lk) + lich[0] * lk, base[1] * k * (1 - lk) + lich[1] * lk, base[2] * k * (1 - lk) + lich[2] * lk]);
    void r;
  }
  g.computeVertexNormals();
  return paint(g, (i) => K[i], [0.95, 0, 0]);
}
const moved = (g, x, y, z, s = 1) => { g.applyMatrix4(new THREE.Matrix4().makeScale(s, s, s).setPosition(x, y, z)); return g; };

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 20) / 20;
const hsh = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const DEG = 180 / Math.PI;
const mix = (a, b, t) => { const A = [(a >> 16) & 255, (a >> 8) & 255, a & 255], B = [(b >> 16) & 255, (b >> 8) & 255, b & 255]; return (Math.round(A[0] + (B[0] - A[0]) * t) << 16) | (Math.round(A[1] + (B[1] - A[1]) * t) << 8) | Math.round(A[2] + (B[2] - A[2]) * t); };
const dk = (c, k) => mix(0, c, k);

/** a chain of blended capsules through pts with radii (a limb, a root, a bough) */
function limb(pts, rad, col, bump = null) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = S.capsule(pts[i], pts[i + 1], rad[i], rad[i + 1]).color(col).blend(0.05);
    if (bump) p.bump(...bump);
    out.push(p);
  }
  return out;
}

export const HI = {
  /** a rough-hewn stone (menhir, lintel, altar block), foot at the origin */
  rock(o) {
    const w = r2(o.w), h = r2(o.h), d = r2(o.d), col = o.col, taper = o.taper ?? 0.2;
    return handL(`rock|${w}|${h}|${d}|${col}|${taper}|${o.seed || 0}`, (q) => rockGeo(w, h, d, q, { col, taper, seed: o.seed || 0 }));
  },
  /** a living tree's trunk, root flares and boughs (the canopy is separate), foot at the origin */
  trunk(o) {
    const h = r1(o.h), k = r1(o.k), fat = o.fat || 1, bark = o.bark;
    return handL(`trunk|${h}|${k}|${fat}|${bark}`, (q) => {
      const gs = [];
      const T = [[0, -0.05, 0], [0.06, 0.25, 0.03], [-0.04, 0.5, -0.02], [0.03, 0.72, 0.02], [0, 0.84, 0]].map(([x, y, z]) => [x * k, y * h, z * k]);
      const R = [0.42, 0.3, 0.24, 0.19, 0.12].map((r, i) => r * k * (i < 3 ? fat : Math.sqrt(fat)));
      gs.push(limbGeo(T, R, q, { col: bark, amp: 0.14, nf: 7, seed: 1 }));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + hsh(i) * 0.4, ca = Math.cos(a), sa = Math.sin(a);
        gs.push(limbGeo([[ca * 0.1 * k, h * 0.16, sa * 0.1 * k], [ca * 0.4 * k * fat, h * 0.05, sa * 0.36 * k * fat], [ca * 0.95 * k * fat, -0.04, sa * 0.8 * k * fat]], [0.16 * k * fat, 0.11 * k * fat, 0.03 * k], q, { col: dk(bark, 0.92), amp: 0.12, nf: 9, seed: i + 3 }));
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.5, y0 = h * (0.45 + (i % 3) * 0.08), e = [Math.cos(a) * 1.05 * k, h * (0.72 + hsh(i) * 0.12), Math.sin(a) * 0.85 * k];
        gs.push(limbGeo([[0, y0 - 0.1, 0], [e[0] * 0.5, (y0 + e[1]) / 2 + 0.1, e[2] * 0.5], e, [e[0] * 1.25, e[1] + 0.25, e[2] * 1.25]], [0.14 * k, 0.09 * k, 0.05 * k, 0.015 * k], q, { col: bark, amp: 0.1, nf: 10, seed: i + 11 }));
      }
      return merge(gs);
    });
  },
  /** a living tree's crown of leaf masses round its centre (the origin), radius about 1.2 k */
  canopy(o) {
    const k = r1(o.k), h = r1(o.h), leaf = o.leaf;
    return handL(`canopy|${h}|${k}|${leaf}`, (q) => {
      const gs = [], blobs = [[0, 0.92, 0, 1.0], [0.8, 0.8, 0.35, 0.75], [-0.72, 0.82, -0.3, 0.8], [0.25, 0.78, -0.75, 0.72], [-0.3, 0.8, 0.72, 0.72], [0, 1.12, 0, 0.7], [0.5, 1.0, -0.3, 0.55], [-0.45, 1.02, 0.25, 0.55]];
      blobs.forEach(([x, y, z, r], i) => {
        const px = x * k, py = y * h - h * 0.7, pz = z * k, col = mix(dk(leaf, 0.8), leaf, 0.5 + hsh(i) * 0.5);
        gs.push(moved(blobGeo(r * k, r * k * 0.8, r * k, q, { col, amp: 0.22, freq: 2.6 / k, seed: i * 3 }), px, py, pz));
        if (q < 2) for (let j = 0; j < 3; j++) { const a = j * 2.2 + i, b = (j / 3) * 1.2 - 0.2; gs.push(moved(blobGeo(r * k * 0.45, r * k * 0.36, r * k * 0.45, q + 1, { col: mix(col, 0xffffff, 0.08), amp: 0.25, freq: 5 / k, seed: i * 7 + j }), px + Math.cos(a) * Math.cos(b) * r * k * 0.85, py + Math.sin(b) * r * k * 0.7, pz + Math.sin(a) * Math.cos(b) * r * k * 0.85)); }
      });
      return merge(gs);
    });
  },
  /** a dead tree: gnarled trunk and bare boughs (path list from deck.js), foot at the origin */
  deadTrunk(o) {
    const h = r1(o.h), k = r1(o.k), bark = o.bark;
    return handL(`dead|${h}|${k}|${bark}|${o.boughs.length}`, (q) => {
      const gs = [];
      const T = [[0, -0.05, 0], [0.12, 0.3, 0.05], [-0.08, 0.6, 0], [0.05, 0.85, 0.06], [0, 1, 0]].map(([x, y, z]) => [x * k, y * h, z * k]);
      gs.push(limbGeo(T, [0.3, 0.22, 0.16, 0.1, 0.03].map((r) => r * k), q, { col: bark, amp: 0.2, nf: 6, seed: 2 }));
      for (let i = 0; i < 5; i++) { const a = i * 1.3; gs.push(limbGeo([[0, 0.3, 0], [Math.cos(a) * 0.4 * k, 0.05, Math.sin(a) * 0.35 * k], [Math.cos(a) * 0.78 * k, -0.04, Math.sin(a) * 0.68 * k]], [0.13 * k, 0.07 * k, 0.02 * k], q, { col: dk(bark, 0.9), amp: 0.18, nf: 8, seed: i + 5 })); }
      o.boughs.forEach(([a, b, e], i) => {
        gs.push(limbGeo([[a[0], a[1] - 0.08, a[2]], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.15, (a[2] + b[2]) / 2], b, e], [0.1 * k, 0.07 * k, 0.04 * k, 0.012 * k], q, { col: bark, amp: 0.16, nf: 9, seed: i + 21 }));
        gs.push(limbGeo([b, [b[0] + 0.15, b[1] + 0.3, b[2] - 0.1], [b[0] + 0.3, b[1] + 0.45, b[2] - 0.2]], [0.035 * k, 0.02 * k, 0.006 * k], q, { col: bark, amp: 0.1, nf: 10, seed: i + 41 }));
        for (let j = 0; j < 3 && q < 2; j++) gs.push(limbGeo([e, [e[0] + (hsh(j + i) - 0.5) * 0.4, e[1] + 0.2 + hsh(j) * 0.2, e[2] + (hsh(j * 3 + i) - 0.5) * 0.4]], [0.012 * k, 0.003], q + 1, { col: bark, amp: 0.05, seed: j }));
      });
      return merge(gs);
    });
  },
  /** a great nest of woven sticks, radius r, its floor at the origin */
  nest(o) {
    const r = r2(o.r), col = o.col;
    return handL(`nest|${r}|${col}`, (q) => {
      const gs = [];
      // the bowl: a ring of woven sticks, each a thin bark limb looping round
      const n = [28, 16, 8][q];
      for (let i = 0; i < n; i++) {
        const y = r * (0.04 + (i / n) * 0.42), rr = r * (0.55 + Math.sin((i / n) * Math.PI) * 0.4), a0 = hsh(i) * 6.28, sweep = 2.2 + hsh(i + 1) * 1.5;
        const pts = []; for (let j = 0; j <= 6; j++) { const a = a0 + (sweep * j) / 6; pts.push([Math.cos(a) * rr * (1 + (hsh(i + j) - 0.5) * 0.12), y + (hsh(i * 3 + j) - 0.5) * 0.08 * r, Math.sin(a) * rr * (1 + (hsh(i * 2 + j) - 0.5) * 0.12)]); }
        gs.push(limbGeo(pts, [0.03 * r + 0.012, 0.025 * r + 0.01], Math.min(2, q + 1), { col: mix(col, i % 3 ? 0x9a7a52 : 0x3a2a1a, 0.35), amp: 0.08, nf: 20, seed: i }));
      }
      // the floor of the bowl and the long sticks poking out
      gs.push(moved(blobGeo(r * 0.72, r * 0.16, r * 0.72, q, { col: dk(col, 0.6), amp: 0.25, freq: 6 / r, seed: 4 }), 0, r * 0.1, 0));
      for (let i = 0; i < [14, 8, 0][q]; i++) {
        const a = (i / 14) * Math.PI * 2 + hsh(i) * 0.3, y = r * (0.1 + hsh(i + 3) * 0.3), l = r * (0.6 + hsh(i + 7) * 0.5), t = a + Math.PI / 2 + (hsh(i + 9) - 0.5) * 1.2;
        const x0 = Math.cos(a) * r * 0.85, z0 = Math.sin(a) * r * 0.85;
        gs.push(limbGeo([[x0 - Math.cos(t) * l / 2, y, z0 - Math.sin(t) * l / 2], [x0, y + (hsh(i) - 0.5) * 0.08 * r, z0], [x0 + Math.cos(t) * l / 2, y + (hsh(i + 1) - 0.5) * 0.1, z0 + Math.sin(t) * l / 2]], [0.022 * r + 0.008, 0.012 * r + 0.004], 2, { col: mix(col, 0x2a1a0a, hsh(i) * 0.5), amp: 0.05, seed: i + 50 }));
      }
      for (let i = 0; i < 3; i++) gs.push(moved(blobGeo(r * 0.13, r * 0.18, r * 0.13, q, { col: i ? 0xe8e0c8 : 0xc8d8e0, amp: 0.02, freq: 9, pbr: [0.4, 0, 0] }), (hsh(i) - 0.5) * r * 0.5, r * 0.3, (hsh(i + 4) - 0.5) * r * 0.5));
      return merge(gs);
    });
  },
  /** a skull (facing +x), radius about s * 0.13, its jaw at the origin */
  skull(o = {}) {
    const s = r2(o.s ?? 1), col = o.col ?? 0xf4f0e6, horns = !!o.horns;
    return sculptL(`skull|${s}|${col}|${horns}`, () => {
      const p = [
        S.ellipsoid(0.13 * s, 0.12 * s, 0.115 * s).at(-0.01 * s, 0.15 * s, 0).color(col).bump(0.003 * s, 30 / s, 'noise').tint(0.12, 9 / s),
        S.ellipsoid(0.07 * s, 0.06 * s, 0.085 * s).at(0.08 * s, 0.07 * s, 0).color(col).blend(0.04 * s),
        S.box(0.06 * s, 0.05 * s, 0.1 * s, 0.015 * s).at(0.085 * s, 0.015 * s, 0).color(col).blend(0.03 * s),
        S.ellipsoid(0.03 * s, 0.03 * s, 0.03 * s).at(0.04 * s, 0.11 * s, 0.11 * s).color(col).blend(0.03 * s),
        S.ellipsoid(0.03 * s, 0.03 * s, 0.03 * s).at(0.04 * s, 0.11 * s, -0.11 * s).color(col).blend(0.03 * s),
        // sockets, nose and the teeth line
        S.sphere(0.034 * s).at(0.12 * s, 0.12 * s, 0.045 * s).color(0x1a1410).cut(0.012 * s),
        S.sphere(0.034 * s).at(0.12 * s, 0.12 * s, -0.045 * s).color(0x1a1410).cut(0.012 * s),
        S.cone(0.018 * s, 0.004 * s, 0.04 * s).rot(0, 0, 0).at(0.135 * s, 0.07 * s, 0).color(0x1a1410).cut(0.008 * s),
        S.box(0.02 * s, 0.006 * s, 0.09 * s, 0.002 * s).at(0.118 * s, 0.03 * s, 0).color(0x3a3020).cut(0.002 * s),
      ];
      if (horns) for (const z of [-1, 1]) p.push(limb([[0, 0.2 * s, z * 0.08 * s], [-0.02 * s, 0.3 * s, z * 0.18 * s], [0.06 * s, 0.42 * s, z * 0.22 * s], [0.14 * s, 0.46 * s, z * 0.18 * s]], [0.035 * s, 0.028 * s, 0.016 * s, 0.004 * s], 0x3a2a20, [0.003 * s, 50 / s, 'ridges']));
      return { prims: p };
    }, 50);
  },
  /** a long bone (along +x) of length l */
  bone(o = {}) {
    const l = r2(o.l ?? 0.5), col = o.col ?? 0xd8cfb4;
    return sculptL(`bone|${l}|${col}`, () => {
      const r = l * 0.07;
      return { prims: [S.capsule([-l / 2, 0, 0], [l / 2, 0, 0], r, r * 0.9).color(col).tint(0.1, 12),
        S.sphere(r * 1.7).at(-l / 2, 0, r * 0.8).color(col).blend(r), S.sphere(r * 1.6).at(-l / 2, 0, -r * 0.8).color(col).blend(r),
        S.sphere(r * 1.6).at(l / 2, r * 0.6, 0).color(col).blend(r), S.sphere(r * 1.5).at(l / 2, -r * 0.6, 0).color(col).blend(r)] };
    }, Math.max(40, 22 / l));
  },
  /** a ribcage (spine along +x), length l */
  ribs(o = {}) {
    const l = r2(o.l ?? 0.8), col = o.col ?? 0xd8cfb4;
    return sculptL(`ribs|${l}|${col}`, () => {
      const p = [S.capsule([-l / 2, 0, 0], [l / 2, 0.03, 0], l * 0.045, l * 0.035).color(col).bump(l * 0.012, 14 / l, 'ridges').rot(0, 0, 90)];
      p[0] = S.capsule([-l / 2, 0, 0], [l / 2, 0.03, 0], l * 0.045, l * 0.035).color(col);
      for (let i = 0; i < 6; i++) {
        const x = -l * 0.35 + i * l * 0.13, w = l * (0.28 - Math.abs(i - 2.5) * 0.03);
        for (const z of [-1, 1]) p.push(limb([[x, 0, 0], [x + l * 0.03, -w * 0.3, z * w * 0.8], [x + l * 0.06, -w * 0.95, z * w * 0.9], [x + l * 0.08, -w * 1.35, z * w * 0.45]], [l * 0.022, l * 0.02, l * 0.016, l * 0.01], col));
      }
      return { prims: p };
    }, Math.max(36, 22 / l));
  },
  /** a carved totem drum: one face (facing +x) of height hh, radius rr, painted col with trim */
  totemFace(o) {
    const hh = r2(o.h), rr = r2(o.r), wood = o.wood, col = o.col, kind = o.kind || 0;
    return sculptL(`totem|${hh}|${rr}|${wood}|${col}|${kind}`, () => {
      const p = [S.cyl(rr, hh, rr * 0.15).at(0, hh / 2, 0).color(wood).bump(0.006, 12, 'fur').tint(0.15, 6)];
      const y = hh * 0.55, f = rr;
      // brow, eyes, nose, mouth and cheeks carved and painted
      p.push(S.ellipsoid(f * 0.25, f * 0.1, f * 0.8).at(f * 0.95, y + hh * 0.16, 0).color(col).blend(0.03));
      for (const z of [-1, 1]) {
        p.push(S.ellipsoid(f * 0.18, f * 0.16, f * 0.2).at(f * 0.98, y + hh * 0.05, z * f * 0.36).color(0xf0e8d0).cut(0.01));
        p.push(S.sphere(f * 0.09).at(f * 0.86, y + hh * 0.05, z * f * 0.36).color(0x141010).blend(0.01));
        p.push(S.ellipsoid(f * 0.12, f * 0.22, f * 0.12).at(f * 0.88, y - hh * 0.12, z * f * 0.6).color(col).blend(0.03));
      }
      p.push(S.cone(f * 0.17, f * 0.05, f * 0.35).rot(0, 0, -90).at(f * 1.12, y - hh * 0.04, 0).color(wood).blend(0.03));
      p.push(S.ellipsoid(f * 0.2, f * 0.12, f * 0.55).at(f * 0.98, y - hh * 0.28, 0).color(0x2a0a08).cut(0.02));
      if (kind % 2) for (const z of [-1, 1]) p.push(S.cone(f * 0.05, f * 0.005, f * 0.16).at(f * 1.02, y - hh * 0.24, z * f * 0.22).color(0xf0e8d0).blend(0.005));
      // the bands top and bottom
      p.push(S.torus(rr * 1.02, hh * 0.04).at(0, hh * 0.04, 0).color(col).blend(0.02), S.torus(rr * 1.02, hh * 0.035).at(0, hh * 0.96, 0).color(col).blend(0.02));
      return { prims: p };
    }, 34);
  },
  /** a crouching gargoyle on a block, facing +x, height about 0.55 s */
  gargoyle(o) {
    const s = r2(o.s ?? 1), stone = o.stone, eye = o.eye;
    return sculptL(`garg|${s}|${stone}|${eye}`, () => {
      const p = [];
      const st = (q) => q.color(stone).bump(0.004 * s, 22 / s, 'rock').tint(0.15, 8 / s);
      p.push(st(S.ellipsoid(0.13 * s, 0.16 * s, 0.11 * s).at(0, 0.2 * s, 0).rot(0, 0, -25)));
      p.push(st(S.sphere(0.075 * s).at(0.12 * s, 0.36 * s, 0)).blend(0.03 * s));
      p.push(st(S.ellipsoid(0.07 * s, 0.035 * s, 0.05 * s).at(0.19 * s, 0.33 * s, 0)).blend(0.02 * s));
      p.push(S.box(0.06 * s, 0.01 * s, 0.07 * s, 0.003 * s).at(0.22 * s, 0.32 * s, 0).color(0x1a1410).cut(0.004 * s));
      for (const z of [-1, 1]) {
        p.push(S.sphere(0.018 * s).at(0.18 * s, 0.39 * s, z * 0.035 * s).color(eye).glow(1.4).blend(0.005 * s));
        p.push(limb([[0.09 * s, 0.42 * s, z * 0.04 * s], [0.05 * s, 0.5 * s, z * 0.06 * s], [0.0, 0.53 * s, z * 0.05 * s]], [0.02 * s, 0.012 * s, 0.004 * s], stone));
        // haunches, forelegs and claws
        p.push(st(S.ellipsoid(0.08 * s, 0.07 * s, 0.05 * s).at(-0.02 * s, 0.09 * s, z * 0.09 * s)).blend(0.03 * s));
        p.push(limb([[0.08 * s, 0.22 * s, z * 0.07 * s], [0.12 * s, 0.1 * s, z * 0.07 * s], [0.14 * s, 0.02 * s, z * 0.07 * s]], [0.03 * s, 0.022 * s, 0.018 * s], stone));
        // folded wing
        p.push(st(S.ellipsoid(0.03 * s, 0.17 * s, 0.1 * s).at(-0.08 * s, 0.32 * s, z * 0.1 * s).rot(z * 15, 0, 20)).blend(0.02 * s));
        p.push(limb([[-0.05 * s, 0.32 * s, z * 0.1 * s], [-0.1 * s, 0.48 * s, z * 0.16 * s], [-0.16 * s, 0.52 * s, z * 0.14 * s]], [0.016 * s, 0.012 * s, 0.004 * s], stone));
      }
      p.push(limb([[-0.1 * s, 0.08 * s, 0], [-0.2 * s, 0.05 * s, 0.05 * s], [-0.24 * s, 0.1 * s, 0.1 * s]], [0.025 * s, 0.015 * s, 0.006 * s], stone));
      p.push(S.box(0.32 * s, 0.05 * s, 0.26 * s, 0.01 * s).at(0, 0.0, 0).color(stone).blend(0.01 * s));
      return { prims: p };
    }, 52);
  },
  /** a pustule (blister of flesh with a glowing core), radius r, on a wall facing +z */
  pustule(o) {
    const r = r2(o.r), flesh = o.flesh, goo = o.goo;
    return sculptL(`pus|${r}|${flesh}|${goo}`, () => {
      const p = [S.ellipsoid(r * 1.3, r * 1.2, r * 0.6).color(flesh).bump(0.012 * r, 9 / r, 'noise').tint(0.25, 4 / r),
        S.ellipsoid(r * 0.9, r * 0.85, r * 0.75).at(0, 0, r * 0.35).color(goo).glow(0.9).pbr(0.2).blend(0.1 * r),
        S.sphere(r * 0.22).at(r * 0.2, r * 0.3, r * 0.95).color(0xffffc0).glow(1.4).pbr(0.15).blend(0.04 * r)];
      for (let i = 0; i < 5; i++) { const a = i * 1.25; p.push(limb([[Math.cos(a) * r, Math.sin(a) * r, r * 0.2], [Math.cos(a + 0.3) * r * 1.8, Math.sin(a + 0.3) * r * 1.7, r * 0.05], [Math.cos(a + 0.5) * r * 2.6, Math.sin(a + 0.5) * r * 2.4, 0]], [0.06 * r, 0.045 * r, 0.02 * r], 0x5a3a4a)); }
      return { prims: p };
    }, Math.max(28, 8 / r));
  },
};
