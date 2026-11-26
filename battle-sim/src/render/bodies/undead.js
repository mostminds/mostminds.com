// The walking dead: skeleton warrior, skeleton archer and the Bone Colossus.
//
//   bodies.skeleton(def, o) -> rig description for rigkit.assemble()
//       skeleton        sword and round shield, dented spangenhelm with a torn mail curtain, half a mail shirt, tabard rags
//       skeletonArcher  longbow, ragged hood and mantle, quiver and strap, bracer, kilt, an old arrow between the ribs
//       boneColossus    (def.id, or model.scale > 1.8) a construct lashed together from many skeletons, greataxe in both hands
//   animators           `skeleton.<hold>[.shield]` and `colossus.<hold>`: the stock biped walks, sways and falls; the
//                       hands are posed here (see "Animation" at the end of the file)
//
// A skeleton is built bone by bone. The big organic masses (skull, pelvis, vertebrae, the knobbed ends of the long
// bones) are sculpted; everything too thin for the sculpt grid (ribs, finger and toe bones, teeth, spinous processes,
// the paired forearm bones, mail and cloth) is swept geometry made here, so it stays crisp close up and can hand over
// to something cheaper far away. The human-sized pair are built at life size and then enlarged by BUILD.
//
// Detail tiers (the game shows a unit at level 2 or 3 most of the time, so these matter as much as the close-up):
//   .lod(1)        fine pieces: the two closest levels          paired with a stand-in flagged .from(2)
//   .near()        mid-weight pieces: every level but the last  paired with a stand-in flagged .far()
//   .from(2).near()  the colossus' middle tier of pre-sculpted parts (only presets with four levels have one)
// Stand-ins are a little fatter than life (farBone) so that thin bones neither vanish nor shimmer at distance; the
// skull nodes set minRes so the face survives the last level.
//
// Rig nodes: root, pelvis, legL, shinL, legR, shinR, torso, cage (ribs and what is worn over them), head, jaw,
// armL, foreL, handL, armR, foreR, handR, weaponR (child of handR, weapon frame, rig list `weapon`) and shieldL
// (child of foreL, shield frame, rig list `shield`). Hands are rig list `hands`. The archer's bow carries stringU and
// stringL (rig list `string`) and arrow (rig list `arrow`); the colossus adds `rack` (rig list `rack`): the trophy
// poles on its back. The torso node pivots on the lumbosacral joint and the head on the atlas, so the spine never
// opens when they turn. Plain values on the description ride along on the rig: hold, build, pass (archer), grip2 (colossus).
import * as THREE from 'three';
import { S, H, rgb, fbm3, noise3, buildPartGeometry } from '../sculpt.js';
import { weapon as makeWeapon, shield as makeShield } from './weapons.js';
import * as HUM from './humanoid.js';
import { DETAIL, getDetail } from '../rigkit.js';

const DEG = Math.PI / 180;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const cosEase = (t) => (1 - Math.cos(Math.PI * clamp(t))) / 2;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => mul3(a, 1 / (len3(a) || 1e-9));
const flat = (x) => [x].flat(Infinity).filter(Boolean);
const mirrorAll = (list) => flat(list).map((p) => p.mirrorX());
const both = (list) => { const l = flat(list); return [...l, ...l.map((p) => p.mirrorX())]; };

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- palette ----------
const BONE = 0xc6b78e, BONE_HI = 0xe2d7b6, BONE_LO = 0x86724c, STAIN = 0x5e4e34, GRISTLE = 0x5e4630, SOCKET = 0x120d0a, TOOTH = 0xe6dcb6;
const RUST = 0x7c563e, IRON = 0x4c4a4c;
const FAR_BONE = 0xbdae86;   // the stand-ins seen from far away: a touch brighter than shaded bone, which crease shading darkens
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const mix = (a, b, t) => _c1.set(a).lerp(_c2.set(b), t).getHex();

/** aged bone for sculpted prims: mottled, slightly glossy */
const bone = (p, amp = 0.28) => p.color(BONE).tint(amp, 22).pbr(0.62);
/** soil stains soaked into sculpted bone at the given points */
const age = (pts, r = 0.02, t = 0.5) => pts.map((q) => S.sphere(r).at(q[0], q[1], q[2]).color(mix(BONE, STAIN, t)).pbr(0.75).paint(r * 0.8, 0));
/** the same look for swept pieces: mottle, grave-soil stains, and a darker tone toward `dark` (a point list) */
function boneShade(seed = 0, base = BONE, stain = STAIN, amp = 0.26) {
  const c = rgb(base), d = rgb(stain);
  return (x, y, z) => {
    const m = 1 + amp * (fbm3(x * 24 + seed, y * 24 - seed * 0.7, z * 24 + seed * 1.3, 2) - 0.5) * 2;
    const s = sstep(0.42, 0.72, fbm3(x * 7.5 - seed, y * 7.5 + seed * 2, z * 7.5, 2)) * 0.55;
    return [lerp(c[0] * m, d[0], s), lerp(c[1] * m, d[1], s), lerp(c[2] * m, d[2], s)];
  };
}

// ---------- swept geometry ----------
/** a growing triangle soup; every builder below appends to one of these */
class MB {
  constructor() { this.p = []; this.i = []; this.c = []; }
  get n() { return this.p.length / 3; }
  get empty() { return this.i.length === 0; }
  /** move every vertex added since `from` by a Matrix4 */
  transform(mat, from = 0) { const v = new THREE.Vector3(); for (let j = from * 3; j < this.p.length; j += 3) { v.set(this.p[j], this.p[j + 1], this.p[j + 2]).applyMatrix4(mat); this.p[j] = v.x; this.p[j + 1] = v.y; this.p[j + 2] = v.z; } return this; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
  /** as a hard piece. If every vertex was given a colour as it was added, those colours are baked exactly (sculpt.js shades vertices in order) */
  hard() {
    const h = H.geo(this.geo()), c = this.c, n = this.n;
    if (c.length === n * 3 && n) { let k = 0; h.shade(() => { const j = (k++ % n) * 3; return [c[j], c[j + 1], c[j + 2]]; }); }
    return h;
  }
}
const radiusAt = (rad, t, i) => (typeof rad === 'function' ? rad(t, i) : Array.isArray(rad) ? rad[i] : rad);

/**
 * Tube through `pts` with an elliptical section. rad: number | per-point list | fn(t, i); each entry a number or
 * [ra, rb] with ra along the `up` hint (made perpendicular to the path) and rb across it.
 * o: radial (sides), up ([x,y,z] | fn(t)), caps (default true), phase.
 */
function sweep(m, pts, rad, o = {}) {
  const n = o.radial ?? 8, k = pts.length, base = m.n, ph = o.phase ?? 0;
  let prev = null;
  for (let i = 0; i < k; i++) {
    const p = pts[i], t = norm3(sub3(pts[Math.min(k - 1, i + 1)], pts[Math.max(0, i - 1)]));
    let h = typeof o.up === 'function' ? o.up(i / (k - 1)) : o.up || prev || (Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
    let a = sub3(h, mul3(t, dot3(h, t)));
    if (len3(a) < 1e-5) a = cross3(t, Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
    a = norm3(a);
    const b = cross3(t, a);
    prev = a;
    const r = radiusAt(rad, i / (k - 1), i), ra = Array.isArray(r) ? r[0] : r, rb = Array.isArray(r) ? r[1] : r;
    const cl = o.col ? o.col(i / (k - 1), p) : null;
    for (let j = 0; j < n; j++) {
      const th = (j / n) * Math.PI * 2 + ph, cs = Math.cos(th) * ra, sn = Math.sin(th) * rb;
      m.p.push(p[0] + a[0] * cs + b[0] * sn, p[1] + a[1] * cs + b[1] * sn, p[2] + a[2] * cs + b[2] * sn);
      if (cl) m.c.push(cl[0], cl[1], cl[2]);
    }
  }
  for (let i = 0; i < k - 1; i++) for (let j = 0; j < n; j++) {
    const j1 = (j + 1) % n, A = base + i * n + j, B = base + i * n + j1, C = A + n, D = B + n;
    m.i.push(A, B, C, B, D, C);
  }
  if (o.caps !== false) {
    const c0 = m.n; m.p.push(...pts[0]);
    const c1 = m.n; m.p.push(...pts[k - 1]);
    if (o.col) m.c.push(...o.col(0, pts[0]), ...o.col(1, pts[k - 1]));
    const e = base + (k - 1) * n;
    for (let j = 0; j < n; j++) { const j1 = (j + 1) % n; m.i.push(c0, base + j1, base + j, c1, e + j, e + j1); }
  }
  return m;
}
/** a flat two-sided strip along pts, `hw` wide either side of the path along the `up` hint: the far-away stand-in for a rib */
function ribbon(m, pts, hw, up = [0, 1, 0]) {
  const k = pts.length, base = m.n;
  for (let i = 0; i < k; i++) {
    const p = pts[i], t = norm3(sub3(pts[Math.min(k - 1, i + 1)], pts[Math.max(0, i - 1)]));
    const a = norm3(sub3(up, mul3(t, dot3(up, t)))), w = radiusAt(hw, i / (k - 1), i);
    m.p.push(p[0] + a[0] * w, p[1] + a[1] * w, p[2] + a[2] * w, p[0] - a[0] * w, p[1] - a[1] * w, p[2] - a[2] * w);
  }
  for (let i = 0; i < k - 1; i++) { const A = base + i * 2; m.i.push(A, A + 1, A + 2, A + 1, A + 3, A + 2); }
  return m;
}
/** smooth a polyline: `count` points along a centripetal spline through pts */
function spline(pts, count) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  return c.getSpacedPoints(count - 1).map((v) => [v.x, v.y, v.z]);
}
const DOG = [[0, 0.55], [0.08, 1.12], [0.26, 0.78], [0.76, 0.76], [0.92, 1.1], [1, 0.55]];
/** a small bone from a to b: slim waist, knuckled ends */
function dogbone(m, a, b, r, radial = 6, prof = DOG) {
  return sweep(m, prof.map(([t]) => lerp3(a, b, t)), prof.map(([, k]) => r * k), { radial });
}
/** a chain of small bones through pts (finger, toe, tail) */
function digit(m, pts, radii, radial = 6) {
  for (let i = 0; i < pts.length - 1; i++) dogbone(m, pts[i], pts[i + 1], Array.isArray(radii) ? radii[i] : radii, radial);
  return m;
}
/** tapered spike from a to b */
function spike(m, a, b, ra, rb = ra * 0.25, radial = 5, up) {
  return sweep(m, [a, lerp3(a, b, 0.55), b], [ra, lerp(ra, rb, 0.6), rb * 0.4], { radial, up });
}
/** thin plate: a fan over a 3D outline, `th` thick along n */
function slab(m, outline, n, th, bulge = 0) {
  const k = outline.length, base = m.n, c = mul3(outline.reduce(add3, [0, 0, 0]), 1 / k), h = mul3(n, th / 2);
  for (const sg of [1, -1]) {
    for (const p of outline) m.p.push(p[0] + h[0] * sg, p[1] + h[1] * sg, p[2] + h[2] * sg);
    m.p.push(c[0] + h[0] * sg + n[0] * bulge, c[1] + h[1] * sg + n[1] * bulge, c[2] + h[2] * sg + n[2] * bulge);
  }
  const f = base, bk = base + k + 1;
  for (let j = 0; j < k; j++) {
    const j1 = (j + 1) % k;
    m.i.push(f + k, f + j, f + j1, bk + k, bk + j1, bk + j, f + j, bk + j, f + j1, f + j1, bk + j, bk + j1);
  }
  return m;
}
/** ragged cloth: a w x h grid hanging from its top edge, bent by warp(u, v) -> [x, y, z] and holed where keep(u, v) is false (v = 0 at the top) */
function cloth(m, sx, sy, warp, keep, tint, net = false) {
  const base = m.n;
  for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) { const q = warp(i / sx, j / sy, i, j); m.p.push(q[0], q[1], q[2]); if (tint) m.c.push(...tint(i, j, q)); }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    if (keep && !keep((i + 0.5) / sx, (j + 0.5) / sy)) continue;
    const A = base + j * (sx + 1) + i, B = A + 1, C = A + sx + 1, D = C + 1;
    // net: split every quad along the diagonal that joins its two odd corners, so those corners link up into a lattice (ring mail)
    if (net && ((i + j) & 1)) m.i.push(A, C, D, A, D, B); else m.i.push(A, C, B, B, C, D);
  }
  return m;
}

/** surface of revolution about Y from a profile [[r, y], ...]; map(x, y, z) -> [x, y, z] places and distorts it */
function lathe(m, prof, seg, map = (x, y, z) => [x, y, z], arc = Math.PI * 2, a0 = 0) {
  const base = m.n, k = prof.length, full = arc >= Math.PI * 2 - 1e-6, cols = full ? seg : seg + 1;
  for (let i = 0; i < k; i++) for (let j = 0; j < cols; j++) { const th = a0 + (j / seg) * arc; m.p.push(...map(prof[i][0] * Math.cos(th), prof[i][1], prof[i][0] * Math.sin(th))); }
  for (let i = 0; i < k - 1; i++) for (let j = 0; j < (full ? seg : seg); j++) {
    const j1 = full ? (j + 1) % seg : j + 1, A = base + i * cols + j, B = base + i * cols + j1, C = A + cols, D = B + cols;
    m.i.push(A, B, C, B, D, C);
  }
  return m;
}
/** append a small faceted bead (rivet, knot, link) at c */
function bead(m, c, r, seg = 6) {
  return lathe(m, [[0.001, r], [r * 0.7, r * 0.7], [r, 0], [r * 0.7, -r * 0.7], [0.001, -r]], seg, (x, y, z) => [c[0] + x, c[1] + y, c[2] + z]);
}
const smooth2 = (pts, n) => spline(pts.map(([x, y]) => [x, y, 0]), n).map((q) => [q[0], q[1]]);

/** rusted iron for swept pieces: dark metal, orange bloom, deep brown pits */
function rustShade(seed = 0, base = IRON, amount = 0.5) {
  const b = rgb(base), r1 = rgb(0x70452c), r2 = rgb(0x3a2418), hi = rgb(0x8e8c8a);
  return (x, y, z, nx, ny) => {
    const n = fbm3(x * 42 + seed, y * 42 - seed, z * 42 + seed * 0.3, 3), big = fbm3(x * 12 - seed, y * 12 + seed, z * 12, 2);
    const rust = sstep(0.5 - amount * 0.25, 0.72 - amount * 0.25, n * 0.55 + big * 0.55), deep = sstep(0.55, 0.8, big) * rust;
    const wear = (1 - rust) * sstep(0.35, 0.9, ny) * 0.35;
    const c = [0, 0, 0];
    for (let i = 0; i < 3; i++) c[i] = lerp(lerp(lerp(b[i], r1[i], rust), r2[i], deep * 0.7), hi[i], wear) * (0.82 + 0.36 * n);
    return c;
  };
}
/** worn fabric or leather: mottled, and muddier toward yBot */
function clothShade(hex, yTop, yBot, seed = 0, mud = 0x3a3226) {
  const b = rgb(hex), d = rgb(mud);
  return (x, y, z) => {
    const n = fbm3(x * 34 + seed, y * 34, z * 34 - seed, 2), fade = fbm3(x * 9 - seed, y * 9 + seed, z * 9, 2);
    const t = clamp((yTop - y) / Math.max(1e-4, yTop - yBot)), dirt = sstep(0.35, 1.05, t + (fade - 0.5) * 0.7) * 0.65;
    const k = (0.72 + 0.5 * n) * (0.85 + 0.3 * fade);
    return [lerp(b[0] * k, d[0], dirt), lerp(b[1] * k, d[1], dirt), lerp(b[2] * k, d[2], dirt)];
  };
}
/**
 * Tattered cloth hanging from an edge. o.top(u) -> [x, y, z] along the edge, o.out(u) -> unit vector the cloth swings toward,
 * o.len(u) -> how far it hangs. The hem is torn into uneven tongues, slit, and holed.
 */
function rag(m, o) {
  const { top, out, len, surf, sx = 16, sy = 12, seed = 0, flare = 0.02, fold = 0.006, folds = 3, fray = 0.35, holes = 0.12, slits = 0.2, lean = [0, 0, 0], tint, grain = 0, stepped = false } = o;
  // each column of the grid hangs to its own length, so the hem is a row of uneven tongues
  const hem = (u) => { const f = u * sx, c = Math.round(f), n = noise3(c * 0.83 + seed * 3.1, seed, 0.5), tip = 1 - Math.abs(f - c) * 2; return 1 - fray * (n * n * 1.7) - fray * 0.25 * (1 - tip) * noise3(c * 3.3, seed, 9); };
  const warp = (u, v0, i, j) => {
    const v = stepped ? v0 : v0 * hem(u);
    if (surf) return surf(u, v, ((i + j) & 1 ? grain : -grain));
    const t = top(u), n = out(u), L = len(u);
    const w = fold * Math.min(1, v * 2.5) * Math.sin(u * folds * Math.PI * 2 + seed + v * 2) + flare * v * v + 0.004 * v * (noise3(u * 9 + seed, v * 6, seed) - 0.5) + ((i + j) & 1 ? grain : -grain);
    return [t[0] + n[0] * w + lean[0] * v, t[1] - L * v + lean[1] * v, t[2] + n[2] * w + lean[2] * v];
  };
  const keep = (u, v) => {
    const c = Math.floor(u * sx);
    if (stepped && v > hem(u)) return false;
    if (slits && noise3(c * 1.37 + seed, 7.7, seed * 0.2) > 1 - slits && v > 0.25 + 0.45 * noise3(c * 2.1, seed, 3)) return false;
    if (holes && v > 0.1 && v < 0.92 && noise3(u * sx * 0.42 + seed, v * sy * 0.42, seed * 1.9) > 1 - holes) return false;
    return o.keep ? o.keep(u, v) : true;
  };
  return cloth(m, sx, sy, warp, keep, tint, grain > 0);
}
/** ring mail as vertex colours: light links on dark gaps in a staggered weave, with rust creeping through */
function mailTint(seed = 0) {
  const lt = rgb(0x8a888e), dk = rgb(0x2c2a30), rs = rgb(0x6c4630);
  return (i, j, q) => {
    const ring = (i + j) & 1, n = fbm3(q[0] * 30 + seed, q[1] * 30, q[2] * 30 - seed, 2);
    const rust = sstep(0.44, 0.68, fbm3(q[0] * 10 - seed, q[1] * 10 + seed, q[2] * 10, 2)) * 0.8;
    const b = ring ? lt : dk, k = 0.72 + 0.56 * n, rk = ring ? 1 : 0.7;
    return [lerp(b[0] * k, rs[0] * rk, rust), lerp(b[1] * k, rs[1] * rk, rust), lerp(b[2] * k, rs[2] * rk, rust)];
  };
}

// ---------- pre-sculpted parts ----------
// Some pieces are sculpted once, outside the rig, and then placed as hard geometry: parts that repeat (the colossus
// is built from a handful of them) and thin shells that would tear on the coarser sculpt levels (the archer's hood).
const _parts = new Map();
/** sculpt resolution scale for the current detail preset (1 at 'high') */
const presetScale = () => (DETAIL[getDetail()] || DETAIL.high)[0] / 96;
function part(key, make) { const k = `${key}|${getDetail()}`; let g = _parts.get(k); if (!g) { g = make(presetScale()); _parts.set(k, g); } return g; }
/** a reusable hard piece from pre-sculpted geometry, keeping the colours and creases the sculpt baked (sculpt.js shades vertices in order) */
function cast(g, mul = 1, to = null, amt = 0) {
  const col = g.attributes.color.array, n = g.attributes.position.count, t = to != null ? rgb(to) : null;
  let k = 0;
  return H.geo(g).shade(() => { const j = (k++ % n) * 3; return t ? [lerp(col[j] * mul, t[0], amt), lerp(col[j + 1] * mul, t[1], amt), lerp(col[j + 2] * mul, t[2], amt)] : [col[j] * mul, col[j + 1] * mul, col[j + 2] * mul]; }).pbr(0.62);
}

// =====================================================================================
//  Skull
// =====================================================================================
/**
 * A skull about 2.5 R tall, in skull space: origin at the centre of the braincase, face toward +Z.
 * Returns { prims, hard, jaw: { prims, hard, pivot }, neck } where neck is the point the spine meets.
 * o: seed, glow (hex), glowAmt, brow (0..1 heavier), fang (0..1), gaps (chance of a missing tooth)
 */
function buildSkull(R, o = {}) {
  const k = R / 0.086, rnd = rng(o.seed ?? 1), glow = o.glow ?? 0x58ffc8, brow = o.brow ?? 0, fang = o.fang ?? 0;
  const E = (rx, ry, rz) => S.ellipsoid(rx * R, ry * R, rz * R);
  const Sp = (r) => S.sphere(r * R);
  const Cap = (a, b, ra, rb = ra) => S.capsule(mul3(a, R), mul3(b, R), ra * R, rb * R);
  const at = (p, x, y, z) => p.at(x * R, y * R, z * R);
  const grime = (x, y, z, r, t = 0.5, col = STAIN) => at(Sp(r), x, y, z).color(mix(BONE, col, t)).pbr(0.75).paint(r * R * 0.7, 0);
  const p = [], hard = [];

  // braincase
  p.push(at(bone(E(0.86, 0.84, 1.06)).bump(0.0016 * k, 60 / k), 0, 0.12, -0.2));
  p.push(at(bone(E(0.76, 0.6, 0.5)), 0, 0.12, 0.44).blend(0.04 * k));                                     // frontal bone
  p.push(at(bone(E(0.58, 0.48, 0.46)), 0, -0.3, -0.78).blend(0.04 * k));                                  // occipital bun
  p.push(...both(at(bone(E(0.4, 0.38, 0.5)), 0.44, 0.42, -0.34).blend(0.05 * k)));                        // parietal eminences
  p.push(...both(at(E(0.22, 0.4, 0.48), 0.97, -0.24, 0.22).cut(0.03 * k).color(mix(BONE, STAIN, 0.6))));  // temporal fossae
  p.push(at(E(0.4, 0.4, 0.62), 0, -0.98, -0.02).cut(0.02 * k).color(mix(BONE_LO, 0x3c3022, 0.6)));         // hollow underside
  // face
  p.push(at(bone(E(0.46, 0.36, 0.34)), 0, -0.68, 0.68).blend(0.03 * k));                                  // maxilla
  p.push(...both([
    at(bone(E(0.22, 0.17, 0.2)), 0.64, -0.52, 0.64).blend(0.02 * k),                                      // cheekbone
    bone(Cap([0.74, 0.04, 0.66], [0.72, -0.44, 0.66], 0.085)).blend(0.016 * k),                           // outer rim of the orbit
    bone(Cap([0.76, -0.54, 0.5], [0.84, -0.48, -0.12], 0.06)).blend(0.008 * k),                           // zygomatic arch
    bone(Cap([0.1, -0.06 - brow * 0.05, 0.97], [0.7, 0.1 + brow * 0.03, 0.74], 0.12 + brow * 0.05)).blend(0.02 * k), // brow ridge
    bone(Cap([0.3, -0.52, 0.88], [0.28, -0.9, 0.88], 0.1)).blend(0.02 * k),                               // canine pillar
    at(bone(Sp(0.13)), 0.66, -0.66, -0.3).blend(0.03 * k),                                                // mastoid
  ]));
  p.push(at(bone(Sp(0.13 + brow * 0.03)), 0, -0.1, 0.97).blend(0.02 * k));                                // glabella
  p.push(bone(Cap([0, -0.14, 0.99], [0, -0.36, 1.1], 0.075)).blend(0.015 * k));                           // nasal bones
  p.push(...both(at(Sp(0.17), 0.45, -0.68, 1.02).cut(0.03 * k).color(mix(BONE, STAIN, 0.4))));            // hollow under the cheekbone
  // dental arches: x = sin(a) * ax, z = zc + cos(a) * az
  const arch = (a, ax, az, zc, y) => [Math.sin(a * DEG) * ax, y, zc + Math.cos(a * DEG) * az];
  const up = (a) => arch(a, 0.38, 0.45, 0.54, -0.9);
  for (let a = -90; a < 90; a += 30) p.push(bone(Cap(up(a), up(a + 30), 0.075)).blend(0.015 * k));         // alveolar ridge
  // sockets
  const sock = glow != null ? mix(SOCKET, glow, 0.1) : SOCKET;
  p.push(...both(at(S.box(0.52 * R, 0.44 * R, 0.72 * R, 0.17 * R).rot(0, 0, 12 + brow * 6), 0.385, -0.27, 0.9).cut(0.01 * k).color(sock).glow(glow != null ? 0.45 : 0)));
  p.push(...both(at(E(0.11, 0.19, 0.3).rot(0, 0, 17), 0.052, -0.6, 1.02).cut(0.006 * k).color(SOCKET)));
  // sutures and wear: thin engraved lines, pale worn crowns, dark staining where soil sat
  p.push(at(S.torus(0.85 * R, 0.05 * R).rot(78, 0, 0), 0, 0.12, 0.1).color(BONE_LO).paint(0.002 * k, -0.001 * k));
  p.push(at(S.box(0.07 * R, 0.6 * R, 1.1 * R, 0.002), 0, 0.9, -0.5).color(BONE_LO).paint(0.002 * k, -0.001 * k));
  p.push(at(E(0.5, 0.2, 0.6), 0, 0.94, -0.1).color(BONE_HI).paint(0.02 * k, 0));
  p.push(at(E(0.5, 0.1, 0.14), 0, 0.0, 0.94).color(BONE_HI).paint(0.012 * k, 0));
  if (o.cracks) {
    // old fractures: a split running up from the brow, another across the back of the crown
    const line = (pts) => { for (let j = 0; j < pts.length - 1; j++) p.push(Cap(pts[j], pts[j + 1], 0.024, 0.014).color(0x4a3c2a).pbr(0.85).paint(0.0016 * k, -0.0022 * k)); };
    line([[0.3, 0.06, 0.92], [0.22, 0.3, 0.96], [0.34, 0.5, 0.86], [0.2, 0.72, 0.64], [0.3, 0.9, 0.3], [0.16, 0.98, -0.1]]);
    line([[0.34, 0.5, 0.86], [0.52, 0.56, 0.7], [0.6, 0.7, 0.42]]);
    line([[-0.7, 0.5, -0.6], [-0.5, 0.74, -0.7], [-0.3, 0.7, -1.0], [-0.05, 0.86, -0.9]]);
    p.push(at(Sp(0.1), -0.42, 0.62, 0.7).cut(0.012 * k).color(0x4a3c2a), at(Sp(0.06), 0.62, 0.3, 0.62).cut(0.01 * k).color(0x4a3c2a));
  }
  p.push(grime(0, -0.98, 0.8, 0.5, 0.55), grime(-0.75, 0.2, -0.75, 0.45, 0.5), grime(0.62, -0.72, 0.5, 0.3, 0.5), grime(-0.62, -0.72, 0.5, 0.3, 0.5), grime(0.5, 0.75, 0.3, 0.3, 0.3, 0x7a6a3a), grime(0, -0.52, 1.05, 0.26, 0.5));

  // eyes: a coal of light deep in each socket
  if (glow != null) hard.push(...H.mirrorX([H.sphere(0.07 * R, 12).at(0.375 * R, -0.28 * R, 0.63 * R).color(glow).glow(o.glowAmt ?? 1.6).pbr(0.4)]));

  // ---- teeth: six a side, walking each arch from the middle outward ----
  const teeth = (m, ax, az, zc, y, dir, big) => {
    const widths = [0.12, 0.105, 0.115, 0.11, 0.125, 0.125];
    for (const sg of [1, -1]) {
      let a = 0.012 / ax;
      widths.forEach((w0, i) => {
        const w = w0 * big, sp = Math.hypot(ax * Math.cos(a), az * Math.sin(a)), mid = a + (w / sp) / 2;
        a += w / sp + 0.012;
        const canine = i === 2, molar = i > 3;
        if (rnd() < (o.gaps ?? 0.1) && !canine) return;
        const c = arch((mid / DEG) * sg, ax, az, zc, y), tan = norm3([Math.cos(mid) * ax * sg, 0, -Math.sin(mid) * az]);
        const h = (canine ? 0.24 + fang * 0.3 : molar ? 0.15 : 0.2) * (0.9 + rnd() * 0.2) * big, d = molar ? 0.13 : 0.1;
        const tip = add3(c, [tan[0] * (rnd() - 0.5) * 0.04, dir * h, 0]);
        const root = add3(c, [0, -dir * 0.07, 0]);
        const pts = [root, lerp3(c, tip, 0.35), lerp3(c, tip, 0.8), tip].map((q) => mul3(q, R));
        const rw = w * 0.47 * R, rd = d * 0.5 * R;
        sweep(m, pts, canine ? [[rw * 0.8, rd], [rw * 0.88, rd * 1.05], [rw * 0.5, rd * 0.6], [rw * 0.12, rd * 0.15]] : molar ? [[rw * 0.85, rd], [rw, rd * 1.05], [rw * 0.95, rd], [rw * 0.6, rd * 0.6]] : [[rw * 0.8, rd], [rw, rd * 1.05], [rw * 0.98, rd * 0.7], [rw * 0.85, rd * 0.25]], { radial: 6, up: tan });
      });
    }
  };
  const toothShade = (dir, y0) => { const c = rgb(TOOTH), d = rgb(0x7a6238); return (x, y) => { const t = clamp(((y - y0 * R) * dir) / (0.12 * R)); return [lerp(d[0], c[0], t), lerp(d[1], c[1], t), lerp(d[2], c[2], t)]; }; };
  const ut = new MB();
  teeth(ut, 0.39, 0.46, 0.55, -0.93, -1, 1);
  hard.push(ut.hard().shade(toothShade(-1, -0.93)).pbr(0.35).lod(1));

  // ---- lower jaw (skull space; the caller re-bases it on the hinge) ----
  const pivot = [0, -0.63 * R, -0.05 * R];
  const jp = [], jh = [];
  const lo = (a) => arch(a, 0.345, 0.41, 0.52, -1.3);
  jp.push(at(bone(E(0.26, 0.2, 0.16)), 0, -1.5, 0.86));                                                    // chin
  jp.push(at(bone(Sp(0.1)), 0, -1.6, 0.92).blend(0.02 * k));
  for (let a = -90; a < 90; a += 30) jp.push(bone(Cap(lo(a), lo(a + 30), 0.08)).blend(0.016 * k));          // tooth-bearing rim
  jp.push(...both([
    bone(Cap([0.14, -1.56, 0.88], [0.44, -1.5, 0.62], 0.1)).blend(0.02 * k),                               // lower border
    bone(Cap([0.44, -1.5, 0.62], [0.62, -1.4, 0.12], 0.1)).blend(0.02 * k),
    at(bone(Sp(0.12)), 0.62, -1.4, 0.1).blend(0.02 * k),                                                   // angle of the jaw
    bone(Cap([0.62, -1.4, 0.12], [0.675, -0.66, -0.05], 0.085, 0.075)).blend(0.016 * k),                   // ramus, back edge
    bone(Cap([0.54, -1.3, 0.38], [0.65, -0.78, 0.24], 0.065, 0.05)).blend(0.03 * k),                       // ramus, front edge up to the coronoid
    at(bone(Sp(0.1)), 0.675, -0.64, -0.05).blend(0.012 * k),                                               // condyle
  ]));
  jp.push(at(E(0.27, 0.18, 0.32), 0, -1.27, 0.5).cut(0.015 * k).color(0x3c3022));                          // floor of the mouth
  jp.push(grime(0, -1.62, 0.75, 0.42, 0.5), grime(0.64, -1.1, 0.15, 0.3, 0.45), grime(-0.64, -1.1, 0.15, 0.3, 0.45));
  const lt = new MB();
  teeth(lt, 0.345, 0.415, 0.52, -1.27, 1, 0.92);
  jh.push(lt.hard().shade(toothShade(1, -1.27)).pbr(0.35).lod(1));

  return { prims: p, hard, jaw: { prims: jp, hard: jh, pivot }, neck: [0, -0.86 * R, -0.2 * R], R };
}

// =====================================================================================
//  Human-sized skeleton
// =====================================================================================
// Built at life size and then enlarged by BUILD (see skeleton()): a skeleton with a big skull, a broad cage, thick bones
// and big hands on legs a little short for it reads far better at game distance than a true-to-life one.
const BUILD = 1.14, HAND = 1.2;
const THIGH = 0.192, SHIN = 0.19, FOOT_H = 0.045, HIP_Y = FOOT_H + SHIN + THIGH, HIP_X = 0.062, UPPER = 0.152, FORE = 0.14, HR = 0.036;
const TORSO_AT = [0, 0.05, -0.022];           // lumbosacral joint, relative to the hip line
const SHOULDER = [0.148, 0.243, -0.004];      // in torso space
const SPINE_KEYS = [[-0.012, -0.006], [0, 0], [0.05, 0.012], [0.095, 0.004], [0.165, -0.026], [0.225, -0.03], [0.262, -0.018], [0.29, -0.004], [0.326, 0.012], [0.345, 0.018]];
const NECK_TOP = 0.326, RIBS = 8;

const tableAt = (tab, x) => {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) return lerp(tab[i - 1][1], tab[i][1], (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]));
  return tab[tab.length - 1][1];
};
let _spineTab = null;
function spineTab() {
  if (!_spineTab) _spineTab = spline(SPINE_KEYS.map(([y, z]) => [0, y, z]), 80).map((p) => [p[1], p[2]]);
  return _spineTab;
}
/** z of the spine's axis at torso height y, and its direction there */
const spineZ = (y) => tableAt(spineTab(), y);
const spineDir = (y) => norm3([0, 0.01, spineZ(y + 0.005) - spineZ(y - 0.005)]);

// rib cage envelope (torso space): half width, front and back depth at each height
const CAGE_W = [[0.07, 0.092], [0.09, 0.104], [0.12, 0.115], [0.15, 0.116], [0.18, 0.109], [0.21, 0.096], [0.24, 0.076], [0.262, 0.056], [0.28, 0.04]];
const CAGE_F = [[0.07, 0.092], [0.1, 0.112], [0.125, 0.12], [0.15, 0.118], [0.252, 0.0705], [0.28, 0.058]];
const cageW = (y) => tableAt(CAGE_W, y);
const cageF = (y) => tableAt(CAGE_F, y);
const cageB = (y) => spineZ(y) - 0.016;
/** point on the rib cage at height y, angle phi around it (0 = spine, PI = breastbone), pushed out by `off` */
function cagePoint(y, phi, off = 0, sx = 1) {
  const w = cageW(y) + off, zb = cageB(y) - off, zf = cageF(y) + off, zc = (zb + zf) / 2, d = (zf - zb) / 2;
  const s = Math.sin(phi), c = Math.cos(phi);
  return [sx * w * Math.pow(Math.abs(s), 0.8), y, zc - d * Math.sign(c) * Math.pow(Math.abs(c), 0.8)];
}

function buildRibs(o = {}) {
  const N = RIBS, TRUE = 5, pitch = (0.262 - 0.114) / (N - 1), top = 0.262;
  const yf = [0.24, 0.221, 0.201, 0.181, 0.161], drop = [0.022, 0.025, 0.029, 0.033, 0.038, 0.041, 0.038, 0.027];
  const lowPhi = 2.05;
  const ribs = [];
  for (let i = 0; i < N; i++) {
    const yb = top - i * pitch, ylow = Math.min(yb - drop[i], i < TRUE ? yf[i] - 0.004 - i * 0.003 : 1);
    const r = { i, yb, ylow };
    if (i < TRUE) { r.yf = yf[i]; r.end = Math.PI - Math.asin(Math.pow(0.0145 / cageW(yf[i]), 1.25)); r.bone = i === 0 ? 2.5 : 2.36 - i * 0.02; }
    else if (i === TRUE) { r.end = 2.74; r.yf = ribs[i - 1].y(2.74) - 0.006; r.bone = 2.24; }
    else if (i === TRUE + 1) { r.end = 2.5; r.yf = ribs[i - 1].y(2.5) - 0.006; r.bone = 2.14; }
    else { r.end = 1.9; r.bone = 1.9; r.yf = ylow; }
    r.y = (phi) => (phi <= lowPhi ? lerp(yb, ylow, cosEase(phi / lowPhi)) : lerp(ylow, r.yf, cosEase((phi - lowPhi) / Math.max(1e-3, r.end - lowPhi))));
    ribs.push(r);
  }
  const path = (r, sx, a, b, n) => { const out = []; for (let j = 0; j <= n; j++) { const phi = lerp(a, b, j / n); out.push(cagePoint(r.y(phi), phi, 0, sx)); } return out; };
  const fine = new MB(), gristle = new MB(), far = new MB();
  for (const sx of [1, -1]) for (const r of ribs) {
    const broken = o.broken && o.broken[0] === r.i && o.broken[1] === sx ? o.broken[2] : 0;
    const boneEnd = broken || r.bone;
    const head = [sx * 0.011, r.yb + 0.002, spineZ(r.yb) - 0.006];
    const pts = spline([head, ...path(r, sx, 0.3, boneEnd, 12)], 17);
    const float = r.i === N - 1 || broken;
    sweep(fine, pts, (t) => {
      const neck = sstep(0, 0.1, t), tip = float ? 1 - sstep(0.86, 1, t) * 0.75 : 1;
      return [lerp(0.0052, 0.0071, neck) * tip, lerp(0.0052, 0.0047, neck) * (float ? lerp(1, 0.6, sstep(0.8, 1, t)) : 1)];
    }, { radial: 7, up: [0, 1, 0] });
    ribbon(far, pts.filter((_, j) => j % 3 === 1 || j === pts.length - 1), 0.0074, [0, 1, 0]);
    if (!float && r.end > r.bone) {
      const cp = spline(path(r, sx, r.bone - 0.03, r.end, 5), 6);
      if (r.i < TRUE) cp.push([sx * 0.011, r.yf, cageF(r.yf) - 0.004]);
      sweep(gristle, cp, () => [0.0056, 0.0042], { radial: 6, up: [0, 1, 0] });
      ribbon(far, [cp[0], cp[3], cp[cp.length - 1]], 0.0052, [0, 1, 0]);
    }
  }
  return [
    fine.hard().shade(boneShade(3)).pbr(0.6).lod(1),
    gristle.hard().shade(boneShade(9, mix(BONE, GRISTLE, 0.62), GRISTLE, 0.25)).pbr(0.8).lod(1),
    far.hard().shade(boneShade(3, mix(BONE, BONE_LO, 0.12))).pbr(0.7).from(2),
  ];
}

/** spine, breastbone, collar bones, shoulder blades and ribs, in torso space */
function buildTorso(o = {}) {
  const p = [], hard = [];
  const proc = new MB(), core = new MB();
  // --- vertebrae: a drum for each body, a dark disc between, an arch lump behind; processes are swept spikes ---
  const column = (y0, y1, n, r0, r1, fill) => {
    const pitch = (y1 - y0) / (n - 1);
    for (let i = 0; i < n; i++) {
      const y = y0 + i * pitch, f = n > 1 ? i / (n - 1) : 0, r = lerp(r0, r1, f), z = spineZ(y), t = spineDir(y), tilt = Math.atan2(t[2], t[1]) / DEG;
      const back = [0, t[2], -t[1]];
      p.push(bone(S.cyl(r, pitch * fill, r * 0.3)).rot(tilt, 0, 0).at(0, y, z).blend(0.002));
      p.push(S.cyl(r * 0.8, pitch, 0.001).rot(tilt, 0, 0).at(0, y + pitch / 2, spineZ(y + pitch / 2)).color(GRISTLE).pbr(0.9).blend(0.002));
      p.push(bone(S.sphere(r * 0.62)).at(0, y + back[1] * r * 0.95, z + back[2] * r * 0.95).blend(0.006));
      const a = [0, y + back[1] * r * 1.2, z + back[2] * r * 1.2];
      spike(proc, a, add3(a, [0, back[1] * r * 1.5 - r * 0.9, back[2] * r * 1.5]), r * 0.4, r * 0.22, 5, [1, 0, 0]);
      for (const sx of [1, -1]) spike(proc, [sx * r * 0.7, a[1], a[2] + r * 0.3], [sx * r * 2.1, a[1] + r * 0.1, a[2] - r * 0.35], r * 0.34, r * 0.22, 5, [0, 1, 0]);
    }
  };
  column(0.01, 0.092, 5, 0.0185, 0.0165, 0.7);      // lumbar
  column(0.114, 0.262, RIBS, 0.0158, 0.013, 0.7);  // thoracic: one to a pair of ribs
  column(0.2775, 0.3185, 5, 0.0115, 0.0105, 0.66);  // cervical
  p.push(bone(S.sphere(0.0125)).at(0, NECK_TOP, spineZ(NECK_TOP)).blend(0.004));                           // atlas: the ball the skull turns on
  const sp = []; for (let y = -0.004; y <= 0.33; y += 0.0278) sp.push([0, y, spineZ(y)]);
  sweep(core, sp, (t) => lerp(0.02, 0.0125, t), { radial: 5, up: [1, 0, 0] });

  // --- breastbone ---
  const sz = (y) => cageF(y) - 0.0045;
  p.push(bone(S.box(0.042, 0.034, 0.013, 0.006)).rot(-25, 0, 0).at(0, 0.237, sz(0.237)));                  // manubrium
  p.push(bone(S.box(0.027, 0.078, 0.012, 0.005)).rot(-25, 0, 0).at(0, 0.187, sz(0.187)).blend(0.006));     // body
  p.push(bone(S.capsule([0, 0.152, sz(0.152)], [0, 0.128, sz(0.15) + 0.006], 0.0058, 0.0035)).blend(0.006)); // xiphoid
  for (let i = 0; i < 4; i++) p.push(S.box(0.05, 0.003, 0.03, 0.001).rot(-25, 0, 0).at(0, 0.214 - i * 0.017, sz(0.214 - i * 0.017)).color(BONE_LO).paint(0.0015, -0.0008));
  ribbon(core, [[0, 0.252, sz(0.252)], [0, 0.2, sz(0.2)], [0, 0.148, sz(0.148)]], (t) => lerp(0.02, 0.011, t), [1, 0, 0]);

  // --- collar bones ---
  const clav = new MB(), clavFar = new MB();
  for (const sx of [1, -1]) {
    const pts = spline([[sx * 0.014, 0.249, sz(0.249) + 0.002], [sx * 0.05, 0.256, sz(0.249) + 0.006], [sx * 0.098, 0.26, 0.04], [sx * 0.138, 0.2665, 0.004]], 10);
    sweep(clav, pts, (t) => { const e = Math.abs(t - 0.5) * 2; return [lerp(0.0076, 0.0102, e * e), lerp(0.0076, 0.0088, e * e)]; }, { radial: 7, up: [0, 1, 0] });
    sweep(clavFar, [pts[0], pts[5], pts[9]], 0.0088, { radial: 4 });
  }
  hard.push(clav.hard().shade(boneShade(5)).pbr(0.6).near(), clavFar.hard().color(FAR_BONE).pbr(0.75).far());

  // --- shoulder blades: a plate on the back of the ribs, a ridge running out to the point of the shoulder ---
  const blade = new MB(), bladeFar = new MB(), ridge = new MB();
  for (const sx of [1, -1]) {
    const q = (x, y, z) => [sx * x, y, z];
    const n = norm3(q(0.42, 0.08, -0.9));
    const out = spline([q(0.062, 0.256, -0.05), q(0.058, 0.215, -0.056), q(0.07, 0.165, -0.062), q(0.083, 0.146, -0.06), q(0.1, 0.18, -0.046), q(0.122, 0.222, -0.022), q(0.13, 0.246, -0.014), q(0.108, 0.258, -0.03), q(0.085, 0.262, -0.043), q(0.062, 0.256, -0.05)], 20).slice(0, -1);
    slab(blade, sx > 0 ? out : out.reverse(), sx > 0 ? n : mul3(n, 1), 0.0065, -0.002);
    slab(bladeFar, out.filter((_, j) => j % 4 === 0), n, 0.0065);
    sweep(ridge, spline([q(0.062, 0.238, -0.057), q(0.095, 0.246, -0.05), q(0.128, 0.262, -0.03), q(0.146, 0.272, -0.004), q(0.14, 0.268, 0.012)], 9), (t) => [lerp(0.004, 0.0075, sstep(0.1, 0.8, t)), lerp(0.004, 0.0052, t)], { radial: 6, up: [0, 0, 1] });
    p.push(bone(S.sphere(0.0165)).at(sx * 0.131, 0.241, -0.008).blend(0.004));                             // socket of the shoulder
  }
  hard.push(blade.hard().shade(boneShade(7)).pbr(0.62).lod(1), bladeFar.hard().color(FAR_BONE).pbr(0.7).from(2), ridge.hard().shade(boneShade(7)).pbr(0.6).near());
  p.push(...both(S.sphere(0.0205).at(SHOULDER[0] - 0.004, SHOULDER[1], SHOULDER[2]).cut(0.003).color(BONE_LO)));

  hard.push(proc.hard().shade(boneShade(1)).pbr(0.6).lod(1));
  hard.push(core.hard().color(FAR_BONE).pbr(0.8).from(2));
  return { prims: p, hard, cage: buildRibs(o) };
}

/** pelvis in hip space: origin on the line between the hip joints */
function buildPelvis() {
  const p = [], hard = [];
  const wing = (sx) => [
    bone(S.ellipsoid(0.05, 0.047, 0.0115)).bump(0.0014, 60).rot(0, -36 * sx, -12 * sx).at(sx * 0.068, 0.05, -0.012),
    S.sphere(0.06).at(sx * (0.068 - 0.588 * 0.0625), 0.052, -0.012 + 0.81 * 0.0625).cut(0.01).color(mix(BONE, BONE_LO, 0.5)),
  ];
  p.push(...wing(1), ...wing(-1));
  p.push(bone(S.ellipsoid(0.031, 0.036, 0.015)).rot(24, 0, 0).at(0, 0.017, -0.04).blend(0.012));           // sacrum
  p.push(bone(S.sphere(0.0165)).at(TORSO_AT[0], TORSO_AT[1] - 0.004, TORSO_AT[2]).blend(0.01));            // the ball the spine turns on
  p.push(bone(S.capsule([0, -0.012, -0.053], [0, -0.04, -0.046], 0.0065, 0.003)).blend(0.008));            // tail bone
  p.push(...both([
    ...S.limb([[0.03, 0.064, -0.046], [0.068, 0.098, -0.014], [0.108, 0.072, 0.02]], [0.0075, 0.008, 0.0085]).map((c) => bone(c).blend(0.012)), // iliac crest
    bone(S.capsule([0.108, 0.072, 0.02], [0.084, 0.02, 0.016], 0.0085, 0.01)).blend(0.012),                // front edge
    bone(S.sphere(0.0275)).at(HIP_X + 0.004, 0.002, 0).blend(0.016),                                       // hip socket
    bone(S.capsule([0.058, -0.014, -0.012], [0.046, -0.058, -0.03], 0.0125, 0.012)).blend(0.012),          // ischium
    bone(S.sphere(0.0145)).at(0.046, -0.061, -0.03).blend(0.01),
    bone(S.capsule([0.056, -0.004, 0.018], [0.012, -0.03, 0.042], 0.0098, 0.0092)).blend(0.01),            // pubic ramus
    bone(S.capsule([0.045, -0.064, -0.022], [0.011, -0.052, 0.036], 0.0085)).blend(0.01),
    S.sphere(0.0215).at(HIP_X + 0.007, -0.004, 0.002).cut(0.004).color(BONE_LO),
  ]));
  p.push(bone(S.ellipsoid(0.014, 0.021, 0.012)).at(0, -0.04, 0.041).blend(0.01));                          // pubic symphysis
  p.push(S.box(0.003, 0.05, 0.03, 0.001).at(0, -0.04, 0.045).color(GRISTLE).paint(0.0015, -0.001));
  p.push(...age([[0.08, 0.03, 0.02], [-0.07, 0.07, -0.02], [0, 0.0, -0.05], [0.04, -0.05, 0.01], [-0.05, -0.04, 0]], 0.03, 0.5));
  // far stand-in: a plate through each wing and a block in the sacrum
  const far = new MB();
  for (const sx of [1, -1]) {
    const n = [-0.588 * sx, 0, 0.81], u = [0.81 * sx, 0, 0.588], c = [sx * 0.068, 0.05, -0.012], out = [];
    for (let j = 0; j < 7; j++) { const a = (j / 7) * Math.PI * 2 * sx; out.push(add3(c, add3(mul3(u, Math.cos(a) * 0.04), [0, Math.sin(a) * 0.038, 0]))); }
    slab(far, out, n, 0.014);
  }
  sweep(far, [[0, 0.045, -0.03], [0, -0.02, -0.046]], 0.014, { radial: 4, up: [1, 0, 0] });
  sweep(far, [[0.07, -0.012, 0], [0.03, -0.045, 0.02], [-0.03, -0.045, 0.02], [-0.07, -0.012, 0]], 0.0062, { radial: 3, up: [0, 1, 0] });
  hard.push(far.hard().color(FAR_BONE).pbr(0.8).from(2));
  return { prims: p, hard };
}

/**
 * What a long bone looks like from far away: a five-sided shaft with knobbed ends, a little fatter than life so that it
 * neither vanishes nor shimmers. It takes over from level 2, where the sculpted shaft starts to break up inside it.
 */
function farBone(m, pts, r, knob = 1.45) {
  const path = spline(pts.length > 2 ? pts : [pts[0], lerp3(pts[0], pts[1], 0.5), pts[1]], 7);
  const prof = [0.85, 1, 0.7, 0.66, 0.7, 1, 0.85];
  return sweep(m, path, prof.map((k) => r * knob * k), { radial: 4, phase: Math.PI / 4 });
}
function rod(pts, r, knob) { return farBone(new MB(), pts, r, knob).hard().color(FAR_BONE).pbr(0.8).from(2); }

/** left thigh bone in its node's space: origin at the hip joint, knee at (0, -THIGH, 0) */
function buildFemur() {
  const L = THIGH, p = [];
  p.push(bone(S.sphere(0.0195)));                                                                         // head
  p.push(bone(S.capsule([0, 0, 0], [0.027, -0.012, -0.002], 0.012)).blend(0.006));                        // neck
  p.push(bone(S.ellipsoid(0.014, 0.02, 0.015)).at(0.034, -0.006, -0.004).blend(0.012));                   // greater trochanter
  p.push(bone(S.sphere(0.0095)).at(0.014, -0.038, -0.011).blend(0.012));                                  // lesser trochanter
  p.push(...S.limb([[0.029, -0.02, 0], [0.019, -L * 0.48, 0.008], [0.004, -L * 0.86, 0.003]], [0.0172, 0.0146, 0.0168]).map((c, i) => bone(c).bump(0.0013, 55).blend(i ? 0.004 : 0.014)));
  p.push(bone(S.capsule([0.022, -L * 0.3, -0.01], [0.01, -L * 0.72, -0.009], 0.0052)).blend(0.012));      // the rough line down the back
  p.push(bone(S.ellipsoid(0.0245, 0.0195, 0.019)).at(0.002, -L + 0.019, 0).blend(0.014));                 // flare above the knee
  p.push(bone(S.sphere(0.018)).at(0.0148, -L + 0.002, -0.004).blend(0.008), bone(S.sphere(0.018)).at(-0.013, -L + 0.002, -0.004).blend(0.008)); // condyles
  p.push(S.capsule([0.001, -L - 0.014, -0.014], [0.001, -L + 0.01, -0.024], 0.006).cut(0.004).color(BONE_LO)); // notch between them
  p.push(bone(S.ellipsoid(0.0135, 0.0155, 0.0078)).at(0.001, -L + 0.008, 0.0235).blend(0.0025));          // kneecap
  p.push(...age([[0.02, -L * 0.5, 0.014], [0.03, -0.01, -0.01], [0, -L + 0.005, -0.012], [0.012, -L * 0.8, -0.012]], 0.026, 0.5));
  return { prims: p, hard: [rod([[0.028, -0.014, 0], [0.019, -L * 0.48, 0.008], [0.002, -L, 0]], 0.0165)] };
}

/** left shin and foot: origin at the knee, ankle at (0, -SHIN, 0), sole at -SHIN - FOOT_H */
function buildShin() {
  const L = SHIN, G = -L - FOOT_H, p = [], hard = [];
  p.push(bone(S.ellipsoid(0.0265, 0.011, 0.021)).at(0.001, -0.0135, -0.002));                             // tibial plateau
  p.push(bone(S.sphere(0.009)).at(0, -0.034, 0.0155).blend(0.012));                                       // tuberosity
  p.push(...S.limb([[0, -0.022, 0.003], [-0.001, -L * 0.52, 0.007], [-0.002, -L + 0.014, 0.002]], [0.0172, 0.0132, 0.0122]).map((c, i) => bone(c).bump(0.0013, 55).blend(i ? 0.004 : 0.012)));
  p.push(bone(S.capsule([0, -0.034, 0.0155], [-0.002, -L * 0.7, 0.016], 0.005)).blend(0.01));             // shin crest
  p.push(bone(S.ellipsoid(0.0172, 0.013, 0.0155)).at(-0.002, -L + 0.008, 0.002).blend(0.01));
  p.push(bone(S.sphere(0.0102)).at(-0.0158, -L - 0.003, 0.002).blend(0.008));                             // inner ankle
  p.push(bone(S.sphere(0.0092)).at(0.0245, -0.028, -0.01).blend(0.004));                                  // head of the fibula
  p.push(bone(S.ellipsoid(0.0082, 0.0132, 0.0092)).at(0.021, -L - 0.003, -0.004).blend(0.004));           // outer ankle
  // foot: ankle bone, heel, the arch
  p.push(bone(S.ellipsoid(0.0172, 0.0122, 0.02)).at(0, -L - 0.011, 0.006).blend(0.003));
  p.push(bone(S.box(0.025, 0.022, 0.042, 0.009)).rot(-12, 0, 0).at(0.003, G + 0.0145, -0.019).blend(0.006));  // heel bone
  p.push(bone(S.sphere(0.01)).at(0.003, G + 0.0105, -0.035).blend(0.006));
  p.push(bone(S.ellipsoid(0.0215, 0.012, 0.0155)).at(0, -L - 0.02, 0.03).blend(0.004));
  p.push(S.box(0.058, 0.003, 0.003, 0.001).at(0, -L - 0.02, 0.018).color(BONE_LO).paint(0.0015, -0.001));
  p.push(...age([[0, -0.01, 0.012], [0.004, -L * 0.55, 0.014], [0, -L, 0], [0.003, G + 0.012, -0.022]], 0.024, 0.5));
  const fib = sweep(new MB(), spline([[0.0245, -0.03, -0.01], [0.0262, -L * 0.5, -0.009], [0.021, -L - 0.002, -0.005]], 7), [0.0068, 0.0058, 0.0054, 0.0052, 0.0054, 0.006, 0.0068], { radial: 6 });
  hard.push(fib.hard().shade(boneShade(11)).pbr(0.6).near());
  const toes = new MB(), far = new MB();
  const xb = [-0.014, -0.007, 0, 0.007, 0.0135], xh = [-0.0235, -0.011, 0.001, 0.013, 0.0235], zh = [0.096, 0.101, 0.099, 0.094, 0.085];
  for (let j = 0; j < 5; j++) {
    const big = j === 0, r = big ? 0.0072 : 0.0056 - j * 0.0002;
    const a = [xb[j], -L - 0.021, 0.04], b = [xh[j], G + r + 0.0035, zh[j]];
    dogbone(toes, a, b, r, 6);
    digit(toes, [b, [xh[j] * 1.08, G + r + 0.0012, zh[j] + (big ? 0.027 : 0.02)], [xh[j] * 1.12, G + r * 0.9, zh[j] + (big ? 0.045 : 0.034)]], [r * 0.95, r * 0.85], 5);
  }
  // far away the foot is a wedge
  sweep(far, [[0.003, G + 0.016, -0.036], [0, -L - 0.014, 0.012], [0, G + 0.012, 0.085], [0, G + 0.007, 0.138]], [[0.01, 0.012], [0.014, 0.019], [0.009, 0.027], [0.004, 0.022]], { radial: 5, up: [0, 1, 0] });
  hard.push(toes.hard().shade(boneShade(13)).pbr(0.6).lod(1), far.hard().color(FAR_BONE).pbr(0.85).from(2));
  hard.push(rod([[0, -0.006, 0.002], [-0.001, -L * 0.52, 0.007], [-0.001, -L - 0.008, 0.004]], 0.0148));
  return { prims: p, hard };
}

/** left upper arm: origin at the shoulder, elbow at (0, -UPPER, 0) */
function buildHumerus() {
  const L = UPPER, p = [];
  p.push(bone(S.sphere(0.0205)).at(-0.004, 0.001, 0));                                                    // head
  p.push(bone(S.ellipsoid(0.0125, 0.0148, 0.0135)).at(0.0105, -0.004, 0.002).blend(0.01));                // greater tubercle
  p.push(...S.limb([[0.003, -0.012, 0], [0.002, -L * 0.52, -0.002], [0, -L + 0.02, 0.002]], [0.0158, 0.0126, 0.0134]).map((c, i) => bone(c).bump(0.0013, 55).blend(i ? 0.004 : 0.012)));
  p.push(bone(S.sphere(0.0075)).at(0.011, -L * 0.42, 0).blend(0.012));
  p.push(bone(S.ellipsoid(0.0245, 0.0145, 0.0115)).at(0, -L + 0.01, 0.001).blend(0.012));                 // epicondyles
  p.push(bone(S.capsule([-0.0135, -L, 0.003], [0.0135, -L, 0.003], 0.011)).blend(0.006));                 // the spool the forearm turns on
  p.push(S.sphere(0.0078).at(0, -L + 0.013, -0.0125).cut(0.004).color(BONE_LO));
  p.push(...age([[0.006, 0, -0.012], [0.004, -L * 0.45, 0.012], [0, -L, 0.01]], 0.024, 0.5));
  return { prims: p, hard: [rod([[0.002, -0.006, 0], [0.002, -L * 0.52, -0.002], [0, -L, 0.002]], 0.0145)] };
}

/** left forearm: radius and ulna as a pair with daylight between them; origin at the elbow, wrist at (0, -FORE, 0) */
function buildForearm() {
  const L = FORE, p = [], hard = [];
  p.push(bone(S.ellipsoid(0.0105, 0.0155, 0.0112)).at(-0.006, 0.004, -0.0135));                           // point of the elbow
  p.push(bone(S.sphere(0.0085)).at(-0.007, -0.014, -0.002).blend(0.006));
  p.push(bone(S.cyl(0.01, 0.008, 0.003)).at(0.0125, -0.0145, 0.005).blend(0.002));                        // head of the radius
  p.push(bone(S.ellipsoid(0.0142, 0.011, 0.0105)).at(0.0075, -L + 0.009, 0.005).blend(0.002));            // broad end of the radius
  p.push(bone(S.sphere(0.0078)).at(-0.0125, -L + 0.008, -0.007).blend(0.002));                            // head of the ulna
  const m = new MB(), far = new MB();
  const ulna = spline([[-0.007, -0.004, -0.011], [-0.0125, -L * 0.5, -0.0105], [-0.0125, -L + 0.008, -0.007]], 8);
  const radius = spline([[0.0125, -0.015, 0.005], [0.019, -L * 0.5, 0.0075], [0.0085, -L + 0.013, 0.0055]], 8);
  sweep(m, ulna, (t) => lerp(0.0086, 0.006, t), { radial: 7 });
  sweep(m, radius, (t) => lerp(0.0066, 0.0096, t * t), { radial: 7 });
  hard.push(m.hard().shade(boneShade(17)).pbr(0.6).near());
  // far away: still two bones with a gap, each a little fatter
  sweep(far, [ulna[0], ulna[4], ulna[7]], [0.0125, 0.0082, 0.0085], { radial: 4 });
  sweep(far, [radius[0], radius[4], radius[7]], [0.0085, 0.0088, 0.0125], { radial: 4 });
  hard.push(far.hard().color(FAR_BONE).pbr(0.8).far());
  return { prims: p, hard };
}

const HOLD = { one: { up: 24, lean: 0 }, two: { up: 46, lean: 10 }, pole: { up: 62, lean: 3 }, staff: { up: 82, lean: 0 }, bow: { up: 0, lean: 0 } };

/** wrist bones: two rows of pebbles from the wrist (w) toward the knuckles (d), spread along s */
function carpals(w, d, s, sc = 1) {
  const p = [];
  const rows = [[0.0045, [-0.0085, 0, 0.0085]], [0.0118, [-0.0115, -0.004, 0.0035, 0.011]]];
  for (const [f, offs] of rows) for (const q of offs) p.push(bone(S.sphere(0.0052 * sc)).at(...add3(add3(w, mul3(d, f * sc)), mul3(s, q * sc))).blend(0.0028));
  return p;
}

/** left hand hanging open from the wrist at the origin: palm toward the body (-X), thumb forward. curl 0..1 */
function openHand(curl = 0.35, sc = 1) {
  const m = new MB();
  const zs = [0.0125, 0.0042, -0.0042, -0.012], len = [0.92, 1, 0.95, 0.78];
  for (let i = 0; i < 4; i++) {
    const z = zs[i] * sc, a = [0, -0.016 * sc, z * 0.8], kn = [0.001 * sc, -0.05 * sc * (0.94 + len[i] * 0.06), z * 1.1];
    dogbone(m, a, kn, 0.0042 * sc);
    const pts = [kn]; let ang = 0, q = kn;
    for (const [l, c] of [[0.0215, 18 + curl * 30], [0.0145, 30 + curl * 45], [0.011, 30 + curl * 45]]) {
      ang += c * DEG;
      q = [q[0] - Math.sin(ang) * l * len[i] * sc, q[1] - Math.cos(ang) * l * len[i] * sc, q[2] * 1.02];
      pts.push(q);
    }
    digit(m, pts, [0.0038 * sc, 0.0034 * sc, 0.003 * sc]);
  }
  const t = [[0.0, -0.01, 0.011], [-0.006, -0.03, 0.028], [-0.012, -0.047, 0.035], [-0.017, -0.06, 0.034]].map((q) => mul3(q, sc));
  digit(m, t, [0.0046 * sc, 0.004 * sc, 0.0034 * sc]);
  // far away the hand is a paddle
  const far = sweep(new MB(), [[0, -0.004 * sc, 0], [0, -0.05 * sc, 0.001 * sc], [-0.006 * sc * (1 + curl), -0.092 * sc, 0]], [[0.007 * sc, 0.012 * sc], [0.0075 * sc, 0.019 * sc], [0.005 * sc, 0.013 * sc]], { radial: 5, up: [1, 0, 0] });
  return { prims: carpals([0, 0, 0], [0, -1, 0], [0, 0, 1], sc), hard: [m.hard().shade(boneShade(21)).pbr(0.6).lod(1), far.hard().color(FAR_BONE).pbr(0.85).from(2)] };
}

/**
 * Left hand closed on a shaft. The fist is laid out in the weapon frame (shaft along +Y through the origin, knuckles
 * toward +Z, palm on the +X side), then turned by `rot` and moved to `pos` in the hand node, whose origin is the wrist.
 */
function gripHand(gr, rot, pos, sc = 1, fat = 1, claws = false, keep = false) {
  const M = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ')).setPosition(pos[0], pos[1], pos[2]);
  const inv = M.clone().invert(), v = new THREE.Vector3();
  const xf = (q) => { v.set(q[0], q[1], q[2]).applyMatrix4(M); return [v.x, v.y, v.z]; };
  v.set(0, 0, 0).applyMatrix4(inv);
  const W = [v.x, v.y, v.z];                                                // the wrist, in the weapon frame
  const fr = 0.0038 * sc * fat, Rr = gr + fr * 1.35, hr = HR * sc;
  const ring = (deg, y, f = 1) => [Math.cos(deg * DEG) * Rr * f, y, Math.sin(deg * DEG) * Rr * f];
  const m = new MB();
  const ys = [0.6, 0.2, -0.2, -0.6];
  const kx = gr + 0.0075 * sc * fat, kz = 0.0115 * sc;
  const tipOf = (a, b) => { if (claws) spike(m, xf(b), xf(add3(b, mul3(norm3(sub3(b, a)), 0.014 * sc))), fr * 0.8, fr * 0.2, 5); };
  const corners = [];
  for (let i = 0; i < 4; i++) {
    const y = ys[i] * hr, r = fr * (i === 3 ? 0.9 : 1);
    const K = [kx, y, kz], base = add3(lerp3(W, K, 0.3), [0, (y - W[1]) * -0.25, 0]);
    if (i === 0 || i === 3) corners.push(xf(base), xf(K));
    dogbone(m, xf(base), xf(K), r * 1.1);
    const f = [K, ring(98, y * 0.99, 1.02), ring(172, y * 0.97), ring(244, y * 0.95, 0.97)];
    digit(m, f.map(xf), [r, r * 0.9, r * 0.8]);
    tipOf(f[2], f[3]);
  }
  // thumb: round the back of the shaft and over the forefinger
  const t0 = add3(lerp3(W, [kx, hr * 0.7, -0.012 * sc], 0.3), [0, 0.004 * sc, 0]);
  const th = [t0, [kx - 0.004 * sc, hr * 0.74, -0.017 * sc], [-Rr * 0.3, hr * 0.94, -Rr * 0.98], [-Rr * 1.0, hr * 0.9, Rr * 0.1]];
  digit(m, th.map(xf), [fr * 1.2, fr * 1.08, fr * 0.95]);
  tipOf(th[2], th[3]);
  const K0 = xf([kx, 0, kz]), d = norm3(K0), s = norm3(sub3(xf([0, 1, 0]), xf([0, 0, 0])));
  // far away the fist is a knuckled lump round the shaft
  const far = new MB(), fc = xf([gr * 0.4, 0, kz * 0.3]);
  sweep(far, [[0, 0, 0], lerp3([0, 0, 0], fc, 0.6), fc], [0.011 * sc, 0.015 * sc * fat, 0.012 * sc * fat], { radial: 4 });
  sweep(far, [xf([0, hr * 0.8, 0]), xf([0, -hr * 0.8, 0])], Rr * 1.12, { radial: 5 });
  void corners;
  const fine = m.hard().shade(boneShade(23)).pbr(0.6), lump = far.hard().color(FAR_BONE).pbr(0.85);
  return { prims: carpals([0, 0, 0], d, s, sc * Math.sqrt(fat)), hard: keep ? [fine.near(), lump.far()] : [fine.lod(1), lump.from(2)] };
}

/** everything a human-sized skeleton is made of, before gear */
function skeletonBody(def, o, look) {
  const seed = hashStr(def.id || 'skeleton');
  const R = 0.086;
  const skull = buildSkull(R, { seed, glow: look.glow, gaps: look.gaps });
  const torso = buildTorso(look), pelvis = buildPelvis(), femur = buildFemur(), shin = buildShin(), humerus = buildHumerus(), fore = buildForearm();

  // ---- what is carried ----
  const w = o.weapon && o.weapon !== 'none' ? makeWeapon(o.weapon, { tint: look.rust ?? RUST }) : null;
  const held = w && w.hold && w.hold !== 'none' ? HOLD[w.hold] || HOLD.one : null;
  const hr = HR * HAND, gr = HR * 0.4;
  const gripAt = [-(gr + hr * 0.26) * 0.8, -hr, hr * 0.05];
  const gripRot = held ? (w.hold === 'bow' ? [90, 0, 0] : [90 - held.up, 0, held.lean]) : null;
  const twoHands = held && !o.shield && (w.hold === 'two' || w.hold === 'pole');
  const handR = held ? gripHand(gr, gripRot, gripAt, HAND, 1.12) : openHand(0.3, HAND);
  const handL = twoHands ? gripHand(gr, [60, 0, 0], gripAt, HAND, 1.12) : openHand(w && w.hold === 'bow' ? 0.8 : o.shield ? 0.9 : 0.35, HAND);

  const nodes = {}, order = [];
  const node = (name, parent, rig, pos, part, detail, rot) => {
    const n = { name, pos, prims: part ? flat(part.prims) : [], hard: part ? flat(part.hard) : [] };
    if (parent) n.parent = parent;
    if (rig) n.rig = rig;
    if (detail) n.detail = detail;
    if (rot && (rot[0] || rot[1] || rot[2])) n.rot = rot;
    nodes[name] = n; order.push(n);
    return n;
  };
  const mir = (part) => ({ prims: mirrorAll(part.prims), hard: mirrorAll(part.hard) });
  const shift = (part, d) => ({ prims: flat(part.prims).map((x) => x.at(d[0], d[1], d[2])), hard: flat(part.hard).map((x) => x.at(d[0], d[1], d[2])) });
  const hu = look.hunch ?? 6;
  const headAt = [0, NECK_TOP, spineZ(NECK_TOP)];
  const skullAt = sub3([0, 0, 0], skull.neck);                               // skull centre relative to the head joint
  node('root', null, null, [0, 0, 0], null);
  node('pelvis', 'root', null, [0, HIP_Y, 0], pelvis, 1.4);
  node('legL', 'root', 'legs', [HIP_X, HIP_Y, 0], femur, 1.42);
  node('shinL', 'legL', 'shins', [0, -THIGH, 0], shin, 1.5);
  node('legR', 'root', 'legs', [-HIP_X, HIP_Y, 0], mir(femur), 1.42);
  node('shinR', 'legR', 'shins', [0, -THIGH, 0], mir(shin), 1.5);
  node('torso', 'root', 'torso', [0, HIP_Y + TORSO_AT[1], TORSO_AT[2]], torso, 1.48, [hu, 0, 0]);
  node('cage', 'torso', null, [0, 0, 0], { prims: [], hard: torso.cage }, 1);          // ribs, and whatever is worn over them
  node('head', 'torso', 'head', headAt, shift({ prims: skull.prims, hard: skull.hard }, skullAt), 1.64, [-hu * 0.6, 0, 0]).minRes = 28;   // the face must survive the far levels
  node('jaw', 'head', 'jaw', add3(skullAt, skull.jaw.pivot), shift(skull.jaw, mul3(skull.jaw.pivot, -1)), 1.52, [look.gape ?? 3, 0, 0]).minRes = 28;
  node('armL', 'torso', 'arms', SHOULDER, humerus, 1.55, [-hu * 0.9, 0, 2]);
  node('foreL', 'armL', 'forearms', [0, -UPPER, 0], fore, 1.9);
  node('handL', 'foreL', 'hands', [0, -FORE, 0], handL, 2.1);
  node('armR', 'torso', 'arms', [-SHOULDER[0], SHOULDER[1], SHOULDER[2]], mir(humerus), 1.55, [-hu * 0.9, 0, -2]);
  node('foreR', 'armR', 'forearms', [0, -UPPER, 0], mir(fore), 1.9);
  node('handR', 'foreR', 'hands', [0, -FORE, 0], mir(handR), 2.1);

  let attack = w ? w.attack : 'claw', pass = 0;
  if (w && held) {
    const rot = w.hold === 'bow' ? [90, -24, 0] : [gripRot[0], 0, -gripRot[2]];
    const wn = node('weaponR', 'handR', 'weapon', [-gripAt[0], gripAt[1], gripAt[2]], { prims: w.prims, hard: w.hard }, 1.2, rot);
    if (o.weapon === 'longbow') pass = restring(wn, node);
  }
  if (o.shield) {
    const sh = makeShield({ color: look.shieldColor ?? 0x3b3150, shape: 'round', size: 0.9, device: look.device ?? 'none', metal: look.shieldMetal ?? 0x6a5648 });
    const yaw = 62, off = 0.034;
    node('shieldL', 'foreL', 'shield', [Math.sin(yaw * DEG) * off, -FORE * 0.58, Math.cos(yaw * DEG) * off], { prims: sh.prims, hard: sh.hard }, 1.2, [0, yaw, 0]);
  }
  const hold = held ? w.hold : 'none';
  return { nodes, order, node, hold, attack, skullAt, R, pass };
}

/**
 * A bow comes with a rigid string. Take it off and string the bow again as two halves, each its own node hinged at a
 * limb tip (rig list `string`), plus an arrow nocked where they meet (rig list `arrow`), so the animator can draw it.
 * Returns how far to the side of the grip the arrow passes the bow, or 0 if the bow's string could not be found.
 */
function restring(wn, node) {
  const box = (h) => { if (!h.geo.boundingBox) h.geo.computeBoundingBox(); return h.geo.boundingBox; };
  const isString = (h) => { const b = box(h); return b.max.x - b.min.x < 0.012 && b.max.z - b.min.z < 0.012 && b.max.z < -0.05; };
  const own = wn.hard.filter(isString);
  if (!own.length) return 0;
  wn.hard = wn.hard.filter((h) => !isString(h));
  let yTop = 0, yBot = 0, z = 0;
  for (const h of own) { const b = box(h); if (b.max.y > yTop) { yTop = b.max.y; z = (b.min.z + b.max.z) / 2; } yBot = Math.min(yBot, b.min.y); }
  const ny = 0.062, cord = 0xe4d9b8, serving = 0x6a5f48;
  const half = (len, sg) => {
    const m = new MB(), dark = new MB();
    sweep(m, [[0, 0, 0], [0, sg * (len - 0.03), 0]], 0.002, { radial: 5 });
    sweep(dark, [[0, sg * (len - 0.03), 0], [0, sg * len, 0]], 0.0029, { radial: 5 });
    return { prims: [], hard: [m.hard().color(cord).pbr(0.8).near(), dark.hard().color(serving).pbr(0.85).lod(1)] };
  };
  node('stringU', 'weaponR', 'string', [0, yTop, z], half(yTop - ny, -1));
  node('stringL', 'weaponR', 'string', [0, yBot, z], half(ny - yBot, 1));
  // the arrow: nock at the node's origin, point toward +Z
  const L = 0.45, shaft = new MB(), head = new MB(), vanes = new MB();
  sweep(shaft, [[0, 0, -0.004], [0, 0, L - 0.03]], 0.0027, { radial: 5 });
  sweep(head, [[0, 0, L - 0.04], [0, 0, L - 0.032], [0, 0, L - 0.012], [0, 0, L + 0.012]], [[0.0036, 0.0036], [0.0042, 0.0042], [0.0125, 0.003], [0.0006, 0.0006]], { radial: 4, up: [1, 0, 0] });
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094 + 0.52, n = [Math.cos(a), Math.sin(a), 0];
    cloth(vanes, 1, 4, (u, v) => add3([0, 0, lerp(0.012, 0.07, v)], mul3(n, 0.0027 + u * (0.012 * Math.sin(Math.PI * (0.12 + v * 0.8)) + 0.001))));
  }
  node('arrow', 'weaponR', 'arrow', [0, ny, z], { prims: [], hard: [
    shaft.hard().color(0x8a7450).pbr(0.8).lod(1),
    head.hard().shade(rustShade(5, 0x5a5860, 0.45)).pbr(0.55, 0.6).lod(1),
    vanes.hard().shade(clothShade(0x6a6a5e, 0.02, -0.02, 3, 0x2e2c2a)).pbr(0.9).lod(1),
  ] });
  return 0.0172;
}

// ---------- gear ----------
const CLOTH_W = 0x57426a, CLOTH_A = 0x7c7054, HOOD = 0x4a4350, LEATHER = 0x4a3020;
const MAIL_PBR = [0.5, 0.72];

/** dented spangenhelm with a bent nasal, in skull space (R = skull scale) */
function buildHelm(R, seed) {
  const C = [0, 0.1, -0.1], ZS = 1.13, HS = 1.17;
  const dents = [{ c: [0.62, 0.72, 0.45], r: 0.4, d: 0.085 }, { c: [-0.2, 1.0, 0.25], r: 0.18, d: 0.03 }];
  const map = (x, y, z) => {
    for (const dn of dents) { const d = Math.hypot(x - dn.c[0], y - dn.c[1], z - dn.c[2]); if (d < dn.r) { const f = 1 - (d / dn.r) ** 2, l = Math.hypot(x, y, z) || 1, push = dn.d * f * f; x -= (x / l) * push; y -= (y / l) * push; z -= (z / l) * push; } }
    // one clean sword cut across the left of the crown
    const cut = Math.abs(x * 0.5 + z * 0.3 + y * 0.8 - 0.86); if (cut < 0.05 && x > 0.1 && x < 0.7) y -= (0.05 - cut) * 0.7;
    const tx = 0.03 * y, ty = -0.03 * x;                                   // worn a little askew
    return [(C[0] + (x + tx) * HS) * R, (C[1] + (y + ty) * HS) * R, (C[2] + z * ZS * HS) * R];
  };
  const prof = smooth2([[0.002, 1.08], [0.13, 1.06], [0.33, 0.97], [0.56, 0.78], [0.78, 0.52], [0.93, 0.25], [1.0, 0], [1.02, -0.2]], 18);
  const shell = new MB(), trim = new MB(), rivets = new MB(), far = new MB();
  lathe(shell, [...prof, [0.93, -0.2]], 44, map);
  // brow band, and the two straps that cross the crown
  lathe(trim, [[1.012, 0.04], [1.06, 0.02], [1.065, -0.2], [1.03, -0.235], [0.95, -0.22]], 44, map);
  const over = (ang) => { const pts = []; for (const sg of [1, -1]) { const half = prof.slice(1).map(([r, y]) => [Math.cos(ang) * r * sg * 1.012, y * 1.006 + 0.004, Math.sin(ang) * r * sg * 1.012]); pts.push(...(sg > 0 ? half.reverse() : half)); } return pts; };
  for (const ang of [Math.PI / 2, 0]) {
    const pts = over(ang), side = ang ? [1, 0, 0] : [0, 0, 1];
    sweep(trim, pts.map((q) => map(q[0], q[1], q[2])), () => [0.085 * R, 0.022 * R], { radial: 4, phase: Math.PI / 4, up: side, caps: false });
    pts.forEach((q, i) => { if (i % 5 === 2) for (const sg of [1, -1]) { const c = map(q[0] + side[0] * 0.05 * sg, q[1], q[2] + side[2] * 0.05 * sg), l = Math.hypot(q[0], q[1], q[2]); bead(rivets, add3(c, mul3([q[0] / l, q[1] / l, q[2] * ZS / l], 0.018 * R)), 0.021 * R, 5); } });
  }
  for (let j = 0; j < 14; j++) { const a = (j / 14) * Math.PI * 2 + 0.22; bead(rivets, map(Math.cos(a) * 1.07, -0.09, Math.sin(a) * 1.07), 0.024 * R, 5); }
  lathe(trim, [[0.002, 1.2], [0.05, 1.17], [0.075, 1.11], [0.05, 1.06], [0.09, 1.04]], 8, map);                                    // finial
  // nasal: knocked sideways at some point
  const nas = spline([[0, -0.1, 1.07 * ZS], [0.01, -0.3, 1.07 * ZS + 0.02], [0.05, -0.52, 1.07 * ZS + 0.05], [0.1, -0.76, 1.07 * ZS + 0.06]], 8).map((q) => [(C[0] + q[0] * HS) * R, (C[1] + q[1] * HS) * R, (C[2] + q[2] * HS) * R]);
  sweep(trim, nas, (t) => [lerp(0.085, 0.12, sstep(0.5, 1, t)) * R * (t > 0.97 ? 0.6 : 1), 0.02 * R], { radial: 4, phase: Math.PI / 4, up: [1, 0, 0] });
  lathe(far, [[0.002, 1.07], [0.32, 0.96], [0.77, 0.52], [0.99, 0], [1.01, -0.19], [0.6, -0.19]], 16, (x, y, z) => [(C[0] + x * HS) * R, (C[1] + y * HS) * R, (C[2] + z * ZS * HS) * R]);
  sweep(far, [nas[0], nas[nas.length - 1]], () => [0.07 * R, 0.012 * R], { radial: 4, phase: Math.PI / 4, up: [1, 0, 0] });
  // torn mail curtain hanging inside the rim, round the back from cheek to cheek
  const mail = new MB(), mailFar = new MB();
  const curtain = (off) => ({
    top: (u) => { const a = lerp(-2.05, 2.05, u); return [Math.sin(a) * (1.1 + off) * R, -0.1 * R, (-0.1 - Math.cos(a) * (1.24 + off)) * R]; },
    out: (u) => { const a = lerp(-2.05, 2.05, u); return [Math.sin(a), 0, -Math.cos(a)]; },
    len: (u) => (1.5 + 0.22 * Math.sin(u * 9 + seed) - 0.5 * sstep(0.62, 1, u)) * R,
    flare: 0.3 * R, fold: 0.045 * R, folds: 6, fray: 0.42, holes: 0.08, slits: 0.12, seed: seed % 13 + 2,
  });
  rag(mail, { ...curtain(0), sx: 58, sy: 18, tint: mailTint(seed), grain: 0.0009, stepped: true });
  rag(mailFar, { ...curtain(-0.05), sx: 7, sy: 2, holes: 0, slits: 0 });
  return [
    shell.hard().shade(rustShade(seed, 0x5a5860, 0.4)).pbr(0.6, 0.65).lod(1),
    trim.hard().shade(rustShade(seed + 4, 0x45434a, 0.5)).pbr(0.62, 0.6).lod(1),
    rivets.hard().shade(rustShade(seed + 9, 0x6a6460, 0.3)).pbr(0.5, 0.7).lod(0),
    far.hard().color(mix(0x5a5860, 0x8a4f30, 0.62)).pbr(0.66, 0.55).from(2),
    mail.hard().pbr(...MAIL_PBR).lod(1),
    mailFar.hard().color(0x5a5458).pbr(0.6, 0.6).from(2),
  ];
}

/**
 * A surface that drapes the shoulders and upper chest like a short poncho (torso space).
 * th: angle round the body (0 = spine, PI/2 = right side, PI = breastbone, 3PI/2 = left side); v: 0 at the neck, v1 at the
 * point of the shoulder, 1 at the hem `drop` below it. off pushes the cloth off the bones.
 */
function drape(th, v, drop, off = 0.012, v1 = 0.3, soft = 0) {
  if (soft > 0) {
    // round the shoulder: average the surface a little way up and down the cloth
    const a = drape(th, Math.max(0, v - soft), drop, off, v1), b = drape(th, v, drop, off, v1), c = drape(th, Math.min(1, v + soft), drop, off, v1);
    return [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4];
  }
  const two = Math.PI * 2, a = ((th % two) + two) % two, sx = a <= Math.PI ? -1 : 1, phi = a <= Math.PI ? a : two - a;
  const s = Math.sin(phi), c = Math.cos(phi), wr = (noise3(a * 2.2, v * 5, 1.7) - 0.5) * 0.012;
  const sh = [sx * (0.174 + off) * Math.pow(Math.abs(s), 0.85), 0.252 + off * 0.5 + 0.02 * c * c, 0.004 - (0.078 + off) * Math.sign(c) * Math.pow(Math.abs(c), 0.85)];
  if (v <= v1) {
    const t = v / v1, nk = [sx * 0.05 * s, 0.31 + off * 0.5, -0.004 - 0.05 * c];
    return [lerp(nk[0], sh[0], t), lerp(nk[1], sh[1], Math.pow(t, 1.9)) + wr * t * (1 - t) * 2, lerp(nk[2], sh[2], t)];
  }
  const t = (v - v1) / (1 - v1), y = sh[1] - drop * t;
  const cg = cagePoint(Math.max(0.09, y), phi, off + 0.004, sx), hug = sstep(0.95, 0.45, Math.abs(s)) * sstep(0, 0.55, t);
  const out = 1 + wr * 1.5 * t;
  return [lerp(sh[0], cg[0], hug) * out, y, lerp(sh[2], cg[2], hug) * out];
}

/** belt over the hip bones (hip space); returns the edge the cloth hangs from */
function buildBelt(m, hw, o = {}) {
  const y0 = o.y ?? 0.074, rx = o.rx ?? 0.116, rz = o.rz ?? 0.07, zc = -0.012;
  const at = (a) => [Math.sin(a) * rx, y0 + 0.012 * Math.cos(a) * -1 + 0.01 * Math.abs(Math.sin(a)), zc + Math.cos(a) * rz * (Math.cos(a) > 0 ? 1.22 : 1)];
  const pts = []; for (let j = 0; j <= 28; j++) pts.push(at((j / 28) * Math.PI * 2 + Math.PI));
  sweep(m, pts, () => [hw, 0.0032], { radial: 4, phase: Math.PI / 4, up: [0, 1, 0], caps: false });
  return at;
}
function buckle(m, c, w = 0.014, h = 0.011) {
  for (const [dx, dy] of [[-w, 0], [w, 0], [0, h], [0, -h]]) sweep(m, [[c[0] + dx - (dy ? w : 0), c[1] + dy - (dx ? h : 0), c[2] + 0.005], [c[0] + dx + (dy ? w : 0), c[1] + dy + (dx ? h : 0), c[2] + 0.005]], 0.0028, { radial: 5 });
  sweep(m, [[c[0] - w, c[1], c[2] + 0.006], [c[0] + w * 0.6, c[1] + 0.002, c[2] + 0.008]], 0.0018, { radial: 4 });
}

function dressWarrior(B, seed) {
  const { nodes, skullAt, R } = B;
  nodes.head.hard.push(...buildHelm(R, seed).map((h) => h.at(skullAt[0], skullAt[1], skullAt[2])));
  // what is left of a mail shirt: the collar, the sword-arm shoulder, half the chest and back
  const mail = new MB(), mailFar = new MB();
  const th = (u) => lerp(-0.75, 4.15, u);
  const drop = (u) => 0.03 + 0.105 * sstep(0.02, 0.3, u) * sstep(1.02, 0.6, u) + 0.02 * Math.sin(u * 17 + seed);
  const shirt = (off) => (u, v, g) => { const q = drape(th(u), v, drop(u), off + g); return q; };
  rag(mail, { surf: shirt(0.013), sx: 84, sy: 30, seed: seed % 11 + 3, fray: 0.4, holes: 0.07, slits: 0.08, tint: mailTint(seed + 3), grain: 0.0009, stepped: true, keep: (u, v) => v < 0.22 + 7 * Math.min(u - 0.03, 0.97 - u) });
  rag(mailFar, { surf: shirt(0.009), sx: 9, sy: 3, seed: seed % 11 + 3, fray: 0.3, holes: 0, slits: 0 });
  nodes.cage.hard.push(mail.hard().pbr(...MAIL_PBR).lod(1), mailFar.hard().color(0x5a5458).pbr(0.6, 0.6).from(2));
  // belt, buckle and what is left of a tabard
  const belt = new MB(), rags = new MB(), ragsFar = new MB(), iron = new MB();
  const at = buildBelt(belt, 0.0105);
  const span = (a0, a1) => (u) => at(lerp(a0, a1, u));
  const outOf = (a0, a1) => (u) => { const a = lerp(a0, a1, u); return norm3([Math.sin(a), 0, Math.cos(a)]); };
  const front = { top: span(-0.42, 0.42), out: outOf(-0.42, 0.42), len: (u) => 0.235 - 0.03 * Math.abs(u - 0.4), seed: seed % 7 + 1, flare: 0.012, fold: 0.007, folds: 1.5, fray: 0.3, lean: [0, 0, -0.03] };
  const back = { top: span(Math.PI - 0.5, Math.PI + 0.5), out: outOf(Math.PI - 0.5, Math.PI + 0.5), len: (u) => 0.18 + 0.06 * u, seed: seed % 5 + 4, flare: 0.02, fold: 0.008, folds: 2, fray: 0.45, lean: [0, 0, 0.02] };
  rag(rags, { ...front, sx: 14, sy: 18, holes: 0.1, slits: 0.22 });
  rag(rags, { ...back, sx: 14, sy: 16, holes: 0.14, slits: 0.3 });
  rag(rags, { top: span(1.0, 1.75), out: outOf(1.0, 1.75), len: (u) => 0.1 + 0.05 * u, sx: 8, sy: 8, seed: 9, flare: 0.02, fold: 0.006, folds: 1.5, fray: 0.5, holes: 0.1, slits: 0.3 });
  rag(ragsFar, { ...front, sx: 3, sy: 3, holes: 0, slits: 0, fold: 0 });
  rag(ragsFar, { ...back, sx: 3, sy: 3, holes: 0, slits: 0, fold: 0 });
  buckle(iron, at(0.08));
  nodes.pelvis.hard.push(
    belt.hard().shade(clothShade(LEATHER, 0.1, 0.04, 3, 0x2a2018)).pbr(0.78).near(),
    rags.hard().shade(clothShade(CLOTH_W, 0.08, -0.2, seed % 9)).pbr(0.95).lod(1),
    ragsFar.hard().color(mix(CLOTH_W, 0x3a3226, 0.35)).pbr(0.95).from(2),
    iron.hard().shade(rustShade(seed + 2, 0x6a6460, 0.5)).pbr(0.6, 0.6).lod(1),
  );
  // a strip of cape still pinned at the right shoulder
  const cape = new MB();
  rag(cape, { top: (u) => [lerp(-0.14, -0.03, u), 0.272 - 0.008 * u, -0.088 - 0.012 * Math.sin(u * Math.PI)], out: () => [0, 0, -1], len: (u) => 0.2 + 0.1 * Math.sin(u * 2.4), sx: 12, sy: 16, seed: 5, flare: 0.03, fold: 0.008, folds: 2, fray: 0.5, holes: 0.16, slits: 0.3, lean: [0.015, 0, -0.02] });
  nodes.cage.hard.push(cape.hard().shade(clothShade(CLOTH_W, 0.27, 0.0, 6)).pbr(0.95).near());
}

/** deep ragged hood with a cowl falling to the shoulders (skull space) */
function buildHood(R, seed) {
  const rnd = rng(seed + 21), p = [];
  const wool = (x) => x.color(HOOD).tint(0.36, 13).pbr(0.96).bump(0.003, 19, 'noise');
  const E = (rx, ry, rz) => S.ellipsoid(rx * R, ry * R, rz * R);
  p.push(wool(E(1.1, 1.06, 1.3)).at(0, 0.17 * R, -0.17 * R));
  p.push(...S.limb([[0, 0.9 * R, -0.9 * R], [0.06 * R, 0.62 * R, -1.5 * R], [0.16 * R, 0.1 * R, -1.82 * R], [0.2 * R, -0.3 * R, -1.8 * R]], [0.4 * R, 0.24 * R, 0.12 * R, 0.05 * R]).map((c) => wool(c).blend(0.03)));   // the tail of the hood, fallen back
  p.push(wool(S.cone(1.5 * R, 1.0 * R, 1.25 * R, 0.03 * R)).at(0, -1.02 * R, -0.14 * R).blend(0.02));                  // cowl
  for (let j = 0; j < 7; j++) {                                                                                         // folds running down from the crown
    const a = (-130 + j * 43 + rnd() * 14) * DEG, sn = Math.sin(a), cs = -Math.cos(a);
    p.push(wool(S.capsule([sn * 0.75 * R, 0.75 * R, (-0.17 + cs * 0.85) * R], [sn * 1.44 * R, -1.5 * R, (-0.14 + cs * 1.44) * R], 0.07 * R, 0.13 * R)).blend(0.03));
  }
  p.push(E(0.95, 0.92, 1.15).at(0, 0.15 * R, -0.19 * R).cut(0.003).color(0x17151a));
  p.push(S.cone(1.36 * R, 0.86 * R, 1.5 * R).at(0, -1.02 * R, -0.14 * R).cut(0.003).color(0x17151a));
  p.push(E(0.76, 1.0, 0.85).rot(-8, 0, 0).at(0, -0.44 * R, 1.02 * R).cut(0.006));                                       // face opening
  p.push(S.box(0.5 * R, 1.4 * R, 1.2 * R, 0.1 * R).at(0, -1.3 * R, 1.3 * R).cut(0.004));                                // split under the chin
  for (let j = 0; j < 12; j++) { const a = (j / 12) * Math.PI * 2 + rnd(), r = (0.14 + rnd() * 0.26) * R; p.push(S.sphere(r).at(Math.sin(a) * 1.48 * R, (-1.62 + (rnd() - 0.5) * 0.1) * R, (-0.14 + Math.cos(a) * 1.48) * R).cut(0.003)); }
  for (const [x, y, r] of [[-0.74, 0.3, 0.09], [0.7, -0.1, 0.07], [-0.5, 0.72, 0.06], [0.76, -0.75, 0.1]]) p.push(S.sphere(r * R).at(x * R, y * R, 0.62 * R).cut(0.003));   // nicks in the hem round the face
  p.push(S.sphere(0.55 * R).at(0.6 * R, 0.7 * R, -0.6 * R).color(mix(HOOD, 0x6a6250, 0.45)).paint(0.03, 0), S.sphere(0.7 * R).at(-0.5 * R, -1.2 * R, -1.0 * R).color(mix(HOOD, 0x242020, 0.6)).paint(0.04, 0), S.sphere(0.5 * R).at(-0.8 * R, 0.5 * R, 0.2 * R).color(mix(HOOD, 0x5a5444, 0.4)).paint(0.03, 0));
  // The cloth is a thin shell, so it is sculpted once here at a resolution it survives and kept for the two closest
  // levels; beyond that a plain cap and collar, hidden inside the cloth up close, stand in for it.
  const g = part(`hood${seed}`, (q) => buildPartGeometry({ prims: p }, { res: 110 * Math.max(1, q) }));
  const far = new MB();
  lathe(far, [[0.002, 1.22], [0.45, 1.12], [0.86, 0.76], [1.03, 0.26], [1.0, -0.3], [1.16, -1.0], [1.4, -1.56]], 10, (x, y, z) => { const k = sstep(-0.7, 0, y); return [x * R, y * R, (z * lerp(1, 1.2, k) - lerp(0.14, 0.17, k)) * R]; }, Math.PI * 1.36, Math.PI * 0.82);
  return { prims: [], hard: [cast(g).pbr(0.96).lod(1), far.hard().color(mix(HOOD, 0x242020, 0.25)).pbr(0.96).from(2)] };
}

function dressArcher(B, seed) {
  const { nodes, skullAt, R } = B;
  nodes.head.hard.push(...buildHood(R, seed).hard.map((h) => h.at(skullAt[0], skullAt[1], skullAt[2])));
  // tattered mantle over the shoulders, under the cowl
  const mantle = new MB(), mantleFar = new MB();
  const mdrop = (u) => 0.1 + 0.05 * Math.sin(u * 6.3 + 1) + 0.035 * Math.sin(u * 17);
  const folds = (u, v) => 1 + 0.045 * sstep(0.25, 1, v) * Math.sin(u * 58 + 2.4 * Math.sin(u * 13)) + 0.02 * sstep(0.3, 1, v);
  rag(mantle, { surf: (u, v) => { const q = drape(u * Math.PI * 2, 0.16 + v * 0.84, mdrop(u), 0.017, 0.3, 0.055), f = folds(u, v); return [q[0] * f, q[1], q[2] * f]; }, sx: 72, sy: 20, seed: 4, fray: 0.5, holes: 0.1, slits: 0.2 });
  rag(mantleFar, { surf: (u, v) => drape(u * Math.PI * 2, 0.16 + v * 0.84, mdrop(u) * 0.8, 0.011), sx: 10, sy: 2, seed: 4, fray: 0.2, holes: 0, slits: 0 });
  nodes.cage.hard.push(mantle.hard().shade(clothShade(mix(HOOD, 0x57426a, 0.25), 0.32, 0.1, 2)).pbr(0.96).lod(1), mantleFar.hard().color(mix(HOOD, 0x3a3226, 0.3)).pbr(0.96).from(2));

  // quiver slung across the back, fletchings over the left shoulder
  const qa = [-0.062, 0.085, -0.092], qb = [0.068, 0.3, -0.108], ax = norm3(sub3(qb, qa));
  const quiver = new MB(), trim = new MB(), shafts = new MB(), feathers = new MB(), strap = new MB();
  const qpts = [0, 0.04, 0.3, 0.7, 0.93, 1].map((t) => lerp3(qa, qb, t));
  sweep(quiver, qpts, [0.012, 0.021, 0.0235, 0.026, 0.0275, 0.0265], { radial: 10 });
  for (const t of [0.12, 0.62, 0.97]) sweep(trim, [lerp3(qa, qb, t - 0.02), lerp3(qa, qb, t + 0.02)], lerp(0.0235, 0.029, t), { radial: 10 });
  const side = norm3(cross3(ax, [0, 0, 1])), fwd = cross3(side, ax);
  const arrows = [[0.008, 0.004, 0.115], [-0.009, 0.006, 0.09], [0.002, -0.009, 0.125], [-0.004, 0.012, 0.07], [0.012, -0.004, 0.1]];
  for (const [dx, dz, up] of arrows) {
    const base = add3(add3(lerp3(qa, qb, 0.6), mul3(side, dx)), mul3(fwd, dz)), tip = add3(add3(qb, mul3(side, dx * 1.7)), add3(mul3(fwd, dz * 1.7), mul3(ax, up)));
    sweep(shafts, [base, tip], 0.0024, { radial: 5 });
    const d = norm3(sub3(tip, base));
    for (let k = 0; k < 3; k++) {
      const a = k * 2.094 + dx * 90, n = add3(mul3(side, Math.cos(a)), mul3(fwd, Math.sin(a)));
      const f0 = add3(tip, mul3(d, -0.008)), f1 = add3(tip, mul3(d, -0.05));
      cloth(feathers, 1, 3, (u, v) => add3(lerp3(f0, f1, v), mul3(n, u * (0.011 * Math.sin(Math.PI * (0.15 + v * 0.8)) + 0.002))));
    }
  }
  // strap: over the left shoulder, across the chest, round under the right arm
  const sp = [[4.9, 0.262, 0.3], [4.2, 0.268, 0.3], [3.6, 0.24, 0.6], [3.14, 0.205, 1], [2.5, 0.165, 1], [1.9, 0.13, 1], [1.2, 0.11, 1], [0.6, 0.1, 1]];
  const spts = spline(sp.map(([a, y, k]) => { const two = Math.PI * 2, t = a % two, sx = t <= Math.PI ? -1 : 1, phi = t <= Math.PI ? t : two - t; const c = cagePoint(Math.max(0.09, Math.min(y, 0.25)), phi, 0.012, sx), d = drape(a, 0.3, 0, 0.004); return y > 0.25 ? d : lerp3(d, c, k); }), 30);
  const sups = spts.map((q, i) => { const t = norm3(sub3(spts[Math.min(29, i + 1)], spts[Math.max(0, i - 1)])); const n = norm3([q[0], 0, q[2] - 0.03]); return norm3(cross3(n, t)); });
  sweep(strap, spts, () => [0.0085, 0.0022], { radial: 4, phase: Math.PI / 4, up: (t) => sups[Math.round(t * 29)] });
  const iron = new MB();
  buckle(iron, add3(spts[13], [0, 0, 0.002]), 0.009, 0.008);
  nodes.cage.hard.push(
    quiver.hard().shade(clothShade(0x5a3c26, 0.32, 0.06, 5, 0x2a2018)).pbr(0.75).near(),
    trim.hard().shade(clothShade(0x3a2618, 0.32, 0.06, 7, 0x1e1610)).pbr(0.7).lod(1),
    shafts.hard().color(0x8a7450).pbr(0.8).near(),
    feathers.hard().shade(clothShade(0x6a6a5e, 0.45, 0.3, 3, 0x2e2c2a)).pbr(0.9).lod(1),
    strap.hard().shade(clothShade(LEATHER, 0.3, 0.05, 8, 0x2a2018)).pbr(0.78).near(),
    iron.hard().shade(rustShade(seed + 2, 0x6a6460, 0.5)).pbr(0.6, 0.6).lod(1),
  );
  // an old arrow still lodged between the ribs
  const old = new MB(), oldF = new MB();
  const o0 = [0.03, 0.15, -0.02], o1 = [0.16, 0.175, 0.14];
  sweep(old, [o0, o1], 0.0024, { radial: 5 });
  const od = norm3(sub3(o1, o0)), os = norm3(cross3(od, [0, 1, 0])), ou = cross3(os, od);
  for (let k = 0; k < 3; k++) { const a = k * 2.094, n = add3(mul3(os, Math.cos(a)), mul3(ou, Math.sin(a))); cloth(oldF, 1, 3, (u, v) => add3(lerp3(add3(o1, mul3(od, -0.006)), add3(o1, mul3(od, -0.042)), v), mul3(n, u * (0.009 * Math.sin(Math.PI * (0.15 + v * 0.8)) + 0.002)))); }
  nodes.cage.hard.push(old.hard().color(0x6a5a40).pbr(0.85).lod(1), oldF.hard().shade(clothShade(0x5a2a22, 0.2, 0.1, 3, 0x2e2c2a)).pbr(0.9).lod(1));

  // bracer laced round the bow arm (the right forearm is the mirror of the left, so lateral is -X here)
  const br = new MB(), lace = new MB();
  const bq = FORE / 0.16, bpts = [-0.05, -0.065, -0.1, -0.128, -0.138].map((y) => [-0.004, y * bq, -0.002]);
  sweep(br, bpts, [[0.026, 0.0215], [0.0275, 0.0225], [0.0265, 0.0212], [0.0245, 0.02], [0.0255, 0.021]], { radial: 14, caps: false, up: [1, 0, 0] });
  for (const y of [-0.058, -0.094, -0.13]) sweep(lace, [[-0.004, y * bq - 0.004, -0.002], [-0.004, y * bq + 0.004, -0.002]], [[0.029, 0.0238], [0.029, 0.0238]], { radial: 14, up: [1, 0, 0] });
  nodes.foreR.hard.push(br.hard().shade(clothShade(0x54381f, -0.04, -0.14, 4, 0x2a2018)).pbr(0.72).near(), lace.hard().shade(clothShade(0x33221a, -0.04, -0.14, 6, 0x1e1610)).pbr(0.7).lod(1));

  // rope belt and a ragged kilt
  const belt = new MB(), rags = new MB(), ragsFar = new MB();
  const at = buildBelt(belt, 0.006, { y: 0.07 });
  const ka = (u) => lerp(Math.PI + 0.75, Math.PI * 3 - 0.2, u);                      // wrapped from the left hip round the back, open over the left thigh
  const kilt = { top: (u) => at(ka(u)), out: (u) => norm3([Math.sin(ka(u)), 0, Math.cos(ka(u))]), len: (u) => 0.15 + 0.06 * Math.sin(u * 11 + 1) + 0.03 * Math.sin(u * 29), seed: 6, flare: 0.045, fold: 0.011, folds: 8, fray: 0.6 };
  rag(rags, { ...kilt, sx: 72, sy: 16, holes: 0.14, slits: 0.3 });
  rag(ragsFar, { ...kilt, sx: 9, sy: 2, holes: 0, slits: 0, fold: 0, flare: 0.022, fray: 0.25 });
  nodes.pelvis.hard.push(
    belt.hard().shade(clothShade(0x8a7a58, 0.1, 0.04, 3, 0x3a3020)).pbr(0.9).near(),
    rags.hard().shade(clothShade(CLOTH_A, 0.08, -0.14, 5)).pbr(0.96).lod(1),
    ragsFar.hard().color(mix(CLOTH_A, 0x3a3226, 0.4)).pbr(0.96).from(2),
  );
}

/** scale a finished node list about each node's own origin: everything grows together, so gear stays fitted */
function enlarge(order, k) {
  for (const n of order) {
    n.pos = mul3(n.pos, k);
    for (const x of n.prims) x.scale(k);
    for (const x of n.hard) x.scale(k);
    if (n.detail) n.detail /= k;
  }
}

function skeleton(def = {}, o = {}) {
  const archer = o.weapon === 'longbow' || def.style === 'ranged';
  const seed = hashStr(def.id || 'skeleton');
  const look = archer ? { glow: 0x62ffd0, gaps: 0.16, gape: 4, hunch: 4 } : { glow: 0x62ffd0, gaps: 0.1, gape: 2, hunch: 6, broken: [5, 1, 1.5], shieldColor: 0x44334f, device: { kind: 'saltire', color: 0xa39674 } };
  const B = skeletonBody(def, o, look);
  if (archer) dressArcher(B, seed); else dressWarrior(B, seed);
  enlarge(B.order, BUILD);
  return { kind: `skeleton.${B.hold}${o.shield ? '.shield' : ''}`, attack: B.attack || 'swing', nodes: B.order, hold: B.hold, build: BUILD, pass: B.pass * BUILD };
}

// =====================================================================================
//  Bone Colossus: a construct lashed together from many skeletons
// =====================================================================================
// Its parts are sculpted once and reused: a long bone, a vertebra, a small skull, an armour plate. Each comes in tiers:
// `fine` for the two closest levels (.lod(1)), `mid` for the levels between those and the last (.from(2).near()), and
// something very cheap for the last level and the merged far mesh (.far()).
const BONE_L = 0.24;
const boneParts = () => part('bone', (q) => {
  // a straight long bone from the origin down -Y: ball and trochanter at the top, twin condyles at the bottom
  const L = BONE_L, p = [];
  p.push(bone(S.sphere(0.02)).at(-0.008, -0.004, 0), bone(S.ellipsoid(0.012, 0.017, 0.013)).at(0.013, -0.006, -0.002).blend(0.012));
  p.push(...S.limb([[0, -0.02, 0], [0.001, -L * 0.5, 0.004], [0, -L + 0.03, 0]], [0.0135, 0.011, 0.013]).map((c, i) => bone(c).bump(0.0013, 50).blend(i ? 0.004 : 0.014)));
  p.push(bone(S.ellipsoid(0.021, 0.017, 0.016)).at(0, -L + 0.02, 0).blend(0.014));
  p.push(bone(S.sphere(0.0155)).at(0.012, -L + 0.006, -0.003).blend(0.008), bone(S.sphere(0.0155)).at(-0.012, -L + 0.006, -0.003).blend(0.008));
  p.push(S.sphere(0.022).at(0.01, -L * 0.45, 0.012).color(mix(BONE, STAIN, 0.5)).paint(0.03, 0), S.sphere(0.03).at(0, -L, 0).color(mix(BONE, STAIN, 0.4)).paint(0.03, 0));
  return { fine: buildPartGeometry({ prims: p }, { res: 100 * q }), mid: buildPartGeometry({ prims: p }, { res: 36 }) };
});
const VERT_H = 0.036;
const vertParts = () => part('vert', (q) => {
  // one vertebra, axis +Y, back toward -Z, with the dried disc on top
  const r = 0.03, p = [];
  p.push(bone(S.cyl(r, 0.026, 0.008)).bump(0.0013, 46));
  p.push(S.cyl(r * 0.8, 0.014, 0.002).at(0, 0.018, 0).color(GRISTLE).pbr(0.9).blend(0.003));
  p.push(bone(S.sphere(r * 0.64)).at(0, 0, -r * 0.95).blend(0.008));
  p.push(bone(S.capsule([0, 0, -r * 1.2], [0, -r * 0.9, -r * 2.5], r * 0.32, r * 0.2)).blend(0.008));
  p.push(...both(bone(S.capsule([r * 0.6, 0, -r * 0.7], [r * 2.0, r * 0.12, -r * 1.2], r * 0.3, r * 0.22)).blend(0.008)));
  return { fine: buildPartGeometry({ prims: p }, { res: 122 * q }), mid: buildPartGeometry({ prims: p }, { res: 42 }) };
});
const SKULL_R = 0.05;
const skullParts = () => part('skull', (q) => {
  const sk = buildSkull(SKULL_R, { seed: 77, glow: null, gaps: 0.22 }), prims = [...sk.prims, ...sk.jaw.prims];
  return { fine: buildPartGeometry({ prims }, { res: 134 * q }), plain: buildPartGeometry({ prims }, { res: 100 * q }), mid: buildPartGeometry({ prims }, { res: 56 }), far: buildPartGeometry({ prims }, { res: 27 }), teeth: [sk.hard[0], sk.jaw.hard[0]] };
});
const plateParts = () => part('plate', (q) => {
  // a ribbed, scallop-edged slab of old bone: outer face +Z, hinge at the top, lashing holes drilled through
  const p = [], old = (x) => x.color(mix(BONE, BONE_LO, 0.35)).tint(0.3, 20).pbr(0.66);
  p.push(old(S.ellipsoid(0.06, 0.086, 0.02)).bump(0.0016, 40));
  p.push(S.sphere(0.13).at(0, 0, -0.127).cut(0.008).color(mix(BONE_LO, STAIN, 0.5)));
  for (let j = 0; j < 5; j++) {
    const x = (j - 2) * 0.024, y = -0.072 + Math.abs(j - 2) * 0.012;
    p.push(old(S.capsule([x * 0.25, 0.062, 0.014], [x, y, 0.008], 0.0062, 0.0075)).color(BONE).blend(0.007));
    if (j < 4) p.push(S.sphere(0.011).at(x + 0.012, y - 0.004 + (j === 1 || j === 2 ? -0.006 : 0), 0.004).cut(0.004).color(mix(BONE_LO, STAIN, 0.5)));
  }
  p.push(old(S.torus(0.02, 0.006).rot(90, 0, 0)).color(BONE).at(0, 0.064, 0.012).blend(0.006));
  for (const sx of [1, -1]) p.push(S.cyl(0.0055, 0.08, 0).rot(90, 0, 0).at(sx * 0.03, 0.045, 0).cut(0.002).color(SOCKET));
  p.push(S.ellipsoid(0.05, 0.04, 0.03).at(0.02, -0.04, 0.012).color(mix(BONE, STAIN, 0.6)).paint(0.03, 0), S.ellipsoid(0.03, 0.03, 0.03).at(-0.035, 0.03, 0.012).color(mix(BONE, STAIN, 0.4)).paint(0.03, 0));
  return { fine: buildPartGeometry({ prims: p }, { res: 100 * q }), mid: buildPartGeometry({ prims: p }, { res: 34 }) };
});

const _mB = new THREE.Matrix4(), _eB = new THREE.Euler(), _vX = new THREE.Vector3(), _vY = new THREE.Vector3(), _vZ = new THREE.Vector3();
/** turn a piece so its +Y lies along yDir with +Z leaning toward zHint, then move it to origin */
function orient(piece, origin, yDir, zHint = [0, 0, 1]) {
  _vY.set(yDir[0], yDir[1], yDir[2]).normalize(); _vZ.set(zHint[0], zHint[1], zHint[2]);
  _vX.crossVectors(_vY, _vZ);
  if (_vX.lengthSq() < 1e-8) _vX.crossVectors(_vY, _vZ.set(1, 0, 0));
  _vX.normalize(); _vZ.crossVectors(_vX, _vY);
  _eB.setFromRotationMatrix(_mB.makeBasis(_vX, _vY, _vZ), 'XYZ');
  return piece.rot(_eB.x / DEG, _eB.y / DEG, _eB.z / DEG).at(origin[0], origin[1], origin[2]);
}
/** the same, but aiming the piece's +Z along zDir with +Y leaning toward yHint */
function face(piece, origin, zDir, yHint = [0, 1, 0]) {
  _vZ.set(zDir[0], zDir[1], zDir[2]).normalize(); _vY.set(yHint[0], yHint[1], yHint[2]);
  _vX.crossVectors(_vY, _vZ);
  if (_vX.lengthSq() < 1e-8) _vX.crossVectors(_vY.set(0, 0, 1), _vZ);
  _vX.normalize(); _vY.crossVectors(_vZ, _vX);
  _eB.setFromRotationMatrix(_mB.makeBasis(_vX, _vY, _vZ), 'XYZ');
  return piece.rot(_eB.x / DEG, _eB.y / DEG, _eB.z / DEG).at(origin[0], origin[1], origin[2]);
}
/** a long bone from a to b, `thick` times life size; its far stand-in is a knobbed rod added to `far` */
function placeBone(out, far, a, b, thick = 1, zHint = [0, 0, 1], mul = 1) {
  const L = len3(sub3(b, a)), P = boneParts();
  out.push(orient(cast(P.fine, mul * 0.92, STAIN, 0.14).scale(thick, L / BONE_L, thick), a, sub3(a, b), zHint).lod(1));
  out.push(orient(cast(P.mid, mul * 0.92, STAIN, 0.14).scale(thick, L / BONE_L, thick), a, sub3(a, b), zHint).from(2).near());
  farBone(far, [a, b], 0.0128 * thick);
}
/** a small skull, face along `dir` */
function placeSkull(out, farList, at, dir, sc = 1, o = {}) {
  const P = skullParts(), up = o.up || [0, 1, 0];
  out.push(face(cast(o.best ? P.fine : P.plain, o.mul ?? 1).scale(sc), at, dir, up).lod(1));
  for (const t of P.teeth) out.push(face(t.clone().scale(sc), at, dir, up).lod(0));
  out.push(face(cast(P.mid, o.mul ?? 1).scale(sc), at, dir, up).from(2).near());
  farList.push(face(cast(P.far, o.mul ?? 1).scale(sc), at, dir, up).far());
  if (o.glow != null) for (const sx of [1, -1]) out.push(face(H.sphere(0.0042 * sc, 8).at(sx * 0.375 * SKULL_R * sc, -0.28 * SKULL_R * sc, 0.62 * SKULL_R * sc), at, dir, up).color(o.glow).glow(1.3).lod(1));
}
function placePlate(out, at, normal, sc = 1, yHint = [0, 1, 0], mul = 1, sy = 1) {
  out.push(face(cast(plateParts().fine, mul).scale(sc, sc * sy, sc), at, normal, yHint).lod(1));
  out.push(face(cast(plateParts().mid, mul).scale(sc, sc * sy, sc), at, normal, yHint).from(2).near());
}
/** dried sinew wound round a bundle: a few turns of cord about `axis` at radius R */
function lash(m, c, axis, R, turns = 2.4, rise = 0.022, r = 0.0046, squash = 1) {
  const ax = norm3(axis), u = norm3(cross3(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), v = cross3(ax, u), pts = [];
  const n = Math.ceil(turns * 7);
  for (let j = 0; j <= n; j++) { const a = (j / n) * turns * Math.PI * 2, h = rise * (j / n - 0.5), w = R * (1 + 0.04 * Math.sin(a * 3.1)); pts.push([c[0] + ax[0] * h + (u[0] * Math.cos(a) + v[0] * Math.sin(a) * squash) * w, c[1] + ax[1] * h + (u[1] * Math.cos(a) + v[1] * Math.sin(a) * squash) * w, c[2] + ax[2] * h + (u[2] * Math.cos(a) + v[2] * Math.sin(a) * squash) * w]); }
  return sweep(m, pts, r, { radial: 4, up: ax });
}
/** a chain of oval links hung through pts; its far stand-in is a thin bar */
function chain(m, far, pts, link = 0.03, w = 0.0105, r = 0.0036) {
  let total = 0; for (let j = 1; j < pts.length; j++) total += len3(sub3(pts[j], pts[j - 1]));
  const n = Math.max(2, Math.round(total / (link * 0.7))), path = spline(pts, n + 1);
  for (let j = 0; j < n; j++) {
    const c = lerp3(path[j], path[j + 1], 0.5), t = norm3(sub3(path[j + 1], path[j]));
    const s0 = norm3(cross3(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), s1 = cross3(t, s0), sd = j % 2 ? s0 : s1, nrm = j % 2 ? s1 : s0;
    const loop = [], hl = link / 2 - w;
    for (let q = 0; q <= 8; q++) { const k = q % 8, a = (k / 8) * Math.PI * 2, cx = Math.cos(a) * w, sy = Math.sin(a) * w + (k < 4 ? hl : -hl) * (k === 0 || k === 4 ? 0 : 1); loop.push([c[0] + sd[0] * cx + t[0] * sy, c[1] + sd[1] * cx + t[1] * sy, c[2] + sd[2] * cx + t[2] * sy]); }
    sweep(m, loop, r, { radial: 4, up: nrm, caps: false });
  }
  if (far) sweep(far, spline(pts, Math.max(3, Math.round(n / 4))), r * 1.5, { radial: 3 });
  return m;
}
/** a knotted column: reads as a string of small vertebrae */
function beads(m, pts, r, count, radial = 6) {
  const path = spline(pts, count * 4 + 1);
  return sweep(m, path, (t) => r * (0.72 + 0.42 * Math.pow(Math.abs(Math.sin(t * count * Math.PI)), 0.7)), { radial });
}

function colossus(def = {}, o = {}) {
  const seed = hashStr(def.id || 'boneColossus'), rnd = rng(seed);
  const GLOW = 0x7dffb0, HORN = 0x2a2018, SINEW = 0x6a3528;
  const HIPY = 0.431, HIPX = 0.1, TH = 0.2, SH = 0.19, FOOT = 0.05, UP = 0.24, FO = 0.23, PS = 1.62, R = 0.118;
  const LEG_ROT = -14, SHIN_ROT = 24;
  const sinew = (m) => m.hard().shade(clothShade(SINEW, 1, -1, 3, 0x2e1c16)).pbr(0.8);
  const rusty = (m, sd = 0) => m.hard().shade(rustShade(seed + sd, 0x4a484c, 0.55)).pbr(0.62, 0.6);
  const knob = (r, x, y, z) => [bone(S.sphere(r)).bump(0.002, 30).at(x, y, z), bone(S.sphere(r * 0.6)).at(x + r * 0.55, y + r * 0.1, z - r * 0.2).blend(0.012), bone(S.sphere(r * 0.6)).at(x - r * 0.55, y - r * 0.1, z + r * 0.15).blend(0.012), S.sphere(r * 0.8).at(x, y - r * 0.5, z + r * 0.4).color(mix(BONE, STAIN, 0.5)).paint(r * 0.5, 0)];
  const ring3 = (y, rad, a0 = 90) => [0, 1, 2].map((k) => { const a = (a0 + k * 120) * DEG; return [Math.cos(a) * rad, y, Math.sin(a) * rad]; });

  // ---------------- pelvis ----------------
  const pv = buildPelvis();
  const pelvis = { prims: pv.prims.map((p) => p.scale(PS)), hard: pv.hard.map((h) => h.scale(PS)) };
  {
    const links = new MB(), far = new MB(), hide = new MB(), hideFar = new MB(), cord = new MB(), skulls = [], sfar = [];
    const at = (a, y = 0.125) => [Math.sin(a) * 0.19, y - 0.02 * Math.cos(a) + 0.012 * Math.abs(Math.sin(a)), -0.02 + Math.cos(a) * (Math.cos(a) > 0 ? 0.135 : 0.11)];
    const loop = []; for (let j = 0; j <= 24; j++) loop.push(at((j / 24) * Math.PI * 2));
    chain(links, far, loop, 0.036, 0.0125, 0.0044);
    const span = (a0, a1, y) => (u) => at(lerp(a0, a1, u), y);
    const outOf = (a0, a1) => (u) => { const a = lerp(a0, a1, u); return norm3([Math.sin(a), 0, Math.cos(a)]); };
    const front = { top: span(-0.6, 0.6, 0.12), out: outOf(-0.6, 0.6), len: (u) => 0.27 - 0.05 * Math.abs(u - 0.45), seed: 3, flare: 0.02, fold: 0.012, folds: 2, fray: 0.4, lean: [0, 0, 0.0] };
    const back = { top: span(Math.PI - 0.7, Math.PI + 0.7, 0.12), out: outOf(Math.PI - 0.7, Math.PI + 0.7), len: (u) => 0.25 + 0.05 * u, seed: 8, flare: 0.03, fold: 0.012, folds: 2.5, fray: 0.5, lean: [0, 0, 0.02] };
    rag(hide, { ...front, sx: 18, sy: 18, holes: 0.1, slits: 0.25 });
    rag(hide, { ...back, sx: 18, sy: 16, holes: 0.14, slits: 0.3 });
    rag(hideFar, { ...front, sx: 3, sy: 3, holes: 0, slits: 0, fold: 0 });
    rag(hideFar, { ...back, sx: 3, sy: 3, holes: 0, slits: 0, fold: 0 });
    for (const sx of [1, -1]) {                                                    // a skull swinging at each hip
      const top = at(sx * 1.35), sk = [top[0] + sx * 0.012, top[1] - 0.115, top[2] + 0.01];
      sweep(cord, [top, lerp3(top, sk, 0.5), [sk[0], sk[1] + 0.05, sk[2]]], 0.004, { radial: 5 });
      placeSkull(skulls, sfar, sk, [sx * 0.75, -0.15, 0.65], 1.05, { mul: 0.9 });
    }
    pelvis.hard.push(rusty(links, 1).lod(1), far.hard().color(0x4a3a30).pbr(0.7, 0.5).from(2), hide.hard().shade(clothShade(CLOTH_W, 0.13, -0.16, 4)).pbr(0.95).lod(1), hideFar.hard().color(mix(CLOTH_W, 0x3a3226, 0.35)).pbr(0.95).from(2), sinew(cord).near(), ...skulls, ...sfar);
  }

  // ---------------- legs ----------------
  const leg = (() => {
    const hard = [], far = new MB(), cords = new MB(), sfar = [];
    const prims = [...knob(0.04, 0, 0, 0), ...knob(0.04, 0, -TH, 0)];
    const t3 = ring3(-0.012, 0.022), b3 = ring3(-TH + 0.012, 0.02);
    for (let k = 0; k < 3; k++) placeBone(hard, far, k === 1 ? b3[k] : t3[k], k === 1 ? t3[k] : b3[k], 1.75, [Math.cos(k * 2.1), 0, Math.sin(k * 2.1)], 1 - k * 0.06);
    for (const y of [-0.05, -0.105, -0.158]) lash(cords, [0, y, 0], [0, 1, 0], 0.045, 2.3, 0.02, 0.005);
    placeSkull(hard, sfar, [0.002, -TH + 0.012, 0.05], [0, -0.25, 1], 0.95, { mul: 0.95 });       // kneecap
    hard.push(sinew(cords).near(), far.hard().color(FAR_BONE).pbr(0.8).far(), ...sfar);
    return { prims, hard };
  })();
  const shin = (() => {
    const hard = [], far = new MB(), cords = new MB(), toes = new MB(), claws = new MB(), spurs = new MB();
    const prims = [...knob(0.033, 0, -SH, 0)];
    placeBone(hard, far, [0.019, -0.02, 0.004], [0.016, -SH + 0.012, 0], 1.55, [0, 0, 1]);
    placeBone(hard, far, [-0.017, -SH + 0.012, -0.004], [-0.019, -0.022, 0.0], 1.45, [0, 0, -1], 0.93);
    for (const y of [-0.06, -0.135]) lash(cords, [0, y, 0], [0, 1, 0], 0.043, 2.2, 0.02, 0.005, 0.7);
    spike(spurs, [0.004, -0.05, 0.022], [0.008, -0.015, 0.075], 0.012, 0.003, 6);
    spike(spurs, [-0.004, -0.095, 0.022], [-0.01, -0.07, 0.066], 0.01, 0.003, 6);
    // foot, built level in ankle space and tipped back by the leg's lean
    const mark = toes.n, markC = claws.n, G = -FOOT;
    for (const [k, ang] of [[0, -30], [1, 0], [2, 30]]) {
      const cs = Math.cos(ang * DEG), sn = Math.sin(ang * DEG), big = k === 1 ? 1.1 : 1, rr = 0.0145 * big;
      const q = (d, y) => [sn * d, y, cs * d];
      const a = q(0.012, -0.014), b = q(0.09 * big, G + rr + 0.004), c2 = q(0.135 * big, G + rr * 0.9 + 0.001);
      dogbone(toes, a, b, rr, 7);
      dogbone(toes, b, c2, rr * 0.9, 7);
      sweep(claws, [c2, q(0.158 * big, G + rr * 1.15), q(0.182 * big, G + rr * 0.7), q(0.196 * big, G + 0.002)], [rr * 0.78, rr * 0.66, rr * 0.4, rr * 0.06], { radial: 6 });
    }
    dogbone(toes, [0, -0.016, -0.008], [0, G + 0.02, -0.062], 0.016, 7);
    sweep(claws, [[0, G + 0.02, -0.062], [0, G + 0.012, -0.085], [0, G + 0.002, -0.1]], [0.012, 0.008, 0.001], { radial: 6 });
    const tip = new THREE.Matrix4().makeRotationX(-(LEG_ROT + SHIN_ROT) * DEG).setPosition(0, -SH, 0);
    toes.transform(tip, mark); claws.transform(tip, markC);
    // far away: three wedges and a heel
    const pad = new MB();
    for (const ang of [-30, 0, 30]) { const cs = Math.cos(ang * DEG), sn = Math.sin(ang * DEG), big = ang ? 1 : 1.1; sweep(pad, [[sn * 0.01, -0.012, cs * 0.01], [sn * 0.1 * big, G + 0.02, cs * 0.1 * big], [sn * 0.19 * big, G + 0.004, cs * 0.19 * big]], [0.016, 0.017, 0.003], { radial: 4 }); }
    sweep(pad, [[0, -0.014, -0.006], [0, G + 0.004, -0.095]], [0.016, 0.003], { radial: 4 });
    pad.transform(tip);
    hard.push(toes.hard().shade(boneShade(31)).pbr(0.6).near(), claws.hard().color(HORN).pbr(0.45).near(), spurs.hard().shade(boneShade(33)).pbr(0.6).lod(1), sinew(cords).near(), far.hard().color(FAR_BONE).pbr(0.8).far(), pad.hard().color(FAR_BONE).pbr(0.85).far());
    return { prims, hard };
  })();

  // ---------------- torso ----------------
  const SP = spline([[-0.03, -0.008], [0, 0], [0.09, 0.022], [0.18, 0.002], [0.27, -0.028], [0.34, -0.02], [0.4, 0.02], [0.445, 0.07], [0.47, 0.1]].map(([y, z]) => [0, y, z]), 90);
  const spAt = (y) => tableAt(SP.map((q) => [q[1], q[2]]), y);
  const NECK = [0, 0.462, spAt(0.462)];
  const torso = (() => {
    const hard = [], far = new MB(), linkFar = new MB(), spikes = new MB(), ribs = new MB(), ribMid = new MB(), ribFar = new MB(), side = new MB(), links = new MB(), cords = new MB(), sfar = [], iron = new MB();
    // spine: cast vertebrae threaded along the curve, growing smaller toward the neck
    let d = 0, k = 0;
    const lens = [0]; for (let j = 1; j < SP.length; j++) lens.push(lens[j - 1] + len3(sub3(SP[j], SP[j - 1])));
    const along = (s) => { let j = 1; while (j < SP.length - 1 && lens[j] < s) j++; const f = (s - lens[j - 1]) / (lens[j] - lens[j - 1]); return { p: lerp3(SP[j - 1], SP[j], f), t: norm3(sub3(SP[j], SP[j - 1])) }; };
    d = 0.028;
    while (d < lens[lens.length - 1] - 0.04) {
      const f = d / lens[lens.length - 1], sc = lerp(1.32, 0.86, f), { p, t } = along(d);
      hard.push(orient(cast(vertParts().fine, 1 - (k % 3) * 0.04).scale(sc * 1.05, sc, sc), p, t, [0, 0, 1]).lod(1));
      hard.push(orient(cast(vertParts().mid, 1 - (k % 3) * 0.04).scale(sc * 1.05, sc, sc), p, t, [0, 0, 1]).from(2).near());
      if (f > 0.3 && f < 0.82) {                                                 // a ridge of tall spines over the hump
        const back = [0, t[2], -t[1]], h = 0.05 + 0.07 * Math.sin((f - 0.3) / 0.52 * Math.PI), a = add3(p, mul3(back, 0.05 * sc));
        sweep(spikes, [a, add3(a, add3(mul3(back, h * 0.5), mul3(t, h * 0.25))), add3(a, add3(mul3(back, h), mul3(t, h * 0.9)))], [0.012 * sc, 0.0085 * sc, 0.001], { radial: 6, up: [1, 0, 0] });
      }
      d += VERT_H * sc * 1.0; k++;
    }
    sweep(far, SP.filter((_, j) => j % 9 === 0), 0.03, { radial: 5, up: [1, 0, 0] });
    // great ribs: six pairs, tusk-pointed, that never meet over the chest
    const W = [0.15, 0.188, 0.205, 0.205, 0.188, 0.16], F = [0.15, 0.2, 0.235, 0.24, 0.22, 0.18], drop = [0.03, 0.05, 0.065, 0.078, 0.08, 0.068];
    const ribCol = (() => { const bs = boneShade(41, mix(BONE, BONE_LO, 0.22)), tipC = rgb(mix(BONE_LO, STAIN, 0.6)); return (t, q) => { const c = bs(q[0], q[1], q[2]), w = sstep(0.7, 1, t) * 0.7; return [lerp(c[0], tipC[0], w), lerp(c[1], tipC[1], w), lerp(c[2], tipC[2], w)]; }; })();
    for (let i = 0; i < 6; i++) for (const sx of [1, -1]) {
      const yb = 0.338 - i * 0.043, zb = spAt(yb) - 0.022, zc = (zb + F[i]) / 2, D = (F[i] - zb) / 2, end = 2.5 + 0.06 * i + (sx > 0 ? 0.05 : -0.04) * (i % 2 ? 1 : -1);
      const pts = [[sx * 0.022, yb + 0.004, spAt(yb) - 0.006]];
      for (let j = 0; j <= 13; j++) { const phi = lerp(0.3, end, j / 13); pts.push([sx * W[i] * Math.pow(Math.sin(phi), 0.85), yb - drop[i] * cosEase(phi / 2.3) + 0.02 * sstep(2.3, 2.9, phi), zc - D * Math.cos(phi)]); }
      const sp = spline(pts, 20);
      const rr = (t) => { const tp = 1 - sstep(0.72, 1, t), nk = sstep(0, 0.1, t); return [lerp(0.009, 0.0145, nk) * (0.08 + 0.92 * tp), lerp(0.009, 0.0092, nk) * (0.08 + 0.92 * tp)]; };
      sweep(ribs, sp, rr, { radial: 7, up: [0, 1, 0], col: ribCol });
      sweep(ribMid, sp.filter((_, j) => j % 2 === 0 || j === sp.length - 1), rr, { radial: 4, phase: Math.PI / 4, up: [0, 1, 0], col: ribCol });
      ribbon(ribFar, sp.filter((_, j) => j % 3 === 0 || j === sp.length - 1), (t) => 0.014 * (1 - sstep(0.75, 1, t) * 0.9), [0, 1, 0]);
    }
    // a smaller rib cage caught inside the great one, and the light that drives the thing
    for (const h of buildRibs({}).slice(0, 2)) hard.push(h.scale(0.9).rot(10, 14, 6).at(0.012, 0.075, 0.062));
    placeSkull(hard, sfar, [0.03, 0.335, 0.105], [0.25, -0.5, 1], 0.95, { mul: 0.85, glow: GLOW });
    hard.push(H.sphere(0.042, 14).scale(1, 1.2, 0.9).at(0.005, 0.2, 0.085).color(0x4fe8a0).glow(1.25).pbr(0.5));
    for (let j = 0; j < 5; j++) hard.push(H.sphere(0.012 + rnd() * 0.012, 8).at((rnd() - 0.5) * 0.12, 0.14 + rnd() * 0.14, 0.06 + rnd() * 0.07).color(GLOW).glow(1.2).pbr(0.5).lod(1));
    // collar beams out to the shoulders, shoulder blades behind
    for (const sx of [1, -1]) {
      placeBone(hard, far, [sx * 0.028, 0.385, 0.045], [sx * 0.225, 0.352, 0.004], 1.55, [0, 1, 0]);
      placeBone(hard, far, [sx * 0.215, 0.33, -0.05], [sx * 0.04, 0.36, -0.045], 1.3, [0, 1, 0], 0.92);
      placePlate(hard, [sx * 0.14, 0.285, -0.082], [sx * 0.45, 0.25, -1], 1.15, [-sx * 0.3, 1, 0.1], 0.9);
      beads(side, [[sx * 0.075, -0.01, -0.045], [sx * 0.105, 0.09, -0.055], [sx * 0.12, 0.2, -0.085], [sx * 0.17, 0.3, -0.07], [sx * 0.22, 0.345, -0.04]], 0.0135, 15);
      sweep(far, [[sx * 0.075, -0.01, -0.045], [sx * 0.12, 0.2, -0.085], [sx * 0.22, 0.345, -0.04]], 0.008, { radial: 3 });
      lash(cords, [sx * 0.05, 0.372, 0.02], [sx * 1, -0.12, -0.1], 0.03, 2.2, 0.03, 0.005);
    }
    // chains crossed over the chest, pinned by an iron ring
    const ringAt = [0, 0.2, 0.262];
    for (const sx of [1, -1]) {
      chain(links, linkFar, [[sx * 0.215, 0.37, 0.03], [sx * 0.19, 0.33, 0.14], [sx * 0.1, 0.25, 0.235], add3(ringAt, [sx * 0.022, 0.016, 0])], 0.034, 0.012, 0.0042);
      chain(links, linkFar, [add3(ringAt, [sx * 0.02, -0.018, 0]), [sx * 0.11, 0.12, 0.22], [sx * 0.185, 0.07, 0.11], [sx * 0.17, 0.05, -0.02]], 0.034, 0.012, 0.0042);
    }
    lathe(iron, [[0.022, 0.006], [0.03, 0], [0.022, -0.006], [0.016, 0]].concat([[0.022, 0.006]]), 14, (x, y, z) => [ringAt[0] + x, ringAt[1] + z, ringAt[2] + y]);
    hard.push(ribs.hard().pbr(0.6).lod(1), ribMid.hard().pbr(0.6).from(2).near(), ribFar.hard().shade(boneShade(41, mix(BONE, BONE_LO, 0.12))).pbr(0.7).far(), spikes.hard().shade(boneShade(43, mix(BONE, BONE_LO, 0.35))).pbr(0.6).near(), side.hard().shade(boneShade(45, mix(BONE, BONE_LO, 0.2))).pbr(0.62).near());
    hard.push(rusty(links, 3).lod(1), rusty(iron, 5).near(), sinew(cords).near(), far.hard().color(FAR_BONE).pbr(0.8).far(), linkFar.hard().color(0x4a3a30).pbr(0.7, 0.5).from(2), ...sfar);
    return { prims: [], hard };
  })();

  // ---------------- trophy rack ----------------
  const rack = (() => {
    const hard = [], far = new MB(), linkFar = new MB(), poles = new MB(), cords = new MB(), rags = new MB(), links = new MB(), sfar = [];
    const tops = [[0.2, 0.3, -0.03], [0, 0.4, -0.02], [-0.19, 0.31, -0.04]], bases = [[0.085, 0, 0], [0, 0.02, -0.012], [-0.085, 0, 0]];
    tops.forEach((tp, k) => {
      const mid = add3(lerp3(bases[k], tp, 0.5), [0, 0, -0.02]);
      beads(poles, [bases[k], mid, tp], 0.0165, 11 + (k === 1 ? 3 : 0), 7);
      sweep(far, [bases[k], mid, tp], 0.0165, { radial: 4 });
      placeSkull(hard, sfar, add3(tp, [0, 0.045, 0.012]), [(k - 1) * -0.35, -0.2 - 0.1 * k, 1], k === 1 ? 1.22 : 1.05, { glow: GLOW, mul: 1 - k * 0.05, up: [(k - 1) * 0.18, 1, 0], best: true });
      lash(cords, add3(tp, [0, -0.012, 0]), sub3(tp, mid), 0.02, 2.2, 0.02, 0.0042);
    });
    placeBone(hard, far, [-0.2, 0.2, -0.045], [0.21, 0.19, -0.04], 1.15, [0, 0, 1]);                       // crossbar
    for (const x of [-0.125, 0.0, 0.13]) lash(cords, [x, 0.197 + (x === 0 ? 0.004 : 0), -0.035], [0.3, 1, 0], 0.026, 2.2, 0.02, 0.0042);
    rag(rags, { top: (u) => [lerp(0.03, 0.12, u), 0.185, -0.062], out: () => [0, 0, -1], len: (u) => 0.16 + 0.05 * u, sx: 9, sy: 12, seed: 2, flare: 0.02, fold: 0.006, folds: 1.5, fray: 0.5, holes: 0.12, slits: 0.25 });
    rag(rags, { top: (u) => [lerp(-0.13, -0.05, u), 0.19, -0.064], out: () => [0, 0, -1], len: (u) => 0.12 + 0.07 * (1 - u), sx: 8, sy: 10, seed: 7, flare: 0.02, fold: 0.006, folds: 1.5, fray: 0.55, holes: 0.12, slits: 0.25 });
    chain(links, linkFar, [[0.2, 0.185, -0.03], [0.215, 0.12, -0.02], [0.21, 0.06, -0.015]], 0.028, 0.0098, 0.0034);
    chain(links, linkFar, [[-0.19, 0.19, -0.035], [-0.2, 0.14, -0.03]], 0.028, 0.0098, 0.0034);
    hard.push(poles.hard().shade(boneShade(51, mix(BONE, BONE_LO, 0.15))).pbr(0.62).near(), sinew(cords).near(), rags.hard().shade(clothShade(CLOTH_W, 0.19, -0.02, 5)).pbr(0.95).near(), rusty(links, 7).lod(1), far.hard().color(FAR_BONE).pbr(0.8).far(), linkFar.hard().color(0x4a3a30).pbr(0.7, 0.5).from(2), ...sfar);
    return { prims: [], hard };
  })();

  // ---------------- head ----------------
  const skull = buildSkull(R, { seed, glow: GLOW, glowAmt: 2, brow: 1, fang: 1, gaps: 0.04, cracks: 1 });
  {
    const horns = new MB(), crest = new MB();
    const bc = rgb(mix(BONE, BONE_LO, 0.35)), dc = rgb(HORN);
    for (const sx of [1, -1]) {
      const pts = spline([[sx * 0.62, 0.36, -0.12], [sx * 1.4, 0.5, -0.3], [sx * 2.2, 0.95, -0.2], [sx * 2.5, 1.65, 0.3], [sx * 2.2, 2.25, 0.95]].map((q) => mul3(q, R)), 28);
      sweep(horns, pts, (t) => (0.36 * Math.pow(1 - t, 0.85) + 0.012) * R * (1 + 0.07 * Math.sin(t * 62) * (1 - t)), { radial: 10, col: (t) => { const w = sstep(0.12, 0.9, t), g = 0.86 + 0.14 * Math.sin(t * 62); return [lerp(bc[0], dc[0], w) * g, lerp(bc[1], dc[1], w) * g, lerp(bc[2], dc[2], w) * g]; } });
      // a lesser horn below each
      const p2 = spline([[sx * 0.8, -0.3, 0.1], [sx * 1.25, -0.25, 0.3], [sx * 1.45, 0.0, 0.62], [sx * 1.3, 0.28, 0.9]].map((q) => mul3(q, R)), 14);
      sweep(horns, p2, (t) => (0.16 * Math.pow(1 - t, 0.85) + 0.01) * R, { radial: 8, col: (t) => { const w = sstep(0.15, 0.9, t); return [lerp(bc[0], dc[0], w), lerp(bc[1], dc[1], w), lerp(bc[2], dc[2], w)]; } });
    }
    for (let j = 0; j < 5; j++) { const z = 0.5 - j * 0.33, y = 0.94 - Math.abs(j - 1.2) * 0.07; spike(crest, [0, y * R, z * R], [0, (y + 0.3 - j * 0.02) * R, (z - 0.2) * R], 0.085 * R, 0.02 * R, 6, [1, 0, 0]); }
    skull.hard.push(horns.hard().pbr(0.5).near(), crest.hard().shade(boneShade(61, mix(BONE, BONE_LO, 0.3))).pbr(0.6).lod(1));
    const hfar = new MB();
    for (const sx of [1, -1]) sweep(hfar, spline([[sx * 0.62, 0.36, -0.12], [sx * 1.4, 0.5, -0.3], [sx * 2.2, 0.95, -0.2], [sx * 2.5, 1.65, 0.3], [sx * 2.2, 2.25, 0.95]].map((q) => mul3(q, R)), 7), (t) => (0.36 * Math.pow(1 - t, 0.85) + 0.012) * R, { radial: 5 });
    skull.hard.push(hfar.hard().color(mix(BONE_LO, HORN, 0.5)).pbr(0.6).far());
    const tusks = new MB();
    for (const sx of [1, -1]) sweep(tusks, spline([[sx * 0.4, -1.32, 0.66], [sx * 0.56, -1.12, 0.86], [sx * 0.66, -0.82, 0.98], [sx * 0.64, -0.55, 1.0]].map((q) => mul3(q, R)), 9), (t) => (0.1 * (1 - t) + 0.012) * R, { radial: 7 });
    skull.jaw.hard.push(tusks.hard().shade(boneShade(63, TOOTH, 0x7a6238)).pbr(0.4).near());
  }

  // ---------------- arms ----------------
  const arm = (() => {
    const hard = [], far = new MB(), cords = new MB(), spikes = new MB(), sfar = [];
    const prims = [...knob(0.05, 0, 0, 0), ...knob(0.04, 0, -UP, 0)];
    const t3 = ring3(-0.02, 0.022, 30), b3 = ring3(-UP + 0.014, 0.02, 30);
    for (let k = 0; k < 3; k++) placeBone(hard, far, k === 2 ? b3[k] : t3[k], k === 2 ? t3[k] : b3[k], 1.62, [Math.cos(k * 2.3), 0, Math.sin(k * 2.3)], 1 - k * 0.05);
    for (const y of [-0.07, -0.13, -0.19]) lash(cords, [0, y, 0], [0, 1, 0], 0.044, 2.3, 0.02, 0.005);
    // pauldron: three overlapping plates, a skull and a fan of rib tips
    placePlate(hard, [0.028, 0.052, -0.004], [0.5, 0.86, 0], 1.55, [0, 0, 1], 1, 0.85);
    placePlate(hard, [0.072, -0.025, 0], [1, 0.22, 0], 1.3, [0, 1, 0], 0.95);
    placePlate(hard, [0.068, -0.115, 0], [1, -0.05, 0.05], 1.02, [0, 1, 0], 0.9);
    placeSkull(hard, sfar, [0.035, 0.098, 0.03], [0.45, 0.1, 1], 1.12, { glow: GLOW, up: [0.25, 1, 0], best: true });
    for (const [a, l] of [[-50, 0.1], [-10, 0.13], [35, 0.1]]) { const cs = Math.cos(a * DEG), sn = Math.sin(a * DEG), b0 = [0.06, 0.06, sn * 0.05]; sweep(spikes, [b0, add3(b0, [0.06 * l * 10 * 0.6, 0.03 + l * 0.3, sn * l * 0.5]), add3(b0, [0.07 * l * 10, 0.05 + l * 0.75, sn * l * 0.8 + cs * 0.0])], [0.011, 0.008, 0.001], { radial: 6 }); }
    hard.push(sinew(cords).near(), spikes.hard().shade(boneShade(71, mix(BONE, BONE_LO, 0.3))).pbr(0.6).near(), far.hard().color(FAR_BONE).pbr(0.8).far(), ...sfar);
    return { prims, hard };
  })();
  const fore = (() => {
    const hard = [], far = new MB(), linkFar = new MB(), bones = new MB(), cords = new MB(), splints = new MB(), iron = new MB(), links = new MB();
    const prims = [...knob(0.031, 0, -FO, 0)];
    for (const [x, z, r] of [[0.018, 0.014, 0.0135], [-0.017, 0.015, 0.0125], [0.016, -0.016, 0.012], [-0.018, -0.014, 0.013]]) dogbone(bones, [x, -0.012, z], [x * 0.9, -FO + 0.012, z * 0.9], r, 7);
    farBone(far, [[0, -0.01, 0], [0, -FO, 0]], 0.03, 1.2);
    // splint bracer: rib halves bound round the outside of the arm
    for (let j = 0; j < 5; j++) {
      const y = -0.058 - j * 0.026, pts = [];
      for (let q = 0; q <= 8; q++) { const a = (-25 + q * 28.75) * DEG; pts.push([Math.cos(a) * 0.045, y + 0.004 * Math.sin(q), Math.sin(a) * 0.042 * -1]); }
      sweep(splints, pts, (t) => [0.0095 * (0.55 + 0.45 * Math.sin(Math.PI * t)), 0.0048], { radial: 6, up: [0, 1, 0] });
    }
    lash(cords, [0, -0.05, 0], [0, 1, 0], 0.036, 2.2, 0.016, 0.0045);
    lash(cords, [0, -0.175, 0], [0, 1, 0], 0.036, 2.2, 0.016, 0.0045);
    // shackle with a few broken links (they hang toward the ground in the carrying pose)
    lathe(iron, [[0.04, 0.012], [0.047, 0.006], [0.047, -0.006], [0.04, -0.012], [0.036, 0]].concat([[0.04, 0.012]]), 16, (x, y, z) => [x, y - FO + 0.03, z]);
    chain(links, linkFar, [[0, -FO + 0.03, -0.046], [0.004, -FO + 0.035, -0.09], [0.0, -FO + 0.04, -0.15]], 0.03, 0.0105, 0.0038);
    hard.push(bones.hard().shade(boneShade(73)).pbr(0.6).near(), splints.hard().shade(boneShade(75, mix(BONE, BONE_LO, 0.45))).pbr(0.62).near(), sinew(cords).near(), rusty(iron, 9).near(), rusty(links, 11).lod(1), far.hard().color(FAR_BONE).pbr(0.8).far(), linkFar.hard().color(0x4a3a30).pbr(0.7, 0.5).from(2));
    return { prims, hard };
  })();

  // ---------------- what is carried ----------------
  // the weapon is made a little longer than life and a good deal broader and thicker: a cleaver for a giant
  const hsc = 1.66, hr = HR * hsc, wsc = 1.14, wfat = 1.32;
  const w = makeWeapon(o.weapon && o.weapon !== 'none' ? o.weapon : 'greataxe', { tint: 0x7a5038, scale: wsc }) || makeWeapon('greataxe', { tint: 0x7a5038, scale: wsc });
  for (const h of w.hard) h.scale(wfat, 1, wfat);
  const held = HOLD[w.hold] || HOLD.two, gr = 0.0165 * wsc * wfat;
  const gripAt = [-(gr + hr * 0.26) * 0.8, -hr, hr * 0.05], gripRot = [90 - held.up, 0, held.lean];
  const handR = gripHand(gr, gripRot, gripAt, hsc, 1.5, true, true), handL = gripHand(gr, [60, 0, 0], gripAt, hsc, 1.5, true, true);

  const order = [];
  const node = (name, parent, rig, pos, part, detail, rot) => {
    const n = { name, pos, prims: part ? flat(part.prims) : [], hard: part ? flat(part.hard) : [] };
    if (parent) n.parent = parent;
    if (rig) n.rig = rig;
    if (detail) n.detail = detail;
    if (rot && (rot[0] || rot[1] || rot[2])) n.rot = rot;
    order.push(n);
    return n;
  };
  const mir = (part) => ({ prims: mirrorAll(part.prims), hard: mirrorAll(part.hard) });
  const shift = (part, d) => ({ prims: flat(part.prims).map((x) => x.at(d[0], d[1], d[2])), hard: flat(part.hard).map((x) => x.at(d[0], d[1], d[2])) });
  const HU = 16, skullAt = sub3([0, 0, 0], skull.neck);
  node('root', null, null, [0, 0, 0], null);
  node('pelvis', 'root', null, [0, HIPY, 0], pelvis, 1.25);
  node('legL', 'root', 'legs', [HIPX, HIPY, 0], leg, 1.2, [LEG_ROT, 0, 5]);
  node('shinL', 'legL', 'shins', [0, -TH, 0], shin, 1.2, [SHIN_ROT, 0, 0]);
  node('legR', 'root', 'legs', [-HIPX, HIPY, 0], mir(leg), 1.2, [LEG_ROT, 0, -5]);
  node('shinR', 'legR', 'shins', [0, -TH, 0], mir(shin), 1.2, [SHIN_ROT, 0, 0]);
  node('torso', 'root', 'torso', [0, HIPY + TORSO_AT[1] * PS, TORSO_AT[2] * PS], torso, 1, [HU, 0, 0]);
  node('rack', 'torso', 'rack', [0, 0.3, -0.07], rack, 1, [-HU - 8, 0, 0]);
  node('head', 'torso', 'head', NECK, shift({ prims: skull.prims, hard: skull.hard }, skullAt), 1.5, [-HU * 0.55, 0, 0]).minRes = 34;
  node('jaw', 'head', 'jaw', add3(skullAt, skull.jaw.pivot), shift(skull.jaw, mul3(skull.jaw.pivot, -1)), 1.5, [7, 0, 0]).minRes = 34;
  node('armL', 'torso', 'arms', [0.245, 0.338, -0.008], arm, 1.2, [-HU, 0, 7]);
  node('foreL', 'armL', 'forearms', [0, -UP, 0], fore, 1.2);
  node('handL', 'foreL', 'hands', [0, -FO, 0], handL, 1.5);
  node('armR', 'torso', 'arms', [-0.245, 0.338, -0.008], mir(arm), 1.2, [-HU, 0, -7]);
  node('foreR', 'armR', 'forearms', [0, -UP, 0], mir(fore), 1.2);
  node('handR', 'foreR', 'hands', [0, -FO, 0], mir(handR), 1.5);
  node('weaponR', 'handR', 'weapon', [-gripAt[0], gripAt[1], gripAt[2]], { prims: w.prims, hard: w.hard }, 1.2, [gripRot[0], 0, -gripRot[2]]);
  return { kind: `colossus.${w.hold}`, attack: w.attack || 'slam', nodes: order, hold: w.hold, grip2: -0.2 * wsc };
}

function skeletonAny(def = {}, o = {}) { return def.id === 'boneColossus' || (o.scale || 1) > 1.8 ? colossus(def, o) : skeleton(def, o); }

export const bodies = { skeleton: skeletonAny };

// =====================================================================================
//  Animation. The stock biped walks, sways and falls; everything a skeleton does with its hands is posed here.
//    warrior   humanoid.js swings the sword arm; the shield is carried low on the left so the ribs show past it
//    archer    turns side-on, raises the bow, and the string hand really draws: the two halves of the string are
//              nodes that swing to meet at the nock, and an arrow rides on them until it is loosed
//    colossus  both fists on the haft, carried across the body, hauled up past the right horn and brought down
//              on the ground in front
//  All of it works in "inner" space: the space the root node sits in, before the model's own scale.
//  On top the dead rattle, and their jaws clack.
// =====================================================================================
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _vd = new THREE.Vector3(), _ve = new THREE.Vector3(), _vf = new THREE.Vector3(), _vg = new THREE.Vector3();
const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3(), _wrist = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0), _eul = new THREE.Euler();
const _rest = new WeakMap();
function restQuat(node) {
  let q = _rest.get(node);
  if (!q) { const r = node.userData.rest; q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, 'XYZ')); _rest.set(node, q); }
  return q;
}
/** orientation whose +Y lies along d and whose +Z is as near e as it can be */
function frameQuat(out, d, e) {
  _ay.copy(d).normalize();
  _ax.crossVectors(_ay, e);
  if (_ax.lengthSq() < 1e-8) _ax.set(1, 0, 0);
  _ax.normalize();
  _az.crossVectors(_ax, _ay);
  return out.setFromRotationMatrix(_m4.makeBasis(_ax, _ay, _az));
}
/**
 * Two-bone reach: bend arm i so that its wrist lands on `target`, with the elbow leaning toward `pole`. Blended by w
 * over whatever the arm was doing. Leaves the wrist it actually reached (targets out of reach are pulled in) in _wrist.
 */
function reachArm(rig, i, target, pole, w = 1) {
  const T = rig.torso, arm = rig.arms[i], fore = rig.forearms[i], hand = rig.hands[i];
  const S = _va.copy(arm.position).applyQuaternion(T.quaternion).add(T.position);
  const U = fore.position.length(), L = hand.position.length();
  const D = _vb.copy(target).sub(S);
  const dist = clamp(D.length(), Math.abs(U - L) + 1e-4, (U + L) * 0.998);
  D.normalize();
  const along = (U * U - L * L + dist * dist) / (2 * dist), out = Math.sqrt(Math.max(0, U * U - along * along));
  const P = _vc.copy(pole).addScaledVector(D, -pole.dot(D));
  if (P.lengthSq() < 1e-8) P.set(0.3, -1, -0.3).addScaledVector(D, -(0.3 * D.x - D.y - 0.3 * D.z));
  P.normalize();
  _wrist.copy(S).addScaledVector(D, dist);
  _ay.copy(D).multiplyScalar(along).addScaledVector(P, out).normalize().negate();      // the upper arm's +Y: from the elbow up to the shoulder
  _az.copy(P).negate(); _az.addScaledVector(_ay, -_az.dot(_ay)).normalize();           // the way the forearm folds
  _ax.crossVectors(_ay, _az);
  _qa.setFromRotationMatrix(_m4.makeBasis(_ax, _ay, _az));
  _qb.copy(T.quaternion).invert().multiply(_qa);
  const flex = Math.PI - Math.acos(clamp((U * U + L * L - dist * dist) / (2 * U * L), -1, 1));
  _qc.setFromAxisAngle(X_AXIS, -flex);
  if (w >= 1) { arm.quaternion.copy(_qb); fore.quaternion.copy(_qc); } else { arm.quaternion.slerp(_qb, w); fore.quaternion.slerp(_qc, w); }
}
/** turn hand i at the wrist to the orientation q (inner space), blended by w */
function setHand(rig, i, q, w = 1) {
  _qa.copy(rig.torso.quaternion).multiply(rig.arms[i].quaternion).multiply(rig.forearms[i].quaternion).invert().multiply(q);
  if (w >= 1) rig.hands[i].quaternion.copy(_qa); else rig.hands[i].quaternion.slerp(_qa, w);
}
/**
 * Put the weapon's grip at G with its +Y along d and its +Z as near e as can be, by moving the right arm and wrist.
 * `lean` nudges the elbow. Leaves the weapon's orientation in _qw and writes the grip actually reached back into G.
 */
function holdWeapon(rig, G, d, e, lean, w = 1) {
  const W = rig.weapon[0];
  frameQuat(_qw, d, e);
  _qh.copy(_qw).multiply(_qc.copy(restQuat(W)).invert());                              // the hand that holds it so
  _vd.copy(W.position).applyQuaternion(_qh);                                           // wrist to grip
  _ve.set(0, 1, 0).applyQuaternion(_qh).add(lean);                                     // the forearm wants to come in along the hand
  reachArm(rig, 1, _vf.copy(G).sub(_vd), _ve, w);
  setHand(rig, 1, _qh, w);
  G.copy(_wrist).add(_vd);
}
const LEFT_GRIP_INV = new THREE.Quaternion().setFromEuler(new THREE.Euler(60 * DEG, 0, 0, 'XYZ')).invert();
/** close the left fist on the shaft `along` from the grip G of the weapon last placed by holdWeapon */
function secondHand(rig, G, along, lean, w = 1) {
  const W = rig.weapon[0];
  _qh.copy(_qw).multiply(LEFT_GRIP_INV);
  _vd.set(-W.position.x, W.position.y, W.position.z).applyQuaternion(_qh);
  _vf.set(0, 1, 0).applyQuaternion(_qw).multiplyScalar(along).add(G).sub(_vd);
  _ve.set(0, 1, 0).applyQuaternion(_qh).add(lean);
  reachArm(rig, 0, _vf, _ve, w);
  setHand(rig, 0, _qh, w);
}
const ease3 = (t) => t * t * (3 - 2 * t);
/** which pair of keys [time, ...] the time a falls between, and how far along (eased) */
function span(a, ks) {
  let i = 1;
  while (i < ks.length - 1 && a > ks[i][0]) i++;
  return [ks[i - 1], ks[i], ease3(clamp((a - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0])))];
}

function rattle(rig, c, base, amt = 1) {
  const { R } = base;
  const k = c.moving ? 1 : 0, t = c.t, ph = c.phase || 0;
  let jaw = 0.03 + 0.03 * Math.sin(t * 1.3 + ph);
  const chatter = Math.pow(Math.max(0, Math.sin(t * 0.83 + ph * 3.1)), 10);          // now and then the teeth chatter
  jaw += chatter * (0.14 + 0.14 * Math.sin(t * 27 + ph));
  if (c.atk >= 0) jaw = base.keys(c.atk, [[0, 0.05], [0.3, 0.55], [0.5, 0.6], [0.6, 0.02], [0.72, 0.3], [1, 0.05]]);
  if (c.dead > 0) jaw = 0.75 * Math.min(1, c.dead * 3);
  R(rig.jaw, jaw);
  if (c.dead > 0) {
    // the dead fall slack: limbs splay, the skull lolls to one side
    const f = Math.min(1, c.dead * 2), e = f * f * (3 - 2 * f), sg = Math.sin(ph * 7) >= 0 ? 1 : -1, A = rig.arms || [], F = rig.forearms || [], L = rig.legs || [], Sn = rig.shins || [];
    R(rig.head, -0.2 * e, 0.5 * e * sg, 0.3 * e * sg);
    R(A[0], -0.1 * e, 0, 0.95 * e); R(A[1], -0.14 * e, 0, -0.75 * e); R(F[0], -0.3 * e); R(F[1], -0.5 * e);
    R(L[0], -0.2 * e, 0, 0.22 * e); R(L[1], 0.05 * e, 0, -0.3 * e); R(Sn[0], 0.55 * e); R(Sn[1], 0.15 * e);
    for (const h of rig.hands || []) h.quaternion.identity();
    // what was carried is let go: the weapon comes to lie out past the open hand, the shield flat on its arm
    for (const n of rig.weapon || []) { const r = n.userData.rest; R(n, (Math.PI - (r ? r[0] : 0)) * e); }
    for (const n of rig.shield || []) { const r = n.userData.rest; R(n, 0, -(r ? r[1] : 0) * e, 0); }
    for (const n of rig.rack || []) R(n, -1.05 * e, 0, 0.12 * e * sg);
  } else for (const n of rig.weapon || []) R(n);
  if (rig.head && c.dead <= 0) {
    rig.head.rotation.z += (Math.sin(t * 19 + ph * 2) * 0.035 * k + chatter * Math.sin(t * 31) * 0.02) * amt;
    rig.head.rotation.x += Math.sin(t * 9.5 * 2 + ph) * 0.03 * k * amt;
  }
}

// ---------- warrior: the shield arm ----------
/**
 * The shield hangs low on the left from a nearly straight arm, so the rib cage shows past it, and comes up across the
 * body while the sword arm strikes. A strapped shield lies along the forearm, so it can only face where the forearm
 * lets it: the forearm is laid first, then the shield turned on its straps to stand upright.
 */
function carryShield(rig, c, base) {
  const A = rig.arms, F = rig.forearms, T = rig.torso, Sh = rig.shield && rig.shield[0];
  if (!Sh || c.dead > 0) return;
  const k = c.moving ? 1 : 0, s = Math.sin(c.t * 9.5 + c.phase) * k, idle = Math.sin(c.t * 1.6 + c.phase);
  const lift = c.atk >= 0 ? ease3(Math.sin(Math.PI * clamp(c.atk))) : 0;
  base.R(A[0], 0.2 - lift * 0.58 + s * 0.07, 0, 0.2 + lift * 0.02);
  const yaw = Sh.userData.rest ? Sh.userData.rest[1] : 1.08, sn = Math.sin(yaw), cs = Math.cos(yaw);
  // the forearm's own +Y (back toward the elbow) in inner space: hanging and a little forward, or raised across the chest
  _vf.set(lerp(0.0, 0.62, lift), lerp(0.96, -0.2, lift) - idle * 0.01, lerp(-0.27, -0.7, lift) + s * 0.05).normalize();
  _vd.set(0.28, 0, 0.96); _vd.addScaledVector(_vf, -_vd.dot(_vf)).normalize();        // which way the strapped side faces
  _ve.crossVectors(_vf, _vd);
  _ax.copy(_vd).multiplyScalar(sn).addScaledVector(_ve, cs); _az.copy(_vd).multiplyScalar(cs).addScaledVector(_ve, -sn);
  _qb.setFromRotationMatrix(_m4.makeBasis(_ax, _vf, _az));                             // forearm in inner space
  F[0].quaternion.copy(_qa.copy(T.quaternion).multiply(A[0].quaternion).invert().multiply(_qb));
  _ax.crossVectors(_va.set(0, 1, 0), _vd).normalize(); _ay.crossVectors(_vd, _ax);
  _qc.setFromRotationMatrix(_m4.makeBasis(_ax, _ay, _vd));                             // shield upright in inner space
  Sh.quaternion.copy(_qb.invert().multiply(_qc));
}

// ---------- archer: draw and loose ----------
/** swing the two halves of the bowstring to meet `draw` behind where they rest, and seat the arrow on them */
function setString(rig, draw, shown) {
  const St = rig.string, Ar = rig.arrow && rig.arrow[0];
  if (!St || St.length < 2 || !Ar) return;
  const nock = Ar.userData.rest;                                                       // the nocking point at rest: [.., x, y, z]
  if (!nock) return;
  St.forEach((n, i) => {
    const r = n.userData.rest, len = Math.abs(nock[4] - r[4]) || 1;
    n.rotation.set((i ? -1 : 1) * Math.atan2(draw, len), 0, 0);
    n.scale.set(1, Math.hypot(draw, len) / len, 1);
  });
  Ar.visible = shown;
  Ar.position.set(nock[3], nock[4], nock[5] - draw);
  Ar.rotation.set(0, -Math.atan2(rig.pass || 0, draw - nock[5]), 0);                   // the shaft lies past the side of the grip
}
function shoot(rig, c, base) {
  const { R, keys } = base, T = rig.torso, W = rig.weapon && rig.weapon[0], Ar = rig.arrow && rig.arrow[0];
  rig.hands[0].quaternion.identity(); rig.hands[1].quaternion.identity();
  const a = c.atk;
  if (!W || !Ar || c.dead > 0) { setString(rig, 0, false); return; }
  // at the trail: the bow slants up and forward beside the leg, string uppermost, whatever the arm is doing
  frameQuat(_qw, _va.set(0.1, 0.6, 0.8), _vb.set(0, -0.8, 0.6));          // lower limb swung clear of the leg
  setHand(rig, 1, _qh.copy(_qw).multiply(_qc.copy(restQuat(W)).invert()));
  if (a < 0) { setString(rig, 0, false); return; }
  const up = keys(a, [[0, 0], [0.2, 1], [0.74, 1], [1, 0]]);                           // bow raised
  const pull = keys(a, [[0, 0], [0.18, 0], [0.46, 1], [0.66, 1], [1, 0.4]]);           // string hand back to the jaw (and it stays there after the loose)
  const held = keys(a, [[0, 0], [0.14, 0], [0.24, 1], [0.5, 1], [0.525, 0], [1, 0]]);  // fingers on the string
  const B = rig.build || 1;
  // side-on to the target, skull turned back over the bow shoulder
  const ty = up * 1.2;
  R(T, -0.04 * up, ty, 0.03 * up);
  R(rig.head, 0.02 * up, -ty * 0.9, 0);
  // the anchor: beside the jaw, on the side the chest now faces
  const hp = _vg.copy(rig.head.position).applyQuaternion(T.quaternion).add(T.position);
  const ax = hp.x + 0.122 * B, ay = hp.y + 0.026 * B, az = hp.z + 0.03 * B;
  const nock = Ar.userData.rest, brace = -nock[5], full = 0.29 * B;
  // bow arm: straight out at the target, bow upright
  const G = _vg.set(ax, ay - nock[4], az + brace + full);
  holdWeapon(rig, G, _va.set(0, 1, 0), _vb.set(0, 0, 1), _vc.set(-0.5, -0.9, 0), up);
  const gz = G.z;                                                                      // where the grip really is
  // string hand: fingers forward and hooked round the string, palm to the face, forearm in line with the arrow
  _qh.setFromRotationMatrix(_m4.makeBasis(_ax.set(1, 0, 0), _ay.set(0, 0, -1), _az.set(0, 1, 0)));
  _qh.multiply(_qc.setFromEuler(_eul.set(0, 0, -0.5 * (1 - pull))));
  const hook = _vd.set(-0.018 * B, -0.086 * B, 0).applyQuaternion(_qh);                // wrist to the crook of the fingers
  const reachW = keys(a, [[0, 0], [0.2, 1], [0.66, 1], [1, 0]]);
  _vf.set(G.x, G.y + nock[4], lerp(gz - brace - 0.03 * B, az, pull)).sub(hook);
  _qw.copy(_qh);
  reachArm(rig, 0, _vf, _ve.set(0.5, 0.35, -1), reachW);
  setHand(rig, 0, _qw, reachW);
  const draw = clamp(gz - brace - (_wrist.z + hook.z), 0, full * 1.4) * held * up;
  setString(rig, draw, held > 0.03);
}

// ---------- colossus: two fists on the haft ----------
// where the haft is held and where it points: [time, grip (x, y, z), direction, frame] with frame 0 = the torso's own, 1 = inner space
const CHOP = [
  [0.0, [-0.04, 0.24, 0.3], [-0.46, 0.86, -0.1], 0],
  [0.36, [-0.05, 0.36, 0.33], [-0.36, 0.9, -0.14], 0],
  [0.44, [-0.05, 0.44, 0.34], [-0.2, 0.9, 0.3], 0],
  [0.55, [0.0, 0.47, 0.42], [0.05, -0.31, 0.95], 1],
  [0.68, [0.0, 0.47, 0.42], [0.05, -0.31, 0.95], 1],
  [1.0, [-0.04, 0.24, 0.3], [-0.46, 0.86, -0.1], 0],
];
function chopPose(rig, key, G, d) {
  G.set(key[1][0], key[1][1], key[1][2]); d.set(key[2][0], key[2][1], key[2][2]).normalize();
  if (!key[3]) { G.applyQuaternion(rig.torso.quaternion).add(rig.torso.position); d.applyQuaternion(rig.torso.quaternion); }
}
const _g0 = new THREE.Vector3(), _g1 = new THREE.Vector3(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3();
function chop(rig, c, base) {
  const { R, keys } = base, T = rig.torso, a = c.atk;
  rig.hands[0].quaternion.identity(); rig.hands[1].quaternion.identity();
  if (!rig.weapon || c.dead > 0) return;
  const k = c.moving ? 1 : 0, s = Math.sin(c.t * 9.5 + c.phase) * k, idle = Math.sin(c.t * 1.6 + c.phase);
  let tx = k * 0.05, ty = -s * 0.07, hy = Math.sin(c.t * 0.7 + c.phase * 2) * 0.1 * (1 - k);
  if (a >= 0) {
    tx = keys(a, [[0, 0], [0.36, -0.24], [0.55, 0.5], [0.68, 0.47], [1, 0]]);
    ty = keys(a, [[0, 0], [0.36, -0.3], [0.55, 0.1], [1, 0]]);
    hy = -ty * 0.7;
  }
  R(T, tx, ty, idle * 0.012);
  R(rig.head, -tx * 0.55 + idle * 0.02, hy, 0);
  if (a < 0) { chopPose(rig, CHOP[0], _g0, _d0); _g0.y += idle * 0.006 - Math.abs(s) * 0.012; } else {
    const [k0, k1, f] = span(a, CHOP);
    chopPose(rig, k0, _g0, _d0); chopPose(rig, k1, _g1, _d1);
    _g0.lerp(_g1, f);
    _d0.applyQuaternion(_qa.setFromUnitVectors(_d0, _d1).slerp(_qb.identity(), 1 - f)).normalize();
  }
  holdWeapon(rig, _g0, _d0, _vg.crossVectors(_d0, _va.set(-1, 0, 0)), _vc.set(-0.5, -0.4, -0.3));
  secondHand(rig, _g0, rig.grip2 || -0.2, _vc.set(0.5, -0.4, -0.3));
}

export const animators = {};
for (const hold of ['none', 'one', 'two', 'pole', 'staff', 'bow']) {
  for (const sh of [false, true]) {
    animators[`skeleton.${hold}${sh ? '.shield' : ''}`] = (rig, inner, c, base) => {
      base.biped(rig, inner, c);
      if (hold === 'bow' && rig.arrow) shoot(rig, c, base);
      else if (HUM.poseCarried) HUM.poseCarried(rig, c, base, hold, false);
      if (sh) carryShield(rig, c, base);
      rattle(rig, c, base);
      if (c.dead > 0) inner.position.y += 0.1 * (inner.scale.y || 1) * Math.min(1, c.dead * 2);   // lie on the ground, not in it
    };
  }
}
for (const hold of ['none', 'one', 'two', 'pole']) {
  animators[`colossus.${hold}`] = (rig, inner, c, base) => {
    const slow = { ...c, t: c.t * 0.62 };                                    // a heavier, slower stride
    base.biped(rig, inner, slow);
    if (hold === 'two' || hold === 'pole') chop(rig, slow, base);
    else if (HUM.poseCarried) HUM.poseCarried(rig, slow, base, hold, false);
    rattle(rig, c, base, 0.5);
    if (c.dead > 0) { inner.position.y += 0.17 * (inner.scale.y || 1) * Math.min(1, c.dead * 2); return; }
    const k = c.moving ? 1 : 0;
    (rig.rack || []).forEach((n, i) => base.R(n, Math.sin(c.t * 5.9 + i) * 0.045 * k + Math.sin(c.t * 1.3 + i * 2 + (c.phase || 0)) * 0.012, 0, Math.sin(c.t * 2.95 + i * 1.7 + (c.phase || 0)) * 0.04 * k));
  };
}
