// Behemoth surfaces: the big built and grown forms of a sky-behemoth drawn straight into dense vertex-coloured
// geometry at sculpt-shader quality (position, normal, color, aPbr = roughness / metalness / glow, like sculpt.js):
// masonry, brick, planks, riveted plates, roof tiles, marble, obsidian, crystal, ice, bone, hide, felt, coral and
// stained glass, with mortar grooves, seams and rivets cut into the surface and windows recessed into the walls.
//
//   levels(key, make)          a per-level array (six detail levels, 0 closest) built lazily and cached by key:
//                              make(level) -> geometry (or EMPTY)
//   prismGeo(key, spec, lv)    a plan (circle | rect | poly | star) swept up a profile: towers, keeps, halls, domes,
//                              spires, roofs, pyramids, obelisks, minarets, yurts, smokestacks
//   rockGeo(key, spec, lv)     a floating mass of rock (or ice, earth, obsidian, coral, scrap): top surface, rim and
//                              hanging underside in one wrapped grid
//   hullGeo(key, spec, lv)     a great planked or plated hull with tiers of gunports and wales
//   ringGeo, tubeGeo, chainGeo, sheetGeo, flowSheet, flowShell   rings, ropes, chains, banners, water and mist
// Every level-0 geometry carries damage states lv 1..3 (shot holes with charred rims, burning rents, great breaches),
// built only when a model first shows that state.
import * as THREE from 'three';
import { noise3, fbm3, cells3 } from '../sculpt.js';

export const PI = Math.PI, TAU = Math.PI * 2;
export const EMPTY = new THREE.BufferGeometry();
EMPTY.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
export const LV = 6;
/** grid density factor per detail level */
export const KQ = [1, 0.56, 0.32, 0.18, 0.1, 0.06];
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const fract = (v) => v - Math.floor(v);
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function h1(n) { let h = Math.imul((n | 0) ^ 0x9e3779b9, 374761393); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export const h2 = (a, b) => h1(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663));
const _c = new THREE.Color();
export const lin = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };
export const mulc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const toHex = (c) => _c.setRGB(c[0], c[1], c[2]).getHex();
const CHAR = [0.03, 0.022, 0.018], EMBER = [1.0, 0.34, 0.05], SOOT = [0.08, 0.07, 0.06];

// ---------------------------------------------------------------------------------------------
// caches and levels
// ---------------------------------------------------------------------------------------------
const LEVELS = new Map();
let surfMs = 0;
export const surfTime = () => surfMs;
/** six detail levels, each made on first read and cached under key */
export function levels(key, make) {
  if (key && LEVELS.has(key)) return LEVELS.get(key);
  const done = [];
  const arr = [];
  for (let lv = 0; lv < LV; lv++) Object.defineProperty(arr, lv, { enumerable: true, get: () => {
    if (done[lv] === undefined) { const t0 = performance.now(); done[lv] = make(lv) || EMPTY; surfMs += performance.now() - t0; if (done[lv] !== EMPTY && !done[lv].boundingSphere) done[lv].computeBoundingSphere(); }
    return done[lv];
  } });
  arr.toJSON = () => undefined;
  arr.lazy = true;
  if (key) { LEVELS.set(key, arr); if (LEVELS.size > 4000) LEVELS.delete(LEVELS.keys().next().value); }
  return arr;
}
/** the same levels with every geometry past `last` dropped (small things are not drawn from far off) */
export function cutAfter(src, last) {
  const arr = [];
  for (let lv = 0; lv < LV; lv++) Object.defineProperty(arr, lv, { enumerable: true, get: () => (lv > last ? EMPTY : src[lv]) });
  arr.toJSON = () => undefined;
  return arr;
}

// ---------------------------------------------------------------------------------------------
// grid builder: vert(u, v) -> writes [x, y, z, r, g, b, rough, metal, glow] into o
// ---------------------------------------------------------------------------------------------
const V9 = new Float64Array(9);
export function gridGeo(nu, nv, vert, o = {}) {
  nu = Math.max(1, Math.round(nu)); nv = Math.max(1, Math.round(nv));
  const n = (nu + 1) * (nv + 1), P = new Float32Array(n * 3), C = new Float32Array(n * 3), M = new Float32Array(n * 3);
  const F = o.flow ? new Float32Array(n * 2) : null;
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const k = i * (nv + 1) + j;
    V9.fill(0); V9[3] = V9[4] = V9[5] = 0.7; V9[6] = 0.8;
    vert(i / nu, j / nv, V9);
    P[k * 3] = V9[0]; P[k * 3 + 1] = V9[1]; P[k * 3 + 2] = V9[2];
    C[k * 3] = V9[3]; C[k * 3 + 1] = V9[4]; C[k * 3 + 2] = V9[5];
    M[k * 3] = V9[6]; M[k * 3 + 1] = V9[7]; M[k * 3 + 2] = V9[8];
    if (F) { F[k * 2] = o.flow(i / nu, j / nv)[0]; F[k * 2 + 1] = o.flow(i / nu, j / nv)[1]; }
  }
  const idx = [];
  const drop = o.drop, rows = o.rows; // rows: v indices where the strip is cut (sharp profile corners: duplicated rows)
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    if (rows && rows.has(j)) continue;
    if (drop && drop((i + 0.5) / nu, (j + 0.5) / nv)) continue;
    const a = i * (nv + 1) + j, b = a + nv + 1;
    if (o.flip) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
  if (F) g.setAttribute('aFlow', new THREE.BufferAttribute(F, 2));
  g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
  g.computeVertexNormals();
  if (o.wrap) seamNormals(g, nu, nv);
  g.computeBoundingSphere();
  return g;
}
// a wrapped grid's first and last columns share their normals, so the seam does not show
function seamNormals(g, nu, nv) {
  const N = g.attributes.normal.array;
  for (let j = 0; j <= nv; j++) {
    const a = j * 3, b = (nu * (nv + 1) + j) * 3;
    const x = N[a] + N[b], y = N[a + 1] + N[b + 1], z = N[a + 2] + N[b + 2], l = Math.hypot(x, y, z) || 1;
    N[a] = N[b] = x / l; N[a + 1] = N[b + 1] = y / l; N[a + 2] = N[b + 2] = z / l;
  }
}

// ---------------------------------------------------------------------------------------------
// surface patterns: P = { pat, col, col2 (lin rgb), seed, win, rune, scale }; s along, t up (model units)
// out: [r, g, b, rough, metal, glow, disp]
// ---------------------------------------------------------------------------------------------
const OUT = new Float64Array(7);
function set(c, ro, me, gl, d) { OUT[0] = c[0]; OUT[1] = c[1]; OUT[2] = c[2]; OUT[3] = ro; OUT[4] = me; OUT[5] = gl; OUT[6] = d; return OUT; }
const groove = (e, w) => 1 - sstep(0, w, e);
export function pattern(P, s, t, up = 0) {
  const sc = P.scale || 1, sd = P.seed || 1;
  s /= sc; t /= sc;
  const c0 = P.col, c2 = P.col2 || mulc(P.col, 0.8);
  const nz = noise3(s * 2.1, t * 2.3, sd) - 0.5, nz2 = noise3(s * 9, t * 9, sd + 3) - 0.5;
  let r;
  switch (P.pat) {
    case 'ashlar': case 'sand': case 'brick': {
      const bw = P.pat === 'brick' ? 0.34 : P.pat === 'sand' ? 1.2 : 0.86, bh = P.pat === 'brick' ? 0.15 : P.pat === 'sand' ? 0.55 : 0.4;
      const row = Math.floor(t / bh), off = (row % 2) * bw * 0.5 + h1(row * 7 + sd) * bw * 0.3;
      const bx = (s + off) / bw, col = Math.floor(bx), fx = fract(bx), fy = fract(t / bh);
      const e = Math.min(Math.min(fx, 1 - fx) * bw, Math.min(fy, 1 - fy) * bh), gw = P.pat === 'brick' ? 0.018 : 0.03;
      const gr = groove(e, gw), hb = h2(col, row + sd * 13);
      let c = mixc(c0, c2, hb * 0.7);
      c = mulc(c, (0.86 + 0.22 * hb) * (1 + 0.16 * nz + 0.06 * nz2) * (1 - 0.5 * gr));
      // rain streaks and soot, darker toward the foot and under ledges
      const streak = sstep(0.55, 0.8, noise3(s * 4, t * 0.35, sd + 9));
      c = mulc(c, 1 - 0.18 * streak - 0.1 * clamp(-up, 0, 1));
      // edge chipping: the block face bulges a little, chips at corners
      const bul = (1 - gr) * 0.012 * Math.sin(PI * clamp(fx, 0, 1)) * Math.sin(PI * clamp(fy, 0, 1));
      r = set(c, 0.86, 0.02, 0, -0.024 * gr + bul + 0.004 * nz2);
      break;
    }
    case 'plank': case 'vplank': {
      const ss = P.pat === 'vplank' ? t : s, tt = P.pat === 'vplank' ? s : t;
      const ph = 0.3, row = Math.floor(tt / ph), fy = fract(tt / ph), off = h1(row + sd) * 2.4, pl = Math.floor((ss + off) / 2.4), fx = fract((ss + off) / 2.4);
      const gr = Math.max(groove(Math.min(fy, 1 - fy) * ph, 0.022), groove(Math.min(fx, 1 - fx) * 2.4, 0.02));
      const hb = h2(pl, row + sd * 5), grain = noise3(ss * 1.2, tt * 26, sd) - 0.5;
      let c = mixc(c0, c2, hb * 0.6);
      c = mulc(c, (0.8 + 0.3 * hb) * (1 + 0.22 * grain + 0.1 * nz) * (1 - 0.55 * gr));
      if ((fx < 0.03 || fx > 0.97) && Math.abs(fy - 0.5) < 0.15) c = mulc(c, 0.4);   // treenails at the butts
      r = set(c, 0.82, 0, 0, -0.022 * gr + 0.008 * fy);       // each strake laps the one below
      break;
    }
    case 'plate': case 'iron': {
      const pw = 1.3, ph = 0.8, row = Math.floor(t / ph), off = (row % 2) * pw * 0.5, fx = fract((s + off) / pw), fy = fract(t / ph);
      const ex = Math.min(fx, 1 - fx) * pw, ey = Math.min(fy, 1 - fy) * ph, e = Math.min(ex, ey);
      const gr = groove(e, 0.016), hb = h2(Math.floor((s + off) / pw), row + sd);
      // rivets: a row inside every seam
      const rv = (ex > 0.05 && ex < 0.11 && fract(t / 0.16) < 0.45) || (ey > 0.05 && ey < 0.11 && fract(s / 0.16) < 0.45);
      let c = mulc(mixc(c0, c2, hb * 0.5), (0.82 + 0.26 * hb) * (1 + 0.14 * nz) * (1 - 0.5 * gr));
      const rust = sstep(0.6, 0.78, noise3(s * 2.5, t * 1.5, sd + 4)) * (P.rust ?? 0.5);
      c = mixc(c, [0.24, 0.1, 0.04], rust * 0.6);
      if (rv) c = mulc(c, 1.22);
      r = set(c, 0.48 + 0.3 * rust, 0.72 * (1 - rust * 0.6), 0, -0.018 * gr + (rv ? 0.012 : 0) + 0.006 * (1 - gr));
      break;
    }
    case 'tile': case 'shingle': case 'thatch': {
      if (P.pat === 'thatch') {
        const st = noise3(s * 30, t * 3, sd);
        const row = fract(t / 0.5), c = mulc(mixc(c0, c2, st), (0.75 + 0.35 * st) * (0.8 + 0.25 * row));
        r = set(c, 0.95, 0, 0, 0.03 * row + 0.01 * st); break;
      }
      const th = P.pat === 'shingle' ? 0.22 : 0.18, tw = P.pat === 'shingle' ? 0.3 : 0.22, row = Math.floor(t / th), fy = fract(t / th);
      const off = (row % 2) * tw * 0.5, fx = fract((s + off) / tw);
      const hb = h2(Math.floor((s + off) / tw), row + sd);
      const curve = P.pat === 'tile' ? Math.sin(PI * fx) : 1 - groove(Math.min(fx, 1 - fx) * tw, 0.012);
      const lap = fy;                                 // each course laps over the one below: thick at its foot
      let c = mulc(mixc(c0, c2, hb * 0.6), (0.78 + 0.3 * hb) * (0.72 + 0.32 * lap) * (0.82 + 0.18 * curve) * (1 + 0.1 * nz));
      const moss = sstep(0.62, 0.8, noise3(s * 1.4, t * 1.4, sd + 7)) * (P.moss ?? 0.3);
      c = mixc(c, [0.18, 0.24, 0.08], moss * 0.6);
      r = set(c, 0.7, P.me ?? 0, 0, 0.028 * lap + 0.012 * curve - 0.01); break;
    }
    case 'gold': case 'bronze': case 'copper': case 'silver': case 'brass': {
      const hm = noise3(s * 14, t * 14, sd) - 0.5;
      let c = mulc(c0, 1 + 0.12 * hm + 0.08 * nz);
      let ro = P.pat === 'silver' ? 0.22 : P.pat === 'gold' ? 0.28 : 0.38;
      if (P.pat === 'copper' || P.pat === 'bronze') { const pat = sstep(0.5, 0.75, noise3(s * 1.8, t * 1.8, sd + 2)) * (P.patina ?? 0.4); c = mixc(c, [0.18, 0.42, 0.32], pat); ro += pat * 0.4; }
      // engraved bands
      const band = groove(Math.abs(fract(t / 0.9) - 0.5) * 0.9, 0.02);
      c = mulc(c, 1 - 0.3 * band);
      r = set(c, ro, 0.88, 0, -0.008 * band + 0.002 * hm); break;
    }
    case 'marble': {
      const vn = Math.abs(Math.sin(s * 2.2 + t * 1.1 + fbm3(s * 0.8, t * 0.8, sd, 3) * 7));
      const vein = 1 - sstep(0, 0.06, vn);
      const bw = 1.6, bh = 0.8, row = Math.floor(t / bh), fx = fract((s + (row % 2) * 0.8) / bw), fy = fract(t / bh);
      const gr = groove(Math.min(Math.min(fx, 1 - fx) * bw, Math.min(fy, 1 - fy) * bh), 0.012);
      let c = mixc(mulc(c0, 1 + 0.06 * nz), c2, vein * 0.5);
      c = mulc(c, 1 - 0.3 * gr);
      r = set(c, 0.28, 0.05, 0, -0.01 * gr); break;
    }
    case 'obsidian': case 'crystal': case 'ice': case 'jade': {
      const cl = cells3(s * 1.3, t * 1.3, sd * 0.37), fac = cells3(s * 3.1 + 7, t * 3.1, sd);
      const edge = sstep(0.04, 0.0, Math.abs(cl - 0.5) * 0.08);
      let c = mulc(mixc(c0, c2, fac * 0.6), 0.85 + 0.35 * fac + 0.15 * nz);
      let gl = 0;
      if (P.pat === 'crystal') gl = 0.25 + 0.3 * fac;
      if (P.pat === 'ice') c = mixc(c, [0.9, 0.96, 1], 0.25 * fac);
      const ro = P.pat === 'obsidian' ? 0.14 : P.pat === 'ice' ? 0.2 : P.pat === 'jade' ? 0.3 : 0.1;
      r = set(c, ro, P.pat === 'obsidian' ? 0.35 : 0.08, gl, 0.04 * fac - 0.02 * edge); break;
    }
    case 'bone': {
      const rib = Math.sin(t * 9 + 2 * nz), por = noise3(s * 18, t * 18, sd);
      const c = mulc(mixc(c0, c2, 0.5 + 0.5 * nz), 0.85 + 0.12 * rib + 0.12 * (por - 0.5));
      r = set(c, 0.65, 0, 0, 0.01 * rib + 0.006 * por); break;
    }
    case 'hide': case 'felt': {
      const pw = P.pat === 'felt' ? 1.1 : 1.6, ph = P.pat === 'felt' ? 0.9 : 1.2, row = Math.floor(t / ph), fx = fract((s + h1(row) * pw) / pw), fy = fract(t / ph);
      const e = Math.min(Math.min(fx, 1 - fx) * pw, Math.min(fy, 1 - fy) * ph), seam = groove(e, 0.035);
      const st = seam > 0.3 && fract((s + t) * 9) < 0.5;
      const hb = h2(Math.floor((s + h1(row) * pw) / pw), row + sd);
      let c = mulc(mixc(c0, c2, hb), (0.8 + 0.28 * hb) * (1 + 0.18 * nz + 0.1 * nz2) * (1 - 0.35 * seam));
      if (st) c = mulc(c, 0.55);
      r = set(c, 0.9, 0, 0, -0.012 * seam + 0.012 * (1 - seam) * Math.sin(PI * fx) * Math.sin(PI * fy)); break;
    }
    case 'plaster': {
      // half-timbered: plaster panels between dark posts and braces
      const pw = 1.1, ph = 1.3, fx = fract(s / pw), fy = fract(t / ph);
      const post = Math.min(fx, 1 - fx) * pw < 0.07 || Math.min(fy, 1 - fy) * ph < 0.06 || Math.abs(fx - fy) * pw < 0.05;
      const c = post ? mulc(c2, 0.9 + 0.2 * nz) : mulc(c0, 0.92 + 0.12 * nz + 0.05 * nz2);
      r = set(c, post ? 0.85 : 0.92, 0, 0, post ? 0.02 : 0); break;
    }
    case 'lacquer': {
      const c = mulc(c0, 1 + 0.06 * nz);
      const band = groove(Math.abs(fract(t / 1.2) - 0.5) * 1.2, 0.03);
      r = set(mixc(c, c2, band * 0.8), 0.32, 0.05, 0, 0.006 * band); break;
    }
    case 'coral': {
      const cl = cells3(s * 4, t * 4, sd), por = 1 - sstep(0.15, 0.3, cl);
      const c = mulc(mixc(c0, c2, sstep(0.3, 0.7, noise3(s, t, sd))), 0.85 + 0.2 * cl - 0.25 * por);
      r = set(c, 0.75, 0, 0, -0.03 * por + 0.02 * cl); break;
    }
    case 'glass': {
      // stained glass: leaded cells of colour that light up from within
      const cl = cells3(s * 3, t * 3, sd), lead = sstep(0.05, 0.0, Math.abs(cl - 0.42) * 0.25);
      const pal = P.glass || [[0.8, 0.12, 0.1], [0.1, 0.2, 0.8], [0.9, 0.7, 0.1], [0.1, 0.6, 0.3]];
      const k = Math.floor(h2(Math.floor(s * 3), Math.floor(t * 3)) * pal.length);
      const c = lead > 0.3 ? [0.05, 0.05, 0.05] : pal[k];
      r = set(c, 0.2, 0, lead > 0.3 ? 0 : 0.8, -0.01 * lead); break;
    }
    case 'grass': case 'moss': case 'soil': case 'sandy': case 'snow': {
      const p1 = fbm3(s * 0.7, t * 0.7, sd, 3), p2 = noise3(s * 6, t * 6, sd + 1);
      const base = P.pat === 'snow' ? [0.85, 0.9, 0.95] : P.pat === 'soil' ? [0.16, 0.1, 0.06] : P.pat === 'sandy' ? [0.6, 0.45, 0.25] : c0;
      let c = mulc(mixc(base, c2, sstep(0.45, 0.7, p1)), 0.8 + 0.35 * p2);
      if (P.pat === 'grass' && p2 > 0.86) c = h2(Math.floor(s * 6), Math.floor(t * 6)) > 0.5 ? [0.8, 0.7, 0.2] : [0.75, 0.75, 0.8]; // flowers
      r = set(c, 0.95, 0, 0, 0.04 * p2 + 0.08 * (p1 - 0.5)); break;
    }
    default: {
      const c = mulc(c0, 1 + 0.15 * nz + 0.06 * nz2);
      r = set(c, P.ro ?? 0.8, P.me ?? 0, P.gl ?? 0, 0.004 * nz2);
    }
  }
  // windows: arched openings in rows, recessed, glazed dark or lit
  const W = P.win;
  if (W && t > (W.y0 ?? 0.5) && t < (W.y1 ?? 1e9)) {
    const fx = fract(s / W.sp + 0.5) - 0.5, tt = t - (W.y0 ?? 0.5), fy = fract(tt / W.dy);
    const wx = Math.abs(fx) * W.sp, wy = fy * W.dy, hw = W.w / 2, wh = W.h, wb = W.dy * 0.22;
    const top = wb + wh - hw, inArch = wy > wb && (wy < top ? wx < hw : Math.hypot(wx, wy - top) < hw);
    const frame = !inArch && wy > wb - 0.06 && wy < wb + wh + 0.06 && wx < hw + 0.07;
    if (inArch) {
      const lit = h2(Math.floor(s / W.sp + 0.5), Math.floor(tt / W.dy) + (P.seed || 0)) < (W.lit ?? 0.55);
      const cc = lit ? (W.glow || [1, 0.7, 0.3]) : [0.04, 0.04, 0.06];
      const mull = Math.abs(fx * W.sp) < 0.025 || Math.abs(wy - (wb + wh * 0.55)) < 0.02;
      if (mull) set(mulc(c0, 0.5), 0.6, 0.3, 0, -0.04); else set(cc, 0.2, 0, lit ? 0.9 : 0, -0.07);
    } else if (frame) { OUT[0] *= 1.18; OUT[1] *= 1.15; OUT[2] *= 1.1; OUT[6] += 0.018; }
  }
  // runes: a glowing band of glyphs
  const R = P.rune;
  if (R && Math.abs(t - R.t) < R.h / 2) {
    const g = Math.floor(s / (R.h * 0.8)), gx = fract(s / (R.h * 0.8)), gy = (t - R.t) / R.h + 0.5;
    const k = h1(g * 31 + (P.seed || 0));
    const on = (Math.abs(gx - 0.5) < 0.07 && gy > 0.15 && gy < 0.85) || (k > 0.5 && Math.abs(gy - gx) < 0.07 && gx > 0.2 && gx < 0.8) || (k < 0.5 && Math.abs(gy - 0.6 + (gx - 0.5) * 0.6) < 0.06 && gx > 0.3);
    if (on) set(R.col, 0.4, 0, R.k ?? 1.2, OUT[6] - 0.02);
  }
  return OUT;
}

// ---------------------------------------------------------------------------------------------
// damage holes in (u, v) of a surface, growing with the level
// ---------------------------------------------------------------------------------------------
export function holesOf(seed, lv, scale, vr = [0.15, 0.9]) {
  const out = [];
  const add = (n, r0, r1, s0) => { for (let i = 0; i < n; i++) { const s = seed * 31 + s0 * 101 + i * 7; out.push({ u: h1(s), v: lerp(vr[0], vr[1], h1(s + 3)), r: scale * lerp(r0, r1, h1(s + 5)), lv: s0 }); } };
  if (lv >= 1) add(4, 0.18, 0.32, 1);
  if (lv >= 2) add(4, 0.35, 0.6, 2);
  if (lv >= 3) add(4, 0.7, 1.15, 3);
  return out;
}
/** applies the holes to one vertex: d(u, v, hole) is the model-unit distance; returns true where the cell is torn out */
function scorch(o, holes, d, lv) {
  let gone = false;
  for (const hh of holes) {
    const dd = d(hh), rim = hh.r * 1.6;
    if (dd < hh.r * 0.82) gone = true;
    if (dd < rim) {
      const k = clamp(1 - (dd - hh.r) / (rim - hh.r), 0, 1);
      o[3] = lerp(o[3], CHAR[0], k * 0.92); o[4] = lerp(o[4], CHAR[1], k * 0.92); o[5] = lerp(o[5], CHAR[2], k * 0.92); o[6] = 0.95; o[7] = 0;
      if (hh.lv >= 2 && dd < hh.r * 1.22 && lv < 3) { o[3] = lerp(o[3], EMBER[0], 0.7); o[4] = lerp(o[4], EMBER[1], 0.7); o[5] = lerp(o[5], EMBER[2], 0.7); o[8] = 0.9; }
    } else if (dd < hh.r * 3.2) { const k = 0.4 * (1 - (dd - rim) / (hh.r * 3.2 - rim)); o[3] = lerp(o[3], SOOT[0], k); o[4] = lerp(o[4], SOOT[1], k); o[5] = lerp(o[5], SOOT[2], k); }
  }
  return gone;
}

// ---------------------------------------------------------------------------------------------
// prisms: a plan swept up a profile
// ---------------------------------------------------------------------------------------------
/** the plan: returns { len, at(u) -> [x, z, nx, nz, corner (0..1)] } (plan centred on the origin) */
function planOf(sp) {
  const type = sp.plan || 'circle';
  if (type === 'circle') {
    const rx = (sp.w || 2) / 2, rz = (sp.d || sp.w || 2) / 2;
    return { len: PI * (rx + rz), at: (u) => { const a = u * TAU; const nx = Math.cos(a) / rx, nz = Math.sin(a) / rz, l = Math.hypot(nx, nz); return [Math.cos(a) * rx, Math.sin(a) * rz, nx / l, nz / l, 0]; } };
  }
  // polygon outline (rect, n-gon, star), corners rounded by sp.corner, sampled by arc length
  let pts;
  if (type === 'rect') { const w = sp.w / 2, d = (sp.d ?? sp.w) / 2; pts = [[w, d], [-w, d], [-w, -d], [w, -d]]; }
  else if (type === 'star') { const n = sp.n || 8, r1 = sp.w / 2, r2 = r1 * (sp.r2 ?? 0.6); pts = []; for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU + (sp.rot || 0), r = i % 2 ? r2 : r1; pts.push([Math.cos(a) * r, Math.sin(a) * r * ((sp.d ?? sp.w) / sp.w)]); } }
  else { const n = sp.n || 6, r = sp.w / 2; pts = []; for (let i = 0; i < n; i++) { const a = (i / n) * TAU + (sp.rot ?? PI / n); pts.push([Math.cos(a) * r, Math.sin(a) * r * ((sp.d ?? sp.w) / sp.w)]); } }
  // rounded corners: each corner becomes an arc of radius cr
  const cr = sp.corner ?? 0.06, path = [];
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const p = pts[i], a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
    const da = [a[0] - p[0], a[1] - p[1]], db = [b[0] - p[0], b[1] - p[1]], la = Math.hypot(...da), lb = Math.hypot(...db);
    const r = Math.min(cr, la * 0.45, lb * 0.45);
    const pa = [p[0] + (da[0] / la) * r, p[1] + (da[1] / la) * r], pb = [p[0] + (db[0] / lb) * r, p[1] + (db[1] / lb) * r];
    for (let k = 0; k <= 4; k++) { const t = k / 4, q = [(1 - t) * (1 - t) * pa[0] + 2 * (1 - t) * t * p[0] + t * t * pb[0], (1 - t) * (1 - t) * pa[1] + 2 * (1 - t) * t * p[1] + t * t * pb[1]]; path.push([...q, k === 2 ? 1 : 0.6]); }
  }
  // the outline must run counter-clockwise seen from above (+y): normals outward
  let area = 0; for (let i = 0; i < path.length; i++) { const p = path[i], q = path[(i + 1) % path.length]; area += p[0] * q[1] - q[0] * p[1]; }
  if (area > 0) path.reverse();
  const cum = [0];
  for (let i = 1; i <= path.length; i++) { const p = path[i - 1], q = path[i % path.length]; cum.push(cum[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1])); }
  const len = cum[cum.length - 1];
  const at = (u) => {
    const s = fract(u) * len; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const p = path[i - 1], q = path[i % path.length], f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const x = lerp(p[0], q[0], f), z = lerp(p[1], q[1], f), tx = q[0] - p[0], tz = q[1] - p[1], l = Math.hypot(tx, tz) || 1;
    // outward normal of a clockwise-from-above path (x, z): (tz, -tx)
    return [x, z, tz / l, -tx / l, lerp(p[2], q[2], f)];
  };
  // corner proximity (for upturned eaves): 1 at a corner, falling to 0 a fifth of a side away
  const cornerK = (u) => { const s = fract(u) * len; let best = 1e9; const n = path.length / 5; for (let i = 0; i < n; i++) { const cs = cum[i * 5 + 2]; let d = Math.abs(s - cs); d = Math.min(d, len - d); best = Math.min(best, d); } return clamp(1 - best / (len / (n * 4.5)), 0, 1); };
  return { len, at: (u) => { const r = at(u); r[4] = cornerK(u); return r; } };
}
/**
 * spec: { plan, w, d, n, r2, corner, rot, prof: [[k, off, y, mat?, flag?], ...] (k scales the plan about its centre,
 *         off pushes out along the plan's normal; mat names the material of the segment ending at this point; flag 'e':
 *         an eave that turns up at the corners by spec.upturn), mats: { name: pattern P }, dens (cells per unit),
 *         holes: true (damage holes), broken (0..1: the top is gone above a jagged line at that fraction of the height),
 *         seed }
 */
export function prismGeo(key, sp, dmg = 0) {
  return levels(`prism|${key}|${dmg}`, (lv) => buildPrism(sp, lv, dmg));
}
function buildPrism(sp, lv, dmg) {
  const plan = planOf(sp), prof = sp.prof, dens = (sp.dens || 10) * KQ[lv];
  const nu = Math.max(sp.plan === 'rect' ? 8 : sp.n ? sp.n * 2 : 6, Math.round(plan.len * dens * (sp.uk || 1)));
  // rows: walk the profile, each segment gets rows by its length; a sharp corner duplicates the row
  const rows = [], cut = new Set();
  let tAcc = 0;
  for (let i = 1; i < prof.length; i++) {
    const a = prof[i - 1], b = prof[i];
    const ra = a[0] * sp.w / 2 + a[1], rb = b[0] * sp.w / 2 + b[1], seg = Math.hypot(rb - ra, b[2] - a[2]);
    const n = Math.max(1, Math.round(seg * dens * (sp.vk || 1)));
    const mat = b[3] || 'wall';
    const smooth = b[5] === 's';      // a curved profile point: no duplicated row (a smooth dome)
    for (let k = smooth && i > 1 ? 1 : 0; k <= n; k++) {
      const f = k / n;
      const ls = seg || 1, nr = (b[2] - a[2]) / ls, ny = -(rb - ra) / ls;
      rows.push({ k: lerp(a[0], b[0], f), off: lerp(a[1], b[1], f), y: lerp(a[2], b[2], f), t: tAcc + f * seg, mat, e: (b[4] === 'e' ? f : 0) + (a[4] === 'e' ? 1 - f : 0), nr: seg ? nr : 1, ny: seg ? ny : 0, up: seg ? ny : 0 });
    }
    tAcc += seg;
    if (i < prof.length - 1 && !(prof[i + 1][5] === 's')) cut.add(rows.length - 1);
  }
  const nv = rows.length - 1;
  const H = Math.max(...prof.map((p) => p[2])), H0 = Math.min(...prof.map((p) => p[2]));
  const holes = dmg && sp.holes !== false ? holesOf(sp.seed || 3, dmg, Math.max(0.35, sp.w * 0.25), [0.1, 0.8]) : null;
  const broken = sp.broken ? H0 + (H - H0) * sp.broken : null;
  const per = plan.len;
  const vert = (u, vv, o) => {
    const j = Math.round(vv * nv), R = rows[j], [px, pz, nx, nz, cn] = plan.at(u);
    let x = px * R.k + nx * R.off, z = pz * R.k + nz * R.off, y = R.y;
    if (R.e && sp.upturn) y += sp.upturn * R.e * Math.pow(cn, 2);
    const P = sp.mats[R.mat] || sp.mats.wall;
    const s = u * per * clamp(R.k + R.off / Math.max(0.3, sp.w / 2), 0.08, 2);
    const pt = pattern(P, s, R.t, R.up);
    // the pattern displaces along the profile's own normal (out of walls, up out of roofs)
    const d = pt[6];
    x += nx * d * R.nr; z += nz * d * R.nr; y += d * R.ny;
    o[0] = x; o[1] = y; o[2] = z;
    // light from above, occlusion toward the foot of a wall and under eaves
    const ao = 1 - 0.22 * clamp(1 - (y - H0) / 1.2, 0, 1) * (sp.footAo ?? 1);
    o[3] = pt[0] * ao; o[4] = pt[1] * ao; o[5] = pt[2] * ao; o[6] = pt[3]; o[7] = pt[4]; o[8] = pt[5];
    if (broken !== null) {
      const jag = broken + (noise3(u * per * 1.7, 3, sp.seed || 1) - 0.5) * (H - H0) * 0.22;
      if (y > jag) { o[1] = jag - 0.05 * noise3(u * 30, 1, 2); o[3] = CHAR[0] * 3; o[4] = CHAR[1] * 3; o[5] = CHAR[2] * 3; o[6] = 0.95; o[7] = 0; }
      else if (y > jag - 0.6) { const k = 1 - (jag - y) / 0.6; o[3] = lerp(o[3], CHAR[0], k * 0.85); o[4] = lerp(o[4], CHAR[1], k * 0.85); o[5] = lerp(o[5], CHAR[2], k * 0.85); }
    }
    if (holes) scorch(o, holes, (hh) => { let du = Math.abs(u - hh.u); du = Math.min(du, 1 - du); return Math.hypot(du * per, R.t - hh.v * tAcc); }, dmg);
  };
  const drop = holes ? (u, vv) => { const R = rows[Math.min(nv, Math.round(vv * nv))]; if (Math.abs(R.up) > 0.5) return false; return holes.some((hh) => { let du = Math.abs(u - hh.u); du = Math.min(du, 1 - du); return Math.hypot(du * per, R.t - hh.v * tAcc) < hh.r * (0.7 + 0.45 * noise3(u * 40, vv * 30, hh.u * 9)); }); } : null;
  return gridGeo(nu, nv, vert, { rows: cut, drop, wrap: true });
}

// ---- profile helpers (lists of [k, off, y, mat, flag, smooth]) ----
/** a straight wall from y0 to y1 at plan scale k (taper: k at the top) */
export const wall = (y0, y1, k = 1, kt = k, mat = 'wall') => [[k, 0, y0, mat], [kt, 0, y1, mat]];
/** a dome over a ring at plan scale k0, rising h; shape: 'dome' | 'onion' | 'cone' | 'bell' | 'pagoda' | 'flat' */
export function cap(k0, y0, h, shape = 'dome', mat = 'roof', o = {}) {
  const out = [], N = shape === 'cone' || shape === 'flat' ? 1 : 9;
  if (shape === 'flat') return [[k0, 0, y0, mat], [0, 0, y0, mat]];
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    let k, y;
    if (shape === 'dome') { k = k0 * Math.cos(t * PI / 2); y = y0 + h * Math.sin(t * PI / 2); }
    else if (shape === 'onion') { const a = t * PI; k = k0 * (Math.sin(a * 0.92 + 0.2) * 1.25) * (1 - t) ** 0.35; y = y0 + h * (1 - Math.cos(t * PI)) / 2; }
    else if (shape === 'bell') { k = k0 * (1 - t ** 1.6) ** 0.9 * (1 + 0.15 * Math.sin(t * PI)); y = y0 + h * t; }
    else if (shape === 'pagoda') { k = k0 * (1 - t) ** 1.8; y = y0 + h * t ** 0.85; }
    else { k = k0 * (1 - t); y = y0 + h * t; }
    out.push([Math.max(0, k), 0, y, mat, i === 1 && o.eave ? 'e' : undefined, i > 1 ? 's' : undefined]);
  }
  out[out.length - 1][0] = 0;
  return out;
}
/** a projecting cornice / string course band at y (out: how far it stands out) */
export const band = (k, y, out = 0.12, h = 0.16, mat = 'trim') => [[k, 0, y, mat], [k, out, y, mat], [k, out, y + h, mat], [k, 0, y + h, mat]];
/** an eave: the roof flares out past the wall by out, turned up at the corners when the spec has upturn */
export const eave = (k, y, out, mat = 'roof') => [[k, 0, y, 'wall'], [k, out, y - 0.05, mat, 'e'], [k, out, y + 0.06, mat, 'e']];

// ---------------------------------------------------------------------------------------------
// floating rock: one wrapped grid from the middle of the top, out over the rim and down the hanging underside
// ---------------------------------------------------------------------------------------------
/**
 * spec: { rx, rz, depth, top(x, z) -> height of the top surface, rimNoise (0..0.3), lobes (stalactite points),
 *         topP (pattern of the top), rockP (pattern of the cliffs: col, col2), under (hex: the wet dark underside),
 *         veins: { col, k } glowing seams, strata (1), seed, dens, flat: an exactly flat area of radius flat at the centre }
 */
export function rockGeo(key, sp, dmg = 0) {
  return levels(`rock|${key}|${dmg}`, (lv) => buildRock(sp, lv, dmg));
}
export function rockRim(sp) {
  const sd = sp.seed || 1, rn = sp.rimNoise ?? 0.14;
  return (a) => { const f = 1 + rn * (fbm3(Math.cos(a) * 1.3, Math.sin(a) * 1.3, sd, 3) - 0.5) * 2 + 0.04 * Math.sin(a * 7 + sd); return [Math.cos(a) * sp.rx * f, Math.sin(a) * sp.rz * f]; };
}
function buildRock(sp, lv, dmg) {
  const dens = (sp.dens || 7) * KQ[lv], sd = sp.seed || 1, rim = rockRim(sp);
  const per = PI * (sp.rx + sp.rz), R = Math.max(sp.rx, sp.rz);
  const vr = sp.vr ?? 0.42;                          // the share of v that is the top surface
  const sideLen = sp.depth * 1.4 + R * 0.4;
  const nu = Math.max(24, Math.round(per * dens)), nv = Math.max(10, Math.round((R + sideLen) * dens));
  const holes = dmg ? holesOf(sd + 11, dmg, Math.max(1, R * 0.09), [vr + 0.08, 0.85]) : null;
  const rockP = { pat: 'rock', ...sp.rockP }, topP = sp.topP || { pat: 'grass', col: lin(0x4a7a2a), col2: lin(0x6a5a2a) };
  const c1 = rockP.col, c2 = rockP.col2 || mulc(c1, 0.7), under = sp.under ? lin(sp.under) : mulc(c1, 0.45);
  const lobes = sp.lobes ?? 5;
  const vert = (u, v, o) => {
    const a = u * TAU, [ex, ez] = rim(a);
    let x, y, z, top = v <= vr;
    if (top) {
      const f = (v / vr) ** 0.9;
      x = ex * f; z = ez * f;
      y = sp.top ? sp.top(x, z) : 0;
      // the lip rolls over at the rim
      const lip = sstep(0.9, 1, f);
      y -= lip * lip * 0.35;
      const pt = pattern(topP, x * 1.2 + 50, z * 1.2, 0);
      y += pt[6] * (sp.flat && Math.hypot(x, z) < sp.flat ? 0 : 1);
      o[0] = x; o[1] = y; o[2] = z;
      let c = [pt[0], pt[1], pt[2]];
      // a soil band at the lip and grass thinning to bare rock where the ground is steep or high
      c = mixc(c, mulc(c1, 0.8), lip * 0.7 + clamp((y - (sp.snowLine ?? 99)) * 0.3, 0, 1) * 0);
      o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = pt[3]; o[7] = pt[4]; o[8] = pt[5];
    } else {
      const w = (v - vr) / (1 - vr);
      // radius: bulges just under the rim then falls away in ledges to the hanging tip
      const ledge = 0.06 * Math.sin(w * 22 + fbm3(a * 2, w * 3, sd) * 5);
      const k = Math.max(0, (1 - w) ** (sp.pow ?? 0.75) * (1 + 0.1 * Math.sin(w * PI) + ledge) * (1 - 0.18 * w));
      const lob = 1 + 0.55 * Math.pow(Math.max(0, Math.sin(a * lobes + sd) * 0.5 + 0.5 * noise3(Math.cos(a) * 2, Math.sin(a) * 2, sd + 5)), 2.2);
      const ytop = sp.top ? sp.top(ex, ez) : 0;
      x = ex * k; z = ez * k; y = ytop - 0.35 - sp.depth * Math.pow(w, sp.ypow ?? 1.15) * lerp(1, lob, w);
      // rough rock: displaced in and out along the outward normal
      const nrm = fbm3(x * 0.55, y * 0.7, z * 0.55, 4) - 0.5, sharp = cells3(x * 0.9, y * 1.4, z * 0.9);
      const dd = (nrm * 0.9 + (sharp - 0.5) * 0.35) * (sp.rough ?? 0.6) * (0.5 + 0.5 * Math.min(1, R * 0.1));
      const nl = Math.hypot(ex, ez) || 1;
      x += (ex / nl) * dd; z += (ez / nl) * dd; y += dd * 0.4 * w;
      o[0] = x; o[1] = y; o[2] = z;
      // strata: bands of two rock tones, wet and dark underneath, moss and roots under the lip
      const st = sstep(0.3, 0.7, noise3(a * 0.6, y * 1.4 * (sp.strata ?? 1), sd + 2)) * 0.8 + 0.2 * fract(y * 1.7);
      let c = mixc(c1, c2, st);
      c = mulc(c, 0.75 + 0.45 * sharp + 0.15 * nrm);
      c = mixc(c, under, sstep(0.35, 1, w) * 0.75);
      const moss = sstep(0, 0.12, 0.14 - w) * sstep(0.45, 0.7, noise3(a * 5, y * 2, sd + 8)) * (sp.moss ?? 1);
      if (sp.mossCol !== null) c = mixc(c, sp.mossCol ? lin(sp.mossCol) : [0.12, 0.2, 0.05], moss * 0.8);
      let gl = 0;
      if (sp.veins) {
        const vn = Math.abs(noise3(x * 0.5, y * 0.8, z * 0.5) - 0.5);
        if (vn < (sp.veins.w ?? 0.018)) { c = sp.veins.c; gl = sp.veins.k ?? 1.3; }
      }
      if (sp.ice) c = mixc(c, [0.85, 0.92, 1], 0.2 * sharp);
      o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = sp.ro ?? 0.92; o[7] = sp.me ?? 0; o[8] = gl;
    }
    if (holes && !top) scorch(o, holes, (hh) => { let du = Math.abs(u - hh.u); du = Math.min(du, 1 - du); return Math.hypot(du * per, (v - hh.v) * sideLen * 1.5); }, dmg);
  };
  const drop = holes ? (u, v) => v > vr + 0.05 && holes.some((hh) => hh.lv >= 2 && (() => { let du = Math.abs(u - hh.u); du = Math.min(du, 1 - du); return Math.hypot(du * per, (v - hh.v) * sideLen * 1.5) < hh.r * (0.55 + 0.4 * noise3(u * 40, v * 30, hh.u * 9)); })()) : null;
  return gridGeo(nu, nv, vert, { wrap: true, drop });
}

// ---------------------------------------------------------------------------------------------
// a great hull: +x forward, deck at y = 0, keel at -D
// ---------------------------------------------------------------------------------------------
/** spec: { HL, HB, HD, P (pattern), wale (hex), ports: [{ y, n }] rows of gunports, sheer, tumble, seed, dens, glow (port light) } */
export function hullGeo(key, sp, dmg = 0) { return levels(`hull|${key}|${dmg}`, (lv) => buildHull(sp, lv, dmg)); }
export function hullHalfBeam(sp, t) {
  const HB = sp.HB;
  if (t > 0.6) return (HB / 2) * Math.sqrt(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2)) + 0.03;
  if (t < 0.1) return (HB / 2) * (0.82 + 0.18 * (t / 0.1));
  return HB / 2;
}
export function hullPt(sp, t, f) {
  const b = hullHalfBeam(sp, t), dep = sp.HD * (t > 0.66 ? 1 - 0.55 * ((t - 0.66) / 0.34) ** 1.4 : t < 0.12 ? 0.75 + 0.25 * (t / 0.12) : 1);
  const s = Math.sin(f), c = Math.cos(f);
  const sheer = (sp.sheer ?? 0.5) * ((t - 0.5) * 2) ** 2;
  // the sides tumble home above the widest line
  const ys = -dep * Math.pow(Math.max(0, s), 0.8), yy = ys + (s < 0 ? 0 : 0);
  const zw = b * Math.sign(c) * Math.pow(Math.abs(c), 0.5) * (1 - (sp.tumble ?? 0.06) * clamp(1 + ys / (dep * 0.4), 0, 1));
  return [-sp.HL / 2 + t * sp.HL, yy + sheer * clamp(1 + ys / dep, 0, 1), zw];
}
function buildHull(sp, lv, dmg) {
  const dens = (sp.dens || 9) * KQ[lv];
  const nu = Math.max(16, Math.round(sp.HL * dens)), nv = Math.max(10, Math.round((sp.HB + sp.HD * 2) * dens * 1.2)) & ~1;
  const P = sp.P, wale = sp.wale ? lin(sp.wale) : null, seed = sp.seed || 1;
  const holes = dmg ? holesOf(seed + 5, dmg, Math.max(0.6, sp.HD * 0.22), [0.15, 0.85]) : null;
  const ports = sp.ports || [];
  const vert = (u, v, o) => {
    const f = v * PI, p = hullPt(sp, u, f), side = v < 0.5 ? 1 : -1;
    const fs = side > 0 ? f / (PI / 2) : (PI - f) / (PI / 2);          // 0 at the rail, 1 at the keel
    const s = u * sp.HL, t = -p[1];
    const pt = pattern(P, s + (side < 0 ? 100 : 0), sp.HD * 2 - t * 1.0, 0);
    let c = [pt[0], pt[1], pt[2]], ro = pt[3], me = pt[4], gl = pt[5], d = pt[6];
    // wales: raised bands of trim colour
    if (wale) for (const wy of sp.wales || [0.18, 0.55]) { const e = Math.abs(t - wy * sp.HD); if (e < 0.09) { c = mulc(wale, 1 - e * 2); ro = 0.4; me = 0.7; d = 0.04 * (1 - e / 0.09); } }
    // gunports: lids hinged up, a dark mouth, a lit interior where the guns are
    for (const r of ports) {
      const py = r.y * sp.HD, ex = Math.abs(t - py);
      if (ex < 0.24 && u > 0.12 && u < 0.86) {
        const k = fract((s - sp.HL * 0.12) / r.sp), dx = Math.abs(k - 0.5) * r.sp;
        if (dx < 0.24) { const inner = dx < 0.18 && ex < 0.18; c = inner ? (sp.glow ? mulc(lin(sp.glow), 0.6) : [0.05, 0.04, 0.03]) : mulc(wale || c, 0.8); gl = inner && sp.glow ? 0.5 : 0; d = inner ? -0.08 : 0.025; ro = 0.7; me = inner ? 0 : 0.6; }
      }
    }
    if (fs > 0.86) c = mulc(c, 0.55);                                       // tar along the keel
    const nl = Math.hypot(0, p[1], p[2]) || 1;
    o[0] = p[0]; o[1] = p[1] + (p[1] / nl) * d; o[2] = p[2] + (p[2] / nl) * d;
    o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = ro; o[7] = me; o[8] = gl;
    if (holes) scorch(o, holes, (hh) => Math.hypot((u - hh.u) * sp.HL, (v - hh.v) * PI * sp.HD), dmg);
  };
  const drop = holes ? (u, v) => holes.some((hh) => hh.lv >= 1 && Math.hypot((u - hh.u) * sp.HL, (v - hh.v) * PI * sp.HD) < hh.r * (0.6 + 0.45 * noise3(u * 50, v * 30, hh.u * 9))) : null;
  return gridGeo(nu, nv, vert, { drop });
}
/** the deck of a hull: a plank floor at y (the same outline as the hull at the rail) */
export function deckGeo(key, sp, y = 0) {
  return levels(`deck|${key}|${y}`, (lv) => {
    const dens = (sp.dens || 9) * KQ[lv], nu = Math.max(8, Math.round(sp.HL * dens)), nv = Math.max(4, Math.round(sp.HB * dens));
    const P = sp.deckP || { pat: 'plank', col: lin(0xa08058), col2: lin(0x806040), seed: 9 };
    return gridGeo(nu, nv, (u, v, o) => {
      const b = hullHalfBeam(sp, u) - 0.06, x = -sp.HL / 2 + u * sp.HL, z = (v * 2 - 1) * b;
      const pt = pattern(P, z * 1 + 30, x, 0);
      o[0] = x; o[1] = y + pt[6] * 0.4; o[2] = z; o[3] = pt[0]; o[4] = pt[1]; o[5] = pt[2]; o[6] = pt[3]; o[7] = pt[4]; o[8] = pt[5];
    }, { flip: true });
  });
}

// ---------------------------------------------------------------------------------------------
// rings, tubes, chains, sheets
// ---------------------------------------------------------------------------------------------
/** a ring about +y: radius R, tube radius r (ry: flattened); P pattern; runes glow along its outer face */
export function ringGeo(key, R, r, P, o = {}) {
  return levels(`ring|${key}`, (lv) => {
    const dens = 10 * KQ[lv], nu = Math.max(16, Math.round(TAU * R * dens * 0.8)), nv = Math.max(6, Math.round(TAU * r * dens * 2.5));
    const ry = o.ry ?? 1, rz = o.rz ?? 1;
    return gridGeo(nu, nv, (u, v, out) => {
      const a = u * TAU, b = v * TAU, s = u * TAU * R;
      const pt = pattern(P, s, v * TAU * r * 3, 0);
      let gl = pt[5], c = [pt[0], pt[1], pt[2]], d = pt[6] * 0.4;
      // the outer face carries glyphs (a lit band) and the edges a raised bead
      if (o.rune && Math.abs(Math.cos(b) - 1) < 0.25) { const g = fract(s / (r * 1.6)), on = Math.abs(g - 0.5) < 0.12 || (h1(Math.floor(s / (r * 1.6))) > 0.5 && Math.abs(Math.sin(b) * 4 - (g - 0.5) * 6) < 0.6); if (on) { c = o.rune; gl = 1.4; d = -0.01; } }
      const bead = Math.abs(Math.sin(b)) > 0.92 ? 0.012 : 0;
      const rr = r + d + bead, cx = Math.cos(a) * (R + Math.cos(b) * rr * rz), cz = Math.sin(a) * (R + Math.cos(b) * rr * rz), cy = Math.sin(b) * rr * ry;
      out[0] = cx; out[1] = cy; out[2] = cz; out[3] = c[0]; out[4] = c[1]; out[5] = c[2]; out[6] = pt[3]; out[7] = pt[4]; out[8] = gl;
    }, { wrap: true });
  });
}
/** a tube through pts (catmull-rom), radius r (number or fn(t)), colour c (lin), bumps: rope twist */
export function tubeGeo(key, pts, r, col, o = {}) {
  return levels(`tube|${key}`, (lv) => {
    if (lv > (o.last ?? 3)) return EMPTY;
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    const L = curve.getLength(), nu = Math.max(4, Math.round(L * (o.dens ?? 6) * KQ[lv])), nv = Math.max(4, Math.round((o.sides ?? 8) * Math.max(0.5, KQ[lv] * 1.6)));
    const F = curve.computeFrenetFrames(nu, false);
    const rf = typeof r === 'function' ? r : () => r;
    return gridGeo(nu, nv, (u, v, out) => {
      const i = Math.round(u * nu), p = curve.getPointAt(u), N = F.normals[i], B = F.binormals[i], a = v * TAU;
      let rr = rf(u);
      let c = col;
      if (o.twist) { const tw = Math.sin(a * 3 + u * L * 18); rr *= 1 + 0.12 * tw; c = mulc(col, 0.85 + 0.15 * tw); }
      if (o.chain) { const ln = fract(u * L / (rr * 3.2)), k = Math.abs(ln - 0.5) * 2; rr *= 0.55 + 0.6 * Math.sqrt(Math.max(0, 1 - k * k)) * (Math.floor(u * L / (rr * 3.2)) % 2 ? Math.abs(Math.cos(a)) * 0.6 + 0.4 : Math.abs(Math.sin(a)) * 0.6 + 0.4); }
      if (o.bark) { const bk = noise3(u * L * 3, Math.cos(a) * 2, Math.sin(a) * 2); rr *= 0.92 + 0.18 * bk; c = mulc(col, 0.7 + 0.45 * bk); }
      out[0] = p.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * rr; out[1] = p.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * rr; out[2] = p.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * rr;
      out[3] = c[0]; out[4] = c[1]; out[5] = c[2]; out[6] = o.ro ?? 0.6; out[7] = o.me ?? 0; out[8] = o.gl ?? 0;
    }, { wrap: false });
  });
}
/** many thin tubes (rigging, ropes, vines) in one geometry */
export function tubesGeo(key, list, col, o = {}) {
  return levels(`tubes|${key}`, (lv) => {
    if (lv > (o.last ?? 3)) return EMPTY;
    const gs = list.map((t, i) => tubeGeo(`${key}#${i}`, t.pts, t.r, t.col || col, { ...o, last: 9 })[lv]).filter((g) => g !== EMPTY);
    return gs.length ? merge(gs) : EMPTY;
  });
}
export function merge(gs) {
  let n = 0, ni = 0;
  for (const g of gs) { n += g.attributes.position.count; ni += g.index.count; }
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3), M = new Float32Array(n * 3), I = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const g of gs) {
    P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); C.set(g.attributes.color.array, o * 3);
    if (g.attributes.aPbr) M.set(g.attributes.aPbr.array, o * 3);
    const ix = g.index.array; for (let i = 0; i < ix.length; i++) I[oi + i] = ix[i] + o;
    o += g.attributes.position.count; oi += ix.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3)); g.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
  g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeBoundingSphere();
  return g;
}
/** a hanging cloth (banner) in the xy plane: hoist at x = 0, flying to +x for w, hanging down h; aWave grows toward the fly */
export function bannerGeo(key, w, h, col, col2, cut = 'swallow') {
  return levels(`banner|${key}`, (lv) => {
    if (lv > 3) return EMPTY;
    const nu = Math.max(3, Math.round(w * 10 * KQ[lv] * 1.5)), nv = Math.max(3, Math.round(h * 10 * KQ[lv] * 1.5));
    const c1 = lin(col), c2 = lin(col2);
    const g = gridGeo(nu, nv, (u, v, o) => {
      let x = u * w, y = -v * h;
      // the cut of the fly: swallowtail, points, a straight hem
      if (cut === 'swallow') { const notch = sstep(0.75, 1, u) * (1 - Math.abs(v - 0.5) * 2) * 0.35 * h; y += 0; x -= notch * 0.0; if (u > 0.8 && Math.abs(v - 0.5) < (u - 0.8) * 1.2) { x = 0.8 * w; } }
      if (cut === 'pennon') y = -v * h * (1 - u * 0.85) - u * h * 0.07;
      if (cut === 'tatter') y -= (noise3(u * 9, 1, 4) - 0.3) * 0.25 * h * u;
      const fold = Math.sin(u * 14 + v * 2) * 0.03 * u;
      const border = u < 0.05 || v < 0.05 || v > 0.95 || u > 0.93;
      const c = border ? c2 : mulc(c1, 0.85 + 0.18 * Math.sin(u * 14 + v * 2));
      o[0] = x; o[1] = y; o[2] = fold; o[3] = c[0]; o[4] = c[1]; o[5] = c[2]; o[6] = 0.92; o[7] = 0; o[8] = 0;
    });
    const n = g.attributes.position.count, A = new Float32Array(n);
    for (let i = 0; i < n; i++) A[i] = clamp(g.attributes.position.getX(i) / w, 0, 1);
    g.setAttribute('aWave', new THREE.BufferAttribute(A, 1));
    return g;
  });
}
/** a flowing sheet for water, light or fire: pts down the middle, half-width w(t); aFlow = (along, across) */
export function flowSheet(key, pts, w, o = {}) {
  return levels(`flow|${key}`, (lv) => {
    if (lv > (o.last ?? 4)) return EMPTY;
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const L = curve.getLength(), nu = Math.max(4, Math.round(L * 4 * KQ[lv] * 2)), nv = o.ring ? Math.max(6, Math.round(14 * KQ[lv] * 2)) : 3;
    const side = new THREE.Vector3(...(o.side || [0, 0, 1]));
    const F = o.ring ? curve.computeFrenetFrames(nu, false) : null;
    const wf = typeof w === 'function' ? w : () => w;
    return gridGeo(nu, nv, (u, v, out) => {
      const p = curve.getPointAt(u), ww = wf(u);
      if (o.ring) { const i = Math.round(u * nu), a = v * TAU; out[0] = p.x + (F.normals[i].x * Math.cos(a) + F.binormals[i].x * Math.sin(a)) * ww; out[1] = p.y + (F.normals[i].y * Math.cos(a) + F.binormals[i].y * Math.sin(a)) * ww; out[2] = p.z + (F.normals[i].z * Math.cos(a) + F.binormals[i].z * Math.sin(a)) * ww; }
      else { out[0] = p.x + side.x * (v - 0.5) * 2 * ww; out[1] = p.y + side.y * (v - 0.5) * 2 * ww; out[2] = p.z + side.z * (v - 0.5) * 2 * ww; }
      out[3] = out[4] = out[5] = 1;
    }, { flow: (u, v) => [u * L, v] });
  });
}
/** a shell of revolution about +y for mist, vortices, beams of light: prof [[r, y], ...]; aFlow = (around * R, up) */
export function flowShell(key, prof, o = {}) {
  return levels(`shell|${key}`, (lv) => {
    if (lv > (o.last ?? 5)) return EMPTY;
    const nu = Math.max(10, Math.round((o.nu ?? 40) * Math.max(0.3, KQ[lv] * 1.5))), nv = Math.max(2, Math.round((o.nv ?? 8) * Math.max(0.4, KQ[lv] * 1.5)));
    const Rm = Math.max(...prof.map((p) => p[0]));
    const at = (v) => { const f = v * (prof.length - 1), i = Math.min(prof.length - 2, Math.floor(f)), k = f - i; return [lerp(prof[i][0], prof[i + 1][0], k), lerp(prof[i][1], prof[i + 1][1], k)]; };
    return gridGeo(nu, nv, (u, v, out) => {
      const [r, y] = at(v), a = u * TAU + (o.twist || 0) * v;
      out[0] = Math.cos(a) * r; out[1] = y; out[2] = Math.sin(a) * r; out[3] = out[4] = out[5] = 1;
    }, { flow: (u, v) => [u * TAU * Rm, v], wrap: true });
  });
}
