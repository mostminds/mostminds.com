// The deck parts' finishing shop (see ./deck.js): what turns a part drawn as an assembly of primitives into
// finished, shaded work for the near detail levels, and what wrecks it.
//
//   refineKit(K)        every plain shape in a kit gets a near-level twin (levels 0-2) remade in finished form,
//                       with the original kept as the far stand-in (levels 3-5):
//                         boxes    chamfered edges; timber gets grain along its length and plank seams cut in,
//                                  stone gets coursed blocks with sunk mortar joints, metal a mottle with worn edges
//                         round    cylinders / cones / lathes / spheres / tori at three times the segments, bevelled
//                                  rims, staves or courses cut into big timber and stone drums
//                         others   the same colour work (grain, mottle, grime) baked into their vertices
//                       Remade shapes are cached by shape, size and finish, so a repeat costs nothing.
//   DKit                a Kit that refines itself when meshed (moving parts use it)
//   sculptL(key, make)  a sculpted (surface-net) piece at three resolutions, cached: [lv0, lv1, lv2]
//   restyle(geo, look)  a finished geometry recoloured into a realm's metal and timber (the land siege engines)
//   figureGeo(...)      a real ground-unit sculpt posed and baked small (prisoners, drummers, the dead)
//   damage              partDamage hooks: scorch and chips (1), smashed / toppled and charred (2), wrecked (3)
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise3, fbm3, buildPartGeometry, sculptMaterial } from '../sculpt.js';
import { Kit, EMPTY_GEO } from './kit.js';
import { getDetail, setDetail, bakePose } from '../rigkit.js';

const PI = Math.PI;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _n = new THREE.Vector3();

// ====================================================================================================
// finishes
// ====================================================================================================
/** what an item is made of, from its colour (linear rgb) and finish [rough, metal, glow] */
export function classify(c, pbr) {
  if (pbr[2] > 0.04) return 'glow';
  _c.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace).getHSL(_hsl);
  const { h, s, l } = _hsl;
  if (pbr[1] >= 0.3) return 'metal';
  if (s < 0.16 && l > 0.2 && pbr[0] > 0.6) return 'stone';
  if (h > 0.08 && h < 0.17 && s < 0.45 && l > 0.6) return 'bone';
  if (h >= 0.015 && h <= 0.13 && s > 0.26 && l < 0.46 && l > 0.05) return 'wood';
  if (s < 0.3 && l > 0.25 && pbr[0] > 0.6) return 'stone';
  if (l < 0.1) return 'dark';
  return 'cloth';
}
const hashI = (a, b = 0) => { let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * the colour multiplier (and inward cut) of a finish at a point. p: real-size coordinates of the piece, ax: its long
 * axis (0, 1, 2), edge: 0..1 how far into a bevel the point is, groove: 0..1 how deep in a cut seam it is.
 * Returns [r, g, b] (multipliers around 1).
 */
function finish(cls, x, y, z, ax, edge, groove, seed) {
  let k = 1, r = 1, g = 1, b = 1;
  switch (cls) {
    case 'wood': {
      const a = ax === 0 ? x : ax === 1 ? y : z, u = ax === 0 ? y : x, v = ax === 2 ? y : z;
      const gr = noise3(a * 1.3 + seed, u * 26, v * 26), fine = noise3(a * 5 + seed, u * 80, v * 80);
      k = 0.74 + 0.36 * gr * gr * (3 - 2 * gr) + 0.1 * (fine - 0.5);
      const knot = noise3(a * 3.1 - seed, u * 9, v * 9); if (knot > 0.78) k *= 1 - (knot - 0.78) * 2.2;
      k *= 1 + edge * 0.14; k *= 1 - groove * 0.5;
      r = 1.03; b = 0.95; break;
    }
    case 'stone': {
      const m = fbm3(x * 5 + seed, y * 5, z * 5, 3), sp = noise3(x * 38, y * 38, z * 38 + seed);
      k = 0.8 + 0.32 * m + 0.1 * (sp - 0.5); k *= 1 + edge * 0.1; k *= 1 - groove * 0.45;
      const moss = smooth(0.62, 0.8, noise3(x * 3 - seed, y * 2.2, z * 3)) * 0.12; g = 1 + moss * 0.5; r = 1 - moss * 0.3; b = 1 - moss * 0.4; break;
    }
    case 'metal': {
      const m = noise3(x * 11 + seed, y * 11, z * 11), f2 = noise3(x * 45, y * 45 + seed, z * 45);
      k = 0.84 + 0.22 * m + 0.08 * (f2 - 0.5); k *= 1 + edge * 0.3; k *= 1 - groove * 0.4;
      const rust = smooth(0.6, 0.82, fbm3(x * 7 - seed, y * 7, z * 7, 2)) * 0.5 * (1 - edge);
      r = 1 + rust * 0.25; g = 1 - rust * 0.2; b = 1 - rust * 0.4; break;
    }
    case 'bone': { const m = noise3(x * 14 + seed, y * 14, z * 14); k = 0.86 + 0.2 * m; k *= 1 - groove * 0.4; b = 0.92; break; }
    case 'cloth': { const m = noise3(x * 7 + seed, y * 7, z * 7), w = noise3(x * 60, y * 60, z * 60 + seed); k = 0.88 + 0.16 * m + 0.05 * (w - 0.5); k *= 1 - groove * 0.35; break; }
    case 'dark': { const m = noise3(x * 9 + seed, y * 9, z * 9); k = 0.9 + 0.25 * m + edge * 0.35; k *= 1 - groove * 0.3; break; }
    default: { const m = noise3(x * 9 + seed, y * 9, z * 9); k = 0.9 + 0.16 * m; }
  }
  return [k * r, k * g, k * b];
}

// ====================================================================================================
// remade shapes
// ====================================================================================================
/** sorted unique coordinates: the ends, the bevel lines, interior lines every step, and seam pairs */
function axisLines(half, bev, q, seams, gw, coarse) {
  const out = [-half, half];
  if (half < 0.016) return out;
  const step = Math.min([0.2, 0.34, 0.5][q], Math.max([0.05, 0.09, 0.18][q] * coarse, (2 * half) / [10, 6, 3][q]));
  if (bev > 0 && half > bev * 1.5) out.push(-half + bev, half - bev);
  const inner = half - bev, n = half < 0.06 ? 1 : Math.max(1, Math.ceil((2 * inner) / step));
  for (let i = 1; i < n; i++) out.push(-inner + (2 * inner * i) / n);
  for (const s of seams) if (Math.abs(s) < inner - gw) out.push(s - gw, s + gw, s);
  out.sort((a, b) => a - b);
  const u = [out[0]];
  for (let i = 1; i < out.length; i++) if (out[i] - u[u.length - 1] > 1e-4) u.push(out[i]);
  return u;
}
/** seam positions (centred) every w across a span of 2*half */
function seamsAcross(half, w, off = 0) { const out = []; const n = Math.floor((2 * half) / w); for (let i = 1; i < n + 1; i++) { const s = -half + i * w + off; if (s > -half + 0.02 && s < half - 0.02) out.push(s); } return out; }

/**
 * a chamfered box of real size W x H x D, finished as cls. q: 0 near, 1 middle, 2 far (coarser).
 * Timber: planks along its length with cut seams when a face is broad. Stone: coursed blocks with sunk joints.
 */
function boxGeo(W, H, D, cls, q, seed) {
  const dims = [W, H, D], half = dims.map((v) => v / 2), mn = Math.min(W, H, D);
  const thin = [W, H, D].filter((v) => v < 0.04).length;
  const coarse = (cls === 'metal' || cls === 'dark' || cls === 'cloth' ? 1.6 : 1) * (thin >= 2 ? 3 : 1) * (Math.max(W, H, D) < 0.15 ? 4 : 1);
  const bev = mn < 0.03 ? 0 : Math.min(cls === 'stone' ? 0.02 : 0.012, mn * 0.16);
  const ax = dims.indexOf(Math.max(W, H, D));
  const gw = 0.006, seams = [[], [], []], jointsBy = [];
  let course = 0;
  if (q < 2 && cls === 'wood') {
    // planks: seams across each broad cross axis, running along the long axis
    for (let a = 0; a < 3; a++) if (a !== ax && dims[a] > 0.3) seams[a] = seamsAcross(half[a], dims[a] / Math.max(2, Math.round(dims[a] / 0.16)));
  } else if (q < 2 && cls === 'stone' && H > 0.22) {
    course = H / Math.max(2, Math.round(H / 0.16));
    seams[1] = seamsAcross(half[1], course);
    for (const a of [0, 2]) if (dims[a] > 0.3) {
      const bw = dims[a] / Math.max(2, Math.round(dims[a] / 0.3));
      jointsBy[a] = [seamsAcross(half[a], bw), seamsAcross(half[a], bw, bw / 2)];
      seams[a] = [...jointsBy[a][0], ...jointsBy[a][1]];
    }
  }
  const L = [0, 1, 2].map((a) => axisLines(half[a], bev, q, seams[a], gw, coarse));
  const P = [], I = [];
  // six faces: for each axis a and sign, a grid over the other two axes
  for (let a = 0; a < 3; a++) for (const sg of [-1, 1]) {
    const u = (a + 1) % 3, v = (a + 2) % 3, Lu = L[u], Lv = L[v], base = P.length / 3;
    for (let j = 0; j < Lv.length; j++) for (let i = 0; i < Lu.length; i++) { const p = [0, 0, 0]; p[a] = sg * half[a]; p[u] = Lu[i]; p[v] = Lv[j]; P.push(p[0], p[1], p[2]); }
    const nu = Lu.length;
    for (let j = 0; j < Lv.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const p0 = base + j * nu + i, p1 = p0 + 1, p2 = p0 + nu, p3 = p2 + 1;
      if (sg > 0) I.push(p0, p1, p3, p0, p3, p2); else I.push(p0, p3, p1, p0, p2, p3);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
  g = mergeVertices(g, 1e-5);
  // round the edges: every point is pulled onto a rounded box of radius bev
  const pos = g.attributes.position, n = pos.count, E = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = Math.max(-half[0] + bev, Math.min(half[0] - bev, x)), cy = Math.max(-half[1] + bev, Math.min(half[1] - bev, y)), cz = Math.max(-half[2] + bev, Math.min(half[2] - bev, z));
    const dx = x - cx, dy = y - cy, dz = z - cz, dl = Math.hypot(dx, dy, dz);
    const outN = (dx !== 0) + (dy !== 0) + (dz !== 0);
    if (bev > 0 && dl > 1e-6 && outN > 1) { x = cx + (dx / dl) * bev; y = cy + (dy / dl) * bev; z = cz + (dz / dl) * bev; E[i] = 1; }
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  // grooves and colour
  const nr = g.attributes.normal, C = new Float32Array(n * 3);
  const near = (v, list) => { let d = 9; for (const s of list) d = Math.min(d, Math.abs(v - s)); return d; };
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), p = [x, y, z];
    let gr = 0;
    if (cls === 'wood') { for (let a = 0; a < 3; a++) if (seams[a].length && near(p[a], seams[a]) < gw * 0.5) gr = 1; }
    else if (cls === 'stone' && course) {
      if (near(y, seams[1]) < gw * 0.5) gr = 1;
      else { const ci = Math.floor((y + half[1]) / course); for (const a of [0, 2]) if (jointsBy[a] && near(p[a], jointsBy[a][ci % 2]) < gw * 0.5) gr = 1; }
    }
    if (gr) { const d = cls === 'stone' ? 0.01 : 0.005; pos.setXYZ(i, x - nr.getX(i) * d, y - nr.getY(i) * d, z - nr.getZ(i) * d); }
    let blockK = 1;
    if (cls === 'stone' && course) { const ci = Math.floor((y + half[1]) / course); blockK = 0.92 + 0.16 * hashI(ci * 7 + Math.floor((x + z) / 0.3), seed); }
    const f = finish(cls, x, y, z, ax, E[i], gr, seed);
    C[i * 3] = f[0] * blockK; C[i * 3 + 1] = f[1] * blockK; C[i * 3 + 2] = f[2] * blockK;
  }
  if (cls === 'wood' || cls === 'stone') g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}

/** a surface of revolution about y through profile [[r, y], ...] at the given angles (radians), as an indexed grid */
function revolve(prof, angles, closed) {
  const P = [], I = [], na = angles.length, cols = closed ? na : na;
  for (let j = 0; j < prof.length; j++) for (let i = 0; i < na; i++) { const a = angles[i]; P.push(Math.sin(a) * prof[j][0], prof[j][1], Math.cos(a) * prof[j][0]); }
  const segs = closed ? na : na - 1;
  for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % cols, a = j * na + i, b = j * na + i2, c = (j + 1) * na + i, d = (j + 1) * na + i2;
    I.push(a, b, d, a, d, c);
  }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
  g = mergeVertices(g, 1e-5); g.computeVertexNormals();
  return g;
}
/** resample a profile so no step is longer than st (keeps the corners) */
function resample(prof, st) {
  const out = [prof[0]];
  for (let i = 1; i < prof.length; i++) {
    const [r0, y0] = prof[i - 1], [r1, y1] = prof[i], n = Math.max(1, Math.ceil(Math.hypot(r1 - r0, y1 - y0) / st));
    for (let k = 1; k <= n; k++) out.push([r0 + ((r1 - r0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  return out;
}
/** a drum or cone of real size, bevelled rims, finished as cls (staves on big timber, courses on stone) */
function cylGeo(rt, rb, h, open, cls, q, seed) {
  const R = Math.max(rt, rb), coarse = (cls === 'metal' || cls === 'cloth' || cls === 'dark' ? 1.5 : 1) * (R < 0.025 ? 3 : 1);
  const step = Math.min([0.2, 0.34, 0.5][q], Math.max([0.05, 0.09, 0.18][q] * coarse, h / [10, 6, 3][q]));
  const bev = R < 0.025 ? 0 : Math.min(0.012, h * 0.12, Math.max(rt, rb) * 0.25);
  let prof = [];
  const capSt = Math.max(step, R / 3);
  if (!open && rb > 0) prof.push(...resample([[0, -h / 2], [Math.max(0, rb - bev), -h / 2]], capSt));
  const side = [[rb, -h / 2 + (open || rb === 0 ? 0 : bev)], [rt, h / 2 - (open || rt === 0 ? 0 : bev)]];
  if (!open && rb > 0) prof.push([Math.max(0, rb - bev), -h / 2]);
  prof.push(...resample(side, step));
  if (!open && rt > 0) prof.push(...resample([[Math.max(0, rt - bev), h / 2], [0, h / 2]], capSt));
  if (rt === 0) prof.push([0, h / 2]);
  prof = dedupe(prof);
  const segs = R < 0.025 ? [8, 6, 5][q] : Math.max([12, 10, 8][q], Math.min([32, 18, 10][q], Math.round((2 * PI * R) / ([0.045, 0.08, 0.16][q] * coarse))));
  const angles = [];
  const staves = q < 2 && cls === 'wood' && R > 0.1 && R < 0.8 && h > 0.25 ? Math.min(24, Math.max(8, Math.round((2 * PI * R) / 0.09))) : q < 2 && cls === 'stone' && R > 0.15 && h > 0.25 ? Math.min(24, Math.max(6, Math.round((2 * PI * R) / 0.3))) : 0;
  for (let i = 0; i < segs; i++) angles.push((i / segs) * 2 * PI);
  const gwA = staves ? 0.005 / Math.max(R, 0.05) : 0;
  const staveA = [];
  if (staves) for (let i = 0; i < staves; i++) { const a = ((i + 0.5) / staves) * 2 * PI; staveA.push(a); angles.push(a - gwA, a + gwA, a); }
  // stone courses
  let course = 0;
  if (q < 2 && cls === 'stone' && h > 0.22) { course = h / Math.max(2, Math.round(h / 0.16)); for (let y = -h / 2 + course; y < h / 2 - 0.02; y += course) prof.push([lerpR(prof, y), y - 0.005], [lerpR(prof, y), y + 0.005], [lerpR(prof, y), y]); prof.sort((a, b) => a[1] - b[1] || (a[1] === -h / 2 ? a[0] - b[0] : b[0] - a[0])); }
  angles.sort((a, b) => a - b);
  const g = revolve(dedupe(prof, h), angles, true);
  const pos = g.attributes.position, nr = g.attributes.normal, n = pos.count, C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), rr = Math.hypot(x, z), side = rr > R * 0.5 && Math.abs(nr.getY(i)) < 0.8;
    let gr = 0;
    if (side && staves) { const a = (Math.atan2(x, z) + 2 * PI) % (2 * PI); const k = cls === 'stone' && course ? (Math.floor((y + h / 2) / course) % 2) * (PI / staves) : 0; for (const s of staveA) { let d = Math.abs(((a - s - k + 3 * PI) % (2 * PI)) - PI); if (d < gwA * 0.5) gr = 1; } }
    if (side && course) { const t = (y + h / 2) / course; if (Math.abs(t - Math.round(t)) * course < 0.0025 && t > 0.5 && t < h / course - 0.5) gr = 1; }
    if (gr) { const d = cls === 'stone' ? 0.008 : 0.004; pos.setXYZ(i, x - nr.getX(i) * d, y, z - nr.getZ(i) * d); }
    const edge = Math.abs(nr.getY(i)) > 0.2 && Math.abs(nr.getY(i)) < 0.9 ? 1 : 0;
    const f = finish(cls, x, y, z, 1, edge, gr, seed);
    C[i * 3] = f[0]; C[i * 3 + 1] = f[1]; C[i * 3 + 2] = f[2];
  }
  if (staves || course) g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}
function lerpR(prof, y) { for (let i = 1; i < prof.length; i++) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; if ((y - y0) * (y - y1) <= 0 && y1 !== y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0); } return prof[0][0]; }
function dedupe(prof) { const out = [prof[0]]; for (let i = 1; i < prof.length; i++) { const a = out[out.length - 1], b = prof[i]; if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1e-5) out.push(b); } return out; }

/** colour work baked into any geometry (positions taken at real size through scale s) */
function shadeGeo(src, s, cls, seed, keepCol = true) {
  const g = src.index ? src.clone() : src.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  const pos = g.attributes.position, n = pos.count, C = new Float32Array(n * 3), col = keepCol ? g.attributes.color : null;
  if (!g.attributes.normal) g.computeVertexNormals();
  const box = (src.boundingBox || (src.computeBoundingBox(), src.boundingBox)), sz = box.getSize(_v);
  const ax = sz.x * s.x >= sz.y * s.y && sz.x * s.x >= sz.z * s.z ? 0 : sz.y * s.y >= sz.z * s.z ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const f = finish(cls, pos.getX(i) * s.x, pos.getY(i) * s.y, pos.getZ(i) * s.z, ax, 0, 0, seed);
    C[i * 3] = f[0] * (col ? col.getX(i) : 1); C[i * 3 + 1] = f[1] * (col ? col.getY(i) : 1); C[i * 3 + 2] = f[2] * (col ? col.getZ(i) : 1);
  }
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return g;
}
/** scale a local geometry to real size (positions and normals) */
function toReal(g, s) {
  const out = g.clone(); for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') out.deleteAttribute(k);
  out.applyMatrix4(_m.makeScale(s.x, s.y, s.z));
  return out;
}

const REF = new Map();     // key -> [lv0, lv1, lv2]
const SHADED = new WeakMap(); // one-off geometries (tubes, ropes) -> { key: geo }
const r2 = (v) => (v < 0.5 ? Math.round(v * 200) / 200 : Math.round(v * 100) / 100);
function cachedRef(key, make) {
  let r = REF.get(key);
  if (!r) { r = make(); for (const g of r) g.userData.k = key; REF.set(key, r); if (REF.size > 6000) REF.delete(REF.keys().next().value); }
  return r;
}

/**
 * The near-level twin of one kit item, or null to leave it as it is. Returns { geo: [6 geometries], mtx }:
 * the remade shape at real size, in a frame without scale.
 */
function refineItem(it) {
  const g0 = Array.isArray(it.geo) ? null : it.geo;
  if (!g0 || !g0.attributes?.position?.count) return null;
  const cls = it.cls || classify(it.c, it.pbr);
  if (cls === 'glow') return null;
  if (it.mtx.determinant() <= 0) return null;
  it.mtx.decompose(_p, _q, _s);
  const s = _s.clone(), seed = (hashI(Math.round(it.c[0] * 255), Math.round(it.c[2] * 255)) * 40) | 0;
  const mtx = new THREE.Matrix4().compose(_p, _q, new THREE.Vector3(1, 1, 1));
  const prm = g0.parameters || {};
  if (!g0.boundingSphere) g0.computeBoundingSphere();
  if ((g0.boundingSphere?.radius || 0) * Math.max(s.x, s.y, s.z) < 0.02) return null; // rivets and studs: as they are
  let key = null, make = null;
  switch (g0.type) {
    case 'BoxGeometry': {
      if (!g0.boundingBox) g0.computeBoundingBox();
      const b = g0.boundingBox, W = r2((b.max.x - b.min.x) * s.x), H = r2((b.max.y - b.min.y) * s.y), D = r2((b.max.z - b.min.z) * s.z);
      if (Math.min(W, H, D) < 0.004 || Math.max(W, H, D) > 12) return null;
      const off = new THREE.Vector3((b.max.x + b.min.x) / 2 * s.x, (b.max.y + b.min.y) / 2 * s.y, (b.max.z + b.min.z) / 2 * s.z);
      if (off.lengthSq() > 1e-8) mtx.multiply(_m.makeTranslation(off.x, off.y, off.z));
      key = `b${W},${H},${D},${cls}`;
      make = () => [0, 1].map((q) => boxGeo(W, H, D, cls, q, seed % 7));
      break;
    }
    case 'CylinderGeometry': case 'ConeGeometry': {
      const Rr = Math.max(prm.radiusTop ?? 0, prm.radiusBottom ?? prm.radius ?? 0) * Math.max(s.x, s.z);
      if (prm.radialSegments <= 4 || (prm.radialSegments <= 8 && Rr >= 0.15)) return shadeOnly(it, g0, s, cls, seed); // a prism, cut on purpose
      const rt = r2((g0.type === 'ConeGeometry' ? 0 : prm.radiusTop) * Math.max(s.x, s.z)), rb = r2((g0.type === 'ConeGeometry' ? prm.radius : prm.radiusBottom) * Math.max(s.x, s.z)), h = r2(prm.height * s.y);
      if (h < 0.004 || Math.max(rt, rb) < 0.003 || Math.abs(s.x - s.z) > 0.02 * Math.max(s.x, s.z)) {
        // squashed drums: remake round at the geometry's own size and scale the result
        if (prm.thetaLength !== undefined && prm.thetaLength < 2 * PI - 1e-3) return null;
        key = `cs${prm.radiusTop ?? 0},${prm.radiusBottom ?? prm.radius},${prm.height},${r2(s.x)},${r2(s.y)},${r2(s.z)},${cls}`;
        make = () => [0, 1].map((q) => { const g = cylGeo(g0.type === 'ConeGeometry' ? 0 : prm.radiusTop, g0.type === 'ConeGeometry' ? prm.radius : prm.radiusBottom, prm.height, !!prm.openEnded, cls, q, seed % 7); return toRealN(g, s); });
        break;
      }
      if (prm.thetaLength !== undefined && prm.thetaLength < 2 * PI - 1e-3) return null;
      key = `c${rt},${rb},${h},${prm.openEnded ? 1 : 0},${cls}`;
      make = () => [0, 1].map((q) => cylGeo(rt, rb, h, !!prm.openEnded, cls, q, seed % 7));
      break;
    }
    case 'SphereGeometry': {
      key = `s${prm.radius},${prm.phiLength},${prm.thetaStart},${prm.thetaLength},${r2(s.x)},${r2(s.y)},${r2(s.z)},${cls}`;
      const rr = prm.radius * Math.max(s.x, s.y, s.z), w0 = Math.max(8, Math.min(28, Math.round((2 * PI * rr) / 0.045)));
      key += `,${w0}`;
      make = () => [w0, Math.max(8, Math.round(w0 * 0.6))].map((w) => shadeGeo(toReal(new THREE.SphereGeometry(prm.radius, w, Math.max(6, Math.round(w * 0.6)), prm.phiStart, prm.phiLength, prm.thetaStart, prm.thetaLength), s), new THREE.Vector3(1, 1, 1), cls, seed % 7, false));
      break;
    }
    case 'TorusGeometry': {
      key = `t${prm.radius},${prm.tube},${prm.arc},${r2(s.x)},${r2(s.y)},${r2(s.z)},${cls}`;
      const sc = Math.max(s.x, s.y, s.z), small = prm.radius * sc < 0.1, tb = Math.max(8, Math.min(small ? 12 : 40, Math.round((prm.radius * sc * prm.arc) / 0.03))), rd = Math.max(4, Math.min(small ? 6 : 10, Math.round((2 * PI * prm.tube * sc) / 0.02)));
      key += `,${tb},${rd}`;
      make = () => [[rd, tb], [Math.max(4, Math.round(rd * 0.6)), Math.max(6, Math.round(tb * 0.6))]].map(([a, b]) => shadeGeo(toReal(new THREE.TorusGeometry(prm.radius, prm.tube, a, b, prm.arc), s), new THREE.Vector3(1, 1, 1), cls, seed % 7, false));
      break;
    }
    case 'LatheGeometry': {
      key = `l${g0.id},${r2(s.x)},${r2(s.y)},${r2(s.z)},${cls}`;
      make = () => [0, 1].map((q) => {
        const pts = prm.points.map((p) => [p.x, p.y]), sc = Math.max(s.x, s.y, s.z);
        let Lp = 0, Rm = 0; for (let i = 1; i < pts.length; i++) Lp += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); for (const p of pts) Rm = Math.max(Rm, p[0]);
        const st = Math.max(Lp / [40, 20, 10][q], [0.03, 0.06, 0.12][q] / Math.max(1e-3, sc));
        const pr = resample(pts, st), seg = Math.max(prm.segments, Math.max([12, 10, 8][q], Math.min([40, 24, 12][q], Math.round((2 * PI * Rm * sc) / [0.04, 0.07, 0.14][q]))));
        const lg = new THREE.LatheGeometry(pr.map(([x, y]) => new THREE.Vector2(x, y)), seg, prm.phiStart, prm.phiLength);
        const m = mergeVertices(lg.deleteAttribute('uv').deleteAttribute('normal'), 1e-5); m.computeVertexNormals();
        return shadeGeo(toReal(m, s), new THREE.Vector3(1, 1, 1), cls, seed % 7, false);
      });
      break;
    }
    default: return shadeOnly(it, g0, s, cls, seed);
  }
  return { geo: cachedRef(key, make), mtx };
}
/** a one-off or faceted geometry (tube, rope, shape, cloth, prism): the colour work only, kept with it */
function shadeOnly(it, g0, s, cls, seed) {
  const n = g0.attributes.position.count;
  if (n > 6000) return null;
  let per = SHADED.get(g0); if (!per) SHADED.set(g0, (per = {}));
  const k2 = `${cls},${r2(s.x)},${r2(s.y)},${r2(s.z)}`;
  if (!per[k2]) { const gg = shadeGeo(g0, s, cls, seed % 7, true); per[k2] = [gg, gg]; }
  return { geo: per[k2], mtx: it.mtx, keepScale: true };
}
function toRealN(g, s) { const out = g.clone(); out.applyMatrix4(_m.makeScale(s.x, s.y, s.z)); out.computeVertexNormals(); return out; }

/**
 * Give every plain item in a kit its finished near-level twin (levels 0..2) and keep the original as the far stand-in
 * (levels 3..5). Items drawn only near already (mouldings, rivets) are replaced outright. Glowing work is left as it is.
 * Items marked farOnly (the part drew a sculpted replacement itself) only keep their far levels.
 */
export function refineKit(K) {
  if (K.__refined) return K;
  K.__refined = true;
  const add = [];
  for (const it of K.items) {
    if (it.make) { const g3 = it.make(); it.make = null; if (g3) it.geo = [g3[0], g3[1], g3[2], EMPTY_GEO, EMPTY_GEO, EMPTY_GEO]; it.rad = undefined; continue; }
    if (it.ref) continue;
    if (it.farOnly) { it.lo = Math.max(it.lo ?? 0, 3); continue; }
    if (it.lo !== undefined && it.lo >= 3) continue;
    if (it.lv < 0) continue;
    const r = refineItem(it);
    if (!r) continue;
    const geos = [r.geo[0], r.geo[1], r.geo[1], r.geo[1], r.geo[1], r.geo[1]];
    add.push({ geo: geos, mtx: r.mtx, c: it.c, pbr: it.pbr, lv: Math.min(it.lv, 1), lo: it.lo, ref: true, cls: it.cls });
    if (it.lv >= 2) it.lo = Math.max(it.lo ?? 0, 2); else it.lv = -1;
  }
  for (const a of add) K.items.push(a);
  return K;
}

// ====================================================================================================
// merging, indexed (a kit's own merge unrolls every index: three to six times the vertices for remade work)
// ====================================================================================================
const CULL = [0, 0, 0.03, 0.09, 0.2, 0.35];
function radOf(it) {
  if (it.rad === undefined) {
    const g = Array.isArray(it.geo) ? it.geo.find((x) => x?.attributes?.position?.count) || it.geo[0] : it.geo;
    if (!g.boundingSphere) g.computeBoundingSphere();
    it.rad = (g.boundingSphere?.radius || 0) * it.mtx.getMaxScaleOnAxis();
  }
  return it.rad;
}
const shownAt = (it, lv) => it.lv >= lv && !(it.lo !== undefined && lv < it.lo) && (lv < 2 || radOf(it) * 2 >= CULL[lv]);
const _nm = new THREE.Matrix3(), _e4 = new THREE.Matrix4();
/** one detail level of a kit as one indexed geometry (position, normal, color, aPbr), or EMPTY_GEO */
export function mergeLevel(items, level) {
  const list = [];
  let nv = 0, ni = 0;
  for (const it of items) {
    if (!shownAt(it, level)) continue;
    const g = Array.isArray(it.geo) ? it.geo[Math.min(level, it.geo.length - 1)] : it.geo;
    const pa = g?.attributes?.position;
    if (!pa || !pa.count) continue;
    list.push([it, g]); nv += pa.count; ni += g.index ? g.index.count : pa.count;
  }
  if (!nv) return EMPTY_GEO;
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), Cl = new Float32Array(nv * 3), M = new Float32Array(nv * 3), I = new Uint32Array(ni);
  let o = 0, oi = 0, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [it, g] of list) {
    const e = it.mtx.elements, pa = g.attributes.position.array, na = g.attributes.normal?.array, ca = g.attributes.color?.array, ma = g.attributes.aPbr?.array, n = g.attributes.position.count;
    const ps = g.attributes.position.itemSize;
    _nm.getNormalMatrix(it.mtx); const q = _nm.elements;
    const c0 = it.c[0], c1 = it.c[1], c2 = it.c[2], r0 = it.pbr[0], r1 = it.pbr[1], r2 = it.pbr[2];
    const base = o;
    for (let i = 0; i < n; i++, o++) {
      const x = pa[i * ps], y = pa[i * ps + 1], z = pa[i * ps + 2];
      const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      P[o * 3] = X; P[o * 3 + 1] = Y; P[o * 3 + 2] = Z;
      if (X < x0) x0 = X; if (Y < y0) y0 = Y; if (Z < z0) z0 = Z; if (X > x1) x1 = X; if (Y > y1) y1 = Y; if (Z > z1) z1 = Z;
      if (na) { const a = na[i * 3], b = na[i * 3 + 1], cc = na[i * 3 + 2]; let u = q[0] * a + q[3] * b + q[6] * cc, v = q[1] * a + q[4] * b + q[7] * cc, w = q[2] * a + q[5] * b + q[8] * cc; const l = Math.hypot(u, v, w) || 1; N[o * 3] = u / l; N[o * 3 + 1] = v / l; N[o * 3 + 2] = w / l; } else N[o * 3 + 1] = 1;
      if (ca) { const cs = g.attributes.color.itemSize; Cl[o * 3] = c0 * ca[i * cs]; Cl[o * 3 + 1] = c1 * ca[i * cs + 1]; Cl[o * 3 + 2] = c2 * ca[i * cs + 2]; } else { Cl[o * 3] = c0; Cl[o * 3 + 1] = c1; Cl[o * 3 + 2] = c2; }
      if (ma) { M[o * 3] = ma[i * 3]; M[o * 3 + 1] = ma[i * 3 + 1]; M[o * 3 + 2] = ma[i * 3 + 2]; } else { M[o * 3] = r0; M[o * 3 + 1] = Math.min(0.55, r1); M[o * 3 + 2] = r2; }
    }
    const flip = it.mtx.determinant() < 0;
    if (g.index) { const ix = g.index.array, m = g.index.count; for (let t = 0; t < m; t += 3) { I[oi++] = base + ix[t]; I[oi++] = base + (flip ? ix[t + 2] : ix[t + 1]); I[oi++] = base + (flip ? ix[t + 1] : ix[t + 2]); } }
    else for (let t = 0; t < n; t += 3) { I[oi++] = base + t; I[oi++] = base + (flip ? t + 2 : t + 1); I[oi++] = base + (flip ? t + 1 : t + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(Cl, 3)); geo.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
  geo.setIndex(new THREE.BufferAttribute(I, 1));
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geo;
}
/** every detail level of a kit's items, indexed; levels that draw the same items share a geometry */
export function mergeLevels(items, only = null) {
  const out = [], seen = new Map();
  for (let lv = 0; lv < 6; lv++) {
    if (only && !only.includes(lv)) { out.push(null); continue; }
    const sig = items.map((it) => (shownAt(it, lv) ? (Array.isArray(it.geo) ? it.geo[Math.min(lv, it.geo.length - 1)].id : 1) : 0)).join(',');
    if (!seen.has(sig)) seen.set(sig, mergeLevel(items, lv));
    out.push(seen.get(sig));
  }
  return out;
}

/** naming for meshes built while a part is drawn (set by deck.js): () => a key unique to this mesh of this design */
export const hooks = { key: null, model: null };
/** a mesh over cached detail levels, as Kit.mesh makes it */
export function meshOf(geos, material = sculptMaterial()) {
  const m = new THREE.Mesh(geos[0], material);
  m.castShadow = true; m.receiveShadow = true; m.userData.noCrew = true; m.userData.lodGeos = geos;
  return m;
}

// ---- finishing is lazy: a part is first drawn as its plain shapes (what it always was), and finished the first
// time it is rendered near the camera, a few parts per frame, so building a fleet costs no more than before ----
const ENTRIES = new Map(); // key -> { geos (updated in place when finished), kit, done, ver, post }
const PENDING = new Set();
let winT = 0, winSpent = 0;
/** finish one entry now */
export function finishEntry(e) {
  if (e.done) return;
  e.done = true; PENDING.delete(e);
  refineKit(e.kit);
  if (globalThis.__deckDebug) globalThis.__deckDebug('entry', e.kit);
  const fin = mergeLevels(e.kit.items);
  if (e.post) e.post(fin);
  for (let i = 0; i < fin.length; i++) e.geos[i] = fin[i];
  e.ver++;
}
// in a browser, whatever is waiting is also finished in idle time between frames
let idleAsked = false;
function idleSoon() {
  if (idleAsked || typeof requestIdleCallback !== 'function') return;
  idleAsked = true;
  requestIdleCallback(function work(dl) {
    idleAsked = false;
    for (const e of PENDING) { if (dl.timeRemaining() < 6) break; finishEntry(e); }
    if (PENDING.size) idleSoon();
  }, { timeout: 4000 });
}
/** finish everything still waiting (previews, screenshots, tests) */
export function finishAll() { for (const e of [...PENDING]) finishEntry(e); }
/**
 * the levels of a kit under key: plain now, finished when first seen near. Returns the entry; a repeat of the key
 * shares the first one's geometries (and kit, for damage).
 */
export function entryOf(key, K, post = null) {
  let e = key ? ENTRIES.get(key) : null;
  if (!e) {
    e = { geos: mergeLevels(K.items), kit: K, done: false, ver: 0, post };
    if (key) { ENTRIES.set(key, e); if (ENTRIES.size > 4000) ENTRIES.delete(ENTRIES.keys().next().value); }
    PENDING.add(e); idleSoon();
  }
  return e;
}
/** a mesh drawing an entry: it finishes the entry the first time it is rendered at a near detail level */
export function entryMesh(e, model, material = sculptMaterial()) {
  const m = meshOf(e.geos, material);
  m.userData.ver = e.ver;
  m.onBeforeRender = () => {
    const lv = model?.userData.lod?.level ?? 0;
    if (!e.done) {
      if (lv > 2) return;
      const now = performance.now();
      if (now - winT > 33) { winT = now; winSpent = 0; }
      if (winSpent > 10) return;
      finishEntry(e);
      winSpent += performance.now() - now;
    }
    if (m.userData.ver !== e.ver && m.userData.lodGeos === e.geos) {
      m.userData.ver = e.ver;
      const g = e.geos[Math.min(lv, e.geos.length - 1)];
      if (m.visible && g?.attributes?.position?.count) m.geometry = g;
    }
  };
  return m;
}
/** a kit that is finished when it is first seen near; its levels are kept by design, part and mesh */
export class DKit extends Kit {
  mesh(material = sculptMaterial(), key = null) {
    key = key ?? hooks.key?.() ?? null;
    return entryMesh(entryOf(key, this), hooks.model?.() ?? null, material);
  }
}

/**
 * Near-level contact shading on a part's merged geometries: work standing on the deck darkens toward its foot.
 * deckAt(x, z) gives the deck height; done once per geometry.
 */
export function groundShade(geos, deckAt) {
  const done = new Set();
  for (let lv = 0; lv < 3; lv++) {
    const g = geos[lv];
    if (!g || done.has(g) || g.userData.grounded || !g.attributes.color) continue;
    done.add(g); g.userData.grounded = true;
    const P = g.attributes.position, C = g.attributes.color, n = P.count;
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), d = y - deckAt(x, z);
      if (d > 0.35) continue;
      const k = 0.6 + 0.4 * smooth(-0.02, 0.35, d);
      C.setXYZ(i, C.getX(i) * k, C.getY(i) * k, C.getZ(i) * k);
    }
    C.needsUpdate = true;
  }
}

// ====================================================================================================
// sculpted pieces, cached
// ====================================================================================================
const SC = new Map();
/** resolution scale of the current detail preset */
const presetK = () => ({ low: 0.7, medium: 0.85, high: 1, ultra: 1.25 })[getDetail()] ?? 1;
/**
 * a sculpted piece (prims / hard, see ../sculpt.js) meshed at three resolutions for levels 0, 1, 2 (cached by key).
 * res: cells per unit at level 0. Returns [lv0, lv1, lv2] (pass sixL() of it to a kit for every level).
 */
export function sculptL(key, make, res = 48) {
  const k = `${key}|${getDetail()}`;
  if (SC.has(k)) return SC.get(k);
  // make() gives one part ({ prims, hard }) or several meshed apart and merged (much cheaper for spread-out work:
  // each is sampled only over its own bounds)
  const made = make(), parts = Array.isArray(made) ? made : [made], r0 = res * presetK();
  const out = [r0, r0 * 0.55, r0 * 0.3].map((r, i) => {
    const gs = parts.map((pt) => buildPartGeometry(pt, { res: Math.max(8, r * (pt.res || 1)), lod: i, levels: 3, ao: 0.7 })).filter(Boolean);
    if (!gs.length) return EMPTY_GEO;
    return gs.length === 1 ? gs[0] : mergeGeometries(gs.map((g) => (g.index.array instanceof Uint32Array ? g : g.clone().setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1)))), false);
  });
  SC.set(k, out);
  return out;
}
/** three near levels -> the six-level array a kit takes, nothing drawn far away (a stand-in draws there) */
export const nearL = (g3) => [g3[0], g3[1], g3[2], EMPTY_GEO, EMPTY_GEO, EMPTY_GEO];

// ====================================================================================================
// the land siege engines, recoloured into a realm's metal and timber
// ====================================================================================================
const RESTYLED = new Map();
/**
 * a finished geometry (colour + aPbr) with its metal recoloured toward `metal` and its timber toward `wood`,
 * keeping the light and dark of the original work. look: { metal, wood, key }
 */
export function restyle(geo, look) {
  const key = `${geo.uuid}|${look.key}`;
  if (RESTYLED.has(key)) return RESTYLED.get(key);
  const g = geo.clone(), C = g.attributes.color.clone(), M = g.attributes.aPbr, n = C.count;
  const met = look.metal !== undefined ? new THREE.Color(look.metal) : null, wd = look.wood !== undefined ? new THREE.Color(look.wood) : null;
  for (let i = 0; i < n; i++) {
    const r = C.getX(i), gg = C.getY(i), b = C.getZ(i), L = (r + gg + b) / 3, metal = M ? M.getY(i) : 0;
    if (met && metal > 0.45) { const k = Math.min(2.2, Math.max(0.25, L / 0.05)); C.setXYZ(i, met.r * k, met.g * k, met.b * k); }
    else if (wd && metal < 0.2 && r > b * 1.4 && L < 0.45) { const k = Math.min(2, Math.max(0.3, L / 0.15)); C.setXYZ(i, wd.r * k, wd.g * k, wd.b * k); }
  }
  g.setAttribute('color', C);
  RESTYLED.set(key, g);
  return g;
}

// ====================================================================================================
// ground-unit figures, posed and baked small
// ====================================================================================================
const FIG = new Map();
let unitApi = null;
/** hand over the unit builders (set by deck.js, which imports them lazily to keep the module graph light) */
export function useUnits(api) { unitApi = api; }
/**
 * a ground unit's sculpt baked in a pose at height hgt (its feet at the origin, facing +x):
 * pose 'stand' | 'kneel' | 'dead' | 'deadFront' | 'attack'. Returns [lv0, lv1, lv2] or null.
 */
export function figureGeo(unitId, pose, hgt) {
  const key = `${unitId}|${pose}|${Math.round(hgt * 100)}`;
  if (FIG.has(key)) return FIG.get(key);
  let out = null;
  try {
    if (!unitApi) throw new Error('no unit api');
    const { UNITS, prepareDef, buildUnitModel, animateUnit } = unitApi;
    const def = UNITS[unitId] || UNITS.militia;
    const was = getDetail();
    let m;
    try { setDetail('low'); m = buildUnitModel(prepareDef(def)); } finally { setDetail(was); }
    if (pose === 'stand') animateUnit(m, 0.4, false, -1, 0, 0, false);
    else if (pose === 'attack') animateUnit(m, 0.4, false, 0.45, 0, 0, false);
    else if (pose === 'kneel') animateUnit(m, 0.4, false, -1, 0.42, 0, false, { death: { style: 'kneel', seed: 7 } });
    else animateUnit(m, 0.4, false, -1, 1, 0, false, { death: { style: pose === 'deadFront' ? 'front' : 'back', seed: 3 } });
    const h0 = m.userData.rig?.height || 1.2, k = hgt / h0;
    m.rotation.y = PI / 2; m.scale.setScalar(k); m.position.set(0, 0, 0); m.updateMatrixWorld(true);
    const wrap = new THREE.Group(); wrap.add(m); wrap.updateMatrixWorld(true);
    const lv = [1, 2, 2].map((l) => { const g = bakePoseIn(m, wrap, l); return g; });
    if (lv[0]) out = [lv[0], lv[1] || lv[0], lv[2] || lv[1] || lv[0]];
  } catch (e) { out = null; if (!FIG.__warned) { FIG.__warned = true; console.warn('[deck] figure bake failed', e); } }
  FIG.set(key, out);
  return out;
}
/** bakePose, but in the frame of an outer group (so the model's own placement is kept) */
function bakePoseIn(m, wrap, level) {
  const g = bakePose(m, level);
  if (!g) return null;
  const out = g.clone().applyMatrix4(m.matrix);
  return out;
}

// ====================================================================================================
// damage
// ====================================================================================================
/** a scorch pattern at a point: 0 clean .. 1 burnt black */
function scorchAt(x, y, z, th, seed) {
  const n = noise3(x * 1.7 + seed, y * 1.7, z * 1.7 - seed) * 0.6 + noise3(x * 6.1, y * 6.1 + seed, z * 6.1) * 0.4;
  return smooth(th, th + 0.1, n);
}
const CHAR = new Map();
/**
 * a damaged copy of a finished geometry: scorched (cover 0..1 of the surface blackened), chipped (pale splinter
 * spots), with embers glowing in the worst of it when burning. Position and normal buffers are shared.
 */
export function charGeo(g, level, fire, seed = 0) {
  if (!g || g === EMPTY_GEO || !g.attributes.position?.count) return g;
  const key = `${g.uuid}|${level}|${fire ? 1 : 0}`;
  if (CHAR.has(key)) return CHAR.get(key);
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
  if (g.index) out.setIndex(g.index);
  const P = g.attributes.position, Cs = g.attributes.color, Ms = g.attributes.aPbr, n = P.count;
  const C = new Float32Array(n * 3), M = new Float32Array(n * 3);
  const th = [2, 0.55, 0.45, 0.33][level] ?? 0.33, embers = level >= 3 || (fire && level >= 2);
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    let r = Cs ? Cs.getX(i) : 0.7, gg = Cs ? Cs.getY(i) : 0.7, b = Cs ? Cs.getZ(i) : 0.7;
    let ro = Ms ? Ms.getX(i) : 0.8, me = Ms ? Ms.getY(i) : 0, gl = Ms ? Ms.getZ(i) : 0;
    const s = scorchAt(x, y, z, th, seed);
    if (s > 0) { const k = 1 - s * 0.88; r = r * k + 0.012 * s; gg = gg * k + 0.01 * s; b = b * k + 0.008 * s; ro = ro + (1 - ro) * s; me *= 1 - s * 0.7; }
    if (level >= 1) { const chip = noise3(x * 31 + seed, y * 31, z * 31); if (chip > 0.86 - level * 0.02) { const k = (chip - 0.84) * 5; r += (0.42 - r) * k * (1 - s); gg += (0.3 - gg) * k * (1 - s); b += (0.18 - b) * k * (1 - s); } }
    if (embers && s > 0.92) { const e = noise3(x * 24 - seed, y * 24, z * 24); if (e > 0.74) { const k = (e - 0.74) * 3.5; r = 0.7 * k + r; gg = 0.16 * k + gg; gl = Math.max(gl, 1.3 * k); } }
    C[i * 3] = r; C[i * 3 + 1] = gg; C[i * 3 + 2] = b; M[i * 3] = ro; M[i * 3 + 1] = me; M[i * 3 + 2] = gl;
  }
  out.setAttribute('color', new THREE.BufferAttribute(C, 3)); out.setAttribute('aPbr', new THREE.BufferAttribute(M, 3));
  out.boundingSphere = g.boundingSphere; out.boundingBox = g.boundingBox;
  CHAR.set(key, out);
  if (CHAR.size > 1500) CHAR.delete(CHAR.keys().next().value);
  return out;
}

const _box = new THREE.Box3(), _ctr = new THREE.Vector3();
function itemCentre(it) {
  const g = Array.isArray(it.geo) ? it.geo[0] : it.geo;
  if (!g.boundingBox) g.computeBoundingBox();
  if (!g.boundingBox || !isFinite(g.boundingBox.min.x)) return _ctr.set(0, 0, 0).applyMatrix4(it.mtx).clone();
  return g.boundingBox.getCenter(_ctr).applyMatrix4(it.mtx).clone();
}
/**
 * a wrecked copy of a part's kit: 'topple' (tall work broken off above its foot and fallen over), 'smash' (pieces
 * knocked askew, the light ones gone, splintered timber strewn about) or 'char' (it stands, burnt).
 * level 2 or 3; side: which way it falls (+1 / -1 along z).
 */
export function wreckKit(K, level, wreck, o = {}) {
  const out = new Kit(), seed = o.seed ?? 1, side = o.side || 1;
  const items = K.items.filter((it) => it.lv >= 0);
  if (!items.length) return out;
  // the part's extent
  _box.makeEmpty();
  const cs = items.map((it) => { const c = itemCentre(it); _box.expandByPoint(c); return c; });
  const y0 = _box.min.y, y1 = _box.max.y, cx = (_box.min.x + _box.max.x) / 2, cz = (_box.min.z + _box.max.z) / 2;
  const cut = y0 + (y1 - y0) * (level >= 3 ? 0.22 : 0.45);
  const ang = (level >= 3 ? 1.25 : 0.42) * side;
  const hinge = new THREE.Matrix4().makeTranslation(cx, cut, cz).multiply(new THREE.Matrix4().makeRotationX(ang)).multiply(new THREE.Matrix4().makeTranslation(-cx, -cut, -cz));
  items.forEach((it, i) => {
    const c = cs[i], h = hashI(i * 13 + 5, seed), h2 = hashI(i * 7 + 1, seed + 3), h3 = hashI(i * 3 + 11, seed + 9);
    const glow = it.pbr[2] > 0.04;
    if (glow && level >= 3 && !o.fire) return;
    let mtx = it.mtx;
    if (wreck === 'topple' && c.y > cut) mtx = hinge.clone().multiply(it.mtx);
    else if (wreck === 'smash' || (wreck === 'topple' && level >= 3)) {
      const drop = [0, 0, 0.12, 0.3][level], askew = [0, 0, 0.35, 0.6][level];
      if (h < drop && !glow) return;
      if (h2 < askew) {
        const a = (h3 - 0.5) * (level >= 3 ? 1.3 : 0.7), fall = Math.max(0, c.y - y0) * (level >= 3 ? 0.55 : 0.2) * h3;
        const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(a * (h - 0.5) * 2, a * 0.5, a));
        mtx = new THREE.Matrix4().makeTranslation(c.x + (h - 0.5) * 0.1, c.y - fall, c.z + (h2 - 0.5) * 0.1).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(it.mtx);
      }
    }
    out.items.push({ ...it, mtx });
  });
  // strewn splinters and planks
  if (wreck !== 'char') {
    const n = level >= 3 ? 9 : 5, col = o.wood || [0.12, 0.07, 0.04];
    for (let i = 0; i < n; i++) {
      const a = hashI(i, seed + 21) * 2 * PI, r = (0.3 + hashI(i, seed + 5) * 0.6) * Math.max(0.4, (_box.max.x - _box.min.x) * 0.5);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.6, len = 0.15 + hashI(i, seed + 8) * 0.35;
      const y = (o.deckAt ? o.deckAt(x, z) : y0) + 0.02;
      const g = SPLINTER[i % SPLINTER.length]();
      out.items.push({ geo: g, mtx: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1 * (i % 3), a, 0.15 * ((i % 2) - 0.5))), new THREE.Vector3(len, 1, 1)), c: col, pbr: [0.95, 0, 0], lv: 2, ref: true });
    }
  }
  return out;
}
const SPLINTER = [
  () => (SPL0 ||= (() => { const g = boxGeo(1, 0.03, 0.08, 'wood', 1, 2); return g; })()),
  () => (SPL1 ||= (() => { const g = new THREE.ConeGeometry(0.03, 1, 4); g.rotateZ(PI / 2); return shadeGeo(g, new THREE.Vector3(1, 1, 1), 'wood', 3, false); })()),
];
let SPL0 = null, SPL1 = null;

/** swap the geometries a mesh draws at each detail level (its entry in the model's detail table, and now) */
export function swapLod(model, mesh, geos) {
  const lod = model.userData.lod;
  const e = lod?.meshes?.find((x) => x.mesh === mesh);
  if (e) e.geos = geos;
  mesh.userData.lodGeos = geos;
  const g = geos[Math.min(lod?.level ?? 0, geos.length - 1)];
  mesh.geometry = g; mesh.visible = !!g?.attributes?.position?.count;
}

/**
 * Wire a part up for damage. info: { model, mesh (its still work), kit, key, movers: [objects], wreck, kind,
 * deckAt, at: [x, y, z] its foot }. Adds partDamage and breakParts to the model.
 */
export function attachDamage(info) {
  const { model, mesh, kit, key } = info;
  const ud = model.userData;
  const pristine = mesh ? mesh.userData.lodGeos : null;
  const movers = [];
  for (const o of info.movers || []) o.traverse((m) => { if (m.isMesh && m.userData.lodGeos && m.material?.blending !== THREE.AdditiveBlending && !m.material?.transparent) movers.push({ m, geos: m.userData.lodGeos }); });
  let cur = 0;
  const fn = (level, inf = {}) => {
    level = Math.max(0, Math.min(3, level | 0));
    const fire = !!inf.fire;
    const tag = `${level}|${fire && level >= 2 ? 1 : 0}`;
    if (tag === cur) return;
    cur = tag;
    if (mesh && pristine) {
      let geos = pristine;
      if (level === 1) geos = pristine.map((g, i) => (i < 3 ? charGeo(g, 1, false, 3) : g));
      else if (level >= 2) {
        const side = inf.side ? -inf.side : 1;
        const vk = `${key}|${level}|${side}|${fire ? 1 : 0}`;
        geos = WRECK.get(vk);
        if (!geos) {
          refineKit(kit);
          const w = wreckKit(kit, level, info.wreck || 'smash', { seed: hashI(key.length, level) * 99 | 0, side, fire, deckAt: info.deckAt });
          const lv = mergeLevels(w.items, [0, 1, 2]);
          geos = lv.map((g, i) => (i < 3 ? charGeo(g, level, fire, 5) : charGeo(pristine[i], Math.min(level, 2), false, 5)));
          WRECK.set(vk, geos);
          if (WRECK.size > 400) WRECK.delete(WRECK.keys().next().value);
        }
      }
      swapLod(model, mesh, geos);
    }
    for (const mv of movers) swapLod(model, mv.m, level === 0 ? mv.geos : mv.geos.map((g, i) => charGeo(g, Math.min(level, 3), fire && level >= 2, 7 + i)));
  };
  (ud.partDamage ||= []).push(fn);
  const bp = (ud.breakParts ||= []);
  const at = info.at || [0, 0, 0];
  if (mesh) bp.push({ mesh, at: at.slice(), kind: info.kind || 'deck' });
  for (const o of info.movers || []) if (o.isObject3D) bp.push({ mesh: o, at: [o.position.x, o.position.y, o.position.z], kind: info.moverKind || 'spar' });
  return fn;
}
const WRECK = new Map();

export { sculptMaterial };
